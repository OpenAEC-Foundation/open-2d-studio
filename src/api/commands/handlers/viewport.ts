/**
 * Viewport Command Handlers
 *
 * View control: pan, zoom, fit, reset, setZoom, get.
 */

import type { CommandDefinition, CommandResponse } from '../types';
import type { Point, Shape, BoundingBox } from '../../../types/geometry';

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

function getShapeBounds(shape: Shape): BoundingBox | null {
  switch (shape.type) {
    case 'line':
      return {
        minX: Math.min(shape.start.x, shape.end.x),
        minY: Math.min(shape.start.y, shape.end.y),
        maxX: Math.max(shape.start.x, shape.end.x),
        maxY: Math.max(shape.start.y, shape.end.y),
      };
    case 'rectangle':
      return {
        minX: shape.topLeft.x,
        minY: shape.topLeft.y,
        maxX: shape.topLeft.x + shape.width,
        maxY: shape.topLeft.y + shape.height,
      };
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

export const viewportCommands: CommandDefinition[] = [
  // Pan
  {
    command: 'viewport',
    action: 'pan',
    description: 'Pan the viewport by offset',
    modifiesState: false,
    params: [
      { name: 'dx', type: 'number', required: true, description: 'Horizontal pan amount' },
      { name: 'dy', type: 'number', required: true, description: 'Vertical pan amount' },
    ],
    handler: (params, context): CommandResponse => {
      const state = context.getState();
      const dx = params.dx as number;
      const dy = params.dy as number;

      state.setViewport({
        ...state.viewport,
        offsetX: state.viewport.offsetX + dx,
        offsetY: state.viewport.offsetY + dy,
      });

      return {
        success: true,
        data: {
          viewport: context.getState().viewport,
        },
      };
    },
  },

  // Zoom
  {
    command: 'viewport',
    action: 'zoom',
    description: 'Zoom in or out',
    modifiesState: false,
    params: [
      { name: 'direction', type: 'string', required: true, enum: ['in', 'out'], description: 'Zoom direction' },
      { name: 'factor', type: 'number', default: 1.2, min: 1.01, description: 'Zoom factor' },
      { name: 'center', type: 'point', description: 'Zoom center (screen coordinates)' },
    ],
    handler: (params, context): CommandResponse => {
      const state = context.getState();
      const direction = params.direction as string;
      // Note: factor param is available for future custom zoom implementation
      // Currently uses the built-in zoomIn/zoomOut which have fixed factors

      if (direction === 'in') {
        state.zoomIn();
      } else {
        state.zoomOut();
      }

      return {
        success: true,
        data: {
          viewport: context.getState().viewport,
        },
      };
    },
  },

  // Fit to content
  {
    command: 'viewport',
    action: 'fit',
    description: 'Fit viewport to show all content or specific shapes',
    modifiesState: false,
    params: [
      { name: 'ids', type: 'array', description: 'Shape IDs to fit to (fits all if not provided)' },
      { name: 'padding', type: 'number', default: 50, description: 'Padding around content' },
    ],
    handler: (params, context): CommandResponse => {
      const state = context.getState();
      const padding = (params.padding as number) || 50;

      if (params.ids && (params.ids as string[]).length > 0) {
        // Fit to specific shapes
        const idSet = new Set(params.ids as string[]);
        const shapes = state.shapes.filter(s => idSet.has(s.id));
        const bounds = getShapesBounds(shapes);

        if (!bounds) {
          return { success: false, error: 'No valid shapes to fit' };
        }

        const canvas = state.canvasSize;
        const contentW = bounds.maxX - bounds.minX;
        const contentH = bounds.maxY - bounds.minY;

        if (contentW <= 0 || contentH <= 0) {
          return { success: false, error: 'Invalid bounds' };
        }

        const zoom = Math.min(
          (canvas.width - padding * 2) / contentW,
          (canvas.height - padding * 2) / contentH
        );
        const centerX = (bounds.minX + bounds.maxX) / 2;
        const centerY = (bounds.minY + bounds.maxY) / 2;

        state.setViewport({
          zoom,
          offsetX: canvas.width / 2 - centerX * zoom,
          offsetY: canvas.height / 2 - centerY * zoom,
        });
      } else {
        // Fit to all content
        state.zoomToFit();
      }

      return {
        success: true,
        data: {
          viewport: context.getState().viewport,
        },
      };
    },
  },

  // Reset viewport
  {
    command: 'viewport',
    action: 'reset',
    description: 'Reset viewport to default position and zoom',
    modifiesState: false,
    params: [],
    handler: (_, context): CommandResponse => {
      context.getState().resetView();

      return {
        success: true,
        data: {
          viewport: context.getState().viewport,
        },
      };
    },
  },

  // Set zoom level
  {
    command: 'viewport',
    action: 'setZoom',
    description: 'Set specific zoom level',
    modifiesState: false,
    params: [
      { name: 'level', type: 'number', required: true, min: 0.01, max: 100, description: 'Zoom level (1 = 100%)' },
      { name: 'center', type: 'point', description: 'Zoom center in world coordinates' },
    ],
    handler: (params, context): CommandResponse => {
      const state = context.getState();
      const level = params.level as number;

      if (params.center) {
        const center = params.center as Point;
        const canvas = state.canvasSize;

        state.setViewport({
          zoom: level,
          offsetX: canvas.width / 2 - center.x * level,
          offsetY: canvas.height / 2 - center.y * level,
        });
      } else {
        state.setViewport({
          ...state.viewport,
          zoom: level,
        });
      }

      return {
        success: true,
        data: {
          viewport: context.getState().viewport,
        },
      };
    },
  },

  // Get viewport
  {
    command: 'viewport',
    action: 'get',
    description: 'Get current viewport state',
    modifiesState: false,
    params: [],
    handler: (_, context): CommandResponse => {
      const state = context.getState();

      return {
        success: true,
        data: {
          viewport: { ...state.viewport },
          canvasSize: { ...state.canvasSize },
        },
      };
    },
  },
];
