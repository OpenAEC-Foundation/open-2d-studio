/**
 * Shape Service - Business logic for shape operations
 *
 * Provides functions for:
 * - Creating shapes with proper defaults
 * - Cloning shapes (for copy operations)
 * - Transforming shapes (move, rotate, scale)
 * - Calculating shape bounds
 * - Validating shape data
 */

import type {
  Shape,
  Point,
  LineShape,
  RectangleShape,
  CircleShape,
  ArcShape,
  EllipseShape,
  PolylineShape,
  SplineShape,
  PointShape,
  ShapeStyle,
  BlockInstanceShape,
} from '../../types/geometry';
import { getShapeBounds, type ShapeBounds } from '../../engine/geometry/GeometryUtils';

/**
 * Generate a unique ID for shapes
 */
export function generateShapeId(): string {
  return `shape_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * Default shape style
 */
export const DEFAULT_STYLE: ShapeStyle = {
  strokeColor: '#ffffff',
  strokeWidth: 1,
  fillColor: undefined,
  lineStyle: 'solid',
};

/**
 * Create a line shape
 */
export function createLineShape(
  start: Point,
  end: Point,
  layerId: string,
  drawingId: string,
  style: Partial<ShapeStyle> = {}
): LineShape {
  return {
    id: generateShapeId(),
    type: 'line',
    layerId,
    drawingId,
    style: { ...DEFAULT_STYLE, ...style },
    visible: true,
    locked: false,
    start,
    end,
  };
}

/**
 * Create a rectangle shape
 */
export function createRectangleShape(
  topLeft: Point,
  width: number,
  height: number,
  layerId: string,
  drawingId: string,
  style: Partial<ShapeStyle> = {},
  rotation: number = 0
): RectangleShape {
  return {
    id: generateShapeId(),
    type: 'rectangle',
    layerId,
    drawingId,
    style: { ...DEFAULT_STYLE, ...style },
    visible: true,
    locked: false,
    topLeft,
    width: Math.abs(width),
    height: Math.abs(height),
    rotation,
  };
}

/**
 * Create a circle shape
 */
export function createCircleShape(
  center: Point,
  radius: number,
  layerId: string,
  drawingId: string,
  style: Partial<ShapeStyle> = {}
): CircleShape {
  return {
    id: generateShapeId(),
    type: 'circle',
    layerId,
    drawingId,
    style: { ...DEFAULT_STYLE, ...style },
    visible: true,
    locked: false,
    center,
    radius: Math.abs(radius),
    showCenterMark: true,
  };
}

/**
 * Create an arc shape
 */
export function createArcShape(
  center: Point,
  radius: number,
  startAngle: number,
  endAngle: number,
  layerId: string,
  drawingId: string,
  style: Partial<ShapeStyle> = {}
): ArcShape {
  return {
    id: generateShapeId(),
    type: 'arc',
    layerId,
    drawingId,
    style: { ...DEFAULT_STYLE, ...style },
    visible: true,
    locked: false,
    center,
    radius: Math.abs(radius),
    startAngle,
    endAngle,
    showCenterMark: true,
  };
}

/**
 * Create an ellipse shape
 */
export function createEllipseShape(
  center: Point,
  radiusX: number,
  radiusY: number,
  layerId: string,
  drawingId: string,
  style: Partial<ShapeStyle> = {},
  rotation: number = 0
): EllipseShape {
  return {
    id: generateShapeId(),
    type: 'ellipse',
    layerId,
    drawingId,
    style: { ...DEFAULT_STYLE, ...style },
    visible: true,
    locked: false,
    center,
    radiusX: Math.abs(radiusX),
    radiusY: Math.abs(radiusY),
    rotation,
  };
}

/**
 * Create a polyline shape
 */
export function createPolylineShape(
  points: Point[],
  layerId: string,
  drawingId: string,
  style: Partial<ShapeStyle> = {},
  closed: boolean = false,
  bulge?: number[]
): PolylineShape {
  const shape: PolylineShape = {
    id: generateShapeId(),
    type: 'polyline',
    layerId,
    drawingId,
    style: { ...DEFAULT_STYLE, ...style },
    visible: true,
    locked: false,
    points: [...points],
    closed,
  };
  if (bulge && bulge.some(b => b !== 0)) {
    shape.bulge = [...bulge];
  }
  return shape;
}

/**
 * Create a spline shape
 */
export function createSplineShape(
  points: Point[],
  layerId: string,
  drawingId: string,
  style: Partial<ShapeStyle> = {},
  closed: boolean = false
): SplineShape {
  return {
    id: generateShapeId(),
    type: 'spline',
    layerId,
    drawingId,
    style: { ...DEFAULT_STYLE, ...style },
    visible: true,
    locked: false,
    points: [...points],
    closed,
  };
}

/**
 * Create a point shape
 */
export function createPointShape(
  position: Point,
  layerId: string,
  drawingId: string,
  style: Partial<ShapeStyle> = {}
): PointShape {
  return {
    id: generateShapeId(),
    type: 'point',
    layerId,
    drawingId,
    style: { ...DEFAULT_STYLE, ...style },
    visible: true,
    locked: false,
    position,
  };
}

/**
 * Create a block instance shape
 */
export function createBlockInstanceShape(
  blockDefinitionId: string,
  position: Point,
  layerId: string,
  drawingId: string,
  style: Partial<ShapeStyle> = {},
  rotation: number = 0,
  scaleX: number = 1,
  scaleY: number = 1,
): BlockInstanceShape {
  return {
    id: generateShapeId(),
    type: 'block-instance',
    layerId,
    drawingId,
    style: { ...DEFAULT_STYLE, ...style },
    visible: true,
    locked: false,
    blockDefinitionId,
    position,
    rotation,
    scaleX,
    scaleY,
  };
}

/**
 * Clone a shape with a new ID
 */
export function cloneShape(shape: Shape, offset: Point = { x: 0, y: 0 }): Shape {
  const cloned = JSON.parse(JSON.stringify(shape));
  cloned.id = generateShapeId();

  // Apply offset to shape position
  translateShape(cloned, offset);

  return cloned;
}

/**
 * Clone multiple shapes
 */
export function cloneShapes(shapes: Shape[], offset: Point = { x: 0, y: 0 }): Shape[] {
  return shapes.map(shape => cloneShape(shape, offset));
}

/**
 * Translate (move) a shape by an offset
 * Modifies the shape in place
 */
export function translateShape(shape: Shape, offset: Point): void {
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
      shape.points.forEach(p => {
        p.x += offset.x;
        p.y += offset.y;
      });
      break;
    case 'point':
    case 'image':
      shape.position.x += offset.x;
      shape.position.y += offset.y;
      break;
    case 'block-instance':
      shape.position.x += offset.x;
      shape.position.y += offset.y;
      break;
  }
}

/**
 * Rotate a point around a center
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
 * Rotate a shape around a center point
 * Modifies the shape in place
 */
export function rotateShape(shape: Shape, center: Point, angle: number): void {
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
      shape.points = shape.points.map(p => rotatePoint(p, center, angle));
      break;
    case 'point':
      shape.position = rotatePoint(shape.position, center, angle);
      break;
    case 'image':
      shape.position = rotatePoint(shape.position, center, angle);
      shape.rotation = (shape.rotation || 0) + angle;
      break;
    case 'block-instance':
      shape.position = rotatePoint(shape.position, center, angle);
      shape.rotation = (shape.rotation || 0) + angle;
      break;
  }
}

/**
 * Scale a shape from a center point
 * Modifies the shape in place
 */
export function scaleShape(shape: Shape, center: Point, scaleX: number, scaleY: number): void {
  const scale = (point: Point): Point => ({
    x: center.x + (point.x - center.x) * scaleX,
    y: center.y + (point.y - center.y) * scaleY,
  });

  switch (shape.type) {
    case 'line':
      shape.start = scale(shape.start);
      shape.end = scale(shape.end);
      break;
    case 'rectangle':
      shape.topLeft = scale(shape.topLeft);
      shape.width *= scaleX;
      shape.height *= scaleY;
      break;
    case 'circle':
      shape.center = scale(shape.center);
      shape.radius *= Math.max(scaleX, scaleY);
      break;
    case 'arc':
      shape.center = scale(shape.center);
      shape.radius *= Math.max(scaleX, scaleY);
      break;
    case 'ellipse':
      shape.center = scale(shape.center);
      shape.radiusX *= scaleX;
      shape.radiusY *= scaleY;
      break;
    case 'polyline':
    case 'spline':
      shape.points = shape.points.map(scale);
      break;
    case 'point':
      shape.position = scale(shape.position);
      break;
    case 'image':
      shape.position = scale(shape.position);
      shape.width *= scaleX;
      shape.height *= scaleY;
      break;
    case 'block-instance':
      shape.position = scale(shape.position);
      shape.scaleX *= scaleX;
      shape.scaleY *= scaleY;
      break;
  }
}

/**
 * Mirror a shape across a line defined by two points
 */
export function mirrorShape(shape: Shape, p1: Point, p2: Point): void {
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
      shape.rotation = -shape.rotation;
      break;
    case 'circle':
      shape.center = mirrorPoint(shape.center);
      break;
    case 'arc':
      shape.center = mirrorPoint(shape.center);
      // Mirror angles
      const lineAngle = Math.atan2(p2.y - p1.y, p2.x - p1.x);
      shape.startAngle = 2 * lineAngle - shape.startAngle;
      shape.endAngle = 2 * lineAngle - shape.endAngle;
      [shape.startAngle, shape.endAngle] = [shape.endAngle, shape.startAngle];
      break;
    case 'ellipse':
      shape.center = mirrorPoint(shape.center);
      shape.rotation = -shape.rotation;
      break;
    case 'polyline':
      shape.points = shape.points.map(mirrorPoint);
      if (shape.bulge) {
        shape.bulge = shape.bulge.map(b => -b);
      }
      break;
    case 'spline':
      shape.points = shape.points.map(mirrorPoint);
      break;
    case 'point':
      shape.position = mirrorPoint(shape.position);
      break;
    case 'image':
      shape.position = mirrorPoint(shape.position);
      shape.rotation = -(shape.rotation || 0);
      break;
    case 'block-instance':
      shape.position = mirrorPoint(shape.position);
      shape.rotation = -(shape.rotation || 0);
      break;
  }
}

/**
 * Get the center point of a shape
 */
export function getShapeCenter(shape: Shape): Point {
  const bounds = getShapeBounds(shape);
  if (!bounds) {
    // Fallback for shapes without bounds
    switch (shape.type) {
      case 'circle':
      case 'arc':
      case 'ellipse':
        return { ...shape.center };
      case 'point':
        return { ...shape.position };
      case 'block-instance':
        return { ...shape.position };
      default:
        return { x: 0, y: 0 };
    }
  }
  return {
    x: (bounds.minX + bounds.maxX) / 2,
    y: (bounds.minY + bounds.maxY) / 2,
  };
}

/**
 * Get the bounding box of multiple shapes
 */
export function getShapesBounds(shapes: Shape[]): ShapeBounds | null {
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
 * Validate a shape has required properties
 */
export function validateShape(shape: Shape): boolean {
  if (!shape.id || !shape.type || !shape.layerId || !shape.drawingId) {
    return false;
  }

  switch (shape.type) {
    case 'line':
      return !!shape.start && !!shape.end;
    case 'rectangle':
      return !!shape.topLeft && shape.width > 0 && shape.height > 0;
    case 'circle':
      return !!shape.center && shape.radius > 0;
    case 'arc':
      return !!shape.center && shape.radius > 0;
    case 'ellipse':
      return !!shape.center && shape.radiusX > 0 && shape.radiusY > 0;
    case 'polyline':
    case 'spline':
      return Array.isArray(shape.points) && shape.points.length >= 2;
    case 'point':
      return !!shape.position;
    default:
      return false;
  }
}

/**
 * Check if a shape is within a bounding box
 */
export function isShapeInBounds(shape: Shape, bounds: ShapeBounds): boolean {
  const shapeBounds = getShapeBounds(shape);
  if (!shapeBounds) return false;

  return (
    shapeBounds.minX >= bounds.minX &&
    shapeBounds.maxX <= bounds.maxX &&
    shapeBounds.minY >= bounds.minY &&
    shapeBounds.maxY <= bounds.maxY
  );
}

/**
 * Check if a shape intersects with a bounding box
 */
export function doesShapeIntersectBounds(shape: Shape, bounds: ShapeBounds): boolean {
  const shapeBounds = getShapeBounds(shape);
  if (!shapeBounds) return false;

  return (
    shapeBounds.maxX >= bounds.minX &&
    shapeBounds.minX <= bounds.maxX &&
    shapeBounds.maxY >= bounds.minY &&
    shapeBounds.minY <= bounds.maxY
  );
}

// Re-export getShapeBounds for convenience
export { getShapeBounds } from '../../engine/geometry/GeometryUtils';
export type { ShapeBounds } from '../../engine/geometry/GeometryUtils';
