use kernel_app::App;
use winit::event_loop::EventLoop;

fn main() -> anyhow::Result<()> {
    if std::env::args().nth(1).as_deref() == Some("--headless") {
        // Headless sanity check
        let world = kernel_app::create_world();
        assert!(world.contains_resource::<kernel_core::ShapeIndex>());
        println!("kernel-app: world bootstraps OK");
        return Ok(());
    }

    let event_loop = EventLoop::new()?;
    let mut app = App::new();
    event_loop.run_app(&mut app)?;
    Ok(())
}
