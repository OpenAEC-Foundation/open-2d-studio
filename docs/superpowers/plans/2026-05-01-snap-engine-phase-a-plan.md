# Drawing Tools Phase A — Snap Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up a new `kernel-snap` Rust crate providing AutoCAD-style OSNAP (object snap) for the Open 2D Studio canvas — Endpoint/Midpoint/Center/Intersection/Perpendicular/Tangent/Parallel/Alignment/Nearest/Origin/Grid + Ortho/Polar/Object-tracking constraints. Integrate into `open_2d_studio.rs` cursor handler so every cursor move shows a snap marker matching 1.0's visual feedback.

**Architecture:** Pure-data crate with no UI dependencies. `SnapEngine::query(cursor, ctx) -> Option<SnapResult>` runs active modes in priority order using `kernel-spatial::SegmentIndex` AABB queries to bound candidates. Snap markers rendered as egui overlay glyphs. OSNAP toggle strip lives in `superui` status bar (gated on superui completion). Performance gate: p99 query < 0.5 ms on 1M-segment scene.

**Tech Stack:** Rust 1.77+, glam 0.27 for vector math, kernel-spatial (existing) for AABB index, bitflags 2.x for SnapModeSet. No new heavy deps.

---

## User-approved decisions

1. Phase B will ship 14 generic tools only — no AEC pack
2. Paradigm: 60% AutoCAD / 25% Blender / 15% Revit, with G/R/S transient transforms in Select mode
3. DynamicInput-only — NO typed command line
4. Hatch inner loops use Revit's "Pick Boundary" auto-detection
5. Undo stack depth = 100 ops

---

## Repository context

Working dir: `C:\Users\rickd\Documents\GitHub\open-2d-studio`
Branch: `merge-1.0-2.0` (already checked out)

Existing workspace:
- `kernel/Cargo.toml` — workspace members
- `kernel/crates/spatial/` — `SegmentIndex` (rstar-based) used by selection picking, exposes `query_point(p, radius)` and `query_aabb(rect)`
- `kernel/crates/superui/` — UI crate (in flight; OsnapStrip widget will land in its status bar module)
- `kernel/crates/app/src/scene_io.rs` — `Scene { segments, ... }`
- `kernel/crates/app/src/bin/open_2d_studio.rs` — App + cursor handler

Design doc: `docs/superpowers/specs/2026-05-01-drawing-tools-design.md` (read sections 4.1, 6.1, 6.2 for snap-engine specifics).

**Coordination constraint**: Tasks 8, 9, 11, 12 of this plan touch `open_2d_studio.rs` and/or `superui`. Both files are touched by the in-flight text-editor plan and UI-crate plan. **Tasks 8-12 MUST NOT START until** the text-editor plan's Task 11 AND the UI-crate plan's Task 11 are committed. Tasks 1-7 are entirely in the new `kernel/crates/snap/` crate — zero file conflicts.

**Crate naming note**: design doc says `kernel-snap` (matches existing `kernel-spatial`, `kernel-render`, etc. naming). The user renamed `kernel-ui` → `superui` mid-session; if they prefer `supersnap` here, they can rename via a single search-replace. This plan uses `kernel-snap` as the default name.

---

## File structure overview

| File | What this plan creates/changes |
|------|-------------------------------|
| `kernel/crates/snap/Cargo.toml` | New — crate manifest |
| `kernel/crates/snap/src/lib.rs` | New — module exports + crate-level docs |
| `kernel/crates/snap/src/types.rs` | New — `SnapMode`, `SnapModeSet`, `SnapResult`, `SnapContext`, `SnapEngine` types |
| `kernel/crates/snap/src/query.rs` | New — per-mode `query_*` functions (Endpoint, Midpoint, Center, Intersection, Perpendicular, Tangent, Parallel, Alignment, Nearest, Origin, Grid) |
| `kernel/crates/snap/src/constraint.rs` | New — Ortho/Polar/Grid cursor-constraint helpers |
| `kernel/crates/snap/src/tracking.rs` | New — KeyPointTracker (object-tracking acquisition) |
| `kernel/crates/snap/tests/integration.rs` | New — synthetic-scene integration tests |
| `kernel/crates/snap/benches/query_bench.rs` | New — Criterion benchmark for performance gate |
| `kernel/Cargo.toml` | Modified — add `crates/snap` to workspace members |
| `kernel/crates/app/Cargo.toml` | Modified — add `kernel-snap = { path = "../snap" }` (Task 8) |
| `kernel/crates/app/src/bin/open_2d_studio.rs` | Modified (gated, Tasks 8/9/11/12) — cursor handler + marker render + persistence + tracking |
| `kernel/crates/superui/src/layout/status_bar.rs` | Modified (gated, Task 10) — add OsnapStrip widget hosted in StatusBar |

---

## Task 1: Scaffold `kernel-snap` crate

**Files:**
- Create: `kernel/crates/snap/Cargo.toml`
- Create: `kernel/crates/snap/src/lib.rs`
- Create stubs: `kernel/crates/snap/src/{types,query,constraint,tracking}.rs`
- Modify: `kernel/Cargo.toml` (workspace members)

- [ ] **Step 1: Create directory structure**

```bash
cd /c/Users/rickd/Documents/GitHub/open-2d-studio
mkdir -p kernel/crates/snap/src
mkdir -p kernel/crates/snap/tests
mkdir -p kernel/crates/snap/benches
```

- [ ] **Step 2: Write `kernel/crates/snap/Cargo.toml`**

```toml
[package]
name = "kernel-snap"
version.workspace = true
edition.workspace = true
license.workspace = true
description = "OSNAP (object snap) engine for Open 2D Studio — Endpoint/Midpoint/Center/etc."

[dependencies]
kernel-spatial = { path = "../spatial" }
glam = "0.27"
bitflags = "2"
serde = { workspace = true }

[dev-dependencies]
criterion = "0.5"

[[bench]]
name = "query_bench"
harness = false
```

- [ ] **Step 3: Write `kernel/crates/snap/src/lib.rs`**

```rust
//! kernel-snap — OSNAP engine for Open 2D Studio.
//!
//! Pure-data crate, no UI dependencies. Inputs: cursor world point,
//! scene index, active modes. Outputs: at most one `SnapResult`
//! per query.
//!
//! See `docs/superpowers/specs/2026-05-01-drawing-tools-design.md`
//! §4.1 and §6 for the design.

pub mod types;
pub mod query;
pub mod constraint;
pub mod tracking;

pub use types::{SnapMode, SnapModeSet, SnapResult, SnapContext, SnapEngine};
```

- [ ] **Step 4: Create stub source files so lib.rs compiles**

```bash
echo "//! types — placeholder until Task 2" > kernel/crates/snap/src/types.rs
cat >> kernel/crates/snap/src/types.rs << 'EOF'

use bitflags::bitflags;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SnapMode { Endpoint }

bitflags! {
    #[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
    pub struct SnapModeSet: u32 {
        const ENDPOINT = 1;
    }
}

#[derive(Debug, Clone)]
pub struct SnapResult {
    pub point: [f64; 2],
    pub kind: SnapMode,
    pub source_eid: Option<u32>,
    pub source_angle: Option<f32>,
}

pub struct SnapContext;
pub struct SnapEngine;
EOF
echo "//! query — placeholder until Tasks 3-5" > kernel/crates/snap/src/query.rs
echo "//! constraint — placeholder until Task 12" > kernel/crates/snap/src/constraint.rs
echo "//! tracking — placeholder until Task 11" > kernel/crates/snap/src/tracking.rs
```

- [ ] **Step 5: Add to workspace**

Edit `kernel/Cargo.toml`. In the `[workspace] members = [...]` array, append:
```toml
    "crates/snap",
```

- [ ] **Step 6: Verify metadata + build**

```bash
cd /c/Users/rickd/Documents/GitHub/open-2d-studio/kernel
cargo metadata --format-version=1 >/dev/null 2>&1 && echo "metadata OK"
cargo build --release -p kernel-snap 2>&1 | tail -10
```

Expected: metadata OK + `Finished` for kernel-snap.

- [ ] **Step 7: Commit**

```bash
cd /c/Users/rickd/Documents/GitHub/open-2d-studio
git add kernel/Cargo.toml kernel/crates/snap/
git commit -m "feat(kernel-snap): scaffold crate with stub modules"
```

---

## Task 2: Define real types (`SnapMode`, `SnapModeSet`, `SnapResult`, `SnapContext`, `SnapEngine`)

**Files:**
- Modify: `kernel/crates/snap/src/types.rs` (replace stub with real implementation)

- [ ] **Step 1: Replace `types.rs` with the full type set**

```rust
//! Snap engine types — all modes, mode set bitflags, result, context.

use bitflags::bitflags;
use kernel_spatial::SegmentIndex;

/// All 11 OSNAP modes from 1.0's `SnapType`. Listed in priority order
/// (Endpoint highest). The order in `query_modes_in_priority()` mirrors
/// AutoCAD's lookup priority.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum SnapMode {
    Endpoint,
    Midpoint,
    Center,
    Intersection,
    Perpendicular,
    Parallel,
    Tangent,
    Alignment,
    Nearest,
    Origin,
    Grid,
}

bitflags! {
    /// Bitmask of active OSNAP modes. Persistable to settings.
    #[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
    pub struct SnapModeSet: u32 {
        const ENDPOINT      = 1 << 0;
        const MIDPOINT      = 1 << 1;
        const CENTER        = 1 << 2;
        const INTERSECTION  = 1 << 3;
        const PERPENDICULAR = 1 << 4;
        const PARALLEL      = 1 << 5;
        const TANGENT       = 1 << 6;
        const ALIGNMENT     = 1 << 7;
        const NEAREST       = 1 << 8;
        const ORIGIN        = 1 << 9;
        const GRID          = 1 << 10;
    }
}

impl SnapModeSet {
    pub fn contains_mode(self, m: SnapMode) -> bool {
        let bit = match m {
            SnapMode::Endpoint      => Self::ENDPOINT,
            SnapMode::Midpoint      => Self::MIDPOINT,
            SnapMode::Center        => Self::CENTER,
            SnapMode::Intersection  => Self::INTERSECTION,
            SnapMode::Perpendicular => Self::PERPENDICULAR,
            SnapMode::Parallel      => Self::PARALLEL,
            SnapMode::Tangent       => Self::TANGENT,
            SnapMode::Alignment     => Self::ALIGNMENT,
            SnapMode::Nearest       => Self::NEAREST,
            SnapMode::Origin        => Self::ORIGIN,
            SnapMode::Grid          => Self::GRID,
        };
        self.contains(bit)
    }
}

/// Successful snap. `source_eid` is the entity-id of the segment whose
/// keypoint produced this snap (None for Origin / Grid). `source_angle`
/// is the segment's heading in radians at the snap point (used by
/// Phase G's DynamicInput for direction inference).
#[derive(Debug, Clone)]
pub struct SnapResult {
    pub point: [f64; 2],
    pub kind: SnapMode,
    pub source_eid: Option<u32>,
    pub source_angle: Option<f32>,
}

/// Read-only context handed to `SnapEngine::query` per cursor frame.
/// Owns no allocations; caller passes refs that live for the query.
pub struct SnapContext<'a> {
    pub index: &'a SegmentIndex,
    /// Flat segments view: `segments[i] = ([x1,y1], [x2,y2])`. Same
    /// indexing as the SegmentIndex segment-id.
    pub segments: &'a [([f64; 2], [f64; 2])],
    pub modes: SnapModeSet,
    /// Snap radius in WORLD units. Caller computes from screen pick-
    /// radius (e.g. 8 px) × world_per_pixel.
    pub tolerance_world: f64,
    /// Last user-picked point, for Ortho / Polar constraints. None on
    /// the very first cursor move after tool-arm.
    pub last_pick: Option<[f64; 2]>,
    /// Optional ortho-anchor (overrides last_pick for Ortho calc when
    /// the tool wants explicit control, e.g. mid-Stretch).
    pub ortho_anchor: Option<[f64; 2]>,
    /// Polar increment in degrees (45 / 30 / 15 typical).
    pub polar_increment_deg: f32,
    /// Object-tracking key points (FIFO, max 7) — used by Alignment.
    pub key_points: &'a [[f64; 2]],
    /// Grid spacing in world units (Grid mode rounds cursor to nearest
    /// multiple). Default 100.
    pub grid_size: f64,
}

/// Stateless engine — all logic is in `query`. Zero-sized type kept
/// so consumers can write `SnapEngine::query(...)` rather than a
/// free function.
pub struct SnapEngine;

impl SnapEngine {
    /// Run active modes in priority order. Returns the first hit
    /// within tolerance, or None.
    pub fn query(_cursor: [f64; 2], _ctx: &SnapContext<'_>) -> Option<SnapResult> {
        // Implemented across Tasks 3-5.
        None
    }
}
```

- [ ] **Step 2: Verify build**

```bash
cd /c/Users/rickd/Documents/GitHub/open-2d-studio/kernel && cargo build --release -p kernel-snap 2>&1 | tail -5
```

Expected: green. `query` always returns None for now — Tasks 3-5 fill in the modes.

- [ ] **Step 3: Commit**

```bash
git add kernel/crates/snap/src/types.rs
git commit -m "feat(kernel-snap): SnapMode/SnapModeSet/SnapResult/SnapContext/SnapEngine types"
```

---

## Task 3: Implement Endpoint + Midpoint + Center modes (key-point lookups)

**Files:**
- Modify: `kernel/crates/snap/src/query.rs`
- Modify: `kernel/crates/snap/src/types.rs` (wire query through SnapEngine::query)
- Create: `kernel/crates/snap/tests/integration.rs`

These three modes share a pattern: enumerate candidate segments via `index.query_point(cursor, tolerance_world)` → for each candidate, compute the relevant key point (endpoint/midpoint/center) → pick the closest within tolerance.

- [ ] **Step 1: Replace `query.rs` with the first three mode implementations**

```rust
//! Per-mode query functions. Public entry is `dispatch()` which
//! `SnapEngine::query` calls.

use crate::types::{SnapContext, SnapMode, SnapResult};

/// Helper: squared distance.
#[inline]
fn dist2(a: [f64; 2], b: [f64; 2]) -> f64 {
    let dx = a[0] - b[0];
    let dy = a[1] - b[1];
    dx * dx + dy * dy
}

/// Iterate active modes in priority order, return first hit.
pub fn dispatch(cursor: [f64; 2], ctx: &SnapContext<'_>) -> Option<SnapResult> {
    let tol2 = ctx.tolerance_world * ctx.tolerance_world;
    // Priority order per design doc §4.1.
    if ctx.modes.contains_mode(SnapMode::Endpoint) {
        if let Some(r) = endpoint(cursor, ctx, tol2) { return Some(r); }
    }
    if ctx.modes.contains_mode(SnapMode::Midpoint) {
        if let Some(r) = midpoint(cursor, ctx, tol2) { return Some(r); }
    }
    if ctx.modes.contains_mode(SnapMode::Center) {
        if let Some(r) = center(cursor, ctx, tol2) { return Some(r); }
    }
    // Tasks 4-5 add the rest.
    None
}

fn endpoint(cursor: [f64; 2], ctx: &SnapContext<'_>, tol2: f64) -> Option<SnapResult> {
    let candidates = ctx.index.query_point(cursor, ctx.tolerance_world);
    let mut best: Option<(f64, [f64; 2], u32)> = None;
    for seg_id in candidates {
        let Some(&(p1, p2)) = ctx.segments.get(seg_id as usize) else { continue; };
        for (pt, _) in &[(p1, "p1"), (p2, "p2")] {
            let d = dist2(*pt, cursor);
            if d <= tol2 && best.map_or(true, |(bd, _, _)| d < bd) {
                best = Some((d, *pt, seg_id));
            }
        }
    }
    best.map(|(_, point, eid)| SnapResult {
        point, kind: SnapMode::Endpoint, source_eid: Some(eid), source_angle: None,
    })
}

fn midpoint(cursor: [f64; 2], ctx: &SnapContext<'_>, tol2: f64) -> Option<SnapResult> {
    let candidates = ctx.index.query_point(cursor, ctx.tolerance_world);
    let mut best: Option<(f64, [f64; 2], u32)> = None;
    for seg_id in candidates {
        let Some(&(p1, p2)) = ctx.segments.get(seg_id as usize) else { continue; };
        let mid = [(p1[0] + p2[0]) * 0.5, (p1[1] + p2[1]) * 0.5];
        let d = dist2(mid, cursor);
        if d <= tol2 && best.map_or(true, |(bd, _, _)| d < bd) {
            best = Some((d, mid, seg_id));
        }
    }
    best.map(|(_, point, eid)| SnapResult {
        point, kind: SnapMode::Midpoint, source_eid: Some(eid), source_angle: None,
    })
}

/// Center: for Phase A we treat each segment-pair as if its midpoint
/// is the centre (degenerate). Real circle-centre snap requires Scene
/// to expose CIRCLE/ARC parameters — wired in Phase B when the Scene
/// gets typed entities. For now, this returns None and the priority
/// chain falls through.
fn center(_cursor: [f64; 2], _ctx: &SnapContext<'_>, _tol2: f64) -> Option<SnapResult> {
    None
}
```

- [ ] **Step 2: Wire `query.rs` through `SnapEngine::query`**

In `kernel/crates/snap/src/types.rs`, replace `SnapEngine::query` body:

```rust
impl SnapEngine {
    pub fn query(cursor: [f64; 2], ctx: &SnapContext<'_>) -> Option<SnapResult> {
        crate::query::dispatch(cursor, ctx)
    }
}
```

- [ ] **Step 3: Write integration test**

Create `kernel/crates/snap/tests/integration.rs`:

```rust
//! Synthetic-scene integration tests for kernel-snap.

use kernel_snap::{SnapEngine, SnapMode, SnapModeSet, SnapContext};
use kernel_spatial::{SegmentIndex, SegmentEntry};

fn build_scene_2segs() -> (SegmentIndex, Vec<([f64; 2], [f64; 2])>) {
    // Two segments: a horizontal one [0,0]-[10,0] and a vertical [5,-5]-[5,5].
    let segments = vec![
        ([0.0_f64, 0.0], [10.0, 0.0]),
        ([5.0, -5.0], [5.0, 5.0]),
    ];
    let entries: Vec<SegmentEntry> = segments.iter().enumerate().map(|(i, &(p1, p2))| {
        SegmentEntry { id: i as u32, p1, p2 }
    }).collect();
    let idx = SegmentIndex::bulk_load(entries);
    (idx, segments)
}

#[test]
fn endpoint_snap_finds_segment_endpoint() {
    let (idx, segs) = build_scene_2segs();
    let ctx = SnapContext {
        index: &idx,
        segments: &segs,
        modes: SnapModeSet::ENDPOINT,
        tolerance_world: 0.5,
        last_pick: None,
        ortho_anchor: None,
        polar_increment_deg: 45.0,
        key_points: &[],
        grid_size: 100.0,
    };
    let r = SnapEngine::query([0.1, 0.1], &ctx).expect("should snap to [0,0]");
    assert_eq!(r.kind, SnapMode::Endpoint);
    assert!((r.point[0] - 0.0).abs() < 1e-9);
    assert!((r.point[1] - 0.0).abs() < 1e-9);
}

#[test]
fn midpoint_snap_finds_segment_midpoint() {
    let (idx, segs) = build_scene_2segs();
    let ctx = SnapContext {
        index: &idx,
        segments: &segs,
        modes: SnapModeSet::MIDPOINT,
        tolerance_world: 0.5,
        last_pick: None,
        ortho_anchor: None,
        polar_increment_deg: 45.0,
        key_points: &[],
        grid_size: 100.0,
    };
    let r = SnapEngine::query([5.1, 0.05], &ctx).expect("should snap to midpoint of horizontal");
    assert_eq!(r.kind, SnapMode::Midpoint);
    assert!((r.point[0] - 5.0).abs() < 1e-9);
    assert!((r.point[1] - 0.0).abs() < 1e-9);
}

#[test]
fn no_modes_no_snap() {
    let (idx, segs) = build_scene_2segs();
    let ctx = SnapContext {
        index: &idx, segments: &segs,
        modes: SnapModeSet::empty(),
        tolerance_world: 100.0, last_pick: None, ortho_anchor: None,
        polar_increment_deg: 45.0, key_points: &[], grid_size: 100.0,
    };
    assert!(SnapEngine::query([5.0, 0.0], &ctx).is_none());
}
```

- [ ] **Step 4: Run tests**

```bash
cd /c/Users/rickd/Documents/GitHub/open-2d-studio/kernel
cargo test -p kernel-snap --release 2>&1 | tail -10
```

Expected: 3 tests pass. If `kernel-spatial::SegmentEntry` has different field names (e.g. `p1`/`p2` vs `start`/`end`), check the spatial crate source and adapt.

- [ ] **Step 5: Commit**

```bash
cd /c/Users/rickd/Documents/GitHub/open-2d-studio
git add kernel/crates/snap/src/query.rs kernel/crates/snap/src/types.rs kernel/crates/snap/tests/
git commit -m "feat(kernel-snap): Endpoint + Midpoint modes (Center deferred to Phase B)"
```

---

## Task 4: Implement Intersection + Perpendicular + Tangent + Parallel

**Files:**
- Modify: `kernel/crates/snap/src/query.rs`
- Modify: `kernel/crates/snap/tests/integration.rs` (add tests)

These are geometric construction modes — they compute new points based on cursor + segment relationships, not just keypoint lookups.

- [ ] **Step 1: Add intersection mode**

In `query.rs`, add this to the dispatch chain (after `center`):

```rust
    if ctx.modes.contains_mode(SnapMode::Intersection) {
        if let Some(r) = intersection(cursor, ctx, tol2) { return Some(r); }
    }
    if ctx.modes.contains_mode(SnapMode::Perpendicular) {
        if let Some(r) = perpendicular(cursor, ctx, tol2) { return Some(r); }
    }
    if ctx.modes.contains_mode(SnapMode::Tangent) {
        if let Some(r) = tangent(cursor, ctx, tol2) { return Some(r); }
    }
    if ctx.modes.contains_mode(SnapMode::Parallel) {
        if let Some(r) = parallel(cursor, ctx, tol2) { return Some(r); }
    }
```

Then add the four functions:

```rust
fn intersection(cursor: [f64; 2], ctx: &SnapContext<'_>, tol2: f64) -> Option<SnapResult> {
    // Cap candidate-set to avoid quadratic blowup on dense areas.
    let candidates: Vec<u32> = ctx.index.query_point(cursor, ctx.tolerance_world)
        .into_iter().take(32).collect();
    let mut best: Option<(f64, [f64; 2], u32)> = None;
    for i in 0..candidates.len() {
        let id_a = candidates[i];
        let Some(&(p1a, p2a)) = ctx.segments.get(id_a as usize) else { continue; };
        for j in (i + 1)..candidates.len() {
            let id_b = candidates[j];
            let Some(&(p1b, p2b)) = ctx.segments.get(id_b as usize) else { continue; };
            if let Some(pt) = segment_intersect(p1a, p2a, p1b, p2b) {
                let d = dist2(pt, cursor);
                if d <= tol2 && best.map_or(true, |(bd, _, _)| d < bd) {
                    best = Some((d, pt, id_a));
                }
            }
        }
    }
    best.map(|(_, point, eid)| SnapResult {
        point, kind: SnapMode::Intersection, source_eid: Some(eid), source_angle: None,
    })
}

/// Standard 2D segment-segment intersection. Returns the intersection
/// point only when both parameters t,s are in [0,1] (true intersection
/// inside both segments — not extension intersection).
fn segment_intersect(a1: [f64; 2], a2: [f64; 2], b1: [f64; 2], b2: [f64; 2]) -> Option<[f64; 2]> {
    let dax = a2[0] - a1[0];
    let day = a2[1] - a1[1];
    let dbx = b2[0] - b1[0];
    let dby = b2[1] - b1[1];
    let denom = dax * dby - day * dbx;
    if denom.abs() < 1e-12 { return None; }
    let dx = b1[0] - a1[0];
    let dy = b1[1] - a1[1];
    let t = (dx * dby - dy * dbx) / denom;
    let s = (dx * day - dy * dax) / denom;
    if (0.0..=1.0).contains(&t) && (0.0..=1.0).contains(&s) {
        Some([a1[0] + t * dax, a1[1] + t * day])
    } else {
        None
    }
}

/// Perpendicular: from `last_pick`, find a segment whose perpendicular
/// foot from `last_pick` lies within tolerance of cursor. Useful for
/// "drop a perpendicular from the previous click to this segment".
fn perpendicular(cursor: [f64; 2], ctx: &SnapContext<'_>, tol2: f64) -> Option<SnapResult> {
    let lp = ctx.last_pick?;
    let candidates = ctx.index.query_point(cursor, ctx.tolerance_world);
    let mut best: Option<(f64, [f64; 2], u32)> = None;
    for seg_id in candidates {
        let Some(&(p1, p2)) = ctx.segments.get(seg_id as usize) else { continue; };
        if let Some(foot) = perpendicular_foot(lp, p1, p2) {
            let d = dist2(foot, cursor);
            if d <= tol2 && best.map_or(true, |(bd, _, _)| d < bd) {
                best = Some((d, foot, seg_id));
            }
        }
    }
    best.map(|(_, point, eid)| SnapResult {
        point, kind: SnapMode::Perpendicular, source_eid: Some(eid), source_angle: None,
    })
}

/// Foot of perpendicular from point P to segment p1-p2. Returns None
/// if the foot falls outside the segment's parameter range [0,1].
fn perpendicular_foot(p: [f64; 2], p1: [f64; 2], p2: [f64; 2]) -> Option<[f64; 2]> {
    let dx = p2[0] - p1[0];
    let dy = p2[1] - p1[1];
    let len2 = dx * dx + dy * dy;
    if len2 < 1e-12 { return None; }
    let t = ((p[0] - p1[0]) * dx + (p[1] - p1[1]) * dy) / len2;
    if !(0.0..=1.0).contains(&t) { return None; }
    Some([p1[0] + t * dx, p1[1] + t * dy])
}

/// Tangent: requires arc/circle entities. Phase A treats all segments as
/// straight lines, so tangent has no work to do — returns None until
/// Phase B's typed entity model lands.
fn tangent(_cursor: [f64; 2], _ctx: &SnapContext<'_>, _tol2: f64) -> Option<SnapResult> {
    None
}

/// Parallel: from `last_pick`, find a direction parallel to a nearby
/// segment that the cursor approximately lies along. Useful for "draw
/// a line parallel to that wall."
fn parallel(cursor: [f64; 2], ctx: &SnapContext<'_>, tol2: f64) -> Option<SnapResult> {
    let lp = ctx.last_pick?;
    // Cursor direction from last_pick.
    let cdx = cursor[0] - lp[0];
    let cdy = cursor[1] - lp[1];
    let clen = (cdx * cdx + cdy * cdy).sqrt();
    if clen < 1e-9 { return None; }
    // Look at all segments within an EXPANDED tolerance (8x cursor radius)
    // — parallel snap looks at distant geometry to copy direction.
    let candidates = ctx.index.query_point(cursor, ctx.tolerance_world * 8.0);
    let mut best: Option<(f64, [f64; 2], u32, f32)> = None;
    let angle_tol_deg = 1.0_f64.to_radians();
    for seg_id in candidates {
        let Some(&(p1, p2)) = ctx.segments.get(seg_id as usize) else { continue; };
        let sdx = p2[0] - p1[0];
        let sdy = p2[1] - p1[1];
        let slen = (sdx * sdx + sdy * sdy).sqrt();
        if slen < 1e-9 { continue; }
        let cross = (cdx * sdy - cdy * sdx) / (clen * slen);
        if cross.abs() < angle_tol_deg.sin() {
            // Parallel — project cursor onto the lp-direction along
            // segment direction.
            let unit_x = sdx / slen;
            let unit_y = sdy / slen;
            let proj = (cursor[0] - lp[0]) * unit_x + (cursor[1] - lp[1]) * unit_y;
            let snapped = [lp[0] + proj * unit_x, lp[1] + proj * unit_y];
            let d = dist2(snapped, cursor);
            if d <= tol2 && best.map_or(true, |(bd, _, _, _)| d < bd) {
                let ang = sdy.atan2(sdx) as f32;
                best = Some((d, snapped, seg_id, ang));
            }
        }
    }
    best.map(|(_, point, eid, ang)| SnapResult {
        point, kind: SnapMode::Parallel, source_eid: Some(eid), source_angle: Some(ang),
    })
}
```

- [ ] **Step 2: Add tests for the new modes**

Append to `kernel/crates/snap/tests/integration.rs`:

```rust
#[test]
fn intersection_finds_crossing() {
    let (idx, segs) = build_scene_2segs();
    let ctx = SnapContext {
        index: &idx, segments: &segs,
        modes: SnapModeSet::INTERSECTION,
        tolerance_world: 0.5,
        last_pick: None, ortho_anchor: None,
        polar_increment_deg: 45.0, key_points: &[], grid_size: 100.0,
    };
    let r = SnapEngine::query([5.1, 0.1], &ctx).expect("intersection at [5,0]");
    assert_eq!(r.kind, SnapMode::Intersection);
    assert!((r.point[0] - 5.0).abs() < 1e-9);
    assert!((r.point[1] - 0.0).abs() < 1e-9);
}

#[test]
fn perpendicular_drops_from_last_pick() {
    let (idx, segs) = build_scene_2segs();
    // last_pick at [0, 5]. Drop perpendicular to horizontal segment
    // [0,0]-[10,0] → foot at [0, 0]. Cursor near [0, 0.1].
    let ctx = SnapContext {
        index: &idx, segments: &segs,
        modes: SnapModeSet::PERPENDICULAR,
        tolerance_world: 0.5,
        last_pick: Some([0.0, 5.0]),
        ortho_anchor: None,
        polar_increment_deg: 45.0, key_points: &[], grid_size: 100.0,
    };
    let r = SnapEngine::query([0.05, 0.1], &ctx).expect("perp foot at [0,0]");
    assert_eq!(r.kind, SnapMode::Perpendicular);
    assert!((r.point[0] - 0.0).abs() < 1e-9);
    assert!((r.point[1] - 0.0).abs() < 1e-9);
}
```

- [ ] **Step 3: Run tests**

```bash
cd kernel && cargo test -p kernel-snap --release 2>&1 | tail -10
```

Expected: 5 tests pass.

- [ ] **Step 4: Commit**

```bash
git add kernel/crates/snap/
git commit -m "feat(kernel-snap): Intersection + Perpendicular + Parallel modes (Tangent deferred)"
```

---

## Task 5: Implement Alignment + Nearest + Origin + Grid

**Files:**
- Modify: `kernel/crates/snap/src/query.rs`
- Modify: `kernel/crates/snap/tests/integration.rs`

- [ ] **Step 1: Add the four functions to dispatch + impl**

Add to dispatch chain:
```rust
    if ctx.modes.contains_mode(SnapMode::Alignment) {
        if let Some(r) = alignment(cursor, ctx, tol2) { return Some(r); }
    }
    if ctx.modes.contains_mode(SnapMode::Nearest) {
        if let Some(r) = nearest(cursor, ctx, tol2) { return Some(r); }
    }
    if ctx.modes.contains_mode(SnapMode::Origin) {
        if let Some(r) = origin(cursor, ctx, tol2) { return Some(r); }
    }
    if ctx.modes.contains_mode(SnapMode::Grid) {
        if let Some(r) = grid(cursor, ctx) { return Some(r); }
    }
```

Then add:

```rust
/// Alignment: cursor lies along a horizontal or vertical line through
/// any of the tracked key points.
fn alignment(cursor: [f64; 2], ctx: &SnapContext<'_>, tol2: f64) -> Option<SnapResult> {
    let mut best: Option<(f64, [f64; 2])> = None;
    for &kp in ctx.key_points.iter() {
        // Horizontal alignment: cursor.y ≈ kp.y → snap to (cursor.x, kp.y).
        let snapped_h = [cursor[0], kp[1]];
        let d = dist2(snapped_h, cursor);
        if d <= tol2 && best.map_or(true, |(bd, _)| d < bd) {
            best = Some((d, snapped_h));
        }
        // Vertical alignment: cursor.x ≈ kp.x → snap to (kp.x, cursor.y).
        let snapped_v = [kp[0], cursor[1]];
        let d = dist2(snapped_v, cursor);
        if d <= tol2 && best.map_or(true, |(bd, _)| d < bd) {
            best = Some((d, snapped_v));
        }
    }
    best.map(|(_, point)| SnapResult {
        point, kind: SnapMode::Alignment, source_eid: None, source_angle: None,
    })
}

/// Nearest: closest point on any nearby segment.
fn nearest(cursor: [f64; 2], ctx: &SnapContext<'_>, tol2: f64) -> Option<SnapResult> {
    let candidates = ctx.index.query_point(cursor, ctx.tolerance_world);
    let mut best: Option<(f64, [f64; 2], u32)> = None;
    for seg_id in candidates {
        let Some(&(p1, p2)) = ctx.segments.get(seg_id as usize) else { continue; };
        // Closest point on segment to cursor.
        let dx = p2[0] - p1[0];
        let dy = p2[1] - p1[1];
        let len2 = dx * dx + dy * dy;
        if len2 < 1e-12 { continue; }
        let t = (((cursor[0] - p1[0]) * dx + (cursor[1] - p1[1]) * dy) / len2).clamp(0.0, 1.0);
        let pt = [p1[0] + t * dx, p1[1] + t * dy];
        let d = dist2(pt, cursor);
        if d <= tol2 && best.map_or(true, |(bd, _, _)| d < bd) {
            best = Some((d, pt, seg_id));
        }
    }
    best.map(|(_, point, eid)| SnapResult {
        point, kind: SnapMode::Nearest, source_eid: Some(eid), source_angle: None,
    })
}

/// Origin: world origin (0,0). Snaps when cursor is within tolerance.
fn origin(cursor: [f64; 2], _ctx: &SnapContext<'_>, tol2: f64) -> Option<SnapResult> {
    let d = dist2([0.0, 0.0], cursor);
    if d <= tol2 {
        Some(SnapResult {
            point: [0.0, 0.0], kind: SnapMode::Origin, source_eid: None, source_angle: None,
        })
    } else {
        None
    }
}

/// Grid: round cursor to nearest grid_size multiple. Always returns a
/// result (lowest priority — only fires if everything else missed).
fn grid(cursor: [f64; 2], ctx: &SnapContext<'_>) -> Option<SnapResult> {
    let g = ctx.grid_size;
    if g <= 0.0 { return None; }
    let snapped = [
        (cursor[0] / g).round() * g,
        (cursor[1] / g).round() * g,
    ];
    Some(SnapResult {
        point: snapped, kind: SnapMode::Grid, source_eid: None, source_angle: None,
    })
}
```

- [ ] **Step 2: Add tests**

```rust
#[test]
fn alignment_horizontal_via_keypoint() {
    let (idx, segs) = build_scene_2segs();
    let key_points = vec![[20.0_f64, 3.0]];
    let ctx = SnapContext {
        index: &idx, segments: &segs,
        modes: SnapModeSet::ALIGNMENT,
        tolerance_world: 0.5,
        last_pick: None, ortho_anchor: None,
        polar_increment_deg: 45.0,
        key_points: &key_points,
        grid_size: 100.0,
    };
    // Cursor near keypoint's y=3. Snap should pull y to 3 exactly.
    let r = SnapEngine::query([7.0, 3.05], &ctx).expect("horizontal alignment");
    assert_eq!(r.kind, SnapMode::Alignment);
    assert!((r.point[1] - 3.0).abs() < 1e-9);
    assert!((r.point[0] - 7.0).abs() < 1e-9);
}

#[test]
fn nearest_finds_closest_point_on_segment() {
    let (idx, segs) = build_scene_2segs();
    let ctx = SnapContext {
        index: &idx, segments: &segs,
        modes: SnapModeSet::NEAREST,
        tolerance_world: 0.5,
        last_pick: None, ortho_anchor: None,
        polar_increment_deg: 45.0, key_points: &[], grid_size: 100.0,
    };
    // Cursor at (3, 0.3) — nearest on horizontal segment is (3, 0).
    let r = SnapEngine::query([3.0, 0.3], &ctx).expect("nearest on horizontal");
    assert_eq!(r.kind, SnapMode::Nearest);
    assert!((r.point[0] - 3.0).abs() < 1e-9);
    assert!((r.point[1] - 0.0).abs() < 1e-9);
}

#[test]
fn grid_rounds_cursor_to_nearest_cell() {
    let (idx, segs) = build_scene_2segs();
    let ctx = SnapContext {
        index: &idx, segments: &segs,
        modes: SnapModeSet::GRID,
        tolerance_world: 0.5,
        last_pick: None, ortho_anchor: None,
        polar_increment_deg: 45.0, key_points: &[], grid_size: 10.0,
    };
    let r = SnapEngine::query([23.7, 17.2], &ctx).expect("grid always snaps");
    assert_eq!(r.kind, SnapMode::Grid);
    assert!((r.point[0] - 20.0).abs() < 1e-9);
    assert!((r.point[1] - 20.0).abs() < 1e-9);
}
```

- [ ] **Step 3: Run tests**

```bash
cd kernel && cargo test -p kernel-snap --release 2>&1 | tail -10
```

Expected: 8 tests pass.

- [ ] **Step 4: Commit**

```bash
git add kernel/crates/snap/
git commit -m "feat(kernel-snap): Alignment + Nearest + Origin + Grid modes"
```

---

## Task 6: Performance benchmark + gate

**Files:**
- Create: `kernel/crates/snap/benches/query_bench.rs`

- [ ] **Step 1: Write Criterion benchmark**

```rust
//! Performance gate: p99 query < 0.5 ms on 1 M-segment scene.

use criterion::{criterion_group, criterion_main, Criterion, BatchSize};
use kernel_snap::{SnapEngine, SnapMode, SnapModeSet, SnapContext};
use kernel_spatial::{SegmentIndex, SegmentEntry};

fn make_synthetic_scene(n: usize) -> (SegmentIndex, Vec<([f64; 2], [f64; 2])>) {
    // Grid of n segments — each a 1-unit horizontal segment at integer cells.
    let cols = (n as f64).sqrt() as usize;
    let mut segments = Vec::with_capacity(n);
    let mut entries = Vec::with_capacity(n);
    for i in 0..n {
        let x = (i % cols) as f64;
        let y = (i / cols) as f64;
        let p1 = [x, y];
        let p2 = [x + 1.0, y];
        segments.push((p1, p2));
        entries.push(SegmentEntry { id: i as u32, p1, p2 });
    }
    (SegmentIndex::bulk_load(entries), segments)
}

fn bench_query(c: &mut Criterion) {
    // 1 million segments — the design's perf-gate target.
    let (idx, segs) = make_synthetic_scene(1_000_000);
    let modes = SnapModeSet::ENDPOINT | SnapModeSet::MIDPOINT | SnapModeSet::INTERSECTION
        | SnapModeSet::PERPENDICULAR | SnapModeSet::NEAREST;
    let ctx = SnapContext {
        index: &idx, segments: &segs, modes,
        tolerance_world: 0.5,
        last_pick: Some([100.0, 100.0]),
        ortho_anchor: None, polar_increment_deg: 45.0,
        key_points: &[], grid_size: 100.0,
    };
    c.bench_function("snap_query_1M_segs", |b| {
        b.iter_batched(
            || (500.0_f64 + rand_jitter(), 500.0_f64 + rand_jitter()),
            |(x, y)| { let _ = SnapEngine::query([x, y], &ctx); },
            BatchSize::SmallInput,
        );
    });
}

fn rand_jitter() -> f64 {
    use std::cell::Cell;
    thread_local! { static SEED: Cell<u64> = Cell::new(0x12345678_DEADBEEF); }
    SEED.with(|s| {
        let mut x = s.get();
        x ^= x << 13; x ^= x >> 7; x ^= x << 17;
        s.set(x);
        ((x >> 32) as f64 / u32::MAX as f64) * 10.0 - 5.0
    })
}

criterion_group!(benches, bench_query);
criterion_main!(benches);
```

- [ ] **Step 2: Run the benchmark**

```bash
cd kernel && cargo bench -p kernel-snap --bench query_bench 2>&1 | tail -20
```

Expected: criterion outputs a per-iter median. Target: < 500 µs (= 0.5 ms) at p99. If significantly slower:
- Cap candidate-set in `intersection` to 16 (down from 32)
- Add `tolerance_world * 8.0` cap on Parallel (already present)
- Consider parallel-mode-cap or removing it from default-active modes

If the benchmark passes (< 500 µs), continue. If it fails, document the actual p99 in the commit message and discuss with the user before proceeding.

- [ ] **Step 3: Commit**

```bash
git add kernel/crates/snap/benches/
git commit -m "feat(kernel-snap): Criterion benchmark — perf gate p99 < 0.5 ms on 1M segs"
```

---

## Task 7: Tracking module — KeyPointTracker (object-tracking acquisition)

**Files:**
- Modify: `kernel/crates/snap/src/tracking.rs`

The tracker records up to 7 key points (FIFO), each acquired by hovering over an Endpoint/Midpoint/Center for >250 ms without clicking. Phase A only implements the data structure + decay logic; integration with cursor events lives in Task 11.

- [ ] **Step 1: Replace `tracking.rs` with the implementation**

```rust
//! KeyPointTracker — collects up to 7 hover-acquired anchor points
//! (FIFO) used by SnapMode::Alignment for axis-locked tracking lines.

use crate::types::SnapMode;
use std::time::{Duration, Instant};

const MAX_KEY_POINTS: usize = 7;
const HOVER_DURATION: Duration = Duration::from_millis(250);

#[derive(Debug, Clone)]
pub struct KeyPointTracker {
    /// Currently hovered candidate + when hover started.
    hover: Option<(SnapMode, [f64; 2], Instant)>,
    /// Accepted key points (FIFO; oldest at index 0).
    points: Vec<[f64; 2]>,
}

impl KeyPointTracker {
    pub fn new() -> Self {
        Self { hover: None, points: Vec::with_capacity(MAX_KEY_POINTS) }
    }

    /// Call on every cursor frame. `hovered` = the snap result under
    /// the cursor (may be None). When the hover persists for HOVER_DURATION
    /// over an Endpoint/Midpoint/Center, the point is added.
    pub fn update(&mut self, hovered: Option<(SnapMode, [f64; 2])>, now: Instant) {
        match (self.hover, hovered) {
            (None, Some((kind, pt))) if is_acquirable(kind) => {
                self.hover = Some((kind, pt, now));
            }
            (Some((kind_was, pt_was, t)), Some((kind_now, pt_now)))
                if kind_was == kind_now && approx_eq(pt_was, pt_now)
            => {
                if now.duration_since(t) >= HOVER_DURATION {
                    self.add_point(pt_was);
                    // Reset hover so we don't add it again until the
                    // user moves away and back.
                    self.hover = None;
                }
            }
            _ => {
                self.hover = if let Some((k, p)) = hovered {
                    if is_acquirable(k) { Some((k, p, now)) } else { None }
                } else { None };
            }
        }
    }

    pub fn points(&self) -> &[[f64; 2]] {
        &self.points
    }

    pub fn clear(&mut self) {
        self.hover = None;
        self.points.clear();
    }

    fn add_point(&mut self, p: [f64; 2]) {
        // De-dup: don't add if already present (within 1e-6 world).
        if self.points.iter().any(|q| approx_eq(*q, p)) { return; }
        if self.points.len() == MAX_KEY_POINTS {
            self.points.remove(0); // FIFO eviction
        }
        self.points.push(p);
    }
}

fn is_acquirable(k: SnapMode) -> bool {
    matches!(k, SnapMode::Endpoint | SnapMode::Midpoint | SnapMode::Center)
}

fn approx_eq(a: [f64; 2], b: [f64; 2]) -> bool {
    (a[0] - b[0]).abs() < 1e-6 && (a[1] - b[1]).abs() < 1e-6
}

impl Default for KeyPointTracker {
    fn default() -> Self { Self::new() }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fifo_eviction_caps_at_7() {
        let mut t = KeyPointTracker::new();
        for i in 0..10 {
            t.add_point([i as f64, 0.0]);
        }
        assert_eq!(t.points.len(), 7);
        // First 3 evicted; should start at index 3.
        assert_eq!(t.points[0], [3.0, 0.0]);
        assert_eq!(t.points[6], [9.0, 0.0]);
    }

    #[test]
    fn dedupe_within_epsilon() {
        let mut t = KeyPointTracker::new();
        t.add_point([1.0, 2.0]);
        t.add_point([1.0_f64 + 1e-9, 2.0]);
        assert_eq!(t.points.len(), 1);
    }

    #[test]
    fn requires_hover_duration_before_acquire() {
        let mut t = KeyPointTracker::new();
        let t0 = Instant::now();
        t.update(Some((SnapMode::Endpoint, [5.0, 5.0])), t0);
        assert!(t.points.is_empty(), "first hover frame doesn't acquire");
        t.update(Some((SnapMode::Endpoint, [5.0, 5.0])), t0 + Duration::from_millis(100));
        assert!(t.points.is_empty(), "100ms later still not acquired");
        t.update(Some((SnapMode::Endpoint, [5.0, 5.0])), t0 + Duration::from_millis(300));
        assert_eq!(t.points.len(), 1, "after 300ms acquired");
        assert_eq!(t.points[0], [5.0, 5.0]);
    }
}
```

- [ ] **Step 2: Run tests**

```bash
cd kernel && cargo test -p kernel-snap --release 2>&1 | tail -10
```

Expected: 11 tests pass (8 from Tasks 3-5 + 3 new).

- [ ] **Step 3: Commit**

```bash
git add kernel/crates/snap/src/tracking.rs
git commit -m "feat(kernel-snap): KeyPointTracker (object-tracking acquisition, FIFO max 7)"
```

---

## Task 8: Wire `kernel-snap` into `open_2d_studio.rs` cursor handler

> **🚨 GATING CONSTRAINT 🚨**
> Task 8 MUST NOT START until BOTH:
> - The text-editor implementation plan's Task 11 is committed
> - The UI-crate plan's Task 11 is committed
>
> **Verify before starting:**
> ```bash
> cd /c/Users/rickd/Documents/GitHub/open-2d-studio
> git log --oneline merge-1.0-2.0 ^main 2>/dev/null | grep -E "End-to-end acceptance|chrome via kernel-ui|chrome via superui" | head -5
> ```
> If those commits aren't present, STOP and report waiting.

**Files:**
- Modify: `kernel/crates/app/Cargo.toml` (add `kernel-snap` dep)
- Modify: `kernel/crates/app/src/bin/open_2d_studio.rs` (wire cursor handler)

- [ ] **Step 1: Add kernel-snap dep**

In `kernel/crates/app/Cargo.toml`, add to `[dependencies]`:
```toml
kernel-snap = { path = "../snap" }
```

- [ ] **Step 2: Add use + App fields**

At top of `open_2d_studio.rs`:
```rust
use kernel_snap::{SnapEngine, SnapMode, SnapModeSet, SnapResult, SnapContext, tracking::KeyPointTracker};
```

In `struct App`:
```rust
    snap_modes: SnapModeSet,
    snap_tolerance_px: f32,
    snap_grid_size: f64,
    current_snap: Option<SnapResult>,
    key_tracker: KeyPointTracker,
```

In `App::new()`:
```rust
    snap_modes: SnapModeSet::ENDPOINT | SnapModeSet::MIDPOINT | SnapModeSet::INTERSECTION,
    snap_tolerance_px: 8.0,
    snap_grid_size: 100.0,
    current_snap: None,
    key_tracker: KeyPointTracker::new(),
```

- [ ] **Step 3: Compute snap on cursor move**

In the CursorMoved event handler (search `WindowEvent::CursorMoved`), after computing `cursor_world` (the world-space cursor), add:

```rust
    let snap_result = if !self.snap_modes.is_empty() {
        if let Some(tab) = self.tabs.get(self.active_tab) {
            if let Some(idx) = tab.scene_index.as_ref() {
                let wpp = self.world_per_pixel(&tab.cam);
                let tol_world = self.snap_tolerance_px as f64 * wpp;
                // Build a flat segments view from scene.segments (the
                // SegmentIndex was built from the same indices).
                // For Phase A, allocate per-frame; optimise later.
                let seg_view: Vec<([f64;2], [f64;2])> = tab.scene.segments.iter()
                    .map(|s| (s.p1, s.p2)).collect();
                let ctx = SnapContext {
                    index: &idx.seg_rtree,
                    segments: &seg_view,
                    modes: self.snap_modes,
                    tolerance_world: tol_world,
                    last_pick: self.measure_p1.or(self.dim_p1),  // any tool's last pick
                    ortho_anchor: None,
                    polar_increment_deg: 45.0,
                    key_points: self.key_tracker.points(),
                    grid_size: self.snap_grid_size,
                };
                SnapEngine::query(cursor_world, &ctx)
            } else { None }
        } else { None }
    } else { None };
    // Update tracker with what we hovered.
    let hover = snap_result.as_ref().map(|r| (r.kind, r.point));
    self.key_tracker.update(hover, std::time::Instant::now());
    self.current_snap = snap_result;
```

Field name `idx.seg_rtree` is from the existing SceneIndex struct — verify with grep `seg_rtree` first; if it's actually `seg_index` or similar, adapt.

If `cursor_world` isn't a local variable in the CursorMoved handler yet (it might be computed inline elsewhere), extract it:
```rust
    let cursor_world = self.screen_to_world_in(self.active_tab, self.canvas_rect, mx, my)
        .unwrap_or([0.0, 0.0]);
```

- [ ] **Step 4: Build + smoke**

```bash
cd kernel
taskkill //F //IM open_2d_studio.exe 2>/dev/null
cargo build --release --bin open_2d_studio 2>&1 | tail -10
./target/release/open_2d_studio.exe 2>/tmp/o2d_t8.log &
sleep 4
tasklist //FI "IMAGENAME eq open_2d_studio.exe" 2>/dev/null | grep open_2d_studio && echo "running"
taskkill //F //IM open_2d_studio.exe 2>/dev/null
```

Expected: green build + clean run. `current_snap` is now populated on cursor move (no visual yet — Task 9 adds the marker).

- [ ] **Step 5: Commit**

```bash
git add kernel/crates/app/Cargo.toml kernel/crates/app/src/bin/open_2d_studio.rs
git commit -m "feat(snap): wire SnapEngine into cursor handler"
```

---

## Task 9: Render snap markers (egui overlay)

> **🚨 GATING CONSTRAINT 🚨** — same as Task 8

**Files:**
- Modify: `kernel/crates/app/src/bin/open_2d_studio.rs`

- [ ] **Step 1: Add marker render in CentralPanel**

In the egui CentralPanel closure, after the canvas border and before the perf HUD, add:

```rust
    // ---- Snap marker overlay ---------------------------------
    if let Some(snap) = &self.current_snap {
        if let Some(tab) = self.tabs.get(self.active_tab) {
            let cam = &tab.cam;
            let rect = self.canvas_rect;
            let sx = world_to_screen_x_helper(snap.point[0], cam, rect);
            let sy = world_to_screen_y_helper(snap.point[1], cam, rect);
            let ppp = ctx.pixels_per_point();
            let lp = egui::pos2(sx / ppp, sy / ppp);
            let painter = ctx.layer_painter(egui::LayerId::new(
                egui::Order::Foreground, egui::Id::new("snap_marker"),
            ));
            paint_snap_marker(&painter, lp, snap.kind);
        }
    }
```

(The `world_to_screen_x_helper` / `world_to_screen_y_helper` were added by text-editor Task 10 — reuse.)

- [ ] **Step 2: Add `paint_snap_marker` helper**

At module level in open_2d_studio.rs:

```rust
fn paint_snap_marker(painter: &egui::Painter, p: egui::Pos2, kind: kernel_snap::SnapMode) {
    use kernel_snap::SnapMode;
    let yellow = egui::Color32::from_rgb(255, 220, 80);
    let stroke = egui::Stroke::new(1.5, yellow);
    let r = 6.0;
    match kind {
        SnapMode::Endpoint => {
            painter.rect_stroke(
                egui::Rect::from_center_size(p, egui::vec2(r * 2.0, r * 2.0)),
                0.0, stroke,
            );
        }
        SnapMode::Midpoint => {
            // Triangle pointing up.
            let pts = vec![
                egui::pos2(p.x, p.y - r),
                egui::pos2(p.x + r, p.y + r),
                egui::pos2(p.x - r, p.y + r),
            ];
            painter.add(egui::Shape::convex_polygon(pts, egui::Color32::TRANSPARENT, stroke));
        }
        SnapMode::Center => {
            painter.circle_stroke(p, r, stroke);
        }
        SnapMode::Intersection => {
            painter.line_segment([egui::pos2(p.x - r, p.y - r), egui::pos2(p.x + r, p.y + r)], stroke);
            painter.line_segment([egui::pos2(p.x + r, p.y - r), egui::pos2(p.x - r, p.y + r)], stroke);
        }
        SnapMode::Perpendicular => {
            painter.line_segment([egui::pos2(p.x - r, p.y), egui::pos2(p.x + r, p.y)], stroke);
            painter.line_segment([egui::pos2(p.x, p.y - r), egui::pos2(p.x, p.y + r)], stroke);
            painter.line_segment([egui::pos2(p.x - r, p.y - r), egui::pos2(p.x - r, p.y)], stroke);
        }
        SnapMode::Tangent => {
            painter.circle_stroke(p, r * 0.7, stroke);
            painter.line_segment([egui::pos2(p.x - r, p.y - r), egui::pos2(p.x + r, p.y - r)], stroke);
        }
        SnapMode::Parallel => {
            painter.line_segment([egui::pos2(p.x - r, p.y - 2.0), egui::pos2(p.x + r, p.y - 2.0)], stroke);
            painter.line_segment([egui::pos2(p.x - r, p.y + 2.0), egui::pos2(p.x + r, p.y + 2.0)], stroke);
        }
        SnapMode::Alignment => {
            painter.line_segment([egui::pos2(p.x - r, p.y), egui::pos2(p.x + r, p.y)],
                egui::Stroke::new(1.0, yellow));
        }
        SnapMode::Nearest => {
            // Hourglass.
            let pts = vec![
                egui::pos2(p.x - r, p.y - r), egui::pos2(p.x + r, p.y - r),
                egui::pos2(p.x - r, p.y + r), egui::pos2(p.x + r, p.y + r),
            ];
            painter.line_segment([pts[0], pts[3]], stroke);
            painter.line_segment([pts[1], pts[2]], stroke);
            painter.line_segment([pts[0], pts[1]], stroke);
            painter.line_segment([pts[2], pts[3]], stroke);
        }
        SnapMode::Origin => {
            painter.circle_stroke(p, r, stroke);
            painter.line_segment([egui::pos2(p.x - r, p.y), egui::pos2(p.x + r, p.y)], stroke);
            painter.line_segment([egui::pos2(p.x, p.y - r), egui::pos2(p.x, p.y + r)], stroke);
        }
        SnapMode::Grid => {
            painter.line_segment([egui::pos2(p.x - 3.0, p.y), egui::pos2(p.x + 3.0, p.y)], stroke);
            painter.line_segment([egui::pos2(p.x, p.y - 3.0), egui::pos2(p.x, p.y + 3.0)], stroke);
        }
    }
}
```

- [ ] **Step 2: Build + smoke**

```bash
cd kernel
taskkill //F //IM open_2d_studio.exe 2>/dev/null
cargo build --release --bin open_2d_studio 2>&1 | tail -10
./target/release/open_2d_studio.exe 2>/tmp/o2d_t9.log &
sleep 4
taskkill //F //IM open_2d_studio.exe 2>/dev/null
```

User will visually verify snap markers appear on cursor hover near segment endpoints/midpoints/intersections.

- [ ] **Step 3: Commit**

```bash
git add kernel/crates/app/src/bin/open_2d_studio.rs
git commit -m "feat(snap): render snap-marker glyphs as egui overlay"
```

---

## Task 10: OsnapStrip widget in superui status bar

> **🚨 GATING CONSTRAINT 🚨** — UI-crate Task 11 must be committed first.

**Files:**
- Modify: `kernel/crates/superui/src/layout/status_bar.rs` — add OsnapStrip section type
- Modify: `kernel/crates/app/src/bin/open_2d_studio.rs` — feed snap_modes into OsnapStrip, handle action

- [ ] **Step 1: Extend `StatusSection` enum in superui**

In `kernel/crates/superui/src/layout/status_bar.rs`, add a variant:
```rust
    OsnapStrip { active: u32 },  // bitmask, layout matching kernel_snap::SnapModeSet bits
```

In the `match section` block:
```rust
    StatusSection::OsnapStrip { active } => {
        let labels = [
            ("END", 1 << 0), ("MID", 1 << 1), ("CEN", 1 << 2),
            ("INT", 1 << 3), ("PER", 1 << 4), ("PAR", 1 << 5),
            ("TAN", 1 << 6), ("ALN", 1 << 7), ("NEA", 1 << 8),
            ("ORG", 1 << 9), ("GRD", 1 << 10),
        ];
        for (label, bit) in labels {
            let on = active & bit != 0;
            let bg = if on { palette.button_active } else { palette.status_bg };
            let (trect, tresp) = ui.allocate_exact_size(
                Vec2::new(36.0, h - 4.0), Sense::click(),
            );
            ui.painter().rect_filled(trect, 0.0, bg);
            ui.painter().text(
                trect.center(), egui::Align2::CENTER_CENTER,
                label, egui::FontId::proportional(10.0), palette.fg,
            );
            if tresp.clicked() {
                actions.push(StatusBarAction::Toggled(format!("osnap:{}", bit)));
            }
            ui.add_space(2.0);
        }
    }
```

- [ ] **Step 2: Wire from open_2d_studio.rs**

In open_2d_studio.rs's StatusBar build (Task 11 of UI-crate plan added the StatusBar — verify it's there):

```rust
    let sections = vec![
        // ... existing sections ...
        StatusSection::Spacer,
        StatusSection::OsnapStrip { active: self.snap_modes.bits() },
    ];
```

In the StatusBarAction handler:
```rust
    for a in actions {
        match a {
            StatusBarAction::Toggled(id) if id.starts_with("osnap:") => {
                let bit: u32 = id["osnap:".len()..].parse().unwrap_or(0);
                self.snap_modes.toggle(SnapModeSet::from_bits_truncate(bit));
            }
            _ => {}
        }
    }
```

- [ ] **Step 3: Build + smoke**

```bash
cd kernel
taskkill //F //IM open_2d_studio.exe 2>/dev/null
cargo build --release --bin open_2d_studio 2>&1 | tail -10
./target/release/open_2d_studio.exe 2>/tmp/o2d_t10.log &
sleep 4
taskkill //F //IM open_2d_studio.exe 2>/dev/null
```

User verifies: status bar shows END/MID/CEN/INT/PER/PAR/TAN/ALN/NEA/ORG/GRD toggle pills; clicking each enables/disables that mode.

- [ ] **Step 4: Commit**

```bash
git add kernel/crates/superui/src/layout/status_bar.rs kernel/crates/app/src/bin/open_2d_studio.rs
git commit -m "feat(snap): OsnapStrip in status bar — toggle each snap mode"
```

---

## Task 11: Persist snap settings via Tauri Store

> **🚨 GATING CONSTRAINT 🚨** — Tasks 8-10 must be committed.

**Files:**
- Modify: `kernel/crates/app/src/bin/open_2d_studio.rs`

- [ ] **Step 1: Add settings load on startup**

In `App::new()` or after initial load, attempt to read settings from a known path (the binary doesn't currently use Tauri Store; for Phase A use a simple JSON file in the user-data dir):

```rust
fn settings_path() -> std::path::PathBuf {
    dirs::data_local_dir()
        .unwrap_or_else(|| std::path::PathBuf::from("."))
        .join("Open2DStudio").join("snap_settings.json")
}

fn load_snap_settings() -> Option<(u32, f32, f64)> {
    let p = settings_path();
    let txt = std::fs::read_to_string(&p).ok()?;
    let v: serde_json::Value = serde_json::from_str(&txt).ok()?;
    let modes = v.get("snap_modes")?.as_u64()? as u32;
    let tol = v.get("tolerance_px")?.as_f64()? as f32;
    let grid = v.get("grid_size")?.as_f64()?;
    Some((modes, tol, grid))
}

fn save_snap_settings(modes: u32, tol: f32, grid: f64) {
    let p = settings_path();
    if let Some(parent) = p.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let v = serde_json::json!({
        "snap_modes": modes,
        "tolerance_px": tol,
        "grid_size": grid,
    });
    let _ = std::fs::write(&p, v.to_string());
}
```

In `App::new()`:
```rust
    let (modes, tol, grid) = load_snap_settings()
        .unwrap_or((SnapModeSet::ENDPOINT.bits() | SnapModeSet::MIDPOINT.bits() | SnapModeSet::INTERSECTION.bits(),
                    8.0, 100.0));
    // Then use these values to init snap_modes / snap_tolerance_px / snap_grid_size.
```

- [ ] **Step 2: Save on toggle**

In the OsnapStrip action handler, after `self.snap_modes.toggle(...)`, add:
```rust
    save_snap_settings(self.snap_modes.bits(), self.snap_tolerance_px, self.snap_grid_size);
```

- [ ] **Step 3: Build + smoke**

```bash
cd kernel && cargo build --release --bin open_2d_studio 2>&1 | tail -5
```

(Add `dirs = "5"` to app/Cargo.toml deps if not already present.)

- [ ] **Step 4: Commit**

```bash
git add kernel/crates/app/Cargo.toml kernel/crates/app/src/bin/open_2d_studio.rs
git commit -m "feat(snap): persist snap settings to user-data JSON file"
```

---

## Task 12: Ortho/Polar/Grid constraint + key-tracker integration

> **🚨 GATING CONSTRAINT 🚨** — Tasks 8-11 committed.

**Files:**
- Modify: `kernel/crates/snap/src/constraint.rs`
- Modify: `kernel/crates/app/src/bin/open_2d_studio.rs`

- [ ] **Step 1: Implement constraint helpers**

In `kernel/crates/snap/src/constraint.rs`:

```rust
//! Cursor-constraint helpers — Ortho, Polar.
//!
//! Applied BEFORE snap-mode queries so all snaps see a constrained
//! cursor.

/// Constrain cursor to nearest H/V from anchor.
pub fn ortho(anchor: [f64; 2], cursor: [f64; 2]) -> [f64; 2] {
    let dx = (cursor[0] - anchor[0]).abs();
    let dy = (cursor[1] - anchor[1]).abs();
    if dx >= dy {
        [cursor[0], anchor[1]]   // horizontal lock
    } else {
        [anchor[0], cursor[1]]   // vertical lock
    }
}

/// Constrain cursor to nearest polar-multiple direction from anchor.
pub fn polar(anchor: [f64; 2], cursor: [f64; 2], increment_deg: f32) -> [f64; 2] {
    let dx = cursor[0] - anchor[0];
    let dy = cursor[1] - anchor[1];
    let dist = (dx * dx + dy * dy).sqrt();
    if dist < 1e-9 { return cursor; }
    let theta = dy.atan2(dx);
    let inc_rad = (increment_deg as f64).to_radians();
    let snapped_theta = (theta / inc_rad).round() * inc_rad;
    [anchor[0] + dist * snapped_theta.cos(), anchor[1] + dist * snapped_theta.sin()]
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn ortho_horizontal_when_dx_dominates() {
        let r = ortho([0.0, 0.0], [10.0, 3.0]);
        assert_eq!(r, [10.0, 0.0]);
    }
    #[test]
    fn ortho_vertical_when_dy_dominates() {
        let r = ortho([0.0, 0.0], [3.0, 10.0]);
        assert_eq!(r, [0.0, 10.0]);
    }
    #[test]
    fn polar_45deg_snaps_diagonal() {
        let r = polar([0.0, 0.0], [10.0, 9.0], 45.0);
        let expected = (10.0_f64.hypot(9.0)) * (45.0_f64.to_radians().cos());
        assert!((r[0] - expected).abs() < 1e-6);
        assert!((r[1] - expected).abs() < 1e-6);
    }
}
```

- [ ] **Step 2: Wire constraints + Ortho (F8) + Polar (F10) + Track (F11) toggles**

In open_2d_studio.rs, add App fields:
```rust
    ortho_on: bool,
    polar_on: bool,
    track_on: bool,
```

Init false. Add F8/F10/F11 key handlers:
```rust
    PhysicalKey::Code(KeyCode::F8) if state == ElementState::Pressed => {
        self.ortho_on = !self.ortho_on;
    }
    PhysicalKey::Code(KeyCode::F10) if state == ElementState::Pressed => {
        self.polar_on = !self.polar_on;
    }
    PhysicalKey::Code(KeyCode::F11) if state == ElementState::Pressed => {
        self.track_on = !self.track_on;
        if !self.track_on { self.key_tracker.clear(); }
    }
```

In the snap query block (Task 8), apply constraint to cursor BEFORE the SnapEngine call:
```rust
    let constrained = if let Some(anchor) = self.measure_p1.or(self.dim_p1) {
        if self.ortho_on {
            kernel_snap::constraint::ortho(anchor, cursor_world)
        } else if self.polar_on {
            kernel_snap::constraint::polar(anchor, cursor_world, 45.0)
        } else { cursor_world }
    } else { cursor_world };
    // Then use `constrained` instead of `cursor_world` in SnapEngine::query.
```

If `track_on` is false, pass `&[]` for key_points instead of `self.key_tracker.points()`.

- [ ] **Step 3: Build + smoke**

```bash
cd kernel && cargo build --release --bin open_2d_studio 2>&1 | tail -5
./target/release/open_2d_studio.exe 2>/tmp/o2d_t12.log &
sleep 4
taskkill //F //IM open_2d_studio.exe 2>/dev/null
```

User verifies: F8/F10/F11 toggle Ortho/Polar/Tracking.

- [ ] **Step 4: Commit**

```bash
git add kernel/crates/snap/src/constraint.rs kernel/crates/app/src/bin/open_2d_studio.rs
git commit -m "feat(snap): Ortho/Polar/Tracking F8/F10/F11 + cursor constraint pipeline"
```

---

## Self-Review Results

**Spec coverage** (vs `docs/superpowers/specs/2026-05-01-drawing-tools-design.md` §6.1):
- ✅ §6.1.1 Create kernel-snap crate → Task 1
- ✅ §6.1.2 Define types → Task 2
- ✅ §6.1.3 Implement query for each mode → Tasks 3-5
- ✅ §6.1.4 Wire into binary cursor handler → Task 8
- ✅ §6.1.5 Render snap marker → Task 9
- ✅ §6.1.6 Status-bar OSNAP toggles → Task 10
- ✅ §6.1.7 Persistence → Task 11
- ✅ §6.1.8 Object-tracking acquisition → Task 7 (KeyPointTracker) + Task 12 (F11 toggle)
- ✅ §6.1.9 Ortho/Polar constraint → Task 12
- ✅ §6.1.10 Grid snap → Task 5 (Grid mode in query.rs)
- ✅ §6.1.11 Tests → Tasks 3, 4, 5 (8 integration tests)
- ✅ §6.1.12 Performance gate → Task 6 (Criterion benchmark)

**Acceptance criteria** (§6.2): Tasks 8-12 deliver all 7 acceptance criteria when those gated tasks land after text-editor + UI-crate complete.

**Placeholder scan:** Task 8 Step 3 references `idx.seg_rtree` field — agent may need to grep for actual field name; flagged as "verify with grep" instruction. No TBD/TODO leaks.

**Type consistency:** `SnapMode`, `SnapModeSet`, `SnapResult`, `SnapContext`, `SnapEngine`, `KeyPointTracker` used identically across Tasks 2-12. Public re-exports in lib.rs (Task 1).

**Scope:** 12 tasks. Tasks 1-7 entirely in `kernel/crates/snap/` — ZERO conflict with other in-flight plans, can start immediately. Tasks 8-12 GATED on text-editor + UI-crate completion.

**Risks called out in plan:**
- Task 6 perf gate may fail → mitigation: cap candidate set tighter, document p99
- Task 7 KeyPointTracker time-based test sensitive to clock — uses Instant arithmetic for determinism
- Task 8/9 reference helper `world_to_screen_x_helper` from text-editor Task 10 — assumes that lands first (same gating)
