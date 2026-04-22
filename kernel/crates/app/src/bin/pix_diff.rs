//! pix_diff — pixel-level visual diff between two PNG renders.
//!
//! For each pixel in `a`, mark "matched" if any pixel in `b` within ±2 px
//! has the same colour (each channel within ±10/255). Skip pixels that are
//! pure background (clear colour) in BOTH images so the percentage reflects
//! how much *drawn* content matches, not how much empty canvas matches.
//! Print `match%: NN.N%`.
//!
//! Usage: pix_diff <a.png> <b.png>

use image::GenericImageView;

const CHAN_TOL: i32 = 10;
const SPATIAL_TOL: i32 = 2;
/// RGB sum below this is considered background (≈ {0,0,0} clear colour).
const BG_RGB_SUM: i32 = 16 * 3;

fn main() -> anyhow::Result<()> {
    let args: Vec<String> = std::env::args().collect();
    if args.len() != 3 {
        eprintln!("usage: pix_diff <a.png> <b.png>");
        std::process::exit(2);
    }
    let a = image::open(&args[1])
        .map_err(|e| anyhow::anyhow!("open {}: {e}", &args[1]))?;
    let b = image::open(&args[2])
        .map_err(|e| anyhow::anyhow!("open {}: {e}", &args[2]))?;

    let (aw, ah) = a.dimensions();
    let (bw, bh) = b.dimensions();
    if (aw, ah) != (bw, bh) {
        anyhow::bail!("size mismatch: {}x{} vs {}x{}", aw, ah, bw, bh);
    }

    let a_rgb = a.to_rgba8();
    let b_rgb = b.to_rgba8();
    let w = aw as i32;
    let h = ah as i32;

    let pix_a = |x: i32, y: i32| -> [u8; 4] {
        let p = a_rgb.get_pixel(x as u32, y as u32).0;
        [p[0], p[1], p[2], p[3]]
    };
    let pix_b = |x: i32, y: i32| -> [u8; 4] {
        let p = b_rgb.get_pixel(x as u32, y as u32).0;
        [p[0], p[1], p[2], p[3]]
    };

    let is_bg = |p: [u8; 4]| -> bool {
        (p[0] as i32 + p[1] as i32 + p[2] as i32) <= BG_RGB_SUM
    };

    let mut considered: u64 = 0;
    let mut matched: u64 = 0;
    let mut a_drawn: u64 = 0;
    let mut b_drawn: u64 = 0;

    for y in 0..h {
        for x in 0..w {
            let pa = pix_a(x, y);
            let pb_same = pix_b(x, y);
            let a_bg = is_bg(pa);
            let b_bg = is_bg(pb_same);
            if !a_bg { a_drawn += 1; }
            if !b_bg { b_drawn += 1; }
            // Both background — skip (don't inflate the score with empty space).
            if a_bg && b_bg { continue; }
            considered += 1;

            // Search the 5x5 neighbourhood (±2 px) in B for a colour match.
            let mut found = false;
            'search: for dy in -SPATIAL_TOL..=SPATIAL_TOL {
                let yy = y + dy;
                if yy < 0 || yy >= h { continue; }
                for dx in -SPATIAL_TOL..=SPATIAL_TOL {
                    let xx = x + dx;
                    if xx < 0 || xx >= w { continue; }
                    let pb = pix_b(xx, yy);
                    let dr = (pa[0] as i32 - pb[0] as i32).abs();
                    let dg = (pa[1] as i32 - pb[1] as i32).abs();
                    let db = (pa[2] as i32 - pb[2] as i32).abs();
                    if dr <= CHAN_TOL && dg <= CHAN_TOL && db <= CHAN_TOL {
                        found = true;
                        break 'search;
                    }
                }
            }
            if found { matched += 1; }
        }
    }

    let pct = if considered == 0 { 100.0 } else { matched as f64 / considered as f64 * 100.0 };
    eprintln!("[pix_diff] a_drawn={} b_drawn={} considered={} matched={}",
        a_drawn, b_drawn, considered, matched);
    println!("match%: {:.1}%", pct);
    Ok(())
}
