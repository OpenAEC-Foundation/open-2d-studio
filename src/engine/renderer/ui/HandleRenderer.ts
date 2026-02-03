/**
 * HandleRenderer - Renders boundary and viewport handles for interactive editing
 */

import type { Viewport, DrawingBoundary, SheetViewport } from '../types';
import { BaseRenderer } from '../core/BaseRenderer';

// Boundary handle types for interactive editing
export type BoundaryHandleType =
  | 'top-left' | 'top' | 'top-right'
  | 'left' | 'center' | 'right'
  | 'bottom-left' | 'bottom' | 'bottom-right';

// Viewport handle type for sheet viewport manipulation
export type ViewportHandleType =
  | 'top-left' | 'top' | 'top-right'
  | 'left' | 'center' | 'right'
  | 'bottom-left' | 'bottom' | 'bottom-right';

export class HandleRenderer extends BaseRenderer {
  /**
   * Draw drawing boundary with corner markers or handles
   */
  drawDrawingBoundary(
    boundary: DrawingBoundary,
    viewport: Viewport,
    isSelected: boolean,
    _isDragging: boolean
  ): void {
    const ctx = this.ctx;

    ctx.save();

    // Different colors for selected vs normal state
    const baseColor = isSelected ? '#ff6b35' : '#00bcd4'; // Orange when selected, cyan otherwise
    const lineWidth = isSelected ? 3 / viewport.zoom : 2 / viewport.zoom;

    // Draw the boundary rectangle
    ctx.strokeStyle = baseColor;
    ctx.lineWidth = lineWidth;

    if (isSelected) {
      ctx.setLineDash([]); // Solid when selected
    } else {
      ctx.setLineDash([10 / viewport.zoom, 5 / viewport.zoom]);
    }

    ctx.beginPath();
    ctx.rect(boundary.x, boundary.y, boundary.width, boundary.height);
    ctx.stroke();

    ctx.setLineDash([]);

    if (isSelected) {
      // Draw resize handles
      this.drawBoundaryHandles(boundary, viewport);
    } else {
      // Draw corner markers for normal state
      this.drawBoundaryCornerMarkers(boundary, viewport, baseColor);
    }

    // Draw "BOUNDARY" label at top
    ctx.font = `${12 / viewport.zoom}px Arial`;
    ctx.fillStyle = baseColor;
    const labelText = isSelected ? 'BOUNDARY (Click and drag handles to resize)' : 'BOUNDARY';
    const labelWidth = ctx.measureText(labelText).width;
    ctx.fillText(labelText, boundary.x + (boundary.width - labelWidth) / 2, boundary.y - 8 / viewport.zoom);

    ctx.restore();
  }

  // Legacy alias
  drawDraftBoundary = this.drawDrawingBoundary;

  /**
   * Draw corner markers for non-selected boundary
   */
  private drawBoundaryCornerMarkers(
    boundary: DrawingBoundary,
    viewport: Viewport,
    color: string
  ): void {
    const ctx = this.ctx;
    ctx.fillStyle = color;
    const markerSize = 8 / viewport.zoom;

    // Top-left corner
    ctx.beginPath();
    ctx.moveTo(boundary.x, boundary.y);
    ctx.lineTo(boundary.x + markerSize * 2, boundary.y);
    ctx.lineTo(boundary.x + markerSize * 2, boundary.y + markerSize / 2);
    ctx.lineTo(boundary.x + markerSize / 2, boundary.y + markerSize / 2);
    ctx.lineTo(boundary.x + markerSize / 2, boundary.y + markerSize * 2);
    ctx.lineTo(boundary.x, boundary.y + markerSize * 2);
    ctx.closePath();
    ctx.fill();

    // Top-right corner
    ctx.beginPath();
    ctx.moveTo(boundary.x + boundary.width, boundary.y);
    ctx.lineTo(boundary.x + boundary.width - markerSize * 2, boundary.y);
    ctx.lineTo(boundary.x + boundary.width - markerSize * 2, boundary.y + markerSize / 2);
    ctx.lineTo(boundary.x + boundary.width - markerSize / 2, boundary.y + markerSize / 2);
    ctx.lineTo(boundary.x + boundary.width - markerSize / 2, boundary.y + markerSize * 2);
    ctx.lineTo(boundary.x + boundary.width, boundary.y + markerSize * 2);
    ctx.closePath();
    ctx.fill();

    // Bottom-right corner
    ctx.beginPath();
    ctx.moveTo(boundary.x + boundary.width, boundary.y + boundary.height);
    ctx.lineTo(boundary.x + boundary.width - markerSize * 2, boundary.y + boundary.height);
    ctx.lineTo(boundary.x + boundary.width - markerSize * 2, boundary.y + boundary.height - markerSize / 2);
    ctx.lineTo(boundary.x + boundary.width - markerSize / 2, boundary.y + boundary.height - markerSize / 2);
    ctx.lineTo(boundary.x + boundary.width - markerSize / 2, boundary.y + boundary.height - markerSize * 2);
    ctx.lineTo(boundary.x + boundary.width, boundary.y + boundary.height - markerSize * 2);
    ctx.closePath();
    ctx.fill();

    // Bottom-left corner
    ctx.beginPath();
    ctx.moveTo(boundary.x, boundary.y + boundary.height);
    ctx.lineTo(boundary.x + markerSize * 2, boundary.y + boundary.height);
    ctx.lineTo(boundary.x + markerSize * 2, boundary.y + boundary.height - markerSize / 2);
    ctx.lineTo(boundary.x + markerSize / 2, boundary.y + boundary.height - markerSize / 2);
    ctx.lineTo(boundary.x + markerSize / 2, boundary.y + boundary.height - markerSize * 2);
    ctx.lineTo(boundary.x, boundary.y + boundary.height - markerSize * 2);
    ctx.closePath();
    ctx.fill();
  }

  /**
   * Draw boundary resize handles
   */
  private drawBoundaryHandles(boundary: DrawingBoundary, viewport: Viewport): void {
    const ctx = this.ctx;
    const handleSize = 10 / viewport.zoom;
    const halfHandle = handleSize / 2;

    const handles = this.getBoundaryHandlePositions(boundary);

    for (const handle of handles) {
      ctx.save();

      if (handle.type === 'center') {
        // Draw center handle as a circle with move arrows
        ctx.fillStyle = '#4caf50'; // Green for move handle
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1 / viewport.zoom;

        ctx.beginPath();
        ctx.arc(handle.x, handle.y, handleSize * 0.8, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();

        // Draw move arrows
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1.5 / viewport.zoom;
        const arrowSize = handleSize * 0.4;

        // Horizontal arrows
        ctx.beginPath();
        ctx.moveTo(handle.x - arrowSize, handle.y);
        ctx.lineTo(handle.x + arrowSize, handle.y);
        ctx.stroke();

        // Vertical arrows
        ctx.beginPath();
        ctx.moveTo(handle.x, handle.y - arrowSize);
        ctx.lineTo(handle.x, handle.y + arrowSize);
        ctx.stroke();
      } else {
        // Draw resize handle as filled square
        const isCorner = handle.type.includes('-');
        ctx.fillStyle = isCorner ? '#2196f3' : '#03a9f4'; // Blue for corners, lighter for edges
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1 / viewport.zoom;

        ctx.fillRect(handle.x - halfHandle, handle.y - halfHandle, handleSize, handleSize);
        ctx.strokeRect(handle.x - halfHandle, handle.y - halfHandle, handleSize, handleSize);
      }

      ctx.restore();
    }
  }

  /**
   * Get boundary handle positions for hit testing
   */
  getBoundaryHandlePositions(boundary: DrawingBoundary): { type: BoundaryHandleType; x: number; y: number }[] {
    return [
      { type: 'top-left', x: boundary.x, y: boundary.y },
      { type: 'top-right', x: boundary.x + boundary.width, y: boundary.y },
      { type: 'bottom-left', x: boundary.x, y: boundary.y + boundary.height },
      { type: 'bottom-right', x: boundary.x + boundary.width, y: boundary.y + boundary.height },
      { type: 'top', x: boundary.x + boundary.width / 2, y: boundary.y },
      { type: 'bottom', x: boundary.x + boundary.width / 2, y: boundary.y + boundary.height },
      { type: 'left', x: boundary.x, y: boundary.y + boundary.height / 2 },
      { type: 'right', x: boundary.x + boundary.width, y: boundary.y + boundary.height / 2 },
      { type: 'center', x: boundary.x + boundary.width / 2, y: boundary.y + boundary.height / 2 },
    ];
  }

  /**
   * Draw viewport move handle (center only - Revit-style: size is derived from boundary × scale)
   * @param x - X position in pixels (already scaled)
   * @param y - Y position in pixels (already scaled)
   * @param width - Width in pixels (already scaled)
   * @param height - Height in pixels (already scaled)
   * @param zoom - Current sheet viewport zoom level
   */
  drawViewportHandles(x: number, y: number, width: number, height: number, zoom: number = 1): void {
    const ctx = this.ctx;
    // Compensate for zoom so handles appear consistent size on screen
    const handleSize = 10 / zoom;
    const lineWidth = 1.5 / zoom;

    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = lineWidth;

    // Only draw center handle for moving (Revit-style: no resize, size = boundary × scale)
    ctx.fillStyle = '#4a90d9';
    const centerX = x + width / 2;
    const centerY = y + height / 2;

    // Draw move handle as a larger circle with move icon
    ctx.beginPath();
    ctx.arc(centerX, centerY, handleSize, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // Draw move arrows inside
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.5 / zoom;
    const arrowSize = handleSize * 0.5;

    // Horizontal line
    ctx.beginPath();
    ctx.moveTo(centerX - arrowSize, centerY);
    ctx.lineTo(centerX + arrowSize, centerY);
    ctx.stroke();

    // Vertical line
    ctx.beginPath();
    ctx.moveTo(centerX, centerY - arrowSize);
    ctx.lineTo(centerX, centerY + arrowSize);
    ctx.stroke();
  }

  /**
   * Get viewport handle positions for hit testing
   */
  getViewportHandlePositions(vp: SheetViewport): Record<ViewportHandleType, { x: number; y: number }> {
    return {
      'top-left': { x: vp.x, y: vp.y },
      'top': { x: vp.x + vp.width / 2, y: vp.y },
      'top-right': { x: vp.x + vp.width, y: vp.y },
      'left': { x: vp.x, y: vp.y + vp.height / 2 },
      'center': { x: vp.x + vp.width / 2, y: vp.y + vp.height / 2 },
      'right': { x: vp.x + vp.width, y: vp.y + vp.height / 2 },
      'bottom-left': { x: vp.x, y: vp.y + vp.height },
      'bottom': { x: vp.x + vp.width / 2, y: vp.y + vp.height },
      'bottom-right': { x: vp.x + vp.width, y: vp.y + vp.height },
    };
  }

  /**
   * Check if a point (in sheet mm coordinates) is inside a viewport
   */
  isPointInViewport(point: { x: number; y: number }, vp: SheetViewport): boolean {
    return (
      point.x >= vp.x &&
      point.x <= vp.x + vp.width &&
      point.y >= vp.y &&
      point.y <= vp.y + vp.height
    );
  }

  /**
   * Find which handle (if any) is at the given point
   */
  findViewportHandleAtPoint(
    point: { x: number; y: number },
    vp: SheetViewport,
    tolerance: number = 5 // mm
  ): ViewportHandleType | null {
    const handles = this.getViewportHandlePositions(vp);

    for (const [handleType, handlePos] of Object.entries(handles)) {
      const dx = point.x - handlePos.x;
      const dy = point.y - handlePos.y;
      const distance = Math.sqrt(dx * dx + dy * dy);
      if (distance <= tolerance) {
        return handleType as ViewportHandleType;
      }
    }

    return null;
  }
}
