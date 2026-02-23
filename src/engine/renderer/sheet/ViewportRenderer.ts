/**
 * ViewportRenderer - Renders sheet viewports showing drafts
 *
 * Supports:
 * - Crop region clipping
 * - Per-viewport layer visibility overrides
 */

import type { Shape, Drawing, SheetViewport, Viewport, Layer, CropRegion, ViewportLayerOverride } from '../types';
import type { WallType, WallSystemType } from '../../../types/geometry';
import type { ParametricShape, ProfileParametricShape } from '../../../types/parametric';
import type { CustomHatchPattern, MaterialHatchSettings } from '../../../types/hatch';
import { BaseRenderer } from '../core/BaseRenderer';
import { ShapeRenderer } from '../core/ShapeRenderer';
import { HandleRenderer } from '../ui/HandleRenderer';
import { MM_TO_PIXELS, COLORS } from '../types';
import { CAD_DEFAULT_FONT } from '../../../constants/cadDefaults';
import { PROFILE_TEMPLATES } from '../../../services/parametric/profileTemplates';
import { isShapeInHiddenCategory } from '../../../utils/ifcCategoryUtils';

export interface ViewportRenderOptions {
  /** All layers for filtering */
  layers: Layer[];
  /** Parametric shapes to render */
  parametricShapes?: ParametricShape[];
  /** Whether crop region editing is active for this viewport */
  isCropRegionEditing?: boolean;
  /** Current sheet viewport zoom level for proper handle sizing */
  sheetZoom?: number;
  /** Custom hatch patterns for rendering */
  customPatterns?: {
    userPatterns: CustomHatchPattern[];
    projectPatterns: CustomHatchPattern[];
  };
  /** Total number of viewports on the sheet (for "whenMultiple" title visibility) */
  totalViewportsOnSheet?: number;
  /** Whether to display actual line weights (false = all lines 1px thin) */
  showLineweight?: boolean;
  /** Wall types for material-based hatch lookup */
  wallTypes?: WallType[];
  /** Wall system types (multi-layered assemblies) */
  wallSystemTypes?: WallSystemType[];
  /** Material hatch settings from Drawing Standards */
  materialHatchSettings?: MaterialHatchSettings;
  /** Gridline extension distance in mm */
  gridlineExtension?: number;
  /** Sea level datum: peil=0 elevation relative to NAP in meters */
  seaLevelDatum?: number;
  /** Hidden IFC categories — shapes in these categories are not rendered */
  hiddenIfcCategories?: string[];
}

export class ViewportRenderer extends BaseRenderer {
  private shapeRenderer: ShapeRenderer;
  private handleRenderer: HandleRenderer;
  private _showLineweight: boolean = true;

  constructor(ctx: CanvasRenderingContext2D, width: number, height: number, dpr: number) {
    super(ctx, width, height, dpr);
    this.shapeRenderer = new ShapeRenderer(ctx, width, height, dpr);
    this.handleRenderer = new HandleRenderer(ctx, width, height, dpr);
  }

  /**
   * Update dimensions when canvas resizes
   */
  updateSize(width: number, height: number): void {
    this.width = width;
    this.height = height;
    this.shapeRenderer = new ShapeRenderer(this.ctx, width, height, this.dpr);
    this.handleRenderer = new HandleRenderer(this.ctx, width, height, this.dpr);
  }

  /**
   * Filter shapes based on layer overrides
   */
  private filterShapesByLayerOverrides(
    shapes: Shape[],
    layers: Layer[],
    layerOverrides?: ViewportLayerOverride[]
  ): Shape[] {
    return shapes.filter(shape => {
      // First check if layer exists and is visible globally
      const layer = layers.find(l => l.id === shape.layerId);
      if (!layer || !layer.visible) return false;

      // Then check for viewport-specific override
      if (layerOverrides) {
        const override = layerOverrides.find(o => o.layerId === shape.layerId);
        if (override && override.visible !== undefined) {
          return override.visible;
        }
      }

      // Default to layer's global visibility
      return true;
    });
  }

  /**
   * Filter parametric shapes based on layer overrides
   */
  private filterParametricByLayerOverrides(
    shapes: ParametricShape[],
    layers: Layer[],
    layerOverrides?: ViewportLayerOverride[]
  ): ParametricShape[] {
    return shapes.filter(shape => {
      // First check if layer exists and is visible globally
      const layer = layers.find(l => l.id === shape.layerId);
      if (!layer || !layer.visible) return false;

      // Then check for viewport-specific override
      if (layerOverrides) {
        const override = layerOverrides.find(o => o.layerId === shape.layerId);
        if (override && override.visible !== undefined) {
          return override.visible;
        }
      }

      // Default to layer's global visibility
      return true;
    });
  }

  /**
   * Get the clipping region for a viewport
   * Returns crop region points if enabled, otherwise drawing boundary
   */
  private getClipRegion(
    vp: SheetViewport,
    drawing: Drawing | undefined
  ): { x: number; y: number; width: number; height: number } | null {
    // Check for enabled crop region
    if (vp.cropRegion && vp.cropRegion.enabled && vp.cropRegion.type === 'rectangular') {
      const [topLeft, bottomRight] = vp.cropRegion.points;
      return {
        x: topLeft.x,
        y: topLeft.y,
        width: bottomRight.x - topLeft.x,
        height: bottomRight.y - topLeft.y,
      };
    }

    // Fall back to drawing boundary
    if (drawing?.boundary) {
      return drawing.boundary;
    }

    return null;
  }

  /**
   * Draw crop region indicator and handles when editing
   */
  private drawCropRegionIndicator(
    cropRegion: CropRegion,
    scale: number,
    showHandles: boolean
  ): void {
    const ctx = this.ctx;

    if (cropRegion.type !== 'rectangular') return;

    const [topLeft, bottomRight] = cropRegion.points;
    const x = topLeft.x;
    const y = topLeft.y;
    const width = bottomRight.x - topLeft.x;
    const height = bottomRight.y - topLeft.y;

    // Draw crop region border
    ctx.strokeStyle = cropRegion.enabled ? '#00bcd4' : '#888888';
    ctx.lineWidth = 2 / (scale * MM_TO_PIXELS);
    ctx.setLineDash([8 / (scale * MM_TO_PIXELS), 4 / (scale * MM_TO_PIXELS)]);
    ctx.beginPath();
    ctx.rect(x, y, width, height);
    ctx.stroke();
    ctx.setLineDash([]);

    // Draw handles if editing
    if (showHandles) {
      const handleSize = 8 / (scale * MM_TO_PIXELS);
      const handlePositions = [
        { type: 'top-left', x: x, y: y },
        { type: 'top', x: x + width / 2, y: y },
        { type: 'top-right', x: x + width, y: y },
        { type: 'left', x: x, y: y + height / 2 },
        { type: 'right', x: x + width, y: y + height / 2 },
        { type: 'bottom-left', x: x, y: y + height },
        { type: 'bottom', x: x + width / 2, y: y + height },
        { type: 'bottom-right', x: x + width, y: y + height },
      ];

      ctx.fillStyle = COLORS.handleCorner;
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1 / (scale * MM_TO_PIXELS);

      for (const handle of handlePositions) {
        ctx.beginPath();
        ctx.rect(
          handle.x - handleSize / 2,
          handle.y - handleSize / 2,
          handleSize,
          handleSize
        );
        ctx.fill();
        ctx.stroke();
      }
    }
  }

  /**
   * Draw a sheet viewport showing a drawing
   */
  drawSheetViewport(
    vp: SheetViewport,
    drawings: Drawing[],
    shapes: Shape[],
    _drawingViewports: Record<string, Viewport>,
    isSelected: boolean,
    options?: ViewportRenderOptions
  ): void {
    const ctx = this.ctx;
    const layers = options?.layers || [];
    const isCropRegionEditing = options?.isCropRegionEditing || false;
    const sheetZoom = options?.sheetZoom || 1;

    // Set custom patterns for hatch rendering
    if (options?.customPatterns) {
      this.shapeRenderer.setCustomPatterns(options.customPatterns.userPatterns, options.customPatterns.projectPatterns);
    }

    // Set wall types for material-based hatch lookup
    if (options?.wallTypes) {
      this.shapeRenderer.setWallTypes(options.wallTypes);
    }

    // Set wall system types for multi-layered wall rendering
    if (options?.wallSystemTypes) {
      this.shapeRenderer.setWallSystemTypes(options.wallSystemTypes);
    }

    // Set material hatch settings from Drawing Standards
    if (options?.materialHatchSettings) {
      this.shapeRenderer.setMaterialHatchSettings(options.materialHatchSettings);
    }

    // Set gridline extension distance
    if (options?.gridlineExtension !== undefined) {
      this.shapeRenderer.setGridlineExtension(options.gridlineExtension);
    }

    // Set sea level datum for NAP elevation display on levels
    if (options?.seaLevelDatum !== undefined) {
      this.shapeRenderer.setSeaLevelDatum(options.seaLevelDatum);
    }

    // Set shapes lookup for linked label text resolution
    this.shapeRenderer.setShapesLookup(shapes);

    // Set lineweight display mode and effective zoom for line width calculation
    this._showLineweight = options?.showLineweight !== false;
    this.shapeRenderer.setShowLineweight(this._showLineweight);
    // In sheet viewports, effective zoom combines sheet zoom with viewport scale
    const effectiveZoom = (options?.sheetZoom || 1) * vp.scale * MM_TO_PIXELS;
    this.shapeRenderer.setZoom(effectiveZoom);

    // Get the drawing to access its boundary
    const drawing = drawings.find(d => d.id === vp.drawingId);

    // Convert mm to pixels
    const vpX = vp.x * MM_TO_PIXELS;
    const vpY = vp.y * MM_TO_PIXELS;
    const vpWidth = vp.width * MM_TO_PIXELS;
    const vpHeight = vp.height * MM_TO_PIXELS;

    // Draw viewport border
    ctx.save();

    // Clip to viewport bounds
    ctx.beginPath();
    ctx.rect(vpX, vpY, vpWidth, vpHeight);
    ctx.clip();

    // Draw viewport background (white - same as paper)
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(vpX, vpY, vpWidth, vpHeight);

    // Get shapes for this drawing, filtered by visibility, layer overrides, and IFC category
    const hiddenCats = options?.hiddenIfcCategories || [];
    let drawingShapes = shapes.filter(s => s.drawingId === vp.drawingId && s.visible && !isShapeInHiddenCategory(s, hiddenCats));
    drawingShapes = this.filterShapesByLayerOverrides(drawingShapes, layers, vp.layerOverrides);

    // Get parametric shapes for this drawing
    const parametricShapes = options?.parametricShapes || [];
    let drawingParametricShapes = parametricShapes.filter(s => s.drawingId === vp.drawingId && s.visible);
    drawingParametricShapes = this.filterParametricByLayerOverrides(drawingParametricShapes, layers, vp.layerOverrides);

    // Calculate transform for viewport
    const vpCenterX = vpX + vpWidth / 2;
    const vpCenterY = vpY + vpHeight / 2;

    ctx.translate(vpCenterX, vpCenterY);
    ctx.scale(vp.scale * MM_TO_PIXELS, vp.scale * MM_TO_PIXELS);
    ctx.translate(-vp.centerX, -vp.centerY);

    // Get clip region (crop region if enabled, otherwise drawing boundary)
    const clipRegion = this.getClipRegion(vp, drawing);
    if (clipRegion) {
      ctx.beginPath();
      ctx.rect(clipRegion.x, clipRegion.y, clipRegion.width, clipRegion.height);
      ctx.clip();
    }

    // Set drawing scale for proper text sizing (must match DrawingRenderer behavior)
    if (drawing?.scale) {
      this.shapeRenderer.setDrawingScale(drawing.scale);
    }

    // Draw shapes (invertColors=true to convert white strokes to black on white paper)
    for (const shape of drawingShapes) {
      this.shapeRenderer.drawShapeSimple(shape, true);
    }

    // Draw parametric shapes
    for (const pShape of drawingParametricShapes) {
      this.drawParametricShapeSimple(pShape, true);
    }

    // Draw boundary indicator in viewport (thin line) - only if no crop region
    if (drawing?.boundary && (!vp.cropRegion || !vp.cropRegion.enabled)) {
      ctx.strokeStyle = '#cccccc';
      ctx.lineWidth = 1 / (vp.scale * MM_TO_PIXELS);
      ctx.setLineDash([5 / (vp.scale * MM_TO_PIXELS), 3 / (vp.scale * MM_TO_PIXELS)]);
      ctx.beginPath();
      ctx.rect(drawing.boundary.x, drawing.boundary.y, drawing.boundary.width, drawing.boundary.height);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Draw crop region indicator if it exists (even if disabled, show it dimmed)
    if (vp.cropRegion) {
      this.drawCropRegionIndicator(vp.cropRegion, vp.scale, isCropRegionEditing);
    }

    ctx.restore();

    // Draw viewport border only when selected (zoom-compensated line width)
    if (isSelected) {
      ctx.strokeStyle = '#e94560';
      ctx.lineWidth = 2 / sheetZoom;
      ctx.strokeRect(vpX, vpY, vpWidth, vpHeight);
    }

    // Draw crop region indicator icon if crop is enabled (zoom-compensated position)
    if (vp.cropRegion?.enabled) {
      this.drawCropIndicator(vpX + vpWidth - 20 / sheetZoom, vpY + 4 / sheetZoom, sheetZoom);
    }

    // Draw layer override indicator if any overrides exist (zoom-compensated position)
    if (vp.layerOverrides && vp.layerOverrides.length > 0) {
      this.drawLayerOverrideIndicator(vpX + vpWidth - 36 / sheetZoom, vpY + 4 / sheetZoom, sheetZoom);
    }

    // Draw viewport title (below viewport with extension line)
    const drawingForLabel = drawings.find(d => d.id === vp.drawingId);
    if (drawingForLabel) {
      // Determine if title should be shown based on visibility setting
      const titleVisibility = vp.titleVisibility ?? 'always';
      const totalViewports = options?.totalViewportsOnSheet ?? 1;
      const shouldShowTitle =
        titleVisibility === 'always' ||
        (titleVisibility === 'whenMultiple' && totalViewports > 1);

      if (shouldShowTitle) {
        this.drawViewportTitle(
          vpX,
          vpY + vpHeight,
          vpWidth,
          vp.customTitle || drawingForLabel.name,
          vp.scale,
          vp.referenceNumber,
          sheetZoom,
          {
            showExtensionLine: vp.showExtensionLine ?? true,
            extensionLineLength: vp.extensionLineLength,
            showScale: vp.showScale ?? true,
          }
        );
      }
    }

    // Draw resize handles if selected
    if (isSelected && !vp.locked) {
      this.handleRenderer.drawViewportHandles(vpX, vpY, vpWidth, vpHeight, sheetZoom);
    }
  }

  /**
   * Draw small crop indicator icon
   */
  private drawCropIndicator(x: number, y: number, zoom: number = 1): void {
    const ctx = this.ctx;
    ctx.save();
    ctx.strokeStyle = '#00bcd4';
    ctx.lineWidth = 1.5 / zoom;

    // Draw crop icon (intersecting L shapes)
    const size = 12 / zoom;
    ctx.beginPath();
    // Top-left L
    ctx.moveTo(x + 2 / zoom, y + size / 2);
    ctx.lineTo(x + 2 / zoom, y + 2 / zoom);
    ctx.lineTo(x + size / 2, y + 2 / zoom);
    // Bottom-right L
    ctx.moveTo(x + size - 2 / zoom, y + size / 2);
    ctx.lineTo(x + size - 2 / zoom, y + size - 2 / zoom);
    ctx.lineTo(x + size / 2, y + size - 2 / zoom);
    ctx.stroke();
    ctx.restore();
  }

  /**
   * Draw small layer override indicator icon
   */
  private drawLayerOverrideIndicator(x: number, y: number, zoom: number = 1): void {
    const ctx = this.ctx;
    ctx.save();
    ctx.strokeStyle = '#ff9800';
    ctx.lineWidth = 1.5 / zoom;

    // Draw layer stack icon
    const size = 12 / zoom;
    const padding = 2 / zoom;
    const rectHeight = 3 / zoom;
    ctx.beginPath();
    // Three stacked rectangles
    ctx.rect(x + padding, y + padding, size - padding * 2, rectHeight);
    ctx.rect(x + padding, y + padding + rectHeight + 1 / zoom, size - padding * 2, rectHeight);
    ctx.rect(x + padding, y + padding + (rectHeight + 1 / zoom) * 2, size - padding * 2, rectHeight);
    ctx.stroke();
    ctx.restore();
  }

  /**
   * Draw viewport title (below viewport with extension line)
   * Format:
   *   ─────────────────────────  ← Extension line (optional)
   *   ①  View Name               ← Reference number + Title
   *      Scale: 1:50             ← Scale (optional)
   */
  private drawViewportTitle(
    vpX: number,
    vpBottomY: number,
    vpWidth: number,
    title: string,
    scale: number,
    referenceNumber: string | undefined,
    zoom: number,
    options?: {
      showExtensionLine?: boolean;
      extensionLineLength?: number;
      showScale?: boolean;
    }
  ): void {
    const ctx = this.ctx;
    const showExtensionLine = options?.showExtensionLine ?? true;
    const showScale = options?.showScale ?? true;

    // Calculate extension line length (in pixels)
    const extensionLineLengthPx = options?.extensionLineLength
      ? options.extensionLineLength * MM_TO_PIXELS
      : vpWidth;

    const lineY = vpBottomY + 8 / zoom;
    const titleY = showExtensionLine ? lineY + 14 / zoom : vpBottomY + 14 / zoom;
    const scaleY = titleY + 12 / zoom;
    const lineStartX = vpX;
    const lineEndX = vpX + extensionLineLengthPx;

    // Draw extension line (if enabled)
    if (showExtensionLine) {
      ctx.strokeStyle = '#333333';
      ctx.lineWidth = 1 / zoom;
      ctx.beginPath();
      ctx.moveTo(lineStartX, lineY);
      ctx.lineTo(lineEndX, lineY);
      ctx.stroke();
    }

    // Calculate text start position (after reference number if present)
    let textStartX = vpX;

    // Draw reference number in circle if present
    if (referenceNumber) {
      const circleX = vpX + 10 / zoom;
      const circleY = titleY - 4 / zoom;
      const circleRadius = 8 / zoom;

      // Draw circle
      ctx.strokeStyle = '#333333';
      ctx.lineWidth = 1.5 / zoom;
      ctx.beginPath();
      ctx.arc(circleX, circleY, circleRadius, 0, Math.PI * 2);
      ctx.stroke();

      // Draw reference number text centered in circle
      ctx.fillStyle = '#333333';
      ctx.font = `bold ${10 / zoom}px ${CAD_DEFAULT_FONT}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(referenceNumber, circleX, circleY);

      // Move text start position to after the circle
      textStartX = circleX + circleRadius + 8 / zoom;
    }

    // Draw title
    ctx.fillStyle = '#333333';
    ctx.font = `${11 / zoom}px ${CAD_DEFAULT_FONT}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(title, textStartX, titleY);

    // Draw scale (if enabled)
    if (showScale) {
      const scaleText = `Scale: ${this.formatScale(scale)}`;
      ctx.fillStyle = '#666666';
      ctx.font = `${9 / zoom}px ${CAD_DEFAULT_FONT}`;
      ctx.fillText(scaleText, textStartX, scaleY);
    }

    // Reset text alignment
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
  }

  /**
   * Format scale for display (e.g., "1:100" or "2:1")
   */
  private formatScale(scale: number): string {
    if (scale >= 1) {
      return `${scale}:1`;
    }
    const inverse = Math.round(1 / scale);
    return `1:${inverse}`;
  }

  /**
   * Draw a parametric shape simply (for viewport rendering)
   */
  private drawParametricShapeSimple(shape: ParametricShape, invertColors: boolean = false): void {
    const ctx = this.ctx;

    if (shape.parametricType !== 'profile') return;

    const profileShape = shape as ProfileParametricShape;
    const geometry = profileShape.generatedGeometry;

    if (!geometry || geometry.outlines.length === 0) return;

    // Determine stroke color
    let strokeColor = shape.style.strokeColor;
    if (invertColors && strokeColor === '#ffffff') {
      strokeColor = '#000000';
    }

    ctx.save();
    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = this._showLineweight ? Math.max(shape.style.strokeWidth * 3, 2) : 1;

    // Draw each outline
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
      }

      ctx.stroke();
    }

    // Draw label above the section
    if (profileShape.showLabel !== false) {
      const template = PROFILE_TEMPLATES[profileShape.profileType];
      const labelText = profileShape.labelText || profileShape.presetId || template?.name || profileShape.profileType;
      const { bounds } = geometry;
      const centerX = (bounds.minX + bounds.maxX) / 2;
      const width = bounds.maxX - bounds.minX;
      const zoom = ctx.getTransform().a / this.dpr;
      const fontSize = Math.max(10 / zoom, width * 0.15);

      let textColor = strokeColor;
      ctx.fillStyle = textColor;
      ctx.font = `${fontSize}px ${CAD_DEFAULT_FONT}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      ctx.fillText(labelText, centerX, bounds.minY - fontSize * 0.3);
    }

    ctx.restore();
  }
}
