//! ifcx_view — interim Scene → IFC-X JSON preview serialiser.
//!
//! The full v3 IFC-X writer (see `docs/ifcdraw/v3/`) is not implemented
//! yet, so this module gives the Viewer's IFC ribbon tab a content
//! browser by serialising the in-memory `Scene` into a JSON shape that
//! follows the v3 entity-id / type / attributes mapping. It is **read
//! only** — nothing here writes to disk.
//!
//! ## Output shape
//!
//! ```text
//! {
//!   "schemaVersion": "0.4-2d-binary-ifcdraw (v3 IFC-X mapping preview)",
//!   "generator": "Open 2D Studio v0.1.0",
//!   "source": "DWG" | "DXF" | "IFCDRAW" | "IFCX",
//!   "sourcePath": "C:\\\\…",
//!   "bbox": [xmin, ymin, xmax, ymax],
//!   "stats": {
//!     "segments":   …,
//!     "triangles":  …,
//!     "entities":   …,
//!     "layers":     …,
//!     "layouts":    …
//!   },
//!   "data": [
//!     { "id": "drawing/Model",  "type": "ifcx::project::Drawing", "attributes": {…} },
//!     { "id": "layer/Stramien", "type": "ifcx::project::Layer",   "attributes": {…} },
//!     { "id": "entity/0",       "type": "ifcx::geom::IfcPolyline","attributes": {…} },
//!     …
//!   ]
//! }
//! ```
//!
//! ## Lazy / virtualised tree
//!
//! The Viewer paints the tree with `egui::ScrollArea::show_rows`, so
//! the whole document is **never** materialised into the JSON value
//! up-front. Instead `IfcxView` exposes:
//!
//!   * `entries(&self)` — flat list of `(id, type, kind)` rows that
//!     the tree can iterate without paying the per-row attribute cost.
//!   * `attributes_for(&self, id)` — builds the `attributes` map for
//!     a single id on demand (used by the centre detail panel + right
//!     raw-JSON panel).
//!   * `entry_json(&self, id)` — full `{id, type, attributes}` object
//!     for the right raw-JSON panel.
//!   * `full_preview_json(&self)` — convenience for "Copy whole
//!     document" / unit-tests. Walks every id; cost is O(scene size).
//!
//! Per-id attribute construction is `O(#segments(eid))` for entities,
//! `O(1)` for drawings + layers + project. A 700k-entity scene therefore
//! only pays for the rows currently visible (~30 with the default row
//! height) — the JSON payload for the whole document is never assembled
//! unless the user clicks "copy all".

use std::collections::HashMap;

use serde_json::{json, Value};

use crate::scene_io::{Scene, TextKind, TriKind};

/// Generator string burned into every preview document. Bump when the
/// preview shape changes in a way external scripts might depend on.
pub const GENERATOR: &str = "Open 2D Studio v0.1.0";

/// Schema tag — matches the v2 binary ifcdraw envelope tag so a future
/// importer can tell the two apart by the trailing "(… preview)" hint.
pub const SCHEMA_VERSION: &str = "0.4-2d-binary-ifcdraw (v3 IFC-X mapping preview)";

/// What a row in the IFC-X tree represents. Mirrors `NodeKind` in the
/// `StructureTree` widget but stays decoupled so this module can stand
/// alone (and so it can carry IFC-X-specific kinds the widget doesn't
/// model, like `Bucket` for entity-type sub-buckets).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum IfcxKind {
    Project,
    Drawing,
    LayerGroup,
    Layer,
    EntityBucket,
    Entity,
    BlockList,
    Block,
    StyleList,
    Style,
}

impl IfcxKind {
    pub fn type_str(self) -> &'static str {
        match self {
            IfcxKind::Project      => "ifcx::project::Project",
            IfcxKind::Drawing      => "ifcx::project::Drawing",
            IfcxKind::LayerGroup   => "ifcx::project::LayerGroup",
            IfcxKind::Layer        => "ifcx::project::Layer",
            IfcxKind::EntityBucket => "ifcx::project::EntityBucket",
            IfcxKind::Entity       => "ifcx::geom::Entity",
            IfcxKind::BlockList    => "ifcx::project::BlockList",
            IfcxKind::Block        => "ifcx::project::Block",
            IfcxKind::StyleList    => "ifcx::project::StyleList",
            IfcxKind::Style        => "ifcx::project::Style",
        }
    }
}

/// One row in the flat view. The tree widget receives a `Vec<IfcxEntry>`
/// and a parallel `Vec<usize>` of parent indices and folds it into an
/// indented tree internally — that's cheaper than re-allocating
/// `TreeNode` children for 700k entities.
#[derive(Debug, Clone)]
pub struct IfcxEntry {
    /// Stable id, doubles as the JSON `id` field. Format:
    ///   "project"
    ///   "drawing/Model" | "drawing/Layout1"
    ///   "layers"
    ///   "layer/<name>"
    ///   "layer/<name>/bucket/<bucket>"
    ///   "entity/<eid>"
    ///   "blocks", "block/<name>"
    ///   "styles", "style/<name>"
    pub id: String,
    /// Tree-row label (already includes the entity-type prefix, e.g.
    /// "LINE — 0x3F" for entities, "Stramien" for layers).
    pub label: String,
    /// Visual + JSON-type classifier.
    pub kind: IfcxKind,
    /// Optional dimmed `(N)` suffix for the tree widget.
    pub count: Option<usize>,
    /// Indentation depth, 0 = root project node.
    pub depth: u8,
}

/// Quick entity-type bucket for the per-layer roll-up. Identical to the
/// `EntityBucket` used by the existing structure-tree (kept local to
/// avoid the cross-file `pub` churn).
#[derive(Copy, Clone, Eq, PartialEq, Hash, Debug)]
pub enum Bucket {
    Line,
    Polyline,
    Text,
    Hatch,
    Other,
}

impl Bucket {
    pub fn label(self) -> &'static str {
        match self {
            Bucket::Line     => "Lines",
            Bucket::Polyline => "Polylines",
            Bucket::Text     => "Text",
            Bucket::Hatch    => "Hatches",
            Bucket::Other    => "Other",
        }
    }
}

/// Per-entity index cache. Built once when `IfcxView::new` is called
/// (linear walk of the parallel `segment_entity_idx` array), then reused
/// for every row that asks for its segments. Keeps tree-building
/// + attribute-building both O(1) per row after construction.
pub struct IfcxView<'a> {
    scene: &'a Scene,
    file_label: String,
    source_path: Option<String>,
    entries: Vec<IfcxEntry>,

    /// entity_idx → segment-index list. Skipped at build time when the
    /// scene has 0 segments.
    entity_to_segs: HashMap<u32, Vec<u32>>,
    /// entity_idx → triangle-index list (parallel to segments).
    entity_to_tris: HashMap<u32, Vec<u32>>,
    /// entity_idx → layer index. We use the first segment's layer
    /// (entities are single-layer in practice).
    entity_layer: HashMap<u32, usize>,
    /// entity_idx → entity bucket.
    entity_bucket: HashMap<u32, Bucket>,

    /// layer_idx → entity count, entity_count_by_bucket. Drives the
    /// dimmed `(N)` row counters and the per-bucket lists.
    layer_buckets: Vec<HashMap<Bucket, Vec<u32>>>,
    layer_total: Vec<usize>,
    /// Top-level entity-count summary (used by the layer-root node).
    total_entities: usize,
}

impl<'a> IfcxView<'a> {
    /// Build the index + entry list. Linear in `scene.segments +
    /// scene.triangles`. Holds borrows of the scene for its entire
    /// lifetime (zero copies of segments / triangles).
    pub fn new(scene: &'a Scene, file_label: impl Into<String>, source_path: Option<String>) -> Self {
        let file_label = file_label.into();
        let mut entity_to_segs: HashMap<u32, Vec<u32>> = HashMap::new();
        for (i, eid) in scene.segment_entity_idx.iter().enumerate() {
            entity_to_segs.entry(*eid).or_default().push(i as u32);
        }
        let mut entity_to_tris: HashMap<u32, Vec<u32>> = HashMap::new();
        for (i, eid) in scene.triangle_entity_idx.iter().enumerate() {
            entity_to_tris.entry(*eid).or_default().push(i as u32);
        }

        // Per-entity layer + bucket classification.
        let n_layers = scene.layer_names.len().max(1);
        let mut entity_layer: HashMap<u32, usize> = HashMap::new();
        let mut entity_bucket: HashMap<u32, Bucket> = HashMap::new();
        let mut layer_buckets: Vec<HashMap<Bucket, Vec<u32>>> =
            (0..n_layers).map(|_| HashMap::new()).collect();
        let mut layer_total = vec![0_usize; n_layers];

        // Build the unique-entity-id list. Use the BTreeSet-like sorted
        // form for stable ordering; entity_to_segs covers segment-only
        // entities, entity_to_tris covers triangle-only entities (rare
        // but possible for pure-fill HATCH with no boundary).
        let mut all_eids: Vec<u32> = entity_to_segs.keys().copied().collect();
        for k in entity_to_tris.keys() {
            if !entity_to_segs.contains_key(k) { all_eids.push(*k); }
        }
        all_eids.sort_unstable();

        for &eid in &all_eids {
            // Layer = first segment's layer (or first triangle's if
            // segment-less entity).
            let layer_idx = entity_to_segs.get(&eid)
                .and_then(|s| s.first())
                .and_then(|si| scene.segment_layer_idx.get(*si as usize).copied())
                .or_else(|| entity_to_tris.get(&eid)
                    .and_then(|t| t.first())
                    .and_then(|ti| scene.triangle_layer_idx.get(*ti as usize).copied()))
                .map(|l| l as usize)
                .unwrap_or(0)
                .min(n_layers.saturating_sub(1));
            entity_layer.insert(eid, layer_idx);

            let bucket = classify_entity(scene, eid, &entity_to_segs, &entity_to_tris);
            entity_bucket.insert(eid, bucket);
            layer_buckets[layer_idx].entry(bucket).or_default().push(eid);
            layer_total[layer_idx] += 1;
        }

        let total_entities = all_eids.len();

        // ---- Build the flat row list ------------------------------------
        let mut entries: Vec<IfcxEntry> = Vec::new();

        // Root.
        entries.push(IfcxEntry {
            id: "project".to_string(),
            label: format!("{} — {}", file_label, scene.source),
            kind: IfcxKind::Project,
            count: Some(total_entities),
            depth: 0,
        });

        // Drawings: Model + every named layout. We don't have model/paper
        // entity-count separation here — `layouts` is metadata only, the
        // entities themselves carry their own `is_paper` flag per segment.
        entries.push(IfcxEntry {
            id: "drawing/Model".to_string(),
            label: "Model".to_string(),
            kind: IfcxKind::Drawing,
            count: None,
            depth: 1,
        });
        for (name, _bbox) in &scene.layouts {
            if name.eq_ignore_ascii_case("Model") { continue; }
            entries.push(IfcxEntry {
                id: format!("drawing/{}", name),
                label: name.clone(),
                kind: IfcxKind::Drawing,
                count: None,
                depth: 1,
            });
        }

        // Layers root + per-layer + per-bucket sub-rows + per-entity rows.
        entries.push(IfcxEntry {
            id: "layers".to_string(),
            label: "Layers".to_string(),
            kind: IfcxKind::LayerGroup,
            count: Some(n_layers),
            depth: 1,
        });
        for (li, name) in scene.layer_names.iter().enumerate().take(n_layers) {
            if layer_total[li] == 0 { continue; }
            entries.push(IfcxEntry {
                id: format!("layer/{}", name),
                label: name.clone(),
                kind: IfcxKind::Layer,
                count: Some(layer_total[li]),
                depth: 2,
            });

            // Per-layer entity-type buckets, sorted by count desc.
            let mut buckets: Vec<(Bucket, &Vec<u32>)> = layer_buckets[li].iter()
                .map(|(b, v)| (*b, v))
                .collect();
            buckets.sort_by(|a, b| b.1.len().cmp(&a.1.len()));
            for (bucket, eid_list) in buckets {
                entries.push(IfcxEntry {
                    id: format!("layer/{}/bucket/{}", name, bucket.label()),
                    label: bucket.label().to_string(),
                    kind: IfcxKind::EntityBucket,
                    count: Some(eid_list.len()),
                    depth: 3,
                });

                // Per-entity rows nested under their bucket. CAP at 5000
                // entities per bucket to keep the entry list manageable;
                // the tree widget can virtualise but a 700k flat Vec
                // still costs 30+ MB. The "+ N more" sentinel below lets
                // the user know the bucket isn't fully enumerated.
                const ENTITY_ROW_CAP: usize = 5_000;
                let n_rows = eid_list.len().min(ENTITY_ROW_CAP);
                for &eid in &eid_list[..n_rows] {
                    let name = entity_short_name(scene, eid);
                    entries.push(IfcxEntry {
                        id: format!("entity/{}", eid),
                        label: name,
                        kind: IfcxKind::Entity,
                        count: None,
                        depth: 4,
                    });
                }
                if eid_list.len() > ENTITY_ROW_CAP {
                    entries.push(IfcxEntry {
                        id: format!("layer/{}/bucket/{}/+more", name, bucket.label()),
                        label: format!("(+{} more — open via search)", eid_list.len() - ENTITY_ROW_CAP),
                        kind: IfcxKind::EntityBucket,
                        count: None,
                        depth: 4,
                    });
                }
            }
        }

        Self {
            scene,
            file_label,
            source_path,
            entries,
            entity_to_segs,
            entity_to_tris,
            entity_layer,
            entity_bucket,
            layer_buckets,
            layer_total,
            total_entities,
        }
    }

    /// Flat row list. Consumer iterates this for the tree paint loop.
    pub fn entries(&self) -> &[IfcxEntry] { &self.entries }

    /// Look up the originating entity id from an `"entity/<eid>"` row
    /// id. Returns `None` for non-entity rows.
    pub fn entity_id_for(&self, id: &str) -> Option<u32> {
        id.strip_prefix("entity/")?.parse::<u32>().ok()
    }

    /// Build a `{ id, type, attributes }` JSON object for a single
    /// id. Returns a deliberately empty object for unknown ids so the
    /// detail panel can fall back to a friendly "(node not found)"
    /// message instead of panicking.
    pub fn entry_json(&self, id: &str) -> Value {
        let kind = self.entries.iter()
            .find(|e| e.id == id)
            .map(|e| e.kind);
        let Some(kind) = kind else {
            return json!({
                "id": id,
                "type": "ifcx::unknown",
                "attributes": {},
            });
        };
        let attrs = self.attributes_for(id);
        json!({
            "id": id,
            "type": kind.type_str(),
            "attributes": attrs,
        })
    }

    /// Build only the `attributes` map for a given id (no envelope).
    pub fn attributes_for(&self, id: &str) -> Value {
        if id == "project" { return self.project_attributes(); }
        if id == "layers"  { return self.layers_attributes(); }
        if id == "blocks"  { return json!({ "note": "Block table not captured by current loader" }); }
        if id == "styles"  { return json!({ "note": "Style table not captured by current loader" }); }
        if let Some(name) = id.strip_prefix("drawing/") {
            return self.drawing_attributes(name);
        }
        if let Some(rest) = id.strip_prefix("layer/") {
            // "layer/<name>" or "layer/<name>/bucket/<bucket>"
            if let Some((layer_name, bucket_part)) = rest.split_once("/bucket/") {
                return self.bucket_attributes(layer_name, bucket_part);
            }
            return self.layer_attributes(rest);
        }
        if let Some(eid_str) = id.strip_prefix("entity/") {
            if let Ok(eid) = eid_str.parse::<u32>() {
                return self.entity_attributes(eid);
            }
        }
        json!({})
    }

    /// Whole-document JSON. Useful for unit tests + the "copy all"
    /// button. O(scene size). Don't call per-frame.
    pub fn full_preview_json(&self) -> Value {
        let mut data: Vec<Value> = Vec::with_capacity(self.entries.len());
        for entry in &self.entries {
            // Skip the synthetic "+more" sentinel rows when serialising
            // the whole document — they're a tree-display aid, not real
            // IFC-X entities.
            if entry.id.ends_with("/+more") { continue; }
            data.push(self.entry_json(&entry.id));
        }
        json!({
            "schemaVersion": SCHEMA_VERSION,
            "generator": GENERATOR,
            "source": self.scene.source,
            "sourcePath": self.source_path.clone().unwrap_or_default(),
            "fileLabel": self.file_label.clone(),
            "bbox": self.scene.bbox,
            "stats": {
                "segments":   self.scene.segments.len(),
                "triangles":  self.scene.triangles.len(),
                "entities":   self.total_entities,
                "layers":     self.scene.layer_names.len(),
                "layouts":    self.scene.layouts.len(),
            },
            "data": Value::Array(data),
        })
    }

    /// Convenience header object (no `data`). Useful for the
    /// "What is this file?" detail card.
    pub fn document_header(&self) -> Value {
        json!({
            "schemaVersion": SCHEMA_VERSION,
            "generator": GENERATOR,
            "source": self.scene.source,
            "sourcePath": self.source_path.clone().unwrap_or_default(),
            "fileLabel": self.file_label.clone(),
            "bbox": self.scene.bbox,
            "stats": {
                "segments":   self.scene.segments.len(),
                "triangles":  self.scene.triangles.len(),
                "entities":   self.total_entities,
                "layers":     self.scene.layer_names.len(),
                "layouts":    self.scene.layouts.len(),
            },
        })
    }

    // ---- Per-id attribute builders ----------------------------------

    fn project_attributes(&self) -> Value {
        json!({
            "name": self.file_label.clone(),
            "source": self.scene.source,
            "sourcePath": self.source_path.clone().unwrap_or_default(),
            "generator": GENERATOR,
            "bbox": self.scene.bbox,
            "units": "mm",
            "stats": {
                "segments":   self.scene.segments.len(),
                "triangles":  self.scene.triangles.len(),
                "entities":   self.total_entities,
                "layers":     self.scene.layer_names.len(),
                "layouts":    self.scene.layouts.len(),
            },
        })
    }

    fn drawing_attributes(&self, name: &str) -> Value {
        if name.eq_ignore_ascii_case("Model") {
            // Model space: count entities flagged as non-paper.
            let model_segs = self.scene.segments.iter()
                .filter(|s| !s.is_paper).count();
            let model_tris = self.scene.triangles.iter()
                .filter(|t| !t.is_paper).count();
            return json!({
                "name": "Model",
                "kind": "model_space",
                "bbox": self.scene.bbox,
                "segmentCount": model_segs,
                "triangleCount": model_tris,
            });
        }
        // Look up the layout entry; bbox lives there.
        let bbox = self.scene.layouts.iter()
            .find(|(n, _)| n.eq_ignore_ascii_case(name))
            .map(|(_, b)| *b);
        let paper_segs = self.scene.segments.iter()
            .filter(|s| s.is_paper).count();
        let paper_tris = self.scene.triangles.iter()
            .filter(|t| t.is_paper).count();
        json!({
            "name": name,
            "kind": "paper_space",
            "bbox": bbox,
            // Paper-space figures are scene-wide (not per-layout) since
            // segments only carry an is_paper bool, not a layout name.
            "paperSegmentCount": paper_segs,
            "paperTriangleCount": paper_tris,
        })
    }

    fn layers_attributes(&self) -> Value {
        json!({
            "count": self.scene.layer_names.len(),
            "totalEntities": self.total_entities,
        })
    }

    fn layer_attributes(&self, name: &str) -> Value {
        let idx = self.scene.layer_names.iter()
            .position(|n| n == name);
        let color = idx.and_then(|i| self.scene.layer_colors.get(i).copied()).unwrap_or(0);
        let entity_count = idx.map(|i| self.layer_total.get(i).copied().unwrap_or(0)).unwrap_or(0);
        let bucket_counts: Vec<Value> = idx.map(|i| {
            self.layer_buckets[i].iter()
                .map(|(b, v)| json!({ "bucket": b.label(), "count": v.len() }))
                .collect()
        }).unwrap_or_default();
        json!({
            "name": name,
            "layerIndex": idx,
            "color_argb": format!("0x{:08X}", color),
            "entityCount": entity_count,
            "buckets": bucket_counts,
        })
    }

    fn bucket_attributes(&self, layer_name: &str, bucket_label: &str) -> Value {
        let layer_idx = self.scene.layer_names.iter()
            .position(|n| n == layer_name);
        let count = layer_idx.and_then(|i| {
            self.layer_buckets[i].iter()
                .find(|(b, _)| b.label() == bucket_label)
                .map(|(_, v)| v.len())
        }).unwrap_or(0);
        json!({
            "layer": layer_name,
            "bucket": bucket_label,
            "entityCount": count,
        })
    }

    fn entity_attributes(&self, eid: u32) -> Value {
        let bucket = self.entity_bucket.get(&eid).copied().unwrap_or(Bucket::Other);
        let layer_idx = self.entity_layer.get(&eid).copied().unwrap_or(0);
        let layer_name = self.scene.layer_names.get(layer_idx)
            .cloned().unwrap_or_else(|| "0".to_string());
        let layer_color = self.scene.layer_colors.get(layer_idx).copied().unwrap_or(0);
        let segs = self.entity_to_segs.get(&eid);
        let tris = self.entity_to_tris.get(&eid);
        let seg_count = segs.map(|s| s.len()).unwrap_or(0);
        let tri_count = tris.map(|t| t.len()).unwrap_or(0);
        let entity_name = self.scene.entity_names.get(eid as usize)
            .cloned().unwrap_or_default();

        // Geometry preview — clip very long polylines to keep the JSON
        // payload reasonable when an entity has thousands of fragments
        // (dashed lines explode into many segments).
        const GEOM_PREVIEW_LIMIT: usize = 64;
        let mut points: Vec<Value> = Vec::new();
        let mut points_truncated_at: Option<usize> = None;
        if let Some(segs) = segs {
            // Use the first endpoint of each segment to give an ordered
            // polyline preview; for true LINE entities (1 seg) we also
            // include the trailing endpoint.
            for (i, &si) in segs.iter().enumerate() {
                if let Some(s) = self.scene.segments.get(si as usize) {
                    if i >= GEOM_PREVIEW_LIMIT { points_truncated_at = Some(GEOM_PREVIEW_LIMIT); break; }
                    points.push(json!([s.p1[0], s.p1[1]]));
                }
            }
            if segs.len() == 1 {
                if let Some(s) = segs.first().and_then(|si| self.scene.segments.get(*si as usize)) {
                    points.push(json!([s.p2[0], s.p2[1]]));
                }
            }
        }

        // Per-entity colour heuristic: use the first segment's colour if
        // present, else the layer colour. AutoCAD's "BYLAYER" semantics.
        let entity_color: u32 = segs
            .and_then(|s| s.first().copied())
            .and_then(|si| self.scene.segments.get(si as usize).map(|s| s.color))
            .or_else(|| tris.and_then(|t| t.first().copied())
                .and_then(|ti| self.scene.triangles.get(ti as usize).map(|t| t.color)))
            .unwrap_or(layer_color);

        // Dash / linetype index — if any segment of the entity carries
        // a non-zero `segment_dash_idx` we surface it as the entity's
        // linetype. Don't bother to look up the dash_arrays payload
        // here — that's a few-kB table best left to the raw-JSON view.
        let dash_idx = segs
            .and_then(|s| s.first().copied())
            .and_then(|si| self.scene.segment_dash_idx.get(si as usize).copied())
            .unwrap_or(0);
        let linetype = if dash_idx == 0 { "CONTINUOUS" } else { "DASHED" };

        // Type-specific extensions.
        let ifc_type = entity_ifc_type(bucket);
        let mut attrs = json!({
            "ifcType": ifc_type,
            "bucket": bucket.label(),
            "entityIdx": eid,
            "entityName": entity_name,
            "layer": layer_name,
            "layerColor_argb": format!("0x{:08X}", layer_color),
            "color_argb": format!("0x{:08X}", entity_color),
            "linetype": linetype,
            "dashIndex": dash_idx,
            "isPaper": segs.and_then(|s| s.first().copied())
                .and_then(|si| self.scene.segments.get(si as usize).map(|s| s.is_paper))
                .unwrap_or(false),
            "segmentCount": seg_count,
            "triangleCount": tri_count,
            "geometryPreview": {
                "points": Value::Array(points),
                "truncatedAt": points_truncated_at,
            },
        });

        // Text payload — if this entity has an EntityText record,
        // surface its raw + anchor + font etc.
        if let Some(Some(text)) = self.scene.entity_text.get(eid as usize) {
            let kind_tag = match text.kind {
                TextKind::Text   => "TEXT",
                TextKind::MText  => "MTEXT",
                TextKind::Attrib => "ATTRIB",
            };
            if let Some(obj) = attrs.as_object_mut() {
                obj.insert("text".to_string(), json!({
                    "kind": kind_tag,
                    "raw": text.raw,
                    "anchor": text.anchor,
                    "height": text.height,
                    "rotation": text.rotation,
                    "fontPath": text.font_path,
                    "bold": text.bold,
                    "italic": text.italic,
                    "attachment": text.attachment,
                }));
            }
        }

        // Triangle-fill payload — surface TextFill vs Solid kinds.
        if tri_count > 0 {
            let text_fill = tris.map(|t| {
                t.iter().any(|&ti| {
                    self.scene.triangles.get(ti as usize)
                        .map(|tr| tr.kind == TriKind::TextFill)
                        .unwrap_or(false)
                })
            }).unwrap_or(false);
            if let Some(obj) = attrs.as_object_mut() {
                obj.insert("fill".to_string(), json!({
                    "kind": if text_fill { "TextFill" } else { "Solid" },
                    "triangleCount": tri_count,
                }));
            }
        }

        attrs
    }
}

/// AutoCAD-bucket → IFC4 class string (rough approximation). Used so
/// the per-entity JSON carries a recognisable IFC type even before the
/// real schema bridge lands.
fn entity_ifc_type(bucket: Bucket) -> &'static str {
    match bucket {
        Bucket::Line     => "IfcPolyline",
        Bucket::Polyline => "IfcPolyline",
        Bucket::Text     => "IfcTextLiteral",
        Bucket::Hatch    => "IfcAnnotationFillArea",
        Bucket::Other    => "IfcGeometricRepresentationItem",
    }
}

/// Short label for the tree row of an entity. Format:
///   "LINE — #42"          (single segment, no entity_names hit)
///   "LWPOLYLINE — #42"    (multi-segment, name from entity_names)
///   "MTEXT \"…\" — #42"   (text with first ~20 chars of raw)
fn entity_short_name(scene: &Scene, eid: u32) -> String {
    let id_suffix = format!("#{}", eid);
    // Prefer the recorded entity_name if present (richest: "INSERT \"foo\"").
    let recorded = scene.entity_names.get(eid as usize)
        .cloned()
        .unwrap_or_default();
    if !recorded.is_empty() {
        // For text, append the first ~20 chars of the body for readability.
        if let Some(Some(text)) = scene.entity_text.get(eid as usize) {
            let snippet: String = text.raw.chars().take(20).collect();
            return format!("{} \"{}…\" — {}", recorded, snippet, id_suffix);
        }
        return format!("{} — {}", recorded, id_suffix);
    }
    format!("entity — {}", id_suffix)
}

/// Identical to studio_app::classify_entity, kept local so this module
/// can be built standalone. Keep in sync with the original if either
/// changes — the structure tree and the IFC-X view must agree on
/// bucket counts for the user not to be confused.
fn classify_entity(
    scene: &Scene,
    eid: u32,
    entity_to_segs: &HashMap<u32, Vec<u32>>,
    entity_to_tris: &HashMap<u32, Vec<u32>>,
) -> Bucket {
    let eid_us = eid as usize;
    if scene.entity_text.get(eid_us).and_then(|o| o.as_ref()).is_some() {
        return Bucket::Text;
    }
    if entity_to_tris.contains_key(&eid) {
        return Bucket::Hatch;
    }
    let n = entity_to_segs.get(&eid).map(|v| v.len()).unwrap_or(0);
    if n == 0 { Bucket::Other }
    else if n == 1 { Bucket::Line }
    else { Bucket::Polyline }
}

/// Top-level convenience: build the whole preview JSON in one call.
/// Useful for tests + the "copy all" button.
pub fn scene_to_ifcx_preview(
    scene: &Scene,
    file_label: &str,
    source_path: Option<String>,
) -> Value {
    let view = IfcxView::new(scene, file_label.to_string(), source_path);
    view.full_preview_json()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::scene_io::Scene;

    #[test]
    fn empty_scene_preview_has_envelope() {
        let scene = Scene::empty("DWG", "untitled".to_string());
        let view = IfcxView::new(&scene, "untitled", None);
        let json = view.full_preview_json();
        assert_eq!(json["schemaVersion"], SCHEMA_VERSION);
        assert_eq!(json["source"], "DWG");
        assert!(json["data"].is_array());
        // Root project + Model drawing + Layers root = 3 minimum.
        assert!(json["data"].as_array().unwrap().len() >= 3);
        assert!(view.entries().iter().any(|e| e.id == "project"));
        assert!(view.entries().iter().any(|e| e.id == "drawing/Model"));
        assert!(view.entries().iter().any(|e| e.id == "layers"));
    }

    #[test]
    fn unknown_id_returns_friendly_object() {
        let scene = Scene::empty("DXF", "untitled".to_string());
        let view = IfcxView::new(&scene, "untitled", None);
        let v = view.entry_json("entity/9999");
        assert_eq!(v["type"], "ifcx::unknown");
        assert!(v["attributes"].as_object().unwrap().is_empty());
    }

    #[test]
    fn project_attributes_carry_stats() {
        let scene = Scene::empty("DWG", "untitled".to_string());
        let view = IfcxView::new(&scene, "untitled", None);
        let attrs = view.attributes_for("project");
        assert_eq!(attrs["stats"]["segments"], 0);
        assert_eq!(attrs["stats"]["entities"], 0);
    }
}
