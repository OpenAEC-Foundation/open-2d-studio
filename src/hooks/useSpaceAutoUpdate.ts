/**
 * useSpaceAutoUpdate - Watches for wall changes and recalculates space contours.
 *
 * When a wall is modified (moved, resized, deleted), all spaces in the same
 * drawing have their contour polygons re-detected from the updated wall geometry.
 * Linked text labels are also updated with the new area.
 *
 * Debounced at 300ms to avoid excessive recalculation during drag operations.
 */

import { useEffect, useRef } from 'react';
import { useAppStore } from '../state/appStore';
import type { SpaceShape, WallShape, TextShape } from '../types/geometry';
import { detectSpaceContour, computePolygonArea, computePolygonCentroid } from '../engine/geometry/SpaceDetector';
import { findLinkedLabels, resolveTemplate } from '../engine/geometry/LabelUtils';

export function useSpaceAutoUpdate(): void {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevWallSnapshotRef = useRef<string>('');

  useEffect(() => {
    const unsubscribe = useAppStore.subscribe((state, prevState) => {
      // Only react when shapes change
      if (state.shapes === prevState.shapes) return;

      // Build a snapshot of wall geometry to detect actual wall changes
      // (not just any shape change)
      const walls = state.shapes.filter(
        (s): s is WallShape => s.type === 'wall'
      );
      const wallSnapshot = walls
        .map(w => `${w.id}:${w.start.x},${w.start.y},${w.end.x},${w.end.y},${w.thickness},${w.justification},${w.bulge ?? 0},${w.spaceBounding},${w.visible}`)
        .sort()
        .join('|');

      if (wallSnapshot === prevWallSnapshotRef.current) return;
      prevWallSnapshotRef.current = wallSnapshot;

      // Check if there are any spaces to update
      const spaces = state.shapes.filter(
        (s): s is SpaceShape => s.type === 'space'
      );
      if (spaces.length === 0) return;

      // Debounce
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
      }

      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        recalculateSpaces();
      }, 300);
    });

    return () => {
      unsubscribe();
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
      }
    };
  }, []);
}

function recalculateSpaces(): void {
  const state = useAppStore.getState();
  const { shapes, updateShapes } = state;

  const spaces = shapes.filter(
    (s): s is SpaceShape => s.type === 'space'
  );
  if (spaces.length === 0) return;

  const updates: { id: string; updates: Partial<SpaceShape> }[] = [];
  const labelUpdates: { id: string; updates: Partial<TextShape> }[] = [];

  for (const space of spaces) {
    // Get walls in the same drawing
    const drawingWalls = shapes.filter(
      (s): s is WallShape => s.type === 'wall' && s.drawingId === space.drawingId && s.visible
    );
    if (drawingWalls.length < 2) continue;

    // Use the space's label position (centroid) as the detection click point
    const contour = detectSpaceContour(space.labelPosition, drawingWalls);

    if (contour) {
      const areaMm2 = computePolygonArea(contour);
      const areaM2 = areaMm2 / 1e6;
      const centroid = computePolygonCentroid(contour);

      // Only update if contour actually changed
      const changed =
        Math.abs((space.area ?? 0) - areaM2) > 0.001 ||
        space.contourPoints.length !== contour.length;

      if (changed) {
        updates.push({
          id: space.id,
          updates: {
            contourPoints: contour,
            area: areaM2,
            labelPosition: centroid,
          } as Partial<SpaceShape>,
        });

        // Update linked labels
        const linkedLabels = findLinkedLabels(shapes, space.id) as TextShape[];
        for (const label of linkedLabels) {
          if (label.labelTemplate) {
            const updatedSpace: SpaceShape = {
              ...space,
              contourPoints: contour,
              area: areaM2,
              labelPosition: centroid,
            };
            const newText = resolveTemplate(label.labelTemplate, updatedSpace);
            if (newText !== label.text) {
              labelUpdates.push({
                id: label.id,
                updates: {
                  text: newText,
                  position: centroid,
                } as Partial<TextShape>,
              });
            }
          }
        }
      }
    }
  }

  if (updates.length > 0 || labelUpdates.length > 0) {
    updateShapes([...updates, ...labelUpdates]);
  }
}
