//! PDF export via printpdf.
//!
//! Renders drawings as vector PDF. Initial scope: lines, circles, rectangles
//! on a single A4 page. Extended scope later: multi-sheet, hatches, text,
//! title blocks.

use bevy_ecs::prelude::*;
use kernel_core::{Position, ShapeId, Visible};
use printpdf::{Mm, PdfDocument, PdfDocumentReference, PdfLayerReference};
use std::path::Path;

pub struct PageConfig {
    pub width_mm: f32,
    pub height_mm: f32,
    pub title: String,
}

impl Default for PageConfig {
    fn default() -> Self {
        Self { width_mm: 297.0, height_mm: 210.0, title: "Drawing".into() }
    }
}

/// Export an ECS world to a PDF file. Currently writes one page with all
/// visible Position-bearing entities as small dots.
pub fn export_pdf<P: AsRef<Path>>(world: &mut World, path: P, cfg: &PageConfig) -> anyhow::Result<()> {
    let (doc, page1, layer1) = PdfDocument::new(&cfg.title,
        Mm(cfg.width_mm), Mm(cfg.height_mm), "Layer 1");
    let layer = doc.get_page(page1).get_layer(layer1);

    // Collect positions
    let mut q = world.query_filtered::<&Position, With<Visible>>();
    for pos in q.iter(world) {
        draw_dot(&layer, pos, cfg);
    }

    let file = std::fs::File::create(path)?;
    let mut writer = std::io::BufWriter::new(file);
    doc.save(&mut writer)?;
    Ok(())
}

fn draw_dot(layer: &PdfLayerReference, pos: &Position, cfg: &PageConfig) {
    use printpdf::{Line, Point};
    // Simple 2mm dot
    let x = Mm(pos.x.clamp(0.0, cfg.width_mm as f64) as f32);
    let y = Mm(pos.y.clamp(0.0, cfg.height_mm as f64) as f32);
    let r = Mm(0.5);
    let points = vec![
        (Point::new(Mm(x.0 - r.0), Mm(y.0 - r.0)), false),
        (Point::new(Mm(x.0 + r.0), Mm(y.0 - r.0)), false),
        (Point::new(Mm(x.0 + r.0), Mm(y.0 + r.0)), false),
        (Point::new(Mm(x.0 - r.0), Mm(y.0 + r.0)), false),
    ];
    let line = Line {
        points,
        is_closed: true,
    };
    layer.add_line(line);
}

#[cfg(test)]
mod tests {
    use super::*;
    use kernel_core::{new_world, ShapeKind};

    #[test]
    fn export_empty_pdf() {
        let mut world = new_world();
        let path = std::env::temp_dir().join("kernel-pdf-test-empty.pdf");
        export_pdf(&mut world, &path, &PageConfig::default()).unwrap();
        let meta = std::fs::metadata(&path).unwrap();
        assert!(meta.len() > 100, "pdf should have content");
        std::fs::remove_file(&path).ok();
    }

    #[test]
    fn export_with_positions() {
        let mut world = new_world();
        for i in 0..5 {
            world.spawn((
                ShapeId::new(),
                ShapeKind::Line,
                Position::new(20.0 + i as f64 * 30.0, 100.0),
                Visible,
            ));
        }
        let path = std::env::temp_dir().join("kernel-pdf-test-dots.pdf");
        export_pdf(&mut world, &path, &PageConfig::default()).unwrap();
        assert!(std::fs::metadata(&path).unwrap().len() > 200);
        std::fs::remove_file(&path).ok();
    }
}
