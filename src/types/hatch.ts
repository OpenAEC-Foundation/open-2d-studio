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
 * Pattern category for organizing patterns in the picker
 */
export type PatternCategory = 'basic' | 'hatching' | 'material' | 'geometric' | 'custom';

/**
 * Original format if pattern was imported
 */
export type HatchPatternFormat = 'pat' | 'svg';

/**
 * Line family definition - defines a set of parallel lines in a hatch pattern
 *
 * Based on industry-standard PAT format:
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

  /** Category for organizing in the pattern picker */
  category?: PatternCategory;
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
export type BuiltinPatternId =
  | 'solid' | 'diagonal' | 'crosshatch' | 'horizontal' | 'vertical' | 'dots'
  // Material
  | 'concrete' | 'brick-running' | 'brick-stack' | 'insulation' | 'earth' | 'sand' | 'gravel' | 'water' | 'clay'
  // Wood
  | 'wood-grain' | 'plywood' | 'timber-section'
  // Metal
  | 'steel-section' | 'aluminum'
  // Masonry
  | 'stone-block' | 'cut-stone'
  // Geometric
  | 'diamonds' | 'herringbone' | 'basket-weave' | 'zigzag'
  // NEN 47 / INB-template patterns (Dutch structural drawing standard)
  | 'nen47-metselwerk-baksteen'
  | 'nen47-speciale-steenachtige'
  | 'nen47-metselwerk-kunststeen'
  | 'nen47-lichte-scheidingswand'
  | 'nen47-gewapend-beton'
  | 'nen47-beton-prefab'
  | 'nen47-ongewapend-beton'
  | 'nen47-sierbeton'
  | 'nen47-natuursteen'
  | 'nen47-enkele-afwerking'
  | 'nen47-samengestelde-afwerking'
  | 'nen47-naaldhout'
  | 'nen47-loofhout'
  | 'nen47-hout-langs'
  | 'nen47-bekledingsplaat'
  | 'nen47-isolatie'
  | 'nen47-staal'
  | 'nen47-aluminium'
  | 'nen47-kunststof'
  | 'nen47-afdichtingsmiddel'
  | 'nen47-maaiveld';

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
    category: 'basic',
    lineFamilies: [], // Empty = solid fill
  },
  {
    id: 'diagonal',
    name: 'Diagonal',
    description: 'Diagonal lines at 45 degrees',
    scaleType: 'drafting',
    source: 'builtin',
    category: 'hatching',
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
    category: 'hatching',
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
    category: 'basic',
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
    category: 'basic',
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
    category: 'hatching',
    lineFamilies: [
      { angle: 0, originX: 0, originY: 0, deltaX: 10, deltaY: 10, dashPattern: [0] },
    ],
  },

  // =========================================================================
  // Material Patterns
  // =========================================================================
  {
    id: 'concrete',
    name: 'Concrete',
    description: 'Concrete section - random dots and short dashes',
    scaleType: 'drafting',
    source: 'builtin',
    category: 'material',
    lineFamilies: [
      { angle: 37, originX: 0, originY: 0, deltaX: 3, deltaY: 8, dashPattern: [0] },
      { angle: 127, originX: 5, originY: 3, deltaX: 5, deltaY: 12, dashPattern: [0] },
      { angle: 70, originX: 2, originY: 7, deltaX: 7, deltaY: 10, dashPattern: [0] },
    ],
  },
  {
    id: 'brick-running',
    name: 'Brick Running Bond',
    description: 'Brick pattern with staggered rows',
    scaleType: 'model',
    source: 'builtin',
    category: 'material',
    lineFamilies: [
      { angle: 0, originX: 0, originY: 0, deltaX: 0, deltaY: 10 },
      { angle: 90, originX: 0, originY: 0, deltaX: 20, deltaY: 20, dashPattern: [10, -10] },
    ],
  },
  {
    id: 'brick-stack',
    name: 'Brick Stack Bond',
    description: 'Brick pattern with aligned vertical joints',
    scaleType: 'model',
    source: 'builtin',
    category: 'material',
    lineFamilies: [
      { angle: 0, originX: 0, originY: 0, deltaX: 0, deltaY: 10 },
      { angle: 90, originX: 0, originY: 0, deltaX: 0, deltaY: 20, dashPattern: [10, -10] },
    ],
  },
  {
    id: 'insulation',
    name: 'Insulation',
    description: 'Insulation batt pattern with zigzag lines at 60 degrees',
    scaleType: 'drafting',
    source: 'builtin',
    category: 'material',
    lineFamilies: [
      { angle: 60, originX: 0, originY: 0, deltaX: 0, deltaY: 6 },
      { angle: -60, originX: 0, originY: 0, deltaX: 0, deltaY: 6 },
    ],
  },
  {
    id: 'earth',
    name: 'Earth',
    description: 'Earth/soil section pattern',
    scaleType: 'drafting',
    source: 'builtin',
    category: 'material',
    lineFamilies: [
      { angle: 45, originX: 0, originY: 0, deltaX: 0, deltaY: 12, dashPattern: [6, -3, 2, -3] },
      { angle: 0, originX: 0, originY: 0, deltaX: 6, deltaY: 10, dashPattern: [0] },
    ],
  },
  {
    id: 'sand',
    name: 'Sand',
    description: 'Sand pattern - scattered dots',
    scaleType: 'drafting',
    source: 'builtin',
    category: 'material',
    lineFamilies: [
      { angle: 0, originX: 0, originY: 0, deltaX: 6, deltaY: 6, dashPattern: [0] },
      { angle: 60, originX: 3, originY: 2, deltaX: 6, deltaY: 8, dashPattern: [0] },
      { angle: 120, originX: 1, originY: 4, deltaX: 8, deltaY: 7, dashPattern: [0] },
    ],
  },
  {
    id: 'gravel',
    name: 'Gravel',
    description: 'Gravel/aggregate pattern',
    scaleType: 'drafting',
    source: 'builtin',
    category: 'material',
    lineFamilies: [
      { angle: 30, originX: 0, originY: 0, deltaX: 4, deltaY: 12, dashPattern: [3, -5] },
      { angle: -30, originX: 6, originY: 0, deltaX: 4, deltaY: 12, dashPattern: [2, -6] },
      { angle: 80, originX: 2, originY: 4, deltaX: 6, deltaY: 10, dashPattern: [0] },
    ],
  },
  {
    id: 'water',
    name: 'Water',
    description: 'Water section - horizontal wavy lines',
    scaleType: 'drafting',
    source: 'builtin',
    category: 'material',
    lineFamilies: [
      { angle: 0, originX: 0, originY: 0, deltaX: 0, deltaY: 8 },
      { angle: 0, originX: 0, originY: 4, deltaX: 0, deltaY: 16, dashPattern: [8, -4] },
    ],
  },
  {
    id: 'clay',
    name: 'Clay',
    description: 'Clay section pattern',
    scaleType: 'drafting',
    source: 'builtin',
    category: 'material',
    lineFamilies: [
      { angle: 0, originX: 0, originY: 0, deltaX: 0, deltaY: 6, dashPattern: [12, -4] },
      { angle: 0, originX: 8, originY: 3, deltaX: 0, deltaY: 6, dashPattern: [6, -10] },
    ],
  },

  // =========================================================================
  // Wood Patterns
  // =========================================================================
  {
    id: 'wood-grain',
    name: 'Wood Grain',
    description: 'Wood grain lines at varying spacing',
    scaleType: 'model',
    source: 'builtin',
    category: 'material',
    lineFamilies: [
      { angle: 0, originX: 0, originY: 0, deltaX: 0, deltaY: 5 },
      { angle: 0, originX: 0, originY: 2, deltaX: 0, deltaY: 12, dashPattern: [15, -8] },
    ],
  },
  {
    id: 'plywood',
    name: 'Plywood',
    description: 'Plywood cross-section with alternating grain',
    scaleType: 'model',
    source: 'builtin',
    category: 'material',
    lineFamilies: [
      { angle: 0, originX: 0, originY: 0, deltaX: 0, deltaY: 4 },
      { angle: 90, originX: 0, originY: 0, deltaX: 0, deltaY: 15, dashPattern: [4, -8] },
    ],
  },
  {
    id: 'timber-section',
    name: 'Timber Section',
    description: 'Timber cross-section with diagonal lines',
    scaleType: 'model',
    source: 'builtin',
    category: 'material',
    lineFamilies: [
      { angle: 45, originX: 0, originY: 0, deltaX: 0, deltaY: 5 },
      { angle: -45, originX: 0, originY: 0, deltaX: 0, deltaY: 10, dashPattern: [3, -7] },
    ],
  },

  // =========================================================================
  // Metal Patterns
  // =========================================================================
  {
    id: 'steel-section',
    name: 'Steel Section',
    description: 'Steel cross-section with dense diagonal lines',
    scaleType: 'drafting',
    source: 'builtin',
    category: 'material',
    lineFamilies: [
      { angle: 45, originX: 0, originY: 0, deltaX: 0, deltaY: 3 },
    ],
  },
  {
    id: 'aluminum',
    name: 'Aluminum',
    description: 'Aluminum section pattern',
    scaleType: 'drafting',
    source: 'builtin',
    category: 'material',
    lineFamilies: [
      { angle: 45, originX: 0, originY: 0, deltaX: 0, deltaY: 3 },
      { angle: 45, originX: 0, originY: 1.5, deltaX: 0, deltaY: 6, dashPattern: [4, -4] },
    ],
  },

  // =========================================================================
  // Masonry Patterns
  // =========================================================================
  {
    id: 'stone-block',
    name: 'Stone Block',
    description: 'Rough stone block pattern',
    scaleType: 'model',
    source: 'builtin',
    category: 'material',
    lineFamilies: [
      { angle: 0, originX: 0, originY: 0, deltaX: 0, deltaY: 20 },
      { angle: 90, originX: 0, originY: 0, deltaX: 30, deltaY: 40, dashPattern: [20, -20] },
      { angle: 45, originX: 5, originY: 5, deltaX: 10, deltaY: 20, dashPattern: [3, -17] },
    ],
  },
  {
    id: 'cut-stone',
    name: 'Cut Stone',
    description: 'Dressed/cut stone pattern',
    scaleType: 'model',
    source: 'builtin',
    category: 'material',
    lineFamilies: [
      { angle: 0, originX: 0, originY: 0, deltaX: 0, deltaY: 15 },
      { angle: 90, originX: 0, originY: 0, deltaX: 25, deltaY: 30, dashPattern: [15, -15] },
    ],
  },

  // =========================================================================
  // Geometric Patterns
  // =========================================================================
  {
    id: 'diamonds',
    name: 'Diamonds',
    description: 'Diamond/rhombus grid pattern',
    scaleType: 'drafting',
    source: 'builtin',
    category: 'geometric',
    lineFamilies: [
      { angle: 60, originX: 0, originY: 0, deltaX: 0, deltaY: 10 },
      { angle: -60, originX: 0, originY: 0, deltaX: 0, deltaY: 10 },
    ],
  },
  {
    id: 'herringbone',
    name: 'Herringbone',
    description: 'Herringbone / chevron pattern',
    scaleType: 'drafting',
    source: 'builtin',
    category: 'geometric',
    lineFamilies: [
      { angle: 45, originX: 0, originY: 0, deltaX: 10, deltaY: 10, dashPattern: [10, -10] },
      { angle: -45, originX: 0, originY: 0, deltaX: 10, deltaY: 10, dashPattern: [10, -10] },
    ],
  },
  {
    id: 'basket-weave',
    name: 'Basket Weave',
    description: 'Alternating horizontal and vertical segments',
    scaleType: 'drafting',
    source: 'builtin',
    category: 'geometric',
    lineFamilies: [
      { angle: 0, originX: 0, originY: 0, deltaX: 20, deltaY: 10, dashPattern: [10, -10] },
      { angle: 90, originX: 10, originY: 0, deltaX: 10, deltaY: 20, dashPattern: [10, -10] },
    ],
  },
  {
    id: 'zigzag',
    name: 'Zigzag',
    description: 'Zigzag / sawtooth pattern',
    scaleType: 'drafting',
    source: 'builtin',
    category: 'geometric',
    lineFamilies: [
      { angle: 60, originX: 0, originY: 0, deltaX: 10, deltaY: 12, dashPattern: [7, -5] },
      { angle: -60, originX: 5, originY: 0, deltaX: 10, deltaY: 12, dashPattern: [7, -5] },
    ],
  },

  // =========================================================================
  // NEN 47 / INB-template Patterns (Dutch structural drawing standard)
  // Based on patterns.svg from INB-Template/drawings/assets
  // =========================================================================

  // NEN47 1 - Metselwerk baksteen (brick masonry)
  // Two diagonal lines close together at 45deg, simulating brick pattern
  {
    id: 'nen47-metselwerk-baksteen',
    name: 'NEN47-1 Metselwerk baksteen',
    description: 'Brick masonry per NEN 47 - two close diagonal lines at 45 degrees',
    scaleType: 'drafting',
    source: 'builtin',
    category: 'material',
    lineFamilies: [
      { angle: 45, originX: 0, originY: 0, deltaX: 0, deltaY: 3 },
      { angle: 45, originX: 0, originY: 0.5, deltaX: 0, deltaY: 3 },
    ],
  },

  // NEN47 2 - Speciale steenachtige materialen (special stone-like materials)
  // Crosshatch at 45deg
  {
    id: 'nen47-speciale-steenachtige',
    name: 'NEN47-2 Speciale steenachtige materialen',
    description: 'Special stone-like materials per NEN 47 - crosshatch at 45 degrees',
    scaleType: 'drafting',
    source: 'builtin',
    category: 'material',
    lineFamilies: [
      { angle: 45, originX: 0, originY: 0, deltaX: 0, deltaY: 2 },
      { angle: -45, originX: 0, originY: 0, deltaX: 0, deltaY: 2 },
    ],
  },

  // NEN47 3 - Metselwerk niet gebakken kunststeen (kalkzandsteen / calcium silicate)
  // Single diagonal at 45deg
  {
    id: 'nen47-metselwerk-kunststeen',
    name: 'NEN47-3 Metselwerk kunststeen',
    description: 'Calcium silicate / artificial stone masonry per NEN 47 - single diagonal at 45 degrees',
    scaleType: 'drafting',
    source: 'builtin',
    category: 'material',
    lineFamilies: [
      { angle: 45, originX: 0, originY: 0, deltaX: 0, deltaY: 1.5 },
    ],
  },

  // NEN47 4 - Niet dragende lichte scheidingswanden (non-structural lightweight partition walls)
  // Dense vertical lines (0deg rotation, vertical lines with 0.5 spacing)
  {
    id: 'nen47-lichte-scheidingswand',
    name: 'NEN47-4 Lichte scheidingswand',
    description: 'Non-structural lightweight partition wall per NEN 47 - dense vertical lines',
    scaleType: 'drafting',
    source: 'builtin',
    category: 'material',
    lineFamilies: [
      { angle: 90, originX: 0, originY: 0, deltaX: 0, deltaY: 0.5 },
    ],
  },

  // NEN47 5 - Gewapend beton ter plaatse gestort (reinforced cast-in-place concrete)
  // Solid gray fill (#C0C0C0)
  {
    id: 'nen47-gewapend-beton',
    name: 'NEN47-5 Gewapend beton (TPG)',
    description: 'Reinforced cast-in-place concrete per NEN 47 - solid gray fill',
    scaleType: 'drafting',
    source: 'builtin',
    category: 'material',
    lineFamilies: [], // Empty = solid fill; hatch color should be #C0C0C0
  },

  // NEN47 6 - Gewapend beton prefab (precast concrete)
  // Single diagonal at 45deg (same as kunststeen but different material context)
  {
    id: 'nen47-beton-prefab',
    name: 'NEN47-6 Gewapend beton prefab',
    description: 'Precast reinforced concrete per NEN 47 - single diagonal at 45 degrees',
    scaleType: 'drafting',
    source: 'builtin',
    category: 'material',
    lineFamilies: [
      { angle: 45, originX: 0, originY: 0, deltaX: 0, deltaY: 1.5 },
    ],
  },

  // NEN47 7 - Ongewapend beton (unreinforced concrete)
  // Crosshatch at 45deg
  {
    id: 'nen47-ongewapend-beton',
    name: 'NEN47-7 Ongewapend beton',
    description: 'Unreinforced concrete per NEN 47 - crosshatch at 45 degrees',
    scaleType: 'drafting',
    source: 'builtin',
    category: 'material',
    lineFamilies: [
      { angle: 45, originX: 0, originY: 0, deltaX: 0, deltaY: 3 },
      { angle: -45, originX: 0, originY: 0, deltaX: 0, deltaY: 3 },
    ],
  },

  // NEN47 8 - Sierbeton (decorative concrete)
  // Lines at 135deg with staggered half-length dashes
  {
    id: 'nen47-sierbeton',
    name: 'NEN47-8 Sierbeton',
    description: 'Decorative concrete per NEN 47 - staggered dashes at 135 degrees',
    scaleType: 'drafting',
    source: 'builtin',
    category: 'material',
    lineFamilies: [
      { angle: 135, originX: 0, originY: 0, deltaX: 0, deltaY: 3 },
      { angle: 135, originX: 0, originY: 1.5, deltaX: 0, deltaY: 3, dashPattern: [1.5, -1.5] },
    ],
  },

  // NEN47 9 - Natuursteen (natural stone)
  // Lines at 135deg with fine staggered dashes
  {
    id: 'nen47-natuursteen',
    name: 'NEN47-9 Natuursteen',
    description: 'Natural stone per NEN 47 - fine staggered dashes at 135 degrees',
    scaleType: 'drafting',
    source: 'builtin',
    category: 'material',
    lineFamilies: [
      { angle: 135, originX: 0, originY: 0, deltaX: 0, deltaY: 1.5, strokeWidth: 0.15 },
      { angle: 135, originX: 0, originY: 0.75, deltaX: 0, deltaY: 1.5, dashPattern: [0.75, -0.75], strokeWidth: 0.15 },
    ],
  },

  // NEN47 10 - Enkele wand/vloer afwerking (single wall/floor finish)
  // Zigzag pattern (V-shapes)
  {
    id: 'nen47-enkele-afwerking',
    name: 'NEN47-10 Enkele wand/vloer afwerking',
    description: 'Single wall/floor finish per NEN 47 - zigzag pattern',
    scaleType: 'drafting',
    source: 'builtin',
    category: 'material',
    lineFamilies: [
      { angle: 45, originX: 0, originY: 0, deltaX: 3, deltaY: 3, dashPattern: [4.24, -4.24] },
      { angle: -45, originX: 3, originY: 0, deltaX: 3, deltaY: 3, dashPattern: [4.24, -4.24] },
    ],
  },

  // NEN47 11 - Samengestelde wand/vloer afwerking (composite wall/floor finish)
  // Zigzag + horizontal line
  {
    id: 'nen47-samengestelde-afwerking',
    name: 'NEN47-11 Samengestelde wand/vloer afwerking',
    description: 'Composite wall/floor finish per NEN 47 - zigzag with horizontal line',
    scaleType: 'drafting',
    source: 'builtin',
    category: 'material',
    lineFamilies: [
      { angle: 45, originX: 0, originY: 0, deltaX: 3, deltaY: 3, dashPattern: [4.24, -4.24] },
      { angle: -45, originX: 3, originY: 0, deltaX: 3, deltaY: 3, dashPattern: [4.24, -4.24] },
      { angle: 0, originX: 0, originY: 2, deltaX: 0, deltaY: 3 },
    ],
  },

  // NEN47 12 - Naaldhout (softwood)
  // Single diagonal at 45deg
  {
    id: 'nen47-naaldhout',
    name: 'NEN47-12 Naaldhout',
    description: 'Softwood timber per NEN 47 - single diagonal at 45 degrees',
    scaleType: 'drafting',
    source: 'builtin',
    category: 'material',
    lineFamilies: [
      { angle: 45, originX: 0, originY: 0, deltaX: 0, deltaY: 1.5 },
    ],
  },

  // NEN47 13 - Loofhout (hardwood)
  // Crosshatch at 45deg with fine line spacing
  {
    id: 'nen47-loofhout',
    name: 'NEN47-13 Loofhout',
    description: 'Hardwood timber per NEN 47 - crosshatch at 45 degrees',
    scaleType: 'drafting',
    source: 'builtin',
    category: 'material',
    lineFamilies: [
      { angle: 45, originX: 0, originY: 0, deltaX: 0, deltaY: 1.5 },
      { angle: -45, originX: 0, originY: 0, deltaX: 0, deltaY: 1.5 },
    ],
  },

  // NEN47 14 - Naald/loofhout langsarcering (timber longitudinal hatching)
  // Horizontal lines
  {
    id: 'nen47-hout-langs',
    name: 'NEN47-14 Hout langsarcering',
    description: 'Timber longitudinal hatching per NEN 47 - horizontal lines',
    scaleType: 'drafting',
    source: 'builtin',
    category: 'material',
    lineFamilies: [
      { angle: 0, originX: 0, originY: 0, deltaX: 0, deltaY: 1.5 },
    ],
  },

  // NEN47 16 - Bekledingsplaat (cladding board)
  // Vertical lines (90deg rotation)
  {
    id: 'nen47-bekledingsplaat',
    name: 'NEN47-16 Bekledingsplaat',
    description: 'Cladding board per NEN 47 - vertical lines',
    scaleType: 'drafting',
    source: 'builtin',
    category: 'material',
    lineFamilies: [
      { angle: 90, originX: 0, originY: 0, deltaX: 0, deltaY: 1.5 },
    ],
  },

  // NEN47 17 - Isolatie (insulation)
  // Zigzag diagonal lines at 60 degrees (NEN standard insulation hatch)
  {
    id: 'nen47-isolatie',
    name: 'NEN47-17 Isolatie',
    description: 'Insulation per NEN 47 - zigzag diagonal lines at 60 degrees',
    scaleType: 'drafting',
    source: 'builtin',
    category: 'material',
    lineFamilies: [
      { angle: 60, originX: 0, originY: 0, deltaX: 0, deltaY: 1.5 },
      { angle: -60, originX: 0, originY: 0, deltaX: 0, deltaY: 1.5 },
    ],
  },

  // NEN47 18 - Staal (steel)
  // Solid black fill
  {
    id: 'nen47-staal',
    name: 'NEN47-18 Staal',
    description: 'Steel per NEN 47 - solid black fill',
    scaleType: 'drafting',
    source: 'builtin',
    category: 'material',
    lineFamilies: [], // Empty = solid fill; hatch color should be #000000
  },

  // NEN47 19 - Aluminium, brons, koper (aluminum, bronze, copper)
  // Solid gray fill (#C0C0C0)
  {
    id: 'nen47-aluminium',
    name: 'NEN47-19 Aluminium/brons/koper',
    description: 'Aluminum, bronze, or copper per NEN 47 - solid gray fill',
    scaleType: 'drafting',
    source: 'builtin',
    category: 'material',
    lineFamilies: [], // Empty = solid fill; hatch color should be #C0C0C0
  },

  // NEN47 22 - Kunststof (plastic/synthetic material)
  // Single diagonal at 45deg
  {
    id: 'nen47-kunststof',
    name: 'NEN47-22 Kunststof',
    description: 'Plastic/synthetic material per NEN 47 - single diagonal at 45 degrees',
    scaleType: 'drafting',
    source: 'builtin',
    category: 'material',
    lineFamilies: [
      { angle: 45, originX: 0, originY: 0, deltaX: 0, deltaY: 1.5 },
    ],
  },

  // NEN47 23 - Afdichtingsmiddel (sealant)
  // Scattered dots
  {
    id: 'nen47-afdichtingsmiddel',
    name: 'NEN47-23 Afdichtingsmiddel',
    description: 'Sealant per NEN 47 - scattered dots',
    scaleType: 'drafting',
    source: 'builtin',
    category: 'material',
    lineFamilies: [
      { angle: 37, originX: 0, originY: 0, deltaX: 3, deltaY: 8, dashPattern: [0] },
      { angle: 127, originX: 5, originY: 3, deltaX: 5, deltaY: 12, dashPattern: [0] },
      { angle: 70, originX: 2, originY: 7, deltaX: 7, deltaY: 10, dashPattern: [0] },
    ],
  },

  // NEN47 25 - Maaiveld (ground level)
  // Chevron/zigzag pattern (V-shapes pointing down)
  {
    id: 'nen47-maaiveld',
    name: 'NEN47-25 Maaiveld',
    description: 'Ground level per NEN 47 - chevron zigzag pattern',
    scaleType: 'drafting',
    source: 'builtin',
    category: 'material',
    lineFamilies: [
      { angle: 45, originX: 0, originY: 0, deltaX: 0, deltaY: 2.5 },
      { angle: -45, originX: 0, originY: 0, deltaX: 0, deltaY: 2.5 },
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

// ============================================================================
// Material-Hatch Template
// ============================================================================

/**
 * A reusable template that maps a material category to a specific hatch pattern.
 * Templates can be saved/loaded to apply consistent standards across projects.
 */
export interface MaterialHatchTemplate {
  id: string;
  name: string;
  /** Material category this template applies to */
  material: import('./geometry').MaterialCategory;
  /** Reference to a custom hatch pattern ID (from BUILTIN_PATTERNS or custom) */
  hatchPatternId?: string;
  /** Fallback basic hatch type if no custom pattern */
  hatchType: 'diagonal' | 'crosshatch' | 'horizontal' | 'none';
  hatchAngle: number;
  hatchSpacing: number;
  hatchColor?: string;
  /** Whether this is a built-in template */
  isBuiltIn?: boolean;
}

// ============================================================================
// Material Hatch Settings (Drawing Standards)
// ============================================================================

/**
 * Hatch settings for a single material category.
 * Used in Drawing Standards to define how each material is hatched.
 */
export interface MaterialHatchSetting {
  hatchType: 'diagonal' | 'crosshatch' | 'horizontal' | 'vertical' | 'dots' | 'solid' | 'none';
  hatchAngle: number;
  hatchSpacing: number;
  hatchColor?: string;
  hatchPatternId?: string;
  /** Solid background color rendered UNDER hatch pattern lines */
  backgroundColor?: string;
}

/**
 * Map of material category to its hatch settings.
 * Managed in Drawing Standards and used by the renderer at render time.
 */
export type MaterialHatchSettings = Record<string, MaterialHatchSetting>;

// ============================================================================
// Drawing Standards Preset
// ============================================================================

/**
 * A named preset that stores all Drawing Standards settings.
 * Users can save, load, rename, and delete presets to quickly switch
 * between different standards configurations.
 */
export interface DrawingStandardsPreset {
  /** Unique identifier */
  id: string;
  /** Display name (e.g. "NEN-EN (Default)") */
  name: string;
  /** Whether this is a built-in preset that cannot be deleted */
  isDefault?: boolean;
  /** Gridline extension distance in mm */
  gridlineExtension: number;
  /** Offset between dimension line rows for grid dimensioning (mm). Default 200. */
  gridDimensionLineOffset: number;
  /** Material hatch settings for all categories */
  materialHatchSettings: MaterialHatchSettings;
  /** Whether to show dimension text between gridlines in section views. Default true. */
  sectionGridlineDimensioning?: boolean;
  /** Auto-number and label piles sequentially */
  pilePlanAutoNumbering?: boolean;
  /** Auto-create dimensions at pile positions */
  pilePlanAutoDimensioning?: boolean;
  /** Auto-show pile depth labels */
  pilePlanAutoDepthLabel?: boolean;
  /** Per-plan-subtype display settings */
  planSubtypeSettings?: PlanSubtypeSettings;
  /** Pile type definitions */
  pileTypes?: import('./geometry').PileTypeDefinition[];
}

// ============================================================================
// Plan Subtype Settings
// ============================================================================

export interface PilePlanDisplaySettings {
  showPileTable: boolean;
  pileLabelFontSize: number;
  showPileGridReferences: boolean;
}

/** Beam label font size per drawing scale (mm on paper) */
export interface BeamLabelScaleSettings {
  /** Font size at 1:100 (default 1.8mm) */
  scale100: number;
  /** Font size at 1:50 and smaller (default 2.5mm) */
  scale50: number;
}

export interface StructuralPlanDisplaySettings {
  showBeamCenterlines: boolean;
  showColumnGridMarks: boolean;
  showSlabEdges: boolean;
  beamLabelStyle: 'profile-only' | 'profile+material' | 'full';
  showLoadArrows: boolean;
  /** Whether slabs show their surface (hatch) pattern. Default false for structural plans. */
  showSlabSurfacePattern: boolean;
  /** How slab openings are rendered: 'cross' (default), 'diagonal', or 'outline'. */
  openingDisplayStyle: 'cross' | 'diagonal' | 'outline';
  /** Beam label font size settings per drawing scale */
  beamLabelFontSize?: BeamLabelScaleSettings;
  /** Distance from beam start point to the label along the beam direction (mm). Default 1000. */
  beamLabelStartDistance?: number;
}

export interface FloorPlanDisplaySettings {
  showRoomLabels: boolean;
  showDoorSwingArcs: boolean;
  showWallDimensions: boolean;
  showFurniture: boolean;
  showAreaLabels: boolean;
}

export interface AreaPlanDisplaySettings {
  showAreaBoundaries: boolean;
  showAreaLabels: boolean;
  showAreaValues: boolean;
  showColorCoding: boolean;
}

export interface PlanSubtypeSettings {
  pilePlan: PilePlanDisplaySettings;
  structuralPlan: StructuralPlanDisplaySettings;
  floorPlan: FloorPlanDisplaySettings;
  areaPlan: AreaPlanDisplaySettings;
}

export const DEFAULT_PLAN_SUBTYPE_SETTINGS: PlanSubtypeSettings = {
  pilePlan: {
    showPileTable: true,
    pileLabelFontSize: 8,
    showPileGridReferences: true,
  },
  structuralPlan: {
    showBeamCenterlines: true,
    showColumnGridMarks: true,
    showSlabEdges: true,
    beamLabelStyle: 'profile-only',
    showLoadArrows: false,
    showSlabSurfacePattern: false,
    openingDisplayStyle: 'cross',
    beamLabelFontSize: { scale100: 1.8, scale50: 2.5 },
    beamLabelStartDistance: 1000,
  },
  floorPlan: {
    showRoomLabels: true,
    showDoorSwingArcs: true,
    showWallDimensions: false,
    showFurniture: true,
    showAreaLabels: false,
  },
  areaPlan: {
    showAreaBoundaries: true,
    showAreaLabels: true,
    showAreaValues: true,
    showColorCoding: true,
  },
};

/**
 * Default material hatch settings with sensible defaults for each material category.
 */
export const DEFAULT_MATERIAL_HATCH_SETTINGS: MaterialHatchSettings = {
  concrete: { hatchType: 'solid', hatchAngle: 0, hatchSpacing: 50, hatchColor: '#C0C0C0', hatchPatternId: 'nen47-gewapend-beton' },
  masonry: { hatchType: 'diagonal', hatchAngle: 45, hatchSpacing: 800, hatchColor: '#000000', hatchPatternId: 'nen47-metselwerk-baksteen', backgroundColor: '#D4908F' },
  'calcium-silicate': { hatchType: 'diagonal', hatchAngle: 45, hatchSpacing: 800, hatchColor: '#A8A090', hatchPatternId: 'nen47-metselwerk-kunststeen', backgroundColor: '#C8C0B0' },
  timber: { hatchType: 'diagonal', hatchAngle: 45, hatchSpacing: 750, hatchColor: '#000000', hatchPatternId: 'nen47-naaldhout', backgroundColor: '#F0DCB9' },
  steel: { hatchType: 'solid', hatchAngle: 0, hatchSpacing: 20, hatchColor: '#000000', hatchPatternId: 'nen47-staal' },
  insulation: { hatchType: 'crosshatch', hatchAngle: 60, hatchSpacing: 100, hatchColor: '#000000', hatchPatternId: 'nen47-isolatie', backgroundColor: '#FFFDE0' },
  generic: { hatchType: 'diagonal', hatchAngle: 45, hatchSpacing: 60, hatchColor: '#808080' },
};
