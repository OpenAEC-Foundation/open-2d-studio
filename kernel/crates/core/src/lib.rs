//! kernel-core — ECS types en stable ID abstractions voor de Open 2D Studio kernel.
//!
//! Bevat de core datamodellen (f64 WorldPos, ShapeId, ShapeIndex) die gedeeld
//! worden door render, commands, en de app layer. Geen GPU-specifieke types —
//! die leven in kernel-render.

use bevy_ecs::prelude::*;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use uuid::Uuid;

pub mod error;
pub mod precision;

pub use error::{KernelError, KernelResult};

// ── Stable identifiers ───────────────────────────────────────────────────

/// Stable shape identifier. Survives entity despawn/respawn because it is
/// decoupled from bevy's Entity handle (which is recycled).
#[derive(Component, Copy, Clone, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct ShapeId(pub Uuid);

impl ShapeId {
    pub fn new() -> Self { Self(Uuid::new_v4()) }
}

impl Default for ShapeId {
    fn default() -> Self { Self::new() }
}

/// Stable layer identifier.
#[derive(Component, Copy, Clone, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct LayerId(pub Uuid);

impl LayerId {
    pub fn new() -> Self { Self(Uuid::new_v4()) }
}

/// Stable drawing identifier.
#[derive(Component, Copy, Clone, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct DrawingId(pub Uuid);

impl DrawingId {
    pub fn new() -> Self { Self(Uuid::new_v4()) }
}

// ── Shape kinds ──────────────────────────────────────────────────────────

/// Discriminated union of all supported shape types.
/// Extension shapes carry a `Custom(u32)` tag; the u32 is a type-id registered
/// at startup via kernel-render's `ShapeRendererRegistry`.
#[derive(Component, Copy, Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum ShapeKind {
    Line,
    Rectangle,
    Circle,
    Arc,
    Ellipse,
    Polyline,
    Spline,
    Text,
    Dimension,
    Hatch,
    Image,
    /// Extension-registered shape type, identified by runtime u32.
    Custom(u32),
}

// ── Core geometry components ─────────────────────────────────────────────

/// World position in f64 mm. f64 storage ensures sub-micrometer precision
/// up to 10^12 mm (1000 km × 1000). See `kernel-core::precision`.
#[derive(Component, Copy, Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct WorldPos {
    pub x: f64,
    pub y: f64,
}

impl WorldPos {
    pub const fn new(x: f64, y: f64) -> Self { Self { x, y } }
    pub const fn origin() -> Self { Self { x: 0.0, y: 0.0 } }
}

/// Alias for WorldPos to match common component naming.
pub type Position = WorldPos;

/// Axis-aligned bounding box in world f64 mm.
#[derive(Component, Copy, Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct WorldBounds {
    pub min_x: f64,
    pub min_y: f64,
    pub max_x: f64,
    pub max_y: f64,
}

impl WorldBounds {
    pub fn width(&self) -> f64 { self.max_x - self.min_x }
    pub fn height(&self) -> f64 { self.max_y - self.min_y }
    pub fn contains(&self, p: WorldPos) -> bool {
        p.x >= self.min_x && p.x <= self.max_x &&
        p.y >= self.min_y && p.y <= self.max_y
    }
}

/// 2D transform in f32 (local, small values — safe).
#[derive(Component, Copy, Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Transform2D {
    pub rotation: f32,
    pub scale_x: f32,
    pub scale_y: f32,
}

impl Default for Transform2D {
    fn default() -> Self { Self { rotation: 0.0, scale_x: 1.0, scale_y: 1.0 } }
}

/// Reference into a style table (styles are stored in kernel-render's StyleTable resource).
#[derive(Component, Copy, Clone, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct StyleRef(pub u32);

// ── Marker components ────────────────────────────────────────────────────

#[derive(Component, Default)] pub struct Visible;
#[derive(Component, Default)] pub struct Selected;
#[derive(Component, Default)] pub struct Hovered;
/// Marks an entity as needing GPU instance buffer re-upload this frame.
#[derive(Component, Default)] pub struct Dirty;
#[derive(Component, Default)] pub struct Locked;

// ── Resources ────────────────────────────────────────────────────────────

/// Runtime index mapping stable ShapeId → current Entity handle.
/// Rebuilt on spawn/despawn. Commands reference ShapeId, lookup via this index.
#[derive(Resource, Default, Debug)]
pub struct ShapeIndex {
    pub map: HashMap<ShapeId, Entity>,
}

impl ShapeIndex {
    pub fn lookup(&self, id: ShapeId) -> Option<Entity> { self.map.get(&id).copied() }
    pub fn insert(&mut self, id: ShapeId, entity: Entity) { self.map.insert(id, entity); }
    pub fn remove(&mut self, id: ShapeId) -> Option<Entity> { self.map.remove(&id) }
    pub fn len(&self) -> usize { self.map.len() }
    pub fn is_empty(&self) -> bool { self.map.is_empty() }
}

/// The currently active drawing (document-level focus).
#[derive(Resource, Debug)]
pub struct ActiveDrawing(pub DrawingId);

/// Floating-origin camera anchor — world coords in f64.
/// On render, instance positions are sent as (WorldPos - origin).as_f32()
/// to avoid f32 precision loss on large world coords.
#[derive(Resource, Copy, Clone, Debug)]
pub struct RenderOrigin {
    pub x: f64,
    pub y: f64,
}

impl Default for RenderOrigin {
    fn default() -> Self { Self { x: 0.0, y: 0.0 } }
}

impl RenderOrigin {
    pub const fn new(x: f64, y: f64) -> Self { Self { x, y } }

    /// Distance threshold that triggers origin rebase. 1 km in mm = 1_000_000.
    pub const REBASE_THRESHOLD_MM: f64 = 1_000_000.0;

    pub fn needs_rebase(&self, camera: WorldPos) -> bool {
        (camera.x - self.x).abs() > Self::REBASE_THRESHOLD_MM ||
        (camera.y - self.y).abs() > Self::REBASE_THRESHOLD_MM
    }
}

/// Viewport in world coordinates (pan = camera center in f64, zoom f32).
#[derive(Resource, Copy, Clone, Debug)]
pub struct Viewport {
    pub center: WorldPos,
    pub zoom: f32,
    pub rotation: f32,
}

impl Default for Viewport {
    fn default() -> Self {
        Self { center: WorldPos::origin(), zoom: 1.0, rotation: 0.0 }
    }
}

// ── World bootstrap ──────────────────────────────────────────────────────

/// Creates a new bevy_ecs::World with all kernel-core resources initialised.
pub fn new_world() -> World {
    let mut world = World::new();
    world.insert_resource(ShapeIndex::default());
    world.insert_resource(RenderOrigin::default());
    world.insert_resource(Viewport::default());
    world.insert_resource(ActiveDrawing(DrawingId::new()));
    world
}
