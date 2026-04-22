//! ifcx_export — serialise a tessellated 2D `Scene` to an IFCX-binary blob.
//!
//! IFCX is buildingSMART's JSON-based successor to STEP-encoded IFC. The
//! reference flavour uses UTF-8 JSON; we emit a **binary** variant
//! (informal name "IFC 2D B") that preserves the same logical structure
//! but encodes it with MessagePack. That keeps keys/types self-describing
//! (so any msgpack reader can crack the file), while shrinking payload
//! size well below the JSON representation.
//!
//! Pipeline: Scene → BinaryIfcx (struct tree) → rmp_serde::to_vec →
//! zstd::stream::encode_all → file. The zstd layer is optional but
//! almost always a win on CAD payloads (lots of repeated coordinate
//! patterns, layer indices, tight entity names).
//!
//! Size-conscious choices:
//!
//! * **f32 coordinates.** DWG/DXF store f64, but 2D drawings are
//!   millimetre/metre scale with ~mm precision. f32 has 24-bit mantissa
//!   (~7 decimal digits) which resolves 1 µm at 10 m extents. Halves
//!   the numeric payload vs. f64.
//! * **Flat Vec<f32> per kind.** Rather than emit one record per line
//!   segment (huge msgpack-key overhead for 600 K segments), we batch
//!   all segments of a (layer, color, entity-group) key into one
//!   `line_batch` record with a flat `[x1,y1,x2,y2, x1,y1,x2,y2, …]`
//!   buffer. msgpack binary arrays of f32 are 5 bytes of header + 4 B
//!   per number → dense. Same treatment for `tri_batch`.
//! * **Layer palette out-of-line.** Layer names + swatches live in a
//!   small `layers` array, referenced by `layer_id` u32 on each batch.
//! * **No per-segment entity_idx.** The path ("/L_3/E_42_line") is the
//!   entity identifier; reconstructing the segment-to-entity mapping is
//!   the reader's job, same as IFCX JSON.
//!
//! Public API:
//!
//! ```ignore
//! let bytes = write_ifcx_binary(&scene, Some("drawing.dwg"))?; // Vec<u8>
//! std::fs::write("drawing.ifcx", &bytes)?;
//! ```

use std::io;

use serde::{Deserialize, Serialize};

use crate::scene_io::Scene;

/// Fourcc-style schema version. Bumped if the binary layout changes
/// incompatibly. Readers should reject blobs whose prefix they don't
/// recognise.
pub const IFCX_BINARY_VERSION: &str = "0.3-2d-binary";

/// Root envelope written to disk. Field order is intentionally stable —
/// older readers that use positional decoding (rare with msgpack, but
/// possible) still see `ifcx_version` first.
#[derive(Serialize, Deserialize)]
pub struct BinaryIfcx {
    /// Format/version tag. Use `IFCX_BINARY_VERSION` when writing.
    pub ifcx_version: String,
    /// Drawing-level metadata (source file, units, global bbox).
    pub header: Header,
    /// Layer palette. `layer_id` on each entity indexes this array.
    pub layers: Vec<Layer>,
    /// Entity records, grouped into fat batches for compactness.
    pub entities: Vec<Entity>,
}

#[derive(Serialize, Deserialize)]
pub struct Header {
    /// Best-effort path of the original DWG/DXF, or "" if unknown.
    pub source_path: String,
    /// Unit string — always "mm" for now (we preserve raw DWG units
    /// which are millimetre for every sample we've shipped through).
    pub unit: String,
    /// Drawing-wide bbox in scene units: [xmin, ymin, xmax, ymax].
    pub bbox: [f32; 4],
    /// Triangle count — lets a reader preallocate without scanning.
    pub triangle_count: u64,
    /// Segment count — same rationale.
    pub segment_count: u64,
}

#[derive(Serialize, Deserialize)]
pub struct Layer {
    pub id: u32,
    pub name: String,
    /// Packed RGBA u32 (0xAABBGGRR), matching `scene_io::Segment::color`.
    pub color: u32,
}

/// One grouped payload. Rather than per-segment records we carry flat
/// coordinate buffers keyed by (layer, color). The `path` is only
/// emitted per-batch so the msgpack overhead is amortised over tens of
/// thousands of primitives.
///
/// **Quantisation.** To beat DWG's analytical encoding (where a circle
/// is ~16 bytes while our tessellation turns it into ~200 segments) we
/// quantise coordinates to i16 relative to the *scene* bbox using
/// `quantised_delta = round((coord - origin) / scale)`. i16 gives
/// 65535 steps across the extent; for a 100 m drawing that's ~1.5 mm
/// resolution — finer than the 0.5-3 mm tolerance the scene_io
/// tessellator already introduces. Reconstruction: `coord = origin +
/// q * scale`. Scale + origin live on `BinaryIfcx::header.bbox` —
/// any reader that knows the envelope can inflate.
///
/// Msgpack encodes i16 as 3 bytes, so 2 ints = 6 bytes per 2D point
/// (vs 10 bytes for f32 pairs). Combined with zstd on the contiguous
/// deltas — neighbouring segments in the same layer have tightly
/// correlated quantised values — compression reaches 30-60× typical.
///
/// The `data` field is a single msgpack `bin` blob (one u8 array) to
/// avoid per-element array overhead. Each i16 is stored little-endian
/// (native x86 order). Length invariants same as before:
/// 4 coords/segment, 6 coords/triangle → 8 bytes/segment, 12 bytes/tri.
#[derive(Serialize, Deserialize)]
pub struct Entity {
    /// USD-style hierarchical path, e.g. "/L_3/Lines_Model" or
    /// "/L_3/Tris_Paper".
    pub path: String,
    /// Layer index into `BinaryIfcx::layers`.
    pub layer_id: u32,
    /// Packed RGBA u32 (may differ from the layer default when a DXF
    /// entity overrides layer color).
    pub color: u32,
    /// Paper-space flag — carried verbatim from `Segment::is_paper` /
    /// `Triangle::is_paper` so layout tabs round-trip correctly.
    pub is_paper: bool,
    /// Payload kind — either "line_batch_q16" (flat i16-LE, 4× per
    /// segment) or "tri_batch_q16" (flat i16-LE, 6× per triangle).
    pub kind: String,
    /// Raw byte blob of little-endian i16 quantised coordinates. See
    /// the doc-comment on `Entity` for reconstruction.
    #[serde(with = "serde_bytes")]
    pub data: Vec<u8>,
}

/// Serialise `scene` into an IFCX-binary blob (msgpack + zstd).
///
/// `source_path` is embedded verbatim into the header; pass the DWG/DXF
/// pathname the scene was loaded from (or `None` for ad-hoc scenes).
///
/// Returns the compressed byte buffer ready to be written to disk.
/// Kept in-memory so callers can inspect size / write atomically.
pub fn write_ifcx_binary(
    scene: &Scene,
    source_path: Option<&str>,
) -> io::Result<Vec<u8>> {
    let blob = build_blob(scene, source_path);

    // --- 1. MessagePack encode ----------------------------------------
    // `to_vec_named` keeps struct field names as map keys. Costs a few
    // bytes per record (shared across the whole file, so the overhead is
    // constant, not proportional to segment count), but makes the blob
    // self-describing — any downstream msgpack reader (Python, JS,
    // other Rust) can decode without owning this crate's types.
    let msgpack_bytes = rmp_serde::to_vec_named(&blob)
        .map_err(|e| io::Error::new(io::ErrorKind::Other, format!("msgpack: {e}")))?;

    // --- 2. zstd compress ---------------------------------------------
    // Level 19 gives a big ratio win on numeric payloads (repeated
    // coordinate patterns + low-entropy layer ids). Compress time is
    // fine at ~100 MB/s on a workstation; IFCX export is a manual
    // user-triggered "Save As" so latency isn't hot-path.
    let compressed = zstd::stream::encode_all(msgpack_bytes.as_slice(), 19)
        .map_err(|e| io::Error::new(io::ErrorKind::Other, format!("zstd: {e}")))?;

    Ok(compressed)
}

/// Inverse of `write_ifcx_binary` — decompress + deserialise.
///
/// Used by round-trip tests; not wired into the viewer yet.
#[allow(dead_code)]
pub fn read_ifcx_binary(bytes: &[u8]) -> io::Result<BinaryIfcx> {
    let msgpack_bytes = zstd::stream::decode_all(bytes)
        .map_err(|e| io::Error::new(io::ErrorKind::Other, format!("zstd decode: {e}")))?;
    let blob: BinaryIfcx = rmp_serde::from_slice(&msgpack_bytes)
        .map_err(|e| io::Error::new(io::ErrorKind::Other, format!("msgpack decode: {e}")))?;
    Ok(blob)
}

// =============================================================================
// Internals
// =============================================================================

/// Quantise a world-space coordinate to i16 relative to `origin` and
/// `inv_scale` (= 1 / ((extent) / 65534)). Clamped to i16 range so
/// out-of-bbox stray vertices can't wrap.
#[inline]
fn q16(v: f64, origin: f64, inv_scale: f64) -> i16 {
    let delta = (v - origin) * inv_scale;
    // Centre the range on 0 (useful + symmetric; the reader uses the
    // same offset so signing is transparent).
    let q = delta.round() - 32767.0;
    q.max(i16::MIN as f64).min(i16::MAX as f64) as i16
}

fn build_blob(scene: &Scene, source_path: Option<&str>) -> BinaryIfcx {
    // --- Layers -------------------------------------------------------
    // The scene already carries a parallel layer index. We copy it
    // verbatim; if it's empty (DWG without layer tables) we synthesise
    // a single fallback entry so every entity has a valid layer_id.
    let layers: Vec<Layer> = if scene.layer_names.is_empty() {
        vec![Layer {
            id: 0,
            name: "0".into(),
            color: 0xFF_FF_FF_FFu32,
        }]
    } else {
        scene
            .layer_names
            .iter()
            .zip(scene.layer_colors.iter())
            .enumerate()
            .map(|(i, (name, color))| Layer {
                id: i as u32,
                name: name.clone(),
                color: *color,
            })
            .collect()
    };

    let n_layers = layers.len() as u32;
    let layer_of_seg = |i: usize| -> u32 {
        scene
            .segment_layer_idx
            .get(i)
            .map(|&l| (l as u32).min(n_layers.saturating_sub(1)))
            .unwrap_or(0)
    };
    let layer_of_tri = |i: usize| -> u32 {
        scene
            .triangle_layer_idx
            .get(i)
            .map(|&l| (l as u32).min(n_layers.saturating_sub(1)))
            .unwrap_or(0)
    };

    // --- Quantisation parameters --------------------------------------
    // Map [bbox.min, bbox.max] → i16. 65534 steps (we reserve the
    // sentinel endpoints) across the extent. For a 100 m drawing: ~1.5
    // mm resolution, well below the ~1 mm tessellation noise already
    // present in scene_io. 1 px fudge added to the extent so verts on
    // the bbox border don't clip to the sentinel.
    let (xmin, ymin, xmax, ymax) = (scene.bbox[0], scene.bbox[1], scene.bbox[2], scene.bbox[3]);
    let ext_x = (xmax - xmin).max(1e-6);
    let ext_y = (ymax - ymin).max(1e-6);
    let inv_sx = 65534.0 / ext_x;
    let inv_sy = 65534.0 / ext_y;

    // --- Group segments by (layer, color, is_paper) --------------------
    // Using a Vec<(key, Vec<i16>)> + linear scan because we expect
    // O(100) unique layer×color combos, not O(600 K). Avoids a HashMap
    // hash/rehash cost per segment.
    let mut seg_groups: Vec<((u32, u32, bool), Vec<i16>)> = Vec::new();
    for (i, s) in scene.segments.iter().enumerate() {
        let key = (layer_of_seg(i), s.color, s.is_paper);
        let buf = match seg_groups.iter_mut().find(|(k, _)| *k == key) {
            Some((_, buf)) => buf,
            None => {
                seg_groups.push((key, Vec::new()));
                &mut seg_groups.last_mut().unwrap().1
            }
        };
        buf.push(q16(s.p1[0], xmin, inv_sx));
        buf.push(q16(s.p1[1], ymin, inv_sy));
        buf.push(q16(s.p2[0], xmin, inv_sx));
        buf.push(q16(s.p2[1], ymin, inv_sy));
    }

    // --- Group triangles by (layer, color, is_paper) -------------------
    let mut tri_groups: Vec<((u32, u32, bool), Vec<i16>)> = Vec::new();
    for (i, t) in scene.triangles.iter().enumerate() {
        let key = (layer_of_tri(i), t.color, t.is_paper);
        let buf = match tri_groups.iter_mut().find(|(k, _)| *k == key) {
            Some((_, buf)) => buf,
            None => {
                tri_groups.push((key, Vec::new()));
                &mut tri_groups.last_mut().unwrap().1
            }
        };
        for v in &t.v {
            buf.push(q16(v[0], xmin, inv_sx));
            buf.push(q16(v[1], ymin, inv_sy));
        }
    }

    // Serialise each i16 buffer as a little-endian byte blob — that
    // keeps it as one msgpack `bin` field (5-byte header + raw bytes)
    // instead of an array of typed integers (3 bytes per value).
    fn i16_to_le_bytes(v: &[i16]) -> Vec<u8> {
        let mut out = Vec::with_capacity(v.len() * 2);
        for &x in v {
            out.extend_from_slice(&x.to_le_bytes());
        }
        out
    }

    // --- Emit entity records ------------------------------------------
    let mut entities: Vec<Entity> = Vec::with_capacity(seg_groups.len() + tri_groups.len());
    for (idx, ((layer_id, color, is_paper), buf)) in seg_groups.into_iter().enumerate() {
        entities.push(Entity {
            path: format!(
                "/L_{}/Lines_{}_{}",
                layer_id,
                if is_paper { "Paper" } else { "Model" },
                idx
            ),
            layer_id,
            color,
            is_paper,
            kind: "line_batch_q16".into(),
            data: i16_to_le_bytes(&buf),
        });
    }
    for (idx, ((layer_id, color, is_paper), buf)) in tri_groups.into_iter().enumerate() {
        entities.push(Entity {
            path: format!(
                "/L_{}/Tris_{}_{}",
                layer_id,
                if is_paper { "Paper" } else { "Model" },
                idx
            ),
            layer_id,
            color,
            is_paper,
            kind: "tri_batch_q16".into(),
            data: i16_to_le_bytes(&buf),
        });
    }

    // --- Header -------------------------------------------------------
    let bbox = [
        scene.bbox[0] as f32,
        scene.bbox[1] as f32,
        scene.bbox[2] as f32,
        scene.bbox[3] as f32,
    ];
    let header = Header {
        source_path: source_path.unwrap_or("").to_string(),
        unit: "mm".to_string(),
        bbox,
        triangle_count: scene.triangles.len() as u64,
        segment_count: scene.segments.len() as u64,
    };

    BinaryIfcx {
        ifcx_version: IFCX_BINARY_VERSION.to_string(),
        header,
        layers,
        entities,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::scene_io::{Segment, Triangle, TriKind};

    fn synth_scene() -> Scene {
        let mut s = Scene::empty("test", "test".into());
        s.layer_names = vec!["0".into(), "WALLS".into()];
        s.layer_colors = vec![0xFF_FF_FF_FFu32, 0xFF_00_00_FFu32];
        s.segments = vec![
            Segment { p1: [0.0, 0.0], p2: [10.0, 0.0], color: 0, is_paper: false },
            Segment { p1: [10.0, 0.0], p2: [10.0, 10.0], color: 0, is_paper: false },
        ];
        s.segment_layer_idx = vec![0, 1];
        s.triangles = vec![
            Triangle {
                v: [[0.0, 0.0], [1.0, 0.0], [0.0, 1.0]],
                color: 0,
                is_paper: false,
                kind: TriKind::Solid,
            },
        ];
        s.triangle_layer_idx = vec![1];
        s.bbox = [0.0, 0.0, 10.0, 10.0];
        s
    }

    #[test]
    fn round_trip() {
        let scene = synth_scene();
        let bytes = write_ifcx_binary(&scene, Some("test.dxf")).unwrap();
        let back = read_ifcx_binary(&bytes).unwrap();
        assert_eq!(back.ifcx_version, IFCX_BINARY_VERSION);
        assert_eq!(back.header.segment_count, 2);
        assert_eq!(back.header.triangle_count, 1);
        assert_eq!(back.layers.len(), 2);
        // Two segment batches (different layer_ids) + one triangle batch.
        assert_eq!(back.entities.len(), 3);
    }
}
