//! Performance gate: p99 query < 0.5 ms on 1 M-segment scene.

use criterion::{criterion_group, criterion_main, BatchSize, Criterion};
use kernel_snap::{SnapContext, SnapEngine, SnapModeSet};
use kernel_spatial::{SegmentEntry, SegmentIndex};

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
        entries.push(SegmentEntry {
            seg_idx: i as u32,
            min: [p1[0].min(p2[0]), p1[1].min(p2[1])],
            max: [p1[0].max(p2[0]), p1[1].max(p2[1])],
        });
    }
    (SegmentIndex::bulk_load(entries), segments)
}

fn bench_query(c: &mut Criterion) {
    // 1 million segments — the design's perf-gate target.
    let (idx, segs) = make_synthetic_scene(1_000_000);
    let modes = SnapModeSet::ENDPOINT
        | SnapModeSet::MIDPOINT
        | SnapModeSet::INTERSECTION
        | SnapModeSet::PERPENDICULAR
        | SnapModeSet::NEAREST;
    let ctx = SnapContext {
        index: &idx,
        segments: &segs,
        modes,
        tolerance_world: 0.5,
        last_pick: Some([100.0, 100.0]),
        ortho_anchor: None,
        polar_increment_deg: 45.0,
        key_points: &[],
        grid_size: 100.0,
    };
    c.bench_function("snap_query_1M_segs", |b| {
        b.iter_batched(
            || (500.0_f64 + rand_jitter(), 500.0_f64 + rand_jitter()),
            |(x, y)| {
                let _ = SnapEngine::query([x, y], &ctx);
            },
            BatchSize::SmallInput,
        );
    });
}

fn rand_jitter() -> f64 {
    use std::cell::Cell;
    thread_local! { static SEED: Cell<u64> = Cell::new(0x12345678_DEADBEEF); }
    SEED.with(|s| {
        let mut x = s.get();
        x ^= x << 13;
        x ^= x >> 7;
        x ^= x << 17;
        s.set(x);
        ((x >> 32) as f64 / u32::MAX as f64) * 10.0 - 5.0
    })
}

criterion_group!(benches, bench_query);
criterion_main!(benches);
