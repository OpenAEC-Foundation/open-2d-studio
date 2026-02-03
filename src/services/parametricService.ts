/**
 * Parametric Service
 *
 * Main service for creating and managing parametric shapes.
 * Provides a unified API for:
 * - Creating parametric shapes
 * - Updating parameters
 * - Regenerating geometry
 * - Converting to regular shapes (explode)
 */

import type { Point, ShapeStyle, PolylineShape, CircleShape, Shape } from '../types/geometry';
import type {
  ProfileType,
  ParameterValues,
  ProfileParametricShape,
  ParametricShape,
} from '../types/parametric';
import { getDefaultParameters } from './parametric/profileTemplates';
import { generateProfileGeometry, regenerateGeometry } from './parametric/geometryGenerators';
import { getPresetById } from './parametric/profileLibrary';
import { generateShapeId, DEFAULT_STYLE } from './shapeService';

// ============================================================================
// Parametric Shape Creation
// ============================================================================

/**
 * Create a new profile parametric shape
 */
export function createProfileShape(
  profileType: ProfileType,
  position: Point,
  layerId: string,
  drawingId: string,
  options?: {
    parameters?: Partial<ParameterValues>;
    presetId?: string;
    rotation?: number;
    scale?: number;
    style?: Partial<ShapeStyle>;
  }
): ProfileParametricShape {
  const {
    parameters: customParams,
    presetId,
    rotation = 0,
    scale = 1,
    style,
  } = options || {};

  // Get base parameters from preset or defaults
  let parameters: ParameterValues;
  let standard: string | undefined;

  // Helper to merge parameters, filtering out undefined values
  const mergeParams = (base: ParameterValues, custom?: Partial<ParameterValues>): ParameterValues => {
    if (!custom) return { ...base };
    const result: ParameterValues = { ...base };
    for (const [key, value] of Object.entries(custom)) {
      if (value !== undefined) {
        result[key] = value;
      }
    }
    return result;
  };

  if (presetId) {
    const preset = getPresetById(presetId);
    if (preset) {
      parameters = mergeParams(preset.parameters, customParams);
      standard = preset.standard;
    } else {
      parameters = mergeParams(getDefaultParameters(profileType), customParams);
    }
  } else {
    parameters = mergeParams(getDefaultParameters(profileType), customParams);
  }

  // Generate geometry
  const generatedGeometry = generateProfileGeometry(
    profileType,
    parameters,
    position,
    rotation,
    scale
  );

  return {
    id: generateShapeId(),
    parametricType: 'profile',
    profileType,
    layerId,
    drawingId,
    style: { ...DEFAULT_STYLE, ...style },
    visible: true,
    locked: false,
    position,
    rotation,
    scale,
    parameters,
    presetId,
    standard,
    generatedGeometry,
  };
}

/**
 * Create a profile shape from a preset
 */
export function createProfileFromPreset(
  presetId: string,
  position: Point,
  layerId: string,
  drawingId: string,
  options?: {
    rotation?: number;
    scale?: number;
    style?: Partial<ShapeStyle>;
  }
): ProfileParametricShape | null {
  const preset = getPresetById(presetId);
  if (!preset) return null;

  return createProfileShape(preset.profileType, position, layerId, drawingId, {
    ...options,
    presetId,
  });
}

// ============================================================================
// Parametric Shape Updates
// ============================================================================

/**
 * Update parameters of a parametric shape
 * Returns a new shape with regenerated geometry
 */
export function updateParametricParameters(
  shape: ParametricShape,
  newParameters: Partial<ParameterValues>
): ParametricShape {
  if (shape.parametricType !== 'profile') {
    return shape;
  }

  const profileShape = shape as ProfileParametricShape;
  // Merge parameters, filtering out undefined values
  const updatedParameters: ParameterValues = { ...profileShape.parameters };
  for (const [key, value] of Object.entries(newParameters)) {
    if (value !== undefined) {
      updatedParameters[key] = value;
    }
  }

  // Regenerate geometry with new parameters
  const generatedGeometry = regenerateGeometry(
    profileShape.profileType,
    updatedParameters,
    profileShape.position,
    profileShape.rotation,
    profileShape.scale
  );

  return {
    ...profileShape,
    parameters: updatedParameters,
    presetId: undefined, // Clear preset since parameters changed
    generatedGeometry,
  };
}

/**
 * Update position of a parametric shape
 */
export function updateParametricPosition(
  shape: ParametricShape,
  newPosition: Point
): ParametricShape {
  if (shape.parametricType !== 'profile') {
    return shape;
  }

  const profileShape = shape as ProfileParametricShape;

  // Regenerate geometry at new position
  const generatedGeometry = regenerateGeometry(
    profileShape.profileType,
    profileShape.parameters,
    newPosition,
    profileShape.rotation,
    profileShape.scale
  );

  return {
    ...profileShape,
    position: newPosition,
    generatedGeometry,
  };
}

/**
 * Update rotation of a parametric shape
 */
export function updateParametricRotation(
  shape: ParametricShape,
  newRotation: number
): ParametricShape {
  if (shape.parametricType !== 'profile') {
    return shape;
  }

  const profileShape = shape as ProfileParametricShape;

  // Regenerate geometry with new rotation
  const generatedGeometry = regenerateGeometry(
    profileShape.profileType,
    profileShape.parameters,
    profileShape.position,
    newRotation,
    profileShape.scale
  );

  return {
    ...profileShape,
    rotation: newRotation,
    generatedGeometry,
  };
}

/**
 * Update scale of a parametric shape
 */
export function updateParametricScale(
  shape: ParametricShape,
  newScale: number
): ParametricShape {
  if (shape.parametricType !== 'profile') {
    return shape;
  }

  const profileShape = shape as ProfileParametricShape;

  // Regenerate geometry with new scale
  const generatedGeometry = regenerateGeometry(
    profileShape.profileType,
    profileShape.parameters,
    profileShape.position,
    profileShape.rotation,
    newScale
  );

  return {
    ...profileShape,
    scale: newScale,
    generatedGeometry,
  };
}

/**
 * Apply a preset to a parametric shape
 */
export function applyPresetToShape(
  shape: ParametricShape,
  presetId: string
): ParametricShape | null {
  const preset = getPresetById(presetId);
  if (!preset || shape.parametricType !== 'profile') return null;

  const profileShape = shape as ProfileParametricShape;

  // Only apply if profile type matches
  if (preset.profileType !== profileShape.profileType) return null;

  return updateParametricParameters(shape, preset.parameters);
}

// ============================================================================
// Explode (Convert to Regular Shapes)
// ============================================================================

/**
 * Calculate bulge value for an arc segment
 * Bulge = tan(includedAngle / 4)
 * Positive = counterclockwise, Negative = clockwise
 */
function calculateBulge(startAngle: number, endAngle: number): number {
  let includedAngle = endAngle - startAngle;
  // Normalize to [-2π, 2π]
  while (includedAngle > Math.PI * 2) includedAngle -= Math.PI * 2;
  while (includedAngle < -Math.PI * 2) includedAngle += Math.PI * 2;
  return Math.tan(includedAngle / 4);
}

/**
 * Convert a parametric shape to regular shapes (polylines with bulge for arcs, or circles)
 * This "explodes" the parametric shape into basic geometry
 * The entire outline becomes a single polyline with bulge values for arc segments
 */
export function explodeParametricShape(
  shape: ParametricShape
): Shape[] {
  if (shape.parametricType !== 'profile') {
    return [];
  }

  const profileShape = shape as ProfileParametricShape;
  const geometry = profileShape.generatedGeometry;

  if (!geometry) {
    return [];
  }

  const result: Shape[] = [];
  const baseProps = {
    layerId: shape.layerId,
    drawingId: shape.drawingId,
    style: { ...shape.style },
    visible: shape.visible,
    locked: shape.locked,
  };

  // Process each outline
  for (let outlineIdx = 0; outlineIdx < geometry.outlines.length; outlineIdx++) {
    const outline = geometry.outlines[outlineIdx];
    const isClosed = geometry.closed[outlineIdx] ?? true;
    const arcSegments = geometry.arcSegments?.[outlineIdx] || [];

    // If no arc segments, create a simple polyline without bulge
    if (arcSegments.length === 0) {
      result.push({
        id: generateShapeId(),
        type: 'polyline',
        ...baseProps,
        points: outline,
        closed: isClosed,
      } as PolylineShape);
      continue;
    }

    // Check if the entire outline is a full circle
    if (arcSegments.length === 1) {
      const arc = arcSegments[0];
      const isFullCircle = Math.abs(Math.abs(arc.endAngle - arc.startAngle) - Math.PI * 2) < 0.01;
      if (isFullCircle && arc.startIndex === 0 && arc.endIndex >= outline.length - 2) {
        // Full circle
        result.push({
          id: generateShapeId(),
          type: 'circle',
          ...baseProps,
          center: arc.center,
          radius: arc.radius,
        } as CircleShape);
        continue;
      }
    }

    // Build a single polyline with bulge values for arc segments
    // We need to simplify the outline: keep start/end points of arcs, remove intermediate arc points
    const simplifiedPoints: Point[] = [];
    const bulgeValues: number[] = [];

    // Sort arc segments by start index
    const sortedArcs = [...arcSegments].sort((a, b) => a.startIndex - b.startIndex);

    // Create a map of which indices are arc start points and their bulge values
    const arcStartMap = new Map<number, { endIndex: number; bulge: number }>();
    for (const arc of sortedArcs) {
      const bulge = calculateBulge(arc.startAngle, arc.endAngle);
      arcStartMap.set(arc.startIndex, { endIndex: arc.endIndex, bulge });
    }

    // Build simplified polyline
    let i = 0;
    while (i < outline.length) {
      const arcInfo = arcStartMap.get(i);
      if (arcInfo) {
        // This is the start of an arc - add the start point with bulge
        simplifiedPoints.push(outline[i]);
        bulgeValues.push(arcInfo.bulge);
        // Skip to the end of the arc (the end point will be added in next iteration or as next point)
        i = arcInfo.endIndex;
      } else {
        // Regular point - add with zero bulge (straight line to next point)
        simplifiedPoints.push(outline[i]);
        bulgeValues.push(0);
        i++;
      }
    }

    // For closed polylines, the last bulge connects last point to first point
    // If not closed, the last bulge is unused but we keep it for consistency
    if (isClosed && simplifiedPoints.length > 0) {
      // Check if there's an arc that wraps around (ends at or near index 0)
      // The last bulge value is already set correctly
    }

    result.push({
      id: generateShapeId(),
      type: 'polyline',
      ...baseProps,
      points: simplifiedPoints,
      closed: isClosed,
      bulge: bulgeValues,
    } as PolylineShape);
  }

  return result;
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Check if a shape is a parametric shape
 */
export function isParametricShape(shape: unknown): shape is ParametricShape {
  return (
    typeof shape === 'object' &&
    shape !== null &&
    'parametricType' in shape &&
    'parameters' in shape
  );
}

/**
 * Check if a shape is a profile parametric shape
 */
export function isProfileParametricShape(shape: unknown): shape is ProfileParametricShape {
  return isParametricShape(shape) && shape.parametricType === 'profile';
}

/**
 * Get bounding box of a parametric shape
 */
export function getParametricShapeBounds(shape: ParametricShape): {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
} | null {
  if (shape.parametricType !== 'profile') return null;

  const profileShape = shape as ProfileParametricShape;
  return profileShape.generatedGeometry?.bounds || null;
}

/**
 * Clone a parametric shape
 */
export function cloneParametricShape(
  shape: ParametricShape,
  offset: Point = { x: 0, y: 0 }
): ParametricShape {
  if (shape.parametricType !== 'profile') {
    return { ...shape, id: generateShapeId() };
  }

  const profileShape = shape as ProfileParametricShape;
  const newPosition = {
    x: profileShape.position.x + offset.x,
    y: profileShape.position.y + offset.y,
  };

  return createProfileShape(
    profileShape.profileType,
    newPosition,
    profileShape.layerId,
    profileShape.drawingId,
    {
      parameters: profileShape.parameters,
      presetId: profileShape.presetId,
      rotation: profileShape.rotation,
      scale: profileShape.scale,
      style: profileShape.style,
    }
  );
}

// ============================================================================
// Re-exports for convenience
// ============================================================================

export {
  PROFILE_TEMPLATES,
  getProfileTemplate,
  getDefaultParameters,
  getAllProfileTemplates,
} from './parametric/profileTemplates';

export {
  PROFILE_PRESETS,
  getPresetById,
  getPresetsForType,
  getPresetsForStandard,
  getAvailableStandards,
  getCategoriesForStandard,
  searchPresets,
} from './parametric/profileLibrary';

export {
  generateProfileGeometry,
  regenerateGeometry,
} from './parametric/geometryGenerators';

// Re-export types
export type {
  ProfileType,
  ParameterValues,
  ProfileParametricShape,
  ParametricShape,
  GeneratedGeometry,
  ProfilePreset,
  ProfileTemplate,
  ParameterDefinition,
} from '../types/parametric';
