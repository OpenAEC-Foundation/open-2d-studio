//! Spacing, metrics, and typography tokens — the numeric atoms
//! shared across all superui widgets.
//!
//! Values extracted from the canonical viewer mockup
//! `docs/superpowers/mockups/Open2DViewerMockup.jsx` (Round 1, Phase 1
//! layout port). The legacy 1.0 React CSS still informs comments where
//! the JSX directly mirrors `Ribbon.css` / `TitleBar.tsx`.

/// Spacing scale (px). Use these as `add_space`, padding, gaps.
pub mod spacing {
    pub const XS: f32 = 2.0;
    pub const SM: f32 = 4.0;
    pub const MD: f32 = 8.0;
    pub const LG: f32 = 12.0;
    pub const XL: f32 = 16.0;
    pub const XXL: f32 = 24.0;
}

/// Fixed UI metrics matching the JSX mockup chrome dimensions.
///
/// Mockup spec (top of `Open2DViewerMockup.jsx`):
///   titlebar h     = 32
///   ribbon tabstrip= 28
///   ribbon content = 94
///   file tab strip = 30
///   statusbar h    = 24
///   left dock w    = 248 (Layers-only viewer scope)
///   right panel w  = 256 (Properties)
pub mod metrics {
    /// TitleBar height — mockup spec 32 px (`h-8` in 1.0's TitleBar.tsx).
    pub const TITLEBAR_HEIGHT: f32 = 32.0;

    /// Ribbon tab strip height — mockup spec 28 px (Ribbon.css line 17).
    pub const RIBBON_TAB_HEIGHT: f32 = 28.0;

    /// Ribbon content area height — mockup spec 94 px (Ribbon.css lines
    /// 69, 77). The bottom 16 px is reserved for the uppercase group
    /// label band so 66 px Large buttons sit cleanly above their title.
    pub const RIBBON_CONTENT_HEIGHT: f32 = 94.0;

    /// File tab bar height — mockup spec 30 px (FileTabBar.tsx).
    pub const FILETAB_HEIGHT: f32 = 30.0;

    /// StatusBar height — mockup spec 24 px (StatusBar.tsx `h-6`).
    pub const STATUSBAR_HEIGHT: f32 = 24.0;

    /// Large (vertical) ribbon button height — mockup spec 66 px (icon
    /// 28 + 10 px caption + 6 px padding). Pinned to the inner band so
    /// adjacent Larges align across groups.
    pub const RIBBON_BUTTON_LARGE: f32 = 66.0;

    /// Medium ribbon button height — 32 px (stack-of-2 inside 66 inner
    /// band). Icon 20 + 11 px caption beside it.
    pub const RIBBON_BUTTON_MEDIUM: f32 = 32.0;

    /// Small ribbon button height — 22 px (stack-of-3 inside 66 inner
    /// band). Icon 16 + 11 px caption beside it.
    pub const RIBBON_BUTTON_SMALL: f32 = 22.0;

    /// Small icon (used in small ribbon buttons, expand-panel actions).
    pub const ICON_SM: f32 = 14.0;

    /// Medium icon (used in small ribbon button — `Ribbon.css` line 374).
    pub const ICON_MD: f32 = 16.0;

    /// Medium-large icon (used in medium ribbon buttons — Ribbon.css 407).
    pub const ICON_ML: f32 = 20.0;

    /// Large icon (used in large ribbon buttons — mockup spec 28 px).
    pub const ICON_LG: f32 = 28.0;

    // ---- Side-dock metrics --------------------------------------------
    /// Default left dock width — mockup spec 248 px (Layers only in
    /// viewer scope, Drawings/Sheets removed per commit b361fc2).
    pub const LEFT_DOCK_WIDTH: f32 = 248.0;

    /// Default right (Properties) dock width — mockup spec 256 px.
    pub const RIGHT_DOCK_WIDTH: f32 = 256.0;

    /// Section header bar height inside a dock (caret + label + side
    /// icon). Mockup uses 24 px (py-1.5 around 12 px label).
    pub const DOCK_HEADER_HEIGHT: f32 = 24.0;

    /// List-item / layer-row height inside the LeftDock layers list —
    /// mockup uses `h-6` = 24 px (`h-6` rounded; effectively 22-24 px).
    pub const DOCK_ITEM_HEIGHT: f32 = 22.0;
}

/// Ribbon-grid tokens. The ribbon paints onto a strict cell grid so that
/// rows and columns of buttons always line up regardless of which group
/// they live in. All sizing decisions live here so the consumer never
/// has to think about pixels.
///
/// Design principles (verified against the JSX mockup):
/// 1. The content strip has a fixed inner height (`CONTENT_INNER_H`)
///    reserved for buttons; the group title baseline is anchored at
///    `CONTENT_H - TITLE_BAND_H`.
/// 2. Every button cell has the same outer size for its variant. Large
///    cells span the full inner band height; Medium cells stack 2 per
///    column; Small cells stack 3 per column.
/// 3. Icons are centred on a deterministic baseline inside each cell.
pub mod ribbon_grid {
    /// Total content strip height (matches `metrics::RIBBON_CONTENT_HEIGHT`).
    pub const CONTENT_H: f32 = super::metrics::RIBBON_CONTENT_HEIGHT;
    /// Reserved band along the bottom for the uppercase group label.
    pub const TITLE_BAND_H: f32 = 14.0;
    /// Inner band height available to buttons (cells must fit in this).
    pub const INNER_H: f32 = CONTENT_H - TITLE_BAND_H;

    /// Padding inside the content strip on top.
    pub const INNER_PAD_TOP: f32 = 4.0;

    // ---- Cell sizes (mockup spec) -------------------------------------
    /// Large icon-over-caption cell. Mockup `RibbonBtn`: width 54, height 66.
    pub const LARGE_W: f32 = 54.0;
    pub const LARGE_H: f32 = 66.0;
    /// Medium horizontal icon+caption cell. Two stack per column. Mockup
    /// `RibbonSmallBtn` used in medium-stack rows: minW 74, height 32.
    pub const MEDIUM_W: f32 = 74.0;
    pub const MEDIUM_H: f32 = 32.0;
    /// Small horizontal icon+caption cell. Three stack per column. Mockup
    /// `RibbonSmallBtn`: minW 70, height 22.
    pub const SMALL_W: f32 = 70.0;
    pub const SMALL_H: f32 = 22.0;

    /// Gutter between adjacent cells in a stack column (vertical).
    /// Mockup `RibbonBtnStack` uses gap 1.
    pub const CELL_GAP_V: f32 = 1.0;
    /// Gutter between adjacent stack columns inside a group.
    /// Mockup `flex gap 2` between buttons in a group.
    pub const CELL_GAP_H: f32 = 2.0;
    /// Padding inside a group on the left/right.
    /// Mockup `RibbonGroup`: padding '0 4px'.
    pub const GROUP_PAD_X: f32 = 4.0;
    /// Space between adjacent groups (separator inset lives here).
    /// Mockup `RibbonGroup`: marginRight 4.
    pub const GROUP_GAP: f32 = 4.0;

    // ---- Icon sizes per cell variant (mockup spec) -------------------
    /// Large cell: icon 28 px (mockup `RibbonBtn` inner div 28×28).
    pub const ICON_LARGE: f32 = 28.0;
    /// Medium cell: icon 20 px (mockup spec).
    pub const ICON_MEDIUM: f32 = 20.0;
    /// Small cell: icon 16 px (mockup `RibbonSmallBtn` icon size 14-16).
    pub const ICON_SMALL: f32 = 14.0;

    // ---- Caption font sizes (mockup spec) ----------------------------
    /// Large caption: 10 px (mockup `fontSize: 10`).
    pub const CAPTION_LARGE: f32 = 10.0;
    /// Medium/Small caption: 11 px (mockup `fontSize: 11`).
    pub const CAPTION_MEDIUM: f32 = 11.0;
    pub const CAPTION_SMALL: f32 = 11.0;
    /// Group title font — 9 px uppercase 0.3 letter-spacing (mockup spec).
    pub const TITLE_FONT: f32 = 9.0;

    /// Inner padding inside a cell on every side.
    pub const CELL_PAD: f32 = 4.0;
    /// Gap between icon and caption inside a horizontal cell.
    pub const ICON_CAPTION_GAP: f32 = 6.0;
}

/// Typography tokens. Phase 1 uses egui's default font; sizes match the
/// JSX mockup.
pub mod typography {
    /// Group label / micro text — `font-size: 9px` (mockup spec).
    pub const SIZE_XS: f32 = 9.0;

    /// Large ribbon button label — `font-size: 10px` (mockup spec).
    pub const SIZE_SM: f32 = 10.0;

    /// Small/medium ribbon button label, statusbar — `font-size: 11px`.
    pub const SIZE_MD: f32 = 11.0;

    /// Tab strip / body text — `font-size: 12px` (mockup spec).
    pub const SIZE_LG: f32 = 12.0;

    /// Title text — `font-size: 13px` (mockup spec: titlebar title).
    pub const SIZE_TITLE: f32 = 13.0;
}
