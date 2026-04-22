# Open 2D Studio — Merge Slice 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On branch `merge-1.0-2.0`, ship a new binary `merged.exe` that opens a single 1800×1000 window showing the 1.0 React TitleBar + Ribbon (stripped, visual-only) above a solid blue `#1E3A8A` wgpu-rendered canvas region — proving the winit + wry + wgpu hybrid compositing works on Windows.

**Architecture:** `src-tauri/src/bin/merged.rs` is a standalone binary that owns a winit window. wgpu renders a clear-pass to `#1E3A8A` on the window surface. A wry child webview (transparent) is mounted on the same window and loads a stripped React app served by Vite on port 5173. The React app renders an opaque TitleBar + Ribbon at the top and leaves the rest transparent — blue wgpu shows through.

**Tech Stack:** Rust (winit 0.30, wry 0.40, wgpu 22, pollster, anyhow, raw-window-handle), TypeScript + React 18, Vite 6, existing repo (1.0 React UI in `src/`, Tauri 2 backend config retained but not used by `merged`).

---

## Repository context (zero-assumption briefing)

Repo root: `C:\Users\rickd\Documents\GitHub\open-2d-studio\`

Structure that matters for this plan:
- `src/` — React 18 + TypeScript (1.0 app). `main.tsx` entry, `App.tsx` + `components/tablet/TabletApp` lazy-loaded. `components/layout/TitleBar/TitleBar.tsx` and `components/layout/Ribbon/Ribbon.tsx` exist BUT depend on Zustand stores + Tauri APIs + hooks — Slice 1 will NOT reuse them directly. We create stripped siblings that mimic the styling without dependencies.
- `src-tauri/` — Rust Tauri 2 backend for 1.0. `main.rs`, `lib.rs`. We add `src/bin/merged.rs` as a new binary that bypasses Tauri's high-level and uses winit+wry+wgpu directly.
- `kernel/` — Rust 2.0 native workspace. `kernel/crates/app/src/bin/split_compare.rs` is the reference for winit+wgpu init patterns. Slice 1 doesn't import kernel crates yet; Slice 2 will.
- `package.json` — npm scripts. `dev` runs vite on port 3000 (used by 1.0 via tauri.conf.json `devUrl`). We add `dev:merged` for a separate vite on port 5173.

**Branch:** work happens on `merge-1.0-2.0`. Main branch stays 1.0-only.

**Dev machine:** Windows 11, WebView2 runtime present (standard on Windows 11). High-DPI display (150% scale observed).

---

## File structure (what this plan creates/modifies)

### Created
- `src-tauri/src/bin/merged.rs` — ~200 lines. winit window + wgpu surface + wry transparent child webview + frame loop.
- `src/MergedApp.tsx` — ~30 lines. Top-level component rendering `MergedTitleBar` + `MergedRibbon` + transparent canvas region div.
- `src/components/merged/MergedTitleBar.tsx` — ~60 lines. Visual-only titlebar. No Zustand, no Tauri APIs. Copies style classes from 1.0 but uses static content.
- `src/components/merged/MergedRibbon.tsx` — ~120 lines. Visual-only ribbon with 6 groups (Files / Tools / Measure / View / Layout / Help), lucide-react icons, no click handlers (buttons are `<button disabled>`).
- `src/styles/merged.css` — ~40 lines. Transparent body + canvas region + opaque ribbon/titlebar backgrounds. Minimal dark theme reuse.
- `vite.merged.config.ts` — ~20 lines. Vite config for port 5173 + `VITE_MERGED=1` define so `main.tsx` dispatches to `MergedApp`.

### Modified
- `src-tauri/Cargo.toml` — add `[[bin]]` entry for `merged`, add deps `winit`, `wry`, `wgpu`, `pollster`, `anyhow`, `bytemuck`, `raw-window-handle`.
- `src/main.tsx` — add conditional: if `import.meta.env.VITE_MERGED === '1'` render `<MergedApp />` instead of `<App />`/`<TabletApp />`.
- `package.json` — add scripts: `dev:merged`, `run:merged`.

### Not touched
- `src-tauri/src/main.rs`, `lib.rs`, `commands/` — 1.0 Tauri backend stays intact.
- `src-tauri/tauri.conf.json` — unchanged. Still drives 1.0's `npm run tauri dev`.
- `src/App.tsx`, `components/layout/Ribbon/*.tsx`, `components/layout/TitleBar/*.tsx` — 1.0 UI intact.
- `kernel/` — not touched in Slice 1. Slice 2 will depend on `kernel-render`.

---

## Task 1: Create the branch

**Files:**
- None (git operation)

- [ ] **Step 1: Create and checkout the branch**

Run:
```bash
cd /c/Users/rickd/Documents/GitHub/open-2d-studio
git checkout -b merge-1.0-2.0
```

Expected output: `Switched to a new branch 'merge-1.0-2.0'`

- [ ] **Step 2: Verify main is unmodified**

Run:
```bash
git status
git log --oneline -3
```

Expected: working tree clean, HEAD matches main's latest commit.

- [ ] **Step 3: Initial commit marker**

Run:
```bash
git commit --allow-empty -m "chore: branch merge-1.0-2.0 baseline"
```

Expected: empty commit landed on branch.

---

## Task 2: Add Cargo dependencies and binary entry

**Files:**
- Modify: `src-tauri/Cargo.toml`

- [ ] **Step 1: Read current Cargo.toml to confirm structure**

Run:
```bash
cat src-tauri/Cargo.toml
```

Confirm the `[dependencies]` section exists and current `[package]` name is `open-2d-studio`.

- [ ] **Step 2: Add `[[bin]]` section and new deps**

Edit `src-tauri/Cargo.toml`. Append after the existing `[dependencies]` block (before `[features]`):

```toml

# --- Slice 1 merged-app deps ---
winit = "0.30"
wry = "0.40"
wgpu = "22"
pollster = "0.3"
anyhow = "1"
bytemuck = { version = "1.19", features = ["derive"] }
raw-window-handle = "0.6"

# --- Binaries ---
[[bin]]
name = "merged"
path = "src/bin/merged.rs"
```

(The existing `[lib]` section may conflict with adding `[[bin]]` — if Cargo complains, add `autobins = false` under `[package]` and keep the explicit `[[bin]]`. If it doesn't complain, leave as-is.)

- [ ] **Step 3: Verify Cargo parses and fetches new deps**

Run:
```bash
cd src-tauri && cargo metadata --format-version=1 >/dev/null && echo OK
```

Expected: `OK`. If it errors, read the error and fix the toml (usually a syntax issue in the added block).

- [ ] **Step 4: Commit**

```bash
cd /c/Users/rickd/Documents/GitHub/open-2d-studio
git add src-tauri/Cargo.toml
git commit -m "feat(merged): add winit+wry+wgpu deps and bin entry"
```

---

## Task 3: Skeleton `merged.rs` — just open a window

**Files:**
- Create: `src-tauri/src/bin/merged.rs`

- [ ] **Step 1: Create the bin directory**

Run:
```bash
mkdir -p src-tauri/src/bin
```

- [ ] **Step 2: Write the skeleton**

Create `src-tauri/src/bin/merged.rs` with:

```rust
//! merged.exe — Slice 1 of the 1.0 + 2.0 merge.
//!
//! Opens a single winit window, mounts a wry transparent child webview
//! over it, and clears a wgpu surface to `#1E3A8A` every frame. The React
//! app served at http://localhost:5173 renders an opaque TitleBar + Ribbon
//! at the top; the rest of the webview is transparent so the wgpu blue
//! shows through.
//!
//! See docs/superpowers/specs/2026-04-22-open2d-merge-slice1-design.md.

use anyhow::Result;
use winit::{
    application::ApplicationHandler,
    event::WindowEvent,
    event_loop::{ActiveEventLoop, EventLoop},
    window::{Window, WindowId},
};

struct App {
    window: Option<Window>,
}

impl ApplicationHandler for App {
    fn resumed(&mut self, event_loop: &ActiveEventLoop) {
        if self.window.is_some() {
            return;
        }
        let attrs = Window::default_attributes()
            .with_title("Open 2D Studio (merged)")
            .with_inner_size(winit::dpi::LogicalSize::new(1800, 1000));
        let window = event_loop
            .create_window(attrs)
            .expect("create window");
        self.window = Some(window);
    }

    fn window_event(
        &mut self,
        event_loop: &ActiveEventLoop,
        _id: WindowId,
        event: WindowEvent,
    ) {
        match event {
            WindowEvent::CloseRequested => event_loop.exit(),
            _ => {}
        }
    }
}

fn main() -> Result<()> {
    let event_loop = EventLoop::new()?;
    event_loop.set_control_flow(winit::event_loop::ControlFlow::Wait);
    let mut app = App { window: None };
    event_loop.run_app(&mut app)?;
    Ok(())
}
```

- [ ] **Step 3: Build the skeleton**

Run:
```bash
cd src-tauri && cargo build --release --bin merged 2>&1 | tail -20
```

Expected: `Finished \`release\` profile [optimized] target(s)` with no errors. Compile takes ~1–3 min on first build due to wry/winit/wgpu being fresh.

- [ ] **Step 4: Smoke-run to confirm window opens**

Run:
```bash
./target/release/merged.exe
```

Expected: empty 1800×1000 window titled "Open 2D Studio (merged)" opens. Contents are undefined (native default — usually system grey or glitched). Close the window to exit.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/bin/merged.rs
git commit -m "feat(merged): skeleton winit window"
```

---

## Task 4: Add wgpu surface with blue clear-pass

**Files:**
- Modify: `src-tauri/src/bin/merged.rs`

- [ ] **Step 1: Replace file contents with wgpu-integrated version**

Overwrite `src-tauri/src/bin/merged.rs` with:

```rust
//! merged.exe — Slice 1 of the 1.0 + 2.0 merge.
//!
//! Opens a single winit window, initialises a wgpu surface on it, and
//! clears to `#1E3A8A` every frame. wry webview is added in Task 5.

use anyhow::{Context, Result};
use std::sync::Arc;
use wgpu::SurfaceError;
use winit::{
    application::ApplicationHandler,
    event::WindowEvent,
    event_loop::{ActiveEventLoop, EventLoop},
    window::{Window, WindowId},
};

/// Resources that only exist once the OS has given us a window. winit's
/// `ApplicationHandler` pattern spins these up in `resumed()`.
struct GpuState {
    surface: wgpu::Surface<'static>,
    device: wgpu::Device,
    queue: wgpu::Queue,
    config: wgpu::SurfaceConfiguration,
}

struct App {
    window: Option<Arc<Window>>,
    gpu: Option<GpuState>,
}

impl App {
    fn new() -> Self {
        Self { window: None, gpu: None }
    }

    async fn init_gpu(window: Arc<Window>) -> Result<GpuState> {
        let instance = wgpu::Instance::new(wgpu::InstanceDescriptor {
            backends: wgpu::Backends::PRIMARY,
            ..Default::default()
        });
        // Arc keeps the window alive for the 'static surface lifetime.
        let surface = instance
            .create_surface(window.clone())
            .context("create surface")?;
        let adapter = instance
            .request_adapter(&wgpu::RequestAdapterOptions {
                power_preference: wgpu::PowerPreference::HighPerformance,
                compatible_surface: Some(&surface),
                force_fallback_adapter: false,
            })
            .await
            .context("no suitable GPU adapter")?;
        let (device, queue) = adapter
            .request_device(
                &wgpu::DeviceDescriptor {
                    label: Some("merged.device"),
                    required_features: wgpu::Features::empty(),
                    required_limits: wgpu::Limits::default(),
                    memory_hints: wgpu::MemoryHints::default(),
                },
                None,
            )
            .await
            .context("request device")?;

        let inner = window.inner_size();
        let caps = surface.get_capabilities(&adapter);
        let format = caps
            .formats
            .iter()
            .copied()
            .find(|f| f.is_srgb())
            .unwrap_or(caps.formats[0]);
        let config = wgpu::SurfaceConfiguration {
            usage: wgpu::TextureUsages::RENDER_ATTACHMENT,
            format,
            width: inner.width.max(1),
            height: inner.height.max(1),
            present_mode: wgpu::PresentMode::Fifo,
            alpha_mode: caps.alpha_modes[0],
            view_formats: vec![],
            desired_maximum_frame_latency: 2,
        };
        surface.configure(&device, &config);
        Ok(GpuState { surface, device, queue, config })
    }

    fn render(&mut self) {
        let Some(gpu) = self.gpu.as_mut() else { return };
        let frame = match gpu.surface.get_current_texture() {
            Ok(f) => f,
            Err(SurfaceError::Lost) | Err(SurfaceError::Outdated) => {
                gpu.surface.configure(&gpu.device, &gpu.config);
                return;
            }
            Err(_) => return,
        };
        let view = frame
            .texture
            .create_view(&wgpu::TextureViewDescriptor::default());
        let mut enc = gpu
            .device
            .create_command_encoder(&wgpu::CommandEncoderDescriptor {
                label: Some("merged.encoder"),
            });
        {
            let _pass = enc.begin_render_pass(&wgpu::RenderPassDescriptor {
                label: Some("merged.clear"),
                color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                    view: &view,
                    resolve_target: None,
                    ops: wgpu::Operations {
                        // #1E3A8A = rgb(30, 58, 138). sRGB→linear for
                        // accurate on-screen colour given SRGB surface.
                        load: wgpu::LoadOp::Clear(wgpu::Color {
                            r: 0.01298,  // (30/255)^2.2
                            g: 0.04667,  // (58/255)^2.2
                            b: 0.26225,  // (138/255)^2.2
                            a: 1.0,
                        }),
                        store: wgpu::StoreOp::Store,
                    },
                })],
                depth_stencil_attachment: None,
                timestamp_writes: None,
                occlusion_queries: None,
            });
        }
        gpu.queue.submit(Some(enc.finish()));
        frame.present();
    }

    fn resize(&mut self, w: u32, h: u32) {
        let Some(gpu) = self.gpu.as_mut() else { return };
        gpu.config.width = w.max(1);
        gpu.config.height = h.max(1);
        gpu.surface.configure(&gpu.device, &gpu.config);
    }
}

impl ApplicationHandler for App {
    fn resumed(&mut self, event_loop: &ActiveEventLoop) {
        if self.window.is_some() {
            return;
        }
        let attrs = Window::default_attributes()
            .with_title("Open 2D Studio (merged)")
            .with_inner_size(winit::dpi::LogicalSize::new(1800, 1000));
        let window = Arc::new(
            event_loop.create_window(attrs).expect("create window"),
        );
        let gpu = pollster::block_on(Self::init_gpu(window.clone()))
            .expect("init gpu");
        self.window = Some(window);
        self.gpu = Some(gpu);
    }

    fn window_event(
        &mut self,
        event_loop: &ActiveEventLoop,
        _id: WindowId,
        event: WindowEvent,
    ) {
        match event {
            WindowEvent::CloseRequested => event_loop.exit(),
            WindowEvent::Resized(size) => self.resize(size.width, size.height),
            WindowEvent::RedrawRequested => self.render(),
            _ => {}
        }
    }

    fn about_to_wait(&mut self, _event_loop: &ActiveEventLoop) {
        if let Some(w) = self.window.as_ref() {
            w.request_redraw();
        }
    }
}

fn main() -> Result<()> {
    let event_loop = EventLoop::new()?;
    event_loop.set_control_flow(winit::event_loop::ControlFlow::Poll);
    let mut app = App::new();
    event_loop.run_app(&mut app)?;
    Ok(())
}
```

- [ ] **Step 2: Rebuild**

Run:
```bash
cd src-tauri && cargo build --release --bin merged 2>&1 | tail -10
```

Expected: `Finished` with no errors.

- [ ] **Step 3: Smoke-run to confirm blue window**

Run:
```bash
./target/release/merged.exe
```

Expected: 1800×1000 window filled with solid blue (`#1E3A8A` approximately — dark navy). Resize the window: blue fills the new size, no black bands, no flicker. Close to exit.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/bin/merged.rs
git commit -m "feat(merged): wgpu surface with blue clear-pass"
```

---

## Task 5: Add wry transparent child webview pointing at `about:blank`

**Files:**
- Modify: `src-tauri/src/bin/merged.rs`

Goal of this task: prove wry's child webview renders on top of the wgpu surface with transparency correctly (before we add a React app).

- [ ] **Step 1: Extend the struct and resumed() to create the webview**

Edit `src-tauri/src/bin/merged.rs`. Add `webview: Option<wry::WebView>` to `App` struct:

Replace:
```rust
struct App {
    window: Option<Arc<Window>>,
    gpu: Option<GpuState>,
}

impl App {
    fn new() -> Self {
        Self { window: None, gpu: None }
    }
```

With:
```rust
struct App {
    window: Option<Arc<Window>>,
    gpu: Option<GpuState>,
    webview: Option<wry::WebView>,
}

impl App {
    fn new() -> Self {
        Self { window: None, gpu: None, webview: None }
    }
```

- [ ] **Step 2: Add webview creation in resumed()**

At the end of `resumed()`, after `self.gpu = Some(gpu);`, add:

```rust
        // Child webview over the same window. Transparent so wgpu shows
        // through wherever the page has CSS background: transparent.
        let webview = wry::WebViewBuilder::new_as_child(window.as_ref())
            .with_transparent(true)
            .with_url("data:text/html,<html><body style='margin:0;background:transparent'><div style='background:#2b2b33;color:white;padding:12px;font-family:sans-serif'>webview online</div></body></html>")
            .build()
            .expect("build webview");
        self.webview = Some(webview);
```

Note: `wry::WebViewBuilder::new_as_child` takes `&Window`. Because `window` is `Arc<Window>`, pass `window.as_ref()`.

- [ ] **Step 3: Sync webview bounds on resize**

In the `resize` method (after `surface.configure`), add:

```rust
        if let Some(wv) = self.webview.as_ref() {
            let _ = wv.set_bounds(wry::Rect {
                position: wry::dpi::LogicalPosition::new(0, 0).into(),
                size: wry::dpi::LogicalSize::new(
                    (w as f64).max(1.0) as u32,
                    (h as f64).max(1.0) as u32,
                ).into(),
            });
        }
```

- [ ] **Step 4: Rebuild and smoke-run**

Run:
```bash
cd src-tauri && cargo build --release --bin merged 2>&1 | tail -10
./target/release/merged.exe
```

Expected: window opens. Top-left shows a small dark-grey strip with text "webview online". The rest of the window is blue (wgpu surface visible through the transparent webview). Resize: the webview header stays pinned top-left at its natural size, blue continues below.

Troubleshooting: if the whole window is white/grey (webview opaque), re-check `with_transparent(true)` + the HTML's `background:transparent`. If webview doesn't appear, inspect stderr — likely a WebView2 runtime error path.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/bin/merged.rs
git commit -m "feat(merged): add wry transparent child webview"
```

---

## Task 6: Create React MergedApp skeleton + stripped TitleBar + Ribbon

**Files:**
- Create: `src/MergedApp.tsx`
- Create: `src/components/merged/MergedTitleBar.tsx`
- Create: `src/components/merged/MergedRibbon.tsx`
- Create: `src/styles/merged.css`

- [ ] **Step 1: Create the directory**

Run:
```bash
mkdir -p src/components/merged
```

- [ ] **Step 2: Write the stripped TitleBar**

Create `src/components/merged/MergedTitleBar.tsx` with:

```tsx
import { Minus, Square, X } from 'lucide-react';

/**
 * Stripped visual-only titlebar for Slice 1 of the merge.
 * No Zustand, no Tauri APIs — pure presentation.
 * Buttons are static; clicks are no-op.
 */
export function MergedTitleBar() {
  return (
    <div className="merged-titlebar">
      <div className="merged-titlebar__left">
        <div className="merged-titlebar__icon" />
        <span className="merged-titlebar__title">Open 2D Studio — merged</span>
      </div>
      <div className="merged-titlebar__center" />
      <div className="merged-titlebar__controls">
        <button type="button" className="merged-titlebar__ctrl" disabled>
          <Minus size={14} />
        </button>
        <button type="button" className="merged-titlebar__ctrl" disabled>
          <Square size={12} />
        </button>
        <button type="button" className="merged-titlebar__ctrl merged-titlebar__ctrl--close" disabled>
          <X size={14} />
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Write the stripped Ribbon**

Create `src/components/merged/MergedRibbon.tsx` with:

```tsx
import {
  FolderOpen, FilePlus, Download,
  MousePointer2, Move, RotateCw,
  Ruler, Tag, Square,
  Layers, Settings, Grid3X3,
  Columns, Rows, Eye,
  Info,
} from 'lucide-react';
import type { ComponentType, SVGProps } from 'react';

type IconComp = ComponentType<SVGProps<SVGSVGElement>>;

function BigButton({ icon: Icon, label }: { icon: IconComp; label: string }) {
  return (
    <button type="button" className="merged-ribbon__big" disabled>
      <Icon size={28} />
      <span>{label}</span>
    </button>
  );
}

function SmallButton({ icon: Icon, label }: { icon: IconComp; label: string }) {
  return (
    <button type="button" className="merged-ribbon__small" disabled>
      <Icon size={14} />
      <span>{label}</span>
    </button>
  );
}

function Group({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="merged-ribbon__group">
      <div className="merged-ribbon__group-body">{children}</div>
      <div className="merged-ribbon__group-title">{title}</div>
    </div>
  );
}

export function MergedRibbon() {
  return (
    <div className="merged-ribbon">
      <Group title="Files">
        <BigButton icon={FolderOpen} label="Open" />
        <div className="merged-ribbon__stack">
          <SmallButton icon={FilePlus} label="New Tab" />
          <SmallButton icon={Download} label="Save As" />
        </div>
      </Group>

      <Group title="Tools">
        <BigButton icon={MousePointer2} label="Select" />
        <div className="merged-ribbon__stack">
          <SmallButton icon={Move} label="Move" />
          <SmallButton icon={RotateCw} label="Rotate" />
        </div>
      </Group>

      <Group title="Measure">
        <BigButton icon={Ruler} label="Measure" />
        <div className="merged-ribbon__stack">
          <SmallButton icon={Tag} label="Dim" />
          <SmallButton icon={Square} label="Area" />
        </div>
      </Group>

      <Group title="View">
        <div className="merged-ribbon__stack">
          <SmallButton icon={Layers} label="Layers" />
          <SmallButton icon={Settings} label="Properties" />
          <SmallButton icon={Grid3X3} label="Grid" />
          <SmallButton icon={Eye} label="Show" />
        </div>
      </Group>

      <Group title="Layout">
        <div className="merged-ribbon__stack">
          <SmallButton icon={Columns} label="Split H" />
          <SmallButton icon={Rows} label="Split V" />
          <SmallButton icon={Square} label="Unsplit" />
        </div>
      </Group>

      <Group title="Help">
        <div className="merged-ribbon__stack">
          <SmallButton icon={Info} label="About" />
        </div>
      </Group>
    </div>
  );
}
```

- [ ] **Step 4: Write the CSS**

Create `src/styles/merged.css` with:

```css
/* merged.css — Slice 1 of the 1.0 + 2.0 merge.
   Transparent body + opaque TitleBar & Ribbon so the wgpu surface
   shows through the empty canvas region below. */

html, body, #root {
  background: transparent !important;
  margin: 0;
  padding: 0;
  color: #e6e6e6;
  font-family: 'Segoe UI', sans-serif;
  height: 100%;
}

.merged-app {
  display: flex;
  flex-direction: column;
  height: 100%;
  width: 100%;
}

/* ---- TitleBar ---- */

.merged-titlebar {
  display: flex;
  align-items: center;
  height: 32px;
  background: #1f232a;
  border-bottom: 1px solid #14171c;
  padding: 0 8px;
  gap: 8px;
  flex-shrink: 0;
}

.merged-titlebar__left { display: flex; align-items: center; gap: 8px; }
.merged-titlebar__icon {
  width: 16px; height: 16px;
  background: #007acc;
  border-radius: 3px;
}
.merged-titlebar__title { font-size: 12px; color: #b8bfc9; }
.merged-titlebar__center { flex: 1; }
.merged-titlebar__controls { display: flex; gap: 2px; }
.merged-titlebar__ctrl {
  width: 36px; height: 26px;
  background: transparent; border: 0;
  color: #9aa3ad; cursor: default;
}
.merged-titlebar__ctrl:hover { background: #2a2f38; }
.merged-titlebar__ctrl--close:hover { background: #c42b1c; color: #fff; }

/* ---- Ribbon ---- */

.merged-ribbon {
  display: flex;
  background: #2b303a;
  border-bottom: 1px solid #14171c;
  padding: 4px 8px;
  gap: 0;
  flex-shrink: 0;
  min-height: 96px;
}

.merged-ribbon__group {
  display: flex;
  flex-direction: column;
  border-right: 1px solid #1f232a;
  padding: 2px 8px 0 8px;
}
.merged-ribbon__group:last-child { border-right: 0; }
.merged-ribbon__group-body {
  display: flex;
  gap: 4px;
  flex: 1;
  align-items: center;
}
.merged-ribbon__group-title {
  font-size: 10px;
  text-transform: uppercase;
  color: #6c7380;
  text-align: center;
  letter-spacing: 0.5px;
  padding-top: 2px;
}

.merged-ribbon__big {
  display: flex; flex-direction: column;
  align-items: center; justify-content: center;
  width: 64px; min-height: 62px;
  background: transparent; border: 0;
  color: #cbd3dd;
  font-size: 11px;
  gap: 4px;
  cursor: default;
}
.merged-ribbon__big[disabled] { opacity: 0.75; }
.merged-ribbon__big:hover:not([disabled]) { background: #3a4050; }

.merged-ribbon__stack {
  display: flex; flex-direction: column;
  gap: 2px;
}
.merged-ribbon__small {
  display: flex; align-items: center;
  gap: 6px;
  padding: 3px 8px;
  background: transparent; border: 0;
  color: #cbd3dd;
  font-size: 11px;
  text-align: left;
  min-width: 100px;
  cursor: default;
}
.merged-ribbon__small[disabled] { opacity: 0.75; }
.merged-ribbon__small:hover:not([disabled]) { background: #3a4050; }

/* ---- Canvas region (transparent) ---- */

.merged-canvas-region {
  flex: 1;
  background: transparent;
  pointer-events: none;  /* Slice 1: no canvas interaction */
}
```

- [ ] **Step 5: Write MergedApp**

Create `src/MergedApp.tsx` with:

```tsx
import './styles/merged.css';
import { MergedTitleBar } from './components/merged/MergedTitleBar';
import { MergedRibbon } from './components/merged/MergedRibbon';

/**
 * Slice 1 root component — visual shell over a transparent canvas.
 * No state, no IPC, no interaction. See docs/superpowers/specs/
 * 2026-04-22-open2d-merge-slice1-design.md.
 */
export default function MergedApp() {
  return (
    <div className="merged-app">
      <MergedTitleBar />
      <MergedRibbon />
      <div className="merged-canvas-region" />
    </div>
  );
}
```

- [ ] **Step 6: Commit**

```bash
git add src/MergedApp.tsx src/components/merged src/styles/merged.css
git commit -m "feat(merged): stripped React shell — TitleBar + Ribbon + canvas region"
```

---

## Task 7: Dispatch `main.tsx` to `MergedApp` when `VITE_MERGED=1`

**Files:**
- Modify: `src/main.tsx`

- [ ] **Step 1: Read current main.tsx**

Run:
```bash
cat src/main.tsx
```

Confirm the structure (lazy-loaded `App`/`TabletApp`, `ErrorBoundary`, etc).

- [ ] **Step 2: Add merged branch before the existing lazy-load**

Edit `src/main.tsx`. Replace the `AppComponent` lazy-load block:

```tsx
const AppComponent = React.lazy(() =>
  isMobileViewer()
    ? import('./components/tablet/TabletApp')
    : import('./App')
);
```

With:

```tsx
// Slice 1 of the 1.0 + 2.0 merge: when VITE_MERGED=1 is set (via
// vite.merged.config.ts or npm run dev:merged), render the stripped
// MergedApp shell instead of the full 1.0 App. See
// docs/superpowers/specs/2026-04-22-open2d-merge-slice1-design.md.
const isMerged = import.meta.env.VITE_MERGED === '1';

const AppComponent = React.lazy(() =>
  isMerged
    ? import('./MergedApp')
    : isMobileViewer()
      ? import('./components/tablet/TabletApp')
      : import('./App')
);
```

- [ ] **Step 3: Verify TypeScript accepts the env access**

Run:
```bash
npx tsc --noEmit 2>&1 | grep -E "error|src/main" | head -10
```

Expected: no errors on the modified block. If TypeScript complains that `import.meta.env.VITE_MERGED` is not typed, add `VITE_MERGED?: string` to the `ImportMetaEnv` interface in `src/vite-env.d.ts` (or create the file if missing):

```ts
/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_MERGED?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
```

- [ ] **Step 4: Commit**

```bash
git add src/main.tsx src/vite-env.d.ts 2>/dev/null || git add src/main.tsx
git commit -m "feat(merged): main.tsx dispatches to MergedApp when VITE_MERGED=1"
```

---

## Task 8: Vite config + npm scripts for the merged dev server

**Files:**
- Create: `vite.merged.config.ts`
- Modify: `package.json`

- [ ] **Step 1: Write `vite.merged.config.ts`**

Create at repo root `vite.merged.config.ts`:

```ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Slice 1 merged-app Vite config. Runs on port 5173 (1.0 uses 3000 via
// tauri.conf.json), sets VITE_MERGED=1 so main.tsx dispatches to
// MergedApp, disables strict-mode HMR flicker by using default HMR.
export default defineConfig({
  plugins: [react()],
  define: {
    'import.meta.env.VITE_MERGED': JSON.stringify('1'),
  },
  server: {
    port: 5173,
    strictPort: true,
    host: '127.0.0.1',
  },
  build: {
    outDir: 'dist-merged',
    emptyOutDir: true,
  },
});
```

- [ ] **Step 2: Add npm scripts**

Edit `package.json`. In the `"scripts"` block, add after the existing `"test"`:

```json
    "dev:merged": "vite --config vite.merged.config.ts",
    "build:merged": "tsc && vite build --config vite.merged.config.ts",
    "run:merged": "cargo run --release --manifest-path src-tauri/Cargo.toml --bin merged",
```

- [ ] **Step 3: Start the merged Vite dev server to verify**

Run in terminal A:
```bash
npm run dev:merged
```

Expected: vite reports `Local: http://127.0.0.1:5173/`. Open that URL in a regular browser to verify React renders: you should see the stripped ribbon + titlebar on a dark surface (no blue here — this is plain browser, wgpu-transparency is only visible in merged.exe).

Keep the dev server running.

- [ ] **Step 4: Commit**

```bash
git add vite.merged.config.ts package.json
git commit -m "feat(merged): vite config + npm scripts for port 5173 dev"
```

---

## Task 9: Point the wry webview at localhost:5173 and run end-to-end

**Files:**
- Modify: `src-tauri/src/bin/merged.rs`

- [ ] **Step 1: Replace the data:text URL with localhost**

In `src-tauri/src/bin/merged.rs`, find the line:

```rust
.with_url("data:text/html,<html><body style='margin:0;background:transparent'><div style='background:#2b2b33;color:white;padding:12px;font-family:sans-serif'>webview online</div></body></html>")
```

Replace with:

```rust
.with_url("http://127.0.0.1:5173")
```

- [ ] **Step 2: Rebuild merged.exe**

In terminal B (Vite stays running in A):

```bash
cd src-tauri && cargo build --release --bin merged 2>&1 | tail -5
```

Expected: `Finished` no errors.

- [ ] **Step 3: Launch the merged binary**

Still in terminal B:

```bash
./target/release/merged.exe
```

Expected result — this is the Slice 1 acceptance test:

1. 1800×1000 window opens titled "Open 2D Studio (merged)".
2. **Top 32 px**: dark titlebar, blue square icon, "Open 2D Studio — merged" text, 3 disabled window controls on the right.
3. **Next ~96 px**: dark ribbon with 6 groups — Files / Tools / Measure / View / Layout / Help — each with big-icon + stack buttons, group-title label underneath.
4. **Below the ribbon**: solid blue `#1E3A8A` filling the rest.
5. **Resize** the window to smaller (e.g. 1200×700) and bigger (e.g. 2200×1400) and maximise. In all cases the ribbon + titlebar pin to the top, blue fills the rest, no flicker / black bands.
6. **Close button** on the real OS window chrome (top-right) — the window closes cleanly, process exits.

If any step fails, see Task 10 (troubleshooting).

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/bin/merged.rs
git commit -m "feat(merged): point webview at localhost:5173"
```

- [ ] **Step 5: Stop the Vite dev server** (Ctrl+C in terminal A) once verified.

---

## Task 10: Troubleshooting runbook (documented, no code change needed)

**Files:**
- Create: `docs/superpowers/plans/2026-04-22-open2d-merge-slice1-troubleshooting.md`

- [ ] **Step 1: Write the runbook**

Create `docs/superpowers/plans/2026-04-22-open2d-merge-slice1-troubleshooting.md` with:

````markdown
# Slice 1 Troubleshooting

## Symptom: blank white window instead of blue+ribbon

Cause: webview is opaque — `with_transparent(true)` not honoured, or page has a non-transparent background.

Fix:
- Verify `src/styles/merged.css` has `html, body, #root { background: transparent !important; }`
- Verify the WebView2 runtime is Windows-11-era; older runtimes have transparency bugs. Update Edge.
- Inspect the page: `./target/release/merged.exe` — right-click inside webview, "Inspect" (WebView2 has dev-tools). Check computed `background-color` on `body` is `rgba(0,0,0,0)`.

## Symptom: webview shows but covers the full window (no blue visible)

Cause: webview bounds wrong, or the canvas region isn't transparent.

Fix:
- Confirm `.merged-canvas-region { background: transparent; }` in CSS.
- Temporarily set `background: #ff00ff` on the canvas region — if you see magenta, transparency is the issue (webview is blocking). If magenta also shows over the ribbon, the flex layout is wrong.

## Symptom: webview doesn't load, just a grey box

Cause: Vite dev server not reachable.

Fix:
- Confirm terminal A shows `Local: http://127.0.0.1:5173/`.
- Confirm `merged.rs` uses `127.0.0.1` (not `localhost` — some Windows setups have DNS weirdness). IPv6 `::1` can also fail silently.
- Curl-test: `curl http://127.0.0.1:5173` should return the Vite HTML.

## Symptom: resize flickers or shows black bands

Cause: wgpu surface reconfig happens AFTER webview set_bounds, or before the frame repaints.

Fix:
- In `App::resize`, configure `gpu.surface` BEFORE calling `webview.set_bounds`.
- If still flickering, try `present_mode: Immediate` in the surface config (trade vsync for latency).

## Symptom: build error `no method named 'new_as_child'`

Cause: wry major-version mismatch. The plan targets wry 0.40.

Fix:
- `cd src-tauri && cargo update -p wry` — confirm `wry` resolves to `0.40.x`.
- If Cargo.lock pins an older version, delete it and re-resolve: `rm Cargo.lock && cargo build`.

## Symptom: build error `window.as_ref()` not a `HasWindowHandle`

Cause: winit `Window` inside `Arc` — wry wants `&Window`, not `&Arc<Window>`.

Fix:
- Pass `window.as_ref()` where `window: Arc<Window>` — that returns `&Window` via `Arc::deref`.
- Alternatively: pass `&**window`.

## Symptom: high-DPI window renders at 1x and looks tiny

Cause: winit logical-vs-physical confusion.

Fix:
- Ensure `with_inner_size(LogicalSize::new(1800, 1000))` (not `PhysicalSize`). Winit 0.30 converts logical → physical via the monitor scale factor.
- wry's `set_bounds` accepts `LogicalPosition`/`LogicalSize` — the plan code uses those. If physical sneaks in, the webview is half-size on 200% DPI.
````

- [ ] **Step 2: Commit**

```bash
git add docs/superpowers/plans/2026-04-22-open2d-merge-slice1-troubleshooting.md
git commit -m "docs(merged): Slice 1 troubleshooting runbook"
```

---

## Task 11: Final verification and handoff

- [ ] **Step 1: Full clean rebuild + launch**

```bash
cd /c/Users/rickd/Documents/GitHub/open-2d-studio
# Terminal A:
npm run dev:merged &
sleep 4  # give Vite time to boot
# Terminal B:
cd src-tauri && cargo build --release --bin merged && ./target/release/merged.exe
```

Expected: the Slice 1 acceptance test from Task 9 Step 3 passes fully.

- [ ] **Step 2: Screenshot evidence**

Take a screenshot (PowerShell or any tool) of the running merged window. Save to `docs/superpowers/plans/artefacts/2026-04-22-slice1-acceptance.png`.

Command (PowerShell):
```powershell
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$p = Get-Process merged
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
New-Item -Force -Type Directory docs/superpowers/plans/artefacts | Out-Null
$bmp.Save("docs/superpowers/plans/artefacts/2026-04-22-slice1-acceptance.png", [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose(); $bmp.Dispose()
```

- [ ] **Step 3: Commit the artefact**

```bash
git add docs/superpowers/plans/artefacts/2026-04-22-slice1-acceptance.png
git commit -m "docs(merged): Slice 1 acceptance screenshot"
```

- [ ] **Step 4: Branch summary commit**

```bash
git log --oneline merge-1.0-2.0 ^main
```

Expected: ~11 commits listed, one per task. This is the branch's story.

- [ ] **Step 5: Push branch (optional, user's call)**

If the user wants the branch pushed to origin:

```bash
git push -u origin merge-1.0-2.0
```

---

## Self-Review Results

**Spec coverage:**
- ✅ Success criterion 1 (launches 1800×1000 window) → Task 3 Step 2, Task 4 Step 3, Task 9 Step 3
- ✅ Success criterion 2 (ribbon visible, 6 groups, correct styling) → Task 6, Task 9 Step 3
- ✅ Success criterion 3 (titlebar visible) → Task 6, Task 9 Step 3
- ✅ Success criterion 4 (solid blue #1E3A8A below ribbon) → Task 4, Task 9 Step 3
- ✅ Success criterion 5 (resize no flicker) → Task 4 Step 3, Task 9 Step 3, Task 10 runbook
- ✅ Success criterion 6 (close works) → Task 3, Task 9 Step 3
- ✅ Explicit non-goals observed: no Zustand store import in MergedApp, buttons `disabled`, no file-open, no IPC
- ✅ Architecture A (winit+wry+wgpu hybrid) → Task 3/4/5/9
- ✅ Branch strategy B (`merge-1.0-2.0` in-place) → Task 1
- ✅ Risk 1 (wry DPI) → Task 10 runbook
- ✅ Risk 2 (event loop conflict) → `new_as_child` used in Task 5 Step 2
- ✅ Risk 3 (Vite CORS) → Task 9 uses `http://127.0.0.1:5173`, documented in Task 10
- ✅ Risk 4 (resize flicker) → Task 10 runbook has mitigation
- ✅ Risk 5 (WebView2 missing) → Task 10 mentions WebView2 runtime check

**Placeholder scan:** no TBD, TODO, "implement later", or "similar to Task N" references.

**Type consistency:** `GpuState` / `App` / `MergedApp` / `MergedTitleBar` / `MergedRibbon` names used consistently across tasks. wry `Rect`/`LogicalPosition`/`LogicalSize` types match 0.40 API. winit `Window`/`WindowId`/`ActiveEventLoop` match 0.30 API.

**Scope:** single-plan; 11 tasks; all produce incremental commits; branch remains functional after each task (no mid-task breakage).
