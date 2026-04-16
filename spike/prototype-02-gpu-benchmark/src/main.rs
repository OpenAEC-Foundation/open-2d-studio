//! Full GPU benchmark: 100k shapes @ target 120fps.
//! Modes: --headless (just probe, no window), static (default window run),
//!        sparse (500 dirty/frame), heavy (5000 dirty/frame).

mod instance;
mod renderer;

use instance::{generate_scene, Instance};
use renderer::Renderer;
use std::sync::Arc;
use std::time::{Duration, Instant};
use winit::application::ApplicationHandler;
use winit::event::{KeyEvent, WindowEvent};
use winit::event_loop::{ActiveEventLoop, EventLoop};
use winit::keyboard::{KeyCode, PhysicalKey};
use winit::window::Window;

const SHAPE_COUNT: usize = 100_000;
const BENCH_DURATION_SECS: u64 = 10;

enum Scenario { Static, Sparse, Heavy }

async fn probe_only() -> anyhow::Result<()> {
    let instance = wgpu::Instance::new(wgpu::InstanceDescriptor {
        backends: wgpu::Backends::PRIMARY,
        ..Default::default()
    });
    let adapter = instance
        .request_adapter(&wgpu::RequestAdapterOptions {
            power_preference: wgpu::PowerPreference::HighPerformance,
            compatible_surface: None,
            force_fallback_adapter: false,
        })
        .await
        .ok_or_else(|| anyhow::anyhow!("no GPU adapter"))?;
    let info = adapter.get_info();
    println!("[GPU] {} ({:?})", info.name, info.backend);
    println!("      driver: {}", info.driver);
    let (device, _queue) = adapter.request_device(&wgpu::DeviceDescriptor {
        label: Some("probe"),
        required_features: wgpu::Features::empty(),
        required_limits: wgpu::Limits::default(),
        memory_hints: wgpu::MemoryHints::Performance,
    }, None).await?;
    println!("      max_buffer_size: {}", device.limits().max_buffer_size);
    Ok(())
}

struct App {
    window: Option<Arc<Window>>,
    renderer: Option<Renderer>,
    instances: Vec<Instance>,
    scenario: Scenario,
    frame_times: Vec<f32>,
    bench_start: Option<Instant>,
    last_frame: Option<Instant>,
    frame_idx: u64,
}

impl App {
    fn new(scenario: Scenario) -> Self {
        Self {
            window: None,
            renderer: None,
            instances: generate_scene(SHAPE_COUNT),
            scenario,
            frame_times: Vec::with_capacity(10_000),
            bench_start: None,
            last_frame: None,
            frame_idx: 0,
        }
    }

    fn print_results(&self) {
        if self.frame_times.is_empty() {
            eprintln!("no frames captured");
            return;
        }
        let n = self.frame_times.len();
        let sum: f32 = self.frame_times.iter().sum();
        let mean = sum / n as f32;
        let mut sorted = self.frame_times.clone();
        sorted.sort_by(|a, b| a.partial_cmp(b).unwrap());
        let p99 = sorted[(n as f32 * 0.99) as usize];
        let min = sorted[0];
        let max = sorted[n - 1];
        let fps_mean = 1000.0 / mean;
        let scen = match self.scenario {
            Scenario::Static => "STATIC",
            Scenario::Sparse => "SPARSE_500",
            Scenario::Heavy => "HEAVY_5000",
        };
        println!("=== RESULT {} | shapes={} ===", scen, self.instances.len());
        println!("frames:     {}", n);
        println!("mean_ms:    {:.3}", mean);
        println!("mean_fps:   {:.1}", fps_mean);
        println!("p99_ms:     {:.3}", p99);
        println!("min_ms:     {:.3}", min);
        println!("max_ms:     {:.3}", max);
    }
}

impl ApplicationHandler for App {
    fn resumed(&mut self, event_loop: &ActiveEventLoop) {
        let attrs = Window::default_attributes()
            .with_title("Spike 02 — GPU Benchmark")
            .with_inner_size(winit::dpi::LogicalSize::new(1280, 720));
        let window = Arc::new(event_loop.create_window(attrs).unwrap());
        let renderer = pollster::block_on(Renderer::new(window.clone(), &self.instances)).unwrap();
        self.window = Some(window);
        self.renderer = Some(renderer);
        self.bench_start = Some(Instant::now());
        self.last_frame = Some(Instant::now());
    }

    fn window_event(&mut self, event_loop: &ActiveEventLoop, _id: winit::window::WindowId, event: WindowEvent) {
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
                if let (Some(r), Some(last)) = (self.renderer.as_ref(), self.last_frame) {
                    let now = Instant::now();
                    let dt = now.duration_since(last).as_secs_f32();
                    self.last_frame = Some(now);
                    if self.frame_idx > 30 {
                        self.frame_times.push(dt * 1000.0);
                    }
                    self.frame_idx += 1;

                    let dirty_count = match self.scenario {
                        Scenario::Static => 0,
                        Scenario::Sparse => 500,
                        Scenario::Heavy => 5_000,
                    };
                    if dirty_count > 0 {
                        let mut lcg: u32 = self.frame_idx as u32;
                        for _ in 0..dirty_count {
                            lcg = lcg.wrapping_mul(1664525).wrapping_add(1013904223);
                            let idx = (lcg as usize) % self.instances.len();
                            self.instances[idx].rotation += 0.01;
                        }
                        // Heuristic: > 1000 dirty → full buffer replace is faster
                        // than N sparse writes (wgpu internally uses staging).
                        if dirty_count > 1000 {
                            r.update_instances_via_staging(&self.instances);
                        } else {
                            let mut lcg2: u32 = self.frame_idx as u32;
                            let mut dirty_pairs = Vec::with_capacity(dirty_count);
                            for _ in 0..dirty_count {
                                lcg2 = lcg2.wrapping_mul(1664525).wrapping_add(1013904223);
                                let idx = (lcg2 as usize) % self.instances.len();
                                dirty_pairs.push((idx as u32, self.instances[idx]));
                            }
                            r.update_instances_sparse(&dirty_pairs);
                        }
                    }

                    // Fit a grid of 100k * 5mm spacing into viewport
                    let s = 2.0 / ((SHAPE_COUNT as f32).sqrt().ceil() * 5.0);
                    let view_proj = [
                        [s, 0.0, 0.0, 0.0],
                        [0.0, s, 0.0, 0.0],
                        [0.0, 0.0, 1.0, 0.0],
                        [-1.0, -1.0, 0.0, 1.0],
                    ];
                    r.update_camera(view_proj);

                    match r.render() {
                        Ok(_) => {}
                        Err(wgpu::SurfaceError::Lost) | Err(wgpu::SurfaceError::Outdated) => {}
                        Err(e) => eprintln!("render err: {:?}", e),
                    }
                }

                if let Some(start) = self.bench_start {
                    if start.elapsed() >= Duration::from_secs(BENCH_DURATION_SECS) {
                        self.print_results();
                        event_loop.exit();
                    }
                }
                if let Some(w) = self.window.as_ref() { w.request_redraw(); }
            }
            _ => {}
        }
    }
}

fn main() -> anyhow::Result<()> {
    let arg = std::env::args().nth(1).unwrap_or_else(|| "static".into());
    if arg == "--headless" {
        return pollster::block_on(probe_only());
    }
    let scenario = match arg.as_str() {
        "sparse" => Scenario::Sparse,
        "heavy" => Scenario::Heavy,
        _ => Scenario::Static,
    };
    let event_loop = EventLoop::new()?;
    let mut app = App::new(scenario);
    event_loop.run_app(&mut app)?;
    Ok(())
}
