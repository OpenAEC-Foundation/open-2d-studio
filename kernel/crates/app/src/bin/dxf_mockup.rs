//! dxf_viewer — standalone mockup binary.
//!
//! Load a DXF file, render all entities as line segments, pan with middle
//! mouse button, zoom with scroll, click to select the nearest line segment.
//!
//! This is a separate mockup — it does NOT integrate with the ECS kernel
//! yet. Purpose: prove the load/render/pick flow before wiring it into the
//! main app.

use bytemuck::{Pod, Zeroable};
use dxf::entities::{Entity, EntityType, Insert};
use dxf::{Color as DxfColor, Drawing as DxfDrawing};
use egui_wgpu::ScreenDescriptor;
use std::collections::{HashMap, HashSet};
use std::sync::Arc;
use std::time::Instant;
use winit::application::ApplicationHandler;
use winit::event::{ElementState, KeyEvent, MouseButton, MouseScrollDelta, WindowEvent};
use winit::event_loop::{ActiveEventLoop, EventLoop};
use winit::keyboard::{KeyCode, ModifiersState, PhysicalKey};
use winit::window::Window;

// =============================================================================
// Color handling: ACI palette + packed RGBA
// =============================================================================

#[inline]
fn pack_rgba(r: u8, g: u8, b: u8, a: u8) -> u32 {
    // WGSL-side expects bytes in order r,g,b,a from low to high.
    (r as u32) | ((g as u32) << 8) | ((b as u32) << 16) | ((a as u32) << 24)
}

fn hsv_to_rgb(h: f32, s: f32, v: f32) -> [u8; 3] {
    let c = v * s;
    let h6 = (h / 60.0) % 6.0;
    let x = c * (1.0 - (h6 % 2.0 - 1.0).abs());
    let (r, g, b) = match h6 as i32 {
        0 => (c, x, 0.0), 1 => (x, c, 0.0),
        2 => (0.0, c, x), 3 => (0.0, x, c),
        4 => (x, 0.0, c), _ => (c, 0.0, x),
    };
    let m = v - c;
    [((r + m) * 255.0) as u8, ((g + m) * 255.0) as u8, ((b + m) * 255.0) as u8]
}

/// AutoCAD ACI → RGB lookup. Hardcoded for 0-9 and 250-255 (grays);
/// HSV-approximated for 10-249.
fn aci_to_rgb(aci: i16) -> [u8; 3] {
    let i = aci.clamp(0, 255) as u8;
    match i {
        0 => [255, 255, 255],    // 0 = BYBLOCK — shown white on dark bg
        1 => [255, 0, 0],
        2 => [255, 255, 0],
        3 => [0, 255, 0],
        4 => [0, 255, 255],
        5 => [0, 0, 255],
        6 => [255, 0, 255],
        7 => [255, 255, 255],    // 7 = BYLAYER white on dark
        8 => [128, 128, 128],
        9 => [192, 192, 192],
        250 => [51, 51, 51],
        251 => [80, 80, 80],
        252 => [105, 105, 105],
        253 => [130, 130, 130],
        254 => [190, 190, 190],
        255 => [255, 255, 255],
        n => {
            // HSV approximation of the AutoCAD color wheel for 10..=249
            let idx = (n - 10) as u32;
            // 240 slots → 24 hue buckets × 10 luminance variations
            let hue_bucket = idx / 10;                  // 0..23
            let shade = idx % 10;                       // 0..9
            let hue = (hue_bucket as f32) * 15.0;       // 24 × 15° = 360°
            let sat = 1.0 - (shade as f32) * 0.06;
            let val = 0.55 + (shade as f32) * 0.04;
            hsv_to_rgb(hue, sat.clamp(0.2, 1.0), val.clamp(0.3, 1.0))
        }
    }
}

/// Resolve an entity's color: explicit 24-bit override → layer default.
/// Entity ACI index overrides are ignored in this mockup (the 24-bit field
/// and layer-color fallback handle 95% of real drawings).
fn resolve_color(_c: &DxfColor, color_24_bit: i32, layer_color: u32) -> u32 {
    if color_24_bit > 0 {
        let r = ((color_24_bit >> 16) & 0xFF) as u8;
        let g = ((color_24_bit >> 8) & 0xFF) as u8;
        let b = (color_24_bit & 0xFF) as u8;
        return pack_rgba(r, g, b, 255);
    }
    layer_color
}

#[derive(Clone, Debug)]
struct LayerInfo {
    name: String,
    color: u32,       // resolved from ACI / layer's color field
    visible: bool,    // toggled in UI; false → segments are hidden
}

// =============================================================================
// Data model
// =============================================================================

/// World-space line segment. Source-of-truth is f64; we down-convert to f32 at
/// upload time using a camera origin offset (floating-origin rendering).
#[derive(Clone, Copy, Debug)]
struct Segment {
    p1: [f64; 2],
    p2: [f64; 2],
    /// Which source entity did this come from (for picking). Index into
    /// `entities` vec. Multiple segments can share an entity (circles, arcs,
    /// polylines are discretized into many segments).
    entity_idx: u32,
    /// Rendering color (ABGR packed). Separate so we can restore from
    /// selection state without re-resolving layer/ACI.
    color: u32,
}

#[derive(Clone, Debug, PartialEq)]
enum DxfKind {
    Line,
    Circle,
    Arc,
    LwPolyline,
    Polyline,
    Insert,   // expanded block reference (we keep the parent entity too)
    Text,     // TEXT / MTEXT — rendered as bbox rectangle placeholder
    Hatch,    // HATCH boundary
    Dimension,
    Ellipse,
    Spline,
    Point,
    Face3d,   // 3DFACE / SOLID
    Leader,
    Ray,      // semi-infinite line, clipped for render
    Xline,    // infinite line, clipped for render
}

#[derive(Clone, Debug)]
struct DxfEntity {
    kind: DxfKind,
    layer_idx: u32,
    color: u32,           // resolved default color (for restore on deselect)
    bbox: [f64; 4],
    /// For Line entities: index of its single segment in `segments`.
    /// For non-Line entities: u32::MAX.
    primary_segment: u32,
}

struct Scene {
    segments: Vec<Segment>,
    entities: Vec<DxfEntity>,
    layers: Vec<LayerInfo>,
    layer_name_to_idx: HashMap<String, u32>,
    bbox: [f64; 4],
    /// Per-type entity counts. Indices:
    /// 0=line 1=circle 2=arc 3=lwpoly 4=poly 5=insert 6=text 7=hatch 8=solid/face3d
    /// 9=ellipse 10=spline 11=point 12=leader 13=ray 14=xline 15=dimension 16=unsupported
    counts: [usize; 17],
}

/// 2D affine transform used for INSERT block expansion (scale → rotate → translate).
#[derive(Clone, Copy, Debug)]
struct Xform {
    tx: f64, ty: f64,        // translation
    cos: f64, sin: f64,      // rotation cosine/sine
    sx: f64, sy: f64,        // scale
}

impl Xform {
    fn identity() -> Self {
        Self { tx: 0.0, ty: 0.0, cos: 1.0, sin: 0.0, sx: 1.0, sy: 1.0 }
    }
    fn apply(&self, p: [f64; 2]) -> [f64; 2] {
        let (x, y) = (p[0] * self.sx, p[1] * self.sy);
        let xr = x * self.cos - y * self.sin;
        let yr = x * self.sin + y * self.cos;
        [xr + self.tx, yr + self.ty]
    }
    /// Compose two transforms: `self` then `other`.
    fn combine(outer: &Xform, inner: &Xform) -> Xform {
        // Apply inner first, then outer. For simplicity, compose numerically
        // by transforming unit vectors: enough for mockup-level fidelity.
        let e0 = outer.apply(inner.apply([0.0, 0.0]));
        let e1 = outer.apply(inner.apply([1.0, 0.0]));
        let e2 = outer.apply(inner.apply([0.0, 1.0]));
        let ex = [e1[0] - e0[0], e1[1] - e0[1]];
        let ey = [e2[0] - e0[0], e2[1] - e0[1]];
        let sx = (ex[0].powi(2) + ex[1].powi(2)).sqrt();
        let sy = (ey[0].powi(2) + ey[1].powi(2)).sqrt();
        let cos = if sx > 1e-12 { ex[0] / sx } else { 1.0 };
        let sin = if sx > 1e-12 { ex[1] / sx } else { 0.0 };
        Xform { tx: e0[0], ty: e0[1], cos, sin, sx, sy }
    }
}

#[inline]
fn expand_bbox(bbox: &mut [f64; 4], x: f64, y: f64) {
    if x < bbox[0] { bbox[0] = x; }
    if y < bbox[1] { bbox[1] = y; }
    if x > bbox[2] { bbox[2] = x; }
    if y > bbox[3] { bbox[3] = y; }
}

struct SceneBuilder {
    segments: Vec<Segment>,
    entities: Vec<DxfEntity>,
    layers: Vec<LayerInfo>,
    layer_name_to_idx: HashMap<String, u32>,
    bbox: [f64; 4],
    counts: [usize; 17],
    block_map: HashMap<String, Vec<Entity>>,
}

impl SceneBuilder {
    fn new() -> Self {
        Self {
            segments: Vec::new(),
            entities: Vec::new(),
            layers: Vec::new(),
            layer_name_to_idx: HashMap::new(),
            bbox: [f64::INFINITY, f64::INFINITY, f64::NEG_INFINITY, f64::NEG_INFINITY],
            counts: [0usize; 17],
            block_map: HashMap::new(),
        }
    }

    fn layer_idx_for(&mut self, name: &str) -> u32 {
        if let Some(&i) = self.layer_name_to_idx.get(name) { return i; }
        let i = self.layers.len() as u32;
        self.layers.push(LayerInfo {
            name: name.to_string(),
            color: pack_rgba(255, 255, 255, 255),
            visible: true,
        });
        self.layer_name_to_idx.insert(name.to_string(), i);
        i
    }

    fn push_seg(&mut self, p1: [f64; 2], p2: [f64; 2], entity_idx: u32, color: u32) {
        // Reject NaN/infinity segments; keep everything else. The bbox
        // auto-fit is capped separately in build().
        for c in [p1[0], p1[1], p2[0], p2[1]] {
            if !c.is_finite() { return; }
        }
        // Only segments within a reasonable range contribute to the auto-fit
        // bbox. Realistic CAD drawings stay under ±10 km; anything past ±1e7
        // (=10,000 km) is almost certainly a decode drift from a partially
        // supported DWG entity and would otherwise hijack the auto-fit.
        const BBOX_LIMIT: f64 = 1.0e7;
        let in_range = p1[0].abs() < BBOX_LIMIT && p1[1].abs() < BBOX_LIMIT
            && p2[0].abs() < BBOX_LIMIT && p2[1].abs() < BBOX_LIMIT;
        self.segments.push(Segment { p1, p2, entity_idx, color });
        if in_range {
            expand_bbox(&mut self.bbox, p1[0], p1[1]);
            expand_bbox(&mut self.bbox, p2[0], p2[1]);
        }
    }

    /// Process a single entity. `xform` maps the entity's local space to world space
    /// (identity for top-level entities; set by INSERT when expanding blocks).
    fn add_entity(&mut self, entity: &Entity, xform: &Xform, depth: u32) {
        let layer_name = &entity.common.layer;
        let layer_idx = self.layer_idx_for(layer_name);
        let layer_color = self.layers[layer_idx as usize].color;
        let color = resolve_color(&entity.common.color, entity.common.color_24_bit as i32, layer_color);

        match &entity.specific {
            EntityType::Line(l) => {
                let eidx = self.entities.len() as u32;
                let seg_idx = self.segments.len() as u32;
                let p1 = xform.apply([l.p1.x, l.p1.y]);
                let p2 = xform.apply([l.p2.x, l.p2.y]);
                self.push_seg(p1, p2, eidx, color);
                let eb = [p1[0].min(p2[0]), p1[1].min(p2[1]),
                          p1[0].max(p2[0]), p1[1].max(p2[1])];
                self.entities.push(DxfEntity {
                    kind: DxfKind::Line, layer_idx, color,
                    bbox: eb, primary_segment: seg_idx,
                });
                self.counts[0] += 1;
            }
            EntityType::Circle(c) => {
                let eidx = self.entities.len() as u32;
                let r = c.radius;
                const N: usize = 64;
                let mut prev = xform.apply([c.center.x + r, c.center.y]);
                let mut eb = [prev[0], prev[1], prev[0], prev[1]];
                for i in 1..=N {
                    let a = (i as f64) / (N as f64) * std::f64::consts::TAU;
                    let cur = xform.apply([c.center.x + r * a.cos(), c.center.y + r * a.sin()]);
                    expand_bbox(&mut eb, cur[0], cur[1]);
                    self.push_seg(prev, cur, eidx, color);
                    prev = cur;
                }
                self.entities.push(DxfEntity {
                    kind: DxfKind::Circle, layer_idx, color,
                    bbox: eb, primary_segment: u32::MAX,
                });
                self.counts[1] += 1;
            }
            EntityType::Arc(a) => {
                let eidx = self.entities.len() as u32;
                let r = a.radius;
                let s = a.start_angle.to_radians();
                let e = a.end_angle.to_radians();
                let mut e2 = e;
                if e2 < s { e2 += std::f64::consts::TAU; }
                let sweep = e2 - s;
                let n = ((sweep / std::f64::consts::TAU * 64.0).ceil() as usize).max(4);
                let first = xform.apply([a.center.x + r * s.cos(), a.center.y + r * s.sin()]);
                let mut prev = first;
                let mut eb = [prev[0], prev[1], prev[0], prev[1]];
                for i in 1..=n {
                    let t = s + sweep * (i as f64) / (n as f64);
                    let cur = xform.apply([a.center.x + r * t.cos(), a.center.y + r * t.sin()]);
                    expand_bbox(&mut eb, cur[0], cur[1]);
                    self.push_seg(prev, cur, eidx, color);
                    prev = cur;
                }
                self.entities.push(DxfEntity {
                    kind: DxfKind::Arc, layer_idx, color,
                    bbox: eb, primary_segment: u32::MAX,
                });
                self.counts[2] += 1;
            }
            EntityType::LwPolyline(pl) => {
                let eidx = self.entities.len() as u32;
                let verts: Vec<[f64; 2]> = pl.vertices.iter()
                    .map(|v| xform.apply([v.x, v.y])).collect();
                if verts.is_empty() { self.counts[16] += 1; return; }
                let mut eb = [verts[0][0], verts[0][1], verts[0][0], verts[0][1]];
                for v in &verts { expand_bbox(&mut eb, v[0], v[1]); }
                for w in verts.windows(2) {
                    self.push_seg(w[0], w[1], eidx, color);
                }
                if pl.get_is_closed() && verts.len() > 2 {
                    self.push_seg(*verts.last().unwrap(), verts[0], eidx, color);
                }
                self.entities.push(DxfEntity {
                    kind: DxfKind::LwPolyline, layer_idx, color,
                    bbox: eb, primary_segment: u32::MAX,
                });
                self.counts[3] += 1;
            }
            EntityType::Polyline(pl) => {
                let eidx = self.entities.len() as u32;
                let verts: Vec<[f64; 2]> = pl.vertices()
                    .map(|v| xform.apply([v.location.x, v.location.y])).collect();
                if verts.is_empty() { self.counts[16] += 1; return; }
                let mut eb = [verts[0][0], verts[0][1], verts[0][0], verts[0][1]];
                for v in &verts { expand_bbox(&mut eb, v[0], v[1]); }
                for w in verts.windows(2) {
                    self.push_seg(w[0], w[1], eidx, color);
                }
                if pl.get_is_closed() && verts.len() > 2 {
                    self.push_seg(*verts.last().unwrap(), verts[0], eidx, color);
                }
                self.entities.push(DxfEntity {
                    kind: DxfKind::Polyline, layer_idx, color,
                    bbox: eb, primary_segment: u32::MAX,
                });
                self.counts[4] += 1;
            }
            EntityType::Insert(ins) => {
                self.expand_insert(ins, xform, depth);
            }
            EntityType::Text(t) => {
                // Placeholder: draw a 4-line bbox where the text is positioned.
                // Width estimated from string length × height × 0.6.
                let eidx = self.entities.len() as u32;
                let h = t.text_height.max(0.1);
                let w = (t.value.len() as f64) * h * 0.6;
                let p = xform.apply([t.location.x, t.location.y]);
                let p2 = xform.apply([t.location.x + w, t.location.y]);
                let p3 = xform.apply([t.location.x + w, t.location.y + h]);
                let p4 = xform.apply([t.location.x, t.location.y + h]);
                self.push_seg(p, p2, eidx, color);
                self.push_seg(p2, p3, eidx, color);
                self.push_seg(p3, p4, eidx, color);
                self.push_seg(p4, p, eidx, color);
                let eb = [
                    p[0].min(p2[0]).min(p3[0]).min(p4[0]),
                    p[1].min(p2[1]).min(p3[1]).min(p4[1]),
                    p[0].max(p2[0]).max(p3[0]).max(p4[0]),
                    p[1].max(p2[1]).max(p3[1]).max(p4[1]),
                ];
                self.entities.push(DxfEntity {
                    kind: DxfKind::Text, layer_idx, color,
                    bbox: eb, primary_segment: u32::MAX,
                });
                self.counts[6] += 1;
            }
            EntityType::MText(m) => {
                // Same placeholder treatment as TEXT.
                let eidx = self.entities.len() as u32;
                let h = m.initial_text_height.max(0.1);
                // MText's rectangle_width can be 0 if not set; estimate from text length.
                let w = if m.reference_rectangle_width > 0.0 {
                    m.reference_rectangle_width
                } else {
                    (m.text.len() as f64).max(1.0) * h * 0.6
                };
                let p = xform.apply([m.insertion_point.x, m.insertion_point.y]);
                let p2 = xform.apply([m.insertion_point.x + w, m.insertion_point.y]);
                let p3 = xform.apply([m.insertion_point.x + w, m.insertion_point.y + h]);
                let p4 = xform.apply([m.insertion_point.x, m.insertion_point.y + h]);
                self.push_seg(p, p2, eidx, color);
                self.push_seg(p2, p3, eidx, color);
                self.push_seg(p3, p4, eidx, color);
                self.push_seg(p4, p, eidx, color);
                let eb = [
                    p[0].min(p2[0]).min(p3[0]).min(p4[0]),
                    p[1].min(p2[1]).min(p3[1]).min(p4[1]),
                    p[0].max(p2[0]).max(p3[0]).max(p4[0]),
                    p[1].max(p2[1]).max(p3[1]).max(p4[1]),
                ];
                self.entities.push(DxfEntity {
                    kind: DxfKind::Text, layer_idx, color,
                    bbox: eb, primary_segment: u32::MAX,
                });
                self.counts[6] += 1;
            }
            EntityType::Solid(s) => {
                // SOLID is a (potentially degenerate) quadrilateral. In DXF,
                // the ordering of corners gives an hourglass if you connect
                // a-b-c-d linearly, so we wire a-b, b-d, d-c, c-a to form
                // the filled region outline.
                let eidx = self.entities.len() as u32;
                let a = xform.apply([s.first_corner.x, s.first_corner.y]);
                let b = xform.apply([s.second_corner.x, s.second_corner.y]);
                let c = xform.apply([s.third_corner.x, s.third_corner.y]);
                let d = xform.apply([s.fourth_corner.x, s.fourth_corner.y]);
                self.push_seg(a, b, eidx, color);
                self.push_seg(b, d, eidx, color);
                self.push_seg(d, c, eidx, color);
                self.push_seg(c, a, eidx, color);
                let pts = [a, b, c, d];
                let eb = [
                    pts.iter().map(|p| p[0]).fold(f64::INFINITY, f64::min),
                    pts.iter().map(|p| p[1]).fold(f64::INFINITY, f64::min),
                    pts.iter().map(|p| p[0]).fold(f64::NEG_INFINITY, f64::max),
                    pts.iter().map(|p| p[1]).fold(f64::NEG_INFINITY, f64::max),
                ];
                self.entities.push(DxfEntity {
                    kind: DxfKind::Face3d, layer_idx, color,
                    bbox: eb, primary_segment: u32::MAX,
                });
                self.counts[8] += 1;
            }
            EntityType::Ellipse(el) => {
                // Ellipse is parameterised by center + major-axis vector + minor ratio.
                // Discretize as 96 samples between start_parameter and end_parameter.
                let cx = el.center.x;
                let cy = el.center.y;
                let mx = el.major_axis.x;
                let my = el.major_axis.y;
                let ratio = el.minor_axis_ratio.abs().max(1e-9);
                let s = el.start_parameter;
                let e = el.end_parameter;
                let mut e2 = e;
                if e2 < s { e2 += std::f64::consts::TAU; }
                let sweep = e2 - s;
                let n = ((sweep / std::f64::consts::TAU * 96.0).ceil() as usize).max(8);
                // Perpendicular unit (minor axis direction)
                let px = -my;
                let py = mx;
                let eidx = self.entities.len() as u32;
                let first = [
                    cx + mx * s.cos() + px * ratio * s.sin(),
                    cy + my * s.cos() + py * ratio * s.sin(),
                ];
                let first_world = xform.apply(first);
                let mut prev = first_world;
                let mut eb = [first_world[0], first_world[1], first_world[0], first_world[1]];
                for i in 1..=n {
                    let t = s + sweep * (i as f64) / (n as f64);
                    let pt = [
                        cx + mx * t.cos() + px * ratio * t.sin(),
                        cy + my * t.cos() + py * ratio * t.sin(),
                    ];
                    let cur = xform.apply(pt);
                    expand_bbox(&mut eb, cur[0], cur[1]);
                    self.push_seg(prev, cur, eidx, color);
                    prev = cur;
                }
                self.entities.push(DxfEntity {
                    kind: DxfKind::Ellipse, layer_idx, color,
                    bbox: eb, primary_segment: u32::MAX,
                });
                self.counts[9] += 1;
            }
            EntityType::Spline(sp) => {
                // Render the SPLINE as a polyline through its fit-points if
                // present, otherwise through its control-points. This is an
                // approximation — not a true NURBS evaluation — but gives a
                // visually correct result for most drafting splines.
                let pts: Vec<[f64; 2]> = if !sp.fit_points.is_empty() {
                    sp.fit_points.iter().map(|p| xform.apply([p.x, p.y])).collect()
                } else {
                    sp.control_points.iter().map(|p| xform.apply([p.x, p.y])).collect()
                };
                if pts.len() < 2 {
                    self.counts[16] += 1;
                    return;
                }
                let eidx = self.entities.len() as u32;
                let mut eb = [pts[0][0], pts[0][1], pts[0][0], pts[0][1]];
                for v in &pts { expand_bbox(&mut eb, v[0], v[1]); }
                for w in pts.windows(2) {
                    self.push_seg(w[0], w[1], eidx, color);
                }
                self.entities.push(DxfEntity {
                    kind: DxfKind::Spline, layer_idx, color,
                    bbox: eb, primary_segment: u32::MAX,
                });
                self.counts[10] += 1;
            }
            EntityType::ModelPoint(pt) => {
                // POINT — render as a small + marker in world space. Size is
                // a fixed tiny world-unit amount; this is a mockup so we don't
                // try to scale it with zoom.
                let p = xform.apply([pt.location.x, pt.location.y]);
                let s = 0.5; // small world-unit cross
                let eidx = self.entities.len() as u32;
                self.push_seg([p[0]-s, p[1]], [p[0]+s, p[1]], eidx, color);
                self.push_seg([p[0], p[1]-s], [p[0], p[1]+s], eidx, color);
                self.entities.push(DxfEntity {
                    kind: DxfKind::Point, layer_idx, color,
                    bbox: [p[0]-s, p[1]-s, p[0]+s, p[1]+s],
                    primary_segment: u32::MAX,
                });
                self.counts[11] += 1;
            }
            EntityType::Leader(ld) => {
                // LEADER has a vertex path; optionally an arrow at the start.
                let pts: Vec<[f64; 2]> = ld.vertices.iter()
                    .map(|v| xform.apply([v.x, v.y])).collect();
                if pts.len() < 2 { self.counts[16] += 1; return; }
                let eidx = self.entities.len() as u32;
                let mut eb = [pts[0][0], pts[0][1], pts[0][0], pts[0][1]];
                for v in &pts { expand_bbox(&mut eb, v[0], v[1]); }
                for w in pts.windows(2) {
                    self.push_seg(w[0], w[1], eidx, color);
                }
                self.entities.push(DxfEntity {
                    kind: DxfKind::Leader, layer_idx, color,
                    bbox: eb, primary_segment: u32::MAX,
                });
                self.counts[12] += 1;
            }
            // NOTE: the dxf 0.5 crate does not expose a HATCH variant, so we
            // cannot process it here. Hatches arrive via the `_ => unsupported`
            // fallback. The real kernel will use a dedicated hatch parser.
            EntityType::Ray(r) => {
                // RAY is an infinite half-line starting at `start_point` in
                // direction `unit_direction`. We clip to ±1000 world units for
                // rendering — purely a visual representation.
                let start = xform.apply([r.start_point.x, r.start_point.y]);
                let dir = [r.unit_direction_vector.x, r.unit_direction_vector.y];
                let len = 1.0e5_f64;
                let end = [start[0] + dir[0] * len, start[1] + dir[1] * len];
                let eidx = self.entities.len() as u32;
                self.push_seg(start, end, eidx, color);
                let eb = [start[0].min(end[0]), start[1].min(end[1]),
                          start[0].max(end[0]), start[1].max(end[1])];
                self.entities.push(DxfEntity {
                    kind: DxfKind::Ray, layer_idx, color,
                    bbox: eb, primary_segment: u32::MAX,
                });
                self.counts[13] += 1;
            }
            EntityType::XLine(xl) => {
                // XLINE is infinite in both directions; same clipping approach.
                let center = xform.apply([xl.first_point.x, xl.first_point.y]);
                let dir = [xl.unit_direction_vector.x, xl.unit_direction_vector.y];
                let len = 1.0e5_f64;
                let a = [center[0] - dir[0] * len, center[1] - dir[1] * len];
                let b = [center[0] + dir[0] * len, center[1] + dir[1] * len];
                let eidx = self.entities.len() as u32;
                self.push_seg(a, b, eidx, color);
                let eb = [a[0].min(b[0]), a[1].min(b[1]),
                          a[0].max(b[0]), a[1].max(b[1])];
                self.entities.push(DxfEntity {
                    kind: DxfKind::Xline, layer_idx, color,
                    bbox: eb, primary_segment: u32::MAX,
                });
                self.counts[14] += 1;
            }
            // 3DFACE intentionally dropped — user requested no 3D.
            _ => {
                self.counts[16] += 1;
            }
        }
    }

    fn expand_insert(&mut self, ins: &Insert, outer: &Xform, depth: u32) {
        self.counts[5] += 1;
        if depth > 6 {
            return; // recursion depth cap
        }
        // Collect the block's entities (cloned out of map to drop the borrow,
        // so we can recurse with &mut self).
        let block_entities: Vec<Entity> = match self.block_map.get(&ins.name) {
            Some(v) => v.clone(),
            None => return,
        };
        // Transform: scale → rotate (around 0) → translate to insertion_point.
        let rot = ins.rotation.to_radians();
        let insert_xform = Xform {
            tx: ins.location.x, ty: ins.location.y,
            cos: rot.cos(), sin: rot.sin(),
            sx: if ins.x_scale_factor == 0.0 { 1.0 } else { ins.x_scale_factor },
            sy: if ins.y_scale_factor == 0.0 { 1.0 } else { ins.y_scale_factor },
        };
        let combined = Xform::combine(outer, &insert_xform);
        for sub in &block_entities {
            self.add_entity(sub, &combined, depth + 1);
        }
    }

    fn build(mut self) -> Scene {
        // If no layers were seen, add a default.
        if self.layers.is_empty() {
            self.layers.push(LayerInfo {
                name: "0".into(),
                color: pack_rgba(255, 255, 255, 255),
                visible: true,
            });
        }
        if !self.bbox[0].is_finite() {
            self.bbox = [0.0, 0.0, 1.0, 1.0];
        }
        Scene {
            segments: self.segments,
            entities: self.entities,
            layers: self.layers,
            layer_name_to_idx: self.layer_name_to_idx,
            bbox: self.bbox,
            counts: self.counts,
        }
    }
}

impl Scene {
    /// Empty scene — used as the initial state before any file is opened.
    fn empty() -> Self {
        Self {
            segments: Vec::new(),
            entities: Vec::new(),
            layers: vec![LayerInfo {
                name: "0".to_string(),
                color: 0xFFCCCCCC,
                visible: true,
            }],
            layer_name_to_idx: {
                let mut m = HashMap::new();
                m.insert("0".to_string(), 0);
                m
            },
            bbox: [-100.0, -100.0, 100.0, 100.0],
            counts: [0; 17],
        }
    }

    fn load_auto(path: &str) -> anyhow::Result<Self> {
        let lower = path.to_lowercase();
        if lower.ends_with(".dwg") {
            Self::load_dwg(path)
        } else if lower.ends_with(".dxf") {
            Self::load_dxf(path)
        } else {
            anyhow::bail!("Unsupported file extension (expected .dwg or .dxf): {}", path)
        }
    }

    /// Load a DWG via the vendored `dwg-parser` crate. Only line-like entities
    /// are turned into segments. Block (INSERT) expansion is done by
    /// resolving block-name → owner-handle mapping.
    fn load_dwg(path: &str) -> anyhow::Result<Self> {
        use dwg_parser::DwgParser;
        let t0 = Instant::now();
        let bytes = std::fs::read(path)?;
        let mut parser = DwgParser::new();
        let file = parser.parse(&bytes)
            .map_err(|e| anyhow::anyhow!("DWG parse failed: {:?}", e))?;
        eprintln!("[dwg] version={} objects={}", file.version, file.objects.len());

        // Build a layer map: layer-entity handle → layer name + color.
        // The DWG parser returns layers among objects with type_name == "LAYER".
        let mut layer_by_handle: HashMap<u32, String> = HashMap::new();
        for obj in &file.objects {
            if obj.type_name == "LAYER" {
                if let Some(n) = obj.data.get("name").and_then(|v| v.as_str()) {
                    layer_by_handle.insert(obj.handle, n.to_string());
                }
            }
        }

        let mut b = SceneBuilder::new();

        let getf = |d: &std::collections::HashMap<String, serde_json::Value>, key: &str| -> Option<f64> {
            d.get(key).and_then(|v| v.as_f64())
        };
        // Extract a 2D point from a JSON value that may be:
        //   - an array [x, y] or [x, y, z]
        //   - an object { x: ..., y: ... }
        let get_xy = |v: &serde_json::Value| -> Option<[f64; 2]> {
            if let Some(arr) = v.as_array() {
                let x = arr.get(0)?.as_f64()?;
                let y = arr.get(1)?.as_f64()?;
                Some([x, y])
            } else if let Some(obj) = v.as_object() {
                let x = obj.get("x")?.as_f64()?;
                let y = obj.get("y")?.as_f64()?;
                Some([x, y])
            } else { None }
        };

        // Helper: push segment series for each entity. Since the DWG format
        // uses different key names than DXF, we handle each type manually.
        for obj in &file.objects {
            if !obj.is_entity { continue; }
            let layer_name = obj.handle_refs.layer
                .and_then(|h| layer_by_handle.get(&h).cloned())
                .or_else(|| obj.data.get("layer").and_then(|v| v.as_str().map(|s| s.to_string())))
                .unwrap_or_else(|| "0".to_string());
            let layer_idx = b.layer_idx_for(&layer_name);
            let layer_color = b.layers[layer_idx as usize].color;
            // DWG color index extraction (similar to ACI)
            let color = if let Some(ci) = obj.data.get("color").and_then(|v| v.as_i64()) {
                if ci > 0 && ci < 256 {
                    let [r, g, b_] = aci_to_rgb(ci as i16);
                    pack_rgba(r, g, b_, 255)
                } else { layer_color }
            } else { layer_color };

            let d = &obj.data;
            match obj.type_name.as_str() {
                "LINE" => {
                    // Parser stores "start" and "end" as JSON arrays [x,y,z].
                    // Older code used scalar keys start_x/end_x — both supported.
                    let p1 = d.get("start").and_then(get_xy).unwrap_or_else(|| [
                        getf(d, "start_x").or(getf(d, "x1")).unwrap_or(0.0),
                        getf(d, "start_y").or(getf(d, "y1")).unwrap_or(0.0),
                    ]);
                    let p2 = d.get("end").and_then(get_xy).unwrap_or_else(|| [
                        getf(d, "end_x").or(getf(d, "x2")).unwrap_or(0.0),
                        getf(d, "end_y").or(getf(d, "y2")).unwrap_or(0.0),
                    ]);
                    let eidx = b.entities.len() as u32;
                    let seg_idx = b.segments.len() as u32;
                    b.push_seg(p1, p2, eidx, color);
                    b.entities.push(DxfEntity {
                        kind: DxfKind::Line, layer_idx, color,
                        bbox: [p1[0].min(p2[0]), p1[1].min(p2[1]),
                               p1[0].max(p2[0]), p1[1].max(p2[1])],
                        primary_segment: seg_idx,
                    });
                    b.counts[0] += 1;
                }
                "CIRCLE" => {
                    let ctr = d.get("center").and_then(get_xy).unwrap_or_else(|| [
                        getf(d, "center_x").or(getf(d, "x")).unwrap_or(0.0),
                        getf(d, "center_y").or(getf(d, "y")).unwrap_or(0.0),
                    ]);
                    let cx = ctr[0]; let cy = ctr[1];
                    let r = getf(d, "radius").unwrap_or(1.0);
                    let eidx = b.entities.len() as u32;
                    const N: usize = 64;
                    let mut prev = [cx + r, cy];
                    let mut eb = [prev[0], prev[1], prev[0], prev[1]];
                    for i in 1..=N {
                        let a = (i as f64) / (N as f64) * std::f64::consts::TAU;
                        let cur = [cx + r * a.cos(), cy + r * a.sin()];
                        expand_bbox(&mut eb, cur[0], cur[1]);
                        b.push_seg(prev, cur, eidx, color);
                        prev = cur;
                    }
                    b.entities.push(DxfEntity {
                        kind: DxfKind::Circle, layer_idx, color,
                        bbox: eb, primary_segment: u32::MAX,
                    });
                    b.counts[1] += 1;
                }
                "ARC" => {
                    let ctr = d.get("center").and_then(get_xy).unwrap_or_else(|| [
                        getf(d, "center_x").or(getf(d, "x")).unwrap_or(0.0),
                        getf(d, "center_y").or(getf(d, "y")).unwrap_or(0.0),
                    ]);
                    let cx = ctr[0]; let cy = ctr[1];
                    let r = getf(d, "radius").unwrap_or(1.0);
                    // DWG angles are typically radians already
                    let s = getf(d, "start_angle").unwrap_or(0.0);
                    let e = getf(d, "end_angle").unwrap_or(std::f64::consts::TAU);
                    let mut e2 = e;
                    if e2 < s { e2 += std::f64::consts::TAU; }
                    let sweep = e2 - s;
                    let n = ((sweep / std::f64::consts::TAU * 64.0).ceil() as usize).max(4);
                    let eidx = b.entities.len() as u32;
                    let first = [cx + r * s.cos(), cy + r * s.sin()];
                    let mut prev = first;
                    let mut eb = [first[0], first[1], first[0], first[1]];
                    for i in 1..=n {
                        let t = s + sweep * (i as f64) / (n as f64);
                        let cur = [cx + r * t.cos(), cy + r * t.sin()];
                        expand_bbox(&mut eb, cur[0], cur[1]);
                        b.push_seg(prev, cur, eidx, color);
                        prev = cur;
                    }
                    b.entities.push(DxfEntity {
                        kind: DxfKind::Arc, layer_idx, color,
                        bbox: eb, primary_segment: u32::MAX,
                    });
                    b.counts[2] += 1;
                }
                "POLYLINE_3D" => {
                    // 3D polyline — user explicitly asked to skip 3D.
                    b.counts[16] += 1;
                    continue;
                }
                "LWPOLYLINE" | "POLYLINE" | "POLYLINE_2D" => {
                    const MAX_VERTS: usize = 100_000;
                    let raw = d.get("points").or_else(|| d.get("vertices"));
                    let verts: Vec<[f64; 2]> = match raw {
                        Some(serde_json::Value::Array(arr)) => {
                            arr.iter().take(MAX_VERTS).filter_map(|v| {
                                let x = v.get("x").and_then(|x| x.as_f64())?;
                                let y = v.get("y").and_then(|y| y.as_f64())?;
                                Some([x, y])
                            }).collect()
                        }
                        _ => continue,
                    };
                    if verts.is_empty() { b.counts[16] += 1; continue; }
                    let eidx = b.entities.len() as u32;
                    let mut eb = [verts[0][0], verts[0][1], verts[0][0], verts[0][1]];
                    for v in &verts { expand_bbox(&mut eb, v[0], v[1]); }
                    for w in verts.windows(2) {
                        b.push_seg(w[0], w[1], eidx, color);
                    }
                    let closed = d.get("closed").and_then(|v| v.as_bool())
                        .or_else(|| d.get("is_closed").and_then(|v| v.as_bool()))
                        .unwrap_or(false);
                    if closed && verts.len() > 2 {
                        b.push_seg(*verts.last().unwrap(), verts[0], eidx, color);
                    }
                    let kind = if obj.type_name == "LWPOLYLINE" { DxfKind::LwPolyline } else { DxfKind::Polyline };
                    b.entities.push(DxfEntity {
                        kind, layer_idx, color,
                        bbox: eb, primary_segment: u32::MAX,
                    });
                    if obj.type_name == "LWPOLYLINE" { b.counts[3] += 1; } else { b.counts[4] += 1; }
                }
                "POINT" => {
                    // parser emits "position": [x, y, z]
                    let pos = d.get("position").and_then(get_xy).unwrap_or([0.0, 0.0]);
                    let s = 0.5;
                    let eidx = b.entities.len() as u32;
                    b.push_seg([pos[0]-s, pos[1]], [pos[0]+s, pos[1]], eidx, color);
                    b.push_seg([pos[0], pos[1]-s], [pos[0], pos[1]+s], eidx, color);
                    b.entities.push(DxfEntity {
                        kind: DxfKind::Point, layer_idx, color,
                        bbox: [pos[0]-s, pos[1]-s, pos[0]+s, pos[1]+s],
                        primary_segment: u32::MAX,
                    });
                    b.counts[11] += 1;
                }
                "ELLIPSE" => {
                    let ctr = d.get("center").and_then(get_xy).unwrap_or([0.0, 0.0]);
                    let maj = d.get("majorAxis").and_then(get_xy).unwrap_or([1.0, 0.0]);
                    let ratio = getf(d, "axisRatio").unwrap_or(1.0).abs().max(1e-9);
                    let s = getf(d, "startAngle").unwrap_or(0.0);
                    let e = getf(d, "endAngle").unwrap_or(std::f64::consts::TAU);
                    // Guard against garbage angles that would blow up n.
                    if !s.is_finite() || !e.is_finite() || s.abs() > 1e6 || e.abs() > 1e6 {
                        b.counts[16] += 1; continue;
                    }
                    let mut e2 = e;
                    if e2 < s { e2 += std::f64::consts::TAU; }
                    let sweep = (e2 - s).min(std::f64::consts::TAU * 2.0);
                    let n = ((sweep / std::f64::consts::TAU * 96.0).ceil() as usize).max(8).min(256);
                    // Perpendicular unit = 90° rotated major axis
                    let px = -maj[1]; let py = maj[0];
                    let eidx = b.entities.len() as u32;
                    let first = [
                        ctr[0] + maj[0] * s.cos() + px * ratio * s.sin(),
                        ctr[1] + maj[1] * s.cos() + py * ratio * s.sin(),
                    ];
                    let mut prev = first;
                    let mut eb = [first[0], first[1], first[0], first[1]];
                    for i in 1..=n {
                        let t = s + sweep * (i as f64) / (n as f64);
                        let cur = [
                            ctr[0] + maj[0] * t.cos() + px * ratio * t.sin(),
                            ctr[1] + maj[1] * t.cos() + py * ratio * t.sin(),
                        ];
                        expand_bbox(&mut eb, cur[0], cur[1]);
                        b.push_seg(prev, cur, eidx, color);
                        prev = cur;
                    }
                    b.entities.push(DxfEntity {
                        kind: DxfKind::Ellipse, layer_idx, color,
                        bbox: eb, primary_segment: u32::MAX,
                    });
                    b.counts[9] += 1;
                }
                "SPLINE" => {
                    const MAX_SPLINE_PTS: usize = 10_000;
                    let mut pts: Vec<[f64; 2]> = Vec::new();
                    if let Some(fp) = d.get("fitPoints").and_then(|v| v.as_array()) {
                        for v in fp.iter().take(MAX_SPLINE_PTS) {
                            if let Some(xy) = get_xy(v) { pts.push(xy); }
                        }
                    }
                    if pts.is_empty() {
                        if let Some(cp) = d.get("controlPoints").and_then(|v| v.as_array()) {
                            for v in cp.iter().take(MAX_SPLINE_PTS) {
                                let inner = v.get("point").or(Some(v)).unwrap();
                                if let Some(xy) = get_xy(inner) { pts.push(xy); }
                            }
                        }
                    }
                    if pts.len() < 2 { b.counts[16] += 1; continue; }
                    let eidx = b.entities.len() as u32;
                    let mut eb = [pts[0][0], pts[0][1], pts[0][0], pts[0][1]];
                    for v in &pts { expand_bbox(&mut eb, v[0], v[1]); }
                    for w in pts.windows(2) {
                        b.push_seg(w[0], w[1], eidx, color);
                    }
                    b.entities.push(DxfEntity {
                        kind: DxfKind::Spline, layer_idx, color,
                        bbox: eb, primary_segment: u32::MAX,
                    });
                    b.counts[10] += 1;
                }
                "SOLID" | "TRACE" => {
                    // parser emits point1..point4 as [x,y,z]
                    let p1 = d.get("point1").and_then(get_xy).unwrap_or([0.0, 0.0]);
                    let p2 = d.get("point2").and_then(get_xy).unwrap_or([0.0, 0.0]);
                    let p3 = d.get("point3").and_then(get_xy).unwrap_or([0.0, 0.0]);
                    let p4 = d.get("point4").and_then(get_xy).unwrap_or([0.0, 0.0]);
                    let eidx = b.entities.len() as u32;
                    // SOLID vertex order is (p1, p2, p4, p3) for a quad outline
                    b.push_seg(p1, p2, eidx, color);
                    b.push_seg(p2, p4, eidx, color);
                    b.push_seg(p4, p3, eidx, color);
                    b.push_seg(p3, p1, eidx, color);
                    let pts = [p1, p2, p3, p4];
                    let eb = [
                        pts.iter().map(|p| p[0]).fold(f64::INFINITY, f64::min),
                        pts.iter().map(|p| p[1]).fold(f64::INFINITY, f64::min),
                        pts.iter().map(|p| p[0]).fold(f64::NEG_INFINITY, f64::max),
                        pts.iter().map(|p| p[1]).fold(f64::NEG_INFINITY, f64::max),
                    ];
                    b.entities.push(DxfEntity {
                        kind: DxfKind::Face3d, layer_idx, color,
                        bbox: eb, primary_segment: u32::MAX,
                    });
                    b.counts[8] += 1;
                }
                "RAY" | "XLINE" => {
                    // parser emits "origin": [x,y,z], "direction": [x,y,z]
                    let org = d.get("origin").and_then(get_xy).unwrap_or([0.0, 0.0]);
                    let dir = d.get("direction").and_then(get_xy).unwrap_or([1.0, 0.0]);
                    let len = 1.0e5_f64;
                    let (a, bp, kind, ci) = if obj.type_name == "RAY" {
                        let end = [org[0] + dir[0]*len, org[1] + dir[1]*len];
                        (org, end, DxfKind::Ray, 13usize)
                    } else {
                        let a = [org[0] - dir[0]*len, org[1] - dir[1]*len];
                        let bp = [org[0] + dir[0]*len, org[1] + dir[1]*len];
                        (a, bp, DxfKind::Xline, 14usize)
                    };
                    let eidx = b.entities.len() as u32;
                    b.push_seg(a, bp, eidx, color);
                    let eb = [a[0].min(bp[0]), a[1].min(bp[1]),
                              a[0].max(bp[0]), a[1].max(bp[1])];
                    b.entities.push(DxfEntity {
                        kind, layer_idx, color,
                        bbox: eb, primary_segment: u32::MAX,
                    });
                    b.counts[ci] += 1;
                }
                "LEADER" => {
                    const MAX_LEADER_PTS: usize = 10_000;
                    let pts: Vec<[f64; 2]> = d.get("points").and_then(|v| v.as_array())
                        .map(|arr| arr.iter().take(MAX_LEADER_PTS).filter_map(get_xy).collect())
                        .unwrap_or_default();
                    if pts.len() < 2 { b.counts[16] += 1; continue; }
                    let eidx = b.entities.len() as u32;
                    let mut eb = [pts[0][0], pts[0][1], pts[0][0], pts[0][1]];
                    for v in &pts { expand_bbox(&mut eb, v[0], v[1]); }
                    for w in pts.windows(2) {
                        b.push_seg(w[0], w[1], eidx, color);
                    }
                    b.entities.push(DxfEntity {
                        kind: DxfKind::Leader, layer_idx, color,
                        bbox: eb, primary_segment: u32::MAX,
                    });
                    b.counts[12] += 1;
                }
                "TEXT" | "MTEXT" => {
                    // Parser may store "insertion" as [x,y,z] array or via scalar keys.
                    let ins = d.get("insertion").and_then(get_xy)
                        .or_else(|| d.get("insertion_point").and_then(get_xy))
                        .unwrap_or_else(|| [
                            getf(d, "insertion_x").or(getf(d, "x")).unwrap_or(0.0),
                            getf(d, "insertion_y").or(getf(d, "y")).unwrap_or(0.0),
                        ]);
                    let x = ins[0]; let y = ins[1];
                    let h = getf(d, "height").or(getf(d, "text_height")).unwrap_or(2.5);
                    let txt = d.get("text").or_else(|| d.get("value"))
                        .or_else(|| d.get("content"))
                        .and_then(|v| v.as_str()).unwrap_or("");
                    if txt.is_empty() { b.counts[16] += 1; continue; }
                    let w = (txt.chars().count() as f64) * h * 0.6;
                    let eidx = b.entities.len() as u32;
                    let p  = [x, y];
                    let p2 = [x + w, y];
                    let p3 = [x + w, y + h];
                    let p4 = [x, y + h];
                    b.push_seg(p, p2, eidx, color);
                    b.push_seg(p2, p3, eidx, color);
                    b.push_seg(p3, p4, eidx, color);
                    b.push_seg(p4, p, eidx, color);
                    let eb = [x, y, x + w, y + h];
                    b.entities.push(DxfEntity {
                        kind: DxfKind::Text, layer_idx, color,
                        bbox: eb, primary_segment: u32::MAX,
                    });
                    b.counts[6] += 1;
                }
                _ => {
                    b.counts[16] += 1;
                }
            }
        }

        let scene = b.build();
        eprintln!("[dwg] loaded in {:.1}s — {} segments, {} entities, {} layers",
            t0.elapsed().as_secs_f32(), scene.segments.len(), scene.entities.len(), scene.layers.len());
        eprintln!("[dwg] counts: LINE={} CIRCLE={} ARC={} LWPL={} PL={} INS={} TXT={} HATCH={} SOLID={} ELL={} SPL={} POINT={} LEAD={} RAY={} XLINE={} DIM={} UNS={}",
            scene.counts[0], scene.counts[1], scene.counts[2], scene.counts[3], scene.counts[4],
            scene.counts[5], scene.counts[6], scene.counts[7], scene.counts[8], scene.counts[9],
            scene.counts[10], scene.counts[11], scene.counts[12], scene.counts[13], scene.counts[14],
            scene.counts[15], scene.counts[16]);
        eprintln!("[dwg] bbox: [{:.1},{:.1}] to [{:.1},{:.1}]",
            scene.bbox[0], scene.bbox[1], scene.bbox[2], scene.bbox[3]);
        Ok(scene)
    }

    fn load_dxf(path: &str) -> anyhow::Result<Self> {
        let t0 = Instant::now();
        let drawing = DxfDrawing::load_file(path)?;

        let mut b = SceneBuilder::new();

        // Populate layer table from drawing.layers(). Default color is white;
        // the dxf 0.5 Color enum does not expose ACI via a public method, so
        // we rely on entity-level color_24_bit or fall back to layer-white.
        for layer in drawing.layers() {
            let idx = b.layers.len() as u32;
            b.layers.push(LayerInfo {
                name: layer.name.clone(),
                color: pack_rgba(255, 255, 255, 255),
                visible: true,
            });
            b.layer_name_to_idx.insert(layer.name.clone(), idx);
        }

        // Populate block map (cloned entities keyed by block name)
        for block in drawing.blocks() {
            b.block_map.insert(block.name.clone(), block.entities.clone());
        }

        // Walk top-level entities
        let id = Xform::identity();
        for entity in drawing.entities() {
            b.add_entity(entity, &id, 0);
        }

        let scene = b.build();
        eprintln!("[dxf] loaded in {:.1}s — {} segments, {} entities, {} layers",
            t0.elapsed().as_secs_f32(), scene.segments.len(), scene.entities.len(), scene.layers.len());
        eprintln!("[dxf] counts: LINE={} CIRCLE={} ARC={} LWPL={} PL={} INS={} TXT={} HATCH={} SOLID={} ELL={} SPL={} POINT={} LEAD={} RAY={} XLINE={} DIM={} UNS={}",
            scene.counts[0], scene.counts[1], scene.counts[2], scene.counts[3], scene.counts[4],
            scene.counts[5], scene.counts[6], scene.counts[7], scene.counts[8], scene.counts[9],
            scene.counts[10], scene.counts[11], scene.counts[12], scene.counts[13], scene.counts[14],
            scene.counts[15], scene.counts[16]);
        eprintln!("[dxf] bbox: [{:.1},{:.1}] to [{:.1},{:.1}]",
            scene.bbox[0], scene.bbox[1], scene.bbox[2], scene.bbox[3]);
        Ok(scene)
    }
}

// =============================================================================
// GPU vertex type + Line pipeline
// =============================================================================

#[repr(C)]
#[derive(Copy, Clone, Pod, Zeroable)]
struct Vertex {
    /// camera-relative f32 (floating origin)
    pos: [f32; 2],
    /// packed RGBA
    color: u32,
    _pad: u32,
}

#[repr(C)]
#[derive(Copy, Clone, Pod, Zeroable)]
struct CameraUbo {
    view_proj: [[f32; 4]; 4],
}

struct LinePipeline {
    pipeline: wgpu::RenderPipeline,
    vb: wgpu::Buffer,
    vb_capacity: u32,
    vertex_count: u32,
    camera_ub: wgpu::Buffer,
    camera_bg: wgpu::BindGroup,
}

impl LinePipeline {
    fn new(device: &wgpu::Device, format: wgpu::TextureFormat, capacity: u32) -> Self {
        let vb = device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("line-vb"),
            size: (capacity as u64) * std::mem::size_of::<Vertex>() as u64,
            usage: wgpu::BufferUsages::VERTEX | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });
        let camera_ub = device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("line-camera-ub"),
            size: std::mem::size_of::<CameraUbo>() as u64,
            usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });
        let bgl = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("line-bgl"),
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
            label: Some("line-bg"),
            layout: &bgl,
            entries: &[wgpu::BindGroupEntry {
                binding: 0, resource: camera_ub.as_entire_binding(),
            }],
        });
        let shader = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("line-shader"),
            source: wgpu::ShaderSource::Wgsl(LINE_WGSL.into()),
        });
        let pl_layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some("line-pl"),
            bind_group_layouts: &[&bgl],
            push_constant_ranges: &[],
        });
        let vert_layout = wgpu::VertexBufferLayout {
            array_stride: std::mem::size_of::<Vertex>() as u64,
            step_mode: wgpu::VertexStepMode::Vertex,
            attributes: &wgpu::vertex_attr_array![0 => Float32x2, 1 => Uint32],
        };
        let pipeline = device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
            label: Some("line-pipeline"),
            layout: Some(&pl_layout),
            vertex: wgpu::VertexState {
                module: &shader, entry_point: "vs_main",
                buffers: &[vert_layout],
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
                    format,
                    blend: Some(wgpu::BlendState::ALPHA_BLENDING),
                    write_mask: wgpu::ColorWrites::ALL,
                })],
                compilation_options: Default::default(),
            }),
            multiview: None,
            cache: None,
        });
        Self { pipeline, vb, vb_capacity: capacity, vertex_count: 0, camera_ub, camera_bg }
    }

    fn upload_vertices(&mut self, queue: &wgpu::Queue, verts: &[Vertex]) {
        assert!(verts.len() as u32 <= self.vb_capacity,
            "capacity {} < verts {}", self.vb_capacity, verts.len());
        queue.write_buffer(&self.vb, 0, bytemuck::cast_slice(verts));
        self.vertex_count = verts.len() as u32;
    }

    /// Overwrite a single segment's two vertices at a given segment index.
    fn write_segment(&self, queue: &wgpu::Queue, segment_idx: u32, v0: Vertex, v1: Vertex) {
        let offset = (segment_idx as u64) * 2 * std::mem::size_of::<Vertex>() as u64;
        queue.write_buffer(&self.vb, offset, bytemuck::cast_slice(&[v0, v1]));
    }

    fn update_camera(&self, queue: &wgpu::Queue, cam: CameraUbo) {
        queue.write_buffer(&self.camera_ub, 0, bytemuck::cast_slice(&[cam]));
    }

    fn draw<'a>(&'a self, pass: &mut wgpu::RenderPass<'a>) {
        pass.set_pipeline(&self.pipeline);
        pass.set_bind_group(0, &self.camera_bg, &[]);
        pass.set_vertex_buffer(0, self.vb.slice(..));
        pass.draw(0..self.vertex_count, 0..1);
    }
}

const LINE_WGSL: &str = r#"
struct Cam { view_proj: mat4x4<f32> };
@group(0) @binding(0) var<uniform> cam: Cam;

struct VIn {
    @location(0) pos: vec2<f32>,
    @location(1) color: u32,
};
struct VOut {
    @builtin(position) clip: vec4<f32>,
    @location(0) color: vec4<f32>,
};

fn unpack(c: u32) -> vec4<f32> {
    let r = f32((c >> 0u) & 0xFFu) / 255.0;
    let g = f32((c >> 8u) & 0xFFu) / 255.0;
    let b = f32((c >> 16u) & 0xFFu) / 255.0;
    let a = f32((c >> 24u) & 0xFFu) / 255.0;
    return vec4<f32>(r, g, b, a);
}

@vertex
fn vs_main(v: VIn) -> VOut {
    var o: VOut;
    o.clip = cam.view_proj * vec4<f32>(v.pos, 0.0, 1.0);
    o.color = unpack(v.color);
    return o;
}

@fragment
fn fs_main(v: VOut) -> @location(0) vec4<f32> {
    return v.color;
}
"#;

// =============================================================================
// GpuCtx — wgpu + egui
// =============================================================================

struct GpuCtx {
    surface: wgpu::Surface<'static>,
    device: wgpu::Device,
    queue: wgpu::Queue,
    config: wgpu::SurfaceConfiguration,
    format: wgpu::TextureFormat,
    egui_ctx: egui::Context,
    egui_state: egui_winit::State,
    egui_renderer: egui_wgpu::Renderer,
}

impl GpuCtx {
    async fn new(window: Arc<Window>) -> anyhow::Result<Self> {
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
        eprintln!("[GPU] {:?}", adapter.get_info().name);

        let (device, queue) = adapter.request_device(&wgpu::DeviceDescriptor {
            label: Some("dxf-viewer"),
            required_features: wgpu::Features::empty(),
            required_limits: wgpu::Limits::default(),
            memory_hints: wgpu::MemoryHints::Performance,
        }, None).await?;

        let caps = surface.get_capabilities(&adapter);
        let format = caps.formats.iter().copied()
            .find(|f| f.is_srgb()).unwrap_or(caps.formats[0]);
        let present_mode = if caps.present_modes.contains(&wgpu::PresentMode::Mailbox) {
            wgpu::PresentMode::Mailbox
        } else {
            wgpu::PresentMode::Fifo
        };
        let config = wgpu::SurfaceConfiguration {
            usage: wgpu::TextureUsages::RENDER_ATTACHMENT,
            format,
            width: size.width.max(1),
            height: size.height.max(1),
            present_mode,
            desired_maximum_frame_latency: 2,
            alpha_mode: caps.alpha_modes[0],
            view_formats: vec![],
        };
        surface.configure(&device, &config);

        let egui_ctx = egui::Context::default();
        let egui_state = egui_winit::State::new(
            egui_ctx.clone(),
            egui::ViewportId::ROOT,
            &*window,
            Some(window.scale_factor() as f32),
            None,
            None,
        );
        let egui_renderer = egui_wgpu::Renderer::new(&device, format, None, 1, false);

        Ok(Self { surface, device, queue, config, format, egui_ctx, egui_state, egui_renderer })
    }
}

// =============================================================================
// App
// =============================================================================

/// Which grip of a selected line is being interacted with.
#[derive(Clone, Copy, Debug, PartialEq)]
enum GripKind { P1, P2 }

/// Snap type currently active under the cursor.
#[derive(Clone, Copy, Debug, PartialEq)]
enum SnapKind { Endpoint, Midpoint }

impl SnapKind {
    fn label(self) -> &'static str {
        match self { SnapKind::Endpoint => "end", SnapKind::Midpoint => "mid" }
    }
}

/// Active drag/gesture. Only one drag is in flight at a time.
#[derive(Clone, Copy, Debug)]
enum DragState {
    None,
    /// Middle-button pan.
    Pan { start_mouse: (f32, f32), start_pan: (f64, f64) },
    /// Left-button drag of a line endpoint.
    Grip { seg_idx: u32, grip: GripKind },
    /// Left-button drag of a line body (translates both endpoints).
    LineBody {
        seg_idx: u32,
        start_world: [f64; 2],
        start_p1: [f64; 2],
        start_p2: [f64; 2],
    },
}

struct App {
    window: Option<Arc<Window>>,
    gpu: Option<GpuCtx>,
    pipeline: Option<LinePipeline>,

    scene: Scene,

    /// Origin offset for floating-origin rendering. We pick the center of
    /// the bbox so f32 precision is maintained even for drawings placed
    /// far from origin.
    origin: [f64; 2],

    // Camera state — expressed in world units relative to `origin`.
    pan_x: f64,
    pan_y: f64,
    /// Ortho zoom = "world units visible along shorter screen axis" inverse.
    /// We start by auto-fitting the scene bbox.
    zoom: f64,

    // Mouse state
    mouse_pos: (f32, f32),
    drag: DragState,
    modifiers: ModifiersState,

    // Grip hover — which endpoint of the selected line is the cursor near?
    // Only valid when a single Line entity is selected. None = no grip hovered.
    hover_grip: Option<GripKind>,

    // Snap: active snap candidate under the cursor, if any.
    snap: Option<(SnapKind, [f64; 2])>,
    snap_enabled: bool,

    // Selection (set of entity indices)
    selected: HashSet<u32>,

    // FPS
    last_frame: Instant,
    fps_samples: Vec<f32>,
    mean_fps: f32,

    /// Path of the currently loaded file (None = empty/no file).
    current_path: Option<String>,
}

impl App {
    fn new(scene: Scene, current_path: Option<String>) -> Self {
        // Pick origin at bbox center (floating-origin rendering anchor).
        let cx = (scene.bbox[0] + scene.bbox[2]) * 0.5;
        let cy = (scene.bbox[1] + scene.bbox[3]) * 0.5;
        let origin = [cx, cy];
        let w = (scene.bbox[2] - scene.bbox[0]).max(1.0);
        let h = (scene.bbox[3] - scene.bbox[1]).max(1.0);
        // Auto-fit: half-height in world = max(w*h_ratio, h) where h_ratio = screen aspect
        // We pick the larger axis to ensure both fit. Start with 16:10 default;
        // correct aspect is applied at render time.
        let fit = w.max(h) * 0.55; // 10% margin
        let zoom = 1.0 / fit; // half-height = 1/zoom

        Self {
            window: None, gpu: None, pipeline: None,
            scene, origin,
            pan_x: 0.0, pan_y: 0.0, zoom,
            mouse_pos: (0.0, 0.0),
            drag: DragState::None,
            modifiers: ModifiersState::empty(),
            hover_grip: None,
            snap: None,
            snap_enabled: true,
            selected: HashSet::new(),
            last_frame: Instant::now(),
            fps_samples: Vec::with_capacity(120),
            mean_fps: 0.0,
            current_path,
        }
    }

    /// Window-title string reflecting the current file + scene stats.
    fn title_for(scene: &Scene, path: Option<&str>) -> String {
        let label = match path {
            Some(p) => std::path::Path::new(p)
                .file_name()
                .map(|s| s.to_string_lossy().into_owned())
                .unwrap_or_else(|| p.to_string()),
            None => "<no file>".to_string(),
        };
        format!(
            "DWG/DXF Viewer — {}  ({} segments, {} entities, {} layers)  [Ctrl+O to open]",
            label,
            scene.segments.len(),
            scene.entities.len(),
            scene.layers.len(),
        )
    }

    /// Replace the loaded scene and rebuild GPU resources for the new geometry.
    /// Keeps the existing window/GPU context. Recomputes camera fit and resets
    /// selection/snap state.
    fn reload_with(&mut self, scene: Scene, path: Option<String>) {
        // Recompute floating-origin and auto-fit zoom.
        let cx = (scene.bbox[0] + scene.bbox[2]) * 0.5;
        let cy = (scene.bbox[1] + scene.bbox[3]) * 0.5;
        self.origin = [cx, cy];
        let w = (scene.bbox[2] - scene.bbox[0]).max(1.0);
        let h = (scene.bbox[3] - scene.bbox[1]).max(1.0);
        let fit = w.max(h) * 0.55;
        self.zoom = 1.0 / fit;
        self.pan_x = 0.0;
        self.pan_y = 0.0;
        self.selected.clear();
        self.snap = None;
        self.hover_grip = None;
        self.scene = scene;
        self.current_path = path;

        // Rebuild GPU vertex buffer. The existing pipeline has a fixed
        // capacity; for a file with more segments than the previous buffer
        // can hold, recreate the pipeline entirely.
        let verts = self.build_vertices();
        let needed = (verts.len() as u32).max(2);
        if let Some(gpu) = self.gpu.as_ref() {
            let needs_recreate = self.pipeline.as_ref()
                .map(|p| needed > p.vb_capacity)
                .unwrap_or(true);
            if needs_recreate {
                let mut pipeline = LinePipeline::new(&gpu.device, gpu.format, needed);
                pipeline.upload_vertices(&gpu.queue, &verts);
                self.pipeline = Some(pipeline);
            } else if let Some(pipeline) = self.pipeline.as_mut() {
                pipeline.upload_vertices(&gpu.queue, &verts);
            }
        }

        // Update window title.
        if let Some(win) = self.window.as_ref() {
            win.set_title(&Self::title_for(&self.scene, self.current_path.as_deref()));
        }
    }

    /// Show a native file-open dialog and load the selected DWG/DXF.
    /// On error, prints to stderr and leaves the current scene unchanged.
    fn open_file_dialog(&mut self) {
        let starting_dir = self.current_path.as_ref()
            .and_then(|p| std::path::Path::new(p).parent().map(|d| d.to_path_buf()));
        let mut dialog = rfd::FileDialog::new()
            .set_title("Open DWG or DXF")
            .add_filter("CAD drawings (*.dwg, *.dxf)", &["dwg", "dxf", "DWG", "DXF"])
            .add_filter("AutoCAD DWG (*.dwg)", &["dwg", "DWG"])
            .add_filter("AutoCAD DXF (*.dxf)", &["dxf", "DXF"])
            .add_filter("All files", &["*"]);
        if let Some(dir) = starting_dir {
            dialog = dialog.set_directory(dir);
        }
        let Some(picked) = dialog.pick_file() else {
            return;
        };
        let path = picked.to_string_lossy().into_owned();
        eprintln!("[viewer] opening: {}", path);
        match Scene::load_auto(&path) {
            Ok(scene) => self.reload_with(scene, Some(path)),
            Err(e) => eprintln!("[viewer] load failed: {:?}", e),
        }
    }

    /// Build the vertex buffer from all segments. Called once after GPU init.
    fn build_vertices(&self) -> Vec<Vertex> {
        let mut verts = Vec::with_capacity(self.scene.segments.len() * 2);
        for s in &self.scene.segments {
            // If the layer is hidden, zero alpha → invisible. Otherwise use per-segment color.
            let hidden = self.scene.entities.get(s.entity_idx as usize)
                .and_then(|e| self.scene.layers.get(e.layer_idx as usize))
                .map(|l| !l.visible)
                .unwrap_or(false);
            let color = if hidden { 0 } else { s.color };
            let p1 = [
                (s.p1[0] - self.origin[0]) as f32,
                (s.p1[1] - self.origin[1]) as f32,
            ];
            let p2 = [
                (s.p2[0] - self.origin[0]) as f32,
                (s.p2[1] - self.origin[1]) as f32,
            ];
            verts.push(Vertex { pos: p1, color, _pad: 0 });
            verts.push(Vertex { pos: p2, color, _pad: 0 });
        }
        verts
    }

    /// Compute the view-proj matrix for the current camera.
    fn camera(&self, aspect: f32) -> CameraUbo {
        let half_h = (1.0 / self.zoom) as f32;
        let half_w = half_h * aspect;
        let sx = 1.0 / half_w;
        let sy = 1.0 / half_h;
        // Pan is in world units from the origin.
        let tx = -self.pan_x as f32 * sx;
        let ty = -self.pan_y as f32 * sy;
        CameraUbo {
            view_proj: [
                [sx, 0.0, 0.0, 0.0],
                [0.0, sy, 0.0, 0.0],
                [0.0, 0.0, 1.0, 0.0],
                [tx, ty, 0.0, 1.0],
            ],
        }
    }

    /// Convert screen pixel to world coords (f64, absolute — includes origin).
    fn screen_to_world(&self, sx: f32, sy: f32) -> [f64; 2] {
        let (w, h) = self.gpu.as_ref()
            .map(|g| (g.config.width.max(1) as f32, g.config.height.max(1) as f32))
            .unwrap_or((1.0, 1.0));
        let aspect = w / h;
        let half_h = 1.0 / self.zoom;
        let half_w = half_h * aspect as f64;
        // Normalized screen coords: [-1,1] left→right, [-1,1] bottom→top
        let nx = (sx / w) * 2.0 - 1.0;
        let ny = 1.0 - (sy / h) * 2.0;
        let wx = self.origin[0] + self.pan_x + nx as f64 * half_w;
        let wy = self.origin[1] + self.pan_y + ny as f64 * half_h;
        [wx, wy]
    }

    /// World units per screen pixel (both axes equal for aspect-correct ortho).
    fn world_per_pixel(&self) -> f64 {
        let h = self.gpu.as_ref()
            .map(|g| g.config.height.max(1) as f64)
            .unwrap_or(1000.0);
        (2.0 / self.zoom) / h
    }

    /// Convert a world coordinate to a screen pixel position (for grip drawing).
    fn world_to_screen(&self, wx: f64, wy: f64) -> (f32, f32) {
        let (sw, sh) = self.gpu.as_ref()
            .map(|g| (g.config.width.max(1) as f64, g.config.height.max(1) as f64))
            .unwrap_or((1.0, 1.0));
        let aspect = sw / sh;
        let half_h = 1.0 / self.zoom;
        let half_w = half_h * aspect;
        let rx = wx - self.origin[0] - self.pan_x;
        let ry = wy - self.origin[1] - self.pan_y;
        let nx = rx / half_w;
        let ny = ry / half_h;
        let px = (nx + 1.0) * 0.5 * sw;
        let py = (1.0 - ny) * 0.5 * sh; // flip Y (screen Y grows downward)
        (px as f32, py as f32)
    }

    /// For a single selected Line entity, return screen-space positions of its two grips.
    /// Returns None if selection is empty, multi, or not a Line.
    fn selected_grips_screen(&self) -> Option<((f32, f32), (f32, f32), u32)> {
        if self.selected.len() != 1 { return None; }
        let sel = *self.selected.iter().next()?;
        let ent = self.scene.entities.get(sel as usize)?;
        if !matches!(ent.kind, DxfKind::Line) { return None; }
        let seg = self.scene.segments.get(ent.primary_segment as usize)?;
        let s1 = self.world_to_screen(seg.p1[0], seg.p1[1]);
        let s2 = self.world_to_screen(seg.p2[0], seg.p2[1]);
        Some((s1, s2, ent.primary_segment))
    }

    /// Hit-test: is the cursor currently within grip-radius of an endpoint?
    /// Returns the grip kind + segment index if so.
    fn hit_grip(&self) -> Option<(GripKind, u32)> {
        let (s1, s2, seg_idx) = self.selected_grips_screen()?;
        const GRIP_HIT_PX: f32 = 8.0;
        let d1 = ((self.mouse_pos.0 - s1.0).powi(2) + (self.mouse_pos.1 - s1.1).powi(2)).sqrt();
        let d2 = ((self.mouse_pos.0 - s2.0).powi(2) + (self.mouse_pos.1 - s2.1).powi(2)).sqrt();
        if d1 < GRIP_HIT_PX && d1 <= d2 { Some((GripKind::P1, seg_idx)) }
        else if d2 < GRIP_HIT_PX { Some((GripKind::P2, seg_idx)) }
        else { None }
    }

    /// Is the cursor currently on the body of the (single-selected) Line?
    fn hit_line_body(&self) -> Option<u32> {
        if self.selected.len() != 1 { return None; }
        let sel = *self.selected.iter().next()?;
        let ent = self.scene.entities.get(sel as usize)?;
        if !matches!(ent.kind, DxfKind::Line) { return None; }
        let seg = self.scene.segments.get(ent.primary_segment as usize)?;
        let world = self.screen_to_world(self.mouse_pos.0, self.mouse_pos.1);
        let d = point_segment_distance(world, seg.p1, seg.p2);
        let tol = self.world_per_pixel() * 6.0;
        if d <= tol { Some(ent.primary_segment) } else { None }
    }

    /// Find the nearest snap candidate within `snap_radius_px` screen pixels.
    /// Scans all segments; checks endpoints and midpoints.
    /// With ~150k segments this is ~2ms per call — run only on cursor moves.
    /// Auto-bails out on very large scenes when zoomed out far: scanning 500k
    /// segments per mouse move at zoom=fit triggers UI stalls.
    fn compute_snap(&self, snap_radius_px: f32) -> Option<(SnapKind, [f64; 2])> {
        if !self.snap_enabled { return None; }
        let tol = self.world_per_pixel() * (snap_radius_px as f64);
        let tol2 = tol * tol;
        let cursor_world = self.screen_to_world(self.mouse_pos.0, self.mouse_pos.1);
        // Perf safeguard: if the scene is huge AND we're zoomed out far,
        // snap tolerance covers so many endpoints that the scan costs too much.
        // Bail out rather than stall the UI.
        if self.scene.segments.len() > 200_000 && tol > 100.0 {
            return None;
        }
        let mut best: Option<(f64, SnapKind, [f64; 2])> = None;
        for s in &self.scene.segments {
            // Cull via entity layer visibility
            let visible = self.scene.entities.get(s.entity_idx as usize)
                .and_then(|e| self.scene.layers.get(e.layer_idx as usize))
                .map(|l| l.visible).unwrap_or(true);
            if !visible { continue; }
            // Endpoints
            for (pt, kind) in [(s.p1, SnapKind::Endpoint), (s.p2, SnapKind::Endpoint)] {
                let d2 = (pt[0]-cursor_world[0]).powi(2) + (pt[1]-cursor_world[1]).powi(2);
                if d2 < tol2 && best.as_ref().map(|(bd2, _, _)| d2 < *bd2).unwrap_or(true) {
                    best = Some((d2, kind, pt));
                }
            }
            // Midpoint (lower priority: only if no endpoint found within strict tolerance)
            let mid = [(s.p1[0]+s.p2[0])*0.5, (s.p1[1]+s.p2[1])*0.5];
            let d2 = (mid[0]-cursor_world[0]).powi(2) + (mid[1]-cursor_world[1]).powi(2);
            if d2 < tol2 {
                // Endpoints win over midpoints at equal distance
                let replace = match &best {
                    Some((bd2, SnapKind::Midpoint, _)) => d2 < *bd2,
                    Some((bd2, SnapKind::Endpoint, _)) => d2 < *bd2 * 0.5,
                    None => true,
                };
                if replace {
                    best = Some((d2, SnapKind::Midpoint, mid));
                }
            }
        }
        best.map(|(_, k, p)| (k, p))
    }

    /// Update a segment's endpoints in memory AND on the GPU buffer.
    fn write_segment_update(&self, seg_idx: u32, color: u32) {
        if let (Some(pipeline), Some(gpu)) = (self.pipeline.as_ref(), self.gpu.as_ref()) {
            if let Some(seg) = self.scene.segments.get(seg_idx as usize) {
                let p1 = [
                    (seg.p1[0] - self.origin[0]) as f32,
                    (seg.p1[1] - self.origin[1]) as f32,
                ];
                let p2 = [
                    (seg.p2[0] - self.origin[0]) as f32,
                    (seg.p2[1] - self.origin[1]) as f32,
                ];
                pipeline.write_segment(&gpu.queue, seg_idx,
                    Vertex { pos: p1, color, _pad: 0 },
                    Vertex { pos: p2, color, _pad: 0 });
            }
        }
    }

    /// Select nearest segment to a world point within tolerance (world units).
    /// Returns entity_idx of hit, or None.
    fn pick(&self, world: [f64; 2], tol: f64) -> Option<u32> {
        let mut best: Option<(f64, u32)> = None;
        for s in &self.scene.segments {
            let d = point_segment_distance(world, s.p1, s.p2);
            if d <= tol {
                match best {
                    Some((bd, _)) if bd <= d => {}
                    _ => best = Some((d, s.entity_idx)),
                }
            }
        }
        best.map(|(_, e)| e)
    }

    /// Rewrite colors of all segments belonging to a given entity.
    /// If `override_color` is Some, use that; if None, restore original.
    /// Batches consecutive segment updates into a single GPU buffer write
    /// to avoid per-segment stalls when an entity has many segments.
    fn colorize_entity(&self, pipeline: &LinePipeline, queue: &wgpu::Queue,
                        entity_idx: u32, override_color: Option<u32>) {
        // Build a list of (seg_idx, v0, v1) triples, then flush in runs.
        let mut runs: Vec<(u32, Vec<Vertex>)> = Vec::new();
        let mut cur_run_start: Option<u32> = None;
        let mut cur_run_verts: Vec<Vertex> = Vec::new();
        let hidden_cached = self.scene.entities.get(entity_idx as usize)
            .and_then(|e| self.scene.layers.get(e.layer_idx as usize))
            .map(|l| !l.visible).unwrap_or(false);
        for (seg_idx, s) in self.scene.segments.iter().enumerate() {
            if s.entity_idx != entity_idx {
                // Flush current run if any
                if let Some(start) = cur_run_start.take() {
                    runs.push((start, std::mem::take(&mut cur_run_verts)));
                }
                continue;
            }
            let color = match override_color {
                Some(c) => c,
                None => if hidden_cached { 0 } else { s.color },
            };
            let p1 = [
                (s.p1[0] - self.origin[0]) as f32,
                (s.p1[1] - self.origin[1]) as f32,
            ];
            let p2 = [
                (s.p2[0] - self.origin[0]) as f32,
                (s.p2[1] - self.origin[1]) as f32,
            ];
            if cur_run_start.is_none() {
                cur_run_start = Some(seg_idx as u32);
            }
            cur_run_verts.push(Vertex { pos: p1, color, _pad: 0 });
            cur_run_verts.push(Vertex { pos: p2, color, _pad: 0 });
        }
        if let Some(start) = cur_run_start {
            runs.push((start, cur_run_verts));
        }
        for (start, verts) in runs {
            let offset = (start as u64) * 2 * std::mem::size_of::<Vertex>() as u64;
            queue.write_buffer(&pipeline.vb, offset, bytemuck::cast_slice(&verts));
        }
    }

    fn render(&mut self) {
        // Timing
        let now = Instant::now();
        let dt = now.duration_since(self.last_frame).as_secs_f32().min(0.1);
        self.last_frame = now;
        if dt > 0.0 {
            self.fps_samples.push(1.0 / dt);
            if self.fps_samples.len() > 60 { self.fps_samples.remove(0); }
            self.mean_fps = self.fps_samples.iter().sum::<f32>() / self.fps_samples.len() as f32;
        }

        // Compute camera + all `self`-derived data BEFORE borrowing gpu mutably.
        let aspect = self.gpu.as_ref()
            .map(|g| g.config.width as f32 / g.config.height.max(1) as f32)
            .unwrap_or(1.0);
        let cam = self.camera(aspect);
        let fps = self.mean_fps;
        let scene_bbox = self.scene.bbox;
        let counts = self.scene.counts;
        let seg_count = self.scene.segments.len();
        let ent_count = self.scene.entities.len();
        let sel_count = self.selected.len();
        let selected_info: Option<String> = if sel_count == 0 {
            None
        } else if sel_count == 1 {
            let i = *self.selected.iter().next().unwrap();
            let e = &self.scene.entities[i as usize];
            let layer_name = self.scene.layers.get(e.layer_idx as usize)
                .map(|l| l.name.as_str()).unwrap_or("?");
            Some(format!("#{}  {:?}  layer={}  bbox=[{:.1},{:.1} .. {:.1},{:.1}]",
                i, e.kind, layer_name, e.bbox[0], e.bbox[1], e.bbox[2], e.bbox[3]))
        } else {
            // Count by kind
            let mut by_kind: HashMap<String, u32> = HashMap::new();
            for idx in &self.selected {
                if let Some(e) = self.scene.entities.get(*idx as usize) {
                    *by_kind.entry(format!("{:?}", e.kind)).or_insert(0) += 1;
                }
            }
            let mut parts: Vec<String> = by_kind.iter()
                .map(|(k, n)| format!("{}: {}", k, n)).collect();
            parts.sort();
            Some(format!("{} entities — {}", sel_count, parts.join(", ")))
        };
        let grips = self.selected_grips_screen();
        let hover_grip = self.hover_grip;
        let dragging_grip = matches!(self.drag, DragState::Grip { .. });
        let dragging_p1 = matches!(self.drag, DragState::Grip { grip: GripKind::P1, .. });
        let dragging_p2 = matches!(self.drag, DragState::Grip { grip: GripKind::P2, .. });
        let snap_marker: Option<(SnapKind, (f32, f32))> = self.snap.map(|(k, p)| {
            (k, self.world_to_screen(p[0], p[1]))
        });
        let snap_enabled = self.snap_enabled;
        // HighDPI: winit reports mouse/size in PHYSICAL pixels, but egui painter
        // coordinates are in LOGICAL "points". Scale our screen-space positions
        // (grips, snap markers) by the inverse scale factor when we hand them
        // to the painter.
        let ppp = self.window.as_ref()
            .map(|w| w.scale_factor() as f32)
            .unwrap_or(1.0);
        let edit_info: Option<String> = match self.drag {
            DragState::Grip { seg_idx, .. } | DragState::LineBody { seg_idx, .. } => {
                self.scene.segments.get(seg_idx as usize).map(|s| {
                    let len = ((s.p2[0]-s.p1[0]).powi(2) + (s.p2[1]-s.p1[1]).powi(2)).sqrt();
                    format!("editing: p1=[{:.2},{:.2}] p2=[{:.2},{:.2}] len={:.3}",
                        s.p1[0], s.p1[1], s.p2[0], s.p2[1], len)
                })
            }
            _ => None,
        };

        let Some(gpu) = self.gpu.as_mut() else { return; };
        let Some(pipeline) = self.pipeline.as_ref() else { return; };
        let Some(win) = self.window.as_ref() else { return; };

        pipeline.update_camera(&gpu.queue, cam);

        let raw_input = gpu.egui_state.take_egui_input(win);
        let full_output = gpu.egui_ctx.run(raw_input, |ctx| {
            egui::SidePanel::right("ctrl").resizable(true)
                .default_width(280.0).show(ctx, |ui| {
                ui.heading("DXF Viewer (mockup)");
                ui.separator();
                ui.label(format!("Entities: {}", ent_count));
                ui.label(format!("Segments: {}", seg_count));
                ui.label(format!("  LINE: {}", counts[0]));
                ui.label(format!("  CIRCLE: {}", counts[1]));
                ui.label(format!("  ARC: {}", counts[2]));
                ui.label(format!("  LWPOLYLINE: {}", counts[3]));
                ui.label(format!("  POLYLINE: {}", counts[4]));
                ui.label(format!("  INSERT: {}", counts[5]));
                ui.label(format!("  TEXT/MTEXT: {}", counts[6]));
                ui.label(format!("  HATCH: {}", counts[7]));
                ui.label(format!("  SOLID/3DFACE: {}", counts[8]));
                ui.label(format!("  ELLIPSE: {}", counts[9]));
                ui.label(format!("  SPLINE: {}", counts[10]));
                ui.label(format!("  POINT: {}", counts[11]));
                ui.label(format!("  LEADER: {}", counts[12]));
                ui.label(format!("  RAY/XLINE: {}/{}", counts[13], counts[14]));
                ui.label(format!("  DIMENSION: {}", counts[15]));
                ui.label(format!("  unsupported: {}", counts[16]));
                ui.separator();
                ui.heading("Bounding box (world)");
                ui.label(format!("X: {:.1} → {:.1}", scene_bbox[0], scene_bbox[2]));
                ui.label(format!("Y: {:.1} → {:.1}", scene_bbox[1], scene_bbox[3]));
                ui.separator();
                ui.heading("Controls");
                ui.label("• Middle-drag = pan");
                ui.label("• Scroll = zoom");
                ui.label("• Left-click = select line");
                ui.label("• F = fit all");
                ui.label("• ESC = exit");
                ui.separator();
                ui.heading("Selection");
                if let Some(s) = &selected_info {
                    ui.colored_label(egui::Color32::from_rgb(255, 80, 80), s);
                } else {
                    ui.label("(none — click on a line)");
                }
                if let Some(info) = &edit_info {
                    ui.separator();
                    ui.colored_label(egui::Color32::from_rgb(180, 220, 120), info);
                }
                ui.separator();
                ui.label("Edit a LINE:");
                ui.label("• click grip (square) → drag endpoint");
                ui.label("• click body → drag whole line");
                ui.separator();
                ui.heading("Snap");
                ui.label(format!("Enabled: {}", snap_enabled));
                ui.label("• yellow ⬜ = endpoint");
                ui.label("• cyan ▲ = midpoint");
                ui.label("Toggle with 'S'");
                ui.separator();
                ui.heading("Performance");
                ui.colored_label(
                    if fps >= 120.0 { egui::Color32::GREEN }
                    else if fps >= 60.0 { egui::Color32::YELLOW }
                    else { egui::Color32::LIGHT_RED },
                    format!("FPS: {:.1}", fps)
                );
            });

            // Grip overlay — drawn on top of everything via foreground layer.
            // NOTE: egui painter uses LOGICAL "points", but our world_to_screen
            // returns PHYSICAL pixels (since gpu.config and winit cursor coords
            // are physical). Divide by ppp = DPI scale to land on the pixel
            // under the cursor.
            if let Some((s1, s2, _)) = grips {
                let painter = ctx.layer_painter(egui::LayerId::new(
                    egui::Order::Foreground, egui::Id::new("line-grips")));
                let draw_grip = |p: (f32, f32), is_hover: bool, is_drag: bool| {
                    let center = egui::pos2(p.0 / ppp, p.1 / ppp);
                    let size = if is_drag { 11.0 } else if is_hover { 10.0 } else { 8.0 };
                    let rect = egui::Rect::from_center_size(center, egui::vec2(size, size));
                    let fill = if is_drag { egui::Color32::from_rgb(255, 220, 60) }
                        else if is_hover { egui::Color32::from_rgb(255, 240, 120) }
                        else { egui::Color32::from_rgb(80, 170, 255) };
                    painter.rect_filled(rect, 1.0, fill);
                    painter.rect_stroke(rect, 1.0, egui::Stroke::new(1.5, egui::Color32::BLACK));
                };
                draw_grip(s1, hover_grip == Some(GripKind::P1) && !dragging_grip, dragging_p1);
                draw_grip(s2, hover_grip == Some(GripKind::P2) && !dragging_grip, dragging_p2);
            }

            // Snap marker overlay
            if snap_enabled {
                if let Some((kind, (sx_phys, sy_phys))) = snap_marker {
                    let sx = sx_phys / ppp;
                    let sy = sy_phys / ppp;
                    let painter = ctx.layer_painter(egui::LayerId::new(
                        egui::Order::Foreground, egui::Id::new("snap-marker")));
                    let center = egui::pos2(sx, sy);
                    let color = match kind {
                        SnapKind::Endpoint => egui::Color32::from_rgb(255, 255, 80),  // yellow
                        SnapKind::Midpoint => egui::Color32::from_rgb(80, 255, 255),  // cyan
                    };
                    match kind {
                        SnapKind::Endpoint => {
                            let r = egui::Rect::from_center_size(center, egui::vec2(13.0, 13.0));
                            painter.rect_stroke(r, 0.0, egui::Stroke::new(2.0, color));
                        }
                        SnapKind::Midpoint => {
                            let s = 8.0;
                            let a = egui::pos2(sx, sy - s);
                            let b = egui::pos2(sx - s * 0.866, sy + s * 0.5);
                            let c = egui::pos2(sx + s * 0.866, sy + s * 0.5);
                            painter.add(egui::Shape::closed_line(vec![a, b, c, a],
                                egui::Stroke::new(2.0, color)));
                        }
                    }
                    painter.text(
                        egui::pos2(sx + 12.0, sy - 12.0),
                        egui::Align2::LEFT_BOTTOM,
                        kind.label(),
                        egui::FontId::proportional(11.0),
                        color,
                    );
                }
            }
        });
        gpu.egui_state.handle_platform_output(win, full_output.platform_output.clone());
        let paint_jobs = gpu.egui_ctx.tessellate(full_output.shapes, full_output.pixels_per_point);
        let screen = ScreenDescriptor {
            size_in_pixels: [gpu.config.width, gpu.config.height],
            pixels_per_point: full_output.pixels_per_point,
        };
        for (id, delta) in &full_output.textures_delta.set {
            gpu.egui_renderer.update_texture(&gpu.device, &gpu.queue, *id, delta);
        }
        let frame = match gpu.surface.get_current_texture() {
            Ok(f) => f, Err(_) => return,
        };
        let view = frame.texture.create_view(&Default::default());
        let mut enc = gpu.device.create_command_encoder(&Default::default());
        {
            let mut pass = enc.begin_render_pass(&wgpu::RenderPassDescriptor {
                label: Some("scene"),
                color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                    view: &view, resolve_target: None,
                    ops: wgpu::Operations {
                        load: wgpu::LoadOp::Clear(wgpu::Color { r: 0.08, g: 0.09, b: 0.12, a: 1.0 }),
                        store: wgpu::StoreOp::Store,
                    },
                })],
                depth_stencil_attachment: None,
                timestamp_writes: None,
                occlusion_query_set: None,
            });
            pipeline.draw(&mut pass);
        }
        gpu.egui_renderer.update_buffers(&gpu.device, &gpu.queue, &mut enc, &paint_jobs, &screen);
        {
            let pass = enc.begin_render_pass(&wgpu::RenderPassDescriptor {
                label: Some("egui"),
                color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                    view: &view, resolve_target: None,
                    ops: wgpu::Operations { load: wgpu::LoadOp::Load, store: wgpu::StoreOp::Store },
                })],
                depth_stencil_attachment: None,
                timestamp_writes: None,
                occlusion_query_set: None,
            });
            let mut pass_static = pass.forget_lifetime();
            gpu.egui_renderer.render(&mut pass_static, &paint_jobs, &screen);
        }
        for id in &full_output.textures_delta.free {
            gpu.egui_renderer.free_texture(id);
        }
        gpu.queue.submit(std::iter::once(enc.finish()));
        frame.present();
    }
}

/// Perpendicular distance from point to segment (clamped to endpoints).
fn point_segment_distance(p: [f64; 2], a: [f64; 2], b: [f64; 2]) -> f64 {
    let abx = b[0] - a[0];
    let aby = b[1] - a[1];
    let apx = p[0] - a[0];
    let apy = p[1] - a[1];
    let len2 = abx * abx + aby * aby;
    if len2 <= f64::EPSILON {
        return ((p[0] - a[0]).powi(2) + (p[1] - a[1]).powi(2)).sqrt();
    }
    let t = ((apx * abx + apy * aby) / len2).clamp(0.0, 1.0);
    let cx = a[0] + abx * t;
    let cy = a[1] + aby * t;
    ((p[0] - cx).powi(2) + (p[1] - cy).powi(2)).sqrt()
}

impl ApplicationHandler for App {
    fn resumed(&mut self, event_loop: &ActiveEventLoop) {
        let title = Self::title_for(&self.scene, self.current_path.as_deref());
        let win = Arc::new(event_loop.create_window(
            Window::default_attributes()
                .with_title(title)
                .with_inner_size(winit::dpi::LogicalSize::new(1600, 1000)),
        ).unwrap());
        let gpu = pollster::block_on(GpuCtx::new(win.clone())).unwrap();

        let verts = self.build_vertices();
        let capacity = (verts.len() as u32).max(2);
        let mut pipeline = LinePipeline::new(&gpu.device, gpu.format, capacity);
        pipeline.upload_vertices(&gpu.queue, &verts);

        self.window = Some(win);
        self.gpu = Some(gpu);
        self.pipeline = Some(pipeline);
    }

    fn window_event(&mut self, event_loop: &ActiveEventLoop, _id: winit::window::WindowId, event: WindowEvent) {
        if let (Some(gpu), Some(win)) = (self.gpu.as_mut(), self.window.as_ref()) {
            let _ = gpu.egui_state.on_window_event(win, &event);
        }
        match event {
            WindowEvent::CloseRequested => event_loop.exit(),
            WindowEvent::Resized(size) => {
                if let Some(gpu) = self.gpu.as_mut() {
                    if size.width > 0 && size.height > 0 {
                        gpu.config.width = size.width;
                        gpu.config.height = size.height;
                        gpu.surface.configure(&gpu.device, &gpu.config);
                    }
                }
            }
            WindowEvent::ModifiersChanged(m) => {
                self.modifiers = m.state();
            }
            WindowEvent::KeyboardInput { event: KeyEvent {
                physical_key: PhysicalKey::Code(code),
                state: ElementState::Pressed, ..
            }, .. } => match code {
                KeyCode::Escape => {
                    if !self.selected.is_empty() {
                        let prev: Vec<u32> = self.selected.iter().copied().collect();
                        if let (Some(pipeline), Some(gpu)) = (self.pipeline.as_ref(), self.gpu.as_ref()) {
                            for p in &prev {
                                self.colorize_entity(pipeline, &gpu.queue, *p, None);
                            }
                        }
                        self.selected.clear();
                    } else {
                        event_loop.exit();
                    }
                }
                KeyCode::KeyS => {
                    self.snap_enabled = !self.snap_enabled;
                    if !self.snap_enabled { self.snap = None; }
                }
                KeyCode::KeyA if self.modifiers.control_key() => {
                    // Ctrl+A = select all
                    let all: Vec<u32> = (0..self.scene.entities.len() as u32).collect();
                    if let (Some(pipeline), Some(gpu)) = (self.pipeline.as_ref(), self.gpu.as_ref()) {
                        for e in &all {
                            self.colorize_entity(pipeline, &gpu.queue, *e, Some(0xFF3366FF));
                        }
                    }
                    self.selected = all.into_iter().collect();
                }
                KeyCode::KeyO if self.modifiers.control_key() => {
                    // Ctrl+O = open file dialog (DWG/DXF)
                    self.open_file_dialog();
                }
                KeyCode::KeyF => {
                    // Fit all
                    let w = (self.scene.bbox[2] - self.scene.bbox[0]).max(1.0);
                    let h = (self.scene.bbox[3] - self.scene.bbox[1]).max(1.0);
                    self.zoom = 1.0 / (w.max(h) * 0.55);
                    self.pan_x = 0.0;
                    self.pan_y = 0.0;
                }
                _ => {}
            }
            WindowEvent::CursorMoved { position, .. } => {
                self.mouse_pos = (position.x as f32, position.y as f32);

                // Compute snap candidate (used by drags and for rendering).
                // Skip computing while panning to save CPU.
                self.snap = if matches!(self.drag, DragState::Pan { .. }) {
                    None
                } else {
                    self.compute_snap(14.0)
                };
                // Apply snap to current cursor's world coord
                let cursor_world = match self.snap {
                    Some((_, pt)) => pt,
                    None => self.screen_to_world(self.mouse_pos.0, self.mouse_pos.1),
                };

                match self.drag {
                    DragState::None => {}
                    DragState::Pan { start_mouse, start_pan } => {
                        let dx = self.mouse_pos.0 - start_mouse.0;
                        let dy = self.mouse_pos.1 - start_mouse.1;
                        let wpp = self.world_per_pixel();
                        self.pan_x = start_pan.0 - dx as f64 * wpp;
                        self.pan_y = start_pan.1 + dy as f64 * wpp;
                    }
                    DragState::Grip { seg_idx, grip } => {
                        // Move the chosen endpoint to the snapped cursor world coord.
                        if let Some(seg) = self.scene.segments.get_mut(seg_idx as usize) {
                            match grip {
                                GripKind::P1 => seg.p1 = cursor_world,
                                GripKind::P2 => seg.p2 = cursor_world,
                            }
                        }
                        self.write_segment_update(seg_idx, 0xFF3366FF);
                    }
                    DragState::LineBody { seg_idx, start_world, start_p1, start_p2 } => {
                        let dx = cursor_world[0] - start_world[0];
                        let dy = cursor_world[1] - start_world[1];
                        if let Some(seg) = self.scene.segments.get_mut(seg_idx as usize) {
                            seg.p1 = [start_p1[0] + dx, start_p1[1] + dy];
                            seg.p2 = [start_p2[0] + dx, start_p2[1] + dy];
                        }
                        self.write_segment_update(seg_idx, 0xFF3366FF);
                    }
                }

                // Update grip hover (only when not dragging)
                if matches!(self.drag, DragState::None) {
                    self.hover_grip = self.hit_grip().map(|(g, _)| g);
                }
            }
            WindowEvent::MouseInput { state, button, .. } => {
                let over_ui = self.gpu.as_ref()
                    .map(|g| g.egui_ctx.is_pointer_over_area())
                    .unwrap_or(false);
                match (button, state) {
                    (MouseButton::Middle, ElementState::Pressed) if !over_ui => {
                        self.drag = DragState::Pan {
                            start_mouse: self.mouse_pos,
                            start_pan: (self.pan_x, self.pan_y),
                        };
                    }
                    (MouseButton::Middle, ElementState::Released) => {
                        if matches!(self.drag, DragState::Pan { .. }) {
                            self.drag = DragState::None;
                        }
                    }
                    (MouseButton::Left, ElementState::Pressed) if !over_ui => {
                        // Priority 1: hitting a grip on the currently selected line → start Grip drag
                        if let Some((grip, seg_idx)) = self.hit_grip() {
                            self.drag = DragState::Grip { seg_idx, grip };
                            return;
                        }
                        // Priority 2: hitting the body of the selected line → start LineBody drag
                        if let Some(seg_idx) = self.hit_line_body() {
                            let seg = &self.scene.segments[seg_idx as usize];
                            let start_world = self.screen_to_world(self.mouse_pos.0, self.mouse_pos.1);
                            self.drag = DragState::LineBody {
                                seg_idx,
                                start_world,
                                start_p1: seg.p1,
                                start_p2: seg.p2,
                            };
                            return;
                        }
                        // Priority 3: pick. Ctrl = toggle, plain = replace.
                        let world = self.screen_to_world(self.mouse_pos.0, self.mouse_pos.1);
                        let tol = self.world_per_pixel() * 6.0;
                        let hit = self.pick(world, tol);
                        let ctrl = self.modifiers.control_key();

                        if ctrl {
                            // Toggle hit in set
                            if let Some(e) = hit {
                                let was_in = self.selected.contains(&e);
                                if let (Some(pipeline), Some(gpu)) = (self.pipeline.as_ref(), self.gpu.as_ref()) {
                                    if was_in {
                                        self.selected.remove(&e);
                                        self.colorize_entity(pipeline, &gpu.queue, e, None);
                                    } else {
                                        self.selected.insert(e);
                                        self.colorize_entity(pipeline, &gpu.queue, e, Some(0xFF3366FF));
                                    }
                                }
                            }
                        } else {
                            // Replace
                            let prev: Vec<u32> = self.selected.iter().copied().collect();
                            if let (Some(pipeline), Some(gpu)) = (self.pipeline.as_ref(), self.gpu.as_ref()) {
                                for p in &prev {
                                    self.colorize_entity(pipeline, &gpu.queue, *p, None);
                                }
                                self.selected.clear();
                                if let Some(e) = hit {
                                    self.selected.insert(e);
                                    self.colorize_entity(pipeline, &gpu.queue, e, Some(0xFF3366FF));
                                }
                            }
                        }
                        self.hover_grip = None;
                    }
                    (MouseButton::Left, ElementState::Released) => {
                        if matches!(self.drag, DragState::Grip { .. } | DragState::LineBody { .. }) {
                            self.drag = DragState::None;
                        }
                    }
                    _ => {}
                }
            }
            WindowEvent::MouseWheel { delta, .. } => {
                let over_ui = self.gpu.as_ref()
                    .map(|g| g.egui_ctx.is_pointer_over_area())
                    .unwrap_or(false);
                if over_ui { return; }
                let scroll = match delta {
                    MouseScrollDelta::LineDelta(_, y) => y,
                    MouseScrollDelta::PixelDelta(p) => p.y as f32 / 100.0,
                };
                // Zoom-to-cursor: pick a world anchor, zoom, adjust pan so anchor
                // stays under the cursor.
                let before = self.screen_to_world(self.mouse_pos.0, self.mouse_pos.1);
                let factor = (1.0 + scroll * 0.12).clamp(0.5, 2.5) as f64;
                self.zoom *= factor;
                let after = self.screen_to_world(self.mouse_pos.0, self.mouse_pos.1);
                self.pan_x += before[0] - after[0];
                self.pan_y += before[1] - after[1];
            }
            WindowEvent::RedrawRequested => {
                self.render();
                if let Some(w) = self.window.as_ref() { w.request_redraw(); }
            }
            _ => {}
        }
    }
}

fn main() -> anyhow::Result<()> {
    // Path: first CLI arg. With no arg, start with an empty scene; user can
    // press Ctrl+O to pick a file from the native dialog. With a `.dwg`/`.dxf`
    // extension we route to the matching loader; anything else errors.
    let args: Vec<String> = std::env::args().collect();
    let (scene, current_path) = if args.len() > 1 {
        let p = args[1].clone();
        eprintln!("[viewer] loading: {}", p);
        match Scene::load_auto(&p) {
            Ok(s) => (s, Some(p)),
            Err(e) => {
                eprintln!("[viewer] load failed: {:?} — starting empty (Ctrl+O to pick a file)", e);
                (Scene::empty(), None)
            }
        }
    } else {
        eprintln!("[viewer] no file given — starting empty (Ctrl+O to open a DWG or DXF)");
        (Scene::empty(), None)
    };

    let event_loop = EventLoop::new()?;
    let mut app = App::new(scene, current_path);
    event_loop.run_app(&mut app)?;
    Ok(())
}
