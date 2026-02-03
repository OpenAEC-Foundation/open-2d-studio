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
}

/** @deprecated Use drawingId instead */
export type BaseShapeWithDraftId = BaseShape & { draftId?: string };

export type ShapeType = 'line' | 'rectangle' | 'circle' | 'arc' | 'polyline' | 'ellipse' | 'spline' | 'text' | 'point' | 'dimension' | 'hatch';

export type HatchPatternType = 'solid' | 'diagonal' | 'crosshatch' | 'horizontal' | 'vertical' | 'dots' | 'custom';

export interface HatchShape extends BaseShape {
  type: 'hatch';
  points: Point[];          // Boundary polygon vertices (always closed)
  patternType: HatchPatternType;
  patternAngle: number;     // Rotation in degrees
  patternScale: number;     // Spacing multiplier (1 = default)
  fillColor: string;        // Pattern line/fill color
  backgroundColor?: string; // Optional background (undefined = transparent)
  customPatternId?: string; // ID of custom pattern (when patternType is 'custom')
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

export interface TextShape extends BaseShape {
  type: 'text';
  position: Point;           // Insertion point
  text: string;              // Plain text content
  fontSize: number;          // In drawing units
  fontFamily: string;
  rotation: number;          // Radians
  alignment: TextAlignment;
  verticalAlignment: TextVerticalAlignment;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  color: string;             // Text color
  lineHeight: number;        // Multiplier (default 1.2)
  fixedWidth?: number;       // If set, text wraps at this width
  leaderPoints?: Point[];    // Leader line waypoints (from text to geometry)
}

export interface PointShape extends BaseShape {
  type: 'point';
  position: Point;
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
  | HatchShape;

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
  | 'tangent'
  | 'nearest';

export interface SnapPoint {
  point: Point;
  type: SnapType;
  sourceShapeId?: string;
  /** For polyline/rectangle vertices - which point index was snapped to */
  pointIndex?: number;
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
