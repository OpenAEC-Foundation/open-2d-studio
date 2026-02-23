/**
 * Drawing Placement Slice - Manages drawing-to-sheet placement state
 * (drag-and-drop placement of drawings onto sheets as viewports)
 * Also supports query table placement onto sheets.
 *
 * Includes:
 * - Placement mode state
 * - Preview position tracking
 * - Scale selection
 * - Viewport creation
 * - Query table creation
 */

import type {
  Point,
  Sheet,
  Drawing,
  SheetViewport,
} from './types';
import type { SheetQueryTable } from '../../types/geometry';
import { generateId } from './types';
import type { SavedQuery } from './parametricSlice';

// ============================================================================
// State Interface
// ============================================================================

export interface DrawingPlacementState {
  // Whether placement mode is active
  isPlacing: boolean;
  // ID of the drawing being placed (null when placing a query)
  placingDrawingId: string | null;
  // ID of the query being placed (null when placing a drawing)
  placingQueryId: string | null;
  // Current preview position on sheet (in mm)
  previewPosition: Point | null;
  // Scale for the new viewport (e.g., 0.01 = 1:100)
  placementScale: number;
}

// Legacy alias
export type DraftPlacementState = DrawingPlacementState;

// ============================================================================
// Actions Interface
// ============================================================================

export interface DrawingPlacementActions {
  // Start placement mode with a specific drawing
  startDrawingPlacement: (drawingId: string) => void;
  // Start placement mode with a specific query table
  startQueryPlacement: (queryId: string) => void;
  // Update the preview position during drag/hover
  updatePlacementPreview: (sheetPosition: Point | null) => void;
  // Confirm placement and create viewport or query table at current position
  confirmPlacement: () => void;
  // Cancel placement mode
  cancelPlacement: () => void;
  // Change the placement scale
  setPlacementScale: (scale: number) => void;
}

// Legacy alias
export type DraftPlacementActions = DrawingPlacementActions;

export type DrawingPlacementSlice = DrawingPlacementState & DrawingPlacementActions;
export type DraftPlacementSlice = DrawingPlacementSlice;

// ============================================================================
// Initial State
// ============================================================================

export const initialDrawingPlacementState: DrawingPlacementState = {
  isPlacing: false,
  placingDrawingId: null,
  placingQueryId: null,
  previewPosition: null,
  placementScale: 0.01, // Default 1:100
};

// Legacy alias
export const initialDraftPlacementState = initialDrawingPlacementState;

// ============================================================================
// Default query table dimensions
// ============================================================================

const DEFAULT_COLUMN_WIDTH = 25; // mm
const DEFAULT_ROW_HEIGHT = 6;    // mm
const DEFAULT_HEADER_HEIGHT = 8; // mm

// ============================================================================
// Slice Creator
// ============================================================================

// Type for the full store that this slice needs access to
interface FullStore extends DrawingPlacementState {
  sheets: Sheet[];
  activeSheetId: string | null;
  drawings: Drawing[];
  isModified: boolean;
  editorMode: 'drawing' | 'sheet';
  queries: SavedQuery[];
}

// Helper to calculate viewport size based on drawing boundary and scale
const calculateViewportSize = (drawing: Drawing, scale: number): { width: number; height: number } => {
  const boundary = drawing.boundary;
  // Convert drawing units to sheet mm using scale
  // At 1:100 (scale = 0.01), 1000 drawing units = 10mm on sheet
  return {
    width: boundary.width * scale,
    height: boundary.height * scale,
  };
};

export const createDrawingPlacementSlice = (
  set: (fn: (state: FullStore) => void) => void,
  _get: () => FullStore
): DrawingPlacementActions => ({
  startDrawingPlacement: (drawingId) =>
    set((state) => {
      // Only allow placement in sheet mode
      if (state.editorMode !== 'sheet') return;
      if (!state.activeSheetId) return;

      // Verify drawing exists
      const drawing = state.drawings.find((d) => d.id === drawingId);
      if (!drawing) return;

      state.isPlacing = true;
      state.placingDrawingId = drawingId;
      state.placingQueryId = null;
      state.previewPosition = null;
      // Use the drawing's scale as the default placement scale
      state.placementScale = drawing.scale;
    }),

  startQueryPlacement: (queryId) =>
    set((state) => {
      // Only allow placement in sheet mode
      if (state.editorMode !== 'sheet') return;
      if (!state.activeSheetId) return;

      // Verify query exists
      const query = state.queries.find((q) => q.id === queryId);
      if (!query) return;

      state.isPlacing = true;
      state.placingDrawingId = null;
      state.placingQueryId = queryId;
      state.previewPosition = null;
    }),

  updatePlacementPreview: (sheetPosition) =>
    set((state) => {
      if (!state.isPlacing) return;
      state.previewPosition = sheetPosition;
    }),

  confirmPlacement: () =>
    set((state) => {
      if (!state.isPlacing || !state.previewPosition || !state.activeSheetId) {
        return;
      }

      const sheet = state.sheets.find((s) => s.id === state.activeSheetId);
      if (!sheet) return;

      // Handle drawing placement
      if (state.placingDrawingId) {
        const drawing = state.drawings.find((d) => d.id === state.placingDrawingId);
        if (!drawing) return;

        // Calculate viewport size
        const { width, height } = calculateViewportSize(drawing, state.placementScale);

        // Create the viewport centered on the preview position
        const drawingCenterX = drawing.boundary.x + drawing.boundary.width / 2;
        const drawingCenterY = drawing.boundary.y + drawing.boundary.height / 2;

        const newViewport: SheetViewport = {
          id: generateId(),
          drawingId: state.placingDrawingId,
          x: state.previewPosition.x - width / 2,
          y: state.previewPosition.y - height / 2,
          width,
          height,
          centerX: drawingCenterX,
          centerY: drawingCenterY,
          scale: state.placementScale,
          locked: false,
          visible: true,
        };

        sheet.viewports.push(newViewport);
      }

      // Handle query table placement
      if (state.placingQueryId) {
        const query = state.queries.find((q) => q.id === state.placingQueryId);
        if (!query) return;

        // Estimate table size: use 4 columns as default, will be updated on render
        const numCols = 4;
        const numRows = 5; // Default estimate
        const columnWidths = Array(numCols).fill(DEFAULT_COLUMN_WIDTH);
        const tableWidth = columnWidths.reduce((a, b) => a + b, 0);
        const tableHeight = DEFAULT_HEADER_HEIGHT + numRows * DEFAULT_ROW_HEIGHT;

        const newTable: SheetQueryTable = {
          id: generateId(),
          queryId: state.placingQueryId,
          x: state.previewPosition.x - tableWidth / 2,
          y: state.previewPosition.y - tableHeight / 2,
          width: tableWidth,
          height: tableHeight,
          columnWidths,
          rowHeight: DEFAULT_ROW_HEIGHT,
          headerHeight: DEFAULT_HEADER_HEIGHT,
          fontSize: 7,
          headerFontSize: 8,
          locked: false,
          visible: true,
        };

        // Ensure queryTables array exists
        if (!sheet.queryTables) {
          sheet.queryTables = [];
        }
        sheet.queryTables.push(newTable);
      }

      sheet.modifiedAt = new Date().toISOString();

      // Reset placement state
      state.isPlacing = false;
      state.placingDrawingId = null;
      state.placingQueryId = null;
      state.previewPosition = null;
      state.isModified = true;
    }),

  cancelPlacement: () =>
    set((state) => {
      state.isPlacing = false;
      state.placingDrawingId = null;
      state.placingQueryId = null;
      state.previewPosition = null;
    }),

  setPlacementScale: (scale) =>
    set((state) => {
      // Clamp scale to reasonable values (1:1 to 1:1000)
      state.placementScale = Math.max(0.001, Math.min(1, scale));
    }),
});

// Legacy alias
export const createDraftPlacementSlice = createDrawingPlacementSlice;
