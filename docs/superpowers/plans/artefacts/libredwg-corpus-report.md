# LibreDWG corpus baseline + per-version triage

**Date:** 2026-05-05  
**Branch:** merge-1.0-2.0  
**Corpus:** `C:\Users\rickd\Desktop\dwg_samples\libredwg-testdata\test\test-data\` (LibreDWG official testdata, 141 DWGs + 69 DXFs across 15 AutoCAD version folders).  
**Renderer:** `kernel/target/release/headless-render.exe` @ 1024x1024.  
**Sampling:** up to 3 representative pairs per version-folder (preferring DWG+DXF same-basename pairs, falling back to DWG-only or DXF-only when no full pair exists).  
**Script:** `scripts/corpus_libredwg_render.ps1`

## Phase-1 baseline results

15 versions probed, 45 PNGs produced (24 DWG + 21 DXF). Outputs live under
`docs/superpowers/plans/artefacts/corpus-renders-libredwg/<version>/<basename>.<dwg|dxf>.png`,
each accompanied by a `.log` with stderr tail (parser timings, layer counts,
entity-type histogram, p90-filter outcome).

### DWG parse status per version

| Version | Magic   | DWG parse outcome          | Note |
|---------|---------|----------------------------|------|
| R1.4    | MC0.0 / AC1.40 | rejected — Unsupported version code | pre-AC1006 era, no DWG bit-stream layout |
| R2.6    | AC1003  | rejected — Unsupported version code | same |
| R2.10   | AC1.50 / AC2.10 | rejected — Unsupported version code | same |
| R9      | AC1004  | rejected — Unsupported version code | early DWG, simple structure but not in version map |
| R10     | AC1006  | rejected — Unsupported version code | introduced object-map; still unsupported here |
| R11     | AC1009  | rejected — Unsupported version code | R12 also AC1009 |
| R12     | (no DWGs in folder) | n/a — only DXF samples | |
| R13     | AC1012  | (no DWGs in folder) | only AC1012 DXF |
| R14     | AC1014  | accepted but **decoder regression** — most files yield 0 segments and corrupted layer-name strings | string-codec misaligns bit stream |
| 2000    | AC1015  | mostly OK (TS1.dwg → 8657 segs); a few yield 0 segs (PolyLine3D.dwg) | partial entity-type coverage |
| 2004    | AC1018  | mostly broken (Constraints/material → 0 segs); Leader OK | page-based section reader missing branches |
| 2007    | AC1021  | broken — single-entity-type files render empty (Polyline.dwg, RAY.dwg → 0 segs) | string-stream or section-locator gap |
| 2010    | AC1024  | OK (gh209_1.dwg → 3192 segs, Constraints → 65) | best-supported pre-2018 path |
| 2013    | AC1027  | OK (gh109_1.dwg → 64588 segs) | |
| 2018    | AC1032  | OK (LiveSection1.dwg → 1035 segs) | |

### Per-pair triage table (from `*.log` files)

| version/basename | DWG segs | DXF parse | Tag |
|---|---:|---|---|
| r1.4/entities | parse-fail (AC1.40) | OK | dwg-pre-r12-not-supported |
| r2.6/dim, entities | parse-fail (AC1003) | OK | dwg-pre-r12-not-supported |
| r2.10/block, entities | parse-fail (AC2.10) | OK | dwg-pre-r12-not-supported |
| r9/entities | parse-fail (AC1004) | OK | dwg-pre-r12-not-supported |
| r10/tmp_line, entities | parse-fail (AC1006) | OK | dwg-pre-r12-not-supported |
| r11/entities-2d, entities-3d, ACEB10 | parse-fail (AC1009) | OK | dwg-pre-r12-not-supported |
| r12/Leader, Constraints | (no DWG) | OK | dxf-only |
| r13/v | (no DWG) | OK | dxf-only |
| r14/Leader | 51 | (no DXF) | r14-partial |
| r14/Constraints | **0** | OK | r14-zero-segs (decoder regression) |
| r14/v | **0** | (no DXF) | r14-zero-segs (mangled layer names) |
| 2000/TS1 | 8657 | OK | OK |
| 2000/Leader | 104 | OK | OK |
| 2000/PolyLine3D | **0** | OK | r2000-polyline3d-zero-segs |
| 2004/Leader | 52 | OK | OK |
| 2004/Constraints | **0** | OK | r2004-zero-segs |
| 2004/material | **0** | OK | r2004-zero-segs |
| 2007/Donut | 100 | OK | OK |
| 2007/Polyline | **0** | OK | r2007-polyline-zero-segs |
| 2007/RAY | **0** | OK | r2007-ray-zero-segs |
| 2010/Constraints | 65 | OK | OK |
| 2010/Leader | 107 | OK | OK |
| 2010/gh209_1 | 3192 | (no DXF) | OK |
| 2013/Constraints | 65 | OK | OK |
| 2013/Leader | 104 | OK | OK |
| 2013/gh109_1 | 64588 | OK | OK |
| 2018/Constraints | 65 | OK | OK |
| 2018/Leader | 104 | OK | OK |
| 2018/LiveSection1 | 1035 | (no DXF) | OK |

### Defect class buckets

1. **dwg-pre-r12-not-supported** (12 files across r1.4..r11) — version-code map
   stops at AC1012/R13. Even a well-structured pre-AC1006 file is rejected at
   `DwgParser::parse` line 329 (`Unsupported DWG version code: ...`).

2. **r14-zero-segs / mangled layer-name strings** (Constraints, v) — R14 string
   decoder reads variable-length text the same way as R2000 but the
   length-encoding rules differ (per ODA §5.7: R13–R2000 strings are TV
   length-prefixed bytes in the codepage; R14 maintains that contract but the
   header text-style sub-stream alignment is different). The decoder leaks
   bit-stream offset into the next entity, leaving the entity loop reading
   garbage opcodes → 0 segments emitted.

3. **r2004-zero-segs** (Constraints, material) — R2004 page-based decompression
   path falls back to `parse_r2010_plus`. The fallback succeeds in producing
   objects but the entity walk yields 0 segments — class-map mismatch (R2004
   class numbers shift by class-code-page).

4. **r2007-zero-segs on single-type files** (Polyline, RAY) — R2007 string
   stream is set up only when the section-classes table is fully decoded.
   Files with no LAYER table (`0 total LAYERs`) skip the setup and decode
   entity bodies without the stream → 0 verts.

5. **dxf-grey-screen** (user report) — NOT reproduced in headless render. Every
   inspected DXF in the corpus produces at least sparse content over the
   default black BG. The "grey screen" the user observed in the GUI is most
   likely paper-space being the default tab (clear color 0.95,0.95,0.95 in
   `bin/open_2d_studio.rs:4183`) combined with a model-only file having no
   paper-space viewports → render target stays solid light grey. Tracked
   separately.

## Phase-1 commit

Baseline renders + this triage doc are committed in:
- `docs(libredwg-corpus): baseline renders + per-version triage (45 PNGs across 15 versions)`

## Plan (Phases 3–5)

| Priority | Defect           | Hypothesis                  | Files to touch |
|---------:|------------------|-----------------------------|----------------|
| 1        | pre-R12 stub     | recognise AC1.40/AC1003/AC2.10/AC1004/AC1006/AC1009 magic + return clean "not yet implemented" diagnostic instead of "Unsupported DWG version code: …" panic-string. | `src-tauri/dwg-parser/parser.rs` (VERSION_MAP, DwgVersion enum) |
| 2        | r14-zero-segs    | R14 entity sentinel-walk bug | `parser.rs::parse_r13_r14` |
| 3        | r2004 fallback   | post-fallback class-map fix  | `parser.rs::parse_r2004` |
| 4        | r2007 single-type | string-stream guard          | `r2007.rs` |

This report will be expanded as fixes land.
