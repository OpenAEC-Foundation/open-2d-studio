//! ifcx_export — serialise a tessellated 2D `Scene` to an IFCDraw binary
//! blob.
//!
//! IFCDraw is buildingSMART-inspired (interoperable with IFC4 schema
//! concepts: Project / Site / Building / Storey) but limited to the 2D
//! drawing plane. The on-disk format is **binary**: msgpack body wrapped
//! in zstd, with two schema versions:
//!
//!   * **v1** ("0.3-2d-binary") — original release. Grouped `line_batch_q16`
//!     / `tri_batch_q16` entity records keyed by (layer, color). Preserves
//!     geometry + layer palette + bbox + source path. Drops per-segment
//!     entity_idx, raw text, dash patterns, INSERT block structure.
//!
//!   * **v2** ("0.4-2d-binary-ifcdraw") — extended release. Preserves
//!     EVERY semantic Scene field: per-segment + per-triangle layer +
//!     entity index, raw `EntityText` payloads (so an MTEXT round-trips
//!     character-for-character), the `dash_arrays` LINETYPE table with
//!     per-segment dash indices, all `entity_names`, `entity_inserts`
//!     (block_name + transform per INSERT), `block_definitions` (block
//!     name + child-entity grouping + local bbox), and the `layouts`
//!     list. This is the "complete archive" mode meant for a future
//!     Revit / Bonsai / etc. plugin to reconstruct the full document.
//!
//! Pipeline (both versions): Scene → struct tree → rmp_serde::to_vec_named
//! → zstd::stream::encode_all → file. The reader (`load_ifcdraw_scene`)
//! peeks the version field and dispatches to v1- or v2-specific decode.
//!
//! Size-conscious choices (v1 + v2):
//!
//! * **q16 quantised coordinates.** Vertices are stored as little-endian
//!   i16 deltas relative to the scene bbox. 65534 steps across the extent
//!   → ~1.5 mm on a 100 m drawing — finer than the ~1 mm tessellation
//!   floor scene_io already has. Halves payload vs. f32 pairs, quarters
//!   it vs. f64.
//!
//! * **One-blob payload per batch.** Coordinate buffers are serialised
//!   as a single msgpack `bin` blob (5-byte header + raw LE bytes)
//!   instead of typed arrays — avoids the ~3 byte / value msgpack int
//!   overhead.
//!
//! * **zstd level 19** layered on top. The per-segment correlation in
//!   the q16 deltas (neighbouring segments in the same layer share most
//!   of their integer prefix) compresses extremely well.
//!
//! v2 trades a small amount of size for fidelity:
//!
//! * Per-segment `layer_idx`, `entity_idx`, `dash_idx` are stored as
//!   parallel `Vec<u16>` / `Vec<u32>` arrays. With zstd this overhead
//!   collapses to ~1 byte per segment for typical scenes.
//!
//! * Raw `EntityText` records (verbatim MTEXT formatting codes, anchor,
//!   height, font path) are stored as a sparse map keyed by entity_idx.
//!
//! Public API:
//!
//! ```ignore
//! let bytes = write_ifcx_binary(&scene, Some("drawing.dwg"))?; // Vec<u8>
//! std::fs::write("drawing.ifcdraw", &bytes)?;
//! let scene_back = load_ifcdraw_scene("drawing.ifcdraw")?;
//! ```

use std::io;

use serde::{Deserialize, Serialize};

use crate::scene_io::Scene;

/// Format tag for v1 (the original release). Kept for backward-compat
/// detection on read; new writes always use v2.
pub const IFCX_BINARY_VERSION: &str = "0.3-2d-binary";

/// Format tag for v2 — the IFCDraw "complete archive" format that
/// preserves every semantic Scene field. New writes use this tag.
pub const IFCDRAW_BINARY_VERSION_V2: &str = "0.4-2d-binary-ifcdraw";

// =============================================================================
// v1 (legacy) schema — frozen, read-only on import path. New writes use v2.
// =============================================================================

/// v1 envelope. Older `.ifcdraw` / `.ifcx` files are still readable
/// through this struct via `read_ifcx_binary`.
#[derive(Serialize, Deserialize)]
pub struct BinaryIfcx {
    pub ifcx_version: String,
    pub header: Header,
    pub layers: Vec<Layer>,
    pub entities: Vec<Entity>,
}

#[derive(Serialize, Deserialize)]
pub struct Header {
    pub source_path: String,
    pub unit: String,
    pub bbox: [f32; 4],
    pub triangle_count: u64,
    pub segment_count: u64,
}

#[derive(Serialize, Deserialize)]
pub struct Layer {
    pub id: u32,
    pub name: String,
    /// Packed RGBA u32 (0xAABBGGRR).
    pub color: u32,
}

/// One v1 grouped payload. q16 LE pairs: 4× per segment, 6× per
/// triangle. The reader reconstructs world coords via the envelope's
/// bbox + extent.
#[derive(Serialize, Deserialize)]
pub struct Entity {
    pub path: String,
    pub layer_id: u32,
    pub color: u32,
    pub is_paper: bool,
    /// Either `"line_batch_q16"` or `"tri_batch_q16"`. Forward-compat:
    /// readers skip unknown kinds.
    pub kind: String,
    #[serde(with = "serde_bytes")]
    pub data: Vec<u8>,
}

// =============================================================================
// v2 schema — adds full Scene-field round-trip
// =============================================================================

/// v2 envelope. The first field is `version` (a tagged short string)
/// so a reader can peek the version before committing to a full
/// deserialise. v2 preserves every semantic Scene field; the layout is
/// "struct-of-arrays" (one parallel vector per attribute) so zstd sees
/// long runs of correlated values per field.
#[derive(Serialize, Deserialize)]
pub struct BinaryIfcDraw {
    /// Schema tag. v2 writes `IFCDRAW_BINARY_VERSION_V2`. v1 readers
    /// will see a string they don't recognise and fall back to the
    /// legacy decoder via `read_ifcx_binary`.
    pub version: String,
    /// Short marker string useful for debugging / forensics — embedded
    /// generator name + project version. No PII / no trademark strings.
    pub generator: String,
    /// Encoded `SourceKind` (kept as u8 so unknown values don't break
    /// older readers).
    pub source_kind: u8,
    /// Best-effort original path; "" if unknown.
    pub source_path: String,
    /// Scene-wide bbox in drawing units (xmin, ymin, xmax, ymax).
    pub bbox: [f64; 4],
    /// Named LAYOUT extents (Model + Layout1 + ...).
    pub layouts: Vec<LayoutDef>,

    // ----- Layer palette -----
    pub layers: Vec<LayerDefV2>,

    // ----- Geometry (q16 LE blobs) -----
    /// Coordinate encoding tag for `segments_q16`: 0 = `ENC_RAW_LE`
    /// (flat little-endian i16 pairs), 1 = `ENC_DELTA_ZZ`
    /// (zigzag-LEB128 deltas, see `delta_encode_segments_q16`). Writer
    /// picks whichever is smaller. Defaults to 0 on older blobs.
    #[serde(default)]
    pub segments_encoding: u8,
    /// Segment coord stream — see `segments_encoding`.
    #[serde(with = "serde_bytes")]
    pub segments_q16: Vec<u8>,
    /// Per-segment colour (parallel to segments).
    pub segment_color: Vec<u32>,
    /// Paper-space flag bitset (1 bit per segment, LE packed).
    #[serde(with = "serde_bytes")]
    pub segment_paper_bits: Vec<u8>,
    /// Per-segment layer index into `layers`.
    pub segment_layer_idx: Vec<u16>,
    /// Per-segment ENTITY index into `entity_names`.
    pub segment_entity_idx: Vec<u32>,
    /// Per-segment dash index into `dash_arrays` (0 = solid).
    pub segment_dash_idx: Vec<u16>,
    /// Per-segment legacy dash kind (0=solid 1=dashed 2=dotted 3=dash-dot).
    pub segment_dash_kind: Vec<u8>,

    /// Encoding tag for `triangles_q16`. Same semantics as
    /// `segments_encoding`. `#[serde(default)] = 0`.
    #[serde(default)]
    pub triangles_encoding: u8,
    /// Triangle coord stream — see `triangles_encoding`.
    #[serde(with = "serde_bytes")]
    pub triangles_q16: Vec<u8>,
    pub triangle_color: Vec<u32>,
    #[serde(with = "serde_bytes")]
    pub triangle_paper_bits: Vec<u8>,
    pub triangle_layer_idx: Vec<u16>,
    pub triangle_entity_idx: Vec<u32>,
    /// Per-triangle kind (0=Solid, 1=TextFill).
    pub triangle_kind: Vec<u8>,

    // ----- Dash table -----
    /// World-space LTYPE patterns. `dash_arrays[0]` = empty (solid).
    /// Positive=draw length, negative=gap length, zero=dot. Units
    /// match the drawing units (millimetres in typical inputs).
    pub dash_arrays: Vec<Vec<f64>>,

    // ----- Entities (parallel to entity_idx values) -----
    /// Human-readable description per entity. Mirrors
    /// `Scene::entity_names`.
    pub entity_names: Vec<String>,
    /// Sparse text payloads keyed by entity_idx. Only entries whose
    /// Scene slot was Some(_) are emitted.
    pub entity_text: Vec<EntityTextSparse>,
    /// Sparse INSERT references keyed by entity_idx.
    pub entity_inserts: Vec<InsertRefSparse>,

    // ----- Block definitions -----
    /// Logical BLOCK definitions referenced by `entity_inserts`.
    pub block_definitions: Vec<BlockDef>,
}

#[allow(dead_code)]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SourceKind {
    Dxf = 0,
    Dwg = 1,
    IfcDrawRoundTrip = 2,
    Other = 255,
}

impl SourceKind {
    pub fn from_scene_source(src: &str) -> Self {
        match src {
            "dxf" => SourceKind::Dxf,
            "dwg" => SourceKind::Dwg,
            "ifcdraw" | "ifcx" => SourceKind::IfcDrawRoundTrip,
            _ => SourceKind::Other,
        }
    }
}

#[derive(Serialize, Deserialize)]
pub struct LayoutDef {
    pub name: String,
    pub bbox: [f64; 4],
}

#[derive(Serialize, Deserialize)]
pub struct LayerDefV2 {
    pub name: String,
    /// Packed RGBA (0xAABBGGRR).
    pub color: u32,
}

#[derive(Serialize, Deserialize)]
pub struct EntityTextSparse {
    pub entity_idx: u32,
    /// Raw MTEXT / TEXT string (formatting codes preserved verbatim).
    pub raw: String,
    pub anchor: [f64; 2],
    pub height: f64,
    pub rotation: f64,
    pub font_path: String,
    pub bold: bool,
    pub italic: bool,
    pub attachment: u8,
    /// 0=Text, 1=MText, 2=Attrib.
    pub text_kind: u8,
}

#[derive(Serialize, Deserialize)]
pub struct InsertRefSparse {
    pub entity_idx: u32,
    pub block_name: String,
    pub insertion_point: [f64; 2],
    pub scale: [f64; 2],
    /// Rotation in radians.
    pub rotation: f64,
}

#[derive(Serialize, Deserialize)]
pub struct BlockDef {
    pub name: String,
    /// Local bbox of the block contents (zero-vec if not computed).
    pub local_bbox: [f64; 4],
    /// Optional list of entity_idx values that belong to this block
    /// definition (forward-compat — current scene_io leaves empty).
    pub child_entity_idxs: Vec<u32>,
}

// =============================================================================
// Quantisation helpers
// =============================================================================

/// Quantise `v` (world units) → i16 relative to `origin` with `inv_scale`
/// (= 65534 / extent). Centred on 0 so reader uses the same offset.
#[inline]
fn q16(v: f64, origin: f64, inv_scale: f64) -> i16 {
    let delta = (v - origin) * inv_scale;
    let q = delta.round() - 32767.0;
    q.max(i16::MIN as f64).min(i16::MAX as f64) as i16
}

#[inline]
fn dq16(q: i16, origin: f64, scale: f64) -> f64 {
    origin + ((q as f64) + 32767.0) * scale
}

fn i16_le_push(buf: &mut Vec<u8>, q: i16) {
    buf.extend_from_slice(&q.to_le_bytes());
}

fn read_i16_le(buf: &[u8]) -> Vec<i16> {
    buf.chunks_exact(2)
        .map(|c| i16::from_le_bytes([c[0], c[1]]))
        .collect()
}

fn pack_bits(bits: impl IntoIterator<Item = bool>) -> Vec<u8> {
    let mut out: Vec<u8> = Vec::new();
    let mut cur: u8 = 0;
    let mut count: u32 = 0;
    for b in bits {
        if b {
            cur |= 1u8 << (count & 7);
        }
        count += 1;
        if (count & 7) == 0 {
            out.push(cur);
            cur = 0;
        }
    }
    if (count & 7) != 0 {
        out.push(cur);
    }
    out
}

fn unpack_bits(buf: &[u8], n: usize) -> Vec<bool> {
    let mut out = Vec::with_capacity(n);
    for i in 0..n {
        let byte = buf.get(i >> 3).copied().unwrap_or(0);
        out.push(((byte >> (i & 7)) & 1) != 0);
    }
    out
}

fn generator_string() -> String {
    let version = env!("CARGO_PKG_VERSION");
    format!("Open 2D Studio v{version} IFCDraw writer")
}

// -----------------------------------------------------------------------------
// Zigzag-LEB128 varint helpers + delta encoders for the q16 coord blobs
// -----------------------------------------------------------------------------
// Flat-i16-LE costs 8 B/seg, 12 B/tri irrespective of chaining. CAD scenes are
// dominated by chained polylines / hatch boundaries / dimension extensions
// (seg[i].p1 == seg[i-1].p2). Delta-encoding p1 vs. prev_p2 collapses two of
// the four ints to 0 → 1 byte each under zigzag-LEB128. Short chord deltas
// stay in [-64, 63] → 1 byte each. zstd then compresses the highly biased
// byte distribution further. Files that don't chain (TextFill triangles)
// keep raw via the per-blob "smaller wins" check in `build_blob_v2`.

/// Encoding tag for `BinaryIfcDraw::segments_encoding` /
/// `triangles_encoding`. Defaults to `ENC_RAW_LE` on older blobs.
pub const ENC_RAW_LE: u8 = 0;
pub const ENC_DELTA_ZZ: u8 = 1;

#[inline]
fn zigzag_encode(n: i32) -> u32 { ((n << 1) ^ (n >> 31)) as u32 }
#[inline]
fn zigzag_decode(n: u32) -> i32 { ((n >> 1) as i32) ^ -((n & 1) as i32) }

fn varint_write(buf: &mut Vec<u8>, mut n: u32) {
    while n >= 0x80 {
        buf.push(((n & 0x7F) as u8) | 0x80);
        n >>= 7;
    }
    buf.push(n as u8);
}

fn varint_read(buf: &[u8], pos: &mut usize) -> Option<u32> {
    let mut result: u32 = 0;
    let mut shift: u32 = 0;
    loop {
        if *pos >= buf.len() { return None; }
        let byte = buf[*pos];
        *pos += 1;
        result |= ((byte & 0x7F) as u32) << shift;
        if (byte & 0x80) == 0 { return Some(result); }
        shift += 7;
        if shift >= 35 { return None; }
    }
}

#[inline]
fn write_zz(buf: &mut Vec<u8>, n: i32) { varint_write(buf, zigzag_encode(n)); }
#[inline]
fn read_zz(buf: &[u8], pos: &mut usize) -> Option<i32> {
    varint_read(buf, pos).map(zigzag_decode)
}

#[inline]
fn saturate_i16(v: i32) -> i16 {
    v.max(i16::MIN as i32).min(i16::MAX as i32) as i16
}

/// Delta-encode flat i16-LE segments (8 B/seg) into a zigzag-LEB128
/// stream. Per segment, prev = (0,0) initially:
///   d_x1 = x1 - prev_x2;  d_y1 = y1 - prev_y2;
///   d_x2 = x2 - x1;       d_y2 = y2 - y1;
/// Chained polylines drive the first two deltas to 0 each.
fn delta_encode_segments_q16(flat_le: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(flat_le.len());
    let mut prev_x2: i32 = 0;
    let mut prev_y2: i32 = 0;
    for chunk in flat_le.chunks_exact(8) {
        let x1 = i16::from_le_bytes([chunk[0], chunk[1]]) as i32;
        let y1 = i16::from_le_bytes([chunk[2], chunk[3]]) as i32;
        let x2 = i16::from_le_bytes([chunk[4], chunk[5]]) as i32;
        let y2 = i16::from_le_bytes([chunk[6], chunk[7]]) as i32;
        write_zz(&mut out, x1 - prev_x2);
        write_zz(&mut out, y1 - prev_y2);
        write_zz(&mut out, x2 - x1);
        write_zz(&mut out, y2 - y1);
        prev_x2 = x2;
        prev_y2 = y2;
    }
    out
}

/// Inverse of `delta_encode_segments_q16` → flat i16-LE bytes ready for
/// the existing `read_i16_le` dequant pipeline. Truncated streams stop
/// at the last well-formed segment.
fn delta_decode_segments_q16(buf: &[u8]) -> Vec<u8> {
    let mut out: Vec<u8> = Vec::with_capacity(buf.len() * 2);
    let mut pos: usize = 0;
    let mut prev_x2: i32 = 0;
    let mut prev_y2: i32 = 0;
    while pos < buf.len() {
        let d_x1 = match read_zz(buf, &mut pos) { Some(v) => v, None => break };
        let d_y1 = match read_zz(buf, &mut pos) { Some(v) => v, None => break };
        let d_x2 = match read_zz(buf, &mut pos) { Some(v) => v, None => break };
        let d_y2 = match read_zz(buf, &mut pos) { Some(v) => v, None => break };
        let x1 = prev_x2 + d_x1;
        let y1 = prev_y2 + d_y1;
        let x2 = x1 + d_x2;
        let y2 = y1 + d_y2;
        out.extend_from_slice(&saturate_i16(x1).to_le_bytes());
        out.extend_from_slice(&saturate_i16(y1).to_le_bytes());
        out.extend_from_slice(&saturate_i16(x2).to_le_bytes());
        out.extend_from_slice(&saturate_i16(y2).to_le_bytes());
        prev_x2 = x2;
        prev_y2 = y2;
    }
    out
}

/// Delta-encode flat i16-LE triangles (12 B/tri). Per triangle, with
/// prev = (0,0) initially:
///   d_v0 = v0 - prev_v2,  d_v1 = v1 - v0,  d_v2 = v2 - v1
fn delta_encode_triangles_q16(flat_le: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(flat_le.len());
    let mut prev_x: i32 = 0;
    let mut prev_y: i32 = 0;
    for chunk in flat_le.chunks_exact(12) {
        let v0x = i16::from_le_bytes([chunk[0],  chunk[1]])  as i32;
        let v0y = i16::from_le_bytes([chunk[2],  chunk[3]])  as i32;
        let v1x = i16::from_le_bytes([chunk[4],  chunk[5]])  as i32;
        let v1y = i16::from_le_bytes([chunk[6],  chunk[7]])  as i32;
        let v2x = i16::from_le_bytes([chunk[8],  chunk[9]])  as i32;
        let v2y = i16::from_le_bytes([chunk[10], chunk[11]]) as i32;
        write_zz(&mut out, v0x - prev_x);
        write_zz(&mut out, v0y - prev_y);
        write_zz(&mut out, v1x - v0x);
        write_zz(&mut out, v1y - v0y);
        write_zz(&mut out, v2x - v1x);
        write_zz(&mut out, v2y - v1y);
        prev_x = v2x;
        prev_y = v2y;
    }
    out
}

/// Inverse of `delta_encode_triangles_q16`.
fn delta_decode_triangles_q16(buf: &[u8]) -> Vec<u8> {
    let mut out: Vec<u8> = Vec::with_capacity(buf.len() * 2);
    let mut pos: usize = 0;
    let mut prev_x: i32 = 0;
    let mut prev_y: i32 = 0;
    while pos < buf.len() {
        let d0x = match read_zz(buf, &mut pos) { Some(v) => v, None => break };
        let d0y = match read_zz(buf, &mut pos) { Some(v) => v, None => break };
        let d1x = match read_zz(buf, &mut pos) { Some(v) => v, None => break };
        let d1y = match read_zz(buf, &mut pos) { Some(v) => v, None => break };
        let d2x = match read_zz(buf, &mut pos) { Some(v) => v, None => break };
        let d2y = match read_zz(buf, &mut pos) { Some(v) => v, None => break };
        let v0x = prev_x + d0x;
        let v0y = prev_y + d0y;
        let v1x = v0x + d1x;
        let v1y = v0y + d1y;
        let v2x = v1x + d2x;
        let v2y = v1y + d2y;
        out.extend_from_slice(&saturate_i16(v0x).to_le_bytes());
        out.extend_from_slice(&saturate_i16(v0y).to_le_bytes());
        out.extend_from_slice(&saturate_i16(v1x).to_le_bytes());
        out.extend_from_slice(&saturate_i16(v1y).to_le_bytes());
        out.extend_from_slice(&saturate_i16(v2x).to_le_bytes());
        out.extend_from_slice(&saturate_i16(v2y).to_le_bytes());
        prev_x = v2x;
        prev_y = v2y;
    }
    out
}

// =============================================================================
// Writer — v2 path (active default)
// =============================================================================

/// Serialise `scene` into an IFCDraw v2 binary blob (msgpack + zstd).
///
/// Embeds every semantic field of the `Scene` (per-segment entity_idx,
/// raw MTEXT, dash patterns, layouts, INSERT refs, block definitions)
/// so a downstream reader can reconstruct the document without
/// consulting the original DWG/DXF. `source_path` is embedded verbatim
/// in the v2 header.
pub fn write_ifcx_binary(
    scene: &Scene,
    source_path: Option<&str>,
) -> io::Result<Vec<u8>> {
    let blob = build_blob_v2(scene, source_path);
    let msgpack_bytes = rmp_serde::to_vec_named(&blob)
        .map_err(|e| io::Error::new(io::ErrorKind::Other, format!("msgpack: {e}")))?;
    let compressed = zstd::stream::encode_all(msgpack_bytes.as_slice(), 19)
        .map_err(|e| io::Error::new(io::ErrorKind::Other, format!("zstd: {e}")))?;
    Ok(compressed)
}

/// v1 inflate. Returns the raw v1 envelope.
///
/// Special case: when the blob is a v2 file, we synthesise a v1-shape
/// envelope (counts + bbox + layers, empty entities) so callers that
/// only smoke-test "does it unpack?" keep working. Use
/// `read_ifcdraw_v2` for the full v2 record set or `load_ifcdraw_scene`
/// for the high-level Scene reader.
pub fn read_ifcx_binary(bytes: &[u8]) -> io::Result<BinaryIfcx> {
    let msgpack_bytes = zstd::stream::decode_all(bytes)
        .map_err(|e| io::Error::new(io::ErrorKind::Other, format!("zstd decode: {e}")))?;
    if let Ok(v1) = rmp_serde::from_slice::<BinaryIfcx>(&msgpack_bytes) {
        if v1.ifcx_version == IFCX_BINARY_VERSION {
            return Ok(v1);
        }
    }
    if let Ok(v2) = rmp_serde::from_slice::<BinaryIfcDraw>(&msgpack_bytes) {
        if v2.version == IFCDRAW_BINARY_VERSION_V2 {
            let n_seg = v2.segments_q16.len() / 8;
            let n_tri = v2.triangles_q16.len() / 12;
            return Ok(BinaryIfcx {
                ifcx_version: v2.version,
                header: Header {
                    source_path: v2.source_path,
                    unit: "mm".to_string(),
                    bbox: [
                        v2.bbox[0] as f32,
                        v2.bbox[1] as f32,
                        v2.bbox[2] as f32,
                        v2.bbox[3] as f32,
                    ],
                    triangle_count: n_tri as u64,
                    segment_count: n_seg as u64,
                },
                layers: v2
                    .layers
                    .iter()
                    .enumerate()
                    .map(|(i, l)| Layer {
                        id: i as u32,
                        name: l.name.clone(),
                        color: l.color,
                    })
                    .collect(),
                entities: Vec::new(),
            });
        }
    }
    rmp_serde::from_slice::<BinaryIfcx>(&msgpack_bytes)
        .map_err(|e| io::Error::new(io::ErrorKind::Other, format!("msgpack decode: {e}")))
}

/// v2 inflate — returns the full envelope. Errors if the blob isn't v2.
pub fn read_ifcdraw_v2(bytes: &[u8]) -> io::Result<BinaryIfcDraw> {
    let msgpack_bytes = zstd::stream::decode_all(bytes)
        .map_err(|e| io::Error::new(io::ErrorKind::Other, format!("zstd decode: {e}")))?;
    let blob: BinaryIfcDraw = rmp_serde::from_slice(&msgpack_bytes)
        .map_err(|e| io::Error::new(io::ErrorKind::Other, format!("msgpack decode v2: {e}")))?;
    if blob.version != IFCDRAW_BINARY_VERSION_V2 {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            format!("expected {} got {}", IFCDRAW_BINARY_VERSION_V2, blob.version),
        ));
    }
    Ok(blob)
}

/// Peek the embedded version field without committing to a full decode.
fn detect_version(decoded_msgpack: &[u8]) -> (String, bool) {
    #[derive(Deserialize)]
    struct Peek {
        #[serde(default)]
        version: Option<String>,
        #[serde(default)]
        ifcx_version: Option<String>,
    }
    let peek: Peek = match rmp_serde::from_slice(decoded_msgpack) {
        Ok(p) => p,
        Err(_) => return (String::new(), false),
    };
    if let Some(v) = peek.version {
        let is_v2 = v == IFCDRAW_BINARY_VERSION_V2;
        return (v, is_v2);
    }
    (peek.ifcx_version.unwrap_or_default(), false)
}

// =============================================================================
// Reader — auto-detects v1 vs v2
// =============================================================================

/// Reconstruct a `Scene` from an IFCDraw (`.ifcdraw` / `.ifcx`) file.
///
/// Auto-detects v1 vs v2. v1 path inflates geometry only (triangle
/// kind collapses to `Solid`, per-entity grouping is approximated).
/// v2 path restores every semantic field.
pub fn load_ifcdraw_scene(path: &str) -> io::Result<crate::scene_io::Scene> {
    let bytes = std::fs::read(path)?;
    load_ifcdraw_scene_from_bytes(&bytes, path)
}

pub fn load_ifcdraw_scene_from_bytes(
    bytes: &[u8],
    path_hint: &str,
) -> io::Result<Scene> {
    let msgpack_bytes = zstd::stream::decode_all(bytes)
        .map_err(|e| io::Error::new(io::ErrorKind::Other, format!("zstd decode: {e}")))?;
    let (_, is_v2) = detect_version(&msgpack_bytes);
    if is_v2 {
        let blob: BinaryIfcDraw = rmp_serde::from_slice(&msgpack_bytes).map_err(|e| {
            io::Error::new(io::ErrorKind::Other, format!("ifcdraw v2 decode: {e}"))
        })?;
        return Ok(lower_v2(blob, path_hint));
    }
    let blob: BinaryIfcx = rmp_serde::from_slice(&msgpack_bytes).map_err(|e| {
        io::Error::new(io::ErrorKind::Other, format!("ifcdraw v1 decode: {e}"))
    })?;
    Ok(lower_v1(blob, path_hint))
}

fn lower_v1(blob: BinaryIfcx, path_hint: &str) -> Scene {
    use crate::scene_io::{Segment, Triangle, TriKind};
    let mut scene = Scene::empty("ifcdraw", format!("ifcdraw v1: {}", path_hint));
    scene.layer_names = blob.layers.iter().map(|l| l.name.clone()).collect();
    scene.layer_colors = blob.layers.iter().map(|l| l.color).collect();
    if scene.layer_names.is_empty() {
        scene.layer_names.push("0".into());
        scene.layer_colors.push(0xFF_FF_FF_FFu32);
    }

    let [xmin, ymin, xmax, ymax] = blob.header.bbox;
    scene.bbox = [xmin as f64, ymin as f64, xmax as f64, ymax as f64];
    let ext_x = ((xmax - xmin) as f64).max(1e-6);
    let ext_y = ((ymax - ymin) as f64).max(1e-6);
    let scale_x = ext_x / 65534.0;
    let scale_y = ext_y / 65534.0;
    let dq_x = |q: i16| -> f64 { dq16(q, xmin as f64, scale_x) };
    let dq_y = |q: i16| -> f64 { dq16(q, ymin as f64, scale_y) };

    let mut entity_idx_counter: u32 = 0;
    for ent in &blob.entities {
        let q = read_i16_le(&ent.data);
        match ent.kind.as_str() {
            "line_batch_q16" => {
                for chunk in q.chunks_exact(4) {
                    scene.segments.push(Segment {
                        p1: [dq_x(chunk[0]), dq_y(chunk[1])],
                        p2: [dq_x(chunk[2]), dq_y(chunk[3])],
                        color: ent.color,
                        is_paper: ent.is_paper,
                    });
                    scene.segment_layer_idx.push(ent.layer_id as u16);
                    scene.segment_entity_idx.push(entity_idx_counter);
                    scene.segment_dash_kind.push(0);
                    scene.segment_dash_idx.push(0);
                }
            }
            "tri_batch_q16" => {
                for chunk in q.chunks_exact(6) {
                    scene.triangles.push(Triangle {
                        v: [
                            [dq_x(chunk[0]), dq_y(chunk[1])],
                            [dq_x(chunk[2]), dq_y(chunk[3])],
                            [dq_x(chunk[4]), dq_y(chunk[5])],
                        ],
                        color: ent.color,
                        is_paper: ent.is_paper,
                        kind: TriKind::Solid,
                    });
                    scene.triangle_layer_idx.push(ent.layer_id as u16);
                    scene.triangle_entity_idx.push(entity_idx_counter);
                }
            }
            // Forward-compat: skip unknown kinds (incl. future `_q16d`
            // delta payloads that a parallel size-reduction effort
            // may add to the v1 wire).
            _ => {}
        }
        scene.entity_names.push(ent.path.clone());
        scene.entity_text.push(None);
        entity_idx_counter += 1;
    }

    scene.count_label = format!(
        "ifcdraw v1: {} segs · {} tris · {} layers",
        scene.segments.len(),
        scene.triangles.len(),
        scene.layer_names.len(),
    );
    scene
}

fn lower_v2(blob: BinaryIfcDraw, path_hint: &str) -> Scene {
    use crate::scene_io::{EntityText, Segment, TextKind, TriKind, Triangle};

    let mut scene = Scene::empty("ifcdraw", format!("ifcdraw v2: {}", path_hint));

    scene.layer_names = blob.layers.iter().map(|l| l.name.clone()).collect();
    scene.layer_colors = blob.layers.iter().map(|l| l.color).collect();
    if scene.layer_names.is_empty() {
        scene.layer_names.push("0".into());
        scene.layer_colors.push(0xFF_FF_FF_FFu32);
    }

    scene.bbox = blob.bbox;
    let [xmin, ymin, xmax, ymax] = blob.bbox;
    let ext_x = (xmax - xmin).max(1e-6);
    let ext_y = (ymax - ymin).max(1e-6);
    let scale_x = ext_x / 65534.0;
    let scale_y = ext_y / 65534.0;
    let dq_x = |q: i16| -> f64 { dq16(q, xmin, scale_x) };
    let dq_y = |q: i16| -> f64 { dq16(q, ymin, scale_y) };

    scene.layouts = blob
        .layouts
        .iter()
        .map(|l| (l.name.clone(), l.bbox))
        .collect();
    scene.dash_arrays = blob.dash_arrays.clone();
    if scene.dash_arrays.is_empty() {
        scene.dash_arrays.push(Vec::new());
    }

    scene.entity_names = blob.entity_names.clone();
    scene.entity_text = vec![None; scene.entity_names.len()];
    for et in &blob.entity_text {
        let idx = et.entity_idx as usize;
        if idx < scene.entity_text.len() {
            scene.entity_text[idx] = Some(EntityText {
                raw: et.raw.clone(),
                anchor: et.anchor,
                height: et.height,
                rotation: et.rotation,
                font_path: et.font_path.clone(),
                bold: et.bold,
                italic: et.italic,
                attachment: et.attachment,
                kind: match et.text_kind {
                    1 => TextKind::MText,
                    2 => TextKind::Attrib,
                    _ => TextKind::Text,
                },
            });
        }
    }

    // Segments — switch on the encoding tag to materialise a flat
    // i16-LE buffer for the existing reader loop.
    let segments_le: Vec<u8> = match blob.segments_encoding {
        ENC_DELTA_ZZ => delta_decode_segments_q16(&blob.segments_q16),
        _            => blob.segments_q16.clone(),
    };
    let seg_q = read_i16_le(&segments_le);
    let n_seg = seg_q.len() / 4;
    let seg_paper = unpack_bits(&blob.segment_paper_bits, n_seg);
    for i in 0..n_seg {
        let c = &seg_q[i * 4..i * 4 + 4];
        let color = blob.segment_color.get(i).copied().unwrap_or(0xFF_FF_FF_FFu32);
        let is_paper = seg_paper.get(i).copied().unwrap_or(false);
        scene.segments.push(Segment {
            p1: [dq_x(c[0]), dq_y(c[1])],
            p2: [dq_x(c[2]), dq_y(c[3])],
            color,
            is_paper,
        });
        scene
            .segment_layer_idx
            .push(blob.segment_layer_idx.get(i).copied().unwrap_or(0));
        scene
            .segment_entity_idx
            .push(blob.segment_entity_idx.get(i).copied().unwrap_or(0));
        scene
            .segment_dash_idx
            .push(blob.segment_dash_idx.get(i).copied().unwrap_or(0));
        scene
            .segment_dash_kind
            .push(blob.segment_dash_kind.get(i).copied().unwrap_or(0));
    }

    // Triangles
    let triangles_le: Vec<u8> = match blob.triangles_encoding {
        ENC_DELTA_ZZ => delta_decode_triangles_q16(&blob.triangles_q16),
        _            => blob.triangles_q16.clone(),
    };
    let tri_q = read_i16_le(&triangles_le);
    let n_tri = tri_q.len() / 6;
    let tri_paper = unpack_bits(&blob.triangle_paper_bits, n_tri);
    for i in 0..n_tri {
        let c = &tri_q[i * 6..i * 6 + 6];
        let color = blob.triangle_color.get(i).copied().unwrap_or(0xFF_FF_FF_FFu32);
        let is_paper = tri_paper.get(i).copied().unwrap_or(false);
        let kind = match blob.triangle_kind.get(i).copied().unwrap_or(0) {
            1 => TriKind::TextFill,
            _ => TriKind::Solid,
        };
        scene.triangles.push(Triangle {
            v: [
                [dq_x(c[0]), dq_y(c[1])],
                [dq_x(c[2]), dq_y(c[3])],
                [dq_x(c[4]), dq_y(c[5])],
            ],
            color,
            is_paper,
            kind,
        });
        scene
            .triangle_layer_idx
            .push(blob.triangle_layer_idx.get(i).copied().unwrap_or(0));
        scene
            .triangle_entity_idx
            .push(blob.triangle_entity_idx.get(i).copied().unwrap_or(0));
    }

    scene.count_label = format!(
        "ifcdraw v2: {} segs · {} tris · {} layers · {} entities · {} blocks",
        scene.segments.len(),
        scene.triangles.len(),
        scene.layer_names.len(),
        scene.entity_names.len(),
        blob.block_definitions.len(),
    );
    scene
}

// =============================================================================
// Writer — v2 builder
// =============================================================================

fn build_blob_v2(scene: &Scene, source_path: Option<&str>) -> BinaryIfcDraw {
    // ----- Layer palette -----
    let layers: Vec<LayerDefV2> = if scene.layer_names.is_empty() {
        vec![LayerDefV2 {
            name: "0".into(),
            color: 0xFF_FF_FF_FFu32,
        }]
    } else {
        scene
            .layer_names
            .iter()
            .zip(
                scene
                    .layer_colors
                    .iter()
                    .copied()
                    .chain(std::iter::repeat(0xFF_FF_FF_FFu32)),
            )
            .map(|(name, color)| LayerDefV2 {
                name: name.clone(),
                color,
            })
            .collect()
    };

    // ----- Quantisation parameters -----
    let (xmin, ymin, xmax, ymax) = (scene.bbox[0], scene.bbox[1], scene.bbox[2], scene.bbox[3]);
    let ext_x = (xmax - xmin).max(1e-6);
    let ext_y = (ymax - ymin).max(1e-6);
    let inv_sx = 65534.0 / ext_x;
    let inv_sy = 65534.0 / ext_y;

    // ----- Segments -----
    let n_seg = scene.segments.len();
    let mut segments_q16 = Vec::with_capacity(n_seg * 8);
    let mut segment_color = Vec::with_capacity(n_seg);
    let mut paper_bits = Vec::with_capacity(n_seg);
    let mut segment_layer_idx = Vec::with_capacity(n_seg);
    let mut segment_entity_idx = Vec::with_capacity(n_seg);
    let mut segment_dash_idx = Vec::with_capacity(n_seg);
    let mut segment_dash_kind = Vec::with_capacity(n_seg);
    for (i, s) in scene.segments.iter().enumerate() {
        i16_le_push(&mut segments_q16, q16(s.p1[0], xmin, inv_sx));
        i16_le_push(&mut segments_q16, q16(s.p1[1], ymin, inv_sy));
        i16_le_push(&mut segments_q16, q16(s.p2[0], xmin, inv_sx));
        i16_le_push(&mut segments_q16, q16(s.p2[1], ymin, inv_sy));
        segment_color.push(s.color);
        paper_bits.push(s.is_paper);
        segment_layer_idx.push(scene.segment_layer_idx.get(i).copied().unwrap_or(0));
        segment_entity_idx.push(scene.segment_entity_idx.get(i).copied().unwrap_or(0));
        segment_dash_idx.push(scene.segment_dash_idx.get(i).copied().unwrap_or(0));
        segment_dash_kind.push(scene.segment_dash_kind.get(i).copied().unwrap_or(0));
    }
    let segment_paper_bits = pack_bits(paper_bits);

    // Pick smaller of raw-LE vs. delta-zigzag for the segment q16 blob.
    let (segments_q16, segments_encoding) = {
        let delta = delta_encode_segments_q16(&segments_q16);
        if delta.len() < segments_q16.len() {
            (delta, ENC_DELTA_ZZ)
        } else {
            (segments_q16, ENC_RAW_LE)
        }
    };

    // ----- Triangles -----
    let n_tri = scene.triangles.len();
    let mut triangles_q16 = Vec::with_capacity(n_tri * 12);
    let mut triangle_color = Vec::with_capacity(n_tri);
    let mut tri_paper_bits = Vec::with_capacity(n_tri);
    let mut triangle_layer_idx = Vec::with_capacity(n_tri);
    let mut triangle_entity_idx = Vec::with_capacity(n_tri);
    let mut triangle_kind = Vec::with_capacity(n_tri);
    for (i, t) in scene.triangles.iter().enumerate() {
        for v in &t.v {
            i16_le_push(&mut triangles_q16, q16(v[0], xmin, inv_sx));
            i16_le_push(&mut triangles_q16, q16(v[1], ymin, inv_sy));
        }
        triangle_color.push(t.color);
        tri_paper_bits.push(t.is_paper);
        triangle_layer_idx.push(scene.triangle_layer_idx.get(i).copied().unwrap_or(0));
        triangle_entity_idx.push(scene.triangle_entity_idx.get(i).copied().unwrap_or(0));
        triangle_kind.push(match t.kind {
            crate::scene_io::TriKind::Solid => 0u8,
            crate::scene_io::TriKind::TextFill => 1u8,
        });
    }
    let triangle_paper_bits = pack_bits(tri_paper_bits);

    // Same delta-vs-raw shootout for the triangle q16 blob.
    let (triangles_q16, triangles_encoding) = {
        let delta = delta_encode_triangles_q16(&triangles_q16);
        if delta.len() < triangles_q16.len() {
            (delta, ENC_DELTA_ZZ)
        } else {
            (triangles_q16, ENC_RAW_LE)
        }
    };

    // ----- Layouts -----
    let layouts: Vec<LayoutDef> = scene
        .layouts
        .iter()
        .map(|(name, bbox)| LayoutDef {
            name: name.clone(),
            bbox: *bbox,
        })
        .collect();

    // ----- Entity sparse tables -----
    let mut entity_text = Vec::new();
    for (eid, slot) in scene.entity_text.iter().enumerate() {
        if let Some(t) = slot {
            entity_text.push(EntityTextSparse {
                entity_idx: eid as u32,
                raw: t.raw.clone(),
                anchor: t.anchor,
                height: t.height,
                rotation: t.rotation,
                font_path: t.font_path.clone(),
                bold: t.bold,
                italic: t.italic,
                attachment: t.attachment,
                text_kind: match t.kind {
                    crate::scene_io::TextKind::Text => 0,
                    crate::scene_io::TextKind::MText => 1,
                    crate::scene_io::TextKind::Attrib => 2,
                },
            });
        }
    }

    // INSERT refs are extracted from entity_names that match
    // `INSERT "<block_name>"`. The full insertion-point / scale /
    // rotation aren't preserved in the Scene yet (geometry is
    // expanded into children at parse time), so we only record the
    // block name + a zero transform. A future DWG/DXF loader pass
    // can fill in the real transform without bumping the wire format.
    let mut entity_inserts: Vec<InsertRefSparse> = Vec::new();
    let mut seen_block_names: Vec<String> = Vec::new();
    for (eid, name) in scene.entity_names.iter().enumerate() {
        if let Some(block) = parse_insert_name(name) {
            entity_inserts.push(InsertRefSparse {
                entity_idx: eid as u32,
                block_name: block.clone(),
                insertion_point: [0.0, 0.0],
                scale: [1.0, 1.0],
                rotation: 0.0,
            });
            if !seen_block_names.iter().any(|n| n == &block) {
                seen_block_names.push(block);
            }
        }
    }

    let block_definitions: Vec<BlockDef> = seen_block_names
        .into_iter()
        .map(|name| BlockDef {
            name,
            local_bbox: [0.0, 0.0, 0.0, 0.0],
            child_entity_idxs: Vec::new(),
        })
        .collect();

    BinaryIfcDraw {
        version: IFCDRAW_BINARY_VERSION_V2.to_string(),
        generator: generator_string(),
        source_kind: SourceKind::from_scene_source(scene.source) as u8,
        source_path: source_path.unwrap_or("").to_string(),
        bbox: [xmin, ymin, xmax, ymax],
        layouts,
        layers,

        segments_encoding,
        segments_q16,
        segment_color,
        segment_paper_bits,
        segment_layer_idx,
        segment_entity_idx,
        segment_dash_idx,
        segment_dash_kind,

        triangles_encoding,
        triangles_q16,
        triangle_color,
        triangle_paper_bits,
        triangle_layer_idx,
        triangle_entity_idx,
        triangle_kind,

        dash_arrays: scene.dash_arrays.clone(),
        entity_names: scene.entity_names.clone(),
        entity_text,
        entity_inserts,
        block_definitions,
    }
}

/// Parse `INSERT "name"` → `Some(name)`. Tolerates the trailing `\"`-quote
/// pair the DXF/DWG loaders embed in `entity_names`.
fn parse_insert_name(s: &str) -> Option<String> {
    let s = s.trim_start();
    let rest = s.strip_prefix("INSERT")?;
    let rest = rest.trim_start();
    let stripped = if let Some(inner) = rest.strip_prefix('"') {
        inner.strip_suffix('"').unwrap_or(inner)
    } else {
        rest
    };
    if stripped.is_empty() {
        None
    } else {
        Some(stripped.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::scene_io::{EntityText, Segment, TextKind, Triangle, TriKind};

    fn synth_scene() -> Scene {
        let mut s = Scene::empty("dwg", "test".into());
        s.layer_names = vec!["0".into(), "WALLS".into()];
        s.layer_colors = vec![0xFF_FF_FF_FFu32, 0xFF_00_00_FFu32];
        s.segments = vec![
            Segment {
                p1: [0.0, 0.0],
                p2: [10.0, 0.0],
                color: 0xAABBCCDDu32,
                is_paper: false,
            },
            Segment {
                p1: [10.0, 0.0],
                p2: [10.0, 10.0],
                color: 0xAABBCCDDu32,
                is_paper: true,
            },
        ];
        s.segment_layer_idx = vec![0, 1];
        s.segment_entity_idx = vec![0, 1];
        s.segment_dash_idx = vec![0, 1];
        s.segment_dash_kind = vec![0, 1];
        s.dash_arrays = vec![Vec::new(), vec![12.7, -6.35]];
        s.triangles = vec![Triangle {
            v: [[0.0, 0.0], [1.0, 0.0], [0.0, 1.0]],
            color: 0,
            is_paper: false,
            kind: TriKind::TextFill,
        }];
        s.triangle_layer_idx = vec![1];
        s.triangle_entity_idx = vec![2];
        s.bbox = [0.0, 0.0, 10.0, 10.0];
        s.layouts = vec![
            ("Model".to_string(), [0.0, 0.0, 10.0, 10.0]),
            ("Sheet 1".to_string(), [-2.0, -2.0, 12.0, 12.0]),
        ];
        s.entity_names = vec![
            "LINE".to_string(),
            "MTEXT".to_string(),
            "INSERT \"PILE_SYMBOL\"".to_string(),
        ];
        s.entity_text = vec![
            None,
            Some(EntityText {
                raw: r"\fArial|b1;Hello".to_string(),
                anchor: [5.0, 5.0],
                height: 2.5,
                rotation: 0.0,
                font_path: "Arial.ttf".to_string(),
                bold: true,
                italic: false,
                attachment: 1,
                kind: TextKind::MText,
            }),
            None,
        ];
        s
    }

    #[test]
    fn v1_legacy_round_trip_still_passes() {
        // Build a raw v1 envelope so we exercise the back-compat reader
        // path with the exact shape older releases produced.
        let blob = BinaryIfcx {
            ifcx_version: IFCX_BINARY_VERSION.to_string(),
            header: Header {
                source_path: "x.dxf".into(),
                unit: "mm".into(),
                bbox: [0.0, 0.0, 10.0, 10.0],
                triangle_count: 0,
                segment_count: 0,
            },
            layers: vec![Layer {
                id: 0,
                name: "0".into(),
                color: 0xFF_FF_FF_FFu32,
            }],
            entities: vec![],
        };
        let msgpack = rmp_serde::to_vec_named(&blob).unwrap();
        let compressed = zstd::stream::encode_all(msgpack.as_slice(), 3).unwrap();
        let back = read_ifcx_binary(&compressed).unwrap();
        assert_eq!(back.ifcx_version, IFCX_BINARY_VERSION);

        let scene = load_ifcdraw_scene_from_bytes(&compressed, "old.ifcdraw").unwrap();
        assert_eq!(scene.layer_names, vec!["0"]);
        assert!(scene.count_label.contains("v1"));
    }

    #[test]
    fn v2_round_trip_preserves_all_fields() {
        let scene = synth_scene();
        let bytes = write_ifcx_binary(&scene, Some("test.dwg")).unwrap();
        let scene_back = load_ifcdraw_scene_from_bytes(&bytes, "test.ifcdraw").unwrap();

        assert_eq!(scene_back.segments.len(), 2);
        assert_eq!(scene_back.triangles.len(), 1);
        assert_eq!(scene_back.layer_names, vec!["0", "WALLS"]);
        assert_eq!(
            scene_back.layer_colors,
            vec![0xFF_FF_FF_FFu32, 0xFF_00_00_FFu32]
        );
        assert_eq!(scene_back.segment_layer_idx, vec![0, 1]);
        assert_eq!(scene_back.segment_entity_idx, vec![0, 1]);
        assert_eq!(scene_back.segment_dash_idx, vec![0, 1]);
        assert_eq!(scene_back.segment_dash_kind, vec![0, 1]);
        assert!(!scene_back.segments[0].is_paper);
        assert!(scene_back.segments[1].is_paper);
        assert_eq!(scene_back.dash_arrays.len(), 2);
        assert_eq!(scene_back.dash_arrays[0], Vec::<f64>::new());
        assert_eq!(scene_back.dash_arrays[1], vec![12.7, -6.35]);
        assert_eq!(scene_back.triangles[0].kind, TriKind::TextFill);
        assert_eq!(scene_back.triangle_layer_idx, vec![1]);
        assert_eq!(scene_back.triangle_entity_idx, vec![2]);
        assert_eq!(scene_back.layouts.len(), 2);
        assert_eq!(scene_back.layouts[0].0, "Model");
        assert_eq!(scene_back.layouts[1].0, "Sheet 1");
        assert_eq!(scene_back.entity_names.len(), 3);
        assert_eq!(scene_back.entity_names[2], "INSERT \"PILE_SYMBOL\"");
        let mtext = scene_back.entity_text[1].as_ref().unwrap();
        assert_eq!(mtext.raw, r"\fArial|b1;Hello");
        assert_eq!(mtext.height, 2.5);
        assert_eq!(mtext.kind, TextKind::MText);
        assert!(mtext.bold);
    }

    #[test]
    fn v2_blob_is_back_compatible_via_read_ifcx_binary() {
        // Bench tool (`ifcdraw-bench`) smoke-tests the saved blob via
        // `read_ifcx_binary`. After the v2 bump it must still get a
        // usable envelope (synthetic header), not a decode error.
        let scene = synth_scene();
        let bytes = write_ifcx_binary(&scene, Some("test.dwg")).unwrap();
        let back = read_ifcx_binary(&bytes).unwrap();
        assert_eq!(back.ifcx_version, IFCDRAW_BINARY_VERSION_V2);
        assert_eq!(back.header.segment_count, 2);
        assert_eq!(back.header.triangle_count, 1);
    }

    #[test]
    fn parse_insert_name_handles_typical_cases() {
        assert_eq!(parse_insert_name("INSERT \"FOO\""), Some("FOO".into()));
        assert_eq!(parse_insert_name("INSERT \"A4_grid\""), Some("A4_grid".into()));
        assert_eq!(parse_insert_name("LINE"), None);
        assert_eq!(parse_insert_name("INSERT \"\""), None);
        assert_eq!(parse_insert_name("INSERT BLOCKNAME"), Some("BLOCKNAME".into()));
    }
}
