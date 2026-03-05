export type BoundsFn = (shape: any, drawingScale?: number) => { minX: number; minY: number; maxX: number; maxY: number } | null;

class BoundsRegistry {
  private handlers = new Map<string, BoundsFn>();

  register(shapeType: string, fn: BoundsFn): void { this.handlers.set(shapeType, fn); }
  unregister(shapeType: string): void { this.handlers.delete(shapeType); }
  get(shapeType: string): BoundsFn | undefined { return this.handlers.get(shapeType); }
}

export const boundsRegistry = new BoundsRegistry();
