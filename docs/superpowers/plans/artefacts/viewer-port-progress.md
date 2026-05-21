# Open 2D Viewer — pixel-perfect mockup port progress

Tracks each round's commit SHA + remaining visible diffs. Mockup source:
`docs/superpowers/mockups/Open2DViewerMockup.jsx`, live at
`http://localhost:7778/`.

## Round log

- [2e282c8] Round 1 — tokens.rs + theme.rs adopt mockup warm-brown + amber palette — remaining: titlebar layout, ribbon strip heights, file tab strip, Home/View group counts, status bar layout, measure icons.
- [3ac9355] Round 2 — titlebar QAT order matches mockup (undo redo | new open save saveAs | print gear caret), 46 px window controls, 20 px logo — remaining: ribbon strip heights/content, file tab strip, Home/View group counts, status bar layout, measure icons.
- [939b38a] Round 3 — ribbon tab strip 28 px on surface, File tab orange, active tab merges into body — remaining: ribbon content height/buttons, Home/View groups, file tab strip styling, layers panel, properties dock, status bar, measure icons.
- [9f86e09] Round 4 — Home tab: Selection/Pan/Annotate/Measure/Clipboard/Panels groups, 22 new IconKind glyphs incl. tape/pentagon/arc/crosshair measure icons — remaining: View tab layout, file tab strip styling, layers panel rows, properties dock, status bar.
- [f8d3006] Round 5 — View tab: Navigate/Zoom (3 large + stack3) /Display/Appearance/Panels(IFC), added LargesPlusStacks group layout variant — remaining: file tab strip styling, layers panel rows, properties dock, status bar.
- [517d1bd] Round 6 — file tab bar Chrome-style 30 px, sloped 14 px polygon with split-triangle colour transition, close × on hover — remaining: layers panel rows, properties dock, status bar.
- [89fce62] Round 7 — Layers panel: surface header 24 px, Show all/Hide all/Read-only row, per-layer 24 px row with swatch+eye+lock — remaining: properties dock, status bar.
- [dfa3202] Round 8 — Properties panel: surface header, body-bg frame, sublabel divider, "No selection" surface card — remaining: status bar.
- [a615d9c] Round 9 — Status bar: 24 px surface strip, left/right clustering via Spacer, dim:value text pairs, 18 px rounded toggle pills, OSNAP strip with 6 toggles — remaining: measure icons (covered in R4 already).
- [591d1b3] Round 10 — Polished measure icons: pentagon cross-hatch + corner dots, tape ticks at #3 and #6 full height — Phase 1 of viewer port COMPLETE.

## Phase 2 (button wiring) — outstanding work

Buttons that render as placeholders in Phase 1 and need handlers wired
in Phase 2:

Home tab:
- Selection / Find — disabled in mockup but needs hotkey (Ctrl+F)
- Annotate group (Linear, Angular, Radius, Diameter, Leader, Label,
  Table) — viewer is read-only; remain visible-disabled
- Measure / Angle, Coord — handler + tool mode dispatch (Length, Area
  already wired)
- Clipboard / Copy ID, Cut, Delete — disabled in mockup, Copy already
  wired
- Panels / Layers, Properties — toggles already wired via
  `requested_toggle_layer_panel` and `requested_toggle_props_panel`

View tab:
- Zoom / Zoom Window, Zoom Previous, Zoom Center — handler + tool mode
- Display / Grid — toggle handler (currently selected=true cosmetic)
- Display / White BG — already wired in legacy ribbon
- Appearance / Theme — handler + dropdown popup
- Panels / IFC Model — disabled in mockup, keep visible

Status bar:
- ORTHO toggle — dispatch arm
- IFC toggle — dispatch arm
- View-mode select dropdown (Hidden Line / White BG / Transparent) —
  not yet rendered (mockup line 1001-1008)
