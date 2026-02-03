/**
 * PatternPreview - Renders a visual preview of a hatch pattern
 */

import { useEffect, useRef } from 'react';
import type { CustomHatchPattern, LineFamily } from '../../types/hatch';

interface PatternPreviewProps {
  pattern: CustomHatchPattern;
  width?: number;
  height?: number;
  backgroundColor?: string;
  lineColor?: string;
  scale?: number;
}

/**
 * Renders a single line family within the preview bounds
 */
function renderLineFamily(
  ctx: CanvasRenderingContext2D,
  family: LineFamily,
  bounds: { width: number; height: number },
  color: string,
  patternScale: number
): void {
  const { angle, deltaY, dashPattern, strokeWidth } = family;

  // Skip if no spacing defined
  if (deltaY <= 0) return;

  const spacing = deltaY * patternScale;
  const lineWidth = (strokeWidth || 1) * patternScale;
  const angleRad = (angle * Math.PI) / 180;

  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(0.5, lineWidth);

  // Calculate how many lines we need to cover the preview area
  const diagonal = Math.sqrt(bounds.width * bounds.width + bounds.height * bounds.height);
  const numLines = Math.ceil(diagonal / spacing) + 2;

  // Center point of the preview
  const cx = bounds.width / 2;
  const cy = bounds.height / 2;

  // Direction vectors
  const dx = Math.cos(angleRad);
  const dy = Math.sin(angleRad);

  // Perpendicular direction for spacing
  const px = -dy;
  const py = dx;

  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, bounds.width, bounds.height);
  ctx.clip();

  // Handle dash pattern
  if (dashPattern && dashPattern.length > 0 && dashPattern[0] !== 0) {
    const scaledDashes = dashPattern.map(d => Math.abs(d) * patternScale);
    ctx.setLineDash(scaledDashes);
  } else if (dashPattern && dashPattern.length === 1 && dashPattern[0] === 0) {
    // Dots pattern - draw circles instead of lines
    ctx.restore();
    renderDots(ctx, bounds, spacing, color, patternScale);
    return;
  }

  // Draw parallel lines
  for (let i = -numLines; i <= numLines; i++) {
    const offsetX = px * spacing * i;
    const offsetY = py * spacing * i;

    // Line start and end points (extended beyond bounds)
    const x1 = cx + offsetX - dx * diagonal;
    const y1 = cy + offsetY - dy * diagonal;
    const x2 = cx + offsetX + dx * diagonal;
    const y2 = cy + offsetY + dy * diagonal;

    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
  }

  ctx.setLineDash([]);
  ctx.restore();
}

/**
 * Renders a dot pattern
 */
function renderDots(
  ctx: CanvasRenderingContext2D,
  bounds: { width: number; height: number },
  spacing: number,
  color: string,
  scale: number
): void {
  const dotRadius = Math.max(1, scale);

  ctx.fillStyle = color;

  for (let x = spacing / 2; x < bounds.width; x += spacing) {
    for (let y = spacing / 2; y < bounds.height; y += spacing) {
      ctx.beginPath();
      ctx.arc(x, y, dotRadius, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

export function PatternPreview({
  pattern,
  width = 120,
  height = 80,
  backgroundColor = '#1a1a2e',
  lineColor = '#ffffff',
  scale = 1,
}: PatternPreviewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Clear canvas
    ctx.fillStyle = backgroundColor;
    ctx.fillRect(0, 0, width, height);

    // Handle solid fill
    if (pattern.id === 'solid' || pattern.lineFamilies.length === 0) {
      ctx.fillStyle = lineColor;
      ctx.globalAlpha = 0.3;
      ctx.fillRect(0, 0, width, height);
      ctx.globalAlpha = 1;

      // Draw border
      ctx.strokeStyle = lineColor;
      ctx.lineWidth = 1;
      ctx.strokeRect(0, 0, width, height);
      return;
    }

    // Render each line family
    const patternScale = scale * 1.5; // Scale up for better visibility in preview
    for (const family of pattern.lineFamilies) {
      renderLineFamily(ctx, family, { width, height }, lineColor, patternScale);
    }

    // Draw border
    ctx.strokeStyle = lineColor;
    ctx.lineWidth = 1;
    ctx.globalAlpha = 0.3;
    ctx.strokeRect(0, 0, width, height);
    ctx.globalAlpha = 1;

  }, [pattern, width, height, backgroundColor, lineColor, scale]);

  return (
    <canvas
      ref={canvasRef}
      width={width}
      height={height}
      className="border border-cad-border"
      style={{ imageRendering: 'crisp-edges' }}
    />
  );
}

/**
 * Compact preview for use in dropdowns/lists
 */
export function PatternPreviewSmall({
  pattern,
  selected = false,
}: {
  pattern: CustomHatchPattern;
  selected?: boolean;
}) {
  return (
    <div className={`flex items-center gap-2 p-1 rounded ${selected ? 'bg-cad-accent/20' : ''}`}>
      <PatternPreview
        pattern={pattern}
        width={32}
        height={24}
        scale={0.6}
      />
      <span className="text-xs truncate">{pattern.name}</span>
    </div>
  );
}
