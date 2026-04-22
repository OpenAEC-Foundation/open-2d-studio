//! dwg_mockup — CLI tool for iterating on the clean-room DWG parser.
//!
//! Unlike dxf_mockup (full GPU viewer), this binary just parses a DWG
//! and prints a diagnostic summary: version, object count, entity
//! breakdown, bbox of decoded entities. Perfect for rapid iteration on
//! the parser internals without GPU/window overhead.
//!
//! Usage: dwg_mockup <path.dwg> [path2.dwg ...]
//! If no path given, runs on a bundled set of test pairs.

use dwg_parser::DwgParser;
use std::collections::HashMap;

fn main() -> anyhow::Result<()> {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let paths: Vec<String> = if args.is_empty() {
        // Default: try the sample pairs in C:\Users\rickd\Desktop\dwg_samples
        let samples = [
            r"C:\Users\rickd\Desktop\dwg_samples\circle_2010.dwg",
            r"C:\Users\rickd\Desktop\dwg_samples\line_2010.dwg",
            r"C:\Users\rickd\Desktop\dwg_samples\arc_2010.dwg",
            r"C:\Users\rickd\Desktop\pair.dwg",
            r"C:\Users\rickd\Desktop\test65.dwg",
        ];
        samples.iter().filter(|p| std::path::Path::new(p).exists()).map(|s| s.to_string()).collect()
    } else {
        args
    };

    if paths.is_empty() {
        eprintln!("No .dwg files to process. Pass a path or place samples in ~/Desktop/dwg_samples/");
        return Ok(());
    }

    for path in &paths {
        println!("===== {} =====", path);
        match process_dwg(path) {
            Ok(()) => {},
            Err(e) => println!("  ERROR: {:?}", e),
        }
        println!();
    }
    Ok(())
}

fn process_dwg(path: &str) -> anyhow::Result<()> {
    let t0 = std::time::Instant::now();
    let bytes = std::fs::read(path)?;
    let mut parser = DwgParser::new();
    let file = parser.parse(&bytes)
        .map_err(|e| anyhow::anyhow!("parse failed: {:?}", e))?;

    println!("  version:      {}", file.version);
    println!("  version_code: {}", file.version_code);
    println!("  objects:      {}", file.objects.len());
    println!("  object_map:   {} entries", file.object_map.len());
    println!("  classes:      {}", file.classes.len());
    println!("  parse time:   {:.2}s", t0.elapsed().as_secs_f32());

    // Group by type_name
    let mut by_type: HashMap<String, usize> = HashMap::new();
    for obj in &file.objects {
        *by_type.entry(obj.type_name.clone()).or_insert(0) += 1;
    }
    let mut types: Vec<(&String, &usize)> = by_type.iter().collect();
    types.sort_by(|a, b| b.1.cmp(a.1));
    println!("  types:");
    for (t, n) in types.iter() {
        println!("    {:>4}  {}", n, t);
    }

    // Bbox of LINE/CIRCLE/ARC coordinates we can see directly
    let mut bbox = [f64::INFINITY, f64::INFINITY, f64::NEG_INFINITY, f64::NEG_INFINITY];
    let mut nearby = 0u32; // entities with sane coords
    let mut wild = 0u32;   // entities with garbage coords
    for obj in &file.objects {
        if !obj.is_entity { continue; }
        let mut coords: Vec<f64> = Vec::new();
        let push_xyz = |c: &mut Vec<f64>, v: &serde_json::Value| {
            if let Some(arr) = v.as_array() {
                for x in arr.iter().take(2) {
                    if let Some(f) = x.as_f64() { c.push(f); }
                }
            }
        };
        if let Some(v) = obj.data.get("start") { push_xyz(&mut coords, v); }
        if let Some(v) = obj.data.get("end") { push_xyz(&mut coords, v); }
        if let Some(v) = obj.data.get("center") { push_xyz(&mut coords, v); }
        if let Some(v) = obj.data.get("position") { push_xyz(&mut coords, v); }
        if let Some(v) = obj.data.get("insertionPoint") { push_xyz(&mut coords, v); }
        if let Some(v) = obj.data.get("point1") { push_xyz(&mut coords, v); }
        if let Some(v) = obj.data.get("definitionPoint") { push_xyz(&mut coords, v); }
        // Collect vertex / fit point / control point arrays
        let extract_pts = |arr: &serde_json::Value, out: &mut Vec<f64>| {
            if let Some(a) = arr.as_array() {
                for item in a {
                    if let Some(x) = item.get("x").and_then(|v| v.as_f64()) {
                        if let Some(y) = item.get("y").and_then(|v| v.as_f64()) {
                            out.push(x); out.push(y);
                        }
                    } else if let Some(pt) = item.get("point") {
                        if let Some(arr2) = pt.as_array() {
                            for x in arr2.iter().take(2) {
                                if let Some(f) = x.as_f64() { out.push(f); }
                            }
                        }
                    } else if let Some(arr2) = item.as_array() {
                        for x in arr2.iter().take(2) {
                            if let Some(f) = x.as_f64() { out.push(f); }
                        }
                    }
                }
            }
        };
        if let Some(v) = obj.data.get("vertices") { extract_pts(v, &mut coords); }
        if let Some(v) = obj.data.get("fitPoints") { extract_pts(v, &mut coords); }
        if let Some(v) = obj.data.get("controlPoints") { extract_pts(v, &mut coords); }
        // Any sane coord is |c| < 1e7
        let any_sane = coords.iter().any(|c| c.is_finite() && c.abs() < 1.0e7);
        let any_wild = coords.iter().any(|c| !c.is_finite() || c.abs() >= 1.0e5);
        if any_sane { nearby += 1; }
        if any_wild {
            wild += 1;
            let worst = coords.iter().cloned().filter(|c| c.is_finite()).fold(0.0f64, |m, c| m.max(c.abs()));
            let n_pts = coords.len() / 2;
            println!(
                "  WILD h=0x{:X} type={} worst_coord={:.1} n_pts={}",
                obj.handle, obj.type_name, worst, n_pts
            );
        }
        for c in coords.chunks(2) {
            if c.len() == 2 && c[0].is_finite() && c[1].is_finite()
                && c[0].abs() < 1.0e7 && c[1].abs() < 1.0e7
            {
                bbox[0] = bbox[0].min(c[0]);
                bbox[1] = bbox[1].min(c[1]);
                bbox[2] = bbox[2].max(c[0]);
                bbox[3] = bbox[3].max(c[1]);
            }
        }
    }
    println!("  entities with sane coords: {}", nearby);
    println!("  entities with wild coords: {}", wild);
    if bbox[0].is_finite() {
        println!("  decoded bbox: [{:.2}, {:.2}] to [{:.2}, {:.2}]",
            bbox[0], bbox[1], bbox[2], bbox[3]);
    } else {
        println!("  decoded bbox: (none — no entity had decodable 2D coords)");
    }

    // Polyline vertex linking diagnostics
    let is_poly = |t: &str| matches!(t,
        "POLYLINE_2D" | "POLYLINE_3D" | "POLYLINE_PFACE" | "POLYLINE_MESH");
    let is_vert = |t: &str| matches!(t,
        "VERTEX_2D" | "VERTEX_3D" | "VERTEX_MESH" | "VERTEX_PFACE" | "VERTEX_PFACE_FACE");
    let poly_count = file.objects.iter()
        .filter(|o| is_poly(&o.type_name))
        .count();
    let vertex_count = file.objects.iter()
        .filter(|o| is_vert(&o.type_name))
        .count();
    let linked = file.objects.iter()
        .filter(|o| is_poly(&o.type_name)
                && o.data.get("vertices").and_then(|v| v.as_array()).map_or(false, |a| !a.is_empty()))
        .count();
    let total_linked_verts: usize = file.objects.iter()
        .filter(|o| is_poly(&o.type_name))
        .filter_map(|o| o.data.get("vertices").and_then(|v| v.as_array()).map(|a| a.len()))
        .sum();
    // Show standalone vertex details
    for obj in file.objects.iter()
        .filter(|o| o.type_name == "VERTEX_2D" || o.type_name == "VERTEX_3D")
        .take(5)
    {
        println!("  VERTEX handle={} owner={:?} pos={:?}",
            obj.handle,
            obj.handle_refs.owner,
            obj.data.get("position"));
    }
    // Also dump PFACE/MESH family for polyface-mesh diagnostics.
    for obj in file.objects.iter()
        .filter(|o| o.type_name == "POLYLINE_PFACE" || o.type_name == "POLYLINE_MESH"
            || o.type_name == "VERTEX_MESH" || o.type_name == "VERTEX_PFACE"
            || o.type_name == "VERTEX_PFACE_FACE")
    {
        println!("  PFACE_FAMILY type={} handle=0x{:X} owner={:?} owned_handles={:?} first={:?} last={:?} seqend={:?}",
            obj.type_name, obj.handle, obj.handle_refs.owner,
            &obj.handle_refs.owned_handles[..obj.handle_refs.owned_handles.len().min(12)],
            obj.handle_refs.first_entity,
            obj.handle_refs.last_entity,
            obj.handle_refs.seqend);
    }
    // Directly inspect handles 0x4E4..0x4EE for example_2010.dwg
    for h in 0x4E4u32..=0x4EEu32 {
        let in_map = file.object_map.contains_key(&h);
        let obj = file.objects.iter().find(|o| o.handle == h);
        let parsed = obj.map(|o| o.type_name.as_str()).unwrap_or("<not parsed>");
        let owner = obj.and_then(|o| o.handle_refs.owner);
        println!("  handle 0x{:X}: obj_map={} parsed_type={} owner={:?}", h, in_map, parsed, owner);
    }
    if poly_count > 0 || vertex_count > 0 {
        println!("  polylines: {} ({} linked, {} vertices attached, {} standalone VERTEX objects)",
            poly_count, linked, total_linked_verts, vertex_count);
        // Show first 3 polyline handles and their owned_handles for debugging
        for obj in file.objects.iter()
            .filter(|o| o.type_name == "POLYLINE_2D")
            .take(3)
        {
            let owned = &obj.handle_refs.owned_handles;
            let first = obj.handle_refs.first_entity;
            let last = obj.handle_refs.last_entity;
            let seq = obj.handle_refs.seqend;
            println!("  POLYLINE_2D handle={} owned_handles={:?} first={:?} last={:?} seqend={:?}",
                obj.handle, &owned[..owned.len().min(6)], first, last, seq);
            // Check if owned handles exist in parsed objects
            let parsed_handles: std::collections::HashSet<u32> =
                file.objects.iter().map(|o| o.handle).collect();
            let in_objmap: Vec<bool> = owned.iter().take(6)
                .map(|h| file.object_map.contains_key(h))
                .collect();
            let in_parsed: Vec<bool> = owned.iter().take(6)
                .map(|h| parsed_handles.contains(h))
                .collect();
            println!("    in object_map: {:?}  in parsed: {:?}", in_objmap, in_parsed);
            // Check sequential handles after polyline
            let mut seq_in_map = Vec::new();
            for d in 1..=10u32 {
                let h = obj.handle.wrapping_add(d);
                if file.object_map.contains_key(&h) {
                    seq_in_map.push(format!("+{}=0x{:X}@{}", d, h,
                        file.object_map.get(&h).unwrap()));
                }
            }
            if seq_in_map.is_empty() {
                println!("    no sequential handles +1..+10 in object_map");
            } else {
                println!("    sequential in map: {}", seq_in_map.join(", "));
            }
        }
    }

    // Show first 5 LAYER names — quick regression check for the R2010+
    // string-stream / handle-stream alignment fix.
    let mut shown = 0;
    for o in file.objects.iter().filter(|o| o.type_name == "LAYER") {
        if shown >= 5 { break; }
        let name = o.data.get("name").and_then(|v| v.as_str()).unwrap_or("");
        let layer_handle = o.handle_refs.layer;
        let owner = o.handle_refs.owner;
        println!("  LAYER #{} handle=0x{:X} name={:?} owner={:?} layer_ref={:?}",
            shown, o.handle,
            if name.is_empty() { "<EMPTY>".to_string() } else { name.to_string() },
            owner, layer_handle);
        shown += 1;
    }

    Ok(())
}
