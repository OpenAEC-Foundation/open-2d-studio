//! Parse HANDLES + check which offsets are near interesting coords.

use dwg_parser::{r2007, parser::decompress_r2004, bitreader::DwgBitReader};
use std::collections::HashMap;

fn assemble_obj(data: &[u8], page_map: &HashMap<i32, usize>, page_size: usize, target: i32) -> Vec<u8> {
    let mut pages: Vec<(usize, usize, usize, usize)> = Vec::new();
    for (_sn, &fo) in page_map {
        if fo + 32 > data.len() { continue; }
        let mask = 0x4164536Bu32 ^ (fo as u32);
        let mut hdr = [0u8; 32];
        hdr.copy_from_slice(&data[fo..fo + 32]);
        for dw in 0..8 {
            let o = dw * 4;
            let v = u32::from_le_bytes([hdr[o], hdr[o+1], hdr[o+2], hdr[o+3]]) ^ mask;
            hdr[o..o+4].copy_from_slice(&v.to_le_bytes());
        }
        let st = i32::from_le_bytes([hdr[0], hdr[1], hdr[2], hdr[3]]);
        let sn = i32::from_le_bytes([hdr[4], hdr[5], hdr[6], hdr[7]]);
        if sn != target { continue; }
        if st != 1 && st != 2 && (st as u32) < 0x41000000 { continue; }
        let comp = u32::from_le_bytes([hdr[8], hdr[9], hdr[10], hdr[11]]) as usize;
        let dsz = u32::from_le_bytes([hdr[12], hdr[13], hdr[14], hdr[15]]) as usize;
        let so = u32::from_le_bytes([hdr[16], hdr[17], hdr[18], hdr[19]]) as usize;
        pages.push((fo, comp, dsz, so));
    }
    pages.sort_by_key(|&(_, _, _, so)| so);
    let total = pages.iter().map(|&(_, _, ds, so)| so + page_size.max(ds)).max().unwrap_or(0);
    let mut buf = vec![0u8; total];
    for (fo, comp, _dsz, so) in &pages {
        let body = &data[fo + 32..fo + 32 + comp];
        if let Ok(d) = decompress_r2004(body, page_size) {
            let n = d.len().min(buf.len() - so);
            buf[*so..*so + n].copy_from_slice(&d[..n]);
        }
    }
    buf
}

fn parse_objmap(data: &[u8]) -> Vec<(u32, usize)> {
    let mut handles = Vec::new();
    let mut pos = 0;
    let mut last_handle = 0i32;
    let mut last_loc = 0i32;
    while pos + 4 <= data.len() {
        let sec_size = u16::from_be_bytes([data[pos], data[pos + 1]]) as usize;
        if sec_size <= 2 || sec_size > 4096 { break; }
        if pos + 2 + sec_size > data.len() { break; }
        let body_end = pos + 2 + sec_size - 2;
        let mut rpos = pos + 2;
        while rpos < body_end {
            let (hd, p1) = match DwgBitReader::read_unsigned_modular_char(data, rpos) { Ok(v) => v, Err(_) => break };
            let (ld, p2) = match DwgBitReader::read_modular_char(data, p1) { Ok(v) => v, Err(_) => break };
            last_handle = last_handle.wrapping_add(hd as i32);
            last_loc = last_loc.wrapping_add(ld);
            if last_handle > 0 && last_loc >= 0 {
                handles.push((last_handle as u32, last_loc as usize));
            }
            rpos = p2;
        }
        pos += 2 + sec_size;
    }
    handles
}

fn main() {
    let path = std::env::args().nth(1).unwrap_or_else(|| {
        "C:/Users/rickd/Desktop/dwg_samples/3bm-trainingset/arceringen test/3070_model - Legend - M(--)01_arceringen_5.dwg".into()
    });
    let data = std::fs::read(&path).expect("read");
    let enc_hdr = r2007::decrypt_file_header_r2010(&data).expect("hdr");
    let (page_map, page_size) = r2007::read_page_map(&data, &enc_hdr).expect("pm");

    // Grab HANDLES buffer from sec_num=4
    let handles_buf = assemble_obj(&data, &page_map, page_size, 4);
    let handles = parse_objmap(&handles_buf);
    println!("decoded {} handles, max_off = {}", handles.len(),
        handles.iter().map(|(_, o)| *o).max().unwrap_or(0));

    // Find where 4E6 is mapped
    let obj = assemble_obj(&data, &page_map, page_size, 7);
    let obj_len = obj.len();

    // Target offset 0x26803 = 157699 (4E6 coord)
    let target_off = 0x24400usize + 0x2403usize;
    println!("\nLooking for handles near target offset 0x{:X} = {}:", target_off, target_off);
    let mut sorted = handles.clone();
    sorted.sort_by_key(|&(_, o)| o);
    for (h, o) in sorted.iter().filter(|&&(_, o)| o > target_off.saturating_sub(200) && o < target_off + 200) {
        println!("  h=0x{:X} off=0x{:X} ({})", h, o, o);
    }

    // Dump all handles in order, grouped by offset, focus on 0x24400..0x2B800 range (page 10)
    println!("\nHandles in page 10 range [0x24400..0x2B800]:");
    let count = sorted.iter().filter(|&&(_, o)| o >= 0x24400 && o < 0x2B800).count();
    println!("  {} handles", count);
    // Also count handles with offset > 267264
    let over = sorted.iter().filter(|&&(_, o)| o > obj_len).count();
    println!("\n{} handles with offset > buffer_len ({})", over, obj_len);

    // Print every handle in 0x40000 range
    println!("\nHandles in [0x40000..0x42000] (past all real pages):");
    for (h, o) in sorted.iter().filter(|&&(_, o)| o >= 0x40000 && o < 0x42000) {
        println!("  h=0x{:X} off=0x{:X}", h, o);
    }
    // And bogus ones > 0x42000
    println!("\nBogus handles offset > 0x42000 (beyond OBJECTS buffer):");
    let mut n_bogus = 0;
    for (h, o) in &sorted {
        if *o > 0x42000 {
            if n_bogus < 10 {
                println!("  h=0x{:X} off=0x{:X}", h, o);
            }
            n_bogus += 1;
        }
    }
    println!("  total: {}", n_bogus);

    // Look at handle 0x9EC at offset 0x40061 — what bytes are there?
    // If real object, we should see a plausible MS object-size varint at start.
    println!("\nHandle 0x9EC content @ 0x40061 (page 13 extended region):");
    let mut ctx = Vec::new();
    let off = 0x40061usize;
    for i in off..off.saturating_add(32).min(obj_len) { ctx.push(obj[i]); }
    for b in &ctx { print!("{:02x} ", b); }
    println!();

    // Look at where real entity data starts — known LINE handle 0x3BB's offset
    // from handle map
    for (h, o) in &sorted {
        if *h == 0x3BB {
            println!("\nHandle 0x3BB (known LINE) @ 0x{:X}:", o);
            let mut ctx = Vec::new();
            for i in *o..o.saturating_add(32).min(obj_len) { ctx.push(obj[i]); }
            for b in &ctx { print!("{:02x} ", b); }
            println!();
            break;
        }
    }
}
