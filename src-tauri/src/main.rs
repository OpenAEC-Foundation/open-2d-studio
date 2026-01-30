// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;
mod api_server;

use commands::{save_file, load_file, export_dxf, import_dxf};
use api_server::{ApiServerState, find_free_port, write_discovery_file, remove_discovery_file, start_server};
use std::sync::Arc;
use tauri::Manager;

/// Tauri command: called from JS to deliver eval results back to the API server
#[tauri::command]
fn api_eval_callback(eval_id: String, result: String, state: tauri::State<'_, Arc<ApiServerState>>) {
    state.deliver_result(&eval_id, result);
}

fn main() {
    // Parse --api-port from command line args
    let args: Vec<String> = std::env::args().collect();
    let requested_port: Option<u16> = args
        .iter()
        .position(|a| a == "--api-port")
        .and_then(|i| args.get(i + 1))
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
        .invoke_handler(tauri::generate_handler![
            save_file,
            load_file,
            export_dxf,
            import_dxf,
            api_eval_callback
        ])
        .setup(move |app| {
            // Get the main window
            let window = app
                .get_webview_window("main")
                .expect("Failed to get main window");

            // Start the API server
            start_server(api_state_clone, window);

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
