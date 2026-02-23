/**
 * Model Slice - Manages drawings, sheets, shapes, and layers
 * This is the core data model of the application
 */

import type {
  Shape,
  Layer,
  Drawing,
  DrawingType,
  PlanSubtype,
  DrawingBoundary,
  Sheet,
  SheetViewport,
  Viewport,
  EditorMode,
  PaperSize,
  PaperOrientation,
  TextStyle,
} from './types';

import type { BlockDefinition, SheetQueryTable } from '../../types/geometry';

import type {
  TitleBlockTemplate,
  EnhancedTitleBlock,
  SheetTemplate,
} from '../../types/sheet';
import { CAD_DEFAULT_FONT } from '../../constants/cadDefaults';

import {
  generateId,
  DEFAULT_DRAWING_BOUNDARY,
  DEFAULT_DRAWING_SCALE,
  createDefaultTitleBlock,
  getShapeBounds,
  PAPER_SIZES,
  createDefaultTextStyles,
} from './types';

import { produceWithPatches, current } from 'immer';
import type { HistoryEntry } from './historySlice';

import {
  BUILT_IN_TEMPLATES,
  createTitleBlockFromTemplate,
  addRevision as addRevisionToTable,
  getTemplatesForPaperSize,
  calculateAutoFields,
  type AutoFieldContext,
} from '../../services/template/titleBlockService';

import {
  BUILT_IN_SHEET_TEMPLATES,
  createViewportsFromTemplate,
  getNextSheetNumber,
  DEFAULT_NUMBERING_SCHEME,
  type SheetNumberingScheme,
} from '../../services/template/sheetTemplateService';

import {
  loadCustomSVGTemplates,
} from '../../services/export/svgTitleBlockService';

import type { TitleBlock, TitleBlockField } from './types';
import { regenerateGridDimensions } from '../../utils/gridDimensionUtils';
import {
  computeSectionReferences,
  computeSectionBoundary,
  isSectionReferenceShape,
  getSourceIdFromSectionRef,
  buildSectionCoordinateSystem,
  syncGridlineFromSection,
  syncLevelFromSection,
} from '../../services/section/sectionReferenceService';
import type { SectionCalloutShape, GridlineShape, LevelShape } from '../../types/geometry';

// mm to pixels conversion (same as renderer)
const MM_TO_PIXELS = 3.78;

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

// Assumed canvas dimensions for initial viewport calculation
// These are reasonable defaults for most screen sizes
const ASSUMED_CANVAS_WIDTH = 1200;
const ASSUMED_CANVAS_HEIGHT = 800;
const FIT_PADDING = 40; // Padding around the sheet in pixels

/**
 * Calculate initial viewport to fit a sheet to view
 */
function calculateSheetFitViewport(
  paperSize: PaperSize,
  orientation: PaperOrientation
): Viewport {
  const paper = PAPER_SIZES[paperSize] || PAPER_SIZES['A4'];

  // Get paper dimensions in pixels based on orientation
  const paperWidthMM = orientation === 'landscape' ? paper.height : paper.width;
  const paperHeightMM = orientation === 'landscape' ? paper.width : paper.height;
  const paperWidthPx = paperWidthMM * MM_TO_PIXELS;
  const paperHeightPx = paperHeightMM * MM_TO_PIXELS;

  // Calculate zoom to fit paper in canvas with padding
  const availableWidth = ASSUMED_CANVAS_WIDTH - FIT_PADDING * 2;
  const availableHeight = ASSUMED_CANVAS_HEIGHT - FIT_PADDING * 2;
  const zoomX = availableWidth / paperWidthPx;
  const zoomY = availableHeight / paperHeightPx;
  const zoom = Math.min(zoomX, zoomY, 1.0); // Don't zoom in beyond 1.0

  // Calculate offset to center the paper
  const scaledPaperWidth = paperWidthPx * zoom;
  const scaledPaperHeight = paperHeightPx * zoom;
  const offsetX = (ASSUMED_CANVAS_WIDTH - scaledPaperWidth) / 2;
  const offsetY = (ASSUMED_CANVAS_HEIGHT - scaledPaperHeight) / 2;

  return { zoom, offsetX, offsetY };
}

/**
 * Calculate initial viewport to fit a drawing boundary to view.
 * canvasWidth/canvasHeight default to ASSUMED_CANVAS_WIDTH/HEIGHT when not known yet.
 */
function calculateDrawingFitViewport(
  boundary: DrawingBoundary,
  canvasWidth = ASSUMED_CANVAS_WIDTH,
  canvasHeight = ASSUMED_CANVAS_HEIGHT
): Viewport {
  const availableWidth = canvasWidth - FIT_PADDING * 2;
  const availableHeight = canvasHeight - FIT_PADDING * 2;
  const zoomX = availableWidth / boundary.width;
  const zoomY = availableHeight / boundary.height;
  const zoom = Math.min(zoomX, zoomY);

  const centerX = boundary.x + boundary.width / 2;
  const centerY = boundary.y + boundary.height / 2;
  const offsetX = canvasWidth / 2 - centerX * zoom;
  const offsetY = canvasHeight / 2 - centerY * zoom;

  return { zoom, offsetX, offsetY };
}

// ============================================================================
// State Interface
// ============================================================================

export interface ModelState {
  // Drawings
  drawings: Drawing[];
  activeDrawingId: string;

  // Sheets
  sheets: Sheet[];
  activeSheetId: string | null;
  editorMode: EditorMode;

  // Per-drawing viewport state (stores zoom/pan for each drawing)
  drawingViewports: Record<string, Viewport>;

  // Per-sheet viewport state (stores zoom/pan for each sheet)
  sheetViewports: Record<string, Viewport>;

  // Shapes
  shapes: Shape[];

  // Groups
  groups: import('../../types/geometry').ShapeGroup[];

  // Block Definitions (for DXF blocks / block instances)
  blockDefinitions: BlockDefinition[];

  // Layers
  layers: Layer[];
  activeLayerId: string;

  // Title Block Templates (user-created, built-in are in service)
  customTitleBlockTemplates: TitleBlockTemplate[];

  // Sheet Templates (user-created, built-in are in service)
  customSheetTemplates: SheetTemplate[];

  // Text Styles (reusable text formatting presets)
  textStyles: TextStyle[];
  activeTextStyleId: string | null;
  textStyleManagerOpen: boolean;
}

// ============================================================================
// Actions Interface
// ============================================================================

export interface ModelActions {
  // Shape actions
  addShape: (shape: Shape) => void;
  addShapes: (shapes: Shape[]) => void;
  updateShape: (id: string, updates: Partial<Shape>) => void;
  updateShapes: (updates: { id: string; updates: Partial<Shape> }[]) => void;
  deleteShape: (id: string) => void;
  deleteShapes: (ids: string[]) => void;
  deleteSelectedShapes: () => void;

  // Visibility actions
  hideSelectedShapes: () => void;
  showAllShapes: () => void;
  isolateSelectedShapes: () => void;

  // Locking actions
  lockSelectedShapes: () => void;
  unlockSelectedShapes: () => void;
  unlockAllShapes: () => void;

  // Z-order actions
  bringToFront: () => void;
  bringForward: () => void;
  sendBackward: () => void;
  sendToBack: () => void;

  // Block Definition actions
  addBlockDefinitions: (defs: BlockDefinition[]) => void;

  // Group actions
  groupSelectedShapes: () => void;
  ungroupSelectedShapes: () => void;

  // Drawing actions
  addDrawing: (name?: string, drawingType?: DrawingType) => void;
  addDrawingSilent: (name?: string, drawingType?: DrawingType) => string;
  updateDrawingType: (id: string, drawingType: DrawingType) => void;
  updateDrawingPlanSubtype: (id: string, planSubtype: PlanSubtype | undefined) => void;
  updateDrawingStorey: (id: string, storeyId: string | undefined) => void;
  deleteDrawing: (id: string) => void;
  renameDrawing: (id: string, name: string) => void;
  updateDrawingBoundary: (id: string, boundary: Partial<DrawingBoundary>) => void;
  updateDrawingScale: (id: string, scale: number) => void;
  fitBoundaryToContent: (id: string, padding?: number) => void;
  switchToDrawing: (id: string) => void;

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
  setViewportScale: (viewportId: string, scale: number) => void;
  deleteSheetViewport: (sheetId: string, viewportId: string) => void;
  centerViewportOnDrawing: (viewportId: string) => void;
  fitViewportToDrawing: (viewportId: string) => void;

  // Sheet Query Table actions
  addSheetQueryTable: (sheetId: string, table: SheetQueryTable) => void;
  updateSheetQueryTable: (sheetId: string, tableId: string, updates: Partial<SheetQueryTable>) => void;
  deleteSheetQueryTable: (sheetId: string, tableId: string) => void;

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

  // Section reference sync
  syncSectionReferences: (sectionDrawingId: string) => void;
  syncAllSectionReferences: () => void;
  /** Reverse sync: propagate section reference shape changes back to plan/storeys */
  syncSectionReferenceToSource: (sectionRefShapeId: string) => void;
  /** Update a section drawing's boundary based on its linked section callout line length and storey range */
  updateSectionDrawingBoundary: (sectionDrawingId: string) => void;

  // Text Style actions
  setActiveTextStyle: (id: string | null) => void;
  addTextStyle: (style: TextStyle) => void;
  updateTextStyle: (id: string, updates: Partial<TextStyle>) => void;
  deleteTextStyle: (id: string) => void;
  duplicateTextStyle: (id: string) => string | undefined;
  applyTextStyleToShape: (shapeId: string, styleId: string) => void;
  setTextStyleManagerOpen: (open: boolean) => void;
}

export type ModelSlice = ModelState & ModelActions;

// ============================================================================
// Initial State
// ============================================================================

const defaultDrawingId = 'drawing-1';

const defaultDrawing: Drawing = {
  id: defaultDrawingId,
  name: 'Drawing 1',
  boundary: { ...DEFAULT_DRAWING_BOUNDARY },
  scale: DEFAULT_DRAWING_SCALE,
  drawingType: 'standalone',
  createdAt: new Date().toISOString(),
  modifiedAt: new Date().toISOString(),
};

const defaultLayer: Layer = {
  id: 'layer-0',
  name: 'Layer 0',
  drawingId: defaultDrawingId,
  visible: true,
  locked: false,
  color: '#ffffff',
  lineStyle: 'solid',
  lineWidth: 1,
};

// Default A3 landscape sheets
const defaultSheet1: Sheet = {
  id: 'sheet-1',
  name: 'Sheet 1',
  paperSize: 'A3',
  orientation: 'landscape',
  viewports: [],
  queryTables: [],
  titleBlock: createDefaultTitleBlock(),
  annotations: [],
  createdAt: new Date().toISOString(),
  modifiedAt: new Date().toISOString(),
};

const defaultSheet2: Sheet = {
  id: 'sheet-2',
  name: 'Sheet 2',
  paperSize: 'A3',
  orientation: 'portrait',
  viewports: [],
  queryTables: [],
  titleBlock: createDefaultTitleBlock(),
  annotations: [],
  createdAt: new Date().toISOString(),
  modifiedAt: new Date().toISOString(),
};

const defaultSheetViewport1 = calculateSheetFitViewport('A3', 'landscape');
const defaultSheetViewport2 = calculateSheetFitViewport('A3', 'portrait');

export const initialModelState: ModelState = {
  drawings: [defaultDrawing],
  activeDrawingId: defaultDrawingId,
  sheets: [defaultSheet1, defaultSheet2],
  activeSheetId: null,
  editorMode: 'drawing',
  drawingViewports: { [defaultDrawingId]: calculateDrawingFitViewport(DEFAULT_DRAWING_BOUNDARY) },
  sheetViewports: {
    'sheet-1': defaultSheetViewport1,
    'sheet-2': defaultSheetViewport2,
  },
  shapes: [],
  groups: [],
  blockDefinitions: [],
  layers: [defaultLayer],
  activeLayerId: defaultLayer.id,
  customTitleBlockTemplates: [],
  customSheetTemplates: [],
  textStyles: createDefaultTextStyles(),
  activeTextStyleId: null,
  textStyleManagerOpen: false,
};

// ============================================================================
// Slice Creator
// ============================================================================

// Type for the full store that this slice needs access to
interface StoreWithHistory {
  historyStack: HistoryEntry[];
  historyIndex: number;
  maxHistorySize: number;
  isModified: boolean;
  selectedShapeIds: string[];
  viewport: Viewport;
  viewportEditState: { selectedViewportId: string | null };
  canvasSize: { width: number; height: number };
}

// Extended FullStore to include parametric shapes and project structure for cross-slice operations
type FullStore = ModelState & StoreWithHistory & {
  parametricShapes: import('../../types/parametric').ParametricShape[];
  deleteParametricShapes: (ids: string[]) => void;
  autoGridDimension: boolean;
  projectStructure: import('./parametricSlice').ProjectStructure;
  sectionGridlineDimensioning: boolean;
};

function withHistory(state: FullStore, mutate: (draft: Shape[]) => void): void {
  const [nextShapes, patches, inversePatches] = produceWithPatches(
    current(state.shapes),
    mutate
  );
  if (patches.length === 0) return; // No changes

  // Truncate future entries if we're not at the end.
  // When historyIndex is -1 (all undone), clear the entire stack.
  // When historyIndex < stack.length - 1, we're in the middle — discard entries after current.
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

/**
 * Clone all project gridlines from existing plan drawings into a new plan drawing.
 * Each cloned gridline gets a new unique ID but keeps the same projectGridId so
 * that edits propagate across all plan drawings sharing the same grid axis.
 * Gridlines that don't have a projectGridId yet get one assigned retroactively.
 */
function cloneProjectGridlines(
  state: { shapes: Shape[]; drawings: Drawing[] },
  newDrawingId: string,
  newLayerId: string,
): Shape[] {
  // Find the first existing plan drawing that has gridlines
  const planDrawingIds = state.drawings
    .filter(d => d.drawingType === 'plan')
    .map(d => d.id);

  // Collect unique gridlines by projectGridId (prefer the first occurrence)
  const seenProjectGridIds = new Set<string>();
  const sourceGridlines: GridlineShape[] = [];

  for (const drawingId of planDrawingIds) {
    const gridlines = (state.shapes as Shape[]).filter(
      (s): s is GridlineShape => s.type === 'gridline' && s.drawingId === drawingId
        && !s.id.startsWith('section-ref-')
    );
    for (const gl of gridlines) {
      // Assign a projectGridId if missing (retroactive migration)
      if (!gl.projectGridId) {
        gl.projectGridId = gl.id; // Use own id as the canonical project grid id
      }
      if (!seenProjectGridIds.has(gl.projectGridId)) {
        seenProjectGridIds.add(gl.projectGridId);
        sourceGridlines.push(gl);
      }
    }
  }

  // Clone each unique gridline into the new drawing
  return sourceGridlines.map(gl => ({
    ...gl,
    id: generateId(),
    drawingId: newDrawingId,
    layerId: newLayerId,
    // projectGridId stays the same — links them together
  }));
}

export const createModelSlice = (
  set: (fn: (state: FullStore) => void) => void,
  get: () => FullStore
): ModelActions => ({
  // ============================================================================
  // Shape Actions
  // ============================================================================

  addShape: (shape) =>
    set((state) => {
      withHistory(state, (draft) => {
        // Auto-assign projectGridId and clone to other plan drawings
        if (shape.type === 'gridline') {
          const gl = shape as GridlineShape;
          const drawing = state.drawings.find(d => d.id === gl.drawingId);
          if (drawing?.drawingType === 'plan') {
            // Assign projectGridId if missing
            if (!gl.projectGridId) {
              gl.projectGridId = gl.id;
            }
            // Clone to all other plan drawings
            const otherPlanDrawings = state.drawings.filter(
              d => d.drawingType === 'plan' && d.id !== gl.drawingId
            );
            for (const otherDrawing of otherPlanDrawings) {
              const otherLayer = state.layers.find(l => l.drawingId === otherDrawing.id);
              if (otherLayer) {
                draft.push({
                  ...gl,
                  id: generateId(),
                  drawingId: otherDrawing.id,
                  layerId: otherLayer.id,
                } as unknown as Shape);
              }
            }
          }
        }
        draft.push(shape);
      });
    }),

  addShapes: (shapes) =>
    set((state) => {
      if (shapes.length === 0) return;
      withHistory(state, (draft) => {
        for (const shape of shapes) {
          // Auto-assign projectGridId and clone gridlines to other plan drawings
          if (shape.type === 'gridline') {
            const gl = shape as GridlineShape;
            const drawing = state.drawings.find(d => d.id === gl.drawingId);
            if (drawing?.drawingType === 'plan') {
              if (!gl.projectGridId) {
                gl.projectGridId = gl.id;
              }
              const otherPlanDrawings = state.drawings.filter(
                d => d.drawingType === 'plan' && d.id !== gl.drawingId
              );
              for (const otherDrawing of otherPlanDrawings) {
                const otherLayer = state.layers.find(l => l.drawingId === otherDrawing.id);
                if (otherLayer) {
                  draft.push({
                    ...gl,
                    id: generateId(),
                    drawingId: otherDrawing.id,
                    layerId: otherLayer.id,
                  } as unknown as Shape);
                }
              }
            }
          }
          draft.push(shape);
        }
      });
    }),

  addBlockDefinitions: (defs) =>
    set((state) => {
      if (defs.length === 0) return;
      for (const def of defs) {
        // Avoid duplicates by ID
        if (!state.blockDefinitions.some(d => d.id === def.id)) {
          state.blockDefinitions.push(def);
        }
      }
      state.isModified = true;
    }),

  updateShape: (id, updates) =>
    set((state) => {
      withHistory(state, (draft) => {
        const index = draft.findIndex((s) => s.id === id);
        if (index !== -1) {
          draft[index] = { ...draft[index], ...updates } as Shape;

          // Propagate gridline edits to linked gridlines in other plan drawings
          const shape = draft[index];
          if (shape.type === 'gridline' && (shape as GridlineShape).projectGridId) {
            const pgId = (shape as GridlineShape).projectGridId!;
            // Build a propagation payload (exclude per-shape/per-drawing fields)
            const { id: _id, drawingId: _did, layerId: _lid, ...propagated } = updates as any;
            if (Object.keys(propagated).length > 0) {
              for (const other of draft) {
                if (other.id !== id && other.type === 'gridline' &&
                    (other as GridlineShape).projectGridId === pgId) {
                  Object.assign(other, propagated);
                }
              }
            }
          }
        }
      });
    }),

  updateShapes: (updates) =>
    set((state) => {
      if (updates.length === 0) return;
      withHistory(state, (draft) => {
        // Collect gridline propagation to apply after primary updates
        const gridlinePropagations: { projectGridId: string; sourceId: string; propagated: Record<string, any> }[] = [];

        for (const { id, updates: u } of updates) {
          const index = draft.findIndex((s) => s.id === id);
          if (index !== -1) {
            draft[index] = { ...draft[index], ...u } as Shape;

            // Check if this is a gridline with projectGridId
            const shape = draft[index];
            if (shape.type === 'gridline' && (shape as GridlineShape).projectGridId) {
              const { id: _id, drawingId: _did, layerId: _lid, ...propagated } = u as any;
              if (Object.keys(propagated).length > 0) {
                gridlinePropagations.push({
                  projectGridId: (shape as GridlineShape).projectGridId!,
                  sourceId: id,
                  propagated,
                });
              }
            }
          }
        }

        // Apply gridline propagations
        for (const { projectGridId, sourceId, propagated } of gridlinePropagations) {
          for (const other of draft) {
            if (other.id !== sourceId && other.type === 'gridline' &&
                (other as GridlineShape).projectGridId === projectGridId) {
              // Skip if this shape is already being explicitly updated
              if (updates.some(u => u.id === other.id)) continue;
              Object.assign(other, propagated);
            }
          }
        }
      });
    }),

  deleteShape: (id) =>
    set((state) => {
      // Also delete any linked labels (text shapes whose linkedShapeId matches)
      const linkedLabelIds = new Set<string>();
      for (const s of state.shapes) {
        if (s.type === 'text' && (s as any).linkedShapeId === id) {
          linkedLabelIds.add(s.id);
        }
      }

      // If deleting a gridline with projectGridId, also delete all siblings in other drawings
      const projectGridSiblingIds = new Set<string>();
      const deletedGridline = state.shapes.find(s => s.id === id);
      if (deletedGridline && deletedGridline.type === 'gridline') {
        const pgId = (deletedGridline as GridlineShape).projectGridId;
        if (pgId) {
          for (const s of state.shapes) {
            if (s.id !== id && s.type === 'gridline' &&
                (s as GridlineShape).projectGridId === pgId) {
              projectGridSiblingIds.add(s.id);
            }
          }
        }
      }

      // If deleting a plate system, also delete all its child beams
      const plateSystemChildIds = new Set<string>();
      const deletedShape = state.shapes.find(s => s.id === id);
      if (deletedShape && deletedShape.type === 'plate-system') {
        const ps = deletedShape as import('../../types/geometry').PlateSystemShape;
        if (ps.childShapeIds) {
          for (const childId of ps.childShapeIds) {
            plateSystemChildIds.add(childId);
          }
        }
      }

      // If deleting a child beam of a plate system, update parent's childShapeIds
      if (deletedShape && deletedShape.type === 'beam') {
        const beam = deletedShape as import('../../types/geometry').BeamShape;
        if (beam.plateSystemId) {
          const parentIdx = state.shapes.findIndex(s => s.id === beam.plateSystemId);
          if (parentIdx !== -1) {
            const parent = state.shapes[parentIdx] as import('../../types/geometry').PlateSystemShape;
            if (parent.childShapeIds) {
              (state.shapes[parentIdx] as import('../../types/geometry').PlateSystemShape).childShapeIds =
                parent.childShapeIds.filter(cid => cid !== id);
            }
          }
        }
      }

      withHistory(state, (draft) => {
        for (let i = draft.length - 1; i >= 0; i--) {
          if (draft[i].id === id || linkedLabelIds.has(draft[i].id) ||
              plateSystemChildIds.has(draft[i].id) || projectGridSiblingIds.has(draft[i].id)) {
            draft.splice(i, 1);
          }
        }
      });
      const allRemoved = new Set([id, ...linkedLabelIds, ...plateSystemChildIds, ...projectGridSiblingIds]);
      state.selectedShapeIds = state.selectedShapeIds.filter(
        (sid) => !allRemoved.has(sid)
      );
    }),

  deleteShapes: (ids) =>
    set((state) => {
      if (ids.length === 0) return;
      const idSet = new Set(ids);
      // Also delete any linked labels whose linkedShapeId is in the deletion set
      for (const s of state.shapes) {
        if (s.type === 'text' && (s as any).linkedShapeId && idSet.has((s as any).linkedShapeId)) {
          idSet.add(s.id);
        }
      }

      // If deleting gridlines with projectGridId, also delete their siblings in other drawings
      for (const s of state.shapes) {
        if (s.type === 'gridline' && idSet.has(s.id)) {
          const pgId = (s as GridlineShape).projectGridId;
          if (pgId) {
            for (const other of state.shapes) {
              if (other.type === 'gridline' && !idSet.has(other.id) &&
                  (other as GridlineShape).projectGridId === pgId) {
                idSet.add(other.id);
              }
            }
          }
        }
      }

      // If deleting plate systems, also delete their child beams
      for (const s of state.shapes) {
        if (s.type === 'plate-system' && idSet.has(s.id)) {
          const ps = s as import('../../types/geometry').PlateSystemShape;
          if (ps.childShapeIds) {
            for (const childId of ps.childShapeIds) {
              idSet.add(childId);
            }
          }
        }
      }

      // If deleting child beams, update their parent plate system's childShapeIds
      for (const s of state.shapes) {
        if (s.type === 'beam' && idSet.has(s.id)) {
          const beam = s as import('../../types/geometry').BeamShape;
          if (beam.plateSystemId && !idSet.has(beam.plateSystemId)) {
            const parentIdx = state.shapes.findIndex(ps => ps.id === beam.plateSystemId);
            if (parentIdx !== -1) {
              const parent = state.shapes[parentIdx] as import('../../types/geometry').PlateSystemShape;
              if (parent.childShapeIds) {
                (state.shapes[parentIdx] as import('../../types/geometry').PlateSystemShape).childShapeIds =
                  parent.childShapeIds.filter(cid => !idSet.has(cid));
              }
            }
          }
        }
      }

      withHistory(state, (draft) => {
        for (let i = draft.length - 1; i >= 0; i--) {
          if (idSet.has(draft[i].id)) draft.splice(i, 1);
        }
      });
      state.selectedShapeIds = state.selectedShapeIds.filter((sid) => !idSet.has(sid));
    }),

  deleteSelectedShapes: () => {
    const store = get();
    if (store.selectedShapeIds.length === 0) return;

    const selectedIds = [...store.selectedShapeIds];

    // Delete regular shapes (with plate system and project gridline cascade)
    set((state) => {
      const selected = new Set(selectedIds);

      // If deleting gridlines with projectGridId, also delete their siblings in other drawings
      for (const s of state.shapes) {
        if (s.type === 'gridline' && selected.has(s.id)) {
          const pgId = (s as GridlineShape).projectGridId;
          if (pgId) {
            for (const other of state.shapes) {
              if (other.type === 'gridline' && !selected.has(other.id) &&
                  (other as GridlineShape).projectGridId === pgId) {
                selected.add(other.id);
              }
            }
          }
        }
      }

      // If deleting plate systems, also delete their child beams
      for (const s of state.shapes) {
        if (s.type === 'plate-system' && selected.has(s.id)) {
          const ps = s as import('../../types/geometry').PlateSystemShape;
          if (ps.childShapeIds) {
            for (const childId of ps.childShapeIds) {
              selected.add(childId);
            }
          }
        }
      }

      // If deleting child beams, update their parent plate system's childShapeIds
      for (const s of state.shapes) {
        if (s.type === 'beam' && selected.has(s.id)) {
          const beam = s as import('../../types/geometry').BeamShape;
          if (beam.plateSystemId && !selected.has(beam.plateSystemId)) {
            const parentIdx = state.shapes.findIndex(ps => ps.id === beam.plateSystemId);
            if (parentIdx !== -1) {
              const parent = state.shapes[parentIdx] as import('../../types/geometry').PlateSystemShape;
              if (parent.childShapeIds) {
                (state.shapes[parentIdx] as import('../../types/geometry').PlateSystemShape).childShapeIds =
                  parent.childShapeIds.filter(cid => !selected.has(cid));
              }
            }
          }
        }
      }

      withHistory(state, (draft) => {
        for (let i = draft.length - 1; i >= 0; i--) {
          if (selected.has(draft[i].id)) draft.splice(i, 1);
        }
      });
      state.selectedShapeIds = [];
    });

    // Delete parametric shapes using the parametric slice's action
    const parametricIds = store.parametricShapes
      .filter(s => selectedIds.includes(s.id))
      .map(s => s.id);
    if (parametricIds.length > 0) {
      store.deleteParametricShapes(parametricIds);
    }

    // Auto-regenerate grid dimensions if any gridline was deleted
    const hadGridline = store.shapes.some(
      s => selectedIds.includes(s.id) && s.type === 'gridline'
    );
    if (hadGridline && store.autoGridDimension) {
      setTimeout(() => regenerateGridDimensions(), 50);
    }
  },

  // ============================================================================
  // Visibility Actions
  // ============================================================================

  hideSelectedShapes: () => {
    const store = get();
    if (store.selectedShapeIds.length === 0) return;

    set((state) => {
      const selectedIds = new Set(store.selectedShapeIds);
      withHistory(state, (draft) => {
        for (const shape of draft) {
          if (selectedIds.has(shape.id)) {
            shape.visible = false;
          }
        }
      });
      // Deselect hidden shapes
      state.selectedShapeIds = [];
    });
  },

  showAllShapes: () =>
    set((state) => {
      withHistory(state, (draft) => {
        for (const shape of draft) {
          if (shape.drawingId === state.activeDrawingId) {
            shape.visible = true;
          }
        }
      });
    }),

  isolateSelectedShapes: () => {
    const store = get();
    if (store.selectedShapeIds.length === 0) return;

    set((state) => {
      const selectedIds = new Set(store.selectedShapeIds);
      withHistory(state, (draft) => {
        for (const shape of draft) {
          if (shape.drawingId === state.activeDrawingId) {
            // Show selected, hide others
            shape.visible = selectedIds.has(shape.id);
          }
        }
      });
    });
  },

  // ============================================================================
  // Locking Actions
  // ============================================================================

  lockSelectedShapes: () => {
    const store = get();
    if (store.selectedShapeIds.length === 0) return;

    set((state) => {
      const selectedIds = new Set(store.selectedShapeIds);
      withHistory(state, (draft) => {
        for (const shape of draft) {
          if (selectedIds.has(shape.id)) {
            shape.locked = true;
          }
        }
      });
      // Deselect locked shapes
      state.selectedShapeIds = [];
    });
  },

  unlockSelectedShapes: () => {
    const store = get();
    if (store.selectedShapeIds.length === 0) return;

    set((state) => {
      const selectedIds = new Set(store.selectedShapeIds);
      withHistory(state, (draft) => {
        for (const shape of draft) {
          if (selectedIds.has(shape.id)) {
            shape.locked = false;
          }
        }
      });
    });
  },

  unlockAllShapes: () =>
    set((state) => {
      withHistory(state, (draft) => {
        for (const shape of draft) {
          if (shape.drawingId === state.activeDrawingId) {
            shape.locked = false;
          }
        }
      });
    }),

  // ============================================================================
  // Z-Order Actions
  // ============================================================================

  bringToFront: () => {
    const store = get();
    if (store.selectedShapeIds.length === 0) return;

    set((state) => {
      const selectedIds = new Set(store.selectedShapeIds);
      withHistory(state, (draft) => {
        // Extract selected shapes
        const selectedShapes: Shape[] = [];
        for (let i = draft.length - 1; i >= 0; i--) {
          if (selectedIds.has(draft[i].id)) {
            selectedShapes.unshift(draft.splice(i, 1)[0]);
          }
        }
        // Add them at the end (front)
        for (const shape of selectedShapes) {
          draft.push(shape);
        }
      });
      state.isModified = true;
    });
  },

  bringForward: () => {
    const store = get();
    if (store.selectedShapeIds.length === 0) return;

    set((state) => {
      const selectedIds = new Set(store.selectedShapeIds);
      withHistory(state, (draft) => {
        // Move selected shapes one position toward the end (forward)
        // Iterate from end to avoid double-moving
        for (let i = draft.length - 2; i >= 0; i--) {
          if (selectedIds.has(draft[i].id) && !selectedIds.has(draft[i + 1].id)) {
            const temp = draft[i];
            draft[i] = draft[i + 1];
            draft[i + 1] = temp;
          }
        }
      });
      state.isModified = true;
    });
  },

  sendBackward: () => {
    const store = get();
    if (store.selectedShapeIds.length === 0) return;

    set((state) => {
      const selectedIds = new Set(store.selectedShapeIds);
      withHistory(state, (draft) => {
        // Move selected shapes one position toward the beginning (backward)
        // Iterate from start to avoid double-moving
        for (let i = 1; i < draft.length; i++) {
          if (selectedIds.has(draft[i].id) && !selectedIds.has(draft[i - 1].id)) {
            const temp = draft[i];
            draft[i] = draft[i - 1];
            draft[i - 1] = temp;
          }
        }
      });
      state.isModified = true;
    });
  },

  sendToBack: () => {
    const store = get();
    if (store.selectedShapeIds.length === 0) return;

    set((state) => {
      const selectedIds = new Set(store.selectedShapeIds);
      withHistory(state, (draft) => {
        // Extract selected shapes
        const selectedShapes: Shape[] = [];
        for (let i = draft.length - 1; i >= 0; i--) {
          if (selectedIds.has(draft[i].id)) {
            selectedShapes.unshift(draft.splice(i, 1)[0]);
          }
        }
        // Add them at the beginning (back)
        for (let i = selectedShapes.length - 1; i >= 0; i--) {
          draft.unshift(selectedShapes[i]);
        }
      });
      state.isModified = true;
    });
  },

  // ============================================================================
  // Group Actions
  // ============================================================================

  groupSelectedShapes: () => {
    const store = get();
    if (store.selectedShapeIds.length < 2) return; // Need at least 2 shapes to group

    const groupId = generateId();

    set((state) => {
      const selectedIds = new Set(store.selectedShapeIds);

      // Create the group
      state.groups.push({
        id: groupId,
        drawingId: state.activeDrawingId,
      });

      // Assign shapes to the group
      withHistory(state, (draft) => {
        for (const shape of draft) {
          if (selectedIds.has(shape.id)) {
            shape.groupId = groupId;
          }
        }
      });
      state.isModified = true;
    });
  },

  ungroupSelectedShapes: () => {
    const store = get();
    if (store.selectedShapeIds.length === 0) return;

    set((state) => {
      // Find all unique group IDs from selected shapes
      const selectedIdSet = new Set(store.selectedShapeIds);
      const selectedShapes = state.shapes.filter(s => selectedIdSet.has(s.id));
      const groupIdsToRemove = new Set<string>();

      for (const shape of selectedShapes) {
        if (shape.groupId) {
          groupIdsToRemove.add(shape.groupId);
        }
      }

      if (groupIdsToRemove.size === 0) return;

      // Remove groupId from all shapes in these groups
      withHistory(state, (draft) => {
        for (const shape of draft) {
          if (shape.groupId && groupIdsToRemove.has(shape.groupId)) {
            delete shape.groupId;
          }
        }
      });

      // Remove the groups
      state.groups = state.groups.filter(g => !groupIdsToRemove.has(g.id));
      state.isModified = true;
    });
  },

  // ============================================================================
  // Drawing Actions
  // ============================================================================

  addDrawing: (name, drawingType = 'standalone') =>
    set((state) => {
      const id = generateId();
      // For plan drawings, auto-assign the first available storey
      let autoStoreyId: string | undefined;
      if (drawingType === 'plan' && state.projectStructure?.buildings) {
        for (const building of state.projectStructure.buildings) {
          if (building.storeys.length > 0) {
            autoStoreyId = building.storeys[0].id;
            break;
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

      // Create a default layer for the new drawing
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

      // Initialize viewport zoomed to fit the boundary
      state.drawingViewports[id] = calculateDrawingFitViewport(
        newDrawing.boundary,
        state.canvasSize.width || ASSUMED_CANVAS_WIDTH,
        state.canvasSize.height || ASSUMED_CANVAS_HEIGHT
      );

      // For plan drawings: clone all project gridlines from existing plan drawings
      if (drawingType === 'plan') {
        const clonedGridlines = cloneProjectGridlines(state, id, newLayer.id);
        for (const gl of clonedGridlines) {
          (state.shapes as Shape[]).push(gl);
        }
      }

      // Switch to the new drawing
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
      if (drawingType === 'plan' && state.projectStructure?.buildings) {
        for (const building of state.projectStructure.buildings) {
          if (building.storeys.length > 0) {
            autoStoreyId = building.storeys[0].id;
            break;
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

      // Create a default layer for the new drawing
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

      // Initialize viewport zoomed to fit the boundary
      state.drawingViewports[id] = calculateDrawingFitViewport(
        newDrawing.boundary,
        state.canvasSize.width || ASSUMED_CANVAS_WIDTH,
        state.canvasSize.height || ASSUMED_CANVAS_HEIGHT
      );

      // For plan drawings: clone all project gridlines from existing plan drawings
      if (drawingType === 'plan') {
        const clonedGridlines = cloneProjectGridlines(state, id, newLayer.id);
        for (const gl of clonedGridlines) {
          (state.shapes as Shape[]).push(gl);
        }
      }

      state.isModified = true;
    });
    return id;
  },

  deleteDrawing: (id) =>
    set((state) => {
      // Can't delete the last drawing
      if (state.drawings.length <= 1) return;

      // Remove the drawing
      state.drawings = state.drawings.filter((d) => d.id !== id);

      // Remove all shapes belonging to this drawing (with history)
      const hasShapesInDrawing = state.shapes.some((s) => s.drawingId === id);
      if (hasShapesInDrawing) {
        withHistory(state, (draft) => {
          for (let i = draft.length - 1; i >= 0; i--) {
            if (draft[i].drawingId === id) {
              draft.splice(i, 1);
            }
          }
        });
      }

      // Remove all layers belonging to this drawing
      state.layers = state.layers.filter((l) => l.drawingId !== id);

      // Remove viewport for this drawing
      delete state.drawingViewports[id];

      // Remove viewports in sheets that reference this drawing
      state.sheets.forEach((sheet) => {
        sheet.viewports = sheet.viewports.filter((vp) => vp.drawingId !== id);
      });

      // If the deleted drawing was active, switch to another drawing
      if (state.activeDrawingId === id) {
        const firstDrawing = state.drawings[0];
        state.activeDrawingId = firstDrawing.id;
        state.viewport = state.drawingViewports[firstDrawing.id] || { offsetX: 0, offsetY: 0, zoom: 1 };

        // Set active layer to a layer in the new drawing
        const layerInDrawing = state.layers.find((l) => l.drawingId === firstDrawing.id);
        if (layerInDrawing) {
          state.activeLayerId = layerInDrawing.id;
        }
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

  updateDrawingScale: (id, scale) =>
    set((state) => {
      const drawing = state.drawings.find((d) => d.id === id);
      if (!drawing) return;

      // Clamp scale to reasonable values (1:1 to 1:1000)
      const clampedScale = Math.max(0.001, Math.min(1, scale));
      drawing.scale = clampedScale;
      drawing.modifiedAt = new Date().toISOString();

      // Update all viewports showing this drawing (viewport uses drawing's scale)
      for (const sheet of state.sheets) {
        for (const viewport of sheet.viewports) {
          if (viewport.drawingId === id) {
            // Calculate new size from drawing boundary × scale
            const newWidth = drawing.boundary.width * clampedScale;
            const newHeight = drawing.boundary.height * clampedScale;

            // Keep viewport centered at same position
            const centerX = viewport.x + viewport.width / 2;
            const centerY = viewport.y + viewport.height / 2;

            viewport.scale = clampedScale;
            viewport.width = newWidth;
            viewport.height = newHeight;
            viewport.x = centerX - newWidth / 2;
            viewport.y = centerY - newHeight / 2;
          }
        }
        sheet.modifiedAt = new Date().toISOString();
      }

      state.isModified = true;
    }),

  fitBoundaryToContent: (id, padding = 50) =>
    set((state) => {
      const drawing = state.drawings.find((d) => d.id === id);
      if (!drawing) return;

      // Get all shapes in this drawing
      const drawingShapes = state.shapes.filter((s) => s.drawingId === id);
      if (drawingShapes.length === 0) {
        // No shapes, reset to default
        drawing.boundary = { ...DEFAULT_DRAWING_BOUNDARY };
        drawing.modifiedAt = new Date().toISOString();
        state.isModified = true;
        return;
      }

      // Calculate bounding box of all shapes
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

      // Apply padding
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

      // Save current viewport to drawingViewports if in drawing mode
      if (state.editorMode === 'drawing' && state.activeDrawingId) {
        state.drawingViewports[state.activeDrawingId] = { ...state.viewport };
      }

      state.activeDrawingId = id;
      state.editorMode = 'drawing';
      state.activeSheetId = null;
      if (state.drawingViewports[id]) {
        state.viewport = state.drawingViewports[id];
      } else {
        // Zoom to fit drawing boundary
        state.viewport = calculateDrawingFitViewport(
          drawing.boundary,
          state.canvasSize.width || ASSUMED_CANVAS_WIDTH,
          state.canvasSize.height || ASSUMED_CANVAS_HEIGHT
        );
      }

      // Set active layer to a layer in this drawing
      const layerInDrawing = state.layers.find((l) => l.drawingId === id);
      if (layerInDrawing) {
        state.activeLayerId = layerInDrawing.id;
      }

      state.selectedShapeIds = [];

      // Auto-sync section references when switching to a section drawing
      if (drawing.drawingType === 'section') {
        // Update section drawing boundary from its source callout
        const callout = (state.shapes as Shape[]).find(
          (s): s is SectionCalloutShape =>
            s.type === 'section-callout' &&
            (s as SectionCalloutShape).targetDrawingId === id
        ) as SectionCalloutShape | undefined;

        if (callout) {
          const newBoundary = computeSectionBoundary(callout, state.projectStructure);
          drawing.boundary = newBoundary;
          drawing.modifiedAt = new Date().toISOString();

          // Update the viewport to fit the new boundary
          state.drawingViewports[id] = calculateDrawingFitViewport(
            newBoundary,
            state.canvasSize.width || ASSUMED_CANVAS_WIDTH,
            state.canvasSize.height || ASSUMED_CANVAS_HEIGHT,
          );
          state.viewport = state.drawingViewports[id];
        }

        // Find the layer ID for section reference shapes
        const sectionLayerId = layerInDrawing?.id || `section-layer-${id}`;

        // Compute section references
        const result = computeSectionReferences(
          drawing,
          state.shapes as Shape[],
          state.drawings as Drawing[],
          state.projectStructure,
          state.sectionGridlineDimensioning,
        );

        if (result) {
          // Remove old section reference shapes for this drawing
          const oldRefIds = new Set(
            (state.shapes as Shape[])
              .filter(s => s.drawingId === id && isSectionReferenceShape(s))
              .map(s => s.id)
          );

          if (oldRefIds.size > 0) {
            state.shapes = (state.shapes as Shape[]).filter(s => !oldRefIds.has(s.id)) as typeof state.shapes;
          }

          // Fix layer IDs to use the actual layer from the section drawing
          const fixedGridlines = result.gridlines.map(gl => ({ ...gl, layerId: sectionLayerId }));
          const fixedLevels = result.levels.map(lv => ({ ...lv, layerId: sectionLayerId }));
          const fixedDimensions = result.dimensions.map(dim => ({ ...dim, layerId: sectionLayerId }));
          const fixedSlabs = result.slabs.map(sl => ({ ...sl, layerId: sectionLayerId }));

          // Add new section reference shapes
          for (const gl of fixedGridlines) {
            (state.shapes as Shape[]).push(gl as unknown as Shape);
          }
          for (const lv of fixedLevels) {
            (state.shapes as Shape[]).push(lv as unknown as Shape);
          }
          for (const dim of fixedDimensions) {
            (state.shapes as Shape[]).push(dim as unknown as Shape);
          }
          for (const sl of fixedSlabs) {
            (state.shapes as Shape[]).push(sl as unknown as Shape);
          }

          // Update the drawing's sectionReferences
          drawing.sectionReferences = result.references;
        }
      }
    }),

  syncSectionReferences: (sectionDrawingId) =>
    set((state) => {
      const drawing = state.drawings.find((d) => d.id === sectionDrawingId);
      if (!drawing || drawing.drawingType !== 'section') return;

      // Find the layer for section reference shapes
      const layerInDrawing = state.layers.find((l) => l.drawingId === sectionDrawingId);
      const sectionLayerId = layerInDrawing?.id || `section-layer-${sectionDrawingId}`;

      // Compute section references
      const result = computeSectionReferences(
        drawing,
        state.shapes as Shape[],
        state.drawings as Drawing[],
        state.projectStructure,
        state.sectionGridlineDimensioning,
      );

      if (result) {
        // Remove old section reference shapes for this drawing
        const oldRefIds = new Set(
          (state.shapes as Shape[])
            .filter(s => s.drawingId === sectionDrawingId && isSectionReferenceShape(s))
            .map(s => s.id)
        );

        if (oldRefIds.size > 0) {
          state.shapes = (state.shapes as Shape[]).filter(s => !oldRefIds.has(s.id)) as typeof state.shapes;
        }

        // Fix layer IDs to use the actual layer from the section drawing
        const fixedGridlines = result.gridlines.map(gl => ({ ...gl, layerId: sectionLayerId }));
        const fixedLevels = result.levels.map(lv => ({ ...lv, layerId: sectionLayerId }));
        const fixedDimensions = result.dimensions.map(dim => ({ ...dim, layerId: sectionLayerId }));
        const fixedSlabs = result.slabs.map(sl => ({ ...sl, layerId: sectionLayerId }));

        // Add new section reference shapes
        for (const gl of fixedGridlines) {
          (state.shapes as Shape[]).push(gl as unknown as Shape);
        }
        for (const lv of fixedLevels) {
          (state.shapes as Shape[]).push(lv as unknown as Shape);
        }
        for (const dim of fixedDimensions) {
          (state.shapes as Shape[]).push(dim as unknown as Shape);
        }
        for (const sl of fixedSlabs) {
          (state.shapes as Shape[]).push(sl as unknown as Shape);
        }

        // Update the drawing's sectionReferences
        drawing.sectionReferences = result.references;
        drawing.modifiedAt = new Date().toISOString();
        state.isModified = true;
      }
    }),

  syncAllSectionReferences: () =>
    set((state) => {
      // Find all section drawings and re-sync their references
      const sectionDrawings = state.drawings.filter(d => d.drawingType === 'section');
      for (const sectionDrawing of sectionDrawings) {
        const layerInDrawing = state.layers.find((l) => l.drawingId === sectionDrawing.id);
        const sectionLayerId = layerInDrawing?.id || `section-layer-${sectionDrawing.id}`;

        const result = computeSectionReferences(
          sectionDrawing,
          state.shapes as Shape[],
          state.drawings as Drawing[],
          state.projectStructure,
          state.sectionGridlineDimensioning,
        );

        if (result) {
          // Remove old section reference shapes for this drawing
          state.shapes = (state.shapes as Shape[]).filter(
            s => !(s.drawingId === sectionDrawing.id && isSectionReferenceShape(s))
          ) as typeof state.shapes;

          // Add new section reference shapes with correct layer ID
          for (const gl of result.gridlines) {
            (state.shapes as Shape[]).push({ ...gl, layerId: sectionLayerId } as unknown as Shape);
          }
          for (const lv of result.levels) {
            (state.shapes as Shape[]).push({ ...lv, layerId: sectionLayerId } as unknown as Shape);
          }
          for (const dim of result.dimensions) {
            (state.shapes as Shape[]).push({ ...dim, layerId: sectionLayerId } as unknown as Shape);
          }
          for (const sl of result.slabs) {
            (state.shapes as Shape[]).push({ ...sl, layerId: sectionLayerId } as unknown as Shape);
          }

          // Update the drawing's sectionReferences
          sectionDrawing.sectionReferences = result.references;
        }
      }
    }),

  syncSectionReferenceToSource: (sectionRefShapeId) => {
    const store = get();
    const refShape = store.shapes.find(s => s.id === sectionRefShapeId);
    if (!refShape || !isSectionReferenceShape(refShape)) return;

    const sourceId = getSourceIdFromSectionRef(refShape);
    if (!sourceId) return;

    // Find the section drawing this reference belongs to
    const sectionDrawing = store.drawings.find(d => d.id === refShape.drawingId);
    if (!sectionDrawing || sectionDrawing.drawingType !== 'section') return;

    // Find the section callout that created this section drawing
    const callout = store.shapes.find(
      (s): s is SectionCalloutShape =>
        s.type === 'section-callout' &&
        (s as SectionCalloutShape).targetDrawingId === sectionDrawing.id
    ) as SectionCalloutShape | undefined;
    if (!callout) return;

    const coordSystem = buildSectionCoordinateSystem(callout);

    if (refShape.type === 'gridline') {
      // Reverse sync: gridline reference -> plan gridline
      const sourceGridline = store.shapes.find(
        s => s.id === sourceId && s.type === 'gridline'
      ) as GridlineShape | undefined;
      if (!sourceGridline) return;

      const newPos = syncGridlineFromSection(
        refShape as GridlineShape,
        coordSystem,
        sourceGridline,
      );
      if (newPos) {
        set((state) => {
          withHistory(state, (draft) => {
            const idx = draft.findIndex(s => s.id === sourceId);
            if (idx !== -1) {
              const sourceGl = draft[idx] as GridlineShape;
              sourceGl.start = newPos.start;
              sourceGl.end = newPos.end;

              // Propagate to all linked gridlines via projectGridId
              if (sourceGl.projectGridId) {
                const pgId = sourceGl.projectGridId;
                for (const other of draft) {
                  if (other.id !== sourceId && other.type === 'gridline' &&
                      (other as GridlineShape).projectGridId === pgId) {
                    (other as GridlineShape).start = { ...newPos.start };
                    (other as GridlineShape).end = { ...newPos.end };
                  }
                }
              }
            }
          });
        });
      }
    } else if (refShape.type === 'level') {
      // Reverse sync: level reference -> storey elevation
      const newElevation = syncLevelFromSection(refShape as LevelShape);
      if (newElevation !== null) {
        // Find and update the storey
        const storeyIdMatch = sourceId.match(/^storey-(.+)$/);
        if (storeyIdMatch) {
          const storeyId = storeyIdMatch[1];
          set((state) => {
            for (const building of state.projectStructure.buildings) {
              const storey = building.storeys.find(s => s.id === storeyId);
              if (storey) {
                storey.elevation = newElevation;
                break;
              }
            }
          });
        }
      }
    }
  },

  updateSectionDrawingBoundary: (sectionDrawingId) =>
    set((state) => {
      const drawing = state.drawings.find((d) => d.id === sectionDrawingId);
      if (!drawing || drawing.drawingType !== 'section') return;

      // Find the section callout that created this section drawing
      const callout = (state.shapes as Shape[]).find(
        (s): s is SectionCalloutShape =>
          s.type === 'section-callout' &&
          (s as SectionCalloutShape).targetDrawingId === sectionDrawingId
      ) as SectionCalloutShape | undefined;
      if (!callout) return;

      // Compute boundary from callout geometry and storey elevations
      const newBoundary = computeSectionBoundary(callout, state.projectStructure);

      drawing.boundary = newBoundary;
      drawing.modifiedAt = new Date().toISOString();
      state.isModified = true;

      // Also update any sheet viewports that reference this drawing
      for (const sheet of state.sheets) {
        for (const viewport of sheet.viewports) {
          if (viewport.drawingId === sectionDrawingId) {
            viewport.width = newBoundary.width * viewport.scale;
            viewport.height = newBoundary.height * viewport.scale;
            viewport.centerX = newBoundary.x + newBoundary.width / 2;
            viewport.centerY = newBoundary.y + newBoundary.height / 2;
          }
        }
      }
    }),

  updateDrawingType: (id, drawingType) =>
    set((state) => {
      const drawing = state.drawings.find((d) => d.id === id);
      if (drawing) {
        const wasPlan = drawing.drawingType === 'plan';
        drawing.drawingType = drawingType;
        if (drawingType !== 'plan') {
          // Clear storeyId and planSubtype if switching away from plan type
          delete drawing.storeyId;
          delete drawing.planSubtype;
        } else if (!drawing.storeyId) {
          // Auto-assign the first available storey when switching to plan type
          for (const building of state.projectStructure?.buildings ?? []) {
            if (building.storeys.length > 0) {
              drawing.storeyId = building.storeys[0].id;
              break;
            }
          }
        }

        // When switching TO plan: clone project gridlines from existing plan drawings
        if (!wasPlan && drawingType === 'plan') {
          const layerInDrawing = state.layers.find(l => l.drawingId === id);
          if (layerInDrawing) {
            const clonedGridlines = cloneProjectGridlines(state, id, layerInDrawing.id);
            for (const gl of clonedGridlines) {
              (state.shapes as Shape[]).push(gl);
            }
          }
        }

        drawing.modifiedAt = new Date().toISOString();
        state.isModified = true;
      }
    }),

  updateDrawingPlanSubtype: (id, planSubtype) =>
    set((state) => {
      const drawing = state.drawings.find((d) => d.id === id);
      if (drawing && drawing.drawingType === 'plan') {
        drawing.planSubtype = planSubtype;
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

  // ============================================================================
  // Sheet Actions
  // ============================================================================

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
        queryTables: [],
        titleBlock,
        annotations: [],
        createdAt: new Date().toISOString(),
        modifiedAt: new Date().toISOString(),
      };
      state.sheets.push(newSheet);

      // Select the newly created sheet and switch to sheet mode
      state.activeSheetId = id;
      state.editorMode = 'sheet';

      // Calculate initial viewport to fit the sheet to view
      const initialViewport = calculateSheetFitViewport(paperSize, orientation);
      state.sheetViewports[id] = initialViewport;
      state.viewport = initialViewport;

      state.isModified = true;
    });
    return id;
  },

  deleteSheet: (id) =>
    set((state) => {
      state.sheets = state.sheets.filter((s) => s.id !== id);

      // If the deleted sheet was active, switch back to drawing mode
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

      // Save current viewport based on current mode
      if (state.editorMode === 'drawing' && state.activeDrawingId) {
        state.drawingViewports[state.activeDrawingId] = { ...state.viewport };
      } else if (state.editorMode === 'sheet' && state.activeSheetId) {
        state.sheetViewports[state.activeSheetId] = { ...state.viewport };
      }

      state.activeSheetId = id;
      state.editorMode = 'sheet';
      // Restore sheet viewport or use default
      state.viewport = state.sheetViewports[id] || { offsetX: 0, offsetY: 0, zoom: 1 };
      state.selectedShapeIds = [];

      // Auto-update title block fields (Sheet X of Y, etc.)
      const sheetIndex = state.sheets.findIndex((s) => s.id === id);
      const totalSheets = state.sheets.length;
      const viewportScales = sheet.viewports.map((vp) => vp.scale);

      // Update sheet number field
      const sheetNoField = sheet.titleBlock.fields.find((f) => f.id === 'sheetNo');
      if (sheetNoField) {
        sheetNoField.value = `${sheetIndex + 1} of ${totalSheets}`;
      }

      // Update date field if empty
      const dateField = sheet.titleBlock.fields.find((f) => f.id === 'date');
      if (dateField && !dateField.value) {
        dateField.value = new Date().toISOString().split('T')[0];
      }

      // Update scale field based on viewports
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
      // Save current sheet viewport if in sheet mode
      if (state.editorMode === 'sheet' && state.activeSheetId) {
        state.sheetViewports[state.activeSheetId] = { ...state.viewport };
      }
      state.editorMode = 'drawing';
      state.activeSheetId = null;
      state.viewport = state.drawingViewports[state.activeDrawingId] || { offsetX: 0, offsetY: 0, zoom: 1 };
    }),

  // ============================================================================
  // Sheet Viewport Actions
  // ============================================================================

  addSheetViewport: (sheetId, drawingId, bounds) =>
    set((state) => {
      const sheet = state.sheets.find((s) => s.id === sheetId);
      if (!sheet) return;

      const newViewport: SheetViewport = {
        id: generateId(),
        drawingId,
        x: bounds.x,
        y: bounds.y,
        width: bounds.width,
        height: bounds.height,
        centerX: 0,
        centerY: 0,
        scale: 0.01,  // Default 1:100
        locked: false,
        visible: true,
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

  setViewportScale: (viewportId, scale) =>
    set((state) => {
      if (!state.activeSheetId) return;

      const sheet = state.sheets.find((s) => s.id === state.activeSheetId);
      if (!sheet) return;

      const viewport = sheet.viewports.find((vp) => vp.id === viewportId);
      if (!viewport) return;

      const drawing = state.drawings.find((d) => d.id === viewport.drawingId);
      if (!drawing) return;

      // Clamp scale to reasonable values
      const clampedScale = Math.max(0.001, Math.min(1, scale));

      // Calculate new size from drawing boundary × scale 
      const newWidth = drawing.boundary.width * clampedScale;
      const newHeight = drawing.boundary.height * clampedScale;

      // Keep viewport centered at same position
      const centerX = viewport.x + viewport.width / 2;
      const centerY = viewport.y + viewport.height / 2;

      viewport.scale = clampedScale;
      viewport.width = newWidth;
      viewport.height = newHeight;
      viewport.x = centerX - newWidth / 2;
      viewport.y = centerY - newHeight / 2;

      sheet.modifiedAt = new Date().toISOString();
      state.isModified = true;
    }),

  deleteSheetViewport: (sheetId, viewportId) =>
    set((state) => {
      const sheet = state.sheets.find((s) => s.id === sheetId);
      if (!sheet) return;

      sheet.viewports = sheet.viewports.filter((vp) => vp.id !== viewportId);
      sheet.modifiedAt = new Date().toISOString();
      state.isModified = true;

      // Clear selection if deleted viewport was selected
      if (state.viewportEditState.selectedViewportId === viewportId) {
        state.viewportEditState.selectedViewportId = null;
      }
    }),

  // Sheet Query Table actions
  addSheetQueryTable: (sheetId, table) =>
    set((state) => {
      const sheet = state.sheets.find((s) => s.id === sheetId);
      if (!sheet) return;
      if (!sheet.queryTables) sheet.queryTables = [];
      sheet.queryTables.push(table);
      sheet.modifiedAt = new Date().toISOString();
      state.isModified = true;
    }),

  updateSheetQueryTable: (sheetId, tableId, updates) =>
    set((state) => {
      const sheet = state.sheets.find((s) => s.id === sheetId);
      if (!sheet || !sheet.queryTables) return;
      const table = sheet.queryTables.find((t) => t.id === tableId);
      if (!table) return;
      Object.assign(table, updates);
      sheet.modifiedAt = new Date().toISOString();
      state.isModified = true;
    }),

  deleteSheetQueryTable: (sheetId, tableId) =>
    set((state) => {
      const sheet = state.sheets.find((s) => s.id === sheetId);
      if (!sheet || !sheet.queryTables) return;
      sheet.queryTables = sheet.queryTables.filter((t) => t.id !== tableId);
      sheet.modifiedAt = new Date().toISOString();
      state.isModified = true;
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

      // Center viewport on drawing boundary center
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

      // Calculate scale to fit drawing boundary in viewport
      const scaleX = viewport.width / drawing.boundary.width;
      const scaleY = viewport.height / drawing.boundary.height;
      const scale = Math.min(scaleX, scaleY) * 0.9; // 90% to add padding

      // Center on drawing boundary
      viewport.centerX = drawing.boundary.x + drawing.boundary.width / 2;
      viewport.centerY = drawing.boundary.y + drawing.boundary.height / 2;
      viewport.scale = scale;

      sheet.modifiedAt = new Date().toISOString();
      state.isModified = true;
    }),

  // ============================================================================
  // Title Block Actions
  // ============================================================================

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

      // Find template (check built-in first, then custom)
      let template = BUILT_IN_TEMPLATES.find((t) => t.id === templateId);
      if (!template) {
        template = state.customTitleBlockTemplates.find((t) => t.id === templateId);
      }
      if (!template) return;

      // Create new title block from template
      const newTitleBlock = createTitleBlockFromTemplate(template);

      // Preserve existing field values where possible
      const existingFields = sheet.titleBlock.fields;
      newTitleBlock.fields = newTitleBlock.fields.map((field) => {
        const existingField = existingFields.find((ef) => ef.id === field.id);
        if (existingField && existingField.value) {
          return { ...field, value: existingField.value };
        }
        return field;
      });

      // Apply the new title block
      sheet.titleBlock = newTitleBlock as Sheet['titleBlock'];
      sheet.modifiedAt = new Date().toISOString();
      state.isModified = true;
    }),

  addRevisionToSheet: (sheetId, description, drawnBy) =>
    set((state) => {
      const sheet = state.sheets.find((s) => s.id === sheetId);
      if (!sheet) return;

      // Get or create revision table
      const titleBlock = sheet.titleBlock as unknown as EnhancedTitleBlock;
      if (!titleBlock.revisionTable) {
        titleBlock.revisionTable = {
          visible: true,
          maxRows: 5,
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

      // Update the revision field if it exists
      const revisionField = sheet.titleBlock.fields.find((f) => f.id === 'revision');
      if (revisionField && titleBlock.revisionTable.revisions.length > 0) {
        const lastRevision = titleBlock.revisionTable.revisions[titleBlock.revisionTable.revisions.length - 1];
        revisionField.value = lastRevision.number;
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
        x: logoField?.x ?? 5,
        y: logoField?.y ?? 5,
        width,
        height,
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

  // ============================================================================
  // Title Block Template Actions
  // ============================================================================

  addCustomTemplate: (template) =>
    set((state) => {
      state.customTitleBlockTemplates.push(template);
      state.isModified = true;
    }),

  updateCustomTemplate: (templateId, updates) =>
    set((state) => {
      const index = state.customTitleBlockTemplates.findIndex((t) => t.id === templateId);
      if (index !== -1) {
        state.customTitleBlockTemplates[index] = {
          ...state.customTitleBlockTemplates[index],
          ...updates,
        };
        state.isModified = true;
      }
    }),

  deleteCustomTemplate: (templateId) =>
    set((state) => {
      state.customTitleBlockTemplates = state.customTitleBlockTemplates.filter(
        (t) => t.id !== templateId
      );
      state.isModified = true;
    }),

  getAvailableTemplates: (paperSize) => {
    // This is a getter that combines built-in and custom templates
    // Note: This doesn't use set() as it's a pure getter
    const builtIn = getTemplatesForPaperSize(paperSize);
    // Custom templates would need to be filtered similarly
    return builtIn;
  },

  updateAutoFields: (sheetId, projectName = '') =>
    set((state) => {
      const sheet = state.sheets.find((s) => s.id === sheetId);
      if (!sheet) return;

      // Calculate auto-field context
      const sheetIndex = state.sheets.findIndex((s) => s.id === sheetId);
      const totalSheets = state.sheets.length;

      // Get scales from all viewports
      const viewportScales = sheet.viewports.map((vp) => vp.scale);

      const context: AutoFieldContext = {
        totalSheets,
        currentSheetIndex: sheetIndex,
        projectName,
        viewportScales,
      };

      // Get enhanced title block fields
      const titleBlock = sheet.titleBlock as unknown as EnhancedTitleBlock;
      if (titleBlock.fields && titleBlock.fields.length > 0) {
        const updatedFields = calculateAutoFields(titleBlock.fields, context);
        // Apply the updated fields back
        for (const updatedField of updatedFields) {
          const field = sheet.titleBlock.fields.find((f) => f.id === updatedField.id);
          if (field) {
            field.value = updatedField.value;
          }
        }
        sheet.modifiedAt = new Date().toISOString();
      }
    }),

  // ============================================================================
  // Sheet Template Actions
  // ============================================================================

  addSheetFromTemplate: (templateId, name, draftAssignments = {}) => {
    // Find template before calling set() so we can return null if not found
    let template = BUILT_IN_SHEET_TEMPLATES.find((t) => t.id === templateId);
    if (!template) {
      template = get().customSheetTemplates.find((t) => t.id === templateId);
    }
    if (!template) return null;

    const id = generateId();
    set((state) => {
      // Generate sheet number
      const sheetNumber = getNextSheetNumber(state.sheets, DEFAULT_NUMBERING_SCHEME);

      // Create viewports from template placeholders
      const viewports = createViewportsFromTemplate(template!, draftAssignments);

      // Create the sheet
      const newSheet: Sheet = {
        id,
        name: name || `Sheet ${state.sheets.length + 1}`,
        paperSize: template!.paperSize as PaperSize,
        orientation: template!.orientation as PaperOrientation,
        viewports,
        queryTables: [],
        titleBlock: createDefaultTitleBlock(),
        annotations: [],
        createdAt: new Date().toISOString(),
        modifiedAt: new Date().toISOString(),
      };

      // Set sheet number in title block
      const numberField = newSheet.titleBlock.fields.find((f) => f.id === 'number');
      if (numberField) {
        numberField.value = sheetNumber;
      }

      state.sheets.push(newSheet);
      state.isModified = true;

      // Switch to the new sheet
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

      // Convert viewports to placeholders
      const placeholders = sheet.viewports.map((vp, index) => ({
        id: `placeholder-${index + 1}`,
        name: `View ${index + 1}`,
        x: vp.x,
        y: vp.y,
        width: vp.width,
        height: vp.height,
        defaultScale: vp.scale,
      }));

      const newTemplate: SheetTemplate = {
        id: generateId(),
        name,
        description,
        paperSize: sheet.paperSize,
        orientation: sheet.orientation,
        titleBlockTemplateId: '',
        viewportPlaceholders: placeholders,
        isBuiltIn: false,
        createdAt: new Date().toISOString(),
        modifiedAt: new Date().toISOString(),
      };

      state.customSheetTemplates.push(newTemplate);
      state.isModified = true;
    }),

  addCustomSheetTemplate: (template) =>
    set((state) => {
      state.customSheetTemplates.push(template);
      state.isModified = true;
    }),

  deleteCustomSheetTemplate: (templateId) =>
    set((state) => {
      state.customSheetTemplates = state.customSheetTemplates.filter(
        (t) => t.id !== templateId
      );
      state.isModified = true;
    }),

  renumberAllSheets: (scheme) =>
    set((state) => {
      // Renumber all sheets based on the scheme
      state.sheets.forEach((sheet, index) => {
        const newNumber = `${scheme.prefix}${scheme.separator}${(scheme.startNumber + index).toString().padStart(scheme.digits, '0')}`;

        // Update number field in title block
        const numberField = sheet.titleBlock.fields.find((f) => f.id === 'number');
        if (numberField) {
          numberField.value = newNumber;
        }

        // Also update sheetNo field if different from number
        const sheetNoField = sheet.titleBlock.fields.find((f) => f.id === 'sheetNo');
        if (sheetNoField) {
          sheetNoField.value = `${index + 1} of ${state.sheets.length}`;
        }

        sheet.modifiedAt = new Date().toISOString();
      });

      state.isModified = true;
    }),

  // ============================================================================
  // Layer Actions
  // ============================================================================

  addLayer: (name) =>
    set((state) => {
      const newLayer: Layer = {
        id: generateId(),
        name: name || `Layer ${state.layers.filter(l => l.drawingId === state.activeDrawingId).length}`,
        drawingId: state.activeDrawingId,
        visible: true,
        locked: false,
        color: '#ffffff',
        lineStyle: 'solid',
        lineWidth: 1,
      };
      state.layers.push(newLayer);
      state.activeLayerId = newLayer.id;
    }),

  updateLayer: (id, updates) =>
    set((state) => {
      const index = state.layers.findIndex((l) => l.id === id);
      if (index !== -1) {
        state.layers[index] = { ...state.layers[index], ...updates };
      }
    }),

  deleteLayer: (id) =>
    set((state) => {
      // Get layers in the current drawing
      const layersInDrawing = state.layers.filter((l) => l.drawingId === state.activeDrawingId);

      // Can't delete the last layer in a drawing
      if (layersInDrawing.length <= 1) return;

      state.layers = state.layers.filter((l) => l.id !== id);
      if (state.activeLayerId === id) {
        // Set active layer to another layer in the same drawing
        const remainingLayersInDrawing = state.layers.filter((l) => l.drawingId === state.activeDrawingId);
        state.activeLayerId = remainingLayersInDrawing[0]?.id || state.layers[0].id;
      }
      // Move shapes from deleted layer to active layer (with history)
      const hasShapesOnLayer = state.shapes.some((s) => s.layerId === id);
      if (hasShapesOnLayer) {
        const newLayerId = state.activeLayerId;
        withHistory(state, (draft) => {
          for (const s of draft) {
            if (s.layerId === id) {
              s.layerId = newLayerId;
            }
          }
        });
      }
    }),

  setActiveLayer: (id) =>
    set((state) => {
      state.activeLayerId = id;
    }),

  // ============================================================================
  // Text Style Actions
  // ============================================================================

  setActiveTextStyle: (id) =>
    set((state) => {
      state.activeTextStyleId = id;
    }),

  addTextStyle: (style) =>
    set((state) => {
      state.textStyles.push(style);
      state.isModified = true;
    }),

  updateTextStyle: (id, updates) =>
    set((state) => {
      const index = state.textStyles.findIndex((s) => s.id === id);
      if (index !== -1) {
        state.textStyles[index] = { ...state.textStyles[index], ...updates };
        state.isModified = true;
      }
    }),

  deleteTextStyle: (id) =>
    set((state) => {
      const style = state.textStyles.find((s) => s.id === id);
      // Can't delete built-in styles
      if (style?.isBuiltIn) return;
      state.textStyles = state.textStyles.filter((s) => s.id !== id);
      if (state.activeTextStyleId === id) {
        state.activeTextStyleId = null;
      }
      state.isModified = true;
    }),

  applyTextStyleToShape: (shapeId, styleId) =>
    set((state) => {
      const style = state.textStyles.find((s) => s.id === styleId);
      if (!style) return;
      // Check if shape exists and is text before recording history
      const exists = state.shapes.some((s) => s.id === shapeId && s.type === 'text');
      if (!exists) return;

      withHistory(state, (draft) => {
        const shape = draft.find((s) => s.id === shapeId);
        if (!shape || shape.type !== 'text') return;

        // Apply style properties to the shape
        const textShape = shape as import('../../types/geometry').TextShape;
        textShape.fontFamily = style.fontFamily;
        textShape.fontSize = style.fontSize;
        textShape.bold = style.bold;
        textShape.italic = style.italic;
        textShape.underline = style.underline;
        textShape.color = style.color;
        textShape.alignment = style.alignment;
        textShape.verticalAlignment = style.verticalAlignment;
        textShape.lineHeight = style.lineHeight;
        textShape.isModelText = style.isModelText;
        textShape.backgroundMask = style.backgroundMask;
        textShape.backgroundColor = style.backgroundColor;
        textShape.backgroundPadding = style.backgroundPadding;
        textShape.strikethrough = style.strikethrough ?? false;
        textShape.textCase = style.textCase;
        textShape.letterSpacing = style.letterSpacing;
        textShape.widthFactor = style.widthFactor;
        textShape.obliqueAngle = style.obliqueAngle;
        textShape.paragraphSpacing = style.paragraphSpacing;
        textShape.textStyleId = styleId;
      });
    }),

  duplicateTextStyle: (id) => {
    const style = get().textStyles.find((s) => s.id === id);
    if (!style) return undefined;
    const newId = generateId();
    set((state) => {
      state.textStyles.push({
        ...JSON.parse(JSON.stringify(style)),
        id: newId,
        name: `${style.name} (Copy)`,
        isBuiltIn: false,
      });
      state.isModified = true;
    });
    return newId;
  },

  setTextStyleManagerOpen: (open) =>
    set((state) => {
      state.textStyleManagerOpen = open;
    }),
});
