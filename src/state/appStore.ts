/**
 * Combined App Store - Composes all slices into a single store
 *
 * This is the modular architecture that organizes state into focused slices.
 * Each slice is responsible for a specific domain of the application state.
 *
 * Slices:
 * - modelSlice: drawings, sheets, shapes, layers
 * - viewSlice: viewport, zoom, pan, canvas size
 * - toolSlice: active tool, drawing modes, style
 * - snapSlice: snap settings, tracking, polar, ortho
 * - selectionSlice: selected shapes, selection box
 * - commandSlice: command line state
 * - historySlice: undo/redo
 * - uiSlice: dialogs, file state
 * - boundarySlice: drawing boundary editing
 * - viewportEditSlice: sheet viewport editing
 */

import { enablePatches } from 'immer';
import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';

enablePatches();

// Import slice types and creators
import {
  // Types
  type ModelState,
  type ModelActions,
  type ViewState,
  type ViewActions,
  type ToolState,
  type ToolActions,
  type SnapState,
  type SnapActions,
  type SelectionState,
  type SelectionActions,
  type CommandState,
  type CommandActions,
  type HistoryState,
  type HistoryActions,
  type UIState,
  type UIActions,
  type BoundaryState,
  type BoundaryActions,
  type ViewportEditState_Full,
  type ViewportEditActions,
  type AnnotationState,
  type AnnotationActions,
  type DrawingPlacementState,
  type DrawingPlacementActions,

  // Initial states
  initialModelState,
  initialViewState,
  initialToolState,
  initialSnapState,
  initialSelectionState,
  initialCommandState,
  initialHistoryState,
  initialUIState,
  initialBoundaryState,
  initialViewportEditState,
  initialAnnotationState,
  initialDrawingPlacementState,

  // Slice creators
  createModelSlice,
  createViewSlice,
  createToolSlice,
  createSnapSlice,
  createSelectionSlice,
  createCommandSlice,
  createHistorySlice,
  createUISlice,
  createBoundarySlice,
  createViewportEditSlice,
  createAnnotationSlice,
  createDrawingPlacementSlice,
} from './slices';

// Re-export types for backward compatibility
export type {
  DrawingPreview,
  SelectionBox,
  SelectionBoxMode,
  BoundaryHandleType,
  BoundaryEditState,
  ViewportHandleType,
  ViewportEditState,
  TrackingLine,
} from './slices/types';

export {
  generateId,
  PAPER_SIZES,
  getShapeBounds,
  cloneShapes,
  defaultStyle,
  DEFAULT_DRAWING_BOUNDARY,
  DEFAULT_DRAFT_BOUNDARY, // Legacy alias
  createDefaultTitleBlock,
} from './slices/types';

// ============================================================================
// Coordinating Actions Type (cross-slice operations)
// ============================================================================

export interface CoordinatingActions {
  /** Switch to a tool, canceling any active command first */
  switchToDrawingTool: (tool: ToolState['activeTool']) => void;
  /** Switch to any tool (including select/pan), canceling any active command first */
  switchToolAndCancelCommand: (tool: ToolState['activeTool']) => void;
}

// ============================================================================
// Combined State Type
// ============================================================================

export type AppState =
  & ModelState
  & ViewState
  & ToolState
  & SnapState
  & SelectionState
  & CommandState
  & HistoryState
  & UIState
  & BoundaryState
  & ViewportEditState_Full
  & AnnotationState
  & DrawingPlacementState
  & ModelActions
  & ViewActions
  & ToolActions
  & SnapActions
  & SelectionActions
  & CommandActions
  & HistoryActions
  & UIActions
  & BoundaryActions
  & ViewportEditActions
  & AnnotationActions
  & DrawingPlacementActions
  & CoordinatingActions;

// ============================================================================
// Combined Initial State
// ============================================================================

const initialState = {
  ...initialModelState,
  ...initialViewState,
  ...initialToolState,
  ...initialSnapState,
  ...initialSelectionState,
  ...initialCommandState,
  ...initialHistoryState,
  ...initialUIState,
  ...initialBoundaryState,
  ...initialViewportEditState,
  ...initialAnnotationState,
  ...initialDrawingPlacementState,
};

// ============================================================================
// Store Creation
// ============================================================================

export const useAppStore = create<AppState>()(
  immer((set, get) => ({
    // Spread initial state
    ...initialState,

    // Compose all slice actions
    // The type assertion is needed because each slice creator expects a specific subset of state,
    // but we're passing the full store. The slices are designed to work with the full store.
    ...createModelSlice(set as any, get as any),
    ...createViewSlice(set as any, get as any),
    ...createToolSlice(set as any, get as any),
    ...createSnapSlice(set as any, get as any),
    ...createSelectionSlice(set as any, get as any),
    ...createCommandSlice(set as any, get as any),
    ...createHistorySlice(set as any, get as any),
    ...createUISlice(set as any, get as any),
    ...createBoundarySlice(set as any, get as any),
    ...createViewportEditSlice(set as any, get as any),
    ...createAnnotationSlice(set as any, get as any),
    ...createDrawingPlacementSlice(set as any, get as any),

    // ========================================================================
    // Coordinating Actions (cross-slice operations)
    // ========================================================================

    /**
     * Switch to a drawing tool, canceling any active command first.
     * This ensures commands are properly canceled when user clicks a drawing tool.
     */
    switchToDrawingTool: (tool: ToolState['activeTool']) => {
      const state = get();
      // Cancel any active command
      if (state.hasActiveModifyCommand) {
        state.requestCommandCancel();
      }
      // Then switch the tool
      state.setActiveTool(tool);
    },

    /**
     * Switch to any tool (including select/pan), canceling any active command first.
     * Use this for Select and Pan buttons to ensure commands are canceled.
     */
    switchToolAndCancelCommand: (tool: ToolState['activeTool']) => {
      const state = get();
      // Cancel any active command
      if (state.hasActiveModifyCommand) {
        state.requestCommandCancel();
      }
      // Then switch the tool
      state.setActiveTool(tool);
    },
  }))
);

// ============================================================================
// Selector Hooks (for optimized component subscriptions)
// ============================================================================

// Model selectors
export const useActiveDrawing = () => useAppStore((state) => {
  return state.drawings.find((d) => d.id === state.activeDrawingId);
});

// Legacy alias
export const useActiveDraft = useActiveDrawing;

export const useActiveSheet = () => useAppStore((state) => {
  return state.sheets.find((s) => s.id === state.activeSheetId);
});

export const useActiveLayer = () => useAppStore((state) => {
  return state.layers.find((l) => l.id === state.activeLayerId);
});

export const useDrawingShapes = () => useAppStore((state) => {
  return state.shapes.filter((s) => s.drawingId === state.activeDrawingId);
});

// Legacy alias
export const useDraftShapes = useDrawingShapes;

export const useDrawingLayers = () => useAppStore((state) => {
  return state.layers.filter((l) => l.drawingId === state.activeDrawingId);
});

// Legacy alias
export const useDraftLayers = useDrawingLayers;

export const useSelectedShapes = () => useAppStore((state) => {
  return state.shapes.filter((s) => state.selectedShapeIds.includes(s.id));
});

// View selectors
export const useViewport = () => useAppStore((state) => state.viewport);
export const useCanvasSize = () => useAppStore((state) => state.canvasSize);
export const useMousePosition = () => useAppStore((state) => state.mousePosition);

// Tool selectors
export const useActiveTool = () => useAppStore((state) => state.activeTool);
export const useCurrentStyle = () => useAppStore((state) => state.currentStyle);
export const useIsDrawing = () => useAppStore((state) => state.isDrawing);
export const useDrawingPreview = () => useAppStore((state) => state.drawingPreview);
export const useDrawingPoints = () => useAppStore((state) => state.drawingPoints);

// Snap selectors
export const useSnapEnabled = () => useAppStore((state) => state.snapEnabled);
export const useActiveSnaps = () => useAppStore((state) => state.activeSnaps);
export const useCurrentSnapPoint = () => useAppStore((state) => state.currentSnapPoint);
export const useGridVisible = () => useAppStore((state) => state.gridVisible);
export const useGridSize = () => useAppStore((state) => state.gridSize);

// Selection selectors
export const useSelectedShapeIds = () => useAppStore((state) => state.selectedShapeIds);
export const useSelectionBox = () => useAppStore((state) => state.selectionBox);

// Editor mode selectors
export const useEditorMode = () => useAppStore((state) => state.editorMode);
export const useIsSheetMode = () => useAppStore((state) => state.editorMode === 'sheet');
export const useIsDrawingMode = () => useAppStore((state) => state.editorMode === 'drawing');
// Legacy alias
export const useIsDraftMode = useIsDrawingMode;

// UI selectors
export const useProjectName = () => useAppStore((state) => state.projectName);
export const useIsModified = () => useAppStore((state) => state.isModified);
export const useCurrentFilePath = () => useAppStore((state) => state.currentFilePath);

// Annotation selectors
export const useSelectedAnnotationIds = () => useAppStore((state) => state.selectedAnnotationIds);
export const useAnnotationEditState = () => useAppStore((state) => state.annotationEditState);
export const useSheetAnnotations = () => useAppStore((state) => {
  const sheet = state.sheets.find((s) => s.id === state.activeSheetId);
  return sheet?.annotations ?? [];
});
export const useSelectedAnnotations = () => useAppStore((state) => {
  const sheet = state.sheets.find((s) => s.id === state.activeSheetId);
  if (!sheet) return [];
  return sheet.annotations.filter((a) => state.selectedAnnotationIds.includes(a.id));
});
