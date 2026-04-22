//! lz77_variants — focused analysis of section-map body preprocessing.
//!
//! After brute-force scanning, we found that decompressing from 0xC813
//! produces section type hashes. This binary does a focused analysis.

use std::io::Read;
use dwg_parser::parser::decompress_r2004;

const RS_DATA_BYTES: usize = 239;
const RS_SECTOR_SIZE: usize = 255;

fn strip_rs(encoded: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(encoded.len());
    let mut pos = 0;
    while pos < encoded.len() {
        let remain = encoded.len() - pos;
        if remain >= RS_SECTOR_SIZE {
            out.extend_from_slice(&encoded[pos..pos + RS_DATA_BYTES]);
            pos += RS_SECTOR_SIZE;
        } else if remain > RS_SECTOR_SIZE - RS_DATA_BYTES {
            let data_len = remain.saturating_sub(RS_SECTOR_SIZE - RS_DATA_BYTES);
            out.extend_from_slice(&encoded[pos..pos + data_len]);
            break;
        } else {
            out.extend_from_slice(&encoded[pos..]);
            break;
        }
    }
    out
}

fn find_section_names(data: &[u8]) -> Vec<String> {
    let mut found = Vec::new();
    let text = String::from_utf8_lossy(data);
    let names = ["AcDb:Header", "AcDb:Handles", "AcDb:AcDbObjects",
        "AcDb:Classes", "AcDb:SummaryInfo", "AcDb:ObjFreeSpace",
        "AcDb:Template", "AcDb:FileDepList", "AcDb:AuxHeader",
        "AcDb:Preview", "AcDb:RevHistory", "AcDb:AppInfo",
        "AcDb:AppInfoHistory", "AcDb:Security"];
    for name in &names {
        if text.contains(name) { found.push(name.to_string()); }
    }
    found
}

fn find_hashes(data: &[u8]) -> Vec<(usize, u32, &'static str)> {
    let mut found = Vec::new();
    let hashes: &[(u32, &str)] = &[
        (0x4163003b, "Header"), (0x4163003c, "Classes"), (0x4163003d, "ObjFreeSpace"),
        (0x4163003e, "Template"), (0x4163003f, "Handles"), (0x41630040, "Objects"),
        (0x41630E3B, "SystemSection"),
    ];
    for i in 0..data.len().saturating_sub(3) {
        let val = u32::from_le_bytes([data[i], data[i+1], data[i+2], data[i+3]]);
        for &(hash, name) in hashes {
            if val == hash { found.push((i, hash, name)); }
        }
    }
    found
}

fn le_u32(d: &[u8], o: usize) -> u32 { u32::from_le_bytes([d[o], d[o+1], d[o+2], d[o+3]]) }

fn dump_hex(data: &[u8], label: &str, max: usize) {
    let n = data.len().min(max);
    for row in 0..(n + 15) / 16 {
        let s = row * 16;
        let e = (s + 16).min(n);
        let hex: String = data[s..e].iter().map(|b| format!("{:02x}", b)).collect::<Vec<_>>().join(" ");
        let ascii: String = data[s..e].iter()
            .map(|&b| if b >= 0x20 && b < 0x7F { b as char } else { '.' })
            .collect();
        println!("  {} +{:04X}: {}  {}", label, s, hex, ascii);
    }
}

fn main() -> anyhow::Result<()> {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let path = args.first().cloned().unwrap_or_else(||
        r"C:\Users\rickd\Desktop\dwg_samples\arc_2010.dwg".to_string());

    println!("=== LZ77 Variant Tester — Focused Analysis ===");
    println!("File: {}\n", path);

    let mut file = std::fs::File::open(&path)?;
    let mut data = Vec::new();
    file.read_to_end(&mut data)?;
    println!("File size: {} (0x{:X})", data.len(), data.len());

    // ================================================================
    // PART 1: Analyze the region around 0xC580-0xC8DD where hashes live
    // ================================================================
    println!("\n--- PART 1: Raw file region 0xC500..0xC95D ---");
    let region_start = 0xC500;
    let region_end = data.len().min(0xC95D);
    dump_hex(&data[region_start..region_end], &format!("@0x{:X}", region_start), region_end - region_start);

    // Find hashes in raw file
    println!("\n--- PART 2: Section hashes in raw file ---");
    let raw_hashes = find_hashes(&data);
    for (off, hash, name) in &raw_hashes {
        println!("  0x{:08X} ({}) @ file offset 0x{:X}", hash, name, off);
    }

    // Find AcDb: strings in raw file
    println!("\n--- PART 3: AcDb: strings in raw file ---");
    let needle = b"AcDb:";
    for i in 0..data.len().saturating_sub(needle.len()) {
        if &data[i..i + needle.len()] == needle {
            let end = (i + 60).min(data.len());
            let s: String = data[i..end].iter()
                .take_while(|&&b| b != 0)
                .map(|&b| if b >= 0x20 && b < 0x7F { b as char } else { '.' })
                .collect();
            println!("  @ 0x{:X}: {}", i, s);
        }
    }

    // ================================================================
    // PART 4: The section map is NOT compressed — it's raw in the file!
    // ================================================================
    // The hash 0x4163003b (Header) at 0xC580 suggests the section map
    // is stored uncompressed (or RS-encoded) in the file. Let me check.
    println!("\n--- PART 4: Section map at 0xC580? ---");
    // Per ODA, the R2004 section map entry format is:
    //   +0: num_pages (RL)
    //   +4: max_decomp_size (RL)
    //   +8: unknown (RL)
    //   +12: compressed (RL)
    //   +16: section_type hash (RL) — e.g., 0x4163003b
    //   +20: encrypted (RL)
    //   +24: name (64 bytes, null-terminated)
    //   +88: num_page_entries (RL)
    //   +92: page entries
    //
    // But the section map is itself stored inside a section, so we need
    // to find which page contains it.

    // Check: maybe the section map data starts at some earlier offset
    // and runs through the hash at 0xC580. Let's check 20 bytes before.
    let sm_check_start = 0xC580 - 16;
    if sm_check_start + 128 <= data.len() {
        println!("  Context around 0xC580 (hash @+16):");
        dump_hex(&data[sm_check_start..sm_check_start + 128], &format!("@0x{:X}", sm_check_start), 128);
    }

    // Per ODA format: if hash is at +16 (offset 0xC580 = +16 from section map entry start),
    // then the entry starts at 0xC570.
    let entry_start = 0xC580 - 16;
    if entry_start + 92 <= data.len() {
        println!("\n  Section map entry interpretation (start=0x{:X}):", entry_start);
        println!("    num_pages: {}", le_u32(&data, entry_start));
        println!("    max_decomp: {}", le_u32(&data, entry_start + 4));
        println!("    unknown: {}", le_u32(&data, entry_start + 8));
        println!("    compressed: {}", le_u32(&data, entry_start + 12));
        println!("    section_type: 0x{:08X}", le_u32(&data, entry_start + 16));
        println!("    encrypted: {}", le_u32(&data, entry_start + 20));
        let name_start = entry_start + 24;
        let name: String = data[name_start..name_start+64].iter()
            .take_while(|&&b| b != 0)
            .map(|&b| if b >= 0x20 && b < 0x7F { b as char } else { '.' })
            .collect();
        println!("    name: '{}'", name);
        let page_count = le_u32(&data, entry_start + 88) as usize;
        println!("    page_count: {}", page_count);
    }

    // ================================================================
    // PART 5: Try RS-stripping the region and look for section map
    // ================================================================
    println!("\n--- PART 5: RS-strip the section map region ---");
    // The section map might be RS-encoded starting from some offset
    // Try stripping from various starting points
    for &start in &[0xC500, 0xC550, 0xC560, 0xC570, 0xC580, 0xC5B0, 0xC600] {
        if start >= data.len() { continue; }
        let raw = &data[start..data.len().min(start + 1024)];
        let stripped = strip_rs(raw);
        let names = find_section_names(&stripped);
        let hashes = find_hashes(&stripped);
        if !names.is_empty() || !hashes.is_empty() {
            println!("  RS-strip from 0x{:X}:", start);
            if !names.is_empty() { println!("    names: {:?}", names); }
            for (off, hash, name) in &hashes {
                println!("    hash 0x{:08X} ({}) @ stripped offset {}", hash, name, off);
            }
        }
    }

    // ================================================================
    // PART 6: Focused decompress from best candidate offsets
    // ================================================================
    println!("\n--- PART 6: Focused decompress results ---");

    // The brute-force found HASH:Header@0 from offset 0xC813.
    // Let's get the full decompressed output and analyze it.
    for &(off, ds) in &[(0xC813, 1604), (0xC813, 2400), (0xC813, 4096)] {
        if off >= data.len() { continue; }
        let src = &data[off..];
        match decompress_r2004(src, ds) {
            Ok(out) => {
                println!("\n  Decompress from 0x{:X} size={}:", off, ds);
                let names = find_section_names(&out);
                let hashes = find_hashes(&out);
                println!("    names: {:?}", names);
                for (ho, hash, name) in &hashes {
                    println!("    hash 0x{:08X} ({}) @ output offset {}", hash, name, ho);
                }
                dump_hex(&out, "out", out.len().min(512));
            }
            Err(e) => println!("  0x{:X} size={}: FAIL: {}", off, ds, e),
        }
    }

    // Also try from the exact hash offset
    for &off in &[0xC580, 0xC570, 0xC560] {
        if off >= data.len() { continue; }
        let src = &data[off..];
        for &ds in &[1604, 2400] {
            match decompress_r2004(src, ds) {
                Ok(out) => {
                    let hashes = find_hashes(&out);
                    let names = find_section_names(&out);
                    if !hashes.is_empty() || !names.is_empty() {
                        println!("\n  Decompress from 0x{:X} size={}:", off, ds);
                        println!("    names: {:?}", names);
                        for (ho, hash, name) in &hashes {
                            println!("    hash 0x{:08X} ({}) @ output {}", hash, name, ho);
                        }
                    }
                }
                Err(_) => {}
            }
        }
    }

    // ================================================================
    // PART 7: The REAL question — is the section map stored differently?
    // ================================================================
    println!("\n--- PART 7: Second hash at 0xC815 analysis ---");
    // 0xC815 has 0x4163003B (Header hash). What's around it?
    // 0xC815 is inside the decompressed output from 0xC813 at offset 2.
    // But 0xC815 is a RAW file offset. So the hash exists UNCOMPRESSED in the file!
    //
    // This means the section map might NOT be compressed at all for this file.
    // Let's check: starting at 0xC570 (where section map entry would start),
    // is there a valid ODA section map structure in the raw file?

    println!("  Checking if section map is stored uncompressed from 0xC570:");
    // Try parsing ODA section map format directly from raw bytes
    let mut sm_pos = 0xC570usize;
    let mut section_count = 0;
    loop {
        if sm_pos + 92 > data.len() { break; }
        let num_pages = le_u32(&data, sm_pos);
        let _max_decomp = le_u32(&data, sm_pos + 4);
        let _unknown = le_u32(&data, sm_pos + 8);
        let _compressed = le_u32(&data, sm_pos + 12);
        let sec_type = le_u32(&data, sm_pos + 16);
        let _encrypted = le_u32(&data, sm_pos + 20);
        let name: String = data[sm_pos+24..sm_pos+88].iter()
            .take_while(|&&b| b != 0)
            .map(|&b| if b >= 0x20 && b < 0x7F { b as char } else { '.' })
            .collect();
        let pg_count = le_u32(&data, sm_pos + 88) as usize;

        if sec_type >= 0x41630000 && sec_type <= 0x41640000 {
            println!("    Entry #{}: type=0x{:08X} name='{}' pages={} num_pages={} decomp={}",
                section_count, sec_type, name, pg_count, num_pages, _max_decomp);
            section_count += 1;
            sm_pos += 92 + pg_count * 8;
        } else if sec_type == 0 || sec_type > 0x41640000 {
            println!("    End/invalid: type=0x{:08X} @ 0x{:X}", sec_type, sm_pos);
            break;
        } else {
            println!("    Unknown type: 0x{:08X} @ 0x{:X}", sec_type, sm_pos);
            break;
        }
    }
    if section_count > 0 {
        println!("  => Found {} section map entries starting at 0xC570!", section_count);
    }

    // Also try from other candidate starts
    for &candidate in &[0xC550, 0xC560, 0xC580 - 20, 0xC580, 0xC540, 0xC500] {
        let mut pos = candidate;
        let mut cnt = 0;
        loop {
            if pos + 92 > data.len() { break; }
            let sec_type = le_u32(&data, pos + 16);
            if sec_type >= 0x41630000 && sec_type <= 0x41640000 {
                cnt += 1;
                let pg_count = le_u32(&data, pos + 88) as usize;
                if pg_count > 10000 { break; }
                pos += 92 + pg_count * 8;
            } else {
                break;
            }
        }
        if cnt > 1 {
            println!("\n  Section map from 0x{:X}: {} entries", candidate, cnt);
            let mut pos = candidate;
            for i in 0..cnt {
                let sec_type = le_u32(&data, pos + 16);
                let name: String = data[pos+24..pos+88].iter()
                    .take_while(|&&b| b != 0)
                    .map(|&b| if b >= 0x20 && b < 0x7F { b as char } else { '.' })
                    .collect();
                let pg_count = le_u32(&data, pos + 88) as usize;
                let num_pages = le_u32(&data, pos);
                println!("    [{}] type=0x{:08X} name='{}' pages={} num_pages={}", i, sec_type, name, pg_count, num_pages);
                pos += 92 + pg_count * 8;
            }
        }
    }

    println!("\n=== Done ===");
    Ok(())
}
