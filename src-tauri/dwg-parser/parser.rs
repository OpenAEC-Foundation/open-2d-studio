//! Pure-Rust DWG binary file parser.
//!
//! Parses DWG files from raw bytes without external libraries.
//! Currently supports R2000 (AC1015) with graceful degradation for other versions.

use std::collections::HashMap;

use crate::error::DwgError;
use crate::bitreader::DwgBitReader;

// ---------------------------------------------------------------------------
// DWG version enum
// ---------------------------------------------------------------------------

/// Supported DWG format versions.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum DwgVersion {
    R13,   // AC1012
    R14,   // AC1014
    R2000, // AC1015
    R2004, // AC1018
    R2007, // AC1021
    R2010, // AC1024
    R2013, // AC1027
    R2018, // AC1032
}

impl DwgVersion {
    fn from_code(code: &str) -> Option<Self> {
        match code {
            "AC1012" => Some(Self::R13),
            "AC1014" => Some(Self::R14),
            "AC1015" => Some(Self::R2000),
            "AC1018" => Some(Self::R2004),
            "AC1021" => Some(Self::R2007),
            "AC1024" => Some(Self::R2010),
            "AC1027" => Some(Self::R2013),
            "AC1032" => Some(Self::R2018),
            _ => None,
        }
    }

    pub fn is_r2007_plus(self) -> bool {
        self >= Self::R2007
    }

    pub fn is_r2004_plus(self) -> bool {
        self >= Self::R2004
    }
}

// ---------------------------------------------------------------------------
// Version constants
// ---------------------------------------------------------------------------
const VERSION_MAP: &[(&[u8], &str)] = &[
    (b"AC1012", "R13"),
    (b"AC1014", "R14"),
    (b"AC1015", "R2000"),
    (b"AC1018", "R2004"),
    (b"AC1021", "R2007"),
    (b"AC1024", "R2010"),
    (b"AC1027", "R2013"),
    (b"AC1032", "R2018"),
];

// Section record IDs (R2000)
const SECTION_HEADER: u8 = 0;
const SECTION_CLASSES: u8 = 1;
const SECTION_OBJECT_MAP: u8 = 2;

// Object type constants
fn obj_type_name(type_num: u16) -> Option<&'static str> {
    match type_num {
        0x01 => Some("TEXT"),
        0x02 => Some("ATTRIB"),
        0x03 => Some("ATTDEF"),
        0x04 => Some("BLOCK"),
        0x05 => Some("ENDBLK"),
        0x06 => Some("SEQEND"),
        0x07 => Some("INSERT"),
        0x08 => Some("MINSERT"),
        0x0A => Some("VERTEX_2D"),
        0x0B => Some("VERTEX_3D"),
        0x0F => Some("POLYLINE_2D"),
        0x10 => Some("POLYLINE_3D"),
        0x11 => Some("ARC"),
        0x12 => Some("CIRCLE"),
        0x13 => Some("LINE"),
        0x14 => Some("DIMENSION_ORDINATE"),
        0x15 => Some("DIMENSION_LINEAR"),
        0x16 => Some("DIMENSION_ALIGNED"),
        0x17 => Some("DIMENSION_ANG3PT"),
        0x18 => Some("DIMENSION_ANG2LN"),
        0x19 => Some("DIMENSION_RADIUS"),
        0x1A => Some("DIMENSION_DIAMETER"),
        0x1B => Some("POINT"),
        0x1C => Some("3DFACE"),
        0x1D => Some("POLYLINE_PFACE"),
        0x1E => Some("TRACE"),
        0x1F => Some("SOLID"),
        0x20 => Some("VIEWPORT"),
        0x22 => Some("VIEWPORT"),
        0x23 => Some("ELLIPSE"),
        0x24 => Some("SPLINE"),
        0x28 => Some("RAY"),
        0x29 => Some("XLINE"),
        0x2A => Some("DICTIONARY"),
        0x2C => Some("MTEXT"),
        0x2D => Some("LEADER"),
        0x2F => Some("TOLERANCE"),
        0x30 => Some("BLOCK_CONTROL"),
        0x31 => Some("BLOCK_HEADER"),
        0x32 => Some("LAYER_CONTROL"),
        0x33 => Some("LAYER"),
        0x34 => Some("STYLE_CONTROL"),
        0x35 => Some("STYLE"),
        0x38 => Some("LTYPE_CONTROL"),
        0x39 => Some("LTYPE"),
        0x4D => Some("LWPOLYLINE"),
        0x4E => Some("HATCH"),
        0x4F => Some("XRECORD"),
        0x50 => Some("PLACEHOLDER"),
        0x52 => Some("LAYOUT"),
        _ => None,
    }
}

fn is_entity_type(type_num: u16) -> bool {
    // TEXT(0x01) through XLINE(0x29), plus MTEXT, LEADER, LWPOLYLINE, HATCH
    // Exclude control objects and table entries
    let table_controls = [0x30u16, 0x32, 0x34, 0x38, 0x3C, 0x3E, 0x40, 0x42, 0x44, 0x46];
    let table_entries = [0x31u16, 0x33, 0x35, 0x39, 0x3D, 0x3F, 0x41, 0x43, 0x45, 0x47];
    let non_entities = [0x2Au16, 0x48, 0x49, 0x4F, 0x50, 0x51, 0x52];

    if table_controls.contains(&type_num) { return false; }
    if table_entries.contains(&type_num) { return false; }
    if non_entities.contains(&type_num) { return false; }

    (0x01..=0x29).contains(&type_num)
        || type_num == 0x2C  // MTEXT
        || type_num == 0x2D  // LEADER
        || type_num == 0x2F  // TOLERANCE
        || type_num == 0x4D  // LWPOLYLINE
        || type_num == 0x4E  // HATCH
}

// Header sentinels (R2000)
const HEADER_SENTINEL_START: [u8; 16] = [
    0xCF, 0x7B, 0x1F, 0x23, 0xFD, 0xDE, 0x38, 0xA9,
    0x5F, 0x7C, 0x68, 0xB8, 0x4E, 0x6D, 0x33, 0x5F,
];

const CLASSES_SENTINEL_START: [u8; 16] = [
    0x8D, 0xA1, 0xC4, 0xB8, 0xC4, 0xA9, 0xF8, 0xC5,
    0xC0, 0xDC, 0xF4, 0x5F, 0xE7, 0xCF, 0xB6, 0x8A,
];

// ---------------------------------------------------------------------------
// R2004+ section type hashes
// ---------------------------------------------------------------------------

const SECTION_TYPE_HEADER: i32 = 0x4163003b_u32 as i32;
const SECTION_TYPE_CLASSES: i32 = 0x4163003c_u32 as i32;
const SECTION_TYPE_OBJFREESPACE: i32 = 0x4163003d_u32 as i32;
#[allow(dead_code)]
const SECTION_TYPE_TEMPLATE: i32 = 0x4163003e_u32 as i32;
const SECTION_TYPE_HANDLES: i32 = 0x4163003f_u32 as i32;
const SECTION_TYPE_OBJECTS: i32 = 0x41630040_u32 as i32;

// ---------------------------------------------------------------------------
// R2004 section info (used by section map parser)
// ---------------------------------------------------------------------------

#[allow(dead_code)]
struct R2004SectionInfo {
    section_type: i32,
    section_number: i32,
    name: String,
    data_size: u64,
    page_count: usize,
}

// ---------------------------------------------------------------------------
// Data model
// ---------------------------------------------------------------------------

/// A DWG class definition.
#[derive(Debug, Clone, Default)]
pub struct DwgClass {
    pub class_number: i16,
    pub proxy_flags: i16,
    pub app_name: String,
    pub cpp_class_name: String,
    pub dxf_name: String,
    pub was_zombie: bool,
    pub item_class_id: i16,
}

/// Resolved handle references for an entity or object.
#[derive(Debug, Clone, Default)]
pub struct HandleRefs {
    pub owner: Option<u32>,
    pub layer: Option<u32>,
    pub linetype: Option<u32>,
    pub prev_entity: Option<u32>,
    pub next_entity: Option<u32>,
    pub plotstyle: Option<u32>,
    pub material: Option<u32>,
}

/// A parsed DWG object or entity.
#[derive(Debug, Clone)]
pub struct DwgObject {
    pub handle: u32,
    pub type_num: u16,
    pub type_name: String,
    pub data: HashMap<String, serde_json::Value>,
    pub is_entity: bool,
    pub handle_refs: HandleRefs,
}

/// Top-level container for parsed DWG data.
#[derive(Debug, Clone, Default)]
pub struct DwgFile {
    pub version: String,
    pub version_code: String,
    pub dwg_version: Option<DwgVersion>,
    pub codepage: u16,
    pub header_vars: HashMap<String, serde_json::Value>,
    pub classes: Vec<DwgClass>,
    pub objects: Vec<DwgObject>,
    pub object_map: HashMap<u32, usize>,
    /// Preview / thumbnail image data (BMP), if present.
    pub thumbnail: Option<Vec<u8>>,
}

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

/// Parses DWG binary files.
pub struct DwgParser {
    class_map: HashMap<i16, DwgClass>,
    version: DwgVersion,
}

impl DwgParser {
    pub fn new() -> Self {
        Self {
            class_map: HashMap::new(),
            version: DwgVersion::R2000,
        }
    }

    /// Parse a DWG file from raw bytes.
    pub fn parse(&mut self, data: &[u8]) -> Result<DwgFile, DwgError> {
        if data.len() < 25 {
            return Err(DwgError::InvalidBinary("Data too short for DWG".into()));
        }

        let mut dwg = DwgFile::default();
        dwg.version_code = Self::detect_version(data);
        dwg.version = VERSION_MAP.iter()
            .find(|(code, _)| *code == dwg.version_code.as_bytes())
            .map(|(_, name)| name.to_string())
            .unwrap_or_else(|| dwg.version_code.clone());

        let ver = DwgVersion::from_code(&dwg.version_code).ok_or_else(|| {
            DwgError::InvalidBinary(format!(
                "Unsupported DWG version code: {}", dwg.version_code
            ))
        })?;
        self.version = ver;
        dwg.dwg_version = Some(ver);

        match ver {
            DwgVersion::R13 | DwgVersion::R14 => self.parse_r13_r14(data, &mut dwg)?,
            DwgVersion::R2000 => self.parse_r2000(data, &mut dwg)?,
            DwgVersion::R2004 => {
                // Try R2004 page-based approach first; fall back to sentinel scan
                if self.parse_r2004(data, &mut dwg).is_err() {
                    self.parse_r2010_plus(data, &mut dwg)?;
                }
            }
            DwgVersion::R2007 => self.parse_r2007_plus(data, &mut dwg)?,
            DwgVersion::R2010 | DwgVersion::R2013 | DwgVersion::R2018 => {
                self.parse_r2010_plus(data, &mut dwg)?;
            }
        }

        // Resolve handle references → layer names, linetype names, etc.
        resolve_handles(&mut dwg);

        // Extract thumbnail/preview image
        dwg.thumbnail = Self::extract_thumbnail(data);

        Ok(dwg)
    }

    /// Extract the preview/thumbnail image from the DWG file.
    ///
    /// For R13–R2000, the image seeker is at file offset 0x0D (4 bytes LE).
    /// At that address: sentinel (16 bytes) + overall size (RL) + image count
    /// (RC) + entries.  Each entry has a code (RC) indicating the image type
    /// (2 = BMP, 3 = WMF, 6 = PNG) followed by start offset (RL) and
    /// size (RL).
    fn extract_thumbnail(data: &[u8]) -> Option<Vec<u8>> {
        if data.len() < 0x14 { return None; }

        let image_seeker = u32::from_le_bytes([data[0x0D], data[0x0E], data[0x0F], data[0x10]]) as usize;
        if image_seeker == 0 || image_seeker + 32 > data.len() { return None; }

        // Skip 16-byte sentinel
        let pos = image_seeker + 16;
        if pos + 5 > data.len() { return None; }

        let _overall_size = u32::from_le_bytes([data[pos], data[pos+1], data[pos+2], data[pos+3]]) as usize;
        let image_count = data[pos + 4] as usize;
        let mut entry_pos = pos + 5;

        for _ in 0..image_count {
            if entry_pos + 9 > data.len() { break; }
            let code = data[entry_pos];
            let start = u32::from_le_bytes([
                data[entry_pos+1], data[entry_pos+2], data[entry_pos+3], data[entry_pos+4],
            ]) as usize;
            let size = u32::from_le_bytes([
                data[entry_pos+5], data[entry_pos+6], data[entry_pos+7], data[entry_pos+8],
            ]) as usize;
            entry_pos += 9;

            // Code 2 = BMP, 3 = WMF, 6 = PNG
            if (code == 2 || code == 3 || code == 6) && start + size <= data.len() && size > 0 {
                return Some(data[start..start + size].to_vec());
            }
        }

        None
    }

    fn detect_version(data: &[u8]) -> String {
        String::from_utf8_lossy(&data[..6]).to_string()
    }

    // ------------------------------------------------------------------
    // R13/R14 (AC1012/AC1014) parsing
    // ------------------------------------------------------------------

    /// Parse R13/R14 files.  The file structure is the same as R2000 —
    /// section locators in the file header, same object-map layout, same
    /// sentinel-delimited sections.  The main differences are:
    ///
    /// * R13 objects have no bitsize field.
    /// * BT (bit thickness) and BE (bit extrusion) are not available in
    ///   R13 — the parser reads BD / 3BD instead when the version is set.
    /// * Text is always code-page encoded.
    /// * Color is always CMC (no ENC / true-color).
    fn parse_r13_r14(&mut self, data: &[u8], dwg: &mut DwgFile) -> Result<(), DwgError> {
        // R13/R14 share the R2000 file layout: section locators at byte 21+
        self.parse_r2000(data, dwg)
    }

    // ------------------------------------------------------------------
    // R2000 (AC1015) parsing
    // ------------------------------------------------------------------

    fn parse_r2000(&mut self, data: &[u8], dwg: &mut DwgFile) -> Result<(), DwgError> {
        if data.len() < 21 {
            return Err(DwgError::InvalidBinary("R2000 header too short".into()));
        }
        dwg.codepage = u16::from_le_bytes([data[19], data[20]]);
        let sections = self.parse_section_locators_r2000(data);

        if let Some(sec) = sections.get(&SECTION_CLASSES) {
            dwg.classes = self.parse_classes_r2000(data, sec.0, sec.1);
            for cls in &dwg.classes {
                self.class_map.insert(cls.class_number, cls.clone());
            }
        }

        if let Some(sec) = sections.get(&SECTION_HEADER) {
            dwg.header_vars = self.parse_header_vars_r2000(data, sec.0);
        }

        if let Some(sec) = sections.get(&SECTION_OBJECT_MAP) {
            dwg.object_map = self.parse_object_map_r2000(data, sec.0, sec.1);
        }

        if !dwg.object_map.is_empty() {
            dwg.objects = self.parse_objects_r2000(data, &dwg.object_map, &dwg.classes);
        }

        Ok(())
    }

    fn parse_section_locators_r2000(&self, data: &[u8]) -> HashMap<u8, (usize, usize)> {
        let num_records = i32::from_le_bytes([data[21], data[22], data[23], data[24]]);
        let mut sections = HashMap::new();

        for i in 0..num_records as usize {
            let off = 25 + i * 9;
            if off + 9 > data.len() { break; }
            let rec_num = data[off];
            let seeker = u32::from_le_bytes([data[off + 1], data[off + 2], data[off + 3], data[off + 4]]) as usize;
            let size = u32::from_le_bytes([data[off + 5], data[off + 6], data[off + 7], data[off + 8]]) as usize;
            if seeker > 0 || rec_num == 0 {
                sections.insert(rec_num, (seeker, size));
            }
        }

        sections
    }

    // ------------------------------------------------------------------
    // Header variables (R2000)
    // ------------------------------------------------------------------

    fn parse_header_vars_r2000(&self, data: &[u8], offset: usize) -> HashMap<String, serde_json::Value> {
        let mut header = HashMap::new();
        header.insert("$ACADVER".into(), serde_json::json!("AC1015"));

        if offset + 20 > data.len() { return header; }

        // Check sentinel
        let sentinel = &data[offset..offset + 16];
        if sentinel != HEADER_SENTINEL_START { return header; }

        let mut reader = DwgBitReader::new(data, offset + 20);

        // Read header variables in R2000 order
        let read_result: Result<(), DwgError> = (|| {
            // Skip unknown values
            for _ in 0..4 { reader.read_bd()?; }
            for _ in 0..4 { reader.read_t(false)?; }
            for _ in 0..2 { reader.read_bl()?; }

            // Bit flags
            let bit_vars = [
                "$DIMASO", "$DIMSHO", "$PLINEGEN", "$ORTHOMODE", "$REGENMODE",
                "$FILLMODE", "$QTEXTMODE", "$PSLTSCALE", "$LIMCHECK", "$USRTIMER",
                "$SKPOLY", "$ANGDIR", "$SPLFRAME", "$MIRRTEXT", "$WORLDVIEW",
                "$TILEMODE", "$PLIMCHECK", "$VISRETAIN", "$DISPSILH", "$PELLIPSE",
            ];
            for name in &bit_vars {
                header.insert(name.to_string(), serde_json::json!(reader.read_bit()?));
            }

            // BS vars
            let bs_vars = [
                "$PROXYGRAPHICS", "$TREEDEPTH", "$LUNITS", "$LUPREC",
                "$AUNITS", "$AUPREC", "$OSMODE", "$ATTMODE", "$COORDS",
                "$PDMODE", "$PICKSTYLE",
                "$USERI1", "$USERI2", "$USERI3", "$USERI4", "$USERI5",
                "$SPLINESEGS", "$SURFU", "$SURFV", "$SURFTYPE",
                "$SURFTAB1", "$SURFTAB2", "$SPLINETYPE",
                "$SHADEDGE", "$SHADEDIF", "$UNITMODE", "$MAXACTVP",
                "$ISOLINES", "$CMLJUST", "$TEXTQLTY",
            ];
            for name in &bs_vars {
                header.insert(name.to_string(), serde_json::json!(reader.read_bs()?));
            }

            // BD vars
            let bd_vars = [
                "$LTSCALE", "$TEXTSIZE", "$TRACEWID", "$SKETCHINC",
                "$FILLETRAD", "$THICKNESS", "$ANGBASE", "$PDSIZE",
                "$PLINEWID", "$USERR1", "$USERR2", "$USERR3",
                "$USERR4", "$USERR5", "$CMLSCALE",
            ];
            for name in &bd_vars {
                header.insert(name.to_string(), serde_json::json!(reader.read_bd()?));
            }

            header.insert("$CEPSNTYPE".into(), serde_json::json!(reader.read_bs()?));

            Ok(())
        })();

        if read_result.is_err() {
            // Partial parse is ok
        }

        header
    }

    // ------------------------------------------------------------------
    // Classes (R2000)
    // ------------------------------------------------------------------

    fn parse_classes_r2000(&self, data: &[u8], offset: usize, _size: usize) -> Vec<DwgClass> {
        let mut classes = Vec::new();

        if offset + 20 > data.len() { return classes; }

        let sentinel = &data[offset..offset + 16];
        if sentinel != CLASSES_SENTINEL_START { return classes; }

        let cls_data_size = u32::from_le_bytes([
            data[offset + 16], data[offset + 17],
            data[offset + 18], data[offset + 19],
        ]) as usize;

        let mut reader = DwgBitReader::new(data, offset + 20);
        let end_byte = offset + 20 + cls_data_size;

        while reader.tell_byte() < end_byte {
            let result: Result<DwgClass, DwgError> = (|| {
                let mut cls = DwgClass::default();
                cls.class_number = reader.read_bs()?;
                cls.proxy_flags = reader.read_bs()?;
                cls.app_name = reader.read_t(false)?;
                cls.cpp_class_name = reader.read_t(false)?;
                cls.dxf_name = reader.read_t(false)?;
                cls.was_zombie = reader.read_bit()? != 0;
                cls.item_class_id = reader.read_bs()?;
                Ok(cls)
            })();

            match result {
                Ok(cls) => classes.push(cls),
                Err(_) => break,
            }
        }

        classes
    }

    // ------------------------------------------------------------------
    // Object map (R2000)
    // ------------------------------------------------------------------

    fn parse_object_map_r2000(
        &self,
        data: &[u8],
        offset: usize,
        size: usize,
    ) -> HashMap<u32, usize> {
        let mut object_map = HashMap::new();
        let mut pos = offset;
        let end = offset + size;

        let mut last_handle = 0i32;
        let mut last_loc = 0i32;

        while pos < end {
            if pos + 2 > data.len() { break; }
            let section_size = u16::from_be_bytes([data[pos], data[pos + 1]]) as usize;
            if section_size <= 2 { break; }

            let body_start = pos + 2;
            let body_end = body_start + section_size - 2;
            let mut rpos = body_start;

            while rpos < body_end {
                let (handle_delta, new_pos) = match DwgBitReader::read_modular_char(data, rpos) {
                    Ok(v) => v,
                    Err(_) => break,
                };
                rpos = new_pos;

                let (loc_delta, new_pos) = match DwgBitReader::read_modular_char(data, rpos) {
                    Ok(v) => v,
                    Err(_) => break,
                };
                rpos = new_pos;

                last_handle = last_handle.wrapping_add(handle_delta);
                last_loc = last_loc.wrapping_add(loc_delta);

                if last_handle > 0 && last_loc > 0 && (last_loc as usize) < data.len() {
                    object_map.insert(last_handle as u32, last_loc as usize);
                }
            }

            pos += 2 + section_size;
        }

        object_map
    }

    /// Parse object map from R2004+ assembled handles section.
    ///
    /// Unlike parse_object_map_r2000, this does NOT filter locations by
    /// buffer size because the locations are section-relative offsets into
    /// the objects section, not raw file offsets.
    fn parse_object_map_r2004(&self, data: &[u8]) -> HashMap<u32, usize> {
        let mut object_map = HashMap::new();
        let mut pos = 0;

        let mut last_handle = 0i32;
        let mut last_loc = 0i32;

        while pos < data.len() {
            if pos + 2 > data.len() { break; }
            let section_size = u16::from_be_bytes([data[pos], data[pos + 1]]) as usize;
            if section_size <= 2 { break; }

            let body_start = pos + 2;
            let body_end = (body_start + section_size - 2).min(data.len());
            let mut rpos = body_start;

            while rpos < body_end {
                let (handle_delta, new_pos) = match DwgBitReader::read_modular_char(data, rpos) {
                    Ok(v) => v,
                    Err(_) => break,
                };
                rpos = new_pos;

                let (loc_delta, new_pos) = match DwgBitReader::read_modular_char(data, rpos) {
                    Ok(v) => v,
                    Err(_) => break,
                };
                rpos = new_pos;

                last_handle = last_handle.wrapping_add(handle_delta);
                last_loc = last_loc.wrapping_add(loc_delta);

                // Accept all positive handles and non-negative locations.
                // Locations are offsets into the objects section, not this buffer.
                if last_handle > 0 && last_loc >= 0 {
                    object_map.insert(last_handle as u32, last_loc as usize);
                }
            }

            pos += 2 + section_size;
        }

        object_map
    }

    // ==================================================================
    // R2004 (AC1018) parsing
    // ==================================================================

    fn parse_r2004(&mut self, data: &[u8], dwg: &mut DwgFile) -> Result<(), DwgError> {
        if data.len() < 0x100 {
            return Err(DwgError::InvalidBinary("R2004 file too short".into()));
        }
        dwg.codepage = u16::from_le_bytes([data[19], data[20]]);

        // Decrypt the file header metadata at offset 0x80
        let enc_hdr = Self::decrypt_r2004_file_header(data)?;

        let section_page_size = u32::from_le_bytes([
            enc_hdr[0x28], enc_hdr[0x29], enc_hdr[0x2A], enc_hdr[0x2B],
        ]) as usize;
        let section_page_map_addr = u32::from_le_bytes([
            enc_hdr[0x20], enc_hdr[0x21], enc_hdr[0x22], enc_hdr[0x23],
        ]) as usize + 0x100;
        let _section_page_count = u32::from_le_bytes([
            enc_hdr[0x18], enc_hdr[0x19], enc_hdr[0x1A], enc_hdr[0x1B],
        ]) as usize;
        let section_map_id = u32::from_le_bytes([
            enc_hdr[0x24], enc_hdr[0x25], enc_hdr[0x26], enc_hdr[0x27],
        ]) as i32;

        // Validate: real page sizes are typically 0x1000+ (4KB).
        // A tiny page_size (e.g., 20) means this file uses R2010+ layout.
        if section_page_size < 0x400 || section_page_size > 0x100000 {
            return Err(DwgError::InvalidBinary("Invalid R2004 page size".into()));
        }
        if section_page_map_addr + 20 > data.len() || section_page_map_addr < 0x100 {
            return Err(DwgError::InvalidBinary("Invalid R2004 page map address".into()));
        }

        // Build page map: page_number → file_offset
        let page_map = self.read_r2004_page_map(
            data, section_page_map_addr, section_page_size,
        )?;

        self.parse_r2004_sections(data, dwg, &page_map, section_page_size, section_map_id)
    }

    /// Core R2004+ section parsing pipeline.
    ///
    /// Shared between R2004 and R2010+ (which differ only in encrypted
    /// header layout but use the same page/section structure).
    fn parse_r2004_sections(
        &mut self,
        data: &[u8],
        dwg: &mut DwgFile,
        page_map: &HashMap<i32, usize>,
        page_size: usize,
        section_map_id: i32,
    ) -> Result<(), DwgError> {
        // First, try to identify sections using the section map
        let section_map_data = self.assemble_r2004_section(
            data, page_map, page_size, section_map_id,
        )?;
        let section_info = Self::parse_r2004_section_map(&section_map_data);

        // Build the section type → section_number mapping.
        // The section map gives us (type_hash, section_number) from the ODA parser,
        // or we fall back to probing sections by content.
        let section_ids = if !section_info.is_empty() {
            self.build_section_map_from_info(data, page_map, page_size, &section_info)
        } else {
            HashMap::new()
        };

        // If section map didn't give us enough info, probe sections by content
        let section_ids = if section_ids.len() < 3 {
            let mut probed = self.probe_sections(data, page_map, page_size, section_map_id);
            // Merge: section_map results take priority
            for (k, v) in section_ids {
                probed.insert(k, v);
            }
            probed
        } else {
            section_ids
        };

        // Extract and parse header section
        if let Some(&sec_id) = section_ids.get(&SECTION_TYPE_HEADER) {
            let hdr_data = self.assemble_r2004_section(
                data, page_map, page_size, sec_id,
            )?;
            dwg.header_vars = self.parse_header_vars_r2004(&hdr_data);
        }

        // Extract and parse classes section
        if let Some(&sec_id) = section_ids.get(&SECTION_TYPE_CLASSES) {
            let cls_data = self.assemble_r2004_section(
                data, page_map, page_size, sec_id,
            )?;
            dwg.classes = self.parse_classes_r2004_section(&cls_data);
            for cls in &dwg.classes {
                self.class_map.insert(cls.class_number, cls.clone());
            }
        }

        // Extract and parse handles / object map section
        let mut objects_data: Option<Vec<u8>> = None;

        if let Some(&sec_id) = section_ids.get(&SECTION_TYPE_HANDLES) {
            let hdl_data = self.assemble_r2004_section(
                data, page_map, page_size, sec_id,
            )?;
            // Parse object map without buffer-size filtering (offsets are
            // section-relative into the objects section, not this buffer)
            dwg.object_map = self.parse_object_map_r2004(&hdl_data);
        }

        // Assemble the objects section (AcDb:AcDbObjects)
        if let Some(&sec_id) = section_ids.get(&SECTION_TYPE_OBJECTS) {
            let obj_data = self.assemble_r2004_section(
                data, page_map, page_size, sec_id,
            )?;
            if !obj_data.is_empty() {
                objects_data = Some(obj_data);
            }
        }

        // Parse objects from the assembled objects section
        if !dwg.object_map.is_empty() {
            if let Some(ref obj_buf) = objects_data {
                // R2004+: object map offsets are into the decompressed objects section
                dwg.objects = self.parse_objects_r2000(obj_buf, &dwg.object_map, &dwg.classes);
            } else {
                // Fallback: try raw file offsets (works for some older R2004 files)
                dwg.objects = self.parse_objects_r2000(data, &dwg.object_map, &dwg.classes);
            }
        }

        Ok(())
    }

    /// Build section type → section_number mapping from parsed section info.
    ///
    /// The section map's page entries list page_numbers. We look up those pages
    /// in the page map, read their headers, and extract the section_number
    /// that `assemble_r2004_section` uses for matching.
    fn build_section_map_from_info(
        &self,
        data: &[u8],
        page_map: &HashMap<i32, usize>,
        _page_size: usize,
        section_info: &[R2004SectionInfo],
    ) -> HashMap<i32, i32> {
        let mut result = HashMap::new();

        for info in section_info {
            // The section_number from the ODA parser is either a page_number
            // (which we need to resolve to a section_number via page headers)
            // or already the correct section_number (from sequential assignment).
            //
            // Try looking up the page_number in the page map first:
            if let Some(&file_offset) = page_map.get(&info.section_number) {
                if file_offset + 8 <= data.len() {
                    let sec_num = i32::from_le_bytes([
                        data[file_offset + 4], data[file_offset + 5],
                        data[file_offset + 6], data[file_offset + 7],
                    ]);
                    if sec_num > 0 {
                        result.insert(info.section_type, sec_num);
                        continue;
                    }
                }
            }
            // Otherwise use the section_number directly
            if info.section_number > 0 {
                result.insert(info.section_type, info.section_number);
            }
        }

        result
    }

    /// Identify sections by probing their assembled content.
    ///
    /// Collects unique section_numbers from page headers, assembles each,
    /// and identifies them by sentinel patterns or data characteristics.
    fn probe_sections(
        &self,
        data: &[u8],
        page_map: &HashMap<i32, usize>,
        page_size: usize,
        section_map_id: i32,
    ) -> HashMap<i32, i32> {
        // Collect unique section_numbers from page headers
        let mut sec_nums = std::collections::HashSet::new();
        for (&_page_num, &file_offset) in page_map {
            if file_offset + 8 > data.len() { continue; }
            let sec_type = i32::from_le_bytes([
                data[file_offset], data[file_offset + 1],
                data[file_offset + 2], data[file_offset + 3],
            ]);
            let sec_num = i32::from_le_bytes([
                data[file_offset + 4], data[file_offset + 5],
                data[file_offset + 6], data[file_offset + 7],
            ]);
            // Data pages have sec_type 1 (uncompressed) or 2 (compressed)
            if (sec_type == 1 || sec_type == 2) && sec_num > 0 && sec_num != section_map_id {
                sec_nums.insert(sec_num);
            }
        }

        let mut result = HashMap::new();

        for sec_num in sec_nums {
            let assembled = match self.assemble_r2004_section(data, page_map, page_size, sec_num) {
                Ok(d) if !d.is_empty() => d,
                _ => continue,
            };

            // Check for header sentinel
            if find_sentinel(&assembled, &HEADER_SENTINEL_START).is_some() {
                result.insert(SECTION_TYPE_HEADER, sec_num);
                continue;
            }

            // Check for classes sentinel
            if find_sentinel(&assembled, &CLASSES_SENTINEL_START).is_some() {
                result.insert(SECTION_TYPE_CLASSES, sec_num);
                continue;
            }

            // Check for object map pattern (MC pair sections with BE u16 size prefix)
            if assembled.len() >= 4 {
                let sec_size = u16::from_be_bytes([assembled[0], assembled[1]]) as usize;
                if sec_size >= 10 && sec_size < 4000 && sec_size <= assembled.len() {
                    // Try parsing a few MC pairs
                    let body = &assembled[2..2 + sec_size.saturating_sub(2).min(assembled.len() - 2)];
                    if Self::looks_like_object_map(body) {
                        result.insert(SECTION_TYPE_HANDLES, sec_num);
                        continue;
                    }
                }
            }

            // Check for objects section (MS size prefix + BS object type)
            if assembled.len() >= 8 {
                if Self::looks_like_objects_section(&assembled) {
                    result.insert(SECTION_TYPE_OBJECTS, sec_num);
                    continue;
                }
            }
        }

        result
    }

    /// Check if data looks like an object map (MC pair encoded handle+location deltas).
    fn looks_like_object_map(body: &[u8]) -> bool {
        let mut pos = 0;
        let mut lh = 0i32;
        let mut ll = 0i32;
        let mut valid = 0;
        let mut first_handle = 0i32;
        while pos < body.len() && valid < 20 {
            match DwgBitReader::read_modular_char(body, pos) {
                Ok((hd, p1)) => match DwgBitReader::read_modular_char(body, p1) {
                    Ok((ld, p2)) => {
                        lh = lh.wrapping_add(hd);
                        ll = ll.wrapping_add(ld);
                        if lh > 0 && ll > 0 {
                            if valid == 0 { first_handle = lh; }
                            valid += 1;
                        }
                        pos = p2;
                    }
                    Err(_) => break,
                },
                Err(_) => break,
            }
        }
        // Object maps start from small handles and have many valid pairs
        valid >= 5 && first_handle > 0 && first_handle < 50
    }

    /// Check if data looks like an objects section (series of MS-sized objects).
    fn looks_like_objects_section(buf: &[u8]) -> bool {
        let mut pos = 0;
        let mut valid = 0;
        for _ in 0..10 {
            if pos + 4 > buf.len() { break; }
            match DwgBitReader::read_modular_short(buf, pos) {
                Ok((size, next_pos)) => {
                    if size > 0 && size < 100_000 && next_pos + (size as usize) <= buf.len() {
                        // Try reading the object type (BS) at bit_start
                        let mut reader = DwgBitReader::new(buf, next_pos);
                        if let Ok(type_num) = reader.read_bs() {
                            if type_num > 0 && type_num < 1000 {
                                valid += 1;
                            }
                        }
                        pos = next_pos + size as usize;
                    } else {
                        break;
                    }
                }
                Err(_) => break,
            }
        }
        valid >= 2
    }

    /// Decrypt the 0x6C-byte metadata header at file offset 0x80.
    fn decrypt_r2004_file_header(data: &[u8]) -> Result<Vec<u8>, DwgError> {
        const ENC_SIZE: usize = 0x6C;
        if data.len() < 0x80 + ENC_SIZE {
            return Err(DwgError::InvalidBinary("R2004: file too short for encrypted header".into()));
        }

        let mut decrypted = vec![0u8; ENC_SIZE];
        let mut seed: u32 = 1;
        for i in 0..ENC_SIZE {
            seed = seed.wrapping_mul(0x343FD).wrapping_add(0x269EC3);
            decrypted[i] = data[0x80 + i] ^ ((seed >> 16) as u8);
        }

        // Validate: first 12 bytes should be "AcFssFcAJMB\0"
        if decrypted.len() >= 12 && &decrypted[..11] != b"AcFssFcAJMB" {
            // Not fatal — some files have variant signatures
        }

        Ok(decrypted)
    }

    /// Read the section page map for R2004+.
    ///
    /// The page map is a system section page at `map_addr`. It maps
    /// sequential page numbers to their data sizes. Pages are laid out
    /// at fixed intervals of `page_size` starting at file offset 0x100.
    ///
    /// System section pages (type >= 0x41000000) have a 20-byte header:
    ///   +0:  section_type (RL) — e.g., 0x4163043B for page map
    ///   +4:  decompressed_size (RL)
    ///   +8:  compressed_size (RL)
    ///   +12: compression_type (RL) — 2 = compressed
    ///   +16: checksum (RL)
    ///   +20: body data
    ///
    /// Data section pages (type 1 or 2) have a 32-byte header:
    ///   +0:  compression_type (RL) — 1=uncomp, 2=comp
    ///   +4:  section_number (RL)
    ///   +8:  data_size (RL)
    ///   +12: compressed_size (RL)
    ///   +16: start_offset (RL)
    ///   +20: checksum (RL)
    ///   +24-31: padding
    ///   +32: body data
    fn read_r2004_page_map(
        &self,
        data: &[u8],
        map_addr: usize,
        page_size: usize,
    ) -> Result<HashMap<i32, usize>, DwgError> {
        if map_addr + 20 > data.len() {
            return Err(DwgError::InvalidBinary("R2004: page map address out of bounds".into()));
        }

        let section_type = i32::from_le_bytes([
            data[map_addr], data[map_addr + 1], data[map_addr + 2], data[map_addr + 3],
        ]);

        // Determine header format based on section type
        let (data_size, comp_size, compressed, page_body) = if section_type > 0x41000000 {
            // System section page: 20-byte header
            let dsz = u32::from_le_bytes([
                data[map_addr + 4], data[map_addr + 5],
                data[map_addr + 6], data[map_addr + 7],
            ]) as usize;
            let csz = u32::from_le_bytes([
                data[map_addr + 8], data[map_addr + 9],
                data[map_addr + 10], data[map_addr + 11],
            ]) as usize;
            let ctype = u32::from_le_bytes([
                data[map_addr + 12], data[map_addr + 13],
                data[map_addr + 14], data[map_addr + 15],
            ]);
            (dsz, csz, ctype == 2, map_addr + 20)
        } else {
            // Data section page: 32-byte header
            if map_addr + 32 > data.len() {
                return Err(DwgError::InvalidBinary(
                    "R2004: page map address out of bounds".into(),
                ));
            }
            let dsz = u32::from_le_bytes([
                data[map_addr + 8], data[map_addr + 9],
                data[map_addr + 10], data[map_addr + 11],
            ]) as usize;
            let csz = u32::from_le_bytes([
                data[map_addr + 12], data[map_addr + 13],
                data[map_addr + 14], data[map_addr + 15],
            ]) as usize;
            (dsz, csz, section_type == 2, map_addr + 32)
        };

        if page_body + comp_size > data.len() {
            return Err(DwgError::InvalidBinary("R2004: page map data out of bounds".into()));
        }

        let map_data = if compressed {
            decompress_r2004(&data[page_body..page_body + comp_size], data_size)?
        } else {
            data[page_body..page_body + data_size.min(comp_size)].to_vec()
        };

        // Parse entries: (section_number: i32, page_data_size: i32) pairs
        // These map sequential page indices to their containing sections.
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

            // sec_num > 0 means real page, < 0 means gap
            if sec_num > 0 {
                // file offset = 0x100 + page_idx * page_size
                let file_offset = 0x100 + (page_idx as usize) * page_size;
                page_map.insert(sec_num, file_offset);
            }
            page_idx += 1;
        }

        Ok(page_map)
    }

    /// Assemble an R2004 section by collecting all pages that belong to
    /// `target_section` and decompressing them.
    fn assemble_r2004_section(
        &self,
        data: &[u8],
        page_map: &HashMap<i32, usize>,
        _page_size: usize,
        target_section: i32,
    ) -> Result<Vec<u8>, DwgError> {
        // Collect all pages belonging to this section by scanning page headers.
        // Each page at a file offset has a 32-byte header.
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
            // Only data pages (type 1=uncompressed, 2=compressed)
            if sec_type != 1 && sec_type != 2 { continue; }

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

            // Sanity: data_size and comp_size should be reasonable
            if dsize > 0x1000000 || csize > 0x1000000 { continue; }

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

        // Sort by start_offset to assemble in order
        pages.sort_by_key(|p| p.start_offset);

        // Determine total decompressed size
        let total_size = pages.iter()
            .map(|p| p.start_offset + p.data_size)
            .max()
            .unwrap_or(0);

        // Sanity: total_size should be reasonable (max 256MB)
        if total_size > 0x10000000 {
            return Err(DwgError::InvalidBinary(
                "R2004: assembled section too large".into(),
            ));
        }

        let mut assembled = vec![0u8; total_size];

        for page in &pages {
            let body_offset = page.file_offset + 32;
            if body_offset + page.comp_size > data.len() { continue; }

            let decompressed = if page.compressed {
                match decompress_r2004(
                    &data[body_offset..body_offset + page.comp_size],
                    page.data_size,
                ) {
                    Ok(d) => d,
                    Err(_) => continue,
                }
            } else {
                let end = body_offset + page.data_size.min(page.comp_size);
                data[body_offset..end].to_vec()
            };

            let dst_end = (page.start_offset + decompressed.len()).min(assembled.len());
            let copy_len = dst_end - page.start_offset;
            assembled[page.start_offset..page.start_offset + copy_len]
                .copy_from_slice(&decompressed[..copy_len]);
        }

        Ok(assembled)
    }

    /// Parse the section map from decompressed section map data.
    ///
    /// Tries multiple known layouts since the format varies slightly
    /// between DWG versions and builds.
    fn parse_r2004_section_map(map_data: &[u8]) -> Vec<R2004SectionInfo> {
        // Strategy 1: ODA spec format with 20-byte global header
        let result = Self::parse_section_map_oda(map_data, 20);
        if !result.is_empty() { return result; }

        // Strategy 2: ODA spec format without global header
        let result = Self::parse_section_map_oda(map_data, 0);
        if !result.is_empty() { return result; }

        // Strategy 3: Scan for known section type hashes
        let result = Self::parse_section_map_scan(map_data);
        if !result.is_empty() { return result; }

        Vec::new()
    }

    /// Parse section map using ODA-spec layout (LibreDWG-compatible).
    ///
    /// Per entry:
    ///   +0:  num_pages (RL)
    ///   +4:  max_decomp_size (RL)
    ///   +8:  unknown (RL)
    ///   +12: compressed (RL)
    ///   +16: section_type hash (RL) — e.g., 0x4163003b
    ///   +20: encrypted (RL)
    ///   +24: name (64 bytes, null-terminated)
    ///   +88: num_page_entries (RL)
    ///   +92: page entries (page_number: RL, data_size: RL) × N
    fn parse_section_map_oda(map_data: &[u8], start: usize) -> Vec<R2004SectionInfo> {
        let mut sections = Vec::new();
        let mut pos = start;
        let known_hashes = [
            SECTION_TYPE_HEADER, SECTION_TYPE_CLASSES, SECTION_TYPE_OBJFREESPACE,
            SECTION_TYPE_TEMPLATE, SECTION_TYPE_HANDLES, SECTION_TYPE_OBJECTS,
        ];

        // Read up to 20 sections (reasonable upper bound)
        for _ in 0..20 {
            if pos + 92 > map_data.len() { break; }

            let _num_pages = i32::from_le_bytes([
                map_data[pos], map_data[pos + 1], map_data[pos + 2], map_data[pos + 3],
            ]);
            let _max_decomp = u32::from_le_bytes([
                map_data[pos + 4], map_data[pos + 5], map_data[pos + 6], map_data[pos + 7],
            ]);
            let _compressed = u32::from_le_bytes([
                map_data[pos + 12], map_data[pos + 13], map_data[pos + 14], map_data[pos + 15],
            ]);
            let section_type = i32::from_le_bytes([
                map_data[pos + 16], map_data[pos + 17], map_data[pos + 18], map_data[pos + 19],
            ]);
            let _encrypted = u32::from_le_bytes([
                map_data[pos + 20], map_data[pos + 21], map_data[pos + 22], map_data[pos + 23],
            ]);

            // Validate: section_type should be a known hash
            if sections.is_empty() && !known_hashes.contains(&section_type) {
                return Vec::new(); // Wrong format
            }
            if section_type <= 0 { break; } // End sentinel

            // Read name (64 bytes, null-terminated)
            let name_end = (pos + 24 + 64).min(map_data.len());
            let name_bytes = &map_data[pos + 24..name_end];
            let name = name_bytes.iter()
                .take_while(|&&b| b != 0)
                .map(|&b| b as char)
                .collect::<String>();

            // Page entry count at offset +88
            let page_count = if pos + 92 <= map_data.len() {
                u32::from_le_bytes([
                    map_data[pos + 88], map_data[pos + 89],
                    map_data[pos + 90], map_data[pos + 91],
                ]) as usize
            } else { 0 };

            // Sanity check page_count
            if page_count > 10000 { break; }

            // Read page entries to find page numbers (= section numbers in page headers)
            let pages_start = pos + 92;
            let mut page_numbers = Vec::new();
            let mut data_size_total: u64 = 0;
            for i in 0..page_count {
                let pe = pages_start + i * 8;
                if pe + 8 > map_data.len() { break; }
                let page_num = i32::from_le_bytes([
                    map_data[pe], map_data[pe + 1], map_data[pe + 2], map_data[pe + 3],
                ]);
                let psize = u32::from_le_bytes([
                    map_data[pe + 4], map_data[pe + 5], map_data[pe + 6], map_data[pe + 7],
                ]) as u64;
                page_numbers.push(page_num);
                data_size_total += psize;
            }

            // The section_number used by assemble_r2004_section comes from page headers.
            // In the ODA format, the section map itself stores page_numbers which are
            // page indices in the page map. The section_number in page headers is set
            // to a sequential section index. We need to find which section_number
            // pages for this section use. Use the first page number as representative.
            // In practice, the section map entry index + 2 often matches the section_number.
            let section_number = if !page_numbers.is_empty() {
                page_numbers[0]
            } else {
                (sections.len() as i32) + 2
            };

            pos = pages_start + page_count * 8;

            sections.push(R2004SectionInfo {
                section_type,
                section_number,
                name,
                data_size: data_size_total,
                page_count,
            });
        }

        sections
    }

    /// Fallback: scan section map data for known hash values and extract
    /// section info by examining surrounding bytes.
    fn parse_section_map_scan(map_data: &[u8]) -> Vec<R2004SectionInfo> {
        let known_hashes: &[(i32, &str)] = &[
            (SECTION_TYPE_HEADER, "AcDb:Header"),
            (SECTION_TYPE_CLASSES, "AcDb:Classes"),
            (SECTION_TYPE_OBJFREESPACE, "AcDb:ObjFreeSpace"),
            (SECTION_TYPE_TEMPLATE, "AcDb:Template"),
            (SECTION_TYPE_HANDLES, "AcDb:Handles"),
            (SECTION_TYPE_OBJECTS, "AcDb:AcDbObjects"),
        ];

        let mut sections = Vec::new();

        for pos in 0..map_data.len().saturating_sub(3) {
            let val = i32::from_le_bytes([
                map_data[pos], map_data[pos + 1], map_data[pos + 2], map_data[pos + 3],
            ]);
            if let Some(&(hash, name)) = known_hashes.iter().find(|&&(h, _)| h == val) {
                // Found a known hash. The section_number can be inferred:
                // assign sequential numbers starting from 2 (0/1 are page/section maps).
                let section_number = (sections.len() as i32) + 2;
                sections.push(R2004SectionInfo {
                    section_type: hash,
                    section_number,
                    name: name.to_string(),
                    data_size: 0,
                    page_count: 0,
                });
            }
        }

        sections
    }

    /// Parse header variables from decompressed R2004 header section.
    /// The decompressed data contains sentinels + header vars in R2000 format.
    fn parse_header_vars_r2004(&self, section_data: &[u8]) -> HashMap<String, serde_json::Value> {
        // Look for the header sentinel within the decompressed data
        if let Some(pos) = find_sentinel(section_data, &HEADER_SENTINEL_START) {
            // After the sentinel (16 bytes) + size field (4 bytes) → bit data
            if pos + 20 < section_data.len() {
                return self.parse_header_vars_from_bits(section_data, pos);
            }
        }
        // Fallback: try parsing from the start
        let mut header = HashMap::new();
        header.insert("$ACADVER".into(), serde_json::json!("AC1018"));
        header
    }

    /// Parse classes from decompressed R2004 classes section.
    fn parse_classes_r2004_section(&self, section_data: &[u8]) -> Vec<DwgClass> {
        // Look for the classes sentinel within the decompressed data
        if let Some(pos) = find_sentinel(section_data, &CLASSES_SENTINEL_START) {
            if pos + 20 < section_data.len() {
                return self.parse_classes_from_bits(section_data, pos);
            }
        }
        // Fallback: try from start with sentinel
        self.parse_classes_r2000(section_data, 0, section_data.len())
    }

    // ==================================================================
    // R2007+ (AC1021 – AC1032) parsing
    // ==================================================================

    /// Parse R2007 (AC1021) files.
    ///
    /// R2007 uses a page-based structure with Reed-Solomon error correction.
    /// Tries the R2007 module first (page system with RS stripping),
    /// then falls back to sentinel scanning.
    fn parse_r2007_plus(&mut self, data: &[u8], dwg: &mut DwgFile) -> Result<(), DwgError> {
        if data.len() < 0x100 {
            return Err(DwgError::InvalidBinary("R2007 file too short".into()));
        }
        dwg.codepage = u16::from_le_bytes([data[19], data[20]]);

        // Try page-based approach using the R2007 module
        if self.try_r2007_page_pipeline(data, dwg).is_ok() {
            return Ok(());
        }

        // Fallback: sentinel scanning + brute-force object map
        self.parse_r2007_fallback(data, dwg)
    }

    /// Try R2007 page-based pipeline using the dedicated R2007 module.
    fn try_r2007_page_pipeline(
        &mut self,
        data: &[u8],
        dwg: &mut DwgFile,
    ) -> Result<(), DwgError> {
        #[allow(unused_imports)]
        use crate::r2007;

        // Decrypt the R2007 file header (same LCG as R2004)
        let enc_hdr = crate::r2007::decrypt_file_header(data)?;

        // Read page map
        let (page_map, page_size) = crate::r2007::read_page_map(data, &enc_hdr)?;
        if page_map.is_empty() {
            return Err(DwgError::InvalidBinary("R2007: empty page map".into()));
        }

        // Read section map
        let section_map_id = if enc_hdr.len() >= 0x28 {
            u32::from_le_bytes([
                enc_hdr[0x24], enc_hdr[0x25], enc_hdr[0x26], enc_hdr[0x27],
            ]) as i32
        } else { 1 };

        let section_map_data = crate::r2007::assemble_section(
            data, &page_map, page_size, section_map_id,
        )?;

        let sections = crate::r2007::parse_section_map(&section_map_data);

        // Find sections by type or name
        let hdr_id = crate::r2007::find_section(&sections, crate::r2007::SECTION_HEADER, "Header");
        let cls_id = crate::r2007::find_section(&sections, crate::r2007::SECTION_CLASSES, "Classes");
        let hdl_id = crate::r2007::find_section(&sections, crate::r2007::SECTION_HANDLES, "Handles");
        let obj_id = crate::r2007::find_section(&sections, crate::r2007::SECTION_OBJECTS, "AcDbObjects");

        // Parse header
        if let Some(id) = hdr_id {
            let hdr_data = crate::r2007::assemble_section(data, &page_map, page_size, id)?;
            dwg.header_vars = self.parse_header_vars_r2004(&hdr_data);
        }
        dwg.header_vars.insert("$ACADVER".into(), serde_json::json!(dwg.version_code));

        // Parse classes
        if let Some(id) = cls_id {
            let cls_data = crate::r2007::assemble_section(data, &page_map, page_size, id)?;
            dwg.classes = self.parse_classes_r2004_section(&cls_data);
            for cls in &dwg.classes {
                self.class_map.insert(cls.class_number, cls.clone());
            }
        }

        // Parse handles (object map)
        if let Some(id) = hdl_id {
            let hdl_data = crate::r2007::assemble_section(data, &page_map, page_size, id)?;
            dwg.object_map = self.parse_object_map_r2004(&hdl_data);
        }

        // Assemble objects section
        let objects_data = if let Some(id) = obj_id {
            let d = crate::r2007::assemble_section(data, &page_map, page_size, id)?;
            if d.is_empty() { None } else { Some(d) }
        } else {
            None
        };

        // Parse objects
        if !dwg.object_map.is_empty() {
            if let Some(ref obj_buf) = objects_data {
                dwg.objects = self.parse_objects_r2000(obj_buf, &dwg.object_map, &dwg.classes);
            } else {
                dwg.objects = self.parse_objects_r2000(data, &dwg.object_map, &dwg.classes);
            }
        }

        // Require some results to confirm this worked
        if dwg.objects.is_empty() && dwg.header_vars.len() <= 1 {
            return Err(DwgError::InvalidBinary("R2007: page pipeline produced no results".into()));
        }

        Ok(())
    }

    /// Fallback R2007 parsing: sentinel scanning + brute-force object map.
    fn parse_r2007_fallback(
        &mut self,
        data: &[u8],
        dwg: &mut DwgFile,
    ) -> Result<(), DwgError> {
        let hdr_pos = find_sentinel(data, &HEADER_SENTINEL_START);
        let cls_pos = find_sentinel(data, &CLASSES_SENTINEL_START);

        if let Some(pos) = hdr_pos {
            dwg.header_vars = self.parse_header_vars_from_bits(data, pos);
        }
        dwg.header_vars.insert("$ACADVER".into(), serde_json::json!(dwg.version_code));

        if let Some(pos) = cls_pos {
            dwg.classes = self.parse_classes_from_bits(data, pos);
            for cls in &dwg.classes {
                self.class_map.insert(cls.class_number, cls.clone());
            }
        }

        // Scan for the object map
        let mut best_offset = 0usize;
        let mut best_count = 0usize;

        for off in (0x80..data.len().saturating_sub(20)).step_by(2) {
            let section_size = u16::from_be_bytes([data[off], data[off + 1]]) as usize;
            if section_size < 10 || section_size > 4000 { continue; }
            if off + 2 + section_size > data.len() { continue; }

            let body = &data[off + 2..off + 2 + section_size.saturating_sub(2)];
            let mut pos = 0;
            let mut valid = 0usize;
            let mut lh = 0i32;
            let mut ll = 0i32;
            let mut first_handle = 0i32;
            while pos < body.len() {
                match DwgBitReader::read_modular_char(body, pos) {
                    Ok((hd, p1)) => match DwgBitReader::read_modular_char(body, p1) {
                        Ok((ld, p2)) => {
                            lh = lh.wrapping_add(hd);
                            ll = ll.wrapping_add(ld);
                            if lh > 0 && ll > 0
                                && (lh as usize) < 0x100000
                                && (ll as usize) < data.len()
                            {
                                if valid == 0 { first_handle = lh; }
                                valid += 1;
                            }
                            pos = p2;
                        }
                        Err(_) => break,
                    },
                    Err(_) => break,
                }
            }
            let score = if first_handle > 0 && first_handle < 20 && valid >= 10 {
                valid * 10
            } else if valid >= 10 {
                valid
            } else {
                0
            };
            if score > best_count {
                best_count = score;
                best_offset = off;
            }
        }

        if best_count > 0 {
            dwg.object_map = self.parse_object_map_r2004(
                &data[best_offset..],
            );
        }

        if !dwg.object_map.is_empty() {
            let mut best_objects = Vec::new();
            let mut best_map = dwg.object_map.clone();

            if let Some(base) = self.find_objects_base(data, &dwg.object_map) {
                let shifted_map: HashMap<u32, usize> = dwg.object_map.iter()
                    .map(|(&h, &loc)| (h, loc + base))
                    .collect();
                best_objects = self.parse_objects_r2000(
                    data, &shifted_map, &dwg.classes,
                );
                best_map = shifted_map;
            }

            let objects_raw = self.parse_objects_r2000(data, &dwg.object_map, &dwg.classes);
            if objects_raw.len() > best_objects.len() {
                best_objects = objects_raw;
                best_map = dwg.object_map.clone();
            }

            dwg.objects = best_objects;
            dwg.object_map = best_map;
        }

        // Supplement: scan for objects that the map missed
        let scanned = self.scan_for_objects(data);
        let existing_handles: std::collections::HashSet<u32> =
            dwg.objects.iter().map(|o| o.handle).collect();
        for obj in scanned {
            if !existing_handles.contains(&obj.handle) {
                dwg.objects.push(obj);
            }
        }

        Ok(())
    }

    // ==================================================================
    // R2010+ (AC1024–AC1032) parsing
    // ==================================================================

    /// Parse R2010+ files using the page-based pipeline.
    ///
    /// R2010/R2013/R2018 use the same LCG encryption and page/section
    /// structure as R2004, but with a different encrypted header layout.
    /// We try multiple header offset configurations, then fall back to
    /// sentinel scanning if all fail.
    ///
    /// Known R2010+ encrypted header layout:
    ///
    /// | Offset | Field |
    /// |--------|-------|
    /// | 0x00 | FileID "AcFssFcAJMB\0" |
    /// | 0x20 | last_section_page_id (RL) |
    /// | 0x24 | last_section_page_end (RLL, 8 bytes) |
    /// | 0x2C | second_header_addr (RLL, 8 bytes) |
    /// | 0x34 | gap_amount (RL) |
    /// | 0x38 | section_page_amount (RL) |
    /// | 0x3C | 0x20 (RL) |
    /// | 0x40 | 0x80 (RL) |
    /// | 0x44 | 0x40 (RL) |
    /// | 0x48 | section_page_map_id (RL) |
    /// | 0x4C | section_page_map_addr (RLL, 8 bytes) |
    /// | 0x54 | section_map_id (RL) |
    fn parse_r2010_plus(&mut self, data: &[u8], dwg: &mut DwgFile) -> Result<(), DwgError> {
        if data.len() < 0x100 {
            return Err(DwgError::InvalidBinary("R2010+ file too short".into()));
        }
        dwg.codepage = u16::from_le_bytes([data[19], data[20]]);

        // Decrypt the file header metadata at offset 0x80 (same LCG as R2004)
        let enc_hdr = Self::decrypt_r2004_file_header(data)?;

        // Try page-based approach with multiple header offset configurations
        if let Ok(()) = self.try_r2010_page_pipeline(data, dwg, &enc_hdr) {
            return Ok(());
        }

        // Fallback: sentinel scanning + object map scanning
        self.parse_r2010_fallback(data, dwg)
    }

    /// Try the R2004 page pipeline with R2010+ header offsets.
    fn try_r2010_page_pipeline(
        &mut self,
        data: &[u8],
        dwg: &mut DwgFile,
        enc_hdr: &[u8],
    ) -> Result<(), DwgError> {
        // Multiple header offset configurations to try
        struct HeaderConfig {
            page_map_addr_offset: usize,
            page_map_addr_size: usize, // 4 or 8 bytes
            section_map_id_offset: usize,
            page_size_offset: Option<usize>,
        }

        let configs = [
            // Config 1: R2004 offsets (some R2010+ files use this)
            HeaderConfig {
                page_map_addr_offset: 0x20,
                page_map_addr_size: 4,
                section_map_id_offset: 0x24,
                page_size_offset: Some(0x28),
            },
            // Config 2: R2010+ ODA spec offsets (8-byte page_map_addr)
            HeaderConfig {
                page_map_addr_offset: 0x4C,
                page_map_addr_size: 8,
                section_map_id_offset: 0x54,
                page_size_offset: None, // compute from page map
            },
            // Config 3: R2010+ with 4-byte page_map_addr at 0x54
            HeaderConfig {
                page_map_addr_offset: 0x54,
                page_map_addr_size: 4,
                section_map_id_offset: 0x24,
                page_size_offset: None,
            },
        ];

        for config in &configs {
            let end = config.page_map_addr_offset + config.page_map_addr_size;
            if end > enc_hdr.len() { continue; }

            let page_map_addr_raw = if config.page_map_addr_size == 8 {
                u64::from_le_bytes([
                    enc_hdr[config.page_map_addr_offset],
                    enc_hdr[config.page_map_addr_offset + 1],
                    enc_hdr[config.page_map_addr_offset + 2],
                    enc_hdr[config.page_map_addr_offset + 3],
                    enc_hdr[config.page_map_addr_offset + 4],
                    enc_hdr[config.page_map_addr_offset + 5],
                    enc_hdr[config.page_map_addr_offset + 6],
                    enc_hdr[config.page_map_addr_offset + 7],
                ]) as usize
            } else {
                u32::from_le_bytes([
                    enc_hdr[config.page_map_addr_offset],
                    enc_hdr[config.page_map_addr_offset + 1],
                    enc_hdr[config.page_map_addr_offset + 2],
                    enc_hdr[config.page_map_addr_offset + 3],
                ]) as usize
            };

            let page_map_addr = page_map_addr_raw.wrapping_add(0x100);

            // Validate: page_map_addr must be in bounds with room for a header
            if page_map_addr + 32 >= data.len() || page_map_addr < 0x100 {
                continue;
            }

            let section_map_id_end = config.section_map_id_offset + 4;
            if section_map_id_end > enc_hdr.len() { continue; }
            let section_map_id = u32::from_le_bytes([
                enc_hdr[config.section_map_id_offset],
                enc_hdr[config.section_map_id_offset + 1],
                enc_hdr[config.section_map_id_offset + 2],
                enc_hdr[config.section_map_id_offset + 3],
            ]) as i32;

            // section_map_id should be small and positive
            if section_map_id <= 0 || section_map_id > 100 { continue; }

            // Get page_size: either from header or compute
            let page_size = if let Some(ps_off) = config.page_size_offset {
                if ps_off + 4 <= enc_hdr.len() {
                    u32::from_le_bytes([
                        enc_hdr[ps_off], enc_hdr[ps_off + 1],
                        enc_hdr[ps_off + 2], enc_hdr[ps_off + 3],
                    ]) as usize
                } else {
                    0
                }
            } else {
                // Compute: page_map_addr should be roughly at page boundary
                // Try common page sizes and see which gives a valid page map
                0
            };

            let page_size = if page_size >= 0x400 && page_size <= 0x100000 {
                page_size
            } else {
                // Compute page size from header fields and page map location
                self.detect_page_size_from_header(data, enc_hdr, page_map_addr)
            };

            if page_size == 0 { continue; }

            // Validate: check that the page map location has a valid page header
            let pm_sec_type = i32::from_le_bytes([
                data[page_map_addr], data[page_map_addr + 1],
                data[page_map_addr + 2], data[page_map_addr + 3],
            ]);
            // Page map has section_type = 0x41630E3B or 2 (compressed)
            if pm_sec_type <= 0 { continue; }

            // Try to build the page map and parse sections
            match self.read_r2004_page_map(data, page_map_addr, page_size) {
                Ok(page_map) if !page_map.is_empty() => {
                    match self.parse_r2004_sections(
                        data, dwg, &page_map, page_size, section_map_id,
                    ) {
                        Ok(()) if !dwg.objects.is_empty() || !dwg.header_vars.is_empty() => {
                            return Ok(());
                        }
                        _ => continue,
                    }
                }
                _ => continue,
            }
        }

        Err(DwgError::InvalidBinary("R2010+: no valid header config found".into()))
    }

    /// Detect page size from the encrypted header and page map location.
    ///
    /// Tries: 1) compute from page_count in header, 2) common candidates,
    /// 3) validate against actual page headers in the file.
    fn detect_page_size_from_header(
        &self,
        data: &[u8],
        enc_hdr: &[u8],
        page_map_addr: usize,
    ) -> usize {
        let data_area = page_map_addr.saturating_sub(0x100);
        if data_area == 0 { return 0; }

        // Try computing from page_count fields in the header.
        // R2010+ has page_count at multiple offsets: 0x28, 0x50, 0x60
        for &count_offset in &[0x28usize, 0x50, 0x38, 0x40] {
            if count_offset + 4 > enc_hdr.len() { continue; }
            let count = u32::from_le_bytes([
                enc_hdr[count_offset], enc_hdr[count_offset + 1],
                enc_hdr[count_offset + 2], enc_hdr[count_offset + 3],
            ]) as usize;
            if count > 0 && count < 100000 && data_area % count == 0 {
                let candidate = data_area / count;
                if candidate >= 0x100 && candidate <= 0x100000 {
                    if self.validate_page_size(data, candidate) {
                        return candidate;
                    }
                }
            }
        }

        // Try common page sizes
        for &candidate in &[0x7400usize, 0x4000, 0x8000, 0x10000, 0x2000, 0x1000] {
            if data_area % candidate == 0 && self.validate_page_size(data, candidate) {
                return candidate;
            }
        }

        // Last resort: compute from data_area / estimated_count
        // Look at first few pages to determine
        for count in 1..50 {
            if data_area % count == 0 {
                let candidate = data_area / count;
                if candidate >= 0x400 && candidate <= 0x100000 {
                    if self.validate_page_size(data, candidate) {
                        return candidate;
                    }
                }
            }
        }

        0
    }

    /// Validate a page size candidate by checking page headers at that stride.
    fn validate_page_size(&self, data: &[u8], page_size: usize) -> bool {
        let mut valid = 0;
        for i in 0..3 {
            let off = 0x100 + i * page_size;
            if off + 8 > data.len() { break; }
            let st = i32::from_le_bytes([
                data[off], data[off + 1], data[off + 2], data[off + 3],
            ]);
            if st == 1 || st == 2 {
                valid += 1;
            }
        }
        valid >= 1
    }

    /// Fallback R2010+ parsing: sentinel scanning + brute-force object map.
    fn parse_r2010_fallback(
        &mut self,
        data: &[u8],
        dwg: &mut DwgFile,
    ) -> Result<(), DwgError> {
        let hdr_pos = find_sentinel(data, &HEADER_SENTINEL_START);
        let cls_pos = find_sentinel(data, &CLASSES_SENTINEL_START);

        if let Some(pos) = hdr_pos {
            dwg.header_vars = self.parse_header_vars_from_bits(data, pos);
        }
        dwg.header_vars.insert("$ACADVER".into(), serde_json::json!(dwg.version_code));

        if let Some(pos) = cls_pos {
            dwg.classes = self.parse_classes_from_bits(data, pos);
            for cls in &dwg.classes {
                self.class_map.insert(cls.class_number, cls.clone());
            }
        }

        // Scan for the object map
        let scan_start = hdr_pos.or(cls_pos)
            .map(|p| p.saturating_sub(0x10000))
            .unwrap_or(data.len() / 2);

        let mut best_offset = 0usize;
        let mut best_count = 0usize;

        for off in (scan_start..data.len().saturating_sub(100)).step_by(2) {
            let section_size = u16::from_be_bytes([data[off], data[off + 1]]) as usize;
            if section_size < 10 || section_size > 4000 { continue; }
            if off + 2 + section_size > data.len() { continue; }

            let body = &data[off + 2..off + 2 + section_size.saturating_sub(2)];
            let mut pos = 0;
            let mut valid = 0usize;
            let mut lh = 0i32;
            let mut ll = 0i32;
            let mut first_handle = 0i32;
            while pos < body.len() {
                match DwgBitReader::read_modular_char(body, pos) {
                    Ok((hd, p1)) => match DwgBitReader::read_modular_char(body, p1) {
                        Ok((ld, p2)) => {
                            lh = lh.wrapping_add(hd);
                            ll = ll.wrapping_add(ld);
                            if lh > 0 && ll > 0 && (ll as usize) < data.len() {
                                if valid == 0 { first_handle = lh; }
                                valid += 1;
                            }
                            pos = p2;
                        }
                        Err(_) => break,
                    },
                    Err(_) => break,
                }
            }
            let score = if first_handle > 0 && first_handle < 20 && valid >= 10 {
                valid * 10
            } else if valid >= 10 {
                valid
            } else {
                0
            };
            if score > best_count {
                best_count = score;
                best_offset = off;
            }
        }

        if best_count > 0 {
            // Parse object map without buffer-size filtering
            dwg.object_map = self.parse_object_map_r2004(
                &data[best_offset..],
            );
        }

        if !dwg.object_map.is_empty() {
            // For R2004+ files, object map locations are often section-relative.
            // Try finding the correct base offset first (fast scan).
            // Then compare with raw file offsets and pick the better result.
            let mut best_objects = Vec::new();
            let mut best_map = dwg.object_map.clone();

            // Strategy 1: find base offset in raw file
            if let Some(base) = self.find_objects_base(data, &dwg.object_map) {
                let shifted_map: HashMap<u32, usize> = dwg.object_map.iter()
                    .map(|(&h, &loc)| (h, loc + base))
                    .collect();
                let objects = self.parse_objects_r2000(
                    data, &shifted_map, &dwg.classes,
                );
                if objects.len() > best_objects.len() {
                    best_objects = objects;
                    best_map = shifted_map;
                }
            }

            // Strategy 2: RS(255,239)-stripped buffer
            // R2010+ pages may contain RS parity bytes interspersed with data.
            // Stripping them recovers the correct section-relative offsets.
            let enc_hdr = Self::decrypt_r2004_file_header(data).ok();
            let pm_addr = enc_hdr.as_ref().and_then(|h| {
                if h.len() >= 0x58 {
                    Some(u32::from_le_bytes([h[0x54], h[0x55], h[0x56], h[0x57]]) as usize + 0x100)
                } else { None }
            }).filter(|&a| a > 0x100 && a < data.len());

            if let Some(pma) = pm_addr {
                let raw_pages = Self::assemble_r2010_pages(data, pma);
                if raw_pages.len() > 1000 {
                    // Strip RS parity from the assembled page data
                    let stripped = crate::r2007::strip_rs_parity(&raw_pages);
                    if stripped.len() > 500 {
                        if let Some(base) = self.find_objects_base(&stripped, &dwg.object_map) {
                            let shifted_map: HashMap<u32, usize> = dwg.object_map.iter()
                                .map(|(&h, &loc)| (h, loc + base))
                                .collect();
                            let objects = self.parse_objects_r2000(
                                &stripped, &shifted_map, &dwg.classes,
                            );
                            if objects.len() > best_objects.len() {
                                best_objects = objects;
                                best_map = dwg.object_map.clone();
                            }
                        }
                    }
                    // Also try without RS stripping (raw pages)
                    if let Some(base) = self.find_objects_base(&raw_pages, &dwg.object_map) {
                        let shifted_map: HashMap<u32, usize> = dwg.object_map.iter()
                            .map(|(&h, &loc)| (h, loc + base))
                            .collect();
                        let objects = self.parse_objects_r2000(
                            &raw_pages, &shifted_map, &dwg.classes,
                        );
                        if objects.len() > best_objects.len() {
                            best_objects = objects;
                            best_map = dwg.object_map.clone();
                        }
                    }
                }
            }

            // Strategy 3: raw file offsets as-is
            let objects_raw = self.parse_objects_r2000(data, &dwg.object_map, &dwg.classes);
            if objects_raw.len() > best_objects.len() {
                best_objects = objects_raw;
                best_map = dwg.object_map.clone();
            }

            dwg.objects = best_objects;
            dwg.object_map = best_map;
        }

        // Supplement: scan for objects that the map missed
        let scanned = self.scan_for_objects(data);
        let existing_handles: std::collections::HashSet<u32> =
            dwg.objects.iter().map(|o| o.handle).collect();
        for obj in scanned {
            if !existing_handles.contains(&obj.handle) {
                dwg.objects.push(obj);
            }
        }

        Ok(())
    }

    /// Assemble all data pages (headerless, fixed stride) from an R2010+ file.
    ///
    /// R2010+ files store section data in headerless pages at fixed stride.
    /// ALL page slots are included (including empty ones) to maintain correct
    /// section-relative offsets when the data is uncompressed.
    fn assemble_r2010_pages(data: &[u8], page_map_addr: usize) -> Vec<u8> {
        let data_area = page_map_addr.saturating_sub(0x100);
        if data_area == 0 || data_area > data.len() { return Vec::new(); }

        // The assembled buffer is simply the raw data from 0x100 to page_map_addr.
        // This preserves all page offsets for uncompressed data.
        if 0x100 + data_area <= data.len() {
            data[0x100..0x100 + data_area].to_vec()
        } else {
            Vec::new()
        }
    }

    /// Find the base offset of the objects section in the raw file.
    ///
    /// Uses coarse-to-fine scanning: first scan at stride 256, then
    /// refine to byte level around the best candidate. This keeps
    /// performance reasonable even for large (30MB+) files.
    fn find_objects_base(
        &self,
        data: &[u8],
        object_map: &HashMap<u32, usize>,
    ) -> Option<usize> {
        let mut entries: Vec<_> = object_map.iter()
            .map(|(&h, &loc)| (h, loc))
            .collect::<Vec<(u32, usize)>>();
        entries.sort_by_key(|&(h, _)| h);
        let test_locs: Vec<usize> = entries.iter()
            .take(10)
            .filter(|&&(_, loc)| loc < 0x100000)
            .map(|&(_, loc)| loc)
            .collect();

        if test_locs.is_empty() { return None; }

        let max_loc = test_locs.iter().copied().max().unwrap_or(0);
        let max_base = data.len().saturating_sub(max_loc + 10);

        // Coarse scan: stride 256
        let mut best_base = 0usize;
        let mut best_valid = 0usize;
        let coarse_step = 256;

        for base in (0..max_base).step_by(coarse_step) {
            let valid = self.count_valid_objects_at_base(data, base, &test_locs);
            if valid > best_valid {
                best_valid = valid;
                best_base = base;
            }
            if valid >= test_locs.len().max(1) - 1 { break; }
        }

        // Fine scan: byte level around best coarse candidate
        if best_valid >= 2 {
            let fine_start = best_base.saturating_sub(coarse_step);
            let fine_end = (best_base + coarse_step).min(max_base);
            for base in fine_start..fine_end {
                let valid = self.count_valid_objects_at_base(data, base, &test_locs);
                if valid > best_valid {
                    best_valid = valid;
                    best_base = base;
                }
                if valid >= test_locs.len().max(1) - 1 { break; }
            }
        }

        if best_valid >= 3 && best_valid >= test_locs.len() / 2 {
            Some(best_base)
        } else {
            None
        }
    }

    /// Count how many test locations produce valid DWG objects at a given base.
    fn count_valid_objects_at_base(
        &self,
        data: &[u8],
        base: usize,
        test_locs: &[usize],
    ) -> usize {
        let mut valid = 0;
        for &loc in test_locs {
            let addr = base + loc;
            if addr + 6 > data.len() { continue; }
            if let Ok((size, next)) = DwgBitReader::read_modular_short(data, addr) {
                if size > 4 && size < 50_000 && next < data.len() {
                    let mut reader = DwgBitReader::new(data, next);
                    if let Ok(type_num) = reader.read_bs() {
                        let known = matches!(type_num as u16,
                            0x01..=0x29 | 0x2A | 0x2C | 0x2D | 0x2F |
                            0x30..=0x39 | 0x3C..=0x47 |
                            0x4D | 0x4E | 0x4F | 0x50 | 0x52);
                        if known { valid += 1; }
                    }
                }
            }
        }
        valid
    }

    // ------------------------------------------------------------------
    // Shared section parsers (used by R2000 and R2004+)
    // ------------------------------------------------------------------

    /// Parse header variables from data containing the header sentinel.
    fn parse_header_vars_from_bits(
        &self,
        data: &[u8],
        sentinel_offset: usize,
    ) -> HashMap<String, serde_json::Value> {
        let mut header = HashMap::new();
        let acadver = match self.version {
            DwgVersion::R13 => "AC1012",
            DwgVersion::R14 => "AC1014",
            DwgVersion::R2000 => "AC1015",
            DwgVersion::R2004 => "AC1018",
            DwgVersion::R2007 => "AC1021",
            DwgVersion::R2010 => "AC1024",
            DwgVersion::R2013 => "AC1027",
            DwgVersion::R2018 => "AC1032",
        };
        header.insert("$ACADVER".into(), serde_json::json!(acadver));

        if sentinel_offset + 20 > data.len() { return header; }

        let mut reader = DwgBitReader::new(data, sentinel_offset + 20);
        let is_unicode = self.version.is_r2007_plus();

        let read_result: Result<(), DwgError> = (|| {
            for _ in 0..4 { reader.read_bd()?; }
            for _ in 0..4 { reader.read_tv(is_unicode)?; }
            for _ in 0..2 { reader.read_bl()?; }

            let bit_vars = [
                "$DIMASO", "$DIMSHO", "$PLINEGEN", "$ORTHOMODE", "$REGENMODE",
                "$FILLMODE", "$QTEXTMODE", "$PSLTSCALE", "$LIMCHECK", "$USRTIMER",
                "$SKPOLY", "$ANGDIR", "$SPLFRAME", "$MIRRTEXT", "$WORLDVIEW",
                "$TILEMODE", "$PLIMCHECK", "$VISRETAIN", "$DISPSILH", "$PELLIPSE",
            ];
            for name in &bit_vars {
                header.insert(name.to_string(), serde_json::json!(reader.read_bit()?));
            }

            let bs_vars = [
                "$PROXYGRAPHICS", "$TREEDEPTH", "$LUNITS", "$LUPREC",
                "$AUNITS", "$AUPREC", "$OSMODE", "$ATTMODE", "$COORDS",
                "$PDMODE", "$PICKSTYLE",
                "$USERI1", "$USERI2", "$USERI3", "$USERI4", "$USERI5",
                "$SPLINESEGS", "$SURFU", "$SURFV", "$SURFTYPE",
                "$SURFTAB1", "$SURFTAB2", "$SPLINETYPE",
                "$SHADEDGE", "$SHADEDIF", "$UNITMODE", "$MAXACTVP",
                "$ISOLINES", "$CMLJUST", "$TEXTQLTY",
            ];
            for name in &bs_vars {
                header.insert(name.to_string(), serde_json::json!(reader.read_bs()?));
            }

            let bd_vars = [
                "$LTSCALE", "$TEXTSIZE", "$TRACEWID", "$SKETCHINC",
                "$FILLETRAD", "$THICKNESS", "$ANGBASE", "$PDSIZE",
                "$PLINEWID", "$USERR1", "$USERR2", "$USERR3",
                "$USERR4", "$USERR5", "$CMLSCALE",
            ];
            for name in &bd_vars {
                header.insert(name.to_string(), serde_json::json!(reader.read_bd()?));
            }

            header.insert("$CEPSNTYPE".into(), serde_json::json!(reader.read_bs()?));

            // R2004+ additional header variables
            if self.version >= DwgVersion::R2004 {
                header.insert("$MEASUREMENT".into(), serde_json::json!(reader.read_bs()?));
            }

            Ok(())
        })();

        if read_result.is_err() {
            // Partial parse is ok
        }

        header
    }

    /// Parse classes from data containing the classes sentinel.
    fn parse_classes_from_bits(
        &self,
        data: &[u8],
        sentinel_offset: usize,
    ) -> Vec<DwgClass> {
        let mut classes = Vec::new();
        if sentinel_offset + 20 > data.len() { return classes; }

        let cls_data_size = u32::from_le_bytes([
            data[sentinel_offset + 16], data[sentinel_offset + 17],
            data[sentinel_offset + 18], data[sentinel_offset + 19],
        ]) as usize;

        let mut reader = DwgBitReader::new(data, sentinel_offset + 20);
        let end_byte = sentinel_offset + 20 + cls_data_size;
        let is_unicode = self.version.is_r2007_plus();

        // R2004+: skip BL max_class_number + B unknown bit
        if self.version.is_r2004_plus() {
            let _ = reader.read_bl();
            let _ = reader.read_bit();
        }

        while reader.tell_byte() < end_byte {
            let result: Result<DwgClass, DwgError> = (|| {
                let mut cls = DwgClass::default();
                cls.class_number = reader.read_bs()?;
                cls.proxy_flags = reader.read_bs()?;
                cls.app_name = reader.read_tv(is_unicode)?;
                cls.cpp_class_name = reader.read_tv(is_unicode)?;
                cls.dxf_name = reader.read_tv(is_unicode)?;
                cls.was_zombie = reader.read_bit()? != 0;
                cls.item_class_id = reader.read_bs()?;

                // R2004+ classes have additional fields per entry
                if self.version.is_r2004_plus() {
                    let _num_instances = reader.read_bl()?;
                    let _dwg_version = reader.read_bl()?;
                    let _maintenance_version = reader.read_bl()?;
                    let _unknown1 = reader.read_bl()?;
                    let _unknown2 = reader.read_bl()?;
                }

                Ok(cls)
            })();

            match result {
                Ok(cls) => {
                    // Validate: class_number should be >= 500 for custom classes
                    if cls.class_number >= 500 || cls.class_number == 0 {
                        classes.push(cls);
                    }
                }
                Err(_) => break,
            }
        }

        classes
    }

    // ------------------------------------------------------------------
    // Object/entity parsing (R2000)
    // ------------------------------------------------------------------

    /// Scan the file for valid DWG objects by testing MS+BS patterns.
    ///
    /// This is a fallback for when the object map can't be found or
    /// gives incorrect offsets.  It scans every byte position for a
    /// valid Modular Short size followed by a known BS type number.
    /// Scan raw file data for DWG objects by pattern matching.
    ///
    /// Two-pass approach:
    /// 1. Fast byte-level scan for MS+BS+bitsize+handle patterns (no catch_unwind)
    /// 2. Parse validated candidates and collect non-overlapping results
    fn scan_for_objects(&self, data: &[u8]) -> Vec<DwgObject> {
        struct Candidate {
            pos: usize,
            obj_size: usize,
            handle: u32,
            is_entity: bool,
        }

        let mut candidates = Vec::new();
        let mut pos = 0x100;

        // Pass 1: fast pattern matching using byte-level pre-checks
        while pos + 10 < data.len() {
            // Quick reject: skip zero regions
            if data[pos] == 0 { pos += 1; continue; }
            // MS second byte must have bit 7 clear for single-word (common case)
            if pos + 1 >= data.len() { break; }

            let lo = data[pos] as i32;
            let hi = data[pos + 1];
            let obj_size = if hi & 0x80 == 0 {
                lo | (((hi & 0x7F) as i32) << 8)
            } else {
                // Multi-word MS — rare, handle with full parser
                match DwgBitReader::read_modular_short(data, pos) {
                    Ok((s, _)) => s,
                    Err(_) => { pos += 1; continue; }
                }
            };
            if obj_size <= 4 || obj_size > 8000 { pos += 1; continue; }
            if pos + obj_size as usize + 4 > data.len() { pos += 1; continue; }

            // Read BS type from bit stream at pos+2
            let bit_start = if hi & 0x80 == 0 { pos + 2 } else {
                match DwgBitReader::read_modular_short(data, pos) {
                    Ok((_, bs)) => bs,
                    Err(_) => { pos += 1; continue; }
                }
            };
            if bit_start + 6 >= data.len() { pos += 1; continue; }

            let mut reader = DwgBitReader::new(data, bit_start);
            let type_num = match reader.read_bs() {
                Ok(t) => t as u16,
                Err(_) => { pos += 1; continue; }
            };
            if obj_type_name(type_num).is_none() { pos += 1; continue; }

            // Validate bitsize (R14+)
            if self.version >= DwgVersion::R14 {
                match reader.read_raw_long() {
                    Ok(bs) => {
                        let bs = bs as u32;
                        if bs == 0 || bs > (obj_size as u32) * 8 + 100 {
                            pos += 1; continue;
                        }
                    }
                    Err(_) => { pos += 1; continue; }
                }
            }

            // Validate handle
            let hval = match reader.read_h() {
                Ok((hcode, hval)) => {
                    if hcode > 12 || (hval == 0 && type_num != 0x06) || hval > 0x100000 {
                        pos += 1; continue;
                    }
                    hval
                }
                Err(_) => { pos += 1; continue; }
            };

            candidates.push(Candidate {
                pos,
                obj_size: obj_size as usize,
                handle: hval,
                is_entity: is_entity_type(type_num),
            });
            // Skip past this candidate to reduce overlapping checks
            pos += 2;
        }

        // Pass 2: sort by priority (entities first, lower handles first)
        candidates.sort_by(|a, b| {
            b.is_entity.cmp(&a.is_entity)
                .then(a.handle.cmp(&b.handle))
        });

        let mut objects = Vec::new();
        let mut used_ranges: Vec<(usize, usize)> = Vec::new();
        let mut seen_handles = std::collections::HashSet::new();

        for c in &candidates {
            let c_end = c.pos + c.obj_size + 2;
            if used_ranges.iter().any(|&(s, e)| c.pos < e && c_end > s) {
                continue;
            }
            if seen_handles.contains(&c.handle) { continue; }

            let parse_result = std::panic::catch_unwind(
                std::panic::AssertUnwindSafe(|| {
                    self.parse_single_object_r2000(data, c.handle, c.pos)
                })
            );
            if let Ok(Ok(obj)) = parse_result {
                used_ranges.push((c.pos, c_end));
                seen_handles.insert(obj.handle);
                objects.push(obj);
            }
        }

        objects
    }

    fn parse_objects_r2000(
        &self,
        data: &[u8],
        object_map: &HashMap<u32, usize>,
        _classes: &[DwgClass],
    ) -> Vec<DwgObject> {
        let mut objects = Vec::new();

        let mut sorted: Vec<_> = object_map.iter().collect();
        sorted.sort_by_key(|&(h, _)| *h);

        for (&handle, &file_offset) in &sorted {
            // Try primary offset first
            let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                self.parse_single_object_r2000(data, handle, file_offset)
            }));
            if let Ok(Ok(obj)) = result {
                objects.push(obj);
                continue;
            }

            // For R2004+, try nearby offsets (±2, ±4) to handle CRC
            // alignment shifts. Only accept if the result has a known type.
            if self.version.is_r2004_plus() {
                'fuzzy: for delta in &[2usize, 4, 6, 8] {
                    for &off in &[file_offset.wrapping_sub(*delta), file_offset + *delta] {
                        if off >= data.len() || off < 4 { continue; }
                        let r = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                            self.parse_single_object_r2000(data, handle, off)
                        }));
                        if let Ok(Ok(obj)) = r {
                            let type_ok = obj_type_name(obj.type_num).is_some()
                                || obj.type_num >= 500;
                            if type_ok {
                                objects.push(obj);
                                break 'fuzzy;
                            }
                        }
                    }
                }
            }
        }

        objects
    }

    fn parse_single_object_r2000(
        &self,
        data: &[u8],
        handle: u32,
        file_offset: usize,
    ) -> Result<DwgObject, DwgError> {
        if file_offset >= data.len() || file_offset + 4 > data.len() {
            return Err(DwgError::InvalidBinary("Invalid offset".into()));
        }

        let (obj_size, bit_start) = DwgBitReader::read_modular_short(data, file_offset)?;
        if bit_start >= data.len() {
            return Err(DwgError::InvalidBinary("Object start past end of data".into()));
        }
        if obj_size <= 0 {
            return Err(DwgError::InvalidBinary("Zero object size".into()));
        }

        let mut reader = DwgBitReader::new(data, bit_start);
        let data_bit_start = reader.tell_bit();

        // Object type (BS)
        let type_num = reader.read_bs()? as u16;

        // Determine type name
        let type_name = obj_type_name(type_num)
            .map(|s| s.to_string())
            .or_else(|| {
                if type_num >= 500 {
                    self.class_map.get(&(type_num as i16))
                        .map(|cls| {
                            if !cls.dxf_name.is_empty() { cls.dxf_name.clone() }
                            else { cls.cpp_class_name.clone() }
                        })
                } else {
                    None
                }
            })
            .unwrap_or_else(|| format!("UNKNOWN_{}", type_num));

        let is_entity = is_entity_type(type_num) || {
            if type_num >= 500 {
                self.class_map.get(&(type_num as i16))
                    .map(|cls| cls.item_class_id == 0x1F2 as i16)
                    .unwrap_or(false)
            } else {
                false
            }
        };

        // Read bitsize — marks the end of data section / start of handles.
        // R13 does not have a bitsize field.
        let bitsize = if self.version >= DwgVersion::R14 {
            reader.read_raw_long().ok()
        } else {
            None
        };

        // Read handle
        let _ = reader.read_h().ok();

        // Parse EED (Extended Entity Data)
        let eed = self.parse_eed(&mut reader);

        // Parse type-specific data
        let mut obj_data = if is_entity {
            self.parse_entity_data(&mut reader, type_num, &type_name)
        } else {
            self.parse_table_object(&mut reader, type_num, &type_name)
        };

        // --- Handle reference reading ---
        let handle_refs = if is_entity {
            if let Some(bs) = bitsize {
                self.read_entity_handles(
                    &mut reader, data_bit_start, bs as usize, handle, &obj_data,
                )
            } else {
                HandleRefs::default()
            }
        } else {
            HandleRefs::default()
        };

        // Remove internal metadata keys (prefixed with _)
        obj_data.remove("_num_reactors");
        obj_data.remove("_xdict_missing");
        obj_data.remove("_nolinks");
        obj_data.remove("_ltype_flags");
        obj_data.remove("_plotstyle_flags");
        obj_data.remove("_material_flags");
        obj_data.remove("_shadow_flags");

        obj_data.insert("type".into(), serde_json::json!(type_name));
        obj_data.insert("handle".into(), serde_json::json!(handle));

        // Store EED if present
        if !eed.is_empty() {
            obj_data.insert("xdata".into(), serde_json::json!(eed));
        }

        Ok(DwgObject {
            handle,
            type_num,
            type_name,
            data: obj_data,
            is_entity,
            handle_refs,
        })
    }

    /// Parse Extended Entity Data (EED / xdata).
    ///
    /// Returns a JSON array of EED groups.  Each group has an `appHandle`
    /// and a `data` array of typed items.  If parsing fails, silently
    /// returns what was collected so far.
    fn parse_eed(&self, reader: &mut DwgBitReader) -> Vec<serde_json::Value> {
        let mut groups = Vec::new();

        loop {
            let eed_size = match reader.read_bs() {
                Ok(s) => s as usize,
                Err(_) => break,
            };
            if eed_size == 0 { break; }
            if eed_size > 0x100000 { break; } // guard: max 1MB EED

            let app_handle = match reader.read_h() {
                Ok((_, h)) => h,
                Err(_) => break,
            };

            // Read eed_size raw bytes
            let mut eed_bytes = Vec::with_capacity(eed_size);
            let mut ok = true;
            for _ in 0..eed_size {
                match reader.read_byte() {
                    Ok(b) => eed_bytes.push(b),
                    Err(_) => { ok = false; break; }
                }
            }
            if !ok { break; }

            // Decode typed items from the EED byte stream
            let items = Self::decode_eed_items(&eed_bytes);

            groups.push(serde_json::json!({
                "appHandle": format!("{:X}", app_handle),
                "data": items,
            }));
        }

        groups
    }

    /// Decode typed EED items from a raw byte buffer.
    fn decode_eed_items(data: &[u8]) -> Vec<serde_json::Value> {
        let mut items = Vec::new();
        let mut pos = 0;

        while pos < data.len() {
            let code = data[pos]; pos += 1;
            match code {
                0 => {
                    // String: 1-byte codepage, 1-byte length, then chars
                    if pos + 2 > data.len() { break; }
                    let _codepage = data[pos]; pos += 1;
                    let len = data[pos] as usize; pos += 1;
                    if pos + len > data.len() { break; }
                    let s: String = data[pos..pos + len].iter()
                        .filter(|&&b| b != 0)
                        .map(|&b| b as char)
                        .collect();
                    pos += len;
                    items.push(serde_json::json!({"type": "string", "value": s}));
                }
                1 => {
                    // Open brace
                    items.push(serde_json::json!({"type": "openBrace"}));
                }
                2 => {
                    // Close brace
                    items.push(serde_json::json!({"type": "closeBrace"}));
                }
                3 | 5 => {
                    // 3 = layer ref, 5 = entity handle (8 bytes)
                    if pos + 8 > data.len() { break; }
                    let mut handle = 0u64;
                    for i in 0..8 {
                        handle |= (data[pos + i] as u64) << (i * 8);
                    }
                    pos += 8;
                    let t = if code == 3 { "layerRef" } else { "entityHandle" };
                    items.push(serde_json::json!({"type": t, "value": format!("{:X}", handle)}));
                }
                4 => {
                    // Binary chunk: 1-byte length + bytes
                    if pos >= data.len() { break; }
                    let len = data[pos] as usize; pos += 1;
                    if pos + len > data.len() { break; }
                    pos += len;
                    items.push(serde_json::json!({"type": "binary", "length": len}));
                }
                10 | 11 | 12 | 13 => {
                    // 3 doubles (point)
                    if pos + 24 > data.len() { break; }
                    let x = f64::from_le_bytes(data[pos..pos+8].try_into().unwrap_or([0;8])); pos += 8;
                    let y = f64::from_le_bytes(data[pos..pos+8].try_into().unwrap_or([0;8])); pos += 8;
                    let z = f64::from_le_bytes(data[pos..pos+8].try_into().unwrap_or([0;8])); pos += 8;
                    items.push(serde_json::json!({"type": "point", "value": [x, y, z]}));
                }
                40 | 41 | 42 => {
                    // Double
                    if pos + 8 > data.len() { break; }
                    let v = f64::from_le_bytes(data[pos..pos+8].try_into().unwrap_or([0;8])); pos += 8;
                    items.push(serde_json::json!({"type": "real", "value": v}));
                }
                70 => {
                    // 16-bit integer
                    if pos + 2 > data.len() { break; }
                    let v = i16::from_le_bytes([data[pos], data[pos+1]]); pos += 2;
                    items.push(serde_json::json!({"type": "int16", "value": v}));
                }
                71 => {
                    // 32-bit integer
                    if pos + 4 > data.len() { break; }
                    let v = i32::from_le_bytes([data[pos], data[pos+1], data[pos+2], data[pos+3]]); pos += 4;
                    items.push(serde_json::json!({"type": "int32", "value": v}));
                }
                _ => {
                    // Unknown — skip rest
                    break;
                }
            }
        }

        items
    }

    // ------------------------------------------------------------------
    // Handle reference reading (after entity data, at bitsize offset)
    // ------------------------------------------------------------------

    /// Read handle references from the handle section of an entity.
    ///
    /// Seeks to `data_bit_start + bitsize` and reads handles in the
    /// standard R2000+ order: owner, reactors, xdict, layer, ltype,
    /// prev/next entity, plotstyle, material.
    fn read_entity_handles(
        &self,
        reader: &mut DwgBitReader,
        data_bit_start: usize,
        bitsize: usize,
        parent_handle: u32,
        obj_data: &HashMap<String, serde_json::Value>,
    ) -> HandleRefs {
        let mut refs = HandleRefs::default();

        // Extract metadata stored by parse_entity_common
        let num_reactors = obj_data.get("_num_reactors")
            .and_then(|v| v.as_i64()).unwrap_or(0) as usize;
        let xdict_missing = obj_data.get("_xdict_missing")
            .and_then(|v| v.as_bool()).unwrap_or(false);
        let nolinks = obj_data.get("_nolinks")
            .and_then(|v| v.as_bool()).unwrap_or(true);
        let ltype_flags = obj_data.get("_ltype_flags")
            .and_then(|v| v.as_u64()).unwrap_or(3) as u8;
        let plotstyle_flags = obj_data.get("_plotstyle_flags")
            .and_then(|v| v.as_u64()).unwrap_or(3) as u8;
        let material_flags = obj_data.get("_material_flags")
            .and_then(|v| v.as_u64()).unwrap_or(3) as u8;

        // Seek to handle section
        reader.seek_bit(data_bit_start + bitsize);

        let _ = (|| -> Result<(), DwgError> {
            // 1. Owner handle
            let (code, val) = reader.read_h()?;
            refs.owner = Some(resolve_handle_ref(code, val, parent_handle));

            // 2. Reactor handles (skip)
            for _ in 0..num_reactors.min(1000) {
                reader.read_h()?;
            }

            // 3. Xdict handle (R2000: always present; R2004+: only if !xdict_missing)
            let xdict_present = if self.version >= DwgVersion::R2004 {
                !xdict_missing
            } else {
                true
            };
            if xdict_present {
                reader.read_h()?; // skip xdict
            }

            // 4. Layer handle — the key reference we need
            let (code, val) = reader.read_h()?;
            refs.layer = Some(resolve_handle_ref(code, val, parent_handle));

            // 5. Linetype handle (if not BYLAYER)
            if ltype_flags != 3 {
                let (code, val) = reader.read_h()?;
                refs.linetype = Some(resolve_handle_ref(code, val, parent_handle));
            }

            // 6. Prev/Next entity handles (if links present)
            if !nolinks {
                let (code, val) = reader.read_h()?;
                refs.prev_entity = Some(resolve_handle_ref(code, val, parent_handle));
                let (code, val) = reader.read_h()?;
                refs.next_entity = Some(resolve_handle_ref(code, val, parent_handle));
            }

            // 7. Plotstyle handle
            if plotstyle_flags != 3 {
                let (code, val) = reader.read_h()?;
                refs.plotstyle = Some(resolve_handle_ref(code, val, parent_handle));
            }

            // 8. R2007+: Material handle
            if self.version >= DwgVersion::R2007 && material_flags != 3 {
                let (code, val) = reader.read_h()?;
                refs.material = Some(resolve_handle_ref(code, val, parent_handle));
            }

            Ok(())
        })();

        refs
    }

    // ------------------------------------------------------------------
    // Entity common data (version-aware)
    // ------------------------------------------------------------------

    fn parse_entity_common(&self, reader: &mut DwgBitReader) -> HashMap<String, serde_json::Value> {
        let mut result = HashMap::new();

        let _ = (|| -> Result<(), DwgError> {
            // Preview/graphic present
            let preview_exists = reader.read_bit()?;
            if preview_exists != 0 {
                let preview_size = reader.read_raw_long()? as usize;
                if preview_size > 0 && preview_size < 5_000_000 {
                    for _ in 0..preview_size {
                        reader.read_byte()?;
                    }
                }
            }

            // Entity mode
            result.insert("entity_mode".into(), serde_json::json!(reader.read_bb()?));

            // Number of reactors — store for handle reading
            let num_reactors = reader.read_bl()?;
            result.insert("_num_reactors".into(), serde_json::json!(num_reactors));

            // R2004+: xdict missing flag
            let xdict_missing = if self.version >= DwgVersion::R2004 {
                reader.read_bit()? != 0
            } else {
                false // R2000: xdict handle is always present
            };
            result.insert("_xdict_missing".into(), serde_json::json!(xdict_missing));

            // nolinks — store for handle reading
            let nolinks = reader.read_bit()? != 0;
            result.insert("_nolinks".into(), serde_json::json!(nolinks));

            // Color: R2004+ uses ENC (true color), R2000 uses CMC (index)
            if self.version >= DwgVersion::R2004 {
                match reader.read_enc() {
                    Ok((index, rgb, _name)) => {
                        result.insert("color".into(), serde_json::json!(index));
                        if let Some(rgb_val) = rgb {
                            result.insert("trueColor".into(), serde_json::json!(format!("#{:06X}", rgb_val & 0x00FFFFFF)));
                        }
                    }
                    Err(_) => {}
                }
            } else {
                result.insert("color".into(), serde_json::json!(reader.read_cmc()?));
            }

            // Linetype scale
            result.insert("linetype_scale".into(), serde_json::json!(reader.read_bd()?));

            // Linetype flags — store for handle reading
            let ltype_flags = reader.read_bb()?;
            result.insert("_ltype_flags".into(), serde_json::json!(ltype_flags));

            // Plotstyle flags — store for handle reading
            let plotstyle_flags = reader.read_bb()?;
            result.insert("_plotstyle_flags".into(), serde_json::json!(plotstyle_flags));

            // R2007+: material flags, shadow flags
            if self.version >= DwgVersion::R2007 {
                let material_flags = reader.read_bb()?;
                result.insert("_material_flags".into(), serde_json::json!(material_flags));
                let shadow_flags = reader.read_bb()?;
                result.insert("_shadow_flags".into(), serde_json::json!(shadow_flags));
            }

            // Invisibility
            let invisibility = reader.read_bs()?;
            result.insert("invisible".into(), serde_json::json!(invisibility != 0));

            // Lineweight
            result.insert("lineweight".into(), serde_json::json!(reader.read_byte()?));

            Ok(())
        })();

        result
    }

    // ------------------------------------------------------------------
    // Entity data dispatch
    // ------------------------------------------------------------------

    fn parse_entity_data(
        &self,
        reader: &mut DwgBitReader,
        type_num: u16,
        _type_name: &str,
    ) -> HashMap<String, serde_json::Value> {
        let common = self.parse_entity_common(reader);

        let specific = match type_num {
            0x01 => self.parse_text(reader),
            0x02 => self.parse_attrib(reader),
            0x03 => self.parse_attdef(reader),
            0x07 => self.parse_insert(reader),
            0x08 => self.parse_minsert(reader),
            0x0A => self.parse_vertex_2d(reader),
            0x0B => self.parse_vertex_3d(reader),
            0x0F => self.parse_polyline_2d(reader),
            0x10 => self.parse_polyline_3d(reader),
            0x11 => self.parse_arc(reader),
            0x12 => self.parse_circle(reader),
            0x13 => self.parse_line(reader),
            0x14 => self.parse_dimension_ordinate(reader),
            0x15 => self.parse_dimension_linear(reader),
            0x16 => self.parse_dimension_aligned(reader),
            0x17 => self.parse_dimension_ang3pt(reader),
            0x18 => self.parse_dimension_ang2ln(reader),
            0x19 => self.parse_dimension_radius(reader),
            0x1A => self.parse_dimension_radius(reader), // DIAMETER same as RADIUS
            0x1B => self.parse_point(reader),
            0x1C => self.parse_3dface(reader),
            0x1E => self.parse_trace(reader),
            0x1F => self.parse_solid(reader),
            0x22 => self.parse_viewport(reader),
            0x23 => self.parse_ellipse(reader),
            0x24 => self.parse_spline(reader),
            0x28 => self.parse_ray(reader),
            0x29 => self.parse_xline(reader),
            0x2C => self.parse_mtext(reader),
            0x2D => self.parse_leader(reader),
            0x2F => self.parse_tolerance(reader),
            0x4D => self.parse_lwpolyline(reader),
            0x4E => self.parse_hatch(reader),
            _ => HashMap::new(),
        };

        let mut merged = common;
        merged.extend(specific);
        merged
    }

    // ------------------------------------------------------------------
    // Geometric entity parsers (R2000 format)
    // ------------------------------------------------------------------

    fn parse_line(&self, reader: &mut DwgBitReader) -> HashMap<String, serde_json::Value> {
        let mut result = HashMap::new();
        let _ = (|| -> Result<(), DwgError> {
            let z_is_zero = reader.read_bit()?;
            let start_x = reader.read_double()?;
            let end_x = reader.read_dd(start_x)?;
            let start_y = reader.read_double()?;
            let end_y = reader.read_dd(start_y)?;
            let (start_z, end_z) = if z_is_zero != 0 {
                (0.0, 0.0)
            } else {
                let sz = reader.read_double()?;
                let ez = reader.read_dd(sz)?;
                (sz, ez)
            };
            let thickness = reader.read_bt()?;
            let extrusion = reader.read_be()?;

            result.insert("start".into(), serde_json::json!([start_x, start_y, start_z]));
            result.insert("end".into(), serde_json::json!([end_x, end_y, end_z]));
            result.insert("thickness".into(), serde_json::json!(thickness));
            result.insert("extrusion".into(), serde_json::json!([extrusion.0, extrusion.1, extrusion.2]));
            Ok(())
        })();
        result
    }

    fn parse_circle(&self, reader: &mut DwgBitReader) -> HashMap<String, serde_json::Value> {
        let mut result = HashMap::new();
        let _ = (|| -> Result<(), DwgError> {
            let center = reader.read_3bd()?;
            let radius = reader.read_bd()?;
            let thickness = reader.read_bt()?;
            let extrusion = reader.read_be()?;

            result.insert("center".into(), serde_json::json!([center.0, center.1, center.2]));
            result.insert("radius".into(), serde_json::json!(radius));
            result.insert("thickness".into(), serde_json::json!(thickness));
            result.insert("extrusion".into(), serde_json::json!([extrusion.0, extrusion.1, extrusion.2]));
            Ok(())
        })();
        result
    }

    fn parse_arc(&self, reader: &mut DwgBitReader) -> HashMap<String, serde_json::Value> {
        let mut result = HashMap::new();
        let _ = (|| -> Result<(), DwgError> {
            let center = reader.read_3bd()?;
            let radius = reader.read_bd()?;
            let thickness = reader.read_bt()?;
            let extrusion = reader.read_be()?;
            let start_angle = reader.read_bd()?;
            let end_angle = reader.read_bd()?;

            result.insert("center".into(), serde_json::json!([center.0, center.1, center.2]));
            result.insert("radius".into(), serde_json::json!(radius));
            result.insert("thickness".into(), serde_json::json!(thickness));
            result.insert("extrusion".into(), serde_json::json!([extrusion.0, extrusion.1, extrusion.2]));
            result.insert("startAngle".into(), serde_json::json!(start_angle));
            result.insert("endAngle".into(), serde_json::json!(end_angle));
            Ok(())
        })();
        result
    }

    fn parse_point(&self, reader: &mut DwgBitReader) -> HashMap<String, serde_json::Value> {
        let mut result = HashMap::new();
        let _ = (|| -> Result<(), DwgError> {
            let x = reader.read_bd()?;
            let y = reader.read_bd()?;
            let z = reader.read_bd()?;
            let thickness = reader.read_bt()?;
            let extrusion = reader.read_be()?;
            let x_ang = reader.read_bd()?;

            result.insert("position".into(), serde_json::json!([x, y, z]));
            result.insert("thickness".into(), serde_json::json!(thickness));
            result.insert("extrusion".into(), serde_json::json!([extrusion.0, extrusion.1, extrusion.2]));
            result.insert("xAxisAngle".into(), serde_json::json!(x_ang));
            Ok(())
        })();
        result
    }

    fn parse_ellipse(&self, reader: &mut DwgBitReader) -> HashMap<String, serde_json::Value> {
        let mut result = HashMap::new();
        let _ = (|| -> Result<(), DwgError> {
            let center = reader.read_3bd()?;
            let sm_axis = reader.read_3bd()?;
            let extrusion = reader.read_3bd()?;
            let axis_ratio = reader.read_bd()?;
            let start_angle = reader.read_bd()?;
            let end_angle = reader.read_bd()?;

            result.insert("center".into(), serde_json::json!([center.0, center.1, center.2]));
            result.insert("majorAxis".into(), serde_json::json!([sm_axis.0, sm_axis.1, sm_axis.2]));
            result.insert("extrusion".into(), serde_json::json!([extrusion.0, extrusion.1, extrusion.2]));
            result.insert("axisRatio".into(), serde_json::json!(axis_ratio));
            result.insert("startAngle".into(), serde_json::json!(start_angle));
            result.insert("endAngle".into(), serde_json::json!(end_angle));
            Ok(())
        })();
        result
    }

    fn parse_text(&self, reader: &mut DwgBitReader) -> HashMap<String, serde_json::Value> {
        let mut result = HashMap::new();
        let _ = (|| -> Result<(), DwgError> {
            let dataflags = reader.read_byte()?;

            let elevation = if dataflags & 0x01 == 0 { reader.read_double()? } else { 0.0 };
            let insertion = reader.read_2rd()?;

            let alignment = if dataflags & 0x02 == 0 {
                let ax = reader.read_dd(insertion.0)?;
                let ay = reader.read_dd(insertion.1)?;
                (ax, ay)
            } else { (0.0, 0.0) };

            let _extrusion = reader.read_be()?;
            let _thickness = reader.read_bt()?;
            let _oblique = if dataflags & 0x04 == 0 { reader.read_double()? } else { 0.0 };
            let rotation = if dataflags & 0x08 == 0 { reader.read_double()? } else { 0.0 };
            let height = reader.read_double()?;
            let _width_factor = if dataflags & 0x10 == 0 { reader.read_double()? } else { 1.0 };
            let text_value = reader.read_tv(self.version.is_r2007_plus())?;

            result.insert("elevation".into(), serde_json::json!(elevation));
            result.insert("insertionPoint".into(), serde_json::json!([insertion.0, insertion.1, elevation]));
            result.insert("alignmentPoint".into(), serde_json::json!([alignment.0, alignment.1, elevation]));
            result.insert("rotation".into(), serde_json::json!(rotation));
            result.insert("height".into(), serde_json::json!(height));
            result.insert("text".into(), serde_json::json!(text_value));
            Ok(())
        })();
        result
    }

    fn parse_mtext(&self, reader: &mut DwgBitReader) -> HashMap<String, serde_json::Value> {
        let mut result = HashMap::new();
        let _ = (|| -> Result<(), DwgError> {
            let insertion = reader.read_3bd()?;
            let _extrusion = reader.read_3bd()?;
            let _x_axis_dir = reader.read_3bd()?;
            let _rect_width = reader.read_bd()?;
            let text_height = reader.read_bd()?;
            let attachment = reader.read_bs()?;
            let _flow_dir = reader.read_bs()?;
            let _ext_h = reader.read_bd()?;
            let _ext_w = reader.read_bd()?;
            let text = reader.read_tv(self.version.is_r2007_plus())?;

            result.insert("insertionPoint".into(), serde_json::json!([insertion.0, insertion.1, insertion.2]));
            result.insert("height".into(), serde_json::json!(text_height));
            result.insert("attachment".into(), serde_json::json!(attachment));
            result.insert("text".into(), serde_json::json!(text));
            Ok(())
        })();
        result
    }

    fn parse_insert(&self, reader: &mut DwgBitReader) -> HashMap<String, serde_json::Value> {
        let mut result = HashMap::new();
        let _ = (|| -> Result<(), DwgError> {
            let insertion = reader.read_3bd()?;
            let scale_flag = reader.read_bb()?;
            let (sx, sy, sz) = match scale_flag {
                3 => (1.0, 1.0, 1.0),
                1 => {
                    let sy = reader.read_dd(1.0)?;
                    let sz = reader.read_dd(1.0)?;
                    (1.0, sy, sz)
                }
                2 => {
                    let sx = reader.read_double()?;
                    (sx, sx, sx)
                }
                _ => {
                    let sx = reader.read_double()?;
                    let sy = reader.read_dd(sx)?;
                    let sz = reader.read_dd(sx)?;
                    (sx, sy, sz)
                }
            };
            let rotation = reader.read_bd()?;
            let _extrusion = reader.read_3bd()?;
            let _has_attribs = reader.read_bit()?;

            result.insert("insertionPoint".into(), serde_json::json!([insertion.0, insertion.1, insertion.2]));
            result.insert("scaleX".into(), serde_json::json!(sx));
            result.insert("scaleY".into(), serde_json::json!(sy));
            result.insert("scaleZ".into(), serde_json::json!(sz));
            result.insert("rotation".into(), serde_json::json!(rotation));
            Ok(())
        })();
        result
    }

    fn parse_lwpolyline(&self, reader: &mut DwgBitReader) -> HashMap<String, serde_json::Value> {
        let mut result = HashMap::new();
        let _ = (|| -> Result<(), DwgError> {
            let flag = reader.read_bs()? as u16;

            if flag & 4 != 0 { reader.read_bd()?; }
            if flag & 8 != 0 { reader.read_bd()?; }
            if flag & 2 != 0 { reader.read_bd()?; }
            if flag & 1 != 0 { reader.read_3bd()?; }

            let num_points = reader.read_bl()? as usize;
            let num_bulges = if flag & 16 != 0 { reader.read_bl()? as usize } else { 0 };
            let num_widths = if flag & 32 != 0 { reader.read_bl()? as usize } else { 0 };

            let mut points = Vec::new();
            if num_points > 0 && num_points < 100_000 {
                let first = reader.read_2rd()?;
                points.push(vec![first.0, first.1]);
                for i in 1..num_points {
                    let px = reader.read_dd(points[i - 1][0])?;
                    let py = reader.read_dd(points[i - 1][1])?;
                    points.push(vec![px, py]);
                }
            }

            let mut bulges = Vec::new();
            for _ in 0..num_bulges {
                bulges.push(reader.read_bd()?);
            }

            // Convert to vertex objects
            let mut vertices: Vec<serde_json::Value> = Vec::new();
            for (i, pt) in points.iter().enumerate() {
                let mut v = serde_json::json!({"x": pt[0], "y": pt[1]});
                if i < bulges.len() && bulges[i] != 0.0 {
                    v["bulge"] = serde_json::json!(bulges[i]);
                }
                vertices.push(v);
            }

            result.insert("vertices".into(), serde_json::json!(vertices));
            result.insert("closed".into(), serde_json::json!(flag & 512 != 0));

            // Skip widths
            for _ in 0..num_widths {
                reader.read_bd()?;
                reader.read_bd()?;
            }

            Ok(())
        })();
        result
    }

    fn parse_spline(&self, reader: &mut DwgBitReader) -> HashMap<String, serde_json::Value> {
        let mut result = HashMap::new();
        let _ = (|| -> Result<(), DwgError> {
            let scenario = reader.read_bl()?;
            result.insert("scenario".into(), serde_json::json!(scenario));

            if scenario == 2 {
                let degree = reader.read_bl()?;
                result.insert("degree".into(), serde_json::json!(degree));
                let num_knots = reader.read_bl()? as usize;
                let num_ctrl = reader.read_bl()? as usize;
                let weighted = reader.read_bit()?;

                let mut knots = Vec::new();
                for _ in 0..num_knots {
                    knots.push(reader.read_bd()?);
                }

                let mut ctrl_pts = Vec::new();
                for _ in 0..num_ctrl {
                    let pt = reader.read_3bd()?;
                    let w = if weighted != 0 { reader.read_bd()? } else { 1.0 };
                    ctrl_pts.push(serde_json::json!({"point": [pt.0, pt.1, pt.2], "weight": w}));
                }

                result.insert("knots".into(), serde_json::json!(knots));
                result.insert("controlPoints".into(), serde_json::json!(ctrl_pts));
            } else if scenario == 1 {
                let degree = reader.read_bl()?;
                result.insert("degree".into(), serde_json::json!(degree));
                let _knot_param = reader.read_bd()?;
                let num_fit = reader.read_bl()? as usize;
                let mut fit_pts = Vec::new();
                for _ in 0..num_fit {
                    let pt = reader.read_3bd()?;
                    fit_pts.push(serde_json::json!([pt.0, pt.1, pt.2]));
                }
                result.insert("fitPoints".into(), serde_json::json!(fit_pts));
            }

            Ok(())
        })();
        result
    }

    fn parse_solid(&self, reader: &mut DwgBitReader) -> HashMap<String, serde_json::Value> {
        let mut result = HashMap::new();
        let _ = (|| -> Result<(), DwgError> {
            let thickness = reader.read_bt()?;
            let elevation = reader.read_bd()?;
            let c1 = reader.read_2rd()?;
            let c2 = reader.read_2rd()?;
            let c3 = reader.read_2rd()?;
            let c4 = reader.read_2rd()?;
            let extrusion = reader.read_be()?;

            result.insert("thickness".into(), serde_json::json!(thickness));
            result.insert("elevation".into(), serde_json::json!(elevation));
            result.insert("point1".into(), serde_json::json!([c1.0, c1.1, elevation]));
            result.insert("point2".into(), serde_json::json!([c2.0, c2.1, elevation]));
            result.insert("point3".into(), serde_json::json!([c3.0, c3.1, elevation]));
            result.insert("point4".into(), serde_json::json!([c4.0, c4.1, elevation]));
            result.insert("extrusion".into(), serde_json::json!([extrusion.0, extrusion.1, extrusion.2]));
            Ok(())
        })();
        result
    }

    fn parse_ray(&self, reader: &mut DwgBitReader) -> HashMap<String, serde_json::Value> {
        let mut result = HashMap::new();
        let _ = (|| -> Result<(), DwgError> {
            let point = reader.read_3bd()?;
            let vector = reader.read_3bd()?;
            result.insert("origin".into(), serde_json::json!([point.0, point.1, point.2]));
            result.insert("direction".into(), serde_json::json!([vector.0, vector.1, vector.2]));
            Ok(())
        })();
        result
    }

    fn parse_xline(&self, reader: &mut DwgBitReader) -> HashMap<String, serde_json::Value> {
        self.parse_ray(reader)
    }

    // ------------------------------------------------------------------
    // Additional entity parsers
    // ------------------------------------------------------------------

    fn parse_3dface(&self, reader: &mut DwgBitReader) -> HashMap<String, serde_json::Value> {
        let mut result = HashMap::new();
        let _ = (|| -> Result<(), DwgError> {
            let has_no_flags = reader.read_bit()?;
            let _z_is_zero = reader.read_bit()?;
            let c1 = reader.read_3bd()?;
            let c2x = reader.read_dd(c1.0)?;
            let c2y = reader.read_dd(c1.1)?;
            let c2z = reader.read_dd(c1.2)?;
            let c3x = reader.read_dd(c2x)?;
            let c3y = reader.read_dd(c2y)?;
            let c3z = reader.read_dd(c2z)?;
            let c4x = reader.read_dd(c3x)?;
            let c4y = reader.read_dd(c3y)?;
            let c4z = reader.read_dd(c3z)?;
            result.insert("point1".into(), serde_json::json!([c1.0, c1.1, c1.2]));
            result.insert("point2".into(), serde_json::json!([c2x, c2y, c2z]));
            result.insert("point3".into(), serde_json::json!([c3x, c3y, c3z]));
            result.insert("point4".into(), serde_json::json!([c4x, c4y, c4z]));
            if has_no_flags == 0 {
                let flags = reader.read_bs()?;
                result.insert("invisibleEdges".into(), serde_json::json!(flags));
            }
            Ok(())
        })();
        result
    }

    fn parse_trace(&self, reader: &mut DwgBitReader) -> HashMap<String, serde_json::Value> {
        // TRACE has the same format as SOLID
        self.parse_solid(reader)
    }

    fn parse_attrib(&self, reader: &mut DwgBitReader) -> HashMap<String, serde_json::Value> {
        let mut result = HashMap::new();
        let is_unicode = self.version.is_r2007_plus();
        let _ = (|| -> Result<(), DwgError> {
            let dataflags = reader.read_byte()?;
            let elevation = if dataflags & 0x01 == 0 { reader.read_double()? } else { 0.0 };
            let insertion = reader.read_2rd()?;
            let alignment = if dataflags & 0x02 == 0 {
                (reader.read_dd(insertion.0)?, reader.read_dd(insertion.1)?)
            } else { (0.0, 0.0) };
            let _extrusion = reader.read_be()?;
            let _thickness = reader.read_bt()?;
            let _oblique = if dataflags & 0x04 == 0 { reader.read_double()? } else { 0.0 };
            let rotation = if dataflags & 0x08 == 0 { reader.read_double()? } else { 0.0 };
            let height = reader.read_double()?;
            let _width_factor = if dataflags & 0x10 == 0 { reader.read_double()? } else { 1.0 };
            let text_value = reader.read_tv(is_unicode)?;
            let _generation = reader.read_bs()?;
            let _horiz_align = reader.read_bs()?;
            let _vert_align = reader.read_bs()?;
            let tag = reader.read_tv(is_unicode)?;
            let _field_length = reader.read_bs()?;
            let flags = reader.read_byte()?;

            result.insert("insertionPoint".into(), serde_json::json!([insertion.0, insertion.1, elevation]));
            result.insert("alignmentPoint".into(), serde_json::json!([alignment.0, alignment.1, elevation]));
            result.insert("rotation".into(), serde_json::json!(rotation));
            result.insert("height".into(), serde_json::json!(height));
            result.insert("text".into(), serde_json::json!(text_value));
            result.insert("tag".into(), serde_json::json!(tag));
            result.insert("flags".into(), serde_json::json!(flags));
            Ok(())
        })();
        result
    }

    fn parse_attdef(&self, reader: &mut DwgBitReader) -> HashMap<String, serde_json::Value> {
        let mut result = self.parse_attrib(reader);
        let is_unicode = self.version.is_r2007_plus();
        // ATTDEF has an additional prompt string after ATTRIB fields
        let _ = (|| -> Result<(), DwgError> {
            let prompt = reader.read_tv(is_unicode)?;
            result.insert("prompt".into(), serde_json::json!(prompt));
            Ok(())
        })();
        result
    }

    fn parse_minsert(&self, reader: &mut DwgBitReader) -> HashMap<String, serde_json::Value> {
        let mut result = self.parse_insert(reader);
        let _ = (|| -> Result<(), DwgError> {
            let num_cols = reader.read_bs()?;
            let num_rows = reader.read_bs()?;
            let col_spacing = reader.read_bd()?;
            let row_spacing = reader.read_bd()?;
            result.insert("numCols".into(), serde_json::json!(num_cols));
            result.insert("numRows".into(), serde_json::json!(num_rows));
            result.insert("colSpacing".into(), serde_json::json!(col_spacing));
            result.insert("rowSpacing".into(), serde_json::json!(row_spacing));
            Ok(())
        })();
        result
    }

    fn parse_vertex_2d(&self, reader: &mut DwgBitReader) -> HashMap<String, serde_json::Value> {
        let mut result = HashMap::new();
        let _ = (|| -> Result<(), DwgError> {
            let flags = reader.read_byte()?;
            let point = reader.read_3bd()?;
            let start_width = reader.read_bd()?;
            let end_width = if start_width < 0.0 { start_width.abs() } else { reader.read_bd()? };
            let bulge = reader.read_bd()?;
            let _tangent_dir = reader.read_bd()?;
            result.insert("position".into(), serde_json::json!([point.0, point.1, point.2]));
            result.insert("flags".into(), serde_json::json!(flags));
            if start_width != 0.0 { result.insert("startWidth".into(), serde_json::json!(start_width.abs())); }
            if end_width != 0.0 { result.insert("endWidth".into(), serde_json::json!(end_width)); }
            if bulge != 0.0 { result.insert("bulge".into(), serde_json::json!(bulge)); }
            Ok(())
        })();
        result
    }

    fn parse_vertex_3d(&self, reader: &mut DwgBitReader) -> HashMap<String, serde_json::Value> {
        let mut result = HashMap::new();
        let _ = (|| -> Result<(), DwgError> {
            let flags = reader.read_byte()?;
            let point = reader.read_3bd()?;
            result.insert("position".into(), serde_json::json!([point.0, point.1, point.2]));
            result.insert("flags".into(), serde_json::json!(flags));
            Ok(())
        })();
        result
    }

    fn parse_polyline_2d(&self, reader: &mut DwgBitReader) -> HashMap<String, serde_json::Value> {
        let mut result = HashMap::new();
        let _ = (|| -> Result<(), DwgError> {
            let flags = reader.read_bs()?;
            let _curve_type = reader.read_bs()?;
            let start_width = reader.read_bd()?;
            let end_width = reader.read_bd()?;
            let _thickness = reader.read_bt()?;
            let elevation = reader.read_bd()?;
            let _extrusion = reader.read_be()?;
            result.insert("flags".into(), serde_json::json!(flags));
            result.insert("elevation".into(), serde_json::json!(elevation));
            if start_width != 0.0 { result.insert("startWidth".into(), serde_json::json!(start_width)); }
            if end_width != 0.0 { result.insert("endWidth".into(), serde_json::json!(end_width)); }
            result.insert("closed".into(), serde_json::json!(flags & 1 != 0));
            Ok(())
        })();
        result
    }

    fn parse_polyline_3d(&self, reader: &mut DwgBitReader) -> HashMap<String, serde_json::Value> {
        let mut result = HashMap::new();
        let _ = (|| -> Result<(), DwgError> {
            let _curve_flags = reader.read_byte()?;
            let flags = reader.read_byte()?;
            result.insert("flags".into(), serde_json::json!(flags));
            result.insert("closed".into(), serde_json::json!(flags & 1 != 0));
            Ok(())
        })();
        result
    }

    // --- DIMENSION common ---
    fn parse_dimension_common(&self, reader: &mut DwgBitReader) -> HashMap<String, serde_json::Value> {
        let mut result = HashMap::new();
        let is_unicode = self.version.is_r2007_plus();
        let _ = (|| -> Result<(), DwgError> {
            let _version = reader.read_byte()?;
            let extrusion = reader.read_3bd()?;
            let text_midpoint = reader.read_2rd()?;
            let elevation = reader.read_bd()?;
            let flags = reader.read_byte()?;
            let user_text = reader.read_tv(is_unicode)?;
            let text_rotation = reader.read_bd()?;
            let horiz_dir = reader.read_bd()?;
            let _ins_scale = reader.read_3bd()?;
            let _ins_rotation = reader.read_bd()?;

            result.insert("extrusion".into(), serde_json::json!([extrusion.0, extrusion.1, extrusion.2]));
            result.insert("textMidpoint".into(), serde_json::json!([text_midpoint.0, text_midpoint.1, elevation]));
            result.insert("flags".into(), serde_json::json!(flags));
            if !user_text.is_empty() {
                result.insert("overrideText".into(), serde_json::json!(user_text));
            }
            result.insert("textRotation".into(), serde_json::json!(text_rotation));
            result.insert("horizontalDirection".into(), serde_json::json!(horiz_dir));

            if self.version >= DwgVersion::R2000 {
                let _attachment = reader.read_bs()?;
                let _lspace_style = reader.read_bs()?;
                let _lspace_factor = reader.read_bd()?;
                let _actual_measurement = reader.read_bd()?;
            }

            Ok(())
        })();
        result
    }

    fn parse_dimension_ordinate(&self, reader: &mut DwgBitReader) -> HashMap<String, serde_json::Value> {
        let mut result = self.parse_dimension_common(reader);
        let _ = (|| -> Result<(), DwgError> {
            let def_point = reader.read_3bd()?;
            let feature_location = reader.read_3bd()?;
            let leader_endpoint = reader.read_3bd()?;
            let flags2 = reader.read_byte()?;
            result.insert("definitionPoint".into(), serde_json::json!([def_point.0, def_point.1, def_point.2]));
            result.insert("featureLocation".into(), serde_json::json!([feature_location.0, feature_location.1, feature_location.2]));
            result.insert("leaderEndpoint".into(), serde_json::json!([leader_endpoint.0, leader_endpoint.1, leader_endpoint.2]));
            result.insert("useXAxis".into(), serde_json::json!(flags2 & 1 != 0));
            Ok(())
        })();
        result
    }

    fn parse_dimension_linear(&self, reader: &mut DwgBitReader) -> HashMap<String, serde_json::Value> {
        let mut result = self.parse_dimension_common(reader);
        let _ = (|| -> Result<(), DwgError> {
            let ext_line1 = reader.read_3bd()?;
            let ext_line2 = reader.read_3bd()?;
            let def_point = reader.read_3bd()?;
            let oblique_angle = reader.read_bd()?;
            let dim_rotation = reader.read_bd()?;
            result.insert("extLine1".into(), serde_json::json!([ext_line1.0, ext_line1.1, ext_line1.2]));
            result.insert("extLine2".into(), serde_json::json!([ext_line2.0, ext_line2.1, ext_line2.2]));
            result.insert("definitionPoint".into(), serde_json::json!([def_point.0, def_point.1, def_point.2]));
            result.insert("obliqueAngle".into(), serde_json::json!(oblique_angle));
            result.insert("dimRotation".into(), serde_json::json!(dim_rotation));
            Ok(())
        })();
        result
    }

    fn parse_dimension_aligned(&self, reader: &mut DwgBitReader) -> HashMap<String, serde_json::Value> {
        let mut result = self.parse_dimension_common(reader);
        let _ = (|| -> Result<(), DwgError> {
            let ext_line1 = reader.read_3bd()?;
            let ext_line2 = reader.read_3bd()?;
            let def_point = reader.read_3bd()?;
            let oblique_angle = reader.read_bd()?;
            result.insert("extLine1".into(), serde_json::json!([ext_line1.0, ext_line1.1, ext_line1.2]));
            result.insert("extLine2".into(), serde_json::json!([ext_line2.0, ext_line2.1, ext_line2.2]));
            result.insert("definitionPoint".into(), serde_json::json!([def_point.0, def_point.1, def_point.2]));
            result.insert("obliqueAngle".into(), serde_json::json!(oblique_angle));
            Ok(())
        })();
        result
    }

    fn parse_dimension_ang3pt(&self, reader: &mut DwgBitReader) -> HashMap<String, serde_json::Value> {
        let mut result = self.parse_dimension_common(reader);
        let _ = (|| -> Result<(), DwgError> {
            let def_point = reader.read_3bd()?;
            let ext_line1 = reader.read_3bd()?;
            let ext_line2 = reader.read_3bd()?;
            result.insert("definitionPoint".into(), serde_json::json!([def_point.0, def_point.1, def_point.2]));
            result.insert("extLine1".into(), serde_json::json!([ext_line1.0, ext_line1.1, ext_line1.2]));
            result.insert("extLine2".into(), serde_json::json!([ext_line2.0, ext_line2.1, ext_line2.2]));
            Ok(())
        })();
        result
    }

    fn parse_dimension_ang2ln(&self, reader: &mut DwgBitReader) -> HashMap<String, serde_json::Value> {
        let mut result = self.parse_dimension_common(reader);
        let _ = (|| -> Result<(), DwgError> {
            let line1_start = reader.read_2rd()?;
            let line1_end = reader.read_2rd()?;
            let line2_start = reader.read_2rd()?;
            let line2_end = reader.read_2rd()?;
            let def_point = reader.read_3bd()?;
            result.insert("line1Start".into(), serde_json::json!([line1_start.0, line1_start.1]));
            result.insert("line1End".into(), serde_json::json!([line1_end.0, line1_end.1]));
            result.insert("line2Start".into(), serde_json::json!([line2_start.0, line2_start.1]));
            result.insert("line2End".into(), serde_json::json!([line2_end.0, line2_end.1]));
            result.insert("definitionPoint".into(), serde_json::json!([def_point.0, def_point.1, def_point.2]));
            Ok(())
        })();
        result
    }

    fn parse_dimension_radius(&self, reader: &mut DwgBitReader) -> HashMap<String, serde_json::Value> {
        let mut result = self.parse_dimension_common(reader);
        let _ = (|| -> Result<(), DwgError> {
            let def_point = reader.read_3bd()?;
            let leader_length = reader.read_bd()?;
            result.insert("definitionPoint".into(), serde_json::json!([def_point.0, def_point.1, def_point.2]));
            result.insert("leaderLength".into(), serde_json::json!(leader_length));
            Ok(())
        })();
        result
    }

    fn parse_leader(&self, reader: &mut DwgBitReader) -> HashMap<String, serde_json::Value> {
        let mut result = HashMap::new();
        let _ = (|| -> Result<(), DwgError> {
            let _unknown = reader.read_bit()?;
            let annot_type = reader.read_bs()?;
            let path_type = reader.read_bs()?;
            let num_points = reader.read_bl()? as usize;
            let mut points = Vec::new();
            for _ in 0..num_points.min(10000) {
                let pt = reader.read_3bd()?;
                points.push(serde_json::json!([pt.0, pt.1, pt.2]));
            }
            let extrusion = reader.read_3bd()?;
            let _horizontal_dir = reader.read_3bd()?;
            let _offset_block_ins = reader.read_3bd()?;
            let _endpt_proj = if self.version >= DwgVersion::R14 {
                reader.read_3bd()?
            } else { (0.0, 0.0, 0.0) };

            result.insert("annotationType".into(), serde_json::json!(annot_type));
            result.insert("pathType".into(), serde_json::json!(path_type));
            result.insert("points".into(), serde_json::json!(points));
            result.insert("extrusion".into(), serde_json::json!([extrusion.0, extrusion.1, extrusion.2]));
            Ok(())
        })();
        result
    }

    fn parse_tolerance(&self, reader: &mut DwgBitReader) -> HashMap<String, serde_json::Value> {
        let mut result = HashMap::new();
        let is_unicode = self.version.is_r2007_plus();
        let _ = (|| -> Result<(), DwgError> {
            let _unknown_bs = reader.read_bs()?;
            let _height = reader.read_bd()?;
            let _dimgap = reader.read_bd()?;
            let insertion = reader.read_3bd()?;
            let direction = reader.read_3bd()?;
            let _extrusion = reader.read_3bd()?;
            let text = reader.read_tv(is_unicode)?;
            result.insert("insertionPoint".into(), serde_json::json!([insertion.0, insertion.1, insertion.2]));
            result.insert("direction".into(), serde_json::json!([direction.0, direction.1, direction.2]));
            result.insert("text".into(), serde_json::json!(text));
            Ok(())
        })();
        result
    }

    fn parse_viewport(&self, reader: &mut DwgBitReader) -> HashMap<String, serde_json::Value> {
        let mut result = HashMap::new();
        let _ = (|| -> Result<(), DwgError> {
            let center = reader.read_3bd()?;
            let width = reader.read_bd()?;
            let height = reader.read_bd()?;
            result.insert("center".into(), serde_json::json!([center.0, center.1, center.2]));
            result.insert("width".into(), serde_json::json!(width));
            result.insert("height".into(), serde_json::json!(height));

            if self.version >= DwgVersion::R2000 {
                let view_target = reader.read_3bd()?;
                let view_direction = reader.read_3bd()?;
                let twist_angle = reader.read_bd()?;
                let _view_height = reader.read_bd()?;
                let _lens_length = reader.read_bd()?;
                let _front_clip = reader.read_bd()?;
                let _back_clip = reader.read_bd()?;
                let _snap_angle = reader.read_bd()?;
                let _snap_base = reader.read_2rd()?;
                let _snap_spacing = reader.read_2rd()?;
                let _grid_spacing = reader.read_2rd()?;
                let _circle_zoom = reader.read_bs()?;

                result.insert("viewTarget".into(), serde_json::json!([view_target.0, view_target.1, view_target.2]));
                result.insert("viewDirection".into(), serde_json::json!([view_direction.0, view_direction.1, view_direction.2]));
                result.insert("twistAngle".into(), serde_json::json!(twist_angle));
            }

            Ok(())
        })();
        result
    }

    fn parse_hatch(&self, reader: &mut DwgBitReader) -> HashMap<String, serde_json::Value> {
        let mut result = HashMap::new();
        let is_unicode = self.version.is_r2007_plus();
        let _ = (|| -> Result<(), DwgError> {
            let _is_gradient_fill = if self.version >= DwgVersion::R2004 {
                reader.read_bl()?
            } else { 0 };
            let _reserved = if self.version >= DwgVersion::R2004 {
                reader.read_bl()?
            } else { 0 };

            let elevation = reader.read_bd()?;
            let extrusion = reader.read_3bd()?;
            let pattern_name = reader.read_tv(is_unicode)?;
            let solid_fill = reader.read_bit()?;
            let associative = reader.read_bit()?;
            let num_paths = reader.read_bl()? as usize;

            result.insert("elevation".into(), serde_json::json!(elevation));
            result.insert("extrusion".into(), serde_json::json!([extrusion.0, extrusion.1, extrusion.2]));
            result.insert("patternName".into(), serde_json::json!(pattern_name));
            result.insert("solidFill".into(), serde_json::json!(solid_fill != 0));
            result.insert("associative".into(), serde_json::json!(associative != 0));

            // Parse boundary paths
            let mut paths = Vec::new();
            for _ in 0..num_paths.min(10000) {
                let path_flag = reader.read_bl()?;
                let mut path = serde_json::json!({"flags": path_flag});

                if path_flag & 2 != 0 {
                    // Polyline path
                    let has_bulge = reader.read_bit()?;
                    let is_closed = reader.read_bit()?;
                    let num_verts = reader.read_bl()? as usize;
                    let mut vertices = Vec::new();
                    for _ in 0..num_verts.min(100000) {
                        let pt = reader.read_2rd()?;
                        let bulge = if has_bulge != 0 { reader.read_bd()? } else { 0.0 };
                        if bulge != 0.0 {
                            vertices.push(serde_json::json!({"x": pt.0, "y": pt.1, "bulge": bulge}));
                        } else {
                            vertices.push(serde_json::json!({"x": pt.0, "y": pt.1}));
                        }
                    }
                    path["closed"] = serde_json::json!(is_closed != 0);
                    path["vertices"] = serde_json::json!(vertices);
                } else {
                    // Edge path
                    let num_edges = reader.read_bl()? as usize;
                    let mut edges = Vec::new();
                    for _ in 0..num_edges.min(10000) {
                        let edge_type = reader.read_byte()?;
                        match edge_type {
                            1 => { // Line
                                let p1 = reader.read_2rd()?;
                                let p2 = reader.read_2rd()?;
                                edges.push(serde_json::json!({"type": "line", "start": [p1.0, p1.1], "end": [p2.0, p2.1]}));
                            }
                            2 => { // Circular arc
                                let center = reader.read_2rd()?;
                                let radius = reader.read_bd()?;
                                let start_angle = reader.read_bd()?;
                                let end_angle = reader.read_bd()?;
                                let ccw = reader.read_bit()?;
                                edges.push(serde_json::json!({"type": "arc", "center": [center.0, center.1], "radius": radius, "startAngle": start_angle, "endAngle": end_angle, "ccw": ccw != 0}));
                            }
                            3 => { // Elliptic arc
                                let center = reader.read_2rd()?;
                                let major = reader.read_2rd()?;
                                let minor_ratio = reader.read_bd()?;
                                let start_angle = reader.read_bd()?;
                                let end_angle = reader.read_bd()?;
                                let ccw = reader.read_bit()?;
                                edges.push(serde_json::json!({"type": "ellipseArc", "center": [center.0, center.1], "majorAxis": [major.0, major.1], "minorRatio": minor_ratio, "startAngle": start_angle, "endAngle": end_angle, "ccw": ccw != 0}));
                            }
                            4 => { // Spline
                                let degree = reader.read_bl()?;
                                let _rational = reader.read_bit()?;
                                let _periodic = reader.read_bit()?;
                                let num_knots = reader.read_bl()? as usize;
                                let num_ctrl = reader.read_bl()? as usize;
                                let mut knots = Vec::new();
                                for _ in 0..num_knots.min(10000) {
                                    knots.push(reader.read_bd()?);
                                }
                                let mut ctrl_pts = Vec::new();
                                for _ in 0..num_ctrl.min(10000) {
                                    let pt = reader.read_2rd()?;
                                    ctrl_pts.push(serde_json::json!([pt.0, pt.1]));
                                }
                                edges.push(serde_json::json!({"type": "spline", "degree": degree, "knots": knots, "controlPoints": ctrl_pts}));
                            }
                            _ => break,
                        }
                    }
                    path["edges"] = serde_json::json!(edges);
                }

                // Source boundary object handles count
                let num_boundary_obj = reader.read_bl()? as usize;
                for _ in 0..num_boundary_obj.min(10000) {
                    reader.read_h()?; // skip boundary object handles
                }

                paths.push(path);
            }
            result.insert("boundaryPaths".into(), serde_json::json!(paths));

            // Pattern definition
            let hatch_style = reader.read_bs()?;
            let pattern_type = reader.read_bs()?;
            result.insert("hatchStyle".into(), serde_json::json!(hatch_style));
            result.insert("patternType".into(), serde_json::json!(pattern_type));

            if solid_fill == 0 {
                let pattern_angle = reader.read_bd()?;
                let pattern_scale = reader.read_bd()?;
                let _pattern_double = reader.read_bit()?;
                let num_def_lines = reader.read_bs()? as usize;
                result.insert("patternAngle".into(), serde_json::json!(pattern_angle));
                result.insert("patternScale".into(), serde_json::json!(pattern_scale));

                // Skip pattern definition lines
                for _ in 0..num_def_lines.min(1000) {
                    reader.read_bd()?; // angle
                    reader.read_2rd()?; // base point
                    reader.read_2rd()?; // offset
                    let num_dashes = reader.read_bs()? as usize;
                    for _ in 0..num_dashes.min(100) {
                        reader.read_bd()?;
                    }
                }
            }

            // Seed points
            let num_seeds = reader.read_bl()? as usize;
            let mut seeds = Vec::new();
            for _ in 0..num_seeds.min(10000) {
                let pt = reader.read_2rd()?;
                seeds.push(serde_json::json!([pt.0, pt.1]));
            }
            if !seeds.is_empty() {
                result.insert("seedPoints".into(), serde_json::json!(seeds));
            }

            Ok(())
        })();
        result
    }

    // ------------------------------------------------------------------
    // Table / non-entity object parsers
    // ------------------------------------------------------------------

    fn parse_table_object(
        &self,
        reader: &mut DwgBitReader,
        type_num: u16,
        _type_name: &str,
    ) -> HashMap<String, serde_json::Value> {
        let mut result = HashMap::new();

        let _ = match type_num {
            0x33 => self.parse_layer_obj(reader, &mut result),
            0x31 => self.parse_block_header_obj(reader, &mut result),
            0x35 => self.parse_style_obj(reader, &mut result),
            0x39 => self.parse_ltype_obj(reader, &mut result),
            0x2A => self.parse_dictionary_obj(reader, &mut result),
            0x4F => self.parse_xrecord_obj(reader, &mut result),
            _ => {
                // For custom class objects (type >= 500), try by DXF name
                if type_num >= 500 {
                    if let Some(cls) = self.class_map.get(&(type_num as i16)) {
                        match cls.dxf_name.as_str() {
                            "XRECORD" => { let _ = self.parse_xrecord_obj(reader, &mut result); }
                            "DICTIONARYVAR" => { let _ = self.parse_dictionaryvar_obj(reader, &mut result); }
                            _ => {}
                        }
                    }
                }
                Ok(())
            }
        };

        result
    }

    fn parse_layer_obj(
        &self,
        reader: &mut DwgBitReader,
        result: &mut HashMap<String, serde_json::Value>,
    ) -> Result<(), DwgError> {
        let _num_reactors = reader.read_bl()?;
        let name = reader.read_tv(self.version.is_r2007_plus())?;
        let _bit64 = reader.read_bit()?;
        let _xref_index = reader.read_bs()?;
        let _xdep = reader.read_bit()?;
        let flags = reader.read_bs()?;
        let color = reader.read_cmc()?;

        result.insert("name".into(), serde_json::json!(name));
        result.insert("flags".into(), serde_json::json!(flags));
        result.insert("color".into(), serde_json::json!(color));
        result.insert("frozen".into(), serde_json::json!(flags & 1 != 0));
        result.insert("off".into(), serde_json::json!(color < 0));
        result.insert("locked".into(), serde_json::json!(flags & 4 != 0));
        Ok(())
    }

    fn parse_block_header_obj(
        &self,
        reader: &mut DwgBitReader,
        result: &mut HashMap<String, serde_json::Value>,
    ) -> Result<(), DwgError> {
        let _num_reactors = reader.read_bl()?;
        let name = reader.read_tv(self.version.is_r2007_plus())?;
        let _bit64 = reader.read_bit()?;
        let _xref_index = reader.read_bs()?;
        let _xdep = reader.read_bit()?;
        let anonymous = reader.read_bit()?;
        let has_attribs = reader.read_bit()?;
        let blk_is_xref = reader.read_bit()?;

        result.insert("name".into(), serde_json::json!(name));
        result.insert("anonymous".into(), serde_json::json!(anonymous != 0));
        result.insert("hasAttribs".into(), serde_json::json!(has_attribs != 0));
        result.insert("isXref".into(), serde_json::json!(blk_is_xref != 0));
        Ok(())
    }

    fn parse_style_obj(
        &self,
        reader: &mut DwgBitReader,
        result: &mut HashMap<String, serde_json::Value>,
    ) -> Result<(), DwgError> {
        let is_unicode = self.version.is_r2007_plus();
        let _num_reactors = reader.read_bl()?;
        let name = reader.read_tv(is_unicode)?;
        let _bit64 = reader.read_bit()?;
        let _xref_index = reader.read_bs()?;
        let _xdep = reader.read_bit()?;
        let _is_vertical = reader.read_bit()?;
        let _is_shape_file = reader.read_bit()?;
        let fixed_height = reader.read_bd()?;
        let width_factor = reader.read_bd()?;
        let _oblique_angle = reader.read_bd()?;
        let _generation = reader.read_byte()?;
        let _last_height = reader.read_bd()?;
        let font_name = reader.read_tv(is_unicode)?;

        result.insert("name".into(), serde_json::json!(name));
        result.insert("fixedHeight".into(), serde_json::json!(fixed_height));
        result.insert("widthFactor".into(), serde_json::json!(width_factor));
        result.insert("fontName".into(), serde_json::json!(font_name));
        Ok(())
    }

    fn parse_ltype_obj(
        &self,
        reader: &mut DwgBitReader,
        result: &mut HashMap<String, serde_json::Value>,
    ) -> Result<(), DwgError> {
        let is_unicode = self.version.is_r2007_plus();
        let _num_reactors = reader.read_bl()?;
        let name = reader.read_tv(is_unicode)?;
        let _bit64 = reader.read_bit()?;
        let _xref_index = reader.read_bs()?;
        let _xdep = reader.read_bit()?;
        let description = reader.read_tv(is_unicode)?;
        let pattern_length = reader.read_bd()?;

        result.insert("name".into(), serde_json::json!(name));
        result.insert("description".into(), serde_json::json!(description));
        result.insert("patternLength".into(), serde_json::json!(pattern_length));
        Ok(())
    }

    fn parse_dictionary_obj(
        &self,
        reader: &mut DwgBitReader,
        result: &mut HashMap<String, serde_json::Value>,
    ) -> Result<(), DwgError> {
        let _num_reactors = reader.read_bl()?;
        let num_items = reader.read_bl()?;
        let _cloning_flag = reader.read_bs()?;
        let _hard_owner = reader.read_byte()?;

        let mut entries = serde_json::Map::new();
        for _ in 0..num_items {
            match reader.read_tv(self.version.is_r2007_plus()) {
                Ok(name) => {
                    match reader.read_h() {
                        Ok((_, handle_val)) => {
                            entries.insert(name, serde_json::json!(format!("{:X}", handle_val)));
                        }
                        Err(_) => break,
                    }
                }
                Err(_) => break,
            }
        }

        result.insert("numItems".into(), serde_json::json!(num_items));
        result.insert("entries".into(), serde_json::Value::Object(entries));
        Ok(())
    }

    fn parse_xrecord_obj(
        &self,
        reader: &mut DwgBitReader,
        result: &mut HashMap<String, serde_json::Value>,
    ) -> Result<(), DwgError> {
        let _num_reactors = reader.read_bl()?;
        let num_data_bytes = reader.read_bl()? as usize;
        let _cloning_flag = reader.read_bs()?;

        // Read data pairs: group_code (BS) + typed value
        let is_unicode = self.version.is_r2007_plus();
        let mut entries = Vec::new();
        let mut bytes_read = 0;

        while bytes_read < num_data_bytes {
            let gc = match reader.read_bs() {
                Ok(v) => v as i16,
                Err(_) => break,
            };
            bytes_read += 2;

            let value = if (0..10).contains(&gc) || gc == 100 || gc == 102 || gc == 300 || gc == 301 || (1000..1010).contains(&gc) {
                // String
                let s = reader.read_tv(is_unicode)?;
                bytes_read += s.len() + 2;
                serde_json::json!(s)
            } else if (10..60).contains(&gc) || (210..240).contains(&gc) || (1010..1060).contains(&gc) {
                // Double
                let v = reader.read_bd()?;
                bytes_read += 8;
                serde_json::json!(v)
            } else if (60..80).contains(&gc) || (170..180).contains(&gc) || (270..290).contains(&gc) || (1060..1072).contains(&gc) {
                // 16-bit int
                let v = reader.read_bs()?;
                bytes_read += 2;
                serde_json::json!(v)
            } else if (90..100).contains(&gc) || (1071..1072).contains(&gc) {
                // 32-bit int
                let v = reader.read_bl()?;
                bytes_read += 4;
                serde_json::json!(v)
            } else if (330..370).contains(&gc) {
                // Handle
                let (_, h) = reader.read_h()?;
                bytes_read += 4;
                serde_json::json!(format!("{:X}", h))
            } else {
                // Unknown — read as double
                let v = reader.read_bd()?;
                bytes_read += 8;
                serde_json::json!(v)
            };

            entries.push(serde_json::json!({"groupCode": gc, "value": value}));
        }

        result.insert("data".into(), serde_json::json!(entries));
        Ok(())
    }

    fn parse_dictionaryvar_obj(
        &self,
        reader: &mut DwgBitReader,
        result: &mut HashMap<String, serde_json::Value>,
    ) -> Result<(), DwgError> {
        let _num_reactors = reader.read_bl()?;
        let _schema_num = reader.read_byte()?;
        let value = reader.read_tv(self.version.is_r2007_plus())?;
        result.insert("value".into(), serde_json::json!(value));
        Ok(())
    }
}

impl Default for DwgParser {
    fn default() -> Self {
        Self::new()
    }
}

impl Default for DwgVersion {
    fn default() -> Self {
        Self::R2000
    }
}

// ---------------------------------------------------------------------------
// Standalone helpers
// ---------------------------------------------------------------------------

/// Resolve a handle reference given its code, raw value, and parent handle.
///
/// Handle codes 2-5 are absolute; codes 6, 8, 0xA, 0xC are relative to
/// the parent object's handle.
fn resolve_handle_ref(code: u8, raw_value: u32, parent_handle: u32) -> u32 {
    match code {
        2 | 3 | 4 | 5 => raw_value,
        6 => parent_handle.wrapping_add(1),
        8 => parent_handle.wrapping_sub(1),
        0x0A => parent_handle.wrapping_add(raw_value),
        0x0C => parent_handle.wrapping_sub(raw_value),
        _ => raw_value,
    }
}

/// Resolve handle references across all objects in a DwgFile.
///
/// Builds a handle→name map from LAYER, LTYPE, STYLE, and BLOCK_HEADER
/// objects, then populates each entity's `data["layer"]` etc.
pub fn resolve_handles(dwg: &mut DwgFile) {
    // Build handle → name for named objects
    let mut handle_to_name: HashMap<u32, (String, String)> = HashMap::new(); // handle → (type, name)
    for obj in &dwg.objects {
        if let Some(name) = obj.data.get("name").and_then(|v| v.as_str()) {
            if name.is_empty() { continue; }
            handle_to_name.insert(obj.handle, (obj.type_name.clone(), name.to_string()));
        }
    }

    // Resolve references on entities
    for obj in &mut dwg.objects {
        if !obj.is_entity { continue; }

        // Layer name
        if let Some(layer_handle) = obj.handle_refs.layer {
            if let Some((_, name)) = handle_to_name.get(&layer_handle) {
                obj.data.insert("layer".into(), serde_json::json!(name));
            }
        }

        // Linetype name
        if let Some(lt_handle) = obj.handle_refs.linetype {
            if let Some((_, name)) = handle_to_name.get(&lt_handle) {
                obj.data.insert("linetype".into(), serde_json::json!(name));
            }
        }
    }
}

/// Find a 16-byte sentinel in a data buffer.
fn find_sentinel(data: &[u8], sentinel: &[u8; 16]) -> Option<usize> {
    if data.len() < 16 { return None; }
    for i in 0..data.len() - 15 {
        if &data[i..i + 16] == sentinel {
            return Some(i);
        }
    }
    None
}

// ---------------------------------------------------------------------------
// R2004 LZ decompression
// ---------------------------------------------------------------------------

/// Decompress R2004+ section data using the DWG-specific LZ algorithm.
///
/// The algorithm uses opcode bytes to alternate between back-reference
/// copies and literal byte copies.
pub fn decompress_r2004(src: &[u8], decompressed_size: usize) -> Result<Vec<u8>, DwgError> {
    if decompressed_size == 0 || src.is_empty() {
        return Ok(Vec::new());
    }

    // Guard against corrupted size values (max 256MB)
    if decompressed_size > 0x10000000 {
        return Err(DwgError::InvalidBinary(
            format!("Decompressed size too large: {}", decompressed_size),
        ));
    }

    let mut dst = vec![0u8; decompressed_size];
    let mut si = 0usize; // source index
    let mut di = 0usize; // destination index

    // --- Initial literal run ---
    if si >= src.len() {
        return Ok(dst);
    }
    let first = src[si]; si += 1;
    let lit_length = if first == 0x00 {
        lz_read_length(src, &mut si) + 0x0F
    } else if first < 0x10 {
        first as usize
    } else {
        si -= 1; // push back — this is an opcode
        0
    };
    lz_copy_literals(src, &mut si, &mut dst, &mut di, lit_length);

    // --- Main decompression loop ---
    while si < src.len() && di < decompressed_size {
        let opcode = src[si]; si += 1;

        let (comp_bytes, comp_offset, mut lit_count);

        if opcode >= 0x40 {
            // Inline: compression info packed into opcode + one extra byte
            comp_bytes = (((opcode & 0xF0) >> 4) - 1) as usize;
            if si >= src.len() { break; }
            let b = src[si] as usize; si += 1;
            comp_offset = b + (((opcode & 0x0C) as usize) << 6);
            lit_count = (opcode & 0x03) as usize;
        } else if opcode >= 0x21 {
            // Medium: comp_bytes from opcode, two-byte offset
            comp_bytes = (opcode - 0x1E) as usize;
            let (off, lc) = lz_two_byte_offset(src, &mut si);
            comp_offset = off;
            lit_count = lc;
        } else if opcode == 0x20 {
            // Long: variable-length comp_bytes, two-byte offset
            comp_bytes = lz_read_length(src, &mut si) + 0x21;
            let (off, lc) = lz_two_byte_offset(src, &mut si);
            comp_offset = off;
            lit_count = lc;
        } else if opcode >= 0x12 {
            // Short with far offset
            comp_bytes = ((opcode & 0x0F) + 2) as usize;
            let (off, lc) = lz_two_byte_offset(src, &mut si);
            comp_offset = off + 0x3FFF;
            lit_count = lc;
        } else if opcode == 0x11 {
            break; // End of compressed data
        } else if opcode == 0x10 {
            // Long with far offset
            comp_bytes = lz_read_length(src, &mut si) + 9;
            let (off, lc) = lz_two_byte_offset(src, &mut si);
            comp_offset = off + 0x3FFF;
            lit_count = lc;
        } else {
            break; // 0x00–0x0F: should not appear in main loop
        }

        // Back-reference copy
        if comp_offset + 1 <= di {
            let src_start = di - comp_offset - 1;
            for k in 0..comp_bytes {
                if di >= decompressed_size { break; }
                dst[di] = dst[src_start + k];
                di += 1;
            }
        } else {
            // Offset underflow — skip this reference
            di += comp_bytes.min(decompressed_size - di);
        }

        // When lit_count == 0, peek at next byte for extended literal run
        if lit_count == 0 && si < src.len() {
            let peek = src[si];
            if peek == 0x00 {
                si += 1;
                lit_count = lz_read_length(src, &mut si) + 0x0F;
            } else if peek < 0x10 {
                si += 1;
                lit_count = peek as usize;
            }
            // else: lit_count stays 0, next byte is an opcode
        }

        lz_copy_literals(src, &mut si, &mut dst, &mut di, lit_count);
    }

    Ok(dst)
}

/// Read a run-length value: sum bytes until one is not 0xFF.
fn lz_read_length(src: &[u8], si: &mut usize) -> usize {
    let mut total = 0usize;
    loop {
        if *si >= src.len() { break; }
        let b = src[*si] as usize; *si += 1;
        total += b;
        if b != 0xFF { break; }
    }
    total
}

/// Read a two-byte offset: returns `(offset, literal_count)`.
fn lz_two_byte_offset(src: &[u8], si: &mut usize) -> (usize, usize) {
    if *si + 1 >= src.len() { return (0, 0); }
    let b1 = src[*si] as usize; *si += 1;
    let b2 = src[*si] as usize; *si += 1;
    let offset = (b1 >> 2) | (b2 << 6);
    let lit_count = b1 & 0x03;
    (offset, lit_count)
}

/// Copy `count` literal bytes from src to dst.
fn lz_copy_literals(src: &[u8], si: &mut usize, dst: &mut [u8], di: &mut usize, count: usize) {
    for _ in 0..count {
        if *si >= src.len() || *di >= dst.len() { break; }
        dst[*di] = src[*si];
        *si += 1;
        *di += 1;
    }
}
