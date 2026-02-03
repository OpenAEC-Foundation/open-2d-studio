/**
 * Draw Command Handlers
 *
 * Handles creation of all shape types including hatch.
 */

import type { CommandDefinition, CommandContext, CommandResponse } from '../types';
import type { Shape, ShapeType, Point } from '../../../types/geometry';

/**
 * Helper to create a shape via the state
 */
function createShape(
  context: CommandContext,
  type: ShapeType,
  params: Record<string, unknown>
): Shape {
  const state = context.getState();
  const layerId = state.activeLayerId;
  const drawingId = state.activeDrawingId;
  const style = (params.style as Record<string, unknown>) || {};

  switch (type) {
    case 'line':
      return createLineInternal(params, layerId, drawingId, style);
    case 'rectangle':
      return createRectangleInternal(params, layerId, drawingId, style);
    case 'circle':
      return createCircleInternal(params, layerId, drawingId, style);
    case 'arc':
      return createArcInternal(params, layerId, drawingId, style);
    case 'ellipse':
      return createEllipseInternal(params, layerId, drawingId, style);
    case 'polyline':
      return createPolylineInternal(params, layerId, drawingId, style);
    case 'spline':
      return createSplineInternal(params, layerId, drawingId, style);
    case 'text':
      return createTextInternal(params, layerId, drawingId, style);
    case 'point':
      return createPointInternal(params, layerId, drawingId, style);
    case 'dimension':
      return createDimensionInternal(params, layerId, drawingId, style);
    case 'hatch':
      return createHatchInternal(params, layerId, drawingId, style);
    default:
      throw new Error(`Unsupported shape type: ${type}`);
  }
}

function generateId(): string {
  return `shape_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

function createLineInternal(
  params: Record<string, unknown>,
  layerId: string,
  drawingId: string,
  style: Record<string, unknown>
): Shape {
  return {
    id: generateId(),
    type: 'line',
    layerId,
    drawingId,
    style: { strokeColor: '#ffffff', strokeWidth: 1, lineStyle: 'solid', ...style },
    visible: true,
    locked: false,
    start: params.start as Point,
    end: params.end as Point,
  } as Shape;
}

function createRectangleInternal(
  params: Record<string, unknown>,
  layerId: string,
  drawingId: string,
  style: Record<string, unknown>
): Shape {
  return {
    id: generateId(),
    type: 'rectangle',
    layerId,
    drawingId,
    style: { strokeColor: '#ffffff', strokeWidth: 1, lineStyle: 'solid', ...style },
    visible: true,
    locked: false,
    topLeft: (params.topLeft || params.position || { x: 0, y: 0 }) as Point,
    width: params.width as number,
    height: params.height as number,
    rotation: (params.rotation as number) || 0,
  } as Shape;
}

function createCircleInternal(
  params: Record<string, unknown>,
  layerId: string,
  drawingId: string,
  style: Record<string, unknown>
): Shape {
  return {
    id: generateId(),
    type: 'circle',
    layerId,
    drawingId,
    style: { strokeColor: '#ffffff', strokeWidth: 1, lineStyle: 'solid', ...style },
    visible: true,
    locked: false,
    center: params.center as Point,
    radius: params.radius as number,
  } as Shape;
}

function createArcInternal(
  params: Record<string, unknown>,
  layerId: string,
  drawingId: string,
  style: Record<string, unknown>
): Shape {
  return {
    id: generateId(),
    type: 'arc',
    layerId,
    drawingId,
    style: { strokeColor: '#ffffff', strokeWidth: 1, lineStyle: 'solid', ...style },
    visible: true,
    locked: false,
    center: params.center as Point,
    radius: params.radius as number,
    startAngle: params.startAngle as number,
    endAngle: params.endAngle as number,
  } as Shape;
}

function createEllipseInternal(
  params: Record<string, unknown>,
  layerId: string,
  drawingId: string,
  style: Record<string, unknown>
): Shape {
  return {
    id: generateId(),
    type: 'ellipse',
    layerId,
    drawingId,
    style: { strokeColor: '#ffffff', strokeWidth: 1, lineStyle: 'solid', ...style },
    visible: true,
    locked: false,
    center: params.center as Point,
    radiusX: params.radiusX as number,
    radiusY: params.radiusY as number,
    rotation: (params.rotation as number) || 0,
  } as Shape;
}

function createPolylineInternal(
  params: Record<string, unknown>,
  layerId: string,
  drawingId: string,
  style: Record<string, unknown>
): Shape {
  return {
    id: generateId(),
    type: 'polyline',
    layerId,
    drawingId,
    style: { strokeColor: '#ffffff', strokeWidth: 1, lineStyle: 'solid', ...style },
    visible: true,
    locked: false,
    points: params.points as Point[],
    closed: (params.closed as boolean) || false,
  } as Shape;
}

function createSplineInternal(
  params: Record<string, unknown>,
  layerId: string,
  drawingId: string,
  style: Record<string, unknown>
): Shape {
  return {
    id: generateId(),
    type: 'spline',
    layerId,
    drawingId,
    style: { strokeColor: '#ffffff', strokeWidth: 1, lineStyle: 'solid', ...style },
    visible: true,
    locked: false,
    points: params.points as Point[],
    closed: (params.closed as boolean) || false,
  } as Shape;
}

function createTextInternal(
  params: Record<string, unknown>,
  layerId: string,
  drawingId: string,
  style: Record<string, unknown>
): Shape {
  return {
    id: generateId(),
    type: 'text',
    layerId,
    drawingId,
    style: { strokeColor: '#ffffff', strokeWidth: 1, lineStyle: 'solid', ...style },
    visible: true,
    locked: false,
    position: params.position as Point,
    text: (params.text as string) || '',
    fontSize: (params.fontSize as number) || 12,
    fontFamily: (params.fontFamily as string) || 'Arial',
    rotation: (params.rotation as number) || 0,
    alignment: (params.alignment as string) || 'left',
    verticalAlignment: (params.verticalAlignment as string) || 'top',
    bold: (params.bold as boolean) || false,
    italic: (params.italic as boolean) || false,
    underline: (params.underline as boolean) || false,
    color: (params.color as string) || '#ffffff',
    lineHeight: (params.lineHeight as number) || 1.2,
    fixedWidth: params.fixedWidth as number | undefined,
  } as Shape;
}

function createPointInternal(
  params: Record<string, unknown>,
  layerId: string,
  drawingId: string,
  style: Record<string, unknown>
): Shape {
  return {
    id: generateId(),
    type: 'point',
    layerId,
    drawingId,
    style: { strokeColor: '#ffffff', strokeWidth: 1, lineStyle: 'solid', ...style },
    visible: true,
    locked: false,
    position: params.position as Point,
  } as Shape;
}

function createDimensionInternal(
  params: Record<string, unknown>,
  layerId: string,
  drawingId: string,
  style: Record<string, unknown>
): Shape {
  return {
    id: generateId(),
    type: 'dimension',
    layerId,
    drawingId,
    style: { strokeColor: '#00ffff', strokeWidth: 1, lineStyle: 'solid', ...style },
    visible: true,
    locked: false,
    dimensionType: (params.dimensionType as string) || 'linear',
    points: params.points as Point[],
    dimensionLineOffset: (params.dimensionLineOffset as number) || 20,
    linearDirection: params.linearDirection,
    references: params.references,
    value: (params.value as string) || '',
    valueOverridden: (params.valueOverridden as boolean) || false,
    prefix: params.prefix,
    suffix: params.suffix,
    dimensionStyle: params.dimensionStyle || {
      arrowType: 'filled',
      arrowSize: 3,
      extensionLineGap: 2,
      extensionLineOvershoot: 2,
      textHeight: 3,
      textPlacement: 'above',
      lineColor: '#00ffff',
      textColor: '#00ffff',
      precision: 2,
    },
  } as Shape;
}

function createHatchInternal(
  params: Record<string, unknown>,
  layerId: string,
  drawingId: string,
  style: Record<string, unknown>
): Shape {
  return {
    id: generateId(),
    type: 'hatch',
    layerId,
    drawingId,
    style: { strokeColor: '#ffffff', strokeWidth: 1, lineStyle: 'solid', ...style },
    visible: true,
    locked: false,
    points: params.points as Point[],
    patternType: (params.patternType as string) || 'solid',
    patternAngle: (params.patternAngle as number) || 0,
    patternScale: (params.patternScale as number) || 1,
    fillColor: (params.fillColor as string) || '#ffffff',
    backgroundColor: params.backgroundColor as string | undefined,
    customPatternId: params.customPatternId as string | undefined,
  } as Shape;
}

/**
 * Create draw command definitions for all entity types
 */
export const drawCommands: CommandDefinition[] = [
  // Line
  {
    command: 'draw',
    action: 'create',
    entity: 'line',
    description: 'Draw a line between two points',
    modifiesState: true,
    params: [
      { name: 'start', type: 'point', required: true, description: 'Start point' },
      { name: 'end', type: 'point', required: true, description: 'End point' },
      { name: 'style', type: 'object', description: 'Optional style overrides' },
    ],
    handler: (params, context): CommandResponse => {
      const shape = createShape(context, 'line', params);
      context.getState().addShape(shape);
      return { success: true, data: { id: shape.id, shape } };
    },
  },

  // Rectangle
  {
    command: 'draw',
    action: 'create',
    entity: 'rectangle',
    description: 'Draw a rectangle',
    modifiesState: true,
    params: [
      { name: 'topLeft', type: 'point', required: true, description: 'Top-left corner' },
      { name: 'width', type: 'number', required: true, min: 0, description: 'Width' },
      { name: 'height', type: 'number', required: true, min: 0, description: 'Height' },
      { name: 'rotation', type: 'number', default: 0, description: 'Rotation in radians' },
      { name: 'style', type: 'object', description: 'Optional style overrides' },
    ],
    handler: (params, context): CommandResponse => {
      const shape = createShape(context, 'rectangle', params);
      context.getState().addShape(shape);
      return { success: true, data: { id: shape.id, shape } };
    },
  },

  // Circle
  {
    command: 'draw',
    action: 'create',
    entity: 'circle',
    description: 'Draw a circle',
    modifiesState: true,
    params: [
      { name: 'center', type: 'point', required: true, description: 'Center point' },
      { name: 'radius', type: 'number', required: true, min: 0, description: 'Radius' },
      { name: 'style', type: 'object', description: 'Optional style overrides' },
    ],
    handler: (params, context): CommandResponse => {
      const shape = createShape(context, 'circle', params);
      context.getState().addShape(shape);
      return { success: true, data: { id: shape.id, shape } };
    },
  },

  // Arc
  {
    command: 'draw',
    action: 'create',
    entity: 'arc',
    description: 'Draw an arc',
    modifiesState: true,
    params: [
      { name: 'center', type: 'point', required: true, description: 'Center point' },
      { name: 'radius', type: 'number', required: true, min: 0, description: 'Radius' },
      { name: 'startAngle', type: 'number', required: true, description: 'Start angle in radians' },
      { name: 'endAngle', type: 'number', required: true, description: 'End angle in radians' },
      { name: 'style', type: 'object', description: 'Optional style overrides' },
    ],
    handler: (params, context): CommandResponse => {
      const shape = createShape(context, 'arc', params);
      context.getState().addShape(shape);
      return { success: true, data: { id: shape.id, shape } };
    },
  },

  // Ellipse
  {
    command: 'draw',
    action: 'create',
    entity: 'ellipse',
    description: 'Draw an ellipse',
    modifiesState: true,
    params: [
      { name: 'center', type: 'point', required: true, description: 'Center point' },
      { name: 'radiusX', type: 'number', required: true, min: 0, description: 'X radius' },
      { name: 'radiusY', type: 'number', required: true, min: 0, description: 'Y radius' },
      { name: 'rotation', type: 'number', default: 0, description: 'Rotation in radians' },
      { name: 'style', type: 'object', description: 'Optional style overrides' },
    ],
    handler: (params, context): CommandResponse => {
      const shape = createShape(context, 'ellipse', params);
      context.getState().addShape(shape);
      return { success: true, data: { id: shape.id, shape } };
    },
  },

  // Polyline
  {
    command: 'draw',
    action: 'create',
    entity: 'polyline',
    description: 'Draw a polyline (connected line segments)',
    modifiesState: true,
    params: [
      { name: 'points', type: 'points', required: true, description: 'Array of points' },
      { name: 'closed', type: 'boolean', default: false, description: 'Close the polyline' },
      { name: 'style', type: 'object', description: 'Optional style overrides' },
    ],
    handler: (params, context): CommandResponse => {
      const shape = createShape(context, 'polyline', params);
      context.getState().addShape(shape);
      return { success: true, data: { id: shape.id, shape } };
    },
  },

  // Spline
  {
    command: 'draw',
    action: 'create',
    entity: 'spline',
    description: 'Draw a spline (smooth curve through points)',
    modifiesState: true,
    params: [
      { name: 'points', type: 'points', required: true, description: 'Control points' },
      { name: 'closed', type: 'boolean', default: false, description: 'Close the spline' },
      { name: 'style', type: 'object', description: 'Optional style overrides' },
    ],
    handler: (params, context): CommandResponse => {
      const shape = createShape(context, 'spline', params);
      context.getState().addShape(shape);
      return { success: true, data: { id: shape.id, shape } };
    },
  },

  // Text
  {
    command: 'draw',
    action: 'create',
    entity: 'text',
    description: 'Add text annotation',
    modifiesState: true,
    params: [
      { name: 'position', type: 'point', required: true, description: 'Text position' },
      { name: 'text', type: 'string', required: true, description: 'Text content' },
      { name: 'fontSize', type: 'number', default: 12, description: 'Font size' },
      { name: 'fontFamily', type: 'string', default: 'Arial', description: 'Font family' },
      { name: 'rotation', type: 'number', default: 0, description: 'Rotation in radians' },
      { name: 'alignment', type: 'string', default: 'left', enum: ['left', 'center', 'right'], description: 'Horizontal alignment' },
      { name: 'verticalAlignment', type: 'string', default: 'top', enum: ['top', 'middle', 'bottom'], description: 'Vertical alignment' },
      { name: 'color', type: 'string', default: '#ffffff', description: 'Text color' },
      { name: 'bold', type: 'boolean', default: false, description: 'Bold text' },
      { name: 'italic', type: 'boolean', default: false, description: 'Italic text' },
      { name: 'style', type: 'object', description: 'Optional style overrides' },
    ],
    handler: (params, context): CommandResponse => {
      const shape = createShape(context, 'text', params);
      context.getState().addShape(shape);
      return { success: true, data: { id: shape.id, shape } };
    },
  },

  // Point
  {
    command: 'draw',
    action: 'create',
    entity: 'point',
    description: 'Draw a point marker',
    modifiesState: true,
    params: [
      { name: 'position', type: 'point', required: true, description: 'Point position' },
      { name: 'style', type: 'object', description: 'Optional style overrides' },
    ],
    handler: (params, context): CommandResponse => {
      const shape = createShape(context, 'point', params);
      context.getState().addShape(shape);
      return { success: true, data: { id: shape.id, shape } };
    },
  },

  // Dimension
  {
    command: 'draw',
    action: 'create',
    entity: 'dimension',
    description: 'Add a dimension annotation',
    modifiesState: true,
    params: [
      { name: 'points', type: 'points', required: true, description: 'Dimension reference points' },
      { name: 'dimensionType', type: 'string', default: 'linear', enum: ['linear', 'aligned', 'angular', 'radial', 'diameter'], description: 'Dimension type' },
      { name: 'dimensionLineOffset', type: 'number', default: 20, description: 'Offset of dimension line' },
      { name: 'value', type: 'string', description: 'Override dimension value' },
      { name: 'prefix', type: 'string', description: 'Text prefix' },
      { name: 'suffix', type: 'string', description: 'Text suffix' },
      { name: 'style', type: 'object', description: 'Optional style overrides' },
    ],
    handler: (params, context): CommandResponse => {
      const shape = createShape(context, 'dimension', params);
      context.getState().addShape(shape);
      return { success: true, data: { id: shape.id, shape } };
    },
  },

  // Hatch
  {
    command: 'draw',
    action: 'create',
    entity: 'hatch',
    description: 'Create a hatched/filled region',
    modifiesState: true,
    params: [
      { name: 'points', type: 'points', required: true, description: 'Boundary polygon vertices' },
      { name: 'patternType', type: 'string', default: 'solid', enum: ['solid', 'diagonal', 'crosshatch', 'horizontal', 'vertical', 'dots', 'custom'], description: 'Hatch pattern type' },
      { name: 'patternAngle', type: 'number', default: 0, description: 'Pattern rotation in degrees' },
      { name: 'patternScale', type: 'number', default: 1, min: 0.1, description: 'Pattern scale multiplier' },
      { name: 'fillColor', type: 'string', default: '#ffffff', description: 'Pattern/fill color' },
      { name: 'backgroundColor', type: 'string', description: 'Background color (transparent if not set)' },
      { name: 'customPatternId', type: 'string', description: 'Custom pattern ID (when patternType is custom)' },
      { name: 'style', type: 'object', description: 'Optional style overrides' },
    ],
    handler: (params, context): CommandResponse => {
      const shape = createShape(context, 'hatch', params);
      context.getState().addShape(shape);
      return { success: true, data: { id: shape.id, shape } };
    },
  },

  // Bulk create
  {
    command: 'draw',
    action: 'createBulk',
    description: 'Create multiple shapes in a single operation',
    modifiesState: true,
    params: [
      {
        name: 'shapes',
        type: 'array',
        required: true,
        description: 'Array of shape definitions',
        items: {
          name: 'shape',
          type: 'object',
          properties: [
            { name: 'type', type: 'string', required: true, description: 'Shape type' },
            { name: 'params', type: 'object', description: 'Shape parameters (optional - can use flat format)' },
          ],
        },
      },
    ],
    handler: (params, context): CommandResponse => {
      const shapes = params.shapes as Array<Record<string, unknown>>;
      const results: Shape[] = [];

      for (const shapeDef of shapes) {
        const type = shapeDef.type as ShapeType;
        // Support both formats:
        // 1. { type: 'line', params: { start: {...}, end: {...} } }
        // 2. { type: 'line', start: {...}, end: {...} } (flat format)
        let shapeParams: Record<string, unknown>;
        if (shapeDef.params && typeof shapeDef.params === 'object') {
          shapeParams = shapeDef.params as Record<string, unknown>;
        } else {
          // Flat format - extract all props except 'type'
          const { type: _type, ...rest } = shapeDef;
          shapeParams = rest;
        }
        results.push(createShape(context, type, shapeParams));
      }

      context.getState().addShapes(results);

      return {
        success: true,
        data: {
          count: results.length,
          ids: results.map(s => s.id),
          shapes: results,
        },
      };
    },
  },
];
