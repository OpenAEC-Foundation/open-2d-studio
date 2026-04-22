//! dwg_hex_hunt — brute-force scanner for DWG parser reverse-engineering.
//!
//! Given a DWG file, scans the entire file for:
//! 1. Section page header magics (0x41630E3B, 0x4163003B)
//! 2. Known f64 values from the known DXF ground truth (e.g., 50.0, 0.0, 100.0)
//!    both byte-aligned and bit-shifted (to detect bit-packed entity bodies)
//! 3. LZ77-decompressible regions
//!
//! Output: file offsets where each pattern appears. Use this to locate
//! entity data and correlate with page map entries for decoder development.

use std::io::Read;
use dwg_parser::parser::decompress_r2004;
// Re-use r2007 RS-strip via the internal module — we call it indirectly by
// duplicating the simple logic here since the module is private to the crate.
fn strip_rs(encoded: &[u8]) -> Vec<u8> {
    const DATA: usize = 239;
    const SECTOR: usize = 255;
    let mut out = Vec::with_capacity(encoded.len());
    let mut pos = 0;
    while pos < encoded.len() {
        let remain = encoded.len() - pos;
        if remain >= SECTOR {
            out.extend_from_slice(&encoded[pos..pos + DATA]);
            pos += SECTOR;
        } else if remain > SECTOR - DATA {
            let data_len = remain.saturating_sub(SECTOR - DATA);
            out.extend_from_slice(&encoded[pos..pos + data_len]);
            break;
        } else {
            out.extend_from_slice(&encoded[pos..]);
            break;
        }
    }
    out
}

fn main() -> anyhow::Result<()> {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let path = args.first().cloned().unwrap_or_else(||
        r"C:\Users\rickd\Desktop\dwg_samples\circle_2010.dwg".to_string());

    eprintln!("[hex_hunt] scanning {}", path);
    let mut file = std::fs::File::open(&path)?;
    let mut data = Vec::new();
    file.read_to_end(&mut data)?;
    let n = data.len();
    eprintln!("[hex_hunt] file size: {} (0x{:X})", n, n);

    // --- Magic numbers ---
    let magics: &[(u32, &str)] = &[
        (0x41630E3B, "SECTION_PAGE_MAP"),
        (0x4163003B, "DATA_SECTION_PAGE_MAP"),
        (0x41630E3B, "SECTION_MAP"),
        (0x4163043B, "MAYBE_ALT_MAGIC"),
    ];
    for &(magic, name) in magics {
        let m = magic.to_le_bytes();
        let mut offs = Vec::new();
        for i in 0..n.saturating_sub(4) {
            if &data[i..i+4] == m { offs.push(i); }
        }
        if !offs.is_empty() {
            eprintln!("[hex_hunt] {} (0x{:08X}): {} matches",
                name, magic, offs.len());
            for &off in &offs {
                let end = (off + 32).min(n);
                let hex: String = data[off..end].iter()
                    .map(|b| format!("{:02x}", b)).collect::<Vec<_>>().join(" ");
                eprintln!("  0x{:08X}: {}", off, hex);
                // Field interpretation:
                let f = |o: usize| -> u32 {
                    u32::from_le_bytes([data[o], data[o+1], data[o+2], data[o+3]])
                };
                let fi = |o: usize| -> i32 { f(o) as i32 };
                eprintln!("    +0x00:0x{:08X} +0x04:0x{:08X}({}) +0x08:0x{:08X}({}) +0x0C:0x{:08X}({}) +0x10:0x{:08X} +0x14:0x{:08X} +0x18:0x{:08X} +0x1C:0x{:08X}",
                    f(off),
                    f(off+4), fi(off+4),
                    f(off+8), fi(off+8),
                    f(off+12), fi(off+12),
                    f(off+16), f(off+20), f(off+24), f(off+28));
                // Try to decompress the body and dump first 80 bytes
                let ds = f(off+4) as usize;  // data_size (decompressed)
                let cs = f(off+8) as usize;  // comp_size (on disk, post-header)
                let body_start = off + 32;
                if cs > 0 && cs < n && body_start + cs <= n && ds > 0 && ds < 1_000_000 {
                    let raw = &data[body_start..body_start + cs];
                    let stripped = strip_rs(raw);
                    let decompressed = match decompress_r2004(&stripped, ds) {
                        Ok(v) => v,
                        Err(_) => {
                            // Try raw (not RS-stripped)
                            decompress_r2004(raw, ds).unwrap_or_else(|_| stripped.clone())
                        }
                    };
                    let show = decompressed.len().min(96);
                    let hex: String = decompressed[..show].iter()
                        .map(|b| format!("{:02x}", b)).collect::<Vec<_>>().join(" ");
                    eprintln!("    BODY decompressed {} bytes (expected {}): {}",
                        decompressed.len(), ds, hex);
                }
            }
        }
    }

    // --- Known f64 values (from circle_2010.dxf) ---
    let known_values: &[(f64, &str)] = &[
        (50.0,  "center.x / center.y / radius"),
        (0.0,   "center.z / zero"),
        (100.0, "sometimes-used reference"),
        (1.0,   "unit / extrusion.z"),
    ];
    for &(v, label) in known_values {
        let bytes = v.to_le_bytes();
        let mut offs = Vec::new();
        for i in 0..n.saturating_sub(8) {
            if &data[i..i+8] == bytes { offs.push(i); }
        }
        if !offs.is_empty() {
            eprintln!("[hex_hunt] f64 {} ({}): {} byte-aligned matches at {}",
                v, label, offs.len(),
                offs.iter().take(10).map(|o| format!("0x{:X}", o)).collect::<Vec<_>>().join(", "));
        }
        // Check bit-shifted versions
        for shift in 1..=7u32 {
            let mut shifted = vec![0u8; 9];
            for (i, &b) in bytes.iter().enumerate() {
                shifted[i]     |= (b << shift) & 0xFF;
                shifted[i + 1] |= b >> (8 - shift);
            }
            // Match interior only (endpoints partial)
            let pat = &shifted[1..8];
            let mut cnt = 0;
            for i in 0..n.saturating_sub(7) {
                if &data[i..i+7] == pat { cnt += 1; }
            }
            if cnt > 0 && cnt < 20 {
                eprintln!("[hex_hunt]   bit-shift +{}: {} interior matches of f64 {}", shift, cnt, v);
            }
        }
    }

    // --- ASCII strings of interest ---
    let ascii_keys = [b"AcDbLine".as_ref(), b"AcDbCircle".as_ref(),
                      b"AcDbArc".as_ref(), b"AcDbEntity".as_ref(),
                      b"AcDbBlockReference".as_ref(), b"LAYER".as_ref(),
                      b"MODEL".as_ref()];
    for key in &ascii_keys {
        let mut off = 0;
        let mut cnt = 0;
        while let Some(i) = data[off..].windows(key.len()).position(|w| w == *key) {
            let real = off + i;
            off = real + 1;
            cnt += 1;
            if cnt == 1 {
                eprintln!("[hex_hunt] ASCII {:?} at 0x{:X}", std::str::from_utf8(key).unwrap_or("?"), real);
            }
        }
        if cnt > 1 { eprintln!("[hex_hunt]   (total {} occurrences)", cnt); }
    }

    Ok(())
}
