# Open 2D Studio — Drawing Primitives & Edit Operations Design

> **Status:** DESIGN ONLY — awaiting user approval. No code is to be written from this document. Implementation will be planned and executed in separate sessions after sign-off.
>
> **Date:** 2026-05-01
> **Branch:** `merge-1.0-2.0`
> **Author:** Claude (Opus 4.7)
> **Companion specs:** `2026-05-01-ui-crate-design.md`, `2026-05-01-text-editor-design.md`

---

## 1. Goal

Bring the full **drawing-and-editing experience** of Open 2D Studio 1.0 into the native 2.0 Rust binary (`kernel/crates/app/src/bin/open_2d_studio.rs`), modeled on the interaction paradigms that professional CAD users already know from AutoCAD, Blender, and Revit.

The 2.0 binary today supports only *navigation + selection + transform* (Select, Move, Measure, Dimension, Area, Rotate, Scale, Mirror, Copy with multi-select, drag-box, hover preview, undo). It has **no creation tools** for primitives, hatches, dimensions in the entity-creating sense (the Dimension tool is currently an annotation overlay only), and no advanced modify ops (Trim, Extend, Offset, Fillet, Chamfer, Array, Stretch). 1.0 has roughly 30 drawing tools and 15 modify operations.

This document:

1. Inventories what 1.0 ships.
2. Compares the three interaction paradigms (AutoCAD / Blender / Revit) and proposes a deliberate blend for 2.0.
3. Sketches a layered architecture (Snap engine → Tool state machines → EditOp / Undo → UI dispatch).
4. Decomposes the work into Phases A through H.
5. Defines a concrete Phase A first slice that's deliverable in 1–2 weeks.
6. Lists risks + open questions.

**Non-goals (deferred to later specs):**

- Sheet-layout tools (`sheet-text`, `sheet-leader`, `sheet-dimension`, `sheet-callout`, `sheet-revision-cloud`).
- Domain-specific structural / IFC tools (Beam, Pile, Column, Wall, Slab, PlateSystem, Gridline, Level, SectionCallout, SpaceDetect, CPT, SpotElevation, Rebar, L-Shape, Puntniveau). These pair with a future "AEC tool pack" spec because they each carry parametric IFC behaviour.
- Constraint engine (parametric sketch constraints) — has its own spec at `2026-04-02-parametric-constraint-engine-design.md`.
- Filled-region sketch sub-mode (a meta-mode that wraps Line/Rect/Polygon/etc to define a hatch boundary) — covered as a sub-feature of Phase C.

---

## 2. 1.0 Inventory

Source files live under `C:\Users\rickd\Documents\GitHub\open-2d-studio\src\`.

### 2.1 Drawing tools (creation)

| 1.0 tool      | Where | Notes |
|---|---|---|
| Line          | `hooks/drawing/` (chain mode lives in `toolSlice.ts`) | First-class; chain-mode default ON |
| Rectangle     | `useShapeDrawing.ts` (with `RectangleMode`: corner / center / 3-point) | Three placement modes |
| Circle        | `useShapeDrawing.ts` (`CircleMode`: center-radius / center-diameter / 2-point / 3-point) | Four modes |
| Arc           | `useShapeDrawing.ts` (`arcMode`: 3-point / center-start-end / start-end-radius / fillet / tangent) | Five modes |
| Polyline      | `useShapeDrawing.ts` + arc-segment toggle (`polylineArcMode`, `polylineArcThroughPoint`) | Mixed straight/arc segments via bulge |
| Ellipse       | `useShapeDrawing.ts` (`ellipseMode`: center-axes / corner / partial) | Three modes |
| Spline        | `useShapeDrawing.ts` + `engine/geometry/SplineUtils.ts` (`splineMode`: fit-points / control-points) | Two construction modes |
| Text          | `useTextDrawing.ts` (text editor itself in `2026-05-01-text-editor-design.md`) | Single-line + MTEXT |
| Leader        | `useLeaderDrawing.ts` | Configurable arrow + landing |
| Label         | `useLabelDrawing.ts` | Tagged annotation |
| Dimension     | `useDimensionDrawing.ts` (`DimensionType`: linear / aligned / angular / radial / diameter / arc-length / continuous / baseline) | Eight sub-types; preset styles |
| Detail Line   | `useDetailLineDrawing.ts` | Symbolic linework w/ insulation patterns |
| Hatch         | `useShapeDrawing.ts` + `services/export/svgPatterns.ts` + `editors/PatternManager` | 7 pattern presets + custom SVG |
| Filled Region | `toolSlice.ts` (`filledRegionMode`) — Revit-style sketch sub-mode | Outer + inner loops |
| **AEC pack** (deferred) | `useBeamDrawing`, `useColumnDrawing`, `useWallDrawing`, `useSlabDrawing`, `useSlabOpeningDrawing`, `useSlabLabelDrawing`, `usePileDrawing`, `useCPTDrawing`, `useGridlineDrawing`, `useLevelDrawing`, `useSectionCalloutDrawing`, `useSpaceDrawing`, `useSpotCoordinateDrawing`, `usePuntniveauDrawing`, `useLShapeDrawing`, `usePlateSystemDrawing` | Out of scope for this spec |
| Image insert  | `ToolType: 'image'` | Raster placement, deferred |

**Total counted creation tools (1.0):** 14 generic + 16 AEC = 30.
**In scope for this spec:** the 14 generic tools (Line, Rectangle, Circle, Arc, Polyline, Ellipse, Spline, Text, Leader, Label, Dimension, Detail-Line, Hatch, Filled-Region).

### 2.2 Modify / edit operations

From `src/types/geometry.ts` `ToolType` (the "Modify tools — legacy now commands" block) plus `hooks/editing/`:

| 1.0 modify op | Description | 1.0 file |
|---|---|---|
| Move    | Translate selection by [from→to] | `hooks/editing/useModifyTools.ts` |
| Copy    | Move + duplicate (single)        | same |
| Copy2   | Move + duplicate (multi-place)   | same |
| Rotate  | Rotate around pivot              | same |
| Scale   | Uniform scale around pivot (graphical / numerical) | same |
| Mirror  | Reflect across axis              | same |
| Trim    | Cut entities at intersections with cutting edge | same |
| Extend  | Extend entity to boundary edge | same |
| Fillet  | Replace corner with tangent arc of radius R | same |
| Chamfer | Replace corner with bevel of distances d1/d2 | same |
| Offset  | Parallel-offset with flip toggle | same |
| Array   | Linear (count + spacing) or Radial (count + total angle) duplication | same |
| Elastic | Stretch — drag a window-crossed endpoints set | `hooks/editing/useModifyTools.ts` |
| Align   | Align two entities (origin → target) | same |
| Split   | Break entity at a picked point   | `hooks/editing/useSplitTool.ts` |
| Trim-walls | Wall-aware trim (AEC pack)    | same — deferred |
| Join    | Merge collinear/coplanar entities | same |
| Grip-edit | Drag endpoint / midpoint / center handles to modify in place | `hooks/editing/useGripEditing.ts` |
| Annotation edit | Drag dim text, dim line, witness lines | `hooks/editing/useAnnotationEditing.ts` |
| Boundary edit | Edit hatch / filled-region boundary | `hooks/editing/useBoundaryEditing.ts` |
| Title-block edit | Sheet titleblock fields | `hooks/editing/useTitleBlockEditing.ts` — deferred |
| Viewport edit | Sheet viewport pan/zoom/clip | `hooks/editing/useViewportEditing.ts` — deferred |

**In scope for this spec:** Move, Copy, Copy2, Rotate, Scale, Mirror, Trim, Extend, Fillet, Chamfer, Offset, Array, Elastic (Stretch), Align, Split, Join, Grip-edit, Annotation-edit, Boundary-edit. Total = 19. (2.0 already has Move/Rotate/Scale/Mirror/Copy as transforms; the rest are net-new.)

### 2.3 Snap & tracking modes

From `src/types/geometry.ts:1480-1491` and `state/slices/snapSlice.ts`:

| Snap type | Description |
|---|---|
| `endpoint` | Line endpoint, polyline vertex, arc endpoint, dim witness end |
| `midpoint` | Mid of segment / polyline edge / arc |
| `center`   | Circle / arc / ellipse center |
| `intersection` | Two-entity crossing point |
| `perpendicular` | Foot of perpendicular from previous pick |
| `parallel`     | Parallel inference from another segment |
| `tangent`      | Tangent from previous pick to a circle / arc / ellipse |
| `nearest`      | Nearest point on any entity |
| `origin`       | World origin |
| `grid`         | Grid intersection |
| `alignment`    | Object snap tracking — H / V alignment from a previously hovered key point |

Plus three orthogonal modes:

- **Ortho mode** — constrain cursor to H / V from the previous pick (toggles polar off when on).
- **Polar tracking** — constrain to integer multiples of `polarAngleIncrement` (default 45°).
- **Object tracking** — temporary alignment lines from hovered-but-not-clicked snap points.

Direct distance entry (`directDistanceAngle`) is the AutoCAD pattern: hover along a tracked direction → type `1500` Enter → places point at 1500 units along that direction.

### 2.4 Inputs / dispatchers

- `hooks/keyboard/useDrawingKeyboard.ts` — per-tool keyboard mapping.
- `hooks/keyboard/useGlobalKeyboard.ts` — Ctrl+Z / Y, Esc, Enter, Tab, Space (repeat).
- `hooks/keyboard/useKeyboardShortcuts.ts` — hotkey dispatch via `KeyboardShortcutRegistry`.
- `components/canvas/DynamicInput/` — AutoCAD-style HUD floating near cursor for distance + angle.
- `components/canvas/ToolOptionsBar/` — context-sensitive options strip per active tool.
- `components/canvas/ShortcutHUD.tsx` — shows active shortcuts.

---

## 3. Paradigm comparison & chosen blend

### 3.1 AutoCAD-style (the "command-line CAD" school)

- **Modal commands.** Type `L` Enter → enters Line mode → click p1, click p2, click p3, … press Enter or Esc to finish. All tools follow `<command> <prompt> <prompt> …` rhythm.
- **OSNAP overlay.** A persistent set of object-snap modes (endpoint, midpoint, center, …) toggled in the status bar. While drawing, the cursor crosshair shows a glyph for whichever snap is active under it.
- **Direct distance entry.** Hover in a polar / ortho direction, type `1500` Enter → places at 1500 units in that direction.
- **Dynamic input.** A floating HUD near the cursor shows the next prompt + a number-entry field — same numbers as the command line but inline.
- **Grip-edit.** Select an entity, square grips appear at endpoints / midpoints / centers; click a grip to "grab" it, drag, click to commit. Grip menu (right-click on grip) offers Stretch / Move / Rotate / Scale / Mirror.
- **Modify operations.** ROTATE / MOVE / COPY / MIRROR / STRETCH / TRIM / EXTEND / OFFSET / FILLET / CHAMFER / ARRAY all live in the same command framework — same rhythm, same Enter-to-confirm.
- **Properties palette.** A side panel that always reflects the current selection's properties; edit a value → entity updates.

### 3.2 Blender-style (the "transient transform" school)

- **Tool toolbar (left).** Modal tools selectable but not the primary path.
- **Transient transforms.** With a selection, press **G** (grab/move) / **R** (rotate) / **S** (scale) — entities follow the cursor immediately, click to confirm, Esc / RMB to cancel. Transforms can be axis-locked mid-drag (X / Y / Z keys), distance-typed ("G 500 Enter"), and refined with Shift for fine, Ctrl for snap.
- **Vertex / Edge / Face mode.** Tab toggles between object-level and component-level editing. In edit-mode the same G/R/S transient transforms work on sub-elements.
- **Shift-click for additive selection, A for all, Alt-A for none.**
- **Keyboard-first.** Menus exist but are secondary; expert users barely touch them.

### 3.3 Revit-style (the "parametric instance" school)

- **Family / instance.** Every drawn element is an instance of a Type with parameters (wall type, beam profile, dim style …); editing a Type updates all instances.
- **Reference-plane snapping.** Snaps to alignment lines, grids, levels, named reference planes — not just geometric features.
- **Modify ribbon panel.** Modify ops grouped by category in a ribbon tab; clicking the ribbon button enters that mode.
- **Properties palette.** Same idea as AutoCAD but stronger — instance properties and type properties separated.
- **Pick-and-place.** Drawing tools are mostly "pick a type, then click to drop instances." Less of a "command line" feel.
- **Sketch sub-mode.** Some operations enter a temporary sketch mode (Filled Region, Floor boundary edit) where you draw lines to define a closed loop, then "Finish" to commit.

### 3.4 Chosen blend for 2.0 — recommended ratio: **AutoCAD 60 % / Blender 25 % / Revit 15 %**

- Why AutoCAD-dominant: 1.0 already mirrors AutoCAD almost 1:1 (DynamicInput, ToolOptionsBar, OSNAP toggles, modal-command rhythm). Switching paradigms now would break user habits; users buy 2D BIM CAD for AutoCAD-feel.
- Why a Blender layer: experienced users gain a *huge* speed-up from transient G / R / S transforms on selection. 1.0 lacks them; 2.0's "Move/Rotate/Scale/Mirror" tools already trend in this direction (the 2.0 Move tool runs as a click-to-arm-then-drag in the existing binary).
- Why a Revit layer: parametric type instances are the long-term goal for AEC tools, and the sketch sub-mode for Filled-Region / Hatch is genuinely better UX than AutoCAD's BPOLY+HATCH dance. Adopt the sketch-mode pattern but skip the heavy Type/Family mechanism for now.

**Concrete adoption plan:**

| Pattern | Adopt? | From | Notes |
|---|---|---|---|
| Modal command rhythm (click-prompt-click-prompt) | YES | AutoCAD | All drawing tools follow this |
| Persistent OSNAP toggles in status bar | YES | AutoCAD | Sticky across tool changes |
| DynamicInput cursor HUD | YES | AutoCAD | Distance + angle fields |
| Direct distance entry | YES | AutoCAD | Hover-in-direction → type number → Enter |
| Grip editing on selection | YES | AutoCAD | Phase F |
| Properties palette reflects selection | YES | AutoCAD + Revit | Already partially in 2.0 (Properties panel exists) |
| Modify ribbon panel | YES | Revit | Already in `kernel-superui` design |
| Transient G / R / S transforms | YES | Blender | Phase E (2.0 already has Move/Rot/Scale/Mirror, refine with key-bindings) |
| Axis-lock keys mid-drag (X / Y) | YES | Blender | Toggles `modifyConstrainAxis` while transform is live |
| Shift-fine / Ctrl-snap modifiers | YES | Blender | While dragging |
| Object / Edit-mode toggle (Tab) | NO | Blender | Adopt only for plate-system / slab-inner-contour edit (Phase F.2 — same Tab key 1.0 already uses) |
| Sketch sub-mode for Filled Region | YES | Revit | Phase C |
| Family / Type system | NO (this spec) | Revit | Punted to future AEC pack |
| Reference-plane snapping | PARTIAL | Revit | "Alignment" snap already exists in 1.0; expand in Phase A |
| Command-line text input | NO | AutoCAD | DynamicInput floats near cursor instead — better fit for 2.0's egui-based UI |

---

## 4. Layered architecture

Four layers, each strictly above the previous. Lower layers know nothing of higher ones.

```
┌─────────────────────────────────────────────────────────────────┐
│  L4  UI dispatch  (kernel-superui — ribbon, hotkeys, options)   │
│         │ ToolDispatch::activate(ToolKind::Line)                │
│         │ ToolDispatch::on_input(InputEvent)                    │
└─────────┼───────────────────────────────────────────────────────┘
          ▼
┌─────────────────────────────────────────────────────────────────┐
│  L3  EditOp / undo / scene mutation  (kernel-app::edit)         │
│         │ apply(scene, EditOp::CreateLine{..}) → Inverse        │
│         │ push_undo / undo / redo                               │
└─────────┼───────────────────────────────────────────────────────┘
          ▲ committed EditOp
          │
┌─────────────────────────────────────────────────────────────────┐
│  L2  Tool state machines  (kernel-tools)                        │
│         │ trait Tool { fn update(&mut self,                     │
│         │     input: ToolInput) -> ToolStatus; }                │
│         │ ToolStatus = WaitingForPick | Active(preview)         │
│         │            | Committed(EditOp) | Cancelled            │
└─────────┼───────────────────────────────────────────────────────┘
          ▼ snap query
┌─────────────────────────────────────────────────────────────────┐
│  L1  Snap engine  (kernel-snap)                                 │
│         │ SnapEngine::query(world_pt, ctx) → Option<SnapResult> │
│         │ depends on kernel-spatial::SegmentIndex               │
└─────────────────────────────────────────────────────────────────┘
```

### 4.1 L1 — Snap engine (`kernel-snap`)

Pure-data crate, no UI dependencies. Inputs: cursor world point, scene index, active modes. Outputs: at most one `SnapResult` per query.

- `enum SnapMode { Endpoint, Midpoint, Center, Intersection, Perpendicular, Parallel, Tangent, Nearest, Origin, Grid, Alignment }`
- `struct SnapContext<'a> { index: &'a SegmentIndex, scene: &'a Scene, modes: SnapModeSet, tolerance_world: f32, ortho_anchor: Option<[f64;2]>, polar_increment_deg: f32, last_pick: Option<[f64;2]>, key_points: &'a [[f64;2]] }` — `key_points` are previously hovered points used by `Alignment`.
- `struct SnapResult { point: [f64;2], kind: SnapMode, source_eid: Option<u32>, source_angle: Option<f32> }`
- `SnapEngine::query(cursor: [f64;2], ctx: &SnapContext) -> Option<SnapResult>` — runs the active modes in priority order, returns the first hit within tolerance.
- Priority (matches AutoCAD): Endpoint > Midpoint > Center > Intersection > Perpendicular > Tangent > Parallel > Alignment > Nearest > Origin > Grid.

### 4.2 L2 — Tool state machines (`kernel-tools`)

Each tool is a small struct + `impl Tool`. Tools own only their *intermediate* state (anchor points, preview geometry); they emit a committed `EditOp` when finished, then reset.

```rust
pub trait Tool {
    fn name(&self) -> &'static str;
    fn update(&mut self, input: ToolInput, snap: Option<SnapResult>, ctx: &ToolCtx) -> ToolStatus;
    fn preview(&self) -> ToolPreview;        // ghost geometry for the renderer
    fn cancel(&mut self);                    // Esc / tool change
}

pub enum ToolInput {
    CursorMove([f64;2]),
    LeftClick([f64;2], Modifiers),
    RightClick([f64;2]),
    Key(KeyEvent),
    NumericEntry(f64, NumericKind),          // from DynamicInput
}

pub enum ToolStatus {
    WaitingForPick,                          // tool is armed but no anchor yet
    Active,                                  // intermediate state — preview live
    Committed(EditOp),                       // commit edit + reset
    Cancelled,                               // reset, stay armed for next gesture
}
```

Tools to implement (this spec):

- `LineTool`, `RectangleTool`, `CircleTool`, `ArcTool`, `PolylineTool`, `EllipseTool`, `SplineTool`, `TextTool`, `LeaderTool`, `LabelTool`, `DimensionTool` (linear/aligned/angular/radial/diameter/arc-length/continuous/baseline as 8 sub-modes).
- `HatchTool`, `FilledRegionTool` (sketch-mode wrapper).
- `MoveTool`, `CopyTool`, `RotateTool`, `ScaleTool`, `MirrorTool` (refine the existing 2.0 versions to slot into this trait).
- `TrimTool`, `ExtendTool`, `OffsetTool`, `FilletTool`, `ChamferTool`, `ArrayTool`, `StretchTool`, `AlignTool`, `SplitTool`, `JoinTool`.
- `GripEditTool` (universal — driven by selection grips, not by ribbon).

### 4.3 L3 — EditOp / undo (`kernel-app::edit`)

Extend the existing `EditOp` enum (currently in `open_2d_studio.rs:1781`). It already has Move/Delete/Paste/Rotate/Scale/Mirror/EditText. Add:

```rust
enum EditOp {
    // existing variants ...
    CreateEntities { entities: Vec<NewEntity> },        // new ids minted on apply
    DeleteEntities { snapshot: Vec<DeletedEntity> },    // already exists as Delete{...}
    EditGeometry   { eid: u32, delta: GeometryDelta },  // for grip / boundary / annotation edit
    Trim           { eid: u32, keep_segs: Vec<u32> },
    Extend         { eid: u32, new_endpoint: [f64;2] },
    Offset         { source_eid: u32, new_eids: Vec<u32>, distance: f64, side: i8 },
    Fillet         { eid_a: u32, eid_b: u32, new_arc_eid: u32, radius: f64 },
    Chamfer        { eid_a: u32, eid_b: u32, new_segs: Vec<NewEntity>, d1: f64, d2: f64 },
    Stretch        { eids: Vec<u32>, window: AABB, delta: [f64;2] },
    Split          { eid: u32, at: [f64;2], new_eids: [u32;2] },
    Join           { eids: Vec<u32>, new_eid: u32 },
    Array          { source_eids: Vec<u32>, new_eids: Vec<u32>, kind: ArrayKind },
}
```

Every variant carries enough state for `apply` and `inverse` to be deterministic. Undo stack capped at 100 ops per tab (1.0's cap is 50; 100 is generous given Rust's tighter memory profile).

### 4.4 L4 — UI dispatch (`kernel-superui`)

The ribbon button / hotkey produces a `ToolKind` (or directly a transient `EditOp` for actions like Delete / Paste). The shell holds a single `Box<dyn Tool>`; switching tools cancels the previous and constructs the new. Numeric entry from DynamicInput converts to `ToolInput::NumericEntry`. Status-bar OSNAP toggles mutate a single `SnapModeSet` owned by the shell.

This is exactly how `kernel-superui`'s `CadButton::Action` enum (per the UI-crate spec) feeds the binary. The drawing-tools spec **adds new variants** to that action enum — no architectural change to superui.

---

## 5. Phase decomposition

| Phase | Scope | Effort | Depends on |
|---|---|---:|---|
| **A** | `kernel-snap` crate + visual snap markers + status-bar OSNAP toggles | 1–2 weeks | kernel-spatial (exists), kernel-superui (in flight) |
| **B** | Drawing primitives: Line, Rectangle, Circle, Arc, Polyline, Ellipse, Spline | 2–3 weeks | A |
| **C** | Hatch tool (boundary detection, pattern fill) + Filled-Region sketch sub-mode | 2–3 weeks | A, B |
| **D** | Dimensions: Linear, Aligned, Angular, Radial, Diameter, Arc-length, Continuous, Baseline (eight sub-modes) | 2–3 weeks | A, B |
| **E** | Modify ops: Trim, Extend, Offset, Fillet, Chamfer, Array, Stretch, Align, Split, Join — and refine existing Move/Rotate/Scale/Mirror to share Tool trait | 3–4 weeks | A, B |
| **F** | Grip editing (drag endpoints / midpoints / centers / dim grips) + boundary edit + annotation edit | 1–2 weeks | A, B, D |
| **G** | DynamicInput HUD + direct distance entry + numeric override mid-tool | 1–2 weeks | A, B (becomes useful once primitives exist) |
| **H** | Text creation tool (TEXT/MTEXT) — pairs with `2026-05-01-text-editor-design.md` | 1 week | text-editor spec lands first |

**Total estimated effort:** 14–20 weeks (sequential). With one engineer on snap/tools and another on text-editor + UI-crate in parallel, calendar time compresses to ~10–14 weeks.

---

## 6. Phase A — concrete first slice

Deliverable: a snap engine with full visual feedback, wired into the existing 2.0 binary so every cursor move shows an OSNAP marker exactly like 1.0 / AutoCAD. No drawing tools yet — Phase A is purely the foundation.

### 6.1 Tasks (no code in this doc — each becomes a session task)

1. **Create `kernel/crates/snap/` Cargo crate.** Workspace member, depends on `kernel-spatial` and `glam`. No UI deps.
2. **Define types.**
   - `SnapMode` (11 variants — match 1.0's `SnapType`).
   - `SnapModeSet` (bitflags, persistable to settings).
   - `SnapResult { point, kind, source_eid, source_angle }`.
   - `SnapContext<'a>` (refs to scene + index + modes + tolerance + last-pick + key-points).
   - `SnapEngine` (zero-sized — all work happens in `query`).
3. **Implement `query` for each mode** in priority order (Endpoint, Midpoint, Center, Intersection, Perpendicular, Parallel, Tangent, Alignment, Nearest, Origin, Grid). Each branch uses `SegmentIndex::query_aabb` to bound candidates.
4. **Wire into the 2.0 binary.** In `open_2d_studio.rs` cursor-move handler, after camera transform, call `SnapEngine::query(...)`. Stash the result in `App` as `current_snap: Option<SnapResult>`.
5. **Render the snap marker.** Add a small egui overlay (~10×10 px at the snap point) drawn on top of the scene. Glyph per kind: square=Endpoint, triangle=Midpoint, circle=Center, X=Intersection, ⊥=Perpendicular, ∥=Parallel, ○-tangent=Tangent, hourglass=Nearest, ⊕=Origin, +=Grid, dotted-line=Alignment. Match 1.0's visual style.
6. **Status-bar OSNAP toggles.** In `kernel-superui`, add an `OsnapStrip` widget with one toggle per `SnapMode`. Persist state via Tauri `Store` plugin (1.0 already does this — same key namespace).
7. **Persistence.** Read `activeSnaps`, `snapTolerance`, `gridSize`, `gridVisible`, `polarTrackingEnabled`, `orthoMode`, `polarAngleIncrement` from settings on startup, write back on toggle.
8. **Object-tracking acquisition.** When the cursor hovers an Endpoint / Midpoint / Center for >250 ms without clicking, record it as a "key point" (max 7, FIFO). Future picks see horizontal / vertical alignment lines from these key points → enables `SnapMode::Alignment`. Render the alignment lines as dotted overlays only while hovered along an axis.
9. **Ortho / Polar constraint.** When enabled, the snap engine rewrites the cursor world point to the nearest H/V (Ortho) or polar-multiple (Polar) direction from `last_pick` *before* running mode queries. So all snap modes see a constrained cursor.
10. **Grid snap.** When `gridVisible` is on and `SnapMode::Grid` is in the active set, round to the nearest `gridSize` multiple. Lowest priority — only fires if no geometric snap matches.
11. **Tests.** A `kernel-snap` integration test crate that builds a synthetic 50-segment scene and asserts each `SnapMode` returns the expected hit for hand-crafted cursor positions.
12. **Performance gate.** Benchmark on a 1 M-segment DXF — `query` p99 must stay < 0.5 ms. If we trip the gate, narrow `query_aabb` window to 4× tolerance and short-circuit on first hit per priority bucket.

### 6.2 Acceptance criteria for Phase A

- Loading a DXF and moving the mouse over the canvas shows a coloured glyph at the nearest qualifying point with < 1 frame of latency, indistinguishable from 1.0 at a glance.
- Toggling any OSNAP mode in the status bar instantly removes / adds that snap kind with no scene reload.
- Ortho mode (F8) constrains the cursor to H/V from the last pick — verifiable with the existing Move tool.
- Polar tracking (F10) snaps to 45° multiples — same.
- Object tracking (F11) acquires up to 7 key points by hover-pause and shows dotted alignment lines.
- Settings round-trip: close the app, reopen, snap state is restored.
- Performance: 1 M-segment scene, hover-rate p99 < 0.5 ms `query`.

### 6.3 Phase A explicitly **excludes**

- Any drawing tool (Phase B).
- The DynamicInput HUD (Phase G — but the snap engine must already report `source_angle` so G can pick it up cheaply).
- Grip rendering on selection (Phase F).
- Numeric entry / typed distance (Phase G).

---

## 7. Risks & open questions

### 7.1 Top risks

1. **Snap query performance on huge scenes.** Worst case is `Intersection` mode — naively O(n²) inside the AABB. Mitigation: cap candidate set at 32 inside any tolerance window; add a pairwise intersection cache invalidated on edit; benchmark before merging Phase A.
2. **Modal vs transient transform UX clash.** AutoCAD modal tools and Blender transient G/R/S can coexist, but only if hotkeys don't collide. AutoCAD uses M/RO/SC for modify; Blender uses G/R/S. We'll bind G/R/S as Blender shortcuts on selection and leave the AutoCAD-style ribbon-button flows untouched. Open question: which wins if both fire? Proposal: ribbon-modal tool wins while active; G/R/S only fire when no tool is armed (i.e. Select mode + selection present).
3. **Undo stack growth from hatch / array.** A hatch on a complex boundary can produce thousands of triangles; an array can produce hundreds of new entities. Cap stack to 100 ops; per-op size budget warning at 10 MB; when exceeded, the operation still applies but the stack drops the oldest op silently (with a log line).
4. **Coexistence with text editor.** Both Phase H text creation and the in-place text editor (`2026-05-01-text-editor-design.md`) emit `EditOp::EditText` / `EditOp::CreateText` — they must agree on the variant names. Coordinate one shared PR per text-editor merge.
5. **Coexistence with kernel-superui.** Drawing-tool ribbon buttons need new variants in superui's `CadButton::Action` enum (e.g. `Action::ActivateTool(ToolKind::Line)`). No conflict yet; the UI-crate spec is open about this slot. We'll land Phase A first → Phase B adds the action variants in lockstep with superui's ribbon iteration.
6. **AEC-pack creep.** Users will want Beam / Wall / Slab / Pile back ASAP. They are deferred but the snap engine + tool framework must not bake in assumptions that prevent adding those tools later (parametric instances, IFC properties, type-instance separation). Mitigation: keep `Tool` trait dumb — no entity-shape assumptions; the EditOp enum is open for new variants.
7. **Filled-Region sketch sub-mode complexity.** It's a *meta-tool* that switches the active inner tool (Line / Rect / Circle / Arc / Polygon) while keeping a shared list of sketch shape ids. Easy to get state-machine wrong. Mitigation: explicit FilledRegionToolWrapper that owns a `Box<dyn Tool>` for the inner tool, intercepts Commit to add to its boundary list instead of producing a real EditOp.
8. **Mid-tool axis lock & numeric override.** Blender lets you press X mid-G to lock to X-axis, then type 500 Enter. Achievable but every tool must look at modifier keys + numeric entry inside `update`. Risk: ad-hoc handling per tool. Mitigation: a `TransformConstraint` helper that wraps `last_pick → cursor` and rewrites the result based on active locks.

### 7.2 Open questions for the user

1. **Scope of "1.0 features in canvas":** confirm we are starting from the 14 generic tools (Line / Rect / Circle / Arc / Polyline / Ellipse / Spline / Text / Leader / Label / Dimension / Detail-Line / Hatch / Filled-Region) and deferring the 16 AEC tools (Beam / Wall / Slab / Pile / etc.) to a later "AEC pack" spec. Or does Phase B need to include some AEC tools (e.g. Beam, Wall) for an early demo?
2. **Paradigm ratio:** is 60 % AutoCAD / 25 % Blender / 15 % Revit the right mix? Specifically, do you want **transient G/R/S transforms in Select mode** as a first-class feature, or keep the AutoCAD-only ribbon-driven flow?
3. **Command line vs DynamicInput-only:** AutoCAD veterans expect a typed command line ("L Enter"). 1.0 doesn't have one — only DynamicInput. Confirm 2.0 stays DynamicInput-only? (Cheaper, fewer key conflicts with text edit.)
4. **Grip edit shapes:** AutoCAD shows square grips for endpoints, triangle for midpoints, circle for centers. Pick a glyph palette that matches 1.0 or align with AutoCAD's? (1.0 currently uses small filled squares for everything.)
5. **Filled-Region inner loops:** 1.0's sketch mode supports outer + multiple inner loops via `commitOuterLoopAndStartInner()`. Phase C will mirror this — confirm we should match 1.0 verbatim and not adopt Revit's "Pick Boundary" automatic boundary detection from existing geometry.
6. **Undo stack depth:** 1.0 = 50; we propose 100 for 2.0. OK?
7. **Direct distance entry priority:** AutoCAD treats typed numbers as distance-along-tracked-direction *unless* the cursor hasn't moved since the last pick (then it's an absolute coordinate). Confirm we adopt this rule, or simpler: always require explicit @ for absolute coords like 1.0?

---

## 8. Approval

Sign-off scope: this document defines **the architecture and Phase A first slice only**. Subsequent phases (B–H) will each get their own spec produced from the inventory + architecture in this doc. No implementation begins until Phase A is approved.

**Approval checklist:**

- [ ] Goal and non-goals match the user's intent ("Lijnen, arceringen, maatlijnen + edit-functies in canvas, modify zoals AutoCAD/Blender/Revit").
- [ ] 1.0 inventory covers the 14 generic tools the user named (lines, hatches, dimensions) plus enough modify ops.
- [ ] Paradigm blend (60/25/15 AutoCAD/Blender/Revit) is acceptable — or revise per question §7.2.2.
- [ ] Layered architecture (Snap → Tools → EditOp → UI) is acceptable.
- [ ] Phase A scope (snap engine + visual markers + status-bar toggles, 1–2 weeks) is the right first slice.
- [ ] Open questions in §7.2 answered.

When this doc is approved, the next deliverable is a **plan-document** (per `superpowers:writing-plans`) for Phase A only, expanding tasks 1–12 in §6.1 into concrete TDD-friendly work items.
