//! `TitleBar` widget — top bar with app icon, title text, and Windows
//! controls (minimise / maximise / close). Matches 1.0's TitleBar.tsx.

use crate::theme::Theme;
use crate::tokens::metrics;
use egui::{Sense, Ui, Vec2};

#[derive(Debug, Clone, Copy)]
pub enum TitleBarAction {
    OpenAppMenu,
    Minimize,
    ToggleMaximize,
    Close,
}

pub struct TitleBar<'a> {
    title: &'a str,
    is_maximized: bool,
}

impl<'a> TitleBar<'a> {
    pub fn new(title: &'a str) -> Self {
        Self { title, is_maximized: false }
    }
    pub fn maximized(mut self, b: bool) -> Self { self.is_maximized = b; self }

    pub fn show(self, ui: &mut Ui) -> Vec<TitleBarAction> {
        let mut actions = Vec::new();
        let palette = Theme::Default.palette();
        let height = metrics::TITLEBAR_HEIGHT;
        let avail = ui.available_width();
        let (rect, _resp) = ui.allocate_exact_size(Vec2::new(avail, height), Sense::hover());
        ui.painter().rect_filled(rect, 0.0, palette.titlebar_bg);

        // 3-region layout: app menu (left), title (center), window controls (right)
        ui.allocate_ui_at_rect(rect, |ui| {
            ui.horizontal_centered(|ui| {
                ui.add_space(4.0);
                // App menu trigger — small square button with hamburger.
                let menu_size = Vec2::new(28.0, height - 4.0);
                let (mrect, mresp) = ui.allocate_exact_size(menu_size, Sense::click());
                if mresp.hovered() {
                    ui.painter().rect_filled(mrect, 0.0, palette.button_hover);
                }
                // Three horizontal lines for hamburger.
                let cx = mrect.center().x;
                let cy = mrect.center().y;
                let bar_w = 14.0;
                for offset in [-5.0, 0.0, 5.0] {
                    ui.painter().line_segment(
                        [egui::pos2(cx - bar_w * 0.5, cy + offset),
                         egui::pos2(cx + bar_w * 0.5, cy + offset)],
                        egui::Stroke::new(1.6, palette.fg),
                    );
                }
                if mresp.clicked() { actions.push(TitleBarAction::OpenAppMenu); }

                ui.add_space(8.0);
                ui.label(egui::RichText::new(self.title).color(palette.fg).size(12.0));

                ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                    // Close button
                    let close_size = Vec2::new(36.0, height);
                    let (crect, cresp) = ui.allocate_exact_size(close_size, Sense::click());
                    let bg = if cresp.hovered() { palette.close_red } else { palette.titlebar_bg };
                    ui.painter().rect_filled(crect, 0.0, bg);
                    let cc = crect.center();
                    let ic = if cresp.hovered() { egui::Color32::WHITE } else { palette.fg };
                    ui.painter().line_segment(
                        [egui::pos2(cc.x - 5.0, cc.y - 5.0), egui::pos2(cc.x + 5.0, cc.y + 5.0)],
                        egui::Stroke::new(1.4, ic),
                    );
                    ui.painter().line_segment(
                        [egui::pos2(cc.x + 5.0, cc.y - 5.0), egui::pos2(cc.x - 5.0, cc.y + 5.0)],
                        egui::Stroke::new(1.4, ic),
                    );
                    if cresp.clicked() { actions.push(TitleBarAction::Close); }

                    // Maximize button
                    let max_size = Vec2::new(36.0, height);
                    let (mxrect, mxresp) = ui.allocate_exact_size(max_size, Sense::click());
                    if mxresp.hovered() {
                        ui.painter().rect_filled(mxrect, 0.0, palette.button_hover);
                    }
                    let mxc = mxrect.center();
                    if self.is_maximized {
                        // Two overlapped rectangles (restore icon)
                        ui.painter().rect_stroke(
                            egui::Rect::from_center_size(egui::pos2(mxc.x + 1.5, mxc.y - 1.5), egui::vec2(8.0, 8.0)),
                            0.0,
                            egui::Stroke::new(1.2, palette.fg),
                        );
                        ui.painter().rect_stroke(
                            egui::Rect::from_center_size(egui::pos2(mxc.x - 1.5, mxc.y + 1.5), egui::vec2(8.0, 8.0)),
                            0.0,
                            egui::Stroke::new(1.2, palette.fg),
                        );
                    } else {
                        ui.painter().rect_stroke(
                            egui::Rect::from_center_size(mxc, egui::vec2(10.0, 10.0)),
                            0.0,
                            egui::Stroke::new(1.2, palette.fg),
                        );
                    }
                    if mxresp.clicked() { actions.push(TitleBarAction::ToggleMaximize); }

                    // Minimize button
                    let min_size = Vec2::new(36.0, height);
                    let (minrect, minresp) = ui.allocate_exact_size(min_size, Sense::click());
                    if minresp.hovered() {
                        ui.painter().rect_filled(minrect, 0.0, palette.button_hover);
                    }
                    let minc = minrect.center();
                    ui.painter().line_segment(
                        [egui::pos2(minc.x - 5.0, minc.y), egui::pos2(minc.x + 5.0, minc.y)],
                        egui::Stroke::new(1.4, palette.fg),
                    );
                    if minresp.clicked() { actions.push(TitleBarAction::Minimize); }
                });
            });
        });
        actions
    }
}
