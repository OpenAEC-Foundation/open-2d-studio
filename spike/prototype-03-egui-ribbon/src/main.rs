//! Headless API probe: verifieer egui 0.29, egui-wgpu 0.29, egui-winit 0.29, egui_dock 0.14
//! compileren samen zonder een window te openen.

use egui_dock::{DockState, NodeIndex};

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum Panel { Canvas, Properties, Layers, Navigation }

fn initial_dock_state() -> DockState<Panel> {
    let mut state = DockState::new(vec![Panel::Canvas]);
    let [_main, _right] = state.main_surface_mut().split_right(
        NodeIndex::root(),
        0.75,
        vec![Panel::Properties],
    );
    state
}

fn main() {
    // Probe: build egui context without winit
    let ctx = egui::Context::default();
    println!("egui::Context built");

    // Probe: egui_wgpu::Renderer::new signature
    // Dit vereist een wgpu::Device - we skippen voor headless probe.
    println!("egui-wgpu skipped (needs device)");

    // Probe: egui_dock DockState compileert
    let _dock = initial_dock_state();
    println!("egui_dock DockState built");

    // Probe: egui.run met dummy input
    let output = ctx.run(egui::RawInput::default(), |ctx| {
        egui::CentralPanel::default().show(ctx, |ui| {
            ui.label("hello");
        });
    });
    println!("egui.run produced {} shapes", output.shapes.len());
}
