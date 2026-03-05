import type {
  Point,
  Shape,
  SnapType,
  SnapPoint,
  LineShape,
  RectangleShape,
  CircleShape,
  ArcShape,
  EllipseShape,
  PolylineShape,
  BeamShape,
  WallShape,
} from '../../types/geometry';
import { bulgeArcMidpoint, bulgeToArc } from './GeometryUtils';
import { snapProviderRegistry } from '../registry/SnapProviderRegistry';

// Distance between two points
export function distance(p1: Point, p2: Point): number {
  return Math.sqrt((p2.x - p1.x) ** 2 + (p2.y - p1.y) ** 2);
}

// Calculate line angle (direction from start to end)
function getLineAngle(shape: LineShape): number {
  const dx = shape.end.x - shape.start.x;
  const dy = shape.end.y - shape.start.y;
  return Math.atan2(dy, dx);
}

// Get endpoint snap points from a line
function getLineEndpoints(shape: LineShape): SnapPoint[] {
  const angle = getLineAngle(shape);
  return [
    { point: shape.start, type: 'endpoint', sourceShapeId: shape.id, sourceAngle: angle },
    { point: shape.end, type: 'endpoint', sourceShapeId: shape.id, sourceAngle: angle },
  ];
}

// Get midpoint snap point from a line
function getLineMidpoint(shape: LineShape): SnapPoint[] {
  const angle = getLineAngle(shape);
  return [
    {
      point: {
        x: (shape.start.x + shape.end.x) / 2,
        y: (shape.start.y + shape.end.y) / 2,
      },
      type: 'midpoint',
      sourceShapeId: shape.id,
      sourceAngle: angle,
    },
  ];
}

// Get nearest point on a line segment
function getNearestPointOnLine(shape: LineShape, cursor: Point): SnapPoint[] {
  const { start, end } = shape;
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSq = dx * dx + dy * dy;
  const angle = getLineAngle(shape);

  if (lengthSq === 0) {
    return [{ point: start, type: 'nearest', sourceShapeId: shape.id, sourceAngle: angle }];
  }

  let t = ((cursor.x - start.x) * dx + (cursor.y - start.y) * dy) / lengthSq;
  t = Math.max(0, Math.min(1, t));

  return [
    {
      point: {
        x: start.x + t * dx,
        y: start.y + t * dy,
      },
      type: 'nearest',
      sourceShapeId: shape.id,
      sourceAngle: angle,
    },
  ];
}

// Get perpendicular snap point from basePoint to line
// This finds the point on the line where a perpendicular from basePoint would land
// Only returns if such a point exists on the line segment
function getPerpendicularToLine(shape: LineShape, _cursor: Point, basePoint?: Point): SnapPoint[] {
  // Perpendicular snap only works when we have a base point (during drawing)
  if (!basePoint) return [];

  const { start, end } = shape;
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSq = dx * dx + dy * dy;

  if (lengthSq === 0) return [];

  // Find perpendicular point from basePoint to the line
  const t = ((basePoint.x - start.x) * dx + (basePoint.y - start.y) * dy) / lengthSq;

  // Only return if perpendicular point is on the line segment
  if (t < 0 || t > 1) return [];

  const angle = getLineAngle(shape);

  return [
    {
      point: {
        x: start.x + t * dx,
        y: start.y + t * dy,
      },
      type: 'perpendicular',
      sourceShapeId: shape.id,
      sourceAngle: angle,
    },
  ];
}

// Get rectangle corner endpoints
function getRectangleEndpoints(shape: RectangleShape): SnapPoint[] {
  const { topLeft, width, height, rotation } = shape;
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);

  // Calculate all four corners
  const corners = [
    { x: 0, y: 0 },
    { x: width, y: 0 },
    { x: width, y: height },
    { x: 0, y: height },
  ];

  return corners.map((corner) => ({
    point: {
      x: topLeft.x + corner.x * cos - corner.y * sin,
      y: topLeft.y + corner.x * sin + corner.y * cos,
    },
    type: 'endpoint' as SnapType,
    sourceShapeId: shape.id,
  }));
}

// Get rectangle edge midpoints
function getRectangleMidpoints(shape: RectangleShape): SnapPoint[] {
  const { topLeft, width, height, rotation } = shape;
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);

  const midpoints = [
    { x: width / 2, y: 0 },
    { x: width, y: height / 2 },
    { x: width / 2, y: height },
    { x: 0, y: height / 2 },
  ];

  return midpoints.map((mp) => ({
    point: {
      x: topLeft.x + mp.x * cos - mp.y * sin,
      y: topLeft.y + mp.x * sin + mp.y * cos,
    },
    type: 'midpoint' as SnapType,
    sourceShapeId: shape.id,
  }));
}

// Get rectangle center
function getRectangleCenter(shape: RectangleShape): SnapPoint[] {
  const { topLeft, width, height, rotation } = shape;
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);

  const cx = width / 2;
  const cy = height / 2;

  return [
    {
      point: {
        x: topLeft.x + cx * cos - cy * sin,
        y: topLeft.y + cx * sin + cy * cos,
      },
      type: 'center',
      sourceShapeId: shape.id,
    },
  ];
}

// Get circle center
function getCircleCenter(shape: CircleShape): SnapPoint[] {
  return [{ point: shape.center, type: 'center', sourceShapeId: shape.id }];
}

// Get circle quadrant points (0, 90, 180, 270 degrees)
function getCircleQuadrants(shape: CircleShape): SnapPoint[] {
  const { center, radius } = shape;
  return [
    { point: { x: center.x + radius, y: center.y }, type: 'endpoint', sourceShapeId: shape.id },
    { point: { x: center.x, y: center.y - radius }, type: 'endpoint', sourceShapeId: shape.id },
    { point: { x: center.x - radius, y: center.y }, type: 'endpoint', sourceShapeId: shape.id },
    { point: { x: center.x, y: center.y + radius }, type: 'endpoint', sourceShapeId: shape.id },
  ];
}

// Get nearest point on circle
function getNearestPointOnCircle(shape: CircleShape, cursor: Point): SnapPoint[] {
  const { center, radius } = shape;
  const dx = cursor.x - center.x;
  const dy = cursor.y - center.y;
  const dist = Math.sqrt(dx * dx + dy * dy);

  if (dist === 0) {
    return [{ point: { x: center.x + radius, y: center.y }, type: 'nearest', sourceShapeId: shape.id }];
  }

  return [
    {
      point: {
        x: center.x + (dx / dist) * radius,
        y: center.y + (dy / dist) * radius,
      },
      type: 'nearest',
      sourceShapeId: shape.id,
    },
  ];
}

// Get tangent points from cursor to circle
function getTangentToCircle(shape: CircleShape, cursor: Point): SnapPoint[] {
  const { center, radius } = shape;
  const dx = cursor.x - center.x;
  const dy = cursor.y - center.y;
  const dist = Math.sqrt(dx * dx + dy * dy);

  // Cursor must be outside the circle for tangent points
  if (dist <= radius) return [];

  const angle = Math.atan2(dy, dx);
  const tangentAngle = Math.acos(radius / dist);

  return [
    {
      point: {
        x: center.x + radius * Math.cos(angle + tangentAngle),
        y: center.y + radius * Math.sin(angle + tangentAngle),
      },
      type: 'tangent',
      sourceShapeId: shape.id,
    },
    {
      point: {
        x: center.x + radius * Math.cos(angle - tangentAngle),
        y: center.y + radius * Math.sin(angle - tangentAngle),
      },
      type: 'tangent',
      sourceShapeId: shape.id,
    },
  ];
}

// Get arc endpoints
function getArcEndpoints(shape: ArcShape): SnapPoint[] {
  const { center, radius, startAngle, endAngle } = shape;
  return [
    {
      point: {
        x: center.x + radius * Math.cos(startAngle),
        y: center.y + radius * Math.sin(startAngle),
      },
      type: 'endpoint',
      sourceShapeId: shape.id,
    },
    {
      point: {
        x: center.x + radius * Math.cos(endAngle),
        y: center.y + radius * Math.sin(endAngle),
      },
      type: 'endpoint',
      sourceShapeId: shape.id,
    },
  ];
}

// Get arc center
function getArcCenter(shape: ArcShape): SnapPoint[] {
  return [{ point: shape.center, type: 'center', sourceShapeId: shape.id }];
}

// Get arc midpoint
function getArcMidpoint(shape: ArcShape): SnapPoint[] {
  const { center, radius, startAngle, endAngle } = shape;
  let midAngle = (startAngle + endAngle) / 2;

  // Handle arc crossing 0 degrees
  if (endAngle < startAngle) {
    midAngle = (startAngle + endAngle + 2 * Math.PI) / 2;
    if (midAngle > 2 * Math.PI) midAngle -= 2 * Math.PI;
  }

  return [
    {
      point: {
        x: center.x + radius * Math.cos(midAngle),
        y: center.y + radius * Math.sin(midAngle),
      },
      type: 'midpoint',
      sourceShapeId: shape.id,
    },
  ];
}

// Get ellipse center
function getEllipseCenter(shape: EllipseShape): SnapPoint[] {
  return [{ point: shape.center, type: 'center', sourceShapeId: shape.id }];
}

// Get ellipse quadrant points
function getEllipseQuadrants(shape: EllipseShape): SnapPoint[] {
  const { center, radiusX, radiusY, rotation } = shape;
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);

  const quadrants = [
    { x: radiusX, y: 0 },
    { x: 0, y: -radiusY },
    { x: -radiusX, y: 0 },
    { x: 0, y: radiusY },
  ];

  return quadrants.map((q) => ({
    point: {
      x: center.x + q.x * cos - q.y * sin,
      y: center.y + q.x * sin + q.y * cos,
    },
    type: 'endpoint' as SnapType,
    sourceShapeId: shape.id,
  }));
}

// Get polyline endpoints
function getPolylineEndpoints(shape: PolylineShape): SnapPoint[] {
  const points = shape.points;
  if (points.length === 0) return [];

  const endpoints: SnapPoint[] = [];

  // All vertices are endpoints
  points.forEach((point, index) => {
    endpoints.push({ point, type: 'endpoint', sourceShapeId: shape.id, pointIndex: index });
  });

  return endpoints;
}

// Get polyline segment midpoints
function getPolylineMidpoints(shape: PolylineShape): SnapPoint[] {
  const points = shape.points;
  if (points.length < 2) return [];

  const midpoints: SnapPoint[] = [];

  for (let i = 0; i < points.length - 1; i++) {
    const b = shape.bulge?.[i] ?? 0;
    if (b !== 0) {
      midpoints.push({
        point: bulgeArcMidpoint(points[i], points[i + 1], b),
        type: 'midpoint',
        sourceShapeId: shape.id,
      });
    } else {
      midpoints.push({
        point: {
          x: (points[i].x + points[i + 1].x) / 2,
          y: (points[i].y + points[i + 1].y) / 2,
        },
        type: 'midpoint',
        sourceShapeId: shape.id,
      });
    }
  }

  // If closed, add midpoint of closing segment
  if (shape.closed && points.length >= 2) {
    const last = points[points.length - 1];
    const first = points[0];
    const closingBulge = shape.bulge?.[points.length - 1] ?? 0;
    if (closingBulge !== 0) {
      midpoints.push({
        point: bulgeArcMidpoint(last, first, closingBulge),
        type: 'midpoint',
        sourceShapeId: shape.id,
      });
    } else {
      midpoints.push({
        point: {
          x: (last.x + first.x) / 2,
          y: (last.y + first.y) / 2,
        },
        type: 'midpoint',
        sourceShapeId: shape.id,
      });
    }
  }

  return midpoints;
}

// Calculate beam angle (direction from start to end)
export function getBeamAngle(shape: BeamShape): number {
  const dx = shape.end.x - shape.start.x;
  const dy = shape.end.y - shape.start.y;
  return Math.atan2(dy, dx);
}

// Get beam endpoints (centerline endpoints)
export function getBeamEndpoints(shape: BeamShape): SnapPoint[] {
  const angle = getBeamAngle(shape);
  return [
    { point: shape.start, type: 'endpoint', sourceShapeId: shape.id, sourceAngle: angle },
    { point: shape.end, type: 'endpoint', sourceShapeId: shape.id, sourceAngle: angle },
  ];
}

// Calculate beam corner points (four corners of the beam rectangle in plan view)
export function getBeamCorners(shape: BeamShape): Point[] {
  const { start, end, flangeWidth } = shape;
  const halfWidth = flangeWidth / 2;

  // Calculate beam direction
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const length = Math.sqrt(dx * dx + dy * dy);

  if (length === 0) {
    return [start, start, start, start];
  }

  // Unit vector along beam and perpendicular
  const ux = dx / length;
  const uy = dy / length;
  const px = -uy; // perpendicular x
  const py = ux;  // perpendicular y

  // Four corners: start-left, start-right, end-right, end-left
  return [
    { x: start.x + px * halfWidth, y: start.y + py * halfWidth },  // start-left
    { x: start.x - px * halfWidth, y: start.y - py * halfWidth },  // start-right
    { x: end.x - px * halfWidth, y: end.y - py * halfWidth },      // end-right
    { x: end.x + px * halfWidth, y: end.y + py * halfWidth },      // end-left
  ];
}

// Get beam corner snap points (four corners of beam rectangle)
export function getBeamCornerEndpoints(shape: BeamShape): SnapPoint[] {
  const corners = getBeamCorners(shape);
  const angle = getBeamAngle(shape);
  return corners.map(corner => ({
    point: corner,
    type: 'endpoint' as SnapType,
    sourceShapeId: shape.id,
    sourceAngle: angle,
  }));
}

// Get beam midpoint (centerline midpoint)
export function getBeamMidpoint(shape: BeamShape): SnapPoint[] {
  const angle = getBeamAngle(shape);
  return [
    {
      point: {
        x: (shape.start.x + shape.end.x) / 2,
        y: (shape.start.y + shape.end.y) / 2,
      },
      type: 'midpoint',
      sourceShapeId: shape.id,
      sourceAngle: angle,
    },
  ];
}

// Get beam flange edge midpoints (midpoint of each side line)
export function getBeamFlangeMidpoints(shape: BeamShape): SnapPoint[] {
  const corners = getBeamCorners(shape);
  const angle = getBeamAngle(shape);
  // Left flange midpoint (between start-left and end-left)
  const leftMid = {
    x: (corners[0].x + corners[3].x) / 2,
    y: (corners[0].y + corners[3].y) / 2,
  };
  // Right flange midpoint (between start-right and end-right)
  const rightMid = {
    x: (corners[1].x + corners[2].x) / 2,
    y: (corners[1].y + corners[2].y) / 2,
  };

  return [
    { point: leftMid, type: 'midpoint', sourceShapeId: shape.id, sourceAngle: angle },
    { point: rightMid, type: 'midpoint', sourceShapeId: shape.id, sourceAngle: angle },
  ];
}

// Get nearest point on beam (including flange lines, not just centerline)
export function getNearestPointOnBeam(shape: BeamShape, cursor: Point): SnapPoint[] {
  const corners = getBeamCorners(shape);
  const snapPoints: SnapPoint[] = [];

  // Helper to get nearest point on a line segment
  const nearestOnSegment = (p1: Point, p2: Point): Point => {
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const lengthSq = dx * dx + dy * dy;

    if (lengthSq === 0) return p1;

    let t = ((cursor.x - p1.x) * dx + (cursor.y - p1.y) * dy) / lengthSq;
    t = Math.max(0, Math.min(1, t));

    return {
      x: p1.x + t * dx,
      y: p1.y + t * dy,
    };
  };

  // Check all four edges of the beam rectangle
  const edges = [
    { start: corners[0], end: corners[3] }, // left flange
    { start: corners[1], end: corners[2] }, // right flange
    { start: corners[0], end: corners[1] }, // start cap
    { start: corners[3], end: corners[2] }, // end cap
  ];

  let nearestPoint: Point | null = null;
  let nearestDist = Infinity;

  edges.forEach(edge => {
    const nearest = nearestOnSegment(edge.start, edge.end);
    const dist = distance(cursor, nearest);
    if (dist < nearestDist) {
      nearestDist = dist;
      nearestPoint = nearest;
    }
  });

  // Also check centerline
  const { start, end } = shape;
  const centerNearest = nearestOnSegment(start, end);
  const centerDist = distance(cursor, centerNearest);
  if (centerDist < nearestDist) {
    nearestPoint = centerNearest;
  }

  if (nearestPoint) {
    const angle = getBeamAngle(shape);
    snapPoints.push({
      point: nearestPoint,
      type: 'nearest',
      sourceShapeId: shape.id,
      sourceAngle: angle,
    });
  }

  return snapPoints;
}

// Get beam flange line segments (for intersection detection)
export function getBeamFlangeSegments(shape: BeamShape): { start: Point; end: Point }[] {
  const corners = getBeamCorners(shape);
  return [
    { start: corners[0], end: corners[3] }, // left flange line
    { start: corners[1], end: corners[2] }, // right flange line
    { start: corners[0], end: corners[1] }, // start cap
    { start: corners[3], end: corners[2] }, // end cap
  ];
}

// Calculate wall direction angle
export function getWallAngle(shape: WallShape): number {
  const dx = shape.end.x - shape.start.x;
  const dy = shape.end.y - shape.start.y;
  return Math.atan2(dy, dx);
}

// Calculate the four corner points of a wall rectangle, respecting justification
export function getWallCorners(shape: WallShape): Point[] {
  const { start, end, thickness, justification } = shape;
  const angle = getWallAngle(shape);

  // Perpendicular unit vector (rotated 90 degrees CCW from wall direction)
  const perpX = -Math.sin(angle);
  const perpY = Math.cos(angle);

  // Determine offsets based on justification:
  // perp = (-sin(a), cos(a)) = math-CCW-left = visual-right in screen coords (Y-down).
  // So +perp = visual right, -perp = visual left when looking from start to end.
  // For center: wall extends halfThick on each side of the centerline
  // For left: ALL thickness to the visual left (-perp side)
  // For right: ALL thickness to the visual right (+perp side)
  let offsetLeft: number; // distance along +perp direction (visual right side)
  let offsetRight: number; // distance along -perp direction (visual left side)
  const halfThick = thickness / 2;

  if (justification === 'left') {
    // Wall extends entirely to the visual left (-perp direction)
    offsetLeft = 0;
    offsetRight = thickness;
  } else if (justification === 'right') {
    // Wall extends entirely to the visual right (+perp direction)
    offsetLeft = thickness;
    offsetRight = 0;
  } else {
    // Center justified
    offsetLeft = halfThick;
    offsetRight = halfThick;
  }

  // Four corners: start-left, start-right, end-right, end-left
  // "left" = +perp direction, "right" = -perp direction
  return [
    { x: start.x + perpX * offsetLeft, y: start.y + perpY * offsetLeft },   // start-left
    { x: start.x - perpX * offsetRight, y: start.y - perpY * offsetRight }, // start-right
    { x: end.x - perpX * offsetRight, y: end.y - perpY * offsetRight },     // end-right
    { x: end.x + perpX * offsetLeft, y: end.y + perpY * offsetLeft },       // end-left
  ];
}

// Get wall corner snap points (four corners of the wall rectangle)
export function getWallCornerEndpoints(shape: WallShape): SnapPoint[] {
  const corners = getWallCorners(shape);
  const angle = getWallAngle(shape);
  return corners.map(corner => ({
    point: corner,
    type: 'endpoint' as SnapType,
    sourceShapeId: shape.id,
    sourceAngle: angle,
  }));
}

// Get wall edge midpoints (midpoint of each of the 4 edges)
export function getWallEdgeMidpoints(shape: WallShape): SnapPoint[] {
  const corners = getWallCorners(shape);
  const angle = getWallAngle(shape);

  // Edges: start-left to end-left (left long side), start-right to end-right (right long side),
  //        start-left to start-right (start cap), end-left to end-right (end cap)
  // corners: [start-left, start-right, end-right, end-left]
  const edges = [
    { a: corners[0], b: corners[3] }, // left long side (start-left to end-left)
    { a: corners[1], b: corners[2] }, // right long side (start-right to end-right)
    { a: corners[0], b: corners[1] }, // start cap (start-left to start-right)
    { a: corners[3], b: corners[2] }, // end cap (end-left to end-right)
  ];

  return edges.map(({ a, b }) => ({
    point: {
      x: (a.x + b.x) / 2,
      y: (a.y + b.y) / 2,
    },
    type: 'midpoint' as SnapType,
    sourceShapeId: shape.id,
    sourceAngle: angle,
  }));
}

// Get nearest point on wall outline (all 4 edges + centerline)
export function getNearestPointOnWall(shape: WallShape, cursor: Point): SnapPoint[] {
  const corners = getWallCorners(shape);
  const angle = getWallAngle(shape);

  // Helper to get nearest point on a line segment
  const nearestOnSegment = (p1: Point, p2: Point): Point => {
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const lengthSq = dx * dx + dy * dy;

    if (lengthSq === 0) return p1;

    let t = ((cursor.x - p1.x) * dx + (cursor.y - p1.y) * dy) / lengthSq;
    t = Math.max(0, Math.min(1, t));

    return {
      x: p1.x + t * dx,
      y: p1.y + t * dy,
    };
  };

  // All four edges of the wall rectangle
  // corners: [start-left, start-right, end-right, end-left]
  const edges = [
    { start: corners[0], end: corners[3] }, // left long side
    { start: corners[1], end: corners[2] }, // right long side
    { start: corners[0], end: corners[1] }, // start cap
    { start: corners[3], end: corners[2] }, // end cap
  ];

  let nearestPoint: Point | null = null;
  let nearestDist = Infinity;

  edges.forEach(edge => {
    const nearest = nearestOnSegment(edge.start, edge.end);
    const dist = distance(cursor, nearest);
    if (dist < nearestDist) {
      nearestDist = dist;
      nearestPoint = nearest;
    }
  });

  // Also check centerline
  const centerNearest = nearestOnSegment(shape.start, shape.end);
  const centerDist = distance(cursor, centerNearest);
  if (centerDist < nearestDist) {
    nearestPoint = centerNearest;
  }

  if (nearestPoint) {
    return [{
      point: nearestPoint,
      type: 'nearest',
      sourceShapeId: shape.id,
      sourceAngle: angle,
    }];
  }

  return [];
}

// Get wall outline segments (for intersection detection), respecting justification
export function getWallOutlineSegments(shape: WallShape): { start: Point; end: Point }[] {
  const corners = getWallCorners(shape);
  // corners: [start-left, start-right, end-right, end-left]
  return [
    { start: corners[0], end: corners[3] }, // left long side
    { start: corners[3], end: corners[2] }, // end cap
    { start: corners[2], end: corners[1] }, // right long side
    { start: corners[1], end: corners[0] }, // start cap
  ];
}

// Calculate line-line intersection
function lineLineIntersection(
  p1: Point,
  p2: Point,
  p3: Point,
  p4: Point
): Point | null {
  const denom = (p4.y - p3.y) * (p2.x - p1.x) - (p4.x - p3.x) * (p2.y - p1.y);
  if (Math.abs(denom) < 1e-10) return null; // Parallel lines

  const ua = ((p4.x - p3.x) * (p1.y - p3.y) - (p4.y - p3.y) * (p1.x - p3.x)) / denom;
  const ub = ((p2.x - p1.x) * (p1.y - p3.y) - (p2.y - p1.y) * (p1.x - p3.x)) / denom;

  // Check if intersection is within both line segments
  if (ua < 0 || ua > 1 || ub < 0 || ub > 1) return null;

  return {
    x: p1.x + ua * (p2.x - p1.x),
    y: p1.y + ua * (p2.y - p1.y),
  };
}

// Get all line segments from a shape (for intersection calculation)
function getShapeSegments(shape: Shape): { start: Point; end: Point }[] {
  switch (shape.type) {
    case 'line':
      return [{ start: shape.start, end: shape.end }];
    case 'rectangle': {
      const { topLeft, width, height, rotation } = shape;
      const cos = Math.cos(rotation);
      const sin = Math.sin(rotation);
      const corners = [
        { x: 0, y: 0 },
        { x: width, y: 0 },
        { x: width, y: height },
        { x: 0, y: height },
      ].map((c) => ({
        x: topLeft.x + c.x * cos - c.y * sin,
        y: topLeft.y + c.x * sin + c.y * cos,
      }));
      return [
        { start: corners[0], end: corners[1] },
        { start: corners[1], end: corners[2] },
        { start: corners[2], end: corners[3] },
        { start: corners[3], end: corners[0] },
      ];
    }
    case 'polyline': {
      const segments: { start: Point; end: Point }[] = [];
      const addArcSegments = (p1: Point, p2: Point, b: number) => {
        const arc = bulgeToArc(p1, p2, b);
        const steps = 16;
        let sweep = arc.clockwise
          ? arc.startAngle - arc.endAngle
          : arc.endAngle - arc.startAngle;
        if (sweep < 0) sweep += 2 * Math.PI;
        const dir = arc.clockwise ? -1 : 1;
        let prev = p1;
        for (let s = 1; s <= steps; s++) {
          const angle = arc.startAngle + dir * (sweep * s / steps);
          const next: Point = {
            x: arc.center.x + arc.radius * Math.cos(angle),
            y: arc.center.y + arc.radius * Math.sin(angle),
          };
          segments.push({ start: prev, end: next });
          prev = next;
        }
      };
      for (let i = 0; i < shape.points.length - 1; i++) {
        const b = shape.bulge?.[i] ?? 0;
        if (b !== 0) {
          addArcSegments(shape.points[i], shape.points[i + 1], b);
        } else {
          segments.push({ start: shape.points[i], end: shape.points[i + 1] });
        }
      }
      if (shape.closed && shape.points.length >= 2) {
        const closingB = shape.bulge?.[shape.points.length - 1] ?? 0;
        if (closingB !== 0) {
          addArcSegments(shape.points[shape.points.length - 1], shape.points[0], closingB);
        } else {
          segments.push({
            start: shape.points[shape.points.length - 1],
            end: shape.points[0],
          });
        }
      }
      return segments;
    }
    case 'hatch': {
      const segments: { start: Point; end: Point }[] = [];
      for (let i = 0; i < shape.points.length; i++) {
        const j = (i + 1) % shape.points.length;
        segments.push({ start: shape.points[i], end: shape.points[j] });
      }
      return segments;
    }
    default: {
      const extSegments = snapProviderRegistry.getSegments(shape.type);
      return extSegments ? extSegments(shape) : [];
    }
  }
}

// Get intersection snap points between shapes
export function getIntersectionPoints(shapes: Shape[]): SnapPoint[] {
  const intersections: SnapPoint[] = [];
  const allSegments: { segment: { start: Point; end: Point }; shapeId: string }[] = [];

  // Collect all line segments from all shapes
  shapes.forEach((shape) => {
    if (!shape.visible) return;
    getShapeSegments(shape).forEach((segment) => {
      allSegments.push({ segment, shapeId: shape.id });
    });
  });

  // Find intersections between all pairs of segments
  for (let i = 0; i < allSegments.length; i++) {
    for (let j = i + 1; j < allSegments.length; j++) {
      const seg1 = allSegments[i];
      const seg2 = allSegments[j];

      // Skip if same shape
      if (seg1.shapeId === seg2.shapeId) continue;

      const intersection = lineLineIntersection(
        seg1.segment.start,
        seg1.segment.end,
        seg2.segment.start,
        seg2.segment.end
      );

      if (intersection) {
        intersections.push({
          point: intersection,
          type: 'intersection',
          sourceShapeId: `${seg1.shapeId},${seg2.shapeId}`,
        });
      }
    }
  }

  return intersections;
}

// Get all snap points for a single shape
export function getShapeSnapPoints(
  shape: Shape,
  activeSnaps: SnapType[],
  cursor?: Point,
  basePoint?: Point
): SnapPoint[] {
  if (!shape.visible) return [];

  const snapPoints: SnapPoint[] = [];

  switch (shape.type) {
    case 'line':
      if (activeSnaps.includes('endpoint')) {
        snapPoints.push(...getLineEndpoints(shape));
      }
      if (activeSnaps.includes('midpoint')) {
        snapPoints.push(...getLineMidpoint(shape));
      }
      if (activeSnaps.includes('nearest') && cursor) {
        snapPoints.push(...getNearestPointOnLine(shape, cursor));
      }
      if (activeSnaps.includes('perpendicular') && cursor && basePoint) {
        snapPoints.push(...getPerpendicularToLine(shape, cursor, basePoint));
      }
      break;

    case 'rectangle':
      if (activeSnaps.includes('endpoint')) {
        snapPoints.push(...getRectangleEndpoints(shape));
      }
      if (activeSnaps.includes('midpoint')) {
        snapPoints.push(...getRectangleMidpoints(shape));
      }
      if (activeSnaps.includes('center')) {
        snapPoints.push(...getRectangleCenter(shape));
      }
      break;

    case 'circle':
      if (activeSnaps.includes('center')) {
        snapPoints.push(...getCircleCenter(shape));
      }
      if (activeSnaps.includes('endpoint')) {
        snapPoints.push(...getCircleQuadrants(shape));
      }
      if (activeSnaps.includes('nearest') && cursor) {
        snapPoints.push(...getNearestPointOnCircle(shape, cursor));
      }
      if (activeSnaps.includes('tangent') && cursor) {
        snapPoints.push(...getTangentToCircle(shape, cursor));
      }
      break;

    case 'arc':
      if (activeSnaps.includes('endpoint')) {
        snapPoints.push(...getArcEndpoints(shape));
      }
      if (activeSnaps.includes('center')) {
        snapPoints.push(...getArcCenter(shape));
      }
      if (activeSnaps.includes('midpoint')) {
        snapPoints.push(...getArcMidpoint(shape));
      }
      break;

    case 'ellipse':
      if (activeSnaps.includes('center')) {
        snapPoints.push(...getEllipseCenter(shape));
      }
      if (activeSnaps.includes('endpoint')) {
        snapPoints.push(...getEllipseQuadrants(shape));
      }
      break;

    case 'polyline':
    case 'spline':
      if (activeSnaps.includes('endpoint')) {
        snapPoints.push(...getPolylineEndpoints(shape as PolylineShape));
      }
      if (activeSnaps.includes('midpoint')) {
        snapPoints.push(...getPolylineMidpoints(shape as PolylineShape));
      }
      break;

    case 'point':
      if (activeSnaps.includes('endpoint')) {
        snapPoints.push({
          point: shape.position,
          type: 'endpoint',
          sourceShapeId: shape.id,
        });
      }
      break;

    case 'hatch':
      if (activeSnaps.includes('endpoint')) {
        shape.points.forEach((point, index) => {
          snapPoints.push({ point, type: 'endpoint', sourceShapeId: shape.id, pointIndex: index });
        });
      }
      if (activeSnaps.includes('midpoint')) {
        for (let i = 0; i < shape.points.length; i++) {
          const j = (i + 1) % shape.points.length;
          snapPoints.push({
            point: {
              x: (shape.points[i].x + shape.points[j].x) / 2,
              y: (shape.points[i].y + shape.points[j].y) / 2,
            },
            type: 'midpoint',
            sourceShapeId: shape.id,
          });
        }
      }
      break;

    default: {
      const extSnap = snapProviderRegistry.getSnap(shape.type);
      if (extSnap) {
        snapPoints.push(...extSnap(shape, activeSnaps, cursor, basePoint));
      }
      break;
    }
  }

  return snapPoints;
}

// Find the nearest snap point within tolerance
export function findNearestSnapPoint(
  cursor: Point,
  shapes: Shape[],
  activeSnaps: SnapType[],
  tolerance: number,
  gridSize: number,
  basePoint?: Point
): SnapPoint | null {
  const snapPoints: SnapPoint[] = [];

  // Get origin snap point if enabled
  if (activeSnaps.includes('origin')) {
    snapPoints.push({
      point: { x: 0, y: 0 },
      type: 'origin',
    });
  }

  // Get grid snap point if enabled
  if (activeSnaps.includes('grid')) {
    snapPoints.push({
      point: {
        x: Math.round(cursor.x / gridSize) * gridSize,
        y: Math.round(cursor.y / gridSize) * gridSize,
      },
      type: 'grid',
    });
  }

  // Get snap points from all shapes
  shapes.forEach((shape) => {
    snapPoints.push(...getShapeSnapPoints(shape, activeSnaps, cursor, basePoint));
  });

  // Get intersection points if enabled
  if (activeSnaps.includes('intersection')) {
    snapPoints.push(...getIntersectionPoints(shapes));
  }

  // Find the nearest snap point within tolerance
  let nearestSnap: SnapPoint | null = null;
  let nearestDistance = tolerance;

  // Priority order for snap types (higher priority wins when distances are close)
  const snapPriority: Record<SnapType, number> = {
    endpoint: 1,
    midpoint: 2,
    center: 3,
    intersection: 4,
    perpendicular: 5,
    parallel: 6,
    tangent: 7,
    nearest: 8,
    origin: 9,
    grid: 10,
  };

  snapPoints.forEach((snap) => {
    const dist = distance(cursor, snap.point);
    if (dist < nearestDistance) {
      nearestDistance = dist;
      nearestSnap = snap;
    } else if (dist < tolerance && nearestSnap && Math.abs(dist - nearestDistance) < 1) {
      // If distances are very close, use priority
      if (snapPriority[snap.type] < snapPriority[nearestSnap.type]) {
        nearestSnap = snap;
      }
    }
  });

  return nearestSnap;
}

// Get snap indicator symbol for display
export function getSnapSymbol(type: SnapType): string {
  switch (type) {
    case 'endpoint':
      return '□';
    case 'midpoint':
      return '△';
    case 'center':
      return '○';
    case 'intersection':
      return '×';
    case 'perpendicular':
      return '⊥';
    case 'parallel':
      return '∥';
    case 'tangent':
      return '◎';
    case 'nearest':
      return '◇';
    case 'grid':
      return '+';
    case 'origin':
      return '⊕';
    default:
      return '•';
  }
}

// Get snap type display name
export function getSnapTypeName(type: SnapType): string {
  switch (type) {
    case 'endpoint':
      return 'Endpoint';
    case 'midpoint':
      return 'Midpoint';
    case 'center':
      return 'Center';
    case 'intersection':
      return 'Intersection';
    case 'perpendicular':
      return 'Perpendicular';
    case 'parallel':
      return 'Parallel';
    case 'tangent':
      return 'Tangent';
    case 'nearest':
      return 'Nearest';
    case 'grid':
      return 'Grid';
    case 'origin':
      return 'Origin';
    default:
      return type;
  }
}
