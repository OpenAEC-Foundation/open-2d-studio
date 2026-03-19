/**
 * Modify geometry utilities - pure functions for transform operations
 */

import type { Point, Shape, LineShape, ArcShape, GridlineShape, LevelShape, PuntniveauShape, PileShape, CPTShape, WallShape, BeamShape, SlabShape, SpaceShape, PlateSystemShape, ColumnShape, WallOpeningShape, SlabOpeningShape, SlabLabelShape, SectionCalloutShape, SpotElevationShape, FoundationZoneShape, RebarShape } from '../../types/geometry';
import { generateId } from '../../state/slices/types';
import { formatPeilLabel, calculatePeilFromY } from '../../hooks/drawing/useLevelDrawing';
import { bulgeToArc } from './GeometryUtils';

// ============================================================================
// Point Transforms
// ============================================================================

export type PointTransform = (p: Point) => Point;

export function translateTransform(dx: number, dy: number): PointTransform {
  return (p) => ({ x: p.x + dx, y: p.y + dy });
}

export function rotateTransform(center: Point, angle: number): PointTransform {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return (p) => ({
    x: center.x + (p.x - center.x) * cos - (p.y - center.y) * sin,
    y: center.y + (p.x - center.x) * sin + (p.y - center.y) * cos,
  });
}

export function scaleTransform(origin: Point, factor: number): PointTransform {
  return (p) => ({
    x: origin.x + (p.x - origin.x) * factor,
    y: origin.y + (p.y - origin.y) * factor,
  });
}

export function mirrorTransform(axisP1: Point, axisP2: Point): PointTransform {
  const dx = axisP2.x - axisP1.x;
  const dy = axisP2.y - axisP1.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return (p) => p;
  return (p) => {
    const t = ((p.x - axisP1.x) * dx + (p.y - axisP1.y) * dy) / lenSq;
    const projX = axisP1.x + t * dx;
    const projY = axisP1.y + t * dy;
    return {
      x: 2 * projX - p.x,
      y: 2 * projY - p.y,
    };
  };
}

// ============================================================================
// Shape Transform
// ============================================================================

/**
 * Deep-clone a shape and apply a point transform to all geometric points.
 * Returns a new shape with a new ID.
 */
export function transformShape(shape: Shape, transform: PointTransform, newId?: string): Shape {
  const cloned: Shape = JSON.parse(JSON.stringify(shape));
  (cloned as any).id = newId ?? generateId();

  switch (cloned.type) {
    case 'line':
      cloned.start = transform(cloned.start);
      cloned.end = transform(cloned.end);
      break;
    case 'beam':
      cloned.start = transform(cloned.start);
      cloned.end = transform(cloned.end);
      break;
    case 'gridline':
      (cloned as GridlineShape).start = transform((cloned as GridlineShape).start);
      (cloned as GridlineShape).end = transform((cloned as GridlineShape).end);
      break;
    case 'level': {
      const lvCloned = cloned as LevelShape;
      lvCloned.start = transform(lvCloned.start);
      lvCloned.end = transform(lvCloned.end);
      // Auto-update peil based on new Y position
      const newPeil = calculatePeilFromY(lvCloned.start.y);
      lvCloned.peil = newPeil;
      lvCloned.elevation = newPeil;
      lvCloned.label = formatPeilLabel(newPeil);
      break;
    }
    case 'pile':
      (cloned as PileShape).position = transform((cloned as PileShape).position);
      break;
    case 'cpt':
      (cloned as CPTShape).position = transform((cloned as CPTShape).position);
      break;
    case 'wall':
      (cloned as WallShape).start = transform((cloned as WallShape).start);
      (cloned as WallShape).end = transform((cloned as WallShape).end);
      break;
    case 'rectangle': {
      const rot = cloned.rotation || 0;
      const cos = Math.cos(rot);
      const sin = Math.sin(rot);
      const tl = cloned.topLeft;
      // Compute the four corners in world space
      const corners = [
        { x: 0, y: 0 },
        { x: cloned.width, y: 0 },
        { x: cloned.width, y: cloned.height },
        { x: 0, y: cloned.height },
      ].map(c => ({
        x: tl.x + c.x * cos - c.y * sin,
        y: tl.y + c.x * sin + c.y * cos,
      }));

      // Transform all four corners
      const tc = corners.map(transform);

      // Derive new rotation from the transformed first edge (topLeft -> topRight)
      const newEdgeDx = tc[1].x - tc[0].x;
      const newEdgeDy = tc[1].y - tc[0].y;
      const newRot = Math.atan2(newEdgeDy, newEdgeDx);

      // Derive new width and height from transformed edges
      const newWidth = Math.sqrt(newEdgeDx * newEdgeDx + newEdgeDy * newEdgeDy);
      const sideEdgeDx = tc[3].x - tc[0].x;
      const sideEdgeDy = tc[3].y - tc[0].y;
      const newHeight = Math.sqrt(sideEdgeDx * sideEdgeDx + sideEdgeDy * sideEdgeDy);

      cloned.topLeft = tc[0];
      cloned.width = newWidth;
      cloned.height = newHeight;
      cloned.rotation = newRot;
      break;
    }
    case 'circle':
      cloned.center = transform(cloned.center);
      // For scale, adjust radius
      {
        const edgePt = { x: shape.type === 'circle' ? shape.center.x + shape.radius : 0, y: shape.type === 'circle' ? shape.center.y : 0 };
        const newEdge = transform(edgePt);
        const dx = newEdge.x - cloned.center.x;
        const dy = newEdge.y - cloned.center.y;
        cloned.radius = Math.sqrt(dx * dx + dy * dy);
      }
      break;
    case 'arc':
      cloned.center = transform(cloned.center);
      {
        const startPt = {
          x: (shape as ArcShape).center.x + (shape as ArcShape).radius * Math.cos((shape as ArcShape).startAngle),
          y: (shape as ArcShape).center.y + (shape as ArcShape).radius * Math.sin((shape as ArcShape).startAngle),
        };
        const endPt = {
          x: (shape as ArcShape).center.x + (shape as ArcShape).radius * Math.cos((shape as ArcShape).endAngle),
          y: (shape as ArcShape).center.y + (shape as ArcShape).radius * Math.sin((shape as ArcShape).endAngle),
        };
        const newStart = transform(startPt);
        const newEnd = transform(endPt);
        const dx = newStart.x - cloned.center.x;
        const dy = newStart.y - cloned.center.y;
        cloned.radius = Math.sqrt(dx * dx + dy * dy);
        cloned.startAngle = Math.atan2(newStart.y - cloned.center.y, newStart.x - cloned.center.x);
        cloned.endAngle = Math.atan2(newEnd.y - cloned.center.y, newEnd.x - cloned.center.x);
      }
      break;
    case 'ellipse':
      cloned.center = transform(cloned.center);
      // Simplified: adjust radii via scale factor estimate
      {
        const rPt = { x: (shape as any).center.x + (shape as any).radiusX, y: (shape as any).center.y };
        const newR = transform(rPt);
        const dx = newR.x - cloned.center.x;
        const dy = newR.y - cloned.center.y;
        const newRadiusX = Math.sqrt(dx * dx + dy * dy);
        const ratio = newRadiusX / ((shape as any).radiusX || 1);
        cloned.radiusX = newRadiusX;
        cloned.radiusY = (shape as any).radiusY * ratio;
      }
      break;
    case 'polyline':
      cloned.points = cloned.points.map(transform);
      break;
    case 'spline':
      cloned.points = cloned.points.map(transform);
      break;
    case 'text':
      cloned.position = transform(cloned.position);
      if (cloned.leaderPoints) {
        cloned.leaderPoints = cloned.leaderPoints.map(transform);
      }
      break;
    case 'point':
      cloned.position = transform(cloned.position);
      break;
    case 'hatch':
      cloned.points = cloned.points.map(transform);
      break;
    case 'slab':
      (cloned as SlabShape).points = (cloned as SlabShape).points.map(transform);
      break;
    case 'puntniveau':
      (cloned as PuntniveauShape).points = (cloned as PuntniveauShape).points.map(transform);
      break;
    case 'space':
      (cloned as SpaceShape).contourPoints = (cloned as SpaceShape).contourPoints.map(transform);
      (cloned as SpaceShape).labelPosition = transform((cloned as SpaceShape).labelPosition);
      break;
    case 'plate-system': {
      const ps = cloned as PlateSystemShape;
      ps.contourPoints = ps.contourPoints.map(transform);
      // Also transform rectangular openings
      if (ps.openings) {
        ps.openings = ps.openings.map(op => ({
          ...op,
          position: transform(op.position),
        }));
      }
      break;
    }
    case 'dimension':
      (cloned as any).points = ((cloned as any).points as Point[]).map(transform);
      break;
    case 'image': {
      const imgRot = cloned.rotation || 0;
      const imgCos = Math.cos(imgRot);
      const imgSin = Math.sin(imgRot);
      const imgTl = cloned.position;
      // Compute corners in world space
      const imgCorners = [
        { x: 0, y: 0 },
        { x: cloned.width, y: 0 },
        { x: cloned.width, y: cloned.height },
        { x: 0, y: cloned.height },
      ].map(c => ({
        x: imgTl.x + c.x * imgCos - c.y * imgSin,
        y: imgTl.y + c.x * imgSin + c.y * imgCos,
      }));
      // Transform all four corners
      const imgTc = imgCorners.map(transform);
      // Derive new rotation from transformed first edge (TL -> TR)
      const imgEdgeDx = imgTc[1].x - imgTc[0].x;
      const imgEdgeDy = imgTc[1].y - imgTc[0].y;
      const imgNewRot = Math.atan2(imgEdgeDy, imgEdgeDx);
      // Derive new width/height from transformed edges
      const imgNewWidth = Math.sqrt(imgEdgeDx * imgEdgeDx + imgEdgeDy * imgEdgeDy);
      const imgSideDx = imgTc[3].x - imgTc[0].x;
      const imgSideDy = imgTc[3].y - imgTc[0].y;
      const imgNewHeight = Math.sqrt(imgSideDx * imgSideDx + imgSideDy * imgSideDy);
      cloned.position = imgTc[0];
      cloned.width = imgNewWidth;
      cloned.height = imgNewHeight;
      cloned.rotation = imgNewRot;
      break;
    }
    case 'block-instance': {
      const oldPos = cloned.position;
      cloned.position = transform(oldPos);
      // Derive rotation change from transform by probing a nearby point
      const probe = { x: oldPos.x + 1, y: oldPos.y };
      const probeT = transform(probe);
      const angleChange = Math.atan2(probeT.y - cloned.position.y, probeT.x - cloned.position.x);
      cloned.rotation = (cloned.rotation || 0) + angleChange;
      break;
    }
    case 'column': {
      const col = cloned as unknown as ColumnShape;
      const oldColPos = col.position;
      col.position = transform(col.position);
      // Derive rotation change from transform
      const colProbe = { x: oldColPos.x + 1, y: oldColPos.y };
      const colProbeT = transform(colProbe);
      const colAngle = Math.atan2(colProbeT.y - col.position.y, colProbeT.x - col.position.x);
      col.rotation = (col.rotation || 0) + colAngle;
      break;
    }
    case 'wall-opening': {
      // Wall openings are positioned relative to their host wall (positionAlongWall),
      // so they move implicitly when the host wall moves. No geometry to transform.
      break;
    }
    case 'slab-opening': {
      const so = cloned as unknown as SlabOpeningShape;
      so.points = so.points.map(transform);
      break;
    }
    case 'slab-label': {
      const sl = cloned as unknown as SlabLabelShape;
      sl.position = transform(sl.position);
      break;
    }
    case 'section-callout': {
      const sc = cloned as unknown as SectionCalloutShape;
      sc.start = transform(sc.start);
      sc.end = transform(sc.end);
      if (sc.detailCenter) {
        sc.detailCenter = transform(sc.detailCenter);
      }
      break;
    }
    case 'spot-elevation': {
      const se = cloned as unknown as SpotElevationShape;
      se.position = transform(se.position);
      se.labelPosition = transform(se.labelPosition);
      break;
    }
    case 'foundation-zone': {
      const fz = cloned as unknown as FoundationZoneShape;
      fz.contourPoints = fz.contourPoints.map(transform);
      break;
    }
    case 'rebar': {
      const rb = cloned as unknown as RebarShape;
      rb.position = transform(rb.position);
      if (rb.endPoint) {
        rb.endPoint = transform(rb.endPoint);
      }
      break;
    }
  }

  return cloned;
}

/**
 * Apply transform in-place to shape (returns partial updates for updateShapes)
 */
export function getShapeTransformUpdates(shape: Shape, transform: PointTransform): Partial<Shape> {
  const transformed = transformShape(shape, transform, shape.id);
  const { id, type, layerId, drawingId, style, visible, locked, ...geom } = transformed as any;
  return geom;
}

// ============================================================================
// Trim / Extend / Fillet / Offset
// ============================================================================

function lineLineIntersection(
  p1: Point, p2: Point, p3: Point, p4: Point
): Point | null {
  const d1x = p2.x - p1.x;
  const d1y = p2.y - p1.y;
  const d2x = p4.x - p3.x;
  const d2y = p4.y - p3.y;
  const denom = d1x * d2y - d1y * d2x;
  if (Math.abs(denom) < 1e-10) return null;
  const t = ((p3.x - p1.x) * d2y - (p3.y - p1.y) * d2x) / denom;
  return { x: p1.x + t * d1x, y: p1.y + t * d1y };
}

/** Shape types that have start/end points (line-like) */
const LINE_LIKE_TYPES = ['line', 'gridline', 'beam', 'wall', 'level'];

/** Extract start/end from a line-like shape */
function getLineEndpoints(shape: Shape): { start: Point; end: Point } | null {
  if (!LINE_LIKE_TYPES.includes(shape.type)) return null;
  const s = shape as any;
  return { start: s.start, end: s.end };
}

/**
 * Trim or extend a line-like shape at the intersection with a cutting edge.
 * Works with line, gridline, beam, wall, and level shapes.
 *
 * Behavior:
 * - If the intersection of the infinite lines falls WITHIN the target line's
 *   current extents (t in [0,1]): TRIM (shorten) the target by removing
 *   the portion on the clicked side of the intersection.
 * - If the intersection falls OUTSIDE the target line's extents:
 *   EXTEND the nearest endpoint of the target to the intersection point.
 *
 * clickedPoint: for trim, the point on the shape that should be REMOVED.
 *               for extend, it is not used (nearest endpoint is extended).
 */
export function trimLineAtIntersection(
  line: LineShape,
  cuttingEdge: Shape,
  clickedPoint: Point
): Partial<LineShape> | null {
  const cutEndpoints = getLineEndpoints(cuttingEdge);
  if (!cutEndpoints) return null;

  const lineEndpoints = getLineEndpoints(line as any as Shape);
  if (!lineEndpoints) return null;

  // Find intersection of the two infinite lines
  const intersection = lineLineIntersection(lineEndpoints.start, lineEndpoints.end, cutEndpoints.start, cutEndpoints.end);
  if (!intersection) return null; // Lines are parallel

  // Parameter t: where the intersection falls on the target line
  // t=0 means at start, t=1 means at end, outside [0,1] means beyond the segment
  const t = lineParamAt(lineEndpoints.start, lineEndpoints.end, intersection);

  // Also check if the intersection is reasonably on the cutting edge
  // (allow some tolerance for the boundary, but for extend we use the infinite
  // extension of the cutting edge as well -- the user selected it as boundary)
  const tCut = lineParamAt(cutEndpoints.start, cutEndpoints.end, intersection);

  if (t >= -0.01 && t <= 1.01) {
    // Intersection is WITHIN the target line's extents → TRIM (shorten)
    // Determine which side the user clicked (that side gets removed).
    const distToStart = Math.hypot(clickedPoint.x - lineEndpoints.start.x, clickedPoint.y - lineEndpoints.start.y);
    const distToEnd = Math.hypot(clickedPoint.x - lineEndpoints.end.x, clickedPoint.y - lineEndpoints.end.y);

    if (distToStart < distToEnd) {
      // Clicked near start: remove start side, keep end side
      return { start: intersection, end: lineEndpoints.end } as any;
    } else {
      // Clicked near end: remove end side, keep start side
      return { start: lineEndpoints.start, end: intersection } as any;
    }
  } else {
    // Intersection is OUTSIDE the target line's extents → EXTEND
    // Only extend if the intersection is on (or near) the cutting edge segment
    // Use a generous tolerance to allow extending to cutting edges
    if (tCut < -0.01 || tCut > 1.01) return null;

    // Extend the nearest endpoint to the intersection
    const distToStart = Math.hypot(intersection.x - lineEndpoints.start.x, intersection.y - lineEndpoints.start.y);
    const distToEnd = Math.hypot(intersection.x - lineEndpoints.end.x, intersection.y - lineEndpoints.end.y);

    if (distToStart < distToEnd) {
      // Start is closer to the intersection: extend start
      return { start: intersection, end: lineEndpoints.end } as any;
    } else {
      // End is closer to the intersection: extend end
      return { start: lineEndpoints.start, end: intersection } as any;
    }
  }
}

function lineParamAt(start: Point, end: Point, pt: Point): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq < 1e-10) return 0;
  return ((pt.x - start.x) * dx + (pt.y - start.y) * dy) / lenSq;
}

/**
 * Extend two line-like shapes so they both meet at their mutual intersection point.
 * This handles the case where both shapes need extending (their infinite lines meet
 * at a point outside both segments). Each shape's nearest endpoint is moved to the
 * intersection.
 *
 * Returns null if the shapes are parallel or not line-like.
 */
export function extendBothToIntersection(
  shape1: Shape,
  shape2: Shape
): { shape1Update: Partial<Shape>; shape2Update: Partial<Shape> } | null {
  const ep1 = getLineEndpoints(shape1);
  const ep2 = getLineEndpoints(shape2);
  if (!ep1 || !ep2) return null;

  const intersection = lineLineIntersection(ep1.start, ep1.end, ep2.start, ep2.end);
  if (!intersection) return null; // Parallel lines

  // For shape1: extend the nearest endpoint to the intersection
  const d1s = Math.hypot(intersection.x - ep1.start.x, intersection.y - ep1.start.y);
  const d1e = Math.hypot(intersection.x - ep1.end.x, intersection.y - ep1.end.y);
  const shape1Update: Partial<Shape> = d1s < d1e
    ? { start: intersection, end: ep1.end } as any
    : { start: ep1.start, end: intersection } as any;

  // For shape2: extend the nearest endpoint to the intersection
  const d2s = Math.hypot(intersection.x - ep2.start.x, intersection.y - ep2.start.y);
  const d2e = Math.hypot(intersection.x - ep2.end.x, intersection.y - ep2.end.y);
  const shape2Update: Partial<Shape> = d2s < d2e
    ? { start: intersection, end: ep2.end } as any
    : { start: ep2.start, end: intersection } as any;

  return { shape1Update, shape2Update };
}

/**
 * Extend a line-like shape to a boundary shape.
 * Works with line, gridline, beam, and wall shapes.
 */
export function extendLineToBoundary(
  line: LineShape,
  boundary: Shape
): Partial<LineShape> | null {
  const bEndpoints = getLineEndpoints(boundary);
  if (!bEndpoints) return null;

  const lineEndpoints = getLineEndpoints(line as any as Shape);
  if (!lineEndpoints) return null;

  // Extend the line (as infinite) to find intersection with boundary
  const intersection = lineLineIntersection(lineEndpoints.start, lineEndpoints.end, bEndpoints.start, bEndpoints.end);
  if (!intersection) return null;

  // Check intersection is on the boundary segment
  const tBound = lineParamAt(bEndpoints.start, bEndpoints.end, intersection);
  if (tBound < -0.01 || tBound > 1.01) return null;

  // Extend from the nearer endpoint
  const distToStart = Math.hypot(intersection.x - lineEndpoints.start.x, intersection.y - lineEndpoints.start.y);
  const distToEnd = Math.hypot(intersection.x - lineEndpoints.end.x, intersection.y - lineEndpoints.end.y);

  if (distToStart < distToEnd) {
    return { start: intersection, end: lineEndpoints.end } as any;
  } else {
    return { start: lineEndpoints.start, end: intersection } as any;
  }
}

/**
 * Create a fillet arc between two lines.
 * Returns the fillet arc shape data and the trimmed line updates.
 */
export function filletTwoLines(
  line1: LineShape,
  line2: LineShape,
  radius: number
): { arc: { center: Point; radius: number; startAngle: number; endAngle: number }; line1Update: Partial<LineShape>; line2Update: Partial<LineShape> } | null {
  const intersection = lineLineIntersection(line1.start, line1.end, line2.start, line2.end);
  if (!intersection) return null;
  if (radius <= 0) return null;

  // Direction vectors of each line
  const d1x = line1.end.x - line1.start.x;
  const d1y = line1.end.y - line1.start.y;
  const len1 = Math.hypot(d1x, d1y);
  const d2x = line2.end.x - line2.start.x;
  const d2y = line2.end.y - line2.start.y;
  const len2 = Math.hypot(d2x, d2y);

  if (len1 < 1e-10 || len2 < 1e-10) return null;

  const u1 = { x: d1x / len1, y: d1y / len1 };
  const u2 = { x: d2x / len2, y: d2y / len2 };

  // Half angle between lines
  const dot = u1.x * u2.x + u1.y * u2.y;
  const angle = Math.acos(Math.max(-1, Math.min(1, dot)));
  const halfAngle = angle / 2;
  if (Math.abs(Math.sin(halfAngle)) < 1e-10) return null;

  const dist = radius / Math.tan(halfAngle);

  // Direction from intersection toward line endpoints (away from intersection)
  const t1s = lineParamAt(line1.start, line1.end, intersection);
  const dir1 = t1s > 0.5 ? -1 : 1;
  const t2s = lineParamAt(line2.start, line2.end, intersection);
  const dir2 = t2s > 0.5 ? -1 : 1;

  // Tangent points
  const tan1: Point = {
    x: intersection.x + dir1 * u1.x * dist,
    y: intersection.y + dir1 * u1.y * dist,
  };
  const tan2: Point = {
    x: intersection.x + dir2 * u2.x * dist,
    y: intersection.y + dir2 * u2.y * dist,
  };

  // Normals (perpendicular, toward center)
  const cross = u1.x * u2.y - u1.y * u2.x;
  const side = cross > 0 ? 1 : -1;
  const n1 = { x: -u1.y * side, y: u1.x * side };

  const center: Point = {
    x: tan1.x + n1.x * radius,
    y: tan1.y + n1.y * radius,
  };

  const startAngle = Math.atan2(tan1.y - center.y, tan1.x - center.x);
  const endAngle = Math.atan2(tan2.y - center.y, tan2.x - center.x);

  // Trim lines to tangent points
  const line1Update: Partial<LineShape> = {};
  const line2Update: Partial<LineShape> = {};

  const d1toStart = Math.hypot(tan1.x - line1.start.x, tan1.y - line1.start.y);
  const d1toEnd = Math.hypot(tan1.x - line1.end.x, tan1.y - line1.end.y);
  if (d1toStart < d1toEnd) {
    line1Update.end = tan1;
  } else {
    line1Update.start = tan1;
  }

  const d2toStart = Math.hypot(tan2.x - line2.start.x, tan2.y - line2.start.y);
  const d2toEnd = Math.hypot(tan2.x - line2.end.x, tan2.y - line2.end.y);
  if (d2toStart < d2toEnd) {
    line2Update.end = tan2;
  } else {
    line2Update.start = tan2;
  }

  return {
    arc: { center, radius, startAngle, endAngle },
    line1Update,
    line2Update,
  };
}

/**
 * Create a chamfer (straight line) between two lines.
 * Returns the chamfer line segment and the trimmed line updates.
 */
export function chamferTwoLines(
  line1: LineShape,
  line2: LineShape,
  dist1: number,
  dist2: number
): { lineSegment: { start: Point; end: Point }; line1Update: Partial<LineShape>; line2Update: Partial<LineShape> } | null {
  const intersection = lineLineIntersection(line1.start, line1.end, line2.start, line2.end);
  if (!intersection) return null;

  // Direction vectors of each line
  const d1x = line1.end.x - line1.start.x;
  const d1y = line1.end.y - line1.start.y;
  const len1 = Math.hypot(d1x, d1y);
  const d2x = line2.end.x - line2.start.x;
  const d2y = line2.end.y - line2.start.y;
  const len2 = Math.hypot(d2x, d2y);

  if (len1 < 1e-10 || len2 < 1e-10) return null;

  const u1 = { x: d1x / len1, y: d1y / len1 };
  const u2 = { x: d2x / len2, y: d2y / len2 };

  // Direction from intersection toward line endpoints (away from intersection)
  const t1s = lineParamAt(line1.start, line1.end, intersection);
  const dir1 = t1s > 0.5 ? -1 : 1;
  const t2s = lineParamAt(line2.start, line2.end, intersection);
  const dir2 = t2s > 0.5 ? -1 : 1;

  // Chamfer points at dist1 along line1 and dist2 along line2 from intersection
  const cp1: Point = {
    x: intersection.x + dir1 * u1.x * dist1,
    y: intersection.y + dir1 * u1.y * dist1,
  };
  const cp2: Point = {
    x: intersection.x + dir2 * u2.x * dist2,
    y: intersection.y + dir2 * u2.y * dist2,
  };

  // Trim lines to chamfer points
  const line1Update: Partial<LineShape> = {};
  const line2Update: Partial<LineShape> = {};

  const d1toStart = Math.hypot(cp1.x - line1.start.x, cp1.y - line1.start.y);
  const d1toEnd = Math.hypot(cp1.x - line1.end.x, cp1.y - line1.end.y);
  if (d1toStart < d1toEnd) {
    line1Update.end = cp1;
  } else {
    line1Update.start = cp1;
  }

  const d2toStart = Math.hypot(cp2.x - line2.start.x, cp2.y - line2.start.y);
  const d2toEnd = Math.hypot(cp2.x - line2.end.x, cp2.y - line2.end.y);
  if (d2toStart < d2toEnd) {
    line2Update.end = cp2;
  } else {
    line2Update.start = cp2;
  }

  return {
    lineSegment: { start: cp1, end: cp2 },
    line1Update,
    line2Update,
  };
}

// ============================================================================
// Miter Join (Verstek) for Walls and Beams
// ============================================================================

/**
 * Get the bulge value from a wall or beam shape, if present.
 * Returns 0 for shapes that are not wall/beam or have no bulge.
 */
function getShapeBulge(shape: Shape): number {
  if (shape.type === 'wall') return (shape as WallShape).bulge ?? 0;
  if (shape.type === 'beam') return (shape as BeamShape).bulge ?? 0;
  return 0;
}

/**
 * Compute the direction angle of a wall/beam centerline pointing AWAY from a
 * junction at the given endpoint. For straight shapes this is the simple
 * atan2 from the junction toward the far endpoint. For arc shapes (bulge != 0)
 * this is the tangent direction at the junction endpoint, pointing away from
 * the junction (i.e. in the direction of travel along the arc away from the join).
 *
 * @param start - shape start point
 * @param end - shape end point
 * @param joinAtStart - true if the junction is at the start endpoint
 * @param bulge - arc bulge value (0 = straight)
 * @param intersection - the junction/intersection point (may differ from
 *                       start/end if endpoints were moved to the intersection)
 */
function getAwayDirection(
  start: Point,
  end: Point,
  joinAtStart: boolean,
  bulge: number,
  intersection: Point,
): number {
  const isStraight = !bulge || Math.abs(bulge) < 0.0001;

  if (isStraight) {
    // Straight: direction from intersection toward the far endpoint
    const farEnd = joinAtStart ? end : start;
    return Math.atan2(farEnd.y - intersection.y, farEnd.x - intersection.x);
  }

  // Arc: the "away" direction is the tangent at the junction endpoint,
  // pointing along the arc away from the junction.
  const { center, clockwise } = bulgeToArc(start, end, bulge);

  // The junction point on the arc
  const junctionPt = joinAtStart ? start : end;
  const radiusAngle = Math.atan2(junctionPt.y - center.y, junctionPt.x - center.x);

  // Tangent is perpendicular to the radius.
  // For a CCW arc (positive bulge), travel direction goes from startAngle
  // increasing toward endAngle. At the start the tangent points +90 from
  // radius; at the end it also points +90 from radius (both are "forward"
  // travel direction).
  //
  // For a CW arc (negative bulge), travel goes from startAngle decreasing
  // toward endAngle. Tangent in travel direction is radius - 90.
  //
  // The "travel direction" tangent always points from start toward end.
  // We want the "away" direction, which is:
  //   - If joining at start: AWAY = opposite of travel direction (toward end reversed) ... no,
  //     "away from intersection" means toward the rest of the wall, i.e. the travel direction
  //     from start toward end.
  //   - If joining at end: AWAY = opposite of travel direction at end (the arc arrives
  //     at end; "away" means continuing past end, which is the travel direction at end).
  //
  // Actually, "away from the intersection" for a straight wall means pointing from
  // the junction toward the far end. For an arc, the analogous concept is the tangent
  // at the junction pointing along the arc toward the far end.
  //
  // Travel direction tangent at any point on the arc:
  //   CCW (positive bulge): tangent = radiusAngle + PI/2
  //   CW  (negative bulge): tangent = radiusAngle - PI/2
  //
  // At the START, travel direction (start->end) IS the "away" direction.
  // At the END, the travel direction points INTO the junction, so "away" is the reverse.

  const travelTangent = clockwise
    ? radiusAngle - Math.PI / 2
    : radiusAngle + Math.PI / 2;

  if (joinAtStart) {
    // At start: travel direction goes away from junction (toward the arc interior / far end)
    return travelTangent;
  } else {
    // At end: travel direction arrives at junction, so "away" is the reverse
    return travelTangent + Math.PI;
  }
}

/**
 * Compute a miter (verstek) join between two line-like shapes (walls or beams).
 *
 * Algorithm:
 * 1. Find the intersection of the two centerlines (as infinite lines).
 * 2. For each shape, determine which endpoint is closest to the intersection
 *    and move it to the intersection point.
 * 3. Set the end caps to 'miter' at the joined ends (for walls).
 * 4. Store the direction angle of the OTHER wall so the renderer can compute
 *    the angled polygon corners (miter cut along the bisector).
 *
 * The miterAngle stored on each wall is the direction angle (radians) of the
 * OTHER wall's centerline, pointing AWAY from the intersection. The renderer
 * uses this to calculate where the wall outline edges intersect, producing the
 * correct angled cut at any meeting angle.
 *
 * Returns updates for both shapes, or null if the shapes are parallel / not line-like.
 */
export function miterJoinWalls(
  shape1: Shape,
  shape2: Shape
): { shape1Update: Partial<Shape>; shape2Update: Partial<Shape> } | null {
  const ep1 = getLineEndpoints(shape1);
  const ep2 = getLineEndpoints(shape2);
  if (!ep1 || !ep2) return null;

  const bulge1 = getShapeBulge(shape1);
  const bulge2 = getShapeBulge(shape2);
  const hasArc = Math.abs(bulge1) > 0.0001 || Math.abs(bulge2) > 0.0001;

  // Find the junction point where the two shapes meet.
  // For straight-to-straight: use the line-line intersection of the infinite centerlines.
  // When either shape is an arc: use the shared (nearest) endpoint as the
  // intersection. Arc-line intersection is complex and unnecessary here because
  // miter joins happen when two walls share an endpoint.
  let intersection: Point | null;

  if (hasArc) {
    // Find the pair of endpoints (one from each shape) that are closest together
    // and use their midpoint as the junction.
    const pairs: { p1: Point; p2: Point; dist: number; s1AtStart: boolean; s2AtStart: boolean }[] = [
      { p1: ep1.start, p2: ep2.start, dist: Math.hypot(ep1.start.x - ep2.start.x, ep1.start.y - ep2.start.y), s1AtStart: true, s2AtStart: true },
      { p1: ep1.start, p2: ep2.end, dist: Math.hypot(ep1.start.x - ep2.end.x, ep1.start.y - ep2.end.y), s1AtStart: true, s2AtStart: false },
      { p1: ep1.end, p2: ep2.start, dist: Math.hypot(ep1.end.x - ep2.start.x, ep1.end.y - ep2.start.y), s1AtStart: false, s2AtStart: true },
      { p1: ep1.end, p2: ep2.end, dist: Math.hypot(ep1.end.x - ep2.end.x, ep1.end.y - ep2.end.y), s1AtStart: false, s2AtStart: false },
    ];
    pairs.sort((a, b) => a.dist - b.dist);
    const best = pairs[0];
    // Use the midpoint of the two closest endpoints as the junction
    intersection = { x: (best.p1.x + best.p2.x) / 2, y: (best.p1.y + best.p2.y) / 2 };
  } else {
    // Both straight: use classic line-line intersection
    intersection = lineLineIntersection(ep1.start, ep1.end, ep2.start, ep2.end);
    if (!intersection) return null; // Parallel lines, no miter possible
  }

  // Determine which endpoint of each shape should be moved to the intersection.
  // The nearest endpoint is the one that gets joined.
  const d1s = Math.hypot(intersection.x - ep1.start.x, intersection.y - ep1.start.y);
  const d1e = Math.hypot(intersection.x - ep1.end.x, intersection.y - ep1.end.y);
  const shape1JoinAtStart = d1s < d1e;

  const d2s = Math.hypot(intersection.x - ep2.start.x, intersection.y - ep2.start.y);
  const d2e = Math.hypot(intersection.x - ep2.end.x, intersection.y - ep2.end.y);
  const shape2JoinAtStart = d2s < d2e;

  // Build updates: move the nearest endpoint of each shape to the intersection
  const shape1Update: Record<string, any> = {};
  const shape2Update: Record<string, any> = {};

  if (shape1JoinAtStart) {
    shape1Update.start = intersection;
  } else {
    shape1Update.end = intersection;
  }

  if (shape2JoinAtStart) {
    shape2Update.start = intersection;
  } else {
    shape2Update.end = intersection;
  }

  // Compute the direction angle of each wall's centerline pointing AWAY from the
  // intersection. For straight walls this is the simple atan2 from the junction
  // toward the far endpoint. For arc walls (bulge != 0) this is the tangent
  // direction at the junction endpoint, pointing along the arc away from the join.
  //
  // The miterAngle stored on each wall is the direction of the OTHER wall's
  // centerline away from the intersection. The renderer uses this to compute
  // the angled polygon corners (miter cut along the bisector).

  const angle1Away = getAwayDirection(ep1.start, ep1.end, shape1JoinAtStart, bulge1, intersection);
  const angle2Away = getAwayDirection(ep2.start, ep2.end, shape2JoinAtStart, bulge2, intersection);

  // For wall shapes: set the end cap at the joined end to 'miter' and store the
  // other wall's direction angle so the renderer can compute the angled cut.
  if (shape1.type === 'wall') {
    if (shape1JoinAtStart) {
      shape1Update.startCap = 'miter';
      // Store direction of wall2 (the other wall) away from intersection
      shape1Update.startMiterAngle = angle2Away;
    } else {
      shape1Update.endCap = 'miter';
      shape1Update.endMiterAngle = angle2Away;
    }
  }

  if (shape2.type === 'wall') {
    if (shape2JoinAtStart) {
      shape2Update.startCap = 'miter';
      // Store direction of wall1 (the other wall) away from intersection
      shape2Update.startMiterAngle = angle1Away;
    } else {
      shape2Update.endCap = 'miter';
      shape2Update.endMiterAngle = angle1Away;
    }
  }

  // For beam shapes: same miter logic as walls
  if (shape1.type === 'beam') {
    if (shape1JoinAtStart) {
      shape1Update.startCap = 'miter';
      shape1Update.startMiterAngle = angle2Away;
    } else {
      shape1Update.endCap = 'miter';
      shape1Update.endMiterAngle = angle2Away;
    }
  }

  if (shape2.type === 'beam') {
    if (shape2JoinAtStart) {
      shape2Update.startCap = 'miter';
      shape2Update.startMiterAngle = angle1Away;
    } else {
      shape2Update.endCap = 'miter';
      shape2Update.endMiterAngle = angle1Away;
    }
  }

  return {
    shape1Update: shape1Update as Partial<Shape>,
    shape2Update: shape2Update as Partial<Shape>,
  };
}

/**
 * After a wall/beam with miter angles is moved, stretched, or otherwise modified,
 * find its connected miter partner(s) among allShapes and re-run miterJoinWalls()
 * to recalculate both walls' miter angles.
 *
 * Returns an array of { id, updates } entries that should be applied to the store.
 * The array includes updates for both the modified shape AND its partner(s).
 *
 * The caller must pass the ALREADY-UPDATED version of `modifiedShape` (i.e. with
 * its new start/end positions), along with all shapes from the store (which may
 * still have the old version of modifiedShape -- that's fine, we use modifiedShape directly).
 */
export function recalculateMiterJoins(
  modifiedShape: Shape,
  allShapes: Shape[],
  tolerance: number = 1.0,
): { id: string; updates: Partial<Shape> }[] {
  if (modifiedShape.type !== 'wall' && modifiedShape.type !== 'beam') return [];

  const ms = modifiedShape as WallShape;
  const hasStartMiter = ms.startMiterAngle !== undefined && ms.startCap === 'miter';
  const hasEndMiter = ms.endMiterAngle !== undefined && ms.endCap === 'miter';

  if (!hasStartMiter && !hasEndMiter) return [];

  const results: { id: string; updates: Partial<Shape> }[] = [];
  const wallsAndBeams = allShapes.filter(
    s => (s.type === 'wall' || s.type === 'beam') && s.id !== modifiedShape.id
  );

  // Helper: find the partner wall/beam whose endpoint is nearest to a junction point
  const findPartner = (junctionPoint: Point): Shape | null => {
    let best: Shape | null = null;
    let bestDist = tolerance;
    for (const s of wallsAndBeams) {
      const ep = s as any as { start: Point; end: Point };
      const dStart = Math.hypot(ep.start.x - junctionPoint.x, ep.start.y - junctionPoint.y);
      const dEnd = Math.hypot(ep.end.x - junctionPoint.x, ep.end.y - junctionPoint.y);
      const d = Math.min(dStart, dEnd);
      if (d < bestDist) {
        bestDist = d;
        best = s;
      }
    }
    return best;
  };

  // Re-miter at start
  if (hasStartMiter) {
    const partner = findPartner(ms.start);
    if (partner) {
      const miterResult = miterJoinWalls(modifiedShape, partner);
      if (miterResult) {
        results.push({ id: modifiedShape.id, updates: miterResult.shape1Update });
        results.push({ id: partner.id, updates: miterResult.shape2Update });
      }
    }
  }

  // Re-miter at end
  if (hasEndMiter) {
    const partner = findPartner(ms.end);
    if (partner) {
      // Check if we already re-mitered with this partner at start
      const alreadyHandled = results.some(r => r.id === partner.id);
      if (!alreadyHandled) {
        const miterResult = miterJoinWalls(modifiedShape, partner);
        if (miterResult) {
          // Merge with any existing update for modifiedShape
          const existingIdx = results.findIndex(r => r.id === modifiedShape.id);
          if (existingIdx >= 0) {
            results[existingIdx].updates = { ...(results[existingIdx].updates as any), ...(miterResult.shape1Update as any) };
          } else {
            results.push({ id: modifiedShape.id, updates: miterResult.shape1Update });
          }
          results.push({ id: partner.id, updates: miterResult.shape2Update });
        }
      }
    }
  }

  return results;
}

/**
 * Offset a shape by a given distance on a given side.
 * Returns a new shape (deep-cloned with new ID).
 */
export function offsetShape(shape: Shape, distance: number, cursorPos: Point, flip?: boolean): Shape | null {
  const cloned: Shape = JSON.parse(JSON.stringify(shape));
  (cloned as any).id = generateId();

  switch (cloned.type) {
    case 'line': {
      const dx = cloned.end.x - cloned.start.x;
      const dy = cloned.end.y - cloned.start.y;
      const len = Math.hypot(dx, dy);
      if (len < 1e-10) return null;
      const nx = -dy / len;
      const ny = dx / len;
      // Determine side from cursor
      const midX = (cloned.start.x + cloned.end.x) / 2;
      const midY = (cloned.start.y + cloned.end.y) / 2;
      const dotSide = (cursorPos.x - midX) * nx + (cursorPos.y - midY) * ny;
      const sign = (dotSide >= 0 ? 1 : -1) * (flip ? -1 : 1);
      cloned.start = { x: cloned.start.x + nx * distance * sign, y: cloned.start.y + ny * distance * sign };
      cloned.end = { x: cloned.end.x + nx * distance * sign, y: cloned.end.y + ny * distance * sign };
      return cloned;
    }
    case 'circle': {
      const dToCenter = Math.hypot(cursorPos.x - cloned.center.x, cursorPos.y - cloned.center.y);
      const isOutsideCircle = flip ? (dToCenter <= cloned.radius) : (dToCenter > cloned.radius);
      if (isOutsideCircle) {
        cloned.radius += distance;
      } else {
        cloned.radius = Math.max(0.1, cloned.radius - distance);
      }
      return cloned;
    }
    case 'arc': {
      const dToCenter = Math.hypot(cursorPos.x - cloned.center.x, cursorPos.y - cloned.center.y);
      const isOutsideArc = flip ? (dToCenter <= cloned.radius) : (dToCenter > cloned.radius);
      if (isOutsideArc) {
        cloned.radius += distance;
      } else {
        cloned.radius = Math.max(0.1, cloned.radius - distance);
      }
      return cloned;
    }
    case 'ellipse': {
      const dToCenter = Math.hypot(cursorPos.x - cloned.center.x, cursorPos.y - cloned.center.y);
      const avgRadius = (cloned.radiusX + cloned.radiusY) / 2;
      const isOutsideEllipse = flip ? (dToCenter <= avgRadius) : (dToCenter > avgRadius);
      if (isOutsideEllipse) {
        cloned.radiusX += distance;
        cloned.radiusY += distance;
      } else {
        cloned.radiusX = Math.max(0.1, cloned.radiusX - distance);
        cloned.radiusY = Math.max(0.1, cloned.radiusY - distance);
      }
      return cloned;
    }
    default:
      return null;
  }
}
