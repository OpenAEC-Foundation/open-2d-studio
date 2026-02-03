/**
 * useModifyTools - Core hook for all 9 modify/edit tools
 *
 * Handles: Move, Copy, Rotate, Scale, Mirror, Trim, Extend, Fillet, Offset
 */

import { useCallback } from 'react';
import { useAppStore } from '../../state/appStore';
import type { Point, Shape, ToolType } from '../../types/geometry';
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
  filletTwoLines,
  chamferTwoLines,
  offsetShape,
} from '../../engine/geometry/Modify';
import { generateId } from '../../state/slices/types';

const MODIFY_TOOLS: ToolType[] = ['move', 'copy', 'rotate', 'scale', 'mirror', 'array', 'trim', 'extend', 'fillet', 'chamfer', 'offset'];

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
  const cloneParametricShapes = useAppStore((s) => s.cloneParametricShapes);
  const updateProfilePosition = useAppStore((s) => s.updateProfilePosition);
  const updateProfileRotation = useAppStore((s) => s.updateProfileRotation);
  const updateProfileScale = useAppStore((s) => s.updateProfileScale);

  // Modify options
  const modifyCopy = useAppStore((s) => s.modifyCopy);
  const modifyMultiple = useAppStore((s) => s.modifyMultiple);
  const scaleMode = useAppStore((s) => s.scaleMode);
  const scaleFactor = useAppStore((s) => s.scaleFactor);
  const filletRadius = useAppStore((s) => s.filletRadius);
  const chamferDistance1 = useAppStore((s) => s.chamferDistance1);
  const chamferDistance2 = useAppStore((s) => s.chamferDistance2);
  const offsetDistance = useAppStore((s) => s.offsetDistance);
  const rotateAngle = useAppStore((s) => s.rotateAngle);
  const modifyRefShapeId = useAppStore((s) => s.modifyRefShapeId);
  const setModifyRefShapeId = useAppStore((s) => s.setModifyRefShapeId);
  const activeDrawingId = useAppStore((s) => s.activeDrawingId);
  const activeLayerId = useAppStore((s) => s.activeLayerId);
  const arrayMode = useAppStore((s) => s.arrayMode);
  const arrayCount = useAppStore((s) => s.arrayCount);
  const arraySpacing = useAppStore((s) => s.arraySpacing);
  const arrayAngle = useAppStore((s) => s.arrayAngle);

  const isModifyTool = useCallback((tool: ToolType) => MODIFY_TOOLS.includes(tool), []);

  const getSelectedShapes = useCallback((): Shape[] => {
    return shapes.filter((s) => selectedShapeIds.includes(s.id));
  }, [shapes, selectedShapeIds]);

  const getSelectedParametricShapes = useCallback((): ParametricShape[] => {
    return parametricShapes.filter((s) => selectedShapeIds.includes(s.id));
  }, [parametricShapes, selectedShapeIds]);

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
            // Select mode: click to select
            if (findShapeAtPoint) {
              const id = findShapeAtPoint(worldPos);
              if (id) selectShape(id, shiftKey);
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
          const dx = worldPos.x - basePoint.x;
          const dy = worldPos.y - basePoint.y;
          const transform = translateTransform(dx, dy);
          const selected = getSelectedShapes();
          const selectedParametric = getSelectedParametricShapes();

          if (modifyCopy) {
            // Copy regular shapes
            if (selected.length > 0) {
              const copies = selected.map((s) => transformShape(s, transform));
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
            // Move regular shapes
            if (selected.length > 0) {
              const updates = selected.map((s) => ({
                id: s.id,
                updates: getShapeTransformUpdates(s, transform),
              }));
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
          clearDrawingPoints();
          return true;
        }

        // ==================================================================
        // COPY
        // ==================================================================
        case 'copy': {
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
          // Place copy
          const basePoint = pts[0];
          const dx = worldPos.x - basePoint.x;
          const dy = worldPos.y - basePoint.y;
          const transform = translateTransform(dx, dy);

          // Copy regular shapes
          const regularCopies = getSelectedShapes().map((s) => transformShape(s, transform));
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

          if (!modifyMultiple) {
            clearDrawingPoints();
          }
          // Stay at pts=1 for multiple copies
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

              if (modifyCopy) {
                if (selected.length > 0) {
                  addShapes(selected.map((s) => transformShape(s, transform)));
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
                if (selected.length > 0) {
                  updateShapes(selected.map((s) => ({ id: s.id, updates: getShapeTransformUpdates(s, transform) })));
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
              clearDrawingPoints();
            }
            return true;
          }
          if (numPts === 1) {
            // Click start ray
            addDrawingPoint(worldPos);
            return true;
          }
          // Click end ray → execute rotation
          const center = pts[0];
          const startAngle = Math.atan2(pts[1].y - center.y, pts[1].x - center.x);
          const endAngle = Math.atan2(worldPos.y - center.y, worldPos.x - center.x);
          const angle = endAngle - startAngle;
          const transform = rotateTransform(center, angle);
          const selected = getSelectedShapes();
          const selectedParametric = getSelectedParametricShapes();

          if (modifyCopy) {
            if (selected.length > 0) {
              addShapes(selected.map((s) => transformShape(s, transform)));
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
            if (selected.length > 0) {
              updateShapes(selected.map((s) => ({ id: s.id, updates: getShapeTransformUpdates(s, transform) })));
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

              if (modifyCopy) {
                if (selected.length > 0) {
                  addShapes(selected.map((s) => transformShape(s, transform)));
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
                if (selected.length > 0) {
                  updateShapes(selected.map((s) => ({ id: s.id, updates: getShapeTransformUpdates(s, transform) })));
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

            if (modifyCopy) {
              if (selected.length > 0) {
                addShapes(selected.map((s) => transformShape(s, transform)));
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
              if (selected.length > 0) {
                updateShapes(selected.map((s) => ({ id: s.id, updates: getShapeTransformUpdates(s, transform) })));
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

          // Calculate axis angle for mirroring parametric shapes
          const axisAngle = Math.atan2(axisP2.y - axisP1.y, axisP2.x - axisP1.x);

          if (modifyCopy) {
            if (selected.length > 0) {
              addShapes(selected.map((s) => transformShape(s, transform)));
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
            if (selected.length > 0) {
              updateShapes(selected.map((s) => ({ id: s.id, updates: getShapeTransformUpdates(s, transform) })));
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
          clearDrawingPoints();
          return true;
        }

        // ==================================================================
        // ARRAY
        // ==================================================================
        case 'array': {
          if (selectedShapeIds.length === 0) {
            if (findShapeAtPoint) {
              const id = findShapeAtPoint(worldPos);
              if (id) selectShape(id, shiftKey);
            }
            return true;
          }
          if (arrayMode === 'linear') {
            // Linear array: pts=0 click start → pts=1 click direction/end → create array along that vector
            if (numPts === 0) {
              addDrawingPoint(worldPos);
              return true;
            }
            // Second click defines direction and spacing reference
            const basePoint = pts[0];
            const dx = worldPos.x - basePoint.x;
            const dy = worldPos.y - basePoint.y;
            const dist = Math.hypot(dx, dy);
            if (dist < 0.001) { clearDrawingPoints(); return true; }
            const ux = dx / dist;
            const uy = dy / dist;
            const selected = getSelectedShapes();
            const selectedParametric = getSelectedParametricShapes();

            // Array regular shapes
            const allCopies: Shape[] = [];
            for (let i = 1; i < arrayCount; i++) {
              const offset = arraySpacing * i;
              const transform = translateTransform(ux * offset, uy * offset);
              for (const s of selected) {
                allCopies.push(transformShape(s, transform));
              }
            }
            if (allCopies.length > 0) addShapes(allCopies);

            // Array parametric shapes
            if (selectedParametric.length > 0) {
              for (let i = 1; i < arrayCount; i++) {
                const offset = arraySpacing * i;
                cloneParametricShapes(
                  selectedParametric.map(s => s.id),
                  { x: ux * offset, y: uy * offset }
                );
              }
            }

            clearDrawingPoints();
            return true;
          } else {
            // Radial array: pts=0 click center → execute immediately
            if (numPts === 0) {
              const center = worldPos;
              const selected = getSelectedShapes();
              const selectedParametric = getSelectedParametricShapes();
              const totalAngleRad = (arrayAngle * Math.PI) / 180;
              const angleStep = totalAngleRad / arrayCount;

              // Array regular shapes
              const allCopies: Shape[] = [];
              for (let i = 1; i < arrayCount; i++) {
                const angle = angleStep * i;
                const transform = rotateTransform(center, angle);
                for (const s of selected) {
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
                    const dx = clone.position.x - center.x;
                    const dy = clone.position.y - center.y;
                    const newX = center.x + dx * cos - dy * sin;
                    const newY = center.y + dx * sin + dy * cos;
                    updateProfilePosition(clone.id, { x: newX, y: newY });
                    updateProfileRotation(clone.id, clone.rotation + angle);
                  }
                }
              }

              clearDrawingPoints();
              return true;
            }
          }
          return true;
        }

        // ==================================================================
        // TRIM
        // ==================================================================
        case 'trim': {
          if (numPts === 0) {
            // Click cutting edge
            if (findShapeAtPoint) {
              const id = findShapeAtPoint(worldPos);
              if (id) {
                setModifyRefShapeId(id);
                addDrawingPoint(worldPos);
              }
            }
            return true;
          }
          // Click element to trim
          if (findShapeAtPoint && modifyRefShapeId) {
            const targetId = findShapeAtPoint(worldPos);
            if (targetId) {
              const target = shapes.find((s) => s.id === targetId);
              const cutter = shapes.find((s) => s.id === modifyRefShapeId);
              if (target && cutter && target.type === 'line') {
                const result = trimLineAtIntersection(target as any, cutter, worldPos);
                if (result) {
                  updateShapes([{ id: targetId, updates: result as Partial<Shape> }]);
                }
              }
            }
          }
          clearDrawingPoints();
          setModifyRefShapeId(null);
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
          // Click element to extend
          if (findShapeAtPoint && modifyRefShapeId) {
            const targetId = findShapeAtPoint(worldPos);
            if (targetId) {
              const target = shapes.find((s) => s.id === targetId);
              const boundary = shapes.find((s) => s.id === modifyRefShapeId);
              if (target && boundary && target.type === 'line') {
                const result = extendLineToBoundary(target as any, boundary);
                if (result) {
                  updateShapes([{ id: targetId, updates: result as Partial<Shape> }]);
                }
              }
            }
          }
          clearDrawingPoints();
          setModifyRefShapeId(null);
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
                const result = offsetShape(shape, offsetDistance, worldPos);
                if (result) {
                  addShapes([result]);
                }
              }
            }
          }
          return true;
        }

        default:
          return false;
      }
    },
    [activeTool, drawingPoints, selectedShapeIds, shapes, parametricShapes, addDrawingPoint, clearDrawingPoints,
     addShapes, updateShapes, selectShape, modifyCopy, modifyMultiple, scaleMode, scaleFactor,
     filletRadius, chamferDistance1, chamferDistance2, offsetDistance, rotateAngle, modifyRefShapeId, setModifyRefShapeId,
     getSelectedShapes, getSelectedParametricShapes, activeDrawingId, activeLayerId,
     arrayMode, arrayCount, arraySpacing, arrayAngle,
     cloneParametricShapes, updateProfilePosition, updateProfileRotation, updateProfileScale]
  );

  /**
   * Convert parametric shapes to temporary polyline shapes for preview
   */
  const parametricShapesToGhosts = useCallback((parametrics: ParametricShape[]): Shape[] => {
    const ghosts: Shape[] = [];
    for (const ps of parametrics) {
      if (!ps.generatedGeometry?.outlines || ps.generatedGeometry.outlines.length === 0) continue;
      // Create a closed polyline for each outline
      for (let i = 0; i < ps.generatedGeometry.outlines.length; i++) {
        const outline = ps.generatedGeometry.outlines[i];
        if (outline.length < 2) continue;
        const isClosed = ps.generatedGeometry.closed[i] ?? true;
        ghosts.push({
          id: `preview-${ps.id}-${i}`,
          type: 'polyline',
          layerId: ps.layerId,
          drawingId: ps.drawingId,
          style: ps.style,
          visible: true,
          locked: false,
          points: outline,
          closed: isClosed,
        } as Shape);
      }
    }
    return ghosts;
  }, []);

  /**
   * Update preview ghost shapes as cursor moves.
   */
  const updateModifyPreview = useCallback(
    (worldPos: Point): void => {
      if (!MODIFY_TOOLS.includes(activeTool)) return;
      const pts = drawingPoints;

      // For tools that need selection but have none, no preview
      const needsSelection = ['move', 'copy', 'rotate', 'scale', 'mirror'].includes(activeTool);
      if (needsSelection && selectedShapeIds.length === 0) {
        setDrawingPreview(null);
        return;
      }

      const selected = getSelectedShapes();
      const selectedParametric = getSelectedParametricShapes();
      // Convert parametric shapes to ghost polylines for preview
      const parametricGhosts = parametricShapesToGhosts(selectedParametric);

      switch (activeTool) {
        case 'move':
        case 'copy': {
          if (pts.length === 1) {
            const dx = worldPos.x - pts[0].x;
            const dy = worldPos.y - pts[0].y;
            const transform = translateTransform(dx, dy);
            const regularGhosts = selected.map((s) => transformShape(s, transform));
            const paramGhosts = parametricGhosts.map((s) => transformShape(s, transform));
            setDrawingPreview({ type: 'modifyPreview', shapes: [...regularGhosts, ...paramGhosts] });
          }
          break;
        }
        case 'rotate': {
          if (pts.length === 1) {
            // After center is set: show ray from center to cursor (start angle reference)
            setDrawingPreview({
              type: 'rotateGuide',
              center: pts[0],
              endRay: worldPos,
              shapes: [],
            });
          } else if (pts.length === 2) {
            const center = pts[0];
            const startAngle = Math.atan2(pts[1].y - center.y, pts[1].x - center.x);
            const endAngle = Math.atan2(worldPos.y - center.y, worldPos.x - center.x);
            const angle = endAngle - startAngle;
            const transform = rotateTransform(center, angle);
            const regularGhosts = selected.map((s) => transformShape(s, transform));
            const paramGhosts = parametricGhosts.map((s) => transformShape(s, transform));
            setDrawingPreview({
              type: 'rotateGuide',
              center: pts[0],
              startRay: pts[1],
              endRay: worldPos,
              angle: angle * (180 / Math.PI),
              shapes: [...regularGhosts, ...paramGhosts],
            });
          }
          break;
        }
        case 'scale': {
          if (scaleMode === 'graphical') {
            if (pts.length === 1) {
              // After origin set: show line from origin to cursor (reference distance)
              setDrawingPreview({
                type: 'scaleGuide',
                origin: pts[0],
                currentPoint: worldPos,
                shapes: [],
              });
            } else if (pts.length === 2) {
              const origin = pts[0];
              const refDist = Math.hypot(pts[1].x - origin.x, pts[1].y - origin.y);
              const newDist = Math.hypot(worldPos.x - origin.x, worldPos.y - origin.y);
              const factor = refDist > 0.001 ? newDist / refDist : 1;
              const transform = scaleTransform(origin, factor);
              const regularGhosts = selected.map((s) => transformShape(s, transform));
              const paramGhosts = parametricGhosts.map((s) => transformShape(s, transform));
              setDrawingPreview({
                type: 'scaleGuide',
                origin: pts[0],
                refPoint: pts[1],
                currentPoint: worldPos,
                factor,
                shapes: [...regularGhosts, ...paramGhosts],
              });
            }
          }
          break;
        }
        case 'mirror': {
          if (pts.length === 1) {
            const transform = mirrorTransform(pts[0], worldPos);
            const regularGhosts = selected.map((s) => transformShape(s, transform));
            const paramGhosts = parametricGhosts.map((s) => transformShape(s, transform));
            setDrawingPreview({ type: 'mirrorAxis', start: pts[0], end: worldPos, shapes: [...regularGhosts, ...paramGhosts] });
          }
          break;
        }
        case 'array': {
          if (arrayMode === 'linear' && pts.length === 1) {
            const basePoint = pts[0];
            const dx = worldPos.x - basePoint.x;
            const dy = worldPos.y - basePoint.y;
            const dist = Math.hypot(dx, dy);
            if (dist > 0.001) {
              const ux = dx / dist;
              const uy = dy / dist;
              const ghosts: Shape[] = [];
              for (let i = 1; i < arrayCount; i++) {
                const offset = arraySpacing * i;
                const transform = translateTransform(ux * offset, uy * offset);
                for (const s of selected) {
                  ghosts.push(transformShape(s, transform));
                }
                for (const s of parametricGhosts) {
                  ghosts.push(transformShape(s, transform));
                }
              }
              setDrawingPreview({ type: 'modifyPreview', shapes: ghosts });
            }
          } else if (arrayMode === 'radial' && pts.length === 0 && (selected.length > 0 || parametricGhosts.length > 0)) {
            // Preview radial array around cursor as center
            const center = worldPos;
            const totalAngleRad = (arrayAngle * Math.PI) / 180;
            const angleStep = totalAngleRad / arrayCount;
            const ghosts: Shape[] = [];
            for (let i = 1; i < arrayCount; i++) {
              const angle = angleStep * i;
              const transform = rotateTransform(center, angle);
              for (const s of selected) {
                ghosts.push(transformShape(s, transform));
              }
              for (const s of parametricGhosts) {
                ghosts.push(transformShape(s, transform));
              }
            }
            setDrawingPreview({ type: 'modifyPreview', shapes: ghosts });
          }
          break;
        }
        default:
          setDrawingPreview(null);
          break;
      }
    },
    [activeTool, drawingPoints, selectedShapeIds, getSelectedShapes, getSelectedParametricShapes,
     parametricShapesToGhosts, setDrawingPreview, scaleMode, arrayMode, arrayCount, arraySpacing, arrayAngle]
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
