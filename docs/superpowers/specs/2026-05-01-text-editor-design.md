# Text Editor for TEXT/MTEXT entities — Design

**Date:** 2026-05-01
**Status:** Approved by user (inline)
**Branch:** `merge-1.0-2.0`
**Binary:** `open_2d_studio`

---

## Goal

Enable in-place text editing of loaded TEXT and MTEXT entities in the viewer. User clicks a text entity, presses F2 (or double-clicks), edits the content in a floating overlay, and on Enter the scene re-tessellates that entity's glyphs and updates the rendered output. Edit is undoable through the existing `EditOp` enum.

---

## User-facing flow

| Step | Trigger | Effect |
|------|---------|--------|
| Pick text entity | LMB in Select tool | Magenta selection highlight (existing behaviour) |
| Enter edit mode | F2 OR double-click on selected text entity | Floating `egui::TextEdit` opens at entity anchor, prefilled with current text |
| Live preview | Typing | Debounced (50 ms) re-tessellate, magenta-highlighted preview |
| Commit | Enter | `EditOp::EditText` pushed to undo stack, scene segments/triangles for that entity replaced |
| Cancel | Esc, click outside | Overlay closes, no change |
| Undo | Ctrl+Z | Existing undo stack restores prior text + segments + triangles |

---

## Architectural changes

### Scene data-model extension

Currently `Scene` stores only the tessellated `Segment`/`Triangle` arrays per entity. The raw text content and style are lost after load — there's no way to re-render with different content. We extend `Scene`:

```rust
pub struct Scene {
    // existing fields ...
    /// Per-entity raw text data, indexed by entity_idx. None for non-text
    /// entities. Populated by load_dxf and load_dwg in their TEXT/MTEXT
    /// branches. Consumed by re_tessellate_text_entity() on edit-commit.
    pub entity_text: Vec<Option<EntityText>>,
}

pub struct EntityText {
    /// Raw user-visible content. For MTEXT this includes inline format
    /// codes (\\fArial|b1;..., \\P, \\C7, ^I, etc.). MVP edits this raw
    /// string; WYSIWYG MTEXT formatting is out of scope.
    pub raw: String,
    /// World-space anchor (insertion point per AutoCAD spec).
    pub anchor: [f64; 2],
    /// Glyph cap height in world units (after dimscale/style scaling).
    pub height: f64,
    /// Rotation around anchor, radians, CCW positive.
    pub rotation: f64,
    /// Resolved font file path (e.g. "C:\\Windows\\Fonts\\arial.ttf"),
    /// or stroke-font sentinel "<stroke>" for fallback.
    pub font_path: String,
    /// Bold / italic flags from STYLE name suffix (_B / _I / _B_I) and
    /// MTEXT inline `\\fName|bN|iM`.
    pub bold: bool,
    pub italic: bool,
    /// MTEXT attachment-point (1..9 per ODA §20.4.46) or 0 for TEXT.
    pub attachment: u8,
    pub kind: TextKind,
}

pub enum TextKind {
    Text,    // single-line TEXT
    MText,   // multi-line MTEXT
    Attrib,  // ATTRIB (block instance attribute)
}
```

### Re-tessellation helper

A new function in `scene_io.rs`:

```rust
pub fn re_tessellate_text_entity(
    scene: &mut Scene,
    eid: u32,
    new_text: &str,
) -> Result<TextEntityDelta>;
```

Behaviour:
1. Lookup `scene.entity_text[eid]` — must be `Some(EntityText)`.
2. Update its `raw` to `new_text`.
3. Remove all segments and triangles where `segment_entity_idx[i] == eid` / `triangle_entity_idx[i] == eid`. Snapshot them into the returned delta.
4. Re-run the same glyph-tessellation pipeline that the loader used originally (font load, glyph outline, hole-aware fill, transform by anchor + rotation + height).
5. Push new segments/triangles back into the scene with the same entity_idx.
6. Return `TextEntityDelta { eid, old_text, new_text, removed_segments, removed_triangles }` for undo.

The tessellation must use **exactly** the same code paths as initial load — extract the glyph-tessellation block from the existing TEXT/MTEXT branches into a shared helper that load_dxf, load_dwg, AND re-tessellate all call.

### EditOp variant

```rust
pub enum EditOp {
    Move { eids: Vec<u32>, delta: [f64; 2] },
    Delete { entities: Vec<DeletedEntity> },
    Paste { new_eids: Vec<u32> },
    EditText {                           // NEW
        eid: u32,
        old_text: String,
        new_text: String,
        old_segments: Vec<(usize, Segment)>,    // (original_index, segment)
        old_triangles: Vec<(usize, Triangle)>,
    },
}
```

`undo_last_edit` for EditText:
1. Pop the EditOp::EditText
2. Re-tessellate again with `old_text` → produces a redo-state delta (discard for now; redo stack is future work)
3. Restore old segments and triangles in their original positions

### App-state additions

```rust
struct App {
    // existing fields ...
    edit_mode: Option<EditTextState>,
}

struct EditTextState {
    tab_idx: usize,
    eid: u32,
    buffer: String,        // current edit buffer (egui-managed)
    last_committed: String,
    debounce_at: Option<Instant>,  // re-tessellate timer
}
```

### Keyboard handlers

In Select tool, when exactly one text entity is selected:
- **F2** → `enter_edit_mode(active_tab, selected_eid)`
- **Double-click** on canvas hit on text entity → same

In edit mode:
- **Enter** → `commit_edit()` → push EditOp + tessellate final
- **Esc** → `cancel_edit()` → discard buffer, restore last_committed if changed mid-typing
- **Click outside text** → same as Esc

### Floating overlay

```rust
// In central panel after canvas, when edit_mode is Some:
let entity = scene.entity_text[eid].as_ref().unwrap();
let screen = world_to_screen(entity.anchor);
egui::Area::new("text_edit_overlay")
    .order(egui::Order::Foreground)
    .fixed_pos(screen)
    .show(ctx, |ui| {
        let resp = ui.add_sized([400.0, 80.0], egui::TextEdit::multiline(&mut state.buffer));
        if resp.changed() {
            state.debounce_at = Some(Instant::now() + Duration::from_millis(50));
        }
    });
```

Re-tessellate fires when `debounce_at` elapsed AND buffer != last_committed.

---

## Implementation blocks (writing-plans will decompose)

| # | Block | Files | Lines (est) |
|---|-------|-------|-------------|
| 1 | `EntityText` struct + `Scene.entity_text` field | scene_io.rs | ~30 |
| 2 | Populate `entity_text` in load_dxf TEXT/MTEXT branches | scene_io.rs | ~60 |
| 3 | Populate `entity_text` in load_dwg TEXT/MTEXT branches | scene_io.rs | ~60 |
| 4 | Extract shared glyph-tessellation helper | scene_io.rs | ~80 (refactor) |
| 5 | `re_tessellate_text_entity()` + `TextEntityDelta` | scene_io.rs | ~80 |
| 6 | `EditOp::EditText` variant + undo handler | open_2d_studio.rs | ~50 |
| 7 | `EditTextState` + F2 / double-click triggers | open_2d_studio.rs | ~60 |
| 8 | Floating overlay + debounced live preview | open_2d_studio.rs | ~80 |

**Total estimate**: ~500 lines net, mostly additive. Existing tessellation paths refactored once into a shared helper (block 4 — biggest risk).

---

## Out of scope (future work)

- **Redo stack**: only undo for now (matches existing EditOp behaviour)
- **WYSIWYG MTEXT formatting**: user edits raw text including `\f`, `\C`, `\P` codes
- **Multiline width auto-wrap on commit**: respects entity's original max-width box if present, else single column
- **Font picker**: edit-mode preserves existing font; switching font is a separate feature
- **ATTRIB editing in INSERT context**: edits the ATTRIB literal, but doesn't re-render every other INSERT instance of that block. Block-level attribute editing is its own project
- **Undo snapshot size**: capped at existing 20-deep stack; massive MTEXT (6850-fragment glyph snapshots) accepted as memory cost

---

## Success criteria

1. Load Funderingsherstel.dxf, click an MTEXT entity → magenta highlight (existing).
2. Press F2 → floating textbox appears at MTEXT anchor showing current text.
3. Edit a few characters → after 50 ms, the canvas re-renders with the new content visible.
4. Press Enter → overlay closes, scene retains the new text, status bar still shows correct entity count.
5. Press Ctrl+Z → text reverts to original, scene re-renders the original glyphs.
6. Press Esc during edit → overlay closes, no change committed.
7. Same flow works on a TEXT entity (single-line) in either DXF or DWG file.
8. Save As DXF → exported DXF contains the edited text in the MTEXT/TEXT entity.

---

## Risks

| # | Risk | Mitigation |
|---|------|-----------|
| 1 | Glyph tessellation refactor (block 4) breaks existing rendering | Test before/after segment counts on Funderingsherstel — must match |
| 2 | MTEXT control codes user-edits aren't valid → re-tessellate panics | Wrap re_tessellate in `Result` + show error toast on Failed; revert to `last_committed` |
| 3 | Multi-segment selection edits one entity at a time only | Acceptable: only single-entity edit in MVP; multi-entity batch edit later |
| 4 | Live preview re-tessellate is slow on big MTEXT | 50 ms debounce + show "rendering..." spinner if takes > 100 ms |
| 5 | Save As DXF exporter doesn't currently round-trip MTEXT formatting codes | Out of scope — user can save raw and verify externally |

---

## Approval

- [x] User: "Akkoord" 2026-05-01
- [ ] Spec self-review
- [ ] User reviews written spec
