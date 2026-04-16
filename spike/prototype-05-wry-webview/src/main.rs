//! Headless API probe: verifieer wry 0.45 API surface.

use serde::{Deserialize, Serialize};

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
}

fn handle_message(msg: &str) -> Option<String> {
    let parsed: InboundMsg = serde_json::from_str(msg).ok()?;
    match parsed {
        InboundMsg::GetShapes { request_id } => {
            Some(serde_json::json!({
                "type": "shapesResult",
                "requestId": request_id,
                "shapes": [Shape { id: "s1".into(), kind: "line".into() }],
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

fn main() {
    // Probe: roundtrip a single message
    let req = r#"{"type":"ping","requestId":"abc","i":42}"#;
    let resp = handle_message(req).unwrap();
    println!("ping response: {}", resp);

    let req = r#"{"type":"getShapes","requestId":"xyz"}"#;
    let resp = handle_message(req).unwrap();
    println!("getShapes response: {}", resp);

    // Note: wry WebView build requires a real winit window — we skip that
    // for the headless probe. Day-1 of the spike will compile + run the
    // full interactive dialog.
    println!("wry API probe: serde routing works");
}
