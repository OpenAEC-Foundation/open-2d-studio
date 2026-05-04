//! `FileTabBar` — Chrome-style file tabs with sloped right divider.
//! Click to activate, × to close, + to create. Matches 1.0's
//! FileTabBar component visually.

use crate::theme::Theme;
use crate::tokens::metrics;
use egui::{Sense, Shape, Ui, Vec2, Pos2, Color32};

pub struct FileTabDef {
    pub id: usize,
    pub label: String,
    pub modified: bool,
}

#[derive(Debug, Clone)]
pub enum FileTabAction {
    Activate(usize),
    Close(usize),
    NewTab,
}

pub struct FileTabBar<'a> {
    tabs: &'a [FileTabDef],
    active_id: Option<usize>,
}

impl<'a> FileTabBar<'a> {
    pub fn new(tabs: &'a [FileTabDef]) -> Self {
        Self { tabs, active_id: None }
    }
    pub fn active(mut self, id: usize) -> Self {
        self.active_id = Some(id);
        self
    }

    pub fn show(self, ui: &mut Ui) -> Vec<FileTabAction> {
        let mut actions = Vec::new();
        let palette = Theme::Default.palette();
        let h = metrics::FILETAB_HEIGHT;
        let avail_w = ui.available_width();
        let (bar_rect, _) = ui.allocate_exact_size(Vec2::new(avail_w, h), Sense::hover());
        ui.painter().rect_filled(bar_rect, 0.0, palette.bg);

        ui.allocate_ui_at_rect(bar_rect, |ui| {
            ui.horizontal_centered(|ui| {
                ui.add_space(4.0);
                for tab in self.tabs {
                    let is_active = self.active_id == Some(tab.id);
                    let label_w = (tab.label.chars().count() as f32 * 7.0).max(60.0).min(180.0);
                    let tab_w = label_w + 36.0; // label + close × + slope
                    let (trect, tresp) = ui.allocate_exact_size(
                        Vec2::new(tab_w, h),
                        Sense::click(),
                    );
                    let fill = if is_active {
                        palette.panel_bg
                    } else if tresp.hovered() {
                        palette.button_hover
                    } else {
                        palette.bg
                    };
                    // Sloped right edge — convex polygon
                    let slope = 8.0_f32;
                    let pts = vec![
                        trect.left_top(),
                        Pos2::new(trect.right() - slope, trect.top()),
                        Pos2::new(trect.right(), trect.bottom()),
                        trect.left_bottom(),
                    ];
                    ui.painter().add(Shape::convex_polygon(
                        pts.clone(),
                        fill,
                        egui::Stroke::new(if is_active { 0.0 } else { 1.0 }, palette.border),
                    ));
                    // Active accent line at top
                    if is_active {
                        ui.painter().line_segment(
                            [trect.left_top(), Pos2::new(trect.right() - slope, trect.top())],
                            egui::Stroke::new(2.0, palette.accent),
                        );
                    }
                    // Label
                    let label_text = if tab.modified {
                        format!("● {}", tab.label)
                    } else {
                        tab.label.clone()
                    };
                    ui.painter().text(
                        Pos2::new(trect.left() + 8.0, trect.center().y),
                        egui::Align2::LEFT_CENTER,
                        label_text,
                        egui::FontId::proportional(11.0),
                        palette.fg,
                    );
                    // Close × button
                    let close_rect = egui::Rect::from_center_size(
                        Pos2::new(trect.right() - slope - 8.0, trect.center().y),
                        Vec2::new(14.0, 14.0),
                    );
                    let close_resp = ui.interact(close_rect, ui.id().with(("close", tab.id)), Sense::click());
                    let cc = close_rect.center();
                    let ic = if close_resp.hovered() { palette.fg } else { palette.fg_dim };
                    ui.painter().line_segment(
                        [Pos2::new(cc.x - 4.0, cc.y - 4.0), Pos2::new(cc.x + 4.0, cc.y + 4.0)],
                        egui::Stroke::new(1.2, ic),
                    );
                    ui.painter().line_segment(
                        [Pos2::new(cc.x + 4.0, cc.y - 4.0), Pos2::new(cc.x - 4.0, cc.y + 4.0)],
                        egui::Stroke::new(1.2, ic),
                    );

                    if close_resp.clicked() {
                        actions.push(FileTabAction::Close(tab.id));
                    } else if tresp.clicked() && !is_active {
                        actions.push(FileTabAction::Activate(tab.id));
                    }
                    ui.add_space(2.0);
                }
                // "+" new tab button
                let plus_size = Vec2::new(28.0, h);
                let (prect, presp) = ui.allocate_exact_size(plus_size, Sense::click());
                let pfill = if presp.hovered() { palette.button_hover } else { Color32::TRANSPARENT };
                if pfill != Color32::TRANSPARENT {
                    ui.painter().rect_filled(prect, 0.0, pfill);
                }
                let pc = prect.center();
                ui.painter().line_segment(
                    [Pos2::new(pc.x - 5.0, pc.y), Pos2::new(pc.x + 5.0, pc.y)],
                    egui::Stroke::new(1.4, palette.fg),
                );
                ui.painter().line_segment(
                    [Pos2::new(pc.x, pc.y - 5.0), Pos2::new(pc.x, pc.y + 5.0)],
                    egui::Stroke::new(1.4, palette.fg),
                );
                if presp.clicked() {
                    actions.push(FileTabAction::NewTab);
                }
            });
        });
        actions
    }
}
