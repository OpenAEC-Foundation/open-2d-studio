# Open 2D Studio

> Desktop 2D BIM/IFC tekenprogramma gebouwd met Tauri 2 + React 18 + web-ifc.
> Cross-platform CAD-applicatie voor het maken, bewerken en exporteren van 2D bouwtekeningen met IFC-integratie.

---

## Stack

| Technologie | Versie | Rol |
|-------------|--------|-----|
| React | 18.3 | UI framework, component rendering |
| Tauri | 2.x | Desktop shell, native FS/dialog/shell/store/updater plugins |
| web-ifc | 0.0.75 | IFC parsing en generatie in de browser |
| Zustand | 5.x | State management (global + per-document stores) |
| Immer | 10.x | Immutable state updates, undo/redo via patches |
| Vite | 6.x | Build tool, dev server op poort 3000 |
| Tailwind CSS | 3.4 | Utility-first styling |
| TypeScript | 5.7 | Type-safe codebase |
| jsPDF + svg2pdf.js | 4.1 / 2.7 | PDF export van tekeningen |
| xterm | 5.5 | Ingebouwde terminal |
| alasql | 4.17 | Client-side SQL queries op model data |
| lucide-react | 0.468 | Icon library |
| fflate | 0.8 | Compressie (ZIP/gzip) |
| Rust (backend) | edition 2021 | Tauri commands, DXF import/export, HTTP API server |

---

## Architectuur

### Directory Structuur

```
src/
├── main.tsx                    # Entrypoint: lazy-load App of TabletApp
├── App.tsx                     # Hoofdlayout: TitleBar, Ribbon, Canvas, panels, dialogs
├── api/                        # CadApi — public scripting/extension interface
│   ├── commands/               # Command handlers + registry + validation
│   │   └── handlers/           # Per-command implementaties
│   ├── mcp/                    # MCP (Model Context Protocol) server + tools
│   └── *.ts                    # API modules: entities, layers, viewport, tools, etc.
├── components/
│   ├── canvas/                 # HTML5 Canvas rendering + ToolOptionsBar
│   ├── dialogs/                # Modale dialogen (Print, Settings, AppMenu, etc.)
│   ├── editors/                # Pattern manager, filled region types, text styles, terminal
│   ├── layout/                 # TitleBar, Ribbon, StatusBar, FileTabBar
│   ├── panels/                 # NavigationPanel, RightPanelLayout, IfcPanel, IfcDashboard
│   ├── shared/                 # Herbruikbare UI-componenten
│   └── tablet/                 # Mobiele/tablet variant (TabletApp)
├── constants/                  # CAD defaults
├── engine/
│   ├── geometry/               # Point, Line, GeometryUtils, SnapUtils, Tracking, Splines, etc.
│   ├── registry/               # Plugin registries: tools, renderers, snap providers, shortcuts, IFC, grips
│   ├── renderer/               # CADRenderer + core/layers/modes/sheet/ui rendering pipeline
│   └── spatial/                # QuadTree ruimtelijke index
├── extensions/                 # Extension SDK: loader, service, registry, types
├── hooks/
│   ├── canvas/                 # Canvas interactie hooks
│   ├── drawing/                # Teken-gerelateerde hooks
│   ├── editing/                # Bewerkingshooks
│   ├── file/                   # Bestandsoperatie hooks
│   ├── keyboard/               # Keyboard shortcuts, global keyboard
│   ├── navigation/             # Pan/zoom hooks
│   ├── selection/              # Selectie hooks
│   ├── snap/                   # Snap hooks
│   ├── touch/                  # Touch/tablet input
│   └── use*.ts                 # Domein-specifieke hooks (IFC auto-regen, pile dimensioning, etc.)
├── services/
│   ├── autosave/               # Auto-save met Tauri Store plugin
│   ├── bonsaiSync/             # Blender/Bonsai synchronisatie
│   ├── drawing/                # Tekeningbeheer
│   ├── export/                 # IFC export, PAT, SVG patronen, SVG titelblokken
│   ├── file/                   # Bestandslezen/-schrijven via Tauri FS
│   ├── ifc/                    # IFC generatie (ifcGenerator, ifcFactoryAdapter, GUID helpers)
│   ├── integration/            # Externe integraties
│   ├── log/                    # Logging service
│   ├── parametric/             # Parametrische objecten
│   ├── query/                  # Data queries (alasql)
│   ├── section/                # Doorsnede-service
│   ├── template/               # Template service
│   ├── updater/                # Auto-update via Tauri updater plugin
│   └── wallSystem/             # Wandsysteem logica
├── state/
│   ├── appStore.ts             # Globale Zustand store (facade over global + actief document)
│   ├── documentStore.ts        # Per-document Zustand store (eigen instantie per open bestand)
│   └── slices/                 # State slices: model, view, tool, snap, selection, history,
│                               #   UI, boundary, viewportEdit, annotation, drawingPlacement,
│                               #   parametric, hatch, clipboard, projectInfo, unit, ifc, log, extension
├── styles/                     # Global CSS (Tailwind)
├── types/                      # TypeScript types: geometry, drawing, sheet, dimension, hatch, etc.
├── units/                      # Eenhedenconversie en -formatting
└── utils/                      # Utilities: platform detect, settings, IFC categories, expressions

src-tauri/
├── src/
│   ├── main.rs                 # Tauri bootstrap
│   ├── lib.rs                  # Library crate
│   ├── api_server.rs           # HTTP API server (tiny_http)
│   └── commands/               # Rust Tauri commands (DXF import/export, etc.)
├── Cargo.toml                  # Rust dependencies (dxf, tiny_http, clap, serde)
└── tauri.conf.json             # Tauri configuratie

patterns/                       # SVG hatch-patronen (baksteen, beton, isolatie, hout, etc.)
templates/                      # SVG titelblok-templates (3BM tekenkaders)
api-commands/                   # JS macro-scripts (fibonacci, spirograph, etc.)
```

### State Architectuur

De app gebruikt een **twee-laags Zustand + Immer** architectuur:

1. **`appStore`** — Globale singleton store. Bevat tool-modes, snap-instellingen, UI-dialoogstatus en document-management. Fungeert als facade: per-document state wordt doorgesluisd vanuit de actieve document store.

2. **`documentStore`** — Per-document store registry. Elk geopend bestand krijgt een eigen Zustand store-instantie. De `useDocStore()` hook resolvet automatisch de store van het actieve document.

3. **Slices** — State is opgedeeld in ~20 slices (model, view, tool, snap, selection, history, UI, boundary, viewportEdit, annotation, drawingPlacement, parametric, hatch, clipboard, projectInfo, unit, ifc, log, extension).

4. **Undo/Redo** — Via Immer patches (`enablePatches`, `produceWithPatches`, `applyPatches`).

### Rendering Pipeline

- **CADRenderer** (`engine/renderer/CADRenderer.ts`) — Centrale 2D Canvas renderer
- Submodules: `core/` (basis rendering), `layers/` (laag compositing), `modes/` (editor modes), `sheet/` (velweergave), `ui/` (UI overlays)
- **QuadTree** (`engine/spatial/QuadTree.ts`) — Ruimtelijke index voor snelle hit-testing

### Extension Systeem

- Extensions worden geladen via `extensionLoader.ts` en geregistreerd in `extensionService.ts`
- De `CadApi` class (`src/api/`) biedt een public scripting API, beschikbaar als `window.cad`
- Extensions kunnen automations (hooks) en dialogen registreren via de engine registries
- MCP server (`src/api/mcp/`) voor AI-integratie

### Bestandsformaat

- **`.o2d`** — Eigen projectformaat (JSON, versie 3)
- **IFC export** — Via web-ifc + ifcGenerator service
- **DXF import/export** — Via Rust backend (`dxf` crate)
- **PDF export** — Via jsPDF + svg2pdf.js
- **SVG patronen** — Hatch patterns en titelblokken

---

## Technologie-grensvlakken

### web-ifc ↔ React
- IFC data wordt geparsed/gegenereerd via `services/ifc/` (ifcGenerator, ifcFactoryAdapter)
- State vloeit naar React via de `ifcSlice` in Zustand
- Het `IfcPanel` en `IfcDashboard` renderen IFC modeldata
- IFC categorieregistratie via `engine/registry/IfcCategoryRegistry.ts` en `IfcExportRegistry.ts`

### Tauri FS ↔ IFC/Bestandsladen
- Bestanden worden gelezen/geschreven via `@tauri-apps/plugin-fs`
- `services/file/fileService.ts` handelt `.o2d` projectbestanden af
- `services/export/ifcExport.ts` schrijft IFC-bestanden via Tauri FS
- DXF import/export gaat via Rust Tauri commands

### Zustand + Immer ↔ UI Rendering
- Alle UI-componenten subscriben op Zustand stores met selectors
- State updates verlopen via Immer producers (immutable updates, structureel delen)
- De facade in `appStore` maakt de twee-laags architectuur transparant voor componenten
- Undo/redo werkt via Immer patch-tracking

### Tauri Plugins
- **dialog** — Native bestandsdialogen (open/save)
- **fs** — Bestandssysteem toegang
- **shell** — OS shell commands
- **store** — Persistente key-value opslag (settings, auto-save)
- **updater** — Auto-update mechanisme
- **http** — HTTP requests vanuit de frontend
- **process** — Proces-informatie

---

## Conventies

### Taal
- **Documentatie**: Nederlands
- **Code & configs**: Engels
- **Communicatie**: Nederlands, technische termen in het Engels zijn OK

### Commits
Conventional Commits: `feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:` (scope optioneel)

### Code Stijl
- TypeScript strict mode
- React functionele componenten met hooks
- Tailwind CSS voor styling (custom `cad-*` design tokens)
- Absolute imports via `@/` alias (Vite config)
- Kebab-case voor bestanden, PascalCase voor componenten

### Development
```bash
npm run dev          # Start Vite dev server (poort 3000)
npm run build        # TypeScript check + Vite build
npm run test         # Vitest tests
npm run tauri dev    # Start volledige Tauri desktop app
npm run tauri build  # Production build
npm run bump         # Versie ophogen (custom script)
```

### Testen
- **Framework**: Vitest 4 + @testing-library/react + jsdom
- **Config**: `vitest.config.ts`
- **Setup**: `src/setupTests.ts`

---

## Companion Skill Packages

Geinstalleerde Claude Code skill packages die relevant zijn voor dit project:

| Package | Skills | Relevantie |
|---------|--------|------------|
| [Cross-Tech AEC](https://github.com/OpenAEC-Foundation/Cross-Tech-AEC-Claude-Skill-Package) | 15 | IFC schema bridge, coordinaatsystemen, web-ifc bridge |
| [ThatOpen/web-ifc](https://github.com/OpenAEC-Foundation/ThatOpen-Claude-Skill-Package) | 18 | web-ifc API, IFC laden/schrijven |
| [Tauri 2](https://github.com/OpenAEC-Foundation/Tauri-2-Claude-Skill-Package) | 27 | Commands, IPC, plugins |
| [React](https://github.com/OpenAEC-Foundation/React-Claude-Skill-Package) | 24 | Hooks, componenten, patterns |
| [Vite](https://github.com/OpenAEC-Foundation/Vite-Claude-Skill-Package) | 22 | Build configuratie, plugins |
| [Three.js](https://github.com/OpenAEC-Foundation/Three.js-Claude-Skill-Package) | 24 | 3D rendering (voor toekomstige 3D view) |
| [Docker](https://github.com/OpenAEC-Foundation/Docker-Claude-Skill-Package) | 22 | Containers, CI/CD |
