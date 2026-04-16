struct Camera {
    view_proj: mat4x4<f32>,
};

@group(0) @binding(0) var<uniform> camera: Camera;

struct VsIn {
    // Template vertex (unit quad 1×1 centered at origin)
    @location(0) unit_pos: vec2<f32>,
    // Per-instance
    @location(1) inst_pos: vec2<f32>,
    @location(2) inst_rotation: f32,
    @location(3) inst_scale: vec2<f32>,
    @location(4) inst_color: u32,
    @location(5) inst_style_idx: u32,
    @location(6) inst_flags: u32,
};

struct VsOut {
    @builtin(position) clip: vec4<f32>,
    @location(0) color: vec4<f32>,
    @location(1) flags: u32,
};

const SELECTED_BIT: u32 = 1u;
const HOVERED_BIT: u32 = 2u;

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
    out.flags = in.inst_flags;
    return out;
}

@fragment
fn fs_main(in: VsOut) -> @location(0) vec4<f32> {
    var c = in.color;
    if ((in.flags & SELECTED_BIT) != 0u) {
        // Blend toward blue on selection
        c = mix(c, vec4<f32>(0.0, 0.47, 0.84, 1.0), 0.5);
    } else if ((in.flags & HOVERED_BIT) != 0u) {
        c = mix(c, vec4<f32>(0.0, 0.75, 1.0, 1.0), 0.3);
    }
    return c;
}
