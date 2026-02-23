/**
 * useSlabDrawing - Handles slab drawing as a closed polygon with hatch fill.
 *
 * Drawing interaction:
 * - Multi-click to define polygon boundary vertices (like polyline/hatch)
 * - Right-click to finish (auto-closes the polygon)
 * - Creates a SlabShape with hatch pattern
 */

import { useCallback } from 'react';
import { useAppStore, generateId } from '../../state/appStore';
import type { Point, SlabShape, SlabMaterial } from '../../types/geometry';
import { snapToAngle } from '../../engine/geometry/GeometryUtils';

export function useSlabDrawing() {
  const {
    activeLayerId,
    activeDrawingId,
    currentStyle,
    addShape,
    drawingPoints,
    addDrawingPoint,
    clearDrawingPoints,
    setDrawingPreview,
    pendingSlab,
    clearPendingSlab,
  } = useAppStore();

  /**
   * Create a slab shape from polygon points
   */
  const createSlab = useCallback(
    (
      points: Point[],
      options?: {
        thickness?: number;
        level?: string;
        elevation?: number;
        material?: SlabMaterial;
        label?: string;
      }
    ) => {
      if (points.length < 3) return null;

      const slabShape: SlabShape = {
        id: generateId(),
        type: 'slab',
        layerId: activeLayerId,
        drawingId: activeDrawingId,
        style: { ...currentStyle },
        visible: true,
        locked: false,
        points: [...points],
        thickness: options?.thickness ?? 200,
        level: options?.level ?? '0',
        elevation: options?.elevation ?? 0,
        material: options?.material ?? 'concrete',
        // Legacy hatch fields - kept for shape interface compat; renderer resolves hatch from materialHatchSettings
        hatchType: 'diagonal',
        hatchAngle: 45,
        hatchSpacing: 100,
        label: options?.label,
      };
      addShape(slabShape);
      return slabShape.id;
    },
    [activeLayerId, activeDrawingId, currentStyle, addShape]
  );

  /**
   * Handle click for slab drawing (multi-click polygon or two-click rectangle)
   */
  const handleSlabClick = useCallback(
    (snappedPos: Point, shiftKey: boolean) => {
      if (!pendingSlab) return false;

      const isRectMode = pendingSlab.shapeMode === 'rectangle';

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
            createSlab(rectPoints, {
              thickness: pendingSlab.thickness,
              level: pendingSlab.level,
              elevation: pendingSlab.elevation,
              material: pendingSlab.material,
            });
          }
          clearDrawingPoints();
          setDrawingPreview(null);
          // Keep pendingSlab active for consecutive drawing
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
          // Close polygon and create slab
          createSlab(drawingPoints, {
            thickness: pendingSlab.thickness,
            level: pendingSlab.level,
            elevation: pendingSlab.elevation,
            material: pendingSlab.material,
          });
          clearDrawingPoints();
          setDrawingPreview(null);
          // Keep pendingSlab active for consecutive drawing
          return true;
        }
      }

      // Add point to the polygon
      addDrawingPoint(finalPos);
      return true;
    },
    [pendingSlab, drawingPoints, addDrawingPoint, clearDrawingPoints, setDrawingPreview, createSlab]
  );

  /**
   * Finish slab drawing (right-click or 'C' to close)
   * Requires at least 3 points to form a valid polygon
   */
  const finishSlabDrawing = useCallback(() => {
    if (!pendingSlab || drawingPoints.length < 3) return;

    createSlab(drawingPoints, {
      thickness: pendingSlab.thickness,
      level: pendingSlab.level,
      elevation: pendingSlab.elevation,
      material: pendingSlab.material,
    });
    clearDrawingPoints();
    setDrawingPreview(null);
    // Keep pendingSlab active for consecutive drawing
  }, [pendingSlab, drawingPoints, createSlab, clearDrawingPoints, setDrawingPreview]);

  /**
   * Update slab preview (shows polygon outline + current mouse position)
   */
  const updateSlabPreview = useCallback(
    (snappedPos: Point, shiftKey: boolean) => {
      if (!pendingSlab || drawingPoints.length === 0) return;

      const lastPoint = drawingPoints[drawingPoints.length - 1];
      const previewPos = shiftKey ? snapToAngle(lastPoint, snappedPos) : snappedPos;

      // Rectangle mode: show 4-corner rectangle preview
      if (pendingSlab.shapeMode === 'rectangle' && drawingPoints.length === 1) {
        const corner1 = drawingPoints[0];
        const rectPoints: Point[] = [
          corner1,
          { x: previewPos.x, y: corner1.y },
          previewPos,
          { x: corner1.x, y: previewPos.y },
        ];
        setDrawingPreview({
          type: 'slab',
          points: rectPoints,
          currentPoint: rectPoints[0], // close back to first point
        });
        return;
      }

      setDrawingPreview({
        type: 'slab',
        points: [...drawingPoints],
        currentPoint: previewPos,
      });
    },
    [pendingSlab, drawingPoints, setDrawingPreview]
  );

  /**
   * Cancel slab drawing
   */
  const cancelSlabDrawing = useCallback(() => {
    clearDrawingPoints();
    setDrawingPreview(null);
    clearPendingSlab();
  }, [clearDrawingPoints, setDrawingPreview, clearPendingSlab]);

  /**
   * Get the base point for tracking (last clicked point)
   */
  const getSlabBasePoint = useCallback((): Point | null => {
    if (!pendingSlab || drawingPoints.length === 0) return null;
    return drawingPoints[drawingPoints.length - 1];
  }, [pendingSlab, drawingPoints]);

  return {
    handleSlabClick,
    finishSlabDrawing,
    updateSlabPreview,
    cancelSlabDrawing,
    getSlabBasePoint,
    createSlab,
    isSlabDrawingActive: !!pendingSlab,
    hasPoints: drawingPoints.length > 0,
    pointCount: drawingPoints.length,
  };
}
