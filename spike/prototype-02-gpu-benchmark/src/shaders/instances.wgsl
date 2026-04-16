struct Camera {
    view_proj: mat4x4<f32>,
};

@group(0) @binding(0) var<uniform> camera: Camera;

struct VsIn {
    @location(0) unit_pos: vec2<f32>,
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
    let rotated = vec2<f32>(
        in.unit_pos.x * cos_r - in.unit_pos.y * sin_r,
        in.unit_pos.x * sin_r + in.unit_pos.y * cos_r,
    );
    let world = rotated * in.inst_scale + in.inst_pos;
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
