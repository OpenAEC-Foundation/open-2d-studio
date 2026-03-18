/**
 * WeFC Type Definitions for Open-2D-Studio
 *
 * TypeScript interfaces for reading/writing .wefc files.
 * Only includes types needed for the 2D drawing domain.
 */

// ============================================================================
// File Structure
// ============================================================================

export interface WefcFile {
  header: WefcHeader;
  imports?: WefcImport[];
  schemas?: Record<string, unknown>;
  data: WefcNode[];
}

export interface WefcHeader {
  schema: 'WeFC';
  schemaVersion: string;
  fileId?: string;
  description?: string;
  author?: string;
  organization?: string;
  timestamp: string;
  application: string;
  applicationVersion: string;
  license?: string;
}

export interface WefcImport {
  uri: string;
  version: string;
  hash?: string;
}

// ============================================================================
// Base Node (WefcRoot fields)
// ============================================================================

export interface WefcNode {
  type: string;
  guid: string;
  name: string;
  version: string;
  created: string;
  modified: string;
  status: 'active' | 'draft' | 'superseded' | 'deleted';
  description?: string;
  tags?: string[];
  metadata?: Record<string, unknown>;
  [key: string]: unknown;
}

// ============================================================================
// Drawing Domain Types
// ============================================================================

export interface WefcDrawingSheet extends WefcNode {
  type: 'WefcDrawingSheet';
  sheetFormat?: string;
  orientation?: 'portrait' | 'landscape';
  scale?: number;
  viewports?: string[];  // wefc:// refs
}

export interface WefcViewport extends WefcNode {
  type: 'WefcViewport';
  drawingRef?: string;
  positionX?: number;
  positionY?: number;
  width?: number;
  height?: number;
  scale?: number;
  centerX?: number;
  centerY?: number;
}

export interface WefcLayer extends WefcNode {
  type: 'WefcLayer';
  visible?: boolean;
  locked?: boolean;
  color?: string;
  lineStyle?: string;
  lineWidth?: number;
  drawingRef?: string;
}

export interface WefcGraphicElement extends WefcNode {
  type: 'WefcGraphicElement';
  elementType: string;  // line, rectangle, circle, arc, polyline, ellipse, spline, point, image
  layerRef?: string;
  strokeColor?: string;
  strokeWidth?: number;
  lineStyle?: string;
  fillColor?: string;
  // Geometry varies by elementType - stored as generic properties
  [key: string]: unknown;
}

export interface WefcAnnotation extends WefcNode {
  type: 'WefcAnnotation';
  annotationType: string;  // text, label, leader, spot-elevation
  layerRef?: string;
  content?: string;
  positionX?: number;
  positionY?: number;
  fontSize?: number;
  fontFamily?: string;
  textAlign?: string;
  rotation?: number;
  [key: string]: unknown;
}

export interface WefcDimension extends WefcNode {
  type: 'WefcDimension';
  dimensionType: string;  // linear, radial, angular
  layerRef?: string;
  startX?: number;
  startY?: number;
  endX?: number;
  endY?: number;
  value?: number;
  unit?: string;
  textOverride?: string;
  [key: string]: unknown;
}

export interface WefcHatchPattern extends WefcNode {
  type: 'WefcHatchPattern';
  layerRef?: string;
  patternType?: string;
  patternAngle?: number;
  patternScale?: number;
  fillColor?: string;
  backgroundColor?: string;
  boundaryPoints?: Array<{ x: number; y: number }>;
  [key: string]: unknown;
}

// ============================================================================
// Building Domain Types (for structural elements)
// ============================================================================

export interface WefcWall extends WefcNode {
  type: 'WefcWall';
  wallType?: string;
  startX?: number;
  startY?: number;
  endX?: number;
  endY?: number;
  width?: number;
  height?: number;
  material?: string;
  isLoadBearing?: boolean;
  isExternal?: boolean;
  layerRef?: string;
  [key: string]: unknown;
}

export interface WefcBeam extends WefcNode {
  type: 'WefcBeam';
  beamType?: string;
  startX?: number;
  startY?: number;
  endX?: number;
  endY?: number;
  sectionProfile?: string;
  material?: string;
  flangeWidth?: number;
  justification?: string;
  layerRef?: string;
  [key: string]: unknown;
}

export interface WefcSlab extends WefcNode {
  type: 'WefcSlab';
  slabType?: string;
  thickness?: number;
  material?: string;
  boundaryPoints?: Array<{ x: number; y: number }>;
  layerRef?: string;
  [key: string]: unknown;
}

export interface WefcColumn extends WefcNode {
  type: 'WefcColumn';
  columnType?: string;
  positionX?: number;
  positionY?: number;
  width?: number;
  depth?: number;
  rotation?: number;
  material?: string;
  layerRef?: string;
  [key: string]: unknown;
}

// ============================================================================
// Relationship Types
// ============================================================================

export interface WefcRelationship extends WefcNode {
  relationType: string;
  source: string;   // wefc:// ref
  targets: string[]; // wefc:// refs
}

// ============================================================================
// Export Options
// ============================================================================

export interface WefcExportOptions {
  includeHiddenLayers?: boolean;
  includeLockedLayers?: boolean;
  author?: string;
  organization?: string;
  description?: string;
}
