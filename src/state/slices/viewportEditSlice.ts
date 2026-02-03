/**
 * Viewport Edit Slice - Manages sheet viewport editing state
 * (viewport manipulation on sheets)
 *
 * Includes:
 * - Viewport selection and manipulation
 * - Crop region editing
 * - Layer override management
 */

import type {
  ViewportEditState,
  ViewportHandleType,
  Point,
  Sheet,
  CropRegionEditState,
  CropRegionHandleType,
  CropRegion,
  LayerOverrideEditState,
  ViewportLayerOverride,
} from './types';

// ============================================================================
// State Interface
// ============================================================================

export interface ViewportEditState_Full {
  viewportEditState: ViewportEditState;
  cropRegionEditState: CropRegionEditState;
  layerOverrideEditState: LayerOverrideEditState;
}

// ============================================================================
// Actions Interface
// ============================================================================

export interface ViewportEditActions {
  // Viewport selection and manipulation
  selectViewport: (viewportId: string | null) => void;
  startViewportDrag: (handle: ViewportHandleType, sheetPos: Point) => void;
  updateViewportDrag: (sheetPos: Point) => void;
  endViewportDrag: () => void;
  cancelViewportDrag: () => void;

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
}

export type ViewportEditSlice = ViewportEditState_Full & ViewportEditActions;

// ============================================================================
// Initial State
// ============================================================================

export const initialViewportEditState: ViewportEditState_Full = {
  viewportEditState: {
    selectedViewportId: null,
    activeHandle: null,
    isDragging: false,
    dragStart: null,
    originalViewport: null,
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
};

// ============================================================================
// Slice Creator
// ============================================================================

// Type for the full store that this slice needs access to
interface FullStore extends ViewportEditState_Full {
  sheets: Sheet[];
  activeSheetId: string | null;
  isModified: boolean;
  drafts: { id: string; boundary: { x: number; y: number; width: number; height: number } }[];
}

// Helper to get viewport from state
const getViewport = (state: FullStore, viewportId: string) => {
  if (!state.activeSheetId) return null;
  const sheet = state.sheets.find((s) => s.id === state.activeSheetId);
  if (!sheet) return null;
  return sheet.viewports.find((vp) => vp.id === viewportId) || null;
};

// Helper to create default crop region from draft boundary
const createDefaultCropRegion = (state: FullStore, draftId: string): CropRegion => {
  const draft = state.drafts.find((d) => d.id === draftId);
  const boundary = draft?.boundary || { x: -500, y: -500, width: 1000, height: 1000 };
  return {
    type: 'rectangular',
    points: [
      { x: boundary.x, y: boundary.y },
      { x: boundary.x + boundary.width, y: boundary.y + boundary.height },
    ],
    enabled: true,
  };
};

export const createViewportEditSlice = (
  set: (fn: (state: FullStore) => void) => void,
  _get: () => FullStore
): ViewportEditActions => ({
  // ============================================================================
  // Viewport Selection and Manipulation
  // ============================================================================

  selectViewport: (viewportId) =>
    set((state) => {
      state.viewportEditState.selectedViewportId = viewportId;
      // Clear any active drag when changing selection
      state.viewportEditState.activeHandle = null;
      state.viewportEditState.isDragging = false;
      state.viewportEditState.dragStart = null;
      state.viewportEditState.originalViewport = null;
      // Also exit crop region edit mode
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

      // Only allow moving (center handle) - size is derived from boundary × scale (Revit-style)
      if (activeHandle === 'center') {
        viewport.x = originalViewport.x + dx;
        viewport.y = originalViewport.y + dy;
      }
      // Note: Resize handles are ignored - viewport size is controlled by scale

      sheet.modifiedAt = new Date().toISOString();
    }),

  endViewportDrag: () =>
    set((state) => {
      if (state.viewportEditState.isDragging) {
        state.isModified = true;
      }
      state.viewportEditState.activeHandle = null;
      state.viewportEditState.isDragging = false;
      state.viewportEditState.dragStart = null;
      state.viewportEditState.originalViewport = null;
    }),

  cancelViewportDrag: () =>
    set((state) => {
      const { selectedViewportId, originalViewport } = state.viewportEditState;
      if (selectedViewportId && originalViewport && state.activeSheetId) {
        // Restore original viewport state
        const sheet = state.sheets.find((s) => s.id === state.activeSheetId);
        if (sheet) {
          const viewport = sheet.viewports.find((vp) => vp.id === selectedViewportId);
          if (viewport) {
            viewport.x = originalViewport.x;
            viewport.y = originalViewport.y;
            viewport.width = originalViewport.width;
            viewport.height = originalViewport.height;
          }
        }
      }
      state.viewportEditState.activeHandle = null;
      state.viewportEditState.isDragging = false;
      state.viewportEditState.dragStart = null;
      state.viewportEditState.originalViewport = null;
    }),

  // ============================================================================
  // Crop Region Actions
  // ============================================================================

  enableCropRegion: (viewportId) =>
    set((state) => {
      const viewport = getViewport(state, viewportId);
      if (!viewport) return;

      if (!viewport.cropRegion) {
        // Create default crop region based on draft boundary
        viewport.cropRegion = createDefaultCropRegion(state, viewport.drawingId);
      } else {
        viewport.cropRegion.enabled = true;
      }
      state.isModified = true;
    }),

  disableCropRegion: (viewportId) =>
    set((state) => {
      const viewport = getViewport(state, viewportId);
      if (!viewport || !viewport.cropRegion) return;

      viewport.cropRegion.enabled = false;
      state.isModified = true;
    }),

  toggleCropRegion: (viewportId) =>
    set((state) => {
      const viewport = getViewport(state, viewportId);
      if (!viewport) return;

      if (!viewport.cropRegion) {
        viewport.cropRegion = createDefaultCropRegion(state, viewport.drawingId);
      } else {
        viewport.cropRegion.enabled = !viewport.cropRegion.enabled;
      }
      state.isModified = true;
    }),

  startCropRegionEdit: (viewportId) =>
    set((state) => {
      const viewport = getViewport(state, viewportId);
      if (!viewport) return;

      // Ensure crop region exists
      if (!viewport.cropRegion) {
        viewport.cropRegion = createDefaultCropRegion(state, viewport.drawingId);
      }

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

      const viewport = getViewport(state, viewportId);
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

      const viewport = getViewport(state, viewportId);
      if (!viewport || !viewport.cropRegion) return;

      const dx = draftPos.x - dragStart.x;
      const dy = draftPos.y - dragStart.y;

      // For rectangular crop region, points[0] is top-left, points[1] is bottom-right
      const [origTopLeft, origBottomRight] = originalCropRegion.points;
      let newTopLeft = { ...origTopLeft };
      let newBottomRight = { ...origBottomRight };

      // Handle horizontal resizing
      if (activeHandle.includes('left')) {
        newTopLeft.x = origTopLeft.x + dx;
      } else if (activeHandle.includes('right')) {
        newBottomRight.x = origBottomRight.x + dx;
      }

      // Handle vertical resizing
      if (activeHandle.includes('top')) {
        newTopLeft.y = origTopLeft.y + dy;
      } else if (activeHandle.includes('bottom')) {
        newBottomRight.y = origBottomRight.y + dy;
      }

      // Ensure minimum size
      const minSize = 10;
      if (newBottomRight.x - newTopLeft.x >= minSize && newBottomRight.y - newTopLeft.y >= minSize) {
        viewport.cropRegion.points = [newTopLeft, newBottomRight];
      }
    }),

  endCropRegionDrag: () =>
    set((state) => {
      if (state.cropRegionEditState.isDragging) {
        state.isModified = true;
      }
      state.cropRegionEditState.activeHandle = null;
      state.cropRegionEditState.isDragging = false;
      state.cropRegionEditState.dragStart = null;
      state.cropRegionEditState.originalCropRegion = null;
    }),

  cancelCropRegionDrag: () =>
    set((state) => {
      const { viewportId, originalCropRegion } = state.cropRegionEditState;
      if (viewportId && originalCropRegion) {
        const viewport = getViewport(state, viewportId);
        if (viewport && viewport.cropRegion) {
          viewport.cropRegion = originalCropRegion;
        }
      }
      state.cropRegionEditState.activeHandle = null;
      state.cropRegionEditState.isDragging = false;
      state.cropRegionEditState.dragStart = null;
      state.cropRegionEditState.originalCropRegion = null;
    }),

  resetCropRegion: (viewportId) =>
    set((state) => {
      const viewport = getViewport(state, viewportId);
      if (!viewport) return;

      viewport.cropRegion = createDefaultCropRegion(state, viewport.drawingId);
      state.isModified = true;
    }),

  setCropRegion: (viewportId, cropRegion) =>
    set((state) => {
      const viewport = getViewport(state, viewportId);
      if (!viewport) return;

      viewport.cropRegion = cropRegion;
      state.isModified = true;
    }),

  // ============================================================================
  // Layer Override Actions
  // ============================================================================

  startLayerOverrideEdit: (viewportId) =>
    set((state) => {
      state.layerOverrideEditState.isEditing = true;
      state.layerOverrideEditState.viewportId = viewportId;
    }),

  endLayerOverrideEdit: () =>
    set((state) => {
      state.layerOverrideEditState.isEditing = false;
      state.layerOverrideEditState.viewportId = null;
    }),

  setLayerOverride: (viewportId, layerId, override) =>
    set((state) => {
      const viewport = getViewport(state, viewportId);
      if (!viewport) return;

      if (!viewport.layerOverrides) {
        viewport.layerOverrides = [];
      }

      const existingIndex = viewport.layerOverrides.findIndex((o) => o.layerId === layerId);
      if (existingIndex >= 0) {
        // Update existing override
        viewport.layerOverrides[existingIndex] = {
          ...viewport.layerOverrides[existingIndex],
          ...override,
        };
      } else {
        // Add new override
        viewport.layerOverrides.push({
          layerId,
          ...override,
        });
      }
      state.isModified = true;
    }),

  removeLayerOverride: (viewportId, layerId) =>
    set((state) => {
      const viewport = getViewport(state, viewportId);
      if (!viewport || !viewport.layerOverrides) return;

      viewport.layerOverrides = viewport.layerOverrides.filter((o) => o.layerId !== layerId);
      state.isModified = true;
    }),

  clearLayerOverrides: (viewportId) =>
    set((state) => {
      const viewport = getViewport(state, viewportId);
      if (!viewport) return;

      viewport.layerOverrides = [];
      state.isModified = true;
    }),
});
