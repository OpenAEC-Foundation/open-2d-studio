//! Arc and spline tessellation.
//!
//! `lyon::geom` provides `Arc` with `for_each_quadratic_bezier` or
//! `sample` for arc-length uniform sampling. We tessellate arcs as stroke
//! paths to get smooth curves.

use crate::tessellate::{TessBuffers, TessVertex};
use lyon::geom::{Angle, Arc, Point, Vector};
use lyon::path::Path;
use lyon::tessellation::{
    BuffersBuilder, StrokeOptions, StrokeTessellator, StrokeVertex, VertexBuffers,
};

/// Tessellate an arc given center + radius + start/end angle + line width.
pub fn tessellate_arc(
    center: [f32; 2],
    radius: f32,
    start_angle_rad: f32,
    sweep_rad: f32,
    line_width: f32,
) -> anyhow::Result<TessBuffers> {
    let arc = Arc {
        center: Point::new(center[0], center[1]),
        radii: Vector::new(radius, radius),
        start_angle: Angle::radians(start_angle_rad),
        sweep_angle: Angle::radians(sweep_rad),
        x_rotation: Angle::radians(0.0),
    };

    // Sample arc as a series of points, then build a stroke path.
    let mut builder = Path::builder();
    let start = arc.sample(0.0);
    builder.begin(Point::new(start.x, start.y));
    // ~1 segment per 2 degrees
    let steps = ((sweep_rad.abs() / 0.035).ceil() as usize).max(4);
    for i in 1..=steps {
        let t = i as f32 / steps as f32;
        let p = arc.sample(t);
        builder.line_to(Point::new(p.x, p.y));
    }
    builder.end(false);
    let path = builder.build();

    let mut buffers: TessBuffers = VertexBuffers::new();
    let mut tess = StrokeTessellator::new();
    tess.tessellate_path(
        &path,
        &StrokeOptions::tolerance(0.05).with_line_width(line_width),
        &mut BuffersBuilder::new(&mut buffers, |v: StrokeVertex| TessVertex {
            pos: v.position().to_array(),
        }),
    )?;
    Ok(buffers)
}

/// Tessellate a cubic bezier spline control polygon.
/// Points are alternating anchor / control / control / anchor pattern.
pub fn tessellate_bezier(
    anchors_and_controls: &[[f32; 2]],
    line_width: f32,
) -> anyhow::Result<TessBuffers> {
    if anchors_and_controls.len() < 4 || (anchors_and_controls.len() - 1) % 3 != 0 {
        return Ok(VertexBuffers::new());
    }

    let mut builder = Path::builder();
    let first = anchors_and_controls[0];
    builder.begin(Point::new(first[0], first[1]));

    let mut i = 1;
    while i + 2 < anchors_and_controls.len() {
        let c1 = anchors_and_controls[i];
        let c2 = anchors_and_controls[i + 1];
        let p = anchors_and_controls[i + 2];
        builder.cubic_bezier_to(
            Point::new(c1[0], c1[1]),
            Point::new(c2[0], c2[1]),
            Point::new(p[0], p[1]),
        );
        i += 3;
    }
    builder.end(false);
    let path = builder.build();

    let mut buffers: TessBuffers = VertexBuffers::new();
    let mut tess = StrokeTessellator::new();
    tess.tessellate_path(
        &path,
        &StrokeOptions::tolerance(0.05).with_line_width(line_width),
        &mut BuffersBuilder::new(&mut buffers, |v: StrokeVertex| TessVertex {
            pos: v.position().to_array(),
        }),
    )?;
    Ok(buffers)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::f32::consts::PI;

    #[test]
    fn quarter_arc_produces_smooth_curve() {
        let buf = tessellate_arc([0.0, 0.0], 10.0, 0.0, PI / 2.0, 0.5).unwrap();
        assert!(buf.vertices.len() > 20, "quarter arc should have many vertices");
        assert!(!buf.indices.is_empty());
    }

    #[test]
    fn full_circle_via_arc() {
        let buf = tessellate_arc([0.0, 0.0], 5.0, 0.0, 2.0 * PI, 0.2).unwrap();
        assert!(buf.vertices.len() > 40, "full circle should produce ≥40 verts");
    }

    #[test]
    fn bezier_cubic_tessellates() {
        let pts = &[
            [0.0, 0.0],
            [10.0, 100.0], // control 1
            [90.0, 100.0], // control 2
            [100.0, 0.0],  // anchor 2
        ];
        let buf = tessellate_bezier(pts, 0.5).unwrap();
        assert!(!buf.vertices.is_empty());
        assert!(!buf.indices.is_empty());
    }

    #[test]
    fn bezier_empty_returns_empty() {
        let buf = tessellate_bezier(&[], 0.5).unwrap();
        assert!(buf.vertices.is_empty());
    }
}
