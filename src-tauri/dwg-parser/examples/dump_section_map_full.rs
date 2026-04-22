//! Re-decompress section map page with data_size=1476 (field1) instead of 530 (field2)
//! to see if we get a larger buffer containing ALL sections including data sections.

use dwg_parser::{r2007, parser::decompress_r2004};

fn main() {
    let path = std::env::args().nth(1).unwrap_or_else(|| {
        "C:/Users/rickd/Desktop/dwg_samples/3bm-trainingset/arceringen test/3070_model - Legend - M(--)01_arceringen_5.dwg".into()
    });
    let data = std::fs::read(&path).expect("read");
    let enc_hdr = r2007::decrypt_file_header_r2010(&data).expect("decrypt");
    let (page_map, _ps) = r2007::read_page_map(&data, &enc_hdr).expect("pm");

    let smid = 22;
    let fo = page_map[&smid];
    println!("section map page file_off=0x{:X}", fo);

    let raw = &data[fo..fo + 20];
    println!("raw20: {:02x?}", raw);

    let sec_type = u32::from_le_bytes([raw[0], raw[1], raw[2], raw[3]]);
    let f1 = u32::from_le_bytes([raw[4], raw[5], raw[6], raw[7]]) as usize;
    let f2 = u32::from_le_bytes([raw[8], raw[9], raw[10], raw[11]]) as usize;
    let comp_type = u32::from_le_bytes([raw[12], raw[13], raw[14], raw[15]]);
    println!("sec_type=0x{:08X} field1={} field2={} comp_type={}", sec_type, f1, f2, comp_type);

    // Compute body size
    let mut offsets: Vec<usize> = page_map.values().copied().collect();
    offsets.sort();
    let next = offsets.iter().find(|&&o| o > fo).copied().unwrap_or(data.len());
    let body_size = next - fo - 20;
    println!("body_size (to next page) = {}", body_size);

    let body = &data[fo + 20..fo + 20 + body_size];
    println!("body first 20: {:02x?}", &body[..20.min(body.len())]);

    // Try both targets
    for &target in &[f1, f2, 2000usize, 4000, body_size * 4] {
        match decompress_r2004(body, target) {
            Ok(d) => println!("decompress target={} -> {} bytes, last 16: {:02x?}",
                target, d.len(), &d[d.len().saturating_sub(16)..]),
            Err(e) => println!("decompress target={} FAILED: {:?}", target, e),
        }
    }

    // Try decompress with a generous target and see actual output size
    let d = decompress_r2004(body, 10000).unwrap_or_default();
    println!("\ngenerous decomp ({} bytes):", d.len());
    // Dump full hex
    for start in (0..d.len()).step_by(16) {
        let end = (start + 16).min(d.len());
        print!("{:04X}:", start);
        for b in &d[start..end] { print!(" {:02x}", b); }
        for _ in end..start+16 { print!("   "); }
        print!("  |");
        for &b in &d[start..end] {
            let c = if (0x20..0x7F).contains(&b) { b as char } else { '.' };
            print!("{}", c);
        }
        println!("|");
    }
}
