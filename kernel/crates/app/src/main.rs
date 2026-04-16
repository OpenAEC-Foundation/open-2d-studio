use kernel_app::create_world;
use kernel_commands::{execute, MoveCommand, SpawnShapeCommand};
use kernel_core::{Position, ShapeId, ShapeIndex};

fn main() -> anyhow::Result<()> {
    let mut world = create_world();

    // Spawn 3 shapes
    let mut ids = Vec::new();
    for i in 0..3 {
        let id = ShapeId::new();
        execute(&mut world, Box::new(SpawnShapeCommand {
            shape: id,
            position: (i as f64 * 100.0, 0.0),
        }))?;
        ids.push(id);
    }

    println!("After spawn:");
    for id in &ids {
        let entity = world.resource::<ShapeIndex>().lookup(*id).unwrap();
        let pos = world.get::<Position>(entity).unwrap();
        println!("  {:?}: ({}, {})", id, pos.x, pos.y);
    }

    // Move them all
    for id in &ids {
        execute(&mut world, Box::new(MoveCommand {
            shape: *id,
            delta: (10.0, 5.0),
        }))?;
    }

    println!("After move:");
    for id in &ids {
        let entity = world.resource::<ShapeIndex>().lookup(*id).unwrap();
        let pos = world.get::<Position>(entity).unwrap();
        println!("  {:?}: ({}, {})", id, pos.x, pos.y);
    }

    // Undo moves
    for _ in 0..3 {
        kernel_commands::undo(&mut world)?;
    }

    println!("After 3× undo:");
    for id in &ids {
        let entity = world.resource::<ShapeIndex>().lookup(*id).unwrap();
        let pos = world.get::<Position>(entity).unwrap();
        println!("  {:?}: ({}, {})", id, pos.x, pos.y);
    }

    Ok(())
}
