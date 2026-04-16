//! Main App struct — winit ApplicationHandler with ECS + wgpu + egui.

use crate::gpu::GpuContext;
use crate::sync;
use bevy_ecs::prelude::*;
use egui_wgpu::ScreenDescriptor;
use kernel_render::{CameraUniform, Instance, ShapePipeline};
use std::sync::Arc;
use std::time::Instant;
use winit::application::ApplicationHandler;
use winit::event::{KeyEvent, WindowEvent};
use winit::event_loop::ActiveEventLoop;
use winit::keyboard::{KeyCode, PhysicalKey};
use winit::window::Window;

/// Shape count for demo mode. Tuned to match spike benchmark.
pub const DEMO_SHAPE_COUNT: usize = 100_000;

pub struct App {
    pub window: Option<Arc<Window>>,
    pub gpu: Option<GpuContext>,
    pub pipeline: Option<ShapePipeline>,

    pub world: World,
    pub instances: Vec<Instance>,

    /// UI state
    pub ui_tool: String,
    pub ui_zoom: f32,

    /// Performance tracking
    pub last_frame: Instant,
    pub fps_samples: Vec<f32>,
    pub mean_fps: f32,
}

impl App {
    pub fn new() -> Self {
        let mut world = crate::create_world();
        sync::seed_demo_shapes(&mut world, DEMO_SHAPE_COUNT);
        let mut instances = Vec::with_capacity(DEMO_SHAPE_COUNT);
        sync::collect_instances(&mut world, &mut instances);

        Self {
            window: None, gpu: None, pipeline: None,
            world, instances,
            ui_tool: "select".into(),
            ui_zoom: 1.0,
            last_frame: Instant::now(),
            fps_samples: Vec::with_capacity(120),
            mean_fps: 0.0,
        }
    }

    fn render_frame(&mut self) {
        let Some(gpu) = self.gpu.as_mut() else { return; };
        let Some(pipeline) = self.pipeline.as_ref() else { return; };
        let Some(win) = self.window.as_ref() else { return; };

        // FPS tracking
        let now = Instant::now();
        let dt = now.duration_since(self.last_frame).as_secs_f32();
        self.last_frame = now;
        if dt > 0.0 {
            self.fps_samples.push(1.0 / dt);
            if self.fps_samples.len() > 60 { self.fps_samples.remove(0); }
            self.mean_fps = self.fps_samples.iter().sum::<f32>() / self.fps_samples.len() as f32;
        }

        // Camera matrix sized to fit the whole demo scene
        let cols = (DEMO_SHAPE_COUNT as f32).sqrt().ceil();
        let extent = cols * 3.0;
        let mut zoom = (2.0 / extent) * self.ui_zoom;
        if !zoom.is_finite() || zoom <= 0.0 { zoom = 1.0; }
        let camera = CameraUniform::ortho([0.0, 0.0], zoom, gpu.aspect_ratio());
        pipeline.update_camera(&gpu.queue, camera);

        // UI pass: egui
        let raw_input = gpu.egui_state.take_egui_input(win);
        let mean_fps = self.mean_fps;
        let shape_count = self.instances.len();
        let ui_tool = &mut self.ui_tool;
        let ui_zoom = &mut self.ui_zoom;
        let full_output = gpu.egui_ctx.run(raw_input, |ctx| {
            egui::TopBottomPanel::top("ribbon").show(ctx, |ui| {
                ui.horizontal(|ui| {
                    ui.label(egui::RichText::new("Open 2D Studio — Kernel Demo")
                        .strong());
                    ui.separator();
                    for t in ["select", "line", "rect", "circle", "hatch"] {
                        if ui.selectable_label(*ui_tool == t, t).clicked() {
                            *ui_tool = t.into();
                        }
                    }
                });
            });
            egui::SidePanel::right("props").resizable(true).show(ctx, |ui| {
                ui.heading("Properties");
                ui.label(format!("Tool: {}", ui_tool));
                ui.label(format!("Shapes: {}", shape_count));
                ui.separator();
                ui.heading("Camera");
                ui.add(egui::Slider::new(ui_zoom, 0.1..=10.0).text("Zoom"));
                ui.separator();
                ui.heading("Performance");
                ui.colored_label(
                    if mean_fps >= 120.0 { egui::Color32::GREEN }
                    else if mean_fps >= 60.0 { egui::Color32::YELLOW }
                    else { egui::Color32::LIGHT_RED },
                    format!("FPS: {:.1}", mean_fps)
                );
                ui.label(format!("Frame: {:.2} ms",
                    if mean_fps > 0.0 { 1000.0 / mean_fps } else { 0.0 }));
            });
            egui::TopBottomPanel::bottom("status").show(ctx, |ui| {
                ui.horizontal(|ui| {
                    ui.label(format!("tool={} · {} shapes · {:.1} FPS",
                        ui_tool, shape_count, mean_fps));
                });
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

        // Acquire frame
        let frame = match gpu.surface.get_current_texture() {
            Ok(f) => f, Err(_) => return,
        };
        let view = frame.texture.create_view(&Default::default());
        let mut enc = gpu.device.create_command_encoder(&Default::default());

        // Pass 1: scene
        {
            let mut pass = enc.begin_render_pass(&wgpu::RenderPassDescriptor {
                label: Some("kernel-app:scene"),
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
            pipeline.draw(&mut pass, self.instances.len() as u32);
        }

        // Pass 2: egui UI
        gpu.egui_renderer.update_buffers(&gpu.device, &gpu.queue, &mut enc, &paint_jobs, &screen);
        {
            let pass = enc.begin_render_pass(&wgpu::RenderPassDescriptor {
                label: Some("kernel-app:egui"),
                color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                    view: &view,
                    resolve_target: None,
                    ops: wgpu::Operations {
                        load: wgpu::LoadOp::Load,
                        store: wgpu::StoreOp::Store,
                    },
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
                .with_title("Open 2D Studio — Kernel")
                .with_inner_size(winit::dpi::LogicalSize::new(1600, 1000)),
        ).unwrap());

        let gpu = pollster::block_on(GpuContext::new(win.clone())).unwrap();
        let pipeline = ShapePipeline::new(
            &gpu.device,
            gpu.format,
            DEMO_SHAPE_COUNT as u32,
        ).unwrap();

        // Initial instance upload
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
                    gpu.resize(size.width, size.height);
                }
            }
            WindowEvent::KeyboardInput { event: KeyEvent {
                physical_key: PhysicalKey::Code(KeyCode::Escape), ..
            }, .. } => event_loop.exit(),
            WindowEvent::RedrawRequested => {
                // Sync ECS → instance buffer each frame. For demo this is cheap
                // because the demo scene is static. In production we'd sync only
                // Dirty-marked entities.
                crate::sync::collect_instances(&mut self.world, &mut self.instances);
                if let (Some(gpu), Some(pipeline)) = (self.gpu.as_ref(), self.pipeline.as_ref()) {
                    pipeline.upload_instances(&gpu.queue, &self.instances);
                }
                self.render_frame();
                if let Some(w) = self.window.as_ref() { w.request_redraw(); }
            }
            _ => {}
        }
    }
}
