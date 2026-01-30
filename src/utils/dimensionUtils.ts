/**
 * Dimension Utilities - Geometry calculations for dimensions
 */

import type { Point, Shape, SnapType } from '../types/geometry';
import type { DimensionType, DimensionShape, DimensionStyle } from '../types/dimension';

// ============================================================================
// Basic Geometry Helpers
// ============================================================================

/**
 * Calculate distance between two points
 */
export function distance(p1: Point, p2: Point): number {
  return Math.sqrt((p2.x - p1.x) ** 2 + (p2.y - p1.y) ** 2);
}

/**
 * Calculate angle between two points (in radians, 0 = right, counter-clockwise positive)
 */
export function angleBetweenPoints(p1: Point, p2: Point): number {
  return Math.atan2(p2.y - p1.y, p2.x - p1.x);
}

/**
 * Normalize angle to [0, 2*PI) range
 */
export function normalizeAngle(angle: number): number {
  let a = angle % (Math.PI * 2);
  if (a < 0) a += Math.PI * 2;
  return a;
}

/**
 * Get point at distance and angle from origin
 */
export function pointAtAngle(origin: Point, angle: number, dist: number): Point {
  return {
    x: origin.x + dist * Math.cos(angle),
    y: origin.y + dist * Math.sin(angle),
  };
}

/**
 * Get perpendicular offset point
 */
export function perpendicularOffset(p1: Point, p2: Point, offset: number): { p1: Point; p2: Point } {
  const angle = angleBetweenPoints(p1, p2);
  const perpAngle = angle + Math.PI / 2;

  return {
    p1: pointAtAngle(p1, perpAngle, offset),
    p2: pointAtAngle(p2, perpAngle, offset),
  };
}

// ============================================================================
// Dimension Value Calculations
// ============================================================================

/**
 * Calculate the dimension value based on dimension type and points
 */
export function calculateDimensionValue(
  points: Point[],
  dimensionType: DimensionType,
  linearDirection?: 'horizontal' | 'vertical'
): number {
  switch (dimensionType) {
    case 'aligned':
      if (points.length < 2) return 0;
      return distance(points[0], points[1]);

    case 'linear':
      if (points.length < 2) return 0;
      if (linearDirection === 'horizontal') {
        return Math.abs(points[1].x - points[0].x);
      } else if (linearDirection === 'vertical') {
        return Math.abs(points[1].y - points[0].y);
      }
      return distance(points[0], points[1]);

    case 'angular':
      if (points.length < 3) return 0;
      // vertex is points[0], points[1] and points[2] are on the two lines
      const angle1 = angleBetweenPoints(points[0], points[1]);
      const angle2 = angleBetweenPoints(points[0], points[2]);
      let angleDiff = Math.abs(angle2 - angle1);
      if (angleDiff > Math.PI) angleDiff = 2 * Math.PI - angleDiff;
      return angleDiff * (180 / Math.PI); // Return degrees

    case 'radius':
      if (points.length < 2) return 0;
      return distance(points[0], points[1]);

    case 'diameter':
      if (points.length < 2) return 0;
      return distance(points[0], points[1]) * 2;

    default:
      return 0;
  }
}

/**
 * Format dimension value for display
 */
export function formatDimensionValue(
  value: number,
  dimensionType: DimensionType,
  precision: number = 2
): string {
  if (dimensionType === 'angular') {
    return value.toFixed(precision) + '\u00B0'; // degree symbol
  }
  return value.toFixed(precision);
}

// ============================================================================
// Dimension Line Geometry
// ============================================================================

/**
 * Extension line geometry for a dimension
 */
export interface ExtensionLineGeometry {
  /** Start point (near the geometry) */
  start: Point;
  /** End point (at the dimension line) */
  end: Point;
}

/**
 * Dimension line geometry
 */
export interface DimensionLineGeometry {
  /** Start point of dimension line */
  start: Point;
  /** End point of dimension line */
  end: Point;
  /** Position of dimension text */
  textPosition: Point;
  /** Angle for text rotation (radians) */
  textAngle: number;
  /** Extension lines */
  extensionLines: ExtensionLineGeometry[];
}

/**
 * Calculate dimension line geometry for aligned/linear dimensions
 */
export function calculateAlignedDimensionGeometry(
  p1: Point,
  p2: Point,
  offset: number,
  style: DimensionStyle,
  linearDirection?: 'horizontal' | 'vertical'
): DimensionLineGeometry {
  let dimStart: Point;
  let dimEnd: Point;
  let angle: number;

  if (linearDirection === 'horizontal') {
    // Horizontal dimension - dimension line is horizontal
    const sign = offset >= 0 ? 1 : -1;
    const absOffset = Math.abs(offset);
    dimStart = { x: p1.x, y: p1.y + sign * absOffset };
    dimEnd = { x: p2.x, y: p1.y + sign * absOffset };
    angle = 0;
  } else if (linearDirection === 'vertical') {
    // Vertical dimension - dimension line is vertical
    const sign = offset >= 0 ? 1 : -1;
    const absOffset = Math.abs(offset);
    dimStart = { x: p1.x + sign * absOffset, y: p1.y };
    dimEnd = { x: p1.x + sign * absOffset, y: p2.y };
    angle = Math.PI / 2;
  } else {
    // Aligned dimension - dimension line is parallel to the measured points
    const lineAngle = angleBetweenPoints(p1, p2);
    const perpAngle = lineAngle + Math.PI / 2;

    dimStart = pointAtAngle(p1, perpAngle, offset);
    dimEnd = pointAtAngle(p2, perpAngle, offset);
    angle = lineAngle;
  }

  // Calculate extension lines
  const gap = style.extensionLineGap;
  const overshoot = style.extensionLineOvershoot;

  // Extension line 1: from p1 towards dimStart
  const ext1Angle = angleBetweenPoints(p1, dimStart);
  const ext1Start = pointAtAngle(p1, ext1Angle, gap);
  const ext1End = pointAtAngle(dimStart, ext1Angle, overshoot);

  // Extension line 2: from p2 towards dimEnd
  const ext2Angle = angleBetweenPoints(p2, dimEnd);
  const ext2Start = pointAtAngle(p2, ext2Angle, gap);
  const ext2End = pointAtAngle(dimEnd, ext2Angle, overshoot);

  // Text position at midpoint of dimension line
  const textPosition = {
    x: (dimStart.x + dimEnd.x) / 2,
    y: (dimStart.y + dimEnd.y) / 2,
  };

  // Adjust text angle so it's always readable (not upside down)
  let textAngle = angle;
  if (textAngle > Math.PI / 2) textAngle -= Math.PI;
  if (textAngle < -Math.PI / 2) textAngle += Math.PI;

  return {
    start: dimStart,
    end: dimEnd,
    textPosition,
    textAngle,
    extensionLines: [
      { start: ext1Start, end: ext1End },
      { start: ext2Start, end: ext2End },
    ],
  };
}

/**
 * Calculate dimension line geometry for radius dimensions
 */
export function calculateRadiusDimensionGeometry(
  center: Point,
  pointOnCircle: Point,
  _style: DimensionStyle
): DimensionLineGeometry {
  const angle = angleBetweenPoints(center, pointOnCircle);

  // Dimension line goes from center to point on circle
  const dimStart = center;
  const dimEnd = pointOnCircle;

  // Text at midpoint
  const textPosition = {
    x: (dimStart.x + dimEnd.x) / 2,
    y: (dimStart.y + dimEnd.y) / 2,
  };

  // Adjust text angle
  let textAngle = angle;
  if (textAngle > Math.PI / 2) textAngle -= Math.PI;
  if (textAngle < -Math.PI / 2) textAngle += Math.PI;

  return {
    start: dimStart,
    end: dimEnd,
    textPosition,
    textAngle,
    extensionLines: [], // No extension lines for radius
  };
}

/**
 * Calculate dimension geometry for diameter dimensions
 */
export function calculateDiameterDimensionGeometry(
  center: Point,
  pointOnCircle: Point,
  _style: DimensionStyle
): DimensionLineGeometry {
  const angle = angleBetweenPoints(center, pointOnCircle);
  const radiusValue = distance(center, pointOnCircle);

  // Dimension line goes through center from one side to the other
  const dimStart = pointAtAngle(center, angle + Math.PI, radiusValue);
  const dimEnd = pointOnCircle;

  // Text at center
  const textPosition = center;

  // Adjust text angle
  let textAngle = angle;
  if (textAngle > Math.PI / 2) textAngle -= Math.PI;
  if (textAngle < -Math.PI / 2) textAngle += Math.PI;

  return {
    start: dimStart,
    end: dimEnd,
    textPosition,
    textAngle,
    extensionLines: [], // No extension lines for diameter
  };
}

/**
 * Arc geometry for angular dimensions
 */
export interface AngularDimensionGeometry {
  /** Center of the angle arc */
  center: Point;
  /** Radius of the arc */
  radius: number;
  /** Start angle (radians) */
  startAngle: number;
  /** End angle (radians) */
  endAngle: number;
  /** Position for dimension text */
  textPosition: Point;
  /** Rotation for dimension text (radians) */
  textAngle: number;
  /** Extension lines from vertex to arc endpoints */
  extensionLines: ExtensionLineGeometry[];
}

/**
 * Calculate geometry for angular dimensions
 */
export function calculateAngularDimensionGeometry(
  vertex: Point,
  point1: Point,
  point2: Point,
  offset: number,
  style: DimensionStyle
): AngularDimensionGeometry {
  const angle1 = angleBetweenPoints(vertex, point1);
  const angle2 = angleBetweenPoints(vertex, point2);

  // Arc radius is the offset distance from vertex
  const arcRadius = Math.abs(offset);

  // Determine start and end angles (go counter-clockwise from angle1 to angle2)
  let startAngle = angle1;
  let endAngle = angle2;

  // Ensure we draw the smaller arc
  let arcAngle = normalizeAngle(endAngle - startAngle);
  if (arcAngle > Math.PI) {
    // Swap to get shorter arc
    const temp = startAngle;
    startAngle = endAngle;
    endAngle = temp;
    arcAngle = 2 * Math.PI - arcAngle;
  }

  // Text position at midpoint of arc
  const midAngle = startAngle + arcAngle / 2;
  const textPosition = pointAtAngle(vertex, midAngle, arcRadius);
  const textAngle = midAngle - Math.PI / 2; // Perpendicular to radius

  // Extension lines from vertex towards arc
  const gap = style.extensionLineGap;
  const overshoot = style.extensionLineOvershoot;

  const ext1Start = pointAtAngle(vertex, startAngle, gap);
  const ext1End = pointAtAngle(vertex, startAngle, arcRadius + overshoot);
  const ext2Start = pointAtAngle(vertex, endAngle, gap);
  const ext2End = pointAtAngle(vertex, endAngle, arcRadius + overshoot);

  return {
    center: vertex,
    radius: arcRadius,
    startAngle,
    endAngle,
    textPosition,
    textAngle,
    extensionLines: [
      { start: ext1Start, end: ext1End },
      { start: ext2Start, end: ext2End },
    ],
  };
}

// ============================================================================
// Associativity - Update Dimensions When Geometry Moves
// ============================================================================

/**
 * Get a snap point from a shape based on reference info
 */
export function getSnapPointFromShape(
  shape: Shape,
  snapType: SnapType,
  pointIndex?: number
): Point | null {
  switch (shape.type) {
    case 'line':
      if (snapType === 'endpoint') {
        return pointIndex === 1 ? shape.end : shape.start;
      }
      if (snapType === 'midpoint') {
        return {
          x: (shape.start.x + shape.end.x) / 2,
          y: (shape.start.y + shape.end.y) / 2,
        };
      }
      break;

    case 'circle':
      if (snapType === 'center') {
        return shape.center;
      }
      // Quadrant points
      if (snapType === 'endpoint' && pointIndex !== undefined) {
        const angles = [0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2];
        const angle = angles[pointIndex % 4];
        return pointAtAngle(shape.center, angle, shape.radius);
      }
      break;

    case 'arc':
      if (snapType === 'center') {
        return shape.center;
      }
      if (snapType === 'endpoint') {
        return pointIndex === 1
          ? pointAtAngle(shape.center, shape.endAngle, shape.radius)
          : pointAtAngle(shape.center, shape.startAngle, shape.radius);
      }
      if (snapType === 'midpoint') {
        const midAngle = (shape.startAngle + shape.endAngle) / 2;
        return pointAtAngle(shape.center, midAngle, shape.radius);
      }
      break;

    case 'rectangle':
      if (snapType === 'endpoint' && pointIndex !== undefined) {
        const { topLeft, width, height, rotation } = shape;
        const corners = [
          { x: 0, y: 0 },
          { x: width, y: 0 },
          { x: width, y: height },
          { x: 0, y: height },
        ];
        const corner = corners[pointIndex % 4];
        const cos = Math.cos(rotation);
        const sin = Math.sin(rotation);
        return {
          x: topLeft.x + corner.x * cos - corner.y * sin,
          y: topLeft.y + corner.x * sin + corner.y * cos,
        };
      }
      if (snapType === 'center') {
        const { topLeft, width, height, rotation } = shape;
        const cx = width / 2;
        const cy = height / 2;
        const cos = Math.cos(rotation);
        const sin = Math.sin(rotation);
        return {
          x: topLeft.x + cx * cos - cy * sin,
          y: topLeft.y + cx * sin + cy * cos,
        };
      }
      break;

    case 'polyline':
      if (snapType === 'endpoint' && pointIndex !== undefined && pointIndex < shape.points.length) {
        return shape.points[pointIndex];
      }
      break;

    case 'ellipse':
      if (snapType === 'center') {
        return shape.center;
      }
      break;

    case 'point':
      if (snapType === 'endpoint') {
        return shape.position;
      }
      break;
  }

  return null;
}

/**
 * Update dimension points from its references
 * Returns updated points array or null if update not possible
 */
export function updateDimensionFromReferences(
  dimension: DimensionShape,
  shapes: Shape[]
): Point[] | null {
  if (!dimension.references || dimension.references.length === 0) {
    return null;
  }

  const newPoints: Point[] = [];

  for (const ref of dimension.references) {
    const refShape = shapes.find(s => s.id === ref.shapeId);
    if (!refShape) {
      // Referenced shape was deleted
      return null;
    }

    const point = getSnapPointFromShape(refShape, ref.snapType, ref.pointIndex);
    if (!point) {
      return null;
    }

    newPoints.push(point);
  }

  return newPoints;
}

// ============================================================================
// Arrow Drawing Helpers
// ============================================================================

/**
 * Arrow points for dimension line terminators
 */
export interface ArrowPoints {
  tip: Point;
  left: Point;
  right: Point;
}

/**
 * Calculate arrow points at end of dimension line
 */
export function calculateArrowPoints(
  tip: Point,
  angle: number,
  size: number
): ArrowPoints {
  const arrowAngle = Math.PI / 6; // 30 degrees

  return {
    tip,
    left: pointAtAngle(tip, angle + Math.PI - arrowAngle, size),
    right: pointAtAngle(tip, angle + Math.PI + arrowAngle, size),
  };
}
