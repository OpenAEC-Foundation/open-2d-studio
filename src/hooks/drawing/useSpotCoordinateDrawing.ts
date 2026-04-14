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

/** Default text height in drawing units (mm) */
const DEFAULT_TEXT_HEIGHT = 200;

/** Default leader length in drawing units (mm) */
const DEFAULT_LEADER_LENGTH = 800;

/** Default leader angle in radians (45 degrees, upper-right) */
const DEFAULT_LEADER_ANGLE = -Math.PI / 4;

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
   */
  const createSpotCoordinate = useCallback(
    (position: Point) => {
      const { unitSettings } = useAppStore.getState();
      const unit: 'mm' | 'm' = (unitSettings?.lengthUnit === 'm' ? 'm' : 'mm') as 'mm' | 'm';
      const decimalPlaces = unit === 'm' ? 3 : 0;

      // Convert to display units
      const displayX = unit === 'm' ? position.x / 1000 : position.x;
      const displayY = unit === 'm' ? (-position.y) / 1000 : -position.y; // negate Y: canvas Y is down

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
        textHeight: DEFAULT_TEXT_HEIGHT,
        leaderLength: DEFAULT_LEADER_LENGTH,
        leaderAngle: DEFAULT_LEADER_ANGLE,
        showLeader: true,
        decimalPlaces,
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
