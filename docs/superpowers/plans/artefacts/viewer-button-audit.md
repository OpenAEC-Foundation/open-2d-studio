# Open 2D Viewer — ribbon button audit

> Baseline (HEAD = `54c9cb7`) — full walk of every button in the Viewer
> Home + View ribbon tabs. For each button:
>
> 1. Find its `id` in `studio_app.rs::build_ribbon_tabs` (Viewer branch,
>    lines 9188-9336).
> 2. Find its dispatch arm in the `match id.as_str()` block at lines
>    3764-3846 (ribbon dispatch), 4138-4156 (status-bar dispatch).
> 3. Verify the dispatched flag/tool-mode is consumed downstream.
> 4. If the chain is broken, document the gap.
>
> Last refreshed: 2026-05-22 audit + fix round.

## Home tab

| ID                  | Label       | Group      | Dispatch arm?              | Flag consumed?                 | Implementation?                 | Status          | Fix SHA |
|---------------------|-------------|------------|----------------------------|--------------------------------|---------------------------------|-----------------|---------|
| `select`            | Select      | Selection  | Yes (3776)                 | Yes (5399 sets tool_mode)      | Yes (canvas LMB Select branch)  | WORKS           | —       |
| `select_all`        | Select All  | Selection  | NO                         | n/a                            | `Ctrl+A` keyboard wires this    | RIBBON BROKEN   | Fix B   |
| `deselect`          | Deselect    | Selection  | NO                         | n/a                            | `Esc` keyboard clears selection | RIBBON BROKEN   | Fix B   |
| `find_replace`      | Find        | Selection  | Yes (3830)                 | Yes (5487 toggles dialog)      | Yes (Find dialog at 3899)       | WORKS           | —       |
| `pan`               | Pan         | (Pan grp)  | NO                         | n/a                            | Middle-drag is the canonical    | RIBBON BROKEN   | Fix B   |
| `move`              | Move        | Edit       | Yes (3777)                 | Yes (5399 sets ToolMode::Move) | Yes (canvas LMB Move branch)    | WORKS           | —       |
| `delete`            | Delete      | Edit       | NO                         | n/a                            | Yes (5943 `do_delete`)          | RIBBON BROKEN   | Fix B   |
| `explode`           | Explode     | Edit       | Yes (3782)                 | Yes (5442 → self.requested_explode) | Yes (5972 `do_explode`)    | WORKS           | —       |
| `measure_length`    | Length      | Measure    | NO (in ribbon dispatch)    | Yes IF dispatched (5502)       | Yes (canvas Measure 2-click)    | RIBBON BROKEN   | Fix A   |
| `measure_area`      | Area        | Measure    | NO (in ribbon dispatch)    | Yes IF dispatched (5502)       | NO (Measure LMB ignores sub)    | RIBBON BROKEN + IMPL GAP | Fix A |
| `measure_angle`     | Angle       | Measure    | Yes (3840)                 | Yes (5399 sets MeasureAngle)   | Yes (canvas MeasureAngle 3-click) | WORKS         | —       |
| `measure_coord`     | Coord.      | Measure    | Yes (3843)                 | Yes (5399 sets MeasureCoord)   | Yes (canvas MeasureCoord 1-click) | WORKS         | —       |
| `copy_to_clipboard` | Copy        | Clipboard  | NO                         | n/a                            | `Ctrl+C` wires `requested_copy` | RIBBON BROKEN   | Fix B   |
| `copy_id`           | Copy ID     | Clipboard  | NO                         | n/a                            | None — placeholder              | NOT IMPLEMENTED | deferred |
| `cut`               | Cut         | Clipboard  | NO                         | n/a                            | `Ctrl+X` wires copy+delete; gated out of Viewer | RIBBON BROKEN (Viewer-gated) | deferred |
| `delete` (Clipboard)| Delete      | Clipboard  | NO                         | n/a                            | Same as Edit/Delete above       | RIBBON BROKEN   | Fix B (same arm covers both) |
| `layers`            | Layers      | Panels     | Yes (3788)                 | Yes (5318 toggles panel)       | Yes (panel renders at 4203 ish) | WORKS           | —       |
| `properties`        | Properties  | Panels     | Yes (3797)                 | Yes (5339 toggles panel)       | Yes (panel renders at 4614)     | WORKS           | —       |

## View tab

| ID                  | Label       | Group      | Dispatch arm?              | Flag consumed?                 | Implementation?                 | Status          | Fix SHA |
|---------------------|-------------|------------|----------------------------|--------------------------------|---------------------------------|-----------------|---------|
| `pan`               | Pan         | Navigate   | NO                         | n/a                            | Middle-drag is canonical        | RIBBON BROKEN   | Fix B   |
| `fit_extents`       | Fit All     | Zoom       | Yes (3775)                 | Yes (5886 calls fit_active)    | Yes (`fit_active` at 7197)      | WORKS           | —       |
| `zoom_in`           | Zoom In     | Zoom       | NO                         | n/a                            | None (wheel-only)               | RIBBON BROKEN   | Fix B   |
| `zoom_out`          | Zoom Out    | Zoom       | NO                         | n/a                            | None (wheel-only)               | RIBBON BROKEN   | Fix B   |
| `zoom_window`       | Window      | Zoom       | Yes (3820)                 | Yes (5399 sets ZoomRegion)     | Yes (canvas ZR drag)            | WORKS           | —       |
| `zoom_previous`     | Previous    | Zoom       | Yes (3828)                 | Yes (5458 pops history)        | Yes                              | WORKS           | —       |
| `zoom_center`       | Center      | Zoom       | Yes (3833)                 | Yes (5399 sets ZoomCenter)     | Yes (canvas ZoomCenter 1-click) | WORKS           | —       |
| `grid`              | Grid        | Display    | Yes (3829)                 | Yes (5469 toggles show_grid)   | Yes (grid render path)          | WORKS           | —       |
| `white_bg`          | White BG    | Display    | Yes (3831)                 | Yes (5470 toggles white_bg)    | Yes                              | WORKS           | —       |
| `theme`             | Theme       | Appearance | Yes (3832)                 | Yes (5471 logs placeholder)    | NO (Phase 2 placeholder)        | NOT IMPLEMENTED | deferred |
| `ifc_panel`         | IFC Model   | Panels     | NO                         | n/a                            | Gated out of Viewer mode anyway | REMOVED         | Fix E   |

## Fix legend

- **Fix A** — `feat(viewer): Length/Area/Angle/Coord ribbon dispatch + canvas click handler`
- **Fix B** — `fix(viewer): wire Edit + Selection + Clipboard + Pan + Zoom ribbon dispatches`
- **Fix C** — `feat(scene_io): LTSCALE 100 multiplier for world-space dash arrays`
- **Fix D** — `fix(viewer): narrower Properties panel + tail-truncate filename`
- **Fix E** — `feat(viewer): drop IFC Model toggle from View tab Panels group`

## Notes

- Several "RIBBON BROKEN" rows have working keyboard shortcuts — only
  the ribbon click is dead. Wiring them in is a one-liner per arm.
- `copy_id` and `theme` are out-of-scope placeholders deferred to a
  future Phase 3 round.
- `cut` is intentionally gated out of Viewer mode (it'd delete) — the
  button should either be removed from the Viewer ribbon or stay as
  a disabled affordance. Tracking as a follow-up.
