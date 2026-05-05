//! `RightDock` — Properties panel on the right side. Mirrors 1.0's
//! React `PropertiesPanel.tsx`.
//!
//! Sections rendered top-to-bottom:
//! - Header bar `Properties`
//! - Name (text input) + Type (dropdown stub)
//! - Display block — `Show Axes` checkbox
//! - Boundary (Region) block — checkbox, descriptive text, two
//!   buttons (Select Boundary / Fit to Content), X / Y / W / H drag-values
//! - Standards block — single button `Drawing Standards…`
//! - Information block — read-only `Created` / `Modified` labels
//!
//! Wiring expectation:
//! ```ignore
//! egui::SidePanel::right("right_dock")
//!     .exact_width(superui::tokens::metrics::RIGHT_DOCK_WIDTH)
//!     .frame(egui::Frame::none().fill(palette.bg))
//!     .show(ctx, |ui| {
//!         let actions = RightDock::new(&mut state).show(ui);
//!         for a in actions { dispatch(a); }
//!     });
//! ```
//!
//! All form data is owned by the consumer and passed in by mutable
//! reference via the `RightDockState` struct so this widget stays pure
//! data-driven (no internal storage).

use crate::icon::phosphor;
use crate::theme::Theme;
use crate::tokens::metrics;
use egui::{Pos2, Rect, Sense, Stroke, Ui, Vec2};

#[derive(Debug, Clone)]
pub enum RightDockAction {
    ChangeName(String),
    ChangeType(String),
    ToggleShowAxes(bool),
    ToggleBoundaryEnabled(bool),
    SelectBoundary,
    FitToContent,
    EditX(f64),
    EditY(f64),
    EditW(f64),
    EditH(f64),
    OpenStandardsDialog,
    Collapse,
}

/// Mutable state passed into `RightDock::new`. The consumer owns these
/// fields so we don't keep any global state in superui.
pub struct RightDockState<'a> {
    pub name: &'a mut String,
    pub type_label: &'a mut String,
    pub show_axes: &'a mut bool,
    pub boundary_enabled: &'a mut bool,
    pub x: &'a mut f64,
    pub y: &'a mut f64,
    pub w: &'a mut f64,
    pub h: &'a mut f64,
    pub created: &'a str,
    pub modified: &'a str,
}

pub struct RightDock<'a> {
    state: RightDockState<'a>,
}

impl<'a> RightDock<'a> {
    pub fn new(state: RightDockState<'a>) -> Self { Self { state } }

    pub fn show(self, ui: &mut Ui) -> Vec<RightDockAction> {
        let mut actions = Vec::new();
        let palette = Theme::Default.palette();

        // Background paint over the whole dock body.
        let avail = ui.available_size();
        let dock_rect = Rect::from_min_size(ui.cursor().min, avail);
        ui.painter().rect_filled(dock_rect, 0.0, palette.bg);

        // ---- Header --------------------------------------------------
        if header_bar(ui, "Properties", &palette) {
            actions.push(RightDockAction::Collapse);
        }

        ui.add_space(8.0);

        // Force consistent inner padding for the form rows.
        let inner = |ui: &mut Ui, body: &mut dyn FnMut(&mut Ui)| {
            ui.horizontal(|ui| {
                ui.add_space(10.0);
                ui.vertical(|ui| {
                    ui.set_max_width(ui.available_width() - 10.0);
                    body(ui);
                });
            });
        };

        // ---- Name + Type --------------------------------------------
        inner(ui, &mut |ui| {
            ui.label(egui::RichText::new("Name").size(11.0).color(palette.fg_dim));
            let resp = ui.add(egui::TextEdit::singleline(self.state.name)
                .desired_width(f32::INFINITY));
            if resp.changed() {
                actions.push(RightDockAction::ChangeName(self.state.name.clone()));
            }
            ui.add_space(6.0);
            ui.label(egui::RichText::new("Type").size(11.0).color(palette.fg_dim));
            // egui's combo box lifts its popup correctly inside the side panel.
            let combo = egui::ComboBox::from_id_source("rd_type")
                .selected_text(self.state.type_label.as_str())
                .width(ui.available_width());
            combo.show_ui(ui, |ui| {
                for opt in ["Stand Alone", "Reference", "Detail"] {
                    if ui.selectable_label(self.state.type_label == opt, opt).clicked() {
                        *self.state.type_label = opt.to_string();
                        actions.push(RightDockAction::ChangeType(opt.to_string()));
                    }
                }
            });
        });

        ui.add_space(10.0);
        section_label(ui, "Display", &palette);
        inner(ui, &mut |ui| {
            let mut v = *self.state.show_axes;
            if ui.checkbox(&mut v, "Show Axes").changed() {
                *self.state.show_axes = v;
                actions.push(RightDockAction::ToggleShowAxes(v));
            }
        });

        ui.add_space(10.0);
        section_label(ui, "Boundary (Region)", &palette);
        inner(ui, &mut |ui| {
            let mut v = *self.state.boundary_enabled;
            if ui.checkbox(&mut v, "Enable boundary clipping").changed() {
                *self.state.boundary_enabled = v;
                actions.push(RightDockAction::ToggleBoundaryEnabled(v));
            }
            ui.label(egui::RichText::new(
                "Limits the visible region of this drawing. Pick a closed polyline or fit to content.")
                .size(10.5)
                .color(palette.fg_dim));
            ui.horizontal(|ui| {
                if ui.button("Select Boundary").clicked() {
                    actions.push(RightDockAction::SelectBoundary);
                }
                if ui.button("Fit to Content").clicked() {
                    actions.push(RightDockAction::FitToContent);
                }
            });
            ui.add_space(4.0);
            // X / Y / W / H grid.
            egui::Grid::new("rd_boundary_xywh")
                .num_columns(2)
                .spacing([6.0, 4.0])
                .show(ui, |ui| {
                    ui.label("X");
                    if ui.add(egui::DragValue::new(self.state.x).speed(1.0)).changed() {
                        actions.push(RightDockAction::EditX(*self.state.x));
                    }
                    ui.end_row();
                    ui.label("Y");
                    if ui.add(egui::DragValue::new(self.state.y).speed(1.0)).changed() {
                        actions.push(RightDockAction::EditY(*self.state.y));
                    }
                    ui.end_row();
                    ui.label("Width");
                    if ui.add(egui::DragValue::new(self.state.w).speed(1.0)).changed() {
                        actions.push(RightDockAction::EditW(*self.state.w));
                    }
                    ui.end_row();
                    ui.label("Height");
                    if ui.add(egui::DragValue::new(self.state.h).speed(1.0)).changed() {
                        actions.push(RightDockAction::EditH(*self.state.h));
                    }
                    ui.end_row();
                });
        });

        ui.add_space(10.0);
        section_label(ui, "Standards", &palette);
        inner(ui, &mut |ui| {
            if ui.button("Drawing Standards…").clicked() {
                actions.push(RightDockAction::OpenStandardsDialog);
            }
        });

        ui.add_space(10.0);
        section_label(ui, "Information", &palette);
        inner(ui, &mut |ui| {
            ui.horizontal(|ui| {
                ui.label(egui::RichText::new("Created:").size(11.0).color(palette.fg_dim));
                ui.label(egui::RichText::new(self.state.created).size(11.0).color(palette.fg));
            });
            ui.horizontal(|ui| {
                ui.label(egui::RichText::new("Modified:").size(11.0).color(palette.fg_dim));
                ui.label(egui::RichText::new(self.state.modified).size(11.0).color(palette.fg));
            });
        });

        actions
    }
}

/// `Properties` header strip at the top of the dock — same dimensions
/// as the LeftDock section headers but without a caret, plus a
/// collapse-side-icon on the right edge. Returns true when the side
/// icon is clicked.
fn header_bar(ui: &mut Ui, label: &str, palette: &crate::theme::Palette) -> bool {
    let h = metrics::DOCK_HEADER_HEIGHT;
    let avail_w = ui.available_width();
    let (rect, _) = ui.allocate_exact_size(Vec2::new(avail_w, h), Sense::hover());
    ui.painter().rect_filled(rect, 0.0, palette.titlebar_bg);
    ui.painter().line_segment(
        [Pos2::new(rect.left(), rect.bottom() - 0.5),
         Pos2::new(rect.right(), rect.bottom() - 0.5)],
        Stroke::new(1.0, palette.border),
    );
    ui.painter().text(
        Pos2::new(rect.left() + 12.0, rect.center().y),
        egui::Align2::LEFT_CENTER,
        label,
        egui::FontId::new(12.0, egui::FontFamily::Proportional),
        palette.fg,
    );
    let close_r = Rect::from_center_size(
        Pos2::new(rect.right() - 14.0, rect.center().y),
        Vec2::new(20.0, 20.0),
    );
    let resp = ui.interact(close_r, ui.id().with("rd_collapse"), Sense::click());
    if resp.hovered() {
        ui.painter().rect_filled(close_r, 2.0, palette.button_hover);
    }
    ui.painter().text(
        close_r.center(),
        egui::Align2::CENTER_CENTER,
        phosphor("settings"),
        egui::FontId::new(12.0, egui::FontFamily::Proportional),
        palette.fg_dim,
    );
    resp.clicked()
}

/// Render a small uppercase section label as a labelled block heading
/// with a thin underline for visual grouping.
fn section_label(ui: &mut Ui, label: &str, palette: &crate::theme::Palette) {
    let avail_w = ui.available_width();
    let h = 18.0_f32;
    let (rect, _) = ui.allocate_exact_size(Vec2::new(avail_w, h), Sense::hover());
    ui.painter().text(
        Pos2::new(rect.left() + 10.0, rect.center().y),
        egui::Align2::LEFT_CENTER,
        label,
        egui::FontId::new(10.5, egui::FontFamily::Proportional),
        palette.fg_dim,
    );
    ui.painter().line_segment(
        [Pos2::new(rect.left() + 10.0, rect.bottom() - 0.5),
         Pos2::new(rect.right() - 10.0, rect.bottom() - 0.5)],
        Stroke::new(1.0, palette.border),
    );
}
