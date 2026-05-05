//! Modal dialogs and floating popups, gated behind the `dialogs`
//! feature. Each dialog is a thin egui::Window wrapper that returns an
//! action enum so the consumer can dispatch real work.
//!
//! Wiring expectation:
//! ```ignore
//! if let Some(action) = AppMenu::new(open_pos).show(ctx, &mut open) {
//!     dispatch(action);
//! }
//! ```

pub mod app_menu;
pub mod file_picker;
pub mod file_preview;
pub mod file_version;

pub use app_menu::{AppMenu, AppMenuAction};
pub use file_picker::{FilePicker, FilePickerAction, FilePickerState, PreviewEntry, PreviewProvider};
pub use file_preview::rasterize_segments;
pub use file_version::detect_version;
