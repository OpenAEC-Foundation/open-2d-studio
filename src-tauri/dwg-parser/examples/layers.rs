//! Diagnostic: list LAYER table objects (type 0x33) and their parsed names.
//!
//! Usage: cargo run --release --example layers -- <path.dwg> [more.dwg ...]

use dwg_parser::DwgParser;

fn main() {
    let mut args: Vec<String> = std::env::args().skip(1).collect();
    if args.is_empty() {
        eprintln!("usage: layers <path.dwg> [more.dwg ...]");
        std::process::exit(2);
    }
    args.sort();

    for path in &args {
        let bytes = match std::fs::read(path) {
            Ok(b) => b,
            Err(e) => { eprintln!("[{}] read error: {}", path, e); continue; }
        };
        let mut parser = DwgParser::new();
        let file = match parser.parse(&bytes) {
            Ok(f) => f,
            Err(e) => { eprintln!("[{}] parse error: {:?}", path, e); continue; }
        };

        let mut layers: Vec<(u32, String, Option<i32>)> = Vec::new();
        let mut layer_handles_used: std::collections::HashSet<u32> = std::collections::HashSet::new();
        let mut entity_count = 0usize;
        let mut entity_with_layer = 0usize;

        for o in &file.objects {
            if o.type_name == "LAYER" {
                let name = o.data.get("name")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string();
                let color = o.data.get("color").and_then(|v| v.as_i64()).map(|n| n as i32);
                layers.push((o.handle, name, color));
            }
            if o.is_entity {
                entity_count += 1;
                if let Some(lh) = o.handle_refs.layer {
                    layer_handles_used.insert(lh);
                    entity_with_layer += 1;
                }
            }
        }

        let n_named = layers.iter().filter(|(_, n, _)| !n.is_empty()).count();
        println!("\n========== {} ==========", path);
        println!("version={}, total_objects={}, entities={}, with_layer_ref={}",
                 file.version, file.objects.len(), entity_count, entity_with_layer);
        println!("LAYER count={}, named={}", layers.len(), n_named);
        for (i, (h, name, color)) in layers.iter().enumerate().take(20) {
            let used = if layer_handles_used.contains(h) { "USED" } else { "    " };
            let display = if name.is_empty() { "<EMPTY>" } else { name.as_str() };
            println!("  [{:02}] {} handle=0x{:X}  color={:?}  name={:?}",
                     i, used, h, color, display);
        }
        if layers.len() > 20 {
            println!("  ... {} more layers", layers.len() - 20);
        }

        // Show how many distinct layer-handles entities reference but the LAYER
        // table didn't supply (orphan refs).
        let layer_handle_set: std::collections::HashSet<u32> =
            layers.iter().map(|(h, _, _)| *h).collect();
        let orphan: Vec<u32> = layer_handles_used.difference(&layer_handle_set).copied().collect();
        if !orphan.is_empty() {
            println!("ORPHAN entity layer handles (no LAYER table object): {}",
                     orphan.iter().take(10).map(|h| format!("0x{:X}", h)).collect::<Vec<_>>().join(", "));
        }
    }
}
