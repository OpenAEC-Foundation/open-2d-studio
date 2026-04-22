//! Verification harness: parse a DWG and report entity counts + bbox.

use dwg_parser::DwgParser;

fn main() {
    let path = std::env::args().nth(1).expect("usage: dump <path.dwg>");
    let bytes = std::fs::read(&path).expect("read file");
    let mut parser = DwgParser::new();
    let file = parser.parse(&bytes).expect("parse dwg");

    println!("[dwg] version={} objects={}", file.version, file.objects.len());

    let mut n_line = 0usize;
    let mut n_circle = 0;
    let mut n_arc = 0;
    let mut n_lwpl = 0;
    let mut n_pl2 = 0;
    let mut n_pl3 = 0;
    let mut n_insert = 0;
    let mut n_text = 0;
    let mut n_mtext = 0;
    let mut n_hatch = 0;
    let mut n_entity = 0;
    let mut n_non_entity = 0;
    let mut type_name_counts: std::collections::HashMap<String, usize> = std::collections::HashMap::new();

    let mut xmin = f64::INFINITY;
    let mut ymin = f64::INFINITY;
    let mut xmax = f64::NEG_INFINITY;
    let mut ymax = f64::NEG_INFINITY;

    let mut upd = |x: f64, y: f64| {
        if x.is_finite() && y.is_finite() && x.abs() < 1e12 && y.abs() < 1e12 {
            // tracked via closure — no-op here
        }
    };
    let _ = &mut upd;

    for o in &file.objects {
        if o.is_entity { n_entity += 1; } else { n_non_entity += 1; }
        *type_name_counts.entry(o.type_name.clone()).or_insert(0) += 1;
        match o.type_name.as_str() {
            "LINE" => {
                n_line += 1;
                if let (Some(s), Some(e)) = (o.data.get("start"), o.data.get("end")) {
                    if let (Some(sx), Some(sy), Some(ex), Some(ey)) = (
                        s.get(0).and_then(|v| v.as_f64()),
                        s.get(1).and_then(|v| v.as_f64()),
                        e.get(0).and_then(|v| v.as_f64()),
                        e.get(1).and_then(|v| v.as_f64()),
                    ) {
                        for (x, y) in [(sx, sy), (ex, ey)] {
                            if x.is_finite() && y.is_finite() && x.abs() < 1e12 && y.abs() < 1e12 {
                                if x < xmin { xmin = x; }
                                if y < ymin { ymin = y; }
                                if x > xmax { xmax = x; }
                                if y > ymax { ymax = y; }
                            }
                        }
                    }
                }
            }
            "CIRCLE" => {
                n_circle += 1;
                if let Some(c) = o.data.get("center") {
                    if let (Some(cx), Some(cy)) = (
                        c.get(0).and_then(|v| v.as_f64()),
                        c.get(1).and_then(|v| v.as_f64()),
                    ) {
                        let r = o.data.get("radius").and_then(|v| v.as_f64()).unwrap_or(0.0);
                        for (x, y) in [(cx - r, cy - r), (cx + r, cy + r)] {
                            if x.is_finite() && y.is_finite() && x.abs() < 1e12 && y.abs() < 1e12 {
                                if x < xmin { xmin = x; }
                                if y < ymin { ymin = y; }
                                if x > xmax { xmax = x; }
                                if y > ymax { ymax = y; }
                            }
                        }
                    }
                }
            }
            "ARC" => {
                n_arc += 1;
                if let Some(c) = o.data.get("center") {
                    if let (Some(cx), Some(cy)) = (
                        c.get(0).and_then(|v| v.as_f64()),
                        c.get(1).and_then(|v| v.as_f64()),
                    ) {
                        if cx.is_finite() && cy.is_finite() && cx.abs() < 1e12 && cy.abs() < 1e12 {
                            if cx < xmin { xmin = cx; }
                            if cy < ymin { ymin = cy; }
                            if cx > xmax { xmax = cx; }
                            if cy > ymax { ymax = cy; }
                        }
                    }
                }
            }
            "LWPOLYLINE" => { n_lwpl += 1; }
            "POLYLINE_2D" => { n_pl2 += 1; }
            "POLYLINE_3D" => { n_pl3 += 1; }
            "INSERT" => { n_insert += 1; }
            "TEXT" => { n_text += 1; }
            "MTEXT" => { n_mtext += 1; }
            "HATCH" => { n_hatch += 1; }
            _ => {}
        }
    }

    println!(
        "[dwg] entities={}, non_entities={}",
        n_entity, n_non_entity
    );
    println!(
        "[dwg] LINE={} CIRCLE={} ARC={} LWPL={} PL2D={} PL3D={} INS={} TXT={} MTXT={} HATCH={}",
        n_line, n_circle, n_arc, n_lwpl, n_pl2, n_pl3, n_insert, n_text, n_mtext, n_hatch
    );
    // Print type_name histogram (all types with count > 0)
    let mut types: Vec<_> = type_name_counts.iter().collect();
    types.sort_by_key(|&(_, c)| std::cmp::Reverse(*c));
    println!("[dwg] type histogram:");
    for (name, cnt) in types.iter().take(30) {
        println!("  {:>4}  {}", cnt, name);
    }
    if xmin.is_finite() {
        println!(
            "[dwg] bbox: [{:.3}, {:.3}] to [{:.3}, {:.3}]",
            xmin, ymin, xmax, ymax
        );
    } else {
        println!("[dwg] bbox: no valid coordinates");
    }

    // Show a few sample entities to spot-check coord sanity
    let mut shown = 0usize;
    for o in &file.objects {
        if shown >= 5 { break; }
        if matches!(o.type_name.as_str(), "LINE" | "CIRCLE" | "ARC") {
            println!("  sample {}: {} {:?}", o.handle, o.type_name, o.data.get("start").or_else(|| o.data.get("center")));
            shown += 1;
        }
    }

    // Find HATCH with oracle coords (y near 1698..1750)
    for o in &file.objects {
        if o.type_name != "HATCH" { continue; }
        if let Some(paths) = o.data.get("boundaryPaths").and_then(|v| v.as_array()) {
            for p in paths {
                if let Some(edges) = p.get("edges").and_then(|v| v.as_array()) {
                    for e in edges {
                        if let Some(start) = e.get("start").and_then(|v| v.as_array()) {
                            let y = start.get(1).and_then(|v| v.as_f64()).unwrap_or(0.0);
                            if (y - 1698.249).abs() < 0.01 || (y - 1750.725).abs() < 0.01 {
                                println!("  ORACLE MATCH: HATCH h={} edge={}", o.handle, e);
                            }
                        }
                    }
                }
            }
        }
    }

    // Show a few HATCH samples with boundary path info
    let mut shown_h = 0usize;
    for o in &file.objects {
        if shown_h >= 3 { break; }
        if o.type_name == "HATCH" {
            let pat = o.data.get("patternName").and_then(|v| v.as_str()).unwrap_or("?");
            let solid = o.data.get("solidFill").and_then(|v| v.as_bool()).unwrap_or(false);
            let n_paths = o.data.get("boundaryPaths").and_then(|v| v.as_array()).map(|a| a.len()).unwrap_or(0);
            println!("  HATCH h={} pattern={} solid={} paths={}", o.handle, pat, solid, n_paths);
            if let Some(paths) = o.data.get("boundaryPaths").and_then(|v| v.as_array()) {
                for (i, p) in paths.iter().take(2).enumerate() {
                    if let Some(verts) = p.get("vertices").and_then(|v| v.as_array()) {
                        let v_first = verts.first();
                        let v_last = verts.last();
                        println!("    path[{}] polyline: {} verts first={:?} last={:?}", i, verts.len(), v_first, v_last);
                    } else if let Some(edges) = p.get("edges").and_then(|v| v.as_array()) {
                        println!("    path[{}] edges: {}", i, edges.len());
                        for (j, e) in edges.iter().take(2).enumerate() {
                            println!("      edge[{}] = {}", j, e);
                        }
                    }
                }
            }
            shown_h += 1;
        }
    }
}
