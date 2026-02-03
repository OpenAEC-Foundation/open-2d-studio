/**
 * Sheet Types - Enhanced types for Paper Space (sheets and viewports)
 *
 * These types support sheet functionality including:
 * - Sheet annotations (text, dimensions, leaders on sheets)
 * - Viewport crop regions
 * - Per-viewport layer visibility overrides
 * - Title block templates
 * - Sheet templates
 */

import type { Point, CropRegion, ViewportLayerOverride } from './geometry';

// Re-export from geometry for backward compatibility
export type { CropRegionType, CropRegion, ViewportLayerOverride } from './geometry';

// Alias for backward compatibility with code using ViewportCropRegion
export type ViewportCropRegion = CropRegion;

// ============================================================================
// Enhanced Viewport
// ============================================================================

/**
 * Enhanced viewport with crop region and layer overrides
 * Extends the base SheetViewport from geometry.ts
 */
export interface EnhancedSheetViewport {
  id: string;
  drawingId: string;
  x: number;
  y: number;
  width: number;
  height: number;
  centerX: number;
  centerY: number;
  scale: number;
  locked: boolean;
  visible: boolean;
  /** Optional crop region */
  cropRegion?: ViewportCropRegion;
  /** Per-viewport layer overrides */
  layerOverrides?: ViewportLayerOverride[];
  /** Reference number for callouts (e.g., "1", "A") */
  referenceNumber?: string;
  /** IDs of callouts pointing to this viewport */
  referencedBy?: string[];
  /** Custom viewport title (overrides drawing name) */
  customTitle?: string;
}

// ============================================================================
// Sheet Annotations
// ============================================================================

/**
 * Base interface for all sheet annotations
 */
export interface BaseSheetAnnotation {
  id: string;
  /** Position in sheet coordinates (mm) */
  position: Point;
  /** Whether the annotation is visible */
  visible: boolean;
  /** Whether the annotation is locked from editing */
  locked: boolean;
}

/**
 * Text annotation on a sheet
 */
export interface SheetTextAnnotation extends BaseSheetAnnotation {
  type: 'text';
  content: string;
  /** Font size in mm */
  fontSize: number;
  fontFamily: string;
  /** Rotation in radians */
  rotation: number;
  alignment: 'left' | 'center' | 'right';
  /** Text color */
  color: string;
  /** Bold text */
  bold?: boolean;
  /** Italic text */
  italic?: boolean;
}

/**
 * Dimension style settings
 */
export interface DimensionStyle {
  /** Arrow type at dimension ends */
  arrowType: 'filled' | 'open' | 'dot' | 'tick' | 'none';
  /** Arrow size in mm */
  arrowSize: number;
  /** Extension line gap from object */
  extensionLineGap: number;
  /** Extension line overshoot past dimension line */
  extensionLineOvershoot: number;
  /** Text height in mm */
  textHeight: number;
  /** Text placement relative to dimension line */
  textPlacement: 'above' | 'centered' | 'below';
  /** Line color */
  lineColor: string;
  /** Text color */
  textColor: string;
}

/**
 * Dimension annotation types
 */
export type DimensionType = 'linear' | 'aligned' | 'angular' | 'radius' | 'diameter' | 'arc-length';

/**
 * Dimension annotation on a sheet
 */
export interface SheetDimensionAnnotation extends BaseSheetAnnotation {
  type: 'dimension';
  dimensionType: DimensionType;
  /** Points defining the dimension (varies by type) */
  points: Point[];
  /** The dimension value text (can be overridden) */
  value: string;
  /** Whether value is manually overridden */
  valueOverridden: boolean;
  /** Dimension style */
  style: DimensionStyle;
  /** Prefix text (e.g., "R" for radius) */
  prefix?: string;
  /** Suffix text (e.g., "mm") */
  suffix?: string;
}

/**
 * Leader annotation on a sheet
 */
export interface SheetLeaderAnnotation extends BaseSheetAnnotation {
  type: 'leader';
  /** Leader line path points */
  points: Point[];
  /** Text at the end of the leader */
  text: string;
  /** Arrow type at the start of the leader */
  arrowType: 'filled' | 'open' | 'dot' | 'none';
  /** Text alignment */
  textAlignment: 'left' | 'center' | 'right';
  /** Line color */
  lineColor: string;
  /** Text color */
  textColor: string;
  /** Font size in mm */
  fontSize: number;
}

/**
 * Detail callout annotation
 */
export interface SheetCalloutAnnotation extends BaseSheetAnnotation {
  type: 'callout';
  /** The viewport this callout appears in */
  sourceViewportId: string;
  /** The detail viewport this callout references */
  targetViewportId: string;
  /** Callout number/letter */
  calloutNumber: string;
  /** Shape of the callout bubble */
  shape: 'circle' | 'hexagon' | 'rectangle' | 'cloud';
  /** Size of the callout bubble in mm */
  size: number;
  /** Line color */
  lineColor: string;
  /** Fill color (optional) */
  fillColor?: string;
}

/**
 * Section marker annotation
 */
export interface SheetSectionMarker extends BaseSheetAnnotation {
  type: 'section-marker';
  /** The viewport this section marker appears in */
  sourceViewportId: string;
  /** The section viewport this marker references */
  targetViewportId: string;
  /** Section line start point */
  lineStart: Point;
  /** Section line end point */
  lineEnd: Point;
  /** Section number/letter */
  sectionNumber: string;
  /** Arrow direction indicators */
  direction: 'left' | 'right' | 'up' | 'down' | 'both';
  /** Line color */
  lineColor: string;
}

/**
 * Revision cloud annotation
 */
export interface SheetRevisionCloud extends BaseSheetAnnotation {
  type: 'revision-cloud';
  /** Points defining the cloud boundary */
  points: Point[];
  /** Revision number this cloud belongs to */
  revisionNumber: string;
  /** Arc bulge factor (controls cloud arc size) */
  arcBulge: number;
  /** Line color */
  lineColor: string;
}

/**
 * Union type for all sheet annotations
 */
export type SheetAnnotation =
  | SheetTextAnnotation
  | SheetDimensionAnnotation
  | SheetLeaderAnnotation
  | SheetCalloutAnnotation
  | SheetSectionMarker
  | SheetRevisionCloud;

// ============================================================================
// Title Block Templates
// ============================================================================

/**
 * Title block template cell
 */
export interface TitleBlockCell {
  /** Width as percentage of row width */
  widthPercent: number;
  /** Field ID to display in this cell */
  fieldId: string;
  /** Text alignment */
  alignment: 'left' | 'center' | 'right';
  /** Font size in points */
  fontSize: number;
  /** Bold text */
  isBold: boolean;
}

/**
 * Title block template row
 */
export interface TitleBlockRow {
  /** Height in mm */
  height: number;
  /** Cells in this row */
  cells: TitleBlockCell[];
}

/**
 * Title block layout definition
 */
export interface TitleBlockLayout {
  /** Rows in the title block */
  rows: TitleBlockRow[];
  /** Border line width */
  borderWidth: number;
  /** Background color */
  backgroundColor: string;
  /** Grid line color */
  gridColor: string;
}

/**
 * Title block template
 */
export interface TitleBlockTemplate {
  id: string;
  name: string;
  description: string;
  /** Compatible paper sizes */
  paperSizes: string[];
  /** Layout definition */
  layout: TitleBlockLayout;
  /** Default field values */
  defaultFields: { id: string; label: string; value: string }[];
  /** Whether this is a built-in template */
  isBuiltIn: boolean;
}

/**
 * Revision entry in title block
 */
export interface Revision {
  /** Revision number/letter */
  number: string;
  /** Revision date */
  date: string;
  /** Description of changes */
  description: string;
  /** Who made the revision */
  drawnBy: string;
}

/**
 * Revision table in title block
 */
export interface RevisionTable {
  visible: boolean;
  /** Maximum rows to display */
  maxRows: number;
  /** Column definitions */
  columns: { id: string; label: string; width: number }[];
  /** Revision entries */
  revisions: Revision[];
}

/**
 * Enhanced title block with revision table and logo
 */
export interface EnhancedTitleBlock {
  visible: boolean;
  /** Template ID */
  templateId?: string;
  x: number;
  y: number;
  width: number;
  height: number;
  /** Field values */
  fields: { id: string; label: string; value: string; x: number; y: number; width: number; height: number; fontSize: number; fontFamily: string; align: 'left' | 'center' | 'right' }[];
  /** Optional company logo */
  logo?: {
    /** Base64 encoded image data */
    data: string;
    /** Position within title block */
    x: number;
    y: number;
    /** Size in mm */
    width: number;
    height: number;
  };
  /** Revision table */
  revisionTable?: RevisionTable;
}

// ============================================================================
// Sheet Templates
// ============================================================================

/**
 * Viewport placeholder in a sheet template
 */
export interface ViewportPlaceholder {
  id: string;
  /** Name of this viewport slot */
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  /** Default scale for this viewport */
  defaultScale: number;
  /** Suggested drawing type (e.g., "Floor Plan", "Section") */
  suggestedDrawingType?: string;
}

/**
 * Sheet template
 */
export interface SheetTemplate {
  id: string;
  name: string;
  description: string;
  paperSize: string;
  orientation: 'portrait' | 'landscape';
  /** Title block template to use */
  titleBlockTemplateId: string;
  /** Viewport placeholders */
  viewportPlaceholders: ViewportPlaceholder[];
  /** Whether this is a built-in template */
  isBuiltIn: boolean;
  createdAt: string;
  modifiedAt: string;
}

// ============================================================================
// SVG-Based Title Block Templates
// ============================================================================

/**
 * Field mapping for SVG title block placeholder
 */
export interface SVGFieldMapping {
  /** Internal field ID (e.g., "project", "scale") */
  fieldId: string;
  /** The SVG element ID or placeholder text pattern */
  svgSelector: string;
  /** Display label for the field */
  label: string;
  /** Default value */
  defaultValue: string;
  /** Whether this is an auto-calculated field */
  isAutoField?: boolean;
  /** Auto-field type if applicable */
  autoFieldType?: 'date' | 'sheetNumber' | 'scale' | 'projectName';
}

/**
 * SVG-based title block template
 * Allows complex visual designs with logos, colors, and custom graphics
 */
export interface SVGTitleBlockTemplate {
  id: string;
  name: string;
  description: string;
  /** Compatible paper sizes */
  paperSizes: string[];
  /** The full SVG content as a string */
  svgContent: string;
  /** Width in mm */
  width: number;
  /** Height in mm */
  height: number;
  /** Field mappings - connects SVG placeholders to editable fields */
  fieldMappings: SVGFieldMapping[];
  /** Whether this is a built-in template */
  isBuiltIn: boolean;
  /** Whether this is a full-page template (covers entire sheet like Revit) */
  isFullPage?: boolean;
  /** Creation timestamp */
  createdAt: string;
  /** Last modified timestamp */
  modifiedAt: string;
  /** Optional preview thumbnail (base64 PNG) */
  thumbnail?: string;
}

/**
 * Enhanced title block that can use either grid-based or SVG template
 */
export interface SVGEnhancedTitleBlock {
  visible: boolean;
  /** Grid-based template ID (legacy) */
  templateId?: string;
  /** SVG-based template ID */
  svgTemplateId?: string;
  x: number;
  y: number;
  width: number;
  height: number;
  /** Field values (used by both template types) */
  fields: {
    id: string;
    label: string;
    value: string;
    x: number;
    y: number;
    width: number;
    height: number;
    fontSize: number;
    fontFamily: string;
    align: 'left' | 'center' | 'right';
  }[];
  /** Optional company logo (for grid-based templates) */
  logo?: {
    data: string;
    x: number;
    y: number;
    width: number;
    height: number;
  };
  /** Revision table */
  revisionTable?: RevisionTable;
}

// ============================================================================
// Sheet Set
// ============================================================================

/**
 * Sheet set for organizing and printing multiple sheets
 */
export interface SheetSet {
  id: string;
  name: string;
  description: string;
  /** Ordered list of sheet IDs */
  sheetIds: string[];
  createdAt: string;
  modifiedAt: string;
}

// ============================================================================
// Enhanced Sheet
// ============================================================================

/**
 * Enhanced sheet with annotations and templates
 */
export interface EnhancedSheet {
  id: string;
  name: string;
  /** Sheet number (e.g., "A-101") */
  number: string;
  paperSize: string;
  orientation: 'portrait' | 'landscape';
  customWidth?: number;
  customHeight?: number;
  viewports: EnhancedSheetViewport[];
  titleBlock: EnhancedTitleBlock;
  /** Sheet-level annotations */
  annotations: SheetAnnotation[];
  /** Template this sheet was created from */
  templateId?: string;
  createdAt: string;
  modifiedAt: string;
}
