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
