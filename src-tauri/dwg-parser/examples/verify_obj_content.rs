//! Verify the OBJECTS section after assembly contains the byte patterns
//! that plaintext_search finds on individual pages. If assembly truncates
//! at data_size boundary, assembled buffer will NOT contain the late hits.
//!
//! Hypothesis A test: search the assembled OBJECTS buffer for the same
//! known-plaintext LE f64 patterns that we can find on individual pages.
//! Compare hit positions against expected (start_offset + hit_on_page).

use dwg_parser::parser::decompress_r2004;
use dwg_parser::r2007;
use std::collections::HashMap;

// Inline reimpl of assemble_r2004_section_full
fn assemble_obj_full(data: &[u8], page_map: &HashMap<i32, usize>, page_size: usize, target: i32) -> Vec<u8> {
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
    for (fo, comp, dsz, so) in &pages {
        let body = &data[fo + 32..fo + 32 + comp];
        let tgt = page_size.max(*dsz);
        if let Ok(d) = decompress_r2004(body, tgt) {
            let n = d.len().min(buf.len() - so);
            buf[*so..*so + n].copy_from_slice(&d[..n]);
        }
    }
    buf
}

const COORDS: &[(&str, f64)] = &[
    ("LINE_3BB_ex", 2593.526172879812),
    ("LINE_344_sx", 1648.441095214118),
    ("LINE_44F_sx", 957.4984067675124),
    ("LINE_4E5_sx", 2008.862814420544),
    ("LINE_5E4_sx", 1999.86281442054),
    ("HATCH_451_x", 948.4984067675124),
    ("4E6_ey",      2119.48697250258),
];

fn find_bitshifted(hay: &[u8], needle: &[u8]) -> Vec<(usize, usize)> {
    let mut hits = Vec::new();
    if hay.len() < needle.len() + 1 { return hits; }
    for k in 0..=7usize {
        if k == 0 {
            for i in 0..=hay.len() - needle.len() {
                if &hay[i..i + needle.len()] == needle { hits.push((i, 0)); }
            }
        } else {
            let max = hay.len().saturating_sub(needle.len() + 1);
            'o: for i in 0..=max {
                for j in 0..needle.len() {
                    let v = ((hay[i + j] << k) | (hay[i + j + 1] >> (8 - k))) & 0xFF;
                    if v != needle[j] { continue 'o; }
                }
                hits.push((i, k));
            }
        }
    }
    hits
}

fn main() {
    let path = std::env::args().nth(1).unwrap_or_else(|| {
        "C:/Users/rickd/Desktop/dwg_samples/3bm-trainingset/arceringen test/3070_model - Legend - M(--)01_arceringen_5.dwg".into()
    });
    let data = std::fs::read(&path).expect("read");
    let enc_hdr = r2007::decrypt_file_header_r2010(&data).expect("hdr");
    let (page_map, page_size) = r2007::read_page_map(&data, &enc_hdr).expect("pm");
    eprintln!("page_size from r2007::read_page_map = 0x{:X}", page_size);

    // Build the OBJECTS buffer the same way the parser does: assemble sec_num=7.
    let obj = assemble_obj_full(&data, &page_map, page_size, 7);
    println!("OBJECTS buffer: {} bytes", obj.len());

    // Count zero runs to understand gap structure
    let mut i = 0usize;
    let mut gaps = Vec::new();
    while i < obj.len() {
        if obj[i] == 0 {
            let start = i;
            while i < obj.len() && obj[i] == 0 { i += 1; }
            if i - start >= 64 { gaps.push((start, i - start)); }
        } else { i += 1; }
    }
    println!("{} zero-runs of >= 64 bytes:", gaps.len());
    for (s, l) in &gaps {
        println!("  gap @ 0x{:X} .. 0x{:X}  ({} bytes)", s, s + l, l);
    }

    // Now search for each coord
    for (name, v) in COORDS {
        let pat = v.to_le_bytes();
        let hits = find_bitshifted(&obj, &pat);
        println!("{} = {}: {} hits in OBJECTS buffer", name, v, hits.len());
        for (bo, bi) in hits.iter().take(8) {
            println!("    @ 0x{:X} bit+{}", bo, bi);
        }
    }

    // Check which byte ranges are actually populated in OBJECTS
    // Focus on post-238944 region (past page 13's real content)
    // to see if any entity bytes are present there.
    println!("\n=== post-238944 region content (HANDLES max_off was 370092 > 267264 buffer) ===");
    let region_start = 238944usize;
    let region = &obj[region_start..];
    let mut nonzero_count = 0;
    for b in region { if *b != 0 { nonzero_count += 1; } }
    println!("  region [238944..{}] = {} bytes, {} non-zero ({:.1}%)",
        obj.len(), region.len(), nonzero_count, 100.0 * nonzero_count as f64 / region.len() as f64);

    // Dump first 64 bytes of region to see the pattern
    print!("  first 64 bytes: ");
    for b in region.iter().take(64) { print!("{:02x} ", b); }
    println!();

    // Also search EACH sec_num=7 page's FULL 29696-byte LZ77 output
    println!("\n=== per-page hits (full 0x7400 LZ77 output) ===");
    let mut sorted: Vec<(i32, usize)> = page_map.iter().map(|(&p, &o)| (p, o)).collect();
    sorted.sort_by_key(|x| x.1);
    for (pn, fo) in &sorted {
        if *fo + 32 > data.len() { continue; }
        let mask = 0x4164536Bu32 ^ (*fo as u32);
        let mut hdr = [0u8; 32];
        hdr.copy_from_slice(&data[*fo..*fo + 32]);
        for dw in 0..8 {
            let o = dw * 4;
            let vv = u32::from_le_bytes([hdr[o], hdr[o+1], hdr[o+2], hdr[o+3]]) ^ mask;
            hdr[o..o+4].copy_from_slice(&vv.to_le_bytes());
        }
        let sn = i32::from_le_bytes([hdr[4], hdr[5], hdr[6], hdr[7]]);
        if sn != 7 { continue; }
        let comp = u32::from_le_bytes([hdr[8], hdr[9], hdr[10], hdr[11]]) as usize;
        let body = &data[*fo + 32..*fo + 32 + comp];
        let d = match decompress_r2004(body, 0x7400) { Ok(x) => x, Err(_) => continue };
        for (name, v) in COORDS {
            let pat = v.to_le_bytes();
            let hits = find_bitshifted(&d, &pat);
            if !hits.is_empty() {
                println!("  pn={} {}: {} hits @ {:?}", pn, name, hits.len(),
                    hits.iter().take(5).map(|(o, _)| format!("0x{:X}", o)).collect::<Vec<_>>());
            }
        }
    }

    // Verify decompressed pages directly: for each OBJECTS page, show
    // how many bytes LZ77 produced vs declared decomp_size, and the
    // index of the LAST non-zero byte (the real end of valid content).
    println!("\n=== per-page valid span vs declared decomp_size ===");
    let mut sorted: Vec<(i32, usize)> = page_map.iter().map(|(&p, &o)| (p, o)).collect();
    sorted.sort_by_key(|x| x.1);
    for (pn, fo) in &sorted {
        if *fo + 32 > data.len() { continue; }
        let mask = 0x4164536Bu32 ^ (*fo as u32);
        let mut hdr = [0u8; 32];
        hdr.copy_from_slice(&data[*fo..*fo + 32]);
        for dw in 0..8 {
            let o = dw * 4;
            let vv = u32::from_le_bytes([hdr[o], hdr[o+1], hdr[o+2], hdr[o+3]]) ^ mask;
            hdr[o..o+4].copy_from_slice(&vv.to_le_bytes());
        }
        let sn = i32::from_le_bytes([hdr[4], hdr[5], hdr[6], hdr[7]]);
        if sn != 7 { continue; }
        let comp = u32::from_le_bytes([hdr[8], hdr[9], hdr[10], hdr[11]]) as usize;
        let decomp_sz = u32::from_le_bytes([hdr[12], hdr[13], hdr[14], hdr[15]]) as usize;
        let so = u32::from_le_bytes([hdr[16], hdr[17], hdr[18], hdr[19]]) as usize;
        let body = &data[*fo + 32..*fo + 32 + comp];
        // Always decompress to full page_size
        let tgt = 0x7400usize;
        match decompress_r2004(body, tgt) {
            Ok(d) => {
                let last_nz = d.iter().rposition(|&b| b != 0).unwrap_or(0);
                println!("  pn={} so=0x{:X} comp={} decomp_sz(hdr)={} tgt=0x{:X} produced={} last_nonzero={}",
                    pn, so, comp, decomp_sz, tgt, d.len(), last_nz + 1);
            }
            Err(e) => eprintln!("  pn={} DECOMP FAIL: {:?}", pn, e),
        }
    }
}
