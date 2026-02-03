/**
 * Selection Command Handlers
 *
 * Manages shape selection: set, add, remove, clear, all.
 */

import type { CommandDefinition, CommandResponse } from '../types';

export const selectionCommands: CommandDefinition[] = [
  // Set selection
  {
    command: 'selection',
    action: 'set',
    description: 'Set the selection to specific shapes',
    modifiesState: false,
    params: [
      { name: 'ids', type: 'array', required: true, description: 'Shape IDs to select' },
    ],
    handler: (params, context): CommandResponse => {
      const ids = params.ids as string[];
      context.getState().selectShapes(ids);

      return {
        success: true,
        data: {
          selectedCount: ids.length,
          ids,
        },
      };
    },
  },

  // Add to selection
  {
    command: 'selection',
    action: 'add',
    description: 'Add shapes to current selection',
    modifiesState: false,
    params: [
      { name: 'ids', type: 'array', required: true, description: 'Shape IDs to add to selection' },
    ],
    handler: (params, context): CommandResponse => {
      const state = context.getState();
      const newIds = params.ids as string[];
      const current = new Set(state.selectedShapeIds);

      newIds.forEach(id => current.add(id));
      const combined = Array.from(current);

      state.selectShapes(combined);

      return {
        success: true,
        data: {
          addedCount: newIds.length,
          totalSelected: combined.length,
          ids: combined,
        },
      };
    },
  },

  // Remove from selection
  {
    command: 'selection',
    action: 'remove',
    description: 'Remove shapes from current selection',
    modifiesState: false,
    params: [
      { name: 'ids', type: 'array', required: true, description: 'Shape IDs to remove from selection' },
    ],
    handler: (params, context): CommandResponse => {
      const state = context.getState();
      const removeIds = new Set(params.ids as string[]);
      const remaining = state.selectedShapeIds.filter(id => !removeIds.has(id));

      state.selectShapes(remaining);

      return {
        success: true,
        data: {
          removedCount: removeIds.size,
          totalSelected: remaining.length,
          ids: remaining,
        },
      };
    },
  },

  // Clear selection
  {
    command: 'selection',
    action: 'clear',
    description: 'Clear all selection',
    modifiesState: false,
    params: [],
    handler: (_, context): CommandResponse => {
      const state = context.getState();
      const previousCount = state.selectedShapeIds.length;
      state.deselectAll();

      return {
        success: true,
        data: {
          clearedCount: previousCount,
        },
      };
    },
  },

  // Select all
  {
    command: 'selection',
    action: 'all',
    description: 'Select all shapes in the active drawing',
    modifiesState: false,
    params: [
      { name: 'type', type: 'string', description: 'Filter by shape type' },
      { name: 'layer', type: 'string', description: 'Filter by layer ID' },
    ],
    handler: (params, context): CommandResponse => {
      const state = context.getState();
      let shapes = state.shapes.filter(s =>
        s.drawingId === state.activeDrawingId &&
        s.visible &&
        !s.locked
      );

      if (params.type) {
        shapes = shapes.filter(s => s.type === params.type);
      }
      if (params.layer) {
        shapes = shapes.filter(s => s.layerId === params.layer);
      }

      const ids = shapes.map(s => s.id);
      state.selectShapes(ids);

      return {
        success: true,
        data: {
          selectedCount: ids.length,
          ids,
        },
      };
    },
  },
];
