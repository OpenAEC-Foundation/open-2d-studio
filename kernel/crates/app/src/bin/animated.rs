//! Animated demo — rotating grid + mouse pan + scroll zoom.
//! Separate binary; leaves kernel-app's main.rs/app.rs untouched.

use bytemuck::{Pod, Zeroable};
use egui_wgpu::ScreenDescriptor;
use kernel_render::{CameraUniform, Instance, ShapePipeline};
use std::sync::Arc;
use std::time::Instant;
use wgpu::util::DeviceExt;
use winit::application::ApplicationHandler;
use winit::event::{ElementState, KeyEvent, MouseButton, MouseScrollDelta, WindowEvent};
use winit::event_loop::{ActiveEventLoop, EventLoop};
use winit::keyboard::{KeyCode, PhysicalKey};
use winit::window::Window;

const SHAPE_COUNT: usize = 100_000;

fn seed_scene() -> Vec<Instance> {
    let mut out = Vec::with_capacity(SHAPE_COUNT);
    let cols = (SHAPE_COUNT as f32).sqrt().ceil() as usize;
    let mut lcg: u32 = 0xC0FFEE42;
    for i in 0..SHAPE_COUNT {
        let col = (i % cols) as f32;
        let row = (i / cols) as f32;
        lcg = lcg.wrapping_mul(1664525).wrapping_add(1013904223);
        // Rainbow gradient based on angle from center
        let cx = col - cols as f32 / 2.0;
        let cy = row - cols as f32 / 2.0;
        let angle = cy.atan2(cx);
        let hue = ((angle / std::f32::consts::PI + 1.0) * 127.5) as u32;
        let color = 0xFF_00_00_00 | (hue << 16) | ((255 - hue as u32) << 8) | 0xFF;
        // Scale varies by distance from center — creates a ripple
        let dist = (cx * cx + cy * cy).sqrt();
        let scale = 1.5 + (dist * 0.05).sin() * 0.8;
        out.push(Instance {
            pos: [cx * 3.0, cy * 3.0],
            rotation: (lcg & 0xFF) as f32 / 40.0,
            scale: [scale, scale],
            color,
            style_idx: 0,
            flags: 1,
        });
    }
    out
}

struct GpuCtx {
    surface: wgpu::Surface<'static>,
    device: wgpu::Device,
    queue: wgpu::Queue,
    config: wgpu::SurfaceConfiguration,
    format: wgpu::TextureFormat,
    egui_ctx: egui::Context,
    egui_state: egui_winit::State,
    egui_renderer: egui_wgpu::Renderer,
}

impl GpuCtx {
    async fn new(window: Arc<Window>) -> anyhow::Result<Self> {
        let size = window.inner_size();
        let instance = wgpu::Instance::new(wgpu::InstanceDescriptor {
            backends: wgpu::Backends::PRIMARY,
            ..Default::default()
        });
        let surface = instance.create_surface(window.clone())?;
        let adapter = instance.request_adapter(&wgpu::RequestAdapterOptions {
            power_preference: wgpu::PowerPreference::HighPerformance,
            compatible_surface: Some(&surface),
            force_fallback_adapter: false,
        }).await.ok_or_else(|| anyhow::anyhow!("no adapter"))?;
        eprintln!("[GPU] {:?}", adapter.get_info().name);

        let (device, queue) = adapter.request_device(&wgpu::DeviceDescriptor {
            label: Some("animated"),
            required_features: wgpu::Features::empty(),
            required_limits: wgpu::Limits::default(),
            memory_hints: wgpu::MemoryHints::Performance,
        }, None).await?;

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

        let egui_ctx = egui::Context::default();
        let egui_state = egui_winit::State::new(
            egui_ctx.clone(),
            egui::ViewportId::ROOT,
            &*window,
            Some(window.scale_factor() as f32),
            None,
            None,
        );
        let egui_renderer = egui_wgpu::Renderer::new(&device, format, None, 1, false);

        Ok(Self { surface, device, queue, config, format, egui_ctx, egui_state, egui_renderer })
    }
}

struct App {
    window: Option<Arc<Window>>,
    gpu: Option<GpuCtx>,
    pipeline: Option<ShapePipeline>,
    instances: Vec<Instance>,

    // Camera state
    pan_x: f32,
    pan_y: f32,
    zoom: f32,

    // Animation state
    time: f32,
    animate: bool,

    // Mouse state
    mouse_pos: (f32, f32),
    dragging: bool,
    drag_start: (f32, f32),
    drag_start_pan: (f32, f32),

    // FPS
    last_frame: Instant,
    fps_samples: Vec<f32>,
    mean_fps: f32,

    // UI
    shape_mode: ShapeMode,
}

#[derive(Clone, Copy, PartialEq)]
enum ShapeMode { Ripple, Rotate, Both, Static }

impl App {
    fn new() -> Self {
        Self {
            window: None, gpu: None, pipeline: None,
            instances: seed_scene(),
            pan_x: 0.0, pan_y: 0.0, zoom: 1.0,
            time: 0.0, animate: true,
            mouse_pos: (0.0, 0.0),
            dragging: false,
            drag_start: (0.0, 0.0), drag_start_pan: (0.0, 0.0),
            last_frame: Instant::now(),
            fps_samples: Vec::with_capacity(120),
            mean_fps: 0.0,
            shape_mode: ShapeMode::Both,
        }
    }

    fn animate_step(&mut self, dt: f32) {
        self.time += dt;
        if !self.animate { return; }
        let t = self.time;
        let cols = (SHAPE_COUNT as f32).sqrt().ceil();
        for (i, inst) in self.instances.iter_mut().enumerate() {
            let col = (i as f32) % cols;
            let row = ((i as f32) / cols).floor();
            let cx = col - cols / 2.0;
            let cy = row - cols / 2.0;
            let dist = (cx * cx + cy * cy).sqrt();
            match self.shape_mode {
                ShapeMode::Ripple => {
                    let s = 1.5 + ((dist * 0.05 - t * 2.0).sin()) * 0.8;
                    inst.scale = [s, s];
                }
                ShapeMode::Rotate => {
                    inst.rotation += dt * (1.0 + dist * 0.002);
                }
                ShapeMode::Both => {
                    let s = 1.5 + ((dist * 0.05 - t * 2.0).sin()) * 0.8;
                    inst.scale = [s, s];
                    inst.rotation += dt * (1.0 + dist * 0.002);
                }
                ShapeMode::Static => {}
            }
        }
    }

    fn render(&mut self) {
        // Capture timing + animate BEFORE borrowing gpu/pipeline/window
        let now = Instant::now();
        let dt = now.duration_since(self.last_frame).as_secs_f32().min(0.1);
        self.last_frame = now;
        if dt > 0.0 {
            self.fps_samples.push(1.0 / dt);
            if self.fps_samples.len() > 60 { self.fps_samples.remove(0); }
            self.mean_fps = self.fps_samples.iter().sum::<f32>() / self.fps_samples.len() as f32;
        }
        self.animate_step(dt);

        let Some(gpu) = self.gpu.as_mut() else { return; };
        let Some(pipeline) = self.pipeline.as_ref() else { return; };
        let Some(win) = self.window.as_ref() else { return; };

        pipeline.upload_instances(&gpu.queue, &self.instances);

        // Camera
        let cols = (SHAPE_COUNT as f32).sqrt().ceil();
        let extent = cols * 3.0;
        let base_zoom = (2.0 / extent) * self.zoom;
        let camera = CameraUniform::ortho(
            [self.pan_x, self.pan_y],
            base_zoom,
            gpu.config.width as f32 / gpu.config.height.max(1) as f32,
        );
        pipeline.update_camera(&gpu.queue, camera);

        // egui UI
        let raw_input = gpu.egui_state.take_egui_input(win);
        let fps = self.mean_fps;
        let mode_ref = &mut self.shape_mode;
        let animate_ref = &mut self.animate;
        let zoom_ref = &mut self.zoom;
        let full_output = gpu.egui_ctx.run(raw_input, |ctx| {
            egui::SidePanel::right("ctrl").resizable(true).show(ctx, |ui| {
                ui.heading("Animated Demo");
                ui.separator();
                ui.checkbox(animate_ref, "Animate");
                ui.horizontal(|ui| {
                    ui.selectable_value(mode_ref, ShapeMode::Both, "Both");
                    ui.selectable_value(mode_ref, ShapeMode::Ripple, "Ripple");
                    ui.selectable_value(mode_ref, ShapeMode::Rotate, "Rotate");
                    ui.selectable_value(mode_ref, ShapeMode::Static, "Static");
                });
                ui.separator();
                ui.heading("Camera");
                ui.add(egui::Slider::new(zoom_ref, 0.1..=10.0).text("Zoom"));
                ui.label("Drag = pan · Scroll = zoom");
                ui.separator();
                ui.heading("Performance");
                ui.colored_label(
                    if fps >= 120.0 { egui::Color32::GREEN }
                    else if fps >= 60.0 { egui::Color32::YELLOW }
                    else { egui::Color32::LIGHT_RED },
                    format!("FPS: {:.1}", fps)
                );
                ui.label(format!("Frame: {:.2} ms",
                    if fps > 0.0 { 1000.0 / fps } else { 0.0 }));
                ui.label(format!("Shapes: {}", SHAPE_COUNT));
                ui.separator();
                ui.label("ESC = exit");
            });
        });
        gpu.egui_state.handle_platform_output(win, full_output.platform_output.clone());
        let paint_jobs = gpu.egui_ctx.tessellate(full_output.shapes, full_output.pixels_per_point);
        let screen = ScreenDescriptor {
            size_in_pixels: [gpu.config.width, gpu.config.height],
            pixels_per_point: full_output.pixels_per_point,
        };
        for (id, delta) in &full_output.textures_delta.set {
            gpu.egui_renderer.update_texture(&gpu.device, &gpu.queue, *id, delta);
        }
        let frame = match gpu.surface.get_current_texture() {
            Ok(f) => f, Err(_) => return,
        };
        let view = frame.texture.create_view(&Default::default());
        let mut enc = gpu.device.create_command_encoder(&Default::default());
        {
            let mut pass = enc.begin_render_pass(&wgpu::RenderPassDescriptor {
                label: Some("scene"),
                color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                    view: &view, resolve_target: None,
                    ops: wgpu::Operations {
                        load: wgpu::LoadOp::Clear(wgpu::Color { r: 0.04, g: 0.05, b: 0.08, a: 1.0 }),
                        store: wgpu::StoreOp::Store,
                    },
                })],
                depth_stencil_attachment: None,
                timestamp_writes: None,
                occlusion_query_set: None,
            });
            pipeline.draw(&mut pass, self.instances.len() as u32);
        }
        gpu.egui_renderer.update_buffers(&gpu.device, &gpu.queue, &mut enc, &paint_jobs, &screen);
        {
            let pass = enc.begin_render_pass(&wgpu::RenderPassDescriptor {
                label: Some("egui"),
                color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                    view: &view, resolve_target: None,
                    ops: wgpu::Operations { load: wgpu::LoadOp::Load, store: wgpu::StoreOp::Store },
                })],
                depth_stencil_attachment: None,
                timestamp_writes: None,
                occlusion_query_set: None,
            });
            let mut pass_static = pass.forget_lifetime();
            gpu.egui_renderer.render(&mut pass_static, &paint_jobs, &screen);
        }
        for id in &full_output.textures_delta.free {
            gpu.egui_renderer.free_texture(id);
        }
        gpu.queue.submit(std::iter::once(enc.finish()));
        frame.present();
    }
}

impl ApplicationHandler for App {
    fn resumed(&mut self, event_loop: &ActiveEventLoop) {
        let win = Arc::new(event_loop.create_window(
            Window::default_attributes()
                .with_title("kernel-animated — 100k shapes, rotating + rippling")
                .with_inner_size(winit::dpi::LogicalSize::new(1600, 1000)),
        ).unwrap());
        let gpu = pollster::block_on(GpuCtx::new(win.clone())).unwrap();
        let pipeline = ShapePipeline::new(&gpu.device, gpu.format, SHAPE_COUNT as u32).unwrap();
        pipeline.upload_instances(&gpu.queue, &self.instances);
        self.window = Some(win);
        self.gpu = Some(gpu);
        self.pipeline = Some(pipeline);
    }

    fn window_event(&mut self, event_loop: &ActiveEventLoop, _id: winit::window::WindowId, event: WindowEvent) {
        if let (Some(gpu), Some(win)) = (self.gpu.as_mut(), self.window.as_ref()) {
            let _ = gpu.egui_state.on_window_event(win, &event);
        }
        match event {
            WindowEvent::CloseRequested => event_loop.exit(),
            WindowEvent::Resized(size) => {
                if let Some(gpu) = self.gpu.as_mut() {
                    if size.width > 0 && size.height > 0 {
                        gpu.config.width = size.width;
                        gpu.config.height = size.height;
                        gpu.surface.configure(&gpu.device, &gpu.config);
                    }
                }
            }
            WindowEvent::KeyboardInput { event: KeyEvent {
                physical_key: PhysicalKey::Code(KeyCode::Escape),
                state: ElementState::Pressed, ..
            }, .. } => event_loop.exit(),
            WindowEvent::CursorMoved { position, .. } => {
                self.mouse_pos = (position.x as f32, position.y as f32);
                if self.dragging {
                    let dx = self.mouse_pos.0 - self.drag_start.0;
                    let dy = self.mouse_pos.1 - self.drag_start.1;
                    // 1:1 tracking: the world point under cursor at press must stay
                    // under the cursor while dragging. Derivation:
                    //   base_zoom = (2/extent) * ui_zoom
                    //   visible world height = 2 / base_zoom = extent / ui_zoom
                    //   world_per_pixel = visible_world_height / screen_height_px
                    //                   = extent / (ui_zoom * screen_height_px)
                    // For aspect-correct ortho this is identical in X and Y.
                    let screen_h = self.gpu.as_ref()
                        .map(|g| g.config.height.max(1) as f32)
                        .unwrap_or(1000.0);
                    let cols = (SHAPE_COUNT as f32).sqrt().ceil();
                    let extent = cols * 3.0;
                    let world_per_pixel = extent / (self.zoom * screen_h);
                    self.pan_x = self.drag_start_pan.0 - dx * world_per_pixel;
                    self.pan_y = self.drag_start_pan.1 + dy * world_per_pixel;
                }
            }
            WindowEvent::MouseInput { state, button: MouseButton::Middle, .. } => {
                // CAD convention: middle mouse button (scroll wheel click) = pan
                let pointer_over_ui = self.gpu.as_ref()
                    .map(|g| g.egui_ctx.is_pointer_over_area())
                    .unwrap_or(false);
                if !pointer_over_ui {
                    match state {
                        ElementState::Pressed => {
                            self.dragging = true;
                            self.drag_start = self.mouse_pos;
                            self.drag_start_pan = (self.pan_x, self.pan_y);
                        }
                        ElementState::Released => self.dragging = false,
                    }
                }
            }
            WindowEvent::MouseWheel { delta, .. } => {
                let scroll = match delta {
                    MouseScrollDelta::LineDelta(_, y) => y,
                    MouseScrollDelta::PixelDelta(p) => p.y as f32 / 100.0,
                };
                let factor = (1.0 + scroll * 0.1).clamp(0.5, 2.0);
                self.zoom = (self.zoom * factor).clamp(0.1, 20.0);
            }
            WindowEvent::RedrawRequested => {
                self.render();
                if let Some(w) = self.window.as_ref() { w.request_redraw(); }
            }
            _ => {}
        }
    }
}

fn main() -> anyhow::Result<()> {
    let event_loop = EventLoop::new()?;
    let mut app = App::new();
    event_loop.run_app(&mut app)?;
    Ok(())
}
