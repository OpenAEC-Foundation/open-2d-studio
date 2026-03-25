/**
 * modifyToolHelpers - Top-level helper functions and constants extracted from useModifyTools.
 *
 * These are pure functions (no React hook state dependencies) used by the modify tools.
 */

import { useAppStore } from '../../state/appStore';
import type { Shape, ToolType } from '../../types/geometry';
import {
  transformShape,
  getShapeTransformUpdates,
  recalculateMiterJoins,
} from '../../engine/geometry/Modify';
import { findLinkedLabels, computeLinkedLabelPosition } from '../../engine/geometry/LabelUtils';
import type { PointTransform } from '../../engine/geometry/Modify';

export const MODIFY_TOOLS: ToolType[] = ['move', 'copy', 'copy2', 'rotate', 'scale', 'mirror', 'array', 'trim', 'extend', 'fillet', 'chamfer', 'offset', 'elastic', 'align', 'trim-walls'];

/**
 * Collect transform updates for all linked labels of the given shapes.
 *
 * For shapes with start/end geometry (wall, beam, line, gridline, etc.),
 * the label position and rotation are recalculated to stay at the configured
 * beam label start distance from the start and parallel with the element direction.
 *
 * For other shapes, the same spatial transform is applied to the label.
 *
 * Returns update entries for labels that are NOT already in the selectedIdSet.
 */
export function getLinkedLabelUpdates(
  movedShapes: Shape[],
  allShapes: Shape[],
  selectedIdSet: Set<string>,
  transform: PointTransform,
  /** Optional: the pending updates for the parent shapes so we can compute
   *  the post-transform geometry. If not provided, the transform is applied
   *  to the original shape to derive the new geometry. */
  pendingParentUpdates?: Map<string, Partial<Shape>>,
): { id: string; updates: Partial<Shape> }[] {
  const beamLabelStartDistance = useAppStore.getState().planSubtypeSettings?.structuralPlan?.beamLabelStartDistance ?? 1000;
  const updates: { id: string; updates: Partial<Shape> }[] = [];
  for (const s of movedShapes) {
    const linkedLabels = findLinkedLabels(allShapes, s.id);
    if (linkedLabels.length === 0) continue;

    // Compute the post-transform parent shape so we can derive the label position
    let postTransformParent: Shape;
    const pending = pendingParentUpdates?.get(s.id);
    if (pending) {
      postTransformParent = { ...s, ...pending } as Shape;
    } else {
      postTransformParent = transformShape(s, transform);
    }

    // Try to compute precise label position from parent geometry
    const labelPos = computeLinkedLabelPosition(postTransformParent, beamLabelStartDistance);

    for (const label of linkedLabels) {
      if (selectedIdSet.has(label.id)) continue;

      if (labelPos) {
        // Recalculate position and rotation to stay parallel with element
        updates.push({
          id: label.id,
          updates: {
            position: labelPos.position,
            rotation: labelPos.rotation,
          } as Partial<Shape>,
        });
      } else {
        // Fallback: just apply the same transform
        updates.push({
          id: label.id,
          updates: getShapeTransformUpdates(label, transform),
        });
      }
    }
  }
  return updates;
}

/**
 * After moving/rotating/scaling walls or beams that have miter joins, recalculate
 * the miter angles for the modified shapes and their partners.
 *
 * @param pendingUpdates - the updates that are about to be applied (used to compute
 *   the post-update shape for miter recalculation)
 * @param movedShapes - the original shapes that were moved
 * @param allShapes - all shapes from the store
 * @returns additional updates to merge (may overlap with pendingUpdates by id)
 */
export function getMiterRecalcUpdates(
  pendingUpdates: { id: string; updates: Partial<Shape> }[],
  movedShapes: Shape[],
  allShapes: Shape[],
): { id: string; updates: Partial<Shape> }[] {
  const extraUpdates: { id: string; updates: Partial<Shape> }[] = [];
  const pendingMap = new Map(pendingUpdates.map(u => [u.id, u.updates]));

  for (const shape of movedShapes) {
    if (shape.type !== 'wall' && shape.type !== 'beam') continue;
    const ws = shape as any;
    const hasMiter = (ws.startMiterAngle !== undefined && ws.startCap === 'miter') ||
                     (ws.endMiterAngle !== undefined && ws.endCap === 'miter');
    if (!hasMiter) continue;

    // Build the post-update version of this shape
    const pending = pendingMap.get(shape.id);
    const updatedShape = pending ? { ...(shape as any), ...(pending as any) } as Shape : shape;

    const miterUpdates = recalculateMiterJoins(updatedShape, allShapes);
    for (const mu of miterUpdates) {
      extraUpdates.push(mu);
    }
  }
  return extraUpdates;
}

/** Compute the next sequential gridline label, avoiding existing labels.
 *  "1" → "2", "A" → "B", "Z" → "AA", "9" → "10", "A1" → "A2" */
export function nextGridlineLabel(currentLabel: string, existingLabels: Set<string>): string {
  const tryNext = (label: string): string => {
    // Pure numeric: "1" → "2", "10" → "11"
    if (/^\d+$/.test(label)) {
      return String(Number(label) + 1);
    }
    // Pure alpha: "A" → "B", "Z" → "AA"
    if (/^[A-Z]+$/i.test(label)) {
      const upper = label.toUpperCase();
      let carry = true;
      let result = '';
      for (let i = upper.length - 1; i >= 0 && carry; i--) {
        const code = upper.charCodeAt(i) + 1;
        if (code > 90) { result = 'A' + result; carry = true; }
        else { result = String.fromCharCode(code) + result; carry = false; }
        if (i > 0 && !carry) result = upper.substring(0, i) + result;
      }
      if (carry) result = 'A' + result;
      return label === label.toUpperCase() ? result : result.toLowerCase();
    }
    // Mixed (e.g. "A1"): increment trailing number
    const match = label.match(/^(.*?)(\d+)$/);
    if (match) return match[1] + String(Number(match[2]) + 1);
    return label + '2';
  };

  let candidate = tryNext(currentLabel);
  const maxAttempts = 1000;
  for (let i = 0; i < maxAttempts && existingLabels.has(candidate); i++) {
    candidate = tryNext(candidate);
  }
  return candidate;
}
