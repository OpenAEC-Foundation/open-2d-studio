/**
 * DraftRenderer - Orchestrates rendering for draft (model space) mode
 */

import type { Shape, Viewport, SnapPoint, DraftBoundary } from '../types';
import type { DrawingPreview, SelectionBox, TrackingLine, Point } from '../types';
import { BaseRenderer } from '../core/BaseRenderer';
import { ShapeRenderer } from '../core/ShapeRenderer';
import { GridLayer } from '../layers/GridLayer';
import { SnapLayer } from '../layers/SnapLayer';
import { TrackingLayer } from '../layers/TrackingLayer';
import { SelectionLayer } from '../layers/SelectionLayer';
import { HandleRenderer } from '../ui/HandleRenderer';
import { COLORS } from '../types';

export interface DraftRenderOptions {
  shapes: Shape[];
  selectedShapeIds: string[];
  viewport: Viewport;
  gridVisible: boolean;
  gridSize: number;
  drawingPreview?: DrawingPreview;
  currentStyle?: { strokeColor: string; strokeWidth: number };
  selectionBox?: SelectionBox | null;
  commandPreviewShapes?: Shape[];
  currentSnapPoint?: SnapPoint | null;
  currentTrackingLines?: TrackingLine[];
  trackingPoint?: Point | null;
  draftBoundary?: DraftBoundary | null;
  boundarySelected?: boolean;
  boundaryDragging?: boolean;
}

export class DraftRenderer extends BaseRenderer {
  private shapeRenderer: ShapeRenderer;
  private gridLayer: GridLayer;
  private snapLayer: SnapLayer;
  private trackingLayer: TrackingLayer;
  private selectionLayer: SelectionLayer;
  private handleRenderer: HandleRenderer;

  constructor(ctx: CanvasRenderingContext2D, width: number, height: number, dpr: number) {
    super(ctx, width, height, dpr);
    this.shapeRenderer = new ShapeRenderer(ctx, width, height, dpr);
    this.gridLayer = new GridLayer(ctx, width, height, dpr);
    this.snapLayer = new SnapLayer(ctx, width, height, dpr);
    this.trackingLayer = new TrackingLayer(ctx, width, height, dpr);
    this.selectionLayer = new SelectionLayer(ctx, width, height, dpr);
    this.handleRenderer = new HandleRenderer(ctx, width, height, dpr);
  }

  /**
   * Update dimensions when canvas resizes
   */
  updateSize(width: number, height: number): void {
    this.width = width;
    this.height = height;
    this.shapeRenderer = new ShapeRenderer(this.ctx, width, height, this.dpr);
    this.gridLayer = new GridLayer(this.ctx, width, height, this.dpr);
    this.snapLayer = new SnapLayer(this.ctx, width, height, this.dpr);
    this.trackingLayer = new TrackingLayer(this.ctx, width, height, this.dpr);
    this.selectionLayer = new SelectionLayer(this.ctx, width, height, this.dpr);
    this.handleRenderer = new HandleRenderer(this.ctx, width, height, this.dpr);
  }

  /**
   * Render the draft view
   */
  render(options: DraftRenderOptions): void {
    const {
      shapes,
      selectedShapeIds,
      viewport,
      gridVisible,
      gridSize,
      drawingPreview,
      currentStyle,
      selectionBox,
      commandPreviewShapes,
      currentSnapPoint,
      currentTrackingLines,
      trackingPoint,
      draftBoundary,
      boundarySelected,
      boundaryDragging
    } = options;

    const ctx = this.ctx;

    // Clear canvas
    ctx.save();
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = COLORS.canvasBackground;
    ctx.fillRect(0, 0, this.width, this.height);

    // Apply viewport transform
    this.applyViewportTransform(viewport);

    // Draw grid
    if (gridVisible) {
      this.gridLayer.drawGrid(viewport, gridSize);
    }

    // Draw draft boundary (region)
    if (draftBoundary) {
      this.handleRenderer.drawDraftBoundary(
        draftBoundary,
        viewport,
        boundarySelected || false,
        boundaryDragging || false
      );
    }

    // Draw shapes
    for (const shape of shapes) {
      if (!shape.visible) continue;
      const isSelected = selectedShapeIds.includes(shape.id);
      this.shapeRenderer.drawShape(shape, isSelected);
    }

    // Draw command preview shapes (move/copy preview)
    if (commandPreviewShapes && commandPreviewShapes.length > 0) {
      this.shapeRenderer.drawCommandPreviewShapes(commandPreviewShapes);
    }

    // Draw preview shape while drawing
    if (drawingPreview) {
      this.shapeRenderer.drawPreview(drawingPreview, currentStyle, viewport);
    }

    // Draw tracking lines
    if (currentTrackingLines && currentTrackingLines.length > 0) {
      this.trackingLayer.drawTrackingLines(currentTrackingLines, trackingPoint, viewport);
    }

    // Draw snap point indicator (skip grid snaps - they're not useful to show)
    if (currentSnapPoint && currentSnapPoint.type !== 'grid') {
      this.snapLayer.drawSnapIndicator(currentSnapPoint, viewport);
    }

    ctx.restore();

    // Draw selection box (in screen coordinates, after viewport transform is restored)
    if (selectionBox) {
      this.selectionLayer.drawSelectionBox(selectionBox);
    }

    // Draw snap point label (in screen coordinates, skip grid snaps)
    if (currentSnapPoint && currentSnapPoint.type !== 'grid') {
      this.snapLayer.drawSnapLabel(currentSnapPoint, viewport);
    }

    // Draw tracking label (in screen coordinates)
    if (currentTrackingLines && currentTrackingLines.length > 0 && trackingPoint) {
      this.trackingLayer.drawTrackingLabel(currentTrackingLines, trackingPoint, viewport);
    }
  }

  /**
   * Get boundary handle positions (delegates to HandleRenderer)
   */
  getBoundaryHandlePositions(boundary: DraftBoundary) {
    return this.handleRenderer.getBoundaryHandlePositions(boundary);
  }
}
