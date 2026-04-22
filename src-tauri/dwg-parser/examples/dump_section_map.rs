//! Dump the raw 530-byte R2010+ section-map buffer so we can eyeball it vs ODA §4.6.
//!
//! Clean-room: no external tools, no other DWG libraries. This reads the same
//! file header + page map that the main parser reads, then prints the full
//! decompressed section-map body in hex+ASCII columns.

use dwg_parser::r2007;

fn main() {
    let path = std::env::args().nth(1).unwrap_or_else(|| {
        "C:/Users/rickd/Desktop/dwg_samples/3bm-trainingset/arceringen test/3070_model - Legend - M(--)01_arceringen_5.dwg".into()
    });
    let data = std::fs::read(&path).expect("read dwg");

    let enc_hdr = r2007::decrypt_file_header_r2010(&data).expect("decrypt");
    let (page_map, _page_size) = r2007::read_page_map(&data, &enc_hdr).expect("page map");

    // smid from offset 0x5C per parser.rs path
    let smid = i32::from_le_bytes([enc_hdr[0x5C], enc_hdr[0x5D], enc_hdr[0x5E], enc_hdr[0x5F]]);
    println!("smid=0x{:X} ({})", smid, smid);

    let body = r2007::read_section_map_by_page(&data, &page_map, smid).expect("smap body");
    println!("smap body = {} bytes", body.len());

    // Hex dump
    for chunk_start in (0..body.len()).step_by(16) {
        let chunk_end = (chunk_start + 16).min(body.len());
        print!("{:04X}:", chunk_start);
        for b in &body[chunk_start..chunk_end] {
            print!(" {:02x}", b);
        }
        // pad
        for _ in chunk_end..chunk_start + 16 { print!("   "); }
        print!("  |");
        for &b in &body[chunk_start..chunk_end] {
            let c = if (0x20..0x7F).contains(&b) { b as char } else { '.' };
            print!("{}", c);
        }
        println!("|");
    }

    // Also scan for "AcDb:" strings to mark section entry starts
    println!("\n=== AcDb: occurrences ===");
    let mut i = 0usize;
    while i + 5 <= body.len() {
        if &body[i..i + 5] == b"AcDb:" {
            // Collect name bytes up to NUL
            let mut end = i;
            while end < body.len() && body[end] != 0 { end += 1; }
            let name = std::str::from_utf8(&body[i..end]).unwrap_or("?");
            // Dump the 48 bytes BEFORE the name as RL fields
            let start = i.saturating_sub(48);
            print!("@0x{:04X} name='{}' (len={})  pre:",
                i, name, end - i);
            for dw in 0..(i - start) / 4 {
                let p = start + dw * 4;
                let v = u32::from_le_bytes([body[p], body[p + 1], body[p + 2], body[p + 3]]);
                print!(" [{:04X}]=0x{:08X}({})", p, v, v as i32);
            }
            println!();
            i = end;
        } else {
            i += 1;
        }
    }

    // Also, interpret the head bytes as §4.6 layout proposal:
    // +0 section_size RL, +4 page_count RL
    if body.len() >= 8 {
        let ss = u32::from_le_bytes([body[0], body[1], body[2], body[3]]);
        let pc = u32::from_le_bytes([body[4], body[5], body[6], body[7]]);
        println!("\nheader proposal: section_size=0x{:X}({}) page_count={}",
            ss, ss, pc);
    }
}
