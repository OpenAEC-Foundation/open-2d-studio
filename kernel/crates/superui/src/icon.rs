//! Icons — a small hand-drawn CAD-specific set + a bridge to
//! `egui-phosphor` for everything else (lucide-react replacement).

use egui::{Color32, Painter, Rect, Stroke, Pos2};

/// Phase 1 essential CAD icons. Hand-painted via egui::Painter so we
/// don't depend on raster/font assets for these. Other 1.0 icons
/// (lucide-react names) are fetched from `egui-phosphor`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum IconKind {
    /// Straight line — two points connected by a stroke.
    Line,
    /// Arc — quarter circle.
    Arc,
    /// Polyline — three connected segments forming a zigzag.
    Polyline,
    /// Circle outline.
    Circle,
    /// Rectangle outline.
    Rectangle,
    /// Hatch — diagonal line pattern in a rect.
    Hatch,
    /// Linear dimension — line with arrowheads + text indicator.
    Dimension,
    /// Text "T" glyph indicator.
    Text,
    /// Move — four-direction arrow cross.
    Move,
    /// Delete — trash bin.
    Delete,
}

/// Paint an icon centred in `rect` using the given color. Stroke
/// thickness scales with rect size so the same IconKind looks right
/// at large/medium/small button sizes.
pub fn paint_icon(painter: &Painter, rect: Rect, kind: IconKind, color: Color32) {
    let center = rect.center();
    let r = rect.width().min(rect.height()) * 0.45;
    // 1.0's lucide icons render with stroke-width: 2 at 24×24 → 1/12 ratio.
    // Round 8 polish: bump the floor to 1.7 px so Small (14 px) icons read
    // as solid glyphs instead of hairlines on the warm-dark body. Larger
    // ratio (0.16) keeps Large (24 px) icons appropriately bold.
    let stroke = Stroke::new((r * 0.16).max(1.7), color);
    match kind {
        IconKind::Line => {
            painter.line_segment(
                [Pos2::new(center.x - r, center.y + r * 0.4),
                 Pos2::new(center.x + r, center.y - r * 0.4)],
                stroke,
            );
        }
        IconKind::Arc => {
            // Approximate quarter arc with 8 segments.
            let mut prev: Option<Pos2> = None;
            for i in 0..=8 {
                let t = (i as f32 / 8.0) * std::f32::consts::FRAC_PI_2;
                let p = Pos2::new(center.x + r * t.cos() - r * 0.2,
                                  center.y + r * t.sin() - r * 0.2);
                if let Some(prev) = prev {
                    painter.line_segment([prev, p], stroke);
                }
                prev = Some(p);
            }
        }
        IconKind::Polyline => {
            let pts = [
                Pos2::new(center.x - r,        center.y + r * 0.5),
                Pos2::new(center.x - r * 0.3,  center.y - r * 0.5),
                Pos2::new(center.x + r * 0.3,  center.y + r * 0.2),
                Pos2::new(center.x + r,        center.y - r * 0.4),
            ];
            for w in pts.windows(2) {
                painter.line_segment([w[0], w[1]], stroke);
            }
        }
        IconKind::Circle => {
            painter.circle_stroke(center, r * 0.85, stroke);
        }
        IconKind::Rectangle => {
            // Lucide-style "file" / page outline with folded top-right
            // corner — used widely as the generic placeholder in 1.0
            // Ribbon button slots, so we upgrade it from a plain box to
            // something that reads as "document" at a glance.
            let w = r * 1.5;
            let h = r * 1.85;
            let fold = r * 0.55;
            let top_left   = Pos2::new(center.x - w * 0.5, center.y - h * 0.5);
            let top_right0 = Pos2::new(center.x + w * 0.5 - fold, center.y - h * 0.5);
            let top_right1 = Pos2::new(center.x + w * 0.5, center.y - h * 0.5 + fold);
            let bot_right  = Pos2::new(center.x + w * 0.5, center.y + h * 0.5);
            let bot_left   = Pos2::new(center.x - w * 0.5, center.y + h * 0.5);
            // Page outline (5 segments, including the diagonal fold).
            painter.line_segment([top_left,   top_right0], stroke);
            painter.line_segment([top_right0, top_right1], stroke);
            painter.line_segment([top_right1, bot_right ], stroke);
            painter.line_segment([bot_right,  bot_left  ], stroke);
            painter.line_segment([bot_left,   top_left  ], stroke);
            // Folded-corner triangle interior edges.
            painter.line_segment(
                [top_right0, Pos2::new(top_right0.x + fold * 0.0, top_right0.y + fold)],
                Stroke::new(stroke.width * 0.85, color),
            );
            painter.line_segment(
                [Pos2::new(top_right0.x, top_right0.y + fold), top_right1],
                Stroke::new(stroke.width * 0.85, color),
            );
            // Two text-like ruling lines.
            let lx0 = top_left.x + r * 0.35;
            let lx1 = bot_right.x - r * 0.35;
            painter.line_segment(
                [Pos2::new(lx0, center.y + r * 0.15),
                 Pos2::new(lx1, center.y + r * 0.15)],
                Stroke::new(stroke.width * 0.7, color),
            );
            painter.line_segment(
                [Pos2::new(lx0, center.y + r * 0.6),
                 Pos2::new(lx1 - r * 0.4, center.y + r * 0.6)],
                Stroke::new(stroke.width * 0.7, color),
            );
        }
        IconKind::Hatch => {
            let inset = r * 0.85;
            let bx = Rect::from_center_size(center, egui::vec2(inset * 2.0, inset * 1.4));
            painter.rect_stroke(bx, 0.0, stroke);
            // Diagonal lines inside.
            let n = 4;
            for i in 0..n {
                let t = (i as f32 + 0.5) / n as f32;
                let x = bx.left() + t * bx.width();
                painter.line_segment(
                    [Pos2::new(x, bx.top()), Pos2::new(x - bx.height(), bx.bottom())],
                    Stroke::new(stroke.width * 0.6, color),
                );
            }
        }
        IconKind::Dimension => {
            let y = center.y;
            painter.line_segment(
                [Pos2::new(center.x - r, y), Pos2::new(center.x + r, y)],
                stroke,
            );
            // Tick marks at ends.
            for &x in &[-r, r] {
                painter.line_segment(
                    [Pos2::new(center.x + x, y - r * 0.3),
                     Pos2::new(center.x + x, y + r * 0.3)],
                    stroke,
                );
            }
        }
        IconKind::Text => {
            // "T" — horizontal cap + vertical stem.
            let cap_w = r * 0.9;
            let stem_h = r * 0.9;
            painter.line_segment(
                [Pos2::new(center.x - cap_w, center.y - stem_h),
                 Pos2::new(center.x + cap_w, center.y - stem_h)],
                stroke,
            );
            painter.line_segment(
                [Pos2::new(center.x, center.y - stem_h),
                 Pos2::new(center.x, center.y + stem_h)],
                stroke,
            );
        }
        IconKind::Move => {
            // Four-direction arrows from centre.
            for &(dx, dy) in &[(1.0, 0.0), (-1.0, 0.0), (0.0, 1.0), (0.0, -1.0)] {
                let tip = Pos2::new(center.x + dx * r, center.y + dy * r);
                let base = Pos2::new(center.x + dx * r * 0.3, center.y + dy * r * 0.3);
                painter.line_segment([base, tip], stroke);
                let perp_x = -dy;
                let perp_y = dx;
                let head_back = Pos2::new(tip.x - dx * r * 0.3, tip.y - dy * r * 0.3);
                painter.line_segment(
                    [tip, Pos2::new(head_back.x + perp_x * r * 0.18, head_back.y + perp_y * r * 0.18)],
                    stroke,
                );
                painter.line_segment(
                    [tip, Pos2::new(head_back.x - perp_x * r * 0.18, head_back.y - perp_y * r * 0.18)],
                    stroke,
                );
            }
        }
        IconKind::Delete => {
            // Simple trash bin — top lid + body rectangle + handle.
            let body = Rect::from_center_size(
                Pos2::new(center.x, center.y + r * 0.15),
                egui::vec2(r * 1.4, r * 1.6),
            );
            painter.rect_stroke(body, 0.0, stroke);
            painter.line_segment(
                [Pos2::new(body.left() - r * 0.2, body.top() - r * 0.15),
                 Pos2::new(body.right() + r * 0.2, body.top() - r * 0.15)],
                stroke,
            );
            painter.line_segment(
                [Pos2::new(center.x - r * 0.3, body.top() - r * 0.15),
                 Pos2::new(center.x - r * 0.3, body.top() - r * 0.4)],
                stroke,
            );
            painter.line_segment(
                [Pos2::new(center.x + r * 0.3, body.top() - r * 0.15),
                 Pos2::new(center.x + r * 0.3, body.top() - r * 0.4)],
                stroke,
            );
            painter.line_segment(
                [Pos2::new(center.x - r * 0.3, body.top() - r * 0.4),
                 Pos2::new(center.x + r * 0.3, body.top() - r * 0.4)],
                stroke,
            );
        }
    }
}

/// Phosphor icon font integration. Returns the unicode char for a
/// given Phosphor icon name. The consumer renders this as a string
/// using the egui-phosphor font installed via `add_to_fonts`.
///
/// Call `egui_phosphor::add_to_fonts(fonts, egui_phosphor::Variant::Regular)`
/// once at app startup to make these chars available.
pub fn phosphor(name: &str) -> &'static str {
    match name {
        "save" => egui_phosphor::regular::FLOPPY_DISK,
        "open" => egui_phosphor::regular::FOLDER_OPEN,
        "new" => egui_phosphor::regular::FILE_PLUS,
        "undo" => egui_phosphor::regular::ARROW_COUNTER_CLOCKWISE,
        "redo" => egui_phosphor::regular::ARROW_CLOCKWISE,
        "settings" => egui_phosphor::regular::GEAR,
        "search" => egui_phosphor::regular::MAGNIFYING_GLASS,
        "info" => egui_phosphor::regular::INFO,
        "warning" => egui_phosphor::regular::WARNING,
        "close" => egui_phosphor::regular::X,
        "print" => egui_phosphor::regular::PRINTER,
        "menu" => egui_phosphor::regular::LIST,
        "chevron_down" => egui_phosphor::regular::CARET_DOWN,
        "plus" => egui_phosphor::regular::PLUS,
        _ => egui_phosphor::regular::QUESTION,
    }
}
