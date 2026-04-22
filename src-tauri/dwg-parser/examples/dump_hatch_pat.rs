//! Dump HATCH pattern-line values for every non-solid HATCH in a DWG.
//! Used to evidence DXF vs DWG angle/base/offset/scale parity.

use dwg_parser::DwgParser;

fn main() {
    let path = std::env::args().nth(1).expect("usage: dump_hatch_pat <path.dwg>");
    let bytes = std::fs::read(&path).expect("read file");
    let mut parser = DwgParser::new();
    let file = parser.parse(&bytes).expect("parse dwg");

    println!("[dwg] version={} objects={}", file.version, file.objects.len());

    let mut n_solid = 0usize;
    let mut n_pat = 0usize;
    let mut shown = 0usize;
    let limit: usize = std::env::args().nth(2).and_then(|s| s.parse().ok()).unwrap_or(8);

    for o in &file.objects {
        if o.type_name != "HATCH" { continue; }
        let solid = o.data.get("solidFill").and_then(|v| v.as_bool()).unwrap_or(false);
        if solid { n_solid += 1; continue; }
        n_pat += 1;

        let pat_name = o.data.get("patternName").and_then(|v| v.as_str()).unwrap_or("?");
        let p_ang = o.data.get("patternAngle").and_then(|v| v.as_f64()).unwrap_or(f64::NAN);
        let p_sc = o.data.get("patternScale").and_then(|v| v.as_f64()).unwrap_or(f64::NAN);
        let ext = o.data.get("extrusion");

        if shown >= limit { continue; }
        shown += 1;
        println!("\nHATCH h={} pattern='{}' patternAngle={} patternScale={} extrusion={:?}",
            o.handle, pat_name, p_ang, p_sc, ext);

        if let Some(plines) = o.data.get("patternLines").and_then(|v| v.as_array()) {
            for (i, pl) in plines.iter().enumerate() {
                let a = pl.get("angle").and_then(|v| v.as_f64()).unwrap_or(f64::NAN);
                let base = pl.get("base");
                let off = pl.get("offset");
                let dashes = pl.get("dashes");
                println!("  pattern-line[{}] angle_raw={} base={:?} offset={:?} dashes={:?}",
                    i, a, base, off, dashes);
            }
        } else {
            println!("  (no patternLines array emitted)");
        }
    }
    println!("\n[summary] HATCH total-pattern={} solid={}", n_pat, n_solid);
}
