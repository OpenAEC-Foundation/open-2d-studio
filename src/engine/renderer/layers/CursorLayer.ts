/**
 * CursorLayer - Renders the persistent 2D cursor (crosshair marker)
 *
 * The 2D cursor is a user-positionable reference point on the canvas.
 * It can be placed with Shift+Right-Click, reset with Shift+C,
 * and used as a pivot/reference point for operations.
 */

import type { Viewport, Point } from '../types';
import { BaseRenderer } from '../core/BaseRenderer';
import type { UnitSettings } from '../../../units/types';
import { formatCoordinate } from '../../../units/format';

export class CursorLayer extends BaseRenderer {
  /**
   * Draw the 2D cursor at the given world position
   */
  drawCursor(position: Point, viewport: Viewport, whiteBackground?: boolean, _unitSettings?: UnitSettings): void {
    const ctx = this.ctx;

    ctx.save();

    const innerSize = 6 / viewport.zoom;
    const outerSize = 14 / viewport.zoom;
    const circleRadius = 4 / viewport.zoom;
    const lineWidth = 1.5 / viewport.zoom;

    // Colors
    const primaryColor = '#ff4444';
    const outlineColor = whiteBackground ? 'rgba(0, 0, 0, 0.3)' : 'rgba(255, 255, 255, 0.3)';

    // Draw outline (for contrast)
    ctx.strokeStyle = outlineColor;
    ctx.lineWidth = (lineWidth + 1 / viewport.zoom);
    ctx.setLineDash([]);

    // Outer crosshair outline
    ctx.beginPath();
    ctx.moveTo(position.x - outerSize, position.y);
    ctx.lineTo(position.x - innerSize, position.y);
    ctx.moveTo(position.x + innerSize, position.y);
    ctx.lineTo(position.x + outerSize, position.y);
    ctx.moveTo(position.x, position.y - outerSize);
    ctx.lineTo(position.x, position.y - innerSize);
    ctx.moveTo(position.x, position.y + innerSize);
    ctx.lineTo(position.x, position.y + outerSize);
    ctx.stroke();

    // Circle outline
    ctx.beginPath();
    ctx.arc(position.x, position.y, circleRadius, 0, Math.PI * 2);
    ctx.stroke();

    // Draw primary color
    ctx.strokeStyle = primaryColor;
    ctx.lineWidth = lineWidth;

    // Crosshair arms (with gap in the middle for the circle)
    ctx.beginPath();
    ctx.moveTo(position.x - outerSize, position.y);
    ctx.lineTo(position.x - innerSize, position.y);
    ctx.moveTo(position.x + innerSize, position.y);
    ctx.lineTo(position.x + outerSize, position.y);
    ctx.moveTo(position.x, position.y - outerSize);
    ctx.lineTo(position.x, position.y - innerSize);
    ctx.moveTo(position.x, position.y + innerSize);
    ctx.lineTo(position.x, position.y + outerSize);
    ctx.stroke();

    // Circle
    ctx.beginPath();
    ctx.arc(position.x, position.y, circleRadius, 0, Math.PI * 2);
    ctx.stroke();

    // Center dot
    ctx.fillStyle = primaryColor;
    ctx.beginPath();
    ctx.arc(position.x, position.y, 1 / viewport.zoom, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }

  /**
   * Draw cursor coordinate label in screen coordinates
   */
  drawCursorLabel(position: Point, viewport: Viewport, unitSettings?: UnitSettings): void {
    const ctx = this.ctx;
    const screen = this.worldToScreen(position, viewport);

    ctx.save();
    this.resetTransform();

    const label = unitSettings
      ? `2D Cursor: ${formatCoordinate(position.x, position.y, unitSettings)}`
      : `2D Cursor: ${position.x.toFixed(2)}, ${(-position.y).toFixed(2)}`;

    ctx.font = '10px Arial, sans-serif';
    const metrics = ctx.measureText(label);
    const padding = 3;
    const labelX = screen.x + 18;
    const labelY = screen.y - 8;

    ctx.fillStyle = 'rgba(80, 0, 0, 0.8)';
    ctx.fillRect(labelX - padding, labelY - 10, metrics.width + padding * 2, 14);

    ctx.fillStyle = '#ff6666';
    ctx.fillText(label, labelX, labelY);

    ctx.restore();
  }
}
