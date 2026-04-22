// dwg_dxf_diff — non-GUI segment diff tool. Counts segments produced by the
// SAME loaders the split_compare viewer uses (so this matches what the user
// actually sees rendered side-by-side). For each base path, prints DXF/DWG
// segment count per entity-type and a total match%.

use dxf::entities::{Entity, EntityType, Insert};
use dxf::{Color as DxfColor, Drawing as DxfDrawing};
use std::collections::HashMap;
use std::env;

#[derive(Clone, Copy, Debug, Default)]
struct Counts { entities: u32, segments: u32 }

impl std::ops::AddAssign for Counts {
    fn add_assign(&mut self, rhs: Self) {
        self.entities += rhs.entities;
        self.segments += rhs.segments;
    }
}

fn main() -> anyhow::Result<()> {
    let args: Vec<String> = env::args().skip(1).collect();
    let summary_mode = args.iter().any(|a| a == "--summary");
    let bases: Vec<String> = if args.iter().any(|a| a == "--all") {
        // Built-in corpus of paired files (DWG + DXF coexist).
        all_paired_bases()
    } else {
        args.iter()
            .filter(|a| !a.starts_with("--"))
            .map(|a| a.trim_end_matches(".dwg").trim_end_matches(".DWG")
                .trim_end_matches(".dxf").trim_end_matches(".DXF").to_string())
            .collect()
    };
    if bases.is_empty() {
        eprintln!("usage: dwg_dxf_diff <base_path_no_extension>... | --all [--summary]");
        std::process::exit(1);
    }

    if summary_mode {
        print_summary_table(&bases)?;
    } else {
        for base in &bases {
            print_diff_for_base(base)?;
            println!();
        }
    }
    Ok(())
}

fn all_paired_bases() -> Vec<String> {
    let candidates = [
        r"C:\Users\rickd\Desktop\dwg_samples\libredwg-testdata\test\test-data\example_2000",
        r"C:\Users\rickd\Desktop\dwg_samples\libredwg-testdata\test\test-data\example_2004",
        r"C:\Users\rickd\Desktop\dwg_samples\libredwg-testdata\test\test-data\example_2007",
        r"C:\Users\rickd\Desktop\dwg_samples\libredwg-testdata\test\test-data\example_2010",
        r"C:\Users\rickd\Desktop\dwg_samples\libredwg-testdata\test\test-data\example_2013",
        r"C:\Users\rickd\Desktop\dwg_samples\libredwg-testdata\test\test-data\example_2018",
        r"C:\Users\rickd\Desktop\dwg_samples\libredwg-testdata\test\test-data\sample_2000",
        r"C:\Users\rickd\Desktop\dwg_samples\libredwg-testdata\test\test-data\sample_2018",
        r"C:\Users\rickd\Desktop\dwg_samples\acadsharp\samples\sample_AC1015",
        r"C:\Users\rickd\Desktop\dwg_samples\acadsharp\samples\sample_AC1018",
        r"C:\Users\rickd\Desktop\dwg_samples\acadsharp\samples\sample_AC1024",
        r"C:\Users\rickd\Desktop\dwg_samples\acadsharp\samples\sample_AC1027",
        r"C:\Users\rickd\Desktop\dwg_samples\acadsharp\samples\sample_AC1032",
        r"C:\Users\rickd\Desktop\dwg_samples\arc_2010",
        r"C:\Users\rickd\Desktop\dwg_samples\circle_2010",
        r"C:\Users\rickd\Desktop\dwg_samples\line_2010",
    ];
    candidates.iter()
        .filter(|b| std::path::Path::new(&format!("{}.dwg", b)).exists())
        .map(|s| s.to_string())
        .collect()
}

fn print_summary_table(bases: &[String]) -> anyhow::Result<()> {
    println!("{:<48} {:>10} {:>10} {:>8}", "FILE", "DXF segs", "DWG segs", "match%");
    println!("{}", "-".repeat(80));
    let mut grand_dxf = 0u32;
    let mut grand_dwg = 0u32;
    for base in bases {
        let label = std::path::Path::new(base).file_name()
            .map(|n| n.to_string_lossy().into_owned()).unwrap_or_else(|| base.clone());
        let dxf = load_dxf_for_base(base);
        let dwg = count_dwg_segments(&format!("{}.dwg", base)).unwrap_or_default();
        let dxf_total: u32 = dxf.values().map(|c| c.segments).sum();
        let dwg_total: u32 = dwg.values().map(|c| c.segments).sum();
        let pct = if dxf_total > 0 { (dwg_total as f64 / dxf_total as f64 * 100.0).round() as i32 } else { 0 };
        grand_dxf += dxf_total;
        grand_dwg += dwg_total;
        println!("{:<48} {:>10} {:>10} {:>7}%", label, dxf_total, dwg_total, pct);
    }
    println!("{}", "-".repeat(80));
    let grand_pct = if grand_dxf > 0 { (grand_dwg as f64 / grand_dxf as f64 * 100.0).round() as i32 } else { 0 };
    println!("{:<48} {:>10} {:>10} {:>7}%", "TOTAL", grand_dxf, grand_dwg, grand_pct);
    Ok(())
}

fn load_dxf_for_base(base: &str) -> HashMap<String, Counts> {
    for cand in [format!("{}.dxf", base), format!("{}_ascii.dxf", base)] {
        if std::path::Path::new(&cand).exists() {
            // dxf-0.5 crate panics on some R2004+ files; catch and skip.
            let cand_owned = cand.clone();
            let res = std::panic::catch_unwind(|| count_dxf_segments(&cand_owned));
            match res {
                Ok(Ok(m)) => return m,
                Ok(Err(_)) | Err(_) => continue,
            }
        }
    }
    HashMap::new()
}

fn print_diff_for_base(base: &str) -> anyhow::Result<()> {

    // Try plain `.dxf` first, then `_ascii.dxf` (AcadSharp naming).
    let dxf_candidates = [
        format!("{}.dxf", base),
        format!("{}_ascii.dxf", base),
    ];
    let mut dxf = HashMap::new();
    for cand in &dxf_candidates {
        if std::path::Path::new(cand).exists() {
            match count_dxf_segments(cand) {
                Ok(m) => { eprintln!("[DXF] loaded: {}", cand); dxf = m; break; }
                Err(e) => eprintln!("[DXF] {}: {:?}", cand, e),
            }
        }
    }
    let dwg = count_dwg_segments(&format!("{}.dwg", base))
        .unwrap_or_else(|e| { eprintln!("[DWG] FAILED: {:?}", e); HashMap::new() });

    let mut all: Vec<String> = dxf.keys().cloned().chain(dwg.keys().cloned()).collect();
    all.sort();
    all.dedup();

    println!("BASE: {}", base);
    println!("{:<14} {:>9} {:>9} {:>9} {:>9} {:>10}",
        "TYPE", "DXF #", "DXF segs", "DWG #", "DWG segs", "seg %");
    println!("{}", "-".repeat(64));
    let mut tot = (Counts::default(), Counts::default());
    for t in &all {
        let d = dxf.get(t).copied().unwrap_or_default();
        let w = dwg.get(t).copied().unwrap_or_default();
        if d.entities == 0 && w.entities == 0 { continue; }
        tot.0 += d; tot.1 += w;
        let pct = if d.segments > 0 {
            format!("{}%", (w.segments as f64 / d.segments as f64 * 100.0).round() as i32)
        } else if w.segments > 0 { "+only".into() } else { "—".into() };
        println!("{:<14} {:>9} {:>9} {:>9} {:>9} {:>10}",
            t, d.entities, d.segments, w.entities, w.segments, pct);
    }
    println!("{}", "-".repeat(64));
    let pct = if tot.0.segments > 0 {
        (tot.1.segments as f64 / tot.0.segments as f64 * 100.0).round() as i32
    } else { 0 };
    println!("{:<14} {:>9} {:>9} {:>9} {:>9} {:>9}%",
        "TOTAL", tot.0.entities, tot.0.segments, tot.1.entities, tot.1.segments, pct);
    Ok(())
}

// --- DXF: walk modelspace AND every block definition; tessellate to segments. ---
fn count_dxf_segments(path: &str) -> anyhow::Result<HashMap<String, Counts>> {
    let drawing = DxfDrawing::load_file(path)?;
    let mut map = HashMap::new();
    // Build block table for INSERT expansion.
    let mut blocks: HashMap<String, Vec<&Entity>> = HashMap::new();
    for b in drawing.blocks() {
        blocks.insert(b.name.clone(), b.entities.iter().collect());
    }
    // Helper closure
    fn classify(e: &Entity) -> &'static str {
        match &e.specific {
            EntityType::Line(_) => "LINE",
            EntityType::Circle(_) => "CIRCLE",
            EntityType::Arc(_) => "ARC",
            EntityType::LwPolyline(_) => "LWPOLYLINE",
            EntityType::Polyline(_) => "POLYLINE",
            EntityType::Insert(_) => "INSERT",
            EntityType::Text(_) => "TEXT",
            EntityType::MText(_) => "MTEXT",
            EntityType::Solid(_) => "SOLID",
            EntityType::Ellipse(_) => "ELLIPSE",
            EntityType::Spline(_) => "SPLINE",
            EntityType::ModelPoint(_) => "POINT",
            EntityType::Leader(_) => "LEADER",
            EntityType::Ray(_) => "RAY",
            EntityType::XLine(_) => "XLINE",
            // dxf 0.5 crate doesn't expose a `Hatch` variant — counts fall under OTHER
            _ => "OTHER",
        }
    }
    fn entity_segments(e: &Entity) -> u32 {
        match &e.specific {
            EntityType::Line(_) => 1,
            EntityType::Circle(_) => 64,
            EntityType::Arc(a) => {
                let mut sweep = (a.end_angle - a.start_angle).to_radians();
                if sweep < 0.0 { sweep += std::f64::consts::TAU; }
                ((sweep / std::f64::consts::TAU * 64.0).ceil() as u32).max(4).min(256)
            }
            EntityType::LwPolyline(p) => {
                let n = p.vertices.len() as u32;
                if n >= 2 { n - 1 } else { 0 }
            }
            EntityType::Polyline(p) => {
                let n = p.vertices().count() as u32;
                if n >= 2 { n - 1 } else { 0 }
            }
            EntityType::Solid(_) => 4,
            EntityType::Ellipse(_) => 96,
            EntityType::Spline(s) => {
                // Fall back to control points if no fit points present.
                if s.fit_points.len() >= 2 {
                    (s.fit_points.len() as u32 - 1) * 4
                } else if s.control_points.len() >= 2 {
                    (s.control_points.len() as u32 - 1) * 4
                } else { 0 }
            }
            EntityType::ModelPoint(_) => 0,
            _ => 0,
        }
    }

    // Walk modelspace + all blocks.
    let mut count_into = |kind: &str, segs: u32, m: &mut HashMap<String, Counts>| {
        let c = m.entry(kind.to_string()).or_default();
        c.entities += 1;
        c.segments += segs;
    };

    let mut walk_entities = |entities: &[&Entity], m: &mut HashMap<String, Counts>| {
        for e in entities {
            let kind = classify(e);
            // INSERT expansion: count host INSERT plus segments of block contents.
            if let EntityType::Insert(ins) = &e.specific {
                count_into("INSERT", 0, m);
                if let Some(block_ents) = blocks.get(&ins.name) {
                    for be in block_ents {
                        let bk = classify(be);
                        count_into(bk, entity_segments(be), m);
                    }
                }
            } else {
                count_into(kind, entity_segments(e), m);
            }
        }
    };
    let model: Vec<&Entity> = drawing.entities().collect();
    walk_entities(&model, &mut map);
    // Also walk user blocks, but skip *Model_Space / *Paper_Space / *X (xref)
    // — modelspace entities are already counted via drawing.entities() and
    // would double-count if we re-walked the *Model_Space block.
    let block_ents: Vec<&Entity> = drawing.blocks()
        .filter(|b| {
            let n = b.name.to_uppercase();
            !n.starts_with("*MODEL_SPACE")
                && !n.starts_with("*PAPER_SPACE")
                && !n.starts_with("*X")
        })
        .flat_map(|b| b.entities.iter())
        .collect();
    walk_entities(&block_ents, &mut map);
    Ok(map)
}

// --- DWG: walk all entity-objects from the parser; tessellate same as viewer. ---
fn count_dwg_segments(path: &str) -> anyhow::Result<HashMap<String, Counts>> {
    use dwg_parser::DwgParser;
    let bytes = std::fs::read(path)?;
    let mut parser = DwgParser::new();
    let file = parser.parse(&bytes)
        .map_err(|e| anyhow::anyhow!("DWG parse failed: {:?}", e))?;
    let mut map: HashMap<String, Counts> = HashMap::new();
    for obj in &file.objects {
        if !obj.is_entity { continue; }
        let kind = match obj.type_name.as_str() {
            "POLYLINE_2D" => "LWPOLYLINE",
            other => other,
        };
        let segs = estimate_dwg_segments(obj);
        let c = map.entry(kind.to_string()).or_default();
        c.entities += 1;
        c.segments += segs;
    }
    Ok(map)
}

fn estimate_dwg_segments(obj: &dwg_parser::DwgObject) -> u32 {
    let d = &obj.data;
    let has_xy = |key: &str| d.get(key).and_then(|v| v.as_array()).is_some();
    match obj.type_name.as_str() {
        "LINE" => if has_xy("start") && has_xy("end") { 1 } else { 0 },
        "CIRCLE" => if has_xy("center") { 64 } else { 0 },
        "ARC" => if has_xy("center") { 64 } else { 0 },
        "ELLIPSE" => if has_xy("center") { 96 } else { 0 },
        "LWPOLYLINE" | "POLYLINE_2D" => {
            d.get("vertices").and_then(|v| v.as_array())
                .map(|a| if a.len() >= 2 { (a.len() - 1) as u32 } else { 0 })
                .unwrap_or(0)
        }
        "SOLID" => 4,
        "POINT" => 0,
        "HATCH" => {
            // Sum tessellated chord counts across all boundary paths.
            // Polyline-form: vertex chain; edge-form: per-edge approximation.
            let mut total: u32 = 0;
            if let Some(paths) = d.get("boundaryPaths").and_then(|v| v.as_array()) {
                for path in paths {
                    if let Some(verts) = path.get("vertices").and_then(|v| v.as_array()) {
                        if verts.len() >= 2 { total += (verts.len() - 1) as u32; }
                        if path.get("closed").and_then(|v| v.as_bool()).unwrap_or(false)
                            && verts.len() >= 2 { total += 1; }
                    }
                    if let Some(edges) = path.get("edges").and_then(|v| v.as_array()) {
                        for edge in edges {
                            match edge.get("type").and_then(|v| v.as_str()).unwrap_or("") {
                                "line" => total += 1,
                                "arc" => total += 64,
                                "ellipseArc" => total += 96,
                                "spline" => total += 32,
                                _ => {}
                            }
                        }
                    }
                }
            }
            total
        }
        "SPLINE" => {
            d.get("fitPoints").and_then(|v| v.as_array())
                .map(|a| a.len() as u32 * 4)
                .or_else(|| d.get("controlPoints").and_then(|v| v.as_array())
                    .map(|a| a.len() as u32 * 4))
                .unwrap_or(0)
        }
        _ => 0,
    }
}
