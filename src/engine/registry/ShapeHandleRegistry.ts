export type ShapeHandleFn = (shape: any) => { x: number; y: number }[];

class ShapeHandleRegistry {
  private handlers = new Map<string, ShapeHandleFn>();

  register(shapeType: string, fn: ShapeHandleFn): void { this.handlers.set(shapeType, fn); }
  unregister(shapeType: string): void { this.handlers.delete(shapeType); }
  get(shapeType: string): ShapeHandleFn | undefined { return this.handlers.get(shapeType); }
}

export const shapeHandleRegistry = new ShapeHandleRegistry();
