//! Known-plaintext oracle: search the DWG file (raw + decompressed page bodies)
//! for the exact 8-byte LE f64 patterns of coordinates taken from the DXF twin.
//!
//! Used to pin down EXACT byte offsets where known entities live, bypassing the
//! need for a working object-map parse. Helps verify which section_number
//! actually contains the OBJECTS / HANDLES / HEADER data.
//!
//! Clean-room: no external DWG libraries, no external tools — only this parser's
//! own reader + a public DXF textual oracle.

use dwg_parser::r2007;

const DXF_COORDS: &[(&str, f64)] = &[
    // First DXF LINE (handle 3BB): start.x, start.y, end.x
    ("LINE_3BB_sx", 2789.526172879812),
    ("LINE_3BB_sy", 1060.204143620976),
    ("LINE_3BB_ex", 2593.526172879812),
    // Mid-range LINE (handle 0x344): near top of legend (row ~1325)
    ("LINE_344_sx", 1648.441095214118),
    ("LINE_344_sy", 1325.725358862068),
    // Mid-range LINE (handle 0x44F): at y=2442.9
    ("LINE_44F_sx", 957.4984067675124),
    ("LINE_44F_sy", 2442.900029676214),
    // Late-range LINE (handle 0x4E5): at y=2117.9
    ("LINE_4E5_sx", 2008.862814420544),
    ("LINE_4E5_sy", 2117.900029676204),
    // Final-range LINE (handle 0x5E4): y=429.53, x=1999.8
    ("LINE_5E4_sx", 1999.86281442054),
    ("LINE_5E4_sy", 429.5334270646572),
    // HATCH (handle 0x451): vertex at (948.5, 2444.5)
    ("HATCH_451_x", 948.4984067675124),
    ("HATCH_451_y", 2444.48697250259),
    // $EXTMIN / $EXTMAX header — these MUST appear in HEADER section
    ("EXTMIN_x",   597.0766875610849),
    ("EXTMIN_y",  -259.2281865758631),
    ("EXTMAX_x",  2789.526172879815),
    ("EXTMAX_y",  3590.771993835089),
];

fn find_all(haystack: &[u8], needle: &[u8]) -> Vec<usize> {
    let mut hits = Vec::new();
    if haystack.len() < needle.len() { return hits; }
    for i in 0..=haystack.len() - needle.len() {
        if &haystack[i..i + needle.len()] == needle {
            hits.push(i);
        }
    }
    hits
}

/// Bit-shift aware search. For each bit offset `k` in 0..7, reshape the haystack
/// by shifting left by `k` bits (MSB-first, matching ODA §2.1 bit order), then
/// search for the byte pattern. Returns (byte_offset, bit_offset) hits meaning
/// "the 64-bit LE f64 needle begins at bit position byte_offset*8 + bit_offset
/// in the original bit stream (MSB-first)". Accounts for BD values being
/// bit-aligned after a `BB` prefix (2 bits) at some bit offset.
fn find_all_bitshifted(haystack: &[u8], needle: &[u8]) -> Vec<(usize, usize)> {
    let mut hits = Vec::new();
    if haystack.len() < needle.len() + 1 { return hits; }
    // We search for 64-bit needle appearing at bit offset k within the byte
    // stream. MSB-first: shift haystack view *right* by k bits to align needle
    // LSB bit with byte boundary. Equivalently, construct a view where
    // view[i] = (haystack[i] << k) | (haystack[i+1] >> (8-k))
    //
    // Since RD/BD are raw 64-bit LE doubles inserted AT a bit position, and bit
    // order is MSB-first within each byte, when a double straddles byte
    // boundaries starting at bit k: byte i of the encoded double is split
    // across haystack[byte_offset+i] (low (8-k) bits) and haystack[byte_offset+i+1]
    // (high k bits). The double's byte i, with bits labelled MSB..LSB d7..d0:
    //   encoded into haystack[offset+i] low (8-k) bits = d(7-k..0)
    //   encoded into haystack[offset+i+1] high k bits  = d(7..8-k)
    // So reconstructing: view[i] = ((haystack[offset+i] << k) & 0xFF) |
    //                              (haystack[offset+i+1] >> (8-k))
    for k in 0..=7usize {
        if k == 0 {
            // Fast path
            for i in 0..=haystack.len() - needle.len() {
                if &haystack[i..i + needle.len()] == needle {
                    hits.push((i, 0));
                }
            }
        } else {
            let max = haystack.len().saturating_sub(needle.len() + 1);
            'outer: for i in 0..=max {
                for j in 0..needle.len() {
                    let v = ((haystack[i + j] << k) | (haystack[i + j + 1] >> (8 - k))) & 0xFF;
                    if v != needle[j] { continue 'outer; }
                }
                hits.push((i, k));
            }
        }
    }
    hits
}

fn dump_context(buf: &[u8], offset: usize, before: usize, after: usize) -> String {
    let s = offset.saturating_sub(before);
    let e = (offset + 8 + after).min(buf.len());
    let mut out = String::new();
    for (i, b) in buf[s..e].iter().enumerate() {
        let p = s + i;
        if p == offset { out.push_str("["); }
        out.push_str(&format!("{:02x}", b));
        if p == offset + 7 { out.push_str("]"); }
        out.push(' ');
    }
    out
}

fn main() {
    let path = std::env::args().nth(1).unwrap_or_else(|| {
        "C:/Users/rickd/Desktop/dwg_samples/3bm-trainingset/arceringen test/3070_model - Legend - M(--)01_arceringen_5.dwg".into()
    });
    let data = std::fs::read(&path).expect("read dwg");
    println!("[oracle] file={} size={}", path, data.len());

    // Prepare patterns
    let patterns: Vec<(&str, f64, [u8; 8])> = DXF_COORDS.iter()
        .map(|&(n, v)| (n, v, v.to_le_bytes()))
        .collect();

    // 1. Search the raw file first
    println!("\n=== RAW FILE SEARCH (byte-aligned) ===");
    for (name, val, pat) in &patterns {
        let hits = find_all(&data, pat);
        if !hits.is_empty() {
            println!("  {} = {} ({:02x?}) -> {} hits: {:?}",
                name, val, pat, hits.len(),
                hits.iter().map(|h| format!("0x{:X}", h)).collect::<Vec<_>>());
        } else {
            println!("  {} = {} -> NOT FOUND in raw", name, val);
        }
    }

    // 2. Decrypt the R2010-RS header, read page map, walk pages
    println!("\n=== PER-PAGE DECOMPRESSED SEARCH ===");
    let enc_hdr = match r2007::decrypt_file_header_r2010(&data) {
        Ok(h) => h,
        Err(e) => {
            eprintln!("enc_hdr error: {:?}", e);
            return;
        }
    };
    let (page_map, _page_size) = match r2007::read_page_map(&data, &enc_hdr) {
        Ok(pm) => pm,
        Err(e) => {
            eprintln!("page_map error: {:?}", e);
            return;
        }
    };
    let mut pages: Vec<(i32, usize)> = page_map.iter().map(|(&p, &o)| (p, o)).collect();
    pages.sort_by_key(|&(p, _)| p);

    for (page_num, file_off) in pages {
        if file_off + 32 > data.len() { continue; }
        // XOR-decrypt page header
        let mask = 0x4164536Bu32 ^ (file_off as u32);
        let mut hdr = [0u8; 32];
        hdr.copy_from_slice(&data[file_off..file_off + 32]);
        for dw in 0..8 {
            let o = dw * 4;
            let v = u32::from_le_bytes([hdr[o], hdr[o+1], hdr[o+2], hdr[o+3]]) ^ mask;
            hdr[o..o+4].copy_from_slice(&v.to_le_bytes());
        }
        let sec_type = i32::from_le_bytes([hdr[0], hdr[1], hdr[2], hdr[3]]);
        let sec_num  = i32::from_le_bytes([hdr[4], hdr[5], hdr[6], hdr[7]]);
        let dsize    = u32::from_le_bytes([hdr[8], hdr[9], hdr[10], hdr[11]]) as usize;
        let csize    = u32::from_le_bytes([hdr[12], hdr[13], hdr[14], hdr[15]]) as usize;

        let body_off = file_off + 32;
        if body_off + csize > data.len() { continue; }

        let compressed = sec_type == 2 || (sec_type as u32) >= 0x41000000;
        if !(sec_type == 1 || sec_type == 2 || (sec_type as u32) >= 0x41000000) {
            // Not a data page — skip
            continue;
        }

        // Try to decompress. Use dsize as target but fall back to csize*4 if needed.
        let target = dsize.max(0x7400);
        let decompressed: Vec<u8> = if compressed {
            match dwg_parser::parser::decompress_r2004(&data[body_off..body_off + csize], target) {
                Ok(d) => d,
                Err(_) => continue,
            }
        } else {
            data[body_off..body_off + dsize.min(csize)].to_vec()
        };

        // Search decompressed, bit-aligned
        let mut any_hit = false;
        for (name, val, pat) in &patterns {
            let hits = find_all_bitshifted(&decompressed, pat);
            if !hits.is_empty() {
                if !any_hit {
                    println!(" page={} sec_num={} sec_type=0x{:08X} dsize={} decomp.len()={}",
                        page_num, sec_num, sec_type as u32, dsize, decompressed.len());
                    any_hit = true;
                }
                for (bo, bi) in &hits {
                    println!("   hit {} = {} @byte 0x{:X} bit+{}: {}",
                        name, val, bo, bi, dump_context(&decompressed, *bo, 8, 8));
                }
            }
        }

        let _ = find_all;
        // Try parsing this page as an object map (HANDLES section §4.5.2).
        // Try BOTH: (1) dsize-limited valid range, and (2) full decompress buffer
        let valid = &decompressed[..dsize.min(decompressed.len())];
        try_as_object_map_named("valid", page_num, sec_num, valid);
        try_as_object_map_named("full", page_num, sec_num, &decompressed);
    }
}

fn try_as_object_map_named(tag: &str, page_num: i32, sec_num: i32, data: &[u8]) {
    let full_entries = full_decode_objmap(data);
    if full_entries > 20 {
        println!(" OBJMAP-{} page={} sec_num={} bytes={} -> {} entries",
            tag, page_num, sec_num, data.len(), full_entries);
    }
}

/// Try decoding the first few sub-sections of this buffer as a HANDLES section
/// per ODA §4.5.2: `RS section_size BE` + (hdelta uMC + ldelta sMC)* + 2-byte CRC.
/// Prints the raw first-12 bytes + 3 decoded pairs so we can visually judge.
#[allow(dead_code)]
fn try_as_object_map(page_num: i32, sec_num: i32, data: &[u8]) {
    // Also try a FULL parse, counting successful entries.
    let full_entries = full_decode_objmap(data);
    if full_entries > 20 {
        println!(" OBJMAP-FULL page={} sec_num={} bytes={} -> {} entries",
            page_num, sec_num, data.len(), full_entries);
    }
    if data.len() < 4 { return; }
    let section_size = u16::from_be_bytes([data[0], data[1]]) as usize;
    // plausible HANDLES if section_size is 2..4096 AND (2 + section_size + 2) <= data.len()
    if section_size < 4 || section_size > 4096 { return; }
    if 2 + section_size + 2 > data.len() { return; }

    // Quick MC-pair decode for the first 8 pairs
    use dwg_parser::bitreader::DwgBitReader;
    let mut last_handle = 0i32;
    let mut last_loc = 0i32;
    let mut rpos = 2;
    let body_end = (2 + section_size).min(data.len());
    let mut pairs = Vec::new();
    while rpos < body_end && pairs.len() < 8 {
        let (hd, p1) = match DwgBitReader::read_unsigned_modular_char(data, rpos) {
            Ok(v) => v, Err(_) => break,
        };
        let (ld, p2) = match DwgBitReader::read_modular_char(data, p1) {
            Ok(v) => v, Err(_) => break,
        };
        last_handle = last_handle.wrapping_add(hd as i32);
        last_loc = last_loc.wrapping_add(ld);
        pairs.push((hd, ld, last_handle, last_loc));
        rpos = p2;
    }
    if pairs.is_empty() { return; }
    // Plausibility: at least 3 consecutive pairs with small hdeltas and non-garbage locs
    let plausible = pairs.len() >= 3 &&
        pairs.iter().all(|&(hd, _, lh, ll)| (hd as i32) < 1000 && lh >= 0 && ll.abs() < 10_000_000);
    if !plausible { return; }
    print!(" OBJMAP-CANDIDATE page={} sec_num={} sec_size={} first3=",
        page_num, sec_num, section_size);
    for (hd, ld, lh, ll) in pairs.iter().take(3) {
        print!("(hd={} ld={} h=0x{:X} loc={}) ", hd, ld, lh, ll);
    }
    println!();
}

/// Do a FULL object-map parse, iterating all sub-sections per ODA §4.5.2.
/// Returns count of valid (monotonic handle, non-negative loc) entries.
fn full_decode_objmap(data: &[u8]) -> usize {
    use dwg_parser::bitreader::DwgBitReader;
    let mut count = 0usize;
    let mut pos = 0usize;
    let mut last_handle = 0i32;
    let mut last_loc = 0i32;
    while pos + 4 <= data.len() {
        let section_size = u16::from_be_bytes([data[pos], data[pos + 1]]) as usize;
        if section_size == 0 || section_size == 2 { break; }
        if section_size > 4096 || pos + 2 + section_size > data.len() { break; }
        let body_end = pos + 2 + section_size.saturating_sub(2);
        let mut rpos = pos + 2;
        let mut sec_entries = 0usize;
        while rpos < body_end {
            let (hd, p1) = match DwgBitReader::read_unsigned_modular_char(data, rpos) {
                Ok(v) => v, Err(_) => break,
            };
            let (ld, p2) = match DwgBitReader::read_modular_char(data, p1) {
                Ok(v) => v, Err(_) => break,
            };
            last_handle = last_handle.wrapping_add(hd as i32);
            last_loc = last_loc.wrapping_add(ld);
            if last_handle > 0 && last_loc >= 0 && (hd as i32) < 10000 {
                count += 1;
                sec_entries += 1;
            }
            rpos = p2;
        }
        if sec_entries == 0 { break; }
        pos += 2 + section_size;
    }
    count
}
