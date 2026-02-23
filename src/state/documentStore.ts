/**
 * Document Store - Per-document state management
 *
 * Each open file gets its own Zustand store instance.
 * A registry manages store creation/retrieval/cleanup.
 * The useDocStore() hook auto-resolves the active document's store.
 */

import { createStore, type StoreApi } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { useStore } from 'zustand';
import { enablePatches, produceWithPatches, applyPatches, current, type Patch } from 'immer';

import { useAppStore } from './appStore';
import { CAD_DEFAULT_FONT } from '../constants/cadDefaults';

import type {
  Shape,
  Layer,
  Drawing,
  DrawingType,
  DrawingBoundary,
  Sheet,
  SheetViewport,
  Viewport,
  EditorMode,
  PaperSize,
  PaperOrientation,
  Point,
  ShapeStyle,
  DrawingPreview,
  SelectionBox,
  BoundaryEditState,
  BoundaryHandleType,
  ViewportEditState,
  ViewportHandleType,
  CropRegionEditState,
  CropRegionHandleType,
  CropRegion,
  LayerOverrideEditState,
  ViewportLayerOverride,
  DefaultTextStyle,
  TitleBlock,
  TitleBlockField,
  TextStyle,
} from './slices/types';

import {
  generateId,
  DEFAULT_DRAWING_BOUNDARY,
  DEFAULT_DRAWING_SCALE,
  createDefaultTitleBlock,
  getShapeBounds,
  defaultStyle,
  createDefaultTextStyles,
} from './slices/types';

import type { HistoryEntry } from './slices/historySlice';

import type {
  TitleBlockTemplate,
  EnhancedTitleBlock,
  SheetTemplate,
  SheetAnnotation,
  SheetTextAnnotation,
  SheetLeaderAnnotation,
  SheetRevisionCloud,
} from '../types/sheet';

import {
  BUILT_IN_TEMPLATES,
  createTitleBlockFromTemplate,
  addRevision as addRevisionToTable,
  getTemplatesForPaperSize,
  calculateAutoFields,
  type AutoFieldContext,
} from '../services/template/titleBlockService';

import {
  BUILT_IN_SHEET_TEMPLATES,
  createViewportsFromTemplate,
  getNextSheetNumber,
  DEFAULT_NUMBERING_SCHEME,
  type SheetNumberingScheme,
} from '../services/template/sheetTemplateService';

import {
  loadCustomSVGTemplates,
} from '../services/export/svgTitleBlockService';

import type { AnnotationEditState } from './slices/annotationSlice';
import { initialAnnotationEditState } from './slices/annotationSlice';
import {
  computeSectionReferences,
  isSectionReferenceShape,
} from '../services/section/sectionReferenceService';

enablePatches();

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Create title block with fields from SVG template
 */
function createTitleBlockFromSVGTemplate(svgTemplateId: string): TitleBlock | null {
  const templates = loadCustomSVGTemplates();
  const svgTemplate = templates.find(t => t.id === svgTemplateId);

  if (!svgTemplate) return null;

  // Create fields from SVG template's field mappings
  const fields: TitleBlockField[] = svgTemplate.fieldMappings.map((mapping, index) => ({
    id: mapping.fieldId,
    label: mapping.label,
    value: mapping.defaultValue || '',
    x: 5,
    y: 5 + index * 15,
    width: 80,
    height: 12,
    fontSize: 10,
    fontFamily: CAD_DEFAULT_FONT,
    align: 'left' as const,
  }));

  return {
    visible: true,
    x: 10,
    y: 10,
    width: svgTemplate.width,
    height: svgTemplate.height,
    fields,
    svgTemplateId, // Store the SVG template reference
  } as TitleBlock & { svgTemplateId: string };
}

// ============================================================================
// Document State Interface
// ============================================================================

export interface DocumentState {
  // Model
  drawings: Drawing[];
  sheets: Sheet[];
  shapes: Shape[];
  layers: Layer[];

  // Focus
  activeDrawingId: string;
  activeSheetId: string | null;
  activeLayerId: string;
  editorMode: EditorMode;
  drawingViewports: Record<string, Viewport>;
  sheetViewports: Record<string, Viewport>;

  // View
  viewport: Viewport;

  // Drawing state
  isDrawing: boolean;
  drawingPoints: Point[];
  drawingPreview: DrawingPreview;
  currentStyle: ShapeStyle;

  // Selection
  selectedShapeIds: string[];
  hoveredShapeId: string | null;
  selectionBox: SelectionBox | null;
  selectionFilter: string | null;

  // History
  historyStack: HistoryEntry[];
  historyIndex: number;
  maxHistorySize: number;

  // File
  filePath: string | null;
  projectName: string;
  isModified: boolean;

  // Boundary editing
  boundaryEditState: BoundaryEditState;
  boundaryVisible: boolean;

  // Viewport editing
  viewportEditState: ViewportEditState;
  cropRegionEditState: CropRegionEditState;
  layerOverrideEditState: LayerOverrideEditState;

  // Annotations
  selectedAnnotationIds: string[];
  annotationEditState: AnnotationEditState;

  // Text editing
  textEditingId: string | null;
  textEditingContent: string;
  defaultTextStyle: DefaultTextStyle;

  // Title block inline editing
  titleBlockEditingFieldId: string | null;
  hoveredTitleBlockFieldId: string | null;

  // Drawing placement
  isPlacing: boolean;
  placingDrawingId: string | null;
  placingQueryId: string | null;
  previewPosition: Point | null;
  placementScale: number;

  // Title block templates
  customTitleBlockTemplates: TitleBlockTemplate[];
  customSheetTemplates: SheetTemplate[];

  // Parametric shapes
  parametricShapes: import('../types/parametric').ParametricShape[];
  sectionDialogOpen: boolean;
  pendingSection: {
    profileType: import('../types/parametric').ProfileType;
    parameters: import('../types/parametric').ParameterValues;
    presetId?: string;
    rotation: number;
  } | null;

  // Hatch patterns (per-document)
  hatchCustomPatternId: string | null;  // Selected custom pattern ID for hatch tool
  projectPatterns: import('../types/hatch').CustomHatchPattern[];  // Project-level custom patterns

  // Text Styles
  textStyles: TextStyle[];              // Available text styles (built-in + custom)
  activeTextStyleId: string | null;     // Currently selected text style for new text
  textStyleManagerOpen: boolean;        // UI state for text style manager dialog

  // Project Info
  projectInfo: import('../types/projectInfo').ProjectInfo;

  // Unit settings
  unitSettings: import('../units/types').UnitSettings;

  // Block definitions (for DXF blocks / block instances)
  blockDefinitions: import('../types/geometry').BlockDefinition[];
}

// ============================================================================
// Document Actions Interface
// ============================================================================

export interface DocumentActions {
  // Shape actions
  addShape: (shape: Shape) => void;
  addShapes: (shapes: Shape[]) => void;
  updateShape: (id: string, updates: Partial<Shape>) => void;
  updateShapes: (updates: { id: string; updates: Partial<Shape> }[]) => void;
  deleteShape: (id: string) => void;
  deleteShapes: (ids: string[]) => void;
  deleteSelectedShapes: () => void;

  // Drawing actions
  addDrawing: (name?: string, drawingType?: DrawingType) => void;
  addDrawingSilent: (name?: string, drawingType?: DrawingType) => string;
  deleteDrawing: (id: string) => void;
  renameDrawing: (id: string, name: string) => void;
  updateDrawingType: (id: string, drawingType: DrawingType) => void;
  updateDrawingStorey: (id: string, storeyId: string | undefined) => void;
  updateDrawingBoundary: (id: string, boundary: Partial<DrawingBoundary>) => void;
  fitBoundaryToContent: (id: string, padding?: number) => void;
  switchToDrawing: (id: string) => void;
  syncSectionReferences: (sectionDrawingId: string) => void;
  syncAllSectionReferences: () => void;
  syncSectionReferenceToSource: (sectionRefShapeId: string) => void;

  // Sheet actions
  addSheet: (name?: string, paperSize?: PaperSize, orientation?: PaperOrientation, svgTitleBlockId?: string) => string;
  deleteSheet: (id: string) => void;
  renameSheet: (id: string, name: string) => void;
  updateSheet: (id: string, updates: Partial<Sheet>) => void;
  switchToSheet: (id: string) => void;
  switchToDrawingMode: () => void;

  // Sheet Viewport actions
  addSheetViewport: (sheetId: string, drawingId: string, bounds: { x: number; y: number; width: number; height: number }) => void;
  updateSheetViewport: (sheetId: string, viewportId: string, updates: Partial<SheetViewport>) => void;
  deleteSheetViewport: (sheetId: string, viewportId: string) => void;
  centerViewportOnDrawing: (viewportId: string) => void;
  fitViewportToDrawing: (viewportId: string) => void;

  // Title Block actions
  updateTitleBlockField: (sheetId: string, fieldId: string, value: string) => void;
  setTitleBlockVisible: (sheetId: string, visible: boolean) => void;
  applyTitleBlockTemplate: (sheetId: string, templateId: string) => void;
  addRevisionToSheet: (sheetId: string, description: string, drawnBy: string) => void;
  setTitleBlockLogo: (sheetId: string, logoData: string, width: number, height: number) => void;
  removeTitleBlockLogo: (sheetId: string) => void;

  // Title Block Template actions
  addCustomTemplate: (template: TitleBlockTemplate) => void;
  updateCustomTemplate: (templateId: string, updates: Partial<TitleBlockTemplate>) => void;
  deleteCustomTemplate: (templateId: string) => void;
  getAvailableTemplates: (paperSize: string) => TitleBlockTemplate[];
  updateAutoFields: (sheetId: string, projectName?: string) => void;

  // Sheet Template actions
  addSheetFromTemplate: (templateId: string, name: string, draftAssignments?: Record<string, string>) => string | null;
  saveSheetAsTemplate: (sheetId: string, name: string, description: string) => void;
  addCustomSheetTemplate: (template: SheetTemplate) => void;
  deleteCustomSheetTemplate: (templateId: string) => void;
  renumberAllSheets: (scheme: SheetNumberingScheme) => void;

  // Layer actions
  addLayer: (name?: string) => void;
  updateLayer: (id: string, updates: Partial<Layer>) => void;
  deleteLayer: (id: string) => void;
  setActiveLayer: (id: string) => void;

  // View actions
  setViewport: (viewport: Partial<Viewport>) => void;
  zoomIn: () => void;
  zoomOut: () => void;
  zoomToFit: () => void;
  resetView: () => void;

  // Selection actions
  selectShape: (id: string, addToSelection?: boolean) => void;
  selectShapes: (ids: string[]) => void;
  deselectAll: () => void;
  selectAll: () => void;
  setSelectionBox: (box: SelectionBox | null) => void;
  setHoveredShapeId: (id: string | null) => void;

  // History actions
  undo: () => boolean;
  redo: () => boolean;
  canUndo: () => boolean;
  canRedo: () => boolean;
  collapseEntries: (fromIndex: number) => void;

  // Drawing state actions
  setCurrentStyle: (style: Partial<ShapeStyle>) => void;
  setIsDrawing: (isDrawing: boolean) => void;
  setDrawingPreview: (preview: DrawingPreview) => void;
  addDrawingPoint: (point: Point) => void;
  undoDrawingPoint: () => void;
  clearDrawingPoints: () => void;
  closeDrawing: () => void;

  // Text editing actions
  startTextEditing: (shapeId: string) => void;
  endTextEditing: () => void;
  setTextEditingContent: (content: string) => void;
  updateDefaultTextStyle: (style: Partial<DefaultTextStyle>) => void;

  // Title block inline editing actions
  startTitleBlockFieldEditing: (fieldId: string) => void;
  endTitleBlockFieldEditing: () => void;
  setHoveredTitleBlockFieldId: (fieldId: string | null) => void;

  // Boundary actions
  selectBoundary: () => void;
  deselectBoundary: () => void;
  startBoundaryDrag: (handle: BoundaryHandleType, worldPos: Point) => void;
  updateBoundaryDrag: (worldPos: Point) => void;
  endBoundaryDrag: () => void;
  cancelBoundaryDrag: () => void;
  toggleBoundaryVisible: () => void;

  // Viewport edit actions
  selectViewport: (viewportId: string | null) => void;
  startViewportDrag: (handle: ViewportHandleType, sheetPos: Point) => void;
  updateViewportDrag: (sheetPos: Point) => void;
  endViewportDrag: () => void;
  cancelViewportDrag: () => void;
  // Keyboard-initiated viewport move (G key)
  startViewportMove: (basePoint: Point) => void;
  updateViewportMove: (sheetPos: Point) => void;
  commitViewportMove: () => void;
  cancelViewportMove: () => void;

  // Crop region actions
  enableCropRegion: (viewportId: string) => void;
  disableCropRegion: (viewportId: string) => void;
  toggleCropRegion: (viewportId: string) => void;
  startCropRegionEdit: (viewportId: string) => void;
  endCropRegionEdit: () => void;
  startCropRegionDrag: (handle: CropRegionHandleType, draftPos: Point) => void;
  updateCropRegionDrag: (draftPos: Point) => void;
  endCropRegionDrag: () => void;
  cancelCropRegionDrag: () => void;
  resetCropRegion: (viewportId: string) => void;
  setCropRegion: (viewportId: string, cropRegion: CropRegion) => void;

  // Layer override actions
  startLayerOverrideEdit: (viewportId: string) => void;
  endLayerOverrideEdit: () => void;
  setLayerOverride: (viewportId: string, layerId: string, override: Partial<ViewportLayerOverride>) => void;
  removeLayerOverride: (viewportId: string, layerId: string) => void;
  clearLayerOverrides: (viewportId: string) => void;

  // Annotation actions
  selectAnnotation: (annotationId: string, addToSelection?: boolean) => void;
  selectAnnotations: (annotationIds: string[]) => void;
  deselectAllAnnotations: () => void;
  addAnnotation: (sheetId: string, annotation: SheetAnnotation) => void;
  updateAnnotation: (sheetId: string, annotationId: string, updates: Partial<SheetAnnotation>) => void;
  deleteAnnotation: (sheetId: string, annotationId: string) => void;
  deleteSelectedAnnotations: (sheetId: string) => void;
  addTextAnnotation: (sheetId: string, position: Point, content: string, options?: Partial<SheetTextAnnotation>) => string;
  addLeaderAnnotation: (sheetId: string, points: Point[], text: string, options?: Partial<SheetLeaderAnnotation>) => string;
  addRevisionCloud: (sheetId: string, points: Point[], revisionNumber: string, options?: Partial<SheetRevisionCloud>) => string;
  startAnnotationDrag: (annotationId: string, startPoint: Point) => void;
  updateAnnotationDrag: (sheetId: string, currentPoint: Point) => void;
  endAnnotationDrag: (sheetId: string) => void;
  cancelAnnotationDrag: () => void;
  startTextEdit: (annotationId: string) => void;
  endTextEdit: () => void;
  moveAnnotations: (sheetId: string, annotationIds: string[], delta: Point) => void;
  duplicateAnnotations: (sheetId: string, annotationIds: string[]) => string[];

  // Drawing/query placement actions
  startDrawingPlacement: (drawingId: string) => void;
  startQueryPlacement: (queryId: string) => void;
  updatePlacementPreview: (sheetPosition: Point | null) => void;
  confirmPlacement: () => void;
  cancelPlacement: () => void;
  setPlacementScale: (scale: number) => void;

  // Text Style actions
  setActiveTextStyle: (styleId: string | null) => void;
  addTextStyle: (style: Omit<TextStyle, 'id'>) => string;
  updateTextStyle: (id: string, updates: Partial<TextStyle>) => void;
  deleteTextStyle: (id: string) => void;
  duplicateTextStyle: (id: string) => string | undefined;
  applyTextStyleToShape: (shapeId: string, styleId: string) => void;
  textStyleManagerOpen: boolean;
  setTextStyleManagerOpen: (open: boolean) => void;

  // File actions
  setFilePath: (path: string | null) => void;
  setProjectName: (name: string) => void;
  setModified: (modified: boolean) => void;
  newProject: () => void;
  loadProject: (data: {
    shapes: Shape[];
    layers: Layer[];
    activeLayerId: string;
    viewport?: Viewport;
    settings?: { gridSize: number; gridVisible: boolean; snapEnabled: boolean };
    drawings?: Drawing[];
    drafts?: Drawing[];
    sheets?: Sheet[];
    activeDrawingId?: string;
    activeDraftId?: string;
    activeSheetId?: string | null;
    drawingViewports?: Record<string, Viewport>;
    draftViewports?: Record<string, Viewport>;
  }, filePath?: string, projectName?: string) => void;
}

export type DocumentStore = DocumentState & DocumentActions;

// ============================================================================
// Default State Factory
// ============================================================================

export function createEmptyDocumentState(projectName = 'Untitled'): DocumentState {
  const defaultDrawingId = generateId();
  const defaultLayerId = generateId();

  return {
    drawings: [{
      id: defaultDrawingId,
      name: 'Drawing 1',
      boundary: { ...DEFAULT_DRAWING_BOUNDARY },
      scale: DEFAULT_DRAWING_SCALE,
      drawingType: 'standalone',
      createdAt: new Date().toISOString(),
      modifiedAt: new Date().toISOString(),
    }],
    sheets: [],
    shapes: [],
    layers: [{
      id: defaultLayerId,
      name: 'Layer 0',
      drawingId: defaultDrawingId,
      visible: true,
      locked: false,
      color: '#ffffff',
      lineStyle: 'solid',
      lineWidth: 1,
    }],
    activeDrawingId: defaultDrawingId,
    activeSheetId: null,
    activeLayerId: defaultLayerId,
    editorMode: 'drawing',
    drawingViewports: { [defaultDrawingId]: { offsetX: 0, offsetY: 0, zoom: 1 } },
    sheetViewports: {},
    viewport: { offsetX: 0, offsetY: 0, zoom: 1 },
    isDrawing: false,
    drawingPoints: [],
    drawingPreview: null,
    currentStyle: { ...defaultStyle },
    selectedShapeIds: [],
    hoveredShapeId: null,
    selectionBox: null,
    selectionFilter: null,
    historyStack: [],
    historyIndex: -1,
    maxHistorySize: 50,
    filePath: null,
    projectName,
    isModified: false,
    boundaryEditState: {
      isEditing: false,
      isSelected: false,
      activeHandle: null,
      dragStart: null,
      originalBoundary: null,
    },
    boundaryVisible: true,
    viewportEditState: {
      selectedViewportId: null,
      activeHandle: null,
      isDragging: false,
      dragStart: null,
      originalViewport: null,
      isMoving: false,
      moveBasePoint: null,
      moveSnappedPos: null,
    },
    cropRegionEditState: {
      isEditing: false,
      viewportId: null,
      activeHandle: null,
      isDragging: false,
      dragStart: null,
      originalCropRegion: null,
    },
    layerOverrideEditState: {
      isEditing: false,
      viewportId: null,
    },
    selectedAnnotationIds: [],
    annotationEditState: { ...initialAnnotationEditState },
    textEditingId: null,
    textEditingContent: '',
    titleBlockEditingFieldId: null,
    hoveredTitleBlockFieldId: null,
    defaultTextStyle: {
      fontFamily: CAD_DEFAULT_FONT,
      fontSize: 10,
      bold: false,
      italic: false,
      underline: false,
      alignment: 'left',
      color: '#ffffff',
    },
    isPlacing: false,
    placingDrawingId: null,
    placingQueryId: null,
    previewPosition: null,
    placementScale: 0.01,
    customTitleBlockTemplates: [],
    customSheetTemplates: [],
    // Parametric shapes
    parametricShapes: [],
    sectionDialogOpen: false,
    pendingSection: null,
    // Hatch patterns (per-document)
    hatchCustomPatternId: null,
    projectPatterns: [],
    // Text Styles
    textStyles: createDefaultTextStyles(),
    activeTextStyleId: 'annotation-medium', // Default to 3.5mm annotation
    textStyleManagerOpen: false,
    // Project Info
    projectInfo: {
      projectName: '',
      projectNumber: '',
      client: '',
      address: '',
      author: '',
      architect: '',
      contractor: '',
      phase: '',
      status: '',
      discipline: '',
      description: '',
      startDate: '',
      endDate: '',
      customFields: {},
      erpnext: {
        enabled: false,
        url: '',
        apiKey: '',
        apiSecret: '',
      },
    },

    unitSettings: {
      lengthUnit: 'mm',
      lengthPrecision: 0,
      anglePrecision: 1,
      numberFormat: 'period',
      showUnitSuffix: false,
    },

    blockDefinitions: [],
  };
}

// ============================================================================
// History Helper
// ============================================================================

function withHistory(state: DocumentState, mutate: (draft: Shape[]) => void): void {
  const [nextShapes, patches, inversePatches] = produceWithPatches(
    current(state.shapes as any) as Shape[],
    mutate
  );
  if (patches.length === 0) return;

  // Truncate future entries. When historyIndex is -1 (all undone), clear the entire stack.
  if (state.historyIndex < state.historyStack.length - 1) {
    state.historyStack = state.historyStack.slice(0, state.historyIndex + 1);
  }
  state.historyStack.push({ patches, inversePatches });
  if (state.historyStack.length > state.maxHistorySize) {
    state.historyStack.shift();
  }
  state.historyIndex = state.historyStack.length - 1;
  state.shapes = nextShapes as any;
  state.isModified = true;
}

// ============================================================================
// Viewport Edit Helpers
// ============================================================================

const getSheetViewport = (state: DocumentState, viewportId: string) => {
  if (!state.activeSheetId) return null;
  const sheet = state.sheets.find((s) => s.id === state.activeSheetId);
  if (!sheet) return null;
  return sheet.viewports.find((vp) => vp.id === viewportId) || null;
};

const createDefaultCropRegion = (state: DocumentState, drawingId: string): CropRegion => {
  const drawing = state.drawings.find((d) => d.id === drawingId);
  const boundary = drawing?.boundary || { x: -500, y: -500, width: 1000, height: 1000 };
  return {
    type: 'rectangular',
    points: [
      { x: boundary.x, y: boundary.y },
      { x: boundary.x + boundary.width, y: boundary.y + boundary.height },
    ],
    enabled: true,
  };
};

const calculateViewportSize = (drawing: Drawing, scale: number) => ({
  width: drawing.boundary.width * scale,
  height: drawing.boundary.height * scale,
});

// ============================================================================
// Store Factory
// ============================================================================

export function createDocumentStoreInstance(initial?: Partial<DocumentState>): StoreApi<DocumentStore> {
  const initialState = { ...createEmptyDocumentState(), ...initial };

  return createStore<DocumentStore>()(
    immer((set, get) => ({
      ...initialState,

      // ======================================================================
      // Shape Actions
      // ======================================================================

      addShape: (shape) =>
        set((state) => {
          withHistory(state, (draft) => { draft.push(shape); });
        }),

      addShapes: (shapes) =>
        set((state) => {
          if (shapes.length === 0) return;
          withHistory(state, (draft) => {
            for (const shape of shapes) draft.push(shape);
          });
        }),

      updateShape: (id, updates) =>
        set((state) => {
          withHistory(state, (draft) => {
            const index = draft.findIndex((s) => s.id === id);
            if (index !== -1) {
              draft[index] = { ...draft[index], ...updates } as Shape;
            }
          });
        }),

      updateShapes: (updates) =>
        set((state) => {
          if (updates.length === 0) return;
          withHistory(state, (draft) => {
            for (const { id, updates: u } of updates) {
              const index = draft.findIndex((s) => s.id === id);
              if (index !== -1) {
                draft[index] = { ...draft[index], ...u } as Shape;
              }
            }
          });
        }),

      deleteShape: (id) =>
        set((state) => {
          withHistory(state, (draft) => {
            const idx = draft.findIndex((s) => s.id === id);
            if (idx !== -1) draft.splice(idx, 1);
          });
          state.selectedShapeIds = state.selectedShapeIds.filter((sid) => sid !== id);
        }),

      deleteShapes: (ids) =>
        set((state) => {
          if (ids.length === 0) return;
          const idSet = new Set(ids);
          withHistory(state, (draft) => {
            for (let i = draft.length - 1; i >= 0; i--) {
              if (idSet.has(draft[i].id)) draft.splice(i, 1);
            }
          });
          state.selectedShapeIds = state.selectedShapeIds.filter((sid) => !idSet.has(sid));
        }),

      deleteSelectedShapes: () =>
        set((state) => {
          if (state.selectedShapeIds.length === 0) return;
          const selected = new Set(state.selectedShapeIds);
          withHistory(state, (draft) => {
            for (let i = draft.length - 1; i >= 0; i--) {
              if (selected.has(draft[i].id)) draft.splice(i, 1);
            }
          });
          state.selectedShapeIds = [];
        }),

      // ======================================================================
      // Drawing Actions
      // ======================================================================

      addDrawing: (name, drawingType = 'standalone') =>
        set((state) => {
          const id = generateId();
          // For plan drawings, auto-assign the first available storey
          let autoStoreyId: string | undefined;
          if (drawingType === 'plan') {
            const ps = useAppStore.getState().projectStructure;
            if (ps?.buildings) {
              for (const building of ps.buildings) {
                if (building.storeys.length > 0) {
                  autoStoreyId = building.storeys[0].id;
                  break;
                }
              }
            }
          }
          const newDrawing: Drawing = {
            id,
            name: name || `Drawing ${state.drawings.length + 1}`,
            boundary: { ...DEFAULT_DRAWING_BOUNDARY },
            scale: DEFAULT_DRAWING_SCALE,
            drawingType,
            storeyId: autoStoreyId,
            createdAt: new Date().toISOString(),
            modifiedAt: new Date().toISOString(),
          };
          state.drawings.push(newDrawing);

          const newLayer: Layer = {
            id: generateId(),
            name: 'Layer 0',
            drawingId: id,
            visible: true,
            locked: false,
            color: '#ffffff',
            lineStyle: 'solid',
            lineWidth: 1,
          };
          state.layers.push(newLayer);

          const canvasSize = useAppStore.getState().canvasSize;
          const b = newDrawing.boundary;
          const centerX = b.x + b.width / 2;
          const centerY = b.y + b.height / 2;
          state.drawingViewports[id] = {
            offsetX: canvasSize.width / 2 - centerX,
            offsetY: canvasSize.height / 2 - centerY,
            zoom: 1,
          };

          state.activeDrawingId = id;
          state.activeLayerId = newLayer.id;
          state.viewport = state.drawingViewports[id];
          state.editorMode = 'drawing';
          state.activeSheetId = null;
          state.selectedShapeIds = [];
          state.isModified = true;
        }),

      addDrawingSilent: (name, drawingType = 'standalone') => {
        const id = generateId();
        set((state) => {
          // For plan drawings, auto-assign the first available storey
          let autoStoreyId: string | undefined;
          if (drawingType === 'plan') {
            const ps = useAppStore.getState().projectStructure;
            if (ps?.buildings) {
              for (const building of ps.buildings) {
                if (building.storeys.length > 0) {
                  autoStoreyId = building.storeys[0].id;
                  break;
                }
              }
            }
          }
          const newDrawing: Drawing = {
            id,
            name: name || `Drawing ${state.drawings.length + 1}`,
            boundary: { ...DEFAULT_DRAWING_BOUNDARY },
            scale: DEFAULT_DRAWING_SCALE,
            drawingType,
            storeyId: autoStoreyId,
            createdAt: new Date().toISOString(),
            modifiedAt: new Date().toISOString(),
          };
          state.drawings.push(newDrawing);

          const newLayer: Layer = {
            id: generateId(),
            name: 'Layer 0',
            drawingId: id,
            visible: true,
            locked: false,
            color: '#ffffff',
            lineStyle: 'solid',
            lineWidth: 1,
          };
          state.layers.push(newLayer);

          const canvasSize = useAppStore.getState().canvasSize;
          const b = newDrawing.boundary;
          const centerX = b.x + b.width / 2;
          const centerY = b.y + b.height / 2;
          state.drawingViewports[id] = {
            offsetX: canvasSize.width / 2 - centerX,
            offsetY: canvasSize.height / 2 - centerY,
            zoom: 1,
          };

          state.isModified = true;
        });
        return id;
      },

      deleteDrawing: (id) =>
        set((state) => {
          if (state.drawings.length <= 1) return;
          state.drawings = state.drawings.filter((d) => d.id !== id);
          state.shapes = state.shapes.filter((s) => s.drawingId !== id);
          state.layers = state.layers.filter((l) => l.drawingId !== id);
          delete state.drawingViewports[id];
          state.sheets.forEach((sheet) => {
            sheet.viewports = sheet.viewports.filter((vp) => vp.drawingId !== id);
          });
          if (state.activeDrawingId === id) {
            const firstDrawing = state.drawings[0];
            state.activeDrawingId = firstDrawing.id;
            state.viewport = state.drawingViewports[firstDrawing.id] || { offsetX: 0, offsetY: 0, zoom: 1 };
            const layerInDrawing = state.layers.find((l) => l.drawingId === firstDrawing.id);
            if (layerInDrawing) state.activeLayerId = layerInDrawing.id;
          }
          state.selectedShapeIds = [];
          state.isModified = true;
        }),

      renameDrawing: (id, name) =>
        set((state) => {
          const drawing = state.drawings.find((d) => d.id === id);
          if (drawing) {
            drawing.name = name;
            drawing.modifiedAt = new Date().toISOString();
            state.isModified = true;
          }
        }),

      updateDrawingType: (id, drawingType) =>
        set((state) => {
          const drawing = state.drawings.find((d) => d.id === id);
          if (drawing) {
            drawing.drawingType = drawingType;
            if (drawingType !== 'plan') {
              // Clear storeyId if switching away from plan type
              delete drawing.storeyId;
            } else if (!drawing.storeyId) {
              // Auto-assign the first available storey when switching to plan type
              const ps = useAppStore.getState().projectStructure;
              if (ps?.buildings) {
                for (const building of ps.buildings) {
                  if (building.storeys.length > 0) {
                    drawing.storeyId = building.storeys[0].id;
                    break;
                  }
                }
              }
            }
            drawing.modifiedAt = new Date().toISOString();
            state.isModified = true;
          }
        }),

      updateDrawingStorey: (id, storeyId) =>
        set((state) => {
          const drawing = state.drawings.find((d) => d.id === id);
          if (drawing) {
            drawing.storeyId = storeyId;
            drawing.modifiedAt = new Date().toISOString();
            state.isModified = true;
          }
        }),

      updateDrawingBoundary: (id, boundary) =>
        set((state) => {
          const drawing = state.drawings.find((d) => d.id === id);
          if (drawing) {
            drawing.boundary = { ...drawing.boundary, ...boundary };
            drawing.modifiedAt = new Date().toISOString();
            state.isModified = true;

            // Update all viewports showing this drawing (viewport resizes with boundary)
            for (const sheet of state.sheets) {
              for (const viewport of sheet.viewports) {
                if (viewport.drawingId === id) {
                  // Calculate new viewport size from updated boundary × viewport scale
                  const newWidth = drawing.boundary.width * viewport.scale;
                  const newHeight = drawing.boundary.height * viewport.scale;

                  // Update viewport dimensions
                  viewport.width = newWidth;
                  viewport.height = newHeight;

                  // Update center to match new boundary center
                  viewport.centerX = drawing.boundary.x + drawing.boundary.width / 2;
                  viewport.centerY = drawing.boundary.y + drawing.boundary.height / 2;
                }
              }
            }
          }
        }),

      fitBoundaryToContent: (id, padding = 50) =>
        set((state) => {
          const drawing = state.drawings.find((d) => d.id === id);
          if (!drawing) return;
          const drawingShapes = state.shapes.filter((s) => s.drawingId === id);
          if (drawingShapes.length === 0) {
            drawing.boundary = { ...DEFAULT_DRAWING_BOUNDARY };
            drawing.modifiedAt = new Date().toISOString();
            state.isModified = true;
            return;
          }
          let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
          for (const shape of drawingShapes) {
            const bounds = getShapeBounds(shape);
            if (bounds) {
              minX = Math.min(minX, bounds.minX);
              minY = Math.min(minY, bounds.minY);
              maxX = Math.max(maxX, bounds.maxX);
              maxY = Math.max(maxY, bounds.maxY);
            }
          }
          if (minX === Infinity) return;
          drawing.boundary = {
            x: minX - padding,
            y: minY - padding,
            width: (maxX - minX) + padding * 2,
            height: (maxY - minY) + padding * 2,
          };
          drawing.modifiedAt = new Date().toISOString();
          state.isModified = true;
        }),

      switchToDrawing: (id) =>
        set((state) => {
          const drawing = state.drawings.find((d) => d.id === id);
          if (!drawing) return;
          if (state.editorMode === 'drawing' && state.activeDrawingId) {
            state.drawingViewports[state.activeDrawingId] = { ...state.viewport };
          }
          state.activeDrawingId = id;
          state.editorMode = 'drawing';
          state.activeSheetId = null;
          if (state.drawingViewports[id]) {
            state.viewport = state.drawingViewports[id];
          } else {
            const canvasSize = useAppStore.getState().canvasSize;
            const b = drawing.boundary;
            const centerX = b.x + b.width / 2;
            const centerY = b.y + b.height / 2;
            state.viewport = {
              offsetX: canvasSize.width / 2 - centerX,
              offsetY: canvasSize.height / 2 - centerY,
              zoom: 1,
            };
          }
          const layerInDrawing = state.layers.find((l) => l.drawingId === id);
          if (layerInDrawing) state.activeLayerId = layerInDrawing.id;
          state.selectedShapeIds = [];

          // Auto-sync section references when switching to a section drawing
          if (drawing.drawingType === 'section') {
            const sectionLayerId = layerInDrawing?.id || `section-layer-${id}`;
            const ps = useAppStore.getState().projectStructure;
            if (ps) {
              const result = computeSectionReferences(
                drawing,
                state.shapes as Shape[],
                state.drawings as Drawing[],
                ps,
              );
              if (result) {
                // Remove old section reference shapes
                state.shapes = (state.shapes as Shape[]).filter(
                  s => !(s.drawingId === id && isSectionReferenceShape(s))
                ) as typeof state.shapes;
                // Add new ones with correct layer ID
                for (const gl of result.gridlines) {
                  (state.shapes as Shape[]).push({ ...gl, layerId: sectionLayerId } as unknown as Shape);
                }
                for (const lv of result.levels) {
                  (state.shapes as Shape[]).push({ ...lv, layerId: sectionLayerId } as unknown as Shape);
                }
                drawing.sectionReferences = result.references;
              }
            }
          }
        }),

      syncSectionReferences: (sectionDrawingId) =>
        set((state) => {
          const drawing = state.drawings.find((d) => d.id === sectionDrawingId);
          if (!drawing || drawing.drawingType !== 'section') return;
          const layerInDrawing = state.layers.find((l) => l.drawingId === sectionDrawingId);
          const sectionLayerId = layerInDrawing?.id || `section-layer-${sectionDrawingId}`;
          const ps = useAppStore.getState().projectStructure;
          if (!ps) return;
          const result = computeSectionReferences(
            drawing,
            state.shapes as Shape[],
            state.drawings as Drawing[],
            ps,
          );
          if (result) {
            state.shapes = (state.shapes as Shape[]).filter(
              s => !(s.drawingId === sectionDrawingId && isSectionReferenceShape(s))
            ) as typeof state.shapes;
            for (const gl of result.gridlines) {
              (state.shapes as Shape[]).push({ ...gl, layerId: sectionLayerId } as unknown as Shape);
            }
            for (const lv of result.levels) {
              (state.shapes as Shape[]).push({ ...lv, layerId: sectionLayerId } as unknown as Shape);
            }
            drawing.sectionReferences = result.references;
            drawing.modifiedAt = new Date().toISOString();
            state.isModified = true;
          }
        }),

      syncAllSectionReferences: () =>
        set((state) => {
          const ps = useAppStore.getState().projectStructure;
          if (!ps) return;
          const sectionDrawings = state.drawings.filter(d => d.drawingType === 'section');
          for (const sectionDrawing of sectionDrawings) {
            const layerInDrawing = state.layers.find((l) => l.drawingId === sectionDrawing.id);
            const sectionLayerId = layerInDrawing?.id || `section-layer-${sectionDrawing.id}`;
            const result = computeSectionReferences(
              sectionDrawing, state.shapes as Shape[], state.drawings as Drawing[], ps,
            );
            if (result) {
              state.shapes = (state.shapes as Shape[]).filter(
                s => !(s.drawingId === sectionDrawing.id && isSectionReferenceShape(s))
              ) as typeof state.shapes;
              for (const gl of result.gridlines) {
                (state.shapes as Shape[]).push({ ...gl, layerId: sectionLayerId } as unknown as Shape);
              }
              for (const lv of result.levels) {
                (state.shapes as Shape[]).push({ ...lv, layerId: sectionLayerId } as unknown as Shape);
              }
              sectionDrawing.sectionReferences = result.references;
            }
          }
        }),

      syncSectionReferenceToSource: (_sectionRefShapeId) => {
        // Delegate to appStore's implementation (model slice)
        // The documentStore uses the appStore for cross-slice operations
        useAppStore.getState().syncSectionReferenceToSource?.(_sectionRefShapeId);
      },

      // ======================================================================
      // Sheet Actions
      // ======================================================================

      addSheet: (name, paperSize = 'A4', orientation = 'landscape', svgTitleBlockId) => {
        const id = generateId();

        // If SVG title block ID is provided, create title block from SVG template
        // This must be done outside set() because loadCustomSVGTemplates() reads from localStorage
        let titleBlock;
        if (svgTitleBlockId) {
          titleBlock = createTitleBlockFromSVGTemplate(svgTitleBlockId);
        }
        if (!titleBlock) {
          titleBlock = createDefaultTitleBlock();
          // Store SVG template ID if provided (fallback case)
          if (svgTitleBlockId) {
            (titleBlock as unknown as { svgTemplateId?: string }).svgTemplateId = svgTitleBlockId;
          }
        }

        set((state) => {
          const newSheet: Sheet = {
            id,
            name: name || `Sheet ${state.sheets.length + 1}`,
            paperSize,
            orientation,
            viewports: [],
            titleBlock,
            annotations: [],
            createdAt: new Date().toISOString(),
            modifiedAt: new Date().toISOString(),
          };
          state.sheets.push(newSheet);
          state.isModified = true;
        });
        return id;
      },

      deleteSheet: (id) =>
        set((state) => {
          state.sheets = state.sheets.filter((s) => s.id !== id);
          if (state.activeSheetId === id) {
            state.activeSheetId = null;
            state.editorMode = 'drawing';
            state.viewport = state.drawingViewports[state.activeDrawingId] || { offsetX: 0, offsetY: 0, zoom: 1 };
          }
          state.isModified = true;
        }),

      renameSheet: (id, name) =>
        set((state) => {
          const sheet = state.sheets.find((s) => s.id === id);
          if (sheet) {
            sheet.name = name;
            sheet.modifiedAt = new Date().toISOString();
            state.isModified = true;
          }
        }),

      updateSheet: (id, updates) =>
        set((state) => {
          const sheet = state.sheets.find((s) => s.id === id);
          if (sheet) {
            Object.assign(sheet, updates);
            sheet.modifiedAt = new Date().toISOString();
            state.isModified = true;
          }
        }),

      switchToSheet: (id) =>
        set((state) => {
          const sheet = state.sheets.find((s) => s.id === id);
          if (!sheet) return;
          if (state.editorMode === 'drawing' && state.activeDrawingId) {
            state.drawingViewports[state.activeDrawingId] = { ...state.viewport };
          }
          state.activeSheetId = id;
          state.editorMode = 'sheet';
          state.viewport = { offsetX: 0, offsetY: 0, zoom: 1 };
          state.selectedShapeIds = [];

          const sheetIndex = state.sheets.findIndex((s) => s.id === id);
          const totalSheets = state.sheets.length;
          const viewportScales = sheet.viewports.map((vp) => vp.scale);

          const sheetNoField = sheet.titleBlock.fields.find((f) => f.id === 'sheetNo');
          if (sheetNoField) sheetNoField.value = `${sheetIndex + 1} of ${totalSheets}`;

          const dateField = sheet.titleBlock.fields.find((f) => f.id === 'date');
          if (dateField && !dateField.value) dateField.value = new Date().toISOString().split('T')[0];

          const scaleField = sheet.titleBlock.fields.find((f) => f.id === 'scale');
          if (scaleField && viewportScales.length > 0) {
            const uniqueScales = [...new Set(viewportScales)];
            if (uniqueScales.length === 1) {
              const scale = uniqueScales[0];
              if (scale >= 1) {
                scaleField.value = `${Number.isInteger(scale) ? scale : scale.toFixed(1)}:1`;
              } else {
                const inverse = 1 / scale;
                scaleField.value = `1:${Number.isInteger(inverse) ? inverse : Math.round(inverse)}`;
              }
            } else {
              scaleField.value = 'As Noted';
            }
          }
        }),

      switchToDrawingMode: () =>
        set((state) => {
          state.editorMode = 'drawing';
          state.activeSheetId = null;
          state.viewport = state.drawingViewports[state.activeDrawingId] || { offsetX: 0, offsetY: 0, zoom: 1 };
        }),

      // ======================================================================
      // Sheet Viewport Actions
      // ======================================================================

      addSheetViewport: (sheetId, drawingId, bounds) =>
        set((state) => {
          const sheet = state.sheets.find((s) => s.id === sheetId);
          if (!sheet) return;
          const newViewport: SheetViewport = {
            id: generateId(),
            drawingId,
            x: bounds.x, y: bounds.y,
            width: bounds.width, height: bounds.height,
            centerX: 0, centerY: 0,
            scale: 0.01,
            locked: false, visible: true,
          };
          sheet.viewports.push(newViewport);
          sheet.modifiedAt = new Date().toISOString();
          state.isModified = true;
        }),

      updateSheetViewport: (sheetId, viewportId, updates) =>
        set((state) => {
          const sheet = state.sheets.find((s) => s.id === sheetId);
          if (!sheet) return;
          const viewport = sheet.viewports.find((vp) => vp.id === viewportId);
          if (viewport) {
            Object.assign(viewport, updates);
            sheet.modifiedAt = new Date().toISOString();
            state.isModified = true;
          }
        }),

      deleteSheetViewport: (sheetId, viewportId) =>
        set((state) => {
          const sheet = state.sheets.find((s) => s.id === sheetId);
          if (!sheet) return;
          sheet.viewports = sheet.viewports.filter((vp) => vp.id !== viewportId);
          sheet.modifiedAt = new Date().toISOString();
          state.isModified = true;
          if (state.viewportEditState.selectedViewportId === viewportId) {
            state.viewportEditState.selectedViewportId = null;
          }
        }),

      centerViewportOnDrawing: (viewportId) =>
        set((state) => {
          if (!state.activeSheetId) return;
          const sheet = state.sheets.find((s) => s.id === state.activeSheetId);
          if (!sheet) return;
          const viewport = sheet.viewports.find((vp) => vp.id === viewportId);
          if (!viewport) return;
          const drawing = state.drawings.find((d) => d.id === viewport.drawingId);
          if (!drawing) return;
          viewport.centerX = drawing.boundary.x + drawing.boundary.width / 2;
          viewport.centerY = drawing.boundary.y + drawing.boundary.height / 2;
          sheet.modifiedAt = new Date().toISOString();
          state.isModified = true;
        }),

      fitViewportToDrawing: (viewportId) =>
        set((state) => {
          if (!state.activeSheetId) return;
          const sheet = state.sheets.find((s) => s.id === state.activeSheetId);
          if (!sheet) return;
          const viewport = sheet.viewports.find((vp) => vp.id === viewportId);
          if (!viewport) return;
          const drawing = state.drawings.find((d) => d.id === viewport.drawingId);
          if (!drawing) return;
          const scaleX = viewport.width / drawing.boundary.width;
          const scaleY = viewport.height / drawing.boundary.height;
          const scale = Math.min(scaleX, scaleY) * 0.9;
          viewport.centerX = drawing.boundary.x + drawing.boundary.width / 2;
          viewport.centerY = drawing.boundary.y + drawing.boundary.height / 2;
          viewport.scale = scale;
          sheet.modifiedAt = new Date().toISOString();
          state.isModified = true;
        }),

      // ======================================================================
      // Title Block Actions
      // ======================================================================

      updateTitleBlockField: (sheetId, fieldId, value) =>
        set((state) => {
          const sheet = state.sheets.find((s) => s.id === sheetId);
          if (!sheet) return;
          const field = sheet.titleBlock.fields.find((f) => f.id === fieldId);
          if (field) {
            field.value = value;
            sheet.modifiedAt = new Date().toISOString();
            state.isModified = true;
          }
        }),

      setTitleBlockVisible: (sheetId, visible) =>
        set((state) => {
          const sheet = state.sheets.find((s) => s.id === sheetId);
          if (sheet) {
            sheet.titleBlock.visible = visible;
            sheet.modifiedAt = new Date().toISOString();
            state.isModified = true;
          }
        }),

      applyTitleBlockTemplate: (sheetId, templateId) =>
        set((state) => {
          const sheet = state.sheets.find((s) => s.id === sheetId);
          if (!sheet) return;
          let template = BUILT_IN_TEMPLATES.find((t) => t.id === templateId);
          if (!template) template = state.customTitleBlockTemplates.find((t) => t.id === templateId);
          if (!template) return;
          const newTitleBlock = createTitleBlockFromTemplate(template);
          const existingFields = sheet.titleBlock.fields;
          newTitleBlock.fields = newTitleBlock.fields.map((field) => {
            const existingField = existingFields.find((ef) => ef.id === field.id);
            if (existingField && existingField.value) return { ...field, value: existingField.value };
            return field;
          });
          sheet.titleBlock = newTitleBlock as Sheet['titleBlock'];
          sheet.modifiedAt = new Date().toISOString();
          state.isModified = true;
        }),

      addRevisionToSheet: (sheetId, description, drawnBy) =>
        set((state) => {
          const sheet = state.sheets.find((s) => s.id === sheetId);
          if (!sheet) return;
          const titleBlock = sheet.titleBlock as unknown as EnhancedTitleBlock;
          if (!titleBlock.revisionTable) {
            titleBlock.revisionTable = {
              visible: true, maxRows: 5,
              columns: [
                { id: 'number', label: 'Rev', width: 15 },
                { id: 'date', label: 'Date', width: 25 },
                { id: 'description', label: 'Description', width: 50 },
                { id: 'drawnBy', label: 'By', width: 15 },
              ],
              revisions: [],
            };
          }
          titleBlock.revisionTable = addRevisionToTable(titleBlock.revisionTable, description, drawnBy);
          titleBlock.revisionTable.visible = true;
          const revisionField = sheet.titleBlock.fields.find((f) => f.id === 'revision');
          if (revisionField && titleBlock.revisionTable.revisions.length > 0) {
            revisionField.value = titleBlock.revisionTable.revisions[titleBlock.revisionTable.revisions.length - 1].number;
          }
          sheet.modifiedAt = new Date().toISOString();
          state.isModified = true;
        }),

      setTitleBlockLogo: (sheetId, logoData, width, height) =>
        set((state) => {
          const sheet = state.sheets.find((s) => s.id === sheetId);
          if (!sheet) return;
          const titleBlock = sheet.titleBlock as unknown as EnhancedTitleBlock;
          const logoField = sheet.titleBlock.fields.find((f) => f.id === 'logo');
          titleBlock.logo = {
            data: logoData,
            x: logoField?.x ?? 5, y: logoField?.y ?? 5,
            width, height,
          };
          sheet.modifiedAt = new Date().toISOString();
          state.isModified = true;
        }),

      removeTitleBlockLogo: (sheetId) =>
        set((state) => {
          const sheet = state.sheets.find((s) => s.id === sheetId);
          if (!sheet) return;
          const titleBlock = sheet.titleBlock as unknown as EnhancedTitleBlock;
          delete titleBlock.logo;
          sheet.modifiedAt = new Date().toISOString();
          state.isModified = true;
        }),

      // ======================================================================
      // Title Block Template Actions
      // ======================================================================

      addCustomTemplate: (template) =>
        set((state) => { state.customTitleBlockTemplates.push(template); state.isModified = true; }),

      updateCustomTemplate: (templateId, updates) =>
        set((state) => {
          const index = state.customTitleBlockTemplates.findIndex((t) => t.id === templateId);
          if (index !== -1) {
            state.customTitleBlockTemplates[index] = { ...state.customTitleBlockTemplates[index], ...updates };
            state.isModified = true;
          }
        }),

      deleteCustomTemplate: (templateId) =>
        set((state) => {
          state.customTitleBlockTemplates = state.customTitleBlockTemplates.filter((t) => t.id !== templateId);
          state.isModified = true;
        }),

      getAvailableTemplates: (paperSize) => {
        return getTemplatesForPaperSize(paperSize);
      },

      updateAutoFields: (sheetId, projectName = '') =>
        set((state) => {
          const sheet = state.sheets.find((s) => s.id === sheetId);
          if (!sheet) return;
          const sheetIndex = state.sheets.findIndex((s) => s.id === sheetId);
          const totalSheets = state.sheets.length;
          const viewportScales = sheet.viewports.map((vp) => vp.scale);
          const context: AutoFieldContext = { totalSheets, currentSheetIndex: sheetIndex, projectName, viewportScales };
          const titleBlock = sheet.titleBlock as unknown as EnhancedTitleBlock;
          if (titleBlock.fields && titleBlock.fields.length > 0) {
            const updatedFields = calculateAutoFields(titleBlock.fields, context);
            for (const updatedField of updatedFields) {
              const field = sheet.titleBlock.fields.find((f) => f.id === updatedField.id);
              if (field) field.value = updatedField.value;
            }
            sheet.modifiedAt = new Date().toISOString();
          }
        }),

      // ======================================================================
      // Sheet Template Actions
      // ======================================================================

      addSheetFromTemplate: (templateId, name, draftAssignments = {}) => {
        // Find template before calling set() so we can return null if not found
        let template = BUILT_IN_SHEET_TEMPLATES.find((t) => t.id === templateId);
        if (!template) template = get().customSheetTemplates.find((t) => t.id === templateId);
        if (!template) return null;

        const id = generateId();
        set((state) => {
          const sheetNumber = getNextSheetNumber(state.sheets, DEFAULT_NUMBERING_SCHEME);
          const viewports = createViewportsFromTemplate(template!, draftAssignments);
          const newSheet: Sheet = {
            id,
            name: name || `Sheet ${state.sheets.length + 1}`,
            paperSize: template!.paperSize as PaperSize,
            orientation: template!.orientation as PaperOrientation,
            viewports,
            titleBlock: createDefaultTitleBlock(),
            annotations: [],
            createdAt: new Date().toISOString(),
            modifiedAt: new Date().toISOString(),
          };
          const numberField = newSheet.titleBlock.fields.find((f) => f.id === 'number');
          if (numberField) numberField.value = sheetNumber;
          state.sheets.push(newSheet);
          state.isModified = true;
          state.activeSheetId = newSheet.id;
          state.editorMode = 'sheet';
          state.viewport = { offsetX: 0, offsetY: 0, zoom: 1 };
          state.selectedShapeIds = [];
        });
        return id;
      },

      saveSheetAsTemplate: (sheetId, name, description) =>
        set((state) => {
          const sheet = state.sheets.find((s) => s.id === sheetId);
          if (!sheet) return;
          const placeholders = sheet.viewports.map((vp, index) => ({
            id: `placeholder-${index + 1}`, name: `View ${index + 1}`,
            x: vp.x, y: vp.y, width: vp.width, height: vp.height, defaultScale: vp.scale,
          }));
          const newTemplate: SheetTemplate = {
            id: generateId(), name, description,
            paperSize: sheet.paperSize, orientation: sheet.orientation,
            titleBlockTemplateId: '', viewportPlaceholders: placeholders,
            isBuiltIn: false,
            createdAt: new Date().toISOString(), modifiedAt: new Date().toISOString(),
          };
          state.customSheetTemplates.push(newTemplate);
          state.isModified = true;
        }),

      addCustomSheetTemplate: (template) =>
        set((state) => { state.customSheetTemplates.push(template); state.isModified = true; }),

      deleteCustomSheetTemplate: (templateId) =>
        set((state) => {
          state.customSheetTemplates = state.customSheetTemplates.filter((t) => t.id !== templateId);
          state.isModified = true;
        }),

      renumberAllSheets: (scheme) =>
        set((state) => {
          state.sheets.forEach((sheet, index) => {
            const newNumber = `${scheme.prefix}${scheme.separator}${(scheme.startNumber + index).toString().padStart(scheme.digits, '0')}`;
            const numberField = sheet.titleBlock.fields.find((f) => f.id === 'number');
            if (numberField) numberField.value = newNumber;
            const sheetNoField = sheet.titleBlock.fields.find((f) => f.id === 'sheetNo');
            if (sheetNoField) sheetNoField.value = `${index + 1} of ${state.sheets.length}`;
            sheet.modifiedAt = new Date().toISOString();
          });
          state.isModified = true;
        }),

      // ======================================================================
      // Layer Actions
      // ======================================================================

      addLayer: (name) =>
        set((state) => {
          const newLayer: Layer = {
            id: generateId(),
            name: name || `Layer ${state.layers.filter(l => l.drawingId === state.activeDrawingId).length}`,
            drawingId: state.activeDrawingId,
            visible: true, locked: false, color: '#ffffff', lineStyle: 'solid', lineWidth: 1,
          };
          state.layers.push(newLayer);
          state.activeLayerId = newLayer.id;
        }),

      updateLayer: (id, updates) =>
        set((state) => {
          const index = state.layers.findIndex((l) => l.id === id);
          if (index !== -1) state.layers[index] = { ...state.layers[index], ...updates };
        }),

      deleteLayer: (id) =>
        set((state) => {
          const layersInDrawing = state.layers.filter((l) => l.drawingId === state.activeDrawingId);
          if (layersInDrawing.length <= 1) return;
          state.layers = state.layers.filter((l) => l.id !== id);
          if (state.activeLayerId === id) {
            const remaining = state.layers.filter((l) => l.drawingId === state.activeDrawingId);
            state.activeLayerId = remaining[0]?.id || state.layers[0].id;
          }
          state.shapes.forEach((s) => { if (s.layerId === id) s.layerId = state.activeLayerId; });
        }),

      setActiveLayer: (id) =>
        set((state) => { state.activeLayerId = id; }),

      // ======================================================================
      // View Actions
      // ======================================================================

      setViewport: (viewport) =>
        set((state) => { state.viewport = { ...state.viewport, ...viewport }; }),

      zoomIn: () =>
        set((state) => { state.viewport.zoom = Math.min(state.viewport.zoom * 1.2, 100); }),

      zoomOut: () =>
        set((state) => { state.viewport.zoom = Math.max(state.viewport.zoom / 1.2, 0.001); }),

      zoomToFit: () =>
        set((state) => { state.viewport = { offsetX: 0, offsetY: 0, zoom: 1 }; }),

      resetView: () =>
        set((state) => { state.viewport = { offsetX: 0, offsetY: 0, zoom: 1 }; }),

      // ======================================================================
      // Selection Actions
      // ======================================================================

      selectShape: (id, addToSelection = false) =>
        set((state) => {
          if (addToSelection) {
            if (!state.selectedShapeIds.includes(id)) state.selectedShapeIds.push(id);
          } else {
            state.selectedShapeIds = [id];
          }
        }),

      selectShapes: (ids) =>
        set((state) => { state.selectedShapeIds = ids; }),

      deselectAll: () =>
        set((state) => { state.selectedShapeIds = []; }),

      selectAll: () =>
        set((state) => {
          state.selectedShapeIds = state.shapes
            .filter((s) => {
              if (s.drawingId !== state.activeDrawingId) return false;
              const layer = state.layers.find((l) => l.id === s.layerId);
              return layer && layer.visible && !layer.locked && s.visible && !s.locked;
            })
            .map((s) => s.id);
        }),

      setSelectionBox: (box) =>
        set((state) => { state.selectionBox = box; }),

      setHoveredShapeId: (id) =>
        set((state) => { state.hoveredShapeId = id; }),

      // ======================================================================
      // History Actions
      // ======================================================================

      undo: () => {
        let success = false;
        set((state) => {
          if (state.historyIndex < 0) return;
          const entry = state.historyStack[state.historyIndex];
          if (!entry) return;
          const target = entry.target || 'shapes';
          if (target === 'parametricShapes') {
            state.parametricShapes = applyPatches(
              current(state.parametricShapes as any),
              entry.inversePatches
            ) as any;
          } else {
            state.shapes = applyPatches(
              current(state.shapes as any) as Shape[],
              entry.inversePatches
            ) as any;
          }
          state.historyIndex--;
          state.selectedShapeIds = [];
          success = true;
        });
        return success;
      },

      redo: () => {
        let success = false;
        set((state) => {
          const nextIndex = state.historyIndex + 1;
          if (nextIndex >= state.historyStack.length) return;
          const entry = state.historyStack[nextIndex];
          if (!entry) return;
          const target = entry.target || 'shapes';
          if (target === 'parametricShapes') {
            state.parametricShapes = applyPatches(
              current(state.parametricShapes as any),
              entry.patches
            ) as any;
          } else {
            state.shapes = applyPatches(
              current(state.shapes as any) as Shape[],
              entry.patches
            ) as any;
          }
          state.historyIndex = nextIndex;
          state.selectedShapeIds = [];
          success = true;
        });
        return success;
      },

      canUndo: () => get().historyIndex >= 0,
      canRedo: () => { const s = get(); return s.historyIndex < s.historyStack.length - 1; },

      collapseEntries: (fromIndex) =>
        set((state) => {
          if (fromIndex > state.historyIndex || fromIndex < 0) return;
          if (fromIndex === state.historyIndex) return;

          // Only collapse entries that share the same target
          const baseTarget = state.historyStack[fromIndex].target || 'shapes';
          const allSameTarget = state.historyStack
            .slice(fromIndex, state.historyIndex + 1)
            .every(e => (e.target || 'shapes') === baseTarget);
          if (!allSameTarget) return;

          const mergedPatches: Patch[] = [];
          const mergedInversePatches: Patch[] = [];
          for (let i = fromIndex; i <= state.historyIndex; i++) {
            mergedPatches.push(...state.historyStack[i].patches);
            mergedInversePatches.unshift(...state.historyStack[i].inversePatches);
          }
          const collapsed: HistoryEntry = { patches: mergedPatches, inversePatches: mergedInversePatches, target: baseTarget };
          state.historyStack.splice(fromIndex, state.historyIndex - fromIndex + 1, collapsed);
          state.historyIndex = fromIndex;
        }),

      // ======================================================================
      // Drawing State Actions
      // ======================================================================

      setCurrentStyle: (style) =>
        set((state) => { state.currentStyle = { ...state.currentStyle, ...style }; }),

      setIsDrawing: (isDrawing) =>
        set((state) => { state.isDrawing = isDrawing; }),

      setDrawingPreview: (preview) =>
        set((state) => { state.drawingPreview = preview; }),

      addDrawingPoint: (point) =>
        set((state) => { state.drawingPoints.push(point); state.isDrawing = true; }),

      undoDrawingPoint: () =>
        set((state) => {
          if (state.drawingPoints.length > 0) {
            state.drawingPoints.pop();
            if (state.drawingPoints.length === 0) {
              state.isDrawing = false;
              state.drawingPreview = null;
            }
          }
        }),

      clearDrawingPoints: () =>
        set((state) => {
          state.drawingPoints = [];
          state.isDrawing = false;
          state.drawingPreview = null;
        }),

      closeDrawing: () =>
        set((state) => {
          state.drawingPoints = [];
          state.isDrawing = false;
          state.drawingPreview = null;
        }),

      // ======================================================================
      // Text Editing Actions
      // ======================================================================

      startTextEditing: (shapeId) =>
        set((state) => { state.textEditingId = shapeId; }),

      endTextEditing: () =>
        set((state) => { state.textEditingId = null; }),

      setTextEditingContent: (content) =>
        set((state) => { state.textEditingContent = content; }),

      updateDefaultTextStyle: (style) =>
        set((state) => { state.defaultTextStyle = { ...state.defaultTextStyle, ...style }; }),

      // ======================================================================
      // Title Block Inline Editing Actions
      // ======================================================================

      startTitleBlockFieldEditing: (fieldId) =>
        set((state) => { state.titleBlockEditingFieldId = fieldId; }),

      endTitleBlockFieldEditing: () =>
        set((state) => { state.titleBlockEditingFieldId = null; }),

      setHoveredTitleBlockFieldId: (fieldId) =>
        set((state) => { state.hoveredTitleBlockFieldId = fieldId; }),

      // ======================================================================
      // Boundary Actions
      // ======================================================================

      selectBoundary: () =>
        set((state) => {
          state.boundaryEditState.isSelected = true;
          state.selectedShapeIds = [];
        }),

      deselectBoundary: () =>
        set((state) => {
          state.boundaryEditState.isSelected = false;
          state.boundaryEditState.activeHandle = null;
          state.boundaryEditState.dragStart = null;
          state.boundaryEditState.originalBoundary = null;
        }),

      startBoundaryDrag: (handle, worldPos) =>
        set((state) => {
          const drawing = state.drawings.find((d) => d.id === state.activeDrawingId);
          if (!drawing) return;
          state.boundaryEditState.activeHandle = handle;
          state.boundaryEditState.dragStart = worldPos;
          state.boundaryEditState.originalBoundary = { ...drawing.boundary };
        }),

      updateBoundaryDrag: (worldPos) =>
        set((state) => {
          const { activeHandle, dragStart, originalBoundary } = state.boundaryEditState;
          if (!activeHandle || !dragStart || !originalBoundary) return;
          const drawing = state.drawings.find((d) => d.id === state.activeDrawingId);
          if (!drawing) return;
          const dx = worldPos.x - dragStart.x;
          const dy = worldPos.y - dragStart.y;
          let newBoundary: DrawingBoundary = { ...originalBoundary };
          switch (activeHandle) {
            case 'center': newBoundary.x = originalBoundary.x + dx; newBoundary.y = originalBoundary.y + dy; break;
            case 'top-left':
              newBoundary.x = originalBoundary.x + dx; newBoundary.y = originalBoundary.y + dy;
              newBoundary.width = Math.max(10, originalBoundary.width - dx); newBoundary.height = Math.max(10, originalBoundary.height - dy); break;
            case 'top': newBoundary.y = originalBoundary.y + dy; newBoundary.height = Math.max(10, originalBoundary.height - dy); break;
            case 'top-right':
              newBoundary.y = originalBoundary.y + dy;
              newBoundary.width = Math.max(10, originalBoundary.width + dx); newBoundary.height = Math.max(10, originalBoundary.height - dy); break;
            case 'left': newBoundary.x = originalBoundary.x + dx; newBoundary.width = Math.max(10, originalBoundary.width - dx); break;
            case 'right': newBoundary.width = Math.max(10, originalBoundary.width + dx); break;
            case 'bottom-left':
              newBoundary.x = originalBoundary.x + dx;
              newBoundary.width = Math.max(10, originalBoundary.width - dx); newBoundary.height = Math.max(10, originalBoundary.height + dy); break;
            case 'bottom': newBoundary.height = Math.max(10, originalBoundary.height + dy); break;
            case 'bottom-right':
              newBoundary.width = Math.max(10, originalBoundary.width + dx); newBoundary.height = Math.max(10, originalBoundary.height + dy); break;
          }
          drawing.boundary = newBoundary;
        }),

      endBoundaryDrag: () =>
        set((state) => {
          if (state.boundaryEditState.activeHandle) {
            const drawing = state.drawings.find((d) => d.id === state.activeDrawingId);
            if (drawing) { drawing.modifiedAt = new Date().toISOString(); state.isModified = true; }
          }
          state.boundaryEditState.activeHandle = null;
          state.boundaryEditState.dragStart = null;
          state.boundaryEditState.originalBoundary = null;
        }),

      cancelBoundaryDrag: () =>
        set((state) => {
          const { originalBoundary } = state.boundaryEditState;
          if (originalBoundary) {
            const drawing = state.drawings.find((d) => d.id === state.activeDrawingId);
            if (drawing) drawing.boundary = originalBoundary;
          }
          state.boundaryEditState.activeHandle = null;
          state.boundaryEditState.dragStart = null;
          state.boundaryEditState.originalBoundary = null;
        }),

      toggleBoundaryVisible: () =>
        set((state) => { state.boundaryVisible = !state.boundaryVisible; }),

      // ======================================================================
      // Viewport Edit Actions
      // ======================================================================

      selectViewport: (viewportId) =>
        set((state) => {
          state.viewportEditState.selectedViewportId = viewportId;
          state.viewportEditState.activeHandle = null;
          state.viewportEditState.isDragging = false;
          state.viewportEditState.dragStart = null;
          state.viewportEditState.originalViewport = null;
          state.cropRegionEditState.isEditing = false;
          state.cropRegionEditState.viewportId = null;
        }),

      startViewportDrag: (handle, sheetPos) =>
        set((state) => {
          const { selectedViewportId } = state.viewportEditState;
          if (!selectedViewportId || !state.activeSheetId) return;
          const sheet = state.sheets.find((s) => s.id === state.activeSheetId);
          if (!sheet) return;
          const viewport = sheet.viewports.find((vp) => vp.id === selectedViewportId);
          if (!viewport || viewport.locked) return;
          state.viewportEditState.activeHandle = handle;
          state.viewportEditState.isDragging = true;
          state.viewportEditState.dragStart = sheetPos;
          state.viewportEditState.originalViewport = { ...viewport };
        }),

      updateViewportDrag: (sheetPos) =>
        set((state) => {
          const { selectedViewportId, activeHandle, dragStart, originalViewport, isDragging } = state.viewportEditState;
          if (!isDragging || !selectedViewportId || !activeHandle || !dragStart || !originalViewport || !state.activeSheetId) return;
          const sheet = state.sheets.find((s) => s.id === state.activeSheetId);
          if (!sheet) return;
          const viewport = sheet.viewports.find((vp) => vp.id === selectedViewportId);
          if (!viewport) return;
          const dx = sheetPos.x - dragStart.x;
          const dy = sheetPos.y - dragStart.y;
          if (activeHandle === 'center') {
            viewport.x = originalViewport.x + dx;
            viewport.y = originalViewport.y + dy;
          } else {
            let newX = originalViewport.x, newY = originalViewport.y;
            let newWidth = originalViewport.width, newHeight = originalViewport.height;
            if (activeHandle.includes('left')) { newX = originalViewport.x + dx; newWidth = originalViewport.width - dx; }
            else if (activeHandle.includes('right')) { newWidth = originalViewport.width + dx; }
            if (activeHandle.includes('top')) { newY = originalViewport.y + dy; newHeight = originalViewport.height - dy; }
            else if (activeHandle.includes('bottom')) { newHeight = originalViewport.height + dy; }
            const minSize = 20;
            if (newWidth >= minSize && newHeight >= minSize) {
              viewport.x = newX; viewport.y = newY; viewport.width = newWidth; viewport.height = newHeight;
            }
          }
          sheet.modifiedAt = new Date().toISOString();
        }),

      endViewportDrag: () =>
        set((state) => {
          if (state.viewportEditState.isDragging) state.isModified = true;
          state.viewportEditState.activeHandle = null;
          state.viewportEditState.isDragging = false;
          state.viewportEditState.dragStart = null;
          state.viewportEditState.originalViewport = null;
        }),

      cancelViewportDrag: () =>
        set((state) => {
          const { selectedViewportId, originalViewport } = state.viewportEditState;
          if (selectedViewportId && originalViewport && state.activeSheetId) {
            const sheet = state.sheets.find((s) => s.id === state.activeSheetId);
            if (sheet) {
              const viewport = sheet.viewports.find((vp) => vp.id === selectedViewportId);
              if (viewport) {
                viewport.x = originalViewport.x; viewport.y = originalViewport.y;
                viewport.width = originalViewport.width; viewport.height = originalViewport.height;
              }
            }
          }
          state.viewportEditState.activeHandle = null;
          state.viewportEditState.isDragging = false;
          state.viewportEditState.dragStart = null;
          state.viewportEditState.originalViewport = null;
        }),

      // Keyboard-initiated viewport move (G key)
      startViewportMove: (basePoint) =>
        set((state) => {
          const { selectedViewportId } = state.viewportEditState;
          if (!selectedViewportId || !state.activeSheetId) return;
          const sheet = state.sheets.find((s) => s.id === state.activeSheetId);
          if (!sheet) return;
          const viewport = sheet.viewports.find((vp) => vp.id === selectedViewportId);
          if (!viewport || viewport.locked) return;
          state.viewportEditState.isMoving = true;
          state.viewportEditState.moveBasePoint = basePoint;
          state.viewportEditState.moveSnappedPos = null;
        }),

      updateViewportMove: (sheetPos) =>
        set((state) => {
          const { selectedViewportId, moveBasePoint, isMoving } = state.viewportEditState;
          if (!isMoving || !selectedViewportId || !moveBasePoint || !state.activeSheetId) return;
          const sheet = state.sheets.find((s) => s.id === state.activeSheetId);
          if (!sheet) return;
          const viewport = sheet.viewports.find((vp) => vp.id === selectedViewportId);
          if (!viewport) return;
          const dx = sheetPos.x - moveBasePoint.x;
          const dy = sheetPos.y - moveBasePoint.y;
          // Simple move without snap in document store (snap is in viewportEditSlice)
          state.viewportEditState.moveSnappedPos = { x: viewport.x + dx, y: viewport.y + dy };
        }),

      commitViewportMove: () =>
        set((state) => {
          const { selectedViewportId, moveSnappedPos } = state.viewportEditState;
          if (!selectedViewportId || !moveSnappedPos || !state.activeSheetId) return;
          const sheet = state.sheets.find((s) => s.id === state.activeSheetId);
          if (!sheet) return;
          const viewport = sheet.viewports.find((vp) => vp.id === selectedViewportId);
          if (!viewport || viewport.locked) return;
          viewport.x = moveSnappedPos.x;
          viewport.y = moveSnappedPos.y;
          sheet.modifiedAt = new Date().toISOString();
          state.viewportEditState.isMoving = false;
          state.viewportEditState.moveBasePoint = null;
          state.viewportEditState.moveSnappedPos = null;
          state.isModified = true;
        }),

      cancelViewportMove: () =>
        set((state) => {
          state.viewportEditState.isMoving = false;
          state.viewportEditState.moveBasePoint = null;
          state.viewportEditState.moveSnappedPos = null;
        }),

      // ======================================================================
      // Crop Region Actions
      // ======================================================================

      enableCropRegion: (viewportId) =>
        set((state) => {
          const viewport = getSheetViewport(state, viewportId);
          if (!viewport) return;
          if (!viewport.cropRegion) viewport.cropRegion = createDefaultCropRegion(state, viewport.drawingId);
          else viewport.cropRegion.enabled = true;
          state.isModified = true;
        }),

      disableCropRegion: (viewportId) =>
        set((state) => {
          const viewport = getSheetViewport(state, viewportId);
          if (!viewport || !viewport.cropRegion) return;
          viewport.cropRegion.enabled = false;
          state.isModified = true;
        }),

      toggleCropRegion: (viewportId) =>
        set((state) => {
          const viewport = getSheetViewport(state, viewportId);
          if (!viewport) return;
          if (!viewport.cropRegion) viewport.cropRegion = createDefaultCropRegion(state, viewport.drawingId);
          else viewport.cropRegion.enabled = !viewport.cropRegion.enabled;
          state.isModified = true;
        }),

      startCropRegionEdit: (viewportId) =>
        set((state) => {
          const viewport = getSheetViewport(state, viewportId);
          if (!viewport) return;
          if (!viewport.cropRegion) viewport.cropRegion = createDefaultCropRegion(state, viewport.drawingId);
          state.cropRegionEditState.isEditing = true;
          state.cropRegionEditState.viewportId = viewportId;
          state.viewportEditState.selectedViewportId = viewportId;
        }),

      endCropRegionEdit: () =>
        set((state) => {
          state.cropRegionEditState.isEditing = false;
          state.cropRegionEditState.viewportId = null;
          state.cropRegionEditState.activeHandle = null;
          state.cropRegionEditState.isDragging = false;
          state.cropRegionEditState.dragStart = null;
          state.cropRegionEditState.originalCropRegion = null;
        }),

      startCropRegionDrag: (handle, draftPos) =>
        set((state) => {
          const { viewportId } = state.cropRegionEditState;
          if (!viewportId) return;
          const viewport = getSheetViewport(state, viewportId);
          if (!viewport || !viewport.cropRegion || viewport.locked) return;
          state.cropRegionEditState.activeHandle = handle;
          state.cropRegionEditState.isDragging = true;
          state.cropRegionEditState.dragStart = draftPos;
          state.cropRegionEditState.originalCropRegion = JSON.parse(JSON.stringify(viewport.cropRegion));
        }),

      updateCropRegionDrag: (draftPos) =>
        set((state) => {
          const { viewportId, activeHandle, dragStart, originalCropRegion, isDragging } = state.cropRegionEditState;
          if (!isDragging || !viewportId || !activeHandle || !dragStart || !originalCropRegion) return;
          const viewport = getSheetViewport(state, viewportId);
          if (!viewport || !viewport.cropRegion) return;
          const dx = draftPos.x - dragStart.x;
          const dy = draftPos.y - dragStart.y;
          const [origTopLeft, origBottomRight] = originalCropRegion.points;
          let newTopLeft = { ...origTopLeft };
          let newBottomRight = { ...origBottomRight };
          if (activeHandle.includes('left')) newTopLeft.x = origTopLeft.x + dx;
          else if (activeHandle.includes('right')) newBottomRight.x = origBottomRight.x + dx;
          if (activeHandle.includes('top')) newTopLeft.y = origTopLeft.y + dy;
          else if (activeHandle.includes('bottom')) newBottomRight.y = origBottomRight.y + dy;
          const minSize = 10;
          if (newBottomRight.x - newTopLeft.x >= minSize && newBottomRight.y - newTopLeft.y >= minSize) {
            viewport.cropRegion.points = [newTopLeft, newBottomRight];
          }
        }),

      endCropRegionDrag: () =>
        set((state) => {
          if (state.cropRegionEditState.isDragging) state.isModified = true;
          state.cropRegionEditState.activeHandle = null;
          state.cropRegionEditState.isDragging = false;
          state.cropRegionEditState.dragStart = null;
          state.cropRegionEditState.originalCropRegion = null;
        }),

      cancelCropRegionDrag: () =>
        set((state) => {
          const { viewportId, originalCropRegion } = state.cropRegionEditState;
          if (viewportId && originalCropRegion) {
            const viewport = getSheetViewport(state, viewportId);
            if (viewport && viewport.cropRegion) viewport.cropRegion = originalCropRegion;
          }
          state.cropRegionEditState.activeHandle = null;
          state.cropRegionEditState.isDragging = false;
          state.cropRegionEditState.dragStart = null;
          state.cropRegionEditState.originalCropRegion = null;
        }),

      resetCropRegion: (viewportId) =>
        set((state) => {
          const viewport = getSheetViewport(state, viewportId);
          if (!viewport) return;
          viewport.cropRegion = createDefaultCropRegion(state, viewport.drawingId);
          state.isModified = true;
        }),

      setCropRegion: (viewportId, cropRegion) =>
        set((state) => {
          const viewport = getSheetViewport(state, viewportId);
          if (!viewport) return;
          viewport.cropRegion = cropRegion;
          state.isModified = true;
        }),

      // ======================================================================
      // Layer Override Actions
      // ======================================================================

      startLayerOverrideEdit: (viewportId) =>
        set((state) => { state.layerOverrideEditState.isEditing = true; state.layerOverrideEditState.viewportId = viewportId; }),

      endLayerOverrideEdit: () =>
        set((state) => { state.layerOverrideEditState.isEditing = false; state.layerOverrideEditState.viewportId = null; }),

      setLayerOverride: (viewportId, layerId, override) =>
        set((state) => {
          const viewport = getSheetViewport(state, viewportId);
          if (!viewport) return;
          if (!viewport.layerOverrides) viewport.layerOverrides = [];
          const existingIndex = viewport.layerOverrides.findIndex((o) => o.layerId === layerId);
          if (existingIndex >= 0) viewport.layerOverrides[existingIndex] = { ...viewport.layerOverrides[existingIndex], ...override };
          else viewport.layerOverrides.push({ layerId, ...override });
          state.isModified = true;
        }),

      removeLayerOverride: (viewportId, layerId) =>
        set((state) => {
          const viewport = getSheetViewport(state, viewportId);
          if (!viewport || !viewport.layerOverrides) return;
          viewport.layerOverrides = viewport.layerOverrides.filter((o) => o.layerId !== layerId);
          state.isModified = true;
        }),

      clearLayerOverrides: (viewportId) =>
        set((state) => {
          const viewport = getSheetViewport(state, viewportId);
          if (!viewport) return;
          viewport.layerOverrides = [];
          state.isModified = true;
        }),

      // ======================================================================
      // Annotation Actions
      // ======================================================================

      selectAnnotation: (annotationId, addToSelection = false) =>
        set((state) => {
          if (addToSelection) {
            if (!state.selectedAnnotationIds.includes(annotationId)) state.selectedAnnotationIds.push(annotationId);
          } else {
            state.selectedAnnotationIds = [annotationId];
          }
        }),

      selectAnnotations: (annotationIds) =>
        set((state) => { state.selectedAnnotationIds = annotationIds; }),

      deselectAllAnnotations: () =>
        set((state) => { state.selectedAnnotationIds = []; }),

      addAnnotation: (sheetId, annotation) =>
        set((state) => {
          const sheet = state.sheets.find((s) => s.id === sheetId);
          if (sheet) {
            sheet.annotations.push(annotation);
            sheet.modifiedAt = new Date().toISOString();
            state.isModified = true;
          }
        }),

      updateAnnotation: (sheetId, annotationId, updates) =>
        set((state) => {
          const sheet = state.sheets.find((s) => s.id === sheetId);
          if (sheet) {
            const index = sheet.annotations.findIndex((a) => a.id === annotationId);
            if (index !== -1) {
              sheet.annotations[index] = { ...sheet.annotations[index], ...updates } as SheetAnnotation;
              sheet.modifiedAt = new Date().toISOString();
              state.isModified = true;
            }
          }
        }),

      deleteAnnotation: (sheetId, annotationId) =>
        set((state) => {
          const sheet = state.sheets.find((s) => s.id === sheetId);
          if (sheet) {
            sheet.annotations = sheet.annotations.filter((a) => a.id !== annotationId);
            state.selectedAnnotationIds = state.selectedAnnotationIds.filter((id) => id !== annotationId);
            sheet.modifiedAt = new Date().toISOString();
            state.isModified = true;
          }
        }),

      deleteSelectedAnnotations: (sheetId) =>
        set((state) => {
          const sheet = state.sheets.find((s) => s.id === sheetId);
          if (sheet && state.selectedAnnotationIds.length > 0) {
            sheet.annotations = sheet.annotations.filter((a) => !state.selectedAnnotationIds.includes(a.id));
            sheet.modifiedAt = new Date().toISOString();
            state.selectedAnnotationIds = [];
            state.isModified = true;
          }
        }),

      addTextAnnotation: (sheetId, position, content, options = {}) => {
        const id = generateId();
        const annotation: SheetTextAnnotation = {
          id, type: 'text', position, content,
          fontSize: options.fontSize ?? 3.5, fontFamily: options.fontFamily ?? CAD_DEFAULT_FONT,
          rotation: options.rotation ?? 0, alignment: options.alignment ?? 'left',
          color: options.color ?? '#000000',
          visible: options.visible ?? true, locked: options.locked ?? false,
          bold: options.bold, italic: options.italic,
        };
        set((state) => {
          const sheet = state.sheets.find((s) => s.id === sheetId);
          if (sheet) { sheet.annotations.push(annotation); sheet.modifiedAt = new Date().toISOString(); state.isModified = true; }
        });
        return id;
      },

      addLeaderAnnotation: (sheetId, points, text, options = {}) => {
        const id = generateId();
        const position = points.length > 0 ? points[points.length - 1] : { x: 0, y: 0 };
        const annotation: SheetLeaderAnnotation = {
          id, type: 'leader', position, points, text,
          arrowType: options.arrowType ?? 'filled', textAlignment: options.textAlignment ?? 'left',
          lineColor: options.lineColor ?? '#000000', textColor: options.textColor ?? '#000000',
          fontSize: options.fontSize ?? 3,
          visible: options.visible ?? true, locked: options.locked ?? false,
        };
        set((state) => {
          const sheet = state.sheets.find((s) => s.id === sheetId);
          if (sheet) { sheet.annotations.push(annotation); sheet.modifiedAt = new Date().toISOString(); state.isModified = true; }
        });
        return id;
      },

      addRevisionCloud: (sheetId, points, revisionNumber, options = {}) => {
        const id = generateId();
        const position = points.length > 0
          ? { x: points.reduce((sum, p) => sum + p.x, 0) / points.length, y: points.reduce((sum, p) => sum + p.y, 0) / points.length }
          : { x: 0, y: 0 };
        const annotation: SheetRevisionCloud = {
          id, type: 'revision-cloud', position, points, revisionNumber,
          arcBulge: options.arcBulge ?? 0.3, lineColor: options.lineColor ?? '#ff0000',
          visible: options.visible ?? true, locked: options.locked ?? false,
        };
        set((state) => {
          const sheet = state.sheets.find((s) => s.id === sheetId);
          if (sheet) { sheet.annotations.push(annotation); sheet.modifiedAt = new Date().toISOString(); state.isModified = true; }
        });
        return id;
      },

      startAnnotationDrag: (annotationId, startPoint) =>
        set((state) => {
          const sheet = state.sheets.find((s) => s.id === state.activeSheetId);
          if (!sheet) return;
          const annotation = sheet.annotations.find((a) => a.id === annotationId);
          if (!annotation) return;
          state.annotationEditState = {
            isEditing: true, editingAnnotationId: null,
            isDragging: true, draggingAnnotationId: annotationId,
            activeHandle: null, dragStart: startPoint,
            originalAnnotation: JSON.parse(JSON.stringify(annotation)),
          };
        }),

      updateAnnotationDrag: (sheetId, currentPoint) =>
        set((state) => {
          const { isDragging, draggingAnnotationId, dragStart, originalAnnotation } = state.annotationEditState;
          if (!isDragging || !draggingAnnotationId || !dragStart || !originalAnnotation) return;
          const sheet = state.sheets.find((s) => s.id === sheetId);
          if (!sheet) return;
          const index = sheet.annotations.findIndex((a) => a.id === draggingAnnotationId);
          if (index === -1) return;
          const dx = currentPoint.x - dragStart.x;
          const dy = currentPoint.y - dragStart.y;
          sheet.annotations[index] = {
            ...sheet.annotations[index],
            position: { x: originalAnnotation.position.x + dx, y: originalAnnotation.position.y + dy },
          } as SheetAnnotation;
          if ('points' in originalAnnotation && 'points' in sheet.annotations[index]) {
            const originalPoints = (originalAnnotation as SheetLeaderAnnotation | SheetRevisionCloud).points;
            (sheet.annotations[index] as SheetLeaderAnnotation | SheetRevisionCloud).points = originalPoints.map((p) => ({ x: p.x + dx, y: p.y + dy }));
          }
        }),

      endAnnotationDrag: (sheetId) =>
        set((state) => {
          if (state.annotationEditState.isDragging) {
            const sheet = state.sheets.find((s) => s.id === sheetId);
            if (sheet) { sheet.modifiedAt = new Date().toISOString(); state.isModified = true; }
          }
          state.annotationEditState = { ...initialAnnotationEditState };
        }),

      cancelAnnotationDrag: () =>
        set((state) => {
          const { isDragging, draggingAnnotationId, originalAnnotation } = state.annotationEditState;
          if (isDragging && draggingAnnotationId && originalAnnotation) {
            const sheet = state.sheets.find((s) => s.id === state.activeSheetId);
            if (sheet) {
              const index = sheet.annotations.findIndex((a) => a.id === draggingAnnotationId);
              if (index !== -1) sheet.annotations[index] = originalAnnotation;
            }
          }
          state.annotationEditState = { ...initialAnnotationEditState };
        }),

      startTextEdit: (annotationId) =>
        set((state) => {
          state.annotationEditState = { ...initialAnnotationEditState, isEditing: true, editingAnnotationId: annotationId };
        }),

      endTextEdit: () =>
        set((state) => { state.annotationEditState = { ...initialAnnotationEditState }; }),

      moveAnnotations: (sheetId, annotationIds, delta) =>
        set((state) => {
          const sheet = state.sheets.find((s) => s.id === sheetId);
          if (!sheet) return;
          for (const annotation of sheet.annotations) {
            if (annotationIds.includes(annotation.id)) {
              annotation.position = { x: annotation.position.x + delta.x, y: annotation.position.y + delta.y };
              if ('points' in annotation) {
                (annotation as SheetLeaderAnnotation | SheetRevisionCloud).points =
                  (annotation as SheetLeaderAnnotation | SheetRevisionCloud).points.map((p) => ({ x: p.x + delta.x, y: p.y + delta.y }));
              }
            }
          }
          sheet.modifiedAt = new Date().toISOString();
          state.isModified = true;
        }),

      duplicateAnnotations: (sheetId, annotationIds) => {
        const newIds: string[] = [];
        set((state) => {
          const sheet = state.sheets.find((s) => s.id === sheetId);
          if (!sheet) return;
          for (const id of annotationIds) {
            const original = sheet.annotations.find((a) => a.id === id);
            if (original) {
              const newId = generateId();
              newIds.push(newId);
              const clone = JSON.parse(JSON.stringify(original)) as SheetAnnotation;
              clone.id = newId;
              clone.position = { x: clone.position.x + 10, y: clone.position.y + 10 };
              if ('points' in clone) {
                (clone as SheetLeaderAnnotation | SheetRevisionCloud).points =
                  (clone as SheetLeaderAnnotation | SheetRevisionCloud).points.map((p) => ({ x: p.x + 10, y: p.y + 10 }));
              }
              sheet.annotations.push(clone);
            }
          }
          sheet.modifiedAt = new Date().toISOString();
          state.isModified = true;
        });
        return newIds;
      },

      // ======================================================================
      // Drawing Placement Actions
      // ======================================================================

      startDrawingPlacement: (drawingId) =>
        set((state) => {
          if (state.editorMode !== 'sheet') return;
          if (!state.activeSheetId) return;
          const drawing = state.drawings.find((d) => d.id === drawingId);
          if (!drawing) return;
          state.isPlacing = true;
          state.placingDrawingId = drawingId;
          state.placingQueryId = null;
          state.previewPosition = null;
        }),

      startQueryPlacement: (queryId) =>
        set((state) => {
          if (state.editorMode !== 'sheet') return;
          if (!state.activeSheetId) return;
          state.isPlacing = true;
          state.placingDrawingId = null;
          state.placingQueryId = queryId;
          state.previewPosition = null;
        }),

      updatePlacementPreview: (sheetPosition) =>
        set((state) => { if (!state.isPlacing) return; state.previewPosition = sheetPosition; }),

      confirmPlacement: () =>
        set((state) => {
          if (!state.isPlacing || !state.previewPosition || !state.activeSheetId) return;
          const sheet = state.sheets.find((s) => s.id === state.activeSheetId);
          if (!sheet) return;

          if (state.placingDrawingId) {
            const drawing = state.drawings.find((d) => d.id === state.placingDrawingId);
            if (!drawing) return;
            const { width, height } = calculateViewportSize(drawing, state.placementScale);
            const drawingCenterX = drawing.boundary.x + drawing.boundary.width / 2;
            const drawingCenterY = drawing.boundary.y + drawing.boundary.height / 2;
            const newViewport: SheetViewport = {
              id: generateId(), drawingId: state.placingDrawingId,
              x: state.previewPosition.x - width / 2, y: state.previewPosition.y - height / 2,
              width, height,
              centerX: drawingCenterX, centerY: drawingCenterY,
              scale: state.placementScale, locked: false, visible: true,
            };
            sheet.viewports.push(newViewport);
          }

          if (state.placingQueryId) {
            const numCols = 4;
            const defaultColWidth = 25;
            const headerHeight = 8;
            const rowHeight = 6;
            const numRows = 5;
            const columnWidths = Array(numCols).fill(defaultColWidth);
            const tableWidth = columnWidths.reduce((a: number, b: number) => a + b, 0);
            const tableHeight = headerHeight + numRows * rowHeight;
            if (!sheet.queryTables) sheet.queryTables = [];
            sheet.queryTables.push({
              id: generateId(),
              queryId: state.placingQueryId,
              x: state.previewPosition.x - tableWidth / 2,
              y: state.previewPosition.y - tableHeight / 2,
              width: tableWidth,
              height: tableHeight,
              columnWidths,
              rowHeight,
              headerHeight,
              fontSize: 7,
              headerFontSize: 8,
              locked: false,
              visible: true,
            });
          }

          sheet.modifiedAt = new Date().toISOString();
          state.isPlacing = false;
          state.placingDrawingId = null;
          state.placingQueryId = null;
          state.previewPosition = null;
          state.isModified = true;
        }),

      cancelPlacement: () =>
        set((state) => {
          state.isPlacing = false;
          state.placingDrawingId = null;
          state.placingQueryId = null;
          state.previewPosition = null;
        }),

      setPlacementScale: (scale) =>
        set((state) => { state.placementScale = Math.max(0.001, Math.min(1, scale)); }),

      // ======================================================================
      // Text Style Actions
      // ======================================================================

      setActiveTextStyle: (styleId) =>
        set((state) => { state.activeTextStyleId = styleId; }),

      addTextStyle: (styleData) => {
        const id = generateId();
        set((state) => {
          state.textStyles.push({ ...styleData, id });
          state.isModified = true;
        });
        return id;
      },

      updateTextStyle: (id, updates) =>
        set((state) => {
          const style = state.textStyles.find(s => s.id === id);
          if (style && !style.isBuiltIn) {
            Object.assign(style, updates);
            state.isModified = true;
          }
        }),

      deleteTextStyle: (id) =>
        set((state) => {
          const style = state.textStyles.find(s => s.id === id);
          if (style && !style.isBuiltIn) {
            state.textStyles = state.textStyles.filter(s => s.id !== id);
            // Reset active style if deleted
            if (state.activeTextStyleId === id) {
              state.activeTextStyleId = 'annotation-medium';
            }
            state.isModified = true;
          }
        }),

      duplicateTextStyle: (id) => {
        const style = get().textStyles.find(s => s.id === id);
        if (style) {
          const newId = generateId();
          set((state) => {
            state.textStyles.push({
              ...structuredClone(style),
              id: newId,
              name: `${style.name} (Copy)`,
              isBuiltIn: false,
            });
            state.isModified = true;
          });
          return newId;
        }
        return undefined;
      },

      textStyleManagerOpen: false,

      setTextStyleManagerOpen: (open) =>
        set((state) => { state.textStyleManagerOpen = open; }),

      applyTextStyleToShape: (shapeId, styleId) =>
        set((state) => {
          const shape = state.shapes.find(s => s.id === shapeId);
          const style = state.textStyles.find(s => s.id === styleId);
          if (shape && shape.type === 'text' && style) {
            shape.fontFamily = style.fontFamily;
            shape.fontSize = style.fontSize;
            shape.bold = style.bold;
            shape.italic = style.italic;
            shape.underline = style.underline;
            shape.color = style.color;
            shape.alignment = style.alignment;
            shape.verticalAlignment = style.verticalAlignment;
            shape.lineHeight = style.lineHeight;
            shape.isModelText = style.isModelText;
            shape.backgroundMask = style.backgroundMask;
            shape.backgroundColor = style.backgroundColor;
            shape.backgroundPadding = style.backgroundPadding;
            shape.strikethrough = style.strikethrough ?? false;
            shape.textCase = style.textCase;
            shape.letterSpacing = style.letterSpacing;
            shape.widthFactor = style.widthFactor;
            shape.obliqueAngle = style.obliqueAngle;
            shape.paragraphSpacing = style.paragraphSpacing;
            shape.textStyleId = styleId;
            state.isModified = true;
          }
        }),

      // ======================================================================
      // File Actions
      // ======================================================================

      setFilePath: (path) =>
        set((state) => { state.filePath = path; }),

      setProjectName: (name) =>
        set((state) => { state.projectName = name; }),

      setModified: (modified) =>
        set((state) => { state.isModified = modified; }),

      newProject: () =>
        set((state) => {
          const fresh = createEmptyDocumentState();
          Object.assign(state, fresh);
        }),

      loadProject: (data, filePath, projectName) =>
        set((state) => {
          const dataWithDrawings = data as any;
          const loadedDrawings = dataWithDrawings.drawings || dataWithDrawings.drafts;
          const loadedActiveDrawingId = dataWithDrawings.activeDrawingId || dataWithDrawings.activeDraftId;
          const loadedDrawingViewports = dataWithDrawings.drawingViewports || dataWithDrawings.draftViewports;

          if (loadedDrawings && loadedDrawings.length > 0) {
            state.drawings = loadedDrawings.map((drawing: Drawing) => ({
              ...drawing,
              boundary: drawing.boundary || { ...DEFAULT_DRAWING_BOUNDARY },
              scale: drawing.scale || DEFAULT_DRAWING_SCALE,
            }));
            state.sheets = dataWithDrawings.sheets || [];
            state.activeDrawingId = loadedActiveDrawingId || loadedDrawings[0].id;
            state.activeSheetId = dataWithDrawings.activeSheetId || null;
            state.drawingViewports = loadedDrawingViewports || {};
            state.editorMode = dataWithDrawings.activeSheetId ? 'sheet' : 'drawing';
          } else {
            const newDrawingId = generateId();
            state.drawings = [{
              id: newDrawingId, name: 'Drawing 1',
              boundary: { ...DEFAULT_DRAWING_BOUNDARY },
              scale: DEFAULT_DRAWING_SCALE,
              drawingType: 'standalone',
              createdAt: new Date().toISOString(), modifiedAt: new Date().toISOString(),
            }];
            state.sheets = [];
            state.activeDrawingId = newDrawingId;
            state.activeSheetId = null;
            state.drawingViewports = { [newDrawingId]: data.viewport || { offsetX: 0, offsetY: 0, zoom: 1 } };
            state.editorMode = 'drawing';
            data.shapes.forEach((shape: Shape) => { if (!shape.drawingId) (shape as any).drawingId = newDrawingId; });
            data.layers.forEach((layer: Layer) => { if (!layer.drawingId) (layer as any).drawingId = newDrawingId; });
          }

          state.shapes = data.shapes;
          state.layers = data.layers;
          state.activeLayerId = data.activeLayerId;
          state.selectedShapeIds = [];
          if (data.viewport) state.viewport = data.viewport;
          if (data.settings) {
            // Settings go to global store - use direct state mutation via set
            const appState = useAppStore.getState();
            appState.setGridSize(data.settings.gridSize);
            // Toggle grid/snap to match desired state
            if (appState.gridVisible !== data.settings.gridVisible) appState.toggleGrid();
            if (appState.snapEnabled !== data.settings.snapEnabled) appState.toggleSnap();
          }
          state.historyStack = [];
          state.historyIndex = -1;
          state.filePath = filePath || null;
          state.projectName = projectName || 'Untitled';
          state.isModified = false;
          state.drawingPoints = [];
          state.drawingPreview = null;
        }),
    }))
  );
}

// ============================================================================
// Document Store Registry
// ============================================================================

const documentStores = new Map<string, StoreApi<DocumentStore>>();

export function getDocumentStore(id: string): StoreApi<DocumentStore> {
  const store = documentStores.get(id);
  if (!store) {
    throw new Error(`Document store not found for id: ${id}`);
  }
  return store;
}

export function getDocumentStoreIfExists(id: string): StoreApi<DocumentStore> | undefined {
  return documentStores.get(id);
}

export function createDocumentStore(id: string, initial?: Partial<DocumentState>): StoreApi<DocumentStore> {
  if (documentStores.has(id)) {
    return documentStores.get(id)!;
  }
  const store = createDocumentStoreInstance(initial);
  documentStores.set(id, store);
  return store;
}

export function removeDocumentStore(id: string): void {
  documentStores.delete(id);
}

export function getAllDocumentStoreIds(): string[] {
  return Array.from(documentStores.keys());
}

// ============================================================================
// useDocStore Hook
// ============================================================================

/**
 * Hook that reads from the active document's store.
 * Automatically resolves which document store to use based on activeDocumentId.
 */
export function useDocStore<T>(selector: (s: DocumentStore) => T): T {
  const activeId = useAppStore((s) => s.activeDocumentId);
  const store = getDocumentStore(activeId);
  return useStore(store, selector);
}

/**
 * Hook that returns the active document's store API (for imperative access).
 */
export function useActiveDocumentStore(): StoreApi<DocumentStore> {
  const activeId = useAppStore((s) => s.activeDocumentId);
  return getDocumentStore(activeId);
}

/**
 * Get the active document store imperatively (non-hook).
 */
export function getActiveDocumentStore(): StoreApi<DocumentStore> {
  const activeId = useAppStore.getState().activeDocumentId;
  return getDocumentStore(activeId);
}
