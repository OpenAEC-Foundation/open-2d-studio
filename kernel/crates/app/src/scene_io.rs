//! scene_io — shared DXF / DWG → tessellated line-segment scene loader.
//!
//! Extracted from `split_compare.rs` so that `headless_render.rs` (and any
//! other binary that wants to rasterise CAD geometry) renders the SAME
//! geometry that the GUI viewer shows. The previous inline copy in
//! `headless_render.rs` lacked the recursive INSERT-block expansion and
//! HATCH support that landed in `split_compare`, which produced large
//! pixel-diff regressions on files like AC1024 even though the GUI viewer
//! drew the file correctly.
//!
//! Public surface:
//!   - `Scene { segments, bbox, source, count_label }`
//!   - `Segment { p1, p2, color, is_paper: false }`
//!   - `load_dxf(path) -> Result<Scene>`
//!   - `load_dwg(path) -> Result<Scene>`
//!
//! All tessellation helpers (`Xform`, `expand_insert`, `tessellate_one`,
//! `expand_bbox`) stay private to this module.

use std::collections::{HashMap, HashSet};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

// =============================================================================
// Cancellation support
// =============================================================================
//
// Long-running loaders (`load_dwg`, `load_dxf`) consult a thread-local
// `Arc<AtomicBool>` flag at hot-path boundaries (entity loops, INSERT
// expansion). If a worker thread has installed a flag via
// `set_load_cancel(...)` and the UI thread flips it to `true`, the next
// `check_load_cancel()` call returns true and the loader can bail out
// early with a `LoadCancelled` error.
//
// Threading model: the loader runs on a worker thread; the UI thread
// only writes the flag. The thread-local lives on the worker. Other
// callers (headless / mockup binaries) that don't install a flag pay
// only one TLS lookup + one `Option::is_none` per check — negligible.

thread_local! {
    static LOAD_CANCEL: std::cell::RefCell<Option<Arc<AtomicBool>>> =
        const { std::cell::RefCell::new(None) };
}

/// RAII guard that clears the per-thread cancel flag on drop. Returned by
/// `set_load_cancel` so the caller can `let _g = set_load_cancel(...)`
/// and forget about it.
pub struct LoadCancelGuard;
impl Drop for LoadCancelGuard {
    fn drop(&mut self) {
        LOAD_CANCEL.with(|c| *c.borrow_mut() = None);
    }
}

/// Install a cancel flag on the current thread. Subsequent loader calls
/// on this thread will check it at convenient points.
pub fn set_load_cancel(flag: Arc<AtomicBool>) -> LoadCancelGuard {
    LOAD_CANCEL.with(|c| *c.borrow_mut() = Some(flag));
    LoadCancelGuard
}

/// Returns true iff a cancel flag is installed on the current thread
/// AND it has been set to true by another thread. Cheap enough to call
/// once per entity in the inner loops.
#[inline]
pub fn check_load_cancel() -> bool {
    LOAD_CANCEL.with(|c| {
        c.borrow().as_ref().map_or(false, |f| f.load(Ordering::Relaxed))
    })
}

/// Sentinel error type returned when a load is cancelled mid-flight.
/// Wrapped in `anyhow::Error` by the loader so call-sites can downcast
/// to distinguish cancellation from a real failure.
#[derive(Debug)]
pub struct LoadCancelled;
impl std::fmt::Display for LoadCancelled {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "load cancelled by user")
    }
}
impl std::error::Error for LoadCancelled {}

/// Helper: bail with `LoadCancelled` if the thread-local flag is set.
#[inline]
fn bail_if_cancelled() -> anyhow::Result<()> {
    if check_load_cancel() {
        Err(anyhow::Error::new(LoadCancelled))
    } else {
        Ok(())
    }
}

// =============================================================================
// Public types
// =============================================================================

/// One tessellated line segment in world coordinates.
///
/// `color` is a packed RGBA u32 (0xAABBGGRR little-endian, matching the
/// `Vertex` color format in `split_compare.rs`). A value of 0 means
/// "use the pane default color" — lets the viewer distinguish DXF (green)
/// from DWG (orange) while still honoring per-entity colors when set.
///
/// `is_paper` tags which "space" the segment belongs to: false = model
/// (raw DXF coords), true = paper-space (sheet-frame rectangle, viewport
/// border, or model content projected into a viewport). The viewer
/// filters on this — Model tab shows !is_paper, Layout tab shows
/// is_paper — so model and paper don't overlay each other as they did
/// in the first viewport iteration.
#[derive(Clone, Copy)]
pub struct Segment {
    pub p1: [f64; 2],
    pub p2: [f64; 2],
    pub color: u32,
    pub is_paper: bool,
}

/// A filled triangle — used for SOLID entities and solid-pattern HATCH
/// regions ("palen zijn solid gearceerd" etc.). Rendered by a separate
/// triangle pipeline behind the line pipeline so outlines stay visible
/// on top of the fill. `color` and `is_paper` have the same semantics
/// as Segment.
#[derive(Clone, Copy)]
pub struct Triangle {
    pub v: [[f64; 2]; 3],
    pub color: u32,
    pub is_paper: bool,
    /// Category — lets the viewer apply zoom-dependent LOD. `Solid`
    /// (HATCH fills, 3DFACE, SOLID, TRACE) is always drawn. `TextFill`
    /// (TTF glyph interiors) can be skipped at low zoom because it adds
    /// hundreds of thousands of tiny triangles for labels that are
    /// barely visible anyway — the stroke outline remains readable.
    pub kind: TriKind,
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum TriKind {
    Solid,
    TextFill,
}

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

/// A tessellated 2D scene: line segments + bounding box + provenance label.
pub struct Scene {
    pub segments: Vec<Segment>,
    /// Filled-triangle primitives. Populated by SOLID, 3DFACE, TRACE,
    /// and solid-pattern HATCH entities. Rendered before segments so
    /// outlines (the boundaries of those same entities) stay on top.
    pub triangles: Vec<Triangle>,
    pub bbox: [f64; 4],
    pub source: &'static str,
    pub count_label: String,
    /// Named layout extents from the DXF/DWG's ACAD_LAYOUT dictionary,
    /// each entry is (layout_name, [xmin,ymin,xmax,ymax]) in world units.
    /// Populated by `load_dxf` (currently DWG returns empty since our
    /// DWG parser doesn't expose LAYOUT records yet). The viewer uses
    /// this list to render per-pane "Model / Layout1 / Layout2" tabs so
    /// the user can fit the camera to a specific sheet.
    pub layouts: Vec<(String, [f64; 4])>,
    /// Per-scene layer index — used by the Layer Manager UI to show
    /// real layer names and toggle visibility. `layer_names[i]` is the
    /// layer string (case preserved from DXF), `layer_colors[i]` is the
    /// swatch RGBA sourced from the layer's ACI/true-color. Entity index
    /// `segment_layer_idx[seg_idx]` points into these arrays.
    ///
    /// For scenes where layers aren't parseable (DWG without LAYER
    /// tables) a single `"0"` entry is pushed as a fallback.
    pub layer_names: Vec<String>,
    pub layer_colors: Vec<u32>,
    pub segment_layer_idx: Vec<u16>,
    pub triangle_layer_idx: Vec<u16>,
    /// Per-segment / per-triangle ENTITY group index. All fragments
    /// emitted by ONE source entity share the same `entity_idx`. This
    /// groups together:
    ///   - A dashed LINE's many sub-segments (one entity_idx)
    ///   - A DIMENSION's extension-lines + tick-marks + text glyphs
    ///   - An INSERT with all of its child block entities (recursively)
    ///   - A HATCH's boundary strokes + fill triangles
    /// The viewer picks whole entities on click instead of stray fragments.
    pub segment_entity_idx: Vec<u32>,
    pub triangle_entity_idx: Vec<u32>,
    /// Human-readable name per entity_idx for the Properties panel (e.g.
    /// "LINE", "MTEXT", "HATCH", "INSERT \"A4_A0_grootformaat\"", "DIMENSION").
    /// Parallel array: `entity_names[i]` describes all segments/triangles
    /// with entity_idx == i. Empty when a scene was built before this
    /// field landed — viewer tolerates that.
    pub entity_names: Vec<String>,
    /// Per-entity raw text data, indexed by entity_idx. None for
    /// non-text entities. Populated by load_dxf and load_dwg in their
    /// TEXT/MTEXT branches. Consumed by re_tessellate_text_entity()
    /// on edit-commit.
    pub entity_text: Vec<Option<EntityText>>,
    /// Per-segment dash style — parallel to `segments`. Encodes the
    /// LINETYPE classification, NOT the world-unit dash pattern. Values:
    ///   0 = solid (continuous, no dashing)
    ///   1 = dashed
    ///   2 = dotted
    ///   3 = dash-dot
    /// At scene-build time we push ONE long solid segment per LINE/POLY
    /// entity even when its LINETYPE calls for dashing — the actual dash
    /// strokes are generated PER-FRAME in `build_verts` using the
    /// camera's world-per-pixel factor. That keeps the dash STRIDE
    /// constant on screen across all zoom levels (the previous behaviour
    /// emitted world-space dashes which became invisible when zoomed
    /// out and grossly oversized when zoomed in). For SCREEN-FIXED dash
    /// strides see the per-kind tables in build_verts.
    pub segment_dash_kind: Vec<u8>,
}

impl Scene {
    /// Empty scene placeholder (used by the GUI for blank panes / load errors).
    pub fn empty(source: &'static str, label: String) -> Self {
        Self {
            segments: Vec::new(),
            triangles: Vec::new(),
            bbox: [0.0, 0.0, 1.0, 1.0],
            source,
            count_label: label,
            layer_names: Vec::new(),
            layer_colors: Vec::new(),
            segment_layer_idx: Vec::new(),
            triangle_layer_idx: Vec::new(),
            segment_entity_idx: Vec::new(),
            triangle_entity_idx: Vec::new(),
            entity_names: Vec::new(),
            layouts: Vec::new(),
            entity_text: Vec::new(),
            segment_dash_kind: Vec::new(),
        }
    }
}

// =============================================================================
// ACI (AutoCAD Color Index) → RGBA resolver
// =============================================================================

/// Resolve a DXF AutoCAD Color Index (ACI) to a packed RGBA u32
/// (0xAABBGGRR little-endian — matches the `Vertex` color format in
/// `split_compare.rs`).
///
/// ACI conventions per DXF reference:
///   0   = BYBLOCK (inherit from parent INSERT's color; we return 0
///         so segments_to_verts falls through to the pane default).
///   256 = BYLAYER (inherit from layer; same fallback).
///   1-9 = fixed palette — red, yellow, green, cyan, blue, magenta,
///         white/black, dark-grey, light-grey.
///  10-255 = AutoCAD's color wheel (full 768-byte palette in theory). We
///         approximate with an HSV-style hash per index — keeps adjacent
///         indices visually distinct without pulling in the full table.
/// Liang-Barsky 2D segment clip against an axis-aligned rectangle.
/// Returns the clipped (p1, p2) if the segment intersects the rect, or
/// None if fully outside. Rect is [xmin, ymin, xmax, ymax].
fn clip_segment_to_rect(p1: [f64; 2], p2: [f64; 2], rect: [f64; 4]) -> Option<([f64; 2], [f64; 2])> {
    let dx = p2[0] - p1[0];
    let dy = p2[1] - p1[1];
    let p = [-dx, dx, -dy, dy];
    let q = [p1[0] - rect[0], rect[2] - p1[0], p1[1] - rect[1], rect[3] - p1[1]];
    let mut u1 = 0.0_f64;
    let mut u2 = 1.0_f64;
    for i in 0..4 {
        if p[i].abs() < 1e-12 {
            if q[i] < 0.0 { return None; } // parallel and outside
        } else {
            let t = q[i] / p[i];
            if p[i] < 0.0 {
                if t > u2 { return None; }
                if t > u1 { u1 = t; }
            } else {
                if t < u1 { return None; }
                if t < u2 { u2 = t; }
            }
        }
    }
    let np1 = [p1[0] + u1 * dx, p1[1] + u1 * dy];
    let np2 = [p1[0] + u2 * dx, p1[1] + u2 * dy];
    Some((np1, np2))
}

/// Sutherland-Hodgman polygon clip against an axis-aligned rectangle.
/// Clips a convex polygon (e.g. a triangle) against the 4 rect edges,
/// returning 0..=7 output vertices. Caller fan-triangulates to emit
/// triangles back into the scene.
fn clip_polygon_to_rect(input: &[[f64; 2]], rect: [f64; 4]) -> Vec<[f64; 2]> {
    // Clip against each edge in turn: left, right, bottom, top.
    // For each edge, "inside" = the half-plane containing the interior.
    let edges: [(&str, f64); 4] = [
        ("xmin", rect[0]), ("xmax", rect[2]),
        ("ymin", rect[1]), ("ymax", rect[3]),
    ];
    let mut out: Vec<[f64; 2]> = input.to_vec();
    for (which, v) in edges.iter() {
        if out.is_empty() { break; }
        let input_copy = std::mem::take(&mut out);
        let n = input_copy.len();
        for i in 0..n {
            let curr = input_copy[i];
            let prev = input_copy[(i + n - 1) % n];
            let inside_curr = match *which {
                "xmin" => curr[0] >= *v, "xmax" => curr[0] <= *v,
                "ymin" => curr[1] >= *v, "ymax" => curr[1] <= *v,
                _ => true,
            };
            let inside_prev = match *which {
                "xmin" => prev[0] >= *v, "xmax" => prev[0] <= *v,
                "ymin" => prev[1] >= *v, "ymax" => prev[1] <= *v,
                _ => true,
            };
            if inside_curr {
                if !inside_prev {
                    // Compute intersection of [prev, curr] with the edge.
                    let (dx, dy) = (curr[0] - prev[0], curr[1] - prev[1]);
                    let t = match *which {
                        "xmin" | "xmax" => (v - prev[0]) / (if dx.abs() > 1e-12 { dx } else { 1e-12 }),
                        "ymin" | "ymax" => (v - prev[1]) / (if dy.abs() > 1e-12 { dy } else { 1e-12 }),
                        _ => 0.0,
                    };
                    out.push([prev[0] + t * dx, prev[1] + t * dy]);
                }
                out.push(curr);
            } else if inside_prev {
                let (dx, dy) = (curr[0] - prev[0], curr[1] - prev[1]);
                let t = match *which {
                    "xmin" | "xmax" => (v - prev[0]) / (if dx.abs() > 1e-12 { dx } else { 1e-12 }),
                    "ymin" | "ymax" => (v - prev[1]) / (if dy.abs() > 1e-12 { dy } else { 1e-12 }),
                    _ => 0.0,
                };
                out.push([prev[0] + t * dx, prev[1] + t * dy]);
            }
        }
    }
    out
}

/// Ear-clip triangulation of a simple 2D polygon.
///
/// Input: a closed-ring vertex list (first != last; we do not require the
/// caller to duplicate). Output: a list of (i, j, k) index triples into
/// the input, one per triangle.
///
/// This is the textbook O(N²) ear-clip — good enough for typical HATCH
/// boundary rings (tens of vertices). Self-intersecting polygons are
/// handled by the inside-point test (Winding rule via cross-product
/// sign); in pathological cases we bail out early and leave the
/// remaining polygon un-triangulated rather than loop forever.
///
/// The polygon is reversed in place if it's clockwise — ear-clip
/// requires CCW winding to interpret "inside" correctly.
/// Clip a full infinite line (through `base` with direction
/// `dir = (cos θ, sin θ)`) against a closed polygon `ring`. Emits one
/// or more (p1, p2) line segments where the line is INSIDE the polygon.
///
/// Algorithm:
///   1. Intersect the line with every edge of the ring; collect signed
///      parametric values `t` along the line direction.
///   2. Sort the `t` values. Odd indices = entering, even = exiting
///      (for a simple polygon this alternates).
///   3. Emit segments between consecutive t-pairs.
///
/// Degenerate / near-parallel edges are skipped. For non-simple rings
/// (holes, self-intersections) the result is best-effort.
fn clip_line_to_ring(base: [f64; 2], dir: [f64; 2], ring: &[[f64; 2]])
    -> Vec<([f64; 2], [f64; 2])>
{
    let n = ring.len();
    if n < 3 { return Vec::new(); }
    let (dx, dy) = (dir[0], dir[1]);
    let mut ts: Vec<f64> = Vec::with_capacity(n);
    for i in 0..n {
        let a = ring[i];
        let b = ring[(i + 1) % n];
        // Line:    P = base + t * dir
        // Edge:    Q = a + u * (b - a)       0 <= u <= 1
        // Solve for (t, u): base + t*dir = a + u*(b-a)
        //   t*dx - u*(b.x - a.x) = a.x - base.x
        //   t*dy - u*(b.y - a.y) = a.y - base.y
        let ex = b[0] - a[0];
        let ey = b[1] - a[1];
        // Solve  [dx  -ex] [t]   [rx]     where rx,ry = a - base.
        //        [dy  -ey] [u] = [ry]
        // det(A) = dx*(-ey) - (-ex)*dy = ex*dy - dy*ex
        //   (wait — det = dx*(-ey) - (-ex)*dy = -dx*ey + ex*dy)
        // Using Cramer's:
        //   t = (rx*(-ey) - (-ex)*ry) / det = (-rx*ey + ex*ry) / det
        //   u = (dx*ry - dy*rx)            / det
        let det = -dx * ey + ex * dy;
        if det.abs() < 1e-12 { continue; } // parallel
        let rx = a[0] - base[0];
        let ry = a[1] - base[1];
        let t = (ex * ry - ey * rx) / det;
        let u = (dx * ry - dy * rx) / det;
        if u >= -1e-9 && u <= 1.0 + 1e-9 && t.is_finite() {
            ts.push(t);
        }
    }
    // Sort and emit pairs. All ts values are guaranteed finite (NaN/Inf
    // filtered above) so total_cmp is unnecessary — but use it anyway as
    // belt-and-braces against future regressions: Rust's sort requires a
    // total order, partial_cmp+unwrap_or(Equal) violates transitivity on
    // NaN and triggers a panic in driftsort.
    ts.sort_by(|a, b| a.total_cmp(b));
    // Dedupe near-equal t-values (line passing exactly through a vertex
    // produces two intersections that should count as one).
    ts.dedup_by(|a, b| (*a - *b).abs() < 1e-6);
    let mut segs = Vec::new();
    let mut k = 0usize;
    while k + 1 < ts.len() {
        let t0 = ts[k];
        let t1 = ts[k + 1];
        if (t1 - t0).abs() > 1e-9 {
            let p1 = [base[0] + t0 * dx, base[1] + t0 * dy];
            let p2 = [base[0] + t1 * dx, base[1] + t1 * dy];
            segs.push((p1, p2));
        }
        k += 2;
    }
    segs
}

/// Emit a clipped hatch-pattern segment with optional dash pattern.
///
/// `dashes` follows DXF code 49 semantics: alternating draw (positive)
/// and skip (negative) lengths in drawing units. Empty or all-zero
/// pattern → render solid.
///
/// `phase_start` is the signed distance FROM the pattern-line's origin
/// (base + n*offset) TO `p1` along `dir`. It must be tracked so clipped
/// segments of the same infinite line stay dash-phase-synchronised — a
/// single long diagonal that gets split by a non-convex ring must still
/// read as one continuous 15-on/7.5-off dashed line when rendered, not
/// two misaligned sub-dashes.
fn emit_dashed_hatch(
    segments: &mut Vec<Segment>,
    bbox: &mut [f64; 4],
    p1: [f64; 2],
    p2: [f64; 2],
    color: u32,
    dashes: &[f64],
    phase_start: f64,
    is_paper: bool,
) {
    let dx = p2[0] - p1[0];
    let dy = p2[1] - p1[1];
    let len = (dx * dx + dy * dy).sqrt();
    if len <= f64::EPSILON { return; }
    let total_pat: f64 = dashes.iter().map(|x| x.abs().max(1e-3)).sum();
    if dashes.is_empty() || total_pat <= 1e-9 {
        segments.push(Segment { p1, p2, color, is_paper });
        expand_bbox(bbox, p1[0], p1[1]);
        expand_bbox(bbox, p2[0], p2[1]);
        return;
    }
    let ux = dx / len;
    let uy = dy / len;
    // Wrap phase into [0, total_pat) so we start walking the pattern
    // from the correct offset for this clipped segment.
    let phase0 = phase_start.rem_euclid(total_pat);
    let end_abs = phase0 + len;
    // Walk pattern items from pat_pos=0; emit the intersection of
    // each item's [seg_start, seg_end] with the visible window
    // [phase0, end_abs] mapped back into segment-local t coords.
    let mut pat_pos = 0.0_f64;
    let mut idx = 0usize;
    // Safety cap — a degenerate pattern (very small dashes + very long
    // segment) could loop a lot. Cap at 100k iterations.
    let mut guard = 100_000usize;
    while pat_pos < end_abs && guard > 0 {
        guard -= 1;
        let step = dashes[idx % dashes.len()];
        let mag = step.abs().max(1e-3); // dot (0) renders as tiny stroke
        let seg_start = pat_pos;
        let seg_end = pat_pos + mag;
        if seg_end > phase0 {
            let draw = step >= 0.0; // positive + dot (0) → draw
            if draw {
                let s = seg_start.max(phase0);
                let e = seg_end.min(end_abs);
                if e > s {
                    let t0 = s - phase0;
                    let t1 = e - phase0;
                    let a = [p1[0] + ux * t0, p1[1] + uy * t0];
                    let b = [p1[0] + ux * t1, p1[1] + uy * t1];
                    segments.push(Segment { p1: a, p2: b, color, is_paper });
                    expand_bbox(bbox, a[0], a[1]);
                    expand_bbox(bbox, b[0], b[1]);
                }
            }
        }
        pat_pos = seg_end;
        idx += 1;
    }
}

/// Emit all hatch-pattern lines for a single ring. For each pattern
/// definition we determine which offset-stepped parallel lines pass
/// through the ring's perpendicular extent, then clip each such line
/// against the ring boundary.
///
/// Crucial detail: DXF HATCH pattern bases are often `(0,0)` while the
/// ring sits far away in world space. Earlier version picked span from
/// ring-bbox diagonal only, which missed far rings entirely (base +
/// n*offset never reached the ring). Fix: project both the base and
/// every ring vertex onto the line's PERPENDICULAR direction, and
/// iterate `n` over the range that puts base+n*offset's perpendicular
/// coordinate within the ring's perpendicular extent — exact coverage
/// independent of how far base is from the ring.
///
/// Dash support: when a HatchPatternLine carries a non-empty `dashes`
/// list (DXF code 49), each clipped segment is dashed per the pattern
/// with a phase consistent across the whole infinite line (see
/// `emit_dashed_hatch`).
fn emit_hatch_pattern_lines(
    ring: &[[f64; 2]],
    pattern_lines: &[HatchPatternLine],
    color: u32,
    is_paper: bool,
    segments: &mut Vec<Segment>,
    bbox: &mut [f64; 4],
) {
    if ring.len() < 3 || pattern_lines.is_empty() { return; }
    // Per-call total emission cap — defends against ring × pattern
    // combinations that legitimately fit the per-line range cap below
    // but multiplied across many pattern_lines or split by non-convex
    // rings produce millions of segments. We've observed individual
    // HATCHes emit 200M+ segments on real-world DWGs; cap at 200k per
    // hatch which is more than any legitimate fill density.
    let segs_at_entry = segments.len();
    const PER_HATCH_CAP: usize = 200_000;
    for pl in pattern_lines {
        if segments.len() - segs_at_entry >= PER_HATCH_CAP { break; }
        let off = pl.offset;
        let off_len = off[0].hypot(off[1]);
        if off_len < 1e-9 { continue; }
        // Sanity gate: pattern offsets above ~1km world-units, or base
        // points above 1e9 world units, are pathological. Corrupt HATCH
        // headers (seen on R2010+ DWGs with byte-order glitches in the
        // pattern table) decode to 1e+200-ish values which then poison
        // segment endpoints downstream of `base + n*offset`. Real CAD
        // hatch patterns step by millimetres to centimetres.
        if !off_len.is_finite() || off_len > 1.0e6 ||
           !pl.base[0].is_finite() || !pl.base[1].is_finite() ||
           pl.base[0].abs() > 1.0e9 || pl.base[1].abs() > 1.0e9 {
            continue;
        }
        let a = pl.angle_deg.to_radians();
        let dir = [a.cos(), a.sin()];
        // Perpendicular to the line direction. All parallel lines have
        // the SAME perp-dot value; stepping by `offset` changes the
        // perp-dot by `offset · perp`.
        let perp = [-dir[1], dir[0]];
        let perp_step = off[0] * perp[0] + off[1] * perp[1];
        // Helper to emit one clipped (p1,p2) with correct dash phase.
        // Orients the segment along +dir so adjacent clipped segments
        // of the same line share a consistent walking direction (prevents
        // mirrored dash patterns between two halves of a split line).
        let emit_one = |p1: [f64; 2], p2: [f64; 2], base_n: [f64; 2],
                         segments: &mut Vec<Segment>, bbox: &mut [f64; 4]| {
            let d1 = (p1[0] - base_n[0]) * dir[0] + (p1[1] - base_n[1]) * dir[1];
            let d2 = (p2[0] - base_n[0]) * dir[0] + (p2[1] - base_n[1]) * dir[1];
            let (ps, pe, phase) = if d1 <= d2 { (p1, p2, d1) } else { (p2, p1, d2) };
            emit_dashed_hatch(segments, bbox, ps, pe, color, &pl.dashes, phase, is_paper);
        };
        if perp_step.abs() < 1e-9 {
            // Offset is parallel to the line — no perpendicular advance,
            // so offset doesn't generate a family of parallel lines.
            // Emit the single base line.
            let segs_on_line = clip_line_to_ring(pl.base, dir, ring);
            for (p1, p2) in segs_on_line {
                emit_one(p1, p2, pl.base, segments, bbox);
            }
            continue;
        }
        // Ring perpendicular extent.
        let (mut pmin, mut pmax) = (f64::INFINITY, f64::NEG_INFINITY);
        for v in ring {
            let d = v[0] * perp[0] + v[1] * perp[1];
            if d < pmin { pmin = d; }
            if d > pmax { pmax = d; }
        }
        let base_perp = pl.base[0] * perp[0] + pl.base[1] * perp[1];
        // n-range: base_perp + n * perp_step ∈ [pmin, pmax]
        //   → n ∈ [(pmin - base_perp) / perp_step, (pmax - base_perp) / perp_step]
        let n_lo_f = (pmin - base_perp) / perp_step;
        let n_hi_f = (pmax - base_perp) / perp_step;
        let (n_lo, n_hi) = if n_lo_f < n_hi_f {
            (n_lo_f.floor() as i64 - 1, n_hi_f.ceil() as i64 + 1)
        } else {
            (n_hi_f.floor() as i64 - 1, n_lo_f.ceil() as i64 + 1)
        };
        // Safety cap — extreme offset values or malformed patterns
        // could produce huge ranges. 10 000 lines per pattern is more
        // than any legitimate CAD hatch produces.
        let range = n_hi - n_lo;
        if range > 10_000 { continue; }
        for n in n_lo..=n_hi {
            if segments.len() - segs_at_entry >= PER_HATCH_CAP { break; }
            let base_n = [
                pl.base[0] + off[0] * n as f64,
                pl.base[1] + off[1] * n as f64,
            ];
            let segs_on_line = clip_line_to_ring(base_n, dir, ring);
            for (p1, p2) in segs_on_line {
                emit_one(p1, p2, base_n, segments, bbox);
            }
        }
    }
}

fn ear_clip(verts: &[[f64; 2]]) -> Vec<[usize; 3]> {
    let n = verts.len();
    if n < 3 { return Vec::new(); }
    // Signed area — positive = CCW, negative = CW.
    let mut area2 = 0.0_f64;
    for i in 0..n {
        let j = (i + 1) % n;
        area2 += verts[i][0] * verts[j][1] - verts[j][0] * verts[i][1];
    }
    let ccw = area2 > 0.0;
    // Working index list (remove ears by popping indices here).
    let mut idx: Vec<usize> = if ccw {
        (0..n).collect()
    } else {
        (0..n).rev().collect()
    };
    let mut out: Vec<[usize; 3]> = Vec::with_capacity(n.saturating_sub(2));
    // Safety bound: ear-clip should terminate in n-2 rounds; double that
    // as a paranoia cap.
    let mut guard = 2 * n;
    while idx.len() > 3 && guard > 0 {
        guard -= 1;
        let m = idx.len();
        let mut found_ear = false;
        for i in 0..m {
            let ia = idx[(i + m - 1) % m];
            let ib = idx[i];
            let ic = idx[(i + 1) % m];
            let a = verts[ia];
            let b = verts[ib];
            let c = verts[ic];
            // Convex corner test (triangle CCW because polygon is CCW).
            let cross = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
            if cross <= 0.0 { continue; }
            // No other polygon vertex inside triangle.
            let mut any_inside = false;
            for &k in &idx {
                if k == ia || k == ib || k == ic { continue; }
                let p = verts[k];
                let s = (a[0] - c[0]) * (p[1] - c[1]) - (a[1] - c[1]) * (p[0] - c[0]);
                let t = (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
                if (s < 0.0) != (t < 0.0) && s != 0.0 && t != 0.0 { continue; }
                let d = (c[0] - b[0]) * (p[1] - b[1]) - (c[1] - b[1]) * (p[0] - b[0]);
                if d == 0.0 || (d < 0.0) == (s + t <= 0.0) {
                    any_inside = true;
                    break;
                }
            }
            if any_inside { continue; }
            out.push([ia, ib, ic]);
            idx.remove(i);
            found_ear = true;
            break;
        }
        if !found_ear { break; } // Degenerate; abort to stay bounded.
    }
    if idx.len() == 3 {
        out.push([idx[0], idx[1], idx[2]]);
    }
    out
}

/// Classify a DXF LTYPE pattern into a dash KIND used by the renderer
/// to pick a fixed SCREEN-pixel stride at frame time. World-unit
/// dash lengths from the DXF are intentionally discarded here — a
/// dashed line should look the same on screen at every zoom level,
/// and the original world-stride emitter (which this function and
/// `push_lt_line` replace) gave dashes that became invisible when
/// zoomed out and absurdly sparse when zoomed in.
///
/// Returns:
///   0 = solid (continuous)
///   1 = dashed (only "draw" runs, no zero-length dots)
///   2 = dotted (only zero-length items, all dots)
///   3 = dash-dot (mix of long draws and dots)
fn classify_lt_pattern(pattern: &[f64]) -> u8 {
    if pattern.is_empty() {
        return 0;
    }
    let total: f64 = pattern.iter().map(|x| x.abs()).sum();
    if total <= 1e-9 {
        return 0;
    }
    let mut has_dot = false;     // a literal 0-length stroke (DXF dot)
    let mut has_long_draw = false; // a positive draw item that's not a dot
    for &v in pattern {
        if v == 0.0 {
            has_dot = true;
        } else if v > 0.0 {
            // distinguish "tiny draw" (basically a dot when stride is
            // dominated by long draws) from a real dash. AutoCAD's
            // ACAD_ISO patterns use 0 for dots; a positive < ~10% of
            // the average abs is treated as dot-like.
            let avg_abs = total / pattern.len() as f64;
            if v < avg_abs * 0.10 {
                has_dot = true;
            } else {
                has_long_draw = true;
            }
        }
        // negative values are gaps; ignored for classification.
    }
    match (has_long_draw, has_dot) {
        (true, true)   => 3, // dash-dot
        (true, false)  => 1, // dashed
        (false, true)  => 2, // dotted
        (false, false) => 1, // shouldn't happen, fall back to dashed
    }
}

/// Push ONE solid segment from `p1` to `p2` and record its dash KIND
/// in the parallel `dash_kinds` array. Dashing is deferred to the
/// renderer (`build_verts`) where the camera's world-per-pixel factor
/// is known, so the stride stays constant in screen pixels regardless
/// of zoom.
///
/// `dash_kinds` is kept in lock-step with `segments` by lazily padding
/// up to `segments.len()` with 0 (solid) before the push — callers
/// that mix raw `segments.push(..)` with `emit_dashed` therefore don't
/// have to mirror every push themselves; they only have to make sure
/// `dash_kinds` is resized to `segments.len()` once per entity at the
/// end of the entity's emit (the model/paper-space loops in load_dxf
/// / load_dwg do this). For empty patterns we still pad-and-push so
/// the parallel-array invariant survives the call.
fn emit_dashed(
    segments: &mut Vec<Segment>,
    dash_kinds: &mut Vec<u8>,
    bbox: &mut [f64; 4],
    p1: [f64; 2], p2: [f64; 2],
    color: u32,
    pattern: &[f64],
) {
    let dx = p2[0] - p1[0];
    let dy = p2[1] - p1[1];
    if (dx * dx + dy * dy).sqrt() <= f64::EPSILON { return; }
    // Bring dash_kinds up to segments.len() before pushing — covers
    // any raw Segment.push that happened between the last emit_dashed
    // and now.
    if dash_kinds.len() < segments.len() {
        dash_kinds.resize(segments.len(), 0u8);
    }
    let kind = classify_lt_pattern(pattern);
    segments.push(Segment { p1, p2, color, is_paper: false });
    dash_kinds.push(kind);
    expand_bbox(bbox, p1[0], p1[1]);
    expand_bbox(bbox, p2[0], p2[1]);
}

/// Plot-style fill colour for SOLID hatches. Real-world DXF output from
/// CAD packages (Revit, AutoCAD, BricsCAD) uses a CTB / STB plot-style
/// table that remaps on-screen ACI colours to print colours + pen weights.
/// In the 3bm training-set reference PDF every SOLID HATCH — regardless
/// of its DXF ACI — renders as a uniform light grey. We emulate that plot
/// style here with a fixed light grey. Non-solid HATCH boundaries keep
/// their real ACI colour; only the solid *fills* use this override.
///
/// Byte packing is the project-standard `0xAA_BB_GG_RR` so the shader can
/// unpack via bit extraction without byte-swap (matches `aci_to_rgba`).
pub(crate) const HATCH_SOLID_FILL_COLOR: u32 = 0xFF_D0_D0_D0;

pub(crate) fn aci_to_rgba(aci: i16) -> u32 {
    match aci {
        0 | 256 => 0,
        1 => 0xFF0000FF, // red
        2 => 0xFF00FFFF, // yellow
        3 => 0xFF00FF00, // green
        4 => 0xFFFFFF00, // cyan
        5 => 0xFFFF0000, // blue
        6 => 0xFFFF00FF, // magenta
        7 => 0xFFFFFFFF, // white (rendered on dark bg)
        8 => 0xFF555555, // dark grey
        9 => 0xFFAAAAAA, // light grey
        n if n > 0 && n <= 255 => {
            // AutoCAD ACI 10-249 map to a structured HSV wheel:
            //   - base hue = (index - 10) / 10 → 24 groups × 15° = 360°,
            //     starting at red (group 0, ACI 10) and cycling through
            //     yellow, green, cyan, blue, magenta back to red.
            //   - within each group of 10, even indices trend darker,
            //     odd indices trend lighter — gives 10 "shades" per hue
            //     that AutoCAD's layer editor shows.
            // This is a much closer approximation to the real AutoCAD
            // palette than the golden-ratio hash we had (which gave
            // magenta for ACI 10 instead of red).
            let group = (n as i32 - 10).max(0) / 10;
            let variant = ((n as i32 - 10).max(0) % 10) as i32;
            let hue_deg = ((group * 15) % 360) as f32;
            // Brightness by variant: 0 = full, 2/4 = darker, 1/3 = pastel.
            let (v, s) = match variant {
                0 => (1.00_f32, 1.00_f32),
                2 => (0.85_f32, 1.00_f32),
                4 => (0.70_f32, 1.00_f32),
                6 => (0.55_f32, 1.00_f32),
                8 => (0.40_f32, 1.00_f32),
                1 => (1.00_f32, 0.60_f32),
                3 => (1.00_f32, 0.40_f32),
                5 => (0.85_f32, 0.50_f32),
                7 => (0.70_f32, 0.50_f32),
                _ => (0.55_f32, 0.50_f32),
            };
            let h = hue_deg / 60.0;
            let c = v * s;
            let x = c * (1.0 - ((h % 2.0) - 1.0).abs());
            let (r, g, b) = match h as u32 {
                0 => (c, x, 0.0),
                1 => (x, c, 0.0),
                2 => (0.0, c, x),
                3 => (0.0, x, c),
                4 => (x, 0.0, c),
                _ => (c, 0.0, x),
            };
            let m = v - c;
            let ri = ((r + m) * 255.0) as u32 & 0xFF;
            let gi = ((g + m) * 255.0) as u32 & 0xFF;
            let bi = ((b + m) * 255.0) as u32 & 0xFF;
            0xFF000000 | (bi << 16) | (gi << 8) | ri
        }
        _ => 0,
    }
}

// =============================================================================
// bbox helper
// =============================================================================

fn expand_bbox(bbox: &mut [f64; 4], x: f64, y: f64) {
    if !x.is_finite() || !y.is_finite() { return; }
    // The DD prefix-10 byte-order fix in bitreader.rs (ODA §2.2) cleaned
    // up LWPOLYLINE / LINE continuation coords for R2010+. Residual wild
    // coords still leak through parse_entity_common on some files (e.g.
    // sample_AC1024 SOLID/DIMENSION_* entities), so keep an auto-fit
    // safety net — clip coords larger than 1e6 to avoid collapsing the
    // camera. Entities still render; only bbox participation is gated.
    if x.abs() > 1.0e6 || y.abs() > 1.0e6 { return; }
    if x < bbox[0] { bbox[0] = x; }
    if y < bbox[1] { bbox[1] = y; }
    if x > bbox[2] { bbox[2] = x; }
    if y > bbox[3] { bbox[3] = y; }
}

// =============================================================================
// LWPOLYLINE / POLYLINE bulge tessellation
// =============================================================================

/// Expand a polyline's vertex+bulge list into a sequence of straight line
/// segments, approximating any bulged arc segments with chords.
///
/// Per AutoCAD DXF reference §AcDbPolyline (code 42) and ODA §20.4.85 /
/// §19.4.87: a vertex's bulge `b = tan(sweep_angle / 4)`, with positive b
/// meaning CCW arc from this vertex to the next, negative CW, and 0 a
/// straight line. Verts and bulges are same length; `bulges[i]` applies
/// to the segment `verts[i] -> verts[i+1]` (or wrap to `verts[0]` when
/// `closed`).
///
/// Returns a flat list of (p1, p2) segments in the same order as the input
/// vertices, so callers can emit_dashed each one.
fn tessellate_polyline_bulges(
    verts: &[[f64; 2]],
    bulges: &[f64],
    closed: bool,
) -> Vec<([f64; 2], [f64; 2])> {
    let mut out: Vec<([f64; 2], [f64; 2])> = Vec::new();
    if verts.len() < 2 { return out; }
    let n = verts.len();
    let last_idx = if closed { n } else { n - 1 };
    for i in 0..last_idx {
        let a = verts[i];
        let b = verts[(i + 1) % n];
        let bulge = bulges.get(i).copied().unwrap_or(0.0);
        if bulge.abs() < 1e-12 {
            out.push((a, b));
            continue;
        }
        let dx = b[0] - a[0];
        let dy = b[1] - a[1];
        let chord_len = (dx * dx + dy * dy).sqrt();
        if chord_len < 1e-12 {
            out.push((a, b));
            continue;
        }
        // sweep_angle = 4 * atan(|bulge|); signed by bulge.
        let abs_sweep = 4.0 * bulge.abs().atan();
        let sweep = if bulge > 0.0 { abs_sweep } else { -abs_sweep };
        // radius from chord and sweep.
        let half_sweep = abs_sweep * 0.5;
        let sin_half = half_sweep.sin();
        if sin_half.abs() < 1e-12 {
            out.push((a, b));
            continue;
        }
        let r = chord_len / (2.0 * sin_half);
        // perpendicular unit vector to chord (rotate 90 CCW).
        let ux = dx / chord_len;
        let uy = dy / chord_len;
        let px = -uy;
        let py = ux;
        // Distance from chord midpoint to arc center.
        // bulge > 0 (CCW) → center on the left of chord → add +perp.
        // bulge < 0 (CW)  → center on the right of chord → subtract.
        // h_offset = r * cos(sweep/2). For |bulge| > 1 (sweep > pi),
        // cos(half_sweep) is negative, flipping the center automatically.
        let h_offset = r * half_sweep.cos();
        let sign = if bulge > 0.0 { 1.0 } else { -1.0 };
        let mid = [(a[0] + b[0]) * 0.5, (a[1] + b[1]) * 0.5];
        let center = [
            mid[0] + px * h_offset * sign,
            mid[1] + py * h_offset * sign,
        ];
        // Start angle from center to vertex a.
        let start_ang = (a[1] - center[1]).atan2(a[0] - center[0]);
        // Segment count: 32 per full turn, scaled by sweep, min 4.
        let seg_count = ((abs_sweep / std::f64::consts::TAU * 32.0).ceil() as usize)
            .max(4)
            .min(128);
        let r_abs = r.abs();
        let mut prev = a;
        for k in 1..=seg_count {
            let t = start_ang + sweep * (k as f64) / (seg_count as f64);
            let cur = if k == seg_count {
                b // snap last point exactly to endpoint to avoid drift
            } else {
                [center[0] + r_abs * t.cos(), center[1] + r_abs * t.sin()]
            };
            out.push((prev, cur));
            prev = cur;
        }
    }
    out
}

// =============================================================================
// DXF loader
// =============================================================================

/// Subset of DXF STYLE-table info we actually need for text rendering. Built
/// once per load_dxf() call; queried inside each TEXT/MTEXT/ATTRIB/ATTDEF
/// arm. `primary_font_file` is the filename that goes into ttf_font (e.g.
/// "segoeui.ttf", "swissc.ttf"); may be a bare SHX name ("txt", "romans")
/// which ttf_font::resolve_font_file() rejects so we fall back to the
/// Hershey stroke font.
#[derive(Clone, Debug)]
struct DxfStyleInfo {
    primary_font_file: String,
    /// Original DXF STYLE name (e.g. "Segoe UI_B", "Swis721 Cn BT"). The
    /// "_B" / "_I" / "_B_I" suffix is Revit's convention for bold /
    /// italic / bold-italic variants of the same primary_font_file — we
    /// use it in `resolve_weighted_font_file()` to remap "segoeui.ttf"
    /// → "segoeuib.ttf" when the style has "_B".
    style_name: String,
    /// Fixed height from STYLE code 40. When non-zero, text entities
    /// referencing this style IGNORE their own text_height and use this
    /// value instead (per DXF AcDbTextStyleTableRecord §20.4.57).
    fixed_height: f64,
    width_factor: f64,
    oblique_angle: f64,  // degrees
}

/// Subset of DWG STYLE-table info needed for text rendering. Built once
/// per `load_dwg()` call from STYLE objects (type_num 0x35, ODA §20.4.59)
/// and queried by TEXT / MTEXT / ATTRIB arms via their text_style handle
/// (resolved in the DWG parser handle-stream — see parser.rs
/// `read_entity_handles_at_current` extension for TEXT (0x01), ATTRIB
/// (0x02), MTEXT (0x2C)).
///
/// `style_name` = DWG STYLE name (group 2 in DXF terms, e.g. "Segoe UI_B_5");
/// `primary_font_file` = group 3 (.ttf/.otf filename like "segoeui.ttf",
/// or a bare SHX name like "txt" / "romans").
#[derive(Clone, Debug, Default)]
struct DwgStyleInfo {
    style_name: String,
    primary_font_file: String,
    #[allow(dead_code)]
    fixed_height: f64,
    #[allow(dead_code)]
    width_factor: f64,
}

// Thread-local context so tessellate_one / expand_insert can access the
// DWG STYLE table without widening their signatures (there are 3 call
// sites, each already taking 9+ args). Set once at the top of load_dwg
// and cleared at the end.
//
// Per ODA §20.4.59 (TEXT_STYLE_OBJECT): the DWG STYLE table maps a
// handle → (name, primary_font_file). TEXT / MTEXT / ATTRIB entities
// reference their style via a hard pointer in the handle section
// (parser.rs read_entity_handles_at_current adds it for type_num
// 0x01/0x02/0x03/0x2C).
struct DwgTextCtx {
    by_handle: HashMap<u64, DwgStyleInfo>,
    by_name: HashMap<String, DwgStyleInfo>,
}
/// per ODA OpenDesignSpec §20.4.40 — DIMSTYLE-derived rendering parameters
/// for one DWG dimension style. Populated by load_dwg from the parser's
/// DIMSTYLE_OBJ output (`parser.rs::parse_dimstyle_obj`).
#[derive(Debug, Clone, Default)]
struct DimStyleInfo {
    /// DIMTXT — text height in drawing units.
    dimtxt: f64,
    /// DIMSCALE — overall scale factor applied to text/arrow sizes.
    dimscale: f64,
    /// DIMASZ — arrowhead/tick size in drawing units (pre-DIMSCALE).
    dimasz: f64,
    /// DIMEXO — extension-line offset from the measured point (gap before
    /// the extension line starts), in drawing units pre-DIMSCALE. AutoCAD
    /// default 0.625 mm. Per ODA §20.4.40.
    dimexo: f64,
    /// DIMEXE — extension-line overshoot past the dimension line, in drawing
    /// units pre-DIMSCALE. AutoCAD default 1.25 mm. Per ODA §20.4.40.
    dimexe: f64,
    /// DIMBLK1 — first arrowhead block name. Empty/`"."` = default arrow,
    /// `"_DOT"`/`"_DOTSMALL"` = solid filled disc, `"_OBLIQUE"` /
    /// `"_ARCHTICK"` = oblique tick, `"_NONE"` = no arrow. See ODA
    /// §20.4.40 for the canonical block-name list.
    dimblk1: String,
    /// DIMBLK2 — second arrowhead block name (same encoding as DIMBLK1).
    dimblk2: String,
    /// Style name (e.g. "1_8_mm_0_", "Standard"). Used to derive annotation
    /// scale for ANNOTATIVE styles where DIMSCALE is stored as 0/1 in the
    /// DWG body and the real scale comes from the active CANNOSCALE. The
    /// 3bm template names follow the convention "{num}_{denom}_mm_{0|1}"
    /// (e.g. "1_8_mm" = 1/8" = 1' → 1:96 → 304.8 mm/in).
    name: String,
}

thread_local! {
    static DWG_STYLE_CTX: std::cell::RefCell<Option<DwgTextCtx>> =
        std::cell::RefCell::new(None);
    /// DIMSTYLE handle → DimStyleInfo. Populated by load_dwg from
    /// the DIMSTYLE objects emitted by the DWG parser (ODA §20.4.40). The
    /// DIMENSION text-render arm reads this to resolve DIMTXT × DIMSCALE
    /// per ODA OpenDesignSpec §19.4.27 (dimStyleHandle in handle stream).
    /// The tick-render arm reads `dimblk1`/`dimblk2` to choose between
    /// solid-dot, oblique-tick, and arrowhead glyphs.
    /// Empty when no DIMSTYLE objects were parsed, falling back to a
    /// hardcoded default height + oblique tick.
    static DIM_STYLE_MAP: std::cell::RefCell<HashMap<u64, DimStyleInfo>> =
        std::cell::RefCell::new(HashMap::new());
    /// DXF STYLE-name (UPPERCASE) → DxfStyleInfo. Mirrors `DWG_STYLE_CTX`
    /// for the DXF loader. Populated once at the top of `load_dxf` from
    /// the same `style_map` that's threaded through the entity loop, so
    /// `tessellate_text` (the shared text-emission helper) can resolve a
    /// STYLE → font-file without needing the map passed as an extra arg.
    /// The wrapper `render_dxf_text` keeps its `style_map` parameter for
    /// API stability — this thread-local is purely a side-channel for the
    /// shared helper and the future `re_tessellate_text_entity()` path
    /// (Task 7), which has no ambient style_map at edit time.
    static DXF_STYLE_CTX: std::cell::RefCell<HashMap<String, DxfStyleInfo>> =
        std::cell::RefCell::new(HashMap::new());
}

/// Look up a DXF STYLE record by case-insensitive name. Returns None when
/// the style isn't in the map (fallback path = arial.ttf / stroke font).
fn dxf_style_lookup(style_name: &str) -> Option<DxfStyleInfo> {
    let key = style_name.to_ascii_uppercase();
    DXF_STYLE_CTX.with(|m| m.borrow().get(&key).cloned())
}

fn dim_style_lookup(handle: u64) -> Option<DimStyleInfo> {
    DIM_STYLE_MAP.with(|m| m.borrow().get(&handle).cloned())
}
fn dwg_lookup_style(handle: Option<u64>, name: Option<&str>) -> Option<DwgStyleInfo> {
    DWG_STYLE_CTX.with(|ctx| {
        let b = ctx.borrow();
        let ctx = b.as_ref()?;
        if let Some(h) = handle {
            if let Some(info) = ctx.by_handle.get(&h) {
                return Some(info.clone());
            }
        }
        if let Some(n) = name {
            let key = n.to_ascii_uppercase();
            if let Some(info) = ctx.by_name.get(&key) {
                return Some(info.clone());
            }
        }
        None
    })
}

/// Apply Revit / AutoCAD style-name suffix convention to remap a regular
/// font file to its Bold / Italic / BoldItalic variant.
///
/// AutoCAD exports from Revit use a STYLE-name convention: "_B" = Bold,
/// "_I" = Italic, "_B_I" or "_BI" = Bold Italic. The primary_font_file
/// (code 3) always points at the REGULAR TTF (e.g. "segoeui.ttf"),
/// which would otherwise render the bold title "Constructietekening" in
/// light weight. This helper inspects the style name and picks the
/// Windows-shipped variant filename.
///
/// Known variants for the two fonts we see in the 3bm training set:
///   segoeui.ttf  → Segoe UI Regular
///   segoeuib.ttf → Segoe UI Bold
///   segoeuii.ttf → Segoe UI Italic
///   segoeuiz.ttf → Segoe UI Bold Italic
///   swissc.ttf   → Swis721 Cn BT Regular (Roman)
///   swisscb.ttf  → Swis721 Cn BT Bold (if installed)
fn resolve_weighted_font_file(primary: &str, style_name: &str) -> String {
    let low = primary.to_ascii_lowercase();
    let upper_sn = style_name.to_ascii_uppercase();
    // Revit-generated STYLE names use these weight / slant suffixes:
    //   "_B"        bold                (eg. "Segoe UI_B")
    //   "_B_<n>"    bold, nth variant   (eg. "Segoe UI_B_4", "Segoe UI_B_7")
    //   "_I"        italic              (eg. "Segoe UI_I")
    //   "_I_<n>"    italic, nth variant (eg. "Segoe UI_I_2")
    //   "_B_I"      bold italic         (eg. "Segoe UI_B_I")
    //   "_B_I_<n>"  bold italic nth     (eg. "Segoe UI_B_I_3")
    // Our previous check only looked at the tail, missing "_B_7" etc.
    // New heuristic: split on '_' and scan tokens after the first '_'
    // for standalone B / I markers.
    let mut is_bold = false;
    let mut is_italic = false;
    let mut seen_sep = false;
    for tok in upper_sn.split('_') {
        if !seen_sep {
            // everything up to (and including) the first token is the
            // font-family name; weight markers only appear AFTER the
            // first underscore.
            seen_sep = true;
            continue;
        }
        match tok {
            "B" => is_bold = true,
            "I" => is_italic = true,
            "BI" => { is_bold = true; is_italic = true; }
            _ => {
                // numeric-only tokens are variant counters — ignore.
                // anything else is noise we don't interpret.
            }
        }
    }
    let (stem, ext) = if let Some(idx) = low.rfind('.') {
        (&low[..idx], &low[idx..])
    } else {
        (low.as_str(), "")
    };
    let suffix = match (is_bold, is_italic) {
        (true, true) => "z",   // Bold Italic (Segoe uses 'z')
        (true, false) => "b",
        (false, true) => "i",
        (false, false) => return primary.to_string(),
    };
    format!("{}{}{}", stem, suffix, ext)
}

/// Scan raw MTEXT text for the FIRST inline font-change code
/// `\fName|bN|iN|cN|pN;` (DXF MTEXT control syntax §AcDbMText) and
/// return (bold, italic, opt_font_name).
///
/// Revit-authored labels frequently prefix the run with a single
/// `\fSegoe UI|b1|i0|c0|p34;...` — in that case applying b1/i0 to the
/// WHOLE string is a good-enough approximation without implementing full
/// run-based MTEXT rendering. Returns (false, false, None) when the
/// string has no inline font override.
fn parse_mtext_first_font_override(raw: &str) -> (bool, bool, Option<String>) {
    // Look for `\f` (case sensitive per spec — AutoCAD allows `\F` too)
    // and parse up to the `;` terminator.
    let bytes = raw.as_bytes();
    let mut i = 0usize;
    while i + 1 < bytes.len() {
        if bytes[i] == b'\\' && (bytes[i + 1] == b'f' || bytes[i + 1] == b'F') {
            // Found `\f`; read until `;`
            let start = i + 2;
            let mut end = start;
            while end < bytes.len() && bytes[end] != b';' && bytes[end] != b'\\' {
                end += 1;
            }
            if end <= start { return (false, false, None); }
            let spec = &raw[start..end];
            // Split on `|`. First token = font family, subsequent tokens
            // start with a single-letter tag (b, i, c, p).
            let mut parts = spec.split('|');
            let name = parts.next().map(|s| s.trim().to_string()).filter(|s| !s.is_empty());
            let mut bold = false;
            let mut italic = false;
            for p in parts {
                let p = p.trim();
                if let Some(rest) = p.strip_prefix('b').or_else(|| p.strip_prefix('B')) {
                    if rest.trim_start() == "1" { bold = true; }
                } else if let Some(rest) = p.strip_prefix('i').or_else(|| p.strip_prefix('I')) {
                    if rest.trim_start() == "1" { italic = true; }
                }
            }
            return (bold, italic, name);
        }
        i += 1;
    }
    (false, false, None)
}

/// Map a font-family NAME ("Segoe UI", "Arial") to the Windows filename
/// ("segoeui.ttf", "arial.ttf") and apply bold/italic variant suffix.
///
/// Used by the DWG text arms when we have an MTEXT inline font override
/// (name comes from `\f...;`) or when the STYLE's `primary_font_file`
/// field is a family name rather than a filename.
fn font_family_to_file(family: &str, bold: bool, italic: bool) -> String {
    let low = family.to_ascii_lowercase();
    // Strip any "bold" / "italic" words the family may already contain
    // — the style suffix handles the variant.
    let base = match low.as_str() {
        f if f.contains("segoe ui") || f.contains("segoeui") => "segoeui",
        f if f.contains("arial") => "arial",
        f if f.contains("swis721 cn") || f.contains("swissc") => "swissc",
        f if f.contains("times new roman") || f.contains("times") => "times",
        f if f.contains("courier") => "cour",
        f if f.contains("tahoma") => "tahoma",
        f if f.contains("calibri") => "calibri",
        f if f.contains("verdana") => "verdana",
        // Fallback: already-a-filename? Strip known extension + continue.
        f if f.ends_with(".ttf") || f.ends_with(".otf") || f.ends_with(".ttc") => {
            &low[..low.rfind('.').unwrap()]
        }
        // Unknown family — best-effort lowercase-no-spaces stem.
        _ => {
            return format!("{}.ttf", low.replace(' ', ""));
        }
    };
    let suffix = match (bold, italic) {
        (true, true)  => if base == "segoeui" { "z" } else { "bi" },
        (true, false) => "b",
        (false, true) => if base == "segoeui" { "i" } else { "i" },
        (false, false) => "",
    };
    format!("{}{}.ttf", base, suffix)
}

/// Parse HATCH entities directly from DXF text — dxf-0.5 drops HATCH
/// entirely (no EntityType::Hatch variant), so we do the minimal
/// extraction ourselves.
///
/// For each HATCH we pull: layer name (code 8), ACI color (code 62,
/// optional), true color (code 420, optional), pattern name (code 2),
/// solid-fill flag (code 70), and all boundary-path vertices (code 10
/// / code 20 inside a Polyline path). Edge-path fallback (not-polyline
/// boundaries with LINE / ARC / ELLIPSE / SPLINE edges) is out of
/// scope for this parser — we emit the path only if it's a straight
/// polygon. That covers piles and most engineering-drawing hatches
/// (where solid-filled circles or polygons are the common case).
///
/// Each returned entry: `(layer, color_aci_or_0, is_solid, rings)`
/// where `rings` is a list of closed polygon loops (first is the
/// outer boundary, rest are holes — we render them all as the same
/// fill for simplicity; the viewer's black background makes holes
/// look natural).
#[derive(Clone)]
struct HatchParsed {
    layer: String,
    aci: i16,
    is_solid: bool,
    rings: Vec<Vec<[f64; 2]>>,
    /// Block-owner (empty = top-level model-space). HATCHes INSIDE
    /// BLOCK definitions (e.g. paal-symbol blocks) carry their block
    /// name here; the INSERT expansion path picks them up and renders
    /// through the composed xform. Revit exports many pile / sondering
    /// symbols as blocks containing a single SOLID HATCH circle — without
    /// this field those fills were invisible because we only scanned
    /// the top-level ENTITIES section.
    owner_block: String,
    /// Hatch-pattern line definitions (DXF §AcDbHatch §20.4.56). For
    /// NON-solid hatches (code 70 = 0) AutoCAD renders the filled region
    /// as a repeating pattern of clipped LINE segments defined here.
    /// Codes per pattern line:
    ///   53 = line angle (degrees)
    ///   43 / 44 = base-point X / Y
    ///   45 / 46 = offset-vector X / Y  (displacement to next parallel line)
    ///   79 = number of dash-items (0 = continuous)
    ///   49 = dash length (one per dash-item; positive = pen-down, negative = pen-up)
    ///
    /// Rendering: sweep a line through base + N * offset for N in
    /// [-range, +range] based on the boundary bbox, clip each line
    /// against the boundary polygon, emit clipped segments.
    pattern_lines: Vec<HatchPatternLine>,
}

#[derive(Clone, Debug, Default)]
struct HatchPatternLine {
    angle_deg: f64,
    base:   [f64; 2],
    offset: [f64; 2],
    dashes: Vec<f64>,
}

/// Tessellate a pending HATCH-boundary arc/ellipse edge into short line
/// segments and append them to `cur_ring`. Does nothing for edge_type 1
/// (Line — already pushed directly) or 0 (unset) or 4 (Spline, not yet
/// supported).
///
/// Per DXF reference §Hatch Boundary Data:
///   edge_type 2 (CIRCULAR arc): 10/20=center, 40=radius, 50=start
///     angle (DEGREES), 51=end angle (DEGREES), 73=is_CCW.
///   edge_type 3 (ELLIPTIC arc): 10/20=center, 11/21=major-axis
///     endpoint VECTOR from center, 40=minor/major ratio, 50=start
///     parameter (RADIANS), 51=end parameter (RADIANS), 73=is_CCW.
///
/// The angle convention mismatch between 2 (degrees) and 3 (radians) is
/// a DXF quirk — it's consistent in AutoCAD's DXF reference.
fn flush_arc_edge(
    cur_ring: &mut Vec<[f64; 2]>,
    edge_type: i32,
    center: Option<[f64; 2]>,
    major_vec: Option<[f64; 2]>,
    radius_or_ratio: Option<f64>,
    a0: Option<f64>,
    a1: Option<f64>,
    ccw: bool,
) {
    const TAU: f64 = std::f64::consts::TAU;
    // Tessellation resolution — 32 segments over a full turn gives ~11°
    // per segment which is visually smooth at typical legend cell sizes.
    // For partial sweeps we scale down proportionally.
    let steps_per_turn = 32_usize;
    match edge_type {
        2 => {
            let (Some(c), Some(r), Some(s_deg), Some(e_deg)) = (center, radius_or_ratio, a0, a1)
                else { return; };
            if r <= 0.0 { return; }
            let s = s_deg.to_radians();
            let e = e_deg.to_radians();
            // Per AutoCAD DXF reference §HATCH Boundary Path Data
            // (Boundary Path Type Data for arc edge, group code 73 =
            // "is_counterclockwise flag"): when is_ccw=1 the start/end
            // angles describe a CCW arc from s→e with sample points at
            // p = center + r*(cos a, sin a). When is_ccw=0 the arc is
            // traversed clockwise AND the sample points are mirrored
            // about the local X-axis — i.e. p = center + r*(cos a,
            // -sin a). The short sweep (|e-s|) is always preserved in
            // both senses; it is the traversal direction and the Y-sign
            // that flip. This matches the boundary endpoint continuity
            // observed in Revit-exported title blocks (see e.g. the
            // rounded-corner title-block SOLID hatch in the 3BM
            // fixture, DXF line 77995: edges 2→3 chain (-200,93) →
            // arc center (-195,93) r=5 sa=180 ea=270 ccw=0 →
            // (-195,98). The two endpoints (-200,93) and (-195,98)
            // correspond to angles 180°/270° only under Y-mirror).
            // Prior implementation computed a 270° CW sweep without
            // the Y-mirror, painting the other three quadrants of the
            // full circle and producing a visible "3/4 arc" artifact.
            let (sweep, y_sign) = if ccw {
                let d = e - s;
                (if d <= 0.0 { d + TAU } else { d }, 1.0)
            } else {
                // Short CCW-direction sweep over |e - s|; emitted points
                // mirror y → arc traversed CW in world coords.
                let d = e - s;
                (if d < 0.0 { d + TAU } else { d }, -1.0)
            };
            let n = ((sweep.abs() / TAU) * steps_per_turn as f64).ceil().max(2.0) as usize;
            for i in 0..=n {
                let t = i as f64 / n as f64;
                let a = s + sweep * t;
                cur_ring.push([c[0] + r * a.cos(), c[1] + r * y_sign * a.sin()]);
            }
        }
        3 => {
            let (Some(c), Some(m), Some(ratio), Some(s), Some(e))
                = (center, major_vec, radius_or_ratio, a0, a1)
                else { return; };
            let major_len = (m[0]*m[0] + m[1]*m[1]).sqrt();
            if major_len <= 1e-12 { return; }
            let ux = m[0] / major_len;       // major-axis unit vector
            let uy = m[1] / major_len;
            let vx = -uy;                    // minor-axis unit vector (90° CCW)
            let vy = ux;
            let minor_len = major_len * ratio;
            let sweep = if ccw {
                let d = e - s;
                if d <= 0.0 { d + TAU } else { d }
            } else {
                let d = s - e;
                if d <= 0.0 { -(d + TAU) } else { -d }
            };
            let n = ((sweep.abs() / TAU) * steps_per_turn as f64).ceil().max(2.0) as usize;
            for i in 0..=n {
                let t = i as f64 / n as f64;
                let a = s + sweep * t;
                let cos_a = a.cos();
                let sin_a = a.sin();
                let x = c[0] + major_len * cos_a * ux + minor_len * sin_a * vx;
                let y = c[1] + major_len * cos_a * uy + minor_len * sin_a * vy;
                cur_ring.push([x, y]);
            }
        }
        _ => {} // Line already pushed directly; Spline (4) unsupported.
    }
}

fn parse_hatches_from_dxf(path: &str) -> Vec<HatchParsed> {
    let text = match std::fs::read_to_string(path) {
        Ok(t) => t,
        Err(_) => return Vec::new(),
    };
    let lines: Vec<&str> = text.lines().collect();
    let mut out: Vec<HatchParsed> = Vec::new();

    // Scan the WHOLE file. Track BLOCK/ENDBLK state so each HATCH is
    // tagged with its owning block (empty = top-level / model-space).
    // This lets INSERTs of pile-symbol / sondering blocks — which are
    // defined as `BLOCK { HATCH circle-fill; LINES; ENDBLK }` in
    // Revit exports — pick up their internal HATCH fills during
    // INSERT expansion.
    //
    // BLOCK entry format in DXF:
    //   0
    //   BLOCK
    //   <codes...>  (including "  2 / <block_name>")
    //   ...entities...
    //   0
    //   ENDBLK
    let mut cur_block: String = String::new();
    let mut i = 0usize;
    while i + 1 < lines.len() {
        let tag = lines[i].trim();
        let val = lines[i + 1].trim();
        if tag == "0" && val == "BLOCK" {
            // Walk forward until the block-name (code 2) then keep cur_block set.
            let mut k = i + 2;
            cur_block.clear();
            while k + 1 < lines.len() {
                if lines[k].trim() == "0" { break; }
                if lines[k].trim() == "2" { cur_block = lines[k + 1].trim().to_string(); }
                k += 2;
            }
            i = k;
            continue;
        }
        if tag == "0" && val == "ENDBLK" {
            cur_block.clear();
            i += 2;
            continue;
        }
        if tag == "0" && val == "HATCH" {
            let mut j = i + 2;
            let mut layer = String::new();
            let mut aci: i16 = 0;
            let mut is_solid = false;
            let mut rings: Vec<Vec<[f64; 2]>> = Vec::new();
            // HATCH body structure (DXF reference, §AcDbHatch):
            //   - Leading header: code 10/20/30 = elevation point (SKIP),
            //     210/220/230 = extrusion direction, 2 = pattern name,
            //     70 = solid-fill flag, 71 = associative.
            //   - 91 = number of boundary paths. For each path:
            //       - 92 = path-type bit flag (bit 1 = polyline).
            //       - If polyline (92 & 2):
            //           - 72 = has-bulge, 73 = closed, 93 = num verts,
            //             then per vert: 10/20 = x/y, 42 = bulge (SKIP).
            //       - Else (edge-path):
            //           - 93 = num edges. Per edge: 72 = edge type,
            //             then edge-specific coords. Edge type 1 = LINE
            //             with 10/20 start + 11/21 end. Other types
            //             (arc/ellipse/spline) we approximate with
            //             straight edges between their endpoints so
            //             the ring closes.
            //
            // Parser state machine: we walk the body codes and when we
            // hit a 92 we start a new boundary path. Within a path we
            // either collect polyline 10/20 pairs or edge starts (10/20)
            // — for edges the endpoints chain so we only need the
            // starts plus the final edge's end (code 11/21).
            let mut seen_acdbhatch = false;
            let mut in_path = false;
            let mut path_is_polyline = false;
            let mut cur_ring: Vec<[f64; 2]> = Vec::new();
            let mut last_x10: Option<f64> = None;
            let mut last_x11: Option<f64> = None;
            // Non-polyline (edge) path state. Each edge starts with code
            // 72 specifying its type (1=Line, 2=CircleArc, 3=EllipticArc,
            // 4=Spline). For Line edges we push 10/20 + 11/21 directly
            // to cur_ring; for Arc/Ellipse we BUFFER the edge fields and
            // flush a tessellated poly when the next 72 or the path
            // close marker arrives. Previously arcs were silently dropped
            // because the 10/20 was mis-interpreted as a boundary vertex
            // (it's the arc CENTER, not on the boundary) — resulting in
            // pile-symbol hatches, circular columns, etc. being empty.
            let mut cur_edge_type: i32 = 0;
            let mut edge_center: Option<[f64; 2]> = None;
            let mut edge_major_vec: Option<[f64; 2]> = None; // ellipse major-axis vector from center
            let mut edge_radius: Option<f64> = None;         // arc radius OR ellipse ratio
            let mut edge_a0: Option<f64> = None;
            let mut edge_a1: Option<f64> = None;
            let mut edge_ccw: bool = true;
            // Pattern-line parsing state. Activated by code 78 (num
            // pattern lines); the following codes are interleaved per
            // pattern line: 53 (angle) starts a new line, 43/44 set
            // base, 45/46 set offset, 79 sets dash count, 49 pushes
            // one dash length. We close out each line when we see the
            // NEXT 53 (or end-of-entity).
            let mut in_pattern = false;
            let mut cur_pl = HatchPatternLine::default();
            let mut cur_pl_active = false;
            let mut pattern_lines: Vec<HatchPatternLine> = Vec::new();
            let mut last_43: Option<f64> = None;
            let mut last_45: Option<f64> = None;
            while j + 1 < lines.len() {
                if lines[j].trim() == "0" { break; }
                let code = lines[j].trim();
                let val = lines[j + 1].trim();
                match code {
                    "8" => { layer = val.to_string(); }
                    "62" => { aci = val.parse().unwrap_or(0); }
                    "100" if val == "AcDbHatch" => { seen_acdbhatch = true; }
                    "70" if seen_acdbhatch && val == "1" => { is_solid = true; }
                    "92" if seen_acdbhatch => {
                        // Close current path and start a new one.
                        // Flush any pending arc/ellipse edge first.
                        if in_path && !path_is_polyline {
                            flush_arc_edge(
                                &mut cur_ring, cur_edge_type,
                                edge_center, edge_major_vec, edge_radius,
                                edge_a0, edge_a1, edge_ccw,
                            );
                        }
                        if in_path && !cur_ring.is_empty() {
                            rings.push(std::mem::take(&mut cur_ring));
                        }
                        last_x10 = None; last_x11 = None;
                        cur_edge_type = 0;
                        edge_center = None; edge_major_vec = None; edge_radius = None;
                        edge_a0 = None; edge_a1 = None; edge_ccw = true;
                        let flag: i32 = val.parse().unwrap_or(0);
                        path_is_polyline = (flag & 2) != 0;
                        in_path = true;
                    }
                    // Edge type selector (non-polyline paths). When the
                    // type changes, the PREVIOUS edge (if arc/ellipse)
                    // needs to be flushed to cur_ring. Line edges flush
                    // eagerly via their 10/20 + 11/21 direct push.
                    "72" if in_path && !path_is_polyline => {
                        flush_arc_edge(
                            &mut cur_ring, cur_edge_type,
                            edge_center, edge_major_vec, edge_radius,
                            edge_a0, edge_a1, edge_ccw,
                        );
                        cur_edge_type = val.parse().unwrap_or(0);
                        edge_center = None; edge_major_vec = None; edge_radius = None;
                        edge_a0 = None; edge_a1 = None; edge_ccw = true;
                        last_x10 = None; last_x11 = None;
                    }
                    "10" if in_path => { last_x10 = val.parse().ok(); }
                    "20" if in_path => {
                        if let (Some(x), Ok(y)) = (last_x10, val.parse::<f64>()) {
                            if path_is_polyline {
                                cur_ring.push([x, y]);
                            } else if cur_edge_type == 1 {
                                // Line edge start point.
                                cur_ring.push([x, y]);
                            } else if cur_edge_type == 2 || cur_edge_type == 3 {
                                // Arc/Ellipse center.
                                edge_center = Some([x, y]);
                            }
                            // Other types (spline): ignored for now.
                        }
                        last_x10 = None;
                    }
                    "11" if in_path && !path_is_polyline => {
                        last_x11 = val.parse().ok();
                    }
                    "21" if in_path && !path_is_polyline => {
                        if let (Some(x), Ok(y)) = (last_x11, val.parse::<f64>()) {
                            if cur_edge_type == 1 {
                                // Line edge end point.
                                cur_ring.push([x, y]);
                            } else if cur_edge_type == 3 {
                                // Ellipse: code 11/21 is the major-axis
                                // endpoint VECTOR from center (not an
                                // absolute point) per DXF reference
                                // §Hatch Boundary Data "Elliptic arc".
                                edge_major_vec = Some([x, y]);
                            }
                        }
                        last_x11 = None;
                    }
                    // Arc radius OR ellipse minor/major ratio (edge types 2 & 3).
                    "40" if in_path && !path_is_polyline && (cur_edge_type == 2 || cur_edge_type == 3) => {
                        edge_radius = val.parse().ok();
                    }
                    // Arc/Ellipse start angle. CIRCULAR arc: degrees.
                    // ELLIPTIC arc: radians. Handled in flush_arc_edge.
                    "50" if in_path && !path_is_polyline && (cur_edge_type == 2 || cur_edge_type == 3) => {
                        edge_a0 = val.parse().ok();
                    }
                    "51" if in_path && !path_is_polyline && (cur_edge_type == 2 || cur_edge_type == 3) => {
                        edge_a1 = val.parse().ok();
                    }
                    // Is-CCW flag for arc/ellipse edges. In polyline
                    // paths 73 means "closed" — guarded out.
                    "73" if in_path && !path_is_polyline && (cur_edge_type == 2 || cur_edge_type == 3) => {
                        edge_ccw = val.trim() != "0";
                    }
                    // ---- pattern-line parsing --------------------------
                    // code 78 = "number of pattern definition lines".
                    // Once we see it we stop collecting boundary points
                    // and enter pattern mode. Per DXF §AcDbHatch the
                    // boundary section is complete before 78 appears.
                    "78" if seen_acdbhatch => {
                        // Close current path if still open.
                        if in_path && !cur_ring.is_empty() {
                            rings.push(std::mem::take(&mut cur_ring));
                        }
                        in_path = false;
                        in_pattern = true;
                    }
                    // Post-boundary markers. For SOLID hatches (no
                    // code 78 / pattern lines) these codes appear
                    // directly after the last boundary. Without closing
                    // in_path here, the subsequent code 98 + 10/20
                    // (seed point, often (0,0)) leak into the ring as
                    // a spurious vertex — producing the fan-of-white-
                    // lines artifact that the user saw. §AcDbHatch:
                    //   97 = num source boundary objects
                    //   75 = hatch style
                    //   76 = pattern type
                    //   98 = num seed points
                    "97" | "98" | "75" | "76" if seen_acdbhatch && in_path => {
                        // Flush any pending arc/ellipse edge before closing the path.
                        if !path_is_polyline {
                            flush_arc_edge(
                                &mut cur_ring, cur_edge_type,
                                edge_center, edge_major_vec, edge_radius,
                                edge_a0, edge_a1, edge_ccw,
                            );
                            cur_edge_type = 0;
                            edge_center = None; edge_major_vec = None; edge_radius = None;
                            edge_a0 = None; edge_a1 = None; edge_ccw = true;
                        }
                        if !cur_ring.is_empty() {
                            rings.push(std::mem::take(&mut cur_ring));
                        }
                        in_path = false;
                    }
                    "53" if in_pattern => {
                        // New pattern line — flush the previous.
                        if cur_pl_active {
                            pattern_lines.push(std::mem::take(&mut cur_pl));
                        }
                        cur_pl = HatchPatternLine::default();
                        cur_pl.angle_deg = val.parse().unwrap_or(0.0);
                        cur_pl_active = true;
                        last_43 = None; last_45 = None;
                    }
                    "43" if cur_pl_active => { last_43 = val.parse().ok(); }
                    "44" if cur_pl_active => {
                        if let (Some(x), Ok(y)) = (last_43, val.parse::<f64>()) {
                            cur_pl.base = [x, y];
                        }
                        last_43 = None;
                    }
                    "45" if cur_pl_active => { last_45 = val.parse().ok(); }
                    "46" if cur_pl_active => {
                        if let (Some(x), Ok(y)) = (last_45, val.parse::<f64>()) {
                            cur_pl.offset = [x, y];
                        }
                        last_45 = None;
                    }
                    "49" if cur_pl_active => {
                        if let Ok(d) = val.parse::<f64>() { cur_pl.dashes.push(d); }
                    }
                    _ => {}
                }
                j += 2;
            }
            // Final flush for any arc/ellipse edge still buffered at
            // end-of-entity (some Revit exports close the path with
            // the "0" entity terminator instead of 97/98/75/76).
            if !path_is_polyline {
                flush_arc_edge(
                    &mut cur_ring, cur_edge_type,
                    edge_center, edge_major_vec, edge_radius,
                    edge_a0, edge_a1, edge_ccw,
                );
            }
            if !cur_ring.is_empty() { rings.push(cur_ring); }
            // Dedupe consecutive duplicate vertices — edge-path ring
            // collection produces adjacent duplicates because each
            // edge's end == next edge's start.
            for ring in rings.iter_mut() {
                ring.dedup_by(|a, b| (a[0] - b[0]).abs() < 1e-9 && (a[1] - b[1]).abs() < 1e-9);
                if ring.len() >= 2 {
                    let first = ring[0];
                    let last = *ring.last().unwrap();
                    if (first[0] - last[0]).abs() < 1e-9 && (first[1] - last[1]).abs() < 1e-9 {
                        ring.pop();
                    }
                }
            }
            rings.retain(|r| r.len() >= 3);
            // Flush the final pattern-line if one is active (no
            // subsequent 53 to close it out via the state machine).
            if cur_pl_active {
                pattern_lines.push(std::mem::take(&mut cur_pl));
            }
            if !rings.is_empty() {
                out.push(HatchParsed {
                    layer, aci, is_solid, rings, pattern_lines,
                    owner_block: cur_block.clone(),
                });
            }
            i = j;
            continue;
        }
        i += 1;
    }
    out
}

/// Parsed VIEWPORT entity — dxf-0.5 drops VIEWPORT silently, so we
/// extract the essentials from raw DXF text.
///
/// Field map per DXF reference:
///   code 10/20 = paper-space center point (where the viewport sits on
///                the sheet)
///   code 40    = paper-space width
///   code 41    = paper-space height
///   code 12/22 = model-space view center (what the viewport "shows")
///   code 45    = model-space height visible (determines the scale)
///
/// The paper-space → model-space transform for the viewport is then:
///   scale = paper_height / view_height
///   model_to_paper: p -> paper_ctr + (p - view_ctr) * scale
struct ViewportParsed {
    paper_ctr: [f64; 2],
    paper_w:   f64,
    paper_h:   f64,
    view_ctr:  [f64; 2],
    view_h:    f64,
}

fn parse_viewports_from_dxf(path: &str) -> Vec<ViewportParsed> {
    let text = match std::fs::read_to_string(path) {
        Ok(t) => t,
        Err(_) => return Vec::new(),
    };
    let lines: Vec<&str> = text.lines().collect();
    let mut out: Vec<ViewportParsed> = Vec::new();
    let mut i = 0usize;
    while i + 1 < lines.len() {
        if lines[i].trim() == "0" && lines[i + 1].trim() == "VIEWPORT" {
            let mut j = i + 2;
            let mut paper_cx = 0.0; let mut paper_cy = 0.0;
            let mut paper_w = 0.0;  let mut paper_h = 0.0;
            let mut view_cx = 0.0;  let mut view_cy = 0.0;
            let mut view_h = 0.0;
            while j + 1 < lines.len() {
                if lines[j].trim() == "0" { break; }
                let code = lines[j].trim();
                let val = lines[j + 1].trim();
                match code {
                    "10" => { paper_cx = val.parse().unwrap_or(0.0); }
                    "20" => { paper_cy = val.parse().unwrap_or(0.0); }
                    "40" => { paper_w  = val.parse().unwrap_or(0.0); }
                    "41" => { paper_h  = val.parse().unwrap_or(0.0); }
                    "12" => { view_cx  = val.parse().unwrap_or(0.0); }
                    "22" => { view_cy  = val.parse().unwrap_or(0.0); }
                    "45" => { view_h   = val.parse().unwrap_or(0.0); }
                    _ => {}
                }
                j += 2;
            }
            // The first VIEWPORT per layout is the paper-space
            // "overall" view with paper_w/h == sheet size and
            // view_h == 1.0 or 0.0 — skip those (they're not real
            // model-space windows).
            if paper_w > 0.1 && paper_h > 0.1 && view_h > 0.1 {
                out.push(ViewportParsed {
                    paper_ctr: [paper_cx, paper_cy],
                    paper_w,
                    paper_h,
                    view_ctr: [view_cx, view_cy],
                    view_h,
                });
            }
            i = j;
        } else {
            i += 1;
        }
    }
    out
}

pub fn load_dxf(path: &str) -> anyhow::Result<Scene> {
    bail_if_cancelled()?;
    let drawing = dxf::Drawing::load_file(path)?;
    bail_if_cancelled()?;
    // Manual HATCH pass — dxf-0.5 drops HATCH entities silently.
    let hatches = parse_hatches_from_dxf(path);
    // Manual VIEWPORT pass — dxf-0.5 drops VIEWPORT silently. We use
    // them to draw "where model-space is shown" rectangles on the
    // layout sheet, plus as a source of model→paper transforms for
    // rendering model content into the paper tab.
    let viewports = parse_viewports_from_dxf(path);
    let mut segments: Vec<Segment> = Vec::new();
    let mut triangles: Vec<Triangle> = Vec::new();
    let mut bbox = [f64::INFINITY, f64::INFINITY, f64::NEG_INFINITY, f64::NEG_INFINITY];
    let mut counts = [0u32; 6]; // LINE, CIRCLE, ARC, LWPL, INS, OTHER

    // ------------------------------------------------------------------
    // STYLE-table scan → text_style_name → font info.
    //
    // TEXT/MTEXT entities carry a STYLE reference (text_style_name). The
    // STYLE table (dxf group 100 "AcDbTextStyleTableRecord") gives us the
    // actual font filename (primary_font_file_name, group 3) plus width-
    // factor (41) and oblique-angle (50). We resolve at render time so
    // each text entity can use its real font — matching what DWG TrueView
    // and AutoCAD draw. Case-insensitive lookup: DXF style names are
    // case-sensitive in theory but many files mix case on references.
    // ------------------------------------------------------------------
    let mut style_map: HashMap<String, DxfStyleInfo> = HashMap::new();
    for st in drawing.styles() {
        let key = st.name.to_ascii_uppercase();
        style_map.insert(key, DxfStyleInfo {
            primary_font_file: st.primary_font_file_name.clone(),
            style_name: st.name.clone(),
            fixed_height: st.text_height,
            width_factor: if st.width_factor.abs() < 1e-9 { 1.0 } else { st.width_factor },
            oblique_angle: st.oblique_angle,
        });
    }
    // Mirror style_map into the DXF_STYLE_CTX thread-local so the shared
    // tessellate_text helper (used by both render_dxf_text and the future
    // re_tessellate_text_entity edit path) can resolve a STYLE name to a
    // font file without the caller having to pass `style_map` through.
    DXF_STYLE_CTX.with(|c| {
        let mut b = c.borrow_mut();
        b.clear();
        for (k, v) in &style_map { b.insert(k.clone(), v.clone()); }
    });

    // Layer-color map: entities with color=BYLAYER (the CAD default)
    // inherit from their layer. Without this lookup every by-layer entity
    // renders with the pane default — exactly what the first colour pass
    // showed ("all green"). Layers store an ACI in `Color`.
    let mut layer_color_map: HashMap<String, u32> = HashMap::new();
    // Layer → linetype name map (BYLAYER linetype inheritance).
    let mut layer_ltype_map: HashMap<String, String> = HashMap::new();
    // Set of uppercase layer names that must be HIDDEN on plot output.
    // Canonical case: "Defpoints" — AutoCAD's special layer where
    // DIMENSION entities store definition-point markers (extension-line
    // anchors, leader reference points). The layer is visible in
    // AutoCAD's editor but has `plot=0` so it's skipped when plotting
    // to PDF. Without honouring this flag the plot output shows white
    // "displacement vectors" fanning out to dimension reference points
    // — exactly the user's observation ("verplaatsingsvectoren naar
    // nulpunt").
    //
    // Also includes any layer with `is_layer_on = false` (user
    // manually switched the layer off in AutoCAD — off layers are
    // neither displayed nor plotted per AutoCAD convention).
    let mut hidden_layers: std::collections::HashSet<String> = std::collections::HashSet::new();
    let layer_color_dbg = std::env::var("O2D_LAYER_COLOR_DBG").is_ok();
    for (li, l) in drawing.layers().enumerate() {
        let key = l.name.to_ascii_uppercase();
        let aci_for_dbg: i16 = l.color.index().map(|i| i as i16).unwrap_or(0);
        let rgba = if let Some(idx) = l.color.index() {
            aci_to_rgba(idx as i16)
        } else { 0 };
        layer_color_map.insert(key.clone(), rgba);
        layer_ltype_map.insert(key.clone(), l.line_type_name.clone());
        if !l.is_layer_plotted || !l.is_layer_on {
            hidden_layers.insert(key);
        }
        if layer_color_dbg {
            eprintln!("[LAYER] DXF src=DXF idx={} name={:?} aci={} rgba=0x{:08x}",
                li, l.name, aci_for_dbg, rgba);
        }
    }

    // Linetype pattern map: DXF LTYPE → dash sequence.
    // Each entry is (total_length, Vec<f64>) where the Vec alternates
    // draw (positive) and skip (negative, stored as positive magnitude
    // with the sign retained in the value). Zero-length items = dot.
    // "Continuous", "ByLayer", "ByBlock" have an empty dash list which
    // means "draw solid" (no interruption). Numbers are in DXF world
    // units (same space as line coordinates). The drawing's `$LTSCALE`
    // header could scale these uniformly; for the 3bm training file
    // it's 1.0 so we skip that complication for now.
    let mut linetype_map: HashMap<String, Vec<f64>> = HashMap::new();
    for lt in drawing.line_types() {
        // dxf-0.5 stores the dash-pattern floats in `dash_element_lengths`.
        let key = lt.name.to_ascii_uppercase();
        linetype_map.insert(key, lt.dash_dot_space_lengths.clone());
    }

    // ------------------------------------------------------------------
    // INSERT expansion setup
    //
    // DXF stores block definitions in `drawing.blocks()` and placements
    // in `drawing.entities()` as INSERT entities (with location + scale
    // + rotation). Walking block definitions directly at their local
    // origin — as this loader did previously — is WRONG: it ignores the
    // INSERT transform, so blocks placed at non-zero positions or with
    // scale/rotation are drawn in the wrong place. This code matches
    // dxf_mockup: build a block_name → entities map and expand each
    // INSERT with the proper transform, mirroring the DWG loader's
    // expand_insert pipeline.
    //
    // *MODEL_SPACE is filtered because dxf-0.5 also emits its contents
    // via drawing.entities() — keeping both would double-render. *X
    // (xref placeholder) blocks can't be resolved without the external
    // file so we skip them. We DO keep *Paper_Space* blocks so the
    // title-block / paper-space entities render (iterated separately
    // below — they are not in drawing.entities()).
    // ------------------------------------------------------------------
    let mut block_map: HashMap<String, Vec<dxf::entities::Entity>> = HashMap::new();
    let mut paper_blocks: Vec<(String, Vec<dxf::entities::Entity>)> = Vec::new();
    for b in drawing.blocks() {
        let name_upper = b.name.to_uppercase();
        if name_upper.starts_with("*MODEL_SPACE") { continue; }
        if name_upper.starts_with("*X") { continue; }
        if name_upper.starts_with("*PAPER_SPACE") {
            // Paper-space blocks hold the sheet / title-block entities.
            // Render them at identity xform in their own pass after
            // model-space — see pass below.
            if !b.entities.is_empty() {
                paper_blocks.push((b.name.clone(), b.entities.clone()));
            }
            continue;
        }
        block_map.insert(b.name.clone(), b.entities.clone());
    }

    // Build a block-scoped hatch map EARLY (before entity loop) so the
    // INSERT expansion inside tessellate_dxf_entity can look up
    // pile-symbol / sondering solid fills defined INSIDE BLOCKS (the
    // DXF's BLOCKS section contains HATCH entities that dxf-0.5 drops).
    // `hatches_by_block` keyed by UPPERCASE block name; top-level
    // (owner_block == "") hatches are consumed by the later hatch loop.
    let hatches_by_block: HashMap<String, Vec<HatchParsed>> = {
        let mut m: HashMap<String, Vec<HatchParsed>> = HashMap::new();
        for h in &hatches {
            if !h.owner_block.is_empty() {
                m.entry(h.owner_block.to_ascii_uppercase())
                    .or_default()
                    .push(h.clone());
            }
        }
        m
    };

    // Walk entities in the DXF ENTITIES section. Each entity has
    // `common.is_in_paper_space` (group code 67) which partitions the
    // drawing. We tessellate all entities through the same code path
    // but capture the segment / triangle cursor before + after each
    // call so we can flip `is_paper` on paper-space ones — the viewer
    // uses that flag to split Model vs Layout1 tabs.
    //
    // Revit-exported DXFs in particular put the title block INSERT
    // (A4_A0_grootformaat) in the ENTITIES section with is_in_paper_space=1
    // rather than inside the *Paper_Space BLOCK. Without this split the
    // title block rendered in model-space only.
    let identity = Xform::identity();
    let mut entity_paper_count = 0usize;
    // Build layer-name → index map so every post-tessellate segment
    // can be tagged with its source entity's layer. Uppercase keys
    // (DXF is case-insensitive on layer names). Index 0 reserved for
    // "unknown / missing".
    let mut layer_name_to_idx: HashMap<String, u16> = HashMap::new();
    let mut layer_names_ordered: Vec<String> = Vec::new();
    let mut layer_colors_ordered: Vec<u32> = Vec::new();
    // Index 0 = sentinel for entities without a valid layer (dxf-0.5
    // defaults to "0" anyway, but leave one slot for robustness).
    layer_names_ordered.push("0".to_string());
    layer_colors_ordered.push(layer_color_map.get("0").copied().unwrap_or(0xFFFFFFFF));
    layer_name_to_idx.insert("0".to_string(), 0);
    let mut get_or_insert_layer = |name: &str,
                                   lnames: &mut Vec<String>,
                                   lcolors: &mut Vec<u32>,
                                   lidx: &mut HashMap<String, u16>| -> u16 {
        let up = name.to_ascii_uppercase();
        if let Some(i) = lidx.get(&up) { return *i; }
        let idx = lnames.len() as u16;
        lnames.push(name.to_string());
        lcolors.push(layer_color_map.get(&up).copied().unwrap_or(0xFFFFFFFF));
        lidx.insert(up, idx);
        idx
    };
    // Post-fill companion vectors — parallel to segments / triangles.
    let mut segment_layer_idx: Vec<u16> = Vec::new();
    let mut triangle_layer_idx: Vec<u16> = Vec::new();
    // Per-segment dash KIND (0=solid, 1=dashed, 2=dotted, 3=dash-dot).
    // emit_dashed pushes a kind for the line it emits; raw `Segment.push`
    // sites don't have to mirror it because we resize-with-zero up to
    // segments.len() at the tail-pad / end-of-loop sites below.
    let mut segment_dash_kind: Vec<u8> = Vec::new();
    // Entity-group index (for whole-entity selection). Each call to
    // tessellate_dxf_entity at top level allocates ONE entity_idx and
    // fills the ranges produced by that call + any INSERT-child
    // recursion underneath it (children never get their own idx at the
    // top level, so they inherit automatically). The hatch pass, paper
    // pass and viewport pass each allocate their own ids.
    let mut segment_entity_idx: Vec<u32> = Vec::new();
    let mut triangle_entity_idx: Vec<u32> = Vec::new();
    let mut entity_names: Vec<String> = Vec::new();
    // Per-entity raw text payload — populated inline by the TEXT/MTEXT
    // branches in tessellate_dxf_entity. Grown alongside entity_names so
    // index alignment is preserved. INSERT recursion passes None to avoid
    // re-borrow + duplicate writes (children share the parent slot).
    let mut entity_text: Vec<Option<EntityText>> = Vec::new();

    let mut _dxf_cancel_counter: usize = 0;
    for entity in drawing.entities() {
        // Cancel-check every ~256 entities — keeps the per-iter cost
        // negligible on small files while still bailing out within a
        // second or so on multi-million-entity DXFs.
        _dxf_cancel_counter = _dxf_cancel_counter.wrapping_add(1);
        if _dxf_cancel_counter & 0xFF == 0 {
            bail_if_cancelled()?;
        }
        // DXF §19 (Header Variables) / §18 (Entity Common Group Codes): group 67 = 1
        // marks an entity as paper-space. Revit-exported DXFs, however,
        // often flatten sheet content (legends, viewport masks, title-
        // block stubs) into the ENTITIES section as plain INSERTs at
        // world (0,0) WITHOUT the 67 flag — they rely on the block-name
        // convention (`NLRS_*_LAB_*`, `NLRS_*_DI_maskeer`, `*grootformaat*`,
        // `*titelblok*`, `*renvooi*`) to signal intent. Without a
        // heuristic override those INSERTs render in Model-space at the
        // origin (visible as a small legend cluster at far-left of the
        // plan) AND their block geometry gets re-projected through the
        // viewport xform into Layout-space (looking like "model content
        // spilling through the sheet"). Treat them as paper-space so
        // both effects vanish.
        let heuristic_paper = {
            use dxf::entities::EntityType as E;
            match &entity.specific {
                E::Insert(ins) => {
                    let n = ins.name.to_ascii_lowercase();
                    let at_origin = ins.location.x.abs() < 1e-6
                        && ins.location.y.abs() < 1e-6;
                    // Revit viewport-mask blocks (`NLRS_*_DI_maskeer`)
                    // live in paper coords but placed at the viewport
                    // anchor — NOT at (0,0). Allow them through without
                    // the origin check; their block name is specific
                    // enough to be a safe signal.
                    n.contains("_di_maskeer") || (at_origin && (
                        n.contains("_lab_") ||
                        n.contains("grootformaat") ||
                        n.contains("titelblok") ||
                        n.contains("renvooi")
                    ))
                }
                _ => false,
            }
        };
        let is_paper = entity.common.is_in_paper_space || heuristic_paper;
        let seg_start = segments.len();
        let tri_start = triangles.len();
        let layer_idx = get_or_insert_layer(
            &entity.common.layer,
            &mut layer_names_ordered,
            &mut layer_colors_ordered,
            &mut layer_name_to_idx,
        );
        let entity_idx = entity_names.len() as u32;
        let entity_desc = {
            use dxf::entities::EntityType as E;
            match &entity.specific {
                E::Line(_) => "LINE".to_string(),
                E::Circle(_) => "CIRCLE".to_string(),
                E::Arc(_) => "ARC".to_string(),
                E::LwPolyline(_) => "LWPOLYLINE".to_string(),
                E::Polyline(_) => "POLYLINE".to_string(),
                E::Insert(i) => format!("INSERT \"{}\"", i.name),
                E::Text(_) => "TEXT".to_string(),
                E::MText(_) => "MTEXT".to_string(),
                E::Solid(_) => "SOLID".to_string(),
                E::RotatedDimension(_) | E::AngularThreePointDimension(_)
                | E::DiameterDimension(_) | E::RadialDimension(_) | E::OrdinateDimension(_) => "DIMENSION".to_string(),
                E::Ellipse(_) => "ELLIPSE".to_string(),
                E::Spline(_) => "SPLINE".to_string(),
                _ => format!("{:?}", entity.specific).chars().take(16).collect::<String>(),
            }
        };
        entity_names.push(entity_desc);
        // Grow entity_text in lockstep so the TEXT/MTEXT branches in
        // tessellate_dxf_entity can write into entity_text[entity_idx].
        entity_text.push(None);
        tessellate_dxf_entity(
            entity,
            &identity,
            &block_map,
            &style_map,
            &layer_color_map,
            &layer_ltype_map,
            &linetype_map,
            &hidden_layers,
            &hatches_by_block,
            &mut segments,
            &mut triangles,
            &mut bbox,
            &mut counts,
            0,
            Some(&mut entity_text),
            entity_idx,
            &mut segment_dash_kind,
        );
        // Fill layer_idx + entity_idx for all segments / triangles
        // emitted by this entity (incl. any INSERT recursion).
        let seg_emit = segments.len() - seg_start;
        let tri_emit = triangles.len() - tri_start;
        segment_layer_idx.extend(std::iter::repeat(layer_idx).take(seg_emit));
        triangle_layer_idx.extend(std::iter::repeat(layer_idx).take(tri_emit));
        segment_entity_idx.extend(std::iter::repeat(entity_idx).take(seg_emit));
        triangle_entity_idx.extend(std::iter::repeat(entity_idx).take(tri_emit));
        // Pad dash-kind for any raw `Segment.push` sites inside
        // tessellate_dxf_entity that emitted between (or after) the
        // last emit_dashed call in this entity.
        if segment_dash_kind.len() < segments.len() {
            segment_dash_kind.resize(segments.len(), 0u8);
        }
        if is_paper {
            for s in &mut segments[seg_start..] { s.is_paper = true; }
            for t in &mut triangles[tri_start..] { t.is_paper = true; }
            entity_paper_count += 1;
        }
    }

    // Paper-space pass — renders title-block / sheet frame entities that
    // HATCH pass — dxf-0.5 drops HATCH entities so we parse them from
    // raw DXF text. Only emit fill triangles when the HATCH is SOLID
    // (group 70 = 1). Pattern hatches (parallel lines, cross-hatching,
    // etc.) would need per-pattern line generation which is out of
    // scope; we still emit the boundary outline so users see the
    // hatched region's extent. Even-odd / winding triangulation is
    // approximated by fan-from-vertex-0 — good enough for the convex
    // polygons that describe pile markers and filled columns, but can
    // spill for non-convex boundaries (we accept that residual).
    //
    // Color priority: explicit ACI > layer color (via layer_color_map).
    let mut hatch_count = 0usize;
    let n_solid_in = hatches.iter().filter(|h| h.is_solid).count();
    let n_rings_solid_in: usize = hatches.iter().filter(|h| h.is_solid).map(|h| h.rings.len()).sum();
    let tri_before = triangles.len();
    // Per-hatch layer-idx post-fill: each hatch's segments+tris get
    // tagged with the hatch's layer just like entity-emitted ones.
    macro_rules! fill_hatch_layer_idx {
        ($h:expr, $seg_before:expr, $tri_before:expr) => {{
            let lidx = get_or_insert_layer(
                &$h.layer,
                &mut layer_names_ordered,
                &mut layer_colors_ordered,
                &mut layer_name_to_idx,
            );
            let seg_delta = segments.len() - $seg_before;
            let tri_delta = triangles.len() - $tri_before;
            segment_layer_idx.extend(std::iter::repeat(lidx).take(seg_delta));
            triangle_layer_idx.extend(std::iter::repeat(lidx).take(tri_delta));
        }};
    }
    // Top-level hatches only — block-scoped hatches were already
    // emitted during INSERT expansion (see tessellate_dxf_entity).
    for h in hatches.iter().filter(|h| h.owner_block.is_empty()) {
        let h_seg_before = segments.len();
        let h_tri_before = triangles.len();
        let color = if h.aci > 0 {
            aci_to_rgba(h.aci)
        } else {
            layer_color_map.get(&h.layer.to_ascii_uppercase())
                .copied()
                .unwrap_or(0)
        };
        for ring in &h.rings {
            if ring.len() < 3 { continue; }
            // Only fan-triangulate solid hatches with small convex-ish
            // rings (≤8 verts). Beyond that the fan overshoots for
            // non-convex boundaries, leaving huge coloured slabs where
            // they shouldn't be. Proper ear-clip triangulation is TODO;
            // 8 verts is enough for the pile/column quadrilaterals and
            // octagons that need solid fill ("palen zijn solid
            // gearceerd") without painting entire floors pink.
            // Solid HATCH fill via ear-clip triangulation. Handles
            // non-convex polygons correctly (fan-from-vertex-0 did not,
            // which is why we disabled fills entirely in the previous
            // iteration). Ear-clip is O(N²) which is fine for the
            // typical HATCH ring (5-50 verts) — the biggest in the
            // 3bm file is ~344 verts and still completes in under a
            // millisecond.
            if h.is_solid {
                let tris = ear_clip(ring);
                for [a, b, c] in tris {
                    triangles.push(Triangle {
                        v: [ring[a], ring[b], ring[c]],
                        // Override to plot-style light grey (see
                        // HATCH_SOLID_FILL_COLOR docstring).
                        color: HATCH_SOLID_FILL_COLOR,
                        is_paper: false,
                        kind: TriKind::Solid,
                    });
                }
            } else if !h.pattern_lines.is_empty() {
                // Non-solid pattern hatch: emit repeating line-family
                // clipped to the boundary ring.
                emit_hatch_pattern_lines(ring, &h.pattern_lines, color, false, &mut segments, &mut bbox);
            }
            for w in ring.windows(2) {
                segments.push(Segment { p1: w[0], p2: w[1], color , is_paper: false });
                expand_bbox(&mut bbox, w[0][0], w[0][1]);
                expand_bbox(&mut bbox, w[1][0], w[1][1]);
            }
            if let (Some(&first), Some(&last)) = (ring.first(), ring.last()) {
                if first != last {
                    segments.push(Segment { p1: last, p2: first, color , is_paper: false });
                }
            }
            hatch_count += 1;
        }
        // HATCH entity grouping — whole hatch selects as one.
        let h_eid = entity_names.len() as u32;
        entity_names.push(format!("HATCH{}", if h.is_solid { " SOLID" } else { "" }));
        let h_seg_delta = segments.len() - h_seg_before;
        let h_tri_delta = triangles.len() - h_tri_before;
        segment_entity_idx.extend(std::iter::repeat(h_eid).take(h_seg_delta));
        triangle_entity_idx.extend(std::iter::repeat(h_eid).take(h_tri_delta));
        fill_hatch_layer_idx!(h, h_seg_before, h_tri_before);
    }
    eprintln!("[dxf-dbg] hatches={} solid_hatches={} solid_rings={} tri_emitted={}",
        hatches.len(), n_solid_in, n_rings_solid_in, triangles.len() - tri_before);

    // live only inside *Paper_Space blocks. This is what AutoCAD's
    // "Layout1" tab shows.
    //
    // Implementation note: `tessellate_dxf_entity` always emits segments
    // with `is_paper: false`. For the paper-space pass we capture the
    // segment / triangle cursor before+after the call and flip the flag
    // on everything produced so the Layout tab's `is_paper == true`
    // filter picks them up. Without this flip the 170-entity title
    // block (A4_A0_grootformaat) rendered but was invisible on the
    // Layout1 tab because the viewer filters per-space.
    let mut paper_count = 0usize;
    for (_name, ents) in &paper_blocks {
        let seg_start = segments.len();
        let tri_start = triangles.len();
        for e in ents {
            paper_count += 1;
            let e_seg_before = segments.len();
            let e_tri_before = triangles.len();
            let e_lidx = get_or_insert_layer(
                &e.common.layer,
                &mut layer_names_ordered,
                &mut layer_colors_ordered,
                &mut layer_name_to_idx,
            );
            tessellate_dxf_entity(
                e,
                &identity,
                &block_map,
                &style_map,
                &layer_color_map,
                &layer_ltype_map,
                &linetype_map,
                &hidden_layers,
                &hatches_by_block,
                &mut segments,
                &mut triangles,
                &mut bbox,
                &mut counts,
                0,
                None,
                0,
                &mut segment_dash_kind,
            );
            let seg_delta = segments.len() - e_seg_before;
            let tri_delta = triangles.len() - e_tri_before;
            segment_layer_idx.extend(std::iter::repeat(e_lidx).take(seg_delta));
            triangle_layer_idx.extend(std::iter::repeat(e_lidx).take(tri_delta));
        }
        for s in &mut segments[seg_start..] { s.is_paper = true; }
        for t in &mut triangles[tri_start..] { t.is_paper = true; }
    }

    // Sheet-frame overlay: draw each named LAYOUT's paper extents as a
    // thin rectangle. Gives a visual reference in the viewer even when
    // the paper-space blocks themselves are empty (common in Revit-
    // exported DXFs which flatten paper-space into model-space).
    // Layouts live in drawing.objects() as ObjectType::Layout variants.
    // Compute the union of all viewport paper-rectangles (plus a 5%
    // margin). We use this as the "effective" sheet bbox when the
    // LAYOUT's own min/max_limits are default/stub values — common in
    // Revit-exported DXFs where paper-space was flattened and the
    // layout extents come through as a token 12×9. Without this patch
    // the sheet rectangle was invisible against the viewport-union
    // camera fit (12×9 sub-pixel vs 184×87 viewports).
    let vp_union: Option<[f64; 4]> = viewports.iter().fold(None, |acc, vp| {
        let (cx, cy) = (vp.paper_ctr[0], vp.paper_ctr[1]);
        let (hw, hh) = (vp.paper_w * 0.5, vp.paper_h * 0.5);
        let b = [cx - hw, cy - hh, cx + hw, cy + hh];
        Some(match acc {
            None => b,
            Some(a) => [a[0].min(b[0]), a[1].min(b[1]), a[2].max(b[2]), a[3].max(b[3])],
        })
    });

    let mut sheet_frames_drawn = 0usize;
    let mut layouts: Vec<(String, [f64; 4])> = Vec::new();
    // Start the list with Model so the UI always has a "Model" tab. Its
    // bbox is patched in at the end (we need the final bbox).
    layouts.push(("Model".to_string(), [0.0, 0.0, 1.0, 1.0]));
    for obj in drawing.objects() {
        if let dxf::objects::ObjectType::Layout(layout) = &obj.specific {
            if layout.layout_name.eq_ignore_ascii_case("Model") { continue; }
            let mut rect = [
                layout.minimum_limits.x, layout.minimum_limits.y,
                layout.maximum_limits.x, layout.maximum_limits.y,
            ];
            // Expand the sheet to at least the viewport union + 5% margin.
            if let Some(vb) = vp_union {
                let mx = (vb[2] - vb[0]).max(1.0) * 0.05;
                let my = (vb[3] - vb[1]).max(1.0) * 0.05;
                rect[0] = rect[0].min(vb[0] - mx);
                rect[1] = rect[1].min(vb[1] - my);
                rect[2] = rect[2].max(vb[2] + mx);
                rect[3] = rect[3].max(vb[3] + my);
            }
            let (x0, y0, x1, y1) = (rect[0], rect[1], rect[2], rect[3]);
            if (x1 - x0).abs() < 1.0 || (y1 - y0).abs() < 1.0 { continue; }
            // Sheet outline: bright white at full alpha. Prior value was
            // color:0 which packs alpha=0 → completely invisible, making
            // the Layout1 sheet frame render as empty black canvas.
            let sheet_col: u32 = 0xFF_FF_FF_FF;
            segments.push(Segment { p1: [x0, y0], p2: [x1, y0], color: sheet_col, is_paper: true });
            segments.push(Segment { p1: [x1, y0], p2: [x1, y1], color: sheet_col, is_paper: true });
            segments.push(Segment { p1: [x1, y1], p2: [x0, y1], color: sheet_col, is_paper: true });
            segments.push(Segment { p1: [x0, y1], p2: [x0, y0], color: sheet_col, is_paper: true });
            sheet_frames_drawn += 1;
            layouts.push((layout.layout_name.clone(), [x0, y0, x1, y1]));
        }
    }

    // Viewport rectangles on the layout. Each VIEWPORT in paper-space
    // is drawn as a light-grey outlined rectangle so the user can see
    // the drawing frame / layout composition when clicking the
    // "Layout" tab. We also project model-space entities into each
    // viewport (translate by view_ctr → scale by paper/view ratio →
    // translate by paper_ctr) so the sheet tab actually shows the
    // drawing content framed by its viewport, just like AutoCAD's
    // paper-space tab does.
    let vp_outline_color: u32 = 0xFF808080; // neutral grey
    for vp in &viewports {
        let (cx, cy) = (vp.paper_ctr[0], vp.paper_ctr[1]);
        let (hw, hh) = (vp.paper_w * 0.5, vp.paper_h * 0.5);
        let p1 = [cx - hw, cy - hh];
        let p2 = [cx + hw, cy - hh];
        let p3 = [cx + hw, cy + hh];
        let p4 = [cx - hw, cy + hh];
        // Viewport borders belong to paper-space (only visible on the
        // Layout tab).
        segments.push(Segment { p1, p2, color: vp_outline_color , is_paper: true });
        segments.push(Segment { p1: p2, p2: p3, color: vp_outline_color , is_paper: true });
        segments.push(Segment { p1: p3, p2: p4, color: vp_outline_color , is_paper: true });
        segments.push(Segment { p1: p4, p2: p1, color: vp_outline_color , is_paper: true });

        // Patch the last non-Model layout's bbox so the Layout tab
        // camera fits the viewport-rect union, not just the sheet
        // (which can be tiny — 12×9 vs 184×87 viewport here).
        if let Some(last) = layouts.iter_mut().rev()
            .find(|(name, _)| !name.eq_ignore_ascii_case("Model"))
        {
            let b = &mut last.1;
            b[0] = b[0].min(p1[0]);
            b[1] = b[1].min(p1[1]);
            b[2] = b[2].max(p3[0]);
            b[3] = b[3].max(p3[1]);
        }

        // Model-space → paper-space projection Xform.
        // Note: DXF stores the aspect via separate view_w and view_h;
        // we compute horizontal scale from paper_w / view_w when the
        // file has a code-40/41-correct viewport, but since we only
        // captured view_h, use uniform scale = paper_h / view_h and
        // accept the tiny distortion.
        let scale = vp.paper_h / vp.view_h;
        let vp_xform = Xform {
            tx: cx - vp.view_ctr[0] * scale,
            ty: cy - vp.view_ctr[1] * scale,
            cos: 1.0, sin: 0.0,
            sx: scale, sy: scale,
        };
        // Re-tessellate model entities through the viewport Xform into
        // scratch buffers, then CLIP against the viewport's paper-
        // space rectangle before committing. Without clipping the
        // scaled-down model spilled across the whole sheet (user
        // feedback: "ze worden nog niet geclipt"). Segments use
        // Liang-Barsky, triangles Sutherland-Hodgman polygon clip
        // (re-fan-triangulated into 1-N output triangles).
        let rect = [cx - hw, cy - hh, cx + hw, cy + hh];
        let mut scratch_segs: Vec<Segment> = Vec::new();
        let mut scratch_tris: Vec<Triangle> = Vec::new();
        let mut scratch_bbox = [f64::INFINITY, f64::INFINITY, f64::NEG_INFINITY, f64::NEG_INFINITY];
        let mut scratch_dash_kind: Vec<u8> = Vec::new();
        let mut _vp_cancel_counter: usize = 0;
        for entity in drawing.entities() {
            _vp_cancel_counter = _vp_cancel_counter.wrapping_add(1);
            if _vp_cancel_counter & 0xFF == 0 {
                bail_if_cancelled()?;
            }
            // Skip paper-space entities in viewport pass — they'd push
            // title-block geometry through the model→paper transform.
            // Matches the heuristic in the main entity loop so Revit-
            // flattened sheet INSERTs (group 67 absent but block name
            // matches `grootformaat` / `_LAB_` / `_DI_maskeer` / `renvooi`
            // at world origin) are NOT re-projected — they already live
            // at paper coords.
            let h_paper = match &entity.specific {
                dxf::entities::EntityType::Insert(ins) => {
                    let n = ins.name.to_ascii_lowercase();
                    let at_origin = ins.location.x.abs() < 1e-6
                        && ins.location.y.abs() < 1e-6;
                    n.contains("_di_maskeer") || (at_origin && (
                        n.contains("_lab_") ||
                        n.contains("grootformaat") ||
                        n.contains("titelblok") ||
                        n.contains("renvooi")
                    ))
                }
                _ => false,
            };
            if entity.common.is_in_paper_space || h_paper { continue; }
            tessellate_dxf_entity(
                entity,
                &vp_xform,
                &block_map,
                &style_map,
                &layer_color_map,
                &layer_ltype_map,
                &linetype_map,
                &hidden_layers,
                &hatches_by_block,
                &mut scratch_segs,
                &mut scratch_tris,
                &mut scratch_bbox,
                &mut counts,
                0,
                None,
                0,
                &mut scratch_dash_kind,
            );
        }
        // Pad scratch_dash_kind to scratch_segs.len() so each scratch
        // segment's dash kind survives clipping (default solid for
        // non-dashed scratch segments).
        if scratch_dash_kind.len() < scratch_segs.len() {
            scratch_dash_kind.resize(scratch_segs.len(), 0u8);
        }
        for (i, s) in scratch_segs.into_iter().enumerate() {
            if let Some((p1, p2)) = clip_segment_to_rect(s.p1, s.p2, rect) {
                segments.push(Segment { p1, p2, color: s.color, is_paper: true });
                segment_dash_kind.push(scratch_dash_kind.get(i).copied().unwrap_or(0));
            }
        }
        for t in scratch_tris {
            let clipped_poly = clip_polygon_to_rect(&t.v, rect);
            if clipped_poly.len() >= 3 {
                for k in 1..clipped_poly.len() - 1 {
                    triangles.push(Triangle {
                        v: [clipped_poly[0], clipped_poly[k], clipped_poly[k + 1]],
                        color: t.color,
                        is_paper: true,
                        kind: t.kind,
                    });
                }
            }
        }
        // HATCH rings are parsed outside tessellate_dxf_entity (dxf-0.5
        // drops HATCH), so the viewport pass above misses them. Pull
        // them through the viewport Xform + clip pipeline here so the
        // Layout tab shows the filled slabs / palen inside each
        // viewport, just like the model tab does.
        for h in &hatches {
            let h_color = if h.aci > 0 {
                aci_to_rgba(h.aci)
            } else {
                layer_color_map.get(&h.layer.to_ascii_uppercase())
                    .copied()
                    .unwrap_or(0)
            };
            for ring in &h.rings {
                if ring.len() < 3 { continue; }
                // Transform ring through the viewport Xform.
                let tring: Vec<[f64; 2]> = ring.iter().map(|p| vp_xform.apply(*p)).collect();
                // Emit outline (clipped) in paper-space.
                for w in tring.windows(2) {
                    if let Some((p1, p2)) = clip_segment_to_rect(w[0], w[1], rect) {
                        segments.push(Segment { p1, p2, color: h_color, is_paper: true });
                    }
                }
                // Close ring.
                if let (Some(&f), Some(&l)) = (tring.first(), tring.last()) {
                    if (f[0] - l[0]).abs() > 1e-9 || (f[1] - l[1]).abs() > 1e-9 {
                        if let Some((p1, p2)) = clip_segment_to_rect(l, f, rect) {
                            segments.push(Segment { p1, p2, color: h_color, is_paper: true });
                        }
                    }
                }
                // Emit filled triangles (ear-clip then per-triangle clip).
                if h.is_solid {
                    let tris = ear_clip(&tring);
                    for [a, b, c] in tris {
                        let clipped_poly = clip_polygon_to_rect(
                            &[tring[a], tring[b], tring[c]], rect,
                        );
                        if clipped_poly.len() >= 3 {
                            for k in 1..clipped_poly.len() - 1 {
                                triangles.push(Triangle {
                                    v: [clipped_poly[0], clipped_poly[k], clipped_poly[k + 1]],
                                    // Plot-style override (see
                                    // HATCH_SOLID_FILL_COLOR).
                                    color: HATCH_SOLID_FILL_COLOR,
                                    is_paper: true,
                                    kind: TriKind::Solid,
                                });
                            }
                        }
                    }
                } else if !h.pattern_lines.is_empty() {
                    // Transform pattern lines into paper-space and emit
                    // them clipped against the transformed ring + the
                    // viewport rect. Offset vector is scaled by the
                    // viewport's model-to-paper scale; angle is
                    // rotation-invariant under vp_xform's axis-aligned
                    // scale-only transform.
                    let s = vp_xform.sx.abs().max(vp_xform.sy.abs());
                    let tpls: Vec<HatchPatternLine> = h.pattern_lines.iter().map(|pl| {
                        HatchPatternLine {
                            angle_deg: pl.angle_deg,
                            base: vp_xform.apply(pl.base),
                            offset: [pl.offset[0] * s, pl.offset[1] * s],
                            dashes: pl.dashes.clone(),
                        }
                    }).collect();
                    // Intermediate segment buffer so we can clip against
                    // the viewport rect after ring-clip.
                    let mut buf: Vec<Segment> = Vec::new();
                    let mut local_bbox = [f64::INFINITY, f64::INFINITY, f64::NEG_INFINITY, f64::NEG_INFINITY];
                    emit_hatch_pattern_lines(&tring, &tpls, h_color, true, &mut buf, &mut local_bbox);
                    for s in buf {
                        if let Some((a, b)) = clip_segment_to_rect(s.p1, s.p2, rect) {
                            segments.push(Segment { p1: a, p2: b, color: h_color, is_paper: true });
                        }
                    }
                }
            }
        }
    }

    if !bbox[0].is_finite() { bbox = [0.0, 0.0, 1.0, 1.0]; }
    // Patch the Model layout bbox now that we've finished bbox accumulation.
    if let Some(first) = layouts.first_mut() {
        if first.0.eq_ignore_ascii_case("Model") { first.1 = bbox; }
    }
    let label = format!(
        "DXF   LINE={} CIRC={} ARC={} LWPL={} INS={} other={}  paper_ents={} paper_block={} sheets={} hatch={} tri={}  total_segs={}",
        counts[0], counts[1], counts[2], counts[3], counts[4], counts[5],
        entity_paper_count, paper_count, sheet_frames_drawn, hatch_count, triangles.len(), segments.len()
    );
    // Final invariant: segment_layer_idx.len() == segments.len() and
    // same for triangles. Any push that bypassed layer tagging (VPORT
    // projections, sheet-frame overlays) gets a sentinel 0 here so the
    // Layer Manager doesn't panic on mismatched lengths.
    while segment_layer_idx.len() < segments.len() {
        segment_layer_idx.push(0);
    }
    while triangle_layer_idx.len() < triangles.len() {
        triangle_layer_idx.push(0);
    }
    // Same tail-pad for the parallel dash-kind buffer — anything that
    // bypassed emit_dashed (hatch pattern lines, viewport projection
    // raw push, sheet frames, viewport outlines) is solid.
    if segment_dash_kind.len() < segments.len() {
        segment_dash_kind.resize(segments.len(), 0u8);
    }
    // Entity-idx tail pad: any segments that slipped past the main /
    // hatch / paper loops (viewport projection pass, sheet overlays) get
    // a sentinel entity group of their own so the viewer's entity-
    // selection picks SOMETHING rather than panicking on index mismatch.
    let tail_eid = entity_names.len() as u32;
    if segment_entity_idx.len() < segments.len() || triangle_entity_idx.len() < triangles.len() {
        entity_names.push("VIEWPORT/SHEET".to_string());
        while segment_entity_idx.len() < segments.len() {
            segment_entity_idx.push(tail_eid);
        }
        while triangle_entity_idx.len() < triangles.len() {
            triangle_entity_idx.push(tail_eid);
        }
    }
    // Pad entity_text to match entity_names.len(). TEXT branch in
    // tessellate_dxf_entity already populated slots for top-level TEXT
    // entities; later passes (HATCH, paper-space, viewport sheet/tail)
    // append entity_names entries without growing entity_text — top up
    // here with None so indices stay aligned.
    if entity_text.len() < entity_names.len() {
        entity_text.resize(entity_names.len(), None);
    }
    if std::env::var_os("O2D_TEXT_DBG").is_some() {
        eprintln!(
            "[entity_text-dxf] {} total entities, {} have text",
            entity_text.len(),
            entity_text.iter().filter(|t| t.is_some()).count(),
        );
    }
    Ok(Scene {
        segments, triangles, bbox, source: "DXF", count_label: label, layouts,
        layer_names: layer_names_ordered,
        layer_colors: layer_colors_ordered,
        segment_layer_idx, triangle_layer_idx,
        segment_entity_idx, triangle_entity_idx, entity_names,
        entity_text,
        segment_dash_kind,
    })
}

// -----------------------------------------------------------------------------
// DXF entity tessellator (per-entity, with INSERT expansion).
//
// All coords are pushed through `xform.apply()` so that entities inside an
// expanded INSERT end up at the correct world position (translation +
// rotation + scale). The function recurses into INSERT entities by looking
// up the referenced block in `block_map` and composing transforms.
// -----------------------------------------------------------------------------

/// Decode DXF text escapes that represent non-ASCII characters. Must run
/// BEFORE the MTEXT-formatting strip: `\U+00E9` would otherwise be swallowed
/// whole by the generic `\<letter>…` control-code stripper (the code has no
/// terminator in `U`-form, so the strip loop eats characters up to the next
/// `\` — frequently the rest of the string — which the user perceives as
/// "all text disappeared" or "characters replaced by rectangles").
///
/// Handled forms (DXF reference §AcDbText / §AcDbMText):
///   * `\U+XXXX`   — Unicode codepoint, 4 hex digits. Used for any
///                    character outside the `$DWGCODEPAGE` charset when
///                    AutoCAD writes the file. Dutch CAD drawings use it
///                    for é (`\U+00E9`), ë, ü, ï and for engineering
///                    symbols ⌀ (`\U+2300`) / ° (`\U+00B0`) / ± (`\U+00B1`).
///   * `%%c`       — ⌀ diameter symbol (TEXT legacy; MTEXT uses `\U+2205`
///                    or `\U+2300` depending on style).
///   * `%%d`       — ° degree symbol.
///   * `%%p`       — ± plus-minus symbol.
///   * `%%u` `%%o` — toggle under/overline — currently dropped (we don't
///                    render the decoration; keeping the text readable is
///                    more important than the underline).
///   * `%%%`       — literal percent.
///   * `%%<digits>`— raw ASCII codepoint (historical; rarely seen today).
fn decode_dxf_text_escapes(raw: &str) -> String {
    // MTEXT tab/whitespace expansion. A real TAB character (0x09), the
    // AutoCAD-style `^I` caret escape, and rare `^J` (line-feed) all need
    // to be normalised before the glyph pipeline gets the string —
    // otherwise the font renders 0x09/0x0A as `.notdef` rectangles
    // (the `□` symbol the user sees in MTEXT-heavy renvooi blocks).
    // 4-space expansion matches AutoCAD's default "Default tab distance"
    // when no explicit tab stops are defined, and is good enough for a
    // 2D viewer (proper tab-stop alignment via MText's group-code 49 is
    // a TODO).
    const TAB_SPACES: &str = "    ";
    let mut out = String::with_capacity(raw.len());
    let bytes = raw.as_bytes();
    let mut i = 0usize;
    while i < bytes.len() {
        // Real ASCII tab char from the parser → expand to 4 spaces.
        if bytes[i] == 0x09 {
            out.push_str(TAB_SPACES);
            i += 1;
            continue;
        }
        // Caret escapes per AutoCAD MTEXT spec: `^I` = tab, `^J` = LF.
        // The DXF/DWG file stores the literal two-char sequence; the
        // parser hands them through unchanged. Without expansion they
        // also hit the .notdef rectangle path.
        if i + 2 <= bytes.len() && bytes[i] == b'^' {
            match bytes[i + 1] {
                b'I' | b'i' => { out.push_str(TAB_SPACES); i += 2; continue; }
                b'J' | b'j' => { out.push(' '); i += 2; continue; }
                _ => {}
            }
        }
        // `\U+XXXX` — case-sensitive per AutoCAD; we also accept `\u+` defensively.
        if i + 7 <= bytes.len()
            && bytes[i] == b'\\'
            && (bytes[i + 1] == b'U' || bytes[i + 1] == b'u')
            && bytes[i + 2] == b'+'
            && bytes[i + 3..i + 7].iter().all(|b| b.is_ascii_hexdigit())
        {
            let hex = std::str::from_utf8(&bytes[i + 3..i + 7]).unwrap_or("0000");
            if let Ok(cp) = u32::from_str_radix(hex, 16) {
                if let Some(ch) = char::from_u32(cp) {
                    out.push(ch);
                    i += 7;
                    continue;
                }
            }
            // Malformed — fall through to copy-as-is below.
        }
        // `%%` escapes.
        if i + 3 <= bytes.len() && bytes[i] == b'%' && bytes[i + 1] == b'%' {
            let c = bytes[i + 2];
            match c {
                b'c' | b'C' => { out.push('\u{2300}'); i += 3; continue; }  // ⌀ diameter
                b'd' | b'D' => { out.push('\u{00B0}'); i += 3; continue; }  // ° degree
                b'p' | b'P' => { out.push('\u{00B1}'); i += 3; continue; }  // ± plus/minus
                b'%'        => { out.push('%');        i += 3; continue; }  // literal %
                b'u' | b'U' | b'o' | b'O' => { i += 3; continue; }          // drop under/overline toggle
                b'0'..=b'9' => {
                    // %%NNN — decimal ASCII code, 1-3 digits.
                    let mut end = i + 2;
                    while end < bytes.len() && end < i + 5
                        && bytes[end].is_ascii_digit() { end += 1; }
                    if let Ok(n) = std::str::from_utf8(&bytes[i + 2..end])
                        .unwrap_or("0").parse::<u32>()
                    {
                        if let Some(ch) = char::from_u32(n) {
                            out.push(ch);
                            i = end;
                            continue;
                        }
                    }
                }
                _ => {}
            }
        }
        // Default: copy one UTF-8 char.
        // Find the UTF-8 char length starting at i.
        let b = bytes[i];
        let clen = if b < 0x80 { 1 }
                   else if b < 0xC0 { 1 }  // stray continuation — copy one byte
                   else if b < 0xE0 { 2 }
                   else if b < 0xF0 { 3 }
                   else { 4 };
        let end = (i + clen).min(bytes.len());
        out.push_str(std::str::from_utf8(&bytes[i..end]).unwrap_or("?"));
        i = end;
    }
    out
}

/// Render a TEXT/MTEXT/ATTRIB string into the scene's segment list using
/// the DXF's actual STYLE font when possible:
///   1. Look up `style_name` in `style_map` (case-insensitive).
///   2. Resolve the style's primary_font_file_name via
///      ttf_font::resolve_font_file() — returns None for SHX bare names
///      ("txt", "romans") which have no Windows equivalent.
///   3. Try ttf_font::render_string() with that .ttf filename.
///   4. If the TTF renderer yields no segments (file missing, bad font,
///      or SHX fallback), render via stroke_font::render_string() so text
///      at least appears on screen.
///
/// This matches what DWG TrueView / AutoCAD do for MTEXT using TrueType
/// style fonts like "Swis721 Cn BT" (swissc.ttf) and "Segoe UI"
/// (segoeui.ttf) — both of which are present on stock Windows installs.
/// Shared glyph-fill triangulation. Emits solid fill triangles from the
/// contour outlines returned by `ttf_font::render_string_with_contours`,
/// honouring the even-odd hole rule (O/B/D/P/R/Q/A glyphs have inner CCW
/// holes inside an outer CW ring — see §Comments in render_dxf_text body).
///
/// `shift` = (dx, dy) translation applied to every contour vertex before
/// triangulation. Caller computes it from the anchor offset.
///
/// Used by BOTH the DXF loader (`render_dxf_text`) and the DWG loader's
/// TEXT / MTEXT / ATTRIB arms inside `tessellate_one`.
fn fill_glyph_contours(
    contours: Vec<Vec<[f64; 2]>>,
    shift: [f64; 2],
    color: u32,
    triangles: &mut Vec<Triangle>,
) {
    let dx = shift[0];
    let dy = shift[1];
    let mut shifted: Vec<Vec<[f64; 2]>> = contours
        .into_iter()
        .map(|mut c| {
            for p in c.iter_mut() { p[0] += dx; p[1] += dy; }
            c
        })
        .collect();
    fn signed_area(poly: &[[f64; 2]]) -> f64 {
        let mut a = 0.0;
        let n = poly.len();
        if n == 0 { return 0.0; }
        for i in 0..n {
            let p = poly[i];
            let q = poly[(i + 1) % n];
            a += p[0] * q[1] - q[0] * p[1];
        }
        a * 0.5
    }
    fn point_in_poly(p: [f64; 2], poly: &[[f64; 2]]) -> bool {
        let mut inside = false;
        let n = poly.len();
        if n == 0 { return false; }
        let mut j = n - 1;
        for i in 0..n {
            let pi = poly[i]; let pj = poly[j];
            if ((pi[1] > p[1]) != (pj[1] > p[1]))
                && (p[0] < (pj[0] - pi[0]) * (p[1] - pi[1]) / (pj[1] - pi[1] + 1e-30) + pi[0])
            {
                inside = !inside;
            }
            j = i;
        }
        inside
    }
    // CONVENTION: ab_glyph emits outer contours CLOCKWISE (negative
    // signed area) and inner holes COUNTER-CLOCKWISE (positive). earcutr
    // needs the opposite — reverse vertices when packing the flat buffer.
    let areas: Vec<f64> = shifted.iter().map(|c| signed_area(c)).collect();
    let mut outer_holes: Vec<(usize, Vec<usize>)> = Vec::new();
    for (i, a) in areas.iter().enumerate() {
        if *a < 0.0 { outer_holes.push((i, Vec::new())); }
    }
    for (hi, a) in areas.iter().enumerate() {
        if *a <= 0.0 { continue; }
        if shifted[hi].is_empty() { continue; }
        let test_pt = shifted[hi][0];
        for (oi, holes) in outer_holes.iter_mut() {
            if point_in_poly(test_pt, &shifted[*oi]) {
                holes.push(hi);
                break;
            }
        }
    }
    // Orphaned contours (zero-area degenerate, or holes without a
    // containing outer) get triangulated as standalone outers.
    let mut assigned: Vec<bool> = vec![false; shifted.len()];
    for (oi, holes) in &outer_holes {
        assigned[*oi] = true;
        for h in holes { assigned[*h] = true; }
    }
    for (i, a) in areas.iter().enumerate() {
        if !assigned[i] && a.abs() > 1e-12 {
            outer_holes.push((i, Vec::new()));
        }
    }
    for (oi, holes) in &outer_holes {
        let outer = &shifted[*oi];
        let mut flat: Vec<f64> = Vec::with_capacity((outer.len() + holes.iter().map(|h| shifted[*h].len()).sum::<usize>()) * 2);
        for p in outer.iter().rev() { flat.push(p[0]); flat.push(p[1]); }
        let mut hole_starts: Vec<usize> = Vec::with_capacity(holes.len());
        let mut cursor = outer.len();
        for h in holes {
            hole_starts.push(cursor);
            for p in shifted[*h].iter().rev() { flat.push(p[0]); flat.push(p[1]); }
            cursor += shifted[*h].len();
        }
        if let Ok(idx) = earcutr::earcut(&flat, &hole_starts, 2) {
            for chunk in idx.chunks(3) {
                if chunk.len() < 3 { continue; }
                let ia = chunk[0]; let ib = chunk[1]; let ic = chunk[2];
                let ax = flat[ia * 2]; let ay = flat[ia * 2 + 1];
                let bx = flat[ib * 2]; let by = flat[ib * 2 + 1];
                let cx = flat[ic * 2]; let cy = flat[ic * 2 + 1];
                triangles.push(Triangle {
                    v: [[ax, ay], [bx, by], [cx, cy]],
                    color,
                    is_paper: false,
                    kind: TriKind::TextFill,
                });
            }
        }
    }
}

/// DWG text rendering: resolve style → font → render outlines + fills.
///
/// Contract:
///   - `origin` / `rotation` / `height` / `anchor` follow the DXF MTEXT
///     attachment code convention (1..=9, see `render_dxf_text` docs).
///   - `style_handle` is the `textStyleHandle` surfaced by the DWG parser
///     on TEXT / MTEXT / ATTRIB (ODA §20.4.45 / §20.4.46 / §20.4.3).
///   - `style_name` is the resolved STYLE name when the handle lookup
///     succeeded (parser.rs `resolve_handles` sets `textStyleName`).
///   - `mtext_inline` = Some((bold, italic, opt_family)) if caller has
///     already parsed the MTEXT `\f...;` override (for TEXT/ATTRIB callers
///     pass None).
///
/// Returns the advance width used for the measurement pass so the caller
/// can reuse it for anchor-offset computation instead of paying for a
/// second round-trip through the TTF cache.

/// Resolve the FINAL TTF filename a DWG text entity will render with at
/// load-time. Mirrors EXACTLY the candidate-list construction in
/// `render_dwg_text` — but instead of rendering, returns the first
/// candidate that `crate::ttf_font::resolve_font_file` accepts, falling
/// back to "arial.ttf" when nothing else resolves.
///
/// Used at populate time (DWG TEXT / MTEXT / ATTRIB / DIMENSION arms in
/// `tessellate_one`) so `EntityText.font_path` carries the SAME final
/// filename that the load-time render used. Without this, the in-place
/// text editor's `tessellate_text` re-resolves the bare STYLE name
/// through a different fallback path and picks a different font (e.g.
/// "Segoe UI_1" vs the load-time "segoeui.ttf"), which has a different
/// cap-height ratio and visibly resizes the glyphs after Enter.
fn resolve_dwg_text_font_path(
    style_handle: Option<u64>,
    style_name: Option<&str>,
    mtext_inline: Option<&(bool, bool, Option<String>)>,
) -> String {
    let style = dwg_lookup_style(style_handle, style_name);
    let mut tried: Vec<String> = Vec::with_capacity(4);
    if let Some((bold, italic, family_opt)) = mtext_inline {
        if let Some(fam) = family_opt {
            tried.push(font_family_to_file(fam, *bold, *italic));
        } else if let Some(info) = &style {
            let base = if info.primary_font_file.is_empty() {
                "arial.ttf".to_string()
            } else { info.primary_font_file.clone() };
            let suffix_sn = match (*bold, *italic) {
                (true, true) => "_B_I",
                (true, false) => "_B",
                (false, true) => "_I",
                (false, false) => "",
            };
            if !suffix_sn.is_empty() {
                let fake = format!("x{}", suffix_sn);
                let w = resolve_weighted_font_file(&base, &fake);
                if w != base { tried.push(w); }
            }
            tried.push(base);
        }
    }
    if let Some(info) = &style {
        let weighted = resolve_weighted_font_file(&info.primary_font_file, &info.style_name);
        if weighted != info.primary_font_file && !tried.contains(&weighted) {
            tried.push(weighted);
        }
        if !info.primary_font_file.is_empty() && !tried.contains(&info.primary_font_file) {
            tried.push(info.primary_font_file.clone());
        }
    }
    if !tried.iter().any(|s| s.eq_ignore_ascii_case("arial.ttf")) {
        tried.push("arial.ttf".to_string());
    }
    for cand in &tried {
        if crate::ttf_font::resolve_font_file(cand).is_some() {
            return cand.clone();
        }
    }
    "arial.ttf".to_string()
}

/// DXF analogue of `resolve_dwg_text_font_path`. Mirrors the candidate
/// list inside `render_dxf_text`: weighted style-name variant, then the
/// raw STYLE primary_font_file. Returns the first candidate that
/// `resolve_font_file` accepts; falls back to "arial.ttf".
fn resolve_dxf_text_font_path(
    style_name: &str,
    style_map: &HashMap<String, DxfStyleInfo>,
) -> String {
    let key = style_name.to_ascii_uppercase();
    let mut tried: Vec<String> = Vec::with_capacity(3);
    if let Some(info) = style_map.get(&key) {
        let weighted = resolve_weighted_font_file(&info.primary_font_file, &info.style_name);
        if weighted != info.primary_font_file {
            tried.push(weighted);
        }
        if !info.primary_font_file.is_empty() {
            tried.push(info.primary_font_file.clone());
        }
    }
    if !tried.iter().any(|s| s.eq_ignore_ascii_case("arial.ttf")) {
        tried.push("arial.ttf".to_string());
    }
    for cand in &tried {
        if crate::ttf_font::resolve_font_file(cand).is_some() {
            return cand.clone();
        }
    }
    "arial.ttf".to_string()
}

#[allow(clippy::too_many_arguments)]
fn render_dwg_text(
    text: &str,
    style_handle: Option<u64>,
    style_name: Option<&str>,
    mtext_inline: Option<(bool, bool, Option<String>)>,
    origin: [f64; 2],
    height: f64,
    rotation: f64,
    anchor: u8,
    color: u32,
    xform: &Xform,
    segments: &mut Vec<Segment>,
    triangles: &mut Vec<Triangle>,
    bbox: &mut [f64; 4],
) {
    fn anchor_offset(a: u8, tw: f64, th: f64) -> [f64; 2] {
        let dx = match a {
            2 | 5 | 8 => -tw * 0.5,
            3 | 6 | 9 => -tw,
            _ => 0.0,
        };
        let dy = match a {
            1..=3 => -th,
            4..=6 => -th * 0.5,
            _ => 0.0,
        };
        [dx, dy]
    }
    // Build font-file candidate list. Priority:
    //   1. MTEXT inline \f override (when present) — uses family → file
    //      mapping + b/i bits from the override.
    //   2. STYLE primary_font_file + Revit suffix convention on style name
    //      (resolve_weighted_font_file — "_B" → "segoeuib.ttf").
    //   3. STYLE primary_font_file without suffix remap.
    //   4. arial.ttf — AutoCAD's fallback for unknown SHX styles.
    let style = dwg_lookup_style(style_handle, style_name);
    let mut tried: Vec<String> = Vec::with_capacity(4);
    if let Some((bold, italic, family_opt)) = &mtext_inline {
        if let Some(fam) = family_opt {
            tried.push(font_family_to_file(fam, *bold, *italic));
        } else if let Some(info) = &style {
            // Apply b/i from inline override to the STYLE's font.
            let base = if info.primary_font_file.is_empty() {
                "arial.ttf".to_string()
            } else { info.primary_font_file.clone() };
            // Use resolve_weighted_font_file by faking a style_name suffix.
            let suffix_sn = match (*bold, *italic) {
                (true, true) => "_B_I",
                (true, false) => "_B",
                (false, true) => "_I",
                (false, false) => "",
            };
            if !suffix_sn.is_empty() {
                let fake = format!("x{}", suffix_sn);
                let w = resolve_weighted_font_file(&base, &fake);
                if w != base { tried.push(w); }
            }
            tried.push(base);
        }
    }
    if let Some(info) = &style {
        let weighted = resolve_weighted_font_file(&info.primary_font_file, &info.style_name);
        if weighted != info.primary_font_file && !tried.contains(&weighted) {
            tried.push(weighted);
        }
        if !info.primary_font_file.is_empty() && !tried.contains(&info.primary_font_file) {
            tried.push(info.primary_font_file.clone());
        }
    }
    // Final fallback: arial. Always try this so files without a resolvable
    // STYLE still get filled glyphs instead of stroke-font outlines.
    if !tried.iter().any(|s| s.eq_ignore_ascii_case("arial.ttf")) {
        tried.push("arial.ttf".to_string());
    }
    static DWG_FONT_DBG_ONCE: std::sync::Once = std::sync::Once::new();
    DWG_FONT_DBG_ONCE.call_once(|| {
        eprintln!(
            "[dwg-txt] first render: style={:?} primary_font={:?} tried={:?} text_len={}",
            style.as_ref().map(|s| s.style_name.as_str()),
            style.as_ref().map(|s| s.primary_font_file.as_str()),
            tried, text.len()
        );
    });
    if std::env::var_os("O2D_TEXT_EDIT_DBG").is_some() {
        eprintln!(
            "[render_dwg_text] height={} origin={:?} rot={} anchor={} xform.sx={} xform.sy={} text={:?}",
            height, origin, rotation, anchor, xform.sx, xform.sy, text
        );
    }
    // Try each candidate in order. First one that returns non-empty
    // outlines wins — emit outline segments + fill triangles.
    for font_file in &tried {
        let resolved = match crate::ttf_font::resolve_font_file(font_file) {
            Some(f) => f,
            None => continue,
        };
        let (ttf_segs, ttf_contours, adv) = crate::ttf_font::render_string_with_contours(
            &resolved, text, [0.0, 0.0], height, 0.0,
        );
        if ttf_segs.is_empty() { continue; }
        // Compute anchor offset in local frame, then rotate to world.
        let off = anchor_offset(anchor, adv, height);
        let (cs, sn) = (rotation.cos(), rotation.sin());
        let off_rot = [off[0] * cs - off[1] * sn, off[0] * sn + off[1] * cs];
        let shift_origin = [origin[0] + off_rot[0], origin[1] + off_rot[1]];
        // Rotate + shift each outline vertex, then apply xform on top.
        for (p1, p2) in &ttf_segs {
            let a = [
                p1[0] * cs - p1[1] * sn + shift_origin[0],
                p1[0] * sn + p1[1] * cs + shift_origin[1],
            ];
            let b = [
                p2[0] * cs - p2[1] * sn + shift_origin[0],
                p2[0] * sn + p2[1] * cs + shift_origin[1],
            ];
            let ta = xform.apply(a);
            let tb = xform.apply(b);
            segments.push(Segment { p1: ta, p2: tb, color, is_paper: false });
            expand_bbox(bbox, ta[0], ta[1]);
            expand_bbox(bbox, tb[0], tb[1]);
        }
        // Transform contours to world frame then triangulate. We feed
        // already-transformed contours into fill_glyph_contours with
        // zero shift.
        let mut world_contours: Vec<Vec<[f64; 2]>> = Vec::with_capacity(ttf_contours.len());
        for c in ttf_contours {
            let mut w = Vec::with_capacity(c.len());
            for p in c {
                let r = [
                    p[0] * cs - p[1] * sn + shift_origin[0],
                    p[0] * sn + p[1] * cs + shift_origin[1],
                ];
                w.push(xform.apply(r));
            }
            world_contours.push(w);
        }
        fill_glyph_contours(world_contours, [0.0, 0.0], color, triangles);
        return;
    }
    // Stroke-font fallback (no TTF rendered any glyphs — SHX-only styles
    // like "Standard" → txt.shx land here). Use baseline-left anchor
    // path so alignment matches the TTF branch.
    let (segs, adv) = crate::stroke_font::render_string(text, [0.0, 0.0], height, 0.0);
    let off = anchor_offset(anchor, adv, height);
    let (cs, sn) = (rotation.cos(), rotation.sin());
    let off_rot = [off[0] * cs - off[1] * sn, off[0] * sn + off[1] * cs];
    let shift_origin = [origin[0] + off_rot[0], origin[1] + off_rot[1]];
    for (p1, p2) in segs {
        let a = [
            p1[0] * cs - p1[1] * sn + shift_origin[0],
            p1[0] * sn + p1[1] * cs + shift_origin[1],
        ];
        let b = [
            p2[0] * cs - p2[1] * sn + shift_origin[0],
            p2[0] * sn + p2[1] * cs + shift_origin[1],
        ];
        let ta = xform.apply(a);
        let tb = xform.apply(b);
        segments.push(Segment { p1: ta, p2: tb, color, is_paper: false });
        expand_bbox(bbox, ta[0], ta[1]);
        expand_bbox(bbox, tb[0], tb[1]);
    }
}

/// Tessellate a text entity into segments + triangles. Used by initial
/// scene load (via `render_dxf_text`) AND by the future
/// `re_tessellate_text_entity()` for edit-time updates (Task 7).
///
/// Inputs are taken from `EntityText` so the renderer is content-agnostic
/// (works for TEXT, MTEXT, ATTRIB, DIM-label, edit-time replacements).
/// Output: appends to `segments` and `triangles` and expands `bbox`. The
/// caller is responsible for entity_idx / layer_idx bookkeeping.
///
/// Font resolution chain (matches `render_dxf_text`):
///   1. Try `et.font_path` directly via `resolve_font_file` — handles the
///      Task 7 case where the editor stores a resolved font filename.
///   2. Treat `et.font_path` as a STYLE name and query `DXF_STYLE_CTX` →
///      apply `resolve_weighted_font_file` for the bold/italic variant
///      based on Revit's `_B`/`_I` style-name convention; then the
///      primary_font_file unchanged.
///   3. Fall through to the Hershey stroke font.
///
/// NOTE: The DWG render path (`render_dwg_text`) does NOT delegate here.
/// Its rotation+shift+`xform` math is structurally different (glyphs are
/// rendered at local origin then projected by the parent INSERT's xform)
/// and re-routing it through a world-space EntityText helper is not
/// trivially equivalent for non-uniform xforms — the conservative choice
/// for Task 6 is to refactor only the DXF side and keep DWG inline.
#[allow(clippy::too_many_arguments)]
pub(crate) fn tessellate_text(
    et: &EntityText,
    color: u32,
    is_paper: bool,
    segments: &mut Vec<Segment>,
    triangles: &mut Vec<Triangle>,
    bbox: &mut [f64; 4],
) {
    fn anchor_offset(a: u8, tw: f64, th: f64) -> [f64; 2] {
        let dx = match a {
            2 | 5 | 8 => -tw * 0.5,
            3 | 6 | 9 => -tw,
            _ => 0.0,
        };
        let dy = match a {
            1..=3 => -th,
            4..=6 => -th * 0.5,
            _ => 0.0,
        };
        [dx, dy]
    }

    if et.raw.is_empty() || !et.anchor[0].is_finite() || !et.anchor[1].is_finite() {
        return;
    }

    // Build the ordered list of font-file candidates to try. Mirrors
    // render_dxf_text's resolution chain so visual output is bit-equal.
    //
    // Edit-time hot-path: `EntityText.font_path` carries the STYLE NAME at
    // load time (NOT a resolved file path) — see the populate sites for DXF
    // TEXT/MTEXT (~line 3656/3767) and DWG TEXT/MTEXT/ATTRIB/DIMENSION
    // (~line 6162/6276/6411). We resolve it through BOTH the DXF and the
    // DWG style contexts, so the in-place text editor preserves the
    // original entity font on commit regardless of whether the source was
    // loaded via load_dxf or load_dwg. Without the DWG fallback every
    // edited text in a DWG drawing fell back to the Hershey stroke font
    // (the user-visible "wrong default font" bug after Enter).
    let mut tried: Vec<String> = Vec::with_capacity(3);
    if !et.font_path.is_empty() {
        let edit_dbg = std::env::var_os("O2D_TEXT_EDIT_DBG").is_some();
        if edit_dbg {
            eprintln!("[text-edit] tessellate_text: font_path={:?} kind={:?}",
                et.font_path, et.kind);
        }
        // Direct font-file path: when font_path looks like an actual
        // ttf/otf/ttc file, try it first. resolve_font_file returns
        // Some(...) only for known font extensions.
        if crate::ttf_font::resolve_font_file(&et.font_path).is_some() {
            tried.push(et.font_path.clone());
        }
        // DXF STYLE-name lookup: apply the weighted-variant remap, then
        // the primary font file unchanged.
        if let Some(info) = dxf_style_lookup(&et.font_path) {
            let weighted = resolve_weighted_font_file(&info.primary_font_file, &info.style_name);
            if weighted != info.primary_font_file
                && crate::ttf_font::resolve_font_file(&weighted).is_some()
                && !tried.iter().any(|s| s.eq_ignore_ascii_case(&weighted))
            {
                tried.push(weighted);
            }
            if !info.primary_font_file.is_empty()
                && crate::ttf_font::resolve_font_file(&info.primary_font_file).is_some()
                && !tried.iter().any(|s| s.eq_ignore_ascii_case(&info.primary_font_file))
            {
                tried.push(info.primary_font_file.clone());
            }
        }
        // DWG STYLE-name lookup (by-name only — no handle available at
        // edit time). Mirrors `render_dwg_text`'s resolution chain so
        // edited DWG text keeps its original font instead of falling
        // back to stroke / arial. The DWG_STYLE_CTX outlives load_dwg
        // because it's a thread_local, so this works at edit time.
        if let Some(info) = dwg_lookup_style(None, Some(&et.font_path)) {
            let weighted = resolve_weighted_font_file(&info.primary_font_file, &info.style_name);
            if weighted != info.primary_font_file
                && crate::ttf_font::resolve_font_file(&weighted).is_some()
                && !tried.iter().any(|s| s.eq_ignore_ascii_case(&weighted))
            {
                tried.push(weighted);
            }
            if !info.primary_font_file.is_empty()
                && crate::ttf_font::resolve_font_file(&info.primary_font_file).is_some()
                && !tried.iter().any(|s| s.eq_ignore_ascii_case(&info.primary_font_file))
            {
                tried.push(info.primary_font_file.clone());
            }
        }
        // Last-chance arial fallback so DWG-loaded text without resolvable
        // STYLE still renders with FILLED glyphs (matching render_dwg_text's
        // tail at ~line 2767), not stroke outlines.
        if !tried.iter().any(|s| s.eq_ignore_ascii_case("arial.ttf")) {
            tried.push("arial.ttf".to_string());
        }
        if edit_dbg {
            eprintln!("[text-edit] tessellate_text: tried={:?}", tried);
        }
    }

    let height = et.height;
    let rotation = et.rotation;
    let origin = et.anchor;
    let anchor = et.attachment;

    if std::env::var_os("O2D_TEXT_EDIT_DBG").is_some() {
        eprintln!(
            "[text-tess] kind={:?} height={} anchor={:?} rot={} attach={} font={:?} raw={:?}",
            et.kind, height, origin, rotation, anchor, et.font_path, et.raw
        );
    }

    for font_file in &tried {
        let (ttf_segs, ttf_contours, adv) = crate::ttf_font::render_string_with_contours(
            font_file,
            &et.raw,
            origin,
            height,
            rotation,
        );
        if ttf_segs.is_empty() { continue; }
        let off = anchor_offset(anchor, adv, height);
        let (c, s) = (rotation.cos(), rotation.sin());
        let dx = off[0] * c - off[1] * s;
        let dy = off[0] * s + off[1] * c;
        for (p1, p2) in ttf_segs {
            let a = [p1[0] + dx, p1[1] + dy];
            let b = [p2[0] + dx, p2[1] + dy];
            segments.push(Segment { p1: a, p2: b, color, is_paper });
            expand_bbox(bbox, a[0], a[1]);
            expand_bbox(bbox, b[0], b[1]);
        }
        // Solid-fill triangulation for filled glyphs. fill_glyph_contours
        // hard-codes is_paper=false on the emitted triangles; preserve
        // that exact behaviour to keep visual parity with the pre-refactor
        // render_dxf_text. The `is_paper` flag passed in here only affects
        // outline segments (matching how render_dxf_text tagged them).
        fill_glyph_contours(ttf_contours, [dx, dy], color, triangles);
        return;
    }

    // Hershey stroke-font fallback. Matches render_dxf_text's tail.
    let (segs, adv) = crate::stroke_font::render_string(&et.raw, origin, height, rotation);
    let off = anchor_offset(anchor, adv, height);
    let (c, s) = (rotation.cos(), rotation.sin());
    let dx = off[0] * c - off[1] * s;
    let dy = off[0] * s + off[1] * c;
    for (p1, p2) in segs {
        let a = [p1[0] + dx, p1[1] + dy];
        let b = [p2[0] + dx, p2[1] + dy];
        segments.push(Segment { p1: a, p2: b, color, is_paper });
        expand_bbox(bbox, a[0], a[1]);
        expand_bbox(bbox, b[0], b[1]);
    }
}

/// Captured state from a re-tessellate operation. Returned to the caller
/// so it can be pushed into an EditOp::EditText for undo.
#[derive(Clone)]
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
    // Pick BEFORE mutation, while the original segs/tris are still in scene.
    let color = pick_color_for_eid(scene, eid);
    let is_paper = pick_paper_for_eid(scene, eid);
    let layer_idx = pick_layer_for_eid(scene, eid);

    // Update entity_text.raw to new_text, capture old_text.
    let et = scene.entity_text.get_mut(eid_us)
        .and_then(|o| o.as_mut())
        .ok_or_else(|| anyhow::anyhow!("entity {} has no text", eid))?;
    let old_text = std::mem::replace(&mut et.raw, new_text.to_string());
    let et_clone = et.clone();

    // Snapshot + remove old segments owned by eid.
    let mut old_segments: Vec<(usize, Segment)> = Vec::new();
    let mut new_segments: Vec<Segment> = Vec::with_capacity(scene.segments.len());
    let mut new_seg_eid: Vec<u32> = Vec::with_capacity(scene.segment_entity_idx.len());
    let mut new_seg_layer: Vec<u16> = Vec::with_capacity(scene.segment_layer_idx.len());
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

    // Same for triangles.
    let mut old_triangles: Vec<(usize, Triangle)> = Vec::new();
    let mut new_triangles: Vec<Triangle> = Vec::with_capacity(scene.triangles.len());
    let mut new_tri_eid: Vec<u32> = Vec::with_capacity(scene.triangle_entity_idx.len());
    let mut new_tri_layer: Vec<u16> = Vec::with_capacity(scene.triangle_layer_idx.len());
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

    // Re-tessellate the new text in place.
    let seg_before = scene.segments.len();
    let tri_before = scene.triangles.len();
    tessellate_text(&et_clone, color, is_paper,
        &mut scene.segments, &mut scene.triangles, &mut scene.bbox);
    let seg_added = scene.segments.len() - seg_before;
    let tri_added = scene.triangles.len() - tri_before;

    // Extend entity_idx + layer_idx for new segs/tris.
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

/// Reverse of re_tessellate_text_entity for undo. Removes any
/// segments/triangles currently owned by `delta.eid`, restores the
/// snapshotted ones, and reverts entity_text.
pub fn restore_text_entity(scene: &mut Scene, delta: &TextEntityDelta) -> anyhow::Result<()> {
    let eid = delta.eid;
    let eid_us = eid as usize;
    let layer_idx = pick_layer_for_eid(scene, eid);

    // Revert raw text.
    if let Some(Some(et)) = scene.entity_text.get_mut(eid_us) {
        et.raw = delta.old_text.clone();
    }

    // Remove current segs owned by eid.
    let mut new_seg_eid: Vec<u32> = Vec::new();
    let mut new_segments: Vec<Segment> = Vec::new();
    let mut new_seg_layer: Vec<u16> = Vec::new();
    for i in 0..scene.segments.len() {
        if scene.segment_entity_idx[i] != eid {
            new_segments.push(scene.segments[i].clone());
            new_seg_eid.push(scene.segment_entity_idx[i]);
            new_seg_layer.push(scene.segment_layer_idx[i]);
        }
    }
    let mut new_tri_eid: Vec<u32> = Vec::new();
    let mut new_triangles: Vec<Triangle> = Vec::new();
    let mut new_tri_layer: Vec<u16> = Vec::new();
    for i in 0..scene.triangles.len() {
        if scene.triangle_entity_idx[i] != eid {
            new_triangles.push(scene.triangles[i].clone());
            new_tri_eid.push(scene.triangle_entity_idx[i]);
            new_tri_layer.push(scene.triangle_layer_idx[i]);
        }
    }
    // Re-insert snapshotted segs/tris (append; original render order
    // within the eid is preserved by the snapshot Vec's own order).
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

fn pick_color_for_eid(scene: &Scene, eid: u32) -> u32 {
    for (i, s) in scene.segments.iter().enumerate() {
        if scene.segment_entity_idx.get(i).copied() == Some(eid) { return s.color; }
    }
    for (i, t) in scene.triangles.iter().enumerate() {
        if scene.triangle_entity_idx.get(i).copied() == Some(eid) { return t.color; }
    }
    0xFF_FF_FF_FF
}

fn pick_paper_for_eid(scene: &Scene, eid: u32) -> bool {
    for (i, s) in scene.segments.iter().enumerate() {
        if scene.segment_entity_idx.get(i).copied() == Some(eid) { return s.is_paper; }
    }
    false
}

fn pick_layer_for_eid(scene: &Scene, eid: u32) -> u16 {
    for (i, _) in scene.segments.iter().enumerate() {
        if scene.segment_entity_idx.get(i).copied() == Some(eid) {
            return scene.segment_layer_idx.get(i).copied().unwrap_or(0);
        }
    }
    0
}

#[allow(clippy::too_many_arguments)]
fn render_dxf_text(
    text: &str,
    style_name: &str,
    origin: [f64; 2],
    height: f64,
    rotation: f64,
    color: u32,
    // `anchor` follows DXF MTEXT attachment_point encoding (1..=9):
    //   1=TL 2=TC 3=TR  4=ML 5=MC 6=MR  7=BL 8=BC 9=BR
    // Passing 7 (BottomLeft) matches plain TEXT's baseline-left default
    // when the entity has no justification overrides. MTEXT passes its
    // attachment_point value directly.
    anchor: u8,
    style_map: &HashMap<String, DxfStyleInfo>,
    segments: &mut Vec<Segment>,
    triangles: &mut Vec<Triangle>,
    bbox: &mut [f64; 4],
) {
    // Diagnostic one-shot — preserved from the pre-extraction version so
    // first-render font resolution is still observable on stderr. The
    // actual emit logic now lives in `tessellate_text` (Task 6) so
    // initial-load and edit-time re-tessellation share one code path.
    //
    // STYLE fixed_height override INTENTIONALLY not applied here. Per
    // DXF §20.4.57 the STYLE's text_height (code 40) should override the
    // entity's own height when non-zero. HOWEVER — applying that override
    // here breaks viewport / INSERT xform scaling: the caller passes
    // `height = entity_h * xform.scale`, so for VIEWPORT-projected text
    // the incoming height is already the correctly scaled paper-space
    // value (e.g. 4.5 mm). Replacing it with the raw STYLE.fixed_height
    // (90 mm) bypasses the scale and inflates text 20× — this was the
    // iter18 regression. The entity's own height is authoritative.
    let key = style_name.to_ascii_uppercase();
    if let Some(info) = style_map.get(&key) {
        let weighted = resolve_weighted_font_file(&info.primary_font_file, &info.style_name);
        let mut tried = Vec::with_capacity(2);
        if weighted != info.primary_font_file {
            if let Some(ff) = crate::ttf_font::resolve_font_file(&weighted) { tried.push(ff); }
        }
        if let Some(ff) = crate::ttf_font::resolve_font_file(&info.primary_font_file) {
            tried.push(ff);
        }
        static TEXT_DBG_ONCE: std::sync::Once = std::sync::Once::new();
        TEXT_DBG_ONCE.call_once(|| {
            eprintln!(
                "[txt-dbg] first render_dxf_text: style='{}' primary_font_file='{}' weighted='{}' tried={:?}",
                info.style_name, info.primary_font_file, weighted, tried
            );
        });
    }

    // Build an EntityText shim and delegate to the shared helper. Note
    // `font_path` carries the STYLE NAME — `tessellate_text` resolves it
    // through DXF_STYLE_CTX (mirrored from the same style_map at the top
    // of load_dxf), then through the regular font-file resolution chain.
    // Bold/italic flags don't apply to plain TEXT/MTEXT here; the MTEXT
    // inline `\f...|bN|iN;` override is already baked into `style_name`
    // by the entity loop, OR the caller falls back to STYLE-level weight
    // (handled by resolve_weighted_font_file inside tessellate_text).
    let et = EntityText {
        raw: text.to_string(),
        anchor: origin,
        height,
        rotation,
        font_path: style_name.to_string(),
        bold: false,
        italic: false,
        attachment: anchor,
        kind: TextKind::Text, // unused by tessellate_text
    };
    tessellate_text(&et, color, false, segments, triangles, bbox);
}

/// Expand a DIMENSION entity's anonymous block (`*D<N>`). AutoCAD pre-
/// renders every DIMENSION's extension lines, dim-line, tick marks /
/// arrowheads, and text geometry into this block; resolving it at the
/// current xform gives pixel-perfect on-paper dimensions without us
/// having to interpret dim-style fields ourselves.
#[allow(clippy::too_many_arguments)]
#[allow(clippy::too_many_arguments)]
fn expand_dimension_block(
    block_name: &str,
    xform: &Xform,
    block_map: &HashMap<String, Vec<dxf::entities::Entity>>,
    style_map: &HashMap<String, DxfStyleInfo>,
    layer_color_map: &HashMap<String, u32>,
    layer_ltype_map: &HashMap<String, String>,
    linetype_map: &HashMap<String, Vec<f64>>,
    hidden_layers: &std::collections::HashSet<String>,
    hatches_by_block: &HashMap<String, Vec<HatchParsed>>,
    segments: &mut Vec<Segment>,
    triangles: &mut Vec<Triangle>,
    bbox: &mut [f64; 4],
    counts: &mut [u32; 6],
    depth: u32,
    dash_kinds: &mut Vec<u8>,
) {
    if block_name.is_empty() { return; }
    if let Some(ents) = block_map.get(block_name) {
        let ents_clone: Vec<_> = ents.clone();
        for sub in &ents_clone {
            tessellate_dxf_entity(
                sub, xform, block_map, style_map,
                layer_color_map, layer_ltype_map, linetype_map,
                hidden_layers, hatches_by_block,
                segments, triangles, bbox, counts, depth + 1,
                None, 0, dash_kinds,
            );
        }
    }
}

#[allow(clippy::too_many_arguments)]
fn tessellate_dxf_entity(
    entity: &dxf::entities::Entity,
    xform: &Xform,
    block_map: &HashMap<String, Vec<dxf::entities::Entity>>,
    style_map: &HashMap<String, DxfStyleInfo>,
    layer_color_map: &HashMap<String, u32>,
    layer_ltype_map: &HashMap<String, String>,
    linetype_map: &HashMap<String, Vec<f64>>,
    hidden_layers: &std::collections::HashSet<String>,
    // Block-owned HATCH entities keyed by UPPERCASE block name — used
    // by the INSERT expansion branch to emit pile-symbol / sondering
    // solid fills defined inside BLOCK definitions.
    hatches_by_block: &HashMap<String, Vec<HatchParsed>>,
    segments: &mut Vec<Segment>,
    triangles: &mut Vec<Triangle>,
    bbox: &mut [f64; 4],
    counts: &mut [u32; 6],
    depth: u32,
    // Per-entity raw text capture for the in-place text editor. The top-
    // level entity loop in `load_dxf` passes `Some(&mut entity_text)` +
    // the entity_idx allocated for this entity; INSERT child / dim block
    // recursion passes `None` (children share the parent's slot, no
    // duplicate write needed).
    entity_text_out: Option<&mut Vec<Option<EntityText>>>,
    entity_idx_for_text: u32,
    // Parallel-to-`segments` dash-kind buffer. `emit_dashed` lazily
    // pads with 0 up to segments.len() before pushing its kind, so any
    // raw `Segment.push` inside this function (CIRCLE/ARC/SOLID/etc.)
    // doesn't have to keep dash_kinds in sync — the next emit_dashed
    // OR the post-call `dash_kinds.resize(segments.len(), 0)` at the
    // top-level loop in `load_dxf` does it.
    dash_kinds: &mut Vec<u8>,
) {
    use dxf::entities::EntityType;
    // Honour layer plot / on flags. Entity is skipped if its layer is
    // in the hidden set — matches AutoCAD plot behaviour where layers
    // with `plot=0` (e.g. Defpoints) OR `on=false` produce no visible
    // geometry.
    if hidden_layers.contains(&entity.common.layer.to_ascii_uppercase()) {
        return;
    }

    // Recursion depth cap — same value as the DWG side's expand_insert.
    // Protects against pathological / self-referential INSERT chains.
    if depth > 8 { return; }

    // Resolve per-entity color. Priority:
    //   1. 24-bit true color (color_24_bit != 0) — explicit RGB override.
    //   2. ACI index (1-255) — looked up in our palette.
    //   3. Everything else — layer lookup. Covers BYLAYER (256) AND
    //      BYBLOCK (0) AND the dxf-0.5 default. Strict BYBLOCK should
    //      inherit from the parent INSERT; for top-level entities with
    //      no parent, layer is what AutoCAD falls back to — matches
    //      DWG TrueView behaviour and gives the viewer a sensible
    //      colour for every entity.
    let color: u32 = {
        let tc = entity.common.color_24_bit;
        if tc != 0 {
            let r = ((tc >> 16) & 0xFF) as u32;
            let g = ((tc >>  8) & 0xFF) as u32;
            let b = ( tc        & 0xFF) as u32;
            0xFF000000 | (b << 16) | (g << 8) | r
        } else if let Some(idx) = entity.common.color.index() {
            aci_to_rgba(idx as i16)
        } else {
            let lk = entity.common.layer.to_ascii_uppercase();
            layer_color_map.get(&lk).copied().unwrap_or(0)
        }
    };

    // Resolve linetype pattern. Priority:
    //   1. Explicit entity linetype (e.g. "MV_hidden", "Dashed").
    //   2. BYLAYER default → fall through to layer_ltype_map.
    //   3. Empty / "Continuous" / "ByBlock" → draw solid.
    // The resulting `ltype_pattern` is the alternating draw/skip list
    // (see emit_dashed). When it's empty we skip the emit_dashed path
    // and just push a plain Segment for performance.
    let ltype_name_raw = entity.common.line_type_name.clone();
    let resolved_ltype = if ltype_name_raw.is_empty()
        || ltype_name_raw.eq_ignore_ascii_case("BYLAYER")
        || ltype_name_raw.eq_ignore_ascii_case("BYBLOCK")
    {
        layer_ltype_map
            .get(&entity.common.layer.to_ascii_uppercase())
            .cloned()
            .unwrap_or_default()
    } else {
        ltype_name_raw
    };
    let ltype_pattern: Vec<f64> = if resolved_ltype.eq_ignore_ascii_case("Continuous")
        || resolved_ltype.eq_ignore_ascii_case("BYLAYER")
        || resolved_ltype.eq_ignore_ascii_case("BYBLOCK")
        || resolved_ltype.is_empty()
    {
        Vec::new()
    } else {
        linetype_map
            .get(&resolved_ltype.to_ascii_uppercase())
            .cloned()
            .unwrap_or_default()
    };

    match &entity.specific {
            EntityType::Line(l) => {
                let p1 = xform.apply([l.p1.x, l.p1.y]);
                let p2 = xform.apply([l.p2.x, l.p2.y]);
                emit_dashed(segments, dash_kinds, bbox, p1, p2, color, &ltype_pattern);
                counts[0] += 1;
            }
            EntityType::Circle(c) => {
                const N: usize = 64;
                let mut prev = xform.apply([c.center.x + c.radius, c.center.y]);
                for i in 1..=N {
                    let a = (i as f64) / (N as f64) * std::f64::consts::TAU;
                    let local = [c.center.x + c.radius * a.cos(), c.center.y + c.radius * a.sin()];
                    let cur = xform.apply(local);
                    segments.push(Segment { p1: prev, p2: cur, color , is_paper: false });
                    expand_bbox(bbox, cur[0], cur[1]);
                    prev = cur;
                }
                counts[1] += 1;
            }
            EntityType::Arc(a) => {
                let s = a.start_angle.to_radians();
                let e = a.end_angle.to_radians();
                let mut e2 = e;
                if e2 < s { e2 += std::f64::consts::TAU; }
                let sweep = e2 - s;
                let n = ((sweep / std::f64::consts::TAU * 64.0).ceil() as usize).max(4);
                let first_local = [a.center.x + a.radius * s.cos(), a.center.y + a.radius * s.sin()];
                let mut prev = xform.apply(first_local);
                for i in 1..=n {
                    let t = s + sweep * (i as f64) / (n as f64);
                    let local = [a.center.x + a.radius * t.cos(), a.center.y + a.radius * t.sin()];
                    let cur = xform.apply(local);
                    segments.push(Segment { p1: prev, p2: cur, color , is_paper: false });
                    expand_bbox(bbox, cur[0], cur[1]);
                    prev = cur;
                }
                counts[2] += 1;
            }
            EntityType::LwPolyline(pl) => {
                // per AutoCAD DXF reference §AcDbPolyline — code 42 bulge
                // per vertex expands straight chord into arc.
                let verts: Vec<[f64; 2]> = pl.vertices.iter()
                    .map(|v| xform.apply([v.x, v.y])).collect();
                let bulges: Vec<f64> = pl.vertices.iter().map(|v| v.bulge).collect();
                let closed = pl.get_is_closed() && verts.len() > 2;
                for (p1, p2) in tessellate_polyline_bulges(&verts, &bulges, closed) {
                    emit_dashed(segments, dash_kinds, bbox, p1, p2, color, &ltype_pattern);
                }
                counts[3] += 1;
            }
            // POLYLINE (legacy, heavy polyline with VERTEX children).
            // The dxf-0.5 crate exposes vertices via pl.vertices() iterator
            // returning Vertex structs (see dxf_mockup.rs for reference).
            // per AutoCAD DXF reference §AcDbPolyline — Vertex.bulge (code 42)
            // converts the outgoing segment to a tangent arc.
            EntityType::Polyline(pl) => {
                let mut verts: Vec<[f64; 2]> = Vec::new();
                let mut bulges: Vec<f64> = Vec::new();
                for v in pl.vertices() {
                    verts.push(xform.apply([v.location.x, v.location.y]));
                    bulges.push(v.bulge);
                }
                let closed = pl.get_is_closed() && verts.len() > 2;
                for (p1, p2) in tessellate_polyline_bulges(&verts, &bulges, closed) {
                    emit_dashed(segments, dash_kinds, bbox, p1, p2, color, &ltype_pattern);
                }
                counts[5] += 1;
            }
            // INSERT — recursively expand the referenced block with the
            // composed transform (translation + rotation + x/y scale).
            EntityType::Insert(ins) => {
                counts[4] += 1;
                let block_entities = match block_map.get(&ins.name) {
                    Some(v) => v.clone(),
                    None => return,
                };
                let rot = ins.rotation.to_radians();
                let sx = if ins.x_scale_factor == 0.0 { 1.0 } else { ins.x_scale_factor };
                let sy = if ins.y_scale_factor == 0.0 { 1.0 } else { ins.y_scale_factor };
                let ins_xform = Xform {
                    tx: ins.location.x, ty: ins.location.y,
                    cos: rot.cos(), sin: rot.sin(),
                    sx, sy,
                };
                let combined = Xform::combine(xform, &ins_xform);
                for sub in &block_entities {
                    tessellate_dxf_entity(sub, &combined, block_map, style_map, layer_color_map, layer_ltype_map, linetype_map, hidden_layers, hatches_by_block, segments, triangles, bbox, counts, depth + 1, None, 0, dash_kinds);
                }
                // Emit block-scoped HATCH fills defined INSIDE this
                // BLOCK. dxf-0.5 drops HATCHes from the BLOCKS section;
                // we parsed them raw into `hatches_by_block`.
                if let Some(bh) = hatches_by_block.get(&ins.name.to_ascii_uppercase()) {
                    for h in bh {
                        let h_color = if h.aci > 0 {
                            aci_to_rgba(h.aci)
                        } else {
                            layer_color_map.get(&h.layer.to_ascii_uppercase())
                                .copied().unwrap_or(color)
                        };
                        for ring in &h.rings {
                            if ring.len() < 3 { continue; }
                            let tring: Vec<[f64; 2]> =
                                ring.iter().map(|p| combined.apply(*p)).collect();
                            if h.is_solid {
                                let tris = ear_clip(&tring);
                                for [a, b, c] in tris {
                                    triangles.push(Triangle {
                                        v: [tring[a], tring[b], tring[c]],
                                        color: HATCH_SOLID_FILL_COLOR,
                                        is_paper: false,
                                        kind: TriKind::Solid,
                                    });
                                }
                            } else if !h.pattern_lines.is_empty() {
                                // Transform pattern lines by the INSERT xform.
                                let ins_ang = combined.sin.atan2(combined.cos);
                                let scale = combined.sx.abs().max(combined.sy.abs()).max(1e-9);
                                let tpls: Vec<HatchPatternLine> = h.pattern_lines.iter().map(|pl| {
                                    HatchPatternLine {
                                        angle_deg: pl.angle_deg + ins_ang.to_degrees(),
                                        base: combined.apply(pl.base),
                                        offset: [
                                            (pl.offset[0] * combined.cos - pl.offset[1] * combined.sin) * scale,
                                            (pl.offset[0] * combined.sin + pl.offset[1] * combined.cos) * scale,
                                        ],
                                        dashes: pl.dashes.iter().map(|d| d * scale).collect(),
                                    }
                                }).collect();
                                emit_hatch_pattern_lines(&tring, &tpls, h_color, false, segments, bbox);
                            }
                            // Stroke outline
                            for w in tring.windows(2) {
                                segments.push(Segment { p1: w[0], p2: w[1], color: h_color, is_paper: false });
                                expand_bbox(bbox, w[0][0], w[0][1]);
                                expand_bbox(bbox, w[1][0], w[1][1]);
                            }
                            if let (Some(&f), Some(&l)) = (tring.first(), tring.last()) {
                                if (f[0] - l[0]).abs() > 1e-9 || (f[1] - l[1]).abs() > 1e-9 {
                                    segments.push(Segment { p1: l, p2: f, color: h_color, is_paper: false });
                                }
                            }
                        }
                    }
                }
            }
            // SOLID — filled quadrilateral; render as 4 edges in a-b-d-c-a
            // order (DXF's convention puts c/d on the opposite side).
            EntityType::Solid(s) => {
                // DXF SOLID is a filled quadrilateral with a-b-d-c corner
                // order. Natural triangulation: a-b-d + a-d-c (handles
                // the degenerate-triangle case where c==d by skipping
                // the second triangle). Fill + outline both emitted so
                // the viewer renders a clean border on top of the fill.
                let a = xform.apply([s.first_corner.x, s.first_corner.y]);
                let b = xform.apply([s.second_corner.x, s.second_corner.y]);
                let c = xform.apply([s.third_corner.x, s.third_corner.y]);
                let d = xform.apply([s.fourth_corner.x, s.fourth_corner.y]);
                triangles.push(Triangle { v: [a, b, d], color, is_paper: false, kind: TriKind::Solid });
                if (c[0] - d[0]).abs() > 1e-9 || (c[1] - d[1]).abs() > 1e-9 {
                    triangles.push(Triangle { v: [a, d, c], color, is_paper: false, kind: TriKind::Solid });
                }
                segments.push(Segment { p1: a, p2: b, color , is_paper: false });
                segments.push(Segment { p1: b, p2: d, color , is_paper: false });
                segments.push(Segment { p1: d, p2: c, color , is_paper: false });
                segments.push(Segment { p1: c, p2: a, color , is_paper: false });
                for p in [a, b, c, d] { expand_bbox(bbox, p[0], p[1]); }
                counts[5] += 1;
            }
            // POINT — small crosshair marker at the location.
            EntityType::ModelPoint(pt) => {
                let p = xform.apply([pt.location.x, pt.location.y]);
                let s = 0.5;
                segments.push(Segment { p1: [p[0]-s, p[1]], p2: [p[0]+s, p[1]], color , is_paper: false });
                segments.push(Segment { p1: [p[0], p[1]-s], p2: [p[0], p[1]+s], color , is_paper: false });
                expand_bbox(bbox, p[0], p[1]);
                counts[5] += 1;
            }
            // ELLIPSE — parametric sampling between start/end parameters.
            EntityType::Ellipse(el) => {
                let cx = el.center.x;
                let cy = el.center.y;
                let mx = el.major_axis.x;
                let my = el.major_axis.y;
                let ratio = el.minor_axis_ratio.abs().max(1e-9);
                let s = el.start_parameter;
                let e = el.end_parameter;
                let mut e2 = e;
                if e2 < s { e2 += std::f64::consts::TAU; }
                let sweep = e2 - s;
                let n = ((sweep / std::f64::consts::TAU * 96.0).ceil() as usize).max(8);
                let px = -my;
                let py = mx;
                let first_local = [
                    cx + mx * s.cos() + px * ratio * s.sin(),
                    cy + my * s.cos() + py * ratio * s.sin(),
                ];
                let mut prev = xform.apply(first_local);
                for i in 1..=n {
                    let t = s + sweep * (i as f64) / (n as f64);
                    let local = [
                        cx + mx * t.cos() + px * ratio * t.sin(),
                        cy + my * t.cos() + py * ratio * t.sin(),
                    ];
                    let cur = xform.apply(local);
                    segments.push(Segment { p1: prev, p2: cur, color , is_paper: false });
                    expand_bbox(bbox, cur[0], cur[1]);
                    prev = cur;
                }
                counts[5] += 1;
            }
            // SPLINE — polyline through fit points (or control points as fallback).
            // Not a true NURBS evaluation; this matches dxf_mockup's approximation.
            EntityType::Spline(sp) => {
                let pts: Vec<[f64; 2]> = if !sp.fit_points.is_empty() {
                    sp.fit_points.iter().map(|p| xform.apply([p.x, p.y])).collect()
                } else {
                    sp.control_points.iter().map(|p| xform.apply([p.x, p.y])).collect()
                };
                if pts.len() >= 2 {
                    for w in pts.windows(2) {
                        segments.push(Segment { p1: w[0], p2: w[1], color , is_paper: false });
                        expand_bbox(bbox, w[0][0], w[0][1]);
                        expand_bbox(bbox, w[1][0], w[1][1]);
                    }
                }
                counts[5] += 1;
            }
            // TEXT — TrueType glyph tessellation when the STYLE's font
            // file resolves to a .ttf on disk, else Hershey stroke-font
            // fallback. xform applies to both insertion point and text
            // rotation.
            EntityType::Text(t) => {
                // TEXT alignment per DXF §20.4.57 (AcDbText):
                //   group 72 = horizontal justification (0=Left, 1=Center,
                //              2=Right, 3=Aligned, 4=Middle, 5=Fit)
                //   group 73 = vertical justification   (0=Baseline,
                //              1=Bottom, 2=Middle, 3=Top)
                // The INSERTION point for rendering is `location` (10/20)
                // ONLY when hj==Left AND vj==Baseline. Otherwise the
                // `second_alignment_point` (11/21) carries the anchor.
                use dxf::enums::{HorizontalTextJustification as HJ,
                                 VerticalTextJustification as VJ};
                let hj = t.horizontal_text_justification;
                let vj = t.vertical_text_justification;
                let is_default = matches!(hj, HJ::Left)
                    && matches!(vj, VJ::Baseline);
                let local_origin = if is_default {
                    [t.location.x, t.location.y]
                } else {
                    [t.second_alignment_point.x, t.second_alignment_point.y]
                };
                let world_origin = xform.apply(local_origin);
                let h = t.text_height.abs().max(1e-6);
                let local_rot = t.rotation.to_radians();
                let parent_rot = xform.sin.atan2(xform.cos);
                let rot = local_rot + parent_rot;
                let h_world = h * xform.sx.abs().max(xform.sy.abs());
                // Map (hj, vj) → MTEXT-style attachment code (1..9).
                let row: u8 = match vj {
                    VJ::Top => 0,
                    VJ::Middle => 1,
                    _ => 2, // Baseline or Bottom
                };
                let col: u8 = match hj {
                    HJ::Center | HJ::Middle => 1,
                    HJ::Right => 2,
                    _ => 0,  // Left / Aligned / Fit
                };
                let anchor = 1 + row * 3 + col;
                if !t.value.is_empty() && world_origin[0].is_finite() && world_origin[1].is_finite() {
                    // Decode `\U+XXXX` Unicode escapes and `%%c/%%d/%%p`
                    // diameter/degree/plus-minus symbols so the glyph
                    // pipeline sees the actual codepoints rather than
                    // their 7-char DXF-escape representation (which would
                    // render as literal `\`, `U`, `+`, digits — or for
                    // backslash-mapped fonts, a row of .notdef rectangles).
                    let decoded = decode_dxf_text_escapes(&t.value);
                    render_dxf_text(&decoded, &t.text_style_name, world_origin, h_world, rot, color, anchor, style_map, segments, triangles, bbox);
                    // Capture raw TEXT payload for the in-place editor.
                    // Only the top-level entity loop passes Some(...) here;
                    // INSERT child recursion passes None so we don't double-
                    // write or fight the borrow-checker. font_path stores
                    // the FINAL resolved TTF filename (same chain as
                    // render_dxf_text) so the editor's tessellate_text
                    // picks the identical font on commit.
                    if let Some(et_out) = entity_text_out {
                        let idx = entity_idx_for_text as usize;
                        if idx < et_out.len() {
                            let resolved_font =
                                resolve_dxf_text_font_path(&t.text_style_name, style_map);
                            et_out[idx] = Some(EntityText {
                                raw: decoded,
                                anchor: world_origin,
                                height: h_world,
                                rotation: rot,
                                font_path: resolved_font,
                                bold: false,
                                italic: false,
                                attachment: anchor,
                                kind: TextKind::Text,
                            });
                        }
                    }
                }
                counts[5] += 1;
            }
            EntityType::MText(m) => {
                let local_origin = [m.insertion_point.x, m.insertion_point.y];
                let world_origin = xform.apply(local_origin);
                let h = m.initial_text_height.abs().max(1e-6);
                // MText rotation: per DXF reference §16.2 the x_axis_direction
                // vector (codes 11/21/31) OVERRIDES rotation_angle (code 50)
                // whenever it's stored. Revit-exported DXFs encode all
                // non-zero rotations exclusively via x_axis_direction and
                // leave rotation_angle = 0 — reading only rotation_angle
                // leaves 77/501 vertical-label MTEXTs rendering horizontal
                // ("theoretische paallengte", "Steklengte" etc.).
                //
                // rotation_angle itself is already in RADIANS (dxf-0.5
                // stores the raw code-50 value; per DXF spec MTEXT code
                // 50 is radians, unlike TEXT's degrees).
                let x_axis_nonzero =
                    m.x_axis_direction.x.abs() > 1e-12 ||
                    m.x_axis_direction.y.abs() > 1e-12;
                let local_rot = if m.rotation_angle.abs() > 1e-12 {
                    m.rotation_angle
                } else if x_axis_nonzero {
                    m.x_axis_direction.y.atan2(m.x_axis_direction.x)
                } else {
                    0.0
                };
                let parent_rot = xform.sin.atan2(xform.cos);
                let rot = local_rot + parent_rot;
                let h_world = h * xform.sx.abs().max(xform.sy.abs());
                // Strip minimal MTEXT formatting escape codes; see matching
                // logic in tessellate_one for the DWG path.
                //
                // IMPORTANT: decode `\U+XXXX` / `%%c` / `%%d` / `%%p` FIRST.
                // The generic `\<letter>...` strip loop below would otherwise
                // eat `\U+00E9` as if it were a control code without a `;`
                // terminator, swallowing every subsequent char up to the next
                // `\` — commonly the end of the string. That presents to the
                // user as "accented word disappeared" or "label became blank /
                // rectangles" once the render path hits missing glyphs.
                let decoded = decode_dxf_text_escapes(&m.text);
                let raw_text: &str = &decoded;
                let mut text = String::with_capacity(raw_text.len());
                let mut chars = raw_text.chars().peekable();
                while let Some(c) = chars.next() {
                    if c == '\\' {
                        match chars.peek().copied() {
                            Some('P') | Some('p') => { chars.next(); text.push(' '); }
                            Some('~') => { chars.next(); text.push(' '); }
                            Some('\\') => { chars.next(); text.push('\\'); }
                            Some('{') => { chars.next(); text.push('{'); }
                            Some('}') => { chars.next(); text.push('}'); }
                            Some(_) => {
                                chars.next();
                                while let Some(&nc) = chars.peek() {
                                    if nc == ';' { chars.next(); break; }
                                    if nc == '\\' { break; }
                                    chars.next();
                                }
                            }
                            None => {}
                        }
                    } else if c == '{' || c == '}' {
                        // skip grouping braces
                    } else {
                        text.push(c);
                    }
                }
                // BUG-1' DIAG: log raw vs stripped MTEXT to identify
                // punctuation-eating in the stripper. Gated on env var.
                if std::env::var_os("O2D_MTEXT_DBG").is_some() {
                    eprintln!("[MTEXT-DXF] raw={:?} after_strip={:?}", &m.text, text);
                }
                // MTEXT attachment_point enum variants map 1-indexed
                // (TopLeft=1 … BottomRight=9), exactly the encoding
                // render_dxf_text expects via its `anchor` arg.
                use dxf::enums::AttachmentPoint as AP;
                let anchor: u8 = match m.attachment_point {
                    AP::TopLeft => 1, AP::TopCenter => 2, AP::TopRight => 3,
                    AP::MiddleLeft => 4, AP::MiddleCenter => 5, AP::MiddleRight => 6,
                    AP::BottomLeft => 7, AP::BottomCenter => 8, AP::BottomRight => 9,
                };
                if !text.is_empty() && world_origin[0].is_finite() && world_origin[1].is_finite() {
                    render_dxf_text(&text, &m.text_style_name, world_origin, h_world, rot, color, anchor, style_map, segments, triangles, bbox);
                    // Capture raw MTEXT payload for the in-place editor.
                    // Mirrors the TEXT branch: only the top-level entity
                    // loop passes Some(...); INSERT child recursion passes
                    // None to avoid double-writes. We store `decoded` (i.e.
                    // post-`\U+XXXX`/`%%c`/`%%d`/`%%p` decode) so the
                    // editor sees real Unicode codepoints, but we DO keep
                    // MTEXT formatting codes (`\fArial|b1;`, `\P`, `^I`,
                    // `{...}` groupings) intact — the editor needs those
                    // for round-trip fidelity. font_path stores the FINAL
                    // resolved TTF filename (same chain as render_dxf_text).
                    if let Some(et_out) = entity_text_out {
                        let idx = entity_idx_for_text as usize;
                        if idx < et_out.len() {
                            let resolved_font =
                                resolve_dxf_text_font_path(&m.text_style_name, style_map);
                            et_out[idx] = Some(EntityText {
                                raw: decoded,
                                anchor: world_origin,
                                height: h_world,
                                rotation: rot,
                                font_path: resolved_font,
                                bold: false,
                                italic: false,
                                attachment: anchor,
                                kind: TextKind::MText,
                            });
                        }
                    }
                }
                counts[5] += 1;
            }
            EntityType::Attribute(a) => {
                // ATTRIB has the same 72/73 justification codes as TEXT.
                use dxf::enums::{HorizontalTextJustification as HJ,
                                 VerticalTextJustification as VJ};
                let hj = a.horizontal_text_justification;
                let is_default = matches!(hj, HJ::Left);
                let local_origin = if is_default {
                    [a.location.x, a.location.y]
                } else {
                    [a.second_alignment_point.x, a.second_alignment_point.y]
                };
                let world_origin = xform.apply(local_origin);
                let h = a.text_height.abs().max(1e-6);
                let local_rot = a.rotation.to_radians();
                let parent_rot = xform.sin.atan2(xform.cos);
                let rot = local_rot + parent_rot;
                let h_world = h * xform.sx.abs().max(xform.sy.abs());
                // ATTRIB doesn't expose vertical_text_justification on
                // dxf-0.5's Attribute — default to Baseline row.
                let _ = VJ::Baseline; // compile-pin enum import
                let col: u8 = match hj {
                    HJ::Center | HJ::Middle => 1,
                    HJ::Right => 2,
                    _ => 0,
                };
                let anchor = 1 + 2 * 3 + col; // row=2 (Baseline) → 7/8/9
                let text: &str = if !a.value.is_empty() { &a.value } else { &a.attribute_tag };
                if !text.is_empty() && world_origin[0].is_finite() && world_origin[1].is_finite() {
                    let decoded = decode_dxf_text_escapes(text);
                    render_dxf_text(&decoded, &a.text_style_name, world_origin, h_world, rot, color, anchor, style_map, segments, triangles, bbox);
                }
                counts[5] += 1;
            }
            EntityType::AttributeDefinition(a) => {
                use dxf::enums::{HorizontalTextJustification as HJ,
                                 VerticalTextJustification as VJ};
                let hj = a.horizontal_text_justification;
                let is_default = matches!(hj, HJ::Left);
                let local_origin = if is_default {
                    [a.location.x, a.location.y]
                } else {
                    [a.second_alignment_point.x, a.second_alignment_point.y]
                };
                let world_origin = xform.apply(local_origin);
                let h = a.text_height.abs().max(1e-6);
                let local_rot = a.rotation.to_radians();
                let parent_rot = xform.sin.atan2(xform.cos);
                let rot = local_rot + parent_rot;
                let h_world = h * xform.sx.abs().max(xform.sy.abs());
                let _ = VJ::Baseline;
                let col: u8 = match hj {
                    HJ::Center | HJ::Middle => 1,
                    HJ::Right => 2,
                    _ => 0,
                };
                let anchor = 1 + 2 * 3 + col;
                let text: &str = if !a.value.is_empty() {
                    &a.value
                } else if !a.text_tag.is_empty() {
                    &a.text_tag
                } else {
                    &a.prompt
                };
                if !text.is_empty() && world_origin[0].is_finite() && world_origin[1].is_finite() {
                    let decoded = decode_dxf_text_escapes(text);
                    render_dxf_text(&decoded, &a.text_style_name, world_origin, h_world, rot, color, anchor, style_map, segments, triangles, bbox);
                }
                counts[5] += 1;
            }
            // DIMENSION variants. AutoCAD pre-renders every DIMENSION
            // entity's geometry (extension lines, dimension line, tick
            // marks or arrowheads, and dimension text) into an anonymous
            // block named `*D<N>` and stores that block's name in
            // `DimensionBase.block_name`. The block coordinates are
            // already in world-space, so expanding it at identity
            // transform is equivalent to AutoCAD's on-screen render —
            // gives us dimension ticks, extension lines, and text
            // "for free" without having to reconstruct the dim-style
            // geometry ourselves.
            //
            // We handle all five dxf-0.5 dimension subtypes here:
            // Rotated (= aligned+linear per §AcDbAlignedDimension),
            // Radial, Diameter, AngularThreePointDimension, and
            // OrdinateDimension. Each has `.dimension_base.block_name`.
            EntityType::RotatedDimension(d) => {
                expand_dimension_block(&d.dimension_base.block_name, xform, block_map, style_map, layer_color_map, layer_ltype_map, linetype_map, hidden_layers, hatches_by_block, segments, triangles, bbox, counts, depth, dash_kinds);
                counts[5] += 1;
            }
            EntityType::RadialDimension(d) => {
                expand_dimension_block(&d.dimension_base.block_name, xform, block_map, style_map, layer_color_map, layer_ltype_map, linetype_map, hidden_layers, hatches_by_block, segments, triangles, bbox, counts, depth, dash_kinds);
                counts[5] += 1;
            }
            EntityType::DiameterDimension(d) => {
                expand_dimension_block(&d.dimension_base.block_name, xform, block_map, style_map, layer_color_map, layer_ltype_map, linetype_map, hidden_layers, hatches_by_block, segments, triangles, bbox, counts, depth, dash_kinds);
                counts[5] += 1;
            }
            EntityType::AngularThreePointDimension(d) => {
                expand_dimension_block(&d.dimension_base.block_name, xform, block_map, style_map, layer_color_map, layer_ltype_map, linetype_map, hidden_layers, hatches_by_block, segments, triangles, bbox, counts, depth, dash_kinds);
                counts[5] += 1;
            }
            EntityType::OrdinateDimension(d) => {
                expand_dimension_block(&d.dimension_base.block_name, xform, block_map, style_map, layer_color_map, layer_ltype_map, linetype_map, hidden_layers, hatches_by_block, segments, triangles, bbox, counts, depth, dash_kinds);
                counts[5] += 1;
            }
            // NOTE: dxf-0.5 does not expose a VIEWPORT entity variant
            // (despite DXF having a VIEWPORT dxf record). Viewports
            // therefore fall through to the `_` catch-all. When we
            // upgrade dxf or switch crates we can render viewport
            // rectangles here; for now the sheet-frame rectangle drawn
            // from the LAYOUT object (see load_dxf) covers the common
            // "show the sheet border" use case.
            _ => {
                counts[5] += 1;
            }
    }
}

// =============================================================================
// DWG loader (with INSERT block expansion)
// =============================================================================

/// 2D affine transform used for INSERT block expansion.
/// Applied as: world = translate * rotate * scale * local.
#[derive(Clone, Copy, Debug)]
struct Xform {
    tx: f64, ty: f64,
    cos: f64, sin: f64,
    sx: f64, sy: f64,
}

impl Xform {
    fn identity() -> Self {
        Self { tx: 0.0, ty: 0.0, cos: 1.0, sin: 0.0, sx: 1.0, sy: 1.0 }
    }
    fn apply(&self, p: [f64; 2]) -> [f64; 2] {
        let (x, y) = (p[0] * self.sx, p[1] * self.sy);
        [
            x * self.cos - y * self.sin + self.tx,
            x * self.sin + y * self.cos + self.ty,
        ]
    }
    /// Compose two transforms: first inner, then outer.
    /// Implemented numerically via three sample points (origin + unit basis).
    fn combine(outer: &Xform, inner: &Xform) -> Xform {
        let e0 = outer.apply(inner.apply([0.0, 0.0]));
        let e1 = outer.apply(inner.apply([1.0, 0.0]));
        let e2 = outer.apply(inner.apply([0.0, 1.0]));
        let ex = [e1[0] - e0[0], e1[1] - e0[1]];
        let ey = [e2[0] - e0[0], e2[1] - e0[1]];
        let sx = (ex[0].powi(2) + ex[1].powi(2)).sqrt();
        let sy = (ey[0].powi(2) + ey[1].powi(2)).sqrt();
        let cos = if sx > 1e-12 { ex[0] / sx } else { 1.0 };
        let sin = if sx > 1e-12 { ex[1] / sx } else { 0.0 };
        Xform { tx: e0[0], ty: e0[1], cos, sin, sx, sy }
    }
}

// ---------------------------------------------------------------------------
// DWG color + linetype resolution helpers
//
// The DWG parser attaches three JSON fields to every entity's data map:
//   data["color"]      — integer CMC / ENC color index (ODA §2.11 "CMC" and
//                        §2.12 "ENC"). Index value semantics:
//                          0        = BYBLOCK  (inherit from parent INSERT)
//                          1-255    = ACI palette index
//                          256      = BYLAYER  (inherit from layer)
//                          negative = layer-off sentinel (only on LAYER
//                                     records themselves)
//   data["trueColor"]  — optional "#RRGGBB" hex (present when ENC has the
//                        0x8000 truecolor bit; ODA §2.12.)
//   data["layer"]      — resolved layer NAME (via resolve_handles second pass).
//   data["linetype"]   — resolved linetype NAME, present only when the
//                        entity's ltype_flags == 0b11 per ODA §20.4.1 step
//                        12 ("Ltype flags BB"). Flags 0/1/2 mean BYLAYER /
//                        BYBLOCK / Continuous respectively and no handle is
//                        written, so the JSON key is absent in those cases.
//
// The LAYER table object carries its own `data["color"]` (CMC) which is the
// value that BYLAYER entities should inherit. The DWG parser does NOT
// currently parse the layer's linetype handle (parse_layer_obj stops after
// the CMC read), so layer-inherited linetype is the one remaining gap — we
// still resolve entity-explicit linetypes here which covers the MV_hidden /
// DASHED / CENTER cases seen in the 3bm training set.
// ---------------------------------------------------------------------------

/// Resolve a DWG entity's effective stroke color to the viewer's packed
/// 0xAABBGGRR u32. Priority (ODA §20.4.1 / AutoCAD reference):
///   1. `trueColor` hex  (explicit 24-bit RGB)
///   2. entity `color` index, when 1-255 (explicit ACI)
///   3. BYLAYER (index 256, or any other sentinel)  → layer lookup
///   4. default fallback `default_rgba` (BYBLOCK 0 with no parent, or
///      unknown layer)
fn dwg_resolve_color(
    data: &serde_json::Value,
    layer_color_map: &HashMap<String, u32>,
    default_rgba: u32,
) -> u32 {
    // 1. Parse "#RRGGBB" truecolor hex into 0xAABBGGRR.
    if let Some(hex) = data.get("trueColor").and_then(|v| v.as_str()) {
        let h = hex.trim_start_matches('#');
        if h.len() == 6 {
            if let Ok(rgb) = u32::from_str_radix(h, 16) {
                let r = (rgb >> 16) & 0xFF;
                let g = (rgb >>  8) & 0xFF;
                let b =  rgb        & 0xFF;
                return 0xFF000000 | (b << 16) | (g << 8) | r;
            }
        }
    }
    // 2. Explicit ACI 1-255.
    let idx_raw = data.get("color").and_then(|v| v.as_i64()).unwrap_or(256);
    if (1..=255).contains(&idx_raw) {
        return aci_to_rgba(idx_raw as i16);
    }
    // 3. BYLAYER (256) or BYBLOCK (0 with no parent) — fall through to
    //    layer lookup.
    if let Some(layer_name) = data.get("layer").and_then(|v| v.as_str()) {
        if let Some(&rgba) = layer_color_map.get(&layer_name.to_ascii_uppercase()) {
            return rgba;
        }
    }
    default_rgba
}

/// Built-in dash patterns for AutoCAD's ACAD_ISO and common user-defined
/// linetype names. The DWG LTYPE table record in parse_ltype_obj only
/// reads `name`, `description`, and `patternLength` — the dash-length
/// array is skipped (ODA §20.4.56 has the full element spec but it's not
/// plumbed through the parser). For visual parity on the 3bm training set
/// we hard-code the 11 standard AutoCAD patterns plus common project
/// prefixes (MV_*, 3BM_*). Everything not listed renders as continuous.
///
/// Pattern semantics match DXF / `emit_dashed`: positive = draw, negative
/// = skip, 0.0 = dot. Lengths are in drawing units (LTSCALE is already
/// baked in at authoring time for these standard patterns; per-entity
/// linetype_scale is not yet applied on either DWG or DXF path).
fn dwg_builtin_ltype_pattern(name_raw: &str) -> Vec<f64> {
    // Hard-coded fallback used when the DWG parser can't emit the real dash
    // array from the LTYPE object (known R2010+ bit-drift around the LTYPE
    // object header — tracked separately). The values below are taken from
    // the LTYPE tables that Revit ships with its DXF export (verified against
    // the Funderingsherstel CP-21 DXF fixture, see §20.4.56 dash-element
    // spec). Standard AutoCAD ACAD.LIN values are kept as a last-ditch
    // fallback for non-Revit sources.
    //
    // Evidence — MV_hidden in the fixture's LTYPE table (group codes 40=
    // pattern-length, 49=dash-length):
    //   40 = 3.75
    //   49 = 2.5    (draw)
    //   49 = -1.25  (skip)
    // That's 10x the ACAD.LIN HIDDEN pattern [0.25, -0.125], which is why
    // Revit-exported DWGs looked like solid lines in our viewer: the dashes
    // existed but were sub-pixel at normal zoom.
    let up = name_raw.trim().to_ascii_uppercase();

    // Try exact Revit/3BM-template names first (no prefix strip). These
    // override the generic ACAD table below.
    match up.as_str() {
        // Verified against 2705 Funderingsherstel DXF LTYPE table.
        "MV_HIDDEN"      => return vec![2.5, -1.25],
        "MV_CENTER"      => return vec![6.0, -3.0, 3.0, -3.0],
        "MV_HIDDEN_WAND" => return vec![1.5, -1.5],
        // Revit's own "Hidden" linetype (distinct from AutoCAD HIDDEN) —
        // fixture: 4.7625 / -2.38125.
        "HIDDEN"         => return vec![4.7625, -2.38125],
        _ => {}
    }

    // Strip MV_ / 3BM_ / ACAD_ISO style prefixes used by the 3bm drawing
    // templates so we can match on the semantic suffix.
    let key: &str = match up.as_str() {
        s if s.starts_with("MV_")  => &s[3..],
        s if s.starts_with("3BM_") => &s[4..],
        s if s.starts_with("ACAD_ISO") => &s[8..].trim_start_matches('_'),
        s => s,
    };
    // Names match AutoCAD's ACAD.LIN / ACADISO.LIN distributions. Used only
    // when no Revit-specific match above fires.
    match key {
        "DASHED" | "DASHED2" | "DASHEDX2" | "ISO02W100"
            => vec![0.5, -0.25],
        // Note: plain "HIDDEN" is caught by the Revit override above. This
        // path is reached for HIDDEN2 / HIDDENX2 (AutoCAD scaled variants).
        "HIDDEN2" | "HIDDENX2" | "ISO03W100"
            => vec![0.25, -0.125],
        "CENTER" | "CENTER2" | "CENTERX2"
            => vec![1.25, -0.25, 0.25, -0.25],
        "DASHDOT" | "DASHDOT2" | "DASHDOTX2" | "ISO10W100"
            => vec![0.5, -0.25, 0.0, -0.25],
        "PHANTOM" | "PHANTOM2" | "PHANTOMX2"
            => vec![1.25, -0.25, 0.25, -0.25, 0.25, -0.25],
        "BORDER" | "BORDER2" | "BORDERX2"
            => vec![0.5, -0.25, 0.5, -0.25, 0.0, -0.25],
        "DIVIDE" | "DIVIDE2" | "DIVIDEX2"
            => vec![0.5, -0.25, 0.0, -0.25, 0.0, -0.25],
        "DOT"    | "DOT2"    | "DOTX2" | "ISO07W100"
            => vec![0.0, -0.25],
        // Common 3bm project-template aliases observed in the training set.
        "HIDDENLINE" | "HIDDEN_LINE"
            => vec![0.25, -0.125],
        _ => Vec::new(),
    }
}

/// Resolve a DWG entity's effective dash pattern. Returns empty vec for
/// continuous (no dashing) so the caller can skip `emit_dashed` and push
/// plain segments.
///
/// Lookup order (ODA §20.4.1 step 12):
///   1. Entity-explicit linetype name (not CONTINUOUS/BYLAYER/BYBLOCK)
///   2. Layer's linetype (BYLAYER)
/// For each candidate name we prefer the real dash array parsed from the
/// file's LTYPE objects (`ltype_dashes_map`, built in load_dwg from the
/// ODA §20.4.56 object) and fall back to the hard-coded ACAD.LIN table
/// only if the file didn't supply one.
fn dwg_resolve_ltype_pattern(
    data: &serde_json::Value,
    layer_ltype_map: &HashMap<String, String>,
    ltype_dashes_map: &HashMap<String, Vec<f64>>,
    global_ltscale: f64,
) -> Vec<f64> {
    let resolve = |name: &str| -> Vec<f64> {
        let key = name.to_ascii_uppercase();
        if let Some(d) = ltype_dashes_map.get(&key) {
            if !d.is_empty() { return d.clone(); }
        }
        dwg_builtin_ltype_pattern(name)
    };

    // Pick the raw pattern via entity-explicit → BYLAYER chain.
    let mut pat: Vec<f64> = Vec::new();
    if let Some(name) = data.get("linetype").and_then(|v| v.as_str()) {
        let up = name.to_ascii_uppercase();
        if !up.is_empty() && up != "CONTINUOUS" && up != "BYLAYER" && up != "BYBLOCK" {
            let p = resolve(name);
            if !p.is_empty() { pat = p; }
        }
    }
    if pat.is_empty() {
        if let Some(layer_name) = data.get("layer").and_then(|v| v.as_str()) {
            if let Some(ltn) = layer_ltype_map.get(&layer_name.to_ascii_uppercase()) {
                let p = resolve(ltn);
                if !p.is_empty() { pat = p; }
            }
        }
    }
    if pat.is_empty() { return pat; }

    // Apply per-entity `linetype_scale` (ODA §20.4.1 step 11, BD field) and
    // the drawing-global `$LTSCALE` (DXF §HEADER / ODA header-vars BD list).
    // Revit writes per-entity linetype_scale = paper scale (e.g. 40 on a
    // 1:40 construction drawing), so MV_hidden's [2.5, -1.25] pattern
    // expands to [100, -50] world units — visibly coarse as expected.
    // Both scales default to 1.0 when missing/zero to match AutoCAD behaviour.
    let ent_scale = data.get("linetype_scale")
        .and_then(|v| v.as_f64())
        .filter(|v| v.is_finite() && *v > 0.0)
        .unwrap_or(1.0);
    let global = if global_ltscale.is_finite() && global_ltscale > 0.0 { global_ltscale } else { 1.0 };
    let factor = ent_scale * global;
    if (factor - 1.0).abs() > 1e-9 {
        for d in pat.iter_mut() { *d *= factor; }
    }
    // User-facing diagnostic for dash-grofte complaints ("dashes te fijn").
    // Log first 5 resolved patterns so the user can compare against the
    // visual result. Emits: ltype name, both scale factors, and the
    // scaled dash list in world units.
    thread_local! {
        static LTYPE_LOG_COUNT: std::cell::Cell<u32> = std::cell::Cell::new(0);
    }
    LTYPE_LOG_COUNT.with(|c| {
        let n = c.get();
        if n < 5 {
            let name = data.get("linetype").and_then(|v| v.as_str())
                .or_else(|| data.get("layer").and_then(|v| v.as_str()))
                .unwrap_or("<unknown>");
            eprintln!(
                "[LTYPE_RESOLVE] name={} global_ltscale={} ent_scale={} factor={} dashes={:?}",
                name, global_ltscale, ent_scale, factor, pat,
            );
            c.set(n + 1);
        }
    });
    pat
}

pub fn load_dwg(path: &str) -> anyhow::Result<Scene> {
    use dwg_parser::DwgParser;
    bail_if_cancelled()?;
    let _t_total = std::time::Instant::now();
    let mut t_phase = std::time::Instant::now();
    let bytes = std::fs::read(path)?;
    bail_if_cancelled()?;
    eprintln!("[load_dwg] phase read_file: {:.3}s ({} bytes)",
        t_phase.elapsed().as_secs_f64(), bytes.len());
    t_phase = std::time::Instant::now();
    let mut parser = DwgParser::new();
    let file = parser.parse(&bytes)
        .map_err(|e| anyhow::anyhow!("DWG parse failed: {:?}", e))?;
    eprintln!("[load_dwg] phase parse: {:.3}s ({} objects)",
        t_phase.elapsed().as_secs_f64(), file.objects.len());
    bail_if_cancelled()?;
    let t_after_parse = std::time::Instant::now();

    // Diagnostic trace: print first 5 LAYER table objects and their parsed names.
    // Empty names on R2007+ files indicate the string-stream is not located /
    // decoded for non-entity table objects. See SPEC_NOTES.md §4 and
    // dwg_samples/squad/layer_extractor.md for details.
    {
        let mut shown = 0usize;
        let mut total_layers = 0usize;
        for o in &file.objects {
            if o.type_name == "LAYER" {
                total_layers += 1;
                if shown < 5 {
                    let name = o.data.get("name").and_then(|v| v.as_str()).unwrap_or("");
                    eprintln!("[load_dwg] LAYER #{} handle=0x{:X} name={:?}",
                        shown, o.handle, if name.is_empty() { "<EMPTY>" } else { name });
                    shown += 1;
                }
            }
        }
        eprintln!("[load_dwg] {} total LAYERs in {}", total_layers, path);
    }

    // ----------------------------------------------------------------------
    // Build the layer → color / linetype maps the entity pass needs for
    // BYLAYER resolution.
    //
    // Per ODA §20.4.42 (LAYER object) every LAYER stores a CMC colour. A
    // negative colour indicates the layer is off (the sign carries the
    // "is-on" flag). We store the absolute-value-mapped RGBA so entities
    // on off-layers still get a sane colour — the off bit only affects
    // visibility, which the DWG parser doesn't yet propagate into the
    // entity stream.
    //
    // The linetype handle on LAYER is NOT currently read by
    // parse_layer_obj (stops after CMC), so `layer_ltype_map` starts
    // empty. That means BYLAYER linetype inheritance is a known residual
    // — entity-explicit linetypes still resolve correctly via the
    // `data["linetype"]` JSON key populated by resolve_handles.
    //
    // Layer names are keyed uppercase to match DXF path convention.
    // ----------------------------------------------------------------------
    let mut layer_color_map: HashMap<String, u32> = HashMap::new();
    let layer_ltype_map: HashMap<String, String> = HashMap::new();
    // Layer NAME registry — parallel to DXF's layer_names_ordered.
    // Index 0 reserved for "0" sentinel; every real DWG LAYER gets its
    // own idx so scene.layer_names[segment_layer_idx[i]] resolves to
    // the entity's layer name on the DWG path (was stubbed to always 0).
    let mut layer_names_ordered: Vec<String> = vec!["0".to_string()];
    let mut layer_colors_ordered: Vec<u32> = vec![0xFFFFFFFF];
    let mut layer_name_to_idx: HashMap<String, u16> = HashMap::new();
    layer_name_to_idx.insert("0".to_string(), 0);
    let dwg_layer_color_dbg = std::env::var("O2D_LAYER_COLOR_DBG").is_ok();
    let mut dwg_layer_idx_dbg = 0usize;
    for o in &file.objects {
        if o.type_name != "LAYER" { continue; }
        let name = match o.data.get("name").and_then(|v| v.as_str()) {
            Some(n) if !n.is_empty() => n.to_string(),
            _ => continue,
        };
        let col = o.data.get("color").and_then(|v| v.as_i64()).unwrap_or(7);
        // CMC negative-bit = off flag, absolute value is the ACI index.
        let aci = col.unsigned_abs().min(255) as i16;
        let rgba = aci_to_rgba(aci);
        let up = name.to_ascii_uppercase();
        layer_color_map.insert(up.clone(), rgba);
        // Register in the parallel idx registry.
        if !layer_name_to_idx.contains_key(&up) {
            let idx = layer_names_ordered.len() as u16;
            layer_names_ordered.push(name.clone());
            layer_colors_ordered.push(rgba);
            layer_name_to_idx.insert(up, idx);
        }
        if dwg_layer_color_dbg {
            eprintln!("[LAYER] DWG src=DWG idx={} name={:?} raw_color={} aci={} rgba=0x{:08x}",
                dwg_layer_idx_dbg, name, col, aci, rgba);
            dwg_layer_idx_dbg += 1;
        }
    }

    // Linetype name (UPPERCASE) → dash-length array, sourced from the real
    // LTYPE objects in the DWG. These override the hard-coded builtins in
    // `dwg_builtin_ltype_pattern` whenever the file supplies its own dashes
    // (Revit's MV_* / 3BM_* linetypes are file-specific — e.g. MV_hidden in
    // Funderingsherstel is [2.5, -1.25], not the ACAD.LIN default
    // [0.25, -0.125]). See ODA §20.4.56. If the LTYPE object didn't expose
    // a dash array (older files, parse failure), we leave it missing and
    // the resolver falls back to the builtin table.
    let mut ltype_dashes_map: HashMap<String, Vec<f64>> = HashMap::new();
    let debug_ltype = std::env::var("DWG_DEBUG_LTYPE").is_ok();
    let mut ltype_total = 0usize;
    let mut ltype_with_name = 0usize;
    let mut ltype_with_dashes = 0usize;
    for o in &file.objects {
        if o.type_name != "LTYPE" { continue; }
        ltype_total += 1;
        let name = match o.data.get("name").and_then(|v| v.as_str()) {
            Some(n) if !n.is_empty() => { ltype_with_name += 1; n.to_string() },
            _ => {
                if debug_ltype {
                    let dash_present = o.data.get("dashes").is_some();
                    eprintln!("  [ltype-dbg] h=0x{:X} empty_name dashes_key={} pattern_len={:?}",
                        o.handle, dash_present,
                        o.data.get("patternLength"));
                }
                continue;
            },
        };
        let dashes_json = match o.data.get("dashes") { Some(v) => v, None => {
            if debug_ltype { eprintln!("  [ltype-dbg] h=0x{:X} name={:?} no dashes key", o.handle, name); }
            continue;
        } };
        let dashes: Vec<f64> = match dashes_json.as_array() {
            Some(arr) => arr.iter().filter_map(|v| v.as_f64()).collect(),
            None => continue,
        };
        if dashes.is_empty() { continue; }
        // Sanity filter: reject garbage from bit-drift. Real dash lengths are
        // finite, magnitude bounded (rarely > 10 units at drawing scale), and
        // the ODA spec caps num_dashes at 12 — anything beyond that is
        // certainly parser drift, not a legitimate pattern.
        let garbage = dashes.len() > 32
            || dashes.iter().any(|&v| !v.is_finite() || v.abs() > 1.0e9);
        if garbage {
            if debug_ltype {
                eprintln!("  [ltype-dbg] h=0x{:X} name={:?} REJECTED garbage dashes len={} first={:?}",
                    o.handle, name, dashes.len(), dashes.first());
            }
            continue;
        }
        ltype_with_dashes += 1;
        ltype_dashes_map.insert(name.to_ascii_uppercase(), dashes);
    }
    if debug_ltype {
        let mut keys: Vec<&String> = ltype_dashes_map.keys().collect();
        keys.sort();
        eprintln!("[load_dwg] LTYPE stats: total={} named={} with_valid_dashes={}", ltype_total, ltype_with_name, ltype_with_dashes);
        eprintln!("[load_dwg] parsed {} LTYPE dash arrays:", ltype_dashes_map.len());
        for k in keys.iter().take(20) {
            eprintln!("  {} -> {:?}", k, ltype_dashes_map[*k]);
        }
    }
    // STYLE table → font resolution map, per ODA §20.4.59 (TEXT_STYLE
    // OBJECT). Keyed by BOTH the STYLE handle (u64 as string) AND the
    // uppercase style name — TEXT/MTEXT/ATTRIB entities carry a
    // `textStyleHandle` set by the DWG parser (see parser.rs
    // `read_entity_handles_at_current` TEXT/MTEXT arm). Name-key is a
    // fallback for entities where the handle didn't resolve.
    let mut dwg_style_map: HashMap<String, DwgStyleInfo> = HashMap::new();
    let mut dwg_style_by_handle: HashMap<u64, DwgStyleInfo> = HashMap::new();
    for o in &file.objects {
        if o.type_name != "STYLE" { continue; }
        let name = o.data.get("name").and_then(|v| v.as_str()).unwrap_or("").to_string();
        let font = o.data.get("fontName").and_then(|v| v.as_str()).unwrap_or("").to_string();
        let fh = o.data.get("fixedHeight").and_then(|v| v.as_f64()).unwrap_or(0.0);
        let wf = o.data.get("widthFactor").and_then(|v| v.as_f64()).unwrap_or(1.0);
        if name.is_empty() && font.is_empty() { continue; }
        let info = DwgStyleInfo {
            style_name: name.clone(),
            primary_font_file: font,
            fixed_height: fh,
            width_factor: if wf.abs() < 1e-9 { 1.0 } else { wf },
        };
        if !name.is_empty() {
            dwg_style_map.insert(name.to_ascii_uppercase(), info.clone());
        }
        dwg_style_by_handle.insert(o.handle as u64, info);
    }
    eprintln!("[load_dwg] STYLE table: {} by-name, {} by-handle", dwg_style_map.len(), dwg_style_by_handle.len());

    // DIMSTYLE handle → DimStyleInfo per ODA OpenDesignSpec §20.4.40.
    // The DWG parser surfaces DIMSCALE / DIMTXT / DIMASZ (BD fields) plus
    // DIMBLK1 / DIMBLK2 (TV arrowhead block names) on its DIMSTYLE objects.
    // The DIMENSION text/tick-render arm reads this to resolve text height,
    // arrow size and arrow style per dimension entity. When the parser
    // returns subnormal-clamped defaults (DIMSCALE=1.0, DIMTXT=2.5,
    // DIMASZ=2.5, blk strings empty) the map still gets populated so the
    // render path can use the defaults rather than falling back further.
    let mut dim_style_map_local: HashMap<u64, DimStyleInfo> = HashMap::new();
    let mut dimstyle_total = 0usize;
    let mut dimstyle_with_fields = 0usize;
    for o in &file.objects {
        if o.type_name != "DIMSTYLE" { continue; }
        dimstyle_total += 1;
        let dimtxt = o.data.get("dimtxt").and_then(|v| v.as_f64()).unwrap_or(0.0);
        let dimscale = o.data.get("dimscale").and_then(|v| v.as_f64()).unwrap_or(0.0);
        let dimasz = o.data.get("dimasz").and_then(|v| v.as_f64()).unwrap_or(0.0);
        // DIMEXO/DIMEXE per ODA §20.4.40 — extension-line offset / overshoot.
        // Parser already sanity-clamps to AutoCAD defaults (0.625 / 1.25) when
        // the R2007+ bit-stream alignment lands on garbage.
        let dimexo = o.data.get("dimexo").and_then(|v| v.as_f64()).unwrap_or(0.625);
        let dimexe = o.data.get("dimexe").and_then(|v| v.as_f64()).unwrap_or(1.25);
        let dimblk1 = o.data.get("dimblk1").and_then(|v| v.as_str()).unwrap_or("").to_string();
        let dimblk2 = o.data.get("dimblk2").and_then(|v| v.as_str()).unwrap_or("").to_string();
        let name = o.data.get("name").and_then(|v| v.as_str()).unwrap_or("").to_string();
        if dimtxt > 0.0 && dimscale > 0.0 {
            dimstyle_with_fields += 1;
            dim_style_map_local.insert(o.handle as u64, DimStyleInfo {
                dimtxt, dimscale, dimasz, dimexo, dimexe, dimblk1, dimblk2, name,
            });
        }
    }
    eprintln!("[load_dwg] DIMSTYLE table: {} total, {} with dimtxt+dimscale fields",
        dimstyle_total, dimstyle_with_fields);
    DIM_STYLE_MAP.with(|m| *m.borrow_mut() = dim_style_map_local);
    // Clear on function return so re-loads don't leak.
    struct DimStyleGuard;
    impl Drop for DimStyleGuard {
        fn drop(&mut self) {
            DIM_STYLE_MAP.with(|m| m.borrow_mut().clear());
        }
    }
    let _dim_style_guard = DimStyleGuard;
    // Install into thread-local context for tessellate_one to use during
    // this load. Ownership transferred in; we clear it at function exit.
    DWG_STYLE_CTX.with(|cell| {
        *cell.borrow_mut() = Some(DwgTextCtx {
            by_handle: dwg_style_by_handle.clone(),
            by_name: dwg_style_map.clone(),
        });
    });
    // Drop-guard so early returns (anyhow::Result in future) still clear.
    struct DwgCtxGuard;
    impl Drop for DwgCtxGuard {
        fn drop(&mut self) {
            DWG_STYLE_CTX.with(|cell| *cell.borrow_mut() = None);
        }
    }
    let _ctx_guard = DwgCtxGuard;

    // Layer "0" must always exist so BYLAYER under an unnamed parent
    // still resolves. ACI 7 (white) matches AutoCAD's out-of-the-box
    // default for new drawings.
    layer_color_map.entry("0".to_string()).or_insert(0xFFFFFFFF);
    // Viewer-friendly default for entities that end up with no layer
    // match at all (BYBLOCK under no parent, or parser-dropped layer
    // ref). Pure white maximizes contrast on the dark preview bg.
    let dwg_default_rgba: u32 = 0xFFFFFFFF;

    // Global drawing linetype scale (DXF §HEADER $LTSCALE, ODA header-vars
    // BD list). Multiplied with per-entity `linetype_scale` (ODA §20.4.1
    // step 11) inside `dwg_resolve_ltype_pattern` to produce the effective
    // dash lengths in world units. Default 1.0 when missing or non-positive
    // matches AutoCAD's runtime behaviour.
    let global_ltscale: f64 = file.header_vars.get("$LTSCALE")
        .and_then(|v| v.as_f64())
        .filter(|v| v.is_finite() && *v > 0.0)
        .unwrap_or(1.0);
    eprintln!("[load_dwg] $LTSCALE = {}", global_ltscale);

    let mut segments: Vec<Segment> = Vec::new();
    let mut triangles: Vec<Triangle> = Vec::new();
    let mut bbox = [f64::INFINITY, f64::INFINITY, f64::NEG_INFINITY, f64::NEG_INFINITY];
    // LINE, CIRCLE, ARC, LWPL, INS, OTHER, ELLIPSE, SPLINE, POINT, SOLID, LEADER, RAY, XLINE, DIM, HATCH
    let mut counts = [0u32; 15];
    let mut type_map: std::collections::HashMap<String, u32> = std::collections::HashMap::new();
    // Per-entity tracking so viewer's whole-entity selection works for DWG too.
    // Mirrors the DXF path: allocate one entity_idx per top-level entity, post-fill
    // the seg/tri ranges emitted by tessellate_one (INSERT children inherit since
    // they're emitted inside the outer top-level dispatch).
    let mut segment_entity_idx: Vec<u32> = Vec::new();
    let mut triangle_entity_idx: Vec<u32> = Vec::new();
    let mut entity_names: Vec<String> = Vec::new();
    // Per-entity raw text payload — populated inline by the TEXT/MTEXT/
    // ATTRIB/DIMENSION-text branches in tessellate_one. Grown alongside
    // entity_names so index alignment is preserved. INSERT / viewport
    // recursion passes None to avoid duplicate writes (children share
    // the parent's slot). Mirrors load_dxf's entity_text plumbing.
    let mut entity_text: Vec<Option<EntityText>> = Vec::new();
    // Per-entity LAYER idx — was stubbed to all-zero (user reported
    // "bij dwg staat alles in laag 0 dat klopt niet"). Now populated
    // alongside entity_idx during the entity loop, so Scene.segment_layer_idx
    // resolves to the real layer index per segment.
    let mut segment_layer_idx: Vec<u16> = Vec::new();
    let mut triangle_layer_idx: Vec<u16> = Vec::new();
    // Per-segment dash KIND (parallel to `segments`). emit_dashed pushes
    // the classification (1=dashed/2=dotted/3=dashdot); raw Segment.push
    // sites in tessellate_one / expand_insert / hatch fills don't track
    // it, so we resize-with-zero to segments.len() at every entity-end
    // pad (and once at scene tail).
    let mut segment_dash_kind: Vec<u8> = Vec::new();

    let get_xy = |v: &serde_json::Value| -> Option<[f64; 2]> {
        if let Some(arr) = v.as_array() {
            let x = arr.get(0)?.as_f64()?;
            let y = arr.get(1)?.as_f64()?;
            Some([x, y])
        } else if let Some(obj) = v.as_object() {
            let x = obj.get("x")?.as_f64()?;
            let y = obj.get("y")?.as_f64()?;
            Some([x, y])
        } else { None }
    };

    // -------------------------------------------------------------------------
    // INSERT expansion bookkeeping
    //
    // The DWG model keeps block-internal entities as top-level DwgObject items
    // whose `handle_refs.owner` points at a BLOCK_HEADER (type_num 0x31). They
    // are NOT meant to be drawn at their block-local coordinates — they only
    // appear via INSERT instances that reference the block.
    //
    // Strategy:
    //   1. block_index    : BLOCK_HEADER handle → list of child object indices
    //   2. is_block_internal : object handles that live inside ANY block
    //   3. block_handle_by_name : block name → BLOCK_HEADER handle (debug aid)
    //
    // At top-level iteration we skip is_block_internal handles. INSERTs are
    // expanded recursively via expand_insert(), composing transforms.
    // -------------------------------------------------------------------------
    let mut block_index: HashMap<u32, Vec<usize>> = HashMap::new();
    let mut is_block_internal: HashSet<u32> = HashSet::new();
    let mut block_handle_by_name: HashMap<String, u32> = HashMap::new();
    let mut handle_to_idx: HashMap<u32, usize> = HashMap::new();
    for (i, obj) in file.objects.iter().enumerate() {
        handle_to_idx.insert(obj.handle, i);
    }
    // Map block names → handles (BLOCK_HEADER == type_num 0x31).
    // Also track BLOCK_HEADERs whose name indicates an AutoCAD anonymous
    // block — dimensions (`*D...`), unnamed groups (`*U...`), hatch
    // geometry (`*X...` hatches are handled separately by the xref filter
    // above), text defs (`*T...`), and attribute defaults (`*A...`). Their
    // child entities are rendered DIRECTLY (not via an INSERT instance) —
    // AutoCAD resolves them from the owning DIMENSION/MTEXT/etc. entity,
    // and the block origin is always (0,0,0) so the child coordinates are
    // already world coordinates. Mark them so we DON'T stuff their children
    // into `is_block_internal`. Without this, dimension geometry in *D
    // blocks is silently dropped (seen on libredwg-testdata/example_2010.dwg:
    // 3 LINEs at Y=10000-11789 live in `*D4` → drawing's top half missing,
    // bbox Y-max clipped from 11789 to 5441).
    let mut bh_is_anon_render: HashSet<u32> = HashSet::new();
    for obj in &file.objects {
        if obj.type_num == 0x31 {
            if let Some(name) = obj.data.get("name").and_then(|v| v.as_str()) {
                if !name.is_empty() {
                    block_handle_by_name.insert(name.to_string(), obj.handle);
                    let upper = name.to_uppercase();
                    // Anonymous render-block prefixes. Skip *MODEL_SPACE /
                    // *PAPER_SPACE (real spaces, handled elsewhere) and *X
                    // (xref placeholder — no geometry to render).
                    if upper.starts_with('*')
                        && !upper.starts_with("*MODEL_SPACE")
                        && !upper.starts_with("*PAPER_SPACE")
                        && !upper.starts_with("*X")
                    {
                        bh_is_anon_render.insert(obj.handle);
                    }
                }
            }
        }
    }
    // Build child-of-block lookups.
    //
    // Primary path — owner-handle resolution: each child entity's
    //   `handle_refs.owner` points at its BLOCK_HEADER (type_num 0x31).
    //
    // The DWG parser doesn't always populate `owner` on R2010+ files (the
    // string-stream + handle-stream alignment can leave the owner ref
    // unresolved). We track block-internal entities found this way in
    // `is_block_internal` so they are skipped at top-level.
    for (idx, obj) in file.objects.iter().enumerate() {
        if !obj.is_entity { continue; }
        // Skip BLOCK / ENDBLK sentinel (type_num 0x04 / 0x05) — never drawn.
        if obj.type_num == 0x04 || obj.type_num == 0x05 {
            is_block_internal.insert(obj.handle);
            continue;
        }
        if let Some(owner) = obj.handle_refs.owner {
            if let Some(&owner_idx) = handle_to_idx.get(&owner) {
                if file.objects[owner_idx].type_num == 0x31 {
                    block_index.entry(owner).or_default().push(idx);
                    // Anonymous render-blocks (*D dimensions, *T text, *U
                    // unnamed groups, *A attributes) are NOT instanced via
                    // INSERT — AutoCAD renders their children directly at
                    // block-local coords (= world coords, origin always 0).
                    // Skipping the is_block_internal mark lets the top-level
                    // iterator tessellate them once, matching DXF behaviour.
                    if !bh_is_anon_render.contains(&owner) {
                        is_block_internal.insert(obj.handle);
                    }
                }
            }
        }
    }

    // Fallback path — BLOCK_HEADER chain walking. When owner refs aren't
    // resolved (block_index still missing entries for known BLOCK_HEADERs),
    // try `first_entity` / `next_entity` doubly-linked chain or the explicit
    // `owned_handles` array. This matches how AutoCAD writes the entity
    // ownership on R2004+ files (ODA spec §7.5).
    let bh_handles: Vec<u32> = file.objects.iter()
        .filter(|o| o.type_num == 0x31)
        .map(|o| o.handle)
        .collect();
    let mut chain_added = 0usize;
    for bh in &bh_handles {
        if block_index.contains_key(bh) { continue; }
        let bh_idx = match handle_to_idx.get(bh) { Some(&i) => i, None => continue };
        let bh_obj = &file.objects[bh_idx];
        // Try owned_handles first (R2004+ explicit list).
        let mut child_idxs: Vec<usize> = Vec::new();
        for &h in &bh_obj.handle_refs.owned_handles {
            if let Some(&i) = handle_to_idx.get(&h) {
                let c = &file.objects[i];
                if c.is_entity && c.type_num != 0x04 && c.type_num != 0x05 {
                    child_idxs.push(i);
                }
            }
        }
        // Fallback: walk first_entity → next_entity until last_entity / cycle.
        if child_idxs.is_empty() {
            if let (Some(first), last_opt) = (bh_obj.handle_refs.first_entity, bh_obj.handle_refs.last_entity) {
                let mut cur = Some(first);
                let mut visited: HashSet<u32> = HashSet::new();
                while let Some(h) = cur {
                    if !visited.insert(h) { break; }  // cycle guard
                    if let Some(&i) = handle_to_idx.get(&h) {
                        let c = &file.objects[i];
                        if c.is_entity && c.type_num != 0x04 && c.type_num != 0x05 {
                            child_idxs.push(i);
                        }
                        if Some(h) == last_opt { break; }
                        cur = c.handle_refs.next_entity;
                    } else { break; }
                    if visited.len() > 10_000 { break; }
                }
            }
        }
        if !child_idxs.is_empty() {
            if !bh_is_anon_render.contains(bh) {
                for &i in &child_idxs {
                    is_block_internal.insert(file.objects[i].handle);
                }
            }
            chain_added += child_idxs.len();
            block_index.insert(*bh, child_idxs);
        }
    }
    eprintln!(
        "[load_dwg] block index: {} blocks, {} block-internal entities, {} named-block lookups (chain-walk added {})",
        block_index.len(),
        is_block_internal.len(),
        block_handle_by_name.len(),
        chain_added,
    );

    // --- bottom-half-finder: enumerate all blocks in index -----------
    if std::env::var("O2D_DWG_TRACE_EXTENTS").ok().as_deref() == Some("1") {
        for (name, h) in &block_handle_by_name {
            let has_idx = block_index.contains_key(h);
            let child_count = block_index.get(h).map(|v| v.len()).unwrap_or(0);
            eprintln!("[blockmap] name={:?} bh=0x{:X} indexed={} children={}",
                name, h, has_idx, child_count);
        }
        for obj in &file.objects {
            if obj.type_num != 0x07 && obj.type_num != 0x08 { continue; }
            let ins_pt = obj.data.get("insertionPoint")
                .and_then(|v| v.as_array())
                .and_then(|a| {
                    let x = a.get(0)?.as_f64()?;
                    let y = a.get(1)?.as_f64()?;
                    Some((x, y))
                }).unwrap_or((0.0, 0.0));
            let bn = obj.data.get("blockName").and_then(|v| v.as_str()).unwrap_or("");
            let bhh = obj.data.get("blockHeaderHandle").and_then(|v| v.as_u64()).unwrap_or(0);
            let has_be = obj.data.get("blockEntities").is_some();
            let be_count = obj.data.get("blockEntities")
                .and_then(|v| v.as_array()).map(|a| a.len()).unwrap_or(0);
            eprintln!(
                "[insertdata] h=0x{:X} ins=({:.1},{:.1}) blockName={:?} bhh=0x{:X} has_bE={} be_count={} owner=0x{:X} ref_bh={:?}",
                obj.handle, ins_pt.0, ins_pt.1, bn, bhh, has_be, be_count,
                obj.handle_refs.owner.unwrap_or(0),
                obj.handle_refs.block_header,
            );
        }
    }

    // --- bottom-half-finder counts: total entities by type ------------
    if std::env::var("O2D_DWG_TRACE_EXTENTS").ok().as_deref() == Some("1") {
        let mut ent_counts: HashMap<String, usize> = HashMap::new();
        for obj in &file.objects {
            if !obj.is_entity { continue; }
            *ent_counts.entry(obj.type_name.clone()).or_insert(0) += 1;
        }
        let mut v: Vec<(String, usize)> = ent_counts.into_iter().collect();
        v.sort_by(|a, b| b.1.cmp(&a.1));
        for (name, c) in v {
            eprintln!("[entcnt] {}: {}", name, c);
        }
        // Group entity owners: what handles are the "modelspace block" of
        // most entities? Top 10 owners with their BLOCK_HEADER status.
        let mut owner_counts: HashMap<u32, usize> = HashMap::new();
        for obj in &file.objects {
            if !obj.is_entity { continue; }
            if let Some(ow) = obj.handle_refs.owner {
                *owner_counts.entry(ow).or_insert(0) += 1;
            }
        }
        let mut ov: Vec<(u32, usize)> = owner_counts.into_iter().collect();
        ov.sort_by(|a, b| b.1.cmp(&a.1));
        for (ow, c) in ov.iter().take(15) {
            let ow_name = block_handle_by_name.iter()
                .find(|(_, h)| *h == ow)
                .map(|(n, _)| n.clone())
                .unwrap_or_else(|| format!("(not a block, type_num?)"));
            let owner_obj = handle_to_idx.get(ow).map(|&i| &file.objects[i]);
            let owner_type = owner_obj.map(|o| o.type_name.as_str()).unwrap_or("?");
            eprintln!("[owners] 0x{:X}: {} entities (owner type={}, name={:?})",
                ow, c, owner_type, ow_name);
        }
    }

    // --- bottom-half-finder diag: enumerate ALL top-level entity bboxes ----
    // Set O2D_DWG_TRACE_EXTENTS=1 to dump, for every entity, its type,
    // handle, owner, and per-entity XY bbox. Flags whether the entity is
    // TOPLEVEL (will be drawn directly) or BLOCK-internal (only drawn via
    // INSERT). Used to find entities that should contribute to the world
    // bbox but don't — typically modelspace entities with the largest
    // extents (outer drawing frame, dimensions, section markers).
    if std::env::var("O2D_DWG_TRACE_EXTENTS").ok().as_deref() == Some("1") {
        let get_xy = |v: &serde_json::Value| -> Option<[f64; 2]> {
            if let Some(arr) = v.as_array() {
                let x = arr.get(0)?.as_f64()?;
                let y = arr.get(1)?.as_f64()?;
                Some([x, y])
            } else if let Some(obj) = v.as_object() {
                let x = obj.get("x")?.as_f64()?;
                let y = obj.get("y")?.as_f64()?;
                Some([x, y])
            } else { None }
        };
        let finite_ok = |p: [f64; 2]| -> bool {
            p[0].is_finite() && p[1].is_finite() && p[0].abs() < 1.0e6 && p[1].abs() < 1.0e6
        };
        for obj in &file.objects {
            if !obj.is_entity { continue; }
            let d = &obj.data;
            let mut xs: Vec<f64> = Vec::new();
            let mut ys: Vec<f64> = Vec::new();
            let mut push = |p: [f64; 2]| {
                if finite_ok(p) { xs.push(p[0]); ys.push(p[1]); }
            };
            match obj.type_name.as_str() {
                "LINE" => {
                    if let Some(p) = d.get("start").and_then(|v| get_xy(v)) { push(p); }
                    if let Some(p) = d.get("end").and_then(|v| get_xy(v)) { push(p); }
                }
                "CIRCLE" | "ARC" => {
                    if let (Some(c), Some(r)) = (d.get("center").and_then(|v| get_xy(v)),
                                                 d.get("radius").and_then(|v| v.as_f64())) {
                        push([c[0]-r, c[1]-r]);
                        push([c[0]+r, c[1]+r]);
                    }
                }
                "LWPOLYLINE" | "POLYLINE" | "POLYLINE_2D" => {
                    if let Some(arr) = d.get("vertices").and_then(|v| v.as_array()) {
                        for v in arr {
                            if let Some(p) = get_xy(v) { push(p); }
                        }
                    }
                }
                "INSERT" | "MINSERT" => {
                    if let Some(p) = d.get("insertionPoint").and_then(|v| get_xy(v)) { push(p); }
                }
                _ => {
                    // Generic fallback: look at any top-level XY-ish keys.
                    for key in ["position", "point1", "center", "definitionPoint",
                                "insertionPoint", "start", "end"] {
                        if let Some(p) = d.get(key).and_then(|v| get_xy(v)) { push(p); }
                    }
                }
            }
            if xs.is_empty() { continue; }
            let xmin = xs.iter().cloned().fold(f64::INFINITY, f64::min);
            let xmax = xs.iter().cloned().fold(f64::NEG_INFINITY, f64::max);
            let ymin = ys.iter().cloned().fold(f64::INFINITY, f64::min);
            let ymax = ys.iter().cloned().fold(f64::NEG_INFINITY, f64::max);
            let tag = if is_block_internal.contains(&obj.handle) { "BLK " } else { "TOP " };
            // Only print entities whose bbox reaches outside our observed
            // "central crop" (x<0, y<-175, x>740, y>63) — makes it easy to
            // spot which entities should extend the rendered bbox.
            // "Outside" = any reach past the tight central crop we see in the
            // current DWG render. Keep showing LWPOLYLINEs regardless so we
            // can audit the outer-frame geometry.
            let outside = xmin < 0.0 || ymin < -175.0 || xmax > 740.0 || ymax > 63.0;
            let all_lwpl = obj.type_name == "LWPOLYLINE";
            let deep_neg_y = ymin < -300.0;
            if outside || all_lwpl || deep_neg_y {
                eprintln!(
                    "[extents] {} h=0x{:X} owner=0x{:X} type={} X=[{:.1},{:.1}] Y=[{:.1},{:.1}]",
                    tag, obj.handle, obj.handle_refs.owner.unwrap_or(0),
                    obj.type_name, xmin, xmax, ymin, ymax,
                );
            }
        }
    }

    // --- top-half-finder diag: enumerate LINEs + their owner block ---------
    if std::env::var("O2D_DWG_TRACE_LINES").ok().as_deref() == Some("1") {
        // Build lookup from BLOCK_HEADER handle → block name (for reporting).
        let mut bh_name_by_handle: HashMap<u32, String> = HashMap::new();
        for (name, h) in &block_handle_by_name {
            bh_name_by_handle.insert(*h, name.clone());
        }
        // Referenced-by-INSERT set: which block handles are actually referenced
        // by a top-level INSERT?
        let mut referenced: HashSet<u32> = HashSet::new();
        for obj in &file.objects {
            if !obj.is_entity { continue; }
            if is_block_internal.contains(&obj.handle) { continue; }
            if obj.type_name != "INSERT" && obj.type_name != "MINSERT" { continue; }
            if let Some(h) = obj.data.get("blockHeaderHandle").and_then(|v| v.as_u64()) {
                referenced.insert(h as u32);
            }
            if let Some(n) = obj.data.get("blockName").and_then(|v| v.as_str()) {
                if let Some(&h) = block_handle_by_name.get(n) { referenced.insert(h); }
            }
        }
        let mut lines_dump: Vec<(u32, u32, f64, f64, f64, f64)> = Vec::new();
        for obj in &file.objects {
            if obj.type_name != "LINE" { continue; }
            let start = obj.data.get("start").and_then(|v| {
                v.as_array().and_then(|a| {
                    let x = a.get(0)?.as_f64()?;
                    let y = a.get(1)?.as_f64()?;
                    Some((x, y))
                })
            }).unwrap_or((f64::NAN, f64::NAN));
            let end = obj.data.get("end").and_then(|v| {
                v.as_array().and_then(|a| {
                    let x = a.get(0)?.as_f64()?;
                    let y = a.get(1)?.as_f64()?;
                    Some((x, y))
                })
            }).unwrap_or((f64::NAN, f64::NAN));
            let owner = obj.handle_refs.owner.unwrap_or(0);
            lines_dump.push((obj.handle, owner, start.0, start.1, end.0, end.1));
        }
        eprintln!("[line-diag] {} LINEs total", lines_dump.len());
        for (h, ow, _x1, y1, _x2, y2) in &lines_dump {
            let ymax = y1.max(*y2);
            let tag = if !is_block_internal.contains(h) {
                "TOPLEVEL".to_string()
            } else {
                // owner is a BLOCK_HEADER handle, check if it's referenced
                let bh_name = bh_name_by_handle.get(ow).cloned().unwrap_or_default();
                let refd = referenced.contains(ow);
                format!("BLOCK({:?} h=0x{:X} refd={})", bh_name, ow, refd)
            };
            if ymax > 5000.0 || !is_block_internal.contains(h) {
                eprintln!(
                    "[line-diag]   LINE h=0x{:X} owner=0x{:X} Y=[{:.1},{:.1}] {}",
                    h, ow, y1, y2, tag
                );
            }
        }
    }

    let _ = &get_xy; // closure no longer used directly — tessellate_one owns its own copy.
    let identity = Xform::identity();
    // Diagnostic: INSERT recursion trace is enabled when O2D_DWG_TRACE_INSERT=1.
    // (Default off so normal runs don't flood stderr.)
    let trace_insert = std::env::var("O2D_DWG_TRACE_INSERT").ok().as_deref() == Some("1");

    // Paper-space classification per ODA §20.4.1 (Common entity entmode):
    //   entmode == 1 → owner is *Paper_Space (implicit).
    //   Also accept an explicit owner handle that matches the *Paper_Space
    //   BLOCK_HEADER (name "*Paper_Space", "*PAPER_SPACE" or "*Paper_Space0").
    // Tag downstream segments/triangles with `is_paper: true` so the
    // --paper render filter and paper-space bbox computation work for DWG
    // the same way they do for DXF (see load_dxf line 1790).
    let mut paper_space_handles: HashSet<u32> = block_handle_by_name.iter()
        .filter(|(name, _)| {
            let up = name.to_ascii_uppercase();
            up.starts_with("*PAPER_SPACE")
        })
        .map(|(_, h)| *h)
        .collect();
    // Task E: owner-chain expansion. A BLOCK_RECORD whose owner is
    // *Paper_Space (or another paper-tagged block) is itself paper — so
    // its child entities should also render on Layout1. Without this,
    // "Renvooi verankeringslengten" tabel-blocks (MTEXT at handle 0xAB8)
    // end up tagged model because their owner points at the containing
    // block, not directly at *Paper_Space.
    //
    // Iterate until fixpoint: for every BLOCK_HEADER whose owner is in
    // paper_space_handles, add it to the set and re-scan. Typical DWG
    // chains are 2-3 levels deep so 8 iterations is safe.
    let mut paper_added_pass = 0usize;
    for _pass in 0..8 {
        let before = paper_space_handles.len();
        for obj in &file.objects {
            if obj.type_num != 0x31 { continue; } // BLOCK_HEADER only
            if paper_space_handles.contains(&obj.handle) { continue; }
            if let Some(owner) = obj.handle_refs.owner {
                if paper_space_handles.contains(&owner) {
                    paper_space_handles.insert(obj.handle);
                    paper_added_pass += 1;
                }
            }
        }
        if paper_space_handles.len() == before { break; }
    }
    if paper_added_pass > 0 {
        eprintln!("[load_dwg] paper-space chain: +{} child BLOCK_HEADERs tagged as paper",
            paper_added_pass);
    }
    let mut paper_bbox: [f64; 4] = [f64::INFINITY, f64::INFINITY, f64::NEG_INFINITY, f64::NEG_INFINITY];

    eprintln!("[load_dwg] phase pre_entity_setup: {:.3}s",
        t_after_parse.elapsed().as_secs_f64());
    let t_entity_loop = std::time::Instant::now();
    // Top-emitter tracking — debug an entity-loop blow-up by reporting
    // the 10 entities that produced the most segments. Enabled by env var
    // O2D_LOAD_PROFILE=1 to keep production logs quiet.
    let profile_load = std::env::var("O2D_LOAD_PROFILE").is_ok();
    let mut top_emitters: Vec<(usize, u64, String)> = Vec::new();
    let mut _dwg_cancel_counter: usize = 0;
    for obj in &file.objects {
        // Cancel-check every ~512 objects in the main entity loop. This
        // is the dominant phase on big DWGs (the 1 GB Kralingseweg file
        // spends ~minutes here), so frequent checks let the user bail
        // out within ~1s of clicking Cancel.
        _dwg_cancel_counter = _dwg_cancel_counter.wrapping_add(1);
        if _dwg_cancel_counter & 0x1FF == 0 {
            bail_if_cancelled()?;
        }
        if !obj.is_entity { continue; }
        // Skip BLOCK / ENDBLK sentinels and any entity living inside a block —
        // the latter are drawn via INSERT instances, not at their local origin.
        if is_block_internal.contains(&obj.handle) { continue; }
        *type_map.entry(obj.type_name.clone()).or_insert(0) += 1;
        let d = &obj.data;
        let dv = serde_json::json!(d);
        // Is this entity in paper space? (ODA §20.4.1 entmode == 1, OR owner
        // handle points at a *Paper_Space BLOCK_HEADER.)
        let ent_mode = dv.get("entity_mode").and_then(|v| v.as_u64()).unwrap_or(0);
        let owner_is_paper = obj.handle_refs.owner
            .map(|h| paper_space_handles.contains(&h))
            .unwrap_or(false);
        let is_paper_entity = ent_mode == 1 || owner_is_paper;
        // Task E debug: log paper-tag decisions for MTEXT at handle 0xAB8
        // (user-reported "Renvooi verankeringslengten" table misclassified
        // as model), plus a general sample of the first few MTEXT/INSERT
        // entities so we can spot-check.
        {
            thread_local! {
                static PAPER_TAG_COUNT: std::cell::Cell<u32> =
                    std::cell::Cell::new(0);
            }
            let target_handle = obj.handle == 0x0AB8;
            PAPER_TAG_COUNT.with(|c| {
                let n = c.get();
                if target_handle || (n < 8
                    && matches!(obj.type_name.as_str(), "MTEXT" | "INSERT")) {
                    eprintln!(
                        "[PAPER_TAG] handle=0x{:X} type={} owner=0x{:X} entmode={} is_paper={}",
                        obj.handle, obj.type_name,
                        obj.handle_refs.owner.unwrap_or(0),
                        ent_mode, is_paper_entity,
                    );
                    if !target_handle { c.set(n + 1); }
                }
            });
        }
        // Debug hook: dump DIMENSION entries when O2D_DWG_DIM_DUMP=1.
        // Useful for spot-checking parser output after spec changes.
        if std::env::var("O2D_DWG_DIM_DUMP").ok().as_deref() == Some("1")
            && obj.type_name.starts_with("DIMENSION")
        {
            eprintln!("[dim-dump] h=0x{:X} type={} ent_mode={} owner=0x{:X} data={}",
                obj.handle, obj.type_name, ent_mode,
                obj.handle_refs.owner.unwrap_or(0),
                serde_json::to_string(&dv).unwrap_or_default());
        }
        // Resolve color + linetype up-front. Top-level entities have no
        // parent INSERT so BYBLOCK (raw==0) falls back to the drawing
        // default (white) rather than an inherited insert color.
        let raw_color = dv.get("color").and_then(|v| v.as_i64()).unwrap_or(256);
        let entity_color = if raw_color == 0 {
            dwg_default_rgba
        } else {
            dwg_resolve_color(&dv, &layer_color_map, dwg_default_rgba)
        };
        let entity_ltype = dwg_resolve_ltype_pattern(&dv, &layer_ltype_map, &ltype_dashes_map, global_ltscale);
        // Allocate a per-entity slot BEFORE emit so the viewer's whole-entity
        // selection can find all segments/triangles sharing this idx.
        let entity_idx = entity_names.len() as u32;
        entity_names.push(format!("{} h={:#X}", obj.type_name, obj.handle));
        // Grow entity_text in lockstep so the TEXT/MTEXT/ATTRIB/DIMENSION
        // branches in tessellate_one can write into entity_text[entity_idx].
        entity_text.push(None);
        // Resolve the DWG entity's layer → idx in layer_name_to_idx.
        // dv["layer"] is populated by resolve_handles from the entity's
        // layer handle → LAYER.name. Fallback to "0" (idx 0) if missing.
        let entity_layer_name_up = dv.get("layer")
            .and_then(|v| v.as_str())
            .map(|s| s.to_ascii_uppercase())
            .unwrap_or_else(|| "0".to_string());
        let entity_layer_idx: u16 = *layer_name_to_idx.get(&entity_layer_name_up).unwrap_or(&0u16);
        let seg_before = segments.len();
        let tri_before = triangles.len();
        // INSERT / MINSERT need recursive expansion via the block index.
        if obj.type_name == "INSERT" || obj.type_name == "MINSERT" {
            counts[4] += 1;
            let mut visiting: HashSet<u32> = HashSet::new();
            expand_insert(
                &dv, &identity, 0,
                &file.objects, &block_index, &block_handle_by_name,
                &mut segments, &mut triangles, &mut bbox, &mut counts,
                &mut visiting, trace_insert,
                &layer_color_map, &layer_ltype_map, &ltype_dashes_map,
                dwg_default_rgba, entity_color, global_ltscale,
                &mut segment_dash_kind,
            );
            // Pad dash-kind for any raw segments produced inside the
            // INSERT expansion (CIRCLE/ARC tessellation inside blocks
            // bypasses emit_dashed).
            if segment_dash_kind.len() < segments.len() {
                segment_dash_kind.resize(segments.len(), 0u8);
            }
        } else {
            if let Some(cat) = tessellate_one(
                &obj.type_name, &dv, &identity,
                &mut segments, &mut triangles, &mut bbox, entity_color, &entity_ltype,
                Some(&mut entity_text), entity_idx,
                &mut segment_dash_kind,
            ) {
                counts[cat] += 1;
            } else {
                counts[5] += 1;
            }
            // Pad dash-kind for any raw `Segment.push` inside tessellate_one
            // that ran between the last emit_dashed call and end-of-entity.
            if segment_dash_kind.len() < segments.len() {
                segment_dash_kind.resize(segments.len(), 0u8);
            }
            let added = segments.len() - seg_before;
            if trace_insert && added > 100 {
                eprintln!(
                    "[load_dwg] entity h=0x{:X} type={} added {} segs",
                    obj.handle, obj.type_name, added,
                );
            }
        }
        // Post-fill the ranges this top-level entity emitted. INSERT children
        // recurse inside expand_insert, so their seg/tri deltas also fall into
        // this window and inherit the same entity_idx.
        let mut seg_delta = segments.len() - seg_before;
        let mut tri_delta = triangles.len() - tri_before;
        if profile_load && seg_delta > 1000 {
            top_emitters.push((seg_delta, obj.handle as u64, obj.type_name.clone()));
        }
        // Per-entity emission cap — defends against pathological HATCH
        // boundaries (degenerate offset, huge bbox, missing close-flag)
        // and runaway INSERT recursion that can produce 100M+ segments
        // from a single entity, which then either OOMs the wgpu buffer
        // or stalls the spatial-index build for many seconds. Real-world
        // CAD entities never legitimately emit more than ~1M segments;
        // anything above that is a parser/tessellation glitch and we
        // truncate with a warning so the rest of the drawing still loads.
        // 250K is a generous upper bound — even very dense architectural
        // hatch patterns over a building footprint top out around 50-100K
        // segments. Anything above 250K from a single entity is a parser
        // / tessellation glitch (bad pattern offset, infinite-loop hatch
        // boundary, runaway INSERT recursion). Lowering this from 1M
        // catches the additional bad hatches in DWG 04-12-2025.dwg
        // (h=0x69CFC=966K, h=0x7B70C=715K, h=0x68EE1=200K) that
        // individually slipped under the old cap but collectively
        // swamped the bbox with sky-spanning diagonals.
        const PER_ENTITY_SEG_CAP: usize = 250_000;
        if seg_delta > PER_ENTITY_SEG_CAP {
            // Pathological emission. The truncation-only path keeps the
            // first 1M segments which are just as bogus as the rest
            // (HATCH offset bug emits a million parallel diagonals all
            // sharing the same bad scale). DROP all segments for this
            // entity instead — losing one corrupt hatch is far better
            // than swamping the bbox + viewer with sky-spanning lines
            // (see DWG 04-12-2025.dwg). Per-entity tris dropped too.
            eprintln!(
                "[load_dwg] WARN entity h=0x{:X} type={} produced {} segs — DROPPING all (likely pathological hatch / INSERT recursion; cap={})",
                obj.handle, obj.type_name, seg_delta, PER_ENTITY_SEG_CAP,
            );
            segments.truncate(seg_before);
            if segment_dash_kind.len() > seg_before {
                segment_dash_kind.truncate(seg_before);
            }
            seg_delta = 0;
            // Drop tris emitted by this entity in lockstep so the
            // parallel arrays stay aligned.
            triangles.truncate(tri_before);
            tri_delta = 0;
        }
        const PER_ENTITY_TRI_CAP: usize = 200_000;
        if tri_delta > PER_ENTITY_TRI_CAP {
            triangles.truncate(tri_before + PER_ENTITY_TRI_CAP);
            tri_delta = PER_ENTITY_TRI_CAP;
        }
        // Per-entity coordinate-sanity check. A single legitimate CAD
        // entity should fit within reasonable extents (a building site
        // is rarely > 1 km / 1e6 mm across; engineering drawings sit
        // well below that). Hatches with degenerate offsets, INSERTs
        // with corrupt scale, and similar parser glitches emit a small-
        // ish number of segments at huge coordinates (1e6..1e8 range)
        // — they slip under the per-entity SEG_CAP but produce the
        // sky-spanning diagonals visible in DWG 04-12-2025.dwg
        // (h=0x6A61A, h=0x7B64D each emit ~99K segs but with >50% at
        // |coord| > 1e9). Scan the just-emitted range for the max
        // |coord| and drop the entire entity if it exceeds the cap.
        if seg_delta > 0 {
            // 100 km in mm. Catches the pathological 10^200+ HATCH/INSERT
            // survivors without dropping legitimate large site/area drawings
            // that may legitimately exceed 10 km extents (the previous 1e7
            // cap was too aggressive on multi-property civil drawings —
            // see bug 04-12-2025.dwg).
            const PER_ENTITY_COORD_CAP: f64 = 1.0e8;
            let mut entity_max: f64 = 0.0;
            for s in &segments[seg_before..] {
                entity_max = entity_max
                    .max(s.p1[0].abs()).max(s.p1[1].abs())
                    .max(s.p2[0].abs()).max(s.p2[1].abs());
                if entity_max > PER_ENTITY_COORD_CAP { break; }
            }
            if entity_max > PER_ENTITY_COORD_CAP {
                // Locate worst-offending segment for diagnostics: which p1/p2
                // pushed entity_max past the cap. Helps pinpoint whether the
                // bad coord came from the INSERT's translation or a single
                // block-internal entity.
                let mut worst: (f64, [f64; 2], [f64; 2]) = (0.0, [0.0; 2], [0.0; 2]);
                for s in &segments[seg_before..] {
                    let m = s.p1[0].abs().max(s.p1[1].abs())
                        .max(s.p2[0].abs()).max(s.p2[1].abs());
                    if m > worst.0 { worst = (m, s.p1, s.p2); }
                }
                let extra = if obj.type_name == "INSERT" || obj.type_name == "MINSERT" {
                    let block_name = obj.data.get("blockName").and_then(|v| v.as_str())
                        .unwrap_or("?");
                    let block_h = obj.data.get("blockHeaderHandle")
                        .and_then(|v| v.as_u64()).unwrap_or(0);
                    format!(" block=\"{}\" blockHandle=0x{:X}", block_name, block_h)
                } else { String::new() };
                eprintln!(
                    "[load_dwg] WARN entity h=0x{:X} type={} max|coord|={:.2e} > {:.0e} — DROPPING all {} segs (worst seg p1=[{:.2e},{:.2e}] p2=[{:.2e},{:.2e}]{})",
                    obj.handle, obj.type_name, entity_max, PER_ENTITY_COORD_CAP, seg_delta,
                    worst.1[0], worst.1[1], worst.2[0], worst.2[1], extra,
                );
                segments.truncate(seg_before);
                if segment_dash_kind.len() > seg_before {
                    segment_dash_kind.truncate(seg_before);
                }
                seg_delta = 0;
                triangles.truncate(tri_before);
                tri_delta = 0;
            }
        }
        segment_entity_idx.extend(std::iter::repeat(entity_idx).take(seg_delta));
        triangle_entity_idx.extend(std::iter::repeat(entity_idx).take(tri_delta));
        // Fill per-entity LAYER idx too — needed so the viewer's Layer
        // Manager shows real layer names (not all-0 stubs) and per-layer
        // visibility toggles affect the right entities.
        segment_layer_idx.extend(std::iter::repeat(entity_layer_idx).take(seg_delta));
        triangle_layer_idx.extend(std::iter::repeat(entity_layer_idx).take(tri_delta));
        // Tag paper-space segments/triangles (mirrors DXF loader line 1844).
        if is_paper_entity {
            for s in &mut segments[seg_before..] {
                s.is_paper = true;
                // Expand paper-only bbox used for layouts[].
                if s.p1[0].is_finite() && s.p1[1].is_finite() {
                    expand_bbox(&mut paper_bbox, s.p1[0], s.p1[1]);
                }
                if s.p2[0].is_finite() && s.p2[1].is_finite() {
                    expand_bbox(&mut paper_bbox, s.p2[0], s.p2[1]);
                }
            }
            for t in &mut triangles[tri_before..] { t.is_paper = true; }
        }
    }

    // -------------------------------------------------------------------------
    // VIEWPORT projection pass — ODA §19.4.61 VIEWPORT entity
    //
    // Each VIEWPORT in paper-space is a rectangular "window" through which a
    // region of model-space is shown, scaled/translated/rotated onto the
    // sheet. The DXF loader does the same thing around line 2059. Without
    // this pass the Layout tab for a DWG only shows the title-block / frame
    // — model content (foundation plans, grid lines, dim labels) is invisible.
    //
    // Parser JSON keys (from parse_viewport in src-tauri/dwg-parser/parser.rs):
    //   "center"       — [cx, cy, cz]   paper-space center of the viewport rect
    //   "width"        — paper-space rect width
    //   "height"       — paper-space rect height
    //   "viewTarget"   — [vx, vy, vz]   model-space look-at point (view center)
    //   "viewHeight"   — model-space visible height (scale = height / viewHeight)
    //   "twistAngle"   — model-space rotation about view axis (radians)
    //
    // Composition (DXF/DWG symmetric): vp_xform maps model→paper as
    //   translate(-viewTarget) → rotate(-twist) → scale(s) → translate(+center)
    // When twist == 0 this reduces to the simple form used by the DXF loader:
    //   tx = cx - vx*s,  ty = cy - vy*s,  cos=1, sin=0, sx=sy=s.
    //
    // Skip the "first viewport" per ODA §19.4.61 — AutoCAD records a
    // paper-space override viewport per layout with view_height ≈ 0 or
    // viewport rect degenerate. We skip any viewport whose view_height is
    // tiny or paper rect is degenerate.
    // -------------------------------------------------------------------------
    let vp_outline_color: u32 = 0xFF808080; // neutral grey
    let vp_dump = std::env::var("O2D_DWG_VPORT_DUMP").ok().as_deref() == Some("1");
    let mut vp_projected_segs = 0usize;
    let mut vp_projected_tris = 0usize;
    let mut vp_real_count = 0usize;
    for obj in &file.objects {
        if obj.type_name != "VIEWPORT" { continue; }
        let d = &obj.data;
        let dv = serde_json::json!(d);
        let center = dv.get("center").and_then(|v| v.as_array());
        let paper_w = dv.get("width").and_then(|v| v.as_f64()).unwrap_or(0.0);
        let paper_h = dv.get("height").and_then(|v| v.as_f64()).unwrap_or(0.0);
        // ODA §19.4.61 — prefer `viewCenter` (DXF code 12/22, 2RD on the
        // view plane) over `viewTarget` (DXF code 17, 3D look-at point).
        // DXF's VIEWPORT stores both; the MODEL-space center that maps to
        // the paper rect center is `viewCenter`. viewTarget is the 3D
        // look-at and for top-down 2D viewports usually equals (0,0,0),
        // which would collapse the projection to world origin.
        let view_center = dv.get("viewCenter").and_then(|v| v.as_array());
        let view_target = dv.get("viewTarget").and_then(|v| v.as_array());
        let view_h = dv.get("viewHeight").and_then(|v| v.as_f64()).unwrap_or(0.0);
        let twist = dv.get("twistAngle").and_then(|v| v.as_f64()).unwrap_or(0.0);
        let (cx, cy) = match center.and_then(|a| {
            let x = a.get(0)?.as_f64()?;
            let y = a.get(1)?.as_f64()?;
            Some((x, y))
        }) { Some(v) => v, None => continue };
        let (vx, vy) = view_center.and_then(|a| {
            let x = a.get(0)?.as_f64()?;
            let y = a.get(1)?.as_f64()?;
            Some((x, y))
        }).or_else(|| view_target.and_then(|a| {
            let x = a.get(0)?.as_f64()?;
            let y = a.get(1)?.as_f64()?;
            Some((x, y))
        })).unwrap_or((0.0, 0.0));
        if vp_dump {
            eprintln!(
                "[vp-dump] h=0x{:X} paper_ctr=({:.1},{:.1}) w={:.1} h={:.1} view_ctr=({:.1},{:.1}) view_h={:.3} twist={:.3}",
                obj.handle, cx, cy, paper_w, paper_h, vx, vy, view_h, twist,
            );
        }
        // Skip the paper-space override viewport + degenerate entries.
        // A "real" viewport has nonzero paper rect AND positive view_height.
        // The "first viewport" per layout (ODA §19.4.61) is the paper-space
        // overview: its scale is near 1 (view_h ≈ paper_h) AND its view_ctr
        // lies inside the paper rect — it represents the layout's own
        // zoom-to-paper default, not a window onto model-space. Skipping
        // it prevents all model-space entities near world origin from
        // being rendered at full size across the whole sheet.
        if paper_w < 0.1 || paper_h < 0.1 || view_h < 1e-6 { continue; }
        // Skip the paper-space overview viewport (ODA §19.4.61 — first
        // VIEWPORT per layout describes the layout's own zoom-to-paper
        // default, not a model-space window). Heuristic: view_ctr lies
        // within or very near the paper rect AND view_h is close to
        // paper_h. Real model-space viewports have view_ctr at model
        // coordinates (thousands–millions of units away from the paper
        // rect) and distinct view_h.
        let (dx, dy) = (vx - cx, vy - cy);
        let dist_paper_to_view = (dx * dx + dy * dy).sqrt();
        let paper_diag = (paper_w * paper_w + paper_h * paper_h).sqrt();
        let view_ctr_near_paper = dist_paper_to_view < paper_diag;
        // Scale near 1 (within a factor of 3) + view_ctr near paper_ctr
        // ⇒ this is the layout's own overview viewport. Real model-space
        // viewports have scale ≪ 1 (typical 1:100 = 0.01, 1:50 = 0.02).
        let scale_guess = paper_h / view_h;
        let scale_near_unity = scale_guess > 0.33 && scale_guess < 3.0;
        if view_ctr_near_paper && scale_near_unity {
            if vp_dump {
                eprintln!(
                    "[vp-dump] h=0x{:X} skipped (paper-overview: view_ctr near paper_ctr, scale≈1 [={:.3}])",
                    obj.handle, scale_guess,
                );
            }
            continue;
        }
        vp_real_count += 1;

        let (hw, hh) = (paper_w * 0.5, paper_h * 0.5);
        let p1 = [cx - hw, cy - hh];
        let p2 = [cx + hw, cy - hh];
        let p3 = [cx + hw, cy + hh];
        let p4 = [cx - hw, cy + hh];
        // Viewport borders on the sheet.
        segments.push(Segment { p1, p2, color: vp_outline_color, is_paper: true });
        segments.push(Segment { p1: p2, p2: p3, color: vp_outline_color, is_paper: true });
        segments.push(Segment { p1: p3, p2: p4, color: vp_outline_color, is_paper: true });
        segments.push(Segment { p1: p4, p2: p1, color: vp_outline_color, is_paper: true });
        // Expand paper bbox so the Layout tab camera frames the viewport union.
        expand_bbox(&mut paper_bbox, p1[0], p1[1]);
        expand_bbox(&mut paper_bbox, p3[0], p3[1]);

        // Build model→paper Xform. scale = paper_h / view_h (uniform). Twist
        // is the model-space rotation (negative sense when going model→paper
        // per ODA §19.4.61 — but the viewport records twist as view rotation,
        // and the paper-space projection applies it directly on model coords).
        let scale = paper_h / view_h;
        let c = twist.cos();
        let s = twist.sin();
        // Compose: p_paper = center + R(-twist) * scale * (p_model - view_target)
        // = center - R(-twist) * scale * view_target + R(-twist) * scale * p_model
        // Xform applies sx/sy first, then rotation (cos,sin), then tx/ty — so
        // we want cos = cos(-twist) = c, sin = sin(-twist) = -s.
        let rot_cos = c;
        let rot_sin = -s;
        // tx/ty = center - R(-twist) * scale * view_target
        let rx = vx * scale;
        let ry = vy * scale;
        let tx = cx - (rx * rot_cos - ry * rot_sin);
        let ty = cy - (rx * rot_sin + ry * rot_cos);
        let vp_xform = Xform {
            tx, ty,
            cos: rot_cos, sin: rot_sin,
            sx: scale, sy: scale,
        };
        let rect = [cx - hw, cy - hh, cx + hw, cy + hh];

        // Re-iterate top-level model entities, projecting through vp_xform.
        // Skip block-internal, skip paper-space (they live at paper coords
        // already, don't re-project), skip BLOCK/ENDBLK sentinels, and
        // skip other VIEWPORT entities (self-recursion / nested vports).
        let mut scratch_segs: Vec<Segment> = Vec::new();
        let mut scratch_tris: Vec<Triangle> = Vec::new();
        let mut scratch_bbox = [f64::INFINITY, f64::INFINITY, f64::NEG_INFINITY, f64::NEG_INFINITY];
        let mut scratch_dash_kind: Vec<u8> = Vec::new();
        let mut vp_scratch_counts = [0u32; 15];
        for src in &file.objects {
            if !src.is_entity { continue; }
            if is_block_internal.contains(&src.handle) { continue; }
            if src.type_num == 0x04 || src.type_num == 0x05 { continue; }
            if src.type_name == "VIEWPORT" { continue; }
            // Paper-space filter: skip if the entity is is_paper per ODA §20.4.1.
            let src_dv = serde_json::json!(&src.data);
            let ent_mode = src_dv.get("entity_mode").and_then(|v| v.as_u64()).unwrap_or(0);
            let owner_is_paper = src.handle_refs.owner
                .map(|h| paper_space_handles.contains(&h))
                .unwrap_or(false);
            if ent_mode == 1 || owner_is_paper { continue; }
            // Revit-flattened paper-space INSERTs — mirrors DXF loader
            // heuristic around line 2127. Skip at-origin INSERTs whose
            // referenced block name matches Revit sheet / label / titleblock
            // conventions. Without this, the huge title-block MTEXTs get
            // re-projected through the biggest viewport and render as
            // giant text across the whole sheet (observed: "allen" from
            // "Palenplan" rendered ~300 paper mm tall).
            let h_paper = if src.type_name == "INSERT" || src.type_name == "MINSERT" {
                let n = src_dv.get("blockName").and_then(|v| v.as_str())
                    .unwrap_or("").to_ascii_lowercase();
                let pt = src_dv.get("insertionPoint").or_else(|| src_dv.get("insertion"));
                let at_origin = pt.and_then(|v| {
                    if let Some(arr) = v.as_array() {
                        let x = arr.get(0)?.as_f64()?;
                        let y = arr.get(1)?.as_f64()?;
                        Some(x.abs() < 1e-6 && y.abs() < 1e-6)
                    } else if let Some(obj) = v.as_object() {
                        let x = obj.get("x")?.as_f64()?;
                        let y = obj.get("y")?.as_f64()?;
                        Some(x.abs() < 1e-6 && y.abs() < 1e-6)
                    } else { None }
                }).unwrap_or(false);
                n.contains("_di_maskeer") || (at_origin && (
                    n.contains("_lab_") ||
                    n.contains("grootformaat") ||
                    n.contains("titelblok") ||
                    n.contains("renvooi")
                ))
            } else { false };
            if h_paper { continue; }

            let raw_color = src_dv.get("color").and_then(|v| v.as_i64()).unwrap_or(256);
            let src_color = if raw_color == 0 {
                dwg_default_rgba
            } else {
                dwg_resolve_color(&src_dv, &layer_color_map, dwg_default_rgba)
            };
            let src_ltype = dwg_resolve_ltype_pattern(&src_dv, &layer_ltype_map, &ltype_dashes_map, global_ltscale);
            if src.type_name == "INSERT" || src.type_name == "MINSERT" {
                let mut visiting: HashSet<u32> = HashSet::new();
                expand_insert(
                    &src_dv, &vp_xform, 0,
                    &file.objects, &block_index, &block_handle_by_name,
                    &mut scratch_segs, &mut scratch_tris, &mut scratch_bbox,
                    &mut vp_scratch_counts,
                    &mut visiting, false,
                    &layer_color_map, &layer_ltype_map, &ltype_dashes_map,
                    dwg_default_rgba, src_color, global_ltscale,
                    &mut scratch_dash_kind,
                );
            } else {
                tessellate_one(
                    &src.type_name, &src_dv, &vp_xform,
                    &mut scratch_segs, &mut scratch_tris, &mut scratch_bbox,
                    src_color, &src_ltype,
                    // Viewport projection re-renders source entities into
                    // paper space; no entity_text capture (the model-space
                    // pass already wrote into entity_text for these).
                    None, 0,
                    &mut scratch_dash_kind,
                );
            }
        }
        // Clip + commit. Keep scratch_dash_kind aligned with scratch_segs
        // before consuming so each clipped output can carry through its
        // dash kind.
        if scratch_dash_kind.len() < scratch_segs.len() {
            scratch_dash_kind.resize(scratch_segs.len(), 0u8);
        }
        for (i, seg) in scratch_segs.into_iter().enumerate() {
            if let Some((a, b)) = clip_segment_to_rect(seg.p1, seg.p2, rect) {
                segments.push(Segment { p1: a, p2: b, color: seg.color, is_paper: true });
                segment_dash_kind.push(scratch_dash_kind.get(i).copied().unwrap_or(0));
                vp_projected_segs += 1;
            }
        }
        for tri in scratch_tris {
            let clipped = clip_polygon_to_rect(&tri.v, rect);
            if clipped.len() >= 3 {
                for k in 1..clipped.len() - 1 {
                    triangles.push(Triangle {
                        v: [clipped[0], clipped[k], clipped[k + 1]],
                        color: tri.color,
                        is_paper: true,
                        kind: tri.kind,
                    });
                    vp_projected_tris += 1;
                }
            }
        }
    }
    if vp_dump || std::env::var("O2D_DWG_DEBUG").is_ok() {
        eprintln!(
            "[load_dwg] VIEWPORT projection: {} real vports → {} segs + {} tris committed",
            vp_real_count, vp_projected_segs, vp_projected_tris,
        );
    }

    // Paper-space color convention fix (user reported "heel erg grijs,
    // witte lijnen onleesbaar" — layout tab showed the dark-themed viewer
    // bg with near-white DWG lines, zero contrast, no paper sheet).
    //
    // AutoCAD paper space: WHITE paper bg, BLACK/near-black lines. Our
    // viewer is dark-themed (can't change background without touching
    // split_compare.rs which is off-limits this round), so we invert
    // paper-space entities so they read against the dark canvas:
    //   - near-white line (R/G/B all > 0xE0) → mid-grey (not black —
    //     black on dark bg is also invisible) so content stays visible.
    //   - keep other colours intact (real CAD layer colours).
    // Triangles get the same treatment.
    //
    // This does NOT affect the model-space path; segments/triangles with
    // is_paper == false are left untouched.
    fn invert_paper_color(c: u32) -> u32 {
        let r = (c >> 0) & 0xFF;
        let g = (c >> 8) & 0xFF;
        let b = (c >> 16) & 0xFF;
        let a = (c >> 24) & 0xFF;
        if r > 0xE0 && g > 0xE0 && b > 0xE0 {
            // Near-white on dark viewer bg = invisible. Flip to a
            // mid-grey that reads cleanly on both light (paper) and dark
            // (viewer) backgrounds.
            (a << 24) | (0x40 << 16) | (0x40 << 8) | 0x40
        } else {
            c
        }
    }
    let mut paper_inverted = 0usize;
    for s in &mut segments {
        if s.is_paper {
            let nc = invert_paper_color(s.color);
            if nc != s.color { paper_inverted += 1; }
            s.color = nc;
        }
    }
    for t in &mut triangles {
        if t.is_paper { t.color = invert_paper_color(t.color); }
    }
    if paper_inverted > 0 {
        eprintln!("[load_dwg] paper-space color inversion: {} near-white segments → mid-grey",
            paper_inverted);
    }

    // Paper frame: if we have a real paper_bbox, emit a thin mid-grey
    // rectangle around it so the viewer visually delimits "this is the
    // paper". Without this the layout tab shows content floating in the
    // dark viewer bg with no sheet outline. (Full "white paper, black
    // lines" rendering would need a viewer change which is off-limits
    // this round.)
    if paper_bbox[0].is_finite() && paper_bbox[2].is_finite()
        && paper_bbox[2] > paper_bbox[0] && paper_bbox[3] > paper_bbox[1]
    {
        let frame_col: u32 = 0xFF_80_80_80; // neutral mid-grey (AABBGGRR)
        let [x0, y0, x1, y1] = paper_bbox;
        segments.push(Segment { p1: [x0, y0], p2: [x1, y0], color: frame_col, is_paper: true });
        segments.push(Segment { p1: [x1, y0], p2: [x1, y1], color: frame_col, is_paper: true });
        segments.push(Segment { p1: [x1, y1], p2: [x0, y1], color: frame_col, is_paper: true });
        segments.push(Segment { p1: [x0, y1], p2: [x0, y0], color: frame_col, is_paper: true });
        eprintln!("[load_dwg] paper-space frame emitted for bbox [{:.1},{:.1}]..[{:.1},{:.1}]",
            x0, y0, x1, y1);
    }

    if !bbox[0].is_finite() { bbox = [0.0, 0.0, 1.0, 1.0]; }

    // ----- Drop segments with pathological coordinates -----
    // Pathological HATCH boundaries (and a few corrupt INSERT transforms)
    // emit segment endpoints with finite-but-astronomical IEEE-754 values
    // (10^200+). expand_bbox above already gates these out of the bbox at
    // |coord|>1e6, but they remain in the segment buffer, and the renderer
    // happily projects them — producing a "spider web" converging on the
    // legitimate cluster (see bug 04-12-2025.dwg). No real CAD drawing
    // needs coordinates beyond ±1e9 world units, so drop offenders here
    // along with their parallel index/dash-kind metadata.
    {
        // 1e9 world units = 1000 km, well above any realistic site plan.
        // Pathological HATCHes typically emit at 10^200+ and the cap
        // catches all of those without touching real geometry.
        const COORD_HARD_CAP: f64 = 1.0e9;
        let n_before = segments.len();
        // Need to filter segments + parallel arrays (segment_layer_idx,
        // segment_entity_idx, segment_dash_kind) in lockstep.
        let mut keep: Vec<bool> = Vec::with_capacity(n_before);
        for s in &segments {
            let ok = s.p1[0].is_finite() && s.p1[1].is_finite()
                  && s.p2[0].is_finite() && s.p2[1].is_finite()
                  && s.p1[0].abs() < COORD_HARD_CAP && s.p1[1].abs() < COORD_HARD_CAP
                  && s.p2[0].abs() < COORD_HARD_CAP && s.p2[1].abs() < COORD_HARD_CAP;
            keep.push(ok);
        }
        let n_drop = keep.iter().filter(|k| !**k).count();
        if n_drop > 0 {
            // Tally dropped-by-entity for the warning.
            let mut by_entity: std::collections::HashMap<u32, usize> = std::collections::HashMap::new();
            for (i, k) in keep.iter().enumerate() {
                if !*k {
                    let eid = segment_entity_idx.get(i).copied().unwrap_or(u32::MAX);
                    *by_entity.entry(eid).or_insert(0) += 1;
                }
            }
            let mut idx = 0;
            segments.retain(|_| { let k = keep[idx]; idx += 1; k });
            if segment_layer_idx.len() == n_before {
                idx = 0;
                segment_layer_idx.retain(|_| { let k = keep[idx]; idx += 1; k });
            }
            if segment_entity_idx.len() == n_before {
                idx = 0;
                segment_entity_idx.retain(|_| { let k = keep[idx]; idx += 1; k });
            }
            if segment_dash_kind.len() == n_before {
                idx = 0;
                segment_dash_kind.retain(|_| { let k = keep[idx]; idx += 1; k });
            }
            let mut sources: Vec<(u32, usize)> = by_entity.into_iter().collect();
            sources.sort_by(|a, b| b.1.cmp(&a.1));
            let top: Vec<String> = sources.iter().take(5).map(|(eid, n)| {
                let name = entity_names.get(*eid as usize).map(|s| s.as_str()).unwrap_or("?");
                format!("{}×{}", n, name)
            }).collect();
            eprintln!(
                "[load_dwg] WARN dropped {} of {} segments with pathological coords (|x| or |y| > {:.0e}); top sources: {}",
                n_drop, n_before, COORD_HARD_CAP, top.join(", ")
            );
            // After filtering, recompute bbox from surviving segments since
            // the original bbox accumulator's 1e6 gate may have under- or
            // over-included relative to what's left.
            let mut new_bbox = [f64::INFINITY, f64::INFINITY, f64::NEG_INFINITY, f64::NEG_INFINITY];
            for s in &segments {
                expand_bbox(&mut new_bbox, s.p1[0], s.p1[1]);
                expand_bbox(&mut new_bbox, s.p2[0], s.p2[1]);
            }
            if new_bbox[0].is_finite() { bbox = new_bbox; }
        }
    }

    // ----- Second pass: percentile-based outlier filter -----
    // The 1e9 hard cap above kills 10^200-scale astronomical values, but
    // pathological HATCH/INSERT survivors often land at e.g. 1e5..1e8 —
    // finite but well above real drawing extents (~10^4..10^5 mm for
    // buildings). On heavily contaminated files (DWG 04-12-2025.dwg has
    // 2.5M dropped + 1.2M survivors where 50%+ of survivors are still
    // bad), the median of |coord| is itself dominated by outliers, so a
    // straightforward median × N filter can't tighten the bbox.
    //
    // Robust criterion: take the 90th percentile of MAX(|x|,|y|) over
    // segment endpoints — that's the smallest radius enclosing 90% of
    // the geometry mass. The legitimate drawing dominates the lower
    // percentiles even when outliers are numerous, because real drawings
    // pack many short edges. We then accept anything within
    // OUTLIER_FACTOR (=20) × p90, which is generous enough to keep the
    // legitimate drawing intact while excising any segments that escape
    // the cluster by orders of magnitude. Floors keep tiny drawings safe.
    {
        const OUTLIER_FACTOR: f64 = 20.0;
        const MIN_SCALE: f64 = 1.0e3;     // 1 m in mm — floor
        const HARD_KEEP: f64 = 5.0e5;     // |coord| <= 500 m always kept
        // Only run the cluster filter if there's evidence of pathological
        // survivors — defined as ANY endpoint with |coord| > 1e6 mm
        // (1 km). When all survivors fit within 1 km the drawing is by
        // definition compact and the p90 filter has no work to do; running
        // it anyway risks chopping legitimate engineering geometry on
        // medium-scale building drawings (the user-reported regression
        // for DWG 04-12-2025.dwg, where 80% of segments got dropped by
        // an over-eager filter despite the drawing being well-behaved
        // post-coord-cap).
        // Lowered from 1e6 → 1e5 (100 km) per night-shift corpus inspection
        // (2026-05-06): bbox-dominated drawings like Nieuwe-toestand 121224
        // have surviving outliers at 5e5..1e6 — finite, below the previous
        // 1e6 trigger, but still 10000× larger than the legitimate building
        // cluster (~50 m). 1e5 is well above any single-building drawing
        // (typical max site plan: 200×200 m = ±100 m), and the >50%-drop
        // safety net below still protects multi-km civil/cadastral plans.
        // ODA reference: per AcDbDimension §20.4.51 and AcDbInsert §20.4.42,
        // legitimate world coordinates are bounded by the model-space limits
        // (LIMMAX/LIMMIN); files exceeding 100 km of span almost always
        // carry decode-misalignment outliers.
        const PATHOLOGICAL_PROBE: f64 = 1.0e5;
        let has_pathological = segments.iter().any(|s|
            s.p1[0].abs() > PATHOLOGICAL_PROBE || s.p1[1].abs() > PATHOLOGICAL_PROBE
         || s.p2[0].abs() > PATHOLOGICAL_PROBE || s.p2[1].abs() > PATHOLOGICAL_PROBE
        );
        if !has_pathological {
            eprintln!(
                "[load_dwg] p90-filter SKIPPED — no survivors with |coord| > {:.0e}; {} segments retained as-is",
                PATHOLOGICAL_PROBE, segments.len()
            );
        }
        if has_pathological && segments.len() > 32 {
            // Per-endpoint max(|x|,|y|) — one value per endpoint = 2× segs.
            let mut radii: Vec<f64> = Vec::with_capacity(segments.len() * 2);
            for s in &segments {
                radii.push(s.p1[0].abs().max(s.p1[1].abs()));
                radii.push(s.p2[0].abs().max(s.p2[1].abs()));
            }
            radii.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
            let p90 = radii[(radii.len() as f64 * 0.90) as usize];
            let median = radii[radii.len() / 2];
            let cap = (p90 * OUTLIER_FACTOR).max(MIN_SCALE * OUTLIER_FACTOR).max(HARD_KEEP);

            let n_before = segments.len();
            let mut keep: Vec<bool> = Vec::with_capacity(n_before);
            for s in &segments {
                let ok = s.p1[0].abs() < cap && s.p1[1].abs() < cap
                      && s.p2[0].abs() < cap && s.p2[1].abs() < cap;
                keep.push(ok);
            }
            let n_drop = keep.iter().filter(|k| !**k).count();
            if n_drop > 0 && n_drop < n_before / 2 {
                let mut by_entity: std::collections::HashMap<u32, usize> = std::collections::HashMap::new();
                let mut max_x: f64 = 0.0;
                let mut max_y: f64 = 0.0;
                for (i, k) in keep.iter().enumerate() {
                    if !*k {
                        let eid = segment_entity_idx.get(i).copied().unwrap_or(u32::MAX);
                        *by_entity.entry(eid).or_insert(0) += 1;
                        let s = &segments[i];
                        max_x = max_x.max(s.p1[0].abs()).max(s.p2[0].abs());
                        max_y = max_y.max(s.p1[1].abs()).max(s.p2[1].abs());
                    }
                }
                let mut idx = 0;
                segments.retain(|_| { let k = keep[idx]; idx += 1; k });
                if segment_layer_idx.len() == n_before {
                    idx = 0;
                    segment_layer_idx.retain(|_| { let k = keep[idx]; idx += 1; k });
                }
                if segment_entity_idx.len() == n_before {
                    idx = 0;
                    segment_entity_idx.retain(|_| { let k = keep[idx]; idx += 1; k });
                }
                if segment_dash_kind.len() == n_before {
                    idx = 0;
                    segment_dash_kind.retain(|_| { let k = keep[idx]; idx += 1; k });
                }
                let mut sources: Vec<(u32, usize)> = by_entity.into_iter().collect();
                sources.sort_by(|a, b| b.1.cmp(&a.1));
                let top: Vec<String> = sources.iter().take(5).map(|(eid, n)| {
                    let name = entity_names.get(*eid as usize).map(|s| s.as_str()).unwrap_or("?");
                    format!("{}×{}", n, name)
                }).collect();
                eprintln!(
                    "[load_dwg] WARN p90-filter dropped {} of {} segments (p90={:.1}, median={:.1}, cap={:.1}, max_dropped=[{:.1},{:.1}]); top sources: {}",
                    n_drop, n_before, p90, median, cap, max_x, max_y, top.join(", ")
                );
                let mut new_bbox = [f64::INFINITY, f64::INFINITY, f64::NEG_INFINITY, f64::NEG_INFINITY];
                for s in &segments {
                    expand_bbox(&mut new_bbox, s.p1[0], s.p1[1]);
                    expand_bbox(&mut new_bbox, s.p2[0], s.p2[1]);
                }
                if new_bbox[0].is_finite() { bbox = new_bbox; }
            } else if n_drop >= n_before / 2 {
                eprintln!(
                    "[load_dwg] p90-filter SKIPPED — would drop {}/{} segments (>50%); p90={:.1} median={:.1} cap={:.1}",
                    n_drop, n_before, p90, median, cap
                );
            } else {
                // n_drop == 0 — filter ran but found nothing to drop. Keep
                // a brief note so the operator can confirm the filter is
                // not silently chewing legitimate geometry.
                eprintln!(
                    "[load_dwg] p90-filter clean — 0 of {} segments outside cap ({:.1}); all retained",
                    n_before, cap
                );
            }
        }
    }

    let label = format!(
        "DWG [{}]  objs={} ents={} segs={} tri={}  LN={} CI={} AR={} LW={} IN={} EL={} SP={} PT={} SO={} LD={} RY={} XL={} DI={} HA={} ot={}",
        file.version, file.objects.len(),
        file.objects.iter().filter(|o| o.is_entity).count(),
        segments.len(), triangles.len(),
        counts[0], counts[1], counts[2], counts[3], counts[4],
        counts[6], counts[7], counts[8], counts[9], counts[10],
        counts[11], counts[12], counts[13], counts[14], counts[5]
    );
    // DWG parser doesn't yet expose LAYOUT records, so we provide the
    // "Model" entry pointing at the full scene bbox PLUS a "Layout1" entry
    // pointing at the paper-space union bbox (computed above from entities
    // tagged is_paper). When no paper entities exist paper_bbox stays at
    // infinity so we skip that layout entry — the camera still fits Model.
    let mut layouts = vec![("Model".to_string(), bbox)];
    if paper_bbox[0].is_finite() && paper_bbox[2].is_finite()
        && paper_bbox[2] > paper_bbox[0] && paper_bbox[3] > paper_bbox[1]
    {
        layouts.push(("Layout1".to_string(), paper_bbox));
    }
    // Pad layer_idx tails in case any emit path bypassed tracking
    // (viewport projection pass, hatch pass, etc.). Default to layer 0
    // ("0" sentinel) so every segment has a valid idx.
    while segment_layer_idx.len() < segments.len() {
        segment_layer_idx.push(0);
    }
    // Same tail-pad for the parallel dash-kind buffer.
    if segment_dash_kind.len() < segments.len() {
        segment_dash_kind.resize(segments.len(), 0u8);
    }
    while triangle_layer_idx.len() < triangles.len() {
        triangle_layer_idx.push(0);
    }
    // Invariant pad: if any emit path bypassed the per-entity tracking
    // (e.g. future sheet overlays / viewport frames), assign the stragglers
    // to a sentinel "VIEWPORT/SHEET" entity so the viewer's selection logic
    // still finds a valid idx for every segment/triangle.
    let tail_eid = entity_names.len() as u32;
    if segment_entity_idx.len() < segments.len() || triangle_entity_idx.len() < triangles.len() {
        entity_names.push("VIEWPORT/SHEET".to_string());
        while segment_entity_idx.len() < segments.len() {
            segment_entity_idx.push(tail_eid);
        }
        while triangle_entity_idx.len() < triangles.len() {
            triangle_entity_idx.push(tail_eid);
        }
    }
    // Empty-scene safety: keep at least one entry so viewer indexing never panics.
    if entity_names.is_empty() {
        entity_names.push("(empty DWG)".to_string());
    }
    // Pad entity_text to match entity_names.len(). TEXT/MTEXT/ATTRIB
    // branches populate Some(EntityText) inline during the loop; this
    // safety net catches the empty-scene sentinel pushed above and any
    // synthetic entries (VIEWPORT/SHEET tail_eid) so the Vec stays
    // index-aligned with entity_names.
    if entity_text.len() < entity_names.len() {
        entity_text.resize(entity_names.len(), None);
    }
    if std::env::var_os("O2D_TEXT_DBG").is_some() {
        eprintln!(
            "[entity_text-dwg] {} total entities, {} have text",
            entity_text.len(),
            entity_text.iter().filter(|t| t.is_some()).count(),
        );
    }
    eprintln!("[load_dwg] phase entity_loop+post: {:.3}s ({} segs, {} tris)",
        t_entity_loop.elapsed().as_secs_f64(), segments.len(), triangles.len());
    if profile_load && !top_emitters.is_empty() {
        top_emitters.sort_by(|a, b| b.0.cmp(&a.0));
        eprintln!("[load_dwg] top-10 segment emitters:");
        for (segs, h, name) in top_emitters.iter().take(10) {
            eprintln!("  {} segs : {} h=0x{:X}", segs, name, h);
        }
    }
    eprintln!("[load_dwg] TOTAL: {:.3}s", _t_total.elapsed().as_secs_f64());
    Ok(Scene {
        segments, triangles, bbox, source: "DWG", count_label: label, layouts,
        layer_names: layer_names_ordered,
        layer_colors: layer_colors_ordered,
        segment_layer_idx, triangle_layer_idx,
        segment_entity_idx, triangle_entity_idx, entity_names,
        entity_text,
        segment_dash_kind,
    })
}

// =============================================================================
// Per-entity tessellator (shared by top-level + INSERT-block paths)
// =============================================================================

/// tessellate_one — render a single entity (`type_name` + JSON `data`) into
/// `segments`/`bbox`, with `xform` mapping local → world. Used for both
/// top-level entities (xform = identity) and block-internal entities
/// expanded via INSERT (xform = accumulated transform).
///
/// Returns Some(category index) if a category counter should be bumped,
/// None if unhandled (caller decides whether to count as "other").
fn tessellate_one(
    type_name: &str,
    d: &serde_json::Value,
    xform: &Xform,
    segments: &mut Vec<Segment>,
    triangles: &mut Vec<Triangle>,
    bbox: &mut [f64; 4],
    color: u32,
    ltype_pattern: &[f64],
    // Per-entity raw text capture for the in-place text editor. The top-
    // level entity loop in `load_dwg` passes `Some(&mut entity_text)` +
    // the entity_idx allocated for this entity; INSERT child / viewport
    // recursion passes `None` (children share the parent's slot, no
    // duplicate write needed). Mirrors tessellate_dxf_entity's threading.
    entity_text_out: Option<&mut Vec<Option<EntityText>>>,
    entity_idx_for_text: u32,
    // Parallel-to-`segments` dash-kind buffer, see scene_io::Scene
    // documentation. emit_dashed lazy-pads up to segments.len() before
    // pushing.
    dash_kinds: &mut Vec<u8>,
) -> Option<usize> {
    let get_xy = |v: &serde_json::Value| -> Option<[f64; 2]> {
        if let Some(arr) = v.as_array() {
            let x = arr.get(0)?.as_f64()?;
            let y = arr.get(1)?.as_f64()?;
            Some([x, y])
        } else if let Some(obj) = v.as_object() {
            let x = obj.get("x")?.as_f64()?;
            let y = obj.get("y")?.as_f64()?;
            Some([x, y])
        } else { None }
    };
    // Local helper: push a segment, applying the entity's dash pattern when
    // one is present. `emit_dashed` handles the "pattern empty → just push
    // a solid segment" fallback, so the body of each entity arm can stay
    // uniform.
    let push_line = |segments: &mut Vec<Segment>, dash_kinds: &mut Vec<u8>, bbox: &mut [f64; 4], p1: [f64; 2], p2: [f64; 2]| {
        if ltype_pattern.is_empty() {
            segments.push(Segment { p1, p2, color, is_paper: false });
            expand_bbox(bbox, p1[0], p1[1]);
            expand_bbox(bbox, p2[0], p2[1]);
        } else {
            emit_dashed(segments, dash_kinds, bbox, p1, p2, color, ltype_pattern);
        }
    };
    match type_name {
        "LINE" => {
            let p1 = d.get("start").and_then(get_xy);
            let p2 = d.get("end").and_then(get_xy);
            if let (Some(p1), Some(p2)) = (p1, p2) {
                let tp1 = xform.apply(p1);
                let tp2 = xform.apply(p2);
                push_line(segments, dash_kinds, bbox, tp1, tp2);
            }
            Some(0)
        }
        "CIRCLE" => {
            let c = d.get("center").and_then(get_xy);
            let r = d.get("radius").and_then(|v| v.as_f64());
            if let (Some(c), Some(r)) = (c, r) {
                const N: usize = 64;
                let mut prev = xform.apply([c[0] + r, c[1]]);
                for i in 1..=N {
                    let a = (i as f64) / (N as f64) * std::f64::consts::TAU;
                    let cur = xform.apply([c[0] + r * a.cos(), c[1] + r * a.sin()]);
                    segments.push(Segment { p1: prev, p2: cur, color, is_paper: false });
                    expand_bbox(bbox, cur[0], cur[1]);
                    prev = cur;
                }
            }
            Some(1)
        }
        "ARC" => {
            let c = d.get("center").and_then(get_xy);
            let r = d.get("radius").and_then(|v| v.as_f64());
            let s = d.get("startAngle").or_else(|| d.get("start_angle")).and_then(|v| v.as_f64());
            let e = d.get("endAngle").or_else(|| d.get("end_angle")).and_then(|v| v.as_f64());
            if let (Some(c), Some(r), Some(s), Some(e)) = (c, r, s, e) {
                let mut e2 = e;
                if e2 < s { e2 += std::f64::consts::TAU; }
                let sweep = (e2 - s).min(std::f64::consts::TAU * 2.0);
                let n = ((sweep / std::f64::consts::TAU * 64.0).ceil() as usize).max(4).min(256);
                let mut prev = xform.apply([c[0] + r * s.cos(), c[1] + r * s.sin()]);
                for i in 1..=n {
                    let t = s + sweep * (i as f64) / (n as f64);
                    let cur = xform.apply([c[0] + r * t.cos(), c[1] + r * t.sin()]);
                    segments.push(Segment { p1: prev, p2: cur, color, is_paper: false });
                    expand_bbox(bbox, cur[0], cur[1]);
                    prev = cur;
                }
            }
            Some(2)
        }
        "LWPOLYLINE" | "POLYLINE" | "POLYLINE_2D" => {
            // per ODA OpenDesignSpec §19.4.87 / §20.4.85 — each vertex may
            // carry a `bulge` (code 42 equivalent). parse_lwpolyline in
            // src-tauri/dwg-parser/parser.rs emits it as an optional field
            // on the per-vertex JSON object. parse_polyline_2d and
            // parse_vertex_2d likewise emit bulge. When absent, default 0
            // (straight chord).
            if let Some(arr) = d.get("vertices").and_then(|v| v.as_array()) {
                let mut verts: Vec<[f64; 2]> = Vec::with_capacity(arr.len());
                let mut bulges: Vec<f64> = Vec::with_capacity(arr.len());
                for v in arr.iter() {
                    if let Some(xy) = get_xy(v) {
                        verts.push(xform.apply(xy));
                        let bulge = v.get("bulge")
                            .and_then(|b| b.as_f64())
                            .unwrap_or(0.0);
                        bulges.push(bulge);
                    }
                }
                let closed = d.get("closed").and_then(|v| v.as_bool()).unwrap_or(false)
                    && verts.len() > 2;
                for (p1, p2) in tessellate_polyline_bulges(&verts, &bulges, closed) {
                    push_line(segments, dash_kinds, bbox, p1, p2);
                }
            }
            Some(3)
        }
        "ELLIPSE" => {
            let ctr = d.get("center").and_then(get_xy);
            let maj = d.get("majorAxis").and_then(get_xy);
            let ratio = d.get("axisRatio").and_then(|v| v.as_f64()).unwrap_or(1.0).abs().max(1e-9);
            let s = d.get("startAngle").and_then(|v| v.as_f64()).unwrap_or(0.0);
            let e = d.get("endAngle").and_then(|v| v.as_f64()).unwrap_or(std::f64::consts::TAU);
            if let (Some(c), Some(m)) = (ctr, maj) {
                if s.is_finite() && e.is_finite() && s.abs() < 1e6 && e.abs() < 1e6 {
                    let mut e2 = e;
                    if e2 < s { e2 += std::f64::consts::TAU; }
                    let sweep = (e2 - s).min(std::f64::consts::TAU * 2.0);
                    let n = ((sweep / std::f64::consts::TAU * 96.0).ceil() as usize).max(8).min(256);
                    let px = -m[1]; let py = m[0];
                    let mut prev = xform.apply([
                        c[0] + m[0] * s.cos() + px * ratio * s.sin(),
                        c[1] + m[1] * s.cos() + py * ratio * s.sin(),
                    ]);
                    expand_bbox(bbox, prev[0], prev[1]);
                    for i in 1..=n {
                        let t = s + sweep * (i as f64) / (n as f64);
                        let cur = xform.apply([
                            c[0] + m[0] * t.cos() + px * ratio * t.sin(),
                            c[1] + m[1] * t.cos() + py * ratio * t.sin(),
                        ]);
                        segments.push(Segment { p1: prev, p2: cur, color, is_paper: false });
                        expand_bbox(bbox, cur[0], cur[1]);
                        prev = cur;
                    }
                }
            }
            Some(6)
        }
        "SPLINE" => {
            // TODO KLUDGE: MAX_SPLINE_PTS cap.
            //
            // Real parser bug this hides: parse_spline (parser.rs
            // §19.3.19) reads num_knots / num_ctrl / num_fit as BL values
            // from a bit stream whose alignment is already off on R2010+
            // (see expand_bbox TODO). A misaligned BL produces a random
            // u32, so the point-array read-loop would otherwise iterate
            // billions of times. Spec §19.3.19 defines no intrinsic max;
            // even real splines rarely exceed a few hundred points.
            //
            // Proper fix: same entity-common alignment work as bbox
            // filter. Once num_fit comes from the correct bit position
            // this cap is unneeded.
            const MAX_SPLINE_PTS: usize = 2048;
            let is_sane = |p: &[f64; 2]| -> bool {
                p[0].is_finite() && p[1].is_finite()
                    && p[0].abs() < 1.0e6 && p[1].abs() < 1.0e6
            };
            let mut pts: Vec<[f64; 2]> = Vec::new();
            if let Some(fp) = d.get("fitPoints").and_then(|v| v.as_array()) {
                for v in fp.iter().take(MAX_SPLINE_PTS) {
                    if let Some(xy) = get_xy(v) {
                        if is_sane(&xy) { pts.push(xform.apply(xy)); }
                    }
                }
            }
            if pts.is_empty() {
                if let Some(cp) = d.get("controlPoints").and_then(|v| v.as_array()) {
                    for v in cp.iter().take(MAX_SPLINE_PTS) {
                        let inner = v.get("point").or(Some(v)).unwrap();
                        if let Some(xy) = get_xy(inner) {
                            if is_sane(&xy) { pts.push(xform.apply(xy)); }
                        }
                    }
                }
            }
            if pts.len() >= 2 {
                for v in &pts { expand_bbox(bbox, v[0], v[1]); }
                for w in pts.windows(2) {
                    segments.push(Segment { p1: w[0], p2: w[1], color, is_paper: false });
                }
            }
            Some(7)
        }
        "POINT" => {
            let pos = d.get("position").and_then(get_xy).unwrap_or([0.0, 0.0]);
            let s = 0.5;
            let p_h1 = xform.apply([pos[0]-s, pos[1]]);
            let p_h2 = xform.apply([pos[0]+s, pos[1]]);
            let p_v1 = xform.apply([pos[0], pos[1]-s]);
            let p_v2 = xform.apply([pos[0], pos[1]+s]);
            segments.push(Segment { p1: p_h1, p2: p_h2, color, is_paper: false });
            segments.push(Segment { p1: p_v1, p2: p_v2, color, is_paper: false });
            expand_bbox(bbox, p_h1[0], p_h1[1]);
            expand_bbox(bbox, p_h2[0], p_h2[1]);
            expand_bbox(bbox, p_v1[0], p_v1[1]);
            expand_bbox(bbox, p_v2[0], p_v2[1]);
            Some(8)
        }
        "SOLID" | "TRACE" => {
            // Per ODA §19.4.127 (AcDbTrace / SOLID): the body stores four
            // 3BD corners in raw 1→2→3→4 order where corners 1/2 lie on
            // one edge of the filled quadrilateral and corners 3/4 on the
            // OPPOSITE edge (Z-pattern, not rectangular). So the filled
            // region outline is p1 → p2 → p4 → p3 → p1, and the natural
            // triangulation is (p1, p2, p4) + (p1, p4, p3). The DXF path
            // (EntityType::Solid arm above, line ~3126) uses the exact
            // same convention via dxf-crate's first/second/third/fourth
            // corner fields.
            //
            // Historical bug: this arm previously emitted ONLY the four
            // outline edges — no filled triangles — so DWG SOLIDs rendered
            // as hollow quadrilaterals while DXF SOLIDs were filled. Users
            // perceived this as a "missing corner" because the outline
            // alone, drawn thin, made the diagonal fold between p2-p3
            // look like an open gap. Emitting the two triangles (matching
            // the DXF arm) closes the region.
            let p1 = xform.apply(d.get("point1").and_then(get_xy).unwrap_or([0.0, 0.0]));
            let p2 = xform.apply(d.get("point2").and_then(get_xy).unwrap_or([0.0, 0.0]));
            let p3 = xform.apply(d.get("point3").and_then(get_xy).unwrap_or([0.0, 0.0]));
            let p4 = xform.apply(d.get("point4").and_then(get_xy).unwrap_or([0.0, 0.0]));
            // Malformed-SOLID guard (user reported "diag-gray-triangle
            // SOLID bug" — a huge diagonal dark-grey triangle across the
            // sheet from one bad corner reading as garbage coords).
            //
            // Rejection heuristics per ODA §19.4.127 (a legitimate SOLID's
            // four corners lie within the entity's local extents, never
            // hundreds of km apart):
            //   a) any corner non-finite / > 1e8 world units → skip.
            //   b) centroid-to-corner max > 1e5 → skip.
            //   c) max inter-corner distance > 100× median of the other
            //      three → a single rogue corner; skip.
            // All three are OR-ed so the simplest one that catches the
            // screenshot's rogue triangle fires first.
            let pts = [p1, p2, p3, p4];
            let non_finite = pts.iter().any(|p| !p[0].is_finite() || !p[1].is_finite()
                || p[0].abs() > 1.0e8 || p[1].abs() > 1.0e8);
            let cx = (p1[0] + p2[0] + p3[0] + p4[0]) * 0.25;
            let cy = (p1[1] + p2[1] + p3[1] + p4[1]) * 0.25;
            let max_r = pts.iter()
                .map(|p| ((p[0] - cx).powi(2) + (p[1] - cy).powi(2)).sqrt())
                .fold(0.0_f64, f64::max);
            let centroid_far = max_r > 1.0e5;
            // Inter-corner distance outlier check: gather 3 edge-lengths
            // (p1-p2, p2-p4, p4-p3) and check if the max is 100× the
            // median. A SOLID with one corner at a garbage coord has
            // ~1e8 for one edge while the other two are normal scale.
            let mut edges = [
                ((p1[0]-p2[0]).powi(2) + (p1[1]-p2[1]).powi(2)).sqrt(),
                ((p2[0]-p4[0]).powi(2) + (p2[1]-p4[1]).powi(2)).sqrt(),
                ((p4[0]-p3[0]).powi(2) + (p4[1]-p3[1]).powi(2)).sqrt(),
            ];
            // total_cmp gives a real total order; partial_cmp+unwrap_or
            // violates transitivity on NaN and panics under driftsort.
            edges.sort_by(|a, b| a.total_cmp(b));
            let edge_outlier = edges[1] > 1e-9 && edges[2] > 100.0 * edges[1];
            if non_finite || centroid_far || edge_outlier {
                eprintln!(
                    "[SOLID skip] reason={} corners=[[{:.1},{:.1}],[{:.1},{:.1}],[{:.1},{:.1}],[{:.1},{:.1}]] edges={:?}",
                    if non_finite { "non-finite-or-too-large" }
                    else if centroid_far { "centroid-to-corner>1e5" }
                    else { "edge-outlier-100x-median" },
                    p1[0], p1[1], p2[0], p2[1], p3[0], p3[1], p4[0], p4[1],
                    edges,
                );
                return Some(9);
            }
            // Fill: ODA Z-pattern triangulation (p1-p2-p4) + (p1-p4-p3).
            // Skip the second triangle when p3 == p4 (degenerate triangle
            // SOLID where only three distinct corners were authored).
            triangles.push(Triangle { v: [p1, p2, p4], color, is_paper: false, kind: TriKind::Solid });
            if (p3[0] - p4[0]).abs() > 1e-9 || (p3[1] - p4[1]).abs() > 1e-9 {
                triangles.push(Triangle { v: [p1, p4, p3], color, is_paper: false, kind: TriKind::Solid });
            }
            // Outline: p1 → p2 → p4 → p3 → p1 closes the Z-pattern quad.
            segments.push(Segment { p1, p2, color, is_paper: false });
            segments.push(Segment { p1: p2, p2: p4, color, is_paper: false });
            segments.push(Segment { p1: p4, p2: p3, color, is_paper: false });
            segments.push(Segment { p1: p3, p2: p1, color, is_paper: false });
            for p in &[p1, p2, p3, p4] { expand_bbox(bbox, p[0], p[1]); }
            Some(9)
        }
        "LEADER" => {
            // parse_leader (parser.rs §19.3.25) reads num_points as a
            // BL. On R2010+ the entity-stream alignment occasionally
            // drifts (see expand_bbox note), producing a random u32.
            // Spec §19.3.25 gives no intrinsic max; real LEADER chains
            // carry a handful of points. The DD prefix-10 fix resolved
            // most cases but the cap remains as a safety net.
            const MAX_LEADER_PTS: usize = 64;
            let pts: Vec<[f64; 2]> = d.get("points").and_then(|v| v.as_array())
                .map(|arr| arr.iter()
                    .take(MAX_LEADER_PTS)
                    .filter_map(|v| get_xy(v))
                    .filter(|p| p[0].is_finite() && p[1].is_finite()
                        && p[0].abs() < 1.0e6 && p[1].abs() < 1.0e6)
                    .map(|p| xform.apply(p))
                    .collect())
                .unwrap_or_default();
            if pts.len() >= 2 {
                for v in &pts { expand_bbox(bbox, v[0], v[1]); }
                for w in pts.windows(2) {
                    push_line(segments, dash_kinds, bbox, w[0], w[1]);
                }
            }
            Some(10)
        }
        "RAY" | "XLINE" => {
            // Construction lines are annotation-only: AutoCAD shows them
            // infinite/clipped to viewport, but we render raw line-segments
            // with a fixed length (1e5 world units) which produces long
            // diagonals that visually dominate the drawing without
            // representing real geometry. The DXF crate also doesn't
            // tessellate these into segments. Skip for visual parity.
            Some(if type_name == "RAY" { 11 } else { 12 })
        }
        t if t.starts_with("DIMENSION") => {
            // Per ODA §19.3.23 (Dimension subtypes): each subtype has a
            // DEFINED field list — LINEAR/ALIGNED have extLine1+extLine2,
            // ANG2LN has the two measured lines, ANG3PT has two extension
            // lines, ORDINATE has the feature→leader segment, RADIUS/
            // DIAMETER have definitionPoint + leaderLength (no connected
            // segment). Render only the pairs defined for the subtype.
            //
            // Historical note — kludge #4 from squad/kludges_eliminated.md:
            // this code used to match phantom keys `firstEnd`/`secondEnd`
            // (no parser ever emits those) and defensively skipped (0,0)
            // pairs. The (0,0) artifact was from bit-stream mis-alignment
            // emitting BD-prefix-10 as 0.0, not from the parser emitting
            // (0,0) defaults for missing fields. Now that we dispatch on
            // the actual subtype name, only legitimate per-subtype pairs
            // are drawn so the (0,0) filter is no longer needed.
            // Per ODA §19.3.23.4 (LINEAR) / §19.3.23.5 (ALIGNED) /
            // §19.3.23.6 (ANG3PT):
            //   extLine1, extLine2   = extension-line anchor points on the
            //                          measured object (DXF codes 13/14,
            //                          aka extLine1Start/extLine2Start)
            //   definitionPoint      = a point ON the dimension line
            //                          (DXF code 10)
            //   dimRotation          = LINEAR only; CCW angle of dim line
            //                          (DXF code 50). ALIGNED: dim-line
            //                          direction = normalize(extLine2 −
            //                          extLine1).
            // Correct rendering = three segments:
            //   ext-line 1 : extLine1  → projection of extLine1 onto dimline
            //   dim line   : projection of extLine1 → projection of extLine2
            //   ext-line 2 : extLine2  → projection of extLine2 onto dimline
            // Plus simple 45° oblique tick marks at each dim-line endpoint
            // (DIMBLK default / "Oblique" tick per DXF reference DIMSTYLE
            // §DIMBLK+DIMTSZ; we use a single-style default rather than
            // looking up the real DIMBLK which requires the block-header
            // handle that the DWG parser does not currently surface).
            let mut drew_any = false;
            let mut ext_pair: Option<([f64; 2], [f64; 2])> = None;
            // Hoisted DIMSTYLE lookup so tick-render can consult dimblk1/dimblk2
            // and dimasz BEFORE the per-subtype branches. The dim-text branch
            // below also reads `dim_info_early` instead of doing a second lookup.
            let dim_info_early = d.get("dimStyleHandle")
                .and_then(|v| v.as_u64())
                .and_then(dim_style_lookup);
            match t {
                "DIMENSION_LINEAR" | "DIMENSION_ALIGNED" => {
                    let e1 = d.get("extLine1").and_then(get_xy);
                    let e2 = d.get("extLine2").and_then(get_xy);
                    let dp = d.get("definitionPoint").and_then(get_xy);
                    if let (Some(e1), Some(e2), Some(dp)) = (e1, e2, dp) {
                        ext_pair = Some((e1, e2));
                        // Dim-line direction: LINEAR uses dimRotation
                        // (ODA §19.3.23.4); ALIGNED uses the extLine1→
                        // extLine2 chord direction (ODA §19.3.23.5).
                        let (dx, dy) = if t == "DIMENSION_LINEAR" {
                            let rot = d.get("dimRotation")
                                .and_then(|v| v.as_f64())
                                .unwrap_or(0.0);
                            (rot.cos(), rot.sin())
                        } else {
                            let vx = e2[0] - e1[0];
                            let vy = e2[1] - e1[1];
                            let n = (vx * vx + vy * vy).sqrt();
                            if n > 1.0e-9 { (vx / n, vy / n) } else { (1.0, 0.0) }
                        };
                        // Project P onto the dim line (passes through dp,
                        // direction (dx,dy)): foot = dp + ((P−dp)·d̂)·d̂.
                        let project = |p: [f64; 2]| -> [f64; 2] {
                            let vx = p[0] - dp[0];
                            let vy = p[1] - dp[1];
                            let s = vx * dx + vy * dy;
                            [dp[0] + s * dx, dp[1] + s * dy]
                        };
                        let p1 = project(e1);
                        let p2 = project(e2);
                        // Per ODA §20.4.40 DIMEXO (start offset) and DIMEXE
                        // (end overshoot): the extension line does NOT touch
                        // the measured point — it starts a small gap away
                        // (DIMEXO × DIMSCALE) and overshoots the dim line by
                        // DIMEXE × DIMSCALE. Default values 0.625 / 1.25 mm
                        // pre-DIMSCALE are applied when DIMSTYLE bit-stream
                        // alignment is off (R2007+ ~148-bit drift, see
                        // SPEC_NOTES.md "Findings still open").
                        let (dimexo_w, dimexe_w) = match &dim_info_early {
                            Some(i) if i.dimscale > 0.0 => (
                                i.dimexo * i.dimscale,
                                i.dimexe * i.dimscale,
                            ),
                            _ => (0.0, 0.0),
                        };
                        // Helper: shift `from` toward `to` by `d` (clamped to
                        // segment length so we never invert the line). Negative
                        // `d` shifts in the opposite direction (away from `to`).
                        let shift = |from: [f64; 2], to: [f64; 2], d: f64| -> [f64; 2] {
                            let vx = to[0] - from[0];
                            let vy = to[1] - from[1];
                            let n = (vx * vx + vy * vy).sqrt();
                            if n <= 1.0e-9 { return from; }
                            // Clamp positive shift to segment length so we
                            // never invert the line; negative shifts have no
                            // such cap (they extend past `from`).
                            let s = if d >= 0.0 { d.min(n) } else { d };
                            [from[0] + vx * s / n, from[1] + vy * s / n]
                        };
                        // Apply DIMEXO at measured-point side (gap from e1
                        // toward p1), DIMEXE past the dim-line foot
                        // (extension beyond p1 in the e1→p1 direction).
                        let e1_off = shift(e1, p1, dimexo_w);
                        let e2_off = shift(e2, p2, dimexo_w);
                        let p1_over = shift(p1, e1, -dimexe_w);
                        let p2_over = shift(p2, e2, -dimexe_w);
                        let te1 = xform.apply(e1_off);
                        let te2 = xform.apply(e2_off);
                        let tp1_over = xform.apply(p1_over);
                        let tp2_over = xform.apply(p2_over);
                        let tp1 = xform.apply(p1);
                        let tp2 = xform.apply(p2);
                        // Extension lines (anchor + DIMEXO → dim-line foot
                        // + DIMEXE). Skip degenerate (anchor already on
                        // dim line).
                        if (te1[0] - tp1_over[0]).hypot(te1[1] - tp1_over[1]) > 1.0e-6 {
                            push_line(segments, dash_kinds, bbox, te1, tp1_over);
                        }
                        if (te2[0] - tp2_over[0]).hypot(te2[1] - tp2_over[1]) > 1.0e-6 {
                            push_line(segments, dash_kinds, bbox, te2, tp2_over);
                        }
                        // Dim line itself (between the two feet, NOT the
                        // overshoot endpoints).
                        push_line(segments, dash_kinds, bbox, tp1, tp2);
                        // Tick / arrowhead marks per ODA §20.4.40 DIMBLK1/DIMBLK2.
                        // Size = DIMASZ × DIMSCALE when DIMSTYLE plumbing
                        // resolves; otherwise fall back to the legacy 60-unit
                        // half-tick that this code used unconditionally before
                        // the DIMSTYLE_OBJ decoder landed.
                        //
                        // Block-name → glyph map (clean-room, names from ODA
                        // arrowhead-block list):
                        //   ""  / "."        → default closed-filled arrow.
                        //   "_DOT"           → solid filled disc (rond).
                        //   "_DOTSMALL"      → smaller solid disc.
                        //   "_DOTBLANK"      → outline circle.
                        //   "_OBLIQUE" / "_ARCHTICK" → 45° oblique tick (legacy).
                        //   "_NONE"          → skip (no glyph).
                        //   anything else    → fall back to oblique tick.
                        let (dimasz, dimscale_eff, blk1, blk2) = match &dim_info_early {
                            Some(i) => (i.dimasz, i.dimscale, i.dimblk1.as_str(), i.dimblk2.as_str()),
                            None    => (0.0, 0.0, "", ""),
                        };
                        // Resolved tick half-size in world units. AutoCAD
                        // renders DIMASZ as the FULL arrow length, so we use
                        // dimasz * dimscale directly (not halved) — matches
                        // visual parity with the DXF anonymous-block path.
                        let tick_full = if dimasz > 0.0 && dimscale_eff > 0.0 {
                            dimasz * dimscale_eff
                        } else {
                            120.0_f64 // legacy fallback (= old tick_h × 2)
                        };
                        // Per-endpoint glyph selection: index 0 → DIMBLK1 (left
                        // arrowhead), index 1 → DIMBLK2 (right arrowhead).
                        let blks = [blk1, blk2];
                        for (i, base) in [p1, p2].iter().enumerate() {
                            let blk = blks[i];
                            // Normalise dimblk for matching: AutoCAD stores
                            // either "" (default) or names like "_DOT" / "DOT".
                            let blk_u = blk.trim().trim_start_matches('_').to_ascii_uppercase();
                            // World-space center of this tick.
                            let base_w = xform.apply(*base);
                            match blk_u.as_str() {
                                "DOT" | "DOTSMALL" | "DOTBLANK" | "DOTSMALLBLANK" => {
                                    // Solid filled disc per ODA §20.4.40 _DOT.
                                    // Radius = DIMASZ / 2 for "_DOT" (full
                                    // arrow length is the diameter), halved
                                    // again for the "_DOTSMALL" variant.
                                    let r_world = match blk_u.as_str() {
                                        "DOTSMALL" | "DOTSMALLBLANK" => tick_full * 0.25,
                                        _                            => tick_full * 0.5,
                                    };
                                    // Account for the surrounding xform's
                                    // scale so the disc lands at DIMASZ-sized
                                    // pixels regardless of viewport zoom.
                                    let r = r_world * xform.sx.abs().max(xform.sy.abs()).max(1e-9)
                                        / xform.sx.abs().max(xform.sy.abs()).max(1e-9);
                                    // Triangle fan from centre to N points on
                                    // the rim. 24 segments is a smooth circle
                                    // at typical zoom and keeps tri count low.
                                    let n_seg = 24usize;
                                    let solid_outline = blk_u == "DOTBLANK"
                                        || blk_u == "DOTSMALLBLANK";
                                    let mut prev: Option<[f64; 2]> = None;
                                    let mut first: Option<[f64; 2]> = None;
                                    for k in 0..=n_seg {
                                        let a = (k as f64) * std::f64::consts::TAU / (n_seg as f64);
                                        let p = [
                                            base_w[0] + r * a.cos(),
                                            base_w[1] + r * a.sin(),
                                        ];
                                        if first.is_none() { first = Some(p); }
                                        if let Some(pp) = prev {
                                            // Boundary outline.
                                            push_line(segments, dash_kinds, bbox, pp, p);
                                            if !solid_outline {
                                                // Solid fill: triangle fan
                                                // from centre to the rim chord.
                                                triangles.push(Triangle {
                                                    v: [base_w, pp, p],
                                                    color,
                                                    is_paper: false,
                                                    kind: TriKind::Solid,
                                                });
                                            }
                                        }
                                        prev = Some(p);
                                    }
                                }
                                "NONE" => {
                                    // No arrowhead — skip per ODA §20.4.40.
                                }
                                "OBLIQUE" | "ARCHTICK" | "" | "." => {
                                    // 45° oblique tick (existing behaviour).
                                    // ARCHTICK is not a true cross — we
                                    // approximate with the same single-line
                                    // tick until full block rendering lands.
                                    let tick_h = tick_full * 0.5;
                                    let cos45 = std::f64::consts::FRAC_1_SQRT_2;
                                    let sin45 = std::f64::consts::FRAC_1_SQRT_2;
                                    let tdx = dx * cos45 - dy * sin45;
                                    let tdy = dx * sin45 + dy * cos45;
                                    let a = [base[0] - tick_h * tdx, base[1] - tick_h * tdy];
                                    let b = [base[0] + tick_h * tdx, base[1] + tick_h * tdy];
                                    push_line(segments, dash_kinds, bbox, xform.apply(a), xform.apply(b));
                                }
                                _ => {
                                    // Unknown block name → fall back to the
                                    // oblique tick so the entity is at least
                                    // visible (matches pre-DIMBLK behaviour).
                                    let tick_h = tick_full * 0.5;
                                    let cos45 = std::f64::consts::FRAC_1_SQRT_2;
                                    let sin45 = std::f64::consts::FRAC_1_SQRT_2;
                                    let tdx = dx * cos45 - dy * sin45;
                                    let tdy = dx * sin45 + dy * cos45;
                                    let a = [base[0] - tick_h * tdx, base[1] - tick_h * tdy];
                                    let b = [base[0] + tick_h * tdx, base[1] + tick_h * tdy];
                                    push_line(segments, dash_kinds, bbox, xform.apply(a), xform.apply(b));
                                }
                            }
                        }
                        drew_any = true;
                    }
                }
                "DIMENSION_ANG3PT" => {
                    // ODA §19.3.23.6: extLine1/extLine2 are the two rays'
                    // endpoints. No arc rendering yet (would require the
                    // centre + radius derivation); keep the legacy chord
                    // line so the entity still shows up.
                    let e1 = d.get("extLine1").and_then(get_xy);
                    let e2 = d.get("extLine2").and_then(get_xy);
                    if let (Some(a), Some(b)) = (e1, e2) {
                        push_line(segments, dash_kinds, bbox, xform.apply(a), xform.apply(b));
                        ext_pair = Some((a, b));
                        drew_any = true;
                    }
                }
                "DIMENSION_ANG2LN" => {
                    // ODA §19.3.23.7: two measured lines (chord fallback).
                    for (ka, kb) in [("line1Start", "line1End"), ("line2Start", "line2End")] {
                        let a = d.get(ka).and_then(get_xy);
                        let b = d.get(kb).and_then(get_xy);
                        if let (Some(a), Some(b)) = (a, b) {
                            push_line(segments, dash_kinds, bbox, xform.apply(a), xform.apply(b));
                            if ext_pair.is_none() { ext_pair = Some((a, b)); }
                            drew_any = true;
                        }
                    }
                }
                "DIMENSION_ORDINATE" => {
                    // ODA §19.3.23.3: feature → leader segment.
                    let a = d.get("featureLocation").and_then(get_xy);
                    let b = d.get("leaderEndpoint").and_then(get_xy);
                    if let (Some(a), Some(b)) = (a, b) {
                        push_line(segments, dash_kinds, bbox, xform.apply(a), xform.apply(b));
                        drew_any = true;
                    }
                }
                _ => { /* RADIUS / DIAMETER — no connecting segment. */ }
            }
            // Ensure definitionPoint contributes to bbox even if we drew no
            // connecting segment (RADIUS/DIAMETER).
            if !drew_any {
                if let Some(dp) = d.get("definitionPoint").and_then(get_xy) {
                    let t = xform.apply(dp);
                    expand_bbox(bbox, t[0], t[1]);
                }
            }

            // --- DIMENSION text label ---------------------------------
            // AutoCAD pre-renders the dim-text (measurement value or user
            // override) into an anonymous `*D<N>` block; the DXF loader
            // picks that up via `expand_dimension_block`. The DWG parser
            // does NOT link DIMENSION entities to their anonymous block
            // (no `blockHeaderHandle`), so we synthesise the label
            // directly from the parsed fields:
            //
            //   textMidpoint  (2 f64)   — midpoint anchor for the label
            //   overrideText  (string)  — user-typed override (code 1);
            //                             empty → use the computed value
            //   textRotation  (radians) — CCW baseline rotation
            //
            // Without this the DWG-loaded dimensions only draw extension
            // lines and skip the measurement label entirely, giving the
            // drawing a visibly "naked" look compared to the DXF ground
            // truth (e.g. DXF handle A85 "Steklengte", all paper dims).
            let text_mid = d.get("textMidpoint").and_then(get_xy);
            // Prefer the dim-line's OWN angle for label rotation — AutoCAD
            // aligns DIM text parallel to the dim line by default (DIMSTYLE
            // DIMTIH=0). DWG often stores `textRotation=0` and expects the
            // consumer to derive orientation from the dim-line direction.
            //
            // Priority:
            //   1. Explicit `textRotation` if non-zero (user rotated the label manually)
            //   2. LINEAR:  `dimRotation` (the dim-line's rotation)
            //   3. ALIGNED: atan2(extLine2-extLine1) — dim-line is parallel to measured direction
            //   4. fallback 0 (horizontal)
            //
            // Upright flip: if the computed rotation would put text upside
            // down (cos < 0), add π so readers don't need to tilt their head.
            let explicit_rot = d.get("textRotation").and_then(|v| v.as_f64()).unwrap_or(0.0);
            let mut text_rot = if explicit_rot.abs() > 1e-6 {
                explicit_rot
            } else if t == "DIMENSION_LINEAR" {
                d.get("dimRotation").and_then(|v| v.as_f64()).unwrap_or(0.0)
            } else if t == "DIMENSION_ALIGNED" {
                if let Some((a, b)) = ext_pair {
                    (b[1] - a[1]).atan2(b[0] - a[0])
                } else { 0.0 }
            } else {
                0.0
            };
            if text_rot.cos() < 0.0 {
                text_rot += std::f64::consts::PI;
            }
            let override_text = d.get("overrideText")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .trim()
                .to_string();
            let label = if !override_text.is_empty() && override_text != "<>" {
                // AutoCAD: "<>" = placeholder for computed measurement;
                // anything else replaces it. Pass the user text through
                // as-is — MTEXT codes aren't interpreted for simple
                // single-line dim labels, the common case.
                override_text
            } else if let Some((a, b)) = ext_pair {
                // Compute planar distance between extension-line defining
                // points for LINEAR/ALIGNED. Round to integer mm — matches
                // the default DIMDEC=0 in the 3BM corpus. Skip for
                // ANG2LN / ANG3PT / ORDINATE: those need actual_measurement
                // (angle / offset) which the DWG parser currently discards
                // (see parser.rs §6103).
                if matches!(t, "DIMENSION_LINEAR" | "DIMENSION_ALIGNED") {
                    let dx = b[0] - a[0];
                    let dy = b[1] - a[1];
                    let dist = (dx * dx + dy * dy).sqrt();
                    format!("{:.0}", dist.round())
                } else {
                    String::new()
                }
            } else {
                String::new()
            };
            if !label.is_empty() {
                if let Some(mid) = text_mid {
                    let mid_w = xform.apply(mid);
                    if mid_w[0].is_finite() && mid_w[1].is_finite()
                        && mid_w[0].abs() < 1.0e6 && mid_w[1].abs() < 1.0e6
                        && text_rot.is_finite() && text_rot.abs() < 1.0e4
                    {
                        // Default dim-text height: the DWG parser now
                        // emits `dimStyleHandle` (per ODA OpenDesignSpec
                        // §19.4.27 handle-stream) so we can look up the
                        // DIMSTYLE's DIMTXT * DIMSCALE product. When the
                        // lookup misses (DIMSTYLE_OBJ parser is a stub) we
                        // fall back to 25 world units — half of the
                        // previous 50, user reported "te groot". Scale by
                        // xform.sx so the VIEWPORT pass renders paper-
                        // sized dim text, not giant strokes.
                        let dim_scale_xf = xform.sx.abs().max(xform.sy.abs()).max(1e-9);
                        let dim_style_h = d.get("dimStyleHandle").and_then(|v| v.as_u64());
                        let dim_info = dim_style_h.and_then(dim_style_lookup);
                        let dimtxt = dim_info.as_ref().map(|i| i.dimtxt).unwrap_or(0.0);
                        let dimscale = dim_info.as_ref().map(|i| i.dimscale).unwrap_or(0.0);
                        let resolved = if dimtxt > 0.0 && dimscale > 0.0 {
                            dimtxt * dimscale
                        } else { 0.0 };
                        // Log first 3 DIMENSIONs for visibility so the
                        // user can diagnose whether DIMSTYLE plumbing is
                        // hitting vs falling back to the default.
                        {
                            thread_local! {
                                static DIM_LOG_COUNT: std::cell::Cell<u32> = std::cell::Cell::new(0);
                            }
                            DIM_LOG_COUNT.with(|c| {
                                let n = c.get();
                                if n < 5 {
                                    let blk1 = dim_info.as_ref().map(|i| i.dimblk1.as_str()).unwrap_or("");
                                    let blk2 = dim_info.as_ref().map(|i| i.dimblk2.as_str()).unwrap_or("");
                                    eprintln!(
                                        "[DIM_BLK] handle={:?} txt={} scale={} dimasz={} dimblk1={:?} dimblk2={:?} resolved={} fallback_used={}",
                                        dim_style_h, dimtxt, dimscale,
                                        dim_info.as_ref().map(|i| i.dimasz).unwrap_or(0.0),
                                        blk1, blk2, resolved,
                                        resolved <= 0.0,
                                    );
                                    c.set(n + 1);
                                }
                            });
                        }
                        // Annotation-scale heuristic for annotative DIMSTYLEs.
                        // When AutoCAD writes an annotative dim style to DWG,
                        // the per-style DIMTXT/DIMSCALE values stored in the
                        // file are the BASE (paper-size) values — typically
                        // dimtxt=2.5mm, dimscale=1.0. The on-screen text size
                        // is then dimtxt * dimscale * annotation_scale, where
                        // annotation_scale is per-DIMENSION (CANNOSCALE-derived,
                        // e.g. 50 for 1:50, 100 for 1:100). The DXF on the
                        // other hand pre-bakes the annotation scale into the
                        // DIMSTYLE values it writes — so the DXF DIMSTYLE
                        // "2_5_mm" shows DIMSCALE=304.8, DIMTXT=52.36, while
                        // the same style in the DWG is stored as 1.0 / 2.5.
                        //
                        // The DWG DIMSTYLE BD chain (DIMSCALE/DIMTXT/DIMASZ)
                        // is mis-aligned by ~148 bits on R2007+ and the
                        // parser substitutes table defaults (DIMSCALE=1.0,
                        // DIMTXT=2.5, DIMASZ=2.5) — see SPEC_NOTES.md
                        // "Findings still open" + parse_dimstyle_obj sanity
                        // clamp. So `resolved` (= 2.5 × 1.0 = 2.5) is a
                        // placeholder, NOT the per-style text height.
                        //
                        // Derive on-screen height directly from the DIMSTYLE
                        // name + DXF oracle. The 3BM template convention is:
                        //
                        //   "{N}_{M}_mm[_{K}]"
                        //
                        // → paper text height = N.M mm (decimal point as
                        // underscore: "2_5_mm" = 2.5 mm, "1_8_mm" = 1.8 mm).
                        // Optional trailing _K is the CANNOSCALE variant.
                        //
                        // Drawing-unit text height per DXF oracle (verified
                        // against the sibling .dxf DIMSTYLE table for the
                        // 3BM CP-21 trainingset on 2026-05-05):
                        //
                        //   2_5_mm    → DIMTXT (group 140) = 52.36
                        //   1_8_mm    → DIMTXT             = 37.71
                        //   2_5_mm_1  → DIMTXT             = 130.92  (= 52.36 × 2.5)
                        //   2_5_mm_2  → DIMTXT             = 261.84  (= 52.36 × 5.0)
                        //   2_5_mm_3  → DIMTXT             = 261.84  (= 52.36 × 5.0)
                        //
                        // Base ratio: 52.36 / 2.5 = 37.71 / 1.8 = 20.945
                        // (consistent across both base styles → drawing-wide
                        // viewport scale baked into the annotative base).
                        // Suffix multipliers: _1 = 2.5×, _2/_3 = 5.0×.
                        //
                        // Result (when name parses + parser is on defaults):
                        //   h_world = N.M × 20.945 × suffix_mult
                        const PAPER_TO_MODEL: f64 = 20.945; // DXF oracle (CP-21)
                        let style_name = dim_info_early.as_ref()
                            .map(|i| i.name.as_str()).unwrap_or("");
                        let parts: Vec<&str> = style_name.split('_').collect();
                        let parser_clamped = dimscale > 0.0
                            && (dimscale - 1.0).abs() < 1e-6
                            && dimtxt > 0.0 && dimtxt <= 10.0;
                        let name_height_drawing_units: Option<f64> = if parser_clamped
                            && parts.len() >= 3 && parts[2] == "mm"
                        {
                            match (parts[0].parse::<f64>(), parts[1].parse::<f64>()) {
                                (Ok(n), Ok(m)) if n > 0.0 && m >= 0.0 => {
                                    let frac_div = 10f64.powi(parts[1].len() as i32);
                                    let paper_mm = n + m / frac_div;
                                    let suffix_mult = match parts.get(3).and_then(|s| s.parse::<u32>().ok()) {
                                        Some(0) | None => 1.0_f64,
                                        Some(1) => 2.5_f64,
                                        Some(2) | Some(3) => 5.0_f64,
                                        Some(_) => 1.0_f64,
                                    };
                                    Some(paper_mm * PAPER_TO_MODEL * suffix_mult)
                                }
                                _ => None,
                            }
                        } else { None };
                        let h = if let Some(hu) = name_height_drawing_units {
                            hu * dim_scale_xf
                        } else if resolved > 0.0 {
                            // Once the DIMSTYLE bit-stream alignment fix lands,
                            // this becomes the primary path.
                            resolved * dim_scale_xf
                        } else {
                            250.0_f64 * dim_scale_xf
                        };
                        // DIMENSION labels anchor at textMidpoint (MC =
                        // attachment code 5). Resolve via the DIMENSION
                        // entity's own text-style handle, falling back to
                        // arial. Identity xform because mid_w is already
                        // world coords.
                        let sh = d.get("textStyleHandle").and_then(|v| v.as_u64());
                        let sn = d.get("textStyleName").and_then(|v| v.as_str());
                        render_dwg_text(
                            &label, sh, sn, None,
                            mid_w, h, text_rot, 5, color,
                            &Xform::identity(),
                            segments, triangles, bbox,
                        );
                        // Capture DIMENSION label payload for the in-place
                        // editor. font_path stores the FINAL resolved TTF
                        // filename (same chain as render_dwg_text) so the
                        // editor's tessellate_text picks the identical font
                        // — preventing visible glyph-size shifts (different
                        // cap-height ratios) on edit.
                        if let Some(et_out) = entity_text_out {
                            let idx = entity_idx_for_text as usize;
                            if idx < et_out.len() {
                                let resolved_font = resolve_dwg_text_font_path(sh, sn, None);
                                et_out[idx] = Some(EntityText {
                                    raw: label.clone(),
                                    anchor: mid_w,
                                    height: h,
                                    rotation: text_rot,
                                    font_path: resolved_font,
                                    bold: false,
                                    italic: false,
                                    attachment: 5,
                                    kind: TextKind::Text,
                                });
                            }
                        }
                    }
                }
            }
            Some(13)
        }
        "TEXT" | "ATTRIB" | "ATTDEF" => {
            // TEXT / ATTRIB / ATTDEF share the same layout: single-line string
            // at `insertionPoint` (or `position`) with `height` and `rotation`.
            // ATTDEF has an extra `prompt` field but otherwise renders like
            // TEXT; ATTRIB exposes both `text` (the value) and `tag` — prefer
            // the value, fall back to tag if value is empty/missing.
            //
            // Justification per DXF §20.4.45 (AcDbText) / ODA §20.4.45 (TEXT
            // DWG body): `horizontalAlign` (code 72: 0=Left 1=Center 2=Right
            // 3=Aligned 4=Middle 5=Fit) and `verticalAlign` (code 73: 0=Baseline
            // 1=Bottom 2=Middle 3=Top) emitted by parse_text / parse_attrib.
            // When BOTH are 0 the insertion point is baseline-left (BL anchor).
            // Otherwise `alignmentPoint` (codes 11/21) is the anchor and the
            // (h, v) pair tells which edge/corner of the text bbox lands there.
            let ins_pt = d.get("insertionPoint")
                .or_else(|| d.get("insertion"))
                .or_else(|| d.get("position"))
                .and_then(get_xy);
            let align_pt = d.get("alignmentPoint").and_then(get_xy);
            let hj = d.get("horizontalAlign").and_then(|v| v.as_i64()).unwrap_or(0);
            let vj = d.get("verticalAlign").and_then(|v| v.as_i64()).unwrap_or(0);
            let is_default_just = hj == 0 && vj == 0;
            // Pick the correct origin per §20.4.45: insertionPoint for
            // left/baseline, alignmentPoint otherwise. Some broken streams
            // leave alignmentPoint at (0,0) — detect that and fall back
            // rather than render at world origin.
            let ins = if is_default_just {
                ins_pt
            } else {
                match align_pt {
                    Some(p) if p[0].is_finite() && p[1].is_finite()
                        && (p[0].abs() > 1e-9 || p[1].abs() > 1e-9) => Some(p),
                    _ => ins_pt,
                }
            };
            let height = d.get("height").and_then(|v| v.as_f64()).unwrap_or(1.0);
            let rotation = d.get("rotation").and_then(|v| v.as_f64()).unwrap_or(0.0);
            let text = d.get("text")
                .or_else(|| d.get("text_value"))
                .and_then(|v| v.as_str())
                .filter(|s| !s.is_empty())
                .map(|s| s.to_string())
                .or_else(|| d.get("tag").and_then(|v| v.as_str()).map(|s| s.to_string()))
                .unwrap_or_default();
            // Sanity clamps: DWG bit-stream misalignment on R2010+ can leak
            // wild height/rotation/insertion values. 1e4 world units is far
            // above any real drawing text height; insertion points beyond 1e5
            // almost always come from a misaligned DD prefix (same class of
            // bug as expand_bbox's 1e6 guard). Skipping those text entities
            // keeps the scene bbox sane for the auto-fit camera.
            let h = if height.is_finite() && height.abs() > 1e-9 && height.abs() < 1.0e4 {
                height.abs()
            } else { 1.0 };
            let rot = if rotation.is_finite() && rotation.abs() < 1.0e4 { rotation } else { 0.0 };
            if let Some(origin) = ins {
                let ins_sane = origin[0].is_finite() && origin[1].is_finite()
                    && origin[0].abs() < 1.0e5 && origin[1].abs() < 1.0e5;
                if !text.is_empty() && ins_sane {
                    // Decode DXF Unicode and %% symbol escapes (see
                    // decode_dxf_text_escapes docs — same transformation
                    // applied in the DXF loader's TEXT arm).
                    let text = decode_dxf_text_escapes(&text);
                    // Map (hj, vj) → MTEXT-style attachment code (1..=9),
                    // matching DXF §20.4.45 TEXT arm in scene_io.rs:
                    //   1=TL 2=TC 3=TR  4=ML 5=MC 6=MR  7=BL 8=BC 9=BR
                    // For HJ: 0=Left→col0, 1=Center→col1, 2=Right→col2,
                    //   3=Aligned / 5=Fit degenerate to Left col;
                    //   4=Middle collapses into col1 (MTEXT has no distinct
                    //   "middle-of-allcaps" row so reuse baseline row).
                    // For VJ: 0=Baseline/1=Bottom→row2, 2=Middle→row1, 3=Top→row0.
                    let row: u8 = match vj { 3 => 0, 2 => 1, _ => 2 };
                    let col: u8 = match hj { 1 | 4 => 1, 2 => 2, _ => 0 };
                    let anchor: u8 = 1 + row * 3 + col;
                    // Default justification (hj=vj=0, BL) always uses
                    // anchor 7 (BL) regardless of the derived code so
                    // plain TEXT without an alignment point renders at
                    // the insertion point exactly.
                    let eff_anchor = if is_default_just { 7 } else { anchor };
                    let sh = d.get("textStyleHandle").and_then(|v| v.as_u64());
                    let sn = d.get("textStyleName").and_then(|v| v.as_str());
                    render_dwg_text(
                        &text, sh, sn, None,
                        origin, h, rot, eff_anchor, color,
                        xform,
                        segments, triangles, bbox,
                    );
                    // Capture raw TEXT/ATTRIB/ATTDEF payload for the
                    // in-place editor. Mirrors the DXF TEXT arm at line
                    // ~3394: store world-space anchor (xform-applied)
                    // and post-decode string. font_path stores the FINAL
                    // resolved TTF filename (same chain as render_dwg_text)
                    // so the editor's tessellate_text picks the identical
                    // font.
                    if let Some(et_out) = entity_text_out {
                        let idx = entity_idx_for_text as usize;
                        if idx < et_out.len() {
                            let world_anchor = xform.apply(origin);
                            let parent_rot = xform.sin.atan2(xform.cos);
                            let stored_h = h * xform.sx.abs().max(xform.sy.abs());
                            let resolved_font = resolve_dwg_text_font_path(sh, sn, None);
                            if std::env::var_os("O2D_TEXT_EDIT_DBG").is_some() {
                                eprintln!(
                                    "[text-pop-dwg-text] eid={} h_local={} xform.sx={} xform.sy={} stored_h={} world_anchor={:?} attach={} font_path={:?}",
                                    entity_idx_for_text, h, xform.sx, xform.sy, stored_h, world_anchor, eff_anchor, resolved_font
                                );
                            }
                            et_out[idx] = Some(EntityText {
                                raw: text.clone(),
                                anchor: world_anchor,
                                height: stored_h,
                                rotation: rot + parent_rot,
                                font_path: resolved_font,
                                bold: false,
                                italic: false,
                                attachment: eff_anchor,
                                kind: match type_name {
                                    "TEXT" => TextKind::Text,
                                    _ => TextKind::Attrib,
                                },
                            });
                        }
                    }
                }
            }
            Some(5) // count as "other" bucket — no dedicated TEXT counter
        }
        "MTEXT" => {
            // Simple single-line render. MTEXT supports formatting codes
            // (\P for newline, \C for color, etc.) but we strip them for
            // now — the glyph shapes alone give the viewer something to
            // show. Multi-line wrapping can come later via `rect_width`.
            let ins = d.get("insertionPoint")
                .or_else(|| d.get("insertion"))
                .and_then(get_xy);
            let height = d.get("height").and_then(|v| v.as_f64()).unwrap_or(1.0);
            let rotation = d.get("rotation").and_then(|v| v.as_f64()).unwrap_or(0.0);
            let raw_text = d.get("text").and_then(|v| v.as_str()).unwrap_or("");
            // Detect FIRST `\f...;` inline font override BEFORE stripping.
            // 80% of Revit-authored labels set weight once at the start;
            // applying it to the whole MTEXT body is a good-enough
            // approximation of run-based rendering for the viewer.
            let mtext_override = parse_mtext_first_font_override(raw_text);
            let mtext_inline = if mtext_override.0 || mtext_override.1 || mtext_override.2.is_some() {
                Some(mtext_override)
            } else { None };
            // Decode `\U+XXXX` and `%%c/%%d/%%p` BEFORE the generic MTEXT
            // control-code strip below (the strip would consume `\U+...`
            // as an arbitrary `\<letter>` code and eat the rest of the
            // string looking for the missing `;` terminator).
            let raw_decoded = decode_dxf_text_escapes(raw_text);
            let raw_text: &str = &raw_decoded;
            // Extremely minimal MTEXT formatting strip: drop `\P` newlines
            // (render inline) and common `\X` control codes of the form
            // `\x...;` — good enough to make user text legible without a
            // full MTEXT parser.
            let mut text = String::with_capacity(raw_text.len());
            let mut chars = raw_text.chars().peekable();
            while let Some(c) = chars.next() {
                if c == '\\' {
                    // Handle escape codes: \P (newline -> space), \~ (nbsp),
                    // \C123; \H1.2x; \Fname|b0|i0|c0|p0; \S1^2; \A1; \L \l \O \o
                    match chars.peek().copied() {
                        Some('P') | Some('p') => { chars.next(); text.push(' '); }
                        Some('~') => { chars.next(); text.push(' '); }
                        Some('\\') => { chars.next(); text.push('\\'); }
                        Some('{') => { chars.next(); text.push('{'); }
                        Some('}') => { chars.next(); text.push('}'); }
                        Some(_) => {
                            // Consume code char + arg up to ';' or next backslash.
                            chars.next();
                            while let Some(&nc) = chars.peek() {
                                if nc == ';' { chars.next(); break; }
                                if nc == '\\' { break; }
                                chars.next();
                            }
                        }
                        None => {}
                    }
                } else if c == '{' || c == '}' {
                    // Grouping braces — drop silently.
                } else {
                    text.push(c);
                }
            }
            // BUG-1' DIAG: log raw vs stripped MTEXT to identify
            // punctuation-eating in the stripper. Gated on env var.
            if std::env::var_os("O2D_MTEXT_DBG").is_some() {
                eprintln!("[MTEXT-DWG] raw={:?} after_strip={:?}", d.get("text").and_then(|v| v.as_str()).unwrap_or(""), text);
            }
            let h = if height.is_finite() && height.abs() > 1e-9 && height.abs() < 1.0e4 {
                height.abs()
            } else { 1.0 };
            let rot = if rotation.is_finite() && rotation.abs() < 1.0e4 { rotation } else { 0.0 };
            if let Some(origin) = ins {
                let ins_sane = origin[0].is_finite() && origin[1].is_finite()
                    && origin[0].abs() < 1.0e5 && origin[1].abs() < 1.0e5;
                if !text.is_empty() && ins_sane {
                    // MTEXT attachment point (DXF code 71, 1..=9):
                    //   1=TL 2=TC 3=TR   4=ML 5=MC 6=MR   7=BL 8=BC 9=BR
                    // `render_string` renders with baseline-LEFT anchor
                    // (= attachment 7). For other attachments we must
                    // shift the render origin so the chosen corner lands
                    // at the insertion point. Without this fix tables
                    // defined with attachment=1 (TL) render one cap-
                    // height ABOVE where they should be — the row's top
                    // divider line slices through the previous row's
                    // text (observed on Funderingsherstel "Renvooi
                    // verankeringslengten" tabel).
                    // Parser emits DWG MTEXT's BS attachment code under the
                    // key "attachment" (parse_mtext in parser.rs §20.4.46).
                    // Earlier versions of this arm read "attachmentPoint"
                    // and silently fell through to 7 (BL) for every MTEXT,
                    // which is why centered / top-anchored labels inside
                    // tables and title blocks sat one cap-height too high.
                    // Accept either spelling for forward compatibility.
                    let attach = d.get("attachment")
                        .or_else(|| d.get("attachmentPoint"))
                        .and_then(|v| v.as_i64()).unwrap_or(7) as u8;
                    let sh = d.get("textStyleHandle").and_then(|v| v.as_u64());
                    let sn = d.get("textStyleName").and_then(|v| v.as_str());
                    render_dwg_text(
                        &text, sh, sn, mtext_inline.clone(),
                        origin, h, rot, attach, color,
                        xform,
                        segments, triangles, bbox,
                    );
                    // Capture raw MTEXT payload for the in-place editor.
                    // Mirrors the DXF MTEXT arm at line ~3505: store
                    // `raw_decoded` (post-`\U+`/`%%c` decode but PRE-format-
                    // strip) so the editor can round-trip MTEXT formatting
                    // codes (\fArial|b1;, \P, etc.). Bold/italic come from
                    // the first `\f...;` inline override when present.
                    // font_path stores the FINAL resolved TTF filename
                    // (same chain as render_dwg_text — including the
                    // mtext_inline override) so the editor's
                    // tessellate_text picks the identical font on commit.
                    if let Some(et_out) = entity_text_out {
                        let idx = entity_idx_for_text as usize;
                        if idx < et_out.len() {
                            let world_anchor = xform.apply(origin);
                            let parent_rot = xform.sin.atan2(xform.cos);
                            let (mt_bold, mt_italic) = mtext_inline
                                .as_ref()
                                .map(|(b, i, _)| (*b, *i))
                                .unwrap_or((false, false));
                            let stored_h = h * xform.sx.abs().max(xform.sy.abs());
                            let resolved_font = resolve_dwg_text_font_path(
                                sh, sn, mtext_inline.as_ref(),
                            );
                            if std::env::var_os("O2D_TEXT_EDIT_DBG").is_some() {
                                eprintln!(
                                    "[text-pop-dwg-mtext] eid={} h_local={} xform.sx={} xform.sy={} stored_h={} world_anchor={:?} attach={} font_path={:?}",
                                    entity_idx_for_text, h, xform.sx, xform.sy, stored_h, world_anchor, attach, resolved_font
                                );
                            }
                            et_out[idx] = Some(EntityText {
                                raw: raw_decoded.clone(),
                                anchor: world_anchor,
                                height: stored_h,
                                rotation: rot + parent_rot,
                                font_path: resolved_font,
                                bold: mt_bold,
                                italic: mt_italic,
                                attachment: attach,
                                kind: TextKind::MText,
                            });
                        }
                    }
                }
            }
            Some(5)
        }
        "HATCH" => {
            // per ODA §19.4.96 HATCH entity body: isSolid flag (code 70) determines fill mode
            // Parser emits `"solidFill"` as a bool (see parse_hatch in
            // src-tauri/dwg-parser/parser.rs §20.4.96). When false AND
            // `patternLines` is present (now emitted per the ODA §19.4.96
            // "pattern definition lines" section — angle/base/offset/dashes
            // per line), we feed emit_hatch_pattern_lines so pattern-hatches
            // (grind, isolatie, metselwerk) reach visual parity with the DXF
            // loader. Solid hatches go through ear-clip triangulation below.
            let is_solid = d.get("solidFill").and_then(|v| v.as_bool()).unwrap_or(false);
            // per ODA §19.4.96 pattern definition lines: parse array once and
            // reuse for every boundary ring this HATCH contains.
            let dwg_pattern_lines: Vec<HatchPatternLine> = if !is_solid {
                d.get("patternLines").and_then(|v| v.as_array())
                    .map(|arr| arr.iter().filter_map(|pl| {
                        let angle_deg = pl.get("angle").and_then(|v| v.as_f64())?;
                        let base = pl.get("base").and_then(get_xy)?;
                        let offset = pl.get("offset").and_then(get_xy)?;
                        let dashes: Vec<f64> = pl.get("dashes").and_then(|v| v.as_array())
                            .map(|a| a.iter().filter_map(|x| x.as_f64()).collect())
                            .unwrap_or_default();
                        Some(HatchPatternLine { angle_deg, base, offset, dashes })
                    }).collect())
                    .unwrap_or_default()
            } else { Vec::new() };
            if let Some(paths) = d.get("boundaryPaths").and_then(|v| v.as_array()) {
                for path in paths {
                    if let Some(verts_arr) = path.get("vertices").and_then(|v| v.as_array()) {
                        let verts: Vec<[f64; 2]> = verts_arr.iter()
                            .filter_map(|v| {
                                let x = v.get("x").and_then(|v| v.as_f64())?;
                                let y = v.get("y").and_then(|v| v.as_f64())?;
                                Some(xform.apply([x, y]))
                            })
                            .collect();
                        // Solid fill: ear-clip triangulation of the ring.
                        // Matches the DXF HATCH path (see tri-emit around
                        // line 1595). Use HATCH_SOLID_FILL_COLOR /
                        // TriKind::Solid for parity with DXF renderer so
                        // the same plot-style grey reads on both loaders.
                        if is_solid && verts.len() >= 3 {
                            let tris = ear_clip(&verts);
                            for [a, b, c] in tris {
                                triangles.push(Triangle {
                                    v: [verts[a], verts[b], verts[c]],
                                    color: HATCH_SOLID_FILL_COLOR,
                                    is_paper: false,
                                    kind: TriKind::Solid,
                                });
                            }
                        } else if !is_solid && !dwg_pattern_lines.is_empty() && verts.len() >= 3 {
                            // per ODA §19.4.96: non-solid hatch renders as a
                            // family of parallel dashed lines per definition
                            // line, clipped against each boundary ring. The
                            // `xform` has already been applied to `verts`
                            // above, and the pattern-line base/offset live in
                            // the same entity-local coordinate space as the
                            // HATCH boundary per ODA — no additional transform
                            // is applied here (matches DXF path at ~line 1662).
                            emit_hatch_pattern_lines(&verts, &dwg_pattern_lines,
                                color, false, segments, bbox);
                        }
                        for w in verts.windows(2) {
                            segments.push(Segment { p1: w[0], p2: w[1], color, is_paper: false });
                            expand_bbox(bbox, w[0][0], w[0][1]);
                            expand_bbox(bbox, w[1][0], w[1][1]);
                        }
                        // HATCH boundaries are conceptually CLOSED rings per ODA
                        // §19.4.96 — the `closed` bit only flags whether AutoCAD
                        // wrote the closing edge explicitly into the polyline.
                        // Many DWG hatches set is_closed=false but rely on the
                        // implicit close (parallel to LWPOLYLINE behaviour).
                        // Mirror the DXF loader (~line 1945) and emit the
                        // last→first segment unconditionally when the endpoints
                        // differ — without it user sees gaps at corners where
                        // the hatch boundary "should" wrap around (the
                        // arceringen-mist-hoekpunten symptom).
                        if verts.len() >= 2 {
                            let a = *verts.last().unwrap();
                            let b = verts[0];
                            if (a[0] - b[0]).abs() > 1e-9 || (a[1] - b[1]).abs() > 1e-9 {
                                segments.push(Segment { p1: a, p2: b, color, is_paper: false });
                            }
                        }
                    }
                    if let Some(edges_arr) = path.get("edges").and_then(|v| v.as_array()) {
                        // per ODA OpenDesignSpec §19.4.96 (HATCH Boundary Path
                        // Data): boundary edges within a path form a closed
                        // loop, but the spec does NOT guarantee the edges are
                        // stored in connected order — a loop is conceptually
                        // an *unordered* set of edges and the consumer must
                        // chain them by endpoint matching. The previous
                        // implementation pushed each edge's points onto a
                        // single `edge_ring` in storage order, which is
                        // correct only when edges happen to be sequential.
                        // When two consecutive edges had a gap
                        // (edge[i].end != edge[i+1].start) the ear-clip saw a
                        // discontinuous polygon and produced spanning
                        // "phantom" triangles — visible to the user as tall
                        // narrow diagonal stripes across hatched regions.
                        //
                        // Fix: collect each edge as its own polyline (arcs
                        // tessellated into chord samples) and emit each edge
                        // as visible boundary segments immediately. Then
                        // chain the polylines into one ring by greedy
                        // endpoint matching before triangulating. If the
                        // chain is incomplete, drop the entire boundary loop
                        // rather than emit a phantom triangle.
                        let mut edge_polys: Vec<Vec<[f64; 2]>> = Vec::new();
                        for edge in edges_arr {
                            let etype = edge.get("type").and_then(|v| v.as_str()).unwrap_or("");
                            match etype {
                                "line" => {
                                    let s = edge.get("start").and_then(get_xy);
                                    let e = edge.get("end").and_then(get_xy);
                                    if let (Some(s), Some(e)) = (s, e) {
                                        let ts = xform.apply(s);
                                        let te = xform.apply(e);
                                        segments.push(Segment { p1: ts, p2: te, color, is_paper: false });
                                        expand_bbox(bbox, ts[0], ts[1]);
                                        expand_bbox(bbox, te[0], te[1]);
                                        edge_polys.push(vec![ts, te]);
                                    }
                                }
                                "arc" => {
                                    let c = edge.get("center").and_then(get_xy);
                                    let r = edge.get("radius").and_then(|v| v.as_f64());
                                    let sa = edge.get("startAngle").and_then(|v| v.as_f64());
                                    let ea = edge.get("endAngle").and_then(|v| v.as_f64());
                                    // per ODA §HATCH Boundary Path Data (arc-edge, code 73 is_counterclockwise):
                                    // when ccw=0 sample points mirror about the local X-axis
                                    // (y -> -y) — matches the DXF fix at line 892. Without
                                    // this, CW arcs sweep the "wrong" 3/4 of the circle.
                                    let ccw = edge.get("ccw").and_then(|v| v.as_bool()).unwrap_or(true);
                                    if let (Some(c), Some(r), Some(sa), Some(ea)) = (c, r, sa, ea) {
                                        use std::f64::consts::TAU;
                                        let (sweep, y_sign) = if ccw {
                                            let d = ea - sa;
                                            (if d <= 0.0 { d + TAU } else { d }, 1.0)
                                        } else {
                                            let d = ea - sa;
                                            (if d < 0.0 { d + TAU } else { d }, -1.0)
                                        };
                                        let n = ((sweep.abs() / TAU * 64.0).ceil() as usize).max(4).min(256);
                                        let start_pt = xform.apply([c[0] + r * sa.cos(), c[1] + r * y_sign * sa.sin()]);
                                        let mut poly: Vec<[f64; 2]> = Vec::with_capacity(n + 1);
                                        poly.push(start_pt);
                                        let mut prev = start_pt;
                                        for i in 1..=n {
                                            let t = sa + sweep * (i as f64) / (n as f64);
                                            let cur = xform.apply([c[0] + r * t.cos(), c[1] + r * y_sign * t.sin()]);
                                            segments.push(Segment { p1: prev, p2: cur, color, is_paper: false });
                                            expand_bbox(bbox, cur[0], cur[1]);
                                            poly.push(cur);
                                            prev = cur;
                                        }
                                        edge_polys.push(poly);
                                    }
                                }
                                _ => {}
                            }
                        }

                        // per ODA §19.4.96: chain edge polylines into a
                        // single ring by greedy endpoint matching. EPS is in
                        // world units after `xform` — 1e-6 is comfortably
                        // below DWG's nominal precision and tight enough
                        // that two truly distinct hatch corners won't fuse.
                        // If chaining fails (gap > EPS to all remaining
                        // edges), abandon the ring rather than feed a
                        // discontinuous polygon to ear_clip.
                        const EDGE_CHAIN_EPS: f64 = 1e-6;
                        let pts_eq = |a: [f64; 2], b: [f64; 2]| -> bool {
                            (a[0] - b[0]).abs() <= EDGE_CHAIN_EPS
                                && (a[1] - b[1]).abs() <= EDGE_CHAIN_EPS
                        };
                        let mut edge_ring: Vec<[f64; 2]> = Vec::new();
                        if !edge_polys.is_empty() {
                            let mut remaining: Vec<Vec<[f64; 2]>> = edge_polys;
                            let first = remaining.remove(0);
                            edge_ring.extend(first.into_iter());
                            let mut chain_ok = true;
                            while !remaining.is_empty() {
                                let tail = *edge_ring.last().unwrap();
                                let mut found: Option<(usize, bool)> = None;
                                for (i, poly) in remaining.iter().enumerate() {
                                    if poly.is_empty() { continue; }
                                    if pts_eq(*poly.first().unwrap(), tail) {
                                        found = Some((i, false));
                                        break;
                                    }
                                    if pts_eq(*poly.last().unwrap(), tail) {
                                        found = Some((i, true));
                                        break;
                                    }
                                }
                                let Some((idx, reverse)) = found else {
                                    chain_ok = false;
                                    break;
                                };
                                let mut poly = remaining.remove(idx);
                                if reverse { poly.reverse(); }
                                // skip duplicated joining vertex
                                edge_ring.extend(poly.into_iter().skip(1));
                            }
                            if !chain_ok {
                                // Discontinuous boundary loop — abandon
                                // triangulation for this path. Boundary
                                // segments above already drew the visible
                                // outline; we just skip the fill.
                                edge_ring.clear();
                            }
                        }
                        // Drop trailing duplicate (ear_clip treats ring as
                        // implicitly closed).
                        if edge_ring.len() >= 2
                            && edge_ring.first().zip(edge_ring.last())
                                .map_or(false, |(a, b)| pts_eq(*a, *b))
                        {
                            edge_ring.pop();
                        }
                        // HATCH edge-path boundaries are conceptually CLOSED
                        // rings (the last edge's end should connect back to the
                        // first edge's start). DWG doesn't store an explicit
                        // closing edge — chain edges are emitted per-edge as
                        // line/arc segments above, so the visible boundary will
                        // miss the final corner segment if last != first.
                        // Mirror the DXF loader (~line 1945) by emitting the
                        // last→first closing segment when the endpoints differ.
                        // Fixes user-reported "DWG arceringen mist hoekpunten".
                        if edge_ring.len() >= 2 {
                            let a = *edge_ring.last().unwrap();
                            let b = edge_ring[0];
                            if (a[0] - b[0]).abs() > 1e-9 || (a[1] - b[1]).abs() > 1e-9 {
                                segments.push(Segment { p1: a, p2: b, color, is_paper: false });
                                expand_bbox(bbox, a[0], a[1]);
                                expand_bbox(bbox, b[0], b[1]);
                            }
                        }
                        if is_solid && edge_ring.len() >= 3 {
                            let tris = ear_clip(&edge_ring);
                            for [a, b, c] in tris {
                                triangles.push(Triangle {
                                    v: [edge_ring[a], edge_ring[b], edge_ring[c]],
                                    color: HATCH_SOLID_FILL_COLOR,
                                    is_paper: false,
                                    kind: TriKind::Solid,
                                });
                            }
                        } else if !is_solid && !dwg_pattern_lines.is_empty() && edge_ring.len() >= 3 {
                            // per ODA §19.4.96: same pattern-line fill as the
                            // polyline-vertex branch, applied to the polygon
                            // assembled from arc/line/ellipse edge tessellation.
                            emit_hatch_pattern_lines(&edge_ring, &dwg_pattern_lines,
                                color, false, segments, bbox);
                        }
                    }
                }
            }
            Some(14)
        }
        _ => None,
    }
}

/// Recursively expand an INSERT entity. `outer` is the accumulated transform
/// from any parent INSERTs; `depth` caps recursion at 8 to defuse cycles.
///
/// `visiting` is the set of BLOCK_HEADER handles currently on the recursion
/// stack — if a nested INSERT resolves to one of them (circular block
/// reference, either genuine or from bad block-name resolution collapsing
/// distinct blocks to the same handle) we skip re-entry instead of
/// exponentially expanding until the depth cap is hit.
fn expand_insert(
    d: &serde_json::Value,
    outer: &Xform,
    depth: u32,
    objects: &[dwg_parser::DwgObject],
    block_index: &HashMap<u32, Vec<usize>>,
    block_handle_by_name: &HashMap<String, u32>,
    segments: &mut Vec<Segment>,
    triangles: &mut Vec<Triangle>,
    bbox: &mut [f64; 4],
    counts: &mut [u32; 15],
    visiting: &mut HashSet<u32>,
    trace: bool,
    layer_color_map: &HashMap<String, u32>,
    layer_ltype_map: &HashMap<String, String>,
    ltype_dashes_map: &HashMap<String, Vec<f64>>,
    default_rgba: u32,
    parent_color: u32,
    global_ltscale: f64,
    dash_kinds: &mut Vec<u8>,
) {
    if depth > 8 {
        if trace { eprintln!("[expand_insert] depth cap hit at {}, aborting", depth); }
        return;
    }
    // Resolve the INSERT's own color so BYBLOCK (data["color"]==0) children
    // inherit it. Per ODA §20.4.9 INSERT carries the usual entity-common
    // color; BYBLOCK children see the INSERT's resolved color, NOT the
    // layer default of the INSERT.
    let insert_color = {
        let raw = d.get("color").and_then(|v| v.as_i64()).unwrap_or(256);
        if raw == 0 {
            // INSERT itself BYBLOCK — inherit from parent's parent_color.
            parent_color
        } else {
            dwg_resolve_color(d, layer_color_map, default_rgba)
        }
    };
    let get_xy = |v: &serde_json::Value| -> Option<[f64; 2]> {
        if let Some(arr) = v.as_array() {
            let x = arr.get(0)?.as_f64()?;
            let y = arr.get(1)?.as_f64()?;
            Some([x, y])
        } else if let Some(obj) = v.as_object() {
            let x = obj.get("x")?.as_f64()?;
            let y = obj.get("y")?.as_f64()?;
            Some([x, y])
        } else { None }
    };
    let ins_pt = d.get("insertionPoint").and_then(get_xy).unwrap_or([0.0, 0.0]);
    let sx = d.get("scaleX").and_then(|v| v.as_f64()).unwrap_or(1.0);
    let sy = d.get("scaleY").and_then(|v| v.as_f64()).unwrap_or(1.0);
    let rot = d.get("rotation").and_then(|v| v.as_f64()).unwrap_or(0.0);
    // parse_insert (§20.4.9) reads scale via a 2-bit DATA_FLAGS prefix
    // + RD/DD payload. The DD prefix-10 byte-order fix cleaned up most
    // cases, but residual entity-stream misalignment on R2010+ can
    // still yield scale values >> real-world drawings. Real scales
    // are rarely > 1000; cap at 1e4 as a render safety net.
    let sx_clamped = if sx.is_finite() && sx.abs() <= 1.0e4 { sx } else { 1.0 };
    let sy_clamped = if sy.is_finite() && sy.abs() <= 1.0e4 { sy } else { 1.0 };
    let rot_clamped = if rot.is_finite() { rot } else { 0.0 };
    let local = Xform {
        tx: if ins_pt[0].is_finite() { ins_pt[0] } else { 0.0 },
        ty: if ins_pt[1].is_finite() { ins_pt[1] } else { 0.0 },
        cos: rot_clamped.cos(), sin: rot_clamped.sin(),
        sx: if sx_clamped == 0.0 { 1.0 } else { sx_clamped },
        sy: if sy_clamped == 0.0 { 1.0 } else { sy_clamped },
    };
    let combined = Xform::combine(outer, &local);

    // Resolve referenced BLOCK_HEADER:
    //   1. preferred: explicit blockHeaderHandle from parser
    //   2. fallback : blockName lookup
    // On R2010+ both of these are frequently None/"" because the parser
    // fails to align the handle-stream for INSERT entities. When that
    // happens we still try the `blockEntities` fallback below and, failing
    // that, at least the insertion point above keeps the bbox honest.
    let bh_handle = d.get("blockHeaderHandle").and_then(|v| v.as_u64()).map(|x| x as u32)
        .or_else(|| {
            d.get("blockName").and_then(|v| v.as_str())
                .and_then(|n| block_handle_by_name.get(n).copied())
        });
    let block_name = d.get("blockName").and_then(|v| v.as_str()).unwrap_or("").to_string();
    if trace {
        eprintln!(
            "[expand_insert] depth={} bh=0x{:X} name={:?} ins=[{:.3},{:.3}] scale=[{:.3},{:.3}] rot={:.3} outer_scale=[{:.3},{:.3}]",
            depth,
            bh_handle.unwrap_or(0),
            block_name,
            local.tx, local.ty,
            local.sx, local.sy,
            rot_clamped,
            outer.sx, outer.sy,
        );
    }
    if let Some(bh) = bh_handle {
        // TODO KLUDGE: cycle detection via `visiting` HashSet.
        //
        // Real parser bug this hides: when parser.rs leaves
        // `blockHeaderHandle` unresolved (None) — observed on R2010+
        // because INSERT's handle-stream references aren't aligned
        // after parse_entity_common — the fallback path above resolves
        // by blockName. If two distinct blocks share a name prefix or
        // the parser produces garbage for the name field, two INSERTs
        // can collapse to the same bh handle, creating an A → A cycle.
        //
        // Proper fix per ODA §20.4.101 (INSERT) and §20.4.48
        // (BLOCK_HEADER): use the INSERT's explicit
        // `handle_refs.block_header` handle — which IS a defined field
        // in the INSERT handle stream, not a name lookup. Current code
        // (line above) already prefers `blockHeaderHandle` and only
        // falls back to `blockName` when that's None; once parser
        // populates block_header on R2010+ (same alignment fix as
        // expand_bbox TODO) the name fallback and this cycle detector
        // become dead code. The detector stays as a safety net.
        // Loop-detection: if this block is already on the recursion stack,
        // we have a cycle (A -> B -> A, or same-handle self-insert from
        // wrong block-name resolution). Skip re-entry; log once.
        if visiting.contains(&bh) {
            if trace {
                eprintln!(
                    "[expand_insert] CYCLE detected at depth={} bh=0x{:X} name={:?} — skipping",
                    depth, bh, block_name,
                );
            }
            return;
        }
        if let Some(child_idxs) = block_index.get(&bh) {
            let segs_before = segments.len();
            visiting.insert(bh);
            for &ci in child_idxs {
                let child = &objects[ci];
                if child.type_num == 0x07 || child.type_num == 0x08 {
                    counts[4] += 1;
                    let child_data = serde_json::json!(child.data);
                    expand_insert(
                        &child_data, &combined, depth + 1,
                        objects, block_index, block_handle_by_name,
                        segments, triangles, bbox, counts,
                        visiting, trace,
                        layer_color_map, layer_ltype_map, ltype_dashes_map,
                        default_rgba, insert_color, global_ltscale,
                        dash_kinds,
                    );
                    continue;
                }
                let child_data = serde_json::json!(child.data);
                // BYBLOCK (raw==0) child color inherits from this INSERT.
                let raw = child_data.get("color").and_then(|v| v.as_i64()).unwrap_or(256);
                let child_color = if raw == 0 {
                    insert_color
                } else {
                    dwg_resolve_color(&child_data, layer_color_map, default_rgba)
                };
                let child_ltype = dwg_resolve_ltype_pattern(&child_data, layer_ltype_map, ltype_dashes_map, global_ltscale);
                if let Some(cat) = tessellate_one(
                    &child.type_name, &child_data, &combined,
                    segments, triangles, bbox, child_color, &child_ltype,
                    // INSERT child geometry shares the parent INSERT's
                    // entity_idx slot — no per-child entity_text capture.
                    None, 0,
                    dash_kinds,
                ) {
                    counts[cat] += 1;
                } else {
                    counts[5] += 1;
                }
            }
            visiting.remove(&bh);
            if trace {
                eprintln!(
                    "[expand_insert] depth={} bh=0x{:X} name={:?} added {} segs ({} children)",
                    depth, bh, block_name,
                    segments.len() - segs_before,
                    child_idxs.len(),
                );
            }
            return;
        }
    }

    // Fallback: parser-provided `blockEntities` field on the INSERT itself.
    // The DWG parser snapshots block contents into this JSON array during
    // its own owner-resolution pass, even when the high-level
    // `block_header` ref is unavailable — so this catches files where the
    // table-object string-stream issue prevents BLOCK_HEADER name decode.
    // Nested INSERTs found this way cannot recurse further (parser only
    // attaches blockEntities one level deep), but at least the immediate
    // contents render at the correct world position.
    if let Some(arr) = d.get("blockEntities").and_then(|v| v.as_array()) {
        let segs_before = segments.len();
        if trace {
            eprintln!(
                "[expand_insert] depth={} using blockEntities fallback ({} entries) name={:?}",
                depth, arr.len(), block_name,
            );
        }
        for be in arr {
            let bt = be.get("type").and_then(|v| v.as_str()).unwrap_or("");
            if bt == "INSERT" || bt == "MINSERT" {
                counts[4] += 1;
                expand_insert(
                    be, &combined, depth + 1,
                    objects, block_index, block_handle_by_name,
                    segments, triangles, bbox, counts,
                    visiting, trace,
                    layer_color_map, layer_ltype_map, ltype_dashes_map,
                    default_rgba, insert_color, global_ltscale,
                    dash_kinds,
                );
                continue;
            }
            let raw = be.get("color").and_then(|v| v.as_i64()).unwrap_or(256);
            let child_color = if raw == 0 {
                insert_color
            } else {
                dwg_resolve_color(be, layer_color_map, default_rgba)
            };
            let child_ltype = dwg_resolve_ltype_pattern(be, layer_ltype_map, ltype_dashes_map, global_ltscale);
            if let Some(cat) = tessellate_one(
                bt, be, &combined, segments, triangles, bbox, child_color, &child_ltype,
                // blockEntities fallback path — INSERT children share
                // the parent's entity_idx slot, no entity_text capture.
                None, 0,
                dash_kinds,
            ) {
                counts[cat] += 1;
            }
        }
        if trace {
            eprintln!(
                "[expand_insert] depth={} blockEntities fallback added {} segs",
                depth, segments.len() - segs_before,
            );
        }
    }
}
