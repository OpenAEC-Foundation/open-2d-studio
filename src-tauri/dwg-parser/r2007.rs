//! R2007+ (AC1021-AC1032) page-based file structure parser.
//!
//! R2007 introduced a completely different file organization compared to
//! R2000/R2004.  The file is divided into fixed-size pages.  Section data
//! is spread across multiple data pages identified by name strings rather
//! than numeric IDs.  Data pages use Reed-Solomon RS(255,239) coding for
//! error correction -- for valid files we simply skip the parity bytes.

use std::collections::HashMap;
use crate::error::DwgError;
use crate::parser::{decompress_r2004, decompress_r2004_generous};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/// Standard page size for R2007+ files.
const R2007_PAGE_SIZE: usize = 0x7400;

/// Size of the encrypted metadata region at file offset 0x80.
const R2007_ENC_HDR_SIZE: usize = 0x6C;

/// RS(255,239) parameters: 239 data bytes per 255-byte sector.
const RS_DATA_BYTES: usize = 239;
const RS_SECTOR_SIZE: usize = 255;

/// Known section name hashes / magic type IDs for R2007+.
pub const SECTION_HEADER: i32 = 0x4163003b_u32 as i32;
pub const SECTION_CLASSES: i32 = 0x4163003c_u32 as i32;
pub const SECTION_HANDLES: i32 = 0x4163003f_u32 as i32;
pub const SECTION_OBJECTS: i32 = 0x41630040_u32 as i32;

// ---------------------------------------------------------------------------
// R2007 File Header Decryption
// ---------------------------------------------------------------------------

/// Decrypt the R2007+ file header metadata at offset 0x80.
///
/// Historically this function applied the same LCG-XOR (seed=1, mul=0x343FD,
/// add=0x269EC3) over a 0x6C-byte block as R2004 / R2010+. That algorithm is
/// CORRECT for R2010+ (and is reused by `decrypt_file_header_r2010` after RS
/// parity stripping) and works for R2010+ files when the RS wrap is absent
/// (rare). Empirically, however, the algorithm does NOT produce the documented
/// `"AcFssFcAJMB\0"` magic for actual R2007 (AC1021) files Ã¢â‚¬â€ verified on
/// `example_2007.dwg` and `sample_AC1021.dwg`. Per ODA OpenDesignSpec Ã‚Â§4.1,
/// R2007's System Section uses a distinct multi-stage codec (an LZ77-style
/// compression layer wrapping a custom RandSeed XOR over a 0x480-byte payload)
/// that is not yet implemented here.
///
/// To avoid silent garbage propagating into `read_page_map` (which then picks
/// false-positive page-map addresses and produces 99% handle-decode failures
/// downstream), we now validate the decrypted output: if the magic prefix
/// "AcFss" or "AcDb" or any plausible printable signature is absent AND the
/// caller is an R2007 file, return an explicit error so the dispatcher can
/// fall back to sentinel scanning.
///
/// The 0x6C-byte payload returned is exactly what `read_page_map` consumes.
pub fn decrypt_file_header(data: &[u8]) -> Result<Vec<u8>, DwgError> {
    if data.len() < 0x80 + R2007_ENC_HDR_SIZE {
        return Err(DwgError::InvalidBinary(
            "R2007+: file too short for encrypted header".into(),
        ));
    }
    let mut decrypted = vec![0u8; R2007_ENC_HDR_SIZE];
    let mut seed: u32 = 1;
    for i in 0..R2007_ENC_HDR_SIZE {
        seed = seed.wrapping_mul(0x343FD).wrapping_add(0x269EC3);
        decrypted[i] = data[0x80 + i] ^ ((seed >> 16) as u8);
    }

    // R2007-specific validation: the documented magic at offset 0x00 of the
    // decrypted block is "AcFssFcAJMB\0" per ODA Ã‚Â§4.1. R2007 files that lack
    // this magic after the plain-LCG decrypt are using the R2007-specific
    // codec (see doc-comment above) Ã¢â‚¬â€ return Err so the caller can dispatch
    // to a sentinel-scan or alternate pipeline rather than feed garbage to
    // `read_page_map`.
    let version_code: &[u8] = data.get(0..6).unwrap_or(&[]);
    let is_r2007 = version_code == b"AC1021";
    if is_r2007 && !decrypted.starts_with(b"AcFss") {
        return Err(DwgError::InvalidBinary(
            "R2007 (AC1021): plain-LCG decrypt did not yield 'AcFss' magic Ã¢â‚¬â€ \
             R2007 uses a distinct System Section codec (ODA Ã‚Â§4.1) that is not \
             yet implemented; falling back to sentinel scan".into(),
        ));
    }

    Ok(decrypted)
}

/// Decrypt the R2010+ encrypted file header at offset 0x80.
///
/// Per ODA OpenDesignSpec Ã‚Â§4.1, R2010/R2013/R2018 wrap the 0x6C-byte LCG
/// payload in a Reed-Solomon(255,239) sector block: 3 Ãƒâ€” 255 bytes on disk
/// yielding 3 Ãƒâ€” 239 = 717 data bytes after stripping parity. The first
/// 0x6C bytes of the RS-stripped block are then LCG-XOR-decrypted with the
/// same algorithm as R2004/R2007.
///
/// Returns the 0x6C-byte decrypted header, ready for offset extraction
/// exactly like the R2007 path.
pub fn decrypt_file_header_r2010(data: &[u8]) -> Result<Vec<u8>, DwgError> {
    // 3 RS sectors of 255 bytes = 765 bytes on-disk.
    const RS_DISK: usize = 3 * RS_SECTOR_SIZE; // 765
    if data.len() < 0x80 + RS_DISK {
        return Err(DwgError::InvalidBinary(
            "R2010+: file too short for RS-wrapped encrypted header".into(),
        ));
    }
    // Step 1: strip RS(255,239) parity from 765 bytes Ã¢â€ â€™ 717 data bytes.
    let rs_stripped = strip_rs_parity(&data[0x80..0x80 + RS_DISK]);
    if rs_stripped.len() < R2007_ENC_HDR_SIZE {
        return Err(DwgError::InvalidBinary(
            "R2010+: RS-stripped header too short".into(),
        ));
    }
    // Step 2: LCG-XOR decrypt the first 0x6C bytes.
    let mut decrypted = vec![0u8; R2007_ENC_HDR_SIZE];
    let mut seed: u32 = 1;
    for i in 0..R2007_ENC_HDR_SIZE {
        seed = seed.wrapping_mul(0x343FD).wrapping_add(0x269EC3);
        decrypted[i] = rs_stripped[i] ^ ((seed >> 16) as u8);
    }
    Ok(decrypted)
}

// ---------------------------------------------------------------------------
// Reed-Solomon sector stripping
// ---------------------------------------------------------------------------

/// Strip RS parity bytes from encoded data.
///
/// R2007+ pages store data in RS(255,239) sectors: each 255 bytes contain
/// 239 data bytes followed by 16 parity bytes.  For reading valid
/// (non-corrupted) files we simply extract the data bytes and skip parity.
pub fn strip_rs_parity(encoded: &[u8]) -> Vec<u8> {
    let mut data = Vec::with_capacity(encoded.len());
    let mut pos = 0;
    while pos < encoded.len() {
        let remaining = encoded.len() - pos;
        if remaining >= RS_SECTOR_SIZE {
            data.extend_from_slice(&encoded[pos..pos + RS_DATA_BYTES]);
            pos += RS_SECTOR_SIZE;
        } else if remaining > RS_SECTOR_SIZE - RS_DATA_BYTES {
            // Partial sector -- take what data bytes we can
            let data_len = remaining.saturating_sub(RS_SECTOR_SIZE - RS_DATA_BYTES);
            data.extend_from_slice(&encoded[pos..pos + data_len]);
            break;
        } else {
            // Too short for even parity -- treat as raw data
            data.extend_from_slice(&encoded[pos..]);
            break;
        }
    }
    data
}

// ---------------------------------------------------------------------------
// Section page map
// ---------------------------------------------------------------------------

/// Metadata for one section extracted from the section map.
#[derive(Debug, Clone)]
pub struct R2007SectionInfo {
    pub section_type: i32,
    pub section_number: i32,
    pub name: String,
}

/// Read the section page map from the R2007+ encrypted header.
///
/// Returns a mapping of page indices to file offsets. Identical in
/// concept to R2004 but with RS-encoded page data.
///
/// The header layout differs subtly between R2007 and R2010+:
///
///  - R2007 stores the page-map address at offset 0x20 and requires adding
///    the 0x100 base (file-header offset) to obtain the absolute file offset.
///  - R2010+ stores it at offset 0x54 as an absolute offset (no +0x100).
///
/// We try the R2007 layout first, and if that produces an out-of-bounds
/// address we fall back to the R2010+ layout. This keeps legacy R2007
/// files working while enabling R2010/R2013/R2018.
pub fn read_page_map(
    data: &[u8],
    enc_hdr: &[u8],
) -> Result<(HashMap<i32, usize>, usize), DwgError> {
    let page_size = if enc_hdr.len() >= 0x2C {
        let ps = u32::from_le_bytes([
            enc_hdr[0x28], enc_hdr[0x29], enc_hdr[0x2A], enc_hdr[0x2B],
        ]) as usize;
        // Guard: R2010+ stores something else at 0x28 Ã¢â‚¬â€ if the value is too
        // small (< 0x400 = 1 KB) or too big, fall back to the default page size.
        if ps >= 0x400 && ps <= 0x100000 { ps } else { R2007_PAGE_SIZE }
    } else {
        R2007_PAGE_SIZE
    };

    // Candidate list of map-address interpretations, R2010+ first.
    // Each candidate is only accepted if its 32-byte header decodes to a
    // plausible section (type Ã¢Ë†Ë† {1,2,0x41630E3B}, comp_size fits in file).
    let candidates: Vec<(&str, usize)> = {
        let mut v: Vec<(&str, usize)> = Vec::new();
        if enc_hdr.len() >= 0x58 {
            let raw = u32::from_le_bytes([
                enc_hdr[0x54], enc_hdr[0x55], enc_hdr[0x56], enc_hdr[0x57],
            ]) as usize;
            v.push(("0x54-abs",   raw));
            v.push(("0x54+0x100", raw.wrapping_add(0x100)));
        }
        if enc_hdr.len() >= 0x24 {
            let raw = u32::from_le_bytes([
                enc_hdr[0x20], enc_hdr[0x21], enc_hdr[0x22], enc_hdr[0x23],
            ]) as usize;
            v.push(("0x20+0x100", raw.wrapping_add(0x100)));
            v.push(("0x20-abs",   raw));
        }
        v
    };

    let is_valid_page_header = |addr: usize| -> bool {
        // NOTE: XOR-decrypted fallback was REMOVED Ã¢â‚¬â€ it produced too many false
        // positives (2-of-2^32 mask collisions made random data look like
        // sec_type Ã¢Ë†Ë† {1, 2}), causing total regression. Team-lead revert.
        // SPEC NOTE: re-introduction gated to AC1032 only — see SPEC_NOTES.md "Findings still open".
        if addr < 0x100 || addr + 32 > data.len() { return false; }
        let sec_type = i32::from_le_bytes([
            data[addr], data[addr + 1], data[addr + 2], data[addr + 3],
        ]);
        if sec_type != 0x41630E3B && sec_type != 1 && sec_type != 2 {
            return false;
        }
        let comp_size = u32::from_le_bytes([
            data[addr + 12], data[addr + 13], data[addr + 14], data[addr + 15],
        ]) as usize;
        if addr + 32 + comp_size > data.len() { return false; }
        if comp_size > 0x400000 { return false; }
        true
    };

    let (label, map_addr) = candidates
        .iter()
        .copied()
        .find(|&(_, a)| is_valid_page_header(a))
        .ok_or_else(|| DwgError::InvalidBinary(
            format!("R2007+: no valid page-map address (tried {:?}, data.len=0x{:X})",
                candidates, data.len()).into(),
        ))?;
    crate::dwg_dbg!("[dwg-dbg] r2007 read_page_map: picked {} map_addr=0x{:X}", label, map_addr);
    let hdr_end = (map_addr + 32).min(data.len());
    let hdr_bytes: String = data[map_addr..hdr_end].iter()
        .map(|b| format!("{:02x} ", b)).collect();
    crate::dwg_dbg!("[dwg-dbg] r2007 page-hdr bytes: {}", hdr_bytes);

    // Read page-map header fields. Header is 20 bytes per ODA Ã‚Â§4.3.
    // NOTE: XOR-decrypted 32-byte variant temporarily disabled after regression.
    let section_type = i32::from_le_bytes([
        data[map_addr], data[map_addr + 1], data[map_addr + 2], data[map_addr + 3],
    ]);
    let (data_size, comp_size, compressed) = if section_type == 0x41630E3B {
        let ds = u32::from_le_bytes([
            data[map_addr + 4], data[map_addr + 5],
            data[map_addr + 6], data[map_addr + 7],
        ]) as usize;
        let cs = u32::from_le_bytes([
            data[map_addr + 8], data[map_addr + 9],
            data[map_addr + 10], data[map_addr + 11],
        ]) as usize;
        let flag = u32::from_le_bytes([
            data[map_addr + 12], data[map_addr + 13],
            data[map_addr + 14], data[map_addr + 15],
        ]);
        (ds, cs, flag == 2)
    } else {
        let ds = u32::from_le_bytes([
            data[map_addr + 8], data[map_addr + 9],
            data[map_addr + 10], data[map_addr + 11],
        ]) as usize;
        let cs = u32::from_le_bytes([
            data[map_addr + 12], data[map_addr + 13],
            data[map_addr + 14], data[map_addr + 15],
        ]) as usize;
        (ds, cs, section_type == 2)
    };
    crate::dwg_dbg!("[dwg-dbg] r2007 page-map hdr: sec_type=0x{:X} data_size=0x{:X} comp_size=0x{:X} compressed={}",
        section_type, data_size, comp_size, compressed);

    let body = map_addr + 20;
    if body + comp_size > data.len() {
        return Err(DwgError::InvalidBinary(
            "R2007+: page map data out of bounds".into(),
        ));
    }

    // Try BOTH with and without RS-strip; R2010+ system sections typically
    // store the compressed body raw without per-sector parity.
    // Try raw first since RS-stripping truncates the compressed stream.
    let raw_body = data[body..body + comp_size].to_vec();
    let stripped = strip_rs_parity(&raw_body);

    let mut candidates_bodies: Vec<(String, Vec<u8>)> = Vec::new();
    if compressed {
        // Try raw-then-decompressed first (preserves END marker)
        if let Ok(v) = decompress_r2004(&raw_body, data_size) {
            candidates_bodies.push(("raw+decompress".into(), v));
        }
        // Fallback: try stripped-then-decompressed
        if let Ok(v) = decompress_r2004(&stripped, data_size) {
            candidates_bodies.push(("strip+decompress".into(), v));
        }
    } else {
        candidates_bodies.push(("stripped raw".into(), stripped.clone()));
        candidates_bodies.push(("body raw".into(), raw_body.clone()));
    }

    // Pick the candidate whose first 8 bytes form a plausible page-map entry.
    // R2010+ page maps: (i32 page_num, i32 page_size) pairs.
    // page_num can be negative (gap entries) or small positive (1..~5000).
    // page_size should be positive and reasonable.
    let is_plausible_page_map = |v: &[u8]| -> bool {
        if v.len() < 16 { return false; }
        // Scan first few entries for at least one with positive page_num and
        // reasonable page_size, or a negative page_num (gap) with positive size.
        for i in 0..v.len().min(80) / 8 {
            let off = i * 8;
            let pn = i32::from_le_bytes([v[off], v[off+1], v[off+2], v[off+3]]);
            let ps = i32::from_le_bytes([v[off+4], v[off+5], v[off+6], v[off+7]]);
            if pn == 0 && ps == 0 { break; } // terminator
            if pn > 0 && pn < 10000 && ps > 0 && ps < 0x1000000 {
                return true; // found a valid positive entry
            }
        }
        false
    };
    let map_data = candidates_bodies
        .into_iter()
        .find(|(_, v)| is_plausible_page_map(v))
        .map(|(label, v)| {
            crate::dwg_dbg!("[dwg-dbg] r2007 page-map: using '{}' candidate ({} bytes)", label, v.len());
            v
        })
        .unwrap_or_else(|| {
            // Prefer raw over stripped for system section bodies (no RS encoding)
            crate::dwg_dbg!("[dwg-dbg] r2007 page-map: no plausible candidate, using raw+decompress");
            if compressed {
                decompress_r2004(&raw_body, data_size)
                    .or_else(|_| decompress_r2004(&stripped, data_size))
                    .unwrap_or_default()
            } else {
                raw_body.clone()
            }
        });
    crate::dwg_dbg!("[dwg-dbg] r2007 page-map: map_data len={} (expected data_size={})",
        map_data.len(), data_size);
    if !map_data.is_empty() {
        let n = map_data.len().min(64);
        let hx: String = map_data[..n].iter().map(|b| format!("{:02x} ", b)).collect();
        crate::dwg_dbg!("[dwg-dbg] r2007 map_data[..{}]: {}", n, hx);
    }

    // R2010+ Section Page Map body Ã¢â‚¬â€ plain LE (i32 page_number, i32 page_size)
    // pairs per ODA OpenDesignSpec Ã‚Â§4.4. Positive page_number = real page,
    // negative = gap/deleted. Cumulative offset starts at 0x100.
    let mut page_map = HashMap::new();
    let mut cum_offset: usize = 0x100;
    let mut pos = 0;
    let mut entry_count = 0usize;

    while pos + 8 <= map_data.len() {
        let page_num = i32::from_le_bytes([
            map_data[pos], map_data[pos + 1], map_data[pos + 2], map_data[pos + 3],
        ]);
        let psize = i32::from_le_bytes([
            map_data[pos + 4], map_data[pos + 5], map_data[pos + 6], map_data[pos + 7],
        ]);
        pos += 8;
        entry_count += 1;
        if entry_count <= 20 {
            crate::dwg_dbg!("[dwg-dbg] page[{}]: page_num={} psize=0x{:X} (offset=0x{:X})",
                entry_count - 1, page_num, psize, cum_offset);
        }
        if page_num == 0 && psize == 0 {
            // Zero-pair Ã¢â‚¬â€ could be padding or end marker.
            // For R2018 files, don't stop at zero pairs Ã¢â‚¬â€ more entries may follow.
            // Only stop if multiple consecutive zero pairs are seen.
            if pos + 8 <= map_data.len() {
                let next_pn = i32::from_le_bytes([
                    map_data[pos], map_data[pos + 1], map_data[pos + 2], map_data[pos + 3],
                ]);
                let next_ps = i32::from_le_bytes([
                    map_data[pos + 4], map_data[pos + 5], map_data[pos + 6], map_data[pos + 7],
                ]);
                if next_pn == 0 && next_ps == 0 {
                    break; // Two consecutive zero pairs Ã¢â‚¬â€ definitely end
                }
            } else {
                break;
            }
            continue;
        }
        // per ODA Ã‚Â§4.4: gap pages with negative psize are zero-sized markers;
        // only positive psize consumes physical file space.
        let physical_size = if psize > 0 { psize as usize } else { 0 };
        if page_num > 0 && physical_size > 0 {
            page_map.insert(page_num, cum_offset);
        }
        cum_offset = cum_offset.saturating_add(physical_size);
    }
    let max_page = page_map.keys().max().copied().unwrap_or(0);
    let min_page = page_map.keys().min().copied().unwrap_or(0);
    crate::dwg_dbg!("[dwg-dbg] r2007 read_page_map: parsed {} entries ({} in map, pages {}..{}), final offset=0x{:X}",
        entry_count, page_map.len(), min_page, max_page, cum_offset);

    Ok((page_map, page_size))
}

/// Parse the section map to identify which section IDs correspond to
/// Header, Classes, Handles, etc.
pub fn parse_section_map(map_data: &[u8]) -> Vec<R2007SectionInfo> {
    let mut sections = Vec::new();
    let mut pos = 0;

    while pos + 28 <= map_data.len() {
        let section_type = i32::from_le_bytes([
            map_data[pos], map_data[pos + 1], map_data[pos + 2], map_data[pos + 3],
        ]);
        if section_type <= 0 { break; }

        let section_number = i32::from_le_bytes([
            map_data[pos + 12], map_data[pos + 13],
            map_data[pos + 14], map_data[pos + 15],
        ]);

        let name_length = if pos + 24 <= map_data.len() {
            u32::from_le_bytes([
                map_data[pos + 20], map_data[pos + 21],
                map_data[pos + 22], map_data[pos + 23],
            ]) as usize
        } else { 0 };

        let page_count = if pos + 28 <= map_data.len() {
            u32::from_le_bytes([
                map_data[pos + 24], map_data[pos + 25],
                map_data[pos + 26], map_data[pos + 27],
            ]) as usize
        } else { 0 };

        pos += 32; // fixed header

        // Read section name (UTF-16LE or ASCII depending on version)
        let name = if name_length > 0 && pos + name_length * 2 <= map_data.len() {
            let mut chars = Vec::new();
            for i in 0..name_length {
                let idx = pos + i * 2;
                if idx + 1 < map_data.len() {
                    let w = u16::from_le_bytes([map_data[idx], map_data[idx + 1]]);
                    if w == 0 { break; }
                    if let Some(c) = char::from_u32(w as u32) {
                        chars.push(c);
                    }
                }
            }
            pos += name_length * 2;
            chars.into_iter().collect()
        } else {
            String::new()
        };

        // Skip page entries for this section (each 8 bytes)
        pos += page_count * 8;

        sections.push(R2007SectionInfo {
            section_type,
            section_number,
            name,
        });
    }

    sections
}

/// Assemble an R2007+ section by collecting pages, stripping RS parity,
/// decompressing, and concatenating.
pub fn assemble_section(
    data: &[u8],
    page_map: &HashMap<i32, usize>,
    _page_size: usize,
    target_section: i32,
    version_code: &str,
) -> Result<Vec<u8>, DwgError> {
    struct PageInfo {
        file_offset: usize,
        hdr_size: usize,
        data_size: usize,
        comp_size: usize,
        start_offset: usize,
        compressed: bool,
    }

    // per ODA Ã‚Â§4.5 XOR page-header decryption applies to R2010+ (AC1024+),
    // not only R2013+. key = file_offset ^ 0x4164536B, applied per-DWORD
    // to the 32-byte header.
    let try_xor = version_code >= "AC1024";

    let mut pages = Vec::new();
    let mut seen_sections: std::collections::HashSet<i32> = std::collections::HashSet::new();

    for (&_sec_num, &file_offset) in page_map {
        if file_offset + 20 > data.len() { continue; }

        // Try raw 20-byte R2007-style header first
        let st = i32::from_le_bytes([
            data[file_offset], data[file_offset + 1],
            data[file_offset + 2], data[file_offset + 3],
        ]);
        let sn = i32::from_le_bytes([
            data[file_offset + 4], data[file_offset + 5],
            data[file_offset + 6], data[file_offset + 7],
        ]);
        let ds = u32::from_le_bytes([
            data[file_offset + 8], data[file_offset + 9],
            data[file_offset + 10], data[file_offset + 11],
        ]) as usize;
        let cs = u32::from_le_bytes([
            data[file_offset + 12], data[file_offset + 13],
            data[file_offset + 14], data[file_offset + 15],
        ]) as usize;
        let so = u32::from_le_bytes([
            data[file_offset + 16], data[file_offset + 17],
            data[file_offset + 18], data[file_offset + 19],
        ]) as usize;

        // Check if raw header looks valid (system section sentinel or sec_type 1/2)
        let raw_valid = (st == 0x41630E3B || st == 0x4163003B
            || st == 0x4163043B || st == 1 || st == 2)
            && ds <= 0x1000000 && cs <= 0x1000000;

        let (sec_type, sec_number, dsize, csize, start_off, hdr_size) = if raw_valid {
            (st, sn, ds, cs, so, 20usize)
        } else if try_xor && file_offset + 32 <= data.len() {
            // XOR-decrypt the 32-byte data page header per ODA Ã‚Â§4.6.
            // Field layout (after XOR):
            //   hdr[0..4]   sec_type  (0x4163043B for data pages)
            //   hdr[4..8]   sec_number
            //   hdr[8..12]  data size (COMPRESSED, on-disk body length)
            //   hdr[12..16] page size (DECOMPRESSED, valid bytes after inflate)
            //   hdr[16..20] start offset (in decompressed buffer)
            let mask = 0x4164536Bu32 ^ (file_offset as u32);
            let mut hdr = [0u8; 32];
            hdr.copy_from_slice(&data[file_offset..file_offset + 32]);
            for dw in 0..8 {
                let off = dw * 4;
                let val = u32::from_le_bytes([hdr[off], hdr[off+1], hdr[off+2], hdr[off+3]]);
                let dec = val ^ mask;
                hdr[off..off+4].copy_from_slice(&dec.to_le_bytes());
            }
            let xst = i32::from_le_bytes([hdr[0], hdr[1], hdr[2], hdr[3]]);
            let xsn = i32::from_le_bytes([hdr[4], hdr[5], hdr[6], hdr[7]]);
            // per ODA Ã‚Â§4.6 for XOR 32-byte data page headers:
            //   hdr[8..12]  = compressed (on-disk) body size
            //   hdr[12..16] = decompressed (valid) page size
            let xcomp = u32::from_le_bytes([hdr[8], hdr[9], hdr[10], hdr[11]]) as usize;
            let xdecomp = u32::from_le_bytes([hdr[12], hdr[13], hdr[14], hdr[15]]) as usize;
            let xso = u32::from_le_bytes([hdr[16], hdr[17], hdr[18], hdr[19]]) as usize;
            // Validate: sec_type must be data-page magic or 1/2, sizes reasonable.
            // decomp >= comp (LZ77 never makes things smaller than the uncompressed bytes
            // present inline; allow 64-byte slack for the compression header).
            if (xst == 0x4163043B || xst == 1 || xst == 2)
                && xcomp <= 0x1000000 && xdecomp <= 0x1000000
                && xdecomp >= xcomp.saturating_sub(64)
                && file_offset + 32 + xcomp <= data.len()
            {
                // Pass values as (dsize, csize) where dsize = decompressed (decomp target)
                // and csize = compressed (body slice length). PageInfo uses those
                // names consistently downstream.
                (xst, xsn, xdecomp, xcomp, xso, 32usize)
            } else {
                // XOR didn't produce valid header either Ã¢â‚¬â€ skip page
                (st, sn, ds, cs, so, 20usize)
            }
        } else {
            (st, sn, ds, cs, so, 20usize)
        };

        seen_sections.insert(sec_number);
        if sec_number != target_section { continue; }
        if sec_type <= 0 { continue; }

        // Sanity: data_size and comp_size should be reasonable
        if dsize > 0x1000000 || csize > 0x1000000 { continue; }

        pages.push(PageInfo {
            file_offset,
            hdr_size,
            data_size: dsize,
            comp_size: csize,
            start_offset: start_off,
            compressed: sec_type == 2,
        });
    }

    if pages.is_empty() {
        let mut seen: Vec<i32> = seen_sections.into_iter().collect();
        seen.sort();
        crate::dwg_dbg!("[dwg-dbg] assemble_section: target={} not found; seen sec_numbers (first 30): {:?}",
            target_section, seen.iter().take(30).collect::<Vec<_>>());
        return Ok(Vec::new());
    }

    pages.sort_by_key(|p| p.start_offset);

    let total_size = pages.iter()
        .map(|p| p.start_offset + p.data_size)
        .max()
        .unwrap_or(0);

    let mut assembled = vec![0u8; total_size];

    for page in &pages {
        // Header is 20 bytes for R2007 system-sections, 32 for R2010+ XOR-encrypted pages.
        let body_offset = page.file_offset + page.hdr_size;
        if body_offset + page.comp_size > data.len() { continue; }

        let raw = &data[body_offset..body_offset + page.comp_size];
        // Strip RS parity before decompression
        let stripped = strip_rs_parity(raw);

        let decompressed = if page.compressed {
            match decompress_r2004(&stripped, page.data_size) {
                Ok(d) => d,
                Err(_) => {
                    // Fallback: try without RS stripping (some pages may not be RS-encoded)
                    match decompress_r2004(raw, page.data_size) {
                        Ok(d) => d,
                        Err(_) => continue,
                    }
                }
            }
        } else {
            stripped
        };

        let dst_end = (page.start_offset + decompressed.len()).min(assembled.len());
        let copy_len = dst_end - page.start_offset;
        if copy_len > 0 {
            assembled[page.start_offset..page.start_offset + copy_len]
                .copy_from_slice(&decompressed[..copy_len]);
        }
    }

    Ok(assembled)
}

/// Read the section map directly from a page number.
///
/// For R2010+ (AC1024+), `section_map_id` from the encrypted file header is
/// actually a page number (key in `page_map`), not a section number. The page
/// at that offset contains the section map data as a system page with a raw
/// 20-byte header (NOT XOR-encrypted). The header format for sentinel
/// 0x4163003B is: [type(4), sec_num(4), data_size(4), comp_type(4), checksum(4)].
/// The compressed body size is NOT stored explicitly Ã¢â‚¬â€ we compute it from the
/// page allocation size in the page map.
pub fn read_section_map_by_page(
    data: &[u8],
    page_map: &HashMap<i32, usize>,
    section_map_id: i32,
) -> Result<Vec<u8>, DwgError> {
    let file_offset = match page_map.get(&section_map_id) {
        Some(&off) => off,
        None => {
            crate::dwg_dbg!("[dwg-dbg] read_section_map_by_page: page {} not in page_map", section_map_id);
            return Ok(Vec::new());
        }
    };

    if file_offset + 20 > data.len() {
        return Ok(Vec::new());
    }

    // Read the raw 20-byte system page header
    let sec_type = i32::from_le_bytes([
        data[file_offset], data[file_offset + 1],
        data[file_offset + 2], data[file_offset + 3],
    ]);

    // Dump raw header
    let raw_hex: String = data[file_offset..(file_offset + 20).min(data.len())].iter()
        .map(|b| format!("{:02x}", b)).collect::<Vec<_>>().join(" ");
    crate::dwg_dbg!("[dwg-dbg] read_section_map_by_page: page={} offset=0x{:X} raw20: {}",
        section_map_id, file_offset, raw_hex);

    // System page sentinels: 0x4163003B (section info/map) or 0x41630E3B (page map)
    let is_system = sec_type == 0x4163003B || sec_type == 0x41630E3B;

    if is_system {
        // System page header: [type(4), field1(4), field2(4), comp_type(4), checksum(4)]
        // For 0x4163003B: field1=sec_number, field2=data_size
        // For 0x41630E3B: field1=data_size, field2=comp_size
        let data_size = if sec_type == 0x4163003B {
            u32::from_le_bytes([
                data[file_offset + 8], data[file_offset + 9],
                data[file_offset + 10], data[file_offset + 11],
            ]) as usize
        } else {
            u32::from_le_bytes([
                data[file_offset + 4], data[file_offset + 5],
                data[file_offset + 6], data[file_offset + 7],
            ]) as usize
        };
        let comp_type = u32::from_le_bytes([
            data[file_offset + 12], data[file_offset + 13],
            data[file_offset + 14], data[file_offset + 15],
        ]);
        let compressed = comp_type == 2;

        // Compute body size: find the allocation size for this page from page_map.
        // The page_map maps page_num -> cumulative file offset. The page allocation
        // size is the difference between this page's offset and the next page's offset.
        let mut sorted_offsets: Vec<usize> = page_map.values().copied().collect();
        sorted_offsets.sort();
        let body_size = sorted_offsets.iter()
            .find(|&&o| o > file_offset)
            .map(|&next| next - file_offset - 20)
            .unwrap_or_else(|| data.len() - file_offset - 20);
        let body_size = body_size.min(data.len() - file_offset - 20);

        crate::dwg_dbg!("[dwg-dbg]   system page: sec_type=0x{:08X} data_size={} comp_type={} body_size={}",
            sec_type as u32, data_size, comp_type, body_size);

        let body_start = file_offset + 20;
        if body_size == 0 || body_start + body_size > data.len() {
            return Ok(Vec::new());
        }
        let body = &data[body_start..body_start + body_size];

        if compressed {
            // per ODA Ã‚Â§4.7 LZ77 may emit past declared decomp_size; use a
            // generous target so END opcode terminates naturally, not the
            // size cap. The declared data_size is unreliable for the
            // section-map page on this fixture (reports 530 while the true
            // map extends further, leaving 8 of 12 entries truncated).
            let ceiling = data_size
                .max(4 * body_size)
                .max(body_size * 16)
                .max(0x4000);
            crate::dwg_dbg!("[dwg-dbg]   smap decompress: data_size={} ceiling={}", data_size, ceiling);
            let out = decompress_r2004_generous(body, ceiling)
                .or_else(|_| {
                    let stripped = strip_rs_parity(body);
                    decompress_r2004_generous(&stripped, ceiling)
                })
                .or_else(|_| Ok::<Vec<u8>, DwgError>(body.to_vec()))?;
            crate::dwg_dbg!("[dwg-dbg]   smap decompressed bytes={}", out.len());
            Ok(out)
        } else {
            Ok(body[..data_size.min(body.len())].to_vec())
        }
    } else {
        // Not a system page Ã¢â‚¬â€ try XOR-decrypted 32-byte data page header
        if file_offset + 32 > data.len() { return Ok(Vec::new()); }
        let mask = 0x4164536Bu32 ^ (file_offset as u32);
        let mut hdr = [0u8; 32];
        hdr.copy_from_slice(&data[file_offset..file_offset + 32]);
        for dw in 0..8 {
            let off = dw * 4;
            let val = u32::from_le_bytes([hdr[off], hdr[off+1], hdr[off+2], hdr[off+3]]);
            let dec = val ^ mask;
            hdr[off..off+4].copy_from_slice(&dec.to_le_bytes());
        }
        let xor_ds = u32::from_le_bytes([hdr[8], hdr[9], hdr[10], hdr[11]]) as usize;
        let xor_cs = u32::from_le_bytes([hdr[12], hdr[13], hdr[14], hdr[15]]) as usize;
        let xor_st = i32::from_le_bytes([hdr[0], hdr[1], hdr[2], hdr[3]]);
        crate::dwg_dbg!("[dwg-dbg]   xor-dec: sec_type=0x{:08X} ds={} cs={}", xor_st as u32, xor_ds, xor_cs);

        if xor_ds <= 0x1000000 && xor_cs <= 0x1000000 && xor_cs > 0 {
            let body_start = file_offset + 32;
            if body_start + xor_cs > data.len() { return Ok(Vec::new()); }
            let body = &data[body_start..body_start + xor_cs];
            let compressed = xor_st == 2 || (xor_st as u32) >= 0x41000000;
            if compressed {
                // per ODA Ã‚Â§4.7 LZ77 terminates on END (0x11); use a generous
                // target so the section-map stream terminates naturally even
                // when the declared data_size understates the emitted bytes.
                let ceiling = xor_ds.max(4 * xor_cs).max(xor_cs * 16).max(0x4000);
                decompress_r2004_generous(body, ceiling)
                    .or_else(|_| {
                        let stripped = strip_rs_parity(body);
                        decompress_r2004_generous(&stripped, ceiling)
                    })
                    .or_else(|_| Ok::<Vec<u8>, DwgError>(body.to_vec()))
            } else {
                Ok(body[..xor_ds.min(body.len())].to_vec())
            }
        } else {
            Ok(Vec::new())
        }
    }
}

/// Find a section by type ID or by name string.
pub fn find_section(
    sections: &[R2007SectionInfo],
    type_id: i32,
    name_substr: &str,
) -> Option<i32> {
    // First try by type ID
    if let Some(s) = sections.iter().find(|s| s.section_type == type_id) {
        return Some(s.section_number);
    }
    // Fallback: match by name substring
    if !name_substr.is_empty() {
        if let Some(s) = sections.iter().find(|s| s.name.contains(name_substr)) {
            return Some(s.section_number);
        }
    }
    None
}

// ---------------------------------------------------------------------------
// R2018 (AC1032) sentinel-based section reading
// ---------------------------------------------------------------------------

/// System section sentinel magic values (first 4 bytes of 20-byte header).
pub const SENTINEL_PAGE_MAP: u32 = 0x41630E3B;
pub const SENTINEL_SECTION_MAP: u32 = 0x4163003B;

/// Scan the file for a system section sentinel and return the decompressed body.
///
/// R2018 system sections (page map, section map) have a 20-byte header:
///   +0: sentinel magic (4 bytes)
///   +4: data_size (4 bytes, decompressed)
///   +8: comp_size (4 bytes, compressed body)
///   +12: compression_type (4 bytes, 2=compressed)
///   +16: checksum (4 bytes)
/// Followed by comp_size bytes of (possibly compressed) body.
///
/// System section bodies are NOT RS-encoded Ã¢â‚¬â€ use raw body directly.
pub fn scan_system_section(
    data: &[u8],
    sentinel: u32,
) -> Vec<(usize, Vec<u8>)> {
    let needle = sentinel.to_le_bytes();
    let mut results = Vec::new();

    let mut pos = 0x100; // Skip file header area
    while pos + 20 <= data.len() {
        if data[pos..pos + 4] != needle {
            pos += 1;
            continue;
        }

        let data_size = u32::from_le_bytes([
            data[pos + 4], data[pos + 5], data[pos + 6], data[pos + 7],
        ]) as usize;
        let comp_size = u32::from_le_bytes([
            data[pos + 8], data[pos + 9], data[pos + 10], data[pos + 11],
        ]) as usize;
        let comp_type = u32::from_le_bytes([
            data[pos + 12], data[pos + 13], data[pos + 14], data[pos + 15],
        ]);

        let body_start = pos + 20;
        if comp_size == 0 || comp_size > 0x1000000 || data_size > 0x1000000 {
            pos += 1;
            continue;
        }
        if body_start + comp_size > data.len() {
            pos += 1;
            continue;
        }

        let compressed = comp_type == 2;
        let raw = &data[body_start..body_start + comp_size];

        let body = if compressed {
            match decompress_r2004(raw, data_size) {
                Ok(d) => d,
                Err(_) => {
                    pos += 1;
                    continue;
                }
            }
        } else {
            raw.to_vec()
        };

        crate::dwg_dbg!(
            "[dwg-dbg] sentinel 0x{:08X} found @0x{:X}: ds={} cs={} comp={} body={}B",
            sentinel, pos, data_size, comp_size, compressed, body.len()
        );
        results.push((pos, body));
        pos = body_start + comp_size;
    }

    results
}

/// One page entry within an R2018 section.
#[derive(Debug, Clone)]
pub struct R2018PageEntry {
    pub page_number: i32,
    pub comp_size: u32,
    pub start_offset: u64,  // offset within assembled section
}

/// R2018 section info extracted from the section map.
/// Contains page list entries for assembling section data.
#[derive(Debug, Clone)]
pub struct R2018SectionEntry {
    pub section_type: i32,
    pub name: String,
    pub pages: Vec<R2018PageEntry>,
    pub max_decomp_size: u32,
    pub compressed: bool,
}

/// Parse the R2018 section map body (ODA Ã‚Â§4.5 format).
///
/// Same format as R2004 but found via sentinel scan rather than page assembly.
/// Each entry:
///   +0:  num_pages (RL)
///   +4:  max_decomp_size (RL)
///   +8:  unknown (RL)
///   +12: compressed (RL, 1 or 2)
///   +16: section_type hash (RL)
///   +20: encrypted (RL)
///   +24: name (64 bytes, null-terminated ASCII)
///   +88: num_page_entries (RL)
///   +92: page entries (page_number RL, data_size RL) Ãƒâ€” N
pub fn parse_r2018_section_map(map_data: &[u8]) -> Vec<R2018SectionEntry> {
    // R2018 section map format (observed from test files):
    //
    // Global header (variable size, ~20 bytes):
    //   +0:  num_descriptions (RL)
    //   +4:  0x02 (RL)
    //   +8:  max_decomp_size (RL) = 0x7400
    //   +12: unknown (RL)
    //   +16: num_descriptions again (RL)
    //
    // Per data section entry:
    //   +0:  data_size (RLL = 8 bytes)
    //   +8:  max_pages (RL)
    //   +12: num_pages (RL)
    //   +16: max_decomp_size (RL) = 0x7400
    //   +20: unknown (RL)
    //   +24: compressed (RL, 1=uncompressed, 2=compressed)
    //   +28: section_id (RL)
    //   +32: encrypted (RL)
    //   +36: name[64] (ASCII, null-padded)
    //   +100: page entries Ãƒâ€” num_pages, each 16 bytes:
    //      +0: page_data_offset (RLL = 8 bytes)
    //      +8: page_size (RL)
    //      +12: page_id (RL) = page number in page map
    //
    // Name-to-section-type mapping:
    let name_to_type = |n: &str| -> i32 {
        match n {
            "AcDb:Header" => 0x4163003b_u32 as i32,
            "AcDb:Classes" => 0x4163003c_u32 as i32,
            "AcDb:ObjFreeSpace" => 0x4163003d_u32 as i32,
            "AcDb:Template" => 0x4163003e_u32 as i32,
            "AcDb:Handles" => 0x4163003f_u32 as i32,
            "AcDb:AcDbObjects" => 0x41630040_u32 as i32,
            _ => 0,
        }
    };

    // Find all "AcDb:" name locations to anchor our parsing
    let mut name_positions: Vec<(usize, String)> = Vec::new();
    for scan_pos in 0..map_data.len().saturating_sub(5) {
        if &map_data[scan_pos..scan_pos + 5] == b"AcDb:" {
            let name_end = (scan_pos + 64).min(map_data.len());
            let name: String = map_data[scan_pos..name_end]
                .iter()
                .take_while(|&&b| b != 0 && b.is_ascii())
                .map(|&b| b as char)
                .collect();
            name_positions.push((scan_pos, name));
        }
    }

    if name_positions.is_empty() {
        crate::dwg_dbg!("[dwg-dbg] r2018 section_map: no AcDb: names found");
        return Vec::new();
    }
    crate::dwg_dbg!("[dwg-dbg] r2018 section_map: found {} AcDb: names", name_positions.len());

    // Determine entry header size by examining the gap before the first name.
    // The name sits at a fixed offset within each entry. Try to auto-detect
    // by checking which header size produces valid page entries.
    //
    // Auto-detect entry layout by computing gaps between consecutive names.
    // Entry = header + name[64] + page_entries.
    // header_size is constant; page_entry_size * num_pages varies.
    // For entries with 0 extra pages (next_name - this_name = header_size + 64),
    // we can deduce header_size.

    // Try each header_size and page_entry_size combination
    for &hdr_size in &[32usize, 36, 28, 24, 40] {
        for &pe_size in &[16usize, 12, 8] {
            let result = try_parse_r2018_sections(
                map_data, &name_positions, hdr_size, pe_size, &name_to_type,
            );
            if !result.is_empty() {
                return result;
            }
        }
    }

    crate::dwg_dbg!("[dwg-dbg] r2018 section_map: failed to parse any entries");
    Vec::new()
}

fn try_parse_r2018_sections(
    map_data: &[u8],
    name_positions: &[(usize, String)],
    hdr_size: usize,
    pe_size: usize,
    name_to_type: &dyn Fn(&str) -> i32,
) -> Vec<R2018SectionEntry> {
    let mut sections = Vec::new();
    let mut all_aligned = true;

    for (i, (name_off, name)) in name_positions.iter().enumerate() {
        if *name_off < hdr_size { return Vec::new(); }
        let entry_start = name_off - hdr_size;

        // Read num_pages Ã¢â‚¬â€ try offset +8 first, then +12
        let num_pages = {
            let mut np = 0u32;
            for &np_off in &[8usize, 12, 16] {
                if entry_start + np_off + 4 <= map_data.len() {
                    let val = u32::from_le_bytes([
                        map_data[entry_start + np_off],
                        map_data[entry_start + np_off + 1],
                        map_data[entry_start + np_off + 2],
                        map_data[entry_start + np_off + 3],
                    ]);
                    if val < 50000 { np = val; break; }
                }
            }
            np
        };

        // Read data_size (first 8 bytes as RLL).
        // Currently unused — the loop below reads page entries by `pe_size`
        // stride, not by total data_size. Kept (underscore-prefixed) as a
        // bound-check candidate for the next round.
        let _data_size = if entry_start + 8 <= map_data.len() {
            u64::from_le_bytes([
                map_data[entry_start], map_data[entry_start + 1],
                map_data[entry_start + 2], map_data[entry_start + 3],
                map_data[entry_start + 4], map_data[entry_start + 5],
                map_data[entry_start + 6], map_data[entry_start + 7],
            ])
        } else { 0 };

        // Read compressed flag Ã¢â‚¬â€ typically at hdr_size - 12 or hdr_size - 8
        let compressed = {
            let mut comp = 2u32; // default compressed
            for &off in &[20usize, 16, 24] {
                if off + 4 <= hdr_size && entry_start + off + 4 <= map_data.len() {
                    let val = u32::from_le_bytes([
                        map_data[entry_start + off],
                        map_data[entry_start + off + 1],
                        map_data[entry_start + off + 2],
                        map_data[entry_start + off + 3],
                    ]);
                    if val == 1 || val == 2 { comp = val; break; }
                }
            }
            comp
        };

        // Pages start after the 64-byte name
        let pages_start = name_off + 64;
        let expected_end = pages_start + (num_pages as usize) * pe_size;

        // Check alignment with next entry
        if let Some((next_off, _)) = name_positions.get(i + 1) {
            let next_entry_start = next_off - hdr_size;
            if expected_end != next_entry_start {
                all_aligned = false;
                break;
            }
        }

        // Read page entries with full info
        let mut pages = Vec::new();
        for pi in 0..num_pages as usize {
            let pe = pages_start + pi * pe_size;
            if pe + pe_size > map_data.len() { break; }

            let page_num = i32::from_le_bytes([
                map_data[pe], map_data[pe + 1],
                map_data[pe + 2], map_data[pe + 3],
            ]);
            let comp_size = if pe_size >= 8 {
                u32::from_le_bytes([
                    map_data[pe + 4], map_data[pe + 5],
                    map_data[pe + 6], map_data[pe + 7],
                ])
            } else { 0 };
            let start_offset = if pe_size >= 16 {
                u64::from_le_bytes([
                    map_data[pe + 8], map_data[pe + 9],
                    map_data[pe + 10], map_data[pe + 11],
                    map_data[pe + 12], map_data[pe + 13],
                    map_data[pe + 14], map_data[pe + 15],
                ])
            } else { 0 };

            pages.push(R2018PageEntry { page_number: page_num, comp_size, start_offset });
        }

        let section_type = name_to_type(name);

        // Determine max_decomp_size from header or use default
        let max_decomp = if hdr_size >= 20 && entry_start + 16 + 4 <= map_data.len() {
            let v = u32::from_le_bytes([
                map_data[entry_start + 16], map_data[entry_start + 17],
                map_data[entry_start + 18], map_data[entry_start + 19],
            ]);
            if v >= 0x100 && v <= 0x100000 { v } else { 0x7400 }
        } else { 0x7400 };

        sections.push(R2018SectionEntry {
            section_type,
            name: name.clone(),
            pages,
            max_decomp_size: max_decomp,
            compressed: compressed == 2,
        });
    }

    // per ODA Ã‚Â§4.5 section map contains ALL section descriptors in file order;
    // name filtering belongs to the caller, not the parser. We only require
    // that descriptors are layout-aligned (i.e. the header/page-entry sizes we
    // picked produce entries that tile the buffer contiguously). Downstream
    // code re-discovers essential sections by content-probing.
    if all_aligned && !sections.is_empty() {
        crate::dwg_dbg!(
            "[dwg-dbg] r2018 section_map: parsed {} entries (hdr={}, pe={})",
            sections.len(), hdr_size, pe_size
        );
        for s in &sections {
            crate::dwg_dbg!(
                "[dwg-dbg]   name={:?} type=0x{:08X} pages={} max_decomp=0x{:X} comp={}",
                s.name, s.section_type as u32, s.pages.len(), s.max_decomp_size, s.compressed
            );
            if !s.pages.is_empty() {
                let first_3: Vec<_> = s.pages.iter().take(3)
                    .map(|p| format!("pg{}@off{}(cs={})", p.page_number, p.start_offset, p.comp_size))
                    .collect();
                crate::dwg_dbg!("[dwg-dbg]     pages[..3]: {:?}", first_3);
            }
        }
        return sections;
    }

    Vec::new()
}

/// Assemble an R2018 section by reading page bodies directly from file offsets.
///
/// R2018 data pages do NOT have per-page XOR-encrypted headers. The page map
/// offset points directly to the compressed page body. Each page contributes
/// up to `max_decomp_size` bytes to the section.
pub fn assemble_r2018_section(
    data: &[u8],
    page_map: &HashMap<i32, usize>,
    entry: &R2018SectionEntry,
) -> Result<Vec<u8>, DwgError> {
    if entry.pages.is_empty() {
        return Ok(Vec::new());
    }

    let max_decomp = entry.max_decomp_size as usize;
    if max_decomp == 0 {
        return Ok(Vec::new());
    }

    // Calculate total size from per-page start_offsets
    let total_size = entry.pages.iter()
        .map(|p| p.start_offset as usize + max_decomp)
        .max()
        .unwrap_or(entry.pages.len() * max_decomp);

    if total_size > 0x10000000 {
        return Err(DwgError::InvalidBinary(
            format!("R2018: section {:?} too large: {}B", entry.name, total_size),
        ));
    }

    let mut assembled = vec![0u8; total_size];
    let mut valid_pages = 0usize;
    let mut failed_pages = 0usize;

    for (idx, page_entry) in entry.pages.iter().enumerate() {
        let page_num = page_entry.page_number;
        let file_offset = match page_map.get(&page_num) {
            Some(&off) => off,
            None => {
                if idx < 5 || idx == entry.pages.len() - 1 {
                    crate::dwg_dbg!("[dwg-dbg] r2018 assemble {:?}: page {} not in page_map",
                        entry.name, page_num);
                }
                failed_pages += 1;
                continue;
            }
        };

        // per ODA Ã‚Â§4.6: XOR-decrypt the 32-byte page header to read the
        // authoritative per-page compressed body size (dw2) and decompressed
        // valid size (dw3). The section map's comp_size approximates dw2 but
        // may differ slightly; dw3 is NOT in the section map and must come
        // from the page header to avoid zero-padding the decompressed buffer.
        let (page_comp_size, page_decomp_size, hdr_size) =
            if file_offset + 32 <= data.len() {
                let mask = 0x4164536Bu32 ^ (file_offset as u32);
                let mut hdr = [0u8; 32];
                hdr.copy_from_slice(&data[file_offset..file_offset + 32]);
                for dw in 0..8 {
                    let off = dw * 4;
                    let val = u32::from_le_bytes([hdr[off], hdr[off+1], hdr[off+2], hdr[off+3]]);
                    let dec = val ^ mask;
                    hdr[off..off+4].copy_from_slice(&dec.to_le_bytes());
                }
                let xst = i32::from_le_bytes([hdr[0], hdr[1], hdr[2], hdr[3]]);
                let xcomp = u32::from_le_bytes([hdr[8], hdr[9], hdr[10], hdr[11]]) as usize;
                let xdecomp = u32::from_le_bytes([hdr[12], hdr[13], hdr[14], hdr[15]]) as usize;
                if xst == 0x4163043B && xcomp > 0 && xdecomp > 0
                    && xcomp <= 0x1000000 && xdecomp <= 0x1000000
                {
                    (xcomp, xdecomp, 32usize)
                } else {
                    // Header didn't decrypt cleanly Ã¢â‚¬â€ fall back to section map
                    let cs = if page_entry.comp_size > 0 {
                        page_entry.comp_size as usize
                    } else {
                        find_page_file_size(page_map, page_num, data.len())
                    };
                    (cs, max_decomp, 0usize)
                }
            } else {
                let cs = if page_entry.comp_size > 0 {
                    page_entry.comp_size as usize
                } else {
                    find_page_file_size(page_map, page_num, data.len())
                };
                (cs, max_decomp, 0usize)
            };

        if file_offset + hdr_size + page_comp_size > data.len() {
            failed_pages += 1;
            continue;
        }

        let raw = &data[file_offset + hdr_size..file_offset + hdr_size + page_comp_size];

        // Use start_offset from the section map for proper page placement
        let dst_offset = page_entry.start_offset as usize;
        if dst_offset >= assembled.len() {
            failed_pages += 1;
            continue;
        }

        if entry.compressed {
            // Decompress to the page-header's dw3 (true decompressed size),
            // not max_decomp. This prevents zero-padding tails that blow up
            // handle-map parsing with phantom entries.
            let decompressed = decompress_r2004(raw, page_decomp_size)
                .or_else(|_| {
                    let stripped = strip_rs_parity(raw);
                    decompress_r2004(&stripped, page_decomp_size)
                });

            match decompressed {
                Ok(d) => {
                    let copy_len = d.len().min(assembled.len() - dst_offset);
                    assembled[dst_offset..dst_offset + copy_len]
                        .copy_from_slice(&d[..copy_len]);
                    valid_pages += 1;
                }
                Err(e) => {
                    if idx < 5 || idx == entry.pages.len() - 1 {
                        crate::dwg_dbg!(
                            "[dwg-dbg] r2018 assemble {:?}: page {} @0x{:X} cs={} dcs={} decompress failed: {:?}",
                            entry.name, page_num, file_offset, page_comp_size, page_decomp_size, e
                        );
                    }
                    failed_pages += 1;
                }
            }
        } else {
            let copy_len = raw.len().min(page_decomp_size).min(assembled.len() - dst_offset);
            assembled[dst_offset..dst_offset + copy_len]
                .copy_from_slice(&raw[..copy_len]);
            valid_pages += 1;
        }
    }

    // Trim trailing zeros
    let actual_len = assembled.iter().rposition(|&b| b != 0)
        .map(|p| p + 1)
        .unwrap_or(0);
    assembled.truncate(actual_len);

    crate::dwg_dbg!(
        "[dwg-dbg] r2018 assemble {:?}: {}/{} valid, {} failed, result={}B",
        entry.name, valid_pages, entry.pages.len(), failed_pages, assembled.len()
    );

    Ok(assembled)
}

/// Find the file size of a page by looking at adjacent page offsets.
fn find_page_file_size(
    page_map: &HashMap<i32, usize>,
    page_num: i32,
    file_len: usize,
) -> usize {
    let &my_offset = page_map.get(&page_num).unwrap();

    // Find the next page that starts after this one
    let mut next_offset = file_len;
    for &off in page_map.values() {
        if off > my_offset && off < next_offset {
            next_offset = off;
        }
    }

    next_offset - my_offset
}
