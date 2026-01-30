/**
 * Viewport API - Pan, zoom, view control
 */

import type { AppState } from '../state/appStore';
import type { Viewport as ViewportType, Point } from '../types/geometry';
import { toPoint, type ApiPoint } from './types';
import { getShapesBounds } from '../services/shapeService';

export class ViewportApi {
  constructor(private getState: () => AppState) {}

  get(): ViewportType {
    const { viewport } = this.getState();
    return { ...viewport };
  }

  set(vp: Partial<ViewportType>): void {
    const state = this.getState();
    state.setViewport({
      ...state.viewport,
      ...vp,
    });
  }

  pan(dx: number, dy: number): void {
    const state = this.getState();
    state.setViewport({
      ...state.viewport,
      offsetX: state.viewport.offsetX + dx,
      offsetY: state.viewport.offsetY + dy,
    });
  }

  zoomIn(): void {
    this.getState().zoomIn();
  }

  zoomOut(): void {
    this.getState().zoomOut();
  }

  zoomToFit(): void {
    this.getState().zoomToFit();
  }

  zoomToEntities(ids: string[]): void {
    const state = this.getState();
    const shapes = state.shapes.filter(s => ids.includes(s.id));
    const bounds = getShapesBounds(shapes);
    if (!bounds) return;

    const canvas = state.canvasSize;
    const padding = 50;
    const contentW = bounds.maxX - bounds.minX;
    const contentH = bounds.maxY - bounds.minY;
    if (contentW <= 0 || contentH <= 0) return;

    const zoom = Math.min(
      (canvas.width - padding * 2) / contentW,
      (canvas.height - padding * 2) / contentH
    );
    const centerX = (bounds.minX + bounds.maxX) / 2;
    const centerY = (bounds.minY + bounds.maxY) / 2;

    state.setViewport({
      zoom,
      offsetX: canvas.width / 2 - centerX * zoom,
      offsetY: canvas.height / 2 - centerY * zoom,
    });
  }

  setZoom(level: number): void {
    const state = this.getState();
    state.setViewport({ ...state.viewport, zoom: level });
  }

  reset(): void {
    this.getState().resetView();
  }

  screenToWorld(point: ApiPoint): Point {
    const p = toPoint(point);
    const { viewport } = this.getState();
    return {
      x: (p.x - viewport.offsetX) / viewport.zoom,
      y: (p.y - viewport.offsetY) / viewport.zoom,
    };
  }

  worldToScreen(point: ApiPoint): Point {
    const p = toPoint(point);
    const { viewport } = this.getState();
    return {
      x: p.x * viewport.zoom + viewport.offsetX,
      y: p.y * viewport.zoom + viewport.offsetY,
    };
  }

  get canvasSize(): { width: number; height: number } {
    return { ...this.getState().canvasSize };
  }
}
