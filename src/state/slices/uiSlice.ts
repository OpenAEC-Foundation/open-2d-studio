/**
 * UI Slice - Manages dialog states, file state, and other UI concerns
 */

import type { Shape, Layer, Drawing, Sheet, Viewport } from './types';
import type { HistoryEntry } from './historySlice';
import { generateId, DEFAULT_DRAWING_BOUNDARY, DEFAULT_DRAWING_SCALE } from './types';
import { DEFAULT_PROJECT_INFO } from '../../types/projectInfo';

// Legacy type alias
type Draft = Drawing;

// ============================================================================
// Print Settings Types
// ============================================================================

export type PrintRange = 'currentView' | 'visiblePortion' | 'selectedSheets';
export type PrintAppearance = 'color' | 'grayscale' | 'blackLines';
export type RasterQuality = 'draft' | 'normal' | 'high' | 'presentation';

export interface PrintSettings {
  paperSize: string;
  orientation: 'portrait' | 'landscape';
  plotArea: 'extents' | 'display' | 'window';
  scale: string;
  customScale?: number;
  centerPlot: boolean;
  offsetX: number;
  offsetY: number;
  margins: { top: number; right: number; bottom: number; left: number };
  plotLineweights: boolean;
  appearance: PrintAppearance;
  rasterQuality: RasterQuality;
  copies: number;
  printRange: PrintRange;
  selectedSheetIds: string[];
  combineSheets: boolean;
}

export const DEFAULT_PRINT_SETTINGS: PrintSettings = {
  paperSize: 'A4',
  orientation: 'landscape',
  plotArea: 'extents',
  scale: 'Fit',
  centerPlot: true,
  offsetX: 0,
  offsetY: 0,
  margins: { top: 10, right: 10, bottom: 10, left: 10 },
  plotLineweights: true,
  appearance: 'color',
  rasterQuality: 'normal',
  copies: 1,
  printRange: 'currentView',
  selectedSheetIds: [],
  combineSheets: true,
};

// ============================================================================
// State Interface
// ============================================================================

export type SettingsDialogTab = 'drawing-aids' | 'grid-snap' | 'display' | 'units-scale';

export interface UIState {
  // Dialogs
  printDialogOpen: boolean;
  aboutDialogOpen: boolean;
  titleBlockEditorOpen: boolean;
  newSheetDialogOpen: boolean;
  findReplaceDialogOpen: boolean;
  feedbackDialogOpen: boolean;
  settingsDialogOpen: boolean;
  settingsDialogTab: SettingsDialogTab;

  // PDF Underlay dialog
  pdfUnderlayDialogOpen: boolean;
  pdfUnderlayFileName: string;

  // Terminal
  terminalOpen: boolean;
  terminalHeight: number;

  // Sidebar collapse
  leftSidebarCollapsed: boolean;
  rightSidebarCollapsed: boolean;

  // File state
  currentFilePath: string | null;
  projectName: string;
  isModified: boolean;

  // Print
  printSettings: PrintSettings;
  savedPrintPresets: Record<string, PrintSettings>;
}

// ============================================================================
// Actions Interface
// ============================================================================

export interface UIActions {
  setPrintDialogOpen: (open: boolean) => void;
  setAboutDialogOpen: (open: boolean) => void;
  setTitleBlockEditorOpen: (open: boolean) => void;
  setNewSheetDialogOpen: (open: boolean) => void;
  setFindReplaceDialogOpen: (open: boolean) => void;
  setFeedbackDialogOpen: (open: boolean) => void;
  setSettingsDialogOpen: (open: boolean) => void;
  setSettingsDialogTab: (tab: SettingsDialogTab) => void;
  openSettings: (tab?: SettingsDialogTab) => void;
  openPdfUnderlayDialog: (data: ArrayBuffer, fileName: string) => void;
  closePdfUnderlayDialog: () => void;
  setTerminalOpen: (open: boolean) => void;
  toggleTerminal: () => void;
  setTerminalHeight: (height: number) => void;
  toggleLeftSidebar: () => void;
  toggleRightSidebar: () => void;
  setLeftSidebarCollapsed: (collapsed: boolean) => void;
  setRightSidebarCollapsed: (collapsed: boolean) => void;
  setFilePath: (path: string | null) => void;
  setProjectName: (name: string) => void;
  setModified: (modified: boolean) => void;
  setPrintSettings: (settings: Partial<PrintSettings>) => void;
  savePrintPreset: (name: string) => void;
  deletePrintPreset: (name: string) => void;
  loadPrintPreset: (name: string) => void;
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
    sheetViewports?: Record<string, Viewport>;
  }, filePath?: string, projectName?: string) => void;
}

export type UISlice = UIState & UIActions;

// ============================================================================
// Initial State
// ============================================================================

/**
 * Module-level cache for PDF underlay data (ArrayBuffer).
 * Kept outside the immer store because immer cannot freeze/proxy ArrayBuffer.
 */
let _pdfUnderlayDataCache: ArrayBuffer | null = null;

/** Get the cached PDF data for the currently-open underlay dialog */
export function getPdfUnderlayData(): ArrayBuffer | null {
  return _pdfUnderlayDataCache;
}

export const initialUIState: UIState = {
  printDialogOpen: false,
  aboutDialogOpen: false,
  titleBlockEditorOpen: false,
  newSheetDialogOpen: false,
  findReplaceDialogOpen: false,
  feedbackDialogOpen: false,
  settingsDialogOpen: false,
  settingsDialogTab: 'drawing-aids' as SettingsDialogTab,
  pdfUnderlayDialogOpen: false,
  pdfUnderlayFileName: '',
  terminalOpen: false,
  terminalHeight: 200,
  leftSidebarCollapsed: false,
  rightSidebarCollapsed: false,
  currentFilePath: null,
  projectName: 'Untitled',
  isModified: false,
  printSettings: { ...DEFAULT_PRINT_SETTINGS },
  savedPrintPresets: {},
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
  findReplaceDialogOpen: boolean;
  feedbackDialogOpen: boolean;
  settingsDialogOpen: boolean;
  settingsDialogTab: SettingsDialogTab;
  pdfUnderlayDialogOpen: boolean;
  pdfUnderlayFileName: string;
  terminalOpen: boolean;
  terminalHeight: number;
  leftSidebarCollapsed: boolean;
  rightSidebarCollapsed: boolean;
  currentFilePath: string | null;
  projectName: string;
  isModified: boolean;
  printSettings: PrintSettings;
  savedPrintPresets: Record<string, PrintSettings>;

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
  sheetViewports: Record<string, Viewport>;
  viewport: Viewport;
  selectedShapeIds: string[];

  // History state
  historyStack: HistoryEntry[];
  historyIndex: number;

  // Tool state
  drawingPoints: any[];
  drawingPreview: any;

  // Snap state
  gridSize: number;
  gridVisible: boolean;
  snapEnabled: boolean;

  // Project info
  projectInfo: import('../../types/projectInfo').ProjectInfo;
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

  setFindReplaceDialogOpen: (open) =>
    set((state) => {
      state.findReplaceDialogOpen = open;
    }),

  setFeedbackDialogOpen: (open) =>
    set((state) => {
      state.feedbackDialogOpen = open;
    }),

  setSettingsDialogOpen: (open) =>
    set((state) => {
      state.settingsDialogOpen = open;
    }),

  setSettingsDialogTab: (tab) =>
    set((state) => {
      state.settingsDialogTab = tab;
    }),

  openSettings: (tab) =>
    set((state) => {
      state.settingsDialogTab = tab || 'drawing-aids';
      state.settingsDialogOpen = true;
    }),

  openPdfUnderlayDialog: (data, fileName) => {
    _pdfUnderlayDataCache = data;
    set((state) => {
      state.pdfUnderlayDialogOpen = true;
      state.pdfUnderlayFileName = fileName;
    });
  },

  closePdfUnderlayDialog: () => {
    _pdfUnderlayDataCache = null;
    set((state) => {
      state.pdfUnderlayDialogOpen = false;
      state.pdfUnderlayFileName = '';
    });
  },

  setTerminalOpen: (open) =>
    set((state) => {
      state.terminalOpen = open;
    }),

  toggleTerminal: () =>
    set((state) => {
      state.terminalOpen = !state.terminalOpen;
    }),

  setTerminalHeight: (height) =>
    set((state) => {
      state.terminalHeight = height;
    }),

  toggleLeftSidebar: () =>
    set((state) => {
      state.leftSidebarCollapsed = !state.leftSidebarCollapsed;
    }),

  toggleRightSidebar: () =>
    set((state) => {
      state.rightSidebarCollapsed = !state.rightSidebarCollapsed;
    }),

  setLeftSidebarCollapsed: (collapsed) =>
    set((state) => {
      state.leftSidebarCollapsed = collapsed;
    }),

  setRightSidebarCollapsed: (collapsed) =>
    set((state) => {
      state.rightSidebarCollapsed = collapsed;
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

  setPrintSettings: (updates) =>
    set((state) => {
      Object.assign(state.printSettings, updates);
    }),

  savePrintPreset: (name) =>
    set((state) => {
      state.savedPrintPresets[name] = JSON.parse(JSON.stringify(state.printSettings));
    }),

  deletePrintPreset: (name) =>
    set((state) => {
      delete state.savedPrintPresets[name];
    }),

  loadPrintPreset: (name) =>
    set((state) => {
      const preset = state.savedPrintPresets[name];
      if (preset) {
        state.printSettings = JSON.parse(JSON.stringify(preset));
      }
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
        scale: DEFAULT_DRAWING_SCALE,
        drawingType: 'standalone',
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
      state.projectInfo = { ...DEFAULT_PROJECT_INFO };
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
        sheetViewports?: Record<string, Viewport>;
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
          scale: drawing.scale || DEFAULT_DRAWING_SCALE,
        }));
        state.sheets = dataWithDrawings.sheets || [];
        state.activeDrawingId = loadedActiveDrawingId || loadedDrawings[0].id;
        state.activeSheetId = dataWithDrawings.activeSheetId || null;
        state.drawingViewports = loadedDrawingViewports || {};
        state.sheetViewports = dataWithDrawings.sheetViewports || {};
        state.editorMode = dataWithDrawings.activeSheetId ? 'sheet' : 'drawing';
      } else {
        // V1 format - create a default drawing and assign all shapes/layers to it
        const newDrawingId = generateId();
        state.drawings = [{
          id: newDrawingId,
          name: 'Drawing 1',
          boundary: { ...DEFAULT_DRAWING_BOUNDARY },
          scale: DEFAULT_DRAWING_SCALE,
          drawingType: 'standalone',
          createdAt: new Date().toISOString(),
          modifiedAt: new Date().toISOString(),
        }];
        state.sheets = [];
        state.activeDrawingId = newDrawingId;
        state.activeSheetId = null;
        state.drawingViewports = { [newDrawingId]: data.viewport || { offsetX: 0, offsetY: 0, zoom: 1 } };
        state.sheetViewports = {};
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
      state.projectInfo = { ...DEFAULT_PROJECT_INFO };
    }),
});
