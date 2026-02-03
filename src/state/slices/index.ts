/**
 * Slices barrel export
 */

// Types
export * from './types';

// Model Slice
export {
  type ModelState,
  type ModelActions,
  type ModelSlice,
  initialModelState,
  createModelSlice,
} from './modelSlice';

// View Slice
export {
  type ViewState,
  type ViewActions,
  type ViewSlice,
  initialViewState,
  createViewSlice,
} from './viewSlice';

// Tool Slice
export {
  type ToolState,
  type ToolActions,
  type ToolSlice,
  initialToolState,
  createToolSlice,
} from './toolSlice';

// Snap Slice
export {
  type SnapState,
  type SnapActions,
  type SnapSlice,
  initialSnapState,
  createSnapSlice,
} from './snapSlice';

// Selection Slice
export {
  type SelectionState,
  type SelectionActions,
  type SelectionSlice,
  initialSelectionState,
  createSelectionSlice,
} from './selectionSlice';

// History Slice
export {
  type HistoryEntry,
  type HistoryState,
  type HistoryActions,
  type HistorySlice,
  initialHistoryState,
  createHistorySlice,
} from './historySlice';

// UI Slice
export {
  type UIState,
  type UIActions,
  type UISlice,
  initialUIState,
  createUISlice,
} from './uiSlice';

// Boundary Slice
export {
  type BoundaryState,
  type BoundaryActions,
  type BoundarySlice,
  initialBoundaryState,
  createBoundarySlice,
} from './boundarySlice';

// Viewport Edit Slice
export {
  type ViewportEditState_Full,
  type ViewportEditActions,
  type ViewportEditSlice,
  initialViewportEditState,
  createViewportEditSlice,
} from './viewportEditSlice';

// Annotation Slice
export {
  type AnnotationState,
  type AnnotationActions,
  type AnnotationSlice,
  type AnnotationEditState,
  type AnnotationHandleType,
  initialAnnotationState,
  createAnnotationSlice,
} from './annotationSlice';

// Drawing Placement Slice
export {
  type DrawingPlacementState,
  type DrawingPlacementActions,
  type DrawingPlacementSlice,
  initialDrawingPlacementState,
  createDrawingPlacementSlice,
  // Legacy aliases
  type DraftPlacementState,
  type DraftPlacementActions,
  type DraftPlacementSlice,
  initialDraftPlacementState,
  createDraftPlacementSlice,
} from './drawingPlacementSlice';

// Parametric Slice
export {
  type ParametricState,
  type ParametricActions,
  type ParametricSlice,
  initialParametricState,
  createParametricSlice,
} from './parametricSlice';

// Hatch Slice
export {
  type HatchState,
  type HatchActions,
  type HatchSlice,
  initialHatchState,
  createHatchSlice,
} from './hatchSlice';
