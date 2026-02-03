/**
 * Query Command Handlers
 *
 * Read-only operations: get, list, find, count, bounds, selected.
 */

import type { CommandDefinition, CommandResponse } from '../types';
import type { Shape, BoundingBox } from '../../../types/geometry';

/**
 * Get bounds of shapes
 */
function getShapesBounds(shapes: Shape[]): BoundingBox | null {
  if (shapes.length === 0) return null;

  let minX = Infinity, minY = Infinity;
  let maxX = -Infinity, maxY = -Infinity;

  for (const shape of shapes) {
    const bounds = getShapeBounds(shape);
    if (bounds) {
      minX = Math.min(minX, bounds.minX);
      minY = Math.min(minY, bounds.minY);
      maxX = Math.max(maxX, bounds.maxX);
      maxY = Math.max(maxY, bounds.maxY);
    }
  }

  if (minX === Infinity) return null;
  return { minX, minY, maxX, maxY };
}

/**
 * Get bounds of a single shape
 */
function getShapeBounds(shape: Shape): BoundingBox | null {
  switch (shape.type) {
    case 'line':
      return {
        minX: Math.min(shape.start.x, shape.end.x),
        minY: Math.min(shape.start.y, shape.end.y),
        maxX: Math.max(shape.start.x, shape.end.x),
        maxY: Math.max(shape.start.y, shape.end.y),
      };
    case 'rectangle': {
      const { topLeft, width, height } = shape;
      return {
        minX: topLeft.x,
        minY: topLeft.y,
        maxX: topLeft.x + width,
        maxY: topLeft.y + height,
      };
    }
    case 'circle':
      return {
        minX: shape.center.x - shape.radius,
        minY: shape.center.y - shape.radius,
        maxX: shape.center.x + shape.radius,
        maxY: shape.center.y + shape.radius,
      };
    case 'arc':
    case 'ellipse':
      const rx = shape.type === 'ellipse' ? shape.radiusX : shape.radius;
      const ry = shape.type === 'ellipse' ? shape.radiusY : shape.radius;
      return {
        minX: shape.center.x - rx,
        minY: shape.center.y - ry,
        maxX: shape.center.x + rx,
        maxY: shape.center.y + ry,
      };
    case 'polyline':
    case 'spline':
    case 'hatch':
      if (shape.points.length === 0) return null;
      return {
        minX: Math.min(...shape.points.map(p => p.x)),
        minY: Math.min(...shape.points.map(p => p.y)),
        maxX: Math.max(...shape.points.map(p => p.x)),
        maxY: Math.max(...shape.points.map(p => p.y)),
      };
    case 'point':
    case 'text':
      return {
        minX: shape.position.x,
        minY: shape.position.y,
        maxX: shape.position.x,
        maxY: shape.position.y,
      };
    case 'dimension':
      if (!shape.points || shape.points.length === 0) return null;
      return {
        minX: Math.min(...shape.points.map(p => p.x)),
        minY: Math.min(...shape.points.map(p => p.y)),
        maxX: Math.max(...shape.points.map(p => p.x)),
        maxY: Math.max(...shape.points.map(p => p.y)),
      };
    default:
      return null;
  }
}

export const queryCommands: CommandDefinition[] = [
  // Get single entity
  {
    command: 'query',
    action: 'get',
    description: 'Get a shape by ID',
    modifiesState: false,
    params: [
      { name: 'id', type: 'string', required: true, description: 'Shape ID' },
    ],
    handler: (params, context): CommandResponse => {
      const id = params.id as string;
      const shape = context.getState().shapes.find(s => s.id === id);

      if (!shape) {
        return { success: false, error: `Shape not found: ${id}` };
      }

      return { success: true, data: { shape } };
    },
  },

  // List entities
  {
    command: 'query',
    action: 'list',
    description: 'List shapes with optional filtering',
    modifiesState: false,
    params: [
      { name: 'type', type: 'string', description: 'Filter by shape type' },
      { name: 'layer', type: 'string', description: 'Filter by layer ID' },
      { name: 'drawing', type: 'string', description: 'Filter by drawing ID' },
      { name: 'visible', type: 'boolean', description: 'Filter by visibility' },
      { name: 'locked', type: 'boolean', description: 'Filter by locked state' },
      { name: 'limit', type: 'number', default: 1000, description: 'Maximum results' },
      { name: 'offset', type: 'number', default: 0, description: 'Skip first N results' },
    ],
    handler: (params, context): CommandResponse => {
      const state = context.getState();
      let shapes = [...state.shapes];

      // Apply filters
      if (params.type) {
        shapes = shapes.filter(s => s.type === params.type);
      }
      if (params.layer) {
        shapes = shapes.filter(s => s.layerId === params.layer);
      }
      if (params.drawing) {
        shapes = shapes.filter(s => s.drawingId === params.drawing);
      } else {
        // Default to active drawing
        shapes = shapes.filter(s => s.drawingId === state.activeDrawingId);
      }
      if (params.visible !== undefined) {
        shapes = shapes.filter(s => s.visible === params.visible);
      }
      if (params.locked !== undefined) {
        shapes = shapes.filter(s => s.locked === params.locked);
      }

      const total = shapes.length;
      const offset = (params.offset as number) || 0;
      const limit = (params.limit as number) || 1000;
      shapes = shapes.slice(offset, offset + limit);

      return {
        success: true,
        data: {
          shapes,
          total,
          offset,
          limit,
          hasMore: offset + shapes.length < total,
        },
      };
    },
  },

  // Find shapes in area
  {
    command: 'query',
    action: 'find',
    description: 'Find shapes within a bounding box',
    modifiesState: false,
    params: [
      { name: 'bounds', type: 'object', required: true, description: 'Bounding box {minX, minY, maxX, maxY}' },
      { name: 'type', type: 'string', description: 'Filter by shape type' },
      { name: 'intersects', type: 'boolean', default: true, description: 'Include shapes that intersect (vs fully contained)' },
    ],
    handler: (params, context): CommandResponse => {
      const state = context.getState();
      const searchBounds = params.bounds as BoundingBox;
      const intersects = params.intersects !== false;

      let shapes = state.shapes.filter(s => s.drawingId === state.activeDrawingId);

      if (params.type) {
        shapes = shapes.filter(s => s.type === params.type);
      }

      const results = shapes.filter(shape => {
        const bounds = getShapeBounds(shape);
        if (!bounds) return false;

        if (intersects) {
          // Check intersection
          return (
            bounds.maxX >= searchBounds.minX &&
            bounds.minX <= searchBounds.maxX &&
            bounds.maxY >= searchBounds.minY &&
            bounds.minY <= searchBounds.maxY
          );
        } else {
          // Check fully contained
          return (
            bounds.minX >= searchBounds.minX &&
            bounds.maxX <= searchBounds.maxX &&
            bounds.minY >= searchBounds.minY &&
            bounds.maxY <= searchBounds.maxY
          );
        }
      });

      return {
        success: true,
        data: {
          shapes: results,
          count: results.length,
        },
      };
    },
  },

  // Count shapes
  {
    command: 'query',
    action: 'count',
    description: 'Count shapes with optional filtering',
    modifiesState: false,
    params: [
      { name: 'type', type: 'string', description: 'Filter by shape type' },
      { name: 'layer', type: 'string', description: 'Filter by layer ID' },
      { name: 'drawing', type: 'string', description: 'Filter by drawing ID' },
    ],
    handler: (params, context): CommandResponse => {
      const state = context.getState();
      let shapes = [...state.shapes];

      if (params.type) {
        shapes = shapes.filter(s => s.type === params.type);
      }
      if (params.layer) {
        shapes = shapes.filter(s => s.layerId === params.layer);
      }
      if (params.drawing) {
        shapes = shapes.filter(s => s.drawingId === params.drawing);
      } else {
        shapes = shapes.filter(s => s.drawingId === state.activeDrawingId);
      }

      // Also provide counts by type
      const byType: Record<string, number> = {};
      for (const shape of shapes) {
        byType[shape.type] = (byType[shape.type] || 0) + 1;
      }

      return {
        success: true,
        data: {
          count: shapes.length,
          byType,
        },
      };
    },
  },

  // Get bounds
  {
    command: 'query',
    action: 'bounds',
    description: 'Get bounding box of shapes',
    modifiesState: false,
    params: [
      { name: 'ids', type: 'array', description: 'Shape IDs (uses all shapes if not provided)' },
    ],
    handler: (params, context): CommandResponse => {
      const state = context.getState();
      let shapes: Shape[];

      if (params.ids && (params.ids as string[]).length > 0) {
        const idSet = new Set(params.ids as string[]);
        shapes = state.shapes.filter(s => idSet.has(s.id));
      } else {
        shapes = state.shapes.filter(s => s.drawingId === state.activeDrawingId);
      }

      const bounds = getShapesBounds(shapes);

      if (!bounds) {
        return { success: true, data: { bounds: null } };
      }

      return {
        success: true,
        data: {
          bounds,
          width: bounds.maxX - bounds.minX,
          height: bounds.maxY - bounds.minY,
          center: {
            x: (bounds.minX + bounds.maxX) / 2,
            y: (bounds.minY + bounds.maxY) / 2,
          },
        },
      };
    },
  },

  // Get selected
  {
    command: 'query',
    action: 'selected',
    description: 'Get currently selected shapes',
    modifiesState: false,
    params: [],
    handler: (_, context): CommandResponse => {
      const state = context.getState();
      const ids = [...state.selectedShapeIds];
      const idSet = new Set(ids);
      const shapes = state.shapes.filter(s => idSet.has(s.id));

      return {
        success: true,
        data: {
          ids,
          shapes,
          count: ids.length,
        },
      };
    },
  },
];
