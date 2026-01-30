/**
 * Selection API - Selection management
 */

import type { AppState } from '../state/appStore';
import type { Shape } from '../types/geometry';

export class SelectionApi {
  constructor(private getState: () => AppState) {}

  get(): string[] {
    return [...this.getState().selectedShapeIds];
  }

  getEntities(): Shape[] {
    const state = this.getState();
    const ids = new Set(state.selectedShapeIds);
    return state.shapes.filter(s => ids.has(s.id));
  }

  set(ids: string[]): void {
    this.getState().selectShapes(ids);
  }

  add(ids: string[]): void {
    const state = this.getState();
    const current = new Set(state.selectedShapeIds);
    ids.forEach(id => current.add(id));
    state.selectShapes(Array.from(current));
  }

  remove(ids: string[]): void {
    const state = this.getState();
    const removeSet = new Set(ids);
    state.selectShapes(state.selectedShapeIds.filter(id => !removeSet.has(id)));
  }

  clear(): void {
    this.getState().deselectAll();
  }

  all(): void {
    this.getState().selectAll();
  }

  filter(predicate: (shape: Shape) => boolean): Shape[] {
    return this.getEntities().filter(predicate);
  }

  count(): number {
    return this.getState().selectedShapeIds.length;
  }
}
