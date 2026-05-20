//! Open 2D Studio — full authoring shell binary.
//!
//! Thin shim around `kernel_app::studio_app::run` in `AppMode::Studio`.
//! Source moved out of this file on 2026-05-20 into the library module
//! `kernel_app::studio_app` so the same code can ship as both Studio
//! (full authoring tool) and Viewer (view-only) variants.
//!
//! Usage:
//!   open_2d_studio                     # no args — start with a blank tab
//!   open_2d_studio <base>              # legacy "base" mode: open <base>.dxf + <base>.dwg
//!   open_2d_studio file.dxf file.dwg … # each arg becomes a tab

fn main() -> anyhow::Result<()> {
    kernel_app::run_app(
        std::env::args().skip(1).collect(),
        kernel_app::AppMode::Studio,
    )
}
