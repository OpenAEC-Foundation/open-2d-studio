//! `CadButton` — the ribbon's primary button widget. Three size
//! variants (large 66 px, medium 32 px, small 22 px) matching 1.0's
//! `Ribbon.css`.
//!
//! Renders icon + label, supports hover/active/disabled visuals,
//! returns `egui::Response` so callers can chain `.clicked()`.

use crate::icon::{IconKind, paint_icon};
use crate::theme::Theme;
use crate::tokens::metrics;
use egui::{Color32, Response, Sense, Stroke, Ui, Vec2};

/// Variant determines size + label-icon layout.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ButtonSize {
    Large,
    Medium,
    Small,
}

/// Ribbon button. Use the constructor functions to pick size:
/// `CadButton::large(label).icon(IconKind::Line).show(ui)`.
pub struct CadButton<'a> {
    label: &'a str,
    size: ButtonSize,
    icon: Option<IconKind>,
    selected: bool,
    enabled: bool,
}

impl<'a> CadButton<'a> {
    pub fn large(label: &'a str) -> Self { Self::new(label, ButtonSize::Large) }
    pub fn medium(label: &'a str) -> Self { Self::new(label, ButtonSize::Medium) }
    pub fn small(label: &'a str) -> Self { Self::new(label, ButtonSize::Small) }
    fn new(label: &'a str, size: ButtonSize) -> Self {
        Self { label, size, icon: None, selected: false, enabled: true }
    }
    pub fn icon(mut self, k: IconKind) -> Self { self.icon = Some(k); self }
    pub fn selected(mut self, b: bool) -> Self { self.selected = b; self }
    pub fn enabled(mut self, b: bool) -> Self { self.enabled = b; self }

    pub fn show(self, ui: &mut Ui) -> Response {
        let palette = Theme::Default.palette();
        let (size_v, icon_size) = match self.size {
            ButtonSize::Large  => (Vec2::new(66.0, metrics::RIBBON_BUTTON_LARGE), metrics::ICON_LG),
            ButtonSize::Medium => (Vec2::new(110.0, metrics::RIBBON_BUTTON_MEDIUM), metrics::ICON_MD),
            ButtonSize::Small  => (Vec2::new(110.0, metrics::RIBBON_BUTTON_SMALL), metrics::ICON_SM),
        };
        let (rect, response) = ui.allocate_exact_size(size_v, Sense::click());
        let painter = ui.painter();

        // Background fill based on state.
        let bg = if !self.enabled {
            palette.button_bg
        } else if response.is_pointer_button_down_on() {
            palette.button_active
        } else if self.selected {
            palette.button_active
        } else if response.hovered() {
            palette.button_hover
        } else {
            Color32::TRANSPARENT
        };
        if bg != Color32::TRANSPARENT {
            painter.rect_filled(rect, 0.0, bg);
        }

        let fg = if self.enabled { palette.fg } else { palette.fg_dim };

        match self.size {
            ButtonSize::Large => {
                // Icon on top, label below.
                if let Some(k) = self.icon {
                    let icon_rect = egui::Rect::from_center_size(
                        egui::pos2(rect.center().x, rect.top() + icon_size * 0.6 + 6.0),
                        egui::vec2(icon_size, icon_size),
                    );
                    paint_icon(painter, icon_rect, k, fg);
                }
                painter.text(
                    egui::pos2(rect.center().x, rect.bottom() - 14.0),
                    egui::Align2::CENTER_CENTER,
                    self.label,
                    egui::FontId::proportional(11.0),
                    fg,
                );
            }
            ButtonSize::Medium | ButtonSize::Small => {
                // Icon + label horizontal.
                let pad = 6.0_f32;
                let icon_rect = egui::Rect::from_center_size(
                    egui::pos2(rect.left() + pad + icon_size * 0.5, rect.center().y),
                    egui::vec2(icon_size, icon_size),
                );
                if let Some(k) = self.icon {
                    paint_icon(painter, icon_rect, k, fg);
                }
                painter.text(
                    egui::pos2(rect.left() + pad * 2.0 + icon_size, rect.center().y),
                    egui::Align2::LEFT_CENTER,
                    self.label,
                    egui::FontId::proportional(11.0),
                    fg,
                );
            }
        }

        // Subtle 1 px stroke when selected so the active state reads.
        if self.selected {
            painter.rect_stroke(rect, 0.0, Stroke::new(1.0, palette.accent));
        }

        response
    }
}
