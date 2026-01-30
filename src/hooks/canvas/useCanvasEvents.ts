/**
 * useCanvasEvents - Main orchestrator for canvas interactions
 *
 * This hook composes specialized hooks for different concerns:
 * - usePanZoom: Pan and zoom interactions
 * - useBoxSelection: Window/crossing box selection
 * - useSnapDetection: Snap point and tracking detection
 * - useShapeDrawing: Shape drawing (line, rectangle, circle, polyline)
 * - useBoundaryEditing: Drawing boundary editing
 * - useViewportEditing: Sheet viewport editing
 */

import { useCallback, useMemo } from 'react';
import { useAppStore } from '../../state/appStore';
import type { Point } from '../../types/geometry';
import { screenToWorld } from '../../utils/geometryUtils';
import { isPointNearShape } from '../../utils/geometryUtils';
import { QuadTree } from '../../engine/spatial/QuadTree';

import { usePanZoom } from '../navigation/usePanZoom';
import { useBoxSelection } from '../selection/useBoxSelection';
import { useSnapDetection } from '../snap/useSnapDetection';
import { useShapeDrawing } from '../drawing/useShapeDrawing';
import { useTextDrawing } from '../drawing/useTextDrawing';
import { useBoundaryEditing } from '../editing/useBoundaryEditing';
import { useViewportEditing } from '../editing/useViewportEditing';
import { useAnnotationEditing } from '../editing/useAnnotationEditing';
import { useGripEditing } from '../editing/useGripEditing';

export function useCanvasEvents(canvasRef: React.RefObject<HTMLCanvasElement>) {
  // Compose specialized hooks
  const panZoom = usePanZoom(canvasRef);
  const boxSelection = useBoxSelection();
  const snapDetection = useSnapDetection();
  const shapeDrawing = useShapeDrawing();
  const textDrawing = useTextDrawing();
  const boundaryEditing = useBoundaryEditing();
  const viewportEditing = useViewportEditing();
  const annotationEditing = useAnnotationEditing();
  const gripEditing = useGripEditing();

  const {
    viewport,
    activeTool,
    setActiveTool,
    shapes,
    selectShape,
    deselectAll,
    hasActiveModifyCommand,
    commandIsSelecting,
    setPendingCommandPoint,
    setPendingCommandSelection,
    editorMode,
    activeDrawingId,
    dimensionMode,
    setHoveredShapeId,
  } = useAppStore();

  // Build spatial index for efficient shape lookup
  const quadTree = useMemo(() => {
    return QuadTree.buildFromShapes(shapes, activeDrawingId);
  }, [shapes, activeDrawingId]);

  /**
   * Find shape at point using spatial index (only shapes in active drawing)
   */
  const findShapeAtPoint = useCallback(
    (worldPoint: Point): string | null => {
      const tolerance = 5 / viewport.zoom;
      const candidates = quadTree.queryPoint(worldPoint, tolerance);
      // Iterate in reverse to match z-order (last inserted = on top)
      for (let i = candidates.length - 1; i >= 0; i--) {
        const shape = shapes.find(s => s.id === candidates[i].id);
        if (shape && isPointNearShape(worldPoint, shape)) {
          return shape.id;
        }
      }
      return null;
    },
    [quadTree, shapes, viewport.zoom]
  );

  /**
   * Handle mouse down
   */
  const handleMouseDown = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const screenPos = panZoom.getMousePos(e);

      // Check pan first
      if (panZoom.handlePanMouseDown(e)) {
        return;
      }

      // Sheet mode: annotation dragging
      if (editorMode === 'sheet' && e.button === 0) {
        if (annotationEditing.handleAnnotationMouseDown(screenPos)) {
          return;
        }
      }

      // Sheet mode: viewport editing
      if (editorMode === 'sheet' && e.button === 0) {
        if (viewportEditing.handleViewportMouseDown(screenPos)) {
          return;
        }
      }

      // Drawing mode: boundary editing
      if (editorMode === 'drawing' && e.button === 0) {
        const worldPos = screenToWorld(screenPos.x, screenPos.y, viewport);
        if (boundaryEditing.handleBoundaryMouseDown(worldPos)) {
          return;
        }
      }

      // Drawing mode: grip (handle) dragging on selected shapes
      if (editorMode === 'drawing' && e.button === 0) {
        const worldPos = screenToWorld(screenPos.x, screenPos.y, viewport);
        if (gripEditing.handleGripMouseDown(worldPos)) {
          return;
        }
      }

      // Drawing mode: start box selection if clicking on empty space
      if (editorMode === 'drawing' && e.button === 0) {
        const worldPos = screenToWorld(screenPos.x, screenPos.y, viewport);
        const shapeId = findShapeAtPoint(worldPos);
        // Pass true if there IS a shape at point, false if empty
        if (boxSelection.shouldStartBoxSelection(!!shapeId)) {
          boxSelection.startBoxSelection(screenPos);
        }
      }
    },
    [panZoom, editorMode, viewport, annotationEditing, viewportEditing, boundaryEditing, gripEditing, findShapeAtPoint, boxSelection]
  );

  /**
   * Handle click
   */
  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      // Skip if was panning or just finished box selection
      if (panZoom.getIsPanning()) return;
      if (boxSelection.justFinishedBoxSelection()) return;
      if (e.button !== 0) return;

      const screenPos = panZoom.getMousePos(e);

      // Sheet mode: annotation tools or viewport selection
      if (editorMode === 'sheet') {
        // Handle annotation tool clicks first
        if (annotationEditing.handleAnnotationClick(screenPos, e.shiftKey)) {
          return;
        }

        // Then handle viewport selection
        viewportEditing.handleViewportClick(screenPos);
        return;
      }

      // Drawing mode
      const worldPos = screenToWorld(screenPos.x, screenPos.y, viewport);
      const basePoint = shapeDrawing.getLastDrawingPoint();
      const snapResult = snapDetection.snapPoint(worldPos, basePoint);
      const snappedPos = snapResult.point;

      // Command selection phase
      if (hasActiveModifyCommand && commandIsSelecting) {
        const shapeId = findShapeAtPoint(worldPos);
        if (shapeId) {
          setPendingCommandSelection([shapeId]);
        }
        return;
      }

      // Command point input
      if (hasActiveModifyCommand) {
        setPendingCommandPoint(snappedPos);
        return;
      }

      // Tool-specific handling
      switch (activeTool) {
        case 'select': {
          // Check boundary click first
          if (boundaryEditing.handleBoundaryClick(worldPos)) {
            break;
          }

          // Check shapes
          const shapeId = findShapeAtPoint(worldPos);
          if (shapeId) {
            boundaryEditing.deselectBoundary();
            selectShape(shapeId, e.shiftKey);
          } else {
            boundaryEditing.deselectBoundary();
            deselectAll();
          }
          break;
        }

        case 'line':
        case 'rectangle':
        case 'circle':
        case 'arc':
        case 'polyline':
        case 'ellipse':
          shapeDrawing.handleDrawingClick(snappedPos, e.shiftKey, snapResult.snapInfo);
          // Clear snap/tracking indicators after click - they'll be recalculated on next mouse move
          snapDetection.clearTracking();
          break;

        case 'dimension':
          shapeDrawing.handleDrawingClick(snappedPos, e.shiftKey, snapResult.snapInfo);
          snapDetection.clearTracking();
          break;

        case 'text':
          textDrawing.handleTextClick(snappedPos);
          snapDetection.clearTracking();
          break;

        case 'pan':
          // Pan tool doesn't use click
          break;
      }
    },
    [
      panZoom,
      boxSelection,
      editorMode,
      viewport,
      annotationEditing,
      viewportEditing,
      shapeDrawing,
      textDrawing,
      snapDetection,
      hasActiveModifyCommand,
      commandIsSelecting,
      setPendingCommandPoint,
      setPendingCommandSelection,
      findShapeAtPoint,
      activeTool,
      boundaryEditing,
      selectShape,
      deselectAll,
    ]
  );

  /**
   * Handle mouse move
   */
  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const screenPos = panZoom.getMousePos(e);

      // Pan handling
      if (panZoom.handlePanMouseMove(e)) {
        return;
      }

      // Sheet mode: annotation dragging
      if (annotationEditing.handleAnnotationMouseMove(screenPos)) {
        return;
      }

      // Sheet mode: viewport dragging
      if (viewportEditing.handleViewportMouseMove(screenPos)) {
        return;
      }

      // Drawing mode: boundary dragging
      if (editorMode === 'drawing') {
        const worldPos = screenToWorld(screenPos.x, screenPos.y, viewport);
        if (boundaryEditing.handleBoundaryMouseMove(worldPos)) {
          return;
        }
      }

      // Drawing mode: grip dragging
      if (editorMode === 'drawing') {
        const worldPos = screenToWorld(screenPos.x, screenPos.y, viewport);
        if (gripEditing.handleGripMouseMove(worldPos)) {
          return;
        }
      }

      // Box selection
      if (boxSelection.isSelecting()) {
        boxSelection.updateBoxSelection(screenPos);
        return;
      }

      // Modify commands (MOVE etc.) - detect snaps during point-picking phases
      if (hasActiveModifyCommand && editorMode === 'drawing') {
        const worldPos = screenToWorld(screenPos.x, screenPos.y, viewport);
        snapDetection.snapPoint(worldPos, undefined);
      }

      // Drawing tools - always detect snaps when hovering (even before first click)
      const isDrawingTool = ['line', 'rectangle', 'circle', 'arc', 'polyline', 'ellipse', 'dimension'].includes(activeTool);

      if (isDrawingTool && editorMode === 'drawing') {
        const worldPos = screenToWorld(screenPos.x, screenPos.y, viewport);
        const basePoint = shapeDrawing.getLastDrawingPoint();
        const snapResult = snapDetection.snapPoint(worldPos, basePoint);

        // Update drawing preview if actively drawing
        if (shapeDrawing.isDrawing()) {
          shapeDrawing.updateDrawingPreview(snapResult.point, e.shiftKey);
        }

        // Hover highlight for dimension tools that require clicking on geometry
        if (activeTool === 'dimension') {
          const needsHover =
            (dimensionMode === 'radius' || dimensionMode === 'diameter' || dimensionMode === 'angular');
          if (needsHover) {
            const hoveredShape = findShapeAtPoint(worldPos);
            setHoveredShapeId(hoveredShape);
          } else {
            setHoveredShapeId(null);
          }
        } else {
          setHoveredShapeId(null);
        }
      } else {
        setHoveredShapeId(null);
      }
    },
    [panZoom, annotationEditing, viewportEditing, editorMode, viewport, boundaryEditing, gripEditing, boxSelection, shapeDrawing, snapDetection, activeTool, dimensionMode, findShapeAtPoint, setHoveredShapeId, hasActiveModifyCommand]
  );

  /**
   * Handle mouse up
   */
  const handleMouseUp = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      panZoom.handlePanMouseUp();

      // Sheet mode: annotation drag end
      if (annotationEditing.handleAnnotationMouseUp()) {
        return;
      }

      // Sheet mode: viewport drag end
      if (viewportEditing.handleViewportMouseUp()) {
        return;
      }

      // Draft mode: boundary drag end
      if (boundaryEditing.handleBoundaryMouseUp()) {
        return;
      }

      // Drawing mode: grip drag end
      if (gripEditing.handleGripMouseUp()) {
        return;
      }

      // Box selection end
      if (boxSelection.isSelecting()) {
        const screenPos = panZoom.getMousePos(e);
        boxSelection.endBoxSelection(screenPos, e.shiftKey);
      }
    },
    [panZoom, annotationEditing, viewportEditing, boundaryEditing, gripEditing, boxSelection]
  );

  /**
   * Handle context menu (right-click) - finish drawing or deselect tool
   */
  const handleContextMenu = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      e.preventDefault();

      // In sheet mode, finish leader annotation
      if (editorMode === 'sheet') {
        annotationEditing.finishLeader();
        return;
      }

      // In drawing mode
      // If actively drawing, finish the drawing
      if (shapeDrawing.isDrawing()) {
        shapeDrawing.finishDrawing();
        // Clear snap/tracking indicators
        snapDetection.clearTracking();
        return;
      }

      // If a drawing tool is selected but not actively drawing, deselect it
      const drawingTools = ['line', 'rectangle', 'circle', 'arc', 'polyline', 'ellipse', 'text'];
      if (drawingTools.includes(activeTool)) {
        setActiveTool('select');
        // Clear any lingering snap/tracking indicators
        snapDetection.clearTracking();
      }
    },
    [editorMode, annotationEditing, shapeDrawing, activeTool, setActiveTool, snapDetection]
  );

  /**
   * Handle double-click (edit text)
   */
  const handleDoubleClick = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (e.button !== 0) return;
      if (editorMode !== 'drawing') return;

      const screenPos = panZoom.getMousePos(e);
      const worldPos = screenToWorld(screenPos.x, screenPos.y, viewport);

      // Find shape at point
      const shapeId = findShapeAtPoint(worldPos);
      if (shapeId) {
        // Check if it's a text shape
        const shape = shapes.find(s => s.id === shapeId);
        if (shape && shape.type === 'text') {
          textDrawing.handleTextDoubleClick(shapeId);
        }
      }
    },
    [editorMode, panZoom, viewport, findShapeAtPoint, shapes, textDrawing]
  );

  /**
   * Handle wheel (zoom)
   */
  const handleWheel = panZoom.handleWheel;

  return {
    handleMouseDown,
    handleMouseMove,
    handleMouseUp,
    handleWheel,
    handleClick,
    handleDoubleClick,
    handleContextMenu,
    isPanning: panZoom.isPanning,
  };
}
