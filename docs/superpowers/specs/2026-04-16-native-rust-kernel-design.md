# Native Rust Kernel — Design Specification

> **Datum:** 2026-04-16
> **Branch:** `native-kernel-rust`
> **Status:** ⚠️ **Superseded — zie Route A+ in parliament-synthesis.md**
> **Route gekozen:** A+ (gewijzigde versie met spike-fase + parallelle feature releases)
> **Scope:** Volledige herbouw van de engine als native Rust desktop applicatie
> **Voorgaande baseline:** TypeScript + Canvas 2D + Tauri (master branch)

---

## ⚠️ BELANGRIJKE UPDATE (2026-04-16, na parlementair debat)

Na kritische review door 7 rollen (2 rondes) is de oorspronkelijke roadmap van 18-24 weken
verworpen als ongeloofwaardig. De opdrachtgever heeft gekozen voor **Route A+**:

1. **Week 1-2:** spec-herziening met robuustheidssectie, implementatie-details, crate-versies
2. **Week 3-4:** spike-fase — risicovolle prototypes valideren voor go/no-go
3. **Maand 1-6:** 3 commerciële features shippen parallel aan kernel-voorbereiding
   - IFC4X3 import (maand 1-2)
   - Revit-roundtrip via IFC (maand 3-4)
   - Cloud-sync light (maand 5-6)
4. **Maand 7-18:** Rust-kernel-herbouw in fases (was: maand 1-6)
5. **Parallel:** Tekenaar's bugs in huidige TS kernel fixen (undo-scope, block-instances, hatch scaling, snap cycling)

**Kill-criteria** (wanneer terug naar master TS-kernel):
- Spike-prototype faalt op 100k shapes @ 60fps (target 120 was ambitieus)
- Precisie-testsuite op 1000 km faalt na Shewchuk-integratie
- Spec-addendum onvoldoende scherp na week 2
- Maand 4 review: MVP-features lopen 6+ weken uit

Zie `2026-04-16-parliament-synthesis.md` voor volledige context.

---

## 1. Doelstellingen

### Functionele doelen

- **Performance:** 100.000 shapes renderen @ 120 fps op mid-range hardware
- **Bestandsgrootte:** 40 MB DWG-achtige bestanden (duizenden teksten en lijnen) soepel openen en bewerken
- **Precisie:** 0.001 mm (1 µm) detail op 1000 km afstand van origin
- **Feature-pariteit:** alle bestaande features van de TypeScript versie behouden
- **Cold start:** < 500 ms op typische hardware

### Non-functionele doelen

- Native desktop application (geen browser runtime)
- Eén binary per platform (Windows/macOS/Linux)
- Geheugenvoetafdruk < 500 MB bij 100k shapes
- Uitbreidbaar via Rust plugins + JavaScript extensions (backwards-compatible)

### Non-goals (deze spec)

- DWG native support (wordt apart vraagstuk, later)
- Cloud-sync features
- Web-deployment (deze versie is desktop-only)
- Mobile (tablet viewer) — blijft TypeScript versie

---

## 2. Architectuur-overzicht

```
┌─────────────────────────────────────────────────────────┐
│  Rust Native Binary (open-2d-studio.exe, ~10 MB)        │
├─────────────────────────────────────────────────────────┤
│                                                          │
│  ┌──────────┐  ┌──────────┐  ┌─────────────────────┐   │
│  │  egui UI │  │  Canvas  │  │  Webview Subwindow  │   │
│  │ (Ribbon, │◀▶│ (wgpu    │  │  (complex dialogs)  │   │
│  │ panels)  │  │  render) │  │  React + Leaflet    │   │
│  └────┬─────┘  └────┬─────┘  └──────────┬──────────┘   │
│       │             │                    │              │
│       └─────────────┼────────────────────┘              │
│                     ▼                                    │
│  ┌──────────────────────────────────────────────────┐   │
│  │   bevy_ecs::World (main thread, Send+Sync)       │   │
│  └──────────────────────────────────────────────────┘   │
│                     ▼                                    │
│  ┌──────────────────────────────────────────────────┐   │
│  │  ECS System Schedule (parallel stages)           │   │
│  └──────────────────────────────────────────────────┘   │
│                     ▼                                    │
│  ┌──────────────────────────────────────────────────┐   │
│  │  GPU (wgpu → DX12 / Metal / Vulkan)              │   │
│  └──────────────────────────────────────────────────┘   │
│                     ▼                                    │
│  ┌──────────────────────────────────────────────────┐   │
│  │  Rayon Pool (I/O + heavy tessellation)           │   │
│  └──────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
```

### Tech stack

| Laag | Keuze | Rationale |
|------|-------|-----------|
| Window & events | `winit` | Standaard voor Rust desktop apps |
| UI framework | `egui` | Immediate mode, dezelfde render pass als canvas |
| Complex dialogs | `wry` webview subwindows | Behoudt bestaande React dialog code |
| Rendering API | `wgpu` | Abstractie over DX12/Metal/Vulkan, één codebase |
| Shader language | WGSL | Modern, typed, cross-platform |
| State architecture | `bevy_ecs` (standalone) | Parallel systems, data-oriented |
| Tessellation | `lyon` | Rust standaard voor 2D vector graphics |
| Text rendering | `fontdue` of `swash` + glyph atlas | Snel, SDF-capable |
| Spatial index | R-tree (`rstar` crate) in f64 | Precisie-vriendelijk, logaritmische query |
| Concurrency | `rayon` voor I/O & CPU-bound work | Work-stealing threadpool |
| Serialization | `serde` | JSON voor `.o2d`, custom voor binary |
| File formats | `ifc-rs`, `dxf-rs`, `usvg`, `printpdf` | Rust-native crates |
| JS bridge | `rquickjs` | QuickJS binding voor JS extensions |
| Dynamic plugins | `libloading` | Blender-achtig plugin systeem |

---

## 3. Precisie-strategie

### Het probleem

- Gewenste detail: **0.001 mm** (1 µm)
- Maximale afstand: **1000 km** = 10⁹ mm
- Dynamisch bereik: **10¹²** (12 decimalen)

### Waarom f32 faalt

`f32` heeft 24 bits mantissa (~7 significante cijfers). Op 10⁹ mm wordt de kleinste stap ~119 mm. Onbruikbaar voor CAD.

### Strategie: hybride f64 storage + floating origin f32 rendering

**CPU storage (alle ECS componenten):**

```rust
#[derive(Component)]
struct WorldPos(Vec2<f64>);

#[derive(Component)]
struct WorldBounds { min: Vec2<f64>, max: Vec2<f64> }

#[derive(Resource)]
struct RenderOrigin(Vec2<f64>);
```

f64 heeft 53 bits mantissa (~16 cijfers). Op 10⁹ mm → precisie ~2×10⁻⁷ mm. **4500× ruimer dan de 0.001 mm target.**

**GPU rendering (camera-relative f32):**

```rust
fn upload_instance_buffer(
    origin: Res<RenderOrigin>,
    shapes: Query<(&WorldPos, &StyleRef), With<Visible>>,
    mut gpu: ResMut<InstanceBuffer>,
) {
    for (pos, style) in shapes.iter() {
        let local_f32 = (pos.0 - origin.0).as_vec2_f32();
        gpu.push(Instance { pos: local_f32, style_idx: style.0 });
    }
}
```

Camera-relative waarden blijven klein (binnen viewport), dus f32 geeft sub-µm precisie op pixel niveau.

**Floating origin rebase:**

Als de camera > 1 km van origin drift, rebase je de origin naar de nieuwe camera center. Alle persistent GPU buffers moeten dan opnieuw geüpload worden. Dit kost ~5-10 ms eenmalig, gebeurt zelden in praktijk.

**Tessellation in shape-local coords:**

Complexe shapes (hatches, splines) worden lokaal getesselleerd vanuit shape-origin (0,0 in eigen coordinate system). Lokale waarden zijn altijd klein → f32 safe. De world placement gebeurt via `instance_transform`.

### Precisie garantie

| Locatie | Precisie |
|---------|----------|
| CPU storage (f64) | 2×10⁻⁷ mm op 10⁹ mm |
| GPU render (camera-relative f32) | 6×10⁻⁷ mm op pixel-niveau |
| Tessellation (shape-local f32) | < 10⁻⁵ mm |

Alle drie zijn **> 1600× ruimer** dan de 0.001 mm detail-eis.

### Performance-impact

- f64 CPU ops: identiek aan f32 voor add/sub/mul op moderne CPU's
- Geheugen: 100k shapes × 48 bytes = 4.8 MB (past in L3 cache)
- f64→f32 conversion per frame: 0.1-0.2 ms voor 100k shapes (parallel via rayon)
- Totaal overhead: **< 5%** t.o.v. pure f32

---

## 4. ECS architectuur

### World structuur

```rust
// Entities = shapes, layers, drawings, viewports, sheets, etc.
// Components = data, Systems = logic

// Core shape components
#[derive(Component)]
struct ShapeId(Uuid);

#[derive(Component)]
enum ShapeKind {
    Line, Rect, Circle, Arc, Ellipse, Polyline, Spline,
    Text, Dimension,
    Hatch, Image,
    Wall, Beam, Column, Slab, Pile, Gridline, Level,
    SpotCoordinate, Label, DetailLine,
    ComponentInstance(ComponentDefId),
    Custom(u32), // extension-registered
}

#[derive(Component)]
struct WorldPos(Vec2<f64>);

#[derive(Component)]
struct WorldBounds { min: Vec2<f64>, max: Vec2<f64> }

#[derive(Component)]
struct Transform2D {
    rotation: f32,   // radians
    scale: Vec2<f32>,
}

#[derive(Component)]
struct StyleRef(u32); // index into StyleTable resource

#[derive(Component)]
struct LayerId(Uuid);

#[derive(Component)]
struct DrawingId(Uuid);

// Shape-specific data (as separate components)
#[derive(Component)]
struct LineData { end: Vec2<f64> }

#[derive(Component)]
struct PolylineData { points: Vec<Vec2<f64>>, bulge: Vec<f32> }

#[derive(Component)]
struct HatchData {
    points: Vec<Vec2<f64>>,
    inner_loops: Vec<Vec<Vec2<f64>>>,
    pattern: PatternRef,
    background_color: Option<Color>,
}

// ... per shape type

// Markers
#[derive(Component)] struct Visible;
#[derive(Component)] struct Selected;
#[derive(Component)] struct Hovered;
#[derive(Component)] struct Dirty;        // needs GPU upload
#[derive(Component)] struct Locked;
```

### Resources (globaal per World)

```rust
#[derive(Resource)]
struct ActiveDrawing(Uuid);

#[derive(Resource)]
struct Viewport {
    pos: Vec2<f64>,    // world coords
    zoom: f32,
    rotation: f32,
}

#[derive(Resource)]
struct RenderOrigin(Vec2<f64>);

#[derive(Resource)]
struct StyleTable(Vec<Style>);

#[derive(Resource)]
struct SpatialIndex(RTree<ShapeId>); // f64 bounds

#[derive(Resource)]
struct CommandHistory {
    past: Vec<Box<dyn Command>>,
    future: Vec<Box<dyn Command>>,
    max_size: usize,
}

#[derive(Resource)]
struct ToolState { /* tool-specific */ }

#[derive(Resource)]
struct TessellationCache(HashMap<ShapeId, TessellatedGeometry>);
```

### System schedule

Systems gegroepeerd in stages. Systems binnen een stage draaien **parallel** (waar geen shared mutable state), stages draaien **sequentieel**.

```
Stage 1: INPUT
├── handle_winit_events_system
├── handle_ui_events_system
└── apply_command_queue_system

Stage 2: GEOMETRY (parallel)
├── update_bounds_system        (queries Changed<WorldPos>)
├── rebuild_spatial_index_system (on dirty shapes only)
├── tessellate_complex_system   (par_for_each over Changed<HatchData>)
└── camera_rebase_system        (check if origin drift > 1 km)

Stage 3: RENDER PREP (parallel)
├── viewport_cull_system        (R-tree query, mark Visible)
├── sort_by_render_priority_system
├── lod_cull_system             (skip sub-pixel shapes)
└── prepare_instance_data_system (f64→f32 conversion, parallel)

Stage 4: GPU (single-threaded)
├── update_camera_uniform_system
├── upload_dirty_instances_system  (sparse GPU buffer writes)
├── render_shapes_system
├── render_text_system
├── render_ui_overlay_system    (selection, snap, cursor)
└── present_system

Stage 5: CLEANUP
├── remove_dirty_markers_system
└── trim_command_history_system
```

**Parallelism keys:**
- Bevy's scheduler gebruikt component access patterns om parallelism af te leiden
- `Query<&A, With<B>>` en `Query<&C>` kunnen parallel draaien (verschillende components)
- `Query<&mut A>` en `Query<&A>` kunnen NIET parallel (same component)

---

## 5. GPU rendering pipeline

### Persistent GPU buffers

Opgezet bij bestandslaad, sparse updated bij edits.

**Template vertex buffer** (static):
- Unit geometry voor instanced shapes (unit line, unit rect, unit circle 64-segments)
- Gecachte getesselleerde complex shapes (hatches, splines, arcs)
- Indexed via `LocalGeometryRef(u32)`

**Instance buffer** (retained, sparse updates):
```rust
#[repr(C)]
struct Instance {
    pos: [f32; 2],           // camera-relative
    rotation: f32,
    scale: [f32; 2],
    style_idx: u32,
    geometry_idx: u32,
    flags: u32,              // visible, selected, hovered, locked
}
// 32 bytes per instance
// 100k shapes = 3.2 MB
```

**Style table uniform** (small, hot):
```rust
#[repr(C)]
struct Style {
    stroke_color: [f32; 4],
    fill_color: [f32; 4],
    line_width_px: f32,
    dash_pattern: [f32; 4], // up to 4 segments
    line_style: u32,         // solid | dashed | dotted | center | dashdot
    _padding: u32,
}
// 48 bytes per style, typically 100-500 styles = 5-24 KB
```

**Camera uniform** (updated per frame):
```rust
#[repr(C)]
struct CameraUniform {
    view_proj: [[f32; 4]; 4],
    origin_f64: [f64; 2],     // for shader-side precision
    pixel_size_world: f32,    // for LOD culling in shader
    zoom: f32,
}
```

### Shader pipeline (WGSL)

**Simple shapes pass** (instanced, 1 draw call voor alle lines/rects/circles):

```wgsl
struct Instance {
    @location(1) pos: vec2<f32>,
    @location(2) rotation: f32,
    @location(3) scale: vec2<f32>,
    @location(4) style_idx: u32,
    @location(5) geometry_idx: u32,
    @location(6) flags: u32,
}

struct Camera {
    view_proj: mat4x4<f32>,
    pixel_size_world: f32,
    zoom: f32,
}

@group(0) @binding(0) var<uniform> camera: Camera;
@group(0) @binding(1) var<storage, read> styles: array<Style>;

@vertex
fn vs_main(
    @location(0) unit_vertex: vec2<f32>,
    instance: Instance,
) -> VertexOutput {
    let cos_r = cos(instance.rotation);
    let sin_r = sin(instance.rotation);
    let rotated = vec2(
        unit_vertex.x * cos_r - unit_vertex.y * sin_r,
        unit_vertex.x * sin_r + unit_vertex.y * cos_r,
    );
    let world = rotated * instance.scale + instance.pos;
    let clip = camera.view_proj * vec4(world, 0.0, 1.0);
    return VertexOutput {
        position: clip,
        style_idx: instance.style_idx,
        flags: instance.flags,
    };
}

@fragment
fn fs_main(in: VertexOutput) -> @location(0) vec4<f32> {
    let style = styles[in.style_idx];
    var color = style.stroke_color;
    if ((in.flags & SELECTED_BIT) != 0u) {
        color = vec4(0.0, 0.47, 0.84, 1.0); // selection blue
    }
    return color;
}
```

**Separate passes:**
- `simple_shapes.wgsl` — lines, rects, circles (instanced)
- `hatch.wgsl` — pattern fills met clip regions
- `text.wgsl` — glyph atlas sampling
- `ui_overlay.wgsl` — selection handles, snap indicators, cursor

### Draw call budget

| Pass | Draw calls | Shapes per call |
|------|------------|----------------|
| Simple shapes | 1 | 100.000 (instanced) |
| Hatches | 5-20 | ~5000 per unique pattern |
| Text | 2-5 | glyphs per font |
| Dimensions | 5-10 | instanced lines + text |
| UI overlays | 3-10 | selection/snap/tracking |
| **Totaal** | **~20-40** | per frame |

Moderne GPU's doen 10.000+ draw calls/sec zonder probleem.

### Expected performance

| Hardware | 100k shapes | 1M shapes |
|----------|-------------|-----------|
| RTX 4090 | 500+ fps | 120 fps |
| RTX 3060 | 300 fps | 60 fps |
| Intel Iris Xe | 180 fps | 30 fps |
| Apple M1/M2 | 250-400 fps | 80-120 fps |

---

## 6. UI architectuur

### Main window: winit + egui + wgpu

Eén render pass per frame tekent zowel de UI chrome als het CAD canvas. Geen IPC overhead, UI en canvas delen dezelfde GPU context.

**egui panels:**
- Ribbon (tabs: File, Draw, Modify, Annotate, View, Extensions)
- Side panels (Properties, Layers, Navigation)
- Status bar (FPS, coords, tool hints)
- Toolbars (contextual, floating)
- Simpele dialogen (confirm, save-as, color picker, number input)

**CAD canvas gebied:**
- Custom wgpu render pass binnen egui layout
- Shape rendering, overlays, snap indicators, selection handles

### Complex dialogs: wry webview subwindows

Voor dialogen die de bestaande React code hergebruiken:

```
┌─────────────────────────────────────────────────────┐
│  Scenarios die een webview subwindow triggeren:     │
│                                                      │
│  • Print Dialog (jsPDF preview, page layout)        │
│  • GIS Geolocation (Leaflet map, locatie picker)    │
│  • WMS Layer picker (Leaflet + service dropdown)    │
│  • Kadastrale Tekening configuratie                 │
│  • Scale Display Settings (grid van factors)        │
│  • Pattern Manager (SVG editor)                     │
│  • Title Block Editor (SVG template editor)         │
│  • Command Palette (Spotlight-stijl zoeker)         │
│  • Query/Report Builder (tabellen)                  │
└─────────────────────────────────────────────────────┘
```

**Communication:**
- IPC via JSON messages over wry bridge
- Webview leest ECS snapshot (readonly) via `postMessage`
- Webview schrijft Commands terug die in `CommandHistory` worden gequeued
- Zelfde command pattern als native UI

**Lifecycle:**
- Dialog wordt gespawned on-demand (~100-300 ms startup)
- Main app blijft volledig responsive tijdens dialog openstaan
- Dialog crash ≠ app crash (geïsoleerd process)

### Native dialogs (egui)

Alle dialogen die snel en simpel kunnen:
- Bestand open/save (via `rfd` native file dialog)
- Confirm/alert
- Color picker
- Number input met validation
- Simple selection lists
- Error messages

---

## 7. Command pattern & undo/redo

### Command trait

```rust
trait Command: Send + Sync {
    fn apply(&self, world: &mut World) -> Result<(), CommandError>;
    fn revert(&self, world: &mut World) -> Result<(), CommandError>;
    fn description(&self) -> String;
    fn can_merge_with(&self, other: &dyn Command) -> bool { false }
    fn merge_with(&mut self, other: Box<dyn Command>) -> bool { false }
}
```

### Voorbeeld: MoveShapesCommand

```rust
struct MoveShapesCommand {
    shapes: Vec<Entity>,
    delta: Vec2<f64>,
}

impl Command for MoveShapesCommand {
    fn apply(&self, world: &mut World) -> Result<(), CommandError> {
        for &e in &self.shapes {
            if let Some(mut pos) = world.get_mut::<WorldPos>(e) {
                pos.0 += self.delta;
                world.entity_mut(e).insert(Dirty);
            }
        }
        Ok(())
    }

    fn revert(&self, world: &mut World) -> Result<(), CommandError> {
        for &e in &self.shapes {
            if let Some(mut pos) = world.get_mut::<WorldPos>(e) {
                pos.0 -= self.delta;
                world.entity_mut(e).insert(Dirty);
            }
        }
        Ok(())
    }

    fn description(&self) -> String {
        format!("Move {} shape(s)", self.shapes.len())
    }

    fn can_merge_with(&self, other: &dyn Command) -> bool {
        if let Some(other) = other.as_any().downcast_ref::<Self>() {
            self.shapes == other.shapes
        } else {
            false
        }
    }

    fn merge_with(&mut self, other: Box<dyn Command>) -> bool {
        if let Ok(other) = other.into_any().downcast::<Self>() {
            self.delta += other.delta;
            true
        } else {
            false
        }
    }
}
```

### History management

```rust
struct CommandHistory {
    past: Vec<Box<dyn Command>>,
    future: Vec<Box<dyn Command>>,
    max_size: usize,  // default 500
    merge_window_ms: u64, // default 100ms
    last_push_time: Instant,
}

impl CommandHistory {
    fn execute(&mut self, world: &mut World, cmd: Box<dyn Command>) {
        cmd.apply(world).ok();

        // Attempt merge with last command if within merge window
        if let Some(last) = self.past.last_mut() {
            if self.last_push_time.elapsed().as_millis() < self.merge_window_ms as u128
                && last.can_merge_with(&*cmd)
            {
                last.merge_with(cmd);
                return;
            }
        }

        self.past.push(cmd);
        self.future.clear();
        self.last_push_time = Instant::now();

        if self.past.len() > self.max_size {
            self.past.remove(0);
        }
    }

    fn undo(&mut self, world: &mut World) {
        if let Some(cmd) = self.past.pop() {
            cmd.revert(world).ok();
            self.future.push(cmd);
        }
    }

    fn redo(&mut self, world: &mut World) {
        if let Some(cmd) = self.future.pop() {
            cmd.apply(world).ok();
            self.past.push(cmd);
        }
    }
}
```

---

## 8. File formats

### `.o2d` (native)

- JSON v4 formaat (backwards-compatible met v3)
- Streaming loader via `serde_json::StreamDeserializer`
- Bestanden > 100 MB blijven soepel laden
- Geheugen-voetafdruk: ~10× kleiner dan v3 (direct in ECS componenten, geen intermediate objects)

**Migration van v3:**
- v3 files laden via compat-layer die naar v4 conversie doet bij save
- Originele v3 bestand blijft behouden als `.o2d.bak`

### IFC4X3 (export only, import later)

- Rust-native implementation (of `ifc-rs` crate als beschikbaar)
- Shape → IFC entity mapping via `IfcExportRegistry` (behoudt huidige design)
- Output: IFC-SPF (STEP) format

### DXF

- `dxf-rs` crate voor read en write
- Mapping shapes ↔ DXF entities via `DxfMappingRegistry`

### SVG

- `usvg` + `resvg` voor rendering van SVG content (title blocks, patterns)
- `svg` crate voor serialization

### PDF

- `printpdf` crate voor vector PDF output
- Eigen rendering layer die ECS shapes naar PDF primitives mapt
- Alternative: `pdf-writer` als meer controle nodig

---

## 9. Extension systeem

### Rust plugins (native)

```rust
// Plugin library signature
#[no_mangle]
pub extern "C" fn register_plugin(registry: &mut PluginRegistry) {
    registry.add_shape_type("my-custom-shape", MyShapeRenderer);
    registry.add_tool("my-tool", MyTool);
    registry.add_command("my-command", MyCommand);
}
```

- Geladen via `libloading` crate
- DLL/dylib/so bestanden per platform
- Hot-reload mogelijk in development

### JavaScript extensions (backwards-compat)

De bestaande AEC, GIS, Drawing Statistics extensies zijn in JavaScript. Om ze niet allemaal te moeten porten:

```rust
// Embedded QuickJS via rquickjs
let js_runtime = Runtime::new()?;
let context = Context::full(&js_runtime)?;

// Expose window.cad API
context.with(|ctx| {
    let cad = Object::new(ctx.clone())?;
    cad.set("shapes", shapes_proxy)?;
    cad.set("addShape", Function::from_fn(ctx.clone(), add_shape))?;
    // ...
    ctx.globals().set("cad", cad)?;
});
```

**API compatibility:**
- `window.cad.shapes.filter(...)` → Rust implementatie via proxy
- `window.cad.addShape(...)` → genereert Command, pushed naar history
- Events via callback registration

**Performance:**
- QuickJS is ~5-20× sneller dan V8-embedded voor simpele scripts
- Voor heavy extensions (GIS): blijft via webview, niet via JS-embedded

### Extension types

| Type | Implementation |
|------|---------------|
| Shape renderers | Rust plugin of JS via `window.cad.registerRenderer` |
| Tools | Rust plugin of JS |
| Commands | Rust plugin of JS |
| Dialogs | Webview subwindow met React |
| File I/O handlers | Rust plugin only |
| IFC exporters | Rust plugin only (performance kritisch) |

---

## 10. Performance budget

Target: 100.000 shapes @ 120 fps = 8.3 ms per frame

| Stage | Budget | Expected |
|-------|--------|----------|
| Input handling | 0.5 ms | 0.1 ms |
| Command application | 0.2 ms | 0.05 ms |
| Bounds update (dirty) | 0.3 ms | 0.1 ms |
| Spatial index update | 0.5 ms | 0.2 ms (alleen bij dirty shapes) |
| Viewport cull | 1.0 ms | 0.3 ms |
| f64→f32 conversion | 0.3 ms | 0.2 ms (parallel) |
| GPU instance upload | 0.5 ms | 0.15 ms (sparse diff) |
| GPU draw calls | 2.5 ms | 1.5 ms |
| UI (egui) | 1.5 ms | 0.5 ms |
| Present + swap | 1.0 ms | 0.5 ms |
| **Totaal** | **8.3 ms** | **~3.6 ms** |

**Marge: 56%.** Ruim 120 fps haalbaar met headroom voor complexe scenes.

### Geheugen budget

- 100k shapes @ 48 bytes per instance = 4.8 MB
- 100k WorldPos (f64) = 1.6 MB
- 100k WorldBounds (f64) = 3.2 MB
- Style table = ~25 KB
- Template vertex buffer = ~10-50 MB (afhankelijk van tessellation cache)
- Total working set: **< 100 MB** voor 100k shapes
- Tessellation cache kan tot ~200 MB oplopen bij complexe hatches

---

## 11. Feature-pariteit checklist

Alles wat de TypeScript versie kan, moet deze versie ook kunnen bij release:

### Shape types (30+)
- [x] Line, Rectangle, Circle, Arc, Ellipse, Polyline, Spline, Point
- [x] Text, Dimension
- [x] Beam, Column, Wall, Wall-opening, Slab, Slab-opening, Slab-label
- [x] Gridline, Level, Section-callout, Space, Pile, Puntniveau, CPT
- [x] Hatch (met patterns, inner loops, backgrounds)
- [x] Image, Detail-line, Label, Spot-elevation, Spot-coordinate
- [x] Plate-system, Block-instance, Component-instance, Rebar
- [x] Foundation-zone

### Tools
- [x] Select, Pan, Zoom (in/out/fit/region/previous/selection)
- [x] All drawing tools (line, rect, circle, polyline, etc.)
- [x] Modify tools (move, copy, rotate, scale, mirror, array, trim, extend, fillet, chamfer, offset, align, split, join)
- [x] Measure tool (met snaps + preview lijn)
- [x] Dimension tools (linear, aligned, angular)

### UI features
- [x] Ribbon + contextual tabs
- [x] Type selector (hatch, wall, pile, beam, text, dimension types)
- [x] Scale Display Settings
- [x] Properties panel
- [x] Layers panel
- [x] Navigation panel
- [x] Status bar (FPS, coords, tool hints)
- [x] Command palette
- [x] Find/Replace
- [x] Terminal/console

### Drawing & sheet
- [x] Multi-drawing support
- [x] Sheet layout met viewports
- [x] Title blocks (custom SVG templates)
- [x] Crop regions
- [x] Annotations on sheets

### Snap & tracking
- [x] All snap types (endpoint, midpoint, center, intersection, perpendicular, parallel, tangent, nearest, grid, origin, alignment)
- [x] Polar tracking
- [x] Parallel/perpendicular tracking
- [x] 2D cursor

### File I/O
- [x] `.o2d` (native, v3 compat + v4 new)
- [x] IFC4X3 export
- [x] DXF import/export
- [x] PDF export (single + batch)
- [x] SVG export
- [x] Image import (PNG, JPG)
- [x] Auto-save

### Parametric + constraints
- [x] Formula engine (tokenizer, parser, evaluator)
- [x] Parameter definitions
- [x] Constraint graph (DAG with topological sort)
- [x] Cross-object references (@Object.param)
- [x] Parametric component arrays + nesting

### Extensions
- [x] AEC extension (walls, beams, slabs, openings)
- [x] GIS extension (geolocation, WMS, WFS, Kadastrale)
- [x] Drawing Statistics extension
- [x] Scale Display Settings
- [x] Extension loader + hot reload

---

## 12. Development roadmap

### Fase 1 — Fundament (2-3 weken)
**Doel:** Rust project staat, kan shapes laden en zien.
- Cargo workspace met modules (`kernel`, `ecs`, `render`, `ui`, `commands`, `file_io`, `extensions`)
- winit + egui + wgpu boilerplate
- bevy_ecs setup + basic Shape components
- Command history + eerste commands (add/delete/move)
- `.o2d` v3 read/write met serde
- Minimal canvas: render lines als instanced primitives

**Exit criteria:**
- App start, laadt `.o2d` bestand, toont lijnen, kan pan/zoom

### Fase 2 — Rendering kernel (3-4 weken)
**Doel:** 100k shapes @ 120 fps gerealiseerd.
- Full wgpu render pipeline met WGSL shaders
- Instance buffer management + dirty tracking
- R-tree spatial index in f64
- Viewport culling + LOD culling
- Floating origin + camera rebase
- Style table + layer visibility
- Alle basis shape types: line, rect, circle, arc, ellipse, polyline, point

**Exit criteria:**
- Benchmark: 100k shapes @ 120 fps op RTX 3060
- Precision test: 0.001 mm @ 1000 km verified (pixel-perfect)

### Fase 3 — Shapes & tessellation (3-4 weken)
**Doel:** Alle shape types visueel gelijk aan huidige tool.
- `lyon` tessellation met cache
- Hatch rendering (patterns, inner loops, backgrounds)
- Text rendering (fontdue + glyph atlas, SDF)
- Dimension rendering (arrows, tick marks, text)
- All AEC shapes (walls, beams, slabs, columns, gridlines, levels)
- Annotation shapes (labels, spot-coordinate, detail-line)

**Exit criteria:**
- Visual diff test: huidige tool vs nieuwe tool op dezelfde `.o2d` file
- Geen zichtbare verschillen in rendering

### Fase 4 — UI (3-4 weken)
**Doel:** Bruikbare tool met alle hoofdfeatures.
- egui Ribbon met alle tabs
- Side panels (Properties, Layers, Navigation)
- Tool implementations (select, pan, zoom-*, draw, modify)
- Snap + tracking engine
- `wry` webview subwindow framework
- Port complexe dialogen (Print, GIS, WMS, Scale Settings, TypeSelector)
- Status bar + FPS meter

**Exit criteria:**
- Volledige tekening kan gemaakt worden from scratch
- Alle tools werken
- Webview subwindows spawn correct

### Fase 5 — Extensions + command API (2-3 weken)
**Doel:** Bestaande extensies werken.
- Alle commands van huidige tool gemapped
- QuickJS bridge voor JS extensions
- Port AEC extension naar Rust (performance kritisch)
- GIS extension: core in Rust, UI in webview
- Drawing Statistics in Rust
- Extension loader + manifest parsing

**Exit criteria:**
- Alle 3 bestaande extensions functioneel
- Extension API backwards-compatible (bestaande JS extensions werken)

### Fase 6 — Export + file formats (2-3 weken)
**Doel:** Feature-pariteit voor I/O.
- PDF export (single + multi-sheet)
- IFC4X3 export
- DXF import/export
- SVG export
- Auto-save mechanisme

**Exit criteria:**
- Alle bestaande export formats werken identiek
- Roundtrip test: export → import → compare

### Fase 7 — Polish + migration (2-3 weken)
**Doel:** Release candidate.
- Settings migration (oude v3 config → nieuwe Rust config)
- Bug fixing, performance tuning
- Beta testing met echte gebruikers en DWG files
- Installer / update mechanisme
- Documentation

**Exit criteria:**
- 1 maand stabiel bij daily-driver gebruik
- Performance targets behaald op real-world files
- Migration path gedocumenteerd

**Totaal: 18-24 weken full-time (4-6 maanden).**

---

## 13. Risico's en mitigaties

| Risico | Kans | Impact | Mitigatie |
|--------|------|--------|-----------|
| egui blijkt niet flexibel genoeg voor CAD UI | Medium | Hoog | Vroege prototyping in fase 1, indien nodig switchen naar Slint |
| wry IPC overhead te groot | Laag | Medium | Dialogen openen is zeldzaam, stat ik bij < 50ms IPC |
| Bevy ECS leercurve vertraagt team | Medium | Medium | Eerste 2 weken focus op ECS fundamentals, reference projects bestuderen |
| Tessellation cache explodeert qua geheugen | Medium | Medium | LRU eviction policy, cache size cap op 200 MB |
| JS extensions performance onder QuickJS tegenvalt | Medium | Laag | Fallback: swap hot extensions naar Rust plugins |
| Camera rebase zichtbaar als stutter | Laag | Medium | Schedule tijdens idle frame, threshold tuning |
| Floating origin precision in edge cases (dimensioning tussen ver uit elkaar liggende punten) | Laag | Hoog | Unit tests voor extreme distances, f64 ops voor alle geometry math |
| DXF import rondt precisie af | Medium | Medium | DXF stores als double, direct naar f64 geometry |
| wgpu bug of platform-specifiek probleem | Laag | Hoog | Stick met stable wgpu release, GitHub issues monitoring |
| UI rewrite blokkeert productiviteit | Hoog | Hoog | Parallelle ontwikkeling: oude tool blijft op master, nieuwe op feature branch |

---

## 14. Success criteria

De kernel is release-waardig wanneer:

1. **Performance:**
   - 100.000 shapes @ 120 fps stabiel op RTX 3060
   - 40 MB DWG (na parsing naar `.o2d` of DXF) laadt in < 2s
   - Cold start < 500 ms
   - Pan/zoom zonder enige stutter bij 100k shapes

2. **Precisie:**
   - 0.001 mm detail correct getekend op 1000 km afstand van origin (visuele test)
   - Unit tests voor alle geometry ops op extreme distances

3. **Feature-pariteit:**
   - Alle 30+ shape types renderen correct
   - Alle tools werken
   - Alle exports produceren identieke output (diff tests)
   - Alle bestaande extensions functioneel

4. **Stabiliteit:**
   - 30 dagen daily-driver gebruik zonder crashes
   - Memory leaks onder 10 MB/uur idle
   - 100 uur fuzz testing zonder crashes

5. **Migration:**
   - `.o2d` v3 files laden correct
   - Settings migrate van oude app
   - Documentation voor breaking changes in extension API

---

## 15. Open questions voor planning phase

Deze worden opgepakt in het implementation plan:

- Welke specifieke crate versies gebruiken (Cargo.lock strategie)
- Hoe de build pipeline cross-platform op te zetten (GitHub Actions / local build)
- Of we een aparte `ecs-types` crate willen voor type-definities shared tussen plugins
- Hoe extension hot-reload in production gebruiker wordt
- Monitoring/telemetry strategie (opt-in crash reports)
- License strategie (AGPL blijft?)

---

## Samenvatting van alle design keuzes

| # | Beslissing | Keuze |
|---|------------|-------|
| 1 | Scope | C — Volledige engine (native app) |
| 2 | Distributie | A — Full native (geen Tauri) |
| 3 | UI framework | egui + wry webview voor complex dialogs |
| 4 | Rendering API | wgpu (→ DX12/Metal/Vulkan) |
| 5 | Rendering pipeline | Retained-mode + persistent buffers + sparse dirty updates |
| 6 | Tessellation | Hybride — GPU instances voor simpel, CPU lyon voor complex |
| 7 | State architectuur | ECS (`bevy_ecs`) — full parallel |
| 8 | Threading | ECS parallel systems, GPU calls single-threaded |
| 9 | Undo/redo | Command pattern met mergeable commands |
| 10 | Precisie | Hybride f64 storage + floating origin f32 render |
| 11 | Target precisie | 0.001 mm op 1000 km |
| 12 | Target performance | 100k shapes @ 120 fps |
| 13 | Shader taal | WGSL |
| 14 | Native formaat | `.o2d` JSON v4 |
| 15 | Imports/exports | `.o2d`, IFC4X3, DXF, SVG, PDF |
| 16 | Extension API | Rust plugins + QuickJS voor JS extensions |
| 17 | Project branch | `native-kernel-rust` |

---

**Einde van design specificatie.**
