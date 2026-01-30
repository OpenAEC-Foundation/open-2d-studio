/**
 * GridLayer - Renders grid and axes
 */

import type { Viewport } from '../types';
import { BaseRenderer } from '../core/BaseRenderer';
import { COLORS } from '../types';

export class GridLayer extends BaseRenderer {
  /**
   * Draw grid with adaptive sizing
   */
  drawGrid(viewport: Viewport, gridSize: number, whiteBackground: boolean = false): void {
    const ctx = this.ctx;
    const { left, top, right, bottom } = this.getVisibleArea(viewport);

    // Adjust grid size based on zoom
    let adjustedGridSize = gridSize;
    while (adjustedGridSize * viewport.zoom < 10) {
      adjustedGridSize *= 5;
    }
    while (adjustedGridSize * viewport.zoom > 100) {
      adjustedGridSize /= 5;
    }

    const majorGridSize = adjustedGridSize * 5;

    // Draw minor grid lines
    ctx.strokeStyle = whiteBackground ? '#d0d0d0' : COLORS.gridMinor;
    ctx.lineWidth = 0.5 / viewport.zoom;
    ctx.beginPath();

    const startX = Math.floor(left / adjustedGridSize) * adjustedGridSize;
    const startY = Math.floor(top / adjustedGridSize) * adjustedGridSize;

    for (let x = startX; x <= right; x += adjustedGridSize) {
      if (Math.abs(x % majorGridSize) < 0.001) continue;
      ctx.moveTo(x, top);
      ctx.lineTo(x, bottom);
    }

    for (let y = startY; y <= bottom; y += adjustedGridSize) {
      if (Math.abs(y % majorGridSize) < 0.001) continue;
      ctx.moveTo(left, y);
      ctx.lineTo(right, y);
    }

    ctx.stroke();

    // Draw major grid lines
    ctx.strokeStyle = whiteBackground ? '#b0b0b0' : COLORS.gridMajor;
    ctx.lineWidth = 1 / viewport.zoom;
    ctx.beginPath();

    const majorStartX = Math.floor(left / majorGridSize) * majorGridSize;
    const majorStartY = Math.floor(top / majorGridSize) * majorGridSize;

    for (let x = majorStartX; x <= right; x += majorGridSize) {
      ctx.moveTo(x, top);
      ctx.lineTo(x, bottom);
    }

    for (let y = majorStartY; y <= bottom; y += majorGridSize) {
      ctx.moveTo(left, y);
      ctx.lineTo(right, y);
    }

    ctx.stroke();

    // Draw origin axes
    this.drawAxesInternal(viewport, left, top, right, bottom);
  }

  /**
   * Draw origin axes
   */
  drawAxes(viewport: Viewport): void {
    const { left, top, right, bottom } = this.getVisibleArea(viewport);
    this.drawAxesInternal(viewport, left, top, right, bottom);
  }

  private drawAxesInternal(viewport: Viewport, left: number, top: number, right: number, bottom: number): void {
    const ctx = this.ctx;
    ctx.lineWidth = 2 / viewport.zoom;

    // X axis (red)
    ctx.strokeStyle = COLORS.axisX;
    ctx.beginPath();
    ctx.moveTo(left, 0);
    ctx.lineTo(right, 0);
    ctx.stroke();

    // Y axis (green)
    ctx.strokeStyle = COLORS.axisY;
    ctx.beginPath();
    ctx.moveTo(0, top);
    ctx.lineTo(0, bottom);
    ctx.stroke();
  }
}
