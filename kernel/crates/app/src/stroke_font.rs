//! Minimal single-stroke font for CAD-style text rendering.
//!
//! Each glyph is a list of strokes; each stroke is a polyline over a
//! normalised cell where x ∈ [0, 0.6] (width) and y ∈ [0, 1] (height).
//! Baseline is at y=0; cap-height is y=1.
//!
//! This is intentionally minimal — A-Z, 0-9, space, and a few symbols —
//! to keep the data embedded in the binary. For a production CAD app you
//! would swap this out for a real Hershey font table or a TTF renderer.
//!
//! Module is `mod`-included from the binaries that need it.

/// A stroke is an unbroken polyline: successive points connect by straight
/// lines. Pen-up is represented by starting a new stroke.
pub type Stroke = &'static [(f32, f32)];
pub type Glyph = &'static [Stroke];

/// Cell advance = width of a glyph cell (so next char shifts by this * text_height).
pub const CELL_ADVANCE: f32 = 0.7;

/// Look up the glyph for a character. Unknown characters return a `?`
/// placeholder so the missing character is visible without dumping ugly
/// empty rectangles into the drawing — the previous UNKNOWN-as-rectangle
/// behaviour produced the user-visible "hokjes" (boxes) for any non-ASCII
/// character (Dutch ë/ö, ⌀ diameter, CJK, etc.) that survived past the
/// TTF path. A printable `?` is much less visually disruptive and matches
/// what most TTF .notdef glyphs convey ("character not in font").
pub fn glyph(c: char) -> Glyph {
    let upper = c.to_ascii_uppercase();
    match upper {
        ' ' => &[],
        'A' => A, 'B' => B, 'C' => C, 'D' => D, 'E' => E, 'F' => F,
        'G' => G, 'H' => H, 'I' => I, 'J' => J, 'K' => K, 'L' => L,
        'M' => M, 'N' => N, 'O' => O, 'P' => P, 'Q' => Q, 'R' => R,
        'S' => S, 'T' => T, 'U' => U, 'V' => V, 'W' => W, 'X' => X,
        'Y' => Y, 'Z' => Z,
        '0' => N0, '1' => N1, '2' => N2, '3' => N3, '4' => N4,
        '5' => N5, '6' => N6, '7' => N7, '8' => N8, '9' => N9,
        '.' => DOT, ',' => COMMA, '-' => MINUS, '+' => PLUS,
        '/' => SLASH, '\\' => BACKSLASH, ':' => COLON, ';' => SEMI,
        '(' => LPAREN, ')' => RPAREN, '=' => EQUALS, '_' => UNDER,
        // Defensive fallbacks: when DXF/DWG style references SHX (no TTF)
        // these chars previously rendered as the UNKNOWN rectangle —
        // matches user complaint "vraagteken et cetera niet goed in
        // het lettertype". See ttf_font.rs for the TTF path.
        '?' => QUESTION, '!' => BANG, '\'' => APOS, '"' => QUOTE,
        '*' => STAR, '#' => HASH, '<' => LT, '>' => GT,
        '[' => LBRACK, ']' => RBRACK, '{' => LBRACE, '}' => RBRACE,
        '&' => AMP, '@' => AT, '%' => PCT,
        // Anything else — Unicode that the stroke font has no shape for —
        // becomes a question mark instead of a literal rectangle. Keeps
        // text legible (you can see SOMETHING was here) without painting
        // the eyesore boxes. See module-doc above for the rationale.
        _ => QUESTION,
    }
}

// --- Letters (uppercase). Shapes occupy x∈[0, 0.6], y∈[0, 1]. ---

const A: Glyph = &[&[(0.0, 0.0), (0.3, 1.0), (0.6, 0.0)], &[(0.15, 0.4), (0.45, 0.4)]];
const B: Glyph = &[&[(0.0, 0.0), (0.0, 1.0), (0.4, 1.0), (0.5, 0.9), (0.5, 0.6), (0.4, 0.5), (0.0, 0.5), (0.4, 0.5), (0.5, 0.4), (0.5, 0.1), (0.4, 0.0), (0.0, 0.0)]];
const C: Glyph = &[&[(0.6, 0.15), (0.5, 0.0), (0.2, 0.0), (0.0, 0.15), (0.0, 0.85), (0.2, 1.0), (0.5, 1.0), (0.6, 0.85)]];
const D: Glyph = &[&[(0.0, 0.0), (0.0, 1.0), (0.35, 1.0), (0.55, 0.85), (0.6, 0.6), (0.6, 0.4), (0.55, 0.15), (0.35, 0.0), (0.0, 0.0)]];
const E: Glyph = &[&[(0.6, 0.0), (0.0, 0.0), (0.0, 1.0), (0.6, 1.0)], &[(0.0, 0.5), (0.45, 0.5)]];
const F: Glyph = &[&[(0.0, 0.0), (0.0, 1.0), (0.6, 1.0)], &[(0.0, 0.5), (0.45, 0.5)]];
const G: Glyph = &[&[(0.6, 0.85), (0.5, 1.0), (0.2, 1.0), (0.0, 0.85), (0.0, 0.15), (0.2, 0.0), (0.5, 0.0), (0.6, 0.15), (0.6, 0.45), (0.35, 0.45)]];
const H: Glyph = &[&[(0.0, 0.0), (0.0, 1.0)], &[(0.6, 0.0), (0.6, 1.0)], &[(0.0, 0.5), (0.6, 0.5)]];
const I: Glyph = &[&[(0.0, 0.0), (0.6, 0.0)], &[(0.3, 0.0), (0.3, 1.0)], &[(0.0, 1.0), (0.6, 1.0)]];
const J: Glyph = &[&[(0.0, 0.15), (0.15, 0.0), (0.35, 0.0), (0.5, 0.15), (0.5, 1.0)]];
const K: Glyph = &[&[(0.0, 0.0), (0.0, 1.0)], &[(0.6, 1.0), (0.0, 0.45), (0.6, 0.0)]];
const L: Glyph = &[&[(0.0, 1.0), (0.0, 0.0), (0.6, 0.0)]];
const M: Glyph = &[&[(0.0, 0.0), (0.0, 1.0), (0.3, 0.5), (0.6, 1.0), (0.6, 0.0)]];
const N: Glyph = &[&[(0.0, 0.0), (0.0, 1.0), (0.6, 0.0), (0.6, 1.0)]];
const O: Glyph = &[&[(0.0, 0.15), (0.0, 0.85), (0.2, 1.0), (0.4, 1.0), (0.6, 0.85), (0.6, 0.15), (0.4, 0.0), (0.2, 0.0), (0.0, 0.15)]];
const P: Glyph = &[&[(0.0, 0.0), (0.0, 1.0), (0.4, 1.0), (0.55, 0.9), (0.6, 0.75), (0.55, 0.6), (0.4, 0.5), (0.0, 0.5)]];
const Q: Glyph = &[&[(0.0, 0.15), (0.0, 0.85), (0.2, 1.0), (0.4, 1.0), (0.6, 0.85), (0.6, 0.15), (0.4, 0.0), (0.2, 0.0), (0.0, 0.15)], &[(0.35, 0.2), (0.65, -0.1)]];
const R: Glyph = &[&[(0.0, 0.0), (0.0, 1.0), (0.4, 1.0), (0.55, 0.9), (0.6, 0.75), (0.55, 0.6), (0.4, 0.5), (0.0, 0.5)], &[(0.3, 0.5), (0.6, 0.0)]];
const S: Glyph = &[&[(0.6, 0.85), (0.5, 1.0), (0.15, 1.0), (0.0, 0.85), (0.0, 0.7), (0.15, 0.55), (0.45, 0.45), (0.6, 0.3), (0.6, 0.15), (0.45, 0.0), (0.1, 0.0), (0.0, 0.15)]];
const T: Glyph = &[&[(0.0, 1.0), (0.6, 1.0)], &[(0.3, 1.0), (0.3, 0.0)]];
const U: Glyph = &[&[(0.0, 1.0), (0.0, 0.15), (0.15, 0.0), (0.45, 0.0), (0.6, 0.15), (0.6, 1.0)]];
const V: Glyph = &[&[(0.0, 1.0), (0.3, 0.0), (0.6, 1.0)]];
const W: Glyph = &[&[(0.0, 1.0), (0.1, 0.0), (0.3, 0.6), (0.5, 0.0), (0.6, 1.0)]];
const X: Glyph = &[&[(0.0, 0.0), (0.6, 1.0)], &[(0.0, 1.0), (0.6, 0.0)]];
const Y: Glyph = &[&[(0.0, 1.0), (0.3, 0.5), (0.6, 1.0)], &[(0.3, 0.5), (0.3, 0.0)]];
const Z: Glyph = &[&[(0.0, 1.0), (0.6, 1.0), (0.0, 0.0), (0.6, 0.0)]];

// --- Digits ---
const N0: Glyph = &[&[(0.0, 0.15), (0.0, 0.85), (0.2, 1.0), (0.4, 1.0), (0.6, 0.85), (0.6, 0.15), (0.4, 0.0), (0.2, 0.0), (0.0, 0.15)], &[(0.0, 0.0), (0.6, 1.0)]];
const N1: Glyph = &[&[(0.15, 0.85), (0.3, 1.0), (0.3, 0.0)], &[(0.0, 0.0), (0.6, 0.0)]];
const N2: Glyph = &[&[(0.0, 0.85), (0.15, 1.0), (0.45, 1.0), (0.6, 0.85), (0.6, 0.6), (0.0, 0.0), (0.6, 0.0)]];
const N3: Glyph = &[&[(0.0, 0.9), (0.15, 1.0), (0.45, 1.0), (0.6, 0.85), (0.6, 0.6), (0.45, 0.5), (0.15, 0.5)], &[(0.45, 0.5), (0.6, 0.4), (0.6, 0.15), (0.45, 0.0), (0.15, 0.0), (0.0, 0.1)]];
const N4: Glyph = &[&[(0.45, 0.0), (0.45, 1.0), (0.0, 0.35), (0.6, 0.35)]];
const N5: Glyph = &[&[(0.6, 1.0), (0.0, 1.0), (0.0, 0.55), (0.15, 0.65), (0.45, 0.65), (0.6, 0.55), (0.6, 0.15), (0.45, 0.0), (0.15, 0.0), (0.0, 0.1)]];
const N6: Glyph = &[&[(0.6, 0.85), (0.45, 1.0), (0.15, 1.0), (0.0, 0.85), (0.0, 0.15), (0.15, 0.0), (0.45, 0.0), (0.6, 0.15), (0.6, 0.35), (0.45, 0.5), (0.15, 0.5), (0.0, 0.35)]];
const N7: Glyph = &[&[(0.0, 1.0), (0.6, 1.0), (0.1, 0.0)]];
const N8: Glyph = &[&[(0.15, 0.5), (0.0, 0.35), (0.0, 0.15), (0.15, 0.0), (0.45, 0.0), (0.6, 0.15), (0.6, 0.35), (0.45, 0.5), (0.15, 0.5), (0.0, 0.65), (0.0, 0.85), (0.15, 1.0), (0.45, 1.0), (0.6, 0.85), (0.6, 0.65), (0.45, 0.5)]];
const N9: Glyph = &[&[(0.0, 0.15), (0.15, 0.0), (0.45, 0.0), (0.6, 0.15), (0.6, 0.85), (0.45, 1.0), (0.15, 1.0), (0.0, 0.85), (0.0, 0.65), (0.15, 0.5), (0.45, 0.5), (0.6, 0.65)]];

// --- Punctuation / symbols ---
const DOT: Glyph = &[&[(0.25, 0.0), (0.35, 0.0), (0.35, 0.1), (0.25, 0.1), (0.25, 0.0)]];
const COMMA: Glyph = &[&[(0.35, 0.1), (0.25, 0.0), (0.2, -0.1)]];
const MINUS: Glyph = &[&[(0.0, 0.5), (0.6, 0.5)]];
const PLUS: Glyph = &[&[(0.0, 0.5), (0.6, 0.5)], &[(0.3, 0.2), (0.3, 0.8)]];
const SLASH: Glyph = &[&[(0.0, 0.0), (0.6, 1.0)]];
const BACKSLASH: Glyph = &[&[(0.0, 1.0), (0.6, 0.0)]];
const COLON: Glyph = &[&[(0.25, 0.2), (0.35, 0.2), (0.35, 0.3), (0.25, 0.3), (0.25, 0.2)], &[(0.25, 0.7), (0.35, 0.7), (0.35, 0.8), (0.25, 0.8), (0.25, 0.7)]];
const SEMI: Glyph = &[&[(0.35, 0.75), (0.25, 0.65)], &[(0.35, 0.2), (0.25, 0.1), (0.2, -0.05)]];
const LPAREN: Glyph = &[&[(0.5, 0.0), (0.2, 0.25), (0.2, 0.75), (0.5, 1.0)]];
const RPAREN: Glyph = &[&[(0.1, 0.0), (0.4, 0.25), (0.4, 0.75), (0.1, 1.0)]];
const EQUALS: Glyph = &[&[(0.0, 0.35), (0.6, 0.35)], &[(0.0, 0.65), (0.6, 0.65)]];
const UNDER: Glyph = &[&[(0.0, 0.0), (0.6, 0.0)]];
// Question mark — curve top + dot bottom.
const QUESTION: Glyph = &[
    &[(0.05, 0.85), (0.15, 1.0), (0.45, 1.0), (0.55, 0.85), (0.55, 0.7), (0.3, 0.55), (0.3, 0.35)],
    &[(0.25, 0.1), (0.35, 0.1), (0.35, 0.0), (0.25, 0.0), (0.25, 0.1)],
];
const BANG: Glyph = &[
    &[(0.3, 1.0), (0.3, 0.3)],
    &[(0.25, 0.1), (0.35, 0.1), (0.35, 0.0), (0.25, 0.0), (0.25, 0.1)],
];
const APOS: Glyph = &[&[(0.3, 1.0), (0.3, 0.75)]];
const QUOTE: Glyph = &[&[(0.2, 1.0), (0.2, 0.75)], &[(0.4, 1.0), (0.4, 0.75)]];
const STAR: Glyph = &[
    &[(0.0, 0.5), (0.6, 0.5)],
    &[(0.15, 0.25), (0.45, 0.75)],
    &[(0.45, 0.25), (0.15, 0.75)],
];
const HASH: Glyph = &[
    &[(0.15, 0.0), (0.15, 1.0)],
    &[(0.45, 0.0), (0.45, 1.0)],
    &[(0.0, 0.35), (0.6, 0.35)],
    &[(0.0, 0.65), (0.6, 0.65)],
];
const LT: Glyph = &[&[(0.55, 0.85), (0.05, 0.5), (0.55, 0.15)]];
const GT: Glyph = &[&[(0.05, 0.85), (0.55, 0.5), (0.05, 0.15)]];
const LBRACK: Glyph = &[&[(0.5, 1.0), (0.15, 1.0), (0.15, 0.0), (0.5, 0.0)]];
const RBRACK: Glyph = &[&[(0.1, 1.0), (0.45, 1.0), (0.45, 0.0), (0.1, 0.0)]];
const LBRACE: Glyph = &[&[(0.55, 1.0), (0.35, 0.95), (0.35, 0.6), (0.15, 0.5), (0.35, 0.4), (0.35, 0.05), (0.55, 0.0)]];
const RBRACE: Glyph = &[&[(0.05, 1.0), (0.25, 0.95), (0.25, 0.6), (0.45, 0.5), (0.25, 0.4), (0.25, 0.05), (0.05, 0.0)]];
const AMP: Glyph = &[&[(0.55, 0.0), (0.0, 0.65), (0.0, 0.85), (0.15, 1.0), (0.3, 1.0), (0.45, 0.85), (0.45, 0.7), (0.0, 0.3), (0.0, 0.15), (0.15, 0.0), (0.3, 0.0), (0.55, 0.25)]];
const AT: Glyph = &[
    &[(0.45, 0.3), (0.3, 0.2), (0.2, 0.3), (0.2, 0.5), (0.3, 0.6), (0.45, 0.5), (0.45, 0.3)],
    &[(0.45, 0.3), (0.45, 0.55), (0.55, 0.6), (0.6, 0.4), (0.55, 0.15), (0.4, 0.05), (0.15, 0.05), (0.05, 0.2), (0.05, 0.7), (0.15, 0.9), (0.4, 0.95), (0.55, 0.85)],
];
const PCT: Glyph = &[
    &[(0.05, 0.95), (0.15, 1.0), (0.2, 0.95), (0.2, 0.75), (0.15, 0.7), (0.05, 0.75), (0.05, 0.95)],
    &[(0.0, 0.0), (0.6, 1.0)],
    &[(0.4, 0.25), (0.5, 0.3), (0.55, 0.25), (0.55, 0.05), (0.5, 0.0), (0.4, 0.05), (0.4, 0.25)],
];
#[allow(dead_code)] // kept for reference; glyph() now maps unknown→QUESTION
const UNKNOWN: Glyph = &[&[(0.05, 0.05), (0.55, 0.05), (0.55, 0.95), (0.05, 0.95), (0.05, 0.05)]];

/// Render a string as world-space segments starting at `origin`, with each
/// glyph cell h world units tall and rotated by `rotation` radians around
/// `origin`. Returns (segments, advance_total) where advance_total is the
/// total width of the rendered text.
pub fn render_string(
    s: &str,
    origin: [f64; 2],
    h: f64,
    rotation: f64,
) -> (Vec<([f64; 2], [f64; 2])>, f64) {
    let cos_r = rotation.cos();
    let sin_r = rotation.sin();
    let mut advance = 0.0f64;
    let mut out: Vec<([f64; 2], [f64; 2])> = Vec::new();

    for c in s.chars() {
        let g = glyph(c);
        for stroke in g {
            // Each stroke is an unbroken polyline; convert successive pairs.
            let mut prev: Option<[f64; 2]> = None;
            for &(gx, gy) in stroke.iter() {
                // Glyph-local: scale by h, translate by advance
                let lx = (gx as f64 + advance) * h;
                let ly = gy as f64 * h;
                // Apply rotation around origin
                let rx = lx * cos_r - ly * sin_r;
                let ry = lx * sin_r + ly * cos_r;
                let p = [origin[0] + rx, origin[1] + ry];
                if let Some(pp) = prev {
                    out.push((pp, p));
                }
                prev = Some(p);
            }
        }
        advance += CELL_ADVANCE as f64;
    }
    (out, advance * h)
}
