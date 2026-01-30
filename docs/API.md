# Open 2D Modeler - Programmatic API Documentation

## Overview

Open 2D Modeler exposes a full programmatic API accessible in two ways:

1. **Browser Console** (`window.cad`) -- for interactive scripting inside the app
2. **HTTP API** (`localhost:49100`) -- for external tools, scripts, and AI assistants to control the app remotely

All examples below work in the browser console or via the `/eval` HTTP endpoint. When using `/eval`, prefix with `return` to get values back.

---

## HTTP API (External Access)

When the app starts, a local HTTP server launches on `http://127.0.0.1:49100`. External tools can send commands to control the app.

### Endpoints

| Method  | Path      | Description                             |
|---------|-----------|-----------------------------------------|
| GET     | `/health` | Check if the app is running             |
| GET     | `/info`   | Get instance info (PID, port, version)  |
| POST    | `/eval`   | Execute JavaScript in the app context   |
| OPTIONS | `*`       | CORS preflight (auto-handled)           |

### Health Check

```bash
curl http://127.0.0.1:49100/health
# {"status":"ok"}
```

### Instance Info

```bash
curl http://127.0.0.1:49100/info
# {"pid":1234,"port":49100,"version":"0.3.0"}
```

### Eval -- Execute Scripts

Send a POST request with a JSON body containing a `script` field. The script runs inside the app's webview with full access to `window.cad`. Scripts support `async`/`await`. The eval has a **30-second timeout**.

```bash
curl -X POST http://127.0.0.1:49100/eval \
  -H "Content-Type: application/json" \
  -d '{"script":"return cad.entities.count()"}'
```

Response:

```json
{"success":true,"result":"0"}
```

Error response:

```json
{"success":false,"error":"ReferenceError: foo is not defined"}
```

Use `return` to send a value back. The result is JSON-serialized (you may need to `JSON.parse()` the `result` string).

### Custom Port

Launch the app with a custom API port:

```bash
open-2d-modeler.exe --api-port 9200
```

### Multiple Instances

Each instance picks a free port starting from 49100 (scans up to +100). Discovery files are written to:

- **Windows**: `%APPDATA%\Open2DModeler\instances\instance-{pid}.json`
- **Linux/Mac**: `~/.config/open-2d-modeler/instances/instance-{pid}.json`

Each file contains:

```json
{"pid":1234,"port":49100,"startedAt":"1706000000"}
```

Discovery files are cleaned up when the app closes.

### CORS

The server sets `Access-Control-Allow-Origin: *` on all responses, so browser-based tools can call it directly.

---

## Type Reference

### Point

All point parameters accept either an object or a tuple:

```js
{ x: 100, y: 200 }  // Object form
[100, 200]           // Array form
```

### ShapeType

```
'line' | 'rectangle' | 'circle' | 'arc' | 'polyline' | 'ellipse' | 'text' | 'point' | 'dimension'
```

### ShapeStyle

```js
{
  strokeColor: '#ffffff',   // CSS color string
  strokeWidth: 1,           // Line width in drawing units
  lineStyle: 'solid',       // 'solid' | 'dashed' | 'dotted' | 'dashdot'
  fillColor: '#ff000080'    // Optional fill color (with alpha)
}
```

### ToolType

```
'select' | 'pan'
| 'line' | 'rectangle' | 'circle' | 'arc' | 'polyline' | 'ellipse' | 'spline' | 'text' | 'dimension'
| 'filled-region' | 'insulation' | 'detail-component'
| 'move' | 'copy' | 'rotate' | 'scale' | 'mirror' | 'trim' | 'extend' | 'fillet' | 'offset'
| 'sheet-text' | 'sheet-leader' | 'sheet-dimension'
```

### SnapType

```
'grid' | 'endpoint' | 'midpoint' | 'center' | 'intersection' | 'perpendicular' | 'tangent' | 'nearest'
```

### LineStyle

```
'solid' | 'dashed' | 'dotted' | 'dashdot'
```

### EditorMode

```
'drawing' | 'sheet'
```

### PaperSize

```
'A4' | 'A3' | 'A2' | 'A1' | 'A0' | 'Letter' | 'Legal' | 'Tabloid' | 'Custom'
```

### PaperOrientation

```
'portrait' | 'landscape'
```

### TextAlignment / TextVerticalAlignment

```
TextAlignment: 'left' | 'center' | 'right'
TextVerticalAlignment: 'top' | 'middle' | 'bottom'
```

### DimensionType

```
'linear' | 'aligned' | 'angular' | 'radius' | 'diameter'
```

### DimensionArrowType

```
'filled' | 'open' | 'dot' | 'tick' | 'none'
```

### DimensionTextPlacement

```
'above' | 'centered' | 'below'
```

### DimensionStyle

```js
{
  arrowType: 'filled',           // DimensionArrowType
  arrowSize: 3,                  // Arrow size in drawing units
  extensionLineGap: 2,           // Gap between geometry and extension line
  extensionLineOvershoot: 2,     // How far extension lines extend past dimension line
  textHeight: 3,                 // Text height in drawing units
  textPlacement: 'above',        // DimensionTextPlacement
  lineColor: '#00ffff',          // Color for dimension/extension lines
  textColor: '#00ffff',          // Color for dimension text
  precision: 2                   // Decimal places
}
```

### EntityFilter

Used by `cad.entities.list()` and `cad.entities.count()`:

```js
{
  type: 'circle',                       // Optional: filter by ShapeType
  layer: 'layer-id',                    // Optional: filter by layer ID
  drawing: 'drawing-id',               // Optional: filter by drawing ID
  visible: true,                        // Optional: filter by visibility
  locked: false,                        // Optional: filter by lock state
  predicate: (shape) => shape.type === 'line'  // Optional: custom filter function
}
```

### CommandResult

Returned by `cad.commands.execute()`:

```js
{ success: true }
{ success: false, error: 'Unknown command: FOO' }
```

---

## Entities (Shapes)

Access via `cad.entities`.

### Create Shapes

All `add()` calls return the created shape object (including its generated `id`).

#### Line

```js
cad.entities.add('line', {
  start: { x: 0, y: 0 },
  end: { x: 200, y: 100 },
  style: { strokeColor: '#ffffff', strokeWidth: 2, lineStyle: 'solid' }  // optional
})
```

#### Circle

```js
cad.entities.add('circle', {
  center: { x: 100, y: 100 },
  radius: 50,
  style: { strokeColor: '#ff0000', strokeWidth: 1, lineStyle: 'solid' }
})
```

#### Rectangle

```js
cad.entities.add('rectangle', {
  position: { x: 50, y: 50 },  // top-left corner (also accepts 'topLeft')
  width: 200,
  height: 100,
  rotation: 0,  // optional, in radians
  style: { strokeColor: '#ffffff', strokeWidth: 1, lineStyle: 'solid' }
})
```

#### Arc

```js
cad.entities.add('arc', {
  center: { x: 100, y: 100 },
  radius: 60,
  startAngle: 0,        // radians
  endAngle: Math.PI / 2, // radians
  style: { strokeColor: '#ffffff', strokeWidth: 1, lineStyle: 'solid' }
})
```

#### Ellipse

```js
cad.entities.add('ellipse', {
  center: { x: 100, y: 100 },
  radiusX: 80,
  radiusY: 40,
  rotation: 0,  // optional, in radians
  style: { strokeColor: '#ffffff', strokeWidth: 1, lineStyle: 'solid' }
})
```

#### Polyline

```js
cad.entities.add('polyline', {
  points: [{ x: 0, y: 0 }, { x: 100, y: 50 }, { x: 200, y: 0 }],
  closed: false,  // optional, set true for polygon
  style: { strokeColor: '#ffffff', strokeWidth: 1, lineStyle: 'solid' }
})
```

#### Point

```js
cad.entities.add('point', {
  position: { x: 50, y: 50 },
  style: { strokeColor: '#ffffff', strokeWidth: 1, lineStyle: 'solid' }
})
```

#### Text

```js
cad.entities.add('text', {
  position: { x: 100, y: 100 },
  text: 'Hello World',
  fontSize: 16,                    // optional (default 12)
  fontFamily: 'Arial',            // optional (default 'Arial')
  rotation: 0,                     // optional, radians
  alignment: 'left',               // optional: 'left' | 'center' | 'right'
  verticalAlignment: 'top',        // optional: 'top' | 'middle' | 'bottom'
  bold: false,                     // optional
  italic: false,                   // optional
  underline: false,                // optional
  color: '#ffffff',                // optional, text color
  lineHeight: 1.2,                 // optional, multiplier
  fixedWidth: 200,                 // optional, wrap text at this width
})
```

#### Dimension

```js
cad.entities.add('dimension', {
  dimensionType: 'linear',                 // 'linear' | 'aligned' | 'angular' | 'radius' | 'diameter'
  points: [{ x: 0, y: 0 }, { x: 100, y: 0 }],  // varies by type (see below)
  dimensionLineOffset: 20,                 // distance from geometry to dimension line
  linearDirection: 'horizontal',           // for linear only: 'horizontal' | 'vertical'
  value: '',                               // empty = auto-calculated
  valueOverridden: false,
  prefix: '',                              // e.g. 'R' for radius
  suffix: 'mm',                            // e.g. 'mm'
  dimensionStyle: {                        // optional, uses defaults if omitted
    arrowType: 'filled',
    arrowSize: 3,
    extensionLineGap: 2,
    extensionLineOvershoot: 2,
    textHeight: 3,
    textPlacement: 'above',
    lineColor: '#00ffff',
    textColor: '#00ffff',
    precision: 2,
  },
})
```

**Dimension point patterns:**

| Type       | Points                                  |
|------------|-----------------------------------------|
| `linear`   | `[point1, point2]`                      |
| `aligned`  | `[point1, point2]`                      |
| `angular`  | `[vertex, point1, point2]`              |
| `radius`   | `[center, pointOnCircle]`               |
| `diameter` | `[center, pointOnCircle]`               |

#### Points as Arrays

All point parameters accept `[x, y]` arrays:

```js
cad.entities.add('line', {
  start: [0, 0],
  end: [200, 100]
})
```

### Bulk Create

Add multiple shapes in a single state update (faster than looping `add()`):

```js
cad.entities.addBulk([
  { type: 'line', params: { start: [0, 0], end: [100, 0] } },
  { type: 'circle', params: { center: [50, 50], radius: 25 } },
  { type: 'rectangle', params: { position: [10, 10], width: 80, height: 40 } },
])
// Returns: Shape[]
```

### Query Shapes

```js
cad.entities.count()                          // Total entity count
cad.entities.count({ type: 'circle' })        // Count with filter

cad.entities.list()                           // All shapes (returns Shape[])
cad.entities.list({ type: 'line' })           // Filter by type
cad.entities.list({ layer: 'layer-id' })      // Filter by layer
cad.entities.list({ drawing: 'drawing-id' })  // Filter by drawing
cad.entities.list({ visible: true })          // Filter by visibility
cad.entities.list({ locked: false })          // Filter by lock state
cad.entities.list({                           // Custom predicate
  predicate: s => s.type === 'circle' && s.radius > 50
})

cad.entities.get('shape-id')                  // Get by ID (returns Shape | undefined)
cad.entities.findAt({ x: 100, y: 100 })      // Hit-test at point (returns Shape | null)
cad.entities.findAt([100, 100], 5)            // With tolerance (default: auto)
cad.entities.findInBounds({                   // Find shapes in bounding box
  minX: 0, minY: 0, maxX: 500, maxY: 500
})
```

### Modify Shapes

```js
cad.entities.update('shape-id', {
  style: { strokeColor: '#ff0000', strokeWidth: 2 }
})

// Delete one
cad.entities.remove('shape-id')

// Delete multiple
cad.entities.remove(['id1', 'id2'])

// Bulk delete (single state update)
cad.entities.removeBulk(['id1', 'id2', 'id3'])

// Duplicate a shape (returns cloned Shape with new ID)
cad.entities.clone('shape-id')                  // offset: {x:20, y:20} default
cad.entities.clone('shape-id', { x: 50, y: 0 }) // custom offset
cad.entities.clone('shape-id', [50, 0])          // array form
```

### Transform Shapes

Apply geometric transformations to one or more shapes:

```js
// Translate (move)
cad.entities.transform(['id1', 'id2'], {
  translate: { x: 50, y: 100 }
})

// Rotate (angle in radians)
cad.entities.transform(['id1'], {
  rotate: { center: { x: 0, y: 0 }, angle: Math.PI / 4 }
})

// Scale (uniform)
cad.entities.transform(['id1'], {
  scale: { center: { x: 0, y: 0 }, factor: 2 }
})

// Mirror across a line defined by two points
cad.entities.transform(['id1'], {
  mirror: { p1: { x: 0, y: 0 }, p2: { x: 0, y: 100 } }
})

// Combined (all transforms applied in order)
cad.entities.transform(['id1'], {
  translate: [10, 0],
  rotate: { center: [50, 50], angle: 0.5 },
  scale: { center: [50, 50], factor: 1.5 }
})
```

---

## Selection

Access via `cad.selection`.

```js
cad.selection.get()                           // Get selected shape IDs (string[])
cad.selection.getEntities()                   // Get selected shape objects (Shape[])
cad.selection.set(['id1', 'id2'])             // Set selection (replaces current)
cad.selection.add(['id3'])                    // Add to existing selection
cad.selection.remove(['id1'])                 // Remove from selection
cad.selection.clear()                         // Deselect all
cad.selection.all()                           // Select all visible/unlocked shapes
cad.selection.count()                         // Count selected
cad.selection.filter(s => s.type === 'circle') // Filter selected shapes by predicate
```

---

## Layers

Access via `cad.layers`.

```js
// Create
cad.layers.create('My Layer')                 // Returns Layer object
cad.layers.create('Red Layer', {
  color: '#ff0000',
  visible: true,
  locked: false,
  lineStyle: 'solid',    // 'solid' | 'dashed' | 'dotted' | 'dashdot'
  lineWidth: 1
})

// Query
cad.layers.list()                             // All layers in active drawing
cad.layers.list('drawing-id')                 // Layers in specific drawing
cad.layers.get('layer-id')                    // Get by ID
cad.layers.getByName('My Layer')              // Find by name
cad.layers.getActive()                        // Get active layer

// Modify
cad.layers.setActive('layer-id')              // Set active layer
cad.layers.update('layer-id', {
  visible: false,
  color: '#00ff00',
  locked: true,
  name: 'Renamed Layer',
  lineStyle: 'dashed',
  lineWidth: 2
})
cad.layers.remove('layer-id')                 // Delete layer (can't delete last one)
```

### Layer Object

```js
{
  id: 'layer-abc123',
  name: 'Layer 0',
  drawingId: 'drawing-1',
  visible: true,
  locked: false,
  color: '#ffffff',
  lineStyle: 'solid',
  lineWidth: 1
}
```

---

## Viewport (Pan & Zoom)

Access via `cad.viewport`.

```js
// Read
cad.viewport.get()                            // { offsetX, offsetY, zoom }
cad.viewport.canvasSize                       // { width, height } (read-only)

// Set directly
cad.viewport.set({ zoom: 1.5 })              // Merge with current viewport
cad.viewport.set({ offsetX: 100, offsetY: 200, zoom: 2 })
cad.viewport.setZoom(1.5)                     // Set exact zoom level

// Pan
cad.viewport.pan(100, 0)                      // Pan by dx, dy in screen pixels

// Zoom
cad.viewport.zoomIn()                         // Zoom in ~20%
cad.viewport.zoomOut()                        // Zoom out ~20%
cad.viewport.zoomToFit()                      // Fit all content in view
cad.viewport.zoomToEntities(['id1', 'id2'])   // Zoom to specific shapes

// Reset
cad.viewport.reset()                          // Reset to 1:1 at origin

// Coordinate conversion
cad.viewport.screenToWorld({ x: 400, y: 300 }) // Screen pixels → drawing units
cad.viewport.worldToScreen({ x: 100, y: 100 }) // Drawing units → screen pixels
cad.viewport.screenToWorld([400, 300])          // Array form
```

---

## Document (Drawings & Sheets)

Access via `cad.document`.

### Mode

```js
cad.document.mode                              // 'drawing' or 'sheet'
cad.document.switchMode('drawing')
cad.document.switchMode('sheet')               // Switches to active or first sheet
```

### Drawings

Access via `cad.document.drawings`.

```js
cad.document.drawings.list()                   // All drawings (Drawing[])
cad.document.drawings.create('Floor Plan')     // Create and switch to new drawing
cad.document.drawings.getActive()              // Get active drawing
cad.document.drawings.switchTo('drawing-id')   // Switch active drawing
cad.document.drawings.rename('id', 'New Name')
cad.document.drawings.remove('id')             // Can't delete the last drawing

// Drawing boundary (model space limits)
cad.document.drawings.getBoundary('id')        // { x, y, width, height }
cad.document.drawings.setBoundary('id', {
  x: -500, y: -500, width: 1000, height: 1000
})
cad.document.drawings.fitBoundary('id')        // Auto-fit boundary to content
```

#### Drawing Object

```js
{
  id: 'drawing-1',
  name: 'Drawing 1',
  boundary: { x: -500, y: -500, width: 1000, height: 1000 },
  createdAt: '2025-01-01T00:00:00.000Z',
  modifiedAt: '2025-01-01T00:00:00.000Z'
}
```

### Sheets

Access via `cad.document.sheets`.

```js
cad.document.sheets.list()                     // All sheets (Sheet[])
cad.document.sheets.create('Sheet 1')          // Create with defaults (A4 landscape)
cad.document.sheets.create('Sheet 1', {
  paperSize: 'A3',                             // 'A4'|'A3'|'A2'|'A1'|'A0'|'Letter'|'Legal'|'Tabloid'|'Custom'
  orientation: 'landscape'                     // 'portrait' | 'landscape'
})
cad.document.sheets.getActive()                // Get active sheet
cad.document.sheets.switchTo('sheet-id')       // Switch to sheet (enters sheet mode)
cad.document.sheets.rename('id', 'Cover Sheet')
cad.document.sheets.remove('id')
```

### Sheet Viewports

Access via `cad.document.viewports`. Sheet viewports display drawings inside sheets (paper space).

```js
// List viewports in a sheet
cad.document.viewports.list('sheet-id')        // SheetViewport[]

// Add a viewport showing a drawing inside a sheet
cad.document.viewports.add('sheet-id', 'drawing-id')  // Default bounds
cad.document.viewports.add('sheet-id', 'drawing-id', {
  x: 100, y: 100, width: 400, height: 300
})

// Update viewport properties
cad.document.viewports.update('viewport-id', {
  x: 50, y: 50,
  width: 500, height: 400,
  scale: 0.01,          // Scale factor (0.01 = 1:100)
  centerX: 0,           // Center point in drawing coordinates
  centerY: 0,
  locked: true,          // Lock viewport from editing
  visible: true
})

// Center viewport on its drawing's boundary center
cad.document.viewports.center('viewport-id')

// Auto-fit: set scale and center to show entire drawing
cad.document.viewports.fitToDrawing('viewport-id')

// Remove viewport
cad.document.viewports.remove('viewport-id')
```

#### SheetViewport Object

```js
{
  id: 'viewport-abc',
  drawingId: 'drawing-1',
  x: 100, y: 100,
  width: 400, height: 300,
  centerX: 0, centerY: 0,
  scale: 0.01,
  locked: false,
  visible: true
}
```

---

## Commands (Modify Operations)

Access via `cad.commands`. Commands wrap shape modifications in transactions automatically (single undo step).

### Execute Commands

Returns `{ success: true }` or `{ success: false, error: '...' }`.

```js
// Move shapes
cad.commands.execute('MOVE', {
  ids: ['id1', 'id2'],
  from: { x: 0, y: 0 },
  to: { x: 100, y: 50 }
})

// Copy shapes
cad.commands.execute('COPY', {
  ids: ['id1'],
  from: { x: 0, y: 0 },
  to: { x: 200, y: 0 }
})

// Rotate shapes (angle in degrees)
cad.commands.execute('ROTATE', {
  ids: ['id1'],
  center: { x: 100, y: 100 },
  angle: 45
})

// Scale shapes
cad.commands.execute('SCALE', {
  ids: ['id1'],
  base: { x: 0, y: 0 },
  factor: 2
})

// Mirror shapes across a line
cad.commands.execute('MIRROR', {
  ids: ['id1'],
  p1: { x: 0, y: 0 },
  p2: { x: 0, y: 100 }
})

// Delete shapes
cad.commands.execute('ERASE', { ids: ['id1', 'id2'] })

// Offset (clones shape; for circles, increases radius)
cad.commands.execute('OFFSET', { ids: ['id1'], distance: 10 })
```

> **Note**: `FILLET` and `CHAMFER` commands are registered but not yet fully implemented.

### Query Commands

```js
cad.commands.list()          // ['MOVE','COPY','ROTATE','SCALE','MIRROR','ERASE','OFFSET','FILLET','CHAMFER']
cad.commands.isActive()      // Is an interactive command in progress?
cad.commands.cancel()        // Cancel active interactive command
```

---

## Dimensions

Access via `cad.dimensions`. Convenience methods that create dimension shapes.

```js
// Linear dimension (horizontal/vertical)
cad.dimensions.addLinear({ x: 0, y: 0 }, { x: 100, y: 0 })          // offset = 20 default
cad.dimensions.addLinear({ x: 0, y: 0 }, { x: 100, y: 0 }, 30)      // custom offset

// Aligned dimension (follows line between points)
cad.dimensions.addAligned({ x: 0, y: 0 }, { x: 100, y: 50 })
cad.dimensions.addAligned({ x: 0, y: 0 }, { x: 100, y: 50 }, 25)

// Angular dimension
cad.dimensions.addAngular(
  { x: 50, y: 50 },   // vertex
  { x: 100, y: 50 },  // point 1
  { x: 50, y: 100 }   // point 2
)
cad.dimensions.addAngular(vertex, p1, p2, 40)  // custom offset

// Radius dimension (adds 'R' prefix)
cad.dimensions.addRadius(
  { x: 100, y: 100 },  // center
  { x: 150, y: 100 }   // point on circle
)

// Diameter dimension (adds '⌀' prefix)
cad.dimensions.addDiameter(
  { x: 100, y: 100 },  // center
  { x: 150, y: 100 }   // point on circle
)

// Get default dimension style
cad.dimensions.getStyle()
// Returns DimensionStyle object (see Type Reference)

// Set default dimension style (note: style is per-shape, use entities.update() for existing)
cad.dimensions.setStyle({ precision: 3, arrowType: 'open' })
```

---

## Snap & Grid

### Snap

Access via `cad.snap`.

```js
// Enable/disable
cad.snap.enabled                                // true/false (read-only getter)
cad.snap.setEnabled(true)

// Snap types
cad.snap.getTypes()                             // Active snap types (SnapType[])
cad.snap.setTypes(['endpoint', 'midpoint', 'center', 'intersection'])

// Tolerance (pixels)
cad.snap.tolerance                              // Current tolerance (read-only getter)
cad.snap.setTolerance(10)

// Ortho mode (constrain to 0/90 degrees)
cad.snap.orthoMode                              // true/false (read-only getter)
cad.snap.setOrthoMode(true)

// Polar tracking
cad.snap.polarTracking                          // true/false (read-only getter)
cad.snap.setPolarTracking(true)
cad.snap.polarAngle                             // Current angle increment in degrees (read-only)
cad.snap.setPolarAngle(45)                      // Set polar angle increment (degrees)
```

#### Available Snap Types

```
'grid' | 'endpoint' | 'midpoint' | 'center' | 'intersection' | 'perpendicular' | 'tangent' | 'nearest'
```

### Grid

Access via `cad.grid`.

```js
cad.grid.visible                                // true/false (read-only getter)
cad.grid.setVisible(true)

cad.grid.size                                   // Current grid spacing (read-only getter)
cad.grid.setSize(25)                            // Set grid spacing in drawing units
```

---

## Styles

Access via `cad.styles`. Controls the default style applied to newly created shapes.

```js
// Get current drawing style
cad.styles.getCurrent()
// { strokeColor: '#ffffff', strokeWidth: 1, lineStyle: 'solid' }

// Set current drawing style (merged with existing)
cad.styles.setCurrent({
  strokeColor: '#ff0000',
  strokeWidth: 2,
  lineStyle: 'dashed'
})

// Get default text style
cad.styles.getTextDefaults()
// { fontSize: 12, fontFamily: 'Arial', ... }

// Set default text style (merged with existing)
cad.styles.setTextDefaults({
  fontSize: 14,
  fontFamily: 'Courier',
  bold: true
})
```

---

## Tools

Access via `cad.tools`. Controls the active drawing/interaction tool.

```js
cad.tools.getActive()                           // Current tool (ToolType)
cad.tools.setActive('line')                     // Switch tool (cancels active command)
cad.tools.setActive('select')

// Tool drawing modes
cad.tools.getMode('circle')                     // e.g., 'center-radius'
cad.tools.setMode('circle', 'center-radius')

cad.tools.getMode('rectangle')
cad.tools.setMode('rectangle', 'corner')

cad.tools.getMode('arc')
cad.tools.setMode('arc', 'three-point')

cad.tools.getMode('ellipse')
cad.tools.setMode('ellipse', 'center')

cad.tools.getMode('dimension')
cad.tools.setMode('dimension', 'linear')
```

---

## Application (File I/O)

Access via `cad.app`.

```js
// Project info
cad.app.projectName                             // Current project name (read-only getter)
cad.app.filePath                                // Current file path or null (read-only getter)
cad.app.isModified                              // Has unsaved changes (read-only getter)
cad.app.setProjectName('My Project')

// New project (clears everything)
cad.app.newProject()

// Open file (shows dialog if no path given)
await cad.app.open()                            // Opens file dialog
await cad.app.open('C:/path/to/file.o2d')       // Open specific file

// Save (shows dialog if no current path)
await cad.app.save()                            // Save to current path or show dialog
await cad.app.save('C:/path/to/file.o2d')       // Save to specific path

// Export
await cad.app.exportSVG()                       // Shows dialog
await cad.app.exportSVG('C:/path/to/file.svg')  // Export to specific path
await cad.app.exportDXF()
await cad.app.exportDXF('C:/path/to/file.dxf')
await cad.app.exportJSON()
await cad.app.exportJSON('C:/path/to/file.json')

// Print (opens print dialog)
cad.app.print()
```

> **Note**: `open()`, `save()`, and all export methods are `async` -- use `await` or `.then()`.

---

## Undo / Redo

Convenience methods on the top-level `cad` object.

```js
cad.undo()    // Returns true if undo was performed
cad.redo()    // Returns true if redo was performed
```

All shape mutations (`entities.add`, `entities.update`, `entities.remove`, `commands.execute`, etc.) automatically push to undo history.

---

## Transactions (Batch Operations)

Group multiple operations into a single undo step and suppress rendering until commit.

### Simple Usage

```js
cad.transaction('draw grid', () => {
  for (let i = 0; i < 10; i++) {
    cad.entities.add('line', {
      start: { x: 0, y: i * 20 },
      end: { x: 200, y: i * 20 }
    })
  }
})
// cad.undo() now removes all 10 lines at once
```

### Return Values

```js
const shapes = cad.transaction('create shapes', () => {
  const a = cad.entities.add('circle', { center: [0,0], radius: 50 })
  const b = cad.entities.add('circle', { center: [100,0], radius: 50 })
  return [a, b]
})
// shapes = [Shape, Shape]
```

### Error Handling

If the function throws, the transaction is automatically rolled back (all changes undone):

```js
try {
  cad.transaction('risky operation', () => {
    cad.entities.add('circle', { center: [0,0], radius: 50 })
    throw new Error('Something went wrong')
    // The circle is automatically removed via rollback
  })
} catch (e) {
  console.error(e)
}
```

### Advanced Transaction Control

Access via `cad.transactions`:

```js
cad.transactions.isActive        // Is a transaction currently open?
cad.transactions.renderSuppressed // Is rendering suppressed?

cad.transactions.begin('my-op')  // Start transaction manually
// ... do work ...
cad.transactions.commit()        // Commit (collapses history entries into one)
cad.transactions.rollback()      // Or rollback (undoes all changes)
```

> **Warning**: Nested transactions are not supported. Calling `begin()` while a transaction is active will throw.

---

## Events

Access via `cad.events`. Subscribe to state changes using a pub/sub event bus.

### Subscribe

```js
// Subscribe (returns unsubscribe function)
const unsub = cad.events.on('entity:added', (data) => {
  console.log('Added:', data.entity)
})

// Unsubscribe
unsub()

// Or manually
cad.events.off('entity:added', myHandler)

// One-time listener
cad.events.once('entity:added', (data) => {
  console.log('First entity added:', data.entity)
})
```

### Available Events

| Event | Data | Description |
|-------|------|-------------|
| `entity:added` | `{ entity: Shape }` | Shape created |
| `entity:modified` | `{ entity: Shape }` | Shape properties changed |
| `entity:removed` | `{ entity: Shape }` | Shape deleted |
| `selection:changed` | `{ ids: string[] }` | Selection modified |
| `selection:cleared` | `{}` | All shapes deselected |
| `layer:added` | `{ layer: Layer }` | Layer created |
| `layer:removed` | `{ layer: Layer }` | Layer deleted |
| `layer:changed` | `{ layer: Layer }` | Layer properties changed |
| `layer:activeChanged` | `{ id: string }` | Active layer switched |
| `viewport:changed` | `{ offsetX, offsetY, zoom }` | Viewport transformed |
| `tool:changed` | `{ tool: ToolType }` | Active tool changed |
| `command:started` | `{ name: string, params: object }` | Command execution started |
| `command:completed` | `{ name: string, params: object }` | Command execution finished |
| `command:cancelled` | `{ name: string, error?: string }` | Command cancelled/failed |
| `transaction:started` | `{ name: string }` | Transaction opened |
| `transaction:committed` | `{ name: string }` | Transaction committed |
| `transaction:rolledBack` | `{ name: string }` | Transaction rolled back |
| `undo` | `{}` | Undo executed |
| `redo` | `{}` | Redo executed |
| `document:saved` | `{ path: string }` | Document saved to file |
| `document:loaded` | `{ path: string }` | Document loaded from file |
| `document:newProject` | `{}` | New empty project created |
| `drawing:created` | `{ drawing: Drawing }` | New drawing added |
| `drawing:removed` | `{ drawing: Drawing }` | Drawing deleted |
| `drawing:switched` | `{ id: string }` | Active drawing changed |
| `sheet:created` | `{ sheet: Sheet }` | New sheet added |
| `sheet:removed` | `{ sheet: Sheet }` | Sheet deleted |
| `sheet:switched` | `{ id: string }` | Active sheet changed |
| `mode:changed` | `{ mode: EditorMode }` | Editor mode changed |

---

## Macros (Record & Replay)

Record user actions and replay them programmatically.

```js
// Start recording
cad.startRecording()

// Perform actions normally...
cad.entities.add('line', { start: [0, 0], end: [100, 0] })
cad.entities.add('circle', { center: [50, 50], radius: 25 })

// Stop recording — returns JS source code
const macro = cad.stopRecording()
console.log(macro)
// cad.entities.add('line', {"start":{"x":0,"y":0},"end":{"x":100,"y":0}});
// cad.entities.add('circle', {"center":{"x":50,"y":50},"radius":25});

// Replay the recorded macro
cad.runMacro(macro)
```

**What gets recorded:**

- Entity additions (`entity:added`)
- Entity removals (`entity:removed`)
- Command executions (`command:completed`)
- Selection changes (`selection:changed`)
- Viewport changes (`viewport:changed`)
- Tool changes (`tool:changed`)

---

## Annotations (Sheet Mode)

Access via `cad.annotations`. Annotations are placed on sheets (paper space), not on drawings.

```js
// Add text annotation to a sheet
cad.annotations.addText('sheet-id', { x: 100, y: 50 }, 'Note: Check dimensions')
cad.annotations.addText('sheet-id', [100, 50], 'Note text', {
  fontSize: 14,
  fontFamily: 'Arial',
  color: '#ff0000',
  bold: true
})

// Add leader annotation (arrow with text)
cad.annotations.addLeader(
  'sheet-id',
  [{ x: 200, y: 200 }, { x: 250, y: 150 }],  // Leader points (arrow path)
  'See detail A',
  { /* optional SheetLeaderAnnotation overrides */ }
)

// Add revision cloud
cad.annotations.addRevisionCloud(
  'sheet-id',
  [{ x: 100, y: 100 }, { x: 300, y: 100 }, { x: 300, y: 300 }, { x: 100, y: 300 }],
  { revisionNumber: 'A' }
)

// Query
cad.annotations.list('sheet-id')               // All annotations on a sheet
cad.annotations.list()                         // Annotations on the active sheet
cad.annotations.get('annotation-id')           // Get by ID

// Modify
cad.annotations.update('annotation-id', {
  text: 'Updated text',
  fontSize: 16
})
cad.annotations.remove('annotation-id')

// Selection
cad.annotations.select(['ann-id-1', 'ann-id-2'])
cad.annotations.deselectAll()
```

---

## Complete Examples

### Draw a House (via HTTP)

```bash
API="http://127.0.0.1:49100/eval"

# Walls
curl -s -X POST $API -H "Content-Type: application/json" \
  -d '{"script":"cad.entities.add(\"rectangle\", {position:{x:0,y:0}, width:200, height:150})"}'

# Roof
curl -s -X POST $API -H "Content-Type: application/json" \
  -d '{"script":"cad.entities.add(\"polyline\", {points:[{x:-10,y:0},{x:100,y:-80},{x:210,y:0}], closed:true})"}'

# Door
curl -s -X POST $API -H "Content-Type: application/json" \
  -d '{"script":"cad.entities.add(\"rectangle\", {position:{x:70,y:50}, width:60, height:100})"}'

# Windows
curl -s -X POST $API -H "Content-Type: application/json" \
  -d '{"script":"cad.entities.add(\"rectangle\", {position:{x:15,y:20}, width:40, height:40})"}'
curl -s -X POST $API -H "Content-Type: application/json" \
  -d '{"script":"cad.entities.add(\"rectangle\", {position:{x:145,y:20}, width:40, height:40})"}'

# Zoom to fit
curl -s -X POST $API -H "Content-Type: application/json" \
  -d '{"script":"cad.viewport.zoomToFit(); return cad.entities.count()"}'
```

### Draw a House (Browser Console)

```js
cad.entities.add('rectangle', { position: {x:0,y:0}, width: 200, height: 150 })
cad.entities.add('polyline', {
  points: [{x:-10,y:0}, {x:100,y:-80}, {x:210,y:0}],
  closed: true
})
cad.entities.add('rectangle', { position: {x:70,y:50}, width: 60, height: 100 })
cad.entities.add('rectangle', { position: {x:15,y:20}, width: 40, height: 40 })
cad.entities.add('rectangle', { position: {x:145,y:20}, width: 40, height: 40 })
cad.viewport.zoomToFit()
```

### Python Script

```python
import requests
import json

API = "http://127.0.0.1:49100"

def eval_cad(script):
    r = requests.post(f"{API}/eval", json={"script": script})
    return r.json()

# Check connection
print(requests.get(f"{API}/health").json())

# Draw shapes
eval_cad('cad.entities.add("circle", {center:{x:0,y:0}, radius:100})')
eval_cad('cad.entities.add("line", {start:{x:-100,y:0}, end:{x:100,y:0}})')
eval_cad('cad.entities.add("line", {start:{x:0,y:-100}, end:{x:0,y:100}})')

# Query
result = eval_cad('return cad.entities.count()')
print(f"Entities: {result['result']}")

# Zoom to fit
eval_cad('cad.viewport.zoomToFit()')
```

### Node.js Script

```js
const API = 'http://127.0.0.1:49100';

async function evalCad(script) {
  const res = await fetch(`${API}/eval`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ script })
  });
  return res.json();
}

// Draw a grid
for (let i = 0; i <= 10; i++) {
  await evalCad(`cad.entities.add("line", {start:{x:${i*20},y:0}, end:{x:${i*20},y:200}})`);
  await evalCad(`cad.entities.add("line", {start:{x:0,y:${i*20}}, end:{x:200,y:${i*20}}})`);
}

await evalCad('cad.viewport.zoomToFit()');
console.log(await evalCad('return cad.entities.count()'));
```

### Batch with Transaction

```js
// All 100 shapes become a single undo step
cad.transaction('draw sunburst', () => {
  for (let i = 0; i < 100; i++) {
    const angle = (i / 100) * 2 * Math.PI;
    cad.entities.add('line', {
      start: { x: 500, y: 500 },
      end: { x: 500 + 400 * Math.cos(angle), y: 500 + 400 * Math.sin(angle) },
      style: { strokeColor: '#ffaa00', strokeWidth: 0.5, lineStyle: 'solid' }
    });
  }
});
cad.viewport.zoomToFit();
```

---

## Notes

- The API server only listens on `127.0.0.1` (localhost) for security
- Scripts have a **30-second timeout** via the HTTP eval endpoint
- All shape mutations automatically push to the undo history
- Use `cad.transaction(name, fn)` to group operations into a single undo step
- The `return` keyword sends values back through the HTTP eval response
- All point parameters accept both `{x, y}` objects and `[x, y]` arrays
- Discovery files are cleaned up when the app closes
- Shapes created via the API inherit the active layer and active drawing automatically
- The `style` parameter on `add()` is optional -- defaults to the current drawing style
