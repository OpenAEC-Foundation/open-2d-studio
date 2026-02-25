import { useRef, useEffect, useCallback, useState } from 'react';
import { useAppStore } from '../../state/appStore';
import { getActiveDocumentStore } from '../../state/documentStore';
import { CADRenderer } from '../../engine/renderer/CADRenderer';
import { useCanvasEvents } from '../../hooks/canvas/useCanvasEvents';
import { useContextMenu } from '../../hooks/canvas/useContextMenu';
import { useDrawingKeyboard } from '../../hooks/keyboard/useDrawingKeyboard';
import { DynamicInput } from './DynamicInput/DynamicInput';
import { TextEditor } from '../editors/TextEditor/TextEditor';
import { ContextMenu } from '../shared/ContextMenu';
import type { TextShape, GridlineShape, Point } from '../../types/geometry';
import { MM_TO_PIXELS } from '../../engine/renderer/types';
import { screenToWorld, worldToScreen } from '../../engine/geometry/GeometryUtils';
import { setRotationGizmoVisible } from '../../engine/renderer/rotationGizmoState';
import { TitleBlockFieldEditor } from '../editors/TitleBlockFieldEditor/TitleBlockFieldEditor';
import { parseSpacingPattern, createGridlinesFromPattern } from '../../utils/gridlineUtils';
import { regenerateGridDimensions } from '../../utils/gridDimensionUtils';
import { ShortcutHUD } from './ShortcutHUD';

function GridlineLabelInput({ shape, bubbleEnd, viewport, onSave, onCancel, drawingScale }: {
  shape: GridlineShape;
  bubbleEnd: 'start' | 'end';
  viewport: { offsetX: number; offsetY: number; zoom: number };
  onSave: (newLabel: string) => void;
  onCancel: () => void;
  drawingScale?: number;
}) {
  const [value, setValue] = useState(shape.label);
  const inputRef = useRef<HTMLInputElement>(null);

  // Scale bubbleRadius to match rendering (annotation reference scale = 0.01)
  const sf = drawingScale && drawingScale > 0 ? 0.01 / drawingScale : 1;
  const bubbleRadius = shape.bubbleRadius * sf;

  const angle = Math.atan2(shape.end.y - shape.start.y, shape.end.x - shape.start.x);
  const dx = Math.cos(angle), dy = Math.sin(angle);
  const worldPos = bubbleEnd === 'start'
    ? { x: shape.start.x - dx * bubbleRadius, y: shape.start.y - dy * bubbleRadius }
    : { x: shape.end.x + dx * bubbleRadius, y: shape.end.y + dy * bubbleRadius };
  const screenPos = worldToScreen(worldPos.x, worldPos.y, viewport);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  return (
    <input
      ref={inputRef}
      value={value}
      onChange={e => setValue(e.target.value)}
      onKeyDown={e => {
        if (e.key === 'Enter') onSave(value);
        if (e.key === 'Escape') onCancel();
        e.stopPropagation();
      }}
      onBlur={() => onSave(value)}
      className="absolute text-center bg-cad-surface border border-blue-500 text-cad-text rounded z-50"
      style={{
        left: screenPos.x - 20,
        top: screenPos.y - 12,
        width: 40,
        height: 24,
        fontSize: 12,
      }}
    />
  );
}

/** View rotation control - single button with angle input */
function ViewRotationControl() {
  const [showInput, setShowInput] = useState(false);
  const [inputValue, setInputValue] = useState('');
  const rotation = useAppStore(s => s.viewport.rotation || 0);
  const rotationDeg = Math.round(rotation * 180 / Math.PI);

  const handleSubmit = () => {
    const angle = parseFloat(inputValue);
    if (!isNaN(angle)) {
      // Set absolute rotation: rotate from current to target
      useAppStore.getState().rotateView(angle - rotationDeg);
    }
    setShowInput(false);
    setInputValue('');
  };

  return (
    <div className="absolute top-3 right-3 flex items-center gap-1" style={{ zIndex: 20 }}>
      {showInput && (
        <input
          type="text"
          className="w-14 h-8 px-1 text-xs text-center bg-gray-800/90 border border-gray-500 text-white rounded backdrop-blur-sm"
          value={inputValue}
          onChange={e => setInputValue(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') handleSubmit(); if (e.key === 'Escape') { setShowInput(false); setInputValue(''); } }}
          onBlur={handleSubmit}
          autoFocus
          placeholder="0°"
        />
      )}
      <div
        className="w-10 h-10 rounded-full bg-gray-800/80 border border-gray-600 flex items-center justify-center backdrop-blur-sm cursor-pointer hover:bg-gray-700"
        onClick={() => { setShowInput(true); setInputValue(String(rotationDeg)); }}
        title={`View rotation: ${rotationDeg}° (click to enter angle)`}
      >
        <svg width="28" height="28" viewBox="0 0 28 28">
          <circle cx="14" cy="14" r="12" fill="none" stroke="#6b7280" strokeWidth="1" />
          <line
            x1="14" y1="2" x2="14" y2="8"
            stroke="#ef4444" strokeWidth="2"
            transform={`rotate(${rotationDeg}, 14, 14)`}
          />
          <circle cx="14" cy="14" r="2" fill="#9ca3af" />
        </svg>
      </div>
    </div>
  );
}

/**
 * GridlinePlusButton - Small blue "+" button that appears at the bottom end of a selected gridline.
 * Clicking it opens a spacing pattern popup to create multiple gridlines at specified spacings.
 */
function GridlinePlusButton({ gridline, viewport, drawingScale }: {
  gridline: GridlineShape;
  viewport: { offsetX: number; offsetY: number; zoom: number };
  drawingScale?: number;
}) {
  const [showPopup, setShowPopup] = useState(false);
  const [pattern, setPattern] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const addShapes = useAppStore(s => s.addShapes);

  // Compute the "bottom" end of the gridline (the end with lower Y in world coords,
  // which maps to lower screen position since canvas Y is flipped)
  // For vertical gridlines, "bottom" = smaller Y (lower end on screen)
  // We position the button just past the end of the visible line (past the extension + bubble)
  const sf = drawingScale && drawingScale > 0 ? 0.01 / drawingScale : 1;
  const gridlineExtension = useAppStore(s => s.gridlineExtension) * sf;
  const bubbleR = gridline.bubbleRadius * sf;

  const angle = Math.atan2(gridline.end.y - gridline.start.y, gridline.end.x - gridline.start.x);
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);

  // Position the "+" button at the "end" side of the gridline (past the bubble)
  // The bubble outer edge is at: end + dx * (ext + 2*bubbleR)
  const buttonWorldPos: Point = {
    x: gridline.end.x + dx * (gridlineExtension + bubbleR * 2 + 30 * sf),
    y: gridline.end.y + dy * (gridlineExtension + bubbleR * 2 + 30 * sf),
  };

  const screenPos = worldToScreen(buttonWorldPos.x, buttonWorldPos.y, viewport);

  useEffect(() => {
    if (showPopup) {
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [showPopup]);

  const handleCreate = () => {
    const newGridlines = createGridlinesFromPattern(gridline, pattern);
    if (newGridlines.length > 0) {
      addShapes(newGridlines);
      setPattern('');
      setShowPopup(false);

      // Auto-dimension: regenerate grid dimensions if enabled
      if (useAppStore.getState().autoGridDimension) {
        setTimeout(() => regenerateGridDimensions(), 50);
      }
    }
  };

  const isValid = pattern.trim() !== '' && parseSpacingPattern(pattern) !== null;

  return (
    <>
      {/* Blue "+" circle button */}
      <button
        className="absolute flex items-center justify-center rounded-full bg-blue-500 hover:bg-blue-400 text-white shadow-lg border-2 border-blue-300 transition-colors"
        style={{
          left: screenPos.x - 12,
          top: screenPos.y - 12,
          width: 24,
          height: 24,
          fontSize: 16,
          lineHeight: '1',
          zIndex: 45,
        }}
        onClick={(e) => {
          e.stopPropagation();
          setShowPopup(!showPopup);
        }}
        title="Add gridlines with spacing pattern"
      >
        +
      </button>

      {/* Spacing pattern popup */}
      {showPopup && (
        <div
          className="absolute bg-cad-surface border border-cad-border rounded shadow-xl p-3 space-y-2"
          style={{
            left: screenPos.x + 16,
            top: screenPos.y - 8,
            width: 240,
            zIndex: 50,
          }}
          onClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <div className="text-xs font-semibold text-cad-text">Spacing Pattern</div>
          <div className="text-[10px] text-cad-text-dim">
            Enter distances separated by spaces. Use NxD for repeats (e.g. 3x5000).
          </div>
          <div className="flex gap-1">
            <input
              ref={inputRef}
              type="text"
              value={pattern}
              onChange={(e) => setPattern(e.target.value)}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === 'Enter') { e.preventDefault(); handleCreate(); }
                if (e.key === 'Escape') { e.preventDefault(); setShowPopup(false); setPattern(''); }
              }}
              placeholder="5000 3000 3x5400"
              className="flex-1 bg-cad-bg border border-cad-border rounded px-2 py-1 text-xs text-cad-text"
            />
            <button
              onClick={handleCreate}
              disabled={!isValid}
              className="px-2 py-1 text-xs bg-blue-500/20 border border-blue-500/50 text-blue-400 hover:bg-blue-500/30 rounded disabled:opacity-30 disabled:cursor-not-allowed"
            >
              Create
            </button>
          </div>
          <button
            onClick={() => { setShowPopup(false); setPattern(''); }}
            className="w-full h-6 text-[10px] text-cad-text-secondary hover:bg-cad-hover rounded"
          >
            Cancel
          </button>
        </div>
      )}
    </>
  );
}

/** Floating toolbar shown above the plate system boundary when in edit mode */
function PlateSystemEditToolbar() {
  const plateSystemEditMode = useAppStore(s => s.plateSystemEditMode);
  const editingPlateSystemId = useAppStore(s => s.editingPlateSystemId);
  const subTool = useAppStore(s => s.plateSystemSubTool);
  const setSubTool = useAppStore(s => s.setPlateSystemSubTool);
  const viewport = useAppStore(s => s.viewport);

  const editingShape = useAppStore(s => {
    if (!s.editingPlateSystemId) return null;
    return s.shapes.find(sh => sh.id === s.editingPlateSystemId && sh.type === 'plate-system') as import('../../types/geometry').PlateSystemShape | undefined ?? null;
  });

  if (!plateSystemEditMode || !editingPlateSystemId || !editingShape) return null;

  // Find top-center of the contour in screen coordinates
  const pts = editingShape.contourPoints;
  if (!pts || pts.length < 3) return null;

  let minY = Infinity;
  let cx = 0;
  for (const p of pts) {
    if (p.y < minY) minY = p.y;
    cx += p.x;
  }
  cx /= pts.length;

  // World -> screen
  const screenX = cx * viewport.zoom + viewport.offsetX;
  const screenY = minY * viewport.zoom + viewport.offsetY;

  const tools: { id: typeof subTool; label: string; title: string }[] = [
    { id: 'select', label: 'Select', title: 'Select / drag vertices, edges, openings' },
    { id: 'add-point', label: '+Pt', title: 'Click on edge to insert vertex' },
    { id: 'arc-edge', label: 'Arc', title: 'Click edge to toggle straight/arc' },
    { id: 'add-opening', label: '+Open', title: 'Click inside contour to place opening' },
    { id: 'delete', label: 'Del', title: 'Click vertex or opening to delete' },
  ];

  return (
    <div
      className="absolute flex items-center gap-0.5 pointer-events-auto z-40"
      style={{
        left: screenX,
        top: Math.max(4, screenY - 40),
        transform: 'translateX(-50%)',
      }}
      onMouseDown={e => e.stopPropagation()}
      onClick={e => e.stopPropagation()}
    >
      {/* Edit label */}
      <div className="px-1.5 py-1 bg-cyan-900/85 text-cyan-300 text-[10px] font-bold rounded-l select-none">
        Edit
      </div>

      {/* Sub-tool buttons */}
      {tools.map((t) => (
        <button
          key={t.id}
          className={`px-2 py-1 text-[10px] border-y border-r transition-colors select-none ${
            subTool === t.id
              ? 'bg-cyan-600/90 border-cyan-400 text-white font-bold'
              : 'bg-gray-800/85 border-gray-600/60 text-gray-300 hover:bg-gray-700/90 hover:text-white'
          } ${t.id === 'select' ? 'border-l border-l-cyan-700' : ''}`}
          onClick={() => setSubTool(t.id)}
          title={t.title}
        >
          {t.label}
        </button>
      ))}

      {/* TAB hint */}
      <div className="px-1.5 py-1 bg-gray-800/75 text-gray-500 text-[9px] rounded-r select-none ml-0.5">
        TAB
      </div>
    </div>
  );
}

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
  const endGridlineLabelEdit = useAppStore(s => s.endGridlineLabelEdit);

  // Gridline label editing state
  const editingGridlineLabel = useAppStore(s => s.editingGridlineLabel);
  const editingGridlineShape = useAppStore(s => {
    if (!s.editingGridlineLabel) return null;
    return (s.shapes.find(sh => sh.id === s.editingGridlineLabel!.shapeId && sh.type === 'gridline') as GridlineShape | undefined) || null;
  });
  const viewportForOverlay = useAppStore(s => s.viewport);
  const activeDrawingScale = useAppStore(s => {
    const drawing = s.drawings.find(d => d.id === s.activeDrawingId);
    return drawing?.scale;
  });

  // Title block field editing state — read directly from documentStore.
  // Subscribe to the tick counter on appStore so React re-renders when these change.
  useAppStore(s => (s as any)._titleBlockRenderTick);
  const _docStoreForCanvas = getActiveDocumentStore();
  const titleBlockEditingFieldId = _docStoreForCanvas.getState().titleBlockEditingFieldId;
  const hoveredTitleBlockFieldId = _docStoreForCanvas.getState().hoveredTitleBlockFieldId;

  // Selected gridline for "+" button overlay (only when exactly one gridline is selected)
  const selectedGridline = useAppStore(s => {
    if (s.selectedShapeIds.length !== 1) return null;
    const shape = s.shapes.find(sh => sh.id === s.selectedShapeIds[0] && sh.type === 'gridline');
    return (shape as GridlineShape | undefined) || null;
  });

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

  // Handle gridline label save
  const handleGridlineLabelSave = useCallback((newLabel: string) => {
    const editing = useAppStore.getState().editingGridlineLabel;
    if (editing && newLabel.trim()) {
      updateShape(editing.shapeId, { label: newLabel.trim() });
    }
    endGridlineLabelEdit();
  }, [updateShape, endGridlineLabelEdit]);

  // Handle gridline label cancel
  const handleGridlineLabelCancel = useCallback(() => {
    endGridlineLabelEdit();
  }, [endGridlineLabelEdit]);

  // rAF render loop — reads state directly from Zustand, no deps array
  useEffect(() => {
    const renderer = rendererRef.current;
    if (!renderer) return;

    let rafId = 0;
    let dirty = true;

    const unsub = useAppStore.subscribe(() => { dirty = true; });

    // Set up callback for when async images (like SVG title blocks) finish loading
    // This ensures the canvas re-renders after the image is ready
    renderer.setOnImageLoadCallback(() => { dirty = true; });

    let renderErrorLogged = false;

    const tick = () => {
      if (dirty) {
        // Skip rendering if a transaction is suppressing renders
        const cadApi = (window as any).cad;
        if (cadApi?.transactions?.renderSuppressed) {
          rafId = requestAnimationFrame(tick);
          return;
        }

        dirty = false;

        try {
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
                placingQueryId: s.placingQueryId,
                previewPosition: s.previewPosition,
                placementScale: s.placementScale,
              },
              queries: s.queries,
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
              editingFieldId: getActiveDocumentStore().getState().titleBlockEditingFieldId,
            });
          }
        } else {
          const filteredShapes = s.shapes.filter(shape => shape.drawingId === s.activeDrawingId);
          const filteredParametricShapes = s.parametricShapes.filter(shape => shape.drawingId === s.activeDrawingId);
          const filteredLayers = s.layers.filter(layer => layer.drawingId === s.activeDrawingId);
          const activeDrawing = s.drawings.find(d => d.id === s.activeDrawingId) || null;

          // Sync rotation gizmo state for the renderer
          setRotationGizmoVisible(s.showRotationGizmo);

          // Apply selection filter: when active, only highlight shapes of the filtered type
          const effectiveSelectedIds = s.selectionFilter
            ? s.selectedShapeIds.filter(id => {
                const shape = filteredShapes.find(sh => sh.id === id);
                return shape && shape.type === s.selectionFilter;
              })
            : s.selectedShapeIds;

          renderer.render({
            shapes: filteredShapes,
            parametricShapes: filteredParametricShapes,
            selectedShapeIds: effectiveSelectedIds,
            hoveredShapeId: s.hoveredShapeId,
            preSelectedShapeIds: s.preSelectedShapeIds,
            viewport: s.viewport,
            drawingScale: activeDrawing?.scale,
            gridVisible: s.gridVisible,
            axesVisible: s.axesVisible,
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
            previewPatternId: s.previewPatternId,
            cursor2D: s.cursor2D,
            cursor2DVisible: s.cursor2DVisible,
            showLineweight: s.showLineweight,
            wallTypes: s.wallTypes,
            wallSystemTypes: s.wallSystemTypes,
            selectedWallSubElement: s.selectedWallSubElement,
            materialHatchSettings: s.materialHatchSettings,
            gridlineExtension: s.gridlineExtension,
            seaLevelDatum: s.projectStructure?.seaLevelDatum ?? 0,
            hiddenIfcCategories: s.hiddenIfcCategories ?? [],
            unitSettings: s.unitSettings,
          });
        }
        } catch (err) {
          if (!renderErrorLogged) {
            console.error('[Canvas] Render error:', err);
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

  // Handle mouse events
  const { handleMouseDown, handleMouseMove, handleMouseUp, handleWheel, handleClick, handleDoubleClick, handleContextMenu: baseHandleContextMenu, isPanning, consumeRightDrag, titleBlockEditing } =
    useCanvasEvents(canvasRef);

  // Context menu state
  const { menuState, openMenu, closeMenu, getMenuItems } = useContextMenu();
  const contextMenuWorldPosRef = useRef<Point | null>(null);

  const setCursor2D = useAppStore(s => s.setCursor2D);

  // Extended context menu handler that opens our React menu
  const handleContextMenu = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      // If a right-drag just finished (2D cursor placement), suppress context menu entirely.
      // This must be checked BEFORE any other logic to prevent the menu from opening
      // after a right-drag in select mode.
      if (consumeRightDrag()) {
        e.preventDefault();
        return;
      }

      const s = useAppStore.getState();

      // Shift+Right-Click: place 2D cursor
      if (e.shiftKey) {
        e.preventDefault();
        const canvas = canvasRef.current;
        if (canvas) {
          const rect = canvas.getBoundingClientRect();
          const screenX = e.clientX - rect.left;
          const screenY = e.clientY - rect.top;
          const worldPos = screenToWorld(screenX, screenY, s.viewport);
          setCursor2D(worldPos);
        }
        return;
      }

      // In drawing mode
      if (s.editorMode === 'drawing' && !s.pendingSection && !s.pendingBeam) {
        e.preventDefault();

        // If in a drawing/modify tool (not select)
        if (s.activeTool !== 'select') {
          // If actively drawing (points placed), finish current drawing via base handler
          if (s.isDrawing || s.drawingPoints.length > 0) {
            baseHandleContextMenu(e);
            return;
          }
          // Not drawing - exit to select mode
          useAppStore.getState().setActiveTool('select');
          return;
        }

        // In select mode - show context menu
        // Calculate world position for paste
        const canvas = canvasRef.current;
        if (canvas) {
          const rect = canvas.getBoundingClientRect();
          const screenX = e.clientX - rect.left;
          const screenY = e.clientY - rect.top;
          contextMenuWorldPosRef.current = screenToWorld(screenX, screenY, s.viewport);
        }

        openMenu(e.clientX, e.clientY);
        return;
      }

      // Fall back to base handler for other cases
      baseHandleContextMenu(e);
    },
    [baseHandleContextMenu, openMenu, setCursor2D, consumeRightDrag]
  );

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
    // Show pointer when hovering a title block field
    if (hoveredTitleBlockFieldId) {
      return 'cursor-pointer';
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
      className={`h-full w-full relative overflow-hidden ${whiteBackground ? 'bg-white' : 'bg-cad-bg'}`}
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

      {/* Gridline Label Editor Overlay */}
      {editingGridlineLabel && editingGridlineShape && (
        <GridlineLabelInput
          shape={editingGridlineShape}
          bubbleEnd={editingGridlineLabel.bubbleEnd}
          viewport={viewportForOverlay}
          onSave={handleGridlineLabelSave}
          onCancel={handleGridlineLabelCancel}
          drawingScale={activeDrawingScale}
        />
      )}

      {/* Title Block Field Editor Overlay */}
      {titleBlockEditingFieldId && (() => {
        const rect = titleBlockEditing.getEditingFieldScreenRect();
        if (!rect) return null;
        return (
          <TitleBlockFieldEditor
            x={rect.x}
            y={rect.y}
            width={rect.width}
            height={rect.height}
            fieldRect={rect.fieldRect}
            zoom={viewportForOverlay.zoom}
            onSave={titleBlockEditing.saveFieldValue}
            onCancel={titleBlockEditing.cancelFieldEditing}
          />
        );
      })()}

      {/* Gridline "+" Button Overlay - shows when a single gridline is selected */}
      {selectedGridline && activeTool === 'select' && (
        <GridlinePlusButton
          gridline={selectedGridline}
          viewport={viewportForOverlay}
          drawingScale={activeDrawingScale}
        />
      )}

      {/* Plate System Edit Mode Toolbar Overlay */}
      <PlateSystemEditToolbar />

      {/* Keyboard Shortcuts HUD */}
      <ShortcutHUD />

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

      {/* View Rotation Control */}
      <ViewRotationControl />

      {/* Context Menu */}
      {menuState.isOpen && (
        <ContextMenu
          x={menuState.x}
          y={menuState.y}
          items={getMenuItems(
            useAppStore.getState().selectedShapeIds.length > 0,
            contextMenuWorldPosRef.current ?? undefined
          )}
          onClose={closeMenu}
        />
      )}
    </div>
  );
}
