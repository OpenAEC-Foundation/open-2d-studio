use kernel_app::{App, create_world};
use kernel_core::{Position, ShapeId, ShapeIndex, ShapeKind, Visible};
use winit::event_loop::EventLoop;

fn main() -> anyhow::Result<()> {
    let args: Vec<String> = std::env::args().collect();
    let mode = args.get(1).map(|s| s.as_str()).unwrap_or("gui");

    match mode {
        "--headless" => {
            let world = create_world();
            assert!(world.contains_resource::<kernel_core::ShapeIndex>());
            println!("kernel-app: world bootstraps OK");
            Ok(())
        }
        "--save-demo" => {
            // Seed + save a small demo file
            let mut world = create_world();
            for i in 0..10 {
                let id = ShapeId::new();
                let entity = world.spawn((
                    id,
                    ShapeKind::Line,
                    Position::new(i as f64 * 50.0, 0.0),
                    Visible,
                )).id();
                world.resource_mut::<ShapeIndex>().insert(id, entity);
            }
            let doc = kernel_fileio::serialize_world(&mut world);
            let path = args.get(2).map(|s| s.as_str()).unwrap_or("demo.o2d");
            kernel_fileio::save_o2d(path, &doc)?;
            println!("saved {} shapes to {}", doc.shapes.len(), path);
            Ok(())
        }
        "--load" => {
            let path = args.get(2).ok_or_else(|| anyhow::anyhow!("--load requires path"))?;
            let doc = kernel_fileio::load_o2d(path)?;
            let mut world = create_world();
            kernel_fileio::deserialize_into_world(&mut world, &doc)?;
            println!("loaded {} shapes from {}", doc.shapes.len(), path);
            Ok(())
        }
        "--spatial-bench" => {
            use kernel_spatial::{SpatialEntry, SpatialIndex};
            use kernel_core::WorldBounds;
            use std::time::Instant;

            let count = args.get(2).map(|s| s.parse().unwrap_or(100_000)).unwrap_or(100_000);
            let t0 = Instant::now();
            let entries: Vec<SpatialEntry> = (0..count).map(|i| {
                let x = (i % 1000) as f64 * 10.0;
                let y = (i / 1000) as f64 * 10.0;
                SpatialEntry {
                    id: ShapeId::new(),
                    bounds: WorldBounds { min_x: x, min_y: y, max_x: x + 5.0, max_y: y + 5.0 },
                }
            }).collect();
            let build_time = t0.elapsed();
            let t1 = Instant::now();
            let index = SpatialIndex::bulk_load(entries);
            let load_time = t1.elapsed();
            let t2 = Instant::now();
            let hits = index.query_viewport(
                kernel_core::WorldPos::new(100.0, 100.0),
                kernel_core::WorldPos::new(500.0, 500.0),
            );
            let query_time = t2.elapsed();
            println!("spatial benchmark for {} shapes:", count);
            println!("  build entries: {:?}", build_time);
            println!("  bulk_load:     {:?}", load_time);
            println!("  viewport query: {:?} ({} hits)", query_time, hits.len());
            Ok(())
        }
        _ => {
            let event_loop = EventLoop::new()?;
            let mut app = App::new();
            event_loop.run_app(&mut app)?;
            Ok(())
        }
    }
}
