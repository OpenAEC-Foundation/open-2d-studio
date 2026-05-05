//! Side-dock panels — left rail (Drawings / Sheets) and right rail
//! (Properties). Both gated behind the `panels` feature.
//!
//! These widgets are intentionally data-driven mirrors of the 1.0 React
//! `LeftPanel` / `PropertiesPanel`: the consumer builds a slice of items
//! per frame, the dock returns a `Vec<…Action>`, and the consumer
//! dispatches. No stored UI state inside superui.
//!
//! Wiring expectation (from the consumer):
//! ```ignore
//! egui::SidePanel::left("left_dock").exact_width(248.0).show(ctx, |ui| {
//!     for a in LeftDock::new(&drawings, &sheets, ...).show(ui) { dispatch(a); }
//! });
//! ```

pub mod left_dock;
pub mod right_dock;
pub mod structure_tree;

pub use left_dock::{LeftDock, LeftDockAction, DrawingItem, SheetItem};
pub use right_dock::{RightDock, RightDockAction};
pub use structure_tree::{StructureTree, StructureTreeAction, TreeNode, NodeKind};
