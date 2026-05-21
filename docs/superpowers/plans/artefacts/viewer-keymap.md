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

## Pending / Phase 2 wiring buttons

Some ribbon + status-bar affordances still cycle / dispatch on click
without a dedicated keyboard shortcut. They are documented here so a
later round can add bindings:

- View tab → **Zoom Window**: ribbon-only (no shortcut; the `Z R`
  chord is the keyboard equivalent).
- View tab → **Zoom Previous**: ribbon-only (no shortcut yet).
- View tab → **Zoom Center**: ribbon-only (no shortcut yet).
- View tab → **Grid** toggle: ribbon-only.
- View tab → **White BG** toggle: ribbon-only.
- View tab → **Theme**: ribbon-only, cycles through themes.
- Status bar → **ORTHO** toggle: status-bar only.
- Status bar → **View mode** (Hidden Line / Wireframe): status-bar
  only, cycles on click.
