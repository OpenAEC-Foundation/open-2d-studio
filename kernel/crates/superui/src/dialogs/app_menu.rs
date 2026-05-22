//! `AppMenuPanel` — full-height left-side slide-out File menu, matching
//! the Open Geotechniek Studio reference (sibling product). Replaces the
//! older floating-popup `AppMenu` (kept as a backwards-compatible thin
//! shim so existing call-sites keep compiling).
//!
//! Layout (per reference screenshot):
//!   ┌──────────────────────────┐  ← 280 px exact width
//!   │ ← Bestand                │  ← orange header 32 px
//!   ├──────────────────────────┤
//!   │ ⊕ Nieuw          Ctrl+N  │  ← row 40 px, icon + label + shortcut
//!   │ 📂 Openen        Ctrl+O  │
//!   │ 💾 Opslaan       Ctrl+S  │  (Studio only)
//!   │ 💾 Opslaan als…  Ctrl+⇧+S │  (Studio only)
//!   │ 🖨 Afdrukken     Ctrl+P  │
//!   ├──────────────────────────┤  ← separator
//!   │ ⬇ Importeren            │  (Studio only)
//!   │ ⬆ Exporteren            │  (Studio only)
//!   │ 🧩 Extensies            │
//!   ├──────────────────────────┤
//!   │ ⚙ Voorkeuren    Ctrl+,  │
//!   │ ℹ Over                  │
//!   │ × Afsluiten    Alt+F4   │
//!   └──────────────────────────┘
//!
//! Wiring expectation (consumer side, `studio_app.rs`):
//! ```ignore
//! if self.app_menu_open {
//!     for action in AppMenuPanel::new()
//!         .is_viewer(self.mode == AppMode::Viewer)
//!         .show(ctx)
//!     {
//!         match action {
//!             AppMenuAction::New        => { requested_new_tab = true; }
//!             AppMenuAction::Open       => { requested_menu_open_dialog = true; }
//!             AppMenuAction::Save | AppMenuAction::SaveAs => {
//!                 requested_menu_save_as_dxf = true;
//!             }
//!             AppMenuAction::SaveAsDwg => {
//!                 // Opens the "writer in development" modal — see
//!                 // self.save_as_dwg_modal_open.
//!                 self.save_as_dwg_modal_open = true;
//!             }
//!             AppMenuAction::Close      => { self.app_menu_open = false; }
//!             AppMenuAction::Exit       => { requested_window_close = true; }
//!             AppMenuAction::About      => { requested_toggle_about = true; }
//!             AppMenuAction::Print
//!             | AppMenuAction::Import
//!             | AppMenuAction::Export
//!             | AppMenuAction::Extensions
//!             | AppMenuAction::Preferences => { /* TODO */ }
//!         }
//!     }
//! }
//! ```

use crate::theme::Theme;
use egui::{Color32, Context, Pos2, Rect, Sense, Stroke, Ui, Vec2};

/// Actions surfaced by the `AppMenuPanel`. The consumer routes each
/// variant to its existing dispatch flag (or stubs the new ones with a
/// TODO until they're implemented).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AppMenuAction {
    /// User clicked a recent-files entry. Carries the full path so the
    /// consumer can call its existing load-by-path flow.
    OpenRecent(String),
    New,
    Open,
    Save,
    SaveAs,
    /// User asked for "Save As DWG..." -- the binary AutoCAD format.
    /// The DWG writer is not yet implemented; consumers must surface a
    /// modal that explains the situation and offers a DXF fallback.
    /// See `docs/superpowers/plans/dwg-writer-plan.md`.
    SaveAsDwg,
    /// User asked for "Save As IFCDraw..." -- the in-house binary IFC2D
    /// format. Implemented end-to-end: msgpack + zstd + delta-coded
    /// quantised coords (~0.45x DWG size). See
    /// `docs/superpowers/specs/2026-05-21-ifcdraw-binary-format.md`.
    SaveAsIfcDraw,
    Print,
    Import,
    Export,
    Extensions,
    Preferences,
    About,
    Exit,
    /// User asked to close the panel (back-arrow click OR click on the
    /// dimmed area outside the panel). Consumer should flip its
    /// `app_menu_open` flag to `false`.
    Close,
}

/// Full-height left-side File menu panel. Renders via
/// `egui::SidePanel::left("app_menu_panel")` so it sits over the
/// existing left dock + canvas without disturbing their layout.
pub struct AppMenuPanel<'a> {
    is_viewer: bool,
    /// Optional list of recently-opened file paths, newest first.
    /// Rendered under "Openen…" as click-through rows.
    recent_files: &'a [String],
}

impl<'a> Default for AppMenuPanel<'a> {
    fn default() -> Self { Self { is_viewer: false, recent_files: &[] } }
}

impl<'a> AppMenuPanel<'a> {
    /// Create a new panel — defaults to Studio mode (all items visible).
    pub fn new() -> Self { Self::default() }

    /// Trim items that don't apply in Viewer mode (Save, SaveAs, Import,
    /// Export are hidden). Already gated at the handler level — this is
    /// purely for UI clarity so users don't see disabled rows.
    pub fn is_viewer(mut self, b: bool) -> Self { self.is_viewer = b; self }

    /// Wire the consumer's `recent_files` list so a "Recente bestanden"
    /// block appears under "Openen…". Pass an empty slice to omit.
    pub fn recent_files(mut self, list: &'a [String]) -> Self {
        self.recent_files = list; self
    }

    /// Paint the panel and collect actions. Returns the list of clicks
    /// that occurred this frame (usually 0 or 1 — but `Vec` keeps the
    /// API symmetrical with the other superui widgets like `LeftDock`).
    pub fn show(self, ctx: &Context) -> Vec<AppMenuAction> {
        let mut actions: Vec<AppMenuAction> = Vec::new();
        let palette = Theme::Default.palette();

        // Office-style backstage view: the menu must START right under
        // the titlebar and COVER the ribbon + tabbar + canvas. egui's
        // `SidePanel::left` inherits whichever vertical band is left
        // after the TopBottomPanel stack — i.e. it starts below the
        // ribbon, not below the titlebar. So we render via `Area` at
        // an absolute (left=0, top=TITLEBAR_HEIGHT) position with
        // foreground ordering so it paints over the ribbon and any
        // dock content.
        let screen_h = ctx.screen_rect().height();
        let panel_rect = egui::Rect::from_min_size(
            egui::pos2(0.0, crate::tokens::metrics::TITLEBAR_HEIGHT),
            egui::vec2(PANEL_WIDTH, (screen_h - crate::tokens::metrics::TITLEBAR_HEIGHT).max(100.0)),
        );

        // Scrim: dim the area behind the panel and swallow clicks so
        // clicking the canvas doesn't accidentally interact with
        // geometry while the menu is open.
        egui::Area::new(egui::Id::new("app_menu_scrim"))
            .order(egui::Order::Foreground)
            .anchor(egui::Align2::LEFT_TOP, egui::vec2(0.0, 0.0))
            .interactable(true)
            .show(ctx, |ui| {
                let screen = ctx.screen_rect();
                let (full, resp) = ui.allocate_exact_size(screen.size(), egui::Sense::click());
                ui.painter().rect_filled(
                    full,
                    0.0,
                    egui::Color32::from_rgba_unmultiplied(0, 0, 0, 96),
                );
                if resp.clicked() {
                    if let Some(pos) = resp.interact_pointer_pos() {
                        if !panel_rect.contains(pos) {
                            actions.push(AppMenuAction::Close);
                        }
                    }
                }
            });

        // The panel itself — foreground layer, fixed rect.
        egui::Area::new(egui::Id::new("app_menu_panel"))
            .order(egui::Order::Tooltip)
            .fixed_pos(panel_rect.min)
            .show(ctx, |ui| {
                let resp = ui.allocate_rect(panel_rect, egui::Sense::hover());
                let _ = resp;
                ui.painter().rect_filled(panel_rect, 0.0, palette.panel_bg);
                let mut child = ui.new_child(
                    egui::UiBuilder::new()
                        .max_rect(panel_rect)
                        .layout(egui::Layout::top_down(egui::Align::Min)),
                );
                child.set_clip_rect(panel_rect);
                paint_panel(&mut child, &palette, self.is_viewer, self.recent_files, &mut actions);
            });

        actions
    }
}

/// Total panel width — matches the reference screenshot.
const PANEL_WIDTH: f32 = 280.0;
/// Orange header bar height (matches the title-bar height).
const HEADER_HEIGHT: f32 = 32.0;
/// Each menu row height — leaves enough room for icon + label + shortcut.
const ROW_HEIGHT: f32 = 40.0;
/// Active/hover left-edge accent stripe thickness.
const ACCENT_STRIPE: f32 = 3.0;

fn paint_panel(
    ui: &mut Ui,
    palette: &crate::theme::Palette,
    is_viewer: bool,
    recent_files: &[String],
    out: &mut Vec<AppMenuAction>,
) {
    // ---- Header bar (orange) -----------------------------------------
    let avail_w = ui.available_width();
    let (hdr_rect, hdr_resp) = ui.allocate_exact_size(
        Vec2::new(avail_w, HEADER_HEIGHT),
        Sense::click(),
    );
    ui.painter().rect_filled(hdr_rect, 0.0, palette.accent);
    // Back-arrow glyph + "Bestand" label.
    let arrow_x = hdr_rect.left() + 12.0;
    ui.painter().text(
        Pos2::new(arrow_x, hdr_rect.center().y),
        egui::Align2::LEFT_CENTER,
        egui_phosphor::regular::ARROW_LEFT,
        egui::FontId::new(16.0, egui::FontFamily::Proportional),
        palette.fg,
    );
    ui.painter().text(
        Pos2::new(arrow_x + 24.0, hdr_rect.center().y),
        egui::Align2::LEFT_CENTER,
        "Bestand",
        egui::FontId::new(14.0, egui::FontFamily::Proportional),
        palette.fg,
    );
    if hdr_resp.clicked() {
        out.push(AppMenuAction::Close);
    }

    // ---- Items -------------------------------------------------------
    // Group 1: file ops (New / Open / Save / SaveAs / Print).
    item(ui, palette, "Nieuw",        egui_phosphor::regular::FILE_PLUS,
        Some("Ctrl+N"), 1, AppMenuAction::New, out);
    item(ui, palette, "Openen",       egui_phosphor::regular::FOLDER_OPEN,
        Some("Ctrl+O"), 2, AppMenuAction::Open, out);

    // ---- Recente bestanden ------------------------------------------
    // Show up to 8 most-recent paths under "Openen". Each row is a
    // clickable entry that re-opens the file via the consumer's
    // existing spawn_load_job flow (mapped through OpenRecent(path)).
    if !recent_files.is_empty() {
        let header_rect = ui.allocate_space(egui::vec2(ui.available_width(), 22.0)).1;
        ui.painter().text(
            egui::pos2(header_rect.left() + 14.0, header_rect.center().y),
            egui::Align2::LEFT_CENTER,
            "Recente bestanden",
            egui::FontId::proportional(10.0),
            palette.fg_muted,
        );
        for (i, path) in recent_files.iter().take(8).enumerate() {
            let label = std::path::Path::new(path)
                .file_name()
                .map(|n| n.to_string_lossy().into_owned())
                .unwrap_or_else(|| path.clone());
            let shown = if label.len() > 30 {
                format!("…{}", &label[label.len() - 28..])
            } else { label };
            item(ui, palette, &shown, egui_phosphor::regular::FILE,
                None, 100 + i as u32,
                AppMenuAction::OpenRecent(path.clone()), out);
        }
        separator(ui, palette);
    }

    if !is_viewer {
        item(ui, palette, "Opslaan",      egui_phosphor::regular::FLOPPY_DISK,
            Some("Ctrl+S"), 3, AppMenuAction::Save, out);
        item(ui, palette, "Opslaan als\u{2026}", egui_phosphor::regular::FLOPPY_DISK,
            Some("Ctrl+Shift+S"), 4, AppMenuAction::SaveAs, out);
        // IFCDraw — in-house binary IFC2D format. Always available in
        // Studio too so authors can stash their work in the compact
        // ~0.45x-of-DWG IFCDraw envelope.
        item(ui, palette, "Opslaan als IFCDraw \u{03B1}\u{2026}", egui_phosphor::regular::FLOPPY_DISK,
            None, 42, AppMenuAction::SaveAsIfcDraw, out);
    } else {
        // Viewer with minimal-edit surface (Move / Delete / Explode):
        // expose DXF + IFCDraw + DWG saves so users can persist their
        // tweaks. DXF is direct, IFCDraw is direct, DWG opens a
        // "writer in development" modal + offers the DXF fallback.
        item(ui, palette, "Opslaan als DXF\u{2026}", egui_phosphor::regular::FLOPPY_DISK,
            Some("Ctrl+Shift+S"), 4, AppMenuAction::SaveAs, out);
        item(ui, palette, "Opslaan als IFCDraw \u{03B1}\u{2026}", egui_phosphor::regular::FLOPPY_DISK,
            None, 42, AppMenuAction::SaveAsIfcDraw, out);
        item(ui, palette, "Opslaan als DWG\u{2026}", egui_phosphor::regular::FLOPPY_DISK,
            None, 41, AppMenuAction::SaveAsDwg, out);
    }
    item(ui, palette, "Afdrukken",    egui_phosphor::regular::PRINTER,
        Some("Ctrl+P"), 5, AppMenuAction::Print, out);

    separator(ui, palette);

    // Group 2: import / export / extensions.
    if !is_viewer {
        item(ui, palette, "Importeren",   egui_phosphor::regular::DOWNLOAD_SIMPLE,
            None, 6, AppMenuAction::Import, out);
        item(ui, palette, "Exporteren",   egui_phosphor::regular::UPLOAD_SIMPLE,
            None, 7, AppMenuAction::Export, out);
    }
    item(ui, palette, "Extensies",    egui_phosphor::regular::PUZZLE_PIECE,
        None, 8, AppMenuAction::Extensions, out);

    separator(ui, palette);

    // Group 3: preferences / about / exit.
    item(ui, palette, "Voorkeuren",   egui_phosphor::regular::GEAR,
        Some("Ctrl+,"), 9, AppMenuAction::Preferences, out);
    item(ui, palette, "Over",         egui_phosphor::regular::INFO,
        None, 10, AppMenuAction::About, out);
    item(ui, palette, "Afsluiten",    egui_phosphor::regular::SIGN_OUT,
        Some("Alt+F4"), 11, AppMenuAction::Exit, out);
}

/// Render a single menu row. Hover gets a left orange stripe + soft
/// amber tint (`palette.accent` at ~14 % alpha).
fn item(
    ui: &mut Ui,
    palette: &crate::theme::Palette,
    label: &str,
    glyph: &'static str,
    shortcut: Option<&str>,
    id_key: u32,
    action: AppMenuAction,
    out: &mut Vec<AppMenuAction>,
) {
    let avail_w = ui.available_width();
    let (rect, resp) = ui.allocate_exact_size(
        Vec2::new(avail_w, ROW_HEIGHT),
        Sense::click(),
    );
    let id = ui.id().with(("app_menu_item", id_key));
    let resp = resp.on_hover_cursor(egui::CursorIcon::PointingHand);
    let resp = ui.interact(rect, id, Sense::click()).union(resp);

    // Hover/selected backdrop — soft amber tint.
    if resp.hovered() {
        let bg = Color32::from_rgba_unmultiplied(
            palette.accent.r(), palette.accent.g(), palette.accent.b(), 36,
        );
        ui.painter().rect_filled(rect, 0.0, bg);
        // 3 px left orange accent stripe.
        let stripe = Rect::from_min_max(
            rect.min,
            Pos2::new(rect.left() + ACCENT_STRIPE, rect.bottom()),
        );
        ui.painter().rect_filled(stripe, 0.0, palette.accent);
    }

    // Icon (left, ~16 px).
    let icon_x = rect.left() + 18.0;
    ui.painter().text(
        Pos2::new(icon_x, rect.center().y),
        egui::Align2::CENTER_CENTER,
        glyph,
        egui::FontId::new(16.0, egui::FontFamily::Proportional),
        palette.fg,
    );

    // Label (centre-left).
    ui.painter().text(
        Pos2::new(icon_x + 18.0, rect.center().y),
        egui::Align2::LEFT_CENTER,
        label,
        egui::FontId::new(13.0, egui::FontFamily::Proportional),
        palette.fg,
    );

    // Shortcut text (right-aligned, dim).
    if let Some(sc) = shortcut {
        ui.painter().text(
            Pos2::new(rect.right() - 14.0, rect.center().y),
            egui::Align2::RIGHT_CENTER,
            sc,
            egui::FontId::new(11.0, egui::FontFamily::Proportional),
            palette.fg_dim,
        );
    }

    if resp.clicked() {
        out.push(action);
    }
}

/// Paint a single 1 px horizontal separator with a small vertical gap
/// above and below — matches the visual rhythm of the reference.
fn separator(ui: &mut Ui, palette: &crate::theme::Palette) {
    let avail_w = ui.available_width();
    let (rect, _) = ui.allocate_exact_size(Vec2::new(avail_w, 9.0), Sense::hover());
    ui.painter().line_segment(
        [Pos2::new(rect.left() + 12.0, rect.center().y),
         Pos2::new(rect.right() - 12.0, rect.center().y)],
        Stroke::new(1.0, palette.border),
    );
}

// ----------------------------------------------------------------------
// Backwards-compatible shim — the original `AppMenu` floating popup is
// kept as a thin re-export so any out-of-tree caller (or other agent's
// in-flight branch) keeps compiling. It now just delegates to the new
// panel and ignores its `anchor` argument — the panel always slides in
// from the left edge of the viewport. Mark deprecated so new code reaches
// for `AppMenuPanel` instead.
// ----------------------------------------------------------------------

/// Deprecated wrapper that pretends to be a floating popup but now
/// delegates to `AppMenuPanel`. Prefer `AppMenuPanel::new().show(ctx)`
/// directly.
#[deprecated(note = "use `AppMenuPanel` directly")]
pub struct AppMenu {
    _anchor: Pos2,
}

#[allow(deprecated)]
impl AppMenu {
    /// Construct from an anchor position (ignored — kept for source
    /// compatibility with the old popup API).
    pub fn new(anchor: Pos2) -> Self { Self { _anchor: anchor } }

    /// Show the new panel. `open` is flipped to `false` when the user
    /// clicks an item, the back arrow, or outside the panel — so old
    /// call-sites that toggled this flag continue to work unchanged.
    pub fn show(self, ctx: &Context, open: &mut bool) -> Option<AppMenuAction> {
        if !*open {
            return None;
        }
        let actions = AppMenuPanel::new().show(ctx);
        // The new panel can emit multiple actions per frame (e.g. an
        // item click + a Close due to outside-click being detected in
        // the same frame). Pick the first non-Close action; otherwise
        // return Close to preserve the popup-style "one click = one
        // action" contract.
        let chosen = actions.iter().find(|a| !matches!(a, AppMenuAction::Close))
            .cloned()
            .or_else(|| actions.iter().find(|a| matches!(a, AppMenuAction::Close)).cloned());
        if chosen.is_some() {
            *open = false;
        }
        chosen
    }
}
