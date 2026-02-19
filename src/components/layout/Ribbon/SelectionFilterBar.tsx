/**
 * SelectionFilterBar - Shows category filter chips when shapes are selected.
 *
 * Appears below the ribbon content when one or more shapes are selected.
 * Each chip shows a category name and count. Clicking a chip filters the
 * visible selection to only that shape type. Clicking "All" clears the filter.
 */

import { memo, useMemo } from 'react';
import { useAppStore } from '../../../state/appStore';
import type { ShapeType } from '../../../types/geometry';

// Display labels for shape types
const CATEGORY_LABELS: Record<ShapeType, string> = {
  line: 'Lines',
  rectangle: 'Rectangles',
  circle: 'Circles',
  arc: 'Arcs',
  polyline: 'Polylines',
  ellipse: 'Ellipses',
  spline: 'Splines',
  text: 'Text',
  point: 'Points',
  dimension: 'Dimensions',
  hatch: 'Hatches',
  beam: 'Beams',
  image: 'Images',
  gridline: 'Gridlines',
  level: 'Levels',
  pile: 'Piles',
  wall: 'Walls',
  slab: 'Slabs',
  'section-callout': 'Sections',
  space: 'Spaces',
  'plate-system': 'Plate Systems',
  'spot-elevation': 'Spot Elevations',
  cpt: 'CPTs',
  'foundation-zone': 'Foundation Zones',
  'block-instance': 'Block Instances',
};

// Singular labels for count = 1
const CATEGORY_LABELS_SINGULAR: Record<ShapeType, string> = {
  line: 'Line',
  rectangle: 'Rectangle',
  circle: 'Circle',
  arc: 'Arc',
  polyline: 'Polyline',
  ellipse: 'Ellipse',
  spline: 'Spline',
  text: 'Text',
  point: 'Point',
  dimension: 'Dimension',
  hatch: 'Hatch',
  beam: 'Beam',
  image: 'Image',
  gridline: 'Gridline',
  level: 'Level',
  pile: 'Pile',
  wall: 'Wall',
  slab: 'Slab',
  'section-callout': 'Section',
  space: 'Space',
  'plate-system': 'Plate System',
  'spot-elevation': 'Spot Elevation',
  cpt: 'CPT',
  'foundation-zone': 'Foundation Zone',
  'block-instance': 'Block Instance',
};

// Preferred display order for categories
const CATEGORY_ORDER: ShapeType[] = [
  'wall', 'beam', 'slab', 'pile', 'gridline', 'level',
  'section-callout', 'dimension', 'text', 'line', 'polyline',
  'rectangle', 'circle', 'arc', 'ellipse', 'spline', 'hatch',
  'image', 'point',
];

interface CategoryCount {
  type: ShapeType;
  count: number;
}

export const SelectionFilterBar = memo(function SelectionFilterBar() {
  const selectedShapeIds = useAppStore((s) => s.selectedShapeIds);
  const shapes = useAppStore((s) => s.shapes);
  const selectionFilter = useAppStore((s) => s.selectionFilter);
  const setSelectionFilter = useAppStore((s) => s.setSelectionFilter);

  // Compute category counts from the full selection (unfiltered)
  const categories: CategoryCount[] = useMemo(() => {
    if (selectedShapeIds.length === 0) return [];

    const idSet = new Set(selectedShapeIds);
    const counts = new Map<ShapeType, number>();

    for (const shape of shapes) {
      if (idSet.has(shape.id)) {
        counts.set(shape.type, (counts.get(shape.type) || 0) + 1);
      }
    }

    // Sort by preferred order
    const result: CategoryCount[] = [];
    for (const type of CATEGORY_ORDER) {
      const count = counts.get(type);
      if (count) {
        result.push({ type, count });
      }
    }
    // Add any remaining types not in the preferred order
    for (const [type, count] of counts) {
      if (!CATEGORY_ORDER.includes(type)) {
        result.push({ type, count });
      }
    }

    return result;
  }, [selectedShapeIds, shapes]);

  // Don't render if nothing is selected or only one category exists
  if (selectedShapeIds.length === 0 || categories.length <= 1) {
    return null;
  }

  const totalCount = selectedShapeIds.length;

  return (
    <>
      <span className="quick-access-separator" />
      <span className="selection-filter-label">Filter:</span>
      <button
        className={`selection-filter-chip ${selectionFilter === null ? 'active' : ''}`}
        onClick={() => setSelectionFilter(null)}
      >
        All ({totalCount})
      </button>
      {categories.map(({ type, count }) => {
        const label = count === 1
          ? CATEGORY_LABELS_SINGULAR[type] || type
          : CATEGORY_LABELS[type] || type;
        return (
          <button
            key={type}
            className={`selection-filter-chip ${selectionFilter === type ? 'active' : ''}`}
            onClick={() => setSelectionFilter(selectionFilter === type ? null : type)}
          >
            {label} ({count})
          </button>
        );
      })}
    </>
  );
});
