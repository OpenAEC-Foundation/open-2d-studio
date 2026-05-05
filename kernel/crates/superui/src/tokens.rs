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
    /// 1.0 reserves ~24 px below the buttons for the uppercase group
    /// label; we keep that gap so 66 px Large buttons don't crowd the
    /// title.
    /// Round 9 fix: bump 100 → 108 so 66 px Large + group-title baseline
    /// don't overlap captions of medium/large buttons in stacked groups
    /// like ANNOTATE / MODIFY / EDIT.
    pub const RIBBON_CONTENT_HEIGHT: f32 = 108.0;

    /// File tab bar height — `FileTabBar.tsx` line 217 (`h-[30px]`).
    pub const FILETAB_HEIGHT: f32 = 30.0;

    /// StatusBar height — `h-6` in `StatusBar.tsx` line 485.
    pub const STATUSBAR_HEIGHT: f32 = 24.0;

    /// Large (vertical) ribbon button height — `Ribbon.css` line 294.
    /// Round 9 fix: bump 66 → 72 so the caption ("Select", "Measure",
    /// "Move") doesn't clip below the icon glyph at icon size 24 px.
    pub const RIBBON_BUTTON_LARGE: f32 = 72.0;

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
    /// 1.0 reference renders the SELECTION pawn at ~24 px, not the 28 px
    /// we previously used. Round 8 polish: shrink so it stops dominating
    /// the group visually.
    pub const ICON_LG: f32 = 24.0;

    // ---- Side-dock metrics (Round 9, panels feature) -------------------
    /// Default left dock width — matches 1.0 React `Sidebar.css` left
    /// rail width (`width: 248px`).
    pub const LEFT_DOCK_WIDTH: f32 = 248.0;

    /// Default right (Properties) dock width — 1.0 ships ~340 px wide.
    pub const RIGHT_DOCK_WIDTH: f32 = 340.0;

    /// Section header bar height inside a dock (caret + label + side
    /// icon). Matches 1.0's collapsible-section header.
    pub const DOCK_HEADER_HEIGHT: f32 = 28.0;

    /// List-item height inside the LeftDock drawings/sheets lists.
    pub const DOCK_ITEM_HEIGHT: f32 = 26.0;
}

/// Ribbon-grid tokens. The ribbon paints onto a strict cell grid so that
/// rows and columns of buttons always line up regardless of which group
/// they live in. All sizing decisions live here so the consumer never
/// has to think about pixels.
///
/// Design principles (verified against 1.0 `Ribbon.css`):
/// 1. The content strip has a fixed inner height (`CONTENT_INNER_H`)
///    reserved for buttons; the group title baseline is anchored at
///    `CONTENT_H - TITLE_BAND_H`.
/// 2. Every button cell has the same outer size for its variant. Large
///    cells span the full inner band height; Medium/Small cells stack 2
///    per column with zero variance between groups.
/// 3. Icons are centred on a deterministic baseline inside each cell.
pub mod ribbon_grid {
    /// Total content strip height (matches `metrics::RIBBON_CONTENT_HEIGHT`).
    pub const CONTENT_H: f32 = super::metrics::RIBBON_CONTENT_HEIGHT;
    /// Reserved band along the bottom for the uppercase group label.
    pub const TITLE_BAND_H: f32 = 16.0;
    /// Inner band height available to buttons (cells must fit in this).
    pub const INNER_H: f32 = CONTENT_H - TITLE_BAND_H;

    /// Padding inside the content strip on top.
    pub const INNER_PAD_TOP: f32 = 4.0;

    // ---- Cell sizes ---------------------------------------------------
    /// Large icon-over-caption cell. Tall: spans full INNER_H minus pad.
    pub const LARGE_W: f32 = 56.0;
    pub const LARGE_H: f32 = INNER_H - INNER_PAD_TOP; // 88
    /// Medium horizontal icon+caption cell. Two stack per column.
    pub const MEDIUM_W: f32 = 86.0;
    pub const MEDIUM_H: f32 = (INNER_H - INNER_PAD_TOP) / 2.0; // 44
    /// Small horizontal icon+caption cell. Two stack per column.
    pub const SMALL_W: f32 = 86.0;
    pub const SMALL_H: f32 = (INNER_H - INNER_PAD_TOP) / 2.0; // 44

    /// Gutter between adjacent cells in a stack column (vertical).
    pub const CELL_GAP_V: f32 = 0.0;
    /// Gutter between adjacent stack columns inside a group.
    pub const CELL_GAP_H: f32 = 2.0;
    /// Padding inside a group on the left/right.
    pub const GROUP_PAD_X: f32 = 4.0;
    /// Space added between adjacent groups (separator inset lives here).
    pub const GROUP_GAP: f32 = 8.0;

    // ---- Icon sizes per cell variant ---------------------------------
    pub const ICON_LARGE: f32 = 28.0;
    pub const ICON_MEDIUM: f32 = 18.0;
    pub const ICON_SMALL: f32 = 14.0;

    // ---- Caption font sizes ------------------------------------------
    pub const CAPTION_LARGE: f32 = 11.0;
    pub const CAPTION_MEDIUM: f32 = 11.0;
    pub const CAPTION_SMALL: f32 = 11.0;
    pub const TITLE_FONT: f32 = 9.0;

    /// Inner padding inside a cell on every side.
    pub const CELL_PAD: f32 = 4.0;
    /// Gap between icon and caption inside a horizontal cell.
    pub const ICON_CAPTION_GAP: f32 = 6.0;
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
