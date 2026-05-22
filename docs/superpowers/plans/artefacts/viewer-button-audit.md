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
> Last refreshed: 2026-05-22 audit + fix round (HEAD = `6e00c72`).
>
> Fixes landed in this round:
>
> | Cluster | Commit  | Title |
> |---------|---------|-------|
> | Audit baseline | `ed222d6` | docs(viewer): button-audit baseline |
> | Fix A | `8eeba04` | fix(viewer): Length/Area/Angle/Coord ribbon dispatch + Area canvas flow |
> | Fix B | `083bbc2` | fix(viewer): wire Edit + Selection + Pan + Zoom ribbon dispatches |
> | Fix C | `e125649` | feat(scene_io): LTSCALE 100 multiplier for world-space dash arrays |
> | Fix D | `76b7836` | fix(viewer): narrower Properties panel + tail-truncate filename |
> | Fix E | `6e00c72` | feat(viewer): drop IFC Model toggle from View tab Panels group |

## Home tab

| ID                  | Label       | Group      | Dispatch arm?              | Flag consumed?                 | Implementation?                 | Status          | Fix SHA |
|---------------------|-------------|------------|----------------------------|--------------------------------|---------------------------------|-----------------|---------|
| `select`            | Select      | Selection  | Yes (3776)                 | Yes (5399 sets tool_mode)      | Yes (canvas LMB Select branch)  | WORKS           | —       |
| `select_all`        | Select All  | Selection  | Yes (added)                | Yes (do_select_all 5933)       | Yes (`select_all_in`)           | FIXED           | `083bbc2` |
| `deselect`          | Deselect    | Selection  | Yes (added)                | Yes (5645 clears selection)    | Yes                              | FIXED           | `083bbc2` |
| `find_replace`      | Find        | Selection  | Yes (3830)                 | Yes (5487 toggles dialog)      | Yes (Find dialog at 3899)       | WORKS           | —       |
| `pan`               | Pan         | (Pan grp)  | Yes (added)                | Yes (sets ToolMode::Select)    | Middle-drag is canonical Pan    | FIXED (Select fallback) | `083bbc2` |
| `move`              | Move        | Edit       | Yes (3777)                 | Yes (5399 sets ToolMode::Move) | Yes (canvas LMB Move branch)    | WORKS           | —       |
| `delete`            | Delete      | Edit       | Yes (added)                | Yes (do_delete 5943)           | Yes (`delete_entities_in`)      | FIXED           | `083bbc2` |
| `explode`           | Explode     | Edit       | Yes (3782)                 | Yes (5442 → self.requested_explode) | Yes (5972 `do_explode`)    | WORKS           | —       |
| `measure_length`    | Length      | Measure    | Yes (added)                | Yes (5502 sets MeasureSub)     | Yes (canvas Measure 2-click)    | FIXED           | `8eeba04` |
| `measure_area`      | Area        | Measure    | Yes (added)                | Yes (5502 sets MeasureSub)     | Yes (Measure LMB Area branch)   | FIXED           | `8eeba04` |
| `measure_angle`     | Angle       | Measure    | Yes (3840)                 | Yes (5399 sets MeasureAngle)   | Yes (canvas MeasureAngle 3-click) | WORKS         | —       |
| `measure_coord`     | Coord.      | Measure    | Yes (3843)                 | Yes (5399 sets MeasureCoord)   | Yes (canvas MeasureCoord 1-click) | WORKS         | —       |
| `copy_to_clipboard` | Copy        | Clipboard  | Yes (added)                | Studio: `requested_copy`       | Studio: do_copy 5934            | FIXED (Studio); Viewer logs ignore | `083bbc2` |
| `copy_id`           | Copy ID     | Clipboard  | NO                         | n/a                            | None — placeholder              | NOT IMPLEMENTED | deferred |
| `cut`               | Cut         | Clipboard  | NO                         | n/a                            | `Ctrl+X` wires copy+delete; gated out of Viewer | RIBBON BROKEN (Viewer-gated) | deferred |
| `delete` (Clipboard)| Delete      | Clipboard  | Yes (added)                | Yes (do_delete 5943)           | Yes                              | FIXED           | `083bbc2` |
| `layers`            | Layers      | Panels     | Yes (3788)                 | Yes (5318 toggles panel)       | Yes (panel renders at 4203 ish) | WORKS           | —       |
| `properties`        | Properties  | Panels     | Yes (3797)                 | Yes (5339 toggles panel)       | Yes (panel renders at 4614)     | WORKS           | —       |

## View tab

| ID                  | Label       | Group      | Dispatch arm?              | Flag consumed?                 | Implementation?                 | Status          | Fix SHA |
|---------------------|-------------|------------|----------------------------|--------------------------------|---------------------------------|-----------------|---------|
| `pan`               | Pan         | Navigate   | Yes (added)                | Yes (sets ToolMode::Select)    | Middle-drag is canonical Pan    | FIXED (Select fallback) | `083bbc2` |
| `fit_extents`       | Fit All     | Zoom       | Yes (3775)                 | Yes (5886 calls fit_active)    | Yes (`fit_active` at 7197)      | WORKS           | —       |
| `zoom_in`           | Zoom In     | Zoom       | Yes (added)                | Yes (requested_zoom_step)      | Yes (1.25x at center)           | FIXED           | `083bbc2` |
| `zoom_out`          | Zoom Out    | Zoom       | Yes (added)                | Yes (requested_zoom_step)      | Yes (0.8x at center)            | FIXED           | `083bbc2` |
| `zoom_window`       | Window      | Zoom       | Yes (3820)                 | Yes (5399 sets ZoomRegion)     | Yes (canvas ZR drag)            | WORKS           | —       |
| `zoom_previous`     | Previous    | Zoom       | Yes (3828)                 | Yes (5458 pops history)        | Yes                              | WORKS           | —       |
| `zoom_center`       | Center      | Zoom       | Yes (3833)                 | Yes (5399 sets ZoomCenter)     | Yes (canvas ZoomCenter 1-click) | WORKS           | —       |
| `grid`              | Grid        | Display    | Yes (3829)                 | Yes (5469 toggles show_grid)   | Yes (grid render path)          | WORKS           | —       |
| `white_bg`          | White BG    | Display    | Yes (3831)                 | Yes (5470 toggles white_bg)    | Yes                              | WORKS           | —       |
| `theme`             | Theme       | Appearance | Yes (3832)                 | Yes (5471 logs placeholder)    | NO (Phase 2 placeholder)        | NOT IMPLEMENTED | deferred |
| `ifc_panel`         | IFC Model   | Panels     | n/a                        | n/a                            | Button removed in Viewer build  | REMOVED         | `6e00c72` |

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
