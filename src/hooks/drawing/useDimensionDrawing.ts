/**
 * useDimensionDrawing - Handles dimension creation
 *
 * Dimension drawing workflow:
 * - Aligned/Linear: 3 clicks (point 1, point 2, dimension line position)
 * - Angular: 3 clicks (click line 1, click line 2, position arc)
 * - Radius: 2 clicks (click circle/arc edge, click to position)
 * - Diameter: 2 clicks (click circle/arc edge, click to position)
 */

import { useCallback, useRef } from 'react';
import { useAppStore, generateId } from '../../state/appStore';
import type { Point, SnapPoint } from '../../types/geometry';
import type { DimensionShape, DimensionReference, DimensionType } from '../../types/dimension';
import { DEFAULT_DIMENSION_STYLE } from '../../types/dimension';
import {
  calculateDimensionValue,
  formatDimensionValue,
  distance,
  angleBetweenPoints,
} from '../../utils/dimensionUtils';
import { findShapeAtPoint } from '../../services/selectionService';
import type { Shape } from '../../types/geometry';

/**
 * Compute intersection of two infinite lines defined by (p1,p2) and (p3,p4).
 * Returns null if lines are parallel.
 */
function lineLineIntersectionInfinite(p1: Point, p2: Point, p3: Point, p4: Point): Point | null {
  const denom = (p4.y - p3.y) * (p2.x - p1.x) - (p4.x - p3.x) * (p2.y - p1.y);
  if (Math.abs(denom) < 1e-10) return null;
  const ua = ((p4.x - p3.x) * (p1.y - p3.y) - (p4.y - p3.y) * (p1.x - p3.x)) / denom;
  return {
    x: p1.x + ua * (p2.x - p1.x),
    y: p1.y + ua * (p2.y - p1.y),
  };
}

/**
 * Extract a line segment from a shape, if it's a line-like shape.
 * For polyline/rectangle, returns the nearest segment to the click point.
 */
function getLineFromShape(shape: Shape, clickPoint: Point): { start: Point; end: Point } | null {
  if (shape.type === 'line') {
    return { start: shape.start, end: shape.end };
  }
  if (shape.type === 'polyline' && shape.points.length >= 2) {
    // Find the nearest segment
    let bestDist = Infinity;
    let bestSeg: { start: Point; end: Point } | null = null;
    for (let i = 0; i < shape.points.length - 1; i++) {
      const a = shape.points[i];
      const b = shape.points[i + 1];
      const d = pointToSegmentDist(clickPoint, a, b);
      if (d < bestDist) {
        bestDist = d;
        bestSeg = { start: a, end: b };
      }
    }
    if (shape.closed && shape.points.length >= 3) {
      const a = shape.points[shape.points.length - 1];
      const b = shape.points[0];
      const d = pointToSegmentDist(clickPoint, a, b);
      if (d < bestDist) {
        bestSeg = { start: a, end: b };
      }
    }
    return bestSeg;
  }
  if (shape.type === 'rectangle') {
    const tl = shape.topLeft;
    const tr = { x: tl.x + shape.width, y: tl.y };
    const br = { x: tl.x + shape.width, y: tl.y + shape.height };
    const bl = { x: tl.x, y: tl.y + shape.height };
    const segs = [
      { start: tl, end: tr },
      { start: tr, end: br },
      { start: br, end: bl },
      { start: bl, end: tl },
    ];
    let bestDist = Infinity;
    let bestSeg: { start: Point; end: Point } | null = null;
    for (const seg of segs) {
      const d = pointToSegmentDist(clickPoint, seg.start, seg.end);
      if (d < bestDist) {
        bestDist = d;
        bestSeg = seg;
      }
    }
    return bestSeg;
  }
  return null;
}

function pointToSegmentDist(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.sqrt((p.x - a.x) ** 2 + (p.y - a.y) ** 2);
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const proj = { x: a.x + t * dx, y: a.y + t * dy };
  return Math.sqrt((p.x - proj.x) ** 2 + (p.y - proj.y) ** 2);
}

export function useDimensionDrawing() {
  const {
    activeLayerId,
    activeDrawingId,
    currentStyle,
    addShape,
    drawingPoints,
    addDrawingPoint,
    clearDrawingPoints,
    setDrawingPreview,
    dimensionMode,
    shapes,
  } = useAppStore();

  // Store references separately since they're not in the store
  const referencesRef = useRef<DimensionReference[]>([]);
  // Store detected circle/arc data for radius/diameter mode (center + radius)
  const detectedCircleRef = useRef<{ center: Point; radius: number } | null>(null);
  // Store detected lines for angular mode
  const detectedLinesRef = useRef<{ start: Point; end: Point }[]>([]);

  /**
   * Create a dimension shape and add to drawing
   */
  const createDimension = useCallback(
    (
      dimensionType: DimensionType,
      points: Point[],
      dimensionLineOffset: number,
      references: DimensionReference[],
      linearDirection?: 'horizontal' | 'vertical'
    ) => {
      const value = calculateDimensionValue(points, dimensionType, linearDirection);
      const formattedValue = formatDimensionValue(value, dimensionType, DEFAULT_DIMENSION_STYLE.precision);

      // Determine prefix based on type
      let prefix: string | undefined;
      if (dimensionType === 'radius') prefix = 'R';
      if (dimensionType === 'diameter') prefix = '\u2300'; // diameter symbol

      const dimensionShape: DimensionShape = {
        id: generateId(),
        type: 'dimension',
        layerId: activeLayerId,
        drawingId: activeDrawingId,
        style: { ...currentStyle },
        visible: true,
        locked: false,
        dimensionType,
        points: [...points],
        dimensionLineOffset,
        linearDirection,
        references: references.length > 0 ? [...references] : undefined,
        value: formattedValue,
        valueOverridden: false,
        prefix,
        dimensionStyle: { ...DEFAULT_DIMENSION_STYLE },
      };

      addShape(dimensionShape);
    },
    [activeLayerId, activeDrawingId, currentStyle, addShape]
  );

  /**
   * Handle click for aligned/linear dimension (3 clicks)
   * Click 1: First point
   * Click 2: Second point
   * Click 3: Dimension line position (determines offset)
   */
  const handleAlignedClick = useCallback(
    (snappedPos: Point, snapInfo?: SnapPoint) => {
      if (drawingPoints.length === 0) {
        // First click - first point
        addDrawingPoint(snappedPos);
        if (snapInfo?.sourceShapeId) {
          referencesRef.current = [{
            shapeId: snapInfo.sourceShapeId,
            snapType: snapInfo.type,
          }];
        } else {
          referencesRef.current = [];
        }
      } else if (drawingPoints.length === 1) {
        // Second click - second point
        const p1 = drawingPoints[0];
        const dist = distance(p1, snappedPos);

        if (dist > 1) {
          addDrawingPoint(snappedPos);
          if (snapInfo?.sourceShapeId) {
            referencesRef.current.push({
              shapeId: snapInfo.sourceShapeId,
              snapType: snapInfo.type,
            });
          }
        }
      } else if (drawingPoints.length === 2) {
        // Third click - dimension line position
        const p1 = drawingPoints[0];
        const p2 = drawingPoints[1];

        // Calculate offset based on cursor position
        const lineAngle = angleBetweenPoints(p1, p2);
        const perpAngle = lineAngle + Math.PI / 2;

        // Vector from line midpoint to cursor
        const midpoint = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
        const toClick = { x: snappedPos.x - midpoint.x, y: snappedPos.y - midpoint.y };

        // Project onto perpendicular direction
        const offset = toClick.x * Math.cos(perpAngle) + toClick.y * Math.sin(perpAngle);

        // Determine linear direction based on dimension mode
        let linearDirection: 'horizontal' | 'vertical' | undefined;
        if (dimensionMode === 'linear') {
          // Determine if horizontal or vertical based on the two points
          const dx = Math.abs(p2.x - p1.x);
          const dy = Math.abs(p2.y - p1.y);
          linearDirection = dx > dy ? 'horizontal' : 'vertical';
        }

        // Create the dimension
        createDimension(
          dimensionMode === 'linear' ? 'linear' : 'aligned',
          [p1, p2],
          offset,
          referencesRef.current,
          linearDirection
        );

        // Reset
        clearDrawingPoints();
        setDrawingPreview(null);
        referencesRef.current = [];
      }
    },
    [drawingPoints, addDrawingPoint, clearDrawingPoints, setDrawingPreview, createDimension, dimensionMode]
  );

  /**
   * Handle click for angular dimension (3 clicks, Revit-style)
   * Click 1: Click on first line/edge
   * Click 2: Click on second line/edge (vertex auto-computed as intersection)
   * Click 3: Click to position dimension arc
   */
  const handleAngularClick = useCallback(
    (snappedPos: Point, _snapInfo?: SnapPoint) => {
      if (drawingPoints.length === 0) {
        // Click 1: detect first line
        const shape = findShapeAtPoint(snappedPos, shapes);
        if (shape) {
          const seg = getLineFromShape(shape, snappedPos);
          if (seg) {
            detectedLinesRef.current = [seg];
            addDrawingPoint(snappedPos);
            referencesRef.current = [{
              shapeId: shape.id,
              snapType: 'nearest',
            }];
          }
        }
      } else if (drawingPoints.length === 1) {
        // Click 2: detect second line, compute intersection
        const shape = findShapeAtPoint(snappedPos, shapes);
        if (shape) {
          const seg = getLineFromShape(shape, snappedPos);
          if (seg && detectedLinesRef.current.length === 1) {
            const line1 = detectedLinesRef.current[0];
            const vertex = lineLineIntersectionInfinite(line1.start, line1.end, seg.start, seg.end);
            if (vertex) {
              detectedLinesRef.current.push(seg);
              // Store: vertex as point[0], a point on line1, a point on line2
              // Use the endpoint of each line furthest from vertex as the reference point
              const pt1 = distance(vertex, line1.start) > distance(vertex, line1.end) ? line1.start : line1.end;
              const pt2 = distance(vertex, seg.start) > distance(vertex, seg.end) ? seg.start : seg.end;
              addDrawingPoint(vertex);   // drawingPoints[1] = vertex
              addDrawingPoint(pt1);      // drawingPoints[2] = point on line 1
              addDrawingPoint(pt2);      // drawingPoints[3] = point on line 2
              referencesRef.current.push({
                shapeId: shape.id,
                snapType: 'nearest',
              });
            }
          }
        }
      } else if (drawingPoints.length === 4) {
        // Click 3: position the arc
        const vertex = drawingPoints[1];
        const offset = distance(vertex, snappedPos);

        createDimension(
          'angular',
          [vertex, drawingPoints[2], drawingPoints[3]],
          offset,
          referencesRef.current
        );

        clearDrawingPoints();
        setDrawingPreview(null);
        referencesRef.current = [];
        detectedLinesRef.current = [];
      }
    },
    [drawingPoints, addDrawingPoint, clearDrawingPoints, setDrawingPreview, createDimension, shapes]
  );

  /**
   * Handle click for radius/diameter dimension (2 clicks, Revit-style)
   * Click 1: Click on the edge of a circle/arc — auto-detect geometry
   * Click 2: Click to position/angle the dimension line
   */
  const handleRadiusClick = useCallback(
    (snappedPos: Point, _snapInfo?: SnapPoint) => {
      if (drawingPoints.length === 0) {
        // Click 1: detect circle/arc at click point
        const shape = findShapeAtPoint(snappedPos, shapes);
        if (shape && (shape.type === 'circle' || shape.type === 'arc')) {
          const circleShape = shape as { center: Point; radius: number };
          detectedCircleRef.current = { center: circleShape.center, radius: circleShape.radius };
          addDrawingPoint(circleShape.center); // store center as the drawing point
          referencesRef.current = [{
            shapeId: shape.id,
            snapType: 'center',
          }];
        }
        // If no circle/arc found, do nothing (status message guides user)
      } else {
        // Click 2: set the angle/position of the dimension line
        const circleData = detectedCircleRef.current;
        if (circleData) {
          const { center, radius } = circleData;
          const angle = Math.atan2(snappedPos.y - center.y, snappedPos.x - center.x);
          const edgePoint: Point = {
            x: center.x + radius * Math.cos(angle),
            y: center.y + radius * Math.sin(angle),
          };

          createDimension(
            dimensionMode,
            [center, edgePoint],
            0,
            referencesRef.current
          );
        }

        clearDrawingPoints();
        setDrawingPreview(null);
        referencesRef.current = [];
        detectedCircleRef.current = null;
      }
    },
    [drawingPoints, addDrawingPoint, clearDrawingPoints, setDrawingPreview, createDimension, dimensionMode, shapes]
  );

  /**
   * Handle dimension drawing click (dispatch to appropriate handler)
   */
  const handleDimensionClick = useCallback(
    (snappedPos: Point, snapInfo?: SnapPoint): boolean => {
      switch (dimensionMode) {
        case 'aligned':
        case 'linear':
          handleAlignedClick(snappedPos, snapInfo);
          return true;
        case 'angular':
          handleAngularClick(snappedPos, snapInfo);
          return true;
        case 'radius':
        case 'diameter':
          handleRadiusClick(snappedPos, snapInfo);
          return true;
        default:
          return false;
      }
    },
    [dimensionMode, handleAlignedClick, handleAngularClick, handleRadiusClick]
  );

  /**
   * Update dimension preview for aligned/linear dimension
   */
  const updateAlignedPreview = useCallback(
    (snappedPos: Point) => {
      if (drawingPoints.length === 0) return;

      if (drawingPoints.length === 1) {
        // Show line from first point to cursor
        setDrawingPreview({
          type: 'line',
          start: drawingPoints[0],
          end: snappedPos,
        });
      } else if (drawingPoints.length === 2) {
        // Show dimension preview
        const p1 = drawingPoints[0];
        const p2 = drawingPoints[1];

        // Calculate offset
        const lineAngle = angleBetweenPoints(p1, p2);
        const perpAngle = lineAngle + Math.PI / 2;
        const midpoint = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
        const toClick = { x: snappedPos.x - midpoint.x, y: snappedPos.y - midpoint.y };
        const offset = toClick.x * Math.cos(perpAngle) + toClick.y * Math.sin(perpAngle);

        // Determine linear direction
        let linearDirection: 'horizontal' | 'vertical' | undefined;
        if (dimensionMode === 'linear') {
          const dx = Math.abs(p2.x - p1.x);
          const dy = Math.abs(p2.y - p1.y);
          linearDirection = dx > dy ? 'horizontal' : 'vertical';
        }

        const value = calculateDimensionValue([p1, p2], dimensionMode === 'linear' ? 'linear' : 'aligned', linearDirection);
        const formattedValue = formatDimensionValue(value, dimensionMode === 'linear' ? 'linear' : 'aligned', DEFAULT_DIMENSION_STYLE.precision);

        setDrawingPreview({
          type: 'dimension',
          dimensionType: dimensionMode === 'linear' ? 'linear' : 'aligned',
          points: [p1, p2],
          dimensionLineOffset: offset,
          linearDirection,
          value: formattedValue,
        });
      }
    },
    [drawingPoints, setDrawingPreview, dimensionMode]
  );

  /**
   * Update dimension preview for angular dimension
   */
  const updateAngularPreview = useCallback(
    (snappedPos: Point) => {
      if (drawingPoints.length === 0) return;

      if (drawingPoints.length === 1) {
        // First line selected, show highlight line of first detected segment
        if (detectedLinesRef.current.length === 1) {
          const seg = detectedLinesRef.current[0];
          setDrawingPreview({
            type: 'line',
            start: seg.start,
            end: seg.end,
          });
        }
      } else if (drawingPoints.length === 4) {
        // Both lines detected, show angular dimension preview
        const vertex = drawingPoints[1];
        const offset = distance(vertex, snappedPos);
        const value = calculateDimensionValue([vertex, drawingPoints[2], drawingPoints[3]], 'angular');
        const formattedValue = formatDimensionValue(value, 'angular', DEFAULT_DIMENSION_STYLE.precision);

        setDrawingPreview({
          type: 'dimension',
          dimensionType: 'angular',
          points: [vertex, drawingPoints[2], drawingPoints[3]],
          dimensionLineOffset: offset,
          value: formattedValue,
        });
      }
    },
    [drawingPoints, setDrawingPreview]
  );

  /**
   * Update dimension preview for radius/diameter dimension
   */
  const updateRadiusPreview = useCallback(
    (snappedPos: Point) => {
      if (drawingPoints.length === 0 || !detectedCircleRef.current) return;

      const { center, radius } = detectedCircleRef.current;
      const angle = Math.atan2(snappedPos.y - center.y, snappedPos.x - center.x);
      const edgePoint: Point = {
        x: center.x + radius * Math.cos(angle),
        y: center.y + radius * Math.sin(angle),
      };

      const value = calculateDimensionValue([center, edgePoint], dimensionMode);
      const formattedValue = formatDimensionValue(value, dimensionMode, DEFAULT_DIMENSION_STYLE.precision);

      setDrawingPreview({
        type: 'dimension',
        dimensionType: dimensionMode,
        points: [center, edgePoint],
        dimensionLineOffset: 0,
        value: formattedValue,
      });
    },
    [drawingPoints, setDrawingPreview, dimensionMode]
  );

  /**
   * Update dimension preview based on dimension mode
   */
  const updateDimensionPreview = useCallback(
    (snappedPos: Point) => {
      if (drawingPoints.length === 0) return;

      switch (dimensionMode) {
        case 'aligned':
        case 'linear':
          updateAlignedPreview(snappedPos);
          break;
        case 'angular':
          updateAngularPreview(snappedPos);
          break;
        case 'radius':
        case 'diameter':
          updateRadiusPreview(snappedPos);
          break;
      }
    },
    [dimensionMode, drawingPoints, updateAlignedPreview, updateAngularPreview, updateRadiusPreview]
  );

  /**
   * Cancel current dimension drawing
   */
  const cancelDimensionDrawing = useCallback(() => {
    clearDrawingPoints();
    setDrawingPreview(null);
    referencesRef.current = [];
    detectedCircleRef.current = null;
    detectedLinesRef.current = [];
  }, [clearDrawingPoints, setDrawingPreview]);

  /**
   * Get status message for current dimension drawing state
   */
  const getDimensionStatus = useCallback((): string => {
    const pointCount = drawingPoints.length;

    switch (dimensionMode) {
      case 'aligned':
      case 'linear':
        if (pointCount === 0) return 'Select first point';
        if (pointCount === 1) return 'Select second point';
        if (pointCount === 2) return 'Click to position dimension line';
        break;
      case 'angular':
        if (pointCount === 0) return 'Click on first line';
        if (pointCount === 1) return 'Click on second line';
        if (pointCount === 4) return 'Click to position dimension arc';
        break;
      case 'radius':
        if (pointCount === 0) return 'Click on a circle or arc';
        if (pointCount === 1) return 'Click to position radius line';
        break;
      case 'diameter':
        if (pointCount === 0) return 'Click on a circle or arc';
        if (pointCount === 1) return 'Click to position diameter line';
        break;
    }
    return '';
  }, [dimensionMode, drawingPoints]);

  return {
    handleDimensionClick,
    updateDimensionPreview,
    cancelDimensionDrawing,
    getDimensionStatus,
    createDimension,
  };
}
