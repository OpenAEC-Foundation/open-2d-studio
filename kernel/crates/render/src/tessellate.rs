//! Complex shape tessellation via lyon.
//!
//! Simpele shapes (line/rect/circle) gebruiken instanced rendering met een
//! unit quad template — geen tessellation nodig. Complex shapes (hatches,
//! splines, arcs) worden hier naar f32 local vertices getesselleerd en
//! gecached voor hergebruik.

use bytemuck::{Pod, Zeroable};
use lyon::math::Point;
use lyon::path::Path;
use lyon::tessellation::{
    BuffersBuilder, FillOptions, FillTessellator, FillVertex,
    StrokeOptions, StrokeTessellator, StrokeVertex, VertexBuffers,
};

#[repr(C)]
#[derive(Copy, Clone, Debug, Pod, Zeroable)]
pub struct TessVertex {
    pub pos: [f32; 2],
}

pub type TessBuffers = VertexBuffers<TessVertex, u32>;

/// Tessellate the interior (fill) of a closed polygon in local coordinates.
/// Returns vertex + index buffer suitable for a drawIndexed call.
pub fn tessellate_fill(points: &[[f32; 2]]) -> anyhow::Result<TessBuffers> {
    if points.len() < 3 {
        return Ok(VertexBuffers::new());
    }
    let mut builder = Path::builder();
    builder.begin(Point::new(points[0][0], points[0][1]));
    for p in &points[1..] {
        builder.line_to(Point::new(p[0], p[1]));
    }
    builder.end(true);
    let path = builder.build();

    let mut buffers: TessBuffers = VertexBuffers::new();
    let mut tessellator = FillTessellator::new();
    tessellator.tessellate_path(
        &path,
        &FillOptions::tolerance(0.1),
        &mut BuffersBuilder::new(&mut buffers, |vertex: FillVertex| TessVertex {
            pos: vertex.position().to_array(),
        }),
    )?;
    Ok(buffers)
}

/// Tessellate the stroke (outline) of a polyline in local coordinates.
pub fn tessellate_stroke(points: &[[f32; 2]], width: f32) -> anyhow::Result<TessBuffers> {
    if points.len() < 2 {
        return Ok(VertexBuffers::new());
    }
    let mut builder = Path::builder();
    builder.begin(Point::new(points[0][0], points[0][1]));
    for p in &points[1..] {
        builder.line_to(Point::new(p[0], p[1]));
    }
    builder.end(false);
    let path = builder.build();

    let mut buffers: TessBuffers = VertexBuffers::new();
    let mut tessellator = StrokeTessellator::new();
    tessellator.tessellate_path(
        &path,
        &StrokeOptions::tolerance(0.1).with_line_width(width),
        &mut BuffersBuilder::new(&mut buffers, |vertex: StrokeVertex| TessVertex {
            pos: vertex.position().to_array(),
        }),
    )?;
    Ok(buffers)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fill_triangle_produces_vertices() {
        let tri = &[[0.0, 0.0], [10.0, 0.0], [5.0, 10.0]];
        let buf = tessellate_fill(tri).unwrap();
        assert!(!buf.vertices.is_empty(), "no vertices");
        assert!(!buf.indices.is_empty(), "no indices");
        assert_eq!(buf.indices.len() % 3, 0, "triangle list must be multiple of 3");
    }

    #[test]
    fn fill_rectangle_produces_6_indices_or_more() {
        let rect = &[[0.0, 0.0], [10.0, 0.0], [10.0, 10.0], [0.0, 10.0]];
        let buf = tessellate_fill(rect).unwrap();
        // Rectangle splits to 2 triangles = 6 indices minimum
        assert!(buf.indices.len() >= 6);
    }

    #[test]
    fn stroke_produces_vertices() {
        let line = &[[0.0, 0.0], [100.0, 0.0]];
        let buf = tessellate_stroke(line, 2.0).unwrap();
        assert!(!buf.vertices.is_empty());
    }

    #[test]
    fn fill_empty_returns_empty() {
        let buf = tessellate_fill(&[]).unwrap();
        assert!(buf.vertices.is_empty());
        assert!(buf.indices.is_empty());
    }
}
