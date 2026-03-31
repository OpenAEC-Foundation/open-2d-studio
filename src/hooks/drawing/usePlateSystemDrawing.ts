/**
 * usePlateSystemDrawing - Handles plate system drawing as a closed polygon contour.
 *
 * Drawing interaction:
 * - Multi-click to define contour boundary vertices (like slab drawing - polygon)
 * - In arc mode (shapeMode === 'arc'), each edge needs 3 clicks: start, point-on-arc, end
 *   The bulge is calculated via calculateBulgeFrom3Points().
 * - Right-click to finish (auto-closes the polygon)
 * - Creates a PlateSystemShape with joists automatically filled based on settings
 * - Also generates individual BeamShape children (joists + edge beams) that are
 *   individually selectable and linked to the parent PlateSystemShape
 */

import { useCallback, useRef } from 'react';
import { useAppStore, generateId } from '../../state/appStore';
import type {
  Point,
  Shape,
  BeamShape,
  BeamMaterial,
  PlateSystemShape,
  PlateSystemMainProfile,
  PlateSystemEdgeProfile,
  PlateSystemLayer,
} from '../../types/geometry';
import { snapToAngle, calculateBulgeFrom3Points, bulgeToArc } from '../../engine/geometry/GeometryUtils';
import { getPresetById } from '../../services/parametric/profileLibrary';

// ============================================================================
// Geometry helpers for child beam generation
// ============================================================================

/**
 * Compute the signed area of a polygon (positive = CCW, negative = CW).
 */
function signedPolygonArea(pts: Point[]): number {
  let area = 0;
  for (let i = 0; i < pts.length; i++) {
    const j = (i + 1) % pts.length;
    area += pts[i].x * pts[j].y;
    area -= pts[j].x * pts[i].y;
  }
  return area / 2;
}

/**
 * Compute the inward normal for a contour edge (p1 -> p2).
 * The normal points inward regardless of polygon winding.
 * @param sign  +1 if polygon is CW, -1 if CCW
 */
function inwardNormal(p1: Point, p2: Point, sign: number): { x: number; y: number } {
  const edgeAngle = Math.atan2(p2.y - p1.y, p2.x - p1.x);
  // Right perpendicular (CW inward): (sin, -cos)
  // For CCW polygons, flip to get left perpendicular: (-sin, cos)
  return {
    x: Math.sin(edgeAngle) * sign,
    y: -Math.cos(edgeAngle) * sign,
  };
}

/**
 * Find where an infinite line (defined by a point + direction) intersects
 * a line segment (a -> b).  Returns the parameter t along the infinite line,
 * or null if parallel / no intersection within segment.
 */
function lineSegmentIntersection(
  origin: Point,
  dir: { x: number; y: number },
  a: Point,
  b: Point
): number | null {
  const ex = b.x - a.x;
  const ey = b.y - a.y;
  const denom = dir.x * ey - dir.y * ex;
  if (Math.abs(denom) < 1e-10) return null; // parallel

  const t = ((a.x - origin.x) * ey - (a.y - origin.y) * ex) / denom;
  const u = ((a.x - origin.x) * dir.y - (a.y - origin.y) * dir.x) / denom;

  if (u < -1e-10 || u > 1 + 1e-10) return null; // outside segment
  return t;
}

/**
 * Clip an infinite line (origin + direction) to the interior of a closed polygon.
 * Returns the clipped segment [start, end] plus the angle of the boundary edge
 * at each intersection (used for miter cuts on joists).
 * Returns null if the line doesn't cross the polygon.
 */
function clipLineToPolygon(
  origin: Point,
  dir: { x: number; y: number },
  polygon: Point[]
): { start: Point; end: Point; startEdgeAngle: number; endEdgeAngle: number } | null {
  const hits: { t: number; edgeAngle: number }[] = [];
  for (let i = 0; i < polygon.length; i++) {
    const j = (i + 1) % polygon.length;
    const t = lineSegmentIntersection(origin, dir, polygon[i], polygon[j]);
    if (t !== null) {
      const edgeAngle = Math.atan2(polygon[j].y - polygon[i].y, polygon[j].x - polygon[i].x);
      hits.push({ t, edgeAngle });
    }
  }
  if (hits.length < 2) return null;
  hits.sort((a, b) => a.t - b.t);
  const first = hits[0];
  const last = hits[hits.length - 1];
  if (Math.abs(last.t - first.t) < 1e-6) return null;
  return {
    start: { x: origin.x + dir.x * first.t, y: origin.y + dir.y * first.t },
    end: { x: origin.x + dir.x * last.t, y: origin.y + dir.y * last.t },
    startEdgeAngle: first.edgeAngle,
    endEdgeAngle: last.edgeAngle,
  };
}

/**
 * Find where an infinite line (origin + dir) intersects a circular arc defined by
 * two endpoints and a bulge.  Returns parameter(s) t along the infinite line.
 */
function lineArcIntersection(
  origin: Point,
  dir: { x: number; y: number },
  p1: Point,
  p2: Point,
  bulge: number,
): { t: number; edgeAngle: number }[] {
  const { center, radius, startAngle, endAngle, clockwise } = bulgeToArc(p1, p2, bulge);

  // Solve |origin + t*dir - center|^2 = radius^2
  const ocx = origin.x - center.x;
  const ocy = origin.y - center.y;
  const a = dir.x * dir.x + dir.y * dir.y;
  const b = 2 * (ocx * dir.x + ocy * dir.y);
  const c = ocx * ocx + ocy * ocy - radius * radius;
  const disc = b * b - 4 * a * c;
  if (disc < 0) return [];

  const sqrtDisc = Math.sqrt(disc);
  const results: { t: number; edgeAngle: number }[] = [];

  for (const t of [(-b - sqrtDisc) / (2 * a), (-b + sqrtDisc) / (2 * a)]) {
    const px = origin.x + dir.x * t;
    const py = origin.y + dir.y * t;
    const angle = Math.atan2(py - center.y, px - center.x);

    // Check if angle is within the arc sweep
    if (isAngleInArcSweep(angle, startAngle, endAngle, clockwise)) {
      // Tangent at intersection point (perpendicular to radius)
      const tangentAngle = clockwise
        ? angle - Math.PI / 2
        : angle + Math.PI / 2;
      results.push({ t, edgeAngle: tangentAngle });
    }
  }
  return results;
}

/**
 * Check if an angle falls within an arc sweep (from startAngle to endAngle).
 */
function isAngleInArcSweep(angle: number, startAngle: number, endAngle: number, clockwise: boolean): boolean {
  const TWO_PI = Math.PI * 2;
  const normalize = (a: number) => { let n = a % TWO_PI; if (n < 0) n += TWO_PI; return n; };
  const nA = normalize(angle);
  const nS = normalize(startAngle);
  const nE = normalize(endAngle);
  const eps = 0.001; // small tolerance

  if (clockwise) {
    // CW: goes from nS decreasing to nE
    if (nS >= nE) {
      return nA <= nS + eps && nA >= nE - eps;
    } else {
      return nA <= nS + eps || nA >= nE - eps;
    }
  } else {
    // CCW: goes from nS increasing to nE
    if (nS <= nE) {
      return nA >= nS - eps && nA <= nE + eps;
    } else {
      return nA >= nS - eps || nA <= nE + eps;
    }
  }
}

/**
 * Clip an infinite line (origin + direction) to the interior of a closed polygon
 * that may contain arc segments (defined by contourBulges).
 * Returns the clipped segment [start, end] plus the edge angle at each intersection.
 * Returns null if the line doesn't cross the polygon.
 */
function clipLineToPolygonWithArcs(
  origin: Point,
  dir: { x: number; y: number },
  polygon: Point[],
  bulges?: number[]
): { start: Point; end: Point; startEdgeAngle: number; endEdgeAngle: number } | null {
  const hits: { t: number; edgeAngle: number }[] = [];
  for (let i = 0; i < polygon.length; i++) {
    const j = (i + 1) % polygon.length;
    const b = bulges ? (bulges[i] ?? 0) : 0;

    if (Math.abs(b) > 0.0001) {
      // Arc segment: use line-circle intersection
      const arcHits = lineArcIntersection(origin, dir, polygon[i], polygon[j], b);
      hits.push(...arcHits);
    } else {
      // Straight segment: use existing line-segment intersection
      const t = lineSegmentIntersection(origin, dir, polygon[i], polygon[j]);
      if (t !== null) {
        const edgeAngle = Math.atan2(polygon[j].y - polygon[i].y, polygon[j].x - polygon[i].x);
        hits.push({ t, edgeAngle });
      }
    }
  }
  if (hits.length < 2) return null;
  hits.sort((a, b) => a.t - b.t);
  const first = hits[0];
  const last = hits[hits.length - 1];
  if (Math.abs(last.t - first.t) < 1e-6) return null;
  return {
    start: { x: origin.x + dir.x * first.t, y: origin.y + dir.y * first.t },
    end: { x: origin.x + dir.x * last.t, y: origin.y + dir.y * last.t },
    startEdgeAngle: first.edgeAngle,
    endEdgeAngle: last.edgeAngle,
  };
}

/**
 * Normalize an angle difference to the range (-PI, PI].
 */
function normalizeAngleDiff(diff: number): number {
  while (diff > Math.PI) diff -= 2 * Math.PI;
  while (diff <= -Math.PI) diff += 2 * Math.PI;
  return diff;
}

/**
 * Map a material string to the BeamMaterial type.
 */
function toBeamMaterial(material: string): BeamMaterial {
  const map: Record<string, BeamMaterial> = {
    timber: 'timber',
    steel: 'steel',
    concrete: 'concrete',
    aluminum: 'aluminum',
  };
  return map[material] ?? 'other';
}

/**
 * Generate all child BeamShape elements for a plate system.
 * Returns an array of beams (joists + edge beams).
 * @param edgeBeamEnabled  Optional array matching contour edges; true = generate edge beam for that edge.
 *                         Defaults to all edges enabled when undefined.
 * @param contourBulges    Optional array of bulge values per edge.  Non-zero entries define arc edges.
 */
export function generatePlateSystemBeams(
  plateSystemId: string,
  contourPoints: Point[],
  mainProfile: PlateSystemMainProfile,
  edgeProfile: PlateSystemEdgeProfile | undefined,
  layerId: string,
  drawingId: string,
  style: BeamShape['style'],
  edgeBeamEnabled?: boolean[],
  contourBulges?: number[],
): BeamShape[] {
  const beams: BeamShape[] = [];
  const n = contourPoints.length;
  if (n < 3) return beams;

  // Determine polygon winding: sign = +1 for CW (negative signed area), -1 for CCW
  const area = signedPolygonArea(contourPoints);
  const windSign = area < 0 ? 1 : -1; // CW has negative area in screen coords (Y down)

  // ----------------------------------------------------------------
  // 1. Edge beams (rim joists) along each contour edge
  // ----------------------------------------------------------------
  if (edgeProfile) {
    const edgeW = edgeProfile.width;
    const halfEdgeW = edgeW / 2;

    // Resolve profile preset for edge beams (when a standard profile is selected)
    const edgePreset = edgeProfile.profileId ? getPresetById(edgeProfile.profileId) : undefined;

    // Pre-compute the offset centerline polygon by intersecting adjacent offset
    // edges.  This ensures edge beams meet cleanly at corners without gaps or
    // overlaps, regardless of the angle between adjacent edges.
    const offsetCenterline = offsetPolygonPerEdge(
      contourPoints,
      contourPoints.map(() => halfEdgeW),
      windSign,
    );

    for (let i = 0; i < n; i++) {
      // Skip this edge if explicitly disabled
      if (edgeBeamEnabled && !edgeBeamEnabled[i]) continue;

      const j = (i + 1) % n;
      const p1 = contourPoints[i];
      const p2 = contourPoints[j];
      const edgeBulge = contourBulges ? (contourBulges[i] ?? 0) : 0;
      const isArcEdge = Math.abs(edgeBulge) > 0.0001;

      // Use the pre-computed offset polygon vertices so that adjacent edge
      // beams share the exact same corner point (the intersection of the two
      // offset edges).  This eliminates gaps/overlaps at corners.
      const start: Point = offsetCenterline[i];
      const end: Point = offsetCenterline[j];

      // Compute edge direction angle so the beam profile is oriented along the edge
      const edgeAngle = Math.atan2(p2.y - p1.y, p2.x - p1.x);

      // --- Miter join at corners where adjacent edges also have edge beams ---
      // Previous edge index
      const prevIdx = (i - 1 + n) % n;
      const prevEdgeEnabled = !edgeBeamEnabled || edgeBeamEnabled[prevIdx];
      // Next edge index
      const nextIdx = (i + 1) % n;
      const nextEdgeEnabled = !edgeBeamEnabled || edgeBeamEnabled[nextIdx];

      // Previous edge angle (direction from contourPoints[prevIdx] to contourPoints[i])
      const prevP1 = contourPoints[prevIdx];
      const prevAngle = Math.atan2(p1.y - prevP1.y, p1.x - prevP1.x);

      // Next edge angle (direction from contourPoints[j] to contourPoints[(j+1)%n])
      const nextP2 = contourPoints[(j + 1) % n];
      const nextAngle = Math.atan2(nextP2.y - p2.y, nextP2.x - p2.x);

      const beam: BeamShape = {
        id: generateId(),
        type: 'beam',
        layerId,
        drawingId,
        style: { ...style },
        visible: true,
        locked: false,
        start,
        end,
        profileType: edgePreset ? edgePreset.profileType : 'rectangular',
        profileParameters: edgePreset
          ? { ...edgePreset.parameters }
          : { width: edgeProfile.width, height: edgeProfile.height },
        presetId: edgePreset?.id,
        presetName: edgePreset?.name,
        flangeWidth: edgeProfile.width,
        justification: 'center',
        material: toBeamMaterial(edgeProfile.material),
        showCenterline: false,
        showLabel: false,
        rotation: edgeAngle,
        plateSystemId,
        plateSystemRole: 'edge',
        // Carry bulge from contour edge so the edge beam renders as an arc
        ...(isArcEdge ? { bulge: edgeBulge } : {}),
        // Miter at start corner if previous edge beam is enabled
        ...(prevEdgeEnabled ? { startCap: 'miter' as const, startMiterAngle: prevAngle } : {}),
        // Miter at end corner if next edge beam is enabled
        ...(nextEdgeEnabled ? { endCap: 'miter' as const, endMiterAngle: nextAngle } : {}),
      };
      beams.push(beam);
    }
  }

  // ----------------------------------------------------------------
  // 2. Joists (main profile beams) running across the contour
  // ----------------------------------------------------------------
  const dir = mainProfile.direction;
  const spacing = mainProfile.spacing;
  const cosD = Math.cos(dir);
  const sinD = Math.sin(dir);

  // Bounding box
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of contourPoints) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }

  const diag = Math.sqrt((maxX - minX) ** 2 + (maxY - minY) ** 2);
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;

  // Normal perpendicular to joist direction
  const norm = { x: -sinD, y: cosD };
  const numLines = Math.ceil(diag / spacing) + 1;

  // The contour to clip against: if edge beams exist, shrink each edge inward
  // by the FULL edge beam width so joists terminate at the inner face of the
  // rim joists.  Edges without an edge beam keep the original contour boundary.
  let clipPolygon = contourPoints;
  if (edgeProfile) {
    const perEdgeOffsets: number[] = [];
    for (let i = 0; i < n; i++) {
      const hasEdgeBeam = !edgeBeamEnabled || edgeBeamEnabled[i] !== false;
      perEdgeOffsets.push(hasEdgeBeam ? edgeProfile.width : 0);
    }
    clipPolygon = offsetPolygonPerEdge(contourPoints, perEdgeOffsets, windSign);
  }

  const joistDir = { x: cosD, y: sinD };

  // Determine if arc-aware clipping is needed for joists.
  // Build clip bulges for the offset polygon:
  // Edges that were shrunk (have edge beams) lose their arc; edges at offset 0 keep it.
  const hasArcEdges = contourBulges && contourBulges.some(b => Math.abs(b) > 0.0001);
  let clipBulges: number[] | undefined;
  if (hasArcEdges && contourBulges) {
    clipBulges = contourBulges.map((b, idx) => {
      const hasEdgeBeam = !edgeBeamEnabled || edgeBeamEnabled[idx] !== false;
      return (hasEdgeBeam && edgeProfile) ? 0 : b; // shrunk edges become straight
    });
    // If all clip bulges are 0, no need for arc-aware clipping
    if (!clipBulges.some(b => Math.abs(b) > 0.0001)) clipBulges = undefined;
  }

  for (let i = -numLines; i <= numLines; i++) {
    const offset = i * spacing;
    const ox = cx + norm.x * offset;
    const oy = cy + norm.y * offset;

    const clipped = clipBulges
      ? clipLineToPolygonWithArcs({ x: ox, y: oy }, joistDir, clipPolygon, clipBulges)
      : clipLineToPolygon({ x: ox, y: oy }, joistDir, clipPolygon);
    if (!clipped) continue;

    // Resolve profile preset for joist beams (when a standard profile is selected)
    const profilePreset = mainProfile.profileId ? getPresetById(mainProfile.profileId) : undefined;

    // Determine miter cuts: if the boundary edge at the intersection is NOT
    // perpendicular to the joist direction, apply a miter cut so the joist
    // end matches the angle of the boundary edge it meets.
    const joistAngle = Math.atan2(joistDir.y, joistDir.x);

    // Check if start edge is perpendicular to joist (no miter needed then)
    const startEdgeDelta = normalizeAngleDiff(clipped.startEdgeAngle - joistAngle);
    const startIsPerp = Math.abs(Math.abs(startEdgeDelta) - Math.PI / 2) < 0.01;

    const endEdgeDelta = normalizeAngleDiff(clipped.endEdgeAngle - joistAngle);
    const endIsPerp = Math.abs(Math.abs(endEdgeDelta) - Math.PI / 2) < 0.01;

    const beam: BeamShape = {
      id: generateId(),
      type: 'beam',
      layerId,
      drawingId,
      style: { ...style },
      visible: true,
      locked: false,
      start: clipped.start,
      end: clipped.end,
      profileType: profilePreset ? profilePreset.profileType : 'rectangular',
      profileParameters: profilePreset
        ? { ...profilePreset.parameters }
        : { width: mainProfile.width, height: mainProfile.height },
      presetId: profilePreset?.id,
      presetName: profilePreset?.name,
      flangeWidth: mainProfile.width,
      justification: 'center',
      material: toBeamMaterial(mainProfile.material),
      showCenterline: false,
      showLabel: false,
      rotation: 0,
      plateSystemId,
      plateSystemRole: 'joist',
      // Miter cuts: trim joist ends to match the boundary edge angle
      startCap: startIsPerp ? 'butt' : 'miter',
      endCap: endIsPerp ? 'butt' : 'miter',
      startMiterAngle: startIsPerp ? undefined : clipped.startEdgeAngle,
      endMiterAngle: endIsPerp ? undefined : clipped.endEdgeAngle,
    };
    beams.push(beam);
  }

  return beams;
}

/**
 * Offset a closed polygon inward with a potentially different offset distance
 * per edge.  This is used so that edges WITH an edge beam are inset by the
 * full beam width while edges WITHOUT an edge beam stay at the contour.
 *
 * @param polygon   Closed polygon vertices
 * @param offsets   Per-edge inward offset distance (array length === polygon.length)
 * @param windSign  +1 for CW, -1 for CCW
 */
function offsetPolygonPerEdge(polygon: Point[], offsets: number[], windSign: number): Point[] {
  const n = polygon.length;
  if (n < 3) return polygon;

  // Build per-edge offset lines
  const offsetEdges: { start: Point; end: Point }[] = [];
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const p1 = polygon[i];
    const p2 = polygon[j];
    const d = offsets[i];
    const norm = inwardNormal(p1, p2, windSign);
    offsetEdges.push({
      start: { x: p1.x + norm.x * d, y: p1.y + norm.y * d },
      end:   { x: p2.x + norm.x * d, y: p2.y + norm.y * d },
    });
  }

  // Intersect consecutive offset edges to produce new vertices
  const result: Point[] = [];
  for (let i = 0; i < n; i++) {
    const prev = (i - 1 + n) % n;
    const edge1 = offsetEdges[prev];
    const edge2 = offsetEdges[i];

    const d1x = edge1.end.x - edge1.start.x;
    const d1y = edge1.end.y - edge1.start.y;
    const d2x = edge2.end.x - edge2.start.x;
    const d2y = edge2.end.y - edge2.start.y;

    const denom = d1x * d2y - d1y * d2x;
    if (Math.abs(denom) < 1e-10) {
      // Parallel edges — use start of edge2 as fallback
      result.push(edge2.start);
    } else {
      const t = ((edge2.start.x - edge1.start.x) * d2y - (edge2.start.y - edge1.start.y) * d2x) / denom;
      result.push({
        x: edge1.start.x + d1x * t,
        y: edge1.start.y + d1y * t,
      });
    }
  }

  return result;
}

/**
 * Centralized utility to delete old child beams and regenerate new ones
 * for a plate system.  Reads the current shape from the store and writes
 * back the updated childShapeIds.
 */
export function regeneratePlateSystemBeams(psShapeId: string): void {
  const store = useAppStore.getState();
  const psShape = store.shapes.find(s => s.id === psShapeId) as PlateSystemShape | undefined;
  if (!psShape) return;

  // Delete old child beams
  if (psShape.childShapeIds && psShape.childShapeIds.length > 0) {
    store.deleteShapes(psShape.childShapeIds);
  }

  // Regenerate new child beams from updated contour
  const newBeams = generatePlateSystemBeams(
    psShape.id,
    psShape.contourPoints,
    psShape.mainProfile,
    psShape.edgeProfile,
    psShape.layerId,
    psShape.drawingId,
    psShape.style,
    psShape.edgeBeamEnabled,
    psShape.contourBulges,
  );
  if (newBeams.length > 0) {
    store.addShapes(newBeams as Shape[]);
  }
  store.updateShape(psShape.id, { childShapeIds: newBeams.map(b => b.id) } as Partial<Shape>);
}

// ============================================================================
// Hook
// ============================================================================

export function usePlateSystemDrawing() {
  const {
    activeLayerId,
    activeDrawingId,
    currentStyle,
    addShape,
    addShapes,
    drawingPoints,
    addDrawingPoint,
    clearDrawingPoints,
    setDrawingPreview,
    pendingPlateSystem,
    clearPendingPlateSystem,
  } = useAppStore();

  // Track bulges per segment and arc through-point for arc mode
  const bulgesRef = useRef<number[]>([]);
  const arcThroughPointRef = useRef<Point | null>(null);

  /**
   * Create a plate system shape from polygon points.
   * Also generates individual child BeamShapes (joists + edge beams).
   */
  const createPlateSystem = useCallback(
    (
      points: Point[],
      options?: {
        systemType?: string;
        mainProfile?: PlateSystemMainProfile;
        edgeProfile?: PlateSystemEdgeProfile;
        layers?: PlateSystemLayer[];
        name?: string;
        bulges?: number[];
      }
    ) => {
      if (points.length < 3) return null;

      const plateSystemId = generateId();
      const mainProfile = options?.mainProfile ?? {
        profileType: 'rectangle',
        width: 75,
        height: 200,
        spacing: 600,
        direction: 0,
        material: 'timber',
      };
      const edgeProfile = options?.edgeProfile;

      // Check if there are any non-zero bulges
      const bulges = options?.bulges;
      const hasArcs = bulges && bulges.some(b => Math.abs(b) > 0.0001);

      // Generate child beams
      const childBeams = generatePlateSystemBeams(
        plateSystemId,
        points,
        mainProfile,
        edgeProfile,
        activeLayerId,
        activeDrawingId,
        { ...currentStyle },
        undefined, // edgeBeamEnabled — defaults to all edges
        hasArcs ? bulges : undefined,
      );

      const plateSystemShape: PlateSystemShape = {
        id: plateSystemId,
        type: 'plate-system',
        layerId: activeLayerId,
        drawingId: activeDrawingId,
        style: { ...currentStyle },
        visible: true,
        locked: false,
        contourPoints: [...points],
        contourBulges: hasArcs ? [...bulges] : undefined,
        systemType: options?.systemType ?? 'timber-floor',
        mainProfile,
        edgeProfile,
        layers: options?.layers,
        childShapeIds: childBeams.map(b => b.id),
        name: options?.name,
        fillColor: '#fdf4e3',
        fillOpacity: 0.15,
      };

      // Add plate system container first, then child beams
      addShape(plateSystemShape);
      if (childBeams.length > 0) {
        addShapes(childBeams as Shape[]);
      }

      return plateSystemShape.id;
    },
    [activeLayerId, activeDrawingId, currentStyle, addShape, addShapes]
  );

  /**
   * Helper to finalize the plate system with current points and bulges.
   */
  const finalizeFromPending = useCallback(() => {
    if (!pendingPlateSystem || drawingPoints.length < 3) return;

    const mainProfile: PlateSystemMainProfile = {
      profileType: 'rectangle',
      width: pendingPlateSystem.mainWidth,
      height: pendingPlateSystem.mainHeight,
      spacing: pendingPlateSystem.mainSpacing,
      direction: pendingPlateSystem.mainDirection,
      material: pendingPlateSystem.mainMaterial,
      profileId: pendingPlateSystem.mainProfileId,
    };
    const edgeProfile: PlateSystemEdgeProfile | undefined =
      pendingPlateSystem.edgeWidth && pendingPlateSystem.edgeHeight
        ? {
            profileType: 'rectangle',
            width: pendingPlateSystem.edgeWidth,
            height: pendingPlateSystem.edgeHeight,
            material: pendingPlateSystem.edgeMaterial ?? pendingPlateSystem.mainMaterial,
            profileId: pendingPlateSystem.edgeProfileId,
          }
        : undefined;

    // Pad bulges array to match point count (one bulge per segment)
    const bulges = [...bulgesRef.current];
    while (bulges.length < drawingPoints.length) {
      bulges.push(0);
    }

    createPlateSystem(drawingPoints, {
      systemType: pendingPlateSystem.systemType,
      mainProfile,
      edgeProfile,
      layers: pendingPlateSystem.layers,
      name: pendingPlateSystem.name,
      bulges,
    });
    clearDrawingPoints();
    setDrawingPreview(null);
    bulgesRef.current = [];
    arcThroughPointRef.current = null;
  }, [pendingPlateSystem, drawingPoints, createPlateSystem, clearDrawingPoints, setDrawingPreview]);

  /**
   * Handle click for plate system drawing (multi-click polygon).
   * In arc mode, each segment requires two clicks: first the arc through-point,
   * then the endpoint. The bulge is calculated from the 3 points.
   */
  const handlePlateSystemClick = useCallback(
    (snappedPos: Point, shiftKey: boolean) => {
      if (!pendingPlateSystem) return false;

      const isArcMode = pendingPlateSystem.shapeMode === 'arc';

      // Apply shift-key angle constraint if there's a previous point
      let finalPos = snappedPos;
      if (shiftKey && drawingPoints.length > 0) {
        const lastPoint = drawingPoints[drawingPoints.length - 1];
        finalPos = snapToAngle(lastPoint, snappedPos);
      }

      // --- Arc mode: collect through-point first, then endpoint ---
      if (isArcMode && drawingPoints.length > 0 && !arcThroughPointRef.current) {
        // This click is the arc through-point (second of 3 points for the arc)
        arcThroughPointRef.current = finalPos;
        return true;
      }

      // Check if clicking near the first point to close the polygon
      if (drawingPoints.length >= 3) {
        const firstPoint = drawingPoints[0];
        const dx = finalPos.x - firstPoint.x;
        const dy = finalPos.y - firstPoint.y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        // Close threshold: 10 drawing units
        if (dist < 10) {
          // If in arc mode and we have a through-point, calculate bulge for closing segment
          if (isArcMode && arcThroughPointRef.current) {
            const lastPt = drawingPoints[drawingPoints.length - 1];
            const bulge = calculateBulgeFrom3Points(lastPt, arcThroughPointRef.current, firstPoint);
            bulgesRef.current.push(bulge);
            arcThroughPointRef.current = null;
          } else {
            // Straight closing segment
            bulgesRef.current.push(0);
          }

          finalizeFromPending();
          return true;
        }
      }

      // If in arc mode and we have a through-point, this click is the arc endpoint
      if (isArcMode && arcThroughPointRef.current && drawingPoints.length > 0) {
        const lastPt = drawingPoints[drawingPoints.length - 1];
        const bulge = calculateBulgeFrom3Points(lastPt, arcThroughPointRef.current, finalPos);
        bulgesRef.current.push(bulge);
        arcThroughPointRef.current = null;
        addDrawingPoint(finalPos);
        return true;
      }

      // Line mode: add bulge=0 for the previous segment (if not the first point)
      if (!isArcMode && drawingPoints.length > 0) {
        bulgesRef.current.push(0);
      }

      // Add point to the polygon
      addDrawingPoint(finalPos);
      return true;
    },
    [pendingPlateSystem, drawingPoints, addDrawingPoint, clearDrawingPoints, setDrawingPreview, createPlateSystem, finalizeFromPending]
  );

  /**
   * Finish plate system drawing (right-click or 'C' to close)
   * Requires at least 3 points to form a valid polygon.
   * If an arc through-point is pending, discard it (the segment stays straight).
   */
  const finishPlateSystemDrawing = useCallback(() => {
    if (!pendingPlateSystem || drawingPoints.length < 3) return;

    // Discard pending arc through-point on finish (closing segment is straight)
    arcThroughPointRef.current = null;

    // Pad bulges for any remaining segments
    while (bulgesRef.current.length < drawingPoints.length) {
      bulgesRef.current.push(0);
    }

    finalizeFromPending();
  }, [pendingPlateSystem, drawingPoints, finalizeFromPending]);

  /**
   * Update plate system preview (shows polygon outline + current mouse position + joist preview).
   * Includes bulge data for arc segments and the pending arc through-point.
   */
  const updatePlateSystemPreview = useCallback(
    (snappedPos: Point, shiftKey: boolean) => {
      if (!pendingPlateSystem || drawingPoints.length === 0) return;

      const lastPoint = drawingPoints[drawingPoints.length - 1];
      const previewPos = shiftKey ? snapToAngle(lastPoint, snappedPos) : snappedPos;

      const isArcMode = pendingPlateSystem.shapeMode === 'arc';
      const throughPt = arcThroughPointRef.current;

      // Compute currentBulge for the live edge being drawn
      let currentBulge = 0;
      if (isArcMode && throughPt && drawingPoints.length > 0) {
        // We have a through-point: compute bulge from lastPoint -> throughPt -> previewPos
        currentBulge = calculateBulgeFrom3Points(lastPoint, throughPt, previewPos);
      }

      setDrawingPreview({
        type: 'plate-system',
        points: [...drawingPoints],
        currentPoint: previewPos,
        systemType: pendingPlateSystem.systemType,
        mainProfile: {
          width: pendingPlateSystem.mainWidth,
          spacing: pendingPlateSystem.mainSpacing,
          direction: pendingPlateSystem.mainDirection,
        },
        edgeWidth: pendingPlateSystem.edgeWidth,
        bulges: bulgesRef.current.length > 0 ? [...bulgesRef.current] : undefined,
        currentBulge,
        arcThroughPoint: throughPt ?? undefined,
      });
    },
    [pendingPlateSystem, drawingPoints, setDrawingPreview]
  );

  /**
   * Cancel plate system drawing
   */
  const cancelPlateSystemDrawing = useCallback(() => {
    clearDrawingPoints();
    setDrawingPreview(null);
    clearPendingPlateSystem();
    bulgesRef.current = [];
    arcThroughPointRef.current = null;
  }, [clearDrawingPoints, setDrawingPreview, clearPendingPlateSystem]);

  /**
   * Get the base point for tracking (last clicked point)
   */
  const getPlateSystemBasePoint = useCallback((): Point | null => {
    if (!pendingPlateSystem || drawingPoints.length === 0) return null;
    return drawingPoints[drawingPoints.length - 1];
  }, [pendingPlateSystem, drawingPoints]);

  return {
    handlePlateSystemClick,
    finishPlateSystemDrawing,
    updatePlateSystemPreview,
    cancelPlateSystemDrawing,
    getPlateSystemBasePoint,
    createPlateSystem,
    isPlateSystemDrawingActive: !!pendingPlateSystem,
    hasPoints: drawingPoints.length > 0,
    pointCount: drawingPoints.length,
  };
}
