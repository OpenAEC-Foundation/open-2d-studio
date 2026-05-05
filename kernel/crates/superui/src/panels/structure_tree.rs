//! `StructureTree` — model-browser tree widget.
//!
//! Renders an indented tree of nodes (Project / Site / Building / Storey
//! / Element for IFC, or Layer / EntityType for DXF / DWG). Pure
//! data-driven: the consumer hands in a pre-built `TreeNode` plus
//! mutable `expanded` set + `selected` option, the widget paints it
//! and returns a list of actions.
//!
//! Wiring expectation:
//! ```ignore
//! egui::SidePanel::right("structure_tree")
//!     .exact_width(280.0)
//!     .show(ctx, |ui| {
//!         let actions = StructureTree::new("Structure", &root,
//!             &mut self.tree_expanded, &mut self.tree_selected).show(ui);
//!         for a in actions { dispatch(a); }
//!     });
//! ```

use crate::theme::{Palette, Theme};
use egui::{Color32, Pos2, Rect, Sense, Stroke, Ui, Vec2};
use std::collections::HashSet;

/// Coarse node type — drives the leading icon glyph and reads as a
/// hierarchy hint to the user.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum NodeKind {
    Project,
    Site,
    Building,
    Storey,
    Element,
    Layer,
    EntityType,
    Other,
}

/// One row in the tree. `id` must be globally unique within the tree —
/// it doubles as the expansion / selection key.
#[derive(Debug, Clone)]
pub struct TreeNode {
    pub id: String,
    pub label: String,
    pub kind: NodeKind,
    /// Optional dimmed `(N)` suffix shown after the label.
    pub count: Option<usize>,
    pub children: Vec<TreeNode>,
}

impl TreeNode {
    pub fn leaf(id: impl Into<String>, label: impl Into<String>, kind: NodeKind) -> Self {
        Self { id: id.into(), label: label.into(), kind, count: None, children: Vec::new() }
    }
    pub fn with_count(mut self, n: usize) -> Self { self.count = Some(n); self }
    pub fn with_children(mut self, ch: Vec<TreeNode>) -> Self { self.children = ch; self }
}

#[derive(Debug, Clone)]
pub enum StructureTreeAction {
    Toggle(String),
    Select(String),
    DoubleClick(String),
}

pub struct StructureTree<'a> {
    title: &'a str,
    root: &'a TreeNode,
    expanded: &'a mut HashSet<String>,
    selected: &'a mut Option<String>,
}

impl<'a> StructureTree<'a> {
    pub fn new(
        title: &'a str,
        root: &'a TreeNode,
        expanded: &'a mut HashSet<String>,
        selected: &'a mut Option<String>,
    ) -> Self {
        Self { title, root, expanded, selected }
    }

    pub fn show(self, ui: &mut Ui) -> Vec<StructureTreeAction> {
        let mut actions: Vec<StructureTreeAction> = Vec::new();
        let palette = Theme::Default.palette();

        // Header strip.
        let avail_w = ui.available_width();
        let header_h = 28.0;
        let (hdr_rect, _) =
            ui.allocate_exact_size(Vec2::new(avail_w, header_h), Sense::hover());
        ui.painter().rect_filled(hdr_rect, 0.0, palette.titlebar_bg);
        ui.painter().line_segment(
            [
                Pos2::new(hdr_rect.left(), hdr_rect.bottom() - 0.5),
                Pos2::new(hdr_rect.right(), hdr_rect.bottom() - 0.5),
            ],
            Stroke::new(1.0, palette.border),
        );
        ui.painter().text(
            Pos2::new(hdr_rect.left() + 12.0, hdr_rect.center().y),
            egui::Align2::LEFT_CENTER,
            self.title,
            egui::FontId::new(12.0, egui::FontFamily::Proportional),
            palette.fg,
        );

        // Body — scrolls vertically when the tree exceeds the panel.
        egui::ScrollArea::vertical()
            .auto_shrink([false, false])
            .show(ui, |ui| {
                draw_node(
                    ui,
                    self.root,
                    0,
                    self.expanded,
                    self.selected,
                    &palette,
                    &mut actions,
                );
            });

        actions
    }
}

fn draw_node(
    ui: &mut Ui,
    node: &TreeNode,
    depth: usize,
    expanded: &mut HashSet<String>,
    selected: &mut Option<String>,
    palette: &Palette,
    actions: &mut Vec<StructureTreeAction>,
) {
    let row_h = 22.0;
    let avail_w = ui.available_width();
    let (rect, resp) = ui.allocate_exact_size(
        Vec2::new(avail_w, row_h),
        Sense::click_and_drag(),
    );
    let resp = resp.interact(Sense::click());

    let is_open = expanded.contains(&node.id);
    let is_selected = selected.as_ref() == Some(&node.id);
    let has_children = !node.children.is_empty();

    // Background.
    if is_selected {
        let amber = Color32::from_rgba_unmultiplied(
            palette.accent.r(),
            palette.accent.g(),
            palette.accent.b(),
            36,
        );
        ui.painter().rect_filled(rect, 0.0, amber);
        ui.painter().line_segment(
            [
                Pos2::new(rect.left() + 0.5, rect.top()),
                Pos2::new(rect.left() + 0.5, rect.bottom()),
            ],
            Stroke::new(2.0, palette.accent),
        );
    } else if resp.hovered() {
        ui.painter().rect_filled(rect, 0.0, palette.button_hover);
    }

    // Indentation (12 px per level), reserving the first 16 px slot for
    // the expansion caret regardless of depth.
    let indent_x = rect.left() + 8.0 + (depth as f32) * 12.0;
    let caret_x = indent_x + 4.0;
    let icon_x = indent_x + 22.0;
    let label_x = indent_x + 40.0;

    // Caret area (only painted when the node has children).
    if has_children {
        let caret = if is_open {
            egui_phosphor::regular::CARET_DOWN
        } else {
            egui_phosphor::regular::CARET_RIGHT
        };
        ui.painter().text(
            Pos2::new(caret_x, rect.center().y),
            egui::Align2::LEFT_CENTER,
            caret,
            egui::FontId::new(12.0, egui::FontFamily::Proportional),
            palette.fg_dim,
        );
    }

    // Type icon.
    let icon_glyph = match node.kind {
        NodeKind::Project    => egui_phosphor::regular::FOLDERS,
        NodeKind::Site       => egui_phosphor::regular::MAP_PIN,
        NodeKind::Building   => egui_phosphor::regular::BUILDINGS,
        NodeKind::Storey     => egui_phosphor::regular::STACK,
        NodeKind::Element    => egui_phosphor::regular::CUBE,
        NodeKind::Layer      => egui_phosphor::regular::STACK_SIMPLE,
        NodeKind::EntityType => egui_phosphor::regular::SHAPES,
        NodeKind::Other      => egui_phosphor::regular::CIRCLE,
    };
    ui.painter().text(
        Pos2::new(icon_x, rect.center().y),
        egui::Align2::LEFT_CENTER,
        icon_glyph,
        egui::FontId::new(13.0, egui::FontFamily::Proportional),
        palette.fg,
    );

    // Label.
    ui.painter().text(
        Pos2::new(label_x, rect.center().y),
        egui::Align2::LEFT_CENTER,
        &node.label,
        egui::FontId::new(12.0, egui::FontFamily::Proportional),
        palette.fg,
    );

    // Dimmed count suffix, drawn right after the label.
    if let Some(n) = node.count {
        // Approximate label width via galley measure.
        let label_galley = ui.painter().layout_no_wrap(
            node.label.clone(),
            egui::FontId::new(12.0, egui::FontFamily::Proportional),
            palette.fg,
        );
        let count_x = label_x + label_galley.size().x + 6.0;
        ui.painter().text(
            Pos2::new(count_x, rect.center().y),
            egui::Align2::LEFT_CENTER,
            format!("({})", n),
            egui::FontId::new(11.0, egui::FontFamily::Proportional),
            palette.fg_dim,
        );
    }

    // Click handling.
    //   - single click on caret area or on a row with children: toggle
    //   - single click on label / icon area: select
    //   - double click anywhere: emit DoubleClick (zoom)
    if resp.double_clicked() {
        actions.push(StructureTreeAction::DoubleClick(node.id.clone()));
        *selected = Some(node.id.clone());
        actions.push(StructureTreeAction::Select(node.id.clone()));
    } else if resp.clicked() {
        // Was the click in the caret column?
        let clicked_caret = resp
            .interact_pointer_pos()
            .map(|p| p.x < icon_x - 2.0)
            .unwrap_or(false);
        if clicked_caret && has_children {
            if is_open {
                expanded.remove(&node.id);
            } else {
                expanded.insert(node.id.clone());
            }
            actions.push(StructureTreeAction::Toggle(node.id.clone()));
        } else {
            *selected = Some(node.id.clone());
            actions.push(StructureTreeAction::Select(node.id.clone()));
            // Convenience: also expand on body-click for non-leaf rows.
            if has_children && !is_open {
                expanded.insert(node.id.clone());
                actions.push(StructureTreeAction::Toggle(node.id.clone()));
            }
        }
    }

    // Recurse into children when expanded.
    if has_children && is_open {
        for child in &node.children {
            draw_node(ui, child, depth + 1, expanded, selected, palette, actions);
        }
    }
}
