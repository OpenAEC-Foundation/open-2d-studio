/**
 * Dialog Actions — open/close pairs, pending state setters, and related dialog state.
 *
 * Extracted from parametricSlice.ts to reduce file size.
 */

import type { Point, PilePlanSettings } from '../../../types/geometry';
import type { ParametricState } from '../parametricSlice';
import type { HistoryEntry } from '../historySlice';
import type { Shape, Drawing } from '../../../types/geometry';

interface StoreWithHistory {
  historyStack: HistoryEntry[];
  historyIndex: number;
  maxHistorySize: number;
  isModified: boolean;
  shapes: Shape[];
  drawings: Drawing[];
  groups: import('../../../types/geometry').ShapeGroup[];
  updateShapes: (updates: { id: string; updates: Partial<Shape> }[]) => void;
  syncAllSectionReferences?: () => void;
}

type FullStore = ParametricState & StoreWithHistory;

export function createDialogActions(
  set: (fn: (state: FullStore) => void) => void,
  _get: () => FullStore
) {
  return {
    // ========================================================================
    // Section Dialog
    // ========================================================================

    openSectionDialog: () =>
      set((state) => {
        state.sectionDialogOpen = true;
      }),

    closeSectionDialog: () =>
      set((state) => {
        state.sectionDialogOpen = false;
      }),

    setPendingSection: (pending: ParametricState['pendingSection']) =>
      set((state) => {
        state.pendingSection = pending;
      }),

    clearPendingSection: () =>
      set((state) => {
        state.pendingSection = null;
      }),

    setSectionPlacementPreview: (position: Point | null) =>
      set((state) => {
        state.sectionPlacementPreview = position;
      }),

    // ========================================================================
    // Beam Dialog
    // ========================================================================

    openBeamDialog: (initialViewMode?: 'plan' | 'section' | 'elevation' | 'side') =>
      set((state) => {
        state.beamDialogOpen = true;
        state.beamDialogInitialViewMode = initialViewMode;
      }),

    closeBeamDialog: () =>
      set((state) => {
        state.beamDialogOpen = false;
      }),

    setPendingBeam: (pending: ParametricState['pendingBeam']) =>
      set((state) => {
        state.pendingBeam = pending;
      }),

    clearPendingBeam: () =>
      set((state) => {
        state.pendingBeam = null;
      }),

    // ========================================================================
    // Gridline Dialog
    // ========================================================================

    openGridlineDialog: () =>
      set((state) => {
        state.gridlineDialogOpen = true;
      }),

    closeGridlineDialog: () =>
      set((state) => {
        state.gridlineDialogOpen = false;
      }),

    setPendingGridline: (pending: ParametricState['pendingGridline']) =>
      set((state) => {
        state.pendingGridline = pending;
      }),

    clearPendingGridline: () =>
      set((state) => {
        state.pendingGridline = null;
      }),

    // ========================================================================
    // Level
    // ========================================================================

    setPendingLevel: (pending: ParametricState['pendingLevel']) =>
      set((state) => {
        state.pendingLevel = pending;
      }),

    clearPendingLevel: () =>
      set((state) => {
        state.pendingLevel = null;
      }),

    // ========================================================================
    // Puntniveau
    // ========================================================================

    setPendingPuntniveau: (pending: ParametricState['pendingPuntniveau']) =>
      set((state) => {
        state.pendingPuntniveau = pending;
      }),

    clearPendingPuntniveau: () =>
      set((state) => {
        state.pendingPuntniveau = null;
      }),

    // ========================================================================
    // Pile Dialog
    // ========================================================================

    openPileDialog: () =>
      set((state) => {
        state.pileDialogOpen = true;
      }),

    closePileDialog: () =>
      set((state) => {
        state.pileDialogOpen = false;
      }),

    setPendingPile: (pending: ParametricState['pendingPile']) =>
      set((state) => {
        state.pendingPile = pending;
      }),

    clearPendingPile: () =>
      set((state) => {
        state.pendingPile = null;
      }),

    // ========================================================================
    // Column
    // ========================================================================

    setPendingColumn: (pending: ParametricState['pendingColumn']) =>
      set((state) => {
        state.pendingColumn = pending;
      }),

    clearPendingColumn: () =>
      set((state) => {
        state.pendingColumn = null;
      }),

    // ========================================================================
    // CPT Dialog
    // ========================================================================

    openCPTDialog: () =>
      set((state) => {
        state.cptDialogOpen = true;
      }),

    closeCPTDialog: () =>
      set((state) => {
        state.cptDialogOpen = false;
      }),

    setPendingCPT: (pending: ParametricState['pendingCPT']) =>
      set((state) => {
        state.pendingCPT = pending;
      }),

    clearPendingCPT: () =>
      set((state) => {
        state.pendingCPT = null;
      }),

    // ========================================================================
    // Pile Plan Settings
    // ========================================================================

    setPilePlanSettings: (settings: Partial<PilePlanSettings>) =>
      set((state) => {
        Object.assign(state.pilePlanSettings, settings);
      }),

    // ========================================================================
    // Wall Dialog
    // ========================================================================

    openWallDialog: () =>
      set((state) => {
        state.wallDialogOpen = true;
      }),

    closeWallDialog: () =>
      set((state) => {
        state.wallDialogOpen = false;
      }),

    setPendingWall: (pending: ParametricState['pendingWall']) =>
      set((state) => {
        state.pendingWall = pending;
      }),

    clearPendingWall: () =>
      set((state) => {
        state.pendingWall = null;
      }),

    // ========================================================================
    // Slab
    // ========================================================================

    setPendingSlab: (pending: ParametricState['pendingSlab']) =>
      set((state) => {
        state.pendingSlab = pending;
      }),

    clearPendingSlab: () =>
      set((state) => {
        state.pendingSlab = null;
      }),

    // ========================================================================
    // Slab Opening
    // ========================================================================

    setPendingSlabOpening: (pending: ParametricState['pendingSlabOpening']) =>
      set((state) => {
        state.pendingSlabOpening = pending;
      }),

    clearPendingSlabOpening: () =>
      set((state) => {
        state.pendingSlabOpening = null;
      }),

    // ========================================================================
    // Slab Label
    // ========================================================================

    setPendingSlabLabel: (pending: ParametricState['pendingSlabLabel']) =>
      set((state) => {
        state.pendingSlabLabel = pending;
      }),

    clearPendingSlabLabel: () =>
      set((state) => {
        state.pendingSlabLabel = null;
      }),

    // ========================================================================
    // Section Callout
    // ========================================================================

    setPendingSectionCallout: (pending: ParametricState['pendingSectionCallout']) =>
      set((state) => {
        state.pendingSectionCallout = pending;
      }),

    clearPendingSectionCallout: () =>
      set((state) => {
        state.pendingSectionCallout = null;
      }),

    // ========================================================================
    // Space (IfcSpace)
    // ========================================================================

    setPendingSpace: (pending: ParametricState['pendingSpace']) =>
      set((state) => {
        state.pendingSpace = pending;
      }),

    clearPendingSpace: () =>
      set((state) => {
        state.pendingSpace = null;
      }),

    // ========================================================================
    // Plate System
    // ========================================================================

    openPlateSystemDialog: () =>
      set((state) => {
        state.plateSystemDialogOpen = true;
      }),

    closePlateSystemDialog: () =>
      set((state) => {
        state.plateSystemDialogOpen = false;
      }),

    setPendingPlateSystem: (pending: ParametricState['pendingPlateSystem']) =>
      set((state) => {
        state.pendingPlateSystem = pending;
      }),

    clearPendingPlateSystem: () =>
      set((state) => {
        state.pendingPlateSystem = null;
      }),

    // ========================================================================
    // Materials Dialog
    // ========================================================================

    openMaterialsDialog: () =>
      set((state) => {
        state.materialsDialogOpen = true;
      }),

    closeMaterialsDialog: () =>
      set((state) => {
        state.materialsDialogOpen = false;
      }),

    // ========================================================================
    // Wall Types Dialog
    // ========================================================================

    openWallTypesDialog: () =>
      set((state) => {
        state.wallTypesDialogOpen = true;
      }),

    closeWallTypesDialog: () =>
      set((state) => {
        state.wallTypesDialogOpen = false;
      }),

    // ========================================================================
    // Pile Symbols Dialog
    // ========================================================================

    openPileSymbolsDialog: () =>
      set((state) => {
        state.pileSymbolsDialogOpen = true;
      }),

    closePileSymbolsDialog: () =>
      set((state) => {
        state.pileSymbolsDialogOpen = false;
      }),

    setPileSymbolOrder: (groupKey: string, order: string[]) =>
      set((state) => {
        state.pileSymbolOrder[groupKey] = order;
      }),
  };
}
