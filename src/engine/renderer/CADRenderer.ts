/**
 * CADRenderer - Main renderer facade
 *
 * This class provides a unified interface for rendering both draft (model space)
 * and sheet (paper space) modes. It delegates to specialized renderers for
 * different aspects of the rendering.
 *
 * The modular structure allows for:
 * - Better code organization and maintainability
 * - Easier testing of individual components
 * - Clear separation of concerns
 * - Future extensibility
 */

import type { Shape, Viewport, SnapPoint, DrawingBoundary, Sheet, Drawing, SheetViewport, Layer } from '../../types/geometry';
import type { DrawingPreview, SelectionBox } from '../../state/appStore';
import type { TrackingLine } from '../geometry/Tracking';
import type { IPoint } from '../geometry/Point';
import type { ParametricShape } from '../../types/parametric';
import type { CustomHatchPattern } from '../../types/hatch';

import { DrawingRenderer, DrawingRenderOptions } from './modes/DrawingRenderer';
import { SheetRenderer, SheetRenderOptions, PlacementPreviewInfo } from './modes/SheetRenderer';
import { HandleRenderer, BoundaryHandleType, ViewportHandleType } from './ui/HandleRenderer';

// Re-export handle types for external use
export type { BoundaryHandleType, ViewportHandleType };

// Interface for drawing mode rendering
interface RenderOptions {
  shapes: Shape[];
  parametricShapes?: ParametricShape[];
  selectedShapeIds: string[];
  hoveredShapeId?: string | null;
  viewport: Viewport;
  gridVisible: boolean;
  gridSize: number;
  drawingPreview?: DrawingPreview;
  currentStyle?: { strokeColor: string; strokeWidth: number };
  selectionBox?: SelectionBox | null;
  currentSnapPoint?: SnapPoint | null;
  currentTrackingLines?: TrackingLine[];
  trackingPoint?: IPoint | null;
  layers?: unknown[]; // Kept for backward compatibility (currently unused)
  drawingBoundary?: DrawingBoundary | null;
  boundarySelected?: boolean;
  boundaryDragging?: boolean;
  whiteBackground?: boolean;
  hideSelectionHandles?: boolean;
  sectionPlacementPreview?: IPoint | null;
  pendingSection?: {
    profileType: import('../../types/parametric').ProfileType;
    parameters: import('../../types/parametric').ParameterValues;
    presetId?: string;
    rotation: number;
  } | null;
  /** Custom hatch patterns for rendering */
  customPatterns?: {
    userPatterns: CustomHatchPattern[];
    projectPatterns: CustomHatchPattern[];
  };
}

// Interface for sheet mode rendering (supports both new and legacy property names)
interface SheetModeRenderOptions {
  sheet: Sheet;
  drawings: Drawing[];
  shapes: Shape[];
  parametricShapes?: ParametricShape[];
  layers: Layer[];
  viewport: Viewport;
  selectedViewportId?: string | null;
  viewportDragging?: boolean;
  drawingViewports: Record<string, Viewport>;
  /** Whether crop region editing mode is active */
  cropRegionEditing?: boolean;
  /** ID of viewport being edited for crop region */
  cropRegionViewportId?: string | null;
  /** IDs of selected annotations */
  selectedAnnotationIds?: string[];
  /** Drawing placement preview info */
  placementPreview?: PlacementPreviewInfo;
  /** Custom hatch patterns for rendering */
  customPatterns?: {
    userPatterns: CustomHatchPattern[];
    projectPatterns: CustomHatchPattern[];
  };
}

export class CADRenderer {
  private ctx: CanvasRenderingContext2D;
  private dpr: number = 1;

  // Specialized renderers
  private drawingRenderer: DrawingRenderer;
  private sheetRenderer: SheetRenderer;
  private handleRenderer: HandleRenderer;

  constructor(canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Could not get 2D context');
    }
    this.ctx = ctx;
    this.dpr = window.devicePixelRatio || 1;

    // Initialize with default dimensions (will be updated on resize)
    this.drawingRenderer = new DrawingRenderer(ctx, 0, 0, this.dpr);
    this.sheetRenderer = new SheetRenderer(ctx, 0, 0, this.dpr);
    this.handleRenderer = new HandleRenderer(ctx, 0, 0, this.dpr);
  }

  resize(width: number, height: number): void {
    this.ctx.scale(this.dpr, this.dpr);

    // Update all renderers with new dimensions
    this.drawingRenderer.updateSize(width, height);
    this.sheetRenderer.updateSize(width, height);
  }

  /**
   * Render drawing (model space) view
   */
  render(options: RenderOptions): void {
    const drawingOptions: DrawingRenderOptions = {
      shapes: options.shapes,
      parametricShapes: options.parametricShapes,
      selectedShapeIds: options.selectedShapeIds,
      hoveredShapeId: options.hoveredShapeId,
      viewport: options.viewport,
      gridVisible: options.gridVisible,
      gridSize: options.gridSize,
      drawingPreview: options.drawingPreview,
      currentStyle: options.currentStyle,
      selectionBox: options.selectionBox,
      currentSnapPoint: options.currentSnapPoint,
      currentTrackingLines: options.currentTrackingLines,
      trackingPoint: options.trackingPoint,
      drawingBoundary: options.drawingBoundary,
      boundarySelected: options.boundarySelected,
      boundaryDragging: options.boundaryDragging,
      whiteBackground: options.whiteBackground,
      hideSelectionHandles: options.hideSelectionHandles,
      sectionPlacementPreview: options.sectionPlacementPreview,
      pendingSection: options.pendingSection,
      customPatterns: options.customPatterns,
    };

    this.drawingRenderer.render(drawingOptions);
  }

  /**
   * Render sheet (paper space) view
   */
  renderSheet(options: SheetModeRenderOptions): void {
    const sheetOptions: SheetRenderOptions = {
      sheet: options.sheet,
      drawings: options.drawings,
      shapes: options.shapes,
      parametricShapes: options.parametricShapes,
      layers: options.layers,
      viewport: options.viewport,
      selectedViewportId: options.selectedViewportId,
      viewportDragging: options.viewportDragging,
      drawingViewports: options.drawingViewports,
      cropRegionEditing: options.cropRegionEditing,
      cropRegionViewportId: options.cropRegionViewportId,
      selectedAnnotationIds: options.selectedAnnotationIds,
      placementPreview: options.placementPreview,
      customPatterns: options.customPatterns,
    };

    this.sheetRenderer.render(sheetOptions);
  }

  /**
   * Get handle positions for boundary hit testing
   */
  getBoundaryHandlePositions(boundary: DrawingBoundary): { type: BoundaryHandleType; x: number; y: number }[] {
    return this.handleRenderer.getBoundaryHandlePositions(boundary);
  }

  /**
   * Get viewport handle positions for hit testing
   */
  getViewportHandlePositions(vp: SheetViewport): Record<ViewportHandleType, { x: number; y: number }> {
    return this.handleRenderer.getViewportHandlePositions(vp);
  }

  /**
   * Check if a point is inside a viewport
   */
  isPointInViewport(point: { x: number; y: number }, vp: SheetViewport): boolean {
    return this.handleRenderer.isPointInViewport(point, vp);
  }

  /**
   * Find which handle (if any) is at the given point
   */
  findViewportHandleAtPoint(
    point: { x: number; y: number },
    vp: SheetViewport,
    tolerance: number = 5
  ): ViewportHandleType | null {
    return this.handleRenderer.findViewportHandleAtPoint(point, vp, tolerance);
  }

  dispose(): void {
    // Cleanup if needed
  }
}
