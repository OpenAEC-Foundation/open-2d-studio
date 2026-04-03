/**
 * Component Slice - Manages the component library and editor state
 *
 * Stores component definitions, editor activation state, and the active
 * representation context. No side effects — pure state + actions.
 */

import type { ComponentDefinition, RepresentationContext } from '../../types/component';

// ============================================================================
// State Interface
// ============================================================================

export interface ComponentEditorState {
  /** Whether the component editor mode is active */
  isActive: boolean;
  /** The definition being edited (null when not editing) */
  editingDefinitionId: string | null;
  /** The instance being edited in context (null when not in-context editing) */
  editingInstanceId: string | null;
}

export interface ComponentState {
  /** All loaded/imported component definitions */
  componentDefinitions: ComponentDefinition[];
  /** Component editor mode state */
  componentEditor: ComponentEditorState;
  /** Whether the component library panel is open */
  componentLibraryOpen: boolean;
  /** Which representation context is currently active for editing/display */
  activeRepresentationContext: RepresentationContext;
}

// ============================================================================
// Actions Interface
// ============================================================================

export interface ComponentActions {
  // Definition CRUD
  addComponentDefinition: (definition: ComponentDefinition) => void;
  updateComponentDefinition: (id: string, updates: Partial<ComponentDefinition>) => void;
  removeComponentDefinition: (id: string) => void;
  getComponentDefinition: (id: string) => ComponentDefinition | undefined;

  // Editor
  enterComponentEditor: (definitionId: string, instanceId?: string) => void;
  exitComponentEditor: () => void;

  // Library panel
  setComponentLibraryOpen: (open: boolean) => void;
  toggleComponentLibrary: () => void;

  // Representation context
  setActiveRepresentationContext: (context: RepresentationContext) => void;
}

// ============================================================================
// Combined Slice Type
// ============================================================================

export type ComponentSlice = ComponentState & ComponentActions;

// ============================================================================
// Initial State
// ============================================================================

export const initialComponentState: ComponentState = {
  componentDefinitions: [],
  componentEditor: {
    isActive: false,
    editingDefinitionId: null,
    editingInstanceId: null,
  },
  componentLibraryOpen: false,
  activeRepresentationContext: 'plan',
};

// ============================================================================
// Slice Creator
// ============================================================================

export function createComponentSlice(
  set: (fn: (state: any) => void) => void,
  get: () => any,
): ComponentActions {
  return {
    // ── Definition CRUD ─────────────────────────────────────

    addComponentDefinition: (definition: ComponentDefinition) => {
      set((state) => {
        state.componentDefinitions = [...state.componentDefinitions, definition];
      });
    },

    updateComponentDefinition: (id: string, updates: Partial<ComponentDefinition>) => {
      set((state) => {
        state.componentDefinitions = state.componentDefinitions.map(
          (def: ComponentDefinition) =>
            def.id === id
              ? { ...def, ...updates, updatedAt: Date.now() }
              : def,
        );
      });
    },

    removeComponentDefinition: (id: string) => {
      set((state) => {
        state.componentDefinitions = state.componentDefinitions.filter(
          (def: ComponentDefinition) => def.id !== id,
        );
        // If the removed definition is currently being edited, exit the editor
        if (state.componentEditor.editingDefinitionId === id) {
          state.componentEditor = {
            isActive: false,
            editingDefinitionId: null,
            editingInstanceId: null,
          };
        }
      });
    },

    getComponentDefinition: (id: string): ComponentDefinition | undefined => {
      const state = get();
      return (state.componentDefinitions as ComponentDefinition[]).find(
        (def) => def.id === id,
      );
    },

    // ── Editor ──────────────────────────────────────────────

    enterComponentEditor: (definitionId: string, instanceId?: string) => {
      set((state) => {
        state.componentEditor = {
          isActive: true,
          editingDefinitionId: definitionId,
          editingInstanceId: instanceId ?? null,
        };
      });
    },

    exitComponentEditor: () => {
      set((state) => {
        state.componentEditor = {
          isActive: false,
          editingDefinitionId: null,
          editingInstanceId: null,
        };
      });
    },

    // ── Library panel ────────────────────────────────────────

    setComponentLibraryOpen: (open: boolean) => {
      set((state) => {
        state.componentLibraryOpen = open;
      });
    },

    toggleComponentLibrary: () => {
      set((state) => {
        state.componentLibraryOpen = !state.componentLibraryOpen;
      });
    },

    // ── Representation context ───────────────────────────────

    setActiveRepresentationContext: (context: RepresentationContext) => {
      set((state) => {
        state.activeRepresentationContext = context;
      });
    },
  };
}
