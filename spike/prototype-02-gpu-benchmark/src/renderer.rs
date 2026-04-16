use crate::instance::{instance_buffer_layout, Instance};
use bytemuck::{Pod, Zeroable};
use std::sync::Arc;
use wgpu::util::DeviceExt;
use winit::window::Window;

#[repr(C)]
#[derive(Copy, Clone, Pod, Zeroable)]
struct Camera {
    view_proj: [[f32; 4]; 4],
}

pub struct Renderer {
    surface: wgpu::Surface<'static>,
    device: wgpu::Device,
    queue: wgpu::Queue,
    config: wgpu::SurfaceConfiguration,
    pipeline: wgpu::RenderPipeline,
    template_vb: wgpu::Buffer,
    instance_vb: wgpu::Buffer,
    camera_ub: wgpu::Buffer,
    camera_bg: wgpu::BindGroup,
    instance_count: u32,
}

impl Renderer {
    pub async fn new(window: Arc<Window>, instances: &[Instance]) -> anyhow::Result<Self> {
        let size = window.inner_size();
        let instance_api = wgpu::Instance::new(wgpu::InstanceDescriptor {
            backends: wgpu::Backends::PRIMARY,
            flags: wgpu::InstanceFlags::default(),
            dx12_shader_compiler: wgpu::Dx12Compiler::default(),
            gles_minor_version: wgpu::Gles3MinorVersion::default(),
        });

        let surface = instance_api.create_surface(window.clone())?;
        let adapter = instance_api
            .request_adapter(&wgpu::RequestAdapterOptions {
                power_preference: wgpu::PowerPreference::HighPerformance,
                compatible_surface: Some(&surface),
                force_fallback_adapter: false,
            })
            .await
            .ok_or_else(|| anyhow::anyhow!("no adapter"))?;

        let info = adapter.get_info();
        eprintln!("[GPU] {} ({:?})", info.name, info.backend);

        let (device, queue) = adapter
            .request_device(
                &wgpu::DeviceDescriptor {
                    label: Some("spike-device"),
                    required_features: wgpu::Features::empty(),
                    required_limits: wgpu::Limits::default(),
                },
                None,
            )
            .await?;

        let caps = surface.get_capabilities(&adapter);
        let format = caps.formats.iter().copied()
            .find(|f| f.is_srgb())
            .unwrap_or(caps.formats[0]);
        let present_mode = if caps.present_modes.contains(&wgpu::PresentMode::Mailbox) {
            wgpu::PresentMode::Mailbox
        } else {
            wgpu::PresentMode::Fifo
        };
        let config = wgpu::SurfaceConfiguration {
            usage: wgpu::TextureUsages::RENDER_ATTACHMENT,
            format,
            width: size.width.max(1),
            height: size.height.max(1),
            present_mode,
            desired_maximum_frame_latency: 2,
            alpha_mode: caps.alpha_modes[0],
            view_formats: vec![],
        };
        surface.configure(&device, &config);

        // Unit quad (centered at origin, size 1x1)
        let verts: &[[f32; 2]] = &[
            [-0.5, -0.5], [0.5, -0.5], [-0.5, 0.5],
            [-0.5, 0.5], [0.5, -0.5], [0.5, 0.5],
        ];
        let template_vb = device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
            label: Some("template-vb"),
            contents: bytemuck::cast_slice(verts),
            usage: wgpu::BufferUsages::VERTEX,
        });

        let instance_vb = device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
            label: Some("instance-vb"),
            contents: bytemuck::cast_slice(instances),
            usage: wgpu::BufferUsages::VERTEX | wgpu::BufferUsages::COPY_DST,
        });

        let camera_ub = device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("camera-ub"),
            size: std::mem::size_of::<Camera>() as u64,
            usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });

        let bgl = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("camera-bgl"),
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
            label: Some("camera-bg"),
            layout: &bgl,
            entries: &[wgpu::BindGroupEntry {
                binding: 0,
                resource: camera_ub.as_entire_binding(),
            }],
        });

        let shader = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("instances"),
            source: wgpu::ShaderSource::Wgsl(include_str!("shaders/instances.wgsl").into()),
        });

        let unit_vb_layout = wgpu::VertexBufferLayout {
            array_stride: 8,
            step_mode: wgpu::VertexStepMode::Vertex,
            attributes: &wgpu::vertex_attr_array![0 => Float32x2],
        };

        let pipeline_layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some("pl"),
            bind_group_layouts: &[&bgl],
            push_constant_ranges: &[],
        });

        let pipeline = device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
            label: Some("instance-pipeline"),
            layout: Some(&pipeline_layout),
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
                    format,
                    blend: Some(wgpu::BlendState::REPLACE),
                    write_mask: wgpu::ColorWrites::ALL,
                })],
                compilation_options: Default::default(),
            }),
            multiview: None,
        });

        Ok(Self {
            surface, device, queue, config, pipeline,
            template_vb, instance_vb, camera_ub, camera_bg,
            instance_count: instances.len() as u32,
        })
    }

    pub fn resize(&mut self, w: u32, h: u32) {
        if w == 0 || h == 0 { return; }
        self.config.width = w;
        self.config.height = h;
        self.surface.configure(&self.device, &self.config);
    }

    pub fn update_camera(&self, view_proj: [[f32; 4]; 4]) {
        self.queue.write_buffer(&self.camera_ub, 0, bytemuck::cast_slice(&[Camera { view_proj }]));
    }

    pub fn update_instances_sparse(&self, dirty: &[(u32, Instance)]) {
        // Coalesce contiguous runs to reduce driver overhead (Programmeur's R1 concern)
        let mut sorted: Vec<(u32, Instance)> = dirty.to_vec();
        sorted.sort_by_key(|&(i, _)| i);
        let stride = std::mem::size_of::<Instance>() as u64;

        let mut i = 0;
        while i < sorted.len() {
            let mut j = i + 1;
            // Find end of contiguous run
            while j < sorted.len() && sorted[j].0 == sorted[j - 1].0 + 1 {
                j += 1;
            }
            // Build a slice from sorted[i..j] and write in one call
            let run: Vec<Instance> = sorted[i..j].iter().map(|&(_, inst)| inst).collect();
            let offset = sorted[i].0 as u64 * stride;
            self.queue.write_buffer(&self.instance_vb, offset, bytemuck::cast_slice(&run));
            i = j;
        }
    }

    pub fn render(&self) -> Result<(), wgpu::SurfaceError> {
        let frame = self.surface.get_current_texture()?;
        let view = frame.texture.create_view(&wgpu::TextureViewDescriptor::default());
        let mut encoder = self.device.create_command_encoder(&wgpu::CommandEncoderDescriptor {
            label: Some("frame"),
        });
        {
            let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                label: Some("main"),
                color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                    view: &view,
                    resolve_target: None,
                    ops: wgpu::Operations {
                        load: wgpu::LoadOp::Clear(wgpu::Color { r: 0.05, g: 0.06, b: 0.09, a: 1.0 }),
                        store: wgpu::StoreOp::Store,
                    },
                })],
                depth_stencil_attachment: None,
                timestamp_writes: None,
                occlusion_query_set: None,
            });
            pass.set_pipeline(&self.pipeline);
            pass.set_bind_group(0, &self.camera_bg, &[]);
            pass.set_vertex_buffer(0, self.template_vb.slice(..));
            pass.set_vertex_buffer(1, self.instance_vb.slice(..));
            pass.draw(0..6, 0..self.instance_count);
        }
        self.queue.submit(std::iter::once(encoder.finish()));
        frame.present();
        Ok(())
    }
}
