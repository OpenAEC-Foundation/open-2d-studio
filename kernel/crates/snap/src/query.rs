//! Per-mode query functions. Public entry is `dispatch()` which
//! `SnapEngine::query` calls. Real mode implementations land in Tasks 3-5.

use crate::types::{SnapContext, SnapResult};

pub fn dispatch(_cursor: [f64; 2], _ctx: &SnapContext<'_>) -> Option<SnapResult> {
    None
}
