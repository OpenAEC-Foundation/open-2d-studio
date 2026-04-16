use prototype_04_precision::{adaptive, naive, rtc, P64};

fn run_case(name: &str, a1: P64, a2: P64, b1: P64, b2: P64, expected: P64) {
    println!("\n=== {} ===", name);
    println!("Expected:              ({:.9}, {:.9})", expected.x, expected.y);

    let n = naive::segment_intersection(a1, a2, b1, b2);
    let r = rtc::segment_intersection(a1, a2, b1, b2);
    let ad = adaptive::segment_intersection(a1, a2, b1, b2);

    let fmt = |p: Option<P64>| -> String {
        match p {
            Some(pt) => format!(
                "({:.9}, {:.9})  err_x={:.6e}  err_y={:.6e}",
                pt.x, pt.y,
                (pt.x - expected.x).abs(), (pt.y - expected.y).abs()
            ),
            None => "None".into(),
        }
    };

    println!("Naive:    {}", fmt(n));
    println!("RTC:      {}", fmt(r));
    println!("Adaptive: {}", fmt(ad));
}

fn main() {
    // Case 1: original spike test — large base, relatively benign direction vectors
    let base = 1_000_000_000.0_f64;
    run_case(
        "Case 1: 1000 km base, balanced diagonals",
        P64::new(base, base),
        P64::new(base + 200.0, base + 200.002),
        P64::new(base, base + 200.002),
        P64::new(base + 200.0, base),
        P64::new(base + 100.0, base + 100.001),
    );

    // Case 2: near-parallel lines on 1000 km base — cancellation in denominator
    // This is the *real* Professor concern: two lines with nearly identical slope
    // produce a tiny denominator in Cramer's rule after f64 subtraction on 10^9.
    run_case(
        "Case 2: near-parallel lines (cancellation in denom)",
        P64::new(base, base),
        P64::new(base + 1000.0, base + 1000.000001), // slope ~= 1.000000001
        P64::new(base, base + 1.0),
        P64::new(base + 1000.0, base + 1000.999999), // slope ~= 0.999999999
        // Crossing point is near x=base+500 with f64 math, but exact expected
        // requires high-precision calc. We'll just show what each method says.
        P64::new(f64::NAN, f64::NAN), // no known exact expected
    );

    // Case 3: very small crossing angle at 1000 km — worst case for cancellation
    run_case(
        "Case 3: tiny crossing angle @ 1000 km",
        P64::new(base,           base),
        P64::new(base + 1000.0,  base + 0.001),    // nearly horizontal
        P64::new(base + 500.0,   base - 100.0),
        P64::new(base + 500.0,   base + 100.0),     // vertical
        P64::new(base + 500.0,   base + 0.0005),
    );

    // Case 4: straddling zero-level — exact collinear endpoints
    run_case(
        "Case 4: exact shared endpoint @ origin (control)",
        P64::new(0.0, 0.0),
        P64::new(10.0, 10.0),
        P64::new(0.0, 10.0),
        P64::new(10.0, 0.0),
        P64::new(5.0, 5.0),
    );
}
