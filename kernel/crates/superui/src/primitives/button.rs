//! `CadButton` — the ribbon's primary button widget. Three size
//! variants matching 1.0's `Ribbon.css`. Paints onto a deterministic
//! cell rect when constructed via `CadButton::cell(size, rect, label)`,
//! or auto-allocates when constructed via `large/medium/small` (legacy
//! convenience API).

use crate::icon::{IconKind, paint_icon};
use crate::theme::Theme;
use crate::tokens::{metrics, ribbon_grid as rg};
use egui::{Color32, Response, Sense, Stroke, Ui, Vec2};

/// Variant determines size + label-icon layout.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ButtonSize {
    Large,
    Medium,
    Small,
}

/// Ribbon button. Use `CadButton::cell(size, rect, label)` from the
/// ribbon painter (deterministic), or `large/medium/small` for ad-hoc
/// usage that auto-allocates.
pub struct CadButton<'a> {
    label: &'a str,
    size: ButtonSize,
    /// If set, paint into this exact rect (ribbon grid mode).
    cell_rect: Option<egui::Rect>,
    icon: Option<IconKind>,
    selected: bool,
    enabled: bool,
    /// Show the caption text. Large always shows it; Medium/Small default
    /// off (icon-only) unless the consumer opts in.
    show_caption: bool,
}

impl<'a> CadButton<'a> {
    pub fn large(label: &'a str) -> Self { Self::new(label, ButtonSize::Large) }
    pub fn medium(label: &'a str) -> Self { Self::new(label, ButtonSize::Medium) }
    pub fn small(label: &'a str) -> Self { Self::new(label, ButtonSize::Small) }
    /// Cell-rect constructor — paints into a fixed rect supplied by the
    /// ribbon painter. Used to enforce grid alignment.
    pub fn cell(size: ButtonSize, rect: egui::Rect, label: &'a str) -> Self {
        Self {
            label,
            size,
            cell_rect: Some(rect),
            icon: None,
            selected: false,
            enabled: true,
            // Large always captioned; Medium/Small default to icon-only.
            show_caption: matches!(size, ButtonSize::Large),
        }
    }
    fn new(label: &'a str, size: ButtonSize) -> Self {
        Self {
            label, size, cell_rect: None, icon: None, selected: false, enabled: true,
            show_caption: matches!(size, ButtonSize::Large),
        }
    }
    pub fn icon(mut self, k: IconKind) -> Self { self.icon = Some(k); self }
    pub fn selected(mut self, b: bool) -> Self { self.selected = b; self }
    pub fn enabled(mut self, b: bool) -> Self { self.enabled = b; self }
    pub fn show_caption(mut self, b: bool) -> Self { self.show_caption = b; self }

    pub fn show(self, ui: &mut Ui) -> Response {
        let palette = Theme::Default.palette();
        let icon_size = match self.size {
            ButtonSize::Large => rg::ICON_LARGE,
            ButtonSize::Medium => rg::ICON_MEDIUM,
            ButtonSize::Small => rg::ICON_SMALL,
        };
        let caption_size = match self.size {
            ButtonSize::Large => rg::CAPTION_LARGE,
            ButtonSize::Medium => rg::CAPTION_MEDIUM,
            ButtonSize::Small => rg::CAPTION_SMALL,
        };

        let (rect, response) = if let Some(r) = self.cell_rect {
            let resp = ui.interact(r, ui.id().with(self.label), Sense::click());
            (r, resp)
        } else {
            let size_v = match self.size {
                ButtonSize::Large => Vec2::new(rg::LARGE_W, rg::LARGE_H),
                ButtonSize::Medium => Vec2::new(rg::MEDIUM_W, rg::MEDIUM_H),
                ButtonSize::Small => Vec2::new(rg::SMALL_W, rg::SMALL_H),
            };
            ui.allocate_exact_size(size_v, Sense::click())
        };
        let painter = ui.painter();

        // ---- Background fill ----------------------------------
        let bg = if !self.enabled {
            Color32::TRANSPARENT
        } else if response.is_pointer_button_down_on() {
            if matches!(self.size, ButtonSize::Large) { palette.button_active }
            else { palette.button_hover }
        } else if self.selected {
            match self.size {
                ButtonSize::Large => palette.button_active,
                _ => Color32::TRANSPARENT,
            }
        } else if response.hovered() {
            palette.button_hover
        } else {
            Color32::TRANSPARENT
        };
        if bg != Color32::TRANSPARENT {
            painter.rect_filled(rect, 0.0, bg);
        }
        let _ = metrics::RIBBON_BUTTON_LARGE; // keep token referenced

        let fg = if self.enabled { palette.fg } else { palette.fg_dim };

        // ---- Layout: Large = stacked, Medium/Small = horizontal ----
        match self.size {
            ButtonSize::Large => {
                // Icon on a deterministic upper baseline, caption on a
                // deterministic lower baseline. No upper/lower
                // proportions: pinned to fixed offsets so all Large
                // tiles in a row line up no matter the cell height.
                let pad = rg::CELL_PAD;
                let icon_cy = rect.top() + pad + icon_size * 0.5 + 4.0;
                if let Some(k) = self.icon {
                    let icon_rect = egui::Rect::from_center_size(
                        egui::pos2(rect.center().x, icon_cy),
                        egui::vec2(icon_size, icon_size),
                    );
                    paint_icon(painter, icon_rect, k, fg);
                }
                if self.show_caption {
                    let caption_cy = rect.bottom() - pad - caption_size * 0.5 - 2.0;
                    painter.text(
                        egui::pos2(rect.center().x, caption_cy),
                        egui::Align2::CENTER_CENTER,
                        self.label,
                        egui::FontId::proportional(caption_size),
                        fg,
                    );
                }
            }
            ButtonSize::Medium | ButtonSize::Small => {
                // Icon left-anchored, caption to its right (when shown),
                // both centred vertically. When icon-only the icon is
                // centred horizontally in the cell.
                let pad = rg::CELL_PAD;
                if self.show_caption {
                    let icon_cx = rect.left() + pad + icon_size * 0.5;
                    let icon_rect = egui::Rect::from_center_size(
                        egui::pos2(icon_cx, rect.center().y),
                        egui::vec2(icon_size, icon_size),
                    );
                    if let Some(k) = self.icon {
                        paint_icon(painter, icon_rect, k, fg);
                    }
                    painter.text(
                        egui::pos2(icon_rect.right() + rg::ICON_CAPTION_GAP, rect.center().y),
                        egui::Align2::LEFT_CENTER,
                        self.label,
                        egui::FontId::proportional(caption_size),
                        fg,
                    );
                } else {
                    let icon_rect = egui::Rect::from_center_size(
                        rect.center(),
                        egui::vec2(icon_size, icon_size),
                    );
                    if let Some(k) = self.icon {
                        paint_icon(painter, icon_rect, k, fg);
                    }
                }
            }
        }

        if self.selected && !matches!(self.size, ButtonSize::Large) {
            painter.line_segment(
                [egui::pos2(rect.left() + 2.0, rect.bottom() - 1.0),
                 egui::pos2(rect.right() - 2.0, rect.bottom() - 1.0)],
                Stroke::new(2.0, palette.accent),
            );
        }

        response
    }
}
