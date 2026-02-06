/**
 * Shared types and utilities for state slices
 */

import type {
  Shape,
  Layer,
  Viewport,
  ToolType,
  Point,
  SnapType,
  SnapPoint,
  ShapeStyle,
  Drawing,
  DrawingBoundary,
  Sheet,
  SheetViewport,
  TitleBlock,
  TitleBlockField,
  EditorMode,
  PaperSize,
  PaperOrientation,
  CropRegion,
  ViewportLayerOverride,
  TextStyle,
} from '../../types/geometry';
import type { StateCreator } from 'zustand';

// Re-export types for convenience
export type {
  Shape,
  Layer,
  Viewport,
  ToolType,
  Point,
  SnapType,
  SnapPoint,
  ShapeStyle,
  Drawing,
  DrawingBoundary,
  Sheet,
  SheetViewport,
  TitleBlock,
  TitleBlockField,
  EditorMode,
  PaperSize,
  PaperOrientation,
  CropRegion,
  ViewportLayerOverride,
  TextStyle,
};

// Legacy aliases for backward compatibility
export type Draft = Drawing;
export type DraftBoundary = DrawingBoundary;

import type { DimensionType } from '../../types/dimension';

// Preview shape while drawing (before mouse up)
export type DrawingPreview =
  | { type: 'line'; start: Point; end: Point }
  | { type: 'rectangle'; start: Point; end: Point; cornerRadius?: number }
  | { type: 'rotatedRectangle'; corners: [Point, Point, Point, Point] }
  | { type: 'circle'; center: Point; radius: number }
  | { type: 'ellipse'; center: Point; radiusX: number; radiusY: number; rotation: number }
  | { type: 'arc'; center: Point; radius: number; startAngle: number; endAngle: number }
  | { type: 'polyline'; points: Point[]; currentPoint: Point; bulges?: number[]; currentBulge?: number; arcThroughPoint?: Point }
  | { type: 'spline'; points: Point[]; currentPoint: Point }
  | { type: 'text'; position: Point }
  | { type: 'dimension'; dimensionType: DimensionType; points: Point[]; dimensionLineOffset: number; linearDirection?: 'horizontal' | 'vertical'; value: string }
  | { type: 'hatch'; points: Point[]; currentPoint: Point }
  | { type: 'beam'; start: Point; end: Point; flangeWidth: number; showCenterline: boolean }
  | { type: 'modifyPreview'; shapes: Shape[] }
  | { type: 'mirrorAxis'; start: Point; end: Point; shapes: Shape[] }
  | { type: 'rotateGuide'; center: Point; startRay?: Point; endRay: Point; angle?: number; shapes: Shape[] }
  | { type: 'scaleGuide'; origin: Point; refPoint?: Point; currentPoint: Point; factor?: number; shapes: Shape[] }
  | null;

// Default text style for new text shapes
export interface DefaultTextStyle {
  fontFamily: string;
  fontSize: number;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  alignment: 'left' | 'center' | 'right';
  color: string;
}

// Selection box for box selection (window/crossing)
export type SelectionBoxMode = 'window' | 'crossing';
export interface SelectionBox {
  start: Point;      // Start point in screen coordinates
  end: Point;        // Current end point in screen coordinates
  mode: SelectionBoxMode;  // 'window' (left-to-right) or 'crossing' (right-to-left)
}

// Boundary handle types for interactive editing
export type BoundaryHandleType =
  | 'top-left' | 'top' | 'top-right'
  | 'left' | 'center' | 'right'
  | 'bottom-left' | 'bottom' | 'bottom-right';

// Boundary editing state
export interface BoundaryEditState {
  isEditing: boolean;              // Whether boundary editing mode is active
  isSelected: boolean;             // Whether the boundary is selected (shows handles)
  activeHandle: BoundaryHandleType | null;  // Which handle is being dragged
  dragStart: Point | null;         // Mouse position when drag started (world coords)
  originalBoundary: DrawingBoundary | null;   // Boundary state before drag started
}

// Viewport handle types for interactive editing
export type ViewportHandleType =
  | 'top-left' | 'top' | 'top-right'
  | 'left' | 'center' | 'right'
  | 'bottom-left' | 'bottom' | 'bottom-right';

// Viewport editing state (for sheet viewports)
export interface ViewportEditState {
  selectedViewportId: string | null;   // Currently selected viewport on active sheet
  activeHandle: ViewportHandleType | null;  // Which handle is being dragged
  isDragging: boolean;                 // Whether viewport is being moved/resized
  dragStart: Point | null;             // Mouse position when drag started (sheet mm coords)
  originalViewport: SheetViewport | null;   // Viewport state before drag started
}

// ============================================================================
// Crop Region Editing
// ============================================================================

// Crop region handle types for interactive editing
export type CropRegionHandleType =
  | 'top-left' | 'top' | 'top-right'
  | 'left' | 'right'
  | 'bottom-left' | 'bottom' | 'bottom-right';

// Crop region editing state
export interface CropRegionEditState {
  isEditing: boolean;                        // Whether crop region editing mode is active
  viewportId: string | null;                 // Which viewport's crop region is being edited
  activeHandle: CropRegionHandleType | null; // Which handle is being dragged
  isDragging: boolean;                       // Whether crop region is being resized
  dragStart: Point | null;                   // Position when drag started (draft coords)
  originalCropRegion: CropRegion | null;     // Crop region state before drag started
}

// ============================================================================
// Layer Override Editing
// ============================================================================

// Layer override editing state
export interface LayerOverrideEditState {
  isEditing: boolean;                        // Whether layer override editing mode is active
  viewportId: string | null;                 // Which viewport's layers are being edited
}

// Tracking line type
export interface TrackingLine {
  origin: Point;
  direction: Point;
  angle: number;
  type: 'polar' | 'parallel' | 'perpendicular' | 'extension';
}

// Generate unique IDs
let idCounter = 0;
export const generateId = (): string => {
  return `${Date.now()}-${++idCounter}`;
};

// Default style
export const defaultStyle: ShapeStyle = {
  strokeColor: '#ffffff',
  strokeWidth: 1,
  lineStyle: 'solid',
};

// Default drawing boundary (in drawing units - typically mm or a unitless coordinate system)
export const DEFAULT_DRAWING_BOUNDARY: DrawingBoundary = {
  x: -500,
  y: -500,
  width: 1000,
  height: 1000,
};

// Default drawing scale (1:50 = 0.02, means 1000 drawing units = 20mm on sheet)
export const DEFAULT_DRAWING_SCALE = 0.02;

// Legacy alias for backward compatibility
export const DEFAULT_DRAFT_BOUNDARY = DEFAULT_DRAWING_BOUNDARY;

// Paper size dimensions in mm (width x height for portrait)
export const PAPER_SIZES: Record<PaperSize, { width: number; height: number }> = {
  'A4': { width: 210, height: 297 },
  'A3': { width: 297, height: 420 },
  'A2': { width: 420, height: 594 },
  'A1': { width: 594, height: 841 },
  'A0': { width: 841, height: 1189 },
  'Letter': { width: 216, height: 279 },
  'Legal': { width: 216, height: 356 },
  'Tabloid': { width: 279, height: 432 },
  'Custom': { width: 210, height: 297 },
};

// Deep clone helper for shapes
export const cloneShapes = (shapes: Shape[]): Shape[] => {
  return JSON.parse(JSON.stringify(shapes));
};

// Get bounding box of a shape
export const getShapeBounds = (shape: Shape): { minX: number; minY: number; maxX: number; maxY: number } | null => {
  switch (shape.type) {
    case 'line':
      return {
        minX: Math.min(shape.start.x, shape.end.x),
        minY: Math.min(shape.start.y, shape.end.y),
        maxX: Math.max(shape.start.x, shape.end.x),
        maxY: Math.max(shape.start.y, shape.end.y),
      };
    case 'rectangle':
      return {
        minX: shape.topLeft.x,
        minY: shape.topLeft.y,
        maxX: shape.topLeft.x + shape.width,
        maxY: shape.topLeft.y + shape.height,
      };
    case 'circle':
      return {
        minX: shape.center.x - shape.radius,
        minY: shape.center.y - shape.radius,
        maxX: shape.center.x + shape.radius,
        maxY: shape.center.y + shape.radius,
      };
    case 'ellipse':
      return {
        minX: shape.center.x - shape.radiusX,
        minY: shape.center.y - shape.radiusY,
        maxX: shape.center.x + shape.radiusX,
        maxY: shape.center.y + shape.radiusY,
      };
    case 'arc':
      return {
        minX: shape.center.x - shape.radius,
        minY: shape.center.y - shape.radius,
        maxX: shape.center.x + shape.radius,
        maxY: shape.center.y + shape.radius,
      };
    case 'polyline':
    case 'spline':
      if (shape.points.length === 0) return null;
      const xs = shape.points.map(p => p.x);
      const ys = shape.points.map(p => p.y);
      return {
        minX: Math.min(...xs),
        minY: Math.min(...ys),
        maxX: Math.max(...xs),
        maxY: Math.max(...ys),
      };
    case 'text':
      return {
        minX: shape.position.x,
        minY: shape.position.y - shape.fontSize,
        maxX: shape.position.x + shape.text.length * shape.fontSize * 0.6,
        maxY: shape.position.y,
      };
    case 'point':
      return {
        minX: shape.position.x,
        minY: shape.position.y,
        maxX: shape.position.x,
        maxY: shape.position.y,
      };
    case 'hatch': {
      if (shape.points.length === 0) return null;
      const hxs = shape.points.map(p => p.x);
      const hys = shape.points.map(p => p.y);
      return {
        minX: Math.min(...hxs),
        minY: Math.min(...hys),
        maxX: Math.max(...hxs),
        maxY: Math.max(...hys),
      };
    }
    case 'dimension':
      if (shape.points.length === 0) return null;
      const dimXs = shape.points.map(p => p.x);
      const dimYs = shape.points.map(p => p.y);
      // Include offset for dimension line
      const offset = Math.abs(shape.dimensionLineOffset || 0);
      return {
        minX: Math.min(...dimXs) - offset,
        minY: Math.min(...dimYs) - offset,
        maxX: Math.max(...dimXs) + offset,
        maxY: Math.max(...dimYs) + offset,
      };
    case 'beam': {
      // Calculate bounding box including flange width
      const beamHalfWidth = shape.flangeWidth / 2;
      const angle = Math.atan2(shape.end.y - shape.start.y, shape.end.x - shape.start.x);
      const perpX = Math.sin(angle) * beamHalfWidth;
      const perpY = Math.cos(angle) * beamHalfWidth;
      const corners = [
        { x: shape.start.x + perpX, y: shape.start.y - perpY },
        { x: shape.start.x - perpX, y: shape.start.y + perpY },
        { x: shape.end.x + perpX, y: shape.end.y - perpY },
        { x: shape.end.x - perpX, y: shape.end.y + perpY },
      ];
      return {
        minX: Math.min(...corners.map(c => c.x)),
        minY: Math.min(...corners.map(c => c.y)),
        maxX: Math.max(...corners.map(c => c.x)),
        maxY: Math.max(...corners.map(c => c.y)),
      };
    }
    default:
      return null;
  }
};

// Default title block fields
export const createDefaultTitleBlock = (): TitleBlock => ({
  visible: true,
  x: 10,
  y: 10,
  width: 180,
  height: 60,
  fields: [
    // Row 1: Project info
    { id: 'project', label: 'Project', value: '', x: 5, y: 5, width: 85, height: 12, fontSize: 11, fontFamily: 'Arial', align: 'left' },
    { id: 'client', label: 'Client', value: '', x: 95, y: 5, width: 80, height: 12, fontSize: 10, fontFamily: 'Arial', align: 'left' },
    // Row 2: Drawing title
    { id: 'title', label: 'Drawing Title', value: '', x: 5, y: 20, width: 120, height: 12, fontSize: 12, fontFamily: 'Arial', align: 'left' },
    { id: 'number', label: 'Drawing No.', value: '', x: 130, y: 20, width: 45, height: 12, fontSize: 10, fontFamily: 'Arial', align: 'left' },
    // Row 3: Details
    { id: 'scale', label: 'Scale', value: '1:100', x: 5, y: 35, width: 30, height: 10, fontSize: 10, fontFamily: 'Arial', align: 'left' },
    { id: 'date', label: 'Date', value: '', x: 40, y: 35, width: 35, height: 10, fontSize: 10, fontFamily: 'Arial', align: 'left' },
    { id: 'drawn', label: 'Drawn', value: '', x: 80, y: 35, width: 30, height: 10, fontSize: 10, fontFamily: 'Arial', align: 'left' },
    { id: 'checked', label: 'Checked', value: '', x: 115, y: 35, width: 30, height: 10, fontSize: 10, fontFamily: 'Arial', align: 'left' },
    { id: 'approved', label: 'Approved', value: '', x: 150, y: 35, width: 25, height: 10, fontSize: 10, fontFamily: 'Arial', align: 'left' },
    // Row 4: Sheet info and revision
    { id: 'sheet', label: 'Sheet', value: '1 of 1', x: 5, y: 48, width: 40, height: 10, fontSize: 10, fontFamily: 'Arial', align: 'left' },
    { id: 'revision', label: 'Revision', value: '', x: 50, y: 48, width: 30, height: 10, fontSize: 10, fontFamily: 'Arial', align: 'left' },
    { id: 'status', label: 'Status', value: 'DRAFT', x: 130, y: 48, width: 45, height: 10, fontSize: 10, fontFamily: 'Arial', align: 'left' },
  ],
});

// Type for slice state creator with immer
export type ImmerStateCreator<T> = StateCreator<T, [['zustand/immer', never]], [], T>;

// Type for creating a slice that can access the full store
export type SliceCreator<TSlice, TStore = TSlice> = (
  set: (fn: (state: TStore) => void) => void,
  get: () => TStore
) => TSlice;

// Built-in Text Styles
export const createDefaultTextStyles = (): TextStyle[] => [
  {
    id: 'annotation-small',
    name: '2.5mm Annotation',
    fontFamily: 'Arial',
    fontSize: 2.5,
    bold: false,
    italic: false,
    underline: false,
    color: '#ffffff',
    alignment: 'left',
    verticalAlignment: 'top',
    lineHeight: 1.2,
    isModelText: false,
    backgroundMask: false,
    backgroundColor: '#1a1a2e',
    backgroundPadding: 0.5,
    isBuiltIn: true,
  },
  {
    id: 'annotation-medium',
    name: '3.5mm Annotation',
    fontFamily: 'Arial',
    fontSize: 3.5,
    bold: false,
    italic: false,
    underline: false,
    color: '#ffffff',
    alignment: 'left',
    verticalAlignment: 'top',
    lineHeight: 1.2,
    isModelText: false,
    backgroundMask: false,
    backgroundColor: '#1a1a2e',
    backgroundPadding: 0.5,
    isBuiltIn: true,
  },
  {
    id: 'annotation-large',
    name: '5mm Annotation',
    fontFamily: 'Arial',
    fontSize: 5,
    bold: false,
    italic: false,
    underline: false,
    color: '#ffffff',
    alignment: 'left',
    verticalAlignment: 'top',
    lineHeight: 1.2,
    isModelText: false,
    backgroundMask: false,
    backgroundColor: '#1a1a2e',
    backgroundPadding: 0.5,
    isBuiltIn: true,
  },
  {
    id: 'title-text',
    name: 'Title (7mm Bold)',
    fontFamily: 'Arial',
    fontSize: 7,
    bold: true,
    italic: false,
    underline: false,
    color: '#ffffff',
    alignment: 'left',
    verticalAlignment: 'top',
    lineHeight: 1.2,
    isModelText: false,
    backgroundMask: false,
    backgroundColor: '#1a1a2e',
    backgroundPadding: 0.5,
    isBuiltIn: true,
  },
  {
    id: 'model-text-small',
    name: 'Model Text (100mm)',
    fontFamily: 'Arial',
    fontSize: 100,
    bold: false,
    italic: false,
    underline: false,
    color: '#ffffff',
    alignment: 'left',
    verticalAlignment: 'top',
    lineHeight: 1.2,
    isModelText: true,
    backgroundMask: false,
    backgroundColor: '#1a1a2e',
    backgroundPadding: 5,
    isBuiltIn: true,
  },
  {
    id: 'model-text-large',
    name: 'Model Text (500mm)',
    fontFamily: 'Arial',
    fontSize: 500,
    bold: false,
    italic: false,
    underline: false,
    color: '#ffffff',
    alignment: 'left',
    verticalAlignment: 'top',
    lineHeight: 1.2,
    isModelText: true,
    backgroundMask: false,
    backgroundColor: '#1a1a2e',
    backgroundPadding: 25,
    isBuiltIn: true,
  },
];
