//! Full wry 0.45 integration with winit 0.30: main window + webview subwindow
//! + IPC round-trip via UserEvent pattern (no UB threading hacks).

use serde::{Deserialize, Serialize};
use std::sync::Arc;
use std::time::{Duration, Instant};
use winit::application::ApplicationHandler;
use winit::event::WindowEvent;
use winit::event_loop::{ActiveEventLoop, EventLoop, EventLoopProxy};
use winit::window::{Window, WindowId};
use wry::WebViewBuilder;

// ── IPC Messages ─────────────────────────────────────────────────────────

#[derive(Deserialize, Debug)]
#[serde(tag = "type")]
enum InboundMsg {
    #[serde(rename = "getShapes")]
    GetShapes { #[serde(rename = "requestId")] request_id: String },
    #[serde(rename = "ping")]
    Ping { #[serde(rename = "requestId")] request_id: String, i: u32 },
}

#[derive(Serialize)]
struct Shape { id: String, #[serde(rename = "type")] kind: String }

fn handle_message(msg: &str) -> Option<String> {
    let parsed: InboundMsg = serde_json::from_str(msg).ok()?;
    match parsed {
        InboundMsg::GetShapes { request_id } => Some(serde_json::json!({
            "type": "shapesResult",
            "requestId": request_id,
            "shapes": [
                Shape { id: "s1".into(), kind: "line".into() },
                Shape { id: "s2".into(), kind: "rect".into() },
            ],
        }).to_string()),
        InboundMsg::Ping { request_id, i } => Some(serde_json::json!({
            "type": "pong",
            "requestId": request_id,
            "i": i,
        }).to_string()),
    }
}

// ── Custom events fed via EventLoopProxy ─────────────────────────────────

#[derive(Debug)]
enum AppEvent {
    WebViewMessage(String),
}

// ── Minimal HTML (React via CDN, self-contained) ─────────────────────────

const HTML: &str = r##"<!doctype html>
<html><head><meta charset="utf-8"><title>IPC</title>
<style>
body { margin:0; padding:20px; font-family:system-ui; background:#1e293b; color:#f1f5f9; }
h1 { font-size:16px; margin:0 0 8px; }
.metric { background:#0f172a; padding:10px; border-radius:6px; margin:8px 0;
          font-family:monospace; font-size:13px; }
.ok { color:#4ade80; } .fail { color:#f87171; }
button { background:#3b82f6; color:white; border:0; padding:8px 14px;
         border-radius:5px; cursor:pointer; font-size:13px; margin-right:6px; }
pre { background:#0f172a; padding:10px; border-radius:6px; font-size:11px;
      max-height:200px; overflow:auto; }
</style></head>
<body><div id="root"></div>
<script crossorigin src="https://unpkg.com/react@18/umd/react.production.min.js"></script>
<script crossorigin src="https://unpkg.com/react-dom@18/umd/react-dom.production.min.js"></script>
<script>
const { useState } = React;
const pending = new Map();
window.__onRustMessage = (s) => {
  const m = JSON.parse(s);
  const r = pending.get(m.requestId);
  if (r) { pending.delete(m.requestId); r(m); }
};
function rpc(type, body) {
  const id = (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2));
  const t0 = performance.now();
  const p = new Promise(r => pending.set(id, r));
  window.ipc.postMessage(JSON.stringify({ type, requestId: id, ...body }));
  return p.then(resp => ({ resp, dt: performance.now() - t0 }));
}
function App() {
  const [status, setStatus] = useState("ready");
  const [shapes, setShapes] = useState([]);
  const [latencies, setLatencies] = useState([]);
  const fetchShapes = async () => {
    setStatus("fetch...");
    const { resp, dt } = await rpc("getShapes", {});
    setShapes(resp.shapes || []);
    setLatencies(p => [...p.slice(-99), dt]);
    setStatus("done in " + dt.toFixed(2) + " ms");
  };
  const bench = async () => {
    setStatus("bench 100x...");
    const results = [];
    for (let i = 0; i < 100; i++) {
      const { dt } = await rpc("ping", { i });
      results.push(dt);
    }
    setLatencies(results);
    const mean = results.reduce((a,b) => a+b, 0) / results.length;
    const sorted = [...results].sort((a,b) => a-b);
    const p99 = sorted[Math.floor(sorted.length * 0.99)];
    const min = sorted[0], max = sorted[sorted.length - 1];
    setStatus("mean=" + mean.toFixed(2) + " p99=" + p99.toFixed(2)
              + " min=" + min.toFixed(2) + " max=" + max.toFixed(2) + " ms");
  };
  const mean = latencies.length ? (latencies.reduce((a,b) => a+b, 0) / latencies.length) : 0;
  const cls = mean && mean < 50 ? "ok" : (mean ? "fail" : "");
  return React.createElement("div", null,
    React.createElement("h1", null, "wry IPC spike"),
    React.createElement("div", {className: "metric " + cls},
      "Mean latency: " + mean.toFixed(2) + " ms (target <50)"),
    React.createElement("div", {className: "metric"}, "Status: " + status),
    React.createElement("button", {onClick: fetchShapes}, "Fetch shapes"),
    React.createElement("button", {onClick: bench}, "Benchmark 100x"),
    React.createElement("pre", null, JSON.stringify(shapes, null, 2))
  );
}
ReactDOM.createRoot(document.getElementById("root")).render(React.createElement(App));
</script>
</body></html>
"##;

// ── App ──────────────────────────────────────────────────────────────────

struct App {
    main_window: Option<Arc<Window>>,
    dialog_window: Option<Arc<Window>>,
    webview: Option<wry::WebView>,
    proxy: EventLoopProxy<AppEvent>,
}

impl App {
    fn new(proxy: EventLoopProxy<AppEvent>) -> Self {
        Self { main_window: None, dialog_window: None, webview: None, proxy }
    }
}

impl ApplicationHandler<AppEvent> for App {
    fn resumed(&mut self, event_loop: &ActiveEventLoop) {
        let main = Arc::new(event_loop.create_window(
            Window::default_attributes()
                .with_title("Spike 05 — Main window (native)")
                .with_inner_size(winit::dpi::LogicalSize::new(800, 600)),
        ).unwrap());
        self.main_window = Some(main);

        let dialog = Arc::new(event_loop.create_window(
            Window::default_attributes()
                .with_title("IPC Dialog (webview)")
                .with_inner_size(winit::dpi::LogicalSize::new(640, 520)),
        ).unwrap());

        let proxy_clone = self.proxy.clone();
        // wry 0.45: WebViewBuilder::new(&window).with_*().build()
        // NOT .build(&window) — that was the reviewer's API shape.
        let webview = WebViewBuilder::new(&*dialog)
            .with_html(HTML)
            .with_ipc_handler(move |req| {
                let body = req.body().to_string();
                let _ = proxy_clone.send_event(AppEvent::WebViewMessage(body));
            })
            .build()
            .expect("webview build");

        self.dialog_window = Some(dialog);
        self.webview = Some(webview);
    }

    fn user_event(&mut self, _event_loop: &ActiveEventLoop, event: AppEvent) {
        match event {
            AppEvent::WebViewMessage(body) => {
                let t0 = Instant::now();
                if let Some(resp) = handle_message(&body) {
                    let elapsed = t0.elapsed();
                    // Escape for JS string literal
                    let escaped = resp.replace('\\', "\\\\").replace('\'', "\\'");
                    let js = format!("window.__onRustMessage('{}')", escaped);
                    if let Some(wv) = self.webview.as_ref() {
                        let _ = wv.evaluate_script(&js);
                    }
                    if elapsed > Duration::from_millis(5) {
                        eprintln!("[ipc] handler took {:?}", elapsed);
                    }
                }
            }
        }
    }

    fn window_event(&mut self, event_loop: &ActiveEventLoop, _id: WindowId, event: WindowEvent) {
        if matches!(event, WindowEvent::CloseRequested) {
            event_loop.exit();
        }
    }
}

fn main() -> anyhow::Result<()> {
    if std::env::args().nth(1).as_deref() == Some("--headless") {
        // Probe path: just routing
        let req = r#"{"type":"ping","requestId":"abc","i":42}"#;
        let resp = handle_message(req).unwrap();
        println!("ping response: {}", resp);
        let req = r#"{"type":"getShapes","requestId":"xyz"}"#;
        let resp = handle_message(req).unwrap();
        println!("getShapes response: {}", resp);
        println!("wry API probe: serde routing works");
        return Ok(());
    }
    let event_loop = EventLoop::<AppEvent>::with_user_event().build()?;
    let proxy = event_loop.create_proxy();
    let mut app = App::new(proxy);
    event_loop.run_app(&mut app)?;
    Ok(())
}
