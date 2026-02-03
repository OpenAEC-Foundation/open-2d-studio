import type { Shape } from '../../types/geometry';
import type { PrintAppearance } from '../../state/slices/uiSlice';
import { catmullRomToBezier } from '../../engine/geometry/SplineUtils';
import { bulgeToArc } from '../../engine/geometry/GeometryUtils';
import type { HatchShape } from '../../types/geometry';
import type { DimensionShape } from '../../types/dimension';
import type { CustomHatchPattern, LineFamily } from '../../types/hatch';
import { BUILTIN_PATTERNS, isSvgHatchPattern } from '../../types/hatch';

export function toGrayscale(color: string): string {
  const ctx = document.createElement('canvas').getContext('2d')!;
  ctx.fillStyle = color;
  const hex = ctx.fillStyle;
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const gray = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
  return `rgb(${gray},${gray},${gray})`;
}

export function toBlackLines(color: string): string {
  const ctx = document.createElement('canvas').getContext('2d')!;
  ctx.fillStyle = color;
  const hex = ctx.fillStyle;
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const brightness = (r + g + b) / 3;
  return brightness > 240 ? '#ffffff' : '#000000';
}

function transformColor(color: string, appearance: PrintAppearance, invertWhite: boolean): string {
  let c = color;
  if (invertWhite && c === '#ffffff') {
    c = '#000000';
  }
  switch (appearance) {
    case 'grayscale': return toGrayscale(c);
    case 'blackLines': return toBlackLines(c);
    default: return c;
  }
}

export interface RenderOptions {
  scale: number;
  offsetX: number;
  offsetY: number;
  appearance: PrintAppearance;
  plotLineweights: boolean;
  /** DPI for calculating minimum visible line width */
  dpi?: number;
  /** Custom hatch patterns for rendering */
  customPatterns?: CustomHatchPattern[];
}

export function renderShapesToCanvas(
  ctx: CanvasRenderingContext2D,
  shapes: Shape[],
  opts: RenderOptions
): void {
  const { scale, offsetX, offsetY, appearance, plotLineweights, dpi = 150 } = opts;
  const tx = (x: number) => x * scale + offsetX;
  const ty = (y: number) => y * scale + offsetY;

  // Calculate minimum visible line width (0.25mm minimum for print visibility)
  const minLineWidthMM = 0.25;
  const minLineWidthPx = minLineWidthMM * (dpi / 25.4);

  for (const shape of shapes) {
    if (!shape.visible) continue;

    const strokeColor = transformColor(shape.style.strokeColor, appearance, true);
    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = plotLineweights ? Math.max(shape.style.strokeWidth * scale, minLineWidthPx) : minLineWidthPx;

    switch (shape.style.lineStyle) {
      case 'dashed':
        ctx.setLineDash([8 * scale, 4 * scale]);
        break;
      case 'dotted':
        ctx.setLineDash([2 * scale, 2 * scale]);
        break;
      case 'dashdot':
        ctx.setLineDash([8 * scale, 4 * scale, 2 * scale, 4 * scale]);
        break;
      default:
        ctx.setLineDash([]);
    }

    if (shape.style.fillColor) {
      ctx.fillStyle = transformColor(shape.style.fillColor, appearance, true);
    }

    switch (shape.type) {
      case 'line':
        ctx.beginPath();
        ctx.moveTo(tx(shape.start.x), ty(shape.start.y));
        ctx.lineTo(tx(shape.end.x), ty(shape.end.y));
        ctx.stroke();
        break;

      case 'rectangle': {
        ctx.save();
        if (shape.rotation) {
          ctx.translate(tx(shape.topLeft.x), ty(shape.topLeft.y));
          ctx.rotate(shape.rotation);
          ctx.translate(-tx(shape.topLeft.x), -ty(shape.topLeft.y));
        }
        const r = shape.cornerRadius ?? 0;
        ctx.beginPath();
        if (r > 0) {
          const maxR = Math.min(r, shape.width / 2, shape.height / 2) * scale;
          const x = tx(shape.topLeft.x);
          const y = ty(shape.topLeft.y);
          const w = shape.width * scale;
          const h = shape.height * scale;
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
          ctx.rect(tx(shape.topLeft.x), ty(shape.topLeft.y), shape.width * scale, shape.height * scale);
        }
        if (shape.style.fillColor) ctx.fill();
        ctx.stroke();
        ctx.restore();
        break;
      }

      case 'circle':
        ctx.beginPath();
        ctx.arc(tx(shape.center.x), ty(shape.center.y), shape.radius * scale, 0, Math.PI * 2);
        if (shape.style.fillColor) ctx.fill();
        ctx.stroke();
        break;

      case 'arc':
        ctx.beginPath();
        ctx.arc(tx(shape.center.x), ty(shape.center.y), shape.radius * scale, shape.startAngle, shape.endAngle);
        ctx.stroke();
        break;

      case 'ellipse': {
        const startAngle = shape.startAngle ?? 0;
        const endAngle = shape.endAngle ?? Math.PI * 2;
        ctx.beginPath();
        ctx.ellipse(tx(shape.center.x), ty(shape.center.y), shape.radiusX * scale, shape.radiusY * scale, shape.rotation, startAngle, endAngle);
        if (shape.style.fillColor && shape.startAngle === undefined) ctx.fill();
        ctx.stroke();
        break;
      }

      case 'polyline':
        if (shape.points.length >= 2) {
          ctx.beginPath();
          ctx.moveTo(tx(shape.points[0].x), ty(shape.points[0].y));
          for (let i = 0; i < shape.points.length - 1; i++) {
            const b = shape.bulge?.[i] ?? 0;
            if (b !== 0) {
              const arc = bulgeToArc(shape.points[i], shape.points[i + 1], b);
              ctx.arc(
                tx(arc.center.x), ty(arc.center.y), arc.radius * scale,
                arc.startAngle, arc.endAngle, arc.clockwise
              );
            } else {
              ctx.lineTo(tx(shape.points[i + 1].x), ty(shape.points[i + 1].y));
            }
          }
          if (shape.closed) {
            const lastB = shape.bulge?.[shape.points.length - 1] ?? 0;
            if (lastB !== 0) {
              const arc = bulgeToArc(shape.points[shape.points.length - 1], shape.points[0], lastB);
              ctx.arc(
                tx(arc.center.x), ty(arc.center.y), arc.radius * scale,
                arc.startAngle, arc.endAngle, arc.clockwise
              );
            } else {
              ctx.closePath();
            }
            if (shape.style.fillColor) ctx.fill();
          }
          ctx.stroke();
        }
        break;

      case 'spline':
        if (shape.points.length >= 2) {
          const scaledPts = shape.points.map(p => ({ x: tx(p.x), y: ty(p.y) }));
          const segs = catmullRomToBezier(scaledPts);
          ctx.beginPath();
          ctx.moveTo(scaledPts[0].x, scaledPts[0].y);
          for (const seg of segs) {
            ctx.bezierCurveTo(seg.cp1.x, seg.cp1.y, seg.cp2.x, seg.cp2.y, seg.end.x, seg.end.y);
          }
          ctx.stroke();
        }
        break;

      case 'text': {
        const { position, text, fontSize, fontFamily, rotation, alignment, verticalAlignment, bold, italic, underline, color, lineHeight = 1.2 } = shape;
        ctx.save();
        const textColor = transformColor(color || shape.style.strokeColor, appearance, true);
        const scaledFontSize = fontSize * scale;
        if (rotation !== 0) {
          ctx.translate(tx(position.x), ty(position.y));
          ctx.rotate(rotation);
          ctx.translate(-tx(position.x), -ty(position.y));
        }
        const fontStyle = `${italic ? 'italic ' : ''}${bold ? 'bold ' : ''}`;
        ctx.font = `${fontStyle}${scaledFontSize}px ${fontFamily}`;
        ctx.fillStyle = textColor;
        ctx.textAlign = alignment;
        ctx.textBaseline = verticalAlignment === 'middle' ? 'middle' : verticalAlignment === 'bottom' ? 'bottom' : 'top';
        const lines = text.split('\n');
        const actualLineHeight = scaledFontSize * lineHeight;
        for (let i = 0; i < lines.length; i++) {
          const y = ty(position.y) + i * actualLineHeight;
          ctx.fillText(lines[i], tx(position.x), y);
          if (underline && lines[i].length > 0) {
            const metrics = ctx.measureText(lines[i]);
            let startX = tx(position.x);
            if (alignment === 'center') startX -= metrics.width / 2;
            else if (alignment === 'right') startX -= metrics.width;
            ctx.strokeStyle = textColor;
            ctx.lineWidth = 1;
            ctx.setLineDash([]);
            ctx.beginPath();
            ctx.moveTo(startX, y + scaledFontSize + 2);
            ctx.lineTo(startX + metrics.width, y + scaledFontSize + 2);
            ctx.stroke();
          }
        }
        if (shape.leaderPoints && shape.leaderPoints.length > 0) {
          ctx.strokeStyle = textColor;
          ctx.lineWidth = 1 * scale;
          ctx.setLineDash([]);
          ctx.beginPath();
          ctx.moveTo(tx(position.x), ty(position.y));
          for (const pt of shape.leaderPoints) {
            ctx.lineTo(tx(pt.x), ty(pt.y));
          }
          ctx.stroke();
        }
        ctx.restore();
        break;
      }

      case 'dimension': {
        const dim = shape as DimensionShape;
        renderDimensionToPrint(ctx, dim, opts);
        break;
      }

      case 'hatch': {
        const hatch = shape as HatchShape;
        renderHatchToPrint(ctx, hatch, opts);
        break;
      }
    }

    ctx.setLineDash([]);
  }
}

function renderDimensionToPrint(ctx: CanvasRenderingContext2D, dim: DimensionShape, opts: RenderOptions): void {
  const { scale, offsetX, offsetY, appearance } = opts;
  const tx = (x: number) => x * scale + offsetX;
  const ty = (y: number) => y * scale + offsetY;
  const lineColor = transformColor(dim.dimensionStyle.lineColor, appearance, true);
  const textColor = transformColor(dim.dimensionStyle.textColor, appearance, true);

  ctx.save();
  ctx.strokeStyle = lineColor;
  ctx.fillStyle = textColor;
  ctx.lineWidth = Math.max(0.5, dim.style.strokeWidth * scale * 0.5);
  ctx.setLineDash([]);

  if (dim.points.length < 2) { ctx.restore(); return; }

  const p1 = dim.points[0];
  const p2 = dim.points[1];

  if (dim.dimensionType === 'linear' || dim.dimensionType === 'aligned') {
    const offset = dim.dimensionLineOffset;

    let dimLineY: number;
    if (dim.linearDirection === 'horizontal') {
      dimLineY = Math.min(p1.y, p2.y) - Math.abs(offset);
    } else if (dim.linearDirection === 'vertical') {
      dimLineY = p1.y;
    } else {
      dimLineY = Math.min(p1.y, p2.y) - Math.abs(offset);
    }

    // Extension lines
    ctx.beginPath();
    ctx.moveTo(tx(p1.x), ty(p1.y));
    ctx.lineTo(tx(p1.x), ty(dimLineY));
    ctx.moveTo(tx(p2.x), ty(p2.y));
    ctx.lineTo(tx(p2.x), ty(dimLineY));
    ctx.stroke();

    // Dimension line
    ctx.beginPath();
    ctx.moveTo(tx(p1.x), ty(dimLineY));
    ctx.lineTo(tx(p2.x), ty(dimLineY));
    ctx.stroke();

    // Text
    const midX = (tx(p1.x) + tx(p2.x)) / 2;
    const midY = ty(dimLineY) - 2 * scale;
    const fontSize = dim.dimensionStyle.textHeight * scale;
    ctx.font = `${fontSize}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    const displayText = (dim.prefix || '') + dim.value + (dim.suffix || '');
    ctx.fillText(displayText, midX, midY);
  } else if (dim.dimensionType === 'radius' || dim.dimensionType === 'diameter') {
    const center = p1;
    const pointOnCircle = p2;
    ctx.beginPath();
    ctx.moveTo(tx(center.x), ty(center.y));
    ctx.lineTo(tx(pointOnCircle.x), ty(pointOnCircle.y));
    ctx.stroke();

    const midX = (tx(center.x) + tx(pointOnCircle.x)) / 2;
    const midY = (ty(center.y) + ty(pointOnCircle.y)) / 2 - 2 * scale;
    const fontSize = dim.dimensionStyle.textHeight * scale;
    ctx.font = `${fontSize}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    const displayText = (dim.prefix || '') + dim.value + (dim.suffix || '');
    ctx.fillText(displayText, midX, midY);
  }

  ctx.restore();
}

function renderHatchToPrint(ctx: CanvasRenderingContext2D, hatch: HatchShape, opts: RenderOptions): void {
  const { scale, offsetX, offsetY, appearance, plotLineweights, customPatterns = [] } = opts;
  const tx = (x: number) => x * scale + offsetX;
  const ty = (y: number) => y * scale + offsetY;
  const { points, patternType, patternAngle, patternScale, fillColor, backgroundColor, customPatternId } = hatch;

  if (points.length < 3) return;

  const buildPath = () => {
    ctx.beginPath();
    ctx.moveTo(tx(points[0].x), ty(points[0].y));
    for (let i = 1; i < points.length; i++) {
      ctx.lineTo(tx(points[i].x), ty(points[i].y));
    }
    ctx.closePath();
  };

  if (backgroundColor) {
    buildPath();
    ctx.fillStyle = transformColor(backgroundColor, appearance, true);
    ctx.fill();
  }

  const patternColor = transformColor(fillColor, appearance, true);

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of points) {
    const px = tx(p.x), py = ty(p.y);
    if (px < minX) minX = px;
    if (py < minY) minY = py;
    if (px > maxX) maxX = px;
    if (py > maxY) maxY = py;
  }

  ctx.save();
  buildPath();
  ctx.clip();

  if (patternType === 'custom' && customPatternId) {
    // Look up custom pattern
    const customPattern = BUILTIN_PATTERNS.find(p => p.id === customPatternId) ||
                          customPatterns.find(p => p.id === customPatternId);
    if (customPattern) {
      if (isSvgHatchPattern(customPattern)) {
        // For SVG patterns in print, render as solid (SVG async loading is complex for print)
        // A more complete implementation would pre-load SVG images
        ctx.fillStyle = patternColor;
        ctx.globalAlpha = 0.3;
        ctx.fill();
        ctx.globalAlpha = 1;
      } else if (customPattern.lineFamilies.length > 0) {
        // Render line families
        renderLineFamiliesToPrint(ctx, customPattern.lineFamilies, minX, minY, maxX, maxY,
          patternScale * scale, patternAngle, patternColor,
          plotLineweights ? hatch.style.strokeWidth * scale * 0.5 : 0.5);
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
    const spacing = 10 * patternScale * scale;
    const dotRadius = 1 * patternScale * scale;
    ctx.fillStyle = patternColor;
    for (let x = minX; x <= maxX; x += spacing) {
      for (let y = minY; y <= maxY; y += spacing) {
        ctx.beginPath();
        ctx.arc(x, y, dotRadius, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  } else {
    const spacing = 10 * patternScale * scale;
    const angles: number[] = [];
    switch (patternType) {
      case 'horizontal': angles.push(0); break;
      case 'vertical': angles.push(90); break;
      case 'diagonal': angles.push(patternAngle); break;
      case 'crosshatch': angles.push(patternAngle); angles.push(patternAngle + 90); break;
    }
    ctx.strokeStyle = patternColor;
    ctx.lineWidth = (plotLineweights ? hatch.style.strokeWidth * scale * 0.5 : 0.5);
    ctx.setLineDash([]);
    for (const angleDeg of angles) {
      const angleRad = (angleDeg * Math.PI) / 180;
      const cosA = Math.cos(angleRad);
      const sinA = Math.sin(angleRad);
      const cx = (minX + maxX) / 2;
      const cy = (minY + maxY) / 2;
      const diagonal = Math.sqrt((maxX - minX) ** 2 + (maxY - minY) ** 2);
      const halfDiag = diagonal / 2 + spacing;
      const numLines = Math.ceil((halfDiag * 2) / spacing);
      ctx.beginPath();
      for (let i = -numLines; i <= numLines; i++) {
        const offset = i * spacing;
        const ox = cx + offset * (-sinA);
        const oy = cy + offset * cosA;
        ctx.moveTo(ox - halfDiag * cosA, oy - halfDiag * sinA);
        ctx.lineTo(ox + halfDiag * cosA, oy + halfDiag * sinA);
      }
      ctx.stroke();
    }
  }

  ctx.restore();

  buildPath();
  ctx.strokeStyle = transformColor(hatch.style.strokeColor, appearance, true);
  ctx.lineWidth = plotLineweights ? Math.max(hatch.style.strokeWidth * scale, 0.5) : 1;
  ctx.stroke();
}

/**
 * Render line families for custom patterns in print
 */
function renderLineFamiliesToPrint(
  ctx: CanvasRenderingContext2D,
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
  for (const family of lineFamilies) {
    const spacing = (family.deltaY || 10) * scale;
    const deltaX = (family.deltaX || 0) * scale;
    const angleDeg = family.angle + rotationOffset;
    const strokeWidth = family.strokeWidth ?? defaultStrokeWidth;
    const strokeColor = family.strokeColor ?? defaultColor;

    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = strokeWidth;

    // Handle dash pattern
    if (family.dashPattern && family.dashPattern.length > 0) {
      if (family.dashPattern.includes(0)) {
        // Dots pattern
        renderDotsToPrint(ctx, angleDeg, spacing, deltaX, minX, minY, maxX, maxY, scale, strokeColor);
        continue;
      }
      const scaledDashPattern = family.dashPattern.map(d => Math.abs(d) * scale);
      ctx.setLineDash(scaledDashPattern);
    } else {
      ctx.setLineDash([]);
    }

    // Draw line family
    const angleRad = (angleDeg * Math.PI) / 180;
    const cosA = Math.cos(angleRad);
    const sinA = Math.sin(angleRad);

    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    const diagonal = Math.sqrt((maxX - minX) ** 2 + (maxY - minY) ** 2);
    const halfDiag = diagonal / 2 + spacing * 2;
    const numLines = Math.ceil((halfDiag * 2) / spacing) + 2;

    ctx.beginPath();
    for (let i = -numLines; i <= numLines; i++) {
      const perpOffset = i * spacing;
      const staggerOffset = deltaX !== 0 ? (i * deltaX) : 0;

      const baseX = cx + perpOffset * (-sinA);
      const baseY = cy + perpOffset * cosA;

      const ox = baseX + staggerOffset * cosA;
      const oy = baseY + staggerOffset * sinA;

      const x1 = ox - halfDiag * cosA;
      const y1 = oy - halfDiag * sinA;
      const x2 = ox + halfDiag * cosA;
      const y2 = oy + halfDiag * sinA;

      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
    }
    ctx.stroke();
  }

  ctx.setLineDash([]);
}

/**
 * Render dots pattern for print
 */
function renderDotsToPrint(
  ctx: CanvasRenderingContext2D,
  angleDeg: number,
  spacing: number,
  deltaX: number,
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
  scale: number,
  color: string
): void {
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
      const dx = baseX + alongOffset * cosA;
      const dy = baseY + alongOffset * sinA;

      ctx.beginPath();
      ctx.arc(dx, dy, dotRadius, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}
