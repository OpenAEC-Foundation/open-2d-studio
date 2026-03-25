mod commands;
mod api_server;
mod dwg_parser;

use commands::{save_file, load_file, export_dxf, import_dxf, import_dwg, execute_shell, open_file_with_default_app, print_file, get_printers, open_printer_properties};
use api_server::{ApiServerState, find_free_port, write_discovery_file, remove_discovery_file, start_server};
use std::sync::Arc;
use tauri::{Emitter, Manager};

/// Tauri command: called from JS to deliver eval results back to the API server
#[tauri::command]
fn api_eval_callback(eval_id: String, result: String, state: tauri::State<'_, Arc<ApiServerState>>) {
    state.deliver_result(&eval_id, result);
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Parse --api-port from command line args (desktop only)
    let requested_port: Option<u16> = std::env::args()
        .position(|a| a == "--api-port")
        .and_then(|i| std::env::args().nth(i + 1))
        .and_then(|v| v.parse().ok());

    // Find a free port
    let port = requested_port.unwrap_or_else(|| find_free_port(49100));

    // Create shared state
    let api_state = Arc::new(ApiServerState::new(port));

    // Write discovery file
    write_discovery_file(port);

    let api_state_clone = api_state.clone();

    tauri::Builder::default()
        .manage(api_state.clone())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .invoke_handler(tauri::generate_handler![
            save_file,
            load_file,
            export_dxf,
            import_dxf,
            import_dwg,
            execute_shell,
            open_file_with_default_app,
            print_file,
            get_printers,
            open_printer_properties,
            api_eval_callback
        ])
        .setup(move |app| {
            // Get the main window
            let window = app
                .get_webview_window("main")
                .expect("Failed to get main window");

            // Start the API server
            start_server(api_state_clone, window);

            // File association: check if the app was launched with a file path argument
            // On Windows, double-clicking a .o2d file spawns the app with the path as an arg
            let args: Vec<String> = std::env::args().collect();
            if args.len() > 1 {
                let file_arg = &args[1];
                if file_arg.ends_with(".o2d") || file_arg.ends_with(".dxf") || file_arg.ends_with(".dwg") {
                    let file_path = file_arg.clone();
                    let app_handle = app.handle().clone();
                    // Emit after a short delay to ensure the frontend is ready
                    std::thread::spawn(move || {
                        std::thread::sleep(std::time::Duration::from_millis(500));
                        let _ = app_handle.emit("file-open", &file_path);
                    });
                }
            }

            Ok(())
        })
        .on_window_event(|_window, event| {
            if let tauri::WindowEvent::Destroyed = event {
                remove_discovery_file();
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
