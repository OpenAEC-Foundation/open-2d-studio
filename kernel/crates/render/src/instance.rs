//! GPU Instance struct — retained-mode per-shape data.
//! 32 bytes per instance, bytemuck-Pod, matches WGSL location layout.

use bytemuck::{Pod, Zeroable};

#[repr(C)]
#[derive(Copy, Clone, Debug, Pod, Zeroable)]
pub struct Instance {
    /// Camera-relative position (f64 world pos minus RenderOrigin).
    pub pos: [f32; 2],
    /// Rotation in radians.
    pub rotation: f32,
    /// Non-uniform scale (x, y) in world units.
    pub scale: [f32; 2],
    /// Packed RGBA color, little-endian u8x4.
    pub color: u32,
    /// Index into StyleTable (layer, stroke/fill, line dash pattern).
    pub style_idx: u32,
    /// Visibility/selection bit flags; layout must match WGSL.
    pub flags: u32,
}

pub const INSTANCE_ATTRIBS: &[wgpu::VertexAttribute] = &wgpu::vertex_attr_array![
    1 => Float32x2,  // pos
    2 => Float32,    // rotation
    3 => Float32x2,  // scale
    4 => Uint32,     // color
    5 => Uint32,     // style_idx
    6 => Uint32,     // flags
];

pub fn instance_buffer_layout() -> wgpu::VertexBufferLayout<'static> {
    wgpu::VertexBufferLayout {
        array_stride: std::mem::size_of::<Instance>() as wgpu::BufferAddress,
        step_mode: wgpu::VertexStepMode::Instance,
        attributes: INSTANCE_ATTRIBS,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn instance_is_32_bytes() {
        assert_eq!(std::mem::size_of::<Instance>(), 32);
    }

    #[test]
    fn instance_is_bytemuck_pod() {
        fn assert_pod<T: Pod>() {}
        assert_pod::<Instance>();
    }
}
