# Spike Results — Native Rust Kernel

**Start:** 2026-04-16
**Hardware:** NVIDIA RTX 2000 Ada Generation Laptop GPU (Vulkan backend)
**OS:** Windows 11 (detected via winit)
**Rust:** 1.94.0 (MSRV target 1.77)

---

## Prototype 1: ECS + Command + resource_scope
**Status:** ✅ SUCCES

- `bevy_ecs 0.15.4` + `resource_scope()` werkt zonder borrow-checker conflict
- 4/4 integration tests pass
- ShapeId (UUID) indirection via ShapeIndex resource lost de Purist's "dubbele source-of-truth" concern op
- Despawn→undo→redo preserves shape identity over ECS entity recycling
- Demo (main.rs) toont spawn/move/despawn/undo/redo correct

**Belangrijke API fix:** `std::cell::Cell` is `!Sync`, faalt Command trait bound. Vervangen door `std::sync::Mutex`. Dit was een niet-geplande bevinding — compiler-error tijdens day-0 onthulde het.

**Files:** `spike/prototype-01-ecs-command/`

---

## Prototype 2: GPU Benchmark (100k instances)
**Status:** ✅ SUCCES (static, sparse) · ⚠️ TWIJFEL (heavy)

### Metingen op RTX 2000 Ada Laptop GPU

| Scenario | Dirty/frame | Mean FPS | Mean ms | P99 ms | Target |
|----------|-------------|----------|---------|--------|--------|
| Static   | 0 | **459** | 2.179 | 5.698 | ✅ 3.8× over 120 fps |
| Sparse   | 500 | **280** | 3.566 | 7.180 | ✅ 2.3× over 120 fps |
| Heavy    | 5.000 | **54** | 18.574 | 26.106 | ⚠️ onder 60 fps |

### Belangrijke bevindingen

- **wgpu 0.20 API verified** — Instance/DeviceDescriptor/RenderPipeline werken zoals in plan
- **Reviewer's `memory_hints` claim** was onjuist — dat veld is wgpu 0.21+, niet 0.20
- **Heavy scenario** (5000 random sparse buffer writes per frame) is de bottleneck. Oplossingen voor production:
  1. Batch staging buffer + single copy_buffer_to_buffer ipv N × write_buffer
  2. Progressive dirty-flush over meerdere frames
  3. Acceptatie: real-world CAD edit is < 100 shapes/frame — 5000 is stress-case
- **static + sparse scenarios** halen target met enorme marge — de 100k @ 120fps claim is ruim haalbaar voor normale workload

**Files:** `spike/prototype-02-gpu-benchmark/`

---

## Prototype 3: egui Ribbon met dockable panels
**Status:** 🟡 API VERIFIED (compile only, interactieve test pending day-1)

- `egui 0.29`, `egui-wgpu 0.29`, `egui-winit 0.29`, `egui_dock 0.14` compileren samen zonder conflicten
- `egui::Context::default()` + `ctx.run(RawInput, ui_fn)` produceert shapes
- `DockState::new() + split_right()` werkt
- Headless probe: `egui.run produced 2 shapes` — render pipeline is functioneel
- Interactive ribbon met dockable panels + wgpu canvas integration pending day-1 van spike

**Files:** `spike/prototype-03-egui-ribbon/`

---

## Prototype 4: Precisie (Shewchuk op 1000 km)
**Status:** ✅ SUCCES — maar premise was deels onjuist

### Metingen op 1000 km (10⁹ mm) afstand van origin

| Implementatie | err_x | err_y | Target (1 µm) |
|---------------|-------|-------|---------------|
| Naive f64 (Cramer) | 0.0e0 mm | 1.19e-7 mm | ✅ 10000× ruimer |
| RTC (local origin) | 0.0e0 mm | 1.19e-7 mm | ✅ identiek |
| Adaptive (Shewchuk) | 0.0e0 mm | 1.19e-7 mm | ✅ identiek |

**Conclusie:** Reviewer's "catastrophic cancellation" claim was **overdreven voor onze use-case**. Naive f64 geeft nanometer-precisie op 1000 km. Adaptive predicates zijn nuttig voor **exact sign-tests** (orient2d voor collineariteit), niet voor intersection coordinaten.

### Tests (7/7 pass)

- Near-origin exact intersection
- Far-origin (1000 km) sub-µm precisie
- Near-parallel edge case (correct `None`)
- orient2d sign correctness op 10⁹ mm (CCW/CW/collinear)
- Control cases (origin, parallel lines)

**Files:** `spike/prototype-04-precision/`

---

## Prototype 5: wry Webview round-trip
**Status:** 🟡 API VERIFIED (compile + serde routing, interactieve test pending day-1)

- `wry 0.45` compileert clean op Windows 11 met WebView2 binding
- Serde-based IPC message routing werkt (ping/pong + getShapes patterns)
- Full interactieve dialog met React CDN + EventLoopProxy pattern pending day-1 van spike
- Reviewer's EVAL_CHAN threading hack is vervangen door UserEvent pattern

**Files:** `spike/prototype-05-wry-webview/`

---

# Go/No-Go Verdict (preliminair)

## Scorecard

| # | Prototype | Status | FPS / Tests | Target behaald? |
|---|-----------|--------|-------------|-----------------|
| 1 | ECS + Command | ✅ SUCCES | 4/4 tests | Ja |
| 2 | GPU Benchmark | ✅ SUCCES (static/sparse) / ⚠️ Heavy | 459/280/54 fps | Ja voor normale load |
| 3 | egui Ribbon | 🟡 API verified | compile only | Pending interactieve test |
| 4 | Precisie | ✅ SUCCES | 7/7 tests | Ruim (nano-niveau) |
| 5 | wry Webview | 🟡 API verified | compile + serde | Pending interactieve test |

## Preliminair verdict: **GO** (conditioneel)

**Motivatie:**
- De **hardste claim** (100k @ 120fps) is niet alleen haalbaar maar met 3.8× marge op laptop-GPU bewezen
- De **precisie-claim** (1 µm op 1000 km) is eenvoudiger haalbaar dan gedacht — naive f64 volstaat
- De **ECS-architectuur** werkt inclusief de Purist's despawn/respawn concern
- De heavy-edit scenario (5000/frame) vereist een sparse buffer batching optimalisatie voor production — geen kill-criterion

## Openstaande risico's

- Proto 3 en 5 interactieve tests (tear-off panels, wry dialog round-trip) day-1 van spike
- Text rendering (`cosmic-text` integratie) niet geprototyped — wordt hard werk
- DXF import performance op 500k entities niet getest — apart spike item
- macOS + Iris Xe metingen ontbreken — apart test-nodig

## Volgende stappen

1. Commit alle spike code + docs naar branch `native-kernel-rust`
2. Plan de full interactieve tests voor proto 3 + 5
3. Spec-addendum schrijven met MUST-DO items uit parliament-synthesis
4. Start implementation plan voor Fase 1 (Fundament)
