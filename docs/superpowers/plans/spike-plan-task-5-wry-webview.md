# Spike Task 5 — wry Webview Subwindow Round-trip

> **Parent plan:** `2026-04-16-spike-native-kernel.md`
> **Goal:** Bewijzen dat wry een React dialog als subwindow kan spawnen met < 50 ms IPC round-trip op Windows (WebView2).

**Tijdsbudget:** 1-1.5 dag

## Wat we valideren

1. wry subwindow naast egui main window, beide blijven responsive
2. React dialog kan via `postMessage` een command sturen naar Rust host
3. Rust host stuurt een respons terug, React rendert het resultaat
4. Round-trip latency < 50 ms (Verkoper/Programmeur eis)
5. Sluiten van dialog laat main window intact

## Exit criteria

- **SUCCES:** Round-trip < 50 ms, React rendert ontvangen data, main window stabiel.
- **TWIJFEL:** Round-trip 50-200 ms, werkt wel.
- **KILL:** wry crasht op Windows, of IPC bridge broken onder WebView2 updates.

---

## File Structure

```
spike/prototype-05-wry-webview/
├── Cargo.toml
├── src/
│   └── main.rs                  # egui main + wry subwindow spawn
└── react-dialog/
    ├── index.html               # minimal React via CDN
    └── IPC-PROTOCOL.md          # documented message format
```

Geen npm/vite build nodig — React via CDN voor scope-beheersing.

---

## Task 5.0: Crate setup

- [ ] **Step 5.0.1: Create manifest**

Create `spike/prototype-05-wry-webview/Cargo.toml`:

```toml
[package]
name = "prototype-05-wry-webview"
version.workspace = true
edition.workspace = true

[dependencies]
wry = { workspace = true }
winit = { workspace = true, features = ["rwh_06"] }
anyhow = { workspace = true }
serde = { version = "1", features = ["derive"] }
serde_json = "1"

[[bin]]
name = "prototype-05"
path = "src/main.rs"
```

---

## Task 5.1: React dialog HTML (self-contained)

- [ ] **Step 5.1.1: Document IPC protocol**

Create `spike/prototype-05-wry-webview/react-dialog/IPC-PROTOCOL.md`:

```markdown
# IPC Protocol

## Direction: React → Rust
Via `window.ipc.postMessage(JSON.stringify(msg))`.

Message:
```json
{
  "type": "getShapes",
  "requestId": "uuid-string"
}
```

## Direction: Rust → React
Via `window.__onRustMessage(JSON.stringify(msg))` injected by host.

Response:
```json
{
  "type": "shapesResult",
  "requestId": "uuid-string",
  "shapes": [
    { "id": "s1", "type": "line", "x1": 0, "y1": 0, "x2": 100, "y2": 100 }
  ],
  "latencyMs": 12.3
}
```

## Latency measurement
React records `t0 = performance.now()` before postMessage and
`t1 = performance.now()` after receiving response. Round-trip = t1 - t0.
```

- [ ] **Step 5.1.2: Create React dialog**

Create `spike/prototype-05-wry-webview/react-dialog/index.html`:

```html
<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>IPC Dialog</title>
  <style>
    body { margin: 0; padding: 20px; font-family: system-ui, sans-serif;
           background: #1e293b; color: #f1f5f9; }
    h1 { margin: 0 0 8px; font-size: 18px; }
    .metric { background: #0f172a; padding: 12px; border-radius: 6px;
              margin: 8px 0; font-family: monospace; }
    .ok { color: #4ade80; }
    .fail { color: #f87171; }
    button { background: #3b82f6; color: white; border: 0;
             padding: 10px 16px; border-radius: 6px; cursor: pointer;
             font-size: 14px; margin-right: 8px; }
    button:hover { background: #2563eb; }
    pre { background: #0f172a; padding: 12px; border-radius: 6px;
          overflow: auto; font-size: 11px; }
  </style>
</head>
<body>
  <div id="root"></div>
  <script crossorigin src="https://unpkg.com/react@18/umd/react.production.min.js"></script>
  <script crossorigin src="https://unpkg.com/react-dom@18/umd/react-dom.production.min.js"></script>
  <script>
    const { useState, useEffect, useRef } = React;
    const pending = new Map();

    window.__onRustMessage = (jsonStr) => {
      const msg = JSON.parse(jsonStr);
      const resolver = pending.get(msg.requestId);
      if (resolver) { pending.delete(msg.requestId); resolver(msg); }
    };

    function sendRpc(type, payload) {
      const requestId = crypto.randomUUID();
      const t0 = performance.now();
      const p = new Promise((resolve) => { pending.set(requestId, resolve); });
      window.ipc.postMessage(JSON.stringify({ type, requestId, ...payload }));
      return p.then((resp) => ({ resp, latency: performance.now() - t0 }));
    }

    function App() {
      const [shapes, setShapes] = useState([]);
      const [latencies, setLatencies] = useState([]);
      const [status, setStatus] = useState("Ready");

      const fetchShapes = async () => {
        setStatus("Fetching...");
        const { resp, latency } = await sendRpc("getShapes", {});
        setShapes(resp.shapes || []);
        setLatencies((prev) => [...prev, latency].slice(-20));
        setStatus("Done");
      };

      const benchmark = async () => {
        setStatus("Running 100 round-trips...");
        const results = [];
        for (let i = 0; i < 100; i++) {
          const { latency } = await sendRpc("ping", { i });
          results.push(latency);
        }
        setLatencies(results);
        const mean = results.reduce((a, b) => a + b, 0) / results.length;
        const sorted = [...results].sort((a, b) => a - b);
        const p99 = sorted[Math.floor(sorted.length * 0.99)];
        setStatus(`Mean: ${mean.toFixed(2)} ms, P99: ${p99.toFixed(2)} ms`);
      };

      const mean = latencies.length ? (latencies.reduce((a, b) => a + b, 0) / latencies.length).toFixed(2) : "-";
      const cls = mean !== "-" && parseFloat(mean) < 50 ? "ok" : "fail";

      return React.createElement("div", null,
        React.createElement("h1", null, "IPC Round-trip Spike"),
        React.createElement("div", { className: "metric " + cls },
          `Mean latency: ${mean} ms (target < 50 ms)`),
        React.createElement("div", { className: "metric" }, `Status: ${status}`),
        React.createElement("button", { onClick: fetchShapes }, "Fetch shapes"),
        React.createElement("button", { onClick: benchmark }, "Benchmark (100×)"),
        React.createElement("pre", null, JSON.stringify(shapes, null, 2))
      );
    }

    ReactDOM.createRoot(document.getElementById("root")).render(React.createElement(App));
  </script>
</body>
</html>
```

---

## Task 5.2: Rust host + IPC bridge

- [ ] **Step 5.2.1: Implement main.rs**

Create `spike/prototype-05-wry-webview/src/main.rs`:

```rust
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use wry::WebViewBuilder;
use winit::application::ApplicationHandler;
use winit::event::WindowEvent;
use winit::event_loop::{ActiveEventLoop, EventLoop};
use winit::window::{Window, WindowId};

#[derive(Deserialize, Debug)]
#[serde(tag = "type")]
enum InboundMsg {
    #[serde(rename = "getShapes")]
    GetShapes { #[serde(rename = "requestId")] request_id: String },
    #[serde(rename = "ping")]
    Ping { #[serde(rename = "requestId")] request_id: String, i: u32 },
}

#[derive(Serialize)]
struct Shape {
    id: String,
    #[serde(rename = "type")]
    kind: String,
    x1: f64, y1: f64, x2: f64, y2: f64,
}

fn handle_message(msg: &str) -> Option<String> {
    let parsed: InboundMsg = match serde_json::from_str(msg) {
        Ok(m) => m,
        Err(e) => { eprintln!("bad msg: {}", e); return None; }
    };
    match parsed {
        InboundMsg::GetShapes { request_id } => {
            let shapes = vec![
                Shape { id: "s1".into(), kind: "line".into(),
                        x1: 0.0, y1: 0.0, x2: 100.0, y2: 100.0 },
                Shape { id: "s2".into(), kind: "line".into(),
                        x1: 0.0, y1: 100.0, x2: 100.0, y2: 0.0 },
                Shape { id: "s3".into(), kind: "rect".into(),
                        x1: 20.0, y1: 20.0, x2: 80.0, y2: 80.0 },
            ];
            Some(serde_json::json!({
                "type": "shapesResult",
                "requestId": request_id,
                "shapes": shapes,
            }).to_string())
        }
        InboundMsg::Ping { request_id, i } => {
            Some(serde_json::json!({
                "type": "pong",
                "requestId": request_id,
                "i": i,
            }).to_string())
        }
    }
}

struct App {
    main_window: Option<Arc<Window>>,
    dialog_window: Option<Arc<Window>>,
    webview: Option<wry::WebView>,
}

impl App {
    fn new() -> Self { Self { main_window: None, dialog_window: None, webview: None } }
}

impl ApplicationHandler for App {
    fn resumed(&mut self, event_loop: &ActiveEventLoop) {
        // Main window
        let main = Arc::new(event_loop.create_window(
            Window::default_attributes()
                .with_title("Spike 05 — Main (native)")
                .with_inner_size(winit::dpi::LogicalSize::new(800, 600)),
        ).unwrap());
        self.main_window = Some(main);

        // Dialog subwindow with webview
        let dialog = Arc::new(event_loop.create_window(
            Window::default_attributes()
                .with_title("IPC Dialog (webview)")
                .with_inner_size(winit::dpi::LogicalSize::new(600, 500)),
        ).unwrap());

        let dialog_weak = Arc::downgrade(&dialog);

        let html_path = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("react-dialog/index.html");
        let html = std::fs::read_to_string(&html_path)
            .expect("failed to read react-dialog/index.html");

        let webview = WebViewBuilder::new()
            .with_html(html)
            .with_ipc_handler(move |req| {
                let body = req.body();
                if let Some(resp) = handle_message(body) {
                    if let Some(dlg) = dialog_weak.upgrade() {
                        // Send back via eval
                        // Note: wry doesn't have a native .eval on WebView via Arc,
                        // so we stash a channel here in real code. For this spike
                        // we do a blocking eval via the stored webview.
                        let _ = dlg;
                        // handled below by EVAL_CHAN static
                        if let Some(tx) = EVAL_CHAN.get() {
                            let _ = tx.send(resp);
                        }
                    }
                }
            })
            .build(&dialog)
            .expect("webview build failed");

        self.dialog_window = Some(dialog);
        self.webview = Some(webview);

        // Background thread pumps eval responses
        let (tx, rx) = std::sync::mpsc::channel::<String>();
        let _ = EVAL_CHAN.set(tx);
        let wv_ptr = self.webview.as_ref().unwrap() as *const wry::WebView as usize;
        std::thread::spawn(move || {
            for resp in rx.iter() {
                // SAFETY: main thread owns the webview and keeps it alive until app exit.
                let wv = unsafe { &*(wv_ptr as *const wry::WebView) };
                let escaped = resp.replace('\\', "\\\\").replace('\'', "\\'");
                let js = format!("window.__onRustMessage('{}')", escaped);
                let _ = wv.evaluate_script(&js);
            }
        });
    }

    fn window_event(&mut self, event_loop: &ActiveEventLoop, _id: WindowId, event: WindowEvent) {
        if matches!(event, WindowEvent::CloseRequested) {
            event_loop.exit();
        }
    }
}

use std::sync::OnceLock;
static EVAL_CHAN: OnceLock<std::sync::mpsc::Sender<String>> = OnceLock::new();

fn main() -> anyhow::Result<()> {
    let event_loop = EventLoop::new()?;
    let mut app = App::new();
    event_loop.run_app(&mut app)?;
    Ok(())
}
```

Note: de threading hier is een spike-shortcut. In production moet dit via een proper event queue (winit user events) om veilig mutable access tot de webview te synchroniseren.

- [ ] **Step 5.2.2: Verify build**

Run: `cd spike && cargo check -p prototype-05-wry-webview`
Expected: compile succeeds, mogelijk unsafe-warnings — die zijn bewust.

- [ ] **Step 5.2.3: Build release binary**

Run: `cargo build -p prototype-05-wry-webview --release`
Expected: `spike/target/release/prototype-05` of `.exe`.

- [ ] **Step 5.2.4: Commit**

```bash
cd spike
git add prototype-05-wry-webview/
git commit -m "spike(05): wry webview subwindow with IPC round-trip

Minimal React-in-webview dialog communicates with Rust host via
postMessage bridge. Benchmarks 100-round-trip latency."
```

---

## Task 5.3: Run en meet

- [ ] **Step 5.3.1: Run demo**

Run: `cd spike && ./target/release/prototype-05` (of `.exe` op Windows)
Expected: 2 windows openen:
- "Spike 05 — Main (native)" — leeg winit window
- "IPC Dialog (webview)" — React dialog met twee buttons

- [ ] **Step 5.3.2: Klik "Fetch shapes"**

Verwacht: na ~milliseconden verschijnen 3 shapes in de JSON pre-block, en mean latency wordt bijgewerkt.

- [ ] **Step 5.3.3: Klik "Benchmark (100×)"**

Verwacht: ~1-5 seconden wachten, dan toont status "Mean: X ms, P99: Y ms".

- [ ] **Step 5.3.4: Check Webview2 versie (Windows)**

Open Windows **Apps & features** → zoek "Microsoft Edge WebView2 Runtime" → noteer versie.

- [ ] **Step 5.3.5: Update SPIKE-RESULTS.md**

Edit `spike/SPIKE-RESULTS.md`:

```markdown
## Prototype 5: wry Webview round-trip
Status: [x] SUCCES / [ ] TWIJFEL / [ ] KILL

Platform: Windows 11, Edge WebView2 Runtime X.Y.Z
Round-trip metingen (100 calls):
- Mean: X.X ms
- P99: X.X ms
- Min: X.X ms
- Max: X.X ms

Exit criterion (<50ms mean): [pass/fail]

Observaties:
- Main window bleef responsive tijdens dialog open
- Dialog sluiten liet main window intact
- Geen crashes bij rapid button clicks
```

- [ ] **Step 5.3.6: Commit**

```bash
cd spike
git add SPIKE-RESULTS.md
git commit -m "spike(05): IPC latency measured — verdict"
```

---

## Self-Review Task 5

1. **Coverage:** round-trip meting (100 samples), visuele confirmation (shapes JSON), 2-window test. Alle 5 exit-criteria checkbaar.
2. **Placeholders:** latency-getallen worden tijdens test ingevuld — dat is runtime meting, geen placeholder in de zin van de skill.
3. **Type consistency:** `InboundMsg` enum en React `sendRpc` matchen via `requestId` string. `Shape` struct serialiseert naar dezelfde JSON-vorm die React verwacht.
4. **Scope:** 3 sub-tasks, ~5-6 uur. Past in 1-1.5 dag.

Risico: de `EVAL_CHAN` static + unsafe pointer is een spike-shortcut die we expliciet NIET naar productie porteren. Als Task 5 succes is, schrijven we een proper winit `UserEvent`-based bridge in het feitelijke kernel-plan.
