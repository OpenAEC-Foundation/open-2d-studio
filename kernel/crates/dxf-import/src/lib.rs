//! DXF file import.
//!
//! Parses DXF via the `dxf` crate (handles R12 through R2018). Entities are
//! mapped to kernel-core ECS components. Support is incremental: lines, circles,
//! arcs, polylines first; hatches, text, blocks later.

use bevy_ecs::prelude::*;
use dxf::entities::EntityType;
use dxf::Drawing as DxfDrawing;
use kernel_core::{Position, ShapeId, ShapeIndex, ShapeKind, Visible};
use std::path::Path;

pub struct ImportStats {
    pub lines: usize,
    pub circles: usize,
    pub arcs: usize,
    pub polylines: usize,
    pub unsupported: usize,
}

impl Default for ImportStats {
    fn default() -> Self {
        Self { lines: 0, circles: 0, arcs: 0, polylines: 0, unsupported: 0 }
    }
}

/// Import a DXF file into the ECS world. Spawns entities for each recognized
/// entity type. Returns statistics by type for diagnostics.
pub fn import_dxf<P: AsRef<Path>>(world: &mut World, path: P) -> anyhow::Result<ImportStats> {
    let drawing = DxfDrawing::load_file(path)?;
    let mut stats = ImportStats::default();
    for entity in drawing.entities() {
        match &entity.specific {
            EntityType::Line(line) => {
                // DXF uses cartesian X-Y-Z; we project to 2D (X,Y)
                let id = ShapeId::new();
                let entity_id = world.spawn((
                    id,
                    ShapeKind::Line,
                    Position::new(line.p1.x, line.p1.y),
                    Visible,
                )).id();
                world.resource_mut::<ShapeIndex>().insert(id, entity_id);
                stats.lines += 1;
            }
            EntityType::Circle(c) => {
                let id = ShapeId::new();
                let entity_id = world.spawn((
                    id,
                    ShapeKind::Circle,
                    Position::new(c.center.x, c.center.y),
                    Visible,
                )).id();
                world.resource_mut::<ShapeIndex>().insert(id, entity_id);
                stats.circles += 1;
            }
            EntityType::Arc(a) => {
                let id = ShapeId::new();
                let entity_id = world.spawn((
                    id,
                    ShapeKind::Arc,
                    Position::new(a.center.x, a.center.y),
                    Visible,
                )).id();
                world.resource_mut::<ShapeIndex>().insert(id, entity_id);
                stats.arcs += 1;
            }
            EntityType::Polyline(_) | EntityType::LwPolyline(_) => {
                let id = ShapeId::new();
                let entity_id = world.spawn((
                    id,
                    ShapeKind::Polyline,
                    Position::origin(), // polyline points will be stored later as a vec
                    Visible,
                )).id();
                world.resource_mut::<ShapeIndex>().insert(id, entity_id);
                stats.polylines += 1;
            }
            _ => {
                stats.unsupported += 1;
            }
        }
    }
    Ok(stats)
}

#[cfg(test)]
mod tests {
    use super::*;
    use dxf::entities::{Entity, EntityType, Line};
    use dxf::Point as DxfPoint;
    use kernel_core::new_world;

    /// Build a minimal in-memory DXF drawing with a single line and save to tmp.
    fn write_test_dxf() -> std::path::PathBuf {
        let tmp = std::env::temp_dir().join("kernel-dxf-test.dxf");
        let mut drawing = DxfDrawing::new();
        let line = Line {
            p1: DxfPoint::new(0.0, 0.0, 0.0),
            p2: DxfPoint::new(100.0, 100.0, 0.0),
            ..Default::default()
        };
        drawing.add_entity(Entity::new(EntityType::Line(line)));
        drawing.save_file(&tmp).unwrap();
        tmp
    }

    #[test]
    fn import_single_line_dxf() {
        let path = write_test_dxf();
        let mut world = new_world();
        let stats = import_dxf(&mut world, &path).unwrap();
        assert_eq!(stats.lines, 1);
        assert_eq!(world.resource::<ShapeIndex>().len(), 1);
        std::fs::remove_file(&path).ok();
    }
}
