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
} from '../types/geometry';

// Distance between two points
export function distance(p1: Point, p2: Point): number {
  return Math.sqrt((p2.x - p1.x) ** 2 + (p2.y - p1.y) ** 2);
}

// Get endpoint snap points from a line
function getLineEndpoints(shape: LineShape): SnapPoint[] {
  return [
    { point: shape.start, type: 'endpoint', sourceShapeId: shape.id },
    { point: shape.end, type: 'endpoint', sourceShapeId: shape.id },
  ];
}

// Get midpoint snap point from a line
function getLineMidpoint(shape: LineShape): SnapPoint[] {
  return [
    {
      point: {
        x: (shape.start.x + shape.end.x) / 2,
        y: (shape.start.y + shape.end.y) / 2,
      },
      type: 'midpoint',
      sourceShapeId: shape.id,
    },
  ];
}

// Get nearest point on a line segment
function getNearestPointOnLine(shape: LineShape, cursor: Point): SnapPoint[] {
  const { start, end } = shape;
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSq = dx * dx + dy * dy;

  if (lengthSq === 0) {
    return [{ point: start, type: 'nearest', sourceShapeId: shape.id }];
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
    },
  ];
}

// Get perpendicular snap point from cursor to line
function getPerpendicularToLine(shape: LineShape, cursor: Point): SnapPoint[] {
  const { start, end } = shape;
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSq = dx * dx + dy * dy;

  if (lengthSq === 0) return [];

  const t = ((cursor.x - start.x) * dx + (cursor.y - start.y) * dy) / lengthSq;

  // Only return if perpendicular point is on the line segment
  if (t < 0 || t > 1) return [];

  return [
    {
      point: {
        x: start.x + t * dx,
        y: start.y + t * dy,
      },
      type: 'perpendicular',
      sourceShapeId: shape.id,
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
    midpoints.push({
      point: {
        x: (points[i].x + points[i + 1].x) / 2,
        y: (points[i].y + points[i + 1].y) / 2,
      },
      type: 'midpoint',
      sourceShapeId: shape.id,
    });
  }

  // If closed, add midpoint of closing segment
  if (shape.closed && points.length >= 2) {
    const last = points[points.length - 1];
    const first = points[0];
    midpoints.push({
      point: {
        x: (last.x + first.x) / 2,
        y: (last.y + first.y) / 2,
      },
      type: 'midpoint',
      sourceShapeId: shape.id,
    });
  }

  return midpoints;
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
      for (let i = 0; i < shape.points.length - 1; i++) {
        segments.push({ start: shape.points[i], end: shape.points[i + 1] });
      }
      if (shape.closed && shape.points.length >= 2) {
        segments.push({
          start: shape.points[shape.points.length - 1],
          end: shape.points[0],
        });
      }
      return segments;
    }
    default:
      return [];
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
  cursor?: Point
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
      if (activeSnaps.includes('perpendicular') && cursor) {
        snapPoints.push(...getPerpendicularToLine(shape, cursor));
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
      if (activeSnaps.includes('endpoint')) {
        snapPoints.push(...getPolylineEndpoints(shape));
      }
      if (activeSnaps.includes('midpoint')) {
        snapPoints.push(...getPolylineMidpoints(shape));
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
  }

  return snapPoints;
}

// Find the nearest snap point within tolerance
export function findNearestSnapPoint(
  cursor: Point,
  shapes: Shape[],
  activeSnaps: SnapType[],
  tolerance: number,
  gridSize: number
): SnapPoint | null {
  const snapPoints: SnapPoint[] = [];

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
    snapPoints.push(...getShapeSnapPoints(shape, activeSnaps, cursor));
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
    tangent: 6,
    nearest: 7,
    grid: 8,
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
    case 'tangent':
      return '◎';
    case 'nearest':
      return '◇';
    case 'grid':
      return '+';
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
    case 'tangent':
      return 'Tangent';
    case 'nearest':
      return 'Nearest';
    case 'grid':
      return 'Grid';
    default:
      return type;
  }
}
