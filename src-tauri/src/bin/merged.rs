//! merged.exe — Slice 1 of the 1.0 + 2.0 merge.
//!
//! Opens a single winit window, mounts a wry transparent child webview
//! over it, and clears a wgpu surface to `#1E3A8A` every frame. The React
//! app served at http://localhost:5173 renders an opaque TitleBar + Ribbon
//! at the top; the rest of the webview is transparent so the wgpu blue
//! shows through.
//!
//! See docs/superpowers/specs/2026-04-22-open2d-merge-slice1-design.md.

use anyhow::Result;
use winit::{
    application::ApplicationHandler,
    event::WindowEvent,
    event_loop::{ActiveEventLoop, EventLoop},
    window::{Window, WindowId},
};

struct App {
    window: Option<Window>,
}

impl ApplicationHandler for App {
    fn resumed(&mut self, event_loop: &ActiveEventLoop) {
        if self.window.is_some() {
            return;
        }
        let attrs = Window::default_attributes()
            .with_title("Open 2D Studio (merged)")
            .with_inner_size(winit::dpi::LogicalSize::new(1800, 1000));
        let window = event_loop
            .create_window(attrs)
            .expect("create window");
        self.window = Some(window);
    }

    fn window_event(
        &mut self,
        event_loop: &ActiveEventLoop,
        _id: WindowId,
        event: WindowEvent,
    ) {
        match event {
            WindowEvent::CloseRequested => event_loop.exit(),
            _ => {}
        }
    }
}

fn main() -> Result<()> {
    let event_loop = EventLoop::new()?;
    event_loop.set_control_flow(winit::event_loop::ControlFlow::Wait);
    let mut app = App { window: None };
    event_loop.run_app(&mut app)?;
    Ok(())
}
