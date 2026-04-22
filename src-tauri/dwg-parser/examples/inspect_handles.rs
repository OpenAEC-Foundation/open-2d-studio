//! Look inside the HANDLES section: parse both with and without extended LZ77
//! data to see how many entries are "real" (within 1815 bytes) vs. extended.

use dwg_parser::{r2007, parser::decompress_r2004, bitreader::DwgBitReader};

fn main() {
    let path = std::env::args().nth(1).unwrap_or_else(|| {
        "C:/Users/rickd/Desktop/dwg_samples/3bm-trainingset/arceringen test/3070_model - Legend - M(--)01_arceringen_5.dwg".into()
    });
    let data = std::fs::read(&path).expect("read");
    let enc_hdr = r2007::decrypt_file_header_r2010(&data).expect("decrypt");
    let (page_map, _ps) = r2007::read_page_map(&data, &enc_hdr).expect("pm");

    // Find sec_num=4 page
    let mut sorted: Vec<(i32, usize)> = page_map.iter().map(|(&p, &o)| (p, o)).collect();
    sorted.sort_by_key(|x| x.1);
    let mut hdl_full = Vec::new();
    let mut hdl_valid_len = 0usize;
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
        if sn != 4 { continue; }
        let comp = u32::from_le_bytes([hdr[8], hdr[9], hdr[10], hdr[11]]) as usize;
        let decomp_sz = u32::from_le_bytes([hdr[12], hdr[13], hdr[14], hdr[15]]) as usize;
        let body = &data[*fo + 32..*fo + 32 + comp];
        hdl_full = decompress_r2004(body, 0x7400).unwrap_or_default();
        hdl_valid_len = decomp_sz;
        println!("HANDLES: comp={} decomp_sz(hdr)={} full_decomp={}", comp, decomp_sz, hdl_full.len());
        break;
    }
    assert!(!hdl_full.is_empty());

    println!("Full buffer bytes around valid boundary:");
    let b1 = hdl_valid_len.saturating_sub(16);
    let b2 = (hdl_valid_len + 16).min(hdl_full.len());
    for i in b1..b2 {
        let marker = if i == hdl_valid_len { " [valid_end]" } else { "" };
        println!("  [{}] = {:02x}{}", i, hdl_full[i], marker);
    }

    // Parse with buffer limited to valid length
    let entries_valid = parse_objmap(&hdl_full[..hdl_valid_len]);
    let entries_full = parse_objmap(&hdl_full);

    println!("\nparse with buffer = {} bytes: {} entries, max_off = {}",
        hdl_valid_len, entries_valid.len(),
        entries_valid.iter().map(|(_, o)| *o).max().unwrap_or(0));
    println!("parse with buffer = {} bytes: {} entries, max_off = {}",
        hdl_full.len(), entries_full.len(),
        entries_full.iter().map(|(_, o)| *o).max().unwrap_or(0));

    // How many of the full entries are "bogus" (off > 267264)?
    let bogus = entries_full.iter().filter(|(_, o)| *o > 267264).count();
    println!("full: {} entries with offset > 267264 (bogus)", bogus);
    let legitimate = entries_full.iter().filter(|(_, o)| *o <= 267264).count();
    println!("full: {} entries with offset <= 267264 (legitimate)", legitimate);
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
