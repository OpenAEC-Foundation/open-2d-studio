/**
 * Type Guards - Runtime type checking functions
 *
 * These guards enable safe type narrowing at runtime for:
 * - Shape type discrimination
 * - Annotation type discrimination
 * - Event type checking
 * - Data validation
 */

import type {
  Shape,
  LineShape,
  RectangleShape,
  CircleShape,
  ArcShape,
  EllipseShape,
  PolylineShape,
  SplineShape,
  TextShape,
  PointShape,
  ShapeType,
  Point,
  BoundingBox,
  Layer,
  Draft,
  Sheet,
  SheetViewport,
  TitleBlock,
  SnapPoint,
  SnapType,
  ToolType,
  EditorMode,
} from './geometry';

import type {
  SheetAnnotation,
  SheetTextAnnotation,
  SheetDimensionAnnotation,
  SheetLeaderAnnotation,
  SheetCalloutAnnotation,
  SheetSectionMarker,
  SheetRevisionCloud,
  EnhancedSheetViewport,
} from './sheet';

import type {
  DrawingCategory,
  DrawingView,
  EnhancedDrawing,
} from './drawing';

// ============================================================================
// Shape Type Guards
// ============================================================================

/**
 * Check if a shape is a line
 */
export function isLineShape(shape: Shape): shape is LineShape {
  return shape.type === 'line';
}

/**
 * Check if a shape is a rectangle
 */
export function isRectangleShape(shape: Shape): shape is RectangleShape {
  return shape.type === 'rectangle';
}

/**
 * Check if a shape is a circle
 */
export function isCircleShape(shape: Shape): shape is CircleShape {
  return shape.type === 'circle';
}

/**
 * Check if a shape is an arc
 */
export function isArcShape(shape: Shape): shape is ArcShape {
  return shape.type === 'arc';
}

/**
 * Check if a shape is an ellipse
 */
export function isEllipseShape(shape: Shape): shape is EllipseShape {
  return shape.type === 'ellipse';
}

/**
 * Check if a shape is a polyline
 */
export function isPolylineShape(shape: Shape): shape is PolylineShape {
  return shape.type === 'polyline';
}

/**
 * Check if a shape is a spline
 */
export function isSplineShape(shape: Shape): shape is SplineShape {
  return shape.type === 'spline';
}

/**
 * Check if a shape is a text
 */
export function isTextShape(shape: Shape): shape is TextShape {
  return shape.type === 'text';
}

/**
 * Check if a shape is a point
 */
export function isPointShape(shape: Shape): shape is PointShape {
  return shape.type === 'point';
}

/**
 * Check if a shape has a center property
 */
export function hasCenter(shape: Shape): shape is CircleShape | ArcShape | EllipseShape {
  return shape.type === 'circle' || shape.type === 'arc' || shape.type === 'ellipse';
}

/**
 * Check if a shape has radius property
 */
export function hasRadius(shape: Shape): shape is CircleShape | ArcShape {
  return shape.type === 'circle' || shape.type === 'arc';
}

/**
 * Check if a shape has rotation property
 */
export function hasRotation(shape: Shape): shape is RectangleShape | EllipseShape | TextShape {
  return shape.type === 'rectangle' || shape.type === 'ellipse' || shape.type === 'text';
}

/**
 * Check if a shape has points array
 */
export function hasPoints(shape: Shape): shape is PolylineShape | SplineShape {
  return shape.type === 'polyline' || shape.type === 'spline';
}

/**
 * Check if a shape can be filled
 */
export function canBeFilled(shape: Shape): shape is RectangleShape | CircleShape | EllipseShape | PolylineShape {
  return (
    shape.type === 'rectangle' ||
    shape.type === 'circle' ||
    shape.type === 'ellipse' ||
    (shape.type === 'polyline' && shape.closed)
  );
}

// ============================================================================
// Annotation Type Guards
// ============================================================================

/**
 * Check if an annotation is a text annotation
 */
export function isTextAnnotation(annotation: SheetAnnotation): annotation is SheetTextAnnotation {
  return annotation.type === 'text';
}

/**
 * Check if an annotation is a dimension annotation
 */
export function isDimensionAnnotation(annotation: SheetAnnotation): annotation is SheetDimensionAnnotation {
  return annotation.type === 'dimension';
}

/**
 * Check if an annotation is a leader annotation
 */
export function isLeaderAnnotation(annotation: SheetAnnotation): annotation is SheetLeaderAnnotation {
  return annotation.type === 'leader';
}

/**
 * Check if an annotation is a callout annotation
 */
export function isCalloutAnnotation(annotation: SheetAnnotation): annotation is SheetCalloutAnnotation {
  return annotation.type === 'callout';
}

/**
 * Check if an annotation is a section marker
 */
export function isSectionMarker(annotation: SheetAnnotation): annotation is SheetSectionMarker {
  return annotation.type === 'section-marker';
}

/**
 * Check if an annotation is a revision cloud
 */
export function isRevisionCloud(annotation: SheetAnnotation): annotation is SheetRevisionCloud {
  return annotation.type === 'revision-cloud';
}

// ============================================================================
// Primitive Type Guards
// ============================================================================

/**
 * Check if a value is a valid Point
 */
export function isPoint(value: unknown): value is Point {
  return (
    typeof value === 'object' &&
    value !== null &&
    'x' in value &&
    'y' in value &&
    typeof (value as Point).x === 'number' &&
    typeof (value as Point).y === 'number'
  );
}

/**
 * Check if a value is a valid BoundingBox
 */
export function isBoundingBox(value: unknown): value is BoundingBox {
  return (
    typeof value === 'object' &&
    value !== null &&
    'minX' in value &&
    'minY' in value &&
    'maxX' in value &&
    'maxY' in value &&
    typeof (value as BoundingBox).minX === 'number' &&
    typeof (value as BoundingBox).minY === 'number' &&
    typeof (value as BoundingBox).maxX === 'number' &&
    typeof (value as BoundingBox).maxY === 'number'
  );
}

// ============================================================================
// Entity Type Guards
// ============================================================================

/**
 * Check if a value is a valid Layer
 */
export function isLayer(value: unknown): value is Layer {
  return (
    typeof value === 'object' &&
    value !== null &&
    'id' in value &&
    'name' in value &&
    ('drawingId' in value || 'draftId' in value) &&
    'visible' in value &&
    'locked' in value &&
    'color' in value &&
    typeof (value as Layer).id === 'string' &&
    typeof (value as Layer).name === 'string'
  );
}

/**
 * Check if a value is a valid Drawing
 */
export function isDrawing(value: unknown): value is Draft {
  return (
    typeof value === 'object' &&
    value !== null &&
    'id' in value &&
    'name' in value &&
    'boundary' in value &&
    typeof (value as Draft).id === 'string' &&
    typeof (value as Draft).name === 'string'
  );
}

/** @deprecated Use isDrawing instead */
export const isDraft = isDrawing;

/**
 * Check if a value is a valid EnhancedDrawing
 */
export function isEnhancedDrawing(value: unknown): value is EnhancedDrawing {
  return (
    isDrawing(value) &&
    'category' in value &&
    'views' in value &&
    'defaultScale' in value &&
    'metadata' in value &&
    'isTemplate' in value &&
    Array.isArray((value as EnhancedDrawing).views)
  );
}

/** @deprecated Use isEnhancedDrawing instead */
export const isEnhancedDraft = isEnhancedDrawing;

/**
 * Check if a value is a valid Sheet
 */
export function isSheet(value: unknown): value is Sheet {
  return (
    typeof value === 'object' &&
    value !== null &&
    'id' in value &&
    'name' in value &&
    'paperSize' in value &&
    'orientation' in value &&
    'viewports' in value &&
    'titleBlock' in value &&
    typeof (value as Sheet).id === 'string' &&
    typeof (value as Sheet).name === 'string' &&
    Array.isArray((value as Sheet).viewports)
  );
}

/**
 * Check if a value is a valid SheetViewport
 */
export function isSheetViewport(value: unknown): value is SheetViewport {
  return (
    typeof value === 'object' &&
    value !== null &&
    'id' in value &&
    ('drawingId' in value || 'draftId' in value) &&
    'x' in value &&
    'y' in value &&
    'width' in value &&
    'height' in value &&
    'scale' in value &&
    typeof (value as SheetViewport).id === 'string'
  );
}

/**
 * Check if a value is an EnhancedSheetViewport
 */
export function isEnhancedSheetViewport(value: unknown): value is EnhancedSheetViewport {
  return (
    isSheetViewport(value) &&
    ('cropRegion' in value || 'layerOverrides' in value || 'referenceNumber' in value)
  );
}

/**
 * Check if a value is a valid TitleBlock
 */
export function isTitleBlock(value: unknown): value is TitleBlock {
  return (
    typeof value === 'object' &&
    value !== null &&
    'visible' in value &&
    'x' in value &&
    'y' in value &&
    'width' in value &&
    'height' in value &&
    'fields' in value &&
    Array.isArray((value as TitleBlock).fields)
  );
}

// ============================================================================
// Snap Type Guards
// ============================================================================

/**
 * Check if a value is a valid SnapPoint
 */
export function isSnapPoint(value: unknown): value is SnapPoint {
  return (
    typeof value === 'object' &&
    value !== null &&
    'point' in value &&
    'type' in value &&
    isPoint((value as SnapPoint).point) &&
    isSnapType((value as SnapPoint).type)
  );
}

/**
 * Valid snap types
 */
const SNAP_TYPES: SnapType[] = [
  'grid', 'endpoint', 'midpoint', 'center',
  'intersection', 'perpendicular', 'tangent', 'nearest'
];

/**
 * Check if a value is a valid SnapType
 */
export function isSnapType(value: unknown): value is SnapType {
  return typeof value === 'string' && SNAP_TYPES.includes(value as SnapType);
}

// ============================================================================
// Tool Type Guards
// ============================================================================

/**
 * Valid tool types
 */
const TOOL_TYPES: ToolType[] = [
  'select', 'pan', 'line', 'rectangle', 'circle', 'arc',
  'polyline', 'ellipse', 'spline', 'text', 'move', 'copy', 'rotate',
  'scale', 'mirror', 'trim', 'extend', 'fillet', 'offset'
];

/**
 * Check if a value is a valid ToolType
 */
export function isToolType(value: unknown): value is ToolType {
  return typeof value === 'string' && TOOL_TYPES.includes(value as ToolType);
}

/**
 * Check if a tool is a drawing tool
 */
export function isDrawingTool(tool: ToolType): boolean {
  return ['line', 'rectangle', 'circle', 'arc', 'polyline', 'ellipse', 'spline', 'text'].includes(tool);
}

/**
 * Check if a tool is a modification tool
 */
export function isModificationTool(tool: ToolType): boolean {
  return ['move', 'copy', 'rotate', 'scale', 'mirror', 'trim', 'extend', 'fillet', 'offset'].includes(tool);
}

/**
 * Check if a tool is a selection tool
 */
export function isSelectionTool(tool: ToolType): boolean {
  return tool === 'select';
}

/**
 * Check if a tool is a navigation tool
 */
export function isNavigationTool(tool: ToolType): boolean {
  return tool === 'pan';
}

// ============================================================================
// Shape Type Guards
// ============================================================================

/**
 * Valid shape types
 */
const SHAPE_TYPES: ShapeType[] = [
  'line', 'rectangle', 'circle', 'arc', 'polyline', 'ellipse', 'spline', 'text', 'point'
];

/**
 * Check if a value is a valid ShapeType
 */
export function isShapeType(value: unknown): value is ShapeType {
  return typeof value === 'string' && SHAPE_TYPES.includes(value as ShapeType);
}

/**
 * Check if a value is a valid Shape
 */
export function isShape(value: unknown): value is Shape {
  return (
    typeof value === 'object' &&
    value !== null &&
    'id' in value &&
    'type' in value &&
    'layerId' in value &&
    ('drawingId' in value || 'draftId' in value) &&
    'style' in value &&
    isShapeType((value as Shape).type)
  );
}

// ============================================================================
// Editor Mode Guards
// ============================================================================

/**
 * Valid editor modes
 */
const EDITOR_MODES: EditorMode[] = ['drawing', 'sheet'];

/**
 * Check if a value is a valid EditorMode
 */
export function isEditorMode(value: unknown): value is EditorMode {
  return typeof value === 'string' && EDITOR_MODES.includes(value as EditorMode);
}

// ============================================================================
// Drawing Category Guards
// ============================================================================

/**
 * Valid drawing categories
 */
const DRAWING_CATEGORIES_LIST: DrawingCategory[] = [
  'floor-plan', 'ceiling-plan', 'section', 'elevation', 'detail',
  'drafting', '3d-view', 'schedule', 'legend', 'other'
];

/**
 * Check if a value is a valid DrawingCategory
 */
export function isDrawingCategory(value: unknown): value is DrawingCategory {
  return typeof value === 'string' && DRAWING_CATEGORIES_LIST.includes(value as DrawingCategory);
}

/** @deprecated Use isDrawingCategory instead */
export const isDraftCategory = isDrawingCategory;

// ============================================================================
// DrawingView Guards
// ============================================================================

/**
 * Check if a value is a valid DrawingView
 */
export function isDrawingView(value: unknown): value is DrawingView {
  return (
    typeof value === 'object' &&
    value !== null &&
    'id' in value &&
    'name' in value &&
    'viewport' in value &&
    'isDefault' in value &&
    typeof (value as DrawingView).id === 'string' &&
    typeof (value as DrawingView).name === 'string'
  );
}

/** @deprecated Use isDrawingView instead */
export const isDraftView = isDrawingView;

// ============================================================================
// Array Guards
// ============================================================================

/**
 * Check if all elements in an array are shapes
 */
export function isShapeArray(value: unknown): value is Shape[] {
  return Array.isArray(value) && value.every(isShape);
}

/**
 * Check if all elements in an array are points
 */
export function isPointArray(value: unknown): value is Point[] {
  return Array.isArray(value) && value.every(isPoint);
}

/**
 * Check if all elements in an array are layers
 */
export function isLayerArray(value: unknown): value is Layer[] {
  return Array.isArray(value) && value.every(isLayer);
}

// ============================================================================
// Utility Type Guards
// ============================================================================

/**
 * Check if a value is defined (not null or undefined)
 */
export function isDefined<T>(value: T | null | undefined): value is T {
  return value !== null && value !== undefined;
}

/**
 * Check if a value is a non-empty string
 */
export function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

/**
 * Check if a value is a positive number
 */
export function isPositiveNumber(value: unknown): value is number {
  return typeof value === 'number' && value > 0 && isFinite(value);
}

/**
 * Check if a value is a non-negative number
 */
export function isNonNegativeNumber(value: unknown): value is number {
  return typeof value === 'number' && value >= 0 && isFinite(value);
}

/**
 * Check if a value is a valid angle in radians
 */
export function isValidAngle(value: unknown): value is number {
  return typeof value === 'number' && isFinite(value);
}

/**
 * Check if a value is a valid color string
 */
export function isValidColor(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  // Check hex color
  if (/^#[0-9A-Fa-f]{3}$|^#[0-9A-Fa-f]{6}$|^#[0-9A-Fa-f]{8}$/.test(value)) return true;
  // Check rgb/rgba
  if (/^rgba?\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*(,\s*[\d.]+\s*)?\)$/.test(value)) return true;
  // Check named colors (simplified check)
  const namedColors = ['red', 'green', 'blue', 'white', 'black', 'yellow', 'cyan', 'magenta', 'transparent'];
  return namedColors.includes(value.toLowerCase());
}
