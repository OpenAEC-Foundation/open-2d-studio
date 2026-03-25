/**
 * useModifyTools - Core hook for all 9 modify/edit tools
 *
 * Handles: Move, Copy, Rotate, Scale, Mirror, Trim, Extend, Fillet, Offset
 */

import { useCallback } from 'react';
import { useAppStore } from '../../state/appStore';
import type { Point, Shape, ToolType, PlateSystemShape } from '../../types/geometry';
import type { ParametricShape } from '../../types/parametric';
import {
  transformShape,
  translateTransform,
  rotateTransform,
  scaleTransform,
  mirrorTransform,
  getShapeTransformUpdates,
  trimLineAtIntersection,
  extendLineToBoundary,
  extendBothToIntersection,
  filletTwoLines,
  chamferTwoLines,
  offsetShape,
  miterJoinWalls,
} from '../../engine/geometry/Modify';
import { generateId, getShapeBounds } from '../../state/slices/types';
import { findLinkedLabels, computeLinkedLabelPosition } from '../../engine/geometry/LabelUtils';
import { regenerateGridDimensions, updateLinkedDimensions } from '../../utils/gridDimensionUtils';
import { MODIFY_TOOLS, getLinkedLabelUpdates, getMiterRecalcUpdates, nextGridlineLabel } from './modifyToolHelpers';
import { updateModifyPreview as updateModifyPreviewImpl, type ModifyPreviewContext } from './modifyToolPreview';

export function useModifyTools() {
  const activeTool = useAppStore((s) => s.activeTool);
  const drawingPoints = useAppStore((s) => s.drawingPoints);
  const selectedShapeIds = useAppStore((s) => s.selectedShapeIds);
  const shapes = useAppStore((s) => s.shapes);
  const parametricShapes = useAppStore((s) => s.parametricShapes);
  const addDrawingPoint = useAppStore((s) => s.addDrawingPoint);
  const clearDrawingPoints = useAppStore((s) => s.clearDrawingPoints);
  const setDrawingPreview = useAppStore((s) => s.setDrawingPreview);
  const addShapes = useAppStore((s) => s.addShapes);
  const updateShapes = useAppStore((s) => s.updateShapes);
  const selectShape = useAppStore((s) => s.selectShape);
  const selectShapes = useAppStore((s) => s.selectShapes);
  const cloneParametricShapes = useAppStore((s) => s.cloneParametricShapes);
  const updateProfilePosition = useAppStore((s) => s.updateProfilePosition);
  const selectedGrip = useAppStore((s) => s.selectedGrip);
  const setSelectedGrip = useAppStore((s) => s.setSelectedGrip);
  const updateProfileRotation = useAppStore((s) => s.updateProfileRotation);
  const updateProfileScale = useAppStore((s) => s.updateProfileScale);

  // Modify options
  const modifyCopy = useAppStore((s) => s.modifyCopy);
  const modifyConstrainAxis = useAppStore((s) => s.modifyConstrainAxis);
  const modifyMultiple = useAppStore((s) => s.modifyMultiple);
  const scaleMode = useAppStore((s) => s.scaleMode);
  const scaleFactor = useAppStore((s) => s.scaleFactor);
  const filletRadius = useAppStore((s) => s.filletRadius);
  const chamferDistance1 = useAppStore((s) => s.chamferDistance1);
  const chamferDistance2 = useAppStore((s) => s.chamferDistance2);
  const offsetDistance = useAppStore((s) => s.offsetDistance);
  const offsetFlipped = useAppStore((s) => s.offsetFlipped);
  const hoveredShapeId = useAppStore((s) => s.hoveredShapeId);
  const lockedDistance = useAppStore((s) => s.lockedDistance);
  const rotateAngle = useAppStore((s) => s.rotateAngle);
  const modifyRefShapeId = useAppStore((s) => s.modifyRefShapeId);
  const setModifyRefShapeId = useAppStore((s) => s.setModifyRefShapeId);
  const setActiveTool = useAppStore((s) => s.setActiveTool);
  const activeDrawingId = useAppStore((s) => s.activeDrawingId);
  const activeLayerId = useAppStore((s) => s.activeLayerId);
  const arrayMode = useAppStore((s) => s.arrayMode);
  const arrayCount = useAppStore((s) => s.arrayCount);
  const arraySpacing = useAppStore((s) => s.arraySpacing);
  const arrayAngle = useAppStore((s) => s.arrayAngle);

  /** Constrain a delta vector to the specified axis */
  const constrainDelta = useCallback((dx: number, dy: number): { dx: number; dy: number } => {
    if (modifyConstrainAxis === 'x') return { dx, dy: 0 };
    if (modifyConstrainAxis === 'y') return { dx: 0, dy };
    return { dx, dy };
  }, [modifyConstrainAxis]);

  const isModifyTool = useCallback((tool: ToolType) => MODIFY_TOOLS.includes(tool), []);

  const getSelectedShapes = useCallback((): Shape[] => {
    const idSet = new Set(selectedShapeIds);
    return shapes.filter((s) => idSet.has(s.id));
  }, [shapes, selectedShapeIds]);

  /**
   * Collect child beam shape IDs from plate-system shapes in the selection.
   * Returns the IDs of child beams that are NOT already in the selection.
   */
  const getPlateSystemChildIds = useCallback((selected: Shape[]): string[] => {
    const selectedIdSet = new Set(selectedShapeIds);
    const childIds: string[] = [];
    for (const s of selected) {
      if (s.type === 'plate-system') {
        const ps = s as PlateSystemShape;
        if (ps.childShapeIds) {
          for (const cid of ps.childShapeIds) {
            if (!selectedIdSet.has(cid)) {
              childIds.push(cid);
            }
          }
        }
      }
    }
    return childIds;
  }, [selectedShapeIds]);

  /**
   * Get child beam shapes of plate-systems in the selection that are not
   * themselves already selected. Used to move/copy/rotate/mirror child beams
   * together with their parent plate-system.
   */
  const getPlateSystemChildShapes = useCallback((selected: Shape[]): Shape[] => {
    const childIds = getPlateSystemChildIds(selected);
    if (childIds.length === 0) return [];
    const childIdSet = new Set(childIds);
    return shapes.filter(s => childIdSet.has(s.id));
  }, [shapes, getPlateSystemChildIds]);

  const getSelectedParametricShapes = useCallback((): ParametricShape[] => {
    const idSet = new Set(selectedShapeIds);
    return parametricShapes.filter((s) => idSet.has(s.id));
  }, [parametricShapes, selectedShapeIds]);

  /** Auto-regenerate grid dimensions if any of the given shapes include a gridline */
  const triggerGridDimensionRegenIfNeeded = useCallback((affectedShapes: Shape[]) => {
    const movedGridlines = affectedShapes.filter(s => s.type === 'gridline');
    if (movedGridlines.length > 0) {
      // Update associative DimAssociate dimensions linked to moved gridlines
      for (const gl of movedGridlines) {
        updateLinkedDimensions(gl.id);
      }
      // Regenerate auto-generated grid dimensions (always-on)
      setTimeout(() => regenerateGridDimensions(), 50);
    }
  }, []);

  /**
   * Handle click for modify tools. Returns true if handled.
   */
  const handleModifyClick = useCallback(
    (worldPos: Point, shiftKey: boolean, findShapeAtPoint?: (pos: Point) => string | null): boolean => {
      if (!MODIFY_TOOLS.includes(activeTool)) return false;
      const pts = drawingPoints;
      const numPts = pts.length;

      switch (activeTool) {
        // ==================================================================
        // MOVE
        // ==================================================================
        case 'move': {
          if (selectedShapeIds.length === 0) {
            // Select mode: click to select and use as base point
            if (findShapeAtPoint) {
              const id = findShapeAtPoint(worldPos);
              if (id) {
                selectShape(id, shiftKey);
                addDrawingPoint(worldPos);
              }
            }
            return true;
          }
          if (numPts === 0) {
            // Click base point
            addDrawingPoint(worldPos);
            return true;
          }
          // Click destination
          const basePoint = pts[0];
          const { dx, dy } = constrainDelta(worldPos.x - basePoint.x, worldPos.y - basePoint.y);

          // --- Endpoint grip move: stretch only the selected endpoint ---
          if (selectedGrip && (selectedGrip.gripIndex === 0 || selectedGrip.gripIndex === 1)) {
            const shape = shapes.find(s => s.id === selectedGrip.shapeId);
            if (shape) {
              const endpointKey = selectedGrip.gripIndex === 0 ? 'start' : 'end';
              const currentEndpoint = (shape as any)[endpointKey] as Point;
              const shapeUpdates: Partial<Shape> = {
                [endpointKey]: { x: currentEndpoint.x + dx, y: currentEndpoint.y + dy },
              } as any;
              const batchUpdates: { id: string; updates: Partial<Shape> }[] = [{ id: shape.id, updates: shapeUpdates }];

              // Recalculate miter joins for walls/beams with miter angles
              const allShapesNow = useAppStore.getState().shapes;
              const miterUpdates = getMiterRecalcUpdates(batchUpdates, [shape], allShapesNow);
              for (const mu of miterUpdates) {
                const existing = batchUpdates.find(u => u.id === mu.id);
                if (existing) {
                  existing.updates = { ...(existing.updates as any), ...(mu.updates as any) };
                } else {
                  batchUpdates.push(mu);
                }
              }

              // Update linked labels to stay parallel with the modified shape
              const postShape = { ...shape, ...shapeUpdates } as Shape;
              const stretchBeamLabelDist = useAppStore.getState().planSubtypeSettings?.structuralPlan?.beamLabelStartDistance ?? 1000;
              const labelPos = computeLinkedLabelPosition(postShape, stretchBeamLabelDist);
              if (labelPos) {
                const linkedLabels = findLinkedLabels(allShapesNow, shape.id);
                for (const label of linkedLabels) {
                  batchUpdates.push({
                    id: label.id,
                    updates: {
                      position: labelPos.position,
                      rotation: labelPos.rotation,
                    } as Partial<Shape>,
                  });
                }
              }

              updateShapes(batchUpdates);
              triggerGridDimensionRegenIfNeeded([shape]);
            }
            setSelectedGrip(null);
            clearDrawingPoints();
            setActiveTool('select');
            return true;
          }

          const transform = translateTransform(dx, dy);
          const selected = getSelectedShapes();
          const selectedParametric = getSelectedParametricShapes();

          // Collect child beams of plate-systems that need to move along
          const childBeams = getPlateSystemChildShapes(selected);

          if (modifyCopy) {
            // Copy regular shapes (including plate-system child beams)
            const allToCopy = [...selected, ...childBeams];
            if (allToCopy.length > 0) {
              // Build old-ID -> new-ID map for plate-system parent-child linkage
              const idMap = new Map<string, string>();
              const copies = allToCopy.map((s) => {
                const copy = transformShape(s, transform);
                idMap.set(s.id, copy.id);
                return copy;
              });
              // Re-link child beams to their new parent plate-system IDs
              for (const copy of copies) {
                if (copy.type === 'beam' && (copy as any).plateSystemId) {
                  const newParentId = idMap.get((copy as any).plateSystemId);
                  if (newParentId) (copy as any).plateSystemId = newParentId;
                }
                if (copy.type === 'plate-system' && (copy as any).childShapeIds) {
                  (copy as any).childShapeIds = ((copy as any).childShapeIds as string[]).map(
                    (cid: string) => idMap.get(cid) ?? cid
                  );
                }
              }
              addShapes(copies);
            }
            // Copy parametric shapes
            if (selectedParametric.length > 0) {
              cloneParametricShapes(
                selectedParametric.map(s => s.id),
                { x: dx, y: dy }
              );
            }
          } else {
            // Move regular shapes (including plate-system child beams)
            const allToMove = [...selected, ...childBeams];
            if (allToMove.length > 0) {
              const updates = allToMove.map((s) => ({
                id: s.id,
                updates: getShapeTransformUpdates(s, transform),
              }));

              // Also move linked labels that are NOT already in the selection
              const allShapes = useAppStore.getState().shapes;
              const labelUpdates = getLinkedLabelUpdates(allToMove, allShapes, new Set(selectedShapeIds), transform);
              updates.push(...labelUpdates);

              // Recalculate miter joins for walls/beams with miter angles
              const miterUpdates = getMiterRecalcUpdates(updates, allToMove, allShapes);
              for (const mu of miterUpdates) {
                const existing = updates.find(u => u.id === mu.id);
                if (existing) {
                  existing.updates = { ...(existing.updates as any), ...(mu.updates as any) };
                } else {
                  updates.push(mu);
                }
              }

              updateShapes(updates);
            }
            // Move parametric shapes
            for (const ps of selectedParametric) {
              updateProfilePosition(ps.id, {
                x: ps.position.x + dx,
                y: ps.position.y + dy,
              });
            }
          }
          triggerGridDimensionRegenIfNeeded(selected);
          clearDrawingPoints();
          setActiveTool('select');
          return true;
        }

        // ==================================================================
        // COPY / COPY2
        // ==================================================================
        case 'copy2':
        case 'copy': {
          if (selectedShapeIds.length === 0) {
            if (findShapeAtPoint) {
              const id = findShapeAtPoint(worldPos);
              if (id) {
                selectShape(id, shiftKey);
                // Use click position as base point immediately (saves one click)
                addDrawingPoint(worldPos);
              }
            }
            return true;
          }
          if (numPts === 0) {
            addDrawingPoint(worldPos);
            return true;
          }
          // Place copy
          const basePoint = pts[0];
          const { dx, dy } = constrainDelta(worldPos.x - basePoint.x, worldPos.y - basePoint.y);
          const transform = translateTransform(dx, dy);

          // Copy regular shapes (including plate-system child beams)
          const selectedForCopy = getSelectedShapes();
          const childBeamsForCopy = getPlateSystemChildShapes(selectedForCopy);
          const allToCopy = [...selectedForCopy, ...childBeamsForCopy];

          // Build old-ID -> new-ID map for plate-system parent-child linkage
          const copyIdMap = new Map<string, string>();
          const regularCopies = allToCopy.map((s) => {
            const copy = transformShape(s, transform);
            copyIdMap.set(s.id, copy.id);
            return copy;
          });

          // Re-link child beams to their new parent plate-system IDs
          for (const copy of regularCopies) {
            if (copy.type === 'beam' && (copy as any).plateSystemId) {
              const newParentId = copyIdMap.get((copy as any).plateSystemId);
              if (newParentId) (copy as any).plateSystemId = newParentId;
            }
            if (copy.type === 'plate-system' && (copy as any).childShapeIds) {
              (copy as any).childShapeIds = ((copy as any).childShapeIds as string[]).map(
                (cid: string) => copyIdMap.get(cid) ?? cid
              );
            }
          }

          // Auto-increment gridline labels
          for (const copy of regularCopies) {
            if (copy.type === 'gridline') {
              const existingLabels = new Set(
                shapes.filter((s) => s.type === 'gridline').map((s) => (s as { label: string }).label)
              );
              copy.label = nextGridlineLabel(copy.label, existingLabels);
            }
          }

          if (regularCopies.length > 0) {
            addShapes(regularCopies);
          }

          // Copy parametric shapes
          const selectedParametric = getSelectedParametricShapes();
          if (selectedParametric.length > 0) {
            cloneParametricShapes(
              selectedParametric.map(s => s.id),
              { x: dx, y: dy }
            );
          }

          // Select the new copies instead of the originals (only the primary shapes, not child beams)
          const newIds = regularCopies.filter(s => {
            // Only select shapes that correspond to originally selected shapes
            return !childBeamsForCopy.some(cb => copyIdMap.get(cb.id) === s.id);
          }).map(s => s.id);
          // For parametric clones, get the newly added IDs from the store
          const storeAfter = useAppStore.getState();
          const allParamIds = new Set(storeAfter.parametricShapes.map(s => s.id));
          const origParamIds = new Set(selectedParametric.map(s => s.id));
          for (const id of allParamIds) {
            if (!origParamIds.has(id) && !selectedShapeIds.includes(id)) {
              // Likely a newly cloned parametric shape
              newIds.push(id);
            }
          }
          if (newIds.length > 0) {
            selectShapes(newIds);
          }

          triggerGridDimensionRegenIfNeeded(regularCopies);
          clearDrawingPoints();
          setDrawingPreview(null);
          // Continue mode: stay in copy tool for next placement (not for copy2)
          if (activeTool === 'copy' && modifyMultiple) {
            // Keep tool active, user clicks new base point next
          } else {
            setActiveTool('select');
          }
          return true;
        }

        // ==================================================================
        // ROTATE
        // ==================================================================
        case 'rotate': {
          if (selectedShapeIds.length === 0) {
            if (findShapeAtPoint) {
              const id = findShapeAtPoint(worldPos);
              if (id) selectShape(id, shiftKey);
            }
            return true;
          }
          if (numPts === 0) {
            // Click center of rotation
            addDrawingPoint(worldPos);
            // If angle is typed, execute immediately
            if (rotateAngle !== null) {
              const center = worldPos;
              const angleRad = (rotateAngle * Math.PI) / 180;
              const transform = rotateTransform(center, angleRad);
              const selected = getSelectedShapes();
              const selectedParametric = getSelectedParametricShapes();
              const childBeamsRot1 = getPlateSystemChildShapes(selected);
              const allToRot1 = [...selected, ...childBeamsRot1];

              if (modifyCopy) {
                if (allToRot1.length > 0) {
                  addShapes(allToRot1.map((s) => transformShape(s, transform)));
                }
                // Copy and rotate parametric shapes
                if (selectedParametric.length > 0) {
                  const clones = cloneParametricShapes(selectedParametric.map(s => s.id), { x: 0, y: 0 });
                  for (const clone of clones) {
                    // Rotate position around center
                    const cos = Math.cos(angleRad);
                    const sin = Math.sin(angleRad);
                    const dx = clone.position.x - center.x;
                    const dy = clone.position.y - center.y;
                    const newX = center.x + dx * cos - dy * sin;
                    const newY = center.y + dx * sin + dy * cos;
                    updateProfilePosition(clone.id, { x: newX, y: newY });
                    updateProfileRotation(clone.id, clone.rotation + angleRad);
                  }
                }
              } else {
                if (allToRot1.length > 0) {
                  const updates = allToRot1.map((s) => ({ id: s.id, updates: getShapeTransformUpdates(s, transform) }));
                  const allShapes = useAppStore.getState().shapes;
                  updates.push(...getLinkedLabelUpdates(allToRot1, allShapes, new Set(selectedShapeIds), transform));
                  // Recalculate miter joins for walls/beams with miter angles
                  const miterUpdates = getMiterRecalcUpdates(updates, allToRot1, allShapes);
                  for (const mu of miterUpdates) {
                    const existing = updates.find(u => u.id === mu.id);
                    if (existing) { existing.updates = { ...(existing.updates as any), ...(mu.updates as any) }; }
                    else { updates.push(mu); }
                  }
                  updateShapes(updates);
                }
                // Rotate parametric shapes
                for (const ps of selectedParametric) {
                  const cos = Math.cos(angleRad);
                  const sin = Math.sin(angleRad);
                  const dx = ps.position.x - center.x;
                  const dy = ps.position.y - center.y;
                  const newX = center.x + dx * cos - dy * sin;
                  const newY = center.y + dx * sin + dy * cos;
                  updateProfilePosition(ps.id, { x: newX, y: newY });
                  updateProfileRotation(ps.id, ps.rotation + angleRad);
                }
              }
              triggerGridDimensionRegenIfNeeded(selected);
              clearDrawingPoints();
            }
            return true;
          }
          if (numPts === 1) {
            // Click start ray
            addDrawingPoint(worldPos);
            return true;
          }
          // Click end ray -> execute rotation
          const center = pts[0];
          const startAngle = Math.atan2(pts[1].y - center.y, pts[1].x - center.x);
          const endAngle = Math.atan2(worldPos.y - center.y, worldPos.x - center.x);
          const angle = endAngle - startAngle;
          const transform = rotateTransform(center, angle);
          const selected = getSelectedShapes();
          const selectedParametric = getSelectedParametricShapes();
          const childBeamsRot2 = getPlateSystemChildShapes(selected);
          const allToRot2 = [...selected, ...childBeamsRot2];

          if (modifyCopy) {
            if (allToRot2.length > 0) {
              addShapes(allToRot2.map((s) => transformShape(s, transform)));
            }
            // Copy and rotate parametric shapes
            if (selectedParametric.length > 0) {
              const clones = cloneParametricShapes(selectedParametric.map(s => s.id), { x: 0, y: 0 });
              for (const clone of clones) {
                const cos = Math.cos(angle);
                const sin = Math.sin(angle);
                const dx = clone.position.x - center.x;
                const dy = clone.position.y - center.y;
                const newX = center.x + dx * cos - dy * sin;
                const newY = center.y + dx * sin + dy * cos;
                updateProfilePosition(clone.id, { x: newX, y: newY });
                updateProfileRotation(clone.id, clone.rotation + angle);
              }
            }
          } else {
            if (allToRot2.length > 0) {
              const updates = allToRot2.map((s) => ({ id: s.id, updates: getShapeTransformUpdates(s, transform) }));
              const allShapes = useAppStore.getState().shapes;
              updates.push(...getLinkedLabelUpdates(allToRot2, allShapes, new Set(selectedShapeIds), transform));
              // Recalculate miter joins for walls/beams with miter angles
              const miterUpdates = getMiterRecalcUpdates(updates, allToRot2, allShapes);
              for (const mu of miterUpdates) {
                const existing = updates.find(u => u.id === mu.id);
                if (existing) { existing.updates = { ...(existing.updates as any), ...(mu.updates as any) }; }
                else { updates.push(mu); }
              }
              updateShapes(updates);
            }
            // Rotate parametric shapes
            for (const ps of selectedParametric) {
              const cos = Math.cos(angle);
              const sin = Math.sin(angle);
              const dx = ps.position.x - center.x;
              const dy = ps.position.y - center.y;
              const newX = center.x + dx * cos - dy * sin;
              const newY = center.y + dx * sin + dy * cos;
              updateProfilePosition(ps.id, { x: newX, y: newY });
              updateProfileRotation(ps.id, ps.rotation + angle);
            }
          }
          triggerGridDimensionRegenIfNeeded(selected);
          clearDrawingPoints();
          return true;
        }

        // ==================================================================
        // SCALE
        // ==================================================================
        case 'scale': {
          if (selectedShapeIds.length === 0) {
            if (findShapeAtPoint) {
              const id = findShapeAtPoint(worldPos);
              if (id) selectShape(id, shiftKey);
            }
            return true;
          }
          if (numPts === 0) {
            // Click origin
            addDrawingPoint(worldPos);
            if (scaleMode === 'numerical') {
              // Execute immediately with scaleFactor
              const origin = worldPos;
              const transform = scaleTransform(origin, scaleFactor);
              const selected = getSelectedShapes();
              const selectedParametric = getSelectedParametricShapes();
              const childBeamsScale1 = getPlateSystemChildShapes(selected);
              const allToScale1 = [...selected, ...childBeamsScale1];

              if (modifyCopy) {
                if (allToScale1.length > 0) {
                  addShapes(allToScale1.map((s) => transformShape(s, transform)));
                }
                // Copy and scale parametric shapes
                if (selectedParametric.length > 0) {
                  const clones = cloneParametricShapes(selectedParametric.map(s => s.id), { x: 0, y: 0 });
                  for (const clone of clones) {
                    const dx = clone.position.x - origin.x;
                    const dy = clone.position.y - origin.y;
                    const newX = origin.x + dx * scaleFactor;
                    const newY = origin.y + dy * scaleFactor;
                    updateProfilePosition(clone.id, { x: newX, y: newY });
                    updateProfileScale(clone.id, clone.scale * scaleFactor);
                  }
                }
              } else {
                if (allToScale1.length > 0) {
                  const updates = allToScale1.map((s) => ({ id: s.id, updates: getShapeTransformUpdates(s, transform) }));
                  const allShapes = useAppStore.getState().shapes;
                  updates.push(...getLinkedLabelUpdates(allToScale1, allShapes, new Set(selectedShapeIds), transform));
                  // Recalculate miter joins for walls/beams with miter angles
                  const miterUpdates = getMiterRecalcUpdates(updates, allToScale1, allShapes);
                  for (const mu of miterUpdates) {
                    const existing = updates.find(u => u.id === mu.id);
                    if (existing) { existing.updates = { ...(existing.updates as any), ...(mu.updates as any) }; }
                    else { updates.push(mu); }
                  }
                  updateShapes(updates);
                }
                // Scale parametric shapes
                for (const ps of selectedParametric) {
                  const dx = ps.position.x - origin.x;
                  const dy = ps.position.y - origin.y;
                  const newX = origin.x + dx * scaleFactor;
                  const newY = origin.y + dy * scaleFactor;
                  updateProfilePosition(ps.id, { x: newX, y: newY });
                  updateProfileScale(ps.id, ps.scale * scaleFactor);
                }
              }
              triggerGridDimensionRegenIfNeeded(selected);
              clearDrawingPoints();
            }
            return true;
          }
          if (scaleMode === 'graphical') {
            if (numPts === 1) {
              // Click reference point
              addDrawingPoint(worldPos);
              return true;
            }
            // Click new scale point
            const origin = pts[0];
            const refDist = Math.hypot(pts[1].x - origin.x, pts[1].y - origin.y);
            const newDist = Math.hypot(worldPos.x - origin.x, worldPos.y - origin.y);
            const factor = refDist > 0.001 ? newDist / refDist : 1;
            const transform = scaleTransform(origin, factor);
            const selected = getSelectedShapes();
            const selectedParametric = getSelectedParametricShapes();
            const childBeamsScale2 = getPlateSystemChildShapes(selected);
            const allToScale2 = [...selected, ...childBeamsScale2];

            if (modifyCopy) {
              if (allToScale2.length > 0) {
                addShapes(allToScale2.map((s) => transformShape(s, transform)));
              }
              // Copy and scale parametric shapes
              if (selectedParametric.length > 0) {
                const clones = cloneParametricShapes(selectedParametric.map(s => s.id), { x: 0, y: 0 });
                for (const clone of clones) {
                  const dx = clone.position.x - origin.x;
                  const dy = clone.position.y - origin.y;
                  const newX = origin.x + dx * factor;
                  const newY = origin.y + dy * factor;
                  updateProfilePosition(clone.id, { x: newX, y: newY });
                  updateProfileScale(clone.id, clone.scale * factor);
                }
              }
            } else {
              if (allToScale2.length > 0) {
                const updates = allToScale2.map((s) => ({ id: s.id, updates: getShapeTransformUpdates(s, transform) }));
                const allShapes = useAppStore.getState().shapes;
                updates.push(...getLinkedLabelUpdates(allToScale2, allShapes, new Set(selectedShapeIds), transform));
                // Recalculate miter joins for walls/beams with miter angles
                const miterUpdates = getMiterRecalcUpdates(updates, allToScale2, allShapes);
                for (const mu of miterUpdates) {
                  const existing = updates.find(u => u.id === mu.id);
                  if (existing) { existing.updates = { ...(existing.updates as any), ...(mu.updates as any) }; }
                  else { updates.push(mu); }
                }
                updateShapes(updates);
              }
              // Scale parametric shapes
              for (const ps of selectedParametric) {
                const dx = ps.position.x - origin.x;
                const dy = ps.position.y - origin.y;
                const newX = origin.x + dx * factor;
                const newY = origin.y + dy * factor;
                updateProfilePosition(ps.id, { x: newX, y: newY });
                updateProfileScale(ps.id, ps.scale * factor);
              }
            }
            triggerGridDimensionRegenIfNeeded(selected);
            clearDrawingPoints();
          }
          return true;
        }

        // ==================================================================
        // MIRROR
        // ==================================================================
        case 'mirror': {
          if (selectedShapeIds.length === 0) {
            if (findShapeAtPoint) {
              const id = findShapeAtPoint(worldPos);
              if (id) selectShape(id, shiftKey);
            }
            return true;
          }
          if (numPts === 0) {
            addDrawingPoint(worldPos);
            return true;
          }
          // Click second axis point → execute
          const axisP1 = pts[0];
          const axisP2 = worldPos;
          const transform = mirrorTransform(axisP1, axisP2);
          const selected = getSelectedShapes();
          const selectedParametric = getSelectedParametricShapes();
          const childBeamsMirror = getPlateSystemChildShapes(selected);
          const allToMirror = [...selected, ...childBeamsMirror];

          // Calculate axis angle for mirroring parametric shapes
          const axisAngle = Math.atan2(axisP2.y - axisP1.y, axisP2.x - axisP1.x);

          if (modifyCopy) {
            if (allToMirror.length > 0) {
              addShapes(allToMirror.map((s) => transformShape(s, transform)));
            }
            // Copy and mirror parametric shapes
            if (selectedParametric.length > 0) {
              const clones = cloneParametricShapes(selectedParametric.map(s => s.id), { x: 0, y: 0 });
              for (const clone of clones) {
                // Mirror position across axis
                const dx = clone.position.x - axisP1.x;
                const dy = clone.position.y - axisP1.y;
                const cos2a = Math.cos(2 * axisAngle);
                const sin2a = Math.sin(2 * axisAngle);
                const newX = axisP1.x + dx * cos2a + dy * sin2a;
                const newY = axisP1.y + dx * sin2a - dy * cos2a;
                updateProfilePosition(clone.id, { x: newX, y: newY });
                // Mirror rotation: reflect around axis
                updateProfileRotation(clone.id, 2 * axisAngle - clone.rotation);
              }
            }
          } else {
            if (allToMirror.length > 0) {
              const updates = allToMirror.map((s) => ({ id: s.id, updates: getShapeTransformUpdates(s, transform) }));
              const allShapes = useAppStore.getState().shapes;
              updates.push(...getLinkedLabelUpdates(allToMirror, allShapes, new Set(selectedShapeIds), transform));
              // Recalculate miter joins for walls/beams with miter angles
              const miterUpdates = getMiterRecalcUpdates(updates, allToMirror, allShapes);
              for (const mu of miterUpdates) {
                const existing = updates.find(u => u.id === mu.id);
                if (existing) { existing.updates = { ...(existing.updates as any), ...(mu.updates as any) }; }
                else { updates.push(mu); }
              }
              updateShapes(updates);
            }
            // Mirror parametric shapes
            for (const ps of selectedParametric) {
              const dx = ps.position.x - axisP1.x;
              const dy = ps.position.y - axisP1.y;
              const cos2a = Math.cos(2 * axisAngle);
              const sin2a = Math.sin(2 * axisAngle);
              const newX = axisP1.x + dx * cos2a + dy * sin2a;
              const newY = axisP1.y + dx * sin2a - dy * cos2a;
              updateProfilePosition(ps.id, { x: newX, y: newY });
              updateProfileRotation(ps.id, 2 * axisAngle - ps.rotation);
            }
          }
          triggerGridDimensionRegenIfNeeded(selected);
          clearDrawingPoints();
          return true;
        }

        // ==================================================================
        // ARRAY (simplified 3-step: select → base point → end point)
        // ==================================================================
        case 'array': {
          if (selectedShapeIds.length === 0) {
            // Step 1: select element(s)
            if (findShapeAtPoint) {
              const id = findShapeAtPoint(worldPos);
              if (id) selectShape(id, shiftKey);
            }
            return true;
          }
          if (numPts === 0) {
            // Step 2: click base point
            addDrawingPoint(worldPos);
            return true;
          }
          // Step 3: click end point → create array
          const basePoint = pts[0];
          const { dx, dy } = constrainDelta(worldPos.x - basePoint.x, worldPos.y - basePoint.y);
          const dist = Math.hypot(dx, dy);
          if (dist < 0.001) { clearDrawingPoints(); return true; }

          const selected = getSelectedShapes();
          const selectedParametric = getSelectedParametricShapes();
          const childBeamsArray = getPlateSystemChildShapes(selected);
          const allToArray = [...selected, ...childBeamsArray];

          if (arrayMode === 'linear') {
            // Linear array: distribute arrayCount copies evenly from base to end
            const allCopies: Shape[] = [];
            for (let i = 1; i < arrayCount; i++) {
              const frac = i / (arrayCount - 1);
              const offsetX = dx * frac;
              const offsetY = dy * frac;
              const transform = translateTransform(offsetX, offsetY);
              for (const s of allToArray) {
                allCopies.push(transformShape(s, transform));
              }
            }
            if (allCopies.length > 0) addShapes(allCopies);

            // Array parametric shapes
            if (selectedParametric.length > 0) {
              for (let i = 1; i < arrayCount; i++) {
                const frac = i / (arrayCount - 1);
                cloneParametricShapes(
                  selectedParametric.map(s => s.id),
                  { x: dx * frac, y: dy * frac }
                );
              }
            }
          } else {
            // Radial array: base point = center, end point defines start direction
            // Distribute arrayCount copies around the center over arrayAngle degrees
            const center = basePoint;
            const totalAngleRad = (arrayAngle * Math.PI) / 180;
            const angleStep = totalAngleRad / arrayCount;

            const allCopies: Shape[] = [];
            for (let i = 1; i < arrayCount; i++) {
              const angle = angleStep * i;
              const transform = rotateTransform(center, angle);
              for (const s of allToArray) {
                allCopies.push(transformShape(s, transform));
              }
            }
            if (allCopies.length > 0) addShapes(allCopies);

            // Array parametric shapes (radial)
            if (selectedParametric.length > 0) {
              for (let i = 1; i < arrayCount; i++) {
                const angle = angleStep * i;
                const clones = cloneParametricShapes(selectedParametric.map(s => s.id), { x: 0, y: 0 });
                for (const clone of clones) {
                  const cos = Math.cos(angle);
                  const sin = Math.sin(angle);
                  const cdx = clone.position.x - center.x;
                  const cdy = clone.position.y - center.y;
                  const newX = center.x + cdx * cos - cdy * sin;
                  const newY = center.y + cdx * sin + cdy * cos;
                  updateProfilePosition(clone.id, { x: newX, y: newY });
                  updateProfileRotation(clone.id, clone.rotation + angle);
                }
              }
            }
          }

          triggerGridDimensionRegenIfNeeded(selected);
          clearDrawingPoints();
          setDrawingPreview(null);
          setActiveTool('select');
          return true;
        }

        // ==================================================================
        // TRIM
        // ==================================================================
        case 'trim': {
          if (numPts === 0) {
            // First click: select cutting edge
            if (findShapeAtPoint) {
              const id = findShapeAtPoint(worldPos);
              if (id) {
                setModifyRefShapeId(id);
                addDrawingPoint(worldPos);
              }
            }
            return true;
          }
          // Subsequent clicks: extend/trim BOTH lines to meet at intersection
          if (findShapeAtPoint && modifyRefShapeId) {
            const targetId = findShapeAtPoint(worldPos);
            if (targetId && targetId !== modifyRefShapeId) {
              const target = shapes.find((s) => s.id === targetId);
              const cutter = shapes.find((s) => s.id === modifyRefShapeId);
              const lineLikeTypes = ['line', 'gridline', 'beam', 'wall', 'level'];
              if (target && cutter && lineLikeTypes.includes(target.type) && lineLikeTypes.includes(cutter.type)) {
                // Extend/trim the target (line #2) to meet the cutter (line #1)
                const targetResult = trimLineAtIntersection(target as any, cutter, worldPos);
                // Extend/trim the cutter (line #1) to meet the target (line #2)
                // Use the first click point (pts[0]) as the clicked-side hint for the cutter
                const cutterResult = trimLineAtIntersection(cutter as any, target, pts[0]);
                const updates: { id: string; updates: Partial<Shape> }[] = [];
                if (targetResult) {
                  updates.push({ id: targetId, updates: targetResult as Partial<Shape> });
                }
                if (cutterResult) {
                  updates.push({ id: modifyRefShapeId, updates: cutterResult as Partial<Shape> });
                }
                // Fallback: if both trimLineAtIntersection calls returned null,
                // the intersection is outside both segments. Extend both to meet
                // at their mutual intersection point (infinite-line intersection).
                if (updates.length === 0) {
                  const mutualResult = extendBothToIntersection(target, cutter);
                  if (mutualResult) {
                    updates.push({ id: targetId, updates: mutualResult.shape1Update });
                    updates.push({ id: modifyRefShapeId, updates: mutualResult.shape2Update });
                  }
                }
                if (updates.length > 0) {
                  updateShapes(updates);
                }
              } else if (target && cutter && lineLikeTypes.includes(target.type)) {
                // Cutter is not line-like; only trim/extend the target
                const result = trimLineAtIntersection(target as any, cutter, worldPos);
                if (result) {
                  updateShapes([{ id: targetId, updates: result as Partial<Shape> }]);
                }
              }
            }
          }
          // When Multiple is off, reset to select after the trim operation
          if (!modifyMultiple) {
            clearDrawingPoints();
            setModifyRefShapeId(null);
            setActiveTool('select');
          }
          // When Multiple is on, keep cutting edge selected for multiple trims (don't clear ref)
          return true;
        }

        // ==================================================================
        // EXTEND
        // ==================================================================
        case 'extend': {
          if (numPts === 0) {
            // Click boundary edge
            if (findShapeAtPoint) {
              const id = findShapeAtPoint(worldPos);
              if (id) {
                setModifyRefShapeId(id);
                addDrawingPoint(worldPos);
              }
            }
            return true;
          }
          // Click element to extend (supports line, gridline, beam, wall)
          if (findShapeAtPoint && modifyRefShapeId) {
            const targetId = findShapeAtPoint(worldPos);
            if (targetId) {
              const target = shapes.find((s) => s.id === targetId);
              const boundary = shapes.find((s) => s.id === modifyRefShapeId);
              const lineLikeTypes = ['line', 'gridline', 'beam', 'wall'];
              if (target && boundary && lineLikeTypes.includes(target.type)) {
                const result = extendLineToBoundary(target as any, boundary);
                if (result) {
                  updateShapes([{ id: targetId, updates: result as Partial<Shape> }]);
                }
              }
            }
          }
          if (modifyMultiple) {
            // Keep boundary edge selected — user can click more elements to extend
          } else {
            // Reset to select after single extend operation
            clearDrawingPoints();
            setModifyRefShapeId(null);
            setActiveTool('select');
          }
          return true;
        }

        // ==================================================================
        // FILLET
        // ==================================================================
        case 'fillet': {
          if (numPts === 0) {
            // Click first element
            if (findShapeAtPoint) {
              const id = findShapeAtPoint(worldPos);
              if (id) {
                setModifyRefShapeId(id);
                addDrawingPoint(worldPos);
              }
            }
            return true;
          }
          // Click second element
          if (findShapeAtPoint && modifyRefShapeId) {
            const secondId = findShapeAtPoint(worldPos);
            if (secondId && secondId !== modifyRefShapeId) {
              const line1 = shapes.find((s) => s.id === modifyRefShapeId);
              const line2 = shapes.find((s) => s.id === secondId);
              if (line1 && line2 && line1.type === 'line' && line2.type === 'line') {
                const result = filletTwoLines(line1 as any, line2 as any, filletRadius);
                if (result) {
                  // Update both lines and add the fillet arc
                  updateShapes([
                    { id: modifyRefShapeId, updates: result.line1Update as Partial<Shape> },
                    { id: secondId, updates: result.line2Update as Partial<Shape> },
                  ]);
                  // Create arc shape
                  const arcShape: Shape = {
                    id: generateId(),
                    type: 'arc',
                    layerId: activeLayerId,
                    drawingId: activeDrawingId,
                    style: line1.style,
                    visible: true,
                    locked: false,
                    center: result.arc.center,
                    radius: result.arc.radius,
                    startAngle: result.arc.startAngle,
                    endAngle: result.arc.endAngle,
                  };
                  addShapes([arcShape]);
                }
              }
            }
          }
          clearDrawingPoints();
          setModifyRefShapeId(null);
          return true;
        }

        // ==================================================================
        // CHAMFER
        // ==================================================================
        case 'chamfer': {
          if (numPts === 0) {
            // Click first element
            if (findShapeAtPoint) {
              const id = findShapeAtPoint(worldPos);
              if (id) {
                setModifyRefShapeId(id);
                addDrawingPoint(worldPos);
              }
            }
            return true;
          }
          // Click second element
          if (findShapeAtPoint && modifyRefShapeId) {
            const secondId = findShapeAtPoint(worldPos);
            if (secondId && secondId !== modifyRefShapeId) {
              const line1 = shapes.find((s) => s.id === modifyRefShapeId);
              const line2 = shapes.find((s) => s.id === secondId);
              if (line1 && line2 && line1.type === 'line' && line2.type === 'line') {
                if (chamferDistance1 === 0 && chamferDistance2 === 0) {
                  // Zero distances: just trim to intersection
                  const intersection = (() => {
                    const l1 = line1 as any, l2 = line2 as any;
                    const d1x = l1.end.x - l1.start.x, d1y = l1.end.y - l1.start.y;
                    const d2x = l2.end.x - l2.start.x, d2y = l2.end.y - l2.start.y;
                    const denom = d1x * d2y - d1y * d2x;
                    if (Math.abs(denom) < 1e-10) return null;
                    const t = ((l2.start.x - l1.start.x) * d2y - (l2.start.y - l1.start.y) * d2x) / denom;
                    return { x: l1.start.x + t * d1x, y: l1.start.y + t * d1y };
                  })();
                  if (intersection) {
                    const l1 = line1 as any, l2 = line2 as any;
                    const l1Update: any = {};
                    const l2Update: any = {};
                    const d1s = Math.hypot(intersection.x - l1.start.x, intersection.y - l1.start.y);
                    const d1e = Math.hypot(intersection.x - l1.end.x, intersection.y - l1.end.y);
                    if (d1s < d1e) l1Update.end = intersection; else l1Update.start = intersection;
                    const d2s = Math.hypot(intersection.x - l2.start.x, intersection.y - l2.start.y);
                    const d2e = Math.hypot(intersection.x - l2.end.x, intersection.y - l2.end.y);
                    if (d2s < d2e) l2Update.end = intersection; else l2Update.start = intersection;
                    updateShapes([
                      { id: modifyRefShapeId, updates: l1Update },
                      { id: secondId, updates: l2Update },
                    ]);
                  }
                } else {
                  const result = chamferTwoLines(line1 as any, line2 as any, chamferDistance1, chamferDistance2);
                  if (result) {
                    updateShapes([
                      { id: modifyRefShapeId, updates: result.line1Update as Partial<Shape> },
                      { id: secondId, updates: result.line2Update as Partial<Shape> },
                    ]);
                    // Create chamfer line segment
                    const chamferLine: Shape = {
                      id: generateId(),
                      type: 'line',
                      layerId: activeLayerId,
                      drawingId: activeDrawingId,
                      style: line1.style,
                      visible: true,
                      locked: false,
                      start: result.lineSegment.start,
                      end: result.lineSegment.end,
                    };
                    addShapes([chamferLine]);
                  }
                }
              }
            }
          }
          clearDrawingPoints();
          setModifyRefShapeId(null);
          return true;
        }

        // ==================================================================
        // OFFSET
        // ==================================================================
        case 'offset': {
          // Single click: offset the hovered shape
          if (findShapeAtPoint) {
            const id = findShapeAtPoint(worldPos);
            if (id) {
              const shape = shapes.find((s) => s.id === id);
              if (shape) {
                const result = offsetShape(shape, offsetDistance, worldPos, offsetFlipped);
                if (result) {
                  addShapes([result]);
                  triggerGridDimensionRegenIfNeeded([result]);
                }
              }
            }
          }
          return true;
        }

        // ==================================================================
        // ELASTIC (STRETCH)
        // ==================================================================
        case 'elastic': {
          if (numPts === 0) {
            // Phase 1: First click = first corner of selection box
            addDrawingPoint(worldPos);
            return true;
          }
          if (numPts === 1) {
            // Phase 2: Second click = second corner of selection box
            // Store the box and move to base point selection
            addDrawingPoint(worldPos);
            return true;
          }
          if (numPts === 2) {
            // Phase 3: Third click = base point
            addDrawingPoint(worldPos);
            return true;
          }
          if (numPts === 3) {
            // Phase 4: Fourth click = destination point → execute stretch
            const boxP1 = pts[0];
            const boxP2 = pts[1];
            const basePoint = pts[2];
            const destPoint = worldPos;

            const boxMinX = Math.min(boxP1.x, boxP2.x);
            const boxMinY = Math.min(boxP1.y, boxP2.y);
            const boxMaxX = Math.max(boxP1.x, boxP2.x);
            const boxMaxY = Math.max(boxP1.y, boxP2.y);

            const dx = destPoint.x - basePoint.x;
            const dy = destPoint.y - basePoint.y;

            // Helper: check if a point is inside the selection box
            const isInsideBox = (p: Point) =>
              p.x >= boxMinX && p.x <= boxMaxX && p.y >= boxMinY && p.y <= boxMaxY;

            // Gather all visible shapes in the active drawing
            const drawingShapes = shapes.filter(s => s.drawingId === activeDrawingId && s.visible && !s.locked);

            const updates: { id: string; updates: Partial<Shape> }[] = [];

            // Line-like types that can be stretched by endpoint
            const lineLikeTypes = ['line', 'beam', 'gridline', 'wall', 'level'];

            for (const shape of drawingShapes) {
              const bounds = getShapeBounds(shape);
              if (!bounds) continue;

              // Check if shape is FULLY inside the box
              const fullyInside =
                bounds.minX >= boxMinX && bounds.maxX <= boxMaxX &&
                bounds.minY >= boxMinY && bounds.maxY <= boxMaxY;

              if (fullyInside) {
                // Fully inside: translate the entire shape
                const transform = translateTransform(dx, dy);
                updates.push({ id: shape.id, updates: getShapeTransformUpdates(shape, transform) });
                continue;
              }

              // Check if shape is PARTIALLY inside (endpoints inside box)
              if (lineLikeTypes.includes(shape.type)) {
                const s = shape as any;
                const startInside = isInsideBox(s.start);
                const endInside = isInsideBox(s.end);

                if (startInside && endInside) {
                  // Both endpoints inside: move entire shape
                  const transform = translateTransform(dx, dy);
                  updates.push({ id: shape.id, updates: getShapeTransformUpdates(shape, transform) });
                } else if (startInside) {
                  // Only start point inside: stretch start
                  updates.push({
                    id: shape.id,
                    updates: { start: { x: s.start.x + dx, y: s.start.y + dy } } as Partial<Shape>,
                  });
                } else if (endInside) {
                  // Only end point inside: stretch end
                  updates.push({
                    id: shape.id,
                    updates: { end: { x: s.end.x + dx, y: s.end.y + dy } } as Partial<Shape>,
                  });
                }
                continue;
              }

              // For polylines/splines: move individual points that are inside the box
              if (shape.type === 'polyline' || shape.type === 'spline') {
                const s = shape as any;
                const newPoints = s.points.map((p: Point) => {
                  if (isInsideBox(p)) {
                    return { x: p.x + dx, y: p.y + dy };
                  }
                  return p;
                });
                const anyMoved = s.points.some((p: Point) => isInsideBox(p));
                if (anyMoved) {
                  updates.push({ id: shape.id, updates: { points: newPoints } as Partial<Shape> });
                }
                continue;
              }

              // For circles: if center is inside the box, move
              if (shape.type === 'circle') {
                const s = shape as any;
                if (isInsideBox(s.center)) {
                  updates.push({
                    id: shape.id,
                    updates: { center: { x: s.center.x + dx, y: s.center.y + dy } } as Partial<Shape>,
                  });
                }
                continue;
              }

              // For arcs/ellipses: if center is inside the box, move
              if (shape.type === 'arc' || shape.type === 'ellipse') {
                const s = shape as any;
                if (isInsideBox(s.center)) {
                  updates.push({
                    id: shape.id,
                    updates: { center: { x: s.center.x + dx, y: s.center.y + dy } } as Partial<Shape>,
                  });
                }
                continue;
              }

              // For rectangles: if any corner overlaps, move the whole shape
              if (shape.type === 'rectangle') {
                const s = shape as any;
                const corners = [
                  { x: s.topLeft.x, y: s.topLeft.y },
                  { x: s.topLeft.x + s.width, y: s.topLeft.y },
                  { x: s.topLeft.x, y: s.topLeft.y + s.height },
                  { x: s.topLeft.x + s.width, y: s.topLeft.y + s.height },
                ];
                if (corners.some(c => isInsideBox(c))) {
                  const transform = translateTransform(dx, dy);
                  updates.push({ id: shape.id, updates: getShapeTransformUpdates(shape, transform) });
                }
                continue;
              }

              // For text/point/pile shapes: if position is inside the box, move
              if (shape.type === 'text' || shape.type === 'point') {
                const s = shape as any;
                if (isInsideBox(s.position)) {
                  updates.push({
                    id: shape.id,
                    updates: { position: { x: s.position.x + dx, y: s.position.y + dy } } as Partial<Shape>,
                  });
                }
                continue;
              }

              if (shape.type === 'pile') {
                const s = shape as any;
                if (isInsideBox(s.position)) {
                  updates.push({
                    id: shape.id,
                    updates: { position: { x: s.position.x + dx, y: s.position.y + dy } } as Partial<Shape>,
                  });
                }
                continue;
              }

              // For images: if position is inside the box, move
              if (shape.type === 'image') {
                const s = shape as any;
                if (isInsideBox(s.position)) {
                  updates.push({
                    id: shape.id,
                    updates: { position: { x: s.position.x + dx, y: s.position.y + dy } } as Partial<Shape>,
                  });
                }
                continue;
              }

              // For hatch shapes: move boundary points that are inside
              if (shape.type === 'hatch') {
                const s = shape as any;
                const newPoints = s.points.map((p: Point) => {
                  if (isInsideBox(p)) {
                    return { x: p.x + dx, y: p.y + dy };
                  }
                  return p;
                });
                const anyMoved = s.points.some((p: Point) => isInsideBox(p));
                if (anyMoved) {
                  updates.push({ id: shape.id, updates: { points: newPoints } as Partial<Shape> });
                }
                continue;
              }

              // For slab shapes: move individual points that are inside the box
              if (shape.type === 'slab') {
                const s = shape as any;
                const newPoints = s.points.map((p: Point) => {
                  if (isInsideBox(p)) {
                    return { x: p.x + dx, y: p.y + dy };
                  }
                  return p;
                });
                const anyMoved = s.points.some((p: Point) => isInsideBox(p));
                if (anyMoved) {
                  updates.push({ id: shape.id, updates: { points: newPoints } as Partial<Shape> });
                }
                continue;
              }

              // For plate-system shapes: move individual contour points that are inside the box
              if (shape.type === 'plate-system') {
                const s = shape as any;
                const newPoints = s.contourPoints.map((p: Point) => {
                  if (isInsideBox(p)) {
                    return { x: p.x + dx, y: p.y + dy };
                  }
                  return p;
                });
                const anyMoved = s.contourPoints.some((p: Point) => isInsideBox(p));
                if (anyMoved) {
                  updates.push({ id: shape.id, updates: { contourPoints: newPoints } as Partial<Shape> });
                }
                continue;
              }

              // For section-callout shapes: stretch start/end like line-like types
              if (shape.type === 'section-callout') {
                const s = shape as any;
                const startInside = isInsideBox(s.start);
                const endInside = isInsideBox(s.end);

                if (startInside && endInside) {
                  const transform = translateTransform(dx, dy);
                  updates.push({ id: shape.id, updates: getShapeTransformUpdates(shape, transform) });
                } else if (startInside) {
                  updates.push({
                    id: shape.id,
                    updates: { start: { x: s.start.x + dx, y: s.start.y + dy } } as Partial<Shape>,
                  });
                } else if (endInside) {
                  updates.push({
                    id: shape.id,
                    updates: { end: { x: s.end.x + dx, y: s.end.y + dy } } as Partial<Shape>,
                  });
                }
                continue;
              }

              // For dimension shapes: move individual points that are inside the box
              if (shape.type === 'dimension') {
                const s = shape as any;
                if (s.points && s.points.length > 0) {
                  const newPoints = s.points.map((p: Point) => {
                    if (isInsideBox(p)) {
                      return { x: p.x + dx, y: p.y + dy };
                    }
                    return p;
                  });
                  const anyMoved = s.points.some((p: Point) => isInsideBox(p));
                  if (anyMoved) {
                    updates.push({ id: shape.id, updates: { points: newPoints } as Partial<Shape> });
                  }
                }
                continue;
              }

              // For spot-elevation shapes: if position is inside the box, move
              if (shape.type === 'spot-elevation') {
                const s = shape as any;
                const posInside = isInsideBox(s.position);
                const labelInside = isInsideBox(s.labelPosition);
                if (posInside && labelInside) {
                  updates.push({
                    id: shape.id,
                    updates: {
                      position: { x: s.position.x + dx, y: s.position.y + dy },
                      labelPosition: { x: s.labelPosition.x + dx, y: s.labelPosition.y + dy },
                    } as Partial<Shape>,
                  });
                } else if (posInside) {
                  updates.push({
                    id: shape.id,
                    updates: { position: { x: s.position.x + dx, y: s.position.y + dy } } as Partial<Shape>,
                  });
                } else if (labelInside) {
                  updates.push({
                    id: shape.id,
                    updates: { labelPosition: { x: s.labelPosition.x + dx, y: s.labelPosition.y + dy } } as Partial<Shape>,
                  });
                }
                continue;
              }

              // For CPT shapes: if position is inside the box, move
              if (shape.type === 'cpt') {
                const s = shape as any;
                if (isInsideBox(s.position)) {
                  updates.push({
                    id: shape.id,
                    updates: { position: { x: s.position.x + dx, y: s.position.y + dy } } as Partial<Shape>,
                  });
                }
                continue;
              }

              // For space shapes: move individual contour points that are inside the box
              if (shape.type === 'space') {
                const s = shape as any;
                const newPoints = s.contourPoints.map((p: Point) => {
                  if (isInsideBox(p)) {
                    return { x: p.x + dx, y: p.y + dy };
                  }
                  return p;
                });
                const anyMoved = s.contourPoints.some((p: Point) => isInsideBox(p));
                if (anyMoved) {
                  const upd: any = { contourPoints: newPoints };
                  // Also move label position if inside box
                  if (s.labelPosition && isInsideBox(s.labelPosition)) {
                    upd.labelPosition = { x: s.labelPosition.x + dx, y: s.labelPosition.y + dy };
                  }
                  updates.push({ id: shape.id, updates: upd as Partial<Shape> });
                }
                continue;
              }

              // For foundation-zone shapes: move individual contour points that are inside the box
              if (shape.type === 'foundation-zone') {
                const s = shape as any;
                const newPoints = s.contourPoints.map((p: Point) => {
                  if (isInsideBox(p)) {
                    return { x: p.x + dx, y: p.y + dy };
                  }
                  return p;
                });
                const anyMoved = s.contourPoints.some((p: Point) => isInsideBox(p));
                if (anyMoved) {
                  updates.push({ id: shape.id, updates: { contourPoints: newPoints } as Partial<Shape> });
                }
                continue;
              }
            }

            // Also move linked labels for any shapes that were moved
            if (updates.length > 0) {
              const movedIds = new Set(updates.map(u => u.id));
              // Build a map of pending updates so we can compute post-update geometry
              const pendingMap = new Map<string, Partial<Shape>>();
              for (const u of updates) {
                pendingMap.set(u.id, u.updates);
              }
              for (const u of [...updates]) {
                const parentShape = drawingShapes.find(s => s.id === u.id);
                if (!parentShape) continue;
                const linkedLabels = findLinkedLabels(drawingShapes, u.id);
                for (const label of linkedLabels) {
                  if (!movedIds.has(label.id)) {
                    movedIds.add(label.id);
                    // Compute post-update parent geometry for accurate label placement
                    const postParent = { ...parentShape, ...u.updates } as Shape;
                    const alignBeamLabelDist = useAppStore.getState().planSubtypeSettings?.structuralPlan?.beamLabelStartDistance ?? 1000;
                    const labelPos = computeLinkedLabelPosition(postParent, alignBeamLabelDist);
                    if (labelPos) {
                      updates.push({
                        id: label.id,
                        updates: {
                          position: labelPos.position,
                          rotation: labelPos.rotation,
                        } as Partial<Shape>,
                      });
                    } else {
                      const transform = translateTransform(dx, dy);
                      updates.push({
                        id: label.id,
                        updates: getShapeTransformUpdates(label, transform),
                      });
                    }
                  }
                }
              }

              // Recalculate miter joins for walls/beams with miter angles
              const movedWalls = updates
                .map(u => drawingShapes.find(s => s.id === u.id))
                .filter(Boolean) as Shape[];
              const miterUpdates = getMiterRecalcUpdates(updates, movedWalls, drawingShapes);
              for (const mu of miterUpdates) {
                const existing = updates.find(u => u.id === mu.id);
                if (existing) { existing.updates = { ...(existing.updates as any), ...(mu.updates as any) }; }
                else { updates.push(mu); }
              }

              updateShapes(updates);

              // Check if any affected shapes are gridlines
              const affectedShapes = updates.map(u => drawingShapes.find(s => s.id === u.id)).filter(Boolean) as Shape[];
              triggerGridDimensionRegenIfNeeded(affectedShapes);
            }

            clearDrawingPoints();
            setDrawingPreview(null);
            setActiveTool('select');
            return true;
          }
          return true;
        }

        // ==================================================================
        // ALIGN — pick source point, then destination point; translate
        // selected shapes so the source point lands on the destination.
        // ==================================================================
        case 'align': {
          if (selectedShapeIds.length === 0) {
            // No selection yet: click to select a shape
            if (findShapeAtPoint) {
              const id = findShapeAtPoint(worldPos);
              if (id) {
                selectShape(id, shiftKey);
              }
            }
            return true;
          }
          if (numPts === 0) {
            // First click: source (base) point
            addDrawingPoint(worldPos);
            return true;
          }
          // Second click: destination point — execute alignment
          const sourcePoint = pts[0];
          const destPoint = worldPos;
          const adx = destPoint.x - sourcePoint.x;
          const ady = destPoint.y - sourcePoint.y;
          const alignTransform = translateTransform(adx, ady);

          const alignSelected = getSelectedShapes();
          const alignSelectedParametric = getSelectedParametricShapes();

          if (alignSelected.length > 0) {
            const alignUpdates = alignSelected.map((s) => ({
              id: s.id,
              updates: getShapeTransformUpdates(s, alignTransform),
            }));

            // Also move linked labels that are NOT already in the selection
            const allShapesNow = useAppStore.getState().shapes;
            const labelUpdates = getLinkedLabelUpdates(alignSelected, allShapesNow, new Set(selectedShapeIds), alignTransform);
            alignUpdates.push(...labelUpdates);

            // Recalculate miter joins for walls/beams with miter angles
            const miterUpdates = getMiterRecalcUpdates(alignUpdates, alignSelected, allShapesNow);
            for (const mu of miterUpdates) {
              const existing = alignUpdates.find(u => u.id === mu.id);
              if (existing) {
                existing.updates = { ...(existing.updates as any), ...(mu.updates as any) };
              } else {
                alignUpdates.push(mu);
              }
            }

            updateShapes(alignUpdates);
          }
          // Align parametric shapes
          for (const ps of alignSelectedParametric) {
            updateProfilePosition(ps.id, {
              x: ps.position.x + adx,
              y: ps.position.y + ady,
            });
          }

          triggerGridDimensionRegenIfNeeded(alignSelected);
          clearDrawingPoints();
          setActiveTool('select');
          return true;
        }

        // ==================================================================
        // TRIM WALLS (Miter Join / Verstek)
        // ==================================================================
        case 'trim-walls': {
          if (numPts === 0) {
            // First click: select first wall/beam
            if (findShapeAtPoint) {
              const id = findShapeAtPoint(worldPos);
              if (id) {
                const shape = shapes.find((s) => s.id === id);
                if (shape && (shape.type === 'wall' || shape.type === 'beam')) {
                  setModifyRefShapeId(id);
                  addDrawingPoint(worldPos);
                }
              }
            }
            return true;
          }
          // Second click: select second wall/beam and execute miter join
          if (findShapeAtPoint && modifyRefShapeId) {
            const secondId = findShapeAtPoint(worldPos);
            if (secondId && secondId !== modifyRefShapeId) {
              const shape1 = shapes.find((s) => s.id === modifyRefShapeId);
              const shape2 = shapes.find((s) => s.id === secondId);
              if (shape1 && shape2 &&
                  (shape1.type === 'wall' || shape1.type === 'beam') &&
                  (shape2.type === 'wall' || shape2.type === 'beam')) {
                const result = miterJoinWalls(shape1, shape2);
                if (result) {
                  updateShapes([
                    { id: modifyRefShapeId, updates: result.shape1Update },
                    { id: secondId, updates: result.shape2Update },
                  ]);
                }
              }
            }
          }
          // Reset state for next pair but keep tool active (don't switch to 'select')
          clearDrawingPoints();
          setModifyRefShapeId(null);
          return true;
        }

        default:
          return false;
      }
    },
    [activeTool, drawingPoints, selectedShapeIds, shapes, parametricShapes, addDrawingPoint, clearDrawingPoints,
     addShapes, updateShapes, selectShape, selectShapes, modifyCopy, modifyMultiple, scaleMode, scaleFactor,
     filletRadius, chamferDistance1, chamferDistance2, offsetDistance, offsetFlipped, rotateAngle, modifyRefShapeId, setModifyRefShapeId,
     getSelectedShapes, getSelectedParametricShapes, getPlateSystemChildShapes, activeDrawingId, activeLayerId,
     arrayMode, arrayCount, arraySpacing, arrayAngle,
     cloneParametricShapes, updateProfilePosition, updateProfileRotation, updateProfileScale,
     constrainDelta, setActiveTool, setDrawingPreview, selectedGrip, setSelectedGrip, triggerGridDimensionRegenIfNeeded]
  );

  /**
   * Update preview ghost shapes as cursor moves.
   * Delegates to the extracted updateModifyPreview implementation.
   */
  const updateModifyPreview = useCallback(
    (worldPos: Point): void => {
      const ctx: ModifyPreviewContext = {
        activeTool,
        shapes,
        selectedShapeIds,
        drawingPoints,
        parametricShapes,
        setDrawingPreview,
        modifyConstrainAxis,
        scaleMode,
        arrayMode,
        arrayCount,
        arraySpacing,
        arrayAngle,
        lockedDistance,
        offsetDistance,
        offsetFlipped,
        selectedGrip,
        hoveredShapeId,
        activeDrawingId,
      };
      updateModifyPreviewImpl(ctx, worldPos);
    },
    [activeTool, shapes, selectedShapeIds, drawingPoints, parametricShapes,
     setDrawingPreview, modifyConstrainAxis, scaleMode, arrayMode, arrayCount, arraySpacing, arrayAngle,
     lockedDistance, offsetDistance, offsetFlipped, selectedGrip, hoveredShapeId, activeDrawingId]
  );

  /**
   * Finish / cancel the modify operation (right-click or Escape).
   */
  const finishModify = useCallback(() => {
    if (!MODIFY_TOOLS.includes(activeTool)) return;
    clearDrawingPoints();
    setDrawingPreview(null);
    setModifyRefShapeId(null);
  }, [activeTool, clearDrawingPoints, setDrawingPreview, setModifyRefShapeId]);

  return {
    handleModifyClick,
    updateModifyPreview,
    finishModify,
    isModifyTool,
  };
}
