//! Style table — gedeelde styling data (colors, line widths, dash patterns).
//! Small, uniform-buffer-friendly: typisch < 1000 styles per drawing.

use bevy_ecs::prelude::*;

#[derive(Copy, Clone, Debug, Default)]
pub struct Style {
    pub stroke_color_rgba: [u8; 4],
    pub fill_color_rgba: [u8; 4],
    pub line_width_mm: f32,
    pub line_style: LineStyle,
}

#[derive(Copy, Clone, Debug, Default)]
pub enum LineStyle {
    #[default]
    Solid,
    Dashed,
    Dotted,
    DashDot,
    Center,
}

#[derive(Resource, Default)]
pub struct StyleTable {
    pub styles: Vec<Style>,
}

impl StyleTable {
    pub fn insert(&mut self, style: Style) -> u32 {
        let idx = self.styles.len() as u32;
        self.styles.push(style);
        idx
    }
}
