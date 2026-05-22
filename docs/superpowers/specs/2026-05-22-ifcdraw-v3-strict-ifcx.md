# IFCDraw v3 — Strict IFCX (no IFC4X3 leakage)

Status: **Canonical design — pending two open questions in §7**
Supersedes: `2026-05-22-ifcdraw-v3-ifcx-mapping.md` (mis-used IFC4X3 alias names)
Companion (still authoritative for the binary envelope): `2026-05-22-ifcdraw-v3-wire-format.md`
Vendor reference: `github.com/OpenAEC-Foundation/Ifc-Factory` —
- `schema/ifcx-v2.schema.json` (canonical envelope)
- `schema/attributes.md` (canonical attribute registry)
- `examples/simple-drawing.ifcx` (v1 entity-style drawing)
- `examples/text-v2.ifcx` (v2 flat-data drawing — the pattern we adopt)
- `docs/ifcx-structuur-analyse.md` (type-system rationale)
- `docs/ifcx-inspection-schema-voorstel.md` (extension-namespace exemplar)
- `integrations/blender/ifcx_addon/` and `integrations/freecad/ifcx_core.py` (real consumers)

---

## 0. Why this rewrite — what was wrong with the previous draft

The previous v3 mapping spec (`2026-05-22-ifcdraw-v3-ifcx-mapping.md`)
documented every entity twice: once as an `ifcx::geom::*` attribute, and
once as an "IFC alias" naming an IFC4X3 STEP entity
(`IfcPolyline`, `IfcCircle`, `IfcTrimmedCurve`,
`IfcBSplineCurveWithKnots`, `IfcAnnotationFillArea`,
`IfcPresentationLayerWithStyle`, `IfcRepresentationMap`,
`IfcMappedItem`, `IfcCartesianTransformationOperator2D`,
`IfcTextLiteralWithExtent`, `IfcGeometricRepresentationSubContext`,
`IfcImageTexture`, `IfcStyledItem`, `IfcCurveStyleFontPattern`,
`IfcTextStyle`, …).

Those IFC4X3 STEP names belong to a **different schema ecosystem**
(buildingSMART's IFC2x3/IFC4/IFC4.3 EXPRESS schemas, distributed as
STEP-21 ".ifc" files). IFCX is **not** that schema. IFCX is a
JSON/CBOR-native graph with:

1. A flat `data[]` array of nodes (no STEP entity numbers, no `#42`
   references).
2. Namespaced typed **attributes** that define what each node *is*
   (`ifcx::geom::line`, `ifcx::style::textStyle`,
   `ifcx::inspection::ticket`).
3. Inter-node refs via `{"ref": "path"}`, `children`, and `inherits`
   (not STEP integer surrogates).

There is **no `IfcPolyline` type** in an IFCX document. The
`IfcLine`/`IfcPolyline`/`IfcCircle` *names* that do appear in
`schema/ifcx-v2.schema.json` under `$defs.IfcxGeometry.oneOf` are an
**internal type vocabulary for geometry payloads embedded inside other
attributes** — they are never the discriminator on a `data[]` entry,
and they never appear in any of the example files. `text-v2.ifcx`
demonstrates the real convention: each entity is one entry in `data[]`
keyed by a `path`, with attributes named
`ifcx::geom::line`, `ifcx::geom::polyline`, `ifcx::annotation::text`,
`ifcx::connects::layer`, etc.

### What IFCX extension actually means

The user's clarification (re-read carefully):

> "IFCX laat toe dat je dingen toevoegt. Maar het is dus wel JSON
>  structuur. … Voor lijnen / teksten / hatches / arcs / circles /
>  blocks / dimensions — definieer ze als first-class IFCX node-types
>  binnen onze `o2d::*` namespace."

IFCX is **extensible by namespace**. Anyone who controls a publisher
prefix (here: `o2d` for Open 2D Studio) can register attribute types
under their namespace, and those attributes become first-class IFCX
node-types. `Ifc-Factory/docs/ifcx-inspection-schema-voorstel.md` does
exactly this: it adds `ifcx::inspection::ticket`,
`ifcx::inspection::handover`, `ifcx::signature`, etc. — these are NOT
IFC4X3 types either. They are IFCX namespace extensions, exactly the
mechanism we use.

So the IFCDraw v3 strategy is:

1. **Envelope** — verbatim IFCX v2 (`{header, imports, schemas, data,
   media}`), straight out of `schema/ifcx-v2.schema.json`.
2. **Entity types** — first-class IFCX attributes in our own
   `o2d::draft::*` namespace (e.g. `o2d::draft::Line`,
   `o2d::draft::Text`, `o2d::draft::Hatch`). Each entity node has
   **exactly one** primary `o2d::draft::*` attribute that names its
   type. (Like how `text-v2.ifcx` entries have exactly one of
   `ifcx::geom::line` / `ifcx::geom::polyline` / `ifcx::annotation::text`
   as the primary identifier.)
3. **Provenance** — DXF/DWG-roundtrip data in `o2d::dxf::*`. Renderer
   cache + format metadata in `o2d::ifcdraw::*`. These are sidecars to
   the primary `o2d::draft::*` payload; stripping them yields a clean
   `o2d::draft::*` drawing.
4. **Optional cross-vocabulary use** — we MAY also emit the equivalent
   `ifcx::geom::*` / `ifcx::style::*` attribute on the same node for
   tools that read pure IFCX (Blender, FreeCAD, Bonsai). This is a
   **non-load-bearing convenience**; the authoritative shape lives in
   `o2d::draft::*`. We commit to one direction of the cross-write in
   §3.4; the reader merges and prefers `o2d::draft::*` when both are
   present.

No `IfcPolyline`, no `IfcCircle`, no `IfcTrimmedCurve`, no
`IfcCartesianTransformationOperator2D`, no `IfcRepresentationMap`, no
`IfcMappedItem`, no `IfcAnnotationFillArea`, no
`IfcPresentationLayerWithStyle`. None of those strings appear in our
documents at any level (envelope, data, attribute key, attribute
value).

---

## §1 IFCX envelope conformance

### 1.1 Required top-level keys (from `ifcx-v2.schema.json`)

Per `$ref: "#/$defs/IfcxNode"` and the root schema:

```jsonc
{
  "header":  { /* IfcxHeader   — REQUIRED */ },
  "imports": [ /* IfcxImport[] — OPTIONAL */ ],
  "schemas": { /* inline schemas — OPTIONAL */ },
  "data":    [ /* IfcxNode[]   — REQUIRED */ ],
  "media":   { /* IfcxMedia    — OPTIONAL */ }
}
```

The v2 schema requires only `header` and `data`. IFCDraw v3 always
emits `header`, `imports`, `schemas`, `data`, and (when there are
embedded rasters) `media`. We never emit any other top-level key. The
binary envelope (see `2026-05-22-ifcdraw-v3-wire-format.md`) is allowed
to add an `o2d::tess` top-level chunk **outside** the IFCX document —
see §4.

### 1.2 Header

```jsonc
{
  "header": {
    "ifcxVersion": "2.0",                            // MUST
    "id":          "<RFC 4122 UUID v4>",             // SHOULD — document identity
    "dataVersion": "0.1.0",                          // SHOULD — semver, written each save
    "author":      "<from session, optional>",
    "organization":"<from settings, optional>",
    "application": "Open 2D Studio v<semver> (IFCDraw v3 writer)",
    "timestamp":   "2026-05-22T10:13:00Z",           // RFC 3339
    "units": {
      "length": "mm",   // schema allows: mm cm m km in ft yd mi
      "angle":  "rad",  // schema allows: rad deg grad
      "area":   "m2"
    },
    "coordinateSystem": {
      "epsg": 28992,                                  // optional — only when we know
      "wkt":  "<WKT-2 string, optional>"
    },
    "defaults": {
      "ifcx::purpose":      "drawing",
      "o2d::draft::layer":  { "ref": "layer-0" }     // every entity without an explicit layer = layer 0
    }
  }
}
```

Schema-conforming choices:

- **`ifcxVersion: "2.0"`** — we conform to v2 (the only version `data[]`
  uses); the alternate `"ifcx_alpha"` value is for true IFC5
  compatibility files and we don't use it.
- **`units.length: "mm"`** — the whole document is in millimetres, full
  stop. Original DXF/DWG unit string lives in `o2d::dxf::originalUnit`
  (§3, sidecar).
- **`defaults.ifcx::purpose`** — eliminates ~30% of redundant attribute
  writes per `docs/ifcx-structuur-analyse.md` §3.2 / §6.

### 1.3 How an IFCDraw document is identifiable as IFCDraw — without renaming any schema field

We do NOT mutate any IFCX-schema field name (no
`"ifcxVersion": "ifcdraw-3"`, no rename of `ifcxVersion` to
`ifcdrawVersion`, no extra required top-level key). A pure IFCX viewer
that loads our document MUST see it as a valid IFCX v2 document and
render the geometry it understands.

The marker we add is **a single self-describing entry in the `data[]`
array**, at the well-known path `o2d::format::ifcdraw`:

```jsonc
{
  "path": "o2d::format::ifcdraw",
  "attributes": {
    "o2d::ifcdraw::format": {
      "magic":          "IFCDRAW",
      "wireVersion":    3,
      "schemaProfile":  "ifcx-v2-strict",
      "generator":      "Open 2D Studio v0.1.0",
      "generatorURI":   "https://github.com/OpenAEC-Foundation/open-2d-studio",
      "createdAt":      "2026-05-22T10:13:00Z",
      "namespaces": [
        "o2d::draft",
        "o2d::dxf",
        "o2d::ifcdraw"
      ]
    }
  }
}
```

A pure IFCX viewer treats this entry as "node with an attribute in an
unknown namespace" → ignored without error (per IFC5 namespace-
extensibility, `docs/ifcx-structuur-analyse.md` §4.2). An IFCDraw-aware
reader recognises the path and switches on the appropriate o2d::* code
paths.

The text-mode `.ifcdraw.json` and the binary `.ifcdraw` envelope both
carry this entry. The binary envelope ALSO carries the `IFCDRAW\x03`
magic in the first 8 bytes for cheap dispatch (see wire-format spec),
but that's an envelope concern; the JSON document itself is identified
by the `o2d::format::ifcdraw` entry.

### 1.4 Imports

```jsonc
{
  "imports": [
    { "uri": "https://ifcx.dev/@standards.buildingsmart.org/ifc/core/ifc@v5a.ifcx" },
    { "uri": "https://ifcx.dev/@openusd.org/usd@v1.ifcx" },
    { "uri": "https://ifcx.openaec.org/schemas/geom@v1.ifcx" },
    { "uri": "https://ifcx.openaec.org/schemas/annotation@v1.ifcx" },
    { "uri": "https://ifcx.openaec.org/schemas/sheet@v1.ifcx" },
    { "uri": "https://ifcx.openaec.org/schemas/hatch@v1.ifcx" },
    { "uri": "https://ifcx.openaec.org/schemas/style@v1.ifcx" },
    { "uri": "https://ifcx.openaec.org/schemas/layer@v1.ifcx" },
    { "uri": "https://ifcx.openaec.org/schemas/component@v1.ifcx" },

    // o2d:: namespace schema imports — see §3 for the three URI files.
    // These URIs do not need to be resolvable today; the imports list
    // doubles as a content manifest, and unknown imports are advisory
    // per docs/ifcx-structuur-analyse.md §4.4.
    { "uri": "https://open-2d-studio.dev/schemas/draft@v1.ifcx",    "as": "o2d::draft"    },
    { "uri": "https://open-2d-studio.dev/schemas/dxf@v1.ifcx",      "as": "o2d::dxf"      },
    { "uri": "https://open-2d-studio.dev/schemas/ifcdraw@v1.ifcx",  "as": "o2d::ifcdraw"  }
  ]
}
```

A writer MUST emit any `o2d::*` import it actually uses; SHOULD omit
unused ones to keep the manifest honest. The reader MUST tolerate
unknown imports (don't fail just because the URI 404s).

### 1.5 Inline schemas

`schemas` is OPTIONAL per the schema and is the right place to declare
our `o2d::*` attribute shapes inline so the document is self-
describing without resolving external URIs (`ifcx-structuur-analyse.md`
§3.4). v3 ships this *empty* by default for size reasons and offers
a `--inline-schemas` writer flag that expands every `o2d::*` attribute
shape into the `schemas` map. The schema files referenced in the
`imports` section above are the source of truth.

### 1.6 Where the `o2d::*` namespaces are declared

Three places:

1. **`header.defaults`** — namespace-prefixed defaults (§1.2 example
   sets `o2d::draft::layer` default).
2. **`imports[]`** — three entries with `as: "o2d::draft"`, `as:
   "o2d::dxf"`, `as: "o2d::ifcdraw"` declare the namespaces formally
   (§1.4).
3. **The marker entry at path `o2d::format::ifcdraw`** — `namespaces`
   field lists every o2d::* prefix the document uses, so a reader can
   pre-flight namespace registration before walking `data[]` (§1.3).

---

## §2 Exhaustive entity mapping

Each `data[]` entry has the shape:

```jsonc
{
  "path":       "<unique id>",
  "children":   { /* optional, by-name child refs */ },
  "inherits":   { /* optional, by-role inheritance */ },
  "attributes": {
    "o2d::draft::<Type>": { /* primary payload — REQUIRED */ },

    // OPTIONAL sidecars, all in o2d:: namespaces:
    "o2d::dxf::sourceHandle":      "<hex>",
    "o2d::dxf::sourceOwner":       "<hex>",
    "o2d::dxf::sourceLayerName":   "<original case>",
    "o2d::dxf::aciColor":          7,
    "o2d::dxf::trueColor":         "0xRRGGBB",
    "o2d::dxf::lineTypeName":      "CENTER",
    "o2d::dxf::lineWeight":        -1,
    "o2d::dxf::xdata":             [ /* preserved 1001-group xdata */ ],
    "o2d::ifcdraw::guid":          "<22-char IFC GlobalId, stable across roundtrip>",
    "o2d::ifcdraw::origin":        "dwg|dxf|ifc|ifcdraw|created",

    // OPTIONAL cross-vocabulary mirror — written by default for interop
    // with pure-IFCX consumers (Blender / FreeCAD / Bonsai), ignored by
    // IFCDraw on re-read because o2d::draft::* takes precedence.
    "ifcx::geom::<shape>":         { /* equivalent IFCX shape */ }
  }
}
```

The table below is **complete for every entity type `kernel/crates/app/src/scene_io.rs` understands** and every record-type
`src-tauri/dwg-parser/parser.rs::obj_type_name` returns. "Required attrs"
are the geometric payload of the primary `o2d::draft::<Type>`; "Sidecar
attrs (o2d::dxf::*, etc.)" lists the provenance/style/roundtrip data
held in companion attribute keys on the same node.

### 2.1 Curve & primitive entities

| DXF/DWG entity     | Primary attribute on the IFCX node | Required attrs (inside the primary) | o2d::* sidecar attrs |
|--------------------|-------------------------------------|-------------------------------------|----------------------|
| `LINE`             | `o2d::draft::Line`                  | `p1: [x,y]`, `p2: [x,y]`            | `o2d::dxf::sourceHandle`, `o2d::dxf::aciColor`, `o2d::dxf::lineTypeName`, `o2d::dxf::lineWeight`, `o2d::draft::layer: {ref}`, `o2d::draft::color`, `o2d::draft::lineType: {ref}` |
| `POINT`            | `o2d::draft::Point`                 | `position: [x,y]`                   | `o2d::dxf::aciColor`, `o2d::draft::layer: {ref}`, `o2d::draft::displayMode: int (PDMODE)` |
| `CIRCLE`           | `o2d::draft::Circle`                | `center: [x,y]`, `radius: number`   | same drafting set as `Line` |
| `ARC`              | `o2d::draft::Arc`                   | `center: [x,y]`, `radius`, `startAngle (rad)`, `endAngle (rad)`, `counterClockwise: bool` | same |
| `ELLIPSE`          | `o2d::draft::Ellipse`               | `center`, `majorAxisEnd: [x,y]` (relative to center), `minorRatio: 0..1`, `startParam`, `endParam` | same |
| `SPLINE`           | `o2d::draft::Spline`                | `degree`, `controlPoints: [[x,y], …]`, `knots`, `weights?`, `closed`, `periodic`, `rational` | same; `fitPoints?` preserved for re-edit |
| `RAY`              | `o2d::draft::Ray`                   | `origin: [x,y]`, `direction: [dx,dy]` | same |
| `XLINE`            | `o2d::draft::ConstructionLine`      | `origin`, `direction`                | same |
| `LWPOLYLINE`       | `o2d::draft::Polyline`              | `vertices: [{x,y,bulge?,startWidth?,endWidth?}]`, `closed`, `constantWidth?`, `elevation?` | same; `o2d::dxf::plineGen` |
| `POLYLINE_2D`      | `o2d::draft::Polyline`              | identical shape (2D), `smoothType?` enum `none/quadratic/cubic/bezier`, `curveFit?`, `splineFit?` | same |
| `POLYLINE_3D`      | `o2d::draft::Polyline3D`            | `vertices: [[x,y,z]]`, `closed`, `splineFit?`, `smoothType?` | same |
| `POLYLINE_PFACE`   | `o2d::draft::PolyfaceMesh`          | `vertices: [[x,y,z]]`, `faces: [[idx,idx,idx,idx?]]` (1-based per DXF; we keep DXF semantics — sign bit = invisible edge) | same |
| `POLYLINE_MESH`    | `o2d::draft::PolygonMesh`           | `mSize`, `nSize`, `vertices: [[x,y,z]]` (row-major), `closedM`, `closedN`, `smoothType?` | same |
| `MLINE`            | `o2d::draft::MultiLine`             | `style: {ref: "mlinestyle-..."}`, `scale`, `justification: top/zero/bottom`, `closed`, `vertices`, `directions`, `miterDirections` | same |
| `HELIX`            | `o2d::draft::Helix`                 | `axisBase`, `axisTop`, `radius`, `topRadius`, `turns`, `height`, `handedness: left/right` | same |
| `SOLID`            | `o2d::draft::SolidTriangle`         | `points: [p1,p2,p3,p4]` (p4 == p3 for tri; DXF vertex-swap convention preserved verbatim) | same; `o2d::draft::fillColor` |
| `TRACE`            | `o2d::draft::Trace`                 | `points: [p1,p2,p3,p4]` (quad with width)  | same |
| `3DFACE`           | `o2d::draft::Face3D`                | `points: [p1,p2,p3,p4]`, `invisibleEdges: {e1,e2,e3,e4}` | same |
| `SHAPE`            | `o2d::draft::Shape`                 | `position`, `shapeNumber: int`, `shapeFile: string`, `size`, `rotation`, `xScale`, `oblique` | same |

### 2.2 Annotation entities

| DXF/DWG entity     | Primary attribute on the IFCX node | Required attrs                       | o2d::* sidecar attrs |
|--------------------|-------------------------------------|--------------------------------------|----------------------|
| `TEXT`             | `o2d::draft::Text`                  | `literal: string`, `anchor: [x,y]`, `height`, `rotation (rad)`, `widthFactor`, `oblique`, `hAlign: left/center/right/aligned/middle/fit`, `vAlign: baseline/bottom/middle/top`, `backward: bool`, `upsideDown: bool` | `o2d::draft::style: {ref: "textstyle-…"}`, `o2d::dxf::sourceHandle`, `o2d::draft::layer: {ref}`, `o2d::draft::color` |
| `MTEXT`            | `o2d::draft::MText`                 | `literal: string` (preserves `\P` `\C1` `\f…` codes verbatim), `anchor: [x,y]`, `height`, `width`, `rotation`, `attachment: top_left/…/bottom_right`, `direction: left_to_right/top_to_bottom/by_style`, `lineSpacingFactor`, `lineSpacingStyle: at_least/exact`, `columns?: {…}`, `richText?: [{text, font, bold, italic, color, size, …}]` | same; `o2d::dxf::rawCodes: true` flag = `literal` retains MTEXT codes |
| `ATTRIB`           | `o2d::draft::Attribute`             | `tag: string`, `value: string`, `anchor`, `height`, `rotation`, `style: {ref}`, `widthFactor`, `oblique`, `invisible`, `hAlign`, `vAlign` | same |
| `ATTDEF`           | `o2d::draft::AttributeDef`          | `tag`, `prompt`, `defaultValue`, plus all `Attribute` fields, plus `constant: bool`, `verify: bool`, `preset: bool`, `multiLine: bool` | same |
| `DIMENSION_LINEAR` | `o2d::draft::DimensionLinear`       | `defPoint1: [x,y]`, `defPoint2: [x,y]`, `dimLinePoint: [x,y]`, `rotation (rad)`, `obliqueAngle?`, `measuredValue: number`, `overrideText?: string` | `o2d::draft::dimStyle: {ref}`, `o2d::draft::associatedGeometry: [{ref}, …]`, `o2d::dxf::sourceHandle` |
| `DIMENSION_ALIGNED`| `o2d::draft::DimensionAligned`      | `defPoint1`, `defPoint2`, `dimLinePoint`, `obliqueAngle?` | same |
| `DIMENSION_ANG3PT` | `o2d::draft::DimensionAngular3Pt`   | `vertex: [x,y]` (apex), `defPoint1`, `defPoint2`, `arcPoint` | same |
| `DIMENSION_ANG2LN` | `o2d::draft::DimensionAngular2Ln`   | `lineAStart`, `lineAEnd`, `lineBStart`, `lineBEnd`, `arcPoint` | same |
| `DIMENSION_RADIUS` | `o2d::draft::DimensionRadius`       | `center`, `chordPoint`, `leaderLength` | same |
| `DIMENSION_DIAMETER`| `o2d::draft::DimensionDiameter`    | `center`, `chordPoint`, `leaderLength` | same |
| `DIMENSION_ORDINATE`| `o2d::draft::DimensionOrdinate`    | `featurePoint`, `leaderEndpoint`, `isXOrdinate: bool` | same |
| `DIMENSION_ARC`    | `o2d::draft::DimensionArc`          | `center`, `defPoint1`, `defPoint2`, `arcPoint`, `hasLeader: bool`, `leaderPoint1?`, `leaderPoint2?` | same |
| `LEADER`           | `o2d::draft::Leader`                | `vertices: [[x,y]]`, `hasArrowhead`, `pathType: straight/spline`, `annotationType: mtext/tolerance/block/none`, `annotationRef?: {ref}` | same |
| `MULTILEADER`      | `o2d::draft::MultiLeader`           | `style: {ref}`, `contentType: mtext/block/none`, `textContent?`, `blockContent?`, `leaders: [{lines: [{vertices, breakStart?, breakEnd?}]}]`, `dogleg: {enabled, length}`, `arrowSize`, `arrowBlock` | same |
| `TOLERANCE`        | `o2d::draft::Tolerance`             | `anchor`, `direction`, `frames: [{symbol, tolerance1, tolerance2, datum1, datum2, datum3}]` (GD&T) | `o2d::draft::dimStyle: {ref}` |
| `TABLE`            | `o2d::draft::Table`                 | `anchor`, `rotation`, `direction`, `rows`, `columns`, `rowHeights: [number]`, `columnWidths: [number]`, `cells: [{row, column, text|blockName, textHeight, textStyle, textColor, fillColor, alignment, borderColor, borderLineweight, borderVisible, mergeRange, formula?, fieldRef?}]` | `o2d::draft::style: {ref: "tablestyle-…"}` |

### 2.3 Fill / hatch entities

| DXF/DWG entity   | Primary attribute on the IFCX node | Required attrs | o2d::* sidecar attrs |
|------------------|-------------------------------------|----------------|----------------------|
| `HATCH` (solid)  | `o2d::draft::HatchSolid`            | `color: "0xRRGGBB"`, `boundaries: [{type: polyline/edges/default/outermost, polyline?: {vertices: [{x,y,bulge?}], closed}, edges?: [{edgeType: line/arc/ellipticArc/spline, …}], sourceRefs?: [{ref}]}]`, `elevation?`, `originPoint?` | `o2d::dxf::associative: bool`, `o2d::draft::layer: {ref}` |
| `HATCH` (pattern)| `o2d::draft::HatchPattern`          | `patternName: string`, `patternType: user_defined/predefined/custom`, `patternAngle (rad)`, `patternScale`, `patternDouble: bool`, `patternDefinition?: [{angle, basePoint, offset, dashes}]`, `boundaries: [...]` (same shape as solid) | `o2d::draft::layer: {ref}`, `o2d::draft::pattern: {ref: "pattern-..."}` (named source) |
| `HATCH` (gradient)| `o2d::draft::HatchGradient`        | `gradient: {name: LINEAR/CYLINDER/INVCYLINDER/SPHERICAL/…, angle, centered, shift?, singleColor, tint?, color1, color2}`, `boundaries: [...]` | same |
| `WIPEOUT`        | `o2d::draft::Wipeout`               | `vertices: [[x,y]]`, `showFrame: bool` | `o2d::draft::layer: {ref}` |
| `IMAGE`          | `o2d::draft::RasterImage`           | `anchor: [x,y]`, `uVector: [x,y]`, `vVector: [x,y]`, `imageSize: [w,h]` (pixels), `media: {ref: "img-..."}` (points into top-level `media` map), `showImage`, `showFrame`, `brightness`, `contrast`, `fade`, `clipping?: {enabled, type: rect/poly, vertices}` | `o2d::dxf::imagePath?: string` (original linked path) |
| `OLE2FRAME`      | `o2d::draft::OleFrame`              | `upperLeft`, `lowerRight`, `oleType: linked/embedded/static`, `media: {ref: "ole-..."}` | — |
| `UNDERLAY`       | `o2d::draft::Underlay`              | `underlayType: pdf/dwf/dgn`, `anchor`, `scale: [sx,sy,sz]`, `rotation`, `filePath`, `contrast`, `fade`, `monochrome`, `adjustColors`, `clipBoundary?: [[x,y]]`, `clipInverted: bool`, `on: bool` | — |

### 2.4 Composition / structural entities

| DXF/DWG concept  | Primary attribute on the IFCX node | Required attrs | Notes |
|------------------|-------------------------------------|----------------|-------|
| `BLOCK` (definition)  | `o2d::draft::BlockDef`         | `name: string`, `basePoint: [x,y,z]`, `description?`, `isAnonymous`, `isXRef`, `isXRefOverlay`, `xRefPath?`, `hasAttributes`, `attDefs: [{ref}]`, `dynamicBlock?: {parameters, actions, visibilityStates}` | `children: {<entityName>: <entity-path>, …}` on the same node lists the entities that comprise the block — exactly the `def-…` / children pattern in `text-v2.ifcx`. |
| `INSERT`         | `o2d::draft::Insert`                | `block: {ref: "block-..."}`, `anchor: [x,y]`, `scale: [sx,sy,sz]`, `rotation (rad)`, `columnCount: 1`, `rowCount: 1`, `columnSpacing: 0`, `rowSpacing: 0` | `inherits: {blockDef: "block-..."}` is equivalent and IFCX-idiomatic; we emit `inherits` **and** the explicit `block` ref for clarity. Per-instance ATTRIBs are linked via `children: {TAG: <attrib-path>}`. |
| `MINSERT`        | `o2d::draft::Insert`                | identical to INSERT — the rect-array fields differentiate it | — |
| `VIEWPORT` (model-space) | `o2d::draft::ViewportConfig` | mirrors DXF `VPORT` table entry: `lowerLeft, upperRight, center, height, aspectRatio, snapBase, snapSpacing, gridSpacing, viewDirection, viewTarget, lensLength, twist` | Goes under `tables/viewports/<name>`. |
| `VIEWPORT` (entity, paper-space) | `o2d::draft::ViewportEntity` | `center`, `width`, `height`, `id`, `viewCenter`, `viewHeight`, `viewDirection`, `viewTarget`, `lensLength`, `frontClip?`, `backClip?`, `snapBase?`, `snapSpacing?`, `gridSpacing?`, `snapAngle?`, `twistAngle`, `circleSides?`, `frozenLayers: [string]`, `ucsRef?: {ref}`, `scale?`, `locked`, `on`, `clipBoundary?: {ref}` | Lives inside a sheet (children). |

### 2.5 Symbol tables — modelled as IFCX nodes

DXF tables (LAYER, LTYPE, STYLE, DIMSTYLE, VPORT, UCS, VIEW, APPID,
BLOCK_RECORD) and dictionary objects (LAYOUT, PLOTSETTINGS, GROUP,
MLINESTYLE, TABLESTYLE, MLEADERSTYLE, IMAGEDEF, FIELD, GEODATA,
SORTENTSTABLE, MATERIAL, VISUALSTYLE, SCALE, DICTIONARY, XRECORD) each
become an IFCX node with a primary `o2d::draft::*` attribute.

| DXF table/object record | Primary attribute on the IFCX node | Required attrs |
|-------------------------|-------------------------------------|----------------|
| `LAYER`         | `o2d::draft::Layer`             | `name`, `color: "0xRRGGBB"`, `lineType: {ref}`, `lineWeight: number (mm, -1/-2/-3 = default/byblock/bylayer)`, `frozen`, `locked`, `off`, `plot`, `description?`, `transparency?` |
| `LTYPE`         | `o2d::draft::LineType`          | `description`, `patternLength?`, `pattern: [number]` (positive = dash, negative = gap, 0 = dot), `complexElements?: [{type: shape/text, style, value, scale, rotation, offset}]` |
| `STYLE`         | `o2d::draft::TextStyle`         | `name`, `fontFamily`, `bigFont?`, `height` (0 = variable), `widthFactor`, `oblique (rad)`, `isVertical`, `isBackward`, `isUpsideDown`, `isTrueType`, `bold`, `italic` |
| `DIMSTYLE`      | `o2d::draft::DimensionStyle`    | every DXF DIMSTYLE field, named verbatim from `schema/ifcx.schema.json $defs.DimStyle` — `overallScale`, `linearScale`, `arrowSize`, `arrowBlock`, `arrowBlock1`, `arrowBlock2`, `leaderArrowBlock`, `textHeight`, `textStyle: {ref}`, `textColor`, `textInsideAlign`, `textOutsideAlign`, `textAboveDimLine`, `textVerticalPosition`, `textMovement`, `textGap`, `dimLineColor`, `dimLineWeight`, `dimLineExtension`, `dimLineIncrement`, `suppressDimLine1`, `suppressDimLine2`, `extLineColor`, `extLineWeight`, `extLineOffset`, `extLineExtension`, `suppressExtLine1`, `suppressExtLine2`, `fixedExtLineLength`, `centerMarkSize`, `centerMarkType`, `linearUnit`, `linearPrecision`, `decimalSeparator`, `roundOff`, `prefix`, `suffix`, `zeroSuppression`, `angularUnit`, `angularPrecision`, `tolerance: {...}`, `alternate: {...}`, `fit`, `forceLineInside`, `forceTextInside`, `textJustification` |
| `VPORT`         | `o2d::draft::ViewportConfig`    | see §2.4 |
| `UCS`           | `o2d::draft::UCS`               | `origin`, `xAxis`, `yAxis` |
| `VIEW`          | `o2d::draft::NamedView`         | `center`, `height`, `width`, `direction`, `target`, `lensLength`, `frontClip?`, `backClip?`, `twist` |
| `APPID`         | `o2d::draft::AppId`             | `name` |
| `LAYOUT`        | `o2d::draft::Layout`            | `name`, `tabOrder`, `isModelSpace`, `blockRecordRef?: {ref}`, `plotSettings?: {ref}`, `limitsMin`, `limitsMax`, `extentsMin`, `extentsMax`, `origin`, `xAxis`, `yAxis`, `elevation` |
| `PLOTSETTINGS`  | `o2d::draft::PlotSettings`      | every DXF PLOTSETTINGS field — `name`, `printer`, `paperSize`, `plotOrigin`, `paperWidth`, `paperHeight`, `marginLeft/Bottom/Right/Top`, `plotArea`, `plotScale`, `scaleNumerator`, `scaleDenominator`, `scaleToFit`, `plotRotation: "0"/"90"/"180"/"270"`, `plotStyleTable`, `plotStyleType`, `centerPlot`, `plotHidden`, `plotTransparency`, `plotViewportFirst`, `windowMin/Max`, `shadePlot`, `quality`, `customDpi` |
| `GROUP`         | `o2d::draft::Group`             | `name`, `description?`, `selectable`, `members: [{ref}]` |
| `MLINESTYLE`    | `o2d::draft::MLineStyle`        | `name`, `description?`, `fillColor?`, `filled`, `startAngle (rad)`, `endAngle (rad)`, `showMiters`, `startCap`, `endCap`, `elements: [{offset, color, lineType: {ref}}]` |
| `TABLESTYLE`    | `o2d::draft::TableStyle`        | `name`, `description?`, `flowDirection`, `cellStyles: {title, header, data}` (each = `{textHeight, textStyle: {ref}, textColor, fillColor, alignment, borderColor, borderLineweight, borderVisible, hasFill}`) |
| `MLEADERSTYLE`  | `o2d::draft::MLeaderStyle`      | `name`, `contentType`, `textStyle: {ref}`, `textColor`, `textHeight`, `textAlignment`, `blockName`, `blockColor`, `arrowSize`, `arrowBlock`, `leaderType`, `leaderColor`, `leaderLineweight`, `leaderLineType: {ref}`, `doglegEnabled`, `doglegLength`, `maxLeaderPoints`, `landingGap`, `scale` |
| `IMAGEDEF`      | `o2d::draft::ImageDef`          | `filePath`, `width`, `height`, `resolution: [x,y]`, `isLoaded` |
| `FIELD`         | `o2d::draft::Field`             | `formula`, `format?`, `evaluatedValue?`, `childFields: [{ref}]` |
| `GEODATA`       | `o2d::draft::GeoData`           | `coordinateSystem`, `designPoint`, `referencePoint`, `northDirection`, `horizontalUnit`, `verticalUnit`, `scaleEstimation` |
| `SORTENTSTABLE` | `o2d::draft::SortEntsTable`     | `blockRef: {ref}`, `entityOrder: [{ref}, …]` |
| `MATERIAL`      | `o2d::draft::Material`          | `name`, `description?`, `ambient?`, `diffuse?`, `specular?`, `shininess?`, `opacity`, `reflectance?`, `refraction?`, `selfIllumination?`, `textures: [{mapType, filePath, blendFactor, scaleU, scaleV}]` |
| `VISUALSTYLE`   | `o2d::draft::VisualStyle`       | `name`, `description?`, `faceStyle`, `edgeModel`, `faceColorMode`, `faceOpacity`, `edgeColor`, `silhouetteColor`, `silhouetteWidth` |
| `SCALE`         | `o2d::draft::Scale`             | `name`, `paperUnits`, `drawingUnits`, `isUnitScale` |
| `DICTIONARY`    | `o2d::draft::Dictionary`        | `entries: {<name>: {ref}}`, `hardOwned`, `defaultValue?: {ref}` |
| `XRECORD`       | `o2d::draft::XRecord`           | `data: [{code: int, value: any}]` (verbatim DXF group codes — opaque, round-trippable) |
| `GEOPOSITIONMARKER` | `o2d::draft::GeoMarker`     | `position`, `latitude`, `longitude`, `altitude`, `text` |
| `3DSOLID`/`BODY`/`REGION` | `o2d::draft::AcisBody`  | `kind: "3DSOLID"\|"BODY"\|"REGION"`, `acisData: string` (base64 or hex SAT stream), `modelerVersion: int`, `brep?: {vertices, faces: [[idx]], normals?}` (alternative interpretation) |
| `SURFACE`       | `o2d::draft::Surface`           | `surfaceType: planar/extruded/revolved/lofted/swept/nurbs`, `acisData: string`, `modelerVersion` |
| `MESH`          | `o2d::draft::SubdivisionMesh`   | `subdivisionLevel`, `vertices: [[x,y,z]]`, `faces: [[idx, …]]`, `edges?: [{from, to, crease}]` |
| `PROXY`         | `o2d::draft::ProxyEntity`       | `originalType`, `applicationName`, `className`, `graphicsData?: base64`, `entityData?: base64`, `proxyFlags` |
| `LIGHT`         | `o2d::draft::Light`             | `lightType: point/spot/distant`, `position`, `target?`, `intensity`, `color`, `on`, `castShadows`, `hotspotAngle?`, `falloffAngle?`, `attenuation?: {type, startLimit, endLimit}` |
| `CAMERA`        | `o2d::draft::Camera`            | `position`, `target`, `lensLength`, `fieldOfView?`, `frontClip?`, `backClip?`, `roll` |
| `SECTION`       | `o2d::draft::Section`           | `vertices: [[x,y,z]]`, `direction`, `state: plane/boundary/volume`, `name?` |

### 2.6 Project root and grouping nodes

These are pure IFCX structural nodes — no `o2d::draft::*` payload, only
`ifcx::purpose` + `children` (and optionally an extra `o2d::ifcdraw::*`
attribute when we want a project-level marker). They mirror the
`text-v2.ifcx` pattern (`project`, `drawings`, `definitions`, `styles`,
`view-main`) verbatim:

```jsonc
{
  "path": "project",
  "children": {
    "drawings":    "drawings",
    "definitions": "definitions",
    "styles":      "styles",
    "sheets":      "sheets",
    "annotations": "annotations"
  },
  "attributes": {
    "ifcx::purpose": "drawing"
  }
}

{ "path": "drawings",    "children": { "main": "view-main" }, "attributes": { "ifcx::purpose": "drawing" } }
{ "path": "definitions", "children": { "<block-name>": "block-<uuid>", … }, "attributes": { "ifcx::purpose": "definition" } }
{ "path": "styles",      "children": { "layer-Walls": "layer-Walls", "linetype-CENTER": "linetype-…", … }, "attributes": { "ifcx::purpose": "drawing" } }
{ "path": "sheets",      "children": { "A1-001": "sheet-A1-001", … }, "attributes": { "ifcx::purpose": "sheet" } }
{ "path": "annotations", "children": { "dim-...": "dim-...", … }, "attributes": { "ifcx::purpose": "annotation" } }

{ "path": "view-main",
  "children": { "<dxf-handle-hex>": "<entity-path>", … },   // mirrors text-v2.ifcx
  "attributes": {
    "ifcx::purpose": "drawing",
    "ifcx::view::name":  "Model",
    "ifcx::view::scale": 1.0,
    "o2d::draft::isModelSpace": true,
    "o2d::draft::extents": { "min": [xmin, ymin], "max": [xmax, ymax] }
  }
}
```

Per-sheet (paperspace LAYOUT) nodes have:

```jsonc
{
  "path": "sheet-A1-001",
  "children": {
    "vp-1":       "viewport-12ab",
    "titleblock": "e-insert-titleblock"
  },
  "attributes": {
    "ifcx::purpose":    "sheet",
    "ifcx::sheet::paper": {
      "width": 841, "height": 594,
      "margins": [10, 10, 10, 10],
      "orientation": "landscape"
    },
    "ifcx::sheet::plotSettings": {
      "scale": "1:100",
      "area":  "layout",
      "styleTable": "default.ctb"
    },
    "o2d::draft::layout": { "ref": "layout-A1-001" }
  }
}
```

The `ifcx::purpose`, `ifcx::view::*`, and `ifcx::sheet::*` attribute
keys are the canonical IFCX vocabulary already documented in
`Ifc-Factory/schema/attributes.md` and demonstrated in
`text-v2.ifcx` — we adopt them as-is for structural concerns and only
add `o2d::draft::*` for entity-level payload. (Using the IFCX vocab
for project/view/sheet structure is the cleanest interop choice: a
pure-IFCX viewer that imports `sheet@v1.ifcx` already understands
sheets, viewports, and layouts; only the entity contents (`o2d::draft::Line`,
`o2d::draft::Hatch`) are opaque to it.)

### 2.7 Entities IFCX viewers can render natively (interop mirror)

When the writer is configured with `--cross-write-ifcx-geom` (default
on for files exchanged externally), every node carrying a curve or
text primary attribute ALSO emits the matching `ifcx::geom::*` /
`ifcx::annotation::*` attribute on the same node. The duplication
costs ~30 bytes per entity uncompressed (and ~0 after zstd because the
namespaces dedup perfectly).

The mirror table:

| IFCDraw primary attribute                  | IFCX mirror attribute key            |
|--------------------------------------------|--------------------------------------|
| `o2d::draft::Line`                         | `ifcx::geom::line`                   |
| `o2d::draft::Polyline` (no bulges)         | `ifcx::geom::polyline`               |
| `o2d::draft::Polyline` (with bulges)       | `ifcx::geom::compositeCurve`         |
| `o2d::draft::Polyline3D`                   | `ifcx::geom::polyline` (3D points)   |
| `o2d::draft::Circle`                       | `ifcx::geom::circle`                 |
| `o2d::draft::Arc`                          | `ifcx::geom::trimmedCurve`           |
| `o2d::draft::Ellipse`                      | `ifcx::geom::ellipse`                |
| `o2d::draft::Spline`                       | `ifcx::geom::bspline`                |
| `o2d::draft::Ray`                          | `ifcx::geom::ray`                    |
| `o2d::draft::ConstructionLine`             | `ifcx::geom::constructionLine`       |
| `o2d::draft::Point`                        | `ifcx::geom::point`                  |
| `o2d::draft::PolyfaceMesh`/`PolygonMesh`/`SubdivisionMesh` | `ifcx::geom::mesh` |
| `o2d::draft::Face3D`/`SolidTriangle`/`Trace` | `ifcx::geom::mesh` (triangulated) |
| `o2d::draft::AcisBody`/`Surface`           | `ifcx::geom::solid`                  |
| `o2d::draft::Text`/`MText`                 | `ifcx::annotation::text` (+ `ifcx::annotation::richText` for MText spans) |
| `o2d::draft::DimensionLinear` etc.         | `ifcx::annotation::dimension` (`subtype` field discriminates) |
| `o2d::draft::Leader`/`MultiLeader`         | `ifcx::annotation::leader`           |
| `o2d::draft::Tolerance`                    | `ifcx::annotation::tolerance`        |
| `o2d::draft::Table`                        | `ifcx::annotation::table`            |
| `o2d::draft::HatchSolid`                   | `ifcx::hatch::solid` + `ifcx::hatch::boundary` |
| `o2d::draft::HatchPattern`                 | `ifcx::hatch::pattern` + `ifcx::hatch::boundary` |
| `o2d::draft::HatchGradient`                | `ifcx::hatch::gradient` + `ifcx::hatch::boundary` |
| `o2d::draft::RasterImage`                  | `ifcx::image::raster`                |
| `o2d::draft::Wipeout`                      | `ifcx::image::wipeout`               |
| `o2d::draft::Layer`                        | `ifcx::layer::assignment` + `ifcx::layer::style` |
| `o2d::draft::LineType`                     | `ifcx::style::curveStyle` (with `dashPattern`) |
| `o2d::draft::TextStyle`                    | `ifcx::style::textStyle`             |
| `o2d::draft::DimensionStyle`               | `ifcx::style::dimensionStyle` (extensible bag — IFC has no equivalent, IFCX defined it) |
| `o2d::draft::BlockDef`                     | `ifcx::component::definition`        |
| `o2d::draft::Insert`                       | `inherits: {blockDef: ref}` + `ifcx::xform::matrix` (per `text-v2.ifcx` convention) |
| `o2d::draft::ViewportEntity`               | `ifcx::sheet::viewport`              |
| `o2d::draft::Layout`/`PlotSettings`/sheet  | `ifcx::sheet::paper` + `ifcx::sheet::plotSettings` |
| `o2d::draft::AppId`/`UCS`/`NamedView`/`Field`/`SortEntsTable`/etc. | no IFCX equivalent — pure-IFCX viewer ignores |
| `o2d::draft::Material`/`VisualStyle`/`Light`/`Camera` | usd::* mirrors (IFCX imports USD) — out of scope for v3.0 (3D concerns) |

Entities without a public IFCX equivalent (APPID, GROUP, SORTENTSTABLE,
FIELD, GEODATA, VISUALSTYLE, SCALE, DICTIONARY, XRECORD, OLE2FRAME,
UNDERLAY, PROXY) live ONLY under `o2d::draft::*`. They round-trip
losslessly between IFCDraw documents and IFCDraw consumers (Open 2D
Studio, Revit/Bonsai bridges using our SDK) but are opaque to a
pure-IFCX viewer that doesn't know o2d::*. That is the correct
behaviour per IFCX namespace-extensibility (`ifcx-structuur-analyse.md`
§4.2): unknown namespaces are silently ignored.

### 2.8 Linkage shapes — refs, inherits, children

| Linkage                                | Shape                                       | Used for                                  |
|----------------------------------------|---------------------------------------------|-------------------------------------------|
| **Layer assignment**                   | `o2d::draft::layer: {"ref": "layer-Walls"}` | Every visible entity                      |
| **Linetype assignment**                | `o2d::draft::lineType: {"ref": "linetype-CENTER"}` | Entity-level override                  |
| **Text-style assignment**              | `o2d::draft::style: {"ref": "textstyle-Standard"}` | Text, MText, Attrib, AttDef            |
| **Dim-style assignment**               | `o2d::draft::dimStyle: {"ref": "dimstyle-Standard"}` | Dimensions, Tolerances, Leaders        |
| **Block instantiation (preferred)**    | `inherits: {"blockDef": "block-DOOR"}`      | INSERT — IFCX-idiomatic                   |
| **Block instantiation (explicit)**     | `o2d::draft::Insert.block: {"ref": "block-DOOR"}` | Same node, explicit cross-ref (clarity) |
| **Block ATTRIB attachment**            | `children: {"TITLE": "e-attrib-title"}` on the INSERT | Inside-INSERT attribute children    |
| **Block constituents**                 | `children: {<entityName>: <entity-path>}` on the `o2d::draft::BlockDef` node | Inside a block definition |
| **Associative dimension target**       | `o2d::draft::associatedGeometry: [{ref}, …]` | Dimensions linked to drawing entities    |
| **Hatch boundary source-ref**          | `boundaries[].sourceRefs: [{ref}, …]`       | Associative HATCH boundaries             |
| **Viewport clip boundary**             | `o2d::draft::ViewportEntity.clipBoundary: {ref}` | Non-rectangular viewports             |
| **Pattern definition reference**       | `o2d::draft::pattern: {"ref": "pattern-arc-NEN47-beton"}` | Named hatch patterns from `patterns/` SVG corpus |
| **External raster image data**         | `o2d::draft::RasterImage.media: {"ref": "img-001"}` | Points into top-level `media` map     |

`inherits` for block instantiation is documented as the IFCX-idiomatic
pattern in `Ifc-Factory/schema/attributes.md` §"Block/Component" and
demonstrated in `text-v2.ifcx` for material assignment.

### 2.9 Coordinate, color, and unit conventions

- **Coords** — every numeric in `o2d::draft::*` payloads is `f64` in
  millimetres (matching `header.units.length: "mm"`). The unit string
  goes through `o2d::dxf::originalUnit` (e.g. `"inches"`, `"meters"`)
  as a non-load-bearing annotation. Coords are stored as JSON numbers
  in text mode and as CBOR `float64` in binary mode. No q16
  quantisation in v3 — see §7 open question (A).
- **Angles** — always radians per `header.units.angle: "rad"`. DXF stores
  some angles (DIMSTYLE) in degrees; the converter normalises on read,
  the original degree value is preserved in `o2d::dxf::*` for byte-
  perfect roundtrip.
- **Colors** — primary representation is a string `"0xRRGGBB"` (8-char
  uppercase hex) on the `o2d::draft::*` attribute. `o2d::dxf::aciColor`
  carries the original AutoCAD Color Index integer for round-trip;
  `o2d::dxf::trueColor` carries any DXF group-420 24-bit override.
  Transparency goes through `o2d::draft::opacity: number` (0..1) and
  `o2d::dxf::transparency: number` (0..1, preserving DXF group-440
  exactly).
- **GUID** — every node persisted to disk has a stable
  `o2d::ifcdraw::guid` (22-char IFC GlobalId, base64-encoded UUID v4).
  See §5 for the synthesis rules.
- **Handles** — for DWG/DXF-sourced nodes we ALWAYS carry
  `o2d::dxf::sourceHandle` (raw hex, uppercase, no leading zero
  trimming — the same string DXF group code 5 returns). For new
  entities created inside Open 2D Studio, we omit `o2d::dxf::*`
  entirely and set `o2d::ifcdraw::origin: "created"`.

---

## §3 The three `o2d::*` namespaces

We register three namespaces. Each has an `as:` alias in `imports[]`
(§1.4) and a schema file URI (declared, doesn't need to resolve today).

### 3.1 `o2d::draft::*` — drafting-domain attributes

**URI**: `https://open-2d-studio.dev/schemas/draft@v1.ifcx`
**Local schema file**: `kernel/crates/ifcdraw/schemas/draft@v1.json`
**Scope**: Every first-class node-type of a 2D CAD drawing — primitives,
annotations, fills, blocks/inserts, layers/linetypes/textstyles/
dimstyles, layouts and viewports.

The complete attribute-key list is the union of the "Primary attribute"
columns in §2.1–§2.5. The schema validates each `o2d::draft::*` value
as an object with required fields per the "Required attrs" column.

In addition to typed primary attributes, `o2d::draft::*` defines a
handful of shared building blocks consumed by multiple primaries:

| Key                              | Type                                                                                                                | Used by                                            |
|----------------------------------|---------------------------------------------------------------------------------------------------------------------|----------------------------------------------------|
| `o2d::draft::layer`              | `{"ref": "layer-<name>"}`                                                                                           | every visible entity (or as header default)        |
| `o2d::draft::color`              | string `"0xRRGGBB"` OR `{"r":0..1, "g":0..1, "b":0..1, "a":0..1}` OR `"byLayer"` OR `"byBlock"`                     | every visible entity                               |
| `o2d::draft::lineType`           | `{"ref": "linetype-<name>"}` OR `"byLayer"` OR `"byBlock"`                                                          | curves                                             |
| `o2d::draft::lineWeight`         | `number` (mm) OR `"byLayer"` OR `"byBlock"` OR `"default"`                                                          | curves                                             |
| `o2d::draft::style`              | `{"ref": "textstyle-<name>"}`                                                                                       | text                                               |
| `o2d::draft::dimStyle`           | `{"ref": "dimstyle-<name>"}`                                                                                        | dimensions / leaders / tolerances                  |
| `o2d::draft::opacity`            | `number` (0..1)                                                                                                     | optional, any entity                               |
| `o2d::draft::extrusion`          | `[dx, dy, dz]` (DXF OCS normal)                                                                                     | optional, any entity (legacy DXF compatibility)    |
| `o2d::draft::elevation`          | `number` (Z in OCS)                                                                                                 | optional, polylines / hatches                      |
| `o2d::draft::space`              | `"model"` (default) or `"paper"`                                                                                    | optional, any entity                               |
| `o2d::draft::visible`            | `bool` (default true)                                                                                               | optional, any entity                               |
| `o2d::draft::associatedGeometry` | `[{ref}, …]`                                                                                                        | dimensions, hatches                                |
| `o2d::draft::pattern`            | `{"ref": "pattern-<name>"}`                                                                                         | hatches that reference a `patterns/*.pat` or `.svg` |
| `o2d::draft::isModelSpace`       | `bool`                                                                                                              | view nodes                                         |
| `o2d::draft::extents`            | `{"min": [x,y], "max": [x,y]}`                                                                                      | view nodes                                         |
| `o2d::draft::layout`             | `{"ref": "layout-<name>"}`                                                                                          | sheet nodes                                        |

### 3.2 `o2d::dxf::*` — DXF/DWG provenance for lossless roundtrip

**URI**: `https://open-2d-studio.dev/schemas/dxf@v1.ifcx`
**Local schema file**: `kernel/crates/ifcdraw/schemas/dxf@v1.json`
**Scope**: Every byte of DXF/DWG metadata that doesn't fit the
`o2d::draft::*` model but is needed to write back a byte-identical
DXF/DWG. Pure roundtrip sidecar — never affects rendering.

| Key                              | Type                          | Notes                                                                            |
|----------------------------------|-------------------------------|----------------------------------------------------------------------------------|
| `o2d::dxf::sourceHandle`         | string (hex)                  | DXF group code 5 — entity handle                                                 |
| `o2d::dxf::sourceOwner`          | string (hex)                  | DXF group code 330 — owner block-record handle                                   |
| `o2d::dxf::sourceLayerName`      | string                        | Layer name case preserved (DXF is case-insensitive but tools differ)             |
| `o2d::dxf::sourceLineTypeName`   | string                        | DXF group code 6                                                                 |
| `o2d::dxf::sourceTextStyleName`  | string                        | DXF group code 7 / DXF style table reference                                     |
| `o2d::dxf::aciColor`             | integer (0-256)               | 0=BYBLOCK, 256=BYLAYER, 1-255=ACI table entry — see `Ifc-Factory/integrations/blender/ifcx_addon/ifcx_core.py` for the canonical 256-entry table we reuse |
| `o2d::dxf::trueColor`            | string `"0xRRGGBB"`           | DXF group code 420 — true-color override (not always present)                    |
| `o2d::dxf::lineWeight`           | integer                       | DXF group code 370 (-1=byLayer, -2=byBlock, -3=default; 0-211 = 1/100 mm)        |
| `o2d::dxf::transparency`         | number (0..1)                 | DXF group code 440 (alpha=0xCC + (0..255))                                       |
| `o2d::dxf::xdata`                | `[{appId, items: [{code, value}]}]` | Verbatim xdata blocks (1001+ group codes), one per APPID                   |
| `o2d::dxf::extensionDictHandle`  | string (hex)                  | DXF group code 360 — extension dictionary owner                                  |
| `o2d::dxf::reactors`             | `[string]`                    | DXF group code 102 `{ACAD_REACTORS}` chain — persistent reactors                 |
| `o2d::dxf::plineGen`             | bool                          | LWPOLYLINE 128-flag (linetype gen across vertices)                               |
| `o2d::dxf::imagePath`            | string                        | Original linked-image absolute or relative path (for IMAGE entities)             |
| `o2d::dxf::associative`          | bool                          | HATCH associative flag (DXF group code 71)                                       |
| `o2d::dxf::originalUnit`         | string                        | Original `$INSUNITS` token ("inches", "meters", "millimeters", …)                |
| `o2d::dxf::originalAngular`      | string                        | Original `$AUNITS` token ("decimal_degrees", "radians", …)                       |
| `o2d::dxf::headerVars`           | object                        | Whole DXF HEADER section — verbatim group-code/value map, on the **document-root** node (path `o2d::format::ifcdraw`) — preserves all $-vars not modelled in `o2d::draft::*` |
| `o2d::dxf::rawCodes`             | bool                          | MTEXT flag = `literal` retains MTEXT format codes (`\P`, `\C1`, …)               |
| `o2d::dxf::dwgClass`             | object                        | For DWG-sourced entities of class number ≥ 500 — class id + appname for roundtrip |
| `o2d::dxf::dwgObjectMapOrder`    | integer                       | Optional — original DWG object-map ordinal for stable re-encoding                |
| `o2d::dxf::dwgChunkRaw`          | binary (CBOR `bstr`)          | OPTIONAL — opaque bytes of an unparsed DWG object (PROXY-bypass fallback)        |

The two roundtrip levels:

1. **Functional roundtrip** (default) — every `o2d::dxf::*` field above
   except `dwgChunkRaw` is emitted. The result re-writes to DXF/DWG
   without losing any DXF semantic; minor formatting differences are
   accepted (e.g. our writer's float precision vs. AutoCAD's; integer
   group-code ordering inside a single entity).
2. **Byte-identical roundtrip** (opt-in, `--preserve-raw`) — for any
   DWG object the parser couldn't fully decode, `dwgChunkRaw` holds the
   compressed-bytes payload verbatim. The writer rewrites it without
   touching the bytes. Used by §5's "embed source DWG" answer if we
   commit to it (§7 open question (B)).

### 3.3 `o2d::ifcdraw::*` — IFCDraw-format metadata

**URI**: `https://open-2d-studio.dev/schemas/ifcdraw@v1.ifcx`
**Local schema file**: `kernel/crates/ifcdraw/schemas/ifcdraw@v1.json`
**Scope**: Format-level metadata, tessellation cache hints, GUID
provenance, and the format-identification marker.

| Key                              | Type / location                                  | Notes                                                                 |
|----------------------------------|--------------------------------------------------|-----------------------------------------------------------------------|
| `o2d::ifcdraw::format`           | document-root only (path `o2d::format::ifcdraw`) | Format identification — see §1.3                                       |
| `o2d::ifcdraw::guid`             | per-node string (22 chars, IFC GlobalId)         | Stable across roundtrip — see §5                                       |
| `o2d::ifcdraw::origin`           | per-node string (enum)                           | `"dxf" | "dwg" | "ifc" | "ifcdraw" | "created"`                        |
| `o2d::ifcdraw::tess`             | per-node `{vertCount, triCount, byteOffset?}`    | OPTIONAL renderer-hint for ENTITY whose tessellation is in the binary `o2d::tess` chunk |
| `o2d::ifcdraw::saveHistory`      | document-root, array of `{revision, timestamp, author}` | OPTIONAL — light audit trail, distinct from the heavier `ifcx::revision::*` model |
| `o2d::ifcdraw::importContext`    | document-root, object                            | OPTIONAL — source filename, original byte length, original SHA-256, IFCDraw writer version that converted it |

### 3.4 Cross-write policy

The writer is configurable along two axes:

| Flag                        | Default | Effect                                                                                                                 |
|-----------------------------|---------|------------------------------------------------------------------------------------------------------------------------|
| `--cross-write-ifcx-geom`   | **on**  | Every `o2d::draft::*` curve / text / hatch / image / layer / linetype / textstyle / block also emits the matching `ifcx::*` mirror attribute (§2.7). |
| `--strip-o2d-dxf`           | off     | Suppresses every `o2d::dxf::*` sidecar attribute. Result is a smaller, pure-IFCX document — but DXF roundtrip is no longer lossless. |
| `--inline-schemas`          | off     | Expands the three `o2d::*` schema definitions into the document's `schemas` map. Useful for self-describing exports.   |
| `--include-tess-cache`      | on      | (Binary mode only.) Emits the renderer's pre-built tessellation in the binary envelope's `o2d::tess` chunk (§4).      |

The reader's preferences are inverted:

- When both `o2d::draft::Line` and `ifcx::geom::line` are present on the
  same node, the **`o2d::draft::*` is authoritative** (IFCDraw is the
  upstream writer). The `ifcx::*` mirror is treated as informational.
- When only `ifcx::geom::line` is present (file written by Blender,
  Bonsai, etc.), the reader synthesises an `o2d::draft::Line` payload
  on the fly and records `o2d::ifcdraw::origin: "ifc"`.
- This is the "merge, prefer o2d::draft::*" rule. It guarantees a
  reader sees a complete drawing whether the file was written by us,
  by Bonsai, or by hand.

---

## §4 Wire format — defer to sister spec

The binary envelope is fully specified in
`2026-05-22-ifcdraw-v3-wire-format.md`. Only the points that depend on
this spec's §1–§3 are restated here:

- **Magic**: `IFCDRAW\x03` (8 ASCII bytes), wire version `0x03`. The
  byte after the magic identifies envelope-level changes; the schema
  inside is identified by `header.ifcxVersion` (always `"2.0"` for v3).
- **Body**: CBOR (RFC 8949) encoding of the IFCX v2 document object
  (`{header, imports, schemas, data, media}`) plus optionally a
  top-level `o2d::tess` key that holds renderer-cache binary chunks
  (segments, triangles, bbox, thumbnail). The `o2d::tess` key is OUTSIDE
  the IFCX document spec — a pure IFCX reader (CBOR-aware) loads the
  rest and ignores `o2d::tess` because it's a non-`o2d::draft::*`
  /`ifcx::*` top-level key (the reader code checks for the magic
  membership in {"header","imports","schemas","data","media"}).
- **Compression**: zstd level 19, optional pre-trained dictionary (the
  dict-id mechanism in the wire-format spec). Dict is trained on the
  namespace strings (`o2d::draft::`, `ifcx::geom::`, etc.) which repeat
  thousands of times per document.
- **Text-mode**: `.ifcdraw.json` — UTF-8 plain JSON, no header, no
  compression. Used for git diff, code review, BCF. Does not include
  the tess cache. The IFCDraw-format-identification entry (§1.3)
  reaches the reader through `data[]` exactly like every other node.

The wire-format spec covers: header layout, dict-id chunk format,
flag bitfield, CRC trailer, reader dispatch on first 8 bytes, tess
cache CBOR shape, sizes table, test-plan. None of those decisions
change as a result of switching from "IFC4X3-aliased" to "strict
o2d::draft::*" naming — the envelope is namespace-agnostic.

---

## §5 Roundtrip invariants

### 5.1 DWG → IFCDraw → DWG (lossless)

The fields whose preservation makes this lossless:

| Concern                                  | Held in                                          | Lossless?                          |
|------------------------------------------|--------------------------------------------------|------------------------------------|
| Entity geometry                          | `o2d::draft::<Type>` primary attribute           | yes (f64 preserves DWG's float64)  |
| Entity handle                            | `o2d::dxf::sourceHandle`                         | yes                                |
| Entity owner / xref / reactor            | `o2d::dxf::sourceOwner`, `o2d::dxf::reactors`, `o2d::dxf::extensionDictHandle` | yes |
| ACI color                                | `o2d::dxf::aciColor`                             | yes (0..256)                       |
| True-color override                      | `o2d::dxf::trueColor`                            | yes                                |
| Line weight                              | `o2d::dxf::lineWeight`                           | yes (DXF integer convention)       |
| Transparency                             | `o2d::dxf::transparency`                         | yes                                |
| Linetype name + scale                    | `o2d::dxf::sourceLineTypeName` + `o2d::draft::lineType{ref}` + `linetypeScale` on entity | yes |
| Text style name                          | `o2d::dxf::sourceTextStyleName` + `o2d::draft::style{ref}` | yes                        |
| Layer name (case)                        | `o2d::dxf::sourceLayerName`                      | yes                                |
| MTEXT formatting codes                   | `o2d::draft::MText.literal` (verbatim)            | yes                                |
| Hatch boundary edge math                 | `o2d::draft::Hatch*.boundaries[].edges[]`         | yes (bulges + edge types verbatim) |
| Hatch associativity + sourceRefs         | `o2d::dxf::associative` + `boundaries[].sourceRefs` | yes                              |
| INSERT scale/rotation/MINSERT array      | `o2d::draft::Insert` columnCount/rowCount/etc.   | yes                                |
| INSERT ATTRIB chain                      | `children: {TAG: attrib-path}` + per-ATTRIB nodes | yes                               |
| Polyline bulges / widths                 | `o2d::draft::Polyline.vertices[].bulge/startWidth/endWidth` | yes                     |
| SPLINE knots / weights / fit pts         | `o2d::draft::Spline.knots/weights/fitPoints`     | yes                                |
| DIMENSION computed text override         | `o2d::draft::Dimension*.overrideText`            | yes                                |
| Xdata (1001 groups)                      | `o2d::dxf::xdata`                                | yes (per-appId)                    |
| PROXY entities + class number            | `o2d::draft::ProxyEntity` + `o2d::dxf::dwgClass` | yes (data is opaque-base64)        |
| DWG-class numbers ≥ 500                  | `o2d::dxf::dwgClass: {classNum, appName, …}`     | yes                                |
| DXF $-variables (header section)         | `o2d::dxf::headerVars` on the root marker        | yes                                |
| Block-record handles                     | `o2d::dxf::sourceOwner` on each block-internal entity | yes                           |
| LAYOUT geometry / plotsettings           | `o2d::draft::Layout` + `o2d::draft::PlotSettings` | yes                               |
| Object-map ordinal (for stable rewrite)  | `o2d::dxf::dwgObjectMapOrder` (opt-in)           | yes only with `--preserve-order`   |
| DWG byte-perfect rewrite of unknown obj  | `o2d::dxf::dwgChunkRaw` (opt-in)                 | yes only with `--preserve-raw`     |

The default writer omits `dwgChunkRaw` and `dwgObjectMapOrder` because
they explode file size with little payoff for the common workflow.
Under `--preserve-order --preserve-raw --byte-perfect-dwg`, the
roundtrip is bit-identical to the source DWG (modulo Autodesk's
checksum recomputation, which our writer does correctly).

### 5.2 DXF → IFCDraw → DXF (lossless under same provenance flags)

Same fields as 5.1, minus `dwgChunkRaw` / `dwgClass` / `dwgObjectMapOrder`
which are DWG-specific. The headerVars / xdata / handle / extensionDict
preservation makes DXF roundtrip semantically lossless (every group
code, every value, every order-sensitive structure). The DXF writer is
the simpler of the two because DXF's text format has fewer hidden
ordering constraints than DWG's binary stream.

### 5.3 IFCDraw → "pure IFCX" (strip o2d::*) — what's lossy

With `--strip-o2d-dxf` and `--cross-write-ifcx-geom`, the writer emits
ONLY `ifcx::*`, `bsi::ifc::*`, `usd::*`, and structural keys (path,
children, inherits) — no `o2d::*` attributes anywhere.

What survives:

| Concern                                  | Survives in pure-IFCX form?                                                  |
|------------------------------------------|------------------------------------------------------------------------------|
| Curve geometry                           | yes — `ifcx::geom::line`, `polyline`, `compositeCurve`, `circle`, `trimmedCurve`, `ellipse`, `bspline` |
| Text content + style ref                 | yes — `ifcx::annotation::text`, `ifcx::annotation::richText`, `ifcx::connects::style: {ref}` |
| Dimensions                               | yes — `ifcx::annotation::dimension` with `subtype` discriminator             |
| Hatches                                  | yes — `ifcx::hatch::pattern/solid/gradient` + `ifcx::hatch::boundary`        |
| Layers                                   | yes — `ifcx::layer::assignment` + `ifcx::layer::style`                       |
| Linetypes                                | yes — `ifcx::style::curveStyle` with `dashPattern`                           |
| Text styles                              | yes — `ifcx::style::textStyle`                                               |
| Dimension styles                         | yes — `ifcx::style::dimensionStyle` (IFCX-defined extensibly)                |
| Blocks + inserts                         | yes — `ifcx::component::definition` + `inherits + ifcx::xform::matrix`       |
| Raster images                            | yes — `ifcx::image::raster` + `media[]`                                       |
| Sheets / viewports / plot-settings       | yes — `ifcx::sheet::paper` / `ifcx::sheet::viewport` / `ifcx::sheet::plotSettings` |
| Project / drawings / definitions hierarchy | yes — IFCX structural pattern                                              |

What's lost (per §5.1 → only `o2d::dxf::*` provenance is dropped):

| Concern                                  | Lost?                                                                              |
|------------------------------------------|------------------------------------------------------------------------------------|
| Original DXF/DWG handle                  | YES — round-trip back to DXF/DWG cannot reproduce the original handle              |
| ACI color (specifically the index, not the RGB) | partially — RGB survives in `ifcx::style::colour`; ACI integer is gone     |
| Xdata (1001 groups)                      | YES — IFCX has no equivalent, gone                                                  |
| DXF header $-variables not modelled      | YES — `o2d::dxf::headerVars` is gone                                                |
| Extension dictionaries / reactors        | YES — IFCX has no equivalent                                                        |
| DXF integer line-weight convention       | partially — `ifcx::style::lineWeight` is in mm (number); we lose the integer code   |
| Block-record handles                     | YES                                                                                 |
| MTEXT raw formatting codes               | NO — `ifcx::annotation::richText` carries the structured spans; raw codes survive only when `ifcx::annotation::text.value` is set to the unparsed string (which our writer does by default) |
| Hatch associativity flag                 | partially — `boundaries[].sourceRefs` survives; the global `associative` flag is gone |
| DXF table records IFCX has no equivalent for (APPID, SORTENTSTABLE, FIELD, GEODATA, GROUP, VISUALSTYLE, SCALE, DICTIONARY, XRECORD, OLE2FRAME, UNDERLAY, PROXY) | YES — these nodes are gone from the document |

A user who writes `--strip-o2d-dxf`, hands the file to a partner who
edits and returns it, then runs `Save-As .dxf` in Open 2D Studio will
get a clean DXF that has the same geometry and styling but new handles,
no xdata, no header $-vars. Functionally equivalent; not bit-identical.
**The default writer never strips o2d::dxf.** Strip-mode is opt-in for
deliberate "publish to IFCX consumers" workflows.

### 5.4 IFCX-to-IFCX (Bonsai / Blender / FreeCAD round-trip)

A file written by Bonsai (`integrations/blender/ifcx_addon/`) using
only `ifcx::*` namespaces opens cleanly: the reader synthesises
`o2d::draft::*` on the fly, sets `o2d::ifcdraw::origin: "ifc"` per
node, and round-trips without loss. Re-saving from Open 2D Studio
re-emits both `o2d::draft::*` and `ifcx::*` (cross-write on) so
the file is now richer; Bonsai re-opening it still sees the
`ifcx::*` it understands and ignores the o2d::*.

### 5.5 GlobalId / handle stability

For DXF/DWG-sourced entities:

```
o2d::ifcdraw::guid = base64( UUID_v5(
  namespace = UUID v5 of o2d-format-ns,
  name      = source_path + ":" + source_hex_handle
))
```

The namespace UUID is open question (B) below: public well-known
(stable across users, easy to reproduce) vs. per-installation (privacy
boundary). Default until decided: a **fixed public namespace UUID**
baked into the writer (`8a4c5e2a-1f9b-4d72-9a13-ea2f6c0d8b9e`), so two
users importing the same DWG produce identical GUIDs — supports
collaborative workflows where reviewers reference the same entity by
GUID.

For new entities created inside Open 2D Studio, a fresh UUIDv4 is
generated and `o2d::ifcdraw::origin = "created"`.

For IFCX-sourced entities (Bonsai/Blender input), we copy the GUID
from `bsi::ifc::guid` if present, else synthesise from the IFCX `path`
(stable across re-saves).

---

## §6 Implementation plan

Six phases, ~4100 LOC. The entity-mapping table in §2 is broader than
the previous draft (covering all 30+ DWG object types vs. the 24 the
previous spec listed), but the per-entity code is small: each entity
gets a `to_o2d_draft()` and a `from_o2d_draft()` function in a single
match arm, plus the matching DXF/DWG read/write code that already
exists in `kernel/crates/app/src/scene_io.rs` and
`src-tauri/dwg-parser/parser.rs`.

| Phase | Crate / module                              | LOC est | Deliverable                                                                              |
|-------|---------------------------------------------|---------|------------------------------------------------------------------------------------------|
| 1     | `kernel/crates/ifcdraw/src/o2d_schema.rs`   |  ~700   | All `o2d::draft::*` / `o2d::dxf::*` / `o2d::ifcdraw::*` types as Rust structs + serde derives. Spans about 50 entity types from §2 + the sidecar attribute set. |
| 2     | `kernel/crates/ifcdraw/src/ifcx_envelope.rs`|  ~350   | IFCX v2 envelope (`{header, imports, schemas, data, media}`) + the format-marker entry (§1.3) + multi-entry composition merge for the reader. |
| 3     | `kernel/crates/ifcdraw/src/cbor_zstd.rs`    |  ~300   | Binary wire format (magic, header, dict, CBOR encode/decode, zstd, CRC). Per sister spec — already mostly designed. |
| 4     | `kernel/crates/ifcdraw/src/dxf_dwg_bridge.rs` | ~1300 | `dxf_to_ifcdraw()` and `ifcdraw_to_dxf()` traversing every entity in §2.1–§2.5. DWG variants delegate to `src-tauri/dwg-parser/parser.rs` for the raw object decode. |
| 5     | `kernel/crates/ifcdraw/src/ifcx_mirror.rs`  |  ~400   | Cross-write the `ifcx::geom::*` / `ifcx::annotation::*` / `ifcx::hatch::*` / `ifcx::style::*` / `ifcx::layer::*` / `ifcx::sheet::*` mirrors per §2.7. Pure data shuffle, no business logic. |
| 6     | `kernel/crates/ifcdraw/tests/`              |  ~750   | Round-trip corpus: `tests/dxf_roundtrip.rs` (every `samples/*.dxf` → ifcdraw → dxf, semantic eq), `tests/dwg_roundtrip.rs`, `tests/ifcxb_compat.rs` (load `Ifc-Factory/examples/*.ifcx`), `tests/strict_namespace_audit.rs` (assert no `IfcLine`/`IfcPolyline`/`IfcCircle`/`IfcTrimmedCurve`/`IfcBSplineCurveWithKnots`/`IfcAnnotationFillArea`/`IfcRepresentationMap`/`IfcMappedItem`/etc. string appears anywhere in produced output — the "no IFC4X3 leak" CI gate). |
| 6a    | `kernel/crates/ifcdraw/schemas/`            |  ~300   | The three JSON-Schema files: `draft@v1.json`, `dxf@v1.json`, `ifcdraw@v1.json`. Validated by `tests/schema_compliance.rs`. |
| **Total** |                                         | **~4100** |                                                                                  |

Compared to the previous v3 plan's ~3700 LOC: +400 LOC, almost entirely
from (a) the strict-namespace audit test (no IFC4X3 strings allowed),
(b) the broader entity coverage in §2.5 (every DXF table record gets a
mapping, not just the eight common ones), and (c) the three local
JSON-Schema files we now ship for the `o2d::*` namespaces.

Phasing for the implementation round:

1. **Round 1** — phases 1 + 2 + 6a (schema + envelope + JSON schemas).
   Output: a writer that round-trips an empty `Scene` to a valid IFCX
   v2 document with the format marker.
2. **Round 2** — phase 4 + 4a (DXF only). Output: every DXF entity in
   the test corpus round-trips lossless under default flags. CI gate
   on strict-namespace audit.
3. **Round 3** — phase 4b (DWG-specific objects). Output: every DWG
   entity round-trips lossless; `--preserve-raw` opt-in for unknown
   class numbers ≥ 500.
4. **Round 4** — phase 3 (binary envelope). Output: `.ifcdraw` binary
   files. Wire-format spec drives this round.
5. **Round 5** — phase 5 (IFCX mirror). Output: files written by us
   are readable by Blender's `ifcx_addon` and FreeCAD's `ifcx_core.py`
   without code changes on their side.
6. **Round 6** — performance + tess-cache integration. Output: viewer
   loads `.ifcdraw` at v2's speed.

---

## §7 Open questions

These are surfaced verbatim for the user to answer before the
implementation round:

**(A) f64 coords (no q16 quantisation) acceptable? Bit-identical but
1.5-2× larger than v2.**

Context: v2's binary format stored every coordinate as a `i16` in a
per-scene quantised range (q16), trading ~2× compression for a tiny
loss in precision (≈1 µm at typical building-drawing scales). v3 in
this spec keeps `f64` everywhere because (a) the canonical IFCX format
is `f64`, (b) bit-identical roundtrip matters for the
"DWG→IFCDraw→DWG" promise in §5, (c) zstd recovers some of the size
penalty (delta-encoded `f64` arrays compress to ~3 bytes per coord
after zstd-19 with the dict). The exact size cost vs. q16 needs a
corpus benchmark but is estimated at 1.5-2× larger raw and ~1.3× after
zstd-dict. Accept f64? Or add an opt-in `o2d::ifcdraw::quantised`
chunk in the binary envelope (text mode stays f64)?

**(B) Embed source DWG/DXF in `o2d::dxf::source-blob` for 100%
roundtrip safety, or assume user keeps original?**

Context: §5.1 lists three opt-in flags that get us byte-identical DWG
roundtrip — `--preserve-order`, `--preserve-raw`, `--byte-perfect-dwg`
— without embedding the source file. The alternative is a single new
attribute `o2d::dxf::sourceBlob: {filename, sha256, bytes (CBOR
binary)}` on the root marker node that holds the entire original DWG
or DXF. Pros: trivial 100% roundtrip via "if `sourceBlob` exists and
no entity has changed, re-emit it verbatim"; supports forensic /
audit workflows. Cons: file size goes up by the source file's size
(typical ~500 KB-5 MB), and the writer has to invalidate the blob on
any edit (or carry stale data). Opt-in flag or never-embed-default?

---

## §8 Additional considerations surfaced during the read-pass

These weren't asked but came out of reading the source materials.
Documented here so the implementation round picks them up.

1. **`ifcx::purpose` defaults** — `header.defaults.ifcx::purpose:
   "drawing"` shaves ~30% of attribute writes per `text-v2.ifcx` audit
   (`ifcx-structuur-analyse.md` §3.2). We adopt this default, so
   `o2d::draft::*` entity nodes do not need to repeat `ifcx::purpose`.
   Only sheet (`"sheet"`), annotation (`"annotation"`), definition
   (`"definition"`), and model (`"model"`) nodes explicitly set it.
2. **Multi-entry composition for layers + reuse** — `text-v2.ifcx`
   reuses `layer-cb99a9eca43c` 229 times via `{"ref": "layer-..."}`.
   Our writer does the same: layers / linetypes / text-styles / dim-
   styles / patterns are written ONCE under `/styles/` and referenced
   by `{ref}` from every consuming entity. No inline duplication.
3. **DimStyle inheritance** — `text-v2.ifcx` repeats ~90% of dimstyle
   data across 10 variants (`ifcx-structuur-analyse.md` §3.3). Our
   writer is allowed to use `inherits: {base: "dimstyle-base"}` to
   collapse the duplication, but the default writer does NOT, for
   diff simplicity (a single dimstyle change touches one node, not a
   merged parent + diff). User-facing flag `--collapse-dimstyles` if
   we ever want it.
4. **Inline curveStyle vs. referenced curveStyle** — `text-v2.ifcx`
   has 13 inline `ifcx::style::curveStyle` on entity nodes, which the
   analysis flags as inconsistent with the layer/style ref pattern.
   IFCDraw v3 NEVER inlines a curveStyle on an entity: any per-entity
   override goes to `o2d::draft::color`, `o2d::draft::lineType: {ref}`,
   `o2d::draft::lineWeight`, etc. — these are all primitive overrides,
   not a re-statement of a whole style.
5. **`ifcx::unknown::entity` fallback** — `text-v2.ifcx` uses
   `ifcx::unknown::entity` for ATTDEF (8 occurrences) because Bonsai
   doesn't yet have an ATTDEF schema. IFCDraw v3 always uses
   `o2d::draft::AttributeDef` (we OWN the o2d:: namespace; we don't
   need a fallback). The reader recognises `ifcx::unknown::entity`
   from external IFCX files and lifts it into `o2d::draft::*` where
   possible, falling back to `o2d::draft::UnknownEntity` (which mirrors
   `ifcx::unknown::entity`'s shape) when the type isn't recognised.
6. **The cross-write penalty is real but small** — emitting BOTH
   `o2d::draft::Line` and `ifcx::geom::line` for the same line costs
   ~30 uncompressed bytes per entity. zstd-dict eliminates ~90% of
   that because both namespace prefixes are in the dict. Net cost
   estimated at ~3% file-size penalty for huge interop wins.
7. **Schema declaration in `imports[]`** — we declare three `o2d::*`
   URIs even though the schema files won't be hosted at those URIs on
   day one. The `imports[]` list doubles as a content manifest and the
   reader treats unresolved imports as advisory
   (`ifcx-structuur-analyse.md` §4.4). When we publish the schemas to
   `https://open-2d-studio.dev/schemas/` later, no document needs
   changing — the imports were already correct.
8. **No "Ifc*" type names in any output** — the test in phase 6 of the
   implementation plan (`tests/strict_namespace_audit.rs`) asserts the
   forbidden string set: `IfcLine`, `IfcPolyline`, `IfcCircle`,
   `IfcTrimmedCurve`, `IfcBSplineCurveWithKnots`, `IfcEllipse`,
   `IfcIndexedPolyCurve`, `IfcAnnotationFillArea`,
   `IfcPresentationLayerWithStyle`, `IfcRepresentationMap`,
   `IfcMappedItem`, `IfcCartesianTransformationOperator2D`,
   `IfcTextLiteralWithExtent`, `IfcGeometricRepresentationSubContext`,
   `IfcImageTexture`, `IfcStyledItem`, `IfcCurveStyleFontPattern`,
   `IfcTextStyle`, `IfcAdvancedBrep`, `IfcTriangulatedFaceSet`,
   `IfcGeometricCurveSet`, `IfcAnnotation`, `IfcWall`, `IfcWallType`.
   The audit is regex `(?i)\bIfc[A-Z][A-Za-z0-9_]*\b` and the only
   permitted matches are inside `bsi::ifc::class.code` values (which
   are user data, not our document vocabulary). Any other match fails
   CI.

---

## §9 Examples — three nodes in full

### 9.1 A LINE entity, fully attributed

```json
{
  "path": "e-2ba7a3f5bb11",
  "attributes": {
    "o2d::draft::Line": {
      "p1": [100.0, 100.0],
      "p2": [500.0, 100.0]
    },
    "o2d::draft::layer":     { "ref": "layer-Walls" },
    "o2d::draft::color":     "byLayer",
    "o2d::draft::lineType":  "byLayer",
    "o2d::draft::lineWeight":"byLayer",

    "o2d::dxf::sourceHandle":     "5A3F",
    "o2d::dxf::sourceLayerName":  "Walls",
    "o2d::dxf::aciColor":         256,

    "o2d::ifcdraw::guid":   "1jR4D5o9z3qhCl_jH_Ev2g",
    "o2d::ifcdraw::origin": "dwg",

    "ifcx::geom::line": {
      "points": [[100.0, 100.0, 0.0], [500.0, 100.0, 0.0]]
    },
    "ifcx::connects::layer": { "ref": "layer-Walls" }
  }
}
```

### 9.2 A HATCH (pattern) referencing two LWPOLYLINE boundaries

```json
{
  "path": "e-hatch-9b2c",
  "attributes": {
    "o2d::draft::HatchPattern": {
      "patternName":       "ANSI31",
      "patternType":       "predefined",
      "patternAngle":      0.7854,
      "patternScale":      2.0,
      "patternDouble":     false,
      "boundaries": [
        { "type": "polyline",
          "polyline": {
            "vertices":[{"x":350,"y":150},{"x":480,"y":150},{"x":480,"y":380},{"x":350,"y":380}],
            "closed": true
          }
        }
      ]
    },
    "o2d::draft::layer": { "ref": "layer-Hatch" },
    "o2d::draft::color": "0x808080",

    "o2d::dxf::sourceHandle":  "F",
    "o2d::dxf::associative":   false,

    "o2d::ifcdraw::guid":   "8b4F2g3l7DqUuP_oXJN1zw",
    "o2d::ifcdraw::origin": "dxf",

    "ifcx::hatch::pattern": {
      "name":  "ANSI31",
      "angle": 0.7854,
      "scale": 2.0
    },
    "ifcx::hatch::boundary": {
      "outer": "e-hatch-9b2c-outer",
      "inner": []
    },
    "ifcx::connects::layer": { "ref": "layer-Hatch" }
  }
}
```

(The `ifcx::hatch::boundary.outer` ref points to a separate node that
carries the polyline geometry, per `Ifc-Factory/schema/attributes.md`
"Hatching" section. The writer emits that boundary node side-by-side
with the hatch node.)

### 9.3 A BLOCK definition with two children, instantiated twice

```json
[
  {
    "path": "block-DOOR",
    "children": {
      "outline": "e-blk-door-outline",
      "swing":   "e-blk-door-swing"
    },
    "attributes": {
      "ifcx::purpose": "definition",
      "o2d::draft::BlockDef": {
        "name":        "DOOR",
        "basePoint":   [0, 0, 0],
        "description": "Standard 800 mm door",
        "isAnonymous": false, "isXRef": false,
        "hasAttributes": false
      },
      "ifcx::component::definition": {
        "name":      "DOOR",
        "basePoint": [0, 0, 0]
      }
    }
  },
  {
    "path": "e-insert-99",
    "inherits": { "blockDef": "block-DOOR" },
    "attributes": {
      "o2d::draft::Insert": {
        "block":    { "ref": "block-DOOR" },
        "anchor":   [4200.0, 1500.0],
        "scale":    [1, 1, 1],
        "rotation": 1.5707963
      },
      "o2d::draft::layer":  { "ref": "layer-0" },
      "o2d::dxf::sourceHandle":  "1A2",
      "o2d::ifcdraw::guid":      "7Qa4Bd5l9JpHzL_xF_Mn3w",
      "o2d::ifcdraw::origin":    "dwg",
      "ifcx::xform::matrix": [
        [ 0.0,  1.0, 0.0, 0.0],
        [-1.0,  0.0, 0.0, 0.0],
        [ 0.0,  0.0, 1.0, 0.0],
        [4200, 1500, 0.0, 1.0]
      ]
    }
  }
]
```

This shows the three-way redundancy: `o2d::draft::Insert.block.ref` +
`inherits.blockDef` + `ifcx::xform::matrix`. All three carry the same
information; the writer emits all three for interop, and the reader
prefers `o2d::draft::Insert` when present.

---

**Sister spec (binary envelope):**
`2026-05-22-ifcdraw-v3-wire-format.md`

**Schema files (to be created in implementation Round 1):**
`kernel/crates/ifcdraw/schemas/draft@v1.json`
`kernel/crates/ifcdraw/schemas/dxf@v1.json`
`kernel/crates/ifcdraw/schemas/ifcdraw@v1.json`

**Reference vendor schema:**
`github.com/OpenAEC-Foundation/Ifc-Factory@<pinned-SHA>/schema/ifcx-v2.schema.json`
