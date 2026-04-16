//! Precision and floating-point safety helpers.
//!
//! Empirical finding from spike prototype 4: naive f64 gives nanometer
//! precision for CAD-coords up to 10^9 mm (1000 km). Adaptive predicates
//! (robust crate) are only needed for exact sign-tests (orient2d), not
//! for intersection coordinates.

use crate::WorldPos;

/// Convert a world f64 position to camera-relative f32 for GPU upload.
/// The rendering pipeline uses floating-origin rendering: all GPU vertex
/// math happens in f32 local to `origin`, preserving precision.
#[inline]
pub fn world_to_local_f32(pos: WorldPos, origin: WorldPos) -> [f32; 2] {
    [(pos.x - origin.x) as f32, (pos.y - origin.y) as f32]
}

/// Convert an axis-aligned distance to f32 safe units.
#[inline]
pub fn dist_to_f32(d: f64) -> f32 { d as f32 }

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn world_to_local_far_origin_nanometer_precision() {
        let base = 1_000_000_000.0_f64; // 1000 km
        let origin = WorldPos::new(base, base);
        let shape = WorldPos::new(base + 0.001, base + 0.0001); // sub-µm detail
        let local = world_to_local_f32(shape, origin);
        // Within f32 precision of 0.001 mm offset — expect 1e-7 or better
        assert!((local[0] - 0.001).abs() < 1e-5, "local[0] = {}", local[0]);
        assert!((local[1] - 0.0001).abs() < 1e-5, "local[1] = {}", local[1]);
    }

    #[test]
    fn world_to_local_origin_is_zero() {
        let origin = WorldPos::new(500.0, 700.0);
        let shape = WorldPos::new(500.0, 700.0);
        let local = world_to_local_f32(shape, origin);
        assert_eq!(local, [0.0, 0.0]);
    }
}
