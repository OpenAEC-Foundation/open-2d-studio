/**
 * DrawingRenderer - Orchestrates rendering for drawing mode
 */

import type { Shape, Viewport, SnapPoint, DrawingBoundary } from '../types';
import type { DrawingPreview, SelectionBox, TrackingLine, Point } from '../types';
import type { ParametricShape } from '../../../types/parametric';
import type { CustomHatchPattern } from '../../../types/hatch';
import { BaseRenderer } from '../core/BaseRenderer';
import { ShapeRenderer } from '../core/ShapeRenderer';
import { ParametricRenderer } from '../core/ParametricRenderer';
import { GridLayer } from '../layers/GridLayer';
import { SnapLayer } from '../layers/SnapLayer';
import { TrackingLayer } from '../layers/TrackingLayer';
import { SelectionLayer } from '../layers/SelectionLayer';
import { CursorLayer } from '../layers/CursorLayer';
import { HandleRenderer } from '../ui/HandleRenderer';
import { COLORS } from '../types';
import { generateProfileGeometry } from '../../../services/parametric/geometryGenerators';

export interface DrawingRenderOptions {
  shapes: Shape[];
  parametricShapes?: ParametricShape[];
  selectedShapeIds: string[];
  hoveredShapeId?: string | null;
  viewport: Viewport;
  drawingScale?: number;
  gridVisible: boolean;
  gridSize: number;
  drawingPreview?: DrawingPreview;
  currentStyle?: { strokeColor: string; strokeWidth: number };
  selectionBox?: SelectionBox | null;
  currentSnapPoint?: SnapPoint | null;
  currentTrackingLines?: TrackingLine[];
  trackingPoint?: Point | null;
  drawingBoundary?: DrawingBoundary | null;
  boundarySelected?: boolean;
  boundaryDragging?: boolean;
  whiteBackground?: boolean;
  hideSelectionHandles?: boolean;
  sectionPlacementPreview?: Point | null;
  pendingSection?: {
    profileType: import('../../../types/parametric').ProfileType;
    parameters: import('../../../types/parametric').ParameterValues;
    presetId?: string;
    rotation: number;
  } | null;
  /** Custom hatch patterns (user + project) for rendering */
  customPatterns?: {
    userPatterns: CustomHatchPattern[];
    projectPatterns: CustomHatchPattern[];
  };
  /** Live preview: temporarily apply this pattern to selected hatches on hover */
  previewPatternId?: string | null;
  /** 2D cursor position in world coordinates */
  cursor2D?: Point | null;
  /** Whether 2D cursor is visible */
  cursor2DVisible?: boolean;
  /** Whether to display actual line weights (false = all lines 1px thin) */
  showLineweight?: boolean;
}

// Legacy alias
export type DraftRenderOptions = DrawingRenderOptions;

export class DrawingRenderer extends BaseRenderer {
  private shapeRenderer: ShapeRenderer;
  private parametricRenderer: ParametricRenderer;
  private gridLayer: GridLayer;
  private snapLayer: SnapLayer;
  private trackingLayer: TrackingLayer;
  private selectionLayer: SelectionLayer;
  private cursorLayer: CursorLayer;
  private handleRenderer: HandleRenderer;

  constructor(ctx: CanvasRenderingContext2D, width: number, height: number, dpr: number) {
    super(ctx, width, height, dpr);
    this.shapeRenderer = new ShapeRenderer(ctx, width, height, dpr);
    this.parametricRenderer = new ParametricRenderer(ctx, width, height, dpr);
    this.gridLayer = new GridLayer(ctx, width, height, dpr);
    this.snapLayer = new SnapLayer(ctx, width, height, dpr);
    this.trackingLayer = new TrackingLayer(ctx, width, height, dpr);
    this.selectionLayer = new SelectionLayer(ctx, width, height, dpr);
    this.cursorLayer = new CursorLayer(ctx, width, height, dpr);
    this.handleRenderer = new HandleRenderer(ctx, width, height, dpr);
  }

  /**
   * Update dimensions when canvas resizes
   */
  updateSize(width: number, height: number): void {
    this.width = width;
    this.height = height;
    this.shapeRenderer = new ShapeRenderer(this.ctx, width, height, this.dpr);
    this.parametricRenderer = new ParametricRenderer(this.ctx, width, height, this.dpr);
    this.gridLayer = new GridLayer(this.ctx, width, height, this.dpr);
    this.snapLayer = new SnapLayer(this.ctx, width, height, this.dpr);
    this.trackingLayer = new TrackingLayer(this.ctx, width, height, this.dpr);
    this.selectionLayer = new SelectionLayer(this.ctx, width, height, this.dpr);
    this.cursorLayer = new CursorLayer(this.ctx, width, height, this.dpr);
    this.handleRenderer = new HandleRenderer(this.ctx, width, height, this.dpr);
  }

  /**
   * Render the drawing view
   */
  render(options: DrawingRenderOptions): void {
    const {
      shapes,
      selectedShapeIds,
      viewport,
      drawingScale,
      gridVisible,
      gridSize,
      drawingPreview,
      currentStyle,
      selectionBox,
      currentSnapPoint,
      currentTrackingLines,
      trackingPoint,
      drawingBoundary,
      boundarySelected,
      boundaryDragging,
      hoveredShapeId,
      whiteBackground,
      hideSelectionHandles,
      customPatterns,
    } = options;

    // Set drawing scale for annotation text scaling
    if (drawingScale !== undefined) {
      this.shapeRenderer.setDrawingScale(drawingScale);
    }

    const ctx = this.ctx;

    // Set custom patterns for hatch rendering
    if (customPatterns) {
      this.shapeRenderer.setCustomPatterns(customPatterns.userPatterns, customPatterns.projectPatterns);
    }

    // Set live preview pattern
    this.shapeRenderer.setPreviewPattern(options.previewPatternId || null, selectedShapeIds);

    // Set lineweight display mode
    this.shapeRenderer.setShowLineweight(options.showLineweight !== false);
    this.parametricRenderer.setShowLineweight(options.showLineweight !== false);

    // Clear canvas
    ctx.save();
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = whiteBackground ? '#ffffff' : COLORS.canvasBackground;
    ctx.fillRect(0, 0, this.width, this.height);

    // Apply viewport transform
    this.applyViewportTransform(viewport);

    // Draw grid and axes
    if (gridVisible) {
      this.gridLayer.drawGrid(viewport, gridSize, whiteBackground);
    } else {
      this.gridLayer.drawAxes(viewport);
    }

    // Draw drawing boundary (region)
    if (drawingBoundary) {
      this.handleRenderer.drawDrawingBoundary(
        drawingBoundary,
        viewport,
        boundarySelected || false,
        boundaryDragging || false
      );
    }

    // Build Set for O(1) selection lookups (avoids O(n²) with .includes() in loop)
    const selectedSet = new Set(selectedShapeIds);

    // Draw shapes
    for (const shape of shapes) {
      if (!shape.visible) continue;
      const isSelected = selectedSet.has(shape.id);
      const isHovered = hoveredShapeId === shape.id;
      this.shapeRenderer.drawShape(shape, isSelected, isHovered, whiteBackground, hideSelectionHandles);
    }

    // Draw parametric shapes
    const parametricShapes = options.parametricShapes;
    if (parametricShapes) {
      for (const shape of parametricShapes) {
        if (!shape.visible) continue;
        const isSelected = selectedSet.has(shape.id);
        const isHovered = hoveredShapeId === shape.id;
        this.parametricRenderer.drawParametricShape(shape, isSelected, isHovered, whiteBackground);
      }
    }

    // Draw preview shape while drawing
    if (drawingPreview) {
      this.shapeRenderer.drawPreview(drawingPreview, currentStyle, viewport, whiteBackground);
    }

    // Draw tracking lines
    if (currentTrackingLines && currentTrackingLines.length > 0) {
      this.trackingLayer.drawTrackingLines(currentTrackingLines, trackingPoint, viewport);
    }

    // Draw snap point indicator (skip grid snaps - they're not useful to show)
    if (currentSnapPoint && currentSnapPoint.type !== 'grid') {
      this.snapLayer.drawSnapIndicator(currentSnapPoint, viewport);
    }

    // Draw 2D cursor
    if (options.cursor2DVisible && options.cursor2D) {
      this.cursorLayer.drawCursor(options.cursor2D, viewport, whiteBackground);
    }

    // Draw section placement preview (pending section following mouse)
    const { sectionPlacementPreview, pendingSection } = options;
    if (sectionPlacementPreview && pendingSection) {
      this.drawSectionPlacementPreview(
        sectionPlacementPreview,
        pendingSection,
        whiteBackground
      );
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
    // Skip if snap label already shows the same type (avoid duplicate perpendicular/parallel labels)
    if (currentTrackingLines && currentTrackingLines.length > 0 && trackingPoint) {
      const trackingType = currentTrackingLines[0].type;
      const snapType = currentSnapPoint?.type;
      const isDuplicateLabel = (trackingType === 'perpendicular' && snapType === 'perpendicular') ||
                               (trackingType === 'parallel' && snapType === 'parallel');
      if (!isDuplicateLabel) {
        this.trackingLayer.drawTrackingLabel(currentTrackingLines, trackingPoint, viewport);
      }
    }
  }

  /**
   * Get boundary handle positions (delegates to HandleRenderer)
   */
  getBoundaryHandlePositions(boundary: DrawingBoundary) {
    return this.handleRenderer.getBoundaryHandlePositions(boundary);
  }

  /**
   * Draw section placement preview (ghost shape following mouse)
   */
  private drawSectionPlacementPreview(
    position: Point,
    pendingSection: NonNullable<DrawingRenderOptions['pendingSection']>,
    whiteBackground?: boolean
  ): void {
    const ctx = this.ctx;

    try {
      const geometry = generateProfileGeometry(
        pendingSection.profileType,
        pendingSection.parameters,
        position,
        pendingSection.rotation,
        1
      );

      if (geometry.outlines.length === 0) return;

      ctx.save();

      // Semi-transparent preview style
      ctx.globalAlpha = 0.6;
      ctx.strokeStyle = whiteBackground ? '#0066cc' : '#00d4ff';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([6, 3]);

      // Draw outlines
      for (let i = 0; i < geometry.outlines.length; i++) {
        const outline = geometry.outlines[i];
        const closed = geometry.closed[i];

        if (outline.length < 2) continue;

        ctx.beginPath();
        ctx.moveTo(outline[0].x, outline[0].y);

        for (let j = 1; j < outline.length; j++) {
          ctx.lineTo(outline[j].x, outline[j].y);
        }

        if (closed) {
          ctx.closePath();
          // Light fill for outer outline
          if (i === 0) {
            ctx.fillStyle = whiteBackground ? 'rgba(0, 102, 204, 0.1)' : 'rgba(0, 212, 255, 0.1)';
            ctx.fill();
          }
        }

        ctx.stroke();
      }

      // Draw insertion point crosshair
      ctx.setLineDash([]);
      ctx.strokeStyle = '#00ff00';
      ctx.lineWidth = 1;
      ctx.globalAlpha = 0.8;
      const crossSize = 10;
      ctx.beginPath();
      ctx.moveTo(position.x - crossSize, position.y);
      ctx.lineTo(position.x + crossSize, position.y);
      ctx.moveTo(position.x, position.y - crossSize);
      ctx.lineTo(position.x, position.y + crossSize);
      ctx.stroke();

      ctx.restore();
    } catch {
      // Silently ignore preview errors
    }
  }
}

// Legacy alias
export { DrawingRenderer as DraftRenderer };
