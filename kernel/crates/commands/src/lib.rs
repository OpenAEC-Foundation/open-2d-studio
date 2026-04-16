//! kernel-commands — Command pattern + undo/redo history voor alle mutations.
//!
//! Design principe: ALLE wijzigingen aan de ECS World gaan via een `Command`.
//! Dit garandeert dat de undo-stack 1:1 correspondeert met gebruikersacties,
//! en maakt serialisering / replay / macros mogelijk.
//!
//! Commands verwijzen naar stable `ShapeId` (geen `Entity` handles). Zo blijft
//! undo correct over despawn-respawn grenzen heen.

use bevy_ecs::prelude::*;
use kernel_core::{KernelError, KernelResult, Position, ShapeId, ShapeIndex};
use std::any::Any;
use std::sync::Mutex;

// ── Command trait ────────────────────────────────────────────────────────

/// All mutations to the World MUST implement Command.
/// Both apply() and revert() must be idempotent-compatible and reverseable.
pub trait Command: Send + Sync + Any {
    fn apply(&self, world: &mut World) -> KernelResult<()>;
    fn revert(&self, world: &mut World) -> KernelResult<()>;
    fn description(&self) -> String;

    /// Optional: merge adjacent same-type commands within a merge window.
    /// Return `true` if `other` was merged into `self`.
    fn try_merge(&mut self, _other: &dyn Command) -> bool { false }

    fn as_any(&self) -> &dyn Any;
}

// ── Command history ──────────────────────────────────────────────────────

#[derive(Resource, Default)]
pub struct CommandHistory {
    pub past: Vec<Box<dyn Command>>,
    pub future: Vec<Box<dyn Command>>,
    pub max_depth: usize,
}

impl CommandHistory {
    pub fn with_capacity(max: usize) -> Self {
        Self { past: Vec::new(), future: Vec::new(), max_depth: max }
    }
}

/// Execute a new command: apply + push to history.
pub fn execute(world: &mut World, cmd: Box<dyn Command>) -> KernelResult<()> {
    cmd.apply(world)?;
    world.resource_scope::<CommandHistory, _>(|_, mut hist| {
        hist.past.push(cmd);
        hist.future.clear();
        // Respect max_depth (0 = unlimited)
        if hist.max_depth > 0 && hist.past.len() > hist.max_depth {
            hist.past.remove(0);
        }
    });
    Ok(())
}

pub fn undo(world: &mut World) -> KernelResult<()> {
    world.resource_scope::<CommandHistory, _>(|world, mut hist| -> KernelResult<()> {
        let cmd = hist.past.pop().ok_or_else(|| KernelError::InvalidState("nothing to undo".into()))?;
        cmd.revert(world)?;
        hist.future.push(cmd);
        Ok(())
    })
}

pub fn redo(world: &mut World) -> KernelResult<()> {
    world.resource_scope::<CommandHistory, _>(|world, mut hist| -> KernelResult<()> {
        let cmd = hist.future.pop().ok_or_else(|| KernelError::InvalidState("nothing to redo".into()))?;
        cmd.apply(world)?;
        hist.past.push(cmd);
        Ok(())
    })
}

// ── Built-in commands ────────────────────────────────────────────────────

/// Move a shape by (dx, dy) in world coordinates.
pub struct MoveCommand {
    pub shape: ShapeId,
    pub delta: (f64, f64),
}

impl Command for MoveCommand {
    fn apply(&self, world: &mut World) -> KernelResult<()> {
        let entity = world.resource::<ShapeIndex>().lookup(self.shape)
            .ok_or(KernelError::ShapeNotFound(self.shape))?;
        let mut pos = world.get_mut::<Position>(entity)
            .ok_or(KernelError::MissingComponent { component: "WorldPos" })?;
        pos.x += self.delta.0;
        pos.y += self.delta.1;
        Ok(())
    }
    fn revert(&self, world: &mut World) -> KernelResult<()> {
        let entity = world.resource::<ShapeIndex>().lookup(self.shape)
            .ok_or(KernelError::ShapeNotFound(self.shape))?;
        let mut pos = world.get_mut::<Position>(entity)
            .ok_or(KernelError::MissingComponent { component: "WorldPos" })?;
        pos.x -= self.delta.0;
        pos.y -= self.delta.1;
        Ok(())
    }
    fn description(&self) -> String { format!("Move {:?}", self.shape) }
    fn try_merge(&mut self, other: &dyn Command) -> bool {
        if let Some(o) = other.as_any().downcast_ref::<MoveCommand>() {
            if o.shape == self.shape {
                self.delta.0 += o.delta.0;
                self.delta.1 += o.delta.1;
                return true;
            }
        }
        false
    }
    fn as_any(&self) -> &dyn Any { self }
}

/// Spawn a new shape with a position.
pub struct SpawnShapeCommand {
    pub shape: ShapeId,
    pub position: (f64, f64),
}

impl Command for SpawnShapeCommand {
    fn apply(&self, world: &mut World) -> KernelResult<()> {
        let entity = world.spawn((
            self.shape,
            Position { x: self.position.0, y: self.position.1 },
        )).id();
        world.resource_mut::<ShapeIndex>().insert(self.shape, entity);
        Ok(())
    }
    fn revert(&self, world: &mut World) -> KernelResult<()> {
        let entity = world.resource_mut::<ShapeIndex>().remove(self.shape)
            .ok_or(KernelError::ShapeNotFound(self.shape))?;
        world.despawn(entity);
        Ok(())
    }
    fn description(&self) -> String { format!("Spawn {:?}", self.shape) }
    fn as_any(&self) -> &dyn Any { self }
}

/// Despawn a shape, archiving components for undo restoration.
pub struct DespawnShapeCommand {
    pub shape: ShapeId,
    archived_position: Mutex<Option<Position>>,
}

impl DespawnShapeCommand {
    pub fn new(shape: ShapeId) -> Self {
        Self { shape, archived_position: Mutex::new(None) }
    }
}

impl Command for DespawnShapeCommand {
    fn apply(&self, world: &mut World) -> KernelResult<()> {
        let entity = world.resource::<ShapeIndex>().lookup(self.shape)
            .ok_or(KernelError::ShapeNotFound(self.shape))?;
        let pos = world.get::<Position>(entity).copied();
        *self.archived_position.lock().unwrap() = pos;
        world.resource_mut::<ShapeIndex>().remove(self.shape);
        world.despawn(entity);
        Ok(())
    }
    fn revert(&self, world: &mut World) -> KernelResult<()> {
        let pos = self.archived_position.lock().unwrap()
            .ok_or_else(|| KernelError::InvalidState("no archived position".into()))?;
        let entity = world.spawn((self.shape, pos)).id();
        world.resource_mut::<ShapeIndex>().insert(self.shape, entity);
        Ok(())
    }
    fn description(&self) -> String { format!("Despawn {:?}", self.shape) }
    fn as_any(&self) -> &dyn Any { self }
}

// ── Bootstrap ────────────────────────────────────────────────────────────

pub fn install(world: &mut World) {
    world.insert_resource(CommandHistory::with_capacity(500));
}

#[cfg(test)]
mod tests {
    use super::*;
    use kernel_core::new_world;

    #[test]
    fn move_roundtrip() {
        let mut world = new_world();
        install(&mut world);
        let shape = ShapeId::new();
        execute(&mut world, Box::new(SpawnShapeCommand { shape, position: (10.0, 20.0) })).unwrap();
        execute(&mut world, Box::new(MoveCommand { shape, delta: (5.0, 7.0) })).unwrap();

        let entity = world.resource::<ShapeIndex>().lookup(shape).unwrap();
        assert_eq!(world.get::<Position>(entity).unwrap().x, 15.0);

        undo(&mut world).unwrap();
        let entity = world.resource::<ShapeIndex>().lookup(shape).unwrap();
        assert_eq!(world.get::<Position>(entity).unwrap().x, 10.0);
    }

    #[test]
    fn despawn_over_undo_boundary() {
        let mut world = new_world();
        install(&mut world);
        let shape = ShapeId::new();
        execute(&mut world, Box::new(SpawnShapeCommand { shape, position: (42.0, 99.0) })).unwrap();
        execute(&mut world, Box::new(MoveCommand { shape, delta: (1.0, 1.0) })).unwrap();
        execute(&mut world, Box::new(DespawnShapeCommand::new(shape))).unwrap();

        assert!(world.resource::<ShapeIndex>().lookup(shape).is_none());

        // Undo despawn
        undo(&mut world).unwrap();
        let entity = world.resource::<ShapeIndex>().lookup(shape).unwrap();
        assert_eq!(world.get::<Position>(entity).unwrap().x, 43.0);

        // Undo move
        undo(&mut world).unwrap();
        let entity = world.resource::<ShapeIndex>().lookup(shape).unwrap();
        assert_eq!(world.get::<Position>(entity).unwrap().x, 42.0);

        // Redo move
        redo(&mut world).unwrap();
        let entity = world.resource::<ShapeIndex>().lookup(shape).unwrap();
        assert_eq!(world.get::<Position>(entity).unwrap().x, 43.0);
    }
}
