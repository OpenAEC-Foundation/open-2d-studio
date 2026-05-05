//! headless_render — offscreen wgpu rasterizer for DWG/DXF files.
//!
//! Loads geometry via the same shared loaders that split_compare uses
//! (kernel_app::scene_io), tessellates to line segments, auto-fits an ortho
//! camera to the scene bbox + 5% margin, renders to an RGBA8 texture in a
//! HEADLESS wgpu device (no winit window, no surface), reads back pixels
//! via a staging buffer, and writes a PNG.
//!
//! Usage: headless_render <input.dwg|.dxf> <output.png> [--width=2048 --height=2048]

use bytemuck::{Pod, Zeroable};
use std::path::Path;

// Scene / Segment / load_dxf / load_dwg are shared with split_compare.rs
// via kernel_app::scene_io. The shared loader has full INSERT-block
// expansion + HATCH boundary tessellation, which the previous inline
// copy here lacked — that gap was responsible for the AC1024 pixel-diff
// regression versus the GUI viewer.
use kernel_app::scene_io::{load_dwg, load_dxf, Scene};


// =============================================================================
// Headless wgpu rendering
// =============================================================================

#[repr(C)]
#[derive(Copy, Clone, Pod, Zeroable)]
struct Vertex { pos: [f32; 2], color: u32, _pad: u32 }

#[repr(C)]
#[derive(Copy, Clone, Pod, Zeroable)]
struct CameraUbo { view_proj: [[f32; 4]; 4] }

// Shader ported from split_compare.rs LINE_WGSL so the CLI renderer
// respects per-entity ACI/true-color (stored in Segment.color by
// scene_io::tessellate_dxf_entity). Previously this binary hard-coded
// a single green output fragment — fine as a "show the geometry"
// smoke test but useless for verifying that the DXF colour pipeline
// actually reaches the GPU.
const SHADER_WGSL: &str = r#"
struct Cam { view_proj: mat4x4<f32> };
@group(0) @binding(0) var<uniform> cam: Cam;
struct VIn { @location(0) pos: vec2<f32>, @location(1) color: u32 };
struct VOut { @builtin(position) clip: vec4<f32>, @location(0) color: vec4<f32> };
fn unpack(c: u32) -> vec4<f32> {
    let r = f32((c >> 0u) & 0xFFu) / 255.0;
    let g = f32((c >> 8u) & 0xFFu) / 255.0;
    let b = f32((c >> 16u) & 0xFFu) / 255.0;
    let a = f32((c >> 24u) & 0xFFu) / 255.0;
    return vec4<f32>(r, g, b, a);
}
@vertex fn vs_main(v: VIn) -> VOut {
    var o: VOut;
    o.clip = cam.view_proj * vec4<f32>(v.pos, 0.0, 1.0);
    o.color = unpack(v.color);
    return o;
}
@fragment fn fs_main(v: VOut) -> @location(0) vec4<f32> {
    return v.color;
}
"#;

/// Build an ortho view-projection that fits the bbox + 5% margin into [-1,+1] NDC,
/// preserving aspect ratio (so geometry isn't squished when width != height).
fn build_camera(bbox: &[f64; 4], width: u32, height: u32) -> (CameraUbo, [f64; 2]) {
    let cx = (bbox[0] + bbox[2]) * 0.5;
    let cy = (bbox[1] + bbox[3]) * 0.5;
    let w = (bbox[2] - bbox[0]).max(1e-6);
    let h = (bbox[3] - bbox[1]).max(1e-6);

    let target_aspect = width as f64 / height.max(1) as f64;
    let scene_aspect = w / h;
    let (half_w, half_h) = if scene_aspect > target_aspect {
        // scene is wider — fit width
        let half_w = w * 0.5 * 1.05;
        let half_h = half_w / target_aspect;
        (half_w, half_h)
    } else {
        let half_h = h * 0.5 * 1.05;
        let half_w = half_h * target_aspect;
        (half_w, half_h)
    };

    let sx = (1.0 / half_w) as f32;
    let sy = (1.0 / half_h) as f32;
    let ubo = CameraUbo { view_proj: [
        [sx, 0.0, 0.0, 0.0],
        [0.0, sy, 0.0, 0.0],
        [0.0, 0.0, 1.0, 0.0],
        [0.0, 0.0, 0.0, 1.0],
    ]};
    (ubo, [cx, cy])
}

async fn render_to_png(
    scene: &Scene,
    out_path: &str,
    width: u32,
    height: u32,
    want_paper: bool,
    render_bbox: [f64; 4],
) -> anyhow::Result<()> {
    let instance = wgpu::Instance::new(wgpu::InstanceDescriptor {
        backends: wgpu::Backends::PRIMARY,
        ..Default::default()
    });
    let adapter = instance.request_adapter(&wgpu::RequestAdapterOptions {
        power_preference: wgpu::PowerPreference::HighPerformance,
        compatible_surface: None,
        force_fallback_adapter: false,
    }).await.ok_or_else(|| anyhow::anyhow!("no wgpu adapter"))?;
    // Mirror open_2d_studio's big-scene fix (commit dbf900d): the default
    // wgpu::Limits cap max_buffer_size at 256 MB, which crashes
    // create_buffer for the unified scene-vb on 9M-segment DWGs (~284 MB
    // observed on Kerk aan de Haven). Request the adapter's reported max
    // (typically 1-2 GB on modern GPUs); fall back to defaults if the
    // driver refuses.
    let adapter_limits = adapter.limits();
    let default_limits = wgpu::Limits::default();
    let desired_max_buffer = adapter_limits.max_buffer_size
        .max(default_limits.max_buffer_size)
        .max(1_073_741_824);
    let desired_max_storage = adapter_limits.max_storage_buffer_binding_size
        .max(default_limits.max_storage_buffer_binding_size);
    let preferred_limits = wgpu::Limits {
        max_buffer_size: desired_max_buffer,
        max_storage_buffer_binding_size: desired_max_storage,
        ..default_limits.clone()
    };
    let (device, queue) = match adapter.request_device(&wgpu::DeviceDescriptor {
        label: Some("headless_render"),
        required_features: wgpu::Features::empty(),
        required_limits: preferred_limits.clone(),
        memory_hints: wgpu::MemoryHints::Performance,
    }, None).await {
        Ok(pair) => pair,
        Err(e) => {
            eprintln!("[headless_render] elevated GPU limits rejected ({e}); falling back to defaults");
            adapter.request_device(&wgpu::DeviceDescriptor {
                label: Some("headless_render"),
                required_features: wgpu::Features::empty(),
                required_limits: default_limits,
                memory_hints: wgpu::MemoryHints::Performance,
            }, None).await?
        }
    };

    let format = wgpu::TextureFormat::Rgba8UnormSrgb;
    let target_tex = device.create_texture(&wgpu::TextureDescriptor {
        label: Some("offscreen-target"),
        size: wgpu::Extent3d { width, height, depth_or_array_layers: 1 },
        mip_level_count: 1, sample_count: 1,
        dimension: wgpu::TextureDimension::D2,
        format,
        usage: wgpu::TextureUsages::RENDER_ATTACHMENT | wgpu::TextureUsages::COPY_SRC,
        view_formats: &[],
    });
    let target_view = target_tex.create_view(&wgpu::TextureViewDescriptor::default());

    // Build vertex buffer (translate by camera origin so f64 coords fit in f32).
    let (cam_ubo, origin) = build_camera(&render_bbox, width, height);
    let mut verts: Vec<Vertex> = Vec::with_capacity(scene.segments.len() * 2);
    // When Segment.color is 0 ("pane default") we still need a visible
    // colour for the CLI PNG. Use a neutral green — matches what the
    // GUI viewer's DXF pane (TL) shows. Entity-set colours override.
    const DEFAULT_RGBA: u32 = 0xFF50FF50;
    // Render either model-space or paper-space content based on the
    // --paper flag (or default to model). Paper-space includes the
    // sheet frames + viewport rectangles + viewport-projected model
    // content, clipped to the viewport rect.
    for s in scene.segments.iter().filter(|s| s.is_paper == want_paper) {
        let p1 = [(s.p1[0] - origin[0]) as f32, (s.p1[1] - origin[1]) as f32];
        let p2 = [(s.p2[0] - origin[0]) as f32, (s.p2[1] - origin[1]) as f32];
        if !p1[0].is_finite() || !p1[1].is_finite() || !p2[0].is_finite() || !p2[1].is_finite() { continue; }
        let col = if s.color != 0 { s.color } else { DEFAULT_RGBA };
        verts.push(Vertex { pos: p1, color: col, _pad: 0 });
        verts.push(Vertex { pos: p2, color: col, _pad: 0 });
    }
    // Triangle vertices (SOLID + filled HATCH regions). Rendered by a
    // separate pipeline pass before the line pass so outlines stay on
    // top. Same Vertex layout — the shader is polymorphic across
    // LineList and TriangleList topology.
    let mut tri_verts: Vec<Vertex> = Vec::with_capacity(scene.triangles.len() * 3);
    for t in scene.triangles.iter().filter(|t| t.is_paper == want_paper) {
        let v: [[f32; 2]; 3] = [
            [(t.v[0][0] - origin[0]) as f32, (t.v[0][1] - origin[1]) as f32],
            [(t.v[1][0] - origin[0]) as f32, (t.v[1][1] - origin[1]) as f32],
            [(t.v[2][0] - origin[0]) as f32, (t.v[2][1] - origin[1]) as f32],
        ];
        if v.iter().any(|p| !p[0].is_finite() || !p[1].is_finite()) { continue; }
        let col = if t.color != 0 { t.color } else { DEFAULT_RGBA };
        for pos in v { tri_verts.push(Vertex { pos, color: col, _pad: 0 }); }
    }

    let vb = device.create_buffer(&wgpu::BufferDescriptor {
        label: Some("vb"),
        size: ((verts.len().max(1)) * std::mem::size_of::<Vertex>()) as u64,
        usage: wgpu::BufferUsages::VERTEX | wgpu::BufferUsages::COPY_DST,
        mapped_at_creation: false,
    });
    if !verts.is_empty() {
        queue.write_buffer(&vb, 0, bytemuck::cast_slice(&verts));
    }
    let tri_vb = device.create_buffer(&wgpu::BufferDescriptor {
        label: Some("tri-vb"),
        size: ((tri_verts.len().max(1)) * std::mem::size_of::<Vertex>()) as u64,
        usage: wgpu::BufferUsages::VERTEX | wgpu::BufferUsages::COPY_DST,
        mapped_at_creation: false,
    });
    if !tri_verts.is_empty() {
        queue.write_buffer(&tri_vb, 0, bytemuck::cast_slice(&tri_verts));
    }

    let cam_buf = device.create_buffer(&wgpu::BufferDescriptor {
        label: Some("cam"),
        size: std::mem::size_of::<CameraUbo>() as u64,
        usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
        mapped_at_creation: false,
    });
    queue.write_buffer(&cam_buf, 0, bytemuck::cast_slice(&[cam_ubo]));

    let bgl = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
        label: None,
        entries: &[wgpu::BindGroupLayoutEntry {
            binding: 0, visibility: wgpu::ShaderStages::VERTEX,
            ty: wgpu::BindingType::Buffer {
                ty: wgpu::BufferBindingType::Uniform,
                has_dynamic_offset: false, min_binding_size: None,
            },
            count: None,
        }],
    });
    let bg = device.create_bind_group(&wgpu::BindGroupDescriptor {
        label: None, layout: &bgl,
        entries: &[wgpu::BindGroupEntry { binding: 0, resource: cam_buf.as_entire_binding() }],
    });

    let shader = device.create_shader_module(wgpu::ShaderModuleDescriptor {
        label: None, source: wgpu::ShaderSource::Wgsl(SHADER_WGSL.into()),
    });
    let pl_layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
        label: None, bind_group_layouts: &[&bgl], push_constant_ranges: &[],
    });
    let vert_layout = wgpu::VertexBufferLayout {
        array_stride: std::mem::size_of::<Vertex>() as u64,
        step_mode: wgpu::VertexStepMode::Vertex,
        attributes: &wgpu::vertex_attr_array![0 => Float32x2, 1 => Uint32],
    };
    let line_pipeline = device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
        label: Some("line-pipe"), layout: Some(&pl_layout),
        vertex: wgpu::VertexState {
            module: &shader, entry_point: "vs_main",
            buffers: &[vert_layout.clone()],
            compilation_options: Default::default(),
        },
        primitive: wgpu::PrimitiveState {
            topology: wgpu::PrimitiveTopology::LineList,
            ..Default::default()
        },
        depth_stencil: None,
        multisample: wgpu::MultisampleState::default(),
        fragment: Some(wgpu::FragmentState {
            module: &shader, entry_point: "fs_main",
            targets: &[Some(wgpu::ColorTargetState {
                format, blend: Some(wgpu::BlendState::ALPHA_BLENDING),
                write_mask: wgpu::ColorWrites::ALL,
            })],
            compilation_options: Default::default(),
        }),
        multiview: None, cache: None,
    });
    // Second pipeline: same shader but TriangleList topology for SOLID
    // fills. Rendered before the line pass so outlines appear on top.
    let tri_pipeline = device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
        label: Some("tri-pipe"), layout: Some(&pl_layout),
        vertex: wgpu::VertexState {
            module: &shader, entry_point: "vs_main",
            buffers: &[vert_layout],
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
                format, blend: Some(wgpu::BlendState::ALPHA_BLENDING),
                write_mask: wgpu::ColorWrites::ALL,
            })],
            compilation_options: Default::default(),
        }),
        multiview: None, cache: None,
    });

    // Staging buffer must align rows to COPY_BYTES_PER_ROW_ALIGNMENT (256).
    let bytes_per_pixel: u32 = 4;
    let unpadded_bpr = width * bytes_per_pixel;
    let align = wgpu::COPY_BYTES_PER_ROW_ALIGNMENT;
    let padded_bpr = (unpadded_bpr + align - 1) / align * align;
    let staging_size = (padded_bpr * height) as u64;
    let staging = device.create_buffer(&wgpu::BufferDescriptor {
        label: Some("staging"),
        size: staging_size,
        usage: wgpu::BufferUsages::COPY_DST | wgpu::BufferUsages::MAP_READ,
        mapped_at_creation: false,
    });

    let mut encoder = device.create_command_encoder(&wgpu::CommandEncoderDescriptor { label: Some("enc") });
    {
        let mut rpass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
            label: Some("rpass"),
            color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                view: &target_view, resolve_target: None,
                ops: wgpu::Operations {
                    load: wgpu::LoadOp::Clear(wgpu::Color { r: 0.0, g: 0.0, b: 0.0, a: 1.0 }),
                    store: wgpu::StoreOp::Store,
                },
            })],
            depth_stencil_attachment: None, timestamp_writes: None, occlusion_query_set: None,
        });
        // Triangle pass first (fills), then line pass (outlines + text)
        // so outlines render on top.
        if !tri_verts.is_empty() {
            rpass.set_pipeline(&tri_pipeline);
            rpass.set_bind_group(0, &bg, &[]);
            rpass.set_vertex_buffer(0, tri_vb.slice(..));
            rpass.draw(0..tri_verts.len() as u32, 0..1);
        }
        if !verts.is_empty() {
            rpass.set_pipeline(&line_pipeline);
            rpass.set_bind_group(0, &bg, &[]);
            rpass.set_vertex_buffer(0, vb.slice(..));
            rpass.draw(0..verts.len() as u32, 0..1);
        }
    }
    encoder.copy_texture_to_buffer(
        wgpu::ImageCopyTexture {
            texture: &target_tex, mip_level: 0,
            origin: wgpu::Origin3d::ZERO, aspect: wgpu::TextureAspect::All,
        },
        wgpu::ImageCopyBuffer {
            buffer: &staging,
            layout: wgpu::ImageDataLayout {
                offset: 0,
                bytes_per_row: Some(padded_bpr),
                rows_per_image: Some(height),
            },
        },
        wgpu::Extent3d { width, height, depth_or_array_layers: 1 },
    );
    queue.submit(Some(encoder.finish()));

    // Map and read back. wgpu requires polling the device while the map is pending.
    let slice = staging.slice(..);
    let (tx, rx) = std::sync::mpsc::channel();
    slice.map_async(wgpu::MapMode::Read, move |res| {
        let _ = tx.send(res);
    });
    device.poll(wgpu::Maintain::Wait);
    rx.recv().map_err(|e| anyhow::anyhow!("map_async channel: {e}"))??;

    let data = slice.get_mapped_range();
    // Strip row padding into a tight RGBA8 buffer.
    let mut out = vec![0u8; (unpadded_bpr * height) as usize];
    for y in 0..height as usize {
        let src_off = y * padded_bpr as usize;
        let dst_off = y * unpadded_bpr as usize;
        out[dst_off..dst_off + unpadded_bpr as usize]
            .copy_from_slice(&data[src_off..src_off + unpadded_bpr as usize]);
    }
    drop(data);
    staging.unmap();

    image::save_buffer(out_path, &out, width, height, image::ColorType::Rgba8)
        .map_err(|e| anyhow::anyhow!("PNG save: {e}"))?;
    Ok(())
}

// =============================================================================
// Entry
// =============================================================================

fn parse_dim(s: &str, key: &str) -> Option<u32> {
    let prefix = format!("--{}=", key);
    s.strip_prefix(&prefix).and_then(|v| v.parse().ok())
}

fn main() -> anyhow::Result<()> {
    let args: Vec<String> = std::env::args().collect();
    if args.len() < 3 {
        eprintln!("usage: headless_render <input.dwg|.dxf> <output.png> [--width=2048 --height=2048] [--paper] [--layout=Layout1]");
        std::process::exit(2);
    }
    let input = &args[1];
    let output = &args[2];
    let mut width: u32 = 2048;
    let mut height: u32 = 2048;
    let mut want_paper = false;
    let mut layout_name: Option<String> = None;
    for a in &args[3..] {
        if let Some(w) = parse_dim(a, "width") { width = w; }
        else if let Some(h) = parse_dim(a, "height") { height = h; }
        else if a == "--paper" { want_paper = true; }
        else if let Some(rest) = a.strip_prefix("--layout=") {
            layout_name = Some(rest.to_string()); want_paper = true;
        }
    }

    let lower = input.to_lowercase();
    let scene = if lower.ends_with(".dwg") {
        load_dwg(input)?
    } else if lower.ends_with(".dxf") {
        load_dxf(input)?
    } else {
        anyhow::bail!("input must end with .dwg or .dxf");
    };

    eprintln!("[headless_render] count_label: {}", scene.count_label);
    let render_bbox = if want_paper {
        // Paper-space render: fit to the requested layout's bbox, or to
        // the union of all non-Model layouts if no name was given. If
        // none exist, fall back to the full scene bbox.
        let pick = layout_name.as_deref().unwrap_or("Layout1");
        scene.layouts.iter()
            .find(|(n, _)| n.eq_ignore_ascii_case(pick))
            .map(|(_, b)| *b)
            .or_else(|| scene.layouts.iter()
                .find(|(n, _)| !n.eq_ignore_ascii_case("Model"))
                .map(|(_, b)| *b))
            .unwrap_or(scene.bbox)
    } else {
        scene.bbox
    };
    eprintln!("[headless_render] {} -> {} ({}x{}, {} segments, space={}, bbox=[{:.2},{:.2} .. {:.2},{:.2}])",
        Path::new(input).file_name().unwrap().to_string_lossy(),
        Path::new(output).file_name().unwrap().to_string_lossy(),
        width, height, scene.segments.len(),
        if want_paper { "paper" } else { "model" },
        render_bbox[0], render_bbox[1], render_bbox[2], render_bbox[3]);

    pollster::block_on(render_to_png(&scene, output, width, height, want_paper, render_bbox))?;
    Ok(())
}
