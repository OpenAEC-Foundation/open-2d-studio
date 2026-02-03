/**
 * Geometry Generators
 *
 * Functions that generate polyline geometry from parametric shape parameters.
 * Each generator takes parameter values and returns a GeneratedGeometry object.
 */

import type { Point } from '../../types/geometry';
import type { ProfileType, ParameterValues, GeneratedGeometry, ArcSegmentInfo } from '../../types/parametric';

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Transform a point by rotation and translation
 */
function transformPoint(
  point: Point,
  _center: Point,
  rotation: number,
  scale: number,
  position: Point
): Point {
  // Scale from origin (center parameter reserved for future use)
  const scaledX = point.x * scale;
  const scaledY = point.y * scale;

  // Rotate around origin
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  const rotatedX = scaledX * cos - scaledY * sin;
  const rotatedY = scaledX * sin + scaledY * cos;

  // Translate to position
  return {
    x: rotatedX + position.x,
    y: rotatedY + position.y,
  };
}

/**
 * Transform an array of points
 */
function transformPoints(
  points: Point[],
  center: Point,
  rotation: number,
  scale: number,
  position: Point
): Point[] {
  return points.map(p => transformPoint(p, center, rotation, scale, position));
}

/**
 * Calculate bounds from points
 */
function calculateBounds(points: Point[]): { minX: number; minY: number; maxX: number; maxY: number } {
  if (points.length === 0) {
    return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  }
  const xs = points.map(p => p.x);
  const ys = points.map(p => p.y);
  return {
    minX: Math.min(...xs),
    minY: Math.min(...ys),
    maxX: Math.max(...xs),
    maxY: Math.max(...ys),
  };
}

/**
 * Arc generation result with both points and metadata
 */
interface ArcResult {
  points: Point[];
  info: {
    centerX: number;
    centerY: number;
    radius: number;
    startAngle: number;
    endAngle: number;
  };
}

/**
 * Generate arc points for fillets and return arc info
 */
function generateArcPoints(
  centerX: number,
  centerY: number,
  radius: number,
  startAngle: number,
  endAngle: number,
  segments: number = 8
): Point[] {
  if (radius <= 0) return [];
  const points: Point[] = [];
  const angleStep = (endAngle - startAngle) / segments;
  for (let i = 0; i <= segments; i++) {
    const angle = startAngle + i * angleStep;
    points.push({
      x: centerX + radius * Math.cos(angle),
      y: centerY + radius * Math.sin(angle),
    });
  }
  return points;
}

/**
 * Generate arc points with metadata for proper explosion
 */
function generateArcWithInfo(
  centerX: number,
  centerY: number,
  radius: number,
  startAngle: number,
  endAngle: number,
  segments: number = 8
): ArcResult {
  return {
    points: generateArcPoints(centerX, centerY, radius, startAngle, endAngle, segments),
    info: { centerX, centerY, radius, startAngle, endAngle },
  };
}

/**
 * Transform arc info by rotation and position
 */
function transformArcInfo(
  info: ArcResult['info'],
  rotation: number,
  scale: number,
  position: Point
): { center: Point; radius: number; startAngle: number; endAngle: number } {
  // Scale the radius
  const scaledRadius = info.radius * scale;

  // Scale and rotate the center point
  const scaledCenterX = info.centerX * scale;
  const scaledCenterY = info.centerY * scale;
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  const rotatedCenterX = scaledCenterX * cos - scaledCenterY * sin;
  const rotatedCenterY = scaledCenterX * sin + scaledCenterY * cos;

  // Translate to position
  const center = {
    x: rotatedCenterX + position.x,
    y: rotatedCenterY + position.y,
  };

  // Adjust angles by rotation
  const startAngle = info.startAngle + rotation;
  const endAngle = info.endAngle + rotation;

  return { center, radius: scaledRadius, startAngle, endAngle };
}

/**
 * Generate circle points
 */
function generateCirclePoints(
  centerX: number,
  centerY: number,
  radius: number,
  segments: number = 32
): Point[] {
  return generateArcPoints(centerX, centerY, radius, 0, Math.PI * 2 - 0.001, segments);
}

// ============================================================================
// I-Beam Generator
// ============================================================================

function generateIBeamGeometry(
  params: ParameterValues,
  position: Point,
  rotation: number,
  scale: number
): GeneratedGeometry {
  const h = params.height as number;
  const bf = params.flangeWidth as number;
  const tw = params.webThickness as number;
  const tf = params.flangeThickness as number;
  const r = params.filletRadius as number || 0;

  // Generate outline centered at origin
  // Y-up coordinate system: +halfH is top, -halfH is bottom
  const halfH = h / 2;
  const halfBf = bf / 2;
  const halfTw = tw / 2;

  const outline: Point[] = [];
  const arcInfos: ArcResult['info'][] = [];
  const arcIndices: { startIndex: number; infoIndex: number }[] = [];

  // Start at top-left corner of top flange, go clockwise
  // 1. Top flange - top edge (left to right)
  outline.push({ x: -halfBf, y: halfH });
  outline.push({ x: halfBf, y: halfH });

  // 2. Top flange - right edge going down
  outline.push({ x: halfBf, y: halfH - tf });

  // 3. Top flange inner edge (right) going toward web with fillet
  if (r > 0) {
    outline.push({ x: halfTw + r, y: halfH - tf });
    const startIdx = outline.length;
    const arc = generateArcWithInfo(halfTw + r, halfH - tf - r, r, Math.PI / 2, Math.PI, 6);
    outline.push(...arc.points);
    arcInfos.push(arc.info);
    arcIndices.push({ startIndex: startIdx, infoIndex: arcInfos.length - 1 });
  } else {
    outline.push({ x: halfTw, y: halfH - tf });
  }

  // 4. Web - right side going down with fillet at bottom
  if (r > 0) {
    outline.push({ x: halfTw, y: -halfH + tf + r });
    const startIdx = outline.length;
    const arc = generateArcWithInfo(halfTw + r, -halfH + tf + r, r, Math.PI, Math.PI * 1.5, 6);
    outline.push(...arc.points);
    arcInfos.push(arc.info);
    arcIndices.push({ startIndex: startIdx, infoIndex: arcInfos.length - 1 });
  } else {
    outline.push({ x: halfTw, y: -halfH + tf });
  }

  // 5. Bottom flange inner edge (right) going outward
  outline.push({ x: halfBf, y: -halfH + tf });

  // 6. Bottom flange - right edge going down
  outline.push({ x: halfBf, y: -halfH });

  // 7. Bottom flange - bottom edge going left
  outline.push({ x: -halfBf, y: -halfH });

  // 8. Bottom flange - left edge going up
  outline.push({ x: -halfBf, y: -halfH + tf });

  // 9. Bottom flange inner edge (left) going toward web with fillet
  if (r > 0) {
    outline.push({ x: -halfTw - r, y: -halfH + tf });
    const startIdx = outline.length;
    const arc = generateArcWithInfo(-halfTw - r, -halfH + tf + r, r, Math.PI * 1.5, Math.PI * 2, 6);
    outline.push(...arc.points);
    arcInfos.push(arc.info);
    arcIndices.push({ startIndex: startIdx, infoIndex: arcInfos.length - 1 });
  } else {
    outline.push({ x: -halfTw, y: -halfH + tf });
  }

  // 10. Web - left side going up with fillet at top
  if (r > 0) {
    outline.push({ x: -halfTw, y: halfH - tf - r });
    const startIdx = outline.length;
    const arc = generateArcWithInfo(-halfTw - r, halfH - tf - r, r, 0, Math.PI / 2, 6);
    outline.push(...arc.points);
    arcInfos.push(arc.info);
    arcIndices.push({ startIndex: startIdx, infoIndex: arcInfos.length - 1 });
  } else {
    outline.push({ x: -halfTw, y: halfH - tf });
  }

  // 11. Top flange inner edge (left) going outward
  outline.push({ x: -halfBf, y: halfH - tf });

  // Path closes back to starting point

  // Transform all points
  const center = { x: 0, y: 0 };
  const transformedOutline = transformPoints(outline, center, rotation, scale, position);

  // Build arc segment info with transformed coordinates
  const arcSegments: ArcSegmentInfo[] = arcIndices.map(({ startIndex, infoIndex }) => {
    const info = arcInfos[infoIndex];
    const transformed = transformArcInfo(info, rotation, scale, position);
    return {
      startIndex,
      endIndex: startIndex + 6, // 6 segments = 7 points, but last point is shared
      center: transformed.center,
      radius: transformed.radius,
      startAngle: transformed.startAngle,
      endAngle: transformed.endAngle,
    };
  });

  return {
    outlines: [transformedOutline],
    closed: [true],
    center: position,
    bounds: calculateBounds(transformedOutline),
    generatedAt: Date.now(),
    arcSegments: arcSegments.length > 0 ? [arcSegments] : undefined,
  };
}

// ============================================================================
// Channel Generator
// ============================================================================

function generateChannelGeometry(
  params: ParameterValues,
  position: Point,
  rotation: number,
  scale: number
): GeneratedGeometry {
  const h = params.height as number;
  const bf = params.flangeWidth as number;
  const tw = params.webThickness as number;
  const tf = params.flangeThickness as number;
  const r = params.filletRadius as number || 0;

  const halfH = h / 2;
  const centerOffset = bf / 2;

  const outline: Point[] = [];
  const arcInfos: ArcResult['info'][] = [];
  const arcIndices: { startIndex: number; infoIndex: number }[] = [];

  // C-channel opening to the right, centered vertically
  // Start at top-left (web outer corner), go counterclockwise

  // 1. Web outer edge - going down
  outline.push({ x: 0, y: halfH });
  outline.push({ x: 0, y: -halfH });

  // 2. Bottom flange outer edge going right
  outline.push({ x: bf, y: -halfH });

  // 3. Bottom flange right edge going up
  outline.push({ x: bf, y: -halfH + tf });

  // 4. Bottom flange inner edge going left toward web with fillet
  if (r > 0) {
    outline.push({ x: tw + r, y: -halfH + tf });
    const startIdx = outline.length;
    const arc = generateArcWithInfo(tw + r, -halfH + tf + r, r, Math.PI * 1.5, Math.PI, 6);
    outline.push(...arc.points);
    arcInfos.push(arc.info);
    arcIndices.push({ startIndex: startIdx, infoIndex: arcInfos.length - 1 });
  } else {
    outline.push({ x: tw, y: -halfH + tf });
  }

  // 5. Web inner edge going up with fillet at top
  if (r > 0) {
    outline.push({ x: tw, y: halfH - tf - r });
    const startIdx = outline.length;
    const arc = generateArcWithInfo(tw + r, halfH - tf - r, r, Math.PI, Math.PI / 2, 6);
    outline.push(...arc.points);
    arcInfos.push(arc.info);
    arcIndices.push({ startIndex: startIdx, infoIndex: arcInfos.length - 1 });
  } else {
    outline.push({ x: tw, y: halfH - tf });
  }

  // 6. Top flange inner edge going right
  outline.push({ x: bf, y: halfH - tf });

  // 7. Top flange right edge going up
  outline.push({ x: bf, y: halfH });

  // Path closes back to starting point

  // Center the shape horizontally
  const centeredOutline = outline.map(p => ({ x: p.x - centerOffset, y: p.y }));
  // Also offset arc centers
  const centeredArcInfos = arcInfos.map(info => ({
    ...info,
    centerX: info.centerX - centerOffset,
  }));

  const center = { x: 0, y: 0 };
  const transformedOutline = transformPoints(centeredOutline, center, rotation, scale, position);

  // Build arc segment info with transformed coordinates
  const arcSegments: ArcSegmentInfo[] = arcIndices.map(({ startIndex, infoIndex }) => {
    const info = centeredArcInfos[infoIndex];
    const transformed = transformArcInfo(info, rotation, scale, position);
    return {
      startIndex,
      endIndex: startIndex + 6,
      center: transformed.center,
      radius: transformed.radius,
      startAngle: transformed.startAngle,
      endAngle: transformed.endAngle,
    };
  });

  return {
    outlines: [transformedOutline],
    closed: [true],
    center: position,
    bounds: calculateBounds(transformedOutline),
    generatedAt: Date.now(),
    arcSegments: arcSegments.length > 0 ? [arcSegments] : undefined,
  };
}

// ============================================================================
// Angle Generator
// ============================================================================

function generateAngleGeometry(
  params: ParameterValues,
  position: Point,
  rotation: number,
  scale: number
): GeneratedGeometry {
  const leg1 = params.leg1 as number; // Vertical leg
  const leg2 = params.leg2 as number; // Horizontal leg
  const t = params.thickness as number;
  const r = params.filletRadius as number || 0;

  const cx = leg2 / 3;
  const cy = leg1 / 3;

  const outline: Point[] = [];
  const arcInfos: ArcResult['info'][] = [];
  const arcIndices: { startIndex: number; infoIndex: number }[] = [];

  // L-angle: vertical leg going up, horizontal leg going right
  // Corner at origin, trace clockwise starting from bottom-left

  // 1. Bottom edge of horizontal leg (left to right)
  outline.push({ x: 0, y: 0 });
  outline.push({ x: leg2, y: 0 });

  // 2. Right edge of horizontal leg going up
  outline.push({ x: leg2, y: t });

  // 3. Top edge of horizontal leg going left toward inner corner with fillet
  if (r > 0) {
    outline.push({ x: t + r, y: t });
    const startIdx = outline.length;
    const arc = generateArcWithInfo(t + r, t + r, r, Math.PI * 1.5, Math.PI, 6);
    outline.push(...arc.points);
    arcInfos.push(arc.info);
    arcIndices.push({ startIndex: startIdx, infoIndex: arcInfos.length - 1 });
  } else {
    outline.push({ x: t, y: t });
  }

  // 4. Inner edge of vertical leg going up
  outline.push({ x: t, y: leg1 });

  // 5. Top edge of vertical leg
  outline.push({ x: 0, y: leg1 });

  // Path closes back to starting point

  // Center at centroid (approximate for L-shape)
  const centeredOutline = outline.map(p => ({ x: p.x - cx, y: p.y - cy }));
  const centeredArcInfos = arcInfos.map(info => ({
    ...info,
    centerX: info.centerX - cx,
    centerY: info.centerY - cy,
  }));

  const center = { x: 0, y: 0 };
  const transformedOutline = transformPoints(centeredOutline, center, rotation, scale, position);

  // Build arc segment info
  const arcSegments: ArcSegmentInfo[] = arcIndices.map(({ startIndex, infoIndex }) => {
    const info = centeredArcInfos[infoIndex];
    const transformed = transformArcInfo(info, rotation, scale, position);
    return {
      startIndex,
      endIndex: startIndex + 6,
      center: transformed.center,
      radius: transformed.radius,
      startAngle: transformed.startAngle,
      endAngle: transformed.endAngle,
    };
  });

  return {
    outlines: [transformedOutline],
    closed: [true],
    center: position,
    bounds: calculateBounds(transformedOutline),
    generatedAt: Date.now(),
    arcSegments: arcSegments.length > 0 ? [arcSegments] : undefined,
  };
}

// ============================================================================
// Tee Generator
// ============================================================================

function generateTeeGeometry(
  params: ParameterValues,
  position: Point,
  rotation: number,
  scale: number
): GeneratedGeometry {
  const h = params.height as number;
  const bf = params.flangeWidth as number;
  const tw = params.stemThickness as number;
  const tf = params.flangeThickness as number;
  const r = params.filletRadius as number || 0;

  const halfBf = bf / 2;
  const halfTw = tw / 2;
  const cy = h / 2;

  const outline: Point[] = [];
  const arcInfos: ArcResult['info'][] = [];
  const arcIndices: { startIndex: number; infoIndex: number }[] = [];

  // T-shape with flange at top, stem going down
  // Start top-left outer corner, go clockwise (Y-up: 0 is top of flange)

  // 1. Flange top edge
  outline.push({ x: -halfBf, y: 0 });
  outline.push({ x: halfBf, y: 0 });

  // 2. Flange right edge going down
  outline.push({ x: halfBf, y: tf });

  // 3. Flange bottom edge (right side) going toward stem
  if (r > 0) {
    outline.push({ x: halfTw + r, y: tf });
    const startIdx = outline.length;
    const arc = generateArcWithInfo(halfTw + r, tf + r, r, Math.PI * 1.5, Math.PI, 6);
    outline.push(...arc.points);
    arcInfos.push(arc.info);
    arcIndices.push({ startIndex: startIdx, infoIndex: arcInfos.length - 1 });
  } else {
    outline.push({ x: halfTw, y: tf });
  }

  // 4. Stem right side going down
  outline.push({ x: halfTw, y: h });

  // 5. Stem bottom edge
  outline.push({ x: -halfTw, y: h });

  // 6. Stem left side going up
  if (r > 0) {
    outline.push({ x: -halfTw, y: tf + r });
    const startIdx = outline.length;
    const arc = generateArcWithInfo(-halfTw - r, tf + r, r, 0, -Math.PI / 2, 6);
    outline.push(...arc.points);
    arcInfos.push(arc.info);
    arcIndices.push({ startIndex: startIdx, infoIndex: arcInfos.length - 1 });
  } else {
    outline.push({ x: -halfTw, y: tf });
  }

  // 7. Flange bottom edge (left side)
  outline.push({ x: -halfBf, y: tf });

  // Path closes back to starting point

  // Center at geometric center
  const centeredOutline = outline.map(p => ({ x: p.x, y: p.y - cy }));
  const centeredArcInfos = arcInfos.map(info => ({
    ...info,
    centerY: info.centerY - cy,
  }));

  const center = { x: 0, y: 0 };
  const transformedOutline = transformPoints(centeredOutline, center, rotation, scale, position);

  // Build arc segment info
  const arcSegments: ArcSegmentInfo[] = arcIndices.map(({ startIndex, infoIndex }) => {
    const info = centeredArcInfos[infoIndex];
    const transformed = transformArcInfo(info, rotation, scale, position);
    return {
      startIndex,
      endIndex: startIndex + 6,
      center: transformed.center,
      radius: transformed.radius,
      startAngle: transformed.startAngle,
      endAngle: transformed.endAngle,
    };
  });

  return {
    outlines: [transformedOutline],
    closed: [true],
    center: position,
    bounds: calculateBounds(transformedOutline),
    generatedAt: Date.now(),
    arcSegments: arcSegments.length > 0 ? [arcSegments] : undefined,
  };
}

// ============================================================================
// HSS Rectangular Generator
// ============================================================================

function generateHSSRectGeometry(
  params: ParameterValues,
  position: Point,
  rotation: number,
  scale: number
): GeneratedGeometry {
  const h = params.height as number;
  const w = params.width as number;
  const t = params.wallThickness as number;
  const r = params.cornerRadius as number || 0;

  const halfH = h / 2;
  const halfW = w / 2;

  // Outer outline with rounded corners
  const outerOutline: Point[] = [];
  const outerArcInfos: ArcResult['info'][] = [];
  const outerArcIndices: { startIndex: number; infoIndex: number }[] = [];
  const rOuter = Math.min(r, halfH, halfW);

  if (rOuter > 0) {
    // Top edge
    outerOutline.push({ x: -halfW + rOuter, y: -halfH });
    outerOutline.push({ x: halfW - rOuter, y: -halfH });
    // Top-right corner
    let startIdx = outerOutline.length;
    let arc = generateArcWithInfo(halfW - rOuter, -halfH + rOuter, rOuter, -Math.PI / 2, 0, 6);
    outerOutline.push(...arc.points);
    outerArcInfos.push(arc.info);
    outerArcIndices.push({ startIndex: startIdx, infoIndex: outerArcInfos.length - 1 });
    // Right edge
    outerOutline.push({ x: halfW, y: halfH - rOuter });
    // Bottom-right corner
    startIdx = outerOutline.length;
    arc = generateArcWithInfo(halfW - rOuter, halfH - rOuter, rOuter, 0, Math.PI / 2, 6);
    outerOutline.push(...arc.points);
    outerArcInfos.push(arc.info);
    outerArcIndices.push({ startIndex: startIdx, infoIndex: outerArcInfos.length - 1 });
    // Bottom edge
    outerOutline.push({ x: -halfW + rOuter, y: halfH });
    // Bottom-left corner
    startIdx = outerOutline.length;
    arc = generateArcWithInfo(-halfW + rOuter, halfH - rOuter, rOuter, Math.PI / 2, Math.PI, 6);
    outerOutline.push(...arc.points);
    outerArcInfos.push(arc.info);
    outerArcIndices.push({ startIndex: startIdx, infoIndex: outerArcInfos.length - 1 });
    // Left edge
    outerOutline.push({ x: -halfW, y: -halfH + rOuter });
    // Top-left corner
    startIdx = outerOutline.length;
    arc = generateArcWithInfo(-halfW + rOuter, -halfH + rOuter, rOuter, Math.PI, Math.PI * 1.5, 6);
    outerOutline.push(...arc.points);
    outerArcInfos.push(arc.info);
    outerArcIndices.push({ startIndex: startIdx, infoIndex: outerArcInfos.length - 1 });
  } else {
    outerOutline.push({ x: -halfW, y: -halfH });
    outerOutline.push({ x: halfW, y: -halfH });
    outerOutline.push({ x: halfW, y: halfH });
    outerOutline.push({ x: -halfW, y: halfH });
  }

  // Inner outline
  const innerOutline: Point[] = [];
  const innerArcInfos: ArcResult['info'][] = [];
  const innerArcIndices: { startIndex: number; infoIndex: number }[] = [];
  const innerHalfH = halfH - t;
  const innerHalfW = halfW - t;
  const rInner = Math.max(0, rOuter - t);

  if (rInner > 0) {
    innerOutline.push({ x: -innerHalfW + rInner, y: -innerHalfH });
    innerOutline.push({ x: innerHalfW - rInner, y: -innerHalfH });
    let startIdx = innerOutline.length;
    let arc = generateArcWithInfo(innerHalfW - rInner, -innerHalfH + rInner, rInner, -Math.PI / 2, 0, 6);
    innerOutline.push(...arc.points);
    innerArcInfos.push(arc.info);
    innerArcIndices.push({ startIndex: startIdx, infoIndex: innerArcInfos.length - 1 });

    innerOutline.push({ x: innerHalfW, y: innerHalfH - rInner });
    startIdx = innerOutline.length;
    arc = generateArcWithInfo(innerHalfW - rInner, innerHalfH - rInner, rInner, 0, Math.PI / 2, 6);
    innerOutline.push(...arc.points);
    innerArcInfos.push(arc.info);
    innerArcIndices.push({ startIndex: startIdx, infoIndex: innerArcInfos.length - 1 });

    innerOutline.push({ x: -innerHalfW + rInner, y: innerHalfH });
    startIdx = innerOutline.length;
    arc = generateArcWithInfo(-innerHalfW + rInner, innerHalfH - rInner, rInner, Math.PI / 2, Math.PI, 6);
    innerOutline.push(...arc.points);
    innerArcInfos.push(arc.info);
    innerArcIndices.push({ startIndex: startIdx, infoIndex: innerArcInfos.length - 1 });

    innerOutline.push({ x: -innerHalfW, y: -innerHalfH + rInner });
    startIdx = innerOutline.length;
    arc = generateArcWithInfo(-innerHalfW + rInner, -innerHalfH + rInner, rInner, Math.PI, Math.PI * 1.5, 6);
    innerOutline.push(...arc.points);
    innerArcInfos.push(arc.info);
    innerArcIndices.push({ startIndex: startIdx, infoIndex: innerArcInfos.length - 1 });
  } else {
    innerOutline.push({ x: -innerHalfW, y: -innerHalfH });
    innerOutline.push({ x: innerHalfW, y: -innerHalfH });
    innerOutline.push({ x: innerHalfW, y: innerHalfH });
    innerOutline.push({ x: -innerHalfW, y: innerHalfH });
  }

  const center = { x: 0, y: 0 };
  const transformedOuter = transformPoints(outerOutline, center, rotation, scale, position);
  const transformedInner = transformPoints(innerOutline, center, rotation, scale, position);

  const allPoints = [...transformedOuter, ...transformedInner];

  // Build arc segment info for outer
  const outerArcSegments: ArcSegmentInfo[] = outerArcIndices.map(({ startIndex, infoIndex }) => {
    const info = outerArcInfos[infoIndex];
    const transformed = transformArcInfo(info, rotation, scale, position);
    return {
      startIndex,
      endIndex: startIndex + 6,
      center: transformed.center,
      radius: transformed.radius,
      startAngle: transformed.startAngle,
      endAngle: transformed.endAngle,
    };
  });

  // Build arc segment info for inner
  const innerArcSegments: ArcSegmentInfo[] = innerArcIndices.map(({ startIndex, infoIndex }) => {
    const info = innerArcInfos[infoIndex];
    const transformed = transformArcInfo(info, rotation, scale, position);
    return {
      startIndex,
      endIndex: startIndex + 6,
      center: transformed.center,
      radius: transformed.radius,
      startAngle: transformed.startAngle,
      endAngle: transformed.endAngle,
    };
  });

  const hasArcs = outerArcSegments.length > 0 || innerArcSegments.length > 0;

  return {
    outlines: [transformedOuter, transformedInner],
    closed: [true, true],
    center: position,
    bounds: calculateBounds(allPoints),
    generatedAt: Date.now(),
    arcSegments: hasArcs ? [outerArcSegments, innerArcSegments] : undefined,
  };
}

// ============================================================================
// HSS Round Generator
// ============================================================================

function generateHSSRoundGeometry(
  params: ParameterValues,
  position: Point,
  rotation: number,
  scale: number
): GeneratedGeometry {
  const d = params.diameter as number;
  const t = params.wallThickness as number;

  const outerR = d / 2;
  const innerR = outerR - t;

  const outerOutline = generateCirclePoints(0, 0, outerR, 48);
  const innerOutline = innerR > 0 ? generateCirclePoints(0, 0, innerR, 48) : [];

  const center = { x: 0, y: 0 };
  const transformedOuter = transformPoints(outerOutline, center, rotation, scale, position);
  const transformedInner = innerR > 0 ? transformPoints(innerOutline, center, rotation, scale, position) : [];

  const allPoints = [...transformedOuter, ...transformedInner];

  // Full circle arcs (spanning entire outline)
  const outerArcInfo = transformArcInfo(
    { centerX: 0, centerY: 0, radius: outerR, startAngle: 0, endAngle: Math.PI * 2 },
    rotation, scale, position
  );
  const outerArcSegment: ArcSegmentInfo = {
    startIndex: 0,
    endIndex: transformedOuter.length - 1,
    center: outerArcInfo.center,
    radius: outerArcInfo.radius,
    startAngle: outerArcInfo.startAngle,
    endAngle: outerArcInfo.endAngle,
  };

  const arcSegments: ArcSegmentInfo[][] = [[outerArcSegment]];

  if (innerR > 0) {
    const innerArcInfo = transformArcInfo(
      { centerX: 0, centerY: 0, radius: innerR, startAngle: 0, endAngle: Math.PI * 2 },
      rotation, scale, position
    );
    const innerArcSegment: ArcSegmentInfo = {
      startIndex: 0,
      endIndex: transformedInner.length - 1,
      center: innerArcInfo.center,
      radius: innerArcInfo.radius,
      startAngle: innerArcInfo.startAngle,
      endAngle: innerArcInfo.endAngle,
    };
    arcSegments.push([innerArcSegment]);
  }

  return {
    outlines: innerR > 0 ? [transformedOuter, transformedInner] : [transformedOuter],
    closed: innerR > 0 ? [true, true] : [true],
    center: position,
    bounds: calculateBounds(allPoints),
    generatedAt: Date.now(),
    arcSegments,
  };
}

// ============================================================================
// Plate Generator
// ============================================================================

function generatePlateGeometry(
  params: ParameterValues,
  position: Point,
  rotation: number,
  scale: number
): GeneratedGeometry {
  const w = params.width as number;
  const t = params.thickness as number;

  const halfW = w / 2;
  const halfT = t / 2;

  const outline: Point[] = [
    { x: -halfW, y: -halfT },
    { x: halfW, y: -halfT },
    { x: halfW, y: halfT },
    { x: -halfW, y: halfT },
  ];

  const center = { x: 0, y: 0 };
  const transformedOutline = transformPoints(outline, center, rotation, scale, position);

  return {
    outlines: [transformedOutline],
    closed: [true],
    center: position,
    bounds: calculateBounds(transformedOutline),
    generatedAt: Date.now(),
  };
}

// ============================================================================
// Round Bar Generator
// ============================================================================

function generateRoundBarGeometry(
  params: ParameterValues,
  position: Point,
  rotation: number,
  scale: number
): GeneratedGeometry {
  const d = params.diameter as number;
  const r = d / 2;

  const outline = generateCirclePoints(0, 0, r, 48);

  const center = { x: 0, y: 0 };
  const transformedOutline = transformPoints(outline, center, rotation, scale, position);

  // Full circle arc
  const arcInfo = transformArcInfo(
    { centerX: 0, centerY: 0, radius: r, startAngle: 0, endAngle: Math.PI * 2 },
    rotation, scale, position
  );
  const arcSegment: ArcSegmentInfo = {
    startIndex: 0,
    endIndex: transformedOutline.length - 1,
    center: arcInfo.center,
    radius: arcInfo.radius,
    startAngle: arcInfo.startAngle,
    endAngle: arcInfo.endAngle,
  };

  return {
    outlines: [transformedOutline],
    closed: [true],
    center: position,
    bounds: calculateBounds(transformedOutline),
    generatedAt: Date.now(),
    arcSegments: [[arcSegment]],
  };
}

// ============================================================================
// Generator Registry
// ============================================================================

type GeneratorFunction = (
  params: ParameterValues,
  position: Point,
  rotation: number,
  scale: number
) => GeneratedGeometry;

const GEOMETRY_GENERATORS: Record<ProfileType, GeneratorFunction> = {
  'i-beam': generateIBeamGeometry,
  'channel': generateChannelGeometry,
  'angle': generateAngleGeometry,
  'tee': generateTeeGeometry,
  'hss-rect': generateHSSRectGeometry,
  'hss-round': generateHSSRoundGeometry,
  'plate': generatePlateGeometry,
  'round-bar': generateRoundBarGeometry,
  'custom': () => ({
    outlines: [],
    closed: [],
    center: { x: 0, y: 0 },
    bounds: { minX: 0, minY: 0, maxX: 0, maxY: 0 },
    generatedAt: Date.now(),
  }),
};

/**
 * Generate geometry for a profile type
 */
export function generateProfileGeometry(
  profileType: ProfileType,
  parameters: ParameterValues,
  position: Point,
  rotation: number = 0,
  scale: number = 1
): GeneratedGeometry {
  const generator = GEOMETRY_GENERATORS[profileType];
  if (!generator) {
    throw new Error(`Unknown profile type: ${profileType}`);
  }
  return generator(parameters, position, rotation, scale);
}

/**
 * Regenerate geometry for an existing parametric shape
 */
export function regenerateGeometry(
  profileType: ProfileType,
  parameters: ParameterValues,
  position: Point,
  rotation: number,
  scale: number
): GeneratedGeometry {
  return generateProfileGeometry(profileType, parameters, position, rotation, scale);
}
