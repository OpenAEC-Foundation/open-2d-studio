/**
 * BaseRenderer - Shared rendering utilities
 */

import type { RenderContext, Viewport } from '../types';
import { LINE_DASH_PATTERNS } from '../types';

/**
 * Adapt a color for the current background mode.
 *
 * When `invertColors` is true the canvas uses a light (paper/print) background,
 * so pure-black strokes stay black and pure-white strokes are converted to black
 * (they would be invisible on a white background).
 * When `invertColors` is false the canvas uses a dark background, so pure-white
 * strokes stay white and pure-black strokes are converted to white
 * (they would be invisible on a black background).
 *
 * All other colors are returned unchanged.
 */
export function adaptColorForBackground(color: string, invertColors: boolean): string {
  const lower = color.toLowerCase();
  if (invertColors) {
    // Light background: white → black
    if (lower === '#ffffff' || lower === '#fff' || lower === 'white') return '#000000';
  } else {
    // Dark background: black → white
    if (lower === '#000000' || lower === '#000' || lower === 'black') return '#ffffff';
  }
  return color;
}

export class BaseRenderer {
  protected ctx: CanvasRenderingContext2D;
  protected width: number;
  protected height: number;
  protected dpr: number;

  constructor(ctx: CanvasRenderingContext2D, width: number = 0, height: number = 0, dpr?: number) {
    this.ctx = ctx;
    this.width = width;
    this.height = height;
    this.dpr = dpr ?? window.devicePixelRatio ?? 1;
  }

  /**
   * Update dimensions
   */
  setDimensions(width: number, height: number): void {
    this.width = width;
    this.height = height;
  }

  /**
   * Get render context
   */
  getContext(): RenderContext {
    return {
      ctx: this.ctx,
      width: this.width,
      height: this.height,
      dpr: this.dpr,
      viewport: { offsetX: 0, offsetY: 0, zoom: 1 },
    };
  }

  /**
   * Clear canvas with a color
   */
  clear(color: string): void {
    const ctx = this.ctx;
    ctx.save();
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, this.width, this.height);
    ctx.restore();
  }

  /**
   * Apply viewport transform
   *
   * Translate values are rounded to the nearest integer before being passed to
   * the canvas context.  Canvas 2D uses float32 internally for transforms, so
   * at large world coordinates (e.g. Dutch RD: x≈155 000, y≈463 000) the raw
   * sub-pixel fractions accumulate float32 rounding errors that manifest as
   * visible sub-pixel jitter at high zoom levels.  Rounding to whole pixels
   * eliminates this artefact without affecting visible sharpness.
   */
  applyViewportTransform(viewport: Viewport): void {
    this.ctx.translate(Math.round(viewport.offsetX), Math.round(viewport.offsetY));
    if (viewport.rotation) {
      this.ctx.rotate(viewport.rotation);
    }
    this.ctx.scale(viewport.zoom, viewport.zoom);
  }

  /**
   * Reset transform to identity with DPR
   */
  resetTransform(): void {
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
  }

  /**
   * Convert world coordinates to screen coordinates
   */
  worldToScreen(point: { x: number; y: number }, viewport: Viewport): { x: number; y: number } {
    return {
      x: point.x * viewport.zoom + viewport.offsetX,
      y: point.y * viewport.zoom + viewport.offsetY,
    };
  }

  /**
   * Convert screen coordinates to world coordinates
   */
  screenToWorld(point: { x: number; y: number }, viewport: Viewport): { x: number; y: number } {
    return {
      x: (point.x - viewport.offsetX) / viewport.zoom,
      y: (point.y - viewport.offsetY) / viewport.zoom,
    };
  }

  /**
   * Get line dash pattern for a style
   */
  getLineDash(lineStyle: string): number[] {
    return LINE_DASH_PATTERNS[lineStyle] || [];
  }

  /**
   * Calculate visible area in world coordinates
   */
  getVisibleArea(viewport: Viewport): { left: number; top: number; right: number; bottom: number } {
    const left = -viewport.offsetX / viewport.zoom;
    const top = -viewport.offsetY / viewport.zoom;
    const right = left + this.width / viewport.zoom;
    const bottom = top + this.height / viewport.zoom;
    return { left, top, right, bottom };
  }

  /**
   * Scale a value for the current zoom level (for consistent UI elements)
   */
  scaleForZoom(value: number, viewport: Viewport): number {
    return value / viewport.zoom;
  }

  /**
   * Save context state
   */
  save(): void {
    this.ctx.save();
  }

  /**
   * Restore context state
   */
  restore(): void {
    this.ctx.restore();
  }
}
