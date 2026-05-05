# Open 2D Studio — Rust UI Crate Design

> **Status:** DESIGN ONLY — awaiting user approval. No code is to be written from this document. Implementation will be planned and executed in separate sessions after sign-off.
>
> **Date:** 2026-05-01
> **Branch:** `merge-1.0-2.0`
> **Author:** Claude (Opus 4.7)

---

## 1. Goal

Port the Open 2D Studio 1.0 React UI (lives in `src/components/`) to a standalone Rust crate that the existing 2.0 `open_2d_studio` binary (and any future Rust binaries) can consume. The crate must:

- Reproduce 1.0's visual design pixel-perfect (DevExpress-style ribbon, dark themes, custom title bar, file tabs, status bar, side panels, modal dialogs).
- Be implemented on top of `egui` (already pulled in via `egui_wgpu` in `kernel/crates/app/src/bin/open_2d_studio.rs`).
- Expose stateful, retained-mode-friendly widgets via thin builder structs and action enums — *not* push global state into the crate.
- Ship a theme/token layer that maps 1.0's CSS custom properties (`--theme-*`) to an `egui::Style` per active theme.
- Be free of any business logic from 1.0's `services/`, `state/`, `engine/` (those become a separate `kernel-state` story later).

**Non-goals:**
- 1:1 line port of every dialog. Some 1.0 dialogs (BeamDialog, WallTypesDialog, DrawingStandardsDialog, PrintDialog) are domain-specific 800-1500 LOC behemoths whose Rust equivalents will likely need a redesign and are deferred.
- Web-only widgets (xterm.js terminal, alasql query runner, browser-native print preview) — alternatives are flagged in §6.
- Touch/tablet variant (`src/components/tablet/`) — out of scope for the desktop port.

---

## 2. 1.0 UI Inventory

Below is every component file under `src/components/` with its role and a rough LOC count. Priority column: **A** = required for a usable shell, **B** = needed for a comparable feature set, **C** = nice-to-have / domain-specific / risky.

### 2.1 Layout (chrome) — `src/components/layout/`

| Component | File | Purpose | LOC | Priority |
|---|---|---|---:|:---:|
| TitleBar | `TitleBar/TitleBar.tsx` | Custom OS-style title bar with window controls, app menu trigger, version label | 518 | **A** |
| Ribbon | `Ribbon/Ribbon.tsx` | Multi-tab ribbon: Home, Insert, Annotate, Modify, View, Manage, IFC, Extensions | 1514 | **A** |
| RibbonComponents | `Ribbon/RibbonComponents.tsx` | Internal: RibbonButton (large/medium/small), RibbonGroup, dropdown, tooltip | 266 | **A** |
| QuickAccessBar | `Ribbon/QuickAccessBar.tsx` | Save/Undo/Redo strip in title bar | 102 | **A** |
| SelectionFilterBar | `Ribbon/SelectionFilterBar.tsx` | Chip-row of selectable entity-type filters | 174 | B |
| FileTabBar | `FileTabBar/FileTabBar.tsx` | Browser-style document tabs (sloped right divider) | 275 | **A** |
| StatusBar | `StatusBar/StatusBar.tsx` | Bottom strip: layer selector, coords, snap toggles, scale, terminal toggle | 740 | **A** |
| Toolbar | `Toolbar/Toolbar.tsx` | Floating mini-toolbar (legacy, mostly superseded by ribbon) | 142 | C |
| CommandPalette | `CommandPalette/CommandPalette.tsx` | Ctrl+P fuzzy command launcher | 326 | B |

**Subtotal:** 4 057 LOC, 9 files.

### 2.2 Canvas overlays — `src/components/canvas/`

| Component | File | Purpose | LOC | Priority |
|---|---|---|---:|:---:|
| Canvas | `Canvas.tsx` | The HTML5 canvas host — rendering pipeline, pointer events | 1434 | n/a (2.0 has wgpu canvas) |
| ToolOptionsBar | `ToolOptionsBar/ToolOptionsBar.tsx` | Per-tool option strip below ribbon | 1140 | B |
| DynamicInput | `DynamicInput/DynamicInput.tsx` | AutoCAD-style at-cursor numeric input | 1303 | B |
| ShortcutHUD | `ShortcutHUD.tsx` | Floating shortcut hints overlay | 203 | C |

**Subtotal:** 4 080 LOC, 4 files. `Canvas.tsx` is **not** ported — 2.0 already owns rendering via wgpu.

### 2.3 Panels (sidebars) — `src/components/panels/`

| Component | File | Purpose | LOC | Priority |
|---|---|---|---:|:---:|
| RightPanelLayout | `RightPanelLayout.tsx` | Container that swaps active right panel | 11 | **A** |
| NavigationPanel | `NavigationPanel.tsx` | Project/sheets/drawings tree | 156 | **A** |
| PropertiesPanel | `PropertiesPanel.tsx` | Selection inspector wrapper | 134 | **A** |
| ShapeProperties | `properties/ShapeProperties.tsx` | Per-entity property fields (huge switch) | 2695 | B |
| ToolProperties | `properties/ToolProperties.tsx` | Active-tool option fields | 1401 | B |
| TypeSelector | `properties/TypeSelector.tsx` | Wall/Beam/Pile type chooser | 1935 | C |
| PropertyFields | `properties/PropertyFields.tsx` | Reusable form field primitives | 457 | **A** |
| DrawingPropertiesPanel | `DrawingPropertiesPanel.tsx` | Per-drawing settings | 303 | B |
| SheetPropertiesPanel | `SheetPropertiesPanel.tsx` | Per-sheet settings | 553 | B |
| DrawingsTab | `DrawingsTab.tsx` | Tabbed drawings list | 232 | B |
| SheetsTab | `SheetsTab.tsx` | Tabbed sheets list | 391 | B |
| CalculationsTab | `CalculationsTab.tsx` | Live calc display | 120 | C |
| QueriesTab | `QueriesTab.tsx` | alasql query runner | 328 | C (web-only dep) |
| PilePlanTab | `PilePlanTab.tsx` | Pile-plan summary | 117 | C |
| ParameterPanel | `ParameterPanel.tsx` | Parametric object parameter editor | 155 | B |
| FormulaInput | `FormulaInput.tsx` | Expression input for parametric values | 207 | B |
| ComponentLibraryPanel | `ComponentLibraryPanel.tsx` | Reusable-component browser | 427 | C |
| ComponentEditorOverlay | `ComponentEditorOverlay.tsx` | In-place component editor | 129 | C |
| IfcPanel | `IfcPanel.tsx` | IFC tree side panel | 158 | B |
| IfcDashboard | `IfcDashboard.tsx` | Full-canvas IFC overview | 952 | C |

**Subtotal:** 10 861 LOC, 20 files.

### 2.4 Dialogs (modals) — `src/components/dialogs/`

| Component | File | Purpose | LOC | Priority |
|---|---|---|---:|:---:|
| AboutDialog | `AboutDialog/AboutDialog.tsx` | Version/credits | 48 | **A** |
| AppMenu | `AppMenu/AppMenu.tsx` | File menu (New/Open/Save/Recent/Settings) | 897 | **A** |
| ExtensionCard | `AppMenu/ExtensionCard.tsx` | One row in extension manager | 142 | C |
| ExtensionManagerPanel | `AppMenu/ExtensionManagerPanel.tsx` | Extension toggles | 286 | C |
| SettingsDialog (+ 4 tabs) | `SettingsDialog/*` | Global app settings (Display/Grid/Units/DrawingAids) | 599 | B |
| FeedbackDialog | `FeedbackDialog/FeedbackDialog.tsx` | Send-feedback form | 355 | C |
| FindReplaceDialog | `FindReplaceDialog/FindReplaceDialog.tsx` | Text find/replace | 360 | B |
| ScaleSettingsDialog | `ScaleSettingsDialog/ScaleSettingsDialog.tsx` | Drawing-scale chooser | 144 | B |
| GridlineDialog | `GridlineDialog/GridlineDialog.tsx` | Add gridlines | 107 | B |
| MaterialsDialog | `MaterialsDialog/MaterialsDialog.tsx` | Material library | 120 | C |
| NewSheetDialog | `NewSheetDialog/NewSheetDialog.tsx` | Create sheet from template | 677 | B |
| PdfUnderlayDialog | `PdfUnderlayDialog/PdfUnderlayDialog.tsx` | Place PDF underlay | 179 | C |
| PileDialog | `PileDialog/PileDialog.tsx` | Single pile editor | 87 | C |
| PileSymbolsDialog | `PileSymbolsDialog/PileSymbolsDialog.tsx` | Pile symbol picker | 621 | C |
| PrintDialog | `PrintDialog/PrintDialog.tsx` (+4 helpers) | Multi-sheet print/PDF export | 2138 | C |
| ProjectInfoDialog | `ProjectInfoDialog/ProjectInfoDialog.tsx` | Project metadata | 475 | B |
| ProjectStructureDialog | `ProjectStructureDialog/ProjectStructureDialog.tsx` | Sheets/drawings restructure | 434 | C |
| TitleBlockEditor | `TitleBlockEditor/TitleBlockEditor.tsx` | SVG-titleblock visual editor | 667 | C |
| TitleBlockImportDialog | `TitleBlockImportDialog/TitleBlockImportDialog.tsx` | Import SVG titleblock | 591 | C |
| BeamDialog | `BeamDialog/BeamDialog.tsx` | Steel beam picker | 1289 | C |
| WallDialog | `WallDialog/WallDialog.tsx` | Wall placement options | 325 | C |
| WallSystemDialog | `WallSystemDialog/WallSystemDialog.tsx` | Multi-wall system editor | 831 | C |
| WallTypesDialog | `WallTypesDialog/WallTypesDialog.tsx` | Wall-type CRUD | 1558 | C |
| DrawingStandardsDialog | `DrawingStandardsDialog/DrawingStandardsDialog.tsx` | Layers/linetypes/text-styles editor | 1194 | C |
| SectionDialog | `SectionDialog/SectionDialog.tsx` | Section-cut placement | 666 | C |
| PlateSystemDialog | `PlateSystemDialog/PlateSystemDialog.tsx` | Plate-system editor | 543 | C |
| SheetSelectionDialog | `PrintDialog/SheetSelectionDialog.tsx` | Pick sheets to print | 74 | C |

**Subtotal:** ~14 335 LOC, 28 files.

### 2.5 Editors (specialised) — `src/components/editors/`

| Component | File | Purpose | LOC | Priority |
|---|---|---|---:|:---:|
| FilledRegionTypeManager | `FilledRegionTypeManager.tsx` | Hatch-region type CRUD | 452 | C |
| TextEditor | `TextEditor/TextEditor.tsx` | In-canvas text editor | 387 | B |
| TextStyleManager | `TextStyleManager/TextStyleManager.tsx` | Text-style library | 657 | C |
| TitleBlockFieldEditor | `TitleBlockFieldEditor/TitleBlockFieldEditor.tsx` | Inline titleblock field editor | 135 | C |
| SymbolPalette | `SymbolPalette/SymbolPalette.tsx` | Symbol picker grid | 276 | B |
| TerminalPanel | `TerminalPanel/TerminalPanel.tsx` | xterm.js terminal | 612 | C (web-only dep) |
| ErrorLogPanel | `TerminalPanel/ErrorLogPanel.tsx` | Errors tab in terminal | 163 | B |
| ErrorLogEntry | `TerminalPanel/ErrorLogEntry.tsx` | Single log row | 35 | B |
| PatternManagerDialog | `PatternManager/PatternManagerDialog.tsx` | Hatch-pattern library | 886 | C |
| PatternEditorDialog | `PatternManager/PatternEditorDialog.tsx` | Edit one pattern | 397 | C |
| PatternPickerPanel | `PatternManager/PatternPickerPanel.tsx` | Pattern picker | 356 | C |
| PatternPreview | `PatternManager/PatternPreview.tsx` | Pattern thumbnail | 251 | C |
| LineFamilyEditor | `PatternManager/LineFamilyEditor.tsx` | Linetype editor | 324 | C |
| SvgPatternImportDialog | `PatternManager/SvgPatternImportDialog.tsx` | SVG → pattern importer | 409 | C |

**Subtotal:** ~5 340 LOC, 14 files.

### 2.6 Shared primitives — `src/components/shared/`

| Component | File | Purpose | LOC | Priority |
|---|---|---|---:|:---:|
| CadIcons | `CadIcons.tsx` | Custom SVG icon set (LineIcon, ArcIcon, HatchIcon, etc.) | 1435 | **A** |
| DraggableModal | `DraggableModal.tsx` | Modal frame with drag-handle | 204 | **A** |
| ScaleSelector | `ScaleSelector.tsx` | 1:50 / 1:100 dropdown | 231 | **A** |
| ContextMenu | `ContextMenu/ContextMenu.tsx` | Right-click menu | 180 | **A** |

**Subtotal:** 2 050 LOC, 4 files.

### 2.7 Totals

- **9 categories**, **79 component files** (excluding non-`.tsx` helpers and the touch/tablet variants).
- **~40 700 LOC** of TypeScript/React.
- **Priority A (must port for a working shell):** 14 components, ~5 100 LOC equivalent.
- **Priority B:** ~25 components, ~13 000 LOC.
- **Priority C:** ~40 components, ~22 600 LOC.

---

## 3. Design Tokens

Extracted from `src/styles/globals.css` and `src/components/layout/Ribbon/Ribbon.css`.

### 3.1 Themes (7 in 1.0)

| Theme | bg | surface | accent | text |
|---|---|---|---|---|
| `default` (warm dark brown) | `#3E3636` | `#4A4242` | `#D97706` | `#F5F0EB` |
| `dark` | `#1A1A2E` | `#16213E` | `#A82D6E` | `#EAEAEA` |
| `light` | `#F5F5F5` | `#FFFFFF` | `#A82D6E` | `#1F2937` |
| `blue` (DevExpress) | `#0D1B2A` | `#1B263B` | `#0077B6` | `#E0E1DD` |
| `amber-navy` | `#1A1A2E` | `#242445` | `#D97706` | `#C4B199` |
| `deep-forge` | `#36363E` | `#44444C` | `#D97706` | `#FAFAF9` |
| `highContrast` | `#000000` | `#0A0A0A` | `#FFFF00` | `#FFFFFF` |

Each theme defines 21 CSS variables. Mapping plan:

```
Theme {
    bg, surface, surface_elevated,
    border, border_light,
    accent, accent_hover,
    text, text_dim, text_muted,
    grid, grid_major,
    input_bg, hover, active, active_border,
    dropdown_bg,
    scrollbar_track, scrollbar_thumb,
    ribbon_bg_top, ribbon_bg_bottom,         // gradient endpoints
    ribbon_tab_bg_top, ribbon_tab_bg_bottom,
    ribbon_content_bg,
    file_tab_bg, file_tab_hover,
}
```

CSS gradients (`linear-gradient(to bottom, A 0%, B 100%)`) map to two-stop vertical gradients painted manually with `egui::Painter::rect_filled` + a second pass with alpha blend, *or* approximated by a flat colour (the gradient is subtle in most themes — flat is acceptable for v0).

### 3.2 Typography

- Family: `Inter, system-ui, Avenir, Helvetica, Arial, sans-serif` (UI). Tooltips/inputs use `'Segoe UI', system-ui`. Monospace stat values use `Consolas, Monaco, Courier New`. CAD font (drawn into the canvas, not UI) is `Osifont`, ISO 3098 — already handled by `kernel-app` and out of scope here.
- Sizes (px):
  - 9 — micro labels (group labels, IFC tree badges, theme labels).
  - 10 — small labels, status-bar values, IFC stats, tab body.
  - 11 — medium-button labels, dropdown items, theme dropdown.
  - 12 — ribbon-tab labels, tooltips, dashboard title.
  - 14 — dialog titles.
- Weights: 400 normal, 500 medium (labels), 600 semibold (active tab, file-tab, dialog titles).
- Letter-spacing: `0.3px` on uppercase mini-labels.

### 3.3 Spacing system

| Token | px |
|---|---:|
| `XXS` | 1 |
| `XS` | 2 |
| `S` | 4 |
| `M` | 6 |
| `L` | 8 |
| `XL` | 12 |
| `XXL` | 16 |

Most paddings are 2-8 px. `egui::Margin` will use these.

### 3.4 Border radius

- `0` — modal title bars, status-bar chips
- `2` — small dropdowns, selection chips
- `3` — most buttons, inputs
- `4` — ribbon buttons, dropdowns
- `6` — info popovers
- `8` — selection-filter chips

Most components prefer **3-4 px** — modest rounding consistent with DevExpress aesthetic. No fully-rounded buttons.

### 3.5 Elevation / shadow

- Tooltip / dropdown: `0 4px 12px rgba(0, 0, 0, 0.3)`
- Ribbon expand panel: `0 3px 6px rgba(0, 0, 0, 0.08)`
- Info popover: `0 8px 24px rgba(0, 0, 0, 0.35)`

In egui shadows are blurry and slow. Plan: render shadows as a single subtly-darker rect under the popup; full Gaussian blur is not worth the cost.

### 3.6 Heights / sizes (key UI metrics)

| Element | Height |
|---|---:|
| Title bar | ~32 px |
| Ribbon tab strip | 28 px |
| Ribbon content strip | 94 px |
| Ribbon large button | 66 px (54 wide) |
| Ribbon medium button | 32 px |
| Ribbon small button | 22 px |
| File tab bar | ~28 px |
| Status bar | ~24 px |
| Tool options bar | ~32 px |

These become public constants in the `tokens` module.

---

## 4. Architecture Choice

### 4.1 Three options considered

**Option A — Single fat crate `kernel-ui`.**
All components in one Cargo crate as siblings under `src/`. Pros: simplest dep tree, one Cargo.toml, one version, easy to rename/move things. Cons: every UI tweak rebuilds the entire UI; one giant crate balloon to ~40 KLOC of Rust over time; weak encapsulation invites accidental cross-deps between unrelated modules.

**Option B — Split into 4 crates.**
`kernel-ui-tokens`, `kernel-ui-primitives`, `kernel-ui-layout`, `kernel-ui-panels`, `kernel-ui-dialogs`. Pros: explicit dep graph, parallel compilation per crate, clear ownership. Cons: 5+ Cargo.toml files to keep version-locked, friction when refactoring across crate boundaries (which is common during bring-up), and egui's `Style`/`Context` plumbing wants a single owner.

**Option C — One crate, feature flags.**
`kernel-ui` with features `layout` (default), `panels` (default), `dialogs` (default), `editors` (off-by-default), `command-palette` (off-by-default). Consumers can opt in. Pros: one Cargo.toml, fast incremental compiles when working in one feature, clean compile-out of unused code in slim binaries. Cons: feature-flag combinatorics; CI must build the feature matrix; some IDE flows confuse with conditionally-compiled modules.

### 4.2 Recommendation: **Option C — single crate `kernel-ui`, feature-gated.**

Reasoning:

1. We're early. Boundaries between `layout`, `panels`, `dialogs` are still being discovered. A single crate lets us refactor freely without inter-crate API thrash.
2. Feature flags scale: when a sub-area gets stable and large (e.g. `editors`), we can split it out into its own crate without breaking consumers — change `kernel-ui = { features = ["editors"] }` to `kernel-ui-editors = { ... }`.
3. egui `Style` setup, theme application, and font loading want to happen exactly once. A single crate gives us one obvious place to do that (`kernel_ui::theme::apply(ctx, theme)`).
4. Compile times: egui compiles fast already; a 40-KLOC pure-Rust crate (no proc-macros) builds in seconds in release-incremental.

**Proposed crate layout** (no files yet — design only):

```
kernel/crates/ui/
├── Cargo.toml          # name = "kernel-ui"
└── src/
    ├── lib.rs          # re-exports + apply_theme entry
    ├── tokens/         # mod tokens
    │   ├── mod.rs
    │   ├── theme.rs    # Theme enum + Palette struct + 7 presets
    │   ├── typography.rs
    │   ├── spacing.rs
    │   └── metrics.rs  # ribbon heights, button sizes
    ├── primitives/     # mod primitives
    │   ├── mod.rs
    │   ├── button.rs   # CadButton (large/medium/small variants)
    │   ├── icon.rs     # IconAtlas + cad_icons module (port of CadIcons.tsx)
    │   ├── input.rs    # CadTextEdit, CadNumeric, CadColor
    │   ├── dropdown.rs # CadDropdown
    │   ├── tooltip.rs  # custom-styled tooltip with shortcut chip
    │   ├── chip.rs     # Selection filter chip
    │   ├── modal.rs    # DraggableModal port
    │   ├── context_menu.rs
    │   ├── scale_selector.rs
    │   └── tree.rs     # IFC-tree-style nested list
    ├── layout/         # feature = "layout" (default)
    │   ├── mod.rs
    │   ├── title_bar.rs
    │   ├── ribbon/
    │   │   ├── mod.rs
    │   │   ├── tab_strip.rs
    │   │   ├── group.rs
    │   │   ├── button.rs
    │   │   ├── expand_panel.rs
    │   │   ├── quick_access.rs
    │   │   └── selection_filter.rs
    │   ├── file_tab_bar.rs
    │   ├── status_bar.rs
    │   ├── tool_options_bar.rs
    │   └── command_palette.rs
    ├── panels/         # feature = "panels" (default)
    │   ├── mod.rs
    │   ├── right_panel_layout.rs
    │   ├── navigation.rs
    │   ├── properties.rs       # PropertiesPanel shell
    │   ├── property_fields.rs
    │   ├── drawings_tab.rs
    │   ├── sheets_tab.rs
    │   ├── ifc_panel.rs
    │   └── parameter.rs
    ├── dialogs/        # feature = "dialogs" (default)
    │   ├── mod.rs
    │   ├── app_menu.rs
    │   ├── about.rs
    │   ├── settings.rs         # tabbed settings host
    │   ├── new_sheet.rs
    │   ├── find_replace.rs
    │   ├── scale_settings.rs
    │   ├── feedback.rs
    │   ├── project_info.rs
    │   └── gridline.rs
    └── editors/        # feature = "editors" (off by default)
        ├── mod.rs
        ├── text.rs
        ├── error_log.rs
        ├── symbol_palette.rs
        └── pattern_picker.rs
```

Feature plan in Cargo.toml (sketch, non-binding):

```
[features]
default = ["layout", "panels", "dialogs"]
layout  = []
panels  = []
dialogs = []
editors = []
all     = ["layout", "panels", "dialogs", "editors"]
```

`tokens` and `primitives` are always compiled; they're the foundation.

---

## 5. Component-by-Component Port Plan

Each port goes through three steps: (a) **interface** (function signature, state struct, action enum); (b) **visual** (egui-painted look matching 1.0); (c) **integration sample** in `open_2d_studio` binary.

Port phases (user picks which one to start):

### Phase A — Tokens & primitives (foundation; required for everything else)

| 1.0 component | Rust API sketch |
|---|---|
| CSS `--theme-*` | `pub enum Theme { Default, Dark, Light, Blue, AmberNavy, DeepForge, HighContrast }` → `Theme::palette() -> Palette` and `kernel_ui::theme::apply(&egui::Context, Theme)` |
| Tailwind utility classes | `mod spacing { pub const XS: f32 = 2.0; ... }` and `mod metrics { pub const RIBBON_TAB_HEIGHT: f32 = 28.0; ... }` |
| `CadIcons.tsx` (custom CAD icons) | `mod icon` exposing `IconKind` enum + `Icon::paint(painter, rect, color)` for vector-drawn icons (LineIcon, ArcIcon, HatchIcon, FilletIcon, etc. — the lucide-react equivalents come from the `egui-phosphor` or `lucide` font crate) |
| `DraggableModal.tsx` | `pub struct ModalFrame { title: String, draggable: bool, .. }` with `fn show<R>(ui, &mut state, contents: impl FnOnce(&mut Ui) -> R) -> Option<R>` |
| `ContextMenu.tsx` | builder `ContextMenu::new().item(label, on_click).separator().show(...)` |
| `ScaleSelector.tsx` | dropdown returning `Option<Scale>` |
| Generic button/input primitives (was implicit across components) | `CadButton::large(label).icon(icon).active(b).enabled(e).show(ui) -> Response`; `CadButton::medium`; `CadButton::small`; `CadDropdown<T>`; `CadNumericInput` with mm/inch parsing; `Chip::selectable(...)` |

**Estimated effort:** 1.5–2 weeks for one engineer.

### Phase B — Chrome (TitleBar, Ribbon, FileTabBar, StatusBar)

| 1.0 component | Rust API sketch |
|---|---|
| `TitleBar.tsx` | `TitleBar::new(version, app_name).platform(Platform::Windows).show(ui, &mut state) -> Vec<TitleBarAction>` where `TitleBarAction = Minimize \| Maximize \| Close \| OpenAppMenu \| ...` |
| `Ribbon.tsx` + `RibbonComponents.tsx` | `Ribbon::new().tab("Home", \|ui, ev\| { ... }).tab("Insert", ...).show(ui, &mut state) -> Vec<RibbonAction>`. `RibbonGroup::new("Draw").button(...).expandable(true).show(ui)`. `RibbonAction = ToolSelected(ToolKind) \| Command(CommandId) \| TabChanged(TabId)` |
| `QuickAccessBar.tsx` | `QuickAccessBar::new().item(Save).item(Undo).item(Redo).show(ui)` |
| `FileTabBar.tsx` | `FileTabBar::new(&tabs).active(active_id).on_close(...).show(ui) -> Vec<FileTabAction>` |
| `StatusBar.tsx` | composed of mini-widgets: `LayerSelectorMini`, `CoordReadout`, `SnapToggles`, `ScaleReadout`, `TerminalToggle`. Top-level `StatusBar::new().section(...).section(...).show(ui)` |
| `ToolOptionsBar.tsx` | per-tool option strip — render is tool-driven; UI crate provides `ToolOptionsBar` host that takes a closure and lays out option chips/inputs in a row |
| `CommandPalette.tsx` | `CommandPalette::new(commands).filter(query).show(ctx) -> Option<CommandId>`; commands list is owned by the consumer |
| `SelectionFilterBar.tsx` | row of `Chip::selectable` widgets bound to a `SelectionFilter` bitset |

**State pattern** for chrome widgets: each widget has a small `pub struct FooState` the consumer owns (active tab, dropdown-open booleans, hover state), and the widget returns an action vector. No `Rc<RefCell>` or globals.

**Estimated effort:** 3–4 weeks. Ribbon alone is dense but most of its 1500 LOC is data (button definitions per tab) — that data can live in the consumer.

### Phase C — Panels

Priority subset: `RightPanelLayout`, `NavigationPanel`, `PropertiesPanel` shell, `PropertyFields` primitives, `DrawingsTab`, `SheetsTab`, `IfcPanel`, `ParameterPanel`.

`PropertyFields.tsx` becomes a small Rust module with `pub fn text_field(ui, label, value)`, `pub fn numeric_field`, `pub fn color_field`, `pub fn boolean_field`, `pub fn select_field<T>(...)`. The huge `ShapeProperties.tsx` and `ToolProperties.tsx` (4 100 LOC combined) are *consumer code* — they wire 1.0's domain types to `PropertyFields`. The crate provides the building blocks; the binary writes the panels.

`IfcDashboard.tsx` (952 LOC, full-canvas overlay) is **deferred to Phase E** because it's tightly coupled to web-ifc model data. The crate may grow an `ifc_dashboard_chrome` host that takes a closure for the body; the body lives in the binary.

**Estimated effort:** 3 weeks for the listed subset. The deep property-editor work belongs in the consumer.

### Phase D — Dialogs

Priority subset: `AppMenu`, `AboutDialog`, `SettingsDialog` (with 4 tabs), `FindReplaceDialog`, `ScaleSettingsDialog`, `NewSheetDialog`, `FeedbackDialog`, `ProjectInfoDialog`, `GridlineDialog`.

Pattern: each dialog is a struct with `show(ctx, &mut state) -> DialogOutcome`. Modal-mode is handled by the crate (`ModalFrame` from primitives). Buttons return a `DialogAction` enum: `Apply(T) | Cancel | Close`.

Domain-heavy dialogs **deferred**: BeamDialog, WallTypesDialog, WallSystemDialog, DrawingStandardsDialog, PrintDialog, TitleBlockEditor, PatternManagerDialog, SectionDialog, PlateSystemDialog, PileSymbolsDialog. These mix ~10K LOC of business rules with UI; rewriting them in Rust is a per-domain project, not a UI port. They become Phase F+ once the underlying Rust kernel state for those domains exists.

**Estimated effort:** 3 weeks for the listed Phase D subset.

### Phase E — Specialised editors

Priority subset: `TextEditor`, `ErrorLogPanel`, `ErrorLogEntry`, `SymbolPalette`. Out of scope: `TerminalPanel` (xterm.js), `PatternManager*`, `TextStyleManager`, `TitleBlockFieldEditor`, `FilledRegionTypeManager` — see §6.

**Estimated effort:** 2 weeks for the listed Phase E subset.

### Total rough estimate

| Phase | Weeks |
|---|---:|
| A — tokens/primitives | 1.5–2 |
| B — chrome | 3–4 |
| C — panels (priority subset) | 3 |
| D — dialogs (priority subset) | 3 |
| E — editors (priority subset) | 2 |
| **Total to a feature-comparable shell** | **12–14 weeks (one engineer)** |

This buys ~70% of 1.0's UI surface in Rust. The remaining 30% (deferred domain dialogs) is best done alongside their Rust domain models.

---

## 6. Risks & Open Questions

### 6.1 Web-only dependencies — need a Rust replacement strategy

| 1.0 dep | Where used | Rust path |
|---|---|---|
| **xterm.js** | `TerminalPanel.tsx` | Replace with a custom egui terminal: `egui_terminal` crate, or a simple log-tail widget. Real PTY out of scope — it's cosmetic. |
| **alasql** | `QueriesTab.tsx`, query API | DuckDB via `duckdb-rs`, or skip — the queries panel is a power-user feature. |
| **jsPDF + svg2pdf.js** | `PrintDialog/pdfExport.ts` | Use existing `kernel-pdf-export` crate (already in workspace). |
| **lucide-react icons** | many places | egui has font-icon crates: `egui-phosphor` covers most lucide icons; missing ones get hand-drawn into `primitives::icon`. |
| **HTML5 canvas paint patterns** | `PatternPreview.tsx` | Painted directly in egui via `Painter::line_segment` over a thumbnail rect. |
| **Browser-native Print** | `printRenderer.ts`, `browserPrint.ts` | Out of scope — desktop app uses native OS print via Tauri or wgpu-rendered PDF. |
| **DOM `<input type="color">`** | `ribbon-color-input` | egui's `color_edit_button_srgb` is a drop-in. |

### 6.2 Zustand-coupled components

Most 1.0 components subscribe to Zustand selectors directly. The Rust port **must not** know about app state. Plan: each widget exposes a small `&mut FooState` for its own UI state (open/closed, hover, drag) and an `&Data` or builder-style data input. Cross-cutting state (selection, layers, drawings) is owned by the binary and threaded into widgets each frame, the way egui idioms expect.

This is a *redesign*, not a translation. It will be the dominant API-design effort.

### 6.3 Tailwind utility classes vs egui Style

Tailwind allows arbitrary per-element overrides. egui's `Style` is global per `Context`, with per-`Ui` mutation. Strategy:

- Apply theme tokens once at frame start (`kernel_ui::theme::apply(ctx, theme)`).
- Per-widget overrides use `ui.scope(|ui| { ui.visuals_mut().override_text_color = ...; ... })`.
- Custom paint (ribbon button background/border, file-tab slope) is done via direct `Painter` calls — not via egui widgets.

### 6.4 Custom painted shapes

The file-tab bar uses a sloped right divider (`clip-path` in CSS). egui can paint arbitrary triangles via `Painter::add(Shape::convex_polygon(...))`. The ribbon expand-panel border that wraps around the group is a custom 3-sided rect. Both are tractable.

### 6.5 Animations / transitions

CSS uses `transition: all 0.15s ease` ubiquitously. egui's animation primitives (`ui.ctx().animate_bool`) cover hover-fade. Acceptable degradation if v0 doesn't animate everything.

### 6.6 Scrollbars

CSS uses custom `::-webkit-scrollbar` styling. egui's scroll areas have their own look — match colours via `Visuals::widgets`, accept the slightly different feel.

### 6.7 Right-to-left / accessibility

Not in scope for v0. egui has limited a11y support today.

### 6.8 Fonts

`Inter` and `Segoe UI` are common but not bundled. Plan: ship `Inter-Regular`, `Inter-Medium`, `Inter-SemiBold` TTFs (already installed by 1.0 web build into `public/fonts/` for Osifont — same trick). On Windows, `Segoe UI` is system-supplied and can be loaded via `egui::FontDefinitions` from `C:\Windows\Fonts\`.

### 6.9 Crate name

User wrote "kernel-ui (or similar name)". Recommended: `kernel-ui` (matches `kernel-app`, `kernel-spatial`, `kernel-render` already in `kernel/crates/`). Confirm before scaffolding.

### 6.10 egui version pinning

`open_2d_studio` already uses `egui_wgpu`. The new crate must use the **same** `egui` version. Lock that in `kernel-ui`'s Cargo.toml from day one.

### 6.11 Things the user should clarify before implementation

1. **Crate name:** `kernel-ui` (suggested), `o2d-ui`, `kernel-egui`, or something else?
2. **Themes scope:** Port all 7 themes day-1, or only `default` + `dark` for v0?
3. **Do we need light theme on Windows immediately?** It exists in 1.0 but is rarely used.
4. **Docking / resizable panels:** 1.0 uses fixed left+right panels. Do we want `egui_dock` for v2, or stay fixed for v0?
5. **Localization:** 1.0 strings are English-only with Dutch comments. Confirm the crate is also English-only / hard-coded strings.
6. **Icon source:** Use `egui-phosphor` (or `lucide-rs` if available) for the lucide-react icons, plus hand-drawn `CadIcons` ports? Or inline all icons as SVG paths painted manually?
7. **Phase 1 only?** The task says "let's first make a Rust crate with all UI components" — suggesting **everything** at once. Phase A+B is the realistic v0 scope. Confirm.

---

## 7. Suggested Phase 1 to Land First

**Goal:** A `kernel-ui` crate compiles, exports a `Theme::Default` palette, and the existing `open_2d_studio` binary uses it to render a working **TitleBar + Ribbon + FileTabBar + StatusBar** that visually match 1.0's `default` theme.

### Phase 1 task list (concrete, no implementation here)

1. Scaffold crate `kernel/crates/ui/` with `Cargo.toml` (deps: `egui`, `egui_wgpu`, `egui_extras`, `serde`).
2. Wire it into `kernel/Cargo.toml` workspace `members`.
3. Add `kernel-ui = { path = "../ui" }` to `kernel/crates/app/Cargo.toml`.
4. Implement `tokens` module:
   - `Theme` enum + `Palette` struct + `Theme::Default` palette (the warm dark brown).
   - `apply_theme(&egui::Context, Theme)` mutates global egui style.
   - `metrics`, `spacing`, `typography` constants.
5. Implement `primitives::button::CadButton` (large/medium/small variants) with the exact ribbon-button visuals from `Ribbon.css` (66 px tall large, 32 px medium, 22 px small, hover/active states).
6. Implement `primitives::icon` with a hand-drawn subset (~10 essential CAD icons: line, arc, polyline, circle, rectangle, hatch, dimension, text, move, delete) and an `egui-phosphor` integration for the rest.
7. Implement `layout::title_bar::TitleBar` matching `TitleBar.tsx` visuals (window controls, version label, app menu trigger, custom drag region).
8. Implement `layout::ribbon::Ribbon` shell:
   - Tab strip (28 px, 12 px label, hover/active states).
   - Group renderer (group label at bottom, 1 px separators, 94 px content area).
   - Hosts large/medium/small buttons via `CadButton`.
   - **Tabs and buttons are data-driven** — the binary supplies a `Vec<RibbonTabDef>` or builder calls.
9. Implement `layout::file_tab_bar::FileTabBar` with sloped divider (custom `Painter::convex_polygon`).
10. Implement `layout::status_bar::StatusBar` with three sample sections (layer dropdown, coord readout, snap toggles).
11. Refactor `open_2d_studio.rs` to delete its inline egui chrome and use the new crate. Same visual result, same actions.
12. Add a `cargo run --bin open_2d_studio` smoke test in CI / local.
13. Side-by-side screenshot comparison vs 1.0 web at `https://open-2d-studio.open-aec.com/`.

**Deliverable:** binary still launches, ribbon looks like 1.0, but the implementation lives in `kernel-ui`. **No new functional behaviour.** That's the win — it's a refactor that lays the foundation.

**Phase 1 estimated effort:** 2 weeks for one engineer who already knows the repo.

**What Phase 1 explicitly does NOT include:**
- Panels (Phase C)
- Dialogs (Phase D)
- Editors (Phase E)
- Themes other than `Default`
- Light theme
- Animations

Those land in subsequent phases that user dispatches separately.

---

## 8. Approval

Reviewer checks one box and signs:

- [ ] **Approve as-is.** Proceed to writing-plans skill for Phase 1 implementation plan.
- [ ] **Approve with changes.** See comments below; revise then re-review.
- [ ] **Reject.** Discuss alternatives before committing more design effort.

**Open questions to answer before implementation kicks off** (copied from §6.11 for convenience):

1. Crate name: `kernel-ui` ✅ / other: ___
2. Themes in v0: All 7 / Default+Dark only / Default only — pick one: ___
3. Light theme priority: required v0 / nice-to-have / defer: ___
4. Docking library: `egui_dock` / fixed panels: ___
5. Localization: English-only confirmed / multilingual required: ___
6. Icons: `egui-phosphor` + hand-drawn CadIcons / all hand-drawn / other: ___
7. Phase 1 scope: as proposed in §7 / wider / narrower: ___

**Reviewer signature:** ___________________  **Date:** __________

---

*End of design document. No implementation has been or will be performed against this spec until the approval section above is completed.*
