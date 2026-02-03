# Open 2D Studio - MCP API Reference

This document describes the MCP (Model Context Protocol) tool-based API for Open 2D Studio. All commands use JSON format.

## Table of Contents

- [Getting Started](#getting-started)
- [Tool Format](#tool-format)
- [Draw Tools](#draw-tools)
- [Modify Tools](#modify-tools)
- [Query Tools](#query-tools)
- [Selection Tools](#selection-tools)
- [Layer Tools](#layer-tools)
- [Viewport Tools](#viewport-tools)
- [Document Tools](#document-tools)
- [Style Tools](#style-tools)
- [Snap Tools](#snap-tools)
- [History Tools](#history-tools)

---

## Getting Started

### Tool Call Format

All operations use MCP tool calls in JSON format:

```json
{
  "tool": "cad_category_action_entity",
  "arguments": { ... }
}
```

### Multiple Operations

Execute multiple tools in sequence:

```json
[
  {"tool": "cad_draw_create_rectangle", "arguments": {"topLeft": {"x": 100, "y": 100}, "width": 200, "height": 100}},
  {"tool": "cad_draw_create_circle", "arguments": {"center": {"x": 200, "y": 150}, "radius": 30}}
]
```

### Response Format

All tools return a response:

```json
{
  "success": true,
  "data": { ... },
  "executionTime": 5.2
}
```

Or on error:

```json
{
  "success": false,
  "error": "Error message"
}
```

### Point Format

Points can be specified as objects:

```json
{"x": 100, "y": 200}
```

---

## Draw Tools

Create shapes in the active drawing.

### cad_draw_create_line

Draw a line between two points.

```json
{
  "tool": "cad_draw_create_line",
  "arguments": {
    "start": {"x": 0, "y": 0},
    "end": {"x": 100, "y": 100},
    "style": {
      "strokeColor": "#ff0000",
      "strokeWidth": 2,
      "lineStyle": "dashed"
    }
  }
}
```

**Parameters:**
- `start` (point, required): Start point
- `end` (point, required): End point
- `style` (object, optional): Style overrides
  - `strokeColor`: Hex color (e.g., "#ff0000")
  - `strokeWidth`: Line width in pixels
  - `lineStyle`: "solid" | "dashed" | "dotted" | "dashdot"

**Returns:** `{ "id": "string", "shape": {...} }`

---

### cad_draw_create_rectangle

Draw a rectangle.

```json
{
  "tool": "cad_draw_create_rectangle",
  "arguments": {
    "topLeft": {"x": 0, "y": 0},
    "width": 100,
    "height": 50,
    "style": {"fillColor": "#0066cc"}
  }
}
```

**Parameters:**
- `topLeft` (point, required): Top-left corner
- `width` (number, required): Width (>= 0)
- `height` (number, required): Height (>= 0)
- `rotation` (number, optional): Rotation in radians (default: 0)
- `style` (object, optional): Style overrides

**Returns:** `{ "id": "string", "shape": {...} }`

---

### cad_draw_create_circle

Draw a circle.

```json
{
  "tool": "cad_draw_create_circle",
  "arguments": {
    "center": {"x": 50, "y": 50},
    "radius": 25,
    "style": {"strokeColor": "#00ff00"}
  }
}
```

**Parameters:**
- `center` (point, required): Center point
- `radius` (number, required): Radius (>= 0)
- `style` (object, optional): Style overrides

**Returns:** `{ "id": "string", "shape": {...} }`

---

### cad_draw_create_arc

Draw an arc (partial circle).

```json
{
  "tool": "cad_draw_create_arc",
  "arguments": {
    "center": {"x": 50, "y": 50},
    "radius": 25,
    "startAngle": 0,
    "endAngle": 3.14159
  }
}
```

**Parameters:**
- `center` (point, required): Center point
- `radius` (number, required): Radius (>= 0)
- `startAngle` (number, required): Start angle in radians
- `endAngle` (number, required): End angle in radians
- `style` (object, optional): Style overrides

**Returns:** `{ "id": "string", "shape": {...} }`

---

### cad_draw_create_ellipse

Draw an ellipse.

```json
{
  "tool": "cad_draw_create_ellipse",
  "arguments": {
    "center": {"x": 50, "y": 50},
    "radiusX": 40,
    "radiusY": 20,
    "rotation": 0.5
  }
}
```

**Parameters:**
- `center` (point, required): Center point
- `radiusX` (number, required): X radius (>= 0)
- `radiusY` (number, required): Y radius (>= 0)
- `rotation` (number, optional): Rotation in radians (default: 0)
- `style` (object, optional): Style overrides

**Returns:** `{ "id": "string", "shape": {...} }`

---

### cad_draw_create_polyline

Draw a polyline (connected line segments).

```json
{
  "tool": "cad_draw_create_polyline",
  "arguments": {
    "points": [
      {"x": 0, "y": 0},
      {"x": 50, "y": 100},
      {"x": 100, "y": 0}
    ],
    "closed": true
  }
}
```

**Parameters:**
- `points` (array of points, required): Vertices (minimum 2)
- `closed` (boolean, optional): Close the polyline (default: false)
- `style` (object, optional): Style overrides

**Returns:** `{ "id": "string", "shape": {...} }`

---

### cad_draw_create_spline

Draw a smooth spline curve through points.

```json
{
  "tool": "cad_draw_create_spline",
  "arguments": {
    "points": [
      {"x": 0, "y": 0},
      {"x": 50, "y": 100},
      {"x": 100, "y": 0}
    ],
    "closed": false
  }
}
```

**Parameters:**
- `points` (array of points, required): Control points (minimum 2)
- `closed` (boolean, optional): Close the spline (default: false)
- `style` (object, optional): Style overrides

**Returns:** `{ "id": "string", "shape": {...} }`

---

### cad_draw_create_text

Add text annotation.

```json
{
  "tool": "cad_draw_create_text",
  "arguments": {
    "position": {"x": 100, "y": 100},
    "text": "Hello World",
    "fontSize": 16,
    "fontFamily": "Arial",
    "color": "#ffffff",
    "bold": true
  }
}
```

**Parameters:**
- `position` (point, required): Text position
- `text` (string, required): Text content
- `fontSize` (number, optional): Font size (default: 12)
- `fontFamily` (string, optional): Font family (default: "Arial")
- `rotation` (number, optional): Rotation in radians (default: 0)
- `alignment` (string, optional): "left" | "center" | "right" (default: "left")
- `verticalAlignment` (string, optional): "top" | "middle" | "bottom" (default: "top")
- `color` (string, optional): Text color (default: "#ffffff")
- `bold` (boolean, optional): Bold text (default: false)
- `italic` (boolean, optional): Italic text (default: false)

**Returns:** `{ "id": "string", "shape": {...} }`

---

### cad_draw_create_point

Draw a point marker.

```json
{
  "tool": "cad_draw_create_point",
  "arguments": {
    "position": {"x": 50, "y": 50}
  }
}
```

**Parameters:**
- `position` (point, required): Point position
- `style` (object, optional): Style overrides

**Returns:** `{ "id": "string", "shape": {...} }`

---

### cad_draw_create_dimension

Add a dimension annotation.

```json
{
  "tool": "cad_draw_create_dimension",
  "arguments": {
    "points": [{"x": 0, "y": 0}, {"x": 100, "y": 0}],
    "dimensionType": "linear",
    "dimensionLineOffset": 20
  }
}
```

**Parameters:**
- `points` (array of points, required): Reference points
- `dimensionType` (string, optional): "linear" | "aligned" | "angular" | "radial" | "diameter"
- `dimensionLineOffset` (number, optional): Offset of dimension line (default: 20)
- `value` (string, optional): Override dimension value
- `prefix` (string, optional): Text prefix
- `suffix` (string, optional): Text suffix

**Returns:** `{ "id": "string", "shape": {...} }`

---

### cad_draw_create_hatch

Create a hatched/filled region.

```json
{
  "tool": "cad_draw_create_hatch",
  "arguments": {
    "points": [
      {"x": 0, "y": 0},
      {"x": 100, "y": 0},
      {"x": 100, "y": 100},
      {"x": 0, "y": 100}
    ],
    "patternType": "diagonal",
    "fillColor": "#ff0000"
  }
}
```

**Parameters:**
- `points` (array of points, required): Boundary polygon vertices
- `patternType` (string, optional): "solid" | "diagonal" | "crosshatch" | "horizontal" | "vertical" | "dots" | "custom" (default: "solid")
- `patternAngle` (number, optional): Pattern rotation in degrees (default: 0)
- `patternScale` (number, optional): Pattern scale multiplier (default: 1)
- `fillColor` (string, optional): Pattern/fill color (default: "#ffffff")
- `backgroundColor` (string, optional): Background color (transparent if not set)

**Returns:** `{ "id": "string", "shape": {...} }`

---

### cad_draw_createBulk

Create multiple shapes in a single operation.

```json
{
  "tool": "cad_draw_createBulk",
  "arguments": {
    "shapes": [
      {"type": "line", "params": {"start": {"x": 0, "y": 0}, "end": {"x": 100, "y": 0}}},
      {"type": "line", "params": {"start": {"x": 100, "y": 0}, "end": {"x": 100, "y": 100}}},
      {"type": "circle", "params": {"center": {"x": 50, "y": 50}, "radius": 20}}
    ]
  }
}
```

**Parameters:**
- `shapes` (array, required): Array of shape definitions with `type` and `params`

**Returns:** `{ "count": number, "ids": ["..."], "shapes": [...] }`

---

## Modify Tools

Transform and modify existing shapes.

### cad_modify_move

Move shapes by offset.

```json
{
  "tool": "cad_modify_move",
  "arguments": {
    "ids": ["shape_123", "shape_456"],
    "offset": {"x": 50, "y": 50}
  }
}
```

**Parameters:**
- `ids` (array, optional): Shape IDs to move (uses selection if not provided)
- `offset` (point, required): Translation offset

**Returns:** `{ "movedCount": number, "ids": ["..."] }`

---

### cad_modify_copy

Copy shapes with optional offset.

```json
{
  "tool": "cad_modify_copy",
  "arguments": {
    "ids": ["shape_123"],
    "offset": {"x": 20, "y": 20}
  }
}
```

**Parameters:**
- `ids` (array, optional): Shape IDs to copy (uses selection if not provided)
- `offset` (point, optional): Offset for copies (default: {x: 20, y: 20})

**Returns:** `{ "copiedCount": number, "newIds": ["..."] }`

---

### cad_modify_rotate

Rotate shapes around a center point.

```json
{
  "tool": "cad_modify_rotate",
  "arguments": {
    "ids": ["shape_123"],
    "center": {"x": 50, "y": 50},
    "angle": 0.785
  }
}
```

**Parameters:**
- `ids` (array, optional): Shape IDs (uses selection if not provided)
- `center` (point, required): Rotation center
- `angle` (number, required): Rotation angle in radians

**Returns:** `{ "rotatedCount": number, "ids": ["..."] }`

---

### cad_modify_scale

Scale shapes from a center point.

```json
{
  "tool": "cad_modify_scale",
  "arguments": {
    "ids": ["shape_123"],
    "center": {"x": 50, "y": 50},
    "factor": 2.0
  }
}
```

**Parameters:**
- `ids` (array, optional): Shape IDs (uses selection if not provided)
- `center` (point, required): Scale center
- `factor` (number, required): Scale factor (min: 0.01)

**Returns:** `{ "scaledCount": number, "ids": ["..."] }`

---

### cad_modify_mirror

Mirror shapes across a line.

```json
{
  "tool": "cad_modify_mirror",
  "arguments": {
    "ids": ["shape_123"],
    "p1": {"x": 0, "y": 0},
    "p2": {"x": 0, "y": 100},
    "copy": true
  }
}
```

**Parameters:**
- `ids` (array, optional): Shape IDs (uses selection if not provided)
- `p1` (point, required): First point of mirror line
- `p2` (point, required): Second point of mirror line
- `copy` (boolean, optional): Create mirrored copies (default: false)

**Returns:** `{ "mirroredCount": number, "ids": ["..."] }` or `{ "mirroredCount": number, "newIds": ["..."] }` if copy=true

---

### cad_modify_delete

Delete shapes.

```json
{
  "tool": "cad_modify_delete",
  "arguments": {
    "ids": ["shape_123", "shape_456"]
  }
}
```

**Parameters:**
- `ids` (array, optional): Shape IDs to delete (uses selection if not provided)

**Returns:** `{ "deletedCount": number, "ids": ["..."] }`

---

### cad_modify_update

Update shape properties.

```json
{
  "tool": "cad_modify_update",
  "arguments": {
    "id": "shape_123",
    "props": {
      "visible": true,
      "locked": false
    }
  }
}
```

**Parameters:**
- `id` (string, required): Shape ID
- `props` (object, required): Properties to update

**Returns:** `{ "id": "string" }`

---

### cad_modify_setStyle

Update shape style.

```json
{
  "tool": "cad_modify_setStyle",
  "arguments": {
    "ids": ["shape_123"],
    "style": {
      "strokeColor": "#ff0000",
      "strokeWidth": 2,
      "lineStyle": "dashed",
      "fillColor": "#00ff00"
    }
  }
}
```

**Parameters:**
- `ids` (array, optional): Shape IDs (uses selection if not provided)
- `style` (object, required): Style properties

**Returns:** `{ "styledCount": number, "ids": ["..."] }`

---

### cad_modify_setLayer

Move shapes to a different layer.

```json
{
  "tool": "cad_modify_setLayer",
  "arguments": {
    "ids": ["shape_123"],
    "layerId": "layer_456"
  }
}
```

**Parameters:**
- `ids` (array, optional): Shape IDs (uses selection if not provided)
- `layerId` (string, required): Target layer ID

**Returns:** `{ "movedCount": number, "ids": ["..."], "layerId": "string" }`

---

## Query Tools

Read-only operations to get information about shapes.

### cad_query_get

Get a shape by ID.

```json
{
  "tool": "cad_query_get",
  "arguments": {
    "id": "shape_123"
  }
}
```

**Parameters:**
- `id` (string, required): Shape ID

**Returns:** `{ "shape": {...} }`

---

### cad_query_list

List shapes with optional filtering.

```json
{
  "tool": "cad_query_list",
  "arguments": {
    "type": "line",
    "layer": "layer_123",
    "visible": true,
    "limit": 100,
    "offset": 0
  }
}
```

**Parameters:**
- `type` (string, optional): Filter by shape type
- `layer` (string, optional): Filter by layer ID
- `drawing` (string, optional): Filter by drawing ID (default: active drawing)
- `visible` (boolean, optional): Filter by visibility
- `locked` (boolean, optional): Filter by locked state
- `limit` (number, optional): Maximum results (default: 1000)
- `offset` (number, optional): Skip first N results (default: 0)

**Returns:** `{ "shapes": [...], "total": number, "offset": number, "limit": number, "hasMore": boolean }`

---

### cad_query_find

Find shapes within a bounding box.

```json
{
  "tool": "cad_query_find",
  "arguments": {
    "bounds": {"minX": 0, "minY": 0, "maxX": 100, "maxY": 100},
    "type": "line",
    "intersects": true
  }
}
```

**Parameters:**
- `bounds` (object, required): Bounding box {minX, minY, maxX, maxY}
- `type` (string, optional): Filter by shape type
- `intersects` (boolean, optional): Include intersecting shapes (default: true)

**Returns:** `{ "shapes": [...], "count": number }`

---

### cad_query_count

Count shapes with optional filtering.

```json
{
  "tool": "cad_query_count",
  "arguments": {
    "type": "line",
    "layer": "layer_123"
  }
}
```

**Parameters:**
- `type` (string, optional): Filter by shape type
- `layer` (string, optional): Filter by layer ID
- `drawing` (string, optional): Filter by drawing ID

**Returns:** `{ "count": number, "byType": {"line": 5, "circle": 3, ...} }`

---

### cad_query_bounds

Get bounding box of shapes.

```json
{
  "tool": "cad_query_bounds",
  "arguments": {
    "ids": ["shape_123", "shape_456"]
  }
}
```

**Parameters:**
- `ids` (array, optional): Shape IDs (uses all shapes if not provided)

**Returns:** `{ "bounds": {"minX": 0, "minY": 0, "maxX": 100, "maxY": 100}, "width": number, "height": number, "center": {"x": 50, "y": 50} }`

---

### cad_query_selected

Get currently selected shapes.

```json
{
  "tool": "cad_query_selected",
  "arguments": {}
}
```

**Returns:** `{ "ids": ["..."], "shapes": [...], "count": number }`

---

## Selection Tools

Manage shape selection.

### cad_selection_set

Set the selection to specific shapes.

```json
{
  "tool": "cad_selection_set",
  "arguments": {
    "ids": ["shape_123", "shape_456"]
  }
}
```

**Parameters:**
- `ids` (array, required): Shape IDs to select

**Returns:** `{ "selectedCount": number, "ids": ["..."] }`

---

### cad_selection_add

Add shapes to current selection.

```json
{
  "tool": "cad_selection_add",
  "arguments": {
    "ids": ["shape_789"]
  }
}
```

**Parameters:**
- `ids` (array, required): Shape IDs to add

**Returns:** `{ "addedCount": number, "totalSelected": number, "ids": ["..."] }`

---

### cad_selection_remove

Remove shapes from current selection.

```json
{
  "tool": "cad_selection_remove",
  "arguments": {
    "ids": ["shape_123"]
  }
}
```

**Parameters:**
- `ids` (array, required): Shape IDs to remove

**Returns:** `{ "removedCount": number, "totalSelected": number, "ids": ["..."] }`

---

### cad_selection_clear

Clear all selection.

```json
{
  "tool": "cad_selection_clear",
  "arguments": {}
}
```

**Returns:** `{ "clearedCount": number }`

---

### cad_selection_all

Select all shapes in the active drawing.

```json
{
  "tool": "cad_selection_all",
  "arguments": {
    "type": "circle",
    "layer": "layer_123"
  }
}
```

**Parameters:**
- `type` (string, optional): Filter by shape type
- `layer` (string, optional): Filter by layer ID

**Returns:** `{ "selectedCount": number, "ids": ["..."] }`

---

## Layer Tools

Manage layers.

### cad_layer_create

Create a new layer.

```json
{
  "tool": "cad_layer_create",
  "arguments": {
    "name": "My Layer",
    "color": "#00ff00",
    "visible": true,
    "locked": false,
    "lineStyle": "solid",
    "lineWidth": 1
  }
}
```

**Parameters:**
- `name` (string, required): Layer name
- `color` (string, optional): Layer color (default: "#ffffff")
- `visible` (boolean, optional): Layer visibility (default: true)
- `locked` (boolean, optional): Layer locked state (default: false)
- `lineStyle` (string, optional): "solid" | "dashed" | "dotted" | "dashdot"
- `lineWidth` (number, optional): Default line width (default: 1)

**Returns:** `{ "layer": {...} }`

---

### cad_layer_delete

Delete a layer.

```json
{
  "tool": "cad_layer_delete",
  "arguments": {
    "id": "layer_123"
  }
}
```

**Parameters:**
- `id` (string, required): Layer ID to delete

**Returns:** `{ "deletedLayer": {...}, "shapesAffected": number }`

---

### cad_layer_update

Update layer properties.

```json
{
  "tool": "cad_layer_update",
  "arguments": {
    "id": "layer_123",
    "name": "New Name",
    "color": "#ff0000",
    "visible": true,
    "locked": false
  }
}
```

**Parameters:**
- `id` (string, required): Layer ID
- `name` (string, optional): New layer name
- `color` (string, optional): Layer color
- `visible` (boolean, optional): Layer visibility
- `locked` (boolean, optional): Layer locked state
- `lineStyle` (string, optional): Default line style
- `lineWidth` (number, optional): Default line width

**Returns:** `{ "layer": {...} }`

---

### cad_layer_setActive

Set the active layer.

```json
{
  "tool": "cad_layer_setActive",
  "arguments": {
    "id": "layer_123"
  }
}
```

**Parameters:**
- `id` (string, required): Layer ID to make active

**Returns:** `{ "activeLayerId": "string", "layer": {...} }`

---

### cad_layer_list

List all layers.

```json
{
  "tool": "cad_layer_list",
  "arguments": {
    "drawing": "drawing_123"
  }
}
```

**Parameters:**
- `drawing` (string, optional): Filter by drawing ID

**Returns:** `{ "layers": [...], "activeLayerId": "string", "count": number }`

---

### cad_layer_get

Get a layer by ID.

```json
{
  "tool": "cad_layer_get",
  "arguments": {
    "id": "layer_123"
  }
}
```

**Parameters:**
- `id` (string, required): Layer ID

**Returns:** `{ "layer": {...}, "shapeCount": number, "isActive": boolean }`

---

## Viewport Tools

Control the view.

### cad_viewport_pan

Pan the viewport by offset.

```json
{
  "tool": "cad_viewport_pan",
  "arguments": {
    "dx": 100,
    "dy": 50
  }
}
```

**Parameters:**
- `dx` (number, required): Horizontal pan amount
- `dy` (number, required): Vertical pan amount

**Returns:** `{ "viewport": {...} }`

---

### cad_viewport_zoom

Zoom in or out.

```json
{
  "tool": "cad_viewport_zoom",
  "arguments": {
    "direction": "in",
    "factor": 1.2,
    "center": {"x": 100, "y": 100}
  }
}
```

**Parameters:**
- `direction` (string, required): "in" | "out"
- `factor` (number, optional): Zoom factor (default: 1.2)
- `center` (point, optional): Zoom center (screen coordinates)

**Returns:** `{ "viewport": {...} }`

---

### cad_viewport_fit

Fit viewport to show all content or specific shapes.

```json
{
  "tool": "cad_viewport_fit",
  "arguments": {
    "ids": ["shape_123"],
    "padding": 50
  }
}
```

**Parameters:**
- `ids` (array, optional): Shape IDs to fit to (fits all if not provided)
- `padding` (number, optional): Padding around content (default: 50)

**Returns:** `{ "viewport": {...} }`

---

### cad_viewport_reset

Reset viewport to default position and zoom.

```json
{
  "tool": "cad_viewport_reset",
  "arguments": {}
}
```

**Returns:** `{ "viewport": {...} }`

---

### cad_viewport_setZoom

Set specific zoom level.

```json
{
  "tool": "cad_viewport_setZoom",
  "arguments": {
    "level": 1.5,
    "center": {"x": 50, "y": 50}
  }
}
```

**Parameters:**
- `level` (number, required): Zoom level (1 = 100%, min: 0.01, max: 100)
- `center` (point, optional): Zoom center in world coordinates

**Returns:** `{ "viewport": {...} }`

---

### cad_viewport_get

Get current viewport state.

```json
{
  "tool": "cad_viewport_get",
  "arguments": {}
}
```

**Returns:** `{ "viewport": {...}, "canvasSize": {"width": number, "height": number} }`

---

## Document Tools

Manage drawings and sheets.

### cad_document_newDrawing

Create a new drawing.

```json
{
  "tool": "cad_document_newDrawing",
  "arguments": {
    "name": "My Drawing",
    "switchTo": true
  }
}
```

**Parameters:**
- `name` (string, optional): Drawing name
- `switchTo` (boolean, optional): Switch to the new drawing (default: true)

**Returns:** `{ "drawing": {...} }`

---

### cad_document_deleteDrawing

Delete a drawing.

```json
{
  "tool": "cad_document_deleteDrawing",
  "arguments": {
    "id": "drawing_123"
  }
}
```

**Parameters:**
- `id` (string, required): Drawing ID to delete

**Returns:** `{ "deletedDrawing": {...} }`

---

### cad_document_renameDrawing

Rename a drawing.

```json
{
  "tool": "cad_document_renameDrawing",
  "arguments": {
    "id": "drawing_123",
    "name": "New Name"
  }
}
```

**Parameters:**
- `id` (string, required): Drawing ID
- `name` (string, required): New name

**Returns:** `{ "drawing": {...} }`

---

### cad_document_switchToDrawing

Switch to a specific drawing.

```json
{
  "tool": "cad_document_switchToDrawing",
  "arguments": {
    "id": "drawing_123"
  }
}
```

**Parameters:**
- `id` (string, required): Drawing ID to switch to

**Returns:** `{ "activeDrawingId": "string", "drawing": {...} }`

---

### cad_document_newSheet

Create a new sheet.

```json
{
  "tool": "cad_document_newSheet",
  "arguments": {
    "name": "Sheet 1",
    "paperSize": "A4",
    "orientation": "landscape",
    "switchTo": true
  }
}
```

**Parameters:**
- `name` (string, optional): Sheet name
- `paperSize` (string, optional): "A4" | "A3" | "A2" | "A1" | "A0" | "Letter" | "Legal" | "Tabloid" | "Custom"
- `orientation` (string, optional): "portrait" | "landscape"
- `switchTo` (boolean, optional): Switch to the new sheet (default: true)

**Returns:** `{ "sheet": {...} }`

---

### cad_document_deleteSheet

Delete a sheet.

```json
{
  "tool": "cad_document_deleteSheet",
  "arguments": {
    "id": "sheet_123"
  }
}
```

**Parameters:**
- `id` (string, required): Sheet ID to delete

**Returns:** `{ "deletedSheet": {...} }`

---

### cad_document_switchMode

Switch between drawing and sheet mode.

```json
{
  "tool": "cad_document_switchMode",
  "arguments": {
    "mode": "drawing"
  }
}
```

**Parameters:**
- `mode` (string, required): "drawing" | "sheet"

**Returns:** `{ "mode": "string" }`

---

### cad_document_listDrawings

List all drawings.

```json
{
  "tool": "cad_document_listDrawings",
  "arguments": {}
}
```

**Returns:** `{ "drawings": [...], "activeDrawingId": "string", "count": number }`

---

### cad_document_listSheets

List all sheets.

```json
{
  "tool": "cad_document_listSheets",
  "arguments": {}
}
```

**Returns:** `{ "sheets": [...], "activeSheetId": "string", "count": number }`

---

### cad_document_getState

Get current document state.

```json
{
  "tool": "cad_document_getState",
  "arguments": {}
}
```

**Returns:** `{ "editorMode": "string", "activeDrawingId": "string", "activeSheetId": "string", ... }`

---

## Style Tools

Manage drawing styles.

### cad_style_get

Get current drawing style.

```json
{
  "tool": "cad_style_get",
  "arguments": {}
}
```

**Returns:** `{ "style": {...} }`

---

### cad_style_set

Set current drawing style.

```json
{
  "tool": "cad_style_set",
  "arguments": {
    "strokeColor": "#ff0000",
    "strokeWidth": 2,
    "lineStyle": "dashed",
    "fillColor": "#00ff00"
  }
}
```

**Parameters:**
- `strokeColor` (string, optional): Stroke color (hex)
- `strokeWidth` (number, optional): Stroke width (min: 0.1)
- `lineStyle` (string, optional): "solid" | "dashed" | "dotted" | "dashdot"
- `fillColor` (string, optional): Fill color (hex or undefined for no fill)

**Returns:** `{ "style": {...} }`

---

### cad_style_getDefaults

Get default text style.

```json
{
  "tool": "cad_style_getDefaults",
  "arguments": {}
}
```

**Returns:** `{ "textStyle": {...}, "shapeStyle": {...} }`

---

### cad_style_setTextDefaults

Set default text style.

```json
{
  "tool": "cad_style_setTextDefaults",
  "arguments": {
    "fontSize": 14,
    "fontFamily": "Arial",
    "color": "#ffffff",
    "bold": false,
    "italic": false
  }
}
```

**Parameters:**
- `fontSize` (number, optional): Default font size (min: 1)
- `fontFamily` (string, optional): Default font family
- `color` (string, optional): Default text color
- `bold` (boolean, optional): Default bold state
- `italic` (boolean, optional): Default italic state

**Returns:** `{ "textStyle": {...} }`

---

## Snap Tools

Configure snap settings.

### cad_snap_enable

Enable snap.

```json
{
  "tool": "cad_snap_enable",
  "arguments": {}
}
```

**Returns:** `{ "snapEnabled": true }`

---

### cad_snap_disable

Disable snap.

```json
{
  "tool": "cad_snap_disable",
  "arguments": {}
}
```

**Returns:** `{ "snapEnabled": false }`

---

### cad_snap_setTypes

Set active snap types.

```json
{
  "tool": "cad_snap_setTypes",
  "arguments": {
    "types": ["endpoint", "midpoint", "center", "intersection"]
  }
}
```

**Parameters:**
- `types` (array, required): Array of snap types
  - Available: "grid", "endpoint", "midpoint", "center", "intersection", "perpendicular", "tangent", "nearest"

**Returns:** `{ "activeSnaps": ["..."] }`

---

### cad_snap_getSettings

Get current snap settings.

```json
{
  "tool": "cad_snap_getSettings",
  "arguments": {}
}
```

**Returns:** `{ "snapEnabled": boolean, "activeSnaps": [...], "snapTolerance": number, "gridVisible": boolean, "gridSize": number, "orthoMode": boolean, "polarTrackingEnabled": boolean, "polarAngleIncrement": number }`

---

### cad_snap_setTolerance

Set snap tolerance.

```json
{
  "tool": "cad_snap_setTolerance",
  "arguments": {
    "tolerance": 10
  }
}
```

**Parameters:**
- `tolerance` (number, required): Snap tolerance in pixels (min: 1)

**Returns:** `{ "snapTolerance": number }`

---

### cad_snap_toggleGrid

Toggle grid visibility.

```json
{
  "tool": "cad_snap_toggleGrid",
  "arguments": {
    "visible": true
  }
}
```

**Parameters:**
- `visible` (boolean, optional): Grid visibility (toggles if not specified)

**Returns:** `{ "gridVisible": boolean }`

---

### cad_snap_setGridSize

Set grid size.

```json
{
  "tool": "cad_snap_setGridSize",
  "arguments": {
    "size": 10
  }
}
```

**Parameters:**
- `size` (number, required): Grid size in drawing units (min: 1)

**Returns:** `{ "gridSize": number }`

---

### cad_snap_toggleOrtho

Toggle orthogonal mode.

```json
{
  "tool": "cad_snap_toggleOrtho",
  "arguments": {
    "enabled": true
  }
}
```

**Parameters:**
- `enabled` (boolean, optional): Ortho mode state (toggles if not specified)

**Returns:** `{ "orthoMode": boolean }`

---

### cad_snap_togglePolar

Toggle polar tracking.

```json
{
  "tool": "cad_snap_togglePolar",
  "arguments": {
    "enabled": true
  }
}
```

**Parameters:**
- `enabled` (boolean, optional): Polar tracking state (toggles if not specified)

**Returns:** `{ "polarTrackingEnabled": boolean }`

---

### cad_snap_setPolarAngle

Set polar tracking angle increment.

```json
{
  "tool": "cad_snap_setPolarAngle",
  "arguments": {
    "angle": 45
  }
}
```

**Parameters:**
- `angle` (number, required): Angle increment in degrees (1-90)

**Returns:** `{ "polarAngleIncrement": number }`

---

## History Tools

Undo/redo operations.

### cad_history_undo

Undo the last action.

```json
{
  "tool": "cad_history_undo",
  "arguments": {}
}
```

**Returns:** `{ "undone": boolean }`

---

### cad_history_redo

Redo the last undone action.

```json
{
  "tool": "cad_history_redo",
  "arguments": {}
}
```

**Returns:** `{ "redone": boolean }`

---

### cad_history_getState

Get current history state.

```json
{
  "tool": "cad_history_getState",
  "arguments": {}
}
```

**Returns:** `{ "canUndo": boolean, "canRedo": boolean, "historyIndex": number, "historySize": number }`

---

## HTTP API

Commands can be executed via the HTTP API using MCP JSON-RPC format:

```bash
curl -X POST http://127.0.0.1:49100/mcp \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "method": "tools/call",
    "params": {
      "name": "cad_draw_create_rectangle",
      "arguments": {"topLeft": {"x": 0, "y": 0}, "width": 100, "height": 50}
    },
    "id": 1
  }'
```

---

## Error Handling

All tools return a response with a `success` field:

```json
{
  "success": false,
  "error": "Shape not found: invalid_id"
}
```

---

## Transactions

Group multiple operations into a single undo step using bulk operations:

```json
{
  "tool": "cad_draw_createBulk",
  "arguments": {
    "shapes": [
      {"type": "line", "params": {"start": {"x": 0, "y": 0}, "end": {"x": 100, "y": 100}}},
      {"type": "circle", "params": {"center": {"x": 50, "y": 50}, "radius": 20}}
    ]
  }
}
```
