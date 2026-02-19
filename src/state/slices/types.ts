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
  DrawingType,
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
  WallJustification,
} from '../../types/geometry';
import type { StateCreator } from 'zustand';
import { CAD_DEFAULT_FONT } from '../../constants/cadDefaults';

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
  DrawingType,
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
  WallJustification,
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
  | { type: 'leader'; points: Point[]; currentPoint: Point; textPosition?: Point }
  | { type: 'beam'; start: Point; end: Point; flangeWidth: number; showCenterline: boolean; bulge?: number }
  | { type: 'gridline'; start: Point; end: Point; label: string; bubblePosition: 'start' | 'end' | 'both'; bubbleRadius: number }
  | { type: 'level'; start: Point; end: Point; label: string; labelPosition: 'start' | 'end' | 'both'; bubbleRadius: number }
  | { type: 'pile'; position: Point; diameter: number; label: string; fontSize: number; showCross: boolean }
  | { type: 'cpt'; position: Point; name: string; fontSize: number; markerSize: number }
  | { type: 'wall'; start: Point; end: Point; thickness: number; showCenterline: boolean; wallTypeId?: string; justification?: WallJustification; bulge?: number }
  | { type: 'wall-rectangle'; corner1: Point; corner2: Point; thickness: number; showCenterline: boolean; wallTypeId?: string; justification?: WallJustification }
  | { type: 'beam-rectangle'; corner1: Point; corner2: Point; flangeWidth: number; showCenterline: boolean }
  | { type: 'wall-circle'; center: Point; radius: number; thickness: number; showCenterline: boolean; wallTypeId?: string; justification?: WallJustification }
  | { type: 'beam-circle'; center: Point; radius: number; flangeWidth: number; showCenterline: boolean }
  | { type: 'slab'; points: Point[]; currentPoint: Point; material?: string }
  | { type: 'plate-system'; points: Point[]; currentPoint: Point; systemType: string; mainProfile: { width: number; spacing: number; direction: number }; edgeWidth?: number; bulges?: number[]; currentBulge?: number; arcThroughPoint?: Point }
  | { type: 'section-callout'; start: Point; end: Point; label: string; bubbleRadius: number; flipDirection: boolean; viewDepth?: number }
  | { type: 'spot-elevation'; position: Point; elevation: number; labelPosition: Point; showLeader: boolean }
  | { type: 'modifyPreview'; shapes: Shape[]; basePoint?: Point; currentPoint?: Point }
  | { type: 'mirrorAxis'; start: Point; end: Point; shapes: Shape[] }
  | { type: 'rotateGuide'; center: Point; startRay?: Point; endRay: Point; angle?: number; shapes: Shape[] }
  | { type: 'scaleGuide'; origin: Point; refPoint?: Point; currentPoint: Point; factor?: number; shapes: Shape[] }
  | { type: 'elasticBox'; start: Point; end: Point }
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
  isMoving: boolean;                   // Whether viewport is being moved via command
  moveBasePoint: Point | null;         // Base point for move operation
  moveSnappedPos: Point | null;        // Snapped destination position
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
  x: -5000,
  y: -5000,
  width: 10000,
  height: 10000,
};

// Default drawing scale (1:100 = 0.01, means 10000 drawing units = 100mm on sheet)
export const DEFAULT_DRAWING_SCALE = 0.01;

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
    case 'text': {
      // For annotation text, fontSize is in paper mm — scale up by 1/DEFAULT_DRAWING_SCALE
      // to approximate drawing units. Model text uses fontSize directly.
      const effectiveSize = shape.isModelText ? shape.fontSize : shape.fontSize / DEFAULT_DRAWING_SCALE;
      return {
        minX: shape.position.x,
        minY: shape.position.y - effectiveSize,
        maxX: shape.position.x + shape.text.length * effectiveSize * 0.6,
        maxY: shape.position.y,
      };
    }
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
    case 'image':
      return {
        minX: shape.position.x,
        minY: shape.position.y,
        maxX: shape.position.x + shape.width,
        maxY: shape.position.y + shape.height,
      };
    case 'gridline': {
      const r = shape.bubbleRadius || 0;
      return {
        minX: Math.min(shape.start.x, shape.end.x) - r,
        minY: Math.min(shape.start.y, shape.end.y) - r,
        maxX: Math.max(shape.start.x, shape.end.x) + r,
        maxY: Math.max(shape.start.y, shape.end.y) + r,
      };
    }
    case 'pile': {
      const pr = shape.diameter / 2;
      return {
        minX: shape.position.x - pr,
        minY: shape.position.y - pr,
        maxX: shape.position.x + pr,
        maxY: shape.position.y + pr,
      };
    }
    case 'wall': {
      const wAngle = Math.atan2(shape.end.y - shape.start.y, shape.end.x - shape.start.x);
      const wPerpUnitX = Math.sin(wAngle);
      const wPerpUnitY = Math.cos(wAngle);
      // Determine how much thickness goes to each side based on justification
      let wLeftThick: number;
      let wRightThick: number;
      if (shape.justification === 'left') {
        wLeftThick = shape.thickness;
        wRightThick = 0;
      } else if (shape.justification === 'right') {
        wLeftThick = 0;
        wRightThick = shape.thickness;
      } else {
        wLeftThick = shape.thickness / 2;
        wRightThick = shape.thickness / 2;
      }
      const wCorners = [
        { x: shape.start.x + wPerpUnitX * wLeftThick, y: shape.start.y - wPerpUnitY * wLeftThick },
        { x: shape.start.x - wPerpUnitX * wRightThick, y: shape.start.y + wPerpUnitY * wRightThick },
        { x: shape.end.x + wPerpUnitX * wLeftThick, y: shape.end.y - wPerpUnitY * wLeftThick },
        { x: shape.end.x - wPerpUnitX * wRightThick, y: shape.end.y + wPerpUnitY * wRightThick },
      ];
      return {
        minX: Math.min(...wCorners.map(c => c.x)),
        minY: Math.min(...wCorners.map(c => c.y)),
        maxX: Math.max(...wCorners.map(c => c.x)),
        maxY: Math.max(...wCorners.map(c => c.y)),
      };
    }
    case 'slab': {
      if (shape.points.length === 0) return null;
      const sxs = shape.points.map(p => p.x);
      const sys = shape.points.map(p => p.y);
      return {
        minX: Math.min(...sxs),
        minY: Math.min(...sys),
        maxX: Math.max(...sxs),
        maxY: Math.max(...sys),
      };
    }
    case 'spot-elevation': {
      const seShape = shape as import('../../types/geometry').SpotElevationShape;
      const ms = seShape.markerSize || 200;
      return {
        minX: Math.min(seShape.position.x, seShape.labelPosition.x) - ms,
        minY: Math.min(seShape.position.y, seShape.labelPosition.y) - ms,
        maxX: Math.max(seShape.position.x, seShape.labelPosition.x) + ms,
        maxY: Math.max(seShape.position.y, seShape.labelPosition.y) + ms,
      };
    }
    default:
      return null;
  }
};

// Default title block fields — professional engineering-style layout
// 170mm x 36mm, positioned 10mm from right and bottom paper edges (flush with drawing frame)
export const createDefaultTitleBlock = (): TitleBlock => ({
  visible: true,
  x: 10,
  y: 10,
  width: 170,
  height: 36,
  fields: [
    // Row 1 (0–14mm): Drawing title (prominent) | Drawing No + Revision
    { id: 'title', label: 'Drawing Title', value: '', x: 3, y: 2, width: 117, height: 12, fontSize: 14, fontFamily: CAD_DEFAULT_FONT, align: 'left' },
    { id: 'number', label: 'Drawing No.', value: '', x: 126, y: 1, width: 41, height: 7, fontSize: 10, fontFamily: CAD_DEFAULT_FONT, align: 'left' },
    { id: 'revision', label: 'Rev', value: '-', x: 126, y: 8, width: 41, height: 5, fontSize: 9, fontFamily: CAD_DEFAULT_FONT, align: 'left' },
    // Row 2 (14–25mm): Project | Client | Scale | Sheet
    { id: 'project', label: 'Project', value: '', x: 3, y: 16, width: 57, height: 9, fontSize: 10, fontFamily: CAD_DEFAULT_FONT, align: 'left' },
    { id: 'client', label: 'Client', value: '', x: 66, y: 16, width: 54, height: 9, fontSize: 10, fontFamily: CAD_DEFAULT_FONT, align: 'left' },
    { id: 'scale', label: 'Scale', value: '1:100', x: 126, y: 16, width: 19, height: 9, fontSize: 10, fontFamily: CAD_DEFAULT_FONT, align: 'left' },
    { id: 'sheet', label: 'Sheet', value: '1 of 1', x: 151, y: 16, width: 16, height: 9, fontSize: 10, fontFamily: CAD_DEFAULT_FONT, align: 'left' },
    // Row 3 (25–36mm): Drawn | Date | Checked | Approved | Status
    { id: 'drawn', label: 'Drawn', value: '', x: 3, y: 27, width: 32, height: 7, fontSize: 9, fontFamily: CAD_DEFAULT_FONT, align: 'left' },
    { id: 'date', label: 'Date', value: '', x: 41, y: 27, width: 24, height: 7, fontSize: 9, fontFamily: CAD_DEFAULT_FONT, align: 'left' },
    { id: 'checked', label: 'Checked', value: '', x: 71, y: 27, width: 29, height: 7, fontSize: 9, fontFamily: CAD_DEFAULT_FONT, align: 'left' },
    { id: 'approved', label: 'Approved', value: '', x: 106, y: 27, width: 29, height: 7, fontSize: 9, fontFamily: CAD_DEFAULT_FONT, align: 'left' },
    { id: 'status', label: 'Status', value: 'DRAFT', x: 141, y: 27, width: 26, height: 7, fontSize: 9, fontFamily: CAD_DEFAULT_FONT, align: 'left' },
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
    fontFamily: 'Osifont',
    fontSize: 2.5,
    bold: false,
    italic: false,
    underline: false,
    color: '#ffffff',
    alignment: 'left',
    verticalAlignment: 'top',
    lineHeight: 1.4,
    isModelText: false,
    backgroundMask: false,
    backgroundColor: '#1a1a2e',
    backgroundPadding: 0.5,
    isBuiltIn: true,
  },
  {
    id: 'annotation-medium',
    name: '3.5mm Annotation',
    fontFamily: 'Osifont',
    fontSize: 3.5,
    bold: false,
    italic: false,
    underline: false,
    color: '#ffffff',
    alignment: 'left',
    verticalAlignment: 'top',
    lineHeight: 1.4,
    isModelText: false,
    backgroundMask: false,
    backgroundColor: '#1a1a2e',
    backgroundPadding: 0.5,
    isBuiltIn: true,
  },
  {
    id: 'annotation-large',
    name: '5mm Annotation',
    fontFamily: 'Osifont',
    fontSize: 5,
    bold: false,
    italic: false,
    underline: false,
    color: '#ffffff',
    alignment: 'left',
    verticalAlignment: 'top',
    lineHeight: 1.4,
    isModelText: false,
    backgroundMask: false,
    backgroundColor: '#1a1a2e',
    backgroundPadding: 0.5,
    isBuiltIn: true,
  },
  {
    id: 'title-text',
    name: 'Title (7mm Bold)',
    fontFamily: 'Osifont',
    fontSize: 7,
    bold: true,
    italic: false,
    underline: false,
    color: '#ffffff',
    alignment: 'left',
    verticalAlignment: 'top',
    lineHeight: 1.4,
    isModelText: false,
    backgroundMask: false,
    backgroundColor: '#1a1a2e',
    backgroundPadding: 0.5,
    isBuiltIn: true,
  },
  {
    id: 'model-text-small',
    name: 'Model Text (100mm)',
    fontFamily: 'Osifont',
    fontSize: 100,
    bold: false,
    italic: false,
    underline: false,
    color: '#ffffff',
    alignment: 'left',
    verticalAlignment: 'top',
    lineHeight: 1.4,
    isModelText: true,
    backgroundMask: false,
    backgroundColor: '#1a1a2e',
    backgroundPadding: 5,
    isBuiltIn: true,
  },
  {
    id: 'model-text-large',
    name: 'Model Text (500mm)',
    fontFamily: 'Osifont',
    fontSize: 500,
    bold: false,
    italic: false,
    underline: false,
    color: '#ffffff',
    alignment: 'left',
    verticalAlignment: 'top',
    lineHeight: 1.4,
    isModelText: true,
    backgroundMask: false,
    backgroundColor: '#1a1a2e',
    backgroundPadding: 25,
    isBuiltIn: true,
  },
];
