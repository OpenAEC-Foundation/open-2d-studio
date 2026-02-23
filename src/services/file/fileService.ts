/**
 * File Service - Handles file operations (New, Open, Save, Export)
 */

import { logger } from '../log/logService';
import type { Shape, ShapeStyle, LineStyle, Layer, Drawing, Sheet, Viewport, DrawingBoundary, PolylineShape, ImageShape } from '../../types/geometry';
import { splineToSvgPath } from '../../engine/geometry/SplineUtils';
import { bulgeToArc, bulgeArcBounds } from '../../engine/geometry/GeometryUtils';
export { exportToIFC } from '../export/ifcExport';
import { CAD_DEFAULT_FONT } from '../../constants/cadDefaults';
import { rasterizeDxfShapes } from './dxfUnderlayService';

// ============================================================================
// Environment detection
// ============================================================================

/** True when running inside the Tauri desktop shell. */
const isTauri: boolean =
  typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

// ============================================================================
// Browser fallback helpers
// ============================================================================

/**
 * Module-level cache for file content picked in the browser.
 * showOpenDialog stores the content here, keyed by the pseudo-path it returns.
 * readProjectFile / readTextFileBrowser then consumes it.
 */
const _browserFileCache = new Map<string, string>();

// ============================================================================
// File System Access API (Browser Save As)
// ============================================================================

/** Augment window with the File System Access API (Chromium only). */
declare global {
  interface Window {
    showSaveFilePicker?: (options?: {
      suggestedName?: string;
      types?: Array<{
        description?: string;
        accept: Record<string, string[]>;
      }>;
    }) => Promise<FileSystemFileHandle>;
    showDirectoryPicker?: (options?: {
      id?: string;
      mode?: 'read' | 'readwrite';
      startIn?: 'desktop' | 'documents' | 'downloads' | 'music' | 'pictures' | 'videos';
    }) => Promise<FileSystemDirectoryHandle>;
  }
}

/** Whether the browser supports the File System Access API. */
function hasFileSystemAccess(): boolean {
  return typeof window.showSaveFilePicker === 'function';
}

/** Whether the browser supports directory picking. */
function hasDirectoryAccess(): boolean {
  return typeof window.showDirectoryPicker === 'function';
}

/** Cached file handle for re-saving (Ctrl+S) without a new dialog. */
let _browserFileHandle: FileSystemFileHandle | null = null;

/** One-shot handle for exports. */
let _browserExportHandle: FileSystemFileHandle | null = null;

/** Clear the cached handle (e.g. when creating a new document). */
export function clearBrowserFileHandle(): void {
  _browserFileHandle = null;
}

/**
 * Open a browser file-picker and return the selected file's name + content.
 * Returns null if the user cancels.
 */
function browserPickFile(accept: string): Promise<{ name: string; content: string } | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) { resolve(null); return; }
      const content = await file.text();
      resolve({ name: file.name, content });
    };
    // Handle cancel – the input won't fire 'change' if the user cancels,
    // but we can listen for focus returning to the window.
    const onFocus = () => {
      // Small delay so `change` fires first if a file was selected.
      setTimeout(() => {
        window.removeEventListener('focus', onFocus);
        resolve(null);
      }, 500);
    };
    window.addEventListener('focus', onFocus);
    input.click();
  });
}

/**
 * Trigger a file download in the browser using Blob + invisible <a>.
 */
function browserDownload(
  content: string,
  filename: string,
  mimeType = 'application/octet-stream',
): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// File format version for future compatibility
const FILE_FORMAT_VERSION = 3;

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
  name: 'Open nD Studio Project',
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
  savedPrintPresets?: Record<string, import('../../state/slices/uiSlice').PrintSettings>;
  // Filled region types (optional, backward compatible)
  filledRegionTypes?: import('../../types/filledRegion').FilledRegionType[];
  // Project info (optional, backward compatible)
  projectInfo?: import('../../types/projectInfo').ProjectInfo;
  // Unit settings (optional, backward compatible)
  unitSettings?: import('../../units/types').UnitSettings;
  // Parametric shapes (optional, backward compatible)
  parametricShapes?: import('../../types/parametric').ParametricShape[];
  // Text styles (optional, backward compatible)
  textStyles?: import('../../types/geometry').TextStyle[];
  // Custom title block templates (optional, backward compatible)
  customTitleBlockTemplates?: import('../../types/sheet').TitleBlockTemplate[];
  // Custom sheet templates (optional, backward compatible)
  customSheetTemplates?: import('../../types/sheet').SheetTemplate[];
  // Project-level custom hatch patterns (optional, backward compatible)
  projectPatterns?: import('../../types/hatch').CustomHatchPattern[];
  // Wall types (optional, backward compatible)
  wallTypes?: import('../../types/geometry').WallType[];
  // Wall system types (optional, backward compatible)
  wallSystemTypes?: import('../../types/geometry').WallSystemType[];
}

/**
 * Project file structure V3 (ISO 3098 text standards)
 * - fontSize now means paper mm for annotation text
 * - Font changed from Arial to Osifont
 * - lineHeight changed from 1.2 to 1.4
 * - Dimension style values now in paper mm
 */
export interface ProjectFileV3 extends Omit<ProjectFileV2, 'version'> {
  version: 3;
  // Saved queries (optional, backward compatible)
  queries?: import('../../state/slices/parametricSlice').SavedQuery[];
}

// Current project file type
export type ProjectFile = ProjectFileV3;

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
      drawingType: 'standalone' as const,
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
 * Migrate V2 project to V3 format (ISO 3098 text standards)
 *
 * The scaling formula changed from `fontSize * (0.02 / drawingScale)` to `fontSize / drawingScale`.
 * To preserve visual appearance, annotation text fontSize values are multiplied by 0.02
 * (the old REFERENCE_SCALE). Same for dimension style numeric values.
 *
 * Font is updated from Arial to Osifont, lineHeight from 1.2 to 1.4.
 */
function migrateV2ToV3(v2: ProjectFileV2): ProjectFileV3 {
  const REFERENCE_SCALE = 0.02;

  const migratedShapes = v2.shapes.map(shape => {
    if (shape.type === 'text') {
      const textShape = shape as any;
      const isModel = textShape.isModelText === true;
      return {
        ...textShape,
        // Annotation text: convert fontSize to paper mm
        fontSize: isModel ? textShape.fontSize : textShape.fontSize * REFERENCE_SCALE,
        // Update font and line height
        fontFamily: textShape.fontFamily === 'Arial' ? CAD_DEFAULT_FONT : textShape.fontFamily,
        lineHeight: textShape.lineHeight === 1.2 ? 1.4 : textShape.lineHeight,
      };
    }
    if (shape.type === 'dimension') {
      const dimShape = shape as any;
      const ds = dimShape.dimensionStyle;
      if (ds) {
        return {
          ...dimShape,
          dimensionStyle: {
            ...ds,
            textHeight: ds.textHeight * REFERENCE_SCALE,
            arrowSize: ds.arrowSize * REFERENCE_SCALE,
            extensionLineGap: ds.extensionLineGap * REFERENCE_SCALE,
            extensionLineOvershoot: ds.extensionLineOvershoot * REFERENCE_SCALE,
          },
        };
      }
    }
    return shape;
  });

  // Migrate sheet title block fonts (sizes are already in paper mm, only update font)
  const migratedSheets = (v2.sheets || []).map(sheet => {
    if (sheet.titleBlock && sheet.titleBlock.fields) {
      return {
        ...sheet,
        titleBlock: {
          ...sheet.titleBlock,
          fields: sheet.titleBlock.fields.map((field: any) => ({
            ...field,
            fontFamily: field.fontFamily === 'Arial' ? CAD_DEFAULT_FONT : field.fontFamily,
          })),
        },
      };
    }
    return sheet;
  });

  return {
    ...v2,
    version: 3,
    shapes: migratedShapes,
    sheets: migratedSheets,
  } as ProjectFileV3;
}

/**
 * Create a new empty project data structure
 */
export function createNewProject(): ProjectFile {
  const now = new Date().toISOString();
  const drawingId = generateId();
  const layerId = generateId();

  return {
    version: FILE_FORMAT_VERSION as 3,
    name: 'Untitled',
    createdAt: now,
    modifiedAt: now,
    drawings: [{
      id: drawingId,
      name: 'Drawing 1',
      boundary: { ...DEFAULT_DRAWING_BOUNDARY },
      scale: DEFAULT_DRAWING_SCALE,
      drawingType: 'standalone' as const,
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
 * Show open file dialog and return selected path.
 * In the browser the returned "path" is the filename; the content is cached
 * internally so that readProjectFile / readTextFileBrowser can retrieve it.
 */
export async function showOpenDialog(): Promise<string | null> {
  if (isTauri) {
    const { open } = await import('@tauri-apps/plugin-dialog');
    const result = await open({
      multiple: false,
      filters: [
        { name: 'Supported Files', extensions: [PROJECT_EXTENSION, 'dxf'] },
        PROJECT_FILTER,
        { name: 'DXF', extensions: ['dxf'] },
      ],
      title: 'Open',
    });
    return result as string | null;
  }

  // Browser fallback
  const picked = await browserPickFile('.o2d,.dxf');
  if (!picked) return null;
  _browserFileCache.set(picked.name, picked.content);
  return picked.name;
}

/**
 * Show save file dialog and return selected path.
 * In the browser returns a synthetic filename (download will happen in writeProjectFile).
 */
export async function showSaveDialog(defaultName?: string): Promise<string | null> {
  if (isTauri) {
    const { save } = await import('@tauri-apps/plugin-dialog');
    const result = await save({
      filters: [PROJECT_FILTER],
      title: 'Save Project',
      defaultPath: defaultName ? `${defaultName}.${PROJECT_EXTENSION}` : undefined,
    });
    return result;
  }

  // Browser: try File System Access API for a real Save As dialog
  if (hasFileSystemAccess()) {
    try {
      const handle = await window.showSaveFilePicker!({
        suggestedName: (defaultName || 'Untitled') + '.' + PROJECT_EXTENSION,
        types: [{
          description: 'Open 2D Studio Project',
          accept: { 'application/json': [`.${PROJECT_EXTENSION}`] },
        }],
      });
      _browserFileHandle = handle;
      return handle.name;
    } catch (e: unknown) {
      // User cancelled (AbortError)
      if (e instanceof DOMException && e.name === 'AbortError') return null;
      // Fall through to prompt fallback
    }
  }

  // Fallback: prompt for filename
  const input = window.prompt('Save as:', (defaultName || 'Untitled') + '.' + PROJECT_EXTENSION);
  if (!input) return null;
  return input;
}

/**
 * Show export file dialog.
 * In the browser returns a synthetic filename.
 */
export async function showExportDialog(
  format: keyof typeof EXPORT_FILTERS,
  defaultName?: string
): Promise<string | null> {
  const filter = EXPORT_FILTERS[format];

  if (isTauri) {
    const { save } = await import('@tauri-apps/plugin-dialog');
    const result = await save({
      filters: [filter],
      title: `Export as ${filter.name}`,
      defaultPath: defaultName ? `${defaultName}.${filter.extensions[0]}` : undefined,
    });
    return result;
  }

  // Browser: try File System Access API
  if (hasFileSystemAccess()) {
    try {
      const ext = filter.extensions[0];
      const mimeMap: Record<string, string> = {
        svg: 'image/svg+xml', dxf: 'application/dxf',
        ifc: 'application/x-step', json: 'application/json',
      };
      const handle = await window.showSaveFilePicker!({
        suggestedName: (defaultName || 'export') + '.' + ext,
        types: [{
          description: filter.name,
          accept: { [mimeMap[ext] || 'application/octet-stream']: [`.${ext}`] },
        }],
      });
      _browserExportHandle = handle;
      return handle.name;
    } catch (e: unknown) {
      if (e instanceof DOMException && e.name === 'AbortError') return null;
    }
  }

  // Fallback
  const filename = (defaultName || 'export') + '.' + filter.extensions[0];
  return filename;
}

/**
 * Show export dialog with all supported formats.
 * In the browser we prompt the user for the desired format via window.prompt
 * and return a synthetic filename.
 */
export async function showExportAllFormatsDialog(
  defaultName?: string
): Promise<string | null> {
  if (isTauri) {
    const { save } = await import('@tauri-apps/plugin-dialog');
    const allFilters = Object.values(EXPORT_FILTERS);
    const result = await save({
      filters: allFilters,
      title: 'Export Drawing',
      defaultPath: defaultName ? `${defaultName}.svg` : undefined,
    });
    return result;
  }

  // Browser fallback: ask for format, default to SVG
  const ext = window.prompt(
    'Export format (svg, dxf, ifc, json):',
    'svg',
  )?.trim().toLowerCase();
  if (!ext) return null;
  const validExts = ['svg', 'dxf', 'ifc', 'json'];
  const chosen = validExts.includes(ext) ? ext : 'svg';
  return (defaultName || 'export') + '.' + chosen;
}

/**
 * Read project file from disk (Tauri) or from the browser file cache.
 */
export async function readProjectFile(path: string): Promise<ProjectFile> {
  let content: string;
  if (isTauri) {
    const { readTextFile } = await import('@tauri-apps/plugin-fs');
    content = await readTextFile(path);
  } else {
    // Browser: retrieve from cache populated by showOpenDialog
    const cached = _browserFileCache.get(path);
    if (cached !== undefined) {
      content = cached;
      _browserFileCache.delete(path);
    } else {
      throw new Error('File content not available (browser mode).');
    }
  }
  const data = JSON.parse(content) as ProjectFileV1 | ProjectFileV2 | ProjectFileV3;

  // Validate file format version
  if (!data.version || data.version > FILE_FORMAT_VERSION) {
    throw new Error(`Unsupported file format version: ${data.version}`);
  }

  // Chain migrations: V1 → V2 → V3
  let result: ProjectFileV2 | ProjectFileV3;
  if (data.version === 1) {
    result = migrateV1ToV2(data as ProjectFileV1);
  } else {
    result = data as ProjectFileV2 | ProjectFileV3;
  }

  if (result.version === 2) {
    result = migrateV2ToV3(result as ProjectFileV2);
  }

  return result as ProjectFileV3;
}

/**
 * Write project file to disk (Tauri) or trigger a browser download.
 */
export async function writeProjectFile(path: string, project: ProjectFile): Promise<void> {
  project.modifiedAt = new Date().toISOString();
  const content = JSON.stringify(project, null, 2);

  if (isTauri) {
    const { writeTextFile } = await import('@tauri-apps/plugin-fs');
    await writeTextFile(path, content);
  } else if (_browserFileHandle) {
    // Re-save to the same file via File System Access API (silent Ctrl+S)
    const writable = await _browserFileHandle.createWritable();
    await writable.write(content);
    await writable.close();
  } else {
    browserDownload(content, path, 'application/json');
  }
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

    case 'image': {
      const imgShape = shape as ImageShape;
      const cx = imgShape.position.x + imgShape.width / 2;
      const cy = imgShape.position.y + imgShape.height / 2;
      const rotDeg = (imgShape.rotation || 0) * 180 / Math.PI;
      const transform = rotDeg ? ` transform="rotate(${rotDeg} ${cx} ${cy})"` : '';
      const opacity = imgShape.opacity !== undefined && imgShape.opacity < 1 ? ` opacity="${imgShape.opacity}"` : '';
      return `  <image href="${imgShape.imageData}" x="${imgShape.position.x}" y="${imgShape.position.y}" width="${imgShape.width}" height="${imgShape.height}"${transform}${opacity} />\n`;
    }

    default:
      return '';
  }
}

/**
 * Export shapes to DXF format (basic implementation)
 */
export function exportToDXF(shapes: Shape[], unitSettings?: import('../../units/types').UnitSettings): string {
  // Map length unit to DXF $INSUNITS value
  const insUnitsMap: Record<string, number> = {
    'mm': 4, 'cm': 5, 'm': 6, 'in': 1, 'ft': 2, 'ft-in': 2,
  };
  const insUnits = unitSettings ? (insUnitsMap[unitSettings.lengthUnit] ?? 4) : 4;

  let dxf = `0
SECTION
2
HEADER
9
$INSUNITS
70
${insUnits}
0
ENDSEC
0
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
${-shape.start.y}
11
${shape.end.x}
21
${-shape.end.y}
`;

    case 'circle':
      return `0
CIRCLE
8
0
10
${shape.center.x}
20
${-shape.center.y}
40
${shape.radius}
`;

    case 'arc':
      // Swap and negate angles because Y is flipped
      return `0
ARC
8
0
10
${shape.center.x}
20
${-shape.center.y}
40
${shape.radius}
50
${-shape.endAngle * 180 / Math.PI}
51
${-shape.startAngle * 180 / Math.PI}
`;

    case 'ellipse': {
      // DXF ELLIPSE uses major axis endpoint relative to center
      const majorLength = shape.radiusX;
      const rotation = shape.rotation || 0;
      const majorX = majorLength * Math.cos(-rotation);
      const majorY = majorLength * Math.sin(-rotation);
      const ratio = shape.radiusY / shape.radiusX;
      // Start/end params (0 to 2*PI for full ellipse)
      const startParam = shape.startAngle !== undefined ? -shape.endAngle! : 0;
      const endParam = shape.endAngle !== undefined ? -shape.startAngle! : 2 * Math.PI;
      return `0
ELLIPSE
8
0
10
${shape.center.x}
20
${-shape.center.y}
30
0
11
${majorX}
21
${majorY}
31
0
40
${ratio}
41
${startParam}
42
${endParam}
`;
    }

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
      // Export spline as SPLINE entity with control points
      const flags = shape.closed ? 11 : 8; // 8 = planar, 1 = closed, 2 = periodic
      let result = `0
SPLINE
8
0
70
${flags}
71
3
`;
      // Add control points
      for (const point of shape.points) {
        result += `10
${point.x}
20
${-point.y}
30
0
`;
      }
      return result;
    }

    case 'text': {
      const rotationDeg = -(shape.rotation || 0) * 180 / Math.PI;
      return `0
TEXT
8
0
10
${shape.position.x}
20
${-shape.position.y}
30
0
40
${shape.fontSize}
1
${shape.text}
50
${rotationDeg}
`;
    }

    case 'point':
      return `0
POINT
8
0
10
${shape.position.x}
20
${-shape.position.y}
30
0
`;

    case 'rectangle': {
      // Export rectangle as LWPOLYLINE (4 corner points, closed)
      const { topLeft, width, height, rotation } = shape;
      const corners = [
        { x: topLeft.x, y: topLeft.y },
        { x: topLeft.x + width, y: topLeft.y },
        { x: topLeft.x + width, y: topLeft.y + height },
        { x: topLeft.x, y: topLeft.y + height },
      ];
      // Apply rotation if present
      if (rotation) {
        const cx = topLeft.x + width / 2;
        const cy = topLeft.y + height / 2;
        const cos = Math.cos(rotation);
        const sin = Math.sin(rotation);
        for (const corner of corners) {
          const dx = corner.x - cx;
          const dy = corner.y - cy;
          corner.x = cx + dx * cos - dy * sin;
          corner.y = cy + dx * sin + dy * cos;
        }
      }
      let result = `0
LWPOLYLINE
8
0
90
4
70
1
`;
      for (const pt of corners) {
        result += `10
${pt.x}
20
${-pt.y}
`;
      }
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
    case 'image':
      return {
        minX: shape.position.x,
        minY: shape.position.y,
        maxX: shape.position.x + shape.width,
        maxY: shape.position.y + shape.height,
      };
    default:
      return null;
  }
}

/**
 * Show import DXF file dialog.
 * In browser mode the content is cached and the filename is returned.
 */
export async function showImportDxfDialog(): Promise<string | null> {
  if (isTauri) {
    const { open } = await import('@tauri-apps/plugin-dialog');
    const result = await open({
      multiple: false,
      filters: [{ name: 'DXF Files', extensions: ['dxf'] }],
      title: 'Import DXF',
    });
    return result as string | null;
  }

  // Browser fallback
  const picked = await browserPickFile('.dxf');
  if (!picked) return null;
  _browserFileCache.set(picked.name, picked.content);
  return picked.name;
}

/**
 * Show import image file dialog.
 * In browser mode the content is cached and the filename is returned.
 */
export async function showImportImageDialog(): Promise<string | null> {
  if (isTauri) {
    const { open } = await import('@tauri-apps/plugin-dialog');
    const result = await open({
      multiple: false,
      filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'bmp', 'gif', 'webp', 'svg'] }],
      title: 'Import Image',
    });
    return result as string | null;
  }

  // Browser fallback
  const picked = await browserPickFile('image/png,image/jpeg,image/bmp,image/gif,image/webp,image/svg+xml');
  if (!picked) return null;
  _browserFileCache.set(picked.name, picked.content);
  return picked.name;
}

/**
 * DXF color index to RGB hex mapping (standard 256-color palette)
 * Index 0 = ByBlock, 256 = ByLayer - we use white as default
 */
const DXF_COLORS: Record<number, string> = {
  1: '#ff0000',   // Red
  2: '#ffff00',   // Yellow
  3: '#00ff00',   // Green
  4: '#00ffff',   // Cyan
  5: '#0000ff',   // Blue
  6: '#ff00ff',   // Magenta
  7: '#ffffff',   // White
  8: '#808080',   // Gray
  9: '#c0c0c0',   // Light gray
  10: '#ff0000',  // Red
  11: '#ff7f7f',
  12: '#cc0000',
  13: '#cc6666',
  14: '#990000',
  15: '#994c4c',
  16: '#7f0000',
  17: '#7f3f3f',
  18: '#4c0000',
  19: '#4c2626',
  20: '#ff3f00',
  21: '#ff9f7f',
  30: '#ff7f00',
  31: '#ffbf7f',
  40: '#ffbf00',
  41: '#ffdf7f',
  50: '#ffff00',
  51: '#ffff7f',
  60: '#bfff00',
  61: '#dfff7f',
  70: '#7fff00',
  71: '#bfff7f',
  80: '#3fff00',
  81: '#9fff7f',
  90: '#00ff00',
  91: '#7fff7f',
  100: '#00ff3f',
  101: '#7fff9f',
  110: '#00ff7f',
  111: '#7fffbf',
  120: '#00ffbf',
  121: '#7fffdf',
  130: '#00ffff',
  131: '#7fffff',
  140: '#00bfff',
  141: '#7fdfff',
  150: '#007fff',
  151: '#7fbfff',
  160: '#003fff',
  161: '#7f9fff',
  170: '#0000ff',
  171: '#7f7fff',
  180: '#3f00ff',
  181: '#9f7fff',
  190: '#7f00ff',
  191: '#bf7fff',
  200: '#bf00ff',
  201: '#df7fff',
  210: '#ff00ff',
  211: '#ff7fff',
  220: '#ff00bf',
  221: '#ff7fdf',
  230: '#ff007f',
  231: '#ff7fbf',
  240: '#ff003f',
  241: '#ff7f9f',
  250: '#545454',
  251: '#767676',
  252: '#989898',
  253: '#bababa',
  254: '#dcdcdc',
  255: '#ffffff',
};

/**
 * Get RGB color from DXF color index
 */
function getDxfColor(colorIndex: number): string {
  if (colorIndex <= 0 || colorIndex === 256) return '#ffffff'; // ByBlock/ByLayer = white
  return DXF_COLORS[colorIndex] || '#ffffff';
}

/**
 * Extract $INSUNITS from a DXF HEADER section.
 * Returns the LengthUnit or null if not found.
 */
export function parseDXFInsUnits(content: string): import('../../units/types').LengthUnit | null {
  const insUnitsToUnit: Record<number, import('../../units/types').LengthUnit> = {
    1: 'in', 2: 'ft', 4: 'mm', 5: 'cm', 6: 'm',
  };
  const lines = content.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    if (lines[i]?.trim() === '$INSUNITS') {
      // Next pair: group code 70, then the value
      const code = parseInt(lines[i + 1]?.trim() ?? '', 10);
      const val = parseInt(lines[i + 2]?.trim() ?? '', 10);
      if (code === 70 && insUnitsToUnit[val]) {
        return insUnitsToUnit[val];
      }
    }
    // Stop scanning after HEADER section ends
    if (lines[i]?.trim() === 'ENTITIES') break;
  }
  return null;
}

/**
 * Parse a DXF string into shapes.
 * Supports LINE, CIRCLE, ARC, POLYLINE/LWPOLYLINE, ELLIPSE, SPLINE, TEXT, MTEXT, POINT entities.
 * Also extracts layer names and colors from entities.
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

    // Parse LINE entity
    if (code === 0 && value === 'LINE') {
      let x1 = 0, y1 = 0, x2 = 0, y2 = 0;
      let colorIndex = 7;
      while (i < lines.length - 1) {
        const [c, v] = next();
        if (c === 0) { i -= 2; break; }
        if (c === 10) x1 = parseFloat(v);
        if (c === 20) y1 = parseFloat(v);
        if (c === 11) x2 = parseFloat(v);
        if (c === 21) y2 = parseFloat(v);
        if (c === 62) colorIndex = parseInt(v);
      }
      shapes.push({
        id: crypto.randomUUID(),
        type: 'line',
        layerId, drawingId,
        style: { ...defaultStyle, strokeColor: getDxfColor(colorIndex) },
        visible: true, locked: false,
        start: { x: x1, y: -y1 },
        end: { x: x2, y: -y2 },
      } as Shape);
    }

    // Parse CIRCLE entity
    if (code === 0 && value === 'CIRCLE') {
      let cx = 0, cy = 0, r = 0;
      let colorIndex = 7;
      while (i < lines.length - 1) {
        const [c, v] = next();
        if (c === 0) { i -= 2; break; }
        if (c === 10) cx = parseFloat(v);
        if (c === 20) cy = parseFloat(v);
        if (c === 40) r = parseFloat(v);
        if (c === 62) colorIndex = parseInt(v);
      }
      shapes.push({
        id: crypto.randomUUID(),
        type: 'circle',
        layerId, drawingId,
        style: { ...defaultStyle, strokeColor: getDxfColor(colorIndex) },
        visible: true, locked: false,
        center: { x: cx, y: -cy },
        radius: r,
      } as Shape);
    }

    // Parse ARC entity
    if (code === 0 && value === 'ARC') {
      let cx = 0, cy = 0, r = 0, sa = 0, ea = 0;
      let colorIndex = 7;
      while (i < lines.length - 1) {
        const [c, v] = next();
        if (c === 0) { i -= 2; break; }
        if (c === 10) cx = parseFloat(v);
        if (c === 20) cy = parseFloat(v);
        if (c === 40) r = parseFloat(v);
        if (c === 50) sa = parseFloat(v);
        if (c === 51) ea = parseFloat(v);
        if (c === 62) colorIndex = parseInt(v);
      }
      // Negate angles and swap because Y is flipped
      shapes.push({
        id: crypto.randomUUID(),
        type: 'arc',
        layerId, drawingId,
        style: { ...defaultStyle, strokeColor: getDxfColor(colorIndex) },
        visible: true, locked: false,
        center: { x: cx, y: -cy },
        radius: r,
        startAngle: (-ea * Math.PI) / 180,
        endAngle: (-sa * Math.PI) / 180,
      } as Shape);
    }

    // Parse ELLIPSE entity
    if (code === 0 && value === 'ELLIPSE') {
      let cx = 0, cy = 0;
      let majorX = 1, majorY = 0; // Major axis endpoint relative to center
      let ratio = 1; // Minor/major axis ratio
      let startParam = 0, endParam = 2 * Math.PI;
      let colorIndex = 7;
      while (i < lines.length - 1) {
        const [c, v] = next();
        if (c === 0) { i -= 2; break; }
        if (c === 10) cx = parseFloat(v);
        if (c === 20) cy = parseFloat(v);
        if (c === 11) majorX = parseFloat(v);
        if (c === 21) majorY = parseFloat(v);
        if (c === 40) ratio = parseFloat(v);
        if (c === 41) startParam = parseFloat(v);
        if (c === 42) endParam = parseFloat(v);
        if (c === 62) colorIndex = parseInt(v);
      }
      // Calculate major axis length and rotation
      const majorLength = Math.sqrt(majorX * majorX + majorY * majorY);
      const rotation = Math.atan2(majorY, majorX);
      const minorLength = majorLength * ratio;

      // Check if it's a full ellipse or elliptical arc
      const isFullEllipse = Math.abs(endParam - startParam - 2 * Math.PI) < 0.001;

      shapes.push({
        id: crypto.randomUUID(),
        type: 'ellipse',
        layerId, drawingId,
        style: { ...defaultStyle, strokeColor: getDxfColor(colorIndex) },
        visible: true, locked: false,
        center: { x: cx, y: -cy },
        radiusX: majorLength,
        radiusY: minorLength,
        rotation: -rotation, // Negate because Y is flipped
        ...(isFullEllipse ? {} : {
          startAngle: -endParam,   // Swap and negate because Y is flipped
          endAngle: -startParam,
        }),
      } as Shape);
    }

    // Parse SPLINE entity
    if (code === 0 && value === 'SPLINE') {
      const controlPoints: { x: number; y: number }[] = [];
      let closed = false;
      let colorIndex = 7;
      let currentX: number | null = null;

      while (i < lines.length - 1) {
        const [c, v] = next();
        if (c === 0) { i -= 2; break; }
        if (c === 70) closed = (parseInt(v) & 1) === 1;
        if (c === 62) colorIndex = parseInt(v);
        if (c === 10) {
          currentX = parseFloat(v);
        }
        if (c === 20 && currentX !== null) {
          controlPoints.push({ x: currentX, y: -parseFloat(v) });
          currentX = null;
        }
      }

      if (controlPoints.length >= 2) {
        shapes.push({
          id: crypto.randomUUID(),
          type: 'spline',
          layerId, drawingId,
          style: { ...defaultStyle, strokeColor: getDxfColor(colorIndex) },
          visible: true, locked: false,
          points: controlPoints,
          closed,
        } as Shape);
      }
    }

    // Parse TEXT entity
    if (code === 0 && value === 'TEXT') {
      let x = 0, y = 0;
      let textContent = '';
      let height = 10;
      let rotation = 0;
      let colorIndex = 7;

      while (i < lines.length - 1) {
        const [c, v] = next();
        if (c === 0) { i -= 2; break; }
        if (c === 10) x = parseFloat(v);
        if (c === 20) y = parseFloat(v);
        if (c === 1) textContent = v;
        if (c === 40) height = parseFloat(v);
        if (c === 50) rotation = parseFloat(v);
        if (c === 62) colorIndex = parseInt(v);
      }

      if (textContent) {
        shapes.push({
          id: crypto.randomUUID(),
          type: 'text',
          layerId, drawingId,
          style: { ...defaultStyle, strokeColor: getDxfColor(colorIndex) },
          visible: true, locked: false,
          position: { x, y: -y },
          text: textContent,
          fontSize: height,
          fontFamily: CAD_DEFAULT_FONT,
          rotation: (-rotation * Math.PI) / 180,
          alignment: 'left',
          verticalAlignment: 'bottom',
          bold: false,
          italic: false,
          underline: false,
          color: getDxfColor(colorIndex),
          lineHeight: 1.2,
        } as Shape);
      }
    }

    // Parse MTEXT entity (multiline text)
    if (code === 0 && value === 'MTEXT') {
      let x = 0, y = 0;
      let textContent = '';
      let height = 10;
      let rotation = 0;
      let colorIndex = 7;
      let width: number | undefined;

      while (i < lines.length - 1) {
        const [c, v] = next();
        if (c === 0) { i -= 2; break; }
        if (c === 10) x = parseFloat(v);
        if (c === 20) y = parseFloat(v);
        if (c === 1) textContent += v; // Primary text
        if (c === 3) textContent += v; // Additional text chunks
        if (c === 40) height = parseFloat(v);
        if (c === 41) width = parseFloat(v);
        if (c === 50) rotation = parseFloat(v);
        if (c === 62) colorIndex = parseInt(v);
      }

      // Clean MTEXT formatting codes (basic cleanup)
      textContent = textContent
        .replace(/\\P/g, '\n')           // Paragraph breaks
        .replace(/\\[Ff][^;]*;/g, '')    // Font changes
        .replace(/\\[Hh][^;]*;/g, '')    // Height changes
        .replace(/\\[Ww][^;]*;/g, '')    // Width factor
        .replace(/\\[Qq][^;]*;/g, '')    // Slant angle
        .replace(/\\[Tt][^;]*;/g, '')    // Tracking
        .replace(/\\[Aa][^;]*;/g, '')    // Alignment
        .replace(/\\[Cc][^;]*;/g, '')    // Color
        .replace(/\\[Ll]/g, '')          // Underline start
        .replace(/\\l/g, '')             // Underline end
        .replace(/\\[Oo]/g, '')          // Overline start
        .replace(/\\o/g, '')             // Overline end
        .replace(/\\[Kk]/g, '')          // Strikethrough start
        .replace(/\\k/g, '')             // Strikethrough end
        .replace(/\{|\}/g, '')           // Braces
        .replace(/\\\\/g, '\\');         // Escaped backslash

      if (textContent.trim()) {
        shapes.push({
          id: crypto.randomUUID(),
          type: 'text',
          layerId, drawingId,
          style: { ...defaultStyle, strokeColor: getDxfColor(colorIndex) },
          visible: true, locked: false,
          position: { x, y: -y },
          text: textContent.trim(),
          fontSize: height,
          fontFamily: CAD_DEFAULT_FONT,
          rotation: (-rotation * Math.PI) / 180,
          alignment: 'left',
          verticalAlignment: 'top',
          bold: false,
          italic: false,
          underline: false,
          color: getDxfColor(colorIndex),
          lineHeight: 1.2,
          fixedWidth: width,
        } as Shape);
      }
    }

    // Parse POINT entity
    if (code === 0 && value === 'POINT') {
      let x = 0, y = 0;
      let colorIndex = 7;

      while (i < lines.length - 1) {
        const [c, v] = next();
        if (c === 0) { i -= 2; break; }
        if (c === 10) x = parseFloat(v);
        if (c === 20) y = parseFloat(v);
        if (c === 62) colorIndex = parseInt(v);
      }

      shapes.push({
        id: crypto.randomUUID(),
        type: 'point',
        layerId, drawingId,
        style: { ...defaultStyle, strokeColor: getDxfColor(colorIndex) },
        visible: true, locked: false,
        position: { x, y: -y },
      } as Shape);
    }

    // Parse LWPOLYLINE/POLYLINE entity
    if (code === 0 && (value === 'LWPOLYLINE' || value === 'POLYLINE')) {
      const pts: { x: number; y: number }[] = [];
      const bulgeValues: number[] = [];
      let closed = false;
      let currentBulge = 0;
      let colorIndex = 7;

      while (i < lines.length - 1) {
        const [c, v] = next();
        if (c === 0) { i -= 2; break; }
        if (c === 70) closed = (parseInt(v) & 1) === 1;
        if (c === 62) colorIndex = parseInt(v);
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
          layerId, drawingId,
          style: { ...defaultStyle, strokeColor: getDxfColor(colorIndex) },
          visible: true, locked: false,
          points: pts,
          closed,
          ...(hasBulge ? { bulge: bulgeValues } : {}),
        } as Shape);
      }
    }

    // Parse SOLID entity (triangular/quadrilateral fill - convert to closed polyline)
    if (code === 0 && value === 'SOLID') {
      const pts: { x: number; y: number }[] = [
        { x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }
      ];
      let colorIndex = 7;

      while (i < lines.length - 1) {
        const [c, v] = next();
        if (c === 0) { i -= 2; break; }
        if (c === 10) pts[0].x = parseFloat(v);
        if (c === 20) pts[0].y = -parseFloat(v);
        if (c === 11) pts[1].x = parseFloat(v);
        if (c === 21) pts[1].y = -parseFloat(v);
        if (c === 12) pts[2].x = parseFloat(v);
        if (c === 22) pts[2].y = -parseFloat(v);
        if (c === 13) pts[3].x = parseFloat(v);
        if (c === 23) pts[3].y = -parseFloat(v);
        if (c === 62) colorIndex = parseInt(v);
      }

      // DXF SOLID has unusual vertex order: 0, 1, 3, 2 (for quad)
      // Check if it's a triangle (point 3 == point 2)
      const isTriangle = pts[2].x === pts[3].x && pts[2].y === pts[3].y;
      const orderedPts = isTriangle
        ? [pts[0], pts[1], pts[2]]
        : [pts[0], pts[1], pts[3], pts[2]]; // Reorder for proper quad

      shapes.push({
        id: crypto.randomUUID(),
        type: 'polyline',
        layerId, drawingId,
        style: {
          ...defaultStyle,
          strokeColor: getDxfColor(colorIndex),
          fillColor: getDxfColor(colorIndex),
        },
        visible: true, locked: false,
        points: orderedPts,
        closed: true,
      } as Shape);
    }

    // Parse 3DFACE entity (similar to SOLID but for 3D - treat as 2D polyline)
    if (code === 0 && value === '3DFACE') {
      const pts: { x: number; y: number }[] = [
        { x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }
      ];
      let colorIndex = 7;

      while (i < lines.length - 1) {
        const [c, v] = next();
        if (c === 0) { i -= 2; break; }
        if (c === 10) pts[0].x = parseFloat(v);
        if (c === 20) pts[0].y = -parseFloat(v);
        if (c === 11) pts[1].x = parseFloat(v);
        if (c === 21) pts[1].y = -parseFloat(v);
        if (c === 12) pts[2].x = parseFloat(v);
        if (c === 22) pts[2].y = -parseFloat(v);
        if (c === 13) pts[3].x = parseFloat(v);
        if (c === 23) pts[3].y = -parseFloat(v);
        if (c === 62) colorIndex = parseInt(v);
      }

      // Check if it's a triangle
      const isTriangle = pts[2].x === pts[3].x && pts[2].y === pts[3].y;
      const orderedPts = isTriangle
        ? [pts[0], pts[1], pts[2]]
        : [pts[0], pts[1], pts[2], pts[3]];

      shapes.push({
        id: crypto.randomUUID(),
        type: 'polyline',
        layerId, drawingId,
        style: { ...defaultStyle, strokeColor: getDxfColor(colorIndex) },
        visible: true, locked: false,
        points: orderedPts,
        closed: true,
      } as Shape);
    }

    // Parse TRACE entity (thick line — convert to polyline)
    if (code === 0 && value === 'TRACE') {
      const pts: { x: number; y: number }[] = [
        { x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }
      ];
      let colorIndex = 7;

      while (i < lines.length - 1) {
        const [c, v] = next();
        if (c === 0) { i -= 2; break; }
        if (c === 10) pts[0].x = parseFloat(v);
        if (c === 20) pts[0].y = -parseFloat(v);
        if (c === 11) pts[1].x = parseFloat(v);
        if (c === 21) pts[1].y = -parseFloat(v);
        if (c === 12) pts[2].x = parseFloat(v);
        if (c === 22) pts[2].y = -parseFloat(v);
        if (c === 13) pts[3].x = parseFloat(v);
        if (c === 23) pts[3].y = -parseFloat(v);
        if (c === 62) colorIndex = parseInt(v);
      }

      // TRACE vertices: 0, 1, 3, 2 order
      shapes.push({
        id: crypto.randomUUID(),
        type: 'polyline',
        layerId, drawingId,
        style: {
          ...defaultStyle,
          strokeColor: getDxfColor(colorIndex),
          fillColor: getDxfColor(colorIndex),
        },
        visible: true, locked: false,
        points: [pts[0], pts[1], pts[3], pts[2]],
        closed: true,
      } as Shape);
    }
  }

  if (shapes.length > 0) {
    logger.info(`DXF parsed: ${shapes.length} entities imported`, 'DXF');
  }

  return shapes;
}

/**
 * Show confirmation dialog for unsaved changes
 */
export async function confirmUnsavedChanges(): Promise<boolean> {
  if (isTauri) {
    const { ask } = await import('@tauri-apps/plugin-dialog');
    return await ask('You have unsaved changes. Do you want to continue without saving?', {
      title: 'Unsaved Changes',
      kind: 'warning',
    });
  }

  // Browser fallback
  return window.confirm('You have unsaved changes. Do you want to continue without saving?');
}

/**
 * Show 3-button Save/Don't Save/Cancel dialog for unsaved changes.
 * Returns 'save', 'discard', or 'cancel'.
 */
export type SavePromptResult = 'save' | 'discard' | 'cancel';

export async function promptSaveBeforeClose(docName?: string): Promise<SavePromptResult> {
  if (isTauri) {
    const { message } = await import('@tauri-apps/plugin-dialog');
    const result = await message(
      `Do you want to save changes to "${docName || 'Untitled'}"?`,
      {
        title: 'Unsaved Changes',
        kind: 'warning',
        buttons: { yes: 'Save', no: "Don't Save", cancel: 'Cancel' },
      }
    );
    // Custom button labels: Tauri returns the label text, not semantic ids
    if (result === 'Yes' || result === 'Save') return 'save';
    if (result === 'No' || result === "Don't Save") return 'discard';
    return 'cancel';
  }

  // Browser fallback: use confirm (no three-button dialog available natively)
  const wantSave = window.confirm(
    `Do you want to save changes to "${docName || 'Untitled'}"?\n\nOK = Save, Cancel = Don't Save`,
  );
  return wantSave ? 'save' : 'discard';
}

/**
 * Show error message
 */
export async function showError(msg: string): Promise<void> {
  logger.error(msg, 'File');
  if (isTauri) {
    const { message } = await import('@tauri-apps/plugin-dialog');
    await message(msg, { title: 'Error', kind: 'error' });
  } else {
    window.alert(msg);
  }
}

/**
 * Show info message
 */
export async function showInfo(msg: string): Promise<void> {
  logger.info(msg, 'File');
  if (isTauri) {
    const { message } = await import('@tauri-apps/plugin-dialog');
    await message(msg, { title: 'Info', kind: 'info' });
  } else {
    window.alert(msg);
  }
}

// ============================================================================
// Browser file-cache accessor (for use by other modules)
// ============================================================================

/**
 * Retrieve and consume a file's content that was cached by a browser
 * file-picker dialog (showOpenDialog / showImportDxfDialog / etc.).
 * Returns undefined when there is no cached entry (e.g. in Tauri mode).
 */
export function consumeBrowserFileCache(key: string): string | undefined {
  const content = _browserFileCache.get(key);
  if (content !== undefined) _browserFileCache.delete(key);
  return content;
}

/**
 * Write a text file. Uses Tauri FS in desktop mode, browser download otherwise.
 */
export async function writeTextFileUniversal(
  path: string,
  content: string,
  mimeType = 'application/octet-stream',
): Promise<void> {
  if (isTauri) {
    const { writeTextFile } = await import('@tauri-apps/plugin-fs');
    await writeTextFile(path, content);
  } else if (_browserExportHandle) {
    // Write via File System Access API handle (from showExportDialog)
    const writable = await _browserExportHandle.createWritable();
    await writable.write(content);
    await writable.close();
    _browserExportHandle = null; // one-shot
  } else {
    browserDownload(content, path, mimeType);
  }
}

/**
 * Read a text file. Uses Tauri FS in desktop mode, browser file cache otherwise.
 */
export async function readTextFileUniversal(path: string): Promise<string> {
  if (isTauri) {
    const { readTextFile } = await import('@tauri-apps/plugin-fs');
    return await readTextFile(path);
  }
  // Browser: retrieve from cache
  const cached = _browserFileCache.get(path);
  if (cached !== undefined) {
    _browserFileCache.delete(path);
    return cached;
  }
  throw new Error('File content not available (browser mode).');
}

/**
 * Whether the app is running inside Tauri (re-exported for other modules).
 */
export function isTauriEnvironment(): boolean {
  return isTauri;
}

/**
 * Show a confirmation dialog. Returns true if the user clicked OK/Yes.
 */
export async function showConfirm(msg: string): Promise<boolean> {
  if (isTauri) {
    const { ask } = await import('@tauri-apps/plugin-dialog');
    return await ask(msg, { title: 'Confirm', kind: 'info' });
  }
  return window.confirm(msg);
}

/**
 * Parse a DXF file and rasterize all shapes into a single ImageShape underlay.
 * Returns an array with one ImageShape (underlay), or null if rasterization fails.
 */
export function parseDXFAsUnderlay(
  content: string,
  layerId: string,
  drawingId: string,
  fileName: string,
): ImageShape | null {
  const shapes = parseDXF(content, layerId, drawingId);
  if (shapes.length === 0) return null;

  const result = rasterizeDxfShapes(shapes);
  if (!result) return null;

  const underlay: ImageShape = {
    id: generateId(),
    type: 'image',
    position: { x: result.bounds.minX, y: result.bounds.minY },
    width: result.bounds.maxX - result.bounds.minX,
    height: result.bounds.maxY - result.bounds.minY,
    rotation: 0,
    imageData: result.dataUrl,
    originalWidth: result.pixelWidth,
    originalHeight: result.pixelHeight,
    opacity: 0.5,
    maintainAspectRatio: true,
    locked: true,
    isUnderlay: true,
    sourceFileName: fileName,
    visible: true,
    layerId,
    drawingId,
    style: {
      strokeColor: '#000000',
      strokeWidth: 1,
      fillColor: 'transparent',
      lineStyle: 'solid' as LineStyle,
    },
  };

  return underlay;
}

// ============================================================================
// Export to Folder (File System Access API — directory picker)
// ============================================================================

export interface ExportToFolderResult {
  folder: string;
  files: string[];
}

/**
 * Let the user pick a local folder, then write multiple export files into it.
 * Uses the File System Access API (showDirectoryPicker) in Chromium browsers,
 * or the Tauri filesystem API in the desktop app.
 *
 * Returns the list of written filenames, or null if the user cancelled.
 */
export async function exportToFolder(
  _projectName: string,
  files: { name: string; content: string }[],
): Promise<ExportToFolderResult | null> {
  if (isTauri) {
    // Tauri: use native dialog to pick a directory, then write files
    const { open: openDialog } = await import('@tauri-apps/plugin-dialog');
    const folder = await openDialog({ directory: true, title: 'Kies een map om te exporteren' });
    if (!folder) return null;

    const { writeTextFile } = await import('@tauri-apps/plugin-fs');
    const written: string[] = [];
    for (const file of files) {
      const fullPath = `${folder}/${file.name}`;
      await writeTextFile(fullPath, file.content);
      written.push(file.name);
    }
    return { folder: folder as string, files: written };
  }

  // Browser: use File System Access API (directory picker)
  if (!hasDirectoryAccess()) {
    // Fallback: download each file individually
    for (const file of files) {
      browserDownload(file.content, file.name);
    }
    return { folder: 'Downloads', files: files.map(f => f.name) };
  }

  try {
    const dirHandle = await window.showDirectoryPicker!({
      id: 'export-folder',
      mode: 'readwrite',
      startIn: 'documents',
    });

    const written: string[] = [];
    for (const file of files) {
      const fileHandle = await dirHandle.getFileHandle(file.name, { create: true });
      const writable = await fileHandle.createWritable();
      await writable.write(file.content);
      await writable.close();
      written.push(file.name);
    }
    return { folder: dirHandle.name, files: written };
  } catch (err: unknown) {
    // User cancelled the picker
    if (err instanceof DOMException && err.name === 'AbortError') {
      return null;
    }
    throw err;
  }
}
