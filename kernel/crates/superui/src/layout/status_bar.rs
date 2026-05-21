//! `StatusBar` — bottom strip with composable sections matching the
//! JSX mockup (`Open2DViewerMockup.jsx` lines 927-1029).
//!
//! Mockup spec:
//! - 24 px tall bar on `surface` (#4A4242), 1 px `border-light` top border,
//!   `text-xs` (12 px), `gap: 24px` between section clusters
//! - Text items: "label:" in `text-dim`, value in `text` (mono for numbers)
//! - Toggle buttons: 18 px tall, padding 0 6, 10 px font, uppercase
//!   letter-spacing 0.4, fill `accent` (or green for ORTHO) when ON
//! - OSNAP cluster: a "OSNAP" label in `text-muted` 10 px followed by 6
//!   toggle pills (End/Mid/Cen/Int/Per/Near) with `border-light` borders
//! - Right cluster (after `Spacer`): IFC button, Selected/Objects text,
//!   FPS (green 60 + dim label)

use crate::theme::Theme;
use crate::tokens::metrics;
use egui::{Color32, Pos2, Rect, Sense, Stroke, Ui, Vec2};

#[derive(Debug, Clone)]
pub enum StatusSection {
    /// Text item rendered "label: value" — the caller usually formats
    /// `"label: <value>"` themselves, but this variant keeps the egui
    /// label() path. The widget paints it as `fg_dim` 11 px with a 24 px
    /// right margin.
    Text(String),
    /// Toggle pill. `on=true` paints with `accent` fill, white text.
    /// `accent="green"` is a special-case used by ORTHO (mockup line
    /// 970 uses a green tint).
    Toggle { label: String, on: bool, id: String },
    /// Push everything that follows to the right edge (mockup `flex-1`).
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
        // Bar background = surface (mockup line 929).
        ui.painter().rect_filled(rect, 0.0, palette.status_bg);
        // 1 px border-light top seam (mockup line 930).
        ui.painter().line_segment(
            [Pos2::new(rect.left(), rect.top() + 0.5),
             Pos2::new(rect.right(), rect.top() + 0.5)],
            Stroke::new(1.0, palette.border_light),
        );

        // ----- Two-pass layout -------------------------------------------------
        // Mockup uses `flex-1` between left/middle/right clusters: render
        // everything before the `Spacer` left-aligned starting at +12 px,
        // and everything after the `Spacer` right-aligned ending at -12 px.
        let (left_items, right_items) = split_on_spacer(&self.sections);

        let font_value = egui::FontId::proportional(11.0);
        let font_label = egui::FontId::proportional(11.0);
        let font_pill  = egui::FontId::new(10.0, egui::FontFamily::Proportional);
        let _ = &font_label; // currently same as value; kept for clarity

        // Left cluster ---------------------------------------------------
        let mut x = rect.left() + 12.0;
        for (i, s) in left_items.iter().enumerate() {
            let cluster_gap = if i == 0 { 0.0 } else { 16.0 };
            x += cluster_gap;
            x = paint_section(ui, s, &palette, x, rect.center().y, &font_value, &font_pill, &mut actions);
        }

        // Right cluster --------------------------------------------------
        if !right_items.is_empty() {
            // First pass — measure total right cluster width.
            let mut measured_w = 0.0_f32;
            for (i, s) in right_items.iter().enumerate() {
                let gap = if i == 0 { 0.0 } else { 16.0 };
                measured_w += gap + measure_section_width(ui, s, &font_value, &font_pill);
            }
            let mut rx = rect.right() - 12.0 - measured_w;
            for (i, s) in right_items.iter().enumerate() {
                let gap = if i == 0 { 0.0 } else { 16.0 };
                rx += gap;
                rx = paint_section(ui, s, &palette, rx, rect.center().y, &font_value, &font_pill, &mut actions);
            }
        }

        actions
    }
}

fn split_on_spacer<'a>(sections: &'a [StatusSection]) -> (&'a [StatusSection], &'a [StatusSection]) {
    for (i, s) in sections.iter().enumerate() {
        if matches!(s, StatusSection::Spacer) {
            return (&sections[..i], &sections[i + 1..]);
        }
    }
    (sections, &[])
}

fn measure_section_width(
    ui: &Ui,
    s: &StatusSection,
    font_value: &egui::FontId,
    font_pill: &egui::FontId,
) -> f32 {
    match s {
        StatusSection::Text(t) => ui.painter().layout_no_wrap(
            t.clone(), font_value.clone(), Color32::WHITE).rect.width(),
        StatusSection::Toggle { label, .. } => {
            ui.painter().layout_no_wrap(
                label.clone(), font_pill.clone(), Color32::WHITE).rect.width() + 14.0
        }
        StatusSection::Spacer => 0.0,
    }
}

fn paint_section(
    ui: &mut Ui,
    s: &StatusSection,
    palette: &crate::theme::Palette,
    x: f32,
    cy: f32,
    font_value: &egui::FontId,
    font_pill: &egui::FontId,
    actions: &mut Vec<StatusBarAction>,
) -> f32 {
    match s {
        StatusSection::Text(t) => {
            // Split "Label: value" → dim label, fg value.
            if let Some(colon_idx) = t.find(": ") {
                let (label, rest) = t.split_at(colon_idx);
                let value = &rest[2..];
                // Paint dim label first.
                let lw = ui.painter().layout_no_wrap(
                    format!("{}:", label), font_value.clone(), palette.fg_dim).rect.width();
                ui.painter().text(
                    Pos2::new(x, cy),
                    egui::Align2::LEFT_CENTER,
                    format!("{}:", label),
                    font_value.clone(),
                    palette.fg_dim,
                );
                let vx = x + lw + 4.0;
                let vw = ui.painter().layout_no_wrap(
                    value.to_string(), font_value.clone(), palette.fg).rect.width();
                ui.painter().text(
                    Pos2::new(vx, cy),
                    egui::Align2::LEFT_CENTER,
                    value,
                    font_value.clone(),
                    palette.fg,
                );
                return vx + vw;
            }
            // Plain string — render directly in fg.
            let w = ui.painter().layout_no_wrap(
                t.clone(), font_value.clone(), palette.fg).rect.width();
            ui.painter().text(
                Pos2::new(x, cy),
                egui::Align2::LEFT_CENTER,
                t,
                font_value.clone(),
                palette.fg,
            );
            x + w
        }
        StatusSection::Toggle { label, on, id } => {
            let text_w = ui.painter().layout_no_wrap(
                label.clone(), font_pill.clone(), Color32::WHITE).rect.width();
            let w = (text_w + 14.0).max(28.0);
            let h = 18.0_f32;
            let rect = Rect::from_center_size(Pos2::new(x + w * 0.5, cy), Vec2::new(w, h));
            let resp = ui.interact(rect, ui.id().with(("status_pill", id.as_str())), Sense::click());
            let (bg, fg_col, border_col) = if *on {
                (palette.accent, Color32::WHITE, palette.accent)
            } else if resp.hovered() {
                (palette.hover, palette.fg, palette.border_light)
            } else {
                (Color32::TRANSPARENT, palette.fg_dim, palette.border_light)
            };
            if bg != Color32::TRANSPARENT {
                ui.painter().rect_filled(rect, 2.0, bg);
            }
            ui.painter().rect_stroke(rect, 2.0, Stroke::new(1.0, border_col));
            ui.painter().text(
                rect.center(),
                egui::Align2::CENTER_CENTER,
                label.to_uppercase(),
                font_pill.clone(),
                fg_col,
            );
            if resp.clicked() {
                actions.push(StatusBarAction::Toggled(id.clone()));
            }
            x + w + 2.0
        }
        StatusSection::Spacer => x,
    }
}
