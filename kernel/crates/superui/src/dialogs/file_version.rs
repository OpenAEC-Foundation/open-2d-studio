//! Fast CAD-version detection without a full file parse.
//!
//! For the in-app file picker we only need a small badge per tile — so
//! we read just enough bytes to identify the format generation:
//!
//! * **DWG** — first 6 ASCII bytes ("AC10xx") map to a release name.
//! * **DXF** — scan the first ~200 lines for `$ACADVER` (group code 9
//!   followed by group code 1 + the AC10xx string).
//! * **IFCDraw** — our own zstd+msgpack format; we only emit "IFCDraw"
//!   since there's no externally meaningful sub-version yet.
//!
//! Designed to never read more than ~16 KiB and never block longer than
//! a single sequential file read. Errors collapse to "Unknown".
//!
//! No external dependencies — pure std.

use std::fs::File;
use std::io::{BufRead, BufReader, Read};
use std::path::Path;

/// Best-effort CAD version label for a file. Returns "Unknown" on any
/// unsupported header, I/O error, or malformed file.
///
/// The result is intended for display in a small badge — keep it short
/// (< ~10 chars) so it fits a 200×200 tile corner.
pub fn detect_version<P: AsRef<Path>>(path: P) -> String {
    let path = path.as_ref();
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .map(|s| s.to_ascii_lowercase())
        .unwrap_or_default();

    match ext.as_str() {
        "dwg" => detect_dwg_version(path).unwrap_or_else(|| "Unknown".to_string()),
        "dxf" => detect_dxf_version(path).unwrap_or_else(|| "Unknown".to_string()),
        "ifcdraw" => "IFCDraw".to_string(),
        _ => "Unknown".to_string(),
    }
}

/// DWG: read the first 6 bytes — "AC1024" / "AC1027" / etc. — and map to
/// the marketing-release name AutoCAD uses publicly. Anything else is
/// reported verbatim ("AC1xxx") so unknown future releases still show
/// something useful.
fn detect_dwg_version(path: &Path) -> Option<String> {
    let mut file = File::open(path).ok()?;
    let mut head = [0u8; 6];
    file.read_exact(&mut head).ok()?;
    let sig = std::str::from_utf8(&head).ok()?;
    Some(match sig {
        "AC1009" => "R12".to_string(),
        "AC1014" => "R14".to_string(),
        "AC1015" => "R2000".to_string(),
        "AC1018" => "R2004".to_string(),
        "AC1021" => "R2007".to_string(),
        "AC1024" => "R2010".to_string(),
        "AC1027" => "R2013".to_string(),
        "AC1032" => "R2018".to_string(),
        other if other.starts_with("AC10") => other.to_string(),
        _ => return None,
    })
}

/// DXF: scan up to ~200 lines for `$ACADVER`. Layout is:
///   9
///   $ACADVER
///   1
///   AC1027
/// We surface the AC10xx code with a "DXF " prefix so the badge is
/// distinguishable from DWG ("DXF AC1027").
fn detect_dxf_version(path: &Path) -> Option<String> {
    let file = File::open(path).ok()?;
    let mut reader = BufReader::new(file);
    let mut buf = String::new();
    let mut line_no = 0u32;
    let mut saw_acadver = false;
    let mut saw_group_1 = false;
    while line_no < 400 {
        buf.clear();
        let n = reader.read_line(&mut buf).ok()?;
        if n == 0 {
            return None;
        }
        line_no += 1;
        let trimmed = buf.trim();
        if !saw_acadver {
            if trimmed == "$ACADVER" {
                saw_acadver = true;
            }
            continue;
        }
        // After $ACADVER we expect a "1" group code line then the value.
        if !saw_group_1 {
            if trimmed == "1" {
                saw_group_1 = true;
            }
            continue;
        }
        if trimmed.starts_with("AC") {
            return Some(format!("DXF {}", trimmed));
        }
        return None;
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unknown_extension_yields_unknown() {
        assert_eq!(detect_version("foo.txt"), "Unknown");
    }
}
