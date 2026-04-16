use robust::{orient2d, Coord};

/// 2D point in f64 world coordinates (mm).
#[derive(Copy, Clone, Debug, PartialEq)]
pub struct P64 { pub x: f64, pub y: f64 }

impl P64 {
    pub const fn new(x: f64, y: f64) -> Self { Self { x, y } }
    pub fn to_coord(self) -> Coord<f64> { Coord { x: self.x, y: self.y } }
}

// ── Implementation 1: Naive f64 Cramer's rule ────────────────────────────
pub mod naive {
    use super::P64;

    pub fn segment_intersection(a1: P64, a2: P64, b1: P64, b2: P64) -> Option<P64> {
        let dax = a2.x - a1.x;
        let day = a2.y - a1.y;
        let dbx = b2.x - b1.x;
        let dby = b2.y - b1.y;
        let denom = dax * dby - day * dbx;
        if denom.abs() < f64::EPSILON { return None; }
        let sx = b1.x - a1.x;
        let sy = b1.y - a1.y;
        let t = (sx * dby - sy * dbx) / denom;
        let u = (sx * day - sy * dax) / denom;
        if t < 0.0 || t > 1.0 || u < 0.0 || u > 1.0 { return None; }
        Some(P64::new(a1.x + t * dax, a1.y + t * day))
    }
}

// ── Implementation 2: RTC (local origin rescue) ──────────────────────────
// Translates all 4 points to a local origin at their centroid, computes
// intersection in local f64, then translates result back. Substantially
// improves precision at large world coordinates.
pub mod rtc {
    use super::P64;

    pub fn segment_intersection(a1: P64, a2: P64, b1: P64, b2: P64) -> Option<P64> {
        let ox = (a1.x + a2.x + b1.x + b2.x) * 0.25;
        let oy = (a1.y + a2.y + b1.y + b2.y) * 0.25;
        let shift = |p: P64| P64::new(p.x - ox, p.y - oy);
        let result = super::naive::segment_intersection(
            shift(a1), shift(a2), shift(b1), shift(b2),
        )?;
        Some(P64::new(result.x + ox, result.y + oy))
    }
}

// ── Implementation 3: Shewchuk adaptive predicates + RTC ─────────────────
// Uses robust::orient2d for straddle test (exact sign), then RTC rescue for
// the intersection coordinate. This is what the production kernel would use.
pub mod adaptive {
    use super::{P64, orient2d};

    pub fn segment_intersection(a1: P64, a2: P64, b1: P64, b2: P64) -> Option<P64> {
        // Step 1: use exact orient2d to check straddle
        let o1 = orient2d(a1.to_coord(), a2.to_coord(), b1.to_coord());
        let o2 = orient2d(a1.to_coord(), a2.to_coord(), b2.to_coord());
        let o3 = orient2d(b1.to_coord(), b2.to_coord(), a1.to_coord());
        let o4 = orient2d(b1.to_coord(), b2.to_coord(), a2.to_coord());

        let straddle_a = (o1 > 0.0) != (o2 > 0.0) && o1 != 0.0 && o2 != 0.0;
        let straddle_b = (o3 > 0.0) != (o4 > 0.0) && o3 != 0.0 && o4 != 0.0;
        if !(straddle_a && straddle_b) { return None; }

        // Step 2: compute coordinate via RTC
        super::rtc::segment_intersection(a1, a2, b1, b2)
    }
}

#[cfg(test)]
mod probe {
    use super::*;

    /// Probe: does robust::orient2d even exist with this signature?
    #[test]
    fn probe_orient2d_api() {
        let a = Coord { x: 0.0f64, y: 0.0 };
        let b = Coord { x: 10.0f64, y: 0.0 };
        let c = Coord { x: 5.0f64, y: 1.0 };
        let o = orient2d(a, b, c);
        assert!(o > 0.0); // counter-clockwise = positive
    }
}
