/**
 * Constraint Slice - Manages the parametric constraint engine state
 *
 * Thin wrapper around ConstraintSolver that integrates with the Zustand store.
 */

import type { Parameter, ConstraintError, ShapeConstraintGraph } from '../../types/constraints';
import { ConstraintSolver } from '../../engine/constraints/ConstraintSolver';

// ============================================================================
// State Interface
// ============================================================================

export interface ConstraintState {
  constraintSolver: ConstraintSolver;
  globalParameters: Parameter[];
}

// ============================================================================
// Actions Interface
// ============================================================================

export interface ConstraintActions {
  // Global parameter management
  addGlobalParameter: (param: Parameter) => void;
  updateGlobalParameter: (paramId: string, updates: Partial<Parameter>) => void;
  removeGlobalParameter: (paramId: string) => void;

  // Shape constraint management
  registerShapeConstraints: (shapeId: string, objectName: string, graph: ShapeConstraintGraph) => void;
  unregisterShapeConstraints: (shapeId: string) => void;

  // Parameter value/formula setters
  setParameterValue: (paramId: string, value: number | boolean | string) => void;
  setParameterFormula: (paramId: string, formula: string) => void;
  clearParameterFormula: (paramId: string, value: number | boolean | string) => void;

  // Solve
  solveConstraints: () => Set<string>;

  // Getters
  getParameterValue: (paramId: string) => number | boolean | string | undefined;
  getParameterError: (paramId: string) => ConstraintError | undefined;
  getShapeParameters: (shapeId: string) => Parameter[];
}

// ============================================================================
// Combined Slice Type
// ============================================================================

export type ConstraintSlice = ConstraintState & ConstraintActions;

// ============================================================================
// Initial State
// ============================================================================

export const initialConstraintState: ConstraintState = {
  constraintSolver: new ConstraintSolver(),
  globalParameters: [],
};

// ============================================================================
// Slice Creator
// ============================================================================

export function createConstraintSlice(
  set: (fn: (state: any) => void) => void,
  get: () => any
): ConstraintActions {
  return {
    addGlobalParameter: (param: Parameter) => {
      const solver: ConstraintSolver = get().constraintSolver;
      solver.addGlobalParameter(param);
      set((state) => {
        state.globalParameters = [...state.globalParameters, param];
      });
    },

    updateGlobalParameter: (paramId: string, updates: Partial<Parameter>) => {
      const solver: ConstraintSolver = get().constraintSolver;
      // Apply updates: if value changed set it; if formula changed set formula
      if (updates.formula !== undefined) {
        solver.setFormula(paramId, updates.formula);
      } else if (updates.value !== undefined) {
        solver.setParameterValue(paramId, updates.value);
      }
      set((state) => {
        const idx = state.globalParameters.findIndex((p: Parameter) => p.id === paramId);
        if (idx !== -1) {
          state.globalParameters[idx] = { ...state.globalParameters[idx], ...updates };
        }
      });
    },

    removeGlobalParameter: (paramId: string) => {
      set((state) => {
        state.globalParameters = state.globalParameters.filter((p: Parameter) => p.id !== paramId);
      });
    },

    registerShapeConstraints: (shapeId: string, objectName: string, graph: ShapeConstraintGraph) => {
      const solver: ConstraintSolver = get().constraintSolver;
      solver.addShape(shapeId, objectName, graph.parameters);
    },

    unregisterShapeConstraints: (shapeId: string) => {
      const solver: ConstraintSolver = get().constraintSolver;
      solver.removeShape(shapeId);
    },

    setParameterValue: (paramId: string, value: number | boolean | string) => {
      const solver: ConstraintSolver = get().constraintSolver;
      solver.setParameterValue(paramId, value);
    },

    setParameterFormula: (paramId: string, formula: string) => {
      const solver: ConstraintSolver = get().constraintSolver;
      solver.setFormula(paramId, formula);
    },

    clearParameterFormula: (paramId: string, value: number | boolean | string) => {
      const solver: ConstraintSolver = get().constraintSolver;
      solver.setParameterValue(paramId, value);
    },

    solveConstraints: () => {
      const solver: ConstraintSolver = get().constraintSolver;
      return solver.solve();
    },

    getParameterValue: (paramId: string) => {
      const solver: ConstraintSolver = get().constraintSolver;
      try {
        return solver.getValue(paramId);
      } catch {
        return undefined;
      }
    },

    getParameterError: (paramId: string) => {
      const solver: ConstraintSolver = get().constraintSolver;
      return solver.getError(paramId);
    },

    getShapeParameters: (shapeId: string) => {
      const solver: ConstraintSolver = get().constraintSolver;
      return solver.getAllParametersForShape(shapeId);
    },
  };
}
