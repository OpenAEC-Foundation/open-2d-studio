use bevy_ecs::prelude::*;
use std::any::Any;
use std::collections::HashMap;
use uuid::Uuid;

/// Stable identifier — survives entity despawn/respawn.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Component)]
pub struct ShapeId(pub Uuid);

impl ShapeId {
    pub fn new() -> Self { Self(Uuid::new_v4()) }
}

#[derive(Component, Debug, Clone, Copy, PartialEq)]
pub struct Position(pub f64, pub f64);

/// Maps stable ShapeId -> current Entity. Updated on spawn/despawn.
#[derive(Resource, Default, Debug)]
pub struct ShapeIndex {
    pub map: HashMap<ShapeId, Entity>,
}

impl ShapeIndex {
    pub fn lookup(&self, id: ShapeId) -> Option<Entity> { self.map.get(&id).copied() }
    pub fn insert(&mut self, id: ShapeId, entity: Entity) { self.map.insert(id, entity); }
    pub fn remove(&mut self, id: ShapeId) -> Option<Entity> { self.map.remove(&id) }
}

pub trait Command: Send + Sync + Any {
    fn apply(&self, world: &mut bevy_ecs::world::World) -> anyhow::Result<()>;
    fn revert(&self, world: &mut bevy_ecs::world::World) -> anyhow::Result<()>;
    fn as_any(&self) -> &dyn Any;
}

/// Helper: resolve a ShapeId to the current Entity.
fn resolve(world: &bevy_ecs::world::World, id: ShapeId) -> anyhow::Result<Entity> {
    world.resource::<ShapeIndex>().lookup(id)
        .ok_or_else(|| anyhow::anyhow!("ShapeId {:?} not in index", id))
}

// ── MoveCommand ──────────────────────────────────────────────────────────
pub struct MoveCommand {
    pub shape: ShapeId,
    pub delta: (f64, f64),
}

impl Command for MoveCommand {
    fn apply(&self, world: &mut bevy_ecs::world::World) -> anyhow::Result<()> {
        let entity = resolve(world, self.shape)?;
        let mut pos = world.get_mut::<Position>(entity)
            .ok_or_else(|| anyhow::anyhow!("no Position on entity"))?;
        pos.0 += self.delta.0;
        pos.1 += self.delta.1;
        Ok(())
    }
    fn revert(&self, world: &mut bevy_ecs::world::World) -> anyhow::Result<()> {
        let entity = resolve(world, self.shape)?;
        let mut pos = world.get_mut::<Position>(entity)
            .ok_or_else(|| anyhow::anyhow!("no Position on entity"))?;
        pos.0 -= self.delta.0;
        pos.1 -= self.delta.1;
        Ok(())
    }
    fn as_any(&self) -> &dyn Any { self }
}

// ── SpawnCommand ─────────────────────────────────────────────────────────
pub struct SpawnCommand {
    pub shape: ShapeId,
    pub position: (f64, f64),
}

impl Command for SpawnCommand {
    fn apply(&self, world: &mut bevy_ecs::world::World) -> anyhow::Result<()> {
        let entity = world.spawn((self.shape, Position(self.position.0, self.position.1))).id();
        world.resource_mut::<ShapeIndex>().insert(self.shape, entity);
        Ok(())
    }
    fn revert(&self, world: &mut bevy_ecs::world::World) -> anyhow::Result<()> {
        let entity = world.resource_mut::<ShapeIndex>().remove(self.shape)
            .ok_or_else(|| anyhow::anyhow!("despawn: shape not in index"))?;
        world.despawn(entity);
        Ok(())
    }
    fn as_any(&self) -> &dyn Any { self }
}

// ── DespawnCommand ────────────────────────────────────────────────────────
// archived_position needs interior mutability + Sync. `Cell` is !Sync,
// so we use `Mutex` instead. For single-threaded CAD usage the overhead is
// negligible; for future multi-threaded undo from scheduler systems it is required.
pub struct DespawnCommand {
    pub shape: ShapeId,
    archived_position: std::sync::Mutex<Option<Position>>,
}

impl DespawnCommand {
    pub fn new(shape: ShapeId) -> Self {
        Self { shape, archived_position: std::sync::Mutex::new(None) }
    }
}

impl Command for DespawnCommand {
    fn apply(&self, world: &mut bevy_ecs::world::World) -> anyhow::Result<()> {
        let entity = resolve(world, self.shape)?;
        let pos = world.get::<Position>(entity).copied();
        *self.archived_position.lock().unwrap() = pos;
        world.resource_mut::<ShapeIndex>().remove(self.shape);
        world.despawn(entity);
        Ok(())
    }
    fn revert(&self, world: &mut bevy_ecs::world::World) -> anyhow::Result<()> {
        let pos = self.archived_position.lock().unwrap()
            .ok_or_else(|| anyhow::anyhow!("no archived position to restore"))?;
        let entity = world.spawn((self.shape, pos)).id();
        world.resource_mut::<ShapeIndex>().insert(self.shape, entity);
        Ok(())
    }
    fn as_any(&self) -> &dyn Any { self }
}

#[derive(Resource, Default)]
pub struct CommandHistory {
    past: Vec<Box<dyn Command>>,
    future: Vec<Box<dyn Command>>,
}

pub struct AppWorld {
    inner: bevy_ecs::world::World,
}

impl AppWorld {
    pub fn new() -> Self {
        let mut inner = bevy_ecs::world::World::new();
        inner.insert_resource(CommandHistory::default());
        inner.insert_resource(ShapeIndex::default());
        Self { inner }
    }

    pub fn spawn_position(&mut self, x: f64, y: f64) -> ShapeId {
        let id = ShapeId::new();
        let cmd = SpawnCommand { shape: id, position: (x, y) };
        cmd.apply(&mut self.inner).expect("spawn should not fail");
        self.inner.resource_mut::<CommandHistory>().past.push(Box::new(cmd));
        id
    }

    pub fn get_position(&self, id: ShapeId) -> Option<(f64, f64)> {
        let entity = self.inner.resource::<ShapeIndex>().lookup(id)?;
        self.inner.get::<Position>(entity).map(|p| (p.0, p.1))
    }

    pub fn undo(&mut self) -> anyhow::Result<()> {
        self.inner.resource_scope(|world, mut hist: Mut<CommandHistory>| -> anyhow::Result<()> {
            let cmd = hist.past.pop().ok_or_else(|| anyhow::anyhow!("nothing to undo"))?;
            cmd.revert(world)?;
            hist.future.push(cmd);
            Ok(())
        })
    }

    pub fn redo(&mut self) -> anyhow::Result<()> {
        self.inner.resource_scope(|world, mut hist: Mut<CommandHistory>| -> anyhow::Result<()> {
            let cmd = hist.future.pop().ok_or_else(|| anyhow::anyhow!("nothing to redo"))?;
            cmd.apply(world)?;
            hist.past.push(cmd);
            Ok(())
        })
    }
}

pub fn execute_command(world: &mut AppWorld, cmd: Box<dyn Command>) -> anyhow::Result<()> {
    cmd.apply(&mut world.inner)?;
    let mut hist = world.inner.resource_mut::<CommandHistory>();
    hist.past.push(cmd);
    hist.future.clear();
    Ok(())
}
