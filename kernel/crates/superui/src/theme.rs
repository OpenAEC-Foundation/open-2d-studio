//! Theme tokens — palette + apply-to-egui helpers.
//!
//! Phase 1 ships only the Default theme (warm dark brown with amber
//! accent, matching the canonical viewer mockup design tokens at the
//! top of `docs/superpowers/mockups/Open2DViewerMockup.jsx`).
//!
//! Mockup spec (verbatim):
//!   bg            = #3E3636   (ribbon content, canvas chrome)
//!   surface       = #4A4242   (titlebar, ribbon top-row, statusbar, panel headers)
//!   surface-hi    = #564E4E   (elevated/dropdowns)
//!   accent        = #D97706   (File tab fill, active button, logo)
//!   accent-hover  = #B45309
//!   accent-soft   = rgba(217,119,6,0.18)
//!   hover         = rgba(217,119,6,0.10)
//!   border        = rgba(217,119,6,0.25)
//!   border-light  = rgba(217,119,6,0.15)
//!   text          = #F5F0EB
//!   text-dim      = rgba(245,240,235,0.6)
//!   text-muted    = rgba(245,240,235,0.4)
//!   close-red     = #c42b1c

use egui::Color32;

/// 1.0 theme identifier. Phase 1 implements only `Default`; other
/// variants compile but currently return the Default palette.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Theme {
    Default,
    // Reserved (return Default palette in Phase 1):
    Dark,
    Light,
    Blue,
    AmberNavy,
    DeepForge,
    HighContrast,
}

/// Resolved colour set + a few essential metrics.
#[derive(Debug, Clone)]
pub struct Palette {
    pub bg: Color32,
    pub fg: Color32,
    pub fg_dim: Color32,
    /// Even dimmer text — mockup `textMuted` (alpha 0.4).
    pub fg_muted: Color32,
    pub accent: Color32,
    pub accent_hover: Color32,
    /// Soft accent fill (mockup `accentSoft` alpha 0.18).
    pub accent_soft: Color32,
    /// Standard border colour (alpha 0.25 of accent).
    pub border: Color32,
    /// Lighter border (alpha 0.15 of accent) used as inter-group divider.
    pub border_light: Color32,
    /// Hover background (alpha 0.10 of accent).
    pub hover: Color32,
    pub panel_bg: Color32,
    pub surface_hi: Color32,
    pub button_bg: Color32,
    pub button_hover: Color32,
    pub button_active: Color32,
    pub ribbon_tab_bg: Color32,
    pub ribbon_tab_active_bg: Color32,
    pub status_bg: Color32,
    pub titlebar_bg: Color32,
    pub close_red: Color32,
}

impl Theme {
    pub fn palette(&self) -> Palette {
        // ---- Exact mockup token values ---------------------------------
        // Direct mapping of the JSX `Token = { ... }` block.
        let accent       = Color32::from_rgb(0xD9, 0x77, 0x06);
        let accent_hover = Color32::from_rgb(0xB4, 0x53, 0x09);
        // Translucent fills are precomputed with the warm-brown body
        // (#3E3636) as backdrop so the alpha-flatten reads correctly on
        // egui's opaque painter (we don't always blend).
        // accent at alpha 0.10 over #3E3636 → ~ #4A3E33
        let hover        = Color32::from_rgba_unmultiplied(0xD9, 0x77, 0x06, 26);
        // accent at alpha 0.18 over #3E3636 → soft amber tint
        let accent_soft  = Color32::from_rgba_unmultiplied(0xD9, 0x77, 0x06, 46);
        // accent at alpha 0.25 → border colour
        let border       = Color32::from_rgba_unmultiplied(0xD9, 0x77, 0x06, 64);
        // accent at alpha 0.15 → lighter divider
        let border_light = Color32::from_rgba_unmultiplied(0xD9, 0x77, 0x06, 38);
        let bg           = Color32::from_rgb(0x3E, 0x36, 0x36);
        let surface      = Color32::from_rgb(0x4A, 0x42, 0x42);
        let surface_hi   = Color32::from_rgb(0x56, 0x4E, 0x4E);
        let text         = Color32::from_rgb(0xF5, 0xF0, 0xEB);
        // text alpha 0.6 → flatten over surface (#4A4242):
        //   r = 0xF5*0.6 + 0x4A*0.4 ≈ 0xA8
        let text_dim     = Color32::from_rgb(0xA8, 0xA1, 0x9B);
        // text alpha 0.4 → flatten over surface (#4A4242):
        //   r = 0xF5*0.4 + 0x4A*0.6 ≈ 0x84
        let text_muted   = Color32::from_rgb(0x88, 0x82, 0x7E);
        let close_red    = Color32::from_rgb(0xC4, 0x2B, 0x1C);

        Palette {
            bg,
            fg:                   text,
            fg_dim:               text_dim,
            fg_muted:             text_muted,
            accent,
            accent_hover,
            accent_soft,
            border,
            border_light,
            hover,
            panel_bg:             surface,
            surface_hi,
            button_bg:            surface,
            button_hover:         surface_hi,
            button_active:        accent,
            ribbon_tab_bg:        bg,
            ribbon_tab_active_bg: bg,
            status_bg:            surface,
            titlebar_bg:          surface,
            close_red,
        }
    }
}

/// Apply theme tokens to the egui context. Call once per frame at the
/// top of the egui run closure, BEFORE rendering any UI.
pub fn apply_theme(ctx: &egui::Context, theme: Theme) {
    let p = theme.palette();
    let mut style: egui::Style = (*ctx.style()).clone();
    let mut visuals = egui::Visuals::dark();
    visuals.window_fill = p.panel_bg;
    visuals.panel_fill = p.bg;
    visuals.widgets.noninteractive.bg_fill = p.panel_bg;
    visuals.widgets.noninteractive.fg_stroke.color = p.fg_dim;
    visuals.widgets.inactive.bg_fill = p.button_bg;
    visuals.widgets.inactive.fg_stroke.color = p.fg;
    visuals.widgets.hovered.bg_fill = p.button_hover;
    visuals.widgets.hovered.fg_stroke.color = p.fg;
    visuals.widgets.active.bg_fill = p.button_active;
    visuals.widgets.active.fg_stroke.color = p.fg;
    visuals.selection.bg_fill = p.accent;
    visuals.selection.stroke.color = p.fg;
    visuals.override_text_color = Some(p.fg);
    style.visuals = visuals;
    ctx.set_style(style);
}
