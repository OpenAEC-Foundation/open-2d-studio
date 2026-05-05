//! Ribbon — tab strip + groups + buttons. Data-driven: the consumer
//! provides a list of tabs, each with groups and buttons.

use crate::primitives::CadButton;
use crate::icon::IconKind;
use crate::theme::Theme;
use crate::tokens::metrics;
use egui::{Sense, Ui, Vec2};

pub type RibbonTabId = String;

#[derive(Debug, Clone)]
pub enum RibbonAction {
    TabChanged(RibbonTabId),
    ButtonClicked(String),
}

pub struct RibbonGroup {
    pub title: String,
    pub buttons: Vec<RibbonButtonDef>,
}

#[derive(Clone)]
pub struct RibbonButtonDef {
    pub id: String,
    pub label: String,
    pub icon: IconKind,
    pub size: crate::primitives::button::ButtonSize,
    pub selected: bool,
    pub enabled: bool,
}

impl RibbonGroup {
    pub fn new(title: impl Into<String>) -> Self {
        Self { title: title.into(), buttons: Vec::new() }
    }
    pub fn button(mut self, def: RibbonButtonDef) -> Self {
        self.buttons.push(def);
        self
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

        // Tab strip
        let avail_w = ui.available_width();
        let tab_h = metrics::RIBBON_TAB_HEIGHT;
        let (tab_rect, _) = ui.allocate_exact_size(Vec2::new(avail_w, tab_h), Sense::hover());
        ui.painter().rect_filled(tab_rect, 0.0, palette.ribbon_tab_bg);
        ui.allocate_ui_at_rect(tab_rect, |ui| {
            ui.horizontal_centered(|ui| {
                for tab in &self.tabs {
                    let is_active = tab.id == self.active;
                    // The "File" tab is special in 1.0: solid orange button,
                    // matching `File-tab` in Ribbon.css. Detected by id.
                    let is_file_special = {
                        let lc = tab.id.to_ascii_lowercase();
                        lc == "file" || lc == "files"
                    };
                    let label_w = ui.painter().layout_no_wrap(
                        tab.label.clone(),
                        egui::FontId::proportional(12.0),
                        palette.fg,
                    ).rect.width();
                    let (trect, tresp) = ui.allocate_exact_size(
                        Vec2::new(label_w + 24.0, tab_h),
                        Sense::click(),
                    );
                    let (bg, label_color) = if is_file_special {
                        let fill = if tresp.hovered() { palette.accent_hover }
                                   else                { palette.accent };
                        (fill, palette.fg)
                    } else if is_active {
                        // 1.0's active ribbon tab has NO fill — it's
                        // transparent over the body brown, marked only by
                        // the orange bottom accent line.
                        (palette.ribbon_tab_active_bg, palette.fg)
                    } else if tresp.hovered() {
                        (palette.button_hover, palette.fg)
                    } else {
                        (palette.ribbon_tab_bg, palette.fg_dim)
                    };
                    ui.painter().rect_filled(trect, 0.0, bg);
                    ui.painter().text(
                        trect.center(),
                        egui::Align2::CENTER_CENTER,
                        &tab.label,
                        egui::FontId::proportional(12.0),
                        label_color,
                    );
                    // Bottom accent line marks the active non-File tab.
                    // Inset 4 px from each side and use a 1.5 px stroke so
                    // the underline reads as a tab marker, not a heavy bar.
                    if is_active && !is_file_special {
                        ui.painter().line_segment(
                            [egui::pos2(trect.left() + 4.0, trect.bottom() - 0.5),
                             egui::pos2(trect.right() - 4.0, trect.bottom() - 0.5)],
                            egui::Stroke::new(1.5, palette.accent),
                        );
                    }
                    if tresp.clicked() && !is_active {
                        actions.push(RibbonAction::TabChanged(tab.id.clone()));
                    }
                }
            });
        });

        // Group strip — render only the active tab's groups.
        // 1.0's ribbon-content-container is transparent over the body
        // brown (verified via computed styles), so we paint the same
        // bg here as the tab strip for visual continuity.
        let group_h = metrics::RIBBON_CONTENT_HEIGHT;
        let (group_rect, _) = ui.allocate_exact_size(Vec2::new(avail_w, group_h), Sense::hover());
        ui.painter().rect_filled(group_rect, 0.0, palette.ribbon_tab_active_bg);
        // Track each group's painted rect so we can stamp the title
        // (centred, uppercase, dim) along the bottom and draw a 1px
        // separator at the right edge.
        let mut group_rects: Vec<(egui::Rect, String)> = Vec::new();
        ui.allocate_ui_at_rect(group_rect, |ui| {
            ui.horizontal(|ui| {
                if let Some(active_tab) = self.tabs.iter().find(|t| t.id == self.active) {
                    for group in &active_tab.groups {
                        ui.add_space(6.0);
                        let g_left = ui.cursor().left();
                        // 1.0 packs Small/Medium buttons into 2-row columns
                        // (verified against ref-1.0-region-ribbon.png —
                        // DRAW is 2×4 small, MODIFY is 2×3 small, EDIT is
                        // 2×3 small, ANNOTATE is 2×2 medium). Large
                        // buttons stay on their own as a single full-height
                        // tile. We allocate a fixed-height row and lay out
                        // by hand using `allocate_exact_size` so column
                        // widths and the 2-row stacking work the same way
                        // egui's natural flow does for single rows.
                        ui.horizontal(|ui| {
                            ui.spacing_mut().item_spacing = egui::vec2(0.0, 0.0);
                            ui.add_space(2.0);
                            let mut i = 0;
                            while i < group.buttons.len() {
                                let b = &group.buttons[i];
                                if matches!(b.size, crate::primitives::button::ButtonSize::Large) {
                                    let resp = CadButton::large(&b.label)
                                        .icon(b.icon)
                                        .selected(b.selected)
                                        .enabled(b.enabled)
                                        .show(ui);
                                    if resp.clicked() {
                                        actions.push(RibbonAction::ButtonClicked(b.id.clone()));
                                    }
                                    i += 1;
                                } else {
                                    // Pack this run of non-Large buttons
                                    // into 2-row columns.
                                    let mut run_end = i;
                                    while run_end < group.buttons.len()
                                        && !matches!(group.buttons[run_end].size,
                                            crate::primitives::button::ButtonSize::Large)
                                    {
                                        run_end += 1;
                                    }
                                    let run = &group.buttons[i..run_end];
                                    let cols = (run.len() + 1) / 2;
                                    for c in 0..cols {
                                        ui.vertical(|ui| {
                                            ui.spacing_mut().item_spacing = egui::vec2(0.0, 0.0);
                                            for r in 0..2 {
                                                let idx = c * 2 + r;
                                                if idx >= run.len() { continue; }
                                                let b = &run[idx];
                                                let resp = match b.size {
                                                    crate::primitives::button::ButtonSize::Medium =>
                                                        CadButton::medium(&b.label),
                                                    _ => CadButton::small(&b.label),
                                                }
                                                .icon(b.icon)
                                                .selected(b.selected)
                                                .enabled(b.enabled)
                                                .show(ui);
                                                if resp.clicked() {
                                                    actions.push(RibbonAction::ButtonClicked(b.id.clone()));
                                                }
                                            }
                                        });
                                    }
                                    i = run_end;
                                }
                            }
                            ui.add_space(2.0);
                        });
                        let g_right = ui.cursor().left();
                        group_rects.push((
                            egui::Rect::from_min_max(
                                egui::pos2(g_left, group_rect.top()),
                                egui::pos2(g_right, group_rect.bottom()),
                            ),
                            group.title.clone(),
                        ));
                        ui.add_space(6.0);
                    }
                }
            });
        });

        // Pass 2 — overlay the group titles centred along the bottom,
        // and a thin vertical separator between adjacent groups (1.0's
        // Ribbon.css uses `--cad-border` between `.ribbon-group`).
        // Round 8 polish: pull the title baseline 2 px closer to the
        // bottom edge so it stops crowding the buttons; centre-inset the
        // separators and soften them by mixing border with bg so they
        // read as a hairline rather than a hard bar.
        let title_y = group_rect.bottom() - 7.0;
        let sep_color = {
            let b = palette.border;
            let g = palette.ribbon_tab_active_bg;
            // 50 % blend toward the body background.
            egui::Color32::from_rgb(
                ((b.r() as u16 + g.r() as u16) / 2) as u8,
                ((b.g() as u16 + g.g() as u16) / 2) as u8,
                ((b.b() as u16 + g.b() as u16) / 2) as u8,
            )
        };
        for (i, (g_rect, title)) in group_rects.iter().enumerate() {
            ui.painter().text(
                egui::pos2(g_rect.center().x, title_y),
                egui::Align2::CENTER_CENTER,
                title.to_uppercase(),
                egui::FontId::proportional(9.0),
                palette.fg_dim,
            );
            if i + 1 < group_rects.len() {
                let sx = g_rect.right() + 3.0;
                // Centre-inset the separator: pull it in 12 px from top
                // and 20 px from bottom so it sits inside the title-row
                // baseline, matching 1.0's `.ribbon-group + .ribbon-group`.
                ui.painter().line_segment(
                    [egui::pos2(sx, group_rect.top() + 12.0),
                     egui::pos2(sx, group_rect.bottom() - 20.0)],
                    egui::Stroke::new(1.0, sep_color),
                );
            }
        }
        actions
    }
}

// Re-export ButtonSize publicly so consumers can build RibbonButtonDef without
// reaching into the primitives module path.
pub use crate::primitives::button::ButtonSize;
