//! Dump LWPOLYLINE vertex data for oracle comparison.

use dwg_parser::DwgParser;

fn main() {
    let path = std::env::args().nth(1).expect("usage: lwp_dump <path.dwg>");
    let bytes = std::fs::read(&path).expect("read file");
    let mut parser = DwgParser::new();
    let file = parser.parse(&bytes).expect("parse dwg");

    for o in &file.objects {
        if o.type_name == "LWPOLYLINE" {
            let verts = o.data.get("vertices").and_then(|v| v.as_array());
            if let Some(vs) = verts {
                println!("LWPOLYLINE handle=0x{:X} n={}", o.handle, vs.len());
                for (i, v) in vs.iter().enumerate() {
                    let x = v.get("x").and_then(|x| x.as_f64()).unwrap_or(f64::NAN);
                    let y = v.get("y").and_then(|y| y.as_f64()).unwrap_or(f64::NAN);
                    println!("  v{} = ({}, {})", i, x, y);
                }
            }
        }
    }
}
