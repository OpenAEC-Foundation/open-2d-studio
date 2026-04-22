//! Locate the REAL HANDLES sub-section bytes per ODA §4.5.2.
//!
//! Scoring:
//!   - ≥20 valid (hdelta uMC, ldelta sMC) pairs;
//!   - hdelta < 0x100; ldelta ∈ [-4096, 4096];
//!   - running handle non-negative; running loc non-negative;
//!   - running loc max > 10_000 (real OBJECTS span is 267_264 — if max_loc
//!     stays at 0..100 we're looking at degenerate metadata, not HANDLES);
//!   - at least 20 DISTINCT ldelta values (rejects "ld=0" stuck sequences).
//!
//! Citations:
//!   - ODA §4.5.2 Handle Map — RS-BE section_size + (hdelta uMC, loc-delta sMC) pairs + 2-byte CRC.
//!   - ODA §2 — MC/RS bit primitives.
//!   - ODA §4.6 — data-page XOR header (mask = 0x4164536B ^ file_offset, per-DWORD).
//!   - ODA §4.7 — LZ77.

use dwg_parser::{bitreader::DwgBitReader, parser::decompress_r2004, r2007};
use std::collections::HashSet;

#[derive(Clone)]
struct Candidate {
    sec_num: i32,
    page_num: i32,
    byte_off: usize,
    sub_size: usize,
    pairs_ok: usize,
    distinct_ld: usize,
    max_loc: i32,
    sum_hdelta: i64,
    first_pairs: Vec<(u32, i32, i32, i32)>, // (hd, ld, running_handle, running_loc)
}

fn main() {
    let path = std::env::args().nth(1).unwrap_or_else(|| {
        "C:/Users/rickd/Desktop/dwg_samples/3bm-trainingset/arceringen test/3070_model - Legend - M(--)01_arceringen_5.dwg".into()
    });
    let data = std::fs::read(&path).expect("read dwg");
    let enc_hdr = r2007::decrypt_file_header_r2010(&data).expect("decrypt");
    let (page_map, _page_size) = r2007::read_page_map(&data, &enc_hdr).expect("pm");

    let mut sorted: Vec<(i32, usize)> = page_map.iter().map(|(&p, &o)| (p, o)).collect();
    sorted.sort_by_key(|x| x.1);

    let mut candidates: Vec<Candidate> = Vec::new();
    let mut sn4_candidates: Vec<Candidate> = Vec::new();
    let mut non_obj_any: Vec<Candidate> = Vec::new(); // any non-sn=7 candidate with ≥5 pairs

    // Also collect all pages with their metadata for later pretty-printing.
    let mut page_meta: Vec<(i32, i32, i32, usize, usize)> = Vec::new(); // (page_num, sec_type, sec_num, comp, decomp)

    for (page_num, file_off) in &sorted {
        if file_off + 32 > data.len() {
            continue;
        }
        // XOR-decrypt the 32-byte page header per §4.6
        let mask = 0x4164536Bu32 ^ (*file_off as u32);
        let mut hdr = [0u8; 32];
        hdr.copy_from_slice(&data[*file_off..file_off + 32]);
        for dw in 0..8 {
            let o = dw * 4;
            let v = u32::from_le_bytes([hdr[o], hdr[o + 1], hdr[o + 2], hdr[o + 3]]) ^ mask;
            hdr[o..o + 4].copy_from_slice(&v.to_le_bytes());
        }
        let sec_type = i32::from_le_bytes([hdr[0], hdr[1], hdr[2], hdr[3]]);
        let sec_num = i32::from_le_bytes([hdr[4], hdr[5], hdr[6], hdr[7]]);
        let comp = u32::from_le_bytes([hdr[8], hdr[9], hdr[10], hdr[11]]) as usize;
        let decomp_sz = u32::from_le_bytes([hdr[12], hdr[13], hdr[14], hdr[15]]) as usize;

        // Only data pages
        let is_data = sec_type == 1 || sec_type == 2 || (sec_type as u32) >= 0x41000000;
        if !is_data {
            continue;
        }
        if *file_off + 32 + comp > data.len() || comp == 0 {
            continue;
        }

        let body = &data[*file_off + 32..*file_off + 32 + comp];
        let full = match decompress_r2004(body, 0x7400) {
            Ok(b) => b,
            Err(_) => continue,
        };
        if full.is_empty() {
            continue;
        }
        page_meta.push((*page_num, sec_type, sec_num, comp, decomp_sz));

        let buf = &full[..];

        let step_limit = buf.len().saturating_sub(4);
        for off in 0..step_limit {
            let sub_size = u16::from_be_bytes([buf[off], buf[off + 1]]) as usize;
            if sub_size < 16 || sub_size > 4096 {
                continue;
            }
            if off + 2 + sub_size > buf.len() {
                continue;
            }
            let body_end = off + 2 + sub_size.saturating_sub(2);
            let mut rpos = off + 2;
            let mut last_handle: i32 = 0;
            let mut last_loc: i32 = 0;
            let mut pairs_ok = 0usize;
            let mut first_pairs: Vec<(u32, i32, i32, i32)> = Vec::new();
            let mut sum_hd: i64 = 0;
            let mut max_loc: i32 = 0;
            let mut distinct_ld: HashSet<i32> = HashSet::new();
            while rpos < body_end {
                let (hd, p1) = match DwgBitReader::read_unsigned_modular_char(buf, rpos) {
                    Ok(v) => v,
                    Err(_) => break,
                };
                let (ld, p2) = match DwgBitReader::read_modular_char(buf, p1) {
                    Ok(v) => v,
                    Err(_) => break,
                };
                if hd >= 0x100 {
                    break;
                }
                if ld.abs() >= 4096 {
                    break;
                }
                last_handle = last_handle.wrapping_add(hd as i32);
                last_loc = last_loc.wrapping_add(ld);
                if last_handle < 0 || last_loc < 0 || last_loc > 350_000 {
                    break;
                }
                if first_pairs.len() < 8 {
                    first_pairs.push((hd, ld, last_handle, last_loc));
                }
                sum_hd += hd as i64;
                if last_loc > max_loc {
                    max_loc = last_loc;
                }
                distinct_ld.insert(ld);
                pairs_ok += 1;
                rpos = p2;
                if pairs_ok >= 3000 {
                    break;
                }
            }
            // Reject degenerate chains: we need a broad ldelta vocabulary.
            // Require ≥ 20 pairs, ≥ 8 distinct ldeltas, max_loc > 500, AND at
            // least 2 ldeltas ≥ 50 (real object envelopes typically ≥ ~80B apart).
            let big_ld_count = distinct_ld.iter().filter(|&&v| v >= 50).count();
            if pairs_ok >= 20 && distinct_ld.len() >= 8 && max_loc > 500 && big_ld_count >= 2 {
                candidates.push(Candidate {
                    sec_num,
                    page_num: *page_num,
                    byte_off: off,
                    sub_size,
                    pairs_ok,
                    distinct_ld: distinct_ld.len(),
                    max_loc,
                    sum_hdelta: sum_hd,
                    first_pairs: first_pairs.clone(),
                });
            }
            // Track EVERY sn=4 candidate with >=5 pairs, no filter
            if sec_num == 4 && pairs_ok >= 5 {
                sn4_candidates.push(Candidate {
                    sec_num,
                    page_num: *page_num,
                    byte_off: off,
                    sub_size,
                    pairs_ok,
                    distinct_ld: distinct_ld.len(),
                    max_loc,
                    sum_hdelta: sum_hd,
                    first_pairs: first_pairs.clone(),
                });
            }
            if sec_num != 7 && pairs_ok >= 10 {
                non_obj_any.push(Candidate {
                    sec_num,
                    page_num: *page_num,
                    byte_off: off,
                    sub_size,
                    pairs_ok,
                    distinct_ld: distinct_ld.len(),
                    max_loc,
                    sum_hdelta: sum_hd,
                    first_pairs,
                });
            }
        }
    }

    // Rank: larger max_loc first (must span full OBJECTS), then pairs_ok.
    candidates.sort_by(|a, b| {
        b.max_loc
            .cmp(&a.max_loc)
            .then_with(|| b.pairs_ok.cmp(&a.pairs_ok))
            .then_with(|| b.distinct_ld.cmp(&a.distinct_ld))
    });

    // Detailed decompression stats for each page
    println!("=== full-decompress sizes ===");
    for (pn, fo) in &sorted {
        if fo + 32 > data.len() { continue; }
        let mask = 0x4164536Bu32 ^ (*fo as u32);
        let mut hdr = [0u8; 32];
        hdr.copy_from_slice(&data[*fo..*fo + 32]);
        for dw in 0..8 {
            let o = dw * 4;
            let v = u32::from_le_bytes([hdr[o], hdr[o+1], hdr[o+2], hdr[o+3]]) ^ mask;
            hdr[o..o+4].copy_from_slice(&v.to_le_bytes());
        }
        let st = i32::from_le_bytes([hdr[0], hdr[1], hdr[2], hdr[3]]);
        let sn = i32::from_le_bytes([hdr[4], hdr[5], hdr[6], hdr[7]]);
        let comp = u32::from_le_bytes([hdr[8], hdr[9], hdr[10], hdr[11]]) as usize;
        let decomp_hdr = u32::from_le_bytes([hdr[12], hdr[13], hdr[14], hdr[15]]) as usize;
        if (st == 1 || st == 2 || (st as u32) >= 0x41000000) && comp > 0 && *fo + 32 + comp <= data.len() {
            if let Ok(d) = decompress_r2004(&data[*fo+32..*fo+32+comp], 0x7400) {
                println!("  page={} sn={} comp={} decomp_hdr={} full_lz77={}", pn, sn, comp, decomp_hdr, d.len());
            }
        }
    }

    println!("=== pages scanned ===");
    for (pn, st, sn, c, d) in &page_meta {
        println!(
            "  page={:>3} sec_type=0x{:08X} sec_num={:>3} comp={:>5} decomp_hdr={:>5}",
            pn, *st as u32, sn, c, d
        );
    }

    // Special trace: sn=4 page=16, try running THE DECLARED sub-section
    // (RS=0x07F1=2033 at off=0) past the 1856-valid boundary — LZ77 extended
    // bytes from 1856..29696 may still contain real data.
    println!("\n=== sn=4 page=16 raw hex dump + full-chain walk ===");
    let sn4_file_off = page_map[&16];
    let mask4 = 0x4164536Bu32 ^ (sn4_file_off as u32);
    let mut hdr4 = [0u8; 32];
    hdr4.copy_from_slice(&data[sn4_file_off..sn4_file_off + 32]);
    for dw in 0..8 {
        let o = dw * 4;
        let v = u32::from_le_bytes([hdr4[o], hdr4[o+1], hdr4[o+2], hdr4[o+3]]) ^ mask4;
        hdr4[o..o+4].copy_from_slice(&v.to_le_bytes());
    }
    let comp4 = u32::from_le_bytes([hdr4[8], hdr4[9], hdr4[10], hdr4[11]]) as usize;
    let full4 = decompress_r2004(&data[sn4_file_off+32..sn4_file_off+32+comp4], 0x7400).unwrap();
    println!("  full lz77 output: {} bytes", full4.len());
    // First 48 bytes
    print!("  bytes[0..48]:");
    for i in 0..48 { print!(" {:02X}", full4[i]); }
    println!();
    // Bytes at 1850..1870 (boundary)
    print!("  bytes[1850..1890]:");
    for i in 1850..1890.min(full4.len()) { print!(" {:02X}", full4[i]); }
    println!();
    // Parse starting at off=0 with sub_size=2033, walk as far as possible
    let sub_size0 = u16::from_be_bytes([full4[0], full4[1]]) as usize;
    println!("  first sub_size = {} (0x{:04X})", sub_size0, sub_size0);
    let mut rpos = 2usize;
    let stop = (2 + sub_size0 - 2).min(full4.len());
    let mut last_h = 0i32;
    let mut last_l = 0i32;
    let mut pairs = Vec::<(i32, i32, i32, i32)>::new();
    while rpos < stop {
        let (hd, p1) = match DwgBitReader::read_unsigned_modular_char(&full4, rpos) { Ok(v) => v, Err(_) => break };
        let (ld, p2) = match DwgBitReader::read_modular_char(&full4, p1) { Ok(v) => v, Err(_) => break };
        last_h = last_h.wrapping_add(hd as i32);
        last_l = last_l.wrapping_add(ld);
        pairs.push((hd as i32, ld, last_h, last_l));
        rpos = p2;
        if pairs.len() > 2000 { break; }
    }
    println!("  decoded {} pairs total before stop at rpos={}", pairs.len(), rpos);
    println!("  max running_handle={}, max running_loc={}", pairs.iter().map(|x| x.2).max().unwrap_or(0), pairs.iter().map(|x| x.3).max().unwrap_or(0));
    println!("  last 10 pairs:");
    let start = pairs.len().saturating_sub(10);
    for (i, p) in pairs.iter().enumerate().skip(start) {
        println!("    [{}] hd={} ld={} run_h=0x{:X} run_loc={}", i, p.0, p.1, p.2, p.3);
    }
    let big_ld = pairs.iter().filter(|(_,_,_,l)| *l > 500).count();
    let max_ld = pairs.iter().map(|(_, ld, _, _)| ld.abs()).max().unwrap_or(0);
    println!("  #pairs with run_loc>500: {}, max |ld|={}", big_ld, max_ld);

    // After this first sub-section ends at 2+2033=2035, what follows? §4.5.2
    // says sub-sections concatenate; terminator is a sub-section with
    // section_size=0 (or = 2 = empty+CRC).
    println!("\n=== sub-section chain walk (§4.5.2 concatenation) ===");
    let mut pos = 0usize;
    let mut total_entries = 0usize;
    let mut ss_idx = 0;
    let mut chain_last_h = 0i32;
    let mut chain_last_l = 0i32;
    let mut all_entries: Vec<(i32, i32)> = Vec::new();
    while pos + 4 <= full4.len() && ss_idx < 20 {
        let sz = u16::from_be_bytes([full4[pos], full4[pos+1]]) as usize;
        if sz == 0 || sz == 2 {
            println!("  subsection[{}] at pos={} size=0 -> section end", ss_idx, pos);
            break;
        }
        if sz > 4096 || pos + 2 + sz > full4.len() {
            println!("  subsection[{}] at pos={} size={} -> invalid size, stop", ss_idx, pos, sz);
            break;
        }
        let body_end = pos + 2 + sz - 2;
        let mut rpos = pos + 2;
        let mut n_ok = 0usize;
        while rpos < body_end {
            let (hd, p1) = match DwgBitReader::read_unsigned_modular_char(&full4, rpos) { Ok(v) => v, Err(_) => break };
            let (ld, p2) = match DwgBitReader::read_modular_char(&full4, p1) { Ok(v) => v, Err(_) => break };
            chain_last_h = chain_last_h.wrapping_add(hd as i32);
            chain_last_l = chain_last_l.wrapping_add(ld);
            all_entries.push((chain_last_h, chain_last_l));
            n_ok += 1;
            rpos = p2;
        }
        total_entries += n_ok;
        println!("  subsection[{}] at pos={} size={} -> {} entries (cumulative {}), cur_h=0x{:X} cur_loc={}",
            ss_idx, pos, sz, n_ok, total_entries, chain_last_h, chain_last_l);
        pos += 2 + sz;
        ss_idx += 1;
    }
    println!("  TOTAL entries in chain: {}", total_entries);
    let in_range = all_entries.iter().filter(|(_, l)| *l >= 0 && *l < 240_000).count();
    println!("  in-range (0..240000): {}", in_range);

    // Cross-check: pin LINE_3BB_ex = 2593.526172879812 found bit-shifted at
    // byte 0x1CCE (=7374) in OBJECTS. Expected handle 0x3BB. Find the pair
    // with running_handle = 0x3BB.
    let pin_h = 0x3BBi32;
    if let Some((i, p)) = pairs.iter().enumerate().find(|(_, p)| p.2 == pin_h) {
        println!("  PIN: pair[{}] handle=0x{:X} loc={} (DXF LINE handle 0x3BB)", i, p.2, p.3);
        println!("  context (5 pairs around):");
        for j in i.saturating_sub(2)..=(i+3).min(pairs.len()-1) {
            let p = &pairs[j];
            println!("    [{}] hd={} ld={} run_h=0x{:X} run_loc={}", j, p.0, p.1, p.2, p.3);
        }
    } else {
        println!("  PIN: handle 0x3BB NOT in decoded chain");
        // Find nearest
        let nearest = pairs.iter().enumerate()
            .min_by_key(|(_, p)| (p.2 - pin_h).abs())
            .map(|(i, p)| (i, *p));
        if let Some((i, p)) = nearest {
            println!("  PIN: nearest is pair[{}] handle=0x{:X} loc={}", i, p.2, p.3);
        }
    }

    // sn=4 is the DECLARED HANDLES section (1856 valid bytes). Dump every
    // candidate within it, regardless of the strict filter.
    sn4_candidates.sort_by(|a, b| b.pairs_ok.cmp(&a.pairs_ok).then_with(|| b.max_loc.cmp(&a.max_loc)));
    println!("\n=== sn=4 (declared HANDLES) candidates with pairs_ok>=5 ===");
    println!("total sn4 candidates: {}", sn4_candidates.len());
    // Only show those within the 1856 valid region
    let sn4_valid: Vec<&Candidate> = sn4_candidates.iter().filter(|c| c.byte_off < 1856).collect();
    println!("  within valid 1856 bytes: {}", sn4_valid.len());
    for (i, c) in sn4_valid.iter().take(30).enumerate() {
        println!(
            "  #{:>2} off=0x{:04X} sub_size={} pairs_ok={} distinct_ld={} max_loc={} sum_hd={}",
            i + 1, c.byte_off, c.sub_size, c.pairs_ok, c.distinct_ld, c.max_loc, c.sum_hdelta
        );
        for (j, (hd, ld, lh, ll)) in c.first_pairs.iter().take(4).enumerate() {
            println!("       pair[{}] hd={:>4} ld={:>6} run_h=0x{:04X} run_loc={}", j, hd, ld, lh, ll);
        }
    }

    // Top non-sn=7 candidates with weaker threshold (≥10 pairs)
    non_obj_any.sort_by(|a, b| b.pairs_ok.cmp(&a.pairs_ok).then_with(|| b.max_loc.cmp(&a.max_loc)));
    println!("\n=== Top non-sn=7 candidates (pairs_ok>=10) === total={}", non_obj_any.len());
    for (i, c) in non_obj_any.iter().take(15).enumerate() {
        println!(
            "  #{:>2} sn={} page={} off=0x{:05X} sub_size={} pairs_ok={} distinct_ld={} max_loc={}",
            i + 1, c.sec_num, c.page_num, c.byte_off, c.sub_size, c.pairs_ok, c.distinct_ld, c.max_loc
        );
        for (j, (hd, ld, lh, ll)) in c.first_pairs.iter().take(4).enumerate() {
            println!("       pair[{}] hd={:>4} ld={:>6} run_h=0x{:04X} run_loc={}", j, hd, ld, lh, ll);
        }
    }

    // Also build a view excluding sec_num=7 (the OBJECTS section itself cannot
    // host the HANDLES sub-section).
    let non_obj: Vec<&Candidate> = candidates.iter().filter(|c| c.sec_num != 7).collect();

    println!(
        "\n=== Top HANDLES candidates EXCLUDING sec_num=7 (OBJECTS) ===  total_non_obj={}",
        non_obj.len()
    );
    for (i, c) in non_obj.iter().take(20).enumerate() {
        println!(
            "#{:>2} sn={} page={} byte_off=0x{:05X} sub_size={} pairs_ok={} distinct_ld={} sum_hdelta={} max_loc={}",
            i + 1, c.sec_num, c.page_num, c.byte_off, c.sub_size, c.pairs_ok, c.distinct_ld, c.sum_hdelta, c.max_loc
        );
        for (j, (hd, ld, lh, ll)) in c.first_pairs.iter().take(6).enumerate() {
            println!(
                "     pair[{}] hd={:>4} ld={:>6} running_h=0x{:04X} running_loc={}",
                j, hd, ld, lh, ll
            );
        }
    }

    println!(
        "\n=== Top HANDLES candidates (≥20 pairs, ≥10 distinct ldeltas, max_loc > 1k) ===  total={}",
        candidates.len()
    );
    for (i, c) in candidates.iter().take(10).enumerate() {
        println!(
            "#{:>2} sn={} page={} byte_off=0x{:05X} sub_size={} pairs_ok={} distinct_ld={} sum_hdelta={} max_loc={}",
            i + 1,
            c.sec_num,
            c.page_num,
            c.byte_off,
            c.sub_size,
            c.pairs_ok,
            c.distinct_ld,
            c.sum_hdelta,
            c.max_loc
        );
        for (j, (hd, ld, lh, ll)) in c.first_pairs.iter().take(6).enumerate() {
            println!(
                "     pair[{}] hd={:>4} ld={:>6} running_h=0x{:04X} running_loc={}",
                j, hd, ld, lh, ll
            );
        }
    }

    // ---------------- Plaintext-pin ----------------
    // The caller's §21/§22 diagnosed the OBJECTS buffer is assembled in
    // sec_num=7 by the parser. Reconstruct it HERE in this example without
    // depending on the library's assemble_section (which gates XOR behind
    // version_code >= "AC1027" and thus fails for AC1024 files).
    println!("\n=== Assemble OBJECTS (sec_num=7) via XOR-aware path ===");
    let objects = assemble_xor(&data, &sorted, 7);
    println!("OBJECTS assembled: {} bytes", objects.len());

    // Pins from prior session's plaintext_search:
    let pins: &[(&str, f64)] = &[
        ("LINE_3BB_sx", 2789.526172879812),
        ("LINE_3BB_sy", 1060.204143620976),
        ("LINE_3BB_ex", 2593.526172879812),
    ];
    for (name, val) in pins {
        let pat = val.to_le_bytes();
        let mut hits: Vec<usize> = Vec::new();
        if objects.len() >= pat.len() {
            for i in 0..=objects.len() - pat.len() {
                if &objects[i..i + pat.len()] == pat {
                    hits.push(i);
                }
            }
        }
        if !hits.is_empty() {
            println!(
                "  pin {} = {} -> byte-aligned hits at {:?}",
                name,
                val,
                hits.iter().map(|h| format!("0x{:X}", h)).collect::<Vec<_>>()
            );
        } else {
            println!("  pin {} = {} -> NOT FOUND byte-aligned", name, val);
        }
    }

    // For the top 3 candidates, replay FULL chain and:
    //  - collect (handle, loc) list for the whole HANDLES section
    //  - for the earliest pin hit, find the (handle, loc) entry whose `loc`
    //    is closest (the object envelope's handle/MS-size/whatever precedes
    //    the coordinate bytes — we expect `loc` ≤ pin_off, with pin_off - loc
    //    falling within a typical LINE envelope size of ~120-200 bytes).
    // Also try bit-shifted search for the pin (BD values are bit-aligned).
    let first_pin_hit = find_pin_hit(&objects, &pins[0].1.to_le_bytes());
    println!("  bit-shifted pin #0 result: {:?}", first_pin_hit);
    for (n, v) in pins {
        let r = find_pin_hit(&objects, &v.to_le_bytes());
        println!("  bit-shifted pin {}={} result: {:?}", n, v, r);
    }
    println!("\n=== Pin->candidate cross-check ===");
    if let Some(pin_off) = first_pin_hit {
        println!("First LINE pin byte_offset in OBJECTS = {} (0x{:X})", pin_off, pin_off);
        for (ci, c) in candidates.iter().take(5).enumerate() {
            let full = replay_candidate(&data, &page_map, c);
            if let Some((h, l)) = full
                .iter()
                .filter(|(_, l)| *l <= pin_off && pin_off - l < 400)
                .min_by_key(|(_, l)| pin_off - *l)
                .cloned()
            {
                println!(
                    "  #{}: sn={} off=0x{:05X}: nearest loc <= pin is {} (gap={} bytes) handle=0x{:X}  ({} total entries)",
                    ci + 1,
                    c.sec_num,
                    c.byte_off,
                    l,
                    pin_off - l,
                    h,
                    full.len()
                );
            } else {
                println!("  #{}: sn={} off=0x{:05X}: no entry within 400 bytes of pin  ({} total entries)",
                    ci + 1, c.sec_num, c.byte_off, full.len());
            }
        }
    } else {
        println!("No plaintext pin hit in OBJECTS — cannot cross-check");
    }
}

/// Locate 8-byte needle byte-aligned OR bit-shifted in haystack.
/// Returns the byte-offset (bit-offset is not needed; 1-byte resolution is fine
/// for "which object envelope does this belong to").
fn find_pin_hit(haystack: &[u8], needle: &[u8]) -> Option<i32> {
    if haystack.len() < needle.len() + 1 {
        return None;
    }
    for k in 0..=7usize {
        if k == 0 {
            for i in 0..=haystack.len() - needle.len() {
                if &haystack[i..i + needle.len()] == needle {
                    return Some(i as i32);
                }
            }
        } else {
            let max = haystack.len().saturating_sub(needle.len() + 1);
            'outer: for i in 0..=max {
                for j in 0..needle.len() {
                    let v = ((haystack[i + j] << k) | (haystack[i + j + 1] >> (8 - k))) & 0xFF;
                    if v != needle[j] {
                        continue 'outer;
                    }
                }
                return Some(i as i32);
            }
        }
    }
    None
}

fn assemble_xor(data: &[u8], sorted: &[(i32, usize)], target_sn: i32) -> Vec<u8> {
    // Build same way as r2007::assemble_section but force the XOR header path
    // regardless of version — the fixture is AC1024 and the lib gates XOR on
    // AC1027+, which blocks us. Per ODA §4.6 the XOR header is valid on R2010.
    struct PI {
        file_off: usize,
        comp: usize,
        decomp: usize,
        start: usize,
    }
    let mut pages = Vec::new();
    let mut total = 0usize;
    for (_pn, fo) in sorted {
        if fo + 32 > data.len() {
            continue;
        }
        let mask = 0x4164536Bu32 ^ (*fo as u32);
        let mut hdr = [0u8; 32];
        hdr.copy_from_slice(&data[*fo..*fo + 32]);
        for dw in 0..8 {
            let o = dw * 4;
            let v = u32::from_le_bytes([hdr[o], hdr[o + 1], hdr[o + 2], hdr[o + 3]]) ^ mask;
            hdr[o..o + 4].copy_from_slice(&v.to_le_bytes());
        }
        let st = i32::from_le_bytes([hdr[0], hdr[1], hdr[2], hdr[3]]);
        let sn = i32::from_le_bytes([hdr[4], hdr[5], hdr[6], hdr[7]]);
        let comp = u32::from_le_bytes([hdr[8], hdr[9], hdr[10], hdr[11]]) as usize;
        let decomp = u32::from_le_bytes([hdr[12], hdr[13], hdr[14], hdr[15]]) as usize;
        let so = u32::from_le_bytes([hdr[16], hdr[17], hdr[18], hdr[19]]) as usize;
        let is_data = st == 1 || st == 2 || (st as u32) >= 0x41000000;
        if !is_data || sn != target_sn {
            continue;
        }
        if *fo + 32 + comp > data.len() {
            continue;
        }
        pages.push(PI {
            file_off: *fo,
            comp,
            decomp,
            start: so,
        });
        total = total.max(so + decomp);
    }
    let mut out = vec![0u8; total];
    for p in &pages {
        let body = &data[p.file_off + 32..p.file_off + 32 + p.comp];
        if let Ok(d) = decompress_r2004(body, 0x7400) {
            let take = d.len().min(p.decomp).min(out.len() - p.start);
            out[p.start..p.start + take].copy_from_slice(&d[..take]);
        }
    }
    out
}

fn replay_candidate(data: &[u8], page_map: &std::collections::HashMap<i32, usize>, c: &Candidate) -> Vec<(i32, i32)> {
    let file_off = match page_map.get(&c.page_num) {
        Some(&o) => o,
        None => return Vec::new(),
    };
    if file_off + 32 > data.len() {
        return Vec::new();
    }
    let mask = 0x4164536Bu32 ^ (file_off as u32);
    let mut hdr = [0u8; 32];
    hdr.copy_from_slice(&data[file_off..file_off + 32]);
    for dw in 0..8 {
        let o = dw * 4;
        let v = u32::from_le_bytes([hdr[o], hdr[o + 1], hdr[o + 2], hdr[o + 3]]) ^ mask;
        hdr[o..o + 4].copy_from_slice(&v.to_le_bytes());
    }
    let comp = u32::from_le_bytes([hdr[8], hdr[9], hdr[10], hdr[11]]) as usize;
    if file_off + 32 + comp > data.len() {
        return Vec::new();
    }
    let full = match decompress_r2004(&data[file_off + 32..file_off + 32 + comp], 0x7400) {
        Ok(b) => b,
        Err(_) => return Vec::new(),
    };
    let buf = &full[..];
    let body_end = (c.byte_off + 2 + c.sub_size.saturating_sub(2)).min(buf.len());
    let mut rpos = c.byte_off + 2;
    let mut last_handle: i32 = 0;
    let mut last_loc: i32 = 0;
    let mut out = Vec::new();
    while rpos < body_end {
        let (hd, p1) = match DwgBitReader::read_unsigned_modular_char(buf, rpos) {
            Ok(v) => v,
            Err(_) => break,
        };
        let (ld, p2) = match DwgBitReader::read_modular_char(buf, p1) {
            Ok(v) => v,
            Err(_) => break,
        };
        if hd >= 0x100 || ld.abs() >= 4096 {
            break;
        }
        last_handle = last_handle.wrapping_add(hd as i32);
        last_loc = last_loc.wrapping_add(ld);
        if last_handle < 0 || last_loc < 0 {
            break;
        }
        out.push((last_handle, last_loc));
        rpos = p2;
        if out.len() > 5000 {
            break;
        }
    }
    out
}
