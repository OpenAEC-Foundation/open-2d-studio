/**
 * Selection Slice - Manages shape selection and selection box
 */

import type { SelectionBox, Shape, Layer } from './types';

// ============================================================================
// State Interface
// ============================================================================

export interface SelectionState {
  selectedShapeIds: string[];
  selectionBox: SelectionBox | null;
  hoveredShapeId: string | null;
}

// ============================================================================
// Actions Interface
// ============================================================================

export interface SelectionActions {
  selectShape: (id: string, addToSelection?: boolean) => void;
  selectShapes: (ids: string[]) => void;
  deselectAll: () => void;
  selectAll: () => void;
  setSelectionBox: (box: SelectionBox | null) => void;
  setHoveredShapeId: (id: string | null) => void;
}

export type SelectionSlice = SelectionState & SelectionActions;

// ============================================================================
// Initial State
// ============================================================================

export const initialSelectionState: SelectionState = {
  selectedShapeIds: [],
  selectionBox: null,
  hoveredShapeId: null,
};

// ============================================================================
// Slice Creator
// ============================================================================

// Type for the full store that this slice needs access to
interface StoreWithModel {
  shapes: Shape[];
  layers: Layer[];
  activeDrawingId: string;
}

type FullStore = SelectionState & StoreWithModel;

export const createSelectionSlice = (
  set: (fn: (state: FullStore) => void) => void,
  _get: () => FullStore
): SelectionActions => ({
  selectShape: (id, addToSelection = false) =>
    set((state) => {
      if (addToSelection) {
        if (!state.selectedShapeIds.includes(id)) {
          state.selectedShapeIds.push(id);
        }
      } else {
        state.selectedShapeIds = [id];
      }
    }),

  selectShapes: (ids) =>
    set((state) => {
      state.selectedShapeIds = ids;
    }),

  deselectAll: () =>
    set((state) => {
      state.selectedShapeIds = [];
    }),

  selectAll: () =>
    set((state) => {
      // Only select shapes in the current drawing
      state.selectedShapeIds = state.shapes
        .filter((s) => {
          if (s.drawingId !== state.activeDrawingId) return false;
          const layer = state.layers.find((l) => l.id === s.layerId);
          return layer && layer.visible && !layer.locked && s.visible && !s.locked;
        })
        .map((s) => s.id);
    }),

  setSelectionBox: (box) =>
    set((state) => {
      state.selectionBox = box;
    }),

  setHoveredShapeId: (id) =>
    set((state) => {
      state.hoveredShapeId = id;
    }),
});
