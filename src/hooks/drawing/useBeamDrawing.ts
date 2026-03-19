/**
 * useBeamDrawing - Handles beam drawing (click start, click end)
 *
 * When a beam is created, a linked IFC label (TextShape) is automatically
 * placed to the side of the beam (perpendicular offset), following the same
 * pattern used by useSpaceDrawing for space labels.
 */

import { useCallback } from 'react';
import { useAppStore, generateId } from '../../state/appStore';
import type { Point, BeamShape, TextShape, BeamMaterial, BeamJustification, BeamViewMode } from '../../types/geometry';
import { snapToAngle, calculateBulgeFrom3Points } from '../../engine/geometry/GeometryUtils';
import { getDefaultLabelTemplate, resolveTemplate, computeLinkedLabelPosition } from '../../engine/geometry/LabelUtils';
import { CAD_DEFAULT_LINE_HEIGHT } from '../../constants/cadDefaults';

export function useBeamDrawing() {
  const {
    activeLayerId,
    activeDrawingId,
    currentStyle,
    addShapes,
    drawingPoints,
    addDrawingPoint,
    clearDrawingPoints,
    setDrawingPreview,
    pendingBeam,
    clearPendingBeam,
  } = useAppStore();

  /**
   * Create a beam shape with an auto-placed IFC label.
   *
   * The label is positioned to the side of the beam (perpendicular offset)
   * using computeLinkedLabelPosition, which offsets by flangeWidth/2 + margin.
   * Both shapes are added atomically via addShapes so they form a single
   * undo step.
   */
  const createBeam = useCallback(
    (
      start: Point,
      end: Point,
      profileType: string,
      profileParameters: Record<string, number | string | boolean>,
      flangeWidth: number,
      options?: {
        presetId?: string;
        presetName?: string;
        material?: BeamMaterial;
        justification?: BeamJustification;
        showCenterline?: boolean;
        showLabel?: boolean;
        labelText?: string;
        viewMode?: BeamViewMode;
        bulge?: number;
      }
    ) => {
      const beamId = generateId();
      const beamShape: BeamShape = {
        id: beamId,
        type: 'beam',
        layerId: activeLayerId,
        drawingId: activeDrawingId,
        style: { ...currentStyle },
        visible: true,
        locked: false,
        start,
        end,
        profileType,
        profileParameters,
        presetId: options?.presetId,
        presetName: options?.presetName,
        flangeWidth,
        justification: options?.justification || 'center',
        material: options?.material || 'steel',
        showCenterline: options?.showCenterline ?? true,
        showLabel: options?.showLabel ?? false,
        labelText: options?.labelText,
        rotation: 0,
        viewMode: options?.viewMode || 'plan',
        bulge: options?.bulge,
      };

      // ----------------------------------------------------------------
      // Auto-place a linked IFC label to the side of the beam
      // ----------------------------------------------------------------
      const template = getDefaultLabelTemplate('beam');
      const labelText = resolveTemplate(template, beamShape);

      // Compute label position: offset perpendicular to the beam direction
      const labelPosData = computeLinkedLabelPosition(beamShape);

      // Resolve active text style for consistent formatting
      const state = useAppStore.getState();
      const { defaultTextStyle, activeTextStyleId, textStyles } = state;
      const activeStyle = activeTextStyleId
        ? textStyles.find(s => s.id === activeTextStyleId)
        : null;

      // Get beam label font size from drawing standards based on scale
      const activeDrawing = state.drawings.find((d: any) => d.id === activeDrawingId);
      const drawingScale = activeDrawing?.scale || 0.01;
      const beamLabelSettings = state.planSubtypeSettings?.structuralPlan?.beamLabelFontSize;
      // 1:100 = 0.01, 1:50 = 0.02, etc. At 1:100 use scale100 (1.8mm), otherwise scale50 (2.5mm)
      const beamLabelMm = drawingScale <= 0.01
        ? (beamLabelSettings?.scale100 ?? 1.8)
        : (beamLabelSettings?.scale50 ?? 2.5);
      // Convert paper mm to model units: paperMm / drawingScale
      const beamLabelFontSize = beamLabelMm / drawingScale;

      // Fall back to beam midpoint if computeLinkedLabelPosition returns null
      // (e.g. zero-length beam, which shouldn't happen in practice)
      const labelPosition = labelPosData?.position ?? {
        x: (start.x + end.x) / 2,
        y: (start.y + end.y) / 2,
      };
      const labelRotation = labelPosData?.rotation ?? 0;

      const labelShape: TextShape = {
        id: generateId(),
        type: 'text',
        layerId: activeLayerId,
        drawingId: activeDrawingId,
        style: { ...currentStyle },
        visible: true,
        locked: false,
        position: labelPosition,
        text: labelText,
        fontSize: beamLabelFontSize,
        fontFamily: activeStyle?.fontFamily ?? defaultTextStyle.fontFamily,
        rotation: labelRotation,
        alignment: 'left',
        verticalAlignment: 'middle',
        bold: activeStyle?.bold ?? defaultTextStyle.bold,
        italic: activeStyle?.italic ?? false,
        underline: activeStyle?.underline ?? false,
        color: activeStyle?.color ?? defaultTextStyle.color,
        lineHeight: activeStyle?.lineHeight ?? CAD_DEFAULT_LINE_HEIGHT,
        isModelText: true,
        // Link to the beam element
        linkedShapeId: beamId,
        // Store the template for auto-update on property changes
        labelTemplate: template,
      };

      // Add both beam and label atomically in a single undo step
      addShapes([beamShape, labelShape]);

      return beamShape.id;
    },
    [activeLayerId, activeDrawingId, currentStyle, addShapes]
  );

  /**
   * Create 4 beams forming a rectangle from two opposite corners.
   */
  const createRectangleBeams = useCallback(
    (corner1: Point, corner2: Point) => {
      if (!pendingBeam) return;

      // Derive the 4 corners of the rectangle (axis-aligned)
      const c1 = corner1;
      const c2 = { x: corner2.x, y: corner1.y };
      const c3 = corner2;
      const c4 = { x: corner1.x, y: corner2.y };

      const beamOpts = {
        presetId: pendingBeam.presetId,
        presetName: pendingBeam.presetName,
        material: pendingBeam.material,
        justification: pendingBeam.justification,
        showCenterline: pendingBeam.showCenterline,
        showLabel: pendingBeam.showLabel,
        viewMode: pendingBeam.viewMode,
      };

      // Create 4 beam segments: bottom, right, top, left
      createBeam(c1, c2, pendingBeam.profileType, pendingBeam.parameters, pendingBeam.flangeWidth, beamOpts);
      createBeam(c2, c3, pendingBeam.profileType, pendingBeam.parameters, pendingBeam.flangeWidth, beamOpts);
      createBeam(c3, c4, pendingBeam.profileType, pendingBeam.parameters, pendingBeam.flangeWidth, beamOpts);
      createBeam(c4, c1, pendingBeam.profileType, pendingBeam.parameters, pendingBeam.flangeWidth, beamOpts);
    },
    [pendingBeam, createBeam]
  );

  /**
   * Create 2 semicircular arc beams forming a complete circle.
   * Beam 1: top to bottom (left semicircle), bulge = 1
   * Beam 2: bottom to top (right semicircle), bulge = 1
   */
  const createCircleBeams = useCallback(
    (center: Point, radius: number) => {
      if (!pendingBeam || radius < 1) return;

      const top: Point = { x: center.x, y: center.y - radius };
      const bottom: Point = { x: center.x, y: center.y + radius };

      const beamOpts = {
        presetId: pendingBeam.presetId,
        presetName: pendingBeam.presetName,
        material: pendingBeam.material,
        justification: pendingBeam.justification,
        showCenterline: pendingBeam.showCenterline,
        showLabel: pendingBeam.showLabel,
        viewMode: pendingBeam.viewMode,
      };

      // Left semicircle: top -> bottom, bulge = 1
      createBeam(top, bottom, pendingBeam.profileType, pendingBeam.parameters, pendingBeam.flangeWidth, { ...beamOpts, bulge: 1 });
      // Right semicircle: bottom -> top, bulge = 1
      createBeam(bottom, top, pendingBeam.profileType, pendingBeam.parameters, pendingBeam.flangeWidth, { ...beamOpts, bulge: 1 });
    },
    [pendingBeam, createBeam]
  );

  /**
   * Handle click for beam drawing
   * @param snappedPos - The snapped position
   * @param shiftKey - Whether shift key is pressed
   * @param sourceAngle - Angle of the snapped source shape (for perpendicular tracking)
   */
  const handleBeamClick = useCallback(
    (snappedPos: Point, shiftKey: boolean, sourceAngle?: number) => {
      if (!pendingBeam) return false;

      const isArcMode = pendingBeam.shapeMode === 'arc';
      const isRectMode = pendingBeam.shapeMode === 'rectangle';
      const isCircleMode = pendingBeam.shapeMode === 'circle';

      if (drawingPoints.length === 0) {
        // First click: set start point (or center for circle mode), store source angle for tracking
        addDrawingPoint(snappedPos, sourceAngle);
        return true;
      } else if (isCircleMode && drawingPoints.length === 1) {
        // Circle mode: second click = radius point
        const center = drawingPoints[0];
        const radius = Math.hypot(snappedPos.x - center.x, snappedPos.y - center.y);

        if (radius > 1) {
          createCircleBeams(center, radius);
        }

        clearDrawingPoints();
        setDrawingPreview(null);
        // Keep pendingBeam active for consecutive circles
        return true;
      } else if (isRectMode && drawingPoints.length === 1) {
        // Rectangle mode: second click = opposite corner
        const corner1 = drawingPoints[0];
        const corner2 = snappedPos;

        const dx = Math.abs(corner2.x - corner1.x);
        const dy = Math.abs(corner2.y - corner1.y);

        if (dx > 1 && dy > 1) {
          createRectangleBeams(corner1, corner2);
        }

        clearDrawingPoints();
        setDrawingPreview(null);
        // Keep pendingBeam active for consecutive rectangles
        return true;
      } else if (isArcMode && drawingPoints.length === 1) {
        // Arc mode, second click: store arc-through-point
        addDrawingPoint(snappedPos);
        return true;
      } else {
        // Line mode: second click = end point
        // Arc mode: third click = end point
        const startPoint = drawingPoints[0];
        let finalPos = shiftKey ? snapToAngle(startPoint, snappedPos) : snappedPos;

        const dx = Math.abs(finalPos.x - startPoint.x);
        const dy = Math.abs(finalPos.y - startPoint.y);

        // Calculate bulge for arc mode
        let bulge: number | undefined;
        if (isArcMode && drawingPoints.length === 2) {
          bulge = calculateBulgeFrom3Points(startPoint, drawingPoints[1], finalPos);
          if (bulge === 0) bulge = undefined; // collinear = straight line
        }

        // Only create if there's a meaningful distance
        if (dx > 1 || dy > 1) {
          createBeam(
            startPoint,
            finalPos,
            pendingBeam.profileType,
            pendingBeam.parameters,
            pendingBeam.flangeWidth,
            {
              presetId: pendingBeam.presetId,
              presetName: pendingBeam.presetName,
              material: pendingBeam.material,
              justification: pendingBeam.justification,
              showCenterline: pendingBeam.showCenterline,
              showLabel: pendingBeam.showLabel,
              viewMode: pendingBeam.viewMode,
              bulge,
            }
          );
        }

        clearDrawingPoints();
        setDrawingPreview(null);
        // Chain drawing: use endpoint as next start point
        if (pendingBeam.continueDrawing !== false) {
          addDrawingPoint(finalPos);
        }
        // Keep pendingBeam active so user can draw multiple beams consecutively
        return true;
      }
    },
    [pendingBeam, drawingPoints, addDrawingPoint, clearDrawingPoints, setDrawingPreview, createBeam, createRectangleBeams, createCircleBeams]
  );

  /**
   * Update beam preview
   */
  const updateBeamPreview = useCallback(
    (snappedPos: Point, shiftKey: boolean) => {
      if (!pendingBeam || drawingPoints.length === 0) return;

      const startPoint = drawingPoints[0];
      const isArcMode = pendingBeam.shapeMode === 'arc';
      const isRectMode = pendingBeam.shapeMode === 'rectangle';
      const isCircleMode = pendingBeam.shapeMode === 'circle';

      if (isCircleMode) {
        // Circle mode: show circular beam preview from center to cursor (radius)
        const radius = Math.hypot(snappedPos.x - startPoint.x, snappedPos.y - startPoint.y);
        setDrawingPreview({
          type: 'beam-circle',
          center: startPoint,
          radius,
          flangeWidth: pendingBeam.flangeWidth,
          showCenterline: pendingBeam.showCenterline,
        });
      } else if (isRectMode) {
        // Rectangle mode: show 4-beam rectangle preview from corner1 to cursor
        setDrawingPreview({
          type: 'beam-rectangle',
          corner1: startPoint,
          corner2: snappedPos,
          flangeWidth: pendingBeam.flangeWidth,
          showCenterline: pendingBeam.showCenterline,
        });
      } else if (isArcMode && drawingPoints.length === 2) {
        // Arc mode with 2 points placed: show arc preview from start to cursor through arc-point
        const previewPos = shiftKey ? snapToAngle(startPoint, snappedPos) : snappedPos;
        const bulge = calculateBulgeFrom3Points(startPoint, drawingPoints[1], previewPos);

        setDrawingPreview({
          type: 'beam',
          start: startPoint,
          end: previewPos,
          flangeWidth: pendingBeam.flangeWidth,
          showCenterline: pendingBeam.showCenterline,
          bulge: bulge !== 0 ? bulge : undefined,
        });
      } else {
        // Line mode, or arc mode with only 1 point: show line from start to cursor
        const previewPos = shiftKey ? snapToAngle(startPoint, snappedPos) : snappedPos;

        setDrawingPreview({
          type: 'beam',
          start: startPoint,
          end: previewPos,
          flangeWidth: pendingBeam.flangeWidth,
          showCenterline: pendingBeam.showCenterline,
        });
      }
    },
    [pendingBeam, drawingPoints, setDrawingPreview]
  );

  /**
   * Cancel beam drawing
   */
  const cancelBeamDrawing = useCallback(() => {
    clearDrawingPoints();
    setDrawingPreview(null);
    clearPendingBeam();
  }, [clearDrawingPoints, setDrawingPreview, clearPendingBeam]);

  /**
   * Get status message for beam drawing
   */
  const getBeamDrawingStatus = useCallback((): string => {
    if (!pendingBeam) return '';
    if (drawingPoints.length === 0) return 'Click to set beam start point';
    return 'Click to set beam end point (Shift for angle snap)';
  }, [pendingBeam, drawingPoints]);

  /**
   * Get the base point for tracking (first click point)
   */
  const getBeamBasePoint = useCallback((): Point | null => {
    if (!pendingBeam || drawingPoints.length === 0) return null;
    return drawingPoints[0];
  }, [pendingBeam, drawingPoints]);

  return {
    handleBeamClick,
    updateBeamPreview,
    cancelBeamDrawing,
    getBeamDrawingStatus,
    getBeamBasePoint,
    createBeam,
    isBeamDrawingActive: !!pendingBeam,
    hasFirstPoint: drawingPoints.length > 0,
  };
}
