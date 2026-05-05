//! ifcx_size_check — load a DWG/DXF through the shared `scene_io`
//! pipeline, run the IFCX-binary exporter, and print the size ratio
//! vs. the source file. Used to validate the "IFC 2D B" blob is
//! smaller than the source DWG, per the user's acceptance criterion.
//!
//! Usage: ifcx-size-check <path.dwg|.dxf> [out.ifcdraw]

use std::path::{Path, PathBuf};

use kernel_app::ifcx_export::write_ifcx_binary;
use kernel_app::scene_io::{load_dwg, load_dxf};

fn main() {
    let mut args = std::env::args().skip(1);
    let src = match args.next() {
        Some(s) => s,
        None => {
            eprintln!("usage: ifcx-size-check <path.dwg|.dxf> [out.ifcdraw]");
            std::process::exit(2);
        }
    };
    let out: PathBuf = match args.next() {
        Some(s) => PathBuf::from(s),
        None => {
            let p = Path::new(&src);
            p.with_extension("ifcdraw")
        }
    };

    let src_bytes = std::fs::metadata(&src).map(|m| m.len()).unwrap_or(0);
    let ext = Path::new(&src)
        .extension()
        .map(|e| e.to_string_lossy().to_lowercase())
        .unwrap_or_default();

    let t_load = std::time::Instant::now();
    let scene = match ext.as_str() {
        "dxf" => load_dxf(&src).unwrap_or_else(|e| {
            eprintln!("load_dxf failed: {e}");
            std::process::exit(1);
        }),
        "dwg" => load_dwg(&src).unwrap_or_else(|e| {
            eprintln!("load_dwg failed: {e}");
            std::process::exit(1);
        }),
        other => {
            eprintln!("unsupported extension: {other}");
            std::process::exit(2);
        }
    };
    let dt_load = t_load.elapsed().as_millis();
    eprintln!(
        "loaded {} segments, {} triangles, {} layers in {} ms",
        scene.segments.len(),
        scene.triangles.len(),
        scene.layer_names.len(),
        dt_load,
    );

    let t_enc = std::time::Instant::now();
    let blob = write_ifcx_binary(&scene, Some(&src)).unwrap_or_else(|e| {
        eprintln!("write_ifcx_binary failed: {e}");
        std::process::exit(1);
    });
    let dt_enc = t_enc.elapsed().as_millis();

    std::fs::write(&out, &blob).unwrap_or_else(|e| {
        eprintln!("write {} failed: {e}", out.display());
        std::process::exit(1);
    });

    let out_bytes = blob.len() as u64;
    let ratio = if src_bytes > 0 {
        (out_bytes as f64 / src_bytes as f64) * 100.0
    } else {
        0.0
    };
    println!(
        "SRC     {:>12} bytes ({})\nIFCDRAW {:>11} bytes ({})\nRATIO {:.2}% ({}× smaller)\nENCODE {} ms",
        src_bytes,
        src,
        out_bytes,
        out.display(),
        ratio,
        if ratio > 0.0 { 100.0 / ratio } else { 0.0 },
        dt_enc,
    );
}
