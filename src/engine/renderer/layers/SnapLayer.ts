/**
 * SnapLayer - Renders snap point indicators and labels
 *
 * Snap markers are drawn with a dark outline and subtle halo so they
 * remain clearly visible on any canvas background (white, dark, or colored).
 */

import type { Viewport, SnapPoint, SnapType } from '../types';
import { BaseRenderer } from '../core/BaseRenderer';
import { SNAP_COLORS, SNAP_LABELS } from '../types';

/** Outline color drawn behind the snap marker for contrast */
const SNAP_OUTLINE_COLOR = '#000000';
/** Halo color (semi-transparent black) drawn as a soft glow behind the outline */
const SNAP_HALO_COLOR = 'rgba(0, 0, 0, 0.35)';

export class SnapLayer extends BaseRenderer {
  // -------------------------------------------------------------------
  //  Marker path helpers
  //  Each helper traces a path for a snap type but does NOT stroke/fill
  //  so callers can draw the same shape multiple times (halo, outline, fill).
  // -------------------------------------------------------------------

  private pathEndpoint(x: number, y: number, size: number): void {
    // Square marker
    const ctx = this.ctx;
    ctx.beginPath();
    ctx.rect(x - size / 2, y - size / 2, size, size);
  }

  private pathMidpoint(x: number, y: number, size: number): void {
    // Triangle marker
    const ctx = this.ctx;
    ctx.beginPath();
    ctx.moveTo(x, y - size / 2);
    ctx.lineTo(x - size / 2, y + size / 2);
    ctx.lineTo(x + size / 2, y + size / 2);
    ctx.closePath();
  }

  private pathCenter(x: number, y: number, size: number): void {
    // Circle marker
    const ctx = this.ctx;
    ctx.beginPath();
    ctx.arc(x, y, size / 2, 0, Math.PI * 2);
  }

  private pathIntersection(x: number, y: number, size: number): void {
    // X marker (open path)
    const ctx = this.ctx;
    ctx.beginPath();
    ctx.moveTo(x - size / 2, y - size / 2);
    ctx.lineTo(x + size / 2, y + size / 2);
    ctx.moveTo(x + size / 2, y - size / 2);
    ctx.lineTo(x - size / 2, y + size / 2);
  }

  private pathPerpendicular(x: number, y: number, size: number): void {
    // L-shape with small corner square (open path)
    const ctx = this.ctx;
    const cs = size / 4;
    ctx.beginPath();
    ctx.moveTo(x - size / 2, y);
    ctx.lineTo(x, y);
    ctx.lineTo(x, y - size / 2);
    // corner square
    ctx.moveTo(x - cs, y);
    ctx.lineTo(x - cs, y - cs);
    ctx.lineTo(x, y - cs);
  }

  private pathTangent(x: number, y: number, size: number): void {
    // Circle with tangent line
    const ctx = this.ctx;
    ctx.beginPath();
    ctx.arc(x, y, size / 3, 0, Math.PI * 2);
    ctx.moveTo(x - size / 2, y + size / 3);
    ctx.lineTo(x + size / 2, y + size / 3);
  }

  private pathNearest(x: number, y: number, size: number): void {
    // Diamond marker
    const ctx = this.ctx;
    ctx.beginPath();
    ctx.moveTo(x, y - size / 2);
    ctx.lineTo(x + size / 2, y);
    ctx.lineTo(x, y + size / 2);
    ctx.lineTo(x - size / 2, y);
    ctx.closePath();
  }

  private pathGrid(x: number, y: number, size: number): void {
    // Plus marker (open path)
    const ctx = this.ctx;
    ctx.beginPath();
    ctx.moveTo(x - size / 2, y);
    ctx.lineTo(x + size / 2, y);
    ctx.moveTo(x, y - size / 2);
    ctx.lineTo(x, y + size / 2);
  }

  private pathOrigin(x: number, y: number, size: number): void {
    // Circle with crosshair
    const ctx = this.ctx;
    ctx.beginPath();
    ctx.arc(x, y, size / 2, 0, Math.PI * 2);
    ctx.moveTo(x - size / 2, y);
    ctx.lineTo(x + size / 2, y);
    ctx.moveTo(x, y - size / 2);
    ctx.lineTo(x, y + size / 2);
  }

  private pathParallel(x: number, y: number, size: number): void {
    // Two parallel horizontal lines
    const ctx = this.ctx;
    ctx.beginPath();
    ctx.moveTo(x - size / 2, y - size / 4);
    ctx.lineTo(x + size / 2, y - size / 4);
    ctx.moveTo(x - size / 2, y + size / 4);
    ctx.lineTo(x + size / 2, y + size / 4);
  }

  private pathAlignment(x: number, y: number, size: number): void {
    // Three horizontal bars (alignment symbol)
    const ctx = this.ctx;
    ctx.beginPath();
    ctx.moveTo(x - size / 2, y - size / 3);
    ctx.lineTo(x + size / 2, y - size / 3);
    ctx.moveTo(x - size / 2, y);
    ctx.lineTo(x + size / 2, y);
    ctx.moveTo(x - size / 2, y + size / 3);
    ctx.lineTo(x + size / 2, y + size / 3);
  }

  private pathDefault(x: number, y: number, size: number): void {
    // Small filled circle fallback
    const ctx = this.ctx;
    ctx.beginPath();
    ctx.arc(x, y, size / 3, 0, Math.PI * 2);
  }

  /**
   * Trace the snap marker path for a given type.
   * Returns true if the shape is closed (should be stroked, not filled-only).
   * The 'default' type returns false to indicate it should be filled.
   */
  private tracePath(type: SnapType, x: number, y: number, size: number): boolean {
    switch (type) {
      case 'endpoint':       this.pathEndpoint(x, y, size); return true;
      case 'midpoint':       this.pathMidpoint(x, y, size); return true;
      case 'center':         this.pathCenter(x, y, size); return true;
      case 'intersection':   this.pathIntersection(x, y, size); return true;
      case 'perpendicular':  this.pathPerpendicular(x, y, size); return true;
      case 'tangent':        this.pathTangent(x, y, size); return true;
      case 'nearest':        this.pathNearest(x, y, size); return true;
      case 'grid':           this.pathGrid(x, y, size); return true;
      case 'origin':         this.pathOrigin(x, y, size); return true;
      case 'parallel':       this.pathParallel(x, y, size); return true;
      case 'alignment':      this.pathAlignment(x, y, size); return true;
      default:               this.pathDefault(x, y, size); return false;
    }
  }

  // -------------------------------------------------------------------
  //  Public API
  // -------------------------------------------------------------------

  /**
   * Draw snap point indicator in world coordinates.
   *
   * Rendering order (back to front):
   *   1. Halo  - wide semi-transparent black stroke for soft glow
   *   2. Outline - dark solid stroke for hard contrast edge
   *   3. Main  - colored stroke/fill matching the snap type
   */
  drawSnapIndicator(snapPoint: SnapPoint, viewport: Viewport): void {
    const ctx = this.ctx;
    const { point, type } = snapPoint;

    // Slightly larger marker for better visibility (was 8)
    const size = 12 / viewport.zoom;
    const invZoom = 1 / viewport.zoom;

    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    const color = this.getSnapColor(type);

    // --- Pass 1: Halo (soft glow) ---
    this.tracePath(type, point.x, point.y, size);
    ctx.strokeStyle = SNAP_HALO_COLOR;
    ctx.lineWidth = 5.5 * invZoom;
    ctx.stroke();

    // --- Pass 2: Dark outline ---
    this.tracePath(type, point.x, point.y, size);
    ctx.strokeStyle = SNAP_OUTLINE_COLOR;
    ctx.lineWidth = 3.5 * invZoom;
    ctx.stroke();

    // --- Pass 3: Colored main indicator ---
    const isStandard = this.tracePath(type, point.x, point.y, size);
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = 1.8 * invZoom;

    if (isStandard) {
      ctx.stroke();
    } else {
      // Default fallback: filled circle
      ctx.fill();
      // Also add a thin outline for the filled circle
      ctx.strokeStyle = SNAP_OUTLINE_COLOR;
      ctx.lineWidth = 1.2 * invZoom;
      ctx.stroke();
    }

    ctx.restore();
  }

  /**
   * Draw alignment guide line (dashed line from source key point to snap point)
   */
  drawAlignmentGuide(snapPoint: SnapPoint, viewport: Viewport): void {
    if (snapPoint.type !== 'alignment' || !snapPoint.alignmentSource) return;

    const ctx = this.ctx;
    const { point, alignmentSource } = snapPoint;

    ctx.save();

    const color = this.getSnapColor('alignment');
    ctx.strokeStyle = color;
    ctx.lineWidth = 1 / viewport.zoom;
    ctx.setLineDash([6 / viewport.zoom, 4 / viewport.zoom]);
    ctx.globalAlpha = 0.7;

    ctx.beginPath();
    ctx.moveTo(alignmentSource.x, alignmentSource.y);
    ctx.lineTo(point.x, point.y);
    ctx.stroke();

    // Draw small circle at source key point
    ctx.setLineDash([]);
    ctx.globalAlpha = 0.5;
    ctx.beginPath();
    ctx.arc(alignmentSource.x, alignmentSource.y, 3 / viewport.zoom, 0, Math.PI * 2);
    ctx.stroke();

    ctx.restore();
  }

  /**
   * Draw snap label in screen coordinates
   */
  drawSnapLabel(snapPoint: SnapPoint, viewport: Viewport): void {
    const ctx = this.ctx;
    const { point, type } = snapPoint;

    // Convert world point to screen coordinates
    const screen = this.worldToScreen(point, viewport);

    ctx.save();
    this.resetTransform();

    // Draw label background
    const label = this.getSnapLabel(type);
    ctx.font = '11px Arial, sans-serif';
    const metrics = ctx.measureText(label);
    const padding = 4;
    const labelX = screen.x + 12;
    const labelY = screen.y - 12;

    ctx.fillStyle = 'rgba(0, 0, 0, 0.8)';
    ctx.fillRect(labelX - padding, labelY - 11, metrics.width + padding * 2, 14);

    // Draw label text
    ctx.fillStyle = this.getSnapColor(type);
    ctx.fillText(label, labelX, labelY);

    ctx.restore();
  }

  /**
   * Get snap color
   */
  getSnapColor(type: SnapType): string {
    return SNAP_COLORS[type] || '#ffffff';
  }

  /**
   * Get snap label
   */
  getSnapLabel(type: SnapType): string {
    return SNAP_LABELS[type] || type;
  }
}
