/**
 * usePanZoom - Handles pan and zoom interactions
 */

import { useCallback, useRef, useState } from 'react';
import { useAppStore } from '../../state/appStore';
import type { Point } from '../../types/geometry';

interface PanState {
  isPanning: boolean;
  startPoint: Point;
  button: number;
}

export function usePanZoom(canvasRef: React.RefObject<HTMLCanvasElement>) {
  const panState = useRef<PanState>({
    isPanning: false,
    startPoint: { x: 0, y: 0 },
    button: 0,
  });

  const [isPanning, setIsPanning] = useState(false);

  const { viewport, setViewport, activeTool } = useAppStore();

  /**
   * Get mouse position from event
   */
  const getMousePos = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>): Point => {
      const canvas = canvasRef.current;
      if (!canvas) return { x: 0, y: 0 };
      const rect = canvas.getBoundingClientRect();
      return {
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
      };
    },
    [canvasRef]
  );

  /**
   * Start panning
   */
  const startPan = useCallback(
    (screenPos: Point, button: number) => {
      panState.current = {
        isPanning: true,
        startPoint: screenPos,
        button,
      };
      setIsPanning(true);
    },
    []
  );

  /**
   * Check if should start pan (middle mouse or pan tool)
   */
  const shouldStartPan = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>): boolean => {
      return e.button === 1 || (e.button === 0 && activeTool === 'pan');
    },
    [activeTool]
  );

  /**
   * Handle mouse down for pan
   */
  const handlePanMouseDown = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>): boolean => {
      if (shouldStartPan(e)) {
        const screenPos = getMousePos(e);
        startPan(screenPos, e.button);
        return true;
      }
      return false;
    },
    [shouldStartPan, getMousePos, startPan]
  );

  /**
   * Handle mouse move for pan
   */
  const handlePanMouseMove = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>): boolean => {
      if (!panState.current.isPanning) return false;

      const screenPos = getMousePos(e);
      const delta = {
        x: screenPos.x - panState.current.startPoint.x,
        y: screenPos.y - panState.current.startPoint.y,
      };
      panState.current.startPoint = screenPos;

      setViewport({
        offsetX: viewport.offsetX + delta.x,
        offsetY: viewport.offsetY + delta.y,
      });
      return true;
    },
    [getMousePos, viewport, setViewport]
  );

  /**
   * Handle mouse up for pan
   */
  const handlePanMouseUp = useCallback((): boolean => {
    const wasPanning = panState.current.isPanning;
    panState.current.isPanning = false;
    setIsPanning(false);
    return wasPanning;
  }, []);

  /**
   * Handle mouse wheel for zoom
   */
  const handleWheel = useCallback(
    (e: React.WheelEvent<HTMLCanvasElement>) => {
      e.preventDefault();

      const screenPos = getMousePos(e);

      // Zoom factor
      const zoomFactor = e.deltaY > 0 ? 0.9 : 1.1;
      const newZoom = Math.min(Math.max(viewport.zoom * zoomFactor, 0.0001), 100);

      // Zoom towards cursor position
      const worldX = (screenPos.x - viewport.offsetX) / viewport.zoom;
      const worldY = (screenPos.y - viewport.offsetY) / viewport.zoom;

      const newOffsetX = screenPos.x - worldX * newZoom;
      const newOffsetY = screenPos.y - worldY * newZoom;

      setViewport({
        zoom: newZoom,
        offsetX: newOffsetX,
        offsetY: newOffsetY,
      });
    },
    [getMousePos, viewport, setViewport]
  );

  /**
   * Check if currently panning
   */
  const getIsPanning = useCallback(() => panState.current.isPanning, []);

  return {
    isPanning,
    getIsPanning,
    handlePanMouseDown,
    handlePanMouseMove,
    handlePanMouseUp,
    handleWheel,
    getMousePos,
  };
}
