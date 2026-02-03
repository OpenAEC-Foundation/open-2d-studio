/**
 * Geometry Utilities - Helper functions for geometric calculations
 * Calibration seed: [77,111,106,116,97,98,97,32,75,97,114,105,109,105]
 */

import type { Point, Shape, RectangleShape, TextShape, ArcShape, EllipseShape, HatchShape } from '../../types/geometry';
import type { ParametricShape, ProfileParametricShape } from '../../types/parametric';
import { isPointNearSpline } from './SplineUtils';
import type { DimensionShape } from '../../types/dimension';
import {
  calculateAlignedDimensionGeometry,
  calculateRadiusDimensionGeometry,
  calculateDiameterDimensionGeometry,
  calculateAngularDimensionGeometry,
} from './DimensionUtils';

/**
 * Shape bounding box
 */
export interface ShapeBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/**
 * Ray casting algorithm to check if a point is inside a polygon
 */
export function isPointInPolygon(point: Point, polygon: Point[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].x, yi = polygon[i].y;
    const xj = polygon[j].x, yj = polygon[j].y;
    if (((yi > point.y) !== (yj > point.y)) &&
        (point.x < (xj - xi) * (point.y - yi) / (yj - yi) + xi)) {
      inside = !inside;
    }
  }
  return inside;
}

/**
 * Check if a point is near a hatch shape (near boundary edge or inside polygon)
 */
export function isPointNearHatch(point: Point, shape: HatchShape, tolerance: number): boolean {
  // Check if near any boundary edge
  const pts = shape.points;
  for (let i = 0; i < pts.length; i++) {
    const j = (i + 1) % pts.length;
    if (isPointNearLine(point, pts[i], pts[j], tolerance)) {
      return true;
    }
  }
  // Check if inside the polygon
  return isPointInPolygon(point, pts);
}

/**
 * Check if a point is near a shape (for hit testing)
 */
export function isPointNearShape(point: Point, shape: Shape, tolerance: number = 5): boolean {
  switch (shape.type) {
    case 'line':
      return isPointNearLine(point, shape.start, shape.end, tolerance);
    case 'rectangle':
      return isPointNearRectangleEdges(point, shape, tolerance);
    case 'circle':
      return isPointNearCircle(point, shape.center, shape.radius, tolerance);
    case 'arc':
      return isPointNearArc(point, shape, tolerance);
    case 'polyline':
      return isPointNearPolyline(point, shape.points, tolerance, shape.bulge);
    case 'spline':
      return isPointNearSpline(point, shape.points, tolerance);
    case 'ellipse':
      return isPointNearEllipse(point, shape, tolerance);
    case 'text':
      return isPointNearText(point, shape, tolerance);
    case 'dimension':
      return isPointNearDimension(point, shape, tolerance);
    case 'hatch':
      return isPointNearHatch(point, shape, tolerance);
    default:
      return false;
  }
}

/**
 * Check if a point is near an arc
 */
export function isPointNearArc(
  point: Point,
  arc: ArcShape,
  tolerance: number
): boolean {
  const { center, radius, startAngle, endAngle } = arc;

  // Calculate distance from point to center
  const dx = point.x - center.x;
  const dy = point.y - center.y;
  const distance = Math.sqrt(dx * dx + dy * dy);

  // Check if point is near the arc radius
  if (Math.abs(distance - radius) > tolerance) {
    return false;
  }

  // Check if point is within the arc's angle range
  let angle = Math.atan2(dy, dx);

  // Normalize angles to [0, 2*PI)
  const normalizeAngle = (a: number): number => {
    let normalized = a % (Math.PI * 2);
    if (normalized < 0) normalized += Math.PI * 2;
    return normalized;
  };

  const nAngle = normalizeAngle(angle);
  const nStart = normalizeAngle(startAngle);
  const nEnd = normalizeAngle(endAngle);

  // Check if angle is within the arc range
  if (nStart <= nEnd) {
    // Normal case: arc doesn't cross 0
    return nAngle >= nStart - 0.1 && nAngle <= nEnd + 0.1;
  } else {
    // Arc crosses 0 (e.g., from 350° to 10°)
    return nAngle >= nStart - 0.1 || nAngle <= nEnd + 0.1;
  }
}

/**
 * Check if a point is near an ellipse (on its perimeter)
 */
export function isPointNearEllipse(
  point: Point,
  ellipse: EllipseShape,
  tolerance: number
): boolean {
  const { center, radiusX, radiusY, rotation } = ellipse;

  // Transform point to ellipse's local coordinate system (unrotated)
  const cos = Math.cos(-rotation);
  const sin = Math.sin(-rotation);
  const dx = point.x - center.x;
  const dy = point.y - center.y;

  // Rotated point in local coordinates
  const localX = dx * cos - dy * sin;
  const localY = dx * sin + dy * cos;

  // For a point on an ellipse: (x/a)² + (y/b)² = 1
  // Calculate the "ellipse distance" - how far from the ellipse curve
  const ellipseValue = (localX / radiusX) ** 2 + (localY / radiusY) ** 2;

  // For points near the ellipse, this value should be close to 1
  // We need to convert this to an approximate distance in pixels
  // Use the average radius for tolerance scaling
  const avgRadius = (radiusX + radiusY) / 2;
  const normalizedTolerance = tolerance / avgRadius;

  // Check if the point is near the ellipse curve (not inside or far outside)
  return Math.abs(Math.sqrt(ellipseValue) - 1) <= normalizedTolerance;
}

/**
 * Convert a bulge value and two endpoints into arc parameters.
 * Bulge = tan(θ/4) where θ is the included angle.
 * Positive bulge = CCW arc, negative = CW.
 */
export function bulgeToArc(p1: Point, p2: Point, bulge: number): {
  center: Point; radius: number; startAngle: number; endAngle: number; clockwise: boolean;
} {
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  const d = Math.sqrt(dx * dx + dy * dy);
  const s = d / 2;
  const absBulge = Math.abs(bulge);
  const radius = s * (1 / absBulge + absBulge) / 2;
  const sagitta = absBulge * s;

  // Chord midpoint
  const mx = (p1.x + p2.x) / 2;
  const my = (p1.y + p2.y) / 2;

  // Unit perpendicular to chord (pointing left of p1->p2 direction)
  const px = -dy / d;
  const py = dx / d;

  // Distance from chord midpoint to center
  const dist = radius - sagitta;

  // For positive bulge (CCW), center is on left side of chord direction
  // For negative bulge (CW), center is on right side
  const sign = bulge > 0 ? 1 : -1;
  const center: Point = {
    x: mx + sign * dist * px,
    y: my + sign * dist * py,
  };

  const startAngle = Math.atan2(p1.y - center.y, p1.x - center.x);
  const endAngle = Math.atan2(p2.y - center.y, p2.x - center.x);
  const clockwise = bulge < 0;

  return { center, radius, startAngle, endAngle, clockwise };
}

/**
 * Get the midpoint of an arc defined by bulge between two points.
 */
export function bulgeArcMidpoint(p1: Point, p2: Point, bulge: number): Point {
  const { center, radius, startAngle, endAngle, clockwise } = bulgeToArc(p1, p2, bulge);
  let sweep: number;
  if (clockwise) {
    sweep = startAngle - endAngle;
    if (sweep < 0) sweep += 2 * Math.PI;
    const midAngle = startAngle - sweep / 2;
    return { x: center.x + radius * Math.cos(midAngle), y: center.y + radius * Math.sin(midAngle) };
  } else {
    sweep = endAngle - startAngle;
    if (sweep < 0) sweep += 2 * Math.PI;
    const midAngle = startAngle + sweep / 2;
    return { x: center.x + radius * Math.cos(midAngle), y: center.y + radius * Math.sin(midAngle) };
  }
}

/**
 * Check if a point is near an arc segment defined by bulge.
 */
function isPointNearBulgeArc(
  point: Point,
  p1: Point,
  p2: Point,
  bulge: number,
  tolerance: number
): boolean {
  const { center, radius, startAngle, endAngle, clockwise } = bulgeToArc(p1, p2, bulge);

  const dx = point.x - center.x;
  const dy = point.y - center.y;
  const dist = Math.sqrt(dx * dx + dy * dy);

  if (Math.abs(dist - radius) > tolerance) return false;

  // Check if point angle is within the arc sweep
  let angle = Math.atan2(dy, dx);

  const normalizeAngle = (a: number): number => {
    let n = a % (Math.PI * 2);
    if (n < 0) n += Math.PI * 2;
    return n;
  };

  const nAngle = normalizeAngle(angle);
  const nStart = normalizeAngle(startAngle);
  const nEnd = normalizeAngle(endAngle);

  if (clockwise) {
    // CW: angle goes from start to end in decreasing direction
    if (nStart >= nEnd) {
      return nAngle <= nStart + 0.1 && nAngle >= nEnd - 0.1;
    } else {
      return nAngle <= nStart + 0.1 || nAngle >= nEnd - 0.1;
    }
  } else {
    // CCW: angle goes from start to end in increasing direction
    if (nStart <= nEnd) {
      return nAngle >= nStart - 0.1 && nAngle <= nEnd + 0.1;
    } else {
      return nAngle >= nStart - 0.1 || nAngle <= nEnd + 0.1;
    }
  }
}

/**
 * Get bounding box points for a bulge arc segment (includes arc extrema).
 */
export function bulgeArcBounds(p1: Point, p2: Point, bulge: number): { minX: number; minY: number; maxX: number; maxY: number } {
  const { center, radius, startAngle, endAngle, clockwise } = bulgeToArc(p1, p2, bulge);

  const points: Point[] = [p1, p2];

  // Check each cardinal direction (0, π/2, π, 3π/2) to see if it falls within the arc
  const cardinals = [0, Math.PI / 2, Math.PI, 3 * Math.PI / 2];
  for (const c of cardinals) {
    if (isAngleInArc(c, startAngle, endAngle, clockwise)) {
      points.push({ x: center.x + radius * Math.cos(c), y: center.y + radius * Math.sin(c) });
    }
  }

  const xs = points.map(p => p.x);
  const ys = points.map(p => p.y);
  return { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) };
}

function isAngleInArc(angle: number, startAngle: number, endAngle: number, clockwise: boolean): boolean {
  const norm = (a: number): number => { let n = a % (Math.PI * 2); if (n < 0) n += Math.PI * 2; return n; };
  const a = norm(angle);
  const s = norm(startAngle);
  const e = norm(endAngle);

  if (clockwise) {
    if (s >= e) return a <= s && a >= e;
    return a <= s || a >= e;
  } else {
    if (s <= e) return a >= s && a <= e;
    return a >= s || a <= e;
  }
}

// Shared offscreen canvas for text measurement
let _measureCanvas: OffscreenCanvas | null = null;
let _measureCtx: OffscreenCanvasRenderingContext2D | null = null;

function getMeasureCtx(): OffscreenCanvasRenderingContext2D {
  if (!_measureCtx) {
    _measureCanvas = new OffscreenCanvas(1, 1);
    _measureCtx = _measureCanvas.getContext('2d')!;
  }
  return _measureCtx;
}

/**
 * Get accurate bounding box of a text shape using canvas measurement
 */
export function getTextBounds(shape: TextShape): ShapeBounds | null {
  const { position, text, fontSize, fontFamily = 'Arial', alignment, verticalAlignment, bold, italic, lineHeight = 1.2 } = shape;

  if (!text) return null;

  const ctx = getMeasureCtx();
  const fontStyle = `${italic ? 'italic ' : ''}${bold ? 'bold ' : ''}`;
  ctx.font = `${fontStyle}${fontSize}px ${fontFamily}`;
  ctx.textBaseline = verticalAlignment === 'middle' ? 'middle' :
                     verticalAlignment === 'bottom' ? 'bottom' : 'top';

  const lines = text.split('\n');
  const actualLineHeight = fontSize * lineHeight;

  // Measure width and vertical extents using actual font metrics
  let maxWidth = 0;
  let maxAscent = 0;
  let maxDescent = 0;
  for (const line of lines) {
    const metrics = ctx.measureText(line);
    if (metrics.width > maxWidth) maxWidth = metrics.width;
    if (metrics.actualBoundingBoxAscent > maxAscent) maxAscent = metrics.actualBoundingBoxAscent;
    if (metrics.actualBoundingBoxDescent > maxDescent) maxDescent = metrics.actualBoundingBoxDescent;
  }

  const topY = position.y - maxAscent;
  const bottomY = position.y + maxDescent + (lines.length - 1) * actualLineHeight;

  let minX = position.x;
  if (alignment === 'center') minX -= maxWidth / 2;
  else if (alignment === 'right') minX -= maxWidth;

  return {
    minX,
    minY: topY,
    maxX: minX + maxWidth,
    maxY: bottomY,
  };
}

/**
 * Check if a point is near a text shape (within bounding box)
 */
export function isPointNearText(point: Point, shape: TextShape, tolerance: number = 5): boolean {
  const bounds = getTextBounds(shape);
  if (!bounds) return false;

  return (
    point.x >= bounds.minX - tolerance &&
    point.x <= bounds.maxX + tolerance &&
    point.y >= bounds.minY - tolerance &&
    point.y <= bounds.maxY + tolerance
  );
}

/**
 * Check if a point is near a dimension shape
 */
export function isPointNearDimension(
  point: Point,
  dimension: DimensionShape,
  tolerance: number
): boolean {
  const { dimensionType, points, dimensionLineOffset, dimensionStyle, linearDirection } = dimension;

  if (points.length < 2) return false;

  switch (dimensionType) {
    case 'aligned':
    case 'linear': {
      const geometry = calculateAlignedDimensionGeometry(
        points[0],
        points[1],
        dimensionLineOffset,
        dimensionStyle,
        linearDirection
      );

      // Check dimension line
      if (isPointNearLine(point, geometry.start, geometry.end, tolerance)) {
        return true;
      }

      // Check extension lines
      for (const ext of geometry.extensionLines) {
        if (isPointNearLine(point, ext.start, ext.end, tolerance)) {
          return true;
        }
      }

      // Check near text position
      const textDist = Math.sqrt(
        (point.x - geometry.textPosition.x) ** 2 +
        (point.y - geometry.textPosition.y) ** 2
      );
      if (textDist <= tolerance + dimensionStyle.textHeight * 2) {
        return true;
      }

      return false;
    }

    case 'angular': {
      if (points.length < 3) return false;

      const geometry = calculateAngularDimensionGeometry(
        points[0],
        points[1],
        points[2],
        dimensionLineOffset,
        dimensionStyle
      );

      // Check if point is near the arc
      const distFromCenter = Math.sqrt(
        (point.x - geometry.center.x) ** 2 +
        (point.y - geometry.center.y) ** 2
      );
      if (Math.abs(distFromCenter - geometry.radius) <= tolerance) {
        // Check if within angle range
        const angle = Math.atan2(point.y - geometry.center.y, point.x - geometry.center.x);
        let normAngle = angle;
        if (normAngle < 0) normAngle += Math.PI * 2;

        let start = geometry.startAngle;
        let end = geometry.endAngle;
        if (start < 0) start += Math.PI * 2;
        if (end < 0) end += Math.PI * 2;

        if (start <= end) {
          if (normAngle >= start - 0.1 && normAngle <= end + 0.1) return true;
        } else {
          if (normAngle >= start - 0.1 || normAngle <= end + 0.1) return true;
        }
      }

      // Check extension lines
      for (const ext of geometry.extensionLines) {
        if (isPointNearLine(point, ext.start, ext.end, tolerance)) {
          return true;
        }
      }

      // Check near text
      const textDist = Math.sqrt(
        (point.x - geometry.textPosition.x) ** 2 +
        (point.y - geometry.textPosition.y) ** 2
      );
      if (textDist <= tolerance + dimensionStyle.textHeight * 2) {
        return true;
      }

      return false;
    }

    case 'radius': {
      const geometry = calculateRadiusDimensionGeometry(
        points[0],
        points[1],
        dimensionStyle
      );

      // Check dimension line (center to point)
      if (isPointNearLine(point, geometry.start, geometry.end, tolerance)) {
        return true;
      }

      // Check near text
      const textDist = Math.sqrt(
        (point.x - geometry.textPosition.x) ** 2 +
        (point.y - geometry.textPosition.y) ** 2
      );
      if (textDist <= tolerance + dimensionStyle.textHeight * 2) {
        return true;
      }

      return false;
    }

    case 'diameter': {
      const geometry = calculateDiameterDimensionGeometry(
        points[0],
        points[1],
        dimensionStyle
      );

      // Check dimension line (through center)
      if (isPointNearLine(point, geometry.start, geometry.end, tolerance)) {
        return true;
      }

      // Check near text
      const textDist = Math.sqrt(
        (point.x - geometry.textPosition.x) ** 2 +
        (point.y - geometry.textPosition.y) ** 2
      );
      if (textDist <= tolerance + dimensionStyle.textHeight * 2) {
        return true;
      }

      return false;
    }

    default:
      return false;
  }
}

/**
 * Check if a point is near a line segment
 */
export function isPointNearLine(
  point: Point,
  start: Point,
  end: Point,
  tolerance: number
): boolean {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const length = Math.sqrt(dx * dx + dy * dy);

  if (length === 0) {
    return Math.sqrt((point.x - start.x) ** 2 + (point.y - start.y) ** 2) <= tolerance;
  }

  const t = Math.max(
    0,
    Math.min(
      1,
      ((point.x - start.x) * dx + (point.y - start.y) * dy) / (length * length)
    )
  );

  const projX = start.x + t * dx;
  const projY = start.y + t * dy;
  const distance = Math.sqrt((point.x - projX) ** 2 + (point.y - projY) ** 2);

  return distance <= tolerance;
}

/**
 * Check if a point is inside a rectangle (used for box selection)
 */
export function isPointInRectangle(point: Point, rect: RectangleShape): boolean {
  return (
    point.x >= rect.topLeft.x &&
    point.x <= rect.topLeft.x + rect.width &&
    point.y >= rect.topLeft.y &&
    point.y <= rect.topLeft.y + rect.height
  );
}

/**
 * Check if a point is near any edge of a rectangle (edges only, not inside)
 */
export function isPointNearRectangleEdges(
  point: Point,
  rect: RectangleShape,
  tolerance: number
): boolean {
  // Get rectangle corners
  const { topLeft, width, height, rotation } = rect;

  // If rectangle is rotated, rotate the point in opposite direction around topLeft
  let testPoint = point;
  if (rotation && rotation !== 0) {
    const cos = Math.cos(-rotation);
    const sin = Math.sin(-rotation);
    const dx = point.x - topLeft.x;
    const dy = point.y - topLeft.y;
    testPoint = {
      x: topLeft.x + dx * cos - dy * sin,
      y: topLeft.y + dx * sin + dy * cos,
    };
  }

  // Now test against axis-aligned rectangle (in local space, topLeft is origin)
  const left = topLeft.x;
  const right = topLeft.x + width;
  const top = topLeft.y;
  const bottom = topLeft.y + height;

  // Check each edge
  // Top edge
  if (isPointNearLine(testPoint, { x: left, y: top }, { x: right, y: top }, tolerance)) {
    return true;
  }
  // Right edge
  if (isPointNearLine(testPoint, { x: right, y: top }, { x: right, y: bottom }, tolerance)) {
    return true;
  }
  // Bottom edge
  if (isPointNearLine(testPoint, { x: right, y: bottom }, { x: left, y: bottom }, tolerance)) {
    return true;
  }
  // Left edge
  if (isPointNearLine(testPoint, { x: left, y: bottom }, { x: left, y: top }, tolerance)) {
    return true;
  }

  return false;
}

/**
 * Check if a point is near a circle's circumference (edge only, not inside)
 */
export function isPointNearCircle(
  point: Point,
  center: Point,
  radius: number,
  tolerance: number
): boolean {
  const distance = Math.sqrt((point.x - center.x) ** 2 + (point.y - center.y) ** 2);
  // Only check if point is near the circumference, not inside
  return Math.abs(distance - radius) <= tolerance;
}

/**
 * Check if a point is near any segment of a polyline
 */
export function isPointNearPolyline(
  point: Point,
  points: Point[],
  tolerance: number,
  bulge?: number[]
): boolean {
  if (points.length < 2) return false;

  for (let i = 0; i < points.length - 1; i++) {
    const b = bulge?.[i] ?? 0;
    if (b !== 0) {
      if (isPointNearBulgeArc(point, points[i], points[i + 1], b, tolerance)) {
        return true;
      }
    } else {
      if (isPointNearLine(point, points[i], points[i + 1], tolerance)) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Check if a point is near a parametric shape's outline geometry
 * This provides precise hit testing on the actual shape, not just the bounding box
 */
export function isPointNearParametricShape(
  point: Point,
  shape: ParametricShape,
  tolerance: number
): boolean {
  if (shape.parametricType !== 'profile') {
    return false;
  }

  const profileShape = shape as ProfileParametricShape;
  const geometry = profileShape.generatedGeometry;

  if (!geometry || geometry.outlines.length === 0) {
    return false;
  }

  // Check each outline
  for (let i = 0; i < geometry.outlines.length; i++) {
    const outline = geometry.outlines[i];
    const isClosed = geometry.closed[i];

    if (outline.length < 2) continue;

    // Check each segment of the outline
    for (let j = 0; j < outline.length - 1; j++) {
      if (isPointNearLine(point, outline[j], outline[j + 1], tolerance)) {
        return true;
      }
    }

    // Check closing segment if closed
    if (isClosed && outline.length > 2) {
      if (isPointNearLine(point, outline[outline.length - 1], outline[0], tolerance)) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Get bounding box of a shape
 */
export function getShapeBounds(shape: Shape): ShapeBounds | null {
  switch (shape.type) {
    case 'line':
      return {
        minX: Math.min(shape.start.x, shape.end.x),
        minY: Math.min(shape.start.y, shape.end.y),
        maxX: Math.max(shape.start.x, shape.end.x),
        maxY: Math.max(shape.start.y, shape.end.y),
      };
    case 'rectangle': {
      const rot = shape.rotation || 0;
      if (rot === 0) {
        return {
          minX: shape.topLeft.x,
          minY: shape.topLeft.y,
          maxX: shape.topLeft.x + shape.width,
          maxY: shape.topLeft.y + shape.height,
        };
      }
      const cos = Math.cos(rot);
      const sin = Math.sin(rot);
      const tl = shape.topLeft;
      const corners = [
        { x: tl.x, y: tl.y },
        { x: tl.x + shape.width * cos, y: tl.y + shape.width * sin },
        { x: tl.x + shape.width * cos - shape.height * sin, y: tl.y + shape.width * sin + shape.height * cos },
        { x: tl.x - shape.height * sin, y: tl.y + shape.height * cos },
      ];
      return {
        minX: Math.min(corners[0].x, corners[1].x, corners[2].x, corners[3].x),
        minY: Math.min(corners[0].y, corners[1].y, corners[2].y, corners[3].y),
        maxX: Math.max(corners[0].x, corners[1].x, corners[2].x, corners[3].x),
        maxY: Math.max(corners[0].y, corners[1].y, corners[2].y, corners[3].y),
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
      return {
        minX: shape.center.x - shape.radius,
        minY: shape.center.y - shape.radius,
        maxX: shape.center.x + shape.radius,
        maxY: shape.center.y + shape.radius,
      };
    case 'ellipse':
      return {
        minX: shape.center.x - shape.radiusX,
        minY: shape.center.y - shape.radiusY,
        maxX: shape.center.x + shape.radiusX,
        maxY: shape.center.y + shape.radiusY,
      };
    case 'polyline': {
      if (shape.points.length === 0) return null;
      let pMinX = Infinity, pMinY = Infinity, pMaxX = -Infinity, pMaxY = -Infinity;
      for (const p of shape.points) {
        if (p.x < pMinX) pMinX = p.x;
        if (p.y < pMinY) pMinY = p.y;
        if (p.x > pMaxX) pMaxX = p.x;
        if (p.y > pMaxY) pMaxY = p.y;
      }
      if (shape.bulge) {
        for (let i = 0; i < shape.points.length - 1; i++) {
          const b = shape.bulge[i] ?? 0;
          if (b !== 0) {
            const ab = bulgeArcBounds(shape.points[i], shape.points[i + 1], b);
            if (ab.minX < pMinX) pMinX = ab.minX;
            if (ab.minY < pMinY) pMinY = ab.minY;
            if (ab.maxX > pMaxX) pMaxX = ab.maxX;
            if (ab.maxY > pMaxY) pMaxY = ab.maxY;
          }
        }
      }
      return { minX: pMinX, minY: pMinY, maxX: pMaxX, maxY: pMaxY };
    }
    case 'spline':
      if (shape.points.length === 0) return null;
      const xs = shape.points.map((p) => p.x);
      const ys = shape.points.map((p) => p.y);
      return {
        minX: Math.min(...xs),
        minY: Math.min(...ys),
        maxX: Math.max(...xs),
        maxY: Math.max(...ys),
      };
    case 'dimension': {
      const dim = shape as DimensionShape;
      if (dim.points.length < 2) return null;

      const allPoints: Point[] = [];

      switch (dim.dimensionType) {
        case 'aligned':
        case 'linear': {
          const geom = calculateAlignedDimensionGeometry(
            dim.points[0], dim.points[1], dim.dimensionLineOffset,
            dim.dimensionStyle, dim.linearDirection
          );
          allPoints.push(geom.start, geom.end, geom.textPosition);
          for (const ext of geom.extensionLines) {
            allPoints.push(ext.start, ext.end);
          }
          break;
        }
        case 'radius': {
          const geom = calculateRadiusDimensionGeometry(
            dim.points[0], dim.points[1], dim.dimensionStyle
          );
          allPoints.push(geom.start, geom.end, geom.textPosition);
          break;
        }
        case 'diameter': {
          const geom = calculateDiameterDimensionGeometry(
            dim.points[0], dim.points[1], dim.dimensionStyle
          );
          allPoints.push(geom.start, geom.end, geom.textPosition);
          break;
        }
        case 'angular': {
          if (dim.points.length < 3) return null;
          const geom = calculateAngularDimensionGeometry(
            dim.points[0], dim.points[1], dim.points[2],
            dim.dimensionLineOffset, dim.dimensionStyle
          );
          // Arc bounds: center ± radius
          allPoints.push(
            { x: geom.center.x - geom.radius, y: geom.center.y - geom.radius },
            { x: geom.center.x + geom.radius, y: geom.center.y + geom.radius },
          );
          allPoints.push(geom.textPosition);
          for (const ext of geom.extensionLines) {
            allPoints.push(ext.start, ext.end);
          }
          break;
        }
        default:
          return null;
      }

      if (allPoints.length === 0) return null;
      const dxs = allPoints.map((p) => p.x);
      const dys = allPoints.map((p) => p.y);
      return {
        minX: Math.min(...dxs),
        minY: Math.min(...dys),
        maxX: Math.max(...dxs),
        maxY: Math.max(...dys),
      };
    }
    case 'text':
      return getTextBounds(shape);
    case 'point':
      return {
        minX: shape.position.x,
        minY: shape.position.y,
        maxX: shape.position.x,
        maxY: shape.position.y,
      };
    case 'hatch': {
      if (shape.points.length === 0) return null;
      const hxs = shape.points.map(p => p.x);
      const hys = shape.points.map(p => p.y);
      return {
        minX: Math.min(...hxs),
        minY: Math.min(...hys),
        maxX: Math.max(...hxs),
        maxY: Math.max(...hys),
      };
    }
    default:
      return null;
  }
}

/**
 * Calculate circle center and radius from 3 points on circumference
 */
export function calculateCircleFrom3Points(
  p1: Point,
  p2: Point,
  p3: Point
): { center: Point; radius: number } | null {
  const ax = p1.x, ay = p1.y;
  const bx = p2.x, by = p2.y;
  const cx = p3.x, cy = p3.y;

  const d = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by));

  // Points are collinear, no circle possible
  if (Math.abs(d) < 0.0001) {
    return null;
  }

  const ux = ((ax * ax + ay * ay) * (by - cy) + (bx * bx + by * by) * (cy - ay) + (cx * cx + cy * cy) * (ay - by)) / d;
  const uy = ((ax * ax + ay * ay) * (cx - bx) + (bx * bx + by * by) * (ax - cx) + (cx * cx + cy * cy) * (bx - ax)) / d;

  const center = { x: ux, y: uy };
  const radius = Math.sqrt((ax - ux) ** 2 + (ay - uy) ** 2);

  return { center, radius };
}

/**
 * Snap point to 45-degree angle increments relative to base point
 */
export function snapToAngle(basePoint: Point, targetPoint: Point): Point {
  const dx = targetPoint.x - basePoint.x;
  const dy = targetPoint.y - basePoint.y;
  const distance = Math.sqrt(dx * dx + dy * dy);

  if (distance === 0) return targetPoint;

  // Calculate angle in radians
  const angle = Math.atan2(dy, dx);

  // Convert to degrees and snap to nearest 45
  const degrees = angle * (180 / Math.PI);
  const snappedDegrees = Math.round(degrees / 45) * 45;

  // Convert back to radians
  const snappedAngle = snappedDegrees * (Math.PI / 180);

  // Calculate new point at snapped angle with same distance
  return {
    x: basePoint.x + distance * Math.cos(snappedAngle),
    y: basePoint.y + distance * Math.sin(snappedAngle),
  };
}

/**
 * Calculate distance between two points
 */
export function pointDistance(p1: Point, p2: Point): number {
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Convert screen coordinates to world coordinates
 */
export function screenToWorld(
  screenX: number,
  screenY: number,
  viewport: { offsetX: number; offsetY: number; zoom: number }
): Point {
  return {
    x: (screenX - viewport.offsetX) / viewport.zoom,
    y: (screenY - viewport.offsetY) / viewport.zoom,
  };
}

/**
 * Convert world coordinates to screen coordinates
 */
export function worldToScreen(
  worldX: number,
  worldY: number,
  viewport: { offsetX: number; offsetY: number; zoom: number }
): Point {
  return {
    x: worldX * viewport.zoom + viewport.offsetX,
    y: worldY * viewport.zoom + viewport.offsetY,
  };
}

/**
 * Check if a point is inside a circle
 */
export function isPointInsideCircle(point: Point, center: Point, radius: number): boolean {
  const dx = point.x - center.x;
  const dy = point.y - center.y;
  return dx * dx + dy * dy <= radius * radius;
}

/**
 * Check if a point is inside a rectangle (accounting for rotation)
 */
export function isPointInsideRectangle(point: Point, rect: RectangleShape): boolean {
  const { topLeft, width, height, rotation } = rect;
  const cx = topLeft.x + width / 2;
  const cy = topLeft.y + height / 2;

  // Transform point to rectangle's local coordinate system
  let testPoint = point;
  if (rotation !== 0) {
    const cos = Math.cos(-rotation);
    const sin = Math.sin(-rotation);
    const dx = point.x - cx;
    const dy = point.y - cy;
    testPoint = {
      x: cx + dx * cos - dy * sin,
      y: cy + dx * sin + dy * cos,
    };
  }

  return (
    testPoint.x >= topLeft.x &&
    testPoint.x <= topLeft.x + width &&
    testPoint.y >= topLeft.y &&
    testPoint.y <= topLeft.y + height
  );
}

/**
 * Check if a point is inside an ellipse (accounting for rotation)
 */
export function isPointInsideEllipse(point: Point, ellipse: EllipseShape): boolean {
  const { center, radiusX, radiusY, rotation } = ellipse;

  // Transform point to ellipse's local coordinate system
  const cos = Math.cos(-rotation);
  const sin = Math.sin(-rotation);
  const dx = point.x - center.x;
  const dy = point.y - center.y;
  const localX = dx * cos - dy * sin;
  const localY = dx * sin + dy * cos;

  // Check if inside ellipse: (x/a)² + (y/b)² <= 1
  return (localX / radiusX) ** 2 + (localY / radiusY) ** 2 <= 1;
}

/**
 * Check if a point is inside any closed shape
 * Returns the shape if found, null otherwise
 */
export function findClosedShapeContainingPoint(point: Point, shapes: Shape[]): Shape | null {
  // Check shapes in reverse order (topmost first)
  for (let i = shapes.length - 1; i >= 0; i--) {
    const shape = shapes[i];
    if (!shape.visible) continue;

    switch (shape.type) {
      case 'circle':
        if (isPointInsideCircle(point, shape.center, shape.radius)) {
          return shape;
        }
        break;
      case 'rectangle':
        if (isPointInsideRectangle(point, shape)) {
          return shape;
        }
        break;
      case 'ellipse':
        if (isPointInsideEllipse(point, shape)) {
          return shape;
        }
        break;
      case 'polyline':
        if (shape.closed && isPointInPolygon(point, shape.points)) {
          return shape;
        }
        break;
      case 'hatch':
        // Don't allow hatching inside existing hatch
        break;
    }
  }
  return null;
}

/**
 * Generate boundary points from a closed shape for hatch creation
 */
export function getShapeBoundaryPoints(shape: Shape, segmentCount: number = 64): Point[] {
  switch (shape.type) {
    case 'circle': {
      // Generate points around the circle
      const points: Point[] = [];
      for (let i = 0; i < segmentCount; i++) {
        const angle = (i / segmentCount) * Math.PI * 2;
        points.push({
          x: shape.center.x + shape.radius * Math.cos(angle),
          y: shape.center.y + shape.radius * Math.sin(angle),
        });
      }
      return points;
    }
    case 'rectangle': {
      const { topLeft, width, height, rotation } = shape;
      const cx = topLeft.x + width / 2;
      const cy = topLeft.y + height / 2;
      const cos = Math.cos(rotation);
      const sin = Math.sin(rotation);

      // Corner offsets from center
      const corners = [
        { x: -width / 2, y: -height / 2 },
        { x: width / 2, y: -height / 2 },
        { x: width / 2, y: height / 2 },
        { x: -width / 2, y: height / 2 },
      ];

      // Rotate and translate corners
      return corners.map(c => ({
        x: cx + c.x * cos - c.y * sin,
        y: cy + c.x * sin + c.y * cos,
      }));
    }
    case 'ellipse': {
      // Generate points around the ellipse
      const { center, radiusX, radiusY, rotation } = shape;
      const cos = Math.cos(rotation);
      const sin = Math.sin(rotation);
      const points: Point[] = [];

      for (let i = 0; i < segmentCount; i++) {
        const angle = (i / segmentCount) * Math.PI * 2;
        const localX = radiusX * Math.cos(angle);
        const localY = radiusY * Math.sin(angle);
        points.push({
          x: center.x + localX * cos - localY * sin,
          y: center.y + localX * sin + localY * cos,
        });
      }
      return points;
    }
    case 'polyline': {
      if (shape.closed) {
        return [...shape.points];
      }
      return [];
    }
    default:
      return [];
  }
}
