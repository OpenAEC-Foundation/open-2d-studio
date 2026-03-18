/**
 * Types Index - Central export point for all type definitions
 *
 * This module re-exports all types from:
 * - geometry.ts - Core geometry and CAD types
 * - drawing.ts - Enhanced drawing types
 * - sheet.ts - Enhanced sheet layout types
 * - rendering.ts - Rendering and display types
 * - events.ts - Event handling types
 * - guards.ts - Runtime type guard functions
 */

// ============================================================================
// Core Geometry Types
// ============================================================================
export type {
  // Primitives
  Point,
  BoundingBox,
  LineStyle,
  ShapeStyle,

  // Shapes
  BaseShape,
  ShapeType,
  Shape,
  LineShape,
  RectangleShape,
  CircleShape,
  ArcShape,
  EllipseShape,
  PolylineShape,
  TextShape,
  PointShape,

  // Gridline
  GridlineShape,
  GridlineBubblePosition,

  // Level
  LevelShape,
  LevelLabelPosition,

  // Pile
  PileShape,
  PileType,
  PileOption,
  BearingCapacityLevel,
  PileSymbolType,
  PilePlanSettings,

  // CPT
  CPTShape,
  FoundationAdvice,

  // Foundation Zone
  FoundationZoneShape,

  // Wall
  WallShape,
  WallType,
  WallJustification,
  WallEndCap,

  // Slab
  SlabShape,
  SlabOpeningShape,
  SlabOpeningDisplayStyle,
  SlabMaterial,
  SlabType,
  SlabLabelShape,
  StructuralFloorType,

  // Column
  ColumnShape,
  ColumnMaterial,
  ColumnType,
  ColumnShapeType,

  // Beam Type
  BeamType,
  BeamTypeProfileType,

  // Section Callout
  SectionCalloutShape,
  SectionCalloutType,

  // Space
  SpaceShape,

  // Plate System
  PlateSystemShape,
  PlateSystemLayer,
  PlateSystemMainProfile,
  PlateSystemEdgeProfile,
  PlateSystemOpening,

  // Spot Elevation
  SpotElevationShape,

  // Rebar (Reinforcement)
  RebarShape,
  RebarDiameter,
  RebarViewMode,

  // Exposure Class (Milieuklasse)
  ExposureClass,
  ExposureClassAssignment,
  SurfaceExposureClasses,

  // Section Reference
  SectionReference,

  // Layers
  Layer,

  // Viewport
  Viewport,

  // Snap
  SnapType,
  SnapPoint,

  // Tools
  ToolType,
  CircleMode,
  RectangleMode,

  // Drawings & Sheets (Base)
  DrawingType,
  DrawingBoundary,
  Drawing,
  DraftBoundary,  // @deprecated alias
  Draft,          // @deprecated alias
  PaperSize,
  PaperOrientation,
  Sheet,
  SheetViewport,
  TitleBlock,
  TitleBlockField,
  EditorMode,

  // Viewport Crop & Layer Overrides
  CropRegionType,
  CropRegion,
  ViewportLayerOverride,

  // Materials
  MaterialCategory,
  MaterialCategoryInfo,
} from './geometry';

export {
  MATERIAL_CATEGORIES,
  getMaterialCategoryInfo,
  STRUCTURAL_FLOOR_TYPES,
  REBAR_DIAMETERS,
  EXPOSURE_CLASSES,
  EXPOSURE_CLASS_MIN_COVER,
  getMinCoverFromExposureClasses,
} from './geometry';

// ============================================================================
// Enhanced Drawing Types
// ============================================================================
export type {
  // Drawing views
  DrawingView,
  DraftView, // @deprecated alias

  // Categories
  DrawingCategory,
  DrawingCategoryInfo,
  DraftCategory, // @deprecated alias
  DraftCategoryInfo, // @deprecated alias

  // Scales
  DrawingScale,
  DraftScale, // @deprecated alias

  // Metadata
  DrawingMetadata,
  DraftMetadata, // @deprecated alias
  EnhancedDrawing,
  EnhancedDraft, // @deprecated alias

  // Statistics
  DrawingStats,
  DraftStats, // @deprecated alias

  // Templates
  DrawingTemplate,
  DraftTemplate, // @deprecated alias

  // Groups
  DrawingGroup,
  DraftGroup, // @deprecated alias

  // Options
  CreateDrawingOptions,
  CreateDraftOptions, // @deprecated alias
  DuplicateDrawingOptions,
  DuplicateDraftOptions, // @deprecated alias
} from './drawing';

export {
  // Constants
  DEFAULT_DRAWING_BOUNDARY,
  DEFAULT_DRAFT_BOUNDARY, // @deprecated alias
  DRAWING_CATEGORIES,
  DRAFT_CATEGORIES, // @deprecated alias
  DRAWING_SCALES,
  DRAFT_SCALES, // @deprecated alias
} from './drawing';

// ============================================================================
// Enhanced Sheet Types
// ============================================================================
export type {
  // Crop regions (re-exported from geometry)
  ViewportCropRegion,

  // Enhanced viewport
  EnhancedSheetViewport,

  // Annotations
  BaseSheetAnnotation,
  SheetTextAnnotation,
  DimensionStyle,
  DimensionType,
  SheetDimensionAnnotation,
  SheetLeaderAnnotation,
  SheetCalloutAnnotation,
  SheetSectionMarker,
  SheetRevisionCloud,
  SheetAnnotation,

  // Title block
  TitleBlockCell,
  TitleBlockRow,
  TitleBlockLayout,
  TitleBlockTemplate,
  Revision,
  RevisionTable,
  EnhancedTitleBlock,

  // Sheet templates
  ViewportPlaceholder,
  SheetTemplate,

  // Sheet sets
  SheetSet,

  // Enhanced sheet
  EnhancedSheet,
} from './sheet';

// ============================================================================
// Rendering Types
// ============================================================================
export type {
  // Context
  RenderContext,

  // Viewport transform
  ViewportTransform,
  ViewportBounds,

  // Render options
  ShapeRenderOptions,
  GridRenderOptions,
  SnapRenderOptions,
  SelectionRenderOptions,
  TrackingRenderOptions,
  RenderOptions,

  // Layer rendering
  LayerRenderOptions,

  // Drawing state
  DrawingState,
  SelectionBoxState,

  // Metrics
  RenderMetrics,

  // Sheet rendering
  SheetRenderOptions,
  ViewportRenderOptions,
  TitleBlockRenderOptions,

  // Draft rendering
  DraftRenderOptions,

  // Handles
  HandleType,
  Handle,
  HandleRenderOptions,

  // Theme
  RenderTheme,
} from './rendering';

export {
  // Theme constants
  DARK_THEME,
  LIGHT_THEME,
} from './rendering';

// ============================================================================
// Event Types
// ============================================================================
export type {
  // Mouse events
  MouseButton,
  ModifierKeys,
  CanvasMouseEvent,
  CanvasWheelEvent,

  // Keyboard events
  CanvasKeyEvent,
  KeyboardShortcut,

  // Drawing events
  DrawingEventType,
  DrawingEvent,
  DrawingState as DrawingStateMachine,

  // Selection events
  SelectionEventType,
  SelectionMethod,
  SelectionEvent,

  // Viewport events
  ViewportEventType,
  ViewportEvent,

  // Edit events
  EditEventType,
  EditEvent,

  // Handle events
  HandleEventType,
  HandleEvent,

  // Mode events
  ModeChangeEvent,

  // Tool events
  ToolChangeEvent,

  // Handler types
  CanvasMouseHandler,
  CanvasWheelHandler,
  CanvasKeyHandler,
  DrawingHandler,
  SelectionHandler,
  ViewportHandler,
  EditHandler,
  HandleHandler,
  ModeChangeHandler,
  ToolChangeHandler,

  // Event map
  CanvasEventMap,
  EventListener,

  // Gestures
  GestureType,
  GestureEvent,
} from './events';

// ============================================================================
// Type Guards
// ============================================================================
export {
  // Shape guards
  isLineShape,
  isRectangleShape,
  isCircleShape,
  isArcShape,
  isEllipseShape,
  isPolylineShape,
  isTextShape,
  isPointShape,
  hasCenter,
  hasRadius,
  hasRotation,
  hasPoints,
  canBeFilled,

  // Annotation guards
  isTextAnnotation,
  isDimensionAnnotation,
  isLeaderAnnotation,
  isCalloutAnnotation,
  isSectionMarker,
  isRevisionCloud,

  // Gridline guard
  isGridlineShape,

  // Slab guard
  isSlabShape,

  // Slab Opening guard
  isSlabOpeningShape,

  // Slab Label guard
  isSlabLabelShape,

  // Section Callout guard
  isSectionCalloutShape,

  // Space guard
  isSpaceShape,

  // Plate System guard
  isPlateSystemShape,

  // Spot Elevation guard
  isSpotElevationShape,

  // CPT guard
  isCPTShape,

  // Foundation Zone guard
  isFoundationZoneShape,

  // Primitive guards
  isPoint,
  isBoundingBox,

  // Entity guards
  isLayer,
  isDrawing,
  isDraft, // @deprecated alias
  isEnhancedDrawing,
  isEnhancedDraft, // @deprecated alias
  isSheet,
  isSheetViewport,
  isEnhancedSheetViewport,
  isTitleBlock,

  // Snap guards
  isSnapPoint,
  isSnapType,

  // Tool guards
  isToolType,
  isDrawingTool,
  isModificationTool,
  isSelectionTool,
  isNavigationTool,

  // Shape type guards
  isShapeType,
  isShape,

  // Mode guards
  isEditorMode,

  // Category guards
  isDrawingCategory,
  isDraftCategory, // @deprecated alias
  isDrawingView,
  isDraftView, // @deprecated alias

  // Array guards
  isShapeArray,
  isPointArray,
  isLayerArray,

  // Utility guards
  isDefined,
  isNonEmptyString,
  isPositiveNumber,
  isNonNegativeNumber,
  isValidAngle,
  isValidColor,
} from './guards';
