//! kernel-app — top-level app binding: winit + wgpu + egui + ECS loop.

use bevy_ecs::prelude::*;
use kernel_core::new_world;

pub mod app;
pub mod dxf_export;
pub mod gpu;
pub mod ifcx_export;
pub mod scene_io;
pub mod stroke_font;
/// Real application — tabbed DWG/DXF viewer used by both the
/// `open_2d_studio` and `open_2d_viewer` binary shims. Exposes
/// [`studio_app::run`] + the [`studio_app::AppMode`] enum that
/// decides which UI variant is built.
pub mod studio_app;
pub mod sync;
pub mod ttf_font;

pub use app::{App, DEMO_SHAPE_COUNT};
pub use studio_app::{run as run_app, AppMode};

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
