//! Open 2D Studio — tabbed DWG/DXF viewer (browser-style file tabs).
//!
//! (Bin renamed 2026-05-01 from split_compare to open_2d_studio. The
//! split-pane comparison binary lineage stays in git history.) Refactored
//! 2026-04-21 from a fixed 4-pane TL/TR/BL/BR grid into a single-canvas
//! viewer with an arbitrary number of open-file tabs, TrueView-style.
//! Each tab owns its own Scene + camera + GPU line / triangle pipelines +
//! selection + hidden-layer set + per-tab Move-tool undo stack. Opening a
//! new file always creates a new tab (Ctrl+O / File menu / Samples panel
//! all push). Close with the × button on the tab or Ctrl+W. Cycle with
//! Ctrl+Tab / Ctrl+Shift+Tab.
//!
//! Usage:
//!   open_2d_studio                     # no args — start with a blank tab
//!   open_2d_studio <base>              # legacy "base" mode: open <base>.dxf + <base>.dwg as two tabs
//!   open_2d_studio file.dxf file.dwg … # each arg becomes a tab

use bytemuck::{Pod, Zeroable};
use egui_wgpu::ScreenDescriptor;
use std::collections::{HashMap, HashSet};
use std::sync::Arc;
use std::time::Instant;
use winit::application::ApplicationHandler;
use winit::event::{ElementState, KeyEvent, MouseButton, MouseScrollDelta, WindowEvent};
use winit::event_loop::{ActiveEventLoop, EventLoop};
use winit::keyboard::{KeyCode, ModifiersState, PhysicalKey};
use winit::window::Window;

// superui — reusable chrome widgets (titlebar, ribbon, file-tab bar,
// status bar). Phase 1 of the UI-crate migration replaces the inline
// painter helpers below with these data-driven widgets so future
// applications can reuse them.
use superui::{
    apply_theme, Theme,
    layout::{
        TitleBar, TitleBarAction,
        Ribbon, RibbonAction, RibbonTabId, RibbonTabDef, RibbonGroup, RibbonButtonDef, ButtonSize,
        FileTabBar, FileTabAction, FileTabDef,
        StatusBar, StatusSection,
    },
    icon::IconKind,
};

// Scene / Segment / load_dxf / load_dwg are shared with headless_render.rs
// via the kernel_app::scene_io module. See crates/app/src/scene_io.rs for
// the implementation (INSERT block expansion, HATCH boundary tessellation,
// affine transform composition, etc.).
use kernel_app::scene_io::{load_dwg, load_dxf, Scene, TriKind};
use kernel_app::ifcx_export::write_ifcx_binary;
use kernel_app::dxf_export::write_dxf;
use kernel_spatial::{SegmentEntry, SegmentIndex};

// =============================================================================
// SceneIndex — combined acceleration structure for picking + selection rebuild.
//
// Built lazily on the first cursor-move after a scene loads (and dropped on any
// mutation that touches `scene.segments` or `segment_entity_idx`). Two pieces:
//
//   * `seg_rtree` — `kernel_spatial::SegmentIndex` over the segment AABBs.
//     Replaces a 688k linear scan in `pick_segment_at_in` with an
//     O(log n + k) point query.
//
//   * `entity_to_segs` — for every `entity_idx` value in the scene, the list
//     of segment indices that share that id. Replaces a 688k linear scan
//     in `rebuild_sel_pipe` (per selected/hovered entity) with a direct
//     `Vec<u32>` lookup.
// =============================================================================
struct SceneIndex {
    seg_rtree: SegmentIndex,
    /// Indexed by `entity_idx`. Empty inner Vecs are normal — entity ids
    /// are dense but small gaps occur. Built once per scene-load.
    entity_to_segs: Vec<Vec<u32>>,
}

impl SceneIndex {
    /// Build both structures from the scene in one pass over `segments`.
    /// Caller is responsible for calling this only when the scene has
    /// at least one segment — early-out is up to them.
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

        // Build the rtree entry list and the entity → segs lookup together.
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
// GPU rendering (line pipeline — one buffer per tab)
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
// Ribbon — design tokens + custom-drawn vector icons
// =============================================================================
//
// The ribbon style is defined once here as an immutable palette. Goal: remove
// the "techy" feel of emoji + default dark theme and land on a warm-dark,
// designer-friendly look — VSCode-blue accents, off-white labels, subtle
// group separators. All buttons draw their own icons via `egui::Painter`
// (see `paint_icon`) so stroke weight, metrics and colour stay uniform at
// every zoom level — unlike font-embedded emoji which render inconsistently.

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

/// Ribbon group — a vertical stack with a row of buttons, a thin 1 px top
/// and bottom hair-line, and a small uppercase label below. The subtle
/// border framing boxes the group without adding visual noise.
///
/// The contents closure is expected to place buttons in a horizontal row;
/// big buttons (48×52) and small-label stacks (3 × 22 px) are centred on a
/// common vertical axis so the group looks balanced regardless of which
/// primitives it mixes.
/// 2D view-cube / nav-disk widget painted in the bottom-right corner of
/// the canvas. For 2D CAD the "cube" is a compass-wheel: a dark disk
/// with 4 cardinal arrows that rotate with the camera, a centre "Fit"
/// button, and a top-right "1:1" reset pip.
///
/// Interaction:
///   * click N / E / S / W — snap the camera rotation to the nearest
///     90° multiple that aligns world +X with screen right (E), etc.
///   * drag anywhere on the disk — rotate the camera by the angular
///     delta from the drag-start position around the disk centre.
///   * click centre   — fit extents (requested_fit)
///   * click 1:1 pip  — reset zoom to 1 + fit (requested_home)
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
    // window. This is the same pattern the Perf HUD uses — which has
    // always rendered reliably on this pipeline — in contrast to
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
            // correctly — the later painter draws at absolute screen
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
    // counter-clockwise on screen when rotation grows positive — which
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

    // Four cardinal arrows — compass space, rotated to screen by rot_pt.
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
        // Label — small letter inside the arrow, also counter-rotated
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

    // Drag rotation — skip if the pointer is inside one of the
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
            // Unwrap the atan2 discontinuity across ±π.
            if delta >  std::f64::consts::PI { delta -= std::f64::consts::TAU; }
            if delta < -std::f64::consts::PI { delta += std::f64::consts::TAU; }
            // Drag CW on screen → camera rotates CW → rotation decreases
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

/// Docked tool-window title bar — a 22 px tall strip with a small title
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
    let header_h = 22.0;
    let full_w = ui.available_width();
    let (rect, _resp) = ui.allocate_exact_size(
        egui::vec2(full_w, header_h),
        egui::Sense::hover(),
    );
    let painter = ui.painter_at(rect);
    // Background strip — slightly darker than panel fill, with a 1 px
    // bottom hairline for separation.
    painter.rect_filled(rect, 0.0, egui::Color32::from_rgb(30, 33, 37));
    painter.line_segment(
        [egui::pos2(rect.left(), rect.bottom() - 0.5),
         egui::pos2(rect.right(), rect.bottom() - 0.5)],
        egui::Stroke::new(1.0, RIBBON.separator),
    );
    // Title.
    let galley = painter.layout_no_wrap(
        title.to_string(),
        egui::FontId::proportional(11.0),
        RIBBON.label_bold,
    );
    painter.galley(
        egui::pos2(rect.left() + 10.0, rect.center().y - galley.size().y * 0.5),
        galley,
        RIBBON.label_bold,
    );
    // Chevron button — 16x16 at the right edge. "×" glyph for close.
    let btn_size = egui::vec2(16.0, 16.0);
    let btn_rect = egui::Rect::from_min_size(
        egui::pos2(rect.right() - btn_size.x - 6.0, rect.center().y - btn_size.y * 0.5),
        btn_size,
    );
    let btn_resp = ui.interact(btn_rect, egui::Id::new(("panel_close", title)), egui::Sense::click());
    let btn_bg = if btn_resp.hovered() {
        egui::Color32::from_rgba_premultiplied(60, 70, 84, 180)
    } else {
        egui::Color32::TRANSPARENT
    };
    if btn_bg != egui::Color32::TRANSPARENT {
        painter.rect_filled(btn_rect, 2.0, btn_bg);
    }
    let c = btn_rect.center();
    let k = 4.0;
    let stroke = egui::Stroke::new(1.4, RIBBON.label_bold);
    painter.line_segment(
        [egui::pos2(c.x - k, c.y - k), egui::pos2(c.x + k, c.y + k)], stroke);
    painter.line_segment(
        [egui::pos2(c.x + k, c.y - k), egui::pos2(c.x - k, c.y + k)], stroke);
    on_result(PanelHeaderResult {
        chevron_clicked: btn_resp.clicked(),
    });
}

/// Build line-segment vertex buffer for a single scene.
///
/// `hidden_layers` filters out segments whose derived layer key is in
/// the set (matches the behaviour of the old 4-pane build_verts).
fn build_verts(
    scene: &Scene,
    origin: [f64; 2],
    default_color: u32,
    want_paper: bool,
    hidden_layers: &HashSet<String>,
) -> Vec<Vertex> {
    let mut out = Vec::with_capacity(scene.segments.len() * 2);
    let use_real_layers = !scene.layer_names.is_empty()
        && scene.segment_layer_idx.len() == scene.segments.len();
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
        out.push(Vertex { pos: p1, color, _pad: 0 });
        out.push(Vertex { pos: p2, color, _pad: 0 });
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

/// Enumerate distinct layer keys in a scene — (layer_name, sample_rgba).
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
        let (device, queue) = adapter.request_device(&wgpu::DeviceDescriptor {
            label: Some("open_2d_studio"),
            required_features: wgpu::Features::empty(),
            required_limits: wgpu::Limits::default(),
            memory_hints: wgpu::MemoryHints::Performance,
        }, None).await?;
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
    /// when viewed on-screen — matches the view-cube compass direction.
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
/// per pane — matches the old TL (green) for familiarity.
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
/// side-by-side with independent cameras. Keeps the tab model flat — no
/// nested recursive split tree — which is all the first cut needs.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum SplitKind {
    /// Left = this tab, Right = other tab.
    HorizontalPair(usize),
    /// Top = this tab, Bottom = other tab.
    VerticalPair(usize),
}

/// One open file — a browser-style tab.
///
/// Owns everything that used to live in the parallel arrays on the old
/// 4-pane App. The GPU pipelines are per-tab and rebuilt on load /
/// layer-toggle / layout-switch. `move_undo_stack` is per-tab so
/// undo stays local to the file the user edited.
struct FileTab {
    scene: Scene,
    path: Option<String>,
    label: String,

    cam: PaneCam,
    show_paper: bool,
    hidden_layers: HashSet<String>,

    // GPU — lazily built once self.gpu exists.
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
    /// (entity_idx, world_press_pos) — None when no drag in progress.
    /// Legacy single-entity move drag — kept for backwards compatibility.
    /// Multi-entity moves now use `move_drag_multi`.
    move_drag: Option<(u32, [f64; 2])>,
    /// Multi-entity move drag: list of entity ids being dragged + the
    /// world-space press position. Mirrors the live preview offset in
    /// `pending_move_offset`.
    move_drag_multi: Option<(Vec<u32>, [f64; 2])>,
    pending_move_offset: [f64; 2],
    /// Generalised undo stack: Move / Delete / Paste — capped at 20.
    /// Replaces the old `move_undo_stack` so all destructive edits share
    /// a single history.
    undo_stack: Vec<EditOp>,

    /// If set, this tab renders side-by-side with another tab in the same
    /// canvas area. See `SplitKind`. Only the *primary* (this) tab holds the
    /// split; the paired tab is still just a normal tab accessible via the
    /// tab strip.
    split_kind: Option<SplitKind>,

    // Annotate tools — per user request: linear maatlijn + area measurement, per-tab persistence
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
}

/// Snapshot of one entity captured before deletion / cut. Stores enough
/// data to re-insert the entity exactly as it was (segments + triangles +
/// per-fragment layer indices + the original entity id + entity name).
/// Used for undo and clipboard.
#[derive(Clone)]
struct DeletedEntity {
    entity_idx: u32,
    name: Option<String>,
    /// (segment, layer_idx) — layer_idx may be u16::MAX as a sentinel
    /// meaning "no layer table for this scene", in which case re-insert
    /// just skips the layer-idx push.
    segments: Vec<(Segment, u16)>,
    triangles: Vec<(Triangle, u16)>,
}

use kernel_app::scene_io::{Segment, Triangle};

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
    // Blok 3 — geometric transforms on selection. Inverses:
    // Rotate -> apply -angle around same pivot
    // Scale  -> apply 1/factor around same pivot
    // Mirror -> apply the same mirror again (twice = identity)
    Rotate { eids: Vec<u32>, pivot: [f64; 2], angle: f64 },
    Scale  { eids: Vec<u32>, pivot: [f64; 2], factor: f64 },
    Mirror { eids: Vec<u32>, axis_a: [f64; 2], axis_b: [f64; 2] },
    /// Re-tessellation of a text entity (F2 edit). Inverse: restore the
    /// previous segments/triangles snapshot via `restore_text_entity`.
    EditText { text_delta: kernel_app::scene_io::TextEntityDelta },
}

impl FileTab {
    fn new(scene: Scene, path: Option<String>) -> Self {
        let label = Self::derive_label(path.as_deref());
        let cam = PaneCam::fit(&scene.bbox);
        Self {
            scene,
            path,
            label,
            cam,
            show_paper: false,
            hidden_layers: HashSet::new(),
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
            // Annotate tools — per user request: linear maatlijn + area measurement, per-tab persistence
            annotations: Vec::new(),
            annotation_pipe: None,
            scene_index: None,
        }
    }

    /// Lazily build the scene's spatial + entity index. Cheap re-entry —
    /// returns immediately when the index already exists. Bulk-loading the
    /// rstar costs ~30-60 ms for 700k segments on release; we only pay that
    /// once per scene-load.
    fn ensure_scene_index(&mut self) {
        if self.scene_index.is_some() { return; }
        if self.scene.segments.is_empty() { return; }
        let t0 = Instant::now();
        let idx = SceneIndex::build(&self.scene);
        eprintln!(
            "[scene_index] built in {:.2} ms — {} segs, {} entities",
            t0.elapsed().as_secs_f64() * 1000.0,
            self.scene.segments.len(),
            idx.entity_to_segs.len(),
        );
        self.scene_index = Some(idx);
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

    /// Rebuild the GPU line + triangle pipelines for this tab after a
    /// load / layer toggle / layout switch. Reuses existing buffers when
    /// capacity permits.
    fn rebuild_buffers(&mut self, gpu: &GpuCtx) {
        // Any scene-mutating path lands here. Drop the cached spatial /
        // entity index so the next pick rebuilds against the new geometry.
        self.scene_index = None;

        let hidden = &self.hidden_layers;
        let want_paper = self.show_paper;

        // Build all vertex lists now so we only need an immutable view
        // of self.scene for the duration.
        let model_verts = build_verts(&self.scene, self.cam.origin, DEFAULT_LINE_COLOR, false, hidden);
        let paper_verts = build_verts(&self.scene, self.cam.origin, DEFAULT_LINE_COLOR, true, hidden);
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

struct App {
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

    // --- Selection / click tracking ---------------------------------
    lmb_pressed: bool,
    lmb_press_pos: (f32, f32),
    /// Tab index that owns the current LMB press (latched at press-time).
    /// In split mode this is whichever pane the cursor was in when the
    /// click started, so release-time picks / moves don't jump tabs mid-drag.
    lmb_press_tab: usize,
    /// Canvas sub-rect (physical px) of the pane that owns the current
    /// LMB press. Used for screen→world + pick-radius math at release.
    lmb_press_rect: (f32, f32, f32, f32),

    // --- Tools -------------------------------------------------------
    tool_mode: ToolMode,
    /// First point of an in-progress measurement (always in the active tab).
    measure_p1: Option<[f64; 2]>,
    /// Last completed measurement: (p1_world, p2_world, distance).
    last_measurement: Option<([f64; 2], [f64; 2], f64)>,

    // Annotate tools — per user request: linear maatlijn + area measurement, per-tab persistence
    /// First point of an in-progress Dimension placement (world coords).
    dim_p1: Option<[f64; 2]>,
    /// In-progress vertex list for the Area polygon tool.
    area_in_progress: Vec<[f64; 2]>,
    /// Cached last-seen world-space cursor position, used to draw the
    /// "rubber band" from last vertex to cursor in Area mode. Updated on
    /// CursorMoved.
    cursor_world: Option<[f64; 2]>,

    // --- Recent files ------------------------------------------------
    recent_files: Vec<String>,

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

    // Blok 3 — Rotate / Scale / Mirror tool state.
    // All three tools are two-click gestures. First click stashes a world
    // anchor; second click/drag-release commits the transform. State clears
    // on ToolMode switch + Esc.
    /// First click (pivot) for the Rotate tool — world coords.
    rotate_pivot: Option<[f64; 2]>,
    /// First click (pivot) for the Scale tool — world coords. Subsequent
    /// LMB press+drag+release defines the factor (|release - pivot| /
    /// |press - pivot|).
    scale_pivot: Option<[f64; 2]>,
    /// Press-time anchor for the Scale drag so factor is stable against
    /// cursor jitter at press time. Filled on LMB press after pivot exists.
    scale_ref: Option<[f64; 2]>,
    /// First click (axis anchor A) for the Mirror tool.
    mirror_a: Option<[f64; 2]>,

    /// Set by the keyboard handler when Ctrl+D was pressed — duplicate
    /// selected entities into fresh ids with a small offset. Reuses the
    /// Paste undo variant since semantics are identical.
    requested_duplicate: bool,

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
}

/// Per-section render timings — one frame.
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

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum ToolMode {
    Select,
    Measure,
    Move,
    // Annotate tools — per user request: linear maatlijn + area measurement, per-tab persistence
    Dimension,
    Area,
    // Blok 3 — per user request: Rotate / Scale / Mirror transforms on selection.
    // Each tool is a two-click gesture committed on the second LMB release.
    // Live-preview is intentionally NOT wired (Scale is drag-based).
    Rotate,
    Scale,
    Mirror,
}

// Annotate tools — per user request: linear maatlijn + area measurement, per-tab persistence
/// Persistent drawing annotations created by the Dimension / Area tools.
/// Stored per-tab (see `FileTab::annotations`) so each loaded file owns its
/// own set. No undo, no snap, no grid — purely an on-top visual overlay.
#[derive(Clone, Debug)]
enum Annotation {
    /// Linear dimension between P1 and P2. `offset` is the signed perpendicular
    /// distance from the baseline to the dim-line (positive = left of P1→P2
    /// direction). Currently always 0 at creation time — future UI could add
    /// a drag handle to pull the dim-line off the measured edge.
    LinearDim { p1: [f64; 2], p2: [f64; 2], offset: f64 },
    /// Closed polygon with pre-computed shoelace area (world units²).
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
            properties_panel_open: true,
            about_dialog_open: false,
            lmb_pressed: false, lmb_press_pos: (0.0, 0.0),
            lmb_press_tab: 0,
            lmb_press_rect: (0.0, 0.0, 0.0, 0.0),
            tool_mode: ToolMode::Select,
            measure_p1: None,
            last_measurement: None,
            // Annotate tools — per user request: linear maatlijn + area measurement, per-tab persistence
            dim_p1: None,
            area_in_progress: Vec::new(),
            cursor_world: None,
            recent_files: load_recent_files(),
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
            // Blok 3 — Rotate/Scale/Mirror + duplicate state (idle).
            rotate_pivot: None,
            scale_pivot: None,
            scale_ref: None,
            mirror_a: None,
            requested_duplicate: false,
            // Text editor (Task 9): no edit in flight, no prior click.
            edit_mode: None,
            last_lmb_click_time: None,
            last_lmb_click_pos: (0.0, 0.0),
            // Ribbon defaults to the Home tab on launch — matches 1.0
            // reference (orange underline + light bg on Home at first paint).
            active_ribbon_tab: "home".to_string(),
        }
    }

    fn modifiers_ctrl_held(&self) -> bool { self.modifiers.control_key() }
    fn modifiers_shift_held(&self) -> bool { self.modifiers.shift_key() }

    #[allow(dead_code)]
    fn active(&self) -> Option<&FileTab> { self.tabs.get(self.active_tab) }
    #[allow(dead_code)]
    fn active_mut(&mut self) -> Option<&mut FileTab> { self.tabs.get_mut(self.active_tab) }

    /// Index of the tab that owns input focus right now. Resolves
    /// `active_split_child`: child 0 → the primary active tab, child 1 →
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
    fn title_for(tabs: &[FileTab], active: usize) -> String {
        let active_label = tabs.get(active).map(|t| t.label.as_str()).unwrap_or("—");
        let total: usize = tabs.iter().map(|t| t.scene.segments.len()).sum();
        format!("Open 2D Studio — {} tab(s) · active: {} · {} segs total [Ctrl+O new tab · Ctrl+W close · Ctrl+Tab cycle]",
            tabs.len(), active_label, total)
    }

    /// Open a file picker and append the result as a new tab.
    fn open_file_dialog(&mut self) {
        let starting_dir = self.tabs.iter()
            .find_map(|t| t.path.as_ref())
            .and_then(|p| std::path::Path::new(p).parent().map(|d| d.to_path_buf()));
        let mut dialog = rfd::FileDialog::new()
            .set_title("Open DWG or DXF as new tab")
            .add_filter("CAD drawings (*.dwg, *.dxf)", &["dwg", "dxf", "DWG", "DXF"])
            .add_filter("AutoCAD DWG (*.dwg)", &["dwg", "DWG"])
            .add_filter("AutoCAD DXF (*.dxf)", &["dxf", "DXF"])
            .add_filter("All files", &["*"]);
        if let Some(dir) = starting_dir {
            dialog = dialog.set_directory(dir);
        }
        let Some(picked) = dialog.pick_file() else { return; };
        let picked_str = picked.to_string_lossy().into_owned();
        eprintln!("[tab open] picked: {}", picked_str);
        let scene = load_any(&picked_str, "tab");
        self.push_tab_with_scene(scene, Some(picked_str.clone()));
        self.push_recent_file(&picked_str);
    }

    /// "Save As IFC 2D B" — run the IFCX-binary exporter on the active
    /// tab. Opens an rfd save-file dialog (defaulted to the source
    /// DWG's directory + `.ifcx` extension), encodes the tessellated
    /// scene via `kernel_app::ifcx_export::write_ifcx_binary`, writes
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
            .set_title("Save As IFC 2D B (binary IFCX)")
            .set_file_name(format!("{default_name}.ifcx"))
            .add_filter("IFCX binary (*.ifcx)", &["ifcx"]);
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
                    "[save-as-ifcx] wrote {} ({} bytes) — source {} bytes — ratio {:.1}% — encode {} ms",
                    out_path.display(),
                    out_bytes,
                    src,
                    ratio,
                    dt_ms,
                );
            }
            _ => {
                eprintln!(
                    "[save-as-ifcx] wrote {} ({} bytes) — encode {} ms",
                    out_path.display(),
                    out_bytes,
                    dt_ms,
                );
            }
        }
    }

    /// "Save As DXF" — round-trip the active tab's (possibly user-edited)
    /// tessellated Scene back to a textual DXF R2013 (AC1027) file. Every
    /// CAD app on the planet can open DXF — so this is our interim
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
        // BufWriter matters — write_dxf does many small writeln!s per entity.
        let mut writer = std::io::BufWriter::new(file);
        if let Err(e) = write_dxf(&tab.scene, &mut writer) {
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
                    "[save-as-dxf] wrote {} ({} bytes, written by Open 2D Studio) — source {} bytes — ratio {:.1}% — encode {} ms",
                    out_path.display(),
                    out_bytes,
                    src,
                    ratio,
                    dt_ms,
                );
            }
            _ => {
                eprintln!(
                    "[save-as-dxf] wrote {} ({} bytes, written by Open 2D Studio) — encode {} ms",
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
            win.set_title(&Self::title_for(&self.tabs, self.active_tab));
        }
    }

    /// Replace the scene in the ACTIVE tab (used by Reload).
    fn replace_active_scene(&mut self, scene: Scene, path: Option<String>) {
        let Some(tab) = self.tabs.get_mut(self.active_tab) else { return; };
        tab.cam = PaneCam::fit(&scene.bbox);
        tab.scene = scene;
        tab.path = path.clone();
        tab.label = FileTab::derive_label(path.as_deref());
        tab.selection.clear();
        tab.hover = None;
        tab.hidden_layers.clear();
        tab.move_drag = None;
        tab.move_drag_multi = None;
        tab.pending_move_offset = [0.0, 0.0];
        tab.undo_stack.clear();
        // Invalidate the spatial index — segments are entirely different now.
        tab.scene_index = None;
        if let Some(gpu) = self.gpu.as_ref() {
            tab.rebuild_buffers(gpu);
        }
        self.dragging = false;
        if let Some(win) = self.window.as_ref() {
            win.set_title(&Self::title_for(&self.tabs, self.active_tab));
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
                    // Partner gone OR somehow pointing at self — clear.
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
            win.set_title(&Self::title_for(&self.tabs, self.active_tab));
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
            win.set_title(&Self::title_for(&self.tabs, self.active_tab));
        }
    }

    /// Build ortho view-proj for the active canvas.
    ///
    /// World → clip chain (column-major in Rust literals below):
    ///   clip = proj(scale) * rot(-cam.rotation) * translate(-pan)
    /// i.e. the world is translated by `-pan`, then rotated so that a
    /// positive `cam.rotation` spins the canvas counter-clockwise on
    /// screen (matches the compass convention on the view-cube), and
    /// finally scaled to NDC so the camera covers `[-half_w, half_w]
    /// × [-half_h, half_h]` world units.
    fn camera_of(cam: &PaneCam, aspect: f32) -> CameraUbo {
        let half_h = (1.0 / cam.zoom) as f32;
        let half_w = half_h * aspect;
        let sx = 1.0 / half_w;
        let sy = 1.0 / half_h;
        let th = cam.rotation as f32;
        let (ct, st) = (th.cos(), th.sin());
        // 2×2 basis: scale * rot(-θ)  (note the sign on st for the row-2
        // assembly — we want world +X to stay right when θ=0 and to tilt
        // toward world +Y as θ grows).
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
        // Apply any pending present-mode switch BEFORE reading surface config.
        if let Some(new_mode) = self.pending_present_mode.take() {
            if let Some(gpu) = self.gpu.as_mut() {
                gpu.config.present_mode = new_mode;
                gpu.surface.configure(&gpu.device, &gpu.config);
            }
            self.present_mode = new_mode;
        }

        // --- Snapshots for egui closure ---------------------------------
        let ppp = self.window.as_ref().map(|w| w.scale_factor() as f32).unwrap_or(1.0);
        let tab_labels: Vec<String> = self.tabs.iter().map(|t| t.label.clone()).collect();
        let active_tab_idx = self.active_tab;
        let n_tabs = self.tabs.len();
        // View-cube needs the active tab's current rotation, snapped into
        // a plain f64 so the egui closure doesn't borrow `self.tabs`.
        let active_cam_rotation: f64 = self.tabs.get(active_tab_idx)
            .map(|t| t.cam.rotation).unwrap_or(0.0);

        // Layout list for the ACTIVE tab.
        let active_layouts: Vec<(String, [f64; 4])> = self.tabs.get(active_tab_idx)
            .map(|t| t.scene.layouts.clone()).unwrap_or_default();
        let active_show_paper: bool = self.tabs.get(active_tab_idx)
            .map(|t| t.show_paper).unwrap_or(false);

        // Layers for the active tab (if panel open).
        let layer_panel_open = self.layer_panel_open;
        let layers_for_active: Vec<(String, u32)> = if layer_panel_open {
            self.tabs.get(active_tab_idx)
                .map(|t| derive_layer_list(&t.scene, DEFAULT_LINE_COLOR))
                .unwrap_or_default()
        } else { Vec::new() };
        let hidden_snapshot: HashSet<String> = if layer_panel_open {
            self.tabs.get(active_tab_idx).map(|t| t.hidden_layers.clone()).unwrap_or_default()
        } else { HashSet::new() };

        let samples_open = self.samples_panel_open;
        let samples_snapshot: Vec<SampleEntry> = if samples_open { self.samples.clone() } else { Vec::new() };

        // Properties snapshot. With multi-select, `prop_selection_idx`
        // is the FIRST picked segment (used to drive the legacy
        // single-segment view). `prop_selection_count` is the unique
        // entity count — when > 1 the panel switches to a summary view.
        let properties_panel_open = self.properties_panel_open;
        let prop_selection_idx: Option<usize> = self.tabs.get(active_tab_idx)
            .and_then(|t| t.selection.first().copied());
        let prop_segment = prop_selection_idx.and_then(|i|
            self.tabs.get(active_tab_idx).and_then(|t| t.scene.segments.get(i).copied()));
        let prop_selection_count: usize = self.selected_entity_ids_in(active_tab_idx).len();
        let prop_scene_total = self.tabs.get(active_tab_idx).map(|t| t.scene.segments.len()).unwrap_or(0);
        let prop_tab_label = self.tabs.get(active_tab_idx).map(|t| t.label.clone()).unwrap_or_default();

        let recent_files_snapshot: Vec<String> = self.recent_files.clone();
        let current_tool_mode = self.tool_mode;
        // Drag-box snapshot — overlay is shown when LMB is down in Select
        // mode and drift exceeds the same HiDPI-scaled threshold the
        // release path uses. Crossing direction = left-running drag.
        let drag_box_active: bool = {
            if !self.lmb_pressed || self.tool_mode != ToolMode::Select { false }
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
        let last_measurement_snapshot = self.last_measurement;
        let show_perf_hud_snapshot = self.show_perf_hud;
        let present_mode_snapshot = self.present_mode;
        let about_dialog_open_snapshot = self.about_dialog_open;
        let current_split_snapshot: Option<SplitKind> = self.tabs.get(active_tab_idx)
            .and_then(|t| t.split_kind);
        // Active ribbon tab id, snapshotted so the egui closure can build
        // the Ribbon without re-borrowing self mutably.
        let active_ribbon_tab_snapshot: RibbonTabId = self.active_ribbon_tab.clone();
        // Window maximised state, surfaced to the TitleBar so it can paint
        // the right glyph on the maximise button.
        let window_maximized_snapshot: bool = self.window
            .as_ref()
            .map(|w| w.is_maximized())
            .unwrap_or(false);

        // Status bar snapshots — cursor coords, camera zoom, layer counts,
        // active tab label. Cheap to compute; always needed at bottom of frame.
        let status_cursor_world = self.cursor_world;
        let status_zoom: f64 = self.tabs.get(active_tab_idx).map(|t| t.cam.zoom).unwrap_or(1.0);
        let status_total_layers: usize = self.tabs.get(active_tab_idx)
            .map(|t| {
                if !t.scene.layer_names.is_empty() { t.scene.layer_names.len() }
                else { derive_layer_list(&t.scene, DEFAULT_LINE_COLOR).len() }
            }).unwrap_or(0);
        let status_hidden_layers: usize = self.tabs.get(active_tab_idx)
            .map(|t| t.hidden_layers.len()).unwrap_or(0);
        let status_tab_label: String = self.tabs.get(active_tab_idx)
            .map(|t| t.label.clone()).unwrap_or_default();

        // --- Intents gathered from the closure --------------------------
        let mut requested_activate_tab: Option<usize> = None;
        let mut requested_close_tab: Option<usize> = None;
        let mut requested_new_tab = false;            // "+" button
        let mut requested_menu_open_dialog = false;
        let mut requested_menu_reload = false;
        let mut requested_menu_close_active = false;
        let mut requested_menu_recent_load: Option<String> = None;
        let mut requested_menu_recent_clear = false;
        // "Save As IFC 2D B…" — run the IFCX-binary exporter on the
        // active tab. Handled in the post-present block (see below) so
        // the rfd modal dialog doesn't nest inside the egui frame.
        let mut requested_menu_save_as_ifcx = false;
        // "Save As DXF…" — deferred past the menu frame (same pattern as
        // IFCX save-as) so the rfd modal doesn't nest inside the egui frame.
        let mut requested_menu_save_as_dxf = false;
        let mut requested_toggle_layer_panel = false;
        let mut requested_toggle_props_panel = false;
        let mut requested_toggle_samples_panel = false;
        let mut requested_close_samples = false;
        let mut requested_tool_mode: Option<ToolMode> = None;
        let mut pending_selection_rebuild: bool = false;
        let mut requested_clear_measurement = false;
        // Annotate tools — per user request: linear maatlijn + area measurement, per-tab persistence
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
        let mut requested_layer_toggle: Option<String> = None;
        let mut requested_layer_show_all = false;
        let mut requested_layer_hide_all = false;
        let mut requested_selection_clear = false;
        // (bbox, layout_name) — layout tab switch on active tab.
        let mut requested_fit_layout: Option<([f64; 4], String)> = None;
        // Path to load into a NEW tab (samples browser).
        let mut requested_load_as_new_tab: Option<String> = None;
        // Split-view intents — picked horizontal/vertical split against
        // tab at index, or unsplit if None and the flag is true.
        let mut requested_split_h_with: Option<usize> = None;
        let mut requested_split_v_with: Option<usize> = None;
        let mut requested_unsplit = false;
        // Blok 3 — Copy button in the Modify ribbon group flips this; it's
        // folded into self.requested_duplicate at the end of the frame so
        // the deferred editor block picks it up alongside Ctrl+D presses.
        let mut requested_duplicate = false;
        // Ribbon tab switch — when the user clicks a different tab strip
        // entry, the action carries the new tab id which we apply to
        // self.active_ribbon_tab after the closure ends.
        let mut requested_ribbon_tab: Option<RibbonTabId> = None;
        // Title-bar actions — applied after the egui closure exits so we
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
                let _ = kernel_app::scene_io::re_tessellate_text_entity(
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
        // when the window is maximised — resizing a maximised window is a
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
                    let actions = TitleBar::new("Open 2D Studio")
                        .maximized(window_maximized_snapshot)
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
            // Data-driven `superui::Ribbon` widget — tab strip plus the
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
                    );
                    let actions = Ribbon::new(tabs, active_ribbon_tab_snapshot.clone()).show(ui);
                    for a in actions {
                        match a {
                            RibbonAction::TabChanged(id) => {
                                requested_ribbon_tab = Some(id);
                            }
                            RibbonAction::ButtonClicked(id) => match id.as_str() {
                                "open"          => { requested_menu_open_dialog = true; }
                                "new_tab"       => { requested_new_tab = true; }
                                "save_as_dxf"   => { requested_menu_save_as_dxf = true; }
                                "save_as_ifcx"  => { requested_menu_save_as_ifcx = true; }
                                "fit_extents"   => { requested_fit = true; }
                                "select"        => { requested_tool_mode = Some(ToolMode::Select); }
                                "move"          => { requested_tool_mode = Some(ToolMode::Move); }
                                "rotate"        => { requested_tool_mode = Some(ToolMode::Rotate); }
                                "scale"         => { requested_tool_mode = Some(ToolMode::Scale); }
                                "mirror"        => { requested_tool_mode = Some(ToolMode::Mirror); }
                                "duplicate"     => { requested_duplicate = true; }
                                "measure"       => { requested_tool_mode = Some(ToolMode::Measure); }
                                "dim"           => { requested_tool_mode = Some(ToolMode::Dimension); }
                                "area"          => { requested_tool_mode = Some(ToolMode::Area); }
                                "clear"         => {
                                    requested_clear_measurement = true;
                                    requested_clear_annotations = true;
                                }
                                "layers"        => { requested_toggle_layer_panel = true; }
                                "properties"    => { requested_toggle_props_panel = true; }
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
                                _ => {}
                            },
                        }
                    }
                });


            // ---- About dialog ---------------------------------------
            let mut about_open = about_dialog_open_snapshot;
            if about_open {
                egui::Window::new("About — Open 2D Studio")
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

            // ---- File-tab strip -------------------------------------
            // Data-driven `superui::FileTabBar` widget — Chrome-style
            // sloped tabs with active accent line, close × per tab and a
            // "+" new-tab button.
            egui::TopBottomPanel::top("tabbar")
                .show(ctx, |ui| {
                    let tab_defs: Vec<FileTabDef> = (0..n_tabs)
                        .map(|i| FileTabDef {
                            id: i,
                            label: tab_labels[i].clone(),
                            modified: false,
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
            // Built from data-driven `StatusSection`s — superui::StatusBar
            // owns the painting, padding and layout.
            egui::TopBottomPanel::bottom("statusbar")
                .show(ctx, |ui| {
                    // 1.0 reference layout (left → right):
                    //   X: …  Y: …  Cursor: 0 0  Zoom: 150%  Grid: 10
                    //   Scale: 1:100  ☐ Layer 0 ▾  ORTHO  White Background ▾
                    //   Tool: SELECT  …  IFC  Selected: 0  Objects: N
                    let (x_str, y_str) = match status_cursor_world {
                        Some(p) => (format!("X: {:>5.0}", p[0]), format!("Y: {:>5.0}", p[1])),
                        None => ("X:    —".to_string(), "Y:    —".to_string()),
                    };
                    let cursor_str = match status_cursor_world {
                        Some(p) => format!("Cursor: {:.0} {:.0}", p[0], p[1]),
                        None => "Cursor: — —".to_string(),
                    };
                    let zoom_pct = (status_zoom * 100.0).round() as i32;
                    let tool_str = match current_tool_mode {
                        ToolMode::Select    => "SELECT",
                        ToolMode::Measure   => "MEASURE",
                        ToolMode::Move      => "MOVE",
                        ToolMode::Dimension => "DIM",
                        ToolMode::Area      => "AREA",
                        ToolMode::Rotate    => "ROTATE",
                        ToolMode::Scale     => "SCALE",
                        ToolMode::Mirror    => "MIRROR",
                    };
                    let layer_str = if status_hidden_layers > 0 {
                        format!("Layer 0  ({}/{} hidden)", status_hidden_layers, status_total_layers)
                    } else {
                        "Layer 0".to_string()
                    };
                    let sections = vec![
                        StatusSection::Text(x_str),
                        StatusSection::Text(y_str),
                        StatusSection::Text(cursor_str),
                        StatusSection::Text(format!("Zoom: {}%", zoom_pct)),
                        StatusSection::Text("Grid: 10".to_string()),
                        StatusSection::Text("Scale: 1:100".to_string()),
                        StatusSection::Text(layer_str),
                        StatusSection::Text("ORTHO".to_string()),
                        StatusSection::Text("White Background".to_string()),
                        StatusSection::Text(format!("Tool: {}", tool_str)),
                        StatusSection::Spacer,
                        StatusSection::Text("IFC".to_string()),
                        StatusSection::Text(format!("Selected: {}", prop_selection_count)),
                        StatusSection::Text(format!("Objects: {}", prop_scene_total)),
                    ];
                    let _actions = StatusBar::new(sections).show(ui);
                });

            // ---- Bottom (above statusbar): Model/Layout tabs -----------
            // Only shown when the active tab has at least one paper-space
            // layout — otherwise it would just show "Model" on its own and
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

            // ---- Left: Layer Manager ---------------------------------
            // Docked tool-window look: a title-bar header with a chevron
            // close button, then the content below. Matches the TrueView
            // docked-panel aesthetic.
            if layer_panel_open {
                egui::SidePanel::left("layers")
                    .default_width(240.0)
                    .min_width(180.0)
                    .resizable(true)
                    .show(ctx, |ui| {
                        side_panel_header(ui, "LAYERS", || {}, &mut |hdr| {
                            if hdr.chevron_clicked {
                                requested_toggle_layer_panel = true;
                            }
                        });
                        ui.label(
                            egui::RichText::new(format!("{} layers · {} hidden",
                                layers_for_active.len(),
                                hidden_snapshot.len()))
                                .size(11.0)
                                .color(egui::Color32::from_rgb(150, 156, 164)),
                        );
                        ui.horizontal(|ui| {
                            if ui.small_button("Show all").clicked() {
                                requested_layer_show_all = true;
                            }
                            if ui.small_button("Hide all").clicked() {
                                requested_layer_hide_all = true;
                            }
                        });
                        ui.separator();
                        if layers_for_active.is_empty() {
                            ui.add_space(8.0);
                            ui.label(
                                egui::RichText::new("No layers loaded.")
                                    .italics()
                                    .color(egui::Color32::from_rgb(120, 128, 136)),
                            );
                        } else {
                            egui::ScrollArea::vertical().show(ui, |ui| {
                                for (name, rgba) in &layers_for_active {
                                    let mut visible = !hidden_snapshot.contains(name);
                                    let before = visible;
                                    ui.horizontal(|ui| {
                                        ui.checkbox(&mut visible, "");
                                        let r = ((rgba >> 0)  & 0xFF) as u8;
                                        let g = ((rgba >> 8)  & 0xFF) as u8;
                                        let b = ((rgba >> 16) & 0xFF) as u8;
                                        let (rect, _resp) = ui.allocate_exact_size(
                                            egui::vec2(18.0, 12.0),
                                            egui::Sense::hover());
                                        ui.painter().rect_filled(rect, 2.0,
                                            egui::Color32::from_rgb(r, g, b));
                                        ui.painter().rect_stroke(rect, 2.0,
                                            egui::Stroke::new(1.0, egui::Color32::from_gray(60)));
                                        ui.label(name);
                                    });
                                    if visible != before {
                                        requested_layer_toggle = Some(name.clone());
                                    }
                                }
                            });
                        }
                    });
            }

            // ---- Right: Properties ----------------------------------
            if properties_panel_open {
                egui::SidePanel::right("properties")
                    .default_width(260.0)
                    .min_width(200.0)
                    .resizable(true)
                    .show(ctx, |ui| {
                        side_panel_header(ui, "PROPERTIES", || {}, &mut |hdr| {
                            if hdr.chevron_clicked {
                                requested_toggle_props_panel = true;
                            }
                        });
                        ui.label(
                            egui::RichText::new(format!("Tab: {}  ·  {} segs",
                                prop_tab_label, prop_scene_total))
                                .size(11.0)
                                .color(egui::Color32::from_rgb(150, 156, 164)),
                        );
                        ui.separator();
                        // Multi-select summary first — wins over the
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
                                let scene_ref = self.tabs.get(active_tab_idx).map(|t| &t.scene);
                                let (entity_name, entity_count) = match scene_ref {
                                    Some(scene) if scene.segment_entity_idx.len() == scene.segments.len()
                                        && idx < scene.segment_entity_idx.len() =>
                                    {
                                        let eid = scene.segment_entity_idx[idx];
                                        let name = scene.entity_names.get(eid as usize).cloned()
                                            .unwrap_or_else(|| format!("entity #{}", eid));
                                        let count = scene.segment_entity_idx.iter()
                                            .filter(|&&x| x == eid).count();
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

            // ---- Central canvas area — record its rect for hit-testing
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

                    // Subtle 1 px inset border — makes the canvas look
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

                });
            // ---- Drag-box overlay (Select mode only) ---------------
            // Drawn via a foreground layer painter so it sits above the
            // canvas inset border but below the view-cube / perf HUD.
            // Coordinates are in egui LOGICAL pixels, while our latched
            // press / mouse coords are PHYSICAL — divide by ppp.
            if drag_box_active {
                let painter = ctx.layer_painter(egui::LayerId::new(
                    egui::Order::Foreground, egui::Id::new("dragbox")));
                let p1 = egui::pos2(drag_box_p1.0 / ppp, drag_box_p1.1 / ppp);
                let p2 = egui::pos2(drag_box_p2.0 / ppp, drag_box_p2.1 / ppp);
                let rect = egui::Rect::from_two_pos(p1, p2);
                let (fill, stroke) = if drag_box_crossing {
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
                if drag_box_crossing {
                    // Dashed border for crossing.
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

            // Floating 2D view-cube / nav-disk overlay — anchored
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
        // today because we clear self-pairs), the last upload would win —
        // not a concern in practice.
        for pane in &panes {
            if let Some(tab) = self.tabs.get(pane.tab_idx) {
                let aspect = pane.rect_px.2 / pane.rect_px.3.max(1.0);
                let ubo = Self::camera_of(&tab.cam, aspect);
                if let Some(p) = tab.pipe.as_ref() { p.update_camera(&gpu.queue, ubo); }
                if let Some(p) = tab.tri_pipe.as_ref() { p.update_camera(&gpu.queue, ubo); }
                if let Some(p) = tab.text_tri_pipe.as_ref() { p.update_camera(&gpu.queue, ubo); }
                if let Some(p) = tab.sel_pipe.as_ref() { p.update_camera(&gpu.queue, ubo); }
                // Annotate tools — per user request: linear maatlijn + area measurement, per-tab persistence
                if let Some(p) = tab.annotation_pipe.as_ref() { p.update_camera(&gpu.queue, ubo); }
            }
        }

        // --- Apply simple intents that don't touch gpu borrow -------------
        if requested_close_samples { self.samples_panel_open = false; }
        if requested_toggle_layer_panel { self.layer_panel_open = !self.layer_panel_open; }
        if requested_toggle_props_panel { self.properties_panel_open = !self.properties_panel_open; }
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
        if let Some(tab) = requested_ribbon_tab { self.active_ribbon_tab = tab; }

        // ---- Title-bar action dispatch -------------------------------
        // The hamburger app-menu currently has no destination — Phase B
        // will wire it to a popup. For now, the click is silently
        // dropped so the button is still functional visually.
        let _ = requested_toggle_app_menu;
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
                // Best-effort — fails silently if the OS rejects (e.g.
                // already in another window-manager modal interaction).
                let _ = w.drag_window();
            }
        }
        if let Some(dir) = requested_resize_dir {
            if let Some(w) = self.window.as_ref() {
                // Best-effort — winit returns a Result we deliberately drop.
                let _ = w.drag_resize_window(dir);
            }
        }
        if let Some(m) = requested_tool_mode {
            self.tool_mode = m;
            if m != ToolMode::Measure { self.measure_p1 = None; }
            if m != ToolMode::Move {
                if let Some(tab) = self.tabs.get_mut(self.active_tab) {
                    tab.move_drag = None;
                    tab.pending_move_offset = [0.0, 0.0];
                }
                pending_selection_rebuild = true;
            }
            // Annotate tools — per user request: linear maatlijn + area measurement, per-tab persistence
            if m != ToolMode::Dimension { self.dim_p1 = None; }
            if m != ToolMode::Area { self.area_in_progress.clear(); }
            // Blok 3 — clear transform-tool state on switch.
            if m != ToolMode::Rotate { self.rotate_pivot = None; }
            if m != ToolMode::Scale  { self.scale_pivot = None; self.scale_ref = None; }
            if m != ToolMode::Mirror { self.mirror_a = None; }
        }
        // Blok 3 — Copy button flips the deferred-duplicate flag so the
        // editor block (where gpu borrow is dropped) actually runs it.
        if requested_duplicate {
            self.requested_duplicate = true;
        }
        if requested_clear_measurement {
            self.last_measurement = None;
            self.measure_p1 = None;
        }
        // Annotate tools — per user request: linear maatlijn + area measurement, per-tab persistence
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
                    win.set_title(&Self::title_for(&self.tabs, self.active_tab));
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

        // Layer intents — mutate active tab then rebuild its buffers.
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
                tab.hidden_layers.clear();
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
        // the gpu mutable borrow has been dropped — see "Deferred editor
        // work" near the end of render(). The flags stay set so that
        // block can claim them.

        // Rebuild selection highlight for active tab if requested.
        if pending_selection_rebuild {
            let gpu_ref: &GpuCtx = gpu;
            rebuild_sel_pipe(self.tabs.get_mut(self.active_tab), gpu_ref);
        }

        // Annotate tools — per user request: linear maatlijn + area measurement, per-tab persistence
        // Rebuild annotation pipe every frame for each tab so dash-length and
        // text-size track the current zoom, and the rubber band from last
        // Area vertex to cursor is fresh. Cheap: few-dozen dims max per tab.
        {
            let gpu_ref: &GpuCtx = gpu;
            let active_tab_idx_local = self.active_tab;
            let cur_world = self.cursor_world;
            let in_progress: Option<Vec<[f64; 2]>> =
                if self.tool_mode == ToolMode::Area && !self.area_in_progress.is_empty() {
                    Some(self.area_in_progress.clone())
                } else { None };
            for i in 0..self.tabs.len() {
                let in_prog_ref = if i == active_tab_idx_local {
                    in_progress.as_deref()
                } else { None };
                let cur = if i == active_tab_idx_local { cur_world } else { None };
                rebuild_annotation_pipe(self.tabs.get_mut(i), in_prog_ref, cur, gpu_ref);
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

        // Scene pass — render each pane (1 when not split, 2 when split).
        // Shared render target, single clear, multiple viewports. When a
        // pane is a paper-space view the whole framebuffer is still dark
        // (we can't clear-per-viewport without scissor tricks), but the
        // scene pass itself still paints its own white behind the tab's
        // geometry via wgpu viewport rendering.
        {
            // Clear using primary tab's bg colour (matches the "the
            // active half drives the frame colour" expectation).
            let clear_color = if self.tabs.get(self.active_tab)
                .map(|t| t.show_paper).unwrap_or(false)
            {
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
                // Skip degenerate viewports — wgpu panics on 0-size.
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
                // Annotate tools — per user request: linear maatlijn + area measurement, per-tab persistence
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
        if let Some(idx) = requested_close_tab {
            self.close_tab(idx);
        }
        if requested_new_tab || requested_menu_open_dialog {
            self.open_file_dialog();
        }
        if let Some(path) = requested_load_as_new_tab {
            eprintln!("[samples] loading as new tab: {}", path);
            let scene = load_any(&path, "tab");
            self.push_tab_with_scene(scene, Some(path.clone()));
            self.push_recent_file(&path);
        }
        if let Some(path) = requested_menu_recent_load {
            let scene = load_any(&path, "tab");
            self.push_tab_with_scene(scene, Some(path.clone()));
            self.push_recent_file(&path);
        }
        if requested_menu_recent_clear {
            self.recent_files.clear();
            save_recent_files(&self.recent_files);
        }
        if requested_menu_reload {
            let path_opt = self.tabs.get(self.active_tab).and_then(|t| t.path.clone());
            if let Some(path) = path_opt {
                let scene = load_any(&path, "tab");
                self.replace_active_scene(scene, Some(path.clone()));
                self.push_recent_file(&path);
            } else {
                eprintln!("[menu] reload: active tab has no path");
            }
        }
        if requested_menu_close_active {
            self.close_tab(self.active_tab);
        }
        if requested_menu_save_as_ifcx {
            self.save_as_ifcx_binary();
        }
        if requested_menu_save_as_dxf {
            self.save_as_dxf();
        }
        if requested_fit {
            if let Some(tab) = self.tabs.get_mut(self.active_tab) {
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
        // `&mut self` paths that need the gpu borrow released — this
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
        // Blok 3 — duplicate-selection (Ctrl+D / Copy ribbon button).
        let do_duplicate = std::mem::take(&mut self.requested_duplicate);
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
        if need_sel_rebuild {
            if let Some(gpu) = self.gpu.as_ref() {
                rebuild_sel_pipe(self.tabs.get_mut(active), gpu);
            }
        }
    }

    /// Pixels → world units conversion.
    ///
    /// `(2.0 / cam.zoom)` is the FULL visible world-height in the canvas
    /// viewport: `camera_of` sets `half_h = 1/zoom`, so the viewport maps
    /// NDC `[-1, 1]` to world `[-half_h, half_h]` = `2/zoom` span. One
    /// pixel thus covers `world_height / canvas_pixels_height`.
    ///
    /// Previous formula `/ (h * 0.5)` was off by 2× (introduced when the
    /// code migrated from the 4-pane world to single-canvas) — pan moved
    /// 2× the mouse speed and zoom-at-cursor drifted off the mouse.
    /// World-units-per-pixel for a given camera and canvas rect (physical px).
    fn world_per_pixel_in(&self, cam: &PaneCam, rect: (f32, f32, f32, f32)) -> f64 {
        let h = rect.3.max(1.0) as f64;
        (2.0 / cam.zoom) / h
    }

    fn world_per_pixel(&self, cam: &PaneCam) -> f64 {
        self.world_per_pixel_in(cam, self.canvas_rect)
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

    /// Convert screen-pixel → world coords using an explicit tab + rect.
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
        // world → screen by +rotation; inverse rotates by -rotation.
        let th = tab.cam.rotation;
        let (ct, st) = (th.cos(), th.sin());
        let wx_off =  ct * ex + st * ey;
        let wy_off = -st * ex + ct * ey;
        let wx = tab.cam.pan_x + wx_off + tab.cam.origin[0];
        let wy = tab.cam.pan_y + wy_off + tab.cam.origin[1];
        Some([wx, wy])
    }

    /// Convert screen-pixel → world coords for the active tab using the
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
        let t_pick_start = Instant::now();
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

        // Lazy spatial index — built once per scene-load.
        if let Some(tab) = self.tabs.get_mut(tab_idx) { tab.ensure_scene_index(); }
        let tab = self.tabs.get(tab_idx)?;
        let hidden = &tab.hidden_layers;
        let want_paper = tab.show_paper;
        let mut best: Option<(usize, f64)> = None;

        let candidates: Vec<u32> = match tab.scene_index.as_ref() {
            Some(idx) => idx.seg_rtree.query_point([p[0], p[1]], pick_r),
            None => {
                // Empty scene fallback — nothing to scan anyway.
                Vec::new()
            }
        };
        let n_cand = candidates.len();
        for ci in candidates {
            let i = ci as usize;
            let Some(s) = tab.scene.segments.get(i) else { continue; };
            if s.is_paper != want_paper { continue; }
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
        let dt = t_pick_start.elapsed().as_secs_f64() * 1000.0;
        eprintln!("[pick] N={} candidates dt={:.3} ms (n_segs={})",
            n_cand, dt, tab.scene.segments.len());
        best.map(|(i, _)| i)
    }

    #[allow(dead_code)]
    fn pick_segment_at(&mut self, sx_px: f32, sy_px: f32, pick_radius_px: f32) -> Option<usize> {
        self.pick_segment_at_in(self.active_tab, self.canvas_rect, sx_px, sy_px, pick_radius_px)
    }

    /// Drag-box select. Window mode (left → right drag) keeps only entities
    /// whose every segment lies fully inside the rect. Crossing mode
    /// (right → left drag) keeps any entity whose AABB intersects the rect
    /// or whose any segment endpoint falls inside. Respects `additive`
    /// (Shift/Ctrl during release) — if true, picked entities are added to
    /// the existing selection instead of replacing it.
    fn commit_drag_box_select(
        &mut self,
        tab_idx: usize,
        rect: (f32, f32, f32, f32),
        additive: bool,
    ) {
        // World-space rect from press → release.
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
                    let _ = kernel_app::scene_io::re_tessellate_text_entity(
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
            match kernel_app::scene_io::re_tessellate_text_entity(
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
    // Blok 3 — Rotate / Scale / Mirror.
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
        if len2 < 1e-12 { return; } // degenerate axis — no-op
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
                // Reflection flips winding — swap v[1] and v[2] so fill
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
    /// Reuses the Paste undo variant — semantics are identical.
    /// Future work: a dedicated two-click "source → destination" Copy tool.
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
    /// Move → translate by -delta; Delete → re-insert; Paste → delete the
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
            // Blok 3 — inverse transforms.
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
                    let _ = kernel_app::scene_io::restore_text_entity(&mut tab.scene, &text_delta);
                }
                self.reupload_tab_buffers(tab_idx);
            }
        }
        // Selection may now point at relocated segments — safest to clear.
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
    /// their parallel arrays. `_record_undo` is unused — callers that want
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
    /// are minted as max(existing) + 1, 2, …; the clipboard entries are
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
        if let Some(tab) = self.tabs.get_mut(self.active_tab) {
            tab.cam = PaneCam::fit(&tab.scene.bbox);
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

/// Plain click → replace selection with the picked entity. Shift/Ctrl
/// click → toggle that entity in/out. Empty pick + non-additive → clear.
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

// Annotate tools — per user request: linear maatlijn + area measurement, per-tab persistence
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
        // Offset centre → baseline-left origin of the rotated text box.
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
        let (segs, _adv) = kernel_app::stroke_font::render_string(text, start, h, rotation);
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
                // Area label: always horizontal — polygon can be any shape,
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
    let Some(tab) = tab_opt else { eprintln!("[rebuild_sel_pipe] tab None"); return; };
    let t_rebuild_start = Instant::now();
    eprintln!("[rebuild_sel_pipe] selection={:?} hover={:?} n_segs={} n_ent_idx={}",
        tab.selection, tab.hover, tab.scene.segments.len(), tab.scene.segment_entity_idx.len());

    // Build the spatial / entity index lazily — same as the pick path.
    tab.ensure_scene_index();

    let mut verts: Vec<Vertex> = Vec::new();
    let origin = tab.cam.origin;
    let hi_color: u32 = 0xFFFF00FF;       // bright magenta — selection
    let hover_color: u32 = 0x66FF66FF;    // dim magenta (alpha ~0.4) — hover
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
    // in the selection — bright magenta wins over dim magenta.
    let hover_eid: Option<u32> = if use_groups {
        tab.hover.and_then(|i| scene.segment_entity_idx.get(i).copied())
            .filter(|e| !sel_eids.contains(e))
    } else { None };

    // Fast path: when the entity → segments lookup table exists, walk only
    // the siblings of each highlighted entity instead of every segment in
    // the scene. Drops the per-event cost from O(n_segs) (~688k) to
    // O(siblings) (typically a handful).
    let entity_to_segs = tab.scene_index.as_ref().map(|si| &si.entity_to_segs);

    // First pass — draw HOVER underneath so selection lines paint on top.
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
            // No index — fall back to the original linear sibling walk.
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
        // Fallback: scene has no entity-id table — highlight the picked
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
    eprintln!("[rebuild_sel_pipe] emitted {} verts, vertex_count={}, dt={:.3} ms",
        verts.len(),
        tab.sel_pipe.as_ref().map(|p| p.vertex_count).unwrap_or(0),
        t_rebuild_start.elapsed().as_secs_f64() * 1000.0);
}

/// Build a 64×64 RGBA window/taskbar icon programmatically — avoids the
/// extra dependency on `image` + a shipped .ico file. Design: warm-dark
/// (#242830) background, cyan-blue (#007ACC) stylised "2D" letters (the
/// logo) drawn from a 5×7 pixel font scaled 4×4. Matches the ribbon's
/// colour language.
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
    // 5×7 pixel-font glyph for "2" (1 = filled).
    let glyph_2: [[u8; 5]; 7] = [
        [0,1,1,1,0],
        [1,0,0,0,1],
        [0,0,0,0,1],
        [0,0,0,1,0],
        [0,0,1,0,0],
        [0,1,0,0,0],
        [1,1,1,1,1],
    ];
    // 5×7 pixel-font glyph for "D" (1 = filled).
    let glyph_d: [[u8; 5]; 7] = [
        [1,1,1,1,0],
        [1,0,0,0,1],
        [1,0,0,0,1],
        [1,0,0,0,1],
        [1,0,0,0,1],
        [1,0,0,0,1],
        [1,1,1,1,0],
    ];
    // Render a 5×7 glyph at (origin_x, origin_y), scaled 5× per cell so
    // each letter is 25w × 35h. Two letters spaced 4 px apart fit
    // centred in the 64×64 canvas (total width 25+4+25 = 54, leaves 5 px
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
        let title = Self::title_for(&self.tabs, self.active_tab);
        // Hide the native OS chrome — our `superui::TitleBar` paints its
        // own titlebar (icon + QAT + title + window controls). We start
        // a window drag from inside that bar via `Window::drag_window`.
        let mut attrs = Window::default_attributes()
            .with_title(title)
            .with_decorations(false)
            .with_inner_size(winit::dpi::LogicalSize::new(1800, 1000));
        if let Some(ic) = make_window_icon() {
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
                    // Annotate tools — per user request: linear maatlijn + area measurement, per-tab persistence
                    // Escape behaviour is layered: first absorbs the in-progress
                    // Area polygon (if any), then Dimension p1, then samples panel,
                    // then selection, then finally exits the app. CAD UX.
                    // Blok 3 — Esc also cancels in-progress Rotate/Scale/Mirror
                    // pivots before touching selection.
                    // Task 9 — Esc during text-edit cancels the edit first
                    // (highest priority so typing into the buffer can be
                    // backed out without disturbing other state).
                    if self.edit_mode.is_some() {
                        self.cancel_text_edit();
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
                    // the top of the next render cycle.
                    self.requested_delete = true;
                }
                KeyCode::KeyF => self.fit_active(),
                // Annotate tools — per user request: linear maatlijn + area measurement, per-tab persistence
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
                    self.tool_mode = ToolMode::Measure;
                    self.measure_p1 = None;
                }
                // Blok 3 — Shift+M = Mirror (M alone is Measure).
                KeyCode::KeyM if self.modifiers_shift_held() && !self.modifiers_ctrl_held() => {
                    self.tool_mode = ToolMode::Mirror;
                    self.mirror_a = None;
                }
                // Blok 3 — R = Rotate tool.
                KeyCode::KeyR if !self.modifiers_ctrl_held() && !self.modifiers_shift_held() => {
                    self.tool_mode = ToolMode::Rotate;
                    self.rotate_pivot = None;
                }
                // Blok 3 — S = Scale tool. Ctrl+S was not bound previously;
                // Ctrl+Shift+S is the unsplit shortcut handled below.
                KeyCode::KeyS if !self.modifiers_ctrl_held() && !self.modifiers_shift_held() => {
                    self.tool_mode = ToolMode::Scale;
                    self.scale_pivot = None;
                    self.scale_ref = None;
                }
                KeyCode::KeyV if !self.modifiers_ctrl_held() && !self.modifiers_shift_held() => {
                    // Plain V — Select mode. (Ctrl+Shift+V is already Split V above.)
                    self.tool_mode = ToolMode::Select;
                }
                KeyCode::Enter | KeyCode::NumpadEnter => {
                    // Task 9 — Enter during text-edit commits the buffer.
                    // Takes precedence over Area-polygon commit so the edit
                    // session can finish without leaving stale state.
                    if self.edit_mode.is_some() {
                        self.commit_text_edit();
                    } else
                    // Annotate tools — per user request: linear maatlijn + area measurement, per-tab persistence
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
                    let mut entered = false;
                    if self.tool_mode == ToolMode::Select && self.edit_mode.is_none() {
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
                KeyCode::F11 => {
                    self.pending_present_mode = Some(match self.present_mode {
                        wgpu::PresentMode::Fifo => wgpu::PresentMode::Immediate,
                        _ => wgpu::PresentMode::Fifo,
                    });
                }
                KeyCode::F12 => { self.show_perf_hud = !self.show_perf_hud; }
                KeyCode::KeyO if self.modifiers_ctrl_held() => self.open_file_dialog(),
                KeyCode::KeyW if self.modifiers_ctrl_held() => {
                    self.close_tab(self.active_tab);
                }
                KeyCode::Tab if self.modifiers_ctrl_held() => {
                    self.cycle_tab(!self.modifiers_shift_held());
                }
                KeyCode::KeyZ if self.modifiers_ctrl_held() => self.requested_undo = true,
                KeyCode::KeyA if self.modifiers_ctrl_held() && !self.modifiers_shift_held() => {
                    self.requested_select_all = true;
                }
                KeyCode::KeyC if self.modifiers_ctrl_held() && !self.modifiers_shift_held() => {
                    self.requested_copy = true;
                }
                KeyCode::KeyX if self.modifiers_ctrl_held() && !self.modifiers_shift_held() => {
                    // Cut = copy + delete. Both flags are processed in the
                    // same frame so undo records exactly one Delete EditOp.
                    self.requested_copy = true;
                    self.requested_delete = true;
                }
                KeyCode::KeyV if self.modifiers_ctrl_held() && !self.modifiers_shift_held() => {
                    self.requested_paste = true;
                }
                // Blok 3 — Ctrl+D duplicates the current selection in place
                // (small offset). Reuses the Paste undo variant — semantics
                // are identical from undo's point of view.
                KeyCode::KeyD if self.modifiers_ctrl_held() && !self.modifiers_shift_held() => {
                    self.requested_duplicate = true;
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
                _ => {}
            }
            WindowEvent::CursorMoved { position, .. } => {
                self.mouse_pos = (position.x as f32, position.y as f32);
                // Keep focused split child in sync with the cursor so
                // hit-testing / zoom-at-cursor / panels see the correct
                // half when the user crosses the divider.
                self.update_active_split_child();
                // Annotate tools — per user request: linear maatlijn + area measurement, per-tab persistence
                // Cache world-space cursor for the Area rubber-band preview.
                self.cursor_world = self.screen_to_world(self.mouse_pos.0, self.mouse_pos.1);

                // Hover preview — only in Select mode and when no LMB drag
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
                        // Screen-space cursor delta (Y-up) → world delta,
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
            // Annotate tools — per user request: linear maatlijn + area measurement, per-tab persistence
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
                }
            }
            WindowEvent::MouseInput { state, button: MouseButton::Left, .. } => {
                let egui_wants_input = self.gpu.as_ref()
                    .map(|g| g.egui_ctx.wants_pointer_input()).unwrap_or(false);
                let in_cube = self.mouse_in_view_cube();
                eprintln!("[LMB] state={:?} egui_wants={} mouse_in_canvas={} in_cube={} mouse_pos={:?} canvas_rect={:?} tool_mode={:?}",
                    state, egui_wants_input, self.mouse_in_canvas(), in_cube, self.mouse_pos, self.canvas_rect, self.tool_mode);
                match state {
                    ElementState::Pressed => {
                        // BUG FIX: don't gate on egui_wants_input — it returns
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
                            eprintln!("[LMB Press] latched tab={} rect={:?} dragging={}",
                                self.lmb_press_tab, self.lmb_press_rect, self.dragging);
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
                        eprintln!("[LMB Release] lmb_pressed={} dragging={}", self.lmb_pressed, self.dragging);
                        if self.lmb_pressed {
                            self.lmb_pressed = false;
                            let dx = self.mouse_pos.0 - self.lmb_press_pos.0;
                            let dy = self.mouse_pos.1 - self.lmb_press_pos.1;
                            let drift = (dx * dx + dy * dy).sqrt();
                            let focus_tab = self.lmb_press_tab;
                            let focus_rect = self.lmb_press_rect;
                            // BUG FIX (B): drift threshold scaled by HiDPI scale_factor.
                            // Was a fixed 4.0 px which on a 150% display means a normal
                            // click registers ~6 px of natural mouse jitter — got
                            // misclassified as a drag and never picked. Floor at 6 to
                            // stay forgiving on 100% displays too.
                            let scale_factor = self.window.as_ref()
                                .map(|w| w.scale_factor() as f32).unwrap_or(1.0);
                            let drift_threshold = (4.0_f32 * scale_factor).max(6.0);
                            eprintln!("[LMB Release] drift={} threshold={} focus_tab={} focus_rect={:?} tool_mode={:?} mods.shift={} mods.ctrl={}",
                                drift, drift_threshold, focus_tab, focus_rect, self.tool_mode,
                                self.modifiers_shift_held(), self.modifiers_ctrl_held());
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
                            } else if drift >= drift_threshold && self.tool_mode == ToolMode::Select {
                                // Drag-box select. Window vs crossing decided
                                // by drag direction (left→right = window).
                                self.commit_drag_box_select(focus_tab, focus_rect, additive);
                            } else if drift < drift_threshold {
                                match self.tool_mode {
                                    ToolMode::Select => {
                                        // BUG FIX (D): pick radius scaled by scale_factor.
                                        // Same HiDPI rationale — 6 px feels right on
                                        // 100% but is half the perceived radius on 200%.
                                        let pick_r_px = (6.0_f32 * scale_factor).max(6.0);
                                        let picked = self.pick_segment_at_in(
                                            focus_tab, focus_rect,
                                            self.mouse_pos.0, self.mouse_pos.1, pick_r_px);
                                        let n_segs = self.tabs.get(focus_tab).map(|t| t.scene.segments.len()).unwrap_or(0);
                                        eprintln!("[LMB Select] picked={:?} n_segs={} additive={}", picked, n_segs, additive);
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
                                            match self.measure_p1 {
                                                None => { self.measure_p1 = Some(world); }
                                                Some(p1) => {
                                                    let ddx = world[0] - p1[0];
                                                    let ddy = world[1] - p1[1];
                                                    let dist = (ddx*ddx + ddy*ddy).sqrt();
                                                    self.last_measurement = Some((p1, world, dist));
                                                    self.measure_p1 = None;
                                                }
                                            }
                                        }
                                    }
                                    ToolMode::Move => {}
                                    // Annotate tools — per user request: linear maatlijn + area measurement, per-tab persistence
                                    ToolMode::Dimension => {
                                        if let Some(world) = self.screen_to_world_in(
                                            focus_tab, focus_rect,
                                            self.mouse_pos.0, self.mouse_pos.1)
                                        {
                                            match self.dim_p1 {
                                                None => { self.dim_p1 = Some(world); }
                                                Some(p1) => {
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
                                    // Blok 3 — Rotate: click 1 = pivot, click 2 = angle
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
                                                            eprintln!("[Rotate] commit pivot={:?} angle={:.4} rad ({:.2}°) eids={}",
                                                                pivot, angle, angle.to_degrees(), eids.len());
                                                            self.commit_rotate_in(focus_tab, eids, pivot, angle);
                                                        } else {
                                                            eprintln!("[Rotate] no selection — nothing to rotate");
                                                        }
                                                    }
                                                    self.rotate_pivot = None;
                                                }
                                            }
                                        }
                                    }
                                    // Blok 3 — Scale: three-click (pivot, ref, target).
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
                                                        eprintln!("[Scale] degenerate ref (zero distance) — ignored");
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
                                                            eprintln!("[Scale] no selection or bad factor ({}) — skip",
                                                                factor);
                                                        }
                                                    }
                                                    self.scale_pivot = None;
                                                    self.scale_ref = None;
                                                }
                                            }
                                        }
                                    }
                                    // Blok 3 — Mirror: two clicks define the axis,
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
                                                            eprintln!("[Mirror] no selection — nothing to mirror");
                                                        }
                                                    }
                                                    self.mirror_a = None;
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                            // Task 9 — double-click to enter text-edit. We
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
                let scroll = match delta {
                    MouseScrollDelta::LineDelta(_, y) => y,
                    MouseScrollDelta::PixelDelta(p) => p.y as f32 / 100.0,
                };
                let factor = (1.0 + scroll as f64 * 0.30).clamp(0.3, 4.0);
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

fn load_any(path: &str, label: &'static str) -> Scene {
    let lower = path.to_lowercase();
    let res = if lower.ends_with(".dwg") {
        load_dwg(path)
    } else if lower.ends_with(".dxf") {
        load_dxf(path)
    } else {
        Err(anyhow::anyhow!("unsupported extension"))
    };
    match res {
        Ok(s) => { eprintln!("[{}] {}", label, s.count_label); s }
        Err(e) => {
            eprintln!("[{}] load failed for {}: {:?}", label, path, e);
            Scene::empty(label, format!("load FAILED: {}", e))
        }
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
/// function — takes only the state slices it needs so it can be called
/// from inside the egui closure without holding `&mut App`. The button
/// `id` strings are matched against in the action dispatch above.
///
/// Phase 1 only ships a handful of `IconKind` variants — many CAD ribbon
/// actions reuse `IconKind::Rectangle` as a placeholder until Phase B
/// swaps in proper phosphor icons.
fn build_ribbon_tabs(
    tool: ToolMode,
    layers_open: bool,
    properties_open: bool,
    samples_open: bool,
    perf_hud: bool,
    split: Option<SplitKind>,
) -> Vec<RibbonTabDef> {
    let split_h = matches!(split, Some(SplitKind::HorizontalPair(_)));
    let split_v = matches!(split, Some(SplitKind::VerticalPair(_)));
    // Per user directive 2026-05-04: consolidate the entire ribbon to a
    // SINGLE "Home" tab that mirrors 1.0's default-active layout
    // (SELECTION / DRAW / ANNOTATE / MODIFY / EDIT). The 1.0 web app has
    // 5 tabs (File / Home / Modify / View / IFC) but the user wants
    // "alles zoveel mogelijk in 1 tabblad". We keep an orange File-style
    // tab to match the visual treatment in 1.0 — it's just a stub
    // pseudo-tab that, when clicked, currently shows the same single set
    // of groups (no separate File menu yet in the Rust shell).
    vec![
        RibbonTabDef {
            id: "home".into(),
            label: "Home".into(),
            groups: vec![
                RibbonGroup::new("Selection")
                    .button(RibbonButtonDef {
                        id: "select".into(), label: "Select".into(),
                        icon: IconKind::Move, size: ButtonSize::Large,
                        selected: matches!(tool, ToolMode::Select), enabled: true,
                    })
                    .button(RibbonButtonDef {
                        id: "fit_extents".into(), label: "Fit".into(),
                        icon: IconKind::Rectangle, size: ButtonSize::Small,
                        selected: false, enabled: true,
                    })
                    .button(RibbonButtonDef {
                        id: "layers".into(), label: "Layers".into(),
                        icon: IconKind::Hatch, size: ButtonSize::Small,
                        selected: layers_open, enabled: true,
                    })
                    .button(RibbonButtonDef {
                        id: "properties".into(), label: "Properties".into(),
                        icon: IconKind::Rectangle, size: ButtonSize::Small,
                        selected: properties_open, enabled: true,
                    }),
                RibbonGroup::new("Draw")
                    .button(RibbonButtonDef {
                        id: "open".into(), label: "Open".into(),
                        icon: IconKind::Rectangle, size: ButtonSize::Large,
                        selected: false, enabled: true,
                    })
                    .button(RibbonButtonDef {
                        id: "new_tab".into(), label: "New Tab".into(),
                        icon: IconKind::Rectangle, size: ButtonSize::Small,
                        selected: false, enabled: true,
                    })
                    .button(RibbonButtonDef {
                        id: "save_as_dxf".into(), label: "Save As DXF".into(),
                        icon: IconKind::Rectangle, size: ButtonSize::Small,
                        selected: false, enabled: true,
                    })
                    .button(RibbonButtonDef {
                        id: "save_as_ifcx".into(), label: "Save As IFCX".into(),
                        icon: IconKind::Rectangle, size: ButtonSize::Small,
                        selected: false, enabled: true,
                    }),
                RibbonGroup::new("Annotate")
                    .button(RibbonButtonDef {
                        id: "measure".into(), label: "Measure".into(),
                        icon: IconKind::Dimension, size: ButtonSize::Large,
                        selected: matches!(tool, ToolMode::Measure), enabled: true,
                    })
                    .button(RibbonButtonDef {
                        id: "dim".into(), label: "Dim".into(),
                        icon: IconKind::Dimension, size: ButtonSize::Small,
                        selected: matches!(tool, ToolMode::Dimension), enabled: true,
                    })
                    .button(RibbonButtonDef {
                        id: "area".into(), label: "Area".into(),
                        icon: IconKind::Rectangle, size: ButtonSize::Small,
                        selected: matches!(tool, ToolMode::Area), enabled: true,
                    }),
                RibbonGroup::new("Modify")
                    .button(RibbonButtonDef {
                        id: "move".into(), label: "Move".into(),
                        icon: IconKind::Move, size: ButtonSize::Large,
                        selected: matches!(tool, ToolMode::Move), enabled: true,
                    })
                    .button(RibbonButtonDef {
                        id: "rotate".into(), label: "Rotate".into(),
                        icon: IconKind::Arc, size: ButtonSize::Small,
                        selected: matches!(tool, ToolMode::Rotate), enabled: true,
                    })
                    .button(RibbonButtonDef {
                        id: "scale".into(), label: "Scale".into(),
                        icon: IconKind::Rectangle, size: ButtonSize::Small,
                        selected: matches!(tool, ToolMode::Scale), enabled: true,
                    })
                    .button(RibbonButtonDef {
                        id: "mirror".into(), label: "Mirror".into(),
                        icon: IconKind::Line, size: ButtonSize::Small,
                        selected: matches!(tool, ToolMode::Mirror), enabled: true,
                    })
                    .button(RibbonButtonDef {
                        id: "duplicate".into(), label: "Copy".into(),
                        icon: IconKind::Rectangle, size: ButtonSize::Small,
                        selected: false, enabled: true,
                    }),
                RibbonGroup::new("Edit")
                    .button(RibbonButtonDef {
                        id: "split_h".into(), label: "Split H".into(),
                        icon: IconKind::Rectangle, size: ButtonSize::Small,
                        selected: split_h, enabled: true,
                    })
                    .button(RibbonButtonDef {
                        id: "split_v".into(), label: "Split V".into(),
                        icon: IconKind::Rectangle, size: ButtonSize::Small,
                        selected: split_v, enabled: true,
                    })
                    .button(RibbonButtonDef {
                        id: "unsplit".into(), label: "Unsplit".into(),
                        icon: IconKind::Rectangle, size: ButtonSize::Small,
                        selected: false, enabled: split.is_some(),
                    })
                    .button(RibbonButtonDef {
                        id: "samples".into(), label: "Samples".into(),
                        icon: IconKind::Rectangle, size: ButtonSize::Small,
                        selected: samples_open, enabled: true,
                    })
                    .button(RibbonButtonDef {
                        id: "perf_hud".into(), label: "Perf HUD".into(),
                        icon: IconKind::Rectangle, size: ButtonSize::Small,
                        selected: perf_hud, enabled: true,
                    })
                    .button(RibbonButtonDef {
                        id: "clear".into(), label: "Clear".into(),
                        icon: IconKind::Delete, size: ButtonSize::Small,
                        selected: false, enabled: true,
                    }),
            ],
        },
    ]
}

fn main() -> anyhow::Result<()> {
    // CLI args:
    //   (none)              → single blank tab.
    //   <base>              → legacy base-path mode: load <base>.dxf + <base>.dwg as two tabs.
    //   f1.dxf f2.dwg …     → each file arg becomes its own tab.
    let args: Vec<String> = std::env::args().skip(1).collect();

    let mut tabs: Vec<FileTab> = Vec::new();

    if args.len() == 1
        && !args[0].to_lowercase().ends_with(".dwg")
        && !args[0].to_lowercase().ends_with(".dxf")
    {
        let base = args[0].trim_end_matches(".dxf").trim_end_matches(".dwg").to_string();
        let dxf_path = format!("{}.dxf", base);
        let dwg_path = format!("{}.dwg", base);
        eprintln!("[open_2d_studio] base={}  tab 1 ← DXF, tab 2 ← DWG", base);
        let dxf_scene = load_any(&dxf_path, "dxf");
        tabs.push(FileTab::new(dxf_scene, Some(dxf_path)));
        let dwg_scene = load_any(&dwg_path, "dwg");
        tabs.push(FileTab::new(dwg_scene, Some(dwg_path)));
    } else {
        for a in &args {
            let scene = load_any(a, "tab");
            tabs.push(FileTab::new(scene, Some(a.clone())));
        }
    }

    let event_loop = EventLoop::new()?;
    let mut app = App::new(tabs);
    event_loop.run_app(&mut app)?;
    Ok(())
}
