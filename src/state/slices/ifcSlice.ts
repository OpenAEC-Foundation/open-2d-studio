/**
 * IFC Slice - Manages IFC model generation state and Bonsai Sync
 *
 * Tracks the generated IFC file content, auto-generation toggle,
 * and provides the regenerateIFC action that converts current shapes
 * into a valid IFC4 STEP file.
 *
 * Also manages Bonsai Sync state: when enabled, the IFC file is
 * auto-exported to a watched path so Blender/Bonsai can reload it.
 */

import type { Shape, Drawing } from './types';
import type { WallType, SlabType } from '../../types/geometry';
import { generateIFC, type IfcGenerationResult } from '../../services/ifc/ifcGenerator';
import type { ProjectStructure } from './parametricSlice';

// ============================================================================
// State Interface
// ============================================================================

export interface IfcState {
  /** The generated IFC STEP file text content */
  ifcContent: string;
  /** Whether to auto-regenerate IFC when shapes change */
  ifcAutoGenerate: boolean;
  /** Number of IFC entities in the last generation */
  ifcEntityCount: number;
  /** File size in bytes of the last generated IFC */
  ifcFileSize: number;
  /** Whether the IFC panel is visible */
  ifcPanelOpen: boolean;
  /** Whether the IFC dashboard overlay is visible (triggered by IFC tab) */
  ifcDashboardVisible: boolean;

  // Bonsai Sync state
  /** Whether Bonsai Sync is enabled (auto-export IFC to watched path) */
  bonsaiSyncEnabled: boolean;
  /** File path where the IFC is auto-exported for Bonsai */
  bonsaiSyncPath: string;
  /** Timestamp of last successful Bonsai sync export (ms since epoch) */
  bonsaiLastSync: number | null;
  /** Current sync status */
  bonsaiSyncStatus: 'idle' | 'syncing' | 'error';
  /** Error message if last sync failed */
  bonsaiSyncError: string | null;
}

// ============================================================================
// Actions Interface
// ============================================================================

export interface IfcActions {
  /** Regenerate the IFC model from current shapes */
  regenerateIFC: () => void;
  /** Toggle auto-generation of IFC */
  setIfcAutoGenerate: (enabled: boolean) => void;
  /** Toggle the IFC panel visibility */
  setIfcPanelOpen: (open: boolean) => void;
  /** Toggle the IFC dashboard overlay visibility */
  setIfcDashboardVisible: (visible: boolean) => void;

  // Bonsai Sync actions
  /** Enable or disable Bonsai Sync */
  setBonsaiSyncEnabled: (enabled: boolean) => void;
  /** Set the Bonsai Sync export path */
  setBonsaiSyncPath: (path: string) => void;
  /** Update the last sync timestamp */
  setBonsaiLastSync: (timestamp: number | null) => void;
  /** Update sync status */
  setBonsaiSyncStatus: (status: IfcState['bonsaiSyncStatus']) => void;
  /** Update sync error */
  setBonsaiSyncError: (error: string | null) => void;
}

export type IfcSlice = IfcState & IfcActions;

// ============================================================================
// Initial State
// ============================================================================

export const initialIfcState: IfcState = {
  ifcContent: '',
  ifcAutoGenerate: true,
  ifcEntityCount: 0,
  ifcFileSize: 0,
  ifcPanelOpen: false,
  ifcDashboardVisible: false,

  // Bonsai Sync defaults
  bonsaiSyncEnabled: false,
  bonsaiSyncPath: '',
  bonsaiLastSync: null,
  bonsaiSyncStatus: 'idle',
  bonsaiSyncError: null,
};

// ============================================================================
// Slice Creator
// ============================================================================

interface FullStore {
  shapes: Shape[];
  drawings: Drawing[];
  wallTypes: WallType[];
  slabTypes: SlabType[];
  projectStructure: ProjectStructure;
  pileTypes: import('../../types/geometry').PileTypeDefinition[];
  ifcContent: string;
  ifcAutoGenerate: boolean;
  ifcEntityCount: number;
  ifcFileSize: number;
  ifcPanelOpen: boolean;
  ifcDashboardVisible: boolean;
  bonsaiSyncEnabled: boolean;
  bonsaiSyncPath: string;
  bonsaiLastSync: number | null;
  bonsaiSyncStatus: IfcState['bonsaiSyncStatus'];
  bonsaiSyncError: string | null;
}

export const createIfcSlice = (
  set: (fn: (state: FullStore) => void) => void,
  get: () => FullStore
): IfcActions => ({
  regenerateIFC: () => {
    const state = get();
    const result: IfcGenerationResult = generateIFC(
      state.shapes,
      state.wallTypes,
      state.slabTypes,
      state.projectStructure,
      state.drawings,
      state.pileTypes
    );
    set((s) => {
      s.ifcContent = result.content;
      s.ifcEntityCount = result.entityCount;
      s.ifcFileSize = result.fileSize;
    });
  },

  setIfcAutoGenerate: (enabled: boolean) => {
    set((s) => {
      s.ifcAutoGenerate = enabled;
    });
  },

  setIfcPanelOpen: (open: boolean) => {
    set((s) => {
      s.ifcPanelOpen = open;
    });
  },

  setIfcDashboardVisible: (visible: boolean) => {
    set((s) => {
      s.ifcDashboardVisible = visible;
    });
  },

  // Bonsai Sync actions
  setBonsaiSyncEnabled: (enabled: boolean) => {
    set((s) => {
      s.bonsaiSyncEnabled = enabled;
      if (!enabled) {
        s.bonsaiSyncStatus = 'idle';
        s.bonsaiSyncError = null;
      }
    });
  },

  setBonsaiSyncPath: (path: string) => {
    set((s) => {
      s.bonsaiSyncPath = path;
    });
  },

  setBonsaiLastSync: (timestamp: number | null) => {
    set((s) => {
      s.bonsaiLastSync = timestamp;
    });
  },

  setBonsaiSyncStatus: (status: IfcState['bonsaiSyncStatus']) => {
    set((s) => {
      s.bonsaiSyncStatus = status;
    });
  },

  setBonsaiSyncError: (error: string | null) => {
    set((s) => {
      s.bonsaiSyncError = error;
    });
  },
});
