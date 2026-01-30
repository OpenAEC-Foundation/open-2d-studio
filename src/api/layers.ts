/**
 * Layer API - Layer management
 */

import type { AppState } from '../state/appStore';
import type { Layer } from '../types/geometry';
import type { TransactionManager } from './transactions';

export class LayersApi {
  constructor(
    private getState: () => AppState,
    _transactions: TransactionManager
  ) {}

  create(name: string, options?: Partial<Omit<Layer, 'id' | 'name' | 'drawingId'>>): Layer {
    const state = this.getState();
    const prevLayerIds = new Set(state.layers.map(l => l.id));
    state.addLayer(name);
    // Find the newly added layer
    const newLayer = this.getState().layers.find(l => !prevLayerIds.has(l.id));
    if (newLayer && options) {
      state.updateLayer(newLayer.id, options);
      return this.getState().layers.find(l => l.id === newLayer.id) || newLayer;
    }
    return newLayer!;
  }

  get(id: string): Layer | undefined {
    return this.getState().layers.find(l => l.id === id);
  }

  getByName(name: string): Layer | undefined {
    return this.getState().layers.find(l => l.name === name);
  }

  update(id: string, props: Partial<Omit<Layer, 'id'>>): void {
    this.getState().updateLayer(id, props);
  }

  remove(id: string): void {
    this.getState().deleteLayer(id);
  }

  list(drawingId?: string): Layer[] {
    const state = this.getState();
    const did = drawingId || state.activeDrawingId;
    return state.layers.filter(l => l.drawingId === did);
  }

  setActive(id: string): void {
    this.getState().setActiveLayer(id);
  }

  getActive(): Layer | undefined {
    const state = this.getState();
    return state.layers.find(l => l.id === state.activeLayerId);
  }
}
