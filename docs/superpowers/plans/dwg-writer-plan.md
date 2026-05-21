# Open 2D DWG Writer — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. **All work is clean-room from the ODA OpenDesignSpec. NO LibreDWG / Teigha source may be consulted.**

**Goal:** Implement a binary AutoCAD DWG writer in `kernel/crates/dxf-import` (existing crate, despite the name — it also owns the DWG parser) so that Open 2D Studio can persist its scenes as fully-roundtrippable DWG files alongside the existing DXF output. Target version: **R2010 (`AC1024`)** for the first ship — the simplest modern format readable by every AutoCAD release from 2010 onward and by every major third-party viewer.

**Architecture:** Pure-data writer with NO UI / GPU coupling. The entry point is a single `write_dwg_r2010(scene: &Scene, out: impl Write) -> io::Result<()>` function that mirrors the existing `write_dxf_filtered` signature. Internally the writer walks the ODA spec's section list (File Header → Header Vars → Class Definitions → Object Map → Page Map → Sections → Object Data → CRC tail) and emits each in turn.

**Tech Stack:** Rust 1.77+, no new heavy deps. We already have `byteorder` (in the parser); BC1 / BC2 / CRC8 / CRC32 will live in a fresh `crc.rs` module. No FFI, no LibreDWG, no Teigha.

**Hard constraint:** Even the smallest scene must produce a DWG that AutoCAD 2010+ opens **without warning dialogs**. This means valid CRC chains, valid handle table, valid object map, valid page map, AND a generator string that does NOT claim Autodesk authorship (see Phase 1 spec below).

---

## User-approved decisions

1. First ship targets **R2010 (`AC1024`)** only. Later phases add R14 / R2000 / R2013 / R2018 if user demand surfaces.
2. Writer lives in the existing `kernel/crates/dxf-import` crate (which already owns the DWG parser). Module path: `dxf_import::dwg::writer`.
3. We will NOT implement encrypted ("password protected") DWG output. The spec section on encryption is intentionally out of scope.
4. Generator-string format is fixed: `"Open 2D Studio v{CARGO_PKG_VERSION}"`. Versioned so future readers can detect the writer revision.
5. While the writer is in development, the user-facing "Save As DWG..." button surfaces an explanatory modal and routes to the DXF fallback. The modal stays in place until **Phase 6** (final verification) lands.

---

## Repository context

Working dir: `C:\Users\rickd\Documents\GitHub\open-2d-studio`
Branch: `open-2d-viewer`

Existing files of interest:

- `kernel/crates/dxf-import/src/dwg/parser.rs` — DWG **parser** (read-only). We will mirror its section layout but in the writer direction.
- `kernel/crates/dxf-import/src/dwg/header.rs` — file-header struct + magic-code mapping.
- `kernel/crates/app/src/scene_io.rs` — `Scene` struct the writer consumes.
- `kernel/crates/app/src/dxf_export.rs` — text DXF writer; the function signature + 999 generator comment lives here as a reference for the binary writer's metadata layout.
- `docs/superpowers/plans/2026-04-22-open2d-merge-slice1-plan.md` — historical merge plan; mentions DWG-parser parity gaps that the writer must NOT inherit.
- `kernel/Cargo.toml` — workspace manifest.

ODA OpenDesignSpec reference: https://www.opendesign.com/files/guestdownloads/OpenDesign_Specification_for_.dwg_files.pdf (latest revision as of plan date). Cite the **section number** in every commit message and code comment that implements a binary layout step.

---

## File structure overview

| File | What this plan creates/changes |
|------|-------------------------------|
| `kernel/crates/dxf-import/src/dwg/writer/mod.rs` | New — public entry: `write_dwg_r2010` |
| `kernel/crates/dxf-import/src/dwg/writer/file_header.rs` | New — File Header section (ODA §4.1) |
| `kernel/crates/dxf-import/src/dwg/writer/header_vars.rs` | New — Header Variables section (ODA §4.2) |
| `kernel/crates/dxf-import/src/dwg/writer/classes.rs` | New — Class Definition section (ODA §4.3) |
| `kernel/crates/dxf-import/src/dwg/writer/object_map.rs` | New — Object Map / handle table (ODA §4.5) |
| `kernel/crates/dxf-import/src/dwg/writer/page_map.rs` | New — Page Map / R2004+ section table (ODA §4.4) |
| `kernel/crates/dxf-import/src/dwg/writer/entity.rs` | New — per-entity body encoders (LINE, CIRCLE, ARC, LWPOLYLINE, MTEXT, INSERT, etc.) |
| `kernel/crates/dxf-import/src/dwg/writer/encoded.rs` | New — bitstream encoding primitives (BC1 / BC2 / BD / BL / RC / RD) |
| `kernel/crates/dxf-import/src/dwg/writer/crc.rs` | New — CRC-8 / CRC-32 helpers for section + page checksums |
| `kernel/crates/dxf-import/src/dwg/writer/generator.rs` | New — generator-string emission (legal-safe metadata) |
| `kernel/crates/app/src/studio_app.rs` | Edit — replace the Save-As-DWG modal with a direct write path once Phase 6 lands |
| `kernel/crates/dxf-import/Cargo.toml` | Edit — add the new module tree to lib.rs |
| `kernel/crates/dxf-import/src/lib.rs` | Edit — re-export `dwg::writer::write_dwg_r2010` |

Estimated LOC: **~3500-4500 lines**, all in new files. Roughly twice the parser's complexity because writing needs explicit alignment + CRC management that the parser can leave to per-record fix-ups.

---

## Staged work plan

The implementation is split into six phases, each landing as one atomic commit (subject prefix: `feat(dwg-writer):`). Phases 1-5 are read/encode work that can ship behind the modal stub; Phase 6 replaces the stub with the real save path.

### Phase 1 — Bitstream primitives + generator metadata
*Estimated effort: 1 week. Risk: low — pure encode logic, fully unit-testable.*

- [ ] Task 1.1: New module `kernel/crates/dxf-import/src/dwg/writer/encoded.rs`. Implement DWG bitstream encoders mirroring the parser's decoders:
  - `write_bc1(value: u8)` — 1-bit packed.
  - `write_bc2(value: u8)` — 2-bit packed.
  - `write_bd(value: f64)` — bit-double; uses sentinel for 0.0 / 1.0.
  - `write_bl(value: u32)` — bit-long; 2-bit prefix selects 7 / 15 / 32-bit body.
  - `write_rc(value: u8)`, `write_rd(value: f64)` — raw byte + raw double (LE).
  - `write_t(value: &str)` — null-terminated ASCII string (R2010 uses 8-bit codepage).
  - `BitWriter` struct that buffers a `Vec<u8>` + bit cursor; flushes pad bits on `finish()`.
- [ ] Task 1.2: Unit tests. For each encoder, verify the parser's matching decoder returns the original value. This is the round-trip foundation everything else depends on.
- [ ] Task 1.3: New module `kernel/crates/dxf-import/src/dwg/writer/crc.rs`. Implement CRC-8 (polynomial `0x07`) and CRC-32 (polynomial `0xEDB88320`) helpers exactly as the parser uses them. Cite ODA §3.4.
- [ ] Task 1.4: New module `kernel/crates/dxf-import/src/dwg/writer/generator.rs`. Emit the metadata header block:
  ```text
  Open 2D Studio v{CARGO_PKG_VERSION}
  Clean-room implementation -- not affiliated with Autodesk
  https://github.com/OpenAEC-Foundation/open-2d-studio
  ```
  This string lives in the file's File Header "comment" region (immediately after the `AC1024` magic, before the section table). Write tests asserting the string is NEVER changed without a version bump.
- [ ] Task 1.5: Commit `feat(dwg-writer): bitstream primitives + generator metadata (ODA §3.4)`.

### Phase 2 — File Header + Page Map
*Estimated effort: 1.5 weeks. Risk: medium — header layout is rigid and many fields default to constants that AutoCAD's reader silently rejects when wrong.*

- [ ] Task 2.1: `file_header.rs`. Emit the 6-byte magic `AC1024`, then the 11-byte zero-pad, then the maintenance release byte (`0x0F` for R2010 SP1+), then the 4-byte preview-image address (set to 0 = no preview), then the 1-byte app-version DWG counter, then the 1-byte release counter, then the codepage (2 bytes, default `0x0036` ANSI_1252), then a 4-byte zero pad, then the 4-byte security flags (`0x00000000` = no encryption, no signing). Cite ODA §4.1.
- [ ] Task 2.2: `page_map.rs`. R2004+ DWGs route everything through a section/page table. Emit the page map header (page count, section count) then per-page records: { size, offset, section-id }. We start with three pages — { header vars, classes, object data }. Cite ODA §4.4.
- [ ] Task 2.3: Embed the generator metadata string in the file-header comment region (ODA §4.1 last paragraph).
- [ ] Task 2.4: Round-trip test: write a minimal scene (just one LINE on layer 0), parse it back with the existing parser, assert the LINE survives.
- [ ] Task 2.5: Commit `feat(dwg-writer): R2010 file header + page map (ODA §4.1, §4.4)`.

### Phase 3 — Header Variables + Class Definitions
*Estimated effort: 1 week. Risk: medium — Header Vars carries hundreds of fields; we only need the subset AutoCAD actually requires.*

- [ ] Task 3.1: `header_vars.rs`. Emit the Header Variables section. The minimum set R2010 requires:
  - `$ANGBASE`, `$ANGDIR`, `$ATTMODE`, `$AUNITS`, `$AUPREC`
  - `$CECOLOR`, `$CELTSCALE`, `$CELTYPE`, `$CELWEIGHT`, `$CHAMFERA`-`$CHAMFERD`
  - `$CLAYER` (defaults to "0"), `$CMLJUST`, `$CMLSCALE`, `$CMLSTYLE`
  - `$DIMASZ`, `$DIMCEN`, `$DIMSCALE`, `$DIMSTYLE`, `$DIMTOFL`, `$DIMTOL`
  - `$DRAGMODE`, `$DWGCODEPAGE` (default 0x0036), `$ELEVATION`
  - `$EXTMIN`, `$EXTMAX` (computed from `scene.bbox`)
  - `$FACETRES`, `$FILLMODE`, `$FRONTZ`, `$GRIDMODE`, `$INSBASE`
  - `$INSUNITS` (0 = unitless), `$LIMMIN`, `$LIMMAX`, `$LTSCALE`
  - `$LUNITS` (default 2 = decimal), `$LUPREC` (default 4)
  - `$ORTHOMODE`, `$PDMODE`, `$PDSIZE`, `$PELEVATION`, `$PEXTMIN`, `$PEXTMAX`
  - `$PINSBASE`, `$PLIMMIN`, `$PLIMMAX`, `$PLINEGEN`, `$PSLTSCALE`
  - `$QTEXTMODE`, `$REGENMODE`, `$SHADEDGE`, `$SHADEDIF`, `$SKETCHINC`
  - `$SKPOLY`, `$SNAPANG`, `$SNAPBASE`, `$SNAPISOPAIR`, `$SNAPMODE`
  - `$SNAPSTYLE`, `$SNAPUNIT`, `$SPLFRAME`, `$SPLINESEGS`, `$SPLINETYPE`
  - `$SURFTAB1`, `$SURFTAB2`, `$SURFTYPE`, `$SURFU`, `$SURFV`
  - `$TDCREATE`, `$TDUPDATE` (Julian-day-fraction of `SystemTime::now()`)
  - `$TEXTSIZE`, `$TEXTSTYLE`, `$THICKNESS`, `$TILEMODE`, `$TRACEWID`
  - `$UCSNAME`, `$UCSORG`, `$UCSXDIR`, `$UCSYDIR`, `$UNITMODE`
  - `$USERI1`-`$USERI5`, `$USERR1`-`$USERR5`, `$USRTIMER`
  - `$VISRETAIN`, `$WORLDVIEW`
  Cite ODA §4.2. Each var has a fixed group code + value type; cross-check against the parser's reader to ensure types match.
- [ ] Task 3.2: `classes.rs`. Emit the minimal class-definition list: AcDbDictionaryWithDefault, AcDbDictionaryVar, AcDbHatch, AcDbLayout (for paper space), AcDbPlaceHolder, AcDbPlotSettings, AcDbProxyEntity, AcDbXrecord. R2010 reader rejects the file if any required class is missing. Cite ODA §4.3.
- [ ] Task 3.3: Round-trip test: write a scene with bbox `[(-100, -100), (100, 100)]`, parse it, assert `$EXTMIN` and `$EXTMAX` match within 1e-6.
- [ ] Task 3.4: Commit `feat(dwg-writer): header variables + class definitions (ODA §4.2, §4.3)`.

### Phase 4 — Object Map / Handle Table
*Estimated effort: 1 week. Risk: high — the handle table is the cross-reference index for every entity in the file. A broken handle = AutoCAD "Drawing recovery" dialog.*

- [ ] Task 4.1: `object_map.rs`. Build a `HandleAllocator`:
  - Reserved handles: 1 = block table, 2 = layer table, 3 = style table, 4 = ltype table, 5 = view table, 6 = ucs table, 7 = vport table, 8 = appid table, 9 = dimstyle table, 0xA = vport entity header.
  - Tab-id allocation starts at `0x20` (matches the parser's expectation).
- [ ] Task 4.2: Walk the scene's parallel arrays once, assigning a handle per entity. Build the object-map records: { handle, offset, size }. Offsets are computed AFTER the entity bodies are encoded (Phase 5) so this step buffers a placeholder map and back-patches in Phase 6.
- [ ] Task 4.3: Layer table: every `scene.layer_names[i]` becomes one AcDbLayerTableRecord with handle `0x10 + i`. ByLayer color references the index.
- [ ] Task 4.4: LType table: every `scene.dash_arrays[i]` becomes one AcDbLinetypeTableRecord. Index 0 is hard-coded as `CONTINUOUS`.
- [ ] Task 4.5: Round-trip test: write a scene with 5 layers and 3 linetypes; parse it back; assert the layer + linetype tables match name-for-name.
- [ ] Task 4.6: Commit `feat(dwg-writer): object map + layer/ltype tables (ODA §4.5)`.

### Phase 5 — Entity body encoders
*Estimated effort: 2-3 weeks. Risk: high — every entity type has its own bit layout. The full list is ~40 types but we ship with the seven the parser supports today.*

- [ ] Task 5.1: `entity.rs::encode_line`. AcDbLine = 2 BD points + extrusion BE + thickness BD. Cite ODA §19.4.1.
- [ ] Task 5.2: `entity.rs::encode_circle`. AcDbCircle = center BD3, radius BD, extrusion BE. Cite ODA §19.4.7.
- [ ] Task 5.3: `entity.rs::encode_arc`. AcDbArc = circle + start-angle BD + end-angle BD. Cite ODA §19.4.8.
- [ ] Task 5.4: `entity.rs::encode_lwpolyline`. AcDbPolyline2D = flags BC2 + count BL + per-vertex { x BD, y BD, bulge BD, start-width BD, end-width BD }. Cite ODA §19.4.20.
- [ ] Task 5.5: `entity.rs::encode_text` / `encode_mtext`. The scene's `entity_text` array carries the source-text Open 2D preserved on load — we just hand it back to the writer. Style references go through the style-table handles allocated in Phase 4. Cite ODA §19.4.30 / §19.4.31.
- [ ] Task 5.6: `entity.rs::encode_solid`. AcDbTrace = 4 BD points. Cite ODA §19.4.40.
- [ ] Task 5.7: `entity.rs::encode_insert`. Open 2D flattens INSERT children at load time so we can't round-trip the block reference exactly. Two options:
  - **Path A (chosen):** Re-create a synthetic block per exploded INSERT — name `"_RECOMP_<orig>"` — and emit a single AcDbBlockReference per cluster. Loses the original block name but preserves the tree shape.
  - **Path B (rejected):** Emit every segment as a standalone LINE. Loses the block grouping. Reserved as a fallback if Path A breaks AutoCAD's reader for any reason.
- [ ] Task 5.8: `entity.rs::encode_hatch`. Boundary + style cluster. Cite ODA §19.4.34. Lowest priority — Open 2D's hatch support is partial today so the writer can skip the loop for now and emit the fill triangles as SOLID entities.
- [ ] Task 5.9: Round-trip test per entity type, asserting geometry survives within 1e-9 tolerance.
- [ ] Task 5.10: Round-trip test with one of the corpus DWGs in `kernel/test_assets/dwg_corpus_2/` (R2010 subset). Assert the visible bounding box matches and the entity counts match within 1%.
- [ ] Task 5.11: Commit `feat(dwg-writer): entity body encoders for 7 primitive types (ODA §19.4)`.

### Phase 6 — Final wiring + verification
*Estimated effort: 1 week. Risk: medium — the verification harness needs to call AutoCAD or ODA File Converter, neither of which we currently script.*

- [ ] Task 6.1: Back-patch the object-map offsets now that entity bodies are encoded. Compute the file-section CRCs (CRC-8 per page, CRC-32 over the whole file).
- [ ] Task 6.2: Append the file trailer: the security-disclaimer string + the file's CRC-32 hash, both ODA §4.6.
- [ ] Task 6.3: Replace the Save-As-DWG modal in `studio_app.rs` with a direct call into `write_dwg_r2010`. The modal stub stays in the codebase but is wired behind a feature flag `--feature dwg-writer-modal` for emergency rollback.
- [ ] Task 6.4: Verification harness `kernel/test_assets/dwg_writer_verify/`:
  - Take 10 reference scenes (mix of all 7 entity types, with layers, linetypes, blocks).
  - Write each as DWG.
  - Open in AutoCAD 2024 (manual step — operator screen-captures any warning dialog).
  - Open in ODA File Converter (automatable — call as a subprocess in a Rust test).
  - Open in TeighaWeb (automatable via headless browser).
  - Acceptance: zero warning dialogs in AutoCAD 2024, zero errors from ODA File Converter, identical render in TeighaWeb.
- [ ] Task 6.5: Roundtrip soak test — load every R2010 file in `kernel/test_assets/dwg_corpus_2/`, write each one back out, re-load, assert visible-bbox + entity-count parity.
- [ ] Task 6.6: Commit `feat(dwg-writer): final wiring + verification harness — Phase 6 complete`.

---

## Out-of-scope (deferred to follow-up plans)

- R14 / R2000 / R2004 / R2007 writer support — same primitives, different bit layouts. Defer until a user files a request for the older format.
- R2013 / R2018 writer support — slight encoding differences (R2018 introduces the AcDbFileDependencyList section). Defer until R2010 is stable in production.
- Encrypted DWG output. Out of scope per user decision.
- 3D entities (3DSOLID, REGION, MESH, SUBDIVISION) — Open 2D Studio is a 2D-only app, so 3D content is rejected at load time. No writer required.
- DXF round-trip parity — `dxf_export.rs` already covers this for the text format. The binary writer does not need to match DXF byte-for-byte.

---

## Verification before completion

Per the project's `superpowers:verification-before-completion` skill, **no Phase commit may claim "complete" without**:

1. `cargo build --release --bin open_2d_viewer --bin open_2d_studio` exits 0.
2. `cargo test --release -p kernel-dxf-import` exits 0.
3. (Phase 5 and after) the corpus round-trip test exits 0.
4. (Phase 6 only) the manual AutoCAD 2024 open of all 10 verification scenes shows zero warning dialogs.

Each commit message must cite the ODA section number(s) it implements and assert "clean-room — no LibreDWG / Teigha source consulted".

---

## Why the modal stub ships first

Open 2D Studio gives the user a minimal-edit surface in the Viewer (Move / Delete / Explode / layer-delete). Those edits must be persistable so the user's work isn't lost. Until the binary writer lands, the modal stub routes Save-As-DWG through the existing text DXF writer — AutoCAD opens DXF natively, so the user can hand the file back to their main toolchain without losing edits. The modal stays in place from `b516b77` (the commit that introduced it) until Phase 6 of this plan lands.
