# Open 2D Studio

A comprehensive, cross-platform 2D CAD application. Built with modern technologies for performance, extensibility, and ease of use.

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20Linux%20%7C%20macOS-lightgrey.svg)
![TypeScript](https://img.shields.io/badge/TypeScript-5.7-blue.svg)
![Tauri](https://img.shields.io/badge/Tauri-2.0-orange.svg)

## Overview

Open 2D Studio is a free, open-source 2D CAD (Computer-Aided Design) application that provides professional-grade drawing tools for technical drawings, floor plans, mechanical designs, and more. It aims to be a lightweight, fast alternative to commercial CAD software.

### Key Features

- **Drawing Tools**: Line, Rectangle, Circle, Arc, Polyline, Ellipse, Text
- **Precision Tools**: Snap to grid, object snaps (endpoint, midpoint, center, intersection)
- **Layer Management**: Multiple layers with visibility, lock, and color controls
- **Pan & Zoom**: Smooth navigation with mouse wheel zoom and middle-button pan
- **Selection**: Click, box selection, shift-click to add to selection
- **Properties Panel**: Edit stroke color, width, and line style
- **Command Line**: CAD-style command input
- **File Support**: Native JSON format, DXF import/export (via Rust backend)
- **Cross-Platform**: Runs on Windows, Linux, and macOS

## Technology Stack

### Why These Technologies?

| Technology | Purpose | Why We Chose It |
|------------|---------|-----------------|
| **Tauri 2.0** | Application framework | ~10MB app size, ~30MB RAM usage, native performance |
| **React 18** | UI framework | Component-based architecture, huge ecosystem, TypeScript support |
| **TypeScript** | Language | Type safety, better tooling, catch bugs at compile time |
| **Canvas 2D** | Rendering | Fast 2D rendering, simple API, handles 10k+ elements smoothly |
| **Zustand** | State management | Lightweight, simple API, works great with React |
| **TailwindCSS** | Styling | Rapid UI development, consistent design system |
| **Rust** | Backend (Tauri) | Memory safety, native performance for file I/O and geometry |
| **dxf-rs** | DXF support | Native Rust library for reading/writing DXF files |

### Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    Tauri (Rust Shell)                    │
│  - Native window management                             │
│  - File system access                                   │
│  - DXF import/export via dxf-rs                         │
├─────────────────────────────────────────────────────────┤
│                    React + TypeScript                    │
│  - Component-based UI                                   │
│  - Zustand state management                             │
│  - TailwindCSS styling                                  │
├─────────────────────────────────────────────────────────┤
│                    CAD Engine                            │
│  - Canvas 2D rendering                                  │
│  - Shape primitives & geometry math                     │
│  - Selection & hit testing                              │
│  - Snap system                                          │
└─────────────────────────────────────────────────────────┘
```

## Getting Started

### Prerequisites

- **Node.js** 18+
- **Rust** 1.70+ (for Tauri backend)
- **npm** or **pnpm**

### Installation

1. Clone the repository:
   ```bash
   git clone https://github.com/your-username/open-2D-studio.git
   cd open-2D-studio
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Run in development mode:
   ```bash
   # Frontend only (without Tauri)
   npm run dev

   # Full application with Tauri (requires Rust)
   npm run tauri dev
   ```

4. Build for production:
   ```bash
   npm run tauri build
   ```

## Usage

### Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `V` | Select tool |
| `H` | Pan tool |
| `L` | Line tool |
| `R` | Rectangle tool |
| `C` | Circle tool |
| `Delete` | Delete selected |
| `Ctrl+A` | Select all |
| `Ctrl+D` | Deselect all |
| `Ctrl+Z` | Undo |
| `Ctrl+Y` | Redo |
| `G` | Toggle grid |
| `S` | Toggle snap |
| `+` / `-` | Zoom in/out |
| `F` | Zoom to fit |

### Drawing

1. Select a drawing tool from the toolbar or press its shortcut
2. Click to start drawing
3. Drag to define the shape
4. Release to complete

### Navigation

- **Zoom**: Mouse wheel (zooms toward cursor)
- **Pan**: Middle mouse button drag, or select Pan tool (H)

## Project Structure

```
open-2D-studio/
├── src/                      # Frontend source code
│   ├── components/           # React components
│   │   ├── Canvas/          # Drawing canvas
│   │   ├── Toolbar/         # Top toolbar
│   │   ├── ToolPalette/     # Left tool palette
│   │   ├── Panels/          # Properties & Layers panels
│   │   ├── StatusBar/       # Bottom status bar
│   │   └── CommandLine/     # Command input
│   ├── engine/              # CAD engine
│   │   └── renderer/        # Canvas rendering
│   ├── hooks/               # React hooks
│   ├── state/               # Zustand store
│   ├── types/               # TypeScript types
│   └── styles/              # Global styles
├── src-tauri/               # Rust backend
│   └── src/
│       ├── main.rs          # Tauri entry
│       └── commands/        # File I/O commands
├── public/                  # Static assets
└── package.json
```

## Roadmap

### Phase 1 - Foundation ✅
- [x] Project setup (Tauri + React + TypeScript)
- [x] Basic application layout
- [x] Canvas rendering with pan/zoom
- [x] Grid system
- [x] Basic shapes (Line, Rectangle, Circle)

### Phase 2 - Core Features (In Progress)
- [ ] Undo/Redo system
- [ ] More drawing tools (Arc, Polyline, Spline, Text)
- [ ] Object snaps (endpoint, midpoint, intersection)
- [ ] Box selection

### Phase 3 - Advanced Features
- [ ] Dimensions and annotations
- [ ] Modify tools (Trim, Extend, Fillet, Offset)
- [ ] Blocks/Symbols
- [ ] DXF import/export

### Phase 4 - Polish
- [ ] Command line interface
- [ ] Customizable keyboard shortcuts
- [ ] Settings/Preferences
- [ ] PDF export

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Acknowledgments

- Inspired by professional CAD software
- Built with [Tauri](https://tauri.app/), [React](https://react.dev/), and [Rust](https://www.rust-lang.org/)
- Icons by [Lucide](https://lucide.dev/)

## Support

If you find this project useful, please consider:
- Starring the repository
- Reporting bugs or suggesting features
- Contributing code or documentation
