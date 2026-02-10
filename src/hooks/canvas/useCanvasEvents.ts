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

import { useCallback, useMemo, useEffect, useRef } from 'react';
import { useAppStore } from '../../state/appStore';
import type { Point } from '../../types/geometry';
import { screenToWorld, isPointNearShape, isPointNearParametricShape } from '../../engine/geometry/GeometryUtils';
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
import { useModifyTools } from '../editing/useModifyTools';
import { useBeamDrawing } from '../drawing/useBeamDrawing';
import { showImportImageDialog } from '../../services/file/fileService';
import { importImage } from '../../services/file/imageImportService';
import type { ImageShape } from '../../types/geometry';

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
  const modifyTools = useModifyTools();
  const beamDrawing = useBeamDrawing();

  const {
    viewport,
    activeTool,
    setActiveTool,
    shapes,
    parametricShapes,
    selectShape,
    deselectAll,
    editorMode,
    activeDrawingId,
    activeLayerId,
    dimensionMode,
    setHoveredShapeId,
    pickLinesMode,
    setPrintDialogOpen,
    pendingSection,
    clearPendingSection,
    insertProfile,
    setSectionPlacementPreview,
    pendingBeam,
    explodeParametricShapes,
    addShapes,
    selectedShapeIds,
    drawings,
    sourceSnapAngle,
  } = useAppStore();

  // Get the active drawing's scale for text hit detection
  const activeDrawingScale = useMemo(() => {
    const drawing = drawings.find(d => d.id === activeDrawingId);
    return drawing?.scale ?? 0.02; // Default to 1:50
  }, [drawings, activeDrawingId]);

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

      // Check parametric shapes first (they render on top)
      const drawingParametricShapes = parametricShapes.filter(s => s.drawingId === activeDrawingId && s.visible);
      for (let i = drawingParametricShapes.length - 1; i >= 0; i--) {
        const shape = drawingParametricShapes[i];
        const bounds = shape.generatedGeometry?.bounds;
        if (bounds) {
          // Quick bounding box check first
          if (
            worldPoint.x >= bounds.minX - tolerance &&
            worldPoint.x <= bounds.maxX + tolerance &&
            worldPoint.y >= bounds.minY - tolerance &&
            worldPoint.y <= bounds.maxY + tolerance
          ) {
            // Precise hit test on actual outline geometry
            if (isPointNearParametricShape(worldPoint, shape, tolerance)) {
              return shape.id;
            }
          }
        }
      }

      // Check regular shapes
      const candidates = quadTree.queryPoint(worldPoint, tolerance);
      // Iterate in reverse to match z-order (last inserted = on top)
      for (let i = candidates.length - 1; i >= 0; i--) {
        const shape = shapes.find(s => s.id === candidates[i].id);
        if (shape && isPointNearShape(worldPoint, shape, tolerance, activeDrawingScale)) {
          return shape.id;
        }
      }
      return null;
    },
    [quadTree, shapes, parametricShapes, activeDrawingId, viewport.zoom, activeDrawingScale]
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
      // Skip if was panning, just finished box selection, or just finished grip drag
      if (panZoom.getIsPanning()) return;
      if (boxSelection.justFinishedBoxSelection()) return;
      if (gripEditing.justFinishedGripDrag()) return;
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

      // Handle pending section placement first
      if (pendingSection) {
        insertProfile(
          pendingSection.profileType,
          snappedPos,
          activeLayerId,
          activeDrawingId,
          {
            parameters: pendingSection.parameters,
            presetId: pendingSection.presetId,
            rotation: pendingSection.rotation,
          }
        );
        clearPendingSection();
        setSectionPlacementPreview(null);
        return;
      }

      // Handle beam drawing
      if (activeTool === 'beam' && pendingBeam) {
        deselectAll();
        // Pass the source angle from snap result for perpendicular tracking
        let sourceAngle = snapResult.snapInfo?.sourceAngle;

        // Fallback 1: if snap has sourceShapeId but no sourceAngle, compute it from the shape
        if (sourceAngle === undefined && snapResult.snapInfo?.sourceShapeId) {
          // Use getState() to avoid stale closure issues
          const { shapes: currentShapes } = useAppStore.getState();
          const sourceShape = currentShapes.find(s => s.id === snapResult.snapInfo?.sourceShapeId);
          if (sourceShape) {
            if (sourceShape.type === 'beam') {
              const beam = sourceShape as any;
              sourceAngle = Math.atan2(beam.end.y - beam.start.y, beam.end.x - beam.start.x);
            } else if (sourceShape.type === 'line') {
              const line = sourceShape as any;
              sourceAngle = Math.atan2(line.end.y - line.start.y, line.end.x - line.start.x);
            }
          }
        }

        // Fallback 2: find nearest beam/line at click point and use its angle
        if (sourceAngle === undefined) {
          const tolerance = 20 / viewport.zoom; // Wider tolerance for finding nearby shapes
          // Use getState() to avoid stale closure issues
          const { shapes: currentShapes, activeDrawingId: currentDrawingId } = useAppStore.getState();
          const drawingShapes = currentShapes.filter(s => s.drawingId === currentDrawingId && s.visible);

          for (const shape of drawingShapes) {
            if (shape.type === 'beam') {
              const beam = shape as any;
              // Check distance to beam
              const dx = beam.end.x - beam.start.x;
              const dy = beam.end.y - beam.start.y;
              const length = Math.sqrt(dx * dx + dy * dy);
              if (length > 0) {
                // Project click point onto beam line
                const t = Math.max(0, Math.min(1,
                  ((snappedPos.x - beam.start.x) * dx + (snappedPos.y - beam.start.y) * dy) / (length * length)
                ));
                const closestX = beam.start.x + t * dx;
                const closestY = beam.start.y + t * dy;
                const dist = Math.sqrt((snappedPos.x - closestX) ** 2 + (snappedPos.y - closestY) ** 2);

                if (dist < tolerance + beam.flangeWidth / 2) {
                  sourceAngle = Math.atan2(dy, dx);
                  break;
                }
              }
            } else if (shape.type === 'line') {
              const line = shape as any;
              const dx = line.end.x - line.start.x;
              const dy = line.end.y - line.start.y;
              const length = Math.sqrt(dx * dx + dy * dy);
              if (length > 0) {
                const t = Math.max(0, Math.min(1,
                  ((snappedPos.x - line.start.x) * dx + (snappedPos.y - line.start.y) * dy) / (length * length)
                ));
                const closestX = line.start.x + t * dx;
                const closestY = line.start.y + t * dy;
                const dist = Math.sqrt((snappedPos.x - closestX) ** 2 + (snappedPos.y - closestY) ** 2);

                if (dist < tolerance) {
                  sourceAngle = Math.atan2(dy, dx);
                  break;
                }
              }
            }
          }
        }

        // Validate sourceAngle is a valid number before passing
        const validSourceAngle = (sourceAngle !== undefined && !isNaN(sourceAngle)) ? sourceAngle : undefined;

        if (beamDrawing.handleBeamClick(snappedPos, e.shiftKey, validSourceAngle)) {
          snapDetection.clearTracking();
          return;
        }
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
            // Ctrl or Shift for additive/toggle selection
            selectShape(shapeId, e.ctrlKey || e.shiftKey);
          } else {
            boundaryEditing.deselectBoundary();
            // Only deselect all if not holding Ctrl/Shift
            if (!e.ctrlKey && !e.shiftKey) {
              deselectAll();
            }
          }
          break;
        }

        case 'line':
        case 'rectangle':
        case 'circle':
        case 'arc':
        case 'polyline':
        case 'spline':
        case 'ellipse':
        case 'hatch':
          // Clear selection when starting to draw
          deselectAll();
          shapeDrawing.handleDrawingClick(snappedPos, e.shiftKey, snapResult.snapInfo);
          // Clear snap/tracking indicators after click - they'll be recalculated on next mouse move
          snapDetection.clearTracking();
          break;

        case 'dimension':
          deselectAll();
          shapeDrawing.handleDrawingClick(snappedPos, e.shiftKey, snapResult.snapInfo);
          snapDetection.clearTracking();
          break;

        case 'text':
          deselectAll();
          textDrawing.handleTextClick(snappedPos);
          snapDetection.clearTracking();
          break;

        case 'image': {
          deselectAll();
          // Open file dialog, import image, place at click point
          (async () => {
            try {
              const filePath = await showImportImageDialog();
              if (!filePath) return;
              const result = await importImage(filePath);
              const { activeLayerId: layerId, activeDrawingId: drawingId } = useAppStore.getState();
              // Scale image: use original pixel dimensions as world units
              const imageShape: ImageShape = {
                id: crypto.randomUUID(),
                type: 'image',
                layerId,
                drawingId,
                style: { strokeColor: '#ffffff', strokeWidth: 1, lineStyle: 'solid' },
                visible: true,
                locked: false,
                position: { x: snappedPos.x - result.width / 2, y: snappedPos.y - result.height / 2 },
                width: result.width,
                height: result.height,
                rotation: 0,
                imageData: result.dataUrl,
                sourcePath: result.filePath,
                originalWidth: result.width,
                originalHeight: result.height,
                opacity: 1,
                maintainAspectRatio: true,
              };
              useAppStore.getState().addShapes([imageShape]);
              setActiveTool('select');
            } catch (err) {
              console.error('Failed to import image:', err);
            }
          })();
          break;
        }

        case 'pan':
          // Pan tool doesn't use click
          break;

        case 'move':
        case 'copy':
        case 'rotate':
        case 'scale':
        case 'mirror':
        case 'array':
        case 'trim':
        case 'extend':
        case 'fillet':
        case 'chamfer':
        case 'offset':
          modifyTools.handleModifyClick(snappedPos, e.shiftKey, findShapeAtPoint);
          snapDetection.clearTracking();
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
      findShapeAtPoint,
      activeTool,
      boundaryEditing,
      selectShape,
      deselectAll,
      modifyTools,
      beamDrawing,
      pendingBeam,
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
        if (gripEditing.handleGripMouseMove(worldPos, e.shiftKey)) {
          return;
        }

        // Update grip axis hover highlighting (no cursor change)
        if (activeTool === 'select') {
          gripEditing.getHoveredAxis(worldPos);
        }
      }

      // Box selection
      if (boxSelection.isSelecting()) {
        boxSelection.updateBoxSelection(screenPos);
        return;
      }

      // Pending section placement preview
      if (pendingSection && editorMode === 'drawing') {
        const worldPos = screenToWorld(screenPos.x, screenPos.y, viewport);
        const basePoint = shapeDrawing.getLastDrawingPoint();
        const snapResult = snapDetection.snapPoint(worldPos, basePoint);
        setSectionPlacementPreview(snapResult.point);
        return;
      }

      // Beam drawing preview
      if (activeTool === 'beam' && pendingBeam && editorMode === 'drawing') {
        const worldPos = screenToWorld(screenPos.x, screenPos.y, viewport);
        // Use the beam's first point as base for tracking (shows polar tracking lines)
        // Pass sourceSnapAngle for perpendicular/parallel tracking to snapped beam edge
        // IMPORTANT: Use getState() to get fresh sourceSnapAngle (avoids stale closure after click)
        const basePoint = beamDrawing.getBeamBasePoint();
        const freshSourceSnapAngle = useAppStore.getState().sourceSnapAngle;
        const snapResult = snapDetection.snapPoint(worldPos, basePoint ?? undefined, freshSourceSnapAngle ?? undefined);
        beamDrawing.updateBeamPreview(snapResult.point, e.shiftKey);
        return;
      }

      // Modify tools - update preview
      const isModifyToolActive = ['move', 'copy', 'rotate', 'scale', 'mirror', 'array', 'trim', 'extend', 'fillet', 'chamfer', 'offset'].includes(activeTool);
      if (isModifyToolActive && editorMode === 'drawing') {
        const worldPos = screenToWorld(screenPos.x, screenPos.y, viewport);
        const basePoint = shapeDrawing.getLastDrawingPoint();
        const snapResult = snapDetection.snapPoint(worldPos, basePoint);
        modifyTools.updateModifyPreview(snapResult.point);

        // Hover highlight for trim/extend/fillet/offset
        if (['trim', 'extend', 'fillet', 'chamfer', 'offset'].includes(activeTool)) {
          const hoveredShape = findShapeAtPoint(worldPos);
          setHoveredShapeId(hoveredShape);
        } else {
          setHoveredShapeId(null);
        }
        return;
      }

      // Drawing tools - always detect snaps when hovering (even before first click)
      const isDrawingTool = ['line', 'rectangle', 'circle', 'arc', 'polyline', 'spline', 'ellipse', 'hatch', 'dimension'].includes(activeTool);

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
            (dimensionMode === 'radius' || dimensionMode === 'diameter' || dimensionMode === 'angular' || dimensionMode === 'arc-length');
          if (needsHover) {
            const hoveredShape = findShapeAtPoint(worldPos);
            setHoveredShapeId(hoveredShape);
          } else {
            setHoveredShapeId(null);
          }
        } else if (pickLinesMode && (activeTool === 'line' || activeTool === 'circle' || activeTool === 'arc')) {
          // Pick-lines mode: highlight shape under cursor
          const hoveredShape = findShapeAtPoint(worldPos);
          setHoveredShapeId(hoveredShape);
        } else {
          setHoveredShapeId(null);
        }
      } else {
        setHoveredShapeId(null);
      }
    },
    [panZoom, annotationEditing, viewportEditing, editorMode, viewport, boundaryEditing, gripEditing, boxSelection, shapeDrawing, snapDetection, activeTool, dimensionMode, pickLinesMode, findShapeAtPoint, setHoveredShapeId, canvasRef, modifyTools, beamDrawing, pendingBeam, sourceSnapAngle]
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
        boxSelection.endBoxSelection(screenPos, e.ctrlKey || e.shiftKey);
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

      // In sheet mode, finish leader if active, deselect annotation tools, then show context menu
      if (editorMode === 'sheet') {
        annotationEditing.finishLeader();

        // If an annotation tool is selected, deselect it (similar to drawing tools behavior)
        const annotationTools = ['sheet-text', 'sheet-leader', 'sheet-revision-cloud', 'sheet-callout'];
        if (annotationTools.includes(activeTool)) {
          setActiveTool('select');
        }

        const menu = document.createElement('div');
        menu.className = 'fixed z-[9999] bg-cad-surface border border-cad-border shadow-lg text-xs';
        menu.style.left = `${e.clientX}px`;
        menu.style.top = `${e.clientY}px`;

        const onOutsideClick = (ev: MouseEvent) => { if (!menu.contains(ev.target as Node)) cleanup(); };
        const escHandler = (ev: KeyboardEvent) => { if (ev.key === 'Escape') cleanup(); };
        function cleanup() { menu.remove(); document.removeEventListener('mousedown', onOutsideClick); document.removeEventListener('keydown', escHandler); }

        const items = [
          { label: 'Print', action: () => setPrintDialogOpen(true) },
          { label: 'Print Preview', action: () => setPrintDialogOpen(true) },
        ];

        items.forEach(item => {
          const el = document.createElement('div');
          el.className = 'px-4 py-1.5 hover:bg-cad-hover cursor-pointer text-cad-text';
          el.textContent = item.label;
          el.onclick = () => { cleanup(); item.action(); };
          menu.appendChild(el);
        });

        document.body.appendChild(menu);
        setTimeout(() => {
          document.addEventListener('mousedown', onOutsideClick);
          document.addEventListener('keydown', escHandler);
        }, 0);

        return;
      }

      // In drawing mode
      // Cancel pending section placement
      if (pendingSection) {
        clearPendingSection();
        setSectionPlacementPreview(null);
        return;
      }

      // Cancel beam drawing
      if (pendingBeam) {
        beamDrawing.cancelBeamDrawing();
        setActiveTool('select');
        return;
      }

      // If actively drawing, finish the drawing
      if (shapeDrawing.isDrawing()) {
        shapeDrawing.finishDrawing();
        // Clear snap/tracking indicators
        snapDetection.clearTracking();
        return;
      }

      // Check if right-clicking on a parametric shape - show context menu
      const screenPos = panZoom.getMousePos(e);
      const worldPos = screenToWorld(screenPos.x, screenPos.y, viewport);
      const clickedShapeId = findShapeAtPoint(worldPos);
      const clickedParametricShape = clickedShapeId
        ? parametricShapes.find(s => s.id === clickedShapeId)
        : null;

      // Check if any selected shapes are parametric
      const hasSelectedParametric = selectedShapeIds.some(id =>
        parametricShapes.some(s => s.id === id)
      );

      if (clickedParametricShape || hasSelectedParametric) {
        // Build list of parametric shape IDs to operate on
        const parametricIdsToExplode: string[] = [];

        if (hasSelectedParametric) {
          // Use selected parametric shapes
          for (const id of selectedShapeIds) {
            if (parametricShapes.some(s => s.id === id)) {
              parametricIdsToExplode.push(id);
            }
          }
        } else if (clickedParametricShape) {
          // Use clicked parametric shape
          parametricIdsToExplode.push(clickedParametricShape.id);
        }

        if (parametricIdsToExplode.length > 0) {
          const menu = document.createElement('div');
          menu.className = 'fixed z-[9999] bg-cad-surface border border-cad-border shadow-lg text-xs rounded';
          menu.style.left = `${e.clientX}px`;
          menu.style.top = `${e.clientY}px`;

          const onOutsideClick = (ev: MouseEvent) => { if (!menu.contains(ev.target as Node)) cleanup(); };
          const escHandler = (ev: KeyboardEvent) => { if (ev.key === 'Escape') cleanup(); };
          function cleanup() { menu.remove(); document.removeEventListener('mousedown', onOutsideClick); document.removeEventListener('keydown', escHandler); }

          const items = [
            {
              label: parametricIdsToExplode.length > 1 ? 'Convert to Polylines' : 'Convert to Polyline',
              action: () => {
                const exploded = explodeParametricShapes(parametricIdsToExplode);
                if (exploded.length > 0) {
                  addShapes(exploded);
                }
              }
            },
          ];

          items.forEach(item => {
            const el = document.createElement('div');
            el.className = 'px-4 py-1.5 hover:bg-cad-hover cursor-pointer text-cad-text';
            el.textContent = item.label;
            el.onclick = () => { cleanup(); item.action(); };
            menu.appendChild(el);
          });

          document.body.appendChild(menu);
          setTimeout(() => {
            document.addEventListener('mousedown', onOutsideClick);
            document.addEventListener('keydown', escHandler);
          }, 0);

          return;
        }
      }

      // Modify tools: right-click finishes / cancels
      const modifyToolsList = ['move', 'copy', 'rotate', 'scale', 'mirror', 'array', 'trim', 'extend', 'fillet', 'chamfer', 'offset'];
      if (modifyToolsList.includes(activeTool)) {
        modifyTools.finishModify();
        setActiveTool('select');
        snapDetection.clearTracking();
        return;
      }

      // If a drawing or annotation tool is selected but not actively drawing, deselect it
      const drawingTools = ['line', 'rectangle', 'circle', 'arc', 'polyline', 'spline', 'ellipse', 'hatch', 'text', 'dimension', 'beam', 'image'];
      if (drawingTools.includes(activeTool)) {
        setActiveTool('select');
        // Clear any lingering snap/tracking indicators
        snapDetection.clearTracking();
      }
    },
    [editorMode, annotationEditing, shapeDrawing, activeTool, setActiveTool, snapDetection, modifyTools, setPrintDialogOpen,
     panZoom, viewport, findShapeAtPoint, parametricShapes, selectedShapeIds, explodeParametricShapes, addShapes,
     pendingSection, clearPendingSection, setSectionPlacementPreview, pendingBeam, beamDrawing]
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

  // Store refs to the editing hooks to avoid stale closures in window listeners
  const editingRefs = useRef({
    panZoom,
    annotationEditing,
    viewportEditing,
    boundaryEditing,
    gripEditing,
    boxSelection,
    viewport,
    editorMode,
    canvasRef,
  });

  // Keep refs updated on every render
  editingRefs.current = {
    panZoom,
    annotationEditing,
    viewportEditing,
    boundaryEditing,
    gripEditing,
    boxSelection,
    viewport,
    editorMode,
    canvasRef,
  };

  // Attach window-level listeners for drag operations (always active)
  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      const refs = editingRefs.current;

      // Check if any drag is active by querying the current state
      const anyDragActive =
        refs.panZoom.getIsPanning() ||
        refs.gripEditing.isDragging() ||
        refs.boundaryEditing.isDragging() ||
        refs.viewportEditing.isDragging() ||
        refs.annotationEditing.isDragging ||
        refs.boxSelection.isSelecting();

      if (!anyDragActive) return;

      const canvas = refs.canvasRef.current;
      if (!canvas) return;

      const rect = canvas.getBoundingClientRect();
      const screenPos = { x: e.clientX - rect.left, y: e.clientY - rect.top };

      // Sheet mode: annotation dragging
      if (refs.annotationEditing.handleAnnotationMouseMove(screenPos)) {
        return;
      }

      // Sheet mode: viewport dragging
      if (refs.viewportEditing.handleViewportMouseMove(screenPos)) {
        return;
      }

      // Drawing mode: boundary dragging
      if (refs.editorMode === 'drawing') {
        const worldPos = screenToWorld(screenPos.x, screenPos.y, refs.viewport);
        if (refs.boundaryEditing.handleBoundaryMouseMove(worldPos)) {
          return;
        }
      }

      // Drawing mode: grip dragging
      if (refs.editorMode === 'drawing') {
        const worldPos = screenToWorld(screenPos.x, screenPos.y, refs.viewport);
        if (refs.gripEditing.handleGripMouseMove(worldPos, e.shiftKey)) {
          return;
        }
      }

      // Box selection
      if (refs.boxSelection.isSelecting()) {
        refs.boxSelection.updateBoxSelection(screenPos);
      }
    };

    const onMouseUp = (e: MouseEvent) => {
      const refs = editingRefs.current;

      // Check if any drag is active
      const anyDragActive =
        refs.panZoom.getIsPanning() ||
        refs.gripEditing.isDragging() ||
        refs.boundaryEditing.isDragging() ||
        refs.viewportEditing.isDragging() ||
        refs.annotationEditing.isDragging ||
        refs.boxSelection.isSelecting();

      if (!anyDragActive) return;

      refs.panZoom.handlePanMouseUp();

      // Sheet mode: annotation drag end
      if (refs.annotationEditing.handleAnnotationMouseUp()) {
        return;
      }

      // Sheet mode: viewport drag end
      if (refs.viewportEditing.handleViewportMouseUp()) {
        return;
      }

      // Draft mode: boundary drag end
      if (refs.boundaryEditing.handleBoundaryMouseUp()) {
        return;
      }

      // Drawing mode: grip drag end
      if (refs.gripEditing.handleGripMouseUp()) {
        return;
      }

      // Box selection end
      if (refs.boxSelection.isSelecting() && refs.canvasRef.current) {
        const rect = refs.canvasRef.current.getBoundingClientRect();
        const screenPos = { x: e.clientX - rect.left, y: e.clientY - rect.top };
        refs.boxSelection.endBoxSelection(screenPos, e.ctrlKey || e.shiftKey);
      }
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);

    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, []); // Empty deps - we use refs to get current values

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
