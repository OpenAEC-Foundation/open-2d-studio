//! DXF file import.
//!
//! Parses DXF via the `dxf` crate (handles R12 through R2018). Entities are
//! mapped to kernel-core ECS components. Support is incremental: lines, circles,
//! arcs, polylines first; hatches, text, blocks later.

use bevy_ecs::prelude::*;
use dxf::entities::EntityType;
use dxf::Drawing as DxfDrawing;
use kernel_core::{
    ArcGeom, CircleGeom, LineGeom, PolylineGeom, Position, ShapeId, ShapeIndex, ShapeKind, Visible,
};
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
                    LineGeom {
                        p1: [line.p1.x, line.p1.y],
                        p2: [line.p2.x, line.p2.y],
                    },
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
                    CircleGeom {
                        center: [c.center.x, c.center.y],
                        radius: c.radius,
                    },
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
                    ArcGeom {
                        center: [a.center.x, a.center.y],
                        radius: a.radius,
                        start_angle_rad: a.start_angle.to_radians(),
                        end_angle_rad: a.end_angle.to_radians(),
                    },
                    Visible,
                )).id();
                world.resource_mut::<ShapeIndex>().insert(id, entity_id);
                stats.arcs += 1;
            }
            EntityType::LwPolyline(pl) => {
                let id = ShapeId::new();
                let entity_id = world.spawn((
                    id,
                    ShapeKind::Polyline,
                    Position::origin(),
                    PolylineGeom {
                        vertices: pl.vertices.iter().map(|v| [v.x, v.y]).collect(),
                        closed: pl.get_is_closed(),
                    },
                    Visible,
                )).id();
                world.resource_mut::<ShapeIndex>().insert(id, entity_id);
                stats.polylines += 1;
            }
            EntityType::Polyline(pl) => {
                let id = ShapeId::new();
                let entity_id = world.spawn((
                    id,
                    ShapeKind::Polyline,
                    Position::origin(),
                    PolylineGeom {
                        vertices: pl.vertices().map(|v| [v.location.x, v.location.y]).collect(),
                        closed: pl.get_is_closed(),
                    },
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
    use dxf::entities::{Circle, Entity, EntityType, Line};
    use dxf::Point as DxfPoint;
    use kernel_core::{new_world, CircleGeom, LineGeom};

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

    #[test]
    fn import_line_preserves_geometry() {
        let tmp = std::env::temp_dir().join("kernel-dxf-linegeom-test.dxf");
        let mut drawing = DxfDrawing::new();
        let line = Line {
            p1: DxfPoint::new(0.0, 0.0, 0.0),
            p2: DxfPoint::new(100.0, 50.0, 0.0),
            ..Default::default()
        };
        drawing.add_entity(Entity::new(EntityType::Line(line)));
        drawing.save_file(&tmp).unwrap();

        let mut world = new_world();
        let stats = import_dxf(&mut world, &tmp).unwrap();
        assert_eq!(stats.lines, 1);

        let mut query = world.query::<&LineGeom>();
        let geoms: Vec<&LineGeom> = query.iter(&world).collect();
        assert_eq!(geoms.len(), 1);
        let g = geoms[0];
        assert_eq!(g.p1, [0.0, 0.0]);
        assert_eq!(g.p2, [100.0, 50.0]);

        std::fs::remove_file(&tmp).ok();
    }

    #[test]
    fn import_circle_preserves_geometry() {
        let tmp = std::env::temp_dir().join("kernel-dxf-circlegeom-test.dxf");
        let mut drawing = DxfDrawing::new();
        let circle = Circle {
            center: DxfPoint::new(10.0, 20.0, 0.0),
            radius: 5.5,
            ..Default::default()
        };
        drawing.add_entity(Entity::new(EntityType::Circle(circle)));
        drawing.save_file(&tmp).unwrap();

        let mut world = new_world();
        let stats = import_dxf(&mut world, &tmp).unwrap();
        assert_eq!(stats.circles, 1);

        let mut query = world.query::<&CircleGeom>();
        let geoms: Vec<&CircleGeom> = query.iter(&world).collect();
        assert_eq!(geoms.len(), 1);
        let g = geoms[0];
        assert_eq!(g.center, [10.0, 20.0]);
        assert_eq!(g.radius, 5.5);

        std::fs::remove_file(&tmp).ok();
    }
}
