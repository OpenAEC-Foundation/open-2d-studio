/**
 * ShapeRenderer - Renders individual shapes
 */

import type { Shape, DrawingPreview, CurrentStyle, Viewport } from '../types';
import type { HatchShape } from '../../../types/geometry';
import type { CustomHatchPattern, LineFamily, SvgHatchPattern } from '../../../types/hatch';
import { BUILTIN_PATTERNS, isSvgHatchPattern } from '../../../types/hatch';
import { BaseRenderer } from './BaseRenderer';
import { COLORS } from '../types';
import { DimensionRenderer } from './DimensionRenderer';
import type { DimensionShape } from '../../../types/dimension';
import { drawSplinePath } from '../../geometry/SplineUtils';
import { bulgeToArc, bulgeArcMidpoint } from '../../geometry/GeometryUtils';
import { svgToImage } from '../../../services/svgPatternService';

export class ShapeRenderer extends BaseRenderer {
  private dimensionRenderer: DimensionRenderer;
  private customPatterns: CustomHatchPattern[] = [];
  // Cache for loaded SVG pattern images
  private svgImageCache: Map<string, HTMLImageElement> = new Map();
  private svgLoadingPromises: Map<string, Promise<HTMLImageElement | null>> = new Map();

  constructor(ctx: CanvasRenderingContext2D, width: number = 0, height: number = 0, dpr?: number) {
    super(ctx, width, height, dpr);
    this.dimensionRenderer = new DimensionRenderer(ctx, width, height, dpr);
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
    ctx.lineWidth = style.strokeWidth;
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
      default:
        break;
    }

    // Draw selection handles (hidden during modify tool operations)
    if (isSelected && !hideHandles) {
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
    ctx.lineWidth = style.strokeWidth;
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
    ctx.lineWidth = style?.strokeWidth || 1;
    ctx.setLineDash([]);

    switch (preview.type) {
      case 'line':
        ctx.beginPath();
        ctx.moveTo(preview.start.x, preview.start.y);
        ctx.lineTo(preview.end.x, preview.end.y);
        ctx.stroke();
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
          if (currentBulge !== 0) {
            const lastPt = preview.points[preview.points.length - 1];
            const arc = bulgeToArc(lastPt, preview.currentPoint, currentBulge);
            ctx.arc(arc.center.x, arc.center.y, arc.radius, arc.startAngle, arc.endAngle, arc.clockwise);
          } else {
            ctx.lineTo(preview.currentPoint.x, preview.currentPoint.y);
          }
          ctx.stroke();
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
      color,
      lineHeight = 1.2,
    } = shape;

    ctx.save();

    // Apply rotation around position
    if (rotation !== 0) {
      ctx.translate(position.x, position.y);
      ctx.rotate(rotation);
      ctx.translate(-position.x, -position.y);
    }

    // Build font string
    const fontStyle = `${italic ? 'italic ' : ''}${bold ? 'bold ' : ''}`;
    ctx.font = `${fontStyle}${fontSize}px ${fontFamily}`;

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

    // Handle multi-line text
    const lines = text.split('\n');
    const actualLineHeight = fontSize * lineHeight;

    // Draw text lines
    for (let i = 0; i < lines.length; i++) {
      const y = position.y + i * actualLineHeight;
      ctx.fillText(lines[i], position.x, y);

      // Draw underline if enabled
      if (underline && lines[i].length > 0) {
        const metrics = ctx.measureText(lines[i]);
        let startX = position.x;
        if (alignment === 'center') startX -= metrics.width / 2;
        else if (alignment === 'right') startX -= metrics.width;

        ctx.strokeStyle = textColor;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(startX, y + fontSize + 2);
        ctx.lineTo(startX + metrics.width, y + fontSize + 2);
        ctx.stroke();
      }
    }

    ctx.restore();

    // Draw leader lines if present
    if (shape.leaderPoints && shape.leaderPoints.length > 0) {
      ctx.save();
      let leaderColor = color || shape.style.strokeColor;
      if (invertColors && leaderColor === '#ffffff') {
        leaderColor = '#000000';
      }
      ctx.strokeStyle = leaderColor;
      ctx.lineWidth = 1;
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.moveTo(position.x, position.y);
      for (const pt of shape.leaderPoints) {
        ctx.lineTo(pt.x, pt.y);
      }
      ctx.stroke();

      // Draw arrowhead at the last leader point
      if (shape.leaderPoints.length >= 1) {
        const lastPt = shape.leaderPoints[shape.leaderPoints.length - 1];
        const prevPt = shape.leaderPoints.length > 1
          ? shape.leaderPoints[shape.leaderPoints.length - 2]
          : position;
        const arrowAngle = Math.atan2(lastPt.y - prevPt.y, lastPt.x - prevPt.x);
        const arrowLen = 6;
        ctx.beginPath();
        ctx.moveTo(lastPt.x, lastPt.y);
        ctx.lineTo(
          lastPt.x - arrowLen * Math.cos(arrowAngle - 0.4),
          lastPt.y - arrowLen * Math.sin(arrowAngle - 0.4)
        );
        ctx.moveTo(lastPt.x, lastPt.y);
        ctx.lineTo(
          lastPt.x - arrowLen * Math.cos(arrowAngle + 0.4),
          lastPt.y - arrowLen * Math.sin(arrowAngle + 0.4)
        );
        ctx.stroke();
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

    const { position, text, fontSize, fontFamily, alignment, verticalAlignment, bold, italic, lineHeight = 1.2 } = shape;

    // Set font and baseline to match drawText rendering
    const fontStyle = `${italic ? 'italic ' : ''}${bold ? 'bold ' : ''}`;
    ctx.font = `${fontStyle}${fontSize}px ${fontFamily}`;
    ctx.textBaseline = verticalAlignment === 'middle' ? 'middle' :
                       verticalAlignment === 'bottom' ? 'bottom' : 'top';

    const lines = text.split('\n');
    const actualLineHeight = fontSize * lineHeight;

    // Use actual font metrics for accurate bounds
    let maxWidth = 0;
    let maxAscent = 0;
    let maxDescent = 0;
    for (const line of lines) {
      const metrics = ctx.measureText(line);
      if (metrics.width > maxWidth) maxWidth = metrics.width;
      if (metrics.actualBoundingBoxAscent > maxAscent) maxAscent = metrics.actualBoundingBoxAscent;
      if (metrics.actualBoundingBoxDescent > maxDescent) maxDescent = metrics.actualBoundingBoxDescent;
    }

    // First line top/bottom from actual metrics, remaining lines offset by lineHeight
    const topY = position.y - maxAscent;
    const bottomY = position.y + maxDescent + (lines.length - 1) * actualLineHeight;

    // Calculate bounding box based on alignment
    let minX = position.x;
    if (alignment === 'center') minX -= maxWidth / 2;
    else if (alignment === 'right') minX -= maxWidth;

    // Draw selection rectangle
    ctx.strokeStyle = COLORS.selection;
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.strokeRect(minX - 2, topY - 2, maxWidth + 4, (bottomY - topY) + 4);
    ctx.setLineDash([]);
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

    for (let i = 0; i < points.length; i++) {
      const point = points[i];
      ctx.fillRect(point.x - handleSize / 2, point.y - handleSize / 2, handleSize, handleSize);
      ctx.strokeRect(point.x - handleSize / 2, point.y - handleSize / 2, handleSize, handleSize);
      // Skip axis arrows on arc midpoint grip (circumcenter algorithm can't handle axis constraint)
      if (!(shape.type === 'arc' && i === 3)) {
        this.drawAxisArrows(point, zoom);
      }
    }
  }

  /**
   * Draw X (red) and Y (green) axis-constraint arrows at a grip point.
   * Arrow length is constant in screen space (~20px).
   */
  private drawAxisArrows(point: { x: number; y: number }, zoom: number): void {
    const ctx = this.ctx;
    const arrowLen = 20 / zoom;
    const headLen = 5 / zoom;
    const headWidth = 3 / zoom;

    ctx.save();

    // X-axis arrow (red, pointing right)
    ctx.strokeStyle = COLORS.axisX;
    ctx.fillStyle = COLORS.axisX;
    ctx.lineWidth = 1.5 / zoom;
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

    // Y-axis arrow (green, pointing up i.e. negative Y in screen space)
    ctx.strokeStyle = COLORS.axisY;
    ctx.fillStyle = COLORS.axisY;
    ctx.lineWidth = 1.5 / zoom;
    ctx.beginPath();
    ctx.moveTo(point.x, point.y);
    ctx.lineTo(point.x, point.y - arrowLen);
    ctx.stroke();
    // Arrowhead
    ctx.beginPath();
    ctx.moveTo(point.x, point.y - arrowLen);
    ctx.lineTo(point.x - headWidth, point.y - arrowLen + headLen);
    ctx.lineTo(point.x + headWidth, point.y - arrowLen + headLen);
    ctx.closePath();
    ctx.fill();

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
      case 'ellipse':
        return [
          shape.center,
          { x: shape.center.x + shape.radiusX, y: shape.center.y },
          { x: shape.center.x - shape.radiusX, y: shape.center.y },
          { x: shape.center.x, y: shape.center.y + shape.radiusY },
          { x: shape.center.x, y: shape.center.y - shape.radiusY },
        ];
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
      default:
        return [];
    }
  }

  private drawHatch(shape: HatchShape, invertColors: boolean = false): void {
    const ctx = this.ctx;
    const { points, patternType, patternAngle, patternScale, fillColor, backgroundColor, customPatternId } = shape;

    if (points.length < 3) return;

    // Build boundary path
    const buildPath = () => {
      ctx.beginPath();
      ctx.moveTo(points[0].x, points[0].y);
      for (let i = 1; i < points.length; i++) {
        ctx.lineTo(points[i].x, points[i].y);
      }
      ctx.closePath();
    };

    // Fill background if set
    if (backgroundColor) {
      buildPath();
      ctx.fillStyle = backgroundColor;
      ctx.fill();
    }

    // Get bounding box
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of points) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }

    let patternColor = fillColor;
    if (invertColors && patternColor === '#ffffff') {
      patternColor = '#000000';
    }

    ctx.save();
    buildPath();
    ctx.clip();

    // Handle custom patterns
    if (patternType === 'custom' && customPatternId) {
      const customPattern = this.getPatternById(customPatternId);
      if (customPattern) {
        // Check if it's an SVG pattern
        if (isSvgHatchPattern(customPattern)) {
          this.drawSvgPattern(customPattern, minX, minY, maxX, maxY, patternScale, patternAngle);
        } else if (customPattern.lineFamilies.length > 0) {
          // Line-based pattern
          this.drawCustomPatternLines(customPattern.lineFamilies, minX, minY, maxX, maxY, patternScale, patternAngle, patternColor, shape.style.strokeWidth);
        } else {
          // Empty line families = solid fill
          ctx.fillStyle = patternColor;
          ctx.fill();
        }
      }
    } else if (patternType === 'solid') {
      ctx.fillStyle = patternColor;
      ctx.fill();
    } else if (patternType === 'dots') {
      const spacing = 10 * patternScale;
      const dotRadius = 1 * patternScale;
      ctx.fillStyle = patternColor;
      for (let x = minX; x <= maxX; x += spacing) {
        for (let y = minY; y <= maxY; y += spacing) {
          ctx.beginPath();
          ctx.arc(x, y, dotRadius, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    } else {
      // Built-in line patterns
      const spacing = 10 * patternScale;
      const angles: number[] = [];

      switch (patternType) {
        case 'horizontal':
          angles.push(0);
          break;
        case 'vertical':
          angles.push(90);
          break;
        case 'diagonal':
          angles.push(patternAngle);
          break;
        case 'crosshatch':
          angles.push(patternAngle);
          angles.push(patternAngle + 90);
          break;
      }

      ctx.strokeStyle = patternColor;
      ctx.lineWidth = shape.style.strokeWidth * 0.5;
      ctx.setLineDash([]);

      for (const angleDeg of angles) {
        this.drawLineFamilySimple(angleDeg, spacing, minX, minY, maxX, maxY);
      }
    }

    ctx.restore();

    // Stroke boundary
    buildPath();
    ctx.stroke();
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