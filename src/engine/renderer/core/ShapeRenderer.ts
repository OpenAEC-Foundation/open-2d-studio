/**
 * ShapeRenderer - Renders individual shapes
 */

import type { Shape, DrawingPreview, CurrentStyle, Viewport } from '../types';
import type { HatchShape, HatchPatternType, BeamShape, ImageShape } from '../../../types/geometry';
import type { CustomHatchPattern, LineFamily, SvgHatchPattern } from '../../../types/hatch';
import { BUILTIN_PATTERNS, isSvgHatchPattern } from '../../../types/hatch';
import { BaseRenderer } from './BaseRenderer';
import { COLORS } from '../types';
import { DimensionRenderer } from './DimensionRenderer';
import type { DimensionShape } from '../../../types/dimension';
import { drawSplinePath } from '../../geometry/SplineUtils';
import { bulgeToArc, bulgeArcMidpoint } from '../../geometry/GeometryUtils';
import { svgToImage } from '../../../services/export/svgPatternService';
import { getGripHover } from '../gripHoverState';

export class ShapeRenderer extends BaseRenderer {
  private dimensionRenderer: DimensionRenderer;
  private customPatterns: CustomHatchPattern[] = [];
  // Cache for loaded SVG pattern images
  private svgImageCache: Map<string, HTMLImageElement> = new Map();
  private svgLoadingPromises: Map<string, Promise<HTMLImageElement | null>> = new Map();
  // Drawing scale for annotation text scaling (default 1:50 = 0.02)
  private drawingScale: number = 0.02;
  // Reference scale - text looks the same as before at this scale
  private static readonly REFERENCE_SCALE = 0.02; // 1:50
  // Live preview: temporarily override pattern for selected hatch shapes
  private previewPatternId: string | null = null;
  private previewSelectedIds: Set<string> = new Set();
  // Display lineweight: when false, all lines render at 1px
  private _showLineweight: boolean = true;
  // Cache for loaded image elements (keyed by shape ID)
  private imageCache: Map<string, HTMLImageElement> = new Map();

  constructor(ctx: CanvasRenderingContext2D, width: number = 0, height: number = 0, dpr?: number) {
    super(ctx, width, height, dpr);
    this.dimensionRenderer = new DimensionRenderer(ctx, width, height, dpr);
  }

  /**
   * Set the drawing scale for annotation text scaling
   * Annotation text (non-model text) will scale inversely with drawing scale
   * to maintain consistent paper size
   */
  setDrawingScale(scale: number): void {
    this.drawingScale = scale;
    this.dimensionRenderer.setDrawingScale(scale);
  }

  /**
   * Set whether to display actual line weights (false = all lines 1px thin)
   */
  setShowLineweight(show: boolean): void {
    this._showLineweight = show;
  }

  /**
   * Get the effective stroke width (respects showLineweight toggle)
   */
  private getLineWidth(strokeWidth: number): number {
    return this._showLineweight ? strokeWidth : 1;
  }

  /**
   * Set live preview state for pattern hovering
   */
  setPreviewPattern(patternId: string | null, selectedIds: string[]): void {
    this.previewPatternId = patternId;
    this.previewSelectedIds = new Set(selectedIds);
  }

  /**
   * Set available custom patterns for rendering
   */
  setCustomPatterns(userPatterns: CustomHatchPattern[], projectPatterns: CustomHatchPattern[]): void {
    this.customPatterns = [...userPatterns, ...projectPatterns];
    // Preload SVG patterns
    this.preloadSvgPatterns();
  }

  /**
   * Preload SVG patterns into image cache for faster rendering
   */
  private preloadSvgPatterns(): void {
    for (const pattern of this.customPatterns) {
      if (isSvgHatchPattern(pattern) && !this.svgImageCache.has(pattern.id)) {
        this.loadSvgPattern(pattern);
      }
    }
  }

  /**
   * Load an SVG pattern into the cache
   */
  private loadSvgPattern(pattern: SvgHatchPattern): void {
    // Don't start another load if one is in progress
    if (this.svgLoadingPromises.has(pattern.id)) return;

    const loadPromise = svgToImage(pattern.svgTile)
      .then(img => {
        this.svgImageCache.set(pattern.id, img);
        this.svgLoadingPromises.delete(pattern.id);
        return img;
      })
      .catch(() => {
        this.svgLoadingPromises.delete(pattern.id);
        return null;
      });

    this.svgLoadingPromises.set(pattern.id, loadPromise);
  }

  /**
   * Get cached SVG image for a pattern
   */
  private getSvgPatternImage(patternId: string): HTMLImageElement | null {
    return this.svgImageCache.get(patternId) || null;
  }

  /**
   * Look up a pattern by ID (checks builtin, user, and project patterns)
   */
  private getPatternById(patternId: string): CustomHatchPattern | undefined {
    return (
      BUILTIN_PATTERNS.find(p => p.id === patternId) ||
      this.customPatterns.find(p => p.id === patternId)
    );
  }

  /**
   * Update dimensions and also update dimension renderer
   */
  setDimensions(width: number, height: number): void {
    super.setDimensions(width, height);
    this.dimensionRenderer.setDimensions(width, height);
  }

  /**
   * Draw a shape with selection state
   */
  drawShape(shape: Shape, isSelected: boolean, isHovered: boolean = false, invertColors: boolean = false, hideHandles: boolean = false): void {
    const ctx = this.ctx;
    const { style } = shape;

    // Set line style
    let strokeColor = style.strokeColor;
    if (invertColors && strokeColor === '#ffffff') {
      strokeColor = '#000000';
    }
    ctx.strokeStyle = isSelected ? COLORS.selection : isHovered ? COLORS.hover : strokeColor;
    ctx.lineWidth = this.getLineWidth(style.strokeWidth);
    ctx.setLineDash(this.getLineDash(style.lineStyle));

    if (style.fillColor) {
      ctx.fillStyle = style.fillColor;
    }

    switch (shape.type) {
      case 'line':
        this.drawLine(shape);
        break;
      case 'rectangle':
        this.drawRectangle(shape);
        break;
      case 'circle':
        this.drawCircle(shape);
        break;
      case 'arc':
        this.drawArc(shape);
        break;
      case 'polyline':
        this.drawPolyline(shape);
        break;
      case 'spline':
        this.drawSpline(shape);
        break;
      case 'ellipse':
        this.drawEllipse(shape);
        break;
      case 'text':
        this.drawText(shape, isSelected, invertColors);
        break;
      case 'dimension':
        this.dimensionRenderer.drawDimension(shape as DimensionShape, isSelected, isHovered);
        break;
      case 'hatch':
        this.drawHatch(shape as HatchShape, invertColors);
        break;
      case 'beam':
        this.drawBeam(shape as BeamShape, invertColors);
        break;
      case 'image':
        this.drawImage(shape as ImageShape);
        break;
      default:
        break;
    }

    // Draw selection handles (hidden during modify tool operations)
    // Skip for text and dimension shapes - they have their own selection box rendering
    if (isSelected && !hideHandles && shape.type !== 'text' && shape.type !== 'dimension') {
      this.drawSelectionHandles(shape);
    }

    // Reset line dash
    ctx.setLineDash([]);
  }

  /**
   * Draw a shape without selection highlighting (for sheet viewports)
   */
  drawShapeSimple(shape: Shape, invertColors: boolean = false): void {
    const ctx = this.ctx;
    const { style } = shape;

    // Use black stroke for sheet view (paper is white) if color is white
    let strokeColor = style.strokeColor;
    if (invertColors && style.strokeColor === '#ffffff') {
      strokeColor = '#000000';
    }

    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = this.getLineWidth(style.strokeWidth);
    ctx.setLineDash(this.getLineDash(style.lineStyle));

    if (style.fillColor) {
      ctx.fillStyle = style.fillColor;
    }

    switch (shape.type) {
      case 'line':
        this.drawLine(shape);
        break;
      case 'rectangle':
        this.drawRectangle(shape);
        break;
      case 'circle':
        this.drawCircle(shape);
        break;
      case 'arc':
        this.drawArc(shape);
        break;
      case 'polyline':
        this.drawPolyline(shape);
        break;
      case 'spline':
        this.drawSpline(shape);
        break;
      case 'ellipse':
        this.drawEllipse(shape);
        break;
      case 'text':
        this.drawText(shape, false, invertColors);
        break;
      case 'dimension':
        this.dimensionRenderer.drawDimension(shape as DimensionShape, false);
        break;
      case 'hatch':
        this.drawHatch(shape as HatchShape, invertColors);
        break;
      case 'beam':
        this.drawBeam(shape as BeamShape, invertColors);
        break;
      case 'image':
        this.drawImage(shape as ImageShape);
        break;
    }

    ctx.setLineDash([]);
  }

  /**
   * Draw drawing preview
   */
  drawPreview(preview: DrawingPreview, style?: CurrentStyle, viewport?: Viewport, invertColors: boolean = false): void {
    if (!preview) return;

    const ctx = this.ctx;

    // Set preview style - solid lines matching final appearance
    let strokeColor = style?.strokeColor || '#ffffff';
    if (invertColors && strokeColor === '#ffffff') {
      strokeColor = '#000000';
    }
    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = this.getLineWidth(style?.strokeWidth || 1);
    ctx.setLineDash([]);

    switch (preview.type) {
      case 'line':
        ctx.beginPath();
        ctx.moveTo(preview.start.x, preview.start.y);
        ctx.lineTo(preview.end.x, preview.end.y);
        ctx.stroke();
        // Draw temporary dimension showing line length
        if (viewport) {
          this.drawPreviewDimension(preview.start, preview.end, viewport);
        }
        break;

      case 'rectangle': {
        const x = Math.min(preview.start.x, preview.end.x);
        const y = Math.min(preview.start.y, preview.end.y);
        const width = Math.abs(preview.end.x - preview.start.x);
        const height = Math.abs(preview.end.y - preview.start.y);
        const r = preview.cornerRadius ?? 0;
        ctx.beginPath();
        if (r > 0) {
          const maxR = Math.min(r, width / 2, height / 2);
          ctx.moveTo(x + maxR, y);
          ctx.lineTo(x + width - maxR, y);
          ctx.arcTo(x + width, y, x + width, y + maxR, maxR);
          ctx.lineTo(x + width, y + height - maxR);
          ctx.arcTo(x + width, y + height, x + width - maxR, y + height, maxR);
          ctx.lineTo(x + maxR, y + height);
          ctx.arcTo(x, y + height, x, y + height - maxR, maxR);
          ctx.lineTo(x, y + maxR);
          ctx.arcTo(x, y, x + maxR, y, maxR);
          ctx.closePath();
        } else {
          ctx.rect(x, y, width, height);
        }
        ctx.stroke();
        // Draw temporary dimensions for width and height (always outside the rectangle)
        if (viewport) {
          const topLeft = { x, y };
          const topRight = { x: x + width, y };
          const bottomRight = { x: x + width, y: y + height };
          // Width dimension along the top edge, pushed upward (outside)
          this.drawPreviewDimension(topLeft, topRight, viewport, { x: 0, y: -1 });
          // Height dimension along the right edge, pushed rightward (outside)
          this.drawPreviewDimension(bottomRight, topRight, viewport, { x: 1, y: 0 });
        }
        break;
      }

      case 'rotatedRectangle': {
        const corners = preview.corners;
        ctx.beginPath();
        ctx.moveTo(corners[0].x, corners[0].y);
        ctx.lineTo(corners[1].x, corners[1].y);
        ctx.lineTo(corners[2].x, corners[2].y);
        ctx.lineTo(corners[3].x, corners[3].y);
        ctx.closePath();
        ctx.stroke();
        break;
      }

      case 'circle':
        ctx.beginPath();
        ctx.arc(preview.center.x, preview.center.y, preview.radius, 0, Math.PI * 2);
        ctx.stroke();
        // Draw temporary radius dimension from center to right quadrant, above the line
        if (viewport && preview.radius > 0.5) {
          const radiusEnd = { x: preview.center.x + preview.radius, y: preview.center.y };
          this.drawPreviewDimension(preview.center, radiusEnd, viewport, { x: 0, y: -1 });
        }
        break;

      case 'arc':
        ctx.beginPath();
        ctx.arc(preview.center.x, preview.center.y, preview.radius, preview.startAngle, preview.endAngle);
        ctx.stroke();
        break;

      case 'polyline':
        if (preview.points.length > 0) {
          ctx.beginPath();
          ctx.moveTo(preview.points[0].x, preview.points[0].y);
          // Draw completed segments (with bulge arcs)
          for (let i = 0; i < preview.points.length - 1; i++) {
            const b = preview.bulges?.[i] ?? 0;
            if (b !== 0) {
              const arc = bulgeToArc(preview.points[i], preview.points[i + 1], b);
              ctx.arc(arc.center.x, arc.center.y, arc.radius, arc.startAngle, arc.endAngle, arc.clockwise);
            } else {
              ctx.lineTo(preview.points[i + 1].x, preview.points[i + 1].y);
            }
          }
          // Draw current (in-progress) segment
          const currentBulge = preview.currentBulge ?? 0;
          const throughPoint = preview.arcThroughPoint;
          if (currentBulge !== 0 && throughPoint) {
            // 3-point arc mode with through point set: draw the arc
            const lastPt = preview.points[preview.points.length - 1];
            const arc = bulgeToArc(lastPt, preview.currentPoint, currentBulge);
            ctx.arc(arc.center.x, arc.center.y, arc.radius, arc.startAngle, arc.endAngle, arc.clockwise);
          } else if (throughPoint) {
            // Through point is set but we're showing where the endpoint will be
            // Draw dashed lines: lastPt -> throughPoint -> currentPoint
            const lastPt = preview.points[preview.points.length - 1];
            ctx.stroke(); // Stroke completed segments first
            ctx.beginPath();
            ctx.setLineDash([5, 5]);
            ctx.moveTo(lastPt.x, lastPt.y);
            ctx.lineTo(throughPoint.x, throughPoint.y);
            ctx.lineTo(preview.currentPoint.x, preview.currentPoint.y);
            ctx.stroke();
            ctx.setLineDash([]);
            // Draw small circle at through point
            ctx.beginPath();
            ctx.arc(throughPoint.x, throughPoint.y, 4, 0, Math.PI * 2);
            ctx.fill();
            return; // Already stroked
          } else {
            ctx.lineTo(preview.currentPoint.x, preview.currentPoint.y);
          }
          ctx.stroke();
          // Draw temporary dimension for current segment
          if (viewport) {
            const lastPt = preview.points[preview.points.length - 1];
            this.drawPreviewDimension(lastPt, preview.currentPoint, viewport);
          }
        }
        break;

      case 'spline':
        if (preview.points.length > 0) {
          const allPoints = [...preview.points, preview.currentPoint];
          drawSplinePath(ctx, allPoints);
          ctx.stroke();
        }
        break;

      case 'ellipse':
        ctx.beginPath();
        ctx.ellipse(preview.center.x, preview.center.y, preview.radiusX, preview.radiusY, preview.rotation, 0, Math.PI * 2);
        ctx.stroke();
        break;

      case 'text': {
        // Draw text cursor indicator
        const cursorHeight = style?.strokeWidth ? style.strokeWidth * 10 : 14;
        ctx.beginPath();
        ctx.moveTo(preview.position.x, preview.position.y);
        ctx.lineTo(preview.position.x, preview.position.y + cursorHeight);
        ctx.stroke();
        // Draw small horizontal lines at top and bottom
        ctx.beginPath();
        ctx.moveTo(preview.position.x - 3, preview.position.y);
        ctx.lineTo(preview.position.x + 3, preview.position.y);
        ctx.moveTo(preview.position.x - 3, preview.position.y + cursorHeight);
        ctx.lineTo(preview.position.x + 3, preview.position.y + cursorHeight);
        ctx.stroke();
        break;
      }

      case 'dimension':
        if (viewport) {
          this.dimensionRenderer.drawDimensionPreview(preview, viewport);
        }
        break;

      case 'hatch':
        if (preview.points.length > 0) {
          ctx.beginPath();
          ctx.moveTo(preview.points[0].x, preview.points[0].y);
          for (let i = 1; i < preview.points.length; i++) {
            ctx.lineTo(preview.points[i].x, preview.points[i].y);
          }
          ctx.lineTo(preview.currentPoint.x, preview.currentPoint.y);
          ctx.stroke();
          // Draw dashed closing line hint
          if (preview.points.length >= 2) {
            ctx.save();
            ctx.setLineDash([4, 4]);
            ctx.globalAlpha = 0.4;
            ctx.beginPath();
            ctx.moveTo(preview.currentPoint.x, preview.currentPoint.y);
            ctx.lineTo(preview.points[0].x, preview.points[0].y);
            ctx.stroke();
            ctx.restore();
          }
        }
        break;

      case 'beam': {
        // Draw beam preview in plan view
        const { start, end, flangeWidth, showCenterline } = preview;
        const beamAngle = Math.atan2(end.y - start.y, end.x - start.x);
        const halfWidth = flangeWidth / 2;
        const perpX = Math.sin(beamAngle) * halfWidth;
        const perpY = Math.cos(beamAngle) * halfWidth;

        // Draw beam outline (rectangle in plan view)
        ctx.beginPath();
        ctx.moveTo(start.x + perpX, start.y - perpY);
        ctx.lineTo(end.x + perpX, end.y - perpY);
        ctx.lineTo(end.x - perpX, end.y + perpY);
        ctx.lineTo(start.x - perpX, start.y + perpY);
        ctx.closePath();
        ctx.stroke();

        // Draw centerline (dashed)
        if (showCenterline) {
          ctx.save();
          ctx.setLineDash([8, 4]);
          ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
          ctx.beginPath();
          ctx.moveTo(start.x, start.y);
          ctx.lineTo(end.x, end.y);
          ctx.stroke();
          ctx.restore();
        }

        // Draw end lines (perpendicular at start and end)
        ctx.beginPath();
        ctx.moveTo(start.x + perpX, start.y - perpY);
        ctx.lineTo(start.x - perpX, start.y + perpY);
        ctx.moveTo(end.x + perpX, end.y - perpY);
        ctx.lineTo(end.x - perpX, end.y + perpY);
        ctx.stroke();
        break;
      }

      case 'modifyPreview':
        ctx.save();
        ctx.globalAlpha = 0.5;
        ctx.setLineDash([6, 4]);
        for (const shape of preview.shapes) {
          this.drawShape(shape, false, false, false);
        }
        ctx.restore();
        ctx.setLineDash([]);
        break;

      case 'mirrorAxis':
        // Draw ghost shapes
        ctx.save();
        ctx.globalAlpha = 0.5;
        ctx.setLineDash([6, 4]);
        for (const shape of preview.shapes) {
          this.drawShape(shape, false, false, false);
        }
        ctx.restore();
        // Draw mirror axis line
        ctx.save();
        ctx.strokeStyle = '#00ff00';
        ctx.lineWidth = 1;
        ctx.setLineDash([8, 4]);
        ctx.beginPath();
        ctx.moveTo(preview.start.x, preview.start.y);
        ctx.lineTo(preview.end.x, preview.end.y);
        ctx.stroke();
        ctx.restore();
        ctx.setLineDash([]);
        break;

      case 'rotateGuide': {
        // Draw ghost shapes
        if (preview.shapes.length > 0) {
          ctx.save();
          ctx.globalAlpha = 0.5;
          ctx.setLineDash([6, 4]);
          for (const shape of preview.shapes) {
            this.drawShape(shape, false, false, false);
          }
          ctx.restore();
        }

        const { center, startRay, endRay, angle } = preview;

        // Draw center crosshair
        ctx.save();
        ctx.strokeStyle = '#00ff00';
        ctx.lineWidth = 1;
        const cross = 6 / (viewport?.zoom || 1);
        ctx.beginPath();
        ctx.moveTo(center.x - cross, center.y);
        ctx.lineTo(center.x + cross, center.y);
        ctx.moveTo(center.x, center.y - cross);
        ctx.lineTo(center.x, center.y + cross);
        ctx.stroke();
        ctx.restore();

        // Draw start ray (fixed, if set)
        if (startRay) {
          ctx.save();
          ctx.strokeStyle = '#00ff00';
          ctx.lineWidth = 1;
          ctx.setLineDash([8, 4]);
          ctx.beginPath();
          ctx.moveTo(center.x, center.y);
          ctx.lineTo(startRay.x, startRay.y);
          ctx.stroke();
          ctx.restore();
        }

        // Draw current ray
        ctx.save();
        ctx.strokeStyle = '#00ccff';
        ctx.lineWidth = 1;
        ctx.setLineDash([8, 4]);
        ctx.beginPath();
        ctx.moveTo(center.x, center.y);
        ctx.lineTo(endRay.x, endRay.y);
        ctx.stroke();
        ctx.restore();

        // Draw angle arc between start and end rays
        if (startRay && angle !== undefined) {
          const startAngle = Math.atan2(startRay.y - center.y, startRay.x - center.x);
          const endAngle = Math.atan2(endRay.y - center.y, endRay.x - center.x);
          const arcRadius = Math.min(
            30 / (viewport?.zoom || 1),
            Math.hypot(startRay.x - center.x, startRay.y - center.y) * 0.4,
            Math.hypot(endRay.x - center.x, endRay.y - center.y) * 0.4
          );

          ctx.save();
          ctx.strokeStyle = '#ffcc00';
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.arc(center.x, center.y, arcRadius, startAngle, endAngle, angle < 0);
          ctx.stroke();

          // Draw angle text
          const midAngle = (startAngle + endAngle) / 2;
          const textRadius = arcRadius + 10 / (viewport?.zoom || 1);
          const textX = center.x + textRadius * Math.cos(midAngle);
          const textY = center.y + textRadius * Math.sin(midAngle);
          const fontSize = 11 / (viewport?.zoom || 1);
          ctx.fillStyle = '#ffcc00';
          ctx.font = `${fontSize}px monospace`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          let displayAngle = angle % 360;
          if (displayAngle > 180) displayAngle -= 360;
          if (displayAngle < -180) displayAngle += 360;
          ctx.fillText(`${displayAngle.toFixed(1)}\u00B0`, textX, textY);
          ctx.restore();
        }

        ctx.setLineDash([]);
        break;
      }

      case 'scaleGuide': {
        const { origin, refPoint, currentPoint, factor, shapes } = preview;
        const zoom = viewport?.zoom || 1;

        // Draw ghost shapes
        if (shapes.length > 0) {
          ctx.save();
          ctx.globalAlpha = 0.5;
          ctx.setLineDash([6, 4]);
          for (const shape of shapes) {
            this.drawShape(shape, false, false, false);
          }
          ctx.restore();
        }

        // Draw origin crosshair
        ctx.save();
        ctx.strokeStyle = '#00ff00';
        ctx.lineWidth = 1;
        const cross = 6 / zoom;
        ctx.beginPath();
        ctx.moveTo(origin.x - cross, origin.y);
        ctx.lineTo(origin.x + cross, origin.y);
        ctx.moveTo(origin.x, origin.y - cross);
        ctx.lineTo(origin.x, origin.y + cross);
        ctx.stroke();
        ctx.restore();

        // Draw reference line (fixed, green dashed)
        if (refPoint) {
          ctx.save();
          ctx.strokeStyle = '#00ff00';
          ctx.lineWidth = 1;
          ctx.setLineDash([8, 4]);
          ctx.beginPath();
          ctx.moveTo(origin.x, origin.y);
          ctx.lineTo(refPoint.x, refPoint.y);
          ctx.stroke();
          ctx.restore();

          // Reference distance label
          const refDist = Math.hypot(refPoint.x - origin.x, refPoint.y - origin.y);
          const refMidX = (origin.x + refPoint.x) / 2;
          const refMidY = (origin.y + refPoint.y) / 2;
          const fontSize = 11 / zoom;
          ctx.save();
          ctx.fillStyle = '#00ff00';
          ctx.font = `${fontSize}px monospace`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'bottom';
          ctx.fillText(refDist.toFixed(1), refMidX, refMidY - 4 / zoom);
          ctx.restore();
        }

        // Draw current line (cyan dashed)
        ctx.save();
        ctx.strokeStyle = '#00ccff';
        ctx.lineWidth = 1;
        ctx.setLineDash([8, 4]);
        ctx.beginPath();
        ctx.moveTo(origin.x, origin.y);
        ctx.lineTo(currentPoint.x, currentPoint.y);
        ctx.stroke();
        ctx.restore();

        // Current distance label
        const curDist = Math.hypot(currentPoint.x - origin.x, currentPoint.y - origin.y);
        const curMidX = (origin.x + currentPoint.x) / 2;
        const curMidY = (origin.y + currentPoint.y) / 2;
        const fontSize2 = 11 / zoom;
        ctx.save();
        ctx.fillStyle = '#00ccff';
        ctx.font = `${fontSize2}px monospace`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.fillText(curDist.toFixed(1), curMidX, curMidY + 4 / zoom);
        ctx.restore();

        // Scale factor label near origin
        if (factor !== undefined) {
          const factorFontSize = 12 / zoom;
          ctx.save();
          ctx.fillStyle = '#ffcc00';
          ctx.font = `bold ${factorFontSize}px monospace`;
          ctx.textAlign = 'left';
          ctx.textBaseline = 'bottom';
          ctx.fillText(`\u00D7${factor.toFixed(3)}`, origin.x + 8 / zoom, origin.y - 8 / zoom);
          ctx.restore();
        }

        ctx.setLineDash([]);
        break;
      }
    }
  }

  /**
   * Draw a temporary dimension on a preview line.
   * Includes extension lines, an offset parallel dimension line with tick marks,
   * and centered text with a gap in the dimension line.
   */
  private drawPreviewDimension(start: { x: number; y: number }, end: { x: number; y: number }, viewport: Viewport, outwardDir?: { x: number; y: number }): void {
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const length = Math.hypot(dx, dy);

    // Don't show dimension for very short lines
    if (length < 0.5) return;

    const ctx = this.ctx;
    const zoom = viewport.zoom;

    // Line angle and perpendicular direction
    const angle = Math.atan2(dy, dx);
    let perpX = -Math.sin(angle);
    let perpY = Math.cos(angle);
    if (outwardDir) {
      // Use caller-specified outward direction: flip perpendicular if it points away from desired side
      const dot = perpX * outwardDir.x + perpY * outwardDir.y;
      if (dot < 0) {
        perpX = -perpX;
        perpY = -perpY;
      }
    } else {
      // Default: ensure dimension appears above the line (negative Y in screen coords)
      if (perpY > 0 || (perpY === 0 && perpX < 0)) {
        perpX = -perpX;
        perpY = -perpY;
      }
    }

    // All sizes scale inversely with zoom so they stay consistent on screen
    const dimOffset = 20 / zoom;        // Distance from drawn line to dimension line
    const extGap = 3 / zoom;            // Gap between drawn line and start of extension line
    const extOvershoot = 4 / zoom;      // How far extension line extends past dimension line
    const tickSize = 5 / zoom;          // Length of tick mark
    const fontSize = 11 / zoom;
    const textPadding = 3 / zoom;

    // --- Extension line endpoints ---
    // Extension lines run perpendicular from near the drawn line to past the dimension line
    const extStartBottom = {
      x: start.x + perpX * extGap,
      y: start.y + perpY * extGap,
    };
    const extStartTop = {
      x: start.x + perpX * (dimOffset + extOvershoot),
      y: start.y + perpY * (dimOffset + extOvershoot),
    };
    const extEndBottom = {
      x: end.x + perpX * extGap,
      y: end.y + perpY * extGap,
    };
    const extEndTop = {
      x: end.x + perpX * (dimOffset + extOvershoot),
      y: end.y + perpY * (dimOffset + extOvershoot),
    };

    // --- Dimension line endpoints (parallel to drawn line, offset by dimOffset) ---
    const dimStart = {
      x: start.x + perpX * dimOffset,
      y: start.y + perpY * dimOffset,
    };
    const dimEnd = {
      x: end.x + perpX * dimOffset,
      y: end.y + perpY * dimOffset,
    };
    const dimMid = {
      x: (dimStart.x + dimEnd.x) / 2,
      y: (dimStart.y + dimEnd.y) / 2,
    };

    // --- Prepare text metrics for gap calculation ---
    const displayText = length.toFixed(2);
    ctx.font = `${fontSize}px Arial`;
    const textMetrics = ctx.measureText(displayText);
    const textGap = textMetrics.width + textPadding * 2;
    const halfGap = textGap / 2;

    // Gap start/end points along the dimension line
    const gapStart = {
      x: dimMid.x - Math.cos(angle) * halfGap,
      y: dimMid.y - Math.sin(angle) * halfGap,
    };
    const gapEnd = {
      x: dimMid.x + Math.cos(angle) * halfGap,
      y: dimMid.y + Math.sin(angle) * halfGap,
    };

    ctx.save();
    ctx.strokeStyle = '#00bfff';
    ctx.fillStyle = '#00bfff';
    ctx.lineWidth = 1 / zoom;
    ctx.setLineDash([]);

    // --- Draw extension lines ---
    ctx.beginPath();
    ctx.moveTo(extStartBottom.x, extStartBottom.y);
    ctx.lineTo(extStartTop.x, extStartTop.y);
    ctx.moveTo(extEndBottom.x, extEndBottom.y);
    ctx.lineTo(extEndTop.x, extEndTop.y);
    ctx.stroke();

    // --- Draw dimension line (two segments with text gap) ---
    ctx.beginPath();
    ctx.moveTo(dimStart.x, dimStart.y);
    ctx.lineTo(gapStart.x, gapStart.y);
    ctx.moveTo(gapEnd.x, gapEnd.y);
    ctx.lineTo(dimEnd.x, dimEnd.y);
    ctx.stroke();

    // --- Draw tick marks (45° diagonal) ---
    const tickAngle = angle + Math.PI / 4; // 45° from the dimension line
    const halfTick = tickSize * 0.7;

    // Tick at dimension start
    ctx.beginPath();
    ctx.moveTo(
      dimStart.x - Math.cos(tickAngle) * halfTick,
      dimStart.y - Math.sin(tickAngle) * halfTick
    );
    ctx.lineTo(
      dimStart.x + Math.cos(tickAngle) * halfTick,
      dimStart.y + Math.sin(tickAngle) * halfTick
    );
    ctx.stroke();

    // Tick at dimension end
    ctx.beginPath();
    ctx.moveTo(
      dimEnd.x - Math.cos(tickAngle) * halfTick,
      dimEnd.y - Math.sin(tickAngle) * halfTick
    );
    ctx.lineTo(
      dimEnd.x + Math.cos(tickAngle) * halfTick,
      dimEnd.y + Math.sin(tickAngle) * halfTick
    );
    ctx.stroke();

    // --- Draw dimension text centered in the gap ---
    ctx.save();
    ctx.translate(dimMid.x, dimMid.y);

    // Rotate text to align with the line, but keep readable (not upside down)
    let textAngle = angle;
    if (textAngle > Math.PI / 2) textAngle -= Math.PI;
    if (textAngle < -Math.PI / 2) textAngle += Math.PI;
    ctx.rotate(textAngle);

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // Background for readability
    ctx.fillStyle = 'rgba(26, 26, 46, 0.9)';
    ctx.fillRect(
      -textMetrics.width / 2 - textPadding,
      -fontSize / 2 - textPadding / 2,
      textMetrics.width + textPadding * 2,
      fontSize + textPadding
    );

    // Text
    ctx.fillStyle = '#00bfff';
    ctx.fillText(displayText, 0, 0);

    ctx.restore();
    ctx.restore();
  }

  // Private shape drawing methods
  private drawLine(shape: Shape): void {
    if (shape.type !== 'line') return;
    const ctx = this.ctx;
    ctx.beginPath();
    ctx.moveTo(shape.start.x, shape.start.y);
    ctx.lineTo(shape.end.x, shape.end.y);
    ctx.stroke();
  }

  private drawRectangle(shape: Shape): void {
    if (shape.type !== 'rectangle') return;
    const ctx = this.ctx;
    ctx.save();

    if (shape.rotation) {
      ctx.translate(shape.topLeft.x, shape.topLeft.y);
      ctx.rotate(shape.rotation);
      ctx.translate(-shape.topLeft.x, -shape.topLeft.y);
    }

    const r = shape.cornerRadius ?? 0;
    ctx.beginPath();
    if (r > 0) {
      // Clamp radius so it doesn't exceed half the smallest side
      const maxR = Math.min(r, shape.width / 2, shape.height / 2);
      const x = shape.topLeft.x;
      const y = shape.topLeft.y;
      const w = shape.width;
      const h = shape.height;
      ctx.moveTo(x + maxR, y);
      ctx.lineTo(x + w - maxR, y);
      ctx.arcTo(x + w, y, x + w, y + maxR, maxR);
      ctx.lineTo(x + w, y + h - maxR);
      ctx.arcTo(x + w, y + h, x + w - maxR, y + h, maxR);
      ctx.lineTo(x + maxR, y + h);
      ctx.arcTo(x, y + h, x, y + h - maxR, maxR);
      ctx.lineTo(x, y + maxR);
      ctx.arcTo(x, y, x + maxR, y, maxR);
      ctx.closePath();
    } else {
      ctx.rect(shape.topLeft.x, shape.topLeft.y, shape.width, shape.height);
    }

    if (shape.style.fillColor) {
      ctx.fill();
    }
    ctx.stroke();

    ctx.restore();
  }

  private drawCircle(shape: Shape): void {
    if (shape.type !== 'circle') return;
    const ctx = this.ctx;
    ctx.beginPath();
    ctx.arc(shape.center.x, shape.center.y, shape.radius, 0, Math.PI * 2);

    if (shape.style.fillColor) {
      ctx.fill();
    }
    ctx.stroke();
  }

  private drawArc(shape: Shape): void {
    if (shape.type !== 'arc') return;
    const ctx = this.ctx;
    ctx.beginPath();
    ctx.arc(shape.center.x, shape.center.y, shape.radius, shape.startAngle, shape.endAngle);
    ctx.stroke();
  }

  private drawPolyline(shape: Shape): void {
    if (shape.type !== 'polyline') return;
    const ctx = this.ctx;
    const { points, closed, bulge } = shape;

    if (points.length < 2) return;

    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);

    for (let i = 0; i < points.length - 1; i++) {
      const b = bulge?.[i] ?? 0;
      if (b !== 0) {
        const arc = bulgeToArc(points[i], points[i + 1], b);
        ctx.arc(arc.center.x, arc.center.y, arc.radius, arc.startAngle, arc.endAngle, arc.clockwise);
      } else {
        ctx.lineTo(points[i + 1].x, points[i + 1].y);
      }
    }

    if (closed) {
      const lastB = bulge?.[points.length - 1] ?? 0;
      if (lastB !== 0) {
        const arc = bulgeToArc(points[points.length - 1], points[0], lastB);
        ctx.arc(arc.center.x, arc.center.y, arc.radius, arc.startAngle, arc.endAngle, arc.clockwise);
      } else {
        ctx.closePath();
      }
      if (shape.style.fillColor) {
        ctx.fill();
      }
    }

    ctx.stroke();
  }

  private drawSpline(shape: Shape): void {
    if (shape.type !== 'spline') return;
    if (shape.points.length < 2) return;
    const ctx = this.ctx;
    drawSplinePath(ctx, shape.points);
    ctx.stroke();
  }

  private drawEllipse(shape: Shape): void {
    if (shape.type !== 'ellipse') return;
    const ctx = this.ctx;
    const startAngle = shape.startAngle ?? 0;
    const endAngle = shape.endAngle ?? Math.PI * 2;
    const isPartial = shape.startAngle !== undefined && shape.endAngle !== undefined;
    ctx.beginPath();
    ctx.ellipse(shape.center.x, shape.center.y, shape.radiusX, shape.radiusY, shape.rotation, startAngle, isPartial ? endAngle : Math.PI * 2);

    if (shape.style.fillColor && !isPartial) {
      ctx.fill();
    }
    ctx.stroke();
  }

  private drawText(shape: Shape, isSelected: boolean, invertColors: boolean = false): void {
    if (shape.type !== 'text') return;
    const ctx = this.ctx;

    const {
      position,
      text,
      fontSize,
      fontFamily,
      rotation,
      alignment,
      verticalAlignment,
      bold,
      italic,
      underline,
      strikethrough = false,
      color,
      lineHeight = 1.2,
      isModelText = false,
      backgroundMask = false,
      backgroundColor = '#1a1a2e',
      backgroundPadding = 0.5,
      // Advanced formatting
      letterSpacing = 1,
      widthFactor = 1,
      obliqueAngle = 0,
      textCase = 'none',
      paragraphSpacing = 0,
    } = shape;

    ctx.save();

    // Apply rotation around position
    if (rotation !== 0) {
      ctx.translate(position.x, position.y);
      ctx.rotate(rotation);
      ctx.translate(-position.x, -position.y);
    }

    // Calculate effective font size:
    // - Annotation text (default): scales relative to reference scale (1:50)
    //   At 1:50, text looks the same as before. At 1:100, text appears 2x larger (model is smaller)
    // - Model text: uses fontSize directly in model units
    const effectiveFontSize = isModelText
      ? fontSize
      : fontSize * (ShapeRenderer.REFERENCE_SCALE / this.drawingScale);

    // Build font string
    const fontStyle = `${italic ? 'italic ' : ''}${bold ? 'bold ' : ''}`;
    ctx.font = `${fontStyle}${effectiveFontSize}px ${fontFamily}`;

    // Set text color - invert white to black for sheet mode
    let textColor = color || shape.style.strokeColor;
    if (invertColors && textColor === '#ffffff') {
      textColor = '#000000';
    }
    ctx.fillStyle = textColor;

    // Set alignment
    ctx.textAlign = alignment;
    ctx.textBaseline = verticalAlignment === 'middle' ? 'middle' :
                       verticalAlignment === 'bottom' ? 'bottom' : 'top';

    // Handle multi-line text with optional word wrapping
    const actualLineHeight = effectiveFontSize * lineHeight;
    // Calculate extra spacing for paragraph breaks
    const paragraphExtra = paragraphSpacing * actualLineHeight;

    // If fixedWidth is set, wrap text to fit within that width
    const fixedWidth = shape.fixedWidth;
    let lines: string[];

    if (fixedWidth && fixedWidth > 0) {
      // Word wrap text to fit within fixedWidth
      lines = [];
      const paragraphs = text.split('\n');
      for (const paragraph of paragraphs) {
        if (paragraph === '') {
          lines.push('');
          continue;
        }

        const words = paragraph.split(' ');
        let currentLine = '';

        for (const word of words) {
          // Check if the word itself is too long and needs character-level breaking
          const wordMetrics = ctx.measureText(word);
          if (wordMetrics.width > fixedWidth) {
            // Push current line if it has content
            if (currentLine) {
              lines.push(currentLine);
              currentLine = '';
            }
            // Break the word character by character
            let charLine = '';
            for (const char of word) {
              const testCharLine = charLine + char;
              const charMetrics = ctx.measureText(testCharLine);
              if (charMetrics.width > fixedWidth && charLine) {
                lines.push(charLine);
                charLine = char;
              } else {
                charLine = testCharLine;
              }
            }
            currentLine = charLine;
          } else {
            const testLine = currentLine ? `${currentLine} ${word}` : word;
            const metrics = ctx.measureText(testLine);

            if (metrics.width > fixedWidth && currentLine) {
              lines.push(currentLine);
              currentLine = word;
            } else {
              currentLine = testLine;
            }
          }
        }

        if (currentLine) {
          lines.push(currentLine);
        }
      }
    } else {
      lines = text.split('\n');
    }

    // Draw background mask if enabled
    if (backgroundMask && lines.length > 0) {
      // Apply text case transformation for measuring
      const transformTextForMeasure = (t: string): string => {
        switch (textCase) {
          case 'uppercase': return t.toUpperCase();
          case 'lowercase': return t.toLowerCase();
          case 'capitalize': return t.replace(/\b\w/g, c => c.toUpperCase());
          default: return t;
        }
      };

      // Calculate text bounds (considering width factor and letter spacing)
      let maxWidth = 0;
      for (const line of lines) {
        const displayLine = transformTextForMeasure(line);
        let lineWidth: number;
        if (letterSpacing !== 1) {
          let totalWidth = 0;
          for (const char of displayLine.split('')) {
            totalWidth += ctx.measureText(char).width * letterSpacing;
          }
          if (displayLine.length > 0) {
            totalWidth -= ctx.measureText(displayLine[displayLine.length - 1]).width * (letterSpacing - 1);
          }
          lineWidth = totalWidth;
        } else {
          lineWidth = ctx.measureText(displayLine).width;
        }
        lineWidth *= widthFactor;
        if (lineWidth > maxWidth) maxWidth = lineWidth;
      }

      // Calculate total height including paragraph spacing
      let totalHeight = 0;
      for (let i = 0; i < lines.length; i++) {
        totalHeight += actualLineHeight;
        if (i > 0 && lines[i - 1] === '') {
          totalHeight += paragraphExtra;
        }
      }
      const padding = backgroundPadding * (isModelText ? 1 : (ShapeRenderer.REFERENCE_SCALE / this.drawingScale));

      // Calculate background rectangle position based on alignment
      let bgX = position.x - padding;
      if (alignment === 'center') bgX = position.x - maxWidth / 2 - padding;
      else if (alignment === 'right') bgX = position.x - maxWidth - padding;

      let bgY = position.y - padding;
      if (verticalAlignment === 'middle') bgY = position.y - actualLineHeight / 2 - padding;
      else if (verticalAlignment === 'bottom') bgY = position.y - actualLineHeight - padding;

      const bgWidth = maxWidth + padding * 2;
      const bgHeight = totalHeight + padding * 2;

      // Draw background
      let bgColor = backgroundColor;
      if (invertColors && bgColor === '#1a1a2e') {
        bgColor = '#ffffff';
      }
      ctx.fillStyle = bgColor;
      ctx.fillRect(bgX, bgY, bgWidth, bgHeight);

      // Reset fill style for text
      ctx.fillStyle = textColor;
    }

    // Apply text case transformation
    const transformText = (t: string): string => {
      switch (textCase) {
        case 'uppercase': return t.toUpperCase();
        case 'lowercase': return t.toLowerCase();
        case 'capitalize': return t.replace(/\b\w/g, c => c.toUpperCase());
        default: return t;
      }
    };

    // Calculate cumulative Y offset with paragraph spacing
    let cumulativeY = 0;

    // Draw text lines
    for (let i = 0; i < lines.length; i++) {
      const originalLine = lines[i];
      const displayLine = transformText(originalLine);
      const y = position.y + cumulativeY;

      // Check if this is a paragraph break (empty line or following empty line)
      const isParagraphBreak = i > 0 && lines[i - 1] === '';

      ctx.save();

      // Apply width factor and oblique angle transforms
      if (widthFactor !== 1 || obliqueAngle !== 0) {
        // Calculate transform origin based on alignment
        let transformOriginX = position.x;
        if (alignment === 'center') {
          const metrics = ctx.measureText(displayLine);
          transformOriginX = position.x - metrics.width / 2;
        } else if (alignment === 'right') {
          const metrics = ctx.measureText(displayLine);
          transformOriginX = position.x - metrics.width;
        }

        ctx.translate(transformOriginX, y);
        // Apply skew (oblique angle) - convert from degrees to radians
        const skewAngle = (obliqueAngle * Math.PI) / 180;
        // Apply width factor and oblique transforms
        // Matrix: [widthFactor, 0, tan(skew), 1, 0, 0]
        ctx.transform(widthFactor, 0, Math.tan(skewAngle), 1, 0, 0);
        ctx.translate(-transformOriginX, -y);
      }

      // Draw text with letter spacing
      if (letterSpacing !== 1 && displayLine.length > 0) {
        // Manual character-by-character rendering for letter spacing
        const chars = displayLine.split('');
        let currentX = position.x;

        // Adjust starting position for alignment
        if (alignment === 'center' || alignment === 'right') {
          let totalWidth = 0;
          for (const char of chars) {
            totalWidth += ctx.measureText(char).width * letterSpacing;
          }
          // Remove extra spacing at the end
          totalWidth -= ctx.measureText(chars[chars.length - 1]).width * (letterSpacing - 1);
          if (alignment === 'center') currentX -= totalWidth / 2;
          else if (alignment === 'right') currentX -= totalWidth;
        }

        for (let c = 0; c < chars.length; c++) {
          ctx.fillText(chars[c], currentX, y);
          const charWidth = ctx.measureText(chars[c]).width;
          currentX += charWidth * letterSpacing;
        }
      } else {
        ctx.fillText(displayLine, position.x, y);
      }

      ctx.restore();

      // Calculate line width for underline/strikethrough
      const metrics = ctx.measureText(displayLine);
      let lineWidth = metrics.width * widthFactor;
      if (letterSpacing !== 1) {
        // Recalculate width with letter spacing
        let totalWidth = 0;
        for (const char of displayLine.split('')) {
          totalWidth += ctx.measureText(char).width * letterSpacing;
        }
        if (displayLine.length > 0) {
          totalWidth -= ctx.measureText(displayLine[displayLine.length - 1]).width * (letterSpacing - 1);
        }
        lineWidth = totalWidth * widthFactor;
      }

      // Calculate starting X for decorations
      let startX = position.x;
      if (alignment === 'center') startX -= lineWidth / 2;
      else if (alignment === 'right') startX -= lineWidth;

      // Draw underline if enabled
      if (underline && displayLine.length > 0) {
        ctx.strokeStyle = textColor;
        ctx.lineWidth = Math.max(1, effectiveFontSize * 0.05);
        ctx.beginPath();
        ctx.moveTo(startX, y + effectiveFontSize + 2);
        ctx.lineTo(startX + lineWidth, y + effectiveFontSize + 2);
        ctx.stroke();
      }

      // Draw strikethrough if enabled
      if (strikethrough && displayLine.length > 0) {
        ctx.strokeStyle = textColor;
        ctx.lineWidth = Math.max(1, effectiveFontSize * 0.05);
        ctx.beginPath();
        // Position strikethrough at roughly middle of the text
        const strikethroughY = y + effectiveFontSize * 0.35;
        ctx.moveTo(startX, strikethroughY);
        ctx.lineTo(startX + lineWidth, strikethroughY);
        ctx.stroke();
      }

      // Update cumulative Y position
      cumulativeY += actualLineHeight;
      // Add extra spacing after paragraph breaks
      if (isParagraphBreak) {
        cumulativeY += paragraphExtra;
      }
    }

    ctx.restore();

    // Draw leader lines if present
    if (shape.leaderPoints && shape.leaderPoints.length > 0) {
      ctx.save();
      const leaderConfig = shape.leaderConfig;
      let leaderColor = leaderConfig?.color || color || shape.style.strokeColor;
      if (invertColors && leaderColor === '#ffffff') {
        leaderColor = '#000000';
      }
      ctx.strokeStyle = leaderColor;
      ctx.fillStyle = leaderColor;
      ctx.lineWidth = leaderConfig?.lineWeight ?? 1;
      ctx.setLineDash([]);

      // Draw landing line (shoulder) if enabled
      const hasLanding = leaderConfig?.hasLanding ?? true;
      const landingLength = leaderConfig?.landingLength ?? 5;
      let leaderStartX = position.x;
      let leaderStartY = position.y;

      if (hasLanding && landingLength > 0) {
        // Determine landing direction based on first leader point
        const firstPt = shape.leaderPoints[0];
        const landingDir = firstPt.x > position.x ? 1 : -1;
        const landingEndX = position.x + landingDir * landingLength;

        ctx.beginPath();
        ctx.moveTo(position.x, position.y);
        ctx.lineTo(landingEndX, position.y);
        ctx.stroke();

        leaderStartX = landingEndX;
      }

      // Draw main leader line
      ctx.beginPath();
      ctx.moveTo(leaderStartX, leaderStartY);
      for (const pt of shape.leaderPoints) {
        ctx.lineTo(pt.x, pt.y);
      }
      ctx.stroke();

      // Draw arrow/terminator at the last leader point
      if (shape.leaderPoints.length >= 1) {
        const lastPt = shape.leaderPoints[shape.leaderPoints.length - 1];
        const prevPt = shape.leaderPoints.length > 1
          ? shape.leaderPoints[shape.leaderPoints.length - 2]
          : { x: leaderStartX, y: leaderStartY };
        const arrowAngle = Math.atan2(lastPt.y - prevPt.y, lastPt.x - prevPt.x);
        const arrowType = leaderConfig?.arrowType ?? 'arrow';
        const arrowSize = leaderConfig?.arrowSize ?? 6;

        switch (arrowType) {
          case 'arrow':
            // Open arrow
            ctx.beginPath();
            ctx.moveTo(lastPt.x, lastPt.y);
            ctx.lineTo(
              lastPt.x - arrowSize * Math.cos(arrowAngle - 0.4),
              lastPt.y - arrowSize * Math.sin(arrowAngle - 0.4)
            );
            ctx.moveTo(lastPt.x, lastPt.y);
            ctx.lineTo(
              lastPt.x - arrowSize * Math.cos(arrowAngle + 0.4),
              lastPt.y - arrowSize * Math.sin(arrowAngle + 0.4)
            );
            ctx.stroke();
            break;

          case 'filled-arrow':
            // Filled arrow triangle
            ctx.beginPath();
            ctx.moveTo(lastPt.x, lastPt.y);
            ctx.lineTo(
              lastPt.x - arrowSize * Math.cos(arrowAngle - 0.35),
              lastPt.y - arrowSize * Math.sin(arrowAngle - 0.35)
            );
            ctx.lineTo(
              lastPt.x - arrowSize * Math.cos(arrowAngle + 0.35),
              lastPt.y - arrowSize * Math.sin(arrowAngle + 0.35)
            );
            ctx.closePath();
            ctx.fill();
            break;

          case 'dot':
            // Filled dot
            ctx.beginPath();
            ctx.arc(lastPt.x, lastPt.y, arrowSize / 2, 0, Math.PI * 2);
            ctx.fill();
            break;

          case 'slash':
            // Diagonal slash mark
            const slashLen = arrowSize / 1.5;
            const perpAngle = arrowAngle + Math.PI / 2;
            ctx.beginPath();
            ctx.moveTo(
              lastPt.x + slashLen * Math.cos(perpAngle),
              lastPt.y + slashLen * Math.sin(perpAngle)
            );
            ctx.lineTo(
              lastPt.x - slashLen * Math.cos(perpAngle),
              lastPt.y - slashLen * Math.sin(perpAngle)
            );
            ctx.stroke();
            break;

          case 'none':
            // No terminator
            break;
        }
      }
      ctx.restore();
    }

    // Draw selection box if selected
    if (isSelected) {
      this.drawTextSelectionBox(shape);
    }
  }

  private drawTextSelectionBox(shape: Shape): void {
    if (shape.type !== 'text') return;
    const ctx = this.ctx;

    const { position, text, fontSize, fontFamily, rotation, alignment, verticalAlignment, bold, italic, lineHeight = 1.2, isModelText = false, fixedWidth } = shape;

    // Get zoom BEFORE applying rotation (rotation affects getTransform().a)
    const zoom = ctx.getTransform().a / this.dpr;

    ctx.save();

    // Apply rotation around position (same as drawText)
    if (rotation !== 0) {
      ctx.translate(position.x, position.y);
      ctx.rotate(rotation);
      ctx.translate(-position.x, -position.y);
    }

    // Calculate effective font size (same as drawText)
    const effectiveFontSize = isModelText
      ? fontSize
      : fontSize * (ShapeRenderer.REFERENCE_SCALE / this.drawingScale);

    // Set font and baseline to match drawText rendering
    const fontStyle = `${italic ? 'italic ' : ''}${bold ? 'bold ' : ''}`;
    ctx.font = `${fontStyle}${effectiveFontSize}px ${fontFamily}`;
    ctx.textBaseline = verticalAlignment === 'middle' ? 'middle' :
                       verticalAlignment === 'bottom' ? 'bottom' : 'top';

    const actualLineHeight = effectiveFontSize * lineHeight;

    // Calculate wrapped lines if fixedWidth is set (same logic as drawText)
    let lines: string[];
    if (fixedWidth && fixedWidth > 0) {
      lines = [];
      const paragraphs = text.split('\n');
      for (const paragraph of paragraphs) {
        if (paragraph === '') {
          lines.push('');
          continue;
        }

        const words = paragraph.split(' ');
        let currentLine = '';

        for (const word of words) {
          // Check if the word itself is too long and needs character-level breaking
          const wordMetrics = ctx.measureText(word);
          if (wordMetrics.width > fixedWidth) {
            // Push current line if it has content
            if (currentLine) {
              lines.push(currentLine);
              currentLine = '';
            }
            // Break the word character by character
            let charLine = '';
            for (const char of word) {
              const testCharLine = charLine + char;
              const charMetrics = ctx.measureText(testCharLine);
              if (charMetrics.width > fixedWidth && charLine) {
                lines.push(charLine);
                charLine = char;
              } else {
                charLine = testCharLine;
              }
            }
            currentLine = charLine;
          } else {
            const testLine = currentLine ? `${currentLine} ${word}` : word;
            const metrics = ctx.measureText(testLine);
            if (metrics.width > fixedWidth && currentLine) {
              lines.push(currentLine);
              currentLine = word;
            } else {
              currentLine = testLine;
            }
          }
        }

        if (currentLine) lines.push(currentLine);
      }
    } else {
      lines = text.split('\n');
    }

    // Use actual font metrics for accurate bounds
    let maxWidth = fixedWidth || 0;
    let maxAscent = 0;
    let maxDescent = 0;
    for (const line of lines) {
      const metrics = ctx.measureText(line);
      if (!fixedWidth && metrics.width > maxWidth) maxWidth = metrics.width;
      if (metrics.actualBoundingBoxAscent > maxAscent) maxAscent = metrics.actualBoundingBoxAscent;
      if (metrics.actualBoundingBoxDescent > maxDescent) maxDescent = metrics.actualBoundingBoxDescent;
    }

    // First line top/bottom from actual metrics, remaining lines offset by lineHeight
    const topY = position.y - maxAscent;
    const bottomY = position.y + maxDescent + (lines.length - 1) * actualLineHeight;
    const boxHeight = bottomY - topY;

    // Calculate bounding box based on alignment
    let minX = position.x;
    if (alignment === 'center') minX -= maxWidth / 2;
    else if (alignment === 'right') minX -= maxWidth;

    // Draw selection rectangle
    ctx.strokeStyle = COLORS.selection;
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.strokeRect(minX - 2, topY - 2, maxWidth + 4, boxHeight + 4);
    ctx.setLineDash([]);

    // Draw resize handles on left and right edges
    const handleSize = 6 / zoom;
    const midY = topY + boxHeight / 2;

    ctx.fillStyle = COLORS.selectionHandle;
    ctx.strokeStyle = COLORS.selectionHandleStroke;
    ctx.lineWidth = 1 / zoom;

    // Left resize handle (horizontal bar style for width resize)
    const leftHandleX = minX - 2;
    ctx.fillRect(leftHandleX - handleSize / 2, midY - handleSize, handleSize, handleSize * 2);
    ctx.strokeRect(leftHandleX - handleSize / 2, midY - handleSize, handleSize, handleSize * 2);
    // Draw X-axis only arrow on left handle (pointing left to indicate resize direction)
    this.drawXAxisArrow({ x: leftHandleX, y: midY }, zoom, 'left');

    // Right resize handle
    const rightHandleX = minX + maxWidth + 2;
    ctx.fillRect(rightHandleX - handleSize / 2, midY - handleSize, handleSize, handleSize * 2);
    ctx.strokeRect(rightHandleX - handleSize / 2, midY - handleSize, handleSize, handleSize * 2);
    // Draw X-axis only arrow on right handle (pointing right to indicate resize direction)
    this.drawXAxisArrow({ x: rightHandleX, y: midY }, zoom, 'right');

    // Draw move handle at center of text box
    const centerX = minX + maxWidth / 2;
    ctx.fillRect(centerX - handleSize / 2, midY - handleSize / 2, handleSize, handleSize);
    ctx.strokeRect(centerX - handleSize / 2, midY - handleSize / 2, handleSize, handleSize);

    // Draw axis arrows on move handle
    this.drawAxisArrows({ x: centerX, y: midY }, zoom);

    // Draw rotation handle above the text box
    const rotationHandleDistance = 25 / zoom; // Distance from top of box to rotation handle
    const rotationHandleY = topY - 2 - rotationHandleDistance;
    const rotationHandleRadius = handleSize * 0.6;

    // Draw connecting line from top center to rotation handle
    ctx.strokeStyle = COLORS.selection;
    ctx.lineWidth = 1 / zoom;
    ctx.beginPath();
    ctx.moveTo(centerX, topY - 2);
    ctx.lineTo(centerX, rotationHandleY);
    ctx.stroke();

    // Draw circular rotation handle
    ctx.fillStyle = '#90EE90'; // Light green for rotation
    ctx.strokeStyle = COLORS.selectionHandleStroke;
    ctx.beginPath();
    ctx.arc(centerX, rotationHandleY, rotationHandleRadius, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // Draw rotation arrow icon inside the handle
    ctx.strokeStyle = '#006400'; // Dark green
    ctx.lineWidth = 1.5 / zoom;
    const iconRadius = rotationHandleRadius * 0.6;
    ctx.beginPath();
    ctx.arc(centerX, rotationHandleY, iconRadius, -Math.PI * 0.7, Math.PI * 0.3);
    ctx.stroke();
    // Arrowhead
    const arrowTipAngle = Math.PI * 0.3;
    const arrowTipX = centerX + iconRadius * Math.cos(arrowTipAngle);
    const arrowTipY = rotationHandleY + iconRadius * Math.sin(arrowTipAngle);
    const arrowHeadSize = 3 / zoom;
    ctx.beginPath();
    ctx.moveTo(arrowTipX, arrowTipY);
    ctx.lineTo(arrowTipX - arrowHeadSize, arrowTipY - arrowHeadSize);
    ctx.moveTo(arrowTipX, arrowTipY);
    ctx.lineTo(arrowTipX + arrowHeadSize * 0.5, arrowTipY - arrowHeadSize);
    ctx.stroke();

    ctx.restore();
  }

  private drawSelectionHandles(shape: Shape): void {
    const ctx = this.ctx;
    // Keep handles at a constant screen-pixel size, but never smaller than the shape's stroke
    const zoom = ctx.getTransform().a / this.dpr;
    const screenSize = 6 / zoom;
    const strokeWidth = shape.style?.strokeWidth ?? 1;
    const handleSize = Math.max(screenSize, strokeWidth + 4 / zoom);

    ctx.fillStyle = COLORS.selectionHandle;
    ctx.strokeStyle = COLORS.selectionHandleStroke;
    ctx.lineWidth = 1 / zoom;

    const points = this.getShapeHandlePoints(shape);

    const hover = getGripHover();

    for (let i = 0; i < points.length; i++) {
      const point = points[i];
      ctx.fillStyle = COLORS.selectionHandle;
      ctx.strokeStyle = COLORS.selectionHandleStroke;
      ctx.lineWidth = 1 / zoom;
      ctx.fillRect(point.x - handleSize / 2, point.y - handleSize / 2, handleSize, handleSize);
      ctx.strokeRect(point.x - handleSize / 2, point.y - handleSize / 2, handleSize, handleSize);
      // Skip axis arrows on arc midpoint grip and image corner/side grips (only center grip 8 gets arrows)
      if (!(shape.type === 'arc' && i === 3) && !(shape.type === 'image' && i !== 8)) {
        // For line/beam midpoint (index 2), align axes along/perpendicular to the shape
        let angle = 0;
        if (i === 2 && (shape.type === 'line' || shape.type === 'beam')) {
          angle = Math.atan2(shape.end.y - shape.start.y, shape.end.x - shape.start.x);
        }
        // Determine which axis is hovered for highlighting
        const hoveredAxis = (hover && hover.shapeId === shape.id && hover.gripIndex === i) ? hover.axis : null;
        this.drawAxisArrows(point, zoom, angle, hoveredAxis);
      }
    }
  }

  /**
   * Draw X (red) and Y (green) axis-constraint arrows at a grip point.
   * Arrow length is constant in screen space (~20px).
   * When angle is provided, axes are rotated to align along/perpendicular to the shape.
   * When hoveredAxis is provided, that arrow is drawn highlighted (brighter, thicker).
   */
  private drawAxisArrows(point: { x: number; y: number }, zoom: number, angle: number = 0, hoveredAxis: 'x' | 'y' | null = null): void {
    const ctx = this.ctx;
    const arrowLen = 20 / zoom;
    const headLen = 5 / zoom;
    const headWidth = 3 / zoom;

    const cosA = Math.cos(angle);
    const sinA = Math.sin(angle);

    // Perpendicular direction (rotated 90 degrees CCW)
    const cosP = Math.cos(angle - Math.PI / 2);
    const sinP = Math.sin(angle - Math.PI / 2);

    ctx.save();

    // Along-shape axis arrow (red, along the shape direction)
    const xHovered = hoveredAxis === 'x';
    ctx.strokeStyle = xHovered ? '#ff8888' : COLORS.axisX;
    ctx.fillStyle = xHovered ? '#ff8888' : COLORS.axisX;
    ctx.lineWidth = (xHovered ? 2.5 : 1.5) / zoom;
    ctx.beginPath();
    ctx.moveTo(point.x, point.y);
    ctx.lineTo(point.x + cosA * arrowLen, point.y + sinA * arrowLen);
    ctx.stroke();
    // Arrowhead
    ctx.beginPath();
    ctx.moveTo(point.x + cosA * arrowLen, point.y + sinA * arrowLen);
    ctx.lineTo(
      point.x + cosA * (arrowLen - headLen) - sinA * headWidth,
      point.y + sinA * (arrowLen - headLen) + cosA * headWidth
    );
    ctx.lineTo(
      point.x + cosA * (arrowLen - headLen) + sinA * headWidth,
      point.y + sinA * (arrowLen - headLen) - cosA * headWidth
    );
    ctx.closePath();
    ctx.fill();

    // Perpendicular axis arrow (green, perpendicular to the shape direction)
    const yHovered = hoveredAxis === 'y';
    ctx.strokeStyle = yHovered ? '#88ff88' : COLORS.axisY;
    ctx.fillStyle = yHovered ? '#88ff88' : COLORS.axisY;
    ctx.lineWidth = (yHovered ? 2.5 : 1.5) / zoom;
    ctx.beginPath();
    ctx.moveTo(point.x, point.y);
    ctx.lineTo(point.x + cosP * arrowLen, point.y + sinP * arrowLen);
    ctx.stroke();
    // Arrowhead
    ctx.beginPath();
    ctx.moveTo(point.x + cosP * arrowLen, point.y + sinP * arrowLen);
    ctx.lineTo(
      point.x + cosP * (arrowLen - headLen) - sinP * headWidth,
      point.y + sinP * (arrowLen - headLen) + cosP * headWidth
    );
    ctx.lineTo(
      point.x + cosP * (arrowLen - headLen) + sinP * headWidth,
      point.y + sinP * (arrowLen - headLen) - cosP * headWidth
    );
    ctx.closePath();
    ctx.fill();

    ctx.restore();
  }

  /**
   * Draw a single X-axis arrow for text resize handles.
   * Direction can be 'left' or 'right' to indicate resize direction.
   */
  private drawXAxisArrow(point: { x: number; y: number }, zoom: number, direction: 'left' | 'right'): void {
    const ctx = this.ctx;
    const arrowLen = 15 / zoom;
    const headLen = 4 / zoom;
    const headWidth = 2.5 / zoom;

    ctx.save();

    ctx.strokeStyle = COLORS.axisX;
    ctx.fillStyle = COLORS.axisX;
    ctx.lineWidth = 1.5 / zoom;

    if (direction === 'right') {
      // Arrow pointing right
      ctx.beginPath();
      ctx.moveTo(point.x, point.y);
      ctx.lineTo(point.x + arrowLen, point.y);
      ctx.stroke();
      // Arrowhead
      ctx.beginPath();
      ctx.moveTo(point.x + arrowLen, point.y);
      ctx.lineTo(point.x + arrowLen - headLen, point.y - headWidth);
      ctx.lineTo(point.x + arrowLen - headLen, point.y + headWidth);
      ctx.closePath();
      ctx.fill();
    } else {
      // Arrow pointing left
      ctx.beginPath();
      ctx.moveTo(point.x, point.y);
      ctx.lineTo(point.x - arrowLen, point.y);
      ctx.stroke();
      // Arrowhead
      ctx.beginPath();
      ctx.moveTo(point.x - arrowLen, point.y);
      ctx.lineTo(point.x - arrowLen + headLen, point.y - headWidth);
      ctx.lineTo(point.x - arrowLen + headLen, point.y + headWidth);
      ctx.closePath();
      ctx.fill();
    }

    ctx.restore();
  }

  private getShapeHandlePoints(shape: Shape): { x: number; y: number }[] {
    switch (shape.type) {
      case 'line':
        return [
          shape.start,
          shape.end,
          { x: (shape.start.x + shape.end.x) / 2, y: (shape.start.y + shape.end.y) / 2 },
        ];
      case 'rectangle': {
        const tl = shape.topLeft;
        const w = shape.width;
        const h = shape.height;
        const rot = shape.rotation || 0;
        const cos = Math.cos(rot);
        const sin = Math.sin(rot);
        // topLeft is the rotation origin; offsets are in local space
        const toWorld = (lx: number, ly: number) => ({
          x: tl.x + lx * cos - ly * sin,
          y: tl.y + lx * sin + ly * cos,
        });
        return [
          toWorld(0, 0),
          toWorld(w, 0),
          toWorld(w, h),
          toWorld(0, h),
          toWorld(w / 2, 0),
          toWorld(w, h / 2),
          toWorld(w / 2, h),
          toWorld(0, h / 2),
          toWorld(w / 2, h / 2),
        ];
      }
      case 'circle':
        return [
          shape.center,
          { x: shape.center.x + shape.radius, y: shape.center.y },
          { x: shape.center.x - shape.radius, y: shape.center.y },
          { x: shape.center.x, y: shape.center.y + shape.radius },
          { x: shape.center.x, y: shape.center.y - shape.radius },
        ];
      case 'arc': {
        // Arc handles: center, start point, end point, midpoint (on curve)
        const midAngle = shape.startAngle + ((shape.endAngle - shape.startAngle + 2 * Math.PI) % (2 * Math.PI)) / 2;
        return [
          shape.center,
          { x: shape.center.x + shape.radius * Math.cos(shape.startAngle), y: shape.center.y + shape.radius * Math.sin(shape.startAngle) },
          { x: shape.center.x + shape.radius * Math.cos(shape.endAngle), y: shape.center.y + shape.radius * Math.sin(shape.endAngle) },
          { x: shape.center.x + shape.radius * Math.cos(midAngle), y: shape.center.y + shape.radius * Math.sin(midAngle) },
        ];
      }
      case 'ellipse': {
        const rot = shape.rotation || 0;
        const cos = Math.cos(rot);
        const sin = Math.sin(rot);
        const cx = shape.center.x;
        const cy = shape.center.y;
        // Transform local ellipse coordinates to world coordinates
        const toWorld = (lx: number, ly: number) => ({
          x: cx + lx * cos - ly * sin,
          y: cy + lx * sin + ly * cos,
        });
        return [
          shape.center,                                    // Center grip
          toWorld(shape.radiusX, 0),                       // Right grip
          toWorld(-shape.radiusX, 0),                      // Left grip
          toWorld(0, shape.radiusY),                       // Bottom grip
          toWorld(0, -shape.radiusY),                      // Top grip
        ];
      }
      case 'polyline': {
        const pts: { x: number; y: number }[] = [...shape.points];
        const segCount = shape.closed ? shape.points.length : shape.points.length - 1;
        for (let i = 0; i < segCount; i++) {
          const j = (i + 1) % shape.points.length;
          const b = shape.bulge?.[i] ?? 0;
          if (b !== 0) {
            pts.push(bulgeArcMidpoint(shape.points[i], shape.points[j], b));
          } else {
            pts.push({
              x: (shape.points[i].x + shape.points[j].x) / 2,
              y: (shape.points[i].y + shape.points[j].y) / 2,
            });
          }
        }
        return pts;
      }
      case 'spline': {
        const pts: { x: number; y: number }[] = [...shape.points];
        const segCount = shape.closed ? shape.points.length : shape.points.length - 1;
        for (let i = 0; i < segCount; i++) {
          const j = (i + 1) % shape.points.length;
          pts.push({
            x: (shape.points[i].x + shape.points[j].x) / 2,
            y: (shape.points[i].y + shape.points[j].y) / 2,
          });
        }
        return pts;
      }
      case 'text':
        // Text uses selection box instead of handles
        return [shape.position];
      case 'hatch': {
        const pts: { x: number; y: number }[] = [...shape.points];
        // Add edge midpoints
        for (let i = 0; i < shape.points.length; i++) {
          const j = (i + 1) % shape.points.length;
          pts.push({
            x: (shape.points[i].x + shape.points[j].x) / 2,
            y: (shape.points[i].y + shape.points[j].y) / 2,
          });
        }
        return pts;
      }
      case 'beam':
        // Beam handles: start, end, and midpoint
        return [
          shape.start,
          shape.end,
          { x: (shape.start.x + shape.end.x) / 2, y: (shape.start.y + shape.end.y) / 2 },
        ];
      case 'image': {
        const imgShape = shape as ImageShape;
        const tl = imgShape.position;
        const w = imgShape.width;
        const h = imgShape.height;
        const rot = imgShape.rotation || 0;
        const cos = Math.cos(rot);
        const sin = Math.sin(rot);
        const toWorld = (lx: number, ly: number) => ({
          x: tl.x + lx * cos - ly * sin,
          y: tl.y + lx * sin + ly * cos,
        });
        return [
          toWorld(0, 0),
          toWorld(w, 0),
          toWorld(w, h),
          toWorld(0, h),
          toWorld(w / 2, 0),
          toWorld(w, h / 2),
          toWorld(w / 2, h),
          toWorld(0, h / 2),
          toWorld(w / 2, h / 2),
        ];
      }
      default:
        return [];
    }
  }

  private drawImage(shape: ImageShape): void {
    const ctx = this.ctx;
    let img = this.imageCache.get(shape.id);

    if (!img) {
      // Create and cache the image element
      img = new Image();
      img.src = shape.imageData;
      this.imageCache.set(shape.id, img);
      // Request a re-render once the image loads
      img.onload = () => {
        // The canvas render loop will pick it up on next frame
      };
    }

    // Only draw if image has loaded
    if (!img.complete || img.naturalWidth === 0) return;

    ctx.save();

    // Apply opacity
    if (shape.opacity !== undefined && shape.opacity < 1) {
      ctx.globalAlpha = shape.opacity;
    }

    // Apply rotation around the top-left corner
    if (shape.rotation) {
      ctx.translate(shape.position.x, shape.position.y);
      ctx.rotate(shape.rotation);
      ctx.drawImage(img, 0, 0, shape.width, shape.height);
    } else {
      ctx.drawImage(img, shape.position.x, shape.position.y, shape.width, shape.height);
    }

    ctx.restore();
  }

  private drawHatch(shape: HatchShape, invertColors: boolean = false): void {
    const ctx = this.ctx;

    // Apply live preview override if this shape is selected and a preview pattern is active
    let effectiveShape = shape;
    if (this.previewPatternId && this.previewSelectedIds.has(shape.id)) {
      const previewPattern = BUILTIN_PATTERNS.find(p => p.id === this.previewPatternId)
        || this.customPatterns.find(p => p.id === this.previewPatternId);
      if (previewPattern) {
        const isBuiltin = BUILTIN_PATTERNS.some(p => p.id === previewPattern.id);
        effectiveShape = {
          ...shape,
          patternType: isBuiltin ? previewPattern.id as HatchPatternType : 'custom',
          customPatternId: isBuiltin ? undefined : previewPattern.id,
        };
      }
    }

    const { points, bulge, patternType, patternAngle, patternScale, fillColor, backgroundColor, customPatternId } = effectiveShape;
    const boundaryVisible = effectiveShape.boundaryVisible ?? true;
    const innerLoops = effectiveShape.innerLoops;

    if (points.length < 3) return;

    // Build outer boundary path (supports bulge/arc segments like polyline)
    const buildOuterPath = () => {
      ctx.moveTo(points[0].x, points[0].y);

      for (let i = 0; i < points.length - 1; i++) {
        const b = bulge?.[i] ?? 0;
        if (b !== 0) {
          const arc = bulgeToArc(points[i], points[i + 1], b);
          ctx.arc(arc.center.x, arc.center.y, arc.radius, arc.startAngle, arc.endAngle, arc.clockwise);
        } else {
          ctx.lineTo(points[i + 1].x, points[i + 1].y);
        }
      }

      // Close path (handle last segment bulge)
      const lastB = bulge?.[points.length - 1] ?? 0;
      if (lastB !== 0) {
        const arc = bulgeToArc(points[points.length - 1], points[0], lastB);
        ctx.arc(arc.center.x, arc.center.y, arc.radius, arc.startAngle, arc.endAngle, arc.clockwise);
      } else {
        ctx.closePath();
      }
    };

    // Build full path with inner loops (holes) using evenodd winding rule
    const buildPath = () => {
      ctx.beginPath();
      buildOuterPath();

      // Add inner loops (drawn in reverse winding for evenodd cutout)
      if (innerLoops && innerLoops.length > 0) {
        for (const loop of innerLoops) {
          if (loop.length < 3) continue;
          ctx.moveTo(loop[0].x, loop[0].y);
          for (let i = 1; i < loop.length; i++) {
            ctx.lineTo(loop[i].x, loop[i].y);
          }
          ctx.closePath();
        }
      }
    };

    // Step 1: Fill solid background if masking is on or backgroundColor is set
    if (backgroundColor) {
      buildPath();
      ctx.fillStyle = backgroundColor;
      ctx.fill('evenodd');
    }

    // Get bounding box
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of points) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }

    // Step 2: Render background pattern layer (if set)
    if (shape.bgPatternType) {
      const bgScale = shape.bgPatternScale ?? 1;
      const bgAngle = shape.bgPatternAngle ?? 0;
      let bgColor = shape.bgFillColor ?? '#808080';
      if (invertColors && bgColor === '#ffffff') bgColor = '#000000';

      ctx.save();
      buildPath();
      ctx.clip('evenodd');

      this.renderPatternLayer(
        shape.bgPatternType, bgAngle, bgScale, bgColor,
        shape.bgCustomPatternId, shape.style.strokeWidth,
        minX, minY, maxX, maxY
      );

      ctx.restore();
    }

    // Step 3: Render foreground pattern layer
    let patternColor = fillColor;
    if (invertColors && patternColor === '#ffffff') {
      patternColor = '#000000';
    }

    ctx.save();
    buildPath();
    ctx.clip('evenodd');

    this.renderPatternLayer(
      patternType, patternAngle, patternScale, patternColor,
      customPatternId, shape.style.strokeWidth,
      minX, minY, maxX, maxY
    );

    ctx.restore();

    // Step 4: Stroke boundary (only if visible)
    if (boundaryVisible) {
      ctx.beginPath();
      buildOuterPath();
      ctx.stroke();

      // Also stroke inner loops
      if (innerLoops && innerLoops.length > 0) {
        for (const loop of innerLoops) {
          if (loop.length < 3) continue;
          ctx.beginPath();
          ctx.moveTo(loop[0].x, loop[0].y);
          for (let i = 1; i < loop.length; i++) {
            ctx.lineTo(loop[i].x, loop[i].y);
          }
          ctx.closePath();
          ctx.stroke();
        }
      }
    }
  }

  /**
   * Render a single pattern layer within the current clip region
   */
  private renderPatternLayer(
    pType: HatchPatternType,
    pAngle: number,
    pScale: number,
    pColor: string,
    pCustomId: string | undefined,
    strokeWidth: number,
    minX: number, minY: number, maxX: number, maxY: number
  ): void {
    const ctx = this.ctx;

    if (pType === 'custom' && pCustomId) {
      const customPattern = this.getPatternById(pCustomId);
      if (customPattern) {
        if (isSvgHatchPattern(customPattern)) {
          this.drawSvgPattern(customPattern, minX, minY, maxX, maxY, pScale, pAngle);
        } else if (customPattern.lineFamilies.length > 0) {
          this.drawCustomPatternLines(customPattern.lineFamilies, minX, minY, maxX, maxY, pScale, pAngle, pColor, strokeWidth);
        } else {
          ctx.fillStyle = pColor;
          ctx.fill();
        }
      }
    } else if (pType === 'solid') {
      ctx.fillStyle = pColor;
      ctx.fill();
    } else if (pType === 'dots') {
      const spacing = 10 * pScale;
      const dotRadius = 1 * pScale;
      ctx.fillStyle = pColor;
      for (let x = minX; x <= maxX; x += spacing) {
        for (let y = minY; y <= maxY; y += spacing) {
          ctx.beginPath();
          ctx.arc(x, y, dotRadius, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    } else {
      const spacing = 10 * pScale;
      const angles: number[] = [];

      switch (pType) {
        case 'horizontal':
          angles.push(0);
          break;
        case 'vertical':
          angles.push(90);
          break;
        case 'diagonal':
          angles.push(pAngle);
          break;
        case 'crosshatch':
          angles.push(pAngle);
          angles.push(pAngle + 90);
          break;
      }

      ctx.strokeStyle = pColor;
      ctx.lineWidth = strokeWidth * 0.5;
      ctx.setLineDash([]);

      for (const angleDeg of angles) {
        this.drawLineFamilySimple(angleDeg, spacing, minX, minY, maxX, maxY);
      }
    }
  }

  /**
   * Draw a beam shape in plan view
   * Shows beam as a rectangle with optional centerline and label
   */
  private drawBeam(shape: BeamShape, invertColors: boolean = false): void {
    const ctx = this.ctx;
    const { start, end, flangeWidth, showCenterline, showLabel, labelText, presetName, material } = shape;

    const beamAngle = Math.atan2(end.y - start.y, end.x - start.x);
    const halfWidth = flangeWidth / 2;
    const perpX = Math.sin(beamAngle) * halfWidth;
    const perpY = Math.cos(beamAngle) * halfWidth;

    // Determine line style based on material
    const originalLineWidth = ctx.lineWidth;
    if (material === 'concrete') {
      ctx.lineWidth = originalLineWidth * 1.5;
    } else if (material === 'timber') {
      ctx.lineWidth = originalLineWidth * 1.2;
    }

    // Draw beam outline (two parallel lines for flanges)
    ctx.beginPath();
    // Top flange edge
    ctx.moveTo(start.x + perpX, start.y - perpY);
    ctx.lineTo(end.x + perpX, end.y - perpY);
    ctx.stroke();

    // Bottom flange edge
    ctx.beginPath();
    ctx.moveTo(start.x - perpX, start.y + perpY);
    ctx.lineTo(end.x - perpX, end.y + perpY);
    ctx.stroke();

    // Draw end lines (perpendicular caps at start and end)
    ctx.beginPath();
    ctx.moveTo(start.x + perpX, start.y - perpY);
    ctx.lineTo(start.x - perpX, start.y + perpY);
    ctx.moveTo(end.x + perpX, end.y - perpY);
    ctx.lineTo(end.x - perpX, end.y + perpY);
    ctx.stroke();

    // Draw centerline (dashed)
    if (showCenterline) {
      ctx.save();
      ctx.setLineDash([10, 5, 2, 5]); // Dash-dot pattern for centerline
      let centerColor = 'rgba(255, 255, 255, 0.4)';
      if (invertColors) {
        centerColor = 'rgba(0, 0, 0, 0.4)';
      }
      ctx.strokeStyle = centerColor;
      ctx.lineWidth = originalLineWidth * 0.5;
      ctx.beginPath();
      ctx.moveTo(start.x, start.y);
      ctx.lineTo(end.x, end.y);
      ctx.stroke();
      ctx.restore();
    }

    // Draw label
    if (showLabel) {
      const beamLabel = labelText || presetName || `${Math.round(flangeWidth)}mm`;
      const midX = (start.x + end.x) / 2;
      const midY = (start.y + end.y) / 2;
      const zoom = ctx.getTransform().a / this.dpr;
      const fontSize = Math.max(10 / zoom, flangeWidth * 0.3);

      ctx.save();
      ctx.translate(midX, midY);
      // Rotate text to be readable (avoid upside-down text)
      let textAngle = beamAngle;
      if (textAngle > Math.PI / 2 || textAngle < -Math.PI / 2) {
        textAngle += Math.PI;
      }
      ctx.rotate(textAngle);

      let textColor = shape.style.strokeColor;
      if (invertColors && textColor === '#ffffff') {
        textColor = '#000000';
      }
      ctx.fillStyle = textColor;
      ctx.font = `${fontSize}px Arial`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      // Offset text above centerline
      ctx.fillText(beamLabel, 0, -halfWidth - fontSize * 0.8);
      ctx.restore();
    }

    // Restore original line width
    ctx.lineWidth = originalLineWidth;
  }

  /**
   * Draw an SVG-based pattern using canvas pattern fill
   */
  private drawSvgPattern(
    pattern: SvgHatchPattern,
    minX: number,
    minY: number,
    maxX: number,
    maxY: number,
    scale: number,
    rotationOffset: number
  ): void {
    const ctx = this.ctx;
    const img = this.getSvgPatternImage(pattern.id);

    if (!img) {
      // Image not loaded yet - trigger load and draw placeholder
      this.loadSvgPattern(pattern);
      // Draw a light gray placeholder
      ctx.fillStyle = 'rgba(128, 128, 128, 0.1)';
      ctx.fill();
      return;
    }

    // Calculate scaled tile dimensions
    const tileWidth = pattern.tileWidth * scale;
    const tileHeight = pattern.tileHeight * scale;

    // Create off-screen canvas for the scaled tile
    const tileCanvas = document.createElement('canvas');
    tileCanvas.width = tileWidth;
    tileCanvas.height = tileHeight;
    const tileCtx = tileCanvas.getContext('2d');

    if (!tileCtx) {
      ctx.fillStyle = 'rgba(128, 128, 128, 0.1)';
      ctx.fill();
      return;
    }

    // Draw the SVG image scaled to tile size
    tileCtx.drawImage(img, 0, 0, tileWidth, tileHeight);

    // Create canvas pattern
    const canvasPattern = ctx.createPattern(tileCanvas, 'repeat');
    if (!canvasPattern) {
      ctx.fillStyle = 'rgba(128, 128, 128, 0.1)';
      ctx.fill();
      return;
    }

    // Apply rotation if needed
    if (rotationOffset !== 0) {
      const cx = (minX + maxX) / 2;
      const cy = (minY + maxY) / 2;

      // Transform the pattern (rotateSelf uses degrees)
      const matrix = new DOMMatrix()
        .translateSelf(cx, cy)
        .rotateSelf(rotationOffset)
        .translateSelf(-cx, -cy);
      canvasPattern.setTransform(matrix);
    }

    ctx.fillStyle = canvasPattern;
    ctx.fill();
  }

  /**
   * Draw simple line family (for built-in patterns)
   */
  private drawLineFamilySimple(angleDeg: number, spacing: number, minX: number, minY: number, maxX: number, maxY: number): void {
    const ctx = this.ctx;
    const angleRad = (angleDeg * Math.PI) / 180;
    const cosA = Math.cos(angleRad);
    const sinA = Math.sin(angleRad);

    // Expand bounding box to cover rotated lines
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    const diagonal = Math.sqrt((maxX - minX) ** 2 + (maxY - minY) ** 2);
    const halfDiag = diagonal / 2 + spacing;

    // Draw parallel lines perpendicular to the angle direction
    const numLines = Math.ceil((halfDiag * 2) / spacing);

    ctx.beginPath();
    for (let i = -numLines; i <= numLines; i++) {
      const offset = i * spacing;
      // Line perpendicular offset from center
      const ox = cx + offset * (-sinA);
      const oy = cy + offset * cosA;
      // Line extends along the angle direction
      const x1 = ox - halfDiag * cosA;
      const y1 = oy - halfDiag * sinA;
      const x2 = ox + halfDiag * cosA;
      const y2 = oy + halfDiag * sinA;
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
    }
    ctx.stroke();
  }

  /**
   * Draw custom pattern line families with full support for origins, offsets, and dash patterns
   */
  private drawCustomPatternLines(
    lineFamilies: LineFamily[],
    minX: number,
    minY: number,
    maxX: number,
    maxY: number,
    scale: number,
    rotationOffset: number,
    defaultColor: string,
    defaultStrokeWidth: number
  ): void {
    const ctx = this.ctx;

    for (const family of lineFamilies) {
      // Apply scale to all dimensions
      const spacing = (family.deltaY || 10) * scale;
      const deltaX = (family.deltaX || 0) * scale;
      const originX = (family.originX || 0) * scale;
      const originY = (family.originY || 0) * scale;
      const angleDeg = family.angle + rotationOffset;
      const strokeWidth = family.strokeWidth ?? defaultStrokeWidth * 0.5;
      const strokeColor = family.strokeColor ?? defaultColor;

      // Set line style
      ctx.strokeStyle = strokeColor;
      ctx.lineWidth = strokeWidth;

      // Handle dash pattern
      if (family.dashPattern && family.dashPattern.length > 0) {
        // Convert dash pattern with scale
        const scaledDashPattern = family.dashPattern.map(d => Math.abs(d) * scale);
        // Check for dot (0 value means dot)
        if (family.dashPattern.includes(0)) {
          // Render as dots
          this.drawLineFamilyDots(angleDeg, spacing, deltaX, originX, originY, minX, minY, maxX, maxY, scale, strokeColor);
          continue;
        }
        ctx.setLineDash(scaledDashPattern);
      } else {
        ctx.setLineDash([]);
      }

      // Draw the line family
      this.drawLineFamilyWithOffset(angleDeg, spacing, deltaX, originX, originY, minX, minY, maxX, maxY);
    }

    // Reset dash
    ctx.setLineDash([]);
  }

  /**
   * Draw a line family with origin offset and stagger (deltaX)
   */
  private drawLineFamilyWithOffset(
    angleDeg: number,
    spacing: number,
    deltaX: number,
    originX: number,
    originY: number,
    minX: number,
    minY: number,
    maxX: number,
    maxY: number
  ): void {
    const ctx = this.ctx;
    const angleRad = (angleDeg * Math.PI) / 180;
    const cosA = Math.cos(angleRad);
    const sinA = Math.sin(angleRad);

    // Calculate coverage area
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    const diagonal = Math.sqrt((maxX - minX) ** 2 + (maxY - minY) ** 2);
    const halfDiag = diagonal / 2 + spacing * 2;

    // Number of lines needed
    const numLines = Math.ceil((halfDiag * 2) / spacing) + 2;

    ctx.beginPath();
    for (let i = -numLines; i <= numLines; i++) {
      // Perpendicular offset from center
      const perpOffset = i * spacing;

      // Apply stagger (deltaX) - shifts line along its direction based on perpendicular position
      const staggerOffset = deltaX !== 0 ? (i * deltaX) : 0;

      // Calculate line origin point
      // Start from center, move perpendicular to line direction
      const baseX = cx + perpOffset * (-sinA);
      const baseY = cy + perpOffset * cosA;

      // Apply origin offset and stagger
      const ox = baseX + originX + staggerOffset * cosA;
      const oy = baseY + originY + staggerOffset * sinA;

      // Line endpoints extend along the angle direction
      const x1 = ox - halfDiag * cosA;
      const y1 = oy - halfDiag * sinA;
      const x2 = ox + halfDiag * cosA;
      const y2 = oy + halfDiag * sinA;

      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
    }
    ctx.stroke();
  }

  /**
   * Draw dots for line families with dash pattern containing 0 (dot indicator)
   */
  private drawLineFamilyDots(
    angleDeg: number,
    spacing: number,
    deltaX: number,
    originX: number,
    originY: number,
    minX: number,
    minY: number,
    maxX: number,
    maxY: number,
    scale: number,
    color: string
  ): void {
    const ctx = this.ctx;
    const angleRad = (angleDeg * Math.PI) / 180;
    const cosA = Math.cos(angleRad);
    const sinA = Math.sin(angleRad);

    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    const diagonal = Math.sqrt((maxX - minX) ** 2 + (maxY - minY) ** 2);
    const halfDiag = diagonal / 2 + spacing * 2;

    const dotRadius = 1 * scale;
    const numLines = Math.ceil((halfDiag * 2) / spacing) + 2;
    const dotsPerLine = Math.ceil((halfDiag * 2) / (deltaX || spacing)) + 2;
    const dotSpacing = deltaX || spacing;

    ctx.fillStyle = color;

    for (let i = -numLines; i <= numLines; i++) {
      const perpOffset = i * spacing;
      const baseX = cx + perpOffset * (-sinA);
      const baseY = cy + perpOffset * cosA;

      for (let j = -dotsPerLine; j <= dotsPerLine; j++) {
        const alongOffset = j * dotSpacing;
        const dx = baseX + originX + alongOffset * cosA;
        const dy = baseY + originY + alongOffset * sinA;

        ctx.beginPath();
        ctx.arc(dx, dy, dotRadius, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
}