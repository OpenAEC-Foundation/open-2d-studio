import { useEffect, useRef } from 'react';
import { useAppStore } from '../../state/appStore';

/** Max distance (px) between two taps to count as a double-tap */
const DOUBLE_TAP_RADIUS = 40;

interface TouchState {
  /** Active touch points by identifier */
  touches: Map<number, { x: number; y: number }>;
  /** Timestamp of last tap (for double-tap detection) */
  lastTapTime: number;
  /** Position of last tap (for double-tap distance check) */
  lastTapPos: { x: number; y: number };
  /** Whether we're in a pinch gesture */
  isPinching: boolean;
  /** Previous distance between two fingers */
  prevPinchDist: number;
  /** Previous midpoint between two fingers */
  prevMidpoint: { x: number; y: number };
}

function getDistance(a: { x: number; y: number }, b: { x: number; y: number }): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

function getMidpoint(a: { x: number; y: number }, b: { x: number; y: number }): { x: number; y: number } {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

export function useTouchGestures(canvasRef: React.RefObject<HTMLCanvasElement | null>) {
  const stateRef = useRef<TouchState>({
    touches: new Map(),
    lastTapTime: 0,
    lastTapPos: { x: 0, y: 0 },
    isPinching: false,
    prevPinchDist: 0,
    prevMidpoint: { x: 0, y: 0 },
  });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ts = stateRef.current;

    const handleTouchStart = (e: TouchEvent) => {
      e.preventDefault();

      for (let i = 0; i < e.changedTouches.length; i++) {
        const t = e.changedTouches[i];
        ts.touches.set(t.identifier, { x: t.clientX, y: t.clientY });
      }

      if (ts.touches.size === 2) {
        const pts = Array.from(ts.touches.values());
        ts.isPinching = true;
        ts.prevPinchDist = getDistance(pts[0], pts[1]);
        ts.prevMidpoint = getMidpoint(pts[0], pts[1]);
      }
    };

    const handleTouchMove = (e: TouchEvent) => {
      e.preventDefault();

      const { viewport, setViewport } = useAppStore.getState();

      // 1-finger drag → pan (read previous position BEFORE updating the map)
      if (ts.touches.size === 1 && !ts.isPinching && e.changedTouches.length === 1) {
        const t = e.changedTouches[0];
        const prev = ts.touches.get(t.identifier);
        if (prev) {
          setViewport({
            offsetX: viewport.offsetX + (t.clientX - prev.x),
            offsetY: viewport.offsetY + (t.clientY - prev.y),
          });
        }
      }

      // Update stored positions with current values
      for (let i = 0; i < e.changedTouches.length; i++) {
        const t = e.changedTouches[i];
        ts.touches.set(t.identifier, { x: t.clientX, y: t.clientY });
      }

      // 2-finger pinch → zoom toward midpoint + pan (uses updated positions)
      if (ts.touches.size === 2 && ts.isPinching) {
        const pts = Array.from(ts.touches.values());
        const dist = getDistance(pts[0], pts[1]);
        const mid = getMidpoint(pts[0], pts[1]);

        if (ts.prevPinchDist > 0) {
          const zoomFactor = dist / ts.prevPinchDist;
          const newZoom = Math.min(Math.max(viewport.zoom * zoomFactor, 0.001), 100);

          // Zoom toward midpoint (same math as usePanZoom wheel handler)
          const worldX = (mid.x - viewport.offsetX) / viewport.zoom;
          const worldY = (mid.y - viewport.offsetY) / viewport.zoom;

          const newOffsetX = mid.x - worldX * newZoom;
          const newOffsetY = mid.y - worldY * newZoom;

          // Also apply pan delta from midpoint movement
          const panDx = mid.x - ts.prevMidpoint.x;
          const panDy = mid.y - ts.prevMidpoint.y;

          setViewport({
            zoom: newZoom,
            offsetX: newOffsetX + panDx,
            offsetY: newOffsetY + panDy,
          });
        }

        ts.prevPinchDist = dist;
        ts.prevMidpoint = mid;
      }
    };

    const handleTouchEnd = (e: TouchEvent) => {
      e.preventDefault();

      const wasOneFinger = ts.touches.size === 1 && !ts.isPinching;

      for (let i = 0; i < e.changedTouches.length; i++) {
        ts.touches.delete(e.changedTouches[i].identifier);
      }

      // Double-tap detection (single finger, quick release, close proximity)
      if (wasOneFinger && ts.touches.size === 0 && e.changedTouches.length === 1) {
        const t = e.changedTouches[0];
        const now = Date.now();
        const tapPos = { x: t.clientX, y: t.clientY };

        if (now - ts.lastTapTime < 300 && getDistance(tapPos, ts.lastTapPos) < DOUBLE_TAP_RADIUS) {
          useAppStore.getState().zoomToFit();
          ts.lastTapTime = 0;
        } else {
          ts.lastTapTime = now;
          ts.lastTapPos = tapPos;
        }
      }

      if (ts.touches.size < 2) {
        ts.isPinching = false;
        ts.prevPinchDist = 0;
      }
    };

    const handleTouchCancel = (e: TouchEvent) => {
      for (let i = 0; i < e.changedTouches.length; i++) {
        ts.touches.delete(e.changedTouches[i].identifier);
      }
      ts.isPinching = false;
      ts.prevPinchDist = 0;
    };

    canvas.addEventListener('touchstart', handleTouchStart, { passive: false });
    canvas.addEventListener('touchmove', handleTouchMove, { passive: false });
    canvas.addEventListener('touchend', handleTouchEnd, { passive: false });
    canvas.addEventListener('touchcancel', handleTouchCancel, { passive: false });

    return () => {
      canvas.removeEventListener('touchstart', handleTouchStart);
      canvas.removeEventListener('touchmove', handleTouchMove);
      canvas.removeEventListener('touchend', handleTouchEnd);
      canvas.removeEventListener('touchcancel', handleTouchCancel);
    };
  }, [canvasRef]);
}
