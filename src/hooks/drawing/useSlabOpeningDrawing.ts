/**
 * useSlabOpeningDrawing - Handles slab opening drawing as a closed polygon.
 *
 * Drawing interaction:
 * - Multi-click to define polygon boundary vertices (like polyline/hatch)
 * - Right-click to finish (auto-closes the polygon)
 * - Creates a SlabOpeningShape (hole in a floor slab)
 */

import { useCallback } from 'react';
import { useAppStore, generateId } from '../../state/appStore';
import type { Point, SlabOpeningShape, SlabOpeningDisplayStyle } from '../../types/geometry';
import { snapToAngle } from '../../engine/geometry/GeometryUtils';

export function useSlabOpeningDrawing() {
  const {
    activeLayerId,
    activeDrawingId,
    currentStyle,
    addShape,
    drawingPoints,
    addDrawingPoint,
    clearDrawingPoints,
    setDrawingPreview,
    pendingSlabOpening,
    clearPendingSlabOpening,
  } = useAppStore();

  /**
   * Create a slab opening shape from polygon points
   */
  const createSlabOpening = useCallback(
    (
      points: Point[],
      options?: {
        linkedSlabId?: string;
        label?: string;
        displayStyle?: SlabOpeningDisplayStyle;
      }
    ) => {
      if (points.length < 3) return null;

      const slabOpeningShape: SlabOpeningShape = {
        id: generateId(),
        type: 'slab-opening',
        layerId: activeLayerId,
        drawingId: activeDrawingId,
        style: { ...currentStyle },
        visible: true,
        locked: false,
        points: [...points],
        linkedSlabId: options?.linkedSlabId,
        label: options?.label,
        displayStyle: options?.displayStyle ?? 'cross',
      };
      addShape(slabOpeningShape);
      return slabOpeningShape.id;
    },
    [activeLayerId, activeDrawingId, currentStyle, addShape]
  );

  /**
   * Handle click for slab opening drawing (multi-click polygon or two-click rectangle)
   */
  const handleSlabOpeningClick = useCallback(
    (snappedPos: Point, shiftKey: boolean) => {
      if (!pendingSlabOpening) return false;

      const isRectMode = pendingSlabOpening.shapeMode === 'rectangle';

      // Apply shift-key angle constraint if there's a previous point
      let finalPos = snappedPos;
      if (shiftKey && drawingPoints.length > 0) {
        const lastPoint = drawingPoints[drawingPoints.length - 1];
        finalPos = snapToAngle(lastPoint, snappedPos);
      }

      // Rectangle mode: two clicks define opposite corners
      if (isRectMode) {
        if (drawingPoints.length === 0) {
          addDrawingPoint(finalPos);
          return true;
        } else {
          const corner1 = drawingPoints[0];
          const corner2 = finalPos;
          const dx = Math.abs(corner2.x - corner1.x);
          const dy = Math.abs(corner2.y - corner1.y);

          if (dx > 1 && dy > 1) {
            const rectPoints: Point[] = [
              corner1,
              { x: corner2.x, y: corner1.y },
              corner2,
              { x: corner1.x, y: corner2.y },
            ];
            createSlabOpening(rectPoints, {
              linkedSlabId: pendingSlabOpening.linkedSlabId,
              displayStyle: pendingSlabOpening.displayStyle,
            });
          }
          clearDrawingPoints();
          setDrawingPreview(null);
          // Keep pendingSlabOpening active for consecutive drawing
          return true;
        }
      }

      // Polygon mode: multi-click
      // Check if clicking near the first point to close the polygon
      if (drawingPoints.length >= 3) {
        const firstPoint = drawingPoints[0];
        const dx = finalPos.x - firstPoint.x;
        const dy = finalPos.y - firstPoint.y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        // Close threshold: 10 drawing units
        if (dist < 10) {
          createSlabOpening(drawingPoints, {
            linkedSlabId: pendingSlabOpening.linkedSlabId,
            displayStyle: pendingSlabOpening.displayStyle,
          });
          clearDrawingPoints();
          setDrawingPreview(null);
          return true;
        }
      }

      // Add point to the polygon
      addDrawingPoint(finalPos);
      return true;
    },
    [pendingSlabOpening, drawingPoints, addDrawingPoint, clearDrawingPoints, setDrawingPreview, createSlabOpening]
  );

  /**
   * Finish slab opening drawing (right-click or 'C' to close)
   * Requires at least 3 points to form a valid polygon
   */
  const finishSlabOpeningDrawing = useCallback(() => {
    if (!pendingSlabOpening || drawingPoints.length < 3) return;

    createSlabOpening(drawingPoints, {
      linkedSlabId: pendingSlabOpening.linkedSlabId,
      displayStyle: pendingSlabOpening.displayStyle,
    });
    clearDrawingPoints();
    setDrawingPreview(null);
    // Keep pendingSlabOpening active for consecutive drawing
  }, [pendingSlabOpening, drawingPoints, createSlabOpening, clearDrawingPoints, setDrawingPreview]);

  /**
   * Update slab opening preview (shows polygon outline + current mouse position)
   */
  const updateSlabOpeningPreview = useCallback(
    (snappedPos: Point, shiftKey: boolean) => {
      if (!pendingSlabOpening || drawingPoints.length === 0) return;

      const lastPoint = drawingPoints[drawingPoints.length - 1];
      const previewPos = shiftKey ? snapToAngle(lastPoint, snappedPos) : snappedPos;

      // Rectangle mode: show 4-corner rectangle preview
      if (pendingSlabOpening.shapeMode === 'rectangle' && drawingPoints.length === 1) {
        const corner1 = drawingPoints[0];
        const rectPoints: Point[] = [
          corner1,
          { x: previewPos.x, y: corner1.y },
          previewPos,
          { x: corner1.x, y: previewPos.y },
        ];
        setDrawingPreview({
          type: 'slab-opening',
          points: rectPoints,
          currentPoint: rectPoints[0],
        });
        return;
      }

      setDrawingPreview({
        type: 'slab-opening',
        points: [...drawingPoints],
        currentPoint: previewPos,
      });
    },
    [pendingSlabOpening, drawingPoints, setDrawingPreview]
  );

  /**
   * Cancel slab opening drawing
   */
  const cancelSlabOpeningDrawing = useCallback(() => {
    clearDrawingPoints();
    setDrawingPreview(null);
    clearPendingSlabOpening();
  }, [clearDrawingPoints, setDrawingPreview, clearPendingSlabOpening]);

  /**
   * Get the base point for tracking (last clicked point)
   */
  const getSlabOpeningBasePoint = useCallback((): Point | null => {
    if (!pendingSlabOpening || drawingPoints.length === 0) return null;
    return drawingPoints[drawingPoints.length - 1];
  }, [pendingSlabOpening, drawingPoints]);

  return {
    handleSlabOpeningClick,
    finishSlabOpeningDrawing,
    updateSlabOpeningPreview,
    cancelSlabOpeningDrawing,
    getSlabOpeningBasePoint,
    createSlabOpening,
    isSlabOpeningDrawingActive: !!pendingSlabOpening,
    hasPoints: drawingPoints.length > 0,
    pointCount: drawingPoints.length,
  };
}
