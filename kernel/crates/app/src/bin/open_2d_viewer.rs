//! Open 2D Viewer — view-only release of Open 2D Studio.
//!
//! Same wgpu-backed tabbed canvas as Open 2D Studio with all authoring
//! affordances stripped: no Draw / Modify / Edit / Annotate-placement
//! ribbon groups, no Save dialogs, no F2 text edit, no Ctrl+Z/Ctrl+V,
//! no Delete. The Open dialog is filtered to `.dwg` + `.dxf` only.
//!
//! This binary is intentionally a thin shim. All shared logic lives in
//! `kernel_app::studio_app`, gated on `AppMode::Viewer`.
//!
//! Usage:
//!   open_2d_viewer                     # no args — start with a blank tab
//!   open_2d_viewer file.dxf file.dwg … # each arg becomes a tab

fn main() -> anyhow::Result<()> {
    kernel_app::run_app(
        std::env::args().skip(1).collect(),
        kernel_app::AppMode::Viewer,
    )
}
