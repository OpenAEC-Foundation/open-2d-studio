/**
 * File Service - Handles file operations (New, Open, Save, Export)
 */

import { open, save, message, ask } from '@tauri-apps/plugin-dialog';
import { readTextFile, writeTextFile } from '@tauri-apps/plugin-fs';
import type { Shape, Layer } from '../types/geometry';

// File format version for future compatibility
const FILE_FORMAT_VERSION = 1;

// File extension for project files
export const PROJECT_EXTENSION = 'o2d';
export const PROJECT_FILTER = {
  name: 'Open 2D Studio Project',
  extensions: [PROJECT_EXTENSION],
};

// Export formats
export const EXPORT_FILTERS = {
  svg: { name: 'SVG Vector Image', extensions: ['svg'] },
  dxf: { name: 'AutoCAD DXF', extensions: ['dxf'] },
  json: { name: 'JSON Data', extensions: ['json'] },
};

/**
 * Project file structure
 */
export interface ProjectFile {
  version: number;
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
 * Create a new empty project data structure
 */
export function createNewProject(): ProjectFile {
  const now = new Date().toISOString();
  return {
    version: FILE_FORMAT_VERSION,
    name: 'Untitled',
    createdAt: now,
    modifiedAt: now,
    shapes: [],
    layers: [
      {
        id: 'default-layer',
        name: 'Layer 0',
        visible: true,
        locked: false,
        color: '#ffffff',
        lineStyle: 'solid',
        lineWidth: 1,
      },
    ],
    activeLayerId: 'default-layer',
    viewport: {
      zoom: 1,
      offsetX: 0,
      offsetY: 0,
    },
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
 * Read project file from disk
 */
export async function readProjectFile(path: string): Promise<ProjectFile> {
  const content = await readTextFile(path);
  const data = JSON.parse(content) as ProjectFile;

  // Validate file format version
  if (!data.version || data.version > FILE_FORMAT_VERSION) {
    throw new Error(`Unsupported file format version: ${data.version}`);
  }

  return data;
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

    case 'polyline':
      const points = shape.points.map(p => `${p.x},${p.y}`).join(' ');
      if (shape.closed) {
        return `  <polygon ${baseAttrs} points="${points}" />\n`;
      }
      return `  <polyline ${baseAttrs} points="${points}" />\n`;

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

    case 'polyline':
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
    case 'polyline':
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
