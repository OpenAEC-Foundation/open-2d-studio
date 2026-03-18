/**
 * SpaceDetector - Detects room contours from surrounding walls
 *
 * Algorithm:
 * 1. Collect all wall edge segments (left and right edges of each wall)
 * 2. Build a planar graph of connected wall edge segments
 * 3. From the click point, cast a ray to find the nearest wall edge
 * 4. Follow wall edges keeping the interior on one side
 * 5. When returning to the start, close the polygon
 *
 * This is a pragmatic first version that handles rectangular rooms
 * and simple L-shapes formed by walls.
 */

import type { Point, WallShape } from '../../types/geometry';

/** Epsilon for floating point comparisons */
const EPS = 1;

/** A directed edge segment from a wall outline */
interface EdgeSegment {
  start: Point;
  end: Point;
  wallId: string;
}

/**
 * Get the four corner points of a wall in plan view.
 * Returns [leftStart, leftEnd, rightEnd, rightStart] forming a rectangle.
 */
function getWallCorners(wall: WallShape): Point[] {
  const { start, end, thickness, justification } = wall;
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len < EPS) return [];

  // Perpendicular direction (to the left of direction vector)
  const px = -dy / len;
  const py = dx / len;

  let leftThick: number;
  let rightThick: number;

  if (justification === 'left') {
    // "Left justified" = left face on draw line, wall extends to the right
    leftThick = thickness;
    rightThick = 0;
  } else if (justification === 'right') {
    // "Right justified" = right face on draw line, wall extends to the left
    leftThick = 0;
    rightThick = thickness;
  } else {
    leftThick = thickness / 2;
    rightThick = thickness / 2;
  }

  return [
    { x: start.x + px * leftThick, y: start.y + py * leftThick },   // left-start
    { x: end.x + px * leftThick, y: end.y + py * leftThick },       // left-end
    { x: end.x - px * rightThick, y: end.y - py * rightThick },     // right-end
    { x: start.x - px * rightThick, y: start.y - py * rightThick }, // right-start
  ];
}

/**
 * Get the four edge segments of a wall outline (the four sides of the rectangle).
 */
function getWallEdgeSegments(wall: WallShape): EdgeSegment[] {
  // Skip arc walls for now - only handle straight walls
  if (wall.bulge && Math.abs(wall.bulge) > 0.0001) return [];

  const corners = getWallCorners(wall);
  if (corners.length < 4) return [];

  const segments: EdgeSegment[] = [];
  for (let i = 0; i < corners.length; i++) {
    const j = (i + 1) % corners.length;
    segments.push({
      start: corners[i],
      end: corners[j],
      wallId: wall.id,
    });
  }
  return segments;
}

/**
 * Compute intersection point of ray from `origin` in direction `dir` with segment AB.
 * Returns parameter t along the ray (positive = forward), or null if no intersection.
 */
function raySegmentIntersection(
  origin: Point,
  dir: Point,
  a: Point,
  b: Point
): number | null {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const denom = dir.x * dy - dir.y * dx;
  if (Math.abs(denom) < 1e-10) return null; // Parallel

  const t = ((a.x - origin.x) * dy - (a.y - origin.y) * dx) / denom;
  const u = ((a.x - origin.x) * dir.y - (a.y - origin.y) * dir.x) / denom;

  if (t > 1e-6 && u >= -1e-6 && u <= 1 + 1e-6) {
    return t;
  }
  return null;
}

/**
 * Line-segment intersection. Returns the intersection point or null.
 */
function segmentIntersection(
  a1: Point, a2: Point,
  b1: Point, b2: Point
): Point | null {
  const d1x = a2.x - a1.x;
  const d1y = a2.y - a1.y;
  const d2x = b2.x - b1.x;
  const d2y = b2.y - b1.y;

  const denom = d1x * d2y - d1y * d2x;
  if (Math.abs(denom) < 1e-10) return null;

  const t = ((b1.x - a1.x) * d2y - (b1.y - a1.y) * d2x) / denom;
  const u = ((b1.x - a1.x) * d1y - (b1.y - a1.y) * d1x) / denom;

  if (t >= -1e-6 && t <= 1 + 1e-6 && u >= -1e-6 && u <= 1 + 1e-6) {
    return {
      x: a1.x + t * d1x,
      y: a1.y + t * d1y,
    };
  }
  return null;
}

// Distance utility (available for future use in space detection refinement)
// function dist(a: Point, b: Point): number {
//   return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
// }

/**
 * Check if a point is inside a polygon using ray casting
 */
function pointInPolygon(point: Point, polygon: Point[]): boolean {
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
 * Compute the angle of a direction vector (atan2)
 */
function angleOf(dx: number, dy: number): number {
  return Math.atan2(dy, dx);
}

/**
 * Normalize angle to [0, 2*PI)
 */
function normalizeAngle(a: number): number {
  const TWO_PI = Math.PI * 2;
  let r = a % TWO_PI;
  if (r < 0) r += TWO_PI;
  return r;
}

/**
 * Detect the room contour at a click point by finding the smallest
 * enclosing polygon formed by wall edges.
 *
 * Algorithm (simplified planar face finding):
 * 1. Collect all wall edge segments and their intersections
 * 2. Build a planar subdivision (DCEL-like approach)
 * 3. From click point, ray-cast to find the nearest edge
 * 4. Walk around the face containing the click point
 *
 * Pragmatic approach:
 * - Cast rays in multiple directions from the click point
 * - For each ray, find the nearest wall edge intersection
 * - If we find intersections in all directions, we're enclosed
 * - Then trace the boundary by following wall edges
 */
export function detectSpaceContour(
  clickPoint: Point,
  walls: WallShape[]
): Point[] | null {
  // Filter to only space-bounding walls (spaceBounding undefined defaults to true)
  const boundingWalls = walls.filter(w => w.spaceBounding !== false);

  if (boundingWalls.length < 2) return null;

  // Collect all wall edge segments
  const allSegments: EdgeSegment[] = [];
  for (const wall of boundingWalls) {
    const segments = getWallEdgeSegments(wall);
    allSegments.push(...segments);
  }

  if (allSegments.length === 0) return null;

  // Split all segments at intersection points to form a proper planar graph
  const splitSegments = splitSegmentsAtIntersections(allSegments);

  // Build adjacency graph: for each vertex, store the outgoing edges sorted by angle
  const graph = buildPlanarGraph(splitSegments);

  // From click point, cast a ray to find the nearest edge
  // Use the right edge (the one to the right of the ray direction)
  const rayDir = { x: 1, y: 0 }; // Cast ray in +X direction
  let nearestT = Infinity;
  let nearestSeg: { start: Point; end: Point } | null = null;

  for (const seg of splitSegments) {
    const t = raySegmentIntersection(clickPoint, rayDir, seg.start, seg.end);
    if (t !== null && t < nearestT) {
      nearestT = t;
      nearestSeg = seg;
    }
  }

  if (!nearestSeg) return null;

  // The intersection point on the nearest edge (nearestT used for direction calculation below)
  // const hitPoint = { x: clickPoint.x + rayDir.x * nearestT, y: clickPoint.y + rayDir.y * nearestT };

  // We want to walk along the edge that has the interior (click point) on its left side.
  // The ray hits the segment; we need to determine which direction along the segment
  // keeps the interior on the left.
  // Since the ray goes in +X and hits the segment, the interior is below the segment
  // (in screen coordinates where Y increases downward, the click point is to the left of the ray hit).
  // We want to traverse the edge such that the interior is on the left side.

  // Determine direction: walk along the edge so click point is on the left
  const edgeDx = nearestSeg.end.x - nearestSeg.start.x;
  const edgeDy = nearestSeg.end.y - nearestSeg.start.y;
  // Cross product of edge direction with (clickPoint - edgeStart) direction
  const toClick = { x: clickPoint.x - nearestSeg.start.x, y: clickPoint.y - nearestSeg.start.y };
  const cross = edgeDx * toClick.y - edgeDy * toClick.x;

  // If cross > 0, click is to the right of the edge (start->end), so we go start->end
  // If cross < 0, click is to the left, so we go end->start
  let startVertex: string;
  let currentVertex: string;
  let prevAngle: number;

  if (cross >= 0) {
    // Walk from nearest segment start to end
    startVertex = vertexKey(nearestSeg.start);
    currentVertex = vertexKey(nearestSeg.end);
    prevAngle = angleOf(nearestSeg.end.x - nearestSeg.start.x, nearestSeg.end.y - nearestSeg.start.y);
  } else {
    // Walk from nearest segment end to start
    startVertex = vertexKey(nearestSeg.end);
    currentVertex = vertexKey(nearestSeg.start);
    prevAngle = angleOf(nearestSeg.start.x - nearestSeg.end.x, nearestSeg.start.y - nearestSeg.end.y);
  }

  // Now walk the face boundary by always turning right (clockwise) at each vertex
  const contour: Point[] = [parseVertexKey(startVertex)];
  let steps = 0;
  const maxSteps = splitSegments.length * 2 + 10;

  while (steps < maxSteps) {
    steps++;

    const edges = graph.get(currentVertex);
    if (!edges || edges.length === 0) return null;

    // Find the next edge: the one that makes the smallest clockwise turn from our incoming direction
    // Incoming direction angle (reversed, since we arrived from prevAngle direction)
    const incomingAngle = normalizeAngle(prevAngle + Math.PI);

    // Sort edges by angle relative to incoming direction (clockwise = decreasing angle)
    // We want the first edge clockwise from the incoming direction
    let bestEdge: { target: string; angle: number } | null = null;
    let bestDelta = Infinity;

    for (const edge of edges) {
      if (edge.target === currentVertex) continue; // Skip self-loops

      // Angle difference: how much we turn clockwise from incoming
      let delta = normalizeAngle(incomingAngle - edge.angle);
      if (delta < 1e-6) delta = Math.PI * 2; // Don't go back the way we came (unless it's the only option)

      if (delta < bestDelta) {
        bestDelta = delta;
        bestEdge = edge;
      }
    }

    if (!bestEdge) return null;

    const nextVertex = bestEdge.target;
    contour.push(parseVertexKey(currentVertex));

    if (nextVertex === startVertex) {
      // Closed the loop!
      break;
    }

    prevAngle = bestEdge.angle;
    currentVertex = nextVertex;
  }

  if (contour.length < 3) return null;

  // Verify the click point is inside the contour
  if (!pointInPolygon(clickPoint, contour)) {
    // Try the opposite winding
    contour.reverse();
    if (!pointInPolygon(clickPoint, contour)) {
      return null;
    }
  }

  // Compute area to filter out degenerate polygons
  const area = computePolygonArea(contour);
  if (area < 100) return null; // Too small (< 100 mm^2)

  return contour;
}

/**
 * Compute the area of a polygon using the shoelace formula
 */
export function computePolygonArea(points: Point[]): number {
  let area = 0;
  for (let i = 0; i < points.length; i++) {
    const j = (i + 1) % points.length;
    area += points[i].x * points[j].y;
    area -= points[j].x * points[i].y;
  }
  return Math.abs(area) / 2;
}

/**
 * Compute the centroid of a polygon
 */
export function computePolygonCentroid(points: Point[]): Point {
  let cx = 0;
  let cy = 0;
  let area = 0;

  for (let i = 0; i < points.length; i++) {
    const j = (i + 1) % points.length;
    const cross = points[i].x * points[j].y - points[j].x * points[i].y;
    cx += (points[i].x + points[j].x) * cross;
    cy += (points[i].y + points[j].y) * cross;
    area += cross;
  }

  area /= 2;
  if (Math.abs(area) < 1e-10) {
    // Fallback: simple average
    const avgX = points.reduce((s, p) => s + p.x, 0) / points.length;
    const avgY = points.reduce((s, p) => s + p.y, 0) / points.length;
    return { x: avgX, y: avgY };
  }

  cx /= (6 * area);
  cy /= (6 * area);
  return { x: cx, y: cy };
}

/**
 * Create a vertex key from a point (rounded for matching)
 */
function vertexKey(p: Point): string {
  return `${Math.round(p.x * 10) / 10},${Math.round(p.y * 10) / 10}`;
}

/**
 * Parse a vertex key back to a point
 */
function parseVertexKey(key: string): Point {
  const [x, y] = key.split(',').map(Number);
  return { x, y };
}

/**
 * Split all segments at their mutual intersection points.
 * This creates a proper planar subdivision where segments only meet at endpoints.
 */
function splitSegmentsAtIntersections(segments: EdgeSegment[]): EdgeSegment[] {
  // For each segment, collect all intersection parameters
  const splitParams: Map<number, number[]> = new Map();

  for (let i = 0; i < segments.length; i++) {
    splitParams.set(i, []);
  }

  for (let i = 0; i < segments.length; i++) {
    for (let j = i + 1; j < segments.length; j++) {
      const ip = segmentIntersection(
        segments[i].start, segments[i].end,
        segments[j].start, segments[j].end
      );
      if (ip) {
        // Compute parameters for both segments
        const si = segments[i];
        const sj = segments[j];

        const ti = paramOnSegment(si.start, si.end, ip);
        const tj = paramOnSegment(sj.start, sj.end, ip);

        if (ti > 0.001 && ti < 0.999) {
          splitParams.get(i)!.push(ti);
        }
        if (tj > 0.001 && tj < 0.999) {
          splitParams.get(j)!.push(tj);
        }
      }
    }
  }

  // Split each segment at its intersection parameters
  const result: EdgeSegment[] = [];

  for (let i = 0; i < segments.length; i++) {
    const params = splitParams.get(i)!;
    if (params.length === 0) {
      result.push(segments[i]);
      continue;
    }

    // Sort parameters
    params.sort((a, b) => a - b);
    // Add endpoints
    const allT = [0, ...params, 1];

    const seg = segments[i];
    const dx = seg.end.x - seg.start.x;
    const dy = seg.end.y - seg.start.y;

    for (let k = 0; k < allT.length - 1; k++) {
      const t0 = allT[k];
      const t1 = allT[k + 1];
      if (t1 - t0 < 0.001) continue;

      result.push({
        start: {
          x: seg.start.x + dx * t0,
          y: seg.start.y + dy * t0,
        },
        end: {
          x: seg.start.x + dx * t1,
          y: seg.start.y + dy * t1,
        },
        wallId: seg.wallId,
      });
    }
  }

  return result;
}

/**
 * Compute parameter t of point P on segment AB (0 = A, 1 = B)
 */
function paramOnSegment(a: Point, b: Point, p: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 < 1e-10) return 0;
  return ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
}

/**
 * Build a planar graph from segments.
 * For each vertex, stores outgoing edges sorted by angle.
 */
function buildPlanarGraph(
  segments: EdgeSegment[]
): Map<string, { target: string; angle: number }[]> {
  const graph = new Map<string, { target: string; angle: number }[]>();

  const addEdge = (from: Point, to: Point) => {
    const fromKey = vertexKey(from);
    const toKey = vertexKey(to);
    if (fromKey === toKey) return;

    if (!graph.has(fromKey)) {
      graph.set(fromKey, []);
    }
    const angle = angleOf(to.x - from.x, to.y - from.y);

    // Check for duplicate edges
    const edges = graph.get(fromKey)!;
    const exists = edges.some(e => e.target === toKey && Math.abs(e.angle - angle) < 1e-6);
    if (!exists) {
      edges.push({ target: toKey, angle });
    }
  };

  for (const seg of segments) {
    addEdge(seg.start, seg.end);
    addEdge(seg.end, seg.start);
  }

  // Sort edges at each vertex by angle
  for (const [, edges] of graph) {
    edges.sort((a, b) => a.angle - b.angle);
  }

  return graph;
}
