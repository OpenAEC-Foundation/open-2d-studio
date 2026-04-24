//! merged.exe — Slice 1.5 pivot (route B: two-window architecture).
//!
//! Opens TWO winit windows:
//!   * shell  — 1800×150, hosts the wry webview (loads the Vite dev server).
//!     Has OS chrome (titlebar + close button).
//!   * canvas — 1800×850, hosts the wgpu surface (clears to #1E3A8A).
//!     Decorations off; positioned flush against the bottom of the shell.
//!
//! The two windows are kept attached: when the shell moves, the canvas
//! follows; when the shell resizes (width), the canvas matches the new
//! width. Closing either window terminates the process. WebView2 paints
//! opaquely on Windows, so we no longer rely on a transparent overlay.

use anyhow::{Context, Result};
use std::sync::Arc;
use wgpu::SurfaceError;
use winit::{
    application::ApplicationHandler,
    dpi::{LogicalSize, PhysicalPosition, PhysicalSize},
    event::WindowEvent,
    event_loop::{ActiveEventLoop, EventLoop},
    window::{Window, WindowId},
};

const SHELL_W: u32 = 1800;
const SHELL_H: u32 = 150;
const CANVAS_W: u32 = 1800;
const CANVAS_H: u32 = 850;

/// Resources that only exist once the OS has given us a window.
struct GpuState {
    surface: wgpu::Surface<'static>,
    device: wgpu::Device,
    queue: wgpu::Queue,
    config: wgpu::SurfaceConfiguration,
}

struct App {
    /// Window 1: hosts the wry webview (Vite dev server).
    shell: Option<Arc<Window>>,
    webview: Option<wry::WebView>,
    /// Window 2: hosts the wgpu surface.
    canvas: Option<Arc<Window>>,
    gpu: Option<GpuState>,
    /// Last observed shell outer position — used to debounce sync work.
    last_shell_pos: Option<PhysicalPosition<i32>>,
}

impl App {
    fn new() -> Self {
        Self {
            shell: None,
            webview: None,
            canvas: None,
            gpu: None,
            last_shell_pos: None,
        }
    }

    async fn init_gpu(window: Arc<Window>) -> Result<GpuState> {
        let instance = wgpu::Instance::new(wgpu::InstanceDescriptor {
            backends: wgpu::Backends::PRIMARY,
            ..Default::default()
        });
        // Arc keeps the window alive for the 'static surface lifetime.
        let surface = instance
            .create_surface(window.clone())
            .context("create surface")?;
        let adapter = instance
            .request_adapter(&wgpu::RequestAdapterOptions {
                power_preference: wgpu::PowerPreference::HighPerformance,
                compatible_surface: Some(&surface),
                force_fallback_adapter: false,
            })
            .await
            .context("no suitable GPU adapter")?;
        let (device, queue) = adapter
            .request_device(
                &wgpu::DeviceDescriptor {
                    label: Some("merged.device"),
                    required_features: wgpu::Features::empty(),
                    required_limits: wgpu::Limits::default(),
                    memory_hints: wgpu::MemoryHints::default(),
                },
                None,
            )
            .await
            .context("request device")?;

        let inner = window.inner_size();
        let caps = surface.get_capabilities(&adapter);
        let format = caps
            .formats
            .iter()
            .copied()
            .find(|f| f.is_srgb())
            .unwrap_or(caps.formats[0]);
        let config = wgpu::SurfaceConfiguration {
            usage: wgpu::TextureUsages::RENDER_ATTACHMENT,
            format,
            width: inner.width.max(1),
            height: inner.height.max(1),
            present_mode: wgpu::PresentMode::Fifo,
            alpha_mode: caps.alpha_modes[0],
            view_formats: vec![],
            desired_maximum_frame_latency: 2,
        };
        surface.configure(&device, &config);
        Ok(GpuState { surface, device, queue, config })
    }

    fn render(&mut self) {
        let Some(gpu) = self.gpu.as_mut() else { return };
        let frame = match gpu.surface.get_current_texture() {
            Ok(f) => f,
            Err(SurfaceError::Lost) | Err(SurfaceError::Outdated) => {
                gpu.surface.configure(&gpu.device, &gpu.config);
                return;
            }
            Err(_) => return,
        };
        let view = frame
            .texture
            .create_view(&wgpu::TextureViewDescriptor::default());
        let mut enc = gpu
            .device
            .create_command_encoder(&wgpu::CommandEncoderDescriptor {
                label: Some("merged.encoder"),
            });
        {
            let _pass = enc.begin_render_pass(&wgpu::RenderPassDescriptor {
                label: Some("merged.clear"),
                color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                    view: &view,
                    resolve_target: None,
                    ops: wgpu::Operations {
                        // #1E3A8A linear-encoded; sRGB scan-out re-encodes.
                        load: wgpu::LoadOp::Clear(wgpu::Color {
                            r: srgb_to_linear(30.0 / 255.0),
                            g: srgb_to_linear(58.0 / 255.0),
                            b: srgb_to_linear(138.0 / 255.0),
                            a: 1.0,
                        }),
                        store: wgpu::StoreOp::Store,
                    },
                })],
                depth_stencil_attachment: None,
                timestamp_writes: None,
                occlusion_query_set: None,
            });
        }
        gpu.queue.submit(Some(enc.finish()));
        frame.present();
    }

    /// Reconfigure the wgpu surface for the canvas window's new size.
    fn resize_canvas(&mut self, w: u32, h: u32) {
        let Some(gpu) = self.gpu.as_mut() else { return };
        gpu.config.width = w.max(1);
        gpu.config.height = h.max(1);
        gpu.surface.configure(&gpu.device, &gpu.config);
    }

    /// Resize the wry webview to fill the shell's client area.
    fn resize_webview(&self, w: u32, h: u32) {
        if let Some(wv) = self.webview.as_ref() {
            let _ = wv.set_bounds(wry::Rect {
                position: wry::dpi::LogicalPosition::new(0, 0).into(),
                size: wry::dpi::LogicalSize::new(w.max(1), h.max(1)).into(),
            });
        }
    }

    /// Reposition the canvas window flush against the bottom of the shell.
    fn sync_canvas_position(&mut self) {
        let (Some(shell), Some(canvas)) = (self.shell.as_ref(), self.canvas.as_ref())
        else {
            return;
        };
        let Ok(shell_pos) = shell.outer_position() else { return };
        let shell_size = shell.outer_size();
        let target = PhysicalPosition::new(
            shell_pos.x,
            shell_pos.y + shell_size.height as i32,
        );
        canvas.set_outer_position(target);
        self.last_shell_pos = Some(shell_pos);
    }
}

impl ApplicationHandler for App {
    fn resumed(&mut self, event_loop: &ActiveEventLoop) {
        if self.shell.is_some() {
            return;
        }

        // ---- Shell window (hosts the webview) ---------------------------
        let shell_attrs = Window::default_attributes()
            .with_title("Open 2D Studio (merged) — shell")
            .with_inner_size(LogicalSize::new(SHELL_W, SHELL_H))
            .with_decorations(true)
            .with_resizable(true);
        let shell = Arc::new(
            event_loop
                .create_window(shell_attrs)
                .expect("create shell window"),
        );

        // Webview as a child of the shell. No transparency: route B uses
        // a separate window for wgpu, so the webview can paint opaquely.
        let shell_inner = shell.inner_size();
        let webview = wry::WebViewBuilder::new_as_child(shell.as_ref())
            .with_url("http://127.0.0.1:5173")
            .with_bounds(wry::Rect {
                position: wry::dpi::LogicalPosition::new(0, 0).into(),
                size: wry::dpi::LogicalSize::new(
                    shell_inner.width.max(1),
                    shell_inner.height.max(1),
                )
                .into(),
            })
            .build()
            .expect("build webview");

        // ---- Canvas window (hosts the wgpu surface) ---------------------
        // Position directly below the shell's outer rect (no gap, no overlap).
        let shell_outer_pos = shell
            .outer_position()
            .unwrap_or(PhysicalPosition::new(100, 100));
        let shell_outer_size = shell.outer_size();
        let canvas_pos = PhysicalPosition::new(
            shell_outer_pos.x,
            shell_outer_pos.y + shell_outer_size.height as i32,
        );
        let canvas_attrs = Window::default_attributes()
            .with_title("Open 2D Studio (merged) — canvas")
            .with_inner_size(LogicalSize::new(CANVAS_W, CANVAS_H))
            .with_decorations(false)
            .with_resizable(false)
            .with_position(canvas_pos);
        let canvas = Arc::new(
            event_loop
                .create_window(canvas_attrs)
                .expect("create canvas window"),
        );

        let gpu = pollster::block_on(Self::init_gpu(canvas.clone()))
            .expect("init gpu");

        self.shell = Some(shell);
        self.webview = Some(webview);
        self.canvas = Some(canvas);
        self.gpu = Some(gpu);
        self.last_shell_pos = Some(shell_outer_pos);

        // Make sure the canvas ends up exactly under the shell after both
        // windows have been realised by the OS (positions can shift slightly
        // once decorations are measured).
        self.sync_canvas_position();
    }

    fn window_event(
        &mut self,
        event_loop: &ActiveEventLoop,
        id: WindowId,
        event: WindowEvent,
    ) {
        let shell_id = self.shell.as_ref().map(|w| w.id());
        let canvas_id = self.canvas.as_ref().map(|w| w.id());

        if Some(id) == shell_id {
            match event {
                WindowEvent::CloseRequested => event_loop.exit(),
                WindowEvent::Moved(_pos) => {
                    // Keep the canvas attached to the shell's bottom edge.
                    self.sync_canvas_position();
                }
                WindowEvent::Resized(size) => {
                    // Match the canvas width to the shell width; preserve
                    // the canvas's current inner height.
                    self.resize_webview(size.width, size.height);
                    let canvas_height = self
                        .canvas
                        .as_ref()
                        .map(|c| c.inner_size().height)
                        .unwrap_or(CANVAS_H);
                    if let Some(canvas) = self.canvas.as_ref() {
                        let _ = canvas.request_inner_size(PhysicalSize::new(
                            size.width.max(1),
                            canvas_height.max(1),
                        ));
                    }
                    // The shell's outer height may have changed (e.g. DPI).
                    self.sync_canvas_position();
                }
                _ => {}
            }
        } else if Some(id) == canvas_id {
            match event {
                WindowEvent::CloseRequested => event_loop.exit(),
                WindowEvent::Resized(size) => {
                    self.resize_canvas(size.width, size.height);
                }
                WindowEvent::RedrawRequested => self.render(),
                _ => {}
            }
        }
    }

    fn about_to_wait(&mut self, _event_loop: &ActiveEventLoop) {
        // Only the canvas needs continuous redraws; the webview drives itself.
        if let Some(c) = self.canvas.as_ref() {
            c.request_redraw();
        }
    }
}

/// Convert an sRGB channel in [0, 1] to its linear-light equivalent. Needed
/// because our surface uses an sRGB texture format: wgpu stores the clear
/// value as linear and the display hardware applies the sRGB encoding, so
/// passing the naive 8-bit/255 value would double-encode.
fn srgb_to_linear(c: f64) -> f64 {
    if c <= 0.04045 {
        c / 12.92
    } else {
        ((c + 0.055) / 1.055).powf(2.4)
    }
}

fn main() -> Result<()> {
    let event_loop = EventLoop::new()?;
    event_loop.set_control_flow(winit::event_loop::ControlFlow::Poll);
    let mut app = App::new();
    event_loop.run_app(&mut app)?;
    Ok(())
}
