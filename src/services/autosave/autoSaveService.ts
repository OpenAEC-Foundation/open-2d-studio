/**
 * Auto-save service for development persistence.
 * Saves document state to localStorage on changes (debounced).
 * Restores on app startup if saved state exists.
 */

const AUTOSAVE_KEY = 'openndstudio_autosave_v1';
const DEBOUNCE_MS = 2000;

interface AutoSaveData {
  shapes: any[];
  layers: any[];
  drawings: any[];
  sheets: any[];
  activeDrawingId: string;
  activeSheetId: string | null;
  activeLayerId: string;
  editorMode: string;
  viewport: any;
  drawingViewports: any;
  sheetViewports: any;
  parametricShapes: any[];
  projectName: string;
  projectInfo: any;
  unitSettings: any;
  currentStyle: any;
  defaultTextStyle: any;
  textStyles: any[];
  activeTextStyleId: string | null;
  customTitleBlockTemplates: any[];
  customSheetTemplates: any[];
  projectPatterns: any[];
  savedAt: number;
}

/** Extract saveable fields from the store state */
function extractSaveData(state: any): AutoSaveData {
  return {
    shapes: (state.shapes || []).filter((s: any) => !s.id?.startsWith('section-ref-')),
    layers: state.layers,
    drawings: state.drawings,
    sheets: state.sheets,
    activeDrawingId: state.activeDrawingId,
    activeSheetId: state.activeSheetId,
    activeLayerId: state.activeLayerId,
    editorMode: state.editorMode,
    viewport: state.viewport,
    drawingViewports: state.drawingViewports,
    sheetViewports: state.sheetViewports,
    parametricShapes: state.parametricShapes,
    projectName: state.projectName,
    projectInfo: state.projectInfo,
    unitSettings: state.unitSettings,
    currentStyle: state.currentStyle,
    defaultTextStyle: state.defaultTextStyle,
    textStyles: state.textStyles || [],
    activeTextStyleId: state.activeTextStyleId || null,
    customTitleBlockTemplates: state.customTitleBlockTemplates || [],
    customSheetTemplates: state.customSheetTemplates || [],
    projectPatterns: state.projectPatterns || [],
    savedAt: Date.now(),
  };
}

/** Save state to localStorage */
function saveToStorage(data: AutoSaveData): void {
  try {
    localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(data));
  } catch {
    // Quota exceeded — silently ignore
  }
}

/** Load saved state from localStorage */
export function loadAutoSave(): AutoSaveData | null {
  try {
    const raw = localStorage.getItem(AUTOSAVE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as AutoSaveData;
    // Validate minimal structure
    if (!data.shapes || !data.layers || !data.drawings) return null;
    return data;
  } catch {
    return null;
  }
}

/** Clear auto-saved state */
export function clearAutoSave(): void {
  try {
    localStorage.removeItem(AUTOSAVE_KEY);
  } catch {
    // ignore
  }
}

/** Restore auto-saved state into the store */
export function restoreAutoSave(set: (fn: (state: any) => void) => void): boolean {
  const data = loadAutoSave();
  if (!data) return false;

  set((state: any) => {
    state.shapes = data.shapes || [];
    state.layers = data.layers || [];
    state.drawings = data.drawings || [];
    if (data.sheets && data.sheets.length > 0) {
      state.sheets = data.sheets;
    }
    state.activeDrawingId = data.activeDrawingId;
    state.activeSheetId = data.activeSheetId || null;
    state.activeLayerId = data.activeLayerId;
    state.editorMode = data.editorMode || 'drawing';
    state.viewport = data.viewport;
    state.drawingViewports = data.drawingViewports || {};
    state.sheetViewports = data.sheetViewports || {};
    state.parametricShapes = data.parametricShapes || [];
    state.projectName = data.projectName || 'Untitled';
    if (data.projectInfo) state.projectInfo = data.projectInfo;
    if (data.unitSettings) state.unitSettings = data.unitSettings;
    if (data.currentStyle) state.currentStyle = data.currentStyle;
    if (data.defaultTextStyle) state.defaultTextStyle = data.defaultTextStyle;
    if (data.textStyles) state.textStyles = data.textStyles;
    if (data.activeTextStyleId !== undefined) state.activeTextStyleId = data.activeTextStyleId;
    if (data.customTitleBlockTemplates) state.customTitleBlockTemplates = data.customTitleBlockTemplates;
    if (data.customSheetTemplates) state.customSheetTemplates = data.customSheetTemplates;
    if (data.projectPatterns) state.projectPatterns = data.projectPatterns;
    // Reset transient state
    state.selectedShapeIds = [];
    state.isDrawing = false;
    state.drawingPreview = null;
    state.drawingPoints = [];
    state.isModified = false;
  });

  return true;
}

/**
 * Start auto-save subscription on the store.
 * Call once at app startup after store is created.
 */
export function startAutoSave(subscribe: (listener: (state: any, prevState: any) => void) => () => void): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;

  const unsubscribe = subscribe((state: any, prevState: any) => {
    // Only save when model data changes
    if (
      state.shapes !== prevState.shapes ||
      state.layers !== prevState.layers ||
      state.drawings !== prevState.drawings ||
      state.sheets !== prevState.sheets ||
      state.parametricShapes !== prevState.parametricShapes ||
      state.viewport !== prevState.viewport
    ) {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        saveToStorage(extractSaveData(state));
      }, DEBOUNCE_MS);
    }
  });

  return () => {
    if (timer) clearTimeout(timer);
    unsubscribe();
  };
}
