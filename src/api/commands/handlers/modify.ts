/**
 * Modify Command Handlers
 *
 * Handles shape transformations: move, copy, rotate, scale, mirror, delete, update.
 */

import type { CommandDefinition, CommandContext, CommandResponse } from '../types';
import type { Shape, Point, ShapeStyle } from '../../../types/geometry';

/**
 * Clone a shape with optional offset
 */
function cloneShape(shape: Shape, offset: Point = { x: 0, y: 0 }): Shape {
  const cloned = JSON.parse(JSON.stringify(shape));
  cloned.id = `shape_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  translateShape(cloned, offset);
  return cloned;
}

/**
 * Translate shape by offset (modifies in place)
 */
function translateShape(shape: Shape, offset: Point): void {
  switch (shape.type) {
    case 'line':
      shape.start.x += offset.x;
      shape.start.y += offset.y;
      shape.end.x += offset.x;
      shape.end.y += offset.y;
      break;
    case 'rectangle':
      shape.topLeft.x += offset.x;
      shape.topLeft.y += offset.y;
      break;
    case 'circle':
    case 'arc':
    case 'ellipse':
      shape.center.x += offset.x;
      shape.center.y += offset.y;
      break;
    case 'polyline':
    case 'spline':
    case 'hatch':
      shape.points.forEach((p: Point) => {
        p.x += offset.x;
        p.y += offset.y;
      });
      break;
    case 'point':
    case 'text':
      shape.position.x += offset.x;
      shape.position.y += offset.y;
      break;
    case 'dimension':
      if (shape.points) {
        shape.points.forEach((p: Point) => {
          p.x += offset.x;
          p.y += offset.y;
        });
      }
      break;
  }
}

/**
 * Rotate point around center
 */
function rotatePoint(point: Point, center: Point, angle: number): Point {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const dx = point.x - center.x;
  const dy = point.y - center.y;
  return {
    x: center.x + dx * cos - dy * sin,
    y: center.y + dx * sin + dy * cos,
  };
}

/**
 * Rotate shape around center (modifies in place)
 */
function rotateShape(shape: Shape, center: Point, angle: number): void {
  switch (shape.type) {
    case 'line':
      shape.start = rotatePoint(shape.start, center, angle);
      shape.end = rotatePoint(shape.end, center, angle);
      break;
    case 'rectangle':
      shape.topLeft = rotatePoint(shape.topLeft, center, angle);
      shape.rotation = (shape.rotation || 0) + angle;
      break;
    case 'circle':
      shape.center = rotatePoint(shape.center, center, angle);
      break;
    case 'arc':
      shape.center = rotatePoint(shape.center, center, angle);
      shape.startAngle += angle;
      shape.endAngle += angle;
      break;
    case 'ellipse':
      shape.center = rotatePoint(shape.center, center, angle);
      shape.rotation = (shape.rotation || 0) + angle;
      break;
    case 'polyline':
    case 'spline':
    case 'hatch':
      shape.points = shape.points.map((p: Point) => rotatePoint(p, center, angle));
      break;
    case 'point':
      shape.position = rotatePoint(shape.position, center, angle);
      break;
    case 'text':
      shape.position = rotatePoint(shape.position, center, angle);
      shape.rotation = (shape.rotation || 0) + angle;
      break;
    case 'dimension':
      if (shape.points) {
        shape.points = shape.points.map((p: Point) => rotatePoint(p, center, angle));
      }
      break;
  }
}

/**
 * Scale shape from center (modifies in place)
 */
function scaleShape(shape: Shape, center: Point, factor: number): void {
  const scale = (point: Point): Point => ({
    x: center.x + (point.x - center.x) * factor,
    y: center.y + (point.y - center.y) * factor,
  });

  switch (shape.type) {
    case 'line':
      shape.start = scale(shape.start);
      shape.end = scale(shape.end);
      break;
    case 'rectangle':
      shape.topLeft = scale(shape.topLeft);
      shape.width *= factor;
      shape.height *= factor;
      break;
    case 'circle':
      shape.center = scale(shape.center);
      shape.radius *= factor;
      break;
    case 'arc':
      shape.center = scale(shape.center);
      shape.radius *= factor;
      break;
    case 'ellipse':
      shape.center = scale(shape.center);
      shape.radiusX *= factor;
      shape.radiusY *= factor;
      break;
    case 'polyline':
    case 'spline':
    case 'hatch':
      shape.points = shape.points.map(scale);
      break;
    case 'point':
      shape.position = scale(shape.position);
      break;
    case 'text':
      shape.position = scale(shape.position);
      shape.fontSize = (shape.fontSize || 12) * factor;
      break;
    case 'dimension':
      if (shape.points) {
        shape.points = shape.points.map(scale);
      }
      break;
  }
}

/**
 * Mirror shape across line (modifies in place)
 */
function mirrorShape(shape: Shape, p1: Point, p2: Point): void {
  const mirrorPoint = (point: Point): Point => {
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const lengthSq = dx * dx + dy * dy;
    if (lengthSq === 0) return point;

    const t = ((point.x - p1.x) * dx + (point.y - p1.y) * dy) / lengthSq;
    const projX = p1.x + t * dx;
    const projY = p1.y + t * dy;

    return {
      x: 2 * projX - point.x,
      y: 2 * projY - point.y,
    };
  };

  switch (shape.type) {
    case 'line':
      shape.start = mirrorPoint(shape.start);
      shape.end = mirrorPoint(shape.end);
      break;
    case 'rectangle':
      shape.topLeft = mirrorPoint(shape.topLeft);
      shape.rotation = -(shape.rotation || 0);
      break;
    case 'circle':
      shape.center = mirrorPoint(shape.center);
      break;
    case 'arc': {
      shape.center = mirrorPoint(shape.center);
      const lineAngle = Math.atan2(p2.y - p1.y, p2.x - p1.x);
      const newStart = 2 * lineAngle - shape.startAngle;
      const newEnd = 2 * lineAngle - shape.endAngle;
      shape.startAngle = newEnd;
      shape.endAngle = newStart;
      break;
    }
    case 'ellipse':
      shape.center = mirrorPoint(shape.center);
      shape.rotation = -(shape.rotation || 0);
      break;
    case 'polyline':
    case 'spline':
    case 'hatch':
      shape.points = shape.points.map(mirrorPoint);
      if (shape.type === 'polyline' && shape.bulge) {
        shape.bulge = shape.bulge.map((b: number) => -b);
      }
      break;
    case 'point':
      shape.position = mirrorPoint(shape.position);
      break;
    case 'text':
      shape.position = mirrorPoint(shape.position);
      shape.rotation = -(shape.rotation || 0);
      break;
    case 'dimension':
      if (shape.points) {
        shape.points = shape.points.map(mirrorPoint);
      }
      break;
  }
}

/**
 * Get shapes by IDs or use selection
 */
function getTargetShapes(
  context: CommandContext,
  ids?: string[]
): { shapes: Shape[]; ids: string[] } {
  const state = context.getState();
  const targetIds = ids || [...state.selectedShapeIds];

  if (targetIds.length === 0) {
    return { shapes: [], ids: [] };
  }

  const idSet = new Set(targetIds);
  const shapes = state.shapes.filter(s => idSet.has(s.id));

  return { shapes, ids: targetIds };
}

export const modifyCommands: CommandDefinition[] = [
  // Move
  {
    command: 'modify',
    action: 'move',
    description: 'Move shapes by offset',
    modifiesState: true,
    params: [
      { name: 'ids', type: 'array', description: 'Shape IDs to move (uses selection if not provided)' },
      { name: 'offset', type: 'point', required: true, description: 'Translation offset {x, y}' },
    ],
    handler: (params, context): CommandResponse => {
      const { shapes, ids } = getTargetShapes(context, params.ids as string[] | undefined);

      if (shapes.length === 0) {
        return { success: false, error: 'No shapes to move' };
      }

      const offset = params.offset as Point;
      const state = context.getState();

      for (const shape of shapes) {
        const cloned = JSON.parse(JSON.stringify(shape));
        translateShape(cloned, offset);
        state.updateShape(shape.id, cloned);
      }

      return { success: true, data: { movedCount: shapes.length, ids } };
    },
  },

  // Copy
  {
    command: 'modify',
    action: 'copy',
    description: 'Copy shapes with optional offset',
    modifiesState: true,
    params: [
      { name: 'ids', type: 'array', description: 'Shape IDs to copy (uses selection if not provided)' },
      { name: 'offset', type: 'point', default: { x: 20, y: 20 }, description: 'Offset for copies' },
    ],
    handler: (params, context): CommandResponse => {
      const { shapes } = getTargetShapes(context, params.ids as string[] | undefined);

      if (shapes.length === 0) {
        return { success: false, error: 'No shapes to copy' };
      }

      const offset = (params.offset as Point) || { x: 20, y: 20 };
      const copies = shapes.map(s => cloneShape(s, offset));

      context.getState().addShapes(copies);

      return {
        success: true,
        data: {
          copiedCount: copies.length,
          newIds: copies.map(c => c.id),
        },
      };
    },
  },

  // Rotate
  {
    command: 'modify',
    action: 'rotate',
    description: 'Rotate shapes around a center point',
    modifiesState: true,
    params: [
      { name: 'ids', type: 'array', description: 'Shape IDs to rotate (uses selection if not provided)' },
      { name: 'center', type: 'point', required: true, description: 'Rotation center' },
      { name: 'angle', type: 'number', required: true, description: 'Rotation angle in radians' },
    ],
    handler: (params, context): CommandResponse => {
      const { shapes, ids } = getTargetShapes(context, params.ids as string[] | undefined);

      if (shapes.length === 0) {
        return { success: false, error: 'No shapes to rotate' };
      }

      const center = params.center as Point;
      const angle = params.angle as number;
      const state = context.getState();

      for (const shape of shapes) {
        const cloned = JSON.parse(JSON.stringify(shape));
        rotateShape(cloned, center, angle);
        state.updateShape(shape.id, cloned);
      }

      return { success: true, data: { rotatedCount: shapes.length, ids } };
    },
  },

  // Scale
  {
    command: 'modify',
    action: 'scale',
    description: 'Scale shapes from a center point',
    modifiesState: true,
    params: [
      { name: 'ids', type: 'array', description: 'Shape IDs to scale (uses selection if not provided)' },
      { name: 'center', type: 'point', required: true, description: 'Scale center' },
      { name: 'factor', type: 'number', required: true, min: 0.01, description: 'Scale factor' },
    ],
    handler: (params, context): CommandResponse => {
      const { shapes, ids } = getTargetShapes(context, params.ids as string[] | undefined);

      if (shapes.length === 0) {
        return { success: false, error: 'No shapes to scale' };
      }

      const center = params.center as Point;
      const factor = params.factor as number;
      const state = context.getState();

      for (const shape of shapes) {
        const cloned = JSON.parse(JSON.stringify(shape));
        scaleShape(cloned, center, factor);
        state.updateShape(shape.id, cloned);
      }

      return { success: true, data: { scaledCount: shapes.length, ids } };
    },
  },

  // Mirror
  {
    command: 'modify',
    action: 'mirror',
    description: 'Mirror shapes across a line',
    modifiesState: true,
    params: [
      { name: 'ids', type: 'array', description: 'Shape IDs to mirror (uses selection if not provided)' },
      { name: 'p1', type: 'point', required: true, description: 'First point of mirror line' },
      { name: 'p2', type: 'point', required: true, description: 'Second point of mirror line' },
      { name: 'copy', type: 'boolean', default: false, description: 'Create mirrored copies instead of modifying' },
    ],
    handler: (params, context): CommandResponse => {
      const { shapes, ids } = getTargetShapes(context, params.ids as string[] | undefined);

      if (shapes.length === 0) {
        return { success: false, error: 'No shapes to mirror' };
      }

      const p1 = params.p1 as Point;
      const p2 = params.p2 as Point;
      const makeCopy = params.copy as boolean;
      const state = context.getState();

      if (makeCopy) {
        const copies = shapes.map(s => {
          const copy = cloneShape(s, { x: 0, y: 0 });
          mirrorShape(copy, p1, p2);
          return copy;
        });
        state.addShapes(copies);
        return {
          success: true,
          data: {
            mirroredCount: copies.length,
            newIds: copies.map(c => c.id),
          },
        };
      } else {
        for (const shape of shapes) {
          const cloned = JSON.parse(JSON.stringify(shape));
          mirrorShape(cloned, p1, p2);
          state.updateShape(shape.id, cloned);
        }
        return { success: true, data: { mirroredCount: shapes.length, ids } };
      }
    },
  },

  // Delete
  {
    command: 'modify',
    action: 'delete',
    description: 'Delete shapes',
    modifiesState: true,
    params: [
      { name: 'ids', type: 'array', description: 'Shape IDs to delete (uses selection if not provided)' },
    ],
    handler: (params, context): CommandResponse => {
      const { ids } = getTargetShapes(context, params.ids as string[] | undefined);

      if (ids.length === 0) {
        return { success: false, error: 'No shapes to delete' };
      }

      context.getState().deleteShapes(ids);

      return { success: true, data: { deletedCount: ids.length, ids } };
    },
  },

  // Update
  {
    command: 'modify',
    action: 'update',
    description: 'Update shape properties',
    modifiesState: true,
    params: [
      { name: 'id', type: 'string', required: true, description: 'Shape ID to update' },
      { name: 'props', type: 'object', required: true, description: 'Properties to update' },
    ],
    handler: (params, context): CommandResponse => {
      const id = params.id as string;
      const props = params.props as Partial<Shape>;
      const state = context.getState();

      const shape = state.shapes.find(s => s.id === id);
      if (!shape) {
        return { success: false, error: `Shape not found: ${id}` };
      }

      state.updateShape(id, props);

      return { success: true, data: { id } };
    },
  },

  // Set Style
  {
    command: 'modify',
    action: 'setStyle',
    description: 'Update shape style',
    modifiesState: true,
    params: [
      { name: 'ids', type: 'array', description: 'Shape IDs to style (uses selection if not provided)' },
      { name: 'style', type: 'object', required: true, description: 'Style properties to set' },
    ],
    handler: (params, context): CommandResponse => {
      const { shapes, ids } = getTargetShapes(context, params.ids as string[] | undefined);

      if (shapes.length === 0) {
        return { success: false, error: 'No shapes to style' };
      }

      const styleUpdate = params.style as Partial<ShapeStyle>;
      const state = context.getState();

      for (const shape of shapes) {
        state.updateShape(shape.id, {
          style: { ...shape.style, ...styleUpdate },
        });
      }

      return { success: true, data: { styledCount: shapes.length, ids } };
    },
  },

  // Set Layer
  {
    command: 'modify',
    action: 'setLayer',
    description: 'Move shapes to a different layer',
    modifiesState: true,
    params: [
      { name: 'ids', type: 'array', description: 'Shape IDs to move (uses selection if not provided)' },
      { name: 'layerId', type: 'string', required: true, description: 'Target layer ID' },
    ],
    handler: (params, context): CommandResponse => {
      const { shapes, ids } = getTargetShapes(context, params.ids as string[] | undefined);

      if (shapes.length === 0) {
        return { success: false, error: 'No shapes to move' };
      }

      const layerId = params.layerId as string;
      const state = context.getState();

      // Verify layer exists
      const layer = state.layers.find(l => l.id === layerId);
      if (!layer) {
        return { success: false, error: `Layer not found: ${layerId}` };
      }

      for (const shape of shapes) {
        state.updateShape(shape.id, { layerId });
      }

      return { success: true, data: { movedCount: shapes.length, ids, layerId } };
    },
  },
];
