# Open 2D Viewer / Studio — Undo / Redo Coverage Audit

> Walks every `EditOp` variant in `kernel/crates/app/src/studio_app.rs`,
> traces each from the **push call site** (the `commit_*` / handler
> that records the op) to the **undo arm** (`undo_last_edit`) and the
> **redo arm** (`redo_last_edit`).
>
> Baseline: commit `87934c4` on branch `open-2d-viewer`.
> Stack cap: `MAX_UNDO = 20` for both `undo_stack` and `redo_stack`.
>
> Per the same commit series, the keyboard handler now fires Ctrl+Z,
> Ctrl+Y, and Ctrl+Shift+Z in **both** Studio and Viewer modes — the
> earlier Viewer-only gate on Ctrl+Z (root cause of the original
> "Undo/redo werkt niet bij explode en move" bug) was lifted in commit
> `e95e704`.

## Coverage table

| EditOp variant | Pushed by | Undo arm | Redo arm | Status |
|---|---|---|---|---|
| `Move { eids, delta }` | `commit_move_multi_in` (`studio_app.rs:7340`) — also drives the 2-click Move flow and the legacy `commit_move_in` wrapper | `apply_move_delta_multi_in(..., -dx, -dy)` then `reupload_tab_buffers` (`undo_last_edit`) | `apply_move_delta_multi_in(..., +dx, +dy)` then `reupload_tab_buffers` (`redo_last_edit`) | ✅ already correct (was push-side only; previously blocked by Ctrl+Z viewer gate) |
| `Delete { entities }` | `delete_entities_in` (`studio_app.rs:7838`) — drains the Delete/Backspace key path and the Cut path (Ctrl+X) | `reinsert_entities_in(&entities)` then `reupload_tab_buffers` | `delete_entities_in_inner(&eids, false)` — re-runs the lockstep filter using the eid list extracted from the original snapshot, then `reupload_tab_buffers` | ✅ already correct; redo path is new |
| `Paste { new_eids }` | `duplicate_selected_in` (`studio_app.rs:7647`) for Ctrl+D + `paste_clipboard_in` (`studio_app.rs:7985`) for Ctrl+V | `delete_entities_in_inner(&new_eids, false)` then `reupload_tab_buffers` | ⚠ best-effort: emits the status flash "Redo: Paste not replayable" — the original action's geometry isn't stored in `EditOp::Paste` (only the minted eids are). Documented in `redo_last_edit` body | ⚠ undo OK; redo intentionally non-replayable (matches AutoCAD's paste-redo gap) |
| `Rotate { eids, pivot, angle }` | `commit_rotate_in` (`studio_app.rs:7486`) | `apply_rotate_in(..., pivot, -angle)` then `reupload_tab_buffers` | `apply_rotate_in(..., pivot, angle)` then `reupload_tab_buffers` | ✅ already correct; redo path is new |
| `Scale { eids, pivot, factor }` | `commit_scale_in` (`studio_app.rs:7501`) | `apply_scale_in(..., pivot, 1.0 / factor)` (guarded `factor != 0.0 && factor.is_finite()`) | `apply_scale_in(..., pivot, factor)` (same guards) | ✅ already correct; redo path is new |
| `Mirror { eids, axis_a, axis_b }` | `commit_mirror_in` (`studio_app.rs:7516`) | `apply_mirror_in(..., axis_a, axis_b)` — mirror is its own inverse, so the same call works | `apply_mirror_in(..., axis_a, axis_b)` — same call again (twice = identity from the user's POV after one undo + one redo, which is correct) | ✅ already correct; redo path is new |
| `EditText { text_delta }` | `commit_text_edit` (`studio_app.rs:7311`) after F2 → text edit → Enter | `crate::scene_io::restore_text_entity(scene, &text_delta)` then `reupload_tab_buffers` | ⚠ best-effort: emits the status flash "Redo: EditText not replayable" — `TextEntityDelta` carries only the pre-edit state, not the new buffer | ⚠ undo OK; redo intentionally non-replayable (mirrors Paste gap) |
| `LayerDelete { layer_name, was_hidden_before }` | LAYERS panel trash-button handler (`studio_app.rs:6321`) | Removes `layer_name` from `tab.deleted_layers`; if `!was_hidden_before` also removes from `tab.hidden_layers`; invalidates `cached_layer_list` + `cached_structure_tree`; rebuilds buffers | Re-inserts `layer_name` into `tab.deleted_layers`; if `!was_hidden_before` also re-inserts into `tab.hidden_layers`; invalidates caches; rebuilds buffers | ✅ already correct (undo was already wired in commit `dd5d989`); redo path is new |
| `Explode { reassignments, new_eids }` | `explode_inserts_in` (`studio_app.rs:7824`) — fires on `X` key + ribbon Edit-group Explode button | Walks `reassignments` and writes each `(kind, idx) → old_eid` back into `scene.segment_entity_idx` / `scene.triangle_entity_idx`; invalidates caches; rebuilds buffers | Walks the same vector and writes `(kind, idx) → new_eids[n]` (the post-explode eid captured at push time); invalidates caches; rebuilds buffers | ✅ NEWLY ADDED in commit `e95e704` — was completely missing before, root cause of the user-reported "Ctrl+Z na X explode doet niets" |

## Symmetry guarantees

The redo arm intentionally bypasses each `commit_*` wrapper in favour
of the raw `apply_*` primitive. This is critical: routing through
`commit_*` would call `push_undo`, which clears `redo_stack` (standard
new-edit fork semantics), which would in turn break the redo chain on
the very first step. The cost is that redo doesn't get GPU pipe
rebuild as a side effect of the wrapper — `redo_last_edit` performs
the `reupload_tab_buffers` + `rebuild_sel_pipe` itself.

## Cap behaviour

Both `undo_stack` and `redo_stack` are capped at `MAX_UNDO = 20` via
`push_undo` / `push_undo_no_redo_clear` / `push_redo`. FIFO eviction
(`.remove(0)`) when the cap is hit. This means a user who undoes 21+
operations and then redoes 21+ times will lose the oldest entry on
each direction — acceptable for the viewer-port editing surface
(typical session is 1-5 destructive edits).

## Known gaps / future work

1. **Paste redo** — needs `EditOp::Paste` to carry a `Vec<DeletedEntity>`
   (the geometry snapshot) instead of just `new_eids`. Estimate: ~30
   LOC across `duplicate_selected_in` + `paste_clipboard_in` + the
   `Paste` arm. Skipped here because the viewer-port spec doesn't
   include paste as a primary workflow.

2. **EditText redo** — needs `TextEntityDelta` to carry both the
   pre-edit AND post-edit raw strings (currently it carries only the
   pre-edit segments/triangles snapshot). Cheap to add (~10 LOC), but
   only Studio mode exposes F2 text editing today.

3. **Annotation undo** — measure/dimension annotations live on
   `tab.annotations` and have their own ad-hoc add/remove paths that
   don't yet push `EditOp` rows. Out of scope for the viewer port but
   noted for the next pass.
