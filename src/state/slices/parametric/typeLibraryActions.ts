/**
 * Type Library Actions — CRUD for wall, slab, column, beam and pile types.
 *
 * Extracted from parametricSlice.ts to reduce file size.
 */

import type { ParametricState } from '../parametricSlice';
import type { Shape, ShapeGroup, WallShape, WallType, SlabType, ColumnType, BeamType, PileTypeDefinition, GroupedWallType, WallSystemType } from '../../../types/geometry';

interface FullStore extends ParametricState {
  isModified: boolean;
  shapes: Shape[];
  groups: ShapeGroup[];
  updateShapes: (updates: { id: string; updates: Partial<Shape> }[]) => void;
}

export function createTypeLibraryActions(
  set: (fn: (state: FullStore) => void) => void,
  get: () => FullStore
) {
  return {
    // ========================================================================
    // Wall Types
    // ========================================================================

    addWallType: (wallType: WallType) =>
      set((state) => {
        state.wallTypes.push(wallType);
      }),

    updateWallType: (id: string, updates: Partial<WallType>) => {
      set((state) => {
        const index = state.wallTypes.findIndex(w => w.id === id);
        if (index !== -1) {
          Object.assign(state.wallTypes[index], updates);
        }
      });

      // Propagate thickness changes to all wall shapes that reference this type.
      // Note: Hatch settings are no longer propagated to individual wall shapes because
      // the renderer now resolves hatching from the wall type at render time.
      if (updates.thickness !== undefined) {
        const store = get();
        const updatedType = store.wallTypes.find(w => w.id === id);
        if (!updatedType) return;

        const wallShapeUpdates: { id: string; updates: Partial<Shape> }[] = [];
        for (const shape of store.shapes) {
          if (shape.type === 'wall' && (shape as WallShape).wallTypeId === id) {
            wallShapeUpdates.push({
              id: shape.id,
              updates: {
                thickness: updatedType.thickness,
              } as Partial<WallShape>,
            });
          }
        }
        if (wallShapeUpdates.length > 0) {
          store.updateShapes(wallShapeUpdates);
        }
      }
    },

    deleteWallType: (id: string) =>
      set((state) => {
        state.wallTypes = state.wallTypes.filter(w => w.id !== id);
        // Clear last-used if the deleted type was the last-used one
        if (state.lastUsedWallTypeId === id) {
          state.lastUsedWallTypeId = null;
        }
      }),

    setWallTypes: (wallTypes: WallType[]) =>
      set((state) => {
        state.wallTypes = wallTypes;
      }),

    setLastUsedWallTypeId: (id: string | null) =>
      set((state) => {
        state.lastUsedWallTypeId = id;
      }),

    // ========================================================================
    // Grouped Wall Types
    // ========================================================================

    addGroupedWallType: (gwt: GroupedWallType) =>
      set((state) => {
        state.groupedWallTypes.push(gwt);
      }),

    updateGroupedWallType: (id: string, updates: Partial<GroupedWallType>) =>
      set((state) => {
        const index = state.groupedWallTypes.findIndex(g => g.id === id);
        if (index !== -1) {
          Object.assign(state.groupedWallTypes[index], updates);
        }
      }),

    deleteGroupedWallType: (id: string) =>
      set((state) => {
        state.groupedWallTypes = state.groupedWallTypes.filter(g => g.id !== id);
      }),

    explodeWallGroup: (groupId: string) => {
      set((state) => {
        // Remove groupId from all wall shapes in this group,
        // and clear their groupedWallTypeId/groupedWallLayerIndex
        for (const shape of state.shapes) {
          if (shape.groupId === groupId) {
            delete shape.groupId;
            if (shape.type === 'wall') {
              const wall = shape as WallShape;
              delete wall.groupedWallTypeId;
              delete wall.groupedWallLayerIndex;
            }
          }
        }
        // Remove the group entry
        state.groups = state.groups.filter(g => g.id !== groupId);
      });
    },

    // ========================================================================
    // Wall System Types (multi-layered assemblies)
    // ========================================================================

    addWallSystemType: (wst: WallSystemType) =>
      set((state) => {
        state.wallSystemTypes.push(wst);
      }),

    updateWallSystemType: (id: string, updates: Partial<WallSystemType>) =>
      set((state) => {
        const index = state.wallSystemTypes.findIndex(w => w.id === id);
        if (index !== -1) {
          Object.assign(state.wallSystemTypes[index], updates);
        }
      }),

    deleteWallSystemType: (id: string) =>
      set((state) => {
        state.wallSystemTypes = state.wallSystemTypes.filter(w => w.id !== id);
        // Clear wallSystemId from any walls that reference this deleted type
        for (const shape of state.shapes) {
          if (shape.type === 'wall' && (shape as WallShape).wallSystemId === id) {
            (shape as WallShape).wallSystemId = undefined;
          }
        }
      }),

    setWallSystemTypes: (types: WallSystemType[]) =>
      set((state) => {
        state.wallSystemTypes = types;
      }),

    openWallSystemDialog: () =>
      set((state) => {
        state.wallSystemDialogOpen = true;
      }),

    closeWallSystemDialog: () =>
      set((state) => {
        state.wallSystemDialogOpen = false;
      }),

    selectWallSubElement: (wallId: string, type: 'stud' | 'panel', key: string) =>
      set((state) => {
        state.selectedWallSubElement = { wallId, type, key };
      }),

    clearWallSubElement: () =>
      set((state) => {
        state.selectedWallSubElement = null;
      }),

    // ========================================================================
    // Slab Types
    // ========================================================================

    setSlabTypes: (slabTypes: SlabType[]) =>
      set((state) => {
        state.slabTypes = slabTypes;
      }),

    addSlabType: (slabType: SlabType) =>
      set((state) => {
        state.slabTypes.push(slabType);
      }),

    updateSlabType: (id: string, updates: Partial<SlabType>) =>
      set((state) => {
        const index = state.slabTypes.findIndex(s => s.id === id);
        if (index !== -1) {
          Object.assign(state.slabTypes[index], updates);
        }
      }),

    deleteSlabType: (id: string) =>
      set((state) => {
        state.slabTypes = state.slabTypes.filter(s => s.id !== id);
      }),

    // ========================================================================
    // Column Types
    // ========================================================================

    addColumnType: (columnType: ColumnType) =>
      set((state) => {
        state.columnTypes.push(columnType);
      }),

    updateColumnType: (id: string, updates: Partial<ColumnType>) =>
      set((state) => {
        const index = state.columnTypes.findIndex(c => c.id === id);
        if (index !== -1) {
          Object.assign(state.columnTypes[index], updates);
        }
      }),

    deleteColumnType: (id: string) =>
      set((state) => {
        state.columnTypes = state.columnTypes.filter(c => c.id !== id);
      }),

    // ========================================================================
    // Beam Types
    // ========================================================================

    addBeamType: (beamType: BeamType) =>
      set((state) => {
        state.beamTypes.push(beamType);
      }),

    updateBeamType: (id: string, updates: Partial<BeamType>) =>
      set((state) => {
        const index = state.beamTypes.findIndex(b => b.id === id);
        if (index !== -1) {
          Object.assign(state.beamTypes[index], updates);
        }
      }),

    deleteBeamType: (id: string) =>
      set((state) => {
        state.beamTypes = state.beamTypes.filter(b => b.id !== id);
      }),

    // ========================================================================
    // Pile Types
    // ========================================================================

    setPileTypes: (pileTypes: PileTypeDefinition[]) =>
      set((state) => {
        state.pileTypes = pileTypes;
      }),

    addPileType: (pileType: PileTypeDefinition) =>
      set((state) => {
        state.pileTypes.push(pileType);
      }),

    updatePileType: (id: string, updates: Partial<PileTypeDefinition>) =>
      set((state) => {
        const index = state.pileTypes.findIndex(p => p.id === id);
        if (index !== -1) {
          Object.assign(state.pileTypes[index], updates);
        }
      }),

    removePileType: (id: string) =>
      set((state) => {
        state.pileTypes = state.pileTypes.filter(p => p.id !== id);
      }),
  };
}
