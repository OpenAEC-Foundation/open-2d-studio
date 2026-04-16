//! Text rendering via cosmic-text.
//!
//! cosmic-text is de moderne Rust text shaper: handles CJK, RTL, complex
//! scripts, font fallback. We shapen text naar glyph runs en rasteriseren
//! glyphs in een atlas voor GPU sampling.

use cosmic_text::{Attrs, Buffer, FontSystem, Metrics, Shaping, SwashCache};

pub struct TextEngine {
    pub font_system: FontSystem,
    pub swash_cache: SwashCache,
}

impl Default for TextEngine {
    fn default() -> Self {
        Self {
            font_system: FontSystem::new(),
            swash_cache: SwashCache::new(),
        }
    }
}

impl TextEngine {
    /// Shape a text string with given font size (pixels on paper at 1:1).
    /// Returns the buffer with shaped glyph runs.
    pub fn shape_text(&mut self, text: &str, font_size_mm: f32) -> Buffer {
        let metrics = Metrics::new(font_size_mm, font_size_mm * 1.2);
        let mut buffer = Buffer::new(&mut self.font_system, metrics);
        buffer.set_text(
            &mut self.font_system,
            text,
            Attrs::new(),
            Shaping::Advanced,
        );
        buffer.shape_until_scroll(&mut self.font_system, false);
        buffer
    }

    /// Measure the advance width of shaped text (for alignment, etc.).
    /// Returns (width, height) in mm.
    pub fn measure(&mut self, text: &str, font_size_mm: f32) -> (f32, f32) {
        let buffer = self.shape_text(text, font_size_mm);
        let mut max_w: f32 = 0.0;
        let mut lines = 0;
        for run in buffer.layout_runs() {
            let w = run.line_w;
            if w > max_w { max_w = w; }
            lines += 1;
        }
        let h = font_size_mm * 1.2 * lines.max(1) as f32;
        (max_w, h)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn engine_creates_without_panic() {
        let _engine = TextEngine::default();
    }

    #[test]
    fn shape_simple_text() {
        let mut engine = TextEngine::default();
        let buffer = engine.shape_text("hello", 12.0);
        let runs: Vec<_> = buffer.layout_runs().collect();
        assert!(!runs.is_empty(), "no layout runs");
    }

    #[test]
    fn measure_text_positive_dimensions() {
        let mut engine = TextEngine::default();
        let (w, h) = engine.measure("measure this", 10.0);
        assert!(w > 0.0);
        assert!(h > 0.0);
    }

    #[test]
    fn measure_empty_has_zero_width() {
        let mut engine = TextEngine::default();
        let (w, _h) = engine.measure("", 10.0);
        assert_eq!(w, 0.0);
    }
}
