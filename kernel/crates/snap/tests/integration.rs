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
        let min = [p1[0].min(p2[0]), p1[1].min(p2[1])];
        let max = [p1[0].max(p2[0]), p1[1].max(p2[1])];
        SegmentEntry { seg_idx: i as u32, min, max }
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
