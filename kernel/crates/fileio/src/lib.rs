//! kernel-fileio — `.o2d` native file format (JSON v4) read/write.
//!
//! Schema versie 4: breaking t.o.v. TypeScript v3. We schrijven v4 uit, lezen
//! optioneel v3 via een compat-layer (later — eerst v4 baseline).

use bevy_ecs::prelude::*;
use kernel_core::{DrawingId, LayerId, Position, ShapeId, ShapeIndex, ShapeKind, Visible};
use serde::{Deserialize, Serialize};
use std::path::Path;

pub const FORMAT_VERSION: u32 = 4;

#[derive(Serialize, Deserialize, Debug)]
pub struct O2dDocument {
    pub format_version: u32,
    pub drawings: Vec<DrawingRecord>,
    pub layers: Vec<LayerRecord>,
    pub shapes: Vec<ShapeRecord>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct DrawingRecord {
    pub id: DrawingId,
    pub name: String,
    pub scale: f64,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct LayerRecord {
    pub id: LayerId,
    pub name: String,
    pub color_rgba: [u8; 4],
    pub visible: bool,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct ShapeRecord {
    pub id: ShapeId,
    pub kind: ShapeKind,
    pub position: Position,
    pub layer: Option<LayerId>,
    pub drawing: Option<DrawingId>,
    #[serde(default)]
    pub visible: bool,
}

// ── World → O2dDocument ──────────────────────────────────────────────────

pub fn serialize_world(world: &mut World) -> O2dDocument {
    let mut shapes = Vec::new();
    let mut q = world.query::<(&ShapeId, &Position, Option<&ShapeKind>, Option<&Visible>)>();
    for (id, pos, kind, vis) in q.iter(world) {
        shapes.push(ShapeRecord {
            id: *id,
            kind: kind.copied().unwrap_or(ShapeKind::Line),
            position: *pos,
            layer: None,
            drawing: None,
            visible: vis.is_some(),
        });
    }

    O2dDocument {
        format_version: FORMAT_VERSION,
        drawings: vec![],
        layers: vec![],
        shapes,
    }
}

// ── O2dDocument → World ──────────────────────────────────────────────────

pub fn deserialize_into_world(world: &mut World, doc: &O2dDocument) -> anyhow::Result<()> {
    if doc.format_version != FORMAT_VERSION {
        anyhow::bail!(
            "unsupported format version {}, expected {}",
            doc.format_version, FORMAT_VERSION
        );
    }
    for record in &doc.shapes {
        let entity = if record.visible {
            world.spawn((record.id, record.kind, record.position, Visible)).id()
        } else {
            world.spawn((record.id, record.kind, record.position)).id()
        };
        world.resource_mut::<ShapeIndex>().insert(record.id, entity);
    }
    Ok(())
}

// ── File I/O helpers ─────────────────────────────────────────────────────

pub fn load_o2d<P: AsRef<Path>>(path: P) -> anyhow::Result<O2dDocument> {
    let data = std::fs::read_to_string(path)?;
    let doc: O2dDocument = serde_json::from_str(&data)?;
    Ok(doc)
}

pub fn save_o2d<P: AsRef<Path>>(path: P, doc: &O2dDocument) -> anyhow::Result<()> {
    let data = serde_json::to_string_pretty(doc)?;
    std::fs::write(path, data)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use kernel_core::new_world;

    #[test]
    fn roundtrip_empty_document() {
        let doc = O2dDocument {
            format_version: FORMAT_VERSION,
            drawings: vec![],
            layers: vec![],
            shapes: vec![],
        };
        let json = serde_json::to_string(&doc).unwrap();
        let parsed: O2dDocument = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.format_version, FORMAT_VERSION);
    }

    #[test]
    fn roundtrip_world_with_shapes() {
        let mut world = new_world();

        // Manually spawn 3 shapes
        for i in 0..3 {
            let id = ShapeId::new();
            let entity = world.spawn((
                id,
                ShapeKind::Line,
                Position::new(i as f64 * 10.0, 0.0),
                Visible,
            )).id();
            world.resource_mut::<ShapeIndex>().insert(id, entity);
        }

        let doc = serialize_world(&mut world);
        assert_eq!(doc.shapes.len(), 3);
        assert_eq!(doc.format_version, FORMAT_VERSION);

        // Deserialize into a fresh world
        let mut world2 = new_world();
        deserialize_into_world(&mut world2, &doc).unwrap();
        let mut q = world2.query::<&Position>();
        let positions: Vec<Position> = q.iter(&world2).copied().collect();
        assert_eq!(positions.len(), 3);
    }

    #[test]
    fn file_roundtrip_via_disk() {
        let tmp = std::env::temp_dir().join("kernel-fileio-test.o2d");
        let doc = O2dDocument {
            format_version: FORMAT_VERSION,
            drawings: vec![DrawingRecord {
                id: DrawingId::new(),
                name: "Test".into(),
                scale: 0.01,
            }],
            layers: vec![LayerRecord {
                id: LayerId::new(),
                name: "Default".into(),
                color_rgba: [255, 0, 0, 255],
                visible: true,
            }],
            shapes: vec![],
        };
        save_o2d(&tmp, &doc).unwrap();
        let loaded = load_o2d(&tmp).unwrap();
        assert_eq!(loaded.drawings.len(), 1);
        assert_eq!(loaded.drawings[0].name, "Test");
        assert_eq!(loaded.layers.len(), 1);
        std::fs::remove_file(&tmp).ok();
    }

    #[test]
    fn rejects_wrong_format_version() {
        let mut world = new_world();
        let doc = O2dDocument {
            format_version: 99,
            drawings: vec![],
            layers: vec![],
            shapes: vec![],
        };
        let result = deserialize_into_world(&mut world, &doc);
        assert!(result.is_err());
    }
}
