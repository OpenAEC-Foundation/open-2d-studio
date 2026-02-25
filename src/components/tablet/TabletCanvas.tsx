import { useRef, useEffect, useCallback } from 'react';
import { useAppStore } from '../../state/appStore';
import { CADRenderer } from '../../engine/renderer/CADRenderer';
import { useTouchGestures } from '../../hooks/touch/useTouchGestures';
import { screenToWorld } from '../../engine/geometry/GeometryUtils';

interface TabletCanvasProps {
  /** When set, single taps call this with world coords instead of initiating a pan. */
  onCanvasTap?: (worldX: number, worldY: number, screenX: number, screenY: number) => void;
  /** Called on long-press (500ms hold, <10px movement). */
  onLongPress?: (screenX: number, screenY: number, worldX: number, worldY: number) => void;
  /** Called when a shape is tapped. */
  onShapeTap?: (shapeId: string, screenX: number, screenY: number) => void;
  /** Grid visible override from TabletApp */
  gridVisible?: boolean;
  /** White background for light theme */
  whiteBackground?: boolean;
}

/** Max pixel movement allowed for a click/tap to count as a "tap" (not a drag). */
const TAP_THRESHOLD = 5;
const LONG_PRESS_MS = 500;
const LONG_PRESS_MOVE_THRESHOLD = 10;

export function TabletCanvas({ onCanvasTap, onLongPress, onShapeTap, gridVisible = false, whiteBackground = false }: TabletCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<CADRenderer | null>(null);
  const onCanvasTapRef = useRef(onCanvasTap);
  onCanvasTapRef.current = onCanvasTap;
  const onLongPressRef = useRef(onLongPress);
  onLongPressRef.current = onLongPress;
  const onShapeTapRef = useRef(onShapeTap);
  onShapeTapRef.current = onShapeTap;
  const gridVisibleRef = useRef(gridVisible);
  gridVisibleRef.current = gridVisible;
  const whiteBackgroundRef = useRef(whiteBackground);
  whiteBackgroundRef.current = whiteBackground;

  const setCanvasSize = useAppStore(s => s.setCanvasSize);

  // Initialize renderer
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    rendererRef.current = new CADRenderer(canvas);

    return () => {
      rendererRef.current?.dispose();
    };
  }, []);

  // Handle resize
  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;

    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        canvas.width = width * window.devicePixelRatio;
        canvas.height = height * window.devicePixelRatio;
        canvas.style.width = `${width}px`;
        canvas.style.height = `${height}px`;
        setCanvasSize({ width, height });
        rendererRef.current?.resize(width, height);
      }
    });

    resizeObserver.observe(container);
    return () => resizeObserver.disconnect();
  }, [setCanvasSize]);

  // rAF render loop
  useEffect(() => {
    const renderer = rendererRef.current;
    if (!renderer) return;

    let rafId = 0;
    let dirty = true;

    const unsub = useAppStore.subscribe(() => { dirty = true; });

    renderer.setOnImageLoadCallback(() => { dirty = true; });

    let renderErrorLogged = false;

    const tick = () => {
      if (dirty) {
        dirty = false;

        try {
          const s = useAppStore.getState();
          const filteredShapes = s.shapes.filter(shape => shape.drawingId === s.activeDrawingId);
          const filteredParametricShapes = s.parametricShapes.filter(shape => shape.drawingId === s.activeDrawingId);
          const activeDrawing = s.drawings.find(d => d.id === s.activeDrawingId) || null;

          renderer.render({
            shapes: filteredShapes,
            parametricShapes: filteredParametricShapes,
            selectedShapeIds: s.selectedShapeIds,
            hoveredShapeId: s.hoveredShapeId,
            viewport: s.viewport,
            drawingScale: activeDrawing?.scale,
            gridVisible: gridVisibleRef.current,
            gridSize: s.gridSize,
            hideSelectionHandles: true,
            whiteBackground: whiteBackgroundRef.current,
            currentSnapPoint: s.currentSnapPoint,
            customPatterns: {
              userPatterns: s.userPatterns,
              projectPatterns: s.projectPatterns,
            },
            showLineweight: s.showLineweight,
            wallTypes: s.wallTypes,
            wallSystemTypes: s.wallSystemTypes,
            materialHatchSettings: s.materialHatchSettings,
            gridlineExtension: s.gridlineExtension,
            seaLevelDatum: s.projectStructure?.seaLevelDatum ?? 0,
            hiddenIfcCategories: s.hiddenIfcCategories ?? [],
            unitSettings: s.unitSettings,
          });
        } catch (err) {
          if (!renderErrorLogged) {
            console.error('[TabletCanvas] Render error:', err);
            renderErrorLogged = true;
          }
        }
      }
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(rafId);
      unsub();
      renderer.setOnImageLoadCallback(null);
    };
  }, []);

  // Mark dirty when gridVisible or whiteBackground prop changes
  useEffect(() => {
    gridVisibleRef.current = gridVisible;
    whiteBackgroundRef.current = whiteBackground;
    // Force a re-render on next frame by triggering the store subscription
    // (No direct flag access, but the rAF loop will pick it up from the refs)
  }, [gridVisible, whiteBackground]);

  // Touch gestures for pan, zoom, double-tap-to-fit
  useTouchGestures(canvasRef);

  // Long-press + tap detection (touch)
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let touchStartX = 0;
    let touchStartY = 0;
    let longPressTimer: ReturnType<typeof setTimeout> | null = null;
    let longPressFired = false;

    const clearLongPress = () => {
      if (longPressTimer) {
        clearTimeout(longPressTimer);
        longPressTimer = null;
      }
    };

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 1) {
        touchStartX = e.touches[0].clientX;
        touchStartY = e.touches[0].clientY;
        longPressFired = false;

        clearLongPress();
        longPressTimer = setTimeout(() => {
          longPressFired = true;
          if (onLongPressRef.current) {
            const rect = canvas.getBoundingClientRect();
            const sx = touchStartX - rect.left;
            const sy = touchStartY - rect.top;
            const { viewport } = useAppStore.getState();
            const world = screenToWorld(sx, sy, viewport);
            onLongPressRef.current(touchStartX, touchStartY, world.x, world.y);
          }
        }, LONG_PRESS_MS);
      } else {
        clearLongPress();
      }
    };

    const onTouchMove = (e: TouchEvent) => {
      if (e.touches.length === 1 && longPressTimer) {
        const dx = e.touches[0].clientX - touchStartX;
        const dy = e.touches[0].clientY - touchStartY;
        if (Math.sqrt(dx * dx + dy * dy) > LONG_PRESS_MOVE_THRESHOLD) {
          clearLongPress();
        }
      }
    };

    const onTouchEnd = (e: TouchEvent) => {
      clearLongPress();
      if (longPressFired) return; // Don't fire tap after long-press

      if (e.changedTouches.length === 1 && e.touches.length === 0) {
        const t = e.changedTouches[0];
        const dx = t.clientX - touchStartX;
        const dy = t.clientY - touchStartY;
        if (Math.sqrt(dx * dx + dy * dy) <= TAP_THRESHOLD) {
          const rect = canvas.getBoundingClientRect();
          const sx = t.clientX - rect.left;
          const sy = t.clientY - rect.top;
          const { viewport } = useAppStore.getState();
          const world = screenToWorld(sx, sy, viewport);

          if (onCanvasTapRef.current) {
            onCanvasTapRef.current(world.x, world.y, t.clientX, t.clientY);
          }
        }
      }
    };

    canvas.addEventListener('touchstart', onTouchStart, { passive: true });
    canvas.addEventListener('touchmove', onTouchMove, { passive: true });
    canvas.addEventListener('touchend', onTouchEnd, { passive: true });
    return () => {
      clearLongPress();
      canvas.removeEventListener('touchstart', onTouchStart);
      canvas.removeEventListener('touchmove', onTouchMove);
      canvas.removeEventListener('touchend', onTouchEnd);
    };
  }, []);

  // Mouse click tap detection (browser testing)
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let mouseDownX = 0;
    let mouseDownY = 0;

    const onDown = (e: MouseEvent) => {
      mouseDownX = e.clientX;
      mouseDownY = e.clientY;
    };

    const onUp = (e: MouseEvent) => {
      const dx = e.clientX - mouseDownX;
      const dy = e.clientY - mouseDownY;
      if (Math.sqrt(dx * dx + dy * dy) <= TAP_THRESHOLD) {
        const rect = canvas.getBoundingClientRect();
        const sx = e.clientX - rect.left;
        const sy = e.clientY - rect.top;
        const { viewport } = useAppStore.getState();
        const world = screenToWorld(sx, sy, viewport);

        if (onCanvasTapRef.current) {
          onCanvasTapRef.current(world.x, world.y, e.clientX, e.clientY);
        }
      }
    };

    canvas.addEventListener('mousedown', onDown);
    canvas.addEventListener('mouseup', onUp);
    return () => {
      canvas.removeEventListener('mousedown', onDown);
      canvas.removeEventListener('mouseup', onUp);
    };
  }, []);

  // Mouse right-click for long-press (browser testing)
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const onContextMenu = (e: MouseEvent) => {
      e.preventDefault();
      if (onLongPressRef.current) {
        const rect = canvas.getBoundingClientRect();
        const sx = e.clientX - rect.left;
        const sy = e.clientY - rect.top;
        const { viewport } = useAppStore.getState();
        const world = screenToWorld(sx, sy, viewport);
        onLongPressRef.current(e.clientX, e.clientY, world.x, world.y);
      }
    };

    canvas.addEventListener('contextmenu', onContextMenu);
    return () => canvas.removeEventListener('contextmenu', onContextMenu);
  }, []);

  // Mouse wheel zoom (for browser testing + tablets with mouse peripherals)
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const screenX = e.clientX - rect.left;
      const screenY = e.clientY - rect.top;

      const { viewport, setViewport } = useAppStore.getState();
      const zoomFactor = e.deltaY > 0 ? 0.9 : 1.1;
      const newZoom = Math.min(Math.max(viewport.zoom * zoomFactor, 0.001), 100);

      const worldX = (screenX - viewport.offsetX) / viewport.zoom;
      const worldY = (screenY - viewport.offsetY) / viewport.zoom;

      setViewport({
        zoom: newZoom,
        offsetX: screenX - worldX * newZoom,
        offsetY: screenY - worldY * newZoom,
      });
    };

    canvas.addEventListener('wheel', handleWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', handleWheel);
  }, []);

  // Mouse drag to pan (for browser testing + tablets with mouse peripherals)
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let dragging = false;
    let lastX = 0;
    let lastY = 0;

    const onDown = (e: MouseEvent) => {
      if (e.button === 1 || (e.button === 0 && !onCanvasTapRef.current)) {
        dragging = true;
        lastX = e.clientX;
        lastY = e.clientY;
      }
    };
    const onMove = (e: MouseEvent) => {
      if (!dragging) return;
      const { viewport, setViewport } = useAppStore.getState();
      setViewport({
        offsetX: viewport.offsetX + (e.clientX - lastX),
        offsetY: viewport.offsetY + (e.clientY - lastY),
      });
      lastX = e.clientX;
      lastY = e.clientY;
    };
    const onUp = () => { dragging = false; };

    canvas.addEventListener('mousedown', onDown);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      canvas.removeEventListener('mousedown', onDown);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, []);

  // Force re-render when props change
  const forceRender = useCallback(() => {
    // Trigger store notification to mark dirty
    const s = useAppStore.getState();
    s.setMousePosition(s.mousePosition);
  }, []);

  useEffect(() => {
    forceRender();
  }, [gridVisible, whiteBackground, forceRender]);

  return (
    <div ref={containerRef} className="h-full w-full relative overflow-hidden bg-cad-bg">
      <canvas
        ref={canvasRef}
        className="absolute inset-0"
        style={{ touchAction: 'none' }}
      />
    </div>
  );
}
