//! ECS → GPU sync — convert ECS components to instance buffer entries.

use bevy_ecs::prelude::*;
use kernel_core::{Position, RenderOrigin, ShapeKind, Transform2D, Visible};
use kernel_render::Instance;

/// Collect all visible shapes from the World into a flat instance buffer.
/// Camera-relative f32 positions computed using the active RenderOrigin.
pub fn collect_instances(world: &mut World, out: &mut Vec<Instance>) {
    out.clear();
    let origin = *world.resource::<RenderOrigin>();

    // Basic path: position + kind. Full component set to be added later.
    let mut q = world.query_filtered::<(&Position, Option<&Transform2D>), With<Visible>>();
    for (pos, xform) in q.iter(world) {
        let local_x = (pos.x - origin.x) as f32;
        let local_y = (pos.y - origin.y) as f32;
        let (rot, sx, sy) = match xform {
            Some(t) => (t.rotation, t.scale_x, t.scale_y),
            None => (0.0, 1.0, 1.0),
        };
        out.push(Instance {
            pos: [local_x, local_y],
            rotation: rot,
            scale: [sx, sy],
            color: 0xFF_FFFFFF, // TEMP: default white — will use StyleRef later
            style_idx: 0,
            flags: 1, // visible
        });
    }
    let _ = ShapeKind::Line; // silence unused import
}

/// Seed world with a demo grid of N shapes for benchmarking.
pub fn seed_demo_shapes(world: &mut World, count: usize) {
    let cols = (count as f32).sqrt().ceil() as usize;
    for i in 0..count {
        let col = (i % cols) as f64;
        let row = (i / cols) as f64;
        world.spawn((
            kernel_core::ShapeId::new(),
            Position { x: (col - cols as f64 / 2.0) * 3.0, y: (row - cols as f64 / 2.0) * 3.0 },
            Transform2D { rotation: 0.0, scale_x: 2.0, scale_y: 2.0 },
            Visible,
        ));
    }
}
