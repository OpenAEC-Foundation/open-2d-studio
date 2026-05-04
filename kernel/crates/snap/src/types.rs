//! Snap engine types — all modes, mode set bitflags, result, context.

use bitflags::bitflags;
use kernel_spatial::SegmentIndex;

/// All 11 OSNAP modes from 1.0's `SnapType`. Listed in priority order
/// (Endpoint highest). The order in `query::dispatch()` mirrors
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
    pub fn query(cursor: [f64; 2], ctx: &SnapContext<'_>) -> Option<SnapResult> {
        crate::query::dispatch(cursor, ctx)
    }
}
