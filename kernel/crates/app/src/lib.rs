//! kernel-app — top-level app binding: winit + wgpu + egui + ECS loop.

use bevy_ecs::prelude::*;
use kernel_core::new_world;

pub mod app;
pub mod gpu;
pub mod sync;

pub use app::{App, DEMO_SHAPE_COUNT};

/// Bootstrap a World with all kernel subsystems installed.
pub fn create_world() -> World {
    let mut world = new_world();
    kernel_commands::install(&mut world);
    world
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn world_bootstraps() {
        let world = create_world();
        assert!(world.contains_resource::<kernel_core::ShapeIndex>());
        assert!(world.contains_resource::<kernel_commands::CommandHistory>());
    }
}
