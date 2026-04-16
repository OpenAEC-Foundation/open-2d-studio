//! Prototype 6 — INTEGRATION: egui UI + wgpu 22 canvas rendering 100k shapes
//! in the same window, same frame. Proves the full stack works.

use bevy_ecs::prelude::*;
use bytemuck::{Pod, Zeroable};
use egui_wgpu::ScreenDescriptor;
use std::sync::Arc;
use std::time::Instant;
use uuid::Uuid;
use wgpu::util::DeviceExt;
use winit::application::ApplicationHandler;
use winit::event::{KeyEvent, WindowEvent};
use winit::event_loop::{ActiveEventLoop, EventLoop};
use winit::keyboard::{KeyCode, PhysicalKey};
use winit::window::Window;

const SHAPE_COUNT: usize = 100_000;

// ── ECS Components ───────────────────────────────────────────────────────

#[derive(Component, Clone, Copy, Debug)]
struct ShapeId(Uuid);

#[derive(Component, Clone, Copy, Debug)]
struct Position(f32, f32);

#[derive(Component, Clone, Copy, Debug)]
struct Color(u32);

#[derive(Component, Clone, Copy, Debug)]
struct Scale(f32);

// ── GPU Instance ─────────────────────────────────────────────────────────

#[repr(C)]
#[derive(Copy, Clone, Pod, Zeroable)]
struct Instance {
    pos: [f32; 2],
    scale: [f32; 2],
    color: u32,
    _pad: u32,
}

#[repr(C)]
#[derive(Copy, Clone, Pod, Zeroable)]
struct Camera {
    view_proj: [[f32; 4]; 4],
}

const INSTANCE_ATTRIBS: &[wgpu::VertexAttribute] = &wgpu::vertex_attr_array![
    1 => Float32x2,  // pos
    2 => Float32x2,  // scale
    3 => Uint32,     // color
];

// ── Scene Renderer ───────────────────────────────────────────────────────

struct SceneRenderer {
    pipeline: wgpu::RenderPipeline,
    template_vb: wgpu::Buffer,
    instance_vb: wgpu::Buffer,
    camera_ub: wgpu::Buffer,
    camera_bg: wgpu::BindGroup,
    instance_count: u32,
}

impl SceneRenderer {
    fn new(device: &wgpu::Device, format: wgpu::TextureFormat, instances: &[Instance]) -> Self {
        let verts: &[[f32; 2]] = &[
            [-0.5, -0.5], [0.5, -0.5], [-0.5, 0.5],
            [-0.5, 0.5], [0.5, -0.5], [0.5, 0.5],
        ];
        let template_vb = device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
            label: Some("template"),
            contents: bytemuck::cast_slice(verts),
            usage: wgpu::BufferUsages::VERTEX,
        });
        let instance_vb = device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
            label: Some("instances"),
            contents: bytemuck::cast_slice(instances),
            usage: wgpu::BufferUsages::VERTEX | wgpu::BufferUsages::COPY_DST,
        });
        let camera_ub = device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("camera"),
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
            label: Some("shapes"),
            source: wgpu::ShaderSource::Wgsl(include_str!("shaders/shapes.wgsl").into()),
        });
        let pl_layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some("pl"),
            bind_group_layouts: &[&bgl],
            push_constant_ranges: &[],
        });
        let unit_vb_layout = wgpu::VertexBufferLayout {
            array_stride: 8,
            step_mode: wgpu::VertexStepMode::Vertex,
            attributes: &wgpu::vertex_attr_array![0 => Float32x2],
        };
        let instance_vb_layout = wgpu::VertexBufferLayout {
            array_stride: std::mem::size_of::<Instance>() as u64,
            step_mode: wgpu::VertexStepMode::Instance,
            attributes: INSTANCE_ATTRIBS,
        };
        let pipeline = device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
            label: Some("shapes-pipeline"),
            layout: Some(&pl_layout),
            vertex: wgpu::VertexState {
                module: &shader, entry_point: "vs_main",
                buffers: &[unit_vb_layout, instance_vb_layout],
                compilation_options: Default::default(),
            },
            primitive: wgpu::PrimitiveState {
                topology: wgpu::PrimitiveTopology::TriangleList,
                ..Default::default()
            },
            depth_stencil: None,
            multisample: wgpu::MultisampleState::default(),
            fragment: Some(wgpu::FragmentState {
                module: &shader, entry_point: "fs_main",
                targets: &[Some(wgpu::ColorTargetState {
                    format,
                    blend: Some(wgpu::BlendState::ALPHA_BLENDING),
                    write_mask: wgpu::ColorWrites::ALL,
                })],
                compilation_options: Default::default(),
            }),
            multiview: None,
            cache: None,
        });
        Self {
            pipeline, template_vb, instance_vb, camera_ub, camera_bg,
            instance_count: instances.len() as u32,
        }
    }

    fn update_camera(&self, queue: &wgpu::Queue, view_proj: [[f32; 4]; 4]) {
        queue.write_buffer(&self.camera_ub, 0, bytemuck::cast_slice(&[Camera { view_proj }]));
    }

    fn render<'a>(&'a self, pass: &mut wgpu::RenderPass<'a>) {
        pass.set_pipeline(&self.pipeline);
        pass.set_bind_group(0, &self.camera_bg, &[]);
        pass.set_vertex_buffer(0, self.template_vb.slice(..));
        pass.set_vertex_buffer(1, self.instance_vb.slice(..));
        pass.draw(0..6, 0..self.instance_count);
    }
}

// ── ECS to Instance conversion ───────────────────────────────────────────

fn seed_ecs(world: &mut World, count: usize) {
    let cols = (count as f32).sqrt().ceil() as usize;
    let mut lcg: u32 = 0xDEAD_BEEF;
    for i in 0..count {
        let col = (i % cols) as f32;
        let row = (i / cols) as f32;
        let x = (col - cols as f32 / 2.0) * 3.0;
        let y = (row - cols as f32 / 2.0) * 3.0;
        lcg = lcg.wrapping_mul(1664525).wrapping_add(1013904223);
        let color = lcg | 0xFF00_0000;
        world.spawn((
            ShapeId(Uuid::new_v4()),
            Position(x, y),
            Scale(2.0),
            Color(color),
        ));
    }
}

fn collect_instances(world: &mut World, out: &mut Vec<Instance>) {
    out.clear();
    let mut q = world.query::<(&Position, &Scale, &Color)>();
    for (p, s, c) in q.iter(world) {
        out.push(Instance {
            pos: [p.0, p.1],
            scale: [s.0, s.0],
            color: c.0,
            _pad: 0,
        });
    }
}

// ── App ──────────────────────────────────────────────────────────────────

struct App {
    window: Option<Arc<Window>>,
    surface: Option<wgpu::Surface<'static>>,
    device: Option<wgpu::Device>,
    queue: Option<wgpu::Queue>,
    config: Option<wgpu::SurfaceConfiguration>,
    egui_ctx: egui::Context,
    egui_state: Option<egui_winit::State>,
    egui_renderer: Option<egui_wgpu::Renderer>,
    scene: Option<SceneRenderer>,

    world: World,
    instances: Vec<Instance>,

    selected_tool: String,
    zoom: f32,
    last_frame: Instant,
    fps_samples: Vec<f32>,
    mean_fps: f32,
}

impl App {
    fn new() -> Self {
        let mut world = World::new();
        seed_ecs(&mut world, SHAPE_COUNT);
        let mut instances = Vec::with_capacity(SHAPE_COUNT);
        collect_instances(&mut world, &mut instances);

        Self {
            window: None, surface: None, device: None, queue: None, config: None,
            egui_ctx: egui::Context::default(),
            egui_state: None, egui_renderer: None, scene: None,
            world, instances,
            selected_tool: "select".into(),
            zoom: 1.0,
            last_frame: Instant::now(),
            fps_samples: Vec::with_capacity(120),
            mean_fps: 0.0,
        }
    }
}

impl ApplicationHandler for App {
    fn resumed(&mut self, event_loop: &ActiveEventLoop) {
        let win = Arc::new(event_loop.create_window(
            Window::default_attributes()
                .with_title(format!("Spike 06 — {} shapes + egui", SHAPE_COUNT))
                .with_inner_size(winit::dpi::LogicalSize::new(1600, 1000)),
        ).unwrap());

        pollster::block_on(async {
            let instance = wgpu::Instance::new(wgpu::InstanceDescriptor {
                backends: wgpu::Backends::PRIMARY,
                ..Default::default()
            });
            let surface = instance.create_surface(win.clone()).unwrap();
            let adapter = instance.request_adapter(&wgpu::RequestAdapterOptions {
                power_preference: wgpu::PowerPreference::HighPerformance,
                compatible_surface: Some(&surface),
                force_fallback_adapter: false,
            }).await.unwrap();
            let info = adapter.get_info();
            eprintln!("[GPU] {} ({:?})", info.name, info.backend);

            let (device, queue) = adapter.request_device(&wgpu::DeviceDescriptor {
                label: Some("main"),
                required_features: wgpu::Features::empty(),
                required_limits: wgpu::Limits::default(),
                memory_hints: wgpu::MemoryHints::Performance,
            }, None).await.unwrap();

            let size = win.inner_size();
            let caps = surface.get_capabilities(&adapter);
            let format = caps.formats.iter().copied()
                .find(|f| f.is_srgb()).unwrap_or(caps.formats[0]);
            let config = wgpu::SurfaceConfiguration {
                usage: wgpu::TextureUsages::RENDER_ATTACHMENT,
                format,
                width: size.width.max(1),
                height: size.height.max(1),
                present_mode: wgpu::PresentMode::Fifo,
                desired_maximum_frame_latency: 2,
                alpha_mode: caps.alpha_modes[0],
                view_formats: vec![],
            };
            surface.configure(&device, &config);

            let egui_state = egui_winit::State::new(
                self.egui_ctx.clone(),
                egui::ViewportId::ROOT,
                &*win,
                Some(win.scale_factor() as f32),
                None,
                None,
            );
            let egui_renderer = egui_wgpu::Renderer::new(&device, format, None, 1, false);

            let scene = SceneRenderer::new(&device, format, &self.instances);

            self.window = Some(win);
            self.surface = Some(surface);
            self.device = Some(device);
            self.queue = Some(queue);
            self.config = Some(config);
            self.egui_state = Some(egui_state);
            self.egui_renderer = Some(egui_renderer);
            self.scene = Some(scene);
        });
    }

    fn window_event(&mut self, event_loop: &ActiveEventLoop, _id: winit::window::WindowId, event: WindowEvent) {
        if let (Some(state), Some(win)) = (self.egui_state.as_mut(), self.window.as_ref()) {
            let _ = state.on_window_event(win, &event);
        }
        match event {
            WindowEvent::CloseRequested => event_loop.exit(),
            WindowEvent::Resized(size) => {
                if let (Some(s), Some(c), Some(d)) = (
                    self.surface.as_ref(), self.config.as_mut(), self.device.as_ref()
                ) {
                    c.width = size.width.max(1);
                    c.height = size.height.max(1);
                    s.configure(d, c);
                }
            }
            WindowEvent::KeyboardInput { event: KeyEvent {
                physical_key: PhysicalKey::Code(KeyCode::Escape), ..
            }, .. } => event_loop.exit(),
            WindowEvent::RedrawRequested => {
                self.render();
                if let Some(w) = self.window.as_ref() { w.request_redraw(); }
            }
            _ => {}
        }
    }
}

impl App {
    fn render(&mut self) {
        let (Some(surface), Some(device), Some(queue), Some(config),
             Some(egui_state), Some(egui_renderer), Some(scene), Some(win)) = (
            self.surface.as_ref(), self.device.as_ref(), self.queue.as_ref(),
            self.config.as_ref(), self.egui_state.as_mut(),
            self.egui_renderer.as_mut(), self.scene.as_ref(), self.window.as_ref(),
        ) else { return; };

        let now = Instant::now();
        let dt = now.duration_since(self.last_frame).as_secs_f32();
        self.last_frame = now;
        if dt > 0.0 {
            self.fps_samples.push(1.0 / dt);
            if self.fps_samples.len() > 60 { self.fps_samples.remove(0); }
            self.mean_fps = self.fps_samples.iter().sum::<f32>() / self.fps_samples.len() as f32;
        }

        // Update scene camera to fit all shapes
        let cols = (SHAPE_COUNT as f32).sqrt().ceil();
        let extent = cols * 3.0;
        let s = (2.0 / extent) * self.zoom;
        let view_proj = [
            [s, 0.0, 0.0, 0.0],
            [0.0, s, 0.0, 0.0],
            [0.0, 0.0, 1.0, 0.0],
            [0.0, 0.0, 0.0, 1.0],
        ];
        scene.update_camera(queue, view_proj);

        let raw_input = egui_state.take_egui_input(win);
        let mean_fps = self.mean_fps;
        let shape_count = self.instances.len();
        let sel_tool_ref = &mut self.selected_tool;
        let zoom_ref = &mut self.zoom;

        let full_output = self.egui_ctx.run(raw_input, |ctx| {
            egui::TopBottomPanel::top("ribbon").show(ctx, |ui| {
                ui.horizontal(|ui| {
                    for t in ["select", "line", "rect", "circle", "hatch"] {
                        if ui.selectable_label(*sel_tool_ref == t, t).clicked() {
                            *sel_tool_ref = t.into();
                        }
                    }
                });
            });
            egui::SidePanel::right("props").show(ctx, |ui| {
                ui.heading("Properties");
                ui.label(format!("Tool: {}", sel_tool_ref));
                ui.label(format!("Shapes: {}", shape_count));
                ui.separator();
                ui.heading("Camera");
                ui.add(egui::Slider::new(zoom_ref, 0.2..=5.0).text("Zoom"));
                ui.separator();
                ui.heading("Performance");
                ui.label(format!("FPS: {:.1}", mean_fps));
                ui.label(format!("Frame: {:.2} ms",
                    if mean_fps > 0.0 { 1000.0 / mean_fps } else { 0.0 }));
            });
            egui::TopBottomPanel::bottom("status").show(ctx, |ui| {
                ui.horizontal(|ui| {
                    ui.label(format!("ready · tool={} · {} shapes · {:.1} FPS",
                        sel_tool_ref, shape_count, mean_fps));
                });
            });
            // Central area is left empty — the wgpu canvas draws behind
        });

        egui_state.handle_platform_output(win, full_output.platform_output.clone());
        let paint_jobs = self.egui_ctx.tessellate(full_output.shapes, full_output.pixels_per_point);
        let screen = ScreenDescriptor {
            size_in_pixels: [config.width, config.height],
            pixels_per_point: full_output.pixels_per_point,
        };
        for (id, delta) in &full_output.textures_delta.set {
            egui_renderer.update_texture(device, queue, *id, delta);
        }

        let frame = match surface.get_current_texture() {
            Ok(f) => f, Err(_) => return,
        };
        let view = frame.texture.create_view(&Default::default());
        let mut enc = device.create_command_encoder(&Default::default());

        // Pass 1: scene (instanced shapes)
        {
            let mut pass = enc.begin_render_pass(&wgpu::RenderPassDescriptor {
                label: Some("scene"),
                color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                    view: &view,
                    resolve_target: None,
                    ops: wgpu::Operations {
                        load: wgpu::LoadOp::Clear(wgpu::Color { r: 0.04, g: 0.05, b: 0.08, a: 1.0 }),
                        store: wgpu::StoreOp::Store,
                    },
                })],
                depth_stencil_attachment: None,
                timestamp_writes: None,
                occlusion_query_set: None,
            });
            scene.render(&mut pass);
        }

        // Pass 2: egui UI overlay
        egui_renderer.update_buffers(device, queue, &mut enc, &paint_jobs, &screen);
        {
            let pass = enc.begin_render_pass(&wgpu::RenderPassDescriptor {
                label: Some("egui"),
                color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                    view: &view,
                    resolve_target: None,
                    ops: wgpu::Operations {
                        load: wgpu::LoadOp::Load, // preserve scene
                        store: wgpu::StoreOp::Store,
                    },
                })],
                depth_stencil_attachment: None,
                timestamp_writes: None,
                occlusion_query_set: None,
            });
            let mut pass_static = pass.forget_lifetime();
            egui_renderer.render(&mut pass_static, &paint_jobs, &screen);
        }
        for id in &full_output.textures_delta.free {
            egui_renderer.free_texture(id);
        }
        queue.submit(std::iter::once(enc.finish()));
        frame.present();
    }
}

fn main() -> anyhow::Result<()> {
    if std::env::args().nth(1).as_deref() == Some("--headless") {
        let mut world = World::new();
        seed_ecs(&mut world, SHAPE_COUNT);
        let mut instances = Vec::new();
        collect_instances(&mut world, &mut instances);
        println!("ECS spawned {} shapes, collected {} instances", SHAPE_COUNT, instances.len());
        return Ok(());
    }
    let event_loop = EventLoop::new()?;
    let mut app = App::new();
    event_loop.run_app(&mut app)?;
    Ok(())
}
