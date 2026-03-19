/**
 * LabelUtils - Utilities for linked element labels (tags)
 *
 * Generates label text from linked shape properties (like Revit element tags).
 * Labels auto-update when the linked element's properties change.
 */

import type {
  Point,
  Shape,
  BeamShape,
  WallShape,
  GridlineShape,
  SlabShape,
  LevelShape,
  PileShape,
  PuntniveauShape,
  SpaceShape,
  WallType,
  BoundingBox,
} from '../../types/geometry';
import type { UnitSettings } from '../../units/types';
import { formatNumber, formatElevation, applyNumberFormat } from '../../units/format';

/**
 * Generate display text for a shape to be shown in a linked label.
 * Returns appropriate text based on shape type:
 * - Beam: profile preset name or profile type + flange width
 * - Wall: wall type name + thickness, or "Wall <thickness>mm"
 * - Gridline: label (e.g., "A", "1")
 * - Slab: label + thickness, or "Slab <thickness>mm"
 * - Level: peil value formatted as elevation
 * - Pile: label (e.g., "P1")
 * - Other: shape type name
 */
export function getElementLabelText(
  shape: Shape,
  wallTypes?: WallType[],
  unitSettings?: UnitSettings,
  storeys?: { id: string; name: string; elevation: number }[]
): string {
  switch (shape.type) {
    case 'beam': {
      const beam = shape as BeamShape;
      // Prefer preset name (e.g., "HEA 300"), fall back to profile type + flange width
      if (beam.presetName) {
        return beam.presetName;
      }
      if (beam.labelText) {
        return beam.labelText;
      }
      return `${beam.profileType} ${beam.flangeWidth}mm`;
    }

    case 'wall': {
      const wall = shape as WallShape;
      // Try to look up wall type name
      if (wall.wallTypeId && wallTypes) {
        const wallType = wallTypes.find(wt => wt.id === wall.wallTypeId);
        if (wallType) {
          return `${wallType.name} ${wallType.thickness}mm`;
        }
      }
      // Fall back to wall label or generic
      if (wall.label) {
        return `${wall.label} ${wall.thickness}mm`;
      }
      return `Wall ${wall.thickness}mm`;
    }

    case 'gridline': {
      const gridline = shape as GridlineShape;
      return gridline.label;
    }

    case 'slab': {
      const slab = shape as SlabShape;
      const slabName = slab.label ? `${slab.label} ${slab.thickness}mm` : `Slab ${slab.thickness}mm`;
      if (slab.level && storeys) {
        const storey = storeys.find(s => s.id === slab.level);
        if (storey) {
          return `${slabName}\n${storey.name}`;
        }
      }
      return slabName;
    }

    case 'level': {
      const level = shape as LevelShape;
      const fmt = unitSettings?.numberFormat ?? 'period';
      return `${level.label} (${formatElevation(level.peil, fmt, 3)} m)`;
    }

    case 'pile': {
      const pile = shape as PileShape;
      return pile.label || `Pile D${pile.diameter}`;
    }

    case 'puntniveau': {
      const pn = shape as PuntniveauShape;
      const napFormatted = formatDutchNumber(pn.puntniveauNAP, unitSettings);
      return `PUNTNIVEAU: ${napFormatted} m N.A.P.`;
    }

    case 'space': {
      const space = shape as SpaceShape;
      let label = space.name;
      if (space.number) {
        label = `${space.number} - ${label}`;
      }
      if (space.area !== undefined) {
        const fmt = unitSettings?.numberFormat ?? 'period';
        label += `\n${formatNumber(space.area, 2, fmt)} m\u00B2`;
      }
      return label;
    }

    case 'line':
      return 'Line';

    case 'rectangle':
      return 'Rectangle';

    case 'circle':
      return `Circle R${(shape as any).radius}`;

    default:
      return shape.type;
  }
}

/**
 * Get the default label template for a given shape type.
 * Templates use placeholders like {Name}, {Number}, {Area}, etc.
 */
export function getDefaultLabelTemplate(shapeType: string): string {
  switch (shapeType) {
    case 'space':
      return '{Name}\n{Area} m\u00B2';
    case 'wall':
      return '{Type} {Thickness}mm';
    case 'beam':
      return '{Section}';
    case 'slab':
      return '{Name} {Thickness}mm';
    case 'pile':
      return '{Name}';
    default:
      return '{Name}';
  }
}

/**
 * Collect property values from a shape for template substitution.
 * Returns a record of placeholder names to their resolved values.
 */
export function getShapePropertyValues(
  shape: Shape,
  wallTypes?: WallType[],
  unitSettings?: UnitSettings,
  storeys?: { id: string; name: string; elevation: number }[]
): Record<string, string> {
  const props: Record<string, string> = {};

  switch (shape.type) {
    case 'space': {
      const space = shape as SpaceShape;
      props['Name'] = space.name || '';
      props['Number'] = space.number || '';
      props['Storey'] = space.level || '';
      props['Level'] = space.level || ''; // backward compat
      props['Area'] = space.area !== undefined ? formatNumber(space.area, 2, unitSettings?.numberFormat ?? 'period') : '';
      break;
    }
    case 'wall': {
      const wall = shape as WallShape;
      let typeName = 'Wall';
      if (wall.wallTypeId && wallTypes) {
        const wallType = wallTypes.find(wt => wt.id === wall.wallTypeId);
        if (wallType) typeName = wallType.name;
      } else if (wall.label) {
        typeName = wall.label;
      }
      props['Name'] = typeName;
      props['Type'] = typeName;
      props['Thickness'] = String(wall.thickness);
      break;
    }
    case 'beam': {
      const beam = shape as BeamShape;
      props['Name'] = beam.presetName || beam.labelText || beam.profileType;
      props['Section'] = beam.presetName || beam.labelText || `${beam.profileType} ${beam.flangeWidth}mm`;
      props['Profile'] = beam.profileType;
      props['FlangeWidth'] = String(beam.flangeWidth);
      break;
    }
    case 'slab': {
      const slab = shape as SlabShape;
      props['Name'] = slab.label || 'Slab';
      props['Thickness'] = String(slab.thickness);
      if (slab.level && storeys) {
        const storey = storeys.find(s => s.id === slab.level);
        props['Storey'] = storey ? storey.name : slab.level;
        props['Level'] = props['Storey']; // backward compat
      } else {
        props['Storey'] = '';
        props['Level'] = ''; // backward compat
      }
      break;
    }
    case 'pile': {
      const pile = shape as PileShape;
      props['Name'] = pile.label || `Pile D${pile.diameter}`;
      props['Diameter'] = String(pile.diameter);
      break;
    }
    case 'puntniveau': {
      const pn = shape as PuntniveauShape;
      const napFormatted = formatDutchNumber(pn.puntniveauNAP, unitSettings);
      props['Name'] = `PUNTNIVEAU: ${napFormatted} m N.A.P.`;
      props['NAP'] = napFormatted;
      props['Value'] = String(pn.puntniveauNAP);
      break;
    }
    case 'level': {
      const level = shape as LevelShape;
      const fmt = unitSettings?.numberFormat ?? 'period';
      props['Name'] = level.label;
      props['Elevation'] = `${formatElevation(level.peil, fmt, 3)} m`;
      break;
    }
    case 'gridline': {
      const gridline = shape as GridlineShape;
      props['Name'] = gridline.label;
      break;
    }
    default:
      props['Name'] = shape.type;
      break;
  }

  return props;
}

/**
 * Resolve a label template by substituting {Placeholder} tokens with actual
 * property values from the linked shape.
 *
 * @param template - Template string, e.g. "{Name}\n{Area} m²"
 * @param shape - The linked shape to read properties from
 * @param wallTypes - Wall type definitions (for wall name resolution)
 * @returns The resolved string with placeholders replaced
 */
export function resolveTemplate(
  template: string,
  shape: Shape,
  wallTypes?: WallType[],
  unitSettings?: UnitSettings,
  storeys?: { id: string; name: string; elevation: number }[]
): string {
  const props = getShapePropertyValues(shape, wallTypes, unitSettings, storeys);
  return template.replace(/\{(\w+)\}/g, (_match, key: string) => {
    return props[key] ?? '';
  });
}

/**
 * Get the centroid/center point of a shape for label attachment.
 * Used to calculate label offset from the linked element.
 */
export function getShapeCentroid(shape: Shape): { x: number; y: number } {
  switch (shape.type) {
    case 'beam': {
      const beam = shape as BeamShape;
      return {
        x: (beam.start.x + beam.end.x) / 2,
        y: (beam.start.y + beam.end.y) / 2,
      };
    }
    case 'wall': {
      const wall = shape as WallShape;
      return {
        x: (wall.start.x + wall.end.x) / 2,
        y: (wall.start.y + wall.end.y) / 2,
      };
    }
    case 'gridline': {
      const gridline = shape as GridlineShape;
      return {
        x: (gridline.start.x + gridline.end.x) / 2,
        y: (gridline.start.y + gridline.end.y) / 2,
      };
    }
    case 'level': {
      const level = shape as LevelShape;
      return {
        x: (level.start.x + level.end.x) / 2,
        y: (level.start.y + level.end.y) / 2,
      };
    }
    case 'slab': {
      const slab = shape as SlabShape;
      if (slab.points.length === 0) return { x: 0, y: 0 };
      const cx = slab.points.reduce((s, p) => s + p.x, 0) / slab.points.length;
      const cy = slab.points.reduce((s, p) => s + p.y, 0) / slab.points.length;
      return { x: cx, y: cy };
    }
    case 'space': {
      const space = shape as SpaceShape;
      return { x: space.labelPosition.x, y: space.labelPosition.y };
    }
    case 'pile': {
      const pile = shape as PileShape;
      return { x: pile.position.x, y: pile.position.y };
    }
    case 'puntniveau': {
      const pn = shape as PuntniveauShape;
      if (pn.points.length === 0) return { x: 0, y: 0 };
      if (pn.labelPosition) return { x: pn.labelPosition.x, y: pn.labelPosition.y };
      const cx = pn.points.reduce((s, p) => s + p.x, 0) / pn.points.length;
      const cy = pn.points.reduce((s, p) => s + p.y, 0) / pn.points.length;
      return { x: cx, y: cy };
    }
    case 'line': {
      const line = shape as any;
      return {
        x: (line.start.x + line.end.x) / 2,
        y: (line.start.y + line.end.y) / 2,
      };
    }
    case 'circle': {
      const circle = shape as any;
      return { x: circle.center.x, y: circle.center.y };
    }
    case 'rectangle': {
      const rect = shape as any;
      return {
        x: rect.topLeft.x + rect.width / 2,
        y: rect.topLeft.y + rect.height / 2,
      };
    }
    default:
      return { x: 0, y: 0 };
  }
}

/**
 * Find all text shapes that are linked to a given shape ID.
 */
export function findLinkedLabels(shapes: Shape[], linkedToId: string): Shape[] {
  return shapes.filter(
    s => s.type === 'text' && (s as any).linkedShapeId === linkedToId
  );
}

/**
 * Format a number in Dutch notation (comma as decimal separator).
 * Removes trailing zeros after the comma for clean display.
 * When unitSettings is provided, respects the numberFormat setting.
 * Examples: -18.5 -> "-18,5", 12.0 -> "12", -3.25 -> "-3,25"
 */
export function formatDutchNumber(value: number, unitSettings?: UnitSettings): string {
  const formatted = value.toFixed(2);
  const cleaned = formatted.replace(/\.?0+$/, '');
  if (unitSettings) {
    return applyNumberFormat(cleaned, unitSettings.numberFormat);
  }
  return cleaned.replace('.', ',');
}

/**
 * Get the perpendicular half-extent of a shape from its centerline.
 *
 * For beams this accounts for the active view mode:
 *   - plan / side: flangeWidth / 2
 *   - elevation: max of flangeWidth and profile depth / 2
 *   - section: max of flangeWidth and profile height / 2
 *
 * For beams and walls with left/right justification the full thickness is
 * returned instead of half, because the element extends entirely to one
 * side of the centerline.
 */
function getShapeHalfThickness(shape: Shape): number {
  if (shape.type === 'wall') {
    const wall = shape as WallShape;
    if (wall.justification === 'left' || wall.justification === 'right') {
      return wall.thickness;
    }
    return wall.thickness / 2;
  }
  if (shape.type === 'beam') {
    const beam = shape as BeamShape;
    const viewMode = beam.viewMode || 'plan';

    // In elevation and section views the rendered extent can be larger than
    // the plan-view flangeWidth because the full profile depth is shown.
    let extent = beam.flangeWidth;
    if (viewMode === 'elevation' || viewMode === 'section') {
      const params = beam.profileParameters as Record<string, number | string | boolean>;
      const depth = (params.webHeight as number)
        || (params.height as number)
        || (params.outerDiameter as number)
        || beam.flangeWidth;
      extent = Math.max(extent, depth);
    }

    const halfExtent = extent / 2;

    // Left / right justified beams extend fully to one side of the draw line.
    if (beam.justification === 'left' || beam.justification === 'right') {
      return extent;
    }
    return halfExtent;
  }
  return 0;
}

/** Default margin between the element edge and the label, in drawing units (mm). */
const LABEL_MARGIN = 150;

/**
 * Compute the correct position and rotation for a linked label based on
 * the current geometry of its parent shape (wall, beam, line, gridline, etc.).
 *
 * Position: configurable distance from the start along the element direction
 *           (default 1000mm, or midpoint if element is shorter),
 *           offset perpendicular to the element direction so the label
 *           appears clearly to the SIDE of the element (to the left when
 *           looking from start to end) rather than overlapping the element.
 * Rotation: angle of the element direction (Math.atan2(dy, dx)).
 *
 * Returns null if the shape does not have start/end geometry.
 */
export function computeLinkedLabelPosition(
  parentShape: Shape,
  beamLabelStartDistance: number = 1000,
): { position: Point; rotation: number } | null {
  if (!('start' in parentShape && 'end' in parentShape)) {
    return null;
  }
  const s = parentShape as Shape & { start: Point; end: Point };
  const dx = s.end.x - s.start.x;
  const dy = s.end.y - s.start.y;
  const length = Math.sqrt(dx * dx + dy * dy);

  const rotation = Math.atan2(dy, dx);

  // Place label at the configured distance from start along the element direction.
  // If element is shorter than the configured distance, place at midpoint.
  const alongOffset = length > 0 ? Math.min(beamLabelStartDistance, length / 2) : 0;
  const dirX = length > 0 ? dx / length : 1;
  const dirY = length > 0 ? dy / length : 0;

  // Perpendicular direction: rotate direction 90 degrees clockwise
  // so the label appears ABOVE the element (negative-y side in screen coords).
  // For a horizontal left-to-right element: dir=(1,0) => perp=(0,-1) = upward on screen.
  const perpX = dirY;
  const perpY = -dirX;

  // Offset = element half-extent + generous margin so the label sits clearly
  // to the side of the element with no overlap.
  const halfThickness = getShapeHalfThickness(parentShape);
  const perpOffset = halfThickness + LABEL_MARGIN;

  const position: Point = {
    x: s.start.x + dirX * alongOffset + perpX * perpOffset,
    y: s.start.y + dirY * alongOffset + perpY * perpOffset,
  };

  return { position, rotation };
}

/**
 * Compute the bounding box of a polygon (array of points).
 */
function getPolygonBoundingBox(points: Point[]): BoundingBox {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY };
}

/**
 * Compute the span arrow properties for a slab label.
 *
 * In structural engineering, the span direction of a slab is along its shorter
 * dimension. This function computes:
 * - The centroid of the slab (label position)
 * - The span direction angle (along the shorter axis of the bounding box)
 * - The arrow length (70% of the shorter dimension)
 *
 * Returns null if the slab has no points.
 */
export function computeSlabSpanArrow(
  slab: SlabShape
): { position: Point; spanDirection: number; spanLength: number } | null {
  if (slab.points.length === 0) return null;

  // Compute centroid
  const cx = slab.points.reduce((s, p) => s + p.x, 0) / slab.points.length;
  const cy = slab.points.reduce((s, p) => s + p.y, 0) / slab.points.length;

  // Compute bounding box
  const bb = getPolygonBoundingBox(slab.points);
  const width = bb.maxX - bb.minX;
  const height = bb.maxY - bb.minY;

  // Span direction is along the shorter dimension
  // horizontal (angle=0) if width < height, vertical (angle=PI/2) if height < width
  let spanDirection: number;
  let shorterDim: number;
  if (width <= height) {
    spanDirection = 0;          // horizontal arrow
    shorterDim = width;
  } else {
    spanDirection = Math.PI / 2; // vertical arrow
    shorterDim = height;
  }

  // Arrow length: 70% of the shorter dimension, but at least 200mm
  const spanLength = Math.max(shorterDim * 0.7, 200);

  return {
    position: { x: cx, y: cy },
    spanDirection,
    spanLength,
  };
}
