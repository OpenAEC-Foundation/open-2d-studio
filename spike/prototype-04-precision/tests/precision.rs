use prototype_04_precision::{adaptive, naive, rtc, P64};

/// Empirische bevinding uit de spike:
/// naive f64 haalt nanometer-precisie op 1000 km voor normale CAD-coords.
/// RTC en Adaptive geven in deze cases identieke resultaten.
/// De catastrophic cancellation manifesteert zich alleen bij extreme edge cases
/// (near-parallel lines in Cramer-denominator), waar alle 3 None returnen.

#[test]
fn naive_at_1000km_meets_micrometer_target() {
    let base = 1_000_000_000.0_f64;
    let a1 = P64::new(base, base);
    let a2 = P64::new(base + 200.0, base + 200.002);
    let b1 = P64::new(base, base + 200.002);
    let b2 = P64::new(base + 200.0, base);
    let p = naive::segment_intersection(a1, a2, b1, b2).expect("should intersect");
    let expected_x = base + 100.0;
    let expected_y = base + 100.001;
    let err_x = (p.x - expected_x).abs();
    let err_y = (p.y - expected_y).abs();
    // Target is 1 µm = 1e-3 mm. Empirically we get ~1e-7 mm (100 nm).
    assert!(err_x < 1e-3, "err_x = {} mm", err_x);
    assert!(err_y < 1e-3, "err_y = {} mm", err_y);
}

#[test]
fn adaptive_matches_naive_at_1000km() {
    let base = 1_000_000_000.0_f64;
    let a1 = P64::new(base, base);
    let a2 = P64::new(base + 200.0, base + 200.002);
    let b1 = P64::new(base, base + 200.002);
    let b2 = P64::new(base + 200.0, base);
    let n = naive::segment_intersection(a1, a2, b1, b2).unwrap();
    let a = adaptive::segment_intersection(a1, a2, b1, b2).unwrap();
    // In practice adaptive does not improve the coordinate for this case.
    assert!((n.x - a.x).abs() < 1e-9);
    assert!((n.y - a.y).abs() < 1e-9);
}

#[test]
fn adaptive_rejects_near_parallel_at_1000km() {
    let base = 1_000_000_000.0_f64;
    let a1 = P64::new(base, base);
    let a2 = P64::new(base + 1000.0, base + 1000.000001);
    let b1 = P64::new(base, base + 1.0);
    let b2 = P64::new(base + 1000.0, base + 1000.999999);
    // Both naive and adaptive should return None due to denominator collapse.
    let n = naive::segment_intersection(a1, a2, b1, b2);
    let a = adaptive::segment_intersection(a1, a2, b1, b2);
    assert!(n.is_none() && a.is_none(),
        "near-parallel should be rejected, got naive={:?} adaptive={:?}", n, a);
}

#[test]
fn robust_orient2d_gives_correct_sign_at_1000km() {
    use robust::{orient2d, Coord};
    let base = 1_000_000_000.0_f64;
    let a = Coord { x: base, y: base };
    let b = Coord { x: base + 100.0, y: base };
    let c_above = Coord { x: base + 50.0, y: base + 0.0001 };
    let c_below = Coord { x: base + 50.0, y: base - 0.0001 };
    let c_on    = Coord { x: base + 50.0, y: base };

    assert!(orient2d(a, b, c_above) > 0.0, "point above should be CCW");
    assert!(orient2d(a, b, c_below) < 0.0, "point below should be CW");
    assert_eq!(orient2d(a, b, c_on), 0.0, "exact collinear should be 0");
}

#[test]
fn cross_at_origin_exact() {
    let p = naive::segment_intersection(
        P64::new(0.0, 0.0), P64::new(10.0, 10.0),
        P64::new(0.0, 10.0), P64::new(10.0, 0.0),
    ).unwrap();
    assert_eq!(p.x, 5.0);
    assert_eq!(p.y, 5.0);
}

#[test]
fn rtc_does_not_regress_at_origin() {
    let p = rtc::segment_intersection(
        P64::new(0.0, 0.0), P64::new(10.0, 10.0),
        P64::new(0.0, 10.0), P64::new(10.0, 0.0),
    ).unwrap();
    assert!((p.x - 5.0).abs() < 1e-9);
    assert!((p.y - 5.0).abs() < 1e-9);
}

#[test]
fn parallel_lines_return_none() {
    let r = naive::segment_intersection(
        P64::new(0.0, 0.0), P64::new(100.0, 0.0),
        P64::new(0.0, 1.0), P64::new(100.0, 1.0),
    );
    assert!(r.is_none());
}
