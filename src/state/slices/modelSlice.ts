/**
 * Model Slice - Manages drawings, sheets, shapes, and layers
 * This is the core data model of the application
 */

import type {
  Shape,
  Layer,
  Drawing,
  DrawingBoundary,
  Sheet,
  SheetViewport,
  Viewport,
  EditorMode,
  PaperSize,
  PaperOrientation,
} from './types';

import type {
  TitleBlockTemplate,
  EnhancedTitleBlock,
  SheetTemplate,
} from '../../types/sheet';

import {
  generateId,
  DEFAULT_DRAWING_BOUNDARY,
  createDefaultTitleBlock,
  getShapeBounds,
} from './types';

import { produceWithPatches, current } from 'immer';
import type { HistoryEntry } from './historySlice';

import {
  BUILT_IN_TEMPLATES,
  createTitleBlockFromTemplate,
  addRevision as addRevisionToTable,
  getTemplatesForPaperSize,
  calculateAutoFields,
  type AutoFieldContext,
} from '../../services/titleBlockService';

import {
  BUILT_IN_SHEET_TEMPLATES,
  createViewportsFromTemplate,
  getNextSheetNumber,
  DEFAULT_NUMBERING_SCHEME,
  type SheetNumberingScheme,
} from '../../services/sheetTemplateService';

// ============================================================================
// State Interface
// ============================================================================

export interface ModelState {
  // Drawings (Model Space)
  drawings: Drawing[];
  activeDrawingId: string;

  // Sheets (Paper Space)
  sheets: Sheet[];
  activeSheetId: string | null;
  editorMode: EditorMode;

  // Per-drawing viewport state (stores zoom/pan for each drawing)
  drawingViewports: Record<string, Viewport>;

  // Shapes
  shapes: Shape[];

  // Layers
  layers: Layer[];
  activeLayerId: string;

  // Title Block Templates (user-created, built-in are in service)
  customTitleBlockTemplates: TitleBlockTemplate[];

  // Sheet Templates (user-created, built-in are in service)
  customSheetTemplates: SheetTemplate[];
}

// ============================================================================
// Actions Interface
// ============================================================================

export interface ModelActions {
  // Shape actions
  addShape: (shape: Shape) => void;
  addShapes: (shapes: Shape[]) => void;
  updateShape: (id: string, updates: Partial<Shape>) => void;
  updateShapes: (updates: { id: string; updates: Partial<Shape> }[]) => void;
  deleteShape: (id: string) => void;
  deleteShapes: (ids: string[]) => void;
  deleteSelectedShapes: () => void;

  // Drawing actions
  addDrawing: (name?: string) => void;
  deleteDrawing: (id: string) => void;
  renameDrawing: (id: string, name: string) => void;
  updateDrawingBoundary: (id: string, boundary: Partial<DrawingBoundary>) => void;
  fitBoundaryToContent: (id: string, padding?: number) => void;
  switchToDrawing: (id: string) => void;

  // Sheet actions
  addSheet: (name?: string, paperSize?: PaperSize, orientation?: PaperOrientation) => void;
  deleteSheet: (id: string) => void;
  renameSheet: (id: string, name: string) => void;
  updateSheet: (id: string, updates: Partial<Sheet>) => void;
  switchToSheet: (id: string) => void;
  switchToDrawingMode: () => void;

  // Sheet Viewport actions
  addSheetViewport: (sheetId: string, drawingId: string, bounds: { x: number; y: number; width: number; height: number }) => void;
  updateSheetViewport: (sheetId: string, viewportId: string, updates: Partial<SheetViewport>) => void;
  deleteSheetViewport: (sheetId: string, viewportId: string) => void;
  centerViewportOnDrawing: (viewportId: string) => void;
  fitViewportToDrawing: (viewportId: string) => void;

  // Title Block actions
  updateTitleBlockField: (sheetId: string, fieldId: string, value: string) => void;
  setTitleBlockVisible: (sheetId: string, visible: boolean) => void;
  applyTitleBlockTemplate: (sheetId: string, templateId: string) => void;
  addRevisionToSheet: (sheetId: string, description: string, drawnBy: string) => void;
  setTitleBlockLogo: (sheetId: string, logoData: string, width: number, height: number) => void;
  removeTitleBlockLogo: (sheetId: string) => void;

  // Title Block Template actions
  addCustomTemplate: (template: TitleBlockTemplate) => void;
  updateCustomTemplate: (templateId: string, updates: Partial<TitleBlockTemplate>) => void;
  deleteCustomTemplate: (templateId: string) => void;
  getAvailableTemplates: (paperSize: string) => TitleBlockTemplate[];
  updateAutoFields: (sheetId: string, projectName?: string) => void;

  // Sheet Template actions
  addSheetFromTemplate: (templateId: string, name: string, draftAssignments?: Record<string, string>) => void;
  saveSheetAsTemplate: (sheetId: string, name: string, description: string) => void;
  addCustomSheetTemplate: (template: SheetTemplate) => void;
  deleteCustomSheetTemplate: (templateId: string) => void;
  renumberAllSheets: (scheme: SheetNumberingScheme) => void;

  // Layer actions
  addLayer: (name?: string) => void;
  updateLayer: (id: string, updates: Partial<Layer>) => void;
  deleteLayer: (id: string) => void;
  setActiveLayer: (id: string) => void;
}

export type ModelSlice = ModelState & ModelActions;

// ============================================================================
// Initial State
// ============================================================================

const defaultDrawingId = 'drawing-1';

const defaultDrawing: Drawing = {
  id: defaultDrawingId,
  name: 'Drawing 1',
  boundary: { ...DEFAULT_DRAWING_BOUNDARY },
  createdAt: new Date().toISOString(),
  modifiedAt: new Date().toISOString(),
};

const defaultLayer: Layer = {
  id: 'layer-0',
  name: 'Layer 0',
  drawingId: defaultDrawingId,
  visible: true,
  locked: false,
  color: '#ffffff',
  lineStyle: 'solid',
  lineWidth: 1,
};

export const initialModelState: ModelState = {
  drawings: [defaultDrawing],
  activeDrawingId: defaultDrawingId,
  sheets: [],
  activeSheetId: null,
  editorMode: 'drawing',
  drawingViewports: { [defaultDrawingId]: { offsetX: 0, offsetY: 0, zoom: 1 } },
  shapes: [],
  layers: [defaultLayer],
  activeLayerId: defaultLayer.id,
  customTitleBlockTemplates: [],
  customSheetTemplates: [],
};

// ============================================================================
// Slice Creator
// ============================================================================

// Type for the full store that this slice needs access to
interface StoreWithHistory {
  historyStack: HistoryEntry[];
  historyIndex: number;
  maxHistorySize: number;
  isModified: boolean;
  selectedShapeIds: string[];
  viewport: Viewport;
  viewportEditState: { selectedViewportId: string | null };
  canvasSize: { width: number; height: number };
}

type FullStore = ModelState & StoreWithHistory;

function withHistory(state: FullStore, mutate: (draft: Shape[]) => void): void {
  const [nextShapes, patches, inversePatches] = produceWithPatches(
    current(state.shapes),
    mutate
  );
  if (patches.length === 0) return; // No changes

  // Truncate future entries if we're not at the end
  if (state.historyIndex >= 0 && state.historyIndex < state.historyStack.length - 1) {
    state.historyStack = state.historyStack.slice(0, state.historyIndex + 1);
  }
  state.historyStack.push({ patches, inversePatches });
  if (state.historyStack.length > state.maxHistorySize) {
    state.historyStack.shift();
  }
  state.historyIndex = state.historyStack.length - 1;
  state.shapes = nextShapes as any;
  state.isModified = true;
}

export const createModelSlice = (
  set: (fn: (state: FullStore) => void) => void,
  _get: () => FullStore
): ModelActions => ({
  // ============================================================================
  // Shape Actions
  // ============================================================================

  addShape: (shape) =>
    set((state) => {
      withHistory(state, (draft) => { draft.push(shape); });
    }),

  addShapes: (shapes) =>
    set((state) => {
      if (shapes.length === 0) return;
      withHistory(state, (draft) => {
        for (const shape of shapes) draft.push(shape);
      });
    }),

  updateShape: (id, updates) =>
    set((state) => {
      withHistory(state, (draft) => {
        const index = draft.findIndex((s) => s.id === id);
        if (index !== -1) {
          draft[index] = { ...draft[index], ...updates } as Shape;
        }
      });
    }),

  updateShapes: (updates) =>
    set((state) => {
      if (updates.length === 0) return;
      withHistory(state, (draft) => {
        for (const { id, updates: u } of updates) {
          const index = draft.findIndex((s) => s.id === id);
          if (index !== -1) {
            draft[index] = { ...draft[index], ...u } as Shape;
          }
        }
      });
    }),

  deleteShape: (id) =>
    set((state) => {
      withHistory(state, (draft) => {
        const idx = draft.findIndex((s) => s.id === id);
        if (idx !== -1) draft.splice(idx, 1);
      });
      state.selectedShapeIds = state.selectedShapeIds.filter((sid) => sid !== id);
    }),

  deleteShapes: (ids) =>
    set((state) => {
      if (ids.length === 0) return;
      const idSet = new Set(ids);
      withHistory(state, (draft) => {
        for (let i = draft.length - 1; i >= 0; i--) {
          if (idSet.has(draft[i].id)) draft.splice(i, 1);
        }
      });
      state.selectedShapeIds = state.selectedShapeIds.filter((sid) => !idSet.has(sid));
    }),

  deleteSelectedShapes: () =>
    set((state) => {
      if (state.selectedShapeIds.length === 0) return;
      const selected = new Set(state.selectedShapeIds);
      withHistory(state, (draft) => {
        for (let i = draft.length - 1; i >= 0; i--) {
          if (selected.has(draft[i].id)) draft.splice(i, 1);
        }
      });
      state.selectedShapeIds = [];
    }),

  // ============================================================================
  // Drawing Actions
  // ============================================================================

  addDrawing: (name) =>
    set((state) => {
      const id = generateId();
      const newDrawing: Drawing = {
        id,
        name: name || `Drawing ${state.drawings.length + 1}`,
        boundary: { ...DEFAULT_DRAWING_BOUNDARY },
        createdAt: new Date().toISOString(),
        modifiedAt: new Date().toISOString(),
      };
      state.drawings.push(newDrawing);

      // Create a default layer for the new drawing
      const newLayer: Layer = {
        id: generateId(),
        name: 'Layer 0',
        drawingId: id,
        visible: true,
        locked: false,
        color: '#ffffff',
        lineStyle: 'solid',
        lineWidth: 1,
      };
      state.layers.push(newLayer);

      // Initialize viewport centered on boundary
      const b = newDrawing.boundary;
      const centerX = b.x + b.width / 2;
      const centerY = b.y + b.height / 2;
      state.drawingViewports[id] = {
        offsetX: state.canvasSize.width / 2 - centerX,
        offsetY: state.canvasSize.height / 2 - centerY,
        zoom: 1,
      };

      // Switch to the new drawing
      state.activeDrawingId = id;
      state.activeLayerId = newLayer.id;
      state.viewport = state.drawingViewports[id];
      state.editorMode = 'drawing';
      state.activeSheetId = null;
      state.selectedShapeIds = [];
      state.isModified = true;
    }),

  deleteDrawing: (id) =>
    set((state) => {
      // Can't delete the last drawing
      if (state.drawings.length <= 1) return;

      // Remove the drawing
      state.drawings = state.drawings.filter((d) => d.id !== id);

      // Remove all shapes belonging to this drawing
      state.shapes = state.shapes.filter((s) => s.drawingId !== id);

      // Remove all layers belonging to this drawing
      state.layers = state.layers.filter((l) => l.drawingId !== id);

      // Remove viewport for this drawing
      delete state.drawingViewports[id];

      // Remove viewports in sheets that reference this drawing
      state.sheets.forEach((sheet) => {
        sheet.viewports = sheet.viewports.filter((vp) => vp.drawingId !== id);
      });

      // If the deleted drawing was active, switch to another drawing
      if (state.activeDrawingId === id) {
        const firstDrawing = state.drawings[0];
        state.activeDrawingId = firstDrawing.id;
        state.viewport = state.drawingViewports[firstDrawing.id] || { offsetX: 0, offsetY: 0, zoom: 1 };

        // Set active layer to a layer in the new drawing
        const layerInDrawing = state.layers.find((l) => l.drawingId === firstDrawing.id);
        if (layerInDrawing) {
          state.activeLayerId = layerInDrawing.id;
        }
      }

      state.selectedShapeIds = [];
      state.isModified = true;
    }),

  renameDrawing: (id, name) =>
    set((state) => {
      const drawing = state.drawings.find((d) => d.id === id);
      if (drawing) {
        drawing.name = name;
        drawing.modifiedAt = new Date().toISOString();
        state.isModified = true;
      }
    }),

  updateDrawingBoundary: (id, boundary) =>
    set((state) => {
      const drawing = state.drawings.find((d) => d.id === id);
      if (drawing) {
        drawing.boundary = { ...drawing.boundary, ...boundary };
        drawing.modifiedAt = new Date().toISOString();
        state.isModified = true;
      }
    }),

  fitBoundaryToContent: (id, padding = 50) =>
    set((state) => {
      const drawing = state.drawings.find((d) => d.id === id);
      if (!drawing) return;

      // Get all shapes in this drawing
      const drawingShapes = state.shapes.filter((s) => s.drawingId === id);
      if (drawingShapes.length === 0) {
        // No shapes, reset to default
        drawing.boundary = { ...DEFAULT_DRAWING_BOUNDARY };
        drawing.modifiedAt = new Date().toISOString();
        state.isModified = true;
        return;
      }

      // Calculate bounding box of all shapes
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

      for (const shape of drawingShapes) {
        const bounds = getShapeBounds(shape);
        if (bounds) {
          minX = Math.min(minX, bounds.minX);
          minY = Math.min(minY, bounds.minY);
          maxX = Math.max(maxX, bounds.maxX);
          maxY = Math.max(maxY, bounds.maxY);
        }
      }

      if (minX === Infinity) return;

      // Apply padding
      drawing.boundary = {
        x: minX - padding,
        y: minY - padding,
        width: (maxX - minX) + padding * 2,
        height: (maxY - minY) + padding * 2,
      };
      drawing.modifiedAt = new Date().toISOString();
      state.isModified = true;
    }),

  switchToDrawing: (id) =>
    set((state) => {
      const drawing = state.drawings.find((d) => d.id === id);
      if (!drawing) return;

      // Save current viewport to drawingViewports if in drawing mode
      if (state.editorMode === 'drawing' && state.activeDrawingId) {
        state.drawingViewports[state.activeDrawingId] = { ...state.viewport };
      }

      state.activeDrawingId = id;
      state.editorMode = 'drawing';
      state.activeSheetId = null;
      if (state.drawingViewports[id]) {
        state.viewport = state.drawingViewports[id];
      } else {
        // Center on drawing boundary
        const b = drawing.boundary;
        const centerX = b.x + b.width / 2;
        const centerY = b.y + b.height / 2;
        const zoom = 1;
        state.viewport = {
          offsetX: state.canvasSize.width / 2 - centerX * zoom,
          offsetY: state.canvasSize.height / 2 - centerY * zoom,
          zoom,
        };
      }

      // Set active layer to a layer in this drawing
      const layerInDrawing = state.layers.find((l) => l.drawingId === id);
      if (layerInDrawing) {
        state.activeLayerId = layerInDrawing.id;
      }

      state.selectedShapeIds = [];
    }),

  // ============================================================================
  // Sheet Actions
  // ============================================================================

  addSheet: (name, paperSize = 'A4', orientation = 'landscape') =>
    set((state) => {
      const id = generateId();
      const newSheet: Sheet = {
        id,
        name: name || `Sheet ${state.sheets.length + 1}`,
        paperSize,
        orientation,
        viewports: [],
        titleBlock: createDefaultTitleBlock(),
        annotations: [],
        createdAt: new Date().toISOString(),
        modifiedAt: new Date().toISOString(),
      };
      state.sheets.push(newSheet);
      state.isModified = true;
    }),

  deleteSheet: (id) =>
    set((state) => {
      state.sheets = state.sheets.filter((s) => s.id !== id);

      // If the deleted sheet was active, switch back to drawing mode
      if (state.activeSheetId === id) {
        state.activeSheetId = null;
        state.editorMode = 'drawing';
        state.viewport = state.drawingViewports[state.activeDrawingId] || { offsetX: 0, offsetY: 0, zoom: 1 };
      }

      state.isModified = true;
    }),

  renameSheet: (id, name) =>
    set((state) => {
      const sheet = state.sheets.find((s) => s.id === id);
      if (sheet) {
        sheet.name = name;
        sheet.modifiedAt = new Date().toISOString();
        state.isModified = true;
      }
    }),

  updateSheet: (id, updates) =>
    set((state) => {
      const sheet = state.sheets.find((s) => s.id === id);
      if (sheet) {
        Object.assign(sheet, updates);
        sheet.modifiedAt = new Date().toISOString();
        state.isModified = true;
      }
    }),

  switchToSheet: (id) =>
    set((state) => {
      const sheet = state.sheets.find((s) => s.id === id);
      if (!sheet) return;

      // Save current viewport if in drawing mode
      if (state.editorMode === 'drawing' && state.activeDrawingId) {
        state.drawingViewports[state.activeDrawingId] = { ...state.viewport };
      }

      state.activeSheetId = id;
      state.editorMode = 'sheet';
      // Reset viewport for sheet mode (will be handled by sheet renderer)
      state.viewport = { offsetX: 0, offsetY: 0, zoom: 1 };
      state.selectedShapeIds = [];

      // Auto-update title block fields (Sheet X of Y, etc.)
      const sheetIndex = state.sheets.findIndex((s) => s.id === id);
      const totalSheets = state.sheets.length;
      const viewportScales = sheet.viewports.map((vp) => vp.scale);

      // Update sheet number field
      const sheetNoField = sheet.titleBlock.fields.find((f) => f.id === 'sheetNo');
      if (sheetNoField) {
        sheetNoField.value = `${sheetIndex + 1} of ${totalSheets}`;
      }

      // Update date field if empty
      const dateField = sheet.titleBlock.fields.find((f) => f.id === 'date');
      if (dateField && !dateField.value) {
        dateField.value = new Date().toISOString().split('T')[0];
      }

      // Update scale field based on viewports
      const scaleField = sheet.titleBlock.fields.find((f) => f.id === 'scale');
      if (scaleField && viewportScales.length > 0) {
        const uniqueScales = [...new Set(viewportScales)];
        if (uniqueScales.length === 1) {
          const scale = uniqueScales[0];
          if (scale >= 1) {
            scaleField.value = `${Number.isInteger(scale) ? scale : scale.toFixed(1)}:1`;
          } else {
            const inverse = 1 / scale;
            scaleField.value = `1:${Number.isInteger(inverse) ? inverse : Math.round(inverse)}`;
          }
        } else {
          scaleField.value = 'As Noted';
        }
      }
    }),

  switchToDrawingMode: () =>
    set((state) => {
      state.editorMode = 'drawing';
      state.activeSheetId = null;
      state.viewport = state.drawingViewports[state.activeDrawingId] || { offsetX: 0, offsetY: 0, zoom: 1 };
    }),

  // ============================================================================
  // Sheet Viewport Actions
  // ============================================================================

  addSheetViewport: (sheetId, drawingId, bounds) =>
    set((state) => {
      const sheet = state.sheets.find((s) => s.id === sheetId);
      if (!sheet) return;

      const newViewport: SheetViewport = {
        id: generateId(),
        drawingId,
        x: bounds.x,
        y: bounds.y,
        width: bounds.width,
        height: bounds.height,
        centerX: 0,
        centerY: 0,
        scale: 0.01,  // Default 1:100
        locked: false,
        visible: true,
      };
      sheet.viewports.push(newViewport);
      sheet.modifiedAt = new Date().toISOString();
      state.isModified = true;
    }),

  updateSheetViewport: (sheetId, viewportId, updates) =>
    set((state) => {
      const sheet = state.sheets.find((s) => s.id === sheetId);
      if (!sheet) return;

      const viewport = sheet.viewports.find((vp) => vp.id === viewportId);
      if (viewport) {
        Object.assign(viewport, updates);
        sheet.modifiedAt = new Date().toISOString();
        state.isModified = true;
      }
    }),

  deleteSheetViewport: (sheetId, viewportId) =>
    set((state) => {
      const sheet = state.sheets.find((s) => s.id === sheetId);
      if (!sheet) return;

      sheet.viewports = sheet.viewports.filter((vp) => vp.id !== viewportId);
      sheet.modifiedAt = new Date().toISOString();
      state.isModified = true;

      // Clear selection if deleted viewport was selected
      if (state.viewportEditState.selectedViewportId === viewportId) {
        state.viewportEditState.selectedViewportId = null;
      }
    }),

  centerViewportOnDrawing: (viewportId) =>
    set((state) => {
      if (!state.activeSheetId) return;

      const sheet = state.sheets.find((s) => s.id === state.activeSheetId);
      if (!sheet) return;

      const viewport = sheet.viewports.find((vp) => vp.id === viewportId);
      if (!viewport) return;

      const drawing = state.drawings.find((d) => d.id === viewport.drawingId);
      if (!drawing) return;

      // Center viewport on drawing boundary center
      viewport.centerX = drawing.boundary.x + drawing.boundary.width / 2;
      viewport.centerY = drawing.boundary.y + drawing.boundary.height / 2;
      sheet.modifiedAt = new Date().toISOString();
      state.isModified = true;
    }),

  fitViewportToDrawing: (viewportId) =>
    set((state) => {
      if (!state.activeSheetId) return;

      const sheet = state.sheets.find((s) => s.id === state.activeSheetId);
      if (!sheet) return;

      const viewport = sheet.viewports.find((vp) => vp.id === viewportId);
      if (!viewport) return;

      const drawing = state.drawings.find((d) => d.id === viewport.drawingId);
      if (!drawing) return;

      // Calculate scale to fit drawing boundary in viewport
      const scaleX = viewport.width / drawing.boundary.width;
      const scaleY = viewport.height / drawing.boundary.height;
      const scale = Math.min(scaleX, scaleY) * 0.9; // 90% to add padding

      // Center on drawing boundary
      viewport.centerX = drawing.boundary.x + drawing.boundary.width / 2;
      viewport.centerY = drawing.boundary.y + drawing.boundary.height / 2;
      viewport.scale = scale;

      sheet.modifiedAt = new Date().toISOString();
      state.isModified = true;
    }),

  // ============================================================================
  // Title Block Actions
  // ============================================================================

  updateTitleBlockField: (sheetId, fieldId, value) =>
    set((state) => {
      const sheet = state.sheets.find((s) => s.id === sheetId);
      if (!sheet) return;

      const field = sheet.titleBlock.fields.find((f) => f.id === fieldId);
      if (field) {
        field.value = value;
        sheet.modifiedAt = new Date().toISOString();
        state.isModified = true;
      }
    }),

  setTitleBlockVisible: (sheetId, visible) =>
    set((state) => {
      const sheet = state.sheets.find((s) => s.id === sheetId);
      if (sheet) {
        sheet.titleBlock.visible = visible;
        sheet.modifiedAt = new Date().toISOString();
        state.isModified = true;
      }
    }),

  applyTitleBlockTemplate: (sheetId, templateId) =>
    set((state) => {
      const sheet = state.sheets.find((s) => s.id === sheetId);
      if (!sheet) return;

      // Find template (check built-in first, then custom)
      let template = BUILT_IN_TEMPLATES.find((t) => t.id === templateId);
      if (!template) {
        template = state.customTitleBlockTemplates.find((t) => t.id === templateId);
      }
      if (!template) return;

      // Create new title block from template
      const newTitleBlock = createTitleBlockFromTemplate(template);

      // Preserve existing field values where possible
      const existingFields = sheet.titleBlock.fields;
      newTitleBlock.fields = newTitleBlock.fields.map((field) => {
        const existingField = existingFields.find((ef) => ef.id === field.id);
        if (existingField && existingField.value) {
          return { ...field, value: existingField.value };
        }
        return field;
      });

      // Apply the new title block
      sheet.titleBlock = newTitleBlock as Sheet['titleBlock'];
      sheet.modifiedAt = new Date().toISOString();
      state.isModified = true;
    }),

  addRevisionToSheet: (sheetId, description, drawnBy) =>
    set((state) => {
      const sheet = state.sheets.find((s) => s.id === sheetId);
      if (!sheet) return;

      // Get or create revision table
      const titleBlock = sheet.titleBlock as unknown as EnhancedTitleBlock;
      if (!titleBlock.revisionTable) {
        titleBlock.revisionTable = {
          visible: true,
          maxRows: 5,
          columns: [
            { id: 'number', label: 'Rev', width: 15 },
            { id: 'date', label: 'Date', width: 25 },
            { id: 'description', label: 'Description', width: 50 },
            { id: 'drawnBy', label: 'By', width: 15 },
          ],
          revisions: [],
        };
      }

      titleBlock.revisionTable = addRevisionToTable(titleBlock.revisionTable, description, drawnBy);
      titleBlock.revisionTable.visible = true;

      // Update the revision field if it exists
      const revisionField = sheet.titleBlock.fields.find((f) => f.id === 'revision');
      if (revisionField && titleBlock.revisionTable.revisions.length > 0) {
        const lastRevision = titleBlock.revisionTable.revisions[titleBlock.revisionTable.revisions.length - 1];
        revisionField.value = lastRevision.number;
      }

      sheet.modifiedAt = new Date().toISOString();
      state.isModified = true;
    }),

  setTitleBlockLogo: (sheetId, logoData, width, height) =>
    set((state) => {
      const sheet = state.sheets.find((s) => s.id === sheetId);
      if (!sheet) return;

      const titleBlock = sheet.titleBlock as unknown as EnhancedTitleBlock;
      const logoField = sheet.titleBlock.fields.find((f) => f.id === 'logo');

      titleBlock.logo = {
        data: logoData,
        x: logoField?.x ?? 5,
        y: logoField?.y ?? 5,
        width,
        height,
      };

      sheet.modifiedAt = new Date().toISOString();
      state.isModified = true;
    }),

  removeTitleBlockLogo: (sheetId) =>
    set((state) => {
      const sheet = state.sheets.find((s) => s.id === sheetId);
      if (!sheet) return;

      const titleBlock = sheet.titleBlock as unknown as EnhancedTitleBlock;
      delete titleBlock.logo;

      sheet.modifiedAt = new Date().toISOString();
      state.isModified = true;
    }),

  // ============================================================================
  // Title Block Template Actions
  // ============================================================================

  addCustomTemplate: (template) =>
    set((state) => {
      state.customTitleBlockTemplates.push(template);
      state.isModified = true;
    }),

  updateCustomTemplate: (templateId, updates) =>
    set((state) => {
      const index = state.customTitleBlockTemplates.findIndex((t) => t.id === templateId);
      if (index !== -1) {
        state.customTitleBlockTemplates[index] = {
          ...state.customTitleBlockTemplates[index],
          ...updates,
        };
        state.isModified = true;
      }
    }),

  deleteCustomTemplate: (templateId) =>
    set((state) => {
      state.customTitleBlockTemplates = state.customTitleBlockTemplates.filter(
        (t) => t.id !== templateId
      );
      state.isModified = true;
    }),

  getAvailableTemplates: (paperSize) => {
    // This is a getter that combines built-in and custom templates
    // Note: This doesn't use set() as it's a pure getter
    const builtIn = getTemplatesForPaperSize(paperSize);
    // Custom templates would need to be filtered similarly
    return builtIn;
  },

  updateAutoFields: (sheetId, projectName = '') =>
    set((state) => {
      const sheet = state.sheets.find((s) => s.id === sheetId);
      if (!sheet) return;

      // Calculate auto-field context
      const sheetIndex = state.sheets.findIndex((s) => s.id === sheetId);
      const totalSheets = state.sheets.length;

      // Get scales from all viewports
      const viewportScales = sheet.viewports.map((vp) => vp.scale);

      const context: AutoFieldContext = {
        totalSheets,
        currentSheetIndex: sheetIndex,
        projectName,
        viewportScales,
      };

      // Get enhanced title block fields
      const titleBlock = sheet.titleBlock as unknown as EnhancedTitleBlock;
      if (titleBlock.fields && titleBlock.fields.length > 0) {
        const updatedFields = calculateAutoFields(titleBlock.fields, context);
        // Apply the updated fields back
        for (const updatedField of updatedFields) {
          const field = sheet.titleBlock.fields.find((f) => f.id === updatedField.id);
          if (field) {
            field.value = updatedField.value;
          }
        }
        sheet.modifiedAt = new Date().toISOString();
      }
    }),

  // ============================================================================
  // Sheet Template Actions
  // ============================================================================

  addSheetFromTemplate: (templateId, name, draftAssignments = {}) =>
    set((state) => {
      // Find template (check built-in first, then custom)
      let template = BUILT_IN_SHEET_TEMPLATES.find((t) => t.id === templateId);
      if (!template) {
        template = state.customSheetTemplates.find((t) => t.id === templateId);
      }
      if (!template) return;

      // Generate sheet number
      const sheetNumber = getNextSheetNumber(state.sheets, DEFAULT_NUMBERING_SCHEME);

      // Create viewports from template placeholders
      const viewports = createViewportsFromTemplate(template, draftAssignments);

      // Create the sheet
      const newSheet: Sheet = {
        id: generateId(),
        name: name || `Sheet ${state.sheets.length + 1}`,
        paperSize: template.paperSize as PaperSize,
        orientation: template.orientation as PaperOrientation,
        viewports,
        titleBlock: createDefaultTitleBlock(),
        annotations: [],
        createdAt: new Date().toISOString(),
        modifiedAt: new Date().toISOString(),
      };

      // Set sheet number in title block
      const numberField = newSheet.titleBlock.fields.find((f) => f.id === 'number');
      if (numberField) {
        numberField.value = sheetNumber;
      }

      state.sheets.push(newSheet);
      state.isModified = true;

      // Switch to the new sheet
      state.activeSheetId = newSheet.id;
      state.editorMode = 'sheet';
      state.viewport = { offsetX: 0, offsetY: 0, zoom: 1 };
      state.selectedShapeIds = [];
    }),

  saveSheetAsTemplate: (sheetId, name, description) =>
    set((state) => {
      const sheet = state.sheets.find((s) => s.id === sheetId);
      if (!sheet) return;

      // Convert viewports to placeholders
      const placeholders = sheet.viewports.map((vp, index) => ({
        id: `placeholder-${index + 1}`,
        name: `View ${index + 1}`,
        x: vp.x,
        y: vp.y,
        width: vp.width,
        height: vp.height,
        defaultScale: vp.scale,
      }));

      const newTemplate: SheetTemplate = {
        id: generateId(),
        name,
        description,
        paperSize: sheet.paperSize,
        orientation: sheet.orientation,
        titleBlockTemplateId: '',
        viewportPlaceholders: placeholders,
        isBuiltIn: false,
        createdAt: new Date().toISOString(),
        modifiedAt: new Date().toISOString(),
      };

      state.customSheetTemplates.push(newTemplate);
      state.isModified = true;
    }),

  addCustomSheetTemplate: (template) =>
    set((state) => {
      state.customSheetTemplates.push(template);
      state.isModified = true;
    }),

  deleteCustomSheetTemplate: (templateId) =>
    set((state) => {
      state.customSheetTemplates = state.customSheetTemplates.filter(
        (t) => t.id !== templateId
      );
      state.isModified = true;
    }),

  renumberAllSheets: (scheme) =>
    set((state) => {
      // Renumber all sheets based on the scheme
      state.sheets.forEach((sheet, index) => {
        const newNumber = `${scheme.prefix}${scheme.separator}${(scheme.startNumber + index).toString().padStart(scheme.digits, '0')}`;

        // Update number field in title block
        const numberField = sheet.titleBlock.fields.find((f) => f.id === 'number');
        if (numberField) {
          numberField.value = newNumber;
        }

        // Also update sheetNo field if different from number
        const sheetNoField = sheet.titleBlock.fields.find((f) => f.id === 'sheetNo');
        if (sheetNoField) {
          sheetNoField.value = `${index + 1} of ${state.sheets.length}`;
        }

        sheet.modifiedAt = new Date().toISOString();
      });

      state.isModified = true;
    }),

  // ============================================================================
  // Layer Actions
  // ============================================================================

  addLayer: (name) =>
    set((state) => {
      const newLayer: Layer = {
        id: generateId(),
        name: name || `Layer ${state.layers.filter(l => l.drawingId === state.activeDrawingId).length}`,
        drawingId: state.activeDrawingId,
        visible: true,
        locked: false,
        color: '#ffffff',
        lineStyle: 'solid',
        lineWidth: 1,
      };
      state.layers.push(newLayer);
      state.activeLayerId = newLayer.id;
    }),

  updateLayer: (id, updates) =>
    set((state) => {
      const index = state.layers.findIndex((l) => l.id === id);
      if (index !== -1) {
        state.layers[index] = { ...state.layers[index], ...updates };
      }
    }),

  deleteLayer: (id) =>
    set((state) => {
      // Get layers in the current drawing
      const layersInDrawing = state.layers.filter((l) => l.drawingId === state.activeDrawingId);

      // Can't delete the last layer in a drawing
      if (layersInDrawing.length <= 1) return;

      state.layers = state.layers.filter((l) => l.id !== id);
      if (state.activeLayerId === id) {
        // Set active layer to another layer in the same drawing
        const remainingLayersInDrawing = state.layers.filter((l) => l.drawingId === state.activeDrawingId);
        state.activeLayerId = remainingLayersInDrawing[0]?.id || state.layers[0].id;
      }
      // Move shapes from deleted layer to active layer
      state.shapes.forEach((s) => {
        if (s.layerId === id) {
          s.layerId = state.activeLayerId;
        }
      });
    }),

  setActiveLayer: (id) =>
    set((state) => {
      state.activeLayerId = id;
    }),
});
