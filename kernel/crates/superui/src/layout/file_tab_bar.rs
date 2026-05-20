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
        let avail_w = ui.available_width();
        let (bar_rect, _) = ui.allocate_exact_size(Vec2::new(avail_w, h), Sense::hover());
        // 1.0's FileTabBar lives on cad-surface (#4A4242), not the brown
        // body bg — verified via computed styles on the live web app.
        ui.painter().rect_filled(bar_rect, 0.0, palette.titlebar_bg);

        // Tail-truncation: hard cap on visible characters per tab so a
        // very long DWG/DXF filename can't blow the bar wide and overlap
        // its neighbours. 24 chars × ~7 px ≈ 168 px label, which leaves
        // headroom under the 180 px max width. See `truncate_tail`.
        const MAX_LABEL_CHARS: usize = 24;
        ui.allocate_ui_at_rect(bar_rect, |ui| {
            ui.horizontal_centered(|ui| {
                ui.add_space(4.0);
                for tab in self.tabs {
                    let is_active = self.active_id == Some(tab.id);
                    let display_label = truncate_tail(&tab.label, MAX_LABEL_CHARS);
                    let was_truncated = display_label.chars().count() < tab.label.chars().count();
                    let label_w = (display_label.chars().count() as f32 * 7.0).max(60.0).min(180.0);
                    let tab_w = label_w + 36.0; // label + close × + slope
                    let (trect, tresp) = ui.allocate_exact_size(
                        Vec2::new(tab_w, h),
                        Sense::click(),
                    );
                    // Hover tooltip: full filename — essential when the
                    // label was tail-truncated so the user can still see
                    // the leading path / prefix.
                    let tresp = if was_truncated {
                        tresp.on_hover_text(&tab.label)
                    } else {
                        tresp
                    };
                    // Active tab pulls down from titlebar onto the body
                    // brown — visually it "leaks" into the ribbon area.
                    // Inactive tabs share the bar's surface tone.
                    let fill = if is_active {
                        palette.bg
                    } else if tresp.hovered() {
                        palette.button_hover
                    } else {
                        palette.titlebar_bg
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
                    // Label — use the tail-truncated string. Modified
                    // bullet stays in front of the (possibly truncated)
                    // text, never gets chopped off.
                    let label_text = if tab.modified {
                        format!("\u{25CF} {}", display_label)
                    } else {
                        display_label.clone()
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
