//! GPU render pipeline — retained-mode instance rendering.
//!
//! Eén render pipeline die alle simpele shapes (line, rect, circle, polyline)
//! via instanced rendering tekent. Complex shapes (hatch, text) komen later
//! via eigen pipelines.

use crate::instance::{instance_buffer_layout, Instance};
use bytemuck::{Pod, Zeroable};
use kernel_core::{RenderOrigin, WorldPos};
use wgpu::util::DeviceExt;

/// Camera uniform uploaded per frame.
#[repr(C)]
#[derive(Copy, Clone, Pod, Zeroable)]
pub struct CameraUniform {
    pub view_proj: [[f32; 4]; 4],
}

impl CameraUniform {
    /// Build an orthographic view-projection matrix for CAD-style 2D rendering.
    ///
    /// The origin is the floating-origin anchor (WorldPos in f64). All
    /// instance positions passed to GPU are already camera-relative f32.
    pub fn ortho(center: [f32; 2], zoom: f32, aspect: f32) -> Self {
        let half_w = (1.0 / zoom) * aspect;
        let half_h = 1.0 / zoom;
        // Orthographic projection: maps [center-hw, center+hw] x [center-hh, center+hh]
        // to clip space [-1, 1]^2.
        let sx = 1.0 / half_w;
        let sy = 1.0 / half_h;
        let tx = -center[0] * sx;
        let ty = -center[1] * sy;
        let m = [
            [sx,  0.0, 0.0, 0.0],
            [0.0, sy,  0.0, 0.0],
            [0.0, 0.0, 1.0, 0.0],
            [tx,  ty,  0.0, 1.0],
        ];
        Self { view_proj: m }
    }
}

/// GPU rendering pipeline state. Owns the pipeline, vertex buffers, camera UBO.
pub struct ShapePipeline {
    pub pipeline: wgpu::RenderPipeline,
    /// Static template vertex buffer — unit quad at origin (6 verts).
    pub template_vb: wgpu::Buffer,
    /// Persistent instance buffer — sparse dirty updates.
    pub instance_vb: wgpu::Buffer,
    pub instance_capacity: u32,
    pub camera_ub: wgpu::Buffer,
    pub camera_bg: wgpu::BindGroup,
}

impl ShapePipeline {
    /// Create a new pipeline with capacity for `max_instances` shapes.
    pub fn new(
        device: &wgpu::Device,
        target_format: wgpu::TextureFormat,
        max_instances: u32,
    ) -> anyhow::Result<Self> {
        // Unit quad (0,0)-centered, size 1×1
        let verts: &[[f32; 2]] = &[
            [-0.5, -0.5], [0.5, -0.5], [-0.5, 0.5],
            [-0.5, 0.5], [0.5, -0.5], [0.5, 0.5],
        ];
        let template_vb = device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
            label: Some("kernel-render:template"),
            contents: bytemuck::cast_slice(verts),
            usage: wgpu::BufferUsages::VERTEX,
        });

        let instance_size = max_instances as u64 * std::mem::size_of::<Instance>() as u64;
        let instance_vb = device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("kernel-render:instances"),
            size: instance_size,
            usage: wgpu::BufferUsages::VERTEX | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });

        let camera_ub = device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("kernel-render:camera"),
            size: std::mem::size_of::<CameraUniform>() as u64,
            usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });

        let bgl = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("kernel-render:camera-bgl"),
            entries: &[wgpu::BindGroupLayoutEntry {
                binding: 0,
                visibility: wgpu::ShaderStages::VERTEX,
                ty: wgpu::BindingType::Buffer {
                    ty: wgpu::BufferBindingType::Uniform,
                    has_dynamic_offset: false,
                    min_binding_size: None,
                },
                count: None,
            }],
        });
        let camera_bg = device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("kernel-render:camera-bg"),
            layout: &bgl,
            entries: &[wgpu::BindGroupEntry {
                binding: 0,
                resource: camera_ub.as_entire_binding(),
            }],
        });

        let shader = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("kernel-render:shapes.wgsl"),
            source: wgpu::ShaderSource::Wgsl(include_str!("shaders/shapes.wgsl").into()),
        });

        let pl_layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some("kernel-render:pl"),
            bind_group_layouts: &[&bgl],
            push_constant_ranges: &[],
        });

        let unit_vb_layout = wgpu::VertexBufferLayout {
            array_stride: 8,
            step_mode: wgpu::VertexStepMode::Vertex,
            attributes: &wgpu::vertex_attr_array![0 => Float32x2],
        };

        let pipeline = device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
            label: Some("kernel-render:pipeline"),
            layout: Some(&pl_layout),
            vertex: wgpu::VertexState {
                module: &shader,
                entry_point: "vs_main",
                buffers: &[unit_vb_layout, instance_buffer_layout()],
                compilation_options: Default::default(),
            },
            primitive: wgpu::PrimitiveState {
                topology: wgpu::PrimitiveTopology::TriangleList,
                ..Default::default()
            },
            depth_stencil: None,
            multisample: wgpu::MultisampleState::default(),
            fragment: Some(wgpu::FragmentState {
                module: &shader,
                entry_point: "fs_main",
                targets: &[Some(wgpu::ColorTargetState {
                    format: target_format,
                    blend: Some(wgpu::BlendState::ALPHA_BLENDING),
                    write_mask: wgpu::ColorWrites::ALL,
                })],
                compilation_options: Default::default(),
            }),
            multiview: None,
            cache: None,
        });

        Ok(Self {
            pipeline, template_vb, instance_vb,
            instance_capacity: max_instances,
            camera_ub, camera_bg,
        })
    }

    /// Upload camera matrix. Call once per frame before render().
    pub fn update_camera(&self, queue: &wgpu::Queue, camera: CameraUniform) {
        queue.write_buffer(&self.camera_ub, 0, bytemuck::cast_slice(&[camera]));
    }

    /// Fast path: replace the whole instance buffer.
    /// Use this when > 1000 dirty per frame — cheaper than sparse writes.
    pub fn upload_instances(&self, queue: &wgpu::Queue, instances: &[Instance]) {
        assert!(instances.len() <= self.instance_capacity as usize,
            "instance count {} exceeds capacity {}", instances.len(), self.instance_capacity);
        queue.write_buffer(&self.instance_vb, 0, bytemuck::cast_slice(instances));
    }

    /// Sparse path: write specific dirty indices.
    /// Coalesces contiguous runs for driver efficiency.
    pub fn upload_instances_sparse(&self, queue: &wgpu::Queue, dirty: &[(u32, Instance)]) {
        let mut sorted: Vec<(u32, Instance)> = dirty.to_vec();
        sorted.sort_by_key(|&(i, _)| i);
        let stride = std::mem::size_of::<Instance>() as u64;

        let mut i = 0;
        while i < sorted.len() {
            let mut j = i + 1;
            while j < sorted.len() && sorted[j].0 == sorted[j - 1].0 + 1 {
                j += 1;
            }
            let run: Vec<Instance> = sorted[i..j].iter().map(|&(_, inst)| inst).collect();
            let offset = sorted[i].0 as u64 * stride;
            queue.write_buffer(&self.instance_vb, offset, bytemuck::cast_slice(&run));
            i = j;
        }
    }

    /// Issue draw commands. Call within an active RenderPass.
    pub fn draw<'a>(&'a self, pass: &mut wgpu::RenderPass<'a>, instance_count: u32) {
        pass.set_pipeline(&self.pipeline);
        pass.set_bind_group(0, &self.camera_bg, &[]);
        pass.set_vertex_buffer(0, self.template_vb.slice(..));
        pass.set_vertex_buffer(1, self.instance_vb.slice(..));
        pass.draw(0..6, 0..instance_count);
    }
}

/// Convert a world-space center (f64) + render origin to a camera-relative f32 center.
pub fn camera_center(world: WorldPos, origin: RenderOrigin) -> [f32; 2] {
    [(world.x - origin.x) as f32, (world.y - origin.y) as f32]
}
