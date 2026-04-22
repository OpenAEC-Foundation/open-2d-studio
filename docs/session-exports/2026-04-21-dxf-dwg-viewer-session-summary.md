# Open 2D Studio — DXF/DWG viewer session (2026-04-21)

Raw transcript: `2026-04-21-dxf-dwg-viewer-session.jsonl` (80 MB)

## Overview

Marathon session. Went from a 4-pane dev-comparison tool to a browser-style
tabbed CAD viewer with split-views, polished ribbon, IFC/DXF export, whole-
entity selection, drag-and-drop Move, and a deeply rebuilt clean-room
R2010+ DWG parser.

## Landed (chronological)

### Viewer UI
- Browser-style file tabs (×/+/Ctrl+W/Ctrl+Tab) replacing 4-pane grid
- Tiled split views (Ctrl+Shift+H/V/S) per tab
- Ribbon v1 → v2 → v3 (TrueView-inspired, custom painter-drawn icons,
  flat-color palette, 6 consolidated groups Files/Tools/Measure/View/
  Layout/Help)
- Status bar (coords / zoom / tool / layer count)
- Side-panel headers with close chevron (Layers F3, Properties F4,
  Samples F2)
- Canvas inset hairline frame
- Custom 64×64 window/taskbar icon
- Pan/zoom: 2× factor fix in `world_per_pixel` + coarser zoom step

### Editing
- **Select tool**: LMB pick via pane-latch, whole-entity highlight
  (magenta) on DXF & DWG
- **Measure tool**: 2-click distance readout on ribbon
- **Annotate → Dim**: persistent linear dimension (parallel-to-line
  label + upright flip)
- **Annotate → Area**: polygon shoelace with label at centroid
- **Move tool**: drag + magenta preview + Ctrl+Z undo (10 deep)

### DXF rendering
- HATCH arc-edge Y-mirror (is_ccw=0) — rescued 60+ hatches
- LWPOLYLINE closing-edge + bulge → arc tessellation
- Special chars: `\U+XXXX` Unicode escape, `%%c/d/p`, `.notdef` skip
- MTEXT multi-line `\n/\r\n` with 5/3 cap-height spacing
- Sheet paper-space heuristic (NLRS_* prefix for Revit-flattened sheets)
- Block-internal HATCH via INSERT expansion
- Text fills always on (no LOD cutoff)
- Arc Y-mirror for HATCH boundaries

### DWG parser (clean-room per ODA OpenDesignSpec)
- HANDLES §26.5 sub-section delta reset — unlocked 1000+ objects
- DIMENSION §19.4.27 missing fields (class_version, flip_arrow1/2,
  clone_ins_pt 2RD) — ~131 bits of drift resolved
- VIEWPORT §19.4.61 viewHeight + viewCenter + frontClip/backClip fields +
  paper-space projection pipeline (+162K segs on Funderingsherstel paper)
- HATCH pattern-line §19.4.96: angle radians→degrees + 2RD→2BD (+mirror)
- HATCH solid fills (ear-clip + Z-pattern for SOLID arm)
- SOLID §19.4.127 Z-pattern fill triangulation
- Classes BL→BS trailer fix
- Color + linetype parity: ACI/trueColor/BYLAYER/BYBLOCK per §20.4.1,
  11 builtin dash patterns, entity ltype_scale × $LTSCALE chain
- Text pipeline: fills via reusable `fill_glyph_contours`, STYLE resolve
  via textStyleHandle, bold/italic (`_B`/`_I`/`_B_I` suffix + MTEXT
  inline `\fName|bN|iM`)
- Entity-group idx per parsed object → per-entity selection
- Paper-space tagging via entmode==1 || owner ∈ *Paper_Space handles
- Layer idx plumbing (real layer names + per-entity layer tag)
- LWPOLYLINE bulges (parser already emitted them, consumer wired)
- MTEXT rotation from x_axis_dir (ODA §20.4.46)
- MTEXT attachment field-name mismatch fix
- TEXT 72/73 horizontal/vertical justification
- Dim-label rotation derived from dimRotation / extPair atan2 when
  textRotation=0, with upright-flip (cos<0 → +π)

### Export
- IFC 2D B binary export (MessagePack + zstd-19 + i16 quantization);
  honest finding: 8× larger than source DWG because our Scene is
  already tessellated (every circle = 16 line segments vs analytical
  16-byte DWG form)
- DXF R2013 textual export with triple Open-2D-Studio producer tags
  (`999` comment + `$PROJECTNAME` + `$LASTSAVEDBY`)

## Deliberately deferred

- Full DWG binary write (weeks of encoder work)
- IFC entity-level export (needs Scene.source_entities field)
- viewTwist, frozen layers per VP, non-rect VP clipping
- DIMSTYLE (DIMTXT/DIMEXO/DIMEXE) plumbing
- `*D<N>` dim-block hard-pointer link for perfect arrow styles
- LTYPE R2010+ common-header bit-drift
- BYLAYER linetype inheritance (parse_layer_obj doesn't read ltype handle)
- `$DWGCODEPAGE ANSI_1252` for non-UTF-8 DXFs
- DWG ANG2LN / ANG3PT / RADIUS / DIAMETER dim subtypes

## Known open issues at session end

- DWG entity color ACI=1 → pinkish-purple (0xFFEDAED1) instead of red —
  `parse_layer_obj` color-field bit-drift suspected, agent respawned
- Selection tool user-reported broken; diagnostic eprintlns in place
  awaiting user test output

## Files touched (summary)

- `kernel/crates/app/src/scene_io.rs` (~5000 lines) — DXF + DWG loaders
- `kernel/crates/app/src/bin/split_compare.rs` (~3500 lines) — viewer
- `kernel/crates/app/src/ttf_font.rs` — glyph cache + per-glyph
  tessellation + Unicode escape handling
- `kernel/crates/app/src/dxf_export.rs` (new) — DXF R2013 writer
- `kernel/crates/app/src/ifcx_export.rs` (new) — IFCX binary (MessagePack)
- `src-tauri/dwg-parser/parser.rs` — clean-room DWG body decoders
- `src-tauri/dwg-parser/r2007.rs` — section map / page map / LZ77
- `src-tauri/dwg-parser/SPEC_NOTES.md` — §18 … §31 session log with ODA
  citations
- `src-tauri/dwg-parser/examples/*.rs` — diagnostic binaries
  (plaintext_search, scan_all_pages, inspect_handles, dump_hatch_pat, …)

## Agent count

~40 background agents spawned, predominantly `general-purpose`, one each
of `claude-code-guide`, `Plan`, `superpowers:brainstorming`,
`superpowers:systematic-debugging`.

## Fixture corpus

All work validated against:
- `C:\Users\rickd\Desktop\dwg_samples\3bm-trainingset\2705_model
  Funderingsherstel - Constructie - Sheet - CP-21 - Constructietekening.{dxf,dwg}`
  (production floor-plan, 15717 DXF lines)
- `C:\Users\rickd\Desktop\dwg_samples\3bm-trainingset\arceringen test\
  3070_model - Legend - M(--)01_arceringen_5.{dxf,dwg}`
  (pattern-hatch legend, 675 DXF lines / 169 hatches / 88 MTEXTs —
   DWG parses 1:1 exact)
