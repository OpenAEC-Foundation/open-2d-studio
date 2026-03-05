import type { Point } from '../../types/geometry';

export type SnapPointFn = (shape: any, activeSnaps: string[], cursor?: Point, basePoint?: Point) => any[];
export type ShapeSegmentFn = (shape: any) => { start: Point; end: Point }[];

class SnapProviderRegistry {
  private snapHandlers = new Map<string, SnapPointFn>();
  private segmentHandlers = new Map<string, ShapeSegmentFn>();

  registerSnap(type: string, fn: SnapPointFn): void { this.snapHandlers.set(type, fn); }
  registerSegments(type: string, fn: ShapeSegmentFn): void { this.segmentHandlers.set(type, fn); }
  unregisterSnap(type: string): void { this.snapHandlers.delete(type); }
  unregisterSegments(type: string): void { this.segmentHandlers.delete(type); }
  getSnap(type: string): SnapPointFn | undefined { return this.snapHandlers.get(type); }
  getSegments(type: string): ShapeSegmentFn | undefined { return this.segmentHandlers.get(type); }
}

export const snapProviderRegistry = new SnapProviderRegistry();
