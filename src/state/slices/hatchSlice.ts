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
import type { FilledRegionType } from '../../types/filledRegion';
import {
  BUILTIN_FILLED_REGION_TYPES,
} from '../../types/filledRegion';
import { generateId } from './types';

// ============================================================================
// localStorage Keys
// ============================================================================

const LS_KEY_FAVORITES = 'open2dstudio_favorite_patterns';
const LS_KEY_RECENT = 'open2dstudio_recent_patterns';
const LS_KEY_CUSTOM_REGION_TYPES = 'open2dstudio_custom_region_types';
const LS_KEY_REGION_TYPES_MIGRATED = 'open2dstudio_region_types_migrated_v1';
const MAX_RECENT_PATTERNS = 10;

function loadStringArray(key: string): string[] {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [];
  } catch {
    return [];
  }
}

function saveStringArray(key: string, arr: string[]): void {
  try {
    localStorage.setItem(key, JSON.stringify(arr));
  } catch { /* ignore quota errors */ }
}

function loadFilledRegionTypes(): FilledRegionType[] {
  try {
    const raw = localStorage.getItem(LS_KEY_CUSTOM_REGION_TYPES);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveFilledRegionTypes(types: FilledRegionType[]): void {
  try {
    localStorage.setItem(LS_KEY_CUSTOM_REGION_TYPES, JSON.stringify(types));
  } catch { /* ignore quota errors */ }
}

/**
 * Migration: on first run copy all built-in types into user storage so they
 * become fully editable / deletable. After this the built-in list is no longer
 * the authoritative source for the UI — user storage is.
 */
function migrateBuiltinsToUserStorage(): FilledRegionType[] {
  const alreadyMigrated = localStorage.getItem(LS_KEY_REGION_TYPES_MIGRATED);
  const stored = loadFilledRegionTypes();

  if (!alreadyMigrated) {
    // First run: build a merged list (stored types take precedence by id)
    const storedIds = new Set(stored.map(t => t.id));
    const merged: FilledRegionType[] = [
      // Built-ins that are not yet in stored
      ...BUILTIN_FILLED_REGION_TYPES
        .filter(t => !storedIds.has(t.id))
        .map(t => ({ ...t, isBuiltIn: false })),
      // Whatever the user already had
      ...stored.map(t => ({ ...t, isBuiltIn: false })),
    ];
    saveFilledRegionTypes(merged);
    localStorage.setItem(LS_KEY_REGION_TYPES_MIGRATED, '1');
    return merged;
  }

  // Already migrated — just return stored (strip any lingering isBuiltIn flags)
  return stored.map(t => ({ ...t, isBuiltIn: false }));
}

// ============================================================================
// State Interface
// ============================================================================

export interface HatchState extends HatchPatternsState {
  // Additional UI state for pattern management
  patternManagerOpen: boolean;
  editingPatternId: string | null;
  regionTypeManagerOpen: boolean;
  regionTypeManagerFocusId: string | null;

  // Favorites & Recently Used
  favoritePatternIds: string[];
  recentPatternIds: string[];

  // Filled Region Types (built-in + user-defined)
  filledRegionTypes: FilledRegionType[];

  // Live preview: when hovering a pattern in the picker, temporarily show it on selected hatches
  previewPatternId: string | null;

  // Selected filled region type for new hatches
  selectedFilledRegionTypeId: string | null;
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
  setRegionTypeManagerOpen: (open: boolean) => void;
  openRegionTypeManagerFocused: (typeId: string) => void;

  // Favorites & Recently Used
  toggleFavoritePattern: (id: string) => void;
  addRecentPattern: (id: string) => void;

  // Filled Region Types CRUD
  addFilledRegionType: (type: Omit<FilledRegionType, 'id' | 'isBuiltIn'>) => string;
  updateFilledRegionType: (id: string, updates: Partial<Omit<FilledRegionType, 'id' | 'isBuiltIn'>>) => void;
  deleteFilledRegionType: (id: string) => void;
  duplicateFilledRegionType: (id: string, newName?: string) => string | null;
  getFilledRegionTypeById: (id: string) => FilledRegionType | undefined;
  getAllFilledRegionTypes: () => FilledRegionType[];
  setProjectFilledRegionTypes: (types: FilledRegionType[]) => void;

  // Live preview
  setPreviewPatternId: (id: string | null) => void;

  // Selected filled region type for sketch mode
  setSelectedFilledRegionTypeId: (id: string | null) => void;

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
  regionTypeManagerOpen: false,
  regionTypeManagerFocusId: null,
  favoritePatternIds: loadStringArray(LS_KEY_FAVORITES),
  recentPatternIds: loadStringArray(LS_KEY_RECENT),
  filledRegionTypes: migrateBuiltinsToUserStorage(),
  previewPatternId: null,
  selectedFilledRegionTypeId: null,
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

  setRegionTypeManagerOpen: (open) => {
    set((state) => {
      state.regionTypeManagerOpen = open;
      if (!open) state.regionTypeManagerFocusId = null;
    });
  },

  openRegionTypeManagerFocused: (typeId) => {
    set((state) => {
      state.regionTypeManagerOpen = true;
      state.regionTypeManagerFocusId = typeId;
    });
  },

  // -------------------------------------------------------------------------
  // Favorites & Recently Used
  // -------------------------------------------------------------------------

  toggleFavoritePattern: (id) => {
    set((state) => {
      const idx = state.favoritePatternIds.indexOf(id);
      if (idx !== -1) {
        state.favoritePatternIds.splice(idx, 1);
      } else {
        state.favoritePatternIds.push(id);
      }
      saveStringArray(LS_KEY_FAVORITES, state.favoritePatternIds);
    });
  },

  addRecentPattern: (id) => {
    set((state) => {
      // Remove if already in list, then push to front
      state.recentPatternIds = state.recentPatternIds.filter(pid => pid !== id);
      state.recentPatternIds.unshift(id);
      // Cap at max
      if (state.recentPatternIds.length > MAX_RECENT_PATTERNS) {
        state.recentPatternIds = state.recentPatternIds.slice(0, MAX_RECENT_PATTERNS);
      }
      saveStringArray(LS_KEY_RECENT, state.recentPatternIds);
    });
  },

  // -------------------------------------------------------------------------
  // Filled Region Types CRUD
  // -------------------------------------------------------------------------

  addFilledRegionType: (type) => {
    const id = `frt-${generateId()}`;
    const newType: FilledRegionType = {
      ...type,
      id,
      isBuiltIn: false,
    };
    set((state) => {
      state.filledRegionTypes.push(newType);
      saveFilledRegionTypes(state.filledRegionTypes);
    });
    return id;
  },

  updateFilledRegionType: (id, updates) => {
    set((state) => {
      const index = state.filledRegionTypes.findIndex(t => t.id === id);
      if (index !== -1) {
        state.filledRegionTypes[index] = {
          ...state.filledRegionTypes[index],
          ...updates,
        };
        saveFilledRegionTypes(state.filledRegionTypes);
      }
    });
  },

  deleteFilledRegionType: (id) => {
    set((state) => {
      state.filledRegionTypes = state.filledRegionTypes.filter(t => t.id !== id);
      saveFilledRegionTypes(state.filledRegionTypes);
    });
  },

  duplicateFilledRegionType: (id, newName) => {
    const state = get();
    const original = state.filledRegionTypes.find(t => t.id === id);
    if (!original) return null;

    const duplicateId = `frt-${generateId()}`;
    const duplicate: FilledRegionType = {
      ...original,
      id: duplicateId,
      name: newName || `${original.name} (Copy)`,
      isBuiltIn: false,
    };
    set((s) => {
      s.filledRegionTypes.push(duplicate);
      saveFilledRegionTypes(s.filledRegionTypes);
    });
    return duplicateId;
  },

  getFilledRegionTypeById: (id) => {
    const state = get();
    return state.filledRegionTypes.find(t => t.id === id);
  },

  getAllFilledRegionTypes: () => {
    return get().filledRegionTypes;
  },

  setProjectFilledRegionTypes: (types) => {
    set((state) => {
      // Merge: keep existing user types that are not overridden by project types, then add project types
      const projectIds = new Set(types.map(t => t.id));
      const userTypes = state.filledRegionTypes.filter(t => !projectIds.has(t.id));
      state.filledRegionTypes = [...userTypes, ...types];
    });
  },

  // -------------------------------------------------------------------------
  // Live Preview
  // -------------------------------------------------------------------------

  setPreviewPatternId: (id) => {
    set((state) => {
      state.previewPatternId = id;
    });
  },

  setSelectedFilledRegionTypeId: (id) => {
    set((state) => {
      state.selectedFilledRegionTypeId = id;
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
