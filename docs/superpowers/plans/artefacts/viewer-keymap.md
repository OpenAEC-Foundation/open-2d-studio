# Open 2D Viewer — keyboard shortcut matrix

Authoritative list of every keyboard binding wired in the Viewer build
(`open_2d_viewer.exe`). Studio shares most of these but adds editing
shortcuts that are inert in Viewer — those are listed in the second
table for cross-reference.

Last updated: Phase 2 wiring round (2026-05-21). Source of truth:
`kernel/crates/app/src/studio_app.rs` — see the `match code` block in
`impl ApplicationHandler for App :: window_event :: WindowEvent::KeyboardInput`.

## Always-on (Viewer + Studio)

| Shortcut         | Action                                               |
|------------------|------------------------------------------------------|
| `Ctrl+O`         | Open file (DWG / DXF) in new tab                     |
| `Ctrl+W`         | Close active tab                                     |
| `Ctrl+Tab`       | Cycle to next tab                                    |
| `Ctrl+Shift+Tab` | Cycle to previous tab                                |
| `Ctrl+F`         | Toggle Find dialog (find-only in Viewer)             |
| `Ctrl+A`         | Select all in active tab                             |
| `Ctrl+C`         | Copy selection to clipboard                          |
| `F`              | Fit active tab to scene bbox                         |
| `F2`             | Toggle samples panel (Studio: also enter text edit)  |
| `F3`             | Toggle Layers panel                                  |
| `F4`             | Toggle Properties panel                              |
| `F5`             | Toggle Structure / model browser panel               |
| `F11`            | Toggle VSync (Fifo ↔ Immediate present mode)         |
| `F12`            | Toggle Perf HUD overlay                              |
| `Esc`            | Layered cancel — text edit → Find dialog → tool      |
|                  | mode → selection → exit                              |
| `Delete`         | Delete current selection (Viewer + Studio both)      |
| `Backspace`      | Same as Delete                                       |
| `M`              | Measure tool                                         |
| `Shift+M`        | Mirror tool                                          |
| `S`              | Scale tool                                           |
| `R`              | Rotate tool                                          |
| `V`              | Select tool (plain V — Ctrl+Shift+V splits)          |
| `X`              | Explode INSERT (Viewer + Studio)                     |
| `Z` then `R`     | Zoom Region chord — drag a rectangle, camera fits    |
| `Ctrl+Shift+H`   | Split active tab horizontally with neighbour         |
| `Ctrl+Shift+V`   | Split active tab vertically with neighbour           |
| `Ctrl+Shift+S`   | Unsplit canvas                                       |

## Studio-only (ignored in Viewer)

| Shortcut         | Action                                               |
|------------------|------------------------------------------------------|
| `D`              | Dimension tool                                       |
| `A`              | Area measurement tool                                |
| `Ctrl+Z`         | Undo last edit                                       |
| `Ctrl+V`         | Paste from clipboard                                 |
| `Ctrl+X`         | Cut (copy + delete)                                  |
| `Ctrl+D`         | Duplicate selection                                  |

## Chords + multi-key combos

| Chord            | Behaviour                                            |
|------------------|------------------------------------------------------|
| `Z` then `R`     | Zoom Region. The second key must arrive within 1 s   |
|                  | of the first or the chord buffer expires.            |

## Mouse + wheel

These aren't keyboard shortcuts strictly speaking, but they round out
the Viewer interaction model:

| Input              | Action                                             |
|--------------------|----------------------------------------------------|
| Left-click         | Pick (Select mode) / set tool point (other tools)  |
| Shift+click        | Add to selection (Select mode)                     |
| Ctrl+click         | Toggle in selection                                |
| Left-drag          | Box-select (Select mode) / pan                     |
| Middle-drag        | Pan canvas                                         |
| Wheel              | Zoom at cursor                                     |
| Double-click       | (Studio) enter inline text-edit on TEXT entity     |

## Ribbon + status-bar dispatch (no keyboard shortcut)

These affordances are click-only — they don't have a dedicated key
binding. Most are toggles or one-shot tool engagements that read more
naturally as ribbon clicks than chords.

### Home tab

| Button             | Dispatch                                           |
|--------------------|----------------------------------------------------|
| Selection / Find   | Same as `Ctrl+F` — opens Find dialog               |
| Measure / Length   | Engage Measure tool (Length sub-mode)              |
| Measure / Area     | Engage Measure tool (Area sub-mode)                |
| Measure / Angle    | Engage MeasureAngle (3-click vertex+rays)          |
| Measure / Coord.   | Engage MeasureCoord (single-click world readout)   |

### View tab

| Button             | Dispatch                                           |
|--------------------|----------------------------------------------------|
| Pan                | Engage Pan tool                                    |
| Zoom In / Out      | Zoom step at viewport center                       |
| Fit All            | Fit camera to scene bbox, pushes camera history    |
| Window             | Same as `Z R` chord — engage ZoomRegion            |
| Previous           | Pop camera history (up to 50 entries)              |
| Center             | Engage ZoomCenter (one-shot recenter on click)     |
| Grid               | Toggle world-space grid overlay (10 mm adaptive)   |
| White BG           | Toggle canvas clear-color dark ↔ white             |
| Theme              | Cycle theme (Phase 2 placeholder — Default only)   |

### Status bar

| Pill / Button      | Dispatch                                           |
|--------------------|----------------------------------------------------|
| Ortho              | Toggle `App::ortho_enabled` — constrains H/V       |
| OSNAP End/Mid/etc. | Toggle individual SnapModeSet bits                 |
| Len / Area         | Switch Measure sub-mode                            |
| View mode          | Cycle Hidden Line ↔ Wireframe (viewer scope)       |

## Notes on the missing IFC affordance

The Viewer status bar previously rendered an IFC toggle even though
the viewer doesn't ship the IFC ribbon tab or panel. That pill is
hidden in Viewer mode as of commit 07b5f97; it stays visible in
Studio.
