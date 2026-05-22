//! Open 2D Studio â€” tabbed DWG/DXF viewer (browser-style file tabs).
//!
//! (Bin renamed 2026-05-01 from split_compare to open_2d_studio. The
//! split-pane comparison binary lineage stays in git history.) Refactored
//! 2026-04-21 from a fixed 4-pane TL/TR/BL/BR grid into a single-canvas
//! viewer with an arbitrary number of open-file tabs, TrueView-style.
//! Each tab owns its own Scene + camera + GPU line / triangle pipelines +
//! selection + hidden-layer set + per-tab Move-tool undo stack. Opening a
//! new file always creates a new tab (Ctrl+O / File menu / Samples panel
//! all push). Close with the Ã— button on the tab or Ctrl+W. Cycle with
//! Ctrl+Tab / Ctrl+Shift+Tab.
//!
//! Usage:
//!   open_2d_studio                     # no args â€” start with a blank tab
//!   open_2d_studio <base>              # legacy "base" mode: open <base>.dxf + <base>.dwg as two tabs
//!   open_2d_studio file.dxf file.dwg â€¦ # each arg becomes a tab

use bytemuck::{Pod, Zeroable};
use egui_wgpu::ScreenDescriptor;
use std::collections::{HashMap, HashSet};
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc;
use std::time::Instant;
use winit::application::ApplicationHandler;
use winit::event::{ElementState, KeyEvent, MouseButton, MouseScrollDelta, WindowEvent};
use winit::event_loop::{ActiveEventLoop, EventLoop};
use winit::keyboard::{KeyCode, ModifiersState, PhysicalKey};
use winit::window::Window;

// superui â€” reusable chrome widgets (titlebar, ribbon, file-tab bar,
// status bar). Phase 1 of the UI-crate migration replaces the inline
// painter helpers below with these data-driven widgets so future
// applications can reuse them.
use superui::{
    apply_theme, Theme,
    layout::{
        TitleBar, TitleBarAction,
        Ribbon, RibbonAction, RibbonTabId, RibbonTabDef, RibbonGroup, RibbonGroupLayout, RibbonButtonDef, ButtonSize,
        FileTabBar, FileTabAction, FileTabDef,
        StatusBar, StatusSection, StatusBarAction,
    },
    panels::{LeftDock, LeftDockAction, DrawingItem, SheetItem,
             RightDock, RightDockAction,
             StructureTree, StructureTreeAction, TreeNode, NodeKind},
    panels::right_dock::RightDockState,
    dialogs::{AppMenuAction, AppMenuPanel},
    icon::IconKind,
};

// Scene / Segment / load_dxf / load_dwg are shared with headless_render.rs
// via the kernel_app::scene_io module. See crates/app/src/scene_io.rs for
// the implementation (INSERT block expansion, HATCH boundary tessellation,
// affine transform composition, etc.).
use crate::scene_io::{load_dwg, load_dxf, Scene, TriKind};
use crate::ifcx_export::write_ifcx_binary;
use crate::dxf_export::write_dxf_filtered;
use kernel_spatial::{SegmentEntry, SegmentIndex};
use kernel_snap::{SnapContext, SnapEngine, SnapMode, SnapModeSet, SnapResult};

// =============================================================================
// SceneIndex â€” combined acceleration structure for picking + selection rebuild.
//
// Built lazily on the first cursor-move after a scene loads (and dropped on any
// mutation that touches `scene.segments` or `segment_entity_idx`). Two pieces:
//
//   * `seg_rtree` â€” `kernel_spatial::SegmentIndex` over the segment AABBs.
//     Replaces a 688k linear scan in `pick_segment_at_in` with an
//     O(log n + k) point query.
//
//   * `entity_to_segs` â€” for every `entity_idx` value in the scene, the list
//     of segment indices that share that id. Replaces a 688k linear scan
//     in `rebuild_sel_pipe` (per selected/hovered entity) with a direct
//     `Vec<u32>` lookup.
// =============================================================================
struct SceneIndex {
    seg_rtree: SegmentIndex,
    /// Indexed by `entity_idx`. Empty inner Vecs are normal â€” entity ids
    /// are dense but small gaps occur. Built once per scene-load.
    entity_to_segs: Vec<Vec<u32>>,
}

impl SceneIndex {
    /// Build both structures from the scene in one pass over `segments`.
    /// Caller is responsible for calling this only when the scene has
    /// at least one segment â€” early-out is up to them.
    fn build(scene: &Scene) -> Self {
        let n = scene.segments.len();
        let have_eids = scene.segment_entity_idx.len() == n && n > 0;

        // Pre-size entity_to_segs by scanning for the max eid (one O(n) pass).
        let max_eid = if have_eids {
            scene.segment_entity_idx.iter().copied().max().unwrap_or(0) as usize
        } else { 0 };
        let mut entity_to_segs: Vec<Vec<u32>> = if have_eids {
            vec![Vec::new(); max_eid + 1]
        } else { Vec::new() };

        // Build the rtree entry list and the entity â†’ segs lookup together.
        let mut entries: Vec<SegmentEntry> = Vec::with_capacity(n);
        for (i, s) in scene.segments.iter().enumerate() {
            let (xmin, xmax) = if s.p1[0] <= s.p2[0] { (s.p1[0], s.p2[0]) } else { (s.p2[0], s.p1[0]) };
            let (ymin, ymax) = if s.p1[1] <= s.p2[1] { (s.p1[1], s.p2[1]) } else { (s.p2[1], s.p1[1]) };
            entries.push(SegmentEntry {
                seg_idx: i as u32,
                min: [xmin, ymin],
                max: [xmax, ymax],
            });
            if have_eids {
                let eid = scene.segment_entity_idx[i] as usize;
                entity_to_segs[eid].push(i as u32);
            }
        }
        let seg_rtree = SegmentIndex::bulk_load(entries);
        Self { seg_rtree, entity_to_segs }
    }
}


// =============================================================================
// GPU rendering (line pipeline â€” one buffer per tab)
// =============================================================================

#[repr(C)]
#[derive(Copy, Clone, Pod, Zeroable)]
struct Vertex { pos: [f32; 2], color: u32, _pad: u32 }

#[repr(C)]
#[derive(Copy, Clone, Pod, Zeroable)]
struct CameraUbo { view_proj: [[f32; 4]; 4] }

struct LinePipeline {
    pipeline: wgpu::RenderPipeline,
    vb: wgpu::Buffer,
    vertex_count: u32,
    camera_ub: wgpu::Buffer,
    camera_bg: wgpu::BindGroup,
}

impl LinePipeline {
    fn new(device: &wgpu::Device, format: wgpu::TextureFormat, verts: &[Vertex]) -> Self {
        Self::new_with_topology(device, format, wgpu::PrimitiveTopology::LineList, verts)
    }
    fn new_tri(device: &wgpu::Device, format: wgpu::TextureFormat, verts: &[Vertex]) -> Self {
        Self::new_with_topology(device, format, wgpu::PrimitiveTopology::TriangleList, verts)
    }
    fn new_with_topology(
        device: &wgpu::Device,
        format: wgpu::TextureFormat,
        topology: wgpu::PrimitiveTopology,
        verts: &[Vertex],
    ) -> Self {
        let capacity = verts.len().max(2) as u64;
        let vb = device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("scene-vb"),
            size: capacity * std::mem::size_of::<Vertex>() as u64,
            usage: wgpu::BufferUsages::VERTEX | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });
        let camera_ub = device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("camera-ub"),
            size: std::mem::size_of::<CameraUbo>() as u64,
            usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });
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
        let camera_bg = device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: None, layout: &bgl,
            entries: &[wgpu::BindGroupEntry { binding: 0, resource: camera_ub.as_entire_binding() }],
        });
        let shader = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: None, source: wgpu::ShaderSource::Wgsl(LINE_WGSL.into()),
        });
        let pl_layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: None, bind_group_layouts: &[&bgl], push_constant_ranges: &[],
        });
        let vert_layout = wgpu::VertexBufferLayout {
            array_stride: std::mem::size_of::<Vertex>() as u64,
            step_mode: wgpu::VertexStepMode::Vertex,
            attributes: &wgpu::vertex_attr_array![0 => Float32x2, 1 => Uint32],
        };
        let pipeline = device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
            label: None, layout: Some(&pl_layout),
            vertex: wgpu::VertexState {
                module: &shader, entry_point: "vs_main",
                buffers: &[vert_layout],
                compilation_options: Default::default(),
            },
            primitive: wgpu::PrimitiveState {
                topology,
                cull_mode: None,
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
        Self { pipeline, vb, vertex_count: 0, camera_ub, camera_bg }
    }

    fn upload(&mut self, queue: &wgpu::Queue, verts: &[Vertex]) {
        queue.write_buffer(&self.vb, 0, bytemuck::cast_slice(verts));
        self.vertex_count = verts.len() as u32;
    }

    fn update_camera(&self, queue: &wgpu::Queue, cam: CameraUbo) {
        queue.write_buffer(&self.camera_ub, 0, bytemuck::cast_slice(&[cam]));
    }
}

// =============================================================================
// Ribbon â€” design tokens + custom-drawn vector icons
// =============================================================================
//
// The ribbon style is defined once here as an immutable palette. Goal: remove
// the "techy" feel of emoji + default dark theme and land on a warm-dark,
// designer-friendly look â€” VSCode-blue accents, off-white labels, subtle
// group separators. All buttons draw their own icons via `egui::Painter`
// (see `paint_icon`) so stroke weight, metrics and colour stay uniform at
// every zoom level â€” unlike font-embedded emoji which render inconsistently.

#[derive(Copy, Clone)]
struct RibbonStyle {
    bg:          egui::Color32, // panel background
    separator:   egui::Color32, // vertical group separator + top/bottom hair-lines
    label:       egui::Color32, // group header label (uppercase, small)
    label_bold:  egui::Color32, // button caption
    icon:        egui::Color32, // default icon stroke / fill
    accent:      egui::Color32, // selected fill
    accent_soft: egui::Color32, // hover fill
    disabled:    egui::Color32, // disabled icon + label
}

impl RibbonStyle {
    const fn dark() -> Self {
        Self {
            bg:          egui::Color32::from_rgb( 36,  40,  44),
            separator:   egui::Color32::from_rgb( 58,  62,  68),
            label:       egui::Color32::from_rgb(140, 146, 154),
            label_bold:  egui::Color32::from_rgb(210, 214, 218),
            icon:        egui::Color32::from_rgb(220, 224, 228),
            accent:      egui::Color32::from_rgb(  0, 122, 204),
            accent_soft: egui::Color32::from_rgba_premultiplied(48, 56, 72, 180),
            disabled:    egui::Color32::from_rgb( 96, 100, 108),
        }
    }
}

const RIBBON: RibbonStyle = RibbonStyle::dark();

/// World-origin XY-axes glyph â€” a small UCS-icon-style cross painted at
/// world (0,0) so the user can see where the drawing's origin sits
/// regardless of pan/zoom. Pans + zooms with the camera (NOT screen-
/// anchored). Red X-arrow, green Y-arrow, small "0" label at the cross.
///
/// Only paints when (0,0) maps to a screen position within ~50 px of the
/// Paint a world-space grid overlay. Stride adapts to camera zoom so
/// we keep the visible line count between 8 and 80 — at very zoomed-
/// out levels the 10 mm primary grid would degenerate into a flat
/// grey, so we promote to 100 mm / 1 m / 10 m / 100 m as needed.
/// Rotation-aware: world axes rotate with `cam_rotation`.
fn paint_world_grid(
    painter: &egui::Painter,
    canvas_rect_logical: egui::Rect,
    cam_origin: [f64; 2],
    cam_pan: (f64, f64),
    cam_zoom: f64,
    cam_rotation: f64,
    white_bg: bool,
) {
    if canvas_rect_logical.width() <= 1.0 || canvas_rect_logical.height() <= 1.0 {
        return;
    }
    let cx = canvas_rect_logical.center().x;
    let cy = canvas_rect_logical.center().y;
    let h = canvas_rect_logical.height().max(1.0) as f64;
    let wpp = (2.0 / cam_zoom) / h;
    if !wpp.is_finite() || wpp <= 0.0 { return; }

    // Adaptive stride. Start at 10 mm; bump by ×10 until the on-screen
    // spacing is ≥ 14 px (i.e. lines don't blur together). Cap stride
    // growth so a hugely zoomed-out scene doesn't produce just one or
    // two lines.
    let mut stride_world = 10.0_f64;
    while (stride_world / wpp) < 14.0 && stride_world < 1.0e7 {
        stride_world *= 10.0;
    }
    let stride_px = stride_world / wpp;
    if !stride_px.is_finite() || stride_px <= 0.0 { return; }

    // Camera-to-world transform of the canvas corners — we need to
    // know the world-space bbox of the visible rect so we only paint
    // lines that could possibly cross it. Account for rotation by
    // taking the axis-aligned hull of the rotated rect.
    let half_w_screen = canvas_rect_logical.width() as f64 * 0.5;
    let half_h_screen = canvas_rect_logical.height() as f64 * 0.5;
    let half_w = half_w_screen * wpp;
    let half_h = half_h_screen * wpp;
    let th = cam_rotation;
    let (ct, st) = (th.cos(), th.sin());
    // Inverse rotation to map screen-space deltas back into world.
    // Plus a slack of ~2 strides so edges don't pop.
    let world_half_x = (half_w * ct.abs() + half_h * st.abs()) + 2.0 * stride_world;
    let world_half_y = (half_w * st.abs() + half_h * ct.abs()) + 2.0 * stride_world;
    let cx_world = cam_pan.0 + cam_origin[0];
    let cy_world = cam_pan.1 + cam_origin[1];

    // Snap the bbox edges to the nearest stride below / above.
    let x_min = ((cx_world - world_half_x) / stride_world).floor() * stride_world;
    let x_max = ((cx_world + world_half_x) / stride_world).ceil()  * stride_world;
    let y_min = ((cy_world - world_half_y) / stride_world).floor() * stride_world;
    let y_max = ((cy_world + world_half_y) / stride_world).ceil()  * stride_world;

    // Hard cap line count as a safety net (shouldn't fire with the
    // adaptive stride above, but a tiny screen at 1× zoom could).
    let max_lines = 200_i32;
    let nx = (((x_max - x_min) / stride_world).round() as i32 + 1).clamp(2, max_lines);
    let ny = (((y_max - y_min) / stride_world).round() as i32 + 1).clamp(2, max_lines);

    // World → screen for a single world point (rotation-aware).
    let to_screen = |wx: f64, wy: f64| -> egui::Pos2 {
        let wx_off = wx - cam_pan.0 - cam_origin[0];
        let wy_off = wy - cam_pan.1 - cam_origin[1];
        let ex = ct * wx_off - st * wy_off;
        let ey = st * wx_off + ct * wy_off;
        egui::pos2(cx + (ex / wpp) as f32, cy - (ey / wpp) as f32)
    };

    // Two tints so the grid stays visible on both backgrounds.
    let line = if white_bg {
        egui::Color32::from_rgba_unmultiplied(0, 0, 0, 32)
    } else {
        egui::Color32::from_rgba_unmultiplied(255, 255, 255, 26)
    };
    let stroke = egui::Stroke::new(1.0, line);

    // Vertical lines (parallel to world Y).
    for i in 0..nx {
        let wx = x_min + (i as f64) * stride_world;
        let s1 = to_screen(wx, y_min);
        let s2 = to_screen(wx, y_max);
        painter.line_segment([s1, s2], stroke);
    }
    // Horizontal lines (parallel to world X).
    for j in 0..ny {
        let wy = y_min + (j as f64) * stride_world;
        let s1 = to_screen(x_min, wy);
        let s2 = to_screen(x_max, wy);
        painter.line_segment([s1, s2], stroke);
    }
}

/// canvas rect â€” otherwise the glyph would be off-screen and useless.
///
/// `canvas_rect_logical` is the LOGICAL-pixel canvas area (from
/// `ui.available_rect_before_wrap`). The cam snapshot's pan / zoom /
/// rotation / origin drive the world-to-screen transform â€” mirrors
/// `world_to_screen_*_helper` exactly except in logical pixels.
fn paint_world_axes(
    painter: &egui::Painter,
    canvas_rect_logical: egui::Rect,
    cam_origin: [f64; 2],
    cam_pan: (f64, f64),
    cam_zoom: f64,
    cam_rotation: f64,
) {
    if !canvas_rect_logical.width().is_finite()
        || !canvas_rect_logical.height().is_finite()
        || canvas_rect_logical.width() <= 1.0
        || canvas_rect_logical.height() <= 1.0
    {
        return;
    }
    // Transform world (0,0) to logical-pixel screen coordinates.
    // Mirrors `world_to_screen_x/y_helper` but the rect here is in
    // LOGICAL pixels (egui CentralPanel) so no ppp division is needed.
    let cx = canvas_rect_logical.center().x;
    let cy = canvas_rect_logical.center().y;
    let h = canvas_rect_logical.height().max(1.0) as f64;
    let wpp = (2.0 / cam_zoom) / h;
    let wx_off = 0.0 - cam_pan.0 - cam_origin[0];
    let wy_off = 0.0 - cam_pan.1 - cam_origin[1];
    let th = cam_rotation;
    let (ct, st) = (th.cos(), th.sin());
    let ex = ct * wx_off - st * wy_off;
    let ey = st * wx_off + ct * wy_off;
    let sx = cx + (ex / wpp) as f32;
    let sy = cy - (ey / wpp) as f32;
    let origin_screen = egui::pos2(sx, sy);

    // Off-screen culling. Allow the glyph to remain visible when the
    // origin itself is just outside the canvas (within ~50 px), since
    // the arrows extend ~24 px and the label hugs the origin.
    let cull_margin = 50.0_f32;
    let visible_rect = canvas_rect_logical.expand(cull_margin);
    if !visible_rect.contains(origin_screen) {
        return;
    }

    // Screen-space sizing â€” axes do NOT scale with zoom (otherwise they'd
    // become huge or vanish). Always ~24 px tall.
    let arm_len = 24.0_f32;
    let arrowhead = 5.0_f32;
    let red = egui::Color32::from_rgb(0xD4, 0x44, 0x44);
    let green = egui::Color32::from_rgb(0x44, 0xD4, 0x44);
    // Screen +Y is DOWN, world +Y is UP â€” so the world Y-arrow points
    // up on screen (negative screen Y).
    let x_tip = egui::pos2(sx + arm_len, sy);
    let y_tip = egui::pos2(sx, sy - arm_len);

    // Slight halo behind the lines so they read against any background.
    let halo = egui::Color32::from_rgba_unmultiplied(0, 0, 0, 130);
    painter.line_segment(
        [origin_screen, x_tip],
        egui::Stroke::new(3.5, halo),
    );
    painter.line_segment(
        [origin_screen, y_tip],
        egui::Stroke::new(3.5, halo),
    );

    // X-axis (red).
    painter.line_segment(
        [origin_screen, x_tip],
        egui::Stroke::new(1.8, red),
    );
    // X arrowhead â€” simple convex triangle.
    painter.add(egui::Shape::convex_polygon(
        vec![
            x_tip,
            egui::pos2(x_tip.x - arrowhead, sy - arrowhead * 0.6),
            egui::pos2(x_tip.x - arrowhead, sy + arrowhead * 0.6),
        ],
        red,
        egui::Stroke::NONE,
    ));

    // Y-axis (green).
    painter.line_segment(
        [origin_screen, y_tip],
        egui::Stroke::new(1.8, green),
    );
    // Y arrowhead.
    painter.add(egui::Shape::convex_polygon(
        vec![
            y_tip,
            egui::pos2(sx - arrowhead * 0.6, y_tip.y + arrowhead),
            egui::pos2(sx + arrowhead * 0.6, y_tip.y + arrowhead),
        ],
        green,
        egui::Stroke::NONE,
    ));

    // Axis letter labels next to the arrow tips. Small halo per label
    // so they remain legible on white/black scenes.
    let font = egui::FontId::proportional(11.0);
    let label_color = egui::Color32::from_rgb(230, 230, 230);
    let x_lbl_pos = egui::pos2(x_tip.x + 4.0, x_tip.y - 6.0);
    let y_lbl_pos = egui::pos2(y_tip.x - 4.0, y_tip.y - 12.0);
    for &(pos, txt) in &[
        (x_lbl_pos, "X"),
        (y_lbl_pos, "Y"),
    ] {
        // Outline (4 cardinal offsets) for readability against any bg.
        for (dx, dy) in [(-1.0, 0.0), (1.0, 0.0), (0.0, -1.0), (0.0, 1.0)] {
            painter.text(
                egui::pos2(pos.x + dx, pos.y + dy),
                egui::Align2::LEFT_TOP,
                txt,
                font.clone(),
                egui::Color32::from_black_alpha(180),
            );
        }
        painter.text(pos, egui::Align2::LEFT_TOP, txt, font.clone(), label_color);
    }

    // Small "0" label just below-left of the origin for clarity.
    let zero_pos = egui::pos2(sx - 10.0, sy + 3.0);
    let small_font = egui::FontId::proportional(9.0);
    for (dx, dy) in [(-1.0, 0.0), (1.0, 0.0), (0.0, -1.0), (0.0, 1.0)] {
        painter.text(
            egui::pos2(zero_pos.x + dx, zero_pos.y + dy),
            egui::Align2::LEFT_TOP,
            "0",
            small_font.clone(),
            egui::Color32::from_black_alpha(180),
        );
    }
    painter.text(zero_pos, egui::Align2::LEFT_TOP, "0",
        small_font, egui::Color32::from_rgb(210, 210, 210));
}

/// Ribbon group â€” a vertical stack with a row of buttons, a thin 1 px top
/// and bottom hair-line, and a small uppercase label below. The subtle
/// border framing boxes the group without adding visual noise.
///
/// The contents closure is expected to place buttons in a horizontal row;
/// big buttons (48Ã—52) and small-label stacks (3 Ã— 22 px) are centred on a
/// common vertical axis so the group looks balanced regardless of which
/// primitives it mixes.

/// Paint an OSNAP marker at the snap-hit point. Shape encodes the mode
/// (AutoCAD convention): square=Endpoint, triangle=Midpoint, circle=Center,
/// X=Intersection, inverted-T=Perpendicular, hour-glass=Nearest, etc.
fn paint_snap_marker(
    painter: &egui::Painter,
    canvas_rect_logical: egui::Rect,
    snap_point_screen: egui::Pos2,
    kind: SnapMode,
) {
    if !canvas_rect_logical.contains(snap_point_screen) {
        return;
    }
    let p = snap_point_screen;
    let r = 6.0_f32;
    let color = egui::Color32::from_rgb(255, 220, 60);
    let halo = egui::Color32::from_rgba_unmultiplied(0, 0, 0, 150);
    let stroke = egui::Stroke::new(1.8, color);
    let halo_stroke = egui::Stroke::new(3.4, halo);
    match kind {
        SnapMode::Endpoint => {
            let rect = egui::Rect::from_center_size(p, egui::vec2(r * 2.0, r * 2.0));
            painter.rect_stroke(rect, 0.0, halo_stroke);
            painter.rect_stroke(rect, 0.0, stroke);
        }
        SnapMode::Midpoint => {
            let pts = vec![
                egui::pos2(p.x, p.y - r),
                egui::pos2(p.x - r * 0.866, p.y + r * 0.5),
                egui::pos2(p.x + r * 0.866, p.y + r * 0.5),
            ];
            painter.add(egui::Shape::closed_line(pts.clone(), halo_stroke));
            painter.add(egui::Shape::closed_line(pts, stroke));
        }
        SnapMode::Center => {
            painter.circle_stroke(p, r, halo_stroke);
            painter.circle_stroke(p, r, stroke);
            painter.circle_filled(p, 1.0, color);
        }
        SnapMode::Intersection => {
            painter.line_segment(
                [egui::pos2(p.x - r, p.y - r), egui::pos2(p.x + r, p.y + r)],
                halo_stroke);
            painter.line_segment(
                [egui::pos2(p.x - r, p.y + r), egui::pos2(p.x + r, p.y - r)],
                halo_stroke);
            painter.line_segment(
                [egui::pos2(p.x - r, p.y - r), egui::pos2(p.x + r, p.y + r)],
                stroke);
            painter.line_segment(
                [egui::pos2(p.x - r, p.y + r), egui::pos2(p.x + r, p.y - r)],
                stroke);
        }
        SnapMode::Perpendicular => {
            let bar_w = r;
            let h = r * 1.2;
            painter.line_segment(
                [egui::pos2(p.x - bar_w, p.y + h * 0.5),
                 egui::pos2(p.x + bar_w, p.y + h * 0.5)],
                halo_stroke);
            painter.line_segment(
                [egui::pos2(p.x, p.y - h * 0.5),
                 egui::pos2(p.x, p.y + h * 0.5)],
                halo_stroke);
            painter.line_segment(
                [egui::pos2(p.x - bar_w, p.y + h * 0.5),
                 egui::pos2(p.x + bar_w, p.y + h * 0.5)],
                stroke);
            painter.line_segment(
                [egui::pos2(p.x, p.y - h * 0.5),
                 egui::pos2(p.x, p.y + h * 0.5)],
                stroke);
        }
        SnapMode::Nearest => {
            let pts1 = vec![
                egui::pos2(p.x - r, p.y - r),
                egui::pos2(p.x + r, p.y - r),
                egui::pos2(p.x, p.y),
            ];
            let pts2 = vec![
                egui::pos2(p.x - r, p.y + r),
                egui::pos2(p.x + r, p.y + r),
                egui::pos2(p.x, p.y),
            ];
            painter.add(egui::Shape::closed_line(pts1.clone(), halo_stroke));
            painter.add(egui::Shape::closed_line(pts2.clone(), halo_stroke));
            painter.add(egui::Shape::closed_line(pts1, stroke));
            painter.add(egui::Shape::closed_line(pts2, stroke));
        }
        SnapMode::Parallel | SnapMode::Tangent | SnapMode::Alignment => {
            painter.circle_stroke(p, r, halo_stroke);
            painter.circle_stroke(p, r, stroke);
        }
        SnapMode::Origin => {
            painter.circle_stroke(p, r, halo_stroke);
            painter.line_segment(
                [egui::pos2(p.x - r, p.y), egui::pos2(p.x + r, p.y)],
                halo_stroke);
            painter.line_segment(
                [egui::pos2(p.x, p.y - r), egui::pos2(p.x, p.y + r)],
                halo_stroke);
            painter.circle_stroke(p, r, stroke);
            painter.line_segment(
                [egui::pos2(p.x - r, p.y), egui::pos2(p.x + r, p.y)],
                stroke);
            painter.line_segment(
                [egui::pos2(p.x, p.y - r), egui::pos2(p.x, p.y + r)],
                stroke);
        }
        SnapMode::Grid => {
            painter.circle_filled(p, 2.0, color);
        }
    }
}

/// 2D view-cube / nav-disk widget painted in the bottom-right corner of
/// the canvas. For 2D CAD the "cube" is a compass-wheel: a dark disk
/// with 4 cardinal arrows that rotate with the camera, a centre "Fit"
/// button, and a top-right "1:1" reset pip.
///
/// Interaction:
///   * click N / E / S / W â€” snap the camera rotation to the nearest
///     90Â° multiple that aligns world +X with screen right (E), etc.
///   * drag anywhere on the disk â€” rotate the camera by the angular
///     delta from the drag-start position around the disk centre.
///   * click centre   â€” fit extents (requested_fit)
///   * click 1:1 pip  â€” reset zoom to 1 + fit (requested_home)
///
/// `rotation_out` receives a new absolute rotation (radians, CCW +ve)
/// when the user rotates; callers assign it into cam.rotation so the
/// drawing rotates live.
fn paint_view_cube(
    ctx: &egui::Context,
    _canvas_rect: egui::Rect,
    current_rotation: f64,
    rotation_out: &mut Option<f64>,
    requested_fit: &mut bool,
    requested_home: &mut bool,
) {
    // Paint via an egui Area anchored to the bottom-right of the whole
    // window. This is the same pattern the Perf HUD uses â€” which has
    // always rendered reliably on this pipeline â€” in contrast to
    // `fixed_pos` Areas or direct `ui.painter()` calls inside the
    // CentralPanel closure, which do NOT render reliably in the
    // bottom-right quadrant on this wgpu+egui stack.
    let diameter: f32 = 72.0;
    let widget_size = egui::vec2(diameter + 20.0, diameter + 20.0);
    let area_resp = egui::Area::new(egui::Id::new("view_cube"))
        .order(egui::Order::Tooltip)
        .anchor(egui::Align2::RIGHT_BOTTOM, egui::vec2(-20.0, -36.0))
        .interactable(true)
        .show(ctx, |ui| {
            // Allocate the full widget rect so the Area sizes itself
            // correctly â€” the later painter draws at absolute screen
            // coords within this allocated rect.
            let (rect, disk_resp) = ui.allocate_exact_size(
                widget_size,
                egui::Sense::click_and_drag(),
            );
            let painter = ui.painter();

    let c = rect.center();
    let r = diameter * 0.5;
    let th = current_rotation as f32;
    let (ct, st) = (th.cos(), th.sin());
    // Rotate a compass-space unit vector into screen-space. Compass
    // "N" (0,-1) should point visually up when rotation=0, and rotate
    // counter-clockwise on screen when rotation grows positive â€” which
    // matches the world rotating CCW under the cursor.
    let rot_pt = |dx: f32, dy: f32| -> egui::Pos2 {
        // Forward rotate by +th so the disk's cardinals counter-rotate
        // relative to the world below (i.e. the drawing appears to spin
        // under a fixed visual compass frame).
        let rx =  ct * dx + st * dy;
        let ry = -st * dx + ct * dy;
        egui::pos2(c.x + rx, c.y + ry)
    };

    // Disk fill + stroke (opaque so the widget stands out on any scene).
    painter.circle_filled(c, r, egui::Color32::from_rgba_unmultiplied(26, 30, 36, 235));
    painter.circle_stroke(
        c, r,
        egui::Stroke::new(1.2, egui::Color32::from_rgb(110, 120, 135)),
    );

    // Four cardinal arrows â€” compass space, rotated to screen by rot_pt.
    let arrow_r_outer = r * 0.88;
    let arrow_r_inner = r * 0.52;
    let arrow_half    = r * 0.18;
    let dirs: [(&str, f32, f32, f32); 4] = [
        ("N", 0.0, -1.0, 0.0),
        ("E", 1.0,  0.0, std::f32::consts::FRAC_PI_2),
        ("S", 0.0,  1.0, std::f32::consts::PI),
        ("W",-1.0,  0.0,-std::f32::consts::FRAC_PI_2),
    ];
    for (label, dx, dy, _ang) in dirs {
        let tip   = rot_pt(dx * arrow_r_outer, dy * arrow_r_outer);
        let (px, py) = (-dy, dx);
        let base_a = rot_pt(dx * arrow_r_inner + px * arrow_half,
                            dy * arrow_r_inner + py * arrow_half);
        let base_b = rot_pt(dx * arrow_r_inner - px * arrow_half,
                            dy * arrow_r_inner - py * arrow_half);
        // Hit-test a small rect at the arrow's screen-space midpoint.
        let hit_centre = rot_pt(
            dx * (arrow_r_inner + arrow_r_outer) * 0.5,
            dy * (arrow_r_inner + arrow_r_outer) * 0.5,
        );
        let hit_rect = egui::Rect::from_center_size(
            hit_centre,
            egui::vec2(arrow_half * 2.4, arrow_half * 2.4),
        );
        let resp = ui.interact(
            hit_rect,
            ui.id().with(("viewcube_arrow", label)),
            egui::Sense::click(),
        );
        let col = if resp.hovered() {
            egui::Color32::from_rgb(90, 170, 235)
        } else if label == "N" {
            // Red-ish N so the current-north orientation is obvious.
            egui::Color32::from_rgb(230, 100,  95)
        } else {
            egui::Color32::from_rgb(180, 190, 205)
        };
        painter.add(egui::Shape::convex_polygon(
            vec![tip, base_a, base_b], col, egui::Stroke::NONE,
        ));
        // Label â€” small letter inside the arrow, also counter-rotated
        // so it reads upright regardless of camera rotation.
        let lbl_pos = rot_pt(
            dx * (arrow_r_outer - 8.0),
            dy * (arrow_r_outer - 8.0),
        );
        let font = egui::FontId::proportional(9.0);
        let galley = painter.layout_no_wrap(label.into(), font, egui::Color32::WHITE);
        painter.galley(
            egui::pos2(
                lbl_pos.x - galley.size().x * 0.5,
                lbl_pos.y - galley.size().y * 0.5,
            ),
            galley, egui::Color32::WHITE,
        );
        if resp.on_hover_text(format!("Snap view to {}", label)).clicked() {
            // Compass click snaps the CAMERA rotation so the chosen
            // compass direction points up on screen.
            use std::f64::consts::{FRAC_PI_2, PI};
            let target = match label {
                "N" => 0.0,
                "E" => -FRAC_PI_2,
                "S" =>  PI,
                "W" =>  FRAC_PI_2,
                _ => 0.0,
            };
            *rotation_out = Some(target);
        }
    }

    // Centre "Fit" button.
    let center_r = r * 0.26;
    let center_rect = egui::Rect::from_center_size(c, egui::vec2(center_r * 2.0, center_r * 2.0));
    let center_resp = ui.interact(
        center_rect, ui.id().with("viewcube_center"), egui::Sense::click(),
    );
    let center_col = if center_resp.hovered() {
        egui::Color32::from_rgb(0, 122, 204)
    } else {
        egui::Color32::from_rgb(60, 70, 84)
    };
    painter.circle_filled(c, center_r, center_col);
    painter.circle_stroke(
        c, center_r,
        egui::Stroke::new(1.0, egui::Color32::from_rgb(140, 150, 164)),
    );
    // Home/house glyph.
    let hstroke = egui::Stroke::new(1.3, egui::Color32::WHITE);
    let hs = center_r * 0.55;
    painter.line_segment([egui::pos2(c.x - hs, c.y + hs * 0.3), egui::pos2(c.x, c.y - hs * 0.8)], hstroke);
    painter.line_segment([egui::pos2(c.x, c.y - hs * 0.8), egui::pos2(c.x + hs, c.y + hs * 0.3)], hstroke);
    painter.line_segment([egui::pos2(c.x - hs * 0.7, c.y + hs * 0.2), egui::pos2(c.x - hs * 0.7, c.y + hs * 0.8)], hstroke);
    painter.line_segment([egui::pos2(c.x + hs * 0.7, c.y + hs * 0.2), egui::pos2(c.x + hs * 0.7, c.y + hs * 0.8)], hstroke);
    painter.line_segment([egui::pos2(c.x - hs * 0.7, c.y + hs * 0.8), egui::pos2(c.x + hs * 0.7, c.y + hs * 0.8)], hstroke);
    if center_resp.on_hover_text("Fit extents  (F)").clicked() {
        *requested_fit = true;
    }

    // 1:1 reset-zoom pip.
    let pip_pos  = egui::pos2(c.x + r * 0.70, c.y - r * 0.70);
    let pip_rect = egui::Rect::from_center_size(pip_pos, egui::vec2(16.0, 16.0));
    let pip_resp = ui.interact(
        pip_rect, ui.id().with("viewcube_home"), egui::Sense::click(),
    );
    let pip_col = if pip_resp.hovered() {
        egui::Color32::from_rgb(90, 170, 235)
    } else {
        egui::Color32::from_rgb(200, 206, 212)
    };
    painter.circle_filled(pip_pos, 7.0, egui::Color32::from_rgba_unmultiplied(40, 46, 54, 240));
    painter.circle_stroke(pip_pos, 7.0, egui::Stroke::new(1.0, pip_col));
    let galley = painter.layout_no_wrap(
        "1:1".into(), egui::FontId::proportional(7.5), pip_col,
    );
    painter.galley(
        egui::pos2(
            pip_pos.x - galley.size().x * 0.5,
            pip_pos.y - galley.size().y * 0.5,
        ),
        galley, pip_col,
    );
    if pip_resp.on_hover_text("Reset zoom to 1:1 + fit").clicked() {
        *requested_home = true;
    }

    // Drag rotation â€” skip if the pointer is inside one of the
    // click-only sub-widgets above (center/pip/arrows consume events).
    // egui's `ui.interact` will already mark those sub-rects as clicked,
    // but drag still fires on the outer disk rect. Use the raw pointer
    // delta around the disk centre.
    if disk_resp.dragged() {
        if let Some(ptr) = ui.ctx().pointer_interact_pos() {
            let prev = ptr - disk_resp.drag_delta();
            // Angle of cursor relative to disk centre, before & after.
            let a0 = (prev.y - c.y).atan2(prev.x - c.x);
            let a1 = (ptr.y  - c.y).atan2(ptr.x  - c.x);
            let mut delta = (a1 - a0) as f64;
            // Unwrap the atan2 discontinuity across Â±Ï€.
            if delta >  std::f64::consts::PI { delta -= std::f64::consts::TAU; }
            if delta < -std::f64::consts::PI { delta += std::f64::consts::TAU; }
            // Drag CW on screen â†’ camera rotates CW â†’ rotation decreases
            // (since compass counter-rotates). Use the signed screen
            // angle directly; empirically this matches user expectation.
            *rotation_out = Some(current_rotation - delta);
        }
    }
        });
    let _ = area_resp;
}

/// Result carrier for `side_panel_header`: report header-button activations
/// to the caller without borrowing closure state.
struct PanelHeaderResult {
    chevron_clicked: bool,
}

/// Docked tool-window title bar â€” a 22 px tall strip with a small title
/// label on the left and a chevron-style close/collapse button on the
/// right. Gives side panels the "docked tool window" look from the
/// TrueView reference. The `_extra` closure is reserved for future extra
/// right-aligned header buttons; currently unused at call sites.
fn side_panel_header(
    ui: &mut egui::Ui,
    title: &str,
    _extra: impl FnOnce(),
    on_result: &mut dyn FnMut(PanelHeaderResult),
) {
    // Mockup spec (lines 404-422): bg `surface`, 1 px `border-light`
    // bottom, caret 14 px + label 12 px (text), sublabel 10 px right-
    // aligned. Header height 24 px.
    let palette = superui::theme::Theme::Default.palette();
    let header_h = 24.0;
    let full_w = ui.available_width();
    let (rect, _resp) = ui.allocate_exact_size(
        egui::vec2(full_w, header_h),
        egui::Sense::hover(),
    );
    let painter = ui.painter_at(rect);
    painter.rect_filled(rect, 0.0, palette.panel_bg);
    painter.line_segment(
        [egui::pos2(rect.left(), rect.bottom() - 0.5),
         egui::pos2(rect.right(), rect.bottom() - 0.5)],
        egui::Stroke::new(1.0, palette.border_light),
    );
    // Caret-down on the left (mockup `Lucide.chevD`).
    painter.text(
        egui::pos2(rect.left() + 10.0, rect.center().y),
        egui::Align2::LEFT_CENTER,
        egui_phosphor::regular::CARET_DOWN,
        egui::FontId::new(12.0, egui::FontFamily::Proportional),
        palette.fg_dim,
    );
    // Title — mockup uses 12 px proportional, weight 500.
    painter.text(
        egui::pos2(rect.left() + 26.0, rect.center().y),
        egui::Align2::LEFT_CENTER,
        title,
        egui::FontId::proportional(12.0),
        palette.fg,
    );
    // Close × button — 16x16 at the right edge.
    let btn_size = egui::vec2(16.0, 16.0);
    let btn_rect = egui::Rect::from_min_size(
        egui::pos2(rect.right() - btn_size.x - 6.0, rect.center().y - btn_size.y * 0.5),
        btn_size,
    );
    let btn_resp = ui.interact(btn_rect, egui::Id::new(("panel_close", title)), egui::Sense::click());
    if btn_resp.hovered() {
        painter.rect_filled(btn_rect, 2.0, palette.hover);
    }
    let c = btn_rect.center();
    let k = 4.0;
    let stroke_col = if btn_resp.hovered() { palette.fg } else { palette.fg_dim };
    let stroke = egui::Stroke::new(1.2, stroke_col);
    painter.line_segment(
        [egui::pos2(c.x - k, c.y - k), egui::pos2(c.x + k, c.y + k)], stroke);
    painter.line_segment(
        [egui::pos2(c.x + k, c.y - k), egui::pos2(c.x - k, c.y + k)], stroke);
    on_result(PanelHeaderResult {
        chevron_clicked: btn_resp.clicked(),
    });
}

/// Fallback per-`Scene::segment_dash_kind` value pattern in SCREEN pixels.
/// Only used for legacy scenes that don't carry the world-space
/// `dash_arrays` / `segment_dash_idx` table (the primary code path).
///
/// Each pattern is a slice of `(draw, gap)` pairs in pixels:
///   - `draw == 0.0` is rendered as a single 1-pixel dot.
///   - `gap`  is the unrendered space that follows.
const DASH_PIXEL_PATTERNS: [&[(f32, f32)]; 4] = [
    &[],                                     // 0 = solid (handled inline)
    &[(8.0, 4.0)],                           // 1 = dashed
    &[(0.0, 4.0)],                           // 2 = dotted (1 px dot + 4 px gap)
    &[(8.0, 2.0), (0.0, 2.0)],               // 3 = dash-dot
];

/// Minimum on-screen length, in pixels, for any drawn or gap element of a
/// world-space LINETYPE pattern. At extreme zoom-out the pure
/// `world * pixels_per_world` mapping collapses dashes and gaps below
/// one pixel and the pattern fades to grey mush; clamping each element
/// to this floor keeps the rhythm visible.
const MIN_SCREEN_PX: f32 = 1.5;

/// Global multiplier applied to every world-space LINETYPE dash/gap
/// entry. Equivalent to AutoCAD's `LTSCALE` system variable, defaulted
/// to 100 because architectural drawings in this kernel are stored at
/// millimetre scale (1 world unit = 1 mm) and the raw DXF LINETYPE
/// definitions (e.g. CENTER = 12.7-2.54-2.54-2.54) are tuned for
/// imperial inch-scale drawings (1 unit = 1 inch). Without scaling the
/// dashes appear ~25x too small at architectural 1:100 zoom levels.
/// Configurable later; ship as a constant for now.
const LTSCALE: f32 = 100.0;

/// Build line-segment vertex buffer for a single scene.
///
/// `hidden_layers` filters out segments whose derived layer key is in
/// the set (matches the behaviour of the old 4-pane build_verts).
///
/// `world_per_pixel` is the camera's current world-units-per-screen-pixel
/// factor. World-space dash patterns from `scene.dash_arrays` are
/// converted to screen-space strides on the fly â€” at 1Ã— zoom a
/// 12.7 mm CENTER dash is 12.7 mm on the canvas; zoom in 4Ã— and the
/// dash grows 4Ã— with the geometry. When 0.0 or non-finite all
/// segments render solid.
fn build_verts(
    scene: &Scene,
    origin: [f64; 2],
    default_color: u32,
    want_paper: bool,
    hidden_layers: &HashSet<String>,
    world_per_pixel: f64,
) -> Vec<Vertex> {
    let mut out = Vec::with_capacity(scene.segments.len() * 2);
    let use_real_layers = !scene.layer_names.is_empty()
        && scene.segment_layer_idx.len() == scene.segments.len();
    // New world-space pipeline: dash_arrays[0] is "solid", any other
    // index is a draw/gap pattern in world units (positive = draw,
    // negative = gap, zero = dot).
    let use_world_dash = !scene.dash_arrays.is_empty()
        && scene.segment_dash_idx.len() == scene.segments.len();
    // Legacy fallback: 4-kind screen-pixel patterns. Only consulted
    // when the world-space table is unavailable (old scenes).
    let dash_kinds_ok = !use_world_dash
        && scene.segment_dash_kind.len() == scene.segments.len();
    let wpp = if world_per_pixel.is_finite() && world_per_pixel > 0.0 {
        world_per_pixel as f32
    } else {
        0.0
    };
    let pixels_per_world: f32 = if wpp > 0.0 { 1.0 / wpp } else { 0.0 };
    for (idx, s) in scene.segments.iter().enumerate()
        .filter(|(_, s)| s.is_paper == want_paper)
    {
        let layer_key: String = if use_real_layers {
            let li = scene.segment_layer_idx[idx] as usize;
            scene.layer_names.get(li).cloned()
                .unwrap_or_else(|| layer_key_for_color(s.color))
        } else {
            layer_key_for_color(s.color)
        };
        if hidden_layers.contains(&layer_key) { continue; }
        let p1 = [(s.p1[0] - origin[0]) as f32, (s.p1[1] - origin[1]) as f32];
        let p2 = [(s.p2[0] - origin[0]) as f32, (s.p2[1] - origin[1]) as f32];
        if !p1[0].is_finite() || !p1[1].is_finite() || !p2[0].is_finite() || !p2[1].is_finite() {
            continue;
        }
        let color = if s.color != 0 { s.color } else { default_color };

        // Resolve world-space dash pattern (preferred) or fall back to
        // the legacy screen-pixel table for scenes that don't carry
        // `dash_arrays` yet.
        let world_pattern: Option<&[f64]> = if use_world_dash {
            let di = scene.segment_dash_idx[idx] as usize;
            if di == 0 { None }
            else { scene.dash_arrays.get(di).map(|v| v.as_slice()).filter(|v| !v.is_empty()) }
        } else {
            None
        };
        let legacy_pattern: &[(f32, f32)] = if !use_world_dash && dash_kinds_ok {
            let kind = scene.segment_dash_kind[idx] as usize;
            if kind < DASH_PIXEL_PATTERNS.len() { DASH_PIXEL_PATTERNS[kind] } else { &[] }
        } else {
            &[]
        };

        let has_pattern = world_pattern.is_some() || !legacy_pattern.is_empty();
        if !has_pattern || wpp <= 0.0 {
            // Solid segment â€” emit as one line.
            out.push(Vertex { pos: p1, color, _pad: 0 });
            out.push(Vertex { pos: p2, color, _pad: 0 });
            continue;
        }

        let dx = p2[0] - p1[0];
        let dy = p2[1] - p1[1];
        let len = (dx * dx + dy * dy).sqrt();
        if len <= 1e-6 { continue; }
        let ux = dx / len;
        let uy = dy / len;

        // Build a (draw_world, gap_world) screen-clamped pattern in
        // world units. For world patterns: walk pairs of (positive,
        // negative-or-dot) entries; for legacy: pairs are already
        // (draw_px, gap_px) in screen units.
        //
        // `screen_stride[i] = world_stride[i].abs() * pixels_per_world`,
        // clamped to MIN_SCREEN_PX, then mapped back to world via wpp.
        // Zero world stride = dot â†’ render as 1 element of MIN_SCREEN_PX.
        let mut strokes: Vec<(f32, f32)> = Vec::new(); // (draw_world, gap_world)
        if let Some(wp) = world_pattern {
            // World pattern: alternate draw (>=0) / gap (<0) entries.
            // DXF LINETYPE definitions are normalised to start with a
            // positive (draw) element, so pair them up sequentially.
            // LTSCALE multiplier is applied here (see const above) --
            // stramienlijnen / centerlines were unusably dense at 1:100.
            let mut i = 0;
            while i < wp.len() {
                let draw_w_raw = wp[i].abs() as f32 * LTSCALE;
                let gap_w_raw  = if i + 1 < wp.len() { wp[i + 1].abs() as f32 * LTSCALE } else { 0.0 };
                // Zero world entry = dot â€” promote to MIN_SCREEN_PX.
                let draw_px = (draw_w_raw * pixels_per_world).max(MIN_SCREEN_PX);
                let gap_px  = (gap_w_raw  * pixels_per_world).max(MIN_SCREEN_PX);
                strokes.push((draw_px * wpp, gap_px * wpp));
                i += 2;
            }
        } else {
            // Legacy screen-pixel pattern: clamp each element to floor
            // then convert px â†’ world by multiplying by wpp.
            for (d, g) in legacy_pattern {
                let draw_px = d.max(MIN_SCREEN_PX);
                let gap_px  = g.max(MIN_SCREEN_PX);
                strokes.push((draw_px * wpp, gap_px * wpp));
            }
        }
        if strokes.is_empty() {
            out.push(Vertex { pos: p1, color, _pad: 0 });
            out.push(Vertex { pos: p2, color, _pad: 0 });
            continue;
        }

        // If the total visible stride (in screen px) is too small the
        // pattern is invisible at this zoom â€” render solid. 6 px is a
        // good lower bound: below that even a two-stroke dash-gap can't
        // be perceived as a pattern.
        let total_stride_px: f32 = strokes.iter()
            .map(|(d, g)| (d + g) * pixels_per_world).sum();
        if total_stride_px < 6.0 {
            out.push(Vertex { pos: p1, color, _pad: 0 });
            out.push(Vertex { pos: p2, color, _pad: 0 });
            continue;
        }

        let mut travelled: f32 = 0.0;
        let mut i = 0usize;
        // Safety cap: extreme zoom-in could in theory want millions of
        // dashes per segment. 4096 strokes / segment is more than
        // anyone wants to render â€” fall back to solid past that.
        let mut stroke_budget = 4096usize;
        while travelled < len && stroke_budget > 0 {
            let (draw_world, gap_world) = strokes[i % strokes.len()];
            let draw_end = (travelled + draw_world).min(len);
            let a = [p1[0] + ux * travelled, p1[1] + uy * travelled];
            let b = [p1[0] + ux * draw_end,  p1[1] + uy * draw_end];
            out.push(Vertex { pos: a, color, _pad: 0 });
            out.push(Vertex { pos: b, color, _pad: 0 });
            travelled = draw_end + gap_world;
            i += 1;
            stroke_budget -= 1;
        }
    }
    out
}

/// Derive a synthetic layer key from a packed RGBA colour.
fn layer_key_for_color(color: u32) -> String {
    if color == 0 {
        "0 (default)".to_string()
    } else {
        let r = (color >> 0) & 0xFF;
        let g = (color >> 8) & 0xFF;
        let b = (color >> 16) & 0xFF;
        format!("colour #{:02X}{:02X}{:02X}", r, g, b)
    }
}

/// Enumerate distinct layer keys in a scene â€” (layer_name, sample_rgba).
fn derive_layer_list(scene: &Scene, default_color: u32) -> Vec<(String, u32)> {
    use std::collections::BTreeMap;
    if !scene.layer_names.is_empty()
        && scene.layer_colors.len() == scene.layer_names.len()
    {
        let mut pairs: Vec<(String, u32)> = scene.layer_names.iter()
            .zip(scene.layer_colors.iter())
            .map(|(n, c)| {
                let shown = if *c != 0 { *c } else { default_color };
                (n.clone(), shown)
            })
            .collect();
        pairs.sort_by(|a, b| a.0.cmp(&b.0));
        return pairs;
    }
    let mut map: BTreeMap<String, u32> = BTreeMap::new();
    for s in &scene.segments {
        let key = layer_key_for_color(s.color);
        let shown_color = if s.color != 0 { s.color } else { default_color };
        map.entry(key).or_insert(shown_color);
    }
    for t in &scene.triangles {
        let key = layer_key_for_color(t.color);
        map.entry(key).or_insert(t.color);
    }
    map.into_iter().collect()
}

/// Triangle-list version for scene.triangles (SOLID HATCH + TTF fills).
/// Returns `(solid_verts, text_verts)`.
fn build_tri_verts(
    scene: &Scene,
    origin: [f64; 2],
    want_paper: bool,
    hidden_layers: &HashSet<String>,
) -> (Vec<Vertex>, Vec<Vertex>)
{
    let mut solid = Vec::with_capacity(scene.triangles.len() * 3);
    let mut text = Vec::new();
    let use_real_layers = !scene.layer_names.is_empty()
        && scene.triangle_layer_idx.len() == scene.triangles.len();
    for (idx, t) in scene.triangles.iter().enumerate()
        .filter(|(_, t)| t.is_paper == want_paper)
    {
        let layer_key: String = if use_real_layers {
            let li = scene.triangle_layer_idx[idx] as usize;
            scene.layer_names.get(li).cloned()
                .unwrap_or_else(|| layer_key_for_color(t.color))
        } else {
            layer_key_for_color(t.color)
        };
        if hidden_layers.contains(&layer_key) { continue; }
        let vs = [
            [(t.v[0][0] - origin[0]) as f32, (t.v[0][1] - origin[1]) as f32],
            [(t.v[1][0] - origin[0]) as f32, (t.v[1][1] - origin[1]) as f32],
            [(t.v[2][0] - origin[0]) as f32, (t.v[2][1] - origin[1]) as f32],
        ];
        if !vs.iter().all(|v| v[0].is_finite() && v[1].is_finite()) {
            continue;
        }
        let dst = match t.kind {
            TriKind::TextFill => &mut text,
            TriKind::Solid => &mut solid,
        };
        for v in &vs {
            dst.push(Vertex { pos: *v, color: t.color, _pad: 0 });
        }
    }
    (solid, text)
}

const LINE_WGSL: &str = r#"
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
@fragment fn fs_main(v: VOut) -> @location(0) vec4<f32> { return v.color; }
"#;

// =============================================================================
// App state
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
            backends: wgpu::Backends::PRIMARY, ..Default::default()
        });
        let surface = instance.create_surface(window.clone())?;
        let adapter = instance.request_adapter(&wgpu::RequestAdapterOptions {
            power_preference: wgpu::PowerPreference::HighPerformance,
            compatible_surface: Some(&surface),
            force_fallback_adapter: false,
        }).await.ok_or_else(|| anyhow::anyhow!("no adapter"))?;
        // Big-scene fix: the default `wgpu::Limits` cap `max_buffer_size`
        // at 256 MB, which is too small for the unified `scene-vb`
        // (â‰ˆ284 MB observed on a 9M-segment / 528K-tri DWG). Request
        // the adapter's max (typically 1â€“2 GB on modern GPUs), never
        // below default. If the driver rejects the elevated limits we
        // retry with `Limits::default()` so init still succeeds; GPU-
        // side chunking would be the next step if that ever happens.
        let adapter_limits = adapter.limits();
        let default_limits = wgpu::Limits::default();
        let desired_max_buffer = adapter_limits
            .max_buffer_size
            .max(default_limits.max_buffer_size)
            .max(1_073_741_824);
        let desired_max_storage = adapter_limits
            .max_storage_buffer_binding_size
            .max(default_limits.max_storage_buffer_binding_size);
        let preferred_limits = wgpu::Limits {
            max_buffer_size: desired_max_buffer,
            max_storage_buffer_binding_size: desired_max_storage,
            ..default_limits.clone()
        };
        eprintln!(
            "[gpu] adapter max_buffer_size = {} MB, requesting {} MB",
            adapter_limits.max_buffer_size / 1024 / 1024,
            desired_max_buffer / 1024 / 1024,
        );
        let (device, queue) = match adapter
            .request_device(
                &wgpu::DeviceDescriptor {
                    label: Some("open_2d_studio"),
                    required_features: wgpu::Features::empty(),
                    required_limits: preferred_limits.clone(),
                    memory_hints: wgpu::MemoryHints::Performance,
                },
                None,
            )
            .await
        {
            Ok(pair) => pair,
            Err(e) => {
                eprintln!(
                    "[gpu] elevated limits rejected ({e}); falling back to wgpu::Limits::default()"
                );
                adapter
                    .request_device(
                        &wgpu::DeviceDescriptor {
                            label: Some("open_2d_studio"),
                            required_features: wgpu::Features::empty(),
                            required_limits: default_limits,
                            memory_hints: wgpu::MemoryHints::Performance,
                        },
                        None,
                    )
                    .await?
            }
        };
        eprintln!(
            "[gpu] device max_buffer_size = {} MB",
            device.limits().max_buffer_size / 1024 / 1024,
        );
        let caps = surface.get_capabilities(&adapter);
        let format = caps.formats.iter().copied()
            .find(|f| f.is_srgb()).unwrap_or(caps.formats[0]);
        let config = wgpu::SurfaceConfiguration {
            usage: wgpu::TextureUsages::RENDER_ATTACHMENT,
            format, width: size.width.max(1), height: size.height.max(1),
            present_mode: wgpu::PresentMode::Fifo,
            desired_maximum_frame_latency: 2,
            alpha_mode: caps.alpha_modes[0],
            view_formats: vec![],
        };
        surface.configure(&device, &config);
        let egui_ctx = egui::Context::default();
        // Install the egui-phosphor icon font so the superui titlebar
        // QAT buttons + ribbon icon-only buttons can render line icons
        // matching 1.0's lucide-react set.
        let mut fonts = egui::FontDefinitions::default();
        egui_phosphor::add_to_fonts(&mut fonts, egui_phosphor::Variant::Regular);
        egui_ctx.set_fonts(fonts);
        let egui_state = egui_winit::State::new(
            egui_ctx.clone(), egui::ViewportId::ROOT, &*window,
            Some(window.scale_factor() as f32), None, None,
        );
        let egui_renderer = egui_wgpu::Renderer::new(&device, format, None, 1, false);
        Ok(Self { surface, device, queue, config, format, egui_ctx, egui_state, egui_renderer })
    }
}

/// Per-tab camera state (independent pan + zoom + rotation + floating origin).
#[derive(Clone, Copy)]
struct PaneCam {
    origin: [f64; 2],
    pan_x: f64,
    pan_y: f64,
    zoom: f64,
    /// World-space rotation around the camera target, radians. 0 = no
    /// rotation (world +X right, +Y up). Positive = counter-clockwise
    /// when viewed on-screen â€” matches the view-cube compass direction.
    rotation: f64,
}

impl PaneCam {
    fn fit(bbox: &[f64; 4]) -> Self {
        let valid = bbox[0].is_finite() && bbox[0] < bbox[2];
        let (x0, y0, x1, y1) = if valid {
            (bbox[0], bbox[1], bbox[2], bbox[3])
        } else { (0.0, 0.0, 1.0, 1.0) };
        let origin = [(x0 + x1) * 0.5, (y0 + y1) * 0.5];
        let w = (x1 - x0).max(1.0);
        let h = (y1 - y0).max(1.0);
        let zoom = 1.0 / (w.max(h) * 0.55);
        Self { origin, pan_x: 0.0, pan_y: 0.0, zoom, rotation: 0.0 }
    }
}

/// Default line colour used whenever a segment has color == 0 (BYLAYER /
/// BYBLOCK inherit). Single value now that we're no longer colour-tinting
/// per pane â€” matches the old TL (green) for familiarity.
const DEFAULT_LINE_COLOR: u32 = 0xFFE0E0E0;   // near-white

/// In-flight text-edit session: tracks which entity in which tab is being
/// edited, plus the live `buffer` (typed-into) and the `last_committed`
/// snapshot used to revert on cancel. `debounce_at` reserved for Task 10
/// (live-preview re-tessellation throttle).
#[derive(Clone)]
struct EditTextState {
    tab_idx: usize,
    eid: u32,
    buffer: String,
    last_committed: String,
    debounce_at: Option<std::time::Instant>,
}

/// Tiled split mode for a single `FileTab`. When present, the tab's canvas
/// area is divided 50/50 and two tabs (self + `other_tab_idx`) render
/// side-by-side with independent cameras. Keeps the tab model flat â€” no
/// nested recursive split tree â€” which is all the first cut needs.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum SplitKind {
    /// Left = this tab, Right = other tab.
    HorizontalPair(usize),
    /// Top = this tab, Bottom = other tab.
    VerticalPair(usize),
}

/// One open file â€” a browser-style tab.
///
/// Owns everything that used to live in the parallel arrays on the old
/// 4-pane App. The GPU pipelines are per-tab and rebuilt on load /
/// layer-toggle / layout-switch. `move_undo_stack` is per-tab so
/// undo stays local to the file the user edited.
struct FileTab {
    scene: Scene,
    path: Option<String>,
    label: String,
    /// CAD-version label shown as a small pill in the file-tab strip
    /// (e.g. `R2010`, `R2013`, `IFCDraw`). Detected via
    /// `superui::dialogs::file_version::detect_version` at tab create
    /// time + after the loader completes (in case the placeholder tab
    /// was created before the file existed). `None` hides the pill.
    version: Option<String>,

    cam: PaneCam,
    show_paper: bool,
    hidden_layers: HashSet<String>,
    /// Layers the user has soft-deleted via the trash button in the
    /// LAYERS panel. These are unioned into `hidden_layers` so they
    /// never render, AND they're excluded from DXF save output (see
    /// `save_as_dxf`). Soft-delete avoids mutating the parallel
    /// segment / triangle / layer-idx arrays in place â€” the original
    /// scene stays intact and a future "restore" step is straightforward.
    deleted_layers: HashSet<String>,

    // GPU â€” lazily built once self.gpu exists.
    pipe: Option<LinePipeline>,
    tri_pipe: Option<LinePipeline>,
    text_tri_pipe: Option<LinePipeline>,
    sel_pipe: Option<LinePipeline>,

    // Selection + Move-tool state (per tab).
    /// Multi-select: Vec of segment-indices. Resolved to unique entity ids
    /// via `selected_entity_ids_in`. A click replaces this list, Shift/Ctrl
    /// click toggles, drag-box picks many, Esc / Ctrl+click-empty clears.
    selection: Vec<usize>,
    /// Hover preview (segment-idx). Updated on cursor-move.
    hover: Option<usize>,
    /// (entity_idx, world_press_pos) â€” None when no drag in progress.
    /// Legacy single-entity move drag â€” kept for backwards compatibility.
    /// Multi-entity moves now use `move_drag_multi`.
    move_drag: Option<(u32, [f64; 2])>,
    /// Multi-entity move drag: list of entity ids being dragged + the
    /// world-space press position. Mirrors the live preview offset in
    /// `pending_move_offset`.
    move_drag_multi: Option<(Vec<u32>, [f64; 2])>,
    pending_move_offset: [f64; 2],
    /// Generalised undo stack: Move / Delete / Paste â€” capped at 20.
    /// Replaces the old `move_undo_stack` so all destructive edits share
    /// a single history.
    undo_stack: Vec<EditOp>,

    /// If set, this tab renders side-by-side with another tab in the same
    /// canvas area. See `SplitKind`. Only the *primary* (this) tab holds the
    /// split; the paired tab is still just a normal tab accessible via the
    /// tab strip.
    split_kind: Option<SplitKind>,

    // Annotate tools â€” per user request: linear maatlijn + area measurement, per-tab persistence
    /// Persistent linear dims + area polygons laid on top of the drawing.
    annotations: Vec<Annotation>,
    /// GPU pipeline for annotation geometry. Rebuilt when the list changes.
    /// Drawn AFTER the main scene pass but BEFORE `sel_pipe` so selection
    /// highlight still tops everything.
    annotation_pipe: Option<LinePipeline>,

    /// Lazy spatial + entity-grouping index over `scene.segments`. Built on
    /// first use after a scene-load and dropped on any segment-mutating
    /// path (rebuild_buffers / replace_active_scene). Speeds up
    /// `pick_segment_at_in` and `rebuild_sel_pipe` from O(n_segments) to
    /// O(log n + k) and O(siblings) respectively.
    scene_index: Option<SceneIndex>,

    /// Flat `(p1, p2)` view over `scene.segments` for `kernel_snap`.
    /// Built lazily, invalidated whenever scene_index is invalidated.
    snap_segments: Option<Vec<([f64; 2], [f64; 2])>>,

    /// World-units-per-pixel that the line vertex buffer was last
    /// generated for. Dashed-line strides are baked at scene-build
    /// time using this factor; when the camera zoom moves the scene
    /// such that wpp differs by more than ~10% (see
    /// `dash_pixel_stride_changed`) we re-call rebuild_buffers to
    /// keep dashes constant in screen pixels.
    last_dash_wpp: f64,

    /// Cached structure-browser tree. Rebuilding this walks all
    /// segments + entity ids and allocates a HashMap; on a 113k-segment
    /// DWG that's ~3-5 ms per frame. Built on demand, dropped on any
    /// scene-mutating path (rebuild_buffers).
    cached_structure_tree: Option<TreeNode>,
    /// Cached layer list for the LAYERS panel. Cheap when the layer
    /// table is parsed (sort + clone of names/colors), but the fall-back
    /// branch walks every segment; either way no point recomputing per
    /// frame when the scene hasn't changed.
    cached_layer_list: Option<Vec<(String, u32)>>,

    /// When Some(_), this tab is a placeholder for a background-loading
    /// file. The string is the current loading phase for the overlay
    /// label. Cleared (set to None) when the load completes and the
    /// scene is swapped in.
    loading: Option<LoadingState>,
}

/// Per-tab background-load progress state. Stored on `FileTab.loading`
/// when a placeholder tab is awaiting a Scene from a worker thread.
#[derive(Clone)]
struct LoadingState {
    /// Short label rendered next to the spinner (e.g. "Parsing DWGâ€¦").
    phase: String,
    /// 0.0..1.0 â€” best-effort fraction. May stay near 0 since DWG load
    /// has only coarse phase boundaries; the spinner gives "alive"
    /// feedback regardless.
    fraction: f32,
    /// Wall-clock instant when the load started. Used for the
    /// "loaded in 12.4s" log line and a spinner phase angle.
    started_at: Instant,
}

/// Snapshot of one entity captured before deletion / cut. Stores enough
/// data to re-insert the entity exactly as it was (segments + triangles +
/// per-fragment layer indices + the original entity id + entity name).
/// Used for undo and clipboard.
#[derive(Clone)]
struct DeletedEntity {
    entity_idx: u32,
    name: Option<String>,
    /// (segment, layer_idx) â€” layer_idx may be u16::MAX as a sentinel
    /// meaning "no layer table for this scene", in which case re-insert
    /// just skips the layer-idx push.
    segments: Vec<(Segment, u16)>,
    triangles: Vec<(Triangle, u16)>,
}

use crate::scene_io::{Segment, Triangle};

/// One reversible edit. Pushed to `FileTab::undo_stack` on every
/// destructive change. Capped at 20 entries.
#[derive(Clone)]
enum EditOp {
    /// Translate one or more entities by `delta`. Inverse: apply -delta.
    Move { eids: Vec<u32>, delta: [f64; 2] },
    /// Remove entities; `entities` carries the snapshot needed to put
    /// them back. Inverse: re-insert.
    Delete { entities: Vec<DeletedEntity> },
    /// Insert pasted entities; `new_eids` are the freshly minted ids so
    /// undo just deletes them again.
    Paste { new_eids: Vec<u32> },
    // Blok 3 â€” geometric transforms on selection. Inverses:
    // Rotate -> apply -angle around same pivot
    // Scale  -> apply 1/factor around same pivot
    // Mirror -> apply the same mirror again (twice = identity)
    Rotate { eids: Vec<u32>, pivot: [f64; 2], angle: f64 },
    Scale  { eids: Vec<u32>, pivot: [f64; 2], factor: f64 },
    Mirror { eids: Vec<u32>, axis_a: [f64; 2], axis_b: [f64; 2] },
    /// Re-tessellation of a text entity (F2 edit). Inverse: restore the
    /// previous segments/triangles snapshot via `restore_text_entity`.
    EditText { text_delta: crate::scene_io::TextEntityDelta },
    /// Layer soft-deleted via the LAYERS panel trash button. The
    /// inverse pulls the layer name out of both `deleted_layers` and
    /// `hidden_layers` so the rows reappear and segments render
    /// again. `was_hidden_before` remembers whether the layer was
    /// already hidden via the eye toggle before the trash click — so
    /// undo restores that toggle exactly.
    LayerDelete { layer_name: String, was_hidden_before: bool },
}

impl FileTab {
    fn new(scene: Scene, path: Option<String>) -> Self {
        let label = Self::derive_label(path.as_deref());
        let version = path.as_deref().and_then(Self::detect_version_for_path);
        let cam = PaneCam::fit(&scene.bbox);
        Self {
            scene,
            path,
            label,
            version,
            cam,
            show_paper: false,
            hidden_layers: HashSet::new(),
            deleted_layers: HashSet::new(),
            pipe: None,
            tri_pipe: None,
            text_tri_pipe: None,
            sel_pipe: None,
            selection: Vec::new(),
            hover: None,
            move_drag: None,
            move_drag_multi: None,
            pending_move_offset: [0.0, 0.0],
            undo_stack: Vec::new(),
            split_kind: None,
            // Annotate tools â€” per user request: linear maatlijn + area measurement, per-tab persistence
            annotations: Vec::new(),
            annotation_pipe: None,
            scene_index: None,
            snap_segments: None,
            last_dash_wpp: 0.0,
            cached_structure_tree: None,
            cached_layer_list: None,
            loading: None,
        }
    }

    /// Has the camera zoom moved enough that the screen-space dash
    /// stride would visibly drift? rebuild_buffers re-emits dashes
    /// using the current world-per-pixel factor, so we only call it
    /// when wpp changed by more than ~12% â€” a single dash boundary
    /// at 8px stride moves by ~1px before triggering, below the
    /// just-noticeable-difference threshold for line patterns.
    fn dash_pixel_stride_changed(&self, gpu: &GpuCtx, canvas_height_px: Option<f32>) -> bool {
        // Ignore tabs that don't have any dashed segments â€” no point
        // rebuilding their (already solid) buffers on every zoom change.
        if self.scene.segment_dash_kind.iter().all(|k| *k == 0) {
            return false;
        }
        // CRITICAL: world-per-pixel must use the CANVAS-rect height (the
        // viewport actually rendered to), NOT the full window framebuffer.
        // With ribbon + dock panels the canvas can be ~30% shorter than
        // the window; using gpu.config.height made dashes ~30% too fine.
        let h_phys = canvas_height_px
            .map(|h| h as f64)
            .unwrap_or_else(|| gpu.config.height as f64)
            .max(1.0);
        let wpp_now = (2.0 / self.cam.zoom.max(1e-12)) / h_phys;
        if self.last_dash_wpp <= 0.0 || !self.last_dash_wpp.is_finite() {
            return true;
        }
        let ratio = wpp_now / self.last_dash_wpp;
        // ~15% threshold — wider than 6% so that mid-zoom GPU buffer
        // rebuilds don't stall the wheel. At 8 px stride that's ≤1.2 px
        // dash-boundary drift between rebuilds — still well below the
        // 2-3 px JND for pattern breathing on a typical 100% DPI
        // monitor. Big drawings (100k+ segments) felt sluggish during
        // continuous wheel zoom at 6% — the rebuild was firing every
        // 1-2 notches.
        ratio < 0.87 || ratio > 1.15
    }

    /// Get a cached, layer-grouped layer list for the LAYERS panel.
    /// First call after a scene mutation pays the derive cost; later
    /// calls return a cheap clone of the cached vec. Mutating paths
    /// (rebuild_buffers_with_canvas) clear the cache.
    fn layer_list_cached(&mut self, default_color: u32) -> Vec<(String, u32)> {
        if let Some(cached) = &self.cached_layer_list {
            return cached.clone();
        }
        let list = derive_layer_list(&self.scene, default_color);
        self.cached_layer_list = Some(list.clone());
        list
    }

    /// Cheap, no-allocation layer count for the status-bar counter.
    /// Populates the cache on first call after a scene mutation, then
    /// returns the cached vec's length. Avoids the full `clone()` that
    /// `layer_list_cached` does just to call `.len()` â€” over a 60-fps
    /// session that adds up to gigabytes of churn on a 100-layer scene.
    fn layer_count_cached(&mut self, default_color: u32) -> usize {
        if let Some(cached) = &self.cached_layer_list {
            return cached.len();
        }
        let list = derive_layer_list(&self.scene, default_color);
        let n = list.len();
        self.cached_layer_list = Some(list);
        n
    }

    /// Get a cached structure-browser TreeNode. First call after scene
    /// mutation walks segments + entity ids and allocates HashMaps;
    /// later calls clone the cached node. Cleared by rebuild_buffers.
    fn structure_tree_cached(&mut self) -> TreeNode {
        if let Some(cached) = &self.cached_structure_tree {
            return cached.clone();
        }
        let tree = build_structure_tree(&self.scene, &self.label);
        self.cached_structure_tree = Some(tree.clone());
        tree
    }

    /// Lazily build the scene's spatial + entity index. Cheap re-entry â€”
    /// returns immediately when the index already exists. Bulk-loading the
    /// rstar costs ~30-60 ms for 700k segments on release; we only pay that
    /// once per scene-load.
    fn ensure_scene_index(&mut self) {
        if self.scene_index.is_some() { return; }
        if self.scene.segments.is_empty() { return; }
        let t0 = Instant::now();
        let idx = SceneIndex::build(&self.scene);
        eprintln!(
            "[scene_index] built in {:.2} ms â€” {} segs, {} entities",
            t0.elapsed().as_secs_f64() * 1000.0,
            self.scene.segments.len(),
            idx.entity_to_segs.len(),
        );
        self.scene_index = Some(idx);
    }

    /// Lazily build the flat `(p1, p2)` endpoint view that
    /// `kernel_snap::SnapContext` consumes. Same lifecycle as
    /// `scene_index`. Cheap once built.
    fn ensure_snap_segments(&mut self) {
        if self.snap_segments.is_some() { return; }
        // Skip text-glyph tessellation segments — snapping to a letter
        // baseline / serif is never useful and these segments are
        // disproportionally numerous (one short stroke per glyph
        // contour). User: "Ik wil dat de snaps niet werkt op de
        // teksten." Cheap filter via segment_entity_idx -> entity_text
        // lookup: entity_text[eid] = Some(_) means this segment was
        // produced by a TEXT / MTEXT tessellation pass.
        let mut segs: Vec<([f64; 2], [f64; 2])> =
            Vec::with_capacity(self.scene.segments.len());
        let n_text_slots = self.scene.entity_text.len();
        for (i, s) in self.scene.segments.iter().enumerate() {
            if let Some(&eid) = self.scene.segment_entity_idx.get(i) {
                let idx = eid as usize;
                if idx < n_text_slots && self.scene.entity_text[idx].is_some() {
                    continue;
                }
            }
            segs.push((s.p1, s.p2));
        }
        self.snap_segments = Some(segs);
    }

    fn derive_label(path: Option<&str>) -> String {
        match path {
            Some(p) => std::path::Path::new(p)
                .file_name()
                .map(|s| s.to_string_lossy().into_owned())
                .unwrap_or_else(|| p.to_string()),
            None => "Start".to_string(),
        }
    }

    /// Cheap version detect for the tab-strip badge. Reads only the file
    /// header (DWG magic / DXF `$ACADVER` scan) — same helper that the
    /// in-app file picker uses. Returns `None` for non-existent or
    /// unsupported files so the badge stays hidden until the file lands.
    fn detect_version_for_path(path: &str) -> Option<String> {
        if !std::path::Path::new(path).exists() {
            return None;
        }
        let v = superui::dialogs::detect_version(path);
        if v == "Unknown" { None } else { Some(v) }
    }

    /// Rebuild the GPU line + triangle pipelines for this tab after a
    /// load / layer toggle / layout switch. Reuses existing buffers when
    /// capacity permits. Also called when the camera zoom changes
    /// significantly so dashed-line patterns can be re-emitted at the
    /// new screen-space stride (see `dash_pixel_stride_changed`).
    fn rebuild_buffers(&mut self, gpu: &GpuCtx) {
        self.rebuild_buffers_with_canvas(gpu, None);
    }

    /// Rebuild buffers using a specific canvas-height in physical pixels
    /// for the dash-stride world-per-pixel calculation. Pass `None` to
    /// fall back to the full framebuffer height â€” only correct when no
    /// ribbon/dock chrome eats vertical space, which is rare. The render
    /// loop in `App::render` knows the real canvas rect and SHOULD pass
    /// it through; one-shot rebuild paths (file-load, layer toggle) use
    /// the framebuffer fallback and immediately re-bake on the next
    /// frame via `dash_pixel_stride_changed`.
    fn rebuild_buffers_with_canvas(&mut self, gpu: &GpuCtx, canvas_height_px: Option<f32>) {
        // Any scene-mutating path lands here. Drop the cached spatial /
        // entity index so the next pick rebuilds against the new geometry.
        self.scene_index = None;
        self.snap_segments = None;
        // Structure-tree + layer-list caches are derived from scene
        // contents (not camera). Pure zoom-driven dash rebuilds also
        // flow through here but the scene topology hasn't changed; we
        // could keep these caches across dash rebuilds, but the cost of
        // re-deriving is small relative to the buffer rebuild itself
        // (which dominates), so just invalidate for simplicity. The
        // rare dash-only rebuild during zoom pays a few ms extra.
        self.cached_structure_tree = None;
        self.cached_layer_list = None;

        let hidden = &self.hidden_layers;
        let want_paper = self.show_paper;

        // World-per-pixel â€” used by build_verts to render dashed lines
        // at a constant SCREEN-pixel stride. `(2.0 / zoom)` is the
        // visible world-height (the camera maps NDC [-1,1] to that
        // span via half_h = 1/zoom), divided by canvas-rect physical
        // height gives world-per-pixel. Canvas-rect (NOT framebuffer)
        // because that's the viewport actually drawn to.
        let h_phys = canvas_height_px
            .map(|h| h as f64)
            .unwrap_or_else(|| gpu.config.height as f64)
            .max(1.0);
        let wpp = (2.0 / self.cam.zoom.max(1e-12)) / h_phys;
        // Cache so the render loop can detect "next zoom delta" and
        // skip the rebuild when wpp barely changed.
        self.last_dash_wpp = wpp;

        // Build all vertex lists now so we only need an immutable view
        // of self.scene for the duration.
        let model_verts = build_verts(&self.scene, self.cam.origin, DEFAULT_LINE_COLOR, false, hidden, wpp);
        let paper_verts = build_verts(&self.scene, self.cam.origin, DEFAULT_LINE_COLOR, true, hidden, wpp);
        let init_line: &[Vertex] = if paper_verts.len() > model_verts.len() { &paper_verts } else { &model_verts };
        let active_line = if want_paper { &paper_verts } else { &model_verts };

        let (mt_solid, mt_text) = build_tri_verts(&self.scene, self.cam.origin, false, hidden);
        let (pt_solid, pt_text) = build_tri_verts(&self.scene, self.cam.origin, true, hidden);
        let init_solid: &[Vertex] = if pt_solid.len() > mt_solid.len() { &pt_solid } else { &mt_solid };
        let init_text:  &[Vertex] = if pt_text.len()  > mt_text.len()  { &pt_text  } else { &mt_text  };
        let active_solid = if want_paper { &pt_solid } else { &mt_solid };
        let active_text  = if want_paper { &pt_text  } else { &mt_text  };

        // Line pipeline.
        let needs_new_line = match &self.pipe {
            None => true,
            Some(p) => (p.vb.size() / std::mem::size_of::<Vertex>() as u64)
                < init_line.len().max(2) as u64,
        };
        if needs_new_line {
            let mut p = LinePipeline::new(&gpu.device, gpu.format, init_line);
            p.upload(&gpu.queue, active_line);
            self.pipe = Some(p);
        } else if let Some(p) = self.pipe.as_mut() {
            p.upload(&gpu.queue, active_line);
        }

        // Solid triangle pipeline.
        let needs_new_tri = match &self.tri_pipe {
            None => true,
            Some(p) => (p.vb.size() / std::mem::size_of::<Vertex>() as u64)
                < init_solid.len().max(2) as u64,
        };
        if needs_new_tri {
            let mut p = LinePipeline::new_tri(&gpu.device, gpu.format, init_solid);
            p.upload(&gpu.queue, active_solid);
            self.tri_pipe = Some(p);
        } else if let Some(p) = self.tri_pipe.as_mut() {
            p.upload(&gpu.queue, active_solid);
        }

        // Text-fill triangle pipeline.
        let needs_new_text = match &self.text_tri_pipe {
            None => true,
            Some(p) => (p.vb.size() / std::mem::size_of::<Vertex>() as u64)
                < init_text.len().max(2) as u64,
        };
        if needs_new_text {
            let mut p = LinePipeline::new_tri(&gpu.device, gpu.format, init_text);
            p.upload(&gpu.queue, active_text);
            self.text_tri_pipe = Some(p);
        } else if let Some(p) = self.text_tri_pipe.as_mut() {
            p.upload(&gpu.queue, active_text);
        }
    }
}

// =============================================================================
// Structure-tree builders â€” feed the superui::StructureTree widget.
//
// One builder per scene-source. The DXF/DWG path groups segments by layer
// and counts how many distinct entity ids of each visual type
// (Lines / Polylines / Text / Hatches / Other) live on that layer. The
// IFCDRAW path is currently a stub â€” we'll populate Project/Site/
// Building/Storey hierarchy once load_dxf parses cached IFC metadata.
// =============================================================================

/// Visual entity-type bucket used for layer roll-ups in the model browser.
#[derive(Copy, Clone, Eq, PartialEq, Hash)]
enum EntityBucket { Line, Polyline, Text, Hatch, Other }

impl EntityBucket {
    fn label(self) -> &'static str {
        match self {
            EntityBucket::Line => "Lines",
            EntityBucket::Polyline => "Polylines",
            EntityBucket::Text => "Text",
            EntityBucket::Hatch => "Hatches",
            EntityBucket::Other => "Other",
        }
    }
}

/// Classify a single entity id by its segment / triangle / text fingerprint.
fn classify_entity(scene: &Scene, eid: u32, segs_for_eid: &[u32]) -> EntityBucket {
    let eid_us = eid as usize;
    if scene.entity_text.get(eid_us).and_then(|o| o.as_ref()).is_some() {
        return EntityBucket::Text;
    }
    // Anything contributing triangles is treated as a Hatch (covers SOLID
    // / 3DFACE / TRACE / pattern HATCH â€” close enough for a browser).
    if scene.triangle_entity_idx.iter().any(|e| *e == eid) {
        return EntityBucket::Hatch;
    }
    let n = segs_for_eid.len();
    if n == 0 {
        EntityBucket::Other
    } else if n == 1 {
        EntityBucket::Line
    } else {
        // Multi-segment entities default to Polyline (LWPOLYLINE / POLYLINE /
        // dashed LINE expanded into pieces). DIMENSIONs and INSERTs also land
        // here; we don't try to disambiguate beyond the bucket label.
        EntityBucket::Polyline
    }
}

/// Build a layer-grouped tree for DXF / DWG scenes.
fn build_dxf_dwg_tree(scene: &Scene, file_label: &str) -> TreeNode {
    use std::collections::HashMap;

    // 1. Map entity_idx â†’ list of seg indices (cheap re-walk of the
    //    parallel array; SceneIndex isn't always built yet at first paint).
    let mut entity_to_segs: HashMap<u32, Vec<u32>> = HashMap::new();
    for (i, eid) in scene.segment_entity_idx.iter().enumerate() {
        entity_to_segs.entry(*eid).or_default().push(i as u32);
    }

    // 2. For each entity: pick its layer (mode of seg layer indices) and
    //    its bucket. Roll up into per-layer per-bucket counts.
    //    layer_eids[layer_idx][bucket] = count
    let n_layers = scene.layer_names.len().max(1);
    let mut layer_buckets: Vec<HashMap<EntityBucket, usize>> =
        (0..n_layers).map(|_| HashMap::new()).collect();
    let mut layer_total: Vec<usize> = vec![0; n_layers];

    for (eid, segs) in &entity_to_segs {
        // Layer = first seg's layer (entity is single-layer in practice).
        let layer_idx = segs.first()
            .and_then(|si| scene.segment_layer_idx.get(*si as usize).copied())
            .map(|l| l as usize)
            .unwrap_or(0);
        let layer_idx = layer_idx.min(n_layers.saturating_sub(1));
        let bucket = classify_entity(scene, *eid, segs);
        *layer_buckets[layer_idx].entry(bucket).or_insert(0) += 1;
        layer_total[layer_idx] += 1;
    }

    // 3. Build tree.
    let mut layer_nodes: Vec<TreeNode> = Vec::with_capacity(n_layers);
    for (li, name) in scene.layer_names.iter().enumerate().take(n_layers) {
        if layer_total.get(li).copied().unwrap_or(0) == 0 { continue; }
        let mut bucket_nodes: Vec<TreeNode> = Vec::new();
        let mut buckets: Vec<(EntityBucket, usize)> =
            layer_buckets[li].iter().map(|(b, c)| (*b, *c)).collect();
        buckets.sort_by(|a, b| b.1.cmp(&a.1));
        for (bucket, count) in buckets {
            bucket_nodes.push(
                TreeNode::leaf(
                    format!("layer:{}/{}", name, bucket.label()),
                    bucket.label(),
                    NodeKind::EntityType,
                ).with_count(count)
            );
        }
        layer_nodes.push(
            TreeNode::leaf(
                format!("layer:{}", name),
                name.clone(),
                NodeKind::Layer,
            )
            .with_count(layer_total[li])
            .with_children(bucket_nodes)
        );
    }

    // Edge case: scene has no parsed layer table â€” fall back to a single
    // synthetic root containing all entities.
    if layer_nodes.is_empty() && !entity_to_segs.is_empty() {
        let mut bucket_counts: HashMap<EntityBucket, usize> = HashMap::new();
        for (eid, segs) in &entity_to_segs {
            let b = classify_entity(scene, *eid, segs);
            *bucket_counts.entry(b).or_insert(0) += 1;
        }
        let mut bucket_nodes: Vec<TreeNode> = bucket_counts.iter()
            .map(|(b, c)| TreeNode::leaf(
                format!("synthetic/{}", b.label()),
                b.label(),
                NodeKind::EntityType,
            ).with_count(*c))
            .collect();
        bucket_nodes.sort_by(|a, b| b.count.cmp(&a.count));
        layer_nodes.push(
            TreeNode::leaf("layer:0", "0", NodeKind::Layer)
                .with_count(entity_to_segs.len())
                .with_children(bucket_nodes)
        );
    }

    TreeNode::leaf(
        "root",
        format!("{} â€” {}", file_label, scene.source),
        NodeKind::Project,
    )
    .with_count(entity_to_segs.len())
    .with_children(layer_nodes)
}

/// Build a (currently stub) IFC structure tree. Once load_ifcdraw caches
/// Project/Site/Building/Storey metadata on the Scene we can populate
/// these levels from that â€” for now we render a placeholder so the panel
/// still lights up on .ifcdraw files.
fn build_ifcdraw_tree(scene: &Scene, file_label: &str) -> TreeNode {
    let placeholder = TreeNode::leaf(
        "ifcdraw:soon",
        "IFC hierarchy: import metadata not yet captured",
        NodeKind::Other,
    );
    TreeNode::leaf(
        "ifcdraw_root",
        format!("{} â€” IFCDRAW", file_label),
        NodeKind::Project,
    )
    .with_count(scene.segments.len())
    .with_children(vec![placeholder])
}

/// Top-level entry: pick the right builder based on the scene's source tag.
fn build_structure_tree(scene: &Scene, file_label: &str) -> TreeNode {
    match scene.source {
        "IFCDRAW" | "IFCX" => build_ifcdraw_tree(scene, file_label),
        _ => build_dxf_dwg_tree(scene, file_label),
    }
}

struct App {
    /// Build variant. Defaults to `Studio`; flipped to `Viewer` by the
    /// `open_2d_viewer` shim before the event loop starts. Guards every
    /// editing-tool dispatch + save dispatch + F2 text-edit so the same
    /// source can ship as either authoring tool or read-only viewer.
    pub mode: AppMode,

    window: Option<Arc<Window>>,
    gpu: Option<GpuCtx>,

    // --- Tabs ---------------------------------------------------------
    tabs: Vec<FileTab>,
    active_tab: usize,

    // --- Global mouse / kb state -------------------------------------
    mouse_pos: (f32, f32),
    /// Cached pixel rect of the canvas (set every frame after egui
    /// consumes its side panels). Used for hit-testing + world coord
    /// mapping. (x, y, w, h) in pixels.
    canvas_rect: (f32, f32, f32, f32),
    dragging: bool,
    drag_start: (f32, f32),
    drag_start_pan: (f64, f64),
    modifiers: ModifiersState,

    // --- Panels ------------------------------------------------------
    samples_panel_open: bool,
    samples: Vec<SampleEntry>,
    layer_panel_open: bool,
    properties_panel_open: bool,
    about_dialog_open: bool,

    // Round 9 â€” superui side docks. Drawings + Sheets list state.
    left_dock_open: bool,
    right_dock_open: bool,
    drawings_open: bool,
    sheets_open: bool,
    drawings: Vec<String>,
    sheets: Vec<(String, String)>, // (name, subtitle)
    active_drawing_idx: Option<usize>,
    active_sheet_idx: Option<usize>,
    // RightDock form state (Properties).
    rd_name: String,
    rd_type: String,
    rd_show_axes: bool,
    rd_boundary_enabled: bool,
    rd_x: f64,
    rd_y: f64,
    rd_w: f64,
    rd_h: f64,
    // App menu popup state.
    app_menu_open: bool,

    /// "Save As DWG" modal -- the binary DWG writer is still in
    /// development (see `docs/superpowers/plans/dwg-writer-plan.md`).
    /// When `true` the app paints an explanation window that offers a
    /// DXF fallback. Set by `AppMenuAction::SaveAsDwg`; cleared by
    /// either the confirm button (routes to `save_as_dxf` with a
    /// `.dwg -> .dxf` extension swap) or the cancel button.
    save_as_dwg_modal_open: bool,

    // ---- Structure tree (IFC / DXF/DWG model browser) -----------------
    /// Toggled via F5 or the ribbon "Structure" button. Lives on the
    /// right side, mirrors the layer panel's footprint when open.
    structure_panel_open: bool,
    /// Per-id expansion set, shared across tabs (the consumer rebuilds
    /// the tree per active scene so ids effectively scope themselves).
    structure_expanded: HashSet<String>,
    /// Currently selected tree node id, or None.
    structure_selected: Option<String>,

    // --- Selection / click tracking ---------------------------------
    lmb_pressed: bool,
    lmb_press_pos: (f32, f32),
    /// Tab index that owns the current LMB press (latched at press-time).
    /// In split mode this is whichever pane the cursor was in when the
    /// click started, so release-time picks / moves don't jump tabs mid-drag.
    lmb_press_tab: usize,
    /// Canvas sub-rect (physical px) of the pane that owns the current
    /// LMB press. Used for screenâ†’world + pick-radius math at release.
    lmb_press_rect: (f32, f32, f32, f32),

    // --- Tools -------------------------------------------------------
    tool_mode: ToolMode,
    /// First point of an in-progress measurement (always in the active tab).
    measure_p1: Option<[f64; 2]>,
    /// Last completed measurement: (p1_world, p2_world, distance).
    last_measurement: Option<([f64; 2], [f64; 2], f64)>,

    // --- Snap (OSNAP) -----------------------------------------------
    /// Active object-snap modes (bitmask). Default: Endpoint + Midpoint +
    /// Center + Intersection + Nearest (AutoCAD baseline).
    snap_modes: SnapModeSet,
    /// Most recent snap hit, refreshed on every CursorMoved by `update_snap`.
    current_snap: Option<SnapResult>,

    // --- Measure sub-modes (Length / Area) ---------------------------
    /// Length vs Area â€” driven from the ribbon Measure buttons. Default Length.
    measure_sub: MeasureSub,
    /// In-progress polygon for Measure Area. Right-click / Enter closes.
    measure_area_in_progress: Vec<[f64; 2]>,
    /// Last completed area measurement: (perimeter, area).
    last_measure_area: Option<(f64, f64)>,

    // --- Measure Angle (Phase 2) -------------------------------------
    /// In-progress click buffer for the three-click angle gesture
    /// (vertex, ray1 end, ray2 end). Cleared on third click or Esc.
    measure_angle_pts: Vec<[f64; 2]>,
    /// Last completed angle: (vertex, ray1_pt, ray2_pt, radians).
    /// Rendered as a floating label until the next gesture starts.
    last_measure_angle: Option<([f64; 2], [f64; 2], [f64; 2], f64)>,
    /// Last completed coordinate readout (single click, world space).
    /// Rendered as a floating label until the next click overwrites
    /// it. Cleared on tool-mode switch away from MeasureCoord.
    last_measure_coord: Option<[f64; 2]>,

    // --- Find dialog (Phase 2) ---------------------------------------
    /// True while the modal Find dialog is open. Triggered by Ctrl+F
    /// or the ribbon `find_replace` button. Viewer is read-only so
    /// the dialog is find-only (no replace input).
    find_dialog_open: bool,
    /// Live query string. Substring scan over three small string
    /// vectors so the cost is acceptable on every keystroke.
    find_query: String,
    /// Cached match list — refreshed when `find_query` changes.
    find_matches: Vec<FindMatch>,

    // Annotate tools â€” per user request: linear maatlijn + area measurement, per-tab persistence
    /// First point of an in-progress Dimension placement (world coords).
    dim_p1: Option<[f64; 2]>,
    /// In-progress vertex list for the Area polygon tool.
    area_in_progress: Vec<[f64; 2]>,
    /// Pending key-chord state. Holds the first key of a 2-key chord
    /// (e.g. `Z` for the `ZR` Zoom-Region chord). Cleared after 1 s or
    /// when the second key is recognised / a different key is pressed.
    key_chord_pending: Option<winit::keyboard::KeyCode>,
    key_chord_at: Option<std::time::Instant>,
    /// First corner of the active Zoom-Region drag (world space). Set
    /// on LMB-press while `tool_mode == ToolMode::ZoomRegion`, consumed
    /// on LMB-release to fit the camera.
    zoom_region_p1: Option<[f64; 2]>,
    /// Cached last-seen world-space cursor position, used to draw the
    /// "rubber band" from last vertex to cursor in Area mode. Updated on
    /// CursorMoved.
    cursor_world: Option<[f64; 2]>,

    // --- Recent files ------------------------------------------------
    recent_files: Vec<String>,

    // --- ORTHO mode (Phase 2) ----------------------------------------
    /// When true, two-click gestures (Measure, Dimension) constrain
    /// the second click to be horizontal or vertical from the first
    /// (whichever axis the cursor is closer to). Toggled from the
    /// ORTHO pill in the status bar; no keyboard shortcut yet.
    ortho_enabled: bool,

    // --- Camera history (Phase 2 — Zoom Previous) --------------------
    /// LIFO stack of (tab_idx, prior_cam) snapshots. Pushed before any
    /// destructive camera change (Fit, ZoomRegion fit, Zoom Center,
    /// pan-end, wheel zoom). Popped by the ribbon `Zoom Previous`
    /// button. Capped at `CAMERA_HISTORY_MAX` to bound memory.
    camera_history: Vec<(usize, PaneCam)>,

    // --- Display toggles (Phase 2) -----------------------------------
    /// World-space grid overlay (paint stride adapts to zoom). Off by
    /// default — toggled from the View ribbon's Grid button.
    show_grid: bool,
    /// Flip canvas clear-color between dark (#0F1419) and white. Used
    /// by the View ribbon's White BG toggle to mimic AutoCAD's "model
    /// background" preference. Off = dark.
    white_bg: bool,

    // --- View mode cycle (Phase 2) -----------------------------------
    /// Cycle index for the status-bar view-mode selector. Viewer build
    /// supports Hidden Line (0) and Wireframe (1). Cycles on click.
    view_mode_idx: u8,

    // --- Perf / present-mode ----------------------------------------
    show_perf_hud: bool,
    frame_times: std::collections::VecDeque<std::time::Duration>,
    last_timings: FrameTimings,
    present_mode: wgpu::PresentMode,
    pending_present_mode: Option<wgpu::PresentMode>,

    // --- Split view --------------------------------------------------
    /// When the active tab has a `split_kind`, this tracks which child
    /// the mouse is over (0 = primary/left/top, 1 = paired/right/bottom).
    /// Used for hit-testing, zoom-at-cursor, and panel context.
    active_split_child: u8,
    /// Sub-rect (physical px) of the primary child. Cached each frame for input.
    /// Stored in PHYSICAL pixels so it can be compared directly against
    /// `mouse_pos` (also physical px from winit CursorMoved).
    split_primary_rect: (f32, f32, f32, f32),
    /// Sub-rect (physical px) of the paired child (only valid when split is active).
    split_secondary_rect: (f32, f32, f32, f32),

    // --- Editor: clipboard + delete request --------------------------
    /// Snapshot of the most recent Ctrl+C / Ctrl+X. Pasted on Ctrl+V.
    /// Cross-tab paste is allowed because DeletedEntity is self-contained.
    clipboard: Vec<DeletedEntity>,
    /// Set by the keyboard handler when Delete / Backspace was pressed.
    /// Drained at the top of the next frame so we can mutate scene + GPU
    /// buffers from inside the render loop where we already hold gpu.
    requested_delete: bool,
    /// Set by the keyboard handler when Ctrl+V was pressed (frame-deferred
    /// so the paste happens where we have GPU access).
    requested_paste: bool,
    /// Set by the keyboard handler when Ctrl+Z was pressed.
    requested_undo: bool,
    /// Set by the keyboard handler when Ctrl+A was pressed.
    requested_select_all: bool,
    /// Set by the keyboard handler when Ctrl+C / Ctrl+X was pressed.
    /// X also flips `requested_delete`.
    requested_copy: bool,

    // Blok 3 â€” Rotate / Scale / Mirror tool state.
    // All three tools are two-click gestures. First click stashes a world
    // anchor; second click/drag-release commits the transform. State clears
    // on ToolMode switch + Esc.
    /// First click (pivot) for the Rotate tool â€” world coords.
    rotate_pivot: Option<[f64; 2]>,
    /// First click (pivot) for the Scale tool â€” world coords. Subsequent
    /// LMB press+drag+release defines the factor (|release - pivot| /
    /// |press - pivot|).
    scale_pivot: Option<[f64; 2]>,
    /// Press-time anchor for the Scale drag so factor is stable against
    /// cursor jitter at press time. Filled on LMB press after pivot exists.
    scale_ref: Option<[f64; 2]>,
    /// First click (axis anchor A) for the Mirror tool.
    mirror_a: Option<[f64; 2]>,

    /// Set by the keyboard handler when Ctrl+D was pressed â€” duplicate
    /// selected entities into fresh ids with a small offset. Reuses the
    /// Paste undo variant since semantics are identical.
    requested_duplicate: bool,

    /// Set by the keyboard handler (X) or by the Viewer ribbon Edit
    /// group's Explode button. Frame-deferred so the scene mutation
    /// happens where GPU access is held. The dispatcher walks the
    /// current selection, finds entities whose `entity_names[i]` starts
    /// with `INSERT`, and reassigns each of their segments + triangles
    /// to fresh entity_idx values so the block's children become
    /// independently selectable.
    requested_explode: bool,

    // --- Text editor (F2 / double-click) -----------------------------
    /// Active in-flight text-edit session, if any. See `EditTextState`.
    /// Set by `enter_text_edit`, cleared by `commit_text_edit` /
    /// `cancel_text_edit`.
    edit_mode: Option<EditTextState>,
    /// Previous LMB-release time + pos for double-click detection. Both
    /// updated on every LMB release; a click counts as a double when the
    /// next release is within 400 ms and 6 px of these.
    last_lmb_click_time: Option<std::time::Instant>,
    last_lmb_click_pos: (f32, f32),

    // --- Ribbon (superui) -------------------------------------------
    /// Identifier of the active ribbon tab. Drives which tab's groups
    /// the `superui::Ribbon` widget renders each frame. Free-form
    /// string keyed against the ids in `build_ribbon_tabs`.
    active_ribbon_tab: RibbonTabId,

    /// In-flight background loads. Each `LoadingJob` owns the receiving
    /// end of an mpsc channel that the worker thread posts a
    /// `LoadingMsg::Done(Scene)` (or `Failed`) into when it finishes.
    /// Drained once per frame in `poll_loading_jobs`.
    loading_jobs: Vec<LoadingJob>,

    /// In-app file-picker modal â€” replaces the native rfd Open dialog
    /// with a thumbnail + version-badge tile grid. Lazily initialised
    /// on first open so the start directory tracks the active tab.
    file_picker_open: bool,
    file_picker_state: Option<superui::dialogs::FilePickerState>,
    /// Background preview-generation channel + per-path entry cache.
    preview_cache: HashMap<std::path::PathBuf, superui::dialogs::PreviewEntry>,
    preview_inflight: HashSet<std::path::PathBuf>,
    preview_tx: Option<mpsc::Sender<(std::path::PathBuf, Option<egui::ColorImage>)>>,
    preview_rx: Option<mpsc::Receiver<(std::path::PathBuf, Option<egui::ColorImage>)>>,
}

/// Glue between the in-app `FilePicker` and `App`'s preview cache.
struct AppPreviewProvider<'a> {
    cache: &'a mut HashMap<std::path::PathBuf, superui::dialogs::PreviewEntry>,
    inflight: &'a mut HashSet<std::path::PathBuf>,
    spawn_queue: &'a mut Vec<std::path::PathBuf>,
}

impl<'a> superui::dialogs::PreviewProvider for AppPreviewProvider<'a> {
    fn request(&mut self, path: &std::path::Path) -> Option<&superui::dialogs::PreviewEntry> {
        if !self.cache.contains_key(path) && !self.inflight.contains(path) {
            self.inflight.insert(path.to_path_buf());
            self.spawn_queue.push(path.to_path_buf());
        }
        self.cache.get(path)
    }
}

/// One in-flight background DWG/DXF/IFCDraw load.
struct LoadingJob {
    /// Receiver for the worker's final `LoadingMsg`. The worker drops
    /// the sender after sending; an `Err(Disconnected)` from try_recv
    /// without a prior message means the worker panicked and we
    /// should surface that as a failed load.
    rx: mpsc::Receiver<LoadingMsg>,
    /// File path being loaded â€” kept around for the "loaded in 1.2s"
    /// log line and the placeholder tab's path field.
    path: String,
    /// Index into `App.tabs` of the placeholder tab to swap when done.
    /// On replace-active loads this points at the active tab; on
    /// open-new loads it points at a freshly pushed placeholder.
    tab_idx: usize,
    /// Wall-clock when the worker thread was spawned. Reported once at
    /// completion for diagnostics.
    started_at: Instant,
    /// Cancel flag shared with the worker thread. Flipped to true by
    /// the UI thread when the user clicks the Cancel button on the
    /// loading overlay; the worker polls it at hot-path boundaries
    /// (entity loops, INSERT expansion) and returns `LoadCancelled`
    /// early when it observes the flag.
    cancel: Arc<AtomicBool>,
}

/// Message posted from the loader worker thread to the UI thread.
enum LoadingMsg {
    /// Final result â€” Scene loaded successfully.
    Done(Box<Scene>),
    /// Final result â€” load failed; carries the human-readable error.
    Failed(String),
    /// Final result â€” user clicked Cancel and the worker bailed out.
    /// The placeholder tab is dropped silently (no error overlay).
    Cancelled,
}

/// Per-section render timings â€” one frame.
#[derive(Clone, Copy, Default)]
struct FrameTimings {
    total: std::time::Duration,
    egui_run: std::time::Duration,
    camera_upload: std::time::Duration,
    scene_pass: std::time::Duration,
    egui_paint: std::time::Duration,
    present: std::time::Duration,
}

const RECENT_FILES_MAX: usize = 10;

/// Cap on the per-App camera history stack. ~50 entries × ~64 bytes
/// each is negligible (~3 KB) but bounds memory across a long session.
const CAMERA_HISTORY_MAX: usize = 50;

/// Build/run variant. `Studio` is the full authoring shell (Open 2D
/// Studio binary). `Viewer` is the view-only release (Open 2D Viewer
/// binary): ribbon is stripped to File / Home / View, all editing
/// tools are inert, Save dialogs no-op, F2 / Delete / Ctrl+S / Ctrl+V
/// are ignored. Both share the same source â€” see `studio_app::run`.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum AppMode {
    Studio,
    Viewer,
}

impl Default for AppMode {
    fn default() -> Self { AppMode::Studio }
}

/// One match in the Find dialog. The viewer searches three corpora per
/// scene: TEXT/MTEXT/ATTRIB content, layer names, and entity-name
/// summaries (which carry the DWG/DXF handle in `h=0xAB` form). On
/// click the matched entity (when known) gets selected + zoomed-to.
#[derive(Clone, Debug)]
struct FindMatch {
    kind: FindMatchKind,
    label: String,
    eid: Option<u32>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum FindMatchKind {
    Text,
    Layer,
    EntityName,
}

/// Measure-tool sub-mode. The `Measure` ToolMode is a thin shell that
/// dispatches by this enum: `Length` is a two-click distance measurement;
/// `Area` collects N polygon vertices and reports perimeter + enclosed area.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum MeasureSub {
    Length,
    Area,
}

impl Default for MeasureSub {
    fn default() -> Self { MeasureSub::Length }
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum ToolMode {
    Select,
    Measure,
    Move,
    // Annotate tools â€” per user request: linear maatlijn + area measurement, per-tab persistence
    Dimension,
    Area,
    // Blok 3 â€” per user request: Rotate / Scale / Mirror transforms on selection.
    // Each tool is a two-click gesture committed on the second LMB release.
    // Live-preview is intentionally NOT wired (Scale is drag-based).
    Rotate,
    Scale,
    Mirror,
    /// "ZR" chord â€” drag a rectangle on the canvas, camera fits to it
    /// on release, then mode reverts to Select. Engaged by typing Z
    /// then R within a 1-second window (see `key_chord_pending`).
    ZoomRegion,
    /// One-shot recenter — next LMB click reads its world coord, the
    /// camera centers on it (zoom + rotation unchanged), then the
    /// tool reverts to Select. Engaged by the View ribbon's Zoom
    /// Center button.
    ZoomCenter,
    /// Three-click angle measurement: vertex + ray1 end + ray2 end.
    /// On the third click we compute the angle between the two rays
    /// and store the result in `last_measure_angle`. Engaged by the
    /// Home ribbon's Measure/Angle button.
    MeasureAngle,
    /// One-shot coordinate readout — next LMB click reads its world
    /// coord and displays it as a floating label until the next
    /// click. Engaged by the Home ribbon's Measure/Coord. button.
    MeasureCoord,
}

// Annotate tools â€” per user request: linear maatlijn + area measurement, per-tab persistence
/// Persistent drawing annotations created by the Dimension / Area tools.
/// Stored per-tab (see `FileTab::annotations`) so each loaded file owns its
/// own set. No undo, no snap, no grid â€” purely an on-top visual overlay.
#[derive(Clone, Debug)]
enum Annotation {
    /// Linear dimension between P1 and P2. `offset` is the signed perpendicular
    /// distance from the baseline to the dim-line (positive = left of P1â†’P2
    /// direction). Currently always 0 at creation time â€” future UI could add
    /// a drag handle to pull the dim-line off the measured edge.
    LinearDim { p1: [f64; 2], p2: [f64; 2], offset: f64 },
    /// Closed polygon with pre-computed shoelace area (world unitsÂ²).
    Area { verts: Vec<[f64; 2]>, value: f64 },
}

#[derive(Clone)]
struct SampleEntry {
    label: String,
    path:  String,
    size:  u64,
    kind:  &'static str,  // "DWG" or "DXF"
}

/// Convert world-space X to screen-pixel X (PHYSICAL px). Inverse of the
/// X branch of `App::screen_to_world_in`. Used by the floating text-edit
/// overlay to anchor itself at the entity's on-screen position.
///
/// Mirrors the forward transform exactly: subtract pan + origin, apply
/// forward camera rotation by +theta, divide by world-per-pixel, add the
/// canvas centre.
fn world_to_screen_x_helper(wx: f64, wy: f64, cam: &PaneCam, rect: (f32, f32, f32, f32)) -> f32 {
    let (cx, _cy, cw, ch) = rect;
    let centre_x = cx + cw * 0.5;
    let h = ch.max(1.0) as f64;
    let wpp = (2.0 / cam.zoom) / h;
    let wx_off = wx - cam.pan_x - cam.origin[0];
    let wy_off = wy - cam.pan_y - cam.origin[1];
    let th = cam.rotation;
    let (ct, st) = (th.cos(), th.sin());
    let ex = ct * wx_off - st * wy_off;
    centre_x + (ex / wpp) as f32
}

/// Convert world-space Y to screen-pixel Y (PHYSICAL px). Inverse of the
/// Y branch of `App::screen_to_world_in` (note the y-flip: world +Y up,
/// screen +Y down).
fn world_to_screen_y_helper(wx: f64, wy: f64, cam: &PaneCam, rect: (f32, f32, f32, f32)) -> f32 {
    let (_cx, cy, _cw, ch) = rect;
    let centre_y = cy + ch * 0.5;
    let h = ch.max(1.0) as f64;
    let wpp = (2.0 / cam.zoom) / h;
    let wx_off = wx - cam.pan_x - cam.origin[0];
    let wy_off = wy - cam.pan_y - cam.origin[1];
    let th = cam.rotation;
    let (ct, st) = (th.cos(), th.sin());
    let ey = st * wx_off + ct * wy_off;
    centre_y - (ey / wpp) as f32
}

impl App {
    fn new(tabs: Vec<FileTab>) -> Self {
        let tabs = if tabs.is_empty() {
            vec![FileTab::new(
                Scene::empty("(empty)", "Press Ctrl+O to open".to_string()),
                None,
            )]
        } else { tabs };
        Self {
            mode: AppMode::Studio,
            window: None, gpu: None,
            tabs,
            active_tab: 0,
            mouse_pos: (0.0, 0.0),
            canvas_rect: (0.0, 0.0, 1.0, 1.0),
            dragging: false, drag_start: (0.0, 0.0), drag_start_pan: (0.0, 0.0),
            modifiers: ModifiersState::empty(),
            samples_panel_open: false,
            samples: discover_samples(),
            layer_panel_open: true,
            // Default OFF — user can flip on via the ribbon Properties
            // button or F4. Keeps the canvas wider on first launch and
            // matches the read-mostly use case in Viewer mode.
            properties_panel_open: false,
            about_dialog_open: false,
            // The new superui LeftDock/RightDock are scaffolds that
            // duplicate the legacy LAYERS / PROPERTIES panels with no
            // distinct content yet. Keep them OFF by default so the
            // user only sees one panel per side. Once their content is
            // genuinely additive (drawings/sheets nav, drawing-level
            // form) flip these defaults back to true.
            left_dock_open: false,
            right_dock_open: false,
            drawings_open: true,
            sheets_open: true,
            drawings: vec!["Drawing 1".to_string()],
            sheets: vec![("Sheet 1".to_string(),
                          "No number | A3 (420x297mm)".to_string())],
            active_drawing_idx: Some(0),
            active_sheet_idx: Some(0),
            rd_name: "Drawing 1".to_string(),
            rd_type: "Stand Alone".to_string(),
            rd_show_axes: true,
            rd_boundary_enabled: false,
            rd_x: 0.0,
            rd_y: 0.0,
            rd_w: 420.0,
            rd_h: 297.0,
            app_menu_open: false,
            save_as_dwg_modal_open: false,
            structure_panel_open: false,
            structure_expanded: HashSet::new(),
            structure_selected: None,
            lmb_pressed: false, lmb_press_pos: (0.0, 0.0),
            lmb_press_tab: 0,
            lmb_press_rect: (0.0, 0.0, 0.0, 0.0),
            tool_mode: ToolMode::Select,
            measure_p1: None,
            last_measurement: None,
            // OSNAP defaults â€” Endpoint + Midpoint + Center + Intersection
            // + Nearest (AutoCAD baseline).
            // Default ON: Endpoint, Midpoint, Center. Per user request
            // Intersection (Int) and Nearest (Near) default to OFF — they
            // tend to over-trigger and steal the cursor from the precise
            // snap points users actually want. Toggle on via the status-
            // bar OSNAP strip when needed.
            snap_modes: SnapModeSet::ENDPOINT
                | SnapModeSet::MIDPOINT
                | SnapModeSet::CENTER,
            current_snap: None,
            measure_sub: MeasureSub::Length,
            measure_area_in_progress: Vec::new(),
            last_measure_area: None,
            measure_angle_pts: Vec::new(),
            last_measure_angle: None,
            last_measure_coord: None,
            find_dialog_open: false,
            find_query: String::new(),
            find_matches: Vec::new(),
            // Annotate tools â€” per user request: linear maatlijn + area measurement, per-tab persistence
            dim_p1: None,
            area_in_progress: Vec::new(),
            key_chord_pending: None,
            key_chord_at: None,
            zoom_region_p1: None,
            cursor_world: None,
            recent_files: load_recent_files(),
            ortho_enabled: false,
            camera_history: Vec::new(),
            show_grid: false,
            white_bg: false,
            view_mode_idx: 0,
            show_perf_hud: false,
            frame_times: std::collections::VecDeque::with_capacity(60),
            last_timings: FrameTimings::default(),
            present_mode: wgpu::PresentMode::Fifo,
            pending_present_mode: None,
            active_split_child: 0,
            split_primary_rect: (0.0, 0.0, 1.0, 1.0),
            split_secondary_rect: (0.0, 0.0, 0.0, 0.0),
            clipboard: Vec::new(),
            requested_delete: false,
            requested_paste: false,
            requested_undo: false,
            requested_select_all: false,
            requested_copy: false,
            // Blok 3 â€” Rotate/Scale/Mirror + duplicate state (idle).
            rotate_pivot: None,
            scale_pivot: None,
            scale_ref: None,
            mirror_a: None,
            requested_duplicate: false,
            requested_explode: false,
            // Text editor (Task 9): no edit in flight, no prior click.
            edit_mode: None,
            last_lmb_click_time: None,
            last_lmb_click_pos: (0.0, 0.0),
            // Ribbon defaults to the Home tab on launch â€” matches 1.0
            // reference (orange underline + light bg on Home at first paint).
            active_ribbon_tab: "home".to_string(),
            loading_jobs: Vec::new(),
            // File picker â€” lazily initialised on first open.
            file_picker_open: false,
            file_picker_state: None,
            preview_cache: HashMap::new(),
            preview_inflight: HashSet::new(),
            preview_tx: None,
            preview_rx: None,
        }
    }

    /// Spawn a background-thread load of `path` and push a placeholder
    /// FileTab so the user sees an immediate "Loadingâ€¦" overlay rather
    /// than a frozen window. The real Scene is swapped in when the
    /// worker thread sends `LoadingMsg::Done`. See `poll_loading_jobs`.
    fn start_load_into_new_tab(&mut self, path: String) {
        let placeholder = Scene::empty(
            "loading",
            format!("Loading {}â€¦", short_path(&path)),
        );
        let mut tab = FileTab::new(placeholder, Some(path.clone()));
        tab.loading = Some(LoadingState {
            phase: "Reading fileâ€¦".to_string(),
            fraction: 0.05,
            started_at: Instant::now(),
        });
        self.tabs.push(tab);
        let tab_idx = self.tabs.len() - 1;
        self.active_tab = tab_idx;
        if let Some(win) = self.window.as_ref() {
            win.set_title(&Self::title_for(&self.tabs, self.active_tab, self.mode));
        }
        let job = spawn_load_job(path.clone(), tab_idx);
        self.loading_jobs.push(job);
    }

    /// Like `start_load_into_new_tab` but reuses the active tab â€” used
    /// by Reload (Ctrl+R) so the user doesn't end up with a duplicate
    /// tab on every reload.
    fn start_load_into_active_tab(&mut self, path: String) {
        let tab_idx = self.active_tab;
        let Some(tab) = self.tabs.get_mut(tab_idx) else {
            // No active tab â†’ fall back to opening as new.
            self.start_load_into_new_tab(path);
            return;
        };
        tab.loading = Some(LoadingState {
            phase: "Reading fileâ€¦".to_string(),
            fraction: 0.05,
            started_at: Instant::now(),
        });
        let job = spawn_load_job(path.clone(), tab_idx);
        self.loading_jobs.push(job);
    }

    /// Drain finished loading jobs and swap their results into the
    /// placeholder tabs. Called once per frame from the render loop.
    fn poll_loading_jobs(&mut self) {
        // Iterate in reverse so we can swap_remove in place.
        let mut i = 0usize;
        while i < self.loading_jobs.len() {
            match self.loading_jobs[i].rx.try_recv() {
                Ok(LoadingMsg::Done(scene)) => {
                    let job = self.loading_jobs.swap_remove(i);
                    let elapsed = job.started_at.elapsed();
                    eprintln!("[load] '{}' done in {:.2}s",
                        short_path(&job.path), elapsed.as_secs_f64());
                    if let Some(tab) = self.tabs.get_mut(job.tab_idx) {
                        tab.cam = PaneCam::fit(&scene.bbox);
                        tab.scene = *scene;
                        tab.path = Some(job.path.clone());
                        tab.label = FileTab::derive_label(Some(&job.path));
                        // Version detect once the file definitely exists.
                        // (Placeholder tabs created in `open_file_at_path`
                        // can race the loader if the file lives on a slow
                        // disk — defer here so the badge populates on
                        // first paint after the load completes.)
                        tab.version = FileTab::detect_version_for_path(&job.path);
                        tab.loading = None;
                        tab.scene_index = None;
                        tab.snap_segments = None;
                        // GPU buffers will be (re)built on next frame's
                        // rebuild_buffers call, since the active-tab
                        // path always lazy-builds before drawing.
                    }
                    self.push_recent_file(&job.path);
                    if let Some(win) = self.window.as_ref() {
                        win.set_title(&Self::title_for(&self.tabs, self.active_tab, self.mode));
                    }
                    // Stay at index i â€” swap_remove pulled the next job here.
                }
                Ok(LoadingMsg::Failed(err)) => {
                    let job = self.loading_jobs.swap_remove(i);
                    eprintln!("[load] '{}' FAILED: {}", short_path(&job.path), err);
                    if let Some(tab) = self.tabs.get_mut(job.tab_idx) {
                        tab.loading = None;
                        tab.scene = Scene::empty(
                            "load-failed",
                            format!("load FAILED: {}", err),
                        );
                        tab.scene_index = None;
                        tab.snap_segments = None;
                    }
                }
                Ok(LoadingMsg::Cancelled) => {
                    let job = self.loading_jobs.swap_remove(i);
                    eprintln!("[load] '{}' cancelled by user after {:.2}s",
                        short_path(&job.path), job.started_at.elapsed().as_secs_f64());
                    if job.tab_idx < self.tabs.len() {
                        if self.tabs.len() == 1 {
                            if let Some(tab) = self.tabs.get_mut(0) {
                                tab.loading = None;
                                tab.scene = Scene::empty(
                                    "(empty)",
                                    "Press Ctrl+O to open".to_string(),
                                );
                                tab.path = None;
                                tab.label = "(empty)".to_string();
                                tab.version = None;
                                tab.scene_index = None;
                                tab.snap_segments = None;
                            }
                        } else {
                            self.tabs.remove(job.tab_idx);
                            for other in &mut self.loading_jobs {
                                if other.tab_idx > job.tab_idx {
                                    other.tab_idx -= 1;
                                }
                            }
                            if self.active_tab >= self.tabs.len() {
                                self.active_tab = self.tabs.len().saturating_sub(1);
                            } else if self.active_tab > job.tab_idx {
                                self.active_tab -= 1;
                            }
                        }
                        if let Some(win) = self.window.as_ref() {
                            win.set_title(&Self::title_for(&self.tabs, self.active_tab, self.mode));
                        }
                    }
                }
                Err(mpsc::TryRecvError::Empty) => { i += 1; }
                Err(mpsc::TryRecvError::Disconnected) => {
                    // Worker dropped sender without sending â€” treat as failure.
                    let job = self.loading_jobs.swap_remove(i);
                    eprintln!("[load] '{}' worker disconnected", short_path(&job.path));
                    if let Some(tab) = self.tabs.get_mut(job.tab_idx) {
                        tab.loading = None;
                        tab.scene = Scene::empty(
                            "load-failed",
                            "load FAILED: worker thread crashed".to_string(),
                        );
                    }
                }
            }
        }
    }

    fn modifiers_ctrl_held(&self) -> bool { self.modifiers.control_key() }
    fn modifiers_shift_held(&self) -> bool { self.modifiers.shift_key() }

    #[allow(dead_code)]
    fn active(&self) -> Option<&FileTab> { self.tabs.get(self.active_tab) }
    #[allow(dead_code)]
    fn active_mut(&mut self) -> Option<&mut FileTab> { self.tabs.get_mut(self.active_tab) }

    /// Index of the tab that owns input focus right now. Resolves
    /// `active_split_child`: child 0 â†’ the primary active tab, child 1 â†’
    /// the paired tab in its SplitKind (or the primary if no split).
    #[allow(dead_code)]
    fn focused_tab_idx(&self) -> usize {
        let primary = self.active_tab;
        let Some(tab) = self.tabs.get(primary) else { return primary; };
        match (self.active_split_child, tab.split_kind) {
            (1, Some(SplitKind::HorizontalPair(other))) if other < self.tabs.len() => other,
            (1, Some(SplitKind::VerticalPair(other))) if other < self.tabs.len() => other,
            _ => primary,
        }
    }

    /// Sub-rect (px) that owns input focus right now. Mirrors
    /// `focused_tab_idx`. When no split, returns the whole canvas rect.
    #[allow(dead_code)]
    fn focused_canvas_rect(&self) -> (f32, f32, f32, f32) {
        if self.has_active_split() {
            if self.active_split_child == 1 { self.split_secondary_rect }
            else { self.split_primary_rect }
        } else {
            self.canvas_rect
        }
    }

    fn has_active_split(&self) -> bool {
        self.tabs.get(self.active_tab)
            .and_then(|t| t.split_kind)
            .map(|s| match s {
                SplitKind::HorizontalPair(o) | SplitKind::VerticalPair(o) => o < self.tabs.len(),
            })
            .unwrap_or(false)
    }

    /// Update `active_split_child` from current mouse_pos. Called on
    /// cursor-move so panel snapshots and hit-testing see the correct
    /// half. Uses the cached split sub-rects (both logical pixels).
    fn update_active_split_child(&mut self) {
        if !self.has_active_split() { self.active_split_child = 0; return; }
        let (mx, my) = self.mouse_pos;
        let (ax, ay, aw, ah) = self.split_primary_rect;
        let inside_primary = mx >= ax && mx < ax + aw && my >= ay && my < ay + ah;
        self.active_split_child = if inside_primary { 0 } else { 1 };
    }

    /// Return the partner tab index the given tab is paired with through
    /// its split_kind, if any. Handles bounds.
    #[allow(dead_code)]
    fn split_partner(tabs: &[FileTab], idx: usize) -> Option<usize> {
        tabs.get(idx).and_then(|t| t.split_kind).and_then(|s| match s {
            SplitKind::HorizontalPair(o) | SplitKind::VerticalPair(o) => {
                if o < tabs.len() && o != idx { Some(o) } else { None }
            }
        })
    }

    /// Window-title summary line.
    fn title_for(tabs: &[FileTab], active: usize, mode: AppMode) -> String {
        let active_label = tabs.get(active).map(|t| t.label.as_str()).unwrap_or("â€”");
        let total: usize = tabs.iter().map(|t| t.scene.segments.len()).sum();
        let app_name = match mode {
            AppMode::Studio => "Open 2D Studio",
            AppMode::Viewer => "Open 2D Viewer",
        };
        format!("{} â€” {} tab(s) Â· active: {} Â· {} segs total [Ctrl+O new tab Â· Ctrl+W close Â· Ctrl+Tab cycle]",
            app_name, tabs.len(), active_label, total)
    }

    /// Open a file picker and append the result as a new tab.
    ///
    /// The in-app file picker (`superui::dialogs::file_picker`) shipped
    /// in `e97746b` / `59899a2` is still rough â€” the user reported it
    /// as broken in real-world use ("file picker is het spoor bijster").
    /// To unblock the Open flow we default back to the native
    /// `rfd::FileDialog::pick_file()` here. The in-app picker code
    /// remains intact in `superui` and the wiring below stays in
    /// place â€” set the env var `O2D_FILE_PICKER_BETA=1` to opt back
    /// into it for development work.
    fn open_file_dialog(&mut self) {
        let beta = std::env::var_os("O2D_FILE_PICKER_BETA")
            .map(|v| v != "0" && !v.is_empty())
            .unwrap_or(false);
        if beta {
            self.open_file_dialog_in_app();
        } else {
            self.open_file_dialog_native();
        }
    }

    /// Native rfd Open dialog â€” the default Open path while the in-app
    /// picker is being repaired. Picks one DWG/DXF/IFCDraw file and
    /// kicks off `start_load_into_new_tab`.
    ///
    /// Viewer mode: limit the file-type filters to DXF + DWG only.
    /// IFCDraw / `.o2d` aren't supported (and the user explicitly
    /// asked for "alleen DXF en DWG" â€” confirmed 2026-05-20).
    fn open_file_dialog_native(&mut self) {
        let starting_dir = self.tabs.iter()
            .find_map(|t| t.path.as_ref())
            .and_then(|p| std::path::Path::new(p).parent().map(|d| d.to_path_buf()))
            .or_else(|| std::env::var_os("USERPROFILE").map(std::path::PathBuf::from))
            .unwrap_or_else(|| std::path::PathBuf::from("."));
        let mut dialog = rfd::FileDialog::new()
            .set_title("Open file");
        if self.mode == AppMode::Viewer {
            dialog = dialog
                .add_filter("CAD files (*.dwg, *.dxf)", &["dwg", "dxf"])
                .add_filter("AutoCAD DWG", &["dwg"])
                .add_filter("AutoCAD DXF", &["dxf"]);
        } else {
            dialog = dialog
                .add_filter("CAD files", &["dwg", "dxf", "ifcdraw"])
                .add_filter("AutoCAD DWG", &["dwg"])
                .add_filter("AutoCAD DXF", &["dxf"])
                .add_filter("IFCDraw", &["ifcdraw"])
                .add_filter("All files", &["*"]);
        }
        if starting_dir.is_dir() {
            dialog = dialog.set_directory(&starting_dir);
        }
        if let Some(path) = dialog.pick_file() {
            let s = path.to_string_lossy().into_owned();
            eprintln!("[tab open] picked (native): {}", s);
            self.start_load_into_new_tab(s);
        }
    }

    /// In-app file picker â€” currently behind the `O2D_FILE_PICKER_BETA`
    /// env var while it's being repaired. Lazily seeds the picker
    /// state, sets up the preview channel and flags the modal open.
    fn open_file_dialog_in_app(&mut self) {
        if self.file_picker_state.is_none() {
            let starting_dir = self.tabs.iter()
                .find_map(|t| t.path.as_ref())
                .and_then(|p| std::path::Path::new(p).parent().map(|d| d.to_path_buf()))
                .or_else(|| std::env::var_os("USERPROFILE").map(std::path::PathBuf::from))
                .unwrap_or_else(|| std::path::PathBuf::from("."));
            let mut recents: Vec<std::path::PathBuf> = Vec::new();
            let mut seen = HashSet::new();
            for t in &self.tabs {
                if let Some(p) = t.path.as_ref() {
                    if let Some(parent) = std::path::Path::new(p).parent() {
                        let pb = parent.to_path_buf();
                        if seen.insert(pb.clone()) { recents.push(pb); }
                    }
                }
            }
            self.file_picker_state =
                Some(superui::dialogs::FilePickerState::new(starting_dir, recents));
        }
        if self.preview_tx.is_none() {
            let (tx, rx) = mpsc::channel();
            self.preview_tx = Some(tx);
            self.preview_rx = Some(rx);
        }
        self.file_picker_open = true;
    }

    /// "Save As IFC 2D B" â€” run the IFCX-binary exporter on the active
    /// tab. Opens an rfd save-file dialog (defaulted to the source
    /// DWG's directory + `.ifcx` extension), encodes the tessellated
    /// scene via `crate::ifcx_export::write_ifcx_binary`, writes
    /// it atomically, and logs a size comparison vs. the source DWG.
    ///
    /// No-op when there's no active tab or no scene to export.
    fn save_as_ifcx_binary(&mut self) {
        let Some(tab) = self.tabs.get(self.active_tab) else {
            eprintln!("[save-as-ifcx] no active tab");
            return;
        };
        let source_path = tab.path.clone();
        let starting_dir = source_path
            .as_ref()
            .and_then(|p| std::path::Path::new(p).parent().map(|d| d.to_path_buf()));
        let default_name = source_path
            .as_ref()
            .and_then(|p| std::path::Path::new(p).file_stem())
            .map(|s| s.to_string_lossy().into_owned())
            .unwrap_or_else(|| "untitled".to_string());
        let mut dialog = rfd::FileDialog::new()
            .set_title("Save As IFCDraw (binary IFCX)")
            .set_file_name(format!("{default_name}.ifcdraw"))
            .add_filter("IFCDraw (*.ifcdraw)", &["ifcdraw"]);
        if let Some(dir) = starting_dir {
            dialog = dialog.set_directory(dir);
        }
        let Some(out_path) = dialog.save_file() else {
            eprintln!("[save-as-ifcx] cancelled");
            return;
        };

        let t0 = std::time::Instant::now();
        let bytes = match write_ifcx_binary(&tab.scene, source_path.as_deref()) {
            Ok(b) => b,
            Err(e) => {
                eprintln!("[save-as-ifcx] encode failed: {e}");
                return;
            }
        };
        if let Err(e) = std::fs::write(&out_path, &bytes) {
            eprintln!("[save-as-ifcx] write failed: {e}");
            return;
        }
        let dt_ms = t0.elapsed().as_millis();

        // Size comparison vs. the source DWG/DXF (if we still know it).
        let out_bytes = bytes.len() as u64;
        let src_bytes = source_path
            .as_ref()
            .and_then(|p| std::fs::metadata(p).ok())
            .map(|m| m.len());
        match src_bytes {
            Some(src) if src > 0 => {
                let ratio = (out_bytes as f64 / src as f64) * 100.0;
                eprintln!(
                    "[save-as-ifcx] wrote {} ({} bytes) â€” source {} bytes â€” ratio {:.1}% â€” encode {} ms",
                    out_path.display(),
                    out_bytes,
                    src,
                    ratio,
                    dt_ms,
                );
            }
            _ => {
                eprintln!(
                    "[save-as-ifcx] wrote {} ({} bytes) â€” encode {} ms",
                    out_path.display(),
                    out_bytes,
                    dt_ms,
                );
            }
        }
    }

    /// "Save As DXF" â€” round-trip the active tab's (possibly user-edited)
    /// tessellated Scene back to a textual DXF R2013 (AC1027) file. Every
    /// CAD app on the planet can open DXF â€” so this is our interim
    /// "save the user's edits" path until the binary DWG writer lands as
    /// a separate project.
    ///
    /// Defaults the save dialog to the source file's directory with
    /// `<stem>_o2d.dxf` as the filename. On success, logs the output size
    /// alongside the original DWG/DXF size for comparison.
    fn save_as_dxf(&mut self) {
        let Some(tab) = self.tabs.get(self.active_tab) else {
            eprintln!("[save-as-dxf] no active tab");
            return;
        };
        let source_path = tab.path.clone();
        let starting_dir = source_path
            .as_ref()
            .and_then(|p| std::path::Path::new(p).parent().map(|d| d.to_path_buf()));
        let default_stem = source_path
            .as_ref()
            .and_then(|p| std::path::Path::new(p).file_stem())
            .map(|s| s.to_string_lossy().into_owned())
            .unwrap_or_else(|| "untitled".to_string());
        let mut dialog = rfd::FileDialog::new()
            .set_title("Save As DXF (AutoCAD R2013 textual)")
            .set_file_name(format!("{default_stem}_o2d.dxf"))
            .add_filter("AutoCAD DXF (*.dxf)", &["dxf"]);
        if let Some(dir) = starting_dir {
            dialog = dialog.set_directory(dir);
        }
        let Some(out_path) = dialog.save_file() else {
            eprintln!("[save-as-dxf] cancelled");
            return;
        };

        let t0 = std::time::Instant::now();
        let file = match std::fs::File::create(&out_path) {
            Ok(f) => f,
            Err(e) => {
                eprintln!("[save-as-dxf] open failed ({}): {e}", out_path.display());
                return;
            }
        };
        // BufWriter matters â€” write_dxf does many small writeln!s per entity.
        let mut writer = std::io::BufWriter::new(file);
        if let Err(e) = write_dxf_filtered(&tab.scene, &mut writer, &tab.deleted_layers) {
            eprintln!("[save-as-dxf] encode failed: {e}");
            return;
        }
        if let Err(e) = std::io::Write::flush(&mut writer) {
            eprintln!("[save-as-dxf] flush failed: {e}");
            return;
        }
        drop(writer);
        let dt_ms = t0.elapsed().as_millis();

        let out_bytes = std::fs::metadata(&out_path).map(|m| m.len()).unwrap_or(0);
        let src_bytes = source_path
            .as_ref()
            .and_then(|p| std::fs::metadata(p).ok())
            .map(|m| m.len());
        match src_bytes {
            Some(src) if src > 0 => {
                let ratio = (out_bytes as f64 / src as f64) * 100.0;
                eprintln!(
                    "[save-as-dxf] wrote {} ({} bytes, written by Open 2D Studio) â€” source {} bytes â€” ratio {:.1}% â€” encode {} ms",
                    out_path.display(),
                    out_bytes,
                    src,
                    ratio,
                    dt_ms,
                );
            }
            _ => {
                eprintln!(
                    "[save-as-dxf] wrote {} ({} bytes, written by Open 2D Studio) â€” encode {} ms",
                    out_path.display(),
                    out_bytes,
                    dt_ms,
                );
            }
        }
    }

    /// Append a new tab built from `scene`/`path` and make it active.
    fn push_tab_with_scene(&mut self, scene: Scene, path: Option<String>) {
        let mut tab = FileTab::new(scene, path);
        if let Some(gpu) = self.gpu.as_ref() {
            tab.rebuild_buffers(gpu);
        }
        self.tabs.push(tab);
        self.active_tab = self.tabs.len() - 1;
        self.dragging = false;
        if let Some(win) = self.window.as_ref() {
            win.set_title(&Self::title_for(&self.tabs, self.active_tab, self.mode));
        }
    }

    /// Replace the scene in the ACTIVE tab (used by Reload).
    fn replace_active_scene(&mut self, scene: Scene, path: Option<String>) {
        let Some(tab) = self.tabs.get_mut(self.active_tab) else { return; };
        tab.cam = PaneCam::fit(&scene.bbox);
        tab.scene = scene;
        tab.path = path.clone();
        tab.label = FileTab::derive_label(path.as_deref());
        tab.version = path.as_deref().and_then(FileTab::detect_version_for_path);
        tab.selection.clear();
        tab.hover = None;
        tab.hidden_layers.clear();
        tab.deleted_layers.clear();
        tab.move_drag = None;
        tab.move_drag_multi = None;
        tab.pending_move_offset = [0.0, 0.0];
        tab.undo_stack.clear();
        // Invalidate the spatial index â€” segments are entirely different now.
        tab.scene_index = None;
        tab.snap_segments = None;
        if let Some(gpu) = self.gpu.as_ref() {
            tab.rebuild_buffers(gpu);
        }
        self.dragging = false;
        if let Some(win) = self.window.as_ref() {
            win.set_title(&Self::title_for(&self.tabs, self.active_tab, self.mode));
        }
    }

    /// Close a tab by index. Guarantees at least one tab remains (the
    /// blank "Start" tab is inserted when we'd drop to zero). Also
    /// rewrites any `split_kind` on remaining tabs so indices stay valid
    /// after the removal: pairs that pointed to `idx` are cleared, and
    /// pairs that pointed past `idx` are shifted down by 1.
    fn close_tab(&mut self, idx: usize) {
        if idx >= self.tabs.len() { return; }
        self.tabs.remove(idx);

        // Fix up split_kind references after the shift.
        for (i, t) in self.tabs.iter_mut().enumerate() {
            if let Some(sk) = t.split_kind {
                let other = match sk { SplitKind::HorizontalPair(o) | SplitKind::VerticalPair(o) => o };
                if other == idx || i == other_after_remove(other, idx) {
                    // Partner gone OR somehow pointing at self â€” clear.
                    t.split_kind = None;
                    continue;
                }
                let new_other = other_after_remove(other, idx);
                t.split_kind = Some(match sk {
                    SplitKind::HorizontalPair(_) => SplitKind::HorizontalPair(new_other),
                    SplitKind::VerticalPair(_)   => SplitKind::VerticalPair(new_other),
                });
            }
        }

        if self.tabs.is_empty() {
            self.tabs.push(FileTab::new(
                Scene::empty("(empty)", "Press Ctrl+O to open".to_string()),
                None,
            ));
        }
        if self.active_tab >= self.tabs.len() {
            self.active_tab = self.tabs.len() - 1;
        }
        // If we removed a tab before the active one, shift active.
        if idx < self.active_tab {
            self.active_tab -= 1;
        }
        self.active_split_child = 0;
        if let Some(win) = self.window.as_ref() {
            win.set_title(&Self::title_for(&self.tabs, self.active_tab, self.mode));
        }
    }

    /// Cycle to next / prev tab.
    fn cycle_tab(&mut self, forward: bool) {
        if self.tabs.len() <= 1 { return; }
        if forward {
            self.active_tab = (self.active_tab + 1) % self.tabs.len();
        } else {
            self.active_tab = (self.active_tab + self.tabs.len() - 1) % self.tabs.len();
        }
        if let Some(win) = self.window.as_ref() {
            win.set_title(&Self::title_for(&self.tabs, self.active_tab, self.mode));
        }
    }

    /// Build ortho view-proj for the active canvas.
    ///
    /// World â†’ clip chain (column-major in Rust literals below):
    ///   clip = proj(scale) * rot(-cam.rotation) * translate(-pan)
    /// i.e. the world is translated by `-pan`, then rotated so that a
    /// positive `cam.rotation` spins the canvas counter-clockwise on
    /// screen (matches the compass convention on the view-cube), and
    /// finally scaled to NDC so the camera covers `[-half_w, half_w]
    /// Ã— [-half_h, half_h]` world units.
    fn camera_of(cam: &PaneCam, aspect: f32) -> CameraUbo {
        let half_h = (1.0 / cam.zoom) as f32;
        let half_w = half_h * aspect;
        let sx = 1.0 / half_w;
        let sy = 1.0 / half_h;
        let th = cam.rotation as f32;
        let (ct, st) = (th.cos(), th.sin());
        // 2Ã—2 basis: scale * rot(-Î¸)  (note the sign on st for the row-2
        // assembly â€” we want world +X to stay right when Î¸=0 and to tilt
        // toward world +Y as Î¸ grows).
        let m00 = sx * ct;
        let m01 = sx * st;
        let m10 = -sy * st;
        let m11 = sy * ct;
        // Translation: the world origin after -pan becomes the camera
        // centre; rotation+scale then maps that to clip origin.
        let dx = -cam.pan_x as f32;
        let dy = -cam.pan_y as f32;
        let tx = m00 * dx + m10 * dy;
        let ty = m01 * dx + m11 * dy;
        CameraUbo { view_proj: [
            [m00, m01, 0.0, 0.0],
            [m10, m11, 0.0, 0.0],
            [0.0, 0.0, 1.0, 0.0],
            [tx,  ty,  0.0, 1.0],
        ]}
    }

    fn render(&mut self) {
        let frame_start = std::time::Instant::now();
        // Pick up any results from background loader threads BEFORE the
        // egui pass so the placeholder tab swaps in on the same frame
        // and the user sees the loaded scene immediately.
        self.poll_loading_jobs();
        // Apply any pending present-mode switch BEFORE reading surface config.
        if let Some(new_mode) = self.pending_present_mode.take() {
            if let Some(gpu) = self.gpu.as_mut() {
                gpu.config.present_mode = new_mode;
                gpu.surface.configure(&gpu.device, &gpu.config);
            }
            self.present_mode = new_mode;
        }

        // Dashed-line zoom-tracking: the line vertex buffer bakes
        // dashed-segment strokes at a fixed SCREEN-pixel stride using
        // the camera's world-per-pixel factor at build time. When the
        // user zooms in/out far enough (tracked by
        // `dash_pixel_stride_changed`) the baked strokes drift; rebuild
        // the line buffer for the active tab so the dashes stay sized
        // correctly on screen. Cheap when nothing dashed is in scope â€”
        // the helper short-circuits on all-solid scenes.
        if self.gpu.is_some() {
            let active = self.active_tab;
            // Use the canvas-rect height (set last frame in App::render)
            // so dash stride matches the actual viewport, not the full
            // framebuffer. canvas_rect.3 is in physical pixels.
            let canvas_h = if self.canvas_rect.3 > 1.0 {
                Some(self.canvas_rect.3)
            } else {
                None
            };
            if let Some(tab) = self.tabs.get(active) {
                let needs_redash = self.gpu.as_ref()
                    .map(|gpu| tab.dash_pixel_stride_changed(gpu, canvas_h))
                    .unwrap_or(false);
                if needs_redash {
                    if let (Some(tab), Some(gpu)) = (self.tabs.get_mut(active), self.gpu.as_ref()) {
                        tab.rebuild_buffers_with_canvas(gpu, canvas_h);
                    }
                }
            }
        }

        // --- Snapshots for egui closure ---------------------------------
        let ppp = self.window.as_ref().map(|w| w.scale_factor() as f32).unwrap_or(1.0);
        let tab_labels: Vec<String> = self.tabs.iter().map(|t| t.label.clone()).collect();
        let tab_versions: Vec<Option<String>> =
            self.tabs.iter().map(|t| t.version.clone()).collect();
        let active_tab_idx = self.active_tab;
        let n_tabs = self.tabs.len();
        // View-cube needs the active tab's current rotation, snapped into
        // a plain f64 so the egui closure doesn't borrow `self.tabs`.
        let active_cam_rotation: f64 = self.tabs.get(active_tab_idx)
            .map(|t| t.cam.rotation).unwrap_or(0.0);
        // Full active-cam snapshot for the world-axes glyph (paints at
        // world (0,0)). Same rationale as `active_cam_rotation` â€” avoid
        // borrowing `self.tabs` inside the egui closure.
        let active_cam_origin: [f64; 2] = self.tabs.get(active_tab_idx)
            .map(|t| t.cam.origin).unwrap_or([0.0, 0.0]);
        let active_cam_pan: (f64, f64) = self.tabs.get(active_tab_idx)
            .map(|t| (t.cam.pan_x, t.cam.pan_y)).unwrap_or((0.0, 0.0));
        let active_cam_zoom: f64 = self.tabs.get(active_tab_idx)
            .map(|t| t.cam.zoom).unwrap_or(1.0);

        // Layout list for the ACTIVE tab.
        let active_layouts: Vec<(String, [f64; 4])> = self.tabs.get(active_tab_idx)
            .map(|t| t.scene.layouts.clone()).unwrap_or_default();
        let active_show_paper: bool = self.tabs.get(active_tab_idx)
            .map(|t| t.show_paper).unwrap_or(false);

        // Layers for the active tab (if panel open).
        let layer_panel_open = self.layer_panel_open;
        let layers_for_active: Vec<(String, u32)> = if layer_panel_open {
            // Filter out deleted layers — once the user trash-clicks a
            // layer the row disappears from the LAYERS panel (visually
            // gone). The underlying segments stay hidden in Scene and
            // are dropped at Save-As time via write_dxf_filtered.
            let deleted: HashSet<String> = self.tabs.get(active_tab_idx)
                .map(|t| t.deleted_layers.clone()).unwrap_or_default();
            self.tabs.get_mut(active_tab_idx)
                .map(|t| t.layer_list_cached(DEFAULT_LINE_COLOR))
                .unwrap_or_default()
                .into_iter()
                .filter(|(name, _)| !deleted.contains(name))
                .collect()
        } else { Vec::new() };
        let hidden_snapshot: HashSet<String> = if layer_panel_open {
            self.tabs.get(active_tab_idx).map(|t| t.hidden_layers.clone()).unwrap_or_default()
        } else { HashSet::new() };

        let samples_open = self.samples_panel_open;
        let samples_snapshot: Vec<SampleEntry> = if samples_open { self.samples.clone() } else { Vec::new() };

        // Structure-tree snapshot: build the model browser tree for the
        // active tab's scene when the panel is open. Cheap to rebuild per
        // frame at typical scene sizes; revisit with caching on
        // FileTab if perf becomes an issue.
        let structure_panel_open = self.structure_panel_open;
        let structure_root: Option<TreeNode> = if structure_panel_open {
            self.tabs.get_mut(active_tab_idx).map(|t| t.structure_tree_cached())
        } else { None };

        // Properties snapshot. With multi-select, `prop_selection_idx`
        // is the FIRST picked segment (used to drive the legacy
        // single-segment view). `prop_selection_count` is the unique
        // entity count â€” when > 1 the panel switches to a summary view.
        let properties_panel_open = self.properties_panel_open;
        let prop_selection_idx: Option<usize> = self.tabs.get(active_tab_idx)
            .and_then(|t| t.selection.first().copied());
        let prop_segment = prop_selection_idx.and_then(|i|
            self.tabs.get(active_tab_idx).and_then(|t| t.scene.segments.get(i).copied()));
        let prop_selection_count: usize = self.selected_entity_count_in(active_tab_idx);
        let prop_scene_total = self.tabs.get(active_tab_idx).map(|t| t.scene.segments.len()).unwrap_or(0);
        let prop_tab_label = self.tabs.get(active_tab_idx).map(|t| t.label.clone()).unwrap_or_default();

        // `recent_files_snapshot` removed â€” snapshot was never read by the
        // egui closure but allocated a fresh Vec<String> per frame. The
        // recent-files menu lives in the AppMenuPanel pathway which
        // borrows `self.recent_files` directly under its own scope.
        let current_tool_mode = self.tool_mode;
        // Drag-box snapshot â€” overlay is shown when LMB is down in Select
        // mode and drift exceeds the same HiDPI-scaled threshold the
        // release path uses. Crossing direction = left-running drag.
        let drag_box_active: bool = {
            // ZR â€” also paint the drag-box rectangle while in zoom-region
            // mode so the user sees the area they're about to fit to.
            let mode_ok = self.tool_mode == ToolMode::Select
                || self.tool_mode == ToolMode::ZoomRegion;
            if !self.lmb_pressed || !mode_ok { false }
            else {
                let dx = self.mouse_pos.0 - self.lmb_press_pos.0;
                let dy = self.mouse_pos.1 - self.lmb_press_pos.1;
                let drift = (dx*dx + dy*dy).sqrt();
                let sf = self.window.as_ref().map(|w| w.scale_factor() as f32).unwrap_or(1.0);
                let thr = (4.0_f32 * sf).max(6.0);
                drift >= thr
            }
        };
        let drag_box_p1: (f32, f32) = self.lmb_press_pos;
        let drag_box_p2: (f32, f32) = self.mouse_pos;
        let drag_box_crossing: bool = drag_box_p2.0 < drag_box_p1.0;
        let drag_box_zoom: bool = self.tool_mode == ToolMode::ZoomRegion;
        // `last_measurement_snapshot` removed â€” unused, kept indirectly
        // via `last_measurement_len_snapshot` below (which the status-bar
        // measure overlay reads).
        let show_perf_hud_snapshot = self.show_perf_hud;
        let show_grid_snapshot = self.show_grid;
        let white_bg_snapshot = self.white_bg;
        let view_mode_idx_snapshot = self.view_mode_idx;
        // `present_mode_snapshot` removed â€” the Perf HUD now formats the
        // mode label inline from `self.present_mode` when assembling
        // `hud_text` below.
        let about_dialog_open_snapshot = self.about_dialog_open;
        let ortho_enabled_snapshot = self.ortho_enabled;
        let find_dialog_open_snapshot = self.find_dialog_open;
        let find_query_snapshot = self.find_query.clone();
        let find_matches_snapshot = self.find_matches.clone();
        let save_as_dwg_modal_snapshot = self.save_as_dwg_modal_open;
        let current_split_snapshot: Option<SplitKind> = self.tabs.get(active_tab_idx)
            .and_then(|t| t.split_kind);
        // Active ribbon tab id, snapshotted so the egui closure can build
        // the Ribbon without re-borrowing self mutably.
        let active_ribbon_tab_snapshot: RibbonTabId = self.active_ribbon_tab.clone();
        // Window maximised state, surfaced to the TitleBar so it can paint
        // the right glyph on the maximise button.
        // Build-variant snapshot â€” drives titlebar text, ribbon contents,
        // and editing-tool dispatch guards. See `AppMode`.
        let app_mode_snapshot = self.mode;
        let window_maximized_snapshot: bool = self.window
            .as_ref()
            .map(|w| w.is_maximized())
            .unwrap_or(false);

        // Status bar snapshots â€” cursor coords, camera zoom, layer counts,
        // active tab label. Cheap to compute; always needed at bottom of frame.
        let status_cursor_world = self.cursor_world;
        // Snap + Measure snapshots â€” status-bar toolbar + canvas overlay.
        let snap_modes_snapshot: SnapModeSet = self.snap_modes;
        let snap_result_snapshot: Option<SnapResult> = self.current_snap.clone();
        let measure_sub_snapshot: MeasureSub = self.measure_sub;
        let measure_p1_snapshot: Option<[f64; 2]> = self.measure_p1;
        let measure_area_inprog_snapshot: Vec<[f64; 2]> =
            self.measure_area_in_progress.clone();
        let last_measurement_len_snapshot: Option<([f64; 2], [f64; 2], f64)> =
            self.last_measurement;
        let last_measure_area_snapshot: Option<(f64, f64)> = self.last_measure_area;
        let cursor_world_snapshot: Option<[f64; 2]> = self.cursor_world;
        let status_zoom: f64 = self.tabs.get(active_tab_idx).map(|t| t.cam.zoom).unwrap_or(1.0);
        let status_total_layers: usize = self.tabs.get_mut(active_tab_idx)
            .map(|t| {
                // CRITICAL: when the scene has no parsed layer table
                // (`scene.layer_names` empty), `derive_layer_list` walks
                // every segment + every triangle in the scene and builds
                // a BTreeMap. On a 700k-segment DWG that's ~3-5 ms per
                // frame for a status-bar counter. Route through the
                // per-tab `layer_count_cached` (no-alloc length read
                // after first build). Cache is invalidated by any
                // scene-mutating path (rebuild_buffers / scene-swap).
                if !t.scene.layer_names.is_empty() { t.scene.layer_names.len() }
                else { t.layer_count_cached(DEFAULT_LINE_COLOR) }
            }).unwrap_or(0);
        let status_hidden_layers: usize = self.tabs.get(active_tab_idx)
            .map(|t| t.hidden_layers.len()).unwrap_or(0);
        // `status_tab_label` removed â€” the active tab label is shown
        // via the FileTabBar (whose `tab_labels[active]` is the same
        // value); status-bar consumers don't need a second copy.

        // --- Intents gathered from the closure --------------------------
        let mut requested_activate_tab: Option<usize> = None;
        let mut requested_close_tab: Option<usize> = None;
        let mut requested_new_tab = false;            // "+" button
        let mut requested_menu_open_dialog = false;
        let mut requested_menu_reload = false;
        let mut requested_menu_close_active = false;
        let mut requested_menu_recent_load: Option<String> = None;
        let mut requested_menu_recent_clear = false;
        // "Save As IFC 2D Bâ€¦" â€” run the IFCX-binary exporter on the
        // active tab. Handled in the post-present block (see below) so
        // the rfd modal dialog doesn't nest inside the egui frame.
        let mut requested_menu_save_as_ifcx = false;
        // "Save As DXFâ€¦" â€” deferred past the menu frame (same pattern as
        // IFCX save-as) so the rfd modal doesn't nest inside the egui frame.
        let mut requested_menu_save_as_dxf = false;
        let mut requested_toggle_layer_panel = false;
        let mut requested_toggle_props_panel = false;
        let mut requested_toggle_structure_panel = false;
        let mut requested_structure_select: Option<String> = None;
        let mut requested_toggle_samples_panel = false;
        let mut requested_close_samples = false;
        let mut requested_tool_mode: Option<ToolMode> = None;
        // OSNAP toggle â€” set when the user clicks a snap-mode button in
        // the status bar. The bit is xor'd into `self.snap_modes` after
        // the egui closure ends (when we no longer hold the borrow).
        let mut requested_snap_toggle: Option<SnapModeSet> = None;
        // ORTHO toggle — set when the user clicks the ORTHO pill.
        let mut requested_ortho_toggle = false;
        // Zoom Previous — pop the camera history stack onto the active tab.
        let mut requested_zoom_previous = false;
        // Zoom In/Out ribbon buttons -- positive value zooms in, negative
        // zooms out. Applied as cam.zoom *= 1.25 / 0.8 to match a single
        // mouse-wheel notch. None = no zoom step this frame.
        let mut requested_zoom_step: Option<i32> = None;
        // Display toggles (Phase 2): grid overlay, white background.
        let mut requested_toggle_grid = false;
        let mut requested_toggle_white_bg = false;
        // Theme — cycle on click (Phase 2 placeholder for the dropdown).
        let mut requested_cycle_theme = false;
        // View-mode cycle in the status bar (Hidden Line / Wireframe).
        let mut requested_view_mode_cycle = false;
        // Find dialog deferred actions (handled after the gpu borrow drops).
        let mut requested_toggle_find = false;
        let mut requested_find_jump: Option<Option<u32>> = None;
        let mut requested_find_query: Option<String> = None;
        let mut requested_find_close = false;
        // Measure sub-mode change â€” also arms the Measure tool.
        let mut requested_measure_sub: Option<MeasureSub> = None;
        let mut pending_selection_rebuild: bool = false;
        let mut requested_clear_measurement = false;
        // Annotate tools â€” per user request: linear maatlijn + area measurement, per-tab persistence
        let mut requested_clear_annotations = false;
        let mut requested_fit = false;
        let mut requested_home = false;
        // New absolute camera rotation (radians) requested by the
        // view-cube widget; applied to the active tab below.
        let mut requested_rotation: Option<f64> = None;
        let mut requested_toggle_perf_hud = false;
        let mut requested_toggle_present_mode = false;
        let mut requested_toggle_about = false;
        let mut requested_about_close = false;
        // Save-As-DWG modal lifecycle. `close` flips it off without
        // saving; `confirm_dxf` triggers `requested_menu_save_as_dxf`
        // with a `.dwg -> .dxf` extension swap inside `save_as_dxf`.
        let mut requested_save_as_dwg_close = false;
        let mut requested_save_as_dwg_confirm_dxf = false;
        let mut requested_layer_toggle: Option<String> = None;
        let mut requested_layer_show_all = false;
        let mut requested_layer_hide_all = false;
        // Trash-button click on a layer row in the LAYERS panel.
        // Soft-deletes the layer: it's hidden from rendering and
        // skipped during DXF save. Shift+click in the UI is required
        // to set this â€” see the panel section below.
        let mut requested_layer_delete: Option<String> = None;
        let mut requested_selection_clear = false;
        // (bbox, layout_name) â€” layout tab switch on active tab.
        let mut requested_fit_layout: Option<([f64; 4], String)> = None;
        // Path to load into a NEW tab (samples browser).
        let mut requested_load_as_new_tab: Option<String> = None;
        // Split-view intents â€” picked horizontal/vertical split against
        // tab at index, or unsplit if None and the flag is true.
        let mut requested_split_h_with: Option<usize> = None;
        let mut requested_split_v_with: Option<usize> = None;
        let mut requested_unsplit = false;
        // Blok 3 â€” Copy button in the Modify ribbon group flips this; it's
        // folded into self.requested_duplicate at the end of the frame so
        // the deferred editor block picks it up alongside Ctrl+D presses.
        let mut requested_duplicate = false;
        // Explode -- ribbon button only flips a local bool; the keyboard
        // handler sets self.requested_explode directly. Folded together
        // at the end of the closure for the deferred editor block.
        let mut requested_explode = false;
        // Ribbon tab switch â€” when the user clicks a different tab strip
        // entry, the action carries the new tab id which we apply to
        // self.active_ribbon_tab after the closure ends.
        let mut requested_ribbon_tab: Option<RibbonTabId> = None;
        // Title-bar actions â€” applied after the egui closure exits so we
        // hold a clean borrow on `self.window` to forward them to winit.
        let mut requested_toggle_app_menu = false;
        let mut requested_window_minimize = false;
        let mut requested_window_toggle_max = false;
        let mut requested_window_close = false;
        let mut requested_window_drag = false;
        // Edge-resize for borderless window. Captured inside the egui closure
        // (we know pointer pos + button press there); applied after the closure
        // via `Window::drag_resize_window`. See Task 1 / borderless-resize.
        let mut requested_resize_dir: Option<winit::window::ResizeDirection> = None;
        // Text-editor overlay buttons (Task 10). Set when the user clicks
        // Commit / Cancel in the floating overlay; processed AFTER the
        // egui closure so the &mut self borrow on tabs/edit_mode is free.
        let mut commit_pending = false;
        let mut cancel_pending = false;

        let Some(gpu) = self.gpu.as_mut() else { return; };
        let Some(win) = self.window.as_ref() else { return; };

        // --- Upload camera UBO for active tab -------------------------
        let t_cam_start = std::time::Instant::now();
        let (fw, fh) = (gpu.config.width as f32, gpu.config.height.max(1) as f32);

        // We'll compute the canvas aspect AFTER egui consumes its
        // panels. For now, upload using a placeholder aspect; we'll
        // re-upload immediately before the scene pass once the real
        // canvas rect is known.
        let _ = fw; let _ = fh;
        let t_cam_done = std::time::Instant::now();

        // --- Perf HUD text --------------------------------------------
        let hud_text = if self.show_perf_hud {
            let avg_ms = if self.frame_times.is_empty() {
                0.0
            } else {
                let sum: std::time::Duration = self.frame_times.iter().sum();
                sum.as_secs_f64() * 1000.0 / self.frame_times.len() as f64
            };
            let max_ms = self.frame_times.iter()
                .map(|d| d.as_secs_f64() * 1000.0)
                .fold(0.0_f64, f64::max);
            let fps = if avg_ms > 0.0 { 1000.0 / avg_ms } else { 0.0 };
            let t = &self.last_timings;
            let to_ms = |d: std::time::Duration| d.as_secs_f64() * 1000.0;
            let pm = match self.present_mode {
                wgpu::PresentMode::Fifo => "VSync (Fifo)",
                wgpu::PresentMode::Immediate => "UNLOCKED (Immediate)",
                wgpu::PresentMode::Mailbox => "Mailbox",
                _ => "?",
            };
            Some(format!(
                "{:.1} ms  {:.0} fps  (max {:.1})\n\
                 egui_run: {:.2}  cam_up: {:.2}\n\
                 scene: {:.2}  egui_paint: {:.2}  present: {:.2}\n\
                 present-mode: {}  [F11 toggle]  [F12 hide HUD]",
                avg_ms, fps, max_ms,
                to_ms(t.egui_run), to_ms(t.camera_upload),
                to_ms(t.scene_pass), to_ms(t.egui_paint), to_ms(t.present),
                pm,
            ))
        } else { None };

        // --- egui run --------------------------------------------------
        // ---- Debounced text-edit live preview (Task 10) -----------------
        // 50 ms after the last keystroke in the floating overlay, re-
        // tessellate the entity and refresh GPU buffers so the canvas
        // shows the in-progress edit. We split the borrow: copy state
        // fields out FIRST, then mutate `self.tabs` / call rebuild.
        let debounce_check = if let Some(state) = self.edit_mode.as_mut() {
            if let Some(at) = state.debounce_at {
                if std::time::Instant::now() >= at {
                    state.debounce_at = None;
                    Some((state.tab_idx, state.eid, state.buffer.clone()))
                } else { None }
            } else { None }
        } else { None };
        if let Some((tab_idx, eid, buffer)) = debounce_check {
            if let Some(tab) = self.tabs.get_mut(tab_idx) {
                let _ = crate::scene_io::re_tessellate_text_entity(
                    &mut tab.scene, eid, &buffer,
                );
                tab.rebuild_buffers(gpu);
            }
        }

        let t_egui_run_start = std::time::Instant::now();
        let raw_input = gpu.egui_state.take_egui_input(win);
        let mut canvas_rect_logical: Option<egui::Rect> = None;

        // Snapshot for borderless edge-resize. Compute inner-size in logical
        // px (egui hover_pos is in logical units). Skip detection entirely
        // when the window is maximised â€” resizing a maximised window is a
        // no-op on every platform we ship to.
        let win_inner_phys = win.inner_size();
        let win_scale = win.scale_factor() as f32;
        let win_w_logical = (win_inner_phys.width as f32 / win_scale).max(1.0);
        let win_h_logical = (win_inner_phys.height as f32 / win_scale).max(1.0);
        let win_can_resize = !win.is_maximized();

        let full_output = gpu.egui_ctx.run(raw_input, |ctx| {
            // Apply the warm-dark superui theme to every widget egui draws
            // this frame. Equivalent to 1.0's [data-theme="default"] tokens.
            apply_theme(ctx, Theme::Default);

            // ---- Borderless edge-resize hot-zones ----------------------
            // We removed native chrome (`with_decorations(false)`) so the OS
            // resize-edges are gone. Re-emulate them by detecting a 6 px
            // perimeter band, painting the right cursor icon, and on
            // primary-press, asking winit to drive a system-modal resize.
            if win_can_resize {
                const EDGE: f32 = 6.0;
                if let Some(p) = ctx.input(|i| i.pointer.hover_pos()) {
                    let near_l = p.x <= EDGE;
                    let near_r = p.x >= win_w_logical - EDGE;
                    let near_t = p.y <= EDGE;
                    let near_b = p.y >= win_h_logical - EDGE;
                    use winit::window::ResizeDirection as RD;
                    let dir_cursor = if near_t && near_l {
                        Some((RD::NorthWest, egui::CursorIcon::ResizeNwSe))
                    } else if near_t && near_r {
                        Some((RD::NorthEast, egui::CursorIcon::ResizeNeSw))
                    } else if near_b && near_l {
                        Some((RD::SouthWest, egui::CursorIcon::ResizeNeSw))
                    } else if near_b && near_r {
                        Some((RD::SouthEast, egui::CursorIcon::ResizeNwSe))
                    } else if near_t {
                        Some((RD::North, egui::CursorIcon::ResizeVertical))
                    } else if near_b {
                        Some((RD::South, egui::CursorIcon::ResizeVertical))
                    } else if near_l {
                        Some((RD::West, egui::CursorIcon::ResizeHorizontal))
                    } else if near_r {
                        Some((RD::East, egui::CursorIcon::ResizeHorizontal))
                    } else {
                        None
                    };
                    if let Some((dir, cursor)) = dir_cursor {
                        ctx.set_cursor_icon(cursor);
                        if ctx.input(|i| i.pointer.primary_pressed()) {
                            requested_resize_dir = Some(dir);
                        }
                    }
                }
            }

            // ---- Title bar ------------------------------------------
            // superui::TitleBar paints app icon, title, and Windows-style
            // minimise/maximise/close controls. Actions are dispatched
            // back into deferred flags applied after the egui closure.
            egui::TopBottomPanel::top("titlebar")
                .show_separator_line(false)
                .show(ctx, |ui| {
                    let app_title = match app_mode_snapshot {
                        AppMode::Studio => "Open 2D Studio",
                        AppMode::Viewer => "Open 2D Viewer",
                    };
                    // Embed the same 128-px logo asset that ships as the
                    // OS taskbar icon. superui caches it as a GPU texture
                    // on first frame and paints it in the titlebar's
                    // top-left tile (replaces the procedural "2D"
                    // placeholder so the actual brand mark is visible).
                    let logo_png: &'static [u8] = match app_mode_snapshot {
                        AppMode::Viewer => include_bytes!("../assets/icon-viewer-128.png"),
                        AppMode::Studio => include_bytes!("../assets/icon-studio-128.png"),
                    };
                    let actions = TitleBar::new(app_title)
                        .maximized(window_maximized_snapshot)
                        .logo_png(logo_png)
                        .show(ui);
                    for a in actions {
                        match a {
                            TitleBarAction::OpenAppMenu => {
                                requested_toggle_app_menu = true;
                            }
                            TitleBarAction::Minimize => {
                                requested_window_minimize = true;
                            }
                            TitleBarAction::ToggleMaximize => {
                                requested_window_toggle_max = true;
                            }
                            TitleBarAction::Close => {
                                requested_window_close = true;
                            }
                            TitleBarAction::StartDrag => {
                                requested_window_drag = true;
                            }
                        }
                    }
                });

            // ---- Ribbon ---------------------------------------------
            // Data-driven `superui::Ribbon` widget â€” tab strip plus the
            // active tab's groups + buttons. The button list mirrors the
            // 1.0 React app's ribbon: Files / Tools / View / Help. Action
            // dispatch is handled by the action-id match below.
            egui::TopBottomPanel::top("ribbon")
                .show(ctx, |ui| {
                    let tabs = build_ribbon_tabs(
                        current_tool_mode,
                        layer_panel_open,
                        properties_panel_open,
                        samples_open,
                        show_perf_hud_snapshot,
                        current_split_snapshot,
                        app_mode_snapshot,
                        show_grid_snapshot,
                        white_bg_snapshot,
                    );
                    let actions = Ribbon::new(tabs, active_ribbon_tab_snapshot.clone()).show(ui);
                    for a in actions {
                        match a {
                            RibbonAction::TabChanged(id) => {
                                // The orange "File" tab is a special
                                // affordance â€” clicking it opens the app
                                // menu (matches 1.0 behavior) instead of
                                // switching ribbon contents.
                                if id == "file" {
                                    self.app_menu_open = !self.app_menu_open;
                                } else {
                                    requested_ribbon_tab = Some(id);
                                }
                            }
                            RibbonAction::ButtonClicked(id) => match id.as_str() {
                                "open"          => { requested_menu_open_dialog = true; }
                                "new_tab"       => { requested_new_tab = true; }
                                "save_as_dxf"   => { requested_menu_save_as_dxf = true; }
                                "save_as_ifcdraw" => { requested_menu_save_as_ifcx = true; }
                                "save_as_dwg"   => {
                                    // Surface the "writer in development"
                                    // modal -- see the save_as_dwg_modal
                                    // render block above.
                                    self.save_as_dwg_modal_open = true;
                                }
                                "fit_extents"   => { requested_fit = true; }
                                "select"        => { requested_tool_mode = Some(ToolMode::Select); }
                                "move"          => { requested_tool_mode = Some(ToolMode::Move); }
                                "rotate"        => { requested_tool_mode = Some(ToolMode::Rotate); }
                                "scale"         => { requested_tool_mode = Some(ToolMode::Scale); }
                                "mirror"        => { requested_tool_mode = Some(ToolMode::Mirror); }
                                "duplicate"     => { requested_duplicate = true; }
                                "explode"       => { requested_explode = true; }
                                "dim"           => { requested_tool_mode = Some(ToolMode::Dimension); }
                                "clear"         => {
                                    requested_clear_measurement = true;
                                    requested_clear_annotations = true;
                                }
                                "layers"        => {
                                    // Single panel per side: ribbon
                                    // toggles only the legacy LAYERS
                                    // panel (which has real layer-list
                                    // content). The new LeftDock is
                                    // dormant until its dock content
                                    // becomes genuinely additive.
                                    requested_toggle_layer_panel = true;
                                }
                                "properties"    => {
                                    requested_toggle_props_panel = true;
                                }
                                "structure"     => {
                                    requested_toggle_structure_panel = true;
                                }
                                "samples"       => { requested_toggle_samples_panel = true; }
                                "perf_hud"      => { requested_toggle_perf_hud = true; }
                                "vsync"         => { requested_toggle_present_mode = true; }
                                "split_h"       => {
                                    if n_tabs >= 2 {
                                        let other = (active_tab_idx + 1) % n_tabs.max(1);
                                        requested_split_h_with = Some(other);
                                    }
                                }
                                "split_v"       => {
                                    if n_tabs >= 2 {
                                        let other = (active_tab_idx + 1) % n_tabs.max(1);
                                        requested_split_v_with = Some(other);
                                    }
                                }
                                "unsplit"       => { requested_unsplit = true; }
                                "about"         => { requested_toggle_about = true; }
                                "zoom_window"   => {
                                    // Same as the `Z R` chord — engage
                                    // ToolMode::ZoomRegion so the next
                                    // LMB-drag fits the camera to the
                                    // rectangle (release auto-reverts
                                    // to Select).
                                    requested_tool_mode = Some(ToolMode::ZoomRegion);
                                }
                                "zoom_previous" => { requested_zoom_previous = true; }
                                "grid"          => { requested_toggle_grid = true; }
                                "find_replace"  => { requested_toggle_find = true; }
                                "white_bg"      => { requested_toggle_white_bg = true; }
                                "theme"         => { requested_cycle_theme = true; }
                                "zoom_center"   => {
                                    // One-shot recenter — engage
                                    // ToolMode::ZoomCenter; the next
                                    // LMB click recenters the camera
                                    // there and reverts to Select.
                                    requested_tool_mode = Some(ToolMode::ZoomCenter);
                                }
                                // Measure ribbon buttons -- same arms as
                                // the status-bar Len/Area toggles plus the
                                // 3-click Angle / 1-click Coord tools.
                                // ToolMode::Measure is set by the
                                // requested_measure_sub consumer block.
                                "measure_length" => {
                                    requested_measure_sub = Some(MeasureSub::Length);
                                }
                                "measure_area" => {
                                    requested_measure_sub = Some(MeasureSub::Area);
                                }
                                "measure_angle" => {
                                    requested_tool_mode = Some(ToolMode::MeasureAngle);
                                }
                                "measure_coord" => {
                                    requested_tool_mode = Some(ToolMode::MeasureCoord);
                                }
                                // --- Audit-2026-05-22: previously-dead ribbon
                                // arms now wired. Selection / Pan / Edit /
                                // Clipboard / Zoom buttons all had ids in
                                // build_ribbon_tabs but no dispatch arm.
                                "pan" => {
                                    // No dedicated Pan tool -- middle-drag
                                    // is canonical. Surface as Select +
                                    // nudge the user via the status bar.
                                    requested_tool_mode = Some(ToolMode::Select);
                                }
                                "select_all" => {
                                    self.requested_select_all = true;
                                }
                                "deselect" => {
                                    requested_selection_clear = true;
                                }
                                "copy_to_clipboard" | "copy" => {
                                    if self.mode != AppMode::Viewer {
                                        self.requested_copy = true;
                                    } else {
                                        // Viewer is read-only -- the clipboard
                                        // copy of geometry would require a
                                        // paste path we don't ship. Make the
                                        // click visible in the log.
                                        eprintln!("[viewer] Copy: clipboard ignored in read-only mode");
                                    }
                                }
                                "delete" => {
                                    // Same dispatch as the Delete keyboard
                                    // binding -- allowed in Viewer per the
                                    // minimal-edit surface (Move / Delete /
                                    // Explode / layer-delete).
                                    self.requested_delete = true;
                                }
                                "zoom_in" => { requested_zoom_step = Some(1); }
                                "zoom_out" => { requested_zoom_step = Some(-1); }
                                _ => {}
                            },
                        }
                    }
                });


            // ---- About dialog ---------------------------------------
            let mut about_open = about_dialog_open_snapshot;
            if about_open {
                egui::Window::new("About â€” Open 2D Studio")
                    .collapsible(false)
                    .resizable(false)
                    .open(&mut about_open)
                    .show(ctx, |ui| {
                        ui.heading("Open 2D Studio");
                        ui.label("Tabbed DWG/DXF viewer + benchmarking harness.");
                        ui.separator();
                        ui.label(egui::RichText::new("Keyboard shortcuts").strong());
                        egui::Grid::new("about_shortcuts")
                            .num_columns(2)
                            .spacing([16.0, 2.0])
                            .show(ui, |ui| {
                                for (k, d) in [
                                    ("Ctrl+O",     "Open file as new tab"),
                                    ("Ctrl+W",     "Close active tab"),
                                    ("Ctrl+Tab",   "Next tab"),
                                    ("Ctrl+Sh+Tab","Previous tab"),
                                    ("F",          "Fit active tab"),
                                    ("F2",         "Toggle samples panel"),
                                    ("F3",         "Toggle layers panel"),
                                    ("F4",         "Toggle properties panel"),
                                    ("F11",        "Toggle VSync"),
                                    ("F12",        "Toggle perf HUD"),
                                    ("Ctrl+Z",     "Undo last Move"),
                                    ("Ctrl+Sh+H",  "Split canvas horizontally"),
                                    ("Ctrl+Sh+V",  "Split canvas vertically"),
                                    ("Ctrl+Sh+S",  "Unsplit canvas"),
                                    ("Esc",        "Close samples / exit"),
                                ] {
                                    ui.monospace(k);
                                    ui.label(d);
                                    ui.end_row();
                                }
                            });
                    });
            }
            if about_dialog_open_snapshot && !about_open {
                requested_about_close = true;
            }

            // ---- Find dialog (Phase 2) ------------------------------
            let mut find_open = find_dialog_open_snapshot;
            if find_open {
                let mut local_query = find_query_snapshot.clone();
                egui::Window::new("Find")
                    .collapsible(false)
                    .resizable(true)
                    .default_width(420.0)
                    .default_height(360.0)
                    .open(&mut find_open)
                    .show(ctx, |ui| {
                        ui.horizontal(|ui| {
                            ui.label("Query:");
                            let resp = ui.add(
                                egui::TextEdit::singleline(&mut local_query)
                                    .desired_width(280.0)
                                    .hint_text("text, layer, or handle (e.g. 0xAB)"),
                            );
                            if resp.changed() {
                                requested_find_query = Some(local_query.clone());
                            }
                        });
                        ui.separator();
                        let n = find_matches_snapshot.len();
                        ui.label(format!("{} match{}", n, if n == 1 { "" } else { "es" }));
                        egui::ScrollArea::vertical()
                            .auto_shrink([false, false])
                            .show(ui, |ui| {
                                for m in &find_matches_snapshot {
                                    let tag = match m.kind {
                                        FindMatchKind::Text => "T",
                                        FindMatchKind::Layer => "L",
                                        FindMatchKind::EntityName => "E",
                                    };
                                    let label = format!("[{}] {}", tag, m.label);
                                    if ui.selectable_label(false, label).clicked() {
                                        requested_find_jump = Some(m.eid);
                                    }
                                }
                            });
                    });
            }
            if find_dialog_open_snapshot && !find_open {
                requested_find_close = true;
            }

            // ---- Save-As-DWG modal ----------------------------------
            // Interim solution while the DWG writer is in development
            // (see docs/superpowers/plans/dwg-writer-plan.md): explain
            // the situation and offer to save as DXF instead. AutoCAD
            // opens DXF natively, so the user can still hand the file
            // back to their main toolchain.
            let mut dwg_modal_open = save_as_dwg_modal_snapshot;
            if dwg_modal_open {
                egui::Window::new("Save As DWG")
                    .collapsible(false)
                    .resizable(false)
                    .open(&mut dwg_modal_open)
                    .default_width(440.0)
                    .show(ctx, |ui| {
                        ui.add_space(4.0);
                        ui.label(egui::RichText::new("DWG writer in development.")
                            .strong()
                            .size(13.0));
                        ui.add_space(8.0);
                        ui.label("The Open 2D writer for the binary DWG format is still \
being built. For now, this app will save your changes as DXF -- AutoCAD opens that \
natively, so you can hand the file back to your main toolchain without losing edits.");
                        ui.add_space(6.0);
                        ui.label(egui::RichText::new(
                            "Tracking issue: docs/superpowers/plans/dwg-writer-plan.md")
                            .small()
                            .weak());
                        ui.add_space(12.0);
                        ui.horizontal(|ui| {
                            if ui.button("Save as DXF instead").clicked() {
                                requested_save_as_dwg_confirm_dxf = true;
                            }
                            ui.add_space(6.0);
                            if ui.button("Cancel").clicked() {
                                requested_save_as_dwg_close = true;
                            }
                        });
                    });
            }
            if save_as_dwg_modal_snapshot && !dwg_modal_open {
                // egui's window-close (X) flips dwg_modal_open false.
                requested_save_as_dwg_close = true;
            }

            // ---- File-tab strip -------------------------------------
            // Data-driven `superui::FileTabBar` widget â€” Chrome-style
            // sloped tabs with active accent line, close Ã— per tab and a
            // "+" new-tab button.
            egui::TopBottomPanel::top("tabbar")
                .show(ctx, |ui| {
                    let tab_defs: Vec<FileTabDef> = (0..n_tabs)
                        .map(|i| FileTabDef {
                            id: i,
                            label: tab_labels[i].clone(),
                            modified: false,
                            version: tab_versions.get(i).cloned().flatten(),
                        })
                        .collect();
                    let actions = FileTabBar::new(&tab_defs)
                        .active(active_tab_idx)
                        .show(ui);
                    for a in actions {
                        match a {
                            FileTabAction::Activate(i) => { requested_activate_tab = Some(i); }
                            FileTabAction::Close(i) => { requested_close_tab = Some(i); }
                            FileTabAction::NewTab => { requested_new_tab = true; }
                        }
                    }
                });

            // ---- Bottom: Status bar (coords + zoom + layers) ----------
            // Built from data-driven `StatusSection`s â€” superui::StatusBar
            // owns the painting, padding and layout.
            egui::TopBottomPanel::bottom("statusbar")
                .exact_height(superui::tokens::metrics::STATUSBAR_HEIGHT)
                .frame(egui::Frame::none().fill(superui::theme::Theme::Default.palette().status_bg))
                .show(ctx, |ui| {
                    // 1.0 reference layout (left â†’ right):
                    //   X: â€¦  Y: â€¦  Cursor: 0 0  Zoom: 150%  Grid: 10
                    //   Scale: 1:100  â˜ Layer 0 â–¾  ORTHO  White Background â–¾
                    //   Tool: SELECT  â€¦  IFC  Selected: 0  Objects: N
                    let (x_str, y_str) = match status_cursor_world {
                        Some(p) => (format!("X: {} mm", (p[0] as i32)),
                                    format!("Y: {} mm", (p[1] as i32))),
                        None => ("X: —".to_string(), "Y: —".to_string()),
                    };
                    let cursor_str = match status_cursor_world {
                        Some(p) => format!("Cursor: {:.0} {:.0}", p[0], p[1]),
                        None => "Cursor: — —".to_string(),
                    };
                    let zoom_pct = (status_zoom * 100.0).round() as i32;
                    let tool_str = match current_tool_mode {
                        ToolMode::Select       => "SELECT",
                        ToolMode::Measure      => "MEASURE",
                        ToolMode::Move         => "MOVE",
                        ToolMode::Dimension    => "DIM",
                        ToolMode::Area         => "AREA",
                        ToolMode::Rotate       => "ROTATE",
                        ToolMode::Scale        => "SCALE",
                        ToolMode::Mirror       => "MIRROR",
                        ToolMode::ZoomRegion   => "ZOOM-REGION",
                        ToolMode::ZoomCenter   => "ZOOM-CENTER",
                        ToolMode::MeasureAngle => "MEASURE-ANGLE",
                        ToolMode::MeasureCoord => "MEASURE-COORD",
                    };
                    let layer_str = if status_hidden_layers > 0 {
                        format!("Layer 0  ({}/{} hidden)", status_hidden_layers, status_total_layers)
                    } else {
                        "Layer 0".to_string()
                    };
                    // OSNAP quick-toggle row â€” one button per common
                    // mode. Highlighted when the bit is on. Click flips
                    // the bit via the `StatusBarAction::Toggled(id)`
                    // path below.
                    let snap_toggle = |id: &str, label: &str, m: SnapModeSet| -> StatusSection {
                        StatusSection::Toggle {
                            label: label.to_string(),
                            on: snap_modes_snapshot.contains(m),
                            id: id.to_string(),
                        }
                    };
                    let measure_len_on = current_tool_mode == ToolMode::Measure
                        && measure_sub_snapshot == MeasureSub::Length;
                    let measure_area_on = current_tool_mode == ToolMode::Measure
                        && measure_sub_snapshot == MeasureSub::Area;
                    // Mockup layout (lines 927-1029):
                    //   LEFT cluster: X, Y, Cursor
                    //   MIDDLE: Zoom, Grid, Scale, [PL] storey, layer
                    //          selector, ORTHO toggle, OSNAP strip,
                    //          view-mode select, Tool: <name>
                    //   RIGHT: Terminal icon, IFC toggle, Selected:N,
                    //          Objects:N, FPS
                    let mut sections: Vec<StatusSection> = vec![
                        StatusSection::Text(x_str),
                        StatusSection::Text(y_str),
                        StatusSection::Text(cursor_str),
                        StatusSection::Text(format!("Zoom: {}%", zoom_pct)),
                        StatusSection::Text("Grid: 100 mm".to_string()),
                        StatusSection::Text("Scale: 1:100".to_string()),
                        StatusSection::Text(layer_str),
                        // ORTHO pill — first toggle in the row, mockup
                        // line 970 uses a green tint when on. The
                        // StatusBar widget treats this just like any
                        // other pill (accent fill); good enough for
                        // Phase 1.
                        StatusSection::Toggle {
                            label: "Ortho".to_string(),
                            on: ortho_enabled_snapshot,
                            id: "ortho".to_string(),
                        },
                        // OSNAP strip — 6 toggles preceded by a static
                        // "OSNAP" label.
                        StatusSection::Text("OSNAP: ".to_string()),
                        snap_toggle("snap_endpoint",     "End",  SnapModeSet::ENDPOINT),
                        snap_toggle("snap_midpoint",     "Mid",  SnapModeSet::MIDPOINT),
                        snap_toggle("snap_center",       "Cen",  SnapModeSet::CENTER),
                        snap_toggle("snap_intersection", "Int",  SnapModeSet::INTERSECTION),
                        snap_toggle("snap_perpendicular","Per",  SnapModeSet::PERPENDICULAR),
                        snap_toggle("snap_nearest",      "Near", SnapModeSet::NEAREST),
                        StatusSection::Text(format!("Tool: {}", tool_str)),
                        StatusSection::Toggle {
                            label: "Len".to_string(),
                            on: measure_len_on,
                            id: "measure_length".to_string(),
                        },
                        StatusSection::Toggle {
                            label: "Area".to_string(),
                            on: measure_area_on,
                            id: "measure_area".to_string(),
                        },
                        // View-mode cycle — Hidden Line / Wireframe
                        // (Viewer build skips Shaded). Cycles on click.
                        StatusSection::Toggle {
                            label: match view_mode_idx_snapshot {
                                0 => "Hidden Line".to_string(),
                                _ => "Wireframe".to_string(),
                            },
                            on: false,
                            id: "view_mode_cycle".to_string(),
                        },
                        StatusSection::Spacer,
                    ];
                    // IFC toggle — authoring-only affordance; the
                    // viewer has no IFC tab + IFC panel so the toggle
                    // would be misleading. Hide entirely in Viewer mode.
                    if !matches!(app_mode_snapshot, AppMode::Viewer) {
                        sections.push(StatusSection::Toggle {
                            label: "IFC".to_string(),
                            on: false,
                            id: "ifc_panel".to_string(),
                        });
                    }
                    sections.push(StatusSection::Text(format!("Selected: {}", prop_selection_count)));
                    sections.push(StatusSection::Text(format!("Objects: {}", prop_scene_total)));
                    let actions = StatusBar::new(sections).show(ui);
                    for a in actions {
                        if let StatusBarAction::Toggled(id) = a {
                            match id.as_str() {
                                "snap_endpoint"     => requested_snap_toggle = Some(SnapModeSet::ENDPOINT),
                                "snap_midpoint"     => requested_snap_toggle = Some(SnapModeSet::MIDPOINT),
                                "snap_center"       => requested_snap_toggle = Some(SnapModeSet::CENTER),
                                "snap_intersection" => requested_snap_toggle = Some(SnapModeSet::INTERSECTION),
                                "snap_perpendicular"=> requested_snap_toggle = Some(SnapModeSet::PERPENDICULAR),
                                "snap_nearest"      => requested_snap_toggle = Some(SnapModeSet::NEAREST),
                                "measure_length"    => {
                                    requested_measure_sub = Some(MeasureSub::Length);
                                }
                                "measure_area"      => {
                                    requested_measure_sub = Some(MeasureSub::Area);
                                }
                                "ortho"             => { requested_ortho_toggle = true; }
                                "view_mode_cycle"   => { requested_view_mode_cycle = true; }
                                _ => {}
                            }
                        }
                    }
                });

            // ---- Bottom (above statusbar): Model/Layout tabs -----------
            // Only shown when the active tab has at least one paper-space
            // layout â€” otherwise it would just show "Model" on its own and
            // waste vertical space. Keeps layout semantics of the old ctrls
            // bar (Model/Layout1/Layout2 switching) without the tip text.
            let has_paper_layouts = active_layouts.iter()
                .any(|(n, _)| !n.eq_ignore_ascii_case("Model"));
            if has_paper_layouts {
                let layouts_frame = egui::Frame::none()
                    .fill(egui::Color32::from_rgb(32, 35, 40))
                    .inner_margin(egui::Margin { left: 8.0, right: 8.0, top: 3.0, bottom: 3.0 })
                    .stroke(egui::Stroke::NONE);
                egui::TopBottomPanel::bottom("layout_tabs")
                    .frame(layouts_frame)
                    .show(ctx, |ui| {
                        egui::ScrollArea::horizontal()
                            .auto_shrink([false, true])
                            .show(ui, |ui| {
                                ui.horizontal(|ui| {
                                    if ui.selectable_label(!active_show_paper, "Model").clicked() {
                                        let bbox = active_layouts.iter()
                                            .find(|(n, _)| n.eq_ignore_ascii_case("Model"))
                                            .map(|(_, b)| *b)
                                            .unwrap_or([0.0, 0.0, 1.0, 1.0]);
                                        requested_fit_layout = Some((bbox, "Model".to_string()));
                                    }
                                    for (name, lbbox) in &active_layouts {
                                        if name.eq_ignore_ascii_case("Model") { continue; }
                                        let is_active_layout = active_show_paper;
                                        if ui.selectable_label(is_active_layout, name).clicked() {
                                            requested_fit_layout = Some((*lbbox, name.clone()));
                                        }
                                    }
                                });
                            });
                    });
            }

            // ---- Left: superui::LeftDock (Round 9) -----------------
            // Drawings + Sheets collapsible rail per 1.0 reference.
            // Sits OUTSIDE (left-of) the legacy LAYERS panel. Toggles
            // via the ribbon `layers` button (see action match above).
            if self.left_dock_open {
                let palette = Theme::Default.palette();
                let drawings_items: Vec<DrawingItem> = self.drawings.iter()
                    .map(|n| DrawingItem { name: n.as_str() }).collect();
                let sheets_items: Vec<SheetItem> = self.sheets.iter()
                    .map(|(n, s)| SheetItem { name: n.as_str(), subtitle: s.as_str() })
                    .collect();
                let mut drawings_open_local = self.drawings_open;
                let mut sheets_open_local = self.sheets_open;
                let active_d = self.active_drawing_idx;
                let active_s = self.active_sheet_idx;
                let dock_actions = {
                    let mut collected: Vec<LeftDockAction> = Vec::new();
                    egui::SidePanel::left("left_dock")
                        .exact_width(superui::tokens::metrics::LEFT_DOCK_WIDTH)
                        .resizable(false)
                        .frame(egui::Frame::none().fill(palette.bg))
                        .show(ctx, |ui| {
                            collected = LeftDock::new(
                                &drawings_items, &sheets_items,
                                &mut drawings_open_local, &mut sheets_open_local,
                            )
                            .active_drawing(active_d)
                            .active_sheet(active_s)
                            .show(ui);
                        });
                    collected
                };
                self.drawings_open = drawings_open_local;
                self.sheets_open = sheets_open_local;
                for a in dock_actions {
                    match a {
                        LeftDockAction::SelectDrawing(i) => self.active_drawing_idx = Some(i),
                        LeftDockAction::SelectSheet(i)   => self.active_sheet_idx = Some(i),
                        LeftDockAction::AddDrawing => {
                            let n = self.drawings.len() + 1;
                            self.drawings.push(format!("Drawing {}", n));
                        }
                        LeftDockAction::AddSheet => {
                            let n = self.sheets.len() + 1;
                            self.sheets.push((
                                format!("Sheet {}", n),
                                "No number | A3 (420x297mm)".to_string(),
                            ));
                        }
                        LeftDockAction::OpenSheetAsTab(_i) => {
                            // Stub â€” the kernel doesn't yet model sheets as tabs.
                            eprintln!("[left_dock] OpenSheetAsTab â€” TODO");
                        }
                        LeftDockAction::RenumberSheets => {
                            for (i, (name, _)) in self.sheets.iter_mut().enumerate() {
                                *name = format!("Sheet {}", i + 1);
                            }
                        }
                        LeftDockAction::ToggleDrawings | LeftDockAction::ToggleSheets => {
                            // Already handled by the bool flip inside `show`.
                        }
                    }
                }
            }

            // ---- Right: superui::RightDock (Round 9) ----------------
            // Properties panel mirroring 1.0's PropertiesPanel.tsx.
            // Sits OUTSIDE (right-of) the legacy PROPERTIES panel.
            if self.right_dock_open {
                let palette = Theme::Default.palette();
                let mut name = self.rd_name.clone();
                let mut type_label = self.rd_type.clone();
                let mut show_axes = self.rd_show_axes;
                let mut bounded = self.rd_boundary_enabled;
                let mut x = self.rd_x;
                let mut y = self.rd_y;
                let mut w = self.rd_w;
                let mut h = self.rd_h;
                let dock_actions = {
                    let mut collected: Vec<RightDockAction> = Vec::new();
                    egui::SidePanel::right("right_dock")
                        .exact_width(superui::tokens::metrics::RIGHT_DOCK_WIDTH)
                        .resizable(false)
                        .frame(egui::Frame::none().fill(palette.bg))
                        .show(ctx, |ui| {
                            let st = RightDockState {
                                name: &mut name,
                                type_label: &mut type_label,
                                show_axes: &mut show_axes,
                                boundary_enabled: &mut bounded,
                                x: &mut x, y: &mut y, w: &mut w, h: &mut h,
                                created: "â€”",
                                modified: "â€”",
                            };
                            collected = RightDock::new(st).show(ui);
                        });
                    collected
                };
                self.rd_name = name;
                self.rd_type = type_label;
                self.rd_show_axes = show_axes;
                self.rd_boundary_enabled = bounded;
                self.rd_x = x; self.rd_y = y; self.rd_w = w; self.rd_h = h;
                for a in dock_actions {
                    match a {
                        RightDockAction::Collapse => self.right_dock_open = false,
                        RightDockAction::OpenStandardsDialog => {
                            eprintln!("[right_dock] standards dialog â€” TODO");
                        }
                        RightDockAction::SelectBoundary => {
                            eprintln!("[right_dock] select boundary â€” TODO");
                        }
                        RightDockAction::FitToContent => {
                            eprintln!("[right_dock] fit to content â€” TODO");
                        }
                        // Edits already mutated locals above; nothing else to dispatch.
                        _ => {}
                    }
                }
            }

            // ---- App Menu side panel --------------------------------
            // Full-height left-side panel matching the Open
            // Geotechniek Studio reference. Slides in when the user
            // clicks the title-bar "2D" logo (sets `app_menu_open`).
            // Each click is routed to the existing `requested_*`
            // flags; new items (Print / Import / Export / Extensions /
            // Preferences) are TODO no-ops for now.
            if self.app_menu_open {
                let is_viewer = self.mode == AppMode::Viewer;
                let actions = AppMenuPanel::new()
                    .is_viewer(is_viewer)
                    .show(ctx);
                for action in actions {
                    match action {
                        AppMenuAction::New     => { requested_new_tab = true; self.app_menu_open = false; }
                        AppMenuAction::Open    => { requested_menu_open_dialog = true; self.app_menu_open = false; }
                        AppMenuAction::Save
                        | AppMenuAction::SaveAs => {
                            requested_menu_save_as_dxf = true;
                            self.app_menu_open = false;
                        }
                        AppMenuAction::SaveAsDwg => {
                            // The DWG writer is not yet implemented;
                            // surface the "writer in development" modal
                            // so the user can pick a DXF fallback. The
                            // confirm path inside the modal flips
                            // `requested_menu_save_as_dxf` again.
                            self.save_as_dwg_modal_open = true;
                            self.app_menu_open = false;
                        }
                        AppMenuAction::SaveAsIfcDraw => {
                            // Route through the same dispatch flag that
                            // the ribbon "Save IFCDraw" button uses.
                            requested_menu_save_as_ifcx = true;
                            self.app_menu_open = false;
                        }
                        AppMenuAction::Print => {
                            // TODO: wire to a future Print/PDF export pipeline.
                            self.app_menu_open = false;
                        }
                        AppMenuAction::Import => {
                            // TODO: wire to a future Importeren dispatcher
                            // (DXF / DWG / IFC / image overlay).
                            self.app_menu_open = false;
                        }
                        AppMenuAction::Export => {
                            // TODO: wire to a future Exporteren dispatcher
                            // (DXF / DWG / IFC / PDF / SVG).
                            self.app_menu_open = false;
                        }
                        AppMenuAction::Extensions => {
                            // TODO: open extension manager dialog.
                            self.app_menu_open = false;
                        }
                        AppMenuAction::Preferences => {
                            // TODO: open Voorkeuren / Settings dialog.
                            self.app_menu_open = false;
                        }
                        AppMenuAction::About => {
                            requested_toggle_about = true;
                            self.app_menu_open = false;
                        }
                        AppMenuAction::Exit => {
                            requested_window_close = true;
                            self.app_menu_open = false;
                        }
                        AppMenuAction::Close => {
                            // Back-arrow click or outside-the-panel click.
                            self.app_menu_open = false;
                        }
                    }
                }
            }

            // ---- File picker modal (replaces native rfd Open) -------
            if self.file_picker_open {
                if let Some(rx) = self.preview_rx.as_ref() {
                    loop {
                        match rx.try_recv() {
                            Ok((path, image)) => {
                                self.preview_inflight.remove(&path);
                                self.preview_cache.insert(
                                    path.clone(),
                                    superui::dialogs::PreviewEntry {
                                        image,
                                        finished: true,
                                    },
                                );
                                if let Some(state) = self.file_picker_state.as_mut() {
                                    state.invalidate_texture(&path);
                                }
                            }
                            Err(_) => break,
                        }
                    }
                }
                let mut open = self.file_picker_open;
                let action = if let Some(state) = self.file_picker_state.as_mut() {
                    let mut to_spawn: Vec<std::path::PathBuf> = Vec::new();
                    let mut provider = AppPreviewProvider {
                        cache: &mut self.preview_cache,
                        inflight: &mut self.preview_inflight,
                        spawn_queue: &mut to_spawn,
                    };
                    let action = superui::dialogs::FilePicker::show(
                        ctx, state, &mut provider, &mut open,
                    );
                    drop(provider);
                    if let Some(tx) = self.preview_tx.as_ref() {
                        for path in to_spawn {
                            if self.preview_cache.contains_key(&path)
                                || self.preview_inflight.contains(&path)
                            {
                                continue;
                            }
                            self.preview_inflight.insert(path.clone());
                            let tx = tx.clone();
                            std::thread::spawn(move || {
                                let image = generate_preview_image(&path);
                                let _ = tx.send((path, image));
                            });
                        }
                    }
                    action
                } else { None };
                self.file_picker_open = open;
                if let Some(action) = action {
                    match action {
                        superui::dialogs::FilePickerAction::Open(p) => {
                            let s = p.to_string_lossy().into_owned();
                            eprintln!("[tab open] picked: {}", s);
                            requested_load_as_new_tab = Some(s);
                        }
                        superui::dialogs::FilePickerAction::Cancelled => {}
                    }
                }
            }


            // ---- Left: Layer Manager ---------------------------------
            // Docked tool-window look: a title-bar header with a chevron
            // close button, then the content below. Matches the TrueView
            // docked-panel aesthetic.
            if layer_panel_open {
                let palette = superui::theme::Theme::Default.palette();
                egui::SidePanel::left("layers")
                    .default_width(superui::tokens::metrics::LEFT_DOCK_WIDTH)
                    .min_width(180.0)
                    .resizable(true)
                    .frame(egui::Frame::none().fill(palette.bg))
                    .show(ctx, |ui| {
                        side_panel_header(ui, "Layers", || {}, &mut |hdr| {
                            if hdr.chevron_clicked {
                                requested_toggle_layer_panel = true;
                            }
                        });
                        // Mockup secondary header: "Show all  Hide all" left,
                        // "Read-only" right (Viewer is read-only).
                        let n = layers_for_active.len();
                        let h = hidden_snapshot.len();
                        ui.horizontal(|ui| {
                            ui.add_space(8.0);
                            let lbl = format!("{} layers · {} hidden", n, h);
                            ui.label(egui::RichText::new(lbl).size(10.0).color(palette.fg_dim));
                        });
                        ui.horizontal(|ui| {
                            ui.add_space(8.0);
                            let show_all = ui.add(
                                egui::Label::new(egui::RichText::new("Show all")
                                    .size(11.0).color(palette.fg_dim).underline())
                                    .sense(egui::Sense::click()));
                            if show_all.clicked() {
                                requested_layer_show_all = true;
                            }
                            ui.add_space(4.0);
                            let hide_all = ui.add(
                                egui::Label::new(egui::RichText::new("Hide all")
                                    .size(11.0).color(palette.fg_dim).underline())
                                    .sense(egui::Sense::click()));
                            if hide_all.clicked() {
                                requested_layer_hide_all = true;
                            }
                            ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                                ui.add_space(8.0);
                                ui.label(egui::RichText::new("Read-only")
                                    .size(11.0).color(palette.fg_muted));
                            });
                        });
                        ui.add_space(2.0);
                        // 1 px divider matching mockup `border-light`.
                        let div_rect = ui.allocate_exact_size(
                            egui::vec2(ui.available_width(), 1.0), egui::Sense::hover()).0;
                        ui.painter().line_segment(
                            [div_rect.left_center(), div_rect.right_center()],
                            egui::Stroke::new(1.0, palette.border_light));
                        if layers_for_active.is_empty() {
                            ui.add_space(8.0);
                            ui.horizontal(|ui| {
                                ui.add_space(10.0);
                                ui.label(
                                    egui::RichText::new("No layers loaded.")
                                        .italics()
                                        .size(11.0)
                                        .color(palette.fg_muted),
                                );
                            });
                        } else {
                            egui::ScrollArea::vertical().show(ui, |ui| {
                                for (name, rgba) in &layers_for_active {
                                    let visible_before = !hidden_snapshot.contains(name);
                                    // Mockup row: h-6 (24 px), color swatch
                                    // 16×16, name 11 px, eye + lock toggles
                                    // on the right.
                                    let row_h = 24.0_f32;
                                    let full_w = ui.available_width();
                                    let (row_rect, row_resp) = ui.allocate_exact_size(
                                        egui::vec2(full_w, row_h), egui::Sense::click());
                                    if row_resp.hovered() {
                                        ui.painter().rect_filled(row_rect, 0.0, palette.hover);
                                    }
                                    // Color swatch.
                                    let r = ((rgba >> 0)  & 0xFF) as u8;
                                    let g = ((rgba >> 8)  & 0xFF) as u8;
                                    let b = ((rgba >> 16) & 0xFF) as u8;
                                    let swatch = egui::Rect::from_center_size(
                                        egui::pos2(row_rect.left() + 16.0, row_rect.center().y),
                                        egui::vec2(14.0, 14.0));
                                    ui.painter().rect_filled(swatch, 2.0, egui::Color32::from_rgb(r, g, b));
                                    ui.painter().rect_stroke(swatch, 2.0,
                                        egui::Stroke::new(1.0, palette.border_light));
                                    // Name.
                                    let name_color = if visible_before { palette.fg } else { palette.fg_dim };
                                    ui.painter().text(
                                        egui::pos2(swatch.right() + 6.0, row_rect.center().y),
                                        egui::Align2::LEFT_CENTER,
                                        name,
                                        egui::FontId::proportional(11.0),
                                        name_color,
                                    );
                                    // Eye toggle (right side).
                                    let eye_rect = egui::Rect::from_center_size(
                                        egui::pos2(row_rect.right() - 36.0, row_rect.center().y),
                                        egui::vec2(18.0, 18.0));
                                    let eye_resp = ui.interact(eye_rect,
                                        ui.id().with(("layer_eye", name.as_str())),
                                        egui::Sense::click());
                                    let eye_col = if eye_resp.hovered() { palette.fg } else { palette.fg_dim };
                                    ui.painter().text(
                                        eye_rect.center(),
                                        egui::Align2::CENTER_CENTER,
                                        if visible_before { egui_phosphor::regular::EYE } else { egui_phosphor::regular::EYE_SLASH },
                                        egui::FontId::new(13.0, egui::FontFamily::Proportional),
                                        eye_col,
                                    );
                                    if eye_resp.clicked() {
                                        requested_layer_toggle = Some(name.clone());
                                    }
                                    // Trash button — explicit per-row Delete
                                    // affordance (user asked for a visible
                                    // delete on each layer). Single click
                                    // marks the layer deleted (soft-delete
                                    // via `tab.deleted_layers`; persists to
                                    // saved DXF via `write_dxf_filtered`).
                                    let trash_rect = egui::Rect::from_center_size(
                                        egui::pos2(row_rect.right() - 14.0, row_rect.center().y),
                                        egui::vec2(18.0, 18.0));
                                    let trash_resp = ui.interact(trash_rect,
                                        ui.id().with(("layer_trash", name.as_str())),
                                        egui::Sense::click())
                                        .on_hover_text("Delete layer (segments + triangles dropped on Save)");
                                    let trash_col = if trash_resp.hovered() {
                                        egui::Color32::from_rgb(220, 90, 80)
                                    } else { palette.fg_dim };
                                    ui.painter().text(
                                        trash_rect.center(),
                                        egui::Align2::CENTER_CENTER,
                                        egui_phosphor::regular::TRASH,
                                        egui::FontId::new(13.0, egui::FontFamily::Proportional),
                                        trash_col,
                                    );
                                    if trash_resp.clicked() {
                                        requested_layer_delete = Some(name.clone());
                                    }
                                    // Back-compat: Shift+row-click also deletes.
                                    if row_resp.clicked() && ui.input(|i| i.modifiers.shift) {
                                        requested_layer_delete = Some(name.clone());
                                    }
                                }
                            });
                        }
                    });
            }

            // ---- Right: Properties ----------------------------------
            if properties_panel_open {
                let palette = superui::theme::Theme::Default.palette();
                egui::SidePanel::right("properties")
                    .default_width(160.0)   // smaller default per user — was 190, was 256
                    .min_width(140.0)
                    .resizable(true)
                    .frame(egui::Frame::none().fill(palette.bg))
                    .show(ctx, |ui| {
                        side_panel_header(ui, "Properties", || {}, &mut |hdr| {
                            if hdr.chevron_clicked {
                                requested_toggle_props_panel = true;
                            }
                        });
                        // Mockup spec (lines 867-875): subtitle two lines —
                        // tab breadcrumb (fg-muted 11 px) + filename · segs
                        // (fg-dim).
                        //
                        // Tail-truncate the tab label to ~16 chars (with
                        // leading ellipsis) so a long DWG basename like
                        // "2705_model Funderingsherstel - Constructie - ...
                        // .dwg" doesn't stretch the panel beyond its
                        // narrow default. Segment count gets its own line
                        // so neither overflows.
                        let truncated_tab: String = {
                            let max_chars = 16usize;
                            let chars: Vec<char> = prop_tab_label.chars().collect();
                            if chars.len() <= max_chars {
                                prop_tab_label.clone()
                            } else {
                                let tail: String = chars[chars.len() - max_chars..].iter().collect();
                                format!("\u{2026}{}", tail)
                            }
                        };
                        ui.add_space(6.0);
                        ui.horizontal(|ui| {
                            ui.add_space(10.0);
                            ui.add(
                                egui::Label::new(
                                    egui::RichText::new(format!("Tab: {}", truncated_tab))
                                        .size(11.0)
                                        .color(palette.fg_dim),
                                ).truncate(),
                            );
                        });
                        ui.horizontal(|ui| {
                            ui.add_space(10.0);
                            ui.add(
                                egui::Label::new(
                                    egui::RichText::new(format!("{} segs", prop_scene_total))
                                        .size(11.0)
                                        .color(palette.fg_dim),
                                ).truncate(),
                            );
                        });
                        ui.add_space(4.0);
                        // 1 px divider (mockup `border-light`).
                        let div = ui.allocate_exact_size(
                            egui::vec2(ui.available_width(), 1.0), egui::Sense::hover()).0;
                        ui.painter().line_segment(
                            [div.left_center(), div.right_center()],
                            egui::Stroke::new(1.0, palette.border_light));
                        ui.add_space(6.0);
                        // "No selection" card (mockup lines 872-876) —
                        // surface bg, 1 px border-light, padding 10 px,
                        // shown when there's nothing picked AND no multi-
                        // select count.
                        if prop_selection_count == 0 && prop_selection_idx.is_none() {
                            let card_w = ui.available_width() - 16.0;
                            ui.horizontal(|ui| {
                                ui.add_space(8.0);
                                ui.vertical(|ui| {
                                    let (card_rect, _) = ui.allocate_exact_size(
                                        egui::vec2(card_w, 56.0), egui::Sense::hover());
                                    ui.painter().rect_filled(card_rect, 4.0, palette.panel_bg);
                                    ui.painter().rect_stroke(card_rect, 4.0,
                                        egui::Stroke::new(1.0, palette.border_light));
                                    ui.painter().text(
                                        egui::pos2(card_rect.left() + 12.0, card_rect.top() + 18.0),
                                        egui::Align2::LEFT_CENTER,
                                        "No selection",
                                        egui::FontId::proportional(12.0),
                                        palette.fg,
                                    );
                                    ui.painter().text(
                                        egui::pos2(card_rect.left() + 12.0, card_rect.bottom() - 16.0),
                                        egui::Align2::LEFT_CENTER,
                                        "Click a line segment or IFC element to inspect.",
                                        egui::FontId::proportional(10.5),
                                        palette.fg_dim,
                                    );
                                });
                            });
                            ui.add_space(8.0);
                        }
                        // Multi-select summary first â€” wins over the
                        // single-entity inspector when N > 1.
                        if prop_selection_count > 1 {
                            ui.label(format!("{} entities selected", prop_selection_count));
                            ui.label(
                                egui::RichText::new("Move tool drags the whole set. Delete removes them. Ctrl+C copies.")
                                    .size(11.0)
                                    .color(egui::Color32::from_rgb(150, 156, 164)),
                            );
                            ui.separator();
                            if ui.button("Clear selection").clicked() {
                                requested_selection_clear = true;
                            }
                        } else {
                        match (prop_selection_idx, prop_segment) {
                            (Some(idx), Some(seg)) => {
                                let length = ((seg.p2[0]-seg.p1[0]).powi(2)
                                    + (seg.p2[1]-seg.p1[1]).powi(2)).sqrt();
                                let layer_key = layer_key_for_color(seg.color);
                                let tab_ref = self.tabs.get(active_tab_idx);
                                let (entity_name, entity_count) = match tab_ref {
                                    Some(tab)
                                        if tab.scene.segment_entity_idx.len()
                                            == tab.scene.segments.len()
                                        && idx < tab.scene.segment_entity_idx.len() =>
                                    {
                                        let eid = tab.scene.segment_entity_idx[idx];
                                        let name = tab.scene.entity_names.get(eid as usize).cloned()
                                            .unwrap_or_else(|| format!("entity #{}", eid));
                                        // Prefer the cached entity â†’ segs map
                                        // (built lazily on first pick/hover);
                                        // O(1) Vec::len. Fall back to the
                                        // O(n_segs) linear filter only on cold
                                        // scenes where the index hasn't been
                                        // built yet â€” by the time the user has
                                        // a segment selected the index almost
                                        // always exists.
                                        let count = tab.scene_index.as_ref()
                                            .and_then(|si| si.entity_to_segs.get(eid as usize))
                                            .map(|v| v.len())
                                            .unwrap_or_else(|| {
                                                tab.scene.segment_entity_idx.iter()
                                                    .filter(|&&x| x == eid).count()
                                            });
                                        (Some(name), count)
                                    }
                                    _ => (None, 1),
                                };
                                egui::Grid::new("props_grid")
                                    .num_columns(2)
                                    .spacing([10.0, 4.0])
                                    .show(ui, |ui| {
                                        ui.label("Type");
                                        ui.monospace(entity_name.as_deref().unwrap_or("Segment"));
                                        ui.end_row();
                                        ui.label("Fragments");
                                        ui.monospace(format!("{}", entity_count));
                                        ui.end_row();
                                        ui.label("Seg idx");
                                        ui.monospace(format!("{}", idx));
                                        ui.end_row();
                                        ui.label("Layer");
                                        ui.monospace(&layer_key);
                                        ui.end_row();
                                        ui.label("Space");
                                        ui.monospace(if seg.is_paper { "paper" } else { "model" });
                                        ui.end_row();
                                        ui.label("Color");
                                        let r = ((seg.color >> 0)  & 0xFF) as u8;
                                        let g = ((seg.color >> 8)  & 0xFF) as u8;
                                        let b = ((seg.color >> 16) & 0xFF) as u8;
                                        let a = ((seg.color >> 24) & 0xFF) as u8;
                                        ui.horizontal(|ui| {
                                            let (rect, _) = ui.allocate_exact_size(
                                                egui::vec2(18.0, 12.0),
                                                egui::Sense::hover());
                                            ui.painter().rect_filled(rect, 2.0,
                                                egui::Color32::from_rgb(r, g, b));
                                            ui.monospace(format!("#{:02X}{:02X}{:02X}{:02X}", r, g, b, a));
                                        });
                                        ui.end_row();
                                        ui.label("Start");
                                        ui.monospace(format!("({:.3}, {:.3})", seg.p1[0], seg.p1[1]));
                                        ui.end_row();
                                        ui.label("End");
                                        ui.monospace(format!("({:.3}, {:.3})", seg.p2[0], seg.p2[1]));
                                        ui.end_row();
                                        ui.label("Length");
                                        ui.monospace(format!("{:.3}", length));
                                        ui.end_row();
                                    });
                                ui.separator();
                                if ui.button("Clear selection").clicked() {
                                    requested_selection_clear = true;
                                }
                            }
                            _ => {
                                ui.label("No selection.");
                                ui.label("Click a line segment to inspect it.");
                            }
                        }
                        } // end else (prop_selection_count <= 1)
                    });
            }

            // ---- Right: Structure tree (IFC / DXF model browser) ----
            // Toggle with F5 or the ribbon "Structure" button.
            if structure_panel_open {
                if let Some(root) = structure_root.as_ref() {
                    let mut expanded = std::mem::take(&mut self.structure_expanded);
                    let mut selected = self.structure_selected.clone();
                    let mut tree_actions: Vec<StructureTreeAction> = Vec::new();
                    egui::SidePanel::right("structure_tree")
                        .default_width(280.0)
                        .min_width(220.0)
                        .resizable(true)
                        .show(ctx, |ui| {
                            tree_actions = StructureTree::new(
                                "STRUCTURE", root, &mut expanded, &mut selected,
                            ).show(ui);
                        });
                    self.structure_expanded = expanded;
                    self.structure_selected = selected;
                    for a in tree_actions {
                        match a {
                            StructureTreeAction::Toggle(_) => {}
                            StructureTreeAction::Select(id) => {
                                requested_structure_select = Some(id);
                            }
                            StructureTreeAction::DoubleClick(id) => {
                                eprintln!("[structure_tree] double-click on {} â€” zoom-to TODO", id);
                            }
                        }
                    }
                }
            }

            // ---- Samples browser (right side panel when open) --------
            if samples_open {
                egui::SidePanel::right("samples").default_width(380.0).show(ctx, |ui| {
                    side_panel_header(ui, "SAMPLES", || {}, &mut |hdr| {
                        if hdr.chevron_clicked {
                            requested_toggle_samples_panel = true;
                        }
                    });
                    ui.label(
                        egui::RichText::new("Click a file to open it as a new tab")
                            .size(11.0)
                            .color(egui::Color32::from_rgb(150, 156, 164)),
                    );
                    ui.label(
                        egui::RichText::new(format!("{} files indexed", samples_snapshot.len()))
                            .size(11.0)
                            .color(egui::Color32::from_rgb(150, 156, 164)),
                    );
                    ui.separator();
                    egui::ScrollArea::vertical().show(ui, |ui| {
                        let mut last_group = String::new();
                        for entry in &samples_snapshot {
                            let group = entry.label.split('/').next().unwrap_or("").to_string();
                            if group != last_group {
                                ui.separator();
                                ui.colored_label(egui::Color32::LIGHT_BLUE, &group);
                                last_group = group;
                            }
                            let name = entry.label.split('/').nth(1).unwrap_or(&entry.label);
                            let kind_color = if entry.kind == "DWG" {
                                egui::Color32::from_rgb(255, 200, 120)
                            } else {
                                egui::Color32::from_rgb(120, 255, 120)
                            };
                            let size_kb = entry.size as f64 / 1024.0;
                            let size_str = if size_kb >= 1024.0 {
                                format!("{:.1} MB", size_kb / 1024.0)
                            } else {
                                format!("{:.0} KB", size_kb)
                            };
                            let row = ui.horizontal(|ui| {
                                ui.colored_label(kind_color, entry.kind);
                                let label = format!("{} ({})", name, size_str);
                                ui.selectable_label(false, label).clicked()
                            });
                            if row.inner {
                                requested_load_as_new_tab = Some(entry.path.clone());
                            }
                        }
                    });
                    ui.separator();
                    if ui.button("Close (Esc)").clicked() {
                        requested_close_samples = true;
                    }
                });
            }

            // ---- Central canvas area â€” record its rect for hit-testing
            //
            // IMPORTANT: CentralPanel MUST be fully transparent (no `fill`)
            // otherwise egui paints a solid rect on top of the wgpu scene
            // pass (egui is drawn AFTER our scene pass with LoadOp::Load),
            // which renders the canvas visually blank. This was the cause
            // of the "blank canvas after tabbing" regression.
            egui::CentralPanel::default()
                .frame(egui::Frame::none())
                .show(ctx, |ui| {
                    let rect = ui.available_rect_before_wrap();
                    canvas_rect_logical = Some(rect);
                    // Let egui reserve this space so the viewport rect is
                    // stable across frames. The actual 2D content is
                    // drawn via wgpu behind egui; we just leave the
                    // CentralPanel transparent.
                    let _ = ui.allocate_rect(rect, egui::Sense::hover());

                    // Subtle 1 px inset border â€” makes the canvas look
                    // "contained" inside the shell, matching the docked
                    // look of the side panels. Drawn last so it appears
                    // on top of the scene pass (egui paints after wgpu).
                    let inset = rect.shrink(0.5);
                    ui.painter().rect_stroke(
                        inset,
                        0.0,
                        egui::Stroke::new(
                            1.0,
                            egui::Color32::from_rgba_unmultiplied(80, 86, 94, 110),
                        ),
                    );

                    // World-origin XY-axes glyph â€” pans + zooms with the
                    // camera, anchored to world (0,0). Drawn after the
                    // scene pass (egui paints after wgpu) and after the
                    // canvas inset border, so it sits on top of geometry
                    // but below interactive overlays like the view-cube.
                    paint_world_axes(
                        ui.painter(),
                        rect,
                        active_cam_origin,
                        active_cam_pan,
                        active_cam_zoom,
                        active_cam_rotation,
                    );

                    // World-grid overlay (Phase 2) — paints a 10 mm
                    // primary grid with thin minor lines. Stride
                    // adapts to zoom so we never paint > ~80 lines on
                    // screen (which would just blur into a mid-grey
                    // wash anyway).
                    if show_grid_snapshot {
                        paint_world_grid(
                            ui.painter(),
                            rect,
                            active_cam_origin,
                            active_cam_pan,
                            active_cam_zoom,
                            active_cam_rotation,
                            white_bg_snapshot,
                        );
                    }

                    // World-to-screen helper (logical px) shared by the
                    // OSNAP marker and the Measure overlay below.
                    let world_to_screen = |w: [f64; 2]| -> egui::Pos2 {
                        let cx = rect.center().x;
                        let cy = rect.center().y;
                        let hh = rect.height().max(1.0) as f64;
                        let wpp = (2.0 / active_cam_zoom) / hh;
                        let wx_off = w[0] - active_cam_pan.0 - active_cam_origin[0];
                        let wy_off = w[1] - active_cam_pan.1 - active_cam_origin[1];
                        let th = active_cam_rotation;
                        let (ct, st) = (th.cos(), th.sin());
                        let ex = ct * wx_off - st * wy_off;
                        let ey = st * wx_off + ct * wy_off;
                        egui::pos2(cx + (ex / wpp) as f32, cy - (ey / wpp) as f32)
                    };

                    // OSNAP marker â€” paint at the snapped world point
                    // (refreshed each CursorMoved via `update_snap`).
                    if let Some(snap) = snap_result_snapshot.as_ref() {
                        let sp = world_to_screen(snap.point);
                        paint_snap_marker(ui.painter(), rect, sp, snap.kind);
                    }

                    // Measure-tool overlay (Length + Area) â€” rubber-band
                    // from the first click to the live snap-effective
                    // cursor, plus a floating label with the running
                    // length / area / perimeter.
                    if current_tool_mode == ToolMode::Measure {
                        let painter = ui.painter();
                        let stroke = egui::Stroke::new(
                            1.4, egui::Color32::from_rgb(255, 200, 60),
                        );
                        let halo = egui::Stroke::new(
                            3.0, egui::Color32::from_rgba_unmultiplied(0, 0, 0, 140),
                        );
                        let font = egui::FontId::proportional(11.0);
                        let txt_color = egui::Color32::from_rgb(255, 230, 120);
                        let outline_color = egui::Color32::from_black_alpha(180);
                        let outlined_text = |p: &egui::Painter, anchor: egui::Align2,
                                             pos: egui::Pos2, t: &str| {
                            for (ox, oy) in [(-1.0, 0.0), (1.0, 0.0), (0.0, -1.0), (0.0, 1.0)] {
                                p.text(
                                    egui::pos2(pos.x + ox, pos.y + oy),
                                    anchor, t, font.clone(), outline_color,
                                );
                            }
                            p.text(pos, anchor, t, font.clone(), txt_color);
                        };
                        // LENGTH rubber-band.
                        if measure_sub_snapshot == MeasureSub::Length {
                            if let (Some(p1), Some(eff)) = (
                                measure_p1_snapshot,
                                snap_result_snapshot.as_ref()
                                    .map(|s| s.point)
                                    .or(cursor_world_snapshot),
                            ) {
                                let s1 = world_to_screen(p1);
                                let s2 = world_to_screen(eff);
                                painter.line_segment([s1, s2], halo);
                                painter.line_segment([s1, s2], stroke);
                                let dx = eff[0] - p1[0];
                                let dy = eff[1] - p1[1];
                                let d = (dx * dx + dy * dy).sqrt();
                                let mid = egui::pos2(
                                    (s1.x + s2.x) * 0.5,
                                    (s1.y + s2.y) * 0.5 - 12.0,
                                );
                                let txt = format!(
                                    "{:.2} mm  ({:.4} m @ 1:100)",
                                    d, d * 0.0001,
                                );
                                outlined_text(painter, egui::Align2::CENTER_CENTER, mid, &txt);
                            }
                        }
                        // AREA in-progress.
                        if measure_sub_snapshot == MeasureSub::Area
                            && !measure_area_inprog_snapshot.is_empty()
                        {
                            let verts_screen: Vec<egui::Pos2> =
                                measure_area_inprog_snapshot.iter()
                                    .map(|&p| world_to_screen(p)).collect();
                            for i in 0..verts_screen.len().saturating_sub(1) {
                                painter.line_segment([verts_screen[i], verts_screen[i + 1]], halo);
                                painter.line_segment([verts_screen[i], verts_screen[i + 1]], stroke);
                            }
                            if let (Some(last), Some(eff)) = (
                                measure_area_inprog_snapshot.last().copied(),
                                snap_result_snapshot.as_ref()
                                    .map(|s| s.point)
                                    .or(cursor_world_snapshot),
                            ) {
                                let a = world_to_screen(last);
                                let b = world_to_screen(eff);
                                painter.line_segment([a, b], halo);
                                painter.line_segment([a, b], stroke);
                            }
                            if measure_area_inprog_snapshot.len() >= 3 {
                                let first = world_to_screen(measure_area_inprog_snapshot[0]);
                                let last = world_to_screen(
                                    *measure_area_inprog_snapshot.last().unwrap());
                                let dx = first.x - last.x;
                                let dy = first.y - last.y;
                                let len = (dx * dx + dy * dy).sqrt().max(1.0);
                                let ux = dx / len;
                                let uy = dy / len;
                                let dash = 6.0_f32;
                                let gap = 4.0_f32;
                                let mut t = 0.0_f32;
                                while t < len {
                                    let t2 = (t + dash).min(len);
                                    painter.line_segment(
                                        [egui::pos2(last.x + ux * t, last.y + uy * t),
                                         egui::pos2(last.x + ux * t2, last.y + uy * t2)],
                                        stroke);
                                    t += dash + gap;
                                }
                            }
                            if let (Some(eff), Some(last)) = (
                                snap_result_snapshot.as_ref().map(|s| s.point)
                                    .or(cursor_world_snapshot),
                                measure_area_inprog_snapshot.last().copied(),
                            ) {
                                let mut perim = 0.0_f64;
                                let v = &measure_area_inprog_snapshot;
                                for i in 0..v.len().saturating_sub(1) {
                                    let dx = v[i + 1][0] - v[i][0];
                                    let dy = v[i + 1][1] - v[i][1];
                                    perim += (dx * dx + dy * dy).sqrt();
                                }
                                let dx = eff[0] - last[0];
                                let dy = eff[1] - last[1];
                                perim += (dx * dx + dy * dy).sqrt();
                                let mut a_verts: Vec<[f64; 2]> = v.clone();
                                a_verts.push(eff);
                                let area = polygon_area(&a_verts);
                                let mid = world_to_screen(eff);
                                let pos = egui::pos2(mid.x + 16.0, mid.y + 16.0);
                                let txt = format!(
                                    "Area: {:.3} mÂ²  Perim: {:.2} mm",
                                    area * 1e-6, perim,
                                );
                                outlined_text(painter, egui::Align2::LEFT_CENTER, pos, &txt);
                            }
                        }
                        if let Some((p1, p2, d)) = last_measurement_len_snapshot {
                            let s1 = world_to_screen(p1);
                            let s2 = world_to_screen(p2);
                            let mid = egui::pos2(
                                (s1.x + s2.x) * 0.5,
                                (s1.y + s2.y) * 0.5 - 12.0,
                            );
                            let txt = format!(
                                "Length: {:.2} mm  ({:.4} m @ 1:100)",
                                d, d * 0.0001,
                            );
                            outlined_text(painter, egui::Align2::CENTER_CENTER, mid, &txt);
                        }
                        if let Some((perim, area)) = last_measure_area_snapshot {
                            if let Some(cur) = cursor_world_snapshot {
                                let mid = world_to_screen(cur);
                                let pos = egui::pos2(mid.x + 16.0, mid.y + 16.0);
                                let txt = format!(
                                    "Area: {:.3} mÂ²  Perimeter: {:.2} mm",
                                    area * 1e-6, perim,
                                );
                                outlined_text(painter, egui::Align2::LEFT_CENTER, pos, &txt);
                            }
                        }
                    }

                    // Loading overlay â€” drawn whenever the active tab is
                    // a placeholder waiting for a background-thread load
                    // to finish. Replaces the previous "frozen window"
                    // UX on big DWG opens. Centered card with the file
                    // name + an animated spinner + elapsed seconds.
                    if let Some(active) = self.tabs.get(self.active_tab) {
                        if let Some(loading) = active.loading.clone() {
                            let active_idx = self.active_tab;
                            let cancel_flag = self.loading_jobs.iter()
                                .find(|j| j.tab_idx == active_idx)
                                .map(|j| j.cancel.clone());
                            paint_loading_overlay(
                                ui,
                                rect,
                                active.label.as_str(),
                                &loading,
                                cancel_flag.as_ref(),
                            );
                        }
                    }
                });
            // ---- Drag-box overlay (Select mode only) ---------------
            // Drawn via a foreground layer painter so it sits above the
            // canvas inset border but below the view-cube / perf HUD.
            // Coordinates are in egui LOGICAL pixels, while our latched
            // press / mouse coords are PHYSICAL â€” divide by ppp.
            if drag_box_active {
                let painter = ctx.layer_painter(egui::LayerId::new(
                    egui::Order::Foreground, egui::Id::new("dragbox")));
                let p1 = egui::pos2(drag_box_p1.0 / ppp, drag_box_p1.1 / ppp);
                let p2 = egui::pos2(drag_box_p2.0 / ppp, drag_box_p2.1 / ppp);
                let rect = egui::Rect::from_two_pos(p1, p2);
                let (fill, stroke) = if drag_box_zoom {
                    // ZR â€” orange to distinguish zoom-region from
                    // window/crossing selection.
                    (
                        egui::Color32::from_rgba_unmultiplied(240, 160, 60, 40),
                        egui::Stroke::new(1.5, egui::Color32::from_rgb(240, 160, 60)),
                    )
                } else if drag_box_crossing {
                    (
                        egui::Color32::from_rgba_unmultiplied(120, 220, 120, 50),
                        egui::Stroke::new(1.5, egui::Color32::from_rgb(80, 200, 80)),
                    )
                } else {
                    (
                        egui::Color32::from_rgba_unmultiplied(120, 170, 220, 50),
                        egui::Stroke::new(1.5, egui::Color32::from_rgb(80, 140, 220)),
                    )
                };
                painter.rect_filled(rect, 0.0, fill);
                if drag_box_crossing || drag_box_zoom {
                    // Dashed border for crossing-select OR zoom-region.
                    let dash = 6.0;
                    let gap = 4.0;
                    let edges = [
                        (rect.left_top(), rect.right_top()),
                        (rect.right_top(), rect.right_bottom()),
                        (rect.right_bottom(), rect.left_bottom()),
                        (rect.left_bottom(), rect.left_top()),
                    ];
                    for (a, b) in edges {
                        let dx = b.x - a.x; let dy = b.y - a.y;
                        let len = (dx*dx + dy*dy).sqrt().max(1.0);
                        let ux = dx / len; let uy = dy / len;
                        let mut t = 0.0_f32;
                        while t < len {
                            let t2 = (t + dash).min(len);
                            painter.line_segment(
                                [egui::pos2(a.x + ux*t, a.y + uy*t),
                                 egui::pos2(a.x + ux*t2, a.y + uy*t2)],
                                stroke);
                            t += dash + gap;
                        }
                    }
                } else {
                    painter.rect_stroke(rect, 0.0, stroke);
                }
            }

            // Floating 2D view-cube / nav-disk overlay â€” anchored
            // bottom-right of the whole window (via an egui Area, same
            // pattern as the Perf HUD). Click N/E/S/W to snap camera
            // rotation; drag to rotate freely; centre = Fit; 1:1 = reset.
            paint_view_cube(
                ctx,
                canvas_rect_logical.unwrap_or(egui::Rect::from_min_size(
                    egui::pos2(0.0, 0.0), egui::vec2(100.0, 100.0),
                )),
                active_cam_rotation,
                &mut requested_rotation,
                &mut requested_fit,
                &mut requested_home,
            );

            // ---- Text editor overlay ---------------------------------
            // Anchored at the entity's screen position. Live preview re-
            // tessellates with 50 ms debounce after typing stops (handled
            // before the next egui run, see top of `render`). Commit /
            // cancel buttons just flip locals which are processed once
            // the egui closure unborrows `self`.
            if let Some(state) = self.edit_mode.as_mut() {
                let screen_anchor: Option<egui::Pos2> = self.tabs.get(state.tab_idx)
                    .and_then(|tab| tab.scene.entity_text.get(state.eid as usize)
                        .and_then(|o| o.as_ref())
                        .map(|et| {
                            let cam = &tab.cam;
                            let rect = self.canvas_rect;
                            let px = world_to_screen_x_helper(et.anchor[0], et.anchor[1], cam, rect);
                            let py = world_to_screen_y_helper(et.anchor[0], et.anchor[1], cam, rect);
                            let ppp = ctx.pixels_per_point();
                            // Drop the popup BELOW the text glyphs so the live
                            // preview stays visible while typing. Text height
                            // is in world-Y units; convert to physical pixels
                            // via the same wpp the camera uses, then to
                            // logical pixels for the egui Area, plus 12 px gap.
                            let h_phys = rect.3.max(1.0) as f64;
                            let px_per_world = (h_phys * cam.zoom) / 2.0;
                            let glyph_h_phys = (et.height.max(1e-6) * px_per_world) as f32;
                            let drop = (glyph_h_phys / ppp) + 12.0;
                            egui::pos2(px / ppp, py / ppp + drop.max(28.0))
                        }));
                if let Some(anchor) = screen_anchor {
                    egui::Area::new("text_edit_overlay".into())
                        .order(egui::Order::Foreground)
                        .fixed_pos(anchor)
                        .show(ctx, |ui| {
                            egui::Frame::popup(ui.style())
                                .fill(egui::Color32::from_rgba_unmultiplied(20, 24, 32, 245))
                                .show(ui, |ui| {
                                    let resp = ui.add_sized(
                                        [400.0, 80.0],
                                        egui::TextEdit::multiline(&mut state.buffer)
                                            .desired_rows(4)
                                            .lock_focus(true),
                                    );
                                    if resp.changed() {
                                        state.debounce_at = Some(
                                            std::time::Instant::now()
                                                + std::time::Duration::from_millis(50),
                                        );
                                    }
                                    ui.horizontal(|ui| {
                                        if ui.button("Commit (Enter)").clicked() { commit_pending = true; }
                                        if ui.button("Cancel (Esc)").clicked() { cancel_pending = true; }
                                    });
                                });
                        });
                }
            }

            // ---- Perf HUD --------------------------------------------
            if let Some(text) = &hud_text {
                egui::Area::new("perf_hud".into())
                    .anchor(egui::Align2::RIGHT_TOP, egui::vec2(-12.0, 34.0))
                    .order(egui::Order::Foreground)
                    .show(ctx, |ui| {
                        egui::Frame::popup(ui.style())
                            .fill(egui::Color32::from_rgba_unmultiplied(10, 10, 14, 220))
                            .show(ui, |ui| {
                                ui.style_mut().visuals.override_text_color =
                                    Some(egui::Color32::from_rgb(180, 255, 180));
                                ui.monospace(text);
                            });
                    });
            }
        });
        let t_egui_run_done = std::time::Instant::now();
        gpu.egui_state.handle_platform_output(win, full_output.platform_output.clone());

        // Derive physical-pixel canvas rect for the scene pass.
        let canvas_px = canvas_rect_logical.map(|r| {
            let x = (r.min.x * ppp).max(0.0);
            let y = (r.min.y * ppp).max(0.0);
            let w = ((r.width() * ppp).max(1.0)).min(gpu.config.width as f32 - x);
            let h = ((r.height() * ppp).max(1.0)).min(gpu.config.height as f32 - y);
            (x, y, w, h)
        }).unwrap_or((0.0, 0.0, gpu.config.width as f32, gpu.config.height as f32));
        self.canvas_rect = canvas_px;

        // Also store split sub-rects in PHYSICAL pixels so they can be
        // compared directly against `mouse_pos` (also physical px from
        // winit CursorMoved). When no split, secondary is an empty rect
        // and primary mirrors the full canvas rect.
        let (cp_x, cp_y, cp_w, cp_h) = canvas_px;
        let split_kind_now = self.tabs.get(self.active_tab).and_then(|t| t.split_kind);
        let (primary_phys, secondary_phys) = match split_kind_now {
            Some(SplitKind::HorizontalPair(o)) if o < self.tabs.len() => {
                let half = cp_w * 0.5;
                ((cp_x, cp_y, half, cp_h), (cp_x + half, cp_y, cp_w - half, cp_h))
            }
            Some(SplitKind::VerticalPair(o)) if o < self.tabs.len() => {
                let half = cp_h * 0.5;
                ((cp_x, cp_y, cp_w, half), (cp_x, cp_y + half, cp_w, cp_h - half))
            }
            _ => ((cp_x, cp_y, cp_w, cp_h), (0.0, 0.0, 0.0, 0.0)),
        };
        self.split_primary_rect = primary_phys;
        self.split_secondary_rect = secondary_phys;

        // Panes to render this frame: always the primary (active_tab),
        // plus the partner if split_kind is set. Each pane carries its
        // own physical-pixel rect for set_viewport.
        let panes = build_render_panes(
            &self.tabs,
            self.active_tab,
            canvas_px,
            ppp,
        );

        // Upload camera UBO for every pane using its OWN aspect. Each
        // tab's per-pipe UBOs are uploaded with the correct aspect so the
        // second pane inherits the correct one when we loop and draw.
        // NOTE: when the same tab appears in both panes (can't happen
        // today because we clear self-pairs), the last upload would win â€”
        // not a concern in practice.
        for pane in &panes {
            if let Some(tab) = self.tabs.get(pane.tab_idx) {
                let aspect = pane.rect_px.2 / pane.rect_px.3.max(1.0);
                let ubo = Self::camera_of(&tab.cam, aspect);
                if let Some(p) = tab.pipe.as_ref() { p.update_camera(&gpu.queue, ubo); }
                if let Some(p) = tab.tri_pipe.as_ref() { p.update_camera(&gpu.queue, ubo); }
                if let Some(p) = tab.text_tri_pipe.as_ref() { p.update_camera(&gpu.queue, ubo); }
                if let Some(p) = tab.sel_pipe.as_ref() { p.update_camera(&gpu.queue, ubo); }
                // Annotate tools â€” per user request: linear maatlijn + area measurement, per-tab persistence
                if let Some(p) = tab.annotation_pipe.as_ref() { p.update_camera(&gpu.queue, ubo); }
            }
        }

        // --- Apply simple intents that don't touch gpu borrow -------------
        if requested_close_samples { self.samples_panel_open = false; }
        if requested_toggle_layer_panel { self.layer_panel_open = !self.layer_panel_open; }
        if requested_toggle_props_panel { self.properties_panel_open = !self.properties_panel_open; }
        if requested_toggle_structure_panel { self.structure_panel_open = !self.structure_panel_open; }
        if let Some(id) = requested_structure_select {
            // Selection only â€” no-op beyond storing it. We have no
            // entity-id-to-bbox lookup wired up yet.
            self.structure_selected = Some(id);
        }
        if requested_toggle_samples_panel { self.samples_panel_open = !self.samples_panel_open; }
        if requested_toggle_perf_hud { self.show_perf_hud = !self.show_perf_hud; }
        if requested_toggle_present_mode {
            self.pending_present_mode = Some(match self.present_mode {
                wgpu::PresentMode::Fifo => wgpu::PresentMode::Immediate,
                _ => wgpu::PresentMode::Fifo,
            });
        }
        if requested_toggle_about { self.about_dialog_open = !self.about_dialog_open; }
        if requested_about_close { self.about_dialog_open = false; }
        // Save-As-DWG modal dispatch. Confirm just flips the existing
        // requested_menu_save_as_dxf flag -- save_as_dxf is dispatched
        // later in this same frame (after the gpu borrow drops), so the
        // double-borrow that a direct call would cause is avoided.
        if requested_save_as_dwg_close {
            self.save_as_dwg_modal_open = false;
        }
        if requested_save_as_dwg_confirm_dxf {
            self.save_as_dwg_modal_open = false;
            requested_menu_save_as_dxf = true;
        }
        if let Some(tab) = requested_ribbon_tab { self.active_ribbon_tab = tab; }

        // ---- Title-bar action dispatch -------------------------------
        // App-menu popup wired (Round 9) â€” superui::dialogs::AppMenu.
        if requested_toggle_app_menu {
            self.app_menu_open = !self.app_menu_open;
        }
        if requested_window_minimize {
            if let Some(w) = self.window.as_ref() { w.set_minimized(true); }
        }
        if requested_window_toggle_max {
            if let Some(w) = self.window.as_ref() {
                let cur = w.is_maximized();
                w.set_maximized(!cur);
            }
        }
        if requested_window_close {
            std::process::exit(0);
        }
        if requested_window_drag {
            if let Some(w) = self.window.as_ref() {
                // Best-effort â€” fails silently if the OS rejects (e.g.
                // already in another window-manager modal interaction).
                let _ = w.drag_window();
            }
        }
        if let Some(dir) = requested_resize_dir {
            if let Some(w) = self.window.as_ref() {
                // Best-effort â€” winit returns a Result we deliberately drop.
                let _ = w.drag_resize_window(dir);
            }
        }
        if let Some(mut m) = requested_tool_mode {
            // Viewer mode: collapse every authoring *creation* tool back
            // to Select. The minimal-edit surface (Move / Delete /
            // Explode) IS allowed here per the viewer-port scope --
            // strict authoring tools (Rotate / Scale / Mirror /
            // Dimension / Area) still snap to Select.
            if self.mode == AppMode::Viewer {
                let allowed = matches!(m,
                    ToolMode::Select | ToolMode::Measure | ToolMode::ZoomRegion
                        | ToolMode::Move | ToolMode::ZoomCenter
                        | ToolMode::MeasureAngle | ToolMode::MeasureCoord
                );
                if !allowed {
                    eprintln!("[viewer] ignoring authoring tool request: {:?}", m);
                    m = ToolMode::Select;
                }
            }
            self.tool_mode = m;
            if m != ToolMode::Measure { self.measure_p1 = None; }
            if m != ToolMode::MeasureAngle { self.measure_angle_pts.clear(); }
            if m != ToolMode::MeasureCoord { self.last_measure_coord = None; }
            if m != ToolMode::Move {
                if let Some(tab) = self.tabs.get_mut(self.active_tab) {
                    tab.move_drag = None;
                    tab.pending_move_offset = [0.0, 0.0];
                }
                pending_selection_rebuild = true;
            }
            // Annotate tools â€” per user request: linear maatlijn + area measurement, per-tab persistence
            if m != ToolMode::Dimension { self.dim_p1 = None; }
            if m != ToolMode::Area { self.area_in_progress.clear(); }
            // Blok 3 â€” clear transform-tool state on switch.
            if m != ToolMode::Rotate { self.rotate_pivot = None; }
            if m != ToolMode::Scale  { self.scale_pivot = None; self.scale_ref = None; }
            if m != ToolMode::Mirror { self.mirror_a = None; }
        }
        // Blok 3 â€” Copy button flips the deferred-duplicate flag so the
        // editor block (where gpu borrow is dropped) actually runs it.
        if requested_duplicate {
            self.requested_duplicate = true;
        }
        // Same fold-pattern for Explode -- the ribbon button + keyboard
        // X both feed into the deferred editor block.
        if requested_explode {
            self.requested_explode = true;
        }
        if requested_clear_measurement {
            self.last_measurement = None;
            self.measure_p1 = None;
        }
        // OSNAP â€” flip the requested bit in self.snap_modes. The marker
        // refreshes on the next CursorMoved; we don't call `update_snap`
        // here because the GPU is still borrowed by the outer render loop.
        if let Some(bit) = requested_snap_toggle {
            self.snap_modes.toggle(bit);
        }
        if requested_ortho_toggle {
            self.ortho_enabled = !self.ortho_enabled;
        }
        if requested_zoom_previous {
            // Pop directly — no push beforehand (otherwise repeated
            // clicks would just toggle between the last two views).
            // Inlined here because zoom_previous() takes &mut self,
            // which conflicts with the still-live `gpu` borrow above.
            if let Some((tab_idx, cam)) = self.camera_history.pop() {
                if let Some(tab) = self.tabs.get_mut(tab_idx) {
                    tab.cam = cam;
                }
            }
        }
        // Zoom In/Out ribbon buttons -- one notch = 1.25x in, 0.8x out.
        // Anchored at the canvas centre so the visible content stays
        // roughly fixed. Pushes onto camera_history so Zoom Previous
        // walks back through ribbon-driven steps too.
        if let Some(dir) = requested_zoom_step {
            let active = self.active_tab;
            if let Some(cam_now) = self.tabs.get(active).map(|t| t.cam) {
                if self.camera_history.len() >= CAMERA_HISTORY_MAX {
                    self.camera_history.remove(0);
                }
                self.camera_history.push((active, cam_now));
            }
            let factor: f64 = if dir > 0 { 1.25 } else { 0.8 };
            if let Some(tab) = self.tabs.get_mut(active) {
                tab.cam.zoom = (tab.cam.zoom * factor).clamp(1e-6, 1e9);
            }
        }
        if requested_toggle_grid { self.show_grid = !self.show_grid; }
        if requested_toggle_white_bg { self.white_bg = !self.white_bg; }
        if requested_cycle_theme {
            // Phase 2 placeholder — superui only ships `Default`
            // today. Just log + bump a no-op cycle counter so the
            // affordance is testable; the real theme picker is
            // tracked as a follow-up TODO.
            eprintln!("[viewer] theme cycle requested — only Default ships in Phase 2");
        }
        if requested_view_mode_cycle {
            // Cycle Hidden Line (0) → Wireframe (1) → back. Viewer
            // build never advances to a Shaded mode (no 3D renderer).
            self.view_mode_idx = (self.view_mode_idx + 1) % 2;
        }
        // Find dialog — only field flips happen here; the expensive
        // refresh + jump run later in a post-gpu-borrow block.
        let mut deferred_find_refresh = false;
        let mut deferred_find_jump: Option<Option<u32>> = None;
        if requested_toggle_find {
            self.find_dialog_open = !self.find_dialog_open;
            if self.find_dialog_open { deferred_find_refresh = true; }
        }
        if requested_find_close { self.find_dialog_open = false; }
        if let Some(q) = requested_find_query {
            self.find_query = q;
            deferred_find_refresh = true;
        }
        if let Some(eid) = requested_find_jump {
            deferred_find_jump = Some(eid);
        }
        // Measure sub-mode change â€” also arms the Measure tool, clears
        // any stale in-progress state, and wipes the last result so the
        // floating label doesn't linger across sub-modes.
        if let Some(sub) = requested_measure_sub {
            self.measure_sub = sub;
            self.tool_mode = ToolMode::Measure;
            self.measure_p1 = None;
            self.measure_area_in_progress.clear();
            self.last_measurement = None;
            self.last_measure_area = None;
        }
        // Annotate tools â€” per user request: linear maatlijn + area measurement, per-tab persistence
        if requested_clear_annotations {
            if let Some(tab) = self.tabs.get_mut(self.active_tab) {
                tab.annotations.clear();
            }
            self.dim_p1 = None;
            self.area_in_progress.clear();
            // NOTE: annotation pipe is rebuilt unconditionally below on every
            // frame, so no immediate rebuild is needed here.
        }

        // Tab activation.
        if let Some(idx) = requested_activate_tab {
            if idx < self.tabs.len() {
                self.active_tab = idx;
                self.active_split_child = 0;
                if let Some(win) = self.window.as_ref() {
                    win.set_title(&Self::title_for(&self.tabs, self.active_tab, self.mode));
                }
            }
        }

        // Split-view intents.
        if let Some(other) = requested_split_h_with {
            if other < self.tabs.len() && other != self.active_tab {
                if let Some(tab) = self.tabs.get_mut(self.active_tab) {
                    tab.split_kind = Some(SplitKind::HorizontalPair(other));
                }
            }
        }
        if let Some(other) = requested_split_v_with {
            if other < self.tabs.len() && other != self.active_tab {
                if let Some(tab) = self.tabs.get_mut(self.active_tab) {
                    tab.split_kind = Some(SplitKind::VerticalPair(other));
                }
            }
        }
        if requested_unsplit {
            if let Some(tab) = self.tabs.get_mut(self.active_tab) {
                tab.split_kind = None;
            }
            self.active_split_child = 0;
        }

        // Layer intents â€” mutate active tab then rebuild its buffers.
        let mut need_rebuild_active = false;
        if let Some(key) = requested_layer_toggle {
            if let Some(tab) = self.tabs.get_mut(self.active_tab) {
                if tab.hidden_layers.contains(&key) {
                    tab.hidden_layers.remove(&key);
                } else {
                    tab.hidden_layers.insert(key);
                }
            }
            need_rebuild_active = true;
        }
        if requested_layer_show_all {
            if let Some(tab) = self.tabs.get_mut(self.active_tab) {
                // Soft-deleted layers stay hidden after Show-all so the
                // user has to explicitly restore them (future feature).
                tab.hidden_layers = tab.deleted_layers.clone();
            }
            need_rebuild_active = true;
        }
        if let Some(key) = requested_layer_delete {
            if let Some(tab) = self.tabs.get_mut(self.active_tab) {
                let was_hidden_before = tab.hidden_layers.contains(&key);
                tab.deleted_layers.insert(key.clone());
                tab.hidden_layers.insert(key.clone());
                // Make the soft-delete undoable (Ctrl+Z restores the row
                // + un-hides if it wasn't hidden via the eye before).
                push_undo(&mut tab.undo_stack, EditOp::LayerDelete {
                    layer_name: key,
                    was_hidden_before,
                });
            }
            need_rebuild_active = true;
        }
        if requested_layer_hide_all {
            if let Some(tab) = self.tabs.get_mut(self.active_tab) {
                tab.hidden_layers.clear();
                for (name, _) in &layers_for_active {
                    tab.hidden_layers.insert(name.clone());
                }
            }
            need_rebuild_active = true;
        }

        // Layout switch (Model/Layout1/...) for active tab.
        if let Some((lbbox, layout_name)) = requested_fit_layout {
            if let Some(tab) = self.tabs.get_mut(self.active_tab) {
                let want_paper = !layout_name.eq_ignore_ascii_case("Model");
                // For Model, fit to scene bbox (layout bbox may be sentinel).
                if want_paper {
                    tab.cam = PaneCam::fit(&lbbox);
                } else {
                    tab.cam = PaneCam::fit(&tab.scene.bbox);
                }
                tab.show_paper = want_paper;
            }
            need_rebuild_active = true;
        }

        if need_rebuild_active {
            // Rebuild active tab's buffers. We still hold `gpu` mutably
            // from earlier, but we only need its device/queue/format
            // fields (all immutable methods), so re-borrow as immutable.
            let gpu_ref: &GpuCtx = gpu;
            if let Some(tab) = self.tabs.get_mut(self.active_tab) {
                tab.rebuild_buffers(gpu_ref);
                // If hiding a layer dropped the only selected segments,
                // prune them. (Multi-select: keep segments still on a
                // visible layer.)
                let hidden = tab.hidden_layers.clone();
                let segs_snap: Vec<(u32, bool)> = tab.scene.segments.iter()
                    .map(|s| (s.color, hidden.contains(&layer_key_for_color(s.color))))
                    .collect();
                tab.selection.retain(|&seg_idx| {
                    segs_snap.get(seg_idx).map(|(_, h)| !h).unwrap_or(false)
                });
            }
            pending_selection_rebuild = true;
        }

        if requested_selection_clear {
            if let Some(tab) = self.tabs.get_mut(self.active_tab) {
                tab.selection.clear();
                tab.hover = None;
            }
            pending_selection_rebuild = true;
        }

        // ------ Editor: copy / cut / delete / paste / select-all / undo
        // The actual work happens in the post-present block below where
        // the gpu mutable borrow has been dropped â€” see "Deferred editor
        // work" near the end of render(). The flags stay set so that
        // block can claim them.

        // Rebuild selection highlight for active tab if requested.
        if pending_selection_rebuild {
            let gpu_ref: &GpuCtx = gpu;
            rebuild_sel_pipe(self.tabs.get_mut(self.active_tab), gpu_ref);
        }

        // Annotate tools â€” per user request: linear maatlijn + area measurement, per-tab persistence
        // Rebuild annotation pipe for the active tab (and split partner if
        // any). Inactive tabs are never painted so there's no need to
        // re-bake their dash strides every frame â€” they'll regenerate
        // when the user activates them. The function itself short-circuits
        // when the tab has no annotations + no in-progress polygon
        // (common case for Viewer mode + most Studio drawings).
        {
            let gpu_ref: &GpuCtx = gpu;
            let active_tab_idx_local = self.active_tab;
            let cur_world = self.cursor_world;
            let in_progress: Option<Vec<[f64; 2]>> =
                if self.tool_mode == ToolMode::Area && !self.area_in_progress.is_empty() {
                    Some(self.area_in_progress.clone())
                } else { None };
            // Active tab â€” with in-progress polygon + cursor for rubber-band.
            rebuild_annotation_pipe(
                self.tabs.get_mut(active_tab_idx_local),
                in_progress.as_deref(),
                cur_world,
                gpu_ref,
            );
            // Split partner (if any) â€” no in-progress polygon, no cursor.
            // Only one extra rebuild call vs the old O(n_tabs) loop.
            let partner = Self::split_partner(&self.tabs, active_tab_idx_local);
            if let Some(other) = partner {
                if other != active_tab_idx_local {
                    rebuild_annotation_pipe(
                        self.tabs.get_mut(other),
                        None,
                        None,
                        gpu_ref,
                    );
                }
            }
        }

        // --- egui paint + scene pass ------------------------------------
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

        let t_scene_start = std::time::Instant::now();

        // Scene pass â€” render each pane (1 when not split, 2 when split).
        // Shared render target, single clear, multiple viewports. When a
        // pane is a paper-space view the whole framebuffer is still dark
        // (we can't clear-per-viewport without scissor tricks), but the
        // scene pass itself still paints its own white behind the tab's
        // geometry via wgpu viewport rendering.
        {
            // Clear using primary tab's bg colour (matches the "the
            // active half drives the frame colour" expectation).
            // Phase 2 — White BG toggle from the View ribbon overrides
            // the dark background regardless of paper-space state, so
            // users get the AutoCAD "model background" preference.
            let force_white = self.white_bg
                || self.tabs.get(self.active_tab)
                    .map(|t| t.show_paper).unwrap_or(false);
            let clear_color = if force_white {
                wgpu::Color { r: 0.95, g: 0.95, b: 0.95, a: 1.0 }
            } else {
                wgpu::Color { r: 0.06, g: 0.08, b: 0.10, a: 1.0 }
            };
            let mut pass = enc.begin_render_pass(&wgpu::RenderPassDescriptor {
                label: Some("scene"),
                color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                    view: &view, resolve_target: None,
                    ops: wgpu::Operations {
                        load: wgpu::LoadOp::Clear(clear_color),
                        store: wgpu::StoreOp::Store,
                    },
                })],
                depth_stencil_attachment: None,
                timestamp_writes: None, occlusion_query_set: None,
            });
            for pane in &panes {
                let (cx, cy, cw, ch) = pane.rect_px;
                // Skip degenerate viewports â€” wgpu panics on 0-size.
                if cw < 1.0 || ch < 1.0 { continue; }
                // Clamp to framebuffer just in case.
                let fw = gpu.config.width as f32;
                let fh = gpu.config.height as f32;
                let cx = cx.max(0.0).min(fw - 1.0);
                let cy = cy.max(0.0).min(fh - 1.0);
                let cw = cw.min(fw - cx).max(1.0);
                let ch = ch.min(fh - cy).max(1.0);
                pass.set_viewport(cx, cy, cw, ch, 0.0, 1.0);
                let Some(tab) = self.tabs.get(pane.tab_idx) else { continue; };
                if let Some(tp) = tab.tri_pipe.as_ref() {
                    if tp.vertex_count > 0 {
                        pass.set_pipeline(&tp.pipeline);
                        pass.set_bind_group(0, &tp.camera_bg, &[]);
                        pass.set_vertex_buffer(0, tp.vb.slice(..));
                        pass.draw(0..tp.vertex_count, 0..1);
                    }
                }
                if let Some(ttp) = tab.text_tri_pipe.as_ref() {
                    if ttp.vertex_count > 0 {
                        pass.set_pipeline(&ttp.pipeline);
                        pass.set_bind_group(0, &ttp.camera_bg, &[]);
                        pass.set_vertex_buffer(0, ttp.vb.slice(..));
                        pass.draw(0..ttp.vertex_count, 0..1);
                    }
                }
                if let Some(p) = tab.pipe.as_ref() {
                    pass.set_pipeline(&p.pipeline);
                    pass.set_bind_group(0, &p.camera_bg, &[]);
                    pass.set_vertex_buffer(0, p.vb.slice(..));
                    pass.draw(0..p.vertex_count, 0..1);
                }
                // Annotate tools â€” per user request: linear maatlijn + area measurement, per-tab persistence
                // Draw annotation_pipe BEFORE sel_pipe so selection highlight tops everything.
                if let Some(ap) = tab.annotation_pipe.as_ref() {
                    if ap.vertex_count > 0 {
                        pass.set_pipeline(&ap.pipeline);
                        pass.set_bind_group(0, &ap.camera_bg, &[]);
                        pass.set_vertex_buffer(0, ap.vb.slice(..));
                        pass.draw(0..ap.vertex_count, 0..1);
                    }
                }
                if let Some(sp) = tab.sel_pipe.as_ref() {
                    if sp.vertex_count > 0 {
                        pass.set_pipeline(&sp.pipeline);
                        pass.set_bind_group(0, &sp.camera_bg, &[]);
                        pass.set_vertex_buffer(0, sp.vb.slice(..));
                        pass.draw(0..sp.vertex_count, 0..1);
                    }
                }
            }
        }

        let t_scene_done = std::time::Instant::now();
        // egui on top
        gpu.egui_renderer.update_buffers(&gpu.device, &gpu.queue, &mut enc, &paint_jobs, &screen);
        {
            let pass = enc.begin_render_pass(&wgpu::RenderPassDescriptor {
                label: Some("egui"),
                color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                    view: &view, resolve_target: None,
                    ops: wgpu::Operations { load: wgpu::LoadOp::Load, store: wgpu::StoreOp::Store },
                })],
                depth_stencil_attachment: None,
                timestamp_writes: None, occlusion_query_set: None,
            });
            let mut p_s = pass.forget_lifetime();
            gpu.egui_renderer.render(&mut p_s, &paint_jobs, &screen);
        }
        for id in &full_output.textures_delta.free {
            gpu.egui_renderer.free_texture(id);
        }
        let t_egui_paint_done = std::time::Instant::now();
        gpu.queue.submit(std::iter::once(enc.finish()));
        frame.present();
        let t_present_done = std::time::Instant::now();

        self.last_timings = FrameTimings {
            total: frame_start.elapsed(),
            egui_run: t_egui_run_done.saturating_duration_since(t_egui_run_start),
            camera_upload: t_cam_done.saturating_duration_since(t_cam_start),
            scene_pass: t_scene_done.saturating_duration_since(t_scene_start),
            egui_paint: t_egui_paint_done.saturating_duration_since(t_scene_done),
            present: t_present_done.saturating_duration_since(t_egui_paint_done),
        };
        self.frame_times.push_back(self.last_timings.total);
        if self.frame_times.len() > 60 { self.frame_times.pop_front(); }
        if let Some(win) = self.window.as_ref() { win.request_redraw(); }

        // --- Post-present actions (gpu borrow ends below) ---------------
        if deferred_find_refresh {
            self.refresh_find_matches();
        }
        if let Some(eid) = deferred_find_jump {
            self.jump_to_find_match(eid);
            if let Some(gpu_ref) = self.gpu.as_ref() {
                rebuild_sel_pipe(self.tabs.get_mut(self.active_tab), gpu_ref);
            }
        }
        if let Some(idx) = requested_close_tab {
            self.close_tab(idx);
        }
        if requested_new_tab || requested_menu_open_dialog {
            self.open_file_dialog();
        }
        if let Some(path) = requested_load_as_new_tab {
            eprintln!("[samples] loading as new tab: {}", path);
            self.start_load_into_new_tab(path);
        }
        if let Some(path) = requested_menu_recent_load {
            self.start_load_into_new_tab(path);
        }
        if requested_menu_recent_clear {
            self.recent_files.clear();
            save_recent_files(&self.recent_files);
        }
        if requested_menu_reload {
            let path_opt = self.tabs.get(self.active_tab).and_then(|t| t.path.clone());
            if let Some(path) = path_opt {
                self.start_load_into_active_tab(path);
            } else {
                eprintln!("[menu] reload: active tab has no path");
            }
        }
        if requested_menu_close_active {
            self.close_tab(self.active_tab);
        }
        if requested_menu_save_as_ifcx {
            // IFCDraw is the persistence format for whatever the user
            // currently sees plus their minimal viewer-mode edits
            // (Move / Delete / Explode / layer-delete). Available in
            // both Studio and Viewer per user direction.
            self.save_as_ifcx_binary();
        }
        if requested_menu_save_as_dxf {
            // Viewer can now persist its minimal-edit changes (Move /
            // Delete / Explode / layer-delete) via the DXF text format
            // -- AutoCAD opens that natively and Open 2D's DWG writer
            // is not yet implemented (see docs/superpowers/plans/
            // dwg-writer-plan.md). No mode guard.
            self.save_as_dxf();
        }
        if requested_fit {
            // Snapshot the old camera for Zoom Previous (inlined push;
            // can't call self.push_camera_history while another `self`
            // borrow may still be live in this dispatch chain).
            let active = self.active_tab;
            if let Some(cam_now) = self.tabs.get(active).map(|t| t.cam) {
                if self.camera_history.len() >= CAMERA_HISTORY_MAX {
                    self.camera_history.remove(0);
                }
                self.camera_history.push((active, cam_now));
            }
            if let Some(tab) = self.tabs.get_mut(active) {
                tab.cam = PaneCam::fit(&tab.scene.bbox);
            }
        }
        if requested_home {
            if let Some(tab) = self.tabs.get_mut(self.active_tab) {
                tab.cam = PaneCam::fit(&tab.scene.bbox);
                tab.cam.zoom = 1.0;
            }
        }
        if let Some(new_rot) = requested_rotation {
            if let Some(tab) = self.tabs.get_mut(self.active_tab) {
                tab.cam.rotation = new_rot;
            }
        }

        // Text-editor overlay button presses (Task 10). Both call into
        // `&mut self` paths that need the gpu borrow released â€” this
        // section runs after `Post-present actions`, where gpu is free.
        if commit_pending { self.commit_text_edit(); }
        if cancel_pending { self.cancel_text_edit(); }

        // ---- Deferred editor work (gpu borrow safely dropped) ---------
        // These can mutate scene + GPU buffers freely, then trigger a
        // selection-pipe rebuild for the next frame.
        let do_select_all = std::mem::take(&mut self.requested_select_all);
        let do_copy = std::mem::take(&mut self.requested_copy);
        let do_delete = std::mem::take(&mut self.requested_delete);
        let do_paste = std::mem::take(&mut self.requested_paste);
        let do_undo = std::mem::take(&mut self.requested_undo);
        // Blok 3 â€” duplicate-selection (Ctrl+D / Copy ribbon button).
        let do_duplicate = std::mem::take(&mut self.requested_duplicate);
        let do_explode = std::mem::take(&mut self.requested_explode);
        let mut need_sel_rebuild = false;
        let active = self.active_tab;
        if do_select_all {
            self.select_all_in(active);
            need_sel_rebuild = true;
        }
        if do_copy {
            let eids = self.selected_entity_ids_in(active);
            if !eids.is_empty() {
                self.clipboard = self.snapshot_entities_in(active, &eids);
                eprintln!("[clipboard] copied {} entities", self.clipboard.len());
            }
        }
        if do_delete {
            let eids = self.selected_entity_ids_in(active);
            if !eids.is_empty() {
                self.delete_entities_in(active, &eids);
                self.reupload_tab_buffers(active);
                eprintln!("[delete] removed {} entities", eids.len());
                need_sel_rebuild = true;
            }
        }
        if do_paste && !self.clipboard.is_empty() {
            let n = self.clipboard.len();
            self.paste_clipboard_in(active);
            self.reupload_tab_buffers(active);
            eprintln!("[paste] inserted {} entities", n);
            need_sel_rebuild = true;
        }
        if do_undo {
            self.undo_last_edit();
            need_sel_rebuild = true;
        }
        if do_duplicate {
            let eids_preview = self.selected_entity_ids_in(active);
            if !eids_preview.is_empty() {
                self.duplicate_selected_in(active);
                self.reupload_tab_buffers(active);
                eprintln!("[duplicate] {} entities cloned", eids_preview.len());
                need_sel_rebuild = true;
            }
        }
        if do_explode {
            let eids = self.selected_entity_ids_in(active);
            if !eids.is_empty() {
                let exploded = self.explode_inserts_in(active, &eids);
                if exploded > 0 {
                    self.reupload_tab_buffers(active);
                    eprintln!("[explode] split {} INSERT entit{} into per-segment entities",
                        exploded, if exploded == 1 { "y" } else { "ies" });
                    need_sel_rebuild = true;
                } else {
                    eprintln!("[explode] selection has no INSERT entities -- nothing to do");
                }
            }
        }
        if need_sel_rebuild {
            if let Some(gpu) = self.gpu.as_ref() {
                rebuild_sel_pipe(self.tabs.get_mut(active), gpu);
            }
        }
    }

    /// Pixels â†’ world units conversion.
    ///
    /// `(2.0 / cam.zoom)` is the FULL visible world-height in the canvas
    /// viewport: `camera_of` sets `half_h = 1/zoom`, so the viewport maps
    /// NDC `[-1, 1]` to world `[-half_h, half_h]` = `2/zoom` span. One
    /// pixel thus covers `world_height / canvas_pixels_height`.
    ///
    /// Previous formula `/ (h * 0.5)` was off by 2Ã— (introduced when the
    /// code migrated from the 4-pane world to single-canvas) â€” pan moved
    /// 2Ã— the mouse speed and zoom-at-cursor drifted off the mouse.
    /// World-units-per-pixel for a given camera and canvas rect (physical px).
    fn world_per_pixel_in(&self, cam: &PaneCam, rect: (f32, f32, f32, f32)) -> f64 {
        let h = rect.3.max(1.0) as f64;
        (2.0 / cam.zoom) / h
    }

    fn world_per_pixel(&self, cam: &PaneCam) -> f64 {
        self.world_per_pixel_in(cam, self.canvas_rect)
    }

    /// Refresh `self.current_snap` from the live cursor. Called once per
    /// CursorMoved after `cursor_world` is updated. Builds the snap
    /// segment-endpoint cache + spatial index on demand, then runs
    /// `SnapEngine::query` with the active mode-mask.
    fn update_snap(&mut self) {
        if self.snap_modes.is_empty() {
            self.current_snap = None;
            return;
        }
        // Only show snap markers while a tool that actually consumes a
        // precise world-point is active. In Select / Pan / Zoom modes
        // the cursor is conceptually "looking", not "picking" — flashing
        // End/Mid/Cen markers on every hover is noisy and was reported
        // as overwhelming. User: "Alleen maar als je bijvoorbeeld een
        // measure functie gebruikt. Maar als ik gewoon hover over de
        // canvas, moet er helemaal geen snap ontstaan."
        let tool_needs_snap = matches!(
            self.tool_mode,
            ToolMode::Measure
                | ToolMode::Dimension
                | ToolMode::Area
                | ToolMode::Move
                | ToolMode::Rotate
                | ToolMode::Scale
                | ToolMode::Mirror
                | ToolMode::ZoomRegion
        );
        if !tool_needs_snap {
            self.current_snap = None;
            return;
        }
        let Some(cursor) = self.cursor_world else {
            self.current_snap = None;
            return;
        };
        let tab_idx = self.focused_tab_idx();
        let rect = self.focused_canvas_rect();
        let tolerance_world = {
            let cam = match self.tabs.get(tab_idx) {
                Some(t) => t.cam,
                None => { self.current_snap = None; return; }
            };
            let wpp = self.world_per_pixel_in(&cam, rect);
            let sf = self.window.as_ref()
                .map(|w| w.scale_factor() as f64).unwrap_or(1.0);
            (8.0 * sf) * wpp
        };
        let Some(tab) = self.tabs.get_mut(tab_idx) else {
            self.current_snap = None;
            return;
        };
        tab.ensure_scene_index();
        tab.ensure_snap_segments();
        let modes = self.snap_modes;
        let result: Option<SnapResult> = match (
            tab.scene_index.as_ref(),
            tab.snap_segments.as_ref(),
        ) {
            (Some(si), Some(segs)) => {
                let ctx = SnapContext {
                    index: &si.seg_rtree,
                    segments: segs.as_slice(),
                    modes,
                    tolerance_world,
                    last_pick: None,
                    ortho_anchor: None,
                    polar_increment_deg: 45.0,
                    key_points: &[],
                    grid_size: 100.0,
                };
                SnapEngine::query(cursor, &ctx)
            }
            _ => {
                // No scene yet â€” still allow Origin snap.
                if modes.contains_mode(SnapMode::Origin) {
                    let dx = cursor[0]; let dy = cursor[1];
                    if dx * dx + dy * dy <= tolerance_world * tolerance_world {
                        Some(SnapResult {
                            point: [0.0, 0.0],
                            kind: SnapMode::Origin,
                            source_eid: None,
                            source_angle: None,
                        })
                    } else { None }
                } else { None }
            }
        };
        self.current_snap = result;
    }

    /// Effective click point â€” returns the snap point when a snap is
    /// active, otherwise the raw world cursor.
    fn effective_click_point(&self) -> Option<[f64; 2]> {
        if let Some(snap) = self.current_snap.as_ref() {
            return Some(snap.point);
        }
        self.cursor_world
    }

    /// Is the mouse currently over the active canvas rect (not on a panel)?
    fn mouse_in_canvas(&self) -> bool {
        let (cx, cy, cw, ch) = self.canvas_rect;
        let (mx, my) = self.mouse_pos;
        mx >= cx && mx < cx + cw && my >= cy && my < cy + ch
    }

    /// Is the cursor inside the view-cube widget?
    ///
    /// View-cube is painted via an egui Area anchored RIGHT_BOTTOM with
    /// offset (-20, -36) and size (92, 92) in LOGICAL pixels. We carve
    /// it out from the canvas-press path so a click on the cube doesn't
    /// also fire a canvas pick. See `paint_view_cube` for the source.
    fn mouse_in_view_cube(&self) -> bool {
        let Some(win) = self.window.as_ref() else { return false; };
        let ppp = win.scale_factor() as f32;
        let isz = win.inner_size();
        let cube_w = 92.0 * ppp;
        let cube_h = 92.0 * ppp;
        let off_x = 20.0 * ppp;
        let off_y = 36.0 * ppp;
        let cube_x = isz.width as f32 - off_x - cube_w;
        let cube_y = isz.height as f32 - off_y - cube_h;
        let (mx, my) = self.mouse_pos;
        mx >= cube_x && mx <= cube_x + cube_w && my >= cube_y && my <= cube_y + cube_h
    }

    /// Convert screen-pixel â†’ world coords using an explicit tab + rect.
    /// Use this when you need to pick geometry in a specific pane (e.g. the
    /// focused half of a split view). The rect must be in PHYSICAL pixels
    /// (matching `mouse_pos` from winit's CursorMoved).
    fn screen_to_world_in(
        &self,
        tab_idx: usize,
        rect: (f32, f32, f32, f32),
        sx_px: f32,
        sy_px: f32,
    ) -> Option<[f64; 2]> {
        let tab = self.tabs.get(tab_idx)?;
        let (cx, cy, cw, ch) = rect;
        let centre_x = cx + cw * 0.5;
        let centre_y = cy + ch * 0.5;
        let dx_px = (sx_px - centre_x) as f64;
        let dy_px = (sy_px - centre_y) as f64;
        let wpp = self.world_per_pixel_in(&tab.cam, rect);
        // Screen-space delta with Y pointing UP (flip winit's Y-down).
        let ex = dx_px * wpp;
        let ey = -dy_px * wpp;
        // Invert camera rotation to map the screen-space offset back to
        // world-space BEFORE pan+origin. The forward transform rotates
        // world â†’ screen by +rotation; inverse rotates by -rotation.
        let th = tab.cam.rotation;
        let (ct, st) = (th.cos(), th.sin());
        let wx_off =  ct * ex + st * ey;
        let wy_off = -st * ex + ct * ey;
        let wx = tab.cam.pan_x + wx_off + tab.cam.origin[0];
        let wy = tab.cam.pan_y + wy_off + tab.cam.origin[1];
        Some([wx, wy])
    }

    /// Convert screen-pixel â†’ world coords for the active tab using the
    /// full canvas rect. Kept for legacy callers that haven't been ported
    /// to the `_in` variant yet (pan drag, zoom-at-cursor).
    #[allow(dead_code)]
    fn screen_to_world(&self, sx_px: f32, sy_px: f32) -> Option<[f64; 2]> {
        self.screen_to_world_in(self.active_tab, self.canvas_rect, sx_px, sy_px)
    }

    fn point_segment_dist2(p: [f64; 2], a: [f64; 2], b: [f64; 2]) -> f64 {
        let vx = b[0] - a[0];
        let vy = b[1] - a[1];
        let wx = p[0] - a[0];
        let wy = p[1] - a[1];
        let c1 = vx * wx + vy * wy;
        if c1 <= 0.0 { return wx * wx + wy * wy; }
        let c2 = vx * vx + vy * vy;
        if c2 <= c1 { let dx = p[0]-b[0]; let dy = p[1]-b[1]; return dx*dx+dy*dy; }
        let t = c1 / c2;
        let qx = a[0] + t * vx;
        let qy = a[1] + t * vy;
        let dx = p[0] - qx;
        let dy = p[1] - qy;
        dx * dx + dy * dy
    }

    /// Hit-test segments in a specific tab against a screen pixel, using
    /// that pane's own canvas rect (physical px) for coordinate mapping.
    /// Used for split-view picks where the focused half isn't necessarily
    /// `active_tab` and uses a sub-rect instead of the full canvas.
    fn pick_segment_at_in(
        &mut self,
        tab_idx: usize,
        rect: (f32, f32, f32, f32),
        sx_px: f32,
        sy_px: f32,
        pick_radius_px: f32,
    ) -> Option<usize> {
        // World-space pick params have to be computed before the &mut borrow
        // for `ensure_scene_index`, since both `world_per_pixel_in` and
        // `screen_to_world_in` borrow `self` immutably.
        let (wpp, p) = {
            let tab = self.tabs.get(tab_idx)?;
            if tab.scene.segments.is_empty() { return None; }
            let wpp = self.world_per_pixel_in(&tab.cam, rect);
            let p = self.screen_to_world_in(tab_idx, rect, sx_px, sy_px)?;
            (wpp, p)
        };
        let pick_r = pick_radius_px as f64 * wpp;
        let pick_r2 = pick_r * pick_r;

        // Lazy spatial index â€” built once per scene-load.
        if let Some(tab) = self.tabs.get_mut(tab_idx) { tab.ensure_scene_index(); }
        let tab = self.tabs.get(tab_idx)?;
        let hidden = &tab.hidden_layers;
        let want_paper = tab.show_paper;
        let mut best: Option<(usize, f64)> = None;

        let candidates: Vec<u32> = match tab.scene_index.as_ref() {
            Some(idx) => idx.seg_rtree.query_point([p[0], p[1]], pick_r),
            None => {
                // Empty scene fallback â€” nothing to scan anyway.
                Vec::new()
            }
        };
        let n_text_slots = tab.scene.entity_text.len();
        for ci in candidates {
            let i = ci as usize;
            let Some(s) = tab.scene.segments.get(i) else { continue; };
            if s.is_paper != want_paper { continue; }
            // Skip text-glyph tessellation segments — text is render-
            // only in Viewer/Studio. Selecting a single glyph stroke
            // out of a paragraph adds no value and pushing them
            // through the picker bloats the candidate list.
            if let Some(&eid) = tab.scene.segment_entity_idx.get(i) {
                let idx = eid as usize;
                if idx < n_text_slots && tab.scene.entity_text[idx].is_some() {
                    continue;
                }
            }
            let layer_key = layer_key_for_color(s.color);
            if hidden.contains(&layer_key) { continue; }
            let d2 = Self::point_segment_dist2(p, s.p1, s.p2);
            if d2 > pick_r2 { continue; }
            match best {
                None => best = Some((i, d2)),
                Some((_, bd2)) if d2 < bd2 => best = Some((i, d2)),
                _ => {}
            }
        }
        best.map(|(i, _)| i)
    }

    #[allow(dead_code)]
    fn pick_segment_at(&mut self, sx_px: f32, sy_px: f32, pick_radius_px: f32) -> Option<usize> {
        self.pick_segment_at_in(self.active_tab, self.canvas_rect, sx_px, sy_px, pick_radius_px)
    }

    /// Drag-box select. Window mode (left â†’ right drag) keeps only entities
    /// whose every segment lies fully inside the rect. Crossing mode
    /// (right â†’ left drag) keeps any entity whose AABB intersects the rect
    /// or whose any segment endpoint falls inside. Respects `additive`
    /// (Shift/Ctrl during release) â€” if true, picked entities are added to
    /// the existing selection instead of replacing it.
    fn commit_drag_box_select(
        &mut self,
        tab_idx: usize,
        rect: (f32, f32, f32, f32),
        additive: bool,
    ) {
        // World-space rect from press â†’ release.
        let Some(p_press) = self.screen_to_world_in(
            tab_idx, rect, self.lmb_press_pos.0, self.lmb_press_pos.1
        ) else { return; };
        let Some(p_rel) = self.screen_to_world_in(
            tab_idx, rect, self.mouse_pos.0, self.mouse_pos.1
        ) else { return; };
        // Direction in SCREEN space defines window vs crossing.
        let crossing = (self.mouse_pos.0 - self.lmb_press_pos.0) < 0.0;
        let xmin = p_press[0].min(p_rel[0]);
        let xmax = p_press[0].max(p_rel[0]);
        let ymin = p_press[1].min(p_rel[1]);
        let ymax = p_press[1].max(p_rel[1]);
        let in_rect = |p: [f64;2]| -> bool {
            p[0] >= xmin && p[0] <= xmax && p[1] >= ymin && p[1] <= ymax
        };
        // Liang-Barsky line-vs-rect test (crossing mode, when neither
        // endpoint is inside but the line might still cross the rect).
        let seg_intersects_rect = |a: [f64;2], b: [f64;2]| -> bool {
            // Quick AABB reject.
            let smin_x = a[0].min(b[0]);
            let smax_x = a[0].max(b[0]);
            let smin_y = a[1].min(b[1]);
            let smax_y = a[1].max(b[1]);
            if smax_x < xmin || smin_x > xmax || smax_y < ymin || smin_y > ymax {
                return false;
            }
            // Liang-Barsky.
            let dx = b[0] - a[0];
            let dy = b[1] - a[1];
            let p = [-dx, dx, -dy, dy];
            let q = [a[0] - xmin, xmax - a[0], a[1] - ymin, ymax - a[1]];
            let mut u1 = 0.0_f64;
            let mut u2 = 1.0_f64;
            for i in 0..4 {
                if p[i].abs() < 1e-12 {
                    if q[i] < 0.0 { return false; }
                } else {
                    let t = q[i] / p[i];
                    if p[i] < 0.0 { if t > u1 { u1 = t; } }
                    else { if t < u2 { u2 = t; } }
                }
            }
            u1 <= u2
        };

        let Some(tab) = self.tabs.get(tab_idx) else { return; };
        let scene = &tab.scene;
        let have_eids = scene.segment_entity_idx.len() == scene.segments.len();

        // Per-entity: track "has any matching seg" and "all visible segs
        // fully inside" (window mode).
        let mut eid_match: HashMap<u32, bool> = HashMap::new();
        let mut eid_all_in: HashMap<u32, bool> = HashMap::new();
        let mut eid_first_seg: HashMap<u32, usize> = HashMap::new();

        let want_paper = tab.show_paper;
        let hidden = &tab.hidden_layers;
        for (i, s) in scene.segments.iter().enumerate() {
            if s.is_paper != want_paper { continue; }
            let layer_key = layer_key_for_color(s.color);
            if hidden.contains(&layer_key) { continue; }
            let eid = if have_eids { scene.segment_entity_idx[i] } else { i as u32 };
            let inside_a = in_rect(s.p1);
            let inside_b = in_rect(s.p2);
            let any_inside = inside_a || inside_b;
            let both_inside = inside_a && inside_b;
            let seg_hits = if crossing {
                any_inside || seg_intersects_rect(s.p1, s.p2)
            } else {
                both_inside
            };
            // For window mode the entity counts only when every seg of it
            // is fully inside. Track that with eid_all_in.
            let all_in_entry = eid_all_in.entry(eid).or_insert(true);
            if !both_inside { *all_in_entry = false; }
            if seg_hits {
                eid_match.insert(eid, true);
                eid_first_seg.entry(eid).or_insert(i);
            }
        }

        let mut new_picks: Vec<usize> = Vec::new();
        for (eid, hit) in eid_match {
            if !hit { continue; }
            // Window mode: drop entities that have any segment outside.
            if !crossing && !eid_all_in.get(&eid).copied().unwrap_or(false) {
                continue;
            }
            if let Some(&seg_idx) = eid_first_seg.get(&eid) {
                new_picks.push(seg_idx);
            }
        }
        new_picks.sort();
        new_picks.dedup();
        if let Some(tab) = self.tabs.get_mut(tab_idx) {
            if !additive { tab.selection.clear(); }
            // De-dup against existing additive selection.
            for sp in new_picks {
                let target_eid = if have_eids {
                    tab.scene.segment_entity_idx.get(sp).copied()
                } else { Some(sp as u32) };
                let already = tab.selection.iter().any(|&i| {
                    if have_eids {
                        tab.scene.segment_entity_idx.get(i).copied() == target_eid
                    } else { i == sp }
                });
                if !already { tab.selection.push(sp); }
            }
        }
        if let Some(gpu) = self.gpu.as_ref() {
            rebuild_sel_pipe(self.tabs.get_mut(tab_idx), gpu);
        }
    }

    /// Resolve the multi-select segment-list to a sorted-unique set of
    /// entity ids. Returns empty when nothing is selected, or when the
    /// scene's per-segment entity table is missing/mismatched.
    fn selected_entity_ids_in(&self, tab_idx: usize) -> Vec<u32> {
        let Some(tab) = self.tabs.get(tab_idx) else { return Vec::new(); };
        if tab.selection.is_empty() { return Vec::new(); }
        if tab.scene.segment_entity_idx.len() != tab.scene.segments.len() {
            return Vec::new();
        }
        let mut out: Vec<u32> = tab.selection.iter()
            .filter_map(|&i| tab.scene.segment_entity_idx.get(i).copied())
            .collect();
        out.sort();
        out.dedup();
        out
    }

    /// Cheap O(n_sel) count of unique selected entity ids â€” no Vec alloc,
    /// no sort. Used by status-bar + properties-panel labels which read
    /// this every frame; the full Vec from `selected_entity_ids_in` was
    /// being rebuilt + sorted just to call `.len()` on it.
    fn selected_entity_count_in(&self, tab_idx: usize) -> usize {
        let Some(tab) = self.tabs.get(tab_idx) else { return 0; };
        if tab.selection.is_empty() { return 0; }
        if tab.scene.segment_entity_idx.len() != tab.scene.segments.len() {
            return 0;
        }
        // Tab selection lists are small (typically <50 picks even after a
        // generous drag-box). For huge selections (Ctrl+A on 113k entities)
        // we'd want a HashSet, but at that scale the cost is dominated by
        // the GPU sel_pipe rebuild, not this counter. Linear scan with
        // last-seen comparison handles the common case.
        let mut count = 0usize;
        let mut last: Option<u32> = None;
        let mut seen: Option<std::collections::HashSet<u32>> = None;
        for &i in tab.selection.iter() {
            let Some(&eid) = tab.scene.segment_entity_idx.get(i) else { continue; };
            // Adjacent same-eid runs (most common: a drag-box hits all
            // segments of one polyline in order) â€” no allocation.
            if Some(eid) == last { continue; }
            // Promote to HashSet only when we've seen enough distinct
            // ids to outweigh the O(n) linear-set cost.
            if let Some(set) = seen.as_mut() {
                if set.insert(eid) { count += 1; }
            } else {
                count += 1;
                if count >= 8 {
                    // Move what we've counted into a HashSet for the rest.
                    let mut s = std::collections::HashSet::with_capacity(tab.selection.len());
                    for &j in tab.selection.iter() {
                        if let Some(&e2) = tab.scene.segment_entity_idx.get(j) {
                            s.insert(e2);
                        }
                    }
                    count = s.len();
                    seen = Some(s);
                    last = Some(eid);
                    continue;
                }
            }
            last = Some(eid);
        }
        count
    }

    #[allow(dead_code)]
    fn selected_entity_ids(&self) -> Vec<u32> {
        self.selected_entity_ids_in(self.active_tab)
    }

    /// Back-compat shim: first selected entity id, if any. Used by the
    /// legacy single-entity Move drag path.
    #[allow(dead_code)]
    fn selected_entity_idx_in(&self, tab_idx: usize) -> Option<u32> {
        self.selected_entity_ids_in(tab_idx).into_iter().next()
    }

    #[allow(dead_code)]
    fn apply_move_delta_in(&mut self, tab_idx: usize, eid: u32, dx: f64, dy: f64) {
        self.apply_move_delta_multi_in(tab_idx, &[eid], dx, dy);
    }

    /// Translate every fragment whose entity_idx is in `eids` by (dx, dy).
    /// Builds a HashSet first so the inner loop stays O(n_segments) for
    /// many-eid drags.
    fn apply_move_delta_multi_in(&mut self, tab_idx: usize, eids: &[u32], dx: f64, dy: f64) {
        if eids.is_empty() { return; }
        let Some(tab) = self.tabs.get_mut(tab_idx) else { return; };
        let have_seg_ids = tab.scene.segment_entity_idx.len() == tab.scene.segments.len();
        let have_tri_ids = tab.scene.triangle_entity_idx.len() == tab.scene.triangles.len();
        let id_set: HashSet<u32> = eids.iter().copied().collect();
        if have_seg_ids {
            for (i, s) in tab.scene.segments.iter_mut().enumerate() {
                if !id_set.contains(&tab.scene.segment_entity_idx[i]) { continue; }
                s.p1[0] += dx; s.p1[1] += dy;
                s.p2[0] += dx; s.p2[1] += dy;
            }
        }
        if have_tri_ids {
            for (i, t) in tab.scene.triangles.iter_mut().enumerate() {
                if !id_set.contains(&tab.scene.triangle_entity_idx[i]) { continue; }
                for v in t.v.iter_mut() {
                    v[0] += dx; v[1] += dy;
                }
            }
        }
    }

    fn reupload_tab_buffers(&mut self, tab_idx: usize) {
        let Some(gpu) = self.gpu.as_ref() else { return; };
        if let Some(tab) = self.tabs.get_mut(tab_idx) {
            tab.rebuild_buffers(gpu);
        }
    }

    /// Begin an interactive text-edit session for `eid` in `tab_idx`. No-op
    /// if the entity has no `EntityText`. Snapshots the current `raw` into
    /// both `buffer` (mutated by the overlay/key handler) and
    /// `last_committed` (used to revert on cancel).
    fn enter_text_edit(&mut self, tab_idx: usize, eid: u32) {
        let Some(tab) = self.tabs.get(tab_idx) else { return; };
        let Some(et) = tab.scene.entity_text.get(eid as usize).and_then(|o| o.as_ref()) else {
            return;
        };
        self.edit_mode = Some(EditTextState {
            tab_idx,
            eid,
            buffer: et.raw.clone(),
            last_committed: et.raw.clone(),
            debounce_at: None,
        });
    }

    /// Drop the current edit session without recording undo. If the live
    /// preview already mutated the rendered glyphs (debounce path, Task
    /// 10), re-tessellate back to `last_committed` so the cancel really
    /// erases the in-flight changes.
    fn cancel_text_edit(&mut self) {
        if let Some(state) = self.edit_mode.take() {
            // If buffer was modified mid-typing, restore via re_tessellate
            // to last_committed so the rendered glyphs match the original.
            if state.buffer != state.last_committed {
                if let Some(tab) = self.tabs.get_mut(state.tab_idx) {
                    let _ = crate::scene_io::re_tessellate_text_entity(
                        &mut tab.scene, state.eid, &state.last_committed,
                    );
                    self.reupload_tab_buffers(state.tab_idx);
                }
            }
        }
    }

    /// Commit the in-flight buffer: re-tessellate the entity, push an
    /// `EditOp::EditText` for undo, and refresh GPU buffers. No-op when
    /// the buffer matches the last committed text (no real change).
    fn commit_text_edit(&mut self) {
        let Some(state) = self.edit_mode.take() else { return; };
        if state.buffer == state.last_committed {
            return;  // no-op
        }
        let tab_idx = state.tab_idx;
        if let Some(tab) = self.tabs.get_mut(tab_idx) {
            match crate::scene_io::re_tessellate_text_entity(
                &mut tab.scene, state.eid, &state.buffer,
            ) {
                Ok(delta) => {
                    push_undo(&mut tab.undo_stack, EditOp::EditText { text_delta: delta });
                    self.reupload_tab_buffers(tab_idx);
                }
                Err(e) => eprintln!("[text-edit] commit failed: {}", e),
            }
        }
    }

    #[allow(dead_code)]
    fn reupload_active_buffers(&mut self) {
        self.reupload_tab_buffers(self.active_tab);
    }

    fn commit_move_in(&mut self, tab_idx: usize, eid: u32, dx: f64, dy: f64) {
        self.commit_move_multi_in(tab_idx, vec![eid], dx, dy);
    }

    /// Commit a multi-entity translation: mutate scene, rebuild GPU buffers,
    /// push a single Move EditOp covering the whole batch.
    fn commit_move_multi_in(&mut self, tab_idx: usize, eids: Vec<u32>, dx: f64, dy: f64) {
        if dx == 0.0 && dy == 0.0 {
            if let Some(tab) = self.tabs.get_mut(tab_idx) {
                tab.pending_move_offset = [0.0, 0.0];
            }
            return;
        }
        if eids.is_empty() { return; }
        self.apply_move_delta_multi_in(tab_idx, &eids, dx, dy);
        self.reupload_tab_buffers(tab_idx);
        if let Some(tab) = self.tabs.get_mut(tab_idx) {
            push_undo(&mut tab.undo_stack, EditOp::Move { eids, delta: [dx, dy] });
            tab.pending_move_offset = [0.0, 0.0];
        }
        if let Some(gpu) = self.gpu.as_ref() {
            rebuild_sel_pipe(self.tabs.get_mut(tab_idx), gpu);
        }
    }

    #[allow(dead_code)]
    fn commit_move(&mut self, eid: u32, dx: f64, dy: f64) {
        self.commit_move_in(self.active_tab, eid, dx, dy);
    }

    // ---------------------------------------------------------------
    // Blok 3 â€” Rotate / Scale / Mirror.
    //
    // Same mutate-in-place pattern as apply_move_delta_multi_in: walk
    // segment_entity_idx / triangle_entity_idx once, apply the transform
    // to fragments whose entity_idx is in the eid set.
    // ---------------------------------------------------------------
    fn apply_rotate_in(&mut self, tab_idx: usize, eids: &[u32], pivot: [f64; 2], angle: f64) {
        if eids.is_empty() { return; }
        let Some(tab) = self.tabs.get_mut(tab_idx) else { return; };
        let have_seg_ids = tab.scene.segment_entity_idx.len() == tab.scene.segments.len();
        let have_tri_ids = tab.scene.triangle_entity_idx.len() == tab.scene.triangles.len();
        let id_set: HashSet<u32> = eids.iter().copied().collect();
        let c = angle.cos();
        let s = angle.sin();
        let rot = |p: [f64; 2]| -> [f64; 2] {
            let dx = p[0] - pivot[0];
            let dy = p[1] - pivot[1];
            [pivot[0] + c * dx - s * dy, pivot[1] + s * dx + c * dy]
        };
        if have_seg_ids {
            for (i, seg) in tab.scene.segments.iter_mut().enumerate() {
                if !id_set.contains(&tab.scene.segment_entity_idx[i]) { continue; }
                seg.p1 = rot(seg.p1);
                seg.p2 = rot(seg.p2);
            }
        }
        if have_tri_ids {
            for (i, t) in tab.scene.triangles.iter_mut().enumerate() {
                if !id_set.contains(&tab.scene.triangle_entity_idx[i]) { continue; }
                for v in t.v.iter_mut() {
                    *v = rot(*v);
                }
            }
        }
    }

    fn apply_scale_in(&mut self, tab_idx: usize, eids: &[u32], pivot: [f64; 2], factor: f64) {
        if eids.is_empty() || !factor.is_finite() || factor == 0.0 { return; }
        let Some(tab) = self.tabs.get_mut(tab_idx) else { return; };
        let have_seg_ids = tab.scene.segment_entity_idx.len() == tab.scene.segments.len();
        let have_tri_ids = tab.scene.triangle_entity_idx.len() == tab.scene.triangles.len();
        let id_set: HashSet<u32> = eids.iter().copied().collect();
        let sc = |p: [f64; 2]| -> [f64; 2] {
            [pivot[0] + factor * (p[0] - pivot[0]),
             pivot[1] + factor * (p[1] - pivot[1])]
        };
        if have_seg_ids {
            for (i, seg) in tab.scene.segments.iter_mut().enumerate() {
                if !id_set.contains(&tab.scene.segment_entity_idx[i]) { continue; }
                seg.p1 = sc(seg.p1);
                seg.p2 = sc(seg.p2);
            }
        }
        if have_tri_ids {
            for (i, t) in tab.scene.triangles.iter_mut().enumerate() {
                if !id_set.contains(&tab.scene.triangle_entity_idx[i]) { continue; }
                for v in t.v.iter_mut() {
                    *v = sc(*v);
                }
            }
        }
    }

    fn apply_mirror_in(&mut self, tab_idx: usize, eids: &[u32], a: [f64; 2], b: [f64; 2]) {
        if eids.is_empty() { return; }
        let dx = b[0] - a[0];
        let dy = b[1] - a[1];
        let len2 = dx * dx + dy * dy;
        if len2 < 1e-12 { return; } // degenerate axis â€” no-op
        let Some(tab) = self.tabs.get_mut(tab_idx) else { return; };
        let have_seg_ids = tab.scene.segment_entity_idx.len() == tab.scene.segments.len();
        let have_tri_ids = tab.scene.triangle_entity_idx.len() == tab.scene.triangles.len();
        let id_set: HashSet<u32> = eids.iter().copied().collect();
        let mir = |p: [f64; 2]| -> [f64; 2] {
            let t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2;
            let foot = [a[0] + t * dx, a[1] + t * dy];
            [2.0 * foot[0] - p[0], 2.0 * foot[1] - p[1]]
        };
        if have_seg_ids {
            for (i, seg) in tab.scene.segments.iter_mut().enumerate() {
                if !id_set.contains(&tab.scene.segment_entity_idx[i]) { continue; }
                seg.p1 = mir(seg.p1);
                seg.p2 = mir(seg.p2);
            }
        }
        if have_tri_ids {
            for (i, t) in tab.scene.triangles.iter_mut().enumerate() {
                if !id_set.contains(&tab.scene.triangle_entity_idx[i]) { continue; }
                for v in t.v.iter_mut() {
                    *v = mir(*v);
                }
                // Reflection flips winding â€” swap v[1] and v[2] so fill
                // orientation stays consistent with the rest of the scene.
                t.v.swap(1, 2);
            }
        }
    }

    /// Commit a Rotate: mutate scene, rebuild GPU buffers, push undo op.
    fn commit_rotate_in(&mut self, tab_idx: usize, eids: Vec<u32>, pivot: [f64; 2], angle: f64) {
        if eids.is_empty() { return; }
        if angle.abs() < 1e-9 { return; }
        self.apply_rotate_in(tab_idx, &eids, pivot, angle);
        self.reupload_tab_buffers(tab_idx);
        if let Some(tab) = self.tabs.get_mut(tab_idx) {
            push_undo(&mut tab.undo_stack, EditOp::Rotate { eids, pivot, angle });
        }
        if let Some(gpu) = self.gpu.as_ref() {
            rebuild_sel_pipe(self.tabs.get_mut(tab_idx), gpu);
        }
    }

    /// Commit a Scale (uniform only for now).
    fn commit_scale_in(&mut self, tab_idx: usize, eids: Vec<u32>, pivot: [f64; 2], factor: f64) {
        if eids.is_empty() { return; }
        if !factor.is_finite() || (factor - 1.0).abs() < 1e-9 { return; }
        if factor <= 0.0 { return; }
        self.apply_scale_in(tab_idx, &eids, pivot, factor);
        self.reupload_tab_buffers(tab_idx);
        if let Some(tab) = self.tabs.get_mut(tab_idx) {
            push_undo(&mut tab.undo_stack, EditOp::Scale { eids, pivot, factor });
        }
        if let Some(gpu) = self.gpu.as_ref() {
            rebuild_sel_pipe(self.tabs.get_mut(tab_idx), gpu);
        }
    }

    /// Commit a Mirror.
    fn commit_mirror_in(&mut self, tab_idx: usize, eids: Vec<u32>, a: [f64; 2], b: [f64; 2]) {
        if eids.is_empty() { return; }
        let dx = b[0] - a[0]; let dy = b[1] - a[1];
        if dx * dx + dy * dy < 1e-12 { return; }
        self.apply_mirror_in(tab_idx, &eids, a, b);
        self.reupload_tab_buffers(tab_idx);
        if let Some(tab) = self.tabs.get_mut(tab_idx) {
            push_undo(&mut tab.undo_stack, EditOp::Mirror { eids, axis_a: a, axis_b: b });
        }
        if let Some(gpu) = self.gpu.as_ref() {
            rebuild_sel_pipe(self.tabs.get_mut(tab_idx), gpu);
        }
    }

    /// Duplicate selected entities into fresh ids with a small offset.
    /// Reuses the Paste undo variant â€” semantics are identical.
    /// Future work: a dedicated two-click "source â†’ destination" Copy tool.
    fn duplicate_selected_in(&mut self, tab_idx: usize) {
        let eids = self.selected_entity_ids_in(tab_idx);
        if eids.is_empty() { return; }
        let snapshot = self.snapshot_entities_in(tab_idx, &eids);
        if snapshot.is_empty() { return; }
        // Fresh ids after current max.
        let next_id_start = self.tabs.get(tab_idx).map(|t| {
            let from_segs = t.scene.segment_entity_idx.iter().copied().max().unwrap_or(0);
            let from_tris = t.scene.triangle_entity_idx.iter().copied().max().unwrap_or(0);
            from_segs.max(from_tris).wrapping_add(1)
        }).unwrap_or(0);
        let (dx, dy) = self.tabs.get(tab_idx).map(|t| {
            let b = t.scene.bbox;
            let w = (b[2] - b[0]).abs().max(1.0);
            let h = (b[3] - b[1]).abs().max(1.0);
            let d = (w * w + h * h).sqrt();
            (d * 0.05, d * 0.05)
        }).unwrap_or((0.0, 0.0));
        let mut new_eids: Vec<u32> = Vec::with_capacity(snapshot.len());
        let mut shifted: Vec<DeletedEntity> = Vec::with_capacity(snapshot.len());
        for (i, src) in snapshot.into_iter().enumerate() {
            let new_eid = next_id_start.wrapping_add(i as u32);
            new_eids.push(new_eid);
            let mut segs = src.segments.clone();
            for (s, _) in segs.iter_mut() {
                s.p1[0] += dx; s.p1[1] += dy;
                s.p2[0] += dx; s.p2[1] += dy;
            }
            let mut tris = src.triangles.clone();
            for (t, _) in tris.iter_mut() {
                for v in t.v.iter_mut() { v[0] += dx; v[1] += dy; }
            }
            shifted.push(DeletedEntity {
                entity_idx: new_eid,
                name: src.name,
                segments: segs,
                triangles: tris,
            });
        }
        self.reinsert_entities_in(tab_idx, &shifted);
        if let Some(tab) = self.tabs.get_mut(tab_idx) {
            push_undo(&mut tab.undo_stack, EditOp::Paste { new_eids: new_eids.clone() });
            // Select the freshly-duplicated entities.
            tab.selection.clear();
            if tab.scene.segment_entity_idx.len() == tab.scene.segments.len() {
                let id_set: HashSet<u32> = new_eids.iter().copied().collect();
                for (i, eid) in tab.scene.segment_entity_idx.iter().enumerate() {
                    if id_set.contains(eid) {
                        tab.selection.push(i);
                    }
                }
            }
        }
    }

    /// Pop the most recent EditOp off the active tab's stack and invert it.
    /// Move â†’ translate by -delta; Delete â†’ re-insert; Paste â†’ delete the
    /// pasted ids. Triggers a GPU rebuild + selection clear (selection
    /// indices may now point at stale segments after a structural change).
    fn undo_last_edit(&mut self) {
        let tab_idx = self.active_tab;
        let pop = self.tabs.get_mut(tab_idx).and_then(|t| t.undo_stack.pop());
        let Some(op) = pop else { return; };
        match op {
            EditOp::Move { eids, delta } => {
                self.apply_move_delta_multi_in(tab_idx, &eids, -delta[0], -delta[1]);
                self.reupload_tab_buffers(tab_idx);
            }
            EditOp::Delete { entities } => {
                self.reinsert_entities_in(tab_idx, &entities);
                self.reupload_tab_buffers(tab_idx);
            }
            EditOp::Paste { new_eids } => {
                self.delete_entities_in_inner(tab_idx, &new_eids, false);
                self.reupload_tab_buffers(tab_idx);
            }
            // Blok 3 â€” inverse transforms.
            EditOp::Rotate { eids, pivot, angle } => {
                self.apply_rotate_in(tab_idx, &eids, pivot, -angle);
                self.reupload_tab_buffers(tab_idx);
            }
            EditOp::Scale { eids, pivot, factor } => {
                if factor != 0.0 && factor.is_finite() {
                    self.apply_scale_in(tab_idx, &eids, pivot, 1.0 / factor);
                    self.reupload_tab_buffers(tab_idx);
                }
            }
            EditOp::Mirror { eids, axis_a, axis_b } => {
                // Mirror twice == identity, so we just re-apply the same axis.
                self.apply_mirror_in(tab_idx, &eids, axis_a, axis_b);
                self.reupload_tab_buffers(tab_idx);
            }
            EditOp::EditText { text_delta } => {
                if let Some(tab) = self.tabs.get_mut(tab_idx) {
                    let _ = crate::scene_io::restore_text_entity(&mut tab.scene, &text_delta);
                }
                self.reupload_tab_buffers(tab_idx);
            }
            EditOp::LayerDelete { layer_name, was_hidden_before } => {
                if let Some(tab) = self.tabs.get_mut(tab_idx) {
                    tab.deleted_layers.remove(&layer_name);
                    if !was_hidden_before {
                        tab.hidden_layers.remove(&layer_name);
                    }
                    tab.cached_layer_list = None;
                    tab.cached_structure_tree = None;
                }
                self.reupload_tab_buffers(tab_idx);
            }
        }
        // Selection may now point at relocated segments â€” safest to clear.
        if let Some(tab) = self.tabs.get_mut(tab_idx) {
            tab.selection.clear();
            tab.hover = None;
        }
        if let Some(gpu) = self.gpu.as_ref() {
            rebuild_sel_pipe(self.tabs.get_mut(tab_idx), gpu);
        }
    }

    /// Legacy alias kept so the Ctrl+Z handler still compiles unchanged.
    #[allow(dead_code)]
    fn undo_last_move(&mut self) { self.undo_last_edit(); }

    /// Capture (segments + triangles + per-fragment layer ids + entity name)
    /// for every entity in `eids`. Used as input to both Delete and Copy.
    /// Order in the returned Vec follows the order of `eids`.
    fn snapshot_entities_in(&self, tab_idx: usize, eids: &[u32]) -> Vec<DeletedEntity> {
        let Some(tab) = self.tabs.get(tab_idx) else { return Vec::new(); };
        let scene = &tab.scene;
        let have_seg_ids = scene.segment_entity_idx.len() == scene.segments.len();
        let have_tri_ids = scene.triangle_entity_idx.len() == scene.triangles.len();
        let have_seg_layers = scene.segment_layer_idx.len() == scene.segments.len();
        let have_tri_layers = scene.triangle_layer_idx.len() == scene.triangles.len();
        let mut out: Vec<DeletedEntity> = Vec::with_capacity(eids.len());
        for &eid in eids {
            let mut segs: Vec<(Segment, u16)> = Vec::new();
            let mut tris: Vec<(Triangle, u16)> = Vec::new();
            if have_seg_ids {
                for (i, s) in scene.segments.iter().enumerate() {
                    if scene.segment_entity_idx[i] != eid { continue; }
                    let li = if have_seg_layers { scene.segment_layer_idx[i] } else { u16::MAX };
                    segs.push((*s, li));
                }
            }
            if have_tri_ids {
                for (i, t) in scene.triangles.iter().enumerate() {
                    if scene.triangle_entity_idx[i] != eid { continue; }
                    let li = if have_tri_layers { scene.triangle_layer_idx[i] } else { u16::MAX };
                    tris.push((*t, li));
                }
            }
            let name = scene.entity_names.get(eid as usize).cloned();
            out.push(DeletedEntity { entity_idx: eid, name, segments: segs, triangles: tris });
        }
        out
    }

    /// "Explode" every INSERT entity in `eids`: for each entity whose
    /// `entity_names[i]` starts with `INSERT`, walk its segments and
    /// triangles and reassign each one to a freshly-minted entity_idx
    /// with a derived name (`EXPLODED <orig> #N`). After this, the
    /// previously-grouped block geometry can be selected piece by piece.
    ///
    /// Returns the number of source INSERTs that were exploded. Non-
    /// INSERT entries in `eids` are ignored so the caller can pass a
    /// raw selection without pre-filtering.
    ///
    /// Geometry is **not** transformed -- the scene-loader already
    /// applied the INSERT's translation + rotation + scale when it
    /// tessellated the block, so the world-space positions are already
    /// correct. We only relabel the parallel `*_entity_idx` arrays.
    fn explode_inserts_in(&mut self, tab_idx: usize, eids: &[u32]) -> usize {
        if eids.is_empty() { return 0; }
        let Some(tab) = self.tabs.get_mut(tab_idx) else { return 0; };
        let scene = &mut tab.scene;
        let have_seg_ids = scene.segment_entity_idx.len() == scene.segments.len();
        let have_tri_ids = scene.triangle_entity_idx.len() == scene.triangles.len();
        if !have_seg_ids && !have_tri_ids { return 0; }

        let mut exploded = 0usize;
        for &eid in eids {
            // Only operate on entries whose entity_names start with
            // "INSERT" (case-sensitive -- both loaders emit upper-case).
            let is_insert = scene
                .entity_names
                .get(eid as usize)
                .map(|n| n.starts_with("INSERT"))
                .unwrap_or(false);
            if !is_insert { continue; }
            let orig_name = scene
                .entity_names
                .get(eid as usize)
                .cloned()
                .unwrap_or_else(|| "INSERT".to_string());

            // Snapshot the segment + triangle indices that belong to
            // this INSERT before we mutate anything (so the index loop
            // doesn't see freshly-allocated entity_idx entries).
            let seg_hits: Vec<usize> = if have_seg_ids {
                (0..scene.segments.len())
                    .filter(|&i| scene.segment_entity_idx[i] == eid)
                    .collect()
            } else { Vec::new() };
            let tri_hits: Vec<usize> = if have_tri_ids {
                (0..scene.triangles.len())
                    .filter(|&i| scene.triangle_entity_idx[i] == eid)
                    .collect()
            } else { Vec::new() };
            if seg_hits.is_empty() && tri_hits.is_empty() { continue; }

            // Mint a fresh entity_idx + name per segment. Triangles
            // share their entity_idx with the segment at the same index
            // when one is available (so a HATCH-fill triangle stays
            // grouped with its boundary segment), otherwise they get
            // their own ids.
            for (n, seg_i) in seg_hits.iter().enumerate() {
                let new_eid = scene.entity_names.len() as u32;
                scene.entity_names.push(format!("EXPLODED {} #{}", orig_name, n + 1));
                if scene.entity_text.len() < scene.entity_names.len() {
                    scene.entity_text.resize(scene.entity_names.len(), None);
                }
                scene.segment_entity_idx[*seg_i] = new_eid;
            }
            // Surviving triangles (e.g. solid fill / text glyphs) get
            // one new entity_idx each so the user can pick them apart
            // too.
            for (n, tri_i) in tri_hits.iter().enumerate() {
                let new_eid = scene.entity_names.len() as u32;
                scene.entity_names.push(format!("EXPLODED {} tri#{}", orig_name, n + 1));
                if scene.entity_text.len() < scene.entity_names.len() {
                    scene.entity_text.resize(scene.entity_names.len(), None);
                }
                scene.triangle_entity_idx[*tri_i] = new_eid;
            }
            exploded += 1;
        }

        if exploded > 0 {
            // Invalidate cached structure tree + scene index so the
            // next pick / panel paint reflects the new entity layout.
            tab.cached_structure_tree = None;
            tab.cached_layer_list = None;
            tab.scene_index = None;
            tab.snap_segments = None;
            // Drop the original selection -- the entity ids it points
            // at are now harmless leftovers but no longer reference
            // active geometry.
            tab.selection.clear();
            tab.hover = None;
        }
        exploded
    }

    /// Delete every fragment whose entity_idx is in `eids` from the tab's
    /// scene. When `record_undo`, snapshot first and push a Delete EditOp
    /// so the operation is reversible. Caller is responsible for the GPU
    /// buffer rebuild.
    fn delete_entities_in(&mut self, tab_idx: usize, eids: &[u32]) {
        if eids.is_empty() { return; }
        let snapshot = self.snapshot_entities_in(tab_idx, eids);
        self.delete_entities_in_inner(tab_idx, eids, false);
        if let Some(tab) = self.tabs.get_mut(tab_idx) {
            push_undo(&mut tab.undo_stack, EditOp::Delete { entities: snapshot });
            tab.selection.clear();
            tab.hover = None;
        }
    }

    /// Lockstep filter: drop matching entries from segments, triangles and
    /// their parallel arrays. `_record_undo` is unused â€” callers that want
    /// undo go through `delete_entities_in` which records the snapshot
    /// itself.
    fn delete_entities_in_inner(&mut self, tab_idx: usize, eids: &[u32], _record_undo: bool) {
        if eids.is_empty() { return; }
        let Some(tab) = self.tabs.get_mut(tab_idx) else { return; };
        let id_set: HashSet<u32> = eids.iter().copied().collect();
        let scene = &mut tab.scene;
        let have_seg_ids = scene.segment_entity_idx.len() == scene.segments.len();
        let have_tri_ids = scene.triangle_entity_idx.len() == scene.triangles.len();
        let have_seg_layers = scene.segment_layer_idx.len() == scene.segments.len();
        let have_tri_layers = scene.triangle_layer_idx.len() == scene.triangles.len();

        if have_seg_ids {
            // Build a keep-mask, then filter all parallel arrays in lockstep.
            let n = scene.segments.len();
            let keep: Vec<bool> = (0..n).map(|i|
                !id_set.contains(&scene.segment_entity_idx[i])
            ).collect();
            let mut new_segs: Vec<Segment> = Vec::with_capacity(n);
            let mut new_eids: Vec<u32> = Vec::with_capacity(n);
            let mut new_layers: Vec<u16> = if have_seg_layers { Vec::with_capacity(n) } else { Vec::new() };
            for i in 0..n {
                if !keep[i] { continue; }
                new_segs.push(scene.segments[i]);
                new_eids.push(scene.segment_entity_idx[i]);
                if have_seg_layers { new_layers.push(scene.segment_layer_idx[i]); }
            }
            scene.segments = new_segs;
            scene.segment_entity_idx = new_eids;
            if have_seg_layers { scene.segment_layer_idx = new_layers; }
        }
        if have_tri_ids {
            let n = scene.triangles.len();
            let keep: Vec<bool> = (0..n).map(|i|
                !id_set.contains(&scene.triangle_entity_idx[i])
            ).collect();
            let mut new_tris: Vec<Triangle> = Vec::with_capacity(n);
            let mut new_eids: Vec<u32> = Vec::with_capacity(n);
            let mut new_layers: Vec<u16> = if have_tri_layers { Vec::with_capacity(n) } else { Vec::new() };
            for i in 0..n {
                if !keep[i] { continue; }
                new_tris.push(scene.triangles[i]);
                new_eids.push(scene.triangle_entity_idx[i]);
                if have_tri_layers { new_layers.push(scene.triangle_layer_idx[i]); }
            }
            scene.triangles = new_tris;
            scene.triangle_entity_idx = new_eids;
            if have_tri_layers { scene.triangle_layer_idx = new_layers; }
        }
    }

    /// Re-append a previously-snapshotted entity batch to the tab's scene.
    /// Used by Undo-of-Delete. Entity ids are preserved verbatim; if a
    /// particular entity_idx was reused in the meantime the result is
    /// effectively a "merge into the existing entity", which is benign for
    /// the viewer (the entity just gets more fragments).
    fn reinsert_entities_in(&mut self, tab_idx: usize, entities: &[DeletedEntity]) {
        if entities.is_empty() { return; }
        let Some(tab) = self.tabs.get_mut(tab_idx) else { return; };
        let scene = &mut tab.scene;
        let have_seg_ids = scene.segment_entity_idx.len() == scene.segments.len();
        let have_tri_ids = scene.triangle_entity_idx.len() == scene.triangles.len();
        let have_seg_layers = scene.segment_layer_idx.len() == scene.segments.len();
        let have_tri_layers = scene.triangle_layer_idx.len() == scene.triangles.len();
        for de in entities {
            // Make sure entity_names is long enough for the id.
            if let Some(n) = de.name.as_ref() {
                while scene.entity_names.len() <= de.entity_idx as usize {
                    scene.entity_names.push(String::new());
                }
                if scene.entity_names[de.entity_idx as usize].is_empty() {
                    scene.entity_names[de.entity_idx as usize] = n.clone();
                }
            }
            for (s, li) in &de.segments {
                scene.segments.push(*s);
                if have_seg_ids { scene.segment_entity_idx.push(de.entity_idx); }
                if have_seg_layers && *li != u16::MAX {
                    scene.segment_layer_idx.push(*li);
                } else if have_seg_layers {
                    scene.segment_layer_idx.push(0);
                }
            }
            for (t, li) in &de.triangles {
                scene.triangles.push(*t);
                if have_tri_ids { scene.triangle_entity_idx.push(de.entity_idx); }
                if have_tri_layers && *li != u16::MAX {
                    scene.triangle_layer_idx.push(*li);
                } else if have_tri_layers {
                    scene.triangle_layer_idx.push(0);
                }
            }
        }
    }

    /// Paste the App-level clipboard into the active tab. New entity ids
    /// are minted as max(existing) + 1, 2, â€¦; the clipboard entries are
    /// copied verbatim aside from a small (5% of bbox-diag) translation
    /// so the paste is visibly offset from the source.
    fn paste_clipboard_in(&mut self, tab_idx: usize) {
        if self.clipboard.is_empty() { return; }
        let clip = self.clipboard.clone();
        // Pick fresh entity ids starting after the current max.
        let next_id_start = self.tabs.get(tab_idx).map(|t| {
            let from_segs = t.scene.segment_entity_idx.iter().copied().max().unwrap_or(0);
            let from_tris = t.scene.triangle_entity_idx.iter().copied().max().unwrap_or(0);
            from_segs.max(from_tris).wrapping_add(1)
        }).unwrap_or(0);
        // Visible offset: 5% of bbox diagonal.
        let (dx, dy) = self.tabs.get(tab_idx).map(|t| {
            let b = t.scene.bbox;
            let w = (b[2] - b[0]).abs().max(1.0);
            let h = (b[3] - b[1]).abs().max(1.0);
            let d = (w*w + h*h).sqrt();
            (d * 0.05, d * 0.05)
        }).unwrap_or((0.0, 0.0));
        let mut new_eids: Vec<u32> = Vec::with_capacity(clip.len());
        let mut shifted: Vec<DeletedEntity> = Vec::with_capacity(clip.len());
        for (i, src) in clip.into_iter().enumerate() {
            let new_eid = next_id_start.wrapping_add(i as u32);
            new_eids.push(new_eid);
            let mut segs = src.segments.clone();
            for (s, _) in segs.iter_mut() {
                s.p1[0] += dx; s.p1[1] += dy;
                s.p2[0] += dx; s.p2[1] += dy;
            }
            let mut tris = src.triangles.clone();
            for (t, _) in tris.iter_mut() {
                for v in t.v.iter_mut() { v[0] += dx; v[1] += dy; }
            }
            shifted.push(DeletedEntity {
                entity_idx: new_eid,
                name: src.name,
                segments: segs,
                triangles: tris,
            });
        }
        self.reinsert_entities_in(tab_idx, &shifted);
        if let Some(tab) = self.tabs.get_mut(tab_idx) {
            push_undo(&mut tab.undo_stack, EditOp::Paste { new_eids: new_eids.clone() });
            // Select the freshly-pasted entities so the user sees what landed.
            tab.selection.clear();
            if tab.scene.segment_entity_idx.len() == tab.scene.segments.len() {
                let id_set: HashSet<u32> = new_eids.iter().copied().collect();
                for (i, eid) in tab.scene.segment_entity_idx.iter().enumerate() {
                    if id_set.contains(eid) {
                        tab.selection.push(i);
                    }
                }
            }
        }
    }

    /// Replace selection with one segment-index per unique entity in the
    /// active tab's scene. No-op for empty scenes.
    fn select_all_in(&mut self, tab_idx: usize) {
        let Some(tab) = self.tabs.get_mut(tab_idx) else { return; };
        if tab.scene.segment_entity_idx.len() != tab.scene.segments.len() { return; }
        let mut seen: HashSet<u32> = HashSet::new();
        let mut sel: Vec<usize> = Vec::new();
        for (i, eid) in tab.scene.segment_entity_idx.iter().enumerate() {
            if seen.insert(*eid) {
                sel.push(i);
            }
        }
        tab.selection = sel;
    }

    fn push_recent_file(&mut self, path: &str) {
        self.recent_files.retain(|p| p != path);
        self.recent_files.insert(0, path.to_string());
        self.recent_files.truncate(RECENT_FILES_MAX);
        save_recent_files(&self.recent_files);
    }

    fn fit_active(&mut self) {
        self.push_camera_history();
        if let Some(tab) = self.tabs.get_mut(self.active_tab) {
            tab.cam = PaneCam::fit(&tab.scene.bbox);
        }
    }

    /// Snapshot the active tab's current camera onto `camera_history`
    /// before a destructive change. Trims to `CAMERA_HISTORY_MAX`.
    /// Cheap — `PaneCam` is Copy + small.
    fn push_camera_history(&mut self) {
        let active = self.active_tab;
        let Some(tab) = self.tabs.get(active) else { return; };
        let cam = tab.cam;
        if self.camera_history.len() >= CAMERA_HISTORY_MAX {
            // Drop oldest to maintain cap.
            self.camera_history.remove(0);
        }
        self.camera_history.push((active, cam));
    }

    /// Pop the last camera snapshot and restore it on its source tab.
    /// No-op when the stack is empty. Doesn't itself push (a `Zoom
    /// Previous` then `Zoom Previous` should walk further back, not
    /// loop on the current view).
    fn zoom_previous(&mut self) {
        let Some((tab_idx, cam)) = self.camera_history.pop() else { return; };
        if let Some(tab) = self.tabs.get_mut(tab_idx) {
            tab.cam = cam;
        }
    }

    /// Re-center the active tab's camera on `world` without changing
    /// the zoom level. Used by the View ribbon's Zoom Center button —
    /// the next LMB click on the canvas defines the new center.
    fn zoom_center_on(&mut self, world: [f64; 2]) {
        self.push_camera_history();
        if let Some(tab) = self.tabs.get_mut(self.active_tab) {
            // Reset pan to 0 + move the floating origin to the chosen
            // world point. Keeps `cam.zoom` + rotation intact.
            tab.cam.origin = world;
            tab.cam.pan_x = 0.0;
            tab.cam.pan_y = 0.0;
        }
    }

    /// Re-run the Find query against the active tab. Searches three
    /// corpora: TEXT/MTEXT/ATTRIB content, layer names, entity-name
    /// summaries (the latter carry the DWG/DXF entity handle, e.g.
    /// `LINE h=0xAB`). Match cap = 200 so the dialog stays scrollable.
    fn refresh_find_matches(&mut self) {
        const MAX_MATCHES: usize = 200;
        self.find_matches.clear();
        let q = self.find_query.trim().to_lowercase();
        if q.is_empty() { return; }
        let Some(tab) = self.tabs.get(self.active_tab) else { return; };
        let scene = &tab.scene;
        for name in &scene.layer_names {
            if name.to_lowercase().contains(&q) {
                self.find_matches.push(FindMatch {
                    kind: FindMatchKind::Layer,
                    label: format!("Layer: {}", name),
                    eid: None,
                });
                if self.find_matches.len() >= MAX_MATCHES { return; }
            }
        }
        for (eid, slot) in scene.entity_text.iter().enumerate() {
            if let Some(et) = slot {
                if et.raw.to_lowercase().contains(&q) {
                    let mut preview: String = et.raw.chars().take(80).collect();
                    if et.raw.chars().count() > 80 { preview.push_str("\u{2026}"); }
                    self.find_matches.push(FindMatch {
                        kind: FindMatchKind::Text,
                        label: format!("Text #{}: {}", eid, preview),
                        eid: Some(eid as u32),
                    });
                    if self.find_matches.len() >= MAX_MATCHES { return; }
                }
            }
        }
        for (eid, name) in scene.entity_names.iter().enumerate() {
            if name.to_lowercase().contains(&q) {
                self.find_matches.push(FindMatch {
                    kind: FindMatchKind::EntityName,
                    label: format!("#{}  {}", eid, name),
                    eid: Some(eid as u32),
                });
                if self.find_matches.len() >= MAX_MATCHES { return; }
            }
        }
    }

    /// Select + zoom to the entity referenced by a Find match. Walks
    /// `segment_entity_idx` for the first segment that belongs to that
    /// entity_idx, computes an entity bbox, and fits the camera to it.
    /// No-op when `eid` is None (layer matches).
    fn jump_to_find_match(&mut self, eid: Option<u32>) {
        let Some(eid) = eid else { return; };
        let tab_idx = self.active_tab;
        let Some(tab) = self.tabs.get_mut(tab_idx) else { return; };
        let scene = &tab.scene;
        if scene.segment_entity_idx.len() != scene.segments.len() { return; }
        let mut bb = [f64::INFINITY, f64::INFINITY, f64::NEG_INFINITY, f64::NEG_INFINITY];
        let mut canonical_seg: Option<usize> = None;
        for (i, &e) in scene.segment_entity_idx.iter().enumerate() {
            if e != eid { continue; }
            let s = &scene.segments[i];
            bb[0] = bb[0].min(s.p1[0]).min(s.p2[0]);
            bb[1] = bb[1].min(s.p1[1]).min(s.p2[1]);
            bb[2] = bb[2].max(s.p1[0]).max(s.p2[0]);
            bb[3] = bb[3].max(s.p1[1]).max(s.p2[1]);
            if canonical_seg.is_none() { canonical_seg = Some(i); }
        }
        if scene.triangle_entity_idx.len() == scene.triangles.len() {
            for (i, &e) in scene.triangle_entity_idx.iter().enumerate() {
                if e != eid { continue; }
                let t = &scene.triangles[i];
                for p in t.v.iter() {
                    bb[0] = bb[0].min(p[0]);
                    bb[1] = bb[1].min(p[1]);
                    bb[2] = bb[2].max(p[0]);
                    bb[3] = bb[3].max(p[1]);
                }
            }
        }
        if !bb[0].is_finite() || bb[0] >= bb[2] || bb[1] >= bb[3] {
            return;
        }
        let pad_x = ((bb[2] - bb[0]) * 0.1).max(1.0);
        let pad_y = ((bb[3] - bb[1]) * 0.1).max(1.0);
        let padded = [bb[0] - pad_x, bb[1] - pad_y, bb[2] + pad_x, bb[3] + pad_y];
        tab.cam = PaneCam::fit(&padded);
        if let Some(seg) = canonical_seg {
            tab.selection.clear();
            tab.selection.push(seg);
        }
    }
}

/// Cap the per-tab undo stack at `MAX_UNDO`. Older entries are dropped
/// FIFO. Free function so we can call it with just a `&mut Vec<EditOp>`
/// and dodge the wider `&mut self` borrow from inside `App` methods.
const MAX_UNDO: usize = 20;
fn push_undo(stack: &mut Vec<EditOp>, op: EditOp) {
    if stack.len() >= MAX_UNDO { stack.remove(0); }
    stack.push(op);
}

/// Plain click â†’ replace selection with the picked entity. Shift/Ctrl
/// click â†’ toggle that entity in/out. Empty pick + non-additive â†’ clear.
/// Operates directly on a FileTab so it doesn't fight `&self` borrow
/// rules from the LMB handler.
fn apply_pick_to_selection(tab: &mut FileTab, picked: Option<usize>, additive: bool) {
    let Some(seg_idx) = picked else {
        if !additive { tab.selection.clear(); }
        return;
    };
    let scene = &tab.scene;
    let use_groups = scene.segment_entity_idx.len() == scene.segments.len()
        && !scene.segment_entity_idx.is_empty();
    if !use_groups {
        // Fallback: per-segment picking with no entity grouping.
        if additive {
            if let Some(pos) = tab.selection.iter().position(|&i| i == seg_idx) {
                tab.selection.remove(pos);
            } else {
                tab.selection.push(seg_idx);
            }
        } else {
            tab.selection.clear();
            tab.selection.push(seg_idx);
        }
        return;
    }
    let target_eid = scene.segment_entity_idx[seg_idx];
    // Identify whether `target_eid` is currently in the selection (i.e.
    // some selected segment-idx maps to that eid).
    let already = tab.selection.iter().any(|&i|
        scene.segment_entity_idx.get(i).copied() == Some(target_eid));
    if additive {
        if already {
            tab.selection.retain(|&i|
                scene.segment_entity_idx.get(i).copied() != Some(target_eid));
        } else {
            tab.selection.push(seg_idx);
        }
    } else {
        // Replace whole selection with this entity (one canonical seg-idx).
        tab.selection.clear();
        tab.selection.push(seg_idx);
    }
}

/// Append a single LineList segment (two vertices) to `verts` after
/// translating to camera-origin-relative coords + an optional preview
/// offset. Skips non-finite points so a bad segment can't crash the GPU.
fn push_seg(verts: &mut Vec<Vertex>, s: &Segment, origin: [f64;2], pdx: f64, pdy: f64, color: u32) {
    let p1 = [
        (s.p1[0] + pdx - origin[0]) as f32,
        (s.p1[1] + pdy - origin[1]) as f32,
    ];
    let p2 = [
        (s.p2[0] + pdx - origin[0]) as f32,
        (s.p2[1] + pdy - origin[1]) as f32,
    ];
    if p1[0].is_finite() && p1[1].is_finite()
        && p2[0].is_finite() && p2[1].is_finite()
    {
        verts.push(Vertex { pos: p1, color, _pad: 0 });
        verts.push(Vertex { pos: p2, color, _pad: 0 });
    }
}

/// Rebuild `tab.sel_pipe` from `tab.selection` + `tab.pending_move_offset`.
/// Free function so callers can pass `self.tabs.get_mut(...)` and
/// `&self.gpu.as_ref().unwrap()` without running afoul of borrow rules.
/// Index of `idx` after removing `removed` from a Vec. Assumes idx != removed
/// (caller must handle that case separately). Saturates at 0 for safety.
fn other_after_remove(idx: usize, removed: usize) -> usize {
    if idx > removed { idx - 1 } else { idx }
}

/// One render-pane: which tab to draw, and the physical-pixel viewport.
#[derive(Clone, Copy)]
struct RenderPane {
    tab_idx: usize,
    rect_px: (f32, f32, f32, f32),
}

/// Compute render panes for this frame. 1 pane when no split, 2 when the
/// active tab has a valid `split_kind` pointing at another open tab.
fn build_render_panes(
    tabs: &[FileTab],
    active: usize,
    canvas_px: (f32, f32, f32, f32),
    _ppp: f32,
) -> Vec<RenderPane> {
    let Some(tab) = tabs.get(active) else {
        return vec![RenderPane { tab_idx: active, rect_px: canvas_px }];
    };
    match tab.split_kind {
        Some(SplitKind::HorizontalPair(other))
            if other < tabs.len() && other != active =>
        {
            let (cx, cy, cw, ch) = canvas_px;
            let half = cw * 0.5;
            vec![
                RenderPane { tab_idx: active, rect_px: (cx, cy, half, ch) },
                RenderPane { tab_idx: other,  rect_px: (cx + half, cy, cw - half, ch) },
            ]
        }
        Some(SplitKind::VerticalPair(other))
            if other < tabs.len() && other != active =>
        {
            let (cx, cy, cw, ch) = canvas_px;
            let half = ch * 0.5;
            vec![
                RenderPane { tab_idx: active, rect_px: (cx, cy, cw, half) },
                RenderPane { tab_idx: other,  rect_px: (cx, cy + half, cw, ch - half) },
            ]
        }
        _ => vec![RenderPane { tab_idx: active, rect_px: canvas_px }],
    }
}

// Annotate tools â€” per user request: linear maatlijn + area measurement, per-tab persistence
/// Build the annotation GPU buffer for `tab`.
///
/// Walks `tab.annotations` + `in_progress_polygon` (only for active tab in
/// Area mode) and emits:
///   - LinearDim -> dim line with tick marks + stroke-font distance label.
///   - Area -> dashed closed-polygon edges + stroke-font area label at centroid.
fn rebuild_annotation_pipe(
    tab_opt: Option<&mut FileTab>,
    in_progress_polygon: Option<&[[f64; 2]]>,
    cursor_world: Option<[f64; 2]>,
    gpu: &GpuCtx,
) {
    let Some(tab) = tab_opt else { return; };
    // Fast-path: nothing to draw and no pipe yet â†’ skip every per-frame
    // alloc + GPU touch. This is the common case for both Viewer mode
    // and Studio scenes that haven't placed any annotations. Without this
    // gate the function allocated a fresh `Vec<Vertex>` and pushed an
    // empty buffer to the GPU queue every frame for every tab.
    let no_in_progress = in_progress_polygon.map(|p| p.is_empty()).unwrap_or(true);
    if tab.annotations.is_empty() && no_in_progress {
        if let Some(pipe) = tab.annotation_pipe.as_mut() {
            // Pipe exists from earlier â€” mark it empty so the scene pass
            // skips the draw and we avoid the upload.
            pipe.vertex_count = 0;
        }
        return;
    }

    let origin = tab.cam.origin;
    let dim_color: u32 = 0xFFFFCC55;   // amber
    let area_color: u32 = 0xFF66CCFF;  // cyan
    let text_color: u32 = 0xFFFFFFFF;  // white

    let text_h_world = (1.0 / tab.cam.zoom.max(1e-9)) * 0.02;
    let tick_world = text_h_world * 0.6;

    let mut verts: Vec<Vertex> = Vec::new();

    fn push_seg(
        verts: &mut Vec<Vertex>, origin: [f64; 2],
        a: [f64; 2], b: [f64; 2], col: u32,
    ) {
        let p1 = [(a[0] - origin[0]) as f32, (a[1] - origin[1]) as f32];
        let p2 = [(b[0] - origin[0]) as f32, (b[1] - origin[1]) as f32];
        if p1[0].is_finite() && p1[1].is_finite()
            && p2[0].is_finite() && p2[1].is_finite()
        {
            verts.push(Vertex { pos: p1, color: col, _pad: 0 });
            verts.push(Vertex { pos: p2, color: col, _pad: 0 });
        }
    }

    fn push_dashed(
        verts: &mut Vec<Vertex>, origin: [f64; 2],
        a: [f64; 2], b: [f64; 2], col: u32, dash: f64,
    ) {
        let dx = b[0] - a[0];
        let dy = b[1] - a[1];
        let len = (dx * dx + dy * dy).sqrt();
        if len < 1e-12 || dash <= 0.0 { return; }
        let nx = dx / len;
        let ny = dy / len;
        let mut t = 0.0_f64;
        let mut on = true;
        while t < len {
            let t2 = (t + dash).min(len);
            if on {
                let s = [a[0] + nx * t,  a[1] + ny * t];
                let e = [a[0] + nx * t2, a[1] + ny * t2];
                push_seg(verts, origin, s, e, col);
            }
            t = t2;
            on = !on;
        }
    }

    fn push_text(
        verts: &mut Vec<Vertex>, origin: [f64; 2],
        text: &str, centre: [f64; 2], h: f64, col: u32, rotation: f64,
    ) {
        let approx_w = (text.chars().count() as f64) * 0.6 * h;
        // Offset centre â†’ baseline-left origin of the rotated text box.
        // In the text's LOCAL frame the start is (-w/2, -h/2). Rotate
        // that offset into world coords before applying to centre.
        let c = rotation.cos();
        let s = rotation.sin();
        let local_dx = -approx_w * 0.5;
        let local_dy = -h * 0.5;
        let start = [
            centre[0] + local_dx * c - local_dy * s,
            centre[1] + local_dx * s + local_dy * c,
        ];
        let (segs, _adv) = crate::stroke_font::render_string(text, start, h, rotation);
        for (a, b) in segs {
            push_seg(verts, origin, a, b, col);
        }
    }

    // Committed annotations.
    for ann in &tab.annotations {
        match ann {
            Annotation::LinearDim { p1, p2, offset } => {
                let dx = p2[0] - p1[0];
                let dy = p2[1] - p1[1];
                let len = (dx * dx + dy * dy).sqrt();
                if len < 1e-12 { continue; }
                let px = -dy / len;
                let py =  dx / len;
                let ox = px * offset;
                let oy = py * offset;
                let a1 = *p1;
                let a2 = [p1[0] + ox, p1[1] + oy];
                let b1 = *p2;
                let b2 = [p2[0] + ox, p2[1] + oy];
                if offset.abs() > 1e-12 {
                    push_seg(&mut verts, origin, a1, a2, dim_color);
                    push_seg(&mut verts, origin, b1, b2, dim_color);
                }
                push_seg(&mut verts, origin, a2, b2, dim_color);
                let tx = px * tick_world;
                let ty = py * tick_world;
                push_seg(&mut verts, origin, [a2[0] - tx, a2[1] - ty], [a2[0] + tx, a2[1] + ty], dim_color);
                push_seg(&mut verts, origin, [b2[0] - tx, b2[1] - ty], [b2[0] + tx, b2[1] + ty], dim_color);
                let mid = [(a2[0] + b2[0]) * 0.5, (a2[1] + b2[1]) * 0.5];
                let label_centre = [mid[0] + px * text_h_world * 0.8, mid[1] + py * text_h_world * 0.8];
                let label = format!("{:.2}", len);
                // Dim label rotates parallel to the dim line; flip if
                // upside-down for readability.
                let mut label_rot = dy.atan2(dx);
                if label_rot.cos() < 0.0 { label_rot += std::f64::consts::PI; }
                push_text(&mut verts, origin, &label, label_centre, text_h_world, text_color, label_rot);
            }
            Annotation::Area { verts: poly, value } => {
                let n = poly.len();
                if n < 3 { continue; }
                for i in 0..n {
                    let a = poly[i];
                    let b = poly[(i + 1) % n];
                    push_dashed(&mut verts, origin, a, b, area_color, text_h_world * 1.5);
                }
                let (cx, cy) = poly.iter().fold((0.0, 0.0), |(ax, ay), v| (ax + v[0], ay + v[1]));
                let centre = [cx / n as f64, cy / n as f64];
                let label = format!("A = {:.2}", value);
                // Area label: always horizontal â€” polygon can be any shape,
                // no single "natural" text direction.
                push_text(&mut verts, origin, &label, centre, text_h_world, text_color, 0.0);
            }
        }
    }

    // In-progress polygon rubber-banding.
    if let Some(poly) = in_progress_polygon {
        if !poly.is_empty() {
            for i in 0..poly.len().saturating_sub(1) {
                push_seg(&mut verts, origin, poly[i], poly[i + 1], area_color);
            }
            if let (Some(last), Some(cur)) = (poly.last(), cursor_world) {
                push_dashed(&mut verts, origin, *last, cur, area_color, text_h_world * 1.2);
            }
            if poly.len() >= 3 {
                if let Some(cur) = cursor_world {
                    push_dashed(&mut verts, origin, cur, poly[0], area_color, text_h_world * 1.2);
                } else {
                    push_dashed(&mut verts, origin, *poly.last().unwrap(), poly[0], area_color, text_h_world * 1.2);
                }
            }
        }
    }

    let needed = verts.len().max(8192);
    let recreate = match tab.annotation_pipe.as_ref() {
        None => true,
        Some(p) => (p.vb.size() / std::mem::size_of::<Vertex>() as u64) < needed as u64,
    };
    if recreate {
        let init_cap: Vec<Vertex> = vec![Vertex { pos: [0.0, 0.0], color: 0, _pad: 0 }; needed];
        let mut pipe = LinePipeline::new(&gpu.device, gpu.format, &init_cap);
        pipe.upload(&gpu.queue, &verts);
        tab.annotation_pipe = Some(pipe);
    } else if let Some(pipe) = tab.annotation_pipe.as_mut() {
        pipe.upload(&gpu.queue, &verts);
    }
}

/// ORTHO constraint — given the first click `p1` and an unconstrained
/// second-click `p2`, snap `p2` to be horizontally or vertically aligned
/// with `p1` (whichever axis has the larger absolute delta wins). Used
/// by Measure + Dimension when the ORTHO status-bar pill is on. AutoCAD
/// uses the same "dominant axis" rule.
fn ortho_constrain(p1: [f64; 2], p2: [f64; 2]) -> [f64; 2] {
    let dx = (p2[0] - p1[0]).abs();
    let dy = (p2[1] - p1[1]).abs();
    if dx >= dy {
        // Snap to horizontal axis (preserve x, lock y to p1.y).
        [p2[0], p1[1]]
    } else {
        // Snap to vertical axis (preserve y, lock x to p1.x).
        [p1[0], p2[1]]
    }
}

/// Shoelace formula for a simple polygon (world units^2). Absolute so winding doesn't matter.
fn polygon_area(verts: &[[f64; 2]]) -> f64 {
    let n = verts.len();
    if n < 3 { return 0.0; }
    let mut sum = 0.0_f64;
    for i in 0..n {
        let a = verts[i];
        let b = verts[(i + 1) % n];
        sum += a[0] * b[1] - b[0] * a[1];
    }
    (sum * 0.5).abs()
}

fn rebuild_sel_pipe(tab_opt: Option<&mut FileTab>, gpu: &GpuCtx) {
    let Some(tab) = tab_opt else { return; };
    // Build the spatial / entity index lazily â€” same as the pick path.
    tab.ensure_scene_index();

    let mut verts: Vec<Vertex> = Vec::new();
    let origin = tab.cam.origin;
    let hi_color: u32 = 0xFFFF00FF;       // bright magenta â€” selection
    let hover_color: u32 = 0x66FF66FF;    // dim magenta (alpha ~0.4) â€” hover
    let preview_dx = tab.pending_move_offset[0];
    let preview_dy = tab.pending_move_offset[1];
    let scene = &tab.scene;
    let use_groups = scene.segment_entity_idx.len() == scene.segments.len()
        && !scene.segment_entity_idx.is_empty();

    // Resolve the selection segment-list to a unique entity-id set.
    let sel_eids: HashSet<u32> = if use_groups {
        tab.selection.iter()
            .filter_map(|&i| scene.segment_entity_idx.get(i).copied())
            .collect()
    } else { HashSet::new() };

    // Hover entity (resolved similarly). Skip painting it if it's already
    // in the selection â€” bright magenta wins over dim magenta.
    let hover_eid: Option<u32> = if use_groups {
        tab.hover.and_then(|i| scene.segment_entity_idx.get(i).copied())
            .filter(|e| !sel_eids.contains(e))
    } else { None };

    // Fast path: when the entity â†’ segments lookup table exists, walk only
    // the siblings of each highlighted entity instead of every segment in
    // the scene. Drops the per-event cost from O(n_segs) (~688k) to
    // O(siblings) (typically a handful).
    let entity_to_segs = tab.scene_index.as_ref().map(|si| &si.entity_to_segs);

    // First pass â€” draw HOVER underneath so selection lines paint on top.
    if let Some(heid) = hover_eid {
        if let Some(map) = entity_to_segs {
            if let Some(seg_list) = map.get(heid as usize) {
                for &si in seg_list {
                    if let Some(s) = scene.segments.get(si as usize) {
                        push_seg(&mut verts, s, origin, 0.0, 0.0, hover_color);
                    }
                }
            }
        } else {
            // No index â€” fall back to the original linear sibling walk.
            for (i, s) in scene.segments.iter().enumerate() {
                if scene.segment_entity_idx[i] != heid { continue; }
                push_seg(&mut verts, s, origin, 0.0, 0.0, hover_color);
            }
        }
    }
    if use_groups {
        if let Some(map) = entity_to_segs {
            // For each selected entity-id, hop into its sibling list directly.
            for &eid in sel_eids.iter() {
                if let Some(seg_list) = map.get(eid as usize) {
                    for &si in seg_list {
                        if let Some(s) = scene.segments.get(si as usize) {
                            push_seg(&mut verts, s, origin, preview_dx, preview_dy, hi_color);
                        }
                    }
                }
            }
        } else {
            for (i, s) in scene.segments.iter().enumerate() {
                if !sel_eids.contains(&scene.segment_entity_idx[i]) { continue; }
                push_seg(&mut verts, s, origin, preview_dx, preview_dy, hi_color);
            }
        }
    } else {
        // Fallback: scene has no entity-id table â€” highlight the picked
        // segments individually.
        for &seg_idx in tab.selection.iter() {
            if let Some(s) = scene.segments.get(seg_idx) {
                push_seg(&mut verts, s, origin, preview_dx, preview_dy, hi_color);
            }
        }
    }
    let needed = verts.len().max(8192);
    let recreate = match tab.sel_pipe.as_ref() {
        None => true,
        Some(p) => (p.vb.size() / std::mem::size_of::<Vertex>() as u64)
            < needed as u64,
    };
    if recreate {
        let init_cap: Vec<Vertex> = vec![Vertex { pos: [0.0, 0.0], color: 0, _pad: 0 }; needed];
        let mut pipe = LinePipeline::new(&gpu.device, gpu.format, &init_cap);
        pipe.upload(&gpu.queue, &verts);
        tab.sel_pipe = Some(pipe);
    } else if let Some(pipe) = tab.sel_pipe.as_mut() {
        pipe.upload(&gpu.queue, &verts);
    }
}

/// Build a 64Ã—64 RGBA window/taskbar icon programmatically â€” avoids the
/// extra dependency on `image` + a shipped .ico file. Design: warm-dark
/// (#242830) background, cyan-blue (#007ACC) stylised "2D" letters (the
/// logo) drawn from a 5Ã—7 pixel font scaled 4Ã—4. Matches the ribbon's
/// colour language.
/// Pre-rendered PNG asset for the Studio window icon (taskbar + OS
/// title chrome). 256-px master version — winit downscales as needed.
const STUDIO_ICON_PNG: &[u8] = include_bytes!("../assets/icon-studio-256.png");
/// Pre-rendered PNG asset for the Viewer window icon. Same orange
/// "2D" tile as Studio plus a small eye-badge in the bottom-right so
/// users can tell the two app variants apart in the taskbar.
const VIEWER_ICON_PNG: &[u8] = include_bytes!("../assets/icon-viewer-256.png");

fn make_window_icon_for(mode: AppMode) -> Option<winit::window::Icon> {
    let bytes = match mode {
        AppMode::Viewer => VIEWER_ICON_PNG,
        AppMode::Studio => STUDIO_ICON_PNG,
    };
    // Decode PNG → RGBA8 buffer via the `image` crate (already in deps).
    let img = image::load_from_memory(bytes).ok()?.to_rgba8();
    let (w, h) = img.dimensions();
    winit::window::Icon::from_rgba(img.into_raw(), w, h).ok()
}

/// Legacy procedurally-drawn pixel-art icon. Kept as a fallback in
/// case the PNG asset fails to decode (e.g. a corrupt embed).
fn make_window_icon() -> Option<winit::window::Icon> {
    const W: u32 = 64;
    const H: u32 = 64;
    let mut rgba = vec![0u8; (W * H * 4) as usize];
    let bg = [0x24, 0x28, 0x30, 0xFF];
    let border = [0x3A, 0x3E, 0x44, 0xFF];
    let accent = [0x00, 0x7A, 0xCC, 0xFF];
    let accent_glow = [0x33, 0x9D, 0xE6, 0xFF];
    for y in 0..H {
        for x in 0..W {
            let off = ((y * W + x) * 4) as usize;
            let edge = x < 3 || x >= W - 3 || y < 3 || y >= H - 3;
            let color = if edge { border } else { bg };
            rgba[off..off + 4].copy_from_slice(&color);
        }
    }
    let plot = |rgba: &mut Vec<u8>, x: i32, y: i32, c: [u8; 4]| {
        if x >= 0 && x < W as i32 && y >= 0 && y < H as i32 {
            let off = ((y as u32 * W + x as u32) * 4) as usize;
            rgba[off..off + 4].copy_from_slice(&c);
        }
    };
    // 5Ã—7 pixel-font glyph for "2" (1 = filled).
    let glyph_2: [[u8; 5]; 7] = [
        [0,1,1,1,0],
        [1,0,0,0,1],
        [0,0,0,0,1],
        [0,0,0,1,0],
        [0,0,1,0,0],
        [0,1,0,0,0],
        [1,1,1,1,1],
    ];
    // 5Ã—7 pixel-font glyph for "D" (1 = filled).
    let glyph_d: [[u8; 5]; 7] = [
        [1,1,1,1,0],
        [1,0,0,0,1],
        [1,0,0,0,1],
        [1,0,0,0,1],
        [1,0,0,0,1],
        [1,0,0,0,1],
        [1,1,1,1,0],
    ];
    // Render a 5Ã—7 glyph at (origin_x, origin_y), scaled 5Ã— per cell so
    // each letter is 25w Ã— 35h. Two letters spaced 4 px apart fit
    // centred in the 64Ã—64 canvas (total width 25+4+25 = 54, leaves 5 px
    // padding each side).
    let scale: i32 = 5;
    let render_glyph = |rgba: &mut Vec<u8>, glyph: &[[u8; 5]; 7], origin_x: i32, origin_y: i32| {
        for (gy, row) in glyph.iter().enumerate() {
            for (gx, &cell) in row.iter().enumerate() {
                if cell == 0 { continue; }
                let px0 = origin_x + (gx as i32) * scale;
                let py0 = origin_y + (gy as i32) * scale;
                for dy in 0..scale {
                    for dx in 0..scale {
                        plot(rgba, px0 + dx, py0 + dy, accent);
                    }
                }
            }
        }
    };
    let letter_w = 5 * scale;
    let total_w = letter_w * 2 + 4;
    let origin_x = (W as i32 - total_w) / 2;
    let origin_y = (H as i32 - 7 * scale) / 2;
    render_glyph(&mut rgba, &glyph_2, origin_x, origin_y);
    render_glyph(&mut rgba, &glyph_d, origin_x + letter_w + 4, origin_y);
    // Subtle highlight on the top edge of each filled stroke for a hint
    // of dimensionality (matches accent-glow used elsewhere).
    for gx in 0..(letter_w * 2 + 4) {
        let x = origin_x + gx;
        let y = origin_y;
        let off = ((y as u32 * W + x.max(0) as u32) * 4) as usize;
        if x >= 0 && x < W as i32 && off + 3 < rgba.len() && rgba[off..off + 4] == accent {
            rgba[off..off + 4].copy_from_slice(&accent_glow);
        }
    }
    winit::window::Icon::from_rgba(rgba, W, H).ok()
}

impl ApplicationHandler for App {
    fn resumed(&mut self, event_loop: &ActiveEventLoop) {
        let title = Self::title_for(&self.tabs, self.active_tab, self.mode);
        // Hide the native OS chrome â€” our `superui::TitleBar` paints its
        // own titlebar (icon + QAT + title + window controls). We start
        // a window drag from inside that bar via `Window::drag_window`.
        let mut attrs = Window::default_attributes()
            .with_title(title)
            .with_decorations(false)
            // Open maximised by default — fills the work-area without
            // hiding the OS taskbar (true Fullscreen would). User can
            // hit the maximize/restore button in our custom titlebar.
            .with_maximized(true)
            .with_inner_size(winit::dpi::LogicalSize::new(1800, 1000));
        // Use the proper PNG asset (Studio vs Viewer variant). Falls
        // back to the procedural pixel-art icon if PNG decode fails.
        let icon = make_window_icon_for(self.mode).or_else(make_window_icon);
        if let Some(ic) = icon {
            attrs = attrs.with_window_icon(Some(ic));
        }
        let win = Arc::new(event_loop.create_window(attrs).unwrap());
        let gpu = pollster::block_on(GpuCtx::new(win.clone())).unwrap();

        // Build GPU pipelines for every tab now that we have the device.
        for tab in self.tabs.iter_mut() {
            tab.rebuild_buffers(&gpu);
        }

        self.window = Some(win);
        self.gpu = Some(gpu);
    }

    fn window_event(&mut self, event_loop: &ActiveEventLoop, _id: winit::window::WindowId, event: WindowEvent) {
        if let (Some(gpu), Some(win)) = (self.gpu.as_mut(), self.window.as_ref()) {
            let _ = gpu.egui_state.on_window_event(win, &event);
        }
        match event {
            WindowEvent::CloseRequested => event_loop.exit(),
            WindowEvent::ModifiersChanged(m) => { self.modifiers = m.state(); }
            WindowEvent::Resized(size) => {
                if let Some(gpu) = self.gpu.as_mut() {
                    if size.width > 0 && size.height > 0 {
                        // Clamp to wgpu's max texture dimension (default 8192).
                        // Multi-monitor maximize on a 3-screen setup can produce
                        // 9000+px which panics Surface::configure validation.
                        let max_dim = gpu.device.limits().max_texture_dimension_2d;
                        gpu.config.width = size.width.min(max_dim);
                        gpu.config.height = size.height.min(max_dim);
                        gpu.surface.configure(&gpu.device, &gpu.config);
                    }
                }
            }
            WindowEvent::KeyboardInput { event: KeyEvent {
                physical_key: PhysicalKey::Code(code),
                state: ElementState::Pressed, ..
            }, .. } => match code {
                KeyCode::Escape => {
                    // Annotate tools â€” per user request: linear maatlijn + area measurement, per-tab persistence
                    // Escape behaviour is layered: first absorbs the in-progress
                    // Area polygon (if any), then Dimension p1, then samples panel,
                    // then selection, then finally exits the app. CAD UX.
                    // Blok 3 â€” Esc also cancels in-progress Rotate/Scale/Mirror
                    // pivots before touching selection.
                    // Task 9 â€” Esc during text-edit cancels the edit first
                    // (highest priority so typing into the buffer can be
                    // backed out without disturbing other state).
                    if self.edit_mode.is_some() {
                        self.cancel_text_edit();
                    } else if self.find_dialog_open {
                        // Esc closes Find before any tool-mode cancel.
                        self.find_dialog_open = false;
                    } else if self.tool_mode == ToolMode::ZoomRegion {
                        // ZR â€” cancel the zoom-region: revert tool +
                        // clear in-progress anchor. Camera stays put.
                        self.tool_mode = ToolMode::Select;
                        self.zoom_region_p1 = None;
                    } else if self.tool_mode == ToolMode::ZoomCenter {
                        // Cancel one-shot recenter.
                        self.tool_mode = ToolMode::Select;
                    } else if self.tool_mode == ToolMode::MeasureAngle
                        && !self.measure_angle_pts.is_empty()
                    {
                        // Drop in-progress angle clicks first.
                        self.measure_angle_pts.clear();
                    } else if self.tool_mode == ToolMode::MeasureCoord {
                        self.tool_mode = ToolMode::Select;
                        self.last_measure_coord = None;
                    } else if self.tool_mode == ToolMode::Measure
                        && self.measure_sub == MeasureSub::Area
                        && !self.measure_area_in_progress.is_empty()
                    {
                        self.measure_area_in_progress.clear();
                    } else if !self.area_in_progress.is_empty() {
                        self.area_in_progress.clear();
                    } else if self.dim_p1.is_some() {
                        self.dim_p1 = None;
                    } else if self.rotate_pivot.is_some()
                        || self.scale_pivot.is_some()
                        || self.mirror_a.is_some()
                    {
                        self.rotate_pivot = None;
                        self.scale_pivot = None;
                        self.scale_ref = None;
                        self.mirror_a = None;
                    } else if self.samples_panel_open { self.samples_panel_open = false; }
                    else if !self.tabs.get(self.active_tab)
                        .map(|t| t.selection.is_empty()).unwrap_or(true)
                    {
                        if let Some(tab) = self.tabs.get_mut(self.active_tab) {
                            tab.selection.clear();
                            tab.hover = None;
                        }
                        if let Some(gpu) = self.gpu.as_ref() {
                            rebuild_sel_pipe(self.tabs.get_mut(self.active_tab), gpu);
                        }
                    }
                    else { event_loop.exit(); }
                }
                KeyCode::Delete | KeyCode::Backspace => {
                    // Frame-deferred so we mutate scene + GPU together at
                    // the top of the next render cycle. Allowed in Viewer
                    // mode too -- minimal-edit surface (delete element,
                    // delete layer, explode block, move) is the
                    // documented viewer-port scope.
                    self.requested_delete = true;
                }
                KeyCode::KeyF => self.fit_active(),
                // Annotate tools â€” per user request: linear maatlijn + area measurement, per-tab persistence
                KeyCode::KeyD if !self.modifiers_ctrl_held() && !self.modifiers_shift_held() => {
                    self.tool_mode = ToolMode::Dimension;
                    self.dim_p1 = None;
                    self.area_in_progress.clear();
                }
                KeyCode::KeyA if !self.modifiers_ctrl_held() && !self.modifiers_shift_held() => {
                    self.tool_mode = ToolMode::Area;
                    self.area_in_progress.clear();
                    self.dim_p1 = None;
                }
                KeyCode::KeyM if !self.modifiers_ctrl_held() && !self.modifiers_shift_held() => {
                    // Plain M = Measure tool — but ALSO arm a `MV` chord so
                    // a fast V right after upgrades us to Move (AutoCAD-style
                    // mnemonic: M-V = Move). The chord window is 1 s.
                    self.tool_mode = ToolMode::Measure;
                    self.measure_p1 = None;
                    // Reset sub-mode to Length so the rubber-band preview
                    // fires after the first click — Area requires a
                    // different (polygon) gesture that the user may not
                    // expect when just hitting M.
                    self.measure_sub = MeasureSub::Length;
                    self.key_chord_pending = Some(KeyCode::KeyM);
                    self.key_chord_at = Some(std::time::Instant::now());
                }
                // Blok 3 â€” Shift+M = Mirror (M alone is Measure).
                KeyCode::KeyM if self.modifiers_shift_held() && !self.modifiers_ctrl_held() => {
                    self.tool_mode = ToolMode::Mirror;
                    self.mirror_a = None;
                }
                // Blok 3 â€” R = Rotate tool. ZR â€” special case: if the
                // user just pressed `Z` within 1 s we treat this as the
                // `Z R` "zoom region" chord instead of starting Rotate.
                KeyCode::KeyR if !self.modifiers_ctrl_held() && !self.modifiers_shift_held() => {
                    let is_chord = matches!(
                        (self.key_chord_pending, self.key_chord_at),
                        (Some(KeyCode::KeyZ), Some(t))
                            if t.elapsed() < std::time::Duration::from_millis(1000)
                    );
                    if is_chord {
                        self.tool_mode = ToolMode::ZoomRegion;
                        self.zoom_region_p1 = None;
                    } else {
                        self.tool_mode = ToolMode::Rotate;
                        self.rotate_pivot = None;
                    }
                    self.key_chord_pending = None;
                    self.key_chord_at = None;
                }
                // Blok 3 â€” S = Scale tool. Ctrl+S was not bound previously;
                // Ctrl+Shift+S is the unsplit shortcut handled below.
                KeyCode::KeyS if !self.modifiers_ctrl_held() && !self.modifiers_shift_held() => {
                    self.tool_mode = ToolMode::Scale;
                    self.scale_pivot = None;
                    self.scale_ref = None;
                }
                KeyCode::KeyV if !self.modifiers_ctrl_held() && !self.modifiers_shift_held() => {
                    // MV chord: if `M` was pressed within the last second,
                    // upgrade Measure → Move (AutoCAD MV mnemonic). Flow:
                    // select entities first → MV → click start → click end.
                    let is_mv_chord = matches!(
                        (self.key_chord_pending, self.key_chord_at),
                        (Some(KeyCode::KeyM), Some(t))
                            if t.elapsed() < std::time::Duration::from_millis(1000)
                    );
                    if is_mv_chord {
                        self.tool_mode = ToolMode::Move;
                        // Reset Move's two-click state.
                        if let Some(tab) = self.tabs.get_mut(self.active_tab) {
                            tab.move_drag = None;
                            tab.pending_move_offset = [0.0, 0.0];
                        }
                    } else {
                        // Plain V — Select mode. (Ctrl+Shift+V is Split V above.)
                        self.tool_mode = ToolMode::Select;
                    }
                    self.key_chord_pending = None;
                    self.key_chord_at = None;
                }
                KeyCode::Enter | KeyCode::NumpadEnter => {
                    // Task 9 â€” Enter during text-edit commits the buffer.
                    // Takes precedence over Area-polygon commit so the edit
                    // session can finish without leaving stale state.
                    if self.edit_mode.is_some() {
                        self.commit_text_edit();
                    } else
                    // Annotate tools â€” per user request: linear maatlijn + area measurement, per-tab persistence
                    // Commit in-progress Area polygon (needs >= 3 verts).
                    if self.tool_mode == ToolMode::Area && self.area_in_progress.len() >= 3 {
                        let value = polygon_area(&self.area_in_progress);
                        let active = self.active_tab;
                        if let Some(tab) = self.tabs.get_mut(active) {
                            tab.annotations.push(Annotation::Area {
                                verts: std::mem::take(&mut self.area_in_progress),
                                value,
                            });
                        }
                    }
                }
                KeyCode::F2 => {
                    // Text-edit trigger: in Select mode with no edit in flight
                    // and a text entity selected, open the inline editor.
                    // Otherwise fall back to the legacy panel toggle.
                    // Viewer mode: never enter text edit (file is read-only).
                    let mut entered = false;
                    if self.mode != AppMode::Viewer
                        && self.tool_mode == ToolMode::Select
                        && self.edit_mode.is_none()
                    {
                        let active_tab = self.active_tab;
                        let eids = self.selected_entity_ids_in(active_tab);
                        if let Some(tab) = self.tabs.get(active_tab) {
                            for eid in eids {
                                if tab.scene.entity_text.get(eid as usize)
                                    .and_then(|o| o.as_ref()).is_some()
                                {
                                    entered = true;
                                    self.enter_text_edit(active_tab, eid);
                                    break;
                                }
                            }
                        }
                    }
                    if !entered {
                        self.samples_panel_open = !self.samples_panel_open;
                    }
                }
                KeyCode::F3 => { self.layer_panel_open = !self.layer_panel_open; }
                KeyCode::F4 => { self.properties_panel_open = !self.properties_panel_open; }
                KeyCode::F5 => { self.structure_panel_open = !self.structure_panel_open; }
                KeyCode::F11 => {
                    self.pending_present_mode = Some(match self.present_mode {
                        wgpu::PresentMode::Fifo => wgpu::PresentMode::Immediate,
                        _ => wgpu::PresentMode::Fifo,
                    });
                }
                KeyCode::F12 => { self.show_perf_hud = !self.show_perf_hud; }
                KeyCode::KeyO if self.modifiers_ctrl_held() => self.open_file_dialog(),
                KeyCode::KeyF if self.modifiers_ctrl_held() && !self.modifiers_shift_held() => {
                    // Find dialog (Ctrl+F) — toggle. Opening also
                    // refreshes the match list so stale entries don't
                    // leak across sessions.
                    self.find_dialog_open = !self.find_dialog_open;
                    if self.find_dialog_open {
                        self.refresh_find_matches();
                    }
                }
                KeyCode::KeyW if self.modifiers_ctrl_held() => {
                    self.close_tab(self.active_tab);
                }
                KeyCode::Tab if self.modifiers_ctrl_held() => {
                    self.cycle_tab(!self.modifiers_shift_held());
                }
                KeyCode::KeyZ if self.modifiers_ctrl_held() => {
                    if self.mode != AppMode::Viewer { self.requested_undo = true; }
                }
                // ZR â€” plain Z buffers a chord prefix. `Z R` within 1 s
                // triggers Zoom-Region mode (handled in the KeyR arm).
                // Plain Z has no standalone action; if no second key
                // arrives the buffer expires harmlessly.
                KeyCode::KeyZ if !self.modifiers_ctrl_held() && !self.modifiers_shift_held() => {
                    self.key_chord_pending = Some(KeyCode::KeyZ);
                    self.key_chord_at = Some(std::time::Instant::now());
                }
                KeyCode::KeyA if self.modifiers_ctrl_held() && !self.modifiers_shift_held() => {
                    self.requested_select_all = true;
                }
                KeyCode::KeyC if self.modifiers_ctrl_held() && !self.modifiers_shift_held() => {
                    if self.mode != AppMode::Viewer { self.requested_copy = true; }
                }
                KeyCode::KeyX if self.modifiers_ctrl_held() && !self.modifiers_shift_held() => {
                    // Cut = copy + delete. Both flags are processed in the
                    // same frame so undo records exactly one Delete EditOp.
                    if self.mode != AppMode::Viewer {
                        self.requested_copy = true;
                        self.requested_delete = true;
                    }
                }
                // Plain `X` -- Explode. Walks the selection for entities
                // whose name starts with `INSERT` and re-assigns each of
                // their segments + triangles to a fresh entity_idx, so
                // the block's children become independently selectable.
                // Allowed in both Studio + Viewer per the minimal-edit
                // surface for the Viewer port.
                KeyCode::KeyX if !self.modifiers_ctrl_held() && !self.modifiers_shift_held() => {
                    self.requested_explode = true;
                }
                KeyCode::KeyV if self.modifiers_ctrl_held() && !self.modifiers_shift_held() => {
                    if self.mode != AppMode::Viewer { self.requested_paste = true; }
                }
                // Blok 3 â€” Ctrl+D duplicates the current selection in place
                // (small offset). Reuses the Paste undo variant â€” semantics
                // are identical from undo's point of view.
                KeyCode::KeyD if self.modifiers_ctrl_held() && !self.modifiers_shift_held() => {
                    if self.mode != AppMode::Viewer { self.requested_duplicate = true; }
                }
                // Split-view shortcuts. Ctrl+Shift+H / Ctrl+Shift+V pair
                // the active tab with its neighbour; Ctrl+Shift+S
                // unsplits.
                KeyCode::KeyH if self.modifiers_ctrl_held() && self.modifiers_shift_held() => {
                    if self.tabs.len() >= 2 {
                        let other = (self.active_tab + 1) % self.tabs.len();
                        if other != self.active_tab {
                            if let Some(tab) = self.tabs.get_mut(self.active_tab) {
                                tab.split_kind = Some(SplitKind::HorizontalPair(other));
                            }
                        }
                    }
                }
                KeyCode::KeyV if self.modifiers_ctrl_held() && self.modifiers_shift_held() => {
                    if self.tabs.len() >= 2 {
                        let other = (self.active_tab + 1) % self.tabs.len();
                        if other != self.active_tab {
                            if let Some(tab) = self.tabs.get_mut(self.active_tab) {
                                tab.split_kind = Some(SplitKind::VerticalPair(other));
                            }
                        }
                    }
                }
                KeyCode::KeyS if self.modifiers_ctrl_held() && self.modifiers_shift_held() => {
                    if let Some(tab) = self.tabs.get_mut(self.active_tab) {
                        tab.split_kind = None;
                    }
                    self.active_split_child = 0;
                }
                _ => {
                    // ZR â€” any unrecognised key clears the chord buffer
                    // so a stale `Z` press doesn't latch a later `R`.
                    self.key_chord_pending = None;
                    self.key_chord_at = None;
                }
            }
            WindowEvent::CursorMoved { position, .. } => {
                self.mouse_pos = (position.x as f32, position.y as f32);
                // Keep focused split child in sync with the cursor so
                // hit-testing / zoom-at-cursor / panels see the correct
                // half when the user crosses the divider.
                self.update_active_split_child();
                // Annotate tools â€” per user request: linear maatlijn + area measurement, per-tab persistence
                // Cache world-space cursor for the Area rubber-band preview.
                self.cursor_world = self.screen_to_world(self.mouse_pos.0, self.mouse_pos.1);

                // OSNAP â€” refresh `current_snap` from cursor + mode mask.
                // Microseconds per frame; only does real work when modes
                // are non-empty AND a tab has segments.
                self.update_snap();

                // Hover preview â€” only in Select mode and when no LMB drag
                // is in progress. Scaled pick radius for HiDPI parity with
                // the click-pick path.
                if self.tool_mode == ToolMode::Select && !self.lmb_pressed {
                    let scale_factor = self.window.as_ref()
                        .map(|w| w.scale_factor() as f32).unwrap_or(1.0);
                    let pick_r_px = (6.0_f32 * scale_factor).max(6.0);
                    let hover_tab = self.focused_tab_idx();
                    let hover_rect = self.focused_canvas_rect();
                    let hovered = self.pick_segment_at_in(
                        hover_tab, hover_rect, self.mouse_pos.0, self.mouse_pos.1, pick_r_px);
                    let prev = self.tabs.get(hover_tab).and_then(|t| t.hover);
                    if prev != hovered {
                        if let Some(tab) = self.tabs.get_mut(hover_tab) {
                            tab.hover = hovered;
                        }
                        if let Some(gpu) = self.gpu.as_ref() {
                            rebuild_sel_pipe(self.tabs.get_mut(hover_tab), gpu);
                        }
                    }
                }

                if self.tool_mode == ToolMode::Move && self.lmb_pressed {
                    // Route the drag through the tab/rect latched at press-time
                    // so split-view moves stay anchored to the pane you started
                    // in, even if the cursor crosses the divider mid-drag.
                    let drag_tab = self.lmb_press_tab;
                    let drag_rect = self.lmb_press_rect;
                    let press_world = self.tabs.get(drag_tab)
                        .and_then(|t| t.move_drag_multi.as_ref().map(|(_, p)| *p))
                        .or_else(|| self.tabs.get(drag_tab)
                            .and_then(|t| t.move_drag.map(|(_, p)| p)));
                    if let Some(press_world) = press_world {
                        if let Some(w) = self.screen_to_world_in(
                            drag_tab, drag_rect, self.mouse_pos.0, self.mouse_pos.1)
                        {
                            let offset = [w[0] - press_world[0], w[1] - press_world[1]];
                            if let Some(tab) = self.tabs.get_mut(drag_tab) {
                                tab.pending_move_offset = offset;
                            }
                            if let Some(gpu) = self.gpu.as_ref() {
                                rebuild_sel_pipe(self.tabs.get_mut(drag_tab), gpu);
                            }
                        }
                    }
                }
                if self.dragging {
                    let dx = self.mouse_pos.0 - self.drag_start.0;
                    let dy = self.mouse_pos.1 - self.drag_start.1;
                    let wpp = self.tabs.get(self.active_tab)
                        .map(|t| self.world_per_pixel(&t.cam))
                        .unwrap_or(1.0);
                    if let Some(tab) = self.tabs.get_mut(self.active_tab) {
                        // Screen-space cursor delta (Y-up) â†’ world delta,
                        // inverse-rotated so pan-drag stays hand-relative
                        // regardless of the current camera rotation.
                        let ex = -dx as f64 * wpp;
                        let ey =  dy as f64 * wpp;
                        let th = tab.cam.rotation;
                        let (ct, st) = (th.cos(), th.sin());
                        let wx_off =  ct * ex + st * ey;
                        let wy_off = -st * ex + ct * ey;
                        tab.cam.pan_x = self.drag_start_pan.0 + wx_off;
                        tab.cam.pan_y = self.drag_start_pan.1 + wy_off;
                    }
                }
            }
            WindowEvent::MouseInput { state, button: MouseButton::Middle, .. } => {
                match state {
                    ElementState::Pressed => {
                        if self.mouse_in_canvas() {
                            if let Some(tab) = self.tabs.get(self.active_tab) {
                                self.dragging = true;
                                self.drag_start = self.mouse_pos;
                                self.drag_start_pan = (tab.cam.pan_x, tab.cam.pan_y);
                            }
                        }
                    }
                    ElementState::Released => self.dragging = false,
                }
            }
            // Annotate tools â€” per user request: linear maatlijn + area measurement, per-tab persistence
            WindowEvent::MouseInput { state: ElementState::Pressed, button: MouseButton::Right, .. } => {
                // Right-click closes the in-progress Area polygon, or cancels an
                // in-progress dim (matches typical CAD right-click-to-finish).
                if self.tool_mode == ToolMode::Area && self.area_in_progress.len() >= 3 {
                    let value = polygon_area(&self.area_in_progress);
                    let active = self.active_tab;
                    if let Some(tab) = self.tabs.get_mut(active) {
                        tab.annotations.push(Annotation::Area {
                            verts: std::mem::take(&mut self.area_in_progress),
                            value,
                        });
                    }
                } else if self.tool_mode == ToolMode::Dimension {
                    self.dim_p1 = None;
                } else if self.tool_mode == ToolMode::Area {
                    self.area_in_progress.clear();
                } else if self.tool_mode == ToolMode::Measure
                    && self.measure_sub == MeasureSub::Area
                {
                    // Same finish-on-right-click semantics for the
                    // Viewer's polygon-area measurement.
                    let v = &self.measure_area_in_progress;
                    if v.len() >= 3 {
                        let mut perim = 0.0_f64;
                        for i in 0..v.len().saturating_sub(1) {
                            let dx = v[i + 1][0] - v[i][0];
                            let dy = v[i + 1][1] - v[i][1];
                            perim += (dx*dx + dy*dy).sqrt();
                        }
                        if let (Some(first), Some(last)) =
                            (v.first().copied(), v.last().copied())
                        {
                            let dx = first[0] - last[0];
                            let dy = first[1] - last[1];
                            perim += (dx*dx + dy*dy).sqrt();
                        }
                        let area = polygon_area(v);
                        self.last_measure_area = Some((perim, area));
                        self.measure_area_in_progress.clear();
                    } else {
                        // Fewer than 3 verts -- right-click cancels.
                        self.measure_area_in_progress.clear();
                    }
                }
            }
            WindowEvent::MouseInput { state, button: MouseButton::Left, .. } => {
                let egui_wants_input = self.gpu.as_ref()
                    .map(|g| g.egui_ctx.wants_pointer_input()).unwrap_or(false);
                let in_cube = self.mouse_in_view_cube();
                let _ = egui_wants_input; // diagnostic â€” kept for future gating
                match state {
                    ElementState::Pressed => {
                        // BUG FIX: don't gate on egui_wants_input â€” it returns
                        // true for canvas presses even when no egui widget is
                        // under the cursor (suspected: Sense::hover() on the
                        // CentralPanel allocate_rect, or the Tooltip-order
                        // view-cube Area causing wants_pointer_input to spike
                        // on every click). mouse_in_canvas() already excludes
                        // panels (they're outside canvas_rect); we add an
                        // explicit carve-out for the view-cube rect so clicks
                        // on it don't double-fire a canvas pick.
                        if self.mouse_in_canvas() && !in_cube {
                            // Latch which pane/rect owns this click so release
                            // dispatches against the correct tab even if the
                            // cursor drifts across a split divider.
                            self.update_active_split_child();
                            self.lmb_pressed = true;
                            self.lmb_press_pos = self.mouse_pos;
                            self.lmb_press_tab = self.focused_tab_idx();
                            self.lmb_press_rect = self.focused_canvas_rect();
                            if self.tool_mode == ToolMode::ZoomRegion {
                                // ZR â€” latch world-space anchor for the
                                // zoom-region rectangle. Release commits
                                // the camera fit (see LMB-release path).
                                if let Some(w) = self.screen_to_world_in(
                                    self.lmb_press_tab,
                                    self.lmb_press_rect,
                                    self.mouse_pos.0,
                                    self.mouse_pos.1,
                                ) {
                                    self.zoom_region_p1 = Some(w);
                                }
                            }
                            if self.tool_mode == ToolMode::Move {
                                let t_idx = self.lmb_press_tab;
                                let rect = self.lmb_press_rect;
                                let eids = self.selected_entity_ids_in(t_idx);
                                if !eids.is_empty() {
                                    if let Some(w) = self.screen_to_world_in(
                                        t_idx, rect, self.mouse_pos.0, self.mouse_pos.1)
                                    {
                                        if let Some(tab) = self.tabs.get_mut(t_idx) {
                                            // Mirror first eid in `move_drag` for the
                                            // legacy pending-offset preview pathway.
                                            tab.move_drag = Some((eids[0], w));
                                            tab.move_drag_multi = Some((eids, w));
                                            tab.pending_move_offset = [0.0, 0.0];
                                        }
                                    }
                                }
                            }
                        }
                    }
                    ElementState::Released => {
                        if self.lmb_pressed {
                            self.lmb_pressed = false;
                            let dx = self.mouse_pos.0 - self.lmb_press_pos.0;
                            let dy = self.mouse_pos.1 - self.lmb_press_pos.1;
                            let drift = (dx * dx + dy * dy).sqrt();
                            let focus_tab = self.lmb_press_tab;
                            let focus_rect = self.lmb_press_rect;
                            // BUG FIX (B): drift threshold scaled by HiDPI scale_factor.
                            // Was a fixed 4.0 px which on a 150% display means a normal
                            // click registers ~6 px of natural mouse jitter â€” got
                            // misclassified as a drag and never picked. Floor at 6 to
                            // stay forgiving on 100% displays too.
                            let scale_factor = self.window.as_ref()
                                .map(|w| w.scale_factor() as f32).unwrap_or(1.0);
                            let drift_threshold = (4.0_f32 * scale_factor).max(6.0);
                            let shift_held = self.modifiers_shift_held();
                            let ctrl_held = self.modifiers_ctrl_held();
                            let additive = shift_held || ctrl_held;
                            if self.tool_mode == ToolMode::Move {
                                // Prefer multi-entity move when one is in flight;
                                // fall back to legacy single-entity drag.
                                let multi_take = self.tabs.get_mut(focus_tab)
                                    .and_then(|t| t.move_drag_multi.take());
                                self.tabs.get_mut(focus_tab).map(|t| { t.move_drag = None; });
                                if let Some((eids, _press)) = multi_take {
                                    let off = self.tabs.get(focus_tab)
                                        .map(|t| t.pending_move_offset).unwrap_or([0.0, 0.0]);
                                    self.commit_move_multi_in(focus_tab, eids, off[0], off[1]);
                                }
                            } else if self.tool_mode == ToolMode::ZoomRegion {
                                // ZR â€” commit the zoom-region rectangle.
                                // Need a valid press anchor + non-degenerate
                                // rect (drift threshold guards against a
                                // stray click fitting to a near-zero bbox).
                                let p1 = self.zoom_region_p1.take();
                                let p2 = self.screen_to_world_in(
                                    focus_tab, focus_rect,
                                    self.mouse_pos.0, self.mouse_pos.1);
                                if drift >= drift_threshold {
                                    if let (Some(p1), Some(p2)) = (p1, p2) {
                                        let bbox = [
                                            p1[0].min(p2[0]),
                                            p1[1].min(p2[1]),
                                            p1[0].max(p2[0]),
                                            p1[1].max(p2[1]),
                                        ];
                                        if bbox[0] < bbox[2] && bbox[1] < bbox[3] {
                                            if let Some(tab) = self.tabs.get_mut(focus_tab) {
                                                tab.cam = PaneCam::fit(&bbox);
                                            }
                                        }
                                    }
                                }
                                // Always revert to Select after a release
                                // in zoom-region mode (chord is one-shot).
                                self.tool_mode = ToolMode::Select;
                                self.zoom_region_p1 = None;
                            } else if drift >= drift_threshold && self.tool_mode == ToolMode::Select {
                                // Drag-box select. Window vs crossing decided
                                // by drag direction (leftâ†’right = window).
                                self.commit_drag_box_select(focus_tab, focus_rect, additive);
                            } else if drift < drift_threshold {
                                match self.tool_mode {
                                    ToolMode::Select => {
                                        // BUG FIX (D): pick radius scaled by scale_factor.
                                        // Same HiDPI rationale â€” 6 px feels right on
                                        // 100% but is half the perceived radius on 200%.
                                        let pick_r_px = (6.0_f32 * scale_factor).max(6.0);
                                        let picked = self.pick_segment_at_in(
                                            focus_tab, focus_rect,
                                            self.mouse_pos.0, self.mouse_pos.1, pick_r_px);
                                        if let Some(tab) = self.tabs.get_mut(focus_tab) {
                                            apply_pick_to_selection(tab, picked, additive);
                                        }
                                        if let Some(gpu) = self.gpu.as_ref() {
                                            rebuild_sel_pipe(self.tabs.get_mut(focus_tab), gpu);
                                        }
                                    }
                                    ToolMode::Measure => {
                                        if let Some(world) = self.screen_to_world_in(
                                            focus_tab, focus_rect,
                                            self.mouse_pos.0, self.mouse_pos.1)
                                        {
                                            match self.measure_sub {
                                                MeasureSub::Length => match self.measure_p1 {
                                                    None => { self.measure_p1 = Some(world); }
                                                    Some(p1) => {
                                                        // ORTHO — snap second click to H or V
                                                        // axis from p1 (closer of |dx|, |dy| wins).
                                                        let world = if self.ortho_enabled {
                                                            ortho_constrain(p1, world)
                                                        } else { world };
                                                        let ddx = world[0] - p1[0];
                                                        let ddy = world[1] - p1[1];
                                                        let dist = (ddx*ddx + ddy*ddy).sqrt();
                                                        self.last_measurement = Some((p1, world, dist));
                                                        self.measure_p1 = None;
                                                    }
                                                },
                                                MeasureSub::Area => {
                                                    // Polygon-area pick-flow:
                                                    // each LMB click pushes a
                                                    // vertex into
                                                    // `measure_area_in_progress`;
                                                    // clicking near the FIRST
                                                    // vertex with >= 3 verts
                                                    // closes the polygon and
                                                    // commits `last_measure_area`.
                                                    // Right-click also closes
                                                    // (handled in the RMB arm).
                                                    let close_this_click = self.measure_area_in_progress.len() >= 3
                                                        && self.measure_area_in_progress.first()
                                                            .map(|first| {
                                                                let dx = world[0] - first[0];
                                                                let dy = world[1] - first[1];
                                                                let wpp = self.tabs.get(focus_tab)
                                                                    .map(|t| self.world_per_pixel_in(&t.cam, focus_rect))
                                                                    .unwrap_or(1.0);
                                                                let r = 8.0 * wpp;
                                                                (dx*dx + dy*dy).sqrt() < r
                                                            })
                                                            .unwrap_or(false);
                                                    if close_this_click {
                                                        let v = &self.measure_area_in_progress;
                                                        let mut perim = 0.0_f64;
                                                        for i in 0..v.len().saturating_sub(1) {
                                                            let dx = v[i + 1][0] - v[i][0];
                                                            let dy = v[i + 1][1] - v[i][1];
                                                            perim += (dx*dx + dy*dy).sqrt();
                                                        }
                                                        // Close-segment perim contribution.
                                                        if let (Some(first), Some(last)) =
                                                            (v.first().copied(), v.last().copied())
                                                        {
                                                            let dx = first[0] - last[0];
                                                            let dy = first[1] - last[1];
                                                            perim += (dx*dx + dy*dy).sqrt();
                                                        }
                                                        let area = polygon_area(v);
                                                        self.last_measure_area = Some((perim, area));
                                                        self.measure_area_in_progress.clear();
                                                    } else {
                                                        self.measure_area_in_progress.push(world);
                                                    }
                                                }
                                            }
                                        }
                                    }
                                    ToolMode::Move => {}
                                    // Annotate tools â€” per user request: linear maatlijn + area measurement, per-tab persistence
                                    ToolMode::Dimension => {
                                        if let Some(world) = self.screen_to_world_in(
                                            focus_tab, focus_rect,
                                            self.mouse_pos.0, self.mouse_pos.1)
                                        {
                                            match self.dim_p1 {
                                                None => { self.dim_p1 = Some(world); }
                                                Some(p1) => {
                                                    let world = if self.ortho_enabled {
                                                        ortho_constrain(p1, world)
                                                    } else { world };
                                                    if let Some(tab) = self.tabs.get_mut(focus_tab) {
                                                        tab.annotations.push(Annotation::LinearDim {
                                                            p1, p2: world, offset: 0.0,
                                                        });
                                                    }
                                                    self.dim_p1 = None;
                                                }
                                            }
                                        }
                                    }
                                    ToolMode::Area => {
                                        if let Some(world) = self.screen_to_world_in(
                                            focus_tab, focus_rect,
                                            self.mouse_pos.0, self.mouse_pos.1)
                                        {
                                            // Double-click (LMB release within short time
                                            // + distance near an existing vertex) closes
                                            // the polygon. Simple heuristic: clicking near
                                            // the last vertex with >= 3 verts commits.
                                            let close_this_click = self.area_in_progress.len() >= 3
                                                && self.area_in_progress.last()
                                                    .map(|last| {
                                                        let dx = world[0] - last[0];
                                                        let dy = world[1] - last[1];
                                                        // world-space radius ~= 6 px
                                                        let wpp = self.tabs.get(focus_tab)
                                                            .map(|t| self.world_per_pixel_in(&t.cam, focus_rect))
                                                            .unwrap_or(1.0);
                                                        let r = 6.0 * wpp;
                                                        (dx*dx + dy*dy).sqrt() < r
                                                    })
                                                    .unwrap_or(false);
                                            if close_this_click {
                                                let value = polygon_area(&self.area_in_progress);
                                                if let Some(tab) = self.tabs.get_mut(focus_tab) {
                                                    tab.annotations.push(Annotation::Area {
                                                        verts: std::mem::take(&mut self.area_in_progress),
                                                        value,
                                                    });
                                                } else {
                                                    self.area_in_progress.clear();
                                                }
                                            } else {
                                                self.area_in_progress.push(world);
                                            }
                                        }
                                    }
                                    // Blok 3 â€” Rotate: click 1 = pivot, click 2 = angle
                                    // target. Angle is atan2 of (click2 - pivot).
                                    ToolMode::Rotate => {
                                        if let Some(world) = self.screen_to_world_in(
                                            focus_tab, focus_rect,
                                            self.mouse_pos.0, self.mouse_pos.1)
                                        {
                                            match self.rotate_pivot {
                                                None => {
                                                    self.rotate_pivot = Some(world);
                                                    eprintln!("[Rotate] pivot set to {:?}", world);
                                                }
                                                Some(pivot) => {
                                                    let dx = world[0] - pivot[0];
                                                    let dy = world[1] - pivot[1];
                                                    if dx*dx + dy*dy > 1e-18 {
                                                        let angle = dy.atan2(dx);
                                                        let eids = self.selected_entity_ids_in(focus_tab);
                                                        if !eids.is_empty() {
                                                            eprintln!("[Rotate] commit pivot={:?} angle={:.4} rad ({:.2}Â°) eids={}",
                                                                pivot, angle, angle.to_degrees(), eids.len());
                                                            self.commit_rotate_in(focus_tab, eids, pivot, angle);
                                                        } else {
                                                            eprintln!("[Rotate] no selection â€” nothing to rotate");
                                                        }
                                                    }
                                                    self.rotate_pivot = None;
                                                }
                                            }
                                        }
                                    }
                                    // Blok 3 â€” Scale: three-click (pivot, ref, target).
                                    // factor = |target - pivot| / |ref - pivot|.
                                    // Uniform scale only; non-uniform deferred.
                                    ToolMode::Scale => {
                                        if let Some(world) = self.screen_to_world_in(
                                            focus_tab, focus_rect,
                                            self.mouse_pos.0, self.mouse_pos.1)
                                        {
                                            match (self.scale_pivot, self.scale_ref) {
                                                (None, _) => {
                                                    self.scale_pivot = Some(world);
                                                    self.scale_ref = None;
                                                    eprintln!("[Scale] pivot set to {:?}", world);
                                                }
                                                (Some(pivot), None) => {
                                                    let dx = world[0] - pivot[0];
                                                    let dy = world[1] - pivot[1];
                                                    if dx*dx + dy*dy > 1e-18 {
                                                        self.scale_ref = Some(world);
                                                        eprintln!("[Scale] ref set to {:?}", world);
                                                    } else {
                                                        eprintln!("[Scale] degenerate ref (zero distance) â€” ignored");
                                                    }
                                                }
                                                (Some(pivot), Some(refp)) => {
                                                    let rdx = refp[0] - pivot[0];
                                                    let rdy = refp[1] - pivot[1];
                                                    let rlen = (rdx*rdx + rdy*rdy).sqrt();
                                                    let tdx = world[0] - pivot[0];
                                                    let tdy = world[1] - pivot[1];
                                                    let tlen = (tdx*tdx + tdy*tdy).sqrt();
                                                    if rlen > 1e-9 && tlen.is_finite() {
                                                        let factor = tlen / rlen;
                                                        let eids = self.selected_entity_ids_in(focus_tab);
                                                        if !eids.is_empty() && factor > 0.0 {
                                                            eprintln!("[Scale] commit pivot={:?} factor={:.4} eids={}",
                                                                pivot, factor, eids.len());
                                                            self.commit_scale_in(focus_tab, eids, pivot, factor);
                                                        } else {
                                                            eprintln!("[Scale] no selection or bad factor ({}) â€” skip",
                                                                factor);
                                                        }
                                                    }
                                                    self.scale_pivot = None;
                                                    self.scale_ref = None;
                                                }
                                            }
                                        }
                                    }
                                    // Blok 3 â€” Mirror: two clicks define the axis,
                                    // second click commits.
                                    ToolMode::Mirror => {
                                        if let Some(world) = self.screen_to_world_in(
                                            focus_tab, focus_rect,
                                            self.mouse_pos.0, self.mouse_pos.1)
                                        {
                                            match self.mirror_a {
                                                None => {
                                                    self.mirror_a = Some(world);
                                                    eprintln!("[Mirror] axis A set to {:?}", world);
                                                }
                                                Some(a) => {
                                                    let dx = world[0] - a[0];
                                                    let dy = world[1] - a[1];
                                                    if dx*dx + dy*dy > 1e-18 {
                                                        let eids = self.selected_entity_ids_in(focus_tab);
                                                        if !eids.is_empty() {
                                                            eprintln!("[Mirror] commit a={:?} b={:?} eids={}",
                                                                a, world, eids.len());
                                                            self.commit_mirror_in(focus_tab, eids, a, world);
                                                        } else {
                                                            eprintln!("[Mirror] no selection â€” nothing to mirror");
                                                        }
                                                    }
                                                    self.mirror_a = None;
                                                }
                                            }
                                        }
                                    }
                                    // ZoomRegion releases are committed in
                                    // the outer if-branch above (which always
                                    // takes precedence for this mode), so the
                                    // inner per-tool match never reaches here.
                                    ToolMode::ZoomRegion => {}
                                    ToolMode::ZoomCenter => {
                                        // One-shot recenter — read world
                                        // coord at click, fly the camera
                                        // there (zoom unchanged), and
                                        // revert to Select.
                                        if let Some(world) = self.screen_to_world_in(
                                            focus_tab, focus_rect,
                                            self.mouse_pos.0, self.mouse_pos.1)
                                        {
                                            // Need to be careful: zoom_center_on
                                            // operates on the active tab. If the
                                            // click landed in a split-paired tab
                                            // we still recenter the active one
                                            // for consistency with Fit's behaviour.
                                            self.zoom_center_on(world);
                                        }
                                        self.tool_mode = ToolMode::Select;
                                    }
                                    ToolMode::MeasureAngle => {
                                        // Three-click angle: vertex,
                                        // ray1, ray2. Build up
                                        // `measure_angle_pts` then
                                        // compute on the third click.
                                        if let Some(world) = self.screen_to_world_in(
                                            focus_tab, focus_rect,
                                            self.mouse_pos.0, self.mouse_pos.1)
                                        {
                                            self.measure_angle_pts.push(world);
                                            if self.measure_angle_pts.len() == 3 {
                                                let v = self.measure_angle_pts[0];
                                                let a = self.measure_angle_pts[1];
                                                let b = self.measure_angle_pts[2];
                                                let ax = a[0] - v[0]; let ay = a[1] - v[1];
                                                let bx = b[0] - v[0]; let by = b[1] - v[1];
                                                let dot = ax * bx + ay * by;
                                                let cross = ax * by - ay * bx;
                                                let theta_rad = cross.atan2(dot).abs();
                                                self.last_measure_angle = Some((v, a, b, theta_rad));
                                                self.measure_angle_pts.clear();
                                            }
                                        }
                                    }
                                    ToolMode::MeasureCoord => {
                                        // One-shot coord readout — read,
                                        // remember (renderer draws label
                                        // until next click), do NOT
                                        // revert mode so the user can
                                        // sample multiple points.
                                        if let Some(world) = self.screen_to_world_in(
                                            focus_tab, focus_rect,
                                            self.mouse_pos.0, self.mouse_pos.1)
                                        {
                                            self.last_measure_coord = Some(world);
                                        }
                                    }
                                }
                            }
                            // Task 9 â€” double-click to enter text-edit. We
                            // check AFTER the click has been processed (so
                            // a click-on-text first selects, then the second
                            // click promotes it to an edit). 400 ms / 6 px
                            // window matches the OS norm for double-clicks.
                            let now = std::time::Instant::now();
                            let is_double = if let Some(prev) = self.last_lmb_click_time {
                                let elapsed = now.duration_since(prev);
                                let ddx = self.mouse_pos.0 - self.last_lmb_click_pos.0;
                                let ddy = self.mouse_pos.1 - self.last_lmb_click_pos.1;
                                let drift_dbl = (ddx*ddx + ddy*ddy).sqrt();
                                elapsed.as_millis() < 400 && drift_dbl < 6.0
                            } else { false };
                            if is_double
                                && self.tool_mode == ToolMode::Select
                                && self.edit_mode.is_none()
                            {
                                let active_tab = self.active_tab;
                                let eids = self.selected_entity_ids_in(active_tab);
                                if let Some(tab) = self.tabs.get(active_tab) {
                                    for eid in eids {
                                        if tab.scene.entity_text.get(eid as usize)
                                            .and_then(|o| o.as_ref()).is_some()
                                        {
                                            self.enter_text_edit(active_tab, eid);
                                            break;
                                        }
                                    }
                                }
                            }
                            self.last_lmb_click_time = Some(now);
                            self.last_lmb_click_pos = self.mouse_pos;
                        }
                    }
                }
            }
            WindowEvent::MouseWheel { delta, .. } => {
                // Per-tick zoom feel: a standard mouse wheel emits
                // LineDelta(_, ±1.0) per notch; a precision wheel /
                // trackpad emits PixelDelta in 1-30 px chunks. Map both
                // to a roughly comparable scale, then apply a 0.45×
                // exponent so one notch ≈ 1.45× zoom (was 1.30× — felt
                // sluggish on big drawings).
                let scroll = match delta {
                    MouseScrollDelta::LineDelta(_, y) => y,
                    MouseScrollDelta::PixelDelta(p) => p.y as f32 / 50.0,
                };
                let factor = (1.0 + scroll as f64 * 0.45).clamp(0.25, 4.0);
                if !self.mouse_in_canvas() { return; }
                // Mouse-anchored zoom: offset from canvas centre in world
                // pre-zoom coords, shift origin by delta * (1 - 1/factor).
                let (cx, cy, cw, ch) = self.canvas_rect;
                let centre_x = cx as f64 + cw as f64 * 0.5;
                let centre_y = cy as f64 + ch as f64 * 0.5;
                let dx_px = self.mouse_pos.0 as f64 - centre_x;
                let dy_px = self.mouse_pos.1 as f64 - centre_y;
                let (wpp, rot) = self.tabs.get(self.active_tab)
                    .map(|t| (self.world_per_pixel(&t.cam), t.cam.rotation))
                    .unwrap_or((1.0, 0.0));
                let ex = dx_px * wpp;
                let ey = -dy_px * wpp;
                // Rotate the screen-space offset into world space so
                // zoom-at-cursor stays anchored to the actual world point
                // under the mouse even when the canvas is rotated.
                let (ct, st) = (rot.cos(), rot.sin());
                let world_dx =  ct * ex + st * ey;
                let world_dy = -st * ex + ct * ey;

                let (old_zoom, actual_factor) = {
                    let tab = match self.tabs.get_mut(self.active_tab) {
                        Some(t) => t, None => return,
                    };
                    let oz = tab.cam.zoom;
                    let nz = (oz * factor).clamp(1e-12, 1e6);
                    let af = nz / oz;
                    tab.cam.zoom = nz;
                    (oz, af)
                };
                let _ = old_zoom;
                if let Some(tab) = self.tabs.get_mut(self.active_tab) {
                    let k = 1.0 - 1.0 / actual_factor;
                    tab.cam.pan_x += world_dx * k;
                    tab.cam.pan_y += world_dy * k;
                }
            }
            WindowEvent::RedrawRequested => {
                self.render();
                if let Some(w) = self.window.as_ref() { w.request_redraw(); }
            }
            _ => {}
        }
    }
}

// =============================================================================
// Sample discovery + file loading
// =============================================================================

fn discover_samples() -> Vec<SampleEntry> {
    let roots: &[(&str, &str)] = &[
        ("samples",         r"C:\Users\rickd\Desktop\dwg_samples"),
        ("nextgis",         r"C:\Users\rickd\Desktop\dwg_samples\nextgis"),
        ("acadsharp",       r"C:\Users\rickd\Desktop\dwg_samples\acadsharp\samples"),
        ("acadsharp/blocks",r"C:\Users\rickd\Desktop\dwg_samples\acadsharp\samples\dynamic-blocks"),
        ("acadsharp/aec",   r"C:\Users\rickd\Desktop\dwg_samples\acadsharp\samples\aec_objects"),
        ("acadsharp/base",  r"C:\Users\rickd\Desktop\dwg_samples\acadsharp\samples\sample_base"),
        ("libredwg/root",   r"C:\Users\rickd\Desktop\dwg_samples\libredwg-testdata\test\test-data"),
        ("libredwg/2010",   r"C:\Users\rickd\Desktop\dwg_samples\libredwg-testdata\test\test-data\2010"),
        ("libredwg/2013",   r"C:\Users\rickd\Desktop\dwg_samples\libredwg-testdata\test\test-data\2013"),
        ("libredwg/2018",   r"C:\Users\rickd\Desktop\dwg_samples\libredwg-testdata\test\test-data\2018"),
        ("desktop",         r"C:\Users\rickd\Desktop"),
    ];
    let mut out = Vec::new();
    for (group, root) in roots {
        let Ok(rd) = std::fs::read_dir(root) else { continue; };
        let mut entries: Vec<_> = rd.filter_map(|e| e.ok()).collect();
        entries.sort_by_key(|e| e.file_name());
        for entry in entries {
            let path = entry.path();
            if !path.is_file() { continue; }
            let name = path.file_name()
                .map(|n| n.to_string_lossy().into_owned())
                .unwrap_or_default();
            let lower = name.to_lowercase();
            let kind: &'static str = if lower.ends_with(".dwg") { "DWG" }
                else if lower.ends_with(".dxf") { "DXF" }
                else { continue; };
            let size = entry.metadata().map(|m| m.len()).unwrap_or(0);
            out.push(SampleEntry {
                label: format!("{}/{}", group, name),
                path:  path.to_string_lossy().into_owned(),
                size,
                kind,
            });
        }
    }
    eprintln!("[samples] discovered {} test files across {} dirs", out.len(), roots.len());
    out
}

/// Spawn a worker thread that runs `load_any` for `path` and sends the
/// resulting `Scene` back over an mpsc channel. Returns a `LoadingJob`
/// the App stores until the result lands. Catching panics keeps the UI
/// thread alive even if a parser/tessellator regression aborts.
fn spawn_load_job(path: String, tab_idx: usize) -> LoadingJob {
    let (tx, rx) = mpsc::channel();
    let path_for_thread = path.clone();
    let cancel = Arc::new(AtomicBool::new(false));
    let cancel_for_worker = cancel.clone();
    // Reset the dwg-parser process-global cancel flag so a previous
    // cancelled load doesn't pre-cancel this one. The host Arc has its
    // own fresh `false` state already; the parser static is shared
    // across the process. See dwg-parser/lib.rs::LOAD_CANCELLED.
    dwg_parser::reset_cancelled();
    std::thread::Builder::new()
        .name(format!("load:{}", short_path(&path)))
        .spawn(move || {
            // Install the cancel flag as a thread-local that the loaders
            // (`load_dwg` / `load_dxf`) consult at hot-path boundaries.
            // The guard restores the previous (None) value on drop.
            let _cancel_guard =
                crate::scene_io::set_load_cancel(cancel_for_worker.clone());
            let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                load_any_result(&path_for_thread)
            }));
            let msg = match result {
                Ok(Ok(scene)) => LoadingMsg::Done(Box::new(scene)),
                Ok(Err(e)) => {
                    if e.downcast_ref::<crate::scene_io::LoadCancelled>().is_some() {
                        LoadingMsg::Cancelled
                    } else {
                        LoadingMsg::Failed(format!("{}", e))
                    }
                }
                Err(panic) => {
                    if cancel_for_worker.load(Ordering::Relaxed) {
                        LoadingMsg::Cancelled
                    } else {
                        let what = panic.downcast_ref::<&'static str>().map(|s| (*s).to_string())
                            .or_else(|| panic.downcast_ref::<String>().cloned())
                            .unwrap_or_else(|| "panic in loader".to_string());
                        LoadingMsg::Failed(format!("loader panic: {}", what))
                    }
                }
            };
            let _ = tx.send(msg);
        })
        .expect("spawn loader thread");
    LoadingJob {
        rx,
        path,
        tab_idx,
        started_at: Instant::now(),
        cancel,
    }
}

/// Centered "Loadingâ€¦" card with a 12-dot spinner. Keeps users from
/// thinking the app crashed during a multi-second DWG open. Drawn from
/// the CentralPanel painter, after the inset border, so it sits on top
/// of the (mostly empty) wgpu placeholder scene.
fn paint_loading_overlay(
    ui: &mut egui::Ui,
    canvas: egui::Rect,
    file_label: &str,
    state: &LoadingState,
    cancel_flag: Option<&Arc<AtomicBool>>,
) {
    let painter = ui.painter().clone();
    // Soft scrim behind the card so the (likely empty) canvas behind
    // doesn't visually compete with the loading text.
    painter.rect_filled(
        canvas, 0.0,
        egui::Color32::from_rgba_unmultiplied(15, 18, 22, 140),
    );
    // Card. ~360x160 logical px (taller for Cancel button).
    let card_w = 360.0_f32.min(canvas.width() - 24.0).max(160.0);
    let card_h = 160.0_f32.min(canvas.height() - 24.0).max(100.0);
    let center = canvas.center();
    let card = egui::Rect::from_center_size(center, egui::vec2(card_w, card_h));
    painter.rect_filled(card, 8.0,
        egui::Color32::from_rgba_unmultiplied(28, 32, 38, 230));
    painter.rect_stroke(card, 8.0,
        egui::Stroke::new(1.0, egui::Color32::from_rgb(80, 86, 94)));

    // Animated 12-dot spinner â€” phase advances with wall-clock so it
    // visibly moves even when the worker thread doesn't post progress.
    let spin_center = egui::pos2(card.left() + 36.0, card.center().y);
    let elapsed = state.started_at.elapsed().as_secs_f32();
    let phase = (elapsed * 8.0) as usize % 12;
    for i in 0..12 {
        let theta = i as f32 * std::f32::consts::TAU / 12.0;
        let p = spin_center + egui::vec2(theta.cos() * 14.0, theta.sin() * 14.0);
        // Trailing-fade: dots ahead of phase are dim, dot AT phase is
        // brightest. Standard tail-spinner aesthetic.
        let age = (i + 12 - phase) % 12;
        let alpha = (220 - age as u8 * 16).max(40);
        painter.circle_filled(p, 2.4,
            egui::Color32::from_rgba_unmultiplied(255, 255, 255, alpha));
    }

    // File label + phase label + elapsed time, stacked to the right
    // of the spinner.
    let text_left = card.left() + 70.0;
    let text_top = card.top() + 18.0;
    painter.text(
        egui::pos2(text_left, text_top),
        egui::Align2::LEFT_TOP,
        format!("Loading {}", file_label),
        egui::FontId::proportional(14.0),
        egui::Color32::from_rgb(230, 230, 230),
    );
    painter.text(
        egui::pos2(text_left, text_top + 24.0),
        egui::Align2::LEFT_TOP,
        &state.phase,
        egui::FontId::proportional(12.0),
        egui::Color32::from_rgb(170, 170, 170),
    );
    painter.text(
        egui::pos2(text_left, text_top + 44.0),
        egui::Align2::LEFT_TOP,
        format!("{:.1}s elapsed", elapsed),
        egui::FontId::proportional(11.0),
        egui::Color32::from_rgb(130, 130, 130),
    );

    // Best-effort progress bar. Capped at the supplied fraction; we
    // don't yet update it from the worker thread (DWG load has only
    // coarse phase boundaries) but the spinner gives "alive" feedback
    // and the bar gradually advances based on wall-clock as a fallback
    // (saturates at 90% so it never falsely claims completion).
    let bar_top = card.bottom() - 50.0;
    let bar_rect = egui::Rect::from_min_size(
        egui::pos2(card.left() + 16.0, bar_top),
        egui::vec2(card.width() - 32.0, 4.0),
    );
    painter.rect_filled(bar_rect, 2.0,
        egui::Color32::from_rgba_unmultiplied(60, 64, 72, 220));
    let time_frac = (1.0 - (-elapsed / 12.0).exp()).min(0.9);
    let frac = state.fraction.max(time_frac);
    let fill_w = (bar_rect.width() * frac).clamp(0.0, bar_rect.width());
    let fill = egui::Rect::from_min_size(bar_rect.min, egui::vec2(fill_w, bar_rect.height()));
    painter.rect_filled(fill, 2.0, egui::Color32::from_rgb(80, 160, 230));

    // Cancel button. Skipped when no cancel flag is supplied. When
    // clicked we set the worker's cancel flag AND the dwg-parser
    // process-global flag - the worker observes the Arc<AtomicBool>
    // at scene_io entity-loop boundaries and the parser observes
    // its static flag inside parse_objects_r2000 / parse_object_map_*
    // every 256 iterations.
    if let Some(flag) = cancel_flag {
        let already = flag.load(Ordering::Relaxed);
        let btn_w = 96.0_f32;
        let btn_h = 28.0_f32;
        let btn_rect = egui::Rect::from_min_size(
            egui::pos2(card.right() - 16.0 - btn_w, card.bottom() - 16.0 - btn_h),
            egui::vec2(btn_w, btn_h),
        );
        let label = if already { "Cancelling..." } else { "Cancel" };
        let btn = egui::Button::new(label);
        let resp = ui.put(btn_rect, btn);
        if resp.clicked() && !already {
            flag.store(true, Ordering::Relaxed);
            // The dwg-parser crate lives behind a clean-room API
            // boundary and can't see the host's Arc, so it polls a
            // process-global static instead. Mirror the click here.
            // See dwg-parser/lib.rs::LOAD_CANCELLED.
            dwg_parser::LOAD_CANCELLED.store(true, Ordering::Relaxed);
            eprintln!("[load] cancel requested by user");
        }
    }
}

/// Trim a path for log/UI use: keep just the file name when possible.
fn short_path(path: &str) -> String {
    std::path::Path::new(path)
        .file_name()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_else(|| path.to_string())
}

fn load_any(path: &str, label: &'static str) -> Scene {
    match load_any_result(path) {
        Ok(s) => { eprintln!("[{}] {}", label, s.count_label); s }
        Err(e) => {
            eprintln!("[{}] load failed for {}: {:?}", label, path, e);
            Scene::empty(label, format!("load FAILED: {}", e))
        }
    }
}

/// Like `load_any` but propagates the underlying `Result` so callers
/// (the worker thread in `spawn_load_job`) can distinguish a real
/// failure from a `LoadCancelled` sentinel.
fn load_any_result(path: &str) -> anyhow::Result<Scene> {
    let lower = path.to_lowercase();
    if lower.ends_with(".dwg") {
        load_dwg(path)
    } else if lower.ends_with(".dxf") {
        load_dxf(path)
    } else if lower.ends_with(".ifcdraw") || lower.ends_with(".ifcx") {
        crate::ifcx_export::load_ifcdraw_scene(path)
            .map_err(|e| anyhow::anyhow!("ifcdraw load: {e}"))
    } else {
        Err(anyhow::anyhow!("unsupported extension"))
    }
}

// =============================================================================
// Recent-files persistence
// =============================================================================

fn recent_files_path() -> std::path::PathBuf {
    let base = std::env::var("APPDATA")
        .map(std::path::PathBuf::from)
        .unwrap_or_else(|_| std::path::PathBuf::from("."));
    base.join("open-2d-studio-viewer").join("recent.json")
}

fn load_recent_files() -> Vec<String> {
    let p = recent_files_path();
    let Ok(bytes) = std::fs::read(&p) else { return Vec::new(); };
    match serde_json::from_slice::<Vec<String>>(&bytes) {
        Ok(mut v) => { v.truncate(RECENT_FILES_MAX); v }
        Err(_) => Vec::new(),
    }
}

fn save_recent_files(list: &[String]) {
    let p = recent_files_path();
    if let Some(parent) = p.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    match serde_json::to_vec_pretty(list) {
        Ok(bytes) => {
            if let Err(e) = std::fs::write(&p, bytes) {
                eprintln!("[recent] save failed: {:?}", e);
            }
        }
        Err(e) => eprintln!("[recent] serialize failed: {:?}", e),
    }
}

/// Build the Ribbon tab definitions for the current frame. Pure
/// function â€” takes only the state slices it needs so it can be called
/// from inside the egui closure without holding `&mut App`. The button
/// `id` strings are matched against in the action dispatch above.
///
/// Phase 1 only ships a handful of `IconKind` variants â€” many CAD ribbon
/// actions reuse `IconKind::Rectangle` as a placeholder until Phase B
/// swaps in proper phosphor icons.
fn build_ribbon_tabs(
    tool: ToolMode,
    layers_open: bool,
    properties_open: bool,
    samples_open: bool,
    perf_hud: bool,
    split: Option<SplitKind>,
    mode: AppMode,
    grid_on: bool,
    white_bg_on: bool,
) -> Vec<RibbonTabDef> {
    let split_h = matches!(split, Some(SplitKind::HorizontalPair(_)));
    let split_v = matches!(split, Some(SplitKind::VerticalPair(_)));

    // Default Small/Medium = icon-only; only Large shows caption.
    fn b(id: &str, label: &str, icon: IconKind) -> RibbonButtonDef {
        RibbonButtonDef {
            id: id.into(), label: label.into(), icon,
            size: ButtonSize::Small, selected: false, enabled: false,
            show_caption: false,
        }
    }
    fn lg(id: &str, label: &str, icon: IconKind) -> RibbonButtonDef {
        RibbonButtonDef {
            id: id.into(), label: label.into(), icon,
            size: ButtonSize::Large, selected: false, enabled: false,
            show_caption: true,
        }
    }
    fn md(id: &str, label: &str, icon: IconKind) -> RibbonButtonDef {
        RibbonButtonDef {
            id: id.into(), label: label.into(), icon,
            size: ButtonSize::Medium, selected: false, enabled: false,
            show_caption: false,
        }
    }
    /// Small icon + inline caption â€” for Stack rows that read better
    /// with text (e.g. Selection: Select All / Deselect / Find).
    fn b_lbl(id: &str, label: &str, icon: IconKind) -> RibbonButtonDef {
        RibbonButtonDef {
            id: id.into(), label: label.into(), icon,
            size: ButtonSize::Small, selected: false, enabled: false,
            show_caption: true,
        }
    }
    fn enable(mut x: RibbonButtonDef) -> RibbonButtonDef { x.enabled = true; x }
    fn select(mut x: RibbonButtonDef, sel: bool) -> RibbonButtonDef { x.selected = sel; x }

    // -----------------------------------------------------------------
    // Viewer mode â€” strip every authoring group (Draw / Modify / Edit /
    // Clipboard / Collection / Annotate / Settings) and every authoring
    // ribbon tab (AEC / Pile Plan / IFC). The viewer keeps File, Home
    // (Selection + Pan + View navigation) and View; see the matching
    // Save / Tool-mode / F2 guards in `App::window_event` + the post-
    // closure dispatch block.
    // -----------------------------------------------------------------
    if matches!(mode, AppMode::Viewer) {
        // Viewer ribbon layout — mirrors the canonical mockup at
        // `docs/superpowers/mockups/Open2DViewerMockup.jsx` (lines
        // 632-754). Tabs: File | Home | View.
        //
        // Home groups (left-to-right):
        //   Selection — Select (L) · Pan (L) · stack3 Select All /
        //               Deselect / Find (Find disabled)
        //   Annotate  — Linear (L disabled) · stack3 disabled
        //               Angular/Radius/Diameter · stack3 disabled
        //               Leader/Label/Table
        //   Measure   — Length (L) · Area (L) · Angle (L) · Coord. (L)
        //   Clipboard — Copy (L) · stack3 Copy ID / Cut(disabled) /
        //               Delete(disabled)
        //   Panels    — Layers (L toggle) · Properties (L toggle)
        //
        // View groups:
        //   Navigate   — Pan (L)
        //   Zoom       — Fit All (L) · Zoom In (L) · Zoom Out (L) ·
        //                stack3 Window/Previous/Center
        //   Display    — Grid (L toggle) · White BG (L toggle)
        //   Appearance — Theme (L) + Theme picker dropdown
        //   Panels     — IFC Model (L toggle, disabled — visible only)
        let tabs: Vec<RibbonTabDef> = vec![
            RibbonTabDef {
                id: "file".into(),
                label: "File".into(),
                groups: vec![],
            },
            RibbonTabDef {
                id: "home".into(),
                label: "Home".into(),
                groups: vec![
                    RibbonGroup::with_layout("Selection", RibbonGroupLayout::LargeLeft {
                        large: enable(select(lg("select", "Select", IconKind::Move),
                            matches!(tool, ToolMode::Select))),
                        stacks: vec![
                            vec![
                                enable(b_lbl("select_all", "Select All", IconKind::SelectAll)),
                                enable(b_lbl("deselect", "Deselect", IconKind::Deselect)),
                                enable(b_lbl("find_replace", "Find", IconKind::Search)),
                            ],
                        ],
                    }),
                    // Pan stays as its own large to match mockup "Selection"
                    // group ordering (Select | Pan | stack).
                    RibbonGroup::with_layout(" ", RibbonGroupLayout::LargeOnly {
                        large: vec![enable(lg("pan", "Pan", IconKind::Pan))],
                    }),
                    // Edit -- minimal-edit surface in the Viewer port:
                    // Move (M), Delete (Del) and Explode (X). Three
                    // small icon+caption rows so the group sits
                    // compactly next to Selection / Pan without forcing
                    // a wide Large tile.
                    RibbonGroup::with_layout("Edit", RibbonGroupLayout::Stack {
                        rows: 2,
                        buttons: vec![
                            enable(select(b_lbl("move", "Move", IconKind::Move),
                                matches!(tool, ToolMode::Move))),
                            enable(b_lbl("delete", "Delete", IconKind::Delete)),
                            enable(b_lbl("explode", "Explode", IconKind::Ungroup)),
                        ],
                    }),
                    // Annotate group is authoring-only — omitted from
                    // Viewer ribbon (Phase 2). The viewer is strictly
                    // read-only so leaving disabled placeholders adds
                    // visual noise without affordance.
                    // Measure — 4 large buttons with the dedicated
                    // mockup glyphs (Length tape, Area pentagon, Angle
                    // rays-arc, Coord. crosshair).
                    RibbonGroup::with_layout("Measure", RibbonGroupLayout::LargeOnly {
                        large: vec![
                            enable(lg("measure_length", "Length", IconKind::MeasureLength)),
                            enable(lg("measure_area",   "Area",   IconKind::MeasureArea)),
                            enable(lg("measure_angle", "Angle", IconKind::MeasureAngle)),
                            enable(lg("measure_coord", "Coord.", IconKind::MeasureCoord)),
                        ],
                    }),
                    // Clipboard — Copy large + 3 disabled stacked smalls.
                    RibbonGroup::with_layout("Clipboard", RibbonGroupLayout::LargeLeft {
                        large: lg("copy_to_clipboard", "Copy", IconKind::Copy),
                        stacks: vec![
                            vec![
                                b_lbl("copy_id", "Copy ID", IconKind::CopyId),
                                b_lbl("cut",     "Cut",     IconKind::Cut),
                                b_lbl("delete",  "Delete",  IconKind::Delete),
                            ],
                        ],
                    }),
                    // Panels — Layers + Properties as 2 toggleable Large.
                    RibbonGroup::with_layout("Panels", RibbonGroupLayout::LargeOnly {
                        large: vec![
                            { let mut x = enable(lg("layers", "Layers", IconKind::Layers));
                              x.selected = layers_open; x },
                            { let mut x = enable(lg("properties", "Properties", IconKind::PanelR));
                              x.selected = properties_open; x },
                        ],
                    }),
                ],
            },
            RibbonTabDef {
                id: "view".into(),
                label: "View".into(),
                groups: vec![
                    RibbonGroup::with_layout("Navigate", RibbonGroupLayout::LargeOnly {
                        large: vec![enable(lg("pan", "Pan", IconKind::Pan))],
                    }),
                    // Mockup: 3 Large buttons (Fit All, Zoom In, Zoom Out)
                    // followed by a stack3 of small buttons (Window,
                    // Previous, Center).
                    RibbonGroup::with_layout("Zoom", RibbonGroupLayout::LargesPlusStacks {
                        larges: vec![
                            enable(lg("fit_extents", "Fit All", IconKind::FitAll)),
                            enable(lg("zoom_in",  "Zoom In",  IconKind::ZoomIn)),
                            enable(lg("zoom_out", "Zoom Out", IconKind::ZoomOut)),
                        ],
                        stacks: vec![
                            vec![
                                enable(b_lbl("zoom_window",   "Window",   IconKind::ZoomWindow)),
                                enable(b_lbl("zoom_previous", "Previous", IconKind::ZoomPrevious)),
                                enable(b_lbl("zoom_center",   "Center",   IconKind::ZoomCenter)),
                            ],
                        ],
                    }),
                    RibbonGroup::with_layout("Display", RibbonGroupLayout::LargeOnly {
                        large: vec![
                            { let mut x = enable(lg("grid", "Grid", IconKind::Grid));
                              x.selected = grid_on; x },
                            { let mut x = enable(lg("white_bg", "White BG", IconKind::Sun));
                              x.selected = white_bg_on; x },
                        ],
                    }),
                    RibbonGroup::with_layout("Appearance", RibbonGroupLayout::LargeOnly {
                        large: vec![enable(lg("theme", "Theme", IconKind::Palette))],
                    }),
                    // IFC Model toggle removed in the Viewer build per
                    // user request 2026-05-22 ("Bij het tabblad View
                    // kan je de IFC model weglaten"). IFC functionality
                    // is gated out of Viewer everywhere else (no IFC
                    // ribbon tab, no IFC panel, status-bar IFC pill
                    // hidden since 07b5f97) so the toggle was a
                    // dead-end affordance.
                ],
            },
        ];
        // Phase 2 will wire the new buttons; for now they're cosmetic
        // placeholders. Suppress unused-var warnings for now.
        let _ = split;
        let _ = samples_open;
        let _ = perf_hud;
        return tabs;
    }

    let mut tabs: Vec<RibbonTabDef> = vec![
        // The orange "File" tab is a click-only affordance: it opens the
        // app menu rather than swapping ribbon contents. Empty groups so
        // it never gets activated as the visible content tab.
        RibbonTabDef {
            id: "file".into(),
            label: "File".into(),
            groups: vec![],
        },
        RibbonTabDef {
            id: "home".into(),
            label: "Home".into(),
            groups: vec![
                RibbonGroup::with_layout("File", RibbonGroupLayout::LargeLeft {
                    large: enable(lg("open", "Open", IconKind::Folder)),
                    stacks: vec![
                        vec![
                            enable(b_lbl("new_tab", "New", IconKind::Rectangle)),
                            enable(b_lbl("save_as_dxf", "Save DXF", IconKind::Download)),
                        ],
                        vec![
                            enable(b_lbl("save_as_ifcdraw", "Save IFCDraw", IconKind::Download)),
                            // Save DWG -- opens the writer-in-development
                            // modal (see save_as_dwg_modal_open dispatch).
                            // Enabled in both Studio + Viewer; the modal
                            // routes through the DXF fallback either way
                            // until the binary writer ships.
                            enable(b_lbl("save_as_dwg", "Save DWG", IconKind::Download)),
                        ],
                    ],
                }),
                // 1.0 SELECTION: large `Select` + large `Pan` + 3-row
                // stack (Select All / Deselect / Find/Replace). Pan
                // surfaces as its own one-large group right after.
                RibbonGroup::with_layout("Selection", RibbonGroupLayout::LargeLeft {
                    large: enable(select(lg("select", "Select", IconKind::Move),
                        matches!(tool, ToolMode::Select))),
                    stacks: vec![
                        vec![
                            b_lbl("select_all", "Select All", IconKind::Check),
                            b_lbl("deselect", "Deselect", IconKind::Cross),
                            b_lbl("find_replace", "Find/Replace", IconKind::Search),
                        ],
                    ],
                }),
                RibbonGroup::with_layout(" ", RibbonGroupLayout::LargeOnly {
                    large: vec![enable(lg("pan", "Pan", IconKind::Hand))],
                }),
                RibbonGroup::with_layout("Draw", RibbonGroupLayout::Stack {
                    rows: 2,
                    buttons: vec![
                        md("draw_line", "Line", IconKind::Line),
                        md("draw_polyline", "Polyline", IconKind::Polyline),
                        md("draw_rect", "Rectangle", IconKind::Rectangle),
                        md("draw_circle", "Circle", IconKind::Circle),
                        md("draw_arc", "Arc", IconKind::Arc),
                        md("draw_ellipse", "Ellipse", IconKind::Ellipse),
                        md("draw_spline", "Spline", IconKind::Spline),
                        md("draw_region", "Filled Reg.", IconKind::Hatch),
                        md("draw_detail_line", "Line Comp.", IconKind::Line),
                        md("draw_l_shape", "L-Shape", IconKind::Polyline),
                        md("draw_text", "Text", IconKind::Text),
                        md("draw_image", "Image", IconKind::Image),
                        md("draw_pdf", "PDF", IconKind::Rectangle),
                    ],
                }),
                RibbonGroup::with_layout("Annotate", RibbonGroupLayout::LargeLeft {
                    // 1.0 layout: large `Aligned` + 3 stack columns with
                    // 3 rows each. Columns: Linear/Angular/Spot Â·
                    // Radius/Diameter/Leader Â· Label/Table/Cloud.
                    large: enable(select(lg("dim", "Aligned", IconKind::Dimension),
                        matches!(tool, ToolMode::Dimension))),
                    stacks: vec![
                        vec![
                            b_lbl("dim_linear", "Linear", IconKind::Dimension),
                            b_lbl("dim_angular", "Angular", IconKind::Arc),
                            b_lbl("dim_spot", "Spot Coord.", IconKind::Tag),
                        ],
                        vec![
                            b_lbl("dim_radius", "Radius", IconKind::Circle),
                            b_lbl("dim_diameter", "Diameter", IconKind::Circle),
                            b_lbl("leader", "Leader", IconKind::Line),
                        ],
                        vec![
                            b_lbl("label", "Label", IconKind::Tag),
                            b_lbl("table", "Table", IconKind::Grid),
                            b_lbl("cloud", "Cloud", IconKind::Spline),
                        ],
                    ],
                }),
                // 1.0 places `Measure` as a trailing large in ANNOTATE;
                // we surface it in its own group so the multi-large gap
                // doesn't leak through the layout enum.
                RibbonGroup::with_layout("Measure", RibbonGroupLayout::LargeOnly {
                    large: vec![
                        enable(lg("measure_length", "Length", IconKind::Dimension)),
                        enable(lg("measure_area",   "Area",   IconKind::Dimension)),
                    ],
                }),
                RibbonGroup::with_layout("Modify", RibbonGroupLayout::Stack {
                    rows: 2,
                    // Column-major fill: pairs are (idx 2n, 2n+1).
                    // 1.0 column order: Move/Mirror, Copy/Array, Rotate/Scale.
                    buttons: vec![
                        enable(select(b_lbl("move", "Move", IconKind::Move),
                            matches!(tool, ToolMode::Move))),
                        enable(select(b_lbl("mirror", "Mirror", IconKind::Mirror),
                            matches!(tool, ToolMode::Mirror))),
                        enable(b_lbl("duplicate", "Copy", IconKind::Copy)),
                        b_lbl("array", "Array", IconKind::Grid),
                        enable(select(b_lbl("rotate", "Rotate", IconKind::Rotate),
                            matches!(tool, ToolMode::Rotate))),
                        enable(select(b_lbl("scale", "Scale", IconKind::Scale),
                            matches!(tool, ToolMode::Scale))),
                    ],
                }),
                RibbonGroup::with_layout("Edit", RibbonGroupLayout::Stack {
                    rows: 2,
                    // Column-major: 1.0 columns are Trim/Fillet,
                    // Extend/Chamfer, Offset/Stretch, Split/Break,
                    // Align/Join, Explode/Lengthen.
                    buttons: vec![
                        b_lbl("trim", "Trim", IconKind::Cut),
                        b_lbl("fillet", "Fillet", IconKind::Arc),
                        b_lbl("extend", "Extend", IconKind::Line),
                        b_lbl("chamfer", "Chamfer", IconKind::Line),
                        b_lbl("offset", "Offset", IconKind::Polyline),
                        b_lbl("stretch", "Stretch", IconKind::Move),
                        b_lbl("split", "Split", IconKind::Cut),
                        b_lbl("break", "Break", IconKind::Cut),
                        b_lbl("align", "Align", IconKind::Line),
                        b_lbl("join", "Join", IconKind::Polyline),
                        b_lbl("explode", "Explode", IconKind::Ungroup),
                        b_lbl("lengthen", "Lengthen", IconKind::Line),
                    ],
                }),
                RibbonGroup::with_layout("Clipboard", RibbonGroupLayout::LargeLeft {
                    large: lg("paste", "Paste", IconKind::Paste),
                    stacks: vec![
                        vec![
                            b_lbl("cut", "Cut", IconKind::Cut),
                            b_lbl("copy", "Copy", IconKind::Copy),
                        ],
                        vec![
                            b_lbl("delete", "Delete", IconKind::Delete),
                        ],
                    ],
                }),
                RibbonGroup::with_layout("Collection", RibbonGroupLayout::LargeLeft {
                    large: lg("group_create", "Create", IconKind::Group),
                    stacks: vec![
                        vec![
                            b_lbl("group_explode", "Explode", IconKind::Ungroup),
                        ],
                    ],
                }),
                RibbonGroup::with_layout("Settings", RibbonGroupLayout::LargeOnly {
                    large: vec![
                        lg("settings", "Settings", IconKind::Settings),
                        lg("types_manager", "Types", IconKind::Layers),
                    ],
                }),
            ],
        },
        RibbonTabDef {
            id: "view".into(),
            label: "View".into(),
            groups: vec![
                RibbonGroup::with_layout("Navigate", RibbonGroupLayout::LargeOnly {
                    large: vec![lg("pan", "Pan", IconKind::Hand)],
                }),
                RibbonGroup::with_layout("Zoom", RibbonGroupLayout::LargeOnly {
                    large: vec![
                        lg("zoom_in", "Zoom In", IconKind::ZoomIn),
                        lg("zoom_out", "Zoom Out", IconKind::ZoomOut),
                        enable(lg("fit_extents", "Fit All", IconKind::FitAll)),
                    ],
                }),
                RibbonGroup::with_layout("Display", RibbonGroupLayout::LargeOnly {
                    large: vec![
                        { let mut x = enable(lg("grid", "Grid", IconKind::Grid));
                          x.selected = grid_on; x },
                        { let mut x = enable(lg("white_bg", "White BG", IconKind::Eye));
                          x.selected = white_bg_on; x },
                        lg("rot_gizmo", "Rot Gizmo", IconKind::Rotate),
                    ],
                }),
                RibbonGroup::with_layout("Filter", RibbonGroupLayout::LargeOnly {
                    large: vec![lg("ifc_filter", "IFC Filter", IconKind::Layers)],
                }),
                RibbonGroup::with_layout("Appearance", RibbonGroupLayout::LargeOnly {
                    large: vec![lg("theme", "Theme", IconKind::Settings)],
                }),
                RibbonGroup::with_layout("Panels", RibbonGroupLayout::LargeLeft {
                    large: lg("ifc_panel", "IFC Model", IconKind::Folder),
                    stacks: vec![
                        vec![
                            { let mut x = enable(b("layers", "Layers", IconKind::Layers));
                              x.selected = layers_open; x },
                            { let mut x = enable(b("properties", "Properties", IconKind::Rectangle));
                              x.selected = properties_open; x },
                        ],
                    ],
                }),
            ],
        },
        RibbonTabDef {
            id: "aec".into(),
            label: "AEC".into(),
            groups: vec![
                RibbonGroup::with_layout("Walls", RibbonGroupLayout::LargeLeft {
                    large: lg("aec_wall", "Wall", IconKind::Rectangle),
                    stacks: vec![
                        vec![
                            b("aec_door", "Door", IconKind::Rectangle),
                            b("aec_window", "Window", IconKind::Rectangle),
                        ],
                    ],
                }),
                RibbonGroup::with_layout("Structure", RibbonGroupLayout::Stack {
                    rows: 2,
                    buttons: vec![
                        b("aec_column", "Column", IconKind::Rectangle),
                        b("aec_beam", "Beam", IconKind::Line),
                        b("aec_slab", "Slab", IconKind::Rectangle),
                    ],
                }),
            ],
        },
        RibbonTabDef {
            id: "pile_plan".into(),
            label: "Pile Plan".into(),
            groups: vec![
                RibbonGroup::with_layout("Piles", RibbonGroupLayout::LargeLeft {
                    large: lg("pile_place", "Place Pile", IconKind::Circle),
                    stacks: vec![
                        vec![
                            b("pile_grid", "Pile Grid", IconKind::Grid),
                            b("pile_dim", "Auto-Dim", IconKind::Dimension),
                        ],
                    ],
                }),
                RibbonGroup::with_layout("Schedule", RibbonGroupLayout::LargeOnly {
                    large: vec![lg("pile_schedule", "Schedule", IconKind::Grid)],
                }),
            ],
        },
        RibbonTabDef {
            id: "ifc".into(),
            label: "IFC".into(),
            groups: vec![
                RibbonGroup::with_layout("Actions", RibbonGroupLayout::LargeLeft {
                    large: lg("ifc_export", "Export IFC", IconKind::Download),
                    stacks: vec![
                        vec![
                            b("ifc_export_folder", "Export Map", IconKind::Folder),
                            b("ifc_panel", "IFC Model", IconKind::Folder),
                        ],
                        vec![
                            b("ifc_regen", "Regenerate", IconKind::Refresh),
                            b("ifc_project", "Project", IconKind::Folder),
                        ],
                    ],
                }),
                RibbonGroup::with_layout("Bonsai Sync", RibbonGroupLayout::LargeLeft {
                    large: lg("bonsai_toggle", "Sync Off", IconKind::Refresh),
                    stacks: vec![
                        vec![
                            b("bonsai_sync_now", "Sync Now", IconKind::Refresh),
                            b("bonsai_copy_script", "Copy Script", IconKind::Copy),
                        ],
                    ],
                }),
            ],
        },
    ];

    // Devtools tab is dev-only â€” hidden from end-user builds. Opt-in by
    // setting `O2D_SHOW_DEVTOOLS=1` (or any non-empty value) in the
    // environment. The tab content (Split H/V, Samples, Perf HUD, Clear)
    // stays useful for development; we only hide the tab strip entry.
    if std::env::var("O2D_SHOW_DEVTOOLS").map(|v| !v.is_empty()).unwrap_or(false) {
        tabs.push(RibbonTabDef {
            id: "devtools".into(),
            label: "Devtools".into(),
            groups: vec![
                RibbonGroup::with_layout("Layout", RibbonGroupLayout::Stack {
                    rows: 2,
                    buttons: vec![
                        { let mut x = enable(b("split_h", "Split H", IconKind::Rectangle));
                          x.selected = split_h; x },
                        { let mut x = enable(b("split_v", "Split V", IconKind::Rectangle));
                          x.selected = split_v; x },
                        { let mut x = b("unsplit", "Unsplit", IconKind::Rectangle);
                          x.enabled = split.is_some(); x },
                    ],
                }),
                RibbonGroup::with_layout("Diagnostics", RibbonGroupLayout::Stack {
                    rows: 2,
                    buttons: vec![
                        { let mut x = enable(b("samples", "Samples", IconKind::Grid));
                          x.selected = samples_open; x },
                        { let mut x = enable(b("perf_hud", "Perf HUD", IconKind::Dimension));
                          x.selected = perf_hud; x },
                        enable(b("clear", "Clear", IconKind::Delete)),
                    ],
                }),
            ],
        });
    }

    tabs
}

/// Entry point shared by both binary shims (`open_2d_studio` and
/// `open_2d_viewer`). `mode` decides which UI variant is built â€”
/// Studio gets the full ribbon + editing tools, Viewer strips all
/// authoring affordances. `args` is everything after `argv[0]`.
pub fn run(args: Vec<String>, mode: AppMode) -> anyhow::Result<()> {
    // ---- Windows-only: bind taskbar/Alt-Tab to our explicit AppUserModelID.
    //
    // Without this, Windows 10/11 invents an AUMI per-process based on the
    // host shell behaviour, and the taskbar entry pulls a generic Rust /
    // command-line default icon instead of the IDI_ICON1 we embedded via
    // `build.rs` (winres). winit's `Window::set_window_icon` only affects
    // the title bar painted inside our window â€” the taskbar reads the AUMI
    // (and through it the .exe resource / .lnk IconLocation). Calling
    // SetCurrentProcessExplicitAppUserModelID BEFORE any window is created
    // is the supported MSDN path. See:
    //   learn.microsoft.com/windows/win32/shell/appids
    //   learn.microsoft.com/windows/win32/api/shobjidl_core/nf-shobjidl_core-setcurrentprocessexplicitappusermodelid
    //
    // Different AUMI per variant so Studio + Viewer don't share a taskbar
    // group (each gets its own pinnable entry + its own icon).
    #[cfg(windows)]
    {
        use windows::core::PCWSTR;
        use windows::Win32::UI::Shell::SetCurrentProcessExplicitAppUserModelID;
        let aumi: Vec<u16> = match mode {
            AppMode::Viewer => "OpenAEC.Open2DViewer.1\0".encode_utf16().collect(),
            AppMode::Studio => "OpenAEC.Open2DStudio.1\0".encode_utf16().collect(),
        };
        // SAFETY: AUMI buffer is a NUL-terminated UTF-16 string we own for
        // the lifetime of the call. The function does not retain the
        // pointer (it copies into the process token). Errors here are
        // non-fatal â€” log them and continue; worst case taskbar icon
        // grouping just isn't perfect.
        unsafe {
            if let Err(e) = SetCurrentProcessExplicitAppUserModelID(PCWSTR(aumi.as_ptr())) {
                eprintln!("[branding] SetCurrentProcessExplicitAppUserModelID failed: {:?}", e);
            }
        }
    }

    // CLI args:
    //   (none)              â†’ single blank tab.
    //   <base>              â†’ legacy base-path mode: load <base>.dxf + <base>.dwg as two tabs.
    //   f1.dxf f2.dwg â€¦     â†’ each file arg becomes its own tab.

    // Collect the paths CLI mode would have loaded synchronously, but
    // hand them off to the background loader after App::new so the
    // window appears IMMEDIATELY with a spinner overlay instead of
    // freezing at the OS level for the duration of a big DWG parse.
    let mut deferred_paths: Vec<String> = Vec::new();
    if args.len() == 1
        && !args[0].to_lowercase().ends_with(".dwg")
        && !args[0].to_lowercase().ends_with(".dxf")
        && !args[0].to_lowercase().ends_with(".ifcdraw")
    {
        let base = args[0].trim_end_matches(".dxf").trim_end_matches(".dwg").to_string();
        eprintln!("[open_2d_studio] base={}  tab 1 â† DXF, tab 2 â† DWG", base);
        deferred_paths.push(format!("{}.dxf", base));
        deferred_paths.push(format!("{}.dwg", base));
    } else {
        deferred_paths.extend(args.iter().cloned());
    }

    let event_loop = EventLoop::new()?;
    let mut app = App::new(Vec::new());
    app.mode = mode;
    // Queue background loads BEFORE entering the event loop. App::new
    // already pushed a single blank "Start" tab; remove it if we have
    // real files to load so the user only sees the placeholder tabs.
    if !deferred_paths.is_empty() {
        app.tabs.clear();
        app.active_tab = 0;
        for path in deferred_paths {
            app.start_load_into_new_tab(path);
        }
    }
    event_loop.run_app(&mut app)?;
    Ok(())
}

/// Generate a 160x120 preview thumbnail for the file picker. Runs on a
/// worker thread; returns `None` on parse failure / unsupported format.
fn generate_preview_image(path: &std::path::Path) -> Option<egui::ColorImage> {
    let started = Instant::now();
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .map(|s| s.to_ascii_lowercase())
        .unwrap_or_default();
    let segments: Vec<(f32, f32, f32, f32)> = match ext.as_str() {
        "dxf" => extract_dxf_preview_segments(path).unwrap_or_default(),
        _ => Vec::new(),
    };
    if started.elapsed().as_millis() > 500 {
        eprintln!(
            "[file-picker] preview budget exceeded for {} ({} ms, {} segs)",
            path.display(),
            started.elapsed().as_millis(),
            segments.len(),
        );
    }
    if segments.is_empty() {
        return None;
    }
    Some(superui::dialogs::rasterize_segments(&segments, 160, 120))
}

/// Stream-parse a DXF file's first ENTITIES section and pull out LINE
/// endpoints. Bounded at 6000 segments / 200k input lines.
fn extract_dxf_preview_segments(
    path: &std::path::Path,
) -> std::io::Result<Vec<(f32, f32, f32, f32)>> {
    use std::io::BufRead;
    let file = std::fs::File::open(path)?;
    let reader = std::io::BufReader::new(file);
    let mut out: Vec<(f32, f32, f32, f32)> = Vec::with_capacity(2048);
    let mut lines = reader.lines();
    let mut in_line_entity = false;
    let mut x1 = f32::NAN;
    let mut y1 = f32::NAN;
    let mut x2 = f32::NAN;
    let mut y2 = f32::NAN;
    let mut total_lines = 0u32;
    while let (Some(code_line), Some(value_line)) = (lines.next(), lines.next()) {
        total_lines += 2;
        if total_lines > 200_000 || out.len() >= 6000 {
            break;
        }
        let Ok(code) = code_line else { continue; };
        let Ok(value) = value_line else { continue; };
        let code = code.trim();
        let value = value.trim();
        if code == "0" {
            if in_line_entity
                && x1.is_finite() && y1.is_finite()
                && x2.is_finite() && y2.is_finite()
            {
                out.push((x1, y1, x2, y2));
            }
            in_line_entity = value == "LINE";
            x1 = f32::NAN; y1 = f32::NAN; x2 = f32::NAN; y2 = f32::NAN;
            continue;
        }
        if !in_line_entity {
            continue;
        }
        match code {
            "10" => x1 = value.parse().unwrap_or(f32::NAN),
            "20" => y1 = value.parse().unwrap_or(f32::NAN),
            "11" => x2 = value.parse().unwrap_or(f32::NAN),
            "21" => y2 = value.parse().unwrap_or(f32::NAN),
            _ => {}
        }
    }
    if in_line_entity
        && x1.is_finite() && y1.is_finite()
        && x2.is_finite() && y2.is_finite()
    {
        out.push((x1, y1, x2, y2));
    }
    Ok(out)
}
