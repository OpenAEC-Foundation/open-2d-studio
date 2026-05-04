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
        for pt in &[p1, p2] {
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
