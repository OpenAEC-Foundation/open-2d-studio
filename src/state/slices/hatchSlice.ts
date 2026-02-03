/**
 * Hatch Slice - Manages custom hatch patterns (user and project level)
 */

import type {
  CustomHatchPattern,
  HatchPatternsState,
} from '../../types/hatch';
import {
  BUILTIN_PATTERNS,
  DEFAULT_HATCH_PATTERNS_STATE,
  isBuiltinPatternId,
} from '../../types/hatch';
import { generateId } from './types';

// ============================================================================
// State Interface
// ============================================================================

export interface HatchState extends HatchPatternsState {
  // Additional UI state for pattern management
  patternManagerOpen: boolean;
  editingPatternId: string | null;
}

// ============================================================================
// Actions Interface
// ============================================================================

export interface HatchActions {
  // Pattern CRUD operations
  addUserPattern: (pattern: Omit<CustomHatchPattern, 'id' | 'createdAt' | 'modifiedAt' | 'source'>) => string;
  updateUserPattern: (id: string, updates: Partial<Omit<CustomHatchPattern, 'id' | 'source'>>) => void;
  deleteUserPattern: (id: string) => void;
  duplicateUserPattern: (id: string, newName?: string) => string | null;

  addProjectPattern: (pattern: Omit<CustomHatchPattern, 'id' | 'createdAt' | 'modifiedAt' | 'source'>) => string;
  updateProjectPattern: (id: string, updates: Partial<Omit<CustomHatchPattern, 'id' | 'source'>>) => void;
  deleteProjectPattern: (id: string) => void;
  duplicateProjectPattern: (id: string, newName?: string) => string | null;

  // Import/Export helpers
  importPattern: (pattern: CustomHatchPattern, target: 'user' | 'project') => string;
  importPatterns: (patterns: CustomHatchPattern[], target: 'user' | 'project') => string[];

  // Pattern lookup (searches builtin, user, and project patterns)
  getPatternById: (id: string) => CustomHatchPattern | undefined;
  getAllPatterns: () => CustomHatchPattern[];

  // UI state
  setPatternManagerOpen: (open: boolean) => void;
  setEditingPatternId: (id: string | null) => void;

  // Bulk operations for save/load
  setUserPatterns: (patterns: CustomHatchPattern[]) => void;
  setProjectPatterns: (patterns: CustomHatchPattern[]) => void;
  clearProjectPatterns: () => void;
}

export type HatchSlice = HatchState & HatchActions;

// ============================================================================
// Initial State
// ============================================================================

export const initialHatchState: HatchState = {
  ...DEFAULT_HATCH_PATTERNS_STATE,
  patternManagerOpen: false,
  editingPatternId: null,
};

// ============================================================================
// Slice Creator
// ============================================================================

export const createHatchSlice = (
  set: (fn: (state: HatchState) => void) => void,
  get: () => HatchState
): HatchActions => ({
  // -------------------------------------------------------------------------
  // User Pattern CRUD
  // -------------------------------------------------------------------------

  addUserPattern: (pattern) => {
    const id = `user-pattern-${generateId()}`;
    const now = new Date().toISOString();
    const newPattern: CustomHatchPattern = {
      ...pattern,
      id,
      source: 'user',
      createdAt: now,
      modifiedAt: now,
    };
    set((state) => {
      state.userPatterns.push(newPattern);
    });
    return id;
  },

  updateUserPattern: (id, updates) => {
    set((state) => {
      const index = state.userPatterns.findIndex((p) => p.id === id);
      if (index !== -1) {
        state.userPatterns[index] = {
          ...state.userPatterns[index],
          ...updates,
          modifiedAt: new Date().toISOString(),
        };
      }
    });
  },

  deleteUserPattern: (id) => {
    set((state) => {
      state.userPatterns = state.userPatterns.filter((p) => p.id !== id);
      if (state.editingPatternId === id) {
        state.editingPatternId = null;
      }
    });
  },

  duplicateUserPattern: (id, newName) => {
    const state = get();
    const pattern = state.userPatterns.find((p) => p.id === id);
    if (!pattern) return null;

    const duplicateId = `user-pattern-${generateId()}`;
    const now = new Date().toISOString();
    const duplicate: CustomHatchPattern = {
      ...pattern,
      id: duplicateId,
      name: newName || `${pattern.name} (Copy)`,
      createdAt: now,
      modifiedAt: now,
    };
    set((s) => {
      s.userPatterns.push(duplicate);
    });
    return duplicateId;
  },

  // -------------------------------------------------------------------------
  // Project Pattern CRUD
  // -------------------------------------------------------------------------

  addProjectPattern: (pattern) => {
    const id = `project-pattern-${generateId()}`;
    const now = new Date().toISOString();
    const newPattern: CustomHatchPattern = {
      ...pattern,
      id,
      source: 'project',
      createdAt: now,
      modifiedAt: now,
    };
    set((state) => {
      state.projectPatterns.push(newPattern);
    });
    return id;
  },

  updateProjectPattern: (id, updates) => {
    set((state) => {
      const index = state.projectPatterns.findIndex((p) => p.id === id);
      if (index !== -1) {
        state.projectPatterns[index] = {
          ...state.projectPatterns[index],
          ...updates,
          modifiedAt: new Date().toISOString(),
        };
      }
    });
  },

  deleteProjectPattern: (id) => {
    set((state) => {
      state.projectPatterns = state.projectPatterns.filter((p) => p.id !== id);
      if (state.editingPatternId === id) {
        state.editingPatternId = null;
      }
    });
  },

  duplicateProjectPattern: (id, newName) => {
    const state = get();
    const pattern = state.projectPatterns.find((p) => p.id === id);
    if (!pattern) return null;

    const duplicateId = `project-pattern-${generateId()}`;
    const now = new Date().toISOString();
    const duplicate: CustomHatchPattern = {
      ...pattern,
      id: duplicateId,
      name: newName || `${pattern.name} (Copy)`,
      createdAt: now,
      modifiedAt: now,
    };
    set((s) => {
      s.projectPatterns.push(duplicate);
    });
    return duplicateId;
  },

  // -------------------------------------------------------------------------
  // Import/Export
  // -------------------------------------------------------------------------

  importPattern: (pattern, target) => {
    const id = `${target}-pattern-${generateId()}`;
    const now = new Date().toISOString();
    const imported: CustomHatchPattern = {
      ...pattern,
      id,
      source: target === 'user' ? 'user' : 'project',
      createdAt: now,
      modifiedAt: now,
    };
    set((state) => {
      if (target === 'user') {
        state.userPatterns.push(imported);
      } else {
        state.projectPatterns.push(imported);
      }
    });
    return id;
  },

  importPatterns: (patterns, target) => {
    const ids: string[] = [];
    const now = new Date().toISOString();

    set((state) => {
      for (const pattern of patterns) {
        const id = `${target}-pattern-${generateId()}`;
        const imported: CustomHatchPattern = {
          ...pattern,
          id,
          source: target === 'user' ? 'user' : 'project',
          createdAt: now,
          modifiedAt: now,
        };
        if (target === 'user') {
          state.userPatterns.push(imported);
        } else {
          state.projectPatterns.push(imported);
        }
        ids.push(id);
      }
    });

    return ids;
  },

  // -------------------------------------------------------------------------
  // Pattern Lookup
  // -------------------------------------------------------------------------

  getPatternById: (id) => {
    // Check builtin patterns first
    if (isBuiltinPatternId(id)) {
      return BUILTIN_PATTERNS.find((p) => p.id === id);
    }

    const state = get();

    // Check user patterns
    const userPattern = state.userPatterns.find((p) => p.id === id);
    if (userPattern) return userPattern;

    // Check project patterns
    const projectPattern = state.projectPatterns.find((p) => p.id === id);
    if (projectPattern) return projectPattern;

    return undefined;
  },

  getAllPatterns: () => {
    const state = get();
    return [
      ...BUILTIN_PATTERNS,
      ...state.userPatterns,
      ...state.projectPatterns,
    ];
  },

  // -------------------------------------------------------------------------
  // UI State
  // -------------------------------------------------------------------------

  setPatternManagerOpen: (open) => {
    set((state) => {
      state.patternManagerOpen = open;
      if (!open) {
        state.editingPatternId = null;
      }
    });
  },

  setEditingPatternId: (id) => {
    set((state) => {
      state.editingPatternId = id;
    });
  },

  // -------------------------------------------------------------------------
  // Bulk Operations (for save/load)
  // -------------------------------------------------------------------------

  setUserPatterns: (patterns) => {
    set((state) => {
      state.userPatterns = patterns;
    });
  },

  setProjectPatterns: (patterns) => {
    set((state) => {
      state.projectPatterns = patterns;
    });
  },

  clearProjectPatterns: () => {
    set((state) => {
      state.projectPatterns = [];
    });
  },
});
