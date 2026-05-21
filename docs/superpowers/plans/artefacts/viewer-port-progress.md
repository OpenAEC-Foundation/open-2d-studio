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

## Phase 2 (button wiring) — COMPLETE

Phase 2 wiring round, 2026-05-21. Buttons that rendered as placeholders
in Phase 1 are now dispatched. Commits landed in this order:

- [a971911] docs(viewer): keyboard shortcut matrix for Phase 2 wiring
- [34e7a90] feat(viewer): wire ribbon Zoom Window button to ZoomRegion chord
- [07b5f97] feat(viewer): hide IFC toggle button in Viewer status bar
- [84d1044] feat(viewer): ORTHO toggle constrains Measure/Dim second click to H/V
- [ea61117] feat(viewer): MeasureAngle + MeasureCoord + Zoom Previous + Zoom Center
- [d60d1a0] feat(viewer): Grid + White BG + Theme cycle + View Mode cycle wired
- [724c4c9] feat(viewer): wire Find dialog (Ctrl+F) -- text, layer, handle search
- [b4b0e44] docs(viewer): keymap -- enumerate wired ribbon + status-bar dispatches

### Wired this round

Home tab:
- Selection / Find — Ctrl+F + ribbon button (724c4c9)
- Measure / Angle — three-click vertex+rays angle readout (ea61117)
- Measure / Coord. — single-click world-coord readout (ea61117)
- Annotate group — removed entirely from Viewer (b5f1ec2)

View tab:
- Zoom / Window — engages ZoomRegion, same as Z R chord (34e7a90)
- Zoom / Previous — pops camera_history stack (ea61117)
- Zoom / Center — engages ZoomCenter one-shot recenter (ea61117)
- Display / Grid — toggle + paint adaptive world-grid (d60d1a0)
- Display / White BG — toggle clear-color dark↔white (d60d1a0)
- Appearance / Theme — cycles (placeholder; only Default ships) (d60d1a0)

Status bar:
- ORTHO toggle — wired + constrains Measure/Dim second click (84d1044)
- IFC toggle — hidden in Viewer mode (07b5f97)
- View-mode pill — cycle Hidden Line / Wireframe (d60d1a0)

### Still deferred to future rounds

- Theme picker dropdown popup (Phase 2 ships click-to-cycle placeholder
  because superui currently only exports `Theme::Default`).
- ZoomCenter / MeasureAngle / MeasureCoord on-canvas overlay text (the
  renderer doesn't pick up `last_measure_angle` / `last_measure_coord`
  yet — they're stored in App state but not painted).
- Right-click / context menu on Find dialog rows.
