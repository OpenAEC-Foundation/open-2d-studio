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
import type { Point, Shape, EllipseShape, TextShape, BeamShape, LineShape, ImageShape, GridlineShape, LevelShape, PileShape, WallShape, SectionCalloutShape, PlateSystemShape, PuntniveauShape } from '../../types/geometry';
import type { DimensionShape } from '../../types/dimension';
import type { ParametricShape } from '../../types/parametric';
import { updateParametricPosition } from '../../services/parametric/parametricService';
import { getTextBounds, snapToAngle, isPointNearShape } from '../../engine/geometry/GeometryUtils';
import { calculateAlignedDimensionGeometry, angleBetweenPoints, calculateDimensionValue, formatDimensionValue } from '../../engine/geometry/DimensionUtils';
import { findNearestSnapPoint } from '../../engine/geometry/SnapUtils';
import { applyTracking, type TrackingSettings } from '../../engine/geometry/Tracking';
import { setGripHover } from '../../engine/renderer/gripHoverState';
import { setActiveRotation, setRotationGizmoHovered } from '../../engine/renderer/rotationGizmoState';
import { formatPeilLabel, calculatePeilFromY } from '../drawing/useLevelDrawing';
import { regenerateGridDimensions, updateLinkedDimensions } from '../../utils/gridDimensionUtils';
import { recalculateMiterJoins } from '../../engine/geometry/Modify';
import { gripProviderRegistry } from '../../engine/registry/GripProviderRegistry';
import { findLinkedLabels, computeLinkedLabelPosition } from '../../engine/geometry/LabelUtils';
import { regeneratePlateSystemBeams } from '../drawing/usePlateSystemDrawing';
import { formatSectionPeilLabel } from '../../services/section/sectionReferenceService';

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
  /** Offset between the click position and the grip center (prevents jumping). */
  clickOffset?: Point;
  /** Angle of the local axis system (for line/beam midpoint perpendicular constraint). */
  axisAngle?: number;
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

/** Info about a gridline endpoint that is joined with the dragged endpoint. */
interface JoinedGridlineInfo {
  shapeId: string;
  gripIndex: 0 | 1;
  originalShape: GridlineShape;
  /** If true, this is a parallel gridline whose endpoint should align, not a perpendicular join. */
  isParallel?: boolean;
}

/**
 * Find other gridline endpoints that lie on the same perpendicular line
 * as the dragged endpoint (i.e. they should move together).
 * Also detects parallel gridlines whose corresponding endpoints should align.
 */
function findJoinedGridlineEndpoints(
  draggedShape: GridlineShape,
  draggedGripIndex: 0 | 1,
  allShapes: Shape[],
  tolerance: number
): JoinedGridlineInfo[] {
  const draggedEndpoint = draggedGripIndex === 0 ? draggedShape.start : draggedShape.end;
  const dir = {
    x: draggedShape.end.x - draggedShape.start.x,
    y: draggedShape.end.y - draggedShape.start.y,
  };
  const len = Math.sqrt(dir.x * dir.x + dir.y * dir.y);
  if (len === 0) return [];
  const unitDir = { x: dir.x / len, y: dir.y / len };

  const result: JoinedGridlineInfo[] = [];
  const joinedIds = new Set<string>();
  const gridlines = allShapes.filter(
    s => s.type === 'gridline' && s.id !== draggedShape.id && s.drawingId === draggedShape.drawingId
  ) as GridlineShape[];

  for (const gl of gridlines) {
    // Check start endpoint (perpendicular join)
    const startDiff = { x: gl.start.x - draggedEndpoint.x, y: gl.start.y - draggedEndpoint.y };
    const startProj = Math.abs(startDiff.x * unitDir.x + startDiff.y * unitDir.y);
    if (startProj < tolerance) {
      result.push({ shapeId: gl.id, gripIndex: 0, originalShape: JSON.parse(JSON.stringify(gl)) });
      joinedIds.add(gl.id);
      continue;
    }
    // Check end endpoint (perpendicular join)
    const endDiff = { x: gl.end.x - draggedEndpoint.x, y: gl.end.y - draggedEndpoint.y };
    const endProj = Math.abs(endDiff.x * unitDir.x + endDiff.y * unitDir.y);
    if (endProj < tolerance) {
      result.push({ shapeId: gl.id, gripIndex: 1, originalShape: JSON.parse(JSON.stringify(gl)) });
      joinedIds.add(gl.id);
    }
  }

  // Parallel gridline detection: find gridlines with the same direction
  // and align their corresponding endpoints (start↔start, end↔end)
  const ANGLE_TOLERANCE = 0.087; // ~5°
  const dragAngle = Math.atan2(dir.y, dir.x);

  for (const gl of gridlines) {
    if (joinedIds.has(gl.id)) continue; // already joined perpendicularly
    const glDir = { x: gl.end.x - gl.start.x, y: gl.end.y - gl.start.y };
    const glLen = Math.sqrt(glDir.x * glDir.x + glDir.y * glDir.y);
    if (glLen === 0) continue;
    const glAngle = Math.atan2(glDir.y, glDir.x);
    // Check parallel (same or opposite direction)
    let angleDiff = Math.abs(dragAngle - glAngle) % Math.PI;
    if (angleDiff > Math.PI / 2) angleDiff = Math.PI - angleDiff;
    if (angleDiff < ANGLE_TOLERANCE) {
      // Determine if directions are same or opposite
      const dot = unitDir.x * (glDir.x / glLen) + unitDir.y * (glDir.y / glLen);
      const sameDirection = dot > 0;
      // Map grip index: same direction → same grip, opposite → swap
      const mappedGrip = sameDirection ? draggedGripIndex : (draggedGripIndex === 0 ? 1 : 0);
      result.push({
        shapeId: gl.id,
        gripIndex: mappedGrip as 0 | 1,
        originalShape: JSON.parse(JSON.stringify(gl)),
        isParallel: true,
      });
    }
  }

  return result;
}

/** Info about a wall endpoint that is joined with the dragged endpoint. */
interface JoinedWallInfo {
  shapeId: string;
  gripIndex: 0 | 1;  // 0 = start, 1 = end
  originalShape: WallShape;
}

/**
 * Find other wall endpoints that share the same position as the dragged endpoint
 * (within tolerance). Only direct connections — no chain following.
 */
function findJoinedWallEndpoints(
  draggedShape: WallShape,
  draggedGripIndex: 0 | 1,
  allShapes: Shape[],
  tolerance: number
): JoinedWallInfo[] {
  const draggedEndpoint = draggedGripIndex === 0 ? draggedShape.start : draggedShape.end;
  const result: JoinedWallInfo[] = [];

  const walls = allShapes.filter(
    s => s.type === 'wall' && s.id !== draggedShape.id && s.drawingId === draggedShape.drawingId && s.visible
  ) as WallShape[];

  const tolSq = tolerance * tolerance;

  for (const wall of walls) {
    // Check start endpoint
    const sdx = wall.start.x - draggedEndpoint.x;
    const sdy = wall.start.y - draggedEndpoint.y;
    if (sdx * sdx + sdy * sdy <= tolSq) {
      result.push({ shapeId: wall.id, gripIndex: 0, originalShape: JSON.parse(JSON.stringify(wall)) });
      continue;
    }
    // Check end endpoint
    const edx = wall.end.x - draggedEndpoint.x;
    const edy = wall.end.y - draggedEndpoint.y;
    if (edx * edx + edy * edy <= tolSq) {
      result.push({ shapeId: wall.id, gripIndex: 1, originalShape: JSON.parse(JSON.stringify(wall)) });
    }
  }

  return result;
}

/** Info about a section level that should move together with the dragged level. */
interface JoinedSectionLevelInfo {
  shapeId: string;
  originalShape: LevelShape;
}

/**
 * Find all other section-ref level shapes in the same drawing that should move
 * together with the dragged level when dragging endpoints horizontally.
 * This ensures the whole series of levels share the same horizontal position.
 */
function findJoinedSectionLevels(
  draggedShape: LevelShape,
  allShapes: Shape[],
): JoinedSectionLevelInfo[] {
  // Only group section-ref levels (auto-generated from IfcBuildingStoreys)
  if (!draggedShape.id.startsWith('section-ref-lv-')) return [];

  return allShapes
    .filter((s): s is LevelShape =>
      s.type === 'level' &&
      s.id !== draggedShape.id &&
      s.drawingId === draggedShape.drawingId &&
      s.id.startsWith('section-ref-lv-')
    )
    .map(lv => ({
      shapeId: lv.id,
      originalShape: JSON.parse(JSON.stringify(lv)),
    }));
}

/** Length of axis arrows in screen pixels (must match ShapeRenderer). */
const AXIS_ARROW_SCREEN_LEN = 20;

/**
 * Check if a world-space point is near an axis arrow extending from a grip point.
 * When angle is provided, axes are rotated (for line/beam midpoint grips).
 * Returns 'x', 'y', or null.
 */
function hitTestAxisArrow(worldPos: Point, gripPoint: Point, zoom: number, angle: number = 0): 'x' | 'y' | null {
  const arrowLen = AXIS_ARROW_SCREEN_LEN / zoom;
  const tolerance = 5 / zoom;

  // Transform worldPos into the local coordinate system of the grip
  const dx = worldPos.x - gripPoint.x;
  const dy = worldPos.y - gripPoint.y;
  const cosA = Math.cos(-angle);
  const sinA = Math.sin(-angle);
  const localX = dx * cosA - dy * sinA;
  const localY = dx * sinA + dy * cosA;

  // X-axis arrow (along direction, in local coords: points right)
  if (
    Math.abs(localY) <= tolerance &&
    localX >= -tolerance &&
    localX <= arrowLen + tolerance
  ) {
    if (localX > tolerance * 0.5) return 'x';
  }

  // Y-axis arrow (perpendicular direction, in local coords: points up / negative Y)
  const perpAngle = angle - Math.PI / 2;
  const cosP = Math.cos(-perpAngle);
  const sinP = Math.sin(-perpAngle);
  const perpLocalX = dx * cosP - dy * sinP;
  const perpLocalY = dx * sinP + dy * cosP;

  if (
    Math.abs(perpLocalY) <= tolerance &&
    perpLocalX >= -tolerance &&
    perpLocalX <= arrowLen + tolerance
  ) {
    if (perpLocalX > tolerance * 0.5) return 'y';
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
    case 'image': {
      // Image handles: 4 corners + 4 midpoints + center (like rectangle)
      const imgTl = shape.position;
      const imgW = shape.width;
      const imgH = shape.height;
      const imgRot = shape.rotation || 0;
      const imgCos = Math.cos(imgRot);
      const imgSin = Math.sin(imgRot);
      const imgToWorld = (lx: number, ly: number) => ({
        x: imgTl.x + lx * imgCos - ly * imgSin,
        y: imgTl.y + lx * imgSin + ly * imgCos,
      });
      return [
        imgToWorld(0, 0),
        imgToWorld(imgW, 0),
        imgToWorld(imgW, imgH),
        imgToWorld(0, imgH),
        imgToWorld(imgW / 2, 0),
        imgToWorld(imgW, imgH / 2),
        imgToWorld(imgW / 2, imgH),
        imgToWorld(0, imgH / 2),
        imgToWorld(imgW / 2, imgH / 2),
      ];
    }
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
      let grips: Point[];
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
        grips = localGrips.map(rotatePoint);
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
        grips = localGrips.map(rotatePoint);
      }
      // Grip 4+: Leader waypoints
      if (textShape.leaderPoints && textShape.leaderPoints.length > 0) {
        for (const pt of textShape.leaderPoints) {
          grips.push(pt);
        }
      }
      // Then leaders[] waypoints
      if (textShape.leaders) {
        for (const leader of textShape.leaders) {
          for (const pt of leader.points) {
            grips.push(pt);
          }
        }
      }
      return grips;
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
    default: {
      const extGrip = gripProviderRegistry.get(shape.type);
      return extGrip ? extGrip.getGripPoints(shape) : [];
    }
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
 * Get a reference point for a shape (used as the anchor for body-drag offset).
 */
function getShapeReferencePoint(shape: Shape): Point {
  switch (shape.type) {
    case 'line': return shape.start;
    case 'rectangle': return shape.topLeft;
    case 'circle': return shape.center;
    case 'arc': return shape.center;
    case 'ellipse': return shape.center;
    case 'polyline':
    case 'spline':
    case 'hatch':
      return shape.points[0] || { x: 0, y: 0 };
    case 'text': return shape.position;
    case 'point': return shape.position;
    case 'image': return shape.position;
    case 'dimension': return (shape as DimensionShape).points[0] || { x: 0, y: 0 };
    default: {
      const extGrip = gripProviderRegistry.get(shape.type);
      return extGrip ? extGrip.getReferencePoint(shape) : { x: 0, y: 0 };
    }
  }
}

/**
 * Compute updates to move an entire shape by translating its reference point to newPos.
 * newPos = the desired new position of the shape's reference point.
 */
function computeBodyMoveUpdates(shape: Shape, newPos: Point): Partial<Shape> | null {
  const ref = getShapeReferencePoint(shape);
  const dx = newPos.x - ref.x;
  const dy = newPos.y - ref.y;

  switch (shape.type) {
    case 'line':
      return {
        start: { x: shape.start.x + dx, y: shape.start.y + dy },
        end: { x: shape.end.x + dx, y: shape.end.y + dy },
      } as Partial<Shape>;

    case 'rectangle':
      return {
        topLeft: { x: shape.topLeft.x + dx, y: shape.topLeft.y + dy },
      } as Partial<Shape>;

    case 'circle':
      return { center: { x: shape.center.x + dx, y: shape.center.y + dy } } as Partial<Shape>;

    case 'arc':
      return { center: { x: shape.center.x + dx, y: shape.center.y + dy } } as Partial<Shape>;

    case 'ellipse':
      return { center: { x: shape.center.x + dx, y: shape.center.y + dy } } as Partial<Shape>;

    case 'polyline':
    case 'spline':
    case 'hatch':
      return {
        points: shape.points.map(p => ({ x: p.x + dx, y: p.y + dy })),
      } as Partial<Shape>;

    case 'text':
      return {
        position: { x: shape.position.x + dx, y: shape.position.y + dy },
        leaderPoints: shape.leaderPoints?.map(p => ({ x: p.x + dx, y: p.y + dy })),
      } as Partial<Shape>;

    case 'point':
      return { position: { x: shape.position.x + dx, y: shape.position.y + dy } } as Partial<Shape>;

    case 'image':
      return {
        position: { x: shape.position.x + dx, y: shape.position.y + dy },
      } as Partial<Shape>;

    case 'dimension': {
      const dim = shape as DimensionShape;
      return {
        points: dim.points.map(p => ({ x: p.x + dx, y: p.y + dy })),
      } as Partial<Shape>;
    }

    default: {
      const extGrip = gripProviderRegistry.get(shape.type);
      return extGrip ? extGrip.computeBodyMove(shape, newPos) as Partial<Shape> | null : null;
    }
  }
}

/**
 * Compute shape updates for rotating a shape around a center point by a given angle.
 * Works on the ORIGINAL shape geometry so it can be called repeatedly during drag.
 */
function computeRotationUpdates(shape: Shape, center: Point, angleRad: number): Partial<Shape> | null {
  if (angleRad === 0) return null;

  const cos = Math.cos(angleRad);
  const sin = Math.sin(angleRad);
  const rotPt = (p: Point): Point => ({
    x: center.x + (p.x - center.x) * cos - (p.y - center.y) * sin,
    y: center.y + (p.x - center.x) * sin + (p.y - center.y) * cos,
  });

  switch (shape.type) {
    case 'line':
      return { start: rotPt(shape.start), end: rotPt(shape.end) } as Partial<Shape>;
    case 'beam':
      return { start: rotPt(shape.start), end: rotPt(shape.end) } as Partial<Shape>;
    case 'gridline': {
      const gl = shape as GridlineShape;
      return { start: rotPt(gl.start), end: rotPt(gl.end) } as Partial<Shape>;
    }
    case 'level': {
      const lv = shape as LevelShape;
      const newLvStart = rotPt(lv.start);
      const newLvEnd = rotPt(lv.end);
      const rotPeil = calculatePeilFromY(newLvStart.y);
      return {
        start: newLvStart,
        end: newLvEnd,
        peil: rotPeil,
        elevation: rotPeil,
        label: formatPeilLabel(rotPeil),
      } as Partial<Shape>;
    }
    case 'wall': {
      const wa = shape as WallShape;
      return { start: rotPt(wa.start), end: rotPt(wa.end) } as Partial<Shape>;
    }
    case 'section-callout': {
      const sc = shape as SectionCalloutShape;
      return { start: rotPt(sc.start), end: rotPt(sc.end) } as Partial<Shape>;
    }
    case 'slab':
      return { points: shape.points.map(rotPt) } as Partial<Shape>;
    case 'puntniveau':
      return { points: (shape as PuntniveauShape).points.map(rotPt) } as Partial<Shape>;
    case 'plate-system':
      return { contourPoints: (shape as PlateSystemShape).contourPoints.map(rotPt) } as Partial<Shape>;
    case 'polyline':
    case 'spline':
    case 'hatch':
      return { points: shape.points.map(rotPt) } as Partial<Shape>;
    case 'rectangle': {
      // Rotate topLeft; width/height stay the same (visual distortion, but preserves type)
      return { topLeft: rotPt(shape.topLeft) } as Partial<Shape>;
    }
    case 'circle':
      return { center: rotPt(shape.center) } as Partial<Shape>;
    case 'ellipse':
      return {
        center: rotPt(shape.center),
        rotation: (shape.rotation || 0) + angleRad,
      } as Partial<Shape>;
    case 'arc':
      return {
        center: rotPt(shape.center),
        startAngle: shape.startAngle + angleRad,
        endAngle: shape.endAngle + angleRad,
      } as Partial<Shape>;
    case 'image':
      return {
        position: rotPt(shape.position),
        rotation: (shape.rotation || 0) + angleRad,
      } as Partial<Shape>;
    case 'pile': {
      const pl = shape as PileShape;
      return { position: rotPt(pl.position) } as Partial<Shape>;
    }
    case 'cpt': {
      const cp = shape as any;
      return { position: rotPt(cp.position) } as Partial<Shape>;
    }
    case 'foundation-zone': {
      const fz = shape as any;
      return { contourPoints: fz.contourPoints.map((p: any) => rotPt(p)) } as Partial<Shape>;
    }
    case 'dimension': {
      const dim = shape as DimensionShape;
      return { points: dim.points.map(rotPt) } as Partial<Shape>;
    }
    default:
      return null;
  }
}

/**
 * edgeMidpointIndices: if set, the two polyline point indices to move together (for rect edge midpoints).
 */
function computeGripUpdates(shape: Shape, gripIndex: number, newPos: Point, edgeMidpointIndices?: [number, number], scaleMode?: boolean): Partial<Shape> | null {
  // Body drag (gripIndex -1): move entire shape by delta from clickOffset
  // newPos here is the current world mouse position; clickOffset stored the original click position
  // The caller passes (currentShape, -1, constrainedPos) — we compute delta from the original shape
  if (gripIndex === -1) {
    return computeBodyMoveUpdates(shape, newPos);
  }

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
        const [i1, i2] = edgeMidpointIndices;
        const origMid = {
          x: (shape.points[i1].x + shape.points[i2].x) / 2,
          y: (shape.points[i1].y + shape.points[i2].y) / 2,
        };

        if (scaleMode) {
          // Proportional scale: scale only the two edge vertices relative to the
          // anchor (centroid of all OTHER vertices). Non-edge vertices stay fixed,
          // so adjacent edges stretch from the moving end only.
          const otherPoints = shape.points.filter((_, i) => i !== i1 && i !== i2);
          if (otherPoints.length === 0) return null;
          const anchor = {
            x: otherPoints.reduce((s, p) => s + p.x, 0) / otherPoints.length,
            y: otherPoints.reduce((s, p) => s + p.y, 0) / otherPoints.length,
          };
          const origDist = Math.sqrt(
            (origMid.x - anchor.x) ** 2 + (origMid.y - anchor.y) ** 2
          );
          if (origDist < 1e-10) return null;
          const newDist = Math.sqrt(
            (newPos.x - anchor.x) ** 2 + (newPos.y - anchor.y) ** 2
          );
          const scale = newDist / origDist;
          const newPoints = shape.points.map((p, i) =>
            (i === i1 || i === i2)
              ? { x: anchor.x + (p.x - anchor.x) * scale, y: anchor.y + (p.y - anchor.y) * scale }
              : p
          );
          return { points: newPoints } as Partial<Shape>;
        }

        // Edge midpoint: move two adjacent points by the same delta (stretch)
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

        if (scaleMode) {
          // Proportional scale: scale only the two edge vertices relative to the
          // anchor (centroid of all OTHER vertices). Non-edge vertices stay fixed,
          // so adjacent edges stretch from the moving end only.
          const otherPoints = shape.points.filter((_, i) => i !== i1 && i !== i2);
          if (otherPoints.length === 0) return null;
          const anchor = {
            x: otherPoints.reduce((s, p) => s + p.x, 0) / otherPoints.length,
            y: otherPoints.reduce((s, p) => s + p.y, 0) / otherPoints.length,
          };
          const origDist = Math.sqrt(
            (origMid.x - anchor.x) ** 2 + (origMid.y - anchor.y) ** 2
          );
          if (origDist < 1e-10) return null;
          const newDist = Math.sqrt(
            (newPos.x - anchor.x) ** 2 + (newPos.y - anchor.y) ** 2
          );
          const scale = newDist / origDist;
          const newPoints = shape.points.map((p, i) =>
            (i === i1 || i === i2)
              ? { x: anchor.x + (p.x - anchor.x) * scale, y: anchor.y + (p.y - anchor.y) * scale }
              : p
          );
          return { points: newPoints } as Partial<Shape>;
        }

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

    case 'image': {
      const imgShape = shape as ImageShape;
      if (gripIndex === 8) {
        // Center grip — move the image (account for rotation)
        const rot = imgShape.rotation || 0;
        const cosR = Math.cos(rot);
        const sinR = Math.sin(rot);
        const cx = imgShape.position.x + (imgShape.width / 2) * cosR - (imgShape.height / 2) * sinR;
        const cy = imgShape.position.y + (imgShape.width / 2) * sinR + (imgShape.height / 2) * cosR;
        const dx = newPos.x - cx;
        const dy = newPos.y - cy;
        return { position: { x: imgShape.position.x + dx, y: imgShape.position.y + dy } } as Partial<Shape>;
      }

      // Corner grips (0-3): TL, TR, BR, BL
      // Midpoint grips (4-7): top, right, bottom, left
      // Transform newPos into local (unrotated) space relative to image origin
      const imgRot = imgShape.rotation || 0;
      let localX: number, localY: number;
      if (imgRot !== 0) {
        const cos = Math.cos(-imgRot);
        const sin = Math.sin(-imgRot);
        const dx = newPos.x - imgShape.position.x;
        const dy = newPos.y - imgShape.position.y;
        localX = dx * cos - dy * sin;
        localY = dx * sin + dy * cos;
      } else {
        localX = newPos.x - imgShape.position.x;
        localY = newPos.y - imgShape.position.y;
      }

      // Current bounds in local space: (0,0) to (width, height)
      let newLocalLeft = 0, newLocalTop = 0;
      let newLocalRight = imgShape.width, newLocalBottom = imgShape.height;

      switch (gripIndex) {
        case 0: newLocalLeft = localX; newLocalTop = localY; break;     // TL
        case 1: newLocalRight = localX; newLocalTop = localY; break;    // TR
        case 2: newLocalRight = localX; newLocalBottom = localY; break;  // BR
        case 3: newLocalLeft = localX; newLocalBottom = localY; break;   // BL
        case 4: newLocalTop = localY; break;     // top mid
        case 5: newLocalRight = localX; break;   // right mid
        case 6: newLocalBottom = localY; break;  // bottom mid
        case 7: newLocalLeft = localX; break;    // left mid
        default: return null;
      }

      // Maintain aspect ratio for corner grips if enabled
      if (imgShape.maintainAspectRatio && gripIndex <= 3) {
        const aspectRatio = imgShape.width / imgShape.height;
        const newW = Math.abs(newLocalRight - newLocalLeft);
        const newH = Math.abs(newLocalBottom - newLocalTop);
        if (newW / newH > aspectRatio) {
          // Width is too wide — adjust width to match height
          const adjustedW = newH * aspectRatio;
          if (gripIndex === 0 || gripIndex === 3) {
            newLocalLeft = newLocalRight - (newLocalRight > newLocalLeft ? adjustedW : -adjustedW);
          } else {
            newLocalRight = newLocalLeft + (newLocalRight > newLocalLeft ? adjustedW : -adjustedW);
          }
        } else {
          // Height is too tall — adjust height to match width
          const adjustedH = newW / aspectRatio;
          if (gripIndex === 0 || gripIndex === 1) {
            newLocalTop = newLocalBottom - (newLocalBottom > newLocalTop ? adjustedH : -adjustedH);
          } else {
            newLocalBottom = newLocalTop + (newLocalBottom > newLocalTop ? adjustedH : -adjustedH);
          }
        }
      }

      // Normalize so width/height are positive
      const finalLocalLeft = Math.min(newLocalLeft, newLocalRight);
      const finalLocalTop = Math.min(newLocalTop, newLocalBottom);
      const newWidth = Math.abs(newLocalRight - newLocalLeft);
      const newHeight = Math.abs(newLocalBottom - newLocalTop);

      // Transform the new local top-left back to world space
      let newPosX: number, newPosY: number;
      if (imgRot !== 0) {
        const cos = Math.cos(imgRot);
        const sin = Math.sin(imgRot);
        newPosX = imgShape.position.x + finalLocalLeft * cos - finalLocalTop * sin;
        newPosY = imgShape.position.y + finalLocalLeft * sin + finalLocalTop * cos;
      } else {
        newPosX = imgShape.position.x + finalLocalLeft;
        newPosY = imgShape.position.y + finalLocalTop;
      }

      return {
        position: { x: newPosX, y: newPosY },
        width: Math.max(1, newWidth),
        height: Math.max(1, newHeight),
      } as Partial<Shape>;
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

      // Grip 4+: Leader waypoints
      if (gripIndex >= 4) {
        const textShape = shape as TextShape;
        let waypointIdx = gripIndex - 4;

        // First check leaderPoints
        if (textShape.leaderPoints && waypointIdx < textShape.leaderPoints.length) {
          const updatedPoints = [...textShape.leaderPoints];
          updatedPoints[waypointIdx] = { x: newPos.x, y: newPos.y };
          return { leaderPoints: updatedPoints } as Partial<Shape>;
        }

        // Adjust index past leaderPoints
        if (textShape.leaderPoints) {
          waypointIdx -= textShape.leaderPoints.length;
        }

        // Then check leaders[]
        if (textShape.leaders) {
          const updatedLeaders = textShape.leaders.map(l => ({
            points: [...l.points],
          }));
          for (let li = 0; li < updatedLeaders.length; li++) {
            if (waypointIdx < updatedLeaders[li].points.length) {
              updatedLeaders[li].points[waypointIdx] = { x: newPos.x, y: newPos.y };
              return { leaders: updatedLeaders } as Partial<Shape>;
            }
            waypointIdx -= updatedLeaders[li].points.length;
          }
        }
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
          // Witness line grips - move the corresponding measurement point.
          // Grip 2 corresponds to points[0], grip 3 corresponds to points[1].
          // The witness line grip sits on the dimension line; we project the
          // drag position back perpendicular to get the new measurement point.
          const pointIndex = gripIndex - 2;
          const newPoints = [...dim.points];

          if (dim.linearDirection === 'horizontal') {
            // Horizontal: dimension line is horizontal, witness lines are vertical.
            // Moving grip along X moves measurement point's X; Y stays the same.
            newPoints[pointIndex] = { x: newPos.x, y: dim.points[pointIndex].y };
          } else if (dim.linearDirection === 'vertical') {
            // Vertical: dimension line is vertical, witness lines are horizontal.
            // Moving grip along Y moves measurement point's Y; X stays the same.
            newPoints[pointIndex] = { x: dim.points[pointIndex].x, y: newPos.y };
          } else {
            // Aligned: dimension line is parallel to p1->p2.
            // Project newPos onto the dimension line direction to get the
            // displacement along the line, then shift the measurement point.
            const lineAngle = angleBetweenPoints(dim.points[0], dim.points[1]);
            const dimDir = { x: Math.cos(lineAngle), y: Math.sin(lineAngle) };
            // Current grip position on dimension line
            const currentGrip = pointIndex === 0 ? geometry.start : geometry.end;
            const delta = {
              x: newPos.x - currentGrip.x,
              y: newPos.y - currentGrip.y,
            };
            // Only move along the dimension line direction
            const alongDist = delta.x * dimDir.x + delta.y * dimDir.y;
            newPoints[pointIndex] = {
              x: dim.points[pointIndex].x + alongDist * dimDir.x,
              y: dim.points[pointIndex].y + alongDist * dimDir.y,
            };
          }

          // Recalculate dimension value (unless user has overridden it)
          if (!dim.valueOverridden) {
            const newValue = calculateDimensionValue(newPoints, dim.dimensionType, dim.linearDirection);
            const formattedValue = formatDimensionValue(newValue, dim.dimensionType, dim.dimensionStyle.precision, useAppStore.getState().unitSettings);
            return { points: newPoints, value: formattedValue } as Partial<Shape>;
          }

          return { points: newPoints } as Partial<Shape>;
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
              const formattedValue = formatDimensionValue(newValue, dim.dimensionType, dim.dimensionStyle.precision, useAppStore.getState().unitSettings);
              return { points: newPoints, value: formattedValue } as Partial<Shape>;
            }

            return { points: newPoints } as Partial<Shape>;
          }
        }
      }

      return null;
    }

    default: {
      const extGrip = gripProviderRegistry.get(shape.type);
      return extGrip ? extGrip.computeGripUpdate(shape, gripIndex, newPos) as Partial<Shape> | null : null;
    }
  }
}

export function useGripEditing() {
  const {
    viewport,
    shapes,
    parametricShapes,
    selectedShapeIds,
    updateShape,
    updateShapes,
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
    showRotationGizmo,
  } = useAppStore();

  const dragRef = useRef<GripDragState | null>(null);
  const parametricDragRef = useRef<ParametricGripDragState | null>(null);
  const justFinishedDragRef = useRef(false);
  const joinedGridlinesRef = useRef<JoinedGridlineInfo[]>([]);
  const joinedWallsRef = useRef<JoinedWallInfo[]>([]);
  const joinedSectionLevelsRef = useRef<JoinedSectionLevelInfo[]>([]);

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

      // Check rotation gizmo handle and ring (takes priority — skip pile/cpt, no rotation)
      if (showRotationGizmo && shape.type !== 'text' && shape.type !== 'pile' && shape.type !== 'cpt') {
        // Calculate centroid and ring radius — must match the renderer
        let cx = 0, cy = 0;
        for (const pt of grips) { cx += pt.x; cy += pt.y; }
        cx /= grips.length;
        cy /= grips.length;

        // Fixed world-space ring radius: 50mm (must match renderer)
        const ringRadius = 50;

        // Hit test the handle at top of ring
        const handleX = cx;
        const handleY = cy - ringRadius; // Top position (handleAngle = -PI/2)
        const gDx = worldPos.x - handleX;
        const gDy = worldPos.y - handleY;
        const handleHitRadius = 8 / viewport.zoom;

        // Also allow clicking anywhere on the ring itself (within a tolerance band)
        const distFromCenter = Math.sqrt((worldPos.x - cx) * (worldPos.x - cx) + (worldPos.y - cy) * (worldPos.y - cy));
        const ringTolerance = 5 / viewport.zoom;
        const onRing = Math.abs(distFromCenter - ringRadius) <= ringTolerance;

        if (Math.sqrt(gDx * gDx + gDy * gDy) <= handleHitRadius || onRing) {
          setCurrentSnapPoint(null);
          const rotCenter = { x: cx, y: cy };
          const initAngle = Math.atan2(worldPos.x - rotCenter.x, -(worldPos.y - rotCenter.y));
          dragRef.current = {
            shapeId,
            gripIndex: -2, // Special index: rotation gizmo
            originalShape: JSON.parse(JSON.stringify(shape)),
            convertedToPolyline: false,
            originalRectGripIndex: -2,
            axisConstraint: null,
            initialRotationAngle: initAngle,
            rotationCenter: rotCenter,
          };
          return true;
        }
      }

      // First pass: check axis arrows on all grips (arrows take priority)
      // Skip arc midpoint (grip 3) — its circumcenter algorithm can't handle axis constraint
      // Skip text resize handles (grips 1, 2) for Y-axis — they only support X-axis (width) resize
      // Skip text rotation handle (grip 3) — it's a rotation control, no axis constraint
      for (let i = 0; i < grips.length; i++) {
        if (shape.type === 'arc' && i === 3) continue;
        if (shape.type === 'text' && i === 3) continue; // Rotation handle - no axis arrows
        // For line/beam midpoint (index 2), use rotated axes
        let gripAxisAngle = 0;
        if (i === 2 && (shape.type === 'line' || shape.type === 'beam' || shape.type === 'gridline' || shape.type === 'wall')) {
          gripAxisAngle = Math.atan2(shape.end.y - shape.start.y, shape.end.x - shape.start.x);
        }
        const axisHit = hitTestAxisArrow(worldPos, grips[i], viewport.zoom, gripAxisAngle);
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
            clickOffset: { x: worldPos.x - grips[i].x, y: worldPos.y - grips[i].y },
            axisAngle: gripAxisAngle || undefined,
            enableSnapping: (shape.type === 'dimension' && i >= 2) || shape.type === 'plate-system' || shape.type === 'slab',
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

            // Enable snapping for dimension measurement point handles (gripIndex >= 2, skipping text and offset grips)
            // and for all plate-system and slab grips (vertex and edge midpoint)
            const enableSnapping = (shape.type === 'dimension' && i >= 2) || shape.type === 'plate-system' || shape.type === 'slab';

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
              originalGripPoint: { ...grips[i] },
              enableSnapping,
              initialRotationAngle,
              rotationCenter,
            };
          }
          return true;
        }
      }

      // Third pass: check if click is on the shape body (for drag-to-move)
      if (isPointNearShape(worldPos, shape, tolerance, drawingScale)) {
        setCurrentSnapPoint(null);
        // Use shape's reference point (first meaningful position) as anchor
        const refPoint = getShapeReferencePoint(shape);
        dragRef.current = {
          shapeId,
          gripIndex: -1, // Special index: body drag (move entire shape)
          originalShape: JSON.parse(JSON.stringify(shape)),
          convertedToPolyline: false,
          originalRectGripIndex: -1,
          axisConstraint: null,
          originalGripPoint: { ...refPoint },
          enableSnapping: true, // Enable snapping during body drag so shapes snap to gridline endpoints etc.
          // clickOffset = mouse - refPoint, so adjustedPos = mouse - clickOffset = refPoint's new position
          clickOffset: { x: worldPos.x - refPoint.x, y: worldPos.y - refPoint.y },
        };
        return true;
      }

      return false;
    },
    [selectedShapeIds, shapes, parametricShapes, viewport.zoom, setCurrentSnapPoint, drawingScale, showRotationGizmo]
  );

  const handleGripMouseMove = useCallback(
    (worldPos: Point, shiftKey?: boolean): boolean => {
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

      // Lazily detect joined gridline endpoints on first move
      if (currentShape.type === 'gridline' && (drag.gripIndex === 0 || drag.gripIndex === 1) && joinedGridlinesRef.current.length === 0) {
        const allShapes = useAppStore.getState().shapes;
        const joined = findJoinedGridlineEndpoints(
          currentShape as GridlineShape, drag.gripIndex as 0 | 1, allShapes, 1
        );
        if (joined.length > 0) {
          joinedGridlinesRef.current = joined;
        }
      }

      // Lazily detect joined wall endpoints on first move (walls sharing an endpoint)
      if (currentShape.type === 'wall' && (drag.gripIndex === 0 || drag.gripIndex === 1 || drag.gripIndex === 2) && joinedWallsRef.current.length === 0) {
        const allShapes = useAppStore.getState().shapes;
        if (drag.gripIndex === 2) {
          // Midpoint drag: find connections at both endpoints
          const joinedStart = findJoinedWallEndpoints(currentShape as WallShape, 0, allShapes, 1);
          const joinedEnd = findJoinedWallEndpoints(currentShape as WallShape, 1, allShapes, 1);
          const combined = [...joinedStart, ...joinedEnd];
          if (combined.length > 0) {
            joinedWallsRef.current = combined;
          }
        } else {
          const joined = findJoinedWallEndpoints(
            currentShape as WallShape, drag.gripIndex as 0 | 1, allShapes, 1
          );
          if (joined.length > 0) {
            joinedWallsRef.current = joined;
          }
        }
      }

      // Lazily detect joined section levels on first move (endpoint drags move all levels horizontally)
      if (currentShape.type === 'level' && (drag.gripIndex === 0 || drag.gripIndex === 1) && joinedSectionLevelsRef.current.length === 0) {
        const allShapes = useAppStore.getState().shapes;
        const joined = findJoinedSectionLevels(currentShape as LevelShape, allShapes);
        if (joined.length > 0) {
          joinedSectionLevelsRef.current = joined;
        }
      }

      // Apply click offset (prevent grip from jumping to mouse position when clicking on arrow)
      const adjustedPos = drag.clickOffset
        ? { x: worldPos.x - drag.clickOffset.x, y: worldPos.y - drag.clickOffset.y }
        : worldPos;

      // Apply axis constraint
      let constrainedPos = adjustedPos;
      if (drag.axisConstraint && drag.originalGripPoint) {
        if (drag.axisAngle) {
          // Rotated axis constraint (for line/beam midpoint)
          const dx = adjustedPos.x - drag.originalGripPoint.x;
          const dy = adjustedPos.y - drag.originalGripPoint.y;
          if (drag.axisConstraint === 'x') {
            // Constrain along the line direction
            const cosA = Math.cos(drag.axisAngle);
            const sinA = Math.sin(drag.axisAngle);
            const proj = dx * cosA + dy * sinA;
            constrainedPos = {
              x: drag.originalGripPoint.x + proj * cosA,
              y: drag.originalGripPoint.y + proj * sinA,
            };
          } else {
            // Constrain perpendicular to the line direction
            const perpAngle = drag.axisAngle - Math.PI / 2;
            const cosP = Math.cos(perpAngle);
            const sinP = Math.sin(perpAngle);
            const proj = dx * cosP + dy * sinP;
            constrainedPos = {
              x: drag.originalGripPoint.x + proj * cosP,
              y: drag.originalGripPoint.y + proj * sinP,
            };
          }
        } else {
          // Global axis constraint
          constrainedPos = { ...adjustedPos };
          if (drag.axisConstraint === 'x') constrainedPos.y = drag.originalGripPoint.y;
          if (drag.axisConstraint === 'y') constrainedPos.x = drag.originalGripPoint.x;
        }
      }

      // Ortho: snap endpoint to angle increments (90° for wall/beam, 45° for line/gridline)
      if (orthoMode && !drag.axisConstraint &&
          (currentShape.type === 'line' || currentShape.type === 'beam' || currentShape.type === 'gridline' || currentShape.type === 'wall') &&
          (drag.gripIndex === 0 || drag.gripIndex === 1)) {
        const opposite = drag.gripIndex === 0
          ? (currentShape as LineShape | BeamShape | GridlineShape | WallShape).end
          : (currentShape as LineShape | BeamShape | GridlineShape | WallShape).start;
        if (currentShape.type === 'wall' || currentShape.type === 'beam') {
          const sdx = constrainedPos.x - opposite.x;
          const sdy = constrainedPos.y - opposite.y;
          if (Math.abs(sdx) >= Math.abs(sdy)) {
            constrainedPos = { x: constrainedPos.x, y: opposite.y };
          } else {
            constrainedPos = { x: opposite.x, y: constrainedPos.y };
          }
        } else {
          constrainedPos = snapToAngle(opposite, constrainedPos);
        }
      }

      // Ortho: constrain section-callout grip movement to horizontal or vertical
      if (orthoMode && !drag.axisConstraint && currentShape.type === 'section-callout' && drag.originalGripPoint) {
        const scShape = currentShape as SectionCalloutShape;
        if (drag.gripIndex === 0 || drag.gripIndex === 1) {
          // Endpoint drag: constrain relative to the opposite endpoint
          const opposite = drag.gripIndex === 0 ? scShape.end : scShape.start;
          const sdx = constrainedPos.x - opposite.x;
          const sdy = constrainedPos.y - opposite.y;
          if (Math.abs(sdx) >= Math.abs(sdy)) {
            constrainedPos = { x: constrainedPos.x, y: opposite.y };
          } else {
            constrainedPos = { x: opposite.x, y: constrainedPos.y };
          }
        } else if (drag.gripIndex === 2 || drag.gripIndex === -1) {
          // Midpoint or body drag: constrain movement delta to horizontal or vertical
          const sdx = constrainedPos.x - drag.originalGripPoint.x;
          const sdy = constrainedPos.y - drag.originalGripPoint.y;
          if (Math.abs(sdx) >= Math.abs(sdy)) {
            constrainedPos = { x: constrainedPos.x, y: drag.originalGripPoint.y };
          } else {
            constrainedPos = { x: drag.originalGripPoint.x, y: constrainedPos.y };
          }
        }
      }

      // Apply tracking for beam/line endpoint drags and polyline vertex drags
      let basePoint: Point | null = null;
      let shouldApplyTracking = false;

      if (trackingEnabled && !drag.axisConstraint) {
        if ((currentShape.type === 'beam' || currentShape.type === 'line' || currentShape.type === 'gridline' || currentShape.type === 'wall') &&
            (drag.gripIndex === 0 || drag.gripIndex === 1)) {
          // Line-like endpoint drag - use opposite endpoint as base
          const linelike = currentShape as LineShape | BeamShape | GridlineShape | WallShape;
          basePoint = drag.gripIndex === 0 ? linelike.end : linelike.start;
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

      // Apply snap detection for endpoint drags and body drags (move)
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

      // Rotation gizmo drag (gripIndex === -2): rotate shape around centroid
      if (drag.gripIndex === -2 && drag.rotationCenter && drag.initialRotationAngle !== undefined) {
        const rdx = constrainedPos.x - drag.rotationCenter.x;
        const rdy = constrainedPos.y - drag.rotationCenter.y;
        const currentAngle = Math.atan2(rdx, -rdy);
        let deltaAngle = currentAngle - drag.initialRotationAngle;
        let isSnapped = false;

        // Snap to 45 degree increments only when Shift is held
        if (shiftKey) {
          const snapAngles = [0, Math.PI / 4, Math.PI / 2, (3 * Math.PI) / 4, Math.PI, -Math.PI, -(3 * Math.PI) / 4, -Math.PI / 2, -Math.PI / 4];
          const snapThreshold = Math.PI / 36;
          for (const sa of snapAngles) {
            if (Math.abs(deltaAngle - sa) < snapThreshold ||
                Math.abs(deltaAngle - sa + 2 * Math.PI) < snapThreshold ||
                Math.abs(deltaAngle - sa - 2 * Math.PI) < snapThreshold) {
              deltaAngle = sa;
              isSnapped = true;
              break;
            }
          }
        }

        // Set active rotation state for the renderer to draw angle feedback
        setActiveRotation({
          shapeId: drag.shapeId,
          center: drag.rotationCenter,
          startAngle: drag.initialRotationAngle,
          deltaAngle,
          isSnapped,
        });

        const rotUpdates = computeRotationUpdates(drag.originalShape, drag.rotationCenter, deltaAngle);
        if (rotUpdates) {
          useAppStore.setState((state) => {
            const idx = state.shapes.findIndex(s => s.id === drag.shapeId);
            if (idx !== -1) {
              Object.assign(state.shapes[idx], rotUpdates);
            }
          });
        }
        return true;
      }

      const edgeIndices = drag.polylineMidpointIndices;
      const scaleMode = !!(shiftKey && edgeIndices);
      const updates = computeGripUpdates(currentShape, drag.gripIndex, constrainedPos, edgeIndices, scaleMode);
      if (updates) {
        useAppStore.setState((state) => {
          const idx = state.shapes.findIndex(s => s.id === drag.shapeId);
          if (idx !== -1) {
            Object.assign(state.shapes[idx], updates);
          }
        });
      }

      // Sync joined gridline endpoints
      if (joinedGridlinesRef.current.length > 0 && drag.originalShape.type === 'gridline') {
        const origEndpoint = drag.gripIndex === 0
          ? (drag.originalShape as GridlineShape).start
          : (drag.originalShape as GridlineShape).end;
        const delta = { x: constrainedPos.x - origEndpoint.x, y: constrainedPos.y - origEndpoint.y };

        // Get the dragged gridline's direction for parallel projection
        const dragDir = {
          x: (drag.originalShape as GridlineShape).end.x - (drag.originalShape as GridlineShape).start.x,
          y: (drag.originalShape as GridlineShape).end.y - (drag.originalShape as GridlineShape).start.y,
        };
        const dragLen = Math.sqrt(dragDir.x * dragDir.x + dragDir.y * dragDir.y);
        const dragUnit = dragLen > 0 ? { x: dragDir.x / dragLen, y: dragDir.y / dragLen } : { x: 1, y: 0 };

        useAppStore.setState((state) => {
          for (const joined of joinedGridlinesRef.current) {
            const idx = state.shapes.findIndex(s => s.id === joined.shapeId);
            if (idx !== -1) {
              if (joined.isParallel) {
                // Parallel: project delta along the parallel gridline's own direction
                const glDir = {
                  x: joined.originalShape.end.x - joined.originalShape.start.x,
                  y: joined.originalShape.end.y - joined.originalShape.start.y,
                };
                const glLen = Math.sqrt(glDir.x * glDir.x + glDir.y * glDir.y);
                if (glLen === 0) continue;
                const glUnit = { x: glDir.x / glLen, y: glDir.y / glLen };
                // Project the delta along the dragged gridline's direction,
                // then apply that distance along the parallel gridline's direction
                const projDist = delta.x * dragUnit.x + delta.y * dragUnit.y;
                const origPt = joined.gripIndex === 0
                  ? joined.originalShape.start
                  : joined.originalShape.end;
                const newPt = {
                  x: origPt.x + glUnit.x * projDist,
                  y: origPt.y + glUnit.y * projDist,
                };
                if (joined.gripIndex === 0) {
                  (state.shapes[idx] as GridlineShape).start = newPt;
                } else {
                  (state.shapes[idx] as GridlineShape).end = newPt;
                }
              } else {
                // Perpendicular: move by same delta (existing behavior)
                const origPt = joined.gripIndex === 0
                  ? joined.originalShape.start
                  : joined.originalShape.end;
                const newPt = { x: origPt.x + delta.x, y: origPt.y + delta.y };
                if (joined.gripIndex === 0) {
                  (state.shapes[idx] as GridlineShape).start = newPt;
                } else {
                  (state.shapes[idx] as GridlineShape).end = newPt;
                }
              }
            }
          }
        });
      }

      // Sync joined wall endpoints: move connected wall endpoints by the same delta
      if (joinedWallsRef.current.length > 0 && drag.originalShape.type === 'wall' &&
          (drag.gripIndex === 0 || drag.gripIndex === 1 || drag.gripIndex === 2)) {
        // For midpoint drag, both endpoints move by the same delta
        // For endpoint drag, only the dragged endpoint moves
        const origWall = drag.originalShape as WallShape;
        let delta: Point;
        if (drag.gripIndex === 2) {
          // Midpoint drag: compute delta from original midpoint
          const origMid = {
            x: (origWall.start.x + origWall.end.x) / 2,
            y: (origWall.start.y + origWall.end.y) / 2,
          };
          delta = { x: constrainedPos.x - origMid.x, y: constrainedPos.y - origMid.y };
        } else {
          const origEndpoint = drag.gripIndex === 0 ? origWall.start : origWall.end;
          delta = { x: constrainedPos.x - origEndpoint.x, y: constrainedPos.y - origEndpoint.y };
        }

        useAppStore.setState((state) => {
          for (const joined of joinedWallsRef.current) {
            const idx = state.shapes.findIndex(s => s.id === joined.shapeId);
            if (idx !== -1) {
              const origPt = joined.gripIndex === 0
                ? joined.originalShape.start
                : joined.originalShape.end;
              const newPt = { x: origPt.x + delta.x, y: origPt.y + delta.y };
              if (joined.gripIndex === 0) {
                (state.shapes[idx] as WallShape).start = newPt;
              } else {
                (state.shapes[idx] as WallShape).end = newPt;
              }
            }
          }
        });
      }

      // Sync joined section levels: move all other section-ref levels horizontally together
      if (joinedSectionLevelsRef.current.length > 0 && drag.originalShape.type === 'level' && (drag.gripIndex === 0 || drag.gripIndex === 1)) {
        const origEndpoint = drag.gripIndex === 0
          ? (drag.originalShape as LevelShape).start
          : (drag.originalShape as LevelShape).end;
        const dx = constrainedPos.x - origEndpoint.x;

        useAppStore.setState((state) => {
          for (const joined of joinedSectionLevelsRef.current) {
            const idx = state.shapes.findIndex(s => s.id === joined.shapeId);
            if (idx !== -1) {
              const lv = state.shapes[idx] as LevelShape;
              // Move both start and end x by the same delta (keeping the horizontal spread)
              (state.shapes[idx] as LevelShape).start = { x: joined.originalShape.start.x + dx, y: lv.start.y };
              (state.shapes[idx] as LevelShape).end = { x: joined.originalShape.end.x + dx, y: lv.end.y };
            }
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
    // Clear active rotation feedback
    setActiveRotation(null);

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
      justFinishedDragRef.current = true;
      return true;
    }

    const drag = dragRef.current;
    if (!drag) return false;

    // Clear snap indicator
    setCurrentSnapPoint(null);

    const currentShape = useAppStore.getState().shapes.find(s => s.id === drag.shapeId);
    const joinedShapes = joinedGridlinesRef.current;
    const joinedWalls = joinedWallsRef.current;
    const joinedLevels = joinedSectionLevelsRef.current;
    const hasJoined = joinedShapes.length > 0 || joinedWalls.length > 0 || joinedLevels.length > 0;

    if (currentShape) {
      // Capture final states of joined shapes before restoring originals
      const joinedFinalStates: { id: string; shape: Shape }[] = [];
      if (hasJoined) {
        const storeShapes = useAppStore.getState().shapes;
        for (const joined of joinedShapes) {
          const s = storeShapes.find(sh => sh.id === joined.shapeId);
          if (s) joinedFinalStates.push({ id: joined.shapeId, shape: { ...s } });
        }
        for (const joined of joinedWalls) {
          const s = storeShapes.find(sh => sh.id === joined.shapeId);
          if (s) joinedFinalStates.push({ id: joined.shapeId, shape: { ...s } });
        }
        for (const joined of joinedLevels) {
          const s = storeShapes.find(sh => sh.id === joined.shapeId);
          if (s) joinedFinalStates.push({ id: joined.shapeId, shape: { ...s } });
        }
      }

      // Restore original shape (direct mutation, no history)
      useAppStore.setState((state) => {
        const idx = state.shapes.findIndex(s => s.id === drag.shapeId);
        if (idx !== -1) {
          state.shapes[idx] = { ...drag.originalShape } as Shape;
        }
        // Also restore joined originals
        for (const joined of joinedShapes) {
          const jIdx = state.shapes.findIndex(s => s.id === joined.shapeId);
          if (jIdx !== -1) {
            state.shapes[jIdx] = { ...joined.originalShape } as Shape;
          }
        }
        for (const joined of joinedWalls) {
          const jIdx = state.shapes.findIndex(s => s.id === joined.shapeId);
          if (jIdx !== -1) {
            state.shapes[jIdx] = { ...joined.originalShape } as Shape;
          }
        }
        for (const joined of joinedLevels) {
          const jIdx = state.shapes.findIndex(s => s.id === joined.shapeId);
          if (jIdx !== -1) {
            state.shapes[jIdx] = { ...joined.originalShape } as Shape;
          }
        }
      });

      // Record history index before committing, so we can collapse all
      // related entries (shape move + dimension updates + label updates etc.)
      // into a single undo step.
      const historyStartIndex = useAppStore.getState().historyIndex + 1;

      // Commit final state through history
      if (hasJoined) {
        // Batch commit: dragged shape + all joined shapes as one undo step
        const batchUpdates: { id: string; updates: Partial<Shape> }[] = [
          { id: drag.shapeId, updates: { ...currentShape } as Partial<Shape> },
        ];
        for (const jf of joinedFinalStates) {
          batchUpdates.push({ id: jf.id, updates: { ...jf.shape } as Partial<Shape> });
        }
        updateShapes(batchUpdates);
      } else {
        updateShape(drag.shapeId, { ...currentShape } as Partial<Shape>);
      }

      // Recalculate miter joins for walls/beams with miter angles after grip edit
      if (currentShape.type === 'wall' || currentShape.type === 'beam') {
        const allShapesNow = useAppStore.getState().shapes;
        const updatedShape = allShapesNow.find(s => s.id === drag.shapeId);
        if (updatedShape) {
          const miterUpdates = recalculateMiterJoins(updatedShape, allShapesNow);
          if (miterUpdates.length > 0) {
            updateShapes(miterUpdates);
          }
        }
        // Also recalculate miters for joined walls that moved with the drag
        if (joinedWalls.length > 0) {
          const allShapesAfterMiter = useAppStore.getState().shapes;
          const joinedMiterUpdates: { id: string; updates: Partial<Shape> }[] = [];
          for (const joined of joinedWalls) {
            const joinedShape = allShapesAfterMiter.find(s => s.id === joined.shapeId);
            if (joinedShape) {
              const miters = recalculateMiterJoins(joinedShape, allShapesAfterMiter);
              joinedMiterUpdates.push(...miters);
            }
          }
          if (joinedMiterUpdates.length > 0) {
            updateShapes(joinedMiterUpdates);
          }
        }
      }

      // Update linked labels to stay parallel with the modified shape
      {
        const gripState = useAppStore.getState();
        const allShapesNow = gripState.shapes;
        const beamLabelStartDistance = gripState.planSubtypeSettings?.structuralPlan?.beamLabelStartDistance ?? 1000;
        const updatedShape = allShapesNow.find(s => s.id === drag.shapeId);
        if (updatedShape) {
          const labelPos = computeLinkedLabelPosition(updatedShape, beamLabelStartDistance);
          if (labelPos) {
            const linkedLabels = findLinkedLabels(allShapesNow, drag.shapeId);
            if (linkedLabels.length > 0) {
              const labelUpdates = linkedLabels.map(label => ({
                id: label.id,
                updates: {
                  position: labelPos.position,
                  rotation: labelPos.rotation,
                } as Partial<Shape>,
              }));
              updateShapes(labelUpdates);
            }
          }
        }
      }

      // Regenerate plate system child beams after contour grip edit
      // (must happen before collapse so the beam add/delete is included)
      if (drag.originalShape.type === 'plate-system') {
        regeneratePlateSystemBeams(drag.shapeId);
      }

      // Collapse all history entries created so far into one undo step
      // (covers: shape move + miter recalc + linked label updates + plate system beams)
      const storeAfterCommit = useAppStore.getState();
      if (storeAfterCommit.historyIndex >= historyStartIndex) {
        storeAfterCommit.collapseEntries(historyStartIndex);
      }
    }

    // Auto-regenerate grid dimensions if a gridline was dragged
    if (drag.originalShape.type === 'gridline') {
      // Record history index before dimension updates so we can collapse them
      // together with the gridline move (which was already collapsed above).
      // We need a fresh start index since the previous collapse already merged.
      const dimHistoryStart = useAppStore.getState().historyIndex;

      // Update associative DimAssociate dimensions linked to this gridline
      updateLinkedDimensions(drag.shapeId);
      // Also update linked dims for any joined gridlines that moved together
      for (const joined of joinedGridlinesRef.current) {
        updateLinkedDimensions(joined.shapeId);
      }
      // Regenerate auto-generated grid dimensions if enabled (synchronous)
      if (useAppStore.getState().autoGridDimension) {
        regenerateGridDimensions();
      }

      // Collapse the gridline move + all dimension updates into one undo step
      const storeAfterDims = useAppStore.getState();
      if (storeAfterDims.historyIndex > dimHistoryStart) {
        storeAfterDims.collapseEntries(dimHistoryStart);
      }

      // Bidirectional sync: if this is a section reference gridline, propagate back to plan
      if (drag.shapeId.startsWith('section-ref-')) {
        setTimeout(() => {
          useAppStore.getState().syncSectionReferenceToSource?.(drag.shapeId);
        }, 60);
      }
    }

    // Bidirectional sync: if a section reference level was dragged, update storey directly
    if (drag.originalShape.type === 'level' && drag.shapeId.startsWith('section-ref-lv-')) {
      const storeyId = drag.shapeId.replace('section-ref-lv-', '');
      const latestShape = useAppStore.getState().shapes.find(s => s.id === drag.shapeId) as LevelShape | undefined;
      if (latestShape) {
        const newElevation = Math.round(-latestShape.start.y);
        const peilLabel = formatSectionPeilLabel(newElevation);

        // Synchronously update storey elevation + shape label/elevation/peil in one setState
        useAppStore.setState((state) => {
          // Update storey elevation in projectStructure
          for (const building of state.projectStructure.buildings) {
            const storey = building.storeys.find(s => s.id === storeyId);
            if (storey) {
              storey.elevation = newElevation;
              break;
            }
          }

          // Update the level shape's label, elevation, and peil fields
          const shapeIdx = state.shapes.findIndex(s => s.id === drag.shapeId);
          if (shapeIdx !== -1) {
            const lvShape = state.shapes[shapeIdx] as any;
            lvShape.label = peilLabel;
            lvShape.elevation = newElevation;
            lvShape.peil = newElevation;
          }
        });

        // Collapse the storey+shape update into the same undo group
        const storeAfterLevel = useAppStore.getState();
        if (storeAfterLevel.historyIndex >= historyStartIndex) {
          storeAfterLevel.collapseEntries(historyStartIndex);
        }
      }
    }

    // Update linked section drawing boundary when a section callout is grip-edited
    if (drag.originalShape.type === 'section-callout') {
      const sc = useAppStore.getState().shapes.find(s => s.id === drag.shapeId) as SectionCalloutShape | undefined;
      if (sc?.targetDrawingId) {
        setTimeout(() => {
          useAppStore.getState().updateSectionDrawingBoundary?.(sc.targetDrawingId!);
        }, 50);
      }
    }

    joinedGridlinesRef.current = [];
    joinedWallsRef.current = [];
    joinedSectionLevelsRef.current = [];
    dragRef.current = null;
    justFinishedDragRef.current = true;
    return true;
  }, [updateShape, updateShapes, updateProfilePosition, setCurrentSnapPoint, setCurrentTrackingLines, setTrackingPoint]);

  const isDragging = useCallback(() => dragRef.current !== null || parametricDragRef.current !== null, []);

  /** Returns true once after a grip drag finishes (consumed on read, like justFinishedBoxSelection). */
  const justFinishedGripDrag = useCallback(() => {
    const result = justFinishedDragRef.current;
    justFinishedDragRef.current = false;
    return result;
  }, []);

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
      if (!shape) { setGripHover(null); setRotationGizmoHovered(false); return null; }
      const grips = getGripPoints(shape, drawingScale, viewport.zoom);

      // Check rotation gizmo hover (handle + ring — skip pile/cpt, no rotation)
      if (showRotationGizmo && shape.type !== 'text' && shape.type !== 'pile' && shape.type !== 'cpt' && grips.length > 0) {
        let cx = 0, cy = 0;
        for (const pt of grips) { cx += pt.x; cy += pt.y; }
        cx /= grips.length;
        cy /= grips.length;
        // Fixed world-space ring radius: 50mm (must match renderer)
        const ringRadius = 50;
        const handleX = cx;
        const handleY = cy - ringRadius;
        const hDx = worldPos.x - handleX;
        const hDy = worldPos.y - handleY;
        const handleHitRadius = 8 / viewport.zoom;
        const distFromCenter = Math.sqrt((worldPos.x - cx) * (worldPos.x - cx) + (worldPos.y - cy) * (worldPos.y - cy));
        const ringTolerance = 5 / viewport.zoom;
        const onHandle = Math.sqrt(hDx * hDx + hDy * hDy) <= handleHitRadius;
        const onRing = Math.abs(distFromCenter - ringRadius) <= ringTolerance;
        setRotationGizmoHovered(onHandle || onRing);
      } else {
        setRotationGizmoHovered(false);
      }

      for (let i = 0; i < grips.length; i++) {
        if (shape.type === 'arc' && i === 3) continue;
        // For line/beam midpoint (index 2), use rotated axes
        let gripAxisAngle = 0;
        if (i === 2 && (shape.type === 'line' || shape.type === 'beam' || shape.type === 'gridline' || shape.type === 'wall')) {
          gripAxisAngle = Math.atan2(shape.end.y - shape.start.y, shape.end.x - shape.start.x);
        }
        const axis = hitTestAxisArrow(worldPos, grips[i], viewport.zoom, gripAxisAngle);
        if (axis) {
          setGripHover({ shapeId: shape.id, gripIndex: i, axis });
          return null;
        }
      }
      setGripHover(null);
      return null;
    },
    [selectedShapeIds, shapes, parametricShapes, viewport.zoom, drawingScale, showRotationGizmo]
  );

  return {
    handleGripMouseDown,
    handleGripMouseMove,
    handleGripMouseUp,
    isDragging,
    getHoveredAxis,
    justFinishedGripDrag,
  };
}
