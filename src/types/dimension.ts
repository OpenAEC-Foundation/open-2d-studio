/**
 * Dimension Types - Type definitions for dimension shapes
 *
 * Dimensions are drawing-level shapes (not sheet annotations) that:
 * - Live with the drawing geometry
 * - Can be associative (update when referenced geometry moves)
 * - Appear in sheet viewports at the viewport's scale
 * - Are stored in the shapes array
 */

import type { Point, SnapType, BaseShape } from './geometry';

// ============================================================================
// Dimension Types
// ============================================================================

/**
 * Types of dimensions supported
 */
export type DimensionType = 'linear' | 'aligned' | 'angular' | 'radius' | 'diameter' | 'arc-length';

/**
 * Arrow/tick mark types for dimension terminators
 */
export type DimensionArrowType = 'filled' | 'open' | 'dot' | 'tick' | 'none';

/**
 * Text placement relative to dimension line
 */
export type DimensionTextPlacement = 'above' | 'centered' | 'below';

// ============================================================================
// Dimension Reference (for Associativity)
// ============================================================================

/**
 * Reference to geometry for associative dimensions
 * When the referenced geometry moves, the dimension updates automatically
 */
export interface DimensionReference {
  /** ID of the referenced geometry shape */
  shapeId: string;
  /** How we snapped to the geometry (endpoint, midpoint, center, etc.) */
  snapType: SnapType;
  /** For polylines - which vertex index was snapped to */
  pointIndex?: number;
}

// ============================================================================
// Dimension Style
// ============================================================================

/**
 * Visual styling for dimensions
 */
export interface DimensionStyle {
  /** Type of arrow/terminator at dimension line ends */
  arrowType: DimensionArrowType;
  /** Size of arrows in drawing units */
  arrowSize: number;
  /** Gap between geometry and extension line start */
  extensionLineGap: number;
  /** How far extension lines extend past the dimension line */
  extensionLineOvershoot: number;
  /** Text height in drawing units */
  textHeight: number;
  /** Where to place text relative to dimension line */
  textPlacement: DimensionTextPlacement;
  /** Color for dimension lines and extension lines */
  lineColor: string;
  /** Color for dimension text */
  textColor: string;
  /** Number of decimal places for dimension value */
  precision: number;
}

/**
 * Default dimension style
 */
export const DEFAULT_DIMENSION_STYLE: DimensionStyle = {
  arrowType: 'tick',        // Diagonal tick marks
  arrowSize: 2.5,           // Tick mark size
  extensionLineGap: 1.5,    // Small gap between geometry and extension line
  extensionLineOvershoot: 2.5, // Extension line extends past dimension line
  textHeight: 2.5,          // Slightly smaller text
  textPlacement: 'centered', // Text centered on dimension line
  lineColor: '#00ffff',     // Cyan - standard dimension color
  textColor: '#00ffff',
  precision: 0,             // Show whole numbers by default
};

// ============================================================================
// Dimension Shape
// ============================================================================

/**
 * Dimension shape - a measurement annotation in the drawing
 *
 * Points array meaning varies by dimension type:
 * - linear/aligned: [point1, point2] - the two measured points
 * - angular: [vertex, point1, point2] - vertex and two points defining angle
 * - radius/diameter: [center, pointOnCircle] - center and a point on the arc/circle
 */
export interface DimensionShape extends BaseShape {
  type: 'dimension';

  /** Type of dimension (linear, aligned, angular, radius, diameter) */
  dimensionType: DimensionType;

  /** Reference points in drawing world coordinates */
  points: Point[];

  /** Offset distance from the measured geometry to the dimension line */
  dimensionLineOffset: number;

  /**
   * For linear dimensions: direction of measurement
   * - 'horizontal': measure only horizontal distance
   * - 'vertical': measure only vertical distance
   * - undefined: measure along the dimension line (for aligned)
   */
  linearDirection?: 'horizontal' | 'vertical';

  /** Optional references for associativity - when geometry moves, dimension updates */
  references?: DimensionReference[];

  /** The displayed dimension value (formatted string) */
  value: string;

  /** Whether the value has been manually overridden by user */
  valueOverridden: boolean;

  /** Optional prefix to display before value (e.g., "R" for radius) */
  prefix?: string;

  /** Optional suffix to display after value (e.g., "mm") */
  suffix?: string;

  /** Dimension-specific styling */
  dimensionStyle: DimensionStyle;

  /** Whether this dimension constrains the measured geometry */
  dimensionLocked?: boolean;

  /** Text position offset from default center position (for dragging text) */
  textOffset?: Point;

  /** Individual witness line gap overrides [gap1, gap2] */
  witnessLineGaps?: [number, number];
}

// ============================================================================
// Drawing Preview Types
// ============================================================================

/**
 * Preview state for dimension being drawn
 */
export interface DimensionPreview {
  type: 'dimension';
  dimensionType: DimensionType;
  points: Point[];
  dimensionLineOffset: number;
  linearDirection?: 'horizontal' | 'vertical';
  value: string;
}
