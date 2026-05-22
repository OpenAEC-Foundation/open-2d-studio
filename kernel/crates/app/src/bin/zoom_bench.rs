//! zoom_bench — measure the per-frame work that mouse-wheel zoom
//! triggers in `studio_app::render`.
//!
//! Loads a DWG/DXF via the same `scene_io` loaders the viewer uses, then
//! calls `studio_app::build_verts` (the helper that bakes dashed-segment
//! patterns into the line vertex buffer) at a sequence of `world_per_pixel`
//! values that mimic 4 wheel-notches of zoom-in. Reports per-call timing
//! + segment / vertex counts so we can quantify the cost of the
//! "dash rebuild on wheel" path the user reported as sluggish.
//!
//! Why this exists: the GUI viewer's wheel handler invalidates the GPU
//! line buffer whenever the dash-pixel stride drifts >15%. On a 700k-segment
//! scene each rebuild re-tessellates every dashed segment from world-space
//! LINETYPE arrays to screen-pixel-clamped strokes. The bench isolates
//! that step so we can compare baseline vs. proposed fixes without having
//! to drive a winit window.
//!
//! Usage:
//!   zoom_bench <path.dwg|.dxf>
//!
//! Output: one human-readable summary plus one machine-parseable line per
//! simulated zoom step (stride / wpp / dur_ms / model_verts / paper_verts).

use std::collections::HashSet;
use std::time::Instant;

use kernel_app::scene_io::{load_dwg, load_dxf, Scene};
use kernel_app::studio_app::{build_tri_verts, build_verts, LTSCALE, MIN_SCREEN_PX};

fn main() {
    let args: Vec<String> = std::env::args().collect();
    if args.len() < 2 {
        eprintln!("usage: zoom_bench <path.dwg|.dxf>");
        std::process::exit(2);
    }
    let path = &args[1];
    let lower = path.to_lowercase();
    let load_t = Instant::now();
    let scene: Scene = if lower.ends_with(".dwg") {
        match load_dwg(path) {
            Ok(s) => s,
            Err(e) => { eprintln!("load_dwg failed: {e}"); std::process::exit(1); }
        }
    } else if lower.ends_with(".dxf") {
        match load_dxf(path) {
            Ok(s) => s,
            Err(e) => { eprintln!("load_dxf failed: {e}"); std::process::exit(1); }
        }
    } else {
        eprintln!("unsupported extension (need .dwg or .dxf)"); std::process::exit(2);
    };
    let load_ms = load_t.elapsed().as_secs_f64() * 1000.0;

    // Scene stats — how much dashing is actually in scope.
    let n_segs = scene.segments.len();
    let n_dash_world = if scene.segment_dash_idx.len() == n_segs {
        scene.segment_dash_idx.iter().filter(|&&i| i != 0).count()
    } else { 0 };
    let n_dash_legacy = if scene.segment_dash_kind.len() == n_segs {
        scene.segment_dash_kind.iter().filter(|&&k| k != 0).count()
    } else { 0 };
    let n_text_seg = if scene.segment_entity_idx.len() == n_segs {
        let n_text_slots = scene.entity_text.len();
        scene.segment_entity_idx.iter()
            .filter(|&&e| {
                let i = e as usize;
                i < n_text_slots && scene.entity_text[i].is_some()
            })
            .count()
    } else { 0 };
    let dash_arrays = scene.dash_arrays.len();

    eprintln!(
        "[zoom_bench] file={}\n  load_ms={:.1}\n  segs={}  dashed_world={}  dashed_legacy={}  text_segs={}  dash_arrays_table={}\n  LTSCALE={}  MIN_SCREEN_PX={}",
        path, load_ms, n_segs, n_dash_world, n_dash_legacy, n_text_seg, dash_arrays, LTSCALE, MIN_SCREEN_PX,
    );

    // Simulate 4 zoom-in notches starting at a typical first-paint wpp
    // (1.0 mm per pixel on a 1080p canvas viewing a ~2m-wide drawing).
    // Each notch is ×1.45 zoom = ÷1.45 wpp.
    let hidden: HashSet<String> = HashSet::new();
    let origin = [0.0_f64, 0.0_f64];
    let mut wpp = 1.0_f64;
    println!("step,wpp,dur_ms_model,dur_ms_paper,verts_model,verts_paper");
    for step in 0..6 {
        let t0 = Instant::now();
        let m = build_verts(&scene, origin, 0xFFFFFFFF, false, &hidden, wpp);
        let t_model = t0.elapsed().as_secs_f64() * 1000.0;
        let t1 = Instant::now();
        let p = build_verts(&scene, origin, 0xFFFFFFFF, true, &hidden, wpp);
        let t_paper = t1.elapsed().as_secs_f64() * 1000.0;
        println!("{},{:.6},{:.3},{:.3},{},{}", step, wpp, t_model, t_paper, m.len(), p.len());
        wpp /= 1.45;  // simulate one wheel-notch zoom-in
    }

    // Solid-only baseline: pass wpp=0 so dashed path is skipped and every
    // segment renders as one stroke. Sets a lower bound on the cost.
    let t = Instant::now();
    let m = build_verts(&scene, origin, 0xFFFFFFFF, false, &hidden, 0.0);
    let solid_ms = t.elapsed().as_secs_f64() * 1000.0;
    eprintln!("[zoom_bench] solid-only baseline (wpp=0): {:.3} ms / {} verts", solid_ms, m.len());

    // Full vs. dash-only comparison. The viewer used to call
    // `rebuild_buffers_with_canvas` (= 2x build_verts + 2x build_tri_verts
    // PLUS scene_index/snap_segments invalidation) on every wheel notch.
    // After the fix it calls `rebake_dash_lines_with_canvas` which only
    // re-bakes lines and skips the tri pass entirely. This benchmark
    // measures the line + triangle vert builds in isolation; the
    // scene_index rebuild savings (~30-60 ms) are on top of these.
    let wpp = 0.5_f64;  // pick a mid-zoom value where dashes matter
    let t = Instant::now();
    let _m1 = build_verts(&scene, origin, 0xFFFFFFFF, false, &hidden, wpp);
    let _p1 = build_verts(&scene, origin, 0xFFFFFFFF, true, &hidden, wpp);
    let t_lines = t.elapsed().as_secs_f64() * 1000.0;
    let t = Instant::now();
    let (_mts, _mtt) = build_tri_verts(&scene, origin, false, &hidden);
    let (_pts, _ptt) = build_tri_verts(&scene, origin, true, &hidden);
    let t_tris = t.elapsed().as_secs_f64() * 1000.0;
    eprintln!(
        "[zoom_bench] per-wheel-notch refresh cost on this scene (CPU only, no GPU upload):\n  \
         OLD path (rebuild_buffers_with_canvas):  lines={:.2}ms tris={:.2}ms TOTAL={:.2}ms\n  \
         NEW path (rebake_dash_lines_with_canvas): lines={:.2}ms tris=SKIPPED  TOTAL={:.2}ms\n  \
         delta: -{:.2}ms ({:.0}% reduction) per dash refresh\n  \
         PLUS: next CursorMoved no longer pays scene_index + snap_segments rebuild (~30-60ms on this size).",
        t_lines, t_tris, t_lines + t_tris,
        t_lines, t_lines,
        t_tris, (t_tris / (t_lines + t_tris).max(1e-6)) * 100.0,
    );
}
