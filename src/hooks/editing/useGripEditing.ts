/**
 * useGripEditing - Handles dragging shape selection handles (grips) to edit geometry
 *
 * Currently supports:
 * - Line: drag start/end points
 * - Rectangle: drag corners/edges to resize, preserving cornerRadius
 * - Parametric shapes: drag center to move
 */

import { useCallback, useRef } from 'react';
import { useAppStore } from '../../state/appStore';
import type { Point, Shape, EllipseShape, TextShape, BeamShape, LineShape } from '../../types/geometry';
import type { DimensionShape } from '../../types/dimension';
import type { ParametricShape } from '../../types/parametric';
import { updateParametricPosition } from '../../services/parametric/parametricService';
import { getTextBounds } from '../../engine/geometry/GeometryUtils';
import { calculateAlignedDimensionGeometry, angleBetweenPoints, calculateDimensionValue, formatDimensionValue } from '../../engine/geometry/DimensionUtils';
import { findNearestSnapPoint } from '../../engine/geometry/SnapUtils';
import { applyTracking, type TrackingSettings } from '../../engine/geometry/Tracking';

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
  /** Enable snapping for this grip (e.g., dimension reference points). */
  enableSnapping?: boolean;
  /** Initial angle for rotation handles (to calculate relative rotation). */
  initialRotationAngle?: number;
  /** Rotation center for rotation handles. */
  rotationCenter?: Point;
}

interface ParametricGripDragState {
  shapeId: string;
  isParametric: true;
  originalPosition: Point;
  originalGripPoint: Point;
  axisConstraint: 'x' | 'y' | null;
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

function getGripPoints(shape: Shape, drawingScale?: number, zoom?: number): Point[] {
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
    case 'ellipse': {
      // 0: center, 1: right, 2: left, 3: bottom, 4: top
      const rot = shape.rotation || 0;
      const cos = Math.cos(rot);
      const sin = Math.sin(rot);
      const cx = shape.center.x;
      const cy = shape.center.y;
      // Transform local ellipse coordinates to world coordinates
      const toWorld = (lx: number, ly: number) => ({
        x: cx + lx * cos - ly * sin,
        y: cy + lx * sin + ly * cos,
      });
      return [
        shape.center,                      // Center grip
        toWorld(shape.radiusX, 0),         // Right grip
        toWorld(-shape.radiusX, 0),        // Left grip
        toWorld(0, shape.radiusY),         // Bottom grip
        toWorld(0, -shape.radiusY),        // Top grip
      ];
    }
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
    case 'hatch': {
      const pts: Point[] = [...shape.points];
      for (let i = 0; i < shape.points.length; i++) {
        const j = (i + 1) % shape.points.length;
        pts.push({
          x: (shape.points[i].x + shape.points[j].x) / 2,
          y: (shape.points[i].y + shape.points[j].y) / 2,
        });
      }
      return pts;
    }
    case 'beam':
      // Beam handles: start, end, and midpoint
      return [
        shape.start,
        shape.end,
        { x: (shape.start.x + shape.end.x) / 2, y: (shape.start.y + shape.end.y) / 2 },
      ];
    case 'text': {
      // Grip 0: center of text box (move handle)
      // Grip 1: left edge midpoint (resize width from left)
      // Grip 2: right edge midpoint (resize width from right)
      // Grip 3: rotation handle (above text box)
      const textShape = shape as TextShape;
      const effectiveZoom = zoom || 1;
      const rotation = textShape.rotation || 0;
      const pos = textShape.position;

      // Helper to rotate a point around position
      const rotatePoint = (p: Point): Point => {
        if (rotation === 0) return p;
        const cos = Math.cos(rotation);
        const sin = Math.sin(rotation);
        const dx = p.x - pos.x;
        const dy = p.y - pos.y;
        return {
          x: pos.x + dx * cos - dy * sin,
          y: pos.y + dx * sin + dy * cos,
        };
      };

      // Use getTextBounds for accurate bounds calculation (matches renderer)
      const bounds = getTextBounds(textShape, drawingScale);
      if (bounds) {
        const centerX = (bounds.minX + bounds.maxX) / 2;
        const midY = (bounds.minY + bounds.maxY) / 2;
        const topY = bounds.minY;

        // Calculate grip points in local coordinates, then rotate to world
        const rotationHandleDistance = 25 / effectiveZoom;
        const localGrips: Point[] = [
          { x: centerX, y: midY },                    // 0: Move handle
          { x: bounds.minX - 2, y: midY },            // 1: Left resize
          { x: bounds.maxX + 2, y: midY },            // 2: Right resize
          { x: centerX, y: topY - 2 - rotationHandleDistance }, // 3: Rotation handle
        ];
        return localGrips.map(rotatePoint);
      } else {
        // Fallback to simple estimate if bounds calculation fails
        const estimatedWidth = textShape.fixedWidth || (textShape.fontSize * textShape.text.length * 0.6);
        let leftX = textShape.position.x;
        let rightX = textShape.position.x + estimatedWidth;
        if (textShape.alignment === 'center') {
          leftX = textShape.position.x - estimatedWidth / 2;
          rightX = textShape.position.x + estimatedWidth / 2;
        } else if (textShape.alignment === 'right') {
          leftX = textShape.position.x - estimatedWidth;
          rightX = textShape.position.x;
        }
        const centerX = (leftX + rightX) / 2;
        const midY = textShape.position.y;
        const rotationHandleDistance = 25 / effectiveZoom;
        const localGrips: Point[] = [
          { x: centerX, y: midY },
          { x: leftX - 2, y: midY },
          { x: rightX + 2, y: midY },
          { x: centerX, y: midY - rotationHandleDistance },
        ];
        return localGrips.map(rotatePoint);
      }
    }
    case 'dimension': {
      // Dimension grip points:
      // 0: Text handle (for moving text)
      // 1: Dimension line midpoint (for adjusting offset)
      // 2: Dimension line start (witness line 1)
      // 3: Dimension line end (witness line 2)
      // 4+: Reference points
      const dim = shape as DimensionShape;
      if (dim.dimensionType === 'aligned' || dim.dimensionType === 'linear') {
        if (dim.points.length < 2) return [];

        const geometry = calculateAlignedDimensionGeometry(
          dim.points[0],
          dim.points[1],
          dim.dimensionLineOffset,
          dim.dimensionStyle,
          dim.linearDirection
        );

        const angle = angleBetweenPoints(geometry.start, geometry.end);
        const perpAngle = angle - Math.PI / 2;
        const textHeight = dim.dimensionStyle.textHeight || 3;
        const textHandleOffset = textHeight * 1.5;

        // Calculate text position (with offset if set)
        const textPos = dim.textOffset
          ? { x: geometry.textPosition.x + dim.textOffset.x, y: geometry.textPosition.y + dim.textOffset.y }
          : geometry.textPosition;

        // Text drag handle position (below text)
        const textHandle = {
          x: textPos.x + Math.cos(perpAngle) * textHandleOffset,
          y: textPos.y + Math.sin(perpAngle) * textHandleOffset,
        };

        // Dimension line midpoint
        const dimLineMidpoint = {
          x: (geometry.start.x + geometry.end.x) / 2,
          y: (geometry.start.y + geometry.end.y) / 2,
        };

        return [
          textHandle,           // 0: Text drag handle
          dimLineMidpoint,      // 1: Dimension line offset handle
          geometry.start,       // 2: Witness line 1 (at dim line)
          geometry.end,         // 3: Witness line 2 (at dim line)
          ...dim.points,        // 4+: Reference points
        ];
      }
      // Fallback for other dimension types
      return dim.points;
    }
    default:
      return [];
  }
}

/**
 * Get grip points for parametric shapes (center only for moving).
 */
function getParametricGripPoints(shape: ParametricShape): Point[] {
  const bounds = shape.generatedGeometry?.bounds;
  if (!bounds) {
    // Fallback to position if no bounds available
    return [shape.position];
  }
  // Return center of bounding box
  return [{
    x: (bounds.minX + bounds.maxX) / 2,
    y: (bounds.minY + bounds.maxY) / 2,
  }];
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
      // Transform world position to local ellipse coordinates (accounting for rotation)
      const rot = shape.rotation || 0;
      const cos = Math.cos(-rot); // Inverse rotation
      const sin = Math.sin(-rot);
      const dx = newPos.x - shape.center.x;
      const dy = newPos.y - shape.center.y;
      // Local coordinates (ellipse-aligned)
      const localX = dx * cos - dy * sin;
      const localY = dx * sin + dy * cos;

      if (gripIndex === 1 || gripIndex === 2) {
        // Right/Left — adjust radiusX using local X coordinate
        const newRadiusX = Math.abs(localX);
        return { radiusX: Math.max(1, newRadiusX) } as Partial<Shape>;
      }
      if (gripIndex === 3 || gripIndex === 4) {
        // Bottom/Top — adjust radiusY using local Y coordinate
        const newRadiusY = Math.abs(localY);
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
      // Corner grips (0-3): TL, TR, BR, BL
      const tl = shape.topLeft;
      const w = shape.width;
      const h = shape.height;
      const right = tl.x + w;
      const bottom = tl.y + h;
      let newLeft = tl.x, newTop = tl.y, newRight = right, newBottom = bottom;
      switch (gripIndex) {
        case 0: newLeft = newPos.x; newTop = newPos.y; break;    // TL
        case 1: newRight = newPos.x; newTop = newPos.y; break;   // TR
        case 2: newRight = newPos.x; newBottom = newPos.y; break; // BR
        case 3: newLeft = newPos.x; newBottom = newPos.y; break;  // BL
        case 4: newTop = newPos.y; break;    // top edge mid
        case 5: newRight = newPos.x; break;  // right edge mid
        case 6: newBottom = newPos.y; break; // bottom edge mid
        case 7: newLeft = newPos.x; break;   // left edge mid
        default: return null;
      }
      // Normalize so width/height are positive
      const finalLeft = Math.min(newLeft, newRight);
      const finalTop = Math.min(newTop, newBottom);
      return {
        topLeft: { x: finalLeft, y: finalTop },
        width: Math.abs(newRight - newLeft),
        height: Math.abs(newBottom - newTop),
      } as Partial<Shape>;
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

    case 'hatch': {
      if (edgeMidpointIndices) {
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

    case 'beam': {
      const beamShape = shape as BeamShape;
      if (gripIndex === 0) {
        // Start point drag
        return { start: newPos } as Partial<Shape>;
      }
      if (gripIndex === 1) {
        // End point drag
        return { end: newPos } as Partial<Shape>;
      }
      if (gripIndex === 2) {
        // Midpoint drag — move both endpoints by the delta from original midpoint
        const origMid = {
          x: (beamShape.start.x + beamShape.end.x) / 2,
          y: (beamShape.start.y + beamShape.end.y) / 2,
        };
        const dx = newPos.x - origMid.x;
        const dy = newPos.y - origMid.y;
        return {
          start: { x: beamShape.start.x + dx, y: beamShape.start.y + dy },
          end: { x: beamShape.end.x + dx, y: beamShape.end.y + dy },
        } as Partial<Shape>;
      }
      return null;
    }

    case 'text': {
      // Calculate current text bounds
      const estimatedWidth = shape.fixedWidth || (shape.fontSize * shape.text.length * 0.6);

      if (gripIndex === 0) {
        // Move the text - grip is at center of text box, need to calculate delta
        // Use getTextBounds for accurate center calculation (same as getGripPoints)
        const bounds = getTextBounds(shape as TextShape);
        if (bounds) {
          const currentCenterX = (bounds.minX + bounds.maxX) / 2;
          const currentCenterY = (bounds.minY + bounds.maxY) / 2;
          const dx = newPos.x - currentCenterX;
          const dy = newPos.y - currentCenterY;
          return {
            position: { x: shape.position.x + dx, y: shape.position.y + dy }
          } as Partial<Shape>;
        }
        // Fallback to simple estimate
        let currentLeftX = shape.position.x;
        let currentRightX = shape.position.x + estimatedWidth;
        if (shape.alignment === 'center') {
          currentLeftX = shape.position.x - estimatedWidth / 2;
          currentRightX = shape.position.x + estimatedWidth / 2;
        } else if (shape.alignment === 'right') {
          currentLeftX = shape.position.x - estimatedWidth;
          currentRightX = shape.position.x;
        }
        const currentCenterX = (currentLeftX + currentRightX) / 2;
        const dx = newPos.x - currentCenterX;
        const dy = newPos.y - shape.position.y;
        return {
          position: { x: shape.position.x + dx, y: shape.position.y + dy }
        } as Partial<Shape>;
      }

      // For resize operations

      let currentLeftX = shape.position.x;
      let currentRightX = shape.position.x + estimatedWidth;

      if (shape.alignment === 'center') {
        currentLeftX = shape.position.x - estimatedWidth / 2;
        currentRightX = shape.position.x + estimatedWidth / 2;
      } else if (shape.alignment === 'right') {
        currentLeftX = shape.position.x - estimatedWidth;
        currentRightX = shape.position.x;
      }

      // Handle positions have a 2px offset from text edges (matching renderer)
      // Convert drag position back to text edge position
      if (gripIndex === 1) {
        // Left resize handle - user is dragging left edge
        // newPos.x is where handle is, text edge is newPos.x + 2
        const newTextLeftX = newPos.x + 2;
        const newWidth = Math.max(shape.fontSize * 2, currentRightX - newTextLeftX);

        if (shape.alignment === 'left') {
          // For left-aligned text, move position and set fixedWidth
          return {
            position: { x: newTextLeftX, y: shape.position.y },
            fixedWidth: newWidth,
          } as Partial<Shape>;
        } else if (shape.alignment === 'center') {
          // For center-aligned, adjust position to keep center, set fixedWidth
          const newCenterX = (newTextLeftX + currentRightX) / 2;
          return {
            position: { x: newCenterX, y: shape.position.y },
            fixedWidth: newWidth,
          } as Partial<Shape>;
        } else {
          // For right-aligned, just change fixedWidth (position stays at right edge)
          return { fixedWidth: newWidth } as Partial<Shape>;
        }
      }

      if (gripIndex === 2) {
        // Right resize handle - user is dragging right edge
        // newPos.x is where handle is, text edge is newPos.x - 2
        const newTextRightX = newPos.x - 2;
        const newWidth = Math.max(shape.fontSize * 2, newTextRightX - currentLeftX);

        if (shape.alignment === 'left') {
          // For left-aligned, just set fixedWidth
          return { fixedWidth: newWidth } as Partial<Shape>;
        } else if (shape.alignment === 'center') {
          // For center-aligned, adjust position to keep center, set fixedWidth
          const newCenterX = (currentLeftX + newTextRightX) / 2;
          return {
            position: { x: newCenterX, y: shape.position.y },
            fixedWidth: newWidth,
          } as Partial<Shape>;
        } else {
          // For right-aligned, move position to new right edge
          return {
            position: { x: newTextRightX, y: shape.position.y },
            fixedWidth: newWidth,
          } as Partial<Shape>;
        }
      }

      if (gripIndex === 3) {
        // Rotation handle - calculate angle from rotation center to mouse position
        // The rotation center is shape.position (same as in renderer)
        const centerX = shape.position.x;
        const centerY = shape.position.y;

        const dx = newPos.x - centerX;
        const dy = newPos.y - centerY;

        // Calculate angle where 0 = handle above center, positive = clockwise
        // atan2(dx, -dy) gives correct orientation for text rotation
        const angle = Math.atan2(dx, -dy);

        return { rotation: angle } as Partial<Shape>;
      }

      return null;
    }

    case 'dimension': {
      const dim = shape as DimensionShape;

      if (dim.dimensionType === 'aligned' || dim.dimensionType === 'linear') {
        if (dim.points.length < 2) return null;

        const geometry = calculateAlignedDimensionGeometry(
          dim.points[0],
          dim.points[1],
          dim.dimensionLineOffset,
          dim.dimensionStyle,
          dim.linearDirection
        );

        if (gripIndex === 0) {
          // Text drag handle - update textOffset
          // Calculate offset from default text position
          const defaultTextPos = geometry.textPosition;
          const textOffset = {
            x: newPos.x - defaultTextPos.x,
            y: newPos.y - defaultTextPos.y,
          };
          // Adjust for the handle offset (handle is below text)
          const angle = angleBetweenPoints(geometry.start, geometry.end);
          const perpAngle = angle - Math.PI / 2;
          const textHeight = dim.dimensionStyle.textHeight || 3;
          const handleOffset = textHeight * 1.5;
          textOffset.x += Math.cos(perpAngle) * handleOffset;
          textOffset.y += Math.sin(perpAngle) * handleOffset;

          return { textOffset } as Partial<Shape>;
        }

        if (gripIndex === 1) {
          // Dimension line offset handle - adjust dimensionLineOffset
          // Calculate perpendicular distance from original points to new position
          const p1 = dim.points[0];
          const p2 = dim.points[1];

          // Direction along the dimension
          let dimDir: Point;
          if (dim.linearDirection === 'horizontal') {
            dimDir = { x: 1, y: 0 };
          } else if (dim.linearDirection === 'vertical') {
            dimDir = { x: 0, y: 1 };
          } else {
            const len = Math.sqrt(Math.pow(p2.x - p1.x, 2) + Math.pow(p2.y - p1.y, 2));
            dimDir = { x: (p2.x - p1.x) / len, y: (p2.y - p1.y) / len };
          }

          // Perpendicular direction
          const perpDir = { x: -dimDir.y, y: dimDir.x };

          // Project newPos onto perpendicular from midpoint of p1-p2
          const midP = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
          const toNew = { x: newPos.x - midP.x, y: newPos.y - midP.y };
          const newOffset = toNew.x * perpDir.x + toNew.y * perpDir.y;

          return { dimensionLineOffset: newOffset } as Partial<Shape>;
        }

        if (gripIndex === 2 || gripIndex === 3) {
          // Witness line grips - these move along the dimension line direction
          // For now, just return null (could implement witness line adjustment later)
          return null;
        }

        if (gripIndex >= 4) {
          // Reference point handles - move the measurement points
          const pointIndex = gripIndex - 4;
          if (pointIndex < dim.points.length) {
            const newPoints = [...dim.points];
            newPoints[pointIndex] = { x: newPos.x, y: newPos.y };

            // Recalculate dimension value (unless user has overridden it)
            if (!dim.valueOverridden) {
              const newValue = calculateDimensionValue(newPoints, dim.dimensionType, dim.linearDirection);
              const formattedValue = formatDimensionValue(newValue, dim.dimensionType, dim.dimensionStyle.precision);
              return { points: newPoints, value: formattedValue } as Partial<Shape>;
            }

            return { points: newPoints } as Partial<Shape>;
          }
        }
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
    parametricShapes,
    selectedShapeIds,
    updateShape,
    updateProfilePosition,
    setCurrentSnapPoint,
    drawings,
    activeDrawingId,
    // Tracking state
    trackingEnabled,
    polarTrackingEnabled,
    orthoMode,
    objectTrackingEnabled,
    polarAngleIncrement,
    activeSnaps,
    snapTolerance,
    setCurrentTrackingLines,
    setTrackingPoint,
  } = useAppStore();

  const dragRef = useRef<GripDragState | null>(null);
  const parametricDragRef = useRef<ParametricGripDragState | null>(null);

  // Get the active drawing scale for text bounds calculation
  const activeDrawing = drawings.find(d => d.id === activeDrawingId);
  const drawingScale = activeDrawing?.scale;

  const handleGripMouseDown = useCallback(
    (worldPos: Point): boolean => {
      if (selectedShapeIds.length !== 1) return false;

      const shapeId = selectedShapeIds[0];

      // Check if it's a parametric shape first
      const parametricShape = parametricShapes.find(s => s.id === shapeId);
      if (parametricShape) {
        const grips = getParametricGripPoints(parametricShape);
        if (grips.length === 0) return false;

        const tolerance = 10 / viewport.zoom;
        const grip = grips[0]; // Center grip

        // Check axis arrows first
        const axisHit = hitTestAxisArrow(worldPos, grip, viewport.zoom);
        if (axisHit) {
          setCurrentSnapPoint(null);
          parametricDragRef.current = {
            shapeId,
            isParametric: true,
            originalPosition: { ...parametricShape.position },
            originalGripPoint: { ...grip },
            axisConstraint: axisHit,
          };
          return true;
        }

        // Check grip square
        const dx = worldPos.x - grip.x;
        const dy = worldPos.y - grip.y;
        if (Math.sqrt(dx * dx + dy * dy) <= tolerance) {
          setCurrentSnapPoint(null);
          parametricDragRef.current = {
            shapeId,
            isParametric: true,
            originalPosition: { ...parametricShape.position },
            originalGripPoint: { ...grip },
            axisConstraint: null,
          };
          return true;
        }

        return false;
      }

      const shape = shapes.find(s => s.id === shapeId);
      if (!shape) return false;

      const grips = getGripPoints(shape, drawingScale, viewport.zoom);
      if (grips.length === 0) return false;

      const tolerance = 10 / viewport.zoom;

      // First pass: check axis arrows on all grips (arrows take priority)
      // Skip arc midpoint (grip 3) — its circumcenter algorithm can't handle axis constraint
      // Skip text resize handles (grips 1, 2) for Y-axis — they only support X-axis (width) resize
      // Skip text rotation handle (grip 3) — it's a rotation control, no axis constraint
      for (let i = 0; i < grips.length; i++) {
        if (shape.type === 'arc' && i === 3) continue;
        if (shape.type === 'text' && i === 3) continue; // Rotation handle - no axis arrows
        const axisHit = hitTestAxisArrow(worldPos, grips[i], viewport.zoom);
        if (axisHit) {
          // For text resize handles, only accept X-axis constraint (width adjustment only)
          if (shape.type === 'text' && (i === 1 || i === 2) && axisHit === 'y') {
            continue; // Skip Y-axis hits on text resize handles
          }

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

          let polylineMidpointIndices: [number, number] | undefined;
          if ((shape.type === 'polyline' || shape.type === 'spline' || shape.type === 'hatch') && i >= shape.points.length) {
            const segIdx = i - shape.points.length;
            const j = (segIdx + 1) % shape.points.length;
            polylineMidpointIndices = [segIdx, j];
          }

          // For text resize handles, always force X-axis constraint
          const effectiveAxisHit = (shape.type === 'text' && (i === 1 || i === 2)) ? 'x' : axisHit;

          dragRef.current = {
            shapeId, gripIndex: i,
            originalShape: JSON.parse(JSON.stringify(shape)),
            convertedToPolyline: false, originalRectGripIndex: i,
            polylineMidpointIndices,
            axisConstraint: effectiveAxisHit, originalGripPoint: { ...grips[i] },
          };
          return true;
        }
      }

      // Second pass: check grip squares (unconstrained drag)
      for (let i = 0; i < grips.length; i++) {
        const dx = worldPos.x - grips[i].x;
        const dy = worldPos.y - grips[i].y;

        // For text resize handles (grips 1 and 2), use rectangular hit test for bar-shaped handles
        let isHit = false;
        if (shape.type === 'text' && (i === 1 || i === 2)) {
          // Bar-shaped handle: generous hit area for easier clicking
          const barHalfWidth = tolerance * 1.5;  // Wider horizontal tolerance
          const barHalfHeight = tolerance * 2.0; // Taller vertical tolerance
          isHit = Math.abs(dx) <= barHalfWidth && Math.abs(dy) <= barHalfHeight;
        } else {
          isHit = Math.sqrt(dx * dx + dy * dy) <= tolerance;
        }

        if (isHit) {
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

          {
            // For polyline midpoint grips, compute the two vertex indices
            let polylineMidpointIndices: [number, number] | undefined;
            if ((shape.type === 'polyline' || shape.type === 'spline') && i >= shape.points.length) {
              const segIdx = i - shape.points.length;
              const j = (segIdx + 1) % shape.points.length;
              polylineMidpointIndices = [segIdx, j];
            }

            // For text resize handles (grips 1 and 2), force X-axis constraint
            // Only width can be adjusted via grip editing
            const forceXAxisConstraint = shape.type === 'text' && (i === 1 || i === 2);

            // Enable snapping for dimension reference point handles (gripIndex >= 4)
            const enableSnapping = shape.type === 'dimension' && i >= 4;

            // For text rotation handle (grip 3), calculate initial angle
            let initialRotationAngle: number | undefined;
            let rotationCenter: Point | undefined;
            if (shape.type === 'text' && i === 3) {
              const textShape = shape as TextShape;
              rotationCenter = { ...textShape.position };
              const dx = worldPos.x - rotationCenter.x;
              const dy = worldPos.y - rotationCenter.y;
              initialRotationAngle = Math.atan2(dx, -dy);
            }

            dragRef.current = {
              shapeId,
              gripIndex: i,
              originalShape: JSON.parse(JSON.stringify(shape)),
              convertedToPolyline: false,
              originalRectGripIndex: i,
              polylineMidpointIndices,
              axisConstraint: forceXAxisConstraint ? 'x' : null,
              originalGripPoint: forceXAxisConstraint ? { ...grips[i] } : undefined,
              enableSnapping,
              initialRotationAngle,
              rotationCenter,
            };
          }
          return true;
        }
      }

      return false;
    },
    [selectedShapeIds, shapes, parametricShapes, viewport.zoom, setCurrentSnapPoint, drawingScale]
  );

  const handleGripMouseMove = useCallback(
    (worldPos: Point): boolean => {
      // Check parametric shape drag first
      const parametricDrag = parametricDragRef.current;
      if (parametricDrag) {
        // Apply axis constraint
        let constrainedPos = worldPos;
        if (parametricDrag.axisConstraint) {
          constrainedPos = { ...worldPos };
          if (parametricDrag.axisConstraint === 'x') constrainedPos.y = parametricDrag.originalGripPoint.y;
          if (parametricDrag.axisConstraint === 'y') constrainedPos.x = parametricDrag.originalGripPoint.x;
        }

        // Calculate delta from original grip point
        const dx = constrainedPos.x - parametricDrag.originalGripPoint.x;
        const dy = constrainedPos.y - parametricDrag.originalGripPoint.y;

        // Update position directly (without history for smooth dragging)
        const newPosition = {
          x: parametricDrag.originalPosition.x + dx,
          y: parametricDrag.originalPosition.y + dy,
        };

        useAppStore.setState((state) => {
          const idx = state.parametricShapes.findIndex(s => s.id === parametricDrag.shapeId);
          if (idx !== -1) {
            // Update position and regenerate geometry for live preview
            const updated = updateParametricPosition(state.parametricShapes[idx], newPosition);
            state.parametricShapes[idx] = updated;
          }
        });

        return true;
      }

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

      // Apply tracking for beam/line endpoint drags and polyline vertex drags
      let basePoint: Point | null = null;
      let shouldApplyTracking = false;

      if (trackingEnabled && !drag.axisConstraint) {
        if ((currentShape.type === 'beam' || currentShape.type === 'line') &&
            (drag.gripIndex === 0 || drag.gripIndex === 1)) {
          // Beam/Line endpoint drag - use opposite endpoint as base
          if (currentShape.type === 'beam') {
            const beam = currentShape as BeamShape;
            basePoint = drag.gripIndex === 0 ? beam.end : beam.start;
          } else if (currentShape.type === 'line') {
            const line = currentShape as LineShape;
            basePoint = drag.gripIndex === 0 ? line.end : line.start;
          }
          shouldApplyTracking = true;
        } else if (currentShape.type === 'polyline' && drag.gripIndex < currentShape.points.length) {
          // Polyline vertex drag - use adjacent vertex as base
          const vertexIndex = drag.gripIndex;
          const points = currentShape.points;
          const numPoints = points.length;

          if (numPoints >= 2) {
            // Use the previous vertex as base (or next if at start)
            if (vertexIndex > 0) {
              basePoint = points[vertexIndex - 1];
            } else if (currentShape.closed && numPoints > 1) {
              // For closed polylines, first vertex connects to last
              basePoint = points[numPoints - 1];
            } else if (numPoints > 1) {
              // For open polylines at start, use next vertex
              basePoint = points[1];
            }
            shouldApplyTracking = true;
          }
        }
      }

      if (shouldApplyTracking && basePoint) {
        const trackingSettings: TrackingSettings = {
          enabled: true,
          polarEnabled: polarTrackingEnabled || orthoMode,
          orthoEnabled: orthoMode,
          objectTrackingEnabled: objectTrackingEnabled,
          parallelTrackingEnabled: activeSnaps.includes('parallel'),
          perpendicularTrackingEnabled: activeSnaps.includes('perpendicular'),
          polarAngleIncrement: orthoMode ? 90 : polarAngleIncrement,
          trackingTolerance: snapTolerance,
        };

        // Get trackable shapes (lines in current drawing, excluding the shape being edited)
        const drawingShapes = shapes
          .filter(s => s.drawingId === activeDrawingId && s.visible && s.id !== drag.shapeId && s.type === 'line')
          .map(s => ({
            id: s.id,
            type: s.type,
            start: (s as LineShape).start,
            end: (s as LineShape).end,
          }));

        const trackingResult = applyTracking(constrainedPos, basePoint, drawingShapes, trackingSettings);

        if (trackingResult) {
          constrainedPos = trackingResult.point;
          setCurrentTrackingLines(trackingResult.trackingLines);
          setTrackingPoint(trackingResult.point);
        } else {
          setCurrentTrackingLines([]);
          setTrackingPoint(null);
        }
      } else {
        // Clear tracking when not applicable
        setCurrentTrackingLines([]);
        setTrackingPoint(null);
      }

      // Apply snap detection for endpoint drags (beam, line, polyline, dimension)
      const shouldEnableSnapping = drag.enableSnapping || shouldApplyTracking;

      if (shouldEnableSnapping) {
        const state = useAppStore.getState();
        if (state.snapEnabled) {
          const worldTolerance = state.snapTolerance / state.viewport.zoom;

          // Calculate adjusted grid size to match visual grid
          let adjustedGridSize = state.gridSize;
          while (adjustedGridSize * state.viewport.zoom < 10) {
            adjustedGridSize *= 5;
          }
          while (adjustedGridSize * state.viewport.zoom > 100) {
            adjustedGridSize /= 5;
          }

          // Filter shapes to current drawing, exclude the shape being edited
          const drawingShapes = state.shapes.filter(
            (s) => s.drawingId === state.activeDrawingId && s.visible && s.id !== drag.shapeId
          );

          // Only include grid snap if grid is visible
          const effectiveSnaps = state.gridVisible
            ? state.activeSnaps
            : state.activeSnaps.filter(s => s !== 'grid');

          const nearestSnap = findNearestSnapPoint(
            constrainedPos,
            drawingShapes,
            effectiveSnaps,
            worldTolerance,
            adjustedGridSize
          );

          if (nearestSnap) {
            constrainedPos = nearestSnap.point;
            setCurrentSnapPoint(nearestSnap);
          } else {
            setCurrentSnapPoint(null);
          }
        }
      }

      // Special handling for text rotation (uses relative angle)
      if (currentShape.type === 'text' && drag.gripIndex === 3 && drag.rotationCenter && drag.initialRotationAngle !== undefined) {
        const dx = constrainedPos.x - drag.rotationCenter.x;
        const dy = constrainedPos.y - drag.rotationCenter.y;
        const currentAngle = Math.atan2(dx, -dy);
        const deltaAngle = currentAngle - drag.initialRotationAngle;
        const originalRotation = (drag.originalShape as TextShape).rotation || 0;
        let newRotation = originalRotation + deltaAngle;

        // Angle snapping - snap to common angles (0°, 45°, 90°, etc.)
        const snapAngles = [0, Math.PI / 4, Math.PI / 2, (3 * Math.PI) / 4, Math.PI, -Math.PI, -(3 * Math.PI) / 4, -Math.PI / 2, -Math.PI / 4];
        const snapThreshold = Math.PI / 36; // 5 degrees in radians

        for (const snapAngle of snapAngles) {
          const diff = Math.abs(newRotation - snapAngle);
          // Also check wrapped angles (e.g., -180° and 180° are the same)
          const wrappedDiff = Math.abs(diff - 2 * Math.PI);
          if (diff < snapThreshold || wrappedDiff < snapThreshold) {
            newRotation = snapAngle;
            break;
          }
        }

        useAppStore.setState((state) => {
          const idx = state.shapes.findIndex(s => s.id === drag.shapeId);
          if (idx !== -1) {
            (state.shapes[idx] as TextShape).rotation = newRotation;
          }
        });
        return true;
      }

      const edgeIndices = drag.polylineMidpointIndices;
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
    [setCurrentSnapPoint, trackingEnabled, polarTrackingEnabled, orthoMode, objectTrackingEnabled,
     polarAngleIncrement, activeSnaps, snapTolerance, shapes, activeDrawingId,
     setCurrentTrackingLines, setTrackingPoint]
  );

  const handleGripMouseUp = useCallback((): boolean => {
    // Clear tracking lines on mouse up
    setCurrentTrackingLines([]);
    setTrackingPoint(null);

    // Check parametric shape drag first
    const parametricDrag = parametricDragRef.current;
    if (parametricDrag) {
      const currentShape = useAppStore.getState().parametricShapes.find(s => s.id === parametricDrag.shapeId);
      if (currentShape) {
        const newPosition = { ...currentShape.position };

        // Restore original position first (for proper history)
        useAppStore.setState((state) => {
          const idx = state.parametricShapes.findIndex(s => s.id === parametricDrag.shapeId);
          if (idx !== -1) {
            state.parametricShapes[idx].position = { ...parametricDrag.originalPosition };
          }
        });

        // Commit through updateProfilePosition (creates history entry)
        updateProfilePosition(parametricDrag.shapeId, newPosition);
      }

      parametricDragRef.current = null;
      return true;
    }

    const drag = dragRef.current;
    if (!drag) return false;

    // Clear snap indicator
    setCurrentSnapPoint(null);

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
  }, [updateShape, updateProfilePosition, setCurrentSnapPoint, setCurrentTrackingLines, setTrackingPoint]);

  const isDragging = useCallback(() => dragRef.current !== null || parametricDragRef.current !== null, []);

  /**
   * Check if a world position is hovering over an axis arrow on any selected grip.
   * Returns 'x', 'y', or null.
   */
  const getHoveredAxis = useCallback(
    (worldPos: Point): 'x' | 'y' | null => {
      if (selectedShapeIds.length !== 1) return null;

      // Check parametric shapes first
      const parametricShape = parametricShapes.find(s => s.id === selectedShapeIds[0]);
      if (parametricShape) {
        const grips = getParametricGripPoints(parametricShape);
        for (const grip of grips) {
          const axis = hitTestAxisArrow(worldPos, grip, viewport.zoom);
          if (axis) return axis;
        }
        return null;
      }

      const shape = shapes.find(s => s.id === selectedShapeIds[0]);
      if (!shape) return null;
      const grips = getGripPoints(shape, drawingScale, viewport.zoom);
      for (let i = 0; i < grips.length; i++) {
        if (shape.type === 'arc' && i === 3) continue;
        const axis = hitTestAxisArrow(worldPos, grips[i], viewport.zoom);
        if (axis) return axis;
      }
      return null;
    },
    [selectedShapeIds, shapes, parametricShapes, viewport.zoom, drawingScale]
  );

  return {
    handleGripMouseDown,
    handleGripMouseMove,
    handleGripMouseUp,
    isDragging,
    getHoveredAxis,
  };
}
