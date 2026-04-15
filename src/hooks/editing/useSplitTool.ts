/**
 * useSplitTool - Split tool hook
 *
 * Splits a line, polyline, or arc at the clicked point:
 * - Line: split into two lines at the nearest point on the segment
 * - Polyline: split into two polylines at the nearest segment point
 * - Arc: split into two arcs at the nearest angle
 */

import { useCallback } from 'react';
import { useAppStore } from '../../state/appStore';
import type { LineShape, PolylineShape, ArcShape, Shape, BaseShape } from '../../types/geometry';
import { generateId } from '../../state/slices/types';
import { LineUtils } from '../../engine/geometry/Line';

export function useSplitTool() {
  const shapes = useAppStore((s) => s.shapes);
  const deleteShape = useAppStore((s) => s.deleteShape);
  const addShapes = useAppStore((s) => s.addShapes);
  const setActiveTool = useAppStore((s) => s.setActiveTool);
  const activeDrawingId = useAppStore((s) => s.activeDrawingId);
  const activeLayerId = useAppStore((s) => s.activeLayerId);
  const viewport = useAppStore((s) => s.viewport);

  /**
   * Find the shape closest to click position and split it.
   */
  const handleSplitClick = useCallback(
    (worldPos: { x: number; y: number }, findShapeAtPoint: (pos: { x: number; y: number }) => string | null) => {
      // First try the shape under the cursor
      const shapeId = findShapeAtPoint(worldPos);
      if (!shapeId) return;

      const shape = shapes.find((s) => s.id === shapeId);
      if (!shape) return;

      if (shape.type === 'line') {
        splitLine(shape as LineShape, worldPos);
      } else if (shape.type === 'polyline') {
        splitPolyline(shape as PolylineShape, worldPos);
      } else if (shape.type === 'arc') {
        splitArc(shape as ArcShape, worldPos);
      }
      // After split, return to select
      setActiveTool('select');
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [shapes, deleteShape, addShapes, setActiveTool, activeDrawingId, activeLayerId, viewport]
  );

  function baseProps(shape: Shape): Pick<BaseShape, 'drawingId' | 'layerId' | 'style' | 'visible' | 'locked'> {
    return {
      drawingId: shape.drawingId ?? activeDrawingId ?? '',
      layerId: shape.layerId ?? activeLayerId ?? '',
      style: { ...shape.style },
      visible: shape.visible !== false,
      locked: shape.locked ?? false,
    };
  }

  function splitLine(shape: LineShape, click: { x: number; y: number }) {
    // Find closest point on segment
    const splitPt = LineUtils.closestPointOnSegment(
      { start: shape.start, end: shape.end },
      click
    );

    // Don't split if the split point is at or very near an endpoint
    const dx1 = splitPt.x - shape.start.x;
    const dy1 = splitPt.y - shape.start.y;
    const dx2 = splitPt.x - shape.end.x;
    const dy2 = splitPt.y - shape.end.y;
    const minDist = 0.001;
    if (
      Math.sqrt(dx1 * dx1 + dy1 * dy1) < minDist ||
      Math.sqrt(dx2 * dx2 + dy2 * dy2) < minDist
    ) {
      return;
    }

    const base = baseProps(shape);
    const line1: LineShape = {
      id: generateId(),
      type: 'line',
      start: { ...shape.start },
      end: { ...splitPt },
      ...base,
    };
    const line2: LineShape = {
      id: generateId(),
      type: 'line',
      start: { ...splitPt },
      end: { ...shape.end },
      ...base,
    };

    deleteShape(shape.id);
    addShapes([line1, line2]);
  }

  function splitPolyline(shape: PolylineShape, click: { x: number; y: number }) {
    const pts = shape.points;
    if (pts.length < 2) return;

    let bestDist = Infinity;
    let bestSegIdx = -1;
    let bestPt = { x: 0, y: 0 };

    for (let i = 0; i < pts.length - 1; i++) {
      const cp = LineUtils.closestPointOnSegment(
        { start: pts[i], end: pts[i + 1] },
        click
      );
      const dx = click.x - cp.x;
      const dy = click.y - cp.y;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d < bestDist) {
        bestDist = d;
        bestSegIdx = i;
        bestPt = cp;
      }
    }

    if (bestSegIdx === -1) return;

    // Split points: first polyline is pts[0..bestSegIdx] + bestPt
    // Second polyline is bestPt + pts[bestSegIdx+1..end]
    const base = baseProps(shape);

    const pts1 = [...pts.slice(0, bestSegIdx + 1), { ...bestPt }];
    const pts2 = [{ ...bestPt }, ...pts.slice(bestSegIdx + 1)];

    if (pts1.length < 2 || pts2.length < 2) return;

    const poly1: PolylineShape = {
      id: generateId(),
      type: 'polyline',
      points: pts1,
      closed: false,
      ...base,
    };
    const poly2: PolylineShape = {
      id: generateId(),
      type: 'polyline',
      points: pts2,
      closed: false,
      ...base,
    };

    deleteShape(shape.id);
    addShapes([poly1, poly2]);
  }

  function splitArc(shape: ArcShape, click: { x: number; y: number }) {
    // Find the angle of the click point relative to the arc center
    const angle = Math.atan2(click.y - shape.center.y, click.x - shape.center.x);

    // Normalize angles to [0, 2π)
    const twoPi = 2 * Math.PI;
    const normaliseAngle = (a: number) => ((a % twoPi) + twoPi) % twoPi;
    const ns = normaliseAngle(shape.startAngle);
    const ne = normaliseAngle(shape.endAngle);
    const na = normaliseAngle(angle);

    // Check if angle is within the arc span
    let inRange: boolean;
    if (ns <= ne) {
      inRange = na >= ns && na <= ne;
    } else {
      // Arc crosses 0
      inRange = na >= ns || na <= ne;
    }

    if (!inRange) return;

    // Don't split at endpoints
    const eps = 0.01;
    if (
      Math.abs(normaliseAngle(angle - shape.startAngle)) < eps ||
      Math.abs(normaliseAngle(angle - shape.endAngle)) < eps
    ) {
      return;
    }

    const base = baseProps(shape);

    const arc1: ArcShape = {
      id: generateId(),
      type: 'arc',
      center: { ...shape.center },
      radius: shape.radius,
      startAngle: shape.startAngle,
      endAngle: angle,
      ...base,
    };
    const arc2: ArcShape = {
      id: generateId(),
      type: 'arc',
      center: { ...shape.center },
      radius: shape.radius,
      startAngle: angle,
      endAngle: shape.endAngle,
      ...base,
    };

    deleteShape(shape.id);
    addShapes([arc1, arc2]);
  }

  return {
    handleSplitClick,
  };
}
