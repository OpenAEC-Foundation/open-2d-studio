//! kernel-spatial — R-tree index voor viewport culling en hit testing.
//!
//! We gebruiken `rstar` met f64 bounds. Entries zijn `(ShapeId, AABB)` paren.
//! Bij shape-wijzigingen moet de tree opnieuw worden opgebouwd — dat kost
//! ongeveer 10-20 ms voor 100k entries. Incremental updates zijn ook mogelijk
//! via `remove` + `insert` maar worden selectief toegepast in de app-laag.

use kernel_core::{ShapeId, WorldBounds, WorldPos};
use rstar::{RTree, RTreeObject, AABB};

/// R-tree entry: stable ShapeId + f64 AABB bounds.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct SpatialEntry {
    pub id: ShapeId,
    pub bounds: WorldBounds,
}

impl RTreeObject for SpatialEntry {
    type Envelope = AABB<[f64; 2]>;
    fn envelope(&self) -> Self::Envelope {
        AABB::from_corners(
            [self.bounds.min_x, self.bounds.min_y],
            [self.bounds.max_x, self.bounds.max_y],
        )
    }
}

/// Spatial index over all shapes in a drawing.
pub struct SpatialIndex {
    tree: RTree<SpatialEntry>,
}

impl Default for SpatialIndex {
    fn default() -> Self { Self::new() }
}

impl SpatialIndex {
    pub fn new() -> Self { Self { tree: RTree::new() } }

    /// Bulk-load — faster than incremental insert for initial population.
    pub fn bulk_load(entries: Vec<SpatialEntry>) -> Self {
        Self { tree: RTree::bulk_load(entries) }
    }

    pub fn insert(&mut self, entry: SpatialEntry) {
        self.tree.insert(entry);
    }

    pub fn remove(&mut self, id: ShapeId) -> Option<SpatialEntry> {
        let found = self.tree.iter().find(|e| e.id == id).copied()?;
        self.tree.remove(&found)
    }

    pub fn len(&self) -> usize { self.tree.size() }
    pub fn is_empty(&self) -> bool { self.tree.size() == 0 }

    /// Query all shapes whose bounds intersect the given viewport rectangle.
    /// O(log n + k) where k is the number of results.
    pub fn query_viewport(&self, min: WorldPos, max: WorldPos) -> Vec<ShapeId> {
        let envelope = AABB::from_corners([min.x, min.y], [max.x, max.y]);
        self.tree
            .locate_in_envelope_intersecting(&envelope)
            .map(|e| e.id)
            .collect()
    }

    /// Query shapes containing (or very close to) a point. Used for hit-testing.
    pub fn query_point(&self, p: WorldPos, tolerance: f64) -> Vec<ShapeId> {
        let envelope = AABB::from_corners(
            [p.x - tolerance, p.y - tolerance],
            [p.x + tolerance, p.y + tolerance],
        );
        self.tree
            .locate_in_envelope_intersecting(&envelope)
            .map(|e| e.id)
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn bounds(x: f64, y: f64, w: f64, h: f64) -> WorldBounds {
        WorldBounds { min_x: x, min_y: y, max_x: x + w, max_y: y + h }
    }

    #[test]
    fn bulk_load_and_query() {
        let entries = vec![
            SpatialEntry { id: ShapeId::new(), bounds: bounds(0.0, 0.0, 10.0, 10.0) },
            SpatialEntry { id: ShapeId::new(), bounds: bounds(100.0, 100.0, 10.0, 10.0) },
            SpatialEntry { id: ShapeId::new(), bounds: bounds(50.0, 50.0, 10.0, 10.0) },
        ];
        let ids: Vec<_> = entries.iter().map(|e| e.id).collect();
        let index = SpatialIndex::bulk_load(entries);
        assert_eq!(index.len(), 3);

        // Viewport covering only first shape
        let hits = index.query_viewport(WorldPos::new(-5.0, -5.0), WorldPos::new(15.0, 15.0));
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0], ids[0]);

        // Viewport covering all three
        let hits = index.query_viewport(WorldPos::new(-10.0, -10.0), WorldPos::new(200.0, 200.0));
        assert_eq!(hits.len(), 3);
    }

    #[test]
    fn point_query_hits_containing_shape() {
        let id = ShapeId::new();
        let index = SpatialIndex::bulk_load(vec![
            SpatialEntry { id, bounds: bounds(0.0, 0.0, 100.0, 100.0) },
        ]);
        let hits = index.query_point(WorldPos::new(50.0, 50.0), 1.0);
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0], id);
    }

    #[test]
    fn at_1000km_viewport_query_still_works() {
        let base = 1_000_000_000.0_f64;
        let id = ShapeId::new();
        let index = SpatialIndex::bulk_load(vec![
            SpatialEntry { id, bounds: bounds(base, base, 10.0, 10.0) },
        ]);
        let hits = index.query_viewport(
            WorldPos::new(base - 5.0, base - 5.0),
            WorldPos::new(base + 20.0, base + 20.0),
        );
        assert_eq!(hits.len(), 1);
    }

    #[test]
    fn remove_shrinks_index() {
        let id = ShapeId::new();
        let mut index = SpatialIndex::new();
        index.insert(SpatialEntry { id, bounds: bounds(0.0, 0.0, 10.0, 10.0) });
        assert_eq!(index.len(), 1);
        let removed = index.remove(id);
        assert!(removed.is_some());
        assert_eq!(index.len(), 0);
    }
}

// =============================================================================
// SegmentIndex — R-tree keyed by raw segment index (u32).
//
// `SpatialIndex` above keys on `ShapeId` (UUID) which is the right shape for
// the persistent ECS world. The viewer in `kernel-app` keeps a flat
// `Vec<Segment>` per scene and needs a much cheaper key — the segment's
// position in that vec. This keeps lookups O(log n + k) without a UUID
// alloc/hash per entry, which matters when a single DWG yields ~700k
// segments and we rebuild the index on every reload.
// =============================================================================

/// One entry in `SegmentIndex`: the segment's `usize` index encoded as `u32`
/// (688k fits easily) plus its world-space AABB (the segment endpoints'
/// bounding box, optionally inflated by line-width / pick-radius at query
/// time — the index itself stores the tight box).
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct SegmentEntry {
    pub seg_idx: u32,
    pub min: [f64; 2],
    pub max: [f64; 2],
}

impl RTreeObject for SegmentEntry {
    type Envelope = AABB<[f64; 2]>;
    fn envelope(&self) -> Self::Envelope {
        AABB::from_corners(self.min, self.max)
    }
}

/// R-tree over a flat segment buffer. Built once after scene-load and queried
/// per cursor-move event. Bulk-loaded for the cheapest construction cost
/// (~50 ms for 700k entries on a release build, vs minutes for incremental
/// inserts).
pub struct SegmentIndex {
    tree: RTree<SegmentEntry>,
}

impl Default for SegmentIndex {
    fn default() -> Self { Self::new() }
}

impl SegmentIndex {
    pub fn new() -> Self { Self { tree: RTree::new() } }

    /// Bulk-load — strongly preferred for initial population.
    pub fn bulk_load(entries: Vec<SegmentEntry>) -> Self {
        Self { tree: RTree::bulk_load(entries) }
    }

    pub fn len(&self) -> usize { self.tree.size() }
    pub fn is_empty(&self) -> bool { self.tree.size() == 0 }

    /// Return every segment whose AABB intersects a square of side
    /// `2 * radius` centred at `p`. Caller does the exact distance test.
    pub fn query_point(&self, p: [f64; 2], radius: f64) -> Vec<u32> {
        let env = AABB::from_corners(
            [p[0] - radius, p[1] - radius],
            [p[0] + radius, p[1] + radius],
        );
        self.tree
            .locate_in_envelope_intersecting(&env)
            .map(|e| e.seg_idx)
            .collect()
    }

    /// Return every segment whose AABB intersects the given world-space
    /// rect. Used by drag-box select.
    pub fn query_rect(&self, min: [f64; 2], max: [f64; 2]) -> Vec<u32> {
        let env = AABB::from_corners(min, max);
        self.tree
            .locate_in_envelope_intersecting(&env)
            .map(|e| e.seg_idx)
            .collect()
    }
}

#[cfg(test)]
mod segment_index_tests {
    use super::*;

    #[test]
    fn bulk_load_segments_and_query_point() {
        let entries = vec![
            SegmentEntry { seg_idx: 0, min: [0.0, 0.0], max: [10.0, 10.0] },
            SegmentEntry { seg_idx: 1, min: [100.0, 100.0], max: [110.0, 110.0] },
            SegmentEntry { seg_idx: 2, min: [50.0, 50.0], max: [60.0, 60.0] },
        ];
        let idx = SegmentIndex::bulk_load(entries);
        assert_eq!(idx.len(), 3);

        let mut hits = idx.query_point([5.0, 5.0], 1.0);
        hits.sort();
        assert_eq!(hits, vec![0]);

        let mut hits = idx.query_point([55.0, 55.0], 100.0);
        hits.sort();
        assert_eq!(hits, vec![0, 1, 2]);
    }

    #[test]
    fn empty_index_returns_no_hits() {
        let idx = SegmentIndex::new();
        let hits = idx.query_point([0.0, 0.0], 1.0);
        assert!(hits.is_empty());
    }
}
