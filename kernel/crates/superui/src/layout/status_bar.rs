//! `StatusBar` — bottom strip with composable sections (coords, zoom,
//! tool, layer count, snap toggles). Sections are data-driven; the
//! consumer builds `Vec<StatusSection>` per frame.

use crate::theme::Theme;
use crate::tokens::metrics;
use egui::{Sense, Ui, Vec2};

#[derive(Debug, Clone)]
pub enum StatusSection {
    Text(String),
    Toggle { label: String, on: bool, id: String },
    Spacer,
}

#[derive(Debug, Clone)]
pub enum StatusBarAction {
    Toggled(String),
}

pub struct StatusBar {
    sections: Vec<StatusSection>,
}

impl StatusBar {
    pub fn new(sections: Vec<StatusSection>) -> Self { Self { sections } }

    pub fn show(self, ui: &mut Ui) -> Vec<StatusBarAction> {
        let mut actions = Vec::new();
        let palette = Theme::Default.palette();
        let h = metrics::STATUSBAR_HEIGHT;
        let avail_w = ui.available_width();
        let (rect, _) = ui.allocate_exact_size(Vec2::new(avail_w, h), Sense::hover());
        ui.painter().rect_filled(rect, 0.0, palette.status_bg);
        ui.allocate_ui_at_rect(rect, |ui| {
            ui.horizontal_centered(|ui| {
                ui.add_space(8.0);
                for section in &self.sections {
                    match section {
                        StatusSection::Text(s) => {
                            ui.label(
                                egui::RichText::new(s)
                                    .size(11.0)
                                    .color(palette.fg_dim),
                            );
                            ui.add_space(12.0);
                        }
                        StatusSection::Toggle { label, on, id } => {
                            let bg = if *on { palette.button_active } else { palette.status_bg };
                            let (trect, tresp) = ui.allocate_exact_size(
                                Vec2::new((label.chars().count() as f32 * 7.0).max(40.0) + 12.0, h - 4.0),
                                Sense::click(),
                            );
                            ui.painter().rect_filled(trect, 0.0, bg);
                            ui.painter().text(
                                trect.center(),
                                egui::Align2::CENTER_CENTER,
                                label,
                                egui::FontId::proportional(11.0),
                                palette.fg,
                            );
                            if tresp.clicked() {
                                actions.push(StatusBarAction::Toggled(id.clone()));
                            }
                            ui.add_space(4.0);
                        }
                        StatusSection::Spacer => {
                            ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |_| {});
                            ui.add_space(8.0);
                        }
                    }
                }
            });
        });
        actions
    }
}
