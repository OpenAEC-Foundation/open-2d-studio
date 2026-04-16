//! kernel-app — top-level app binding: winit + wgpu + egui + ECS loop.
//! Dit is de entry point die de andere crates samenvoegt tot één draaiend programma.

use bevy_ecs::prelude::*;
use kernel_core::new_world;

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
