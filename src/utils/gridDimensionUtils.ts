/**
 * gridDimensionUtils - Auto-generates dimension lines between gridlines.
 *
 * Extracted from DrawingStandardsDialog so it can be called automatically
 * whenever gridlines are added or changed.
 *
 * Dimension measurement points are placed at the bubble inner edge
 * (where the bubble circle meets the gridline extension) so the total
 * dimension line sits at the intersection of bubble and gridline.
 */

import type { GridlineShape, Point, Shape } from '../types/geometry';
import type { DimensionShape } from '../types/dimension';
import { DIM_ASSOCIATE_STYLE } from '../constants/cadDefaults';
import { calculateDimensionValue, formatDimAssociateValue } from '../engine/geometry/DimensionUtils';
import { useAppStore } from '../state/appStore';
import { classifyGridlineOrientation, groupGridlinesByAngle, getGridlineAngleDeg } from './gridlineUtils';

/**
 * Helper: create a DimensionShape for grid dimensioning using DimAssociate style.
 * Optionally links to two gridline IDs for associativity.
 */
function makeDim(
  p1: Point,
  p2: Point,
  offset: number,
  direction: 'horizontal' | 'vertical',
  drawingId: string,
  layerId: string,
  linkedGridlineIds?: [string, string],
): DimensionShape {
  const value = calculateDimensionValue([p1, p2], 'linear', direction);
  const formattedValue = formatDimAssociateValue(value);
  return {
    id: crypto.randomUUID(),
    type: 'dimension',
    layerId,
    drawingId,
    style: { strokeColor: '#000000', strokeWidth: 2.5, lineStyle: 'solid' as const },
    visible: true,
    locked: false,
    dimensionType: 'linear',
    points: [p1, p2],
    dimensionLineOffset: offset,
    linearDirection: direction,
    value: formattedValue,
    valueOverridden: false,
    dimensionStyle: { ...DIM_ASSOCIATE_STYLE },
    isGridDimension: true,
    dimensionStyleName: 'DimAssociate',
    linkedGridlineIds,
  };
}

/**
 * Helper: create an aligned DimensionShape for angled grid dimensioning.
 * Aligned dimensions measure the true distance between points and the
 * dimension line runs perpendicular to the gridline direction.
 */
function makeAlignedDim(
  p1: Point,
  p2: Point,
  offset: number,
  drawingId: string,
  layerId: string,
  linkedGridlineIds?: [string, string],
): DimensionShape {
  const value = calculateDimensionValue([p1, p2], 'aligned');
  const formattedValue = formatDimAssociateValue(value);
  return {
    id: crypto.randomUUID(),
    type: 'dimension',
    layerId,
    drawingId,
    style: { strokeColor: '#000000', strokeWidth: 2.5, lineStyle: 'solid' as const },
    visible: true,
    locked: false,
    dimensionType: 'aligned',
    points: [p1, p2],
    dimensionLineOffset: offset,
    value: formattedValue,
    valueOverridden: false,
    dimensionStyle: { ...DIM_ASSOCIATE_STYLE },
    isGridDimension: true,
    dimensionStyleName: 'DimAssociate',
    linkedGridlineIds,
  };
}

/**
 * Compute the bubble inner edge position for a gridline on a specific side.
 * This is the point where the bubble circle intersects the gridline extension,
 * i.e. at distance `scaledExt` from the endpoint (NOT the bubble center).
 *
 * The bubble center is at `ext + bubbleR` from the endpoint, but the inner
 * edge of the bubble circle is at just `ext` from the endpoint.
 */
function getBubbleInnerEdge(
  g: GridlineShape,
  side: 'start' | 'end',
  scaledExt: number,
): Point {
  const angle = Math.atan2(g.end.y - g.start.y, g.end.x - g.start.x);
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);
  if (side === 'start') {
    return {
      x: g.start.x - dx * scaledExt,
      y: g.start.y - dy * scaledExt,
    };
  } else {
    return {
      x: g.end.x + dx * scaledExt,
      y: g.end.y + dy * scaledExt,
    };
  }
}

/**
 * For a vertical gridline, determine which endpoint side ('start' or 'end')
 * has the smaller Y (min-Y side) and which has the larger Y (max-Y side).
 */
function getVerticalEndpointSides(g: GridlineShape): { minYSide: 'start' | 'end'; maxYSide: 'start' | 'end' } {
  if (g.start.y <= g.end.y) {
    return { minYSide: 'start', maxYSide: 'end' };
  } else {
    return { minYSide: 'end', maxYSide: 'start' };
  }
}

/**
 * For a horizontal gridline, determine which endpoint side ('start' or 'end')
 * has the smaller X (min-X side) and which has the larger X (max-X side).
 */
function getHorizontalEndpointSides(g: GridlineShape): { minXSide: 'start' | 'end'; maxXSide: 'start' | 'end' } {
  if (g.start.x <= g.end.x) {
    return { minXSide: 'start', maxXSide: 'end' };
  } else {
    return { minXSide: 'end', maxXSide: 'start' };
  }
}

/**
 * Regenerate all grid dimension lines for the active drawing.
 * Removes existing auto-generated grid dimensions and creates new ones.
 *
 * Dimension measurement points are placed at the bubble center positions
 * so the dimension line sits right at the gridline bubbles.
 *
 * Options control which sides to place dimensions on.
 */
export interface GridDimensionOptions {
  placeBottom?: boolean;
  placeTop?: boolean;
  placeLeft?: boolean;
  placeRight?: boolean;
  includeTotal?: boolean;
}

const DEFAULT_OPTIONS: GridDimensionOptions = {
  placeBottom: true,
  placeTop: false,
  placeLeft: true,
  placeRight: false,
  includeTotal: true,
};

export function regenerateGridDimensions(options: GridDimensionOptions = DEFAULT_OPTIONS): void {
  const state = useAppStore.getState();
  const { shapes, activeDrawingId, activeLayerId, addShapes, deleteShapes } = state;
  const storeGridlineExtension = state.gridlineExtension;
  const storeDimLineOffset = state.gridDimensionLineOffset;

  if (!activeDrawingId) return;

  // Remove existing auto-generated grid dimensions
  const existingGridDims = shapes.filter(
    s => s.type === 'dimension' && s.drawingId === activeDrawingId &&
      ((s as DimensionShape).isGridDimension === true)
  );
  if (existingGridDims.length > 0) {
    deleteShapes(existingGridDims.map(s => s.id));
  }

  const gridlines = shapes.filter(
    (s): s is GridlineShape => s.type === 'gridline' && s.drawingId === activeDrawingId && !s.id.startsWith('section-ref-')
  );
  if (gridlines.length < 2) return;

  // Classify gridlines into axis-aligned (vertical/horizontal) and angled groups
  const verticals: GridlineShape[] = [];
  const horizontals: GridlineShape[] = [];
  const angledGridlines: GridlineShape[] = [];

  for (const g of gridlines) {
    const orient = classifyGridlineOrientation(g.start, g.end);
    if (orient === 'vertical') verticals.push(g);
    else if (orient === 'horizontal') horizontals.push(g);
    else angledGridlines.push(g);
  }

  // Calculate scale-adjusted offsets (matches renderer scaleFactor = LINE_DASH_REFERENCE_SCALE / drawingScale)
  const drawingScale = state.drawings.find(d => d.id === activeDrawingId)?.scale || 0.02;
  const scaleFactor = 0.01 / drawingScale;
  const scaledExt = storeGridlineExtension * 0.01;

  // Row offset between total and span dimension lines (300mm default)
  const rowOffset = storeDimLineOffset * scaleFactor;

  const {
    placeBottom = true,
    placeTop = false,
    placeLeft = true,
    placeRight = false,
    includeTotal = true,
  } = options;

  const newDims: DimensionShape[] = [];

  // Vertical gridlines -> horizontal dimensions (bottom / top)
  if (verticals.length >= 2) {
    const sorted = [...verticals].sort((a, b) => (a.start.x + a.end.x) / 2 - (b.start.x + b.end.x) / 2);

    // For "placeBottom", use the min-Y endpoint side of each gridline (the bubble extending further in the min-Y direction).
    // For "placeTop", use the max-Y endpoint side.
    // The sign controls which direction span rows are offset (further away from the grid).
    const placeSides: { sideKey: 'minY' | 'maxY'; sign: number }[] = [];
    if (placeBottom) placeSides.push({ sideKey: 'minY', sign: -1 });
    if (placeTop) placeSides.push({ sideKey: 'maxY', sign: 1 });

    for (const side of placeSides) {
      // Compute bubble center Y for each gridline on the relevant side, then pick the
      // extreme value so the dimension line aligns with (or is beyond) all bubbles.
      const bubbleEdges = sorted.map(g => {
        const sides = getVerticalEndpointSides(g);
        const endpointSide = side.sideKey === 'minY' ? sides.minYSide : sides.maxYSide;
        return getBubbleInnerEdge(g, endpointSide, scaledExt);
      });

      // Pick the most extreme bubble inner edge Y for the dimension reference line
      const refY = side.sideKey === 'minY'
        ? Math.min(...bubbleEdges.map(bc => bc.y))
        : Math.max(...bubbleEdges.map(bc => bc.y));

      // Total dimension: measurement points at bubble inner edge Y, offset = 0
      if (includeTotal && sorted.length >= 2) {
        const x1 = (sorted[0].start.x + sorted[0].end.x) / 2;
        const x2 = (sorted[sorted.length - 1].start.x + sorted[sorted.length - 1].end.x) / 2;
        newDims.push(makeDim(
          { x: x1, y: refY }, { x: x2, y: refY },
          0, 'horizontal',
          activeDrawingId, activeLayerId,
          [sorted[0].id, sorted[sorted.length - 1].id]
        ));
      }

      // Span dimensions: offset one row INWARD (between gridlines and total dim)
      const spanOffset = includeTotal ? -side.sign * rowOffset : 0;
      for (let i = 0; i < sorted.length - 1; i++) {
        const x1 = (sorted[i].start.x + sorted[i].end.x) / 2;
        const x2 = (sorted[i + 1].start.x + sorted[i + 1].end.x) / 2;
        newDims.push(makeDim(
          { x: x1, y: refY }, { x: x2, y: refY },
          spanOffset, 'horizontal',
          activeDrawingId, activeLayerId,
          [sorted[i].id, sorted[i + 1].id]
        ));
      }
    }
  }

  // Horizontal gridlines -> vertical dimensions (left / right)
  if (horizontals.length >= 2) {
    const sorted = [...horizontals].sort((a, b) => (a.start.y + a.end.y) / 2 - (b.start.y + b.end.y) / 2);

    const placeSides: { sideKey: 'minX' | 'maxX'; sign: number }[] = [];
    if (placeLeft) placeSides.push({ sideKey: 'minX', sign: -1 });
    if (placeRight) placeSides.push({ sideKey: 'maxX', sign: 1 });

    for (const side of placeSides) {
      // Compute bubble inner edge X for each gridline on the relevant side
      const bubbleEdges = sorted.map(g => {
        const sides = getHorizontalEndpointSides(g);
        const endpointSide = side.sideKey === 'minX' ? sides.minXSide : sides.maxXSide;
        return getBubbleInnerEdge(g, endpointSide, scaledExt);
      });

      // Pick the most extreme bubble inner edge X for the dimension reference line
      const refX = side.sideKey === 'minX'
        ? Math.min(...bubbleEdges.map(bc => bc.x))
        : Math.max(...bubbleEdges.map(bc => bc.x));

      // Total dimension: measurement points at bubble inner edge X, offset = 0
      if (includeTotal && sorted.length >= 2) {
        const y1 = (sorted[0].start.y + sorted[0].end.y) / 2;
        const y2 = (sorted[sorted.length - 1].start.y + sorted[sorted.length - 1].end.y) / 2;
        newDims.push(makeDim(
          { x: refX, y: y1 }, { x: refX, y: y2 },
          0, 'vertical',
          activeDrawingId, activeLayerId,
          [sorted[0].id, sorted[sorted.length - 1].id]
        ));
      }

      // Span dimensions: offset one row INWARD (between gridlines and total dim)
      const spanOffset = includeTotal ? -side.sign * rowOffset : 0;
      for (let i = 0; i < sorted.length - 1; i++) {
        const y1 = (sorted[i].start.y + sorted[i].end.y) / 2;
        const y2 = (sorted[i + 1].start.y + sorted[i + 1].end.y) / 2;
        newDims.push(makeDim(
          { x: refX, y: y1 }, { x: refX, y: y2 },
          spanOffset, 'vertical',
          activeDrawingId, activeLayerId,
          [sorted[i].id, sorted[i + 1].id]
        ));
      }
    }
  }

  // Angled gridline groups → aligned dimensions perpendicular to their direction.
  // Each angle group gets its own independent dimension set.
  if (angledGridlines.length >= 2) {
    const angleGroups = groupGridlinesByAngle(angledGridlines);

    for (const group of angleGroups) {
      if (group.length < 2) continue;

      // All gridlines in this group are roughly parallel.
      // Sort by perpendicular distance from an arbitrary reference line through the first gridline.
      const refAngle = getGridlineAngleDeg(group[0]) * Math.PI / 180;
      // Perpendicular unit vector (used as sort axis)
      const perpX = -Math.sin(refAngle);
      const perpY = Math.cos(refAngle);

      const sorted = [...group].sort((a, b) => {
        const midA = { x: (a.start.x + a.end.x) / 2, y: (a.start.y + a.end.y) / 2 };
        const midB = { x: (b.start.x + b.end.x) / 2, y: (b.start.y + b.end.y) / 2 };
        return (midA.x * perpX + midA.y * perpY) - (midB.x * perpX + midB.y * perpY);
      });

      // Use midpoints of each gridline as measurement points
      const midpoints = sorted.map(g => ({
        x: (g.start.x + g.end.x) / 2,
        y: (g.start.y + g.end.y) / 2,
      }));

      // Project midpoints onto the perpendicular axis to get measurement points
      // that lie along a line perpendicular to the gridline direction
      const lineDir = { x: Math.cos(refAngle), y: Math.sin(refAngle) };

      // Place dimension line at the "start" end of gridlines (bubble inner edge)
      const bubbleEdges = sorted.map(g => getBubbleInnerEdge(g, 'start', scaledExt));

      // Find the most extreme point along the gridline direction to place the dimension line
      const projections = bubbleEdges.map(pt => pt.x * lineDir.x + pt.y * lineDir.y);
      const minProj = Math.min(...projections);

      // Compute dimension measurement points: project each midpoint onto the perpendicular axis,
      // placed at the reference distance along the gridline direction
      const dimPoints: Point[] = midpoints.map(mp => {
        const perpDist = mp.x * perpX + mp.y * perpY;
        return {
          x: lineDir.x * minProj + perpX * perpDist - lineDir.x * rowOffset,
          y: lineDir.y * minProj + perpY * perpDist - lineDir.y * rowOffset,
        };
      });

      // Total dimension
      if (includeTotal && sorted.length >= 2) {
        newDims.push(makeAlignedDim(
          dimPoints[0], dimPoints[dimPoints.length - 1],
          0,
          activeDrawingId, activeLayerId,
          [sorted[0].id, sorted[sorted.length - 1].id]
        ));
      }

      // Span dimensions
      const spanOffset = includeTotal ? -rowOffset : 0;
      for (let i = 0; i < sorted.length - 1; i++) {
        newDims.push(makeAlignedDim(
          dimPoints[i], dimPoints[i + 1],
          spanOffset,
          activeDrawingId, activeLayerId,
          [sorted[i].id, sorted[i + 1].id]
        ));
      }
    }
  }

  if (newDims.length > 0) {
    addShapes(newDims);
  }
}

/**
 * Update all DimAssociate dimensions that are linked to a specific gridline.
 * Called when a gridline is moved so that associative dimensions update automatically.
 *
 * For each linked dimension, recalculates the measurement point positions
 * based on the current gridline positions and updates the dimension value.
 */
export function updateLinkedDimensions(movedGridlineId: string): void {
  const state = useAppStore.getState();
  const { shapes, updateShape } = state;

  // Find all dimensions linked to this gridline
  const linkedDims = shapes.filter(
    (s): s is DimensionShape =>
      s.type === 'dimension' &&
      (s as DimensionShape).linkedGridlineIds != null &&
      (s as DimensionShape).linkedGridlineIds!.includes(movedGridlineId)
  );

  if (linkedDims.length === 0) return;

  for (const dim of linkedDims) {
    const [glId1, glId2] = dim.linkedGridlineIds!;
    const gl1 = shapes.find(s => s.id === glId1 && s.type === 'gridline') as GridlineShape | undefined;
    const gl2 = shapes.find(s => s.id === glId2 && s.type === 'gridline') as GridlineShape | undefined;

    if (!gl1 || !gl2) continue; // One of the linked gridlines was deleted

    // Compute the midpoint X or Y of each gridline (depending on dimension direction)
    const direction = dim.linearDirection;
    let p1: Point;
    let p2: Point;

    if (direction === 'horizontal') {
      // Vertical gridlines -> horizontal dimension: use X midpoints at the dimension line's Y
      const x1 = (gl1.start.x + gl1.end.x) / 2;
      const x2 = (gl2.start.x + gl2.end.x) / 2;
      // Preserve the current Y position of the dimension points
      const y = dim.points[0].y;
      p1 = { x: x1, y };
      p2 = { x: x2, y };
    } else if (direction === 'vertical') {
      // Horizontal gridlines -> vertical dimension: use Y midpoints at the dimension line's X
      const y1 = (gl1.start.y + gl1.end.y) / 2;
      const y2 = (gl2.start.y + gl2.end.y) / 2;
      // Preserve the current X position of the dimension points
      const x = dim.points[0].x;
      p1 = { x, y: y1 };
      p2 = { x, y: y2 };
    } else {
      // Aligned dimension: use midpoints of gridlines
      p1 = { x: (gl1.start.x + gl1.end.x) / 2, y: (gl1.start.y + gl1.end.y) / 2 };
      p2 = { x: (gl2.start.x + gl2.end.x) / 2, y: (gl2.start.y + gl2.end.y) / 2 };
    }

    // Recalculate value
    const value = calculateDimensionValue([p1, p2], dim.dimensionType, direction);
    const formattedValue = dim.valueOverridden ? dim.value : formatDimAssociateValue(value);

    updateShape(dim.id, {
      points: [p1, p2],
      value: formattedValue,
    } as Partial<Shape>);
  }
}
