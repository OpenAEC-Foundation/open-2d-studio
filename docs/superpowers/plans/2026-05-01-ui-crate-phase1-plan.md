# UI-crate Phase 1 Implementation Plan — superui chrome (TitleBar / Ribbon / FileTabBar / StatusBar)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up a new `superui` Rust crate that provides reusable egui-based chrome components (Theme + tokens + CadButton + Icons + TitleBar + Ribbon + FileTabBar + StatusBar) matching Open 2D Studio 1.0's default theme. The existing `open_2d_studio` binary refactors to consume them with no behavioural change — same visuals as 1.0's web app at https://open-2d-studio.open-aec.com/.

**Architecture:** Single fat crate `superui` with feature flags (`layout`, `panels`, `dialogs`, `editors` — Phase 1 only enables `layout`). All components are data-driven egui widgets that take small typed state structs and return action enums. No globals, no Rc<RefCell>. Theme tokens applied once per frame via `apply_theme(&egui::Context, Theme)`.

**Tech Stack:** Rust 1.77+, egui 0.29 (matched to existing `kernel-app` workspace pin), egui_extras, egui-phosphor for icon-pack, custom hand-drawn CAD icons. No new runtime deps beyond these.

---

## User-approved decisions

1. Crate name: `superui`
2. Themes in v0: only **Default** (the warm dark brown from 1.0)
3. Light theme: deferred (later phase)
4. Resizable panels: `egui_dock` — **deferred to Phase C**, not used in Phase 1 chrome
5. Icons: `egui-phosphor` icon-pack + hand-drawn CAD-specific icons
6. Phase 1 scope: tokens + 10 essential icons + CadButton primitives + TitleBar + Ribbon + FileTabBar + StatusBar
7. UI strings: English (matching 1.0 pattern)

---

## Repository context

Working dir: `C:\Users\rickd\Documents\GitHub\open-2d-studio`
Branch: `merge-1.0-2.0` (already checked out)

Existing workspace structure:
- `kernel/Cargo.toml` — workspace root, current `members = ["crates/core", "crates/render", ..., "crates/app"]`
- `kernel/crates/app/Cargo.toml` — `kernel-app` crate, hosts `open_2d_studio` binary
- `kernel/crates/app/src/bin/open_2d_studio.rs` — current monolithic ~6500-line binary with inline egui chrome (custom-drawn icons, ribbon groups, big_icon_button, etc.)

1.0 web reference (read-only):
- `src/components/layout/Ribbon/Ribbon.tsx` (1514 LOC) + `Ribbon.css`
- `src/components/layout/Ribbon/QuickAccessBar.tsx`
- `src/components/layout/Ribbon/RibbonComponents.tsx`
- `src/components/layout/Ribbon/SelectionFilterBar.tsx`
- `src/components/layout/TitleBar/TitleBar.tsx` (518 LOC)
- `src/components/layout/StatusBar/StatusBar.tsx` (740 LOC)
- `src/components/layout/FileTabBar/`
- `src/styles/globals.css` — CSS custom properties (`--theme-bg`, `--theme-accent`, etc.)

Spec: `docs/superpowers/specs/2026-05-01-ui-crate-design.md` (read for context as needed).

**Coordination constraint**: Task 11 of this plan refactors `kernel/crates/app/src/bin/open_2d_studio.rs` to consume `superui`. The text-editor implementation plan (in flight) also edits that file in its own Tasks 8-10. **Task 11 MUST NOT START until the text-editor plan's Task 10 is committed.** Until then, Tasks 1-10 of THIS plan only create new files in `kernel/crates/superui/` — zero edits to `open_2d_studio.rs`.

---

## File structure overview

| File | What this plan creates/changes |
|------|-------------------------------|
| `kernel/crates/superui/Cargo.toml` | New — crate manifest |
| `kernel/crates/superui/src/lib.rs` | New — module exports + crate-level docs |
| `kernel/crates/superui/src/theme.rs` | New — `Theme` enum, `Palette` struct, `apply_theme()` |
| `kernel/crates/superui/src/tokens.rs` | New — `spacing`, `metrics`, `typography` constants |
| `kernel/crates/superui/src/icon.rs` | New — `IconKind` enum, hand-drawn CAD icons + egui-phosphor bridge |
| `kernel/crates/superui/src/primitives/mod.rs` | New — primitives module index |
| `kernel/crates/superui/src/primitives/button.rs` | New — `CadButton::large/medium/small` |
| `kernel/crates/superui/src/layout/mod.rs` | New — layout module index (gated on `layout` feature) |
| `kernel/crates/superui/src/layout/title_bar.rs` | New — `TitleBar` widget |
| `kernel/crates/superui/src/layout/ribbon.rs` | New — `Ribbon` + `RibbonGroup` builders |
| `kernel/crates/superui/src/layout/file_tab_bar.rs` | New — `FileTabBar` with sloped divider |
| `kernel/crates/superui/src/layout/status_bar.rs` | New — `StatusBar` |
| `kernel/Cargo.toml` | Modified — add `crates/superui` to workspace members |
| `kernel/crates/app/Cargo.toml` | Modified — add `superui = { path = "../ui" }` dep |
| `kernel/crates/app/src/bin/open_2d_studio.rs` | Modified (LAST TASK ONLY, after text-editor Task 10) — replace inline chrome with `superui::layout::*` calls |

---

## Task 1: Scaffold `superui` crate

**Files:**
- Create: `kernel/crates/superui/Cargo.toml`
- Create: `kernel/crates/superui/src/lib.rs`
- Modify: `kernel/Cargo.toml` (workspace members)

- [ ] **Step 1: Create directory structure**

```bash
cd /c/Users/rickd/Documents/GitHub/open-2d-studio
mkdir -p kernel/crates/superui/src/primitives
mkdir -p kernel/crates/superui/src/layout
```

- [ ] **Step 2: Write `kernel/crates/superui/Cargo.toml`**

```toml
[package]
name = "superui"
version.workspace = true
edition.workspace = true
license.workspace = true
description = "Reusable egui UI components for Open 2D Studio — port of the 1.0 React UI."

[dependencies]
egui = { workspace = true }
egui_extras = { version = "0.29", features = ["image"] }
egui-phosphor = "0.7"
serde = { workspace = true }

[features]
default = ["layout"]
layout = []
panels = []
dialogs = []
editors = []
```

(`egui-phosphor 0.7` is the published version compatible with egui 0.29. If a different version is needed, the next step's `cargo metadata` will report.)

- [ ] **Step 3: Write `kernel/crates/superui/src/lib.rs`**

```rust
//! superui — reusable egui UI components for Open 2D Studio.
//!
//! Phase 1: chrome (TitleBar, Ribbon, FileTabBar, StatusBar) + theme
//! tokens + CadButton primitives + a minimal icon set. Future phases
//! add panels, dialogs, and specialised editors behind feature flags.
//!
//! See `docs/superpowers/specs/2026-05-01-ui-crate-design.md` for the
//! full design.

pub mod theme;
pub mod tokens;
pub mod icon;
pub mod primitives;

#[cfg(feature = "layout")]
pub mod layout;

pub use theme::{Theme, Palette, apply_theme};
pub use icon::{IconKind, paint_icon};
pub use primitives::button::CadButton;
```

- [ ] **Step 4: Add `crates/superui` to workspace members**

Edit `kernel/Cargo.toml`. In the `[workspace] members = [...]` array, add `"crates/superui"` so the new crate is part of the workspace.

Find the `members = [...]` block (top of file). Append:
```toml
    "crates/superui",
```

- [ ] **Step 5: Verify metadata parses**

```bash
cd /c/Users/rickd/Documents/GitHub/open-2d-studio/kernel && cargo metadata --format-version=1 >/dev/null && echo OK
```

Expected: `OK`. If it errors, fix the toml or the workspace member path.

The crate won't BUILD yet (the `pub mod` lines in lib.rs reference modules that don't exist), but metadata will parse. Tasks 2-10 fill in those modules.

- [ ] **Step 6: Commit**

```bash
cd /c/Users/rickd/Documents/GitHub/open-2d-studio
git add kernel/Cargo.toml kernel/crates/superui/
git commit -m "feat(superui): scaffold crate with feature flags"
```

---

## Task 2: Theme tokens (`Theme` enum + `Palette` struct + `apply_theme`)

**Files:**
- Create: `kernel/crates/superui/src/theme.rs`

- [ ] **Step 1: Read 1.0's CSS for the Default theme palette**

```bash
grep -A 30 "\[data-theme=\"default\"\]" /c/Users/rickd/Documents/GitHub/open-2d-studio/src/styles/globals.css
```

Note the hex values for `--theme-bg`, `--theme-fg`, `--theme-accent`, `--theme-border`, `--theme-panel-bg`, `--theme-button-bg`, `--theme-button-hover`, etc.

- [ ] **Step 2: Write `kernel/crates/superui/src/theme.rs`**

```rust
//! Theme tokens — palette + apply-to-egui helpers.
//!
//! Phase 1 ships only the Default theme (warm dark brown). Other 1.0
//! themes (dark, light, blue, amber-navy, deep-forge, high-contrast)
//! are deferred to a later phase per user decision.

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
        // Default palette — extracted from 1.0 globals.css
        // [data-theme="default"] block. Replace these with the actual
        // hex values from Step 1 if they differ.
        Palette {
            bg:                 Color32::from_rgb(0x1f, 0x1b, 0x18),
            fg:                 Color32::from_rgb(0xe8, 0xe3, 0xdc),
            fg_dim:             Color32::from_rgb(0x9a, 0x90, 0x84),
            accent:             Color32::from_rgb(0xc9, 0x82, 0x3f),
            accent_hover:       Color32::from_rgb(0xd9, 0x96, 0x4f),
            border:             Color32::from_rgb(0x3a, 0x32, 0x2c),
            panel_bg:           Color32::from_rgb(0x2a, 0x24, 0x20),
            button_bg:          Color32::from_rgb(0x32, 0x2c, 0x26),
            button_hover:       Color32::from_rgb(0x3e, 0x36, 0x2e),
            button_active:      Color32::from_rgb(0x4a, 0x40, 0x36),
            ribbon_tab_bg:      Color32::from_rgb(0x26, 0x20, 0x1c),
            ribbon_tab_active_bg: Color32::from_rgb(0x32, 0x2c, 0x26),
            status_bg:          Color32::from_rgb(0x1a, 0x16, 0x14),
            titlebar_bg:        Color32::from_rgb(0x18, 0x14, 0x12),
            close_red:          Color32::from_rgb(0xe8, 0x1c, 0x3c),
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
```

- [ ] **Step 3: Build the crate**

```bash
cd kernel && cargo build --release -p superui 2>&1 | tail -10
```

Expected: still fails because `tokens` / `icon` / `primitives` modules referenced in lib.rs don't exist yet. That's OK — comment out those `pub mod` lines temporarily, build, confirm `theme.rs` is clean, then uncomment.

Actually a cleaner approach: keep all `pub mod` lines but create empty stub files for the others now:

```bash
echo "//! tokens — placeholder until Task 3" > kernel/crates/superui/src/tokens.rs
echo "//! icon — placeholder until Task 4" > kernel/crates/superui/src/icon.rs
mkdir -p kernel/crates/superui/src/primitives
echo "//! primitives — placeholder until Task 5" > kernel/crates/superui/src/primitives/mod.rs
mkdir -p kernel/crates/superui/src/layout
echo "//! layout — placeholder until Tasks 6-10" > kernel/crates/superui/src/layout/mod.rs
```

Update `lib.rs` to remove the re-exports for the empty stubs (defer until their modules have content):

```rust
//! superui — reusable egui UI components for Open 2D Studio.
pub mod theme;
pub mod tokens;
pub mod icon;
pub mod primitives;

#[cfg(feature = "layout")]
pub mod layout;

pub use theme::{Theme, Palette, apply_theme};
```

Now build:
```bash
cargo build --release -p superui 2>&1 | tail -10
```

Expected: green.

- [ ] **Step 4: Commit**

```bash
git add kernel/crates/superui/
git commit -m "feat(superui): theme tokens (Default palette + apply_theme)"
```

---

## Task 3: Spacing + metrics + typography constants

**Files:**
- Modify: `kernel/crates/superui/src/tokens.rs`

- [ ] **Step 1: Read 1.0's CSS for spacing/metrics**

```bash
grep -E "padding|margin|height|gap" /c/Users/rickd/Documents/GitHub/open-2d-studio/src/components/layout/Ribbon/Ribbon.css 2>/dev/null | head -30
grep -E "padding|margin|height|gap" /c/Users/rickd/Documents/GitHub/open-2d-studio/src/components/layout/TitleBar/TitleBar.tsx 2>/dev/null | head -10
```

Note the px values used (4, 6, 8, 12, 16, 24 etc).

- [ ] **Step 2: Replace `tokens.rs` with the actual constants**

```rust
//! Spacing, metrics, and typography tokens — the numeric atoms
//! shared across all superui widgets.

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
    pub const TITLEBAR_HEIGHT: f32 = 32.0;
    pub const RIBBON_TAB_HEIGHT: f32 = 28.0;
    pub const RIBBON_CONTENT_HEIGHT: f32 = 94.0;
    pub const FILETAB_HEIGHT: f32 = 26.0;
    pub const STATUSBAR_HEIGHT: f32 = 24.0;
    pub const RIBBON_BUTTON_LARGE: f32 = 66.0;
    pub const RIBBON_BUTTON_MEDIUM: f32 = 32.0;
    pub const RIBBON_BUTTON_SMALL: f32 = 22.0;
    pub const ICON_SM: f32 = 14.0;
    pub const ICON_MD: f32 = 16.0;
    pub const ICON_LG: f32 = 28.0;
}

/// Typography tokens. Phase 1 uses egui's default font (Inter not yet
/// bundled — that's a future task); sizes match 1.0.
pub mod typography {
    pub const SIZE_XS: f32 = 10.0;
    pub const SIZE_SM: f32 = 11.0;
    pub const SIZE_MD: f32 = 12.0;
    pub const SIZE_LG: f32 = 14.0;
    pub const SIZE_TITLE: f32 = 16.0;
}
```

- [ ] **Step 3: Build**

```bash
cd kernel && cargo build --release -p superui 2>&1 | tail -5
```

Expected: green.

- [ ] **Step 4: Commit**

```bash
git add kernel/crates/superui/src/tokens.rs
git commit -m "feat(superui): spacing/metrics/typography tokens"
```

---

## Task 4: Icon module (10 hand-drawn CAD icons + phosphor bridge)

**Files:**
- Modify: `kernel/crates/superui/src/icon.rs`

- [ ] **Step 1: Replace `icon.rs` with the icon module**

```rust
//! Icons — a small hand-drawn CAD-specific set + a bridge to
//! `egui-phosphor` for everything else (lucide-react replacement).

use egui::{Color32, Painter, Rect, Stroke, Pos2};

/// Phase 1 essential CAD icons. Hand-painted via egui::Painter so we
/// don't depend on raster/font assets for these. Other 1.0 icons
/// (lucide-react names) are fetched from `egui-phosphor`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum IconKind {
    /// Straight line — two points connected by a stroke.
    Line,
    /// Arc — quarter circle.
    Arc,
    /// Polyline — three connected segments forming a zigzag.
    Polyline,
    /// Circle outline.
    Circle,
    /// Rectangle outline.
    Rectangle,
    /// Hatch — diagonal line pattern in a rect.
    Hatch,
    /// Linear dimension — line with arrowheads + text indicator.
    Dimension,
    /// Text "T" glyph indicator.
    Text,
    /// Move — four-direction arrow cross.
    Move,
    /// Delete — trash bin.
    Delete,
}

/// Paint an icon centred in `rect` using the given color. Stroke
/// thickness scales with rect size so the same IconKind looks right
/// at large/medium/small button sizes.
pub fn paint_icon(painter: &Painter, rect: Rect, kind: IconKind, color: Color32) {
    let center = rect.center();
    let r = rect.width().min(rect.height()) * 0.45;
    let stroke = Stroke::new((r * 0.12).max(1.2), color);
    match kind {
        IconKind::Line => {
            painter.line_segment(
                [Pos2::new(center.x - r, center.y + r * 0.4),
                 Pos2::new(center.x + r, center.y - r * 0.4)],
                stroke,
            );
        }
        IconKind::Arc => {
            // Approximate quarter arc with 8 segments.
            let mut prev: Option<Pos2> = None;
            for i in 0..=8 {
                let t = (i as f32 / 8.0) * std::f32::consts::FRAC_PI_2;
                let p = Pos2::new(center.x + r * t.cos() - r * 0.2,
                                  center.y + r * t.sin() - r * 0.2);
                if let Some(prev) = prev {
                    painter.line_segment([prev, p], stroke);
                }
                prev = Some(p);
            }
        }
        IconKind::Polyline => {
            let pts = [
                Pos2::new(center.x - r,        center.y + r * 0.5),
                Pos2::new(center.x - r * 0.3,  center.y - r * 0.5),
                Pos2::new(center.x + r * 0.3,  center.y + r * 0.2),
                Pos2::new(center.x + r,        center.y - r * 0.4),
            ];
            for w in pts.windows(2) {
                painter.line_segment([w[0], w[1]], stroke);
            }
        }
        IconKind::Circle => {
            painter.circle_stroke(center, r * 0.85, stroke);
        }
        IconKind::Rectangle => {
            let inset = r * 0.85;
            painter.rect_stroke(
                Rect::from_center_size(center, egui::vec2(inset * 2.0, inset * 1.4)),
                0.0,
                stroke,
            );
        }
        IconKind::Hatch => {
            let inset = r * 0.85;
            let bx = Rect::from_center_size(center, egui::vec2(inset * 2.0, inset * 1.4));
            painter.rect_stroke(bx, 0.0, stroke);
            // Diagonal lines inside.
            let n = 4;
            for i in 0..n {
                let t = (i as f32 + 0.5) / n as f32;
                let x = bx.left() + t * bx.width();
                painter.line_segment(
                    [Pos2::new(x, bx.top()), Pos2::new(x - bx.height(), bx.bottom())],
                    Stroke::new(stroke.width * 0.6, color),
                );
            }
        }
        IconKind::Dimension => {
            let y = center.y;
            painter.line_segment(
                [Pos2::new(center.x - r, y), Pos2::new(center.x + r, y)],
                stroke,
            );
            // Tick marks at ends.
            for &x in &[-r, r] {
                painter.line_segment(
                    [Pos2::new(center.x + x, y - r * 0.3),
                     Pos2::new(center.x + x, y + r * 0.3)],
                    stroke,
                );
            }
        }
        IconKind::Text => {
            // "T" — horizontal cap + vertical stem.
            let cap_w = r * 0.9;
            let stem_h = r * 0.9;
            painter.line_segment(
                [Pos2::new(center.x - cap_w, center.y - stem_h),
                 Pos2::new(center.x + cap_w, center.y - stem_h)],
                stroke,
            );
            painter.line_segment(
                [Pos2::new(center.x, center.y - stem_h),
                 Pos2::new(center.x, center.y + stem_h)],
                stroke,
            );
        }
        IconKind::Move => {
            // Four-direction arrows from centre.
            for &(dx, dy) in &[(1.0, 0.0), (-1.0, 0.0), (0.0, 1.0), (0.0, -1.0)] {
                let tip = Pos2::new(center.x + dx * r, center.y + dy * r);
                let base = Pos2::new(center.x + dx * r * 0.3, center.y + dy * r * 0.3);
                painter.line_segment([base, tip], stroke);
                // Arrowhead — two short strokes back from tip.
                let perp_x = -dy;
                let perp_y = dx;
                let head_back = Pos2::new(tip.x - dx * r * 0.3, tip.y - dy * r * 0.3);
                painter.line_segment(
                    [tip, Pos2::new(head_back.x + perp_x * r * 0.18, head_back.y + perp_y * r * 0.18)],
                    stroke,
                );
                painter.line_segment(
                    [tip, Pos2::new(head_back.x - perp_x * r * 0.18, head_back.y - perp_y * r * 0.18)],
                    stroke,
                );
            }
        }
        IconKind::Delete => {
            // Simple trash bin — top lid + body rectangle + 3 vertical lines inside.
            let body = Rect::from_center_size(
                Pos2::new(center.x, center.y + r * 0.15),
                egui::vec2(r * 1.4, r * 1.6),
            );
            painter.rect_stroke(body, 0.0, stroke);
            // Lid above body.
            painter.line_segment(
                [Pos2::new(body.left() - r * 0.2, body.top() - r * 0.15),
                 Pos2::new(body.right() + r * 0.2, body.top() - r * 0.15)],
                stroke,
            );
            // Handle on lid.
            painter.line_segment(
                [Pos2::new(center.x - r * 0.3, body.top() - r * 0.15),
                 Pos2::new(center.x - r * 0.3, body.top() - r * 0.4)],
                stroke,
            );
            painter.line_segment(
                [Pos2::new(center.x + r * 0.3, body.top() - r * 0.15),
                 Pos2::new(center.x + r * 0.3, body.top() - r * 0.4)],
                stroke,
            );
            painter.line_segment(
                [Pos2::new(center.x - r * 0.3, body.top() - r * 0.4),
                 Pos2::new(center.x + r * 0.3, body.top() - r * 0.4)],
                stroke,
            );
        }
    }
}

/// Phosphor icon font integration. Returns the unicode char for a
/// given Phosphor icon name. The consumer renders this as a string
/// using the egui-phosphor font installed via `add_to_fonts`.
///
/// Call `egui_phosphor::add_to_fonts(fonts, egui_phosphor::Variant::Regular)`
/// once at app startup to make these chars available.
pub fn phosphor(name: &str) -> &'static str {
    match name {
        "save" => egui_phosphor::regular::FLOPPY_DISK,
        "open" => egui_phosphor::regular::FOLDER_OPEN,
        "new" => egui_phosphor::regular::FILE_PLUS,
        "undo" => egui_phosphor::regular::ARROW_COUNTER_CLOCKWISE,
        "redo" => egui_phosphor::regular::ARROW_CLOCKWISE,
        "settings" => egui_phosphor::regular::GEAR,
        "search" => egui_phosphor::regular::MAGNIFYING_GLASS,
        "info" => egui_phosphor::regular::INFO,
        "warning" => egui_phosphor::regular::WARNING,
        "close" => egui_phosphor::regular::X,
        _ => egui_phosphor::regular::QUESTION,
    }
}
```

- [ ] **Step 2: Build**

```bash
cd kernel && cargo build --release -p superui 2>&1 | tail -10
```

If `egui-phosphor` const names don't match (the const naming may differ between versions), adjust to whatever the actual crate exports. Run `cargo doc --open -p egui-phosphor` if you need a reference.

- [ ] **Step 3: Commit**

```bash
git add kernel/crates/superui/src/icon.rs
git commit -m "feat(superui): icon module — 10 hand-drawn CAD icons + phosphor bridge"
```

---

## Task 5: `CadButton` primitive (large/medium/small)

**Files:**
- Create: `kernel/crates/superui/src/primitives/button.rs`
- Modify: `kernel/crates/superui/src/primitives/mod.rs`

- [ ] **Step 1: Replace `primitives/mod.rs`**

```rust
//! UI primitives — building blocks shared across all chrome widgets.

pub mod button;

pub use button::CadButton;
```

- [ ] **Step 2: Create `primitives/button.rs`**

```rust
//! `CadButton` — the ribbon's primary button widget. Three size
//! variants (large 66 px, medium 32 px, small 22 px) matching 1.0's
//! `Ribbon.css`.
//!
//! Renders icon + label, supports hover/active/disabled visuals,
//! returns `egui::Response` so callers can chain `.clicked()`.

use crate::icon::{IconKind, paint_icon};
use crate::theme::Theme;
use crate::tokens::metrics;
use egui::{Color32, Response, Sense, Stroke, Ui, Vec2};

/// Variant determines size + label-icon layout.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ButtonSize {
    Large,
    Medium,
    Small,
}

/// Ribbon button. Use the constructor functions to pick size:
/// `CadButton::large(label).icon(IconKind::Line).show(ui)`.
pub struct CadButton<'a> {
    label: &'a str,
    size: ButtonSize,
    icon: Option<IconKind>,
    selected: bool,
    enabled: bool,
}

impl<'a> CadButton<'a> {
    pub fn large(label: &'a str) -> Self { Self::new(label, ButtonSize::Large) }
    pub fn medium(label: &'a str) -> Self { Self::new(label, ButtonSize::Medium) }
    pub fn small(label: &'a str) -> Self { Self::new(label, ButtonSize::Small) }
    fn new(label: &'a str, size: ButtonSize) -> Self {
        Self { label, size, icon: None, selected: false, enabled: true }
    }
    pub fn icon(mut self, k: IconKind) -> Self { self.icon = Some(k); self }
    pub fn selected(mut self, b: bool) -> Self { self.selected = b; self }
    pub fn enabled(mut self, b: bool) -> Self { self.enabled = b; self }

    pub fn show(self, ui: &mut Ui) -> Response {
        let palette = Theme::Default.palette();
        let (size_v, icon_size) = match self.size {
            ButtonSize::Large  => (Vec2::new(66.0, metrics::RIBBON_BUTTON_LARGE), metrics::ICON_LG),
            ButtonSize::Medium => (Vec2::new(110.0, metrics::RIBBON_BUTTON_MEDIUM), metrics::ICON_MD),
            ButtonSize::Small  => (Vec2::new(110.0, metrics::RIBBON_BUTTON_SMALL), metrics::ICON_SM),
        };
        let (rect, response) = ui.allocate_exact_size(size_v, Sense::click());
        let painter = ui.painter();

        // Background fill based on state.
        let bg = if !self.enabled {
            palette.button_bg
        } else if response.is_pointer_button_down_on() {
            palette.button_active
        } else if self.selected {
            palette.button_active
        } else if response.hovered() {
            palette.button_hover
        } else {
            Color32::TRANSPARENT
        };
        if bg != Color32::TRANSPARENT {
            painter.rect_filled(rect, 0.0, bg);
        }

        let fg = if self.enabled { palette.fg } else { palette.fg_dim };

        match self.size {
            ButtonSize::Large => {
                // Icon on top, label below.
                if let Some(k) = self.icon {
                    let icon_rect = egui::Rect::from_center_size(
                        egui::pos2(rect.center().x, rect.top() + icon_size * 0.6 + 6.0),
                        egui::vec2(icon_size, icon_size),
                    );
                    paint_icon(painter, icon_rect, k, fg);
                }
                painter.text(
                    egui::pos2(rect.center().x, rect.bottom() - 14.0),
                    egui::Align2::CENTER_CENTER,
                    self.label,
                    egui::FontId::proportional(11.0),
                    fg,
                );
            }
            ButtonSize::Medium | ButtonSize::Small => {
                // Icon + label horizontal.
                let pad = 6.0_f32;
                let icon_rect = egui::Rect::from_center_size(
                    egui::pos2(rect.left() + pad + icon_size * 0.5, rect.center().y),
                    egui::vec2(icon_size, icon_size),
                );
                if let Some(k) = self.icon {
                    paint_icon(painter, icon_rect, k, fg);
                }
                painter.text(
                    egui::pos2(rect.left() + pad * 2.0 + icon_size, rect.center().y),
                    egui::Align2::LEFT_CENTER,
                    self.label,
                    egui::FontId::proportional(11.0),
                    fg,
                );
            }
        }

        // Subtle 1 px stroke when selected so the active state reads.
        if self.selected {
            painter.rect_stroke(rect, 0.0, Stroke::new(1.0, palette.accent));
        }

        response
    }
}
```

- [ ] **Step 3: Build**

```bash
cd kernel && cargo build --release -p superui 2>&1 | tail -10
```

Expected: green.

- [ ] **Step 4: Commit**

```bash
git add kernel/crates/superui/src/primitives/
git commit -m "feat(superui): CadButton primitive (large/medium/small)"
```

---

## Task 6: `TitleBar` widget

**Files:**
- Create: `kernel/crates/superui/src/layout/title_bar.rs`
- Modify: `kernel/crates/superui/src/layout/mod.rs`

- [ ] **Step 1: Update `layout/mod.rs`**

```rust
//! Layout chrome — TitleBar, Ribbon, FileTabBar, StatusBar.

pub mod title_bar;

pub use title_bar::{TitleBar, TitleBarAction};
```

- [ ] **Step 2: Create `layout/title_bar.rs`**

```rust
//! `TitleBar` widget — top bar with app icon, title text, and Windows
//! controls (minimise / maximise / close). Matches 1.0's TitleBar.tsx.

use crate::theme::Theme;
use crate::tokens::metrics;
use egui::{Sense, Ui, Vec2};

#[derive(Debug, Clone, Copy)]
pub enum TitleBarAction {
    OpenAppMenu,
    Minimize,
    ToggleMaximize,
    Close,
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
        let (rect, _resp) = ui.allocate_exact_size(Vec2::new(avail, height), Sense::hover());
        ui.painter().rect_filled(rect, 0.0, palette.titlebar_bg);

        // 3-region layout: app menu (left), title (center), window controls (right)
        ui.allocate_ui_at_rect(rect, |ui| {
            ui.horizontal_centered(|ui| {
                ui.add_space(4.0);
                // App menu trigger — small square button with hamburger.
                let menu_size = Vec2::new(28.0, height - 4.0);
                let (mrect, mresp) = ui.allocate_exact_size(menu_size, Sense::click());
                if mresp.hovered() {
                    ui.painter().rect_filled(mrect, 0.0, palette.button_hover);
                }
                // Three horizontal lines for hamburger.
                let cx = mrect.center().x;
                let cy = mrect.center().y;
                let bar_w = 14.0;
                for offset in [-5.0, 0.0, 5.0] {
                    ui.painter().line_segment(
                        [egui::pos2(cx - bar_w * 0.5, cy + offset),
                         egui::pos2(cx + bar_w * 0.5, cy + offset)],
                        egui::Stroke::new(1.6, palette.fg),
                    );
                }
                if mresp.clicked() { actions.push(TitleBarAction::OpenAppMenu); }

                ui.add_space(8.0);
                ui.label(egui::RichText::new(self.title).color(palette.fg).size(12.0));

                ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                    // Close button
                    let close_size = Vec2::new(36.0, height);
                    let (crect, cresp) = ui.allocate_exact_size(close_size, Sense::click());
                    let bg = if cresp.hovered() { palette.close_red } else { palette.titlebar_bg };
                    ui.painter().rect_filled(crect, 0.0, bg);
                    let cc = crect.center();
                    let ic = if cresp.hovered() { egui::Color32::WHITE } else { palette.fg };
                    ui.painter().line_segment(
                        [egui::pos2(cc.x - 5.0, cc.y - 5.0), egui::pos2(cc.x + 5.0, cc.y + 5.0)],
                        egui::Stroke::new(1.4, ic),
                    );
                    ui.painter().line_segment(
                        [egui::pos2(cc.x + 5.0, cc.y - 5.0), egui::pos2(cc.x - 5.0, cc.y + 5.0)],
                        egui::Stroke::new(1.4, ic),
                    );
                    if cresp.clicked() { actions.push(TitleBarAction::Close); }

                    // Maximize button
                    let max_size = Vec2::new(36.0, height);
                    let (mxrect, mxresp) = ui.allocate_exact_size(max_size, Sense::click());
                    if mxresp.hovered() {
                        ui.painter().rect_filled(mxrect, 0.0, palette.button_hover);
                    }
                    let mxc = mxrect.center();
                    if self.is_maximized {
                        // Two overlapped rectangles (restore icon)
                        ui.painter().rect_stroke(
                            egui::Rect::from_center_size(egui::pos2(mxc.x + 1.5, mxc.y - 1.5), egui::vec2(8.0, 8.0)),
                            0.0,
                            egui::Stroke::new(1.2, palette.fg),
                        );
                        ui.painter().rect_stroke(
                            egui::Rect::from_center_size(egui::pos2(mxc.x - 1.5, mxc.y + 1.5), egui::vec2(8.0, 8.0)),
                            0.0,
                            egui::Stroke::new(1.2, palette.fg),
                        );
                    } else {
                        ui.painter().rect_stroke(
                            egui::Rect::from_center_size(mxc, egui::vec2(10.0, 10.0)),
                            0.0,
                            egui::Stroke::new(1.2, palette.fg),
                        );
                    }
                    if mxresp.clicked() { actions.push(TitleBarAction::ToggleMaximize); }

                    // Minimize button
                    let min_size = Vec2::new(36.0, height);
                    let (minrect, minresp) = ui.allocate_exact_size(min_size, Sense::click());
                    if minresp.hovered() {
                        ui.painter().rect_filled(minrect, 0.0, palette.button_hover);
                    }
                    let minc = minrect.center();
                    ui.painter().line_segment(
                        [egui::pos2(minc.x - 5.0, minc.y), egui::pos2(minc.x + 5.0, minc.y)],
                        egui::Stroke::new(1.4, palette.fg),
                    );
                    if minresp.clicked() { actions.push(TitleBarAction::Minimize); }
                });
            });
        });
        actions
    }
}
```

- [ ] **Step 3: Build**

```bash
cd kernel && cargo build --release -p superui 2>&1 | tail -10
```

- [ ] **Step 4: Commit**

```bash
git add kernel/crates/superui/src/layout/
git commit -m "feat(superui): TitleBar widget with window controls"
```

---

## Task 7: `Ribbon` shell

**Files:**
- Create: `kernel/crates/superui/src/layout/ribbon.rs`
- Modify: `kernel/crates/superui/src/layout/mod.rs`

- [ ] **Step 1: Add `pub mod ribbon` to layout/mod.rs**

After `pub mod title_bar;` add:
```rust
pub mod ribbon;
pub use ribbon::{Ribbon, RibbonGroup, RibbonAction, RibbonTabId};
```

- [ ] **Step 2: Create `layout/ribbon.rs`**

```rust
//! Ribbon — tab strip + groups + buttons. Data-driven: the consumer
//! provides a list of tabs, each with groups and buttons.

use crate::primitives::CadButton;
use crate::icon::IconKind;
use crate::theme::Theme;
use crate::tokens::metrics;
use egui::{Sense, Ui, Vec2};

pub type RibbonTabId = String;

#[derive(Debug, Clone)]
pub enum RibbonAction {
    TabChanged(RibbonTabId),
    ButtonClicked(String),
}

pub struct RibbonGroup {
    title: String,
    buttons: Vec<RibbonButtonDef>,
}

pub struct RibbonButtonDef {
    pub id: String,
    pub label: String,
    pub icon: IconKind,
    pub size: crate::primitives::button::ButtonSize,
    pub selected: bool,
    pub enabled: bool,
}

impl RibbonGroup {
    pub fn new(title: impl Into<String>) -> Self {
        Self { title: title.into(), buttons: Vec::new() }
    }
    pub fn button(mut self, def: RibbonButtonDef) -> Self {
        self.buttons.push(def);
        self
    }
}

pub struct RibbonTabDef {
    pub id: RibbonTabId,
    pub label: String,
    pub groups: Vec<RibbonGroup>,
}

pub struct Ribbon {
    tabs: Vec<RibbonTabDef>,
    active: RibbonTabId,
}

impl Ribbon {
    pub fn new(tabs: Vec<RibbonTabDef>, active: RibbonTabId) -> Self {
        Self { tabs, active }
    }

    pub fn show(self, ui: &mut Ui) -> Vec<RibbonAction> {
        let mut actions = Vec::new();
        let palette = Theme::Default.palette();

        // Tab strip
        let avail_w = ui.available_width();
        let tab_h = metrics::RIBBON_TAB_HEIGHT;
        let (tab_rect, _) = ui.allocate_exact_size(Vec2::new(avail_w, tab_h), Sense::hover());
        ui.painter().rect_filled(tab_rect, 0.0, palette.ribbon_tab_bg);
        ui.allocate_ui_at_rect(tab_rect, |ui| {
            ui.horizontal_centered(|ui| {
                for tab in &self.tabs {
                    let is_active = tab.id == self.active;
                    let label_w = ui.painter().layout_no_wrap(
                        tab.label.clone(),
                        egui::FontId::proportional(12.0),
                        palette.fg,
                    ).rect.width();
                    let (trect, tresp) = ui.allocate_exact_size(
                        Vec2::new(label_w + 24.0, tab_h),
                        Sense::click(),
                    );
                    let bg = if is_active {
                        palette.ribbon_tab_active_bg
                    } else if tresp.hovered() {
                        palette.button_hover
                    } else {
                        palette.ribbon_tab_bg
                    };
                    ui.painter().rect_filled(trect, 0.0, bg);
                    ui.painter().text(
                        trect.center(),
                        egui::Align2::CENTER_CENTER,
                        &tab.label,
                        egui::FontId::proportional(12.0),
                        palette.fg,
                    );
                    if is_active {
                        ui.painter().line_segment(
                            [trect.left_bottom(), trect.right_bottom()],
                            egui::Stroke::new(2.0, palette.accent),
                        );
                    }
                    if tresp.clicked() && !is_active {
                        actions.push(RibbonAction::TabChanged(tab.id.clone()));
                    }
                }
            });
        });

        // Group strip — render only the active tab's groups
        let group_h = metrics::RIBBON_CONTENT_HEIGHT;
        let (group_rect, _) = ui.allocate_exact_size(Vec2::new(avail_w, group_h), Sense::hover());
        ui.painter().rect_filled(group_rect, 0.0, palette.ribbon_tab_active_bg);
        ui.allocate_ui_at_rect(group_rect, |ui| {
            ui.horizontal(|ui| {
                if let Some(active_tab) = self.tabs.iter().find(|t| t.id == self.active) {
                    for group in &active_tab.groups {
                        ui.add_space(8.0);
                        ui.vertical(|ui| {
                            ui.horizontal(|ui| {
                                for b in &group.buttons {
                                    let resp = match b.size {
                                        crate::primitives::button::ButtonSize::Large =>
                                            CadButton::large(&b.label),
                                        crate::primitives::button::ButtonSize::Medium =>
                                            CadButton::medium(&b.label),
                                        crate::primitives::button::ButtonSize::Small =>
                                            CadButton::small(&b.label),
                                    }
                                    .icon(b.icon)
                                    .selected(b.selected)
                                    .enabled(b.enabled)
                                    .show(ui);
                                    if resp.clicked() {
                                        actions.push(RibbonAction::ButtonClicked(b.id.clone()));
                                    }
                                }
                            });
                            // Group title at bottom
                            ui.label(
                                egui::RichText::new(&group.title)
                                    .size(10.0)
                                    .color(palette.fg_dim),
                            );
                        });
                        ui.add_space(4.0);
                        // 1 px separator after group
                        let sep_x = ui.cursor().left();
                        ui.painter().line_segment(
                            [egui::pos2(sep_x, group_rect.top() + 4.0),
                             egui::pos2(sep_x, group_rect.bottom() - 4.0)],
                            egui::Stroke::new(1.0, palette.border),
                        );
                    }
                }
            });
        });
        actions
    }
}

// Re-export ButtonSize publicly so consumers can build RibbonButtonDef without
// reaching into the primitives module path.
pub use crate::primitives::button::ButtonSize;
```

- [ ] **Step 3: Build**

```bash
cd kernel && cargo build --release -p superui 2>&1 | tail -10
```

- [ ] **Step 4: Commit**

```bash
git add kernel/crates/superui/src/layout/
git commit -m "feat(superui): Ribbon shell with tabs/groups/buttons"
```

---

## Task 8: `FileTabBar` with sloped divider

**Files:**
- Create: `kernel/crates/superui/src/layout/file_tab_bar.rs`
- Modify: `kernel/crates/superui/src/layout/mod.rs`

- [ ] **Step 1: Add `pub mod file_tab_bar` to layout/mod.rs**

```rust
pub mod file_tab_bar;
pub use file_tab_bar::{FileTabBar, FileTabAction, FileTabDef};
```

- [ ] **Step 2: Create `layout/file_tab_bar.rs`**

```rust
//! `FileTabBar` — Chrome-style file tabs with sloped right divider.
//! Click to activate, × to close, + to create. Matches 1.0's
//! FileTabBar component visually.

use crate::theme::Theme;
use crate::tokens::metrics;
use egui::{Sense, Shape, Ui, Vec2, Pos2, Color32};

pub struct FileTabDef {
    pub id: usize,
    pub label: String,
    pub modified: bool,
}

#[derive(Debug, Clone)]
pub enum FileTabAction {
    Activate(usize),
    Close(usize),
    NewTab,
}

pub struct FileTabBar<'a> {
    tabs: &'a [FileTabDef],
    active_id: Option<usize>,
}

impl<'a> FileTabBar<'a> {
    pub fn new(tabs: &'a [FileTabDef]) -> Self {
        Self { tabs, active_id: None }
    }
    pub fn active(mut self, id: usize) -> Self {
        self.active_id = Some(id);
        self
    }

    pub fn show(self, ui: &mut Ui) -> Vec<FileTabAction> {
        let mut actions = Vec::new();
        let palette = Theme::Default.palette();
        let h = metrics::FILETAB_HEIGHT;
        let avail_w = ui.available_width();
        let (bar_rect, _) = ui.allocate_exact_size(Vec2::new(avail_w, h), Sense::hover());
        ui.painter().rect_filled(bar_rect, 0.0, palette.bg);

        ui.allocate_ui_at_rect(bar_rect, |ui| {
            ui.horizontal_centered(|ui| {
                ui.add_space(4.0);
                for tab in self.tabs {
                    let is_active = self.active_id == Some(tab.id);
                    let label_w = (tab.label.chars().count() as f32 * 7.0).max(60.0).min(180.0);
                    let tab_w = label_w + 36.0; // label + close × + slope
                    let (trect, tresp) = ui.allocate_exact_size(
                        Vec2::new(tab_w, h),
                        Sense::click(),
                    );
                    let fill = if is_active {
                        palette.panel_bg
                    } else if tresp.hovered() {
                        palette.button_hover
                    } else {
                        palette.bg
                    };
                    // Sloped right edge — convex polygon
                    let slope = 8.0_f32;
                    let pts = vec![
                        trect.left_top(),
                        Pos2::new(trect.right() - slope, trect.top()),
                        Pos2::new(trect.right(), trect.bottom()),
                        trect.left_bottom(),
                    ];
                    ui.painter().add(Shape::convex_polygon(
                        pts.clone(),
                        fill,
                        egui::Stroke::new(if is_active { 0.0 } else { 1.0 }, palette.border),
                    ));
                    // Active accent line at top
                    if is_active {
                        ui.painter().line_segment(
                            [trect.left_top(), Pos2::new(trect.right() - slope, trect.top())],
                            egui::Stroke::new(2.0, palette.accent),
                        );
                    }
                    // Label
                    let label_text = if tab.modified {
                        format!("● {}", tab.label)
                    } else {
                        tab.label.clone()
                    };
                    ui.painter().text(
                        Pos2::new(trect.left() + 8.0, trect.center().y),
                        egui::Align2::LEFT_CENTER,
                        label_text,
                        egui::FontId::proportional(11.0),
                        palette.fg,
                    );
                    // Close × button
                    let close_rect = egui::Rect::from_center_size(
                        Pos2::new(trect.right() - slope - 8.0, trect.center().y),
                        Vec2::new(14.0, 14.0),
                    );
                    let close_resp = ui.interact(close_rect, ui.id().with(("close", tab.id)), Sense::click());
                    let cc = close_rect.center();
                    let ic = if close_resp.hovered() { palette.fg } else { palette.fg_dim };
                    ui.painter().line_segment(
                        [Pos2::new(cc.x - 4.0, cc.y - 4.0), Pos2::new(cc.x + 4.0, cc.y + 4.0)],
                        egui::Stroke::new(1.2, ic),
                    );
                    ui.painter().line_segment(
                        [Pos2::new(cc.x + 4.0, cc.y - 4.0), Pos2::new(cc.x - 4.0, cc.y + 4.0)],
                        egui::Stroke::new(1.2, ic),
                    );

                    if close_resp.clicked() {
                        actions.push(FileTabAction::Close(tab.id));
                    } else if tresp.clicked() && !is_active {
                        actions.push(FileTabAction::Activate(tab.id));
                    }
                    ui.add_space(2.0);
                }
                // "+" new tab button
                let plus_size = Vec2::new(28.0, h);
                let (prect, presp) = ui.allocate_exact_size(plus_size, Sense::click());
                let pfill = if presp.hovered() { palette.button_hover } else { Color32::TRANSPARENT };
                if pfill != Color32::TRANSPARENT {
                    ui.painter().rect_filled(prect, 0.0, pfill);
                }
                let pc = prect.center();
                ui.painter().line_segment(
                    [Pos2::new(pc.x - 5.0, pc.y), Pos2::new(pc.x + 5.0, pc.y)],
                    egui::Stroke::new(1.4, palette.fg),
                );
                ui.painter().line_segment(
                    [Pos2::new(pc.x, pc.y - 5.0), Pos2::new(pc.x, pc.y + 5.0)],
                    egui::Stroke::new(1.4, palette.fg),
                );
                if presp.clicked() {
                    actions.push(FileTabAction::NewTab);
                }
            });
        });
        actions
    }
}
```

- [ ] **Step 3: Build**

```bash
cd kernel && cargo build --release -p superui 2>&1 | tail -10
```

- [ ] **Step 4: Commit**

```bash
git add kernel/crates/superui/src/layout/
git commit -m "feat(superui): FileTabBar with sloped right divider"
```

---

## Task 9: `StatusBar` with sample sections

**Files:**
- Create: `kernel/crates/superui/src/layout/status_bar.rs`
- Modify: `kernel/crates/superui/src/layout/mod.rs`

- [ ] **Step 1: Add `pub mod status_bar` to layout/mod.rs**

```rust
pub mod status_bar;
pub use status_bar::{StatusBar, StatusSection, StatusBarAction};
```

- [ ] **Step 2: Create `layout/status_bar.rs`**

```rust
//! `StatusBar` — bottom strip with composable sections (coords, zoom,
//! tool, layer count, snap toggles). Sections are data-driven; the
//! consumer builds `Vec<StatusSection>` per frame.

use crate::theme::Theme;
use crate::tokens::metrics;
use egui::{Sense, Ui, Vec2};

#[derive(Debug, Clone)]
pub enum StatusSection {
    Text(String),
    Toggle { label: String, on: bool, id: String },
    Spacer,
}

#[derive(Debug, Clone)]
pub enum StatusBarAction {
    Toggled(String),
}

pub struct StatusBar {
    sections: Vec<StatusSection>,
}

impl StatusBar {
    pub fn new(sections: Vec<StatusSection>) -> Self { Self { sections } }

    pub fn show(self, ui: &mut Ui) -> Vec<StatusBarAction> {
        let mut actions = Vec::new();
        let palette = Theme::Default.palette();
        let h = metrics::STATUSBAR_HEIGHT;
        let avail_w = ui.available_width();
        let (rect, _) = ui.allocate_exact_size(Vec2::new(avail_w, h), Sense::hover());
        ui.painter().rect_filled(rect, 0.0, palette.status_bg);
        ui.allocate_ui_at_rect(rect, |ui| {
            ui.horizontal_centered(|ui| {
                ui.add_space(8.0);
                for section in &self.sections {
                    match section {
                        StatusSection::Text(s) => {
                            ui.label(
                                egui::RichText::new(s)
                                    .size(11.0)
                                    .color(palette.fg_dim),
                            );
                            ui.add_space(12.0);
                        }
                        StatusSection::Toggle { label, on, id } => {
                            let bg = if *on { palette.button_active } else { palette.status_bg };
                            let (trect, tresp) = ui.allocate_exact_size(
                                Vec2::new((label.chars().count() as f32 * 7.0).max(40.0) + 12.0, h - 4.0),
                                Sense::click(),
                            );
                            ui.painter().rect_filled(trect, 0.0, bg);
                            ui.painter().text(
                                trect.center(),
                                egui::Align2::CENTER_CENTER,
                                label,
                                egui::FontId::proportional(11.0),
                                palette.fg,
                            );
                            if tresp.clicked() {
                                actions.push(StatusBarAction::Toggled(id.clone()));
                            }
                            ui.add_space(4.0);
                        }
                        StatusSection::Spacer => {
                            ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |_| {});
                            ui.add_space(8.0);
                        }
                    }
                }
            });
        });
        actions
    }
}
```

- [ ] **Step 3: Build**

```bash
cd kernel && cargo build --release -p superui 2>&1 | tail -10
```

- [ ] **Step 4: Commit**

```bash
git add kernel/crates/superui/src/layout/
git commit -m "feat(superui): StatusBar with composable sections"
```

---

## Task 10: Smoke-build the whole crate from a `kernel-app` reference

**Files:**
- Modify: `kernel/crates/app/Cargo.toml` (add dep, do NOT yet use it)

This task verifies `superui` is consumable from the app crate WITHOUT yet refactoring `open_2d_studio.rs`. We only add the dep and verify the workspace builds.

- [ ] **Step 1: Add `superui` dep to `kernel/crates/app/Cargo.toml`**

In the `[dependencies]` block, add:
```toml
superui = { path = "../ui" }
```

- [ ] **Step 2: Build the whole workspace**

```bash
cd /c/Users/rickd/Documents/GitHub/open-2d-studio/kernel
taskkill //F //IM open_2d_studio.exe 2>/dev/null
cargo build --release --bin open_2d_studio 2>&1 | tail -10
```

Expected: green. The new dep is unused but available — no behavioural change.

- [ ] **Step 3: Smoke-launch**

```bash
./target/release/open_2d_studio.exe 2>/tmp/o2d.log &
sleep 4
tasklist //FI "IMAGENAME eq open_2d_studio.exe" 2>/dev/null | grep open_2d_studio && echo "running"
taskkill //F //IM open_2d_studio.exe 2>/dev/null
```

Expected: process runs 4s, stderr clean, exits cleanly. Same behaviour as before — the new crate is just sitting there, unused.

- [ ] **Step 4: Commit**

```bash
cd /c/Users/rickd/Documents/GitHub/open-2d-studio
git add kernel/crates/app/Cargo.toml
git commit -m "chore(kernel-app): add superui workspace dep (unused yet)"
```

---

## Task 11: Refactor `open_2d_studio.rs` to consume `superui`

> **🚨 GATING CONSTRAINT 🚨**
> 
> Task 11 MUST NOT BEGIN until the text-editor implementation plan's Tasks 8, 9, AND 10 have all been committed. Those tasks edit `open_2d_studio.rs` extensively (EditOp::EditText variant, EditTextState field, F2/double-click handlers, floating overlay).
> 
> **Verification before starting Task 11:**
> ```bash
> cd /c/Users/rickd/Documents/GitHub/open-2d-studio
> git log --oneline merge-1.0-2.0 ^main 2>/dev/null | grep -E "Task 8|Task 9|Task 10|EditOp|EditText|Floating overlay" | head -5
> ```
> If those commits are not yet present, **STOP** and report waiting.

**Files:**
- Modify: `kernel/crates/app/src/bin/open_2d_studio.rs` (replace inline ribbon/titlebar/etc with superui calls)

- [ ] **Step 1: Inventory the current chrome code in open_2d_studio.rs**

```bash
grep -n "fn paint_icon\|fn ribbon_group\|fn big_icon_button\|fn small_icon_label_button\|TopBottomPanel::top.*ribbon\|TopBottomPanel::top.*tabbar\|TopBottomPanel::top.*titlebar\|TopBottomPanel::bottom" /c/Users/rickd/Documents/GitHub/open-2d-studio/kernel/crates/app/src/bin/open_2d_studio.rs | head -20
```

Note line numbers for: ribbon helpers (paint_icon ~235, ribbon_group ~603, big_icon_button ~712, small_icon_label_button ~878), TopBottomPanel calls, and any tab/statusbar code.

- [ ] **Step 2: Add `use superui::...;` imports at the top of the file**

After existing `use` lines:

```rust
use superui::{
    apply_theme, Theme,
    layout::{TitleBar, TitleBarAction, Ribbon, RibbonAction, RibbonTabId, RibbonTabDef, RibbonGroup, RibbonButtonDef, ButtonSize, FileTabBar, FileTabAction, FileTabDef, StatusBar, StatusSection},
    icon::IconKind,
};
```

- [ ] **Step 3: Apply theme once per frame**

In the egui closure (search for `gpu.egui_ctx.run(`), at the very top, add:

```rust
apply_theme(ctx, Theme::Default);
```

- [ ] **Step 4: Replace the inline TitleBar logic with `TitleBar::new(...).show(ui)`**

Find where the menubar/titlebar is currently rendered (existing `TopBottomPanel::top("menubar")` or similar around line 2129 area). Replace its body with:

```rust
egui::TopBottomPanel::top("titlebar")
    .show_separator_line(false)
    .show(ctx, |ui| {
        let actions = TitleBar::new("Open 2D Studio").show(ui);
        for a in actions {
            match a {
                TitleBarAction::OpenAppMenu => { /* trigger app menu */ }
                TitleBarAction::Minimize => { /* call window.set_minimized(true) */ }
                TitleBarAction::ToggleMaximize => { /* toggle */ }
                TitleBarAction::Close => { event_loop_proxy.send(...); /* or similar exit */ }
            }
        }
    });
```

Wire each action to the existing handlers. If those handlers don't exist yet for OS-window controls, leave a `// TODO wire to winit` comment (this is OK for Phase 1 since the window already has OS chrome via decorations).

- [ ] **Step 5: Replace the inline ribbon with `Ribbon::new(...).show(ui)`**

Find the existing `TopBottomPanel::top("ribbon")` (around line 2220 area). Replace with:

```rust
egui::TopBottomPanel::top("ribbon")
    .show(ctx, |ui| {
        let tabs = vec![
            RibbonTabDef {
                id: "files".into(),
                label: "Files".into(),
                groups: vec![
                    RibbonGroup::new("Files")
                        .button(RibbonButtonDef {
                            id: "open".into(),
                            label: "Open".into(),
                            icon: IconKind::Line,  // placeholder; map to FolderOpen via phosphor in v0.1
                            size: ButtonSize::Large,
                            selected: false,
                            enabled: true,
                        })
                        // ... more buttons matching current Files group
                        ,
                ],
            },
            // ... more tabs (Tools, Measure, View, Layout, Help)
        ];
        let actions = Ribbon::new(tabs, "files".into()).show(ui);
        for a in actions {
            match a {
                RibbonAction::TabChanged(id) => { /* update active tab state */ }
                RibbonAction::ButtonClicked(id) => match id.as_str() {
                    "open" => { requested_menu_open_dialog = true; }
                    "save_as_dxf" => { requested_menu_save_as_dxf = true; }
                    // ... map button ids to existing requested_* flags
                    _ => {}
                },
            }
        }
    });
```

The full button mapping must match what the existing code does. Use the existing `requested_*` boolean flags as the action sinks. If any current button doesn't have a clean ID, give it one.

- [ ] **Step 6: Replace inline FileTabBar**

Find existing `TopBottomPanel::top("tabbar")` (around line 2503 area). Replace with:

```rust
egui::TopBottomPanel::top("tabbar")
    .show(ctx, |ui| {
        let tab_defs: Vec<FileTabDef> = self.tabs.iter().enumerate().map(|(i, t)| FileTabDef {
            id: i,
            label: t.label.clone(),
            modified: false, // wire later if dirty-tracking exists
        }).collect();
        let actions = FileTabBar::new(&tab_defs)
            .active(self.active_tab)
            .show(ui);
        for a in actions {
            match a {
                FileTabAction::Activate(i) => { requested_activate_tab = Some(i); }
                FileTabAction::Close(i) => { requested_close_tab = Some(i); }
                FileTabAction::NewTab => { requested_new_tab = true; }
            }
        }
    });
```

- [ ] **Step 7: Replace inline StatusBar**

Find existing status bar code (search `TopBottomPanel::bottom`). Replace with:

```rust
egui::TopBottomPanel::bottom("statusbar")
    .show(ctx, |ui| {
        let sections = vec![
            StatusSection::Text(format!("x: {:.2}  y: {:.2}", self.cursor_world.0, self.cursor_world.1)),
            StatusSection::Text(format!("zoom: {:.3}×", current_zoom)),
            StatusSection::Text(format!("tool: {:?}", self.tool_mode)),
            StatusSection::Spacer,
            StatusSection::Text(format!("layers: {}", layer_count)),
        ];
        let _actions = StatusBar::new(sections).show(ui);
    });
```

Adapt section content to whatever the existing inline status bar shows.

- [ ] **Step 8: Delete dead code**

Once the new chrome works, remove the now-unused inline helpers:
- `fn paint_icon` / `paint_icon_ex`
- `fn ribbon_group` / `ribbon_sep`
- `fn big_icon_button`
- `fn small_icon_label_button(_ex)`
- `fn small_label_stack` / `small_label_grid`
- The `IconId` enum (replaced by `superui::icon::IconKind`)
- The `RIBBON` palette const (replaced by `Theme::Default.palette()`)

These deletions are large (likely 1500+ lines combined). Verify each removal doesn't break the build before continuing.

- [ ] **Step 9: Build + smoke**

```bash
cd kernel
taskkill //F //IM open_2d_studio.exe 2>/dev/null
cargo build --release --bin open_2d_studio 2>&1 | tail -10
./target/release/open_2d_studio.exe 2>/tmp/o2d_t11.log &
sleep 4
tasklist //FI "IMAGENAME eq open_2d_studio.exe" 2>/dev/null | grep open_2d_studio && echo "running"
taskkill //F //IM open_2d_studio.exe 2>/dev/null
```

Expected: process runs, ribbon/titlebar/tabs/status all rendered via `superui`, visually matching pre-refactor (modulo small spacing differences).

- [ ] **Step 10: Take a screenshot for visual verification**

```powershell
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$p = Get-Process open_2d_studio -ErrorAction SilentlyContinue
if (-not $p) { Write-Error "not running"; exit 1 }
$h = $p.MainWindowHandle
Add-Type @"
using System; using System.Runtime.InteropServices;
public class W { [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r); [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L,T,R,B; } }
"@
$r = New-Object W+RECT; [W]::GetWindowRect($h, [ref]$r) | Out-Null
$w = $r.R-$r.L; $ht = $r.B-$r.T
$bmp = New-Object System.Drawing.Bitmap $w, $ht
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($r.L, $r.T, 0, 0, (New-Object System.Drawing.Size $w, $ht))
$bmp.Save("C:\Users\rickd\AppData\Local\Temp\o2d_superui.png", [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose(); $bmp.Dispose()
```

Save artifact path for user review.

- [ ] **Step 11: Commit**

```bash
git add kernel/crates/app/src/bin/open_2d_studio.rs
git commit -m "refactor(open_2d_studio): chrome via superui (TitleBar/Ribbon/FileTabBar/StatusBar)"
```

---

## Self-Review Results

**Spec coverage:**
- ✅ Crate name `superui` (Task 1)
- ✅ Single fat crate with feature flags (Task 1: `default = ["layout"]`, others reserved)
- ✅ Theme tokens — Default palette only (Task 2)
- ✅ Spacing/metrics/typography tokens (Task 3)
- ✅ 10 hand-drawn CAD icons (Task 4)
- ✅ egui-phosphor bridge (Task 4)
- ✅ CadButton large/medium/small (Task 5)
- ✅ TitleBar (Task 6)
- ✅ Ribbon (Task 7)
- ✅ FileTabBar with sloped divider (Task 8)
- ✅ StatusBar (Task 9)
- ✅ Workspace integration (Task 10)
- ✅ open_2d_studio refactor (Task 11, gated)
- ✅ EN strings (default in code)
- ❌ egui_dock — explicitly deferred to Phase C, not Phase 1; noted in plan header

**Placeholder scan:** Task 11 Step 5 has `// TODO wire to winit` comment and `// ... more buttons` shorthand — these are intentional flexibility for the implementer because the exact ribbon-button list is data already in the existing open_2d_studio.rs and porting it 1-to-1 is mechanical. The implementer reads the existing button list and reproduces it via `RibbonButtonDef`. Acceptable plan-level guidance.

**Type consistency:** `RibbonTabId = String`, `Theme::Default`, `Palette` fields, `IconKind` variants, `CadButton::large/medium/small`, `ButtonSize` enum used consistently across Tasks 4-7-8-11. `ButtonSize` re-exported from `ribbon.rs` AND `primitives::button` for builder ergonomics.

**Scope:** 11 tasks. Tasks 1-9 build the crate isolated (no app-side changes). Task 10 wires dep without using it. Task 11 is the integration step gated on text-editor work. Branch remains functional after each commit (the binary keeps building because Tasks 1-10 don't touch open_2d_studio.rs at all).

**Risks called out:**
- Task 4 — egui-phosphor const naming may differ from plan; agent must use cargo doc.
- Task 7 — Ribbon has many small details (group separator, tab underline, content-area background). Visual may need tweaks after first launch.
- Task 11 — large refactor; deletion of ~1500 LOC. Test build between each helper-removal so a regression is bisectable.
