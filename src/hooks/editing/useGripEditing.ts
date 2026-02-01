/**
 * useGripEditing - Handles dragging shape selection handles (grips) to edit geometry
 *
 * Currently supports:
 * - Line: drag start/end points
 * - Rectangle: drag a corner → converts to closed polyline (free-form quadrilateral)
 */

import { useCallback, useRef } from 'react';
import { useAppStore } from '../../state/appStore';
import type { Point, Shape, PolylineShape, EllipseShape } from '../../types/geometry';

interface GripDragState {
  shapeId: string;
  gripIndex: number;
  originalShape: Shape;
  /** When dragging a rectangle corner/edge, we convert to polyline immediately. */
  convertedToPolyline: boolean;
  /** Original grip index from the rectangle (needed for edge midpoint mapping). */
  originalRectGripIndex: number;
  /** For polyline/rect edge midpoint drags: the two vertex indices to move together. */
  polylineMidpointIndices?: [number, number];
  /** Axis constraint when dragging an axis arrow. */
  axisConstraint: 'x' | 'y' | null;
  /** The original grip point position (used to lock the unconstrained axis). */
  originalGripPoint?: Point;
}

/** Length of axis arrows in screen pixels (must match ShapeRenderer). */
const AXIS_ARROW_SCREEN_LEN = 20;

/**
 * Check if a world-space point is near an axis arrow extending from a grip point.
 * Returns 'x', 'y', or null.
 */
function hitTestAxisArrow(worldPos: Point, gripPoint: Point, zoom: number): 'x' | 'y' | null {
  const arrowLen = AXIS_ARROW_SCREEN_LEN / zoom;
  const tolerance = 5 / zoom;

  // Y-axis arrow (grip → grip.y - arrowLen)
  // Check if point is within tolerance of the vertical segment
  if (
    Math.abs(worldPos.x - gripPoint.x) <= tolerance &&
    worldPos.y >= gripPoint.y - arrowLen - tolerance &&
    worldPos.y <= gripPoint.y + tolerance
  ) {
    // Make sure it's actually along the arrow, not just near the grip center
    const dist = gripPoint.y - worldPos.y;
    if (dist > tolerance * 0.5) return 'y';
  }

  // X-axis arrow (grip → grip.x + arrowLen)
  if (
    Math.abs(worldPos.y - gripPoint.y) <= tolerance &&
    worldPos.x >= gripPoint.x - tolerance &&
    worldPos.x <= gripPoint.x + arrowLen + tolerance
  ) {
    const dist = worldPos.x - gripPoint.x;
    if (dist > tolerance * 0.5) return 'x';
  }

  return null;
}

function getGripPoints(shape: Shape): Point[] {
  switch (shape.type) {
    case 'line':
      return [
        shape.start,
        shape.end,
        { x: (shape.start.x + shape.end.x) / 2, y: (shape.start.y + shape.end.y) / 2 },
      ];
    case 'rectangle': {
      // 0-3: corners TL, TR, BR, BL
      // 4-7: edge midpoints Top, Right, Bottom, Left
      // 8: center
      const tl = shape.topLeft;
      const w = shape.width;
      const h = shape.height;
      return [
        tl,
        { x: tl.x + w, y: tl.y },
        { x: tl.x + w, y: tl.y + h },
        { x: tl.x, y: tl.y + h },
        { x: tl.x + w / 2, y: tl.y },           // top edge mid
        { x: tl.x + w, y: tl.y + h / 2 },       // right edge mid
        { x: tl.x + w / 2, y: tl.y + h },        // bottom edge mid
        { x: tl.x, y: tl.y + h / 2 },            // left edge mid
        { x: tl.x + w / 2, y: tl.y + h / 2 },   // center
      ];
    }
    case 'circle':
      // 0: center, 1: right, 2: left, 3: bottom, 4: top
      return [
        shape.center,
        { x: shape.center.x + shape.radius, y: shape.center.y },
        { x: shape.center.x - shape.radius, y: shape.center.y },
        { x: shape.center.x, y: shape.center.y + shape.radius },
        { x: shape.center.x, y: shape.center.y - shape.radius },
      ];
    case 'arc': {
      // 0: center, 1: start point, 2: end point, 3: midpoint (on arc curve)
      const midAngle = shape.startAngle + ((shape.endAngle - shape.startAngle + 2 * Math.PI) % (2 * Math.PI)) / 2;
      return [
        shape.center,
        { x: shape.center.x + shape.radius * Math.cos(shape.startAngle), y: shape.center.y + shape.radius * Math.sin(shape.startAngle) },
        { x: shape.center.x + shape.radius * Math.cos(shape.endAngle), y: shape.center.y + shape.radius * Math.sin(shape.endAngle) },
        { x: shape.center.x + shape.radius * Math.cos(midAngle), y: shape.center.y + shape.radius * Math.sin(midAngle) },
      ];
    }
    case 'ellipse':
      // 0: center, 1: right, 2: left, 3: bottom, 4: top
      return [
        shape.center,
        { x: shape.center.x + shape.radiusX, y: shape.center.y },
        { x: shape.center.x - shape.radiusX, y: shape.center.y },
        { x: shape.center.x, y: shape.center.y + shape.radiusY },
        { x: shape.center.x, y: shape.center.y - shape.radiusY },
      ];
    case 'polyline':
    case 'spline': {
      // Vertex points first, then segment midpoints
      const pts = [...shape.points];
      const segCount = shape.closed ? shape.points.length : shape.points.length - 1;
      for (let i = 0; i < segCount; i++) {
        const j = (i + 1) % shape.points.length;
        pts.push({
          x: (shape.points[i].x + shape.points[j].x) / 2,
          y: (shape.points[i].y + shape.points[j].y) / 2,
        });
      }
      return pts;
    }
    case 'text':
      return [shape.position];
    default:
      return [];
  }
}

/**
 * Convert a rectangle shape into a closed polyline with 4 corner points,
 * preserving all common properties (id, style, layer, etc.).
 */
function rectangleToPolyline(shape: Shape): PolylineShape | null {
  if (shape.type !== 'rectangle') return null;
  const tl = shape.topLeft;
  const points: Point[] = [
    { x: tl.x, y: tl.y },
    { x: tl.x + shape.width, y: tl.y },
    { x: tl.x + shape.width, y: tl.y + shape.height },
    { x: tl.x, y: tl.y + shape.height },
  ];
  return {
    id: shape.id,
    type: 'polyline',
    layerId: shape.layerId,
    drawingId: shape.drawingId,
    style: { ...shape.style },
    visible: shape.visible,
    locked: shape.locked,
    points,
    closed: true,
  };
}

/**
 * Convert a circle shape into an ellipse, preserving all common properties.
 */
function circleToEllipse(shape: Shape): EllipseShape | null {
  if (shape.type !== 'circle') return null;
  return {
    id: shape.id,
    type: 'ellipse',
    layerId: shape.layerId,
    drawingId: shape.drawingId,
    style: { ...shape.style },
    visible: shape.visible,
    locked: shape.locked,
    center: { ...shape.center },
    radiusX: shape.radius,
    radiusY: shape.radius,
    rotation: 0,
  };
}

/**
 * For rectangle edge midpoint grips (4-7), return the two polyline point indices to move.
 * Polyline points: 0=TL, 1=TR, 2=BR, 3=BL
 * Edge midpoints: 4=top(0,1), 5=right(1,2), 6=bottom(2,3), 7=left(3,0)
 */
function getRectEdgeMidpointIndices(rectGripIndex: number): [number, number] | undefined {
  switch (rectGripIndex) {
    case 4: return [0, 1]; // top edge
    case 5: return [1, 2]; // right edge
    case 6: return [2, 3]; // bottom edge
    case 7: return [3, 0]; // left edge
    default: return undefined;
  }
}

/**
 * edgeMidpointIndices: if set, the two polyline point indices to move together (for rect edge midpoints).
 */
function computeGripUpdates(shape: Shape, gripIndex: number, newPos: Point, edgeMidpointIndices?: [number, number]): Partial<Shape> | null {
  switch (shape.type) {
    case 'line':
      if (gripIndex === 0) return { start: newPos } as Partial<Shape>;
      if (gripIndex === 1) return { end: newPos } as Partial<Shape>;
      if (gripIndex === 2) {
        // Midpoint drag — move both endpoints by the delta from original midpoint
        const origMid = {
          x: (shape.start.x + shape.end.x) / 2,
          y: (shape.start.y + shape.end.y) / 2,
        };
        const dx = newPos.x - origMid.x;
        const dy = newPos.y - origMid.y;
        return {
          start: { x: shape.start.x + dx, y: shape.start.y + dy },
          end: { x: shape.end.x + dx, y: shape.end.y + dy },
        } as Partial<Shape>;
      }
      return null;

    case 'arc': {
      if (gripIndex === 0) {
        // Center drag — move entire arc
        const dx = newPos.x - shape.center.x;
        const dy = newPos.y - shape.center.y;
        return { center: { x: shape.center.x + dx, y: shape.center.y + dy } } as Partial<Shape>;
      }
      if (gripIndex === 1) {
        // Start point drag — adjust startAngle and radius
        const dx = newPos.x - shape.center.x;
        const dy = newPos.y - shape.center.y;
        const newRadius = Math.max(1, Math.sqrt(dx * dx + dy * dy));
        const newAngle = Math.atan2(dy, dx);
        return { startAngle: newAngle, radius: newRadius } as Partial<Shape>;
      }
      if (gripIndex === 2) {
        // End point drag — adjust endAngle and radius
        const dx = newPos.x - shape.center.x;
        const dy = newPos.y - shape.center.y;
        const newRadius = Math.max(1, Math.sqrt(dx * dx + dy * dy));
        const newAngle = Math.atan2(dy, dx);
        return { endAngle: newAngle, radius: newRadius } as Partial<Shape>;
      }
      if (gripIndex === 3) {
        // Midpoint drag — recompute center & radius so the arc passes through
        // the fixed start point, fixed end point, and the dragged position.
        const p1 = {
          x: shape.center.x + shape.radius * Math.cos(shape.startAngle),
          y: shape.center.y + shape.radius * Math.sin(shape.startAngle),
        };
        const p2 = {
          x: shape.center.x + shape.radius * Math.cos(shape.endAngle),
          y: shape.center.y + shape.radius * Math.sin(shape.endAngle),
        };
        const p3 = newPos;

        // Find circumcenter of triangle (p1, p2, p3)
        const ax = p1.x, ay = p1.y;
        const bx = p2.x, by = p2.y;
        const cx = p3.x, cy = p3.y;
        const D = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by));

        if (Math.abs(D) < 1e-10) {
          // Points are collinear — can't form a circle
          return null;
        }

        const ux = ((ax * ax + ay * ay) * (by - cy) + (bx * bx + by * by) * (cy - ay) + (cx * cx + cy * cy) * (ay - by)) / D;
        const uy = ((ax * ax + ay * ay) * (cx - bx) + (bx * bx + by * by) * (ax - cx) + (cx * cx + cy * cy) * (bx - ax)) / D;
        const newCenter = { x: ux, y: uy };
        const newRadius = Math.max(1, Math.sqrt((ax - ux) * (ax - ux) + (ay - uy) * (ay - uy)));
        const newStartAngle = Math.atan2(ay - uy, ax - ux);
        const newEndAngle = Math.atan2(by - uy, bx - ux);

        return {
          center: newCenter,
          radius: newRadius,
          startAngle: newStartAngle,
          endAngle: newEndAngle,
        } as Partial<Shape>;
      }
      return null;
    }

    case 'circle': {
      if (gripIndex === 0) {
        // Center drag — move circle
        const dx = newPos.x - shape.center.x;
        const dy = newPos.y - shape.center.y;
        return { center: { x: shape.center.x + dx, y: shape.center.y + dy } } as Partial<Shape>;
      }
      return null;
    }

    case 'ellipse': {
      if (gripIndex === 0) {
        // Center drag — move ellipse
        return { center: { x: newPos.x, y: newPos.y } } as Partial<Shape>;
      }
      if (gripIndex === 1 || gripIndex === 2) {
        // Right/Left — adjust radiusX
        const newRadiusX = Math.abs(newPos.x - shape.center.x);
        return { radiusX: Math.max(1, newRadiusX) } as Partial<Shape>;
      }
      if (gripIndex === 3 || gripIndex === 4) {
        // Bottom/Top — adjust radiusY
        const newRadiusY = Math.abs(newPos.y - shape.center.y);
        return { radiusY: Math.max(1, newRadiusY) } as Partial<Shape>;
      }
      return null;
    }

    case 'rectangle': {
      if (gripIndex === 8) {
        // Center drag — move entire rectangle
        const origCenter = {
          x: shape.topLeft.x + shape.width / 2,
          y: shape.topLeft.y + shape.height / 2,
        };
        const dx = newPos.x - origCenter.x;
        const dy = newPos.y - origCenter.y;
        return {
          topLeft: { x: shape.topLeft.x + dx, y: shape.topLeft.y + dy },
        } as Partial<Shape>;
      }
      return null;
    }

    case 'polyline':
    case 'spline': {
      if (edgeMidpointIndices) {
        // Edge midpoint: move two adjacent points by the same delta
        const [i1, i2] = edgeMidpointIndices;
        const origMid = {
          x: (shape.points[i1].x + shape.points[i2].x) / 2,
          y: (shape.points[i1].y + shape.points[i2].y) / 2,
        };
        const dx = newPos.x - origMid.x;
        const dy = newPos.y - origMid.y;
        const newPoints = shape.points.map((p, i) =>
          (i === i1 || i === i2) ? { x: p.x + dx, y: p.y + dy } : p
        );
        return { points: newPoints } as Partial<Shape>;
      }
      if (gripIndex < 0 || gripIndex >= shape.points.length) return null;
      const newPoints = shape.points.map((p, i) =>
        i === gripIndex ? { x: newPos.x, y: newPos.y } : p
      );
      return { points: newPoints } as Partial<Shape>;
    }

    case 'text': {
      if (gripIndex === 0) {
        return { position: { x: newPos.x, y: newPos.y } } as Partial<Shape>;
      }
      return null;
    }

    default:
      return null;
  }
}

export function useGripEditing() {
  const {
    viewport,
    shapes,
    selectedShapeIds,
    updateShape,
    setCurrentSnapPoint,
  } = useAppStore();

  const dragRef = useRef<GripDragState | null>(null);

  const handleGripMouseDown = useCallback(
    (worldPos: Point): boolean => {
      if (selectedShapeIds.length !== 1) return false;

      const shapeId = selectedShapeIds[0];
      const shape = shapes.find(s => s.id === shapeId);
      if (!shape) return false;

      const grips = getGripPoints(shape);
      if (grips.length === 0) return false;

      const tolerance = 10 / viewport.zoom;

      // First pass: check axis arrows on all grips (arrows take priority)
      // Skip arc midpoint (grip 3) — its circumcenter algorithm can't handle axis constraint
      for (let i = 0; i < grips.length; i++) {
        if (shape.type === 'arc' && i === 3) continue;
        const axisHit = hitTestAxisArrow(worldPos, grips[i], viewport.zoom);
        if (axisHit) {
          setCurrentSnapPoint(null);

          // Handle shape conversions same as regular grip drag
          if (shape.type === 'circle' && i >= 1) {
            const ellipse = circleToEllipse(shape);
            if (!ellipse) return false;
            useAppStore.setState((state) => {
              const idx = state.shapes.findIndex(s => s.id === shapeId);
              if (idx !== -1) state.shapes[idx] = ellipse as Shape;
            });
            dragRef.current = {
              shapeId, gripIndex: i,
              originalShape: JSON.parse(JSON.stringify(shape)),
              convertedToPolyline: false, originalRectGripIndex: i,
              axisConstraint: axisHit, originalGripPoint: { ...grips[i] },
            };
            return true;
          }

          if (shape.type === 'rectangle' && i < 8) {
            const polyline = rectangleToPolyline(shape);
            if (!polyline) return false;
            useAppStore.setState((state) => {
              const idx = state.shapes.findIndex(s => s.id === shapeId);
              if (idx !== -1) state.shapes[idx] = polyline as Shape;
            });
            dragRef.current = {
              shapeId, gripIndex: i,
              originalShape: JSON.parse(JSON.stringify(shape)),
              convertedToPolyline: true, originalRectGripIndex: i,
              axisConstraint: axisHit, originalGripPoint: { ...grips[i] },
            };
            return true;
          }

          let polylineMidpointIndices: [number, number] | undefined;
          if ((shape.type === 'polyline' || shape.type === 'spline') && i >= shape.points.length) {
            const segIdx = i - shape.points.length;
            const j = (segIdx + 1) % shape.points.length;
            polylineMidpointIndices = [segIdx, j];
          }

          dragRef.current = {
            shapeId, gripIndex: i,
            originalShape: JSON.parse(JSON.stringify(shape)),
            convertedToPolyline: false, originalRectGripIndex: i,
            polylineMidpointIndices,
            axisConstraint: axisHit, originalGripPoint: { ...grips[i] },
          };
          return true;
        }
      }

      // Second pass: check grip squares (unconstrained drag)
      for (let i = 0; i < grips.length; i++) {
        const dx = worldPos.x - grips[i].x;
        const dy = worldPos.y - grips[i].y;
        if (Math.sqrt(dx * dx + dy * dy) <= tolerance) {
          // Clear snap indicator so it doesn't linger at the old position
          setCurrentSnapPoint(null);

          // For circles, convert to ellipse for cardinal point drags (1-4)
          // Center drag (0) keeps the circle as-is
          if (shape.type === 'circle' && i >= 1) {
            const ellipse = circleToEllipse(shape);
            if (!ellipse) return false;

            useAppStore.setState((state) => {
              const idx = state.shapes.findIndex(s => s.id === shapeId);
              if (idx !== -1) {
                state.shapes[idx] = ellipse as Shape;
              }
            });

            dragRef.current = {
              shapeId,
              gripIndex: i,
              originalShape: JSON.parse(JSON.stringify(shape)),
              convertedToPolyline: false,
              originalRectGripIndex: i,
              axisConstraint: null,
            };
            return true;
          }

          // For rectangles, convert to polyline for corner (0-3) and edge midpoint (4-7) drags
          // Center drag (8) keeps the rectangle as-is
          if (shape.type === 'rectangle' && i < 8) {
            const polyline = rectangleToPolyline(shape);
            if (!polyline) return false;

            // Replace the rectangle with a polyline in the store (no history)
            useAppStore.setState((state) => {
              const idx = state.shapes.findIndex(s => s.id === shapeId);
              if (idx !== -1) {
                state.shapes[idx] = polyline as Shape;
              }
            });

            dragRef.current = {
              shapeId,
              gripIndex: i < 4 ? i : i, // corner or edge mid index
              originalShape: JSON.parse(JSON.stringify(shape)),
              convertedToPolyline: true,
              originalRectGripIndex: i,
              axisConstraint: null,
            };
          } else {
            // For polyline midpoint grips, compute the two vertex indices
            let polylineMidpointIndices: [number, number] | undefined;
            if ((shape.type === 'polyline' || shape.type === 'spline') && i >= shape.points.length) {
              const segIdx = i - shape.points.length;
              const j = (segIdx + 1) % shape.points.length;
              polylineMidpointIndices = [segIdx, j];
            }

            dragRef.current = {
              shapeId,
              gripIndex: i,
              originalShape: JSON.parse(JSON.stringify(shape)),
              convertedToPolyline: false,
              originalRectGripIndex: i,
              polylineMidpointIndices,
              axisConstraint: null,
            };
          }
          return true;
        }
      }

      return false;
    },
    [selectedShapeIds, shapes, viewport.zoom]
  );

  const handleGripMouseMove = useCallback(
    (worldPos: Point): boolean => {
      const drag = dragRef.current;
      if (!drag) return false;

      // For converted rectangles, read the current polyline from store
      const currentShape = useAppStore.getState().shapes.find(s => s.id === drag.shapeId);
      if (!currentShape) return true;

      // Apply axis constraint
      let constrainedPos = worldPos;
      if (drag.axisConstraint && drag.originalGripPoint) {
        constrainedPos = { ...worldPos };
        if (drag.axisConstraint === 'x') constrainedPos.y = drag.originalGripPoint.y;
        if (drag.axisConstraint === 'y') constrainedPos.x = drag.originalGripPoint.x;
      }

      const edgeIndices = drag.polylineMidpointIndices ?? (drag.convertedToPolyline ? getRectEdgeMidpointIndices(drag.originalRectGripIndex) : undefined);
      const updates = computeGripUpdates(currentShape, drag.gripIndex, constrainedPos, edgeIndices);
      if (updates) {
        useAppStore.setState((state) => {
          const idx = state.shapes.findIndex(s => s.id === drag.shapeId);
          if (idx !== -1) {
            Object.assign(state.shapes[idx], updates);
          }
        });
      }
      return true;
    },
    []
  );

  const handleGripMouseUp = useCallback((): boolean => {
    const drag = dragRef.current;
    if (!drag) return false;

    const currentShape = useAppStore.getState().shapes.find(s => s.id === drag.shapeId);
    if (currentShape) {
      // Restore original shape (direct mutation, no history)
      useAppStore.setState((state) => {
        const idx = state.shapes.findIndex(s => s.id === drag.shapeId);
        if (idx !== -1) {
          state.shapes[idx] = { ...drag.originalShape } as Shape;
        }
      });

      // Commit final state through updateShape (single history entry)
      const typeChanged = drag.originalShape.type !== currentShape.type;
      if (typeChanged) {
        // Shape type was converted (rect→polyline or circle→ellipse)
        // Replace with the full converted shape data
        const convertedData = { ...currentShape } as Shape;
        updateShape(drag.shapeId, convertedData);
      } else {
        // Commit the current (mutated) shape state as a single history entry
        updateShape(drag.shapeId, { ...currentShape } as Partial<Shape>);
      }
    }

    dragRef.current = null;
    return true;
  }, [updateShape]);

  const isDragging = useCallback(() => dragRef.current !== null, []);

  /**
   * Check if a world position is hovering over an axis arrow on any selected grip.
   * Returns 'x', 'y', or null.
   */
  const getHoveredAxis = useCallback(
    (worldPos: Point): 'x' | 'y' | null => {
      if (selectedShapeIds.length !== 1) return null;
      const shape = shapes.find(s => s.id === selectedShapeIds[0]);
      if (!shape) return null;
      const grips = getGripPoints(shape);
      for (let i = 0; i < grips.length; i++) {
        if (shape.type === 'arc' && i === 3) continue;
        const axis = hitTestAxisArrow(worldPos, grips[i], viewport.zoom);
        if (axis) return axis;
      }
      return null;
    },
    [selectedShapeIds, shapes, viewport.zoom]
  );

  return {
    handleGripMouseDown,
    handleGripMouseMove,
    handleGripMouseUp,
    isDragging,
    getHoveredAxis,
  };
}
