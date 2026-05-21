//! `FileTabBar` — Chrome-style file tabs with sloped right divider.
//! Mirrors the JSX mockup at `Open2DViewerMockup.jsx` lines 346-370 and
//! 759-780 verbatim.
//!
//! Mockup spec:
//! - Bar height 30 px, background `surface` (#4A4242), 1 px `border`
//!   bottom border.
//! - Each tab is a horizontal flex strip: the label region (no rounded
//!   corners) followed by a 14 px wide sloped polygon that smoothly
//!   transitions the colour into the next tab.
//! - Active tab fill = body `bg` (#3E3636) — leaks into ribbon body.
//! - Inactive tab fill = `surface` (so its sloped edge over `surface`
//!   reads as continuous with the strip background).
//! - Active tab label is `text` 12 px weight 600; inactive tabs use
//!   `text-dim` 12 px weight 400.
//! - Close × button: 16 px square hidden (opacity 0) until tab hover.
//! - "+" new-tab button: 28 px wide, neutral fg-dim icon, brightens to
//!   fg on hover.

use crate::theme::Theme;
use crate::tokens::metrics;
use egui::{Color32, Sense, Shape, Ui, Vec2, Pos2};

pub struct FileTabDef {
    pub id: usize,
    pub label: String,
    pub modified: bool,
}

/// Truncate `label` from the LEFT side so the *tail* of the filename
/// stays visible. CAD filenames carry their meaningful identifier at the
/// end (e.g. `…CP-21.dwg`, `…rev-3.dwg`); a head-truncation would chop
/// off exactly the part the user needs to distinguish similarly-prefixed
/// drawings.
///
/// If `label` already fits within `max_chars`, it is returned unchanged.
/// Otherwise we keep the last `max_chars - 1` characters and prepend an
/// ellipsis: `…tail`.
///
/// Uses `chars().count()` (not `len()`) so we don't slice multibyte UTF-8
/// in the middle of a codepoint.
pub fn truncate_tail(label: &str, max_chars: usize) -> String {
    let n = label.chars().count();
    if n <= max_chars || max_chars == 0 {
        return label.to_string();
    }
    let keep = max_chars.saturating_sub(1).max(1);
    let skip = n - keep;
    let tail: String = label.chars().skip(skip).collect();
    format!("\u{2026}{}", tail)
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
        // Slope width — mockup `<svg width="14" height="30">`.
        let slope = 14.0_f32;
        let avail_w = ui.available_width();
        let (bar_rect, _) = ui.allocate_exact_size(Vec2::new(avail_w, h), Sense::hover());
        // Bar background = surface (#4A4242).
        ui.painter().rect_filled(bar_rect, 0.0, palette.panel_bg);
        // 1 px border bottom (mockup `border-bottom: 1px solid border`).
        ui.painter().line_segment(
            [Pos2::new(bar_rect.left(), bar_rect.bottom() - 0.5),
             Pos2::new(bar_rect.right(), bar_rect.bottom() - 0.5)],
            egui::Stroke::new(1.0, palette.border),
        );

        // Tail-truncation cap so a very long DWG/DXF filename can't blow
        // the bar wide and overlap its neighbours.
        const MAX_LABEL_CHARS: usize = 24;

        let mut x = bar_rect.left();
        for (i, tab) in self.tabs.iter().enumerate() {
            let is_active = self.active_id == Some(tab.id);
            let next_active = self.tabs.get(i + 1).map(|n| self.active_id == Some(n.id)).unwrap_or(false);
            let display_label = truncate_tail(&tab.label, MAX_LABEL_CHARS);
            let was_truncated = display_label.chars().count() < tab.label.chars().count();
            // Label width (eyeballed font: 12 px proportional → ~7 px/ch).
            let label_w = (display_label.chars().count() as f32 * 7.5).clamp(60.0, 200.0);
            // Mockup px-3 left + close × 16 + right pad ≈ 60 px chrome.
            let body_w = label_w + 44.0;
            // Total tab width = body + slope.
            let tab_w = body_w + slope;
            let body_rect = egui::Rect::from_min_size(
                Pos2::new(x, bar_rect.top()),
                Vec2::new(body_w, h),
            );
            let slope_rect = egui::Rect::from_min_size(
                Pos2::new(body_rect.right(), bar_rect.top()),
                Vec2::new(slope, h),
            );
            // Whole-tab interact for click + hover detection.
            let tab_rect = egui::Rect::from_min_size(
                Pos2::new(x, bar_rect.top()),
                Vec2::new(tab_w, h),
            );
            let tresp = ui.interact(tab_rect, ui.id().with(("filetab", tab.id)), Sense::click());
            let tresp = if was_truncated { tresp.on_hover_text(&tab.label) } else { tresp };

            // Tab body fill = bg (active) or surface (inactive).
            let body_fill = if is_active { palette.bg } else { palette.panel_bg };
            ui.painter().rect_filled(body_rect, egui::Rounding::ZERO, body_fill);
            // Sloped right edge — two triangles painted side-by-side so
            // the seam between this tab and the next reads as a smooth
            // diagonal (mockup `<polygon points="0,0 0,30 14,30">` and
            // `<polygon points="0,0 14,0 14,30">`).
            // Triangle A (this tab's slope): left edge vertical, bottom
            // diagonal to right-bottom corner. Filled with this tab's bg.
            let next_fill = if next_active { palette.bg } else { palette.panel_bg };
            ui.painter().add(Shape::convex_polygon(
                vec![
                    slope_rect.left_top(),
                    slope_rect.left_bottom(),
                    slope_rect.right_bottom(),
                ],
                body_fill,
                egui::Stroke::NONE,
            ));
            // Triangle B (next tab's preamble): top-right diagonal fills
            // with the next tab's bg.
            ui.painter().add(Shape::convex_polygon(
                vec![
                    slope_rect.left_top(),
                    slope_rect.right_top(),
                    slope_rect.right_bottom(),
                ],
                next_fill,
                egui::Stroke::NONE,
            ));
            // Label — mockup px-3 (12 px left padding), font 12, weight
            // 600 active / 400 inactive. We approximate the weight with
            // a slightly brighter colour on the active tab.
            let label_text = if tab.modified {
                format!("{} *", display_label)
            } else {
                display_label.clone()
            };
            let label_color = if is_active { palette.fg } else { palette.fg_dim };
            ui.painter().text(
                Pos2::new(body_rect.left() + 12.0, body_rect.center().y),
                egui::Align2::LEFT_CENTER,
                label_text,
                egui::FontId::proportional(12.0),
                label_color,
            );
            // Close × button — shown only on tab hover (mockup
            // `opacity-0 group-hover:opacity-100`).
            let close_rect = egui::Rect::from_center_size(
                Pos2::new(body_rect.right() - 12.0, body_rect.center().y),
                Vec2::new(14.0, 14.0),
            );
            let close_resp = ui.interact(close_rect, ui.id().with(("close", tab.id)), Sense::click());
            if tresp.hovered() || close_resp.hovered() {
                let cc = close_rect.center();
                let ic = if close_resp.hovered() { palette.fg } else { palette.fg_dim };
                ui.painter().line_segment(
                    [Pos2::new(cc.x - 4.0, cc.y - 4.0), Pos2::new(cc.x + 4.0, cc.y + 4.0)],
                    egui::Stroke::new(1.0, ic),
                );
                ui.painter().line_segment(
                    [Pos2::new(cc.x + 4.0, cc.y - 4.0), Pos2::new(cc.x - 4.0, cc.y + 4.0)],
                    egui::Stroke::new(1.0, ic),
                );
            }
            if close_resp.clicked() {
                actions.push(FileTabAction::Close(tab.id));
            } else if tresp.clicked() && !is_active {
                actions.push(FileTabAction::Activate(tab.id));
            }
            x += tab_w;
        }
        // "+" new-tab button — mockup w-7 (28 px), fg-dim icon
        // brightening to fg on hover.
        let plus_w = 28.0_f32;
        let plus_rect = egui::Rect::from_min_size(
            Pos2::new(x, bar_rect.top()),
            Vec2::new(plus_w, h),
        );
        let presp = ui.interact(plus_rect, ui.id().with("filetab_plus"), Sense::click());
        let pfill = if presp.hovered() { palette.hover } else { Color32::TRANSPARENT };
        if pfill != Color32::TRANSPARENT {
            ui.painter().rect_filled(plus_rect, 0.0, pfill);
        }
        let pcol = if presp.hovered() { palette.fg } else { palette.fg_dim };
        let pc = plus_rect.center();
        ui.painter().text(
            pc,
            egui::Align2::CENTER_CENTER,
            "+",
            egui::FontId::proportional(14.0),
            pcol,
        );
        if presp.clicked() {
            actions.push(FileTabAction::NewTab);
        }
        actions
    }
}

#[cfg(test)]
mod tests {
    use super::truncate_tail;

    #[test]
    fn short_label_unchanged() {
        assert_eq!(truncate_tail("foo.dwg", 24), "foo.dwg");
    }

    #[test]
    fn exact_length_unchanged() {
        let s = "a".repeat(24);
        assert_eq!(truncate_tail(&s, 24), s);
    }

    #[test]
    fn long_label_keeps_tail() {
        let s = "2705_model_Funderingsherstel_Constructietekening.dwg";
        let out = truncate_tail(s, 24);
        // Output: ellipsis + last 23 characters.
        assert!(out.starts_with('\u{2026}'));
        assert_eq!(out.chars().count(), 24);
        assert!(out.ends_with(".dwg"));
        // The meaningful tail must be visible.
        assert!(out.contains("Constructietekening.dwg"));
    }

    #[test]
    fn multibyte_safe() {
        // Make sure we don't slice mid-codepoint on UTF-8.
        let s = "ééééééééééééééééééééééééééééé.dwg"; // 33 chars
        let out = truncate_tail(s, 10);
        assert_eq!(out.chars().count(), 10);
        assert!(out.ends_with(".dwg"));
    }

    #[test]
    fn zero_max_returns_input() {
        assert_eq!(truncate_tail("anything", 0), "anything");
    }
}
