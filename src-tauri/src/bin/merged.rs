//! merged.exe — Slice 1 of the 1.0 + 2.0 merge.
//!
//! Opens a single winit window, initialises a wgpu surface on it, and
//! clears to `#1E3A8A` every frame. wry webview is added in Task 5.

use anyhow::{Context, Result};
use std::sync::Arc;
use wgpu::SurfaceError;
use winit::{
    application::ApplicationHandler,
    event::WindowEvent,
    event_loop::{ActiveEventLoop, EventLoop},
    window::{Window, WindowId},
};

/// Resources that only exist once the OS has given us a window. winit's
/// `ApplicationHandler` pattern spins these up in `resumed()`.
struct GpuState {
    surface: wgpu::Surface<'static>,
    device: wgpu::Device,
    queue: wgpu::Queue,
    config: wgpu::SurfaceConfiguration,
}

struct App {
    window: Option<Arc<Window>>,
    gpu: Option<GpuState>,
    webview: Option<wry::WebView>,
}

impl App {
    fn new() -> Self {
        Self { window: None, gpu: None, webview: None }
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
                        // #1E3A8A = rgb(30, 58, 138). The surface format is
                        // sRGB, so wgpu writes the clear value into the
                        // texture as-is and the hardware applies the sRGB
                        // transfer on scan-out. We therefore supply the
                        // *linear* representation of the target sRGB colour.
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

    fn resize(&mut self, w: u32, h: u32) {
        let Some(gpu) = self.gpu.as_mut() else { return };
        gpu.config.width = w.max(1);
        gpu.config.height = h.max(1);
        gpu.surface.configure(&gpu.device, &gpu.config);
        if let Some(wv) = self.webview.as_ref() {
            let _ = wv.set_bounds(wry::Rect {
                position: wry::dpi::LogicalPosition::new(0, 0).into(),
                size: wry::dpi::LogicalSize::new(
                    (w as f64).max(1.0) as u32,
                    (h as f64).max(1.0) as u32,
                ).into(),
            });
        }
    }
}

impl ApplicationHandler for App {
    fn resumed(&mut self, event_loop: &ActiveEventLoop) {
        if self.window.is_some() {
            return;
        }
        let attrs = Window::default_attributes()
            .with_title("Open 2D Studio (merged)")
            .with_inner_size(winit::dpi::LogicalSize::new(1800, 1000));
        let window = Arc::new(
            event_loop.create_window(attrs).expect("create window"),
        );
        let gpu = pollster::block_on(Self::init_gpu(window.clone()))
            .expect("init gpu");
        self.window = Some(window.clone());
        self.gpu = Some(gpu);

        // Child webview over the same window. Transparent so wgpu shows
        // through wherever the page has CSS background: transparent.
        let webview = wry::WebViewBuilder::new_as_child(window.as_ref())
            .with_transparent(true)
            .with_url("data:text/html,<html><body style='margin:0;background:transparent'><div style='background:#2b2b33;color:white;padding:12px;font-family:sans-serif'>webview online</div></body></html>")
            .build()
            .expect("build webview");
        self.webview = Some(webview);
    }

    fn window_event(
        &mut self,
        event_loop: &ActiveEventLoop,
        _id: WindowId,
        event: WindowEvent,
    ) {
        match event {
            WindowEvent::CloseRequested => event_loop.exit(),
            WindowEvent::Resized(size) => self.resize(size.width, size.height),
            WindowEvent::RedrawRequested => self.render(),
            _ => {}
        }
    }

    fn about_to_wait(&mut self, _event_loop: &ActiveEventLoop) {
        if let Some(w) = self.window.as_ref() {
            w.request_redraw();
        }
    }
}

/// Convert an sRGB channel in [0, 1] to its linear-light equivalent using
/// the standard piecewise transfer function. Needed because our surface
/// uses an sRGB texture format: wgpu stores the clear value as linear and
/// the display hardware applies the sRGB encoding, so passing the naive
/// 8-bit/255 value would double-encode and yield a too-bright result.
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
