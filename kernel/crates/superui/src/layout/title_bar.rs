//! `TitleBar` widget — top bar matching the JSX mockup's titlebar
//! (`Open2DViewerMockup.jsx` lines 538-592):
//!   [2D logo] [QAT: undo redo | new open save saveAs | print gear ▾] [centred title] [Send Feedback] [min max close]
//!
//! Mockup spec: bar height 32 px, background `surface` (#4A4242),
//! 1 px `border-light` bottom border, QAT button row uses small 22×22
//! icon buttons with thin 1 px `border-light` separators between groups.
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
        // Double-click anywhere on the bar (outside the QAT/window-controls
        // sub-rects whose own interact calls win the hit-test) toggles the
        // maximize state — standard Windows / macOS / Linux titlebar UX.
        if bar_resp.double_clicked_by(egui::PointerButton::Primary) {
            actions.push(TitleBarAction::ToggleMaximize);
        }
        ui.painter().rect_filled(rect, 0.0, palette.titlebar_bg);
        // 1px bottom border (mockup `border-bottom: 1px solid borderLight`).
        ui.painter().line_segment(
            [Pos2::new(rect.left(), rect.bottom() - 0.5),
             Pos2::new(rect.right(), rect.bottom() - 0.5)],
            Stroke::new(1.0, palette.border_light),
        );

        // 1) App icon — small orange "2D" tile. Click opens app menu.
        // Mockup: w-5 h-5 (20×20) rounded with orange fill and white
        // bold "2D" text at 10 px.
        let icon_size = 20.0_f32;
        let icon_rect = egui::Rect::from_min_size(
            Pos2::new(rect.left() + 8.0, rect.center().y - icon_size * 0.5),
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
            Color32::WHITE,
        );
        if icon_resp.clicked() { actions.push(TitleBarAction::OpenAppMenu); }

        // 2) QAT row — small icon-only buttons matching mockup layout.
        // Order: undo redo | new open save saveAs | print gear caret
        // (mockup lines 548-558).
        let qat_btn_w = 24.0_f32;
        let qat_btn_h = height - 6.0;
        let mut qx = icon_rect.right() + 8.0;
        let mut qbtn = |ui: &mut Ui, qx: &mut f32, glyph: &str, key: u32, disabled: bool| {
            let r = egui::Rect::from_min_size(
                Pos2::new(*qx, rect.center().y - qat_btn_h * 0.5),
                Vec2::new(qat_btn_w, qat_btn_h),
            );
            let resp = ui.interact(r, ui.id().with(("qat", key)), Sense::click());
            if !disabled && resp.hovered() {
                ui.painter().rect_filled(r, 2.0, palette.hover);
            }
            let glyph_color = if disabled {
                Color32::from_rgba_unmultiplied(palette.fg_dim.r(), palette.fg_dim.g(), palette.fg_dim.b(), 100)
            } else {
                palette.fg_dim
            };
            paint_qat_glyph(ui.painter(), r.center(), glyph, glyph_color);
            *qx += qat_btn_w;
            resp
        };
        let mut qsep = |ui: &mut Ui, qx: &mut f32| {
            // Mockup divider: w-px h-4 mx-0.5 background borderLight.
            ui.painter().line_segment(
                [Pos2::new(*qx + 4.0, rect.top() + 8.0),
                 Pos2::new(*qx + 4.0, rect.bottom() - 8.0)],
                Stroke::new(1.0, palette.border_light),
            );
            *qx += 8.0;
        };
        // Mockup QAT order — see Open2DViewerMockup.jsx lines 548-558.
        // Group 1 (history, disabled in viewer): undo, redo
        if qbtn(ui, &mut qx, phosphor("undo"),     1, true).clicked() { actions.push(TitleBarAction::OpenAppMenu); }
        if qbtn(ui, &mut qx, phosphor("redo"),     2, true).clicked() { actions.push(TitleBarAction::OpenAppMenu); }
        qsep(ui, &mut qx);
        // Group 2 (file): new open save saveAs (save/saveAs disabled in viewer)
        if qbtn(ui, &mut qx, phosphor("new"),      3, false).clicked() { actions.push(TitleBarAction::OpenAppMenu); }
        if qbtn(ui, &mut qx, phosphor("open"),     4, false).clicked() { actions.push(TitleBarAction::OpenAppMenu); }
        if qbtn(ui, &mut qx, phosphor("save"),     5, true).clicked() { actions.push(TitleBarAction::OpenAppMenu); }
        if qbtn(ui, &mut qx, egui_phosphor::regular::FLOPPY_DISK_BACK, 9, true).clicked() { actions.push(TitleBarAction::OpenAppMenu); }
        qsep(ui, &mut qx);
        // Group 3 (chrome): print gear caret
        if qbtn(ui, &mut qx, egui_phosphor::regular::PRINTER, 6, false).clicked() { actions.push(TitleBarAction::OpenAppMenu); }
        if qbtn(ui, &mut qx, phosphor("settings"), 7, false).clicked() { actions.push(TitleBarAction::OpenAppMenu); }
        if qbtn(ui, &mut qx, egui_phosphor::regular::CARET_DOWN, 8, false).clicked() { actions.push(TitleBarAction::OpenAppMenu); }

        // 3) Centred title — paint text at rect.center(). Mockup spec:
        // fontSize 13, fontWeight 500, color textDim.
        ui.painter().text(
            Pos2::new(rect.center().x, rect.center().y),
            egui::Align2::CENTER_CENTER,
            self.title,
            egui::FontId::proportional(13.0),
            palette.fg_dim,
        );

        // 4) Right side — window controls (min/max/close) flush right,
        //    "Send Feedback" link to their left.
        let mut rx = rect.right();
        // Close — mockup spec w-[46px] hover background closeRed.
        let close_w = 46.0;
        rx -= close_w;
        let crect = egui::Rect::from_min_size(Pos2::new(rx, rect.top()), Vec2::new(close_w, height));
        let cresp = ui.interact(crect, ui.id().with("tb_close"), Sense::click());
        let cfill = if cresp.hovered() { palette.close_red } else { palette.titlebar_bg };
        ui.painter().rect_filled(crect, 0.0, cfill);
        let cc = crect.center();
        let cic = if cresp.hovered() { Color32::WHITE } else { palette.fg_dim };
        ui.painter().line_segment([Pos2::new(cc.x - 5.0, cc.y - 5.0), Pos2::new(cc.x + 5.0, cc.y + 5.0)], Stroke::new(1.2, cic));
        ui.painter().line_segment([Pos2::new(cc.x + 5.0, cc.y - 5.0), Pos2::new(cc.x - 5.0, cc.y + 5.0)], Stroke::new(1.2, cic));
        if cresp.clicked() { actions.push(TitleBarAction::Close); }
        // Maximize — mockup spec w-[46px].
        let max_w = 46.0;
        rx -= max_w;
        let mrect = egui::Rect::from_min_size(Pos2::new(rx, rect.top()), Vec2::new(max_w, height));
        let mresp = ui.interact(mrect, ui.id().with("tb_max"), Sense::click());
        if mresp.hovered() { ui.painter().rect_filled(mrect, 0.0, palette.button_hover); }
        let mc = mrect.center();
        let mic = if mresp.hovered() { palette.fg } else { palette.fg_dim };
        if self.is_maximized {
            ui.painter().rect_stroke(egui::Rect::from_center_size(Pos2::new(mc.x + 1.5, mc.y - 1.5), Vec2::new(8.0, 8.0)), 0.0, Stroke::new(1.0, mic));
            ui.painter().rect_stroke(egui::Rect::from_center_size(Pos2::new(mc.x - 1.5, mc.y + 1.5), Vec2::new(8.0, 8.0)), 0.0, Stroke::new(1.0, mic));
        } else {
            ui.painter().rect_stroke(egui::Rect::from_center_size(mc, Vec2::new(10.0, 10.0)), 0.0, Stroke::new(1.0, mic));
        }
        if mresp.clicked() { actions.push(TitleBarAction::ToggleMaximize); }
        // Minimize — mockup spec w-[46px].
        let min_w = 46.0;
        rx -= min_w;
        let mnrect = egui::Rect::from_min_size(Pos2::new(rx, rect.top()), Vec2::new(min_w, height));
        let mnresp = ui.interact(mnrect, ui.id().with("tb_min"), Sense::click());
        if mnresp.hovered() { ui.painter().rect_filled(mnrect, 0.0, palette.button_hover); }
        let mnc = mnrect.center();
        let mnic = if mnresp.hovered() { palette.fg } else { palette.fg_dim };
        ui.painter().line_segment([Pos2::new(mnc.x - 5.0, mnc.y), Pos2::new(mnc.x + 5.0, mnc.y)], Stroke::new(1.0, mnic));
        if mnresp.clicked() { actions.push(TitleBarAction::Minimize); }
        // Send Feedback link — small label flush right of the controls.
        // Mockup spec: text-xs (12 px), color textDim, margin-right 16 px.
        let fb_text = "Send Feedback";
        let fb_w = 88.0;
        rx -= fb_w + 16.0;
        let fbrect = egui::Rect::from_min_size(Pos2::new(rx, rect.top()), Vec2::new(fb_w, height));
        let fbresp = ui.interact(fbrect, ui.id().with("tb_feedback"), Sense::click());
        let fbcol = if fbresp.hovered() { palette.fg } else { palette.fg_dim };
        ui.painter().text(
            fbrect.center(),
            egui::Align2::CENTER_CENTER,
            fb_text,
            egui::FontId::proportional(12.0),
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
        egui::FontId::new(14.0, egui::FontFamily::Proportional),
        color,
    );
}
