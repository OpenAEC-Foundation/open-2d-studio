//! Minimale API-verificatie voor wgpu 0.20 + winit 0.30.
//! Dit compileert alle kritische API calls die de code-review flagde,
//! zonder een window te hoeven openen (adapter-only probe).

use bytemuck::{Pod, Zeroable};

#[repr(C)]
#[derive(Copy, Clone, Debug, Pod, Zeroable)]
pub struct Instance {
    pub pos: [f32; 2],
    pub rotation: f32,
    pub scale: [f32; 2],
    pub color: u32,
    pub style_idx: u32,
    pub _pad: u32,
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

async fn probe_adapter() -> anyhow::Result<()> {
    // Test wgpu 0.20 Instance::new API — does it take value or reference?
    let instance = wgpu::Instance::new(wgpu::InstanceDescriptor {
        backends: wgpu::Backends::PRIMARY,
        flags: wgpu::InstanceFlags::default(),
        dx12_shader_compiler: wgpu::Dx12Compiler::default(),
        gles_minor_version: wgpu::Gles3MinorVersion::default(),
    });

    // Adapter request — no surface, just probe
    let adapter = instance
        .request_adapter(&wgpu::RequestAdapterOptions {
            power_preference: wgpu::PowerPreference::HighPerformance,
            compatible_surface: None,
            force_fallback_adapter: false,
        })
        .await
        .ok_or_else(|| anyhow::anyhow!("no GPU adapter"))?;

    let info = adapter.get_info();
    println!("[GPU] {} ({:?})", info.name, info.backend);
    println!("      driver: {}", info.driver);

    // Test DeviceDescriptor fields in wgpu 0.20
    let (device, _queue) = adapter
        .request_device(
            &wgpu::DeviceDescriptor {
                label: Some("probe"),
                required_features: wgpu::Features::empty(),
                required_limits: wgpu::Limits::default(),
                // Note: `memory_hints` was added in wgpu 0.21, NOT in 0.20.
                // The design spec was wrong about this.
            },
            None,
        )
        .await?;

    println!("      device limits: max_buffer_size={}", device.limits().max_buffer_size);

    // Test that instance_buffer_layout compiles — this is the API surface
    // that Task 2's renderer uses.
    let layout = instance_buffer_layout();
    println!("      instance buffer stride: {} bytes", layout.array_stride);
    println!("      instance struct size:   {} bytes", std::mem::size_of::<Instance>());

    Ok(())
}

fn main() -> anyhow::Result<()> {
    pollster::block_on(probe_adapter())
}
