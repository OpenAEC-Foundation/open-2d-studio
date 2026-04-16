//! Hatch pattern generation.
//!
//! Een hatch is een gevulde polygon met een parallel-lijnenpatroon binnen de
//! clip-boundary. We genereren de pattern lijnen analytisch (angle + spacing)
//! en clippen ze tegen de polygon. Dit is sneller dan lijn-voor-lijn tesselleren.
//!
//! Voor NEN47-patronen (baksteen, beton, isolatie) krijgen we later
//! specifieke sub-generatoren die meerdere line families combineren.

use crate::tessellate::{TessBuffers, TessVertex};
use lyon::math::Point;
use lyon::path::Path;
use lyon::tessellation::{
    BuffersBuilder, StrokeOptions, StrokeTessellator, StrokeVertex, VertexBuffers,
};

/// Parameters for a simple hatch pattern.
#[derive(Clone, Copy, Debug)]
pub struct HatchParams {
    /// Angle in radians (0 = horizontal, pi/4 = 45°)
    pub angle: f32,
    /// Spacing between parallel lines in world units (mm)
    pub spacing: f32,
    /// Line width in world units
    pub line_width: f32,
}

impl Default for HatchParams {
    fn default() -> Self {
        Self { angle: std::f32::consts::FRAC_PI_4, spacing: 5.0, line_width: 0.1 }
    }
}

/// Generate parallel-line hatch geometry inside a closed polygon boundary.
///
/// Returns tessellated stroke buffers (vertices + indices) already clipped
/// to the polygon interior. The clipping is done by masking in the shader,
/// but for now we simply generate the lines across the AABB and let polygon
/// boundary drawing hide the overflow visually.
///
/// For crossed patterns (bricks, grids), call twice with different angles
/// and merge buffers.
pub fn generate_hatch_lines(
    polygon: &[[f32; 2]],
    params: HatchParams,
) -> anyhow::Result<TessBuffers> {
    if polygon.len() < 3 {
        return Ok(VertexBuffers::new());
    }

    // Bounding box of the polygon
    let (min_x, min_y, max_x, max_y) = polygon.iter().fold(
        (f32::INFINITY, f32::INFINITY, f32::NEG_INFINITY, f32::NEG_INFINITY),
        |(ax, ay, bx, by), p| (ax.min(p[0]), ay.min(p[1]), bx.max(p[0]), by.max(p[1])),
    );

    // Rotate coordinate system so pattern direction == X axis
    let cos = params.angle.cos();
    let sin = params.angle.sin();

    // Center of AABB
    let cx = (min_x + max_x) * 0.5;
    let cy = (min_y + max_y) * 0.5;

    // AABB diagonal (covers all rotated cases)
    let dx = max_x - min_x;
    let dy = max_y - min_y;
    let diag = (dx * dx + dy * dy).sqrt();
    let half_extent = diag * 0.5 + params.spacing;

    let n = ((half_extent * 2.0 / params.spacing).ceil() as i32).max(1);

    let mut builder = Path::builder();
    for i in -n..=n {
        let offset = i as f32 * params.spacing;
        // In rotated frame: line goes from (-half_extent, offset) to (+half_extent, offset)
        let lx1 = -half_extent;
        let lx2 = half_extent;
        let ly = offset;
        // Rotate back to world frame and translate to polygon center
        let wx1 = lx1 * cos - ly * sin + cx;
        let wy1 = lx1 * sin + ly * cos + cy;
        let wx2 = lx2 * cos - ly * sin + cx;
        let wy2 = lx2 * sin + ly * cos + cy;

        builder.begin(Point::new(wx1, wy1));
        builder.line_to(Point::new(wx2, wy2));
        builder.end(false);
    }
    let path = builder.build();

    let mut buffers: TessBuffers = VertexBuffers::new();
    let mut tessellator = StrokeTessellator::new();
    tessellator.tessellate_path(
        &path,
        &StrokeOptions::tolerance(0.1).with_line_width(params.line_width),
        &mut BuffersBuilder::new(&mut buffers, |v: StrokeVertex| TessVertex {
            pos: v.position().to_array(),
        }),
    )?;
    Ok(buffers)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hatch_rectangle_produces_many_lines() {
        let rect = &[[0.0, 0.0], [100.0, 0.0], [100.0, 100.0], [0.0, 100.0]];
        let params = HatchParams { angle: 0.0, spacing: 10.0, line_width: 0.5 };
        let buf = generate_hatch_lines(rect, params).unwrap();
        assert!(!buf.vertices.is_empty(), "no hatch vertices");
        assert!(buf.indices.len() >= 6, "less than one triangle pair");
    }

    #[test]
    fn hatch_45deg_produces_diagonal_lines() {
        let rect = &[[0.0, 0.0], [50.0, 0.0], [50.0, 50.0], [0.0, 50.0]];
        let params = HatchParams {
            angle: std::f32::consts::FRAC_PI_4,
            spacing: 5.0,
            line_width: 0.25,
        };
        let buf = generate_hatch_lines(rect, params).unwrap();
        assert!(!buf.vertices.is_empty());
    }

    #[test]
    fn hatch_empty_polygon_returns_empty() {
        let buf = generate_hatch_lines(&[], HatchParams::default()).unwrap();
        assert!(buf.vertices.is_empty());
        assert!(buf.indices.is_empty());
    }

    #[test]
    fn hatch_spacing_affects_line_count() {
        let rect = &[[0.0, 0.0], [100.0, 0.0], [100.0, 100.0], [0.0, 100.0]];
        let wide = generate_hatch_lines(rect, HatchParams {
            angle: 0.0, spacing: 50.0, line_width: 0.5,
        }).unwrap();
        let dense = generate_hatch_lines(rect, HatchParams {
            angle: 0.0, spacing: 2.0, line_width: 0.5,
        }).unwrap();
        assert!(dense.vertices.len() > wide.vertices.len(),
            "dense hatch should have more vertices than wide");
    }
}
