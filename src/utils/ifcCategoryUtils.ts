/**
 * IFC Category Utilities
 *
 * Shared mapping from shape types to IFC entity class names.
 * Used for rendering filters, selection filters, and IFC tree display.
 */

import type { Shape, BeamShape } from '../types/geometry';

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
 * Returns 'Other' for shape types that don't map to an IFC class.
 */
export function getIfcCategory(shape: Shape): string {
  switch (shape.type) {
    case 'wall': return 'IfcWall';
    case 'beam': {
      const beam = shape as BeamShape;
      return beam.viewMode === 'section' ? 'IfcColumn' : 'IfcBeam';
    }
    case 'slab': return 'IfcSlab';
    case 'pile': return 'IfcPile';
    case 'cpt': return 'IfcBuildingElementProxy';
    case 'puntniveau': return 'IfcBuildingElementProxy';
    case 'gridline': return 'IfcGrid';
    case 'level': return 'IfcBuildingStorey';
    case 'space': return 'IfcSpace';
    case 'plate-system': return 'IfcPlateSystem';
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
