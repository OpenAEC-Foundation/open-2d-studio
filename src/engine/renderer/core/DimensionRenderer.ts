/**
 * DimensionRenderer - Renders dimension shapes
 */

import { BaseRenderer } from './BaseRenderer';
import type { DimensionShape, DimensionStyle } from '../../../types/dimension';
import type { Point } from '../../../types/geometry';
import type { DrawingPreview, Viewport } from '../types';
import { COLORS } from '../types';
import {
  calculateAlignedDimensionGeometry,
  calculateRadiusDimensionGeometry,
  calculateDiameterDimensionGeometry,
  calculateAngularDimensionGeometry,
  calculateArrowPoints,
  angleBetweenPoints,
} from '../../../utils/dimensionUtils';

export class DimensionRenderer extends BaseRenderer {
  /**
   * Draw a dimension shape
   */
  drawDimension(dimension: DimensionShape, isSelected: boolean, isHovered: boolean = false): void {
    const ctx = this.ctx;
    const style = dimension.dimensionStyle;

    // Set drawing style
    const highlightColor = isSelected ? COLORS.selection : isHovered ? COLORS.hover : null;
    ctx.strokeStyle = highlightColor || style.lineColor;
    ctx.fillStyle = highlightColor || style.textColor;
    ctx.lineWidth = 1;
    ctx.setLineDash([]);

    switch (dimension.dimensionType) {
      case 'aligned':
      case 'linear':
        this.drawAlignedDimension(dimension, style, isSelected);
        break;
      case 'angular':
        this.drawAngularDimension(dimension, style, isSelected);
        break;
      case 'radius':
        this.drawRadiusDimension(dimension, style, isSelected);
        break;
      case 'diameter':
        this.drawDiameterDimension(dimension, style, isSelected);
        break;
    }
  }

  /**
   * Draw aligned or linear dimension
   */
  private drawAlignedDimension(
    dimension: DimensionShape,
    style: DimensionStyle,
    isSelected: boolean
  ): void {
    if (dimension.points.length < 2) return;

    const p1 = dimension.points[0];
    const p2 = dimension.points[1];
    const offset = dimension.dimensionLineOffset;

    const geometry = calculateAlignedDimensionGeometry(
      p1,
      p2,
      offset,
      style,
      dimension.linearDirection
    );

    const ctx = this.ctx;

    // Draw extension lines
    for (const ext of geometry.extensionLines) {
      ctx.beginPath();
      ctx.moveTo(ext.start.x, ext.start.y);
      ctx.lineTo(ext.end.x, ext.end.y);
      ctx.stroke();
    }

    // Draw dimension line
    ctx.beginPath();
    ctx.moveTo(geometry.start.x, geometry.start.y);
    ctx.lineTo(geometry.end.x, geometry.end.y);
    ctx.stroke();

    // Draw arrows
    const angle = angleBetweenPoints(geometry.start, geometry.end);
    this.drawArrow(geometry.start, angle, style);
    this.drawArrow(geometry.end, angle + Math.PI, style);

    // Draw dimension text
    this.drawDimensionText(
      geometry.textPosition,
      geometry.textAngle,
      dimension.value,
      dimension.prefix,
      dimension.suffix,
      style
    );

    // Draw selection handles if selected
    if (isSelected) {
      this.drawDimensionHandles(dimension);
    }
  }

  /**
   * Draw angular dimension
   */
  private drawAngularDimension(
    dimension: DimensionShape,
    style: DimensionStyle,
    isSelected: boolean
  ): void {
    if (dimension.points.length < 3) return;

    const vertex = dimension.points[0];
    const point1 = dimension.points[1];
    const point2 = dimension.points[2];
    const offset = dimension.dimensionLineOffset;

    const geometry = calculateAngularDimensionGeometry(
      vertex,
      point1,
      point2,
      offset,
      style
    );

    const ctx = this.ctx;

    // Draw extension lines
    for (const ext of geometry.extensionLines) {
      ctx.beginPath();
      ctx.moveTo(ext.start.x, ext.start.y);
      ctx.lineTo(ext.end.x, ext.end.y);
      ctx.stroke();
    }

    // Draw arc
    ctx.beginPath();
    ctx.arc(
      geometry.center.x,
      geometry.center.y,
      geometry.radius,
      geometry.startAngle,
      geometry.endAngle
    );
    ctx.stroke();

    // Draw arrows at arc endpoints
    const arcStart = {
      x: geometry.center.x + geometry.radius * Math.cos(geometry.startAngle),
      y: geometry.center.y + geometry.radius * Math.sin(geometry.startAngle),
    };
    const arcEnd = {
      x: geometry.center.x + geometry.radius * Math.cos(geometry.endAngle),
      y: geometry.center.y + geometry.radius * Math.sin(geometry.endAngle),
    };

    // Arrows point along the arc tangent
    this.drawArrow(arcStart, geometry.startAngle + Math.PI / 2, style);
    this.drawArrow(arcEnd, geometry.endAngle - Math.PI / 2, style);

    // Draw dimension text
    this.drawDimensionText(
      geometry.textPosition,
      0, // Horizontal text for angles
      dimension.value,
      dimension.prefix,
      dimension.suffix,
      style
    );

    if (isSelected) {
      this.drawDimensionHandles(dimension);
    }
  }

  /**
   * Draw radius dimension
   */
  private drawRadiusDimension(
    dimension: DimensionShape,
    style: DimensionStyle,
    isSelected: boolean
  ): void {
    if (dimension.points.length < 2) return;

    const center = dimension.points[0];
    const pointOnCircle = dimension.points[1];

    const geometry = calculateRadiusDimensionGeometry(center, pointOnCircle, style);
    const ctx = this.ctx;

    // Draw dimension line from center to point on circle
    ctx.beginPath();
    ctx.moveTo(geometry.start.x, geometry.start.y);
    ctx.lineTo(geometry.end.x, geometry.end.y);
    ctx.stroke();

    // Draw arrow at point on circle
    const angle = angleBetweenPoints(geometry.start, geometry.end);
    this.drawArrow(geometry.end, angle + Math.PI, style);

    // Draw center mark
    this.drawCenterMark(center, style);

    // Draw dimension text
    this.drawDimensionText(
      geometry.textPosition,
      geometry.textAngle,
      dimension.value,
      dimension.prefix || 'R',
      dimension.suffix,
      style
    );

    if (isSelected) {
      this.drawDimensionHandles(dimension);
    }
  }

  /**
   * Draw diameter dimension
   */
  private drawDiameterDimension(
    dimension: DimensionShape,
    style: DimensionStyle,
    isSelected: boolean
  ): void {
    if (dimension.points.length < 2) return;

    const center = dimension.points[0];
    const pointOnCircle = dimension.points[1];

    const geometry = calculateDiameterDimensionGeometry(center, pointOnCircle, style);
    const ctx = this.ctx;

    // Draw dimension line through center
    ctx.beginPath();
    ctx.moveTo(geometry.start.x, geometry.start.y);
    ctx.lineTo(geometry.end.x, geometry.end.y);
    ctx.stroke();

    // Draw arrows at both ends
    const angle = angleBetweenPoints(geometry.start, geometry.end);
    this.drawArrow(geometry.start, angle, style);
    this.drawArrow(geometry.end, angle + Math.PI, style);

    // Draw center mark
    this.drawCenterMark(center, style);

    // Draw dimension text
    this.drawDimensionText(
      geometry.textPosition,
      geometry.textAngle,
      dimension.value,
      dimension.prefix || '\u2300', // diameter symbol
      dimension.suffix,
      style
    );

    if (isSelected) {
      this.drawDimensionHandles(dimension);
    }
  }

  /**
   * Draw arrow at specified point
   */
  private drawArrow(
    tip: Point,
    angle: number,
    style: DimensionStyle
  ): void {
    const ctx = this.ctx;
    const size = style.arrowSize;

    switch (style.arrowType) {
      case 'filled': {
        const arrowPoints = calculateArrowPoints(tip, angle, size);
        ctx.beginPath();
        ctx.moveTo(arrowPoints.tip.x, arrowPoints.tip.y);
        ctx.lineTo(arrowPoints.left.x, arrowPoints.left.y);
        ctx.lineTo(arrowPoints.right.x, arrowPoints.right.y);
        ctx.closePath();
        ctx.fill();
        break;
      }
      case 'open': {
        const arrowPoints = calculateArrowPoints(tip, angle, size);
        ctx.beginPath();
        ctx.moveTo(arrowPoints.left.x, arrowPoints.left.y);
        ctx.lineTo(arrowPoints.tip.x, arrowPoints.tip.y);
        ctx.lineTo(arrowPoints.right.x, arrowPoints.right.y);
        ctx.stroke();
        break;
      }
      case 'dot': {
        ctx.beginPath();
        ctx.arc(tip.x, tip.y, size / 2, 0, Math.PI * 2);
        ctx.fill();
        break;
      }
      case 'tick': {
        const perpAngle = angle + Math.PI / 2;
        const halfSize = size / 2;
        ctx.beginPath();
        ctx.moveTo(
          tip.x + Math.cos(perpAngle) * halfSize,
          tip.y + Math.sin(perpAngle) * halfSize
        );
        ctx.lineTo(
          tip.x - Math.cos(perpAngle) * halfSize,
          tip.y - Math.sin(perpAngle) * halfSize
        );
        ctx.stroke();
        break;
      }
      case 'none':
        // No arrow
        break;
    }
  }

  /**
   * Draw center mark (cross)
   */
  private drawCenterMark(center: Point, style: DimensionStyle): void {
    const ctx = this.ctx;
    const size = style.arrowSize;

    ctx.beginPath();
    ctx.moveTo(center.x - size, center.y);
    ctx.lineTo(center.x + size, center.y);
    ctx.moveTo(center.x, center.y - size);
    ctx.lineTo(center.x, center.y + size);
    ctx.stroke();
  }

  /**
   * Draw dimension text
   */
  private drawDimensionText(
    position: Point,
    angle: number,
    value: string,
    prefix?: string,
    suffix?: string,
    style?: DimensionStyle
  ): void {
    const ctx = this.ctx;
    const textHeight = style?.textHeight || 3;

    // Build display text
    let displayText = value;
    if (prefix) displayText = prefix + displayText;
    if (suffix) displayText = displayText + suffix;

    ctx.save();

    // Position and rotate
    ctx.translate(position.x, position.y);
    ctx.rotate(angle);

    // Set font
    ctx.font = `${textHeight}px Arial`;
    ctx.textAlign = 'center';

    // Determine vertical position based on placement
    let yOffset = 0;
    if (style?.textPlacement === 'above') {
      ctx.textBaseline = 'bottom';
      yOffset = -textHeight * 0.3;
    } else if (style?.textPlacement === 'below') {
      ctx.textBaseline = 'top';
      yOffset = textHeight * 0.3;
    } else {
      ctx.textBaseline = 'middle';
    }

    // Draw background for readability
    const metrics = ctx.measureText(displayText);
    const padding = textHeight * 0.2;
    ctx.fillStyle = '#1a1a2e'; // Match canvas background
    ctx.fillRect(
      -metrics.width / 2 - padding,
      yOffset - textHeight / 2 - padding,
      metrics.width + padding * 2,
      textHeight + padding * 2
    );

    // Draw text
    ctx.fillStyle = style?.textColor || '#00ffff';
    ctx.fillText(displayText, 0, yOffset);

    ctx.restore();
  }

  /**
   * Draw selection handles for dimension
   */
  private drawDimensionHandles(dimension: DimensionShape): void {
    const ctx = this.ctx;
    const handleSize = 6;

    ctx.fillStyle = COLORS.selectionHandle;
    ctx.strokeStyle = COLORS.selectionHandleStroke;
    ctx.lineWidth = 1;

    // Draw handles at dimension points
    for (const point of dimension.points) {
      ctx.fillRect(
        point.x - handleSize / 2,
        point.y - handleSize / 2,
        handleSize,
        handleSize
      );
      ctx.strokeRect(
        point.x - handleSize / 2,
        point.y - handleSize / 2,
        handleSize,
        handleSize
      );
    }
  }

  /**
   * Draw dimension preview during creation
   */
  drawDimensionPreview(preview: DrawingPreview, viewport: Viewport): void {
    if (!preview || preview.type !== 'dimension') return;

    const ctx = this.ctx;
    const style = {
      arrowType: 'filled' as const,
      arrowSize: 3 / viewport.zoom, // Scale for zoom
      extensionLineGap: 2 / viewport.zoom,
      extensionLineOvershoot: 2 / viewport.zoom,
      textHeight: 3 / viewport.zoom,
      textPlacement: 'above' as const,
      lineColor: '#00ffff',
      textColor: '#00ffff',
      precision: 2,
    };

    ctx.strokeStyle = style.lineColor;
    ctx.fillStyle = style.textColor;
    ctx.lineWidth = 1 / viewport.zoom;
    ctx.setLineDash([4 / viewport.zoom, 4 / viewport.zoom]);

    switch (preview.dimensionType) {
      case 'aligned':
      case 'linear':
        this.drawAlignedPreview(preview, style);
        break;
      case 'angular':
        this.drawAngularPreview(preview, style);
        break;
      case 'radius':
      case 'diameter':
        this.drawRadialPreview(preview, style);
        break;
    }

    ctx.setLineDash([]);
  }

  /**
   * Draw aligned dimension preview
   */
  private drawAlignedPreview(
    preview: DrawingPreview & { type: 'dimension' },
    style: DimensionStyle
  ): void {
    if (preview.points.length < 2) return;

    const p1 = preview.points[0];
    const p2 = preview.points[1];
    const offset = preview.dimensionLineOffset;

    const geometry = calculateAlignedDimensionGeometry(
      p1,
      p2,
      offset,
      style,
      preview.linearDirection
    );

    const ctx = this.ctx;

    // Draw extension lines
    for (const ext of geometry.extensionLines) {
      ctx.beginPath();
      ctx.moveTo(ext.start.x, ext.start.y);
      ctx.lineTo(ext.end.x, ext.end.y);
      ctx.stroke();
    }

    // Draw dimension line
    ctx.beginPath();
    ctx.moveTo(geometry.start.x, geometry.start.y);
    ctx.lineTo(geometry.end.x, geometry.end.y);
    ctx.stroke();

    // Draw arrows
    ctx.setLineDash([]);
    const angle = angleBetweenPoints(geometry.start, geometry.end);
    this.drawArrow(geometry.start, angle, style);
    this.drawArrow(geometry.end, angle + Math.PI, style);

    // Draw dimension text
    this.drawDimensionText(
      geometry.textPosition,
      geometry.textAngle,
      preview.value,
      undefined,
      undefined,
      style
    );
  }

  /**
   * Draw angular dimension preview
   */
  private drawAngularPreview(
    preview: DrawingPreview & { type: 'dimension' },
    style: DimensionStyle
  ): void {
    if (preview.points.length < 3) return;

    const vertex = preview.points[0];
    const point1 = preview.points[1];
    const point2 = preview.points[2];
    const offset = preview.dimensionLineOffset;

    const geometry = calculateAngularDimensionGeometry(
      vertex,
      point1,
      point2,
      offset,
      style
    );

    const ctx = this.ctx;

    // Draw extension lines
    for (const ext of geometry.extensionLines) {
      ctx.beginPath();
      ctx.moveTo(ext.start.x, ext.start.y);
      ctx.lineTo(ext.end.x, ext.end.y);
      ctx.stroke();
    }

    // Draw arc
    ctx.beginPath();
    ctx.arc(
      geometry.center.x,
      geometry.center.y,
      geometry.radius,
      geometry.startAngle,
      geometry.endAngle
    );
    ctx.stroke();

    // Draw text
    ctx.setLineDash([]);
    this.drawDimensionText(
      geometry.textPosition,
      0,
      preview.value,
      undefined,
      undefined,
      style
    );
  }

  /**
   * Draw radius/diameter dimension preview
   */
  private drawRadialPreview(
    preview: DrawingPreview & { type: 'dimension' },
    style: DimensionStyle
  ): void {
    if (preview.points.length < 2) return;

    const center = preview.points[0];
    const pointOnCircle = preview.points[1];

    const geometry = preview.dimensionType === 'diameter'
      ? calculateDiameterDimensionGeometry(center, pointOnCircle, style)
      : calculateRadiusDimensionGeometry(center, pointOnCircle, style);

    const ctx = this.ctx;

    // Draw dimension line
    ctx.beginPath();
    ctx.moveTo(geometry.start.x, geometry.start.y);
    ctx.lineTo(geometry.end.x, geometry.end.y);
    ctx.stroke();

    // Draw arrow(s)
    ctx.setLineDash([]);
    const angle = angleBetweenPoints(geometry.start, geometry.end);
    if (preview.dimensionType === 'diameter') {
      this.drawArrow(geometry.start, angle, style);
    }
    this.drawArrow(geometry.end, angle + Math.PI, style);

    // Draw center mark
    this.drawCenterMark(center, style);

    // Draw text
    const prefix = preview.dimensionType === 'diameter' ? '\u2300' : 'R';
    this.drawDimensionText(
      geometry.textPosition,
      geometry.textAngle,
      preview.value,
      prefix,
      undefined,
      style
    );
  }
}
