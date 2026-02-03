/**
 * ParametricRenderer - Renders parametric shapes
 *
 * Parametric shapes are rendered using their generated geometry (polylines).
 * This renderer handles the display of profile sections and other parametric shapes.
 */

import { BaseRenderer } from './BaseRenderer';
import { COLORS } from '../types';
import type { ParametricShape, ProfileParametricShape } from '../../../types/parametric';

export class ParametricRenderer extends BaseRenderer {
  /**
   * Draw a parametric shape
   */
  drawParametricShape(
    shape: ParametricShape,
    isSelected: boolean = false,
    isHovered: boolean = false,
    invertColors: boolean = false
  ): void {
    if (shape.parametricType === 'profile') {
      this.drawProfileShape(shape as ProfileParametricShape, isSelected, isHovered, invertColors);
    }
  }

  /**
   * Draw a profile parametric shape
   */
  private drawProfileShape(
    shape: ProfileParametricShape,
    isSelected: boolean,
    isHovered: boolean,
    invertColors: boolean
  ): void {
    const ctx = this.ctx;
    const geometry = shape.generatedGeometry;

    if (!geometry || geometry.outlines.length === 0) {
      return;
    }

    // Determine stroke color
    let strokeColor = shape.style.strokeColor;
    if (invertColors && strokeColor === '#ffffff') {
      strokeColor = '#000000';
    }

    ctx.save();

    // Set stroke style
    ctx.strokeStyle = isSelected ? COLORS.selection : isHovered ? COLORS.hover : strokeColor;
    ctx.lineWidth = shape.style.strokeWidth;
    ctx.setLineDash(this.getLineDash(shape.style.lineStyle));

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

      // Fill only the outer outline (first one)
      if (shape.style.fillColor && i === 0) {
        ctx.fillStyle = shape.style.fillColor;
        ctx.fill();
      }

      ctx.stroke();
    }

    // Draw selection handles if selected
    if (isSelected) {
      this.drawParametricHandles(shape);
    }

    ctx.restore();
  }

  /**
   * Draw selection handles for a parametric shape
   */
  private drawParametricHandles(shape: ParametricShape): void {
    const ctx = this.ctx;
    const geometry = (shape as ProfileParametricShape).generatedGeometry;

    if (!geometry) return;

    const { bounds } = geometry;
    const centerX = (bounds.minX + bounds.maxX) / 2;
    const centerY = (bounds.minY + bounds.maxY) / 2;

    // Get zoom level for consistent screen-space sizing
    const zoom = ctx.getTransform().a / this.dpr;
    const handleSize = 6 / zoom;

    // Draw bounding box
    ctx.strokeStyle = COLORS.selection;
    ctx.lineWidth = 1 / zoom;
    ctx.setLineDash([4 / zoom, 4 / zoom]);
    ctx.beginPath();
    ctx.rect(bounds.minX, bounds.minY, bounds.maxX - bounds.minX, bounds.maxY - bounds.minY);
    ctx.stroke();
    ctx.setLineDash([]);

    // Draw center handle (for moving)
    ctx.fillStyle = COLORS.selectionHandle;
    ctx.strokeStyle = COLORS.selectionHandleStroke;
    ctx.lineWidth = 1 / zoom;
    ctx.fillRect(centerX - handleSize / 2, centerY - handleSize / 2, handleSize, handleSize);
    ctx.strokeRect(centerX - handleSize / 2, centerY - handleSize / 2, handleSize, handleSize);

    // Draw axis arrows on center handle
    this.drawAxisArrows({ x: centerX, y: centerY }, zoom);

    // Draw corner handles (for future use - scaling/rotating)
    const corners = [
      { x: bounds.minX, y: bounds.minY },
      { x: bounds.maxX, y: bounds.minY },
      { x: bounds.maxX, y: bounds.maxY },
      { x: bounds.minX, y: bounds.maxY },
    ];

    ctx.fillStyle = COLORS.selectionHandle;
    ctx.strokeStyle = COLORS.selectionHandleStroke;
    ctx.lineWidth = 1 / zoom;

    for (const corner of corners) {
      ctx.fillRect(
        corner.x - handleSize / 2,
        corner.y - handleSize / 2,
        handleSize,
        handleSize
      );
      ctx.strokeRect(
        corner.x - handleSize / 2,
        corner.y - handleSize / 2,
        handleSize,
        handleSize
      );
    }

    // Draw insertion point marker
    ctx.strokeStyle = '#00ff00';
    ctx.lineWidth = 1 / zoom;
    ctx.beginPath();
    // Horizontal line
    ctx.moveTo(shape.position.x - handleSize, shape.position.y);
    ctx.lineTo(shape.position.x + handleSize, shape.position.y);
    // Vertical line
    ctx.moveTo(shape.position.x, shape.position.y - handleSize);
    ctx.lineTo(shape.position.x, shape.position.y + handleSize);
    ctx.stroke();
  }

  /**
   * Draw X (red) and Y (green) axis-constraint arrows at a grip point.
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

    // Y-axis arrow (green, pointing up)
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

  /**
   * Get bounding box of a parametric shape (for hit testing)
   */
  getParametricBounds(shape: ParametricShape): {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
  } | null {
    if (shape.parametricType === 'profile') {
      const profileShape = shape as ProfileParametricShape;
      return profileShape.generatedGeometry?.bounds || null;
    }
    return null;
  }

  /**
   * Check if a point is inside a parametric shape's bounding box
   */
  isPointInParametricShape(
    shape: ParametricShape,
    point: { x: number; y: number },
    tolerance: number = 5
  ): boolean {
    const bounds = this.getParametricBounds(shape);
    if (!bounds) return false;

    return (
      point.x >= bounds.minX - tolerance &&
      point.x <= bounds.maxX + tolerance &&
      point.y >= bounds.minY - tolerance &&
      point.y <= bounds.maxY + tolerance
    );
  }
}
