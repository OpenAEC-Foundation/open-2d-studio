/**
 * RenderSorter - Assigns render priority to shape types for single-pass rendering
 *
 * Priority order (lower = rendered first / further back):
 *   0 — underlay images
 *   1 — slabs
 *   2 — IFC/AEC structural shapes (walls, beams, columns, etc.)
 *   3 — 2D annotation shapes (lines, arcs, hatches, dimensions, non-underlay images, etc.)
 *   4 — text labels
 *   5 — gridlines (always on top)
 */

import type { Shape } from '../../types/geometry';
import type { ImageShape } from '../../types/geometry';

/** Shape types that belong to the IFC/AEC structural pass */
export const IFC_AEC_TYPES = new Set([
  'wall', 'beam', 'column', 'pile', 'puntniveau', 'cpt', 'space',
  'section-callout', 'spot-elevation', 'plate-system', 'rebar',
  'wall-opening', 'slab-opening', 'slab-label',
]);

/**
 * Returns the render priority (0-5) for a shape.
 * Lower numbers are drawn first (further back in the z-order).
 */
export function getRenderPriority(shape: Shape): number {
  switch (shape.type) {
    case 'image':
      return (shape as ImageShape).isUnderlay ? 0 : 3;
    case 'slab':
      return 1;
    case 'gridline':
      return 5;
    case 'text':
      return 4;
    default:
      return IFC_AEC_TYPES.has(shape.type) ? 2 : 3;
  }
}

/**
 * Sort an array of shapes into render order.
 * Shapes with equal priority preserve their original relative order (stable sort).
 */
export function sortByRenderPriority(shapes: Shape[]): Shape[] {
  // Augment with priority to sort stably
  return shapes
    .map((shape, index) => ({ shape, priority: getRenderPriority(shape), index }))
    .sort((a, b) => a.priority - b.priority || a.index - b.index)
    .map(entry => entry.shape);
}
