/**
 * useColumnDrawing - Handles column placement (single click, like pile)
 */

import { useCallback } from 'react';
import { useAppStore, generateId } from '../../state/appStore';
import type { Point, ColumnShape } from '../../types/geometry';

export function useColumnDrawing() {
  const {
    activeLayerId,
    activeDrawingId,
    currentStyle,
    addShape,
    setDrawingPreview,
    pendingColumn,
    clearPendingColumn,
  } = useAppStore();

  /**
   * Create a column shape at a given position
   */
  const createColumn = useCallback(
    (position: Point, width: number, depth: number, rotation: number, material: ColumnShape['material'], extra?: { profile?: string; section?: string; baseLevel?: string; topLevel?: string; baseOffset?: number; topOffset?: number }) => {
      const columnShape: ColumnShape = {
        id: generateId(),
        type: 'column',
        layerId: activeLayerId,
        drawingId: activeDrawingId,
        style: { ...currentStyle },
        visible: true,
        locked: false,
        position,
        width,
        depth,
        rotation,
        material,
        ...(extra?.profile != null && { profile: extra.profile }),
        ...(extra?.section != null && { section: extra.section }),
        ...(extra?.baseLevel != null && { baseLevel: extra.baseLevel }),
        ...(extra?.topLevel != null && { topLevel: extra.topLevel }),
        ...(extra?.baseOffset != null && { baseOffset: extra.baseOffset }),
        ...(extra?.topOffset != null && { topOffset: extra.topOffset }),
      };
      addShape(columnShape);
      return columnShape.id;
    },
    [activeLayerId, activeDrawingId, currentStyle, addShape]
  );

  /**
   * Handle click for column placement
   */
  const handleColumnClick = useCallback(
    (snappedPos: Point) => {
      if (!pendingColumn) return false;

      createColumn(
        snappedPos,
        pendingColumn.width,
        pendingColumn.depth,
        pendingColumn.rotation,
        pendingColumn.material,
        {
          profile: pendingColumn.profile,
          section: pendingColumn.section,
          baseLevel: pendingColumn.baseLevel,
          topLevel: pendingColumn.topLevel,
          baseOffset: pendingColumn.baseOffset,
          topOffset: pendingColumn.topOffset,
        },
      );

      // Keep pendingColumn active so user can place multiple columns
      return true;
    },
    [pendingColumn, createColumn]
  );

  /**
   * Update column preview
   */
  const updateColumnPreview = useCallback(
    (snappedPos: Point) => {
      if (!pendingColumn) return;

      setDrawingPreview({
        type: 'column',
        position: snappedPos,
        width: pendingColumn.width,
        depth: pendingColumn.depth,
        rotation: pendingColumn.rotation,
        material: pendingColumn.material,
      });
    },
    [pendingColumn, setDrawingPreview]
  );

  /**
   * Cancel column placement
   */
  const cancelColumnDrawing = useCallback(() => {
    setDrawingPreview(null);
    clearPendingColumn();
  }, [setDrawingPreview, clearPendingColumn]);

  return {
    handleColumnClick,
    updateColumnPreview,
    cancelColumnDrawing,
    createColumn,
    isColumnDrawingActive: !!pendingColumn,
  };
}
