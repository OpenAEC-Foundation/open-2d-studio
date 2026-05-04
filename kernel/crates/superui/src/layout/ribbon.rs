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
                    let label_w = ui.painter().layout_no_wrap(
                        tab.label.clone(),
                        egui::FontId::proportional(12.0),
                        palette.fg,
                    ).rect.width();
                    let (trect, tresp) = ui.allocate_exact_size(
                        Vec2::new(label_w + 24.0, tab_h),
                        Sense::click(),
                    );
                    let bg = if is_active {
                        palette.ribbon_tab_active_bg
                    } else if tresp.hovered() {
                        palette.button_hover
                    } else {
                        palette.ribbon_tab_bg
                    };
                    ui.painter().rect_filled(trect, 0.0, bg);
                    ui.painter().text(
                        trect.center(),
                        egui::Align2::CENTER_CENTER,
                        &tab.label,
                        egui::FontId::proportional(12.0),
                        palette.fg,
                    );
                    if is_active {
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

        // Group strip — render only the active tab's groups
        let group_h = metrics::RIBBON_CONTENT_HEIGHT;
        let (group_rect, _) = ui.allocate_exact_size(Vec2::new(avail_w, group_h), Sense::hover());
        ui.painter().rect_filled(group_rect, 0.0, palette.ribbon_tab_active_bg);
        ui.allocate_ui_at_rect(group_rect, |ui| {
            ui.horizontal(|ui| {
                if let Some(active_tab) = self.tabs.iter().find(|t| t.id == self.active) {
                    for group in &active_tab.groups {
                        ui.add_space(8.0);
                        ui.vertical(|ui| {
                            ui.horizontal(|ui| {
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
                            });
                            // Group title at bottom
                            ui.label(
                                egui::RichText::new(&group.title)
                                    .size(10.0)
                                    .color(palette.fg_dim),
                            );
                        });
                        ui.add_space(4.0);
                        // 1 px separator after group
                        let sep_x = ui.cursor().left();
                        ui.painter().line_segment(
                            [egui::pos2(sep_x, group_rect.top() + 4.0),
                             egui::pos2(sep_x, group_rect.bottom() - 4.0)],
                            egui::Stroke::new(1.0, palette.border),
                        );
                    }
                }
            });
        });
        actions
    }
}

// Re-export ButtonSize publicly so consumers can build RibbonButtonDef without
// reaching into the primitives module path.
pub use crate::primitives::button::ButtonSize;
