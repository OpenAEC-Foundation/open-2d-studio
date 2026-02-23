/**
 * usePuntniveauDrawing - Handles puntniveau (pile tip level zone) drawing as a closed polygon.
 *
 * Drawing interaction:
 * - Multi-click to define polygon boundary vertices (like slab/hatch)
 * - Right-click or double-click near first point to finish (auto-closes the polygon)
 * - Creates a PuntniveauShape with dashed outline, no fill
 */

import { useCallback } from 'react';
import { useAppStore, generateId } from '../../state/appStore';
import type { Point, PuntniveauShape, TextShape } from '../../types/geometry';
import { snapToAngle } from '../../engine/geometry/GeometryUtils';
import { formatDutchNumber } from '../../engine/geometry/LabelUtils';

export function usePuntniveauDrawing() {
  const {
    activeLayerId,
    activeDrawingId,
    currentStyle,
    addShape,
    drawingPoints,
    addDrawingPoint,
    clearDrawingPoints,
    setDrawingPreview,
    pendingPuntniveau,
    clearPendingPuntniveau,
  } = useAppStore();

  /**
   * Create a puntniveau shape from polygon points,
   * plus a linked TextShape label at the polygon centroid.
   */
  const createPuntniveau = useCallback(
    (points: Point[], puntniveauNAP: number, fontSize: number) => {
      if (points.length < 3) return null;

      const puntniveauId = generateId();

      const shape: PuntniveauShape = {
        id: puntniveauId,
        type: 'puntniveau',
        layerId: activeLayerId,
        drawingId: activeDrawingId,
        style: {
          ...currentStyle,
          lineStyle: 'dashed',
          strokeWidth: 0.5, // 0.50mm stroke width
        },
        visible: true,
        locked: false,
        points: [...points],
        puntniveauNAP,
        fontSize,
      };
      addShape(shape);

      // Compute centroid for label placement
      let cx = 0, cy = 0;
      for (const p of points) { cx += p.x; cy += p.y; }
      cx /= points.length;
      cy /= points.length;

      // Create a linked TextShape label at the centroid
      const napFormatted = formatDutchNumber(puntniveauNAP);
      const labelText = `PUNTNIVEAU: ${napFormatted} m N.A.P.`;

      const label: TextShape = {
        id: generateId(),
        type: 'text',
        layerId: activeLayerId,
        drawingId: activeDrawingId,
        style: {
          ...currentStyle,
          lineStyle: 'solid',
          strokeWidth: 0.5,
        },
        visible: true,
        locked: false,
        position: { x: cx, y: cy },
        text: labelText,
        fontSize,            // same font size as the puntniveau (mm)
        fontFamily: 'Osifont',
        rotation: 0,
        alignment: 'center',
        verticalAlignment: 'middle',
        bold: true,
        italic: false,
        underline: false,
        color: currentStyle.strokeColor,
        lineHeight: 1.2,
        isModelText: true,   // Label is in model units (scales with geometry)
        backgroundMask: true,
        backgroundColor: '#1a1a2e',
        backgroundPadding: fontSize * 0.4,
        showBorder: true,
        borderColor: currentStyle.strokeColor,
        linkedShapeId: puntniveauId,
      };
      addShape(label);

      return puntniveauId;
    },
    [activeLayerId, activeDrawingId, currentStyle, addShape]
  );

  /**
   * Handle click for puntniveau drawing (multi-click polygon)
   */
  const handlePuntniveauClick = useCallback(
    (snappedPos: Point, shiftKey: boolean) => {
      if (!pendingPuntniveau) return false;

      // Apply shift-key angle constraint if there's a previous point
      let finalPos = snappedPos;
      if (shiftKey && drawingPoints.length > 0) {
        const lastPoint = drawingPoints[drawingPoints.length - 1];
        finalPos = snapToAngle(lastPoint, snappedPos);
      }

      // Check if clicking near the first point to close the polygon
      if (drawingPoints.length >= 3) {
        const firstPoint = drawingPoints[0];
        const dx = finalPos.x - firstPoint.x;
        const dy = finalPos.y - firstPoint.y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        // Close threshold: 10 drawing units
        if (dist < 10) {
          createPuntniveau(
            drawingPoints,
            pendingPuntniveau.puntniveauNAP,
            pendingPuntniveau.fontSize,
          );
          clearDrawingPoints();
          setDrawingPreview(null);
          // Keep pendingPuntniveau active for consecutive drawing
          return true;
        }
      }

      // Add point to the polygon
      addDrawingPoint(finalPos);
      return true;
    },
    [pendingPuntniveau, drawingPoints, addDrawingPoint, clearDrawingPoints, setDrawingPreview, createPuntniveau]
  );

  /**
   * Finish puntniveau drawing (right-click to close)
   * Requires at least 3 points to form a valid polygon
   */
  const finishPuntniveauDrawing = useCallback(() => {
    if (!pendingPuntniveau || drawingPoints.length < 3) return;

    createPuntniveau(
      drawingPoints,
      pendingPuntniveau.puntniveauNAP,
      pendingPuntniveau.fontSize,
    );
    clearDrawingPoints();
    setDrawingPreview(null);
    // Keep pendingPuntniveau active for consecutive drawing
  }, [pendingPuntniveau, drawingPoints, createPuntniveau, clearDrawingPoints, setDrawingPreview]);

  /**
   * Update puntniveau preview (shows polygon outline + current mouse position)
   */
  const updatePuntniveauPreview = useCallback(
    (snappedPos: Point, shiftKey: boolean) => {
      if (!pendingPuntniveau || drawingPoints.length === 0) return;

      const lastPoint = drawingPoints[drawingPoints.length - 1];
      const previewPos = shiftKey ? snapToAngle(lastPoint, snappedPos) : snappedPos;

      setDrawingPreview({
        type: 'puntniveau',
        points: [...drawingPoints],
        currentPoint: previewPos,
        puntniveauNAP: pendingPuntniveau.puntniveauNAP,
      });
    },
    [pendingPuntniveau, drawingPoints, setDrawingPreview]
  );

  /**
   * Cancel puntniveau drawing
   */
  const cancelPuntniveauDrawing = useCallback(() => {
    clearDrawingPoints();
    setDrawingPreview(null);
    clearPendingPuntniveau();
  }, [clearDrawingPoints, setDrawingPreview, clearPendingPuntniveau]);

  /**
   * Get the base point for tracking (last clicked point)
   */
  const getPuntniveauBasePoint = useCallback((): Point | null => {
    if (!pendingPuntniveau || drawingPoints.length === 0) return null;
    return drawingPoints[drawingPoints.length - 1];
  }, [pendingPuntniveau, drawingPoints]);

  return {
    handlePuntniveauClick,
    finishPuntniveauDrawing,
    updatePuntniveauPreview,
    cancelPuntniveauDrawing,
    getPuntniveauBasePoint,
    createPuntniveau,
    isPuntniveauDrawingActive: !!pendingPuntniveau,
    hasPoints: drawingPoints.length > 0,
    pointCount: drawingPoints.length,
  };
}
