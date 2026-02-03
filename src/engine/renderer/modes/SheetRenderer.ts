/**
 * SheetRenderer - Orchestrates rendering for sheet (paper space) mode
 *
 * Supports:
 * - Viewport crop regions
 * - Per-viewport layer overrides
 */

import type { Shape, Sheet, Drawing, Viewport, SheetViewport, Layer } from '../types';
import type { ParametricShape } from '../../../types/parametric';
import type { CustomHatchPattern } from '../../../types/hatch';
import { BaseRenderer } from '../core/BaseRenderer';
import { ViewportRenderer } from '../sheet/ViewportRenderer';
import { TitleBlockRenderer } from '../sheet/TitleBlockRenderer';
import { AnnotationRenderer } from '../sheet/AnnotationRenderer';
import { HandleRenderer, ViewportHandleType } from '../ui/HandleRenderer';
import { PAPER_SIZES, MM_TO_PIXELS, COLORS } from '../types';
import { loadCustomSVGTemplates } from '../../../services/svgTitleBlockService';

/** Point type for placement preview */
interface Point {
  x: number;
  y: number;
}

/** Drawing placement preview info */
export interface PlacementPreviewInfo {
  /** Whether placement mode is active */
  isPlacing: boolean;
  /** ID of drawing being placed */
  placingDrawingId: string | null;
  /** Preview position on sheet (in mm) */
  previewPosition: Point | null;
  /** Scale for the new viewport */
  placementScale: number;
}

export interface SheetRenderOptions {
  sheet: Sheet;
  drawings: Drawing[];
  shapes: Shape[]; // All shapes from all drawings
  parametricShapes?: ParametricShape[]; // All parametric shapes from all drawings
  layers: Layer[]; // All layers for filtering
  viewport: Viewport; // Pan/zoom for the sheet view
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

export class SheetRenderer extends BaseRenderer {
  private viewportRenderer: ViewportRenderer;
  private titleBlockRenderer: TitleBlockRenderer;
  private annotationRenderer: AnnotationRenderer;
  private handleRenderer: HandleRenderer;

  constructor(ctx: CanvasRenderingContext2D, width: number, height: number, dpr: number) {
    super(ctx, width, height, dpr);
    this.viewportRenderer = new ViewportRenderer(ctx, width, height, dpr);
    this.titleBlockRenderer = new TitleBlockRenderer(ctx, width, height, dpr);
    this.annotationRenderer = new AnnotationRenderer(ctx, width, height, dpr);
    this.handleRenderer = new HandleRenderer(ctx, width, height, dpr);
  }

  /**
   * Update dimensions when canvas resizes
   */
  updateSize(width: number, height: number): void {
    this.width = width;
    this.height = height;
    this.viewportRenderer = new ViewportRenderer(this.ctx, width, height, this.dpr);
    this.titleBlockRenderer = new TitleBlockRenderer(this.ctx, width, height, this.dpr);
    this.annotationRenderer = new AnnotationRenderer(this.ctx, width, height, this.dpr);
    this.handleRenderer = new HandleRenderer(this.ctx, width, height, this.dpr);
  }

  /**
   * Render a sheet (Paper Space) with viewports showing drawings
   */
  render(options: SheetRenderOptions): void {
    const {
      sheet,
      drawings,
      shapes,
      parametricShapes,
      layers,
      viewport,
      selectedViewportId,
      drawingViewports,
      cropRegionEditing,
      cropRegionViewportId,
      selectedAnnotationIds = [],
      placementPreview,
      customPatterns,
    } = options;
    const ctx = this.ctx;

    // Clear canvas with dark background
    ctx.save();
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = COLORS.sheetBackground;
    ctx.fillRect(0, 0, this.width, this.height);

    // Apply viewport transform for sheet pan/zoom
    ctx.translate(viewport.offsetX, viewport.offsetY);
    ctx.scale(viewport.zoom, viewport.zoom);

    // Get paper dimensions
    const paperDims = this.getPaperDimensions(sheet);
    const paperWidth = paperDims.width * MM_TO_PIXELS;
    const paperHeight = paperDims.height * MM_TO_PIXELS;

    // Check if title block uses a full-page SVG template
    const svgTemplateId = (sheet.titleBlock as { svgTemplateId?: string }).svgTemplateId;
    let isFullPageTemplate = false;
    if (svgTemplateId) {
      const svgTemplates = loadCustomSVGTemplates();
      const svgTemplate = svgTemplates.find(t => t.id === svgTemplateId);
      if (svgTemplate?.isFullPage) {
        isFullPageTemplate = true;
      }
    }

    // Draw paper shadow
    ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
    ctx.fillRect(8, 8, paperWidth, paperHeight);

    // Always draw white paper background first
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, paperWidth, paperHeight);

    if (isFullPageTemplate) {
      // For full-page templates, draw the SVG template on top of white background
      this.titleBlockRenderer.drawTitleBlock(sheet.titleBlock, paperWidth, paperHeight);
    } else {
      // Draw paper border (non-full-page templates only - full-page SVG has its own border)
      ctx.strokeStyle = '#888888';
      ctx.lineWidth = 1 / viewport.zoom;
      ctx.strokeRect(0, 0, paperWidth, paperHeight);
    }

    // Draw viewports
    for (const vp of sheet.viewports) {
      if (!vp.visible) continue;
      const isSelected = selectedViewportId === vp.id;
      const isCropRegionEditing = cropRegionEditing && cropRegionViewportId === vp.id;

      this.viewportRenderer.drawSheetViewport(
        vp,
        drawings,
        shapes,
        drawingViewports,
        isSelected,
        {
          layers,
          parametricShapes,
          isCropRegionEditing,
          sheetZoom: viewport.zoom,
          customPatterns,
        }
      );
    }

    // Draw placement preview if active
    if (placementPreview?.isPlacing && placementPreview.previewPosition && placementPreview.placingDrawingId) {
      this.drawPlacementPreview(placementPreview, drawings, viewport.zoom);
    }

    // Draw sheet annotations (text, dimensions, leaders, etc.)
    if (sheet.annotations && sheet.annotations.length > 0) {
      this.annotationRenderer.renderAnnotations(sheet.annotations, {
        selectedIds: selectedAnnotationIds,
        showHandles: true,
        sheetZoom: viewport.zoom,
      });
    }

    // Draw title block (skip if full-page template - already drawn as background)
    if (sheet.titleBlock.visible && !isFullPageTemplate) {
      this.titleBlockRenderer.drawTitleBlock(sheet.titleBlock, paperWidth, paperHeight);
    }

    ctx.restore();
  }

  /**
   * Draw placement preview for drawing being dragged onto sheet
   */
  private drawPlacementPreview(
    preview: PlacementPreviewInfo,
    drawings: Drawing[],
    sheetZoom: number
  ): void {
    const ctx = this.ctx;
    const { placingDrawingId, previewPosition, placementScale } = preview;

    if (!previewPosition || !placingDrawingId) return;

    // Find the drawing being placed
    const drawing = drawings.find(d => d.id === placingDrawingId);
    if (!drawing) return;

    // Calculate viewport size from drawing boundary
    const boundary = drawing.boundary;
    const width = boundary.width * placementScale * MM_TO_PIXELS;
    const height = boundary.height * placementScale * MM_TO_PIXELS;

    // Calculate top-left position (preview is centered on cursor)
    const x = (previewPosition.x * MM_TO_PIXELS) - width / 2;
    const y = (previewPosition.y * MM_TO_PIXELS) - height / 2;

    // Draw semi-transparent preview rectangle
    ctx.save();

    // Fill with light blue
    ctx.fillStyle = 'rgba(59, 130, 246, 0.15)';
    ctx.fillRect(x, y, width, height);

    // Dashed border
    ctx.strokeStyle = COLORS.selection;
    ctx.lineWidth = 2 / sheetZoom;
    ctx.setLineDash([6 / sheetZoom, 4 / sheetZoom]);
    ctx.strokeRect(x, y, width, height);

    // Draw drawing name label
    ctx.setLineDash([]);
    const fontSize = 12 / sheetZoom;
    ctx.font = `${fontSize}px Arial`;
    ctx.fillStyle = COLORS.selection;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.fillText(drawing.name, x + width / 2, y - 4 / sheetZoom);

    // Draw scale label
    const scaleLabel = this.formatScale(placementScale);
    ctx.textBaseline = 'top';
    ctx.fillText(scaleLabel, x + width / 2, y + height + 4 / sheetZoom);

    ctx.restore();
  }

  /**
   * Format scale as human-readable string (e.g., "1:100")
   */
  private formatScale(scale: number): string {
    if (scale >= 1) {
      return `${scale}:1`;
    }
    const denom = Math.round(1 / scale);
    return `1:${denom}`;
  }

  /**
   * Get paper dimensions in mm, accounting for orientation
   */
  private getPaperDimensions(sheet: Sheet): { width: number; height: number } {
    if (sheet.paperSize === 'Custom') {
      return {
        width: sheet.customWidth || 210,
        height: sheet.customHeight || 297,
      };
    }

    const baseDims = PAPER_SIZES[sheet.paperSize];
    if (sheet.orientation === 'landscape') {
      return { width: baseDims.height, height: baseDims.width };
    }
    return baseDims;
  }

  /**
   * Get viewport handle positions for hit testing
   */
  getViewportHandlePositions(vp: SheetViewport) {
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
}
