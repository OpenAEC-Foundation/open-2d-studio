/**
 * useDetailLineDrawing - Handles detail line placement (two-click: start → end).
 *
 * A detail line is a line segment with a filled band of constant thickness,
 * rendered with a pattern (insulation, diagonal hatch, solid, etc.).
 *
 * Interaction:
 * - First click: set start point
 * - Second click: set end point, create the shape
 */

import { useCallback } from 'react';
import { useAppStore, generateId } from '../../state/appStore';
import type { Point, DetailLineShape, DetailLinePatternType } from '../../types/geometry';
import { BUILT_IN_DETAIL_LINE_TYPES } from '../../types/geometry';

/** Default thickness in mm when no type is selected */
const DEFAULT_THICKNESS = 50;

export function useDetailLineDrawing() {
  const {
    activeLayerId,
    activeDrawingId,
    currentStyle,
    addShape,
    addDrawingPoint,
    clearDrawingPoints,
    setDrawingPreview,
    drawingPoints,
  } = useAppStore();

  /**
   * Create a DetailLineShape from start to end with the given type settings.
   */
  const createDetailLine = useCallback(
    (start: Point, end: Point) => {
      const state = useAppStore.getState();
      // Resolve selected detail line type (if any)
      const typeId: string | undefined = state.selectedDetailLineTypeId;
      const allTypes = BUILT_IN_DETAIL_LINE_TYPES;
      const lineType = typeId ? allTypes.find(t => t.id === typeId) : BUILT_IN_DETAIL_LINE_TYPES[0];

      const shape: DetailLineShape = {
        id: generateId(),
        type: 'detail-line',
        layerId: activeLayerId,
        drawingId: activeDrawingId,
        style: { ...currentStyle },
        visible: true,
        locked: false,
        start,
        end,
        thickness: lineType?.thickness ?? DEFAULT_THICKNESS,
        detailLineTypeId: lineType?.id,
        patternType: (lineType?.patternType ?? 'insulation-nen47') as DetailLinePatternType,
        patternAngle: lineType?.patternAngle,
        patternScale: lineType?.patternScale,
        patternColor: lineType?.patternColor,
        backgroundColor: lineType?.backgroundColor,
      };

      addShape(shape);
    },
    [activeLayerId, activeDrawingId, currentStyle, addShape]
  );

  /**
   * Handle canvas click for detail-line tool.
   * First click: record start. Second click: create shape.
   */
  const handleDetailLineClick = useCallback(
    (snappedPos: Point): boolean => {
      if (drawingPoints.length === 0) {
        addDrawingPoint(snappedPos);
        return true;
      } else {
        const start = drawingPoints[0];
        const dx = Math.abs(snappedPos.x - start.x);
        const dy = Math.abs(snappedPos.y - start.y);
        if (dx > 1 || dy > 1) {
          createDetailLine(start, snappedPos);
        }
        clearDrawingPoints();
        setDrawingPreview(null);
        // Re-add new start point for chaining (matches line tool behavior)
        addDrawingPoint(snappedPos);
        return true;
      }
    },
    [drawingPoints, addDrawingPoint, clearDrawingPoints, setDrawingPreview, createDetailLine]
  );

  /**
   * Update drawing preview while mouse moves.
   */
  const updateDetailLinePreview = useCallback(
    (snappedPos: Point) => {
      if (drawingPoints.length === 0) return;
      setDrawingPreview({
        type: 'line',
        start: drawingPoints[0],
        end: snappedPos,
      } as any);
    },
    [drawingPoints, setDrawingPreview]
  );

  /**
   * Cancel detail-line drawing.
   */
  const cancelDetailLineDrawing = useCallback(() => {
    clearDrawingPoints();
    setDrawingPreview(null);
  }, [clearDrawingPoints, setDrawingPreview]);

  return {
    handleDetailLineClick,
    updateDetailLinePreview,
    cancelDetailLineDrawing,
  };
}
