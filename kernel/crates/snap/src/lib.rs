//! kernel-snap — OSNAP engine for Open 2D Studio.
//!
//! Pure-data crate, no UI dependencies. Inputs: cursor world point,
//! scene index, active modes. Outputs: at most one `SnapResult`
//! per query.
//!
//! See `docs/superpowers/specs/2026-05-01-drawing-tools-design.md`
//! §4.1 and §6 for the design.

pub mod types;
pub mod query;
pub mod constraint;
pub mod tracking;

pub use types::{SnapMode, SnapModeSet, SnapResult, SnapContext, SnapEngine};
