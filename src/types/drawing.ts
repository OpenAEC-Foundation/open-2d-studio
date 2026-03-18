/**
 * Drawing Types - Enhanced types for drawings
 *
 * These types support drawing functionality including:
 * - Named views within drawings
 * - Drawing boundaries (regions)
 * - Drawing categories and metadata
 */

import type { Point, Viewport } from './geometry';

// ============================================================================
// Drawing Boundary
// ============================================================================

/**
 * Drawing boundary - defines the visible region when placed on sheets
 * This is the "crop region" for the drawing
 */
export interface DrawingBoundary {
  /** Left edge in drawing coordinates */
  x: number;
  /** Top edge in drawing coordinates */
  y: number;
  /** Width in drawing units */
  width: number;
  /** Height in drawing units */
  height: number;
}

/**
 * Default drawing boundary values
 */
export const DEFAULT_DRAWING_BOUNDARY: DrawingBoundary = {
  x: -500,
  y: -500,
  width: 1000,
  height: 1000,
};

// ============================================================================
// Drawing Views
// ============================================================================

/**
 * Named view within a drawing (saved camera position)
 */
export interface DrawingView {
  id: string;
  /** View name (e.g., "Overall", "Detail A", "North Elevation") */
  name: string;
  /** Viewport state for this view */
  viewport: Viewport;
  /** Optional custom boundary for this view */
  boundary?: DrawingBoundary;
  /** View description */
  description?: string;
  /** Whether this is the default view */
  isDefault: boolean;
  createdAt: string;
  modifiedAt: string;
}

// ============================================================================
// Drawing Categories
// ============================================================================

/**
 * Drawing category for organization
 */
export type DrawingCategory =
  | 'floor-plan'
  | 'ceiling-plan'
  | 'section'
  | 'elevation'
  | 'detail'
  | 'drafting'
  | '3d-view'
  | 'schedule'
  | 'legend'
  | 'other';

/**
 * Drawing category metadata
 */
export interface DrawingCategoryInfo {
  id: DrawingCategory;
  name: string;
  description: string;
  icon?: string;
}

/**
 * All drawing categories with metadata
 */
export const DRAWING_CATEGORIES: DrawingCategoryInfo[] = [
  { id: 'floor-plan', name: 'Architectural Plan', description: 'Horizontal section through the building' },
  { id: 'ceiling-plan', name: 'Ceiling Plan', description: 'Reflected ceiling plan' },
  { id: 'section', name: 'Section', description: 'Vertical cut through the building' },
  { id: 'elevation', name: 'Elevation', description: 'Exterior or interior elevation view' },
  { id: 'detail', name: 'Detail', description: 'Enlarged detail view' },
  { id: 'drafting', name: 'Drafting View', description: 'General 2D drafting view' },
  { id: '3d-view', name: '3D View', description: '3D perspective or isometric view' },
  { id: 'schedule', name: 'Schedule', description: 'Tabular data schedule' },
  { id: 'legend', name: 'Legend', description: 'Symbol or material legend' },
  { id: 'other', name: 'Other', description: 'Other view type' },
];

// ============================================================================
// Drawing Scale
// ============================================================================

/**
 * Common drawing scales with display names
 */
export interface DrawingScale {
  /** Scale value (e.g., 0.01 for 1:100) */
  value: number;
  /** Display name (e.g., "1:100") */
  display: string;
  /** Category of scale */
  category: 'detail' | 'plan' | 'site' | 'custom';
}

/**
 * Preset drawing scales
 */
export const DRAWING_SCALES: DrawingScale[] = [
  // Detail scales
  { value: 10, display: '10:1', category: 'detail' },
  { value: 5, display: '5:1', category: 'detail' },
  { value: 2, display: '2:1', category: 'detail' },
  { value: 1, display: '1:1', category: 'detail' },
  // Plan scales
  { value: 0.5, display: '1:2', category: 'plan' },
  { value: 0.2, display: '1:5', category: 'plan' },
  { value: 0.1, display: '1:10', category: 'plan' },
  { value: 0.05, display: '1:20', category: 'plan' },
  { value: 0.04, display: '1:25', category: 'plan' },
  { value: 0.02, display: '1:50', category: 'plan' },
  { value: 0.01, display: '1:100', category: 'plan' },
  { value: 0.005, display: '1:200', category: 'plan' },
  // Site scales
  { value: 0.002, display: '1:500', category: 'site' },
  { value: 0.001, display: '1:1000', category: 'site' },
  { value: 0.0005, display: '1:2000', category: 'site' },
  { value: 0.0002, display: '1:5000', category: 'site' },
];

// ============================================================================
// Enhanced Drawing
// ============================================================================

/**
 * Drawing metadata
 */
export interface DrawingMetadata {
  /** Author/creator */
  author?: string;
  /** Project phase */
  phase?: string;
  /** Design option */
  designOption?: string;
  /** Custom key-value pairs */
  customFields?: Record<string, string>;
}

/**
 * Enhanced drawing with views, category, and metadata
 */
export interface EnhancedDrawing {
  id: string;
  name: string;
  /** Drawing category */
  category: DrawingCategory;
  /** Boundary (crop region) */
  boundary: DrawingBoundary;
  /** Named views within this drawing */
  views: DrawingView[];
  /** Active view ID */
  activeViewId?: string;
  /** Default scale when placing on sheets */
  defaultScale: number;
  /** Drawing metadata */
  metadata: DrawingMetadata;
  /** Whether this drawing is a template */
  isTemplate: boolean;
  /** Template ID if created from a template */
  templateId?: string;
  createdAt: string;
  modifiedAt: string;
}

// ============================================================================
// Drawing Statistics
// ============================================================================

/**
 * Statistics about a drawing's contents
 */
export interface DrawingStats {
  /** Total number of shapes */
  totalShapes: number;
  /** Number of visible shapes */
  visibleShapes: number;
  /** Number of locked shapes */
  lockedShapes: number;
  /** Shapes grouped by type */
  shapesByType: Record<string, number>;
  /** Shapes grouped by layer */
  shapesByLayer: Record<string, number>;
  /** Bounding box of all shapes */
  bounds: {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
  } | null;
}

// ============================================================================
// Drawing Template
// ============================================================================

/**
 * Drawing template for creating new drawings
 */
export interface DrawingTemplate {
  id: string;
  name: string;
  description: string;
  category: DrawingCategory;
  /** Default boundary */
  boundary: DrawingBoundary;
  /** Default scale */
  defaultScale: number;
  /** Default layers to create */
  defaultLayers: { name: string; color: string; visible: boolean }[];
  /** Whether this is a built-in template */
  isBuiltIn: boolean;
  createdAt: string;
}

// ============================================================================
// Drawing Group
// ============================================================================

/**
 * Group of related drawings
 */
export interface DrawingGroup {
  id: string;
  name: string;
  /** Drawing IDs in this group */
  drawingIds: string[];
  /** Whether the group is expanded in the navigation panel */
  expanded: boolean;
  /** Optional icon */
  icon?: string;
}

// ============================================================================
// Helper Functions Types
// ============================================================================

/**
 * Options for creating a new drawing
 */
export interface CreateDrawingOptions {
  name: string;
  category?: DrawingCategory;
  boundary?: Partial<DrawingBoundary>;
  defaultScale?: number;
  templateId?: string;
  metadata?: Partial<DrawingMetadata>;
}

/**
 * Options for duplicating a drawing
 */
export interface DuplicateDrawingOptions {
  /** New name for the duplicate */
  newName: string;
  /** Whether to include shapes */
  includeShapes: boolean;
  /** Whether to include views */
  includeViews: boolean;
  /** Offset position for duplicated shapes */
  offset?: Point;
}

// ============================================================================
// Legacy Aliases (for backward compatibility during migration)
// ============================================================================

/** @deprecated Use DrawingBoundary instead */
export type DraftBoundary = DrawingBoundary;
/** @deprecated Use DEFAULT_DRAWING_BOUNDARY instead */
export const DEFAULT_DRAFT_BOUNDARY = DEFAULT_DRAWING_BOUNDARY;
/** @deprecated Use DrawingView instead */
export type DraftView = DrawingView;
/** @deprecated Use DrawingCategory instead */
export type DraftCategory = DrawingCategory;
/** @deprecated Use DrawingCategoryInfo instead */
export type DraftCategoryInfo = DrawingCategoryInfo;
/** @deprecated Use DRAWING_CATEGORIES instead */
export const DRAFT_CATEGORIES = DRAWING_CATEGORIES;
/** @deprecated Use DrawingScale instead */
export type DraftScale = DrawingScale;
/** @deprecated Use DRAWING_SCALES instead */
export const DRAFT_SCALES = DRAWING_SCALES;
/** @deprecated Use DrawingMetadata instead */
export type DraftMetadata = DrawingMetadata;
/** @deprecated Use EnhancedDrawing instead */
export type EnhancedDraft = EnhancedDrawing;
/** @deprecated Use DrawingStats instead */
export type DraftStats = DrawingStats;
/** @deprecated Use DrawingTemplate instead */
export type DraftTemplate = DrawingTemplate;
/** @deprecated Use DrawingGroup instead */
export type DraftGroup = DrawingGroup;
/** @deprecated Use CreateDrawingOptions instead */
export type CreateDraftOptions = CreateDrawingOptions;
/** @deprecated Use DuplicateDrawingOptions instead */
export type DuplicateDraftOptions = DuplicateDrawingOptions;
