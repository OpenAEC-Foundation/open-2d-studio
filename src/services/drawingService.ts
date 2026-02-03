/**
 * Drawing Service - Business logic for drawing (model space) operations
 *
 * Provides functions for:
 * - Creating drawings with proper defaults
 * - Managing drawing boundaries
 * - Querying shapes within drawings
 * - Calculating drawing bounds from shapes
 */

import type { Drawing, DrawingBoundary, Shape, Point } from '../types/geometry';
import { getShapesBounds, type ShapeBounds } from './shapeService';

/**
 * Generate a unique ID for drawings
 */
export function generateDrawingId(): string {
  return `drawing_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

// Legacy alias
export const generateDraftId = generateDrawingId;

/**
 * Default drawing boundary
 */
export const DEFAULT_BOUNDARY: DrawingBoundary = {
  x: -500,
  y: -500,
  width: 1000,
  height: 1000,
};

/**
 * Default drawing scale (1:50)
 */
export const DEFAULT_SCALE = 0.02;

/**
 * Create a new drawing
 */
export function createDrawing(
  name: string,
  boundary?: Partial<DrawingBoundary>,
  scale?: number
): Drawing {
  return {
    id: generateDrawingId(),
    name,
    boundary: {
      ...DEFAULT_BOUNDARY,
      ...boundary,
    },
    scale: scale ?? DEFAULT_SCALE,
    createdAt: new Date().toISOString(),
    modifiedAt: new Date().toISOString(),
  };
}

// Legacy alias
export const createDraft = createDrawing;

/**
 * Update drawing boundary
 */
export function updateDrawingBoundary(
  drawing: Drawing,
  boundary: Partial<DrawingBoundary>
): Drawing {
  return {
    ...drawing,
    boundary: {
      ...drawing.boundary,
      ...boundary,
    },
    modifiedAt: new Date().toISOString(),
  };
}

// Legacy alias
export const updateDraftBoundary = updateDrawingBoundary;

/**
 * Get shapes belonging to a drawing
 */
export function getDrawingShapes(shapes: Shape[], drawingId: string): Shape[] {
  return shapes.filter(shape => shape.drawingId === drawingId);
}

// Legacy alias
export const getDraftShapes = getDrawingShapes;

/**
 * Get visible shapes belonging to a drawing
 */
export function getVisibleDrawingShapes(shapes: Shape[], drawingId: string): Shape[] {
  return shapes.filter(shape => shape.drawingId === drawingId && shape.visible);
}

// Legacy alias
export const getVisibleDraftShapes = getVisibleDrawingShapes;

/**
 * Get shapes on a specific layer within a drawing
 */
export function getDrawingLayerShapes(
  shapes: Shape[],
  drawingId: string,
  layerId: string
): Shape[] {
  return shapes.filter(shape => shape.drawingId === drawingId && shape.layerId === layerId);
}

// Legacy alias
export const getDraftLayerShapes = getDrawingLayerShapes;

/**
 * Calculate the bounding box of all shapes in a drawing
 */
export function calculateDrawingBounds(shapes: Shape[], drawingId: string): ShapeBounds | null {
  const drawingShapes = getVisibleDrawingShapes(shapes, drawingId);
  return getShapesBounds(drawingShapes);
}

// Legacy alias
export const calculateDraftBounds = calculateDrawingBounds;

/**
 * Auto-fit drawing boundary to contain all shapes with padding
 */
export function fitBoundaryToShapes(
  shapes: Shape[],
  drawingId: string,
  padding: number = 50
): DrawingBoundary {
  const bounds = calculateDrawingBounds(shapes, drawingId);

  if (!bounds) {
    return { ...DEFAULT_BOUNDARY };
  }

  return {
    x: bounds.minX - padding,
    y: bounds.minY - padding,
    width: (bounds.maxX - bounds.minX) + padding * 2,
    height: (bounds.maxY - bounds.minY) + padding * 2,
  };
}

/**
 * Check if a point is inside the drawing boundary
 */
export function isPointInDrawingBoundary(point: Point, boundary: DrawingBoundary): boolean {
  return (
    point.x >= boundary.x &&
    point.x <= boundary.x + boundary.width &&
    point.y >= boundary.y &&
    point.y <= boundary.y + boundary.height
  );
}

// Legacy alias
export const isPointInDraftBoundary = isPointInDrawingBoundary;

/**
 * Check if a shape is completely inside the drawing boundary
 */
export function isShapeInDrawingBoundary(shape: Shape, boundary: DrawingBoundary): boolean {
  const shapeBounds = getShapesBounds([shape]);
  if (!shapeBounds) return false;

  return (
    shapeBounds.minX >= boundary.x &&
    shapeBounds.maxX <= boundary.x + boundary.width &&
    shapeBounds.minY >= boundary.y &&
    shapeBounds.maxY <= boundary.y + boundary.height
  );
}

// Legacy alias
export const isShapeInDraftBoundary = isShapeInDrawingBoundary;

/**
 * Get drawing statistics
 */
export function getDrawingStats(shapes: Shape[], drawingId: string): {
  totalShapes: number;
  visibleShapes: number;
  lockedShapes: number;
  shapesByType: Record<string, number>;
} {
  const drawingShapes = getDrawingShapes(shapes, drawingId);

  const stats = {
    totalShapes: drawingShapes.length,
    visibleShapes: drawingShapes.filter(s => s.visible).length,
    lockedShapes: drawingShapes.filter(s => s.locked).length,
    shapesByType: {} as Record<string, number>,
  };

  drawingShapes.forEach(shape => {
    stats.shapesByType[shape.type] = (stats.shapesByType[shape.type] || 0) + 1;
  });

  return stats;
}

// Legacy alias
export const getDraftStats = getDrawingStats;

/**
 * Copy shapes from one drawing to another
 */
export function copyShapesToDrawing(
  shapes: Shape[],
  targetDrawingId: string,
  _offset: Point = { x: 0, y: 0 }
): Shape[] {
  return shapes.map(shape => ({
    ...JSON.parse(JSON.stringify(shape)),
    id: `shape_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
    drawingId: targetDrawingId,
  }));
}

// Legacy alias
export const copyShapesToDraft = copyShapesToDrawing;

/**
 * Validate drawing data
 */
export function validateDrawing(drawing: Drawing): boolean {
  if (!drawing.id || !drawing.name) {
    return false;
  }

  if (!drawing.boundary) {
    return false;
  }

  const { x, y, width, height } = drawing.boundary;
  if (typeof x !== 'number' || typeof y !== 'number' ||
      typeof width !== 'number' || typeof height !== 'number') {
    return false;
  }

  if (width <= 0 || height <= 0) {
    return false;
  }

  return true;
}

// Legacy alias
export const validateDraft = validateDrawing;

/**
 * Get the center of a drawing boundary
 */
export function getDrawingCenter(boundary: DrawingBoundary): Point {
  return {
    x: boundary.x + boundary.width / 2,
    y: boundary.y + boundary.height / 2,
  };
}

// Legacy alias
export const getDraftCenter = getDrawingCenter;

/**
 * Calculate zoom to fit drawing boundary in viewport
 */
export function calculateZoomToFit(
  boundary: DrawingBoundary,
  viewportWidth: number,
  viewportHeight: number,
  padding: number = 50
): { zoom: number; offsetX: number; offsetY: number } {
  const availableWidth = viewportWidth - padding * 2;
  const availableHeight = viewportHeight - padding * 2;

  const zoomX = availableWidth / boundary.width;
  const zoomY = availableHeight / boundary.height;
  const zoom = Math.min(zoomX, zoomY, 1); // Don't zoom in beyond 1:1

  const center = getDrawingCenter(boundary);
  const offsetX = viewportWidth / 2 - center.x * zoom;
  const offsetY = viewportHeight / 2 - center.y * zoom;

  return { zoom, offsetX, offsetY };
}
