//! External API Server - HTTP bridge for external tools to control the app.
//!
//! Runs a local HTTP server on localhost that accepts JSON commands,
//! forwards them to the webview for execution via `window.cad`, and returns results.
//!
//! Endpoints:
//! - GET  /health    - Check if the app is running
//! - GET  /info      - Get instance info (port, PID, project name)
//! - POST /eval      - Execute JavaScript in the webview context
//! - POST /exec      - Execute a named API method with JSON params

use std::net::TcpListener;
use std::sync::{Arc, Mutex};
use std::collections::HashMap;
use std::time::{Duration, Instant};
use tauri::WebviewWindow;

/// Result from JS eval, stored by callback
struct EvalResult {
    ready: bool,
    value: Option<String>,
}

/// Shared state between HTTP server and Tauri
pub struct ApiServerState {
    pub port: u16,
    pending_evals: Mutex<HashMap<String, Arc<Mutex<EvalResult>>>>,
}

impl ApiServerState {
    pub fn new(port: u16) -> Self {
        Self {
            port,
            pending_evals: Mutex::new(HashMap::new()),
        }
    }

    /// Register a pending eval and return its ID
    fn register_eval(&self) -> (String, Arc<Mutex<EvalResult>>) {
        let id = format!("eval_{}", uuid_simple());
        let result = Arc::new(Mutex::new(EvalResult {
            ready: false,
            value: None,
        }));
        self.pending_evals
            .lock()
            .unwrap()
            .insert(id.clone(), result.clone());
        (id, result)
    }

    /// Called from JS callback to deliver result
    pub fn deliver_result(&self, id: &str, value: String) {
        if let Some(result) = self.pending_evals.lock().unwrap().get(id) {
            let mut r = result.lock().unwrap();
            r.value = Some(value);
            r.ready = true;
        }
    }

    /// Clean up a completed eval
    fn cleanup_eval(&self, id: &str) {
        self.pending_evals.lock().unwrap().remove(id);
    }
}

/// Generate a simple unique ID
fn uuid_simple() -> String {
    use std::time::SystemTime;
    let t = SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    format!("{:x}", t)
}

/// Find a free port starting from the given port
pub fn find_free_port(start: u16) -> u16 {
    for port in start..start + 100 {
        if TcpListener::bind(format!("127.0.0.1:{}", port)).is_ok() {
            return port;
        }
    }
    panic!("Could not find a free port in range {}..{}", start, start + 100);
}

/// Write instance discovery file so external tools can find us
pub fn write_discovery_file(port: u16) {
    let pid = std::process::id();
    if let Some(dir) = dirs_discovery() {
        let _ = std::fs::create_dir_all(&dir);
        let path = format!("{}/instance-{}.json", dir, pid);
        let content = format!(
            r#"{{"pid":{},"port":{},"startedAt":"{}"}}"#,
            pid,
            port,
            chrono_simple()
        );
        let _ = std::fs::write(&path, content);
    }
}

/// Remove discovery file on shutdown
pub fn remove_discovery_file() {
    let pid = std::process::id();
    if let Some(dir) = dirs_discovery() {
        let path = format!("{}/instance-{}.json", dir, pid);
        let _ = std::fs::remove_file(&path);
    }
}

/// Get discovery directory path
fn dirs_discovery() -> Option<String> {
    // Use APPDATA on Windows, HOME/.config on Unix
    if cfg!(windows) {
        std::env::var("APPDATA")
            .ok()
            .map(|d| format!("{}\\Open2DModeler\\instances", d))
    } else {
        std::env::var("HOME")
            .ok()
            .map(|d| format!("{}/.config/open-2d-modeler/instances", d))
    }
}

/// Simple timestamp string
fn chrono_simple() -> String {
    use std::time::SystemTime;
    let d = SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .unwrap_or_default();
    format!("{}", d.as_secs())
}

/// Helper: build CORS headers
fn cors_headers() -> Vec<tiny_http::Header> {
    vec![
        tiny_http::Header::from_bytes(&b"Access-Control-Allow-Origin"[..], &b"*"[..]).unwrap(),
        tiny_http::Header::from_bytes(&b"Access-Control-Allow-Methods"[..], &b"GET, POST, OPTIONS"[..]).unwrap(),
        tiny_http::Header::from_bytes(&b"Access-Control-Allow-Headers"[..], &b"Content-Type"[..]).unwrap(),
        tiny_http::Header::from_bytes(&b"Content-Type"[..], &b"application/json"[..]).unwrap(),
    ]
}

/// Helper: respond with JSON body and CORS headers
fn respond_json(request: tiny_http::Request, status: u16, body: &str) {
    let resp = tiny_http::Response::from_string(body).with_status_code(status);
    let mut resp = resp.boxed();
    for h in &cors_headers() {
        resp.add_header(h.clone());
    }
    let _ = request.respond(resp);
}

/// Read request body as string
fn read_body(request: &mut tiny_http::Request) -> String {
    let len = request.body_length().unwrap_or(0);
    let mut buf = vec![0u8; len];
    let _ = std::io::Read::read_exact(&mut request.as_reader(), &mut buf);
    String::from_utf8_lossy(&buf).to_string()
}

/// Start the API HTTP server in a background thread.
/// Each request is handled in its own thread so callbacks can arrive
/// while /eval is waiting for results.
pub fn start_server(
    state: Arc<ApiServerState>,
    window: WebviewWindow,
) -> std::thread::JoinHandle<()> {
    let port = state.port;

    std::thread::spawn(move || {
        let server = Arc::new(match tiny_http::Server::http(format!("127.0.0.1:{}", port)) {
            Ok(s) => s,
            Err(e) => {
                eprintln!("[ApiServer] Failed to start on port {}: {}", port, e);
                return;
            }
        });

        println!("[ApiServer] Listening on http://127.0.0.1:{}", port);

        // Use a thread pool approach: accept requests and spawn handlers
        loop {
            let request = match server.recv() {
                Ok(r) => r,
                Err(_) => break,
            };

            let state = state.clone();
            let window = window.clone();
            std::thread::spawn(move || {
                handle_request(request, state, window);
            });
        }
    })
}

fn handle_request(
    mut request: tiny_http::Request,
    state: Arc<ApiServerState>,
    window: WebviewWindow,
) {
    let url = request.url().to_string();
    let method = request.method().as_str().to_string();

    // Handle CORS preflight
    if method == "OPTIONS" {
        let response = tiny_http::Response::empty(200);
        let mut response = response.boxed();
        for h in &cors_headers() {
            response.add_header(h.clone());
        }
        let _ = request.respond(response);
        return;
    }

    match (method.as_str(), url.as_str()) {
        ("GET", "/health") => {
            respond_json(request, 200, r#"{"status":"ok"}"#);
        }

        ("GET", "/info") => {
            let body = format!(
                r#"{{"pid":{},"port":{},"version":"0.3.0"}}"#,
                std::process::id(),
                state.port
            );
            respond_json(request, 200, &body);
        }

        ("POST", "/eval") => {
            let body = read_body(&mut request);

            // Parse JSON: { "script": "..." }
            let parsed: Result<serde_json::Value, _> = serde_json::from_str(&body);
            let script = match parsed {
                Ok(v) => v["script"].as_str().unwrap_or("").to_string(),
                Err(_) => body.clone(),
            };

            if script.is_empty() {
                respond_json(request, 400,
                    r#"{"success":false,"error":"No script provided. Send {\"script\":\"...\"}"}"#);
                return;
            }

            // Register pending eval
            let (eval_id, result_handle) = state.register_eval();

            // Build JS: execute script, callback via Tauri invoke
            let js = format!(
                r#"(async function() {{
                    try {{
                        const __result = await (async () => {{ {script} }})();
                        let __serialized;
                        try {{
                            __serialized = JSON.stringify(__result);
                        }} catch(e) {{
                            __serialized = JSON.stringify(String(__result));
                        }}
                        const __payload = JSON.stringify({{ success: true, result: __serialized }});
                        window.__TAURI_INTERNALS__.invoke('api_eval_callback', {{
                            evalId: '{eval_id}',
                            result: __payload
                        }});
                    }} catch(e) {{
                        const __payload = JSON.stringify({{ success: false, error: e.message || String(e) }});
                        window.__TAURI_INTERNALS__.invoke('api_eval_callback', {{
                            evalId: '{eval_id}',
                            result: __payload
                        }});
                    }}
                }})()"#,
                script = script.replace('\\', "\\\\"),
                eval_id = eval_id,
            );

            // Execute in webview
            if let Err(e) = window.eval(&js) {
                state.cleanup_eval(&eval_id);
                let resp_body = format!(
                    r#"{{"success":false,"error":"Failed to eval in webview: {}"}}"#,
                    e.to_string().replace('"', "\\\"")
                );
                respond_json(request, 500, &resp_body);
                return;
            }

            // Wait for result (timeout 30s)
            let timeout = Duration::from_secs(30);
            let start = Instant::now();
            let resp_body = loop {
                {
                    let r = result_handle.lock().unwrap();
                    if r.ready {
                        break r.value.clone().unwrap_or_else(|| {
                            r#"{"success":true,"result":null}"#.to_string()
                        });
                    }
                }
                if start.elapsed() > timeout {
                    break r#"{"success":false,"error":"Eval timed out after 30s"}"#.to_string();
                }
                std::thread::sleep(Duration::from_millis(10));
            };

            state.cleanup_eval(&eval_id);
            respond_json(request, 200, &resp_body);
        }

        _ => {
            respond_json(request, 404,
                r#"{"error":"Not found","endpoints":["/health","/info","/eval"]}"#);
        }
    }
}
