/**
 * Services Module - Business logic layer
 *
 * This module provides reusable business logic functions
 * that are independent of the UI and state management.
 *
 * Services organized by domain:
 * - file/: File I/O, import/export
 * - drawing/: Shape, drawing, sheet, selection, history operations
 * - export/: IFC, SVG, PAT export/import
 * - template/: Title block and sheet templates
 * - parametric/: Parametric shape operations
 * - integration/: External service integrations
 */

// File operations
export {
  showOpenDialog,
  showSaveDialog,
  showExportDialog,
  showExportAllFormatsDialog,
  readProjectFile,
  writeProjectFile,
  exportToSVG,
  exportToDXF,
  exportToIFC,
  confirmUnsavedChanges,
  promptSaveBeforeClose,
  showError,
  showInfo,
  showImportDxfDialog,
  parseDXF,
} from './file/fileService';

export type { ProjectFile, SavePromptResult } from './file/fileService';

// Shape operations
export {
  generateShapeId,
  DEFAULT_STYLE,
  createLineShape,
  createRectangleShape,
  createCircleShape,
  createArcShape,
  createEllipseShape,
  createPolylineShape,
  createPointShape,
  cloneShape,
  cloneShapes,
  translateShape,
  rotateShape,
  scaleShape,
  mirrorShape,
  getShapeCenter,
  getShapesBounds,
  validateShape,
  isShapeInBounds,
  doesShapeIntersectBounds,
  getShapeBounds,
} from './drawing/shapeService';

export type { ShapeBounds } from './drawing/shapeService';

// Drawing operations (with legacy Draft aliases)
export {
  generateDrawingId,
  generateDraftId,
  DEFAULT_BOUNDARY,
  createDrawing,
  createDraft,
  updateDrawingBoundary,
  updateDraftBoundary,
  getDrawingShapes,
  getDraftShapes,
  getVisibleDrawingShapes,
  getVisibleDraftShapes,
  getDrawingLayerShapes,
  getDraftLayerShapes,
  calculateDrawingBounds,
  calculateDraftBounds,
  fitBoundaryToShapes,
  isPointInDrawingBoundary,
  isPointInDraftBoundary,
  isShapeInDrawingBoundary,
  isShapeInDraftBoundary,
  getDrawingStats,
  getDraftStats,
  copyShapesToDrawing,
  copyShapesToDraft,
  validateDrawing,
  validateDraft,
  getDrawingCenter,
  getDraftCenter,
  calculateZoomToFit,
} from './drawing/drawingService';

// Sheet operations
export {
  PAPER_SIZES,
  MM_TO_PIXELS,
  SCALE_PRESETS,
  generateSheetId,
  generateViewportId,
  createDefaultTitleBlock,
  createSheet,
  getPaperDimensions,
  createViewport,
  updateViewport,
  calculateViewportCenter,
  calculateViewportScale,
  formatScale,
  parseScale,
  sheetToScreen,
  screenToSheet,
  worldToViewport,
  viewportToWorld,
  isPointInViewport,
  updateTitleBlockField,
  updateTitleBlockFields,
  getPrintableArea,
  validateSheet,
  validateViewport,
} from './drawing/sheetService';

// Selection operations
export {
  findShapeAtPoint,
  findShapesAtPoint,
  selectShapesByBox,
  filterByLayer,
  filterByLayers,
  filterByType,
  filterByTypes,
  filterByDrawing,
  filterByDraft,
  filterVisible,
  filterUnlocked,
  filterSelectable,
  filterByVisibleLayers,
  filterByUnlockedLayers,
  addToSelection,
  removeFromSelection,
  toggleInSelection,
  getShapesByIds,
  invertSelection,
  selectAll,
  isSelected,
  getSelectionStats,
} from './drawing/selectionService';

export type { SelectionMode, SelectionBox } from './drawing/selectionService';

// History operations
export {
  DEFAULT_HISTORY_CONFIG,
  createHistoryState,
  createSnapshot,
  pushSnapshot,
  canUndo,
  canRedo,
  getUndoSnapshot,
  getRedoSnapshot,
  performUndo,
  performRedo,
  clearHistory,
  getUndoDescriptions,
  getRedoDescriptions,
  getHistoryStats,
  undoToSnapshot,
  hasChangedSinceLastSnapshot,
  beginBatch,
  endBatch,
} from './drawing/historyService';

export type { HistorySnapshot, HistoryConfig, HistoryState } from './drawing/historyService';

// Title block operations
export {
  BUILT_IN_TEMPLATES,
  generateTemplateId,
  getTemplateById,
  getTemplatesForPaperSize,
  calculateTitleBlockDimensions,
  createTitleBlockFromTemplate,
  createDefaultRevisionTable,
  addRevision,
  calculateAutoFields,
  updateFieldValue,
  updateFieldValues,
  setLogo,
  removeLogo,
} from './template/titleBlockService';

export type { AutoFieldContext } from './template/titleBlockService';

// Sheet template operations
export {
  BUILT_IN_SHEET_TEMPLATES,
  DISCIPLINE_PREFIXES,
  DEFAULT_NUMBERING_SCHEME,
  generateSheetTemplateId,
  getSheetTemplateById,
  getSheetTemplatesForPaperSize,
  getTemplatesGroupedByPaperSize,
  createViewportsFromTemplate,
  generateSheetNumber,
  parseSheetNumber,
  renumberSheets,
  getNextSheetNumber,
  createTemplateFromSheet,
} from './template/sheetTemplateService';

export type { SheetNumberingScheme } from './template/sheetTemplateService';

// Parametric operations - Note: use direct imports from ./parametric/ for full access
// Re-exporting commonly used functions
export {
  PROFILE_TEMPLATES,
  getProfileTemplate,
  getAllProfileTemplates,
  getDefaultParameters,
} from './parametric/profileTemplates';

export {
  getPresetsForType,
  getAvailableStandards,
  getCategoriesForStandard,
  searchPresets,
  getPresetById,
} from './parametric/profileLibrary';

export {
  generateProfileGeometry,
} from './parametric/geometryGenerators';

export {
  createProfileShape,
  updateParametricParameters,
  updateParametricPosition,
  updateParametricRotation,
  updateParametricScale,
  explodeParametricShape,
  cloneParametricShape,
} from './parametric/parametricService';

// Log service
export { logger } from './log/logService';

// Export operations
export * from './export/ifcExport';
export * from './export/svgPatternService';
export * from './export/svgTitleBlockService';
export * from './export/patService';
