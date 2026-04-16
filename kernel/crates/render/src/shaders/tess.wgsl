struct TessUniform {
    view_proj: mat4x4<f32>,
    model_pos: vec2<f32>,
    color: vec4<f32>,
    _pad: vec2<f32>,
};

@group(0) @binding(0) var<uniform> u: TessUniform;

struct VsIn {
    @location(0) pos: vec2<f32>,
};

struct VsOut {
    @builtin(position) clip: vec4<f32>,
};

@vertex
fn vs_main(in: VsIn) -> VsOut {
    let world = in.pos + u.model_pos;
    var out: VsOut;
    out.clip = u.view_proj * vec4<f32>(world, 0.0, 1.0);
    return out;
}

@fragment
fn fs_main(_in: VsOut) -> @location(0) vec4<f32> {
    return u.color;
}
