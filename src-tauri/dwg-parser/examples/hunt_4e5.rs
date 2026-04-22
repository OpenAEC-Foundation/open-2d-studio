//! Hunt for LINE handle 0x4E5 coord 2008.862814420544 across the ENTIRE file
//! at every bit shift across every decompressed page regardless of sec_num.
//! Also check decompressed content with different targets (4x, 8x).

use dwg_parser::parser::decompress_r2004;
use dwg_parser::r2007;

const COORDS: &[(&str, f64)] = &[
    // Handle 0x4E5 exact
    ("4E5_x",    2008.862814420544),
    ("4E5_y",    2117.900029676204),
    // Handle 0x4E5 flipped exponent sign (in case it's encoded as delta)
    ("4E5_x_mm", 2008862.814420544),
    // Handle 0x4E5 multiplied by 1e-3 (scale down)
    ("4E5_x_m",  2.008862814420544),
    // Less-precision variants the DWG might encode
    ("4E5_x_lo", 2008.8628144205),
    ("4E5_x_hi", 2008.8628144206),
    // Handle 0x4E6 coords (related)
    ("4E6_sx",   2008.862814420544),
    ("4E6_sy",   2121.073915328957),
    ("4E6_ex",   1999.862814420543),
    ("4E6_ey",   2119.48697250258),
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

    // Search raw file first for byte-aligned patterns
    println!("=== RAW FILE (byte-aligned) ===");
    for (n, v) in COORDS {
        let pat = v.to_le_bytes();
        let mut hits = Vec::new();
        for i in 0..data.len().saturating_sub(8) {
            if data[i..i+8] == pat { hits.push(i); }
        }
        println!("  {} = {}: {} raw hits {:?}", n, v, hits.len(),
            hits.iter().take(8).map(|h| format!("0x{:X}", h)).collect::<Vec<_>>());
    }

    // Search EACH decompressed page with MAX target (multiples of page_size) for any hit
    println!("\n=== PER-PAGE (all sec_nums, large target) ===");
    let mut sorted: Vec<(i32, usize)> = page_map.iter().map(|(&p, &o)| (p, o)).collect();
    sorted.sort_by_key(|x| x.1);
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
        let st = i32::from_le_bytes([hdr[0], hdr[1], hdr[2], hdr[3]]);
        let sn = i32::from_le_bytes([hdr[4], hdr[5], hdr[6], hdr[7]]);
        let comp = u32::from_le_bytes([hdr[8], hdr[9], hdr[10], hdr[11]]) as usize;
        let decomp_sz = u32::from_le_bytes([hdr[12], hdr[13], hdr[14], hdr[15]]) as usize;

        if comp == 0 || *fo + 32 + comp > data.len() { continue; }
        if st != 1 && st != 2 && (st as u32) < 0x41000000 { continue; }

        let body = &data[*fo + 32..*fo + 32 + comp];
        // Try LARGE target — 16x page_size to see if decompressor emits more
        let large = 16 * page_size;
        let d = match decompress_r2004(body, large) { Ok(x) => x, Err(_) => continue };
        let last_nz = d.iter().rposition(|&b| b != 0).map(|i| i + 1).unwrap_or(0);
        let mut found_any = false;
        for (n, v) in COORDS {
            let pat = v.to_le_bytes();
            let hits = find_bitshifted(&d, &pat);
            if !hits.is_empty() {
                if !found_any {
                    println!(" pn={} sn={} type=0x{:X} comp={} dsz={} decomp.len={} last_nz={}",
                        pn, sn, st as u32, comp, decomp_sz, d.len(), last_nz);
                    found_any = true;
                }
                for (bo, bi) in hits.iter().take(4) {
                    println!("   hit {} @ 0x{:X} bit+{}", n, bo, bi);
                }
            }
        }
    }
}
