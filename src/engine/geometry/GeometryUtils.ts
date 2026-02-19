/**
 * Geometry Utilities - Helper functions for geometric calculations
 * Calibration seed: [77,111,106,116,97,98,97,32,75,97,114,105,109,105]
 */

import type { Point, Shape, RectangleShape, TextShape, ArcShape, EllipseShape, HatchShape, BeamShape, ImageShape, GridlineShape, PileShape, WallShape, SlabShape, LevelShape, SectionCalloutShape, SpaceShape, PlateSystemShape, SpotElevationShape, CPTShape, FoundationZoneShape } from '../../types/geometry';
import type { ParametricShape, ProfileParametricShape } from '../../types/parametric';
import { isPointNearSpline } from './SplineUtils';
import type { DimensionShape } from '../../types/dimension';
import {
  calculateAlignedDimensionGeometry,
  calculateRadiusDimensionGeometry,
  calculateDiameterDimensionGeometry,
  calculateAngularDimensionGeometry,
} from './DimensionUtils';
import { CAD_DEFAULT_FONT } from '../../constants/cadDefaults';

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
 * Reference drawing scale for annotation sizing (1:100 = 0.01).
 * Bubble/text sizes are defined at this reference scale and adjusted
 * at render time so they appear at a constant paper size.
 */
const ANNOTATION_REFERENCE_SCALE = 0.01;

/**
 * Compute the annotation scale factor for gridline/level/section-callout bubbles.
 * Returns 1 when drawingScale is undefined or equals the reference scale.
 */
function annotationScaleFactor(drawingScale?: number): number {
  if (!drawingScale || drawingScale <= 0) return 1;
  return ANNOTATION_REFERENCE_SCALE / drawingScale;
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
 * Check if a point is near a beam shape (plan view representation)
 */
export function isPointNearBeam(point: Point, shape: BeamShape, tolerance: number): boolean {
  const { start, end, flangeWidth } = shape;
  const halfWidth = flangeWidth / 2;

  // --- Arc beam hit testing ---
  if (shape.bulge && Math.abs(shape.bulge) > 0.0001) {
    const arc = bulgeToArc(start, end, shape.bulge);
    const { center, radius, startAngle, endAngle, clockwise } = arc;

    // Inner/outer radii (beam is always centered on its centerline)
    const innerR = radius - halfWidth;
    const outerR = radius + halfWidth;

    const dx = point.x - center.x;
    const dy = point.y - center.y;
    const dist = Math.sqrt(dx * dx + dy * dy);

    // Check if within the arc sweep angle AND between inner/outer radii
    const ptAngle = Math.atan2(dy, dx);
    const inSweep = isAngleInArc(ptAngle, startAngle, endAngle, clockwise);

    if (inSweep && dist >= innerR - tolerance && dist <= outerR + tolerance) {
      return true;
    }

    // Check proximity to the two radial end-cap line segments
    const innerStart: Point = { x: center.x + innerR * Math.cos(startAngle), y: center.y + innerR * Math.sin(startAngle) };
    const outerStart: Point = { x: center.x + outerR * Math.cos(startAngle), y: center.y + outerR * Math.sin(startAngle) };
    const innerEnd: Point = { x: center.x + innerR * Math.cos(endAngle), y: center.y + innerR * Math.sin(endAngle) };
    const outerEnd: Point = { x: center.x + outerR * Math.cos(endAngle), y: center.y + outerR * Math.sin(endAngle) };

    if (isPointNearLine(point, innerStart, outerStart, tolerance)) return true;
    if (isPointNearLine(point, innerEnd, outerEnd, tolerance)) return true;

    return false;
  }

  // --- Straight beam hit testing ---
  // Calculate beam direction and perpendicular
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const length = Math.sqrt(dx * dx + dy * dy);
  if (length === 0) return false;

  // Unit vectors
  const ux = dx / length;
  const uy = dy / length;
  // Perpendicular (90 degrees CCW)
  const px = -uy;
  const py = ux;

  // Calculate the four corners of the beam rectangle
  const corners: Point[] = [
    { x: start.x + px * halfWidth, y: start.y + py * halfWidth },
    { x: end.x + px * halfWidth, y: end.y + py * halfWidth },
    { x: end.x - px * halfWidth, y: end.y - py * halfWidth },
    { x: start.x - px * halfWidth, y: start.y - py * halfWidth },
  ];

  // Check if near any edge
  for (let i = 0; i < corners.length; i++) {
    const j = (i + 1) % corners.length;
    if (isPointNearLine(point, corners[i], corners[j], tolerance)) {
      return true;
    }
  }

  // Check if inside the beam rectangle
  return isPointInPolygon(point, corners);
}

/**
 * Check if a point is near a gridline shape (line + bubbles)
 */
export function isPointNearGridline(point: Point, shape: GridlineShape, tolerance: number, drawingScale?: number): boolean {
  const { start, end, bubblePosition } = shape;
  const sf = annotationScaleFactor(drawingScale);
  const bubbleRadius = shape.bubbleRadius * sf;

  // Check if near the dash-dot line
  if (isPointNearLine(point, start, end, tolerance)) {
    return true;
  }

  // Check if near any bubble circle
  const angle = Math.atan2(end.y - start.y, end.x - start.x);
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);

  if (bubblePosition === 'start' || bubblePosition === 'both') {
    const cx = start.x - dx * bubbleRadius;
    const cy = start.y - dy * bubbleRadius;
    const dist = Math.sqrt((point.x - cx) ** 2 + (point.y - cy) ** 2);
    if (Math.abs(dist - bubbleRadius) < tolerance || dist < bubbleRadius) {
      return true;
    }
  }

  if (bubblePosition === 'end' || bubblePosition === 'both') {
    const cx = end.x + dx * bubbleRadius;
    const cy = end.y + dy * bubbleRadius;
    const dist = Math.sqrt((point.x - cx) ** 2 + (point.y - cy) ** 2);
    if (Math.abs(dist - bubbleRadius) < tolerance || dist < bubbleRadius) {
      return true;
    }
  }

  return false;
}

/**
 * Check if a point is near a level shape (dashed line + triangle markers)
 */
export function isPointNearLevel(point: Point, shape: LevelShape, tolerance: number, drawingScale?: number): boolean {
  const { start, end, labelPosition } = shape;
  const sf = annotationScaleFactor(drawingScale);
  const bubbleRadius = shape.bubbleRadius * sf;

  // Check if near the dashed line
  if (isPointNearLine(point, start, end, tolerance)) {
    return true;
  }

  // Check if near triangle markers at start/end
  const angle = Math.atan2(end.y - start.y, end.x - start.x);
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);

  if (labelPosition === 'start' || labelPosition === 'both') {
    const cx = start.x - dx * bubbleRadius;
    const cy = start.y - dy * bubbleRadius;
    const dist = Math.sqrt((point.x - cx) ** 2 + (point.y - cy) ** 2);
    if (dist <= bubbleRadius * 1.2) {
      return true;
    }
  }

  if (labelPosition === 'end' || labelPosition === 'both') {
    const cx = end.x + dx * bubbleRadius;
    const cy = end.y + dy * bubbleRadius;
    const dist = Math.sqrt((point.x - cx) ** 2 + (point.y - cy) ** 2);
    if (dist <= bubbleRadius * 1.2) {
      return true;
    }
  }

  return false;
}

/**
 * Check if a point is near a pile shape (circle + cross)
 */
export function isPointNearPile(point: Point, shape: PileShape, tolerance: number): boolean {
  const { position, diameter } = shape;
  const radius = diameter / 2;
  const dist = Math.sqrt((point.x - position.x) ** 2 + (point.y - position.y) ** 2);
  // Near circle edge or inside circle
  return Math.abs(dist - radius) < tolerance || dist < radius;
}

/**
 * Check if a point is near a spot elevation shape (marker or label)
 */
export function isPointNearSpotElevation(point: Point, shape: SpotElevationShape, tolerance: number, drawingScale?: number): boolean {
  const { position, labelPosition, markerSize } = shape;
  const sf = drawingScale ? (0.01 / drawingScale) : 1;
  const ms = (markerSize || 200) * sf;
  // Near marker position
  const distMarker = Math.sqrt((point.x - position.x) ** 2 + (point.y - position.y) ** 2);
  if (distMarker < ms + tolerance) return true;
  // Near label position
  const distLabel = Math.sqrt((point.x - labelPosition.x) ** 2 + (point.y - labelPosition.y) ** 2);
  if (distLabel < ms * 2 + tolerance) return true;
  // Near leader line (if applicable)
  if (shape.showLeader) {
    const dx = labelPosition.x - position.x;
    const dy = labelPosition.y - position.y;
    const lineLen = Math.sqrt(dx * dx + dy * dy);
    if (lineLen > 0.001) {
      const t = Math.max(0, Math.min(1, ((point.x - position.x) * dx + (point.y - position.y) * dy) / (lineLen * lineLen)));
      const closestX = position.x + t * dx;
      const closestY = position.y + t * dy;
      const distLine = Math.sqrt((point.x - closestX) ** 2 + (point.y - closestY) ** 2);
      if (distLine < tolerance) return true;
    }
  }
  return false;
}

/**
 * Check if a point is near a CPT marker shape
 */
export function isPointNearCPT(point: Point, shape: CPTShape, tolerance: number, drawingScale?: number): boolean {
  const { position, markerSize } = shape;
  const sf = drawingScale ? (0.01 / drawingScale) : 1;
  const ms = (markerSize || 300) * sf;
  // Check if point is within the triangle bounding box (generous)
  const dx = Math.abs(point.x - position.x);
  const dy = Math.abs(point.y - position.y);
  return dx < ms * 0.6 + tolerance && dy < ms * 0.7 + tolerance;
}

/**
 * Check if a point is near (inside) a foundation zone polygon
 */
export function isPointNearFoundationZone(point: Point, shape: FoundationZoneShape, tolerance: number): boolean {
  const { contourPoints } = shape;
  if (contourPoints.length < 3) return false;

  // Point-in-polygon test (ray casting)
  let inside = false;
  for (let i = 0, j = contourPoints.length - 1; i < contourPoints.length; j = i++) {
    const xi = contourPoints[i].x, yi = contourPoints[i].y;
    const xj = contourPoints[j].x, yj = contourPoints[j].y;

    const intersect = ((yi > point.y) !== (yj > point.y)) &&
      (point.x < (xj - xi) * (point.y - yi) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  if (inside) return true;

  // Also check if near any edge
  for (let i = 0; i < contourPoints.length; i++) {
    const j = (i + 1) % contourPoints.length;
    if (isPointNearLine(point, contourPoints[i], contourPoints[j], tolerance)) {
      return true;
    }
  }
  return false;
}

/**
 * Check if a point is near a wall shape (rectangular plan view)
 */
export function isPointNearWall(point: Point, shape: WallShape, tolerance: number): boolean {
  const { start, end, thickness, justification } = shape;

  // --- Arc wall hit testing ---
  if (shape.bulge && Math.abs(shape.bulge) > 0.0001) {
    const arc = bulgeToArc(start, end, shape.bulge);
    const { center, radius, startAngle, endAngle, clockwise } = arc;

    // Determine inner/outer radii based on justification
    let innerR: number;
    let outerR: number;
    if (justification === 'left') {
      // Wall extends to visual left (-perp direction from chord)
      innerR = radius;
      outerR = radius + thickness;
    } else if (justification === 'right') {
      // Wall extends to visual right (+perp direction from chord)
      innerR = radius - thickness;
      outerR = radius;
    } else {
      // Center justified
      innerR = radius - thickness / 2;
      outerR = radius + thickness / 2;
    }

    const dx = point.x - center.x;
    const dy = point.y - center.y;
    const dist = Math.sqrt(dx * dx + dy * dy);

    // Check if within the arc sweep angle AND between inner/outer radii
    const ptAngle = Math.atan2(dy, dx);
    const inSweep = isAngleInArc(ptAngle, startAngle, endAngle, clockwise);

    if (inSweep && dist >= innerR - tolerance && dist <= outerR + tolerance) {
      return true;
    }

    // Check proximity to the two radial end-cap line segments
    const innerStart: Point = { x: center.x + innerR * Math.cos(startAngle), y: center.y + innerR * Math.sin(startAngle) };
    const outerStart: Point = { x: center.x + outerR * Math.cos(startAngle), y: center.y + outerR * Math.sin(startAngle) };
    const innerEnd: Point = { x: center.x + innerR * Math.cos(endAngle), y: center.y + innerR * Math.sin(endAngle) };
    const outerEnd: Point = { x: center.x + outerR * Math.cos(endAngle), y: center.y + outerR * Math.sin(endAngle) };

    if (isPointNearLine(point, innerStart, outerStart, tolerance)) return true;
    if (isPointNearLine(point, innerEnd, outerEnd, tolerance)) return true;

    return false;
  }

  // --- Straight wall hit testing ---
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const length = Math.sqrt(dx * dx + dy * dy);
  if (length === 0) return false;

  const ux = dx / length;
  const uy = dy / length;
  const px = -uy;
  const py = ux;

  // Determine how much thickness goes to each side based on justification
  // px, py is the math-CCW perpendicular (visual right in screen Y-down coords).
  // +perp = visual right, -perp = visual left when looking from start to end.
  let leftThick: number;
  let rightThick: number;
  if (justification === 'left') {
    // Wall extends to visual left (-perp direction)
    leftThick = 0;
    rightThick = thickness;
  } else if (justification === 'right') {
    // Wall extends to visual right (+perp direction)
    leftThick = thickness;
    rightThick = 0;
  } else {
    leftThick = thickness / 2;
    rightThick = thickness / 2;
  }

  const corners: Point[] = [
    { x: start.x + px * leftThick, y: start.y + py * leftThick },
    { x: end.x + px * leftThick, y: end.y + py * leftThick },
    { x: end.x - px * rightThick, y: end.y - py * rightThick },
    { x: start.x - px * rightThick, y: start.y - py * rightThick },
  ];

  // Check if near any edge
  for (let i = 0; i < corners.length; i++) {
    const j = (i + 1) % corners.length;
    if (isPointNearLine(point, corners[i], corners[j], tolerance)) {
      return true;
    }
  }

  // Check if inside the wall rectangle
  return isPointInPolygon(point, corners);
}

/**
 * Check if a point is near a slab shape (closed polygon hit test)
 */
export function isPointNearSlab(point: Point, shape: SlabShape, tolerance: number): boolean {
  const { points } = shape;
  if (points.length < 3) return false;

  // Check if near any edge of the polygon
  for (let i = 0; i < points.length; i++) {
    const j = (i + 1) % points.length;
    if (isPointNearLine(point, points[i], points[j], tolerance)) {
      return true;
    }
  }

  // Check if inside the polygon
  return isPointInPolygon(point, points);
}

/**
 * Check if a point is near a space shape (IfcSpace - filled polygon hit test)
 */
export function isPointNearSpace(point: Point, shape: SpaceShape, tolerance: number): boolean {
  const { contourPoints } = shape;
  if (contourPoints.length < 3) return false;

  // Check if near any edge of the contour polygon
  for (let i = 0; i < contourPoints.length; i++) {
    const j = (i + 1) % contourPoints.length;
    if (isPointNearLine(point, contourPoints[i], contourPoints[j], tolerance)) {
      return true;
    }
  }

  // Check if inside the contour polygon
  return isPointInPolygon(point, contourPoints);
}

/**
 * Check if a point is near a plate system shape (contour polygon hit test).
 * Supports arc edges via contourBulges.
 */
export function isPointNearPlateSystem(point: Point, shape: PlateSystemShape, tolerance: number): boolean {
  const { contourPoints, contourBulges } = shape;
  if (contourPoints.length < 3) return false;

  // Check if near any edge of the contour polygon (line or arc)
  for (let i = 0; i < contourPoints.length; i++) {
    const j = (i + 1) % contourPoints.length;
    const b = contourBulges?.[i] ?? 0;
    if (b !== 0 && Math.abs(b) > 0.0001) {
      if (isPointNearBulgeArc(point, contourPoints[i], contourPoints[j], b, tolerance)) {
        return true;
      }
    } else {
      if (isPointNearLine(point, contourPoints[i], contourPoints[j], tolerance)) {
        return true;
      }
    }
  }

  // Check if inside the contour polygon
  return isPointInPolygon(point, contourPoints);
}

/**
 * Check if a point is near a section callout shape (cut line + bubbles + arrows)
 */
export function isPointNearSectionCallout(point: Point, shape: SectionCalloutShape, tolerance: number, drawingScale?: number): boolean {
  const { start, end, flipDirection } = shape;
  const sf = annotationScaleFactor(drawingScale);
  const bubbleRadius = shape.bubbleRadius * sf;

  // Check if near the cut line
  if (isPointNearLine(point, start, end, tolerance)) {
    return true;
  }

  // Check if near bubble circles at endpoints
  const angle = Math.atan2(end.y - start.y, end.x - start.x);
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);

  // Start bubble
  const startBubbleX = start.x - dx * bubbleRadius;
  const startBubbleY = start.y - dy * bubbleRadius;
  const startDist = Math.sqrt((point.x - startBubbleX) ** 2 + (point.y - startBubbleY) ** 2);
  if (Math.abs(startDist - bubbleRadius) < tolerance || startDist < bubbleRadius) {
    return true;
  }

  // End bubble
  const endBubbleX = end.x + dx * bubbleRadius;
  const endBubbleY = end.y + dy * bubbleRadius;
  const endDist = Math.sqrt((point.x - endBubbleX) ** 2 + (point.y - endBubbleY) ** 2);
  if (Math.abs(endDist - bubbleRadius) < tolerance || endDist < bubbleRadius) {
    return true;
  }

  // Check if near the direction arrows (perpendicular lines at endpoints)
  const perpSign = flipDirection ? -1 : 1;
  const perpX = -dy * perpSign;
  const perpY = dx * perpSign;
  const arrowLen = bubbleRadius * 1.5;

  // Arrow at start
  const arrowStartEnd = { x: start.x + perpX * arrowLen, y: start.y + perpY * arrowLen };
  if (isPointNearLine(point, start, arrowStartEnd, tolerance)) {
    return true;
  }

  // Arrow at end
  const arrowEndEnd = { x: end.x + perpX * arrowLen, y: end.y + perpY * arrowLen };
  if (isPointNearLine(point, end, arrowEndEnd, tolerance)) {
    return true;
  }

  return false;
}

/**
 * Check if a point is near an image shape (treat as rectangle hit test)
 */
export function isPointNearImage(point: Point, shape: ImageShape, tolerance: number): boolean {
  const { position, width, height, rotation } = shape;

  if (rotation) {
    // Transform point into image's local coordinate system
    const cos = Math.cos(-rotation);
    const sin = Math.sin(-rotation);
    const dx = point.x - position.x;
    const dy = point.y - position.y;
    const localX = dx * cos - dy * sin;
    const localY = dx * sin + dy * cos;

    // Check if inside the rectangle (with tolerance)
    return localX >= -tolerance && localX <= width + tolerance &&
           localY >= -tolerance && localY <= height + tolerance;
  }

  // No rotation: simple rectangle check
  return point.x >= position.x - tolerance && point.x <= position.x + width + tolerance &&
         point.y >= position.y - tolerance && point.y <= position.y + height + tolerance;
}

/**
 * Check if a point is near a shape (for hit testing)
 * @param drawingScale - Optional drawing scale for text annotation scaling
 */
export function isPointNearShape(point: Point, shape: Shape, tolerance: number = 5, drawingScale?: number, _blockDefinitions?: Map<string, any>): boolean {
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
      return isPointNearText(point, shape, tolerance, drawingScale);
    case 'dimension':
      return isPointNearDimension(point, shape, tolerance, drawingScale);
    case 'hatch':
      return isPointNearHatch(point, shape, tolerance);
    case 'beam':
      return isPointNearBeam(point, shape, tolerance);
    case 'gridline':
      return isPointNearGridline(point, shape as GridlineShape, tolerance, drawingScale);
    case 'level':
      return isPointNearLevel(point, shape as LevelShape, tolerance, drawingScale);
    case 'pile':
      return isPointNearPile(point, shape as PileShape, tolerance);
    case 'cpt':
      return isPointNearCPT(point, shape as CPTShape, tolerance, drawingScale);
    case 'foundation-zone':
      return isPointNearFoundationZone(point, shape as FoundationZoneShape, tolerance);
    case 'wall':
      return isPointNearWall(point, shape as WallShape, tolerance);
    case 'slab':
      return isPointNearSlab(point, shape as SlabShape, tolerance);
    case 'space':
      return isPointNearSpace(point, shape as SpaceShape, tolerance);
    case 'plate-system':
      return isPointNearPlateSystem(point, shape as PlateSystemShape, tolerance);
    case 'section-callout':
      return isPointNearSectionCallout(point, shape as SectionCalloutShape, tolerance, drawingScale);
    case 'spot-elevation':
      return isPointNearSpotElevation(point, shape as SpotElevationShape, tolerance, drawingScale);
    case 'image':
      return isPointNearImage(point, shape, tolerance);
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
 * Calculate the tangent angle at the end of a polyline segment.
 * For a straight line, it's the direction from start to end.
 * For an arc (bulge != 0), it's perpendicular to the radius at the endpoint.
 */
export function getSegmentEndTangent(p1: Point, p2: Point, bulge: number): number {
  if (bulge === 0 || Math.abs(bulge) < 0.0001) {
    // Straight line: tangent is direction from p1 to p2
    return Math.atan2(p2.y - p1.y, p2.x - p1.x);
  }

  // Arc: tangent at p2 is perpendicular to radius at p2
  const { center, clockwise } = bulgeToArc(p1, p2, bulge);
  const radiusAngle = Math.atan2(p2.y - center.y, p2.x - center.x);

  // Tangent is perpendicular to radius
  // For CCW (positive bulge), tangent points 90° counter-clockwise from radius
  // For CW (negative bulge), tangent points 90° clockwise from radius
  return clockwise ? radiusAngle - Math.PI / 2 : radiusAngle + Math.PI / 2;
}

/**
 * Calculate bulge value for an arc that starts tangent to a given direction
 * and ends at the specified endpoint.
 *
 * @param startPoint - Start point of the arc
 * @param endPoint - End point of the arc
 * @param tangentAngle - Tangent direction at start point (in radians)
 * @returns Bulge value for the arc
 */
export function calculateBulgeFromTangent(
  startPoint: Point,
  endPoint: Point,
  tangentAngle: number
): number {
  const dx = endPoint.x - startPoint.x;
  const dy = endPoint.y - startPoint.y;

  // If points are the same or very close, no arc
  if (Math.abs(dx) < 0.0001 && Math.abs(dy) < 0.0001) return 0;

  // Angle from start to end (chord direction)
  const chordAngle = Math.atan2(dy, dx);

  // Angle between tangent and chord
  // This is half the included angle of the arc
  let alpha = chordAngle - tangentAngle;

  // Normalize to [-PI, PI]
  while (alpha > Math.PI) alpha -= 2 * Math.PI;
  while (alpha < -Math.PI) alpha += 2 * Math.PI;

  // Handle edge cases where arc would be too extreme
  // Clamp to about ±170 degrees included angle (alpha = ±85 degrees)
  const maxAlpha = Math.PI * 0.47; // ~85 degrees
  alpha = Math.max(-maxAlpha, Math.min(maxAlpha, alpha));

  // Bulge = tan(alpha/2) because included angle = 2*alpha
  return Math.tan(alpha / 2);
}

/**
 * Calculate bulge value from 3 points (start, point on arc, end).
 * The arc passes through all 3 points.
 *
 * @param start - Start point of the arc
 * @param onArc - A point that lies on the arc
 * @param end - End point of the arc
 * @returns Bulge value for the arc, or 0 if points are collinear
 */
export function calculateBulgeFrom3Points(
  start: Point,
  onArc: Point,
  end: Point
): number {
  // Find the circle passing through all 3 points
  const circle = calculateCircleFrom3Points(start, onArc, end);
  if (!circle) return 0; // Points are collinear

  const { center } = circle;

  // Calculate angles from center to start and end
  const startAngle = Math.atan2(start.y - center.y, start.x - center.x);
  const onArcAngle = Math.atan2(onArc.y - center.y, onArc.x - center.x);
  const endAngle = Math.atan2(end.y - center.y, end.x - center.x);

  // Normalize angles to [0, 2*PI)
  const normalize = (a: number): number => {
    let n = a % (Math.PI * 2);
    if (n < 0) n += Math.PI * 2;
    return n;
  };

  const nStart = normalize(startAngle);
  const nOnArc = normalize(onArcAngle);
  const nEnd = normalize(endAngle);

  // Determine if we go counter-clockwise (CCW) or clockwise (CW) from start to end
  // by checking which direction passes through onArc
  const ccwFromStart = (angle: number): number => {
    const diff = normalize(angle - nStart);
    return diff;
  };

  const onArcCcw = ccwFromStart(nOnArc);
  const endCcw = ccwFromStart(nEnd);

  let includedAngle: number;
  let clockwise: boolean;

  if (onArcCcw < endCcw) {
    // Counter-clockwise from start to end passes through onArc
    includedAngle = endCcw;
    clockwise = false;
  } else {
    // Clockwise from start to end passes through onArc
    includedAngle = 2 * Math.PI - endCcw;
    clockwise = true;
  }

  // Bulge = tan(includedAngle / 4)
  // Positive for CCW, negative for CW
  const bulge = Math.tan(includedAngle / 4);
  return clockwise ? -bulge : bulge;
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

export function isAngleInArc(angle: number, startAngle: number, endAngle: number, clockwise: boolean): boolean {
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
 * @param shape - The text shape
 * @param drawingScale - Optional drawing scale (for annotation text scaling)
 */
export function getTextBounds(shape: TextShape, drawingScale?: number): ShapeBounds | null {
  const { position, text, fontSize, fontFamily = 'Osifont', alignment, verticalAlignment, bold, italic, lineHeight = 1.2, isModelText = false, fixedWidth } = shape;

  if (!text) return null;

  // Calculate effective font size (same logic as ShapeRenderer.drawText)
  // Annotation text: fontSize is in paper mm, divide by drawingScale to get drawing units
  // Model text uses fontSize directly
  const effectiveFontSize = isModelText || !drawingScale
    ? fontSize
    : fontSize / drawingScale;

  const ctx = getMeasureCtx();
  const fontStyle = `${italic ? 'italic ' : ''}${bold ? 'bold ' : ''}`;
  ctx.font = `${fontStyle}${effectiveFontSize}px ${fontFamily}`;
  ctx.textBaseline = verticalAlignment === 'middle' ? 'middle' :
                     verticalAlignment === 'bottom' ? 'bottom' : 'top';

  const actualLineHeight = effectiveFontSize * lineHeight;

  // Calculate wrapped lines if fixedWidth is set
  let lines: string[];
  if (fixedWidth && fixedWidth > 0) {
    lines = [];
    const paragraphs = text.split('\n');
    for (const paragraph of paragraphs) {
      if (paragraph === '') {
        lines.push('');
        continue;
      }

      const words = paragraph.split(' ');
      let currentLine = '';

      for (const word of words) {
        // Check if the word itself is too long and needs character-level breaking
        const wordMetrics = ctx.measureText(word);
        if (wordMetrics.width > fixedWidth) {
          // Push current line if it has content
          if (currentLine) {
            lines.push(currentLine);
            currentLine = '';
          }
          // Break the word character by character
          let charLine = '';
          for (const char of word) {
            const testCharLine = charLine + char;
            const charMetrics = ctx.measureText(testCharLine);
            if (charMetrics.width > fixedWidth && charLine) {
              lines.push(charLine);
              charLine = char;
            } else {
              charLine = testCharLine;
            }
          }
          currentLine = charLine;
        } else {
          const testLine = currentLine ? `${currentLine} ${word}` : word;
          const metrics = ctx.measureText(testLine);
          if (metrics.width > fixedWidth && currentLine) {
            lines.push(currentLine);
            currentLine = word;
          } else {
            currentLine = testLine;
          }
        }
      }

      if (currentLine) lines.push(currentLine);
    }
  } else {
    lines = text.split('\n');
  }

  // Measure width and vertical extents using actual font metrics
  let maxWidth = fixedWidth || 0;
  let maxAscent = 0;
  let maxDescent = 0;
  for (const line of lines) {
    const metrics = ctx.measureText(line);
    if (!fixedWidth && metrics.width > maxWidth) maxWidth = metrics.width;
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
 * @param drawingScale - Optional drawing scale for annotation text scaling
 */
export function isPointNearText(point: Point, shape: TextShape, tolerance: number = 5, drawingScale?: number): boolean {
  const bounds = getTextBounds(shape, drawingScale);
  if (!bounds) return false;

  // Transform point to local coordinates if text is rotated
  let localPoint = point;
  const rotation = shape.rotation || 0;
  if (rotation !== 0) {
    // Inverse rotate the point around the text's position
    const cos = Math.cos(-rotation);
    const sin = Math.sin(-rotation);
    const dx = point.x - shape.position.x;
    const dy = point.y - shape.position.y;
    localPoint = {
      x: shape.position.x + dx * cos - dy * sin,
      y: shape.position.y + dx * sin + dy * cos,
    };
  }

  // Check if point is within the text bounding box
  const inTextBounds = (
    localPoint.x >= bounds.minX - tolerance &&
    localPoint.x <= bounds.maxX + tolerance &&
    localPoint.y >= bounds.minY - tolerance &&
    localPoint.y <= bounds.maxY + tolerance
  );
  if (inTextBounds) return true;

  // Check proximity to leader line segments
  if (shape.leaderPoints && shape.leaderPoints.length > 0) {
    // Leader line goes from text position area to arrow tip
    // The underline spans text width at the bottom; leader connects from underline end to arrow tip
    const underlineY = bounds.maxY;
    const underlineLeft = bounds.minX;
    const underlineRight = bounds.maxX;

    for (const arrowTip of shape.leaderPoints) {
      // Check underline segment
      if (isPointNearLine(point, { x: underlineLeft, y: underlineY }, { x: underlineRight, y: underlineY }, tolerance)) {
        return true;
      }
      // Determine which end of underline connects to the arrow
      const distToLeft = Math.hypot(arrowTip.x - underlineLeft, arrowTip.y - underlineY);
      const distToRight = Math.hypot(arrowTip.x - underlineRight, arrowTip.y - underlineY);
      const connectEnd = distToLeft < distToRight
        ? { x: underlineLeft, y: underlineY }
        : { x: underlineRight, y: underlineY };
      // Check leader line from underline end to arrow tip
      if (isPointNearLine(point, connectEnd, arrowTip, tolerance)) {
        return true;
      }
    }
  }
  if (shape.leaders) {
    for (const leader of shape.leaders) {
      for (let i = 0; i < leader.points.length - 1; i++) {
        if (isPointNearLine(point, leader.points[i], leader.points[i + 1], tolerance)) {
          return true;
        }
      }
    }
  }

  return false;
}

/**
 * Check if a point is inside the bounding box of dimension text.
 * Computes the text width using canvas measurement and checks whether the
 * click point (inverse-rotated into the text's local frame) falls within
 * the box defined by font metrics.
 */
function isPointInDimensionTextBox(
  point: Point,
  textPosition: Point,
  textAngle: number,
  dimension: DimensionShape,
  textHeight: number,
  tolerance: number
): boolean {
  // Build display text (same as DimensionRenderer.drawDimensionText)
  let displayText = dimension.value;
  if (dimension.prefix) displayText = dimension.prefix + displayText;
  if (dimension.suffix) displayText = displayText + dimension.suffix;

  // Measure text width
  const ctx = getMeasureCtx();
  ctx.font = `${textHeight}px ${CAD_DEFAULT_FONT}`;
  const metrics = ctx.measureText(displayText);
  const halfWidth = metrics.width / 2 + tolerance;
  const halfHeight = textHeight / 2 + tolerance;

  // Apply textOffset if present
  const pos = dimension.textOffset
    ? { x: textPosition.x + dimension.textOffset.x, y: textPosition.y + dimension.textOffset.y }
    : textPosition;

  // Inverse-rotate the point into the text's local coordinate system
  const cos = Math.cos(-textAngle);
  const sin = Math.sin(-textAngle);
  const dx = point.x - pos.x;
  const dy = point.y - pos.y;
  const localX = dx * cos - dy * sin;
  const localY = dx * sin + dy * cos;

  return localX >= -halfWidth && localX <= halfWidth &&
         localY >= -halfHeight && localY <= halfHeight;
}

/**
 * Check if a point is near a dimension shape
 * @param drawingScale - Optional drawing scale for correct text bounding box sizing
 */
export function isPointNearDimension(
  point: Point,
  dimension: DimensionShape,
  tolerance: number,
  drawingScale?: number
): boolean {
  const { dimensionType, points, dimensionLineOffset, dimensionStyle, linearDirection } = dimension;

  if (points.length < 2) return false;

  // Scale text height to match the rendered size.
  // dimensionStyle.textHeight is in paper mm; the renderer multiplies by (1/drawingScale).
  const scaledTextHeight = drawingScale && drawingScale > 0
    ? dimensionStyle.textHeight / drawingScale
    : dimensionStyle.textHeight;

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

      // Check if click is inside the dimension text bounding box
      if (isPointInDimensionTextBox(
        point, geometry.textPosition, geometry.textAngle,
        dimension, scaledTextHeight, tolerance
      )) {
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

      // Check if click is inside the dimension text bounding box
      // Angular dimensions use horizontal text (angle = 0)
      if (isPointInDimensionTextBox(
        point, geometry.textPosition, 0,
        dimension, scaledTextHeight, tolerance
      )) {
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

      // Check if click is inside the dimension text bounding box
      if (isPointInDimensionTextBox(
        point, geometry.textPosition, geometry.textAngle,
        dimension, scaledTextHeight, tolerance
      )) {
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

      // Check if click is inside the dimension text bounding box
      if (isPointInDimensionTextBox(
        point, geometry.textPosition, geometry.textAngle,
        dimension, scaledTextHeight, tolerance
      )) {
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
 * @param drawingScale - Optional drawing scale for text annotation scaling
 */
export function getShapeBounds(shape: Shape, drawingScale?: number, gridlineExtension?: number | Map<string, any>, _blockDefinitions?: Map<string, any>): ShapeBounds | null {
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
    case 'text': {
      const textBounds = getTextBounds(shape, drawingScale);
      if (!textBounds) return null;

      let bounds = textBounds;
      const rotation = shape.rotation || 0;

      if (rotation !== 0) {
        // Calculate rotated bounding box
        const cos = Math.cos(rotation);
        const sin = Math.sin(rotation);
        const pos = shape.position;

        // Get the four corners of the unrotated text box
        const corners = [
          { x: textBounds.minX, y: textBounds.minY },
          { x: textBounds.maxX, y: textBounds.minY },
          { x: textBounds.maxX, y: textBounds.maxY },
          { x: textBounds.minX, y: textBounds.maxY },
        ];

        // Rotate each corner around the text position
        const rotatedCorners = corners.map(c => {
          const dx = c.x - pos.x;
          const dy = c.y - pos.y;
          return {
            x: pos.x + dx * cos - dy * sin,
            y: pos.y + dx * sin + dy * cos,
          };
        });

        bounds = {
          minX: Math.min(rotatedCorners[0].x, rotatedCorners[1].x, rotatedCorners[2].x, rotatedCorners[3].x),
          minY: Math.min(rotatedCorners[0].y, rotatedCorners[1].y, rotatedCorners[2].y, rotatedCorners[3].y),
          maxX: Math.max(rotatedCorners[0].x, rotatedCorners[1].x, rotatedCorners[2].x, rotatedCorners[3].x),
          maxY: Math.max(rotatedCorners[0].y, rotatedCorners[1].y, rotatedCorners[2].y, rotatedCorners[3].y),
        };
      }

      // Expand bounds to include leader line points
      const allLeaderPoints: Point[] = [];
      if (shape.leaderPoints) {
        allLeaderPoints.push(...shape.leaderPoints);
      }
      if (shape.leaders) {
        for (const leader of shape.leaders) {
          allLeaderPoints.push(...leader.points);
        }
      }
      if (allLeaderPoints.length > 0) {
        for (const pt of allLeaderPoints) {
          bounds = {
            minX: Math.min(bounds.minX, pt.x),
            minY: Math.min(bounds.minY, pt.y),
            maxX: Math.max(bounds.maxX, pt.x),
            maxY: Math.max(bounds.maxY, pt.y),
          };
        }
      }

      return bounds;
    }
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
    case 'beam': {
      const { start, end, flangeWidth } = shape;
      const halfWidth = flangeWidth / 2;

      // Arc beam bounding box
      if (shape.bulge && Math.abs(shape.bulge) > 0.0001) {
        const ab = bulgeArcBounds(start, end, shape.bulge);
        return {
          minX: ab.minX - halfWidth,
          minY: ab.minY - halfWidth,
          maxX: ab.maxX + halfWidth,
          maxY: ab.maxY + halfWidth,
        };
      }

      // Straight beam bounding box
      // Calculate beam direction perpendicular
      const dx = end.x - start.x;
      const dy = end.y - start.y;
      const length = Math.sqrt(dx * dx + dy * dy);
      if (length === 0) return null;

      const px = -dy / length;
      const py = dx / length;

      // Four corners of the beam rectangle
      const corners = [
        { x: start.x + px * halfWidth, y: start.y + py * halfWidth },
        { x: end.x + px * halfWidth, y: end.y + py * halfWidth },
        { x: end.x - px * halfWidth, y: end.y - py * halfWidth },
        { x: start.x - px * halfWidth, y: start.y - py * halfWidth },
      ];

      const bxs = corners.map(c => c.x);
      const bys = corners.map(c => c.y);
      return {
        minX: Math.min(...bxs),
        minY: Math.min(...bys),
        maxX: Math.max(...bxs),
        maxY: Math.max(...bys),
      };
    }
    case 'gridline': {
      const glShape = shape as GridlineShape;
      const glSf = annotationScaleFactor(drawingScale);
      const r = (glShape.bubbleRadius || 0) * glSf;
      const glExt = (typeof gridlineExtension === 'number' ? gridlineExtension : 500) * glSf;
      return {
        minX: Math.min(glShape.start.x, glShape.end.x) - r - glExt,
        minY: Math.min(glShape.start.y, glShape.end.y) - r - glExt,
        maxX: Math.max(glShape.start.x, glShape.end.x) + r + glExt,
        maxY: Math.max(glShape.start.y, glShape.end.y) + r + glExt,
      };
    }
    case 'level': {
      const lvShape = shape as LevelShape;
      const lvSf = annotationScaleFactor(drawingScale);
      const lvR = (lvShape.bubbleRadius || 0) * lvSf;
      return {
        minX: Math.min(lvShape.start.x, lvShape.end.x) - lvR,
        minY: Math.min(lvShape.start.y, lvShape.end.y) - lvR,
        maxX: Math.max(lvShape.start.x, lvShape.end.x) + lvR,
        maxY: Math.max(lvShape.start.y, lvShape.end.y) + lvR,
      };
    }
    case 'pile': {
      const pileShape = shape as PileShape;
      const pileR = pileShape.diameter / 2;
      return {
        minX: pileShape.position.x - pileR,
        minY: pileShape.position.y - pileR,
        maxX: pileShape.position.x + pileR,
        maxY: pileShape.position.y + pileR + pileShape.fontSize * 1.5,
      };
    }
    case 'cpt': {
      const cptShape = shape as CPTShape;
      const cptSf = annotationScaleFactor(drawingScale);
      const cptMs = (cptShape.markerSize || 300) * cptSf;
      const cptLabelH = cptShape.fontSize * cptSf * 1.5;
      return {
        minX: cptShape.position.x - cptMs * 0.6,
        minY: cptShape.position.y - cptMs * 0.7,
        maxX: cptShape.position.x + cptMs * 0.6,
        maxY: cptShape.position.y + cptMs * 0.7 + cptLabelH,
      };
    }
    case 'foundation-zone': {
      const fzShape = shape as FoundationZoneShape;
      if (fzShape.contourPoints.length === 0) return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
      const fzXs = fzShape.contourPoints.map(p => p.x);
      const fzYs = fzShape.contourPoints.map(p => p.y);
      return {
        minX: Math.min(...fzXs),
        minY: Math.min(...fzYs),
        maxX: Math.max(...fzXs),
        maxY: Math.max(...fzYs),
      };
    }
    case 'wall': {
      const wallShape = shape as WallShape;
      // Arc wall bounding box
      if (wallShape.bulge && Math.abs(wallShape.bulge) > 0.0001) {
        const ab = bulgeArcBounds(wallShape.start, wallShape.end, wallShape.bulge);
        const halfT = wallShape.thickness / 2;
        return {
          minX: ab.minX - halfT,
          minY: ab.minY - halfT,
          maxX: ab.maxX + halfT,
          maxY: ab.maxY + halfT,
        };
      }
      // Straight wall bounding box
      const wdx = wallShape.end.x - wallShape.start.x;
      const wdy = wallShape.end.y - wallShape.start.y;
      const wLen = Math.sqrt(wdx * wdx + wdy * wdy);
      if (wLen === 0) return null;
      // Perpendicular unit vector: math-CCW = visual right in screen Y-down coords
      const wpx = -wdy / wLen;
      const wpy = wdx / wLen;
      // Determine how much thickness goes to each side based on justification
      // +perp = visual right, -perp = visual left when looking from start to end
      let wLeftThick: number;
      let wRightThick: number;
      if (wallShape.justification === 'left') {
        wLeftThick = 0;
        wRightThick = wallShape.thickness;
      } else if (wallShape.justification === 'right') {
        wLeftThick = wallShape.thickness;
        wRightThick = 0;
      } else {
        wLeftThick = wallShape.thickness / 2;
        wRightThick = wallShape.thickness / 2;
      }
      const wCorners = [
        { x: wallShape.start.x + wpx * wLeftThick, y: wallShape.start.y + wpy * wLeftThick },
        { x: wallShape.end.x + wpx * wLeftThick, y: wallShape.end.y + wpy * wLeftThick },
        { x: wallShape.end.x - wpx * wRightThick, y: wallShape.end.y - wpy * wRightThick },
        { x: wallShape.start.x - wpx * wRightThick, y: wallShape.start.y - wpy * wRightThick },
      ];
      const wxs = wCorners.map(c => c.x);
      const wys = wCorners.map(c => c.y);
      return {
        minX: Math.min(...wxs),
        minY: Math.min(...wys),
        maxX: Math.max(...wxs),
        maxY: Math.max(...wys),
      };
    }
    case 'slab': {
      const slabShape = shape as SlabShape;
      if (slabShape.points.length === 0) return null;
      const sxs = slabShape.points.map(p => p.x);
      const sys = slabShape.points.map(p => p.y);
      return {
        minX: Math.min(...sxs),
        minY: Math.min(...sys),
        maxX: Math.max(...sxs),
        maxY: Math.max(...sys),
      };
    }
    case 'space': {
      const spaceShape = shape as SpaceShape;
      if (spaceShape.contourPoints.length === 0) return null;
      const spxs = spaceShape.contourPoints.map(p => p.x);
      const spys = spaceShape.contourPoints.map(p => p.y);
      return {
        minX: Math.min(...spxs),
        minY: Math.min(...spys),
        maxX: Math.max(...spxs),
        maxY: Math.max(...spys),
      };
    }
    case 'plate-system': {
      const psShape = shape as PlateSystemShape;
      if (psShape.contourPoints.length === 0) return null;
      let psMinX = Infinity, psMinY = Infinity, psMaxX = -Infinity, psMaxY = -Infinity;
      for (const p of psShape.contourPoints) {
        if (p.x < psMinX) psMinX = p.x;
        if (p.y < psMinY) psMinY = p.y;
        if (p.x > psMaxX) psMaxX = p.x;
        if (p.y > psMaxY) psMaxY = p.y;
      }
      // Expand bounds for arc segments
      if (psShape.contourBulges) {
        for (let i = 0; i < psShape.contourPoints.length; i++) {
          const b = psShape.contourBulges[i] ?? 0;
          if (b !== 0 && Math.abs(b) > 0.0001) {
            const j = (i + 1) % psShape.contourPoints.length;
            const ab = bulgeArcBounds(psShape.contourPoints[i], psShape.contourPoints[j], b);
            if (ab.minX < psMinX) psMinX = ab.minX;
            if (ab.minY < psMinY) psMinY = ab.minY;
            if (ab.maxX > psMaxX) psMaxX = ab.maxX;
            if (ab.maxY > psMaxY) psMaxY = ab.maxY;
          }
        }
      }
      return { minX: psMinX, minY: psMinY, maxX: psMaxX, maxY: psMaxY };
    }
    case 'section-callout': {
      const scShape = shape as SectionCalloutShape;
      const scSf = annotationScaleFactor(drawingScale);
      const scR = (scShape.bubbleRadius || 0) * scSf;
      const scArrowLen = scR * 1.5;
      return {
        minX: Math.min(scShape.start.x, scShape.end.x) - scR - scArrowLen,
        minY: Math.min(scShape.start.y, scShape.end.y) - scR - scArrowLen,
        maxX: Math.max(scShape.start.x, scShape.end.x) + scR + scArrowLen,
        maxY: Math.max(scShape.start.y, scShape.end.y) + scR + scArrowLen,
      };
    }
    case 'spot-elevation': {
      const seShape = shape as SpotElevationShape;
      const seSf = annotationScaleFactor(drawingScale);
      const seMs = (seShape.markerSize || 200) * seSf;
      return {
        minX: Math.min(seShape.position.x, seShape.labelPosition.x) - seMs,
        minY: Math.min(seShape.position.y, seShape.labelPosition.y) - seMs,
        maxX: Math.max(seShape.position.x, seShape.labelPosition.x) + seMs * 4,
        maxY: Math.max(seShape.position.y, seShape.labelPosition.y) + seMs,
      };
    }
    case 'image': {
      const rot = shape.rotation || 0;
      if (rot === 0) {
        return {
          minX: shape.position.x,
          minY: shape.position.y,
          maxX: shape.position.x + shape.width,
          maxY: shape.position.y + shape.height,
        };
      }
      const cos = Math.cos(rot);
      const sin = Math.sin(rot);
      const tl = shape.position;
      const imgCorners = [
        { x: tl.x, y: tl.y },
        { x: tl.x + shape.width * cos, y: tl.y + shape.width * sin },
        { x: tl.x + shape.width * cos - shape.height * sin, y: tl.y + shape.width * sin + shape.height * cos },
        { x: tl.x - shape.height * sin, y: tl.y + shape.height * cos },
      ];
      return {
        minX: Math.min(imgCorners[0].x, imgCorners[1].x, imgCorners[2].x, imgCorners[3].x),
        minY: Math.min(imgCorners[0].y, imgCorners[1].y, imgCorners[2].y, imgCorners[3].y),
        maxX: Math.max(imgCorners[0].x, imgCorners[1].x, imgCorners[2].x, imgCorners[3].x),
        maxY: Math.max(imgCorners[0].y, imgCorners[1].y, imgCorners[2].y, imgCorners[3].y),
      };
    }
    case 'block-instance': {
      const bi = shape as any;
      return {
        minX: bi.position.x,
        minY: bi.position.y,
        maxX: bi.position.x + (bi.scaleX || 1),
        maxY: bi.position.y + (bi.scaleY || 1),
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
  viewport: { offsetX: number; offsetY: number; zoom: number; rotation?: number }
): Point {
  const r = viewport.rotation || 0;
  const tx = screenX - viewport.offsetX;
  const ty = screenY - viewport.offsetY;
  if (r === 0) {
    return { x: tx / viewport.zoom, y: ty / viewport.zoom };
  }
  const cos = Math.cos(r);
  const sin = Math.sin(r);
  // Un-rotate by -r: (tx*cos + ty*sin, -tx*sin + ty*cos)
  const ux = tx * cos + ty * sin;
  const uy = -tx * sin + ty * cos;
  return { x: ux / viewport.zoom, y: uy / viewport.zoom };
}

/**
 * Convert world coordinates to screen coordinates
 */
export function worldToScreen(
  worldX: number,
  worldY: number,
  viewport: { offsetX: number; offsetY: number; zoom: number; rotation?: number }
): Point {
  const r = viewport.rotation || 0;
  const sx = worldX * viewport.zoom;
  const sy = worldY * viewport.zoom;
  if (r === 0) {
    return { x: sx + viewport.offsetX, y: sy + viewport.offsetY };
  }
  const cos = Math.cos(r);
  const sin = Math.sin(r);
  // Rotate by r
  return {
    x: sx * cos - sy * sin + viewport.offsetX,
    y: sx * sin + sy * cos + viewport.offsetY,
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

/**
 * Get boundary points and bulge data from a closed shape for hatch creation
 * Returns both points and optional bulge array for curved polylines
 */
export function getShapeBoundaryWithBulge(shape: Shape, segmentCount: number = 64): { points: Point[]; bulge?: number[] } {
  switch (shape.type) {
    case 'polyline': {
      if (shape.closed) {
        return {
          points: [...shape.points],
          bulge: shape.bulge ? [...shape.bulge] : undefined,
        };
      }
      return { points: [] };
    }
    default:
      // For other shapes, just return points (no bulge needed - they're approximated with straight segments)
      return { points: getShapeBoundaryPoints(shape, segmentCount) };
  }
}
