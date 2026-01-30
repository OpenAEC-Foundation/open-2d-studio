/**
 * API-specific types for the CAD programmatic API
 */

import type { Point, Shape, ShapeType, ShapeStyle, BoundingBox } from '../types/geometry';

// Re-export commonly used types for API consumers
export type { Point, Shape, ShapeType, ShapeStyle, BoundingBox };
export type { Layer, Viewport, SnapType, ToolType, LineStyle } from '../types/geometry';
export type { Drawing, DrawingBoundary, Sheet, SheetViewport, EditorMode } from '../types/geometry';
export type { DimensionType, DimensionStyle, DimensionShape } from '../types/dimension';
export type { SheetAnnotation, SheetTextAnnotation, SheetLeaderAnnotation, SheetRevisionCloud } from '../types/sheet';

/**
 * Flexible point input - accepts {x, y} object or [x, y] tuple
 */
export type ApiPoint = Point | [number, number];

/**
 * Normalize an ApiPoint to a Point
 */
export function toPoint(input: ApiPoint): Point {
  if (Array.isArray(input)) {
    return { x: input[0], y: input[1] };
  }
  return input;
}

/**
 * Result of a command execution
 */
export interface CommandResult {
  success: boolean;
  error?: string;
  data?: unknown;
}

/**
 * Filter for querying entities
 */
export interface EntityFilter {
  type?: ShapeType;
  layer?: string;
  drawing?: string;
  visible?: boolean;
  locked?: boolean;
  predicate?: (shape: Shape) => boolean;
}

/**
 * Subscription handle returned by event subscriptions
 */
export interface EventSubscription {
  unsubscribe: () => void;
}

/**
 * Recorded macro script
 */
export interface MacroScript {
  name: string;
  script: string;
  createdAt: string;
}
