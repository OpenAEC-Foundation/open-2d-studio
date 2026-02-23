/**
 * useWallDrawing - Handles wall drawing (click start, click end)
 * Follows the same pattern as useBeamDrawing.ts
 * Walls can join at corners with other walls.
 *
 * Hatching is now derived from the wall type's material at render time.
 * The wall shape still stores hatchType etc. for backward compatibility,
 * but the renderer will prefer the wall type's hatch settings when available.
 *
 * Grouped wall support: when the active wall type is a GroupedWallType,
 * a single draw action creates multiple parallel wall shapes grouped together.
 */

import { useCallback, useRef } from 'react';
import { useAppStore, generateId } from '../../state/appStore';
import type { Point, WallShape, WallJustification, WallEndCap, Shape, GroupedWallType } from '../../types/geometry';
import { snapToAngle, calculateBulgeFrom3Points } from '../../engine/geometry/GeometryUtils';
import { miterJoinWalls } from '../../engine/geometry/Modify';

/**
 * Compute a parallel offset of a line segment (start, end) by a perpendicular distance.
 * Positive offset = to the left of the direction vector (from start to end).
 */
function offsetLineSegment(
  start: Point,
  end: Point,
  offset: number
): { start: Point; end: Point } {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const len = Math.hypot(dx, dy);
  if (len < 1e-9) return { start: { ...start }, end: { ...end } };

  // Perpendicular unit vector (pointing left of direction)
  const px = -dy / len;
  const py = dx / len;

  return {
    start: { x: start.x + px * offset, y: start.y + py * offset },
    end: { x: end.x + px * offset, y: end.y + py * offset },
  };
}

export function useWallDrawing() {
  const {
    activeLayerId,
    activeDrawingId,
    currentStyle,
    addShape,
    updateShapes,
    drawingPoints,
    addDrawingPoint,
    clearDrawingPoints,
    setDrawingPreview,
    pendingWall,
    clearPendingWall,
  } = useAppStore();

  // Track the ID of the most recently placed wall for auto miter joining
  const previousWallIdRef = useRef<string | null>(null);

  /**
   * Check if the current pendingWall references a GroupedWallType.
   */
  const getGroupedWallType = useCallback((): GroupedWallType | undefined => {
    if (!pendingWall?.wallTypeId) return undefined;
    const state = useAppStore.getState();
    return state.groupedWallTypes.find(g => g.id === pendingWall.wallTypeId);
  }, [pendingWall?.wallTypeId]);

  /**
   * Resolve baseLevel and topLevel from the current drawing's storey assignment.
   * If the active drawing is a plan drawing linked to a storey, the wall gets:
   *   baseLevel = that storey's ID
   *   topLevel  = the next storey above (sorted by elevation), or 'unconnected' if none
   */
  const resolveWallLevels = useCallback((): { baseLevel?: string; topLevel?: string } => {
    const state = useAppStore.getState();
    const drawing = state.drawings.find((d) => d.id === activeDrawingId);
    if (!drawing || drawing.drawingType !== 'plan' || !drawing.storeyId) {
      return {};
    }

    // Collect all storeys from all buildings, sorted by elevation ascending
    const allStoreys: { id: string; elevation: number }[] = [];
    for (const building of state.projectStructure.buildings) {
      for (const storey of building.storeys) {
        allStoreys.push({ id: storey.id, elevation: storey.elevation });
      }
    }
    allStoreys.sort((a, b) => a.elevation - b.elevation);

    const currentIndex = allStoreys.findIndex((s) => s.id === drawing.storeyId);
    if (currentIndex === -1) {
      return {};
    }

    const baseLevel = allStoreys[currentIndex].id;
    const topLevel = currentIndex < allStoreys.length - 1
      ? allStoreys[currentIndex + 1].id
      : 'unconnected';

    return { baseLevel, topLevel };
  }, [activeDrawingId]);

  /**
   * Create a wall shape.
   * Hatch fields are set to defaults for backward compatibility, but
   * the renderer resolves hatch from the wallType when wallTypeId is set.
   */
  const createWall = useCallback(
    (
      start: Point,
      end: Point,
      thickness: number,
      options?: {
        wallTypeId?: string;
        wallSystemId?: string;
        justification?: WallJustification;
        showCenterline?: boolean;
        startCap?: WallEndCap;
        endCap?: WallEndCap;
        bulge?: number;
        groupId?: string;
        groupedWallTypeId?: string;
        groupedWallLayerIndex?: number;
      }
    ) => {
      // Resolve default base/top levels from the current drawing's storey
      const { baseLevel, topLevel } = resolveWallLevels();

      const wallShape: WallShape = {
        id: generateId(),
        type: 'wall',
        layerId: activeLayerId,
        drawingId: activeDrawingId,
        style: { ...currentStyle },
        visible: true,
        locked: false,
        start,
        end,
        thickness,
        wallTypeId: options?.wallTypeId,
        wallSystemId: options?.wallSystemId,
        justification: options?.justification || 'center',
        showCenterline: options?.showCenterline ?? false,
        startCap: options?.startCap || 'butt',
        endCap: options?.endCap || 'butt',
        bulge: options?.bulge,
        spaceBounding: true,
        baseLevel,
        topLevel,
        // Legacy hatch fields - kept for shape interface compat; renderer resolves hatch from materialHatchSettings
        hatchType: 'none',
        hatchAngle: 45,
        hatchSpacing: 50,
        // Grouped wall fields
        ...(options?.groupId ? { groupId: options.groupId } : {}),
        ...(options?.groupedWallTypeId ? { groupedWallTypeId: options.groupedWallTypeId } : {}),
        ...(options?.groupedWallLayerIndex !== undefined ? { groupedWallLayerIndex: options.groupedWallLayerIndex } : {}),
      };
      addShape(wallShape);
      return wallShape.id;
    },
    [activeLayerId, activeDrawingId, currentStyle, addShape, resolveWallLevels]
  );

  /**
   * Create a grouped wall assembly: multiple parallel walls from a GroupedWallType.
   * Returns the array of created wall IDs.
   *
   * Offset calculation:
   * - Calculate total thickness from all layers (thicknesses + gaps)
   * - Based on alignmentLine, determine the baseline offset
   * - For each drawn layer, compute its center offset from the draw line
   * - Create a parallel wall at that offset
   *
   * The draw line represents the alignment face:
   * - 'exterior': draw line = exterior face (first layer's outer edge)
   * - 'interior': draw line = interior face (last layer's inner edge)
   * - 'center': draw line = center of the total assembly
   *
   * Offset convention: positive offset = left of draw direction (exterior side).
   */
  const createGroupedWalls = useCallback(
    (
      start: Point,
      end: Point,
      gwt: GroupedWallType,
      options?: {
        justification?: WallJustification;
        showCenterline?: boolean;
        startCap?: WallEndCap;
        endCap?: WallEndCap;
        bulge?: number;
      }
    ): string[] => {
      const groupId = generateId();
      const wallTypes = useAppStore.getState().wallTypes;

      // Calculate layer positions (cumulative offset from exterior face)
      // Exterior face is at offset 0; interior face is at totalThickness
      let runningOffset = 0;
      const layerCenters: { layerIndex: number; centerOffset: number; thickness: number; wallTypeId: string }[] = [];

      for (let i = 0; i < gwt.layers.length; i++) {
        const layer = gwt.layers[i];
        const layerCenter = runningOffset + layer.thickness / 2;

        if (layer.isDrawn) {
          // Resolve actual wall type for this layer
          const wt = wallTypes.find(w => w.id === layer.wallTypeId);
          layerCenters.push({
            layerIndex: i,
            centerOffset: layerCenter,
            thickness: layer.thickness,
            wallTypeId: wt ? wt.id : layer.wallTypeId,
          });
        }

        runningOffset += layer.thickness + layer.gap;
      }

      // Determine baseline offset based on alignment line
      // baseline = how far the draw line is from the exterior face
      let baseline: number;
      switch (gwt.alignmentLine) {
        case 'exterior':
          baseline = 0;
          break;
        case 'interior':
          baseline = gwt.totalThickness;
          break;
        case 'center':
        default:
          baseline = gwt.totalThickness / 2;
          break;
      }

      // Create wall shapes
      const wallIds: string[] = [];
      for (const lc of layerCenters) {
        // Offset from the draw line: positive = towards exterior (left)
        // centerOffset is from exterior face, baseline is draw line position from exterior face
        // So: perpendicular offset = baseline - centerOffset
        // (positive when draw line is more interior than the layer = layer is exterior of draw line)
        const perpOffset = baseline - lc.centerOffset;

        // Compute parallel start/end points
        const { start: layerStart, end: layerEnd } = offsetLineSegment(start, end, perpOffset);

        const wallId = createWall(layerStart, layerEnd, lc.thickness, {
          wallTypeId: lc.wallTypeId,
          justification: 'center', // Each sub-wall is centered on its own centerline
          showCenterline: options?.showCenterline ?? false,
          startCap: options?.startCap || 'butt',
          endCap: options?.endCap || 'butt',
          bulge: options?.bulge,
          groupId,
          groupedWallTypeId: gwt.id,
          groupedWallLayerIndex: lc.layerIndex,
        });
        wallIds.push(wallId);
      }

      // Register the group in the store (add to groups array)
      useAppStore.setState((storeState) => ({
        groups: [...storeState.groups, { id: groupId, drawingId: activeDrawingId }],
      }));

      return wallIds;
    },
    [createWall, activeDrawingId]
  );

  /**
   * Create 4 walls forming a rectangle from two opposite corners.
   * Auto miter-joins all 4 corners.
   */
  const createRectangleWalls = useCallback(
    (corner1: Point, corner2: Point) => {
      if (!pendingWall) return;

      // Derive the 4 corners of the rectangle (axis-aligned)
      const c1 = corner1;
      const c2 = { x: corner2.x, y: corner1.y };
      const c3 = corner2;
      const c4 = { x: corner1.x, y: corner2.y };

      const wallOpts = {
        wallTypeId: pendingWall.wallTypeId,
        wallSystemId: pendingWall.wallSystemId,
        justification: pendingWall.justification,
        showCenterline: pendingWall.showCenterline,
        startCap: pendingWall.startCap,
        endCap: pendingWall.endCap,
      };

      // Create 4 wall segments: bottom, right, top, left
      const id1 = createWall(c1, c2, pendingWall.thickness, wallOpts);
      const id2 = createWall(c2, c3, pendingWall.thickness, wallOpts);
      const id3 = createWall(c3, c4, pendingWall.thickness, wallOpts);
      const id4 = createWall(c4, c1, pendingWall.thickness, wallOpts);

      // Auto miter join consecutive walls at corners.
      // We deep-clone the wall shapes into mutable local copies so that each
      // iteration of the loop can see geometry changes made by previous joins
      // (the store objects are frozen by Immer and cannot be mutated directly).
      const wallIds = [id1, id2, id3, id4];
      const currentShapes = useAppStore.getState().shapes;
      const wallShapes = wallIds.map(id => {
        const found = currentShapes.find((s: Shape) => s.id === id);
        return found ? { ...found } as WallShape : undefined;
      });

      // Accumulate per-wall updates keyed by ID so multiple joins merge cleanly.
      // We use Record<string, unknown> to avoid complex Partial<Shape> union spreads.
      const mergedUpdates = new Map<string, Record<string, unknown>>();
      for (let i = 0; i < 4; i++) {
        const prevWall = wallShapes[i];
        const nextWall = wallShapes[(i + 1) % 4];
        if (prevWall && nextWall) {
          const result = miterJoinWalls(prevWall, nextWall);
          if (result) {
            // Merge into accumulated updates for each wall
            const prev1 = mergedUpdates.get(prevWall.id) || {};
            mergedUpdates.set(prevWall.id, { ...prev1, ...(result.shape1Update as Record<string, unknown>) });
            const prev2 = mergedUpdates.get(nextWall.id) || {};
            mergedUpdates.set(nextWall.id, { ...prev2, ...(result.shape2Update as Record<string, unknown>) });
            // Update local mutable copies so subsequent joins see updated geometry
            Object.assign(prevWall, result.shape1Update);
            Object.assign(nextWall, result.shape2Update);
          }
        }
      }
      if (mergedUpdates.size > 0) {
        const updates = Array.from(mergedUpdates.entries()).map(
          ([id, u]) => ({ id, updates: u as Partial<Shape> })
        );
        updateShapes(updates);
      }
    },
    [pendingWall, createWall, updateShapes]
  );

  /**
   * Create 2 semicircular arc walls forming a complete circle.
   * Wall 1: top to bottom (left semicircle), bulge = 1
   * Wall 2: bottom to top (right semicircle), bulge = 1
   */
  const createCircleWalls = useCallback(
    (center: Point, radius: number) => {
      if (!pendingWall || radius < 1) return;

      const top: Point = { x: center.x, y: center.y - radius };
      const bottom: Point = { x: center.x, y: center.y + radius };

      const wallOpts = {
        wallTypeId: pendingWall.wallTypeId,
        wallSystemId: pendingWall.wallSystemId,
        justification: pendingWall.justification,
        showCenterline: pendingWall.showCenterline,
        startCap: pendingWall.startCap,
        endCap: pendingWall.endCap,
      };

      // Left semicircle: top -> bottom, bulge = 1 (positive = curves left)
      createWall(top, bottom, pendingWall.thickness, { ...wallOpts, bulge: 1 });
      // Right semicircle: bottom -> top, bulge = 1
      createWall(bottom, top, pendingWall.thickness, { ...wallOpts, bulge: 1 });
    },
    [pendingWall, createWall]
  );

  /**
   * Handle click for wall drawing
   */
  const handleWallClick = useCallback(
    (snappedPos: Point, shiftKey: boolean) => {
      if (!pendingWall) return false;

      const isArcMode = pendingWall.shapeMode === 'arc';
      const isRectMode = pendingWall.shapeMode === 'rectangle';
      const isCircleMode = pendingWall.shapeMode === 'circle';

      if (drawingPoints.length === 0) {
        // First click: set start point (or center for circle mode)
        addDrawingPoint(snappedPos);
        return true;
      } else if (isCircleMode && drawingPoints.length === 1) {
        // Circle mode: second click = radius point
        const center = drawingPoints[0];
        const radius = Math.hypot(snappedPos.x - center.x, snappedPos.y - center.y);

        if (radius > 1) {
          createCircleWalls(center, radius);
        }

        clearDrawingPoints();
        setDrawingPreview(null);
        previousWallIdRef.current = null;
        // Keep pendingWall active for consecutive circles
        return true;
      } else if (isRectMode && drawingPoints.length === 1) {
        // Rectangle mode: second click = opposite corner
        const corner1 = drawingPoints[0];
        const corner2 = snappedPos;

        const dx = Math.abs(corner2.x - corner1.x);
        const dy = Math.abs(corner2.y - corner1.y);

        if (dx > 1 && dy > 1) {
          createRectangleWalls(corner1, corner2);
        }

        clearDrawingPoints();
        setDrawingPreview(null);
        previousWallIdRef.current = null;
        // Keep pendingWall active for consecutive rectangles
        return true;
      } else if (isArcMode && drawingPoints.length === 1) {
        // Arc mode, second click: store arc-through-point
        addDrawingPoint(snappedPos);
        return true;
      } else {
        // Line mode: second click = end point
        // Arc mode: third click = end point
        const startPoint = drawingPoints[0];
        const finalPos = shiftKey ? snapToAngle(startPoint, snappedPos) : snappedPos;

        const dx = Math.abs(finalPos.x - startPoint.x);
        const dy = Math.abs(finalPos.y - startPoint.y);

        // Calculate bulge for arc mode
        let bulge: number | undefined;
        if (isArcMode && drawingPoints.length === 2) {
          bulge = calculateBulgeFrom3Points(startPoint, drawingPoints[1], finalPos);
          if (bulge === 0) bulge = undefined; // collinear = straight line
        }

        // Only create if there's a meaningful distance
        let newWallId: string | null = null;
        if (dx > 1 || dy > 1) {
          // Check if this is a grouped wall type
          const gwt = getGroupedWallType();

          if (gwt) {
            // Grouped wall: create multiple parallel walls
            const wallIds = createGroupedWalls(startPoint, finalPos, gwt, {
              showCenterline: pendingWall.showCenterline,
              startCap: pendingWall.startCap,
              endCap: pendingWall.endCap,
              bulge,
            });
            // Use the first wall as the reference for miter joining (outermost wall)
            newWallId = wallIds.length > 0 ? wallIds[0] : null;
          } else {
            // Regular single wall
            newWallId = createWall(
              startPoint,
              finalPos,
              pendingWall.thickness,
              {
                wallTypeId: pendingWall.wallTypeId,
                wallSystemId: pendingWall.wallSystemId,
                justification: pendingWall.justification,
                showCenterline: pendingWall.showCenterline,
                startCap: pendingWall.startCap,
                endCap: pendingWall.endCap,
                bulge,
              }
            );

            // Auto miter join with the previous wall in continuous drawing mode (only for line mode)
            if (!isArcMode && pendingWall.continueDrawing !== false && previousWallIdRef.current && newWallId) {
              // Get the latest shapes from the store (includes the just-added wall)
              const currentShapes = useAppStore.getState().shapes;
              const prevWall = currentShapes.find((s: Shape) => s.id === previousWallIdRef.current) as WallShape | undefined;
              const newWall = currentShapes.find((s: Shape) => s.id === newWallId) as WallShape | undefined;

              if (prevWall && newWall) {
                // Check that the new wall's start matches the previous wall's end (shared endpoint)
                const tolerance = 1; // snap tolerance in drawing units
                const endToStartDist = Math.hypot(
                  newWall.start.x - prevWall.end.x,
                  newWall.start.y - prevWall.end.y
                );

                if (endToStartDist <= tolerance) {
                  // Check that the walls are not collinear (straight continuation)
                  // Compute direction angles of both walls
                  const angle1 = Math.atan2(prevWall.end.y - prevWall.start.y, prevWall.end.x - prevWall.start.x);
                  const angle2 = Math.atan2(newWall.end.y - newWall.start.y, newWall.end.x - newWall.start.x);
                  // Normalize difference to [0, PI]
                  let angleDiff = Math.abs(angle2 - angle1);
                  if (angleDiff > Math.PI) angleDiff = 2 * Math.PI - angleDiff;
                  // Skip if collinear (angle difference ~0 or ~180 degrees)
                  const collinearTolerance = 0.02; // ~1 degree in radians
                  if (angleDiff > collinearTolerance && Math.abs(angleDiff - Math.PI) > collinearTolerance) {
                    const result = miterJoinWalls(prevWall, newWall);
                    if (result) {
                      updateShapes([
                        { id: prevWall.id, updates: result.shape1Update },
                        { id: newWall.id, updates: result.shape2Update },
                      ]);
                    }
                  }
                }
              }
            }
          }
        }

        clearDrawingPoints();
        setDrawingPreview(null);
        // Chain drawing: use endpoint as next start point
        if (pendingWall.continueDrawing !== false) {
          addDrawingPoint(finalPos);
          // Track the new wall for the next miter join
          previousWallIdRef.current = newWallId;
        } else {
          // Not continuing: reset the previous wall tracker
          previousWallIdRef.current = null;
        }
        // Keep pendingWall active for consecutive drawing
        return true;
      }
    },
    [pendingWall, drawingPoints, addDrawingPoint, clearDrawingPoints, setDrawingPreview, createWall, createGroupedWalls, getGroupedWallType, createRectangleWalls, createCircleWalls, updateShapes]
  );

  /**
   * Update wall preview
   */
  const updateWallPreview = useCallback(
    (snappedPos: Point, shiftKey: boolean) => {
      if (!pendingWall || drawingPoints.length === 0) return;

      const startPoint = drawingPoints[0];
      const isArcMode = pendingWall.shapeMode === 'arc';
      const isRectMode = pendingWall.shapeMode === 'rectangle';
      const isCircleMode = pendingWall.shapeMode === 'circle';

      if (isCircleMode) {
        // Circle mode: show circular wall preview from center to cursor (radius)
        const radius = Math.hypot(snappedPos.x - startPoint.x, snappedPos.y - startPoint.y);
        setDrawingPreview({
          type: 'wall-circle',
          center: startPoint,
          radius,
          thickness: pendingWall.thickness,
          showCenterline: pendingWall.showCenterline,
          wallTypeId: pendingWall.wallTypeId,
          justification: pendingWall.justification,
        });
      } else if (isRectMode) {
        // Rectangle mode: show 4-wall rectangle preview from corner1 to cursor
        setDrawingPreview({
          type: 'wall-rectangle',
          corner1: startPoint,
          corner2: snappedPos,
          thickness: pendingWall.thickness,
          showCenterline: pendingWall.showCenterline,
          wallTypeId: pendingWall.wallTypeId,
          justification: pendingWall.justification,
        });
      } else if (isArcMode && drawingPoints.length === 2) {
        // Arc mode with 2 points placed: show arc preview from start to cursor through arc-point
        const previewPos = shiftKey ? snapToAngle(startPoint, snappedPos) : snappedPos;
        const bulge = calculateBulgeFrom3Points(startPoint, drawingPoints[1], previewPos);

        setDrawingPreview({
          type: 'wall',
          start: startPoint,
          end: previewPos,
          thickness: pendingWall.thickness,
          showCenterline: pendingWall.showCenterline,
          wallTypeId: pendingWall.wallTypeId,
          justification: pendingWall.justification,
          bulge: bulge !== 0 ? bulge : undefined,
        });
      } else {
        // Line mode, or arc mode with only 1 point: show line from start to cursor
        const previewPos = shiftKey ? snapToAngle(startPoint, snappedPos) : snappedPos;

        setDrawingPreview({
          type: 'wall',
          start: startPoint,
          end: previewPos,
          thickness: pendingWall.thickness,
          showCenterline: pendingWall.showCenterline,
          wallTypeId: pendingWall.wallTypeId,
          justification: pendingWall.justification,
        });
      }
    },
    [pendingWall, drawingPoints, setDrawingPreview]
  );

  /**
   * Cancel wall drawing
   */
  const cancelWallDrawing = useCallback(() => {
    clearDrawingPoints();
    setDrawingPreview(null);
    clearPendingWall();
    previousWallIdRef.current = null;
  }, [clearDrawingPoints, setDrawingPreview, clearPendingWall]);

  /**
   * Get the base point for tracking (first click point)
   */
  const getWallBasePoint = useCallback((): Point | null => {
    if (!pendingWall || drawingPoints.length === 0) return null;
    return drawingPoints[0];
  }, [pendingWall, drawingPoints]);

  return {
    handleWallClick,
    updateWallPreview,
    cancelWallDrawing,
    getWallBasePoint,
    createWall,
    isWallDrawingActive: !!pendingWall,
    hasFirstPoint: drawingPoints.length > 0,
  };
}
