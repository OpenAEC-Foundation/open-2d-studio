//! Theme tokens — palette + apply-to-egui helpers.
//!
//! Phase 1 ships only the Default theme (warm dark brown with amber
//! accent, matching 1.0 globals.css `[data-theme="default"]`). Other
//! 1.0 themes (dark, light, blue, amber-navy, deep-forge,
//! high-contrast) are deferred to a later phase per user decision and
//! currently fall through to the Default palette.

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
    pub accent: Color32,
    pub accent_hover: Color32,
    pub border: Color32,
    pub panel_bg: Color32,
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
        // Default palette — values from 1.0 src/styles/globals.css
        // [data-theme="default"] block:
        //   --theme-bg            #3E3636  (warm dark brown)
        //   --theme-surface       #4a4242  (panel / dropdown / grid)
        //   --theme-surface-elevated #564e4e
        //   --theme-text          #F5F0EB
        //   --theme-text-dim      rgba(245,240,235,0.6)  -> ~ #93908C on #3E3636
        //   --theme-accent        #D97706  (amber)
        //   --theme-accent-hover  #B45309
        //   --theme-border        rgba(217,119,6,0.25)   -> ~ #5E4521 on #3E3636
        //   ribbon-tab gradient   #4a4242 -> #443c3c
        // titlebar/status/close-red have no dedicated tokens in 1.0;
        // we derive them: titlebar = surface-elevated, status = bg
        // (slightly darker variant), close_red = standard close red.
        Palette {
            bg:                   Color32::from_rgb(0x3E, 0x36, 0x36),
            fg:                   Color32::from_rgb(0xF5, 0xF0, 0xEB),
            fg_dim:               Color32::from_rgb(0x93, 0x90, 0x8C),
            accent:               Color32::from_rgb(0xD9, 0x77, 0x06),
            accent_hover:         Color32::from_rgb(0xB4, 0x53, 0x09),
            border:               Color32::from_rgb(0x5E, 0x45, 0x21),
            panel_bg:             Color32::from_rgb(0x4A, 0x42, 0x42),
            button_bg:            Color32::from_rgb(0x4A, 0x42, 0x42),
            button_hover:         Color32::from_rgb(0x56, 0x4E, 0x4E),
            button_active:        Color32::from_rgb(0xD9, 0x77, 0x06),
            ribbon_tab_bg:        Color32::from_rgb(0x44, 0x3C, 0x3C),
            ribbon_tab_active_bg: Color32::from_rgb(0x4A, 0x42, 0x42),
            status_bg:            Color32::from_rgb(0x33, 0x2D, 0x2D),
            titlebar_bg:          Color32::from_rgb(0x56, 0x4E, 0x4E),
            close_red:            Color32::from_rgb(0xE8, 0x1C, 0x3C),
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
