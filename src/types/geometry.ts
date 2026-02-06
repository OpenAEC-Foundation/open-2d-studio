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

export type ShapeType = 'line' | 'rectangle' | 'circle' | 'arc' | 'polyline' | 'ellipse' | 'spline' | 'text' | 'point' | 'dimension' | 'hatch' | 'beam';

export type HatchPatternType = 'solid' | 'diagonal' | 'crosshatch' | 'horizontal' | 'vertical' | 'dots' | 'custom';

export interface HatchShape extends BaseShape {
  type: 'hatch';
  points: Point[];          // Boundary polygon vertices (always closed)
  bulge?: number[];         // Arc bulge values for each segment (like polyline)
  patternType: HatchPatternType;
  patternAngle: number;     // Rotation in degrees
  patternScale: number;     // Spacing multiplier (1 = default)
  fillColor: string;        // Pattern line/fill color
  backgroundColor?: string; // Optional background (undefined = transparent)
  customPatternId?: string; // ID of custom pattern (when patternType is 'custom')
}

// Beam justification - how beam aligns relative to centerline
export type BeamJustification = 'center' | 'top' | 'bottom' | 'left' | 'right';

// Beam material type for visual representation
export type BeamMaterial = 'steel' | 'concrete' | 'timber';

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
  // Text behavior
  isModelText?: boolean;     // If true, text size is in model units (scales with geometry)
  // Background masking
  backgroundMask?: boolean;  // If true, draw opaque background behind text
  backgroundColor?: string;  // Background color (default: drawing background or white)
  backgroundPadding?: number; // Padding around text in drawing units (default: 0.5)
  // Text Style reference
  textStyleId?: string;      // Reference to a saved TextStyle
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
  // Metadata
  isBuiltIn?: boolean;        // Built-in styles cannot be deleted
  isProjectStyle?: boolean;   // Project-specific vs User global style
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
  | BeamShape;

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
  | 'nearest';

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
  | 'dimension'
  // Region tools
  | 'filled-region'
  | 'insulation'
  | 'hatch'
  | 'detail-component'
  // Structural tools
  | 'beam'
  // Modify tools (legacy - now commands)
  | 'move'
  | 'copy'
  | 'rotate'
  | 'scale'
  | 'mirror'
  | 'trim'
  | 'extend'
  | 'fillet'
  | 'chamfer'
  | 'offset'
  | 'array'
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
// Drawings & Sheets System (Model Space + Paper Space)
// ============================================================================

// Drawing boundary - defines the visible region when placed on sheets
export interface DrawingBoundary {
  x: number;      // Left edge in drawing coordinates
  y: number;      // Top edge in drawing coordinates
  width: number;  // Width in drawing units
  height: number; // Height in drawing units
}

// Drawing - working canvas
export interface Drawing {
  id: string;
  name: string;
  boundary: DrawingBoundary;  // Defines the region/extent visible on sheets
  scale: number;              // View scale (e.g., 0.02 for 1:50, 0.01 for 1:100)
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

// Sheet - printable layout (paper space)
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

// Editor mode - are we in model space or paper space?
export type EditorMode = 'drawing' | 'sheet';
