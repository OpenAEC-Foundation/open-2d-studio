//! `AppMenu` — basic floating popup for the title-bar app icon.
//! Mirrors the 1.0 React `AppMenu` (File menu): New / Open / Save /
//! Save As / Close / Exit / About.
//!
//! Wiring expectation: pass a screen position (typically the bottom-left
//! of the title-bar icon) and a mutable `bool` so the consumer can
//! close the popup. Returns `Some(AppMenuAction)` on click; the
//! consumer dispatches and decides whether to also flip `open` to
//! false.

use crate::theme::Theme;
use egui::{Context, Pos2};

#[derive(Debug, Clone, Copy)]
pub enum AppMenuAction {
    New,
    Open,
    Save,
    SaveAs,
    Close,
    Exit,
    About,
}

pub struct AppMenu {
    anchor: Pos2,
}

impl AppMenu {
    pub fn new(anchor: Pos2) -> Self { Self { anchor } }

    pub fn show(self, ctx: &Context, open: &mut bool) -> Option<AppMenuAction> {
        if !*open { return None; }
        let palette = Theme::Default.palette();
        let mut chosen: Option<AppMenuAction> = None;
        let mut local_open = *open;
        egui::Window::new("app_menu")
            .title_bar(false)
            .resizable(false)
            .collapsible(false)
            .open(&mut local_open)
            .fixed_pos(self.anchor)
            .frame(egui::Frame::popup(&ctx.style())
                .fill(palette.panel_bg)
                .stroke(egui::Stroke::new(1.0, palette.border)))
            .show(ctx, |ui| {
                ui.set_min_width(180.0);
                let mut item = |ui: &mut egui::Ui, label: &str, action: AppMenuAction| {
                    if ui.add(egui::Button::new(label).frame(false)
                        .min_size(egui::vec2(ui.available_width(), 22.0)))
                        .clicked()
                    {
                        chosen = Some(action);
                    }
                };
                item(ui, "New",     AppMenuAction::New);
                item(ui, "Open…",   AppMenuAction::Open);
                ui.separator();
                item(ui, "Save",    AppMenuAction::Save);
                item(ui, "Save As…", AppMenuAction::SaveAs);
                ui.separator();
                item(ui, "Close",   AppMenuAction::Close);
                item(ui, "Exit",    AppMenuAction::Exit);
                ui.separator();
                item(ui, "About",   AppMenuAction::About);
            });
        *open = local_open;
        if chosen.is_some() {
            *open = false;
        }
        chosen
    }
}
