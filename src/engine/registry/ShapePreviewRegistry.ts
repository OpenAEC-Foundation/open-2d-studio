import type { ShapeRenderContext } from '../renderer/core/ShapeRenderContext';

export type ShapePreviewRenderFn = (ctx: CanvasRenderingContext2D, preview: any, style: any, viewport: any, invertColors: boolean, renderCtx?: ShapeRenderContext) => void;

class ShapePreviewRegistry {
  private renderers = new Map<string, ShapePreviewRenderFn>();

  register(previewType: string, fn: ShapePreviewRenderFn): void { this.renderers.set(previewType, fn); }
  unregister(previewType: string): void { this.renderers.delete(previewType); }
  get(previewType: string): ShapePreviewRenderFn | undefined { return this.renderers.get(previewType); }
}

export const shapePreviewRegistry = new ShapePreviewRegistry();
