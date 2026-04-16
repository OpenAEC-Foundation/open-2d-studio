use prototype_01_ecs_command::{execute_command, AppWorld, DespawnCommand, MoveCommand};

#[test]
fn move_command_applies_and_reverts() {
    let mut world = AppWorld::new();
    let shape = world.spawn_position(10.0, 20.0);

    execute_command(&mut world, Box::new(MoveCommand {
        shape,
        delta: (5.0, 7.0),
    })).unwrap();

    let pos = world.get_position(shape).unwrap();
    assert_eq!(pos, (15.0, 27.0));

    world.undo().unwrap();
    let pos = world.get_position(shape).unwrap();
    assert_eq!(pos, (10.0, 20.0));

    world.redo().unwrap();
    let pos = world.get_position(shape).unwrap();
    assert_eq!(pos, (15.0, 27.0));
}

#[test]
fn five_commands_roundtrip() {
    let mut world = AppWorld::new();
    let shape = world.spawn_position(0.0, 0.0);
    for i in 1..=5 {
        execute_command(&mut world, Box::new(MoveCommand {
            shape,
            delta: (i as f64, i as f64),
        })).unwrap();
    }
    assert_eq!(world.get_position(shape), Some((15.0, 15.0)));
    for _ in 0..5 { world.undo().unwrap(); }
    assert_eq!(world.get_position(shape), Some((0.0, 0.0)));
    for _ in 0..5 { world.redo().unwrap(); }
    assert_eq!(world.get_position(shape), Some((15.0, 15.0)));
}

#[test]
fn despawn_and_undo_preserves_shape_identity() {
    let mut world = AppWorld::new();
    let shape = world.spawn_position(42.0, 99.0);

    execute_command(&mut world, Box::new(MoveCommand {
        shape,
        delta: (1.0, 1.0),
    })).unwrap();
    assert_eq!(world.get_position(shape), Some((43.0, 100.0)));

    execute_command(&mut world, Box::new(DespawnCommand::new(shape))).unwrap();
    assert!(world.get_position(shape).is_none());

    world.undo().unwrap();
    assert_eq!(world.get_position(shape), Some((43.0, 100.0)));

    world.undo().unwrap();
    assert_eq!(world.get_position(shape), Some((42.0, 99.0)));

    world.redo().unwrap();
    assert_eq!(world.get_position(shape), Some((43.0, 100.0)));
    world.redo().unwrap();
    assert!(world.get_position(shape).is_none());
}

#[test]
fn command_after_despawn_fails_cleanly() {
    let mut world = AppWorld::new();
    let shape = world.spawn_position(0.0, 0.0);
    execute_command(&mut world, Box::new(DespawnCommand::new(shape))).unwrap();

    let result = execute_command(&mut world, Box::new(MoveCommand {
        shape,
        delta: (1.0, 1.0),
    }));
    assert!(result.is_err(), "move on despawned shape must error, not panic");
}
