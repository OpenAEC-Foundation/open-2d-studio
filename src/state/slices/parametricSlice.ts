/**
 * Parametric Slice - Manages parametric shapes
 *
 * Parametric shapes are defined by parameters and templates rather than
 * fixed geometry. They are stored separately from regular shapes but
 * rendered alongside them.
 */

import { produceWithPatches, current } from 'immer';
import type { Point, ShapeStyle, Shape } from '../../types/geometry';
import type {
  ParametricShape,
  ProfileType,
  ParameterValues,
} from '../../types/parametric';
import {
  createProfileShape,
  updateParametricParameters,
  updateParametricPosition,
  updateParametricRotation,
  updateParametricScale,
  explodeParametricShape,
  cloneParametricShape,
} from '../../services/parametricService';

import type { HistoryEntry } from './historySlice';

// ============================================================================
// State Interface
// ============================================================================

export interface ParametricState {
  /** All parametric shapes in the document */
  parametricShapes: ParametricShape[];

  /** Section dialog state */
  sectionDialogOpen: boolean;
  pendingSection: {
    profileType: ProfileType;
    parameters: ParameterValues;
    presetId?: string;
    rotation: number;
  } | null;

  /** Preview position for section placement (mouse following) */
  sectionPlacementPreview: Point | null;
}

// ============================================================================
// Actions Interface
// ============================================================================

export interface ParametricActions {
  // Parametric shape CRUD
  addParametricShape: (shape: ParametricShape) => void;
  updateParametricShape: (id: string, updates: Partial<ParametricShape>) => void;
  deleteParametricShape: (id: string) => void;
  deleteParametricShapes: (ids: string[]) => void;

  // Profile-specific actions
  insertProfile: (
    profileType: ProfileType,
    position: Point,
    layerId: string,
    drawingId: string,
    options?: {
      parameters?: Partial<ParameterValues>;
      presetId?: string;
      rotation?: number;
      scale?: number;
      style?: Partial<ShapeStyle>;
    }
  ) => string;

  // Parameter updates
  updateProfileParameters: (id: string, parameters: Partial<ParameterValues>) => void;
  updateProfilePosition: (id: string, position: Point) => void;
  updateProfileRotation: (id: string, rotation: number) => void;
  updateProfileScale: (id: string, scale: number) => void;

  // Explode (convert to regular shapes)
  explodeParametricShapes: (ids: string[]) => Shape[];

  // Clone
  cloneParametricShapes: (ids: string[], offset: Point) => ParametricShape[];

  // Selection helpers
  getParametricShapesForDrawing: (drawingId: string) => ParametricShape[];
  getParametricShapeById: (id: string) => ParametricShape | undefined;

  // Section dialog
  openSectionDialog: () => void;
  closeSectionDialog: () => void;
  setPendingSection: (pending: ParametricState['pendingSection']) => void;
  clearPendingSection: () => void;
  setSectionPlacementPreview: (position: Point | null) => void;
}

export type ParametricSlice = ParametricState & ParametricActions;

// ============================================================================
// Initial State
// ============================================================================

export const initialParametricState: ParametricState = {
  parametricShapes: [],
  sectionDialogOpen: false,
  pendingSection: null,
  sectionPlacementPreview: null,
};

// ============================================================================
// Slice Creator
// ============================================================================

interface StoreWithHistory {
  historyStack: HistoryEntry[];
  historyIndex: number;
  maxHistorySize: number;
  isModified: boolean;
  shapes: unknown[];
}

type FullStore = ParametricState & StoreWithHistory;

// Helper for history tracking (similar to modelSlice)
function withParametricHistory(state: FullStore, mutate: (draft: ParametricShape[]) => void): void {
  const [nextShapes, patches, inversePatches] = produceWithPatches(
    current(state.parametricShapes),
    mutate
  );
  if (patches.length === 0) return;

  // Truncate future entries if we're not at the end
  if (state.historyIndex >= 0 && state.historyIndex < state.historyStack.length - 1) {
    state.historyStack = state.historyStack.slice(0, state.historyIndex + 1);
  }
  state.historyStack.push({ patches, inversePatches });
  if (state.historyStack.length > state.maxHistorySize) {
    state.historyStack.shift();
  }
  state.historyIndex = state.historyStack.length - 1;
  state.parametricShapes = nextShapes as ParametricShape[];
  state.isModified = true;
}

export const createParametricSlice = (
  set: (fn: (state: FullStore) => void) => void,
  get: () => FullStore
): ParametricActions => ({
  // ============================================================================
  // CRUD Operations
  // ============================================================================

  addParametricShape: (shape) =>
    set((state) => {
      withParametricHistory(state, (draft) => {
        draft.push(shape);
      });
    }),

  updateParametricShape: (id, updates) =>
    set((state) => {
      withParametricHistory(state, (draft) => {
        const index = draft.findIndex((s) => s.id === id);
        if (index !== -1) {
          Object.assign(draft[index], updates);
        }
      });
    }),

  deleteParametricShape: (id) =>
    set((state) => {
      withParametricHistory(state, (draft) => {
        const index = draft.findIndex((s) => s.id === id);
        if (index !== -1) {
          draft.splice(index, 1);
        }
      });
    }),

  deleteParametricShapes: (ids) =>
    set((state) => {
      if (ids.length === 0) return;
      const idSet = new Set(ids);
      withParametricHistory(state, (draft) => {
        for (let i = draft.length - 1; i >= 0; i--) {
          if (idSet.has(draft[i].id)) {
            draft.splice(i, 1);
          }
        }
      });
    }),

  // ============================================================================
  // Profile-Specific Actions
  // ============================================================================

  insertProfile: (profileType, position, layerId, drawingId, options) => {
    const shape = createProfileShape(profileType, position, layerId, drawingId, options);
    set((state) => {
      withParametricHistory(state, (draft) => {
        draft.push(shape);
      });
    });
    return shape.id;
  },

  updateProfileParameters: (id, parameters) =>
    set((state) => {
      withParametricHistory(state, (draft) => {
        const index = draft.findIndex((s) => s.id === id);
        if (index !== -1 && draft[index].parametricType === 'profile') {
          const updated = updateParametricParameters(draft[index], parameters);
          draft[index] = updated;
        }
      });
    }),

  updateProfilePosition: (id, position) =>
    set((state) => {
      withParametricHistory(state, (draft) => {
        const index = draft.findIndex((s) => s.id === id);
        if (index !== -1) {
          const updated = updateParametricPosition(draft[index], position);
          draft[index] = updated;
        }
      });
    }),

  updateProfileRotation: (id, rotation) =>
    set((state) => {
      withParametricHistory(state, (draft) => {
        const index = draft.findIndex((s) => s.id === id);
        if (index !== -1) {
          const updated = updateParametricRotation(draft[index], rotation);
          draft[index] = updated;
        }
      });
    }),

  updateProfileScale: (id, scale) =>
    set((state) => {
      withParametricHistory(state, (draft) => {
        const index = draft.findIndex((s) => s.id === id);
        if (index !== -1) {
          const updated = updateParametricScale(draft[index], scale);
          draft[index] = updated;
        }
      });
    }),

  // ============================================================================
  // Explode & Clone
  // ============================================================================

  explodeParametricShapes: (ids) => {
    const state = get();
    const allExploded: Shape[] = [];

    for (const id of ids) {
      const shape = state.parametricShapes.find((s) => s.id === id);
      if (shape) {
        const exploded = explodeParametricShape(shape);
        allExploded.push(...exploded);
      }
    }

    // Delete the parametric shapes and return the exploded geometry
    // The caller should add the exploded shapes to the regular shapes array
    if (ids.length > 0) {
      set((state) => {
        const idSet = new Set(ids);
        withParametricHistory(state, (draft) => {
          for (let i = draft.length - 1; i >= 0; i--) {
            if (idSet.has(draft[i].id)) {
              draft.splice(i, 1);
            }
          }
        });
      });
    }

    return allExploded;
  },

  cloneParametricShapes: (ids, offset) => {
    const state = get();
    const cloned: ParametricShape[] = [];

    for (const id of ids) {
      const shape = state.parametricShapes.find((s) => s.id === id);
      if (shape) {
        const clone = cloneParametricShape(shape, offset);
        cloned.push(clone);
      }
    }

    if (cloned.length > 0) {
      set((state) => {
        withParametricHistory(state, (draft) => {
          for (const shape of cloned) {
            draft.push(shape);
          }
        });
      });
    }

    return cloned;
  },

  // ============================================================================
  // Selection Helpers
  // ============================================================================

  getParametricShapesForDrawing: (drawingId) => {
    const state = get();
    return state.parametricShapes.filter((s) => s.drawingId === drawingId);
  },

  getParametricShapeById: (id) => {
    const state = get();
    return state.parametricShapes.find((s) => s.id === id);
  },

  // ============================================================================
  // Section Dialog
  // ============================================================================

  openSectionDialog: () =>
    set((state) => {
      state.sectionDialogOpen = true;
    }),

  closeSectionDialog: () =>
    set((state) => {
      state.sectionDialogOpen = false;
    }),

  setPendingSection: (pending) =>
    set((state) => {
      state.pendingSection = pending;
    }),

  clearPendingSection: () =>
    set((state) => {
      state.pendingSection = null;
    }),

  setSectionPlacementPreview: (position) =>
    set((state) => {
      state.sectionPlacementPreview = position;
    }),
});
