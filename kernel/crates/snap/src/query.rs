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
/// point only when both parameters t,s are in [0,1].
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
/// foot from `last_pick` lies within tolerance of cursor.
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
/// straight lines, so tangent has no work — returns None until Phase B.
fn tangent(_cursor: [f64; 2], _ctx: &SnapContext<'_>, _tol2: f64) -> Option<SnapResult> {
    None
}

/// Parallel: from `last_pick`, find a direction parallel to a nearby
/// segment that the cursor approximately lies along.
fn parallel(cursor: [f64; 2], ctx: &SnapContext<'_>, tol2: f64) -> Option<SnapResult> {
    let lp = ctx.last_pick?;
    let cdx = cursor[0] - lp[0];
    let cdy = cursor[1] - lp[1];
    let clen = (cdx * cdx + cdy * cdy).sqrt();
    if clen < 1e-9 { return None; }
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

/// Alignment: cursor lies along a horizontal or vertical line through
/// any of the tracked key points.
fn alignment(cursor: [f64; 2], ctx: &SnapContext<'_>, tol2: f64) -> Option<SnapResult> {
    let mut best: Option<(f64, [f64; 2])> = None;
    for &kp in ctx.key_points.iter() {
        // Horizontal alignment: snap cursor.y → kp.y
        let snapped_h = [cursor[0], kp[1]];
        let d = dist2(snapped_h, cursor);
        if d <= tol2 && best.map_or(true, |(bd, _)| d < bd) {
            best = Some((d, snapped_h));
        }
        // Vertical alignment: snap cursor.x → kp.x
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
