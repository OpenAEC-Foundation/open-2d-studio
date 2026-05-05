//! CPU-side preview rasterizer for the in-app file picker.
//!
//! Contract: callers extract a small set of 2D line segments from the
//! candidate file (using whichever crate already knows the format) and
//! pass them here. We rasterize to a 160×120 RGBA framebuffer and hand
//! back an `egui::ColorImage` that the picker uploads as a texture.
//!
//! Keeping this dependency-free (no `image`, no `zstd`, no `dxf`) lets
//! the helper live alongside the rest of `superui` without dragging
//! heavy parsers into the UI crate. The caller is also the right place
//! to enforce a per-file time budget: this function only burns CPU
//! proportional to `segments.len()`.

use egui::{Color32, ColorImage};

/// Rasterize a list of 2D line segments to an `egui::ColorImage`.
///
/// `segments` is an iterator of `(x1, y1, x2, y2)` in any units — the
/// renderer auto-fits the lines into the framebuffer with a small
/// margin. `(width, height)` is the target image size in pixels (use
/// `(160, 120)` for the picker tile).
///
/// Empty input produces a uniformly grey image so the tile shows
/// "preview-but-empty" instead of being mistaken for a parse failure.
pub fn rasterize_segments(
    segments: &[(f32, f32, f32, f32)],
    width: u32,
    height: u32,
) -> ColorImage {
    let w = width as usize;
    let h = height as usize;
    let bg = Color32::from_rgb(245, 245, 245);
    let fg = Color32::from_rgb(40, 40, 40);
    let empty = Color32::from_rgb(220, 220, 220);
    if segments.is_empty() || w == 0 || h == 0 {
        return ColorImage::new([w, h], empty);
    }

    // 1) Compute bbox.
    let mut xmin = f32::INFINITY;
    let mut ymin = f32::INFINITY;
    let mut xmax = f32::NEG_INFINITY;
    let mut ymax = f32::NEG_INFINITY;
    for &(x1, y1, x2, y2) in segments {
        if !x1.is_finite() || !y1.is_finite() || !x2.is_finite() || !y2.is_finite() {
            continue;
        }
        xmin = xmin.min(x1).min(x2);
        ymin = ymin.min(y1).min(y2);
        xmax = xmax.max(x1).max(x2);
        ymax = ymax.max(y1).max(y2);
    }
    if !xmin.is_finite() || xmax <= xmin || ymax <= ymin {
        return ColorImage::new([w, h], empty);
    }
    let dx = xmax - xmin;
    let dy = ymax - ymin;

    // 2) Fit-to-frame with 5 px margin on each side, preserving aspect.
    let margin = 5.0_f32;
    let avail_w = (w as f32 - 2.0 * margin).max(1.0);
    let avail_h = (h as f32 - 2.0 * margin).max(1.0);
    let scale = (avail_w / dx).min(avail_h / dy);
    let off_x = margin + (avail_w - dx * scale) * 0.5;
    let off_y = margin + (avail_h - dy * scale) * 0.5;

    // 3) Allocate framebuffer + draw.
    let mut pixels = vec![bg; w * h];
    for &(x1, y1, x2, y2) in segments {
        if !x1.is_finite() || !y1.is_finite() || !x2.is_finite() || !y2.is_finite() {
            continue;
        }
        // World → pixel. Y flipped so positive Y is "up" like CAD.
        let px1 = off_x + (x1 - xmin) * scale;
        let py1 = (h as f32) - (off_y + (y1 - ymin) * scale);
        let px2 = off_x + (x2 - xmin) * scale;
        let py2 = (h as f32) - (off_y + (y2 - ymin) * scale);
        draw_line(&mut pixels, w, h, px1, py1, px2, py2, fg);
    }

    ColorImage {
        size: [w, h],
        pixels,
    }
}

/// Bresenham-ish integer line. Cheap, no AA — that's fine at 160×120.
fn draw_line(
    pixels: &mut [Color32],
    w: usize,
    h: usize,
    x0: f32,
    y0: f32,
    x1: f32,
    y1: f32,
    color: Color32,
) {
    let mut x0 = x0.round() as i32;
    let mut y0 = y0.round() as i32;
    let x1 = x1.round() as i32;
    let y1 = y1.round() as i32;
    let dx = (x1 - x0).abs();
    let dy = -(y1 - y0).abs();
    let sx = if x0 < x1 { 1 } else { -1 };
    let sy = if y0 < y1 { 1 } else { -1 };
    let mut err = dx + dy;
    let wi = w as i32;
    let hi = h as i32;
    loop {
        if x0 >= 0 && x0 < wi && y0 >= 0 && y0 < hi {
            pixels[(y0 as usize) * w + (x0 as usize)] = color;
        }
        if x0 == x1 && y0 == y1 {
            break;
        }
        let e2 = 2 * err;
        if e2 >= dy {
            err += dy;
            x0 += sx;
        }
        if e2 <= dx {
            err += dx;
            y0 += sy;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn empty_segments_yields_grey_image() {
        let img = rasterize_segments(&[], 4, 4);
        assert_eq!(img.size, [4, 4]);
    }

    #[test]
    fn single_segment_draws_at_least_one_pixel() {
        let img = rasterize_segments(&[(0.0, 0.0, 1.0, 1.0)], 16, 16);
        let drawn = img.pixels.iter().filter(|p| **p != Color32::from_rgb(245, 245, 245)).count();
        assert!(drawn > 0, "expected a non-background pixel");
    }
}
