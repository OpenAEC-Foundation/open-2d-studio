//! Binary-search the 641-byte arc stream to find the shortest prefix
//! that causes `decompress_r2004` to emit wrong output.
//!
//! Usage: cargo run --bin lz77-bisect -- <path-to-arc_2010.dwg>

use dwg_parser::parser::decompress_r2004;
use std::fs;

/// Section info system section at offset 0xC580 in arc_2010.dwg.
/// Header: magic=0x4163003B, data_size=1604, comp_size=641, comp_type=2
/// Body starts at 0xC5A0 (32-byte header).
///
/// However, the page map system section at 0xC840 has a 20-byte header,
/// body at 0xC854 with comp_size=137, data_size=136.
const PAGE_MAP_OFFSET: usize = 0xC854;
const PAGE_MAP_COMP_SIZE: usize = 137;
const PAGE_MAP_DATA_SIZE: usize = 136;

const SECTION_INFO_OFFSET: usize = 0xC5A0;
const SECTION_INFO_COMP_SIZE: usize = 641;
const SECTION_INFO_DATA_SIZE: usize = 1604;

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let path = args.get(1).map(|s| s.as_str())
        .unwrap_or(r"C:\Users\rickd\Desktop\dwg_samples\arc_2010.dwg");

    let data = fs::read(path).expect("Failed to read DWG file");
    println!("File: {} ({} bytes)", path, data.len());

    // === Part 1: Page Map bisection ===
    println!("\n=== Page Map Body (offset 0x{:X}, {} bytes -> {} bytes) ===",
        PAGE_MAP_OFFSET, PAGE_MAP_COMP_SIZE, PAGE_MAP_DATA_SIZE);

    let pm_body = &data[PAGE_MAP_OFFSET..PAGE_MAP_OFFSET + PAGE_MAP_COMP_SIZE];
    println!("First 32 bytes: {}", hex(pm_body, 32));

    // Try full decompression
    match decompress_r2004(pm_body, PAGE_MAP_DATA_SIZE) {
        Ok(result) => {
            let nonzero = result.iter().filter(|&&b| b != 0).count();
            println!("Full decompress: {} bytes, {} nonzero", result.len(), nonzero);
            println!("Output[0..32]: {}", hex(&result, 32));
        }
        Err(e) => println!("Full decompress FAILED: {}", e),
    }

    // Bisect: find smallest N where output diverges
    println!("\nBisecting page map body:");
    for n in [1, 2, 4, 8, 14, 15, 16, 17, 20, 32, 64, 100, PAGE_MAP_COMP_SIZE] {
        if n > PAGE_MAP_COMP_SIZE { continue; }
        let prefix = &pm_body[..n];
        match decompress_r2004(prefix, PAGE_MAP_DATA_SIZE) {
            Ok(result) => {
                let nonzero = result.iter().filter(|&&b| b != 0).count();
                let end_byte = if n > 0 { format!("0x{:02X}", prefix[n-1]) } else { "-".into() };
                println!("  N={:3}: ok, {} nonzero bytes, last_input={}", n, nonzero, end_byte);
            }
            Err(e) => println!("  N={:3}: err: {}", n, e),
        }
    }

    // === Part 2: Section Info bisection ===
    println!("\n=== Section Info Body (offset 0x{:X}, {} bytes -> {} bytes) ===",
        SECTION_INFO_OFFSET, SECTION_INFO_COMP_SIZE, SECTION_INFO_DATA_SIZE);

    let si_body = &data[SECTION_INFO_OFFSET..SECTION_INFO_OFFSET + SECTION_INFO_COMP_SIZE];
    println!("First 32 bytes: {}", hex(si_body, 32));

    match decompress_r2004(si_body, SECTION_INFO_DATA_SIZE) {
        Ok(result) => {
            let nonzero = result.iter().filter(|&&b| b != 0).count();
            println!("Full decompress: {} bytes, {} nonzero", result.len(), nonzero);
        }
        Err(e) => println!("Full decompress FAILED: {}", e),
    }

    println!("\nBisecting section info body:");
    for n in [1, 2, 3, 4, 8, 15, 16, 32, 64, 128, 256, 400, 500, 600, SECTION_INFO_COMP_SIZE] {
        if n > SECTION_INFO_COMP_SIZE { continue; }
        let prefix = &si_body[..n];
        match decompress_r2004(prefix, SECTION_INFO_DATA_SIZE) {
            Ok(result) => {
                let nonzero = result.iter().filter(|&&b| b != 0).count();
                println!("  N={:3}: ok, {} nonzero bytes", n, nonzero);
            }
            Err(e) => println!("  N={:3}: err: {}", n, e),
        }
    }

    // === Part 3: Show the actual page map entries we're missing ===
    println!("\n=== Data pages found by decrypting headers (key = offset ^ 0x4164536B) ===");
    let ranges = [
        (0x100usize, 0x85C0usize),
        (0x85C0, 0xC580),
    ];
    for (start, end) in ranges {
        let mut off = start;
        while off + 32 <= end && off + 32 <= data.len() {
            let key = (off as u32) ^ 0x4164536B;
            let enc: Vec<u32> = (0..8).map(|i| {
                u32::from_le_bytes([
                    data[off + i*4], data[off + i*4+1],
                    data[off + i*4+2], data[off + i*4+3],
                ])
            }).collect();

            let sec_type = enc[0] ^ key;
            let sec_num = enc[1] ^ key;
            let ds = enc[2] ^ key;
            let cs = enc[3] ^ key;
            let so = enc[4] ^ key;

            if sec_type == 0x4163043B && sec_num < 100 && ds < 0x100000 && cs < 0x100000 && cs > 0 {
                println!("  0x{:04X}: sec_num={:2} ds=0x{:05X} ({:5}) cs=0x{:05X} ({:5}) start_off=0x{:X}",
                    off, sec_num, ds, ds, cs, cs, so);

                // Try to decompress this page's body
                let body_off = off + 32;
                if body_off + cs as usize <= data.len() {
                    let page_body = &data[body_off..body_off + cs as usize];
                    match decompress_r2004(page_body, ds as usize) {
                        Ok(dec) => {
                            let nz = dec.iter().filter(|&&b| b != 0).count();
                            let text = String::from_utf8_lossy(&dec);
                            let has_acdb = text.contains("AcDb");
                            println!("    -> decompress OK: {} nonzero, has_AcDb={}",
                                nz, has_acdb);
                        }
                        Err(e) => {
                            println!("    -> decompress FAILED: {}", e);
                            // Show first few bytes to diagnose
                            println!("       body[0..16]: {}", hex(page_body, 16));
                        }
                    }
                }

                off += cs as usize; // skip to next page
                // Align to reasonable boundary
                let align = 0x20;
                off = (off + align - 1) & !(align - 1);
            } else {
                off += 0x20; // try next 32-byte aligned offset
            }
        }
    }

    // === Summary ===
    println!("\n=== Root Cause Summary ===");
    println!("The page map system section body (137 bytes at 0xC854)");
    println!("decompresses to only 14 meaningful bytes because the");
    println!("decompressor encounters opcode 0x00 at source position 15");
    println!("and breaks (treating it as invalid main-loop opcode).");
    println!();
    println!("This causes the page map to contain only 2 of 15+ page entries.");
    println!("The missing pages (at offsets 0x85C0..0xC580) are never assembled,");
    println!("so the section map, classes, handles, and objects are all lost.");
    println!();
    println!("The compressed stream byte at position 15 is 0x00, which per the");
    println!("ODA spec should not appear as a standalone opcode. However, the");
    println!("compressor that created this file evidently uses 0x00 in the main");
    println!("loop to encode extended literal runs (same as the initial 0x00).");
}

fn hex(data: &[u8], max: usize) -> String {
    data.iter().take(max)
        .map(|b| format!("{:02X}", b))
        .collect::<Vec<_>>()
        .join(" ")
}
