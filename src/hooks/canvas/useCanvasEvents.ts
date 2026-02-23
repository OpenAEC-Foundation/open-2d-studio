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
import { useAppStore, generateId } from '../../state/appStore';
import type { Point, GridlineShape, BeamShape, PlateSystemShape, PlateSystemOpening, WallShape } from '../../types/geometry';
import { screenToWorld, isPointNearShape, isPointNearParametricShape, snapToAngle, bulgeToArc, calculateBulgeFrom3Points } from '../../engine/geometry/GeometryUtils';
import { regeneratePlateSystemBeams } from '../drawing/usePlateSystemDrawing';
import { QuadTree } from '../../engine/spatial/QuadTree';
import { isShapeInHiddenCategory } from '../../utils/ifcCategoryUtils';
import { hitTestWallSubElement } from '../../services/wallSystem/wallSystemService';

import { usePanZoom } from '../navigation/usePanZoom';
import { useBoxSelection } from '../selection/useBoxSelection';
import { useSnapDetection } from '../snap/useSnapDetection';
import { useShapeDrawing } from '../drawing/useShapeDrawing';
import { useTextDrawing } from '../drawing/useTextDrawing';
import { useBoundaryEditing } from '../editing/useBoundaryEditing';
import { useViewportEditing } from '../editing/useViewportEditing';
import { useAnnotationEditing } from '../editing/useAnnotationEditing';
import { useTitleBlockEditing } from '../editing/useTitleBlockEditing';
import { useGripEditing } from '../editing/useGripEditing';
import { useModifyTools } from '../editing/useModifyTools';
import { useBeamDrawing } from '../drawing/useBeamDrawing';
import { useGridlineDrawing } from '../drawing/useGridlineDrawing';
import { usePileDrawing } from '../drawing/usePileDrawing';
import { useCPTDrawing } from '../drawing/useCPTDrawing';
import { useWallDrawing } from '../drawing/useWallDrawing';
import { useSlabDrawing } from '../drawing/useSlabDrawing';
import { useLevelDrawing } from '../drawing/useLevelDrawing';
import { usePuntniveauDrawing } from '../drawing/usePuntniveauDrawing';
import { useLeaderDrawing } from '../drawing/useLeaderDrawing';
import { useSectionCalloutDrawing } from '../drawing/useSectionCalloutDrawing';
import { useSpaceDrawing } from '../drawing/useSpaceDrawing';
import { usePlateSystemDrawing } from '../drawing/usePlateSystemDrawing';
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
  const titleBlockEditing = useTitleBlockEditing();
  const gripEditing = useGripEditing();
  const modifyTools = useModifyTools();
  const beamDrawing = useBeamDrawing();
  const gridlineDrawing = useGridlineDrawing();
  const pileDrawing = usePileDrawing();
  const cptDrawing = useCPTDrawing();
  const wallDrawing = useWallDrawing();
  const slabDrawing = useSlabDrawing();
  const levelDrawing = useLevelDrawing();
  const puntniveauDrawing = usePuntniveauDrawing();
  const leaderDrawing = useLeaderDrawing();
  const sectionCalloutDrawing = useSectionCalloutDrawing();
  const spaceDrawing = useSpaceDrawing();
  const plateSystemDrawing = usePlateSystemDrawing();

  const {
    viewport,
    activeTool,
    setActiveTool,
    shapes,
    parametricShapes,
    selectShape,
    selectShapes,
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
    pendingGridline,
    pendingPile,
    pendingCPT,
    pendingWall,
    pendingSlab,
    pendingLevel,
    pendingPuntniveau,
    pendingSectionCallout,
    pendingSpace,
    pendingPlateSystem,
    explodeParametricShapes,
    addShapes,
    selectedShapeIds,
    drawings,
    sourceSnapAngle,
    switchToDrawing,
    updateShape,
    startGridlineLabelEdit,
    setCursor2D,
    modifyOrtho,
    plateSystemEditMode,
    editingPlateSystemId,
    setPlateSystemEditMode,
    plateSystemSubTool,
    setPlateSystemSubTool,
    plateSystemOpeningMode,
    setPlateSystemOpeningMode,
    selectedOpeningId,
    setSelectedOpeningId,
    hiddenIfcCategories,
    wallSystemTypes,
    selectWallSubElement,
    clearWallSubElement,
    selectedWallSubElement,
  } = useAppStore();

  // Get the active drawing's scale for text hit detection
  const activeDrawingScale = useMemo(() => {
    const drawing = drawings.find(d => d.id === activeDrawingId);
    return drawing?.scale ?? 0.02; // Default to 1:50
  }, [drawings, activeDrawingId]);

  // Build spatial index for efficient shape lookup
  const quadTree = useMemo(() => {
    return QuadTree.buildFromShapes(shapes, activeDrawingId, activeDrawingScale);
  }, [shapes, activeDrawingId, activeDrawingScale]);

  // Right-button drag state for 2D cursor placement
  // lastSnappedPos stores the snapped position from the most recent mousemove during drag,
  // so mouseUp can use it instead of recalculating (which could produce a different result
  // due to sub-pixel coordinate differences between mousemove and mouseup events).
  const rightDragRef = useRef<{ isDragging: boolean; startX: number; startY: number; didDrag: boolean; lastSnappedPos: Point | null }>({
    isDragging: false, startX: 0, startY: 0, didDrag: false, lastSnappedPos: null,
  });

  /**
   * Resolve plate system hit: when a child beam is hit, redirect to parent
   * plate system unless we are in edit mode for that specific system.
   */
  const resolvePlateSystemHit = useCallback(
    (shapeId: string): string | null => {
      const shape = shapes.find(s => s.id === shapeId);
      if (!shape) return shapeId;

      // If shape is a child beam of a plate system
      if (shape.type === 'beam') {
        const beam = shape as BeamShape;
        if (beam.plateSystemId) {
          // In edit mode for THIS system: allow direct child beam selection
          if (plateSystemEditMode && editingPlateSystemId === beam.plateSystemId) {
            return shapeId;
          }
          // Not in edit mode (or different system): redirect to parent
          return beam.plateSystemId;
        }
      }
      return shapeId;
    },
    [shapes, plateSystemEditMode, editingPlateSystemId]
  );

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

      // First pass: check text shapes (labels, annotations) before other shapes.
      // This ensures labels are independently selectable even when overlapping
      // with walls/beams they are linked to.
      for (let i = candidates.length - 1; i >= 0; i--) {
        const shape = shapes.find(s => s.id === candidates[i].id);
        if (shape && shape.type === 'text' && !isShapeInHiddenCategory(shape, hiddenIfcCategories) && isPointNearShape(worldPoint, shape, tolerance, activeDrawingScale)) {
          return resolvePlateSystemHit(shape.id);
        }
      }

      // Second pass: check all other shapes in reverse z-order
      for (let i = candidates.length - 1; i >= 0; i--) {
        const shape = shapes.find(s => s.id === candidates[i].id);
        if (shape && shape.type !== 'text' && !isShapeInHiddenCategory(shape, hiddenIfcCategories) && isPointNearShape(worldPoint, shape, tolerance, activeDrawingScale)) {
          return resolvePlateSystemHit(shape.id);
        }
      }
      return null;
    },
    [quadTree, shapes, parametricShapes, activeDrawingId, viewport.zoom, activeDrawingScale, hiddenIfcCategories, resolvePlateSystemHit]
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
      // Skip grip editing when a modify tool or a drawing tool with pending state is active —
      // clicks should go to the tool handler, not start a grip drag
      const modifyToolActive = ['move', 'copy', 'copy2', 'rotate', 'scale', 'mirror', 'array', 'trim', 'extend', 'fillet', 'chamfer', 'offset', 'elastic', 'trim-walls'].includes(activeTool);
      const drawingTools = ['wall', 'beam', 'gridline', 'level', 'slab', 'puntniveau', 'pile', 'cpt', 'section-callout', 'space', 'plate-system'];
      const isDrawingToolActive = drawingTools.includes(activeTool) || !!pendingSection;
      const drawingToolWithPending = isDrawingToolActive && !!(
        pendingWall || pendingBeam || pendingGridline || pendingLevel ||
        pendingSlab || pendingPuntniveau || pendingPile || pendingCPT ||
        pendingSectionCallout || pendingSpace || pendingPlateSystem || pendingSection
      );
      if (editorMode === 'drawing' && e.button === 0 && !modifyToolActive && !drawingToolWithPending) {
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

      // Right-button press: start tracking for 2D cursor drag
      if (e.button === 2 && editorMode === 'drawing') {
        rightDragRef.current = { isDragging: true, startX: e.clientX, startY: e.clientY, didDrag: false, lastSnappedPos: null };
      }
    },
    [panZoom, editorMode, viewport, annotationEditing, viewportEditing, boundaryEditing, gripEditing, findShapeAtPoint, boxSelection, activeTool, pendingWall, pendingBeam, pendingGridline, pendingLevel, pendingSlab, pendingPuntniveau, pendingPile, pendingCPT, pendingSectionCallout, pendingSpace, pendingPlateSystem, pendingSection]
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

      // Sheet mode: title block field editing, annotation tools, or viewport selection
      if (editorMode === 'sheet') {
        // Handle title block field click first
        if (titleBlockEditing.handleTitleBlockClick(screenPos)) {
          return;
        }

        // Handle annotation tool clicks
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

      // Handle gridline drawing
      if (activeTool === 'gridline' && pendingGridline) {
        deselectAll();
        if (gridlineDrawing.handleGridlineClick(snappedPos, e.shiftKey)) {
          snapDetection.clearTracking();
          return;
        }
      }

      // Handle level drawing (two-click)
      if (activeTool === 'level' && pendingLevel) {
        deselectAll();
        if (levelDrawing.handleLevelClick(snappedPos, e.shiftKey)) {
          snapDetection.clearTracking();
          return;
        }
      }

      // Handle pile placement (single-click)
      if (activeTool === 'pile' && pendingPile) {
        deselectAll();
        if (pileDrawing.handlePileClick(snappedPos)) {
          return;
        }
      }

      // Handle CPT placement (single-click)
      if (activeTool === 'cpt' && pendingCPT) {
        deselectAll();
        if (cptDrawing.handleCPTClick(snappedPos)) {
          return;
        }
      }

      // Handle wall drawing (two-click for line, three-click for arc)
      if (activeTool === 'wall' && pendingWall) {
        deselectAll();
        if (wallDrawing.handleWallClick(snappedPos, e.shiftKey)) {
          snapDetection.clearTracking();
          return;
        }
      }

      // Handle slab drawing (multi-click polygon)
      if (activeTool === 'slab' && pendingSlab) {
        deselectAll();
        if (slabDrawing.handleSlabClick(snappedPos, e.shiftKey)) {
          snapDetection.clearTracking();
          return;
        }
      }

      // Handle puntniveau drawing (multi-click polygon)
      if (activeTool === 'puntniveau' && pendingPuntniveau) {
        deselectAll();
        if (puntniveauDrawing.handlePuntniveauClick(snappedPos, e.shiftKey)) {
          snapDetection.clearTracking();
          return;
        }
      }

      // Handle plate system drawing (multi-click polygon)
      if (activeTool === 'plate-system' && pendingPlateSystem) {
        deselectAll();
        if (plateSystemDrawing.handlePlateSystemClick(snappedPos, e.shiftKey)) {
          snapDetection.clearTracking();
          return;
        }
      }

      // Handle section callout drawing (two-click)
      if (activeTool === 'section-callout' && pendingSectionCallout) {
        deselectAll();
        if (sectionCalloutDrawing.handleSectionCalloutClick(snappedPos, e.shiftKey)) {
          snapDetection.clearTracking();
          return;
        }
      }

      // Handle space drawing (single-click to detect room)
      if (activeTool === 'space' && pendingSpace) {
        deselectAll();
        if (spaceDrawing.handleSpaceClick(snappedPos)) {
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

          // Plate system edit mode: dispatch based on sub-tool
          if (plateSystemEditMode && editingPlateSystemId) {
            const editingSystem = shapes.find(s => s.id === editingPlateSystemId) as PlateSystemShape | undefined;
            if (!editingSystem) break;

            const tolerance = 8 / viewport.zoom;
            const psContour = editingSystem.contourPoints;
            const psBulges = editingSystem.contourBulges;
            const psN = psContour.length;

            // ── Helper: point-in-polygon test ──
            const isInsideContour = (pt: Point): boolean => {
              let ins = false;
              for (let ii = 0, jj = psN - 1; ii < psN; jj = ii++) {
                const xi = psContour[ii].x, yi = psContour[ii].y;
                const xj = psContour[jj].x, yj = psContour[jj].y;
                if (((yi > pt.y) !== (yj > pt.y)) &&
                    (pt.x < (xj - xi) * (pt.y - yi) / (yj - yi) + xi)) {
                  ins = !ins;
                }
              }
              return ins;
            };

            // ── Helper: find nearest contour edge index (tolerance) ──
            const findNearestEdge = (pt: Point): number => {
              let bestDist = Infinity;
              let bestIdx = -1;
              for (let ii = 0; ii < psN; ii++) {
                const jj = (ii + 1) % psN;
                const b = psBulges ? (psBulges[ii] ?? 0) : 0;
                let dist: number;
                if (Math.abs(b) > 0.0001) {
                  // Arc edge: distance to arc
                  const { center, radius, startAngle, endAngle, clockwise } = bulgeToArc(psContour[ii], psContour[jj], b);
                  const ddx = pt.x - center.x;
                  const ddy = pt.y - center.y;
                  dist = Math.abs(Math.sqrt(ddx * ddx + ddy * ddy) - radius);
                  // Also check angle is within sweep
                  const ang = Math.atan2(ddy, ddx);
                  const TWO_PI = Math.PI * 2;
                  const norm = (a: number) => { let n = a % TWO_PI; if (n < 0) n += TWO_PI; return n; };
                  const nA = norm(ang), nS = norm(startAngle), nE = norm(endAngle);
                  let inSweep: boolean;
                  if (clockwise) {
                    inSweep = nS >= nE ? (nA <= nS + 0.01 && nA >= nE - 0.01) : (nA <= nS + 0.01 || nA >= nE - 0.01);
                  } else {
                    inSweep = nS <= nE ? (nA >= nS - 0.01 && nA <= nE + 0.01) : (nA >= nS - 0.01 || nA <= nE + 0.01);
                  }
                  if (!inSweep) dist = Infinity;
                } else {
                  // Straight edge: point-to-segment distance
                  const ex = psContour[jj].x - psContour[ii].x;
                  const ey = psContour[jj].y - psContour[ii].y;
                  const eLen = Math.sqrt(ex * ex + ey * ey);
                  if (eLen < 0.001) { dist = Infinity; } else {
                    const t = Math.max(0, Math.min(1, ((pt.x - psContour[ii].x) * ex + (pt.y - psContour[ii].y) * ey) / (eLen * eLen)));
                    const cx = psContour[ii].x + t * ex;
                    const cy = psContour[ii].y + t * ey;
                    dist = Math.sqrt((pt.x - cx) ** 2 + (pt.y - cy) ** 2);
                  }
                }
                if (dist < bestDist) { bestDist = dist; bestIdx = ii; }
              }
              return bestDist <= tolerance ? bestIdx : -1;
            };

            // ── Helper: find nearest vertex index (tolerance) ──
            const findNearestVertex = (pt: Point): number => {
              let bestDist = Infinity;
              let bestIdx = -1;
              for (let ii = 0; ii < psN; ii++) {
                const d = Math.sqrt((pt.x - psContour[ii].x) ** 2 + (pt.y - psContour[ii].y) ** 2);
                if (d < bestDist) { bestDist = d; bestIdx = ii; }
              }
              return bestDist <= tolerance ? bestIdx : -1;
            };

            // ── Helper: find clicked opening ──
            const findClickedOpening = (pt: Point): PlateSystemOpening | null => {
              if (!editingSystem.openings) return null;
              for (const opening of editingSystem.openings) {
                const ddx = pt.x - opening.position.x;
                const ddy = pt.y - opening.position.y;
                const rot = opening.rotation ?? 0;
                const cosR = Math.cos(-rot);
                const sinR = Math.sin(-rot);
                const lx = ddx * cosR - ddy * sinR;
                const ly = ddx * sinR + ddy * cosR;
                if (Math.abs(lx) <= opening.width / 2 && Math.abs(ly) <= opening.height / 2) return opening;
              }
              return null;
            };

            // ── Sub-tool dispatch ──
            switch (plateSystemSubTool) {
              // ────────────────────────── SELECT ──────────────────────────
              case 'select': {
                // Check opening click first
                const clickedOp = findClickedOpening(worldPos);
                if (clickedOp) {
                  setSelectedOpeningId(clickedOp.id);
                  deselectAll();
                  break;
                }
                setSelectedOpeningId(null);

                if (shapeId) {
                  const clickedShape = shapes.find(s => s.id === shapeId);
                  const isPartOfSystem =
                    shapeId === editingPlateSystemId ||
                    (clickedShape?.type === 'beam' && (clickedShape as BeamShape).plateSystemId === editingPlateSystemId);
                  if (!isPartOfSystem) {
                    setPlateSystemEditMode(false);
                    boundaryEditing.deselectBoundary();
                    selectShape(shapeId, e.ctrlKey || e.shiftKey);
                    break;
                  }
                  boundaryEditing.deselectBoundary();
                  selectShape(shapeId, e.ctrlKey || e.shiftKey);
                } else {
                  setPlateSystemEditMode(false);
                  boundaryEditing.deselectBoundary();
                  if (!e.ctrlKey && !e.shiftKey) deselectAll();
                }
                break;
              }

              // ────────────────────────── ADD POINT ──────────────────────────
              case 'add-point': {
                const edgeIdx = findNearestEdge(worldPos);
                if (edgeIdx < 0) break;

                // Project click onto the edge to get the insertion point
                const ii = edgeIdx;
                const jj = (ii + 1) % psN;
                const b = psBulges ? (psBulges[ii] ?? 0) : 0;

                let insertPt: Point;
                if (Math.abs(b) > 0.0001) {
                  // Arc edge: project onto arc
                  const { center, radius } = bulgeToArc(psContour[ii], psContour[jj], b);
                  const a = Math.atan2(worldPos.y - center.y, worldPos.x - center.x);
                  insertPt = { x: center.x + radius * Math.cos(a), y: center.y + radius * Math.sin(a) };
                } else {
                  // Straight edge: project onto segment
                  const ex = psContour[jj].x - psContour[ii].x;
                  const ey = psContour[jj].y - psContour[ii].y;
                  const eLen2 = ex * ex + ey * ey;
                  const t = eLen2 > 0.001 ? Math.max(0.01, Math.min(0.99, ((worldPos.x - psContour[ii].x) * ex + (worldPos.y - psContour[ii].y) * ey) / eLen2)) : 0.5;
                  insertPt = { x: psContour[ii].x + t * ex, y: psContour[ii].y + t * ey };
                }

                // Insert vertex into contourPoints after index ii
                const newContour = [...psContour];
                newContour.splice(ii + 1, 0, insertPt);

                // Split bulge entry: existing edge at ii becomes two edges
                const newBulges = psBulges ? [...psBulges] : new Array(psN).fill(0);
                while (newBulges.length < psN) newBulges.push(0);
                if (Math.abs(b) > 0.0001) {
                  // Arc edge: calculate two sub-bulges.
                  // insertPt is already on the original circle.  Find the true arc
                  // midpoints of each sub-arc on that same circle.
                  const { center, radius } = bulgeToArc(psContour[ii], psContour[jj], b);
                  const angStart = Math.atan2(psContour[ii].y - center.y, psContour[ii].x - center.x);
                  const angInsert = Math.atan2(insertPt.y - center.y, insertPt.x - center.x);
                  const angEnd = Math.atan2(psContour[jj].y - center.y, psContour[jj].x - center.x);
                  // Sub-arc 1 midpoint: halfway between angStart and angInsert on the arc
                  const mid1Ang = angStart + ((angInsert - angStart + (b > 0 ? 0 : 2 * Math.PI)) % (2 * Math.PI)) / 2 * (b > 0 ? 1 : -1);
                  const mid1 = { x: center.x + radius * Math.cos(mid1Ang), y: center.y + radius * Math.sin(mid1Ang) };
                  // Sub-arc 2 midpoint: halfway between angInsert and angEnd on the arc
                  const mid2Ang = angInsert + ((angEnd - angInsert + (b > 0 ? 0 : 2 * Math.PI)) % (2 * Math.PI)) / 2 * (b > 0 ? 1 : -1);
                  const mid2 = { x: center.x + radius * Math.cos(mid2Ang), y: center.y + radius * Math.sin(mid2Ang) };
                  const b1 = calculateBulgeFrom3Points(psContour[ii], mid1, insertPt);
                  const b2 = calculateBulgeFrom3Points(insertPt, mid2, psContour[jj]);
                  newBulges.splice(ii, 1, b1, b2);
                } else {
                  // Straight edge: two straight edges
                  newBulges.splice(ii, 1, 0, 0);
                }

                // Update edgeBeamEnabled array
                const ebe = editingSystem.edgeBeamEnabled
                  ? [...editingSystem.edgeBeamEnabled]
                  : new Array(psN).fill(true);
                while (ebe.length < psN) ebe.push(true);
                const prevEnabled = ebe[ii];
                ebe.splice(ii, 1, prevEnabled, prevEnabled);

                updateShape(editingPlateSystemId, {
                  contourPoints: newContour,
                  contourBulges: newBulges,
                  edgeBeamEnabled: ebe,
                } as any);
                setTimeout(() => regeneratePlateSystemBeams(editingPlateSystemId), 0);
                break;
              }

              // ────────────────────────── ARC EDGE ──────────────────────────
              case 'arc-edge': {
                const edgeIdx = findNearestEdge(worldPos);
                if (edgeIdx < 0) break;

                // Initialise contourBulges if it doesn't exist
                const newBulges = psBulges ? [...psBulges] : new Array(psN).fill(0);
                while (newBulges.length < psN) newBulges.push(0);

                if (Math.abs(newBulges[edgeIdx]) > 0.0001) {
                  // Currently an arc → make straight
                  newBulges[edgeIdx] = 0;
                } else {
                  // Currently straight → make arc (default bulge 0.3)
                  newBulges[edgeIdx] = 0.3;
                }

                updateShape(editingPlateSystemId, { contourBulges: newBulges } as any);
                setTimeout(() => regeneratePlateSystemBeams(editingPlateSystemId), 0);
                // Switch to select so user can drag the arc midpoint grip
                setPlateSystemSubTool('select');
                break;
              }

              // ────────────────────────── ADD OPENING ──────────────────────────
              case 'add-opening': {
                if (isInsideContour(worldPos)) {
                  const newOpening: PlateSystemOpening = {
                    id: generateId(),
                    position: { x: worldPos.x, y: worldPos.y },
                    width: 300,
                    height: 300,
                    rotation: 0,
                  };
                  const existingOpenings = editingSystem.openings ?? [];
                  updateShape(editingPlateSystemId, {
                    openings: [...existingOpenings, newOpening],
                  } as any);
                  setSelectedOpeningId(newOpening.id);
                  // Stay in add-opening mode for rapid placement
                }
                break;
              }

              // ────────────────────────── DELETE ──────────────────────────
              case 'delete': {
                // Try opening first
                const clickedOp = findClickedOpening(worldPos);
                if (clickedOp) {
                  const remaining = (editingSystem.openings ?? []).filter(o => o.id !== clickedOp.id);
                  updateShape(editingPlateSystemId, { openings: remaining } as any);
                  setSelectedOpeningId(null);
                  setTimeout(() => regeneratePlateSystemBeams(editingPlateSystemId), 0);
                  break;
                }

                // Try vertex
                const vertIdx = findNearestVertex(worldPos);
                if (vertIdx >= 0 && psN > 3) {
                  const newContour = psContour.filter((_, i) => i !== vertIdx);
                  const newBulges = psBulges ? [...psBulges] : new Array(psN).fill(0);
                  while (newBulges.length < psN) newBulges.push(0);
                  // Remove the bulge for the deleted vertex and set previous edge to straight
                  newBulges.splice(vertIdx, 1);
                  // The edge that now connects the previous vertex to the next
                  // should be straight to avoid invalid arcs:
                  const prevEdge = (vertIdx - 1 + newContour.length) % newContour.length;
                  newBulges[prevEdge] = 0;

                  const ebe = editingSystem.edgeBeamEnabled
                    ? [...editingSystem.edgeBeamEnabled]
                    : new Array(psN).fill(true);
                  while (ebe.length < psN) ebe.push(true);
                  ebe.splice(vertIdx, 1);

                  updateShape(editingPlateSystemId, {
                    contourPoints: newContour,
                    contourBulges: newBulges,
                    edgeBeamEnabled: ebe,
                  } as any);
                  setTimeout(() => regeneratePlateSystemBeams(editingPlateSystemId), 0);
                }
                break;
              }
            }
            break;
          }

          // If pre-selected shapes exist, confirm them as selection on click
          {
            const s = useAppStore.getState();
            if (s.preSelectedShapeIds.length > 0) {
              boundaryEditing.deselectBoundary();
              s.selectShapes(s.preSelectedShapeIds);
              s.setPreSelectedShapes([]);
              break;
            }
          }

          if (shapeId) {
            boundaryEditing.deselectBoundary();

            // Wall system sub-element selection:
            // When clicking on a wall that is already selected and has a wallSystemId,
            // check for stud/panel sub-element hits (like Revit's Tab-select for curtain walls)
            const clickedShape = shapes.find(s => s.id === shapeId);
            if (
              clickedShape &&
              clickedShape.type === 'wall' &&
              (clickedShape as WallShape).wallSystemId &&
              selectedShapeIds.includes(shapeId) &&
              !e.ctrlKey && !e.shiftKey
            ) {
              const wall = clickedShape as WallShape;
              const system = wallSystemTypes.find(t => t.id === wall.wallSystemId);
              if (system) {
                const subEl = hitTestWallSubElement(worldPos, wall, system, 5 / viewport.zoom);
                if (subEl && (subEl.type === 'stud' || subEl.type === 'panel')) {
                  selectWallSubElement(shapeId, subEl.type, subEl.key);
                  break;
                }
              }
              // No sub-element hit — clear any existing sub-element selection
              if (selectedWallSubElement && selectedWallSubElement.wallId === shapeId) {
                clearWallSubElement();
                break;
              }
            } else {
              // Clicking on a different shape or non-wall: clear wall sub-element selection
              if (selectedWallSubElement) {
                clearWallSubElement();
              }
            }

            // Ctrl or Shift for additive/toggle selection
            selectShape(shapeId, e.ctrlKey || e.shiftKey);
          } else {
            boundaryEditing.deselectBoundary();
            // Clear wall sub-element selection when clicking empty space
            if (selectedWallSubElement) {
              clearWallSubElement();
            }
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

        case 'leader':
          deselectAll();
          leaderDrawing.handleLeaderClick(snappedPos);
          snapDetection.clearTracking();
          break;

        case 'label': {
          deselectAll();
          // Label tool: single-click on an element to auto-place label
          // Uses raw worldPos (no snapping) for hit-testing the element
          leaderDrawing.handleLabelClick(worldPos, findShapeAtPoint);
          snapDetection.clearTracking();
          break;
        }

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
        case 'copy2':
        case 'rotate':
        case 'scale':
        case 'mirror':
        case 'array':
        case 'trim':
        case 'extend':
        case 'fillet':
        case 'chamfer':
        case 'offset':
        case 'elastic':
        case 'trim-walls': {
          // Trim tool and trim-walls: use raw world position (no snapping) so clicks hit shapes directly
          if (activeTool === 'trim' || activeTool === 'trim-walls') {
            modifyTools.handleModifyClick(worldPos, e.shiftKey, findShapeAtPoint);
            break;
          }
          // Ortho: constrain to 45° angles from base point (toggled by Shift)
          const modifyBase = shapeDrawing.getLastDrawingPoint();
          const modifyClickPos = (modifyOrtho && modifyBase) ? snapToAngle(modifyBase, snappedPos) : snappedPos;
          modifyTools.handleModifyClick(modifyClickPos, e.shiftKey, findShapeAtPoint);
          snapDetection.clearTracking();
          break;
        }
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
      gridlineDrawing,
      pileDrawing,
      cptDrawing,
      wallDrawing,
      leaderDrawing,
      pendingBeam,
      pendingGridline,
      pendingLevel,
      pendingPile,
      pendingCPT,
      pendingWall,
      levelDrawing,
      sectionCalloutDrawing,
      pendingSectionCallout,
      spaceDrawing,
      pendingSpace,
      modifyOrtho,
      plateSystemEditMode,
      editingPlateSystemId,
      setPlateSystemEditMode,
      plateSystemSubTool,
      setPlateSystemSubTool,
      plateSystemOpeningMode,
      setPlateSystemOpeningMode,
      selectedOpeningId,
      setSelectedOpeningId,
      updateShape,
      shapes,
      wallSystemTypes,
      selectWallSubElement,
      clearWallSubElement,
      selectedWallSubElement,
      selectedShapeIds,
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

      // Right-button drag: move 2D cursor with snap
      if (rightDragRef.current.isDragging && editorMode === 'drawing') {
        const dx = e.clientX - rightDragRef.current.startX;
        const dy = e.clientY - rightDragRef.current.startY;
        if (!rightDragRef.current.didDrag && (Math.abs(dx) > 3 || Math.abs(dy) > 3)) {
          rightDragRef.current.didDrag = true;
        }
        if (rightDragRef.current.didDrag) {
          const worldPos = screenToWorld(screenPos.x, screenPos.y, viewport);
          const snapResult = snapDetection.snapPoint(worldPos);
          // Save the snapped position so mouseUp can reuse it instead of recalculating
          // (mouseup event coordinates can differ slightly from the last mousemove,
          // causing snap to jump to a different point)
          rightDragRef.current.lastSnappedPos = snapResult.point;
          setCursor2D(snapResult.point);
          return;
        }
      }

      // Sheet mode: annotation dragging
      if (annotationEditing.handleAnnotationMouseMove(screenPos)) {
        return;
      }

      // Sheet mode: viewport dragging
      if (viewportEditing.handleViewportMouseMove(screenPos)) {
        return;
      }

      // Sheet mode: title block field hover highlighting
      titleBlockEditing.handleTitleBlockMouseMove(screenPos);

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

      // Gridline drawing preview (snap detection always runs so user can snap before first click)
      if (activeTool === 'gridline' && pendingGridline && editorMode === 'drawing') {
        const worldPos = screenToWorld(screenPos.x, screenPos.y, viewport);
        const basePoint = gridlineDrawing.getGridlineBasePoint();
        const snapResult = snapDetection.snapPoint(worldPos, basePoint ?? undefined);
        gridlineDrawing.updateGridlinePreview(snapResult.point, e.shiftKey);
        return;
      }

      // Level drawing preview (snap detection always runs so user can snap before first click)
      if (activeTool === 'level' && pendingLevel && editorMode === 'drawing') {
        const worldPos = screenToWorld(screenPos.x, screenPos.y, viewport);
        const basePoint = levelDrawing.getLevelBasePoint();
        const snapResult = snapDetection.snapPoint(worldPos, basePoint ?? undefined);
        levelDrawing.updateLevelPreview(snapResult.point, e.shiftKey);
        return;
      }

      // Pile placement preview (follows cursor)
      if (activeTool === 'pile' && pendingPile && editorMode === 'drawing') {
        const worldPos = screenToWorld(screenPos.x, screenPos.y, viewport);
        const snapResult = snapDetection.snapPoint(worldPos);
        pileDrawing.updatePilePreview(snapResult.point);
        return;
      }

      // CPT placement preview (follows cursor)
      if (activeTool === 'cpt' && pendingCPT && editorMode === 'drawing') {
        const worldPos = screenToWorld(screenPos.x, screenPos.y, viewport);
        const snapResult = snapDetection.snapPoint(worldPos);
        cptDrawing.updateCPTPreview(snapResult.point);
        return;
      }

      // Wall drawing preview (snap detection always runs so user can snap before first click)
      if (activeTool === 'wall' && pendingWall && editorMode === 'drawing') {
        const worldPos = screenToWorld(screenPos.x, screenPos.y, viewport);
        const basePoint = wallDrawing.getWallBasePoint();
        const snapResult = snapDetection.snapPoint(worldPos, basePoint ?? undefined);
        wallDrawing.updateWallPreview(snapResult.point, e.shiftKey);
        return;
      }

      // Slab drawing preview (snap detection always runs so user can snap before first click)
      if (activeTool === 'slab' && pendingSlab && editorMode === 'drawing') {
        const worldPos = screenToWorld(screenPos.x, screenPos.y, viewport);
        const basePoint = slabDrawing.getSlabBasePoint();
        const snapResult = snapDetection.snapPoint(worldPos, basePoint ?? undefined);
        slabDrawing.updateSlabPreview(snapResult.point, e.shiftKey);
        return;
      }

      // Puntniveau drawing preview (snap detection always runs so user can snap before first click)
      if (activeTool === 'puntniveau' && pendingPuntniveau && editorMode === 'drawing') {
        const worldPos = screenToWorld(screenPos.x, screenPos.y, viewport);
        const basePoint = puntniveauDrawing.getPuntniveauBasePoint();
        const snapResult = snapDetection.snapPoint(worldPos, basePoint ?? undefined);
        puntniveauDrawing.updatePuntniveauPreview(snapResult.point, e.shiftKey);
        return;
      }

      // Plate system drawing preview (snap detection always runs so user can snap before first click)
      if (activeTool === 'plate-system' && pendingPlateSystem && editorMode === 'drawing') {
        const worldPos = screenToWorld(screenPos.x, screenPos.y, viewport);
        const basePoint = plateSystemDrawing.getPlateSystemBasePoint();
        const snapResult = snapDetection.snapPoint(worldPos, basePoint ?? undefined);
        plateSystemDrawing.updatePlateSystemPreview(snapResult.point, e.shiftKey);
        return;
      }

      // Section callout drawing preview (snap detection always runs so user can snap before first click)
      if (activeTool === 'section-callout' && pendingSectionCallout && editorMode === 'drawing') {
        const worldPos = screenToWorld(screenPos.x, screenPos.y, viewport);
        const basePoint = sectionCalloutDrawing.getSectionCalloutBasePoint();
        const snapResult = snapDetection.snapPoint(worldPos, basePoint ?? undefined);
        sectionCalloutDrawing.updateSectionCalloutPreview(snapResult.point, e.shiftKey);
        return;
      }

      // Leader drawing preview (leader tool only, not label)
      if (activeTool === 'leader' && leaderDrawing.isLeaderDrawing && editorMode === 'drawing') {
        const worldPos = screenToWorld(screenPos.x, screenPos.y, viewport);
        const basePoint = leaderDrawing.getLeaderBasePoint();
        const snapResult = snapDetection.snapPoint(worldPos, basePoint ?? undefined);
        leaderDrawing.updateLeaderPreview(snapResult.point);
        return;
      }

      // Label tool: single-click workflow, just show hover highlight for element picking
      if (activeTool === 'label' && editorMode === 'drawing') {
        const worldPos = screenToWorld(screenPos.x, screenPos.y, viewport);
        // Clear any lingering snap indicators -- label tool uses hit-testing, not snapping
        snapDetection.clearTracking();
        // Show hover highlight so user can see which element they will click on
        const hoveredShape = findShapeAtPoint(worldPos);
        setHoveredShapeId(hoveredShape);
        return;
      }

      // Modify tools - update preview
      const isModifyToolActive = ['move', 'copy', 'copy2', 'rotate', 'scale', 'mirror', 'array', 'trim', 'extend', 'fillet', 'chamfer', 'offset', 'elastic', 'trim-walls'].includes(activeTool);
      if (isModifyToolActive && editorMode === 'drawing') {
        const worldPos = screenToWorld(screenPos.x, screenPos.y, viewport);

        // Trim tool and trim-walls: skip snap detection entirely, use raw world position
        if (activeTool === 'trim' || activeTool === 'trim-walls') {
          modifyTools.updateModifyPreview(worldPos);
          const hoveredShape = findShapeAtPoint(worldPos);
          setHoveredShapeId(hoveredShape);
          return;
        }

        const basePoint = shapeDrawing.getLastDrawingPoint();
        const snapResult = snapDetection.snapPoint(worldPos, basePoint);
        // Ortho: constrain to 45° angles from base point (toggled by Shift)
        const modifyPos = (modifyOrtho && basePoint) ? snapToAngle(basePoint, snapResult.point) : snapResult.point;
        modifyTools.updateModifyPreview(modifyPos);

        // Hover highlight for trim/extend/fillet/offset
        if (['extend', 'fillet', 'chamfer', 'offset'].includes(activeTool)) {
          const hoveredShape = findShapeAtPoint(worldPos);
          setHoveredShapeId(hoveredShape);
        } else {
          setHoveredShapeId(null);
        }
        return;
      }

      // Drawing tools - always detect snaps when hovering (even before first click)
      const isDrawingTool = ['line', 'rectangle', 'circle', 'arc', 'polyline', 'spline', 'ellipse', 'hatch', 'dimension', 'leader', 'label'].includes(activeTool);

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
    [panZoom, annotationEditing, viewportEditing, editorMode, viewport, boundaryEditing, gripEditing, boxSelection, shapeDrawing, snapDetection, activeTool, dimensionMode, pickLinesMode, findShapeAtPoint, setHoveredShapeId, canvasRef, modifyTools, beamDrawing, gridlineDrawing, levelDrawing, puntniveauDrawing, pileDrawing, cptDrawing, wallDrawing, leaderDrawing, sectionCalloutDrawing, plateSystemDrawing, pendingBeam, pendingGridline, pendingLevel, pendingPuntniveau, pendingPile, pendingCPT, pendingWall, pendingSectionCallout, pendingPlateSystem, sourceSnapAngle, setCursor2D, modifyOrtho]
  );

  /**
   * Handle mouse up
   */
  const handleMouseUp = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      // End right-button drag for 2D cursor — use the last snapped position from mousemove
      // instead of recalculating, because mouseup coordinates can differ slightly from the
      // last mousemove (sub-pixel rounding, tiny mouse movement) causing snap to jump.
      if (e.button === 2 && rightDragRef.current.isDragging) {
        if (rightDragRef.current.didDrag && editorMode === 'drawing') {
          if (rightDragRef.current.lastSnappedPos) {
            // Reuse the snapped position that was calculated and displayed during the last mousemove
            setCursor2D(rightDragRef.current.lastSnappedPos);
          } else {
            // Fallback: if somehow no mousemove fired during drag, calculate snap now
            const screenPos = panZoom.getMousePos(e);
            const worldPos = screenToWorld(screenPos.x, screenPos.y, viewport);
            const snapResult = snapDetection.snapPoint(worldPos);
            setCursor2D(snapResult.point);
          }
        }
        rightDragRef.current.isDragging = false;
      }

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
    [panZoom, annotationEditing, viewportEditing, boundaryEditing, gripEditing, boxSelection, editorMode, viewport, snapDetection, setCursor2D]
  );

  /**
   * Handle context menu (right-click) - finish drawing or deselect tool
   */
  const handleContextMenu = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      e.preventDefault();

      // If we just finished a right-drag for 2D cursor, suppress context menu
      if (rightDragRef.current.didDrag) {
        rightDragRef.current.didDrag = false;
        return;
      }

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

      // Cancel gridline drawing
      if (pendingGridline) {
        gridlineDrawing.cancelGridlineDrawing();
        setActiveTool('select');
        return;
      }

      // Cancel level drawing
      if (pendingLevel) {
        levelDrawing.cancelLevelDrawing();
        setActiveTool('select');
        return;
      }

      // Cancel puntniveau drawing
      if (pendingPuntniveau) {
        puntniveauDrawing.cancelPuntniveauDrawing();
        setActiveTool('select');
        return;
      }

      if (pendingPile) {
        pileDrawing.cancelPileDrawing();
        setActiveTool('select');
        return;
      }

      if (pendingCPT) {
        cptDrawing.cancelCPTDrawing();
        setActiveTool('select');
        return;
      }

      if (pendingWall) {
        wallDrawing.cancelWallDrawing();
        setActiveTool('select');
        return;
      }

      // Finish or cancel slab drawing on right-click
      if (pendingSlab) {
        if (slabDrawing.pointCount >= 3) {
          // Finish: create the slab with current points
          slabDrawing.finishSlabDrawing();
          snapDetection.clearTracking();
        } else {
          // Cancel: not enough points
          slabDrawing.cancelSlabDrawing();
          setActiveTool('select');
        }
        return;
      }

      // Finish or cancel puntniveau drawing on right-click
      if (pendingPuntniveau) {
        if (puntniveauDrawing.pointCount >= 3) {
          // Finish: create the puntniveau with current points
          puntniveauDrawing.finishPuntniveauDrawing();
          snapDetection.clearTracking();
        } else {
          // Cancel: not enough points
          puntniveauDrawing.cancelPuntniveauDrawing();
          setActiveTool('select');
        }
        return;
      }

      // Finish or cancel plate system drawing on right-click
      if (pendingPlateSystem) {
        if (plateSystemDrawing.pointCount >= 3) {
          // Finish: create the plate system with current points
          plateSystemDrawing.finishPlateSystemDrawing();
          snapDetection.clearTracking();
        } else {
          // Cancel: not enough points
          plateSystemDrawing.cancelPlateSystemDrawing();
          setActiveTool('select');
        }
        return;
      }

      // Cancel section callout drawing
      if (pendingSectionCallout) {
        sectionCalloutDrawing.cancelSectionCalloutDrawing();
        setActiveTool('select');
        return;
      }

      // Cancel space drawing
      if (pendingSpace) {
        spaceDrawing.cancelSpaceDrawing();
        setActiveTool('select');
        return;
      }

      // Cancel leader drawing on right-click
      if (leaderDrawing.isLeaderDrawing) {
        leaderDrawing.cancelLeader();
        snapDetection.clearTracking();
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
      const modifyToolsList = ['move', 'copy', 'copy2', 'rotate', 'scale', 'mirror', 'array', 'trim', 'extend', 'fillet', 'chamfer', 'offset', 'elastic', 'trim-walls'];
      if (modifyToolsList.includes(activeTool)) {
        modifyTools.finishModify();
        setActiveTool('select');
        snapDetection.clearTracking();
        return;
      }

      // If a drawing or annotation tool is selected but not actively drawing, deselect it
      const drawingTools = ['line', 'rectangle', 'circle', 'arc', 'polyline', 'spline', 'ellipse', 'hatch', 'text', 'leader', 'label', 'dimension', 'beam', 'section-callout', 'image'];
      if (drawingTools.includes(activeTool)) {
        setActiveTool('select');
        // Clear any lingering snap/tracking indicators
        snapDetection.clearTracking();
      }
    },
    [editorMode, annotationEditing, shapeDrawing, activeTool, setActiveTool, snapDetection, modifyTools, setPrintDialogOpen,
     panZoom, viewport, findShapeAtPoint, parametricShapes, selectedShapeIds, explodeParametricShapes, addShapes,
     pendingSection, clearPendingSection, setSectionPlacementPreview, pendingBeam, beamDrawing, pendingGridline, gridlineDrawing, pendingLevel, levelDrawing, pendingPuntniveau, puntniveauDrawing, pendingPile, pileDrawing, pendingCPT, cptDrawing, pendingWall, wallDrawing, pendingSectionCallout, sectionCalloutDrawing, pendingSpace, spaceDrawing, pendingPlateSystem, plateSystemDrawing, leaderDrawing]
  );

  /**
   * Handle double-click (edit text)
   */
  const handleDoubleClick = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (e.button !== 0) return;

      const screenPos = panZoom.getMousePos(e);

      // Sheet mode: double-click on title block field to edit, or viewport to switch drawing
      if (editorMode === 'sheet') {
        // Try title block field first
        if (titleBlockEditing.handleTitleBlockClick(screenPos)) {
          return;
        }

        const sheetPos = viewportEditing.screenToSheet(screenPos.x, screenPos.y);
        const vp = viewportEditing.findViewportAtPoint(sheetPos);
        if (vp) {
          switchToDrawing(vp.drawingId);
        }
        return;
      }

      if (editorMode !== 'drawing') return;

      const worldPos = screenToWorld(screenPos.x, screenPos.y, viewport);

      // Find shape at point
      const shapeId = findShapeAtPoint(worldPos);
      if (shapeId) {
        const shape = shapes.find(s => s.id === shapeId);
        // Check if it's a text shape
        if (shape && shape.type === 'text') {
          textDrawing.handleTextDoubleClick(shapeId);
          return;
        }
        // Check if it's a gridline shape — bubble label edit or bubble toggle
        if (shape && shape.type === 'gridline') {
          const gl = shape as GridlineShape;
          const angle = Math.atan2(gl.end.y - gl.start.y, gl.end.x - gl.start.x);
          const dx = Math.cos(angle);
          const dy = Math.sin(angle);
          const tolerance = gl.bubbleRadius * 1.2;

          // Check if clicking on existing start bubble
          if (gl.bubblePosition === 'start' || gl.bubblePosition === 'both') {
            const bubbleCenter = { x: gl.start.x - dx * gl.bubbleRadius, y: gl.start.y - dy * gl.bubbleRadius };
            const dist = Math.sqrt((worldPos.x - bubbleCenter.x) ** 2 + (worldPos.y - bubbleCenter.y) ** 2);
            if (dist < tolerance) {
              startGridlineLabelEdit(shapeId, 'start');
              return;
            }
          }
          // Check if clicking on existing end bubble
          if (gl.bubblePosition === 'end' || gl.bubblePosition === 'both') {
            const bubbleCenter = { x: gl.end.x + dx * gl.bubbleRadius, y: gl.end.y + dy * gl.bubbleRadius };
            const dist = Math.sqrt((worldPos.x - bubbleCenter.x) ** 2 + (worldPos.y - bubbleCenter.y) ** 2);
            if (dist < tolerance) {
              startGridlineLabelEdit(shapeId, 'end');
              return;
            }
          }

          // Check if double-clicking near an endpoint WITHOUT a bubble — toggle bubble on
          const endTolerance = gl.bubbleRadius * 1.5;
          const startDist = Math.sqrt((worldPos.x - gl.start.x) ** 2 + (worldPos.y - gl.start.y) ** 2);
          const endDist = Math.sqrt((worldPos.x - gl.end.x) ** 2 + (worldPos.y - gl.end.y) ** 2);

          if (startDist < endTolerance && gl.bubblePosition !== 'start' && gl.bubblePosition !== 'both') {
            updateShape(shapeId, { bubblePosition: gl.bubblePosition === 'end' ? 'both' : 'start' } as any);
            startGridlineLabelEdit(shapeId, 'start');
            return;
          }
          if (endDist < endTolerance && gl.bubblePosition !== 'end' && gl.bubblePosition !== 'both') {
            updateShape(shapeId, { bubblePosition: gl.bubblePosition === 'start' ? 'both' : 'end' } as any);
            startGridlineLabelEdit(shapeId, 'end');
            return;
          }
        }
        // Double-click on a plate system or its child beam: enter edit mode
        if (shape && shape.type === 'plate-system') {
          setPlateSystemEditMode(true, shape.id);
          return;
        }
        if (shape && shape.type === 'beam') {
          const beam = shape as BeamShape;
          if (beam.plateSystemId) {
            setPlateSystemEditMode(true, beam.plateSystemId);
            return;
          }
        }
        // Double-click on a puntniveau: start editing the linked label (NAP value)
        if (shape && shape.type === 'puntniveau') {
          const linkedLabel = shapes.find(
            s => s.type === 'text' && (s as any).linkedShapeId === shape.id
          );
          if (linkedLabel) {
            textDrawing.handleTextDoubleClick(linkedLabel.id);
            return;
          }
        }
      }
    },
    [editorMode, panZoom, viewport, findShapeAtPoint, shapes, textDrawing, viewportEditing, switchToDrawing, updateShape, startGridlineLabelEdit, selectShapes, setPlateSystemEditMode]
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

  /**
   * Check whether a right-drag just finished and consume the flag.
   * Used by Canvas.tsx to suppress the context menu after a right-drag cursor placement.
   */
  const consumeRightDrag = useCallback(() => {
    if (rightDragRef.current.didDrag) {
      rightDragRef.current.didDrag = false;
      return true;
    }
    return false;
  }, []);

  return {
    handleMouseDown,
    handleMouseMove,
    handleMouseUp,
    handleWheel,
    handleClick,
    handleDoubleClick,
    handleContextMenu,
    isPanning: panZoom.isPanning,
    consumeRightDrag,
    titleBlockEditing,
  };
}
