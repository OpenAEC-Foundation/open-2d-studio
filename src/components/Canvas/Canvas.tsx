import { useRef, useEffect, useCallback } from 'react';
import { useAppStore } from '../../state/appStore';
import { CADRenderer } from '../../engine/renderer/CADRenderer';
import { useCanvasEvents } from '../../hooks/canvas/useCanvasEvents';
import { useDrawingKeyboard } from '../../hooks/keyboard/useDrawingKeyboard';
import { DynamicInput } from '../DynamicInput/DynamicInput';
import { TextEditor } from '../TextEditor/TextEditor';
import type { TextShape } from '../../types/geometry';
import { MM_TO_PIXELS } from '../../engine/renderer/types';

export function Canvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<CADRenderer | null>(null);

  // Only subscribe to state needed for React DOM rendering
  const activeTool = useAppStore(s => s.activeTool);
  const whiteBackground = useAppStore(s => s.whiteBackground);
  const setCanvasSize = useAppStore(s => s.setCanvasSize);
  const setMousePosition = useAppStore(s => s.setMousePosition);
  const endTextEditing = useAppStore(s => s.endTextEditing);
  const updateShape = useAppStore(s => s.updateShape);
  const deleteShape = useAppStore(s => s.deleteShape);
  const updatePlacementPreview = useAppStore(s => s.updatePlacementPreview);
  const confirmPlacement = useAppStore(s => s.confirmPlacement);
  const setViewport = useAppStore(s => s.setViewport);

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

  // Center viewport on drawing boundary when canvas first gets sized
  const hasCenteredRef = useRef(false);
  useEffect(() => {
    if (hasCenteredRef.current) return;
    const s = useAppStore.getState();
    if (!s.canvasSize || s.canvasSize.width === 0 || s.canvasSize.height === 0) return;
    if (s.editorMode !== 'drawing') return;

    const drawing = s.drawings.find(d => d.id === s.activeDrawingId);
    if (!drawing?.boundary) return;

    const b = drawing.boundary;
    const centerX = b.x + b.width / 2;
    const centerY = b.y + b.height / 2;
    const zoom = s.viewport.zoom;

    setViewport({
      offsetX: s.canvasSize.width / 2 - centerX * zoom,
      offsetY: s.canvasSize.height / 2 - centerY * zoom,
      zoom,
    });
    hasCenteredRef.current = true;
  });

  // Get text shape being edited (needs React re-render for overlay)
  const editingTextShape = useAppStore(s => {
    if (!s.textEditingId) return null;
    return (s.shapes.find(sh => sh.id === s.textEditingId && sh.type === 'text') as TextShape | undefined) || null;
  });

  // Handle text save
  const handleTextSave = useCallback((newText: string) => {
    const tid = useAppStore.getState().textEditingId;
    if (tid && newText.trim()) {
      updateShape(tid, { text: newText });
    } else if (tid && !newText.trim()) {
      deleteShape(tid);
    }
    endTextEditing();
  }, [updateShape, deleteShape, endTextEditing]);

  // Handle text cancel
  const handleTextCancel = useCallback(() => {
    const s = useAppStore.getState();
    if (s.textEditingId) {
      const shape = s.shapes.find(sh => sh.id === s.textEditingId);
      if (shape && shape.type === 'text' && !shape.text) {
        deleteShape(s.textEditingId);
      }
    }
    endTextEditing();
  }, [deleteShape, endTextEditing]);

  // rAF render loop — reads state directly from Zustand, no deps array
  useEffect(() => {
    const renderer = rendererRef.current;
    if (!renderer) return;

    let rafId = 0;
    let dirty = true;

    const unsub = useAppStore.subscribe(() => { dirty = true; });

    const tick = () => {
      if (dirty) {
        // Skip rendering if a transaction is suppressing renders
        const cadApi = (window as any).cad;
        if (cadApi?.transactions?.renderSuppressed) {
          rafId = requestAnimationFrame(tick);
          return;
        }

        dirty = false;
        const s = useAppStore.getState();

        if (s.editorMode === 'sheet') {
          const activeSheet = s.sheets.find(sh => sh.id === s.activeSheetId) || null;
          if (activeSheet) {
            renderer.renderSheet({
              sheet: activeSheet,
              drawings: s.drawings,
              shapes: s.shapes,
              parametricShapes: s.parametricShapes,
              layers: s.layers,
              viewport: s.viewport,
              selectedViewportId: s.viewportEditState.selectedViewportId,
              viewportDragging: s.viewportEditState.isDragging,
              drawingViewports: s.drawingViewports,
              cropRegionEditing: s.cropRegionEditState?.isEditing || false,
              cropRegionViewportId: s.cropRegionEditState?.viewportId || null,
              selectedAnnotationIds: s.selectedAnnotationIds,
              placementPreview: {
                isPlacing: s.isPlacing,
                placingDrawingId: s.placingDrawingId,
                previewPosition: s.previewPosition,
                placementScale: s.placementScale,
              },
              customPatterns: {
                userPatterns: s.userPatterns,
                projectPatterns: s.projectPatterns,
              },
            });
          }
        } else {
          const filteredShapes = s.shapes.filter(shape => shape.drawingId === s.activeDrawingId);
          const filteredParametricShapes = s.parametricShapes.filter(shape => shape.drawingId === s.activeDrawingId);
          const filteredLayers = s.layers.filter(layer => layer.drawingId === s.activeDrawingId);
          const activeDrawing = s.drawings.find(d => d.id === s.activeDrawingId) || null;

          renderer.render({
            shapes: filteredShapes,
            parametricShapes: filteredParametricShapes,
            selectedShapeIds: s.selectedShapeIds,
            hoveredShapeId: s.hoveredShapeId,
            viewport: s.viewport,
            gridVisible: s.gridVisible,
            gridSize: s.gridSize,
            drawingPreview: s.drawingPreview,
            currentStyle: s.currentStyle,
            selectionBox: s.selectionBox,
            currentSnapPoint: s.currentSnapPoint,
            currentTrackingLines: s.currentTrackingLines,
            trackingPoint: s.trackingPoint,
            layers: filteredLayers,
            drawingBoundary: s.boundaryVisible ? (activeDrawing?.boundary || null) : null,
            boundarySelected: s.boundaryEditState.isSelected,
            boundaryDragging: s.boundaryEditState.activeHandle !== null,
            whiteBackground: s.whiteBackground,
            hideSelectionHandles: ['move','copy','rotate','scale','mirror','array','trim','extend','fillet','offset'].includes(s.activeTool),
            sectionPlacementPreview: s.sectionPlacementPreview,
            pendingSection: s.pendingSection,
            customPatterns: {
              userPatterns: s.userPatterns,
              projectPatterns: s.projectPatterns,
            },
          });
        }
      }
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);

    return () => { cancelAnimationFrame(rafId); unsub(); };
  }, []);

  // Handle mouse events
  const { handleMouseDown, handleMouseMove, handleMouseUp, handleWheel, handleClick, handleDoubleClick, handleContextMenu, isPanning } =
    useCanvasEvents(canvasRef);

  // Attach wheel listener with passive: false to allow preventDefault
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const wheelHandler = (e: WheelEvent) => {
      handleWheel(e as unknown as React.WheelEvent<HTMLCanvasElement>);
    };

    canvas.addEventListener('wheel', wheelHandler, { passive: false });
    return () => canvas.removeEventListener('wheel', wheelHandler);
  }, [handleWheel]);

  // Handle keyboard shortcuts for drawing
  useDrawingKeyboard();

  // Track mouse position and handle placement preview
  const onMouseMove = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current;
      if (!canvas) return;

      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      setMousePosition({ x, y });

      // Update placement preview if in placement mode
      const s = useAppStore.getState();
      if (s.isPlacing && s.editorMode === 'sheet') {
        const sheetPos = {
          x: (x - s.viewport.offsetX) / s.viewport.zoom / MM_TO_PIXELS,
          y: (y - s.viewport.offsetY) / s.viewport.zoom / MM_TO_PIXELS,
        };
        updatePlacementPreview(sheetPos);
      }

      handleMouseMove(e);
    },
    [setMousePosition, handleMouseMove, updatePlacementPreview]
  );

  // Handle click for placement confirmation
  const onCanvasClick = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const s = useAppStore.getState();
      if (s.isPlacing && s.editorMode === 'sheet' && s.previewPosition) {
        e.stopPropagation();
        confirmPlacement();
        return;
      }

      handleClick(e);
    },
    [confirmPlacement, handleClick]
  );

  // Cursor based on active tool and panning state
  const getCursor = () => {
    // Show grabbing cursor when actively panning
    if (isPanning) {
      return 'cursor-grabbing';
    }
    switch (activeTool) {
      case 'pan':
        return 'cursor-grab';
      case 'select':
        return 'cursor-default';
      default:
        return 'cursor-crosshair';
    }
  };

  return (
    <div
      ref={containerRef}
      className={`flex-1 relative overflow-hidden ${whiteBackground ? 'bg-white' : 'bg-cad-bg'}`}
    >
      <canvas
        ref={canvasRef}
        className={`absolute inset-0 ${getCursor()} ${useAppStore.getState().isPlacing ? 'cursor-copy' : ''}`}
        onMouseDown={handleMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={handleMouseUp}
        onClick={onCanvasClick}
        onDoubleClick={handleDoubleClick}
        onContextMenu={handleContextMenu}
      />

      {/* Dynamic Input Tooltip */}
      <DynamicInput />

      {/* Text Editor Overlay */}
      {editingTextShape && (
        <TextEditor
          shape={editingTextShape}
          onSave={handleTextSave}
          onCancel={handleTextCancel}
        />
      )}

      {/* Origin indicator - CAD convention: X right, Y up */}
      <div className="absolute bottom-4 left-4 pointer-events-none">
        <svg width="50" height="50" className="overflow-visible">
          {/* Y axis pointing UP (green) */}
          <line x1="10" y1="40" x2="10" y2="8" stroke="#22c55e" strokeWidth="2" />
          {/* Y arrow head */}
          <polygon points="10,4 7,12 13,12" fill="#22c55e" />
          {/* Y label */}
          <text x="16" y="12" fill="#22c55e" fontSize="12" fontWeight="bold">Y</text>

          {/* X axis pointing RIGHT (red) */}
          <line x1="10" y1="40" x2="42" y2="40" stroke="#ef4444" strokeWidth="2" />
          {/* X arrow head */}
          <polygon points="46,40 38,37 38,43" fill="#ef4444" />
          {/* X label */}
          <text x="38" y="53" fill="#ef4444" fontSize="12" fontWeight="bold">X</text>
        </svg>
      </div>
    </div>
  );
}
