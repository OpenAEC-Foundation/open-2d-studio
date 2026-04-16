use prototype_01_ecs_command::{execute_command, AppWorld, DespawnCommand, MoveCommand};

fn main() -> anyhow::Result<()> {
    let mut world = AppWorld::new();
    let shape = world.spawn_position(0.0, 0.0);
    println!("Spawned: {:?}", world.get_position(shape));

    for i in 1..=3 {
        execute_command(&mut world, Box::new(MoveCommand {
            shape,
            delta: (i as f64 * 10.0, i as f64 * 5.0),
        }))?;
        println!("After move {}: {:?}", i, world.get_position(shape));
    }

    execute_command(&mut world, Box::new(DespawnCommand::new(shape)))?;
    println!("After despawn: {:?}", world.get_position(shape));

    world.undo()?;
    println!("After undo despawn: {:?}", world.get_position(shape));

    world.undo()?;
    println!("After undo move 3:  {:?}", world.get_position(shape));

    world.redo()?;
    println!("After redo move 3:  {:?}", world.get_position(shape));

    Ok(())
}
