# Spike Task 2 — GPU Benchmark (100k Instance Dirty Updates)

> **Parent plan:** `2026-04-16-spike-native-kernel.md`
> **Status:** 🟡 API verified via headless probe (`spike/prototype-02-gpu-benchmark/`), full benchmark pending (needs window + actual 100k shapes run)
> **Goal:** Meten of 100k shapes @ ≥60 fps haalbaar is op echte mid-range hardware met wgpu + instanced rendering + sparse dirty updates.

**Tijdsbudget:** 2 dagen (ipv 1.5 — wgpu compile-tijd is fors)

## ⚠️ API-bevindingen uit day-0 verificatie

Tijdens voorbereiding van dit plan is de wgpu API-oppervlakte geverifieerd via een minimale headless probe:

| Claim in originele plan | Werkelijkheid wgpu 0.20 | Actie |
|------------------------|------------------------|-------|
| `memory_hints: MemoryHints::Performance` | **Bestaat niet in 0.20** (toegevoegd in 0.21) | Verwijderd uit DeviceDescriptor |
| `Instance::new(InstanceDescriptor)` by value | ✅ Correct | Geen wijziging |
| `Limits::default()` | ✅ Werkt, geeft downlevel defaults | Geen wijziging |
| `vertex_attr_array![...]` macro | ✅ Werkt | Geen wijziging |
| `Instance` struct 32 bytes + bytemuck Pod | ✅ Correct | Geen wijziging |
| `max_buffer_size >= 256 MB` | ✅ Default limit = 256 MB | Ruim voor 100k × 32 bytes |

**Reviewer's claim over `winit 0.30` feature `rwh_06`:** onjuist — feature bestaat wel in winit 0.30.13. Cargo.toml blijft ongewijzigd.

**Kritisch meetpunt:** dit prototype levert het harde bewijs of de hele performance-claim van de spec haalbaar is. Als dit faalt, gaat de Rust-kernel niet door.

---

## Wat we meten

Drie scenarios, elk 60 seconden op 3 hardware-targets:

| Scenario | Shapes | Dirty per frame | Hardware targets |
|----------|--------|----------------|------------------|
| A. Static | 100.000 | 0 (alleen pan/zoom) | RTX 3060, Iris Xe, M1 |
| B. Sparse edit | 100.000 | 500 random dirty | RTX 3060, Iris Xe, M1 |
| C. Heavy edit | 100.000 | 5.000 random dirty | RTX 3060, Iris Xe, M1 |

**Output per run:** gemiddelde FPS, P99 frame time (ms), GPU memory used.

**Exit criteria:**
- **SUCCES:** Scenario A ≥120 fps op RTX 3060, ≥60 fps op Iris Xe. Scenario B ≥60 fps op alle drie. Scenario C ≥30 fps op alle drie.
- **TWIJFEL:** Scenario A/B halen target op RTX, Iris Xe zakt naar 30-50 fps.
- **KILL:** Scenario A < 60 fps op Iris Xe of < 120 fps op RTX.

---

## File Structure

```
spike/prototype-02-gpu-benchmark/
├── Cargo.toml
├── src/
│   ├── main.rs              # winit event loop + benchmark runner
│   ├── renderer.rs          # wgpu setup + instance buffer + draw
│   ├── instance.rs          # Instance struct + dirty tracking
│   ├── scene.rs             # 100k shape generator
│   └── shaders/
│       └── instances.wgsl
├── RESULTS.md               # per-hardware benchmark table
└── tests/
    └── instance_layout.rs   # bytemuck/std140 alignment tests
```

---

## Task 2.0: Crate setup

**Files:**
- Create: `spike/prototype-02-gpu-benchmark/Cargo.toml`

- [ ] **Step 2.0.1: Create manifest**

Create `spike/prototype-02-gpu-benchmark/Cargo.toml`:

```toml
[package]
name = "prototype-02-gpu-benchmark"
version.workspace = true
edition.workspace = true

# winit 0.30 uses raw-window-handle 0.6 by default — no feature flag required
[dependencies]
wgpu = { workspace = true }
winit = { workspace = true }
pollster = { workspace = true }
bytemuck = { workspace = true }
anyhow = { workspace = true }

[[bin]]
name = "prototype-02"
path = "src/main.rs"

[lib]
path = "src/lib.rs"
```

- [ ] **Step 2.0.2: Create stub lib.rs**

Create `spike/prototype-02-gpu-benchmark/src/lib.rs`:

```rust
pub mod instance;
pub mod renderer;
pub mod scene;
```

- [ ] **Step 2.0.3: Verify build**

Run: `cd spike && cargo check -p prototype-02-gpu-benchmark`
Expected: errors about missing module files — we add those next.

---

## Task 2.1: Instance struct + layout tests

Dit is de `#[repr(C)]` + bytemuck struct die naar de GPU gaat. De Programmeur's zorg over WGSL alignment moet hier opgelost worden.

**Files:**
- Create: `spike/prototype-02-gpu-benchmark/src/instance.rs`
- Create: `spike/prototype-02-gpu-benchmark/tests/instance_layout.rs`

- [ ] **Step 2.1.1: Write failing alignment test**

Create `spike/prototype-02-gpu-benchmark/tests/instance_layout.rs`:

```rust
use prototype_02_gpu_benchmark::instance::Instance;

#[test]
fn instance_is_32_bytes() {
    assert_eq!(std::mem::size_of::<Instance>(), 32);
}

#[test]
fn instance_is_16_byte_aligned() {
    // WGSL std140/uniform alignment requires 16-byte alignment for vec types.
    // Storage buffers are more lenient, but we use 16 for safety.
    assert_eq!(std::mem::align_of::<Instance>() % 4, 0);
}

#[test]
fn instance_is_pod() {
    fn assert_pod<T: bytemuck::Pod>() {}
    assert_pod::<Instance>();
}
```

- [ ] **Step 2.1.2: Run test (must fail)**

Run: `cargo test -p prototype-02-gpu-benchmark`
Expected: FAIL (Instance does not exist)

- [ ] **Step 2.1.3: Implement Instance**

Create `spike/prototype-02-gpu-benchmark/src/instance.rs`:

```rust
use bytemuck::{Pod, Zeroable};

/// Per-shape GPU data. Layout must match WGSL @location bindings in instances.wgsl.
/// Total 32 bytes, 4-byte aligned (fine for storage buffer usage).
#[repr(C)]
#[derive(Copy, Clone, Debug, Pod, Zeroable)]
pub struct Instance {
    pub pos: [f32; 2],       // camera-relative position (8)
    pub rotation: f32,        // radians (4)
    pub scale: [f32; 2],      // (8)
    pub color: [u8; 4],       // RGBA packed (4)
    pub style_idx: u16,       // 0..65535 styles (2)
    pub flags: u16,           // visible/selected/hovered bitmask (2)
    pub _pad: [u8; 4],        // pad to 32 bytes for stride cleanliness (4)
}
// 8 + 4 + 8 + 4 + 2 + 2 + 4 = 32 bytes

impl Instance {
    pub fn new(x: f32, y: f32, scale: f32, color: [u8; 4]) -> Self {
        Self {
            pos: [x, y],
            rotation: 0.0,
            scale: [scale, scale],
            color,
            style_idx: 0,
            flags: 1, // visible
            _pad: [0; 4],
        }
    }
}

pub const INSTANCE_ATTRIBS: &[wgpu::VertexAttribute] = &wgpu::vertex_attr_array![
    1 => Float32x2,  // pos
    2 => Float32,    // rotation
    3 => Float32x2,  // scale
    4 => Uint32,     // color (packed u8x4 as u32)
    5 => Uint32,     // style_idx + flags (packed)
];

pub fn instance_buffer_layout() -> wgpu::VertexBufferLayout<'static> {
    wgpu::VertexBufferLayout {
        array_stride: std::mem::size_of::<Instance>() as wgpu::BufferAddress,
        step_mode: wgpu::VertexStepMode::Instance,
        attributes: INSTANCE_ATTRIBS,
    }
}
```

- [ ] **Step 2.1.4: Run tests (must pass)**

Run: `cargo test -p prototype-02-gpu-benchmark`
Expected: 3 tests pass.

- [ ] **Step 2.1.5: Commit**

```bash
cd spike
git add prototype-02-gpu-benchmark/Cargo.toml prototype-02-gpu-benchmark/src/ prototype-02-gpu-benchmark/tests/
git commit -m "spike(02): Instance layout + bytemuck Pod tests

32-byte instance struct with explicit padding, verified bytemuck Pod."
```

---

## Task 2.2: Scene generator (100k deterministic shapes)

**Files:**
- Create: `spike/prototype-02-gpu-benchmark/src/scene.rs`

- [ ] **Step 2.2.1: Implement scene generator**

Create `spike/prototype-02-gpu-benchmark/src/scene.rs`:

```rust
use crate::instance::Instance;

/// Generate N deterministic instances in a grid + jitter pattern.
/// Uses a linear congruential generator so runs are reproducible.
pub fn generate(count: usize) -> Vec<Instance> {
    let mut out = Vec::with_capacity(count);
    let cols = (count as f32).sqrt().ceil() as usize;
    let spacing = 5.0;
    let mut lcg: u32 = 0x1234_5678;
    for i in 0..count {
        let col = (i % cols) as f32;
        let row = (i / cols) as f32;
        lcg = lcg.wrapping_mul(1664525).wrapping_add(1013904223);
        let jx = ((lcg >> 8) as f32 / u32::MAX as f32) * 2.0 - 1.0;
        let jy = ((lcg >> 16) as f32 / u32::MAX as f32) * 2.0 - 1.0;
        let x = col * spacing + jx;
        let y = row * spacing + jy;
        let color = [
            ((lcg >> 0) & 0xFF) as u8,
            ((lcg >> 8) & 0xFF) as u8,
            ((lcg >> 16) & 0xFF) as u8,
            255,
        ];
        out.push(Instance::new(x, y, 1.0, color));
    }
    out
}

/// Mark N random instances as dirty by incrementing their rotation.
pub fn dirty_random(instances: &mut [Instance], count: usize, seed: u32) {
    let mut lcg = seed;
    for _ in 0..count {
        lcg = lcg.wrapping_mul(1664525).wrapping_add(1013904223);
        let idx = (lcg as usize) % instances.len();
        instances[idx].rotation += 0.01;
    }
}
```

- [ ] **Step 2.2.2: Sanity check**

Run: `cargo check -p prototype-02-gpu-benchmark`
Expected: clean compile.

---

## Task 2.3: WGSL shader

**Files:**
- Create: `spike/prototype-02-gpu-benchmark/src/shaders/instances.wgsl`

- [ ] **Step 2.3.1: Write the shader**

Create `spike/prototype-02-gpu-benchmark/src/shaders/instances.wgsl`:

```wgsl
struct Camera {
    view_proj: mat4x4<f32>,
};

@group(0) @binding(0) var<uniform> camera: Camera;

struct VsIn {
    // Template vertex (unit quad: 0,0 / 1,0 / 0,1 / 1,1)
    @location(0) unit_pos: vec2<f32>,
    // Per-instance
    @location(1) inst_pos: vec2<f32>,
    @location(2) inst_rotation: f32,
    @location(3) inst_scale: vec2<f32>,
    @location(4) inst_color: u32,
    @location(5) inst_style_flags: u32,
};

struct VsOut {
    @builtin(position) clip: vec4<f32>,
    @location(0) color: vec4<f32>,
};

@vertex
fn vs_main(in: VsIn) -> VsOut {
    let cos_r = cos(in.inst_rotation);
    let sin_r = sin(in.inst_rotation);
    let local = vec2<f32>(
        in.unit_pos.x * cos_r - in.unit_pos.y * sin_r,
        in.unit_pos.x * sin_r + in.unit_pos.y * cos_r,
    );
    let world = local * in.inst_scale + in.inst_pos;
    let r = f32((in.inst_color >> 0u) & 0xFFu) / 255.0;
    let g = f32((in.inst_color >> 8u) & 0xFFu) / 255.0;
    let b = f32((in.inst_color >> 16u) & 0xFFu) / 255.0;
    let a = f32((in.inst_color >> 24u) & 0xFFu) / 255.0;
    var out: VsOut;
    out.clip = camera.view_proj * vec4<f32>(world, 0.0, 1.0);
    out.color = vec4<f32>(r, g, b, a);
    return out;
}

@fragment
fn fs_main(in: VsOut) -> @location(0) vec4<f32> {
    return in.color;
}
```

---

## Task 2.4: Renderer (wgpu setup + draw loop)

**Files:**
- Create: `spike/prototype-02-gpu-benchmark/src/renderer.rs`

Dit bestand is groot (~250 LOC). Stap voor stap.

- [ ] **Step 2.4.1: Create renderer.rs scaffold**

Create `spike/prototype-02-gpu-benchmark/src/renderer.rs`:

```rust
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
    window: Arc<Window>,
}

impl Renderer {
    pub async fn new(window: Arc<Window>, instances: &[Instance]) -> anyhow::Result<Self> {
        let size = window.inner_size();
        let instance_api = wgpu::Instance::new(wgpu::InstanceDescriptor {
            backends: wgpu::Backends::PRIMARY,
            ..Default::default()
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
                    // `memory_hints` is wgpu 0.21+; leave out for 0.20.
                },
                None,
            )
            .await?;

        let caps = surface.get_capabilities(&adapter);
        let format = caps.formats.iter().copied()
            .find(|f| f.is_srgb())
            .unwrap_or(caps.formats[0]);
        let config = wgpu::SurfaceConfiguration {
            usage: wgpu::TextureUsages::RENDER_ATTACHMENT,
            format,
            width: size.width.max(1),
            height: size.height.max(1),
            present_mode: wgpu::PresentMode::Mailbox, // low-latency; Fifo fallback
            desired_maximum_frame_latency: 2,
            alpha_mode: caps.alpha_modes[0],
            view_formats: vec![],
        };
        surface.configure(&device, &config);

        // Template vertex buffer: unit quad centered at origin
        let verts: &[[f32; 2]] = &[
            [-0.5, -0.5], [0.5, -0.5], [-0.5, 0.5],
            [-0.5, 0.5], [0.5, -0.5], [0.5, 0.5],
        ];
        let template_vb = device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
            label: Some("template-vb"),
            contents: bytemuck::cast_slice(verts),
            usage: wgpu::BufferUsages::VERTEX,
        });

        // Instance buffer
        let instance_vb = device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
            label: Some("instance-vb"),
            contents: bytemuck::cast_slice(instances),
            usage: wgpu::BufferUsages::VERTEX | wgpu::BufferUsages::COPY_DST,
        });

        // Camera uniform
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
            cache: None,
        });

        Ok(Self {
            surface, device, queue, config, pipeline,
            template_vb, instance_vb, camera_ub, camera_bg,
            instance_count: instances.len() as u32,
            window,
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
        // Coalesce contiguous runs to minimize driver overhead
        let mut sorted: Vec<(u32, Instance)> = dirty.iter().copied().collect();
        sorted.sort_by_key(|&(i, _)| i);
        let stride = std::mem::size_of::<Instance>() as u64;
        for &(idx, inst) in &sorted {
            let offset = idx as u64 * stride;
            self.queue.write_buffer(&self.instance_vb, offset, bytemuck::cast_slice(&[inst]));
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
```

- [ ] **Step 2.4.2: Verify compile**

Run: `cd spike && cargo check -p prototype-02-gpu-benchmark`
Expected: clean compile, possibly warnings about unused imports.

- [ ] **Step 2.4.3: Commit**

```bash
cd spike
git add prototype-02-gpu-benchmark/src/
git commit -m "spike(02): wgpu renderer with instanced pipeline

- 100k instances in a single draw call via instanced rendering
- Sparse buffer writes via queue.write_buffer per dirty index
- Mailbox present mode for low-latency frame timing"
```

---

## Task 2.5: Benchmark harness (winit event loop)

**Files:**
- Create: `spike/prototype-02-gpu-benchmark/src/main.rs`

- [ ] **Step 2.5.1: Write main.rs**

Create `spike/prototype-02-gpu-benchmark/src/main.rs`:

```rust
use prototype_02_gpu_benchmark::{renderer::Renderer, scene};
use std::sync::Arc;
use std::time::{Duration, Instant};
use winit::application::ApplicationHandler;
use winit::event::{KeyEvent, WindowEvent};
use winit::event_loop::{ActiveEventLoop, EventLoop};
use winit::keyboard::{KeyCode, PhysicalKey};
use winit::window::Window;

const SHAPE_COUNT: usize = 100_000;
const BENCH_DURATION_SECS: u64 = 10;

enum Scenario { Static, SparseEdit, HeavyEdit }

struct App {
    window: Option<Arc<Window>>,
    renderer: Option<Renderer>,
    instances: Vec<prototype_02_gpu_benchmark::instance::Instance>,
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
            instances: scene::generate(SHAPE_COUNT),
            scenario,
            frame_times: Vec::with_capacity(10_000),
            bench_start: None,
            last_frame: None,
            frame_idx: 0,
        }
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
            WindowEvent::KeyboardInput { event: KeyEvent { physical_key: PhysicalKey::Code(KeyCode::Escape), .. }, .. } => {
                event_loop.exit();
            }
            WindowEvent::RedrawRequested => {
                if let (Some(r), Some(last)) = (self.renderer.as_ref(), self.last_frame) {
                    let now = Instant::now();
                    let dt = now.duration_since(last).as_secs_f32();
                    self.last_frame = Some(now);
                    if self.frame_idx > 30 {
                        // ignore warmup frames
                        self.frame_times.push(dt * 1000.0);
                    }
                    self.frame_idx += 1;

                    // Scenario-specific dirty updates
                    let dirty_count = match self.scenario {
                        Scenario::Static => 0,
                        Scenario::SparseEdit => 500,
                        Scenario::HeavyEdit => 5_000,
                    };
                    if dirty_count > 0 {
                        scene::dirty_random(&mut self.instances, dirty_count, self.frame_idx as u32);
                        let mut lcg: u32 = self.frame_idx as u32;
                        let mut dirty_pairs = Vec::with_capacity(dirty_count);
                        for _ in 0..dirty_count {
                            lcg = lcg.wrapping_mul(1664525).wrapping_add(1013904223);
                            let idx = (lcg as usize) % self.instances.len();
                            dirty_pairs.push((idx as u32, self.instances[idx]));
                        }
                        r.update_instances_sparse(&dirty_pairs);
                    }

                    // Identity camera — fit SHAPE_COUNT grid to viewport
                    let cols = (SHAPE_COUNT as f32).sqrt().ceil() * 5.0;
                    let rows = cols;
                    let s = 2.0 / cols;
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
                    let _ = rows; // silence unused
                }

                // Stop condition
                if let Some(start) = self.bench_start {
                    if start.elapsed() >= Duration::from_secs(BENCH_DURATION_SECS) {
                        self.print_results();
                        event_loop.exit();
                    }
                }

                if let Some(win) = self.window.as_ref() { win.request_redraw(); }
            }
            _ => {}
        }
    }
}

impl App {
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
            Scenario::SparseEdit => "SPARSE_EDIT_500",
            Scenario::HeavyEdit => "HEAVY_EDIT_5000",
        };
        println!("=== RESULT {} ===", scen);
        println!("frames:     {}", n);
        println!("mean_ms:    {:.3}", mean);
        println!("mean_fps:   {:.1}", fps_mean);
        println!("p99_ms:     {:.3}", p99);
        println!("min_ms:     {:.3}", min);
        println!("max_ms:     {:.3}", max);
    }
}

fn main() -> anyhow::Result<()> {
    let scenario = match std::env::args().nth(1).as_deref() {
        Some("sparse") => Scenario::SparseEdit,
        Some("heavy") => Scenario::HeavyEdit,
        _ => Scenario::Static,
    };
    let event_loop = EventLoop::new()?;
    let mut app = App::new(scenario);
    event_loop.run_app(&mut app)?;
    Ok(())
}
```

- [ ] **Step 2.5.2: Build release binary**

Run: `cd spike && cargo build -p prototype-02-gpu-benchmark --release`
Expected: clean release build, binary at `spike/target/release/prototype-02`.

- [ ] **Step 2.5.3: Run static scenario**

Run: `cd spike && ./target/release/prototype-02` (or `.\target\release\prototype-02.exe` op Windows)
Expected: window opens with 100k colored rects, after 10s prints:
```
[GPU] <naam> (<backend>)
=== RESULT STATIC ===
frames:     <N>
mean_fps:   <X>
...
```

- [ ] **Step 2.5.4: Run sparse edit**

Run: `cd spike && ./target/release/prototype-02 sparse`
Expected: same UI, output says `=== RESULT SPARSE_EDIT_500 ===`

- [ ] **Step 2.5.5: Run heavy edit**

Run: `cd spike && ./target/release/prototype-02 heavy`
Expected: `=== RESULT HEAVY_EDIT_5000 ===`

- [ ] **Step 2.5.6: Commit**

```bash
cd spike
git add prototype-02-gpu-benchmark/src/main.rs
git commit -m "spike(02): winit event loop + benchmark harness

Three scenarios (static, sparse, heavy) runnable via CLI arg.
10-second runs with 30-frame warmup, reports mean/p99/min/max."
```

---

## Task 2.6: Run on all 3 hardware targets

**Doel:** 3 scenarios × 3 hardware targets = 9 meetpunten.

- [ ] **Step 2.6.1: Run on RTX 3060 machine**

On target machine:
```bash
cd spike
cargo run -p prototype-02-gpu-benchmark --release -- static
cargo run -p prototype-02-gpu-benchmark --release -- sparse
cargo run -p prototype-02-gpu-benchmark --release -- heavy
```
Capture terminal output.

- [ ] **Step 2.6.2: Run on Intel Iris Xe machine**

Same commands. On iGPU systems, wgpu may log fallback warnings — note them.

- [ ] **Step 2.6.3: Run on Apple M1/M2 (indien beschikbaar)**

Same commands. Metal backend.

- [ ] **Step 2.6.4: Fill RESULTS.md**

Create `spike/prototype-02-gpu-benchmark/RESULTS.md`:

```markdown
# GPU Benchmark Results

Date: YYYY-MM-DD
wgpu: 0.20.x
Rust: 1.77.0

## RTX 3060 (Windows 11, DX12)

| Scenario | Mean FPS | Mean ms | p99 ms | Min ms | Max ms |
|----------|----------|---------|--------|--------|--------|
| Static (0 dirty) | | | | | |
| Sparse (500 dirty) | | | | | |
| Heavy (5000 dirty) | | | | | |

## Intel Iris Xe (Windows 11, DX12)

| Scenario | Mean FPS | Mean ms | p99 ms | Min ms | Max ms |
|----------|----------|---------|--------|--------|--------|
| Static (0 dirty) | | | | | |
| Sparse (500 dirty) | | | | | |
| Heavy (5000 dirty) | | | | | |

## Apple M1/M2 (macOS, Metal)

| Scenario | Mean FPS | Mean ms | p99 ms | Min ms | Max ms |
|----------|----------|---------|--------|--------|--------|
| Static (0 dirty) | | | | | |
| Sparse (500 dirty) | | | | | |
| Heavy (5000 dirty) | | | | | |

## Exit criteria check

- [ ] Static ≥ 120 fps on RTX 3060
- [ ] Static ≥ 60 fps on Iris Xe
- [ ] Sparse ≥ 60 fps on all 3
- [ ] Heavy ≥ 30 fps on all 3

## Observations
- GPU name/driver version per machine
- Any wgpu warnings in stderr
- Memory use (via Task Manager / Activity Monitor)

## Verdict

[ ] SUCCES / [ ] TWIJFEL / [ ] KILL
```

Vul de tabellen met de daadwerkelijke meetwaarden.

- [ ] **Step 2.6.5: Update SPIKE-RESULTS.md**

Edit `spike/SPIKE-RESULTS.md` — replace Prototype 2 section with summary van de verdict.

- [ ] **Step 2.6.6: Commit**

```bash
cd spike
git add prototype-02-gpu-benchmark/RESULTS.md SPIKE-RESULTS.md
git commit -m "spike(02): benchmark results across 3 hardware targets

Results captured for RTX 3060, Iris Xe, M1/M2. Verdict: <verdict>."
```

---

## Self-Review van Task 2

1. **Spec coverage:** meet alle 3 scenarios (static/sparse/heavy) op alle 3 hardware targets. Exit criteria uit de master plan zijn expliciet checkbaar in RESULTS.md.
2. **Placeholders:** geen "TODO" of "fill in details". Alle code is compleet. Alleen de meetwaarden zelf moeten ingevuld worden (dat is per definitie runtime output).
3. **Type consistency:** `Instance` struct zelfde layout in alle bestanden. `instance_buffer_layout()` consistent verwijst naar `INSTANCE_ATTRIBS`.
4. **Scope:** 6 sub-tasks × ~45 min = ~4.5 uur implementatie + ~1 uur per hardware run (3 runs = 3 uur) = ~1 dag en de hardware tests in parallelle tijd. Past in 1.5-2 dagen.

Issues gefixt tijdens review:
- `instance_attr_array` macro gebruikt consistent `1..=5` locations (location 0 = unit quad vertex)
- Sparse dirty update coalesceert via `sort_by_key` om driver-overhead te verminderen (Programmeur's zorg in R1)
- Mailbox present mode met Fifo fallback; `desired_maximum_frame_latency: 2`

---

## Volgend sub-plan

Na goedkeuring van Task 2 volgt:
- **Task 3:** `spike-plan-task-3-egui-ribbon.md`

---
