/**
 * useShapeDrawing - Handles shape drawing (line, rectangle, circle, arc, polyline, dimension)
 */

import { useCallback } from 'react';
import { useAppStore, generateId } from '../../state/appStore';
import type { Point, LineShape, RectangleShape, CircleShape, ArcShape, PolylineShape, SplineShape, EllipseShape, SnapPoint, Shape, HatchShape } from '../../types/geometry';
import { snapToAngle, calculateCircleFrom3Points, isPointNearShape, findClosedShapeContainingPoint, getShapeBoundaryWithBulge, calculateBulgeFrom3Points } from '../../engine/geometry/GeometryUtils';
import { useDimensionDrawing } from './useDimensionDrawing';

/**
 * Calculate angle from center to point (in radians, 0 = right, counter-clockwise positive)
 */
function angleFromCenter(center: Point, point: Point): number {
  return Math.atan2(point.y - center.y, point.x - center.x);
}

/**
 * Normalize angle to [0, 2*PI) range
 */
function normalizeAngle(angle: number): number {
  let a = angle % (Math.PI * 2);
  if (a < 0) a += Math.PI * 2;
  return a;
}

/**
 * Calculate arc from 3 points (start, point on arc, end)
 * Returns center, radius, startAngle, endAngle
 */
function calculateArcFrom3Points(
  start: Point,
  mid: Point,
  end: Point
): { center: Point; radius: number; startAngle: number; endAngle: number } | null {
  // Use circle calculation to find center and radius
  const circle = calculateCircleFrom3Points(start, mid, end);
  if (!circle) return null;

  const { center, radius } = circle;

  // Calculate angles from center to each point
  const startAngle = angleFromCenter(center, start);
  const midAngle = angleFromCenter(center, mid);
  const endAngle = angleFromCenter(center, end);

  // Determine arc direction by checking if mid point is on the shorter or longer path
  // Normalize all angles to [0, 2*PI)
  const nStart = normalizeAngle(startAngle);
  const nMid = normalizeAngle(midAngle);
  const nEnd = normalizeAngle(endAngle);

  // Check if going from start to end counter-clockwise passes through mid
  const ccwFromStart = (angle: number) => {
    const diff = normalizeAngle(angle - nStart);
    return diff;
  };

  const midCcw = ccwFromStart(nMid);
  const endCcw = ccwFromStart(nEnd);

  // If mid is between start and end going counter-clockwise, use that direction
  // Otherwise, go clockwise (swap start/end or adjust angles)
  if (midCcw < endCcw) {
    // Counter-clockwise from start to end passes through mid - this is correct
    return { center, radius, startAngle, endAngle };
  } else {
    // Need to go the other way - swap the angles
    return { center, radius, startAngle: endAngle, endAngle: startAngle };
  }
}

/**
 * Apply locked distance and angle constraints to a point relative to a base point.
 */
function applyLockedConstraints(
  basePoint: Point,
  currentPoint: Point,
  lockedDistance: number | null,
  lockedAngle: number | null
): Point {
  const dx = currentPoint.x - basePoint.x;
  const dy = currentPoint.y - basePoint.y;
  let dist = Math.sqrt(dx * dx + dy * dy);
  let angle = Math.atan2(dy, dx);

  if (lockedDistance !== null) {
    dist = lockedDistance;
  }
  if (lockedAngle !== null) {
    angle = (lockedAngle * Math.PI) / 180; // Convert degrees to radians
  }

  return {
    x: basePoint.x + dist * Math.cos(angle),
    y: basePoint.y + dist * Math.sin(angle),
  };
}

export function useShapeDrawing() {
  const {
    activeTool,
    activeLayerId,
    activeDrawingId,
    currentStyle,
    addShape,
    drawingPoints,
    addDrawingPoint,
    clearDrawingPoints,
    setDrawingPreview,
    circleMode,
    rectangleMode,
    arcMode,
    ellipseMode,
    chainMode,
    lockedRadius,
    lockedDistance,
    lockedAngle,
    setLockedDistance,
    setLockedAngle,
    polylineArcMode,
    polylineArcThroughPoint,
    setPolylineArcThroughPoint,
    drawingBulges,
    addDrawingBulge,
  } = useAppStore();

  // Dimension drawing hook
  const dimensionDrawing = useDimensionDrawing();

  /**
   * Create a line shape
   */
  const createLine = useCallback(
    (start: Point, end: Point) => {
      const lineShape: LineShape = {
        id: generateId(),
        type: 'line',
        layerId: activeLayerId,
        drawingId: activeDrawingId,
        style: { ...currentStyle },
        visible: true,
        locked: false,
        start,
        end,
      };
      addShape(lineShape);
    },
    [activeLayerId, activeDrawingId, currentStyle, addShape]
  );

  /**
   * Create a rectangle shape
   */
  const createRectangle = useCallback(
    (topLeft: Point, width: number, height: number, rotation: number = 0) => {
      const { cornerRadius } = useAppStore.getState();
      const rectShape: RectangleShape = {
        id: generateId(),
        type: 'rectangle',
        layerId: activeLayerId,
        drawingId: activeDrawingId,
        style: { ...currentStyle },
        visible: true,
        locked: false,
        topLeft,
        width,
        height,
        rotation,
        ...(cornerRadius > 0 && { cornerRadius }),
      };
      addShape(rectShape);
    },
    [activeLayerId, activeDrawingId, currentStyle, addShape]
  );

  /**
   * Create a circle shape
   */
  const createCircle = useCallback(
    (center: Point, radius: number) => {
      const circleShape: CircleShape = {
        id: generateId(),
        type: 'circle',
        layerId: activeLayerId,
        drawingId: activeDrawingId,
        style: { ...currentStyle },
        visible: true,
        locked: false,
        center,
        radius,
      };
      addShape(circleShape);
    },
    [activeLayerId, activeDrawingId, currentStyle, addShape]
  );

  /**
   * Create a polyline shape
   */
  const createPolyline = useCallback(
    (points: Point[], closed: boolean = false, bulge?: number[]) => {
      if (points.length < 2) return;
      const polylineShape: PolylineShape = {
        id: generateId(),
        type: 'polyline',
        layerId: activeLayerId,
        drawingId: activeDrawingId,
        style: { ...currentStyle },
        visible: true,
        locked: false,
        points: [...points],
        closed,
        bulge: bulge && bulge.some(b => b !== 0) ? [...bulge] : undefined,
      };
      addShape(polylineShape);
    },
    [activeLayerId, activeDrawingId, currentStyle, addShape]
  );

  /**
   * Create a spline shape
   */
  const createSpline = useCallback(
    (points: Point[], closed: boolean = false) => {
      if (points.length < 2) return;
      const splineShape: SplineShape = {
        id: generateId(),
        type: 'spline',
        layerId: activeLayerId,
        drawingId: activeDrawingId,
        style: { ...currentStyle },
        visible: true,
        locked: false,
        points: [...points],
        closed,
      };
      addShape(splineShape);
    },
    [activeLayerId, activeDrawingId, currentStyle, addShape]
  );

  /**
   * Create an arc shape
   */
  const createArc = useCallback(
    (center: Point, radius: number, startAngle: number, endAngle: number) => {
      const arcShape: ArcShape = {
        id: generateId(),
        type: 'arc',
        layerId: activeLayerId,
        drawingId: activeDrawingId,
        style: { ...currentStyle },
        visible: true,
        locked: false,
        center,
        radius,
        startAngle,
        endAngle,
      };
      addShape(arcShape);
    },
    [activeLayerId, activeDrawingId, currentStyle, addShape]
  );

  /**
   * Create an ellipse shape
   */
  const createEllipse = useCallback(
    (center: Point, radiusX: number, radiusY: number, rotation: number = 0, startAngle?: number, endAngle?: number) => {
      const ellipseShape: EllipseShape = {
        id: generateId(),
        type: 'ellipse',
        layerId: activeLayerId,
        drawingId: activeDrawingId,
        style: { ...currentStyle },
        visible: true,
        locked: false,
        center,
        radiusX,
        radiusY,
        rotation,
        ...(startAngle !== undefined && { startAngle }),
        ...(endAngle !== undefined && { endAngle }),
      };
      addShape(ellipseShape);
    },
    [activeLayerId, activeDrawingId, currentStyle, addShape]
  );

  /**
   * Create a hatch shape
   */
  const createHatch = useCallback(
    (points: Point[], bulge?: number[]) => {
      if (points.length < 3) return;
      const {
        hatchPatternType,
        hatchPatternAngle,
        hatchPatternScale,
        hatchFillColor,
        hatchBackgroundColor,
      } = useAppStore.getState();
      const hatchShape: HatchShape = {
        id: generateId(),
        type: 'hatch',
        layerId: activeLayerId,
        drawingId: activeDrawingId,
        style: { ...currentStyle },
        visible: true,
        locked: false,
        points: [...points],
        bulge: bulge ? [...bulge] : undefined,
        patternType: hatchPatternType,
        patternAngle: hatchPatternAngle,
        patternScale: hatchPatternScale,
        fillColor: hatchFillColor,
        backgroundColor: hatchBackgroundColor ?? undefined,
      };
      addShape(hatchShape);
    },
    [activeLayerId, activeDrawingId, currentStyle, addShape]
  );

  /**
   * Handle click for hatch drawing
   * - If clicking inside a closed shape (circle, rectangle, ellipse, closed polyline), fill it immediately
   * - Otherwise, draw a new hatch boundary polygon
   */
  const handleHatchClick = useCallback(
    (snappedPos: Point, shiftKey: boolean) => {
      // If no points drawn yet, check if clicking inside an existing closed shape
      if (drawingPoints.length === 0) {
        const { shapes } = useAppStore.getState();
        const activeShapes = shapes.filter(s => s.drawingId === activeDrawingId);
        const containingShape = findClosedShapeContainingPoint(snappedPos, activeShapes);

        if (containingShape) {
          // Get boundary points and bulge data from the shape
          const boundary = getShapeBoundaryWithBulge(containingShape);
          if (boundary.points.length >= 3) {
            // Create hatch immediately with this boundary (including curves)
            createHatch(boundary.points, boundary.bulge);
            return;
          }
        }
      }

      // Fall back to drawing a new boundary polygon
      let finalPos = snappedPos;
      if (shiftKey && drawingPoints.length > 0) {
        const lastPoint = drawingPoints[drawingPoints.length - 1];
        finalPos = snapToAngle(lastPoint, snappedPos);
      }
      addDrawingPoint(finalPos);
    },
    [drawingPoints, addDrawingPoint, activeDrawingId, createHatch]
  );

  /**
   * Update hatch preview (polyline-like)
   */
  const updateHatchPreview = useCallback(
    (snappedPos: Point, shiftKey: boolean) => {
      if (drawingPoints.length === 0) return;
      const lastPoint = drawingPoints[drawingPoints.length - 1];
      let previewPos = shiftKey ? snapToAngle(lastPoint, snappedPos) : snappedPos;

      if (lockedDistance !== null || lockedAngle !== null) {
        previewPos = applyLockedConstraints(lastPoint, previewPos, lockedDistance, lockedAngle);
      }

      setDrawingPreview({
        type: 'hatch',
        points: drawingPoints,
        currentPoint: previewPos,
      });
    },
    [drawingPoints, setDrawingPreview, lockedDistance, lockedAngle]
  );

  /**
   * Handle click for line drawing
   */
  const handleLineClick = useCallback(
    (snappedPos: Point, shiftKey: boolean) => {
      if (drawingPoints.length === 0) {
        addDrawingPoint(snappedPos);
      } else {
        const lastPoint = drawingPoints[drawingPoints.length - 1];
        let finalPos = shiftKey ? snapToAngle(lastPoint, snappedPos) : snappedPos;

        // Apply locked distance/angle constraints
        if (lockedDistance !== null || lockedAngle !== null) {
          finalPos = applyLockedConstraints(lastPoint, finalPos, lockedDistance, lockedAngle);
        }

        const dx = Math.abs(finalPos.x - lastPoint.x);
        const dy = Math.abs(finalPos.y - lastPoint.y);

        if (dx > 1 || dy > 1) {
          createLine(lastPoint, finalPos);
          // Clear locked values after use
          if (lockedDistance !== null) setLockedDistance(null);
          if (lockedAngle !== null) setLockedAngle(null);

          if (chainMode) {
            // Chain mode: continue from endpoint
            addDrawingPoint(finalPos);
          } else {
            // Single segment mode: reset
            clearDrawingPoints();
            setDrawingPreview(null);
            addDrawingPoint(snappedPos); // Start fresh with new first point
          }
        }
      }
    },
    [drawingPoints, addDrawingPoint, createLine, chainMode, lockedDistance, lockedAngle, setLockedDistance, setLockedAngle, clearDrawingPoints, setDrawingPreview]
  );

  /**
   * Handle click for rectangle drawing
   */
  const handleRectangleClick = useCallback(
    (snappedPos: Point) => {
      switch (rectangleMode) {
        case 'corner': {
          if (drawingPoints.length === 0) {
            addDrawingPoint(snappedPos);
          } else {
            const startPoint = drawingPoints[0];
            const dx = Math.abs(snappedPos.x - startPoint.x);
            const dy = Math.abs(snappedPos.y - startPoint.y);

            if (dx > 1 || dy > 1) {
              const width = snappedPos.x - startPoint.x;
              const height = snappedPos.y - startPoint.y;
              createRectangle(
                {
                  x: width > 0 ? startPoint.x : snappedPos.x,
                  y: height > 0 ? startPoint.y : snappedPos.y,
                },
                Math.abs(width),
                Math.abs(height)
              );
            }
            clearDrawingPoints();
            setDrawingPreview(null);
          }
          break;
        }

        case 'center': {
          if (drawingPoints.length === 0) {
            addDrawingPoint(snappedPos);
          } else {
            const center = drawingPoints[0];
            const dx = Math.abs(snappedPos.x - center.x);
            const dy = Math.abs(snappedPos.y - center.y);

            if (dx > 1 || dy > 1) {
              createRectangle(
                { x: center.x - dx, y: center.y - dy },
                dx * 2,
                dy * 2
              );
            }
            clearDrawingPoints();
            setDrawingPreview(null);
          }
          break;
        }

        case '3point': {
          if (drawingPoints.length === 0) {
            addDrawingPoint(snappedPos);
          } else if (drawingPoints.length === 1) {
            const dx = snappedPos.x - drawingPoints[0].x;
            const dy = snappedPos.y - drawingPoints[0].y;
            const length = Math.sqrt(dx * dx + dy * dy);

            if (length > 1) {
              addDrawingPoint(snappedPos);
            }
          } else {
            const p1 = drawingPoints[0];
            const p2 = drawingPoints[1];

            const widthDx = p2.x - p1.x;
            const widthDy = p2.y - p1.y;
            const width = Math.sqrt(widthDx * widthDx + widthDy * widthDy);
            const angle = Math.atan2(widthDy, widthDx);

            const perpAngle = angle + Math.PI / 2;
            const toCursor = { x: snappedPos.x - p1.x, y: snappedPos.y - p1.y };
            const height = toCursor.x * Math.cos(perpAngle) + toCursor.y * Math.sin(perpAngle);

            if (width > 1 && Math.abs(height) > 1) {
              let topLeft: Point;
              if (height >= 0) {
                topLeft = { ...p1 };
              } else {
                topLeft = {
                  x: p1.x + Math.abs(height) * Math.cos(perpAngle + Math.PI),
                  y: p1.y + Math.abs(height) * Math.sin(perpAngle + Math.PI),
                };
              }
              createRectangle(topLeft, width, Math.abs(height), angle);
            }
            clearDrawingPoints();
            setDrawingPreview(null);
          }
          break;
        }
      }
    },
    [rectangleMode, drawingPoints, addDrawingPoint, clearDrawingPoints, setDrawingPreview, createRectangle]
  );

  /**
   * Handle click for circle drawing
   */
  const handleCircleClick = useCallback(
    (snappedPos: Point) => {
      switch (circleMode) {
        case 'center-radius':
        case 'center-diameter': {
          if (drawingPoints.length === 0) {
            // If radius is locked, single-click placement
            if (lockedRadius !== null && lockedRadius > 0) {
              createCircle(snappedPos, lockedRadius);
              return;
            }
            addDrawingPoint(snappedPos);
          } else {
            const center = drawingPoints[0];
            const dx = snappedPos.x - center.x;
            const dy = snappedPos.y - center.y;
            let radius = Math.sqrt(dx * dx + dy * dy);

            if (circleMode === 'center-diameter') {
              radius = radius / 2;
            }

            // Apply locked distance as radius
            if (lockedDistance !== null) {
              radius = lockedDistance;
              setLockedDistance(null);
            }

            if (radius > 1) {
              createCircle(center, radius);
            }
            clearDrawingPoints();
            setDrawingPreview(null);
          }
          break;
        }

        case '2point': {
          if (drawingPoints.length === 0) {
            addDrawingPoint(snappedPos);
          } else {
            const p1 = drawingPoints[0];
            const p2 = snappedPos;
            const center = {
              x: (p1.x + p2.x) / 2,
              y: (p1.y + p2.y) / 2,
            };
            const dx = p2.x - p1.x;
            const dy = p2.y - p1.y;
            const radius = Math.sqrt(dx * dx + dy * dy) / 2;

            if (radius > 1) {
              createCircle(center, radius);
            }
            clearDrawingPoints();
            setDrawingPreview(null);
          }
          break;
        }

        case '3point': {
          if (drawingPoints.length < 2) {
            addDrawingPoint(snappedPos);
          } else {
            const circle = calculateCircleFrom3Points(
              drawingPoints[0],
              drawingPoints[1],
              snappedPos
            );

            if (circle && circle.radius > 1) {
              createCircle(circle.center, circle.radius);
            }
            clearDrawingPoints();
            setDrawingPreview(null);
          }
          break;
        }
      }
    },
    [circleMode, drawingPoints, addDrawingPoint, clearDrawingPoints, setDrawingPreview, createCircle, lockedRadius, lockedDistance, setLockedDistance]
  );

  /**
   * Handle click for polyline drawing
   * In arc mode, uses 3-point arc: first click sets through point, second click sets endpoint
   */
  const handlePolylineClick = useCallback(
    (snappedPos: Point, shiftKey: boolean) => {
      let finalPos = snappedPos;
      if (shiftKey && drawingPoints.length > 0) {
        const lastPoint = drawingPoints[drawingPoints.length - 1];
        finalPos = snapToAngle(lastPoint, snappedPos);
      }

      // If no points yet, just add the first point
      if (drawingPoints.length === 0) {
        addDrawingPoint(finalPos);
        return;
      }

      // In arc mode with at least one point
      if (polylineArcMode) {
        const lastPoint = drawingPoints[drawingPoints.length - 1];

        if (!polylineArcThroughPoint) {
          // First click in arc mode: set the through point (point on the arc)
          setPolylineArcThroughPoint(finalPos);
        } else {
          // Second click in arc mode: this is the endpoint
          // Calculate bulge from 3 points: lastPoint -> throughPoint -> finalPos
          const bulge = calculateBulgeFrom3Points(lastPoint, polylineArcThroughPoint, finalPos);
          addDrawingBulge(bulge);
          addDrawingPoint(finalPos);
          // Clear the through point for next arc segment
          setPolylineArcThroughPoint(null);
        }
      } else {
        // Line mode: straight segment
        addDrawingBulge(0);
        addDrawingPoint(finalPos);
      }
    },
    [drawingPoints, addDrawingPoint, addDrawingBulge, polylineArcMode, polylineArcThroughPoint, setPolylineArcThroughPoint]
  );

  /**
   * Handle click for spline drawing
   */
  const handleSplineClick = useCallback(
    (snappedPos: Point, shiftKey: boolean) => {
      if (shiftKey && drawingPoints.length > 0) {
        const lastPoint = drawingPoints[drawingPoints.length - 1];
        const finalPos = snapToAngle(lastPoint, snappedPos);
        addDrawingPoint(finalPos);
      } else {
        addDrawingPoint(snappedPos);
      }
    },
    [drawingPoints, addDrawingPoint]
  );

  /**
   * Handle click for arc drawing
   * Modes:
   * - '3point': Click start, click point on arc, click end
   * - 'center-start-end': Click center, click start point (defines radius), click end point
   */
  const handleArcClick = useCallback(
    (snappedPos: Point) => {
      switch (arcMode) {
        case '3point': {
          // 3-point arc: start, point on arc, end
          if (drawingPoints.length < 2) {
            addDrawingPoint(snappedPos);
          } else {
            // We have start and mid point, this is the end point
            const arc = calculateArcFrom3Points(
              drawingPoints[0],
              drawingPoints[1],
              snappedPos
            );

            if (arc && arc.radius > 1) {
              createArc(arc.center, arc.radius, arc.startAngle, arc.endAngle);
            }
            clearDrawingPoints();
            setDrawingPreview(null);
          }
          break;
        }

        case 'center-start-end': {
          // Center-start-end: center, start (defines radius), end (defines end angle)
          if (drawingPoints.length === 0) {
            addDrawingPoint(snappedPos);
          } else if (drawingPoints.length === 1) {
            const center = drawingPoints[0];
            const dx = snappedPos.x - center.x;
            const dy = snappedPos.y - center.y;
            const radius = Math.sqrt(dx * dx + dy * dy);
            if (radius > 1) {
              addDrawingPoint(snappedPos);
            }
          } else {
            const center = drawingPoints[0];
            const startPoint = drawingPoints[1];
            const dx = startPoint.x - center.x;
            const dy = startPoint.y - center.y;
            const radius = Math.sqrt(dx * dx + dy * dy);
            const startAngle = angleFromCenter(center, startPoint);
            const endAngle = angleFromCenter(center, snappedPos);
            if (radius > 1) {
              createArc(center, radius, startAngle, endAngle);
            }
            clearDrawingPoints();
            setDrawingPreview(null);
          }
          break;
        }

        case 'start-end-radius': {
          // Start-End-Radius: click start, click end, drag to set curvature
          if (drawingPoints.length === 0) {
            addDrawingPoint(snappedPos);
          } else if (drawingPoints.length === 1) {
            const dist = Math.sqrt(
              (snappedPos.x - drawingPoints[0].x) ** 2 +
              (snappedPos.y - drawingPoints[0].y) ** 2
            );
            if (dist > 1) {
              addDrawingPoint(snappedPos);
            }
          } else {
            // Third click determines curvature (distance from chord midpoint)
            const start = drawingPoints[0];
            const end = drawingPoints[1];
            const chordMid = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
            const chordLen = Math.sqrt((end.x - start.x) ** 2 + (end.y - start.y) ** 2);

            // Sagitta: perpendicular distance from chord midpoint to click point
            const chordAngle = Math.atan2(end.y - start.y, end.x - start.x);
            const perpAngle = chordAngle + Math.PI / 2;
            const toClick = { x: snappedPos.x - chordMid.x, y: snappedPos.y - chordMid.y };
            const sagitta = toClick.x * Math.cos(perpAngle) + toClick.y * Math.sin(perpAngle);

            if (Math.abs(sagitta) > 0.1) {
              // Calculate radius from chord length and sagitta: r = (h/2) + (c^2)/(8h)
              const h = Math.abs(sagitta);
              const radius = h / 2 + (chordLen * chordLen) / (8 * h);

              // Center is on the perpendicular bisector of the chord
              const centerDist = radius - h;
              const sign = sagitta > 0 ? -1 : 1;
              const center = {
                x: chordMid.x + sign * centerDist * Math.cos(perpAngle),
                y: chordMid.y + sign * centerDist * Math.sin(perpAngle),
              };

              const startAngle = angleFromCenter(center, start);
              const endAngle = angleFromCenter(center, end);

              // Determine correct arc direction based on sagitta sign
              if (sagitta > 0) {
                createArc(center, radius, startAngle, endAngle);
              } else {
                createArc(center, radius, endAngle, startAngle);
              }
            }
            clearDrawingPoints();
            setDrawingPreview(null);
          }
          break;
        }

        case 'fillet': {
          // Fillet: placeholder - requires selecting two existing lines
          // For now, just add points and show status
          if (drawingPoints.length < 2) {
            addDrawingPoint(snappedPos);
          } else {
            clearDrawingPoints();
            setDrawingPreview(null);
          }
          break;
        }

        case 'tangent': {
          // Tangent arc: placeholder - requires detecting existing endpoint
          if (drawingPoints.length === 0) {
            addDrawingPoint(snappedPos);
          } else {
            // Simple tangent: draw arc from last point to clicked endpoint
            // For now, use 3-point arc logic with a midpoint
            const start = drawingPoints[0];
            const end = snappedPos;
            const mid = {
              x: (start.x + end.x) / 2 + (end.y - start.y) * 0.2,
              y: (start.y + end.y) / 2 - (end.x - start.x) * 0.2,
            };
            const arc = calculateArcFrom3Points(start, mid, end);
            if (arc && arc.radius > 1) {
              createArc(arc.center, arc.radius, arc.startAngle, arc.endAngle);
            }
            clearDrawingPoints();
            setDrawingPreview(null);
          }
          break;
        }
      }
    },
    [arcMode, drawingPoints, addDrawingPoint, clearDrawingPoints, setDrawingPreview, createArc]
  );

  /**
   * Handle click for ellipse drawing
   * Modes:
   * - 'center-axes': Click center, click to define radiusX, click to define radiusY
   * - 'corner': Click corner, drag to opposite corner (bounding box defines ellipse)
   */
  const handleEllipseClick = useCallback(
    (snappedPos: Point) => {
      switch (ellipseMode) {
        case 'center-axes': {
          // Center-axes mode: center, radiusX point, radiusY point
          if (drawingPoints.length === 0) {
            // First click: center point
            addDrawingPoint(snappedPos);
          } else if (drawingPoints.length === 1) {
            // Second click: defines radiusX (horizontal radius)
            const center = drawingPoints[0];
            const dx = snappedPos.x - center.x;
            const dy = snappedPos.y - center.y;
            const radiusX = Math.sqrt(dx * dx + dy * dy);

            if (radiusX > 1) {
              addDrawingPoint(snappedPos);
            }
          } else {
            // Third click: defines radiusY (vertical radius)
            const center = drawingPoints[0];
            const radiusXPoint = drawingPoints[1];

            // Calculate radiusX
            const dx1 = radiusXPoint.x - center.x;
            const dy1 = radiusXPoint.y - center.y;
            const radiusX = Math.sqrt(dx1 * dx1 + dy1 * dy1);

            // Calculate rotation angle from the first axis
            const rotation = Math.atan2(dy1, dx1);

            // Calculate radiusY - distance from center to current point projected onto perpendicular axis
            const dx2 = snappedPos.x - center.x;
            const dy2 = snappedPos.y - center.y;
            // Project onto perpendicular axis
            const perpAngle = rotation + Math.PI / 2;
            const radiusY = Math.abs(dx2 * Math.cos(perpAngle) + dy2 * Math.sin(perpAngle));

            if (radiusX > 1 && radiusY > 1) {
              createEllipse(center, radiusX, radiusY, rotation);
            }
            clearDrawingPoints();
            setDrawingPreview(null);
          }
          break;
        }

        case 'corner': {
          if (drawingPoints.length === 0) {
            addDrawingPoint(snappedPos);
          } else {
            const p1 = drawingPoints[0];
            const p2 = snappedPos;
            const center = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
            const radiusX = Math.abs(p2.x - p1.x) / 2;
            const radiusY = Math.abs(p2.y - p1.y) / 2;
            if (radiusX > 1 && radiusY > 1) {
              createEllipse(center, radiusX, radiusY, 0);
            }
            clearDrawingPoints();
            setDrawingPreview(null);
          }
          break;
        }

        case 'partial': {
          // Partial ellipse: center, major axis, minor axis, start angle, end angle (5 clicks)
          if (drawingPoints.length === 0) {
            // Click 1: center
            addDrawingPoint(snappedPos);
          } else if (drawingPoints.length === 1) {
            // Click 2: major axis point
            const center = drawingPoints[0];
            const dist = Math.sqrt((snappedPos.x - center.x) ** 2 + (snappedPos.y - center.y) ** 2);
            if (dist > 1) {
              addDrawingPoint(snappedPos);
            }
          } else if (drawingPoints.length === 2) {
            // Click 3: minor axis point
            addDrawingPoint(snappedPos);
          } else if (drawingPoints.length === 3) {
            // Click 4: start angle
            addDrawingPoint(snappedPos);
          } else {
            // Click 5: end angle - create partial ellipse
            const center = drawingPoints[0];
            const majorPt = drawingPoints[1];
            const dx1 = majorPt.x - center.x;
            const dy1 = majorPt.y - center.y;
            const radiusX = Math.sqrt(dx1 * dx1 + dy1 * dy1);
            const rotation = Math.atan2(dy1, dx1);

            const minorPt = drawingPoints[2];
            const dx2 = minorPt.x - center.x;
            const dy2 = minorPt.y - center.y;
            const perpAngle = rotation + Math.PI / 2;
            const radiusY = Math.abs(dx2 * Math.cos(perpAngle) + dy2 * Math.sin(perpAngle));

            const startAnglePt = drawingPoints[3];
            const startAngle = Math.atan2(startAnglePt.y - center.y, startAnglePt.x - center.x) - rotation;
            const endAngle = Math.atan2(snappedPos.y - center.y, snappedPos.x - center.x) - rotation;

            if (radiusX > 1 && radiusY > 1) {
              createEllipse(center, radiusX, radiusY, rotation, startAngle, endAngle);
            }
            clearDrawingPoints();
            setDrawingPreview(null);
          }
          break;
        }
      }
    },
    [ellipseMode, drawingPoints, addDrawingPoint, clearDrawingPoints, setDrawingPreview, createEllipse]
  );

  /**
   * Handle pick-lines mode: click on existing shape to create offset copy
   */
  const handlePickLinesClick = useCallback(
    (worldPos: Point): boolean => {
      const { shapes, pickLinesOffset } = useAppStore.getState();

      // Find shape at point
      let foundShape: Shape | null = null;
      for (let i = shapes.length - 1; i >= 0; i--) {
        if (isPointNearShape(worldPos, shapes[i])) {
          foundShape = shapes[i];
          break;
        }
      }

      if (!foundShape) return false;

      const offset = pickLinesOffset;

      switch (foundShape.type) {
        case 'line': {
          // Create parallel line at offset distance
          const dx = foundShape.end.x - foundShape.start.x;
          const dy = foundShape.end.y - foundShape.start.y;
          const len = Math.sqrt(dx * dx + dy * dy);
          if (len < 0.01) return false;
          // Perpendicular direction (determine side based on click position)
          const perpX = -dy / len;
          const perpY = dx / len;
          // Determine which side of the line the click is on
          const cross = (worldPos.x - foundShape.start.x) * perpY - (worldPos.y - foundShape.start.y) * perpX;
          const sign = cross > 0 ? 1 : -1;
          const newStart = { x: foundShape.start.x + sign * offset * perpX, y: foundShape.start.y + sign * offset * perpY };
          const newEnd = { x: foundShape.end.x + sign * offset * perpX, y: foundShape.end.y + sign * offset * perpY };
          createLine(newStart, newEnd);
          return true;
        }
        case 'circle': {
          // Create concentric circle
          const distToCenter = Math.sqrt((worldPos.x - foundShape.center.x) ** 2 + (worldPos.y - foundShape.center.y) ** 2);
          const newRadius = distToCenter > foundShape.radius
            ? foundShape.radius + offset
            : Math.max(foundShape.radius - offset, 1);
          createCircle(foundShape.center, newRadius);
          return true;
        }
        case 'arc': {
          // Create concentric arc
          const distToCenter = Math.sqrt((worldPos.x - foundShape.center.x) ** 2 + (worldPos.y - foundShape.center.y) ** 2);
          const newRadius = distToCenter > foundShape.radius
            ? foundShape.radius + offset
            : Math.max(foundShape.radius - offset, 1);
          createArc(foundShape.center, newRadius, foundShape.startAngle, foundShape.endAngle);
          return true;
        }
        default:
          return false;
      }
    },
    [createLine, createCircle, createArc]
  );

  /**
   * Handle shape drawing click (dispatch to appropriate handler)
   */
  const handleDrawingClick = useCallback(
    (snappedPos: Point, shiftKey: boolean, snapInfo?: SnapPoint): boolean => {
      // Check pick-lines mode first
      const { pickLinesMode } = useAppStore.getState();
      if (pickLinesMode && (activeTool === 'line' || activeTool === 'circle' || activeTool === 'arc')) {
        if (handlePickLinesClick(snappedPos)) {
          return true;
        }
      }

      switch (activeTool) {
        case 'line':
          handleLineClick(snappedPos, shiftKey);
          return true;
        case 'rectangle':
          handleRectangleClick(snappedPos);
          return true;
        case 'circle':
          handleCircleClick(snappedPos);
          return true;
        case 'arc':
          handleArcClick(snappedPos);
          return true;
        case 'polyline':
          handlePolylineClick(snappedPos, shiftKey);
          return true;
        case 'spline':
          handleSplineClick(snappedPos, shiftKey);
          return true;
        case 'ellipse':
          handleEllipseClick(snappedPos);
          return true;
        case 'hatch':
          handleHatchClick(snappedPos, shiftKey);
          return true;
        case 'dimension':
          dimensionDrawing.handleDimensionClick(snappedPos, snapInfo);
          return true;
        default:
          return false;
      }
    },
    [activeTool, handleLineClick, handleRectangleClick, handleCircleClick, handleArcClick, handlePolylineClick, handleSplineClick, handleEllipseClick, handleHatchClick, dimensionDrawing, handlePickLinesClick]
  );

  /**
   * Update drawing preview for line
   */
  const updateLinePreview = useCallback(
    (snappedPos: Point, shiftKey: boolean) => {
      if (drawingPoints.length === 0) return;
      const lastPoint = drawingPoints[drawingPoints.length - 1];
      let previewPos = shiftKey ? snapToAngle(lastPoint, snappedPos) : snappedPos;

      // Apply locked constraints to preview
      if (lockedDistance !== null || lockedAngle !== null) {
        previewPos = applyLockedConstraints(lastPoint, previewPos, lockedDistance, lockedAngle);
      }

      setDrawingPreview({
        type: 'line',
        start: lastPoint,
        end: previewPos,
      });
    },
    [drawingPoints, setDrawingPreview, lockedDistance, lockedAngle]
  );

  /**
   * Update drawing preview for rectangle
   */
  const updateRectanglePreview = useCallback(
    (snappedPos: Point) => {
      if (drawingPoints.length === 0) return;
      const { cornerRadius } = useAppStore.getState();
      const cr = cornerRadius > 0 ? cornerRadius : undefined;

      switch (rectangleMode) {
        case 'corner': {
          setDrawingPreview({
            type: 'rectangle',
            start: drawingPoints[0],
            end: snappedPos,
            cornerRadius: cr,
          });
          break;
        }

        case 'center': {
          const center = drawingPoints[0];
          const dx = Math.abs(snappedPos.x - center.x);
          const dy = Math.abs(snappedPos.y - center.y);
          setDrawingPreview({
            type: 'rectangle',
            start: { x: center.x - dx, y: center.y - dy },
            end: { x: center.x + dx, y: center.y + dy },
            cornerRadius: cr,
          });
          break;
        }

        case '3point': {
          if (drawingPoints.length === 1) {
            setDrawingPreview({
              type: 'line',
              start: drawingPoints[0],
              end: snappedPos,
            });
          } else if (drawingPoints.length === 2) {
            const p1 = drawingPoints[0];
            const p2 = drawingPoints[1];

            const widthDx = p2.x - p1.x;
            const widthDy = p2.y - p1.y;
            const angle = Math.atan2(widthDy, widthDx);

            const perpAngle = angle + Math.PI / 2;
            const toCursor = { x: snappedPos.x - p1.x, y: snappedPos.y - p1.y };
            const height = toCursor.x * Math.cos(perpAngle) + toCursor.y * Math.sin(perpAngle);

            const heightUnit = { x: Math.cos(perpAngle), y: Math.sin(perpAngle) };

            const corner1 = p1;
            const corner2 = p2;
            const corner3 = {
              x: p2.x + height * heightUnit.x,
              y: p2.y + height * heightUnit.y,
            };
            const corner4 = {
              x: p1.x + height * heightUnit.x,
              y: p1.y + height * heightUnit.y,
            };

            setDrawingPreview({
              type: 'rotatedRectangle',
              corners: [corner1, corner2, corner3, corner4],
            });
          }
          break;
        }
      }
    },
    [rectangleMode, drawingPoints, setDrawingPreview]
  );

  /**
   * Update drawing preview for circle
   */
  const updateCirclePreview = useCallback(
    (snappedPos: Point) => {
      if (drawingPoints.length === 0) return;

      switch (circleMode) {
        case 'center-radius': {
          const dx = snappedPos.x - drawingPoints[0].x;
          const dy = snappedPos.y - drawingPoints[0].y;
          let radius = Math.sqrt(dx * dx + dy * dy);
          if (lockedDistance !== null) radius = lockedDistance;
          setDrawingPreview({
            type: 'circle',
            center: drawingPoints[0],
            radius,
          });
          break;
        }

        case 'center-diameter': {
          const dx = snappedPos.x - drawingPoints[0].x;
          const dy = snappedPos.y - drawingPoints[0].y;
          let radius = Math.sqrt(dx * dx + dy * dy) / 2;
          if (lockedDistance !== null) radius = lockedDistance;
          setDrawingPreview({
            type: 'circle',
            center: drawingPoints[0],
            radius,
          });
          break;
        }

        case '2point': {
          const p1 = drawingPoints[0];
          const p2 = snappedPos;
          const center = {
            x: (p1.x + p2.x) / 2,
            y: (p1.y + p2.y) / 2,
          };
          const dx = p2.x - p1.x;
          const dy = p2.y - p1.y;
          const radius = Math.sqrt(dx * dx + dy * dy) / 2;
          setDrawingPreview({
            type: 'circle',
            center,
            radius,
          });
          break;
        }

        case '3point': {
          if (drawingPoints.length === 1) {
            setDrawingPreview({
              type: 'line',
              start: drawingPoints[0],
              end: snappedPos,
            });
          } else if (drawingPoints.length === 2) {
            const circle = calculateCircleFrom3Points(
              drawingPoints[0],
              drawingPoints[1],
              snappedPos
            );
            if (circle) {
              setDrawingPreview({
                type: 'circle',
                center: circle.center,
                radius: circle.radius,
              });
            }
          }
          break;
        }
      }
    },
    [circleMode, drawingPoints, setDrawingPreview, lockedDistance]
  );

  /**
   * Update drawing preview for polyline
   * In arc mode with through point: shows arc preview from lastPoint through throughPoint to mouse
   */
  const updatePolylinePreview = useCallback(
    (snappedPos: Point, shiftKey: boolean) => {
      if (drawingPoints.length === 0) return;
      const lastPoint = drawingPoints[drawingPoints.length - 1];
      let previewPos = shiftKey ? snapToAngle(lastPoint, snappedPos) : snappedPos;

      if (lockedDistance !== null || lockedAngle !== null) {
        previewPos = applyLockedConstraints(lastPoint, previewPos, lockedDistance, lockedAngle);
      }

      const bulges = useAppStore.getState().drawingBulges;
      const throughPoint = useAppStore.getState().polylineArcThroughPoint;

      // Calculate bulge for preview
      let currentBulge = 0;
      if (polylineArcMode && throughPoint) {
        // 3-point arc: calculate bulge from lastPoint -> throughPoint -> previewPos
        currentBulge = calculateBulgeFrom3Points(lastPoint, throughPoint, previewPos);
      }

      setDrawingPreview({
        type: 'polyline',
        points: drawingPoints,
        currentPoint: previewPos,
        bulges: bulges.length > 0 ? [...bulges] : undefined,
        currentBulge,
        arcThroughPoint: polylineArcMode ? throughPoint ?? undefined : undefined,
      });
    },
    [drawingPoints, setDrawingPreview, lockedDistance, lockedAngle, polylineArcMode]
  );

  /**
   * Update drawing preview for spline
   */
  const updateSplinePreview = useCallback(
    (snappedPos: Point, shiftKey: boolean) => {
      if (drawingPoints.length === 0) return;
      const lastPoint = drawingPoints[drawingPoints.length - 1];
      const previewPos = shiftKey ? snapToAngle(lastPoint, snappedPos) : snappedPos;
      setDrawingPreview({
        type: 'spline',
        points: drawingPoints,
        currentPoint: previewPos,
      });
    },
    [drawingPoints, setDrawingPreview]
  );

  /**
   * Update drawing preview for arc
   */
  const updateArcPreview = useCallback(
    (snappedPos: Point) => {
      if (drawingPoints.length === 0) return;

      switch (arcMode) {
        case '3point': {
          if (drawingPoints.length === 1) {
            // Show line from start to current position (indicating direction)
            setDrawingPreview({
              type: 'line',
              start: drawingPoints[0],
              end: snappedPos,
            });
          } else if (drawingPoints.length === 2) {
            // Calculate arc preview from 3 points
            const arc = calculateArcFrom3Points(
              drawingPoints[0],
              drawingPoints[1],
              snappedPos
            );
            if (arc) {
              setDrawingPreview({
                type: 'arc',
                center: arc.center,
                radius: arc.radius,
                startAngle: arc.startAngle,
                endAngle: arc.endAngle,
              });
            }
          }
          break;
        }

        case 'center-start-end': {
          if (drawingPoints.length === 1) {
            const center = drawingPoints[0];
            const dx = snappedPos.x - center.x;
            const dy = snappedPos.y - center.y;
            const radius = Math.sqrt(dx * dx + dy * dy);
            setDrawingPreview({
              type: 'circle',
              center,
              radius,
            });
          } else if (drawingPoints.length === 2) {
            const center = drawingPoints[0];
            const startPoint = drawingPoints[1];
            const dx = startPoint.x - center.x;
            const dy = startPoint.y - center.y;
            const radius = Math.sqrt(dx * dx + dy * dy);
            const startAngle = angleFromCenter(center, startPoint);
            const endAngle = angleFromCenter(center, snappedPos);
            setDrawingPreview({
              type: 'arc',
              center,
              radius,
              startAngle,
              endAngle,
            });
          }
          break;
        }

        case 'start-end-radius': {
          if (drawingPoints.length === 1) {
            // Show line from start to cursor
            setDrawingPreview({
              type: 'line',
              start: drawingPoints[0],
              end: snappedPos,
            });
          } else if (drawingPoints.length === 2) {
            // Show arc preview based on curvature
            const start = drawingPoints[0];
            const end = drawingPoints[1];
            const chordMid = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
            const chordLen = Math.sqrt((end.x - start.x) ** 2 + (end.y - start.y) ** 2);
            const chordAngle = Math.atan2(end.y - start.y, end.x - start.x);
            const perpAngle = chordAngle + Math.PI / 2;
            const toClick = { x: snappedPos.x - chordMid.x, y: snappedPos.y - chordMid.y };
            const sagitta = toClick.x * Math.cos(perpAngle) + toClick.y * Math.sin(perpAngle);

            if (Math.abs(sagitta) > 0.1) {
              const h = Math.abs(sagitta);
              const radius = h / 2 + (chordLen * chordLen) / (8 * h);
              const centerDist = radius - h;
              const sign = sagitta > 0 ? -1 : 1;
              const center = {
                x: chordMid.x + sign * centerDist * Math.cos(perpAngle),
                y: chordMid.y + sign * centerDist * Math.sin(perpAngle),
              };
              const startAngle = angleFromCenter(center, start);
              const endAngle = angleFromCenter(center, end);
              if (sagitta > 0) {
                setDrawingPreview({ type: 'arc', center, radius, startAngle, endAngle });
              } else {
                setDrawingPreview({ type: 'arc', center, radius, startAngle: endAngle, endAngle: startAngle });
              }
            } else {
              setDrawingPreview({ type: 'line', start, end });
            }
          }
          break;
        }

        case 'fillet':
        case 'tangent': {
          if (drawingPoints.length === 1) {
            setDrawingPreview({
              type: 'line',
              start: drawingPoints[0],
              end: snappedPos,
            });
          }
          break;
        }
      }
    },
    [arcMode, drawingPoints, setDrawingPreview]
  );

  /**
   * Update drawing preview for ellipse
   */
  const updateEllipsePreview = useCallback(
    (snappedPos: Point) => {
      if (drawingPoints.length === 0) return;

      switch (ellipseMode) {
        case 'center-axes': {
          const center = drawingPoints[0];

          if (drawingPoints.length === 1) {
            // Show circle preview for first radius
            const dx = snappedPos.x - center.x;
            const dy = snappedPos.y - center.y;
            const radiusX = Math.sqrt(dx * dx + dy * dy);

            setDrawingPreview({
              type: 'ellipse',
              center,
              radiusX,
              radiusY: radiusX, // Equal radii while defining first axis
              rotation: Math.atan2(dy, dx),
            });
          } else if (drawingPoints.length === 2) {
            // Show ellipse preview with both radii
            const radiusXPoint = drawingPoints[1];

            const dx1 = radiusXPoint.x - center.x;
            const dy1 = radiusXPoint.y - center.y;
            const radiusX = Math.sqrt(dx1 * dx1 + dy1 * dy1);
            const rotation = Math.atan2(dy1, dx1);

            const dx2 = snappedPos.x - center.x;
            const dy2 = snappedPos.y - center.y;
            const perpAngle = rotation + Math.PI / 2;
            const radiusY = Math.abs(dx2 * Math.cos(perpAngle) + dy2 * Math.sin(perpAngle));

            setDrawingPreview({
              type: 'ellipse',
              center,
              radiusX,
              radiusY: Math.max(radiusY, 1),
              rotation,
            });
          }
          break;
        }

        case 'corner': {
          const p1 = drawingPoints[0];
          const center = {
            x: (p1.x + snappedPos.x) / 2,
            y: (p1.y + snappedPos.y) / 2,
          };
          const radiusX = Math.abs(snappedPos.x - p1.x) / 2;
          const radiusY = Math.abs(snappedPos.y - p1.y) / 2;
          setDrawingPreview({
            type: 'ellipse',
            center,
            radiusX: Math.max(radiusX, 1),
            radiusY: Math.max(radiusY, 1),
            rotation: 0,
          });
          break;
        }

        case 'partial': {
          const center = drawingPoints[0];
          if (drawingPoints.length === 1) {
            // Show circle for first radius
            const dx = snappedPos.x - center.x;
            const dy = snappedPos.y - center.y;
            const r = Math.sqrt(dx * dx + dy * dy);
            setDrawingPreview({ type: 'ellipse', center, radiusX: r, radiusY: r, rotation: Math.atan2(dy, dx) });
          } else if (drawingPoints.length === 2) {
            // Show full ellipse as minor axis is being defined
            const majorPt = drawingPoints[1];
            const dx1 = majorPt.x - center.x;
            const dy1 = majorPt.y - center.y;
            const radiusX = Math.sqrt(dx1 * dx1 + dy1 * dy1);
            const rotation = Math.atan2(dy1, dx1);
            const dx2 = snappedPos.x - center.x;
            const dy2 = snappedPos.y - center.y;
            const perpAngle = rotation + Math.PI / 2;
            const radiusY = Math.abs(dx2 * Math.cos(perpAngle) + dy2 * Math.sin(perpAngle));
            setDrawingPreview({ type: 'ellipse', center, radiusX, radiusY: Math.max(radiusY, 1), rotation });
          } else if (drawingPoints.length >= 3) {
            // Show full ellipse while picking start/end angle
            const majorPt = drawingPoints[1];
            const dx1 = majorPt.x - center.x;
            const dy1 = majorPt.y - center.y;
            const radiusX = Math.sqrt(dx1 * dx1 + dy1 * dy1);
            const rotation = Math.atan2(dy1, dx1);
            const minorPt = drawingPoints[2];
            const dx2 = minorPt.x - center.x;
            const dy2 = minorPt.y - center.y;
            const perpAngle = rotation + Math.PI / 2;
            const radiusY = Math.abs(dx2 * Math.cos(perpAngle) + dy2 * Math.sin(perpAngle));
            setDrawingPreview({ type: 'ellipse', center, radiusX, radiusY: Math.max(radiusY, 1), rotation });
          }
          break;
        }
      }
    },
    [ellipseMode, drawingPoints, setDrawingPreview]
  );

  /**
   * Update drawing preview based on active tool
   */
  const updateDrawingPreview = useCallback(
    (snappedPos: Point, shiftKey: boolean) => {
      if (drawingPoints.length === 0) return;

      switch (activeTool) {
        case 'line':
          updateLinePreview(snappedPos, shiftKey);
          break;
        case 'rectangle':
          updateRectanglePreview(snappedPos);
          break;
        case 'circle':
          updateCirclePreview(snappedPos);
          break;
        case 'arc':
          updateArcPreview(snappedPos);
          break;
        case 'polyline':
          updatePolylinePreview(snappedPos, shiftKey);
          break;
        case 'spline':
          updateSplinePreview(snappedPos, shiftKey);
          break;
        case 'ellipse':
          updateEllipsePreview(snappedPos);
          break;
        case 'hatch':
          updateHatchPreview(snappedPos, shiftKey);
          break;
        case 'dimension':
          dimensionDrawing.updateDimensionPreview(snappedPos);
          break;
      }
    },
    [activeTool, drawingPoints, updateLinePreview, updateRectanglePreview, updateCirclePreview, updateArcPreview, updatePolylinePreview, updateSplinePreview, updateEllipsePreview, updateHatchPreview, dimensionDrawing]
  );

  /**
   * Finish current drawing (right-click or escape)
   */
  const finishDrawing = useCallback(() => {
    // Read everything directly from store to avoid stale closure issues
    const state = useAppStore.getState();
    const pts = state.drawingPoints;
    const bulges = state.drawingBulges;
    const tool = state.activeTool;

    if (pts.length === 0) return;

    if (tool === 'polyline' && pts.length >= 2) {
      const polylineShape: PolylineShape = {
        id: generateId(),
        type: 'polyline',
        layerId: state.activeLayerId,
        drawingId: state.activeDrawingId,
        style: { ...state.currentStyle },
        visible: true,
        locked: false,
        points: [...pts],
        closed: false,
        bulge: bulges && bulges.some(b => b !== 0) ? [...bulges] : undefined,
      };
      state.addShape(polylineShape);
    } else if (tool === 'hatch' && pts.length >= 3) {
      createHatch(pts);
    } else if (tool === 'spline' && pts.length >= 2) {
      createSpline(pts, false);
    } else if (tool === 'dimension') {
      dimensionDrawing.cancelDimensionDrawing();
      return;
    }
    state.clearDrawingPoints();
    state.setDrawingPreview(null);
  }, [createHatch, createSpline, dimensionDrawing]);

  /**
   * Check if currently drawing
   */
  const isDrawing = useCallback(() => useAppStore.getState().drawingPoints.length > 0, []);

  /**
   * Get last drawing point (for snap base point)
   */
  const getLastDrawingPoint = useCallback((): Point | undefined => {
    return drawingPoints.length > 0 ? drawingPoints[drawingPoints.length - 1] : undefined;
  }, [drawingPoints]);

  /**
   * Get status message for current drawing state (guides the user)
   */
  const getDrawingStatus = useCallback((): string => {
    const pts = drawingPoints.length;

    switch (activeTool) {
      case 'line':
        if (pts === 0) return 'Select first point';
        return 'Select next point (or right-click to finish)';
      case 'rectangle':
        if (rectangleMode === '3point') {
          if (pts === 0) return 'Select first corner';
          if (pts === 1) return 'Select second corner (width direction)';
          return 'Select height';
        }
        if (pts === 0) return rectangleMode === 'center' ? 'Select center point' : 'Select first corner';
        return 'Select opposite corner';
      case 'circle':
        if (circleMode === '3point') {
          if (pts === 0) return 'Select first point on circle';
          if (pts === 1) return 'Select second point on circle';
          return 'Select third point on circle';
        }
        if (circleMode === '2point') {
          if (pts === 0) return 'Select first diameter endpoint';
          return 'Select second diameter endpoint';
        }
        if (pts === 0) return 'Select center point';
        return 'Select radius point';
      case 'arc':
        return dimensionDrawing.getDimensionStatus() || (pts === 0 ? 'Select first point' : 'Select next point');
      case 'polyline':
        if (pts === 0) return 'Select first point';
        return `Select next point (A=Arc, L=Line, C=Close)${polylineArcMode ? ' [Arc mode]' : ''}`;
      case 'spline':
        if (pts === 0) return 'Select first point';
        return 'Select next point (C=Close, right-click to finish)';
      case 'ellipse':
        if (pts === 0) return 'Select center point';
        if (pts === 1) return 'Select major axis point';
        if (ellipseMode === 'partial') {
          if (pts === 2) return 'Select minor axis point';
          if (pts === 3) return 'Select start angle';
          return 'Select end angle';
        }
        return 'Select minor axis point';
      case 'hatch':
        if (pts === 0) return 'Click first boundary point';
        if (pts === 1) return 'Click next point';
        return 'Next point (C=Close, right-click to finish)';
      case 'text':
        return 'Click to place text';
      case 'dimension':
        return dimensionDrawing.getDimensionStatus();
      default:
        return '';
    }
  }, [activeTool, drawingPoints, rectangleMode, circleMode, ellipseMode, polylineArcMode, dimensionDrawing]);

  return {
    handleDrawingClick,
    updateDrawingPreview,
    finishDrawing,
    isDrawing,
    getLastDrawingPoint,
    createLine,
    createRectangle,
    createCircle,
    createArc,
    createPolyline,
    createSpline,
    createEllipse,
    createHatch,
    getDimensionStatus: dimensionDrawing.getDimensionStatus,
    getDrawingStatus,
  };
}
