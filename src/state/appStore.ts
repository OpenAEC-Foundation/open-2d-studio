/**
 * Combined App Store — Facade over global state + active document store
 *
 * This store maintains backward compatibility: all existing useAppStore() calls
 * continue to work. Per-document state is delegated to the active document store
 * via the documentStore registry. Components can also use useDocStore() directly.
 *
 * Global state: tool modes, snap settings, dialogs, document management
 * Per-doc state (via facade): shapes, layers, drawings, sheets, selection, viewport,
 *   history, boundary, viewport editing, annotations, drawing placement, file info
 */

import { enablePatches } from 'immer';
import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';

enablePatches();

// Import slice types and creators
import {
  // Types
  type ModelState,
  type ModelActions,
  type ViewState,
  type ViewActions,
  type ToolState,
  type ToolActions,
  type SnapState,
  type SnapActions,
  type SelectionState,
  type SelectionActions,
  type HistoryState,
  type HistoryActions,
  type UIState,
  type UIActions,
  type BoundaryState,
  type BoundaryActions,
  type ViewportEditState_Full,
  type ViewportEditActions,
  type AnnotationState,
  type AnnotationActions,
  type DrawingPlacementState,
  type DrawingPlacementActions,
  type ParametricState,
  type ParametricActions,
  type HatchState,
  type HatchActions,
  type ClipboardState,
  type ClipboardActions,
  type ProjectInfoState,
  type ProjectInfoActions,
  type ExtensionState,
  type ExtensionActions,
  type UnitState,
  type UnitActions,
  type LogState,
  type LogActions,
  type IfcState,
  type IfcActions,

  // Initial states
  initialModelState,
  initialViewState,
  initialToolState,
  initialSnapState,
  initialSelectionState,
  initialHistoryState,
  initialUIState,
  initialBoundaryState,
  initialViewportEditState,
  initialAnnotationState,
  initialDrawingPlacementState,
  initialParametricState,
  initialHatchState,
  initialClipboardState,
  initialProjectInfoState,
  initialExtensionState,
  initialUnitState,
  initialLogState,
  initialIfcState,

  // Slice creators
  createModelSlice,
  createViewSlice,
  createToolSlice,
  createSnapSlice,
  createSelectionSlice,
  createHistorySlice,
  createUISlice,
  createBoundarySlice,
  createViewportEditSlice,
  createAnnotationSlice,
  createDrawingPlacementSlice,
  createParametricSlice,
  createHatchSlice,
  createClipboardSlice,
  createProjectInfoSlice,
  createExtensionSlice,
  createUnitSlice,
  createLogSlice,
  createIfcSlice,
} from './slices';

// Re-export types for backward compatibility
export type {
  DrawingPreview,
  SelectionBox,
  SelectionBoxMode,
  BoundaryHandleType,
  BoundaryEditState,
  ViewportHandleType,
  ViewportEditState,
  TrackingLine,
} from './slices/types';

export {
  generateId,
  PAPER_SIZES,
  getShapeBounds,
  cloneShapes,
  defaultStyle,
  DEFAULT_DRAWING_BOUNDARY,
  DEFAULT_DRAFT_BOUNDARY, // Legacy alias
  createDefaultTitleBlock,
} from './slices/types';

import { generateId } from './slices/types';

import {
  createDocumentStore,
  removeDocumentStore,
  getDocumentStoreIfExists,
} from './documentStore';

// ============================================================================
// Per-Document State Save/Restore
// ============================================================================

/** Fields that belong to each document (saved/restored on tab switch) */
function extractPerDocState(s: any) {
  return {
    // Model
    drawings: s.drawings,
    activeDrawingId: s.activeDrawingId,
    sheets: s.sheets,
    activeSheetId: s.activeSheetId,
    editorMode: s.editorMode,
    drawingViewports: s.drawingViewports,
    sheetViewports: s.sheetViewports,
    shapes: s.shapes,
    layers: s.layers,
    activeLayerId: s.activeLayerId,
    customTitleBlockTemplates: s.customTitleBlockTemplates,
    customSheetTemplates: s.customSheetTemplates,
    // View
    viewport: s.viewport,
    // Selection
    selectedShapeIds: s.selectedShapeIds,
    selectionBox: s.selectionBox,
    hoveredShapeId: s.hoveredShapeId,
    selectionFilter: s.selectionFilter,
    // History
    historyStack: s.historyStack,
    historyIndex: s.historyIndex,
    maxHistorySize: s.maxHistorySize,
    // Tool per-doc fields
    isDrawing: s.isDrawing,
    drawingPreview: s.drawingPreview,
    drawingPoints: s.drawingPoints,
    currentStyle: s.currentStyle,
    textEditingId: s.textEditingId,
    titleBlockEditingFieldId: s.titleBlockEditingFieldId,
    hoveredTitleBlockFieldId: s.hoveredTitleBlockFieldId,
    defaultTextStyle: s.defaultTextStyle,
    hatchCustomPatternId: s.hatchCustomPatternId,
    // UI per-doc fields
    currentFilePath: s.currentFilePath,
    projectName: s.projectName,
    isModified: s.isModified,
    // Boundary
    boundaryEditState: s.boundaryEditState,
    // Snap per-doc
    boundaryVisible: s.boundaryVisible,
    // Viewport edit
    viewportEditState: s.viewportEditState,
    cropRegionEditState: s.cropRegionEditState,
    layerOverrideEditState: s.layerOverrideEditState,
    // Annotation
    selectedAnnotationIds: s.selectedAnnotationIds,
    annotationEditState: s.annotationEditState,
    // Drawing placement
    isPlacing: s.isPlacing,
    placingDrawingId: s.placingDrawingId,
    placingQueryId: s.placingQueryId,
    previewPosition: s.previewPosition,
    placementScale: s.placementScale,
    // Parametric shapes
    parametricShapes: s.parametricShapes,
    sectionDialogOpen: s.sectionDialogOpen,
    pendingSection: s.pendingSection,
    // Hatch patterns (project-level)
    projectPatterns: s.projectPatterns,
    // Text styles
    textStyles: s.textStyles,
    activeTextStyleId: s.activeTextStyleId,
    // Project info
    projectInfo: s.projectInfo,
    // 2D Cursor
    cursor2D: s.cursor2D,
    cursor2DVisible: s.cursor2DVisible,
    // Unit settings
    unitSettings: s.unitSettings,
    // Block definitions
    blockDefinitions: s.blockDefinitions,
  };
}

/** Save current appStore per-doc state into the document store for given id */
function saveDocState(docId: string, appState: any) {
  const store = getDocumentStoreIfExists(docId);
  if (!store) return;
  const perDoc = extractPerDocState(appState);
  // Map appStore field names to documentStore field names
  const docPerDoc: any = { ...perDoc };
  docPerDoc.filePath = perDoc.currentFilePath;
  delete docPerDoc.currentFilePath;
  store.setState(docPerDoc);
}

/** Restore per-doc state from a document store into the appStore */
function restoreDocState(docId: string, set: any) {
  const store = getDocumentStoreIfExists(docId);
  if (!store) return;
  const saved = store.getState();
  set((state: any) => {
    state.drawings = saved.drawings;
    state.activeDrawingId = saved.activeDrawingId;
    state.sheets = saved.sheets;
    state.activeSheetId = saved.activeSheetId;
    state.editorMode = saved.editorMode;
    state.drawingViewports = saved.drawingViewports;
    state.sheetViewports = saved.sheetViewports;
    state.shapes = saved.shapes;
    state.layers = saved.layers;
    state.activeLayerId = saved.activeLayerId;
    state.customTitleBlockTemplates = saved.customTitleBlockTemplates;
    state.customSheetTemplates = saved.customSheetTemplates;
    state.viewport = saved.viewport;
    state.selectedShapeIds = saved.selectedShapeIds;
    state.selectionBox = saved.selectionBox;
    state.hoveredShapeId = saved.hoveredShapeId;
    state.selectionFilter = saved.selectionFilter ?? null;
    state.historyStack = saved.historyStack;
    state.historyIndex = saved.historyIndex;
    state.maxHistorySize = saved.maxHistorySize;
    state.isDrawing = saved.isDrawing;
    state.drawingPreview = saved.drawingPreview;
    state.drawingPoints = saved.drawingPoints;
    state.currentStyle = saved.currentStyle;
    state.textEditingId = saved.textEditingId;
    state.titleBlockEditingFieldId = saved.titleBlockEditingFieldId || null;
    state.hoveredTitleBlockFieldId = saved.hoveredTitleBlockFieldId || null;
    state.defaultTextStyle = saved.defaultTextStyle;
    state.hatchCustomPatternId = saved.hatchCustomPatternId || null;
    state.currentFilePath = saved.filePath;
    state.projectName = saved.projectName;
    state.isModified = saved.isModified;
    state.boundaryEditState = saved.boundaryEditState;
    state.boundaryVisible = saved.boundaryVisible;
    state.viewportEditState = saved.viewportEditState;
    state.cropRegionEditState = saved.cropRegionEditState;
    state.layerOverrideEditState = saved.layerOverrideEditState;
    state.selectedAnnotationIds = saved.selectedAnnotationIds;
    state.annotationEditState = saved.annotationEditState;
    state.isPlacing = saved.isPlacing;
    state.placingDrawingId = saved.placingDrawingId;
    state.placingQueryId = saved.placingQueryId;
    state.previewPosition = saved.previewPosition;
    state.placementScale = saved.placementScale;
    // Parametric shapes
    state.parametricShapes = saved.parametricShapes || [];
    state.sectionDialogOpen = saved.sectionDialogOpen || false;
    state.pendingSection = saved.pendingSection || null;
    // Hatch patterns (project-level)
    state.projectPatterns = saved.projectPatterns || [];
    // Text styles
    state.textStyles = saved.textStyles || [];
    state.activeTextStyleId = saved.activeTextStyleId || null;
    // Project info
    if (saved.projectInfo) state.projectInfo = saved.projectInfo;
    // Unit settings
    if (saved.unitSettings) state.unitSettings = saved.unitSettings;
    // Block definitions
    state.blockDefinitions = saved.blockDefinitions || [];
  });
}

// ============================================================================
// Document Management State & Actions
// ============================================================================

export interface DocumentManagementState {
  activeDocumentId: string;
  documentOrder: string[];
}

export interface DocumentManagementActions {
  createNewDocument: (projectName?: string) => string;
  openDocument: (id: string, initial?: Partial<import('./documentStore').DocumentState>) => string;
  closeDocument: (id: string) => void;
  switchDocument: (id: string) => void;
  reorderTabs: (order: string[]) => void;
}

// ============================================================================
// Coordinating Actions Type (cross-slice operations)
// ============================================================================

export interface CoordinatingActions {
  /** Switch to a tool, canceling any active command first */
  switchToDrawingTool: (tool: ToolState['activeTool']) => void;
  /** Switch to any tool (including select/pan), canceling any active command first */
  switchToolAndCancelCommand: (tool: ToolState['activeTool']) => void;
}

// ============================================================================
// Combined State Type (maintains backward compatibility)
// ============================================================================

export type AppState =
  & ModelState
  & ViewState
  & ToolState
  & SnapState
  & SelectionState
  & HistoryState
  & UIState
  & BoundaryState
  & ViewportEditState_Full
  & AnnotationState
  & DrawingPlacementState
  & ParametricState
  & HatchState
  & ClipboardState
  & ProjectInfoState
  & ExtensionState
  & UnitState
  & LogState
  & IfcState
  & ModelActions
  & ViewActions
  & ToolActions
  & SnapActions
  & SelectionActions
  & HistoryActions
  & UIActions
  & BoundaryActions
  & ViewportEditActions
  & AnnotationActions
  & DrawingPlacementActions
  & ParametricActions
  & HatchActions
  & ClipboardActions
  & ProjectInfoActions
  & ExtensionActions
  & UnitActions
  & LogActions
  & IfcActions
  & CoordinatingActions
  & DocumentManagementState
  & DocumentManagementActions;

// ============================================================================
// Combined Initial State
// ============================================================================

const initialState = {
  ...initialModelState,
  ...initialViewState,
  ...initialToolState,
  ...initialSnapState,
  ...initialSelectionState,
  ...initialHistoryState,
  ...initialUIState,
  ...initialBoundaryState,
  ...initialViewportEditState,
  ...initialAnnotationState,
  ...initialDrawingPlacementState,
  ...initialParametricState,
  ...initialHatchState,
  ...initialClipboardState,
  ...initialProjectInfoState,
  ...initialExtensionState,
  ...initialUnitState,
  ...initialLogState,
  ...initialIfcState,
};

// ============================================================================
// Initial Document Setup
// ============================================================================

const initialDocId = generateId();

// ============================================================================
// Store Creation
// ============================================================================

export const useAppStore = create<AppState>()(
  immer((set, get) => {
    // Create initial document store
    createDocumentStore(initialDocId);

    return {
      // Spread initial state
      ...initialState,

      // Document management
      activeDocumentId: initialDocId,
      documentOrder: [initialDocId],

      // Compose all slice actions
      ...createModelSlice(set as any, get as any),
      ...createViewSlice(set as any, get as any),
      ...createToolSlice(set as any, get as any),
      ...createSnapSlice(set as any, get as any),
      ...createSelectionSlice(set as any, get as any),
      ...createHistorySlice(set as any, get as any),
      ...createUISlice(set as any, get as any),
      ...createBoundarySlice(set as any, get as any),
      ...createViewportEditSlice(set as any, get as any),
      ...createAnnotationSlice(set as any, get as any),
      ...createDrawingPlacementSlice(set as any, get as any),
      ...createParametricSlice(set as any, get as any),
      ...createHatchSlice(set as any, get as any),
      ...createClipboardSlice(set as any, get as any),
      ...createProjectInfoSlice(set as any, get as any),
      ...createExtensionSlice(set as any, get as any),
      ...createUnitSlice(set as any, get as any),
      ...createLogSlice(set as any, get as any),
      ...createIfcSlice(set as any, get as any),

      // ========================================================================
      // Coordinating Actions (cross-slice operations)
      // ========================================================================

      switchToDrawingTool: (tool: ToolState['activeTool']) => {
        get().setActiveTool(tool);
      },

      switchToolAndCancelCommand: (tool: ToolState['activeTool']) => {
        get().setActiveTool(tool);
      },

      // ========================================================================
      // Document Management Actions
      // ========================================================================

      createNewDocument: (projectName?: string) => {
        const id = generateId();
        const appState = get();
        const existingDocs = appState.documentOrder;
        let name = projectName || 'Untitled';
        if (!projectName) {
          const untitledCount = existingDocs.reduce((count, docId) => {
            const store = getDocumentStoreIfExists(docId);
            if (store && store.getState().projectName.startsWith('Untitled')) return count + 1;
            return count;
          }, 0);
          if (untitledCount > 0) name = `Untitled ${untitledCount + 1}`;
        }

        // Cancel any active drawing/modify command and reset selection
        appState.clearDrawingPoints();
        appState.setActiveTool('select');
        appState.deselectAll();

        // Save current document state before switching
        saveDocState(appState.activeDocumentId, appState);

        createDocumentStore(id, { projectName: name });

        set((state) => {
          state.documentOrder.push(id);
          state.activeDocumentId = id;
        });

        // Restore new (empty) document state
        restoreDocState(id, set);

        return id;
      },

      openDocument: (id: string, initial?) => {
        const appState = get();

        // Cancel any active drawing/modify command and reset selection
        appState.clearDrawingPoints();
        appState.setActiveTool('select');
        appState.deselectAll();

        // Check if already open by filePath
        if (initial?.filePath) {
          for (const docId of appState.documentOrder) {
            const store = getDocumentStoreIfExists(docId);
            if (store && store.getState().filePath === initial.filePath) {
              // Use switchDocument to properly save/restore
              appState.switchDocument(docId);
              return docId;
            }
          }
        }

        // Save current document state before switching
        saveDocState(appState.activeDocumentId, appState);

        createDocumentStore(id, initial);

        set((state) => {
          state.documentOrder.push(id);
          state.activeDocumentId = id;
        });

        // Restore opened document state
        restoreDocState(id, set);

        return id;
      },

      closeDocument: (id: string) => {
        const appState = get();

        // Cancel any active drawing/modify command and reset selection
        appState.clearDrawingPoints();
        appState.setActiveTool('select');
        appState.deselectAll();

        const order = [...appState.documentOrder];
        const idx = order.indexOf(id);
        if (idx === -1) return;

        const wasActive = appState.activeDocumentId === id;
        order.splice(idx, 1);

        if (order.length === 0) {
          const newId = generateId();
          createDocumentStore(newId);
          set((s) => {
            s.documentOrder = [newId];
            s.activeDocumentId = newId;
          });
          restoreDocState(newId, set);
        } else {
          const newActiveIdx = Math.min(idx, order.length - 1);
          const newActiveId = wasActive ? order[newActiveIdx] : appState.activeDocumentId;
          set((s) => {
            s.documentOrder = order;
            if (wasActive) {
              s.activeDocumentId = newActiveId;
            }
          });
          if (wasActive) {
            restoreDocState(newActiveId, set);
          }
        }

        removeDocumentStore(id);
      },

      switchDocument: (id: string) => {
        const appState = get();
        if (!appState.documentOrder.includes(id)) return;
        if (id === appState.activeDocumentId) return;

        // Cancel any active drawing/modify command and reset selection
        appState.clearDrawingPoints();
        appState.setActiveTool('select');
        appState.deselectAll();

        // Save current document state
        saveDocState(appState.activeDocumentId, appState);

        // Switch active id
        set((state) => { state.activeDocumentId = id; });

        // Restore new document state
        restoreDocState(id, set);
      },

      reorderTabs: (order: string[]) => {
        set((state) => { state.documentOrder = order; });
      },
    };
  })
);

// ============================================================================
// Active Document Store Sync
// ============================================================================
// Keep the active document store in sync with appStore for fields that are
// read from document stores directly (e.g., FileTabBar, duplicate detection).
useAppStore.subscribe((state, prevState) => {
  if (
    state.projectName !== prevState.projectName ||
    state.isModified !== prevState.isModified ||
    state.currentFilePath !== prevState.currentFilePath
  ) {
    const store = getDocumentStoreIfExists(state.activeDocumentId);
    if (store) {
      store.setState({
        projectName: state.projectName,
        isModified: state.isModified,
        filePath: state.currentFilePath,
      });
    }
  }
});

// ============================================================================
// Selector Hooks (for optimized component subscriptions)
// ============================================================================

// Model selectors
export const useActiveDrawing = () => useAppStore((state) => {
  return state.drawings.find((d) => d.id === state.activeDrawingId);
});

// Legacy alias
export const useActiveDraft = useActiveDrawing;

export const useActiveSheet = () => useAppStore((state) => {
  return state.sheets.find((s) => s.id === state.activeSheetId);
});

export const useActiveLayer = () => useAppStore((state) => {
  return state.layers.find((l) => l.id === state.activeLayerId);
});

export const useDrawingShapes = () => useAppStore((state) => {
  return state.shapes.filter((s) => s.drawingId === state.activeDrawingId);
});

// Legacy alias
export const useDraftShapes = useDrawingShapes;

export const useDrawingLayers = () => useAppStore((state) => {
  return state.layers.filter((l) => l.drawingId === state.activeDrawingId);
});

// Legacy alias
export const useDraftLayers = useDrawingLayers;

export const useSelectedShapes = () => useAppStore((state) => {
  const idSet = new Set(state.selectedShapeIds);
  return state.shapes.filter((s) => idSet.has(s.id));
});

// Filtered selection: when a selectionFilter is active, only return IDs matching that shape type
export const useFilteredSelectedShapeIds = () => useAppStore((state) => {
  if (!state.selectionFilter) return state.selectedShapeIds;
  const idSet = new Set(state.selectedShapeIds);
  return state.shapes
    .filter((s) => idSet.has(s.id) && s.type === state.selectionFilter)
    .map((s) => s.id);
});

// View selectors
export const useViewport = () => useAppStore((state) => state.viewport);
export const useCanvasSize = () => useAppStore((state) => state.canvasSize);
export const useMousePosition = () => useAppStore((state) => state.mousePosition);

// Tool selectors
export const useActiveTool = () => useAppStore((state) => state.activeTool);
export const useCurrentStyle = () => useAppStore((state) => state.currentStyle);
export const useIsDrawing = () => useAppStore((state) => state.isDrawing);
export const useDrawingPreview = () => useAppStore((state) => state.drawingPreview);
export const useDrawingPoints = () => useAppStore((state) => state.drawingPoints);

// Snap selectors
export const useSnapEnabled = () => useAppStore((state) => state.snapEnabled);
export const useActiveSnaps = () => useAppStore((state) => state.activeSnaps);
export const useCurrentSnapPoint = () => useAppStore((state) => state.currentSnapPoint);
export const useGridVisible = () => useAppStore((state) => state.gridVisible);
export const useGridSize = () => useAppStore((state) => state.gridSize);

// Selection selectors
export const useSelectedShapeIds = () => useAppStore((state) => state.selectedShapeIds);
export const useSelectionBox = () => useAppStore((state) => state.selectionBox);

// Editor mode selectors
export const useEditorMode = () => useAppStore((state) => state.editorMode);
export const useIsSheetMode = () => useAppStore((state) => state.editorMode === 'sheet');
export const useIsDrawingMode = () => useAppStore((state) => state.editorMode === 'drawing');
// Legacy alias
export const useIsDraftMode = useIsDrawingMode;

// UI selectors
export const useProjectName = () => useAppStore((state) => state.projectName);
export const useIsModified = () => useAppStore((state) => state.isModified);
export const useCurrentFilePath = () => useAppStore((state) => state.currentFilePath);

// Unit selectors
export const useUnitSettings = () => useAppStore((state) => state.unitSettings);

// Annotation selectors
export const useSelectedAnnotationIds = () => useAppStore((state) => state.selectedAnnotationIds);
export const useAnnotationEditState = () => useAppStore((state) => state.annotationEditState);
export const useSheetAnnotations = () => useAppStore((state) => {
  const sheet = state.sheets.find((s) => s.id === state.activeSheetId);
  return sheet?.annotations ?? [];
});
export const useSelectedAnnotations = () => useAppStore((state) => {
  const sheet = state.sheets.find((s) => s.id === state.activeSheetId);
  if (!sheet) return [];
  return sheet.annotations.filter((a) => state.selectedAnnotationIds.includes(a.id));
});
