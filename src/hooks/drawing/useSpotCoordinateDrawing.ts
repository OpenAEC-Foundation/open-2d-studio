/**
 * useSpotCoordinateDrawing - Handles spot coordinate annotation placement.
 *
 * Interaction:
 * - Single click places a SpotCoordinateShape at the clicked world coordinate.
 * - The X and Y world coordinates are automatically populated from the click position.
 * - Y is negated for display (canvas Y is inverted; positive Y = upward in building coords).
 * - Default unit follows the project unit settings.
 */

import { useCallback } from 'react';
import { useAppStore, generateId } from '../../state/appStore';
import type { Point, SpotCoordinateShape } from '../../types/geometry';
import { SPOT_COORDINATE_TYPE_PRESETS, DEFAULT_SPOT_COORDINATE_STYLE } from '../../types/geometry';

export function useSpotCoordinateDrawing() {
  const {
    activeLayerId,
    activeDrawingId,
    currentStyle,
    addShape,
    setDrawingPreview,
  } = useAppStore();

  /**
   * Create a SpotCoordinateShape at the given world position.
   * displayX / displayY are set from the world coords (Y negated for display).
   * Style defaults are resolved from the active SpotCoordinateType preset (if any).
   */
  const createSpotCoordinate = useCallback(
    (position: Point) => {
      const state = useAppStore.getState();
      const { unitSettings } = state;

      // Resolve active type preset
      const typeId: string | undefined = (state as any).selectedSpotCoordinateTypeId;
      const preset = typeId
        ? SPOT_COORDINATE_TYPE_PRESETS.find(p => p.id === typeId)
        : SPOT_COORDINATE_TYPE_PRESETS[0];
      const style = preset?.style ?? DEFAULT_SPOT_COORDINATE_STYLE;

      // Unit: prefer type style, fall back to project unit
      const unit: 'mm' | 'm' = style.unit ?? (unitSettings?.lengthUnit === 'm' ? 'm' : 'mm');
      const decimalPlaces = style.decimalPlaces ?? (unit === 'm' ? 3 : 0);

      // Convert to display units
      const displayX = unit === 'm' ? position.x / 1000 : position.x;
      const displayY = unit === 'm' ? (-position.y) / 1000 : -position.y;

      const shape: SpotCoordinateShape = {
        id: generateId(),
        type: 'spot-coordinate',
        layerId: activeLayerId,
        drawingId: activeDrawingId,
        style: { ...currentStyle },
        visible: true,
        locked: false,
        position,
        displayX,
        displayY,
        unit,
        textHeight: style.textHeight,
        leaderLength: style.leaderLength,
        leaderAngle: style.leaderAngle,
        showLeader: style.showLeader,
        decimalPlaces,
        prefix: style.prefix,
        spotCoordinateTypeId: preset?.id,
        arrowType: style.arrowType,
        arrowSize: style.arrowSize,
        lineColor: style.lineColor,
        textColor: style.textColor,
      };

      addShape(shape);
    },
    [activeLayerId, activeDrawingId, currentStyle, addShape]
  );

  /**
   * Handle canvas click for spot-coordinate tool.
   * Places a coordinate annotation at the click point.
   */
  const handleSpotCoordinateClick = useCallback(
    (snappedPos: Point) => {
      createSpotCoordinate(snappedPos);
      setDrawingPreview(null);
    },
    [createSpotCoordinate, setDrawingPreview]
  );

  /**
   * Update drawing preview (shows a small cross at the current mouse position).
   */
  const updateSpotCoordinatePreview = useCallback(
    (snappedPos: Point) => {
      setDrawingPreview({
        type: 'spot-coordinate',
        position: snappedPos,
      });
    },
    [setDrawingPreview]
  );

  /**
   * Cancel spot-coordinate drawing (no-op for single-click tool).
   */
  const cancelSpotCoordinateDrawing = useCallback(() => {
    setDrawingPreview(null);
  }, [setDrawingPreview]);

  return {
    handleSpotCoordinateClick,
    updateSpotCoordinatePreview,
    cancelSpotCoordinateDrawing,
    createSpotCoordinate,
  };
}
