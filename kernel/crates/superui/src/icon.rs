//! Icons — a small hand-drawn CAD-specific set + a bridge to
//! `egui-phosphor` for everything else (lucide-react replacement).
//!
//! Strategy: each `IconKind` first tries `phosphor_glyph()` for a
//! canonical Phosphor private-use char. If one exists the icon is
//! painted via the loaded egui-phosphor font (clean, lucide-equivalent
//! line glyph that scales perfectly at every size). Variants without a
//! good Phosphor match fall through to the original hand-painted code.
//! This swap restores the 1.0 visual identity (FolderOpen, FilePlus,
//! FloppyDisk, …) without breaking the ribbon's `IconKind` API.

use egui::{Color32, FontId, Painter, Rect, Stroke, Pos2};

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
    /// Copy — two overlapping page outlines.
    Copy,
    /// Paste — clipboard with page.
    Paste,
    /// Cut — scissors.
    Cut,
    /// Hand — pan tool.
    Hand,
    /// Mirror — vertical flip arrows.
    Mirror,
    /// Rotate — circular arrow.
    Rotate,
    /// Scale — diagonal arrow + corners.
    Scale,
    /// Settings — gear.
    Settings,
    /// Eye — visibility on.
    Eye,
    /// Grid — 3x3 grid pattern.
    Grid,
    /// ZoomIn — magnifying glass with plus.
    ZoomIn,
    /// ZoomOut — magnifying glass with minus.
    ZoomOut,
    /// FitAll — corners pointing outward.
    FitAll,
    /// Download — arrow into tray.
    Download,
    /// Folder — folder outline.
    Folder,
    /// Refresh — circular arrow.
    Refresh,
    /// Layers — stacked rectangles.
    Layers,
    /// Ruler — measure ruler.
    Ruler,
    /// Tag — label tag.
    Tag,
    /// Image — picture frame.
    Image,
    /// Group — package box.
    Group,
    /// Ungroup — broken package.
    Ungroup,
    /// Spline — wavy curve.
    Spline,
    /// Ellipse — flat oval.
    Ellipse,
    /// Search — magnifier.
    Search,
    /// Check — check mark.
    Check,
    /// Cross — X mark.
    Cross,
    // ---- Mockup measure icons (Round 10) ------------------------------
    /// Length — ruler/tape with ticks.
    MeasureLength,
    /// Area — pentagon with corner dots + cross-hatched diagonals.
    MeasureArea,
    /// Angle — two rays + arc.
    MeasureAngle,
    /// Coordinate — crosshair with axes + labelled point.
    MeasureCoord,
    /// Pan / hand — explicit drafting hand glyph.
    Pan,
    /// White-background "sun" — used by the View > White BG toggle.
    Sun,
    /// Palette / theme picker (mockup `Lucide.palette`).
    Palette,
    /// Right-side panel (mockup `Lucide.panelR`) — used for Properties.
    PanelR,
    /// Linear dimension (extension lines + arrowed dim line).
    LinearDim,
    /// Angular dimension (90° corner with arc).
    AngularDim,
    /// Radius dimension (circle with radial arrow).
    RadiusDim,
    /// Diameter dimension (circle with through-arrow).
    DiameterDim,
    /// Leader (multileader-style stub).
    Leader,
    /// Label (text-in-box).
    Label,
    /// Table (grid).
    Table,
    /// "Select All" — square with check.
    SelectAll,
    /// "Deselect" — square with X.
    Deselect,
    /// Copy ID — single sheet (no overlap) — to distinguish from Copy.
    CopyId,
    /// Zoom window — 4 corner squares (window-zoom marquee).
    ZoomWindow,
    /// Zoom previous — magnifier with back-arrow.
    ZoomPrevious,
    /// Zoom center — crosshair with target ring.
    ZoomCenter,
    /// IFC literal — renders the bold "IFC" string used in mockup
    /// `Lucide.ifcText` (kept here so consumers can pick it via IconKind).
    IfcText,
}

impl IconKind {
    /// Canonical Phosphor private-use char for this variant. Returning
    /// `Some(..)` makes `paint_icon` route through the egui-phosphor
    /// font (clean lucide-equivalent line glyph). Returning `None` keeps
    /// the hand-drawn fallback (for CAD-specific shapes without a good
    /// Phosphor match).
    ///
    /// Mappings target the 1.0 lucide-react glyphs:
    ///   Folder → FolderOpen, Rectangle → File, Move → ArrowsOutCardinal,
    ///   Settings → Gear, Eye → Eye, Hand → Hand, …
    pub fn phosphor_glyph(self) -> Option<&'static str> {
        use egui_phosphor::regular as ph;
        Some(match self {
            // File-group (1.0 Lucide: FolderOpen / FilePlus / FloppyDisk / FileText)
            IconKind::Folder    => ph::FOLDER_OPEN,
            IconKind::Rectangle => ph::FILE,            // generic "document"
            // Selection / Navigation
            IconKind::Move      => ph::ARROWS_OUT_CARDINAL,
            IconKind::Hand      => ph::HAND,
            // View navigation
            IconKind::ZoomIn    => ph::MAGNIFYING_GLASS_PLUS,
            IconKind::ZoomOut   => ph::MAGNIFYING_GLASS_MINUS,
            IconKind::FitAll    => ph::CORNERS_OUT,
            IconKind::Eye       => ph::EYE,
            IconKind::Grid      => ph::GRID_NINE,
            IconKind::Settings  => ph::GEAR,
            IconKind::Layers    => ph::STACK,
            IconKind::Search    => ph::MAGNIFYING_GLASS,
            // Modify
            IconKind::Mirror    => ph::FLIP_HORIZONTAL,
            IconKind::Rotate    => ph::ARROW_COUNTER_CLOCKWISE,
            IconKind::Scale     => ph::ARROWS_OUT,
            IconKind::Copy      => ph::COPY,
            IconKind::Cut       => ph::SCISSORS,
            IconKind::Paste     => ph::CLIPBOARD,
            IconKind::Delete    => ph::TRASH,
            IconKind::Refresh   => ph::ARROWS_CLOCKWISE,
            // Drawing primitives
            IconKind::Circle    => ph::CIRCLE,
            IconKind::Text      => ph::TEXT_T,
            IconKind::Image     => ph::IMAGE,
            IconKind::Tag       => ph::TAG,
            IconKind::Ruler     => ph::RULER,
            IconKind::Group     => ph::CUBE,
            IconKind::Ungroup   => ph::SQUARES_FOUR,
            // Marks
            IconKind::Check     => ph::CHECK,
            IconKind::Cross     => ph::X,
            IconKind::Download  => ph::DOWNLOAD_SIMPLE,
            // CAD-specific glyphs with no clean phosphor equivalent
            // — keep hand-painted (the originals already read well).
            IconKind::Line | IconKind::Arc | IconKind::Polyline |
            IconKind::Hatch | IconKind::Dimension | IconKind::Spline |
            IconKind::Ellipse |
            // Mockup-specific glyphs — all hand-painted to match the JSX
            // SVG paths in `Open2DViewerMockup.jsx` (`Cad.*` block lines
            // 126-218).
            IconKind::MeasureLength | IconKind::MeasureArea |
            IconKind::MeasureAngle | IconKind::MeasureCoord |
            IconKind::Pan | IconKind::Sun | IconKind::Palette |
            IconKind::PanelR | IconKind::LinearDim | IconKind::AngularDim |
            IconKind::RadiusDim | IconKind::DiameterDim |
            IconKind::Leader | IconKind::Label | IconKind::Table |
            IconKind::SelectAll | IconKind::Deselect | IconKind::CopyId |
            IconKind::ZoomWindow | IconKind::ZoomPrevious |
            IconKind::ZoomCenter | IconKind::IfcText => return None,
        })
    }
}

/// Paint an icon centred in `rect` using the given color. If the kind
/// has a Phosphor mapping (see `IconKind::phosphor_glyph`) the glyph is
/// rendered via the egui-phosphor font; otherwise we fall through to
/// the hand-drawn primitives. Stroke thickness scales with rect size so
/// the same IconKind looks right at Large/Medium/Small button sizes.
pub fn paint_icon(painter: &Painter, rect: Rect, kind: IconKind, color: Color32) {
    if let Some(glyph) = kind.phosphor_glyph() {
        // egui-phosphor glyphs are sized as text — the visual size of
        // the glyph is roughly `font_size * 0.85` in cap height. We pick
        // the font size so the glyph fills ~ inner 100 % of the square
        // cell. Phosphor glyphs are designed on a 256-px grid and
        // render crisply at any size.
        let cell = rect.width().min(rect.height());
        let font_size = cell * 1.15; // empirical: matches lucide weight
        painter.text(
            rect.center(),
            egui::Align2::CENTER_CENTER,
            glyph,
            FontId::new(font_size, egui::FontFamily::Proportional),
            color,
        );
        return;
    }
    paint_icon_handdrawn(painter, rect, kind, color);
}

/// Hand-painted fallback for CAD-specific glyphs without a clean
/// Phosphor equivalent (Line, Arc, Polyline, Hatch, Dimension, Spline,
/// Ellipse). Each glyph is drawn into the inner 80 % of `rect` with a
/// uniform stroke width so it visually matches the Phosphor weight.
fn paint_icon_handdrawn(painter: &Painter, rect: Rect, kind: IconKind, color: Color32) {
    let center = rect.center();
    // Normalize: every glyph is drawn into the inner 80 % of the rect
    // ("inner safe zone"). r = 0.40 * min(w, h) so the bounding box
    // is identical across all variants. Stroke width = r * 0.20
    // (clamped at 1.5 px floor) so phosphor and hand-drawn glyphs
    // share a single visual weight. To audit, paint all variants in
    // a grid (see `examples/icon_grid.rs` once added).
    let r = rect.width().min(rect.height()) * 0.40;
    let stroke = Stroke::new((r * 0.20).max(1.5), color);
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
            let w = r * 1.3;
            let h = r * 1.6;
            let fold = r * 0.45;
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
            let inset = r * 0.75;
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
        IconKind::Copy => {
            // Two overlapping page rectangles.
            let o = r * 0.25;
            let w = r * 1.0;
            let h = r * 1.3;
            let back = Rect::from_min_max(
                Pos2::new(center.x - w * 0.5 - o, center.y - h * 0.5 - o),
                Pos2::new(center.x + w * 0.5 - o, center.y + h * 0.5 - o),
            );
            let front = Rect::from_min_max(
                Pos2::new(center.x - w * 0.5 + o, center.y - h * 0.5 + o),
                Pos2::new(center.x + w * 0.5 + o, center.y + h * 0.5 + o),
            );
            painter.rect_stroke(back, 0.0, stroke);
            painter.rect_stroke(front, 0.0, stroke);
        }
        IconKind::Paste => {
            // Clipboard top + body.
            let body = Rect::from_center_size(center, egui::vec2(r * 1.6, r * 1.9));
            painter.rect_stroke(body, 0.0, stroke);
            let clip = Rect::from_center_size(
                Pos2::new(center.x, center.y - r * 0.85),
                egui::vec2(r * 0.9, r * 0.4),
            );
            painter.rect_stroke(clip, 0.0, stroke);
        }
        IconKind::Cut => {
            // Two scissor circles + crossed blades.
            let cy = center.y + r * 0.4;
            painter.circle_stroke(Pos2::new(center.x - r * 0.5, cy), r * 0.35, stroke);
            painter.circle_stroke(Pos2::new(center.x + r * 0.5, cy), r * 0.35, stroke);
            painter.line_segment(
                [Pos2::new(center.x - r * 0.3, cy - r * 0.2),
                 Pos2::new(center.x + r * 0.6, center.y - r * 0.7)],
                stroke,
            );
            painter.line_segment(
                [Pos2::new(center.x + r * 0.3, cy - r * 0.2),
                 Pos2::new(center.x - r * 0.6, center.y - r * 0.7)],
                stroke,
            );
        }
        IconKind::Hand => {
            // Simple hand silhouette: palm + 4 fingers as vertical lines.
            let palm = Rect::from_center_size(
                Pos2::new(center.x, center.y + r * 0.3),
                egui::vec2(r * 1.3, r * 0.9),
            );
            painter.rect_stroke(palm, 0.0, stroke);
            for i in 0..4 {
                let x = palm.left() + r * 0.2 + (i as f32) * (r * 0.3);
                painter.line_segment(
                    [Pos2::new(x, palm.top()), Pos2::new(x, palm.top() - r * 0.7)],
                    stroke,
                );
            }
        }
        IconKind::Mirror => {
            // Two arrows facing away from a vertical center line.
            painter.line_segment(
                [Pos2::new(center.x, center.y - r), Pos2::new(center.x, center.y + r)],
                Stroke::new(stroke.width * 0.7, color),
            );
            // Left arrow
            painter.line_segment([Pos2::new(center.x - r * 0.2, center.y), Pos2::new(center.x - r, center.y)], stroke);
            painter.line_segment([Pos2::new(center.x - r, center.y), Pos2::new(center.x - r * 0.6, center.y - r * 0.3)], stroke);
            painter.line_segment([Pos2::new(center.x - r, center.y), Pos2::new(center.x - r * 0.6, center.y + r * 0.3)], stroke);
            // Right arrow
            painter.line_segment([Pos2::new(center.x + r * 0.2, center.y), Pos2::new(center.x + r, center.y)], stroke);
            painter.line_segment([Pos2::new(center.x + r, center.y), Pos2::new(center.x + r * 0.6, center.y - r * 0.3)], stroke);
            painter.line_segment([Pos2::new(center.x + r, center.y), Pos2::new(center.x + r * 0.6, center.y + r * 0.3)], stroke);
        }
        IconKind::Rotate => {
            // Circular arrow ¾ around centre.
            let mut prev: Option<Pos2> = None;
            for i in 0..=18 {
                let t = (i as f32 / 18.0) * (std::f32::consts::TAU * 0.78) - 0.4;
                let p = Pos2::new(center.x + r * 0.85 * t.cos(), center.y + r * 0.85 * t.sin());
                if let Some(prev) = prev { painter.line_segment([prev, p], stroke); }
                prev = Some(p);
            }
            // Arrowhead at end.
            if let Some(end) = prev {
                painter.line_segment([end, Pos2::new(end.x - r * 0.3, end.y - r * 0.1)], stroke);
                painter.line_segment([end, Pos2::new(end.x - r * 0.1, end.y + r * 0.3)], stroke);
            }
        }
        IconKind::Scale => {
            // Diagonal arrow with two corner brackets.
            painter.line_segment(
                [Pos2::new(center.x - r * 0.7, center.y + r * 0.7),
                 Pos2::new(center.x + r * 0.7, center.y - r * 0.7)],
                stroke,
            );
            // Top-right bracket
            painter.line_segment([Pos2::new(center.x + r * 0.3, center.y - r * 0.7), Pos2::new(center.x + r * 0.7, center.y - r * 0.7)], stroke);
            painter.line_segment([Pos2::new(center.x + r * 0.7, center.y - r * 0.7), Pos2::new(center.x + r * 0.7, center.y - r * 0.3)], stroke);
            // Bottom-left bracket
            painter.line_segment([Pos2::new(center.x - r * 0.3, center.y + r * 0.7), Pos2::new(center.x - r * 0.7, center.y + r * 0.7)], stroke);
            painter.line_segment([Pos2::new(center.x - r * 0.7, center.y + r * 0.7), Pos2::new(center.x - r * 0.7, center.y + r * 0.3)], stroke);
        }
        IconKind::Settings => {
            // Gear: circle + 6 short teeth.
            painter.circle_stroke(center, r * 0.45, stroke);
            painter.circle_stroke(center, r * 0.18, stroke);
            for i in 0..6 {
                let a = (i as f32 / 6.0) * std::f32::consts::TAU;
                let p1 = Pos2::new(center.x + r * 0.55 * a.cos(), center.y + r * 0.55 * a.sin());
                let p2 = Pos2::new(center.x + r * 0.85 * a.cos(), center.y + r * 0.85 * a.sin());
                painter.line_segment([p1, p2], stroke);
            }
        }
        IconKind::Eye => {
            // Eye outline (lens shape): 2 arcs meeting at corners + pupil.
            let w = r * 1.0;
            let mut top: Vec<Pos2> = Vec::new();
            let mut bot: Vec<Pos2> = Vec::new();
            for i in 0..=10 {
                let t = (i as f32 / 10.0) * std::f32::consts::PI;
                top.push(Pos2::new(center.x - w + (i as f32 / 10.0) * (2.0 * w), center.y - r * 0.5 * t.sin()));
                bot.push(Pos2::new(center.x - w + (i as f32 / 10.0) * (2.0 * w), center.y + r * 0.5 * t.sin()));
            }
            for w_pair in top.windows(2) { painter.line_segment([w_pair[0], w_pair[1]], stroke); }
            for w_pair in bot.windows(2) { painter.line_segment([w_pair[0], w_pair[1]], stroke); }
            painter.circle_stroke(center, r * 0.25, stroke);
        }
        IconKind::Grid => {
            // 3x3 grid lines inside a square.
            let bx = Rect::from_center_size(center, egui::vec2(r * 1.6, r * 1.6));
            painter.rect_stroke(bx, 0.0, stroke);
            for i in 1..3 {
                let t = i as f32 / 3.0;
                painter.line_segment(
                    [Pos2::new(bx.left() + t * bx.width(), bx.top()),
                     Pos2::new(bx.left() + t * bx.width(), bx.bottom())],
                    Stroke::new(stroke.width * 0.7, color),
                );
                painter.line_segment(
                    [Pos2::new(bx.left(), bx.top() + t * bx.height()),
                     Pos2::new(bx.right(), bx.top() + t * bx.height())],
                    Stroke::new(stroke.width * 0.7, color),
                );
            }
        }
        IconKind::ZoomIn | IconKind::ZoomOut => {
            // Magnifier: circle + handle + plus/minus inside.
            let lc = Pos2::new(center.x - r * 0.2, center.y - r * 0.2);
            painter.circle_stroke(lc, r * 0.55, stroke);
            painter.line_segment(
                [Pos2::new(lc.x + r * 0.4, lc.y + r * 0.4), Pos2::new(center.x + r * 0.7, center.y + r * 0.7)],
                stroke,
            );
            painter.line_segment([Pos2::new(lc.x - r * 0.3, lc.y), Pos2::new(lc.x + r * 0.3, lc.y)], stroke);
            if matches!(kind, IconKind::ZoomIn) {
                painter.line_segment([Pos2::new(lc.x, lc.y - r * 0.3), Pos2::new(lc.x, lc.y + r * 0.3)], stroke);
            }
        }
        IconKind::FitAll => {
            // 4 corner brackets pointing outward.
            let s = r * 0.8;
            let t = r * 0.35;
            // TL
            painter.line_segment([Pos2::new(center.x - s, center.y - s + t), Pos2::new(center.x - s, center.y - s)], stroke);
            painter.line_segment([Pos2::new(center.x - s, center.y - s), Pos2::new(center.x - s + t, center.y - s)], stroke);
            // TR
            painter.line_segment([Pos2::new(center.x + s - t, center.y - s), Pos2::new(center.x + s, center.y - s)], stroke);
            painter.line_segment([Pos2::new(center.x + s, center.y - s), Pos2::new(center.x + s, center.y - s + t)], stroke);
            // BR
            painter.line_segment([Pos2::new(center.x + s, center.y + s - t), Pos2::new(center.x + s, center.y + s)], stroke);
            painter.line_segment([Pos2::new(center.x + s, center.y + s), Pos2::new(center.x + s - t, center.y + s)], stroke);
            // BL
            painter.line_segment([Pos2::new(center.x - s + t, center.y + s), Pos2::new(center.x - s, center.y + s)], stroke);
            painter.line_segment([Pos2::new(center.x - s, center.y + s), Pos2::new(center.x - s, center.y + s - t)], stroke);
        }
        IconKind::Download => {
            // Down arrow + tray underneath.
            painter.line_segment([Pos2::new(center.x, center.y - r * 0.8), Pos2::new(center.x, center.y + r * 0.3)], stroke);
            painter.line_segment([Pos2::new(center.x, center.y + r * 0.3), Pos2::new(center.x - r * 0.4, center.y - r * 0.1)], stroke);
            painter.line_segment([Pos2::new(center.x, center.y + r * 0.3), Pos2::new(center.x + r * 0.4, center.y - r * 0.1)], stroke);
            painter.line_segment([Pos2::new(center.x - r * 0.7, center.y + r * 0.7), Pos2::new(center.x + r * 0.7, center.y + r * 0.7)], stroke);
        }
        IconKind::Folder => {
            // Folder shape with tab.
            let body = Rect::from_min_max(
                Pos2::new(center.x - r * 0.9, center.y - r * 0.4),
                Pos2::new(center.x + r * 0.9, center.y + r * 0.7),
            );
            painter.rect_stroke(body, 0.0, stroke);
            painter.line_segment(
                [Pos2::new(body.left(), body.top()), Pos2::new(body.left() + r * 0.4, body.top() - r * 0.25)],
                stroke,
            );
            painter.line_segment(
                [Pos2::new(body.left() + r * 0.4, body.top() - r * 0.25), Pos2::new(body.left() + r * 0.85, body.top() - r * 0.25)],
                stroke,
            );
            painter.line_segment(
                [Pos2::new(body.left() + r * 0.85, body.top() - r * 0.25), Pos2::new(body.left() + r * 0.85, body.top())],
                stroke,
            );
        }
        IconKind::Refresh => {
            // Circular arrow ~270deg with arrowhead.
            let mut prev: Option<Pos2> = None;
            for i in 0..=14 {
                let t = (i as f32 / 14.0) * (std::f32::consts::TAU * 0.78);
                let p = Pos2::new(center.x + r * 0.75 * t.cos(), center.y + r * 0.75 * t.sin());
                if let Some(prev) = prev { painter.line_segment([prev, p], stroke); }
                prev = Some(p);
            }
        }
        IconKind::Layers => {
            // Three stacked diamonds offset vertically.
            for i in 0..3 {
                let y = center.y - r * 0.5 + (i as f32) * r * 0.5;
                let pts = [
                    Pos2::new(center.x, y - r * 0.3),
                    Pos2::new(center.x + r * 0.7, y),
                    Pos2::new(center.x, y + r * 0.3),
                    Pos2::new(center.x - r * 0.7, y),
                ];
                for w in 0..4 {
                    painter.line_segment([pts[w], pts[(w + 1) % 4]], Stroke::new(stroke.width * 0.85, color));
                }
            }
        }
        IconKind::Ruler => {
            // Tilted rectangle with tick marks along edge.
            let bx = Rect::from_center_size(center, egui::vec2(r * 1.8, r * 0.6));
            painter.rect_stroke(bx, 0.0, stroke);
            for i in 1..6 {
                let x = bx.left() + (i as f32 / 6.0) * bx.width();
                let len = if i % 2 == 0 { r * 0.35 } else { r * 0.2 };
                painter.line_segment(
                    [Pos2::new(x, bx.top()), Pos2::new(x, bx.top() + len)],
                    Stroke::new(stroke.width * 0.7, color),
                );
            }
        }
        IconKind::Tag => {
            // Tag/label shape: pentagon pointing right.
            let pts = [
                Pos2::new(center.x - r * 0.8, center.y - r * 0.5),
                Pos2::new(center.x + r * 0.3, center.y - r * 0.5),
                Pos2::new(center.x + r * 0.8, center.y),
                Pos2::new(center.x + r * 0.3, center.y + r * 0.5),
                Pos2::new(center.x - r * 0.8, center.y + r * 0.5),
            ];
            for w in 0..5 {
                painter.line_segment([pts[w], pts[(w + 1) % 5]], stroke);
            }
            painter.circle_stroke(Pos2::new(center.x - r * 0.55, center.y), r * 0.12, stroke);
        }
        IconKind::Image => {
            // Frame + sun + mountain triangle.
            let bx = Rect::from_center_size(center, egui::vec2(r * 1.7, r * 1.4));
            painter.rect_stroke(bx, 0.0, stroke);
            painter.circle_stroke(Pos2::new(bx.left() + r * 0.4, bx.top() + r * 0.4), r * 0.18, stroke);
            painter.line_segment(
                [Pos2::new(bx.left(), bx.bottom()),
                 Pos2::new(center.x - r * 0.1, bx.center().y)],
                stroke,
            );
            painter.line_segment(
                [Pos2::new(center.x - r * 0.1, bx.center().y),
                 Pos2::new(bx.right(), bx.bottom())],
                stroke,
            );
        }
        IconKind::Group => {
            // 3D box outline (cube).
            let p = r * 0.7;
            let d = r * 0.3;
            let front = Rect::from_min_max(Pos2::new(center.x - p, center.y - p + d), Pos2::new(center.x + p - d, center.y + p));
            painter.rect_stroke(front, 0.0, stroke);
            // Back-top edges
            painter.line_segment([Pos2::new(front.left() + d, front.top() - d), Pos2::new(front.right() + d, front.top() - d)], stroke);
            painter.line_segment([Pos2::new(front.left(), front.top()), Pos2::new(front.left() + d, front.top() - d)], stroke);
            painter.line_segment([Pos2::new(front.right(), front.top()), Pos2::new(front.right() + d, front.top() - d)], stroke);
            painter.line_segment([Pos2::new(front.right(), front.bottom()), Pos2::new(front.right() + d, front.bottom() - d)], stroke);
            painter.line_segment([Pos2::new(front.right() + d, front.top() - d), Pos2::new(front.right() + d, front.bottom() - d)], stroke);
        }
        IconKind::Ungroup => {
            // Two separated small boxes.
            let s = r * 0.55;
            let a = Rect::from_center_size(Pos2::new(center.x - r * 0.4, center.y - r * 0.4), egui::vec2(s, s));
            let b = Rect::from_center_size(Pos2::new(center.x + r * 0.4, center.y + r * 0.4), egui::vec2(s, s));
            painter.rect_stroke(a, 0.0, stroke);
            painter.rect_stroke(b, 0.0, stroke);
        }
        IconKind::Spline => {
            // Wavy curve sampled.
            let mut prev: Option<Pos2> = None;
            for i in 0..=20 {
                let t = i as f32 / 20.0;
                let x = center.x - r + t * 2.0 * r;
                let y = center.y + (t * std::f32::consts::TAU * 1.2).sin() * r * 0.5;
                let p = Pos2::new(x, y);
                if let Some(prev) = prev { painter.line_segment([prev, p], stroke); }
                prev = Some(p);
            }
        }
        IconKind::Ellipse => {
            // Flatter oval.
            let mut prev: Option<Pos2> = None;
            for i in 0..=24 {
                let t = (i as f32 / 24.0) * std::f32::consts::TAU;
                let p = Pos2::new(center.x + r * 1.0 * t.cos(), center.y + r * 0.55 * t.sin());
                if let Some(prev) = prev { painter.line_segment([prev, p], stroke); }
                prev = Some(p);
            }
        }
        IconKind::Search => {
            // Magnifier circle + handle.
            let lc = Pos2::new(center.x - r * 0.2, center.y - r * 0.2);
            painter.circle_stroke(lc, r * 0.55, stroke);
            painter.line_segment(
                [Pos2::new(lc.x + r * 0.4, lc.y + r * 0.4), Pos2::new(center.x + r * 0.7, center.y + r * 0.7)],
                stroke,
            );
        }
        IconKind::Check => {
            painter.line_segment([Pos2::new(center.x - r * 0.7, center.y), Pos2::new(center.x - r * 0.15, center.y + r * 0.55)], stroke);
            painter.line_segment([Pos2::new(center.x - r * 0.15, center.y + r * 0.55), Pos2::new(center.x + r * 0.7, center.y - r * 0.5)], stroke);
        }
        IconKind::Cross => {
            painter.line_segment([Pos2::new(center.x - r * 0.65, center.y - r * 0.65), Pos2::new(center.x + r * 0.65, center.y + r * 0.65)], stroke);
            painter.line_segment([Pos2::new(center.x + r * 0.65, center.y - r * 0.65), Pos2::new(center.x - r * 0.65, center.y + r * 0.65)], stroke);
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
        // -----------------------------------------------------------------
        // Mockup-specific glyphs (Round 4/5/10 — viewer port). Each
        // mirrors the SVG path data in `Open2DViewerMockup.jsx` lines
        // 126-218 (the `Cad.*` and `Lucide.*` blocks). All are drawn into
        // the inner 80 % of the cell so they share visual weight with the
        // Phosphor glyphs.
        // -----------------------------------------------------------------
        IconKind::MeasureLength => {
            // Tape measure — rounded rectangle with 6 vertical tick marks
            // (alternate short / long). Mirrors mockup `Cad.measureLength`
            // (Open2DViewerMockup.jsx lines 171-182).
            let bx = Rect::from_center_size(center, egui::vec2(r * 1.85, r * 0.7));
            // Approximate rounded rect: outline + corner stubs.
            painter.rect_stroke(bx, 2.0, stroke);
            // 6 tick marks evenly spaced — 5/8/11/14/17/20 px in mockup
            // viewBox 24, normalized here to bx.width().
            for i in 0..6 {
                let t = (i as f32 + 0.5) / 6.0;
                let x = bx.left() + t * bx.width();
                let h = if i == 2 || i == 5 { bx.height() * 0.95 } else { bx.height() * 0.55 };
                painter.line_segment(
                    [Pos2::new(x, bx.top()), Pos2::new(x, bx.top() + h)],
                    Stroke::new(stroke.width * 0.85, color),
                );
            }
        }
        IconKind::MeasureArea => {
            // Pentagon outline + 5 corner dots + 3 cross-hatched
            // diagonals (mockup `Cad.measureArea` lines 184-197).
            let pts = [
                Pos2::new(center.x, center.y - r),
                Pos2::new(center.x + r * 0.95, center.y - r * 0.3),
                Pos2::new(center.x + r * 0.6, center.y + r * 0.85),
                Pos2::new(center.x - r * 0.6, center.y + r * 0.85),
                Pos2::new(center.x - r * 0.95, center.y - r * 0.3),
            ];
            for i in 0..5 {
                painter.line_segment([pts[i], pts[(i + 1) % 5]], stroke);
            }
            // Faint cross-hatch diagonals (mockup strokeOpacity 0.35).
            let dim_color = Color32::from_rgba_unmultiplied(
                color.r(), color.g(), color.b(),
                (color.a() as f32 * 0.35) as u8,
            );
            let dim_stroke = Stroke::new(stroke.width * 0.75, dim_color);
            // Three faint diagonals across the pentagon.
            painter.line_segment([pts[2], pts[0]], dim_stroke);
            painter.line_segment([pts[3], pts[1]], dim_stroke);
            painter.line_segment([pts[4], pts[1]], dim_stroke);
            // Corner dots — slightly larger to read as anchor handles.
            for p in pts.iter() {
                painter.circle_filled(*p, stroke.width * 1.3, color);
            }
        }
        IconKind::MeasureAngle => {
            // Two rays from lower-left + arc + filled vertex dot.
            let origin = Pos2::new(center.x - r * 0.85, center.y + r * 0.85);
            painter.line_segment(
                [origin, Pos2::new(center.x + r * 0.9, origin.y)],
                stroke,
            );
            painter.line_segment(
                [origin, Pos2::new(center.x + r * 0.95, center.y - r * 0.6)],
                stroke,
            );
            // Arc 0° → ~45°.
            let arc_r = r * 0.6;
            let mut prev: Option<Pos2> = None;
            let steps = 8;
            for i in 0..=steps {
                let t = (i as f32 / steps as f32) * std::f32::consts::FRAC_PI_4;
                let p = Pos2::new(origin.x + arc_r * t.cos(), origin.y - arc_r * t.sin());
                if let Some(prev) = prev { painter.line_segment([prev, p], stroke); }
                prev = Some(p);
            }
            painter.circle_filled(origin, stroke.width * 1.5, color);
        }
        IconKind::MeasureCoord => {
            // Crosshair: vertical + horizontal axes through centre, ring
            // + filled centre dot.
            painter.line_segment(
                [Pos2::new(center.x, center.y - r), Pos2::new(center.x, center.y + r)],
                stroke,
            );
            painter.line_segment(
                [Pos2::new(center.x - r, center.y), Pos2::new(center.x + r, center.y)],
                stroke,
            );
            painter.circle_stroke(center, r * 0.35, stroke);
            painter.circle_filled(center, stroke.width * 1.2, color);
        }
        IconKind::Pan => {
            // Hand silhouette with extended thumb — matches Lucide `hand`.
            let palm = Rect::from_center_size(
                Pos2::new(center.x, center.y + r * 0.35),
                egui::vec2(r * 1.2, r * 1.0),
            );
            painter.rect_stroke(palm, 0.0, stroke);
            for i in 0..4 {
                let x = palm.left() + r * 0.25 + (i as f32) * (r * 0.25);
                let h = if i == 1 { r * 1.0 } else if i == 2 { r * 0.95 } else { r * 0.7 };
                painter.line_segment(
                    [Pos2::new(x, palm.top()), Pos2::new(x, palm.top() - h)],
                    stroke,
                );
            }
        }
        IconKind::Sun => {
            // Sun: center circle + 8 ticks around it.
            painter.circle_stroke(center, r * 0.4, stroke);
            for i in 0..8 {
                let a = (i as f32 / 8.0) * std::f32::consts::TAU;
                let inner = Pos2::new(center.x + r * 0.6 * a.cos(), center.y + r * 0.6 * a.sin());
                let outer = Pos2::new(center.x + r * 0.95 * a.cos(), center.y + r * 0.95 * a.sin());
                painter.line_segment([inner, outer], Stroke::new(stroke.width * 0.85, color));
            }
        }
        IconKind::Palette => {
            // Paint palette: rough oval + 4 colour dots.
            // Approximate the round palette shape by a many-segment circle
            // with an inset.
            let mut prev: Option<Pos2> = None;
            for i in 0..=24 {
                let t = (i as f32 / 24.0) * std::f32::consts::TAU;
                let p = Pos2::new(center.x + r * 0.95 * t.cos(), center.y + r * 0.95 * t.sin());
                if let Some(prev) = prev { painter.line_segment([prev, p], stroke); }
                prev = Some(p);
            }
            for (dx, dy) in &[(-0.45, -0.25), (-0.1, -0.55), (0.35, -0.45), (0.5, 0.1)] {
                painter.circle_filled(
                    Pos2::new(center.x + dx * r, center.y + dy * r),
                    stroke.width * 1.5,
                    color,
                );
            }
        }
        IconKind::PanelR => {
            // Outer frame + vertical divider near right edge — mockup
            // `Lucide.panelR` "M3 4h18v16H3z M15 4v16".
            let bx = Rect::from_center_size(center, egui::vec2(r * 1.7, r * 1.3));
            painter.rect_stroke(bx, 0.0, stroke);
            painter.line_segment(
                [Pos2::new(bx.right() - r * 0.55, bx.top()),
                 Pos2::new(bx.right() - r * 0.55, bx.bottom())],
                stroke,
            );
        }
        IconKind::LinearDim => {
            // Two extension lines + dimension line + arrows at each end.
            let y_dim = center.y - r * 0.1;
            // extension lines (down to a baseline below).
            painter.line_segment(
                [Pos2::new(center.x - r * 0.85, y_dim - r * 0.5),
                 Pos2::new(center.x - r * 0.85, y_dim + r * 0.5)],
                stroke,
            );
            painter.line_segment(
                [Pos2::new(center.x + r * 0.85, y_dim - r * 0.5),
                 Pos2::new(center.x + r * 0.85, y_dim + r * 0.5)],
                stroke,
            );
            painter.line_segment(
                [Pos2::new(center.x - r * 0.85, y_dim),
                 Pos2::new(center.x + r * 0.85, y_dim)],
                stroke,
            );
            // Arrowheads (filled triangles via two short strokes).
            painter.line_segment(
                [Pos2::new(center.x - r * 0.85, y_dim),
                 Pos2::new(center.x - r * 0.55, y_dim - r * 0.15)], stroke);
            painter.line_segment(
                [Pos2::new(center.x - r * 0.85, y_dim),
                 Pos2::new(center.x - r * 0.55, y_dim + r * 0.15)], stroke);
            painter.line_segment(
                [Pos2::new(center.x + r * 0.85, y_dim),
                 Pos2::new(center.x + r * 0.55, y_dim - r * 0.15)], stroke);
            painter.line_segment(
                [Pos2::new(center.x + r * 0.85, y_dim),
                 Pos2::new(center.x + r * 0.55, y_dim + r * 0.15)], stroke);
        }
        IconKind::AngularDim => {
            // Right angle with arc.
            painter.line_segment(
                [Pos2::new(center.x - r * 0.85, center.y + r * 0.85),
                 Pos2::new(center.x + r * 0.85, center.y + r * 0.85)], stroke);
            painter.line_segment(
                [Pos2::new(center.x - r * 0.85, center.y + r * 0.85),
                 Pos2::new(center.x + r * 0.45, center.y - r * 0.7)], stroke);
            let mut prev: Option<Pos2> = None;
            for i in 0..=8 {
                let t = (i as f32 / 8.0) * std::f32::consts::FRAC_PI_3;
                let p = Pos2::new(
                    center.x - r * 0.85 + r * 0.7 * t.cos(),
                    center.y + r * 0.85 - r * 0.7 * t.sin(),
                );
                if let Some(prev) = prev { painter.line_segment([prev, p], stroke); }
                prev = Some(p);
            }
        }
        IconKind::RadiusDim => {
            // Circle with radial arrow to upper-right.
            painter.circle_stroke(center, r * 0.7, stroke);
            painter.line_segment(
                [center, Pos2::new(center.x + r * 0.6, center.y - r * 0.5)], stroke);
            painter.line_segment(
                [Pos2::new(center.x + r * 0.6, center.y - r * 0.5),
                 Pos2::new(center.x + r * 0.35, center.y - r * 0.4)], stroke);
            painter.line_segment(
                [Pos2::new(center.x + r * 0.6, center.y - r * 0.5),
                 Pos2::new(center.x + r * 0.5, center.y - r * 0.25)], stroke);
        }
        IconKind::DiameterDim => {
            // Circle with through-arrow.
            painter.circle_stroke(center, r * 0.7, stroke);
            painter.line_segment(
                [Pos2::new(center.x - r * 0.7, center.y),
                 Pos2::new(center.x + r * 0.7, center.y)], stroke);
            // Arrowheads at both ends.
            painter.line_segment(
                [Pos2::new(center.x - r * 0.7, center.y),
                 Pos2::new(center.x - r * 0.45, center.y - r * 0.18)], stroke);
            painter.line_segment(
                [Pos2::new(center.x - r * 0.7, center.y),
                 Pos2::new(center.x - r * 0.45, center.y + r * 0.18)], stroke);
            painter.line_segment(
                [Pos2::new(center.x + r * 0.7, center.y),
                 Pos2::new(center.x + r * 0.45, center.y - r * 0.18)], stroke);
            painter.line_segment(
                [Pos2::new(center.x + r * 0.7, center.y),
                 Pos2::new(center.x + r * 0.45, center.y + r * 0.18)], stroke);
        }
        IconKind::Leader => {
            // Diagonal stroke with arrowhead + short horizontal tail.
            painter.line_segment(
                [Pos2::new(center.x - r * 0.85, center.y + r * 0.85),
                 Pos2::new(center.x + r * 0.2, center.y - r * 0.3)], stroke);
            // arrowhead
            painter.line_segment(
                [Pos2::new(center.x - r * 0.85, center.y + r * 0.85),
                 Pos2::new(center.x - r * 0.55, center.y + r * 0.75)], stroke);
            painter.line_segment(
                [Pos2::new(center.x - r * 0.85, center.y + r * 0.85),
                 Pos2::new(center.x - r * 0.7, center.y + r * 0.5)], stroke);
            // tail (label connector)
            painter.line_segment(
                [Pos2::new(center.x + r * 0.2, center.y - r * 0.3),
                 Pos2::new(center.x + r * 0.85, center.y - r * 0.3)], stroke);
        }
        IconKind::Label => {
            // Box with 3 horizontal lines inside (like text in label).
            let bx = Rect::from_center_size(center, egui::vec2(r * 1.7, r * 1.4));
            painter.rect_stroke(bx, 0.0, stroke);
            for i in 0..3 {
                let y = bx.top() + (i as f32 + 1.0) * bx.height() / 4.0;
                let w_factor = if i == 2 { 0.6 } else { 0.85 };
                painter.line_segment(
                    [Pos2::new(bx.left() + r * 0.2, y),
                     Pos2::new(bx.left() + r * 0.2 + bx.width() * w_factor - r * 0.2, y)],
                    Stroke::new(stroke.width * 0.85, color),
                );
            }
        }
        IconKind::Table => {
            // Grid: outer frame + 1 horizontal divider + 1 vertical.
            let bx = Rect::from_center_size(center, egui::vec2(r * 1.8, r * 1.5));
            painter.rect_stroke(bx, 0.0, stroke);
            painter.line_segment(
                [Pos2::new(bx.left(), bx.center().y),
                 Pos2::new(bx.right(), bx.center().y)],
                Stroke::new(stroke.width * 0.85, color),
            );
            painter.line_segment(
                [Pos2::new(bx.center().x, bx.top()),
                 Pos2::new(bx.center().x, bx.bottom())],
                Stroke::new(stroke.width * 0.85, color),
            );
        }
        IconKind::SelectAll => {
            // Square with check mark inside.
            let bx = Rect::from_center_size(center, egui::vec2(r * 1.6, r * 1.6));
            painter.rect_stroke(bx, 0.0, stroke);
            painter.line_segment(
                [Pos2::new(bx.left() + r * 0.3, bx.center().y),
                 Pos2::new(bx.center().x, bx.bottom() - r * 0.3)], stroke);
            painter.line_segment(
                [Pos2::new(bx.center().x, bx.bottom() - r * 0.3),
                 Pos2::new(bx.right() - r * 0.3, bx.top() + r * 0.3)], stroke);
        }
        IconKind::Deselect => {
            // Square with X inside.
            let bx = Rect::from_center_size(center, egui::vec2(r * 1.6, r * 1.6));
            painter.rect_stroke(bx, 0.0, stroke);
            painter.line_segment(
                [Pos2::new(bx.left() + r * 0.3, bx.top() + r * 0.3),
                 Pos2::new(bx.right() - r * 0.3, bx.bottom() - r * 0.3)], stroke);
            painter.line_segment(
                [Pos2::new(bx.right() - r * 0.3, bx.top() + r * 0.3),
                 Pos2::new(bx.left() + r * 0.3, bx.bottom() - r * 0.3)], stroke);
        }
        IconKind::CopyId => {
            // Single sheet (clipboard top + body).
            let body = Rect::from_center_size(center, egui::vec2(r * 1.4, r * 1.7));
            painter.rect_stroke(body, 0.0, stroke);
            let tab = Rect::from_center_size(
                Pos2::new(center.x, body.top() - r * 0.1),
                egui::vec2(r * 0.8, r * 0.4),
            );
            painter.rect_stroke(tab, 0.0, Stroke::new(stroke.width * 0.85, color));
        }
        IconKind::ZoomWindow => {
            // 4 corner squares (window-marquee).
            let s = r * 0.45;
            for (dx, dy) in &[(-1.0, -1.0), (1.0, -1.0), (-1.0, 1.0), (1.0, 1.0)] {
                let c = Pos2::new(center.x + dx * r * 0.55, center.y + dy * r * 0.55);
                let bx = Rect::from_center_size(c, egui::vec2(s, s));
                painter.rect_stroke(bx, 0.0, Stroke::new(stroke.width * 0.85, color));
            }
        }
        IconKind::ZoomPrevious => {
            // Magnifier + back-arrow inside.
            let lc = Pos2::new(center.x - r * 0.2, center.y - r * 0.2);
            painter.circle_stroke(lc, r * 0.55, stroke);
            painter.line_segment(
                [Pos2::new(lc.x + r * 0.4, lc.y + r * 0.4),
                 Pos2::new(center.x + r * 0.7, center.y + r * 0.7)],
                stroke,
            );
            // Back-arrow (◀ inside the lens).
            painter.line_segment(
                [Pos2::new(lc.x + r * 0.2, lc.y),
                 Pos2::new(lc.x - r * 0.2, lc.y)], Stroke::new(stroke.width * 0.85, color));
            painter.line_segment(
                [Pos2::new(lc.x - r * 0.2, lc.y),
                 Pos2::new(lc.x - r * 0.05, lc.y - r * 0.15)], Stroke::new(stroke.width * 0.85, color));
            painter.line_segment(
                [Pos2::new(lc.x - r * 0.2, lc.y),
                 Pos2::new(lc.x - r * 0.05, lc.y + r * 0.15)], Stroke::new(stroke.width * 0.85, color));
        }
        IconKind::ZoomCenter => {
            // Crosshair with ring (target).
            painter.circle_stroke(center, r * 0.55, stroke);
            painter.line_segment(
                [Pos2::new(center.x - r * 0.9, center.y),
                 Pos2::new(center.x + r * 0.9, center.y)],
                Stroke::new(stroke.width * 0.85, color),
            );
            painter.line_segment(
                [Pos2::new(center.x, center.y - r * 0.9),
                 Pos2::new(center.x, center.y + r * 0.9)],
                Stroke::new(stroke.width * 0.85, color),
            );
        }
        IconKind::IfcText => {
            // Render bold "IFC" text inside the cell — used for the
            // View > IFC Model toggle. Monospace look mirrors mockup.
            painter.text(
                center,
                egui::Align2::CENTER_CENTER,
                "IFC",
                FontId::new(rect.width().min(rect.height()) * 0.55, egui::FontFamily::Monospace),
                color,
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
