/**
 * View Slice - Manages viewport, zoom, pan, and canvas state
 */

import type { Viewport, Point } from './types';
import { DEFAULT_DRAWING_BOUNDARY } from './types';

// ============================================================================
// State Interface
// ============================================================================

export interface ViewState {
  viewport: Viewport;
  canvasSize: { width: number; height: number };
  mousePosition: Point;
  cursor2D: Point;
  cursor2DVisible: boolean;
  cursor2DPlaced: boolean;
}

// ============================================================================
// Actions Interface
// ============================================================================

export interface ViewActions {
  setViewport: (viewport: Partial<Viewport>) => void;
  zoomIn: () => void;
  zoomOut: () => void;
  zoomToFit: () => void;
  zoomToSelection: () => void;
  resetView: () => void;
  rotateView: (angleDeg: number) => void;
  setCanvasSize: (size: { width: number; height: number }) => void;
  setMousePosition: (point: Point) => void;
  setCursor2D: (point: Point) => void;
  resetCursor2D: () => void;
  setCursor2DToSelected: () => void;
  snapSelectionToCursor2D: () => void;
}

export type ViewSlice = ViewState & ViewActions;

// ============================================================================
// Initial State
// ============================================================================

// Calculate initial viewport to fit the default drawing boundary
const _cw = 1200, _ch = 800, _pad = 40;
const _b = DEFAULT_DRAWING_BOUNDARY;
const _initZoom = Math.min((_cw - _pad * 2) / _b.width, (_ch - _pad * 2) / _b.height);
const _initOffsetX = _cw / 2 - (_b.x + _b.width / 2) * _initZoom;
const _initOffsetY = _ch / 2 - (_b.y + _b.height / 2) * _initZoom;

export const initialViewState: ViewState = {
  viewport: { offsetX: _initOffsetX, offsetY: _initOffsetY, zoom: _initZoom },
  canvasSize: { width: _cw, height: _ch },
  mousePosition: { x: 0, y: 0 },
  cursor2D: { x: 0, y: 0 },
  cursor2DVisible: true,
  cursor2DPlaced: false,
};

// ============================================================================
// Slice Creator
// ============================================================================

import type { Shape } from '../../types/geometry';
import { getShapeBounds } from './types';
import { translateTransform, transformShape } from '../../engine/geometry/Modify';
import { screenToWorld } from '../../engine/geometry/GeometryUtils';

// Type for the full store that this slice needs access to
interface StoreWithModel {
  shapes: Shape[];
  selectedShapeIds: string[];
  updateShapes: (updates: { id: string; updates: Partial<Shape> }[]) => void;
}

type FullStore = ViewState & StoreWithModel;

export const createViewSlice = (
  set: (fn: (state: FullStore) => void) => void,
  get: () => FullStore
): ViewActions => ({
  setViewport: (viewport) =>
    set((state) => {
      state.viewport = { ...state.viewport, ...viewport };
    }),

  zoomIn: () =>
    set((state) => {
      state.viewport.zoom = Math.min(state.viewport.zoom * 1.2, 100);
    }),

  zoomOut: () =>
    set((state) => {
      state.viewport.zoom = Math.max(state.viewport.zoom / 1.2, 0.001);
    }),

  zoomToFit: () => {
    const store = get();
    const allShapes = store.shapes;

    // If no shapes, reset to default view
    if (allShapes.length === 0) {
      set((state) => {
        state.viewport = { offsetX: 0, offsetY: 0, zoom: 1 };
      });
      return;
    }

    // Calculate bounding box of all shapes
    let minX = Infinity, minY = Infinity;
    let maxX = -Infinity, maxY = -Infinity;

    for (const shape of allShapes) {
      const bounds = getShapeBounds(shape);
      if (bounds) {
        minX = Math.min(minX, bounds.minX);
        minY = Math.min(minY, bounds.minY);
        maxX = Math.max(maxX, bounds.maxX);
        maxY = Math.max(maxY, bounds.maxY);
      }
    }

    if (minX === Infinity) {
      set((state) => {
        state.viewport = { offsetX: 0, offsetY: 0, zoom: 1 };
      });
      return;
    }

    // Add padding
    const padding = 50;
    minX -= padding;
    minY -= padding;
    maxX += padding;
    maxY += padding;

    const boundsWidth = maxX - minX;
    const boundsHeight = maxY - minY;
    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;

    set((state) => {
      // Calculate zoom to fit bounds in canvas
      const zoomX = state.canvasSize.width / boundsWidth;
      const zoomY = state.canvasSize.height / boundsHeight;
      const zoom = Math.min(zoomX, zoomY, 10); // Cap at 10x zoom

      // Calculate offset to center all shapes
      state.viewport = {
        zoom,
        offsetX: state.canvasSize.width / 2 - centerX * zoom,
        offsetY: state.canvasSize.height / 2 - centerY * zoom,
      };
    });
  },

  zoomToSelection: () => {
    const store = get();
    if (store.selectedShapeIds.length === 0) return;

    // Get bounding box of selected shapes
    const idSet = new Set(store.selectedShapeIds);
    const selectedShapes = store.shapes.filter(s => idSet.has(s.id));
    if (selectedShapes.length === 0) return;

    let minX = Infinity, minY = Infinity;
    let maxX = -Infinity, maxY = -Infinity;

    for (const shape of selectedShapes) {
      const bounds = getShapeBounds(shape);
      if (bounds) {
        minX = Math.min(minX, bounds.minX);
        minY = Math.min(minY, bounds.minY);
        maxX = Math.max(maxX, bounds.maxX);
        maxY = Math.max(maxY, bounds.maxY);
      }
    }

    if (minX === Infinity) return;

    // Add padding
    const padding = 50;
    minX -= padding;
    minY -= padding;
    maxX += padding;
    maxY += padding;

    const boundsWidth = maxX - minX;
    const boundsHeight = maxY - minY;
    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;

    set((state) => {
      // Calculate zoom to fit bounds in canvas
      const zoomX = state.canvasSize.width / boundsWidth;
      const zoomY = state.canvasSize.height / boundsHeight;
      const zoom = Math.min(zoomX, zoomY, 10); // Cap at 10x zoom

      // Calculate offset to center the selection
      state.viewport = {
        zoom,
        offsetX: state.canvasSize.width / 2 - centerX * zoom,
        offsetY: state.canvasSize.height / 2 - centerY * zoom,
      };
    });
  },

  resetView: () =>
    set((state) => {
      state.viewport = { offsetX: 0, offsetY: 0, zoom: 1, rotation: 0 };
    }),

  rotateView: (angleDeg) => {
    const { viewport, canvasSize } = get();
    const cx = canvasSize.width / 2;
    const cy = canvasSize.height / 2;
    // World position at screen center before rotation
    const wc = screenToWorld(cx, cy, viewport);
    const newRotation = (viewport.rotation || 0) + angleDeg * Math.PI / 180;
    // Adjust offset so screen center stays at the same world position
    const cos = Math.cos(newRotation);
    const sin = Math.sin(newRotation);
    const newOffsetX = cx - wc.x * viewport.zoom * cos + wc.y * viewport.zoom * sin;
    const newOffsetY = cy - wc.x * viewport.zoom * sin - wc.y * viewport.zoom * cos;
    set((state) => {
      state.viewport.rotation = newRotation;
      state.viewport.offsetX = newOffsetX;
      state.viewport.offsetY = newOffsetY;
    });
  },

  setCanvasSize: (size) =>
    set((state) => {
      state.canvasSize = size;
    }),

  setMousePosition: (point) =>
    set((state) => {
      state.mousePosition = point;
    }),

  setCursor2D: (point) =>
    set((state) => {
      state.cursor2D = point;
      state.cursor2DVisible = true;
      state.cursor2DPlaced = true;
    }),

  resetCursor2D: () =>
    set((state) => {
      state.cursor2D = { x: 0, y: 0 };
      state.cursor2DVisible = true;
      state.cursor2DPlaced = false;
    }),

  setCursor2DToSelected: () => {
    const store = get();
    if (store.selectedShapeIds.length === 0) return;

    const idSet = new Set(store.selectedShapeIds);
    const selected = store.shapes.filter(s => idSet.has(s.id));
    if (selected.length === 0) return;

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const shape of selected) {
      const bounds = getShapeBounds(shape);
      if (bounds) {
        minX = Math.min(minX, bounds.minX);
        minY = Math.min(minY, bounds.minY);
        maxX = Math.max(maxX, bounds.maxX);
        maxY = Math.max(maxY, bounds.maxY);
      }
    }
    if (minX === Infinity) return;

    set((state) => {
      state.cursor2D = { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
      state.cursor2DVisible = true;
      state.cursor2DPlaced = true;
    });
  },

  snapSelectionToCursor2D: () => {
    const store = get();
    if (store.selectedShapeIds.length === 0) return;

    const idSet = new Set(store.selectedShapeIds);
    const selected = store.shapes.filter(s => idSet.has(s.id));
    if (selected.length === 0) return;

    // Calculate center of selection
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const shape of selected) {
      const bounds = getShapeBounds(shape);
      if (bounds) {
        minX = Math.min(minX, bounds.minX);
        minY = Math.min(minY, bounds.minY);
        maxX = Math.max(maxX, bounds.maxX);
        maxY = Math.max(maxY, bounds.maxY);
      }
    }
    if (minX === Infinity) return;

    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;
    const dx = store.cursor2D.x - centerX;
    const dy = store.cursor2D.y - centerY;

    if (dx === 0 && dy === 0) return;

    const transform = translateTransform(dx, dy);

    set((state) => {
      for (let i = 0; i < state.shapes.length; i++) {
        if (!idSet.has(state.shapes[i].id)) continue;
        // transformShape returns a new immutable shape; replace in-place for Immer
        const transformed = transformShape(state.shapes[i] as Shape, transform);
        state.shapes[i] = transformed as any;
      }
    });
  },
});
