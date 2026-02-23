/**
 * Section Reference Service
 *
 * Computes bidirectional references between section drawings and plan drawings.
 * When a section callout cuts through a plan, this service:
 * 1. Finds gridlines that intersect the section cut line
 * 2. Computes their positions in section-view coordinates
 * 3. Generates GridlineShape and LevelShape objects for the section drawing
 * 4. Supports reverse sync: moving a reference in section updates the plan
 */

import type {
  Point,
  Shape,
  GridlineShape,
  LevelShape,
  RectangleShape,
  SlabShape,
  SectionCalloutShape,
  Drawing,
  SectionReference,
} from '../../types/geometry';
import type { DimensionShape } from '../../types/dimension';
import { DIM_ASSOCIATE_STYLE } from '../../constants/cadDefaults';
import { calculateDimensionValue, formatDimAssociateValue } from '../../engine/geometry/DimensionUtils';
import type { ProjectStructure, ProjectStorey } from '../../state/slices/parametricSlice';

// ============================================================================
// Geometry Helpers
// ============================================================================

/**
 * Compute intersection of a line segment with an infinite line (ray from a point in a direction).
 * The gridline is treated as infinite (extended beyond its endpoints).
 * Returns the parameter t along the section cut line where intersection occurs.
 */
function lineWithInfiniteLineIntersection(
  // Section cut line segment
  secStart: Point, secEnd: Point,
  // Gridline (treated as infinite line through these two points)
  glStart: Point, glEnd: Point,
): { t: number; point: Point } | null {
  const dx1 = secEnd.x - secStart.x;
  const dy1 = secEnd.y - secStart.y;
  const dx2 = glEnd.x - glStart.x;
  const dy2 = glEnd.y - glStart.y;

  const denom = dx1 * dy2 - dy1 * dx2;
  if (Math.abs(denom) < 1e-10) return null; // Parallel

  const t = ((glStart.x - secStart.x) * dy2 - (glStart.y - secStart.y) * dx2) / denom;

  // t must be within the section cut line (0 to 1)
  if (t < -0.001 || t > 1.001) return null;

  return {
    t: Math.max(0, Math.min(1, t)),
    point: {
      x: secStart.x + t * dx1,
      y: secStart.y + t * dy1,
    },
  };
}

/**
 * Compute intersection of two finite line segments.
 * Returns the parameter t along the first segment and u along the second
 * where the intersection occurs, plus the intersection point.
 * Returns null if the segments do not intersect.
 */
function segmentSegmentIntersection(
  p1: Point, p2: Point,
  p3: Point, p4: Point,
): { t: number; u: number; point: Point } | null {
  const dx1 = p2.x - p1.x;
  const dy1 = p2.y - p1.y;
  const dx2 = p4.x - p3.x;
  const dy2 = p4.y - p3.y;

  const denom = dx1 * dy2 - dy1 * dx2;
  if (Math.abs(denom) < 1e-10) return null; // Parallel

  const t = ((p3.x - p1.x) * dy2 - (p3.y - p1.y) * dx2) / denom;
  const u = ((p3.x - p1.x) * dy1 - (p3.y - p1.y) * dx1) / denom;

  // Both parameters must be within [0, 1] for finite segment intersection
  if (t < -1e-6 || t > 1 + 1e-6 || u < -1e-6 || u > 1 + 1e-6) return null;

  return {
    t: Math.max(0, Math.min(1, t)),
    u: Math.max(0, Math.min(1, u)),
    point: {
      x: p1.x + t * dx1,
      y: p1.y + t * dy1,
    },
  };
}

// ============================================================================
// Section Level Label Formatting
// ============================================================================

/**
 * Format a peil/elevation value (in mm) as a meters label for section views.
 * e.g., 3000 -> "+3.000", 0 -> "±0.000", -300 -> "-0.300"
 */
export function formatSectionPeilLabel(elevationMm: number): string {
  const elevMeters = Math.abs(elevationMm / 1000);
  if (elevationMm === 0) {
    return '\u00b1 0.000';
  } else if (elevationMm > 0) {
    return `+ ${elevMeters.toFixed(3)}`;
  } else {
    return `- ${elevMeters.toFixed(3)}`;
  }
}

// ============================================================================
// Section Coordinate System
// ============================================================================

/**
 * Section view coordinate system:
 * - X axis: along the section cut line (from start to end)
 * - Y axis: vertical (elevation), with Y increasing upward
 *
 * In plan view, the section cut line goes from callout.start to callout.end.
 * A point at parameter t along this line maps to section X = t * lineLength.
 *
 * Level lines are horizontal in section view at Y = elevation.
 * Gridline references are vertical in section view at X = intersection position.
 */

export interface SectionCoordinateSystem {
  /** Origin in plan coordinates (section callout start) */
  origin: Point;
  /** Unit vector along the section cut line */
  directionX: Point;
  /** Length of the section cut line in plan units */
  length: number;
  /** The section callout that defines this coordinate system */
  calloutId: string;
  /** The source (plan) drawing ID */
  sourceDrawingId: string;
}

/**
 * Build a section coordinate system from a section callout shape.
 */
export function buildSectionCoordinateSystem(
  callout: SectionCalloutShape,
): SectionCoordinateSystem {
  const dx = callout.end.x - callout.start.x;
  const dy = callout.end.y - callout.start.y;
  const length = Math.sqrt(dx * dx + dy * dy);

  return {
    origin: callout.start,
    directionX: length > 0 ? { x: dx / length, y: dy / length } : { x: 1, y: 0 },
    length,
    calloutId: callout.id,
    sourceDrawingId: callout.drawingId,
  };
}

// ============================================================================
// Gridline Intersection Computation
// ============================================================================

export interface GridlineIntersection {
  /** The source gridline shape */
  sourceGridline: GridlineShape;
  /** Parameter t along the section cut line (0 = start, 1 = end) */
  t: number;
  /** Intersection point in plan coordinates */
  planPoint: Point;
  /** X position in section view coordinates (distance along cut line) */
  sectionX: number;
}

/**
 * Find all gridlines from a plan drawing that intersect the section cut line.
 */
export function findGridlineIntersections(
  planShapes: Shape[],
  callout: SectionCalloutShape,
  coordSystem: SectionCoordinateSystem,
): GridlineIntersection[] {
  const gridlines = planShapes.filter(
    (s): s is GridlineShape => s.type === 'gridline'
  );

  const intersections: GridlineIntersection[] = [];

  for (const gl of gridlines) {
    // Treat gridline as an infinite line (it extends beyond its endpoints via gridlineExtension)
    const result = lineWithInfiniteLineIntersection(
      callout.start, callout.end,
      gl.start, gl.end,
    );

    if (result) {
      intersections.push({
        sourceGridline: gl,
        t: result.t,
        planPoint: result.point,
        sectionX: result.t * coordSystem.length,
      });
    }
  }

  // Sort by position along the section cut line
  intersections.sort((a, b) => a.t - b.t);

  return intersections;
}

// ============================================================================
// Slab Intersection Computation
// ============================================================================

export interface SlabIntersection {
  /** The source slab shape from the plan */
  sourceSlab: SlabShape;
  /** Start parameter t along the section cut line (where cut enters slab polygon) */
  tStart: number;
  /** End parameter t along the section cut line (where cut exits slab polygon) */
  tEnd: number;
  /** X start position in section view coordinates */
  sectionXStart: number;
  /** X end position in section view coordinates */
  sectionXEnd: number;
}

/**
 * Find all slabs from a plan drawing that intersect the section cut line.
 * For each slab, compute the entry and exit points of the section line
 * through the slab's boundary polygon.
 */
export function findSlabIntersections(
  planShapes: Shape[],
  callout: SectionCalloutShape,
  coordSystem: SectionCoordinateSystem,
): SlabIntersection[] {
  const slabs = planShapes.filter(
    (s): s is SlabShape => s.type === 'slab'
  );

  const results: SlabIntersection[] = [];

  for (const slab of slabs) {
    if (slab.points.length < 3) continue; // Need at least a triangle

    // Find all intersections of the section cut line with the slab polygon edges
    const tValues: number[] = [];

    for (let i = 0; i < slab.points.length; i++) {
      const p1 = slab.points[i];
      const p2 = slab.points[(i + 1) % slab.points.length];

      const result = segmentSegmentIntersection(
        callout.start, callout.end,
        p1, p2,
      );

      if (result) {
        tValues.push(result.t);
      }
    }

    if (tValues.length < 2) continue; // Need at least entry and exit

    // Sort t values and take the min and max to get the full cut extent
    tValues.sort((a, b) => a - b);
    const tStart = tValues[0];
    const tEnd = tValues[tValues.length - 1];

    // Only include if there is a meaningful intersection width
    if ((tEnd - tStart) * coordSystem.length < 1) continue; // Less than 1mm, skip

    results.push({
      sourceSlab: slab,
      tStart,
      tEnd,
      sectionXStart: tStart * coordSystem.length,
      sectionXEnd: tEnd * coordSystem.length,
    });
  }

  return results;
}

// ============================================================================
// Section Slab Shape Generation
// ============================================================================

/**
 * Material color mapping for slab section rendering.
 * These are muted fill colors appropriate for section cuts.
 */
const SLAB_MATERIAL_COLORS: Record<string, { fill: string; stroke: string }> = {
  concrete: { fill: '#c8c8c8', stroke: '#666666' },
  timber:   { fill: '#deb887', stroke: '#8b6914' },
  steel:    { fill: '#b0b0b0', stroke: '#505050' },
  generic:  { fill: '#d0d0d0', stroke: '#808080' },
};

/**
 * Generate RectangleShape objects for slabs in a section drawing.
 *
 * In section view coordinates:
 * - A slab appears as a horizontal bar (filled rectangle)
 * - X range: from sectionXStart to sectionXEnd (where the cut line enters/exits the slab)
 * - Y position: -elevation (top of slab), height = thickness (downward)
 * - Fill color based on material type
 */
export function generateSectionSlabs(
  intersections: SlabIntersection[],
  sectionDrawingId: string,
  sectionLayerId: string,
): RectangleShape[] {
  return intersections.map((intersection): RectangleShape => {
    const { sourceSlab, sectionXStart, sectionXEnd } = intersection;
    const width = sectionXEnd - sectionXStart;
    const thickness = sourceSlab.thickness || 200; // Default 200mm

    // Section view Y = -elevation (canvas Y is inverted)
    // The top of the slab is at -elevation, slab extends downward by thickness
    const yTop = -sourceSlab.elevation;

    const colors = SLAB_MATERIAL_COLORS[sourceSlab.material] || SLAB_MATERIAL_COLORS.generic;

    return {
      id: `section-ref-slab-${sourceSlab.id}`,
      type: 'rectangle',
      layerId: sectionLayerId,
      drawingId: sectionDrawingId,
      style: {
        strokeColor: colors.stroke,
        strokeWidth: 1.5,
        lineStyle: 'solid',
        fillColor: colors.fill,
      },
      visible: true,
      locked: false,
      topLeft: { x: sectionXStart, y: yTop },
      width,
      height: thickness,
      rotation: 0,
      // Mark as section reference via group ID pattern
      groupId: `section-ref:${sourceSlab.id}`,
    };
  });
}

// ============================================================================
// Section Reference Shape Generation
// ============================================================================

/**
 * Default section view extents for generated reference shapes.
 * The section view shows a vertical range based on storeys.
 */
const SECTION_VIEW_MARGIN = 2000; // mm extra above/below storey range
const SECTION_GRIDLINE_EXTEND = 500; // mm extension beyond level range

/**
 * Generate GridlineShape objects for a section drawing from plan gridline intersections.
 *
 * In section view coordinates:
 * - Gridline references are vertical lines at the X position where they intersect the cut
 * - They span the full height of the section view (from lowest level to highest level + margin)
 */
export function generateSectionGridlines(
  intersections: GridlineIntersection[],
  storeys: ProjectStorey[],
  sectionDrawingId: string,
  sectionLayerId: string,
): GridlineShape[] {
  if (intersections.length === 0) return [];

  // Determine vertical extent from storeys
  const elevations = storeys.map(s => s.elevation);
  const minElev = elevations.length > 0 ? Math.min(...elevations) : 0;
  const maxElev = elevations.length > 0 ? Math.max(...elevations) : 3000;

  // Section view Y: elevation maps to Y coordinate (Y-up in section view)
  // In the canvas, Y increases downward, but levels use elevation values.
  // For section view, we place gridlines as vertical lines:
  // start.y = -(maxElev + margin), end.y = -(minElev - margin)
  // (Negate because canvas Y is inverted relative to elevation)
  const yTop = -(maxElev + SECTION_VIEW_MARGIN + SECTION_GRIDLINE_EXTEND);
  const yBottom = -(minElev - SECTION_VIEW_MARGIN - SECTION_GRIDLINE_EXTEND);

  return intersections.map((intersection): GridlineShape => ({
    id: `section-ref-gl-${intersection.sourceGridline.id}`,
    type: 'gridline',
    layerId: sectionLayerId,
    drawingId: sectionDrawingId,
    style: {
      strokeColor: '#000000',  // Black for section reference gridlines
      strokeWidth: 1,
      lineStyle: 'dashdot',
    },
    visible: true,
    locked: false,
    // Vertical line at the intersection X position
    // start = top (more negative Y = higher elevation), end = bottom
    start: { x: intersection.sectionX, y: yTop },
    end: { x: intersection.sectionX, y: yBottom },
    label: intersection.sourceGridline.label,
    bubblePosition: 'start',  // Only show bubble at the top in section views
    bubbleRadius: intersection.sourceGridline.bubbleRadius,
    fontSize: intersection.sourceGridline.fontSize,
    // Mark as section reference via group ID pattern
    groupId: `section-ref:${intersection.sourceGridline.id}`,
  }));
}

/**
 * Generate LevelShape objects for a section drawing from project structure storeys.
 *
 * In section view coordinates:
 * - Level lines are horizontal at Y = -elevation (negated for canvas Y-down)
 * - They span the full width of the section (from 0 to section length + margins)
 */
export function generateSectionLevels(
  storeys: ProjectStorey[],
  coordSystem: SectionCoordinateSystem,
  sectionDrawingId: string,
  sectionLayerId: string,
): LevelShape[] {
  if (storeys.length === 0) return [];

  const margin = SECTION_VIEW_MARGIN;
  const xStart = -margin;
  const xEnd = coordSystem.length + margin;

  return storeys.map((storey): LevelShape => {
    // Elevation in mm, Y in section view = -elevation (canvas Y is inverted)
    const yPos = -storey.elevation;

    // Build peil label in meters: "+3.000", "±0.000", "-0.300"
    const peilLabel = formatSectionPeilLabel(storey.elevation);

    return {
      id: `section-ref-lv-${storey.id}`,
      type: 'level',
      layerId: sectionLayerId,
      drawingId: sectionDrawingId,
      style: {
        strokeColor: '#ff8800',  // Orange for section reference levels
        strokeWidth: 1,
        lineStyle: 'dashed',
      },
      visible: true,
      locked: false,
      // Horizontal line at the storey elevation
      start: { x: xStart, y: yPos },
      end: { x: xEnd, y: yPos },
      label: peilLabel,
      labelPosition: 'end',
      bubbleRadius: 300,
      fontSize: 250,
      elevation: storey.elevation,
      peil: storey.elevation,
      description: storey.name,
      // Mark as section reference via group ID pattern
      groupId: `section-ref:storey-${storey.id}`,
    };
  });
}

// ============================================================================
// Section Gridline Dimensioning
// ============================================================================

/**
 * Generate DimensionShape objects that measure the horizontal distance between
 * adjacent section gridlines. Placed at the top of the section view (above the
 * gridline bubbles) using DimAssociate style.
 *
 * Also generates a total dimension spanning from the first to the last gridline.
 */
export function generateSectionGridlineDimensions(
  gridlines: GridlineShape[],
  sectionDrawingId: string,
  sectionLayerId: string,
): DimensionShape[] {
  if (gridlines.length < 2) return [];

  // Sort gridlines by X position (left to right along the section cut line)
  const sorted = [...gridlines].sort((a, b) => a.start.x - b.start.x);

  // The dimension line Y should be above the top of the gridlines (start.y is the top)
  // We use the topmost start.y and offset upward by a margin
  const topY = Math.min(...sorted.map(gl => gl.start.y));
  // Offset for the span dimension row (closer to gridlines)
  const spanDimY = topY;
  // Offset for the total dimension row (further from gridlines)
  const totalDimRowOffset = -300;

  const dims: DimensionShape[] = [];

  // Span dimensions between adjacent gridlines
  for (let i = 0; i < sorted.length - 1; i++) {
    const x1 = sorted[i].start.x;
    const x2 = sorted[i + 1].start.x;
    const p1: Point = { x: x1, y: spanDimY };
    const p2: Point = { x: x2, y: spanDimY };
    const value = calculateDimensionValue([p1, p2], 'linear', 'horizontal');
    const formattedValue = formatDimAssociateValue(value);

    dims.push({
      id: `section-ref-dim-span-${sorted[i].id}-${sorted[i + 1].id}`,
      type: 'dimension',
      layerId: sectionLayerId,
      drawingId: sectionDrawingId,
      style: { strokeColor: '#000000', strokeWidth: 2.5, lineStyle: 'solid' as const },
      visible: true,
      locked: false,
      dimensionType: 'linear',
      points: [p1, p2],
      dimensionLineOffset: totalDimRowOffset,
      linearDirection: 'horizontal',
      value: formattedValue,
      valueOverridden: false,
      dimensionStyle: { ...DIM_ASSOCIATE_STYLE },
      isGridDimension: true,
      dimensionStyleName: 'DimAssociate',
      linkedGridlineIds: [sorted[i].id, sorted[i + 1].id],
    });
  }

  // Total dimension from first to last gridline
  if (sorted.length >= 2) {
    const xFirst = sorted[0].start.x;
    const xLast = sorted[sorted.length - 1].start.x;
    const p1: Point = { x: xFirst, y: spanDimY };
    const p2: Point = { x: xLast, y: spanDimY };
    const value = calculateDimensionValue([p1, p2], 'linear', 'horizontal');
    const formattedValue = formatDimAssociateValue(value);

    dims.push({
      id: `section-ref-dim-total-${sorted[0].id}-${sorted[sorted.length - 1].id}`,
      type: 'dimension',
      layerId: sectionLayerId,
      drawingId: sectionDrawingId,
      style: { strokeColor: '#000000', strokeWidth: 2.5, lineStyle: 'solid' as const },
      visible: true,
      locked: false,
      dimensionType: 'linear',
      points: [p1, p2],
      dimensionLineOffset: 0,
      linearDirection: 'horizontal',
      value: formattedValue,
      valueOverridden: false,
      dimensionStyle: { ...DIM_ASSOCIATE_STYLE },
      isGridDimension: true,
      dimensionStyleName: 'DimAssociate',
      linkedGridlineIds: [sorted[0].id, sorted[sorted.length - 1].id],
    });
  }

  return dims;
}

// ============================================================================
// Section Reference Management
// ============================================================================

/** Prefix used for section reference shape IDs */
export const SECTION_REF_ID_PREFIX = 'section-ref-';

/**
 * Check if a shape is a section reference shape (auto-generated).
 */
export function isSectionReferenceShape(shape: Shape): boolean {
  return shape.id.startsWith(SECTION_REF_ID_PREFIX);
}

/**
 * Extract the source shape ID from a section reference shape's groupId.
 * Returns null if not a section reference.
 */
export function getSourceIdFromSectionRef(shape: Shape): string | null {
  if (!shape.groupId?.startsWith('section-ref:')) return null;
  return shape.groupId.slice('section-ref:'.length);
}

/**
 * Build SectionReference entries from generated section shapes.
 */
export function buildSectionReferences(
  gridlines: GridlineShape[],
  levels: LevelShape[],
  slabs: RectangleShape[],
  sourceDrawingId: string,
): SectionReference[] {
  const refs: SectionReference[] = [];

  for (const gl of gridlines) {
    const sourceId = getSourceIdFromSectionRef(gl);
    if (sourceId) {
      refs.push({
        sourceDrawingId,
        sourceShapeId: sourceId,
        position: gl.start.x, // X position in section coords
      });
    }
  }

  for (const lv of levels) {
    const sourceId = getSourceIdFromSectionRef(lv);
    if (sourceId) {
      refs.push({
        sourceDrawingId,
        sourceShapeId: sourceId,
        position: lv.start.y, // Y position in section coords (= -elevation)
      });
    }
  }

  for (const slab of slabs) {
    const sourceId = getSourceIdFromSectionRef(slab);
    if (sourceId) {
      refs.push({
        sourceDrawingId,
        sourceShapeId: sourceId,
        position: slab.topLeft.y, // Y position in section coords (= -elevation)
      });
    }
  }

  return refs;
}

// ============================================================================
// Full Section Reference Computation
// ============================================================================

export interface SectionReferenceResult {
  /** Generated gridline shapes for the section drawing */
  gridlines: GridlineShape[];
  /** Generated level shapes for the section drawing */
  levels: LevelShape[];
  /** Generated dimension shapes between section gridlines (when sectionGridlineDimensioning is enabled) */
  dimensions: DimensionShape[];
  /** Generated slab shapes (rectangles) for slabs cut by the section line */
  slabs: RectangleShape[];
  /** Section reference entries for the Drawing.sectionReferences field */
  references: SectionReference[];
  /** The coordinate system used */
  coordSystem: SectionCoordinateSystem;
}

/**
 * Compute all section references for a section drawing.
 *
 * @param sectionDrawing - The section drawing to compute references for
 * @param allShapes - All shapes in the document (all drawings)
 * @param allDrawings - All drawings in the document
 * @param projectStructure - Project structure with storeys
 * @param sectionGridlineDimensioning - Whether to generate dimension shapes between gridlines
 * @returns Computed reference shapes and metadata, or null if section is not properly linked
 */
export function computeSectionReferences(
  sectionDrawing: Drawing,
  allShapes: Shape[],
  allDrawings: Drawing[],
  projectStructure: ProjectStructure,
  sectionGridlineDimensioning: boolean = true,
): SectionReferenceResult | null {
  if (sectionDrawing.drawingType !== 'section') return null;

  // Find the section callout that created this section drawing
  const callout = allShapes.find(
    (s): s is SectionCalloutShape =>
      s.type === 'section-callout' && (s as SectionCalloutShape).targetDrawingId === sectionDrawing.id
  ) as SectionCalloutShape | undefined;

  if (!callout) return null;

  // Build coordinate system from the callout
  const coordSystem = buildSectionCoordinateSystem(callout);

  // Find the plan drawing that contains the callout
  const planDrawing = allDrawings.find(d => d.id === callout.drawingId);
  if (!planDrawing) return null;

  // Get all shapes from the plan drawing
  const planShapes = allShapes.filter(s => s.drawingId === planDrawing.id);

  // Find gridline intersections
  const intersections = findGridlineIntersections(planShapes, callout, coordSystem);

  // Find slab intersections
  const slabIntersections = findSlabIntersections(planShapes, callout, coordSystem);

  // Get the default layer for the section drawing
  // We use the section drawing ID for the layerId; the actual layer resolution
  // happens at render time. We'll use a convention: first layer of the drawing.
  const sectionLayerId = `section-layer-${sectionDrawing.id}`;

  // Collect all storeys from project structure
  const allStoreys: ProjectStorey[] = [];
  for (const building of projectStructure.buildings) {
    allStoreys.push(...building.storeys);
  }

  // Generate section reference shapes
  const gridlines = generateSectionGridlines(
    intersections,
    allStoreys,
    sectionDrawing.id,
    sectionLayerId,
  );

  const levels = generateSectionLevels(
    allStoreys,
    coordSystem,
    sectionDrawing.id,
    sectionLayerId,
  );

  // Generate slab section shapes
  const slabs = generateSectionSlabs(
    slabIntersections,
    sectionDrawing.id,
    sectionLayerId,
  );

  const references = buildSectionReferences(gridlines, levels, slabs, planDrawing.id);

  // Generate dimension shapes between gridlines if enabled
  const dimensions = sectionGridlineDimensioning
    ? generateSectionGridlineDimensions(gridlines, sectionDrawing.id, sectionLayerId)
    : [];

  return {
    gridlines,
    levels,
    dimensions,
    slabs,
    references,
    coordSystem,
  };
}

// ============================================================================
// Section Drawing Boundary Computation
// ============================================================================

/**
 * Compute the drawing boundary for a section drawing based on its source
 * section callout line length and the project storey elevations.
 *
 * The boundary width is derived from the callout line length (the horizontal
 * extent of the section view).  The boundary height is derived from the
 * storey elevation range (the vertical extent).  Both include the standard
 * SECTION_VIEW_MARGIN so that level and gridline reference shapes fit inside.
 *
 * @param callout - The section callout shape that defines the cut line
 * @param projectStructure - Project structure with storey elevations
 * @returns A DrawingBoundary in section-view coordinates
 */
export function computeSectionBoundary(
  callout: SectionCalloutShape,
  projectStructure: ProjectStructure,
): { x: number; y: number; width: number; height: number } {
  const coordSystem = buildSectionCoordinateSystem(callout);

  // --- Horizontal extent ---
  // Section X runs from 0 to coordSystem.length.
  // Levels are generated from -margin to coordSystem.length + margin.
  const margin = SECTION_VIEW_MARGIN;
  const xStart = -margin;
  const xEnd = coordSystem.length + margin;

  // --- Vertical extent ---
  // Collect all storey elevations
  const allElevations: number[] = [];
  for (const building of projectStructure.buildings) {
    for (const storey of building.storeys) {
      allElevations.push(storey.elevation);
    }
  }

  let yTop: number;
  let yBottom: number;

  if (allElevations.length > 0) {
    const minElev = Math.min(...allElevations);
    const maxElev = Math.max(...allElevations);
    // Section Y = -elevation (canvas Y is inverted).
    // yTop (smaller Y = higher elevation) and yBottom (larger Y = lower elevation)
    yTop = -(maxElev + margin + SECTION_GRIDLINE_EXTEND);
    yBottom = -(minElev - margin - SECTION_GRIDLINE_EXTEND);
  } else {
    // No storeys defined yet: use a sensible default range
    const defaultHeight = callout.viewDepth ?? 5000;
    yTop = -defaultHeight;
    yBottom = defaultHeight;
  }

  return {
    x: xStart,
    y: yTop,
    width: xEnd - xStart,
    height: yBottom - yTop,
  };
}

// ============================================================================
// Bidirectional Sync: Section -> Plan
// ============================================================================

/**
 * When a gridline reference is moved in the section view, compute the
 * new position for the source gridline in the plan.
 *
 * @param movedRefShape - The moved section reference gridline
 * @param coordSystem - The section coordinate system
 * @param sourceGridline - The original plan gridline
 * @returns Updated start/end points for the source gridline, or null if no update needed
 */
export function syncGridlineFromSection(
  movedRefShape: GridlineShape,
  coordSystem: SectionCoordinateSystem,
  sourceGridline: GridlineShape,
): { start: Point; end: Point } | null {
  // The reference gridline's X position in section coords = distance along cut line
  const newSectionX = movedRefShape.start.x;
  const oldSectionX = movedRefShape.end.x; // Should be same as start.x for vertical line

  // If X hasn't changed significantly, no update needed
  if (Math.abs(newSectionX - oldSectionX) < 0.1 && newSectionX === movedRefShape.start.x) {
    // Check against the original position stored in the shape
  }

  // Convert section X back to parameter t along the cut line
  const t = coordSystem.length > 0 ? newSectionX / coordSystem.length : 0;

  // The new intersection point on the cut line
  const newPlanPoint: Point = {
    x: coordSystem.origin.x + t * coordSystem.directionX.x * coordSystem.length,
    y: coordSystem.origin.y + t * coordSystem.directionX.y * coordSystem.length,
  };

  // Move the source gridline so it passes through this new plan point.
  // The gridline direction stays the same, but it shifts perpendicular to itself.
  const glDx = sourceGridline.end.x - sourceGridline.start.x;
  const glDy = sourceGridline.end.y - sourceGridline.start.y;
  const glLen = Math.sqrt(glDx * glDx + glDy * glDy);
  if (glLen < 1e-10) return null;

  // Project the new plan point onto the gridline direction to find how to shift
  const glUnitX = glDx / glLen;
  const glUnitY = glDy / glLen;

  // Perpendicular to gridline
  const perpX = -glUnitY;
  const perpY = glUnitX;

  // Current perpendicular distance of the gridline from origin (using midpoint)
  const glMid: Point = {
    x: (sourceGridline.start.x + sourceGridline.end.x) / 2,
    y: (sourceGridline.start.y + sourceGridline.end.y) / 2,
  };
  const oldPerpDist = glMid.x * perpX + glMid.y * perpY;

  // New perpendicular distance (project new plan point onto perp direction)
  const newPerpDist = newPlanPoint.x * perpX + newPlanPoint.y * perpY;

  // Shift amount in perpendicular direction
  const shift = newPerpDist - oldPerpDist;

  return {
    start: {
      x: sourceGridline.start.x + shift * perpX,
      y: sourceGridline.start.y + shift * perpY,
    },
    end: {
      x: sourceGridline.end.x + shift * perpX,
      y: sourceGridline.end.y + shift * perpY,
    },
  };
}

/**
 * When a level reference is moved in the section view, compute the
 * new elevation for the source storey.
 *
 * @param movedRefShape - The moved section reference level
 * @returns New elevation in mm, or null if no update needed
 */
export function syncLevelFromSection(
  movedRefShape: LevelShape,
): number | null {
  // The level's Y position in section coords = -elevation
  // So new elevation = -Y
  return -movedRefShape.start.y;
}
