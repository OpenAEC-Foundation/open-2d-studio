//! Ribbon — tab strip + groups + buttons. Data-driven and **layout-strict**:
//! the consumer declares each group's layout shape (`RibbonGroupLayout`)
//! and superui paints it onto a fixed cell grid defined in
//! `tokens::ribbon_grid`. There is exactly one place in the codebase
//! that decides "where does a button go" — this file. Consumers never
//! touch pixels.
//!
//! Design spec (verified against 1.0 `Ribbon.css` + `Ribbon.tsx`):
//!
//! * Content strip is `CONTENT_H` tall (= 108 px); the bottom
//!   `TITLE_BAND_H` (= 16 px) is reserved for the uppercase group label.
//! * Three layout shapes are supported, all rendered onto the same
//!   cell grid so rows always align:
//!     - `LargeOnly` — N large icon+caption stacks side-by-side.
//!     - `LargeLeft` — one large left-anchored cell + a stack column of
//!       2 small/medium rows on the right.
//!     - `Stack` — pure 2-row grid of small/medium cells, M columns
//!       wide.
//! * Group widths derive from the cell grid. Total ribbon width is
//!   predictable.

use crate::primitives::CadButton;
use crate::icon::IconKind;
use crate::theme::Theme;
use crate::tokens::{metrics, ribbon_grid as rg};
use egui::{Color32, Sense, Ui, Vec2};

pub type RibbonTabId = String;

#[derive(Debug, Clone)]
pub enum RibbonAction {
    TabChanged(RibbonTabId),
    ButtonClicked(String),
}

/// One button — pure data, no layout decisions.
#[derive(Clone)]
pub struct RibbonButtonDef {
    pub id: String,
    pub label: String,
    pub icon: IconKind,
    /// Hint only — the actual painted size comes from the layout slot
    /// the button occupies. Kept for backward-compat with consumers
    /// that still pass a `size`; ignored when layout is set.
    pub size: crate::primitives::button::ButtonSize,
    pub selected: bool,
    pub enabled: bool,
    /// Show the caption next to/under the icon. Large buttons normally
    /// show their caption; Medium/Small default to icon-only and the
    /// consumer opts in by setting this `true` (e.g. for Stack rows
    /// like Selection's Select All / Deselect / Find).
    pub show_caption: bool,
}

/// Layout shape for a `RibbonGroup`. Picking the right shape per group
/// is the consumer's only layout responsibility.
#[derive(Clone)]
pub enum RibbonGroupLayout {
    /// One or more large icon+caption tiles laid out side-by-side. Use
    /// for "headline action" groups like Selection (`Select` + `Pan`).
    LargeOnly { large: Vec<RibbonButtonDef> },
    /// One left-anchored large tile, then one or more 2-row stack
    /// columns of small/medium buttons on the right. Use for groups
    /// like Annotate (`Aligned` + linear/angular/spot stacks).
    LargeLeft { large: RibbonButtonDef, stacks: Vec<Vec<RibbonButtonDef>> },
    /// 2-row × N-col grid of small (or medium) cells. Use for tool
    /// inventories like Draw / Edit / Modify.
    Stack { rows: u8, buttons: Vec<RibbonButtonDef> },
    /// Free flow — keeps the legacy "auto-pack" behaviour for groups
    /// that haven't been explicitly classified yet. Avoid in new code.
    Flow { buttons: Vec<RibbonButtonDef> },
}

pub struct RibbonGroup {
    pub title: String,
    pub layout: RibbonGroupLayout,
}

impl RibbonGroup {
    /// Legacy constructor: starts an empty Flow group, callers chain
    /// `.button(...)`. Kept so the consumer doesn't all break at once.
    pub fn new(title: impl Into<String>) -> Self {
        Self {
            title: title.into(),
            layout: RibbonGroupLayout::Flow { buttons: Vec::new() },
        }
    }
    /// Legacy chaining helper — appends to the Flow buttons list.
    /// No-op if the group already uses a structured layout.
    pub fn button(mut self, def: RibbonButtonDef) -> Self {
        if let RibbonGroupLayout::Flow { ref mut buttons } = self.layout {
            buttons.push(def);
        }
        self
    }
    /// New API: build a group with an explicit layout.
    pub fn with_layout(title: impl Into<String>, layout: RibbonGroupLayout) -> Self {
        Self { title: title.into(), layout }
    }
}

pub struct RibbonTabDef {
    pub id: RibbonTabId,
    pub label: String,
    pub groups: Vec<RibbonGroup>,
}

pub struct Ribbon {
    tabs: Vec<RibbonTabDef>,
    active: RibbonTabId,
}

impl Ribbon {
    pub fn new(tabs: Vec<RibbonTabDef>, active: RibbonTabId) -> Self {
        Self { tabs, active }
    }

    pub fn show(self, ui: &mut Ui) -> Vec<RibbonAction> {
        let mut actions = Vec::new();
        let palette = Theme::Default.palette();

        // --------------------- Tab strip ---------------------
        // Mockup spec (lines 594-627): 28 px tall, gradient from
        // `surface` to `#443c3c`, 1 px `border-light` bottom border, tabs
        // use 6 px 16 px padding, font-size 12, weight 500. File tab is
        // a special orange-filled affordance.
        let avail_w = ui.available_width();
        let tab_h = metrics::RIBBON_TAB_HEIGHT;
        let (tab_rect, _) = ui.allocate_exact_size(Vec2::new(avail_w, tab_h), Sense::hover());
        ui.painter().rect_filled(tab_rect, 0.0, palette.panel_bg);
        // 1 px border-light bottom border across the whole strip.
        ui.painter().line_segment(
            [egui::pos2(tab_rect.left(), tab_rect.bottom() - 0.5),
             egui::pos2(tab_rect.right(), tab_rect.bottom() - 0.5)],
            egui::Stroke::new(1.0, palette.border_light),
        );
        ui.allocate_ui_at_rect(tab_rect, |ui| {
            // Mockup uses `items-end px-2 gap-2` — push tabs to bottom of
            // the 28 px strip and add 8 px padding on the left.
            ui.horizontal(|ui| {
                ui.add_space(8.0);
                for tab in &self.tabs {
                    let is_active = tab.id == self.active;
                    let is_file_special = {
                        let lc = tab.id.to_ascii_lowercase();
                        lc == "file" || lc == "files"
                    };
                    let font = egui::FontId::proportional(12.0);
                    let label_w = ui.painter().layout_no_wrap(
                        tab.label.clone(), font.clone(), palette.fg,
                    ).rect.width();
                    // Mockup: padding 6 px 16 px ≈ 32 px horizontal.
                    let (trect, tresp) = ui.allocate_exact_size(
                        Vec2::new(label_w + 32.0, tab_h),
                        Sense::click(),
                    );
                    let (bg, label_color) = if is_file_special {
                        // File tab — always orange, white text.
                        let fill = if tresp.hovered() { palette.accent_hover }
                                   else                { palette.accent };
                        (fill, Color32::WHITE)
                    } else if is_active {
                        // Active tab — content-bg fill so it merges into
                        // the body below; bordered with `border-light`.
                        (palette.bg, palette.fg)
                    } else if tresp.hovered() {
                        (palette.hover, palette.fg)
                    } else {
                        (Color32::TRANSPARENT, palette.fg_dim)
                    };
                    let rounding = egui::Rounding {
                        nw: 4.0, ne: 4.0, sw: 0.0, se: 0.0,
                    };
                    if bg != Color32::TRANSPARENT {
                        ui.painter().rect_filled(trect, rounding, bg);
                    }
                    // Inactive non-File tabs have transparent border;
                    // active gets a 1 px border-light outline.
                    if is_active && !is_file_special {
                        ui.painter().rect_stroke(trect, rounding,
                            egui::Stroke::new(1.0, palette.border_light));
                        // Cover the bottom of the active tab so it
                        // visually merges into the content strip.
                        ui.painter().rect_filled(
                            egui::Rect::from_min_max(
                                egui::pos2(trect.left() + 1.0, trect.bottom() - 1.0),
                                egui::pos2(trect.right() - 1.0, trect.bottom() + 1.0)),
                            egui::Rounding::ZERO, palette.bg);
                    }
                    ui.painter().text(
                        trect.center(),
                        egui::Align2::CENTER_CENTER,
                        &tab.label,
                        font,
                        label_color,
                    );
                    if tresp.clicked() && !is_active {
                        actions.push(RibbonAction::TabChanged(tab.id.clone()));
                    }
                    ui.add_space(2.0);
                }
            });
        });

        // --------------------- Group strip ---------------------
        let group_h = rg::CONTENT_H;
        let (group_rect, _) = ui.allocate_exact_size(Vec2::new(avail_w, group_h), Sense::hover());
        ui.painter().rect_filled(group_rect, 0.0, palette.ribbon_tab_active_bg);

        let mut group_rects: Vec<(egui::Rect, String)> = Vec::new();

        // We compute & paint each group manually so cell positions are
        // 100 % deterministic — no reliance on egui auto-layout.
        let mut cursor_x = group_rect.left() + rg::GROUP_PAD_X;
        if let Some(active_tab) = self.tabs.iter().find(|t| t.id == self.active) {
            for group in &active_tab.groups {
                let g_left = cursor_x;
                let inner_top = group_rect.top() + rg::INNER_PAD_TOP;

                // Compute group width up-front so the next group can
                // start at a known x without sub-layout side-effects.
                let group_w = compute_group_width(&group.layout);

                // Paint the group's cells.
                paint_group_cells(
                    ui,
                    &group.layout,
                    egui::pos2(cursor_x, inner_top),
                    &mut actions,
                );

                cursor_x += group_w;
                group_rects.push((
                    egui::Rect::from_min_max(
                        egui::pos2(g_left, group_rect.top()),
                        egui::pos2(cursor_x, group_rect.bottom()),
                    ),
                    group.title.clone(),
                ));
                cursor_x += rg::GROUP_GAP;
            }
        }

        // --------------------- Title baseline + separators ---------------------
        let title_y = group_rect.bottom() - (rg::TITLE_BAND_H * 0.5);
        // 1.0 renders group separators as a single 1 px line in
        // `--theme-border-light` — clearly visible against the brown
        // strip. Earlier rounds blended border + bg which produced an
        // almost-invisible line; bump the alpha by lifting toward `fg`.
        let sep_color = {
            let b = palette.border;
            let f = palette.fg;
            egui::Color32::from_rgba_unmultiplied(
                ((b.r() as u16 * 2 + f.r() as u16) / 3) as u8,
                ((b.g() as u16 * 2 + f.g() as u16) / 3) as u8,
                ((b.b() as u16 * 2 + f.b() as u16) / 3) as u8,
                160,
            )
        };
        for (i, (g_rect, title)) in group_rects.iter().enumerate() {
            ui.painter().text(
                egui::pos2(g_rect.center().x, title_y),
                egui::Align2::CENTER_CENTER,
                title.to_uppercase(),
                egui::FontId::proportional(rg::TITLE_FONT),
                palette.fg_dim,
            );
            if i + 1 < group_rects.len() {
                // 1.0 `.ribbon-group` has `border-right: 1px solid
                // var(--theme-border-light)` spanning the full group
                // height (top to bottom of content strip). Inset by 4 px
                // top/bottom so the line sits visually inside the strip
                // without colliding with the tab edge or status bar.
                let sx = g_rect.right() + rg::GROUP_GAP * 0.5;
                ui.painter().line_segment(
                    [egui::pos2(sx, group_rect.top() + 4.0),
                     egui::pos2(sx, group_rect.bottom() - 4.0)],
                    egui::Stroke::new(1.0, sep_color),
                );
            }
        }
        actions
    }
}

// ============================================================
// Cell-grid painter
// ============================================================

fn compute_group_width(layout: &RibbonGroupLayout) -> f32 {
    let inner = match layout {
        RibbonGroupLayout::LargeOnly { large } => {
            let n = large.len() as f32;
            n * rg::LARGE_W + (n - 1.0).max(0.0) * rg::CELL_GAP_H
        }
        RibbonGroupLayout::LargeLeft { stacks, .. } => {
            let stack_count = stacks.len() as f32;
            let stack_w = stacks
                .iter()
                .map(|col| col.iter().map(cell_w_for_button).fold(0.0_f32, f32::max))
                .fold(0.0_f32, f32::max);
            rg::LARGE_W
                + rg::CELL_GAP_H
                + stack_count * stack_w
                + (stack_count - 1.0).max(0.0) * rg::CELL_GAP_H
        }
        RibbonGroupLayout::Stack { rows, buttons } => {
            let rows = (*rows).max(1) as usize;
            let cols = (buttons.len() + rows - 1) / rows;
            // Use widest cell width across the buttons.
            let cell_w = buttons.iter().map(cell_w_for_button).fold(0.0_f32, f32::max);
            cols as f32 * cell_w + (cols.max(1) as f32 - 1.0) * rg::CELL_GAP_H
        }
        RibbonGroupLayout::Flow { buttons } => {
            // Approximate the legacy auto-pack: large cells + stack
            // columns of pairs. Mirrors the old painter so legacy
            // groups still render without overlap.
            let mut w = 0.0_f32;
            let mut i = 0;
            while i < buttons.len() {
                let b = &buttons[i];
                if matches!(b.size, crate::primitives::button::ButtonSize::Large) {
                    w += rg::LARGE_W + rg::CELL_GAP_H;
                    i += 1;
                } else {
                    let mut run_end = i;
                    while run_end < buttons.len()
                        && !matches!(
                            buttons[run_end].size,
                            crate::primitives::button::ButtonSize::Large
                        )
                    {
                        run_end += 1;
                    }
                    let run = &buttons[i..run_end];
                    let cols = (run.len() + 1) / 2;
                    let cell_w = run.iter().map(cell_w_for_button).fold(0.0_f32, f32::max);
                    w += cols as f32 * cell_w + cols.max(1) as f32 * rg::CELL_GAP_H;
                    i = run_end;
                }
            }
            w
        }
    };
    inner + 2.0 * rg::GROUP_PAD_X
}

fn cell_w_for_button(b: &RibbonButtonDef) -> f32 {
    match b.size {
        crate::primitives::button::ButtonSize::Large => rg::LARGE_W,
        crate::primitives::button::ButtonSize::Medium => {
            if b.show_caption { rg::MEDIUM_W } else { icon_only_cell_w(rg::ICON_MEDIUM) }
        }
        crate::primitives::button::ButtonSize::Small => {
            if b.show_caption { rg::SMALL_W } else { icon_only_cell_w(rg::ICON_SMALL) }
        }
    }
}

/// Width of an icon-only cell: icon + symmetric padding on both sides.
fn icon_only_cell_w(icon: f32) -> f32 {
    icon + 2.0 * rg::CELL_PAD + 8.0
}

fn paint_group_cells(
    ui: &mut Ui,
    layout: &RibbonGroupLayout,
    origin: egui::Pos2,
    actions: &mut Vec<RibbonAction>,
) {
    let mut x = origin.x + rg::GROUP_PAD_X;
    let y = origin.y;

    match layout {
        RibbonGroupLayout::LargeOnly { large } => {
            for b in large {
                paint_cell(ui, b, egui::pos2(x, y),
                    rg::LARGE_W, rg::LARGE_H,
                    crate::primitives::button::ButtonSize::Large, actions);
                x += rg::LARGE_W + rg::CELL_GAP_H;
            }
        }
        RibbonGroupLayout::LargeLeft { large, stacks } => {
            paint_cell(ui, large, egui::pos2(x, y),
                rg::LARGE_W, rg::LARGE_H,
                crate::primitives::button::ButtonSize::Large, actions);
            x += rg::LARGE_W + rg::CELL_GAP_H;

            // 1.0 stack columns are usually 2 rows but can be 3 (e.g.
            // SELECTION: Select All / Deselect / Find/Replace,
            // ANNOTATE: Linear/Angular/Spot Coord., …). Pick the
            // longest column (clamped to 3) and scale `cell_h` so
            // every column shares a consistent grid.
            let max_rows = stacks
                .iter()
                .map(|c| c.len().min(3))
                .max()
                .unwrap_or(2)
                .max(2) as f32;
            let inner_band = rg::INNER_H - rg::INNER_PAD_TOP;
            let cell_h = (inner_band - (max_rows - 1.0) * rg::CELL_GAP_V) / max_rows;
            for col in stacks {
                let cell_w = col.iter().map(cell_w_for_button).fold(0.0_f32, f32::max);
                for (i, b) in col.iter().take(max_rows as usize).enumerate() {
                    let cy = y + i as f32 * (cell_h + rg::CELL_GAP_V);
                    let size = match b.size {
                        crate::primitives::button::ButtonSize::Large
                            => crate::primitives::button::ButtonSize::Small,
                        s => s,
                    };
                    paint_cell(ui, b, egui::pos2(x, cy), cell_w, cell_h, size, actions);
                }
                x += cell_w + rg::CELL_GAP_H;
            }
        }
        RibbonGroupLayout::Stack { rows, buttons } => {
            let rows = (*rows).max(1) as usize;
            let cell_w = buttons.iter().map(cell_w_for_button).fold(0.0_f32, f32::max);
            let cell_h = rg::SMALL_H;
            for (idx, b) in buttons.iter().enumerate() {
                let col = idx / rows;
                let row = idx % rows;
                let cx = x + col as f32 * (cell_w + rg::CELL_GAP_H);
                let cy = y + row as f32 * (cell_h + rg::CELL_GAP_V);
                let size = match b.size {
                    crate::primitives::button::ButtonSize::Large
                        => crate::primitives::button::ButtonSize::Small,
                    s => s,
                };
                paint_cell(ui, b, egui::pos2(cx, cy), cell_w, cell_h, size, actions);
            }
        }
        RibbonGroupLayout::Flow { buttons } => {
            // Auto-pack: large = own column, others = 2-row stacks.
            let mut i = 0;
            while i < buttons.len() {
                let b = &buttons[i];
                if matches!(b.size, crate::primitives::button::ButtonSize::Large) {
                    paint_cell(ui, b, egui::pos2(x, y),
                        rg::LARGE_W, rg::LARGE_H,
                        crate::primitives::button::ButtonSize::Large, actions);
                    x += rg::LARGE_W + rg::CELL_GAP_H;
                    i += 1;
                } else {
                    let mut run_end = i;
                    while run_end < buttons.len()
                        && !matches!(
                            buttons[run_end].size,
                            crate::primitives::button::ButtonSize::Large
                        )
                    {
                        run_end += 1;
                    }
                    let run = &buttons[i..run_end];
                    let cell_w = run.iter().map(cell_w_for_button).fold(0.0_f32, f32::max);
                    let cell_h = rg::SMALL_H;
                    let cols = (run.len() + 1) / 2;
                    for c in 0..cols {
                        for r in 0..2 {
                            let idx = c * 2 + r;
                            if idx >= run.len() { continue; }
                            let bb = &run[idx];
                            let cx = x + c as f32 * (cell_w + rg::CELL_GAP_H);
                            let cy = y + r as f32 * (cell_h + rg::CELL_GAP_V);
                            paint_cell(ui, bb, egui::pos2(cx, cy), cell_w, cell_h, bb.size, actions);
                        }
                    }
                    x += cols as f32 * (cell_w + rg::CELL_GAP_H);
                    i = run_end;
                }
            }
        }
    }
}

fn paint_cell(
    ui: &mut Ui,
    b: &RibbonButtonDef,
    pos: egui::Pos2,
    w: f32,
    h: f32,
    size: crate::primitives::button::ButtonSize,
    actions: &mut Vec<RibbonAction>,
) {
    let rect = egui::Rect::from_min_size(pos, egui::vec2(w, h));
    let resp = CadButton::cell(size, rect, &b.label)
        .icon(b.icon)
        .selected(b.selected)
        .enabled(b.enabled)
        .show_caption(b.show_caption || matches!(size, crate::primitives::button::ButtonSize::Large))
        .show(ui);
    if resp.clicked() {
        actions.push(RibbonAction::ButtonClicked(b.id.clone()));
    }
}

// Re-export ButtonSize publicly so consumers can build RibbonButtonDef without
// reaching into the primitives module path.
pub use crate::primitives::button::ButtonSize;
