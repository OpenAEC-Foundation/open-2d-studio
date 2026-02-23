/**
 * useGridlineDrawing - Handles gridline drawing (click start, click end)
 * Follows the same pattern as useBeamDrawing.ts
 *
 * Structural engineering convention:
 *   - Horizontal gridlines (|dx| > |dy|) → letter labels: A, B, C, ...
 *   - Vertical gridlines   (|dy| > |dx|) → number labels: 1, 2, 3, ...
 */

import { useCallback } from 'react';
import { useAppStore, generateId } from '../../state/appStore';
import type { Point, GridlineShape, GridlineBubblePosition } from '../../types/geometry';
import { snapToAngle } from '../../engine/geometry/GeometryUtils';
import { regenerateGridDimensions } from '../../utils/gridDimensionUtils';
import {
  classifyGridlineOrientation,
  getNextGridlineLabel,
  incrementGridLabel,
} from '../../utils/gridlineUtils';

export function useGridlineDrawing() {
  const {
    activeLayerId,
    activeDrawingId,
    currentStyle,
    addShape,
    drawingPoints,
    addDrawingPoint,
    clearDrawingPoints,
    setDrawingPreview,
    pendingGridline,
    setPendingGridline,
    clearPendingGridline,
    setActiveTool,
    selectShape,
  } = useAppStore();

  /**
   * Create a gridline shape
   */
  const createGridline = useCallback(
    (
      start: Point,
      end: Point,
      label: string,
      bubblePosition: GridlineBubblePosition,
      bubbleRadius: number,
      fontSize: number,
    ) => {
      const gridlineShape: GridlineShape = {
        id: generateId(),
        type: 'gridline',
        layerId: activeLayerId,
        drawingId: activeDrawingId,
        style: {
          ...currentStyle,
          lineStyle: 'dashdot', // Always dash-dot for gridlines
        },
        visible: true,
        locked: false,
        start,
        end,
        label,
        bubblePosition,
        bubbleRadius,
        fontSize,
      };
      addShape(gridlineShape);
      return gridlineShape.id;
    },
    [activeLayerId, activeDrawingId, currentStyle, addShape]
  );

  /**
   * Handle click for gridline drawing
   */
  const handleGridlineClick = useCallback(
    (snappedPos: Point, shiftKey: boolean) => {
      if (!pendingGridline) return false;

      if (drawingPoints.length === 0) {
        // First click: set start point
        addDrawingPoint(snappedPos);
        return true;
      } else {
        // Second click: set end point and create gridline
        const startPoint = drawingPoints[0];
        const finalPos = shiftKey ? snapToAngle(startPoint, snappedPos) : snappedPos;

        const dx = Math.abs(finalPos.x - startPoint.x);
        const dy = Math.abs(finalPos.y - startPoint.y);

        // Only create if there's a meaningful distance
        if (dx > 1 || dy > 1) {
          // Auto-detect orientation and resolve label:
          //   Horizontal (|dx| > |dy|) → letters (A, B, C...)
          //   Vertical   (|dy| > |dx|) → numbers (1, 2, 3...)
          //   Angled (neither)         → letter+number (A1, B1, C1...)
          const orientation = classifyGridlineOrientation(startPoint, finalPos);
          const angleDeg = orientation === 'angled'
            ? (() => {
                let a = Math.atan2(finalPos.y - startPoint.y, finalPos.x - startPoint.x) * 180 / Math.PI;
                if (a < 0) a += 180;
                if (a >= 180) a -= 180;
                return a;
              })()
            : undefined;
          const label = getNextGridlineLabel(pendingGridline.label, orientation, activeDrawingId, angleDeg);

          const newGridlineId = createGridline(
            startPoint,
            finalPos,
            label,
            pendingGridline.bubblePosition,
            pendingGridline.bubbleRadius,
            pendingGridline.fontSize,
          );

          // Auto-dimension: regenerate grid dimensions if enabled
          if (useAppStore.getState().autoGridDimension) {
            setTimeout(() => regenerateGridDimensions(), 50);
          }

          // End tool and select the placed gridline
          clearDrawingPoints();
          setDrawingPreview(null);
          clearPendingGridline();
          setActiveTool('select');
          selectShape(newGridlineId);
        } else {
          clearDrawingPoints();
          setDrawingPreview(null);
          setPendingGridline({
            ...pendingGridline,
            label: incrementGridLabel(pendingGridline.label),
          });
        }
        return true;
      }
    },
    [pendingGridline, drawingPoints, addDrawingPoint, clearDrawingPoints, setDrawingPreview, createGridline, setPendingGridline, clearPendingGridline, setActiveTool, selectShape, activeDrawingId]
  );

  /**
   * Update gridline preview
   */
  const updateGridlinePreview = useCallback(
    (snappedPos: Point, shiftKey: boolean) => {
      if (!pendingGridline || drawingPoints.length === 0) return;

      const startPoint = drawingPoints[0];
      const previewPos = shiftKey ? snapToAngle(startPoint, snappedPos) : snappedPos;

      setDrawingPreview({
        type: 'gridline',
        start: startPoint,
        end: previewPos,
        label: pendingGridline.label,
        bubblePosition: pendingGridline.bubblePosition,
        bubbleRadius: pendingGridline.bubbleRadius,
      });
    },
    [pendingGridline, drawingPoints, setDrawingPreview]
  );

  /**
   * Cancel gridline drawing
   */
  const cancelGridlineDrawing = useCallback(() => {
    clearDrawingPoints();
    setDrawingPreview(null);
    clearPendingGridline();
  }, [clearDrawingPoints, setDrawingPreview, clearPendingGridline]);

  /**
   * Get the base point for tracking (first click point)
   */
  const getGridlineBasePoint = useCallback((): Point | null => {
    if (!pendingGridline || drawingPoints.length === 0) return null;
    return drawingPoints[0];
  }, [pendingGridline, drawingPoints]);

  return {
    handleGridlineClick,
    updateGridlinePreview,
    cancelGridlineDrawing,
    getGridlineBasePoint,
    createGridline,
    isGridlineDrawingActive: !!pendingGridline,
    hasFirstPoint: drawingPoints.length > 0,
  };
}
