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
import { snapToAngle } from '../../engine/geometry/GeometryUtils';

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
        justification: state.detailLineJustification,
        ifcClass: 'IfcBuildingElementProxy',
      };

      addShape(shape);
    },
    [activeLayerId, activeDrawingId, currentStyle, addShape]
  );

  /**
   * Handle canvas click for detail-line tool.
   * First click: record start. Second click: create shape.
   * With chain mode on, automatically starts the next segment from the endpoint.
   * shiftKey (= orthoMode) constrains the endpoint to 45° increments.
   */
  const handleDetailLineClick = useCallback(
    (snappedPos: Point, shiftKey: boolean = false): boolean => {
      const chainMode = useAppStore.getState().chainMode;

      if (drawingPoints.length === 0) {
        addDrawingPoint(snappedPos);
        return true;
      } else {
        const start = drawingPoints[0];
        const finalPos = shiftKey ? snapToAngle(start, snappedPos) : snappedPos;
        const dx = Math.abs(finalPos.x - start.x);
        const dy = Math.abs(finalPos.y - start.y);
        if (dx > 1 || dy > 1) {
          createDetailLine(start, finalPos);
        }
        clearDrawingPoints();
        setDrawingPreview(null);
        if (chainMode) {
          // Continue drawing from the endpoint (chain mode — like walls)
          addDrawingPoint(finalPos);
        }
        return true;
      }
    },
    [drawingPoints, addDrawingPoint, clearDrawingPoints, setDrawingPreview, createDetailLine]
  );

  /**
   * Update drawing preview while mouse moves.
   * shiftKey (= orthoMode) constrains the preview endpoint to 45° increments.
   * Shows the full thickness band (not just centerline) so the user sees
   * the exact shape that will be placed.
   */
  const updateDetailLinePreview = useCallback(
    (snappedPos: Point, shiftKey: boolean = false) => {
      if (drawingPoints.length === 0) return;

      const startPoint = drawingPoints[0];
      const previewPos = shiftKey ? snapToAngle(startPoint, snappedPos) : snappedPos;

      // Resolve current detail line type settings for the preview
      const state = useAppStore.getState();
      const typeId = state.selectedDetailLineTypeId;
      const lineType = typeId
        ? BUILT_IN_DETAIL_LINE_TYPES.find(t => t.id === typeId)
        : BUILT_IN_DETAIL_LINE_TYPES[0];

      setDrawingPreview({
        type: 'detail-line',
        start: startPoint,
        end: previewPos,
        thickness: lineType?.thickness ?? DEFAULT_THICKNESS,
        patternType: lineType?.patternType ?? 'insulation-nen47',
        patternAngle: lineType?.patternAngle,
        patternScale: lineType?.patternScale,
        patternColor: lineType?.patternColor,
        backgroundColor: lineType?.backgroundColor,
        justification: state.detailLineJustification ?? 'center',
      });
    },
    [drawingPoints, setDrawingPreview]
  );

  /**
   * Get the base point for snap tracking (first click point).
   */
  const getDetailLineBasePoint = useCallback((): Point | null => {
    if (drawingPoints.length === 0) return null;
    return drawingPoints[0];
  }, [drawingPoints]);

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
    getDetailLineBasePoint,
    hasFirstPoint: drawingPoints.length > 0,
  };
}
