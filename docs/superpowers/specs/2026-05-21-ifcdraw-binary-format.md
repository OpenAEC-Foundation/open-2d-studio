# IFCDraw Binary Format v2

Status: **Active**
Implementation: `kernel/crates/app/src/ifcx_export.rs`
Companion plan: `docs/superpowers/plans/2026-05-21-revit-ifcdraw-plugin-plan.md`

## Wire format

```
[ zstd-19 ][ msgpack body ][ BinaryIfcDraw struct ]
```

- Outer container: zstd compression level 19 (about 100 MB/s on a
  workstation, manual Save-As path so latency isn't hot).
- Body: MessagePack with named keys (`rmp_serde::to_vec_named`) so the
  blob is self-describing to any msgpack reader.
- Root struct: `BinaryIfcDraw`.

The format ships with two schema versions on the read side:

| Version tag                | Field name in envelope | Status        |
|----------------------------|------------------------|---------------|
| `"0.3-2d-binary"`          | `ifcx_version`         | v1 (read-only) |
| `"0.4-2d-binary-ifcdraw"`  | `version`              | v2 (active)    |

The reader peeks the version field before committing to a full decode
— a v1 blob exposes `ifcx_version`, a v2 blob exposes `version`. v1
files still load through the legacy decoder so older `.ifcdraw` /
`.ifcx` archives on disk are not invalidated.

## v2 schema (msgpack object)

Top-level envelope:

```text
BinaryIfcDraw {
    version:        String           = "0.4-2d-binary-ifcdraw"
    generator:      String           // "Open 2D Studio v0.1.0 IFCDraw writer"
    source_kind:    u8               // 0=dxf, 1=dwg, 2=ifcdraw-roundtrip, 255=other
    source_path:    String           // best-effort original path; "" if unknown
    bbox:           [f64; 4]         // [xmin, ymin, xmax, ymax]
    layouts:        [LayoutDef]      // Model + Sheets

    layers:         [LayerDefV2]     // palette

    // Geometry — struct-of-arrays so zstd sees per-field correlation
    segments_q16:        bin         // 4 i16 LE / segment (x1,y1,x2,y2)
    segment_color:       [u32]       // packed RGBA per segment
    segment_paper_bits:  bin         // 1 bit / segment (LE-packed)
    segment_layer_idx:   [u16]       // per-segment index into `layers`
    segment_entity_idx:  [u32]       // per-segment index into `entity_names`
    segment_dash_idx:    [u16]       // per-segment index into `dash_arrays`
    segment_dash_kind:   [u8]        // 0=solid 1=dashed 2=dotted 3=dash-dot

    triangles_q16:       bin         // 6 i16 LE / triangle
    triangle_color:      [u32]
    triangle_paper_bits: bin
    triangle_layer_idx:  [u16]
    triangle_entity_idx: [u32]
    triangle_kind:       [u8]        // 0=Solid, 1=TextFill

    // Dash table
    dash_arrays:    [[f64]]          // world-space LTYPE patterns;
                                     //   index 0 = empty (solid);
                                     //   pos = draw length, neg = gap, 0 = dot

    // Entities (parallel to entity_idx values)
    entity_names:    [String]                // human-readable per entity
    entity_text:     [EntityTextSparse]      // sparse, keyed by entity_idx
    entity_inserts:  [InsertRefSparse]       // sparse INSERT refs

    block_definitions: [BlockDef]
}
```

Sub-structs:

```text
LayoutDef { name: String, bbox: [f64; 4] }

LayerDefV2 { name: String, color: u32 }    // packed 0xAABBGGRR

EntityTextSparse {
    entity_idx:  u32
    raw:         String     // verbatim MTEXT / TEXT (formatting codes preserved)
    anchor:      [f64; 2]
    height:      f64
    rotation:    f64
    font_path:   String
    bold:        bool
    italic:      bool
    attachment:  u8
    text_kind:   u8         // 0=Text, 1=MText, 2=Attrib
}

InsertRefSparse {
    entity_idx:       u32
    block_name:       String
    insertion_point:  [f64; 2]
    scale:            [f64; 2]
    rotation:         f64    // radians
}

BlockDef {
    name:              String
    local_bbox:        [f64; 4]    // may be zero if not yet computed
    child_entity_idxs: [u32]       // optional, forward-compat
}
```

## Why "IFCDraw"

- **IFC** — interoperable with IFC4 schema concepts (Project / Site /
  Building / Storey). A future Revit / Bonsai plugin can map
  IFCDraw entities into IFC `IfcAnnotation`, `IfcGroup`,
  `IfcGeometricCurveSet` etc. without a translation layer.
- **Draw** — limited to drawing-plane (2D) geometry, no full 3D Brep
  yet. The wire is intentionally flat: world-space q16 segments +
  triangles, no nested geometric primitives.
- **B** is implicit — this is the **binary** variant (contrast with
  the IFCX JSON profile). The compressed form is typically 3-6x
  smaller than equivalent DXF on real CAD payloads.

No AutoCAD / Autodesk trademarks appear anywhere in the format spec
or generator string. The format is independent of any vendor
software.

## Quantisation

Coordinates are stored as little-endian `i16` deltas relative to the
scene bbox:

```text
inv_scale  = 65534.0 / (extent_max - extent_min).max(1e-6)
q          = round((coord - extent_min) * inv_scale) - 32767
clamped    = q.clamp(i16::MIN, i16::MAX) as i16

// reverse
scale      = (extent_max - extent_min) / 65534.0
coord      = extent_min + (q + 32767) * scale
```

65534 steps across the extent gives about 1.5 mm resolution on a
100 m drawing — finer than the 0.5-3 mm tessellation tolerance
`scene_io` already introduces. The 32767 centring keeps the value
range symmetric so signed-int arithmetic is transparent.

## Bit packing

`segment_paper_bits` and `triangle_paper_bits` are LE bitsets — one
bit per entity, byte 0 holds bits 0-7 with bit 0 in the LSB. The
length field is implicit from the count of segments/triangles in the
parallel arrays; a trailing partial byte is allowed.

## Backward compatibility

The reader path (`load_ifcdraw_scene`) decompresses the zstd layer
once, peeks the embedded version tag, and dispatches:

- v2 (`version == "0.4-2d-binary-ifcdraw"`) → `lower_v2`, full Scene
  reconstruction.
- v1 (`ifcx_version == "0.3-2d-binary"`) → `lower_v1`, geometry only.
  Triangle kind collapses to Solid, per-entity grouping uses the
  Entity index. Future `_q16d` delta-encoded payloads in v1 are
  skipped via forward-compat unknown-kind handling.

The legacy `read_ifcx_binary` accessor still works on v2 blobs by
synthesising a v1-shape envelope with empty `entities` — keeps
existing bench tooling (e.g. `ifcdraw-bench`'s roundtrip smoke test)
unchanged.

## Size considerations

v2 trades roughly 5-10% additional payload for full-fidelity round-
trip over v1. The parallel `Vec<u16>` / `Vec<u32>` arrays compress
extremely well under zstd because per-field correlation is high
(layer indices repeat, entity indices increase monotonically). On a
typical DWG corpus the v2 file is approximately the same size as the
v1 equivalent after compression. A separate effort (delta + varint
encoding for the coordinate buffer) is in flight on the v1 wire —
that work will land as new `Entity::kind` strings within v1, not a
v3 bump.

## Reader

See `kernel/crates/app/src/ifcx_export.rs`:

- `load_ifcdraw_scene(path) -> io::Result<Scene>` — fs-aware,
  auto-detects v1 vs v2.
- `load_ifcdraw_scene_from_bytes(bytes, path_hint) -> io::Result<Scene>`
  — same, byte-slice variant.
- `read_ifcdraw_v2(bytes) -> io::Result<BinaryIfcDraw>` — full v2
  envelope; errors on non-v2 input.
- `read_ifcx_binary(bytes) -> io::Result<BinaryIfcx>` — legacy v1
  decoder; v2 blobs fall back to a synthetic envelope so callers
  that only check counts keep working.

## Fields newly preserved in v2 vs v1

- per-segment `entity_idx` mapping (segments cluster back to source
  entities — essential for the Properties panel and a future
  Revit-Group emitter)
- per-segment dash index + kind, plus the full LINETYPE pattern table
  (`dash_arrays`)
- per-triangle `entity_idx` + kind (`Solid` vs `TextFill`)
- `entity_names` (per-entity human-readable description: "LINE",
  "MTEXT", "HATCH", `INSERT "FOO"`, "DIMENSION", ...)
- raw `EntityText` (verbatim MTEXT formatting codes, anchor, height,
  rotation, font_path, bold/italic, attachment, kind)
- INSERT references (`entity_inserts`) with block_name + transform
  placeholder
- BLOCK definitions (`block_definitions`) — name + local bbox +
  child entity_idx mapping
- named LAYOUT extents (`layouts` — Model + Sheets) with full
  per-layout bounding box
- explicit `source_kind` enum (dxf/dwg/ifcdraw-roundtrip/other)
- per-blob `generator` string for forensics
