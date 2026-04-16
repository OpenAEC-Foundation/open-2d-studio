use bytemuck::{Pod, Zeroable};

#[repr(C)]
#[derive(Copy, Clone, Debug, Pod, Zeroable)]
pub struct Instance {
    pub pos: [f32; 2],       // 8
    pub rotation: f32,        // 4
    pub scale: [f32; 2],      // 8
    pub color: u32,           // 4 (packed rgba u8x4)
    pub style_idx: u32,       // 4
    pub _pad: u32,            // 4
}
// total 32 bytes

impl Instance {
    pub fn new(x: f32, y: f32, scale: f32, color: [u8; 4]) -> Self {
        Self {
            pos: [x, y],
            rotation: 0.0,
            scale: [scale, scale],
            color: u32::from_le_bytes(color),
            style_idx: 0,
            _pad: 0,
        }
    }
}

pub const INSTANCE_ATTRIBS: &[wgpu::VertexAttribute] = &wgpu::vertex_attr_array![
    1 => Float32x2,
    2 => Float32,
    3 => Float32x2,
    4 => Uint32,
    5 => Uint32,
];

pub fn instance_buffer_layout() -> wgpu::VertexBufferLayout<'static> {
    wgpu::VertexBufferLayout {
        array_stride: std::mem::size_of::<Instance>() as wgpu::BufferAddress,
        step_mode: wgpu::VertexStepMode::Instance,
        attributes: INSTANCE_ATTRIBS,
    }
}

pub fn generate_scene(count: usize) -> Vec<Instance> {
    let mut out = Vec::with_capacity(count);
    let cols = (count as f32).sqrt().ceil() as usize;
    let spacing = 5.0;
    let mut lcg: u32 = 0x1234_5678;
    for i in 0..count {
        let col = (i % cols) as f32;
        let row = (i / cols) as f32;
        lcg = lcg.wrapping_mul(1664525).wrapping_add(1013904223);
        let x = col * spacing + ((lcg >> 8) as f32 / u32::MAX as f32) * 2.0 - 1.0;
        let y = row * spacing + ((lcg >> 16) as f32 / u32::MAX as f32) * 2.0 - 1.0;
        let color = [
            ((lcg >> 0) & 0xFF) as u8,
            ((lcg >> 8) & 0xFF) as u8,
            ((lcg >> 16) & 0xFF) as u8,
            255,
        ];
        out.push(Instance::new(x, y, 2.0, color));
    }
    out
}
