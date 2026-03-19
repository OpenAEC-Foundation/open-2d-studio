/**
 * useSlabLabelDrawing - Handles slab label placement (single click)
 */

import { useCallback } from 'react';
import { useAppStore, generateId } from '../../state/appStore';
import type { Point, SlabLabelShape } from '../../types/geometry';

export function useSlabLabelDrawing() {
  const {
    activeLayerId,
    activeDrawingId,
    currentStyle,
    addShape,
    setDrawingPreview,
    pendingSlabLabel,
    clearPendingSlabLabel,
  } = useAppStore();

  /**
   * Create a slab label shape at a given position
   */
  const createSlabLabel = useCallback(
    (position: Point) => {
      if (!pendingSlabLabel) return;

      const slabLabelShape: SlabLabelShape = {
        id: generateId(),
        type: 'slab-label',
        layerId: activeLayerId,
        drawingId: activeDrawingId,
        style: { ...currentStyle },
        visible: true,
        locked: false,
        position,
        thickness: pendingSlabLabel.thickness,
        fontSize: pendingSlabLabel.fontSize,
        linkedSlabId: pendingSlabLabel.linkedSlabId,
      };
      addShape(slabLabelShape);
      return slabLabelShape.id;
    },
    [activeLayerId, activeDrawingId, currentStyle, addShape, pendingSlabLabel]
  );

  /**
   * Handle click for slab label placement
   */
  const handleSlabLabelClick = useCallback(
    (snappedPos: Point) => {
      if (!pendingSlabLabel) return false;

      createSlabLabel(snappedPos);

      // Keep pendingSlabLabel active so user can place multiple labels
      return true;
    },
    [pendingSlabLabel, createSlabLabel]
  );

  /**
   * Update slab label preview
   */
  const updateSlabLabelPreview = useCallback(
    (snappedPos: Point) => {
      if (!pendingSlabLabel) return;

      setDrawingPreview({
        type: 'slab-label',
        position: snappedPos,
        thickness: pendingSlabLabel.thickness,
        fontSize: pendingSlabLabel.fontSize,
        linkedSlabId: pendingSlabLabel.linkedSlabId,
      });
    },
    [pendingSlabLabel, setDrawingPreview]
  );

  /**
   * Cancel slab label placement
   */
  const cancelSlabLabelDrawing = useCallback(() => {
    setDrawingPreview(null);
    clearPendingSlabLabel();
  }, [setDrawingPreview, clearPendingSlabLabel]);

  return {
    handleSlabLabelClick,
    updateSlabLabelPreview,
    cancelSlabLabelDrawing,
    createSlabLabel,
    isSlabLabelDrawingActive: !!pendingSlabLabel,
  };
}
