//! superui — reusable egui UI components for Open 2D Studio.
//!
//! Phase 1: chrome (TitleBar, Ribbon, FileTabBar, StatusBar) + theme
//! tokens + CadButton primitives + a minimal icon set. Future phases
//! add panels, dialogs, and specialised editors behind feature flags.
//!
//! See `docs/superpowers/specs/2026-05-01-ui-crate-design.md` for the
//! full design.

pub mod theme;
pub mod tokens;
pub mod icon;
pub mod primitives;

#[cfg(feature = "layout")]
pub mod layout;

pub use theme::{Theme, Palette, apply_theme};
