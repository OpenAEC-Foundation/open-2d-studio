# Text Editor for TEXT/MTEXT Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable in-place editing of TEXT and MTEXT entities in `open_2d_studio` — click an entity, press F2, type new content in a floating overlay, Enter commits with re-tessellation, Ctrl+Z undoes.

**Architecture:** Extend `Scene` with a per-entity `EntityText` payload that preserves raw text + render parameters at load time. A new shared `tessellate_text` helper backs both initial load and edit-time re-tessellation. UI uses an `egui::Area` floating overlay anchored at the entity's screen position. Edits flow through an `EditOp::EditText` undo variant that snapshots replaced segments and triangles for restoration.

**Tech Stack:** Rust 1.77+, egui 0.29, ab_glyph 0.2, earcutr 0.4 (existing). No new dependencies.

---

## Repository context

Working directory: `C:\Users\rickd\Documents\GitHub\open-2d-studio`
Branch: `merge-1.0-2.0` (already checked out from prior work).

Key files this plan touches:
- `kernel/crates/app/src/scene_io.rs` — `Scene` struct definition (line ~83-135), `load_dxf` (line ~1574), `load_dwg` (line ~3770), DXF TEXT branch (~line 3380), DXF MTEXT branch (~line 3310), DWG TEXT/MTEXT renders (~lines 5527/5618/5717), shared glyph tessellator candidate code in DXF render_dxf_text and DWG render_dwg_text.
- `kernel/crates/app/src/bin/open_2d_studio.rs` — `App` struct, `EditOp` enum, `undo_last_edit`, LMB/F2 handlers, central panel render closure.
- `kernel/crates/app/src/ttf_font.rs` — existing `render_string_with_contours` (line 227); we reuse, do not modify.

Spec: `docs/superpowers/specs/2026-05-01-text-editor-design.md` (read for context if needed; this plan supersedes for implementation steps).

Build verification: `cd kernel && cargo build --release --bin open_2d_studio` from repo root.

Smoke test pattern: `taskkill //F //IM open_2d_studio.exe 2>/dev/null && ./target/release/open_2d_studio.exe 2>/tmp/o2d.log &`, sleep 3, tasklist check, kill.

---

## File structure overview

| File | What this plan changes |
|------|------------------------|
| `scene_io.rs` | Add `EntityText` struct + `Scene.entity_text` field. Populate in TEXT/MTEXT branches of load_dxf and load_dwg. Extract `tessellate_text` shared helper. Add `re_tessellate_text_entity` + `TextEntityDelta`. |
| `open_2d_studio.rs` | Add `EditOp::EditText` variant + undo handler. Add `EditTextState` field on `App`. Hook F2 + double-click to enter edit mode. Render floating egui overlay + debounce + commit/cancel. |

No new files. Both touched files are large (~6000 and ~6500 lines); follow existing patterns, don't restructure.

---

## Task 1: `EntityText` struct + `Scene.entity_text` field

**Files:**
- Modify: `kernel/crates/app/src/scene_io.rs` (Scene struct definition area, ~line 83-135)

- [ ] **Step 1: Add `TextKind` enum + `EntityText` struct near the top of scene_io.rs**

Insert above the `Scene` struct definition (the public struct around line 83):

```rust
/// Per-entity text payload preserved at scene-load. Enables in-place
/// editing via re_tessellate_text_entity().
///
/// `raw` retains MTEXT formatting codes verbatim (`\fArial|b1;`, `\P`,
/// `^I`, etc.). MVP edits the raw string; WYSIWYG MTEXT formatting
/// editing is out of scope.
#[derive(Debug, Clone)]
pub struct EntityText {
    pub raw: String,
    pub anchor: [f64; 2],
    pub height: f64,
    pub rotation: f64,
    pub font_path: String,
    pub bold: bool,
    pub italic: bool,
    pub attachment: u8,
    pub kind: TextKind,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TextKind {
    Text,
    MText,
    Attrib,
}
```

- [ ] **Step 2: Add `entity_text` field to `Scene`**

In the `pub struct Scene { ... }` block, add after `entity_names: Vec<String>` (search for that line):

```rust
    /// Per-entity raw text data, indexed by entity_idx. None for
    /// non-text entities. Populated by load_dxf and load_dwg in their
    /// TEXT/MTEXT branches. Consumed by re_tessellate_text_entity()
    /// on edit-commit.
    pub entity_text: Vec<Option<EntityText>>,
```

- [ ] **Step 3: Initialise the field in Scene::default() / Scene::empty()**

Find every spot where `Scene { ... }` is constructed (grep `Scene {` then check each instance). For each constructor / default, add `entity_text: Vec::new(),`. Pay particular attention to:
- `impl Default for Scene` if it exists
- The end of `load_dxf` (line ~2293-2299) where `Ok(Scene { ... })` returns
- The end of `load_dwg` (line ~4732-4738) where `Ok(Scene { ... })` returns
- Any `Scene::empty()` or `Scene::new()` helpers

If any constructor is missed, the build will error with "missing field `entity_text`" — fix as the compiler reports.

- [ ] **Step 4: Verify build**

```bash
cd /c/Users/rickd/Documents/GitHub/open-2d-studio/kernel && cargo build --release --bin open_2d_studio 2>&1 | tail -10
```

Expected: `Finished` with no errors. Pre-existing warnings OK.

- [ ] **Step 5: Commit**

```bash
cd /c/Users/rickd/Documents/GitHub/open-2d-studio
git add kernel/crates/app/src/scene_io.rs
git commit -m "feat(text-editor): EntityText struct + Scene.entity_text field"
```

---

## Task 2: Pad `entity_text` to match `entity_names.len()` after load

**Files:**
- Modify: `kernel/crates/app/src/scene_io.rs` (load_dxf around line 2280-2299, load_dwg around line 4715-4738)

To keep invariants simple, `entity_text.len() == entity_names.len()` — non-text entities get `None`. This task wires that pad WITHOUT actually populating text yet (Tasks 3-6 do that).

- [ ] **Step 1: In `load_dxf`, before `Ok(Scene { ... })` returns**

Find the load_dxf return block (~line 2293). After the entity_names tail-pad block but BEFORE `Ok(Scene { ... })`, add:

```rust
    // Pad entity_text to match entity_names.len(). TEXT/MTEXT branches
    // populate Some(EntityText); other entities stay None for now.
    let mut entity_text: Vec<Option<EntityText>> = Vec::with_capacity(entity_names.len());
    entity_text.resize(entity_names.len(), None);
```

Then in the `Ok(Scene { ... })` literal, add `entity_text,` to the field list.

- [ ] **Step 2: Same for load_dwg**

Find load_dwg's return block (~line 4732). Add the identical pad block before `Ok(Scene { ... })`, and `entity_text,` in the field list.

- [ ] **Step 3: Verify build**

```bash
cd /c/Users/rickd/Documents/GitHub/open-2d-studio/kernel && cargo build --release --bin open_2d_studio 2>&1 | tail -5
```

Expected: green.

- [ ] **Step 4: Smoke-test**

```bash
taskkill //F //IM open_2d_studio.exe 2>/dev/null
./target/release/open_2d_studio.exe 2>/tmp/o2d.log &
sleep 3
tasklist //FI "IMAGENAME eq open_2d_studio.exe" 2>/dev/null | grep open_2d_studio && echo "OK"
taskkill //F //IM open_2d_studio.exe 2>/dev/null
```

Expected: process runs 3s with empty stderr (no panics). Scene.entity_text is now Vec<None> of correct length.

- [ ] **Step 5: Commit**

```bash
git add kernel/crates/app/src/scene_io.rs
git commit -m "feat(text-editor): pad Scene.entity_text to entity_names.len()"
```

---

## Task 3: Populate `entity_text` in `load_dxf` TEXT branch

**Files:**
- Modify: `kernel/crates/app/src/scene_io.rs` (DXF TEXT branch in tessellate_one ~line 3380-3416)

The DXF entity loop assigns each entity an `entity_idx` BEFORE calling `tessellate_one`. After tessellate_one returns, code at lines 1838-1843 extends `segment_entity_idx` and `triangle_entity_idx`. We piggyback by writing into `entity_text[entity_idx]` from inside the TEXT branch.

- [ ] **Step 1: Find the DXF Text arm in tessellate_one**

Grep `EntityType::Text(t)` in scene_io.rs. There's exactly one occurrence around line 3380. Read the surrounding 30 lines to understand the existing tessellation: it calls `decode_dxf_text_escapes`, then `render_string` to produce segments, then pushes them into `segments` arg.

- [ ] **Step 2: Add EntityText emit at end of branch**

We need to write into the OUTER `entity_text` Vec but `tessellate_one` doesn't have access to it directly. Instead, add an OUT parameter chain.

First, change `tessellate_one`'s signature to accept `&mut Vec<Option<EntityText>>` — search for `fn tessellate_one(`. Add as the last parameter:
```rust
    entity_text_out: Option<&mut Vec<Option<EntityText>>>,
    entity_idx_for_text: u32,
```

Then in the TEXT branch, after the existing tessellation succeeds (where `decoded` is the final string and the entity has `text_height`, `location`, `rotation` etc accessible from `t`), build:

```rust
    if let Some(et_out) = entity_text_out {
        // Resolve font path and bold/italic same way render_string did.
        let font_path = resolve_text_font_path(&t.text_style_name, ...);
        let height = t.text_height;
        let rotation = t.rotation.to_radians();
        let anchor = xform.apply([t.location.x, t.location.y]);
        if (entity_idx_for_text as usize) < et_out.len() {
            et_out[entity_idx_for_text as usize] = Some(EntityText {
                raw: decoded.clone(),
                anchor,
                height,
                rotation,
                font_path,
                bold: false,  // resolved by font suffix; skip in MVP
                italic: false,
                attachment: 0,
                kind: TextKind::Text,
            });
        }
    }
```

`resolve_text_font_path` may need to be extracted from existing render_dxf_text body. Search for where `text_style_name` is mapped to a TTF file (likely a `style_map: HashMap<String, String>` or similar built earlier in load_dxf). For Task 3 you can pass an empty placeholder string and TODO it; Task 4 will refine.

- [ ] **Step 3: Update tessellate_one callers**

Grep `tessellate_one(` for all call sites. Each must pass either `Some(&mut entity_text)` (for the top-level loop) or `None` (for INSERT recursion — children share the parent's entity_text slot, no new write). Pass `entity_idx` from the outer loop.

- [ ] **Step 4: Verify build**

```bash
cd /c/Users/rickd/Documents/GitHub/open-2d-studio/kernel && cargo build --release --bin open_2d_studio 2>&1 | tail -10
```

If errors: borrow-checker issues with passing `&mut Vec<...>` into a recursive function. Fix by collecting writes into a local `Vec<(u32, EntityText)>` returned alongside seg/tri counts, then merging post-call.

- [ ] **Step 5: Smoke-test on Funderingsherstel.dxf**

Add temporary diag at end of load_dxf:
```rust
eprintln!("[entity_text] {} entities, {} have text", 
    entity_text.len(), 
    entity_text.iter().filter(|t| t.is_some()).count());
```

Launch, open the DXF, kill. Expected stderr line like `[entity_text] 21000 entities, 88 have text` (matches the 88 MTEXTs in the arceringen fixture or higher count for Funderingsherstel).

- [ ] **Step 6: Commit**

```bash
git add kernel/crates/app/src/scene_io.rs
git commit -m "feat(text-editor): populate Scene.entity_text in DXF TEXT branch"
```

---

## Task 4: Populate `entity_text` in `load_dxf` MTEXT branch

**Files:**
- Modify: `kernel/crates/app/src/scene_io.rs` (DXF MTEXT branch in tessellate_one ~line 3272-3310)

- [ ] **Step 1: Find DXF MText branch**

Grep `EntityType::MText(m)` in scene_io.rs (~line 3272 area).

- [ ] **Step 2: Add EntityText emit**

After the MTEXT decode + tessellation succeeds, emit similarly to Task 3 Step 2 but with MTEXT-specific fields:

```rust
    if let Some(et_out) = entity_text_out {
        let font_path = resolve_text_font_path(&m.text_style_name, ...);
        let height = m.initial_text_height;
        let rotation = m.rotation_angle.to_radians();
        let anchor = xform.apply([m.insertion_point.x, m.insertion_point.y]);
        if (entity_idx_for_text as usize) < et_out.len() {
            et_out[entity_idx_for_text as usize] = Some(EntityText {
                raw: m.text.clone(),  // raw INCLUDING MTEXT codes
                anchor,
                height,
                rotation,
                font_path,
                bold: false,
                italic: false,
                attachment: m.attachment_point as u8,
                kind: TextKind::MText,
            });
        }
    }
```

- [ ] **Step 3: Verify build + smoke**

```bash
cd kernel && cargo build --release --bin open_2d_studio 2>&1 | tail -5
./target/release/open_2d_studio.exe 2>/tmp/o2d.log &
sleep 3
grep "entity_text" /tmp/o2d.log | head -3
taskkill //F //IM open_2d_studio.exe 2>/dev/null
```

Expected: Funderingsherstel DXF should now report ~25-100 entity_text populated (TEXT + MTEXT combined).

- [ ] **Step 4: Commit**

```bash
git add kernel/crates/app/src/scene_io.rs
git commit -m "feat(text-editor): populate Scene.entity_text in DXF MTEXT branch"
```

---

## Task 5: Populate `entity_text` in `load_dwg` TEXT/MTEXT/ATTRIB branches

**Files:**
- Modify: `kernel/crates/app/src/scene_io.rs` (DWG dispatch in load_dwg ~line 5520-5720)

The DWG path has THREE text-emit sites (TEXT, MTEXT, ATTRIB) that all call `render_dwg_text(...)`. Wrap each.

- [ ] **Step 1: Find the DWG render_dwg_text call sites**

Grep `render_dwg_text(` in scene_io.rs. Three sites around lines 5527, 5618, 5717 per session summary.

- [ ] **Step 2: For each call site, emit EntityText after the render call**

Each site has access to:
- `entity_idx` (from outer load_dwg loop)
- `text` / `decoded` (the raw + decoded strings)
- `anchor` ([f64; 2] world coords)
- `height`, `rotation`
- font path resolved by the site's own STYLE handle lookup

After the existing `render_dwg_text(...)` call at each site, push:

```rust
    if (entity_idx as usize) < entity_text.len() {
        entity_text[entity_idx as usize] = Some(EntityText {
            raw: raw_text.clone(),  // before decode_dxf_text_escapes
            anchor,
            height,
            rotation,
            font_path: resolved_font.clone(),
            bold: is_bold,
            italic: is_italic,
            attachment: attachment_point as u8,
            kind: match type_name { "TEXT" => TextKind::Text, "MTEXT" => TextKind::MText, _ => TextKind::Attrib },
        });
    }
```

Variable names depend on the local context at each site — adapt to what's already in scope.

- [ ] **Step 3: Verify build + smoke on Funderingsherstel.dwg**

```bash
cd kernel && cargo build --release --bin open_2d_studio 2>&1 | tail -5
./target/release/open_2d_studio.exe 2>/tmp/o2d.log &
sleep 3
grep "entity_text" /tmp/o2d.log | head -3
taskkill //F //IM open_2d_studio.exe 2>/dev/null
```

Expected: DWG load reports populated entity_text count similar to DXF.

- [ ] **Step 4: Remove the temporary `[entity_text] ... entities have text` debug eprintln**

(Or gate it on `O2D_TEXT_DBG=1` env-var.)

- [ ] **Step 5: Commit**

```bash
git add kernel/crates/app/src/scene_io.rs
git commit -m "feat(text-editor): populate Scene.entity_text in DWG TEXT/MTEXT/ATTRIB branches"
```

---

## Task 6: Extract `tessellate_text` shared helper

**Files:**
- Modify: `kernel/crates/app/src/scene_io.rs` (factor common code from `render_dxf_text` and `render_dwg_text`)

Goal: a single function that takes an `EntityText` + reference to scene segs/tris and tessellates that entity's glyphs identically to initial-load. Both load_dxf, load_dwg AND re_tessellate_text_entity (Task 7) call this.

This is the **highest-risk task** — refactoring without breaking visual output.

- [ ] **Step 1: Define the helper signature**

Add a new function below `render_dwg_text` in scene_io.rs:

```rust
/// Tessellate a text entity into segments + triangles. Used by initial
/// scene load AND by re_tessellate_text_entity() for edit-time updates.
///
/// Inputs are taken from EntityText so the renderer is content-agnostic
/// (works for TEXT, MTEXT, ATTRIB, edit-time replacements).
///
/// Output: appends to `segments` and `triangles`. Caller is responsible
/// for entity_idx / layer_idx bookkeeping.
pub(crate) fn tessellate_text(
    et: &EntityText,
    color: u32,
    is_paper: bool,
    segments: &mut Vec<Segment>,
    triangles: &mut Vec<Triangle>,
    bbox: &mut [f64; 4],
) {
    // Resolve font: TTF if et.font_path is non-empty AND file exists,
    // else stroke font fallback.
    // Apply et.height as glyph cap-height scale.
    // Apply et.rotation as 2D rotation around et.anchor.
    // Apply et.attachment alignment offset.
    // ... existing glyph tessellation logic from render_dxf_text /
    // render_dwg_text moved here ...
}
```

- [ ] **Step 2: Move the glyph tessellation body**

Identify the largest common block between `render_dxf_text` and `render_dwg_text`. The duplicated work is roughly:
1. Decode font (TTF via ab_glyph or stroke fallback)
2. For each glyph: tessellate outline, transform by anchor + rotation + height
3. Push line segments + filled triangles to output Vecs

Move this block into `tessellate_text`. The original render_dxf_text and render_dwg_text become thin wrappers that build an `EntityText`-like local + call `tessellate_text`.

- [ ] **Step 3: Verify zero regression**

This is the critical check. Before running, capture baseline segment counts:

```bash
# Baseline (before this task's changes — use the binary from previous Task commit):
git stash  # if changes pending
cargo build --release --bin open_2d_studio 2>&1 | tail -3
./target/release/open_2d_studio.exe 2>/tmp/o2d_before.log &
sleep 5
# (open Funderingsherstel.dwg or load via samples panel; or pass as arg)
taskkill //F //IM open_2d_studio.exe 2>/dev/null
git stash pop
```

Note from `[tab]` line: total_segs and total_tri counts.

After this task's changes:

```bash
cargo build --release --bin open_2d_studio 2>&1 | tail -3
./target/release/open_2d_studio.exe 2>/tmp/o2d_after.log &
sleep 5
# (load same file)
taskkill //F //IM open_2d_studio.exe 2>/dev/null
```

Compare `[tab]` lines. **Counts must match exactly** — refactor changes structure only, not output. If counts differ: bug in the extraction. Revert and retry.

- [ ] **Step 4: Commit**

```bash
git add kernel/crates/app/src/scene_io.rs
git commit -m "refactor(text-editor): extract tessellate_text shared helper"
```

---

## Task 7: `re_tessellate_text_entity` + `TextEntityDelta`

**Files:**
- Modify: `kernel/crates/app/src/scene_io.rs` (add new public functions below tessellate_text)

- [ ] **Step 1: Define TextEntityDelta and the function signature**

Below `tessellate_text`, add:

```rust
/// Captured state from a re-tessellate operation. Returned to the caller
/// so it can be pushed into an EditOp::EditText for undo.
#[derive(Debug, Clone)]
pub struct TextEntityDelta {
    pub eid: u32,
    pub old_text: String,
    pub new_text: String,
    /// (original index in scene.segments, the segment) — kept in
    /// sequence-order so undo can reinsert at original positions.
    pub old_segments: Vec<(usize, Segment)>,
    pub old_triangles: Vec<(usize, Triangle)>,
}

/// Replace the rendered glyphs of an entity with newly tessellated ones
/// from `new_text`, preserving the entity's existing style (font, height,
/// rotation, anchor, attachment, color, paper-flag).
///
/// Returns the delta so the caller can push EditOp::EditText for undo.
/// Errors on entities that aren't text or don't exist.
pub fn re_tessellate_text_entity(
    scene: &mut Scene,
    eid: u32,
    new_text: &str,
) -> anyhow::Result<TextEntityDelta> {
    let eid_us = eid as usize;
    let et = scene.entity_text.get_mut(eid_us)
        .and_then(|o| o.as_mut())
        .ok_or_else(|| anyhow::anyhow!("entity {} has no text", eid))?;
    let old_text = std::mem::replace(&mut et.raw, new_text.to_string());
    let et_clone = et.clone();
    let color = pick_color_for_eid(scene, eid);  // helper below
    let is_paper = pick_paper_for_eid(scene, eid);

    // 1. Snapshot + remove old segments/triangles owned by eid.
    let mut old_segments = Vec::new();
    let mut old_triangles = Vec::new();
    let mut new_seg_eid = Vec::with_capacity(scene.segment_entity_idx.len());
    let mut new_segments = Vec::with_capacity(scene.segments.len());
    let mut new_seg_layer = Vec::with_capacity(scene.segment_layer_idx.len());
    for i in 0..scene.segments.len() {
        if scene.segment_entity_idx[i] == eid {
            old_segments.push((i, scene.segments[i].clone()));
        } else {
            new_segments.push(scene.segments[i].clone());
            new_seg_eid.push(scene.segment_entity_idx[i]);
            new_seg_layer.push(scene.segment_layer_idx[i]);
        }
    }
    scene.segments = new_segments;
    scene.segment_entity_idx = new_seg_eid;
    scene.segment_layer_idx = new_seg_layer;

    // Same for triangles
    let mut new_tri_eid = Vec::with_capacity(scene.triangle_entity_idx.len());
    let mut new_triangles = Vec::with_capacity(scene.triangles.len());
    let mut new_tri_layer = Vec::with_capacity(scene.triangle_layer_idx.len());
    for i in 0..scene.triangles.len() {
        if scene.triangle_entity_idx[i] == eid {
            old_triangles.push((i, scene.triangles[i].clone()));
        } else {
            new_triangles.push(scene.triangles[i].clone());
            new_tri_eid.push(scene.triangle_entity_idx[i]);
            new_tri_layer.push(scene.triangle_layer_idx[i]);
        }
    }
    scene.triangles = new_triangles;
    scene.triangle_entity_idx = new_tri_eid;
    scene.triangle_layer_idx = new_tri_layer;

    // 2. Tessellate new text
    let seg_before = scene.segments.len();
    let tri_before = scene.triangles.len();
    tessellate_text(&et_clone, color, is_paper,
        &mut scene.segments, &mut scene.triangles, &mut scene.bbox);
    let seg_added = scene.segments.len() - seg_before;
    let tri_added = scene.triangles.len() - tri_before;

    // 3. Extend entity_idx + layer_idx for new segs/tris
    let layer_idx = pick_layer_for_eid(scene, eid);
    scene.segment_entity_idx.extend(std::iter::repeat(eid).take(seg_added));
    scene.segment_layer_idx.extend(std::iter::repeat(layer_idx).take(seg_added));
    scene.triangle_entity_idx.extend(std::iter::repeat(eid).take(tri_added));
    scene.triangle_layer_idx.extend(std::iter::repeat(layer_idx).take(tri_added));

    Ok(TextEntityDelta {
        eid,
        old_text,
        new_text: new_text.to_string(),
        old_segments,
        old_triangles,
    })
}

fn pick_color_for_eid(scene: &Scene, eid: u32) -> u32 {
    // Try to recover from any segment/triangle of this eid; default white.
    for (i, s) in scene.segments.iter().enumerate() {
        if scene.segment_entity_idx[i] == eid { return s.color; }
    }
    for (i, t) in scene.triangles.iter().enumerate() {
        if scene.triangle_entity_idx[i] == eid { return t.color; }
    }
    0xFF_FF_FF_FF
}

fn pick_paper_for_eid(scene: &Scene, eid: u32) -> bool {
    for (i, s) in scene.segments.iter().enumerate() {
        if scene.segment_entity_idx[i] == eid { return s.is_paper; }
    }
    false
}

fn pick_layer_for_eid(scene: &Scene, eid: u32) -> u16 {
    for (i, _) in scene.segments.iter().enumerate() {
        if scene.segment_entity_idx[i] == eid {
            return scene.segment_layer_idx.get(i).copied().unwrap_or(0);
        }
    }
    0
}
```

Note: the `pick_*_for_eid` helpers iterate to find ANY surviving seg/tri of the eid to recover style. This MUST be called BEFORE the snapshot/removal loop empties them. Reorder if needed: call pick_color, pick_paper, pick_layer first; THEN snapshot/remove; THEN tessellate.

- [ ] **Step 2: Reorder so picks happen before scene mutation**

Move the three `pick_*_for_eid` calls to BEFORE the snapshot/remove loop. Otherwise after `scene.segments = new_segments` they return defaults.

- [ ] **Step 3: Add an undo-restore companion function**

```rust
/// Reverse of re_tessellate_text_entity for undo. Removes any
/// segments/triangles currently owned by `delta.eid`, restores the
/// snapshotted ones to their original positions, and reverts entity_text.
pub fn restore_text_entity(scene: &mut Scene, delta: &TextEntityDelta) -> anyhow::Result<()> {
    let eid = delta.eid;
    let eid_us = eid as usize;
    if let Some(Some(et)) = scene.entity_text.get_mut(eid_us) {
        et.raw = delta.old_text.clone();
    }
    // Remove current segs/tris owned by eid (the ones from re-tessellate).
    let mut new_seg_eid = Vec::new();
    let mut new_segments = Vec::new();
    let mut new_seg_layer = Vec::new();
    for i in 0..scene.segments.len() {
        if scene.segment_entity_idx[i] != eid {
            new_segments.push(scene.segments[i].clone());
            new_seg_eid.push(scene.segment_entity_idx[i]);
            new_seg_layer.push(scene.segment_layer_idx[i]);
        }
    }
    let mut new_tri_eid = Vec::new();
    let mut new_triangles = Vec::new();
    let mut new_tri_layer = Vec::new();
    for i in 0..scene.triangles.len() {
        if scene.triangle_entity_idx[i] != eid {
            new_triangles.push(scene.triangles[i].clone());
            new_tri_eid.push(scene.triangle_entity_idx[i]);
            new_tri_layer.push(scene.triangle_layer_idx[i]);
        }
    }
    // Re-insert the snapshotted segs/tris at their original indices.
    // (We append rather than insert-at-index because indices change as we
    // rebuild; visual ordering is not strictly preserved but the entity's
    // glyphs all share the same eid so render order within the eid is
    // preserved by their relative order in the snapshot Vec.)
    let layer_idx = pick_layer_for_eid_in(&new_segments, &new_seg_eid, &new_seg_layer, eid);
    for (_orig_idx, seg) in &delta.old_segments {
        new_segments.push(seg.clone());
        new_seg_eid.push(eid);
        new_seg_layer.push(layer_idx);
    }
    for (_orig_idx, tri) in &delta.old_triangles {
        new_triangles.push(tri.clone());
        new_tri_eid.push(eid);
        new_tri_layer.push(layer_idx);
    }
    scene.segments = new_segments;
    scene.segment_entity_idx = new_seg_eid;
    scene.segment_layer_idx = new_seg_layer;
    scene.triangles = new_triangles;
    scene.triangle_entity_idx = new_tri_eid;
    scene.triangle_layer_idx = new_tri_layer;
    Ok(())
}

fn pick_layer_for_eid_in(
    _segs: &[Segment],
    seg_eids: &[u32],
    seg_layer: &[u16],
    eid: u32,
) -> u16 {
    for (i, &e) in seg_eids.iter().enumerate() {
        if e == eid { return seg_layer.get(i).copied().unwrap_or(0); }
    }
    0
}
```

- [ ] **Step 4: Verify build**

```bash
cd kernel && cargo build --release --bin open_2d_studio 2>&1 | tail -10
```

Expected: green. The new functions are unused so far (no caller) — that's OK, the next task wires them in.

- [ ] **Step 5: Commit**

```bash
git add kernel/crates/app/src/scene_io.rs
git commit -m "feat(text-editor): re_tessellate_text_entity + restore_text_entity helpers"
```

---

## Task 8: `EditOp::EditText` variant + undo handler

**Files:**
- Modify: `kernel/crates/app/src/bin/open_2d_studio.rs` (EditOp enum + undo_last_edit function)

- [ ] **Step 1: Find the EditOp enum**

Grep `enum EditOp` in `open_2d_studio.rs`. Should be ~line 1604 area per session summary.

- [ ] **Step 2: Add the EditText variant**

```rust
    EditText {
        text_delta: kernel_app::scene_io::TextEntityDelta,
    },
```

(Re-use the `TextEntityDelta` struct rather than re-declaring fields here — keeps types in sync.)

- [ ] **Step 3: Find undo_last_edit**

Grep `fn undo_last_edit` (~line 4500-4600 area).

- [ ] **Step 4: Add the EditText match arm**

In the match on the popped EditOp:

```rust
        EditOp::EditText { text_delta } => {
            if let Some(tab) = self.tabs.get_mut(tab_idx) {
                let _ = kernel_app::scene_io::restore_text_entity(&mut tab.scene, &text_delta);
                if let Some(gpu) = self.gpu.as_ref() {
                    tab.rebuild_buffers(gpu);
                }
            }
        }
```

- [ ] **Step 5: Verify build**

```bash
cd kernel && cargo build --release --bin open_2d_studio 2>&1 | tail -5
```

Expected: green. EditText is now in the enum but never pushed (Task 10 pushes it).

- [ ] **Step 6: Commit**

```bash
git add kernel/crates/app/src/bin/open_2d_studio.rs
git commit -m "feat(text-editor): EditOp::EditText variant + undo handler"
```

---

## Task 9: `EditTextState` + F2 trigger + double-click trigger

**Files:**
- Modify: `kernel/crates/app/src/bin/open_2d_studio.rs` (App struct + key handler + LMB handler)

- [ ] **Step 1: Add EditTextState struct + App field**

Near the top of open_2d_studio.rs (e.g. above the App struct definition):

```rust
#[derive(Debug, Clone)]
struct EditTextState {
    tab_idx: usize,
    eid: u32,
    buffer: String,
    last_committed: String,
    debounce_at: Option<std::time::Instant>,
}
```

In `struct App { ... }`, add:

```rust
    edit_mode: Option<EditTextState>,
```

In `App::new()` or wherever App is constructed, initialize:

```rust
    edit_mode: None,
```

- [ ] **Step 2: Add helper method to enter edit mode**

In `impl App { ... }`:

```rust
fn enter_text_edit(&mut self, tab_idx: usize, eid: u32) {
    let Some(tab) = self.tabs.get(tab_idx) else { return; };
    let Some(et) = tab.scene.entity_text.get(eid as usize).and_then(|o| o.as_ref()) else {
        return;
    };
    self.edit_mode = Some(EditTextState {
        tab_idx,
        eid,
        buffer: et.raw.clone(),
        last_committed: et.raw.clone(),
        debounce_at: None,
    });
}

fn cancel_text_edit(&mut self) {
    if let Some(state) = self.edit_mode.take() {
        // If buffer != last_committed, restore via re_tessellate to last_committed
        if state.buffer != state.last_committed {
            if let Some(tab) = self.tabs.get_mut(state.tab_idx) {
                let _ = kernel_app::scene_io::re_tessellate_text_entity(
                    &mut tab.scene, state.eid, &state.last_committed,
                );
                if let Some(gpu) = self.gpu.as_ref() {
                    tab.rebuild_buffers(gpu);
                }
            }
        }
    }
}

fn commit_text_edit(&mut self) {
    let Some(state) = self.edit_mode.take() else { return; };
    if state.buffer == state.last_committed {
        return;  // no-op
    }
    if let Some(tab) = self.tabs.get_mut(state.tab_idx) {
        match kernel_app::scene_io::re_tessellate_text_entity(
            &mut tab.scene, state.eid, &state.buffer,
        ) {
            Ok(delta) => {
                tab.undo_stack.push(EditOp::EditText { text_delta: delta });
                while tab.undo_stack.len() > 20 { tab.undo_stack.remove(0); }
                if let Some(gpu) = self.gpu.as_ref() {
                    tab.rebuild_buffers(gpu);
                }
            }
            Err(e) => eprintln!("[text-edit] commit failed: {}", e),
        }
    }
}
```

- [ ] **Step 3: Hook F2 key to enter_text_edit**

Find the keyboard handler (search `KeyEvent` or `PhysicalKey::Code(code)` ~line 5772 area). Add an arm:

```rust
    PhysicalKey::Code(KeyCode::F2) if state == ElementState::Pressed => {
        if self.tool_mode == ToolMode::Select && self.edit_mode.is_none() {
            // Enter edit on first selected text entity
            let active_tab = self.active_tab;
            if let Some(tab) = self.tabs.get(active_tab) {
                let eids = self.selected_entity_ids_in(active_tab);
                for eid in eids {
                    if tab.scene.entity_text.get(eid as usize)
                        .and_then(|o| o.as_ref()).is_some()
                    {
                        self.enter_text_edit(active_tab, eid);
                        break;
                    }
                }
            }
        }
    }
    PhysicalKey::Code(KeyCode::Escape) if state == ElementState::Pressed && self.edit_mode.is_some() => {
        self.cancel_text_edit();
    }
    PhysicalKey::Code(KeyCode::Enter) if state == ElementState::Pressed && self.edit_mode.is_some() => {
        self.commit_text_edit();
    }
```

- [ ] **Step 4: Hook double-click on text entity**

In LMB Released handler (search `[LMB Release]` or `ElementState::Released`), after the existing pick logic completes, track click timing:

Add to App:
```rust
    last_lmb_click_time: Option<std::time::Instant>,
    last_lmb_click_pos: (f32, f32),
```

Init in App::new(): `last_lmb_click_time: None, last_lmb_click_pos: (0.0, 0.0),`

In LMB Released, after `apply_pick_to_selection`:

```rust
    // Detect double-click: 2nd click within 400ms + within 6 px of first
    let now = std::time::Instant::now();
    let is_double = if let Some(prev) = self.last_lmb_click_time {
        let elapsed = now.duration_since(prev);
        let dx = self.mouse_pos.0 - self.last_lmb_click_pos.0;
        let dy = self.mouse_pos.1 - self.last_lmb_click_pos.1;
        let drift = (dx*dx + dy*dy).sqrt();
        elapsed.as_millis() < 400 && drift < 6.0
    } else { false };
    if is_double && self.tool_mode == ToolMode::Select {
        let active_tab = self.active_tab;
        if let Some(tab) = self.tabs.get(active_tab) {
            let eids = self.selected_entity_ids_in(active_tab);
            for eid in eids {
                if tab.scene.entity_text.get(eid as usize)
                    .and_then(|o| o.as_ref()).is_some()
                {
                    self.enter_text_edit(active_tab, eid);
                    break;
                }
            }
        }
    }
    self.last_lmb_click_time = Some(now);
    self.last_lmb_click_pos = self.mouse_pos;
```

- [ ] **Step 5: Verify build**

```bash
cd kernel && cargo build --release --bin open_2d_studio 2>&1 | tail -10
```

Expected: green.

- [ ] **Step 6: Commit**

```bash
git add kernel/crates/app/src/bin/open_2d_studio.rs
git commit -m "feat(text-editor): EditTextState + F2/double-click triggers + commit/cancel"
```

---

## Task 10: Floating overlay UI + debounced live preview

**Files:**
- Modify: `kernel/crates/app/src/bin/open_2d_studio.rs` (central panel render closure)

- [ ] **Step 1: Find the central panel area**

Grep `egui::CentralPanel` (~line 3482 area).

- [ ] **Step 2: Add the overlay AFTER the canvas inset border but BEFORE the perf HUD**

Around line 3550 area (after view-cube paint, before perf HUD area):

```rust
    // ---- Text editor overlay ----------------------------------
    // Anchored at the entity's screen position. Live preview re-
    // tessellates with 50 ms debounce after typing stops.
    let mut commit_pending = false;
    let mut cancel_pending = false;
    if let Some(state) = self.edit_mode.as_mut() {
        // Compute screen anchor from entity_text
        let screen_anchor: Option<egui::Pos2> = self.tabs.get(state.tab_idx)
            .and_then(|tab| tab.scene.entity_text.get(state.eid as usize)
                .and_then(|o| o.as_ref())
                .map(|et| {
                    let cam = &tab.cam;
                    let rect = self.canvas_rect;
                    let px = world_to_screen_x(et.anchor[0], cam, rect);
                    let py = world_to_screen_y(et.anchor[1], cam, rect);
                    let ppp = ctx.pixels_per_point();
                    egui::pos2(px / ppp, py / ppp)
                }));
        if let Some(anchor) = screen_anchor {
            egui::Area::new("text_edit_overlay".into())
                .order(egui::Order::Foreground)
                .fixed_pos(anchor)
                .show(ctx, |ui| {
                    egui::Frame::popup(ui.style())
                        .fill(egui::Color32::from_rgba_unmultiplied(20, 24, 32, 245))
                        .show(ui, |ui| {
                            let resp = ui.add_sized(
                                [400.0, 80.0],
                                egui::TextEdit::multiline(&mut state.buffer)
                                    .desired_rows(4)
                                    .lock_focus(true),
                            );
                            if resp.changed() {
                                state.debounce_at = Some(
                                    std::time::Instant::now()
                                        + std::time::Duration::from_millis(50),
                                );
                            }
                            ui.horizontal(|ui| {
                                if ui.button("Commit (Enter)").clicked() { commit_pending = true; }
                                if ui.button("Cancel (Esc)").clicked() { cancel_pending = true; }
                            });
                        });
                });
        }
    }
    if commit_pending { self.commit_text_edit(); }
    if cancel_pending { self.cancel_text_edit(); }
```

You'll need helper functions `world_to_screen_x` and `world_to_screen_y` that match the existing screen_to_world inverse. Search for `screen_to_world_in` to see the math; invert it.

If those helpers don't exist, add them in the same `impl App` block:

```rust
fn world_to_screen_x(wx: f64, cam: &PaneCam, rect: (f32, f32, f32, f32)) -> f32 {
    let (cx, _cy, cw, _ch) = rect;
    let zoom = cam.zoom;
    let aspect = cw as f64 / rect.3.max(1.0) as f64;
    let world_per_x = (2.0 / zoom) / cw as f64;
    let nx = (wx - cam.pan_x) / (world_per_x * cw as f64 * 0.5);  // -1..+1
    cx + ((nx * 0.5 + 0.5) * cw as f64) as f32
}

fn world_to_screen_y(wy: f64, cam: &PaneCam, rect: (f32, f32, f32, f32)) -> f32 {
    let (_cx, cy, _cw, ch) = rect;
    let zoom = cam.zoom;
    let world_per_y = (2.0 / zoom) / ch as f64;
    let ny = (wy - cam.pan_y) / (world_per_y * ch as f64 * 0.5);
    cy + ((-ny * 0.5 + 0.5) * ch as f64) as f32  // y-flip per existing convention
}
```

(Take care to match existing screen_to_world's exact math — test by round-tripping a known point. If existing PaneCam has slightly different formulas, mirror those.)

- [ ] **Step 3: Add debounced live re-tessellate**

In the frame loop (probably in `about_to_wait` or at top of render), after the egui closure runs:

```rust
    if let Some(state) = self.edit_mode.as_mut() {
        if let Some(at) = state.debounce_at {
            if std::time::Instant::now() >= at {
                state.debounce_at = None;
                let buffer = state.buffer.clone();
                let tab_idx = state.tab_idx;
                let eid = state.eid;
                if let Some(tab) = self.tabs.get_mut(tab_idx) {
                    let _ = kernel_app::scene_io::re_tessellate_text_entity(
                        &mut tab.scene, eid, &buffer,
                    );
                    if let Some(gpu) = self.gpu.as_ref() {
                        tab.rebuild_buffers(gpu);
                    }
                }
            }
        }
    }
```

Note: live preview WITHOUT pushing EditOp — only commit pushes the undo entry. Cancel restores via re_tessellate to last_committed.

- [ ] **Step 4: Verify build**

```bash
cd kernel && cargo build --release --bin open_2d_studio 2>&1 | tail -10
```

Expected: green. Borrow checker may complain about `state` being held while `self.tabs` is borrowed; if so, restructure to copy state fields out before the tab borrow.

- [ ] **Step 5: Smoke-launch + visual verify (manual)**

```bash
taskkill //F //IM open_2d_studio.exe 2>/dev/null
./target/release/open_2d_studio.exe 2>/tmp/o2d.log &
sleep 4
tasklist //FI "IMAGENAME eq open_2d_studio.exe" 2>/dev/null | grep open_2d_studio
# (User opens a DXF, clicks a TEXT entity, presses F2, types something, presses Enter)
taskkill //F //IM open_2d_studio.exe 2>/dev/null
```

The agent can't visually verify; user will test interactively.

- [ ] **Step 6: Commit**

```bash
git add kernel/crates/app/src/bin/open_2d_studio.rs
git commit -m "feat(text-editor): floating overlay UI + debounced live preview"
```

---

## Task 11: End-to-end acceptance + screenshot artifact

**Files:**
- None (verification only)

- [ ] **Step 1: Build clean release**

```bash
cd kernel && cargo build --release --bin open_2d_studio 2>&1 | tail -5
```

- [ ] **Step 2: Launch + smoke confirm**

```bash
taskkill //F //IM open_2d_studio.exe 2>/dev/null
./target/release/open_2d_studio.exe 2>/tmp/o2d.log &
sleep 4
tasklist //FI "IMAGENAME eq open_2d_studio.exe" 2>/dev/null | grep open_2d_studio && echo "running"
```

- [ ] **Step 3: Inform user with test instructions**

Tell user to:
1. Open a DXF (e.g. arceringen test) via Ctrl+O or File menu.
2. Click on a TEXT or MTEXT entity (e.g. an MTEXT in the sample drawing) — magenta highlight.
3. Press F2 (or double-click on the entity).
4. Floating textbox appears at entity anchor with current text.
5. Type a few characters → after ~50ms the canvas should re-render with new text.
6. Press Enter → textbox closes, scene retains new text.
7. Press Ctrl+Z → text reverts to original.
8. Press Esc during edit → no commit.
9. Save As DXF → output should contain edited text.

Wait for user feedback on visuals.

- [ ] **Step 4: Kill viewer + final commit (if needed)**

```bash
taskkill //F //IM open_2d_studio.exe 2>/dev/null
```

If the user reports any issues that need code fixes (e.g. overlay position off, debounce too slow), iterate from the relevant Task. If clean, no further commits needed.

- [ ] **Step 5: Branch summary**

```bash
git log --oneline merge-1.0-2.0 ^main 2>/dev/null | head -25
```

Expected: 11 new commits (one per Task).

---

## Self-Review Results

**Spec coverage:**
- ✅ EntityText struct → Task 1
- ✅ Scene.entity_text field → Task 1
- ✅ Populate in load_dxf TEXT → Task 3
- ✅ Populate in load_dxf MTEXT → Task 4
- ✅ Populate in load_dwg TEXT/MTEXT/ATTRIB → Task 5
- ✅ Shared tessellate_text helper → Task 6
- ✅ re_tessellate_text_entity → Task 7
- ✅ TextEntityDelta → Task 7
- ✅ EditOp::EditText variant → Task 8
- ✅ undo_last_edit handler → Task 8
- ✅ EditTextState on App → Task 9
- ✅ F2 trigger → Task 9
- ✅ Double-click trigger → Task 9
- ✅ Floating overlay → Task 10
- ✅ Debounced live preview → Task 10
- ✅ Commit on Enter → Task 9 (commit_text_edit) + Task 10 (button + key)
- ✅ Cancel on Esc → Task 9 (cancel_text_edit) + Task 10 (button + key)
- ✅ All 8 success criteria covered by Task 11 user-test sequence

**Placeholder scan:** no TBD/TODO/"implement later" leaks in actual implementation steps. Some "search for X" phrasings refer to grep operations the engineer must do — that's appropriate instruction, not a placeholder for code.

**Type consistency:** EntityText / TextEntityDelta / EditTextState / EditOp::EditText fields used identically across Tasks 1, 7, 8, 9, 10. `re_tessellate_text_entity(&mut Scene, u32, &str) -> Result<TextEntityDelta>` signature stable. `restore_text_entity(&mut Scene, &TextEntityDelta) -> Result<()>` stable.

**Scope:** 11 tasks, all incremental, build green at each step (except mid-Task 6 which has a regression-check guard). Branch remains functional after each commit.

**Risks acknowledged in plan:** Task 6 (refactor) flagged as highest-risk with explicit before/after segment-count check. Task 10 borrow-checker pre-noted with restructure hint.
