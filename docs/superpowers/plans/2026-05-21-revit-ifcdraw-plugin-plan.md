# Revit IFCDraw Importer Plugin — Plan

Status: **Planned, NOT implemented**
Companion spec: `docs/superpowers/specs/2026-05-21-ifcdraw-binary-format.md`
Plugin name: `Open2D.IFCDrawImporter`
Target Revit versions: **Revit 2024, 2025** (.NET 4.8)

## Goal

Read an `.ifcdraw` v2 file produced by Open 2D Studio and reconstruct
its contents inside a Revit document as native Revit annotation
geometry. Lets the user round-trip a DWG/DXF drawing through Open 2D
Studio (for parsing, cleanup, archival) and import it into Revit
without losing layer structure, INSERT blocks, dash patterns, or
MTEXT formatting.

## Stack

| Concern                | Choice                                   |
|------------------------|------------------------------------------|
| Plugin language        | C# (.NET Framework 4.8 — Revit constraint) |
| Project layout         | dotnet sdk-style csproj                  |
| msgpack decoder        | `MessagePack-CSharp` (8.x)               |
| zstd decoder           | `ZstdNet` (1.4+) or `zstdsharp`          |
| Revit API entry point  | `IExternalCommand` + `Application.OnStartup` |
| UI                     | Ribbon button (Add-Ins tab) + file picker via `Microsoft.Win32.OpenFileDialog` |

## Project skeleton

```
Open2D.IFCDrawImporter/
├── Open2D.IFCDrawImporter.csproj    // .NET Framework 4.8, refs RevitAPI.dll + RevitAPIUI.dll
├── Open2D.addin                     // Revit add-in manifest
├── Properties/AssemblyInfo.cs
├── Resources/Icon32.png
├── Model/
│   ├── BinaryIfcDraw.cs             // msgpack DTO mirroring the Rust struct
│   ├── EntityText.cs
│   ├── InsertRef.cs
│   ├── BlockDef.cs
│   └── Quantiser.cs                 // i16 ↔ world-coord helpers
├── Import/
│   ├── IfcDrawReader.cs             // zstd → msgpack → BinaryIfcDraw
│   ├── SceneImporter.cs             // BinaryIfcDraw → Revit document
│   ├── LayerToFilterMapper.cs       // per-layer View Filters + color overrides
│   ├── EntityRebuilder.cs           // segments_q16 → DetailLine, MTEXT → TextNote
│   └── BlockGroupBuilder.cs         // entity_inserts → Revit Group
└── Commands/
    └── ImportIfcDrawCommand.cs      // [Transaction(TransactionMode.Manual)] entry point
```

## Mapping table

| IFCDraw v2 source         | Revit target                                    | Notes |
|---------------------------|-------------------------------------------------|-------|
| `segments_q16` + layer    | `DetailLine` on the active view's `DetailLevel` | Use `Document.Create.NewDetailCurve` with a `Line.CreateBound(p1, p2)` curve. The active drafting view is the import target — let the user pick it on import. |
| `triangles_q16` (Solid)   | `FilledRegion` from a `CurveLoop` boundary       | Group neighbouring triangles by entity_idx, walk the boundary, emit one `FilledRegion`. |
| `triangles_q16` (TextFill)| Skipped — text fills are re-emitted by the MTEXT path | TTF glyph fills are an artifact of scene_io tessellation; the source text is preserved separately. |
| `entity_text` (TextKind = Text/MText/Attrib) | `TextNote` via `TextNote.Create` | Strip MTEXT formatting codes (`\fArial|b1;`) and recreate via `TextNoteOptions` — bold/italic/font_path become a new `TextNoteType`. |
| `entity_inserts` + matching `block_definitions` | Revit `Group` | Create one `GroupType` per `BlockDef`, instantiate via `Document.Create.NewGroup` at each `InsertRef.insertion_point`. |
| `layer_names` + `layer_colors` | `ParameterFilterElement` + `OverrideGraphicSettings` per layer | One filter per layer, attached to the active view, with the source ARGB mapped to the filter's projection line color. |
| `dash_arrays` + `segment_dash_idx` | `LinePatternElement` | One `LinePatternElement` per non-solid dash pattern (CENTER, HIDDEN, DASHED, ...). Mapped to detail-line subcategory or to the layer's view-filter override. |
| `layouts` (Model, Sheet 1, ...) | Multiple Revit `View` targets | Each named layout maps to a separate `ViewDrafting`. The user chooses on import: single-view (Model only), all-views (one drafting view per layout). |
| `bbox`                    | View extents on import                          | Used to zoom the active view to fit after import. |

## Workflow

```text
1. User clicks "Import IFCDraw" on the Add-Ins ribbon.
2. OpenFileDialog → pick a .ifcdraw file.
3. IfcDrawReader.Read(path):
   - File.ReadAllBytes
   - ZstdNet.Decompressor.Unwrap
   - MessagePackSerializer.Deserialize<BinaryIfcDraw>
   - Version check — bail with a clear error if `version` ≠ "0.4-2d-binary-ifcdraw"
4. SceneImporter.Import(blob, doc):
   - Open a Revit Transaction "Import IFCDraw"
   - For each layer → create View Filter + OverrideGraphicSettings
   - For each dash_array → create LinePatternElement
   - For each segment → emit DetailLine into the active view
     (skip segments whose entity_idx maps to a TextKind text entity —
      those are rendered by the MTEXT path)
   - For each EntityTextSparse → emit TextNote
   - For each BlockDef → create GroupType from its child segments
   - For each InsertRefSparse → instantiate the GroupType at
     insertion_point (transform applied at instance time)
   - Commit the transaction
5. Show a summary dialog: counts, filename, target view name.
```

## Estimated effort

- Skeleton + msgpack DTO classes: **2-3 days**
- DetailLine + FilledRegion emitter (most painful — Revit DetailLine
  requires a `CurveLoop` per region, and we need to thread layer
  filters via subcategories): **3-4 days**
- MTEXT → TextNote with formatting code parsing: **2 days**
- INSERT → Group with transform: **1-2 days**
- Layer → View Filter + LinePatternElement: **2 days**
- Polish + dialogs + error reporting + ship: **2 days**

**Total: ~2 weeks of dedicated dev work.**

## Pre-requisites

- Revit API license (Autodesk Developer Network — free for testing,
  paid for commercial distribution).
- Revit 2024 or 2025 installed locally.
- A real `.ifcdraw` v2 file with realistic content (segments,
  triangles, MTEXT, INSERTs, multiple layers, multiple layouts) for
  test fixtures. Open 2D Studio's "Save As IFCDraw" produces these.

## Out of scope (v1 of the plugin)

- 3D Brep — IFCDraw is 2D only; if/when v3 of the format adds 3D
  geometry, the plugin can switch to `DirectShape` emission.
- DGN / IFC export from Revit — the plugin is import-only.
- Bidirectional editing — once imported, the Revit document is the
  source of truth; we don't track "this came from IFCDraw" metadata
  for re-export. A round-trip story would need a v3 schema bump on
  the IFCDraw side to carry Revit ElementId hints.
- Live "watch this .ifcdraw and re-import on change" — handy but
  trivially scriptable from outside; not worth the in-plugin
  complexity.

## Risks / open questions

1. **Revit DetailLine count cap.** Drawings with 600k+ segments may
   hit Revit's element-per-document ceiling. Mitigation: group
   short colinear segments into single Lines before emission; or
   refuse to import drawings above some threshold and surface a
   warning.
2. **Layer-as-Filter scaling.** Revit View Filters are slow when the
   count exceeds ~100 per view. Mitigation: collapse layers with
   identical color into the same filter; surface a per-layer
   "import as filter" checkbox.
3. **MTEXT formatting code preservation.** IFCDraw v2 stores the
   verbatim MTEXT string (`\fArial|b1;Hello`). Revit `TextNote`
   doesn't natively understand these codes; the plugin needs a
   small interpreter to translate font/bold/italic markers into
   `TextNoteType` selection.
4. **Transform precision for INSERTs.** v2 currently stores INSERT
   insertion_point as zeros (the Scene expands INSERTs at parse
   time, losing the original transform). The plugin will see those
   zeros and import each INSERT instance at world origin — wrong.
   We need a follow-up DWG/DXF loader pass that records the real
   INSERT transform on `Scene` *before* the importer is useful.
   This is tracked separately in the format v2 implementation
   notes.

## Status of this plan

- [x] Format spec frozen (v2)
- [x] IFCDraw writer ships in `kernel-app`
- [ ] DWG/DXF loader records full INSERT transforms (blocker — see
      Risk #4)
- [ ] Plugin project scaffolded
- [ ] msgpack DTO classes written
- [ ] DetailLine emitter
- [ ] MTEXT importer
- [ ] INSERT → Group importer
- [ ] Layer → View Filter mapper
- [ ] LinePatternElement mapper
- [ ] Ship to Autodesk App Store (or in-house distribution)

The plugin is **not on the current sprint** — the IFCDraw writer
landed today, and the immediate priority is bringing the v2 file
size below the source DWG (separate effort). The plugin work starts
once the format is byte-stable and we have a reference set of
`.ifcdraw` files to test against.
