/**
 * Parametric Shapes Type System
 *
 * Defines types for parametric shapes that are defined by parameters rather than
 * fixed geometry. The geometry is generated from parameters and can be regenerated
 * when parameters change.
 *
 * Architecture designed for future extensibility:
 * - Plugin-style template registry
 * - Parameter schema with validation rules (ready for formula support)
 * - Metadata fields for future constraint/relationship data
 */

import type { Point, ShapeStyle } from './geometry';

// ============================================================================
// Parameter System
// ============================================================================

/**
 * Parameter types supported by parametric shapes
 */
export type ParameterType = 'number' | 'string' | 'boolean' | 'select';

/**
 * Parameter definition - describes a single parameter
 */
export interface ParameterDefinition {
  /** Unique identifier for this parameter */
  id: string;
  /** Display name */
  label: string;
  /** Parameter type */
  type: ParameterType;
  /** Default value */
  defaultValue: number | string | boolean;
  /** Unit of measurement (for display) */
  unit?: string;
  /** Minimum value (for numbers) */
  min?: number;
  /** Maximum value (for numbers) */
  max?: number;
  /** Step increment (for numbers) */
  step?: number;
  /** Available options (for select type) */
  options?: { value: string; label: string }[];
  /** Group for organizing in UI */
  group?: string;
  /** Order within group */
  order?: number;
  /** Description/tooltip */
  description?: string;
  /** Whether this parameter is read-only (computed) */
  readOnly?: boolean;
  /**
   * Formula expression (for future use)
   * Example: "height - 2 * flangeThickness"
   */
  formula?: string;
  /**
   * Dependencies - other parameters this one depends on (for future constraint system)
   */
  dependencies?: string[];
}

/**
 * Parameter values - runtime values for a parametric shape
 */
export type ParameterValues = Record<string, number | string | boolean>;

// ============================================================================
// Profile Types (Structural Sections)
// ============================================================================

/**
 * Supported profile types for structural sections
 */
export type ProfileType =
  | 'i-beam'      // I-beam / Wide flange (W-shapes)
  | 'channel'     // C-channel
  | 'angle'       // L-angle (equal or unequal leg)
  | 'tee'         // T-section
  | 'hss-rect'    // Hollow Structural Section - rectangular
  | 'hss-round'   // Hollow Structural Section - round (pipe)
  | 'plate'       // Flat plate
  | 'round-bar'   // Solid round bar
  | 'custom';     // User-defined profile

/**
 * Profile template - defines a parametric profile type
 */
export interface ProfileTemplate {
  /** Unique identifier */
  id: ProfileType;
  /** Display name */
  name: string;
  /** Description */
  description: string;
  /** Category for organization */
  category: 'structural' | 'architectural' | 'mechanical' | 'custom';
  /** Parameter definitions */
  parameters: ParameterDefinition[];
  /**
   * Icon identifier (for UI)
   * Can be a built-in icon name or a custom SVG path
   */
  icon?: string;
  /**
   * Insertion point mode
   * - 'center': Profile is centered on insertion point
   * - 'bottom-center': Bottom edge centered on insertion point
   * - 'top-left': Top-left corner at insertion point
   */
  insertionMode?: 'center' | 'bottom-center' | 'top-left';
}

// ============================================================================
// Standard Profile Library
// ============================================================================

/**
 * Standard profile preset - a pre-defined set of parameter values
 */
export interface ProfilePreset {
  /** Unique identifier (e.g., "W8x31") */
  id: string;
  /** Display name */
  name: string;
  /** Profile type this preset applies to */
  profileType: ProfileType;
  /** Standard/specification (e.g., "AISC", "EN") */
  standard: string;
  /** Category within standard (e.g., "W-Shapes", "S-Shapes") */
  category: string;
  /** Parameter values for this preset */
  parameters: ParameterValues;
  /** Calculated section properties (optional) */
  properties?: SectionProperties;
}

/**
 * Calculated section properties (for structural analysis)
 */
export interface SectionProperties {
  /** Cross-sectional area (mm²) */
  area?: number;
  /** Moment of inertia about X axis (mm⁴) */
  Ix?: number;
  /** Moment of inertia about Y axis (mm⁴) */
  Iy?: number;
  /** Section modulus about X axis (mm³) */
  Sx?: number;
  /** Section modulus about Y axis (mm³) */
  Sy?: number;
  /** Radius of gyration about X axis (mm) */
  rx?: number;
  /** Radius of gyration about Y axis (mm) */
  ry?: number;
  /** Weight per unit length (kg/m) */
  weight?: number;
}

// ============================================================================
// Parametric Shape
// ============================================================================

/**
 * Parametric shape types
 */
export type ParametricShapeType = 'profile' | 'pattern' | 'component';

/**
 * Base parametric shape interface
 */
export interface BaseParametricShape {
  /** Unique identifier */
  id: string;
  /** Parametric shape type */
  parametricType: ParametricShapeType;
  /** Layer this shape belongs to */
  layerId: string;
  /** Drawing this shape belongs to */
  drawingId: string;
  /** Visual style */
  style: ShapeStyle;
  /** Whether shape is visible */
  visible: boolean;
  /** Whether shape is locked from editing */
  locked: boolean;
  /** Insertion point in drawing coordinates */
  position: Point;
  /** Rotation angle in radians */
  rotation: number;
  /** Scale factor (1.0 = 100%) */
  scale: number;
  /** Whether this shape has been exploded into regular shapes */
  exploded?: boolean;
  /**
   * Metadata for future extensibility
   * Can store constraint info, relationships, custom data
   */
  metadata?: Record<string, unknown>;
}

/**
 * Profile parametric shape - structural section profiles
 */
export interface ProfileParametricShape extends BaseParametricShape {
  parametricType: 'profile';
  /** Profile type (i-beam, channel, etc.) */
  profileType: ProfileType;
  /** Parameter values */
  parameters: ParameterValues;
  /** Standard preset ID if using a standard profile */
  presetId?: string;
  /** Standard name (e.g., "AISC", "EN") */
  standard?: string;
  /**
   * Generated geometry cache
   * Stored to avoid regeneration on every render
   * Will be regenerated when parameters change
   */
  generatedGeometry?: GeneratedGeometry;
}

/**
 * Union type for all parametric shapes
 * Will be extended as more parametric shape types are added
 */
export type ParametricShape = ProfileParametricShape;

// ============================================================================
// Geometry Generation
// ============================================================================

/**
 * Arc segment information for explosion
 * Tracks which portions of an outline are arcs (fillets, rounded corners, circles)
 */
export interface ArcSegmentInfo {
  /** Index in outline where arc points start */
  startIndex: number;
  /** Index in outline where arc points end (inclusive) */
  endIndex: number;
  /** Arc center point (in world coordinates after transform) */
  center: Point;
  /** Arc radius */
  radius: number;
  /** Start angle in radians */
  startAngle: number;
  /** End angle in radians */
  endAngle: number;
}

/**
 * Generated geometry from parametric shape
 */
export interface GeneratedGeometry {
  /** Polyline outlines (can be multiple for complex shapes) */
  outlines: Point[][];
  /** Whether each outline is closed */
  closed: boolean[];
  /** Center point (calculated from geometry) */
  center: Point;
  /** Bounding box */
  bounds: {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
  };
  /** Generation timestamp (for cache invalidation) */
  generatedAt: number;
  /** Arc segment information per outline (for proper explosion to arcs) */
  arcSegments?: ArcSegmentInfo[][];
}

/**
 * Geometry generator function type
 */
export type GeometryGenerator = (
  parameters: ParameterValues,
  position: Point,
  rotation: number,
  scale: number
) => GeneratedGeometry;

// ============================================================================
// Registry Types (for plugin architecture)
// ============================================================================

/**
 * Profile template registry entry
 */
export interface ProfileTemplateRegistryEntry {
  template: ProfileTemplate;
  generator: GeometryGenerator;
  presets: ProfilePreset[];
}

/**
 * Profile template registry
 */
export type ProfileTemplateRegistry = Map<ProfileType, ProfileTemplateRegistryEntry>;

// ============================================================================
// UI Types
// ============================================================================

/**
 * Section dialog state
 */
export interface SectionDialogState {
  isOpen: boolean;
  profileType: ProfileType;
  parameters: ParameterValues;
  presetId: string | null;
  standard: string;
  insertionMode: 'dialog' | 'pick';
}

/**
 * Parameter change event
 */
export interface ParameterChangeEvent {
  parameterId: string;
  oldValue: number | string | boolean;
  newValue: number | string | boolean;
  source: 'user' | 'preset' | 'formula';
}
