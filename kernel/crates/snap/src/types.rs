//! types — placeholder until Task 2

use bitflags::bitflags;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SnapMode { Endpoint }

bitflags! {
    #[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
    pub struct SnapModeSet: u32 {
        const ENDPOINT = 1;
    }
}

#[derive(Debug, Clone)]
pub struct SnapResult {
    pub point: [f64; 2],
    pub kind: SnapMode,
    pub source_eid: Option<u32>,
    pub source_angle: Option<f32>,
}

pub struct SnapContext;
pub struct SnapEngine;
