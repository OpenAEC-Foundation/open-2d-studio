//! Test if OBJECTS should be TIGHT-PACKED (pages concatenated by decomp size)
//! vs PAGE-STRIDED (pages placed at start_offset with 0x7400 stride).
//!
//! Compares: for a given HANDLE's logical offset, does the MS size-prefix byte
//! look like a valid object header when read from the TIGHT-PACKED buffer?

use dwg_parser::{r2007, parser::decompress_r2004, bitreader::DwgBitReader};

fn main() {
    let path = std::env::args().nth(1).unwrap_or_else(|| {
        "C:/Users/rickd/Desktop/dwg_samples/3bm-trainingset/arceringen test/3070_model - Legend - M(--)01_arceringen_5.dwg".into()
    });
    let data = std::fs::read(&path).expect("read");
    let enc_hdr = r2007::decrypt_file_header_r2010(&data).expect("decrypt");
    let (page_map, _psize) = r2007::read_page_map(&data, &enc_hdr).expect("pm");

    // Collect OBJECTS pages in file order
    let mut sorted: Vec<(i32, usize)> = page_map.iter().map(|(&p, &o)| (p, o)).collect();
    sorted.sort_by_key(|x| x.1);

    struct Pg { start_offset: usize, decomp: Vec<u8> }
    let mut pages: Vec<Pg> = Vec::new();

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
        if sn != 7 { continue; }
        let comp = u32::from_le_bytes([hdr[8], hdr[9], hdr[10], hdr[11]]) as usize;
        let decomp_sz = u32::from_le_bytes([hdr[12], hdr[13], hdr[14], hdr[15]]) as usize;
        let start_off = u32::from_le_bytes([hdr[16], hdr[17], hdr[18], hdr[19]]) as usize;
        let body = &data[*fo + 32..*fo + 32 + comp];
        // decompress with generous target (pages are LZ77 compressed)
        let d = decompress_r2004(body, decomp_sz.max(0x7400)).unwrap_or_default();
        println!("page start_off=0x{:05X} comp={} decomp_sz(hdr)={} -> got {} bytes", start_off, comp, decomp_sz, d.len());
        pages.push(Pg { start_offset: start_off, decomp: d });
    }

    pages.sort_by_key(|p| p.start_offset);

    // Build STRIDED assembly (current approach)
    let stride_total: usize = pages.iter().map(|p| p.start_offset + 0x7400).max().unwrap_or(0);
    let mut strided = vec![0u8; stride_total];
    for p in &pages {
        let end = (p.start_offset + p.decomp.len()).min(strided.len());
        let copy = end - p.start_offset;
        strided[p.start_offset..p.start_offset + copy].copy_from_slice(&p.decomp[..copy]);
    }
    println!("STRIDED assembled = {} bytes", strided.len());

    // Build TIGHT assembly
    let mut tight = Vec::new();
    let mut tight_offsets = Vec::new();
    for p in &pages {
        tight_offsets.push(tight.len());
        tight.extend_from_slice(&p.decomp);
    }
    println!("TIGHT assembled = {} bytes", tight.len());

    // Get HANDLES buffer (hardcode parse from sec_num=4)
    // Find sec_num=4 page
    let mut hdl_buf = Vec::new();
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
        let body = &data[*fo + 32..*fo + 32 + comp];
        hdl_buf = decompress_r2004(body, 0x7400).unwrap_or_default();
        break;
    }
    println!("HANDLES buffer = {} bytes", hdl_buf.len());

    // Parse object map from HANDLES
    let mut handles: Vec<(u32, usize)> = Vec::new();
    let mut pos = 0;
    let mut last_handle = 0i32;
    let mut last_loc = 0i32;
    while pos + 4 <= hdl_buf.len() {
        let sec_size = u16::from_be_bytes([hdl_buf[pos], hdl_buf[pos + 1]]) as usize;
        if sec_size <= 2 || sec_size > 4096 { break; }
        if pos + 2 + sec_size > hdl_buf.len() { break; }
        let body_end = pos + 2 + sec_size - 2;
        let mut rpos = pos + 2;
        while rpos < body_end {
            let (hd, p1) = match DwgBitReader::read_unsigned_modular_char(&hdl_buf, rpos) { Ok(v) => v, Err(_) => break };
            let (ld, p2) = match DwgBitReader::read_modular_char(&hdl_buf, p1) { Ok(v) => v, Err(_) => break };
            last_handle = last_handle.wrapping_add(hd as i32);
            last_loc = last_loc.wrapping_add(ld);
            if last_handle > 0 && last_loc >= 0 {
                handles.push((last_handle as u32, last_loc as usize));
            }
            rpos = p2;
        }
        pos += 2 + sec_size;
    }
    println!("HANDLES parsed {} entries, max_offset = {}",
        handles.len(), handles.iter().map(|(_, o)| *o).max().unwrap_or(0));

    // For each handle, try to parse MS size prefix at the offset in BOTH buffers.
    // A valid MS is a 16-bit raw byte-aligned little-endian value.
    // We test: first byte non-zero and reasonable (< 0x80 probably).
    let test_offset_validity = |buf: &[u8], off: usize| -> bool {
        if off + 4 > buf.len() { return false; }
        // MS first byte: low 7 bits, MSB=continuation. Value is size in bytes.
        // Typical object sizes: 10..5000. So first byte often has MSB set with a
        // continuation short thereafter. Let's just check the byte isn't 0 AND
        // the next BS/BL after MS doesn't look like 0xFFFF.
        if buf[off] == 0 && buf[off + 1] == 0 { return false; }
        true
    };

    let mut strided_valid = 0;
    let mut tight_valid = 0;
    let mut oob_strided = 0;
    let mut oob_tight = 0;

    for &(_h, off) in &handles {
        if off >= strided.len() { oob_strided += 1; }
        else if test_offset_validity(&strided, off) { strided_valid += 1; }

        if off >= tight.len() { oob_tight += 1; }
        else if test_offset_validity(&tight, off) { tight_valid += 1; }
    }

    println!("\nValidity (first-byte non-zero at handle offset):");
    println!(" STRIDED: valid={} / {} ({} OOB)", strided_valid, handles.len(), oob_strided);
    println!(" TIGHT:   valid={} / {} ({} OOB)", tight_valid, handles.len(), oob_tight);

    // Also: offsets falling in gap regions of strided
    let mut in_gap = 0;
    let mut page_ends: Vec<(usize, usize)> = pages.iter().map(|p| (p.start_offset, p.start_offset + p.decomp.len())).collect();
    for &(_h, off) in &handles {
        if off >= strided.len() { continue; }
        if !page_ends.iter().any(|&(s, e)| off >= s && off < e) {
            in_gap += 1;
        }
    }
    println!(" STRIDED handles IN GAP between pages: {}", in_gap);
}
