//! ifcdraw_bench — benchmark IFCDraw file-size vs. the source DWG/DXF.
//!
//! Loads a single DWG/DXF through the shared `scene_io` pipeline, calls
//! `write_ifcx_binary`, writes the IFCDraw blob next to (or where told),
//! and prints a single JSON line with the bench measurements.
//!
//! Used by `scripts/bench_ifcdraw_size.ps1` to roll the per-file results
//! into a markdown table. JSON output keeps the script trivial: a
//! one-liner per file, no fragile text-parsing.
//!
//! Usage:
//!   ifcdraw-bench <path.dwg|.dxf> [out.ifcdraw]
//!
//! On error: exits non-zero and emits a JSON object with an `error` key
//! so the wrapper script can still report partial results.

use std::path::{Path, PathBuf};
use std::time::Instant;

use kernel_app::ifcx_export::{read_ifcx_binary, write_ifcx_binary};
use kernel_app::scene_io::{load_dwg, load_dxf};

fn emit_err(name: &str, src: &str, src_bytes: u64, msg: &str) -> ! {
    // Single-line JSON so the wrapping script does line-based parse.
    println!(
        "{{\"name\":\"{}\",\"src\":\"{}\",\"src_bytes\":{},\"error\":\"{}\"}}",
        escape_json(name),
        escape_json(src),
        src_bytes,
        escape_json(msg)
    );
    std::process::exit(1);
}

fn escape_json(s: &str) -> String {
    let mut out = String::with_capacity(s.len() + 4);
    for ch in s.chars() {
        match ch {
            '\\' => out.push_str("\\\\"),
            '"' => out.push_str("\\\""),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            c if (c as u32) < 0x20 => out.push_str(&format!("\\u{:04x}", c as u32)),
            c => out.push(c),
        }
    }
    out
}

fn main() {
    let mut args = std::env::args().skip(1);
    let src = match args.next() {
        Some(s) => s,
        None => {
            eprintln!("usage: ifcdraw-bench <path.dwg|.dxf> [out.ifcdraw]");
            std::process::exit(2);
        }
    };

    let name = Path::new(&src)
        .file_name()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_else(|| src.clone());

    let out: PathBuf = match args.next() {
        Some(s) => PathBuf::from(s),
        None => Path::new(&src).with_extension("ifcdraw"),
    };

    let src_bytes = std::fs::metadata(&src).map(|m| m.len()).unwrap_or(0);
    let ext = Path::new(&src)
        .extension()
        .map(|e| e.to_string_lossy().to_lowercase())
        .unwrap_or_default();

    let t_load = Instant::now();
    let scene = match ext.as_str() {
        "dxf" => match load_dxf(&src) {
            Ok(s) => s,
            Err(e) => emit_err(&name, &src, src_bytes, &format!("load_dxf: {e}")),
        },
        "dwg" => match load_dwg(&src) {
            Ok(s) => s,
            Err(e) => emit_err(&name, &src, src_bytes, &format!("load_dwg: {e}")),
        },
        other => emit_err(&name, &src, src_bytes, &format!("unsupported ext: {other}")),
    };
    let parse_ms = t_load.elapsed().as_millis() as u64;

    let n_segs = scene.segments.len();
    let n_tris = scene.triangles.len();
    let n_layers = scene.layer_names.len();
    let n_entities = scene.entity_names.len();

    let t_enc = Instant::now();
    let blob = match write_ifcx_binary(&scene, Some(&src)) {
        Ok(b) => b,
        Err(e) => emit_err(&name, &src, src_bytes, &format!("write_ifcx_binary: {e}")),
    };
    let save_ms = t_enc.elapsed().as_millis() as u64;

    // Optional sanity: decompress + re-read so we don't ship a regression
    // that emits unreadable blobs.
    let t_rd = Instant::now();
    let roundtrip_ok = read_ifcx_binary(&blob).is_ok();
    let read_ms = t_rd.elapsed().as_millis() as u64;

    if let Err(e) = std::fs::write(&out, &blob) {
        emit_err(&name, &src, src_bytes, &format!("write {}: {e}", out.display()));
    }

    let out_bytes = blob.len() as u64;
    let ratio = if src_bytes > 0 {
        out_bytes as f64 / src_bytes as f64
    } else {
        0.0
    };

    // Single JSON line, no pretty-print so PowerShell's line reader picks
    // exactly one record per ifcdraw-bench invocation.
    println!(
        "{{\"name\":\"{name}\",\"src\":\"{src}\",\"out\":\"{out}\",\"src_bytes\":{src_bytes},\"ifcdraw_bytes\":{out_bytes},\"ratio\":{ratio:.5},\"n_segs\":{n_segs},\"n_tris\":{n_tris},\"n_layers\":{n_layers},\"n_entities\":{n_entities},\"parse_ms\":{parse_ms},\"save_ms\":{save_ms},\"read_ms\":{read_ms},\"roundtrip_ok\":{roundtrip_ok}}}",
        name = escape_json(&name),
        src = escape_json(&src),
        out = escape_json(&out.display().to_string()),
        src_bytes = src_bytes,
        out_bytes = out_bytes,
        ratio = ratio,
        n_segs = n_segs,
        n_tris = n_tris,
        n_layers = n_layers,
        n_entities = n_entities,
        parse_ms = parse_ms,
        save_ms = save_ms,
        read_ms = read_ms,
        roundtrip_ok = roundtrip_ok,
    );
}
