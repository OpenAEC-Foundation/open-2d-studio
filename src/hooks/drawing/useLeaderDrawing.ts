/**
 * useLeaderDrawing - Handles leader text drawing (2-click workflow)
 * and linked label/tag placement (1-click: click element -> auto-place label)
 *
 * Leader workflow:
 * 1. Click 1: Place arrow tip
 * 2. Click 2: Place text position (end of leader line) -> creates shape, opens text editor
 *
 * Label workflow (linked element tag):
 * 1. Single click on an element -> auto-places label 1000mm from start,
 *    rotated to match the wall/beam direction, no leader line.
 */

import { useCallback, useRef } from 'react';
import { useAppStore, generateId } from '../../state/appStore';
import type { Point, TextShape } from '../../types/geometry';
import { CAD_DEFAULT_LINE_HEIGHT } from '../../constants/cadDefaults';
import { getElementLabelText, computeLinkedLabelPosition, computeSlabSpanArrow } from '../../engine/geometry/LabelUtils';
import type { SlabShape } from '../../types/geometry';

export function useLeaderDrawing() {
  const {
    activeTool,
    activeLayerId,
    activeDrawingId,
    currentStyle,
    addShape,
    defaultTextStyle,
    defaultLeaderConfig,
    startTextEditing,
    drawingPoints,
    addDrawingPoint,
    clearDrawingPoints,
    setDrawingPreview,
    activeTextStyleId,
    textStyles,
  } = useAppStore();

  // Store the linked shape ID for label tool (persists across renders within one placement)
  const linkedShapeIdRef = useRef<string | null>(null);

  const isLeaderActive = activeTool === 'leader' || activeTool === 'label';
  const isDrawing = isLeaderActive && drawingPoints.length > 0;

  /**
   * Handle single-click label placement on an element.
   *
   * For 'label' tool: Single click on an element ->
   *   - Finds the shape under cursor
   *   - Calculates a position 1000mm from the element's start point along its direction
   *   - Rotates the label to match the element direction
   *   - Creates the text shape without any leader line
   *
   * @param clickPos - The world position of the click (unsnapped, for hit-testing)
   * @param findShapeAtPoint - Function to find shape ID at a world point
   */
  const handleLabelClick = useCallback(
    (clickPos: Point, findShapeAtPoint: (p: Point) => string | null) => {
      // Find the element under cursor
      const shapeId = findShapeAtPoint(clickPos);
      if (!shapeId) {
        // No element found - do nothing (user must click on an element)
        return;
      }

      const { shapes, wallTypes } = useAppStore.getState();
      const linkedShape = shapes.find(s => s.id === shapeId);
      if (!linkedShape) return;

      // Generate label text from the linked element
      const labelText = getElementLabelText(linkedShape, wallTypes);

      // Calculate position and rotation from the element's geometry.
      // For slabs: use span arrow (overspanningspijl) placement at centroid.
      // For linear elements: offset label perpendicular to the element direction.
      let textPosition: Point;
      let rotation = 0;
      let spanArrow = false;
      let spanDirection: number | undefined;
      let spanLength: number | undefined;

      if (linkedShape.type === 'slab') {
        // Slab: create a span arrow label at the slab centroid
        const spanInfo = computeSlabSpanArrow(linkedShape as SlabShape);
        if (spanInfo) {
          textPosition = spanInfo.position;
          spanDirection = spanInfo.spanDirection;
          spanLength = spanInfo.spanLength;
          spanArrow = true;
          rotation = spanInfo.spanDirection;
        } else {
          textPosition = clickPos;
        }
      } else {
        const labelPos = computeLinkedLabelPosition(linkedShape);
        if (labelPos) {
          textPosition = labelPos.position;
          rotation = labelPos.rotation;
        } else {
          // Fallback: place label at click position with no rotation
          textPosition = clickPos;
        }
      }

      // Resolve active text style
      const activeStyle = activeTextStyleId
        ? textStyles.find(s => s.id === activeTextStyleId)
        : null;

      const textShape: TextShape = {
        id: generateId(),
        type: 'text',
        layerId: activeLayerId,
        drawingId: activeDrawingId,
        style: { ...currentStyle },
        visible: true,
        locked: false,
        position: textPosition,
        text: labelText,
        fontSize: activeStyle?.fontSize ?? defaultTextStyle.fontSize,
        fontFamily: activeStyle?.fontFamily ?? defaultTextStyle.fontFamily,
        rotation: 0, // Span arrow uses spanDirection; non-slab uses rotation set below
        alignment: spanArrow ? 'center' : (activeStyle?.alignment ?? defaultTextStyle.alignment),
        verticalAlignment: spanArrow ? 'middle' : (activeStyle?.verticalAlignment ?? 'top'),
        bold: activeStyle?.bold ?? defaultTextStyle.bold,
        italic: activeStyle?.italic ?? defaultTextStyle.italic,
        underline: activeStyle?.underline ?? defaultTextStyle.underline,
        color: activeStyle?.color ?? defaultTextStyle.color,
        lineHeight: activeStyle?.lineHeight ?? CAD_DEFAULT_LINE_HEIGHT,
        strikethrough: activeStyle?.strikethrough,
        textCase: activeStyle?.textCase,
        letterSpacing: activeStyle?.letterSpacing,
        widthFactor: activeStyle?.widthFactor,
        obliqueAngle: activeStyle?.obliqueAngle,
        paragraphSpacing: activeStyle?.paragraphSpacing,
        isModelText: activeStyle?.isModelText,
        backgroundMask: spanArrow ? true : (activeStyle?.backgroundMask),
        backgroundColor: activeStyle?.backgroundColor,
        backgroundPadding: activeStyle?.backgroundPadding,
        textStyleId: activeTextStyleId ?? undefined,
        // No leader line for labels - just plain text
        // Link to the element
        linkedShapeId: shapeId,
        // Span arrow properties for slab labels
        spanArrow: spanArrow || undefined,
        spanDirection,
        spanLength,
      };

      // For non-slab labels, set the rotation from the element direction
      if (!spanArrow) {
        textShape.rotation = rotation;
      }

      addShape(textShape);
      // Label text is auto-generated, no editor needed
    },
    [
      activeLayerId, activeDrawingId, currentStyle,
      defaultTextStyle, addShape,
      activeTextStyleId, textStyles,
    ]
  );

  /**
   * Handle click for leader drawing (leader tool only, NOT label tool).
   *
   * For 'leader' tool: Click 1 = arrow tip, Click 2 = text position -> create shape immediately.
   *
   * @param snappedPos - The snapped world position of the click
   */
  const handleLeaderClick = useCallback(
    (snappedPos: Point) => {
      if (drawingPoints.length === 0) {
        // First click: arrow tip (no element linking for leader tool)
        linkedShapeIdRef.current = null;
        addDrawingPoint(snappedPos);
        return;
      }

      // Second click: text position -- create the leader text shape
      const arrowTip = drawingPoints[0];
      const textPosition = snappedPos;

      // leaderPoints: from text toward arrow tip. Single entry = the arrow tip.
      const leaderPoints = [arrowTip];

      // Resolve active text style
      const activeStyle = activeTextStyleId
        ? textStyles.find(s => s.id === activeTextStyleId)
        : null;

      const textShape: TextShape = {
        id: generateId(),
        type: 'text',
        layerId: activeLayerId,
        drawingId: activeDrawingId,
        style: { ...currentStyle },
        visible: true,
        locked: false,
        position: textPosition,
        text: '',
        fontSize: activeStyle?.fontSize ?? defaultTextStyle.fontSize,
        fontFamily: activeStyle?.fontFamily ?? defaultTextStyle.fontFamily,
        rotation: 0,
        alignment: activeStyle?.alignment ?? defaultTextStyle.alignment,
        verticalAlignment: activeStyle?.verticalAlignment ?? 'top',
        bold: activeStyle?.bold ?? defaultTextStyle.bold,
        italic: activeStyle?.italic ?? defaultTextStyle.italic,
        underline: activeStyle?.underline ?? defaultTextStyle.underline,
        color: activeStyle?.color ?? defaultTextStyle.color,
        lineHeight: activeStyle?.lineHeight ?? CAD_DEFAULT_LINE_HEIGHT,
        strikethrough: activeStyle?.strikethrough,
        textCase: activeStyle?.textCase,
        letterSpacing: activeStyle?.letterSpacing,
        widthFactor: activeStyle?.widthFactor,
        obliqueAngle: activeStyle?.obliqueAngle,
        paragraphSpacing: activeStyle?.paragraphSpacing,
        isModelText: activeStyle?.isModelText,
        backgroundMask: activeStyle?.backgroundMask,
        backgroundColor: activeStyle?.backgroundColor,
        backgroundPadding: activeStyle?.backgroundPadding,
        textStyleId: activeTextStyleId ?? undefined,
        leaderPoints,
        leaderConfig: { ...defaultLeaderConfig },
      };

      addShape(textShape);

      // Open text editor so user can type
      startTextEditing(textShape.id);

      // Reset state
      linkedShapeIdRef.current = null;
      clearDrawingPoints();
      setDrawingPreview(null);
    },
    [
      drawingPoints, activeTool, activeLayerId, activeDrawingId, currentStyle,
      defaultTextStyle, defaultLeaderConfig, addShape, startTextEditing,
      clearDrawingPoints, setDrawingPreview, addDrawingPoint,
      activeTextStyleId, textStyles,
    ]
  );

  /**
   * Update leader preview during mouse move
   */
  const updateLeaderPreview = useCallback(
    (snappedPos: Point) => {
      if (drawingPoints.length === 0) return;

      setDrawingPreview({
        type: 'leader',
        points: [...drawingPoints],
        currentPoint: snappedPos,
      });
    },
    [drawingPoints, setDrawingPreview]
  );

  /**
   * Cancel leader drawing
   */
  const cancelLeader = useCallback(() => {
    linkedShapeIdRef.current = null;
    clearDrawingPoints();
    setDrawingPreview(null);
  }, [clearDrawingPoints, setDrawingPreview]);

  /**
   * Get the base point for snap tracking (arrow tip)
   */
  const getLeaderBasePoint = useCallback((): Point | null => {
    if (drawingPoints.length === 0) return null;
    return drawingPoints[0];
  }, [drawingPoints]);

  return {
    handleLeaderClick,
    handleLabelClick,
    updateLeaderPreview,
    cancelLeader,
    getLeaderBasePoint,
    isLeaderActive,
    isLeaderDrawing: isDrawing,
  };
}
