/**
 * Renderer Types - Shared types for the rendering system
 */

import type {
  Shape,
  Viewport,
  SnapPoint,
  SnapType,
  Layer,
  Sheet,
  SheetViewport,
  Drawing,
  TitleBlock,
  DrawingBoundary,
  Point,
  CropRegion,
  ViewportLayerOverride,
} from '../../types/geometry';
import type { DrawingPreview, SelectionBox } from '../../state/appStore';

// Re-export for convenience
export type {
  Shape,
  Viewport,
  SnapPoint,
  SnapType,
  Layer,
  Sheet,
  SheetViewport,
  Drawing,
  TitleBlock,
  DrawingBoundary,
  Point,
  CropRegion,
  ViewportLayerOverride,
  DrawingPreview,
  SelectionBox,
};

// Legacy aliases
export type Draft = Drawing;
export type DraftBoundary = DrawingBoundary;

// Tracking line type (imported from geometry)
export interface TrackingLine {
  origin: Point;
  direction: Point;
  angle: number;
  type: 'polar' | 'parallel' | 'perpendicular' | 'extension';
}

// Boundary handle types for interactive editing
export type BoundaryHandleType =
  | 'top-left' | 'top' | 'top-right'
  | 'left' | 'center' | 'right'
  | 'bottom-left' | 'bottom' | 'bottom-right';

// Viewport handle types for sheet viewport manipulation
export type ViewportHandleType =
  | 'top-left' | 'top' | 'top-right'
  | 'left' | 'center' | 'right'
  | 'bottom-left' | 'bottom' | 'bottom-right';

// Handle position type
export interface HandlePosition {
  type: BoundaryHandleType | ViewportHandleType;
  x: number;
  y: number;
}

// Current style for drawing
export interface CurrentStyle {
  strokeColor: string;
  strokeWidth: number;
}

// Render options for drawing mode
export interface RenderOptions {
  shapes: Shape[];
  selectedShapeIds: string[];
  viewport: Viewport;
  gridVisible: boolean;
  gridSize: number;
  drawingPreview?: DrawingPreview;
  currentStyle?: CurrentStyle;
  selectionBox?: SelectionBox | null;
  currentSnapPoint?: SnapPoint | null;
  currentTrackingLines?: TrackingLine[];
  trackingPoint?: Point | null;
  layers?: Layer[];
  drawingBoundary?: DrawingBoundary | null;
  boundarySelected?: boolean;
  boundaryDragging?: boolean;
}

// Render options for sheet layout mode
export interface SheetRenderOptions {
  sheet: Sheet;
  drawings: Drawing[];
  shapes: Shape[];
  layers: Layer[];
  viewport: Viewport;
  selectedViewportId?: string | null;
  viewportDragging?: boolean;
  drawingViewports: Record<string, Viewport>;
  /** Whether crop region editing mode is active */
  cropRegionEditing?: boolean;
  /** ID of viewport being edited for crop region */
  cropRegionViewportId?: string | null;
}

// Render context - shared state for rendering
export interface RenderContext {
  ctx: CanvasRenderingContext2D;
  width: number;
  height: number;
  dpr: number;
  viewport: Viewport;
}

// Paper size dimensions in mm
export const PAPER_SIZES: Record<string, { width: number; height: number }> = {
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

// mm to pixels conversion (96 DPI / 25.4)
export const MM_TO_PIXELS = 3.78;

// Snap colors
export const SNAP_COLORS: Record<SnapType, string> = {
  endpoint: '#00ff00',     // Green
  midpoint: '#00ffff',     // Cyan
  center: '#ff00ff',       // Magenta
  intersection: '#ffff00', // Yellow
  perpendicular: '#ff8800', // Orange
  parallel: '#ff8800',     // Orange (same as perpendicular)
  tangent: '#88ff00',      // Lime
  nearest: '#ff88ff',      // Pink
  grid: '#8888ff',         // Light blue
  origin: '#ff4444',       // Red
};

// Snap labels
export const SNAP_LABELS: Record<SnapType, string> = {
  endpoint: 'Endpoint',
  midpoint: 'Midpoint',
  center: 'Center',
  intersection: 'Intersection',
  perpendicular: 'Perpendicular',
  parallel: 'Parallel',
  tangent: 'Tangent',
  nearest: 'Nearest',
  grid: 'Grid',
  origin: 'Origin',
};

// Line dash patterns (values in world/drawing units, e.g. mm)
// Defined at reference scale 1:100 (0.01). At other scales the pattern
// is adjusted so that dashes remain the same size on paper.
export const LINE_DASH_PATTERNS: Record<string, number[]> = {
  solid: [],
  dashed: [500, 250],
  dotted: [100, 150],
  dashdot: [500, 150, 100, 150],
};

// Reference drawing scale for LINE_DASH_PATTERNS values (1:100)
export const LINE_DASH_REFERENCE_SCALE = 0.01;

// Canvas colors
export const COLORS = {
  canvasBackground: '#1a1a2e',
  sheetBackground: '#2a2a3e',
  paperBackground: '#ffffff',
  paperBorder: '#888888',
  gridMinor: '#2a2a4a',
  gridMajor: '#3a3a5a',
  axisX: '#ff4444',
  axisY: '#44ff44',
  hover: '#00bfff',
  selection: '#00B400',
  selectionHandle: '#00B400',
  selectionHandleStroke: '#ffffff',
  commandPreview: '#00ff00',
  boundaryNormal: '#00bcd4',
  boundarySelected: '#ff6b35',
  viewportBorder: '#333333',
  viewportSelected: '#e94560',
  viewportBackground: '#fafafa',
  titleBlockBackground: '#f8f8f8',
  titleBlockBorder: '#000000',
  titleBlockLabel: '#666666',
  titleBlockValue: '#000000',
  windowSelection: 'rgba(0, 120, 215, 0.15)',
  windowSelectionBorder: 'rgba(0, 120, 215, 0.8)',
  crossingSelection: 'rgba(0, 180, 0, 0.15)',
  crossingSelectionBorder: 'rgba(0, 180, 0, 0.8)',
  handleCorner: '#2196f3',
  handleEdge: '#03a9f4',
  handleMove: '#4caf50',
  handleMoveViewport: '#4a90d9',
};
