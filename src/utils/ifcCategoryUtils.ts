/**
 * IFC Category Utilities
 *
 * Shared mapping from shape types to IFC entity class names.
 * Used for rendering filters, selection filters, and IFC tree display.
 */

import type { Shape } from '../types/geometry';
import { ifcCategoryRegistry } from '../engine/registry/IfcCategoryRegistry';

/**
 * All known IFC categories used in the application.
 * Order matches the IFC spatial tree display priority.
 */
export const ALL_IFC_CATEGORIES = [
  'IfcWall',
  'IfcColumn',
  'IfcBeam',
  'IfcSlab',
  'IfcPile',
  'IfcBuildingElementProxy',
  'IfcSpace',
  'IfcGrid',
  'IfcBuildingStorey',
  'IfcPlateSystem',
  'IfcAnnotation',
] as const;

export type IfcCategory = (typeof ALL_IFC_CATEGORIES)[number];

/**
 * Human-readable labels for each IFC category.
 */
export const IFC_CATEGORY_LABELS: Record<string, string> = {
  IfcWall: 'Walls',
  IfcColumn: 'Columns',
  IfcBeam: 'Beams',
  IfcSlab: 'Slabs',
  IfcPile: 'Piles',
  IfcBuildingElementProxy: 'Proxy Elements',
  IfcSpace: 'Spaces',
  IfcGrid: 'Gridlines',
  IfcBuildingStorey: 'Levels',
  IfcPlateSystem: 'Plate Systems',
  IfcAnnotation: 'Annotations',
};

/**
 * Map a shape to its IFC entity class name.
 * Checks the extension registry first, then falls back to core annotation types.
 * Returns 'Other' for shape types that don't map to an IFC class.
 */
export function getIfcCategory(shape: Shape): string {
  // Check extension-registered categories first
  const registered = ifcCategoryRegistry.getCategory(shape);
  if (registered) return registered;

  // Core annotation types
  switch (shape.type) {
    case 'line':
    case 'arc':
    case 'circle':
    case 'polyline':
    case 'rectangle':
    case 'dimension':
    case 'text':
    case 'section-callout':
      return 'IfcAnnotation';
    default:
      return 'Other';
  }
}

/**
 * Check whether a shape belongs to a hidden IFC category.
 */
export function isShapeInHiddenCategory(shape: Shape, hiddenCategories: string[]): boolean {
  if (hiddenCategories.length === 0) return false;
  const category = getIfcCategory(shape);
  return hiddenCategories.includes(category);
}
