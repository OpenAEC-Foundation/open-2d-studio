import type { ShapeRenderContext } from '../renderer/core/ShapeRenderContext';

export type ShapeRenderFn = (ctx: CanvasRenderingContext2D, shape: any, isSelected: boolean, isHovered: boolean, invertColors: boolean, renderCtx?: ShapeRenderContext) => void;
export type ShapeSimpleRenderFn = (ctx: CanvasRenderingContext2D, shape: any, invertColors: boolean, renderCtx?: ShapeRenderContext) => void;

class ShapeRendererRegistry {
  private renderers = new Map<string, ShapeRenderFn>();
  private simpleRenderers = new Map<string, ShapeSimpleRenderFn>();

  register(shapeType: string, fn: ShapeRenderFn): void { this.renderers.set(shapeType, fn); }
  registerSimple(shapeType: string, fn: ShapeSimpleRenderFn): void { this.simpleRenderers.set(shapeType, fn); }
  unregister(shapeType: string): void { this.renderers.delete(shapeType); this.simpleRenderers.delete(shapeType); }
  get(shapeType: string): ShapeRenderFn | undefined { return this.renderers.get(shapeType); }
  getSimple(shapeType: string): ShapeSimpleRenderFn | undefined { return this.simpleRenderers.get(shapeType); }
}

export const shapeRendererRegistry = new ShapeRendererRegistry();
