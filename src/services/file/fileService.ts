/**
 * File Service - Handles file operations (New, Open, Save, Export)
 */

import { logger } from '../log/logService';
import type { Shape, LineStyle, Layer, Drawing, Sheet, Viewport, DrawingBoundary, ImageShape } from '../../types/geometry';
export { exportToIFC } from '../export/ifcExport';
export { exportToSVG, exportToDXF } from './shapeExport';
export { showImportDxfDialog, showImportImageDialog, parseDXFInsUnits, parseDXF } from './dxfImport';
import { parseDXF } from './dxfImport';
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
  // Project structure with storeys (optional, backward compatible)
  projectStructure?: import('../../state/slices/parametricSlice').ProjectStructure;
  // Slab types (optional, backward compatible)
  slabTypes?: import('../../types/geometry').SlabType[];
  // Pile types (optional, backward compatible)
  pileTypes?: import('../../types/geometry').PileTypeDefinition[];
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
