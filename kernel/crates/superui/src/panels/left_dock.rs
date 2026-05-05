//! `LeftDock` — left side rail with two collapsible sections stacked
//! vertically:
//!
//! - **Drawings**: header bar (caret + label + side icon), body lists
//!   the project's drawings. Active drawing has a 1 px orange left
//!   border and a soft amber tint. Below the list: a `+` add-button.
//!
//! - **Sheets**: header bar identical to Drawings, body lists sheets
//!   (`Sheet 1 — No number | A3 (420x297mm)` style). Bottom row of
//!   small icons: open-as-tab / + add / # renumber.
//!
//! Mirrors 1.0's React `LeftPanel.tsx`. Painted directly via egui
//! painter so we control the dark-grey body, themed header strip,
//! and active-item border without fighting egui's frame/stroke
//! defaults.
//!
//! Wiring expectation:
//! ```ignore
//! let mut drawings_open = true;
//! let mut sheets_open = true;
//! egui::SidePanel::left("left_dock")
//!     .exact_width(superui::tokens::metrics::LEFT_DOCK_WIDTH)
//!     .frame(egui::Frame::none().fill(palette.bg))
//!     .show(ctx, |ui| {
//!         let actions = LeftDock::new(&drawings, &sheets,
//!             &mut drawings_open, &mut sheets_open)
//!             .active_drawing(active_d)
//!             .active_sheet(active_s)
//!             .show(ui);
//!         for a in actions { dispatch(a); }
//!     });
//! ```

use crate::icon::phosphor;
use crate::theme::Theme;
use crate::tokens::metrics;
use egui::{Color32, Pos2, Rect, Sense, Stroke, Ui, Vec2};

/// Minimal drawing entry — extend with thumbnail / status fields later
/// without breaking the existing call-sites (struct is `pub`).
#[derive(Debug, Clone)]
pub struct DrawingItem<'a> {
    pub name: &'a str,
}

/// Minimal sheet entry. `subtitle` is the small-grey second line, e.g.
/// "No number | A3 (420x297mm)".
#[derive(Debug, Clone)]
pub struct SheetItem<'a> {
    pub name: &'a str,
    pub subtitle: &'a str,
}

#[derive(Debug, Clone)]
pub enum LeftDockAction {
    SelectDrawing(usize),
    SelectSheet(usize),
    AddDrawing,
    AddSheet,
    OpenSheetAsTab(usize),
    RenumberSheets,
    ToggleDrawings,
    ToggleSheets,
}

pub struct LeftDock<'a> {
    drawings: &'a [DrawingItem<'a>],
    sheets: &'a [SheetItem<'a>],
    drawings_open: &'a mut bool,
    sheets_open: &'a mut bool,
    active_drawing: Option<usize>,
    active_sheet: Option<usize>,
}

impl<'a> LeftDock<'a> {
    pub fn new(
        drawings: &'a [DrawingItem<'a>],
        sheets: &'a [SheetItem<'a>],
        drawings_open: &'a mut bool,
        sheets_open: &'a mut bool,
    ) -> Self {
        Self {
            drawings,
            sheets,
            drawings_open,
            sheets_open,
            active_drawing: None,
            active_sheet: None,
        }
    }

    pub fn active_drawing(mut self, i: Option<usize>) -> Self {
        self.active_drawing = i;
        self
    }
    pub fn active_sheet(mut self, i: Option<usize>) -> Self {
        self.active_sheet = i;
        self
    }

    pub fn show(self, ui: &mut Ui) -> Vec<LeftDockAction> {
        let mut actions = Vec::new();
        let palette = Theme::Default.palette();

        // Paint the entire dock background dark-brown body (panels look
        // continuous with the central canvas backdrop).
        let avail = ui.available_size();
        let dock_rect = Rect::from_min_size(ui.cursor().min, avail);
        ui.painter().rect_filled(dock_rect, 0.0, palette.bg);

        // ---- Drawings section ----------------------------------------
        let drawings_open = *self.drawings_open;
        if section_header(ui, "Drawings", drawings_open, "drawings_hdr", &palette) {
            *self.drawings_open = !drawings_open;
            actions.push(LeftDockAction::ToggleDrawings);
        }
        if *self.drawings_open {
            for (i, d) in self.drawings.iter().enumerate() {
                if list_item(ui, d.name, None, self.active_drawing == Some(i),
                    ("drawing_item", i), &palette)
                {
                    actions.push(LeftDockAction::SelectDrawing(i));
                }
            }
            if footer_add_row(ui, ("drawings_add",), &palette) {
                actions.push(LeftDockAction::AddDrawing);
            }
        }

        ui.add_space(6.0);

        // ---- Sheets section ------------------------------------------
        let sheets_open = *self.sheets_open;
        if section_header(ui, "Sheets", sheets_open, "sheets_hdr", &palette) {
            *self.sheets_open = !sheets_open;
            actions.push(LeftDockAction::ToggleSheets);
        }
        if *self.sheets_open {
            for (i, s) in self.sheets.iter().enumerate() {
                if list_item(ui, s.name, Some(s.subtitle), self.active_sheet == Some(i),
                    ("sheet_item", i), &palette)
                {
                    actions.push(LeftDockAction::SelectSheet(i));
                }
            }
            // Small icon row: open-as-tab / + / #
            let row_h = 22.0;
            let avail_w = ui.available_width();
            let (rrect, _) = ui.allocate_exact_size(Vec2::new(avail_w, row_h), Sense::hover());
            let mut x = rrect.left() + 8.0;
            for (key, glyph) in [
                (0_u32, egui_phosphor::regular::ARROW_SQUARE_OUT),
                (1,     egui_phosphor::regular::PLUS),
                (2,     egui_phosphor::regular::HASH),
            ] {
                let r = Rect::from_min_size(Pos2::new(x, rrect.top() + 1.0), Vec2::new(20.0, row_h - 2.0));
                let resp = ui.interact(r, ui.id().with(("sheets_iconrow", key)), Sense::click());
                if resp.hovered() {
                    ui.painter().rect_filled(r, 2.0, palette.button_hover);
                }
                ui.painter().text(
                    r.center(),
                    egui::Align2::CENTER_CENTER,
                    glyph,
                    egui::FontId::new(13.0, egui::FontFamily::Proportional),
                    palette.fg,
                );
                if resp.clicked() {
                    match key {
                        0 => if let Some(i) = self.active_sheet {
                                 actions.push(LeftDockAction::OpenSheetAsTab(i));
                             },
                        1 => actions.push(LeftDockAction::AddSheet),
                        2 => actions.push(LeftDockAction::RenumberSheets),
                        _ => {}
                    }
                }
                x += 22.0;
            }
        }

        actions
    }
}

/// Paint a collapsible section header. Returns true when the user
/// clicked the header (caret or label area). Background uses
/// `palette.titlebar_bg` so the header reads as a separate strip from
/// the body.
fn section_header(
    ui: &mut Ui,
    label: &str,
    open: bool,
    id_suffix: &'static str,
    palette: &crate::theme::Palette,
) -> bool {
    let h = metrics::DOCK_HEADER_HEIGHT;
    let avail_w = ui.available_width();
    let (rect, resp) = ui.allocate_exact_size(Vec2::new(avail_w, h), Sense::click());
    let bg = if resp.hovered() { palette.button_hover } else { palette.titlebar_bg };
    ui.painter().rect_filled(rect, 0.0, bg);
    // 1 px bottom border.
    ui.painter().line_segment(
        [Pos2::new(rect.left(), rect.bottom() - 0.5),
         Pos2::new(rect.right(), rect.bottom() - 0.5)],
        Stroke::new(1.0, palette.border),
    );
    // Caret on the left.
    let caret = if open {
        egui_phosphor::regular::CARET_DOWN
    } else {
        egui_phosphor::regular::CARET_RIGHT
    };
    ui.painter().text(
        Pos2::new(rect.left() + 10.0, rect.center().y),
        egui::Align2::LEFT_CENTER,
        caret,
        egui::FontId::new(12.0, egui::FontFamily::Proportional),
        palette.fg,
    );
    ui.painter().text(
        Pos2::new(rect.left() + 26.0, rect.center().y),
        egui::Align2::LEFT_CENTER,
        label,
        egui::FontId::new(12.0, egui::FontFamily::Proportional),
        palette.fg,
    );
    // Side icon (right edge) — purely decorative for now (Phosphor list).
    ui.painter().text(
        Pos2::new(rect.right() - 12.0, rect.center().y),
        egui::Align2::CENTER_CENTER,
        phosphor("layers"),
        egui::FontId::new(12.0, egui::FontFamily::Proportional),
        palette.fg_dim,
    );
    let _ = id_suffix; // egui re-uses our allocation id, no extra interact needed
    resp.clicked()
}

/// Render a single list row. Returns true when clicked. Active rows
/// get a 1 px orange left border and a soft amber tint background.
fn list_item<S: std::hash::Hash>(
    ui: &mut Ui,
    title: &str,
    subtitle: Option<&str>,
    active: bool,
    id_suffix: S,
    palette: &crate::theme::Palette,
) -> bool {
    let avail_w = ui.available_width();
    let h = if subtitle.is_some() { metrics::DOCK_ITEM_HEIGHT + 12.0 } else { metrics::DOCK_ITEM_HEIGHT };
    let (rect, resp) = ui.allocate_exact_size(Vec2::new(avail_w, h), Sense::click());

    let bg = if active {
        // Soft amber tint over the body — accent at ~12 % alpha looks
        // right against the warm dark brown body in 1.0.
        Color32::from_rgba_unmultiplied(
            palette.accent.r(), palette.accent.g(), palette.accent.b(), 36,
        )
    } else if resp.hovered() {
        palette.button_hover
    } else {
        Color32::TRANSPARENT
    };
    if bg != Color32::TRANSPARENT {
        ui.painter().rect_filled(rect, 0.0, bg);
    }
    if active {
        ui.painter().line_segment(
            [Pos2::new(rect.left() + 0.5, rect.top()),
             Pos2::new(rect.left() + 0.5, rect.bottom())],
            Stroke::new(2.0, palette.accent),
        );
    }
    ui.painter().text(
        Pos2::new(rect.left() + 12.0, rect.top() + 8.0),
        egui::Align2::LEFT_TOP,
        title,
        egui::FontId::new(12.0, egui::FontFamily::Proportional),
        palette.fg,
    );
    if let Some(sub) = subtitle {
        ui.painter().text(
            Pos2::new(rect.left() + 12.0, rect.bottom() - 6.0),
            egui::Align2::LEFT_BOTTOM,
            sub,
            egui::FontId::new(10.0, egui::FontFamily::Proportional),
            palette.fg_dim,
        );
    }
    let _ = id_suffix;
    resp.clicked()
}

/// Paint a footer row containing a single `+` button. Returns true if
/// the `+` was clicked.
fn footer_add_row<S: std::hash::Hash>(
    ui: &mut Ui,
    id_suffix: S,
    palette: &crate::theme::Palette,
) -> bool {
    let row_h = 22.0;
    let avail_w = ui.available_width();
    let (rect, _) = ui.allocate_exact_size(Vec2::new(avail_w, row_h), Sense::hover());
    let btn = Rect::from_min_size(
        Pos2::new(rect.left() + 8.0, rect.top() + 1.0),
        Vec2::new(20.0, row_h - 2.0),
    );
    let resp = ui.interact(btn, ui.id().with(("dock_add", )), Sense::click());
    if resp.hovered() {
        ui.painter().rect_filled(btn, 2.0, palette.button_hover);
    }
    ui.painter().text(
        btn.center(),
        egui::Align2::CENTER_CENTER,
        egui_phosphor::regular::PLUS,
        egui::FontId::new(13.0, egui::FontFamily::Proportional),
        palette.fg,
    );
    let _ = id_suffix;
    resp.clicked()
}
