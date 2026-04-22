//! Scan every file offset in page_map plus a sliding window to find ALL data
//! pages with sec_num=7 (OBJECTS), including any not resolved by the page map.

use dwg_parser::r2007;
use std::collections::HashMap;

fn main() {
    let path = std::env::args().nth(1).unwrap_or_else(|| {
        "C:/Users/rickd/Desktop/dwg_samples/3bm-trainingset/arceringen test/3070_model - Legend - M(--)01_arceringen_5.dwg".into()
    });
    let data = std::fs::read(&path).expect("read dwg");
    let enc_hdr = r2007::decrypt_file_header_r2010(&data).expect("decrypt");
    let (page_map, _page_size) = r2007::read_page_map(&data, &enc_hdr).expect("pm");

    let mut sorted: Vec<(i32, usize)> = page_map.iter().map(|(&p, &o)| (p, o)).collect();
    sorted.sort_by_key(|x| x.1);
    println!("\npages sorted by file offset:");
    let mut prev_end: usize = 0x100;
    for (pn, fo) in &sorted {
        let gap = if *fo > prev_end { *fo - prev_end } else { 0 };
        println!(" page_num={:3} file_off=0x{:06X} (gap_before=0x{:X})", pn, fo, gap);
        prev_end = *fo;
    }

    println!("\n=== XOR-decrypt at every page_map offset + iterate by page_size===");
    // Re-iterate each page_map offset and decode XOR hdr
    for (pn, fo) in &sorted {
        if *fo + 32 > data.len() { continue; }
        let mask = 0x4164536Bu32 ^ (*fo as u32);
        let mut hdr = [0u8; 32];
        hdr.copy_from_slice(&data[*fo..*fo + 32]);
        for dw in 0..8 {
            let o = dw * 4;
            let v = u32::from_le_bytes([hdr[o], hdr[o+1], hdr[o+2], hdr[o+3]]) ^ mask;
            hdr[o..o+4].copy_from_slice(&v.to_le_bytes());
        }
        let st = u32::from_le_bytes([hdr[0], hdr[1], hdr[2], hdr[3]]);
        let sn = i32::from_le_bytes([hdr[4], hdr[5], hdr[6], hdr[7]]);
        let comp = u32::from_le_bytes([hdr[8], hdr[9], hdr[10], hdr[11]]);
        let decomp = u32::from_le_bytes([hdr[12], hdr[13], hdr[14], hdr[15]]);
        let so = u32::from_le_bytes([hdr[16], hdr[17], hdr[18], hdr[19]]);
        println!(" p={:3} fo=0x{:06X} xor: st=0x{:08X} sn={:3} comp={:5} decomp={:5} so=0x{:05X}",
            pn, fo, st, sn, comp, decomp, so);
    }

    // Sum per sec_num
    let mut per_sec: HashMap<i32, (usize, usize, usize)> = HashMap::new(); // (pages, comp_sum, decomp_sum)
    for (_pn, fo) in &sorted {
        if *fo + 32 > data.len() { continue; }
        let mask = 0x4164536Bu32 ^ (*fo as u32);
        let mut hdr = [0u8; 32];
        hdr.copy_from_slice(&data[*fo..*fo + 32]);
        for dw in 0..8 {
            let o = dw * 4;
            let v = u32::from_le_bytes([hdr[o], hdr[o+1], hdr[o+2], hdr[o+3]]) ^ mask;
            hdr[o..o+4].copy_from_slice(&v.to_le_bytes());
        }
        let sn = i32::from_le_bytes([hdr[4], hdr[5], hdr[6], hdr[7]]);
        let comp = u32::from_le_bytes([hdr[8], hdr[9], hdr[10], hdr[11]]) as usize;
        let decomp = u32::from_le_bytes([hdr[12], hdr[13], hdr[14], hdr[15]]) as usize;
        let e = per_sec.entry(sn).or_insert((0, 0, 0));
        e.0 += 1;
        e.1 += comp;
        e.2 += decomp;
    }
    println!("\n=== Per sec_num summary ===");
    let mut keys: Vec<i32> = per_sec.keys().copied().collect();
    keys.sort();
    for k in keys {
        let (p, c, d) = per_sec[&k];
        println!(" sn={:3}: pages={} comp_sum={} decomp_sum={}", k, p, c, d);
    }
}
