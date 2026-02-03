/**
 * Layer Command Handlers
 *
 * Layer CRUD operations: create, delete, update, setActive, list, get.
 */

import type { CommandDefinition, CommandResponse } from '../types';
import type { Layer, LineStyle } from '../../../types/geometry';

export const layerCommands: CommandDefinition[] = [
  // Create layer
  {
    command: 'layer',
    action: 'create',
    description: 'Create a new layer',
    modifiesState: true,
    params: [
      { name: 'name', type: 'string', required: true, description: 'Layer name' },
      { name: 'color', type: 'string', default: '#ffffff', description: 'Layer color' },
      { name: 'visible', type: 'boolean', default: true, description: 'Layer visibility' },
      { name: 'locked', type: 'boolean', default: false, description: 'Layer locked state' },
      { name: 'lineStyle', type: 'string', default: 'solid', enum: ['solid', 'dashed', 'dotted', 'dashdot'], description: 'Default line style' },
      { name: 'lineWidth', type: 'number', default: 1, min: 0.1, description: 'Default line width' },
    ],
    handler: (params, context): CommandResponse => {
      const state = context.getState();
      const prevLayerIds = new Set(state.layers.map(l => l.id));

      state.addLayer(params.name as string);

      const newLayer = context.getState().layers.find(l => !prevLayerIds.has(l.id));
      if (!newLayer) {
        return { success: false, error: 'Failed to create layer' };
      }

      // Apply additional properties
      const updates: Partial<Layer> = {};
      if (params.color) updates.color = params.color as string;
      if (params.visible !== undefined) updates.visible = params.visible as boolean;
      if (params.locked !== undefined) updates.locked = params.locked as boolean;
      if (params.lineStyle) updates.lineStyle = params.lineStyle as LineStyle;
      if (params.lineWidth) updates.lineWidth = params.lineWidth as number;

      if (Object.keys(updates).length > 0) {
        state.updateLayer(newLayer.id, updates);
      }

      const layer = context.getState().layers.find(l => l.id === newLayer.id);

      return {
        success: true,
        data: { layer },
      };
    },
  },

  // Delete layer
  {
    command: 'layer',
    action: 'delete',
    description: 'Delete a layer',
    modifiesState: true,
    params: [
      { name: 'id', type: 'string', required: true, description: 'Layer ID to delete' },
    ],
    handler: (params, context): CommandResponse => {
      const id = params.id as string;
      const state = context.getState();

      const layer = state.layers.find(l => l.id === id);
      if (!layer) {
        return { success: false, error: `Layer not found: ${id}` };
      }

      // Count shapes on this layer
      const shapesOnLayer = state.shapes.filter(s => s.layerId === id).length;

      state.deleteLayer(id);

      return {
        success: true,
        data: {
          deletedLayer: layer,
          shapesAffected: shapesOnLayer,
        },
      };
    },
  },

  // Update layer
  {
    command: 'layer',
    action: 'update',
    description: 'Update layer properties',
    modifiesState: true,
    params: [
      { name: 'id', type: 'string', required: true, description: 'Layer ID' },
      { name: 'name', type: 'string', description: 'New layer name' },
      { name: 'color', type: 'string', description: 'Layer color' },
      { name: 'visible', type: 'boolean', description: 'Layer visibility' },
      { name: 'locked', type: 'boolean', description: 'Layer locked state' },
      { name: 'lineStyle', type: 'string', enum: ['solid', 'dashed', 'dotted', 'dashdot'], description: 'Default line style' },
      { name: 'lineWidth', type: 'number', min: 0.1, description: 'Default line width' },
    ],
    handler: (params, context): CommandResponse => {
      const id = params.id as string;
      const state = context.getState();

      const layer = state.layers.find(l => l.id === id);
      if (!layer) {
        return { success: false, error: `Layer not found: ${id}` };
      }

      const updates: Partial<Layer> = {};
      if (params.name !== undefined) updates.name = params.name as string;
      if (params.color !== undefined) updates.color = params.color as string;
      if (params.visible !== undefined) updates.visible = params.visible as boolean;
      if (params.locked !== undefined) updates.locked = params.locked as boolean;
      if (params.lineStyle !== undefined) updates.lineStyle = params.lineStyle as LineStyle;
      if (params.lineWidth !== undefined) updates.lineWidth = params.lineWidth as number;

      state.updateLayer(id, updates);

      const updatedLayer = context.getState().layers.find(l => l.id === id);

      return {
        success: true,
        data: { layer: updatedLayer },
      };
    },
  },

  // Set active layer
  {
    command: 'layer',
    action: 'setActive',
    description: 'Set the active layer',
    modifiesState: false,
    params: [
      { name: 'id', type: 'string', required: true, description: 'Layer ID to make active' },
    ],
    handler: (params, context): CommandResponse => {
      const id = params.id as string;
      const state = context.getState();

      const layer = state.layers.find(l => l.id === id);
      if (!layer) {
        return { success: false, error: `Layer not found: ${id}` };
      }

      state.setActiveLayer(id);

      return {
        success: true,
        data: { activeLayerId: id, layer },
      };
    },
  },

  // List layers
  {
    command: 'layer',
    action: 'list',
    description: 'List all layers',
    modifiesState: false,
    params: [
      { name: 'drawing', type: 'string', description: 'Filter by drawing ID' },
    ],
    handler: (params, context): CommandResponse => {
      const state = context.getState();
      const drawingId = (params.drawing as string) || state.activeDrawingId;

      const layers = state.layers.filter(l => l.drawingId === drawingId);

      // Add shape counts
      const layersWithCounts = layers.map(layer => ({
        ...layer,
        shapeCount: state.shapes.filter(s => s.layerId === layer.id).length,
      }));

      return {
        success: true,
        data: {
          layers: layersWithCounts,
          activeLayerId: state.activeLayerId,
          count: layers.length,
        },
      };
    },
  },

  // Get layer
  {
    command: 'layer',
    action: 'get',
    description: 'Get a layer by ID',
    modifiesState: false,
    params: [
      { name: 'id', type: 'string', required: true, description: 'Layer ID' },
    ],
    handler: (params, context): CommandResponse => {
      const id = params.id as string;
      const state = context.getState();

      const layer = state.layers.find(l => l.id === id);
      if (!layer) {
        return { success: false, error: `Layer not found: ${id}` };
      }

      const shapeCount = state.shapes.filter(s => s.layerId === id).length;

      return {
        success: true,
        data: {
          layer,
          shapeCount,
          isActive: state.activeLayerId === id,
        },
      };
    },
  },
];
