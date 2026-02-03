/**
 * Custom Hatch Pattern Types
 *
 * Supports both line-based patterns (PAT format compatible) and SVG tile patterns.
 */

/**
 * Pattern type determines how the pattern scales with view/print
 * - 'model': Pattern scales with geometry (real-world dimensions)
 * - 'drafting': Pattern maintains constant appearance regardless of zoom/scale
 */
export type HatchPatternScaleType = 'model' | 'drafting';

/**
 * Source of the pattern
 * - 'builtin': Built-in patterns that come with the application
 * - 'user': User-created patterns (stored in app settings)
 * - 'project': Project-specific patterns (stored with project file)
 * - 'imported': Imported from external file (PAT or SVG)
 */
export type HatchPatternSource = 'builtin' | 'user' | 'project' | 'imported';

/**
 * Original format if pattern was imported
 */
export type HatchPatternFormat = 'pat' | 'svg';

/**
 * Line family definition - defines a set of parallel lines in a hatch pattern
 *
 * Based on AutoCAD/Revit PAT format:
 * angle, x-origin, y-origin, delta-x, delta-y, [dash, gap, dash, gap...]
 */
export interface LineFamily {
  /** Line direction in degrees (0 = horizontal, 90 = vertical, 45 = diagonal) */
  angle: number;

  /** X coordinate of starting point for the line family */
  originX: number;

  /** Y coordinate of starting point for the line family */
  originY: number;

  /** Horizontal shift between successive parallel lines (for staggering, e.g., brick pattern) */
  deltaX: number;

  /** Perpendicular spacing between parallel lines */
  deltaY: number;

  /**
   * Dash pattern array: [dash, gap, dash, gap, ...]
   * - Positive values = dash length
   * - Negative values = gap length
   * - 0 = dot
   * - Empty array or undefined = continuous line
   */
  dashPattern?: number[];

  /** Line thickness (optional, defaults to shape stroke width) */
  strokeWidth?: number;

  /** Line color override (optional, defaults to shape fill color) */
  strokeColor?: string;
}

/**
 * Custom hatch pattern definition
 *
 * Can represent:
 * 1. Simple line-based patterns (like PAT files)
 * 2. Complex SVG tile patterns
 * 3. Both combined (SVG for preview, lines for rendering)
 */
export interface CustomHatchPattern {
  /** Unique identifier */
  id: string;

  /** Display name */
  name: string;

  /** Optional description */
  description?: string;

  /** Pattern scale type (model or drafting) */
  scaleType: HatchPatternScaleType;

  /** Source of the pattern */
  source: HatchPatternSource;

  /** Original import format (if imported) */
  sourceFormat?: HatchPatternFormat;

  /**
   * Line families that make up the pattern
   * For simple patterns like diagonal, this has 1 family
   * For crosshatch, this has 2 families
   * For complex patterns like brick, this may have multiple families
   */
  lineFamilies: LineFamily[];

  /**
   * SVG content for preview (optional)
   * Used for displaying in pattern picker and for complex patterns
   */
  svgPreview?: string;

  /** Created timestamp */
  createdAt?: string;

  /** Last modified timestamp */
  modifiedAt?: string;
}

/**
 * SVG-based hatch pattern (for complex patterns that can't be expressed as line families)
 *
 * These patterns are rendered by tiling an SVG image
 */
export interface SvgHatchPattern extends CustomHatchPattern {
  /** SVG content of the repeating tile */
  svgTile: string;

  /** Tile width in pattern units */
  tileWidth: number;

  /** Tile height in pattern units */
  tileHeight: number;

  /** Optional rotation of the entire tile pattern */
  tileRotation?: number;
}

/**
 * Type guard to check if a pattern is SVG-based
 */
export function isSvgHatchPattern(pattern: CustomHatchPattern): pattern is SvgHatchPattern {
  return 'svgTile' in pattern && typeof (pattern as SvgHatchPattern).svgTile === 'string';
}

/**
 * Built-in pattern IDs (for backward compatibility)
 */
export type BuiltinPatternId = 'solid' | 'diagonal' | 'crosshatch' | 'horizontal' | 'vertical' | 'dots';

/**
 * Built-in patterns converted to CustomHatchPattern format
 */
export const BUILTIN_PATTERNS: CustomHatchPattern[] = [
  {
    id: 'solid',
    name: 'Solid',
    description: 'Solid fill with no pattern lines',
    scaleType: 'drafting',
    source: 'builtin',
    lineFamilies: [], // Empty = solid fill
  },
  {
    id: 'diagonal',
    name: 'Diagonal',
    description: 'Diagonal lines at 45 degrees',
    scaleType: 'drafting',
    source: 'builtin',
    lineFamilies: [
      { angle: 45, originX: 0, originY: 0, deltaX: 0, deltaY: 10 },
    ],
  },
  {
    id: 'crosshatch',
    name: 'Crosshatch',
    description: 'Two sets of diagonal lines forming a cross pattern',
    scaleType: 'drafting',
    source: 'builtin',
    lineFamilies: [
      { angle: 45, originX: 0, originY: 0, deltaX: 0, deltaY: 10 },
      { angle: -45, originX: 0, originY: 0, deltaX: 0, deltaY: 10 },
    ],
  },
  {
    id: 'horizontal',
    name: 'Horizontal',
    description: 'Horizontal parallel lines',
    scaleType: 'drafting',
    source: 'builtin',
    lineFamilies: [
      { angle: 0, originX: 0, originY: 0, deltaX: 0, deltaY: 10 },
    ],
  },
  {
    id: 'vertical',
    name: 'Vertical',
    description: 'Vertical parallel lines',
    scaleType: 'drafting',
    source: 'builtin',
    lineFamilies: [
      { angle: 90, originX: 0, originY: 0, deltaX: 0, deltaY: 10 },
    ],
  },
  {
    id: 'dots',
    name: 'Dots',
    description: 'Regular grid of dots',
    scaleType: 'drafting',
    source: 'builtin',
    lineFamilies: [
      // Dots are represented as very short dashes (essentially points)
      { angle: 0, originX: 0, originY: 0, deltaX: 10, deltaY: 10, dashPattern: [0] },
    ],
  },
];

/**
 * Get a built-in pattern by ID
 */
export function getBuiltinPattern(id: BuiltinPatternId): CustomHatchPattern | undefined {
  return BUILTIN_PATTERNS.find(p => p.id === id);
}

/**
 * Check if a pattern ID refers to a built-in pattern
 */
export function isBuiltinPatternId(id: string): id is BuiltinPatternId {
  return BUILTIN_PATTERNS.some(p => p.id === id);
}

/**
 * Hatch patterns store state for user and project patterns
 */
export interface HatchPatternsState {
  /** User-defined patterns (persistent across sessions) */
  userPatterns: CustomHatchPattern[];

  /** Project-specific patterns (saved with project file) */
  projectPatterns: CustomHatchPattern[];
}

/**
 * Default empty hatch patterns state
 */
export const DEFAULT_HATCH_PATTERNS_STATE: HatchPatternsState = {
  userPatterns: [],
  projectPatterns: [],
};
