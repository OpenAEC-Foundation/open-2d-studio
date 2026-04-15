/**
 * useLShapeDrawing - Places an L-shaped closed polyline on a single click.
 *
 * The L-shape has 6 vertices defined by 4 parameters:
 *   width      – total horizontal extent
 *   height     – total vertical extent
 *   legWidth   – thickness of the vertical leg (left side)
 *   legHeight  – thickness of the horizontal leg (bottom)
 *
 * Vertex layout (origin = bottom-left corner of bounding box):
 *   0: (0, 0)
 *   1: (width, 0)
 *   2: (width, legHeight)
 *   3: (legWidth, legHeight)
 *   4: (legWidth, height)
 *   5: (0, height)
 *   → close
 *
 * The click point becomes the bottom-left corner of the bounding box.
 */

import { useCallback } from 'react';
import { useAppStore, generateId } from '../../state/appStore';
import type { Point, PolylineShape } from '../../types/geometry';

export function useLShapeDrawing() {
  const {
    activeLayerId,
    activeDrawingId,
    currentStyle,
    addShape,
    setDrawingPreview,
  } = useAppStore();

  const createLShape = useCallback(
    (origin: Point) => {
      const state = useAppStore.getState();
      const w = state.lShapeWidth;
      const h = state.lShapeHeight;
      const lw = state.lShapeLegWidth;
      const lh = state.lShapeLegHeight;

      // Clamp legs so they don't exceed overall dimensions
      const legW = Math.min(Math.max(lw, 1), w - 1);
      const legH = Math.min(Math.max(lh, 1), h - 1);

      const pts: Point[] = [
        { x: origin.x,        y: origin.y },
        { x: origin.x + w,    y: origin.y },
        { x: origin.x + w,    y: origin.y + legH },
        { x: origin.x + legW, y: origin.y + legH },
        { x: origin.x + legW, y: origin.y + h },
        { x: origin.x,        y: origin.y + h },
      ];

      const shape: PolylineShape = {
        id: generateId(),
        type: 'polyline',
        layerId: activeLayerId,
        drawingId: activeDrawingId,
        style: { ...currentStyle },
        visible: true,
        locked: false,
        points: pts,
        closed: true,
      };

      addShape(shape);
    },
    [activeLayerId, activeDrawingId, currentStyle, addShape]
  );

  const handleLShapeClick = useCallback(
    (snappedPos: Point): boolean => {
      createLShape(snappedPos);
      // No chaining — each click places a new L-shape immediately
      setDrawingPreview(null);
      return true;
    },
    [createLShape, setDrawingPreview]
  );

  const updateLShapePreview = useCallback(
    (snappedPos: Point) => {
      const state = useAppStore.getState();
      const w = state.lShapeWidth;
      const h = state.lShapeHeight;
      const lw = Math.min(Math.max(state.lShapeLegWidth, 1), w - 1);
      const lh = Math.min(Math.max(state.lShapeLegHeight, 1), h - 1);
      const o = snappedPos;

      const pts: Point[] = [
        { x: o.x,      y: o.y },
        { x: o.x + w,  y: o.y },
        { x: o.x + w,  y: o.y + lh },
        { x: o.x + lw, y: o.y + lh },
        { x: o.x + lw, y: o.y + h },
        { x: o.x,      y: o.y + h },
      ];

      setDrawingPreview({
        type: 'polyline',
        points: pts,
        closed: true,
      } as any);
    },
    [setDrawingPreview]
  );

  const cancelLShapeDrawing = useCallback(() => {
    setDrawingPreview(null);
  }, [setDrawingPreview]);

  return {
    handleLShapeClick,
    updateLShapePreview,
    cancelLShapeDrawing,
  };
}
