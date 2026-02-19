// Core geometry types for the CAD engine

export interface Point {
  x: number;
  y: number;
}

export interface BoundingBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export type LineStyle = 'solid' | 'dashed' | 'dotted' | 'dashdot';

export interface ShapeStyle {
  strokeColor: string;
  strokeWidth: number;
  lineStyle: LineStyle;
  fillColor?: string;
}

// Base shape interface
export interface BaseShape {
  id: string;
  type: ShapeType;
  layerId: string;
  drawingId: string;  // Which drawing this shape belongs to
  style: ShapeStyle;
  visible: boolean;
  locked: boolean;
  groupId?: string;   // Optional group membership
}

// Shape group definition
export interface ShapeGroup {
  id: string;
  name?: string;
  drawingId: string;  // Which drawing this group belongs to
}

/** @deprecated Use drawingId instead */
export type BaseShapeWithDraftId = BaseShape & { draftId?: string };

export type ShapeType = 'line' | 'rectangle' | 'circle' | 'arc' | 'polyline' | 'ellipse' | 'spline' | 'text' | 'point' | 'dimension' | 'hatch' | 'beam' | 'image' | 'gridline' | 'level' | 'pile' | 'wall' | 'slab' | 'section-callout' | 'space' | 'plate-system' | 'cpt' | 'foundation-zone' | 'spot-elevation' | 'block-instance';

export type HatchPatternType = 'solid' | 'diagonal' | 'crosshatch' | 'horizontal' | 'vertical' | 'dots' | 'custom';

export interface HatchShape extends BaseShape {
  type: 'hatch';
  points: Point[];          // Boundary polygon vertices (always closed)
  bulge?: number[];         // Arc bulge values for each segment (like polyline)

  // Foreground pattern
  patternType: HatchPatternType;
  patternAngle: number;     // Rotation in degrees
  patternScale: number;     // Spacing multiplier (1 = default)
  fillColor: string;        // Pattern line/fill color
  customPatternId?: string; // ID of custom pattern (when patternType is 'custom')

  // Background pattern layer (optional second layer rendered behind foreground)
  bgPatternType?: HatchPatternType;   // Background pattern (undefined = none)
  bgPatternAngle?: number;            // Background pattern rotation in degrees
  bgPatternScale?: number;            // Background pattern spacing multiplier
  bgFillColor?: string;               // Background pattern line/fill color
  bgCustomPatternId?: string;         // Background custom pattern ref

  // Background solid color (fills behind all patterns)
  backgroundColor?: string; // Optional solid background (undefined = transparent)

  // Masking: when true (default), region is opaque and hides elements behind it
  masking?: boolean;

  // Filled Region Type reference (when set, shape derives pattern properties from the type)
  filledRegionTypeId?: string;

  // Boundary display
  boundaryVisible?: boolean;  // Whether to stroke the boundary outline (default: true)

  // Inner loops / cutouts (holes in the filled region)
  innerLoops?: Point[][];     // Array of closed polygons that define holes
}

// Beam justification - how beam aligns relative to centerline
export type BeamJustification = 'center' | 'top' | 'bottom' | 'left' | 'right';

// Beam material type for visual representation
export type BeamMaterial = 'steel' | 'cold-formed-steel' | 'concrete' | 'timber' | 'aluminum' | 'other';

// Beam view mode - how the beam is displayed
export type BeamViewMode = 'plan' | 'section' | 'elevation' | 'side';

// Beam shape - structural beam in plan view
export interface BeamShape extends BaseShape {
  type: 'beam';
  start: Point;                    // Beam start point (centerline)
  end: Point;                      // Beam end point (centerline)
  profileType: string;             // Profile type (e.g., 'i-beam', 'channel')
  profileParameters: Record<string, number | string | boolean>;  // Profile dimensions
  presetId?: string;               // Standard profile ID (e.g., "W12x27")
  presetName?: string;             // Display name for the preset
  flangeWidth: number;             // Width of beam in plan view (mm)
  justification: BeamJustification; // Beam alignment relative to centerline
  material: BeamMaterial;          // Material type for rendering style
  showCenterline: boolean;         // Whether to show dashed centerline
  showLabel: boolean;              // Whether to show beam label
  labelText?: string;              // Custom label (auto-generated if not set)
  rotation: number;                // Additional rotation around start point (radians)
  viewMode?: BeamViewMode;         // Display mode: plan (default), section, or elevation
  startCap?: 'butt' | 'miter';    // End cap at start (default: butt)
  endCap?: 'butt' | 'miter';      // End cap at end (default: butt)
  startMiterAngle?: number;        // Angle (radians) of the OTHER beam/wall at the start miter join
  endMiterAngle?: number;          // Angle (radians) of the OTHER beam/wall at the end miter join
  bulge?: number;                  // Arc bulge factor (DXF standard): 0=straight, >0=left, <0=right, 1=semicircle
  plateSystemId?: string;          // Parent plate system ID (when beam is a child of a plate system)
  plateSystemRole?: 'joist' | 'edge';  // Role within the plate system (joist or edge beam/rim joist)
}

// Gridline bubble position
export type GridlineBubblePosition = 'start' | 'end' | 'both';

// Gridline shape - structural grid line (stramien)
export interface GridlineShape extends BaseShape {
  type: 'gridline';
  start: Point;
  end: Point;
  label: string;                          // "1", "A", etc.
  bubblePosition: GridlineBubblePosition;
  bubbleRadius: number;                   // Circle radius (drawing units)
  fontSize: number;                       // Font size (drawing units)
}

// Level shape - horizontal reference plane (floor level)
// Label is always shown on the right (end) side only.
export type LevelLabelPosition = 'start' | 'end' | 'both';

export interface LevelShape extends BaseShape {
  type: 'level';
  start: Point;
  end: Point;
  label: string;                          // Formatted peil display: "\u00b1 0", "+ 500", "- 1200"
  labelPosition: LevelLabelPosition;      // Kept for backward compat; renderer always uses 'end'
  bubbleRadius: number;                   // Triangle/marker size (drawing units)
  fontSize: number;                       // Font size (drawing units)
  elevation: number;                      // Elevation in mm (e.g. 0, 3000, -1200)
  peil: number;                           // Peil value in mm (auto-calculated from Y position)
  description?: string;                   // Optional text below peil (e.g. "Vloerpeil", "Bovenkant vloer")
}

// Pile types for bearing capacity analysis
export type PileType = 'prefab-concrete' | 'steel-tube' | 'vibro' | 'screw';

// Bearing capacity at a specific depth level
export interface BearingCapacityLevel {
  depth: number;    // depth in m NAP
  capacity: number; // bearing capacity in kN
}

// A pile option with type, dimension, and bearing capacity per depth
export interface PileOption {
  pileType: PileType;
  dimension: string;  // e.g., "180x180", "219"
  bearingCapacityPerLevel: BearingCapacityLevel[];
}

// Foundation advice derived from a CPT
export interface FoundationAdvice {
  pileOptions: PileOption[];
}

// Pile symbol types for pile plan legend
export type PileSymbolType = 'filled-circle' | 'open-circle' | 'cross' | 'triangle' | 'diamond' | 'square' | 'plus' | 'star';

// Pile plan settings
export interface PilePlanSettings {
  symbolMode: 'cutoff-tip-diameter' | 'tip-diameter';
  numberingBandwidth: number;  // default 500mm
}

// Pile shape - foundation pile in plan view
export interface PileShape extends BaseShape {
  type: 'pile';
  position: Point;              // Center of pile
  diameter: number;             // Pile diameter (drawing units)
  label: string;                // Pile number ("P1", "P2", etc.)
  fontSize: number;             // Label font size (drawing units)
  showCross: boolean;           // Show cross inside circle
  pileNumber?: number;          // Auto-numbered sequence
  cutoffLevel?: number;         // Afhakhoogte (m NAP)
  tipLevel?: number;            // Puntniveau (m NAP)
  pileType?: PileType;          // Foundation pile type
  pileSymbol?: PileSymbolType;  // Symbol assigned by pile plan
  cptId?: string;               // Linked CPT for bearing capacity lookup
}

// CPT (Cone Penetration Test) location shape
export interface CPTShape extends BaseShape {
  type: 'cpt';
  position: Point;              // CPT location
  name: string;                 // e.g., "CPT-01"
  fontSize: number;             // Label font size (drawing units)
  markerSize: number;           // Triangle marker size (drawing units)
  foundationAdvice?: FoundationAdvice;
}

// Foundation zone shape - auto-generated region linked to a CPT
export interface FoundationZoneShape extends BaseShape {
  type: 'foundation-zone';
  contourPoints: Point[];       // Zone boundary polygon
  cptId: string;                // Linked CPT
  selectedPileOption?: string;  // Selected pile option key (pileType + dimension)
  fillColor?: string;           // Zone fill color
  fillOpacity?: number;         // Zone fill opacity (0-1)
}

// Material category type shared by walls, slabs, and material hatch settings
export type MaterialCategory = 'concrete' | 'masonry' | 'calcium-silicate' | 'timber' | 'steel' | 'insulation' | 'generic';

/**
 * Canonical material categories list -- single source of truth.
 * Every dialog / dropdown that needs material categories should import this
 * instead of defining its own local copy.
 *
 * Canonical materials (Dutch structural engineering):
 *   Beton (concrete), Metselwerk (masonry), Kalkzandsteen (calcium-silicate),
 *   Hout/HSB (timber), Staal (steel), Isolatie (insulation), Overig (generic).
 */
export interface MaterialCategoryInfo {
  id: MaterialCategory;
  label: string;         // Dutch display name
  labelEn: string;       // English display name
}

export const MATERIAL_CATEGORIES: MaterialCategoryInfo[] = [
  { id: 'concrete',         label: 'Beton',          labelEn: 'Concrete' },
  { id: 'masonry',          label: 'Metselwerk',     labelEn: 'Masonry' },
  { id: 'calcium-silicate', label: 'Kalkzandsteen',  labelEn: 'Calcium Silicate' },
  { id: 'timber',           label: 'Hout',           labelEn: 'Timber' },
  { id: 'steel',            label: 'Staal',          labelEn: 'Steel' },
  { id: 'insulation',       label: 'Isolatie',       labelEn: 'Insulation' },
  { id: 'generic',          label: 'Overig',         labelEn: 'Generic' },
];

/** Look up a MaterialCategoryInfo by id */
export function getMaterialCategoryInfo(id: MaterialCategory): MaterialCategoryInfo {
  return MATERIAL_CATEGORIES.find(c => c.id === id) || MATERIAL_CATEGORIES[MATERIAL_CATEGORIES.length - 1];
}

// Wall type definition
export interface WallType {
  id: string;
  name: string;
  thickness: number;            // Wall thickness (drawing units, e.g. 200mm)
  material: MaterialCategory;
  /** @deprecated Kept for backward compatibility with saved files.
   *  New code should use `material` (MaterialCategory) directly. */
  materialId?: string;
  color?: string;               // Optional color override
}

// Slab type definition
export interface SlabType {
  id: string;
  name: string;
  thickness: number;            // Slab thickness in mm (e.g. 200)
  material: MaterialCategory;
  /** @deprecated Kept for backward compatibility with saved files.
   *  New code should use `material` (MaterialCategory) directly. */
  materialId?: string;
}

// Column cross-section shape
export type ColumnShapeType = 'rectangular' | 'circular';

// Column type definition (IfcColumnType)
export interface ColumnType {
  id: string;
  name: string;
  material: MaterialCategory;
  profileType: string;          // Profile type (e.g. 'rectangular', 'HEA', 'HEB')
  width: number;                // Width in mm (or diameter for circular)
  depth: number;                // Depth in mm (ignored for circular)
  shape: ColumnShapeType;       // Cross-section shape
}

// Beam type profile type
export type BeamTypeProfileType = 'i-beam' | 'rectangular' | 'circular';

// Beam type definition (IfcBeamType)
export interface BeamType {
  id: string;
  name: string;
  material: MaterialCategory;
  profileType: BeamTypeProfileType;
  profilePresetId?: string;     // Standard profile ID (e.g. "IPE200")
  width: number;                // Overall width in mm
  height: number;               // Overall height in mm
  flangeWidth?: number;         // Flange width in mm (I-beam only)
  flangeThickness?: number;     // Flange thickness in mm (I-beam only)
  webThickness?: number;        // Web thickness in mm (I-beam only)
}

// Wall justification
export type WallJustification = 'center' | 'left' | 'right';

// Wall end cap type
export type WallEndCap = 'butt' | 'miter';

// Wall shape - structural wall in plan view
export interface WallShape extends BaseShape {
  type: 'wall';
  start: Point;                 // Centerline start
  end: Point;                   // Centerline end
  thickness: number;            // Wall thickness (drawing units)
  wallTypeId?: string;          // Reference to WallType
  justification: WallJustification;
  showCenterline: boolean;
  label?: string;               // Optional wall label
  startCap: WallEndCap;
  endCap: WallEndCap;
  startMiterAngle?: number;   // Angle (radians) of the OTHER wall at the start miter join
  endMiterAngle?: number;     // Angle (radians) of the OTHER wall at the end miter join
  hatchType: 'diagonal' | 'crosshatch' | 'horizontal' | 'none';
  hatchAngle: number;
  hatchSpacing: number;
  hatchColor?: string;
  bulge?: number;                  // Arc bulge factor (DXF standard): 0=straight, >0=left, <0=right, 1=semicircle
  spaceBounding?: boolean;         // Whether wall bounds rooms/spaces (default true; undefined = true)
  baseLevel?: string;              // IFC base constraint: storey ID for bottom of wall
  topLevel?: string;               // IFC top constraint: storey ID for top of wall (or 'unconnected')
}

// Slab material type
export type SlabMaterial = 'concrete' | 'timber' | 'steel' | 'generic';

// Slab shape - structural floor slab in plan view (closed polygon with hatch)
export interface SlabShape extends BaseShape {
  type: 'slab';
  points: Point[];          // Boundary polygon vertices (always closed)
  thickness: number;        // Slab thickness in mm (default 200)
  level: string;            // Which level/floor the slab belongs to
  elevation: number;        // Elevation offset in mm
  material: SlabMaterial;
  hatchType: HatchPatternType;
  hatchAngle: number;       // Hatch rotation in degrees
  hatchSpacing: number;     // Hatch line spacing
  hatchColor?: string;      // Hatch line color (default: shape stroke color)
  label?: string;           // Optional slab label
}

// Section callout type: section cut line or detail circle
export type SectionCalloutType = 'section' | 'detail';

// Section callout shape - section cut line with markers or detail callout circle
export interface SectionCalloutShape extends BaseShape {
  type: 'section-callout';
  calloutType: SectionCalloutType;
  // Cut line: start and end points
  start: Point;
  end: Point;
  // Label (e.g., "A", "1")
  label: string;
  // For detail callout: circle center and radius
  detailCenter?: Point;
  detailRadius?: number;
  // Reference to target drawing/viewport
  targetDrawingId?: string;
  // Visual properties
  fontSize: number;
  bubbleRadius: number;
  // Arrow direction (which side of the cut line the viewing direction arrows point)
  flipDirection: boolean;
  // Hide section head (label + arrow) on one side
  hideStartHead?: boolean;
  hideEndHead?: boolean;
  // View depth: how far the section looks perpendicular to the cut line (mm)
  viewDepth?: number;  // default 5000mm (5 meters)
}

// Space shape - IfcSpace room/area in plan view (detected from surrounding walls)
export interface SpaceShape extends BaseShape {
  type: 'space';
  contourPoints: Point[];  // The polygon boundary (computed from walls)
  name: string;            // Space name (e.g., "Living Room")
  number?: string;         // Space number
  level?: string;          // Building storey reference
  area?: number;           // Computed area in m²
  labelPosition: Point;    // Where the label is shown
  fillColor?: string;      // Optional fill color (light green default)
  fillOpacity?: number;    // Fill opacity (0.1 default)
}

// Plate system rectangular opening
export interface PlateSystemOpening {
  id: string;
  position: Point;    // center point
  width: number;      // in mm
  height: number;     // in mm
  rotation?: number;  // in radians, default 0
}

// Plate system layer definition
export interface PlateSystemLayer {
  name: string;                   // e.g., 'Multiplex 18mm', 'Gips 12.5mm'
  thickness: number;              // Layer thickness in mm
  material: string;               // Material category
  position: 'top' | 'bottom';    // Above or below main system
}

// Plate system main profile definition
export interface PlateSystemMainProfile {
  profileType: string;            // e.g., 'rectangle' for timber
  width: number;                  // Profile width (mm)
  height: number;                 // Profile height/depth (mm)
  spacing: number;                // Center-to-center spacing (mm), "hoh-afstand"
  direction: number;              // Angle in radians for joist direction
  material: string;               // Material category
  profileId?: string;             // Reference to a standard profile from the profile library (IfcProfileDef)
}

// Plate system edge profile definition
export interface PlateSystemEdgeProfile {
  profileType: string;
  width: number;
  height: number;
  material: string;
  profileId?: string;             // Reference to a standard profile from the profile library (IfcProfileDef)
}

// Plate system shape - composite building assembly (timber floor, HSB wall, ceiling, etc.)
export interface PlateSystemShape extends BaseShape {
  type: 'plate-system';
  contourPoints: Point[];           // Boundary polygon
  contourBulges?: number[];         // Bulge per segment (for arc segments)
  systemType: string;               // e.g., 'timber-floor', 'hsb-wall', 'ceiling'

  // Main system (joists/studs)
  mainProfile: PlateSystemMainProfile;

  // Edge beams/rim joists (randen)
  edgeProfile?: PlateSystemEdgeProfile;

  // Layers (sub-systems)
  layers?: PlateSystemLayer[];

  // Per-edge enable/disable for edge beams (array matching contour edges, true = edge beam present)
  edgeBeamEnabled?: boolean[];

  // Child beam IDs (joists + edge beams generated from this system)
  childShapeIds?: string[];

  // Rectangular openings (sparingen) cut into the plate system
  openings?: PlateSystemOpening[];

  name?: string;                    // System name
  fillColor?: string;
  fillOpacity?: number;
}

// Spot Elevation shape - point marker with elevation label (IfcSpotElevation)
export interface SpotElevationShape extends BaseShape {
  type: 'spot-elevation';
  position: Point;           // Marker position in world coords
  elevation: number;         // Elevation in mm (e.g. 0, 3000, -1200)
  labelPosition: Point;      // Position of the elevation label text
  showLeader: boolean;       // Whether to draw a leader line from marker to label
  fontSize: number;          // Font size (drawing units)
  markerSize: number;        // Size of cross/circle marker (drawing units)
}

// Image shape - embedded raster image on the canvas
export interface ImageShape extends BaseShape {
  type: 'image';
  position: Point;        // Top-left corner in world coords
  width: number;          // Display width in world units
  height: number;         // Display height in world units
  rotation: number;       // Radians
  imageData: string;      // Base64 data URL (embedded)
  sourcePath?: string;    // Original file path (for re-linking)
  originalWidth: number;  // Pixel width of source image
  originalHeight: number; // Pixel height of source image
  opacity: number;        // 0-1, default 1
  maintainAspectRatio: boolean; // default true
  isUnderlay?: boolean;         // Rendered as background behind all other shapes
  sourceFileName?: string;      // Original filename (e.g. for DXF underlay display)
}

// Specific shape types
export interface LineShape extends BaseShape {
  type: 'line';
  start: Point;
  end: Point;
}

export interface RectangleShape extends BaseShape {
  type: 'rectangle';
  topLeft: Point;
  width: number;
  height: number;
  rotation: number;
  cornerRadius?: number;  // Rounded corners (0 or undefined = sharp)
}

export interface CircleShape extends BaseShape {
  type: 'circle';
  center: Point;
  radius: number;
}

export interface ArcShape extends BaseShape {
  type: 'arc';
  center: Point;
  radius: number;
  startAngle: number;
  endAngle: number;
}

export interface EllipseShape extends BaseShape {
  type: 'ellipse';
  center: Point;
  radiusX: number;
  radiusY: number;
  rotation: number;
  startAngle?: number;  // For partial ellipse (arc of ellipse)
  endAngle?: number;    // For partial ellipse (arc of ellipse)
}

export interface PolylineShape extends BaseShape {
  type: 'polyline';
  points: Point[];
  closed: boolean;
  bulge?: number[];
}

export interface SplineShape extends BaseShape {
  type: 'spline';
  points: Point[];
  closed: boolean;
}

// Text alignment options
export type TextAlignment = 'left' | 'center' | 'right';
export type TextVerticalAlignment = 'top' | 'middle' | 'bottom';

// Leader line types
export type LeaderArrowType = 'arrow' | 'filled-arrow' | 'dot' | 'slash' | 'none';
export type LeaderAttachment = 'top-left' | 'top-center' | 'top-right' | 'middle-left' | 'middle-right' | 'bottom-left' | 'bottom-center' | 'bottom-right';

// Leader configuration
export interface LeaderConfig {
  arrowType: LeaderArrowType;        // Type of arrowhead/terminator
  arrowSize: number;                  // Size of arrow in drawing units
  attachment: LeaderAttachment;       // Where leader attaches to text
  hasLanding: boolean;                // Whether to draw horizontal "landing" line
  landingLength: number;              // Length of landing line in drawing units
  lineWeight: number;                 // Line weight
  color?: string;                     // Leader color (defaults to text color)
}

// Leader line (individual leader polyline for multi-leader support)
export interface LeaderLine {
  points: Point[];   // Waypoints from arrow tip toward text (first = arrow tip)
}

// Text case transformation
export type TextCase = 'none' | 'uppercase' | 'lowercase' | 'capitalize';

export interface TextShape extends BaseShape {
  type: 'text';
  position: Point;           // Insertion point
  text: string;              // Plain text content (supports special codes: ^S for superscript, ^s for subscript end, ^P for paragraph)
  fontSize: number;          // In drawing units
  fontFamily: string;
  rotation: number;          // Radians
  alignment: TextAlignment;
  verticalAlignment: TextVerticalAlignment;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strikethrough?: boolean;   // Strikethrough text
  color: string;             // Text color
  lineHeight: number;        // Multiplier (default 1.2)
  fixedWidth?: number;       // If set, text wraps at this width
  // Advanced formatting
  letterSpacing?: number;    // Character spacing multiplier (1 = normal, 1.5 = 150%)
  widthFactor?: number;      // Horizontal text stretch (1 = normal, 0.5 = compressed, 2 = expanded)
  obliqueAngle?: number;     // Slant angle in degrees (0 = normal, positive = right slant)
  textCase?: TextCase;       // Text transformation (uppercase, lowercase, etc.)
  paragraphSpacing?: number; // Extra space between paragraphs (multiplier of line height)
  // Leader configuration
  leaderPoints?: Point[];    // Leader line waypoints (from text to geometry)
  leaderConfig?: LeaderConfig; // Leader styling and configuration
  leaders?: LeaderLine[];     // Multiple leader lines (each has own arrow)
  // Text behavior
  isModelText?: boolean;     // If true, text size is in model units (scales with geometry)
  // Background masking
  backgroundMask?: boolean;  // If true, draw opaque background behind text
  backgroundColor?: string;  // Background color (default: drawing background or white)
  backgroundPadding?: number; // Padding around text in drawing units (default: 0.5)
  // Text Style reference
  textStyleId?: string;      // Reference to a saved TextStyle
  // Linked element tag (like Revit tags): label reads info from linked shape
  linkedShapeId?: string;    // ID of the shape this label is linked to
  // Label template for linked labels: e.g. "{Name}\n{Area} m²"
  // Placeholders: {Name}, {Number}, {Area}, {Level}, {Type}, {Thickness}, {Section}, {Profile}
  labelTemplate?: string;    // Template string with property placeholders
}

export interface PointShape extends BaseShape {
  type: 'point';
  position: Point;
}

// Text Style - reusable text formatting preset
export interface TextStyle {
  id: string;
  name: string;
  // Font properties
  fontFamily: string;
  fontSize: number;           // In drawing units
  bold: boolean;
  italic: boolean;
  underline: boolean;
  color: string;
  // Layout
  alignment: TextAlignment;
  verticalAlignment: TextVerticalAlignment;
  lineHeight: number;
  // Text behavior
  isModelText: boolean;       // Model Text vs Annotation Text
  // Background masking
  backgroundMask: boolean;
  backgroundColor: string;
  backgroundPadding: number;
  // Advanced formatting (optional for backward compat)
  strikethrough?: boolean;
  textCase?: TextCase;
  letterSpacing?: number;     // Character spacing multiplier (1 = normal)
  widthFactor?: number;       // Horizontal text stretch (1 = normal)
  obliqueAngle?: number;      // Slant angle in degrees (0 = normal)
  paragraphSpacing?: number;  // Extra space between paragraphs (multiplier)
  // Metadata
  isBuiltIn?: boolean;        // Built-in styles cannot be deleted
  isProjectStyle?: boolean;   // Project-specific vs User global style
}

// Block definitions and instances
export interface BlockDefinition {
  id: string;
  name: string;
  shapes: BaseShape[];
}

export interface BlockInstanceShape extends BaseShape {
  type: 'block-instance';
  blockDefinitionId: string;
  position: Point;
  rotation: number;
  scaleX: number;
  scaleY: number;
}

// Forward declaration for DimensionShape (defined in dimension.ts)
import type { DimensionShape } from './dimension';

// Union type for all shapes
export type Shape =
  | LineShape
  | RectangleShape
  | CircleShape
  | ArcShape
  | EllipseShape
  | PolylineShape
  | SplineShape
  | TextShape
  | PointShape
  | DimensionShape
  | HatchShape
  | BeamShape
  | ImageShape
  | GridlineShape
  | LevelShape
  | PileShape
  | WallShape
  | SlabShape
  | SectionCalloutShape
  | SpaceShape
  | PlateSystemShape
  | SpotElevationShape
  | CPTShape
  | FoundationZoneShape
  | BlockInstanceShape;

// Layer type
export interface Layer {
  id: string;
  name: string;
  drawingId: string;  // Which drawing this layer belongs to
  visible: boolean;
  locked: boolean;
  color: string;
  lineStyle: LineStyle;
  lineWidth: number;
}

// Viewport/Camera
export interface Viewport {
  offsetX: number;
  offsetY: number;
  zoom: number;
  rotation?: number; // View rotation in radians (default 0)
}

// Snap types
export type SnapType =
  | 'grid'
  | 'endpoint'
  | 'midpoint'
  | 'center'
  | 'intersection'
  | 'perpendicular'
  | 'parallel'
  | 'tangent'
  | 'nearest'
  | 'origin';

export interface SnapPoint {
  point: Point;
  type: SnapType;
  sourceShapeId?: string;
  /** For polyline/rectangle vertices - which point index was snapped to */
  pointIndex?: number;
  /** Angle of the source edge (for beams, lines) - used for perpendicular/parallel tracking */
  sourceAngle?: number;
}

// Tool types
export type ToolType =
  | 'select'
  | 'pan'
  // Drawing tools
  | 'line'
  | 'rectangle'
  | 'circle'
  | 'arc'
  | 'polyline'
  | 'ellipse'
  | 'spline'
  | 'text'
  | 'leader'
  | 'dimension'
  // Region tools
  | 'filled-region'
  | 'insulation'
  | 'hatch'
  | 'detail-component'
  // Structural tools
  | 'beam'
  | 'gridline'
  | 'level'
  | 'pile'
  | 'cpt'
  | 'wall'
  | 'slab'
  | 'section-callout'
  | 'space'
  | 'plate-system'
  | 'spot-elevation'
  | 'label'
  // Image tools
  | 'image'
  // Modify tools (legacy - now commands)
  | 'move'
  | 'copy'
  | 'copy2'
  | 'rotate'
  | 'scale'
  | 'mirror'
  | 'trim'
  | 'extend'
  | 'fillet'
  | 'chamfer'
  | 'offset'
  | 'array'
  | 'elastic'
  | 'align'
  | 'trim-walls'
  // Sheet annotation tools
  | 'sheet-text'
  | 'sheet-leader'
  | 'sheet-dimension'
  | 'sheet-callout'
  | 'sheet-revision-cloud';

// Circle drawing modes
export type CircleMode =
  | 'center-radius'    // Default: click center, then radius point
  | 'center-diameter'  // Click center, then diameter point
  | '2point'           // Two points define diameter endpoints
  | '3point';          // Three points on circumference

// Rectangle drawing modes
export type RectangleMode =
  | 'corner'           // Default: click two opposite corners
  | 'center'           // Click center, then corner
  | '3point';          // Three points: corner, width direction, height

// ============================================================================
// Drawings & Sheets System
// ============================================================================

// Drawing boundary - defines the visible region when placed on sheets
export interface DrawingBoundary {
  x: number;      // Left edge in drawing coordinates
  y: number;      // Top edge in drawing coordinates
  width: number;  // Width in drawing units
  height: number; // Height in drawing units
}

// Drawing type: standalone (default), plan (IfcBuildingStorey), section (cross-section)
export type DrawingType = 'standalone' | 'plan' | 'section';

// Section reference - bidirectional link between section drawing and plan elements
export interface SectionReference {
  sourceDrawingId: string;    // Drawing that contains the source element
  sourceShapeId: string;      // ID of the gridline or level shape in the source drawing
  position: number;           // Horizontal position for gridlines, vertical for levels
}

// Drawing - working canvas
export interface Drawing {
  id: string;
  name: string;
  boundary: DrawingBoundary;  // Defines the region/extent visible on sheets
  scale: number;              // View scale (e.g., 0.02 for 1:50, 0.01 for 1:100)
  drawingType: DrawingType;   // Drawing type: standalone, plan, or section
  storeyId?: string;          // For plan drawings: linked IfcBuildingStorey ID from ProjectStructure
  linkedSectionCalloutId?: string; // For section drawings: ID of the section-callout shape that created this
  sectionReferences?: SectionReference[]; // Linked references to gridlines/levels from plan drawings
  createdAt: string;
  modifiedAt: string;
}

/** @deprecated Use DrawingBoundary instead */
export type DraftBoundary = DrawingBoundary;
/** @deprecated Use Drawing instead */
export type Draft = Drawing;

// Paper sizes for sheets
export type PaperSize = 'A4' | 'A3' | 'A2' | 'A1' | 'A0' | 'Letter' | 'Legal' | 'Tabloid' | 'Custom';

// Paper orientation
export type PaperOrientation = 'portrait' | 'landscape';

// Forward declaration for sheet annotations (defined in sheet.ts)
// Using import type to avoid circular dependency
import type { SheetAnnotation } from './sheet';

// Sheet - printable layout
export interface Sheet {
  id: string;
  name: string;
  paperSize: PaperSize;
  orientation: PaperOrientation;
  customWidth?: number;   // mm, only used when paperSize is 'Custom'
  customHeight?: number;  // mm, only used when paperSize is 'Custom'
  viewports: SheetViewport[];
  titleBlock: TitleBlock;
  /** Sheet-level annotations (text, dimensions, leaders, etc.) */
  annotations: SheetAnnotation[];
  createdAt: string;
  modifiedAt: string;
}

// ============================================================================
// Viewport Crop Region
// ============================================================================

/**
 * Crop region type - defines the visible area within a viewport
 */
export type CropRegionType = 'rectangular' | 'polygonal';

/**
 * Crop region definition for viewport clipping
 */
export interface CropRegion {
  /** Type of crop region */
  type: CropRegionType;
  /** Points defining the region (2 for rectangular corners, N for polygonal) */
  points: Point[];
  /** Whether the crop is currently enabled */
  enabled: boolean;
}

// ============================================================================
// Viewport Layer Overrides
// ============================================================================

/**
 * Per-viewport layer visibility and style overrides
 */
export interface ViewportLayerOverride {
  /** ID of the layer being overridden */
  layerId: string;
  /** Visibility override (undefined = use layer default) */
  visible?: boolean;
  /** Color override (undefined = use layer default) */
  colorOverride?: string;
  /** Line weight override (undefined = use layer default) */
  lineWeightOverride?: number;
}

// ============================================================================
// Sheet Viewport
// ============================================================================

// Viewport title visibility mode
export type ViewportTitleVisibility = 'always' | 'never' | 'whenMultiple';

// Viewport on sheet showing a drawing
export interface SheetViewport {
  id: string;
  drawingId: string;          // Which drawing to show
  x: number;                  // Position on sheet (mm)
  y: number;
  width: number;              // Size on sheet (mm)
  height: number;
  centerX: number;            // View center in drawing coordinates
  centerY: number;
  scale: number;              // e.g., 0.01 for 1:100, 0.02 for 1:50
  locked: boolean;            // Prevent accidental pan/zoom
  visible: boolean;           // Toggle viewport visibility
  /** Optional crop region for clipping */
  cropRegion?: CropRegion;
  /** Per-viewport layer overrides */
  layerOverrides?: ViewportLayerOverride[];
  /** Reference number for callouts (e.g., "1", "A") */
  referenceNumber?: string;
  /** Custom viewport title (overrides drawing name) */
  customTitle?: string;
  /** Title visibility: 'always', 'never', or 'whenMultiple' (default: 'always') */
  titleVisibility?: ViewportTitleVisibility;
  /** Whether to show extension line below viewport (default: true) */
  showExtensionLine?: boolean;
  /** Extension line length in mm, or undefined for auto (viewport width) */
  extensionLineLength?: number;
  /** Whether to show scale in title (default: true) */
  showScale?: boolean;
}

// Title block with editable fields
export interface TitleBlock {
  visible: boolean;
  x: number;                  // Position on sheet (mm)
  y: number;
  width: number;              // Size (mm)
  height: number;
  fields: TitleBlockField[];
}

// Individual field in title block
export interface TitleBlockField {
  id: string;
  label: string;              // Field name (e.g., "Project", "Date", "Scale")
  value: string;              // Field value
  x: number;                  // Position within title block (mm)
  y: number;
  width: number;
  height: number;
  fontSize: number;           // Points
  fontFamily: string;
  align: 'left' | 'center' | 'right';
}

// Editor mode - are we in drawing or sheet layout?
export type EditorMode = 'drawing' | 'sheet';
