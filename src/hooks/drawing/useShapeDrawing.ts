/**
 * useShapeDrawing - Handles shape drawing (line, rectangle, circle, arc, polyline, dimension)
 */

import { useCallback } from 'react';
import { useAppStore, generateId } from '../../state/appStore';
import type { Point, LineShape, RectangleShape, CircleShape, ArcShape, PolylineShape, EllipseShape, SnapPoint } from '../../types/geometry';
import { snapToAngle, calculateCircleFrom3Points } from '../../utils/geometryUtils';
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
    (points: Point[], closed: boolean = false) => {
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
      };
      addShape(polylineShape);
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
    (center: Point, radiusX: number, radiusY: number, rotation: number = 0) => {
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
      };
      addShape(ellipseShape);
    },
    [activeLayerId, activeDrawingId, currentStyle, addShape]
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
        const finalPos = shiftKey ? snapToAngle(lastPoint, snappedPos) : snappedPos;
        const dx = Math.abs(finalPos.x - lastPoint.x);
        const dy = Math.abs(finalPos.y - lastPoint.y);

        if (dx > 1 || dy > 1) {
          createLine(lastPoint, finalPos);
          addDrawingPoint(finalPos);
        }
      }
    },
    [drawingPoints, addDrawingPoint, createLine]
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
            addDrawingPoint(snappedPos);
          } else {
            const center = drawingPoints[0];
            const dx = snappedPos.x - center.x;
            const dy = snappedPos.y - center.y;
            let radius = Math.sqrt(dx * dx + dy * dy);

            if (circleMode === 'center-diameter') {
              radius = radius / 2;
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
    [circleMode, drawingPoints, addDrawingPoint, clearDrawingPoints, setDrawingPreview, createCircle]
  );

  /**
   * Handle click for polyline drawing
   */
  const handlePolylineClick = useCallback(
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
   * - '3point': Click start, click point on arc, click end (like Revit)
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
            // First click: center point
            addDrawingPoint(snappedPos);
          } else if (drawingPoints.length === 1) {
            // Second click: start point (defines radius and start angle)
            const center = drawingPoints[0];
            const dx = snappedPos.x - center.x;
            const dy = snappedPos.y - center.y;
            const radius = Math.sqrt(dx * dx + dy * dy);

            if (radius > 1) {
              addDrawingPoint(snappedPos);
            }
          } else {
            // Third click: end point (defines end angle)
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
      }
    },
    [arcMode, drawingPoints, addDrawingPoint, clearDrawingPoints, setDrawingPreview, createArc]
  );

  /**
   * Handle click for ellipse drawing
   * Modes:
   * - 'center-axes': Click center, click to define radiusX, click to define radiusY (like Revit)
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
          // Corner mode: define bounding box, ellipse fits inside
          if (drawingPoints.length === 0) {
            addDrawingPoint(snappedPos);
          } else {
            const p1 = drawingPoints[0];
            const p2 = snappedPos;

            const center = {
              x: (p1.x + p2.x) / 2,
              y: (p1.y + p2.y) / 2,
            };
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
      }
    },
    [ellipseMode, drawingPoints, addDrawingPoint, clearDrawingPoints, setDrawingPreview, createEllipse]
  );

  /**
   * Handle shape drawing click (dispatch to appropriate handler)
   */
  const handleDrawingClick = useCallback(
    (snappedPos: Point, shiftKey: boolean, snapInfo?: SnapPoint): boolean => {
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
        case 'ellipse':
          handleEllipseClick(snappedPos);
          return true;
        case 'dimension':
          dimensionDrawing.handleDimensionClick(snappedPos, snapInfo);
          return true;
        default:
          return false;
      }
    },
    [activeTool, handleLineClick, handleRectangleClick, handleCircleClick, handleArcClick, handlePolylineClick, handleEllipseClick, dimensionDrawing]
  );

  /**
   * Update drawing preview for line
   */
  const updateLinePreview = useCallback(
    (snappedPos: Point, shiftKey: boolean) => {
      if (drawingPoints.length === 0) return;
      const lastPoint = drawingPoints[drawingPoints.length - 1];
      const previewPos = shiftKey ? snapToAngle(lastPoint, snappedPos) : snappedPos;
      setDrawingPreview({
        type: 'line',
        start: lastPoint,
        end: previewPos,
      });
    },
    [drawingPoints, setDrawingPreview]
  );

  /**
   * Update drawing preview for rectangle
   */
  const updateRectanglePreview = useCallback(
    (snappedPos: Point) => {
      if (drawingPoints.length === 0) return;

      switch (rectangleMode) {
        case 'corner': {
          setDrawingPreview({
            type: 'rectangle',
            start: drawingPoints[0],
            end: snappedPos,
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
          const radius = Math.sqrt(dx * dx + dy * dy);
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
          const radius = Math.sqrt(dx * dx + dy * dy) / 2;
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
    [circleMode, drawingPoints, setDrawingPreview]
  );

  /**
   * Update drawing preview for polyline
   */
  const updatePolylinePreview = useCallback(
    (snappedPos: Point, shiftKey: boolean) => {
      if (drawingPoints.length === 0) return;
      const lastPoint = drawingPoints[drawingPoints.length - 1];
      const previewPos = shiftKey ? snapToAngle(lastPoint, snappedPos) : snappedPos;
      setDrawingPreview({
        type: 'polyline',
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
            // Show radius line from center to cursor
            const center = drawingPoints[0];
            const dx = snappedPos.x - center.x;
            const dy = snappedPos.y - center.y;
            const radius = Math.sqrt(dx * dx + dy * dy);

            // Show a full circle preview to indicate the radius
            setDrawingPreview({
              type: 'circle',
              center,
              radius,
            });
          } else if (drawingPoints.length === 2) {
            // Show arc preview from start to cursor
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
        case 'ellipse':
          updateEllipsePreview(snappedPos);
          break;
        case 'dimension':
          dimensionDrawing.updateDimensionPreview(snappedPos);
          break;
      }
    },
    [activeTool, drawingPoints, updateLinePreview, updateRectanglePreview, updateCirclePreview, updateArcPreview, updatePolylinePreview, updateEllipsePreview, dimensionDrawing]
  );

  /**
   * Finish current drawing (right-click or escape)
   */
  const finishDrawing = useCallback(() => {
    if (drawingPoints.length > 0) {
      if (activeTool === 'polyline' && drawingPoints.length >= 2) {
        createPolyline(drawingPoints, false);
      } else if (activeTool === 'dimension') {
        dimensionDrawing.cancelDimensionDrawing();
        return;
      }
      clearDrawingPoints();
      setDrawingPreview(null);
    }
  }, [drawingPoints, activeTool, createPolyline, clearDrawingPoints, setDrawingPreview, dimensionDrawing]);

  /**
   * Check if currently drawing
   */
  const isDrawing = useCallback(() => drawingPoints.length > 0, [drawingPoints]);

  /**
   * Get last drawing point (for snap base point)
   */
  const getLastDrawingPoint = useCallback((): Point | undefined => {
    return drawingPoints.length > 0 ? drawingPoints[drawingPoints.length - 1] : undefined;
  }, [drawingPoints]);

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
    createEllipse,
    getDimensionStatus: dimensionDrawing.getDimensionStatus,
  };
}
