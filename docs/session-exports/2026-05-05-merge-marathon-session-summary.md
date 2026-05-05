# Open 2D Studio — merge marathon session (2026-05-04 → 05)

Raw transcript: `2026-05-05-merge-marathon-session.jsonl` (87 MB)

Branch: `merge-1.0-2.0`

---

## Overview

Multi-day marathon. Started as continuation of the DXF/DWG viewer (`split_compare.exe`) session and turned into a full architecture push:

- **Binary renamed** `split_compare` → `open_2d_studio` (window title, About dialog, doc comments)
- Custom **"2D" pixel-font window icon** (5×7 cells × 5 scale)
- **Crash fix** — wgpu `Surface::configure` clamp on `max_texture_dimension_2d` (multi-monitor maximize was producing 9000+px and panicking)
- Three new crates landed: **`superui`** (UI components), **`kernel-snap`** (OSNAP engine), and **`dwg-parser`** continued upgrades
- A **Text Editor** for TEXT/MTEXT entities — F2 / double-click → floating overlay → live re-tessellate → undo
- **Multi-round DWG fixes** for HATCH corners, MTEXT tab characters, line patterns, dim-style, dim-tick, paper-space classification, and an exhaustive (still partial) layer-color decode
- **Brainstorm + plan + execute** flow standardised via the `superpowers:*` skill stack

Commit count on branch: ~80 commits across the marathon.

---

## Landed (chronological-ish)

### Viewer / kernel binary

- `split_compare` → **`open_2d_studio`** rename (commit lineage in git history) — exe, window title, About dialog, log prefixes, doc-comments
- `make_window_icon()` — programmatic 5×7-cell "2D" pixel-font, 5× scale, accent-glow on top edge
- Crash fix on `Surface::configure` — `min(device.limits().max_texture_dimension_2d)` clamp on resize
- LMB egui-gate fix — `egui_wants_pointer_input()` was true on canvas-press → drift-detection never fired → drag-box selection broken. Fix: drop the `!egui_wants_input` gate, use `mouse_in_canvas() && !mouse_in_view_cube()`. Drag-box select + multi-select + delete + clipboard + EditOp::Move/Delete/Paste all green
- Spatial index: `kernel-spatial::SegmentIndex` (rstar) + `entity_to_segs` lookup → pick + sibling-walk dropped from O(n) on 688k segs to O(log n + k); per-frame median 587 ns, **850× under the 0.5 ms target**
- Blok 3 transforms — Rotate, Scale, Mirror, Copy + EditOp variants + R/S/Shift+M/Ctrl+D shortcuts + magenta preview during drag
- View cube + canvas rotation — `cam.rotation` field, view-uniform rotation matrix, drag-to-rotate disk widget anchored RIGHT_BOTTOM
- Ribbon polish v3 (TrueView-inspired hairline groups), then collapsed into hamburger app-menu via UI Task 11

### Text Editor (Phase 1, all 11 tasks)

Spec: `docs/superpowers/specs/2026-05-01-text-editor-design.md`
Plan: `docs/superpowers/plans/2026-05-01-text-editor-plan.md`

| # | What | Commit |
|---|------|--------|
| 1 | `EntityText` struct + `Scene.entity_text: Vec<Option<EntityText>>` field | b48a6ae |
| 2 | Pad entity_text to entity_names.len() | 3e171eb |
| 3 | Populate in DXF TEXT branch (5 callers updated) | 1082d10 |
| 4 | Populate in DXF MTEXT branch | 10c909f |
| 5 | Populate in DWG TEXT/MTEXT/ATTRIB/DIM (3 sites) | b598b27 |
| 6 | Extract `tessellate_text` shared helper (DXF only — DWG xform math left inline) — **zero regression** verified | d6a2004 |
| 7 | `re_tessellate_text_entity` + `restore_text_entity` + `TextEntityDelta` snapshot | db52ac0 |
| 8 | `EditOp::EditText` variant + undo handler | 7b12f74 |
| 9 | `EditTextState` + F2 + double-click triggers + commit/cancel | 85bfcbe |
| 10 | Floating overlay UI + 50 ms debounced live preview + correct world↔screen helpers | 2f769cb |
| 11 | End-to-end acceptance + screenshot artefact | 4fb8a6d |

Hot-fixes after T11 (user-reported regressions):
- **Font fallback bug** — `tessellate_text` consults `dwg_lookup_style` + arial.ttf fallback (deda9bd)
- **Font size mismatch** — `EntityText.font_path` was storing the bare STYLE name; edit-time `dwg_lookup_style` could pick a different STYLE row → different cap-height ratio. Fix: resolve final TTF path at populate via two new helpers (`resolve_dxf_text_font_path`, `resolve_dwg_text_font_path`) (862f196)

### `superui` crate (UI Phase 1, all 11 tasks)

Spec: `docs/superpowers/specs/2026-05-01-ui-crate-design.md`
Plan: `docs/superpowers/plans/2026-05-01-ui-crate-phase1-plan.md`

| # | What | Commit |
|---|------|--------|
| 1 | Scaffold `kernel/crates/superui/` with feature flags (layout/panels/dialogs/editors) | 48737de |
| 2 | `Theme::Default` palette (warm dark #3E3636 + amber #D97706 from real 1.0 globals.css) + `apply_theme(ctx)` | 9d0dd3a |
| 3 | `tokens::{spacing,metrics,typography}` constants extracted from 1.0 CSS | 2d3dec5 |
| 4 | `IconKind` (10 hand-drawn CAD icons) + `egui-phosphor 0.7.3` bridge | 3dd700f |
| 5 | `CadButton::large/medium/small` primitive | 804caa6 |
| 6 | `TitleBar` widget — hamburger + title + min/max/close, close hover red | 8b6e548 |
| 7 | `Ribbon` shell — tab strip + groups + buttons, data-driven | e6f0c01 |
| 8 | `FileTabBar` with sloped right divider (convex polygon) | c865dba |
| 9 | `StatusBar` with composable `StatusSection`s | 83b72b8 |
| 10 | Add `superui` + `kernel-snap` workspace deps to kernel-app | e302ef5 |
| 11 | **Refactor `open_2d_studio.rs` to consume `superui` chrome** — net **−1229 lines** (6843 → 5614), 15 helpers deleted, 1500-LOC dead code purge | b074937 |

Crate name was **renamed mid-flight** `kernel-ui` → `superui` per user choice.

Carry-over from T11:
- `TitleBarAction::OpenAppMenu` is wired to a flag but the popup is a no-op — Phase B
- All ribbon icons currently `IconKind::Rectangle` placeholders — pixel-perfect agent will swap to phosphor
- `RibbonStyle` legacy const retained (used by `side_panel_header`)
- Sample `RibbonStyle` fields unused — accepted

### `kernel-snap` crate (OSNAP engine — Phase A first 7 tasks)

Spec: `docs/superpowers/specs/2026-05-01-drawing-tools-design.md` §4.1
Plan: `docs/superpowers/plans/2026-05-01-snap-engine-phase-a-plan.md`

| # | What | Commit |
|---|------|--------|
| 1 | Scaffold `kernel/crates/snap/` with `glam`/`bitflags`/`criterion` | 56d68f3 |
| 2 | Types: `SnapMode` (11 variants), `SnapModeSet`, `SnapResult`, `SnapContext`, `SnapEngine` | eb1fca5 |
| 3 | Endpoint + Midpoint modes + 3 integration tests (Center stub for Phase B) | 1c0fe1d |
| 4 | Intersection + Perpendicular + Parallel + 2 tests (Tangent stub for Phase B) | 74b759b |
| 5 | Alignment + Nearest + Origin + Grid + 3 tests | eec26a5 |
| 6 | Criterion benchmark — **median 587 ns, 850× under the 0.5 ms perf gate** | 3896e52 |
| 7 | `KeyPointTracker` (FIFO max 7, hover-acquire 250 ms) + 3 unit tests | ff24a89 |

Tasks 8-12 (integration into `open_2d_studio.rs` + `superui` status-bar OsnapStrip) are **GATED** — were waiting on UI T11 (now landed) but haven't been dispatched yet at end of session.

### DWG parser fixes (rolling rounds)

| Round | What | Result |
|---|---|---|
| Earlier sessions | $LTSCALE bit-drift, DIMSTYLE_OBJ body decode (DIMSCALE/DIMTXT/DIMASZ/DIMBLK1/DIMBLK2), tick rendering switch, paper-space transitive closure (handle 0xAB8 fix), SOLID guard, MTEXT tabs (^I → 4 spaces), HATCH corner closing | landed in `2d800ce` etc. |
| Round 1+ (Layer-color pink) | `read_cmc_r2004` per ODA §2.11 replaces `read_enc()` — pink/purple sentinel byte leak fixed; sentinel layers now resolve to white (7) instead of 195 | landed |
| Round 6 | Continued — Funderings layer correct ACI=3 (green) | landed |
| **Round 7** | Investigation: AcDbColor not in this fixture's CLASSES section; handle stream is exactly 78 bits (5 standard handles, no room for color handle); ACI must be inline somewhere in ~300 bits between CMC and handle stream — but field layout per ODA isn't matching | df6d858 (investigative framework) |
| **Round 8** | Brute-force: 6 angles tried (single-byte, XOR sentinel, BS scan, handle-stream past padding, flags region, obj-size delta) — **stop condition reached** without identifying the encoding | escalated |
| **Round 9** | Pattern-analysis breakthrough: `_xref_index` field reads the **lineweight** bits (16568 = 0x40B8 = lw 13). Layers with longer NAMES drift, short names don't. **String-stream-vs-data-stream alignment issue in R2007+** strongly indicated. Diagnostic infrastructure in place | uncommitted at end of session |
| **Round 10** | Systematic alignment search dispatched (4 approaches: B-bit insertion, string-stream consumption, bit-level diff, body-size delta) | running at end of session |

Layer-color status at session end: **8 of 21 layers correct** (clean-form CMC); 13 sentinel-form still fall back to white. Root cause direction identified, exact field not yet pinpointed.

### Hot-fixes / bonus

- DWG `read_cmc_r2004_full` correctly handles 0xC3 sentinel (always consumes color_byte_flag RC + optional TV color_name + book_name, per ODA §2.11) — `2d800ce` keeps cursor aligned for downstream LAYER fields
- Text-editor font-resolution + size diagnostics gated on `O2D_TEXT_EDIT_DBG=1` (a86f22d2)
- Layer-color diagnostics gated on `O2D_LAYER_COLOR_DBG=1` and `DWG_LAYER_DUMP=1`

---

## Tooling / process advances

- **`superpowers:brainstorming` → `writing-plans` → `subagent-driven-development`** flow used for all three major features (text editor, UI crate, snap engine + drawing-tools master design)
- Three design specs written, three implementation plans, ~30 successful subagent dispatches
- **Pixel-perfect agent** dispatched (Playwright + Chrome on https://open-2d-studio.open-aec.com/ live URL) — credit-limited at end of session, not yet completed
- **DWG pixel-perfect iteration agent** ran ≥ 10 rounds; identified the layer-color alignment direction
- Multiple parallel agents managed via `SendMessage` for context continuity
- TodoWrite kept rolling state of 5-10 concurrent threads

---

## Open at session end

- DWG layer-color alignment fix (Round 10 running)
- Pixel-perfect Playwright iteration (waiting credit reset)
- Snap Tasks 8-12 (canvas integration, status-bar OsnapStrip, persist settings, ortho/polar) — ungated, not yet dispatched
- App-menu popup wiring (TitleBar hamburger currently no-op)
- DXF selection still untested by user (was open earlier)
- Text-editor font-fix + font-size-fix landed but not yet user-verified
- Drawing-tools Phase B–H (drawing primitives, hatch, dim subtypes, modify ops, grip edit, DynamicInput) — design done, plans not written
- UI crate Phase B–E (panels, dialogs, editors, IFC bridge) — design done, plans not written
- Crate-refactor / `dgn` crate / DWG binary writer — all queued
- Architecture-route decision (OPS bitmap pipeline vs route H egui) → essentially answered by route H landing as `superui`

---

## Files touched (high-level)

- `kernel/crates/app/src/bin/open_2d_studio.rs` (renamed from `split_compare.rs`) — refactor to superui consumption, −1229 net
- `kernel/crates/app/src/scene_io.rs` — EntityText, populate paths, tessellate_text helper, re_tessellate, restore, font-resolve helpers
- `kernel/crates/superui/` — entire new crate
- `kernel/crates/snap/` — entire new crate
- `kernel/crates/spatial/src/lib.rs` — `SegmentIndex` extension (was added late in prior session, now consumed)
- `src-tauri/dwg-parser/parser.rs` + `bitreader.rs` — many parser refinements (DIMSTYLE body, color handle attempt, R2010+ alignment investigation)
- `kernel/Cargo.toml` — workspace members: `crates/superui`, `crates/snap`
- `kernel/crates/app/Cargo.toml` — superui + kernel-snap deps
- `docs/superpowers/specs/` — 4 design docs (text-editor, UI-crate, drawing-tools, …)
- `docs/superpowers/plans/` — 3 implementation plans + acceptance artefacts

---

## Agent count

~25 background subagents spawned this session, mix of `general-purpose` and `superpowers:code-reviewer`, plus the long-running DWG pixel-perfect / layer-color iteration agent (10+ rounds via SendMessage).

---

## Fixture corpus (unchanged)

- `2705_model Funderingsherstel - Constructie - Sheet - CP-21 - Constructietekening.{dxf,dwg}` — primary oracle pair (production sheet)
- `3070_model - Legend - M(--)01_arceringen_5.{dxf,dwg}` — pattern-hatch legend
- DXF served as ground truth oracle for DWG bug-hunts throughout
