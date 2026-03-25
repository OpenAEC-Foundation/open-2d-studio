//! R2007+ (AC1021-AC1032) page-based file structure parser.
//!
//! R2007 introduced a completely different file organization compared to
//! R2000/R2004.  The file is divided into fixed-size pages.  Section data
//! is spread across multiple data pages identified by name strings rather
//! than numeric IDs.  Data pages use Reed-Solomon RS(255,239) coding for
//! error correction -- for valid files we simply skip the parity bytes.

use std::collections::HashMap;
use crate::error::DwgError;
use crate::parser::decompress_r2004;

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
/// R2007+ uses the same LCG-based XOR as R2004 for this particular
/// metadata block.  The decrypted block contains pointers to the
/// section page map and related metadata.
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
/// Returns a mapping of page indices to file offsets, identical in
/// concept to R2004 but with RS-encoded page data.
pub fn read_page_map(
    data: &[u8],
    enc_hdr: &[u8],
) -> Result<(HashMap<i32, usize>, usize), DwgError> {
    let page_size = if enc_hdr.len() >= 0x2C {
        u32::from_le_bytes([
            enc_hdr[0x28], enc_hdr[0x29], enc_hdr[0x2A], enc_hdr[0x2B],
        ]) as usize
    } else {
        R2007_PAGE_SIZE
    };

    let map_addr = if enc_hdr.len() >= 0x24 {
        u32::from_le_bytes([
            enc_hdr[0x20], enc_hdr[0x21], enc_hdr[0x22], enc_hdr[0x23],
        ]) as usize + 0x100
    } else {
        return Err(DwgError::InvalidBinary(
            "R2007+: cannot locate section page map".into(),
        ));
    };

    if map_addr + 32 > data.len() {
        return Err(DwgError::InvalidBinary(
            "R2007+: page map address out of bounds".into(),
        ));
    }

    // Read page header at map_addr (same 32-byte format as R2004)
    let section_type = i32::from_le_bytes([
        data[map_addr], data[map_addr + 1], data[map_addr + 2], data[map_addr + 3],
    ]);
    let data_size = u32::from_le_bytes([
        data[map_addr + 8], data[map_addr + 9],
        data[map_addr + 10], data[map_addr + 11],
    ]) as usize;
    let comp_size = u32::from_le_bytes([
        data[map_addr + 12], data[map_addr + 13],
        data[map_addr + 14], data[map_addr + 15],
    ]) as usize;

    let body = map_addr + 32;
    if body + comp_size > data.len() {
        return Err(DwgError::InvalidBinary(
            "R2007+: page map data out of bounds".into(),
        ));
    }

    // For R2007+ the page body may be RS-encoded -- strip parity first
    let raw = &data[body..body + comp_size];
    let stripped = strip_rs_parity(raw);

    let map_data = if section_type == 2 {
        decompress_r2004(&stripped, data_size)?
    } else {
        stripped
    };

    // Parse entries: (section_number: i32, page_data_size: i32) pairs
    let mut page_map = HashMap::new();
    let mut page_idx: i32 = 0;
    let mut pos = 0;
    while pos + 7 < map_data.len() {
        let sec_num = i32::from_le_bytes([
            map_data[pos], map_data[pos + 1], map_data[pos + 2], map_data[pos + 3],
        ]);
        let _psize = i32::from_le_bytes([
            map_data[pos + 4], map_data[pos + 5], map_data[pos + 6], map_data[pos + 7],
        ]);
        pos += 8;

        if sec_num > 0 {
            let file_offset = 0x100 + (page_idx as usize) * page_size;
            page_map.insert(sec_num, file_offset);
        }
        page_idx += 1;
    }

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
) -> Result<Vec<u8>, DwgError> {
    struct PageInfo {
        file_offset: usize,
        data_size: usize,
        comp_size: usize,
        start_offset: usize,
        compressed: bool,
    }

    let mut pages = Vec::new();

    for (&_sec_num, &file_offset) in page_map {
        if file_offset + 32 > data.len() { continue; }

        let sec_type = i32::from_le_bytes([
            data[file_offset], data[file_offset + 1],
            data[file_offset + 2], data[file_offset + 3],
        ]);
        let sec_number = i32::from_le_bytes([
            data[file_offset + 4], data[file_offset + 5],
            data[file_offset + 6], data[file_offset + 7],
        ]);

        if sec_number != target_section { continue; }
        if sec_type <= 0 { continue; }

        let dsize = u32::from_le_bytes([
            data[file_offset + 8], data[file_offset + 9],
            data[file_offset + 10], data[file_offset + 11],
        ]) as usize;
        let csize = u32::from_le_bytes([
            data[file_offset + 12], data[file_offset + 13],
            data[file_offset + 14], data[file_offset + 15],
        ]) as usize;
        let start_off = u32::from_le_bytes([
            data[file_offset + 16], data[file_offset + 17],
            data[file_offset + 18], data[file_offset + 19],
        ]) as usize;

        pages.push(PageInfo {
            file_offset,
            data_size: dsize,
            comp_size: csize,
            start_offset: start_off,
            compressed: sec_type == 2,
        });
    }

    if pages.is_empty() {
        return Ok(Vec::new());
    }

    pages.sort_by_key(|p| p.start_offset);

    let total_size = pages.iter()
        .map(|p| p.start_offset + p.data_size)
        .max()
        .unwrap_or(0);

    let mut assembled = vec![0u8; total_size];

    for page in &pages {
        let body_offset = page.file_offset + 32;
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
