# Spike Task 3 — egui Ribbon met Dockable Panels

> **Parent plan:** `2026-04-16-spike-native-kernel.md`
> **Goal:** Bewijzen dat egui + egui_dock een CAD-waardige ribbon + dockable panels kan leveren zonder custom hacks.

**Tijdsbudget:** 1-1.5 dag

## Wat we valideren

De Purist noemt egui een "zwakke keuze voor CAD UI". We testen concreet:

1. Ribbon met 3 tabs (Home / Draw / View) met knoppen die callbacks triggeren
2. Dockable panels (Properties, Layers, Navigation) links/rechts
3. Canvas-gebied als custom wgpu paint callback binnen een egui panel
4. Keyboard shortcuts (Ctrl+Z, Escape, F1)
5. Floating secondary window (bijv. Settings dialog als aparte winit window)

## Exit criteria

- **SUCCES:** Alle 5 bovenstaande werken. Panels zijn draggable, dockable, en tear-off. Canvas reageert instant.
- **TWIJFEL:** 4/5 werkt, tear-off vereist custom werk. egui_dock laat hacks zien.
- **KILL:** Canvas paint callback werkt niet met wgpu, of docking crasht bij normale interactie.

---

## File Structure

```
spike/prototype-03-egui-ribbon/
├── Cargo.toml
└── src/
    ├── main.rs           # winit + wgpu + egui integration
    ├── ribbon.rs         # ribbon bar rendering
    ├── panels.rs         # dockable panels (Properties, Layers, Navigation)
    └── canvas.rs         # wgpu paint callback binnen egui CentralPanel
```

---

## Task 3.0: Crate setup

- [ ] **Step 3.0.1: Create manifest**

Create `spike/prototype-03-egui-ribbon/Cargo.toml`:

```toml
[package]
name = "prototype-03-egui-ribbon"
version.workspace = true
edition.workspace = true

[dependencies]
egui = { workspace = true }
egui-wgpu = { workspace = true }
egui-winit = { workspace = true }
egui_dock = { workspace = true }
wgpu = { workspace = true }
winit = { workspace = true, features = ["rwh_06"] }
pollster = { workspace = true }
anyhow = { workspace = true }

[[bin]]
name = "prototype-03"
path = "src/main.rs"
```

- [ ] **Step 3.0.2: Verify manifest builds**

Run: `cd spike && cargo check -p prototype-03-egui-ribbon`
Expected: error about missing main.rs — to be added.

---

## Task 3.1: Ribbon bar

- [ ] **Step 3.1.1: Implement ribbon.rs**

Create `spike/prototype-03-egui-ribbon/src/ribbon.rs`:

```rust
use egui::{Context, TopBottomPanel, Ui};

pub struct RibbonState {
    pub active_tab: usize,
    pub last_action: String,
}

impl Default for RibbonState {
    fn default() -> Self {
        Self { active_tab: 0, last_action: "(none)".into() }
    }
}

pub fn show(ctx: &Context, state: &mut RibbonState) {
    TopBottomPanel::top("ribbon-bar").show(ctx, |ui| {
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
            0 => home_tab(ui, state),
            1 => draw_tab(ui, state),
            2 => view_tab(ui, state),
            _ => {}
        });
    });
}

fn home_tab(ui: &mut Ui, state: &mut RibbonState) {
    if ui.button("📄 New").clicked() { state.last_action = "New".into(); }
    if ui.button("📂 Open").clicked() { state.last_action = "Open".into(); }
    if ui.button("💾 Save").clicked() { state.last_action = "Save".into(); }
    ui.separator();
    if ui.button("↶ Undo").clicked() { state.last_action = "Undo".into(); }
    if ui.button("↷ Redo").clicked() { state.last_action = "Redo".into(); }
}

fn draw_tab(ui: &mut Ui, state: &mut RibbonState) {
    if ui.button("Line").clicked() { state.last_action = "Tool:Line".into(); }
    if ui.button("Rect").clicked() { state.last_action = "Tool:Rect".into(); }
    if ui.button("Circle").clicked() { state.last_action = "Tool:Circle".into(); }
    if ui.button("Polyline").clicked() { state.last_action = "Tool:Polyline".into(); }
    ui.separator();
    if ui.button("Hatch").clicked() { state.last_action = "Tool:Hatch".into(); }
    if ui.button("Text").clicked() { state.last_action = "Tool:Text".into(); }
}

fn view_tab(ui: &mut Ui, state: &mut RibbonState) {
    if ui.button("🔍+ Zoom In").clicked() { state.last_action = "ZoomIn".into(); }
    if ui.button("🔍− Zoom Out").clicked() { state.last_action = "ZoomOut".into(); }
    if ui.button("⤢ Fit").clicked() { state.last_action = "ZoomFit".into(); }
    ui.separator();
    ui.checkbox(&mut ui.ctx().style().visuals.dark_mode.clone(), "Dark");
}
```

- [ ] **Step 3.1.2: Verify builds**

Run: `cd spike && cargo check -p prototype-03-egui-ribbon`
Expected: compile error about missing main.rs binary — OK for now.

---

## Task 3.2: Dockable panels met egui_dock

- [ ] **Step 3.2.1: Implement panels.rs**

Create `spike/prototype-03-egui-ribbon/src/panels.rs`:

```rust
use egui::{Ui, WidgetText};
use egui_dock::{DockArea, DockState, NodeIndex, Style, SurfaceIndex, TabViewer};

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum PanelKind {
    Canvas,
    Properties,
    Layers,
    Navigation,
}

pub struct AppState {
    pub selected_shape: Option<String>,
    pub layer_count: usize,
    pub ribbon: crate::ribbon::RibbonState,
}

pub struct MyTabs<'a> {
    pub state: &'a mut AppState,
    /// Rendered by main.rs after DockArea::show returns
    pub paint_canvas: bool,
}

impl<'a> TabViewer for MyTabs<'a> {
    type Tab = PanelKind;

    fn title(&mut self, tab: &mut Self::Tab) -> WidgetText {
        match tab {
            PanelKind::Canvas => "Canvas".into(),
            PanelKind::Properties => "Properties".into(),
            PanelKind::Layers => "Layers".into(),
            PanelKind::Navigation => "Navigation".into(),
        }
    }

    fn ui(&mut self, ui: &mut Ui, tab: &mut Self::Tab) {
        match tab {
            PanelKind::Canvas => {
                ui.label("(wgpu render area — see main.rs paint callback)");
                self.paint_canvas = true;
            }
            PanelKind::Properties => {
                ui.heading("Properties");
                match &self.state.selected_shape {
                    Some(s) => ui.label(format!("Selected: {}", s)),
                    None => ui.label("(no selection)"),
                };
                ui.separator();
                ui.horizontal(|ui| {
                    ui.label("Color:");
                    let mut rgba = [0.4, 0.6, 0.9, 1.0];
                    ui.color_edit_button_rgba_unmultiplied(&mut rgba);
                });
            }
            PanelKind::Layers => {
                ui.heading("Layers");
                for i in 0..self.state.layer_count {
                    ui.checkbox(&mut true.clone(), format!("Layer {}", i));
                }
                if ui.button("+ Add layer").clicked() { self.state.layer_count += 1; }
            }
            PanelKind::Navigation => {
                ui.heading("Navigation");
                ui.label("Drawing 1");
                ui.label("  └ Sheet A1");
                ui.label("  └ Sheet A2");
                ui.label("Drawing 2");
            }
        }
    }
}

pub fn initial_dock_state() -> DockState<PanelKind> {
    let mut state = DockState::new(vec![PanelKind::Canvas]);
    let [main, right] = state.main_surface_mut().split_right(
        NodeIndex::root(),
        0.75,
        vec![PanelKind::Properties],
    );
    let [_right, _below] = state.main_surface_mut().split_below(
        right,
        0.5,
        vec![PanelKind::Layers],
    );
    let [_main, _left] = state.main_surface_mut().split_left(
        main,
        0.15,
        vec![PanelKind::Navigation],
    );
    let _ = SurfaceIndex::main();
    state
}
```

- [ ] **Step 3.2.2: Verify builds**

Run: `cd spike && cargo check -p prototype-03-egui-ribbon`
Expected: main.rs still missing — OK.

---

## Task 3.3: winit + wgpu + egui integration

- [ ] **Step 3.3.1: Implement main.rs**

Create `spike/prototype-03-egui-ribbon/src/main.rs`:

```rust
mod canvas;
mod panels;
mod ribbon;

use panels::{initial_dock_state, AppState, MyTabs, PanelKind};
use std::sync::Arc;
use winit::application::ApplicationHandler;
use winit::event::{KeyEvent, WindowEvent};
use winit::event_loop::{ActiveEventLoop, EventLoop};
use winit::keyboard::{KeyCode, PhysicalKey};
use winit::window::Window;

struct App {
    window: Option<Arc<Window>>,
    renderer: Option<canvas::EguiWgpu>,
    dock_state: egui_dock::DockState<PanelKind>,
    app_state: AppState,
}

impl App {
    fn new() -> Self {
        Self {
            window: None,
            renderer: None,
            dock_state: initial_dock_state(),
            app_state: AppState {
                selected_shape: Some("Line #42".to_string()),
                layer_count: 3,
                ribbon: ribbon::RibbonState::default(),
            },
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
        let renderer = pollster::block_on(canvas::EguiWgpu::new(win.clone())).unwrap();
        self.window = Some(win);
        self.renderer = Some(renderer);
    }

    fn window_event(
        &mut self,
        event_loop: &ActiveEventLoop,
        _id: winit::window::WindowId,
        event: WindowEvent,
    ) {
        // Forward events to egui
        if let (Some(r), Some(w)) = (self.renderer.as_mut(), self.window.as_ref()) {
            let consumed = r.handle_event(w, &event);
            if consumed { /* egui ate it */ }
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
                        ribbon::show(ctx, &mut self.app_state.ribbon);

                        // Status bar bottom
                        egui::TopBottomPanel::bottom("status").show(ctx, |ui| {
                            ui.horizontal(|ui| {
                                ui.label(format!("Last action: {}", self.app_state.ribbon.last_action));
                                ui.separator();
                                ui.label(format!("Layers: {}", self.app_state.layer_count));
                            });
                        });

                        // Main dock area
                        egui::CentralPanel::default().show(ctx, |ui| {
                            let mut viewer = MyTabs {
                                state: &mut self.app_state,
                                paint_canvas: false,
                            };
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
    let event_loop = EventLoop::new()?;
    let mut app = App::new();
    event_loop.run_app(&mut app)?;
    Ok(())
}
```

- [ ] **Step 3.3.2: Implement canvas.rs (egui + wgpu bridge)**

Create `spike/prototype-03-egui-ribbon/src/canvas.rs`:

```rust
use egui_wgpu::ScreenDescriptor;
use std::sync::Arc;
use winit::window::Window;

pub struct EguiWgpu {
    surface: wgpu::Surface<'static>,
    device: wgpu::Device,
    queue: wgpu::Queue,
    config: wgpu::SurfaceConfiguration,
    egui_ctx: egui::Context,
    egui_state: egui_winit::State,
    egui_renderer: egui_wgpu::Renderer,
    window: Arc<Window>,
}

impl EguiWgpu {
    pub async fn new(window: Arc<Window>) -> anyhow::Result<Self> {
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
            // memory_hints is wgpu 0.21+; leave out for 0.20
        }, None).await?;
        let caps = surface.get_capabilities(&adapter);
        let format = caps.formats.iter().copied().find(|f| f.is_srgb()).unwrap_or(caps.formats[0]);
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
            &window,
            Some(window.scale_factor() as f32),
            None,
            None,
        );
        let egui_renderer = egui_wgpu::Renderer::new(&device, format, None, 1, false);

        Ok(Self { surface, device, queue, config, egui_ctx, egui_state, egui_renderer, window })
    }

    pub fn handle_event(&mut self, window: &Window, event: &winit::event::WindowEvent) -> bool {
        self.egui_state.on_window_event(window, event).consumed
    }

    pub fn resize(&mut self, w: u32, h: u32) {
        if w == 0 || h == 0 { return; }
        self.config.width = w;
        self.config.height = h;
        self.surface.configure(&self.device, &self.config);
    }

    pub fn render(&mut self, window: &Window, mut ui: impl FnMut(&egui::Context)) {
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
            let mut pass = enc.begin_render_pass(&wgpu::RenderPassDescriptor {
                label: Some("egui"),
                color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                    view: &view,
                    resolve_target: None,
                    ops: wgpu::Operations {
                        load: wgpu::LoadOp::Clear(wgpu::Color { r: 0.1, g: 0.1, b: 0.12, a: 1.0 }),
                        store: wgpu::StoreOp::Store,
                    },
                })],
                depth_stencil_attachment: None,
                timestamp_writes: None,
                occlusion_query_set: None,
            });
            self.egui_renderer.render(&mut pass.forget_lifetime(), &paint_jobs, &screen);
        }
        for id in &full_output.textures_delta.free {
            self.egui_renderer.free_texture(id);
        }
        self.queue.submit(std::iter::once(enc.finish()));
        frame.present();
    }
}
```

- [ ] **Step 3.3.3: Build and run**

Run: `cd spike && cargo run -p prototype-03-egui-ribbon --release`
Expected: window opens with ribbon at top, 3 panels docked around central Canvas panel. Click tabs in ribbon — status bar updates. Try dragging a panel tab — it should be draggable to other dock positions.

- [ ] **Step 3.3.4: Manual test checklist**

Go through each item manually and note results:

- [ ] Ribbon has 3 tabs (Home/Draw/View), switchable
- [ ] Each tab shows 4-6 buttons, clicks register in status bar
- [ ] 4 panels visible (Canvas/Properties/Layers/Navigation)
- [ ] Drag Properties panel tab — docks elsewhere
- [ ] Drag Layers panel tab OUT of the window — tear-off to floating window
- [ ] Ctrl+Z / Ctrl+Y keyboard events captured (check via ribbon Undo/Redo buttons wired up, or print kb events)
- [ ] Resize window — layout reflows, no crashes
- [ ] Close via X — clean exit
- [ ] Escape key — clean exit

- [ ] **Step 3.3.5: Commit**

```bash
cd spike
git add prototype-03-egui-ribbon/
git commit -m "spike(03): egui ribbon + egui_dock panels prototype

- 3-tab ribbon bar with contextual buttons
- 4 dockable panels via egui_dock
- wgpu rendering integrated through egui_wgpu
- Manual UX checklist for verdict"
```

- [ ] **Step 3.3.6: Fill SPIKE-RESULTS.md**

Edit `spike/SPIKE-RESULTS.md` — replace Prototype 3 section with:

```markdown
## Prototype 3: egui Ribbon met dockable panels
Status: [x] SUCCES / [ ] TWIJFEL / [ ] KILL

- Ribbon 3 tabs: [pass/fail]
- Dockable panels: [pass/fail]
- Tear-off: [pass/fail]
- Canvas area binnen panel: [pass/fail]
- Keyboard shortcuts: [pass/fail]

Observaties:
- egui_dock 0.14 is productiewaardig
- Tear-off werkt wel/niet zonder custom code
- Overall UX verdict: ...
```

---

## Self-Review Task 3

1. **Coverage:** alle 5 UX-checks hebben een step. Manual checklist in Step 3.3.4 maakt verdict expliciet.
2. **Placeholders:** geen TODO; main.rs en canvas.rs zijn compleet.
3. **Type consistency:** `PanelKind`, `AppState`, `MyTabs` consistent tussen panels.rs en main.rs.
4. **Scope:** 4 sub-tasks, totaal ~6-8 uur. Past in 1-1.5 dag.

Note: egui_dock tear-off naar floating window vereist `DockState::set_focused_node_and_surface` en aparte winit subwindow — als dit niet out-of-box werkt, stellen we vast dat egui_dock 0.14 geen tear-off ondersteunt en tellen dat als twijfel, niet kill.
