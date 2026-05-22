# IFCDraw v3 — IFC-X JSON Entity Mapping

Status: **Design — pending approval, implementation deferred**
Companion: `2026-05-22-ifcdraw-v3-wire-format.md` (binary envelope)
Supersedes (eventually): `2026-05-21-ifcdraw-binary-format.md` (IFCDraw v2)

## 0. Why v3

IFCDraw v2 (the `0.4-2d-binary-ifcdraw` MessagePack envelope) was always a
storage-optimised cache of an already-tessellated `Scene`: q16 segments,
q16 triangles, sparse text records, an INSERT side-table and a block
forest. It is fast and small, but it is **not** an IFC-X document in any
meaningful sense — every consumer outside Open 2D Studio has to write a
bespoke decoder, and the document carries no IFC semantics.

The IFC-Factory project (`github.com/OpenAEC-Foundation/Ifc-Factory`)
already defines a proper, IFC5-compatible JSON layout for 2D drawing
data: the **IFC-X v2 schema** (`schema/ifcx-v2.schema.json`). It is
node-based, namespaced (`ifcx::geom::*`, `ifcx::annotation::*`,
`bsi::ifc::*`, `usd::*`), and round-trippable to/from a binary form
(IFCXB = CBOR + Zstandard).

**IFCDraw v3 = IFC-X v2 with an Open 2D Studio binary envelope on top.**

The logical document is identical to what Ifc-Factory's TS/Rust/Py/C++
libraries already read and write. We are not inventing a parallel
ecosystem — we are adopting theirs, contributing back where our 2D-CAD
needs expose gaps, and adding a binary container that is opinionated
about file-level concerns (magic bytes, version byte, optional zstd
dictionary, magic-driven dispatch in the reader).

This document specifies **only** the JSON layer. The wire envelope is
in the sibling spec.

## 1. Top-level document

A v3 IFCDraw document is a JSON object that conforms to
`schema/ifcx-v2.schema.json` from IFC-Factory:

```json
{
  "header": { ... },           // IfcxHeader
  "imports": [ ... ],          // schema imports (IFC5 + IFC-X extensions)
  "schemas": { ... },          // optional inline schema fragments
  "data": [ ... ],             // flat array of IfcxNode entries
  "media": { ... }             // base64 / by-reference raster blobs
}
```

`data` is a **flat array of nodes**, not a tree. Each node has a `path`
(unique within the document), optional `children` (`name -> path`),
optional `inherits` (`role -> path`) and an `attributes` map keyed by
`publisher::domain::name`. Multi-entry composition is allowed: two
entries with the same `path` are merged by the reader. Open 2D Studio's
writer produces single-entry-per-path output for diff-friendliness; the
reader accepts either form.

### 1.1 Header

```json
{
  "ifcxVersion": "2.0",
  "id": "<UUID v4>",
  "dataVersion": "0.1.0",
  "author": "<from session, optional>",
  "organization": "<from settings, optional>",
  "application": "Open 2D Studio v0.1.0",
  "timestamp": "2026-05-22T10:13:00Z",
  "units": {
    "length": "mm",
    "angle": "rad",
    "area":   "m2"
  },
  "coordinateSystem": {
    "epsg": 28992,            // optional, only if we know the CRS
    "wkt":  "<WKT-2 string>"  // optional
  },
  "defaults": {
    "ifcx::purpose": "drawing"
  }
}
```

Key choices:

- **`ifcxVersion: "2.0"`** — we conform to IFC-Factory's v2 schema. This
  is the schema version, **not** the wire envelope version (wire = byte
  `0x03` in the magic).
- **`application: "Open 2D Studio v<semver>"`** — single forensic
  string. No "IFCDraw writer" branding inside the document; the
  envelope already carries the IFCDraw magic.
- **`defaults.ifcx::purpose = "drawing"`** — all unannotated nodes are
  drawing geometry. Nodes that need a different purpose set it
  explicitly. This shaves ~25 bytes per entity from the uncompressed
  JSON.
- **`units.length = "mm"`** — mandatory; everything in the document is
  in millimetres regardless of the source unit. The original unit string
  goes to `bsi::ifc::header::lengthUnit` as a non-load-bearing
  annotation.

### 1.2 Imports

```json
"imports": [
  { "uri": "https://ifcx.dev/@standards.buildingsmart.org/ifc/core/ifc@v5a.ifcx" },
  { "uri": "https://ifcx.dev/@standards.buildingsmart.org/ifc/core/prop@v5a.ifcx" },
  { "uri": "https://ifcx.dev/@openusd.org/usd@v1.ifcx" },
  { "uri": "https://ifcx.openaec.org/schemas/geom@v1.ifcx" },
  { "uri": "https://ifcx.openaec.org/schemas/annotation@v1.ifcx" },
  { "uri": "https://ifcx.openaec.org/schemas/sheet@v1.ifcx" },
  { "uri": "https://ifcx.openaec.org/schemas/hatch@v1.ifcx" },
  { "uri": "https://ifcx.openaec.org/schemas/style@v1.ifcx" },
  { "uri": "https://ifcx.openaec.org/schemas/layer@v1.ifcx" },
  { "uri": "https://ifcx.openaec.org/schemas/component@v1.ifcx" }
]
```

The first three URIs are standard IFC5 (buildingSMART + USD). The
remaining seven are the IFC-X extensions IFC-Factory publishes. Any IFC5
viewer that lazily imports these schemas will render the standard parts
and silently ignore the `ifcx::*` parts — by design.

An IFCDraw writer **MUST** emit all imports actually referenced by the
nodes it writes, and **SHOULD NOT** emit imports it does not use, so the
header doubles as a content manifest. The reader **MUST** treat unknown
imports as advisory (don't fail just because we haven't shipped the
schema).

## 2. Project hierarchy

Every IFCDraw v3 document has the following root nodes. The hierarchy
mirrors IFC-Factory's `drawing-vs-model.md` recommendation:

```
project                            ifcx::purpose=drawing
├── drawings/                      ifcx::purpose=drawing
│   ├── view-model                 default Modelspace view
│   └── view-sheet-{i}             one per paperspace LAYOUT
├── definitions/                   ifcx::purpose=definition
│   ├── block-{name}               one IfcRepresentationMap per BLOCK
│   └── textstyle-{name}           IfcTextStyle
├── styles/                        ifcx::purpose=drawing
│   ├── layer-{name}               IfcPresentationLayerAssignment
│   ├── linetype-{name}            IfcCurveStyleFontPattern
│   └── dimstyle-{name}            IfcDimensionalExponents-style bag
├── sheets/                        ifcx::purpose=sheet (only if LAYOUTs)
│   └── sheet-{name}               ifcx::sheet::paper + viewports
└── annotations/                   ifcx::purpose=annotation
    └── dim-{uuid}                 IfcAnnotation with associatedGeometry
```

The literal node entries are:

```json
{ "path": "project",
  "children": {
    "drawings":    "drawings",
    "definitions": "definitions",
    "styles":      "styles",
    "sheets":      "sheets",
    "annotations": "annotations"
  },
  "attributes": {
    "ifcx::purpose": "drawing",
    "bsi::ifc::class": { "code": "IfcProject" },
    "bsi::ifc::name":  "Open 2D Studio drawing",
    "bsi::ifc::guid":  "<22-char IFC GlobalId>"
  }
}
```

`sheets` and `annotations` containers are **omitted entirely** if empty —
no point shipping empty groupings. The reader treats missing containers
the same as empty children.

### 2.1 IFC spatial structure — optional

If the source file (typically a DWG layout import that had ACAD_LAYOUT
data referring to a Bonsai/Revit project) carries `IfcSite` /
`IfcBuilding` / `IfcBuildingStorey` semantics, we add them as `model`
nodes under `project.children.spatial`:

```
project
├── spatial/                       ifcx::purpose=model (only if known)
│   └── site-{guid}
│       └── building-{guid}
│           └── storey-{guid}
│               └── (drawing views reference this storey by ref)
```

A drawing view that belongs to a particular storey carries
`ifcx::connects::storey: { "ref": "storey-{guid}" }`. The default writer
(DWG/DXF import without IFC metadata) does **not** emit `spatial/` — the
drawing is a pure 2D document, full stop.

## 3. Entity mapping

The following tables list every CAD entity Open 2D Studio handles today,
the IFC-X node shape it serialises to, and the IFC schema entity each
attribute aliases. The IFC class names are **reference-only**: they
describe the semantic shape; the actual on-disk attribute keys are the
`ifcx::*` namespaces.

### 3.1 LINE → `IfcPolyline` (2 points)

```json
{
  "path": "e-000123",
  "attributes": {
    "ifcx::geom::line": { "points": [[0,0,0],[5000,0,0]] },
    "ifcx::connects::layer": { "ref": "layer-Walls" },
    "ifcx::style::curveStyle": {
      "colour": { "r": 0, "g": 0, "b": 0 },
      "width":  0.35
    }
  }
}
```

IFC alias: `IfcPolyline(Points: List<IfcCartesianPoint>)` length=2,
wrapped in `IfcGeometricCurveSet`, owned by an `IfcAnnotation` of
PredefinedType `USERDEFINED` + ObjectType="draftingLine". We do not
spell out the wrapping in the JSON because every drawing-purpose node
implies the same wrapping — the reader can reconstruct it on demand.

### 3.2 POLYLINE / LWPOLYLINE — two encodings

Without bulges, use `IfcPolyline`-style:

```json
"ifcx::geom::polyline": {
  "points": [[x1,y1,0], ...],
  "closed": true
}
```

With bulges, use `IfcCompositeCurve`-style:

```json
"ifcx::geom::compositeCurve": {
  "closed": false,
  "segments": [
    { "type": "line", "points": [[x1,y1,0],[x2,y2,0]] },
    { "type": "arc",  "center": [cx,cy,0], "radius": r,
      "startAngle": a0, "endAngle": a1 }
  ]
}
```

IFC alias: `IfcPolyline` or `IfcCompositeCurve` over
`IfcTrimmedCurve(IfcCircle, …)`. The bulge → arc conversion uses the
same chord/sagitta math that v2 already implements (see
`v2_converter.rs::lwpoly_to_segments`).

### 3.3 CIRCLE → `IfcCircle`

```json
"ifcx::geom::circle": {
  "center": [cx, cy, 0],
  "radius": r
}
```

IFC alias: `IfcCircle(Position: IfcAxis2Placement2D, Radius: r)`. The
`Position` defaults to `[0,0]`-origin / X-axis — we only emit a
non-default placement when rotation is needed (i.e. never, for a
circle).

### 3.4 ARC → `IfcTrimmedCurve` over `IfcCircle`

```json
"ifcx::geom::trimmedCurve": {
  "center":     [cx, cy, 0],
  "radius":     r,
  "startAngle": a0,
  "endAngle":   a1,
  "senseAgreement": true
}
```

IFC alias: `IfcTrimmedCurve(BasisCurve: IfcCircle, Trim1: a0, Trim2: a1,
SenseAgreement: true, MasterRepresentation: PARAMETER)`. Angles are in
radians (per the header `units.angle = "rad"`).

### 3.5 ELLIPSE → `IfcEllipse`

```json
"ifcx::geom::ellipse": {
  "center":    [cx, cy, 0],
  "semiAxis1": majorAxisLen,
  "semiAxis2": minorAxisLen,
  "rotation":  rotZ
}
```

Partial ellipse: wrap in `ifcx::geom::trimmedCurve` with
`basisCurve` referencing the ellipse's path, `startParam`/`endParam`. To
keep flat structure the partial-ellipse case writes both attributes on
the same node — the reader composes them.

### 3.6 SPLINE → `IfcBSplineCurveWithKnots`

```json
"ifcx::geom::bspline": {
  "degree":            3,
  "controlPoints":     [[x,y,z], ...],
  "knots":             [...],
  "knotMultiplicities":[...],
  "weights":           [...],
  "closed":            false
}
```

Direct IFC alias. NURBS / non-uniform weights are preserved; closed flag
toggles `IfcBSplineCurveForm.CLOSED_CURVE`.

### 3.7 POINT / RAY / XLINE

```json
"ifcx::geom::point":            { "position": [x,y,z] }
"ifcx::geom::ray":              { "origin": [x,y,z], "direction": [dx,dy,dz] }
"ifcx::geom::constructionLine": { "origin": [x,y,z], "direction": [dx,dy,dz] }
```

IFC alias: `IfcCartesianPoint`, `IfcLine` (semi-infinite by convention),
`IfcLine` again with `bsi::ifc::flag::infinite = true`.

### 3.8 TEXT / MTEXT → `IfcTextLiteralWithExtent`

```json
"ifcx::annotation::text": {
  "value":     "ROOM 101\nA: 12 m²",
  "placement": [200, 300, 0],
  "height":    2.5,
  "width":     100,
  "attachment":"top_left",
  "alignment": "center",
  "style":     { "rotation": 0.7854 }
}
```

For rich-text MTEXT codes (`\P`, `\C1`, `\fSimplex.shx`) we additionally
emit `ifcx::annotation::richText` with a `spans` array, while keeping
the raw text in `value` for lossless round-trip — exactly the
double-emit pattern that IFC-Factory's `text-v2.ifcx` example uses:

```json
"ifcx::annotation::richText": {
  "spans": [
    { "text": "ROOM 101", "bold": true, "size": 3.0 },
    { "text": "A: 12 m²", "font": "Simplex.shx" }
  ]
}
```

IFC alias: `IfcTextLiteralWithExtent(Literal, Placement, Path, Extent,
BoxAlignment)`. The connection to a text style is via
`ifcx::connects::style: { "ref": "textstyle-Standard" }`.

### 3.9 HATCH → `IfcAnnotationFillArea` + `IfcCompositeCurve`

Two flavours.

Solid fill:

```json
"ifcx::hatch::solid":   { "colour": { "r":0.5,"g":0.5,"b":0.5,"a":1 } },
"ifcx::hatch::boundary":{
  "outer": "ec-outer-uuid",
  "inner": ["ec-hole1-uuid", "ec-hole2-uuid"]
}
```

Pattern fill:

```json
"ifcx::hatch::pattern": {
  "name":  "ANSI31",
  "angle": 0.7854,
  "scale": 2.0,
  "lines": [ { "angle":..., "origin":..., "delta":..., "dash":[...] } ]
}
```

IFC alias: `IfcAnnotationFillArea(OuterBoundary, InnerBoundaries)`
inside an `IfcStyledItem` carrying
`IfcFillAreaStyleHatching(HatchLineAppearance, StartOfNextHatchLine,
PointOfReferenceHatchLine, …)`. Boundaries are separate composite-curve
nodes referenced by path — this is **necessary** for the multi-entry
composition pattern Bonsai uses to attach a hatch to a model wall while
keeping the boundary editable.

Material-coded fill (Dutch NEN 3610 / German DIN 1356 patterns):

```json
"ifcx::hatch::material": { "standard": "NEN47", "code": "beton",
                            "scale": 50 }
```

### 3.10 DIMENSION → `IfcAnnotation` + `ifcx::annotation::dimension`

IFC4 dropped `IfcDimensionCurve`. IFC-Factory's solution is an
`IfcAnnotation` node with a structured `ifcx::annotation::dimension`
attribute:

```json
{
  "path": "dim-12ab",
  "attributes": {
    "ifcx::purpose": "annotation",
    "ifcx::annotation::dimension": {
      "subtype":         "linear",   // linear|aligned|angular|radius|diameter|ordinate|arc
      "measurePoints":   [[100,100,0],[500,100,0]],
      "dimensionLine":   [300, 70, 0],
      "value":           400.0,
      "text":            "400",
      "textPosition":    [300, 60, 0],
      "style": {
        "arrowType":       "tick",
        "arrowSize":       2.5,
        "textHeight":      2.5,
        "extensionOffset": 1.5,
        "extensionExtend": 1.25,
        "precision":       0,
        "prefix":          "",
        "suffix":          "",
        "tolerance":       { "upper": 0.5, "lower": -0.5 }
      },
      "associatedGeometry": [
        { "ref": "e-000123" },
        { "ref": "wall-guid-abc" }
      ]
    },
    "ifcx::connects::style": { "ref": "dimstyle-Standard" }
  }
}
```

The `associatedGeometry` references **establish the link between drawing
annotation and model object** — a Bonsai-style associative dimension.
When the linked geometry changes, the dimension auto-recomputes. For
non-associative dimensions (import from DWG without context) the array
is empty or omitted; the literal `value` and `text` carry the
already-baked numbers.

### 3.11 LEADER / MULTILEADER → `ifcx::annotation::leader`

```json
"ifcx::annotation::leader": {
  "path":        [[300,250,0],[350,320,0],[420,320,0]],
  "arrowhead":   "closed",
  "content":     { "ref": "text-uuid" },
  "pathType":    "straight"
}
```

### 3.12 BLOCK definition → `IfcRepresentationMap`

A block lives under `definitions/` as a node with `children` referencing
its constituent entity nodes:

```json
{
  "path": "block-DOOR",
  "children": {
    "outline": "e-block-door-1",
    "swing":   "e-block-door-2"
  },
  "attributes": {
    "ifcx::purpose": "definition",
    "ifcx::component::definition": {
      "name":        "DOOR",
      "basePoint":   [0, 0, 0],
      "description": "Standard 800 mm door"
    }
  }
}
```

IFC alias: `IfcRepresentationMap(MappingOrigin, MappedRepresentation:
IfcShapeRepresentation(Items: [IfcGeometricCurveSet]))`. The child
entities live in the same flat `data` array — they aren't nested. Their
`children` slot on the block does the grouping.

### 3.13 INSERT → `IfcMappedItem` (`inherits` + `ifcx::xform::matrix`)

```json
{
  "path": "e-insert-99",
  "inherits": { "blockDef": "block-DOOR" },
  "attributes": {
    "ifcx::xform::matrix": [
      [cos(r)*sx,  sin(r)*sx, 0, 0],
      [-sin(r)*sy, cos(r)*sy, 0, 0],
      [0,          0,         sz,0],
      [tx,         ty,        tz,1]
    ]
  }
}
```

IFC alias: `IfcMappedItem(MappingSource: <ref to RepresentationMap>,
MappingTarget: IfcCartesianTransformationOperator2D)`. The 4x4 column-
major matrix is USD-compatible (`usd::xformop::transform`). Uniform
scale + rotation is fine; non-uniform scaling falls back to the explicit
2D operator with X/Y scale.

ATTRIBs attached to the INSERT are emitted as child nodes of the
insert with `ifcx::component::attribute`:

```json
{ "path": "e-attrib-99-TITLE",
  "attributes": {
    "ifcx::component::attribute": {
      "tag": "TITLE", "value": "Floor Plan", "prompt": "Drawing title",
      "position": [712, 35, 0]
    }
  }
}
```

The parent insert links via `children: { "TITLE": "e-attrib-99-TITLE" }`.

### 3.14 Layer → `IfcPresentationLayerAssignment`

```json
{
  "path": "layer-Walls",
  "attributes": {
    "ifcx::layer::assignment": { "name": "Walls", "description": "Load-bearing walls" },
    "ifcx::layer::style": {
      "colour":      { "r": 1, "g": 0, "b": 0 },
      "lineWeight":  0.5,
      "dashPattern": [12.0, -3.0],
      "visible":     true,
      "frozen":      false,
      "locked":      false,
      "plot":        true
    }
  }
}
```

IFC alias: `IfcPresentationLayerWithStyle(Name, Description, AssignedItems,
Identifier, LayerOn, LayerFrozen, LayerBlocked, LayerStyles)`. Entities
reference the layer by `ifcx::connects::layer: { "ref": "layer-Walls" }`.

### 3.15 Linetype → `IfcCurveStyleFontPattern`

```json
{
  "path": "linetype-Dashed",
  "attributes": {
    "ifcx::style::curveStyle": {
      "description":  "ISO dash __ __ __ __",
      "dashPattern":  [12.0, -3.0]
    }
  }
}
```

Positive = visible segment, negative = gap, zero = dot. Same convention
as DXF LTYPE complex pattern (without the text/shape codes; those go in
a separate `complexElements` sub-key when needed).

### 3.16 Text style → `IfcTextStyle`

```json
{
  "path": "textstyle-Heading",
  "attributes": {
    "ifcx::style::textStyle": {
      "font":         "Arial",
      "size":         5.0,
      "weight":       "bold",
      "widthFactor":  1.0,
      "obliqueAngle": 0,
      "colour":       { "r": 0, "g": 0, "b": 0 }
    }
  }
}
```

IFC alias: `IfcTextStyle(Name, TextCharacterAppearance:
IfcTextStyleForDefinedFont, TextStyle: IfcTextStyleTextModel,
TextFontStyle: IfcTextStyleFontModel(FontFamily, FontStyle, FontWeight,
FontSize))`.

### 3.17 Dimension style → bag of `ifcx::style::dimensionStyle`

```json
{
  "path": "dimstyle-Standard",
  "attributes": {
    "ifcx::style::dimensionStyle": {
      "textHeight":            2.5,
      "arrowSize":             2.5,
      "extensionOffset":       0.625,
      "dimensionLineIncrement":3.75,
      "extensionExtend":       1.25,
      "textGap":               0.625,
      "textAbove":             1,
      "decimalPlaces":         2,
      "overallScale":          1.0,
      "arrowType":             "tick",
      "textStyleRef":          "textstyle-Standard"
    }
  }
}
```

No direct IFC equivalent (IFC4 deleted it). This is the IFC-X extension.
Inheritance across dimstyles via `inherits` if we ever need it; v3 ships
without dimstyle inheritance to keep the writer simple.

### 3.18 Drawing view → `IfcGeometricRepresentationSubContext`

A drawing view is a 2D context that groups its members:

```json
{
  "path": "view-model",
  "children": {
    "e-000123": "e-000123",
    "e-000124": "e-000124"
  },
  "attributes": {
    "ifcx::purpose":   "drawing",
    "ifcx::view::name":  "Model",
    "ifcx::view::scale": 1.0,
    "ifcx::view::extents": { "min": [0,0], "max": [10000, 8000] },
    "ifcx::view::isModelSpace": true
  }
}
```

IFC alias: `IfcGeometricRepresentationSubContext(ContextIdentifier,
ContextType: "Plan", TargetView: PLAN_VIEW, TargetScale)`.

### 3.19 Sheet / paperspace LAYOUT → `IfcAnnotationFillArea` (sheet) + viewports

```json
{
  "path": "sheet-A1-001",
  "children": {
    "vp-1":       "viewport-12ab",
    "titleblock": "e-insert-titleblock"
  },
  "attributes": {
    "ifcx::purpose":         "sheet",
    "ifcx::sheet::paper":    {
      "width":       841,
      "height":      594,
      "margins":     [10, 10, 10, 10],
      "orientation": "landscape"
    },
    "ifcx::sheet::plotSettings": {
      "scale":      "1:100",
      "area":       "layout",
      "styleTable": "default.ctb"
    }
  }
}
```

Viewports inside a sheet:

```json
{
  "path": "viewport-12ab",
  "attributes": {
    "ifcx::purpose": "sheet",
    "ifcx::sheet::viewport": {
      "center":         [200, 150],
      "width":          200,
      "height":         150,
      "viewTarget":     [5000, 4000, 0],
      "viewDirection":  [0, 0, 1],
      "viewScale":      0.01,
      "twistAngle":     0,
      "frozenLayers":   ["Construction"],
      "clipBoundary":   { "ref": "ec-clip-uuid" },
      "locked":         true
    },
    "ifcx::connects::view": { "ref": "view-model" }
  }
}
```

### 3.20 Image / Raster → `IfcImageTexture` + media table

```json
{
  "path": "e-image-001",
  "attributes": {
    "ifcx::image::raster": {
      "mediaId":        "img-001",
      "insertionPoint": [0, 0, 0],
      "pixelSize":      [0.5, 0.5],
      "rotation":       0,
      "clipBoundary":   { "ref": "ec-clip-uuid" }
    }
  }
}
```

The actual pixels live in `media["img-001"]`:

```json
"media": {
  "img-001": {
    "mimeType": "image/png",
    "width":    1920,
    "height":   1080,
    "dpi":      96,
    "data":     "iVBORw0KGgoAAAANSUhEUgAA..."   // base64
  }
}
```

Inline base64 in JSON, raw bytes in the binary envelope (see wire-format
spec) — the JSON mode is for diff/interop, the binary mode is the
production path.

### 3.21 Wipeout / mask → `IfcAnnotation` with `ifcx::image::wipeout`

```json
"ifcx::image::wipeout": { "boundary": [[x,y,0], ...] }
```

### 3.22 Table → `ifcx::annotation::table`

```json
"ifcx::annotation::table": {
  "rows":           3,
  "columns":        2,
  "rowHeights":     [8, 6, 6],
  "columnWidths":   [40, 30],
  "insertionPoint": [550, 100, 0],
  "cells": [
    { "row": 0, "column": 0, "text": "Room", "style": "textstyle-Heading" },
    { "row": 0, "column": 1, "text": "Area (m²)" },
    { "row": 1, "column": 0, "text": "Room 101" },
    { "row": 1, "column": 1, "text": "120" }
  ]
}
```

No direct IFC equivalent; this is an IFC-X extension.

### 3.23 3DSOLID / BODY / REGION → `ifcx::geom::solid`

ACIS / B-Rep payload preserved verbatim as opaque string until we
implement a Brep decoder:

```json
"ifcx::geom::solid": { "data": "<base64 or hex ACIS stream>",
                       "encoding": "acis-sat-v7" }
```

We deliberately keep this as a single opaque blob rather than expanding
to `IfcAdvancedBrep` — round-trippable, future-decodable, no false
fidelity claim.

### 3.24 3DFACE / MESH → `ifcx::geom::mesh` (USD-style)

```json
"ifcx::geom::mesh": {
  "points":            [[x,y,z], ...],
  "faceVertexIndices": [0, 1, 2,  2, 3, 0, ...],
  "faceVertexCounts":  [3, 3, ...],
  "normals":           [[nx,ny,nz], ...]
}
```

Aliases to `usd::usdgeom::mesh` — IFC5's chosen mesh form. The writer
prefers this over `IfcTriangulatedFaceSet` because USD round-trips
losslessly with Bonsai / Blender.

### 3.25 Bonsai-style cut linework

When an IFC model is sliced and rendered to 2D linework by Bonsai
(`integrations/blender/` in IFC-Factory), the resulting drawing nodes
carry both `ifcx::svg::*` for CSS class metadata and the standard
`ifcx::geom::*` for the curve itself:

```json
{
  "path": "wall-cut-001",
  "attributes": {
    "ifcx::purpose":          "drawing",
    "ifcx::geom::compositeCurve": { "segments": [...] },
    "ifcx::svg::class":       "cut IfcWall material-beton",
    "ifcx::style::curveStyle":{ "width": 0.35 },
    "ifcx::connects::source": { "ref": "wall-guid-123" }
  }
}
```

The `ifcx::connects::source` ref points to a `purpose: "model"` node
that lives in the **same document**, in `spatial/` (see 2.1). This is
the killer demo for IFC-X: one file holds the BIM model + its 2D cut
linework + the dimensions that reference the model, no external glue.

## 4. References vs. embedding

Where IFC4 STEP would write `#42` integer surrogates, IFC-X uses one of:

| Form                                | Used for                                 |
|-------------------------------------|------------------------------------------|
| `"ref"` object: `{ "ref": "path" }` | one-to-one logical link                  |
| `inherits`: `{ "role": "path" }`    | type / material / block instantiation    |
| `children`: `{ "name": "path" }`    | structural containment                   |

We never embed an entity definition inside another node — flat data
list, always. This is what makes the multi-entry composition pattern
work, and what makes the document diff-friendly.

## 5. GlobalId / handle preservation

Every node that came from a DXF/DWG carries:

```json
"bsi::ifc::guid":         "<22-char IFC GlobalId>",
"ifcx::source::handle":    "5A3F",      // original DXF/DWG hex handle
"ifcx::source::origin":    "dwg"        // dxf|dwg|ifc|ifcdraw|created
```

This is the round-trip anchor. A `Save-As .dxf` writes the handle back
verbatim; a `Save-As .ifc` uses the GlobalId. New entities created
inside Open 2D Studio get a fresh GlobalId and `origin: "created"`.

## 6. Style cascade

Resolution order for a node's effective curve appearance:

1. Local `ifcx::style::curveStyle` if present (entity-level override)
2. Linked linetype via `ifcx::connects::style` of kind `linetype`
3. Layer style via `ifcx::connects::layer` → that layer's
   `ifcx::layer::style`
4. Document defaults from `header.defaults.ifcx::style::curveStyle`
5. Hardcoded fallback (black, 0.25 mm, solid)

This mirrors DWG ByLayer / ByBlock / explicit semantics. The reader
**must** implement this cascade; the writer **should** emit only
overrides (don't write a curveStyle that exactly equals the layer's).

## 7. What v3 explicitly does NOT include

- **Tessellated triangles.** v2's q16 triangle arrays are a viewer-side
  cache, not a logical representation. v3 stores curves; tessellation is
  a renderer concern. The wire envelope (see sibling spec) MAY embed a
  side-table of precomputed triangles in a `tess/` chunk, but it is
  not part of the IFC-X JSON document.
- **Layout-only entities (defpoints, ACAD_INTERNAL_*).** Filtered out
  by the writer; round-trip to DWG re-generates as needed.
- **Schema-private attributes.** Anything outside the registered
  `ifcx::*`, `bsi::ifc::*`, `usd::*`, `nlsfb::*` namespaces is dropped
  with a warning. Vendor-specific data goes through
  `ifcx::vendor::<vendor>::*` (e.g. `ifcx::vendor::open2dstudio::*`).
- **Dynamic block parameters.** Out of scope for v3.0; will land as
  `ifcx::component::dynamicBlock` in a later minor.

## 8. JSON validation

The writer **MUST** produce documents that validate against
`schema/ifcx-v2.schema.json` from IFC-Factory at the commit pinned in
`Cargo.toml` (`ifcx = { git = "...", rev = "..." }`). The reader
**SHOULD** validate on load when `IFCDRAW_VALIDATE_ON_READ=1` is set.
CI gates on a round-trip + validation test against the test corpus.

## 9. Round-trip guarantees

| Conversion                                     | Lossless? | Notes                                          |
|------------------------------------------------|-----------|------------------------------------------------|
| `.ifcdraw` (v3 binary) → JSON → `.ifcdraw`     | yes       | binary envelope wraps the JSON byte-perfect   |
| `.ifcdraw.json` (v3 text) → binary → text      | yes       | same as above                                  |
| IFC4 `.ifc` (STEP) → v3 JSON → IFC4 STEP       | mostly    | strip ifcx:: namespaces; bsi:: + usd:: survive |
| IFC5 `.ifcx` (Ifc-Factory v2) → IFCDraw v3     | yes       | superset relationship                          |
| DWG → v3 JSON → DWG                            | mostly    | matches IFCXB current 94% loss-free metric    |

## 10. Sizes (estimate)

A 2 875-entity world (per Ifc-Factory's verification corpus):

| Form                                         | Size  | Notes                              |
|----------------------------------------------|-------|------------------------------------|
| Source DXF (R2018)                           | 546 KB| baseline                           |
| IFCDraw v2 (msgpack + zstd-19)               |  58 KB| current Open 2D Studio default     |
| IFCXB (CBOR + zstd-3, Ifc-Factory baseline)  |  57 KB| reference number                   |
| IFCDraw v3 binary (CBOR + zstd-19 + dict)    |  48 KB| estimated, dict-trained on corpus  |
| IFCDraw v3 JSON (.ifcdraw.json, raw)         | 720 KB| text mode for diff / interop       |
| IFCDraw v3 JSON + plain zstd-19              |  62 KB| no dict, no CBOR conversion        |

Implementation-side numbers are estimates pending the v3 prototype; the
CBOR-vs-msgpack delta on this kind of integer-heavy payload is < 5%
either way, and the bulk of the win comes from a zstd dictionary trained
on the namespace strings (`ifcx::geom::compositeCurve` etc.) which
otherwise repeat O(entity-count) times.

## 11. Open questions

These are surfaced again in the report; they need answers before the
implementation round:

1. **Pinned IFC-Factory revision.** Do we vendor `ifcx-rs` as a git
   dependency at a pinned SHA, or fork to `open-2d-studio/ifcx-rs` and
   maintain a soft sync? The former is cleaner; the latter avoids
   blocking on upstream PR latency when we need a fix.
2. **Hatch boundary references vs. inline.** The spec says references.
   In practice a hatch's outer boundary is often a closed composite
   curve that no other entity uses. Should we have a "boundary inlined"
   shortcut (`"outer": { "compositeCurve": {...} }`) for that case to
   avoid a node-pair explosion in dense hatched plans?
3. **Coordinate precision.** IFC-X JSON stores `f64`. v2 binary uses
   q16. v3 binary keeps `f64` in CBOR by default — should we provide an
   opt-in q16 chunk in the envelope for size-sensitive deployments, or
   trust zstd to do the work?
4. **GUID stability under round-trip.** When a DXF without GUIDs is
   imported, we synthesise stable GUIDs from `(handle, document-id,
   namespace-uuid)`. Should the namespace UUID be public (so two
   independent users importing the same DWG produce the same GUIDs) or
   per-installation (privacy)?
5. **`spatial/` policy for DWG-only documents.** Do we ever synthesise
   IfcSite/Building/Storey when the source had ACAD_LAYOUT tab names
   that look like storey names ("Begane Grond", "Verdieping 1")? It's
   tempting but error-prone.

---

**Sister spec:** `2026-05-22-ifcdraw-v3-wire-format.md` — CBOR + zstd
envelope, magic bytes, dispatch, and text-mode interop.
