import type { Point } from '../../types/geometry';

export interface GripHandler {
  getGripPoints: (shape: any) => Point[];
  getReferencePoint: (shape: any) => Point;
  computeBodyMove: (shape: any, newPos: Point) => Record<string, any> | null;
  computeGripUpdate: (shape: any, gripIndex: number, newPos: Point) => Record<string, any> | null;
}

class GripProviderRegistry {
  private handlers = new Map<string, GripHandler>();

  register(shapeType: string, handler: GripHandler): void { this.handlers.set(shapeType, handler); }
  unregister(shapeType: string): void { this.handlers.delete(shapeType); }
  get(shapeType: string): GripHandler | undefined { return this.handlers.get(shapeType); }
}

export const gripProviderRegistry = new GripProviderRegistry();
