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
} from '../../geometry/DimensionUtils';

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

    const angle = angleBetweenPoints(geometry.start, geometry.end);

    // Calculate text width for line breaking
    const textHeight = style.textHeight || 3;
    let displayText = dimension.value;
    if (dimension.prefix) displayText = dimension.prefix + displayText;
    if (dimension.suffix) displayText = displayText + dimension.suffix;
    ctx.font = `${textHeight}px Arial`;
    const textMetrics = ctx.measureText(displayText);
    const textGap = textMetrics.width + textHeight * 0.8; // Gap for text plus padding

    // Draw dimension line (break it if text is centered)
    if (style.textPlacement === 'centered') {
      // Calculate gap positions
      const totalLength = Math.sqrt(
        Math.pow(geometry.end.x - geometry.start.x, 2) +
        Math.pow(geometry.end.y - geometry.start.y, 2)
      );
      const gapStart = (totalLength - textGap) / 2;
      const gapEnd = (totalLength + textGap) / 2;

      // Draw first segment (start to gap)
      const gapStartPoint = {
        x: geometry.start.x + Math.cos(angle) * gapStart,
        y: geometry.start.y + Math.sin(angle) * gapStart,
      };
      const gapEndPoint = {
        x: geometry.start.x + Math.cos(angle) * gapEnd,
        y: geometry.start.y + Math.sin(angle) * gapEnd,
      };

      ctx.beginPath();
      ctx.moveTo(geometry.start.x, geometry.start.y);
      ctx.lineTo(gapStartPoint.x, gapStartPoint.y);
      ctx.stroke();

      // Draw second segment (gap to end)
      ctx.beginPath();
      ctx.moveTo(gapEndPoint.x, gapEndPoint.y);
      ctx.lineTo(geometry.end.x, geometry.end.y);
      ctx.stroke();
    } else {
      // Draw continuous dimension line
      ctx.beginPath();
      ctx.moveTo(geometry.start.x, geometry.start.y);
      ctx.lineTo(geometry.end.x, geometry.end.y);
      ctx.stroke();
    }

    // Draw arrows (tick marks)
    this.drawArrow(geometry.start, angle, style);
    this.drawArrow(geometry.end, angle + Math.PI, style);

    // Calculate actual text position (with offset if set)
    const textPos = dimension.textOffset
      ? { x: geometry.textPosition.x + dimension.textOffset.x, y: geometry.textPosition.y + dimension.textOffset.y }
      : geometry.textPosition;

    // Draw dimension text
    this.drawDimensionText(
      textPos,
      geometry.textAngle,
      dimension.value,
      dimension.prefix,
      dimension.suffix,
      style
    );

    // Draw selection handles if selected
    if (isSelected) {
      this.drawAlignedDimensionHandles(dimension, geometry, textPos, style);
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
        // Diagonal tick mark at 45 degrees to dimension line
        const tickAngle = angle + Math.PI / 4; // 45 degrees from dimension line
        const halfSize = size * 0.7; // Slightly longer for visibility
        ctx.beginPath();
        ctx.moveTo(
          tip.x - Math.cos(tickAngle) * halfSize,
          tip.y - Math.sin(tickAngle) * halfSize
        );
        ctx.lineTo(
          tip.x + Math.cos(tickAngle) * halfSize,
          tip.y + Math.sin(tickAngle) * halfSize
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

    // Draw background for readability (only for above/below placement)
    const metrics = ctx.measureText(displayText);
    if (style?.textPlacement !== 'centered') {
      const padding = textHeight * 0.2;
      ctx.fillStyle = '#1a1a2e'; // Match canvas background
      ctx.fillRect(
        -metrics.width / 2 - padding,
        yOffset - textHeight / 2 - padding,
        metrics.width + padding * 2,
        textHeight + padding * 2
      );
    }

    // Draw text
    ctx.fillStyle = style?.textColor || '#00ffff';
    ctx.fillText(displayText, 0, yOffset);

    ctx.restore();
  }

  /**
   * Draw selection handles for aligned/linear dimension
   */
  private drawAlignedDimensionHandles(
    dimension: DimensionShape,
    geometry: { start: Point; end: Point; textPosition: Point; extensionLines: Array<{ start: Point; end: Point }> },
    textPos: Point,
    style: DimensionStyle
  ): void {
    const ctx = this.ctx;
    const handleSize = 5;
    const textHeight = style.textHeight || 3;

    // 1. Text drag handle (blue, below text)
    ctx.fillStyle = '#4488ff';
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1;

    const textHandleOffset = textHeight * 1.5;
    const angle = angleBetweenPoints(geometry.start, geometry.end);
    const perpAngle = angle - Math.PI / 2;
    const textHandlePos = {
      x: textPos.x + Math.cos(perpAngle) * textHandleOffset,
      y: textPos.y + Math.sin(perpAngle) * textHandleOffset,
    };

    ctx.beginPath();
    ctx.arc(textHandlePos.x, textHandlePos.y, handleSize / 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // Draw line connecting text to handle
    ctx.strokeStyle = '#4488ff';
    ctx.setLineDash([2, 2]);
    ctx.beginPath();
    ctx.moveTo(textPos.x, textPos.y);
    ctx.lineTo(textHandlePos.x, textHandlePos.y);
    ctx.stroke();
    ctx.setLineDash([]);

    // 2. Dimension line midpoint handle (to drag offset)
    ctx.fillStyle = COLORS.selectionHandle;
    ctx.strokeStyle = COLORS.selectionHandleStroke;

    const dimLineMidpoint = {
      x: (geometry.start.x + geometry.end.x) / 2,
      y: (geometry.start.y + geometry.end.y) / 2,
    };

    ctx.fillRect(
      dimLineMidpoint.x - handleSize / 2,
      dimLineMidpoint.y - handleSize / 2,
      handleSize,
      handleSize
    );
    ctx.strokeRect(
      dimLineMidpoint.x - handleSize / 2,
      dimLineMidpoint.y - handleSize / 2,
      handleSize,
      handleSize
    );

    // 3. Witness line end grips (at dimension line ends)
    ctx.fillStyle = '#88ff88'; // Green for witness line handles
    ctx.strokeStyle = '#ffffff';

    // Start witness line grip
    ctx.fillRect(
      geometry.start.x - handleSize / 2,
      geometry.start.y - handleSize / 2,
      handleSize,
      handleSize
    );
    ctx.strokeRect(
      geometry.start.x - handleSize / 2,
      geometry.start.y - handleSize / 2,
      handleSize,
      handleSize
    );

    // End witness line grip
    ctx.fillRect(
      geometry.end.x - handleSize / 2,
      geometry.end.y - handleSize / 2,
      handleSize,
      handleSize
    );
    ctx.strokeRect(
      geometry.end.x - handleSize / 2,
      geometry.end.y - handleSize / 2,
      handleSize,
      handleSize
    );

    // 4. Reference point handles (where dimension is measured from)
    ctx.fillStyle = '#ffff88'; // Yellow for reference points
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
   * Draw selection handles for dimension (generic fallback)
   */
  private drawDimensionHandles(dimension: DimensionShape): void {
    const ctx = this.ctx;
    const handleSize = 5;

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
