//! kernel-render — wgpu rendering pipeline voor de Open 2D Studio kernel.
//!
//! Deze crate bevat de retained-mode instance buffer, shape rendering pipeline,
//! en de viewport/camera logica. Geen UI — die leeft in kernel-app.

pub mod instance;
pub mod pipeline;
pub mod style;

pub use instance::{Instance, INSTANCE_ATTRIBS, instance_buffer_layout};
pub use pipeline::{camera_center, CameraUniform, ShapePipeline};
pub use style::{LineStyle, Style, StyleTable};
