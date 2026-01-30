/**
 * UI Slice - Manages dialog states, file state, and other UI concerns
 */

import type { Shape, Layer, Drawing, Sheet, Viewport } from './types';
import type { HistoryEntry } from './historySlice';
import { generateId, DEFAULT_DRAWING_BOUNDARY } from './types';

// Legacy type alias
type Draft = Drawing;

// ============================================================================
// State Interface
// ============================================================================

export interface UIState {
  // Dialogs
  printDialogOpen: boolean;
  aboutDialogOpen: boolean;
  titleBlockEditorOpen: boolean;
  newSheetDialogOpen: boolean;

  // File state
  currentFilePath: string | null;
  projectName: string;
  isModified: boolean;
}

// ============================================================================
// Actions Interface
// ============================================================================

export interface UIActions {
  setPrintDialogOpen: (open: boolean) => void;
  setAboutDialogOpen: (open: boolean) => void;
  setTitleBlockEditorOpen: (open: boolean) => void;
  setNewSheetDialogOpen: (open: boolean) => void;
  setFilePath: (path: string | null) => void;
  setProjectName: (name: string) => void;
  setModified: (modified: boolean) => void;
  newProject: () => void;
  loadProject: (data: {
    shapes: Shape[];
    layers: Layer[];
    activeLayerId: string;
    viewport?: { zoom: number; offsetX: number; offsetY: number };
    settings?: { gridSize: number; gridVisible: boolean; snapEnabled: boolean };
    // V2 fields (supports both old and new naming)
    drawings?: Drawing[];
    drafts?: Drawing[];  // Legacy support
    sheets?: Sheet[];
    activeDrawingId?: string;
    activeDraftId?: string;  // Legacy support
    activeSheetId?: string | null;
    drawingViewports?: Record<string, Viewport>;
    draftViewports?: Record<string, Viewport>;  // Legacy support
  }, filePath?: string, projectName?: string) => void;
}

export type UISlice = UIState & UIActions;

// ============================================================================
// Initial State
// ============================================================================

export const initialUIState: UIState = {
  printDialogOpen: false,
  aboutDialogOpen: false,
  titleBlockEditorOpen: false,
  newSheetDialogOpen: false,
  currentFilePath: null,
  projectName: 'Untitled',
  isModified: false,
};

// ============================================================================
// Slice Creator
// ============================================================================

// Type for the full store that this slice needs access to
interface FullStore {
  // UI State
  printDialogOpen: boolean;
  aboutDialogOpen: boolean;
  titleBlockEditorOpen: boolean;
  newSheetDialogOpen: boolean;
  currentFilePath: string | null;
  projectName: string;
  isModified: boolean;

  // Model state (needed for newProject/loadProject)
  drawings: Drawing[];
  sheets: Sheet[];
  shapes: Shape[];
  layers: Layer[];
  activeDrawingId: string;
  activeSheetId: string | null;
  activeLayerId: string;
  editorMode: 'drawing' | 'sheet';
  drawingViewports: Record<string, Viewport>;
  viewport: Viewport;
  selectedShapeIds: string[];

  // History state
  historyStack: HistoryEntry[];
  historyIndex: number;

  // Tool state
  drawingPoints: any[];
  drawingPreview: any;
  commandPreviewShapes: Shape[];

  // Snap state
  gridSize: number;
  gridVisible: boolean;
  snapEnabled: boolean;
}

export const createUISlice = (
  set: (fn: (state: FullStore) => void) => void,
  _get: () => FullStore
): UIActions => ({
  setPrintDialogOpen: (open) =>
    set((state) => {
      state.printDialogOpen = open;
    }),

  setAboutDialogOpen: (open) =>
    set((state) => {
      state.aboutDialogOpen = open;
    }),

  setTitleBlockEditorOpen: (open) =>
    set((state) => {
      state.titleBlockEditorOpen = open;
    }),

  setNewSheetDialogOpen: (open) =>
    set((state) => {
      state.newSheetDialogOpen = open;
    }),

  setFilePath: (path) =>
    set((state) => {
      state.currentFilePath = path;
    }),

  setProjectName: (name) =>
    set((state) => {
      state.projectName = name;
    }),

  setModified: (modified) =>
    set((state) => {
      state.isModified = modified;
    }),

  newProject: () =>
    set((state) => {
      // Create new default drawing
      const newDrawingId = generateId();
      const newLayerId = generateId();

      state.drawings = [{
        id: newDrawingId,
        name: 'Drawing 1',
        boundary: { ...DEFAULT_DRAWING_BOUNDARY },
        createdAt: new Date().toISOString(),
        modifiedAt: new Date().toISOString(),
      }];
      state.sheets = [];
      state.editorMode = 'drawing';
      state.activeDrawingId = newDrawingId;
      state.activeSheetId = null;
      state.drawingViewports = { [newDrawingId]: { offsetX: 0, offsetY: 0, zoom: 1 } };

      state.shapes = [];
      state.selectedShapeIds = [];
      state.layers = [
        {
          id: newLayerId,
          name: 'Layer 0',
          drawingId: newDrawingId,
          visible: true,
          locked: false,
          color: '#ffffff',
          lineStyle: 'solid',
          lineWidth: 1,
        },
      ];
      state.activeLayerId = newLayerId;
      state.viewport = { zoom: 1, offsetX: 0, offsetY: 0 };
      state.historyStack = [];
      state.historyIndex = -1;
      state.currentFilePath = null;
      state.projectName = 'Untitled';
      state.isModified = false;
      state.drawingPoints = [];
      state.drawingPreview = null;
      state.commandPreviewShapes = [];
    }),

  loadProject: (data, filePath, projectName) =>
    set((state) => {
      // Handle both V1 (legacy) and V2 data formats
      // Support both old 'drafts' and new 'drawings' property names
      const dataWithDrawings = data as {
        shapes: Shape[];
        layers: Layer[];
        activeLayerId: string;
        viewport?: { zoom: number; offsetX: number; offsetY: number };
        settings?: { gridSize: number; gridVisible: boolean; snapEnabled: boolean };
        // V2 fields (supports both old and new names)
        drawings?: Drawing[];
        drafts?: Draft[];  // Legacy support
        sheets?: Sheet[];
        activeDrawingId?: string;
        activeDraftId?: string;  // Legacy support
        activeSheetId?: string | null;
        drawingViewports?: Record<string, Viewport>;
        draftViewports?: Record<string, Viewport>;  // Legacy support
      };

      // Use drawings if available, fall back to drafts for legacy files
      const loadedDrawings = dataWithDrawings.drawings || dataWithDrawings.drafts;
      const loadedActiveDrawingId = dataWithDrawings.activeDrawingId || dataWithDrawings.activeDraftId;
      const loadedDrawingViewports = dataWithDrawings.drawingViewports || dataWithDrawings.draftViewports;

      if (loadedDrawings && loadedDrawings.length > 0) {
        // V2 format - has drawings and sheets
        // Ensure all drawings have boundaries (migration for older V2 files)
        state.drawings = loadedDrawings.map(drawing => ({
          ...drawing,
          boundary: drawing.boundary || { ...DEFAULT_DRAWING_BOUNDARY },
        }));
        state.sheets = dataWithDrawings.sheets || [];
        state.activeDrawingId = loadedActiveDrawingId || loadedDrawings[0].id;
        state.activeSheetId = dataWithDrawings.activeSheetId || null;
        state.drawingViewports = loadedDrawingViewports || {};
        state.editorMode = dataWithDrawings.activeSheetId ? 'sheet' : 'drawing';
      } else {
        // V1 format - create a default drawing and assign all shapes/layers to it
        const newDrawingId = generateId();
        state.drawings = [{
          id: newDrawingId,
          name: 'Drawing 1',
          boundary: { ...DEFAULT_DRAWING_BOUNDARY },
          createdAt: new Date().toISOString(),
          modifiedAt: new Date().toISOString(),
        }];
        state.sheets = [];
        state.activeDrawingId = newDrawingId;
        state.activeSheetId = null;
        state.drawingViewports = { [newDrawingId]: data.viewport || { offsetX: 0, offsetY: 0, zoom: 1 } };
        state.editorMode = 'drawing';

        // Assign drawingId to all shapes and layers if they don't have one
        data.shapes.forEach((shape: Shape) => {
          if (!shape.drawingId) {
            (shape as Shape).drawingId = newDrawingId;
          }
        });
        data.layers.forEach((layer: Layer) => {
          if (!layer.drawingId) {
            (layer as Layer).drawingId = newDrawingId;
          }
        });
      }

      state.shapes = data.shapes;
      state.layers = data.layers;
      state.activeLayerId = data.activeLayerId;
      state.selectedShapeIds = [];
      if (data.viewport) {
        state.viewport = data.viewport;
      }
      if (data.settings) {
        state.gridSize = data.settings.gridSize;
        state.gridVisible = data.settings.gridVisible;
        state.snapEnabled = data.settings.snapEnabled;
      }
      state.historyStack = [];
      state.historyIndex = -1;
      state.currentFilePath = filePath || null;
      state.projectName = projectName || 'Untitled';
      state.isModified = false;
      state.drawingPoints = [];
      state.drawingPreview = null;
      state.commandPreviewShapes = [];
    }),
});
