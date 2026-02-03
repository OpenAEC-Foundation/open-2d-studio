/**
 * File Service - Handles file operations (New, Open, Save, Export)
 */

import { open, save, message, ask } from '@tauri-apps/plugin-dialog';
import { readTextFile, writeTextFile } from '@tauri-apps/plugin-fs';
import type { Shape, ShapeStyle, LineStyle, Layer, Drawing, Sheet, Viewport, DrawingBoundary, PolylineShape } from '../types/geometry';
import { splineToSvgPath } from '../engine/geometry/SplineUtils';
import { bulgeToArc, bulgeArcBounds } from '../engine/geometry/GeometryUtils';
export { exportToIFC } from './ifcExport';

// File format version for future compatibility
const FILE_FORMAT_VERSION = 2;

// Default drawing boundary (in drawing units)
const DEFAULT_DRAWING_BOUNDARY: DrawingBoundary = {
  x: -500,
  y: -500,
  width: 1000,
  height: 1000,
};

// Default drawing scale (1:50)
const DEFAULT_DRAWING_SCALE = 0.02;

// File extension for project files
export const PROJECT_EXTENSION = 'o2d';
export const PROJECT_FILTER = {
  name: 'Open 2D Studio Project',
  extensions: [PROJECT_EXTENSION],
};

// Export formats
export const EXPORT_FILTERS = {
  svg: { name: 'SVG Vector Image', extensions: ['svg'] },
  dxf: { name: 'DXF', extensions: ['dxf'] },
  ifc: { name: 'IFC4 (Industry Foundation Classes)', extensions: ['ifc'] },
  json: { name: 'JSON Data', extensions: ['json'] },
};

/**
 * Project file structure V1 (legacy)
 */
export interface ProjectFileV1 {
  version: 1;
  name: string;
  createdAt: string;
  modifiedAt: string;
  shapes: Shape[];
  layers: Layer[];
  activeLayerId: string;
  viewport: {
    zoom: number;
    offsetX: number;
    offsetY: number;
  };
  settings: {
    gridSize: number;
    gridVisible: boolean;
    snapEnabled: boolean;
  };
}

/**
 * Project file structure V2 (with Drawings & Sheets)
 * Note: File format uses "draft" naming for backward compatibility
 * but internal code uses "drawing" naming
 */
export interface ProjectFileV2 {
  version: 2;
  name: string;
  createdAt: string;
  modifiedAt: string;
  // Drawings & Sheets (file format uses "drafts" for backward compatibility)
  drafts?: Drawing[];
  drawings?: Drawing[];  // New name, supported for reading
  sheets: Sheet[];
  activeDraftId?: string;
  activeDrawingId?: string;  // New name, supported for reading
  activeSheetId: string | null;
  draftViewports?: Record<string, Viewport>;
  drawingViewports?: Record<string, Viewport>;  // New name, supported for reading
  sheetViewports?: Record<string, Viewport>;  // Per-sheet pan/zoom state
  // Shapes & Layers (now with drawingId)
  shapes: Shape[];
  layers: Layer[];
  activeLayerId: string;
  // Settings
  settings: {
    gridSize: number;
    gridVisible: boolean;
    snapEnabled: boolean;
  };
  // Print presets (optional)
  savedPrintPresets?: Record<string, import('../state/slices/uiSlice').PrintSettings>;
}

// Current project file type
export type ProjectFile = ProjectFileV2;

/**
 * Generate a unique ID
 */
function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Migrate V1 project to V2 format
 */
function migrateV1ToV2(v1: ProjectFileV1): ProjectFileV2 {
  const drawingId = generateId();
  const now = new Date().toISOString();

  // Add drawingId to all shapes
  const migratedShapes = v1.shapes.map(shape => ({
    ...shape,
    drawingId,
  }));

  // Add drawingId to all layers
  const migratedLayers = v1.layers.map(layer => ({
    ...layer,
    drawingId,
  }));

  return {
    version: 2,
    name: v1.name,
    createdAt: v1.createdAt,
    modifiedAt: now,
    drawings: [{
      id: drawingId,
      name: 'Drawing 1',
      boundary: { ...DEFAULT_DRAWING_BOUNDARY },
      scale: DEFAULT_DRAWING_SCALE,
      createdAt: v1.createdAt,
      modifiedAt: now,
    }],
    sheets: [],
    activeDrawingId: drawingId,
    activeSheetId: null,
    drawingViewports: {
      [drawingId]: v1.viewport,
    },
    sheetViewports: {},
    shapes: migratedShapes,
    layers: migratedLayers,
    activeLayerId: v1.activeLayerId,
    settings: v1.settings,
  };
}

/**
 * Create a new empty project data structure
 */
export function createNewProject(): ProjectFile {
  const now = new Date().toISOString();
  const drawingId = generateId();
  const layerId = generateId();

  return {
    version: FILE_FORMAT_VERSION as 2,
    name: 'Untitled',
    createdAt: now,
    modifiedAt: now,
    drawings: [{
      id: drawingId,
      name: 'Drawing 1',
      boundary: { ...DEFAULT_DRAWING_BOUNDARY },
      scale: DEFAULT_DRAWING_SCALE,
      createdAt: now,
      modifiedAt: now,
    }],
    sheets: [],
    activeDrawingId: drawingId,
    activeSheetId: null,
    drawingViewports: {
      [drawingId]: { zoom: 1, offsetX: 0, offsetY: 0 },
    },
    sheetViewports: {},
    shapes: [],
    layers: [
      {
        id: layerId,
        name: 'Layer 0',
        drawingId,
        visible: true,
        locked: false,
        color: '#ffffff',
        lineStyle: 'solid',
        lineWidth: 1,
      },
    ],
    activeLayerId: layerId,
    settings: {
      gridSize: 10,
      gridVisible: true,
      snapEnabled: true,
    },
  };
}

/**
 * Show open file dialog and return selected path
 */
export async function showOpenDialog(): Promise<string | null> {
  const result = await open({
    multiple: false,
    filters: [PROJECT_FILTER],
    title: 'Open Project',
  });

  return result as string | null;
}

/**
 * Show save file dialog and return selected path
 */
export async function showSaveDialog(defaultName?: string): Promise<string | null> {
  const result = await save({
    filters: [PROJECT_FILTER],
    title: 'Save Project',
    defaultPath: defaultName ? `${defaultName}.${PROJECT_EXTENSION}` : undefined,
  });

  return result;
}

/**
 * Show export file dialog
 */
export async function showExportDialog(
  format: keyof typeof EXPORT_FILTERS,
  defaultName?: string
): Promise<string | null> {
  const filter = EXPORT_FILTERS[format];
  const result = await save({
    filters: [filter],
    title: `Export as ${filter.name}`,
    defaultPath: defaultName ? `${defaultName}.${filter.extensions[0]}` : undefined,
  });

  return result;
}

/**
 * Show export dialog with all supported formats
 */
export async function showExportAllFormatsDialog(
  defaultName?: string
): Promise<string | null> {
  const allFilters = Object.values(EXPORT_FILTERS);
  const result = await save({
    filters: allFilters,
    title: 'Export Drawing',
    defaultPath: defaultName ? `${defaultName}.svg` : undefined,
  });
  return result;
}

/**
 * Read project file from disk
 */
export async function readProjectFile(path: string): Promise<ProjectFile> {
  const content = await readTextFile(path);
  const data = JSON.parse(content) as ProjectFileV1 | ProjectFileV2;

  // Validate file format version
  if (!data.version || data.version > FILE_FORMAT_VERSION) {
    throw new Error(`Unsupported file format version: ${data.version}`);
  }

  // Migrate V1 files to V2
  if (data.version === 1) {
    return migrateV1ToV2(data as ProjectFileV1);
  }

  return data as ProjectFileV2;
}

/**
 * Write project file to disk
 */
export async function writeProjectFile(path: string, project: ProjectFile): Promise<void> {
  project.modifiedAt = new Date().toISOString();
  const content = JSON.stringify(project, null, 2);
  await writeTextFile(path, content);
}

/**
 * Export shapes to SVG format
 */
export function exportToSVG(shapes: Shape[], width: number = 800, height: number = 600): string {
  // Calculate bounds
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

  for (const shape of shapes) {
    const bounds = getShapeBounds(shape);
    if (bounds) {
      minX = Math.min(minX, bounds.minX);
      minY = Math.min(minY, bounds.minY);
      maxX = Math.max(maxX, bounds.maxX);
      maxY = Math.max(maxY, bounds.maxY);
    }
  }

  // Add padding
  const padding = 20;
  minX -= padding;
  minY -= padding;
  maxX += padding;
  maxY += padding;

  const viewBox = `${minX} ${minY} ${maxX - minX} ${maxY - minY}`;

  let svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" width="${width}" height="${height}">
  <style>
    .shape { fill: none; stroke-linecap: round; stroke-linejoin: round; }
  </style>
`;

  for (const shape of shapes) {
    svg += shapeToSVG(shape);
  }

  svg += '</svg>';
  return svg;
}

/**
 * Convert a shape to SVG element
 */
function shapeToSVG(shape: Shape): string {
  const { style } = shape;
  const stroke = style.strokeColor;
  const strokeWidth = style.strokeWidth;
  const fill = style.fillColor || 'none';
  const dashArray = style.lineStyle === 'dashed' ? '10,5' :
                    style.lineStyle === 'dotted' ? '2,3' :
                    style.lineStyle === 'dashdot' ? '10,3,2,3' : '';

  const baseAttrs = `class="shape" stroke="${stroke}" stroke-width="${strokeWidth}" fill="${fill}"${dashArray ? ` stroke-dasharray="${dashArray}"` : ''}`;

  switch (shape.type) {
    case 'line':
      return `  <line ${baseAttrs} x1="${shape.start.x}" y1="${shape.start.y}" x2="${shape.end.x}" y2="${shape.end.y}" />\n`;

    case 'rectangle':
      return `  <rect ${baseAttrs} x="${shape.topLeft.x}" y="${shape.topLeft.y}" width="${shape.width}" height="${shape.height}"${shape.rotation ? ` transform="rotate(${shape.rotation * 180 / Math.PI} ${shape.topLeft.x + shape.width/2} ${shape.topLeft.y + shape.height/2})"` : ''} />\n`;

    case 'circle':
      return `  <circle ${baseAttrs} cx="${shape.center.x}" cy="${shape.center.y}" r="${shape.radius}" />\n`;

    case 'ellipse':
      return `  <ellipse ${baseAttrs} cx="${shape.center.x}" cy="${shape.center.y}" rx="${shape.radiusX}" ry="${shape.radiusY}"${shape.rotation ? ` transform="rotate(${shape.rotation * 180 / Math.PI} ${shape.center.x} ${shape.center.y})"` : ''} />\n`;

    case 'arc':
      const startX = shape.center.x + shape.radius * Math.cos(shape.startAngle);
      const startY = shape.center.y + shape.radius * Math.sin(shape.startAngle);
      const endX = shape.center.x + shape.radius * Math.cos(shape.endAngle);
      const endY = shape.center.y + shape.radius * Math.sin(shape.endAngle);
      const largeArc = Math.abs(shape.endAngle - shape.startAngle) > Math.PI ? 1 : 0;
      return `  <path ${baseAttrs} d="M ${startX} ${startY} A ${shape.radius} ${shape.radius} 0 ${largeArc} 1 ${endX} ${endY}" />\n`;

    case 'polyline': {
      const polyShape = shape as PolylineShape;
      const hasBulge = polyShape.bulge?.some(b => b !== 0);
      if (hasBulge) {
        let d = `M ${polyShape.points[0].x} ${polyShape.points[0].y}`;
        for (let idx = 0; idx < polyShape.points.length - 1; idx++) {
          const b = polyShape.bulge?.[idx] ?? 0;
          if (b !== 0) {
            const arc = bulgeToArc(polyShape.points[idx], polyShape.points[idx + 1], b);
            let sweep = arc.clockwise
              ? arc.startAngle - arc.endAngle
              : arc.endAngle - arc.startAngle;
            if (sweep < 0) sweep += 2 * Math.PI;
            const largeArc = sweep > Math.PI ? 1 : 0;
            const sweepFlag = arc.clockwise ? 0 : 1;
            const p2 = polyShape.points[idx + 1];
            d += ` A ${arc.radius} ${arc.radius} 0 ${largeArc} ${sweepFlag} ${p2.x} ${p2.y}`;
          } else {
            d += ` L ${polyShape.points[idx + 1].x} ${polyShape.points[idx + 1].y}`;
          }
        }
        if (polyShape.closed) {
          const closingB = polyShape.bulge?.[polyShape.points.length - 1] ?? 0;
          if (closingB !== 0) {
            const arc = bulgeToArc(polyShape.points[polyShape.points.length - 1], polyShape.points[0], closingB);
            let sweep = arc.clockwise
              ? arc.startAngle - arc.endAngle
              : arc.endAngle - arc.startAngle;
            if (sweep < 0) sweep += 2 * Math.PI;
            const largeArc = sweep > Math.PI ? 1 : 0;
            const sweepFlag = arc.clockwise ? 0 : 1;
            d += ` A ${arc.radius} ${arc.radius} 0 ${largeArc} ${sweepFlag} ${polyShape.points[0].x} ${polyShape.points[0].y}`;
          }
          d += ' Z';
        }
        return `  <path ${baseAttrs} d="${d}" />\n`;
      }
      const points = polyShape.points.map(p => `${p.x},${p.y}`).join(' ');
      if (polyShape.closed) {
        return `  <polygon ${baseAttrs} points="${points}" />\n`;
      }
      return `  <polyline ${baseAttrs} points="${points}" />\n`;
    }

    case 'spline':
      if (shape.points.length < 2) return '';
      return `  <path ${baseAttrs} d="${splineToSvgPath(shape.points)}${shape.closed ? ' Z' : ''}" />\n`;

    default:
      return '';
  }
}

/**
 * Export shapes to DXF format (basic implementation)
 */
export function exportToDXF(shapes: Shape[]): string {
  let dxf = `0
SECTION
2
ENTITIES
`;

  for (const shape of shapes) {
    dxf += shapeToDXF(shape);
  }

  dxf += `0
ENDSEC
0
EOF
`;
  return dxf;
}

/**
 * Convert a shape to DXF entity
 */
function shapeToDXF(shape: Shape): string {
  switch (shape.type) {
    case 'line':
      return `0
LINE
8
0
10
${shape.start.x}
20
${shape.start.y}
11
${shape.end.x}
21
${shape.end.y}
`;

    case 'circle':
      return `0
CIRCLE
8
0
10
${shape.center.x}
20
${shape.center.y}
40
${shape.radius}
`;

    case 'arc':
      return `0
ARC
8
0
10
${shape.center.x}
20
${shape.center.y}
40
${shape.radius}
50
${shape.startAngle * 180 / Math.PI}
51
${shape.endAngle * 180 / Math.PI}
`;

    case 'polyline': {
      const polyShape = shape as PolylineShape;
      let result = `0
LWPOLYLINE
8
0
90
${polyShape.points.length}
70
${polyShape.closed ? 1 : 0}
`;
      for (let idx = 0; idx < polyShape.points.length; idx++) {
        const pt = polyShape.points[idx];
        result += `10
${pt.x}
20
${-pt.y}
`;
        const b = polyShape.bulge?.[idx] ?? 0;
        if (b !== 0) {
          result += `42
${-b}
`;
        }
      }
      return result;
    }
    case 'spline': {
      let result = `0
POLYLINE
8
0
66
1
`;
      for (const point of shape.points) {
        result += `0
VERTEX
8
0
10
${point.x}
20
${point.y}
`;
      }
      result += `0
SEQEND
`;
      return result;
    }

    default:
      return '';
  }
}

/**
 * Get shape bounds
 */
function getShapeBounds(shape: Shape): { minX: number; minY: number; maxX: number; maxY: number } | null {
  switch (shape.type) {
    case 'line':
      return {
        minX: Math.min(shape.start.x, shape.end.x),
        minY: Math.min(shape.start.y, shape.end.y),
        maxX: Math.max(shape.start.x, shape.end.x),
        maxY: Math.max(shape.start.y, shape.end.y),
      };
    case 'rectangle':
      return {
        minX: shape.topLeft.x,
        minY: shape.topLeft.y,
        maxX: shape.topLeft.x + shape.width,
        maxY: shape.topLeft.y + shape.height,
      };
    case 'circle':
      return {
        minX: shape.center.x - shape.radius,
        minY: shape.center.y - shape.radius,
        maxX: shape.center.x + shape.radius,
        maxY: shape.center.y + shape.radius,
      };
    case 'ellipse':
      return {
        minX: shape.center.x - shape.radiusX,
        minY: shape.center.y - shape.radiusY,
        maxX: shape.center.x + shape.radiusX,
        maxY: shape.center.y + shape.radiusY,
      };
    case 'polyline': {
      if (shape.points.length === 0) return null;
      let pMinX = Infinity, pMinY = Infinity, pMaxX = -Infinity, pMaxY = -Infinity;
      for (const p of shape.points) {
        if (p.x < pMinX) pMinX = p.x;
        if (p.y < pMinY) pMinY = p.y;
        if (p.x > pMaxX) pMaxX = p.x;
        if (p.y > pMaxY) pMaxY = p.y;
      }
      if (shape.bulge) {
        for (let idx = 0; idx < shape.points.length - 1; idx++) {
          const b = shape.bulge[idx] ?? 0;
          if (b !== 0) {
            const ab = bulgeArcBounds(shape.points[idx], shape.points[idx + 1], b);
            if (ab.minX < pMinX) pMinX = ab.minX;
            if (ab.minY < pMinY) pMinY = ab.minY;
            if (ab.maxX > pMaxX) pMaxX = ab.maxX;
            if (ab.maxY > pMaxY) pMaxY = ab.maxY;
          }
        }
      }
      return { minX: pMinX, minY: pMinY, maxX: pMaxX, maxY: pMaxY };
    }
    case 'spline':
      if (shape.points.length === 0) return null;
      const xs = shape.points.map(p => p.x);
      const ys = shape.points.map(p => p.y);
      return {
        minX: Math.min(...xs),
        minY: Math.min(...ys),
        maxX: Math.max(...xs),
        maxY: Math.max(...ys),
      };
    default:
      return null;
  }
}

/**
 * Show import DXF file dialog
 */
export async function showImportDxfDialog(): Promise<string | null> {
  const result = await open({
    multiple: false,
    filters: [{ name: 'DXF Files', extensions: ['dxf'] }],
    title: 'Import DXF',
  });
  return result as string | null;
}

/**
 * Parse a DXF string into shapes.
 * Supports LINE, CIRCLE, ARC, POLYLINE/LWPOLYLINE entities.
 */
export function parseDXF(
  content: string,
  layerId: string,
  drawingId: string,
): Shape[] {
  const defaultStyle: ShapeStyle = {
    strokeColor: '#ffffff',
    strokeWidth: 1,
    lineStyle: 'solid' as LineStyle,
  };

  const shapes: Shape[] = [];
  const lines = content.split(/\r?\n/);
  let i = 0;

  const next = (): [number, string] => {
    const code = parseInt(lines[i]?.trim() ?? '0', 10);
    const value = lines[i + 1]?.trim() ?? '';
    i += 2;
    return [code, value];
  };

  // Advance to ENTITIES section
  while (i < lines.length) {
    const line = lines[i]?.trim();
    if (line === 'ENTITIES') { i++; break; }
    i++;
  }

  while (i < lines.length - 1) {
    const [code, value] = next();
    if (code === 0 && value === 'EOF') break;
    if (code === 0 && value === 'ENDSEC') break;

    if (code === 0 && value === 'LINE') {
      let x1 = 0, y1 = 0, x2 = 0, y2 = 0;
      while (i < lines.length - 1) {
        const [c, v] = next();
        if (c === 0) { i -= 2; break; }
        if (c === 10) x1 = parseFloat(v);
        if (c === 20) y1 = parseFloat(v);
        if (c === 11) x2 = parseFloat(v);
        if (c === 21) y2 = parseFloat(v);
      }
      shapes.push({
        id: crypto.randomUUID(),
        type: 'line',
        layerId, drawingId, style: { ...defaultStyle },
        visible: true, locked: false,
        start: { x: x1, y: -y1 },
        end: { x: x2, y: -y2 },
      } as Shape);
    }

    if (code === 0 && value === 'CIRCLE') {
      let cx = 0, cy = 0, r = 0;
      while (i < lines.length - 1) {
        const [c, v] = next();
        if (c === 0) { i -= 2; break; }
        if (c === 10) cx = parseFloat(v);
        if (c === 20) cy = parseFloat(v);
        if (c === 40) r = parseFloat(v);
      }
      shapes.push({
        id: crypto.randomUUID(),
        type: 'circle',
        layerId, drawingId, style: { ...defaultStyle },
        visible: true, locked: false,
        center: { x: cx, y: -cy },
        radius: r,
      } as Shape);
    }

    if (code === 0 && value === 'ARC') {
      let cx = 0, cy = 0, r = 0, sa = 0, ea = 0;
      while (i < lines.length - 1) {
        const [c, v] = next();
        if (c === 0) { i -= 2; break; }
        if (c === 10) cx = parseFloat(v);
        if (c === 20) cy = parseFloat(v);
        if (c === 40) r = parseFloat(v);
        if (c === 50) sa = parseFloat(v);
        if (c === 51) ea = parseFloat(v);
      }
      shapes.push({
        id: crypto.randomUUID(),
        type: 'arc',
        layerId, drawingId, style: { ...defaultStyle },
        visible: true, locked: false,
        center: { x: cx, y: -cy },
        radius: r,
        startAngle: (sa * Math.PI) / 180,
        endAngle: (ea * Math.PI) / 180,
      } as Shape);
    }

    if (code === 0 && (value === 'LWPOLYLINE' || value === 'POLYLINE')) {
      const pts: { x: number; y: number }[] = [];
      const bulgeValues: number[] = [];
      let closed = false;
      let currentBulge = 0;
      while (i < lines.length - 1) {
        const [c, v] = next();
        if (c === 0) { i -= 2; break; }
        if (c === 70) closed = (parseInt(v) & 1) === 1;
        if (c === 10) {
          // Push previous vertex's bulge before starting a new vertex
          if (pts.length > 0) {
            bulgeValues.push(currentBulge);
            currentBulge = 0;
          }
          const x = parseFloat(v);
          // read group 20 next
          const [c2, v2] = next();
          const y = c2 === 20 ? parseFloat(v2) : 0;
          pts.push({ x, y: -y });
        }
        if (c === 42) currentBulge = -parseFloat(v); // negate because Y is flipped
      }
      // Push last vertex's bulge
      if (pts.length > 0) {
        bulgeValues.push(currentBulge);
      }
      if (pts.length >= 2) {
        const hasBulge = bulgeValues.some(b => b !== 0);
        shapes.push({
          id: crypto.randomUUID(),
          type: 'polyline',
          layerId, drawingId, style: { ...defaultStyle },
          visible: true, locked: false,
          points: pts,
          closed,
          ...(hasBulge ? { bulge: bulgeValues } : {}),
        } as Shape);
      }
    }
  }

  return shapes;
}

/**
 * Show confirmation dialog for unsaved changes
 */
export async function confirmUnsavedChanges(): Promise<boolean> {
  return await ask('You have unsaved changes. Do you want to continue without saving?', {
    title: 'Unsaved Changes',
    kind: 'warning',
  });
}

/**
 * Show error message
 */
export async function showError(msg: string): Promise<void> {
  await message(msg, { title: 'Error', kind: 'error' });
}

/**
 * Show info message
 */
export async function showInfo(msg: string): Promise<void> {
  await message(msg, { title: 'Info', kind: 'info' });
}
