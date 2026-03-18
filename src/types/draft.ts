/**
 * Draft Types - Enhanced types for drafts
 *
 * These types support draft functionality including:
 * - Named views within drafts
 * - Draft boundaries (regions)
 * - Draft categories and metadata
 */

import type { Point, Viewport } from './geometry';

// ============================================================================
// Draft Boundary
// ============================================================================

/**
 * Draft boundary - defines the visible region when placed on sheets
 * This is the "crop region" for the draft
 */
export interface DraftBoundary {
  /** Left edge in draft coordinates */
  x: number;
  /** Top edge in draft coordinates */
  y: number;
  /** Width in draft units */
  width: number;
  /** Height in draft units */
  height: number;
}

/**
 * Default draft boundary values
 */
export const DEFAULT_DRAFT_BOUNDARY: DraftBoundary = {
  x: -500,
  y: -500,
  width: 1000,
  height: 1000,
};

// ============================================================================
// Draft Views
// ============================================================================

/**
 * Named view within a draft (saved camera position)
 */
export interface DraftView {
  id: string;
  /** View name (e.g., "Overall", "Detail A", "North Elevation") */
  name: string;
  /** Viewport state for this view */
  viewport: Viewport;
  /** Optional custom boundary for this view */
  boundary?: DraftBoundary;
  /** View description */
  description?: string;
  /** Whether this is the default view */
  isDefault: boolean;
  createdAt: string;
  modifiedAt: string;
}

// ============================================================================
// Draft Categories
// ============================================================================

/**
 * Draft category for organization
 */
export type DraftCategory =
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
 * Draft category metadata
 */
export interface DraftCategoryInfo {
  id: DraftCategory;
  name: string;
  description: string;
  icon?: string;
}

/**
 * All draft categories with metadata
 */
export const DRAFT_CATEGORIES: DraftCategoryInfo[] = [
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
// Draft Scale
// ============================================================================

/**
 * Common draft scales with display names
 */
export interface DraftScale {
  /** Scale value (e.g., 0.01 for 1:100) */
  value: number;
  /** Display name (e.g., "1:100") */
  display: string;
  /** Category of scale */
  category: 'detail' | 'plan' | 'site' | 'custom';
}

/**
 * Preset draft scales
 */
export const DRAFT_SCALES: DraftScale[] = [
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
// Enhanced Draft
// ============================================================================

/**
 * Draft metadata
 */
export interface DraftMetadata {
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
 * Enhanced draft with views, category, and metadata
 */
export interface EnhancedDraft {
  id: string;
  name: string;
  /** Draft category */
  category: DraftCategory;
  /** Boundary (crop region) */
  boundary: DraftBoundary;
  /** Named views within this draft */
  views: DraftView[];
  /** Active view ID */
  activeViewId?: string;
  /** Default scale when placing on sheets */
  defaultScale: number;
  /** Draft metadata */
  metadata: DraftMetadata;
  /** Whether this draft is a template */
  isTemplate: boolean;
  /** Template ID if created from a template */
  templateId?: string;
  createdAt: string;
  modifiedAt: string;
}

// ============================================================================
// Draft Statistics
// ============================================================================

/**
 * Statistics about a draft's contents
 */
export interface DraftStats {
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
// Draft Template
// ============================================================================

/**
 * Draft template for creating new drafts
 */
export interface DraftTemplate {
  id: string;
  name: string;
  description: string;
  category: DraftCategory;
  /** Default boundary */
  boundary: DraftBoundary;
  /** Default scale */
  defaultScale: number;
  /** Default layers to create */
  defaultLayers: { name: string; color: string; visible: boolean }[];
  /** Whether this is a built-in template */
  isBuiltIn: boolean;
  createdAt: string;
}

// ============================================================================
// Draft Group
// ============================================================================

/**
 * Group of related drafts
 */
export interface DraftGroup {
  id: string;
  name: string;
  /** Draft IDs in this group */
  draftIds: string[];
  /** Whether the group is expanded in the navigation panel */
  expanded: boolean;
  /** Optional icon */
  icon?: string;
}

// ============================================================================
// Helper Functions Types
// ============================================================================

/**
 * Options for creating a new draft
 */
export interface CreateDraftOptions {
  name: string;
  category?: DraftCategory;
  boundary?: Partial<DraftBoundary>;
  defaultScale?: number;
  templateId?: string;
  metadata?: Partial<DraftMetadata>;
}

/**
 * Options for duplicating a draft
 */
export interface DuplicateDraftOptions {
  /** New name for the duplicate */
  newName: string;
  /** Whether to include shapes */
  includeShapes: boolean;
  /** Whether to include views */
  includeViews: boolean;
  /** Offset position for duplicated shapes */
  offset?: Point;
}
