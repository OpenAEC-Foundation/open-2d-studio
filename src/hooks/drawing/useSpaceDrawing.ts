/**
 * useSpaceDrawing - Handles space (IfcSpace) placement
 *
 * Single click inside an area enclosed by walls:
 * 1. Detect the contour from surrounding walls
 * 2. Compute area from the contour polygon
 * 3. Create a SpaceShape at the centroid
 * 4. Auto-fill level from the active drawing's linked storey
 * 5. Auto-place a linked label (TextShape) at the centroid
 */

import { useCallback } from 'react';
import { useAppStore, generateId } from '../../state/appStore';
import type { Point, SpaceShape, TextShape, WallShape } from '../../types/geometry';
import { detectSpaceContour, computePolygonArea, computePolygonCentroid } from '../../engine/geometry/SpaceDetector';
import { getDefaultLabelTemplate, resolveTemplate } from '../../engine/geometry/LabelUtils';
import { CAD_DEFAULT_LINE_HEIGHT } from '../../constants/cadDefaults';

export function useSpaceDrawing() {
  const {
    activeLayerId,
    activeDrawingId,
    currentStyle,
    addShapes,
    shapes,
    pendingSpace,
  } = useAppStore();

  /**
   * Handle click for space detection and placement
   */
  const handleSpaceClick = useCallback(
    (clickPoint: Point): boolean => {
      if (!pendingSpace) return false;

      // Get all wall shapes in the current drawing
      const walls = shapes.filter(
        (s): s is WallShape => s.type === 'wall' && s.drawingId === activeDrawingId && s.visible
      );

      if (walls.length < 2) {
        console.warn('Not enough walls to detect a space. Need at least 2 walls.');
        return false;
      }

      // Detect the contour at the click point
      const contour = detectSpaceContour(clickPoint, walls);
      if (!contour) {
        console.warn('No enclosed space found at this point.');
        return false;
      }

      // Compute area (in mm^2, convert to m^2)
      const areaMm2 = computePolygonArea(contour);
      const areaM2 = areaMm2 / 1e6;

      // Compute centroid for label placement
      const centroid = computePolygonCentroid(contour);

      // ----------------------------------------------------------------
      // Auto-fill level from the active drawing's linked building storey
      // ----------------------------------------------------------------
      let autoLevel = pendingSpace.level || undefined;
      if (!autoLevel) {
        const { drawings, projectStructure } = useAppStore.getState();
        const activeDrawing = drawings.find(d => d.id === activeDrawingId);
        if (activeDrawing?.drawingType === 'plan' && activeDrawing.storeyId && projectStructure?.buildings) {
          for (const building of projectStructure.buildings) {
            const storey = building.storeys.find(s => s.id === activeDrawing.storeyId);
            if (storey) {
              autoLevel = storey.name;
              break;
            }
          }
        }
      }

      // Create the space shape
      const spaceId = generateId();
      const spaceShape: SpaceShape = {
        id: spaceId,
        type: 'space',
        layerId: activeLayerId,
        drawingId: activeDrawingId,
        style: { ...currentStyle },
        visible: true,
        locked: false,
        contourPoints: contour,
        name: pendingSpace.name || 'Room',
        number: pendingSpace.number || undefined,
        level: autoLevel,
        area: areaM2,
        labelPosition: centroid,
        fillColor: pendingSpace.fillColor || '#00ff00',
        fillOpacity: pendingSpace.fillOpacity ?? 0.1,
      };

      // ----------------------------------------------------------------
      // Auto-place a linked label (TextShape) at the space centroid
      // ----------------------------------------------------------------
      const template = getDefaultLabelTemplate('space');
      const labelText = resolveTemplate(template, spaceShape);

      // Resolve active text style for consistent formatting
      const { defaultTextStyle, activeTextStyleId, textStyles } = useAppStore.getState();
      const activeStyle = activeTextStyleId
        ? textStyles.find(s => s.id === activeTextStyleId)
        : null;

      const labelShape: TextShape = {
        id: generateId(),
        type: 'text',
        layerId: activeLayerId,
        drawingId: activeDrawingId,
        style: { ...currentStyle },
        visible: true,
        locked: false,
        position: centroid,
        text: labelText,
        fontSize: activeStyle?.fontSize ?? defaultTextStyle.fontSize,
        fontFamily: activeStyle?.fontFamily ?? defaultTextStyle.fontFamily,
        rotation: 0,
        alignment: 'center',
        verticalAlignment: 'middle',
        bold: activeStyle?.bold ?? defaultTextStyle.bold,
        italic: activeStyle?.italic ?? false,
        underline: activeStyle?.underline ?? false,
        color: activeStyle?.color ?? defaultTextStyle.color,
        lineHeight: activeStyle?.lineHeight ?? CAD_DEFAULT_LINE_HEIGHT,
        isModelText: true,
        // Link to the space element
        linkedShapeId: spaceId,
        // Store the template for auto-update on property changes
        labelTemplate: template,
      };

      // Add both space and label atomically in a single undo step
      addShapes([spaceShape, labelShape]);

      return true;
    },
    [shapes, activeDrawingId, activeLayerId, currentStyle, addShapes, pendingSpace]
  );

  /**
   * Cancel space drawing
   */
  const cancelSpaceDrawing = useCallback(() => {
    // Nothing to clean up - space is single-click
  }, []);

  return {
    handleSpaceClick,
    cancelSpaceDrawing,
  };
}
