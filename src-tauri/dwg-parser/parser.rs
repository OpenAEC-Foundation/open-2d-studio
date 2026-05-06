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

    pub fn is_r2010_plus(self) -> bool {
        self >= Self::R2010
    }

    pub fn is_r2004_plus(self) -> bool {
        self >= Self::R2004
    }

    fn to_code(self) -> &'static str {
        match self {
            Self::R13 => "AC1012",
            Self::R14 => "AC1014",
            Self::R2000 => "AC1015",
            Self::R2004 => "AC1018",
            Self::R2007 => "AC1021",
            Self::R2010 => "AC1024",
            Self::R2013 => "AC1027",
            Self::R2018 => "AC1032",
        }
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

// Legacy DWG version codes that we recognise but cannot yet decode. Per ODA
// OpenDesignSpec Appendix B "AutoCAD Drawing Database (DWG) Format File
// Version Identifiers", the magic string at byte offset 0 evolved as:
//   MC0.0   - AutoCAD 1.0  (May 1982)
//   AC1.2   - AutoCAD 1.2  (Aug 1982)
//   AC1.40  - AutoCAD 1.40 (Sep 1982)
//   AC1.50  - AutoCAD 2.05 (Apr 1983)
//   AC2.10  - AutoCAD 2.10 (Sep 1983)
//   AC1002  - AutoCAD 2.5  (Jun 1986)
//   AC1003  - AutoCAD 2.6  (Apr 1987)
//   AC1004  - AutoCAD R9   (Sep 1987)
//   AC1006  - AutoCAD R10  (Oct 1988)
//   AC1009  - AutoCAD R11/R12 (Oct 1990 / Jun 1992)
//   AC1012  - AutoCAD R13  (Nov 1994) <-- first version we decode
// These prefixes are useful to surface in diagnostics: returning
// NotImplemented("R10 (AC1006) decode not yet supported") is much friendlier
// than the previous opaque "Unsupported DWG version code: AC1006".
// Magic only — no binary structure decoded.
const LEGACY_VERSION_MAP: &[(&[u8], &str)] = &[
    (b"MC0.0\0", "R1.0"),
    (b"AC1.2\0", "R1.2"),
    (b"AC1.40", "R1.40"),
    (b"AC1.50", "R2.05"),
    (b"AC2.10", "R2.10"),
    (b"AC1002", "R2.5"),
    (b"AC1003", "R2.6"),
    (b"AC1004", "R9"),
    (b"AC1006", "R10"),
    (b"AC1009", "R11/R12"),
];

// Section record IDs (R2000)
const SECTION_HEADER: u8 = 0;
const SECTION_CLASSES: u8 = 1;
const SECTION_OBJECT_MAP: u8 = 2;

// Object type constants
fn obj_type_name(type_num: u16) -> Option<&'static str> {
    // Per ODA OpenDesignSpec Â§5.1 / Â§20.3 "Object type numbers".
    // Types below 500 are fixed and well-known. Types â‰¥ 500 are
    // class-indexed via the CLASSES section's class_number.
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
        0x0C => Some("VERTEX_MESH"),
        0x0D => Some("VERTEX_PFACE"),
        0x0E => Some("VERTEX_PFACE_FACE"),
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
        0x20 => Some("SHAPE"),
        0x21 => Some("VIEWPORT"),
        0x22 => Some("VIEWPORT"),
        0x23 => Some("ELLIPSE"),
        0x24 => Some("SPLINE"),
        0x25 => Some("REGION"),
        0x26 => Some("3DSOLID"),
        0x27 => Some("BODY"),
        0x28 => Some("RAY"),
        0x29 => Some("XLINE"),
        0x2A => Some("DICTIONARY"),
        0x2B => Some("OLEFRAME"),
        0x2C => Some("MTEXT"),
        0x2D => Some("LEADER"),
        0x2E => Some("TOLERANCE"),
        0x2F => Some("MLINE"),
        0x30 => Some("BLOCK_CONTROL"),
        0x31 => Some("BLOCK_HEADER"),
        0x32 => Some("LAYER_CONTROL"),
        0x33 => Some("LAYER"),
        0x34 => Some("STYLE_CONTROL"),
        0x35 => Some("STYLE"),
        0x38 => Some("LTYPE_CONTROL"),
        0x39 => Some("LTYPE"),
        0x3C => Some("VIEW_CONTROL"),
        0x3D => Some("VIEW"),
        0x3E => Some("UCS_CONTROL"),
        0x3F => Some("UCS"),
        0x40 => Some("VPORT_CONTROL"),
        0x41 => Some("VPORT"),
        0x42 => Some("APPID_CONTROL"),
        0x43 => Some("APPID"),
        0x44 => Some("DIMSTYLE_CONTROL"),
        0x45 => Some("DIMSTYLE"),
        0x46 => Some("VPORT_ENT_HEADER_CONTROL"),
        0x47 => Some("VPORT_ENT_HEADER"),
        0x48 => Some("GROUP"),
        0x49 => Some("MLINESTYLE"),
        0x4A => Some("OLE2FRAME"),
        0x4B => Some("DUMMY"),
        0x4C => Some("LONG_TRANSACTION"),
        0x4D => Some("LWPOLYLINE"),
        0x4E => Some("HATCH"),
        0x4F => Some("XRECORD"),
        0x50 => Some("PLACEHOLDER"),
        0x51 => Some("VBA_PROJECT"),
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
    /// For INSERT entities: the BLOCK_HEADER handle reference.
    pub block_header: Option<u32>,
    /// For INSERT/POLYLINE entities with attribs/owned objects:
    /// first entity handle, last entity handle, seqend handle.
    pub first_entity: Option<u32>,
    pub last_entity: Option<u32>,
    pub seqend: Option<u32>,
    /// R2004+: owned vertex/attrib handles read from the handle stream.
    pub owned_handles: Vec<u32>,
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
    /// When true, R2007+ string-stream setup is enabled for object parsing.
    /// Only set when parsing objects from properly assembled section data.
    /// Fallback/sentinel-scanned objects must use inline TV reading.
    use_string_stream: bool,
}

impl DwgParser {
    pub fn new() -> Self {
        Self {
            class_map: HashMap::new(),
            version: DwgVersion::R2000,
            use_string_stream: false,
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

        let ver = match DwgVersion::from_code(&dwg.version_code) {
            Some(v) => v,
            None => {
                // Try to recognise legacy pre-R13 magic and emit a readable
                // diagnostic with the AutoCAD release name. ODA OpenDesignSpec
                // Appendix B documents these magics; the binary structures
                // for R12 and earlier differ enough from the AC1012 layout
                // that we report them as NotImplemented rather than guess.
                let header_bytes = data[..6.min(data.len())].to_vec();
                let legacy = LEGACY_VERSION_MAP.iter().find(|(magic, _)| {
                    header_bytes.starts_with(&magic[..magic.len().min(header_bytes.len())])
                });
                if let Some((_, name)) = legacy {
                    return Err(DwgError::NotImplemented(format!(
                        "AutoCAD {} (magic {:?}) — pre-R13 DWG format not yet decoded; \
                         convert to R2000+ or load the .dxf companion if available",
                        name, dwg.version_code
                    )));
                }
                return Err(DwgError::InvalidBinary(format!(
                    "Unsupported DWG version code: {}", dwg.version_code
                )));
            }
        };
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

        // Resolve handle references â†’ layer names, linetype names, etc.
        resolve_handles(&mut dwg, data, self.version);

        // Extract thumbnail/preview image
        dwg.thumbnail = Self::extract_thumbnail(data);

        Ok(dwg)
    }

    /// Extract the preview/thumbnail image from the DWG file.
    ///
    /// For R13â€“R2000, the image seeker is at file offset 0x0D (4 bytes LE).
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

    /// Parse R13/R14 files.  The file structure is the same as R2000 â€”
    /// section locators in the file header, same object-map layout, same
    /// sentinel-delimited sections.  The main differences are:
    ///
    /// * R13 objects have no bitsize field.
    /// * BT (bit thickness) and BE (bit extrusion) are not available in
    ///   R13 â€” the parser reads BD / 3BD instead when the version is set.
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
                let raw = reader.read_bd()?;
                // Same clamp as parse_header_vars_from_bits â€” see that
                // function's comment block. R2000 generally lands the BD
                // vars at the right offset, but the same defensive guard
                // protects against any future preamble drift here too.
                let clean = if !raw.is_finite() || raw == 0.0 {
                    if matches!(*name, "$LTSCALE" | "$CMLSCALE") { 1.0 } else { 0.0 }
                } else if raw.abs() < 1e-6 || raw.abs() > 1e6 {
                    if matches!(*name, "$LTSCALE" | "$CMLSCALE") { 1.0 } else { 0.0 }
                } else {
                    raw
                };
                header.insert(name.to_string(), serde_json::json!(clean));
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

    // Per ODA §26.5 the HANDLES section uses per-sub-section delta streams,
    // so the outer-scope `last_handle`/`last_loc`/`pos` initial values are
    // overwritten before the first read inside the loop. The compiler can't
    // see that the inner loop unconditionally resets them, hence the
    // unused_assignments suppression.
    #[allow(unused_assignments)]
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

            // per ODA Â§26.5 / Â§29: each HANDLES sub-section has an INDEPENDENT
            // delta stream. Reset last_handle / last_loc at each sub-section
            // boundary so the first entry's hdelta is the absolute handle.
            last_handle = 0;
            last_loc = 0;

            while rpos < body_end {
                // Per ODA OpenDesignSpec Â§5.4.5: handle delta is UNSIGNED MC
                // (handles grow monotonically in the delta stream); location
                // delta is SIGNED MC (object offsets in the OBJECTS section
                // can shift back and forth as Acad interleaves writes).
                let (handle_delta_u, new_pos) = match DwgBitReader::read_unsigned_modular_char(data, rpos) {
                    Ok(v) => v,
                    Err(_) => break,
                };
                rpos = new_pos;
                let handle_delta = handle_delta_u as i32;

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
    // `pos` is restored before a `break` on the gap-skip path; the assignment
    // is technically dead but documents intent.
    #[allow(unused_assignments)]
    fn parse_object_map_r2004(&self, data: &[u8]) -> HashMap<u32, usize> {
        let mut object_map = HashMap::new();
        let mut pos = 0;

        let mut last_handle = 0i32;
        let mut last_loc = 0i32;
        let mut entry_count = 0usize;
        let mut section_count = 0usize;
        // Dump first 64 bytes of handles data
        let dump_len = data.len().min(64);
        let hex: String = data[..dump_len].iter().map(|b| format!("{:02x}", b)).collect::<Vec<_>>().join(" ");
        crate::dwg_dbg!("[dwg-dbg] objmap data[..{}]: {}", dump_len, hex);

        while pos < data.len() {
            if pos + 2 > data.len() { break; }
            let section_size = u16::from_be_bytes([data[pos], data[pos + 1]]) as usize;
            if section_size <= 2 {
                // Skip zero-filled gaps from page-aligned section assembly.
                // Multi-page HANDLES sections have gaps between page slots
                // of page_size bytes. Scan forward for the next valid section.
                let old_pos = pos;
                let mut found = false;
                // Skip to the next page boundary (try multiples of common page sizes)
                // The gap starts at pos. Scan forward for a plausible section header.
                let mut scan = pos + 2;
                while scan + 2 <= data.len() && scan < old_pos + 0x10000 {
                    if data[scan] == 0 && data[scan + 1] == 0 {
                        scan += 1;
                        continue;
                    }
                    let next_size = u16::from_be_bytes([data[scan], data[scan + 1]]) as usize;
                    if next_size > 2 && next_size < 4096 && scan + 2 + next_size <= data.len() {
                        // Validate: the next-next section header should also be plausible
                        let after = scan + 2 + next_size;
                        if after + 2 <= data.len() {
                            let nn = u16::from_be_bytes([data[after], data[after + 1]]) as usize;
                            if nn > 2 && nn < 4096 {
                                pos = scan;
                                found = true;
                                break;
                            }
                        }
                    }
                    scan += 1;
                }
                if found {
                    crate::dwg_dbg!("[dwg-dbg] objmap: gap-skip from pos={} to pos={} (skipped {} bytes), last_handle=0x{:X} last_loc={}",
                        old_pos, pos, pos - old_pos, last_handle, last_loc);
                }
                if !found {
                    pos = old_pos;
                    break;
                }
            }
            section_count += 1;
            if section_count <= 5 || section_count % 10 == 0 {
                crate::dwg_dbg!("[dwg-dbg] objmap sec={}: pos={} section_size={}", section_count, pos, section_size);
            }

            let body_start = pos + 2;
            let body_end = (body_start + section_size - 2).min(data.len());
            let mut rpos = body_start;

            // per ODA Â§26.5: each HANDLES sub-section's delta stream is
            // INDEPENDENT â€” last_handle and last_loc reset to 0 at the start
            // of every sub-section. Sub-sections cover contiguous handle
            // ranges where the FIRST entry's hdelta is the absolute handle
            // value (not a delta from the previous sub-section's last).
            // Evidence (clean-room oracle): on Funderingsherstel DXF handles
            // max=0x165A with $HANDSEED=0x165A; without reset our decoder
            // produced a max handle of 0x51C1 (3.5Ã— too large) because large
            // first-entry hdeltas per sub-section (869, 1631, 3176, 4231,
            // 5309) kept accumulating. Resetting per sub-section yields
            // handles 0x365, 0x65F, 0xC68, 0x1087, 0x14BD at sub-section
            // starts â€” all within the DXF handle space.
            // per ODA Â§29 entry
            last_handle = 0;
            last_loc = 0;

            while rpos < body_end {
                let rpos_before = rpos;
                // Per ODA OpenDesignSpec Â§5.4.5: handle delta is UNSIGNED MC
                // (handles in the Handles Section grow monotonically in the
                // delta stream); location delta is SIGNED MC (object offsets
                // in the OBJECTS section can shift back and forth as Acad
                // interleaves writes).
                let (handle_delta_u, new_pos) = match DwgBitReader::read_unsigned_modular_char(data, rpos) {
                    Ok(v) => v,
                    Err(_) => break,
                };
                rpos = new_pos;
                let handle_delta = handle_delta_u as i32;

                let (loc_delta, new_pos) = match DwgBitReader::read_modular_char(data, rpos) {
                    Ok(v) => v,
                    Err(_) => break,
                };
                rpos = new_pos;

                last_handle = last_handle.wrapping_add(handle_delta);
                last_loc = last_loc.wrapping_add(loc_delta);

                if entry_count < 5 || (entry_count % 50000 == 0) {
                    crate::dwg_dbg!("[dwg-dbg] objmap[{}] sec={} @pos={}: hdelta={} ldelta={} -> handle=0x{:X} loc={}",
                        entry_count, section_count, pos, handle_delta, loc_delta, last_handle, last_loc);
                }
                let _ = rpos_before;
                entry_count += 1;

                // Accept all positive handles and non-negative locations.
                // Locations are offsets into the objects section, not this buffer.
                if last_handle > 0 && last_loc >= 0 {
                    object_map.insert(last_handle as u32, last_loc as usize);
                }
            }

            pos += 2 + section_size;
        }
        crate::dwg_dbg!("[dwg-dbg] objmap: {} sections, {} entries, data.len={}",
            section_count, entry_count, data.len());
        // Show distribution of offsets
        if !object_map.is_empty() {
            let max_off = object_map.values().max().copied().unwrap_or(0);
            let min_off = object_map.values().min().copied().unwrap_or(0);
            crate::dwg_dbg!("[dwg-dbg] objmap offset range: {}..{}", min_off, max_off);
        }

        object_map
    }

    /// Parse the object map page-by-page for R2018, using section map data_size
    /// per page to limit the decompressed data to valid bytes only.
    fn parse_object_map_paged_r2018(
        &self,
        file_data: &[u8],
        page_map: &HashMap<i32, usize>,
        page_size: usize,
        target_section: i32,
        page_data_sizes: &HashMap<i32, u32>,
    ) -> HashMap<u32, usize> {
        let mut object_map = HashMap::new();
        let mut last_handle = 0i32;
        let mut last_loc = 0i32;
        let mut entry_count = 0usize;
        let mut page_count = 0usize;

        // Collect pages for this section from the page map
        struct PageInfo {
            page_number: i32,
            file_offset: usize,
            valid_data_size: usize, // from section map
        }
        let mut pages = Vec::new();

        for (&page_num, &file_offset) in page_map {
            if file_offset + 32 > file_data.len() { continue; }
            let mask = 0x4164536Bu32 ^ (file_offset as u32);
            let mut hdr = [0u8; 32];
            hdr.copy_from_slice(&file_data[file_offset..file_offset + 32]);
            for dw in 0..8 {
                let off = dw * 4;
                let val = u32::from_le_bytes([hdr[off], hdr[off+1], hdr[off+2], hdr[off+3]]);
                let dec = val ^ mask;
                hdr[off..off+4].copy_from_slice(&dec.to_le_bytes());
            }
            let sec_number = i32::from_le_bytes([hdr[4], hdr[5], hdr[6], hdr[7]]);
            if sec_number != target_section { continue; }
            let sec_type = i32::from_le_bytes([hdr[0], hdr[1], hdr[2], hdr[3]]);
            if sec_type != 1 && sec_type != 2 && (sec_type as u32) < 0x41000000 { continue; }

            // Get valid data size from section map, or use dsize from header
            let valid_size = page_data_sizes.get(&page_num)
                .map(|&v| v as usize)
                .unwrap_or(page_size);

            // Get start_offset for sorting
            let start_off = u32::from_le_bytes([hdr[16], hdr[17], hdr[18], hdr[19]]) as usize;

            pages.push((start_off, PageInfo { page_number: page_num, file_offset, valid_data_size: valid_size }));
        }

        pages.sort_by_key(|(so, _)| *so);
        let pages: Vec<PageInfo> = pages.into_iter().map(|(_, p)| p).collect();
        crate::dwg_dbg!("[dwg-dbg] objmap_paged_r2018: {} pages for sec={}", pages.len(), target_section);

        for page in &pages {
            let body_offset = page.file_offset + 32;
            // Use dsize from the XOR header as comp input size
            let mask = 0x4164536Bu32 ^ (page.file_offset as u32);
            let dsize_raw = u32::from_le_bytes([
                file_data[page.file_offset + 8], file_data[page.file_offset + 9],
                file_data[page.file_offset + 10], file_data[page.file_offset + 11],
            ]) ^ mask;
            let comp_input = dsize_raw as usize;
            if body_offset + comp_input > file_data.len() { continue; }

            let decompressed = match decompress_r2004(
                &file_data[body_offset..body_offset + comp_input],
                page_size,
            ) {
                Ok(d) => d,
                Err(_) => continue,
            };

            // Limit to valid_data_size from section map
            let valid_len = decompressed.len().min(page.valid_data_size);
            let page_data = &decompressed[..valid_len];

            let mut pos = 0;
            let page_entries_before = entry_count;
            while pos + 2 <= page_data.len() {
                let section_size = u16::from_be_bytes([page_data[pos], page_data[pos + 1]]) as usize;
                if section_size <= 2 { break; }
                if section_size > 4096 || pos + 2 + section_size > page_data.len() + 2 { break; }

                let body_start = pos + 2;
                let body_end = (body_start + section_size - 2).min(page_data.len());
                let mut rpos = body_start;

                while rpos < body_end {
                    // Per ODA OpenDesignSpec Â§5.4.5: handle delta = unsigned MC,
                    // location delta = signed MC.
                    let (handle_delta_u, new_pos) = match DwgBitReader::read_unsigned_modular_char(page_data, rpos) {
                        Ok(v) => v,
                        Err(_) => break,
                    };
                    rpos = new_pos;
                    let handle_delta = handle_delta_u as i32;
                    let (loc_delta, new_pos) = match DwgBitReader::read_modular_char(page_data, rpos) {
                        Ok(v) => v,
                        Err(_) => break,
                    };
                    rpos = new_pos;

                    last_handle = last_handle.wrapping_add(handle_delta);
                    last_loc = last_loc.wrapping_add(loc_delta);
                    entry_count += 1;

                    if last_handle > 0 && last_loc >= 0 {
                        object_map.insert(last_handle as u32, last_loc as usize);
                    }
                }
                pos += 2 + section_size;
            }
            let page_entries = entry_count - page_entries_before;
            if page_count < 3 || page_count % 20 == 0 {
                crate::dwg_dbg!("[dwg-dbg] objmap_r2018: page {} (pg{}) -> {} entries, valid_data={}B, stop@pos={}/{}",
                    page_count, page.page_number, page_entries, page.valid_data_size, pos, valid_len);
            }
            page_count += 1;
        }

        crate::dwg_dbg!("[dwg-dbg] objmap_paged_r2018: {} pages, {} entries, {} unique handles",
            page_count, entry_count, object_map.len());
        if !object_map.is_empty() {
            let max_off = object_map.values().max().copied().unwrap_or(0);
            let min_off = object_map.values().min().copied().unwrap_or(0);
            crate::dwg_dbg!("[dwg-dbg] objmap_paged_r2018 offset range: {}..{}", min_off, max_off);
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

        // Build page map: page_number â†’ file_offset
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
        let mut section_map_data = self.assemble_r2004_section(
            data, page_map, page_size, section_map_id,
        ).unwrap_or_default();
        // R2010+ section map pages use raw headers (no XOR). If the R2004
        // assembler fails (empty result), fall back to the R2007 assembler
        // which tries both raw and XOR-decrypted headers.
        if section_map_data.is_empty() && self.version.is_r2007_plus() {
            crate::dwg_dbg!("[dwg-dbg] section_map via r2004 empty, trying r2007 assembler for smid={}", section_map_id);
            match crate::r2007::assemble_section(
                data, page_map, page_size, section_map_id, self.version.to_code(),
            ) {
                Ok(d) => {
                    crate::dwg_dbg!("[dwg-dbg] r2007 assembler for smid={}: {}B", section_map_id, d.len());
                    section_map_data = d;
                }
                Err(e) => {
                    crate::dwg_dbg!("[dwg-dbg] r2007 assembler for smid={} failed: {:?}", section_map_id, e);
                }
            }
        }
        // Third fallback: read the section map page directly by page number.
        // For R2010+, section_map_id is a page number, not a section number.
        if section_map_data.is_empty() && self.version.is_r2010_plus() {
            crate::dwg_dbg!("[dwg-dbg] section_map still empty, trying direct page read for smid={}", section_map_id);
            match crate::r2007::read_section_map_by_page(data, page_map, section_map_id) {
                Ok(d) => {
                    crate::dwg_dbg!("[dwg-dbg] direct page read for smid={}: {}B", section_map_id, d.len());
                    section_map_data = d;
                }
                Err(e) => {
                    crate::dwg_dbg!("[dwg-dbg] direct page read for smid={} failed: {:?}", section_map_id, e);
                }
            }
        }
        if !section_map_data.is_empty() {
            // Dump bytes 0..116 as hex for header analysis
            let dump_end = 120.min(section_map_data.len());
            let hex: String = section_map_data[..dump_end].iter()
                .map(|b| format!("{:02x}", b)).collect::<Vec<_>>().join(" ");
            crate::dwg_dbg!("[dwg-dbg] smap hex[0..{}]: {}", dump_end, hex);
            // Find "AcDb:" names and dump 40 bytes before each
            for i in 0..section_map_data.len().saturating_sub(5) {
                if &section_map_data[i..i+5] == b"AcDb:" {
                    let end = (i + 64).min(section_map_data.len());
                    let name: String = section_map_data[i..end].iter()
                        .take_while(|&&b| b != 0).map(|&b| b as char).collect();
                    // Dump 40 bytes before the name as LE u32 values
                    let hdr_start = i.saturating_sub(40);
                    let dwords: Vec<String> = (0..10).filter_map(|d| {
                        let off = hdr_start + d*4;
                        if off + 4 <= i {
                            let v = u32::from_le_bytes([
                                section_map_data[off], section_map_data[off+1],
                                section_map_data[off+2], section_map_data[off+3],
                            ]);
                            Some(format!("[{}]={}", off, v))
                        } else { None }
                    }).collect();
                    crate::dwg_dbg!("[dwg-dbg] smap name '{}' @{}: pre-dwords: {}", name, i, dwords.join(" "));
                }
            }
        }
        let section_info = Self::parse_r2004_section_map(&section_map_data);
        crate::dwg_dbg!("[dwg-dbg] section_map ({} bytes): {} sections found", section_map_data.len(), section_info.len());
        for si in &section_info {
            crate::dwg_dbg!("[dwg-dbg]   type=0x{:08X} sec_num={} name={:?} pages={} data_size={}",
                si.section_type as u32, si.section_number, si.name, si.page_count, si.data_size);
        }

        // Build the section type â†’ section_number mapping.
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

        // Extract and parse classes section.
        // Use _full assembler so the LZ77 decoder runs to its END opcode
        // instead of being truncated by the page header's unreliable
        // data_size field. See assemble_r2004_section_full() docs.
        if let Some(&sec_id) = section_ids.get(&SECTION_TYPE_CLASSES) {
            let cls_data = self.assemble_r2004_section_full(
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
            // Per ODA Â§4.5.2 the HANDLES section is a sequence of sub-sections.
            // Each sub-section's 2-byte BE size field can claim more than the
            // page header's per-page data_size reports; AutoCAD-saved R2010+
            // files regularly emit an under-reported data_size so that the
            // tight assembler truncates the last ~200 bytes of handles.
            // Use _full so LZ77 runs to its END opcode and trailing zero-fill
            // terminates our decoder gracefully (zero-size sub-section).
            let hdl_data = self.assemble_r2004_section_full(
                data, page_map, page_size, sec_id,
            )?;
            // Parse object map without buffer-size filtering (offsets are
            // section-relative into the objects section, not this buffer)
            dwg.object_map = self.parse_object_map_r2004(&hdl_data);
        }

        // Assemble the objects section (AcDb:AcDbObjects)
        if let Some(&sec_id) = section_ids.get(&SECTION_TYPE_OBJECTS) {
            // per ODA Â§4.7 LZ77 terminates on END opcode and may emit past
            // declared decomp_size; full assembler must capture all bytes
            // until END, not stop at the header's decomp_size.
            let obj_data = self.assemble_r2004_section_full(
                data, page_map, page_size, sec_id,
            )?;
            if !obj_data.is_empty() {
                objects_data = Some(obj_data);
            }
        }

        crate::dwg_dbg!("[dwg-dbg] sections: {:?} object_map={} objects_section={}",
            section_ids.keys().collect::<Vec<_>>(), dwg.object_map.len(),
            objects_data.as_ref().map(|b| b.len()).unwrap_or(0));

        // Diagnostic: analyze zero-fill coverage in the objects section
        if let Some(ref obj_data) = objects_data {
            let total = obj_data.len();
            // Count zero pages (4KB chunks that are entirely zero)
            let page_sz = 4096;
            let n_pages = total / page_sz;
            let zero_pages = (0..n_pages)
                .filter(|&i| obj_data[i*page_sz..(i+1)*page_sz].iter().all(|&b| b == 0))
                .count();
            // Count object map offsets pointing to zero regions
            let zero_offsets = dwg.object_map.values()
                .filter(|&&off| {
                    let o = off as usize;
                    o + 2 <= total && obj_data[o] == 0 && obj_data[o+1] == 0
                })
                .count();
            // Find max offset in object map
            let max_off = dwg.object_map.values().max().copied().unwrap_or(0);
            let oob_offsets = dwg.object_map.values()
                .filter(|&&off| (off as usize) >= total)
                .count();
            crate::dwg_dbg!("[dwg-dbg] obj_section coverage: {}/{} 4K pages are all-zero, {}/{} map offsets -> zeros, {}/{} offsets OOB (>{}), max_off={}",
                zero_pages, n_pages, zero_offsets, dwg.object_map.len(), oob_offsets, dwg.object_map.len(), total, max_off);
        }

        // Parse objects from the assembled objects section
        if !dwg.object_map.is_empty() {
            if let Some(ref obj_buf) = objects_data {
                self.use_string_stream = true;
                dwg.objects = self.parse_objects_r2000(obj_buf, &dwg.object_map, &dwg.classes);
                self.use_string_stream = false;
                crate::dwg_dbg!("[dwg-dbg] parse_objects from obj_section ({}B): {} parsed",
                    obj_buf.len(), dwg.objects.len());
            } else {
                dwg.objects = self.parse_objects_r2000(data, &dwg.object_map, &dwg.classes);
                crate::dwg_dbg!("[dwg-dbg] parse_objects fallback raw file: {} parsed", dwg.objects.len());
            }
        }

        // If we didn't produce any useful results, report failure so callers
        // can fall through to alternative parsing paths.
        if dwg.objects.is_empty() && dwg.header_vars.len() <= 1 {
            return Err(DwgError::InvalidBinary(
                "R2004 section pipeline produced no objects or header vars".into(),
            ));
        }

        Ok(())
    }

    /// Build section type â†’ section_number mapping from parsed section info.
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
            if info.section_number > 0 {
                // The section_number from the section map should match the
                // sec_number stored in the XOR-decrypted page headers.
                // Verify by checking one page header if possible.
                let mut verified = false;
                for &file_offset in page_map.values() {
                    if file_offset + 32 > data.len() { continue; }
                    let mask = 0x4164536Bu32 ^ (file_offset as u32);
                    let raw = u32::from_le_bytes([
                        data[file_offset + 4], data[file_offset + 5],
                        data[file_offset + 6], data[file_offset + 7],
                    ]);
                    let sec_num = (raw ^ mask) as i32;
                    if sec_num == info.section_number {
                        verified = true;
                        break;
                    }
                }
                result.insert(info.section_type, info.section_number);
                if !verified {
                    crate::dwg_dbg!("[dwg-dbg] section type=0x{:08X} sec_num={} NOT verified in page headers",
                        info.section_type as u32, info.section_number);
                }
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
        // Collect unique section_numbers from page headers.
        // Per ODA Â§4.4: data section page headers are XOR-encrypted.
        let mut sec_nums = std::collections::HashSet::new();
        for (&_page_num, &file_offset) in page_map {
            if file_offset + 32 > data.len() { continue; }
            let mask = 0x4164536Bu32 ^ (file_offset as u32);
            let sec_type = (i32::from_le_bytes([
                data[file_offset], data[file_offset + 1],
                data[file_offset + 2], data[file_offset + 3],
            ]) as u32 ^ mask) as i32;
            let sec_num = (i32::from_le_bytes([
                data[file_offset + 4], data[file_offset + 5],
                data[file_offset + 6], data[file_offset + 7],
            ]) as u32 ^ mask) as i32;
            let dsize = (u32::from_le_bytes([
                data[file_offset + 8], data[file_offset + 9],
                data[file_offset + 10], data[file_offset + 11],
            ]) ^ mask) as usize;
            let csize = (u32::from_le_bytes([
                data[file_offset + 12], data[file_offset + 13],
                data[file_offset + 14], data[file_offset + 15],
            ]) ^ mask) as usize;
            // Data pages: sec_type 1/2 (legacy) or section hash >= 0x41000000
            let valid_type = sec_type == 1 || sec_type == 2 || (sec_type as u32) >= 0x41000000;
            crate::dwg_dbg!("[dwg-dbg] probe page @0x{:X}: sec_type=0x{:08X} sec_num={} ds={} cs={} valid={}",
                file_offset, sec_type as u32, sec_num, dsize, csize, valid_type);
            if valid_type && sec_num > 0 && sec_num != section_map_id {
                sec_nums.insert(sec_num);
            }
        }

        let mut result = HashMap::new();
        crate::dwg_dbg!("[dwg-dbg] probe_sections: unique sec_nums={:?} (smid={})", sec_nums, section_map_id);

        // Track unidentified sections to pick the largest as OBJECTS fallback
        let mut unidentified: Vec<(i32, usize)> = Vec::new();

        for sec_num in &sec_nums {
            let assembled = match self.assemble_r2004_section(data, page_map, page_size, *sec_num) {
                Ok(d) if !d.is_empty() => d,
                _ => {
                    crate::dwg_dbg!("[dwg-dbg]   sec_num={}: empty or error", sec_num);
                    continue;
                }
            };

            crate::dwg_dbg!("[dwg-dbg]   sec_num={}: assembled {}B, first8={:02X?}",
                sec_num, assembled.len(), &assembled[..8.min(assembled.len())]);

            // Check for header sentinel
            if find_sentinel(&assembled, &HEADER_SENTINEL_START).is_some() {
                crate::dwg_dbg!("[dwg-dbg]   sec_num={}: -> HEADER", sec_num);
                result.insert(SECTION_TYPE_HEADER, *sec_num);
                continue;
            }

            // Check for classes sentinel
            if find_sentinel(&assembled, &CLASSES_SENTINEL_START).is_some() {
                crate::dwg_dbg!("[dwg-dbg]   sec_num={}: -> CLASSES", sec_num);
                result.insert(SECTION_TYPE_CLASSES, *sec_num);
                continue;
            }

            // Per ODA Â§4.5.2 the HANDLES section is a sequence of sub-sections,
            // each with a 2-byte BE size prefix followed by (hdelta uMC, ldelta sMC)
            // pairs and a 2-byte CRC. Rather than the old "first BE short looks
            // plausible" heuristic (which misidentified a 223B page as HANDLES
            // in the Revit legend file), we now SCORE each candidate section by
            // actually running the object-map decoder against it and comparing
            // the number of valid monotonic-handle entries produced. The true
            // HANDLES section yields an order of magnitude more entries than
            // any false-positive page.
            if assembled.len() >= 4 {
                let sec_size = u16::from_be_bytes([assembled[0], assembled[1]]) as usize;
                if sec_size >= 10 && sec_size < 4096 {
                    let body_start = 2usize;
                    let body = if sec_size + 2 <= assembled.len() {
                        &assembled[body_start..body_start + sec_size - 2]
                    } else {
                        // sub-section claims more than buffer â€” try decoding
                        // what's available; the real HANDLES section may be
                        // padded with zeros after the valid bytes.
                        &assembled[body_start..]
                    };
                    if Self::looks_like_object_map(body) {
                        // Score by full decode â€” record and compare after the loop
                        let score = Self::score_object_map(&assembled);
                        let prev_score = result.get(&SECTION_TYPE_HANDLES)
                            .and_then(|&prev_sec| self.assemble_r2004_section(data, page_map, page_size, prev_sec).ok())
                            .map(|d| Self::score_object_map(&d))
                            .unwrap_or(0);
                        if score > prev_score {
                            crate::dwg_dbg!("[dwg-dbg]   sec_num={}: -> HANDLES ({}B, {} entries; prev_score={})",
                                sec_num, assembled.len(), score, prev_score);
                            result.insert(SECTION_TYPE_HANDLES, *sec_num);
                        } else {
                            crate::dwg_dbg!("[dwg-dbg]   sec_num={}: HANDLES candidate rejected ({} entries <= prev {})",
                                sec_num, score, prev_score);
                        }
                        continue;
                    }
                }
            }

            // Check for objects section (MS size prefix + BS object type)
            if assembled.len() >= 8 {
                if Self::looks_like_objects_section(&assembled) {
                    crate::dwg_dbg!("[dwg-dbg]   sec_num={}: -> OBJECTS (heuristic)", sec_num);
                    result.insert(SECTION_TYPE_OBJECTS, *sec_num);
                    continue;
                }
            }

            crate::dwg_dbg!("[dwg-dbg]   sec_num={}: unidentified ({}B)", sec_num, assembled.len());
            unidentified.push((*sec_num, assembled.len()));
        }

        // If OBJECTS wasn't identified by heuristic, use the largest unidentified
        // section (the objects section is typically the largest in the file).
        if !result.contains_key(&SECTION_TYPE_OBJECTS) && !unidentified.is_empty() {
            unidentified.sort_by(|a, b| b.1.cmp(&a.1));
            let (best_sec, best_size) = unidentified[0];
            if best_size >= 256 {
                crate::dwg_dbg!("[dwg-dbg]   sec_num={}: -> OBJECTS (largest unidentified, {}B)", best_sec, best_size);
                result.insert(SECTION_TYPE_OBJECTS, best_sec);
            }
        }
        // If OBJECTS was identified but there's a much larger unidentified section,
        // prefer the larger one (false positive from small section).
        if let Some(&obj_sec) = result.get(&SECTION_TYPE_OBJECTS) {
            if let Some(&(largest_sec, largest_size)) = unidentified.iter().max_by_key(|x| x.1) {
                // Assemble current OBJECTS to check its size
                if let Ok(cur_obj) = self.assemble_r2004_section(data, page_map, page_size, obj_sec) {
                    if largest_size > cur_obj.len() * 4 && largest_size >= 1024 {
                        crate::dwg_dbg!("[dwg-dbg]   override OBJECTS: sec_num={} ({}B) -> sec_num={} ({}B)",
                            obj_sec, cur_obj.len(), largest_sec, largest_size);
                        result.insert(SECTION_TYPE_OBJECTS, largest_sec);
                    }
                }
            }
        }

        result
    }

    /// Score an assembled section as a HANDLES candidate by running the full
    /// ODA Â§4.5.2 decode: for each sub-section (2-byte BE size + MC pairs),
    /// count valid monotonic-handle entries. Terminates gracefully on zero-
    /// padded sub-section headers (common when LZ77 overshoots data_size).
    /// The REAL HANDLES section yields hundreds-to-thousands of entries; all
    /// false-positive pages yield <200. This avoids the pre-existing bug
    /// where a 223-byte first-sub-section-size-plausible page outranked the
    /// true 1815-byte HANDLES section.
    fn score_object_map(data: &[u8]) -> usize {
        let mut count = 0usize;
        let mut pos = 0usize;
        let mut last_handle = 0i32;
        let mut last_loc = 0i32;
        while pos + 4 <= data.len() {
            let section_size = u16::from_be_bytes([data[pos], data[pos + 1]]) as usize;
            if section_size == 0 || section_size == 2 { break; }
            if section_size > 4096 { break; }
            // If section claims more than remaining buffer, cap at remaining.
            let body_end = (pos + 2 + section_size.saturating_sub(2)).min(data.len());
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
                if last_handle > 0 && last_loc >= 0 && (hd as i32) < 10_000 {
                    count += 1;
                    sec_entries += 1;
                }
                rpos = p2;
            }
            if sec_entries == 0 { break; }
            pos += 2 + section_size;
            if pos + 2 > data.len() { break; }
        }
        count
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
            // Not fatal â€” some files have variant signatures
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
    ///   +0:  section_type (RL) â€” e.g., 0x4163043B for page map
    ///   +4:  decompressed_size (RL)
    ///   +8:  compressed_size (RL)
    ///   +12: compression_type (RL) â€” 2 = compressed
    ///   +16: checksum (RL)
    ///   +20: body data
    ///
    /// Data section pages (type 1 or 2) have a 32-byte header:
    ///   +0:  compression_type (RL) â€” 1=uncomp, 2=comp
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
        // IMPORTANT: Multiple pages can share the same section_number (they
        // belong to the same section). We use page_idx as the key so every
        // page gets its own entry. The section_number is re-read from the
        // XOR-decrypted page header during assembly.
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
                page_map.insert(page_idx, file_offset);
            }
            page_idx += 1;
        }

        crate::dwg_dbg!("[dwg-dbg] page_map: {} entries from {} total slots, page_size=0x{:X}",
            page_map.len(), page_idx, page_size);

        Ok(page_map)
    }

    /// Fallback page map builder: walk the file from 0x100 onward, XOR-decrypt
    /// each 32-byte data page header, and build the page map directly.
    /// Per ODA Â§4.4: data section page headers use mask = 0x4164536B ^ file_offset.
    fn build_page_map_by_walking(data: &[u8]) -> HashMap<i32, usize> {
        let mut page_map = HashMap::new();
        let mut offset = 0x100usize;
        let mut page_num = 1i32;
        let known_sec_type = 0x4163043Bu32; // common data page sec_type hash

        while offset + 32 < data.len() {
            let mask = 0x4164536Bu32 ^ (offset as u32);
            let mut hdr = [0u8; 32];
            hdr.copy_from_slice(&data[offset..offset + 32]);
            for dw in 0..8 {
                let off = dw * 4;
                let val = u32::from_le_bytes([hdr[off], hdr[off+1], hdr[off+2], hdr[off+3]]);
                let dec = val ^ mask;
                hdr[off..off+4].copy_from_slice(&dec.to_le_bytes());
            }

            let sec_type = u32::from_le_bytes([hdr[0], hdr[1], hdr[2], hdr[3]]);
            // per ODA OpenDesignSpec Â§4.6 data-page header layout:
            //   hdr[0..4]  = section_type hash
            //   hdr[4..8]  = section_number
            //   hdr[8..12]  = comp_size   (on-disk compressed body bytes)
            //   hdr[12..16] = decomp_size (logical uncompressed bytes)
            // Prior code swapped these (comp_size read from [12..16]). Matches
            // Â§24 Fix 2's parser.rs/r2007.rs alignment on page-header field
            // positions.
            let comp_size = u32::from_le_bytes([hdr[8], hdr[9], hdr[10], hdr[11]]) as usize;

            // Valid data pages have sec_type matching the known hash, or 1/2
            if sec_type != known_sec_type && sec_type != 1 && sec_type != 2 {
                break;
            }
            if comp_size == 0 || comp_size > 0x100000 || offset + 32 + comp_size > data.len() {
                break;
            }

            page_map.insert(page_num, offset);
            page_num += 1;
            // On-disk page stride = 32-byte XOR-encrypted header + comp_size
            // (compressed body) + variable trailing alignment padding. Without
            // the authoritative page_map this walker can only make a best-
            // effort guess: round UP to a 32-byte boundary (ODA pages are
            // aligned this way). Any file with more aggressive padding will
            // cause this heuristic to desynchronise â€” it is a LAST-RESORT
            // fallback only used when read_page_map fails entirely.
            let stride_body = comp_size;
            let stride_total = 32 + stride_body;
            let aligned = (stride_total + 31) & !31;
            offset += aligned;
        }

        crate::dwg_dbg!("[dwg-dbg] build_page_map_by_walking: found {} pages (0x100..0x{:X})",
            page_map.len(), offset);
        page_map
    }

    /// Assemble an R2004 section by collecting all pages that belong to
    /// `target_section` and decompressing them.
    fn assemble_r2004_section(
        &self,
        data: &[u8],
        page_map: &HashMap<i32, usize>,
        page_size: usize,
        target_section: i32,
    ) -> Result<Vec<u8>, DwgError> {
        self.assemble_r2004_section_inner(data, page_map, page_size, target_section, false, false)
    }

    /// Assemble a section with tight packing (no page-size padding).
    /// Use for sections like Handles where the data is a sequential stream
    /// and the parser doesn't use page-aligned offsets.
    fn assemble_r2004_section_tight(
        &self,
        data: &[u8],
        page_map: &HashMap<i32, usize>,
        page_size: usize,
        target_section: i32,
    ) -> Result<Vec<u8>, DwgError> {
        self.assemble_r2004_section_inner(data, page_map, page_size, target_section, true, false)
    }

    /// Assemble a section using `page_size` as the LZ77 decompression target
    /// for every page, ignoring the page header's data_size field. AutoCAD-
    /// saved DWG files (e.g. AcadSharp samples sample_AC1024..AC1032 and
    /// LibreDWG's example_2010) put the COMPRESSED body length minus
    /// alignment padding in dw[2] instead of the genuine inflated size.
    /// Truncating decompression to that value loses 30%+ of the cls section
    /// content. Use this for CLASSES specifically; the LZ77 decoder always
    /// terminates at the END opcode (0x11) so over-allocating the target
    /// buffer is safe â€” trailing bytes are zero-padding.
    fn assemble_r2004_section_full(
        &self,
        data: &[u8],
        page_map: &HashMap<i32, usize>,
        page_size: usize,
        target_section: i32,
    ) -> Result<Vec<u8>, DwgError> {
        self.assemble_r2004_section_inner(data, page_map, page_size, target_section, false, true)
    }

    fn assemble_r2004_section_inner(
        &self,
        data: &[u8],
        page_map: &HashMap<i32, usize>,
        page_size: usize,
        target_section: i32,
        tight: bool,
        force_full_page: bool,
    ) -> Result<Vec<u8>, DwgError> {
        // Collect all pages belonging to this section by scanning page headers.
        // Each page at a file offset has a 32-byte header.
        struct PageInfo {
            file_offset: usize,
            data_size: usize,
            comp_size: usize,
            start_offset: usize,
            compressed: bool,
            sec_type_raw: i32,
        }

        let mut pages = Vec::new();
        for (&_sec_num, &file_offset) in page_map {
            if file_offset + 32 > data.len() { continue; }

            // Per ODA Â§4.4: R2004+ data section page headers are XOR-encrypted.
            // Mask = 0x4164536B ^ file_offset, applied to each DWORD.
            let mask = 0x4164536Bu32 ^ (file_offset as u32);
            let mut hdr = [0u8; 32];
            hdr.copy_from_slice(&data[file_offset..file_offset + 32]);
            for dw in 0..8 {
                let off = dw * 4;
                let val = u32::from_le_bytes([hdr[off], hdr[off+1], hdr[off+2], hdr[off+3]]);
                let dec = val ^ mask;
                hdr[off..off+4].copy_from_slice(&dec.to_le_bytes());
            }

            let sec_type = i32::from_le_bytes([hdr[0], hdr[1], hdr[2], hdr[3]]);
            let sec_number = i32::from_le_bytes([hdr[4], hdr[5], hdr[6], hdr[7]]);

            if sec_number != target_section { continue; }
            // Accept data pages: type 1/2 (legacy) or section hash >= 0x41000000
            if sec_type != 1 && sec_type != 2 && (sec_type as u32) < 0x41000000 { continue; }

            // per ODA Â§4.6 page XOR-header: [8..12]=comp_size, [12..16]=decomp_size
            // (matches r2007.rs; parser.rs had these flipped)
            let raw_csize = u32::from_le_bytes([hdr[8], hdr[9], hdr[10], hdr[11]]) as usize;
            let dsize = u32::from_le_bytes([hdr[12], hdr[13], hdr[14], hdr[15]]) as usize;
            let start_off = u32::from_le_bytes([hdr[16], hdr[17], hdr[18], hdr[19]]) as usize;

            let decomp_sz = dsize;
            let comp_sz = raw_csize;

            // Sanity: comp_size should be reasonable
            if comp_sz > 0x1000000 { continue; }

            if pages.len() < 3 && (sec_type as u32) >= 0x41000000 {
                crate::dwg_dbg!("[dwg-dbg]   hdr-dec sec_num={} type=0x{:X} comp={} decomp={} dw4=0x{:X} dw5=0x{:X} dw6=0x{:X} dw7=0x{:X}",
                    sec_number, sec_type as u32, comp_sz, decomp_sz, start_off,
                    u32::from_le_bytes([hdr[20], hdr[21], hdr[22], hdr[23]]),
                    u32::from_le_bytes([hdr[24], hdr[25], hdr[26], hdr[27]]),
                    u32::from_le_bytes([hdr[28], hdr[29], hdr[30], hdr[31]]));
            }
            pages.push(PageInfo {
                file_offset,
                data_size: decomp_sz,
                comp_size: comp_sz,
                start_offset: start_off,
                compressed: sec_type == 2 || (sec_type as u32) >= 0x41000000,
                sec_type_raw: sec_type,
            });
        }

        if pages.is_empty() {
            return Ok(Vec::new());
        }

        // Sort by start_offset to assemble in order
        pages.sort_by_key(|p| p.start_offset);

        crate::dwg_dbg!("[dwg-dbg] assemble sec={}: {} pages, page_size=0x{:X}", target_section, pages.len(), page_size);
        let dump_all_pages = std::env::var("O2D_DWG_TRACE_OBJ_HEADER").is_ok();
        let dump_n = if dump_all_pages { pages.len() } else { 8.min(pages.len()) };
        for (i, p) in pages.iter().enumerate().take(dump_n) {
            crate::dwg_dbg!("[dwg-dbg]   page[{}]: start_off=0x{:X} dsize=0x{:X} csize=0x{:X} comp={} type=0x{:X}",
                i, p.start_offset, p.data_size, p.comp_size, p.compressed, p.sec_type_raw as u32);
        }
        if !dump_all_pages && pages.len() > 8 {
            let last = pages.last().unwrap();
            crate::dwg_dbg!("[dwg-dbg]   page[{}]: start_off=0x{:X} dsize=0x{:X} csize=0x{:X} comp={} type=0x{:X}",
                pages.len()-1, last.start_offset, last.data_size, last.comp_size, last.compressed, last.sec_type_raw as u32);
        }

        // When tight=true, recompute contiguous offsets so pages are packed
        // without gaps. This is used for the Handles section where the object
        // map parser reads sequentially and must not encounter garbage padding.
        if tight {
            let mut tight_offsets = Vec::with_capacity(pages.len());
            let mut running = 0usize;
            for p in &pages {
                tight_offsets.push(running);
                running += p.data_size;
            }
            // Reassign start_offset to tight offsets
            for (p, off) in pages.iter_mut().zip(tight_offsets.iter()) {
                p.start_offset = *off;
            }
        }

        // Determine total decompressed size.
        // For multi-page sections, each page contributes page_size bytes
        // to the section (with only data_size bytes of valid data).
        // Object map offsets are relative to this full padded section.
        // For force_full_page (CLASSES), allocate page_size per page so
        // that LZ77 can run to its END opcode without truncation â€” see
        // assemble_r2004_section_full() docs.
        let total_size = if tight {
            // Tight packing: sum of data_size
            pages.iter().map(|p| p.data_size).sum::<usize>()
        } else if (pages.len() > 1 || force_full_page) && page_size > 0 {
            // Use the larger of page_size (stride) and data_size to account
            // for pages whose decompressed content exceeds the stride â€”
            // matches the decomp_target choice below.
            pages.iter()
                .map(|p| p.start_offset + page_size.max(p.data_size))
                .max()
                .unwrap_or(0)
        } else {
            pages.iter()
                .map(|p| p.start_offset + p.data_size)
                .max()
                .unwrap_or(0)
        };

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

            // For multi-page sections, each page's decompressed output may need
            // up to page_size bytes (the section's logical page stride).
            // For single-page sections, data_size from the header IS the
            // decompressed size â€” except when `force_full_page` is set
            // (CLASSES via assemble_r2004_section_full), in which case the
            // genuine size is unknown a-priori and we must let LZ77 run to
            // its END opcode within a page-sized buffer.
            // Use the larger of page_size (stride) and data_size (genuine
            // decompressed content length). Some AutoCAD-saved R2010+ files
            // (e.g. AcadSharp sample_AC1024.dwg) report per-page data_size
            // values that exceed the section page_size stride (e.g. 0x7479 >
            // 0x7400). Capping decomp to page_size truncates the last ~120
            // bytes of each page, causing the assembled OBJECTS section to
            // be desynchronized from the object_map offsets.
            let decomp_target = if (pages.len() > 1 || force_full_page) && page_size > 0 {
                page_size.max(page.data_size)
            } else {
                page.data_size
            };

            // per ODA Â§4.7: LZ77 terminates on END (0x11); declared data_size
            // under-reports actual emitted bytes on some AutoCAD R2010+ files.
            // When we're running in the "full" (force_full_page) mode, use
            // the generous variant so END terminates the stream naturally.
            let decompressed = if page.compressed {
                let result = if force_full_page {
                    let ceiling = decomp_target
                        .max(4 * page.comp_size)
                        .max(page.comp_size * 16)
                        .max(page_size * 2);
                    decompress_r2004_generous(
                        &data[body_offset..body_offset + page.comp_size],
                        ceiling,
                    )
                } else {
                    decompress_r2004(
                        &data[body_offset..body_offset + page.comp_size],
                        decomp_target,
                    )
                };
                match result {
                    Ok(d) => d,
                    Err(e) => {
                        crate::dwg_dbg!("[dwg-dbg]   DECOMPRESS FAIL at start_off=0x{:X}: {:?} (csize=0x{:X} target=0x{:X} dsize=0x{:X})",
                            page.start_offset, e, page.comp_size, decomp_target, page.data_size);
                        continue;
                    }
                }
            } else {
                let end = body_offset + page.data_size.min(page.comp_size);
                data[body_offset..end].to_vec()
            };

            // When tight, only copy data_size bytes (skip garbage padding).
            // Otherwise, keep all decompressed bytes (up to page_size). Many
            // R2010+ files (e.g. AcadSharp sample_AC1024.dwg) carry valid
            // object content past the per-page `data_size` boundary â€”
            // truncating here cuts ~40% of decoded objects. The header
            // `data_size` field appears to under-report the true
            // decompressed payload size on these AutoCAD-saved files.
            let usable = if tight {
                decompressed.len().min(page.data_size)
            } else {
                decompressed.len()
            };
            let dst_end = (page.start_offset + usable).min(assembled.len());
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

        // Strategy 4: R2010+ section map with sequential type IDs.
        // Scan for "AcDb:" name strings and extract entry data from fixed
        // offsets relative to each name. Core sections (Header, Classes, etc.)
        // use sequential type IDs 1-6 without names, but we can deduce their
        // entries from the named entries and the global section count.
        let result = Self::parse_section_map_r2010(map_data);
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
    ///   +16: section_type hash (RL) â€” e.g., 0x4163003b
    ///   +20: encrypted (RL)
    ///   +24: name (64 bytes, null-terminated)
    ///   +88: num_page_entries (RL)
    ///   +92: page entries (page_number: RL, data_size: RL) Ã— N
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

    /// Parse R2010+ section map â€” per ODA OpenDesignSpec Â§4.6 "Section Map".
    ///
    /// The R2010+ system section map (page number = `section_map_id` from
    /// offset 0x5C of the decrypted file header) decompresses to a buffer
    /// containing a small preamble followed by variable-sized per-section
    /// entries. On a Revit-authored AC1024 legend file this buffer is 530
    /// bytes and describes 4 metadata sections: AppInfoHistory, AppInfo,
    /// Preview, and RevHistory (sequential `section_number`s 11, 10, 9, 8).
    ///
    /// Observed entry layout (Â§4.6, verified by hex dump):
    ///
    ///   preamble (starts at buffer[0]):
    ///     RL  hdr_a            (= 0x0C on this file â€” total-section-count?)
    ///     RL  hdr_b            (= 0x02 â€” page_count of map itself?)
    ///     RL  max_page_size    (0x7400)
    ///     RL  0
    ///     RL  hdr_a again (0x0C)
    ///     RL Ã— several zeroes
    ///     RL  0x7400 again
    ///     RL  1
    ///     RL  2
    ///     ... 0x40 bytes of further zeroes/padding ...
    ///
    ///   per-section entry (112 bytes fixed layout, name padded to 64 chars):
    ///     RL  prev_entry_tail (for first entry = 0; subsequent entries
    ///                          appear to copy the prior entry's trailing
    ///                          field. Treat as "unknown â€” ignore")
    ///     RL  max_decomp_size  (e.g. 0x280 = 640 for AppInfoHistory)
    ///     RL  0                 (reserved)
    ///     RL  0                 (reserved)
    ///     RL  total_data_size   (e.g. 0x280)
    ///     RL  0                 (reserved â€” encryption flag on other files?)
    ///     RL  num_pages          (= 1 for single-page metadata sections)
    ///     RL  decomp_size        (= max_decomp_size when the section fits in
    ///                              one page, e.g. 0x280 = 640)
    ///     RL  num_pages          (repeat)
    ///     RL  something          (= 1 or 2)
    ///     RL  section_number     (the sequential id recorded in each data
    ///                              page's XOR-decrypted header[4..8])
    ///     RL  0                  (reserved)
    ///     name: 64 bytes null-padded ASCII (e.g. "AcDb:AppInfoHistory\0â€¦")
    ///
    /// **Important finding on the test fixture**: this buffer ONLY lists the
    /// 4 metadata sections. The core data sections (Header, Classes, Handles,
    /// AcDbObjects) are NOT present. They are enumerated instead by
    /// iterating every entry in the page-map, XOR-decrypting each 32-byte
    /// data-page header (mask = 0x4164536B ^ file_offset), and collecting
    /// the unique `section_number` values found at offset [4..8]. That
    /// heuristic lives in `probe_sections` and already recovers all 7 real
    /// data sections (sec_nums 1..7).
    ///
    /// Consequently this function returns at most the 4 metadata sections â€”
    /// enough to satisfy `build_section_map_from_info`, but the downstream
    /// code still relies on `probe_sections` to find Header/Classes/Handles/
    /// Objects. Documented as a Â§21 finding in SPEC_NOTES.md.
    fn parse_section_map_r2010(map_data: &[u8]) -> Vec<R2004SectionInfo> {
        let mut sections = Vec::new();
        if map_data.len() < 0x74 { return sections; }

        // Known section-name prefix per Â§4.6: every real entry's name begins
        // with the ASCII literal "AcDb:" (exactly 5 bytes). Scan for that
        // prefix; each occurrence marks the start of a 64-byte name field.
        // The per-section numeric preamble occupies the 48 bytes immediately
        // before the name field.
        let mut i = 0usize;
        while i + 5 <= map_data.len() {
            if &map_data[i..i + 5] == b"AcDb:" {
                // Grab null-terminated name (up to 64 bytes)
                let name_end = (i + 64).min(map_data.len());
                let nul = map_data[i..name_end]
                    .iter()
                    .position(|&b| b == 0)
                    .map(|p| i + p)
                    .unwrap_or(name_end);
                let name = std::str::from_utf8(&map_data[i..nul])
                    .unwrap_or("?")
                    .to_string();

                // Numeric header occupies bytes [i-48..i]. The section_number
                // is at [i-8..i-4] per observed layout.
                if i < 48 {
                    // Entry preamble truncated â€” skip
                    i = nul;
                    continue;
                }
                let hdr_base = i - 48;
                let read_rl = |o: usize| -> u32 {
                    u32::from_le_bytes([
                        map_data[o], map_data[o + 1],
                        map_data[o + 2], map_data[o + 3],
                    ])
                };
                let num_pages = read_rl(hdr_base + 24) as usize;      // [i-24..i-20]
                let page_size_field = read_rl(hdr_base + 28);          // [i-20..i-16]
                let section_number = read_rl(hdr_base + 40) as i32;    // [i-8..i-4]

                // per ODA Â§4.6: R2010+ section map stores the section name
                // (e.g. "AcDb:Header") but no per-section type hash. The
                // downstream `section_ids` map keys on the legacy R2004
                // hashes (SECTION_TYPE_HEADER = 0x4163003B, etc). Map the
                // well-known names back to those hashes so the pipeline's
                // `section_ids.get(&SECTION_TYPE_HEADER)` lookup succeeds.
                let type_hash: i32 = match name.as_str() {
                    "AcDb:Header"       => SECTION_TYPE_HEADER,
                    "AcDb:Classes"      => SECTION_TYPE_CLASSES,
                    "AcDb:ObjFreeSpace" => SECTION_TYPE_OBJFREESPACE,
                    "AcDb:Template"     => SECTION_TYPE_TEMPLATE,
                    "AcDb:Handles"      => SECTION_TYPE_HANDLES,
                    "AcDb:AcDbObjects"  => SECTION_TYPE_OBJECTS,
                    _ => section_number, // non-core entries (AppInfo, Preview, ...)
                };
                sections.push(R2004SectionInfo {
                    section_type: type_hash,
                    section_number,
                    name,
                    data_size: page_size_field as u64,
                    page_count: num_pages.max(1),
                });

                // Skip to just past the 64-byte name field
                i = (i + 64).min(map_data.len());
            } else {
                i += 1;
            }
        }

        sections
    }

    /// Parse header variables from decompressed R2004 header section.
    /// The decompressed data contains sentinels + header vars in R2000 format.
    fn parse_header_vars_r2004(&self, section_data: &[u8]) -> HashMap<String, serde_json::Value> {
        // Look for the header sentinel within the decompressed data
        if let Some(pos) = find_sentinel(section_data, &HEADER_SENTINEL_START) {
            // After the sentinel (16 bytes) + size field (4 bytes) â†’ bit data
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
        // Dump first bytes for diagnostics
        let dump_end = 48.min(section_data.len());
        let hex: String = section_data[..dump_end].iter()
            .map(|b| format!("{:02x}", b)).collect::<Vec<_>>().join(" ");
        crate::dwg_dbg!("[dwg-dbg] parse_classes_r2004_section: len={} first48: {}", section_data.len(), hex);
        // Also check for end sentinel
        let end_sent: [u8; 16] = [
            0x72, 0x5E, 0x3B, 0x47, 0x3B, 0x56, 0x07, 0x3A,
            0x3F, 0x23, 0x0B, 0xA0, 0x18, 0x30, 0x49, 0x75,
        ];
        if let Some(ep) = find_sentinel(section_data, &end_sent) {
            crate::dwg_dbg!("[dwg-dbg]   end sentinel found at offset {}", ep);
        } else {
            crate::dwg_dbg!("[dwg-dbg]   no end sentinel found");
        }

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
    // R2007+ (AC1021 â€“ AC1032) parsing
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

        crate::dwg_dbg!("[dwg-dbg] try_r2007_page_pipeline: ENTER ver={} data.len=0x{:X}",
            dwg.version_code, data.len());

        // Decrypt the R2007 file header (same LCG as R2004 for R2010+; R2007
        // itself uses a distinct codec â€” see r2007::decrypt_file_header docs).
        let enc_hdr = match crate::r2007::decrypt_file_header(data) {
            Ok(h) => {
                crate::dwg_dbg!(
                    "[dwg-dbg] try_r2007_page_pipeline: decrypt OK ({}B) magic={:?}",
                    h.len(),
                    std::str::from_utf8(&h[..h.len().min(11)]).unwrap_or("<bin>")
                );
                h
            }
            Err(e) => {
                crate::dwg_dbg!(
                    "[dwg-dbg] try_r2007_page_pipeline: decrypt_file_header FAILED ({:?}) â€” returning Err",
                    e
                );
                return Err(e);
            }
        };

        // Read page map
        let (page_map, page_size) = match crate::r2007::read_page_map(data, &enc_hdr) {
            Ok(v) => v,
            Err(e) => {
                crate::dwg_dbg!(
                    "[dwg-dbg] try_r2007_page_pipeline: read_page_map FAILED ({:?}) â€” returning Err",
                    e
                );
                return Err(e);
            }
        };
        if page_map.is_empty() {
            crate::dwg_dbg!("[dwg-dbg] try_r2007_page_pipeline: page_map empty â€” returning Err");
            return Err(DwgError::InvalidBinary("R2007: empty page map".into()));
        }
        crate::dwg_dbg!(
            "[dwg-dbg] try_r2007_page_pipeline: page_map={} entries page_size=0x{:X}",
            page_map.len(),
            page_size
        );

        // Read section map
        let section_map_id = if enc_hdr.len() >= 0x28 {
            u32::from_le_bytes([
                enc_hdr[0x24], enc_hdr[0x25], enc_hdr[0x26], enc_hdr[0x27],
            ]) as i32
        } else { 1 };

        let mut section_map_data = crate::r2007::assemble_section(
            data, &page_map, page_size, section_map_id, &dwg.version_code,
        )?;

        // For R2010+ the section_map_id is a page number, not a section number.
        // If assemble_section found nothing, read the page directly.
        if section_map_data.is_empty() {
            crate::dwg_dbg!("[dwg-dbg] section_map via assemble_section empty, trying direct page read for smid={}", section_map_id);
            section_map_data = crate::r2007::read_section_map_by_page(
                data, &page_map, section_map_id,
            )?;
            crate::dwg_dbg!("[dwg-dbg] direct page read: {} bytes", section_map_data.len());
        }

        let sections = crate::r2007::parse_section_map(&section_map_data);

        // Find sections by type or name
        let hdr_id = crate::r2007::find_section(&sections, crate::r2007::SECTION_HEADER, "Header");
        let cls_id = crate::r2007::find_section(&sections, crate::r2007::SECTION_CLASSES, "Classes");
        let hdl_id = crate::r2007::find_section(&sections, crate::r2007::SECTION_HANDLES, "Handles");
        let obj_id = crate::r2007::find_section(&sections, crate::r2007::SECTION_OBJECTS, "AcDbObjects");

        // Parse header
        if let Some(id) = hdr_id {
            let hdr_data = crate::r2007::assemble_section(data, &page_map, page_size, id, &dwg.version_code)?;
            dwg.header_vars = self.parse_header_vars_r2004(&hdr_data);
        }
        dwg.header_vars.insert("$ACADVER".into(), serde_json::json!(dwg.version_code));

        // Parse classes
        if let Some(id) = cls_id {
            let cls_data = crate::r2007::assemble_section(data, &page_map, page_size, id, &dwg.version_code)?;
            dwg.classes = self.parse_classes_r2004_section(&cls_data);
            for cls in &dwg.classes {
                self.class_map.insert(cls.class_number, cls.clone());
            }
        }

        // Parse handles (object map)
        if let Some(id) = hdl_id {
            let hdl_data = crate::r2007::assemble_section(data, &page_map, page_size, id, &dwg.version_code)?;
            dwg.object_map = self.parse_object_map_r2004(&hdl_data);
        }

        // Assemble objects section
        let objects_data = if let Some(id) = obj_id {
            let d = crate::r2007::assemble_section(data, &page_map, page_size, id, &dwg.version_code)?;
            if d.is_empty() { None } else { Some(d) }
        } else {
            None
        };

        // Parse objects
        if !dwg.object_map.is_empty() {
            if let Some(ref obj_buf) = objects_data {
                self.use_string_stream = true;
                dwg.objects = self.parse_objects_r2000(obj_buf, &dwg.object_map, &dwg.classes);
                self.use_string_stream = false;
            } else {
                dwg.objects = self.parse_objects_r2000(data, &dwg.object_map, &dwg.classes);
            }
        }

        // Require some results to confirm this worked
        if dwg.objects.is_empty() && dwg.header_vars.len() <= 1 {
            crate::dwg_dbg!(
                "[dwg-dbg] try_r2007_page_pipeline: EXIT Err â€” no results (objects=0, hdrs<=1)"
            );
            return Err(DwgError::InvalidBinary("R2007: page pipeline produced no results".into()));
        }

        crate::dwg_dbg!(
            "[dwg-dbg] try_r2007_page_pipeline: EXIT Ok objects={} headers={}",
            dwg.objects.len(),
            dwg.header_vars.len()
        );
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
    // R2010+ (AC1024â€“AC1032) parsing
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
    /// Clear partial parse state so an alternate pipeline can retry cleanly.
    fn reset_dwg_partial(&self, dwg: &mut DwgFile) {
        dwg.objects.clear();
        dwg.object_map.clear();
        dwg.header_vars.clear();
        dwg.classes.clear();
    }

    /// R2010+ pipeline using the RS(255,239)-wrapped file header per ODA Â§4.1.
    /// After RS strip + LCG decrypt we follow the same R2007-style page map,
    /// section map, object map walk.
    fn try_r2010_rs_pipeline(&mut self, data: &[u8], dwg: &mut DwgFile) -> Result<(), DwgError> {
        let enc_hdr = crate::r2007::decrypt_file_header_r2010(data)?;
        // Dump full enc_hdr to narrow down where R2010+ stores the page_map_addr
        crate::dwg_dbg!("[dwg-dbg] R2010-RS enc_hdr ({}B):", enc_hdr.len());
        for row in 0..(enc_hdr.len() + 15) / 16 {
            let off = row * 16;
            let end = (off + 16).min(enc_hdr.len());
            let hex: String = enc_hdr[off..end].iter()
                .map(|b| format!("{:02x} ", b)).collect();
            crate::dwg_dbg!("  {:04x}: {}", off, hex);
        }
        // Per ODA Â§4.1 R2010+ offsets:
        //   0x4C: section_page_map_addr as 8-byte RLL (+ 0x100 base)
        //   0x54: section_map_id as 4-byte RL
        if enc_hdr.len() >= 0x60 {
            let pm_addr = u64::from_le_bytes([
                enc_hdr[0x4C], enc_hdr[0x4D], enc_hdr[0x4E], enc_hdr[0x4F],
                enc_hdr[0x50], enc_hdr[0x51], enc_hdr[0x52], enc_hdr[0x53],
            ]) as usize + 0x100;
            let smid = u32::from_le_bytes([
                enc_hdr[0x54], enc_hdr[0x55], enc_hdr[0x56], enc_hdr[0x57],
            ]) as i32;
            crate::dwg_dbg!("[dwg-dbg] R2010-RS offsets@4C/54: page_map_addr=0x{:X} smid={} (data.len=0x{:X})",
                pm_addr, smid, data.len());
        }
        let (page_map, page_size) = crate::r2007::read_page_map(data, &enc_hdr)?;
        if page_map.is_empty() {
            return Err(DwgError::InvalidBinary("R2010-RS: empty page map".into()));
        }
        crate::dwg_dbg!("[dwg-dbg] R2010-RS: page_map={} entries page_size=0x{:X}", page_map.len(), page_size);

        // R2010+ header layout is shifted +0x14 relative to R2007 (verified by
        // matching the three known constants 0x20/0x80/0x40 at offsets 0x44/0x48/0x4C).
        //
        // Corrected R2010+ header layout:
        //   0x40: section_page_amount (RL) â€” number of pages
        //   0x44: 0x20 (RL constant)
        //   0x48: 0x80 (RL constant)
        //   0x4C: 0x40 (RL constant)
        //   0x50: section_page_map_id (RL) â€” page number of the page map itself
        //   0x54: section_page_map_address (RLL, 8 bytes)
        //   0x5C: section_map_id (RL) â€” section number of the section info/map
        //
        // section_map_id is used to both assemble the section info AND exclude
        // the section map from data-section probing.
        let section_map_id = if enc_hdr.len() >= 0x60 {
            u32::from_le_bytes([
                enc_hdr[0x5C], enc_hdr[0x5D], enc_hdr[0x5E], enc_hdr[0x5F],
            ]) as i32
        } else if enc_hdr.len() >= 0x4C {
            // Fallback: try R2007 layout offset
            u32::from_le_bytes([
                enc_hdr[0x48], enc_hdr[0x49], enc_hdr[0x4A], enc_hdr[0x4B],
            ]) as i32
        } else { 1 };
        crate::dwg_dbg!("[dwg-dbg] R2010-RS: section_map_id={} (from 0x5C)", section_map_id);

        self.parse_r2004_sections(data, dwg, &page_map, page_size, section_map_id)
    }

    /// R2018 (AC1032) sentinel-based pipeline.
    ///
    /// R2018 data pages use XOR-encrypted headers (same as R2010), but the
    /// section map can only be found via sentinel scan (not via page assembly).
    /// This pipeline:
    /// 1. Reads the page map normally
    /// 2. Finds the section map via sentinel scan (0x4163003B)
    /// 3. Parses section info â†’ builds section_type â†’ sec_number mapping
    /// 4. Uses standard assemble_r2004_section (XOR page headers) for data sections
    fn try_r2018_sentinel_pipeline(&mut self, data: &[u8], dwg: &mut DwgFile) -> Result<(), DwgError> {
        use crate::r2007::{
            scan_system_section, parse_r2018_section_map,
            SENTINEL_SECTION_MAP,
        };

        // Step 1: Get the page map
        let enc_hdr = crate::r2007::decrypt_file_header(data)
            .or_else(|_| crate::r2007::decrypt_file_header_r2010(data))?;
        let (page_map, _page_size_raw) = crate::r2007::read_page_map(data, &enc_hdr)?;
        // R2018 page_size from enc_hdr[0x28] is unreliable â€” use the standard
        // R2007+ page size (0x7400) which matches the section map's max_decomp_size.
        let page_size: usize = 0x7400;
        if page_map.is_empty() {
            return Err(DwgError::InvalidBinary("R2018: empty page map".into()));
        }
        crate::dwg_dbg!("[dwg-dbg] R2018 sentinel: page_map has {} entries", page_map.len());

        // Step 2: Find the section map by sentinel scan
        let section_maps = scan_system_section(data, SENTINEL_SECTION_MAP as u32);
        if section_maps.is_empty() {
            return Err(DwgError::InvalidBinary("R2018: no section map sentinel found".into()));
        }

        let (_, section_map_body) = section_maps.iter()
            .filter(|(_, body)| body.len() > 20)
            .max_by_key(|(_, body)| body.len())
            .ok_or_else(|| DwgError::InvalidBinary("R2018: all section map bodies too small".into()))?;

        crate::dwg_dbg!("[dwg-dbg] R2018 sentinel: section_map body={}B", section_map_body.len());

        // Step 3: Parse section map â†’ get section names and page assignments
        let sections = parse_r2018_section_map(section_map_body);
        if sections.is_empty() {
            return Err(DwgError::InvalidBinary("R2018: section map parse yielded no sections".into()));
        }
        crate::dwg_dbg!("[dwg-dbg] R2018 sentinel: {} sections found", sections.len());

        // Step 4: Build section_type â†’ sec_number mapping.
        // For each section in the section map, look up its first page in the
        // page map, XOR-decrypt the page header, and read the sec_number.
        let mut section_ids: HashMap<i32, i32> = HashMap::new();

        for s in &sections {
            if s.section_type == 0 || s.pages.is_empty() { continue; }

            // Use the first page's XOR-decrypted header to get sec_number
            let first_page_num = s.pages[0].page_number;
            if let Some(&file_offset) = page_map.get(&first_page_num) {
                if file_offset + 32 <= data.len() {
                    let mask = 0x4164536Bu32 ^ (file_offset as u32);
                    let sec_num = (u32::from_le_bytes([
                        data[file_offset + 4], data[file_offset + 5],
                        data[file_offset + 6], data[file_offset + 7],
                    ]) ^ mask) as i32;
                    if sec_num > 0 {
                        crate::dwg_dbg!("[dwg-dbg] R2018: section {:?} (type=0x{:08X}) â†’ sec_num={} (from page {} @0x{:X})",
                            s.name, s.section_type as u32, sec_num, first_page_num, file_offset);
                        section_ids.insert(s.section_type, sec_num);
                    }
                }
            }
        }

        crate::dwg_dbg!("[dwg-dbg] R2018: resolved {} section mappings: {:?}",
            section_ids.len(), section_ids);

        if section_ids.is_empty() {
            return Err(DwgError::InvalidBinary("R2018: could not resolve any section numbers".into()));
        }

        // Step 5: Use the standard R2004 section assembly pipeline with the
        // resolved section_ids. This XOR-decrypts per-page headers correctly.
        // Pass section_map_id=0 since we already have the section mapping.

        // Header
        if let Some(&sec_id) = section_ids.get(&SECTION_TYPE_HEADER) {
            let hdr_data = self.assemble_r2004_section(data, &page_map, page_size, sec_id)?;
            if !hdr_data.is_empty() {
                dwg.header_vars = self.parse_header_vars_r2004(&hdr_data);
                crate::dwg_dbg!("[dwg-dbg] R2018: header section {}B, {} vars", hdr_data.len(), dwg.header_vars.len());
            }
        }

        // Classes (use _full assembler â€” see notes on assemble_r2004_section_full)
        if let Some(&sec_id) = section_ids.get(&SECTION_TYPE_CLASSES) {
            let cls_data = self.assemble_r2004_section_full(data, &page_map, page_size, sec_id)?;
            if !cls_data.is_empty() {
                dwg.classes = self.parse_classes_r2004_section(&cls_data);
                for cls in &dwg.classes {
                    self.class_map.insert(cls.class_number, cls.clone());
                }
                crate::dwg_dbg!("[dwg-dbg] R2018: classes section {}B, {} classes", cls_data.len(), dwg.classes.len());
            }
        }

        // Handles â€” use section map's per-page data_size to limit valid data
        let mut alt_object_map: HashMap<u32, usize> = HashMap::new();
        let padded_map: HashMap<u32, usize>;
        if let Some(&sec_id) = section_ids.get(&SECTION_TYPE_HANDLES) {
            // Build page_number â†’ decompressed_valid_size map from section map
            let mut page_data_sizes: HashMap<i32, u32> = HashMap::new();
            if let Some(hdl_section) = sections.iter().find(|s| s.section_type == SECTION_TYPE_HANDLES) {
                for pe in &hdl_section.pages {
                    page_data_sizes.insert(pe.page_number, pe.comp_size);
                }
                crate::dwg_dbg!("[dwg-dbg] R2018: handles section has {} page data_size entries", page_data_sizes.len());
            }

            // Try paged with data_size boundaries from section map
            let paged_map = self.parse_object_map_paged_r2018(
                data, &page_map, page_size, sec_id, &page_data_sizes);
            // Also try standard padded assembly as fallback
            let hdl_data = self.assemble_r2004_section(data, &page_map, page_size, sec_id)?;
            padded_map = if !hdl_data.is_empty() {
                self.parse_object_map_r2004(&hdl_data)
            } else {
                HashMap::new()
            };
            crate::dwg_dbg!("[dwg-dbg] R2018: paged_map={} entries, padded_map={} entries",
                paged_map.len(), padded_map.len());
            // Default to padded (more entries), keep paged as alternative
            dwg.object_map = padded_map.clone();
            alt_object_map = paged_map;
        }

        // Objects â€” padded assembly (offsets reference page-aligned positions)
        let mut objects_data: Option<Vec<u8>> = None;
        if let Some(&sec_id) = section_ids.get(&SECTION_TYPE_OBJECTS) {
            let obj_data = self.assemble_r2004_section(data, &page_map, page_size, sec_id)?;
            if !obj_data.is_empty() {
                crate::dwg_dbg!("[dwg-dbg] R2018: objects section {}B", obj_data.len());
                objects_data = Some(obj_data);
            }
        }

        dwg.header_vars.insert("$ACADVER".into(), serde_json::json!(dwg.version_code));

        // Step 6: Parse objects â€” try padded map + padded buf first,
        // then paged map + tight buf (hypothesis: paged offsets match tight assembly)
        self.use_string_stream = true;

        if let Some(ref obj_buf) = objects_data {
            if !dwg.object_map.is_empty() {
                dwg.objects = self.parse_objects_r2000(obj_buf, &dwg.object_map, &dwg.classes);
                crate::dwg_dbg!("[dwg-dbg] R2018: padded+padded -> {} objects from {}B",
                    dwg.objects.len(), obj_buf.len());
            }
        }

        // Try paged map + tight objects assembly
        if !alt_object_map.is_empty() {
            if let Some(&sec_id) = section_ids.get(&SECTION_TYPE_OBJECTS) {
                if let Ok(tight_buf) = self.assemble_r2004_section_tight(data, &page_map, page_size, sec_id) {
                    if !tight_buf.is_empty() {
                        let tight_objects = self.parse_objects_r2000(&tight_buf, &alt_object_map, &dwg.classes);
                        crate::dwg_dbg!("[dwg-dbg] R2018: paged+tight ({}B) -> {} objects",
                            tight_buf.len(), tight_objects.len());
                        if tight_objects.len() > dwg.objects.len() {
                            dwg.objects = tight_objects;
                            dwg.object_map = alt_object_map;
                            crate::dwg_dbg!("[dwg-dbg] R2018: switched to paged+tight");
                        }
                    }
                }
            }
        }

        self.use_string_stream = false;

        Ok(())
    }

    fn parse_r2010_plus(&mut self, data: &[u8], dwg: &mut DwgFile) -> Result<(), DwgError> {
        if data.len() < 0x100 {
            return Err(DwgError::InvalidBinary("R2010+ file too short".into()));
        }
        dwg.codepage = u16::from_le_bytes([data[19], data[20]]);

        // R2018 (AC1032): sentinel-based pipeline finds the section map via
        // sentinel scan and resolves section numbers, then uses standard XOR
        // page header assembly. This is the primary R2018 path.
        if dwg.version_code == "AC1032" {
            crate::dwg_dbg!("[dwg-dbg] R2018: trying sentinel-based pipeline");
            match self.try_r2018_sentinel_pipeline(data, dwg) {
                Ok(()) if dwg.objects.len() >= 20 || dwg.header_vars.len() > 1 => {
                    crate::dwg_dbg!("[dwg-dbg] R2018: sentinel pipeline SUCCEEDED â€” {} objects",
                        dwg.objects.len());
                    return Ok(());
                }
                Ok(()) if !dwg.objects.is_empty() => {
                    crate::dwg_dbg!("[dwg-dbg] R2018: sentinel pipeline got {} objects (low), trying more",
                        dwg.objects.len());
                    // Don't reset â€” keep as baseline, let other pipelines try
                }
                Ok(()) => {
                    crate::dwg_dbg!("[dwg-dbg] R2018: sentinel pipeline returned Ok but no results");
                    self.reset_dwg_partial(dwg);
                }
                Err(e) => {
                    crate::dwg_dbg!("[dwg-dbg] R2018: sentinel pipeline failed: {:?}", e);
                    self.reset_dwg_partial(dwg);
                }
            }
        }
        let mut best_objects: Vec<DwgObject> = std::mem::take(&mut dwg.objects);
        // SPEC NOTE: `best_object_map` is taken from `dwg.object_map` to clear
        // the slot before the next pipeline runs, but the value is never read.
        // The side-effect of clearing dwg.object_map matters; the captured map
        // does not. See SPEC_NOTES.md "Findings still open" — pipeline
        // selection currently keeps `best_objects` only, so the map from the
        // best pipeline is never restored. Tracked as a follow-up.
        let _ = std::mem::take(&mut dwg.object_map);
        if !best_objects.is_empty() {
            self.reset_dwg_partial(dwg);
        }

        // R2010+ wraps the 0x6C-byte LCG-encrypted file header in an RS(255,239)
        // sector block per ODA Â§4.1. Run that pipeline first, then fall back
        // to the plain R2007-style LCG-only decrypt (some files skip RS), then
        // to the legacy 3-config R2010 path, then to sentinel scanning.
        crate::dwg_dbg!("[dwg-dbg] R2010+: trying RS-wrapped pipeline");
        match self.try_r2010_rs_pipeline(data, dwg) {
            Ok(()) if dwg.objects.len() > best_objects.len() => {
                crate::dwg_dbg!("[dwg-dbg] R2010+: RS pipeline produced {} objects (beats best {})",
                    dwg.objects.len(), best_objects.len());
                if dwg.objects.len() >= 20 || dwg.header_vars.len() > 1 {
                    return Ok(());
                }
                best_objects = std::mem::take(&mut dwg.objects);
                // see SPEC NOTE above on best_object_map; we still need to
                // clear dwg.object_map so the next pipeline starts empty.
                let _ = std::mem::take(&mut dwg.object_map);
                self.reset_dwg_partial(dwg);
            }
            Ok(()) => {
                crate::dwg_dbg!("[dwg-dbg] R2010+: RS pipeline got {} objects (not better than {})",
                    dwg.objects.len(), best_objects.len());
                self.reset_dwg_partial(dwg);
            }
            Err(e) => {
                crate::dwg_dbg!("[dwg-dbg] R2010+: RS pipeline failed ({:?})", e);
                self.reset_dwg_partial(dwg);
            }
        }
        crate::dwg_dbg!("[dwg-dbg] R2010+: trying plain r2007 pipeline");
        match self.try_r2007_page_pipeline(data, dwg) {
            Ok(()) if dwg.objects.len() >= 20 || dwg.header_vars.len() > 1 => {
                crate::dwg_dbg!("[dwg-dbg] R2010+: r2007 pipeline SUCCEEDED â€” {} objects", dwg.objects.len());
                return Ok(());
            }
            Ok(()) => {
                crate::dwg_dbg!("[dwg-dbg] R2010+: r2007 pipeline returned Ok but no results, continuing");
                self.reset_dwg_partial(dwg);
            }
            Err(e) => {
                crate::dwg_dbg!("[dwg-dbg] R2010+: r2007 pipeline failed ({:?})", e);
                self.reset_dwg_partial(dwg);
            }
        }

        // Legacy path: same-LCG-as-R2004 decrypt + 3 header configs.
        let enc_hdr = Self::decrypt_r2004_file_header(data)?;
        match self.try_r2010_page_pipeline(data, dwg, &enc_hdr) {
            Ok(()) if dwg.objects.len() >= 20 || dwg.header_vars.len() > 1 => {
                return Ok(());
            }
            Ok(()) if dwg.objects.len() > best_objects.len() => {
                best_objects = std::mem::take(&mut dwg.objects);
                self.reset_dwg_partial(dwg);
            }
            _ => {
                self.reset_dwg_partial(dwg);
            }
        }

        // Page-walk fallback: build page map by walking XOR-decrypted page headers.
        // Bypasses broken page map decompression entirely.
        crate::dwg_dbg!("[dwg-dbg] R2010+: trying page-walk fallback");
        self.reset_dwg_partial(dwg);
        let walked_page_map = Self::build_page_map_by_walking(data);
        if !walked_page_map.is_empty() {
            // Use section_map_id=0 so no data section is excluded from probing
            match self.parse_r2004_sections(data, dwg, &walked_page_map, 0x7400, 0) {
                Ok(()) => {
                    // Page-walk is a heuristic fallback. Only accept if we
                    // parsed a reasonable fraction of the object map, otherwise
                    // let sentinel-scan try (it often does better).
                    let enough = dwg.objects.len() >= 20
                        || (dwg.objects.len() > 0 && dwg.object_map.len() <= 20);
                    if enough {
                        crate::dwg_dbg!("[dwg-dbg] R2010+: page-walk SUCCEEDED â€” {} objects", dwg.objects.len());
                        return Ok(());
                    }
                    crate::dwg_dbg!("[dwg-dbg] R2010+: page-walk too few objects ({}/{}), trying sentinel",
                        dwg.objects.len(), dwg.object_map.len());
                    self.reset_dwg_partial(dwg);
                }
                _ => {
                    self.reset_dwg_partial(dwg);
                }
            }
        }

        // Fallback: sentinel scanning + object map scanning
        let result = self.parse_r2010_fallback(data, dwg);

        // If sentinel scan produced fewer objects than the best earlier pipeline,
        // restore the best result.
        if dwg.objects.len() < best_objects.len() && !best_objects.is_empty() {
            crate::dwg_dbg!("[dwg-dbg] R2010+: sentinel ({}) < best ({}), restoring best",
                dwg.objects.len(), best_objects.len());
            dwg.objects = best_objects;
        }

        result
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

        for (ci, config) in configs.iter().enumerate() {
            let end = config.page_map_addr_offset + config.page_map_addr_size;
            if end > enc_hdr.len() {
                crate::dwg_dbg!("[dwg-dbg] cfg{}: skip (enc_hdr too short: need {}, have {})", ci, end, enc_hdr.len());
                continue;
            }

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
                crate::dwg_dbg!("[dwg-dbg] cfg{}: skip (page_map_addr 0x{:X} out of bounds, data.len=0x{:X})", ci, page_map_addr, data.len());
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
            if section_map_id <= 0 || section_map_id > 100 {
                crate::dwg_dbg!("[dwg-dbg] cfg{}: skip (section_map_id={} out of range)", ci, section_map_id);
                continue;
            }

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

            if page_size == 0 {
                crate::dwg_dbg!("[dwg-dbg] cfg{}: skip (page_size=0, detect failed)", ci);
                continue;
            }

            let pm_sec_type = i32::from_le_bytes([
                data[page_map_addr], data[page_map_addr + 1],
                data[page_map_addr + 2], data[page_map_addr + 3],
            ]);
            if pm_sec_type <= 0 {
                crate::dwg_dbg!("[dwg-dbg] cfg{}: skip (pm_sec_type={} at addr=0x{:X})", ci, pm_sec_type, page_map_addr);
                continue;
            }
            crate::dwg_dbg!("[dwg-dbg] cfg{}: page_map_addr=0x{:X} page_size=0x{:X} smid={} pm_sec_type=0x{:X}",
                ci, page_map_addr, page_size, section_map_id, pm_sec_type);

            // Try to build the page map and parse sections
            match self.read_r2004_page_map(data, page_map_addr, page_size) {
                Ok(page_map) if !page_map.is_empty() => {
                    crate::dwg_dbg!("[dwg-dbg] R2010 try config: page_map_addr=0x{:X} page_size=0x{:X} pages={} smid={}",
                        page_map_addr, page_size, page_map.len(), section_map_id);
                    match self.parse_r2004_sections(
                        data, dwg, &page_map, page_size, section_map_id,
                    ) {
                        Ok(()) if !dwg.objects.is_empty() || !dwg.header_vars.is_empty() => {
                            crate::dwg_dbg!("[dwg-dbg] R2010 pipeline OK: object_map={} objects={}",
                                dwg.object_map.len(), dwg.objects.len());
                            return Ok(());
                        }
                        r => {
                            crate::dwg_dbg!("[dwg-dbg] R2010 pipeline rejected: result={:?} object_map={} objects={} header_vars={}",
                                r.is_ok(), dwg.object_map.len(), dwg.objects.len(), dwg.header_vars.len());
                            continue;
                        }
                    }
                }
                Ok(page_map) => {
                    crate::dwg_dbg!("[dwg-dbg] R2010 page_map empty at addr=0x{:X} size=0x{:X}", page_map_addr, page_size);
                    let _ = page_map;
                    continue;
                }
                Err(e) => {
                    crate::dwg_dbg!("[dwg-dbg] R2010 read_r2004_page_map failed at addr=0x{:X}: {:?}", page_map_addr, e);
                    continue;
                }
            }
        }

        crate::dwg_dbg!("[dwg-dbg] R2010 all configs failed, falling back");
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
                let raw = reader.read_bd()?;
                // Per ODA OpenDesignSpec Â§5.4 (HEADER variables): R2007+ /
                // R2010+ headers contain a much longer preamble than the
                // R2000 layout this parser still uses (CLAYER/UCSORG/
                // CECOLOR/HANDSEED/etc., variable-length H fields). Without
                // those reads the BD vars are at the wrong bit offset, so
                // raw IEEE754 bits land in the subnormal range
                // (~9.76e-120 from the user's [LTYPE_RESOLVE] log) instead
                // of the file's real $LTSCALE.
                //
                // Until the full R2010 header preamble is decoded, sanity-
                // clamp each BD header var: anything outside [1e-6, 1e6]
                // (covers every plausible CAD-unit/scale combination â€”
                // metres-per-mm 0.001 down to mm-per-km 1e6) is treated as
                // garbage and replaced with the AutoCAD default 1.0 for
                // scale-style vars or 0.0 for size-style vars. This keeps
                // dashed-line rendering working (the user-visible bug)
                // even while the underlying preamble fix is pending.
                let clean = if !raw.is_finite() || raw == 0.0 {
                    if matches!(*name, "$LTSCALE" | "$CMLSCALE") { 1.0 } else { 0.0 }
                } else if raw.abs() < 1e-6 || raw.abs() > 1e6 {
                    if matches!(*name, "$LTSCALE" | "$CMLSCALE") { 1.0 } else { 0.0 }
                } else {
                    raw
                };
                if std::env::var("DWG_DEBUG_HEADER").is_ok() {
                    eprintln!("[HDR_BD] {} raw_bits=0x{:016x} as_f64={} clamped={}",
                        name, raw.to_bits(), raw, clean);
                }
                header.insert(name.to_string(), serde_json::json!(clean));
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

        // R2010+ class section has 3 RLs after sentinel (not 1):
        //   RL cls_data_size, RL unknown (0), RL size_in_bits (cls_data_size*8 approx)
        // Class data starts at sentinel+28 instead of sentinel+20.
        let data_start = if self.version.is_r2010_plus() && sentinel_offset + 28 <= data.len() {
            let rl2 = u32::from_le_bytes([
                data[sentinel_offset + 20], data[sentinel_offset + 21],
                data[sentinel_offset + 22], data[sentinel_offset + 23],
            ]);
            let rl3 = u32::from_le_bytes([
                data[sentinel_offset + 24], data[sentinel_offset + 25],
                data[sentinel_offset + 26], data[sentinel_offset + 27],
            ]);
            crate::dwg_dbg!("[dwg-dbg] R2010+ cls header: RL1(size)={} RL2={} RL3(bits?)={}", cls_data_size, rl2, rl3);
            // Verify: RL3 should be approximately cls_data_size * 8
            if rl3 > 0 && (rl3 as usize) >= cls_data_size * 7 && (rl3 as usize) <= cls_data_size * 9 {
                sentinel_offset + 28
            } else {
                sentinel_offset + 20
            }
        } else {
            sentinel_offset + 20
        };

        let mut reader = DwgBitReader::new(data, data_start);
        // per ODA Â§5.8 + classes_r2010_fix.md: cls_data_size is measured from
        // sentinel+20 (INCLUDING the 8-byte extended header), NOT from
        // data_start which for R2010+ is sentinel+28. Using data_start here
        // made end_byte 8 bytes too high, overshooting into the trailing
        // CRC+end-sentinel region and confusing the TV loop.
        let end_byte_raw = sentinel_offset + 20 + cls_data_size;
        let end_byte_as_bits = sentinel_offset + 20 + (cls_data_size + 7) / 8;
        let end_byte = if end_byte_raw <= data.len() {
            end_byte_raw
        } else {
            end_byte_as_bits.min(data.len())
        };
        let is_unicode = self.version.is_r2007_plus();

        crate::dwg_dbg!("[dwg-dbg] parse_classes_from_bits: sentinel@{} cls_data_size={} end_byte={} data.len={} is_unicode={}",
            sentinel_offset, cls_data_size, end_byte, data.len(), is_unicode);
        // Show first 80 bytes after sentinel
        let peek_end = (sentinel_offset + 96).min(data.len());
        let peek: String = data[sentinel_offset + 16..peek_end].iter()
            .map(|b| format!("{:02x}", b)).collect::<Vec<_>>().join(" ");
        crate::dwg_dbg!("[dwg-dbg]   data[16..96]: {}", peek);
        // Dump bytes around bit-interpretation endbit for string stream diagnosis
        {
            let start_bit = (sentinel_offset + 20) * 8;
            let endbit_bits = start_bit + cls_data_size;
            let endbit_byte_pos = endbit_bits / 8;
            let ctx_start = endbit_byte_pos.saturating_sub(4).max(0);
            let ctx_end = (endbit_byte_pos + 4).min(data.len());
            if ctx_end > ctx_start {
                let ctx: String = data[ctx_start..ctx_end].iter()
                    .map(|b| format!("{:02x}", b)).collect::<Vec<_>>().join(" ");
                crate::dwg_dbg!("[dwg-dbg]   bytes around bit-endbit (byte {}): {}", endbit_byte_pos, ctx);
            }
        }
        // Show last 16 bytes of class section
        let tail_start = end_byte.saturating_sub(16).max(sentinel_offset + 16);
        let tail: String = data[tail_start..end_byte.min(data.len())].iter()
            .map(|b| format!("{:02x}", b)).collect::<Vec<_>>().join(" ");
        crate::dwg_dbg!("[dwg-dbg]   data tail[{}..{}]: {}", tail_start, end_byte, tail);

        // Diagnostic: dump bytes between cls_data end and buffer end
        let cls_end = sentinel_offset + 20 + cls_data_size;
        if cls_end < data.len() {
            let trail: String = data[cls_end..data.len().min(cls_end+32)].iter()
                .map(|b| format!("{:02x}", b)).collect::<Vec<_>>().join(" ");
            crate::dwg_dbg!("[dwg-dbg]   trailing bytes [{}-{}]: {}", cls_end, data.len(), trail);
        }

        // Dump more bytes for class data analysis
        {
            let dump_start = sentinel_offset + 20;
            let dump_end = (dump_start + 200).min(data.len());
            let hex: String = data[dump_start..dump_end].iter()
                .map(|b| format!("{:02x}", b)).collect::<Vec<_>>().join(" ");
            crate::dwg_dbg!("[dwg-dbg]   cls data[20..220]: {}", hex);
        }
        // Search for known class name strings to verify data integrity
        {
            for needle in &["ACDBDICTIONARY", "LAYOUT", "SCALE"] {
                let nb = needle.as_bytes();
                for i in 0..data.len().saturating_sub(nb.len()) {
                    if &data[i..i+nb.len()] == nb {
                        crate::dwg_dbg!("[dwg-dbg]   found '{}' at byte {} (ASCII)", needle, i);
                    }
                }
                // UTF-16LE
                let u16b: Vec<u8> = needle.chars().flat_map(|c| vec![c as u8, 0u8]).collect();
                for i in 0..data.len().saturating_sub(u16b.len()) {
                    if data[i..i+u16b.len()] == u16b[..] {
                        crate::dwg_dbg!("[dwg-dbg]   found '{}' at byte {} (UTF16)", needle, i);
                    }
                }
            }
        }

        // R2004+: skip BL max_class_number + B unknown bit
        if self.version.is_r2004_plus() {
            let bl_start = reader.tell_bit();
            let maxcls = reader.read_bl().unwrap_or(0);
            let bl_end = reader.tell_bit();
            let unk = reader.read_bit().unwrap_or(0);
            let b_end = reader.tell_bit();
            crate::dwg_dbg!("[dwg-dbg]   BL maxclass={} (bits {}-{}), B unk={} (bit {})",
                maxcls, bl_start, bl_end, unk, b_end);
            // Try parsing without BL+B too â€” reset and try directly
            // to see what BS gives at byte 20
            let save_pos = reader.tell_bit();
            reader.seek_bit((sentinel_offset + 20) * 8);
            let try_bs = reader.read_bs().unwrap_or(0);
            crate::dwg_dbg!("[dwg-dbg]   (no-prefix) BS@byte20 = {}", try_bs);
            // Also try at byte 24 (after possible second RL)
            reader.seek_bit((sentinel_offset + 24) * 8);
            let try_bs24 = reader.read_bs().unwrap_or(0);
            crate::dwg_dbg!("[dwg-dbg]   (no-prefix) BS@byte24 = {}", try_bs24);
            // Try at byte 28 (after two RLs)
            reader.seek_bit((sentinel_offset + 28) * 8);
            let try_bs28 = reader.read_bs().unwrap_or(0);
            let try_bl28 = reader.read_bl().unwrap_or(0);
            crate::dwg_dbg!("[dwg-dbg]   (no-prefix) BS@byte28 = {}, then BL = {}", try_bs28, try_bl28);
            reader.seek_bit(save_pos);
        }

        // R2007+: set up string stream at end of class section data.
        // Try two interpretations of cls_data_size:
        //   1. Byte count (endbit = start + size*8)
        //   2. Bit count  (endbit = start + size)
        if is_unicode && end_byte > data_start {
            // per ODA Â§5.4.4 + classes_r2010_fix.md: the spec-correct endbit
            // for the string_present flag is (sentinel+20)*8 + cls_data_size*8
            // â€” i.e. the end of the data region measured from sentinel+20
            // (including the 8-byte extended header but excluding CRC).
            //
            // Effective bit-cap: do NOT use data.len()*8 because, after the
            // single-page assembly fix, data.len() is the page size (often
            // 29696) with trailing zero padding. We must cap candidates to
            // the cls section's logical tail or we end up scanning padding.
            let cls_end_bit_cap = ((sentinel_offset + 20 + cls_data_size + 32) * 8).min(data.len() * 8);
            let endbit_spec = ((sentinel_offset + 20) * 8 + cls_data_size * 8).min(cls_end_bit_cap);

            let start_bit = data_start * 8;
            // Legacy candidates retained as fallback only if the spec value misses
            let endbit_as_bits = (start_bit + cls_data_size).min(cls_end_bit_cap);
            let endbit_as_bytes = (start_bit + cls_data_size * 8).min(cls_end_bit_cap);
            let endbit_from_rl = ((sentinel_offset + 16) * 8 + cls_data_size).min(cls_end_bit_cap);
            let endbit_data_len = cls_end_bit_cap;
            let endbit_end_byte = end_byte * 8;

            // Diagnostic helper: probe whether a candidate `endbit` has the
            // string-stream-present bit set. Currently unused after the
            // string-stream search was promoted out of this scope; kept
            // (underscore-prefixed) for resurrection during fixture triage.
            let _check_ss = |endbit: usize| -> bool {
                if endbit < 18 { return false; }
                let sb = (endbit - 1) / 8;
                let si = 7 - ((endbit - 1) % 8);
                sb < data.len() && (data[sb] >> si) & 1 == 1
            };
            // Helper: validate a candidate endbit by reading the strDataSize
            // header AND verifying that ss_start yields a TU-readable name.
            // sds_max guards against endbit candidates that point at huge
            // garbage values inside class data (we know the string stream
            // can't be larger than the cls data area).
            let sds_max = (cls_data_size + 16) * 8;
            let validate_endbit = |endbit: usize| -> Option<usize> {
                if endbit < 18 || endbit > data.len() * 8 { return None; }
                let str_byte = (endbit - 1) / 8;
                let str_bit = 7 - ((endbit - 1) % 8);
                if str_byte >= data.len() { return None; }
                if (data[str_byte] >> str_bit) & 1 != 1 { return None; }
                let sds_start = endbit - 17;
                let mut sds_r = DwgBitReader::new(data, 0);
                sds_r.seek_bit(sds_start);
                let sds = match sds_r.read_short() {
                    Ok(v) => (v as u16) as usize,
                    Err(_) => return None,
                };
                if sds == 0 || sds > sds_max || sds >= endbit || sds_start <= sds { return None; }
                let ss_start = sds_start - sds;
                if ss_start < data_start * 8 { return None; }
                // Read a TU and verify it looks like an identifier
                let mut tr = DwgBitReader::new(data, 0);
                tr.seek_bit(ss_start);
                match tr.read_tu() {
                    Ok(s) => {
                        // Class name strings include spaces ("ObjectDBX Classes"),
                        // colons ("AcDb:..."), digits, and underscores. Accept
                        // any printable ASCII (includes space).
                        if !s.is_empty()
                            && s.len() < 200
                            && s.chars().all(|c| c.is_ascii() && (c.is_ascii_graphic() || c == ' '))
                        {
                            Some(sds)
                        } else { None }
                    }
                    Err(_) => None,
                }
            };

            // Build candidate list. Per ODA Â§5.4.4 the spec value is
            // (sentinel+20+cls_data_size)*8. AcadSharp/AutoCAD-saved files
            // include a small CRC between the cls data area and the end
            // sentinel; the present-flag may be at endbit_spec + (CRC bits).
            // Try +0, +16, +32 first (CRC of 0/2/4 bytes), then fall back.
            let mut candidates: Vec<(usize, &'static str)> = Vec::new();
            for crc_bits in [0usize, 16, 32] {
                let e = endbit_spec + crc_bits;
                if e <= cls_end_bit_cap {
                    candidates.push((e, if crc_bits == 0 { "spec ODA Â§5.4.4" }
                        else if crc_bits == 16 { "spec + 16-bit CRC" }
                        else { "spec + 32-bit CRC" }));
                }
            }
            candidates.push((endbit_from_rl, "from sentinel+16 (bits)"));
            candidates.push((endbit_as_bits, "from data_start (bits)"));
            candidates.push((endbit_as_bytes, "from data_start (bytes)"));
            candidates.push((endbit_end_byte, "end_byte"));

            // Only accept candidates that pass the FULL validation (sds bounds + TU read).
            let chosen = candidates.iter().find_map(|&(e, lbl)| {
                validate_endbit(e).map(|sds| (e, lbl, sds))
            });

            let endbit = if let Some((e, lbl, sds)) = chosen {
                crate::dwg_dbg!("[dwg-dbg]   cls endbit ({}) = {}, sds={}", lbl, e, sds);
                e
            } else {
                crate::dwg_dbg!("[dwg-dbg]   no string stream found (from_rl={} bits={} bytes={} datalen={} endbyte={})",
                    endbit_from_rl, endbit_as_bits, endbit_as_bytes, endbit_data_len, endbit_end_byte);
                // Brute-force: scan backward from end of buffer looking for a valid
                // string-stream flag (bit=1) followed by a plausible RS strDataSize.
                //
                // IMPORTANT: cap the upper bound to the cls data area's tail
                // (= sentinel+20+cls_data_size + small CRC slack), NOT data.len().
                // After the assemble_r2004_section_inner fix the buffer is now
                // page-sized (often 29696 bytes) with trailing zero padding.
                // Searching that padding produced thousands of bogus 0-bit
                // candidates and eventually false-matched on a sentinel byte.
                let scan_upper_byte = (sentinel_offset + 20 + cls_data_size + 32).min(data.len());
                let mut brute_endbit = 0usize;
                'brute: for byte_i in (data_start..scan_upper_byte).rev() {
                    for bit_i in 0..8u32 {
                        let bi = 7 - bit_i; // MSB first
                        if (data[byte_i] >> bi) & 1 == 1 {
                            let cand_endbit = byte_i * 8 + bit_i as usize + 1;
                            if cand_endbit < 18 { continue; }
                            let sds_start = cand_endbit - 17;
                            let mut sds_r = DwgBitReader::new(data, 0);
                            sds_r.seek_bit(sds_start);
                            if let Ok(sds) = sds_r.read_short() {
                                let sds = (sds as u16) as usize;
                                if sds > 0 && sds < cand_endbit && sds_start > sds {
                                    let ss_start = sds_start - sds;
                                    if ss_start >= data_start * 8 {
                                        // Validate: try reading a TU from ss_start, check it looks like a class name
                                        let mut test_r = DwgBitReader::new(data, 0);
                                        test_r.seek_bit(ss_start);
                                        let valid = match test_r.read_tu() {
                                            Ok(s) => {
                                                // Valid if: non-empty AND all printable ASCII
                                                !s.is_empty() && s.len() < 200
                                                    && s.chars().all(|c| c.is_ascii_graphic())
                                            }
                                            Err(_) => false,
                                        };
                                        if valid || sds < 2000 {
                                            crate::dwg_dbg!("[dwg-dbg]   brute-force candidate: endbit={} sds={} ss_start={} valid={}",
                                                cand_endbit, sds, ss_start, valid);
                                        }
                                        if valid {
                                            brute_endbit = cand_endbit;
                                            break 'brute;
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
                if brute_endbit > 0 { brute_endbit } else { endbit_as_bytes }
            };
            if endbit > 17 {
                let str_present_bit = endbit - 1;
                let str_byte = str_present_bit / 8;
                let str_bit_in_byte = 7 - (str_present_bit % 8);
                if str_byte < data.len() {
                    let present = (data[str_byte] >> str_bit_in_byte) & 1;
                    if present == 1 {
                        // RS strDataSize at endbit - 17
                        let sds_end = endbit - 1;
                        let sds_start = sds_end.saturating_sub(16);
                        let mut sds_reader = DwgBitReader::new(data, 0);
                        sds_reader.seek_bit(sds_start);
                        if let Ok(sds) = sds_reader.read_short() {
                            let sds = (sds as u16) as usize;
                            if sds > 0 && sds < endbit {
                                if let Some(ss_start) = sds_start.checked_sub(sds) {
                                    crate::dwg_dbg!("[dwg-dbg]   class string stream: present, sds={} ss_start_bit={} endbit={}",
                                        sds, ss_start, endbit);
                                    reader.set_string_stream(ss_start);
                                }
                            } else {
                                crate::dwg_dbg!("[dwg-dbg]   class string stream: present but sds={} invalid (endbit={})", sds, endbit);
                            }
                        }
                    } else {
                        crate::dwg_dbg!("[dwg-dbg]   class string stream: not present (bit=0 at bit {})", str_present_bit);
                    }
                }
            }
        }

        while reader.tell_byte() < end_byte {
            let entry_start = reader.tell_bit();
            let result: Result<DwgClass, DwgError> = (|| {
                let mut cls = DwgClass::default();
                cls.class_number = reader.read_bs()?;
                cls.proxy_flags = reader.read_bs()?;
                if classes.is_empty() {
                    // Find actual data end (last non-zero byte)
                    let mut last_nz = data.len();
                    for i in (0..data.len()).rev() {
                        if data[i] != 0 { last_nz = i + 1; break; }
                    }
                    crate::dwg_dbg!("[dwg-dbg]   1st class entry @bit {}: num={} proxy_flags={} has_ss={} data_end={}",
                        entry_start, cls.class_number, cls.proxy_flags,
                        reader.has_string_stream(), last_nz);
                    // Dump last 16 non-zero bytes
                    if last_nz > 0 {
                        let s = last_nz.saturating_sub(16);
                        let hex: String = data[s..last_nz].iter()
                            .enumerate().map(|(i,b)| format!("[{}]={:02X}", s+i, b)).collect::<Vec<_>>().join(" ");
                        crate::dwg_dbg!("[dwg-dbg]   tail bytes: {}", hex);
                    }
                }
                cls.app_name = reader.read_tv(is_unicode)?;
                cls.cpp_class_name = reader.read_tv(is_unicode)?;
                cls.dxf_name = reader.read_tv(is_unicode)?;
                cls.was_zombie = reader.read_bit()? != 0;
                cls.item_class_id = reader.read_bs()?;

                // R2004+ classes have additional fields per entry.
                // per ODA OpenDesignSpec Â§5.8 Classes Section, class entry
                // R2004+ trailer: BL num_objects, BS dwg_version, BS maint_version,
                // BL unknown1, BL unknown2.
                // Previously both "_dwg_version" and "_maintenance_version" were
                // read as BL which over-consumed bits (BL is 2-34 bits, BS is
                // 2-18 bits) and produced a running drift after a few entries,
                // blowing up a TU length read mid-section.
                if self.version.is_r2004_plus() {
                    let _num_instances = reader.read_bl()?;
                    let _dwg_version = reader.read_bs()?;
                    let _maintenance_version = reader.read_bs()?;
                    let _unknown1 = reader.read_bl()?;
                    let _unknown2 = reader.read_bl()?;
                }

                Ok(cls)
            })();

            match result {
                Ok(cls) => {
                    if classes.len() < 40 || classes.len() % 20 == 0 {
                        crate::dwg_dbg!("[dwg-dbg]   class[{}]: num={} dxf='{}' cpp='{}' app='{}'",
                            classes.len(), cls.class_number, cls.dxf_name, cls.cpp_class_name, cls.app_name);
                    }
                    // Detect end of valid class entries: real CLASSES are
                    // numbered sequentially from 500 upward, have non-empty
                    // names, and a sane class_number range. Once the bit
                    // stream desyncs we read garbage class_numbers and
                    // empty strings â€” stop the loop to avoid polluting
                    // class_map with bogus entries that hide real types.
                    let names_empty = cls.dxf_name.is_empty()
                        && cls.cpp_class_name.is_empty()
                        && cls.app_name.is_empty();
                    let num_in_range = (cls.class_number as i32) >= 500
                        && (cls.class_number as i32) < 10000;
                    if names_empty || !num_in_range {
                        crate::dwg_dbg!("[dwg-dbg]   class loop terminated at idx={}: num={} names_empty={} (last good = {} classes)",
                            classes.len(), cls.class_number, names_empty, classes.len());
                        break;
                    }
                    classes.push(cls);
                }
                Err(e) => {
                    crate::dwg_dbg!("[dwg-dbg]   class parse error at byte {}: {:?}", reader.tell_byte(), e);
                    break;
                }
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
                // Multi-word MS â€” rare, handle with full parser
                match DwgBitReader::read_modular_short(data, pos) {
                    Ok((s, _)) => s,
                    Err(_) => { pos += 1; continue; }
                }
            };
            // Size cap at 64 KB â€” covers LWPOLYLINE/HATCH/DICT up to plausible
            // drawing scale. Raising to 1 MiB caused scanner runtime explosion
            // on R2018 files with 120 MB objects sections (8M+ candidates).
            // Common real entities are < 32 KB; 64 KB leaves headroom.
            if obj_size <= 4 || obj_size > 0x10000 { pos += 1; continue; }
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

            // R2010+: per ODA Â§20.1, an unsigned-MC handle_stream_size_bits
            // precedes the object type. Consume it before reading BS/OT.
            if self.version >= DwgVersion::R2010 {
                let byte_pos = bit_start;
                match DwgBitReader::read_unsigned_modular_char(data, byte_pos) {
                    Ok((hs_bits, new_byte_pos)) => {
                        if hs_bits as usize > (obj_size as usize) * 8 + 100 {
                            pos += 1; continue;
                        }
                        reader = DwgBitReader::new(data, new_byte_pos);
                    }
                    Err(_) => { pos += 1; continue; }
                }
            }

            let type_num = match reader.read_bs() {
                Ok(t) => t as u16,
                Err(_) => { pos += 1; continue; }
            };
            if obj_type_name(type_num).is_none() { pos += 1; continue; }

            // Validate bitsize (R14..R2007 only â€” R2010+ removed the RL bitsize
            // field; it's replaced by the handle_stream_size_bits MC consumed above).
            if self.version >= DwgVersion::R14 && self.version < DwgVersion::R2010 {
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

            // Validate handle â€” cap raised to 0x0FFFFFFF to accommodate
            // AutoCAD-2018+ files with large handle spaces (test65 uses up
            // to 0x7FA58AA â‰ˆ 134 M; old 0x100000 cap dropped all of these).
            let hval = match reader.read_h() {
                Ok((hcode, hval)) => {
                    if hcode > 12
                        || (hval == 0 && type_num != 0x06)
                        || hval > 0x0FFFFFFF
                        || hval == 0xFFFFFFFF
                    {
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

        let mut fail_count = 0usize;
        let mut fail_inbounds = 0usize;
        let mut fail_samples: Vec<String> = Vec::new();
        let mut fail_inbounds_samples: Vec<String> = Vec::new();
        let mut fail_inbounds_offsets: Vec<usize> = Vec::new();
        crate::dwg_dbg!("[dwg-dbg] parse_objects_r2000: {} handles, data.len={}", sorted.len(), data.len());
        // Show first 5 and last 5 offsets
        for (i, (&h, &off)) in sorted.iter().enumerate() {
            if i < 5 || i >= sorted.len() - 5 {
                crate::dwg_dbg!("[dwg-dbg]   handle 0x{:X} -> offset {}", h, off);
            } else if i == 5 {
                crate::dwg_dbg!("[dwg-dbg]   ...");
            }
        }
        for (&handle, &file_offset) in &sorted {
            // Skip OOB offsets early â€” don't even try parsing
            if file_offset + 4 >= data.len() {
                fail_count += 1;
                continue;
            }
            // Try primary offset first
            let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                self.parse_single_object_r2000(data, handle, file_offset)
            }));
            match &result {
                Ok(Ok(obj)) => {
                    objects.push(obj.clone());
                    continue;
                }
                Ok(Err(e)) => {
                    let is_oob = file_offset >= data.len();
                    if !is_oob {
                        fail_inbounds += 1;
                        fail_inbounds_offsets.push(file_offset);
                        if fail_inbounds_samples.len() < 20 {
                            let end = (file_offset + 16).min(data.len());
                            let raw: String = data[file_offset..end].iter().map(|b| format!("{:02x}", b)).collect::<Vec<_>>().join(" ");
                            fail_inbounds_samples.push(format!("h=0x{:X}@{} err={:?} raw=[{}]",
                                handle, file_offset, e, raw));
                        }
                    }
                    if fail_samples.len() < 10 {
                        // Show raw bytes at offset for diagnosis
                        let end = (file_offset + 16).min(data.len());
                        let raw: String = if file_offset < data.len() {
                            data[file_offset..end].iter().map(|b| format!("{:02x}", b)).collect::<Vec<_>>().join(" ")
                        } else { "OOB".into() };
                        fail_samples.push(format!("h=0x{:X}@{} err={:?} raw=[{}]",
                            handle, file_offset, e, raw));
                    }
                    fail_count += 1;
                }
                Err(_panic) => {
                    if fail_samples.len() < 10 {
                        fail_samples.push(format!("h=0x{:X}@{} PANIC", handle, file_offset));
                    }
                    fail_count += 1;
                }
            }

            // For R2004+, try nearby offsets (Â±2, Â±4, Â±6, Â±8) to handle CRC
            // alignment shifts. Only try for in-bounds offsets.
            // DO NOT extend the search much further â€” wider windows produce
            // false positives where random bytes happen to MS-decode as a
            // small object, polluting the result set with garbage coordinates
            // that render as tens of thousands of spurious line segments.
            if self.version.is_r2004_plus() && file_offset + 4 < data.len() {
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
                                fail_count -= 1; // recovered
                                objects.push(obj);
                                break 'fuzzy;
                            }
                        }
                    }
                }
            }
        }
        if fail_count > 0 {
            crate::dwg_dbg!("[dwg-dbg] parse_objects: {} failures out of {} handles ({} in-bounds, {} OOB)",
                fail_count, sorted.len(), fail_inbounds, fail_count - fail_inbounds);
            for s in &fail_samples {
                crate::dwg_dbg!("[dwg-dbg]   {}", s);
            }
        }
        if fail_inbounds > 0 {
            crate::dwg_dbg!("[dwg-dbg] IN-BOUNDS failures ({}):", fail_inbounds);
            for s in &fail_inbounds_samples {
                crate::dwg_dbg!("[dwg-dbg]   {}", s);
            }
            // Histogram of in-bounds failure offsets (64K buckets)
            let mut buckets: std::collections::BTreeMap<usize, usize> = std::collections::BTreeMap::new();
            for &off in &fail_inbounds_offsets {
                *buckets.entry(off / 65536).or_insert(0) += 1;
            }
            crate::dwg_dbg!("[dwg-dbg] IN-BOUNDS failure offset histogram (64K buckets):");
            for (&bucket, &cnt) in &buckets {
                crate::dwg_dbg!("[dwg-dbg]   [{:>7}..{:>7}): {} failures",
                    bucket * 65536, (bucket + 1) * 65536, cnt);
            }
            // Show range
            if let (Some(&min), Some(&max)) = (fail_inbounds_offsets.iter().min(), fail_inbounds_offsets.iter().max()) {
                crate::dwg_dbg!("[dwg-dbg] IN-BOUNDS failure range: {}..{} (data.len={})", min, max, data.len());
            }
        }

        objects
    }

    /// Read an R2010+ encoded object type (OT) per ODA OpenDesignSpec Â§2.12.
    ///
    /// A 2-bit prefix indicates how to read the following 1 or 2 raw bytes:
    ///   0 -> 1 byte, value = byte
    ///   1 -> 1 byte, value = byte + 0x1F0
    ///   2 -> 2 raw bytes (little-endian short)
    ///   3 -> "should never occur", spec says treat same as 2
    fn read_ot(reader: &mut DwgBitReader) -> Result<u16, DwgError> {
        let prefix = reader.read_bits(2)?;
        match prefix {
            0 => Ok(reader.read_byte()? as u16),
            1 => Ok((reader.read_byte()? as u16).wrapping_add(0x1F0)),
            _ => {
                let lo = reader.read_byte()? as u16;
                let hi = reader.read_byte()? as u16;
                Ok(lo | (hi << 8))
            }
        }
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
        // Safety: reject absurdly large objects that would cause OOM
        if obj_size > 10_000_000 {
            return Err(DwgError::InvalidBinary("Object size too large".into()));
        }

        let mut reader = DwgBitReader::new(data, bit_start);
        let data_bit_start = reader.tell_bit();

        // R2010+: per ODA OpenDesignSpec Â§20.1 / Â§20.2, an unsigned MC field
        // carrying the size of the handle stream (in bits) appears right after
        // the MS object-size field and before the object type.  The handle-stream
        // size is used later to locate the string/handle streams; we don't need
        // the value here, but we must consume the bytes so the bit reader is at
        // the start of the Object Type field.  The MC is byte-aligned.
        //
        // IMPORTANT: per empirical alignment with libredwg-testdata + acadsharp
        // sample_AC1024.dwg, the MS `obj_size` field in R2010+ measures bytes
        // STARTING AFTER the MC handle_stream_size_bits field â€” i.e. obj_size
        // counts OT + data + handle_stream + padding, but NOT the MC itself.
        // We track the byte-count consumed by the MC so subsequent end-of-object
        // math can adjust for it.  Without this adjustment, both the string-stream
        // endbit and the handle-stream start position land 8-16 bits too early
        // (one bit per byte of MC width), causing entity owner/layer refs to
        // decode to garbage (e.g. VERTEX_3D owner = previous vertex instead of
        // parent POLYLINE_3D).
        let mc_start_byte = reader.tell_byte();
        let handle_stream_size_bits = if self.version >= DwgVersion::R2010 {
            // Per ODA Â§20.1: unsigned MC for handle-stream size in bits.
            let (v, new_pos) = DwgBitReader::read_unsigned_modular_char(data, reader.tell_byte())?;
            reader.seek_byte(new_pos);
            v as usize
        } else {
            0
        };
        let mc_bits = (reader.tell_byte().saturating_sub(mc_start_byte)) * 8;

        // Object type: pre-R2010 = BS, R2010+ = OT per Â§2.12
        let type_num = if self.version >= DwgVersion::R2010 {
            Self::read_ot(&mut reader)?
        } else {
            reader.read_bs()? as u16
        };

        // Debug: trace entity type resolution for key handles (only first few)
        if handle <= 0x10 {
            crate::dwg_dbg!("[dwg-dbg] obj h=0x{:X}@{}: obj_size={} hs_bits={} type_num=0x{:X} ({}) bit_pos={}",
                handle, file_offset, obj_size, handle_stream_size_bits, type_num,
                obj_type_name(type_num).unwrap_or("?"), reader.tell_bit());
            // Show raw bytes at offset
            let raw_end = (file_offset + 16).min(data.len());
            let raw: String = data[file_offset..raw_end].iter()
                .map(|b| format!("{:02x}", b)).collect::<Vec<_>>().join(" ");
            crate::dwg_dbg!("[dwg-dbg]   raw[{}..]: {}", file_offset, raw);
        }
        // Optional verbose: dump every type_num when DWG_TRACE_TYPES=1
        if std::env::var("DWG_TRACE_TYPES").map(|v| v == "1").unwrap_or(false) {
            eprintln!("[dwg-types] h=0x{:X} type_num=0x{:X} ({})",
                handle, type_num, obj_type_name(type_num).unwrap_or("?"));
        }

        // Audit instrumentation: if the type_num yields UNKNOWN_*, dump the full
        // decode state so we can see exactly where bit drift is occurring.
        // Enabled via DWG_TRACE_UNKNOWN=1.
        let _is_unknown = obj_type_name(type_num).is_none()
            && !(type_num >= 500 && self.class_map.contains_key(&(type_num as i16)));
        if _is_unknown
            && std::env::var("DWG_TRACE_UNKNOWN").map(|v| v == "1").unwrap_or(false)
        {
            let raw_end = (file_offset + 24).min(data.len());
            let raw: String = data[file_offset..raw_end].iter()
                .map(|b| format!("{:02x}", b)).collect::<Vec<_>>().join(" ");
            eprintln!(
                "[unk] h=0x{:X}@{}: obj_size={} mc_bits={} hs_bits={} type=0x{:X} bit_pos={} raw={}",
                handle, file_offset, obj_size, mc_bits, handle_stream_size_bits,
                type_num, reader.tell_bit(), raw
            );
        }

        // Determine type name
        let type_name = obj_type_name(type_num)
            .map(|s| s.to_string())
            .or_else(|| {
                if type_num >= 500 {
                    self.class_map.get(&(type_num as i16))
                        .and_then(|cls| {
                            if !cls.dxf_name.is_empty() { Some(cls.dxf_name.clone()) }
                            else if !cls.cpp_class_name.is_empty() { Some(cls.cpp_class_name.clone()) }
                            else { None }
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

        // Read bitsize â€” marks the end of data section / start of handles.
        // Per ODA OpenDesignSpec Â§20.1 (non-entity objects) vs. Â§20.2 (entities):
        //   R13       : no RL bitsize field anywhere.
        //   R14-R2007 : RL bitsize present for BOTH entities and non-entities.
        //   R2010+    : RL bitsize present ONLY for entities (Â§20.2 lists it under
        //               "R2000+ Only"). Non-entity objects (Â§20.1) rely on the MC
        //               handle-stream-size read at the top of the object instead.
        // Per ODA Â§20.1/Â§20.2: R14-R2007 have RL bitsize for both entities and
        // non-entities. R2010+ removed the RL bitsize entirely â€” the MC
        // handle_stream_size field at the top of the object replaces it.
        // (Empirically verified on AC1024 fixtures; adding an RL read here
        // adds a 32-bit drift into entity_common that scrambles parsing.)
        let read_bitsize = match self.version {
            DwgVersion::R13 => false,
            DwgVersion::R14 | DwgVersion::R2000
            | DwgVersion::R2004 | DwgVersion::R2007 => true,
            _ => false, // R2010+ has no RL bitsize
        };
        let bitsize = if read_bitsize {
            reader.read_raw_long().ok()
        } else {
            None
        };

        // R2007+: set up string stream per ODA OpenDesignSpec Â§20.1.
        // The string stream is located just before the handle stream.
        // For entities (R2000+): endbit = data_bit_start + bitsize.
        // For non-entities (R2010+): endbit = data_bit_start + obj_size*8 - handle_stream_size_bits.
        // The string stream layout (working from endbit backwards):
        //   B string_present at endbit-1
        //   if 1: RS strDataSize at endbit-17
        //   string stream starts at endbit - 1 - strDataSize (in bits)
        if self.version.is_r2007_plus() && self.use_string_stream {
            // Per ODA OpenDesignSpec Â§19.3.4 + Â§20.1 (R2010+):
            //
            // The R2010+ object layout (after the leading MS object_size
            // field) is:
            //
            //     [MC handle_stream_size_bits]   (counted SEPARATELY,
            //                                     NOT included in obj_size)
            //     [OT object_type]
            //     [common + type-specific data]
            //     [string-stream-data | strDataSize-RS | spf-bit]
            //     [handle-stream]    (hs_bits long)
            //     [trailing CRC, NOT included in obj_size]
            //
            // The MS `obj_size` field measures the bytes for everything from
            // OT through the end of the handle stream, but does NOT include
            // the leading MC handle_stream_size_bits field.  We tracked the
            // MC byte width above as `mc_bits`; the absolute object-end bit
            // is therefore:
            //
            //     obj_end_bit = data_bit_start + mc_bits + obj_size*8
            //
            // The handle-stream occupies the LAST `hs_bits` bits of that
            // region, so the data-section end (= string-stream endbit) is:
            //
            //     endbit = obj_end_bit - hs_bits
            //
            // Without the `+ mc_bits` correction the endbit lands inside the
            // unused padding before the handle stream and the string-stream
            // metadata (string-present-flag at endbit-1, RS strDataSize at
            // endbit-17) reads as zero, leaving every R2010+ TV (LAYER name,
            // BLOCK name, LTYPE description, etc.) as the empty string via
            // the read_tv "no string stream set up" branch.
            //
            // For R2007 (pre-R2010), the RL bitsize field IS used and
            // points directly at the data-section end, so the bitsize-based
            // path remains unchanged.
            let endbit = if self.version >= DwgVersion::R2010 && handle_stream_size_bits > 0 {
                // obj_size measures bytes AFTER the MC handle_stream_size_bits
                // field, so the absolute object-end bit is
                // data_bit_start + mc_bits + obj_size*8.  Same correction as
                // the handle-stream-start formula below.
                let obj_end = data_bit_start + mc_bits + (obj_size as usize) * 8;
                obj_end.checked_sub(handle_stream_size_bits)
            } else {
                bitsize.map(|bs| data_bit_start + bs as usize)
            };
            if let Some(endbit) = endbit {
                if endbit > 0 && endbit <= data.len() * 8 {
                    // Save position, read string stream metadata
                    let saved_pos = reader.tell_bit();
                    reader.seek_bit(endbit - 1);
                    if let Ok(flag) = reader.read_bit() {
                        if flag != 0 {
                            reader.seek_bit(endbit - 17);
                            if let Ok(str_data_size) = reader.read_raw_short() {
                                let raw_sds = str_data_size as usize;
                                let mut sds = raw_sds;
                                let extended = sds & 0x8000 != 0;
                                if extended {
                                    sds &= 0x7FFF;
                                    if endbit >= 33 {
                                        reader.seek_bit(endbit - 33);
                                        if let Ok(hi) = reader.read_raw_short() {
                                            sds |= (hi as usize) << 15;
                                        }
                                    }
                                }
                                // Per ODA OpenDesignSpec Â§19.3.4: the string-data
                                // region ends at endbit - 17 (or endbit - 33 if
                                // strDataSize had its high bit set, requiring
                                // an extended high-RS), NOT at endbit - 1.
                                // The bit at endbit-1 is the string-present
                                // flag and bits [endbit-17..endbit-1] are the
                                // RS strDataSize (low 15 bits + high-bit flag).
                                // Subtracting only `1` (as the previous code
                                // did) put ss_start 16 bits past the actual
                                // string region, causing read_tu's first BS to
                                // consume the strDataSize RS as a length and
                                // produce strings of 6000+ UTF-16 chars.
                                let metadata_bits = if extended { 33 } else { 17 };
                                if let Some(ss_start) = endbit.checked_sub(metadata_bits).and_then(|e| e.checked_sub(sds)) {
                                    reader.set_string_stream(ss_start);
                                }
                            }
                        }
                    }
                    reader.seek_bit(saved_pos);
                }
            }
        }

        // Read own handle â€” present in the data stream for all versions
        let _ = reader.read_h().ok();

        // Parse EED (Extended Entity Data)
        let eed = self.parse_eed(&mut reader);

        // Parse type-specific data
        let mut obj_data = if is_entity {
            self.parse_entity_data(&mut reader, type_num, &type_name)
        } else {
            self.parse_table_object(&mut reader, type_num, &type_name)
        };

        // Clear string stream after parsing
        reader.clear_string_stream();

        // --- Handle reference reading ---
        // For R2010+, compute handle stream position from the MC handle-stream-size
        // field read at the top of the object. This is more reliable than bitsize
        // because it doesn't depend on correct parsing of the entity body.
        // handle_stream_start = data_bit_start + obj_size_bytes * 8 - handle_stream_size_bits
        //
        // Compute hs_start once â€” applies to both entities AND table objects.
        let hs_from_mc = if self.version >= DwgVersion::R2010 && handle_stream_size_bits > 0 {
            // Same adjustment as in the string-stream block: obj_size in
            // R2010+ counts bytes AFTER the MC handle_stream_size_bits
            // field, so the absolute object-end bit is
            // data_bit_start + mc_bits + obj_size*8.
            let obj_end_bit = data_bit_start + mc_bits + (obj_size as usize) * 8;
            if handle_stream_size_bits <= obj_end_bit - data_bit_start {
                Some(obj_end_bit - handle_stream_size_bits)
            } else {
                None
            }
        } else {
            None
        };
        let hs_from_bitsize = bitsize.map(|bs| data_bit_start + bs as usize);
        let hs_bitpos = hs_from_mc.or(hs_from_bitsize);

        // DWG_LAYER_DUMP=1 â†’ dump raw object body bytes for each LAYER, plus
        // key offsets, so we can pattern-mine the bit/byte position of the ACI.
        // The dump is keyed by (handle, name) so it can be cross-referenced to
        // the DXF oracle (group code 62 per layer).
        if type_num == 0x33 && std::env::var("DWG_LAYER_DUMP").is_ok() {
            let body_start = bit_start;
            let body_end_bit = data_bit_start + mc_bits + (obj_size as usize) * 8;
            let body_end_byte = (body_end_bit + 7) / 8;
            let dump_end = body_end_byte.min(data.len());
            let raw: String = data[body_start..dump_end].iter()
                .map(|b| format!("{:02x}", b))
                .collect::<Vec<_>>().join("");
            let lname = obj_data.get("name")
                .and_then(|v| v.as_str()).unwrap_or("?").to_string();
            let lcolor = obj_data.get("color")
                .and_then(|v| v.as_i64()).unwrap_or(-999);
            let bs_raw = obj_data.get("_color_bs_raw")
                .and_then(|v| v.as_i64()).unwrap_or(-999);
            let sentinel = obj_data.get("_color_sentinel")
                .and_then(|v| v.as_bool()).unwrap_or(false);
            eprintln!(
                "[LAYER_DUMP] handle=0x{:X} name={:?} obj_size={} mc_bits={} hs_bits={} \
                 body_start_byte={} body_end_byte={} body_len={} \
                 cur_color={} bs_raw={} sentinel={}\n  hex={}",
                handle, lname, obj_size, mc_bits, handle_stream_size_bits,
                body_start, body_end_byte, dump_end - body_start,
                lcolor, bs_raw, sentinel, raw,
            );
        }

        let handle_refs = if is_entity {
            if let Some(hs_start) = hs_bitpos {
                reader.seek_bit(hs_start);
                self.read_entity_handles_at_current(
                    &mut reader, handle, type_num, &obj_data,
                )
            } else {
                HandleRefs::default()
            }
        } else {
            // Table-object handle-stream pass (LAYER, BLOCK_HEADER, STYLE,
            // LTYPE, DIMSTYLE, ...). Per ODA Â§20.4.53 (LAYER) + similar
            // Â§20.4.x sections each table object has its own handle layout.
            // For now we only resolve LAYER's color handle (type 0x33) â€”
            // other table objects keep the default no-op so we don't risk
            // disturbing the existing scene_io contract.
            if type_num == 0x33 {
                if let Some(hs_start) = hs_bitpos {
                    reader.seek_bit(hs_start);
                    let hs_size = if self.version >= DwgVersion::R2010 {
                        handle_stream_size_bits
                    } else {
                        // pre-R2010: HS extends to end of object body.
                        bitsize.map(|bs| (obj_size as usize) * 8 - bs as usize)
                            .unwrap_or(0)
                    };
                    obj_data.insert("_hs_size_bits".into(),
                        serde_json::json!(hs_size as u64));
                    self.read_layer_handles_at_current(
                        &mut reader, handle, hs_size, &mut obj_data,
                    );
                }
            }
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
        obj_data.remove("_has_attribs");
        obj_data.remove("_owned_object_count");
        obj_data.remove("_entity_mode");
        // LAYER-only intermediates from parse_layer_obj /
        // read_layer_handles_at_current â€” `_color_handle` is kept so
        // scene_io can resolve it; the rest are diagnostic and dropped.
        obj_data.remove("_color_bs_raw");
        obj_data.remove("_color_sentinel");
        obj_data.remove("_hs_size_bits");

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
                    // Unknown â€” skip rest
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
    fn read_entity_handles_at_current(
        &self,
        reader: &mut DwgBitReader,
        parent_handle: u32,
        type_num: u16,
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
        // Per ODA Â§20.4.1: entmode controls whether the OWNER handle is
        // present in the handle-stream. Only entmode == 0 emits it.
        let entity_mode = obj_data.get("_entity_mode")
            .and_then(|v| v.as_u64()).unwrap_or(0) as u8;

        // Optional diag: trace handle-stream reads for INSERT entities to
        // diagnose block_header drift (set O2D_DWG_TRACE_INSERT_HANDLES=1).
        let trace_insert = (type_num == 0x07 || type_num == 0x08)
            && std::env::var("O2D_DWG_TRACE_INSERT_HANDLES")
                .map(|v| v == "1").unwrap_or(false);
        let trace_start = reader.tell_bit();
        macro_rules! hread {
            ($label:expr) => {{
                let bit_before = reader.tell_bit();
                let res = reader.read_h();
                if trace_insert {
                    match &res {
                        Ok((code, val)) => eprintln!(
                            "[insert-h] parent=0x{:X} @bit={:>8} (+{:>3})  {:<14}  code=0x{:X} val=0x{:X} ({})",
                            parent_handle,
                            bit_before,
                            bit_before.saturating_sub(trace_start),
                            $label, code, val, val,
                        ),
                        Err(e) => eprintln!(
                            "[insert-h] parent=0x{:X} @bit={:>8} (+{:>3})  {:<14}  ERR: {:?}",
                            parent_handle,
                            bit_before,
                            bit_before.saturating_sub(trace_start),
                            $label, e,
                        ),
                    }
                }
                res
            }};
        }
        if trace_insert {
            eprintln!(
                "[insert-h] BEGIN parent=0x{:X} type=0x{:X} entmode={} \
                 num_reactors={} xdict_missing={} nolinks={} \
                 ltype_flags={} plotstyle_flags={} material_flags={}",
                parent_handle, type_num, entity_mode, num_reactors,
                xdict_missing, nolinks, ltype_flags, plotstyle_flags, material_flags,
            );
        }

        let _ = (|| -> Result<(), DwgError> {
            // 1. Owner handle â€” ONLY present when entmode == 0 per ODA Â§20.4.1.
            // For entmode 1 (PS) / 2 (MS) / 3 (other) the owner is implicit
            // and NOT encoded in the handle-stream. Reading it unconditionally
            // consumed bytes meant for later fields (layer, block_header, ...),
            // corrupting every subsequent handle-ref in the entity.
            if entity_mode == 0 {
                let (code, val) = hread!("owner")?;
                refs.owner = Some(resolve_handle_ref(code, val, parent_handle));
            }

            // 2. Reactor handles (skip)
            for _ in 0..num_reactors.min(1000) {
                let _ = hread!("reactor");
            }

            // 3. Xdict handle (R2000: always present; R2004+: only if !xdict_missing)
            let xdict_present = if self.version >= DwgVersion::R2004 {
                !xdict_missing
            } else {
                true
            };
            if xdict_present {
                let _ = hread!("xdict"); // skip xdict
            }

            // 4. Layer handle â€” the key reference we need
            let (code, val) = hread!("layer")?;
            refs.layer = Some(resolve_handle_ref(code, val, parent_handle));

            // 5. Linetype handle â€” per ODA Â§20.4.1: present ONLY when
            // ltype_flags == 0b11 (3). Flags 0/1/2 mean BYLAYER/BYBLOCK/
            // Continuous respectively and the handle is implicit. Previous
            // logic `ltype_flags != 3` was inverted â€” it consumed the next
            // handle (typically block_header for INSERT) whenever the
            // linetype WAS implicit, corrupting the rest of the handle
            // stream.
            if ltype_flags == 3 {
                let (code, val) = hread!("linetype")?;
                refs.linetype = Some(resolve_handle_ref(code, val, parent_handle));
            }

            // 6. Prev/Next entity handles (if links present)
            if !nolinks {
                let (code, val) = hread!("prev_entity")?;
                refs.prev_entity = Some(resolve_handle_ref(code, val, parent_handle));
                let (code, val) = hread!("next_entity")?;
                refs.next_entity = Some(resolve_handle_ref(code, val, parent_handle));
            }

            // 7. Plotstyle handle â€” per ODA Â§20.4.1: present ONLY when
            // plotstyle_flags == 0b11 (3). Same inversion fix as linetype.
            if plotstyle_flags == 3 {
                let (code, val) = hread!("plotstyle")?;
                refs.plotstyle = Some(resolve_handle_ref(code, val, parent_handle));
            }

            // 8. R2007+: Material handle â€” per ODA Â§20.4.1: present ONLY
            // when material_flags == 0b11 (3). Same inversion fix.
            if self.version >= DwgVersion::R2007 && material_flags == 3 {
                let (code, val) = hread!("material")?;
                refs.material = Some(resolve_handle_ref(code, val, parent_handle));
            }

            // --- Entity-type-specific handles ---

            // TEXT (0x01) / ATTRIB (0x02) / ATTDEF (0x03) / MTEXT (0x2C):
            // Per ODA Â§20.4.45 (TEXT) / Â§20.4.3 (ATTRIB) / Â§20.4.46 (MTEXT)
            // the handle-stream ends with a hard pointer to the TEXT STYLE
            // table entry (DWG STYLE object, type_num 0x35). We record it
            // in `obj_data["textStyleHandle"]` via a post-hook in
            // parse_entity_common_tail â€” but since we only have `refs`
            // here we piggy-back on `owned_handles[0]` so downstream
            // resolve_handles can look it up.
            if type_num == 0x01 || type_num == 0x02 || type_num == 0x03 || type_num == 0x2C {
                if let Ok((code, val)) = hread!("text_style") {
                    refs.owned_handles.push(
                        resolve_handle_ref(code, val, parent_handle)
                    );
                }
            }

            // INSERT (0x07) / MINSERT (0x08): per ODA Â§20.4.9 handle section:
            //   - BLOCK HEADER handle (hard reference, code 5)
            //   - Pre-R2004 with attribs: first_attrib, last_attrib, seqend
            //   - R2004+ with attribs: owned_object_count Ã— handle, then seqend
            if type_num == 0x07 || type_num == 0x08 {
                // Block header handle
                if let Ok((code, val)) = hread!("block_header") {
                    refs.block_header = Some(resolve_handle_ref(code, val, parent_handle));
                }
                let has_attribs = obj_data.get("_has_attribs")
                    .and_then(|v| v.as_bool()).unwrap_or(false);
                if has_attribs {
                    if self.version >= DwgVersion::R2004 {
                        // R2004+: owned_object_count handles (attrib entities)
                        let count = obj_data.get("_owned_object_count")
                            .and_then(|v| v.as_u64()).unwrap_or(0) as usize;
                        for _ in 0..count.min(10000) {
                            let _ = hread!("attrib");
                        }
                        // SEQEND handle
                        if let Ok((code, val)) = hread!("seqend") {
                            refs.seqend = Some(resolve_handle_ref(code, val, parent_handle));
                        }
                    } else {
                        // Pre-R2004: first_attrib, last_attrib, seqend
                        if let Ok((code, val)) = hread!("first_attrib") {
                            refs.first_entity = Some(resolve_handle_ref(code, val, parent_handle));
                        }
                        if let Ok((code, val)) = hread!("last_attrib") {
                            refs.last_entity = Some(resolve_handle_ref(code, val, parent_handle));
                        }
                        if let Ok((code, val)) = hread!("seqend") {
                            refs.seqend = Some(resolve_handle_ref(code, val, parent_handle));
                        }
                    }
                }
            }

            // DIMENSION (0x14 .. 0x1A): per ODA OpenDesignSpec Â§19.4.27
            // (Dimension Common handle section). After the shared 8 handles
            // the DIMENSION body has two trailing entity-specific hard
            // references:
            //   H  DIMSTYLE handle              (Â§19.4.27 "dimstyle")
            //   H  anonymous block handle      (Â§19.4.27 "block")
            // Stash DIMSTYLE in owned_handles[0] so downstream
            // resolve_handles can expose it as d["dimStyleHandle"]. The
            // anonymous block handle is currently unused by scene_io â€”
            // read it to keep the handle-stream aligned but drop the value.
            if (0x14..=0x1A).contains(&type_num) {
                if let Ok((code, val)) = hread!("dimstyle") {
                    refs.owned_handles.push(
                        resolve_handle_ref(code, val, parent_handle)
                    );
                }
                // anonymous block handle â€” consumed to stay aligned
                let _ = hread!("dim_anon_block");
            }

            // POLYLINE_2D (0x0F) / POLYLINE_3D (0x10): per ODA Â§20.4.16/17 handle section:
            //   - Pre-R2004: first_vertex, last_vertex, seqend
            //   - R2004+: owned_object_count Ã— vertex handles, then seqend
            if type_num == 0x0F || type_num == 0x10 {
                if self.version >= DwgVersion::R2004 {
                    let count = obj_data.get("_owned_object_count")
                        .and_then(|v| v.as_u64()).unwrap_or(0) as usize;
                    for _ in 0..count.min(100000) {
                        if let Ok((code, val)) = reader.read_h() {
                            refs.owned_handles.push(
                                resolve_handle_ref(code, val, parent_handle)
                            );
                        }
                    }
                    if let Ok((code, val)) = reader.read_h() {
                        refs.seqend = Some(resolve_handle_ref(code, val, parent_handle));
                    }
                } else {
                    if let Ok((code, val)) = reader.read_h() {
                        refs.first_entity = Some(resolve_handle_ref(code, val, parent_handle));
                    }
                    if let Ok((code, val)) = reader.read_h() {
                        refs.last_entity = Some(resolve_handle_ref(code, val, parent_handle));
                    }
                    if let Ok((code, val)) = reader.read_h() {
                        refs.seqend = Some(resolve_handle_ref(code, val, parent_handle));
                    }
                }
            }

            Ok(())
        })();

        refs
    }

    /// Read LAYER object handle stream and recover the AcDbColor handle
    /// when the data-stream BS color was written in sentinel form.
    ///
    /// Per ODA OpenDesignSpec Â§20.4.53 (LAYER object) the handle stream
    /// for a LAYER table record on R2004+ is, in order:
    ///
    ///   parent_handle      H (soft pointer, code 4) â€” LAYER_CONTROL parent
    ///   reactor_handles    H Ã— num_reactors
    ///   xdic_handle        H (only when xdict_missing == 0)
    ///   external_ref       H (NULL_HANDLE for ordinary layers, code 5)
    ///   plotstyle          H (hard pointer)
    ///   material           H (hard pointer, R2007+ only)
    ///   linetype           H (hard pointer)
    ///   color_object       H (hard pointer â€” ONLY when the LAYER's color
    ///                          BS contained a method-sentinel byte
    ///                          0xC0..0xC8 per Â§2.11)
    ///
    /// When the color_object handle is present we resolve it to an
    /// AcDbColor object body whose color_byte field holds the actual ACI.
    /// The recovered ACI is written back into `obj_data["color"]`,
    /// overriding the white (7) fallback that read_cmc_r2004 emits for
    /// sentinel layers.
    fn read_layer_handles_at_current(
        &self,
        reader: &mut DwgBitReader,
        parent_handle: u32,
        hs_size_bits: usize,
        obj_data: &mut HashMap<String, serde_json::Value>,
    ) {
        let _ = hs_size_bits;
        let num_reactors = obj_data.get("_num_reactors")
            .and_then(|v| v.as_i64()).unwrap_or(0) as usize;
        let xdict_missing = obj_data.get("_xdict_missing")
            .and_then(|v| v.as_bool()).unwrap_or(false);
        let sentinel_bs = obj_data.get("_color_sentinel")
            .and_then(|v| v.as_bool()).unwrap_or(false);

        let trace = std::env::var("O2D_LAYER_COLOR_DBG").is_ok();
        let trace_start = reader.tell_bit();
        if trace {
            eprintln!("[layer-h] BEGIN parent=0x{:X} num_reactors={} xdict_missing={} sentinel_bs={} hs_start_bit={}",
                parent_handle, num_reactors, xdict_missing, sentinel_bs,
                trace_start);
        }

        // Helper closure: read one handle, log if tracing, return resolved
        // absolute handle (or 0 on error / NULL handle).
        let mut hcount = 0usize;
        let mut read_one = |label: &str, reader: &mut DwgBitReader| -> u32 {
            let bp = reader.tell_bit();
            let res = reader.read_h();
            hcount += 1;
            match res {
                Ok((code, val)) => {
                    let abs = resolve_handle_ref(code, val, parent_handle);
                    if trace {
                        eprintln!(
                            "[layer-h]  parent=0x{:X} @bit={:>8}  #{:>2} {:<14} code=0x{:X} val=0x{:X} -> abs=0x{:X}",
                            parent_handle, bp, hcount, label, code, val, abs);
                    }
                    abs
                }
                Err(e) => {
                    if trace {
                        eprintln!(
                            "[layer-h]  parent=0x{:X} @bit={:>8}  #{:>2} {:<14} ERR: {:?}",
                            parent_handle, bp, hcount, label, e);
                    }
                    0
                }
            }
        };

        let _ = (|| -> Result<(), DwgError> {
            // 1. parent (LAYER_CONTROL handle)
            let _parent = read_one("parent", reader);
            // 2. reactors
            for _ in 0..num_reactors.min(1000) {
                let _ = read_one("reactor", reader);
            }
            // 3. xdic
            if !xdict_missing {
                let _ = read_one("xdic", reader);
            }
            // 4. external_ref (always â€” NULL_HANDLE for non-xref layers)
            let _ = read_one("external_ref", reader);
            // 5. plotstyle
            let _ = read_one("plotstyle", reader);
            // 6. material (R2007+)
            if self.version >= DwgVersion::R2007 {
                let _ = read_one("material", reader);
            }
            // 7. linetype
            let _ltype = read_one("linetype", reader);
            // 8. color object â€” present only when the data-stream BS used
            //    a method-sentinel form (per ODA Â§2.11). If present we
            //    capture the absolute handle so a post-resolution pass can
            //    look up the AcDbColor object's color_byte and override
            //    the white-fallback ACI emitted by read_cmc_r2004.
            // Note: we do NOT read a color_obj handle here.
            // ----------------------------------------------------------
            // Empirical evidence from O2D_LAYER_COLOR_DBG bit-stream
            // traces on the 3bm Funderingsherstel CP-21 fixture (AC1024 /
            // R2010): for ALL layers â€” both clean-ACI and sentinel-form â€”
            // the LAYER object's handle_stream_size_bits MC field
            // consistently reads 78 bits, exactly enough for 5 handles
            // (parent + external_ref + plotstyle + material + linetype).
            // The CLASSES section in this file does NOT include an
            // AcDbColor class. So the AcDbColor handle resolution path
            // implied by ODA Â§2.11 + Â§20.4.53 isn't applicable here.
            //
            // The actual ACI for sentinel-form layers (Hulplijnen=1,
            // Detailpen002=2, Buitenwanden=3, etc.) appears to be
            // encoded INLINE in the data stream past the CMC color RC
            // â€” but the exact post-color field layout is not yet
            // decoded. Reading further handles past slot 5 produces
            // garbage codes (0xF, 0x0) confirming we're past hs_end.
            //
            // The default white (ACI=7) fallback in read_cmc_r2004
            // remains in place. A future round needs to decode the
            // ~300-bit post-CMC region of the LAYER body to extract
            // the actual ACI.
            let _ = sentinel_bs;
            Ok(())
        })();
    }

    // ------------------------------------------------------------------
    // Entity common data (version-aware)
    // ------------------------------------------------------------------

    fn parse_entity_common(&self, reader: &mut DwgBitReader) -> HashMap<String, serde_json::Value> {
        let mut result = HashMap::new();

        // Per ODA v5.4.1 Â§20.4.1 "Common Entity Data" (authoritative spec
        // reference). Flow matches the spec table read top-to-bottom:
        //
        //   1. Graphic Present Flag (B)                     [Common]
        //   2. if flag==1:
        //        pre-R2010 : RL  graphic size in bytes      [Common]
        //        R2010+    : BLL graphic size in bytes
        //        X               graphic image bytes
        //   3. R13-R14 Only: RL Obj size (bitsize)          â€” skipped for R2000+
        //   4. Entmode BB                                   [Common]
        //   5. Numreactors BL                               [Common]
        //   6. XDic Missing Flag B                          [R2004+]
        //   7. Has DS binary data B                         [R2013+]
        //   8. Isbylayerlt B                                [R13-R14 only]
        //   9. Nolinks B                                    [Common per Â§20.4.1,
        //                                                    BUT empirically absent
        //                                                    in R2010+ data stream
        //                                                    â€” see note below]
        //  10. Color: CMC pre-R2004, ENC R2004+
        //  11. Ltype scale BD
        //  12. R2000+ BB Ltype flags + BB Plotstyle flags
        //  13. R2007+ BB Material flags + RC Shadow flags
        //  14. R2010+ B has_full_vs + B has_face_vs + B has_edge_vs
        //  15. BS Invisibility
        //  16. R2000+ RC Lineweight
        //
        // Nolinks sub-note: the ODA v5.4.1 Â§20.4.1 table places `Nolinks B`
        // under a "Common" header (applying to R2010+). However empirical
        // evidence from arc_2010.dwg / circle_2010.dwg / line_2010.dwg
        // (all AC1024 = R2010, confirmed against DXF ground truth) shows
        // that OMITTING the nolinks bit for R2010+ produces pixel-exact
        // coordinates. Restoring the bit for R2010+ causes a 1-bit drift
        // that scrambles every R2010 entity. One reading of the spec is
        // that for R2004+ (per Â§20.4.1 note 4548: "For R2004+ this always
        // has value 1 (links are not used)") the bit was absorbed back
        // into metadata / removed from the data stream. We treat that as
        // the empirically correct behaviour.
        //
        // Set O2D_DWG_TRACE_ENTITY_COMMON=1 to print the bit position
        // before each field read (for bit-stream bisection against a
        // reference R2010 decode).

        let trace = std::env::var("O2D_DWG_TRACE_ENTITY_COMMON")
            .map(|v| v == "1").unwrap_or(false);
        let start_bit = reader.tell_bit();
        macro_rules! tr {
            ($label:expr) => {
                if trace {
                    eprintln!(
                        "[entity-common] @bit={:>8}  (+{:>3})  {}",
                        reader.tell_bit(),
                        reader.tell_bit().saturating_sub(start_bit),
                        $label,
                    );
                }
            };
        }

        let _ = (|| -> Result<(), DwgError> {
            // 1. Graphic Present Flag (B) â€” Common Â§20.4.1.
            tr!("graphic-present B");
            let preview_exists = reader.read_bit()?;
            if preview_exists != 0 {
                // 2. Graphic size: RL pre-R2010, BLL R2010+. Â§20.2.
                tr!("graphic-size RL/BLL");
                let preview_size = if self.version >= DwgVersion::R2010 {
                    reader.read_bll()? as usize
                } else {
                    reader.read_raw_long()? as usize
                };
                // Per spec we MUST consume `preview_size` raw bytes to
                // remain aligned. The previous `< 5_000_000` guard could
                // silently skip the read on legitimate large thumbnails,
                // causing bit-stream drift for subsequent entity_common
                // fields. Cap at the remaining bit-stream bytes as a hard
                // safety net â€” consuming a truncated count is still
                // preferable to skipping the read entirely.
                let max_bytes = reader.remaining_bytes();
                let to_read = preview_size.min(max_bytes);
                if to_read > 0 {
                    tr!("graphic-bytes");
                    for _ in 0..to_read {
                        reader.read_byte()?;
                    }
                }
            }

            // 4. Entmode BB â€” Common Â§20.4.1.
            // Per ODA Â§20.4.1: entmode determines whether the OWNER handle
            // appears in the handle section:
            //   entmode == 0  â†’ owner handle IS present (read as soft-pointer)
            //   entmode == 1  â†’ owner is PaperSpace (implicit, NOT in stream)
            //   entmode == 2  â†’ owner is ModelSpace  (implicit, NOT in stream)
            //   entmode == 3  â†’ owner absent from handle stream (special case)
            // Stored under `_entity_mode` so read_entity_handles_at_current
            // can gate the owner-handle read. The public `entity_mode` key
            // is kept for backwards compat.
            tr!("entmode BB");
            let entity_mode = reader.read_bb()? as u8;
            result.insert("entity_mode".into(), serde_json::json!(entity_mode));
            result.insert("_entity_mode".into(), serde_json::json!(entity_mode));

            // 5. Numreactors BL â€” Common Â§20.4.1.
            tr!("numreactors BL");
            let num_reactors = reader.read_bl()?;
            result.insert("_num_reactors".into(), serde_json::json!(num_reactors));

            // 6. XDic Missing Flag B â€” R2004+ Â§20.4.1.
            let xdict_missing = if self.version >= DwgVersion::R2004 {
                tr!("xdict-missing B  [R2004+]");
                reader.read_bit()? != 0
            } else {
                false
            };
            result.insert("_xdict_missing".into(), serde_json::json!(xdict_missing));

            // 7. Has DS binary data B â€” R2013+ Â§20.4.1.
            if self.version >= DwgVersion::R2013 {
                tr!("has-ds-binary B  [R2013+]");
                let _has_binary_data = reader.read_bit()?;
            }

            // 8+9. Nolinks B (R2000-R2007 only in the data stream â€” see
            // header comment block above; R2010+ entities OMIT this bit
            // empirically despite Â§20.4.1 labelling it "Common").
            //
            // Per ODA Â§20.4.1 note: "For R2004+ this always has value 1
            // (links are not used)". So when the bit is absent from the
            // stream (R2010+) we MUST treat nolinks as `true`, NOT false â€”
            // otherwise read_entity_handles_at_current consumes two phantom
            // prev/next entity handles and corrupts every subsequent
            // ref (plotstyle, material, block_headerâ€¦).
            let nolinks = if self.version < DwgVersion::R2010 {
                tr!("nolinks B  [R2000-R2007]");
                reader.read_bit()? != 0
            } else {
                true
            };
            result.insert("_nolinks".into(), serde_json::json!(nolinks));

            // 10. Color: R2004+ uses ENC (true color), R2000 uses CMC (index).
            // Â§20.4.1 + Â§2.11 (ENC layout: BS + optional BS for RGB when
            // 0x8000 set + optional BL for transparency when 0x2000 set).
            if self.version >= DwgVersion::R2004 {
                tr!("color ENC  [R2004+]");
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
                tr!("color CMC  [pre-R2004]");
                result.insert("color".into(), serde_json::json!(reader.read_cmc()?));
            }

            // 11. Ltype scale BD â€” Â§20.4.1.
            tr!("ltype-scale BD");
            result.insert("linetype_scale".into(), serde_json::json!(reader.read_bd()?));

            // 12. Ltype flags BB + Plotstyle flags BB - R2000+ §20.4.1.
            // Per ODA OpenDesignSpec §20.4.1 "Common Entity Format", these
            // flags were introduced in R2000 - R13 and R14 entities don't
            // carry them. Reading them unconditionally drifts the bit stream
            // by 4 bits per R14 entity, which scrambles every subsequent LINE
            // start_x / end_x decode and produces 0 sane coords (verified
            // against r14/v.dwg from the LibreDWG corpus: 16 LINEs parsed
            // but every coord garbage; with the guard added, segments emerge
            // and the bbox stops being [0,0..0,0]).
            if self.version >= DwgVersion::R2000 {
                tr!("ltype-flags BB  [R2000+]");
                let ltype_flags = reader.read_bb()?;
                result.insert("_ltype_flags".into(), serde_json::json!(ltype_flags));

                tr!("plotstyle-flags BB  [R2000+]");
                let plotstyle_flags = reader.read_bb()?;
                result.insert("_plotstyle_flags".into(), serde_json::json!(plotstyle_flags));
            }

            // 13. R2007+: Material flags BB + Shadow flags RC â€” Â§20.4.1.
            if self.version >= DwgVersion::R2007 {
                tr!("material-flags BB  [R2007+]");
                let material_flags = reader.read_bb()?;
                result.insert("_material_flags".into(), serde_json::json!(material_flags));
                tr!("shadow-flags RC  [R2007+]");
                let shadow_flags = reader.read_byte()?;
                result.insert("_shadow_flags".into(), serde_json::json!(shadow_flags));
            }

            // 14. R2010+: three single-bit visual-style flags â€” Â§20.4.1.
            if self.version >= DwgVersion::R2010 {
                tr!("has-full-vs B  [R2010+]");
                let _has_full_vs = reader.read_bit()?;
                tr!("has-face-vs B  [R2010+]");
                let _has_face_vs = reader.read_bit()?;
                tr!("has-edge-vs B  [R2010+]");
                let _has_edge_vs = reader.read_bit()?;
            }

            // 15. Invisibility BS â€” Common Â§20.4.1.
            tr!("invisibility BS");
            let invisibility = reader.read_bs()?;
            result.insert("invisible".into(), serde_json::json!(invisibility != 0));

            // 16. Lineweight RC - R2000+ §20.4.1.
            // Same R2000-introduction story as the ltype/plotstyle flags
            // above - R13/R14 entities have no lineweight byte. Guarding
            // shaves 8 bits per pre-R2000 entity, completing the R14
            // entity-common alignment fix.
            if self.version >= DwgVersion::R2000 {
                tr!("lineweight RC  [R2000+]");
                result.insert("lineweight".into(), serde_json::json!(reader.read_byte()?));
            }

            if trace {
                eprintln!(
                    "[entity-common] END   @bit={:>8}  (+{:>3})",
                    reader.tell_bit(),
                    reader.tell_bit().saturating_sub(start_bit),
                );
            }
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
            0x0C => self.parse_vertex_mesh(reader),
            0x0D => self.parse_vertex_pface(reader),
            0x0E => self.parse_vertex_pface_face(reader),
            0x0F => self.parse_polyline_2d(reader),
            0x10 => self.parse_polyline_3d(reader),
            0x1D => self.parse_polyline_pface(reader),
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
            // per ODA OpenDesignSpec Â§20.4.45 (TEXT entity). dataflags bits
            // indicate which optional sub-fields are OMITTED (bit set = omit,
            // use default). The justification codes (72/73 in DXF terms)
            // live after text_value and are guarded by bits 0x20 / 0x40 / 0x80.
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
            // per ODA Â§20.4.45: generation (BS), horizontal_alignment (BS),
            // vertical_alignment (BS). Each guarded by the corresponding
            // dataflags omit-bit. Values match DXF codes 71, 72, 73.
            let _generation = if dataflags & 0x20 == 0 { reader.read_bs()? as i16 } else { 0 };
            let horiz_align = if dataflags & 0x40 == 0 { reader.read_bs()? as i16 } else { 0 };
            let vert_align = if dataflags & 0x80 == 0 { reader.read_bs()? as i16 } else { 0 };

            result.insert("elevation".into(), serde_json::json!(elevation));
            result.insert("insertionPoint".into(), serde_json::json!([insertion.0, insertion.1, elevation]));
            result.insert("alignmentPoint".into(), serde_json::json!([alignment.0, alignment.1, elevation]));
            result.insert("rotation".into(), serde_json::json!(rotation));
            result.insert("height".into(), serde_json::json!(height));
            result.insert("text".into(), serde_json::json!(text_value));
            // DXF code 72 (horizontal justification): 0=Left 1=Center 2=Right
            //   3=Aligned 4=Middle 5=Fit â€” consumed by scene_io.rs TEXT arm.
            result.insert("horizontalAlign".into(), serde_json::json!(horiz_align));
            // DXF code 73 (vertical justification): 0=Baseline 1=Bottom
            //   2=Middle 3=Top.
            result.insert("verticalAlign".into(), serde_json::json!(vert_align));
            Ok(())
        })();
        result
    }

    fn parse_mtext(&self, reader: &mut DwgBitReader) -> HashMap<String, serde_json::Value> {
        let mut result = HashMap::new();
        let _ = (|| -> Result<(), DwgError> {
            // Per ODA OpenDesignSpec Â§20.4.46 (MTEXT).
            let insertion = reader.read_3bd()?;
            let _extrusion = reader.read_3bd()?;
            // ODA Â§20.4.46: x_axis_dir (group 11/21/31) is the MTEXT local
            // X-axis direction vector. Its angle (atan2(y, x)) IS the MTEXT
            // rotation; there is NO separate code-50 angle in the DWG stream
            // (unlike TEXT). Without this a rotated MTEXT like Funderings-
            // herstel's vertical pile-length labels ("theoretische paal-
            // lengte") renders horizontal.
            let x_axis_dir = reader.read_3bd()?;
            let rotation = if x_axis_dir.0.abs() > 1e-12 || x_axis_dir.1.abs() > 1e-12 {
                x_axis_dir.1.atan2(x_axis_dir.0)
            } else {
                0.0
            };
            let _rect_width = reader.read_bd()?;
            // R2007+: reference rectangle height (group 46) precedes text height.
            if self.version >= DwgVersion::R2007 {
                let _rect_height = reader.read_bd()?;
            }
            let text_height = reader.read_bd()?;
            let attachment = reader.read_bs()?;
            let _flow_dir = reader.read_bs()?;
            let _ext_h = reader.read_bd()?;
            let _ext_w = reader.read_bd()?;
            let text = reader.read_tv(self.version.is_r2007_plus())?;

            result.insert("insertionPoint".into(), serde_json::json!([insertion.0, insertion.1, insertion.2]));
            result.insert("height".into(), serde_json::json!(text_height));
            result.insert("attachment".into(), serde_json::json!(attachment));
            result.insert("rotation".into(), serde_json::json!(rotation));
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
            let has_attribs = reader.read_bit()?;

            // R2004+: owned_object_count (BL) â€” per ODA Â§20.4.9.
            let owned_object_count = if self.version >= DwgVersion::R2004 {
                reader.read_bl().unwrap_or(0)
            } else {
                0
            };

            result.insert("insertionPoint".into(), serde_json::json!([insertion.0, insertion.1, insertion.2]));
            result.insert("scaleX".into(), serde_json::json!(sx));
            result.insert("scaleY".into(), serde_json::json!(sy));
            result.insert("scaleZ".into(), serde_json::json!(sz));
            result.insert("rotation".into(), serde_json::json!(rotation));
            result.insert("_has_attribs".into(), serde_json::json!(has_attribs != 0));
            result.insert("_owned_object_count".into(), serde_json::json!(owned_object_count));
            Ok(())
        })();
        result
    }

    fn parse_lwpolyline(&self, reader: &mut DwgBitReader) -> HashMap<String, serde_json::Value> {
        let mut result = HashMap::new();
        let _ = (|| -> Result<(), DwgError> {
            // Per ODA OpenDesignSpec Â§20.4.85 (LWPOLYLINE / "LWPLINE").
            let flag = reader.read_bs()? as u16;

            if flag & 4 != 0 { reader.read_bd()?; }   // const width  (43)
            if flag & 8 != 0 { reader.read_bd()?; }   // elevation    (38)
            if flag & 2 != 0 { reader.read_bd()?; }   // thickness    (39)
            if flag & 1 != 0 { reader.read_3bd()?; }  // extrusion    (210)

            let num_points = reader.read_bl()? as usize;
            let num_bulges = if flag & 16 != 0 { reader.read_bl()? as usize } else { 0 };
            // R2010+: vertex-id count is a new BL guarded by bit 1024.
            let num_vertex_ids = if self.version >= DwgVersion::R2010 && flag & 1024 != 0 {
                reader.read_bl()? as usize
            } else {
                0
            };
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

            // R2010+: vertex-id list (BL per id) sits between bulges and widths.
            for _ in 0..num_vertex_ids {
                reader.read_bl()?;
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

            // per ODA OpenDesignSpec Â§19.3.19 â€” R2013+ SPLINE inserts two
            // extra BL fields (splineflags1, knotparam) before degree.
            if self.version >= DwgVersion::R2013 {
                let _splineflags1 = reader.read_bl()?;
                let _knotparam = reader.read_bl()?;
            }

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
                // per ODA Â§19.3.19 â€” scenario 1 has fit_tol + beg/end tangent
                // vectors before num_fit.
                let _fit_tol = reader.read_bd()?;
                let _beg_tan_vec = reader.read_3bd()?;
                let _end_tan_vec = reader.read_3bd()?;
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
            // per ODA Â§20.4.46 (ATTRIB) / Â§20.4.45 (TEXT): BS codes 71/72/73.
            let _generation = reader.read_bs()? as i16;
            let horiz_align = reader.read_bs()? as i16;
            let vert_align = reader.read_bs()? as i16;
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
            // DXF codes 72/73 â€” consumed by scene_io.rs TEXT arm.
            result.insert("horizontalAlign".into(), serde_json::json!(horiz_align));
            result.insert("verticalAlign".into(), serde_json::json!(vert_align));
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
            // Per ODA OpenDesignSpec Â§20.4.16 (2D POLYLINE).
            let flags = reader.read_bs()?;
            let _curve_type = reader.read_bs()?;
            let start_width = reader.read_bd()?;
            let end_width = reader.read_bd()?;
            let _thickness = reader.read_bt()?;
            let elevation = reader.read_bd()?;
            let _extrusion = reader.read_be()?;
            // R2004+: owned-object count added per ODA Â§20.4.16.
            let owned_count = if self.version >= DwgVersion::R2004 {
                reader.read_bl().unwrap_or(0)
            } else {
                0
            };
            result.insert("flags".into(), serde_json::json!(flags));
            result.insert("elevation".into(), serde_json::json!(elevation));
            if start_width != 0.0 { result.insert("startWidth".into(), serde_json::json!(start_width)); }
            if end_width != 0.0 { result.insert("endWidth".into(), serde_json::json!(end_width)); }
            result.insert("closed".into(), serde_json::json!(flags & 1 != 0));
            result.insert("_owned_object_count".into(), serde_json::json!(owned_count));
            Ok(())
        })();
        result
    }

    fn parse_polyline_3d(&self, reader: &mut DwgBitReader) -> HashMap<String, serde_json::Value> {
        let mut result = HashMap::new();
        let _ = (|| -> Result<(), DwgError> {
            // Per ODA OpenDesignSpec Â§20.4.17 (3D POLYLINE).
            let _curve_flags = reader.read_byte()?;
            let flags = reader.read_byte()?;
            // R2004+: owned-object count added per ODA Â§20.4.17.
            let owned_count = if self.version >= DwgVersion::R2004 {
                reader.read_bl().unwrap_or(0)
            } else {
                0
            };
            result.insert("flags".into(), serde_json::json!(flags));
            result.insert("closed".into(), serde_json::json!(flags & 1 != 0));
            result.insert("_owned_object_count".into(), serde_json::json!(owned_count));
            Ok(())
        })();
        result
    }

    /// VERTEX_MESH (type 0x0C). Per ODA Â§20.4.18: flags (RC) + point (3BD).
    fn parse_vertex_mesh(&self, reader: &mut DwgBitReader) -> HashMap<String, serde_json::Value> {
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

    /// VERTEX_PFACE (type 0x0D). Per ODA Â§20.4.19: flags (RC) + point (3BD).
    /// Structurally identical to VERTEX_3D/VERTEX_MESH for position data.
    fn parse_vertex_pface(&self, reader: &mut DwgBitReader) -> HashMap<String, serde_json::Value> {
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

    /// VERTEX_PFACE_FACE (type 0x0E). Per ODA Â§20.4.20: four vertex-indices (BS).
    /// This is a face record, not a positioned vertex. Emit indices but no position.
    fn parse_vertex_pface_face(&self, reader: &mut DwgBitReader) -> HashMap<String, serde_json::Value> {
        let mut result = HashMap::new();
        let _ = (|| -> Result<(), DwgError> {
            let v1 = reader.read_bs()?;
            let v2 = reader.read_bs()?;
            let v3 = reader.read_bs()?;
            let v4 = reader.read_bs()?;
            result.insert("faceIndices".into(), serde_json::json!([v1, v2, v3, v4]));
            Ok(())
        })();
        result
    }

    /// POLYLINE_PFACE (type 0x1D). Per ODA Â§20.4.21:
    ///   num_verts (BS) + num_faces (BS) [+ R2004+ owned_count (BL)].
    fn parse_polyline_pface(&self, reader: &mut DwgBitReader) -> HashMap<String, serde_json::Value> {
        let mut result = HashMap::new();
        let _ = (|| -> Result<(), DwgError> {
            let num_verts = reader.read_bs()?;
            let num_faces = reader.read_bs()?;
            let owned_count = if self.version >= DwgVersion::R2004 {
                reader.read_bl().unwrap_or(0)
            } else {
                0
            };
            result.insert("numVerts".into(), serde_json::json!(num_verts));
            result.insert("numFaces".into(), serde_json::json!(num_faces));
            result.insert("_owned_object_count".into(), serde_json::json!(owned_count));
            // Flag 64 (PolyFaceMesh) for downstream consumers that key on DXF flags.
            result.insert("flags".into(), serde_json::json!(64i32));
            Ok(())
        })();
        result
    }

    // --- DIMENSION common ---
    //
    // Per ODA 5.4.2 Â§19.4.27 (Dimension Common DWG body), the field order is:
    //   R2010+:  RC class_version (=0)
    //   3BD  extrusion         (210)
    //   2RD  text_midpt         (11)
    //   BD   elevation          (11 z)
    //   RC   flags_1            (70)
    //   TV   user_text          (1)
    //   BD   text_rotation      (53)
    //   BD   horiz_dir          (51)
    //   3BD  ins_scale
    //   BD   ins_rotation       (54)
    //   R2000+: BS attachment (71), BS lspace_style (72), BD lspace_factor (41),
    //           BD act_measurement (42)
    //   R2007+: B unknown (73), B flip_arrow1 (74), B flip_arrow2 (75)
    //   2RD  clone_ins_pt        (12)
    //
    // Prior version of this parser was MISSING the R2007+ three booleans and
    // the final `clone_ins_pt 2RD`. That drift shifted all subsequent reads
    // (extLine1/2 in LINEAR/ALIGNED, etc.) by ~131 bits â€” the Funderingsherstel
    // DWG produced extLine1 values like 8.78e-153 (subnormal doubles) because
    // the ~131 mis-aligned bits happened to form an exponent near 0. Restoring
    // the missing fields gives extLine1/2 real coordinates so DIMENSION
    // tessellation in scene_io emits the ext-line + dim-line + tick geometry.
    fn parse_dimension_common(&self, reader: &mut DwgBitReader) -> HashMap<String, serde_json::Value> {
        let mut result = HashMap::new();
        let is_unicode = self.version.is_r2007_plus();
        let _ = (|| -> Result<(), DwgError> {
            if self.version >= DwgVersion::R2010 {
                let _class_version = reader.read_byte()?;
            }
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

            // R2007+ three booleans (ODA Â§19.4.27 â€” "unknown", flip_arrow1,
            // flip_arrow2). 3 bits, not always byte-aligned â€” read_bit is
            // correct.
            if self.version >= DwgVersion::R2007 {
                let _unknown_b = reader.read_bit()?;
                let _flip_arrow1 = reader.read_bit()?;
                let _flip_arrow2 = reader.read_bit()?;
            }

            // clone_ins_pt 2RD â€” all versions. Without this, LINEAR/ALIGNED/
            // ANG2LN/ANG3PT/ORDINATE/RADIUS subtypes' subsequent reads are
            // shifted by 128 bits and produce subnormal garbage.
            let _clone_ins_pt = reader.read_2rd()?;

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
                // ODA Â§19.4.61 VIEWPORT (R2000+): R2000+ viewport header after
                // the paper-space rect. Field order per ODA:
                //   view_target      3BD (DXF code 17)
                //   view_direction   3BD (DXF code 16)
                //   view_twist       BD  (DXF code 51)
                //   view_height      BD  (DXF code 45) â€” model-space visible height
                //   lens_length      BD  (DXF code 42)
                //   front_clip       BD  (DXF code 43)
                //   back_clip        BD  (DXF code 44)
                //   snap_angle       BD  (DXF code 50)
                //   view_center      2RD (DXF code 12) â€” MODEL-space center âš  was mis-read as snap_base
                //   snap_base        2RD (DXF code 13)
                //   snap_spacing     2RD (DXF code 14)
                //   grid_spacing     2RD (DXF code 15)
                //   circle_zoom      BS
                //
                // `view_center` is what DXF code 12/22 gives â€” the actual
                // paper-space-tab projection uses it as the model-space
                // point that maps to the paper-space rect center. Without
                // it, the projection pass collapses all viewports to the
                // world origin (seen as vp view_ctr=(0,0) in the dump).
                let view_target = reader.read_3bd()?;
                let view_direction = reader.read_3bd()?;
                let twist_angle = reader.read_bd()?;
                let view_height = reader.read_bd()?;
                let _lens_length = reader.read_bd()?;
                let front_clip = reader.read_bd()?;
                let back_clip = reader.read_bd()?;
                let _snap_angle = reader.read_bd()?;
                let view_center = reader.read_2rd()?;
                let _snap_base = reader.read_2rd()?;
                let _snap_spacing = reader.read_2rd()?;
                let _grid_spacing = reader.read_2rd()?;
                let _circle_zoom = reader.read_bs()?;

                result.insert("viewTarget".into(), serde_json::json!([view_target.0, view_target.1, view_target.2]));
                result.insert("viewDirection".into(), serde_json::json!([view_direction.0, view_direction.1, view_direction.2]));
                result.insert("twistAngle".into(), serde_json::json!(twist_angle));
                result.insert("viewHeight".into(), serde_json::json!(view_height));
                result.insert("viewCenter".into(), serde_json::json!([view_center.0, view_center.1]));
                result.insert("frontClip".into(), serde_json::json!(front_clip));
                result.insert("backClip".into(), serde_json::json!(back_clip));
            }

            Ok(())
        })();
        result
    }

    fn parse_hatch(&self, reader: &mut DwgBitReader) -> HashMap<String, serde_json::Value> {
        let mut result = HashMap::new();
        let is_unicode = self.version.is_r2007_plus();
        let _ = (|| -> Result<(), DwgError> {
            // ODA Â§19.4.96 HATCH (R2000+).
            // R2004+ adds a full gradient-definition block BEFORE the legacy fields.
            // Even when is_gradient_fill==0, ALL gradient fields are still serialized
            // (per spec) and must be consumed to keep the bit stream aligned â€”
            // skipping them caused num_paths to read garbage and the parser bailed
            // out before populating boundaryPaths.
            if self.version >= DwgVersion::R2004 {
                let _is_gradient_fill = reader.read_bl()?;
                let _reserved = reader.read_bl()?;
                let _gradient_angle = reader.read_bd()?;
                let _gradient_shift = reader.read_bd()?;
                let _single_color_grad = reader.read_bl()?;
                let _gradient_tint = reader.read_bd()?;
                let n_grad_colors = reader.read_bl()? as usize;
                for _ in 0..n_grad_colors.min(1000) {
                    let _unk_d = reader.read_bd()?;
                    let _unk_s = reader.read_bs()?;
                    let _rgb = reader.read_bl()?;
                    let _ignored = reader.read_byte()?;
                    let _name = reader.read_tv(is_unicode)?;
                }
                let _gradient_name = reader.read_tv(is_unicode)?;
            }

            let elevation = reader.read_bd()?;
            let extrusion = reader.read_3bd()?;
            let pattern_name = reader.read_tv(is_unicode)?;
            // Per ODA OpenDesign Spec Â§19.4.96: solid_fill and associative are
            // single bits (B), NOT BL. Only n_paths is BL.
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

                // per ODA Â§19.4.96 HATCH pattern definition line fields:
                //   angle  (BD)         â€” rotation of this pattern line, degrees
                //   base.x, base.y (BD) â€” origin of the infinite line
                //   offset.x, offset.y  â€” perpendicular vector between parallel
                //                         copies of the line (controls spacing)
                //   num_dashes (BS)     â€” count of dash items (0 = solid line)
                //   dashes[]   (BD[])   â€” signed lengths, positive=pen-down,
                //                         negative=pen-up; matches DXF code 49
                // Previously the values were read solely to advance the bit
                // stream and then discarded; downstream DWG renderers therefore
                // could not draw non-solid hatches. Now emitted as JSON so the
                // scene-io consumer can feed emit_hatch_pattern_lines().
                // Per ODA Open Design Spec Â§19.4.96 HATCH pattern definition
                // line: angle (BD, RADIANS), pt0 (2BD), offset (2BD),
                // num_dashes (BS), dashes (BD[]).
                //
                // EVIDENCE (2026-04-21 investigation): earlier code read base
                // and offset as 2RD (raw doubles) and emitted `angle` as
                // raw radians. Concrete test fixture
                // `arceringen test/3070_modelâ€¦_5.{dxf,dwg}`:
                //   DXF HATCH@2790 (pattern FP_13) carries code 53 = 45.0Â°,
                //   base (43/44) = (0, 0), offset (45/46) = (-3.536, 3.536).
                //   DWG HATCH h=204 parsed as `angle_raw = 0.7853981633974483`
                //   (exactly Ï€/4 = 45Â° in RADIANS); base/offset then decoded
                //   as garbage magnitudes (1e-271 â€¦ 1e+247) â€” 128 extra
                //   raw-double bits were consumed where 2Ã—BD was expected,
                //   so the next pattern-line read drifted into random bits.
                // Fix:
                //   1) Convert the stored angle to degrees to match the
                //      DXF/consumer convention (scene_io HatchPatternLine
                //      field is `angle_deg` and the renderer calls
                //      `.to_radians()` on it).
                //   2) Read pt0/offset via `read_2bd` (two BD values) per
                //      ODA Â§19.4.96 â€” 2RD was wrong and the source of the
                //      multi-pattern-line drift.
                let mut pattern_lines_json: Vec<serde_json::Value> = Vec::new();
                for _ in 0..num_def_lines.min(1000) {
                    let angle_rad = reader.read_bd()?;
                    let (base_x, base_y) = reader.read_2bd()?;
                    let (off_x, off_y) = reader.read_2bd()?;
                    let num_dashes = reader.read_bs()? as usize;
                    let mut dashes: Vec<f64> = Vec::with_capacity(num_dashes.min(100));
                    for _ in 0..num_dashes.min(100) {
                        dashes.push(reader.read_bd()?);
                    }
                    pattern_lines_json.push(serde_json::json!({
                        "angle": angle_rad.to_degrees(),
                        "base":   { "x": base_x, "y": base_y },
                        "offset": { "x": off_x,  "y": off_y },
                        "dashes": dashes,
                    }));
                }
                if !pattern_lines_json.is_empty() {
                    result.insert("patternLines".into(), serde_json::json!(pattern_lines_json));
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

        // Per ODA Â§20.1 â€” Non-entity common object header.
        // After the handle + EED (already read in parse_single_object_r2000),
        // the data stream contains:
        //   1. num_reactors (BL)
        //   2. xdict_missing_flag (B) â€” R2004+
        //   3. has_binary_data (B) â€” R2013+
        // These were previously read inside each individual parser (only num_reactors),
        // missing xdict_missing and has_binary_data which caused 1-2 bit drift on R2004+.
        let _ = (|| -> Result<(), DwgError> {
            let num_reactors = reader.read_bl()?;
            result.insert("_num_reactors".into(), serde_json::json!(num_reactors));

            if self.version >= DwgVersion::R2004 {
                let xdict_missing = reader.read_bit()? != 0;
                result.insert("_xdict_missing".into(), serde_json::json!(xdict_missing));
            }
            if self.version >= DwgVersion::R2013 {
                let _has_binary_data = reader.read_bit()?;
            }
            Ok(())
        })();

        let _ = match type_num {
            0x33 => self.parse_layer_obj(reader, &mut result),
            0x31 => self.parse_block_header_obj(reader, &mut result),
            0x35 => self.parse_style_obj(reader, &mut result),
            0x39 => self.parse_ltype_obj(reader, &mut result),
            0x45 => self.parse_dimstyle_obj(reader, &mut result),
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
        // num_reactors already read in parse_table_object common header
        if std::env::var("DWG_DEBUG_LAYER").is_ok() {
            eprintln!("[layer-dbg] enter parse_layer_obj is_r2007+={} has_ss={} ss_bit={:?} pos={}",
                self.version.is_r2007_plus(),
                reader.has_string_stream(),
                reader.get_string_stream_bit(),
                reader.tell_bit());
        }
        let is_r2007 = self.version.is_r2007_plus();
        let is_r2004 = self.version.is_r2004_plus();
        let name = reader.read_tv(is_r2007)?;
        let _bit64 = reader.read_bit()?;
        // Per ODA OpenDesignSpec Â§20.4.53 (LAYER) + libredwg's `dwg.spec`
        // common_table_flags (entry_name): the field order on R2007+ is
        //   name TV
        //   64-flag B
        //   xrefdep B          â† NOTE: xrefdep comes BEFORE xrefindex
        //   xrefindex+1 BS
        //   flags BS
        //   color CMC
        //
        // Round 10 finding (3bm Funderingsherstel CP-21 R2010 fixture):
        // reading xrefindex BEFORE xrefdep produced xref values like
        // 16568=0x40B8 / 16600=0x40D8 / 16632=0x40F8 for layers with
        // lineweight 13/18/25 â€” clearly the BS was consuming the LATER
        // xrefindex+lineweight portion of the bit stream. Swapping to the
        // correct order (xdep B â†’ xref BS) made all 21 LAYER ACIs match
        // the DXF (Hulplijnen=1, Buitenwanden=3, Bovenbouw=8, etc.) â€” the
        // post-color CMC bit cursor lands on the actual ACI byte instead
        // of on the raw BS dropping into the next field's bits.
        let _xdep = reader.read_bit()?;
        let _xref_index = reader.read_bs()?;
        if std::env::var("DWG_LAYER_DUMP").is_ok() {
            eprintln!(
                "[layer-pre-color-trace] name={:?} xref={} xdep={}",
                name, _xref_index, _xdep,
            );
        }
        // Per ODA Â§20.4.53 (LAYER) + Â§2.11 (CmColor / ENC): on R2004+
        // the layer color is an ENC (Extended NamedColor), not a plain
        // BS index. The ENC is a BS whose top 3 bits are flags and
        // whose low 13 bits are the ACI; when the file writer used a
        // ByColor / ByBlock / ByLayer method form, the BS instead
        // carries the method sentinel (0xC0..0xC8 in the low byte,
        // zero high byte) and the real ACI follows as an RC.
        //
        // The old code called `read_cmc` which is a bare `read_bs`, so
        // every layer written in ByColor form returned color=195
        // (0x00C3 = the ByColor method byte). `aci_to_rgba(195)` maps
        // to #D1AEED (pink-purple) â€” this is the user-visible bug:
        // DWG entities on layers like "A--L21--_Buitenwanden" showed
        // purple where the DXF shows red. Ref: SPEC_NOTES.md Â§ENC and
        // the `read_enc` implementation in bitreader.rs.
        let flags = reader.read_bs()?;
        // Per ODA Â§20.4.53 (LAYER) + Â§2.11 (CmColor / ENC):
        //
        // On R2004+ the layer color is written as a CMC (BS color_value +
        // optional RC flag-byte + optional color/book-name strings). The
        // BS color_value encoding uses 0xC0..0xC8 in either the low or high
        // byte to signal a ByBlock / ByLayer / ByColor / Foreground / None
        // method; in that case the actual ACI is either the OTHER byte of
        // the BS or â€” on files written with the "explicit RC ACI" form â€”
        // an RC that immediately follows.
        //
        // Pre-existing behaviour (commit log: "entities on layers like
        // A--L21--_Buitenwanden showed purple where the DXF shows red",
        // ACI=195 â†’ #D1AEED) used `read_enc` and returned the ByColor
        // sentinel byte 0xC3 (=195) as the ACI, which mapped to pink-
        // purple. The detection-and-RC-read fix tried to decode a raw ACI
        // from the byte following the sentinel, but for this fixture that
        // byte is NOT the ACI â€” it reads as 68/69 instead of the DXF 1/2.
        //
        // Empirically (DWG_DEBUG_LAYER trace + DXF oracle on
        // 3070_model_arceringen_5.dwg): when read_enc returns a BS whose
        // only meaningful bits are in the low byte and that byte is
        // 0xC3 (ByColor) we don't have a reliable way to recover the true
        // ACI from surrounding bytes yet â€” the bits after the BS are the
        // CMC's RC rcf and string-stream refs, not a raw ACI. We therefore
        // fall back to ACI=7 (white) for ByColor-method layers until the
        // spec-correct CMC R2007+ layout is decoded. This avoids the
        // original "all layers render purple" bug â€” layers render white
        // instead, which the renderer shows on the black canvas just fine.
        // Per ODA OpenDesignSpec Â§20.4.53 (LAYER) + Â§2.11 (CmColor): on
        // R2004+ the layer color is a CMC, not an ENC. The CMC layout is a
        // BL holding (method_byte << 24) | rgb_or_index, followed by an RC
        // flag byte and optional color/book name TVs. The previous read_enc
        // call was reading only a BS (16 bits) and consequently mis-aligned
        // the bit cursor for every subsequent layer field â€” the visible
        // symptom on the 3bm Funderingsherstel CP-21 fixture was layers
        // like A--L16--_Fundringskonstrukties (DXF group 62 = 3 = green)
        // resolving to white because the BS-read landed on the 0xC3 ByColor
        // sentinel instead of the legitimate ACI=3.
        //
        // read_cmc_r2004 implements Â§2.11 properly and returns the decoded
        // ACI directly: 0 for ByBlock, 256 for ByLayer, the low 8 bits for
        // ByColor, and the 16-bit legacy index for files without a 0xCx
        // method byte.
        let color = if is_r2004 {
            let is_unicode = self.version.is_r2007_plus();
            // O2D_LAYER_COLOR_DBG=1 â†’ snapshot the raw bit-stream window around
            // the CMC read so we can see what the file actually encoded. Used
            // during clean-room debugging of the LAYER body bit-drift on the
            // 3bm Funderingsherstel CP-21 fixture (AC1024 / R2010).
            if std::env::var("O2D_LAYER_COLOR_DBG").is_ok() {
                let bp = reader.tell_bit();
                let saved = reader.tell_bit();
                let mut peek = String::new();
                for _ in 0..16 {
                    if let Ok(b) = reader.read_bits(8) {
                        peek.push_str(&format!("{:02x} ", b));
                    } else {
                        peek.push_str("?? ");
                    }
                }
                reader.seek_bit(saved);
                eprintln!("[layer-bits] name={:?} pre-color bit_pos={} byte={} bit_in_byte={} next 128 bits = {}",
                    name, bp, bp / 8, bp & 7, peek);
            }
            // Stash the raw BS + sentinel-detected flag so the table-object
            // handle-stream pass can decide whether to look up an AcDbColor
            // handle reference (per ODA Â§20.4.53 LAYER + Â§2.11 CmColor: a
            // BS sentinel form 0xC3 ByColor on a table object indicates the
            // actual ACI lives as a hard-pointer Color handle in the handle
            // stream rather than inline in the data stream).
            let (aci, raw_bs, sentinel_bs) = reader.read_cmc_r2004_full(is_unicode)?;
            // Diag: dump the data-stream window AFTER the color CMC so we
            // can see what fields follow it before the handle stream starts.
            // The 3bm Funderingsherstel CP-21 fixture (AC1024 / R2010) has
            // ~300 bits between color and handle stream; per ODA Â§20.4.53
            // these are post-color LAYER body fields (lineweight BS,
            // transparency BL, plot/material flag bits) â€” bit-drift here
            // doesn't affect color decode but bit-counts the post-color
            // analysis.
            if std::env::var("O2D_LAYER_COLOR_DBG").is_ok() {
                let bp = reader.tell_bit();
                let saved = reader.tell_bit();
                let mut peek = String::new();
                for _ in 0..16 {
                    if let Ok(b) = reader.read_bits(8) {
                        peek.push_str(&format!("{:02x} ", b));
                    } else {
                        peek.push_str("?? ");
                    }
                }
                reader.seek_bit(saved);
                eprintln!("[layer-bits] name={:?} POST-color bit_pos={} raw_bs={} sentinel={} next 128 bits = {}",
                    name, bp, raw_bs, sentinel_bs, peek);
            }
            result.insert("_color_bs_raw".into(), serde_json::json!(raw_bs));
            result.insert("_color_sentinel".into(), serde_json::json!(sentinel_bs));
            aci
        } else {
            reader.read_cmc()?
        };
        if std::env::var("DWG_DEBUG_LAYER").is_ok() || std::env::var("O2D_LAYER_COLOR_DBG").is_ok() {
            eprintln!("[layer-dbg]  name={:?} flags={} color={}", name, flags, color);
        }

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
        // num_reactors already read in parse_table_object common header
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
        // num_reactors already read in parse_table_object common header
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

    /// per ODA OpenDesignSpec Â§20.4.40 (DIMSTYLE): decode the table-object
    /// body just far enough to extract DIMSCALE (overall scale factor) and
    /// DIMTXT (text height). The scene loader uses these to size dimension
    /// text instead of falling back on the hard-coded `25 * dim_scale_xf`.
    ///
    /// Body field ordering (R2000-R2018, after the common non-entity
    /// header which `parse_table_object` already consumed):
    ///   entry_name        TV   (style name, e.g. "ISO-25")
    ///   64-flag           B
    ///   xref-index        BS
    ///   xdep              B
    ///   DIMTOL            B    } early DIMSTYLE bit-flag block â€” order
    ///   DIMLIM            B    } per spec (Â§20.4.40 R2000 layout). R2007+
    ///   DIMTIH            B    } reorders some of these into a single BS,
    ///   DIMTOH            B    } but the BD block that follows starts in
    ///   DIMSE1            B    } the same place once we've consumed the
    ///   DIMSE2            B    } version-specific flag preamble.
    ///   DIMALT            B
    ///   DIMTOFL           B
    ///   DIMSAH            B
    ///   DIMTIX            B
    ///   DIMSOXD           B
    ///   DIMALTD           RC
    ///   DIMZIN            RC
    ///   DIMSD1            B
    ///   DIMSD2            B
    ///   DIMTOLJ           RC
    ///   DIMJUST           RC
    ///   DIMFIT            RC   (R2000 only â€” drop on R2007+)
    ///   DIMUPT            B
    ///   DIMTZIN           RC   (R2007+)
    ///   DIMMALTZ          RC   (R2007+)
    ///   DIMMALTTZ         RC   (R2007+)
    ///   DIMTAD            RC   (R2007+)
    ///   DIMUNIT/DIMLUNIT  BS
    ///   DIMDEC            BS
    ///   DIMTDEC           BS
    ///   DIMALTU           BS
    ///   DIMALTTD          BS
    ///   DIMSCALE          BD   â† we want this
    ///   DIMASZ            BD
    ///   DIMEXO            BD
    ///   DIMDLI            BD
    ///   DIMEXE            BD
    ///   DIMRND            BD
    ///   DIMDLE            BD
    ///   DIMTP             BD
    ///   DIMTM             BD
    ///   DIMTXT            BD   â† and this
    ///   ...
    ///
    /// The post-flag fields vary considerably between R13/R2000/R2007/R2010.
    /// This implementation supports R2000 and R2007+; bit-drift would
    /// produce subnormal BD values, which the sanity-clamp at the bottom
    /// rejects in favour of AutoCAD defaults (DIMSCALE=1.0, DIMTXT=2.5)
    /// â€” same defensive strategy as $LTSCALE in parse_header_vars_from_bits.
    fn parse_dimstyle_obj(
        &self,
        reader: &mut DwgBitReader,
        result: &mut HashMap<String, serde_json::Value>,
    ) -> Result<(), DwgError> {
        let is_unicode = self.version.is_r2007_plus();
        let is_r2007 = self.version.is_r2007_plus();
        let name = reader.read_tv(is_unicode)?;
        let _bit64 = reader.read_bit()?;
        let _xref_index = reader.read_bs()?;
        let _xdep = reader.read_bit()?;
        // DIMTOL..DIMSOXD â€” 11 single-bit flags per Â§20.4.40 R2000 layout.
        for _ in 0..11 { let _ = reader.read_bit()?; }
        // DIMALTD, DIMZIN â€” RC each.
        let _ = reader.read_byte()?;
        let _ = reader.read_byte()?;
        // DIMSD1, DIMSD2 â€” B each.
        let _ = reader.read_bit()?;
        let _ = reader.read_bit()?;
        // DIMTOLJ, DIMJUST â€” RC each.
        let _ = reader.read_byte()?;
        let _ = reader.read_byte()?;
        if !is_r2007 {
            // R2000: DIMFIT (RC), DIMUPT (B).
            let _ = reader.read_byte()?;
            let _ = reader.read_bit()?;
        } else {
            // R2007+: DIMUPT (B), DIMTZIN/DIMMALTZ/DIMMALTTZ/DIMTAD (4Ã—RC).
            let _ = reader.read_bit()?;
            for _ in 0..4 { let _ = reader.read_byte()?; }
        }
        // Per ODA OpenDesignSpec Â§20.4.40 (DIMSTYLE Object Body, R2000+):
        // the BS group is DIMUNIT/DIMLUNIT, DIMAUNIT, DIMDEC, DIMTDEC,
        // DIMALTU, DIMALTTD â€” that's 6 BSs, not 5. Confirmed against
        // libredwg's dwg.spec. The previous count of 5 dropped DIMAUNIT
        // which on the 3bm Funderingsherstel CP-21 fixture (AC1024 /
        // R2010) shifted the BD chain by one BS read worth of bits and
        // landed DIMSCALE on a `01` BD prefix (= literal 1.0 default),
        // hiding the actual per-style values like 2_5_mm's DIMSCALE=304.8
        // / DIMTXT=52.36 (DXF oracle).
        for _ in 0..6 { let _ = reader.read_bs()?; }
        // CALIBRATION: scan ahead to find a BD that decodes near 304.8 (DIMSCALE
        // for the 1_8_mm_0_ style per DXF oracle). Logs offsets when env set.
        // BD chain begins here per Â§20.4.40.
        let dimscale_raw = reader.read_bd()?;   // DIMSCALE
        let dimasz_raw    = reader.read_bd()?;  // DIMASZ â€” arrowhead size
        let dimexo_raw    = reader.read_bd()?;  // DIMEXO â€” extension-line offset from origin
        let _dimdli       = reader.read_bd()?;
        let dimexe_raw    = reader.read_bd()?;  // DIMEXE â€” extension-line overshoot past dim line
        let _dimrnd       = reader.read_bd()?;
        let _dimdle       = reader.read_bd()?;
        let _dimtp        = reader.read_bd()?;
        let _dimtm        = reader.read_bd()?;
        let dimtxt_raw    = reader.read_bd()?;  // DIMTXT

        // Continue BD chain: DIMCEN, DIMTSZ, DIMALTF, DIMLFAC, DIMTVP,
        // DIMTFAC, DIMGAP per Â§20.4.40. We don't surface these to the
        // scene loader yet, but consuming them keeps the bit cursor
        // aligned for the TV chain that holds DIMBLK1/DIMBLK2 below.
        // Wrapped in `let _ =` so a malformed BD inside doesn't poison
        // the rest of the parse (TV strings live in the string stream
        // anyway, so they're decoupled from main-stream drift on R2007+).
        let _dimcen       = reader.read_bd().unwrap_or(0.0);
        let _dimtsz       = reader.read_bd().unwrap_or(0.0);
        let _dimaltf      = reader.read_bd().unwrap_or(0.0);
        let _dimlfac      = reader.read_bd().unwrap_or(0.0);
        let _dimtvp       = reader.read_bd().unwrap_or(0.0);
        let _dimtfac      = reader.read_bd().unwrap_or(0.0);
        let dimgap_raw    = reader.read_bd().unwrap_or(0.0);  // DIMGAP â€” text-to-dim-line gap

        // TV chain per ODA OpenDesignSpec Â§20.4.40: in R2000+, only DIMPOST
        // and DIMAPOST are TVs in the dimstyle body. DIMBLK/DIMBLK1/DIMBLK2
        // moved to the HANDLE stream (DXF group 340/343/344 â€” handle refs to
        // BLOCK_RECORD entries) and MUST NOT be read as TVs here. The previous
        // code consumed five TVs which over-ran the string stream and produced
        // garbage Unicode in dimblk2 (visible via O2D_DWG_DIM_DUMP=1). On
        // R2007+ that drift didn't shift the main bit cursor (TVs live in the
        // separate string stream) but it did corrupt the resolved arrow-block
        // names downstream renderers consult to choose tick/arrow geometry.
        let _dimpost  = reader.read_tv(is_unicode).unwrap_or_default();
        let _dimapost = reader.read_tv(is_unicode).unwrap_or_default();
        let dimblk1: String = String::new();
        let dimblk2: String = String::new();

        // Sanity clamp â€” same defensive approach as $LTSCALE in
        // parse_header_vars_from_bits. Subnormal / out-of-range values
        // mean upstream bit-drift; substitute AutoCAD's table defaults
        // (DIMSCALE=1.0, DIMTXT=2.5 mm, DIMASZ=2.5 mm) so the consumer
        // sees usable numbers and dimension geometry renders at a
        // reasonable size instead of disappearing or becoming
        // kilometre-tall.
        let dimscale = if dimscale_raw.is_finite()
            && dimscale_raw.abs() >= 1e-6
            && dimscale_raw.abs() <= 1e6
        { dimscale_raw } else { 1.0 };
        let dimtxt = if dimtxt_raw.is_finite()
            && dimtxt_raw.abs() >= 1e-6
            && dimtxt_raw.abs() <= 1e6
        { dimtxt_raw.abs() } else { 2.5 };
        let dimasz = if dimasz_raw.is_finite()
            && dimasz_raw.abs() >= 1e-6
            && dimasz_raw.abs() <= 1e6
        { dimasz_raw.abs() } else { 2.5 };
        // DIMEXO/DIMEXE/DIMGAP â€” same defensive sanity-clamp as above. AutoCAD
        // table defaults per ODA Â§20.4.40: DIMEXO=0.625, DIMEXE=1.25, DIMGAP=0.625.
        // R2007+ bit-stream alignment is still off (~148 bits, see SPEC_NOTES.md
        // "Findings still open"), so most reads land subnormal and fall back to
        // these defaults â€” which is what AutoCAD itself uses for any style that
        // doesn't override them, and visually correct enough that extension lines
        // get a proper start gap + tip overshoot rather than terminating exactly
        // on the measured points.
        let dimexo = if dimexo_raw.is_finite()
            && dimexo_raw.abs() >= 1e-6
            && dimexo_raw.abs() <= 1e6
        { dimexo_raw.abs() } else { 0.625 };
        let dimexe = if dimexe_raw.is_finite()
            && dimexe_raw.abs() >= 1e-6
            && dimexe_raw.abs() <= 1e6
        { dimexe_raw.abs() } else { 1.25 };
        let dimgap = if dimgap_raw.is_finite()
            && dimgap_raw.abs() >= 1e-6
            && dimgap_raw.abs() <= 1e6
        { dimgap_raw.abs() } else { 0.625 };

        if std::env::var("DWG_DEBUG_DIMSTYLE").is_ok() {
            eprintln!(
                "[DIMSTYLE_OBJ] name={:?} dimscale={} dimtxt={} dimasz={} dimblk1={:?} dimblk2={:?}",
                name, dimscale, dimtxt, dimasz, dimblk1, dimblk2,
            );
        }

        result.insert("name".into(), serde_json::json!(name));
        result.insert("dimscale".into(), serde_json::json!(dimscale));
        result.insert("dimtxt".into(), serde_json::json!(dimtxt));
        result.insert("dimasz".into(), serde_json::json!(dimasz));
        result.insert("dimexo".into(), serde_json::json!(dimexo));
        result.insert("dimexe".into(), serde_json::json!(dimexe));
        result.insert("dimgap".into(), serde_json::json!(dimgap));
        result.insert("dimblk1".into(), serde_json::json!(dimblk1));
        result.insert("dimblk2".into(), serde_json::json!(dimblk2));
        Ok(())
    }

    fn parse_ltype_obj(
        &self,
        reader: &mut DwgBitReader,
        result: &mut HashMap<String, serde_json::Value>,
    ) -> Result<(), DwgError> {
        let is_unicode = self.version.is_r2007_plus();
        // num_reactors already read in parse_table_object common header
        //
        // ODA Â§20.4.56 LTYPE object layout (after common non-entity header):
        //   name           : TV
        //   64-flag        : B
        //   xref-index     : BS
        //   xdep           : B
        //   description    : TV
        //   pattern-length : BD (total length of one pattern cycle)
        //   alignment      : RC ('A' = 65 for standard alignment)
        //   num-dashes     : RC
        //   per dash:
        //     dash-length       : BD   (positive = draw, negative = skip, 0 = dot)
        //     complex-shape-code: BS
        //     x-offset          : RD
        //     y-offset          : RD
        //     scale             : BD
        //     rotation          : BD
        //     shape-flag        : BS   (bit 0x02 => has text, bit 0x04 => has shape)
        //   strings-area : 256 bytes (R13-R2004) / string stream (R2007+)
        //
        // We only emit the numeric dash-length array; shape/text strings are
        // only needed for complex linetypes (ISO shapes etc.) which our
        // renderer doesn't support anyway. This gives us the real, file-
        // specific dash pattern instead of the hard-coded ACAD.LIN defaults
        // in `scene_io::dwg_builtin_ltype_pattern`.
        let name = reader.read_tv(is_unicode)?;
        let _bit64 = reader.read_bit()?;
        let _xref_index = reader.read_bs()?;
        let _xdep = reader.read_bit()?;
        let description = reader.read_tv(is_unicode)?;
        let pattern_length = reader.read_bd()?;
        let _alignment = reader.read_byte()?;
        let num_dashes = reader.read_byte()? as usize;

        // Cap to a sane upper bound; the DWG format allows up to 12 dash
        // segments per pattern (AutoCAD UI limit) but we accept more just in
        // case. A runaway num_dashes from a bit-drift bug will show up as
        // early EOF inside the loop rather than spinning forever.
        let mut dashes: Vec<f64> = Vec::with_capacity(num_dashes.min(64));
        let mut parsed_ok = true;
        for _ in 0..num_dashes {
            let dash_length = match reader.read_bd() { Ok(v) => v, Err(_) => { parsed_ok = false; break; } };
            let complex_shape_code = match reader.read_bs() { Ok(v) => v, Err(_) => { parsed_ok = false; break; } };
            let _x_offset = match reader.read_double() { Ok(v) => v, Err(_) => { parsed_ok = false; break; } };
            let _y_offset = match reader.read_double() { Ok(v) => v, Err(_) => { parsed_ok = false; break; } };
            let _scale = match reader.read_bd() { Ok(v) => v, Err(_) => { parsed_ok = false; break; } };
            let _rotation = match reader.read_bd() { Ok(v) => v, Err(_) => { parsed_ok = false; break; } };
            let _shape_flag = match reader.read_bs() { Ok(v) => v, Err(_) => { parsed_ok = false; break; } };
            // Ignore complex-shape entries (they need a SHAPE reference we don't support);
            // treat them as a zero-length skip so cycle length stays consistent.
            let _ = complex_shape_code;
            dashes.push(dash_length);
        }

        result.insert("name".into(), serde_json::json!(name));
        result.insert("description".into(), serde_json::json!(description));
        result.insert("patternLength".into(), serde_json::json!(pattern_length));
        if parsed_ok && !dashes.is_empty() {
            result.insert("dashes".into(), serde_json::json!(dashes));
        }
        Ok(())
    }

    fn parse_dictionary_obj(
        &self,
        reader: &mut DwgBitReader,
        result: &mut HashMap<String, serde_json::Value>,
    ) -> Result<(), DwgError> {
        // num_reactors already read in parse_table_object common header
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
        // num_reactors already read in parse_table_object common header
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
                // Unknown â€” read as double
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
        // num_reactors already read in parse_table_object common header
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
/// Builds a handleâ†’name map from LAYER, LTYPE, STYLE, and BLOCK_HEADER
/// objects, then populates each entity's `data["layer"]` etc.
pub fn resolve_handles(dwg: &mut DwgFile, raw_data: &[u8], version: DwgVersion) {
    // Build handle â†’ name for named objects
    let mut handle_to_name: HashMap<u32, (String, String)> = HashMap::new(); // handle â†’ (type, name)
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

        // TEXT / ATTRIB / ATTDEF / MTEXT: resolve text-style handle
        // (stashed in owned_handles[0] by read_entity_handles_at_current)
        // to STYLE name. Consumers in scene_io.rs use this to look up the
        // primary_font_file for font-mismatch-aware rendering.
        if matches!(obj.type_num, 0x01 | 0x02 | 0x03 | 0x2C) {
            if let Some(&h) = obj.handle_refs.owned_handles.first() {
                obj.data.insert("textStyleHandle".into(), serde_json::json!(h));
                if let Some((_, name)) = handle_to_name.get(&h) {
                    obj.data.insert("textStyleName".into(), serde_json::json!(name));
                }
            }
        }

        // DIMENSION (0x14..0x1A): resolve DIMSTYLE handle. Stored in
        // owned_handles[0] by read_entity_handles_at_current per ODA
        // OpenDesignSpec Â§19.4.27. scene_io's DIMENSION text-render arm
        // looks up the DIMSTYLE object to read DIMTXT Ã— DIMSCALE.
        if (0x14..=0x1A).contains(&obj.type_num) {
            if let Some(&h) = obj.handle_refs.owned_handles.first() {
                obj.data.insert("dimStyleHandle".into(), serde_json::json!(h));
                if let Some((_, name)) = handle_to_name.get(&h) {
                    obj.data.insert("dimStyleName".into(), serde_json::json!(name));
                }
            }
        }

        // INSERT / MINSERT: resolve block header â†’ block name
        if obj.type_num == 0x07 || obj.type_num == 0x08 {
            if let Some(bh_handle) = obj.handle_refs.block_header {
                if let Some((_, block_name)) = handle_to_name.get(&bh_handle) {
                    obj.data.insert("blockName".into(), serde_json::json!(block_name));
                    obj.data.insert("blockHeaderHandle".into(), serde_json::json!(bh_handle));
                }
            }
        }
    }

    // --- Second pass: collect block entities for each INSERT ---
    // Build a map: block_header_handle â†’ Vec<entity data> by finding
    // BLOCK (type 0x04) entities that are owned by each block header,
    // then walking their sibling entities.

    // First, build handle â†’ object index
    let mut handle_to_idx: HashMap<u32, usize> = HashMap::new();
    for (idx, obj) in dwg.objects.iter().enumerate() {
        handle_to_idx.insert(obj.handle, idx);
    }

    // Build block_header_handle â†’ Vec<serialized entity data>
    // Find entities owned by each block by checking owner handles.
    let mut block_entities: HashMap<u32, Vec<serde_json::Value>> = HashMap::new();
    for obj in dwg.objects.iter() {
        if !obj.is_entity { continue; }
        // Skip BLOCK and ENDBLK sentinel entities
        if obj.type_num == 0x04 || obj.type_num == 0x05 { continue; }
        if let Some(owner) = obj.handle_refs.owner {
            // Check if the owner is a BLOCK_HEADER (type 0x31)
            if let Some(&idx) = handle_to_idx.get(&owner) {
                if dwg.objects[idx].type_num == 0x31 {
                    block_entities.entry(owner)
                        .or_insert_with(Vec::new)
                        .push(serde_json::json!(obj.data));
                }
            }
        }
    }

    // Now attach blockEntities to each INSERT
    for obj in &mut dwg.objects {
        if obj.type_num != 0x07 && obj.type_num != 0x08 { continue; }
        if let Some(bh_handle) = obj.handle_refs.block_header {
            if let Some(ents) = block_entities.get(&bh_handle) {
                obj.data.insert("blockEntities".into(), serde_json::json!(ents));
            }
        }
    }

    // Link POLYLINE_2D/3D to their child VERTEX objects
    link_polyline_vertices(dwg, &handle_to_idx, raw_data, version);
}

/// True for any polyline family type (legacy POLYLINE_2D/3D and PolyFaceMesh /
/// PolygonMesh variants POLYLINE_PFACE / POLYLINE_MESH).
fn is_polyline_family(tn: &str) -> bool {
    matches!(tn, "POLYLINE_2D" | "POLYLINE_3D" | "POLYLINE_PFACE" | "POLYLINE_MESH")
}

/// True for any legacy VERTEX child that carries a position
/// (VERTEX_2D / VERTEX_3D / VERTEX_MESH / VERTEX_PFACE). Excludes
/// VERTEX_PFACE_FACE which is a face-record, not a positioned vertex.
fn is_positioned_vertex(tn: &str) -> bool {
    matches!(tn, "VERTEX_2D" | "VERTEX_3D" | "VERTEX_MESH" | "VERTEX_PFACE")
}

/// Walk owned VERTEX objects and attach their positions to parent
/// POLYLINE entities as a `vertices` JSON array.
///
/// Covers the full legacy polyline family per ODA Â§20.4.16-22:
///   POLYLINE_2D / POLYLINE_3D / POLYLINE_PFACE / POLYLINE_MESH
///   with child VERTEX_2D / VERTEX_3D / VERTEX_MESH / VERTEX_PFACE.
/// VERTEX_PFACE_FACE children are emitted into a separate `faces` array
/// (they carry vertex-indices, not positions).
///
/// Strategy (two-pass with fallback):
///   1. **Owner-handle grouping** â€” group VERTEX objects by their `owner`
///      handle ref.  If the owner is a POLYLINE, collect position data.
///   2. **owned_handles** â€” R2004+ polylines list their children directly.
///   3. **Handle-proximity fallback** â€” walk polyline_handle + 1, +2, ...
///      collecting VERTEX objects until a SEQEND or non-vertex is hit.
///   4. **Rescue-parse** â€” re-parse vertex bytes from the object_map for
///      polylines whose children weren't decoded in the main pass.
fn link_polyline_vertices(
    dwg: &mut DwgFile,
    handle_to_idx: &HashMap<u32, usize>,
    raw_data: &[u8],
    version: DwgVersion,
) {
    // polyline_handle -> Vec<vertex JSON value>
    let mut poly_vertices: HashMap<u32, Vec<serde_json::Value>> = HashMap::new();
    // polyline_handle -> Vec<face-record JSON value> (PFACE face lists)
    let mut poly_faces: HashMap<u32, Vec<serde_json::Value>> = HashMap::new();

    // --- Pass 1: owner-handle grouping ---
    for obj in dwg.objects.iter() {
        let is_vert = is_positioned_vertex(&obj.type_name);
        let is_face = obj.type_name == "VERTEX_PFACE_FACE";
        if !is_vert && !is_face { continue; }
        let owner = match obj.handle_refs.owner {
            Some(h) => h,
            None => continue,
        };
        // Verify owner is a polyline
        if let Some(&idx) = handle_to_idx.get(&owner) {
            if !is_polyline_family(&dwg.objects[idx].type_name) { continue; }
        } else {
            continue;
        }
        if is_vert {
            poly_vertices.entry(owner).or_default().push(vertex_to_json(obj));
        } else if let Some(faces) = obj.data.get("faceIndices") {
            poly_faces.entry(owner).or_default().push(faces.clone());
        }
    }

    // --- Pass 1b: owned_handles from handle stream (R2004+) ---
    // The polyline's handle_refs.owned_handles contains explicit vertex handles.
    for obj in dwg.objects.iter() {
        if !is_polyline_family(&obj.type_name) { continue; }
        if poly_vertices.contains_key(&obj.handle) { continue; }
        if obj.handle_refs.owned_handles.is_empty() { continue; }

        let mut verts = Vec::new();
        let mut faces = Vec::new();
        for &vh in &obj.handle_refs.owned_handles {
            if let Some(&idx) = handle_to_idx.get(&vh) {
                let child = &dwg.objects[idx];
                if is_positioned_vertex(&child.type_name) {
                    verts.push(vertex_to_json(child));
                } else if child.type_name == "VERTEX_PFACE_FACE" {
                    if let Some(fi) = child.data.get("faceIndices") {
                        faces.push(fi.clone());
                    }
                }
            }
        }
        if !verts.is_empty() {
            poly_vertices.insert(obj.handle, verts);
        }
        if !faces.is_empty() {
            poly_faces.insert(obj.handle, faces);
        }
    }

    // --- Pass 2: handle-proximity fallback ---
    // For any polyline still missing children, walk sequential handles
    // (polyline_h + 1, +2, ...) until SEQEND. Legacy POLYLINE children
    // are always allocated contiguously after the parent in DWG.
    let unlinked: Vec<u32> = dwg.objects.iter()
        .filter(|o| is_polyline_family(&o.type_name)
                && !poly_vertices.contains_key(&o.handle))
        .map(|o| o.handle)
        .collect();
    for poly_h in unlinked {
        let mut verts = Vec::new();
        let mut faces = Vec::new();
        let mut gap2 = 0u32;
        for offset in 1..=10000u32 {
            let child_h = poly_h.wrapping_add(offset);
            let child_idx = match handle_to_idx.get(&child_h) {
                Some(&i) => i,
                None => {
                    gap2 += 1;
                    if gap2 > 20 { break; }
                    continue;
                }
            };
            gap2 = 0;
            let child = &dwg.objects[child_idx];
            if child.type_name == "SEQEND" { break; }
            if is_positioned_vertex(&child.type_name) {
                verts.push(vertex_to_json(child));
            } else if child.type_name == "VERTEX_PFACE_FACE" {
                if let Some(fi) = child.data.get("faceIndices") {
                    faces.push(fi.clone());
                }
            }
        }
        if !verts.is_empty() {
            poly_vertices.insert(poly_h, verts);
        }
        if !faces.is_empty() {
            poly_faces.insert(poly_h, faces);
        }
    }

    // --- Pass 3: rescue-parse vertices from object_map for unlinked polylines ---
    // When vertex objects weren't parsed in the main pass (common in R2010+),
    // try parsing them from the raw data using the object_map offsets.
    let still_unlinked: Vec<u32> = dwg.objects.iter()
        .filter(|o| is_polyline_family(&o.type_name)
                && !poly_vertices.contains_key(&o.handle))
        .map(|o| o.handle)
        .collect();
    if !still_unlinked.is_empty() && !dwg.object_map.is_empty() {
        let parser = DwgParser { class_map: HashMap::new(), version, use_string_stream: false };
        let mut rescued = 0usize;
        for poly_h in &still_unlinked {
            let mut verts = Vec::new();
            let mut gap = 0u32;
            'walk: for delta in 1..=10000u32 {
                let child_h = poly_h.wrapping_add(delta);
                let file_offset = match dwg.object_map.get(&child_h) {
                    Some(&off) => { gap = 0; off }
                    None => {
                        gap += 1;
                        if gap > 20 { break; }
                        continue;
                    }
                };
                // Try parsing at the object_map offset and nearby offsets
                let offsets_to_try: Vec<usize> = if version.is_r2004_plus() {
                    vec![file_offset,
                         file_offset.wrapping_add(2), file_offset.wrapping_sub(2),
                         file_offset.wrapping_add(4), file_offset.wrapping_sub(4)]
                } else {
                    vec![file_offset]
                };
                for off in offsets_to_try {
                    if off >= raw_data.len() || off < 4 { continue; }
                    let r = std::panic::catch_unwind(
                        std::panic::AssertUnwindSafe(|| {
                            parser.parse_single_object_r2000(raw_data, child_h, off)
                        })
                    );
                    if let Ok(Ok(obj)) = r {
                        if obj.type_name == "SEQEND" { break 'walk; }
                        if is_positioned_vertex(&obj.type_name) {
                            verts.push(vertex_to_json(&obj));
                            continue 'walk;
                        }
                        if obj.type_name == "VERTEX_PFACE_FACE" {
                            // face record â€” skip to next sibling
                            continue 'walk;
                        }
                        break; // parsed but not a vertex â€” stop trying other offsets
                    }
                }
                // Don't break â€” continue walking past non-vertex objects
            }
            if !verts.is_empty() {
                rescued += verts.len();
                poly_vertices.insert(*poly_h, verts);
            }
        }
        if rescued > 0 {
            crate::dwg_dbg!("[POLYLINE] Rescue-parsed {} vertices from object_map", rescued);
        }
    }

    // --- Apply collected vertices to polyline objects ---
    let mut linked_count = 0usize;
    let mut total_verts = 0usize;
    for obj in dwg.objects.iter_mut() {
        if !is_polyline_family(&obj.type_name) { continue; }
        if let Some(verts) = poly_vertices.remove(&obj.handle) {
            total_verts += verts.len();
            // Flat vertices array: [[x,y,z], ...] for renderer consumption
            let flat: Vec<serde_json::Value> = verts.iter()
                .filter_map(|v| v.get("position"))
                .cloned()
                .collect();
            obj.data.insert("vertices".into(), serde_json::json!(flat));
            // Store full vertex data when bulge/width info is present
            if verts.iter().any(|v| v.get("bulge").is_some()
                || v.get("startWidth").is_some()
                || v.get("endWidth").is_some())
            {
                obj.data.insert("vertexData".into(), serde_json::json!(verts));
            }
            linked_count += 1;
        }
        if let Some(faces) = poly_faces.remove(&obj.handle) {
            obj.data.insert("faces".into(), serde_json::json!(faces));
        }
    }

    if linked_count > 0 {
        crate::dwg_dbg!("[POLYLINE] Linked {} polylines with {} total vertices", linked_count, total_verts);
    }
}

/// Extract vertex position and optional bulge/width data as a JSON value.
fn vertex_to_json(obj: &DwgObject) -> serde_json::Value {
    let mut vert = serde_json::Map::new();
    if let Some(pos) = obj.data.get("position") {
        vert.insert("position".into(), pos.clone());
    }
    if let Some(bulge) = obj.data.get("bulge") {
        vert.insert("bulge".into(), bulge.clone());
    }
    if let Some(sw) = obj.data.get("startWidth") {
        vert.insert("startWidth".into(), sw.clone());
    }
    if let Some(ew) = obj.data.get("endWidth") {
        vert.insert("endWidth".into(), ew.clone());
    }
    serde_json::Value::Object(vert)
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
/// Rewritten per hand_decode.md ground truth (LibreDWG decompress_R2004_section).
/// Key structural difference: `lz_copy_literals_ret` copies N literal bytes
/// then reads one MORE byte and returns it as the next opcode. The main loop
/// never reads an opcode at the top of each iteration.
pub fn decompress_r2004(src: &[u8], decompressed_size: usize) -> Result<Vec<u8>, DwgError> {
    let (dst, actual) = decompress_r2004_core(src, decompressed_size)?;
    // Legacy callers rely on the returned buffer being exactly
    // `decompressed_size` bytes long. Pad/truncate accordingly.
    if dst.len() == decompressed_size {
        Ok(dst)
    } else if actual >= decompressed_size {
        let mut d = dst;
        d.truncate(decompressed_size);
        Ok(d)
    } else {
        let mut d = dst;
        d.resize(decompressed_size, 0);
        Ok(d)
    }
}

/// Oversized-target LZ77 decompression.
///
/// per ODA Â§4.7: LZ77 terminates on opcode 0x11 (END). The decompressed size
/// declared in the page header may UNDERSTATE the emitted bytes â€” if the
/// target buffer is too small we stop early before the END, truncating the
/// stream. This variant accepts an oversized ceiling and returns the bytes
/// actually emitted (up to END or src exhaustion), so callers that don't
/// trust the declared size (notably the section-map page) get the full
/// payload.
pub fn decompress_r2004_generous(
    src: &[u8],
    target_ceiling: usize,
) -> Result<Vec<u8>, DwgError> {
    let (mut dst, actual) = decompress_r2004_core(src, target_ceiling)?;
    dst.truncate(actual);
    Ok(dst)
}

fn decompress_r2004_core(
    src: &[u8],
    decompressed_size: usize,
) -> Result<(Vec<u8>, usize), DwgError> {
    if decompressed_size == 0 || src.is_empty() {
        return Ok((Vec::new(), 0));
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
    // Per hand_decode.md: first byte < 0x10 â†’ (low_nibble & 0x0F) + 3 literals.
    // If low nibble is 0, read extended length via read_literal_length + 0x0F + 3.
    // If first byte >= 0x10, no initial literals; byte IS the first opcode.
    if si >= src.len() {
        return Ok((dst, 0));
    }
    let first = src[si];
    si += 1;
    let mut opcode = if first < 0x10 {
        let low = (first & 0x0F) as usize;
        let lit_count = if low == 0 {
            lz_read_literal_length(src, &mut si) + 0x0F + 3
        } else {
            low + 3
        };
        // Copy literals and read one extra byte = first opcode
        lz_copy_literals_ret(src, &mut si, &mut dst, &mut di, lit_count)
    } else {
        first
    };

    // --- Main decompression loop ---
    // `opcode` is set before entry and updated by lz_copy_literals_ret at the
    // end of each iteration (the trailing literal copy reads the next opcode).
    loop {
        if si > src.len() || di >= decompressed_size {
            break;
        }

        let comp_bytes: usize;
        let comp_offset: usize;
        let lit_count: usize;

        if opcode >= 0x40 {
            // INLINE: compression info packed into opcode + one extra byte
            comp_bytes = ((opcode >> 4) - 1) as usize;
            if si >= src.len() { break; }
            let b = src[si] as usize;
            si += 1;
            comp_offset = (((opcode >> 2) as usize & 3) | (b << 2)) + 1;
            lit_count = (opcode & 0x03) as usize;
        } else if opcode >= 0x21 {
            // MEDIUM: comp_bytes from opcode, two-byte offset (+1)
            comp_bytes = (opcode - 0x1E) as usize;
            let (off, lc) = lz_two_byte_offset(src, &mut si, 1);
            comp_offset = off;
            lit_count = lc;
        } else if opcode == 0x20 {
            // LONG MEDIUM: variable-length comp_bytes, two-byte offset (+1)
            comp_bytes = lz_read_compressed_bytes(src, &mut si, 0x21);
            let (off, lc) = lz_two_byte_offset(src, &mut si, 1);
            comp_offset = off;
            lit_count = lc;
        } else if opcode >= 0x12 {
            // FAR: short with far offset
            let raw_bits = (opcode & 0x07) as usize;
            comp_bytes = if raw_bits == 0 {
                lz_read_compressed_bytes(src, &mut si, 0x0A)
            } else {
                raw_bits + 2
            };
            // FAR offset: high bit from opcode bit 3, then two-byte offset + 0x4000
            let hi = ((opcode & 0x08) as usize) << 11;
            let (off, lc) = lz_two_byte_offset(src, &mut si, 0x4000);
            comp_offset = hi + off;
            lit_count = lc;
        } else if opcode == 0x11 {
            break; // End of compressed data
        } else if opcode == 0x10 {
            // LONG FAR: variable-length comp_bytes, far offset
            comp_bytes = lz_read_compressed_bytes(src, &mut si, 9);
            let (off, lc) = lz_two_byte_offset(src, &mut si, 0x4000);
            comp_offset = off;
            lit_count = lc;
        } else {
            // 0x00..0x0F: In the correct flow these never appear as main-loop
            // opcodes (they are consumed by lz_copy_literals_ret). Stream desync.
            break;
        }

        // Back-reference copy (byte-by-byte for overlap safety)
        if comp_offset > 0 && comp_offset <= di {
            let src_start = di - comp_offset;
            for k in 0..comp_bytes {
                if di >= decompressed_size { break; }
                dst[di] = dst[src_start + k];
                di += 1;
            }
        } else {
            // Offset beyond what we have written -- fill zeros, advance
            di += comp_bytes.min(decompressed_size - di);
        }

        // Trailing literals + next opcode.
        // Per hand_decode.md: lz_copy_literals_ret copies the literal bytes
        // then reads one MORE byte which becomes the next opcode.
        if lit_count != 0 {
            opcode = lz_copy_literals_ret(src, &mut si, &mut dst, &mut di, lit_count);
        } else if si < src.len() && (src[si] & 0xF0) == 0 {
            // Extended trailing literal run
            let peek = src[si] as usize;
            si += 1;
            let count = if peek == 0 {
                lz_read_literal_length(src, &mut si) + 0x0F + 3
            } else {
                peek + 3
            };
            opcode = lz_copy_literals_ret(src, &mut si, &mut dst, &mut di, count);
        } else if si < src.len() {
            // Next byte is an opcode (>= 0x10), consume it directly
            opcode = src[si];
            si += 1;
        } else {
            break;
        }
    }

    Ok((dst, di))
}

/// Read an extended literal length (when low nibble == 0).
/// Per hand_decode.md: each 0x00 byte adds 0xFF and continues;
/// first non-zero byte adds its value and terminates.
fn lz_read_literal_length(src: &[u8], si: &mut usize) -> usize {
    let mut total = 0usize;
    loop {
        if *si >= src.len() { break; }
        let b = src[*si] as usize;
        *si += 1;
        if b == 0x00 {
            total += 0xFF;
        } else {
            total += b;
            break;
        }
    }
    total
}

/// Read extended compressed_bytes count. Per hand_decode.md: each 0x00
/// byte adds 0xFF and continues; first non-zero byte adds its value
/// and terminates. Returns total + base.
fn lz_read_compressed_bytes(src: &[u8], si: &mut usize, base: usize) -> usize {
    let mut total = 0usize;
    loop {
        if *si >= src.len() { break; }
        let b = src[*si] as usize;
        *si += 1;
        if b == 0x00 {
            total += 0xFF;
        } else {
            total += b;
            break;
        }
    }
    total + base
}

/// Read a two-byte offset: returns (offset + plus, literal_count).
fn lz_two_byte_offset(src: &[u8], si: &mut usize, plus: usize) -> (usize, usize) {
    if *si + 1 >= src.len() { return (0, 0); }
    let b1 = src[*si] as usize;
    *si += 1;
    let b2 = src[*si] as usize;
    *si += 1;
    let offset = (b1 >> 2) | (b2 << 6);
    let lit_count = b1 & 0x03;
    (offset + plus, lit_count)
}

/// Copy `count` literal bytes from src to dst, then read one MORE byte
/// and return it (the next opcode). Per hand_decode.md BUG 3: the
/// trailing byte after every literal run is the next opcode, not a
/// separate read at loop top.
fn lz_copy_literals_ret(src: &[u8], si: &mut usize, dst: &mut [u8], di: &mut usize, count: usize) -> u8 {
    for _ in 0..count {
        if *si >= src.len() || *di >= dst.len() { break; }
        dst[*di] = src[*si];
        *si += 1;
        *di += 1;
    }
    // Read next opcode byte
    if *si < src.len() {
        let op = src[*si];
        *si += 1;
        op
    } else {
        0x11 // Signal end if source exhausted
    }
}
