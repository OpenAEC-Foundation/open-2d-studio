/**
 * History Slice - Manages undo/redo functionality using Immer patches
 */

import { type Patch, applyPatches, current } from 'immer';
import type { Shape } from './types';

// ============================================================================
// Types
// ============================================================================

export interface HistoryEntry {
  patches: Patch[];
  inversePatches: Patch[];
}

// ============================================================================
// State Interface
// ============================================================================

export interface HistoryState {
  historyStack: HistoryEntry[];
  historyIndex: number;     // Points to last applied entry (-1 means none)
  maxHistorySize: number;
}

// ============================================================================
// Actions Interface
// ============================================================================

export interface HistoryActions {
  undo: () => boolean;
  redo: () => boolean;
  canUndo: () => boolean;
  canRedo: () => boolean;
  collapseEntries: (fromIndex: number) => void;
}

export type HistorySlice = HistoryState & HistoryActions;

// ============================================================================
// Initial State
// ============================================================================

export const initialHistoryState: HistoryState = {
  historyStack: [],
  historyIndex: -1,
  maxHistorySize: 50,
};

// ============================================================================
// Slice Creator
// ============================================================================

interface StoreWithShapes {
  shapes: Shape[];
  selectedShapeIds: string[];
}

type FullStore = HistoryState & StoreWithShapes;

export const createHistorySlice = (
  set: (fn: (state: FullStore) => void) => void,
  get: () => FullStore
): HistoryActions => ({
  undo: () => {
    let success = false;

    set((state) => {
      if (state.historyIndex < 0) return;

      const entry = state.historyStack[state.historyIndex];
      if (!entry) return;

      state.shapes = applyPatches(current(state.shapes), entry.inversePatches) as any;
      state.historyIndex--;
      state.selectedShapeIds = [];
      success = true;
    });

    return success;
  },

  redo: () => {
    let success = false;

    set((state) => {
      const nextIndex = state.historyIndex + 1;
      if (nextIndex >= state.historyStack.length) return;

      const entry = state.historyStack[nextIndex];
      if (!entry) return;

      state.shapes = applyPatches(current(state.shapes), entry.patches) as any;
      state.historyIndex = nextIndex;
      state.selectedShapeIds = [];
      success = true;
    });

    return success;
  },

  canUndo: () => {
    const state = get();
    return state.historyIndex >= 0;
  },

  canRedo: () => {
    const state = get();
    return state.historyIndex < state.historyStack.length - 1;
  },

  collapseEntries: (fromIndex: number) =>
    set((state) => {
      if (fromIndex > state.historyIndex || fromIndex < 0) return;
      if (fromIndex === state.historyIndex) return; // Only one entry, nothing to collapse

      // Merge entries [fromIndex..historyIndex] into one
      const mergedPatches: Patch[] = [];
      const mergedInversePatches: Patch[] = [];

      for (let i = fromIndex; i <= state.historyIndex; i++) {
        mergedPatches.push(...state.historyStack[i].patches);
        // Inverse patches need to be in reverse order for correct undo
        mergedInversePatches.unshift(...state.historyStack[i].inversePatches);
      }

      const collapsed: HistoryEntry = {
        patches: mergedPatches,
        inversePatches: mergedInversePatches,
      };

      // Replace the range with the single collapsed entry
      state.historyStack.splice(fromIndex, state.historyIndex - fromIndex + 1, collapsed);
      state.historyIndex = fromIndex;
    }),
});
