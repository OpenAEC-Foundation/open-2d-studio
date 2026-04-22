# Open 2D Studio — Merge 1.0 + 2.0 — Slice 1 Design

**Date:** 2026-04-22
**Status:** Approved for implementation planning
**Branch:** `merge-1.0-2.0`
**Architectural route:** **A** — native wgpu + transparent web UI overlay
**Slice:** **1** — Pure Shell ("hello world" of the merge)

---

## Context

The repository currently contains two distinct applications:

| App | Stack | Directory | Bin | Strengths |
|-----|-------|-----------|-----|-----------|
| **1.0** | Tauri 2 + React 18 + Zustand + web-ifc | `src/` + `src-tauri/` | `npm run tauri dev` | Full CAD UI: ribbon, canvas, extensions, IFC, DXF/DWG import, PDF export, state stores |
| **2.0** | Rust native (winit + wgpu + egui) | `kernel/` | `split_compare.exe` | GPU-accelerated render of 1M+ segs, clean-room DWG parser, spatial index, modern editor tools (multi-select, rotate/scale/mirror, undo) |

The goal is to merge: keep 1.0's React UI as the shell, swap the HTML5 Canvas rendering for the Rust wgpu kernel.

Migration is **feature-by-feature** on a dedicated branch. Each ribbon tool or canvas capability is ported individually once the architectural spine is proven.

---

## Slice 1 Goal

Prove that a **winit + wry + wgpu hybrid** can composite a transparent React UI over a Rust wgpu surface on the user's Windows machine. Nothing functional beyond the shell — the slice is a bet on the architecture.

If Slice 1 ships and looks right, the remaining slices are mechanical. If Slice 1 fails (wry transparency bugs, DPI artifacts, event-loop conflicts), we pivot to route B (two-window) or D (IPC bitmap) without wasting work on the tool-migration layer.

---

## Success Criteria

1. `cargo run --release --manifest-path src-tauri/Cargo.toml --bin merged` (or `npm run run:merged`) launches a single 1800×1000 window titled "Open 2D Studio (merged)".
2. The top ~100 px shows the 1.0 ribbon — **visually identical styling**: dark background, icon + label buttons, 6 groups (Files / Tools / Measure / View / Layout / Help). No functionality — clicks are no-op.
3. Above the ribbon: a minimal 32 px title bar from 1.0's `TitleBar` component.
4. Below the ribbon: a **solid blue rectangle** (`#1E3A8A`) filling the remaining area, rendered by wgpu.
5. Window resize: ribbon stays pinned at top, blue fills remaining area, no flicker, no black bands during resize.
6. Window close button works. No crashes in stderr.

### Explicit non-goals

- No file open / scene load
- No pan / zoom / mouse interaction on canvas
- No ribbon button click handlers
- No panels (Layers / Properties / Samples)
- No tabs
- No state stores (Zustand, Immer) — `MergedApp` is stateless
- No IPC between React and Rust beyond what wry provides by default
- No extension system
- No port of 1.0's service layer, hooks, or engine registries

---

## Architecture

### Why "winit + wry + wgpu" instead of Tauri high-level

Tauri 2's `WebviewWindow` owns the native window's render surface through WebView2 (Windows) / WKWebView (macOS) / WebKitGTK (Linux). There is no native pixel buffer under the webview that wgpu can paint into. Workarounds (two-window child positioning, bitmap piping, WASM kernel) were considered (see `2026-04-22-open2d-merge-routes.md` — route options A/B/C/D/E) and rejected for Slice 1's goal of proving compositing.

The industry-standard pattern is **hybrid**: use winit for the window, wry for the webview as a transparent overlay within that window, and wgpu on the same native surface. This is what Tauri itself uses internally, just without Tauri's high-level abstractions.

### Component layout

```
┌─── winit Window (native HWND on Windows) ──────────────────┐
│                                                             │
│  ┌── wry WebView (transparent, full-window overlay) ─────┐ │
│  │  React app renders here                                │ │
│  │  ┌─────────────────────────────────────────────────┐  │ │
│  │  │  TitleBar (opaque, 32 px)                       │  │ │
│  │  ├─────────────────────────────────────────────────┤  │ │
│  │  │  Ribbon (opaque, ~102 px)                       │  │ │
│  │  ├─────────────────────────────────────────────────┤  │ │
│  │  │  Canvas div                                     │  │ │
│  │  │  (CSS: background: transparent)                 │  │ │
│  │  │                                                 │  │ │
│  │  │  (wgpu blue shows through here)                 │  │ │
│  │  │                                                 │  │ │
│  │  └─────────────────────────────────────────────────┘  │ │
│  └────────────────────────────────────────────────────────┘ │
│                                                             │
│  wgpu clear-pass to #1E3A8A fills the whole surface        │
│  (the opaque React areas hide it; transparent canvas        │
│   div lets it show)                                         │
└─────────────────────────────────────────────────────────────┘
```

### Event loop ownership

winit owns the event loop. wry's `WebViewBuilder::new_as_child(&window)` binds the webview to winit's window; wry piggybacks on winit's Windows message pump — no conflicting message pumps.

Frame loop each tick:
1. Poll winit events (resize, close, mouse, keyboard)
2. If redraw requested: wgpu clears to blue, presents
3. wry repaints on its own schedule (WebView2 is async)

Note: wry's transparent webview paints over the wgpu surface on every webview repaint. The compositor blends based on webview pixel alpha. Opaque React elements cover blue; transparent areas (canvas div) expose blue.

---

## Branch strategy

```bash
git checkout -b merge-1.0-2.0
```

`main` branch = 1.0 intact. `merge-1.0-2.0` = work branch. Each slice lands as a PR against this branch (or committed directly — user's call).

When all slices land and the merged app matches or exceeds 1.0, this branch can be merged back to `main` and the old `src/App.tsx` path can be removed.

---

## File changes

### New Rust entry point — `src-tauri/src/bin/merged.rs`

```rust
// ~200 lines. Structure:
// 1. winit EventLoop + Window (transparent: false, decorations: true, 1800x1000)
// 2. wgpu Instance → Surface (from window HWND) → Device/Queue → SurfaceConfig
// 3. wry WebViewBuilder::new_as_child(&window)
//        .with_transparent(true)
//        .with_url("http://localhost:5173/merged")  // dev
//        .build()?
// 4. event loop:
//    MainEventsCleared → window.request_redraw()
//    RedrawRequested → begin_render_pass with LoadOp::Clear(Color { r: 0.117, g: 0.227, b: 0.541, a: 1.0 })
//    Resized → surface.configure() + webview.set_bounds()
//    CloseRequested → exit
```

**Note on "transparent" window**: the winit window itself is *opaque* (decorations on, not a transparent OS window). We don't need OS-level transparency for Slice 1. Transparency is *inside* the window: wry's webview is transparent above wgpu. This is simpler than a fully transparent OS window and has better DPI / multi-monitor behaviour.

### `src-tauri/Cargo.toml` additions

```toml
[[bin]]
name = "merged"
path = "src/bin/merged.rs"

[dependencies]
wry = "0.40"
winit = "0.30"
wgpu = "22"
bytemuck = "1.19"
pollster = "0.3"
kernel-render = { path = "../kernel/crates/render" }  # future use
anyhow = "1"
```

The existing Tauri 1.0 dependencies stay — 1.0's `main` Tauri binary is unaffected.

### New React component — `src/MergedApp.tsx`

```tsx
// ~80 lines. Structure:
import { TitleBar } from './components/layout/TitleBar';
import { Ribbon } from './components/layout/Ribbon';

export function MergedApp() {
  return (
    <div className="merged-app">
      <TitleBar />
      <Ribbon onAction={() => { /* no-op in Slice 1 */ }} />
      <div className="merged-canvas-region" />  {/* CSS: bg transparent */}
    </div>
  );
}
```

Styling in `src/styles/merged.css`:
```css
html, body, #root { background: transparent; }
.merged-canvas-region { flex: 1; background: transparent; }
```

### `src/main.tsx` — env-var switch

```tsx
const useMerged = import.meta.env.VITE_MERGED === '1';
if (useMerged) {
  // render <MergedApp />
} else {
  // existing App / TabletApp lazy load
}
```

### `package.json` additions

```json
{
  "scripts": {
    "dev:merged":     "cross-env VITE_MERGED=1 vite --port 5173",
    "build:merged":   "cross-env VITE_MERGED=1 vite build --outDir dist-merged",
    "run:merged":     "cargo run --release --manifest-path src-tauri/Cargo.toml --bin merged"
  }
}
```

Dev flow: two terminals — `npm run dev:merged` (serves React on 5173) and `npm run run:merged` (launches Rust binary which loads React from 5173).

Production flow (later slice): `npm run build:merged` produces static bundle; Rust binary serves it via wry's custom-protocol.

### `src-tauri/tauri.conf.json`

Unchanged. Only used by the existing `npm run tauri dev` / `npm run tauri build` (1.0). The `merged` binary bypasses Tauri entirely.

---

## Rust implementation notes

### wgpu surface from winit window (Windows-specific detail)

wgpu 22 supports `Instance::create_surface(&window)` on any `HasRawWindowHandle` + `HasRawDisplayHandle` type — winit's `Window` implements both. Slice 1 code is identical to `split_compare.rs`'s gpu init path, minus egui. Steal from `kernel/crates/app/src/gpu.rs` structurally.

### wry child webview

```rust
use wry::WebViewBuilder;
let webview = WebViewBuilder::new_as_child(&window)
    .with_transparent(true)
    .with_url("http://localhost:5173")
    .build()?;
```

The child webview covers the full window client area by default. On resize we call `webview.set_bounds(Rect { x: 0, y: 0, w, h })`.

### Frame pacing

wgpu presents when winit's `RedrawRequested` fires. winit emits it after `MainEventsCleared` if we call `window.request_redraw()` there. Result: wgpu renders at display refresh (e.g. 60 fps). wry repaints the webview asynchronously on its own cadence (WebView2 does its own compositing).

For Slice 1 we render a static blue clear — no dirty tracking needed. Each frame is the same. No performance concern.

---

## Testing

Manual only. Automated tests are premature for Slice 1.

Launch checklist:
1. Terminal A: `cd /c/Users/rickd/Documents/GitHub/open-2d-studio && npm run dev:merged`
   - Vite reports ready at http://localhost:5173
2. Terminal B: `npm run run:merged`
   - Window opens with title "Open 2D Studio (merged)", 1800×1000
3. Observe: blue below ribbon, ribbon at top with correct styling
4. Resize window 3× (smaller, larger, maximised): no flicker, no artifacts
5. Close: clean exit

---

## Risks

| # | Risk | Likelihood | Impact | Mitigation |
|---|------|------------|--------|------------|
| 1 | wry `with_transparent(true)` has DPI bugs on Windows 11 at 150% scale | Medium | High | Test early on the dev machine; if broken, try fullscreen canvas + webview as absolute-positioned child instead of full-window overlay |
| 2 | winit + wry event loop conflict causes frozen UI or missed events | Low (wry is designed for this) | High | Use `WebViewBuilder::new_as_child` — not `new` (standalone) — which explicitly shares winit's event loop |
| 3 | Vite dev server on http://localhost:5173 has CORS or mixed-content issues in wry | Low | Medium | wry supports custom http-header config; worst case, switch dev to `file://` + manual rebuild |
| 4 | Blue wgpu surface flickers during resize | Medium | Low | Expected; fix by configuring surface BEFORE wry set_bounds in the resize handler |
| 5 | User's Windows version doesn't have WebView2 runtime | Low (bundled in Windows 11) | High | Document prerequisite; detect + show friendly error in main.rs |

---

## Out of scope for Slice 1 (handled in later slices)

- **Slice 2**: Open file + wgpu scene render + pan/zoom. Reuse `kernel-core` `Scene` + `kernel-render` render pipelines.
- **Slice 3**: First drawing tool (Line) end-to-end: ribbon click → IPC → kernel tool-mode → mouse events via React → line drawn.
- **Slice 4+**: Port remaining ribbon tools one at a time (Rectangle, Circle, Polyline, Text, Hatch).
- **Slice 5+**: Panels (Layers, Properties), tabs, state bridges.
- **Slice 6+**: Extension system reconciliation.
- **Later**: IFC export bridge from Rust kernel back to React (web-ifc still runs in React for IFC generation).

---

## References

- wry 0.40 docs: https://docs.rs/wry/0.40
- winit 0.30 window + event loop patterns
- Existing `kernel/crates/app/src/bin/split_compare.rs` (winit + wgpu + egui reference)
- Existing `src/App.tsx` and `src/components/layout/Ribbon.tsx` (React shell reference)

---

## Approval

- [x] Architecture A (native wgpu + transparent web UI) — approved by user
- [x] Slice 1 scope (pure shell, blue canvas, no functionality) — approved by user
- [x] Branch strategy B (`merge-1.0-2.0`, in-place) — approved by user
- [ ] Spec reviewed by user — pending
