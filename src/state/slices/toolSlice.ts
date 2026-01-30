/**
 * Tool Slice - Manages active tool, drawing modes, and style
 */

import type { ToolType, ShapeStyle, Point, DrawingPreview, DefaultTextStyle } from './types';
import type { DimensionType } from '../../types/dimension';
import { defaultStyle } from './types';

// ============================================================================
// State Interface
// ============================================================================

export interface ToolState {
  activeTool: ToolType;
  circleMode: 'center-radius' | 'center-diameter' | '2point' | '3point';
  rectangleMode: 'corner' | 'center' | '3point';
  arcMode: '3point' | 'center-start-end';
  ellipseMode: 'center-axes' | 'corner';
  dimensionMode: DimensionType;
  currentStyle: ShapeStyle;
  isDrawing: boolean;
  drawingPreview: DrawingPreview;
  drawingPoints: Point[];  // Points clicked so far in current drawing session

  // Text tool state
  textEditingId: string | null;     // ID of text shape being edited
  defaultTextStyle: DefaultTextStyle;
}

// ============================================================================
// Actions Interface
// ============================================================================

export interface ToolActions {
  setActiveTool: (tool: ToolType) => void;
  setCircleMode: (mode: 'center-radius' | 'center-diameter' | '2point' | '3point') => void;
  setRectangleMode: (mode: 'corner' | 'center' | '3point') => void;
  setArcMode: (mode: '3point' | 'center-start-end') => void;
  setEllipseMode: (mode: 'center-axes' | 'corner') => void;
  setDimensionMode: (mode: DimensionType) => void;
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
  updateDefaultTextStyle: (style: Partial<DefaultTextStyle>) => void;
}

export type ToolSlice = ToolState & ToolActions;

// ============================================================================
// Initial State
// ============================================================================

export const initialToolState: ToolState = {
  activeTool: 'select',
  circleMode: 'center-radius',
  rectangleMode: 'corner',
  arcMode: '3point',
  ellipseMode: 'center-axes',
  dimensionMode: 'aligned',
  currentStyle: defaultStyle,
  isDrawing: false,
  drawingPreview: null,
  drawingPoints: [],

  // Text tool state
  textEditingId: null,
  defaultTextStyle: {
    fontFamily: 'Arial',
    fontSize: 10,
    bold: false,
    italic: false,
    underline: false,
    alignment: 'left',
    color: '#ffffff',
  },
};

// ============================================================================
// Slice Creator
// ============================================================================

export const createToolSlice = (
  set: (fn: (state: ToolState) => void) => void,
  _get: () => ToolState
): ToolActions => ({
  setActiveTool: (tool) =>
    set((state) => {
      state.activeTool = tool;
      state.isDrawing = false;
      state.drawingPreview = null;
      state.drawingPoints = [];
    }),

  setCircleMode: (mode) =>
    set((state) => {
      state.circleMode = mode;
      // Reset drawing state when changing mode
      state.isDrawing = false;
      state.drawingPreview = null;
      state.drawingPoints = [];
    }),

  setRectangleMode: (mode) =>
    set((state) => {
      state.rectangleMode = mode;
      // Reset drawing state when changing mode
      state.isDrawing = false;
      state.drawingPreview = null;
      state.drawingPoints = [];
    }),

  setArcMode: (mode) =>
    set((state) => {
      state.arcMode = mode;
      // Reset drawing state when changing mode
      state.isDrawing = false;
      state.drawingPreview = null;
      state.drawingPoints = [];
    }),

  setEllipseMode: (mode) =>
    set((state) => {
      state.ellipseMode = mode;
      // Reset drawing state when changing mode
      state.isDrawing = false;
      state.drawingPreview = null;
      state.drawingPoints = [];
    }),

  setDimensionMode: (mode) =>
    set((state) => {
      state.dimensionMode = mode;
      // Reset drawing state when changing mode
      state.isDrawing = false;
      state.drawingPreview = null;
      state.drawingPoints = [];
    }),

  setCurrentStyle: (style) =>
    set((state) => {
      state.currentStyle = { ...state.currentStyle, ...style };
    }),

  setIsDrawing: (isDrawing) =>
    set((state) => {
      state.isDrawing = isDrawing;
    }),

  setDrawingPreview: (preview) =>
    set((state) => {
      state.drawingPreview = preview;
    }),

  addDrawingPoint: (point) =>
    set((state) => {
      state.drawingPoints.push(point);
      state.isDrawing = true;
    }),

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
      // This will be handled in the canvas events to create a closing line
      // Just mark that we want to close
      state.drawingPoints = [];
      state.isDrawing = false;
      state.drawingPreview = null;
    }),

  // Text editing actions
  startTextEditing: (shapeId) =>
    set((state) => {
      state.textEditingId = shapeId;
    }),

  endTextEditing: () =>
    set((state) => {
      state.textEditingId = null;
    }),

  updateDefaultTextStyle: (style) =>
    set((state) => {
      state.defaultTextStyle = { ...state.defaultTextStyle, ...style };
    }),
});
