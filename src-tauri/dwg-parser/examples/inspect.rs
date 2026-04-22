//! Inspect entity internals for the failing DWGs — read-only analysis.
use dwg_parser::DwgParser;

fn main() {
    let path = std::env::args().nth(1).expect("usage: inspect <path.dwg>");
    let bytes = std::fs::read(&path).expect("read file");
    let mut parser = DwgParser::new();
    let file = parser.parse(&bytes).expect("parse dwg");

    println!("[inspect] version={} objects={}", file.version, file.objects.len());

    for o in &file.objects {
        if !o.is_entity { continue; }
        println!("---- h=0x{:X} type_num=0x{:X} name={} ----", o.handle, o.type_num, o.type_name);
        let keys: Vec<&String> = o.data.keys().collect();
        for k in keys {
            let v = &o.data[k];
            let repr = serde_json::to_string(v).unwrap_or_default();
            let repr = if repr.len() > 160 { format!("{}...[len={}]", &repr[..160], repr.len()) } else { repr };
            println!("  {} = {}", k, repr);
        }
    }
}
