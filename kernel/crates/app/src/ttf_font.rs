//! ttf_font — TrueType glyph-outline renderer for DXF/DWG TEXT and MTEXT.
//!
//! Purpose: DXF/DWG drawings reference fonts by STYLE-name (e.g. "Swis721 Cn
//! BT", "Segoe UI", "Standard"). Each STYLE maps to a TTF or SHX font file.
//! Our previous renderer used a Hershey-style single-glyph-set stroke font,
//! which made text legible but wrong: wrong letter shapes, wrong widths,
//! wrong obliques. This module loads the actual Windows TrueType font
//! (`C:\Windows\Fonts\*.ttf`) and tessellates glyph outlines to short line
//! segments, so the rendered text matches what DWG TrueView / AutoCAD draw.
//!
//! Design notes
//! ------------
//! * `ab_glyph::FontArc::try_from_vec` loads a TTF into a zero-copy, shareable
//!   handle. We cache by font filename (case-folded).
//! * `ab_glyph::Font::outline(glyph_id)` gives us `OutlineCurve::Line`,
//!   `::Quad`, `::Cubic` — we tessellate to ~8 segments per curve (more than
//!   enough at typical text sizes, since the curves are tiny anyway).
//! * Outlines are closed contours; we emit them as strokes, not fills. Text
//!   in an engineering drawing is typically drawn as thin strokes so this
//!   matches the visual style of the PDF / TrueView output well enough.
//! * Windows font-file lookup: `C:\Windows\Fonts\<name>`. We fall back on
//!   `ARIAL.TTF` when the requested font file isn't present.
//!
//! Public surface:
//!   - `render_string(font_file, text, origin, height, rotation)`
//!     returns a Vec<(p1, p2)> of outline segments, a Vec<Vec<[f64;2]>> of
//!     closed contours (for fill triangulation), AND an advance width.
//!   - `resolve_font_file(dxf_font_name)` maps a raw DXF STYLE font (code 3)
//!     name to a path under %WINDIR%\Fonts. Returns None for unknown.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Mutex;

use ab_glyph::{Font, FontArc, GlyphId, OutlineCurve, PxScale, ScaleFont};

// ---------------------------------------------------------------------------
// Font cache
// ---------------------------------------------------------------------------

static FONT_CACHE: Mutex<Option<FontCache>> = Mutex::new(None);

// Glyph-tessellation cache. Maps (font_file_lowercased, glyph_id) → the
// tessellated FONT-LOCAL contours for that glyph. Populated lazily on
// first render of each glyph; reused for every subsequent render
// regardless of height / rotation / pen-x (those are cheap affine
// transforms applied at lookup time).
//
// Why this matters: a Revit-exported legend has hundreds of TEXT entities
// re-using a small character set ("FR_DP_*_5", digits, underscores …).
// Without the cache, every glyph's bezier curves got tessellated freshly
// per TEXT entity — for 5 000 texts × 15 chars × ~5 beziers = 375 000
// tessellations per load. With the cache, each unique glyph is
// tessellated at most once (~60 unique chars on a typical drawing).
//
// Cache entry contents: a list of CLOSED FONT-LOCAL contours, one per
// glyph-outline subloop. Stored as Vec<Vec<[f32; 2]>> to keep memory
// down — font design units fit comfortably in f32.
static GLYPH_CACHE: Mutex<Option<GlyphCache>> = Mutex::new(None);

struct GlyphCache {
    /// Keyed by (font-file lowercased, ab_glyph::GlyphId.0). The inner
    /// Option is None for glyphs the font has no outline for (spaces,
    /// unmapped chars) — stored so we don't re-try the lookup.
    tess: HashMap<(String, u16), Option<Vec<Vec<[f32; 2]>>>>,
}

impl GlyphCache {
    fn new() -> Self { Self { tess: HashMap::new() } }
}

fn with_glyph_cache<R>(f: impl FnOnce(&mut GlyphCache) -> R) -> R {
    let mut slot = GLYPH_CACHE.lock().unwrap();
    let cache = slot.get_or_insert_with(GlyphCache::new);
    f(cache)
}

struct FontCache {
    fonts: HashMap<String, Option<FontArc>>,
    fonts_dir: PathBuf,
}

impl FontCache {
    fn new() -> Self {
        // On Windows this is always C:\Windows\Fonts. On non-Windows we use
        // a best-guess path so the code still compiles; the TTF lookup will
        // simply miss, and the caller falls back to the stroke font.
        let fonts_dir = std::env::var_os("WINDIR")
            .map(|w| PathBuf::from(w).join("Fonts"))
            .unwrap_or_else(|| PathBuf::from("C:/Windows/Fonts"));
        Self { fonts: HashMap::new(), fonts_dir }
    }

    /// Load a TTF by file-name (relative to the fonts dir). Cached; returns
    /// None on failure (file missing, unreadable, or not a valid TTF).
    fn load(&mut self, file_name: &str) -> Option<&FontArc> {
        let key = file_name.to_ascii_lowercase();
        if !self.fonts.contains_key(&key) {
            let path = self.fonts_dir.join(&key);
            let font = std::fs::read(&path)
                .ok()
                .and_then(|data| FontArc::try_from_vec(data).ok());
            self.fonts.insert(key.clone(), font);
        }
        self.fonts.get(&key).and_then(|f| f.as_ref())
    }
}

fn with_cache<R>(f: impl FnOnce(&mut FontCache) -> R) -> R {
    let mut slot = FONT_CACHE.lock().unwrap();
    let cache = slot.get_or_insert_with(FontCache::new);
    f(cache)
}

// ---------------------------------------------------------------------------
// DXF STYLE → TTF filename resolution
// ---------------------------------------------------------------------------

/// Map a raw DXF STYLE `font` field (dxf group code 3) to a Windows font
/// filename. DXF stores *either* a SHX base-name ("txt", "romans") *or* a
/// full TTF filename ("segoeui.ttf", "swissc.ttf"). SHX fonts are
/// vector-stroke files which Windows can't render; we approximate them by
/// falling through to the Arial fallback.
///
/// Returns the filename as it sits in `%WINDIR%\Fonts`, or None if the
/// reference looks like an SHX ref (caller uses stroke-font fallback).
pub fn resolve_font_file(dxf_font: &str) -> Option<String> {
    let trimmed = dxf_font.trim();
    if trimmed.is_empty() { return None; }
    let lower = trimmed.to_ascii_lowercase();
    // Already a TTF filename?
    if lower.ends_with(".ttf") || lower.ends_with(".otf") || lower.ends_with(".ttc") {
        return Some(lower);
    }
    // Common SHX shapes — these have no Windows equivalent. Return None so
    // caller uses the stroke-font fallback (which matches what AutoCAD
    // actually renders for SHX fonts — hand-drawn stroke paths, not glyph
    // outlines).
    match lower.as_str() {
        "txt" | "romans" | "romanc" | "romand" | "romant"
        | "italic" | "italicc" | "italict" | "monotxt" | "simplex"
        | "complex" | "isocp" | "isocp2" | "isocp3" | "isoct"
        | "gothice" | "gothicg" | "gothici" | "scripts" | "scriptc" => None,
        _ => None, // Unknown bare name — let caller fall back.
    }
}

// ---------------------------------------------------------------------------
// Tessellation
// ---------------------------------------------------------------------------

/// Tessellate a quadratic Bezier curve (p1 → c → p2) into ~N line segments.
#[inline]
fn tess_quad<F: FnMut([f64; 2], [f64; 2])>(
    p1: [f64; 2], c: [f64; 2], p2: [f64; 2], steps: usize, mut emit: F,
) {
    let mut prev = p1;
    for i in 1..=steps {
        let t = (i as f64) / (steps as f64);
        let u = 1.0 - t;
        let x = u * u * p1[0] + 2.0 * u * t * c[0] + t * t * p2[0];
        let y = u * u * p1[1] + 2.0 * u * t * c[1] + t * t * p2[1];
        let cur = [x, y];
        emit(prev, cur);
        prev = cur;
    }
}

/// Tessellate a cubic Bezier curve (p1 → c1 → c2 → p2) into ~N line segments.
#[inline]
fn tess_cubic<F: FnMut([f64; 2], [f64; 2])>(
    p1: [f64; 2], c1: [f64; 2], c2: [f64; 2], p2: [f64; 2], steps: usize, mut emit: F,
) {
    let mut prev = p1;
    for i in 1..=steps {
        let t = (i as f64) / (steps as f64);
        let u = 1.0 - t;
        let x = u*u*u*p1[0] + 3.0*u*u*t*c1[0] + 3.0*u*t*t*c2[0] + t*t*t*p2[0];
        let y = u*u*u*p1[1] + 3.0*u*u*t*c1[1] + 3.0*u*t*t*c2[1] + t*t*t*p2[1];
        let cur = [x, y];
        emit(prev, cur);
        prev = cur;
    }
}

// ---------------------------------------------------------------------------
// Public render entrypoint
// ---------------------------------------------------------------------------

/// Render `text` using the TTF at `font_file` (filename under %WINDIR%\Fonts).
/// `origin` is the baseline-left anchor in world units; `height` is the
/// cap-height in world units; `rotation` is CCW radians.
///
/// Returns the tessellated line-segment list AND the widest line's advance
/// width (for multi-line text, the longest single line — used by the caller
/// for anchor-offset / justification math). On failure to load the font,
/// returns `(vec![], 0.0)` — caller should fall back to stroke_font.
///
/// Line-break handling: a bare `\n`, a bare `\r`, or the pair `\r\n` /
/// `\n\r` starts a new line. Successive lines drop by
/// `5/3 × cap-height` along the text's local Y axis (AutoCAD's default
/// MTEXT line-spacing with "At Least" style and factor 1.0).
pub fn render_string(
    font_file: &str,
    text: &str,
    origin: [f64; 2],
    height: f64,
    rotation: f64,
) -> (Vec<([f64; 2], [f64; 2])>, f64) {
    let (segs, _contours, adv) = render_string_with_contours(font_file, text, origin, height, rotation);
    (segs, adv)
}

/// Same as `render_string` plus the closed-polygon CONTOUR list per
/// glyph in world coords. Callers can ear-clip each contour to produce
/// a SOLID glyph fill on top of the outline segments — makes titles
/// render as filled letters instead of thin outlines.
///
/// Contour detection: ab_glyph's `Outline.curves` is ordered so each
/// curve's start equals the previous curve's end within one contour.
/// When a new curve's start doesn't match the last emitted point
/// (within 1e-6 of the design-unit upm-scaled distance) a new contour
/// starts. For multi-contour glyphs like 'O' / 'B' this produces outer
/// + inner rings separately; the naïve fill of both rings visually
/// renders 'O' as a solid oval (hole filled too) — acceptable for CAD
/// labels at typical zoom, proper hole handling is TODO.
pub fn render_string_with_contours(
    font_file: &str,
    text: &str,
    origin: [f64; 2],
    height: f64,
    rotation: f64,
) -> (Vec<([f64; 2], [f64; 2])>, Vec<Vec<[f64; 2]>>, f64) {
    if text.is_empty() || height.abs() < 1e-9 {
        return (Vec::new(), Vec::new(), 0.0);
    }
    // Pull the FontArc out of the cache under a *short* lock: we clone (cheap,
    // FontArc is Arc-backed) so subsequent font-ops don't hold the mutex.
    let font_arc = with_cache(|c| c.load(font_file).cloned());
    let Some(font) = font_arc else {
        return (Vec::new(), Vec::new(), 0.0);
    };

    // DXF/DWG text-height semantics: `height` is the cap-height — the
    // distance from baseline to the top of an uppercase letter (e.g.
    // 'H'). Not the em-square. Not the ascent. Not the line-height.
    // Ref: AcDbText dxf group code 40 ("Text height"); ObjectARX
    // "AcDbText::height" API docs.
    //
    // NOTE: cap-height scaling temporarily reverted to the 0.72-ratio
    // approximation. The 'H'-glyph-bounds approach (see git log) produced
    // wildly oversized text — likely because bounds units are not the
    // same design-unit scale as ascent_unscaled in this ab_glyph
    // version. Revisit with a scoped test fixture before re-enabling.
    let upem = font.units_per_em().unwrap_or(1000.0);
    let cap_ratio = 0.72_f64;
    let ascent = font.ascent_unscaled().max(1.0) as f64;
    let upm = height / (cap_ratio * ascent);
    let _scale = PxScale::from((height as f32) * (upem / ascent as f32).max(1.0));
    let _scaled = font.as_scaled(_scale);

    let (cos_r, sin_r) = (rotation.cos(), rotation.sin());
    let transform = |local: [f64; 2]| -> [f64; 2] {
        let (x, y) = (local[0], local[1]);
        [x * cos_r - y * sin_r + origin[0], x * sin_r + y * cos_r + origin[1]]
    };

    let mut segments: Vec<([f64; 2], [f64; 2])> = Vec::new();
    let mut contours: Vec<Vec<[f64; 2]>> = Vec::new();
    // Pen-X along the baseline, in world units (post-scale).
    let mut pen_x: f64 = 0.0;
    // Pen-Y offset of the current baseline relative to the first line.
    // Lines below the first have a negative pen_y (DXF Y+ is up). Only
    // changes when we hit a hard newline (\n, \r, or \r\n pair).
    let mut pen_y: f64 = 0.0;
    // Track the widest line seen so the caller's anchor offset (computed
    // from the returned advance width) still centers / right-aligns
    // multi-line MTEXT correctly.
    let mut max_line_x: f64 = 0.0;
    // MTEXT line spacing — AutoCAD's default "At Least" mode with a
    // spacing factor of 1.0 corresponds to 5/3 × text_height between
    // successive baselines. Ref: AutoCAD DXF reference §AcDbMText codes
    // 44 (line spacing factor) and 73 (line spacing style). We treat
    // `height` as cap-height here since that matches what callers pass
    // for DXF group code 40 / MTEXT group code 40.
    let line_advance = height * (5.0 / 3.0);

    let font_key = font_file.to_ascii_lowercase();

    let mut chars = text.chars().peekable();
    while let Some(ch) = chars.next() {
        // Hard line break. Handle both bare "\n", bare "\r", and the
        // "\r\n" / "\n\r" pairs (AutoCAD's MTEXT codes emit bare \n
        // after our \P substitution, but DXF text can include either).
        if ch == '\n' || ch == '\r' {
            let paired = match ch {
                '\n' => '\r',
                _ => '\n',
            };
            if chars.peek().copied() == Some(paired) {
                chars.next();
            }
            if pen_x > max_line_x { max_line_x = pen_x; }
            pen_x = 0.0;
            pen_y -= line_advance;
            continue;
        }
        let gid = font.glyph_id(ch);
        let adv = font.h_advance_unscaled(gid) as f64 * upm;

        // If the char isn't in the font's cmap, ab_glyph returns GlyphId(0) —
        // the font's `.notdef` glyph, which in most TTFs is a visible
        // rectangle. Rendering that rectangle for every unmapped char (DXF
        // diameter `⌀`, CJK text, fonts missing Latin Extended glyphs, etc.)
        // looks exactly like the symptom "all chars are rectangles". Skip
        // glyph 0 but keep its advance so layout doesn't collapse. Callers
        // that want an explicit missing-glyph marker can layer their own.
        if gid.0 == 0 {
            pen_x += adv;
            continue;
        }

        // Fetch (or build) the glyph's cached font-local tessellation.
        // The cache key is (font_file, glyph_id.0). Value is a list of
        // closed contours in FONT-LOCAL f32 coordinates — transforming
        // to world units at lookup time is cheap (mul + rot + shift).
        let cached = with_glyph_cache(|gc| {
            let key = (font_key.clone(), gid.0);
            if let Some(entry) = gc.tess.get(&key) {
                return entry.clone();
            }
            let built = tessellate_glyph_local(&font, gid);
            gc.tess.insert(key, built.clone());
            built
        });

        if let Some(glyph_contours) = cached {
            for c_local in &glyph_contours {
                if c_local.len() < 3 { continue; }
                let mut world_contour: Vec<[f64; 2]> = Vec::with_capacity(c_local.len());
                // Each contour yields N-1 stroke segments (between
                // consecutive points) + one implicit closing segment
                // (last→first) since contours are stored open per
                // tessellate_glyph_local's cleanup step.
                for p in c_local {
                    let w = transform([
                        pen_x + p[0] as f64 * upm,
                        pen_y + p[1] as f64 * upm,
                    ]);
                    world_contour.push(w);
                }
                for w in world_contour.windows(2) {
                    segments.push((w[0], w[1]));
                }
                if let (Some(&f_pt), Some(&l_pt)) =
                    (world_contour.first(), world_contour.last())
                {
                    segments.push((l_pt, f_pt));
                }
                contours.push(world_contour);
            }
        }
        pen_x += adv;
    }
    if pen_x > max_line_x { max_line_x = pen_x; }

    (segments, contours, max_line_x)
}

/// Tessellate one glyph's outline in FONT-LOCAL coords and return its
/// contours as f32 Vecs. Returns None for glyphs with no outline
/// (spaces, control chars, unsupported chars). This is the expensive
/// step — called ONCE per unique glyph in a drawing.
fn tessellate_glyph_local(font: &FontArc, gid: GlyphId) -> Option<Vec<Vec<[f32; 2]>>> {
    let outline = font.outline(gid)?;
    // Contour-boundary detection via exact FONT-LOCAL coordinate match.
    // Within a contour ab_glyph chains curves (curve[i].end ==
    // curve[i+1].start in design units). Between contours there's a
    // jump. Font design coords are f32 with no accumulated drift, so
    // direct equality works.
    let eps_local: f32 = 0.5;
    let mut contours: Vec<Vec<[f32; 2]>> = Vec::new();
    let mut cur_end_local: Option<[f32; 2]> = None;
    for curve in outline.curves {
        let (start_local, end_local) = match &curve {
            OutlineCurve::Line(a, b) => ([a.x, a.y], [b.x, b.y]),
            OutlineCurve::Quad(a, _, b) => ([a.x, a.y], [b.x, b.y]),
            OutlineCurve::Cubic(a, _, _, b) => ([a.x, a.y], [b.x, b.y]),
        };
        let need_new = match cur_end_local {
            None => true,
            Some(e) => (e[0] - start_local[0]).abs() > eps_local
                    || (e[1] - start_local[1]).abs() > eps_local,
        };
        if need_new {
            contours.push(Vec::new());
            contours.last_mut().unwrap().push(start_local);
        }
        let cur = contours.last_mut().unwrap();
        match curve {
            OutlineCurve::Line(_, b) => {
                cur.push([b.x, b.y]);
            }
            OutlineCurve::Quad(a, c, b) => {
                let la = [a.x as f64, a.y as f64];
                let lc = [c.x as f64, c.y as f64];
                let lb = [b.x as f64, b.y as f64];
                tess_quad(la, lc, lb, 6, |_p1, p2| {
                    cur.push([p2[0] as f32, p2[1] as f32]);
                });
            }
            OutlineCurve::Cubic(a, c1, c2, b) => {
                let la  = [a.x  as f64, a.y  as f64];
                let lc1 = [c1.x as f64, c1.y as f64];
                let lc2 = [c2.x as f64, c2.y as f64];
                let lb  = [b.x  as f64, b.y  as f64];
                tess_cubic(la, lc1, lc2, lb, 8, |_p1, p2| {
                    cur.push([p2[0] as f32, p2[1] as f32]);
                });
            }
        }
        cur_end_local = Some(end_local);
    }
    contours.retain(|c| c.len() >= 3);
    for c in contours.iter_mut() {
        if c.len() >= 2 {
            let f = c[0]; let l = *c.last().unwrap();
            if (f[0] - l[0]).abs() < eps_local && (f[1] - l[1]).abs() < eps_local {
                c.pop();
            }
        }
    }
    if contours.is_empty() { None } else { Some(contours) }
}
