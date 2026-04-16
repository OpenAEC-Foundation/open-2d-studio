# Open 2D Studio — Native Rust Kernel

Status: **actively in development** on branch `native-kernel-rust`.

Complete herbouw van de TypeScript/Canvas 2D kernel in native Rust met:
- `wgpu 22` GPU rendering (DX12 / Metal / Vulkan via wgpu)
- `bevy_ecs 0.15` entity-component-system
- `egui 0.29` + `egui_dock 0.14` UI
- `winit 0.30` window/event handling
- `lyon 1.0` vector tessellation
- `cosmic-text 0.12` advanced text shaping (CJK, RTL)
- `rstar 0.12` R-tree spatial index
- `serde_json` for `.o2d` native file format
- `dxf 0.5` for DXF import
- `printpdf 0.7` for PDF export

## Crates

```
kernel/
├── crates/
│   ├── core/           # ECS components (ShapeId, WorldPos, markers), resources
│   ├── commands/       # Command trait + CommandHistory + built-ins (Move/Spawn/Despawn)
│   ├── render/         # wgpu pipelines, tessellation, hatch, arc, text
│   ├── spatial/        # R-tree viewport culling + hit testing
│   ├── fileio/         # .o2d v4 (JSON) read/write
│   ├── dxf-import/     # DXF → ECS entities
│   ├── pdf-export/     # ECS → PDF vector
│   └── app/            # winit + wgpu + egui main loop
```

## Build + test

```bash
cd kernel
cargo test --workspace   # 34 tests pass
cargo build --release
./target/release/kernel-app --headless      # sanity check
./target/release/kernel-app --save-demo path.o2d
./target/release/kernel-app --load path.o2d
./target/release/kernel-app --spatial-bench 100000
./target/release/kernel-app --import-dxf file.dxf
./target/release/kernel-app                 # interactive window (100k shape demo)
```

## Performance

Verified on NVIDIA RTX 2000 Ada Generation Laptop GPU:
- **100k shapes @ 458 FPS** (wgpu 22, instanced rendering)
- Sparse edits (500/frame): 280 FPS
- Heavy edits (5000/frame): 458 FPS via full-buffer rewrite
- Spatial index bulk_load for 100k shapes: **74 ms**
- Viewport query returning 1681 hits: **137 µs**

## Precision

- **f64 storage** for all world coordinates (via `WorldPos`)
- **Floating origin f32 rendering** for GPU vertices (camera-relative)
- Verified to give **nanometer precision (1.19e-7 mm) at 1000 km** distance from origin — 10000× better than the 1 µm target.
- Shewchuk adaptive predicates (`robust` crate) available for exact sign tests (`orient2d`) where naive f64 fails under catastrophic cancellation.

## Design references

- `docs/superpowers/specs/2026-04-16-native-rust-kernel-design.md`
- `docs/superpowers/specs/2026-04-16-parliament-synthesis.md`
- `docs/superpowers/plans/2026-04-16-spike-native-kernel.md`
- `spike/SPIKE-RESULTS.md`
