/**
 * useLabelDrawing — Handles smart label annotation placement.
 *
 * Interaction (2-click workflow):
 *   Click 1: Click on a shape → that becomes the target shape.
 *   Click 2: Click where to place the label → creates the LabelShape with a leader line.
 *
 * If the user clicks on empty space on click 1, the label is placed as a free-standing
 * annotation at the next click (no target, no leader).
 */

import { useCallback, useRef } from 'react';
import { useAppStore, generateId } from '../../state/appStore';
import type { Point, LabelShape } from '../../types/geometry';
import { DEFAULT_LABEL_TYPES } from '../../types/geometry';
import {
  resolveLabel,
  getDefaultLabelTemplateForShape,
  getDefaultLabelUnit,
} from '../../engine/geometry/LabelUtils';

export function useLabelDrawing() {
  const {
    activeTool,
    activeLayerId,
    activeDrawingId,
    currentStyle,
    addShape,
    drawingPoints,
    addDrawingPoint,
    clearDrawingPoints,
    setDrawingPreview,
  } = useAppStore();

  // Store picked target shape ID between click 1 and click 2
  const targetShapeIdRef = useRef<string | null>(null);

  const isLabelActive = activeTool === 'label';

  /**
   * Click 1: User clicks on a shape (or empty space).
   * Stores the target shape ID and records the pick point.
   */
  const handleLabelTargetClick = useCallback(
    (clickPos: Point, findShapeAtPoint: (p: Point) => string | null) => {
      const shapeId = findShapeAtPoint(clickPos);
      targetShapeIdRef.current = shapeId;
      // Record the click point so we can draw a leader preview
      addDrawingPoint(clickPos);
    },
    [addDrawingPoint]
  );

  /**
   * Click 2: User clicks where to place the label.
   * Creates the LabelShape.
   */
  const handleLabelPlaceClick = useCallback(
    (labelPos: Point) => {
      const targetId = targetShapeIdRef.current;
      const { shapes } = useAppStore.getState();
      const target = targetId ? shapes.find(s => s.id === targetId) : undefined;

      // Determine template, unit, decimals from type preset or shape default
      let template = '{type}';
      let unit = '';
      let decimalPlaces = 0;
      let labelTypeId: string | undefined;

      // Check for active label type in store (future: selectedLabelTypeId)
      const selectedTypeId: string | undefined = (useAppStore.getState() as any).selectedLabelTypeId;
      const preset = selectedTypeId
        ? DEFAULT_LABEL_TYPES.find(lt => lt.id === selectedTypeId)
        : undefined;

      if (preset) {
        template = preset.template;
        unit = preset.unit;
        decimalPlaces = preset.decimalPlaces;
        labelTypeId = preset.id;
      } else if (target) {
        template = getDefaultLabelTemplateForShape(target);
        unit = getDefaultLabelUnit(target);
        // For area units use 2 decimal places, otherwise 0
        decimalPlaces = unit === 'm2' || unit === 'mm2' ? 2 : (unit === 'm' ? 2 : 0);
      }

      // Resolve display text
      const displayText = target
        ? resolveLabel(template, target, unit, decimalPlaces)
        : template;

      // Leader line: from label position back to pick point (click 1)
      const pickPoint = drawingPoints[0] ?? labelPos;
      const leaderPoints: Point[] = [pickPoint];

      const labelShape: LabelShape = {
        id: generateId(),
        type: 'label',
        layerId: activeLayerId,
        drawingId: activeDrawingId,
        style: { ...currentStyle },
        visible: true,
        locked: false,
        position: labelPos,
        targetShapeId: targetId ?? undefined,
        template,
        displayText,
        labelTypeId,
        textHeight: 250, // default 250 mm
        rotation: 0,
        showLeader: !!targetId,
        leaderPoints: targetId ? leaderPoints : undefined,
        arrowType: 'filled',
        arrowSize: 120,
        unit,
        decimalPlaces,
        prefix: preset?.prefix ?? '',
        suffix: preset?.suffix ?? '',
      };

      addShape(labelShape);

      // Reset
      targetShapeIdRef.current = null;
      clearDrawingPoints();
      setDrawingPreview(null);

      return true;
    },
    [
      activeLayerId, activeDrawingId, currentStyle,
      addShape, drawingPoints, clearDrawingPoints, setDrawingPreview,
    ]
  );

  /**
   * Unified click handler:
   * - First click (no drawingPoints): pick target
   * - Second click: place label
   */
  const handleLabelClick = useCallback(
    (clickPos: Point, findShapeAtPoint: (p: Point) => string | null) => {
      if (drawingPoints.length === 0) {
        handleLabelTargetClick(clickPos, findShapeAtPoint);
      } else {
        handleLabelPlaceClick(clickPos);
      }
    },
    [drawingPoints, handleLabelTargetClick, handleLabelPlaceClick]
  );

  /**
   * Update drawing preview during mouse move.
   */
  const updateLabelPreview = useCallback(
    (snappedPos: Point) => {
      if (drawingPoints.length === 0) return;

      // Show a preview leader line from pick point to current mouse position
      setDrawingPreview({
        type: 'leader',
        points: [...drawingPoints],
        currentPoint: snappedPos,
      });
    },
    [drawingPoints, setDrawingPreview]
  );

  /**
   * Cancel label placement.
   */
  const cancelLabelDrawing = useCallback(() => {
    targetShapeIdRef.current = null;
    clearDrawingPoints();
    setDrawingPreview(null);
  }, [clearDrawingPoints, setDrawingPreview]);

  return {
    handleLabelClick,
    updateLabelPreview,
    cancelLabelDrawing,
    isLabelActive,
    isPlacingLabel: isLabelActive && drawingPoints.length > 0,
  };
}
