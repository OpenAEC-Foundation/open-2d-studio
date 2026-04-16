//! kernel-render — wgpu rendering pipeline voor de Open 2D Studio kernel.
//!
//! Deze crate bevat de retained-mode instance buffer, shape rendering pipeline,
//! en de viewport/camera logica. Geen UI — die leeft in kernel-app.

use bevy_ecs::prelude::*;
use bytemuck::{Pod, Zeroable};
use kernel_core::{RenderOrigin, ShapeId, StyleRef, WorldPos};

pub mod instance;
pub mod style;

pub use instance::{Instance, INSTANCE_ATTRIBS, instance_buffer_layout};
pub use style::{Style, StyleTable};

/// Placeholder — wordt later uitgewerkt tot volledige Renderer struct
/// (overgenomen uit spike prototype 6).
pub struct Renderer;

impl Renderer {
    pub fn placeholder() -> Self { Self }
}
