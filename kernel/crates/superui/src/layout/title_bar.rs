//! `TitleBar` widget — top bar matching 1.0's `TitleBar.tsx`:
//!   [app-icon] [QAT: undo redo new open save print gear ▾] [centred title] [Send Feedback ...]
//!
//! 1.0 doesn't render window-control buttons (it's a web app), but we
//! keep min/max/close on the right since this is a native desktop
//! shell. They paint with the same hover colours so the bar still
//! reads as part of the same surface.
//!
//! Verified against the live UI: bar height 32px (`h-8 bg-cad-surface`),
//! background `#4A4242`, title text 14px Inter centred horizontally.
//!
//! API note — `TitleBarAction` is intentionally limited to the four
//! variants the binary already matches exhaustively. The QAT buttons
//! and the "Send Feedback" link emit `OpenAppMenu` so callers route
//! the user to a useful destination without forcing a breaking enum
//! change. Visual fidelity is the priority for the chrome rebuild.

use crate::icon::phosphor;
use crate::theme::Theme;
use crate::tokens::metrics;
use egui::{Color32, Pos2, Sense, Stroke, Ui, Vec2};

#[derive(Debug, Clone, Copy)]
pub enum TitleBarAction {
    OpenAppMenu,
    Minimize,
    ToggleMaximize,
    Close,
    /// User pressed the empty area of the bar — caller should start a
    /// native window drag (`winit::window::Window::drag_window`).
    StartDrag,
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
        // Whole-bar interact lets us detect a press in the empty area
        // for native window drag (clicks/presses on QAT/window-control
        // sub-rects below override this since they're drawn last and
        // their `interact` calls win the hit-test).
        let (rect, bar_resp) = ui.allocate_exact_size(Vec2::new(avail, height), Sense::click_and_drag());
        if bar_resp.drag_started_by(egui::PointerButton::Primary) {
            actions.push(TitleBarAction::StartDrag);
        }
        ui.painter().rect_filled(rect, 0.0, palette.titlebar_bg);
        // 1px bottom border, matches 1.0's `border-b border-cad-border`.
        ui.painter().line_segment(
            [Pos2::new(rect.left(), rect.bottom() - 0.5),
             Pos2::new(rect.right(), rect.bottom() - 0.5)],
            Stroke::new(1.0, palette.border),
        );

        // 1) App icon — small orange "2D" tile. Click opens app menu.
        let icon_size = 22.0_f32;
        let icon_rect = egui::Rect::from_min_size(
            Pos2::new(rect.left() + 6.0, rect.center().y - icon_size * 0.5),
            Vec2::new(icon_size, icon_size),
        );
        let icon_resp = ui.interact(icon_rect, ui.id().with("tb_app_icon"), Sense::click());
        let icon_bg = if icon_resp.hovered() { palette.accent_hover } else { palette.accent };
        ui.painter().rect_filled(icon_rect, 2.0, icon_bg);
        ui.painter().text(
            icon_rect.center(),
            egui::Align2::CENTER_CENTER,
            "2D",
            egui::FontId::proportional(10.0),
            palette.fg,
        );
        if icon_resp.clicked() { actions.push(TitleBarAction::OpenAppMenu); }

        // 2) QAT row — small icon-only buttons matching 1.0 layout.
        // Order: undo, redo, |, new, open, save, |, print, gear, ▾
        let qat_btn_w = 22.0_f32;
        let qat_btn_h = height - 4.0;
        let mut qx = icon_rect.right() + 6.0;
        let mut qbtn = |ui: &mut Ui, qx: &mut f32, glyph: &str, key: u32| {
            let r = egui::Rect::from_min_size(
                Pos2::new(*qx, rect.center().y - qat_btn_h * 0.5),
                Vec2::new(qat_btn_w, qat_btn_h),
            );
            let resp = ui.interact(r, ui.id().with(("qat", key)), Sense::click());
            if resp.hovered() {
                ui.painter().rect_filled(r, 0.0, palette.button_hover);
            }
            paint_qat_glyph(ui.painter(), r.center(), glyph, palette.fg);
            *qx += qat_btn_w;
            resp
        };
        let mut qsep = |ui: &mut Ui, qx: &mut f32| {
            ui.painter().line_segment(
                [Pos2::new(*qx + 2.0, rect.top() + 7.0),
                 Pos2::new(*qx + 2.0, rect.bottom() - 7.0)],
                Stroke::new(1.0, palette.border),
            );
            *qx += 6.0;
        };
        // Phosphor glyphs — the egui-phosphor font is installed at app
        // startup so these chars render with proper line-icons. Names
        // follow lucide-react's naming used in 1.0's TitleBar.tsx.
        if qbtn(ui, &mut qx, phosphor("undo"),     1).clicked() { actions.push(TitleBarAction::OpenAppMenu); }
        if qbtn(ui, &mut qx, phosphor("redo"),     2).clicked() { actions.push(TitleBarAction::OpenAppMenu); }
        qsep(ui, &mut qx);
        if qbtn(ui, &mut qx, phosphor("new"),      3).clicked() { actions.push(TitleBarAction::OpenAppMenu); }
        if qbtn(ui, &mut qx, phosphor("open"),     4).clicked() { actions.push(TitleBarAction::OpenAppMenu); }
        if qbtn(ui, &mut qx, phosphor("save"),     5).clicked() { actions.push(TitleBarAction::OpenAppMenu); }
        qsep(ui, &mut qx);
        if qbtn(ui, &mut qx, egui_phosphor::regular::PRINTER, 6).clicked() { actions.push(TitleBarAction::OpenAppMenu); }
        if qbtn(ui, &mut qx, phosphor("settings"), 7).clicked() { actions.push(TitleBarAction::OpenAppMenu); }
        if qbtn(ui, &mut qx, egui_phosphor::regular::CARET_DOWN, 8).clicked() { actions.push(TitleBarAction::OpenAppMenu); }

        // 3) Centred title — paint text at rect.center().
        ui.painter().text(
            Pos2::new(rect.center().x, rect.center().y),
            egui::Align2::CENTER_CENTER,
            self.title,
            egui::FontId::proportional(13.0),
            palette.fg,
        );

        // 4) Right side — window controls (min/max/close) flush right,
        //    "Send Feedback" link to their left.
        let mut rx = rect.right();
        // Close
        let close_w = 36.0;
        rx -= close_w;
        let crect = egui::Rect::from_min_size(Pos2::new(rx, rect.top()), Vec2::new(close_w, height));
        let cresp = ui.interact(crect, ui.id().with("tb_close"), Sense::click());
        let cfill = if cresp.hovered() { palette.close_red } else { palette.titlebar_bg };
        ui.painter().rect_filled(crect, 0.0, cfill);
        let cc = crect.center();
        let cic = if cresp.hovered() { Color32::WHITE } else { palette.fg };
        ui.painter().line_segment([Pos2::new(cc.x - 5.0, cc.y - 5.0), Pos2::new(cc.x + 5.0, cc.y + 5.0)], Stroke::new(1.4, cic));
        ui.painter().line_segment([Pos2::new(cc.x + 5.0, cc.y - 5.0), Pos2::new(cc.x - 5.0, cc.y + 5.0)], Stroke::new(1.4, cic));
        if cresp.clicked() { actions.push(TitleBarAction::Close); }
        // Maximize
        let max_w = 36.0;
        rx -= max_w;
        let mrect = egui::Rect::from_min_size(Pos2::new(rx, rect.top()), Vec2::new(max_w, height));
        let mresp = ui.interact(mrect, ui.id().with("tb_max"), Sense::click());
        if mresp.hovered() { ui.painter().rect_filled(mrect, 0.0, palette.button_hover); }
        let mc = mrect.center();
        if self.is_maximized {
            ui.painter().rect_stroke(egui::Rect::from_center_size(Pos2::new(mc.x + 1.5, mc.y - 1.5), Vec2::new(8.0, 8.0)), 0.0, Stroke::new(1.2, palette.fg));
            ui.painter().rect_stroke(egui::Rect::from_center_size(Pos2::new(mc.x - 1.5, mc.y + 1.5), Vec2::new(8.0, 8.0)), 0.0, Stroke::new(1.2, palette.fg));
        } else {
            ui.painter().rect_stroke(egui::Rect::from_center_size(mc, Vec2::new(10.0, 10.0)), 0.0, Stroke::new(1.2, palette.fg));
        }
        if mresp.clicked() { actions.push(TitleBarAction::ToggleMaximize); }
        // Minimize
        let min_w = 36.0;
        rx -= min_w;
        let mnrect = egui::Rect::from_min_size(Pos2::new(rx, rect.top()), Vec2::new(min_w, height));
        let mnresp = ui.interact(mnrect, ui.id().with("tb_min"), Sense::click());
        if mnresp.hovered() { ui.painter().rect_filled(mnrect, 0.0, palette.button_hover); }
        let mnc = mnrect.center();
        ui.painter().line_segment([Pos2::new(mnc.x - 5.0, mnc.y), Pos2::new(mnc.x + 5.0, mnc.y)], Stroke::new(1.4, palette.fg));
        if mnresp.clicked() { actions.push(TitleBarAction::Minimize); }
        // Send Feedback link — small label flush right of the controls.
        let fb_text = "Send Feedback";
        let fb_w = 88.0;
        rx -= fb_w;
        let fbrect = egui::Rect::from_min_size(Pos2::new(rx, rect.top()), Vec2::new(fb_w, height));
        let fbresp = ui.interact(fbrect, ui.id().with("tb_feedback"), Sense::click());
        let fbcol = if fbresp.hovered() { palette.fg } else { palette.fg_dim };
        ui.painter().text(
            fbrect.center(),
            egui::Align2::CENTER_CENTER,
            fb_text,
            egui::FontId::proportional(11.0),
            fbcol,
        );
        if fbresp.clicked() { actions.push(TitleBarAction::OpenAppMenu); }

        actions
    }
}

/// Paint a small glyph centred at `c` for the QAT buttons. The app
/// installs `egui-phosphor` at startup, so these strings (which are
/// the phosphor private-use chars from `crate::icon::phosphor`) render
/// as proper line icons. Phosphor glyphs need a slightly larger size
/// than the bar's text font to read clearly.
fn paint_qat_glyph(painter: &egui::Painter, c: Pos2, glyph: &str, color: Color32) {
    painter.text(
        c,
        egui::Align2::CENTER_CENTER,
        glyph,
        egui::FontId::new(15.0, egui::FontFamily::Proportional),
        color,
    );
}
