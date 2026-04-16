//! Full interactive egui + egui_dock + wgpu integration test.
//! Opens a window with a ribbon bar at top, dockable panels (Properties,
//! Layers, Navigation, Canvas) and tests action callbacks + keyboard.

use egui_wgpu::ScreenDescriptor;
use std::sync::Arc;
use winit::application::ApplicationHandler;
use winit::event::{KeyEvent, WindowEvent};
use winit::event_loop::{ActiveEventLoop, EventLoop};
use winit::keyboard::{KeyCode, PhysicalKey};
use winit::window::Window;

// ── Panel kinds ──────────────────────────────────────────────────────────

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Panel { Canvas, Properties, Layers, Navigation }

// ── App state ────────────────────────────────────────────────────────────

struct AppState {
    active_tab: usize,
    last_action: String,
    layer_visible: Vec<bool>,
    dark_mode: bool,
    selected_shape: Option<String>,
    stroke_color: [f32; 4],
}

impl AppState {
    fn new() -> Self {
        Self {
            active_tab: 0,
            last_action: "(none)".into(),
            layer_visible: vec![true, true, false, true],
            dark_mode: true,
            selected_shape: Some("Line #42".into()),
            stroke_color: [0.4, 0.6, 0.9, 1.0],
        }
    }
}

// ── Ribbon rendering ─────────────────────────────────────────────────────

fn show_ribbon(ctx: &egui::Context, state: &mut AppState) {
    egui::TopBottomPanel::top("ribbon").show(ctx, |ui| {
        ui.horizontal(|ui| {
            let tabs = ["Home", "Draw", "View"];
            for (i, name) in tabs.iter().enumerate() {
                if ui.selectable_label(state.active_tab == i, *name).clicked() {
                    state.active_tab = i;
                }
            }
        });
        ui.separator();
        ui.horizontal_wrapped(|ui| match state.active_tab {
            0 => {
                if ui.button("📄 New").clicked() { state.last_action = "New".into(); }
                if ui.button("📂 Open").clicked() { state.last_action = "Open".into(); }
                if ui.button("💾 Save").clicked() { state.last_action = "Save".into(); }
                ui.separator();
                if ui.button("↶ Undo").clicked() { state.last_action = "Undo".into(); }
                if ui.button("↷ Redo").clicked() { state.last_action = "Redo".into(); }
            }
            1 => {
                if ui.button("Line").clicked() { state.last_action = "Tool:Line".into(); }
                if ui.button("Rect").clicked() { state.last_action = "Tool:Rect".into(); }
                if ui.button("Circle").clicked() { state.last_action = "Tool:Circle".into(); }
                if ui.button("Polyline").clicked() { state.last_action = "Tool:Polyline".into(); }
                ui.separator();
                if ui.button("Hatch").clicked() { state.last_action = "Tool:Hatch".into(); }
                if ui.button("Text").clicked() { state.last_action = "Tool:Text".into(); }
            }
            2 => {
                if ui.button("🔍+ Zoom In").clicked() { state.last_action = "ZoomIn".into(); }
                if ui.button("🔍− Zoom Out").clicked() { state.last_action = "ZoomOut".into(); }
                if ui.button("⤢ Fit").clicked() { state.last_action = "ZoomFit".into(); }
                ui.separator();
                if ui.checkbox(&mut state.dark_mode, "Dark mode").changed() {
                    state.last_action = format!("DarkMode={}", state.dark_mode);
                }
            }
            _ => {}
        });
    });
}

// ── Dock area with panels ────────────────────────────────────────────────

struct MyTabs<'a> { state: &'a mut AppState }

impl<'a> egui_dock::TabViewer for MyTabs<'a> {
    type Tab = Panel;

    fn title(&mut self, tab: &mut Self::Tab) -> egui::WidgetText {
        match tab {
            Panel::Canvas => "Canvas".into(),
            Panel::Properties => "Properties".into(),
            Panel::Layers => "Layers".into(),
            Panel::Navigation => "Navigation".into(),
        }
    }

    fn ui(&mut self, ui: &mut egui::Ui, tab: &mut Self::Tab) {
        match tab {
            Panel::Canvas => {
                ui.heading("Canvas area");
                ui.label("(In real app: wgpu custom paint callback renders here)");
                let painter = ui.painter();
                let rect = ui.available_rect_before_wrap();
                painter.rect_filled(rect, 0.0, egui::Color32::from_rgb(30, 33, 42));
                painter.circle_filled(
                    rect.center(),
                    40.0,
                    egui::Color32::from_rgba_unmultiplied(100, 180, 220, 160),
                );
                painter.text(
                    rect.center(),
                    egui::Align2::CENTER_CENTER,
                    format!("shape: {:?}", self.state.selected_shape),
                    egui::FontId::proportional(14.0),
                    egui::Color32::WHITE,
                );
            }
            Panel::Properties => {
                ui.heading("Properties");
                match &self.state.selected_shape {
                    Some(s) => ui.label(format!("Selected: {}", s)),
                    None => ui.label("(no selection)"),
                };
                ui.separator();
                ui.horizontal(|ui| {
                    ui.label("Stroke:");
                    ui.color_edit_button_rgba_unmultiplied(&mut self.state.stroke_color);
                });
            }
            Panel::Layers => {
                ui.heading("Layers");
                for (i, visible) in self.state.layer_visible.iter_mut().enumerate() {
                    ui.checkbox(visible, format!("Layer {}", i));
                }
                if ui.button("+ Add layer").clicked() {
                    self.state.layer_visible.push(true);
                    self.state.last_action = "AddLayer".into();
                }
            }
            Panel::Navigation => {
                ui.heading("Navigation");
                ui.collapsing("Drawing 1", |ui| {
                    ui.label("└ Sheet A1");
                    ui.label("└ Sheet A2");
                });
                ui.collapsing("Drawing 2", |ui| {
                    ui.label("└ Sheet B1");
                });
            }
        }
    }
}

fn initial_dock_state() -> egui_dock::DockState<Panel> {
    use egui_dock::{DockState, NodeIndex};
    let mut state = DockState::new(vec![Panel::Canvas]);
    let surface = state.main_surface_mut();
    let [main, _right] = surface.split_right(NodeIndex::root(), 0.78, vec![Panel::Properties]);
    let [_m2, _bottom] = surface.split_below(main, 0.85, vec![Panel::Layers]);
    let [_m3, _left] = surface.split_left(main, 0.15, vec![Panel::Navigation]);
    state
}

// ── wgpu + egui renderer ─────────────────────────────────────────────────

struct EguiWgpu {
    surface: wgpu::Surface<'static>,
    device: wgpu::Device,
    queue: wgpu::Queue,
    config: wgpu::SurfaceConfiguration,
    egui_ctx: egui::Context,
    egui_state: egui_winit::State,
    egui_renderer: egui_wgpu::Renderer,
}

impl EguiWgpu {
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

        let (device, queue) = adapter.request_device(&wgpu::DeviceDescriptor {
            label: Some("egui-device"),
            required_features: wgpu::Features::empty(),
            required_limits: wgpu::Limits::default(),
            memory_hints: wgpu::MemoryHints::Performance, // required in wgpu 22
        }, None).await?;

        let caps = surface.get_capabilities(&adapter);
        let format = caps.formats.iter().copied()
            .find(|f| f.is_srgb())
            .unwrap_or(caps.formats[0]);
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

        Ok(Self { surface, device, queue, config, egui_ctx, egui_state, egui_renderer })
    }

    fn handle_event(&mut self, window: &Window, event: &winit::event::WindowEvent) -> bool {
        self.egui_state.on_window_event(window, event).consumed
    }

    fn resize(&mut self, w: u32, h: u32) {
        if w == 0 || h == 0 { return; }
        self.config.width = w;
        self.config.height = h;
        self.surface.configure(&self.device, &self.config);
    }

    fn render(&mut self, window: &Window, mut ui: impl FnMut(&egui::Context)) {
        let raw_input = self.egui_state.take_egui_input(window);
        let full_output = self.egui_ctx.run(raw_input, |ctx| ui(ctx));
        self.egui_state.handle_platform_output(window, full_output.platform_output.clone());
        let paint_jobs = self.egui_ctx.tessellate(full_output.shapes, full_output.pixels_per_point);
        let screen = ScreenDescriptor {
            size_in_pixels: [self.config.width, self.config.height],
            pixels_per_point: full_output.pixels_per_point,
        };
        for (id, delta) in &full_output.textures_delta.set {
            self.egui_renderer.update_texture(&self.device, &self.queue, *id, delta);
        }
        let frame = match self.surface.get_current_texture() {
            Ok(f) => f,
            Err(_) => return,
        };
        let view = frame.texture.create_view(&Default::default());
        let mut enc = self.device.create_command_encoder(&Default::default());
        self.egui_renderer.update_buffers(&self.device, &self.queue, &mut enc, &paint_jobs, &screen);
        {
            // wgpu 22: render() requires a 'static RenderPass. forget_lifetime()
            // is the sanctioned API for this.
            let pass = enc.begin_render_pass(&wgpu::RenderPassDescriptor {
                label: Some("egui-pass"),
                color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                    view: &view,
                    resolve_target: None,
                    ops: wgpu::Operations {
                        load: wgpu::LoadOp::Clear(wgpu::Color { r: 0.08, g: 0.08, b: 0.1, a: 1.0 }),
                        store: wgpu::StoreOp::Store,
                    },
                })],
                depth_stencil_attachment: None,
                timestamp_writes: None,
                occlusion_query_set: None,
            });
            let mut pass_static = pass.forget_lifetime();
            self.egui_renderer.render(&mut pass_static, &paint_jobs, &screen);
        }
        for id in &full_output.textures_delta.free {
            self.egui_renderer.free_texture(id);
        }
        self.queue.submit(std::iter::once(enc.finish()));
        frame.present();
    }
}

// ── App ───────────────────────────────────────────────────────────────────

struct App {
    window: Option<Arc<Window>>,
    renderer: Option<EguiWgpu>,
    dock_state: egui_dock::DockState<Panel>,
    state: AppState,
}

impl App {
    fn new() -> Self {
        Self {
            window: None,
            renderer: None,
            dock_state: initial_dock_state(),
            state: AppState::new(),
        }
    }
}

impl ApplicationHandler for App {
    fn resumed(&mut self, event_loop: &ActiveEventLoop) {
        let win = Arc::new(event_loop.create_window(
            Window::default_attributes()
                .with_title("Spike 03 — egui Ribbon + Dock")
                .with_inner_size(winit::dpi::LogicalSize::new(1400, 900)),
        ).unwrap());
        let renderer = pollster::block_on(EguiWgpu::new(win.clone())).unwrap();
        self.window = Some(win);
        self.renderer = Some(renderer);
    }

    fn window_event(&mut self, event_loop: &ActiveEventLoop, _id: winit::window::WindowId, event: WindowEvent) {
        // Forward to egui
        if let (Some(r), Some(w)) = (self.renderer.as_mut(), self.window.as_ref()) {
            let _ = r.handle_event(w, &event);
        }
        match event {
            WindowEvent::CloseRequested => event_loop.exit(),
            WindowEvent::Resized(size) => {
                if let Some(r) = self.renderer.as_mut() {
                    r.resize(size.width, size.height);
                }
            }
            WindowEvent::KeyboardInput { event: KeyEvent {
                physical_key: PhysicalKey::Code(KeyCode::Escape), ..
            }, .. } => event_loop.exit(),
            WindowEvent::RedrawRequested => {
                if let (Some(r), Some(w)) = (self.renderer.as_mut(), self.window.as_ref()) {
                    r.render(w, |ctx| {
                        show_ribbon(ctx, &mut self.state);
                        egui::TopBottomPanel::bottom("status").show(ctx, |ui| {
                            ui.horizontal(|ui| {
                                ui.label(format!("Last action: {}", self.state.last_action));
                                ui.separator();
                                ui.label(format!("Layers: {}", self.state.layer_visible.len()));
                            });
                        });
                        egui::CentralPanel::default().show(ctx, |ui| {
                            let mut viewer = MyTabs { state: &mut self.state };
                            egui_dock::DockArea::new(&mut self.dock_state)
                                .style(egui_dock::Style::from_egui(ctx.style().as_ref()))
                                .show_inside(ui, &mut viewer);
                        });
                    });
                    w.request_redraw();
                }
            }
            _ => {}
        }
    }
}

fn main() -> anyhow::Result<()> {
    if std::env::args().nth(1).as_deref() == Some("--headless") {
        // Probe path for CI
        let ctx = egui::Context::default();
        let _ = initial_dock_state();
        let out = ctx.run(egui::RawInput::default(), |ctx| {
            egui::CentralPanel::default().show(ctx, |ui| { ui.label("headless"); });
        });
        println!("headless ok, shapes: {}", out.shapes.len());
        return Ok(());
    }
    let event_loop = EventLoop::new()?;
    let mut app = App::new();
    event_loop.run_app(&mut app)?;
    Ok(())
}
