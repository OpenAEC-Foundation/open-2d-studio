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
                    if is_active && !is_file_special {
                        ui.painter().line_segment(
                            [trect.left_bottom(), trect.right_bottom()],
                            egui::Stroke::new(2.0, palette.accent),
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
                        ui.add_space(8.0);
                        let g_left = ui.cursor().left();
                        ui.vertical(|ui| {
                            // Buttons row — leave room for the group title.
                            ui.horizontal(|ui| {
                                ui.add_space(2.0);
                                for b in &group.buttons {
                                    let resp = match b.size {
                                        crate::primitives::button::ButtonSize::Large =>
                                            CadButton::large(&b.label),
                                        crate::primitives::button::ButtonSize::Medium =>
                                            CadButton::medium(&b.label),
                                        crate::primitives::button::ButtonSize::Small =>
                                            CadButton::small(&b.label),
                                    }
                                    .icon(b.icon)
                                    .selected(b.selected)
                                    .enabled(b.enabled)
                                    .show(ui);
                                    if resp.clicked() {
                                        actions.push(RibbonAction::ButtonClicked(b.id.clone()));
                                    }
                                }
                                ui.add_space(2.0);
                            });
                        });
                        let g_right = ui.cursor().left();
                        group_rects.push((
                            egui::Rect::from_min_max(
                                egui::pos2(g_left, group_rect.top()),
                                egui::pos2(g_right, group_rect.bottom()),
                            ),
                            group.title.clone(),
                        ));
                        ui.add_space(8.0);
                    }
                }
            });
        });

        // Pass 2 — overlay the group titles centred along the bottom,
        // and a thin vertical separator between adjacent groups (1.0's
        // Ribbon.css uses `--cad-border` between `.ribbon-group`).
        let title_y = group_rect.bottom() - 9.0;
        for (i, (g_rect, title)) in group_rects.iter().enumerate() {
            ui.painter().text(
                egui::pos2(g_rect.center().x, title_y),
                egui::Align2::CENTER_CENTER,
                title.to_uppercase(),
                egui::FontId::proportional(9.0),
                palette.fg_dim,
            );
            if i + 1 < group_rects.len() {
                let sx = g_rect.right() + 4.0;
                ui.painter().line_segment(
                    [egui::pos2(sx, group_rect.top() + 6.0),
                     egui::pos2(sx, group_rect.bottom() - 18.0)],
                    egui::Stroke::new(1.0, palette.border),
                );
            }
        }
        actions
    }
}

// Re-export ButtonSize publicly so consumers can build RibbonButtonDef without
// reaching into the primitives module path.
pub use crate::primitives::button::ButtonSize;
