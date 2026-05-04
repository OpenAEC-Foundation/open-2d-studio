//! Spacing, metrics, and typography tokens — the numeric atoms
//! shared across all superui widgets.
//!
//! Values extracted from 1.0's CSS:
//! - `src/styles/globals.css`
//! - `src/components/layout/Ribbon/Ribbon.css`
//! - `src/components/layout/{TitleBar,StatusBar,FileTabBar}/*`

/// Spacing scale (px). Use these as `add_space`, padding, gaps.
pub mod spacing {
    pub const XS: f32 = 2.0;
    pub const SM: f32 = 4.0;
    pub const MD: f32 = 8.0;
    pub const LG: f32 = 12.0;
    pub const XL: f32 = 16.0;
    pub const XXL: f32 = 24.0;
}

/// Fixed UI metrics matching 1.0's chrome dimensions.
pub mod metrics {
    /// TitleBar height — `h-8` in `TitleBar.tsx` (line 420).
    pub const TITLEBAR_HEIGHT: f32 = 32.0;

    /// Ribbon tab strip height — `Ribbon.css` line 17.
    pub const RIBBON_TAB_HEIGHT: f32 = 28.0;

    /// Ribbon content area height — `Ribbon.css` lines 69, 77.
    pub const RIBBON_CONTENT_HEIGHT: f32 = 94.0;

    /// File tab bar height — `FileTabBar.tsx` line 217 (`h-[30px]`).
    pub const FILETAB_HEIGHT: f32 = 30.0;

    /// StatusBar height — `h-6` in `StatusBar.tsx` line 485.
    pub const STATUSBAR_HEIGHT: f32 = 24.0;

    /// Large (vertical) ribbon button height — `Ribbon.css` line 294.
    pub const RIBBON_BUTTON_LARGE: f32 = 66.0;

    /// Medium ribbon button height — `Ribbon.css` line 399.
    pub const RIBBON_BUTTON_MEDIUM: f32 = 32.0;

    /// Small ribbon button height — `Ribbon.css` line 366.
    pub const RIBBON_BUTTON_SMALL: f32 = 22.0;

    /// Small icon (used in small ribbon buttons, expand-panel actions).
    pub const ICON_SM: f32 = 14.0;

    /// Medium icon (used in small ribbon button, 16x16 in `Ribbon.css` line 374).
    pub const ICON_MD: f32 = 16.0;

    /// Medium-large icon (used in medium ribbon buttons — `Ribbon.css` line 407).
    pub const ICON_ML: f32 = 20.0;

    /// Large icon (used in large ribbon buttons — `Ribbon.css` line 322).
    pub const ICON_LG: f32 = 28.0;
}

/// Typography tokens. Phase 1 uses egui's default font; sizes match 1.0.
pub mod typography {
    /// Group label / micro text — `font-size: 9px` in `Ribbon.css` line 113.
    pub const SIZE_XS: f32 = 9.0;

    /// Large ribbon button label — `font-size: 10px` in `Ribbon.css` line 341.
    pub const SIZE_SM: f32 = 10.0;

    /// Small/medium ribbon button label, statusbar — `font-size: 11px`.
    pub const SIZE_MD: f32 = 11.0;

    /// Tab strip / body text — `font-size: 12px` in `Ribbon.css` lines 23, 633.
    pub const SIZE_LG: f32 = 12.0;

    /// Title text — slightly larger for headings.
    pub const SIZE_TITLE: f32 = 14.0;
}
