/**
 * Event Bus - Pub/sub system for all CAD state changes
 */

import type { AppState } from '../state/appStore';

export type CadEventType =
  // Entity
  | 'entity:added'
  | 'entity:modified'
  | 'entity:removed'
  // Selection
  | 'selection:changed'
  | 'selection:cleared'
  // Layer
  | 'layer:added'
  | 'layer:removed'
  | 'layer:changed'
  | 'layer:activeChanged'
  // Viewport
  | 'viewport:changed'
  // Command
  | 'command:started'
  | 'command:completed'
  | 'command:cancelled'
  // Transaction
  | 'transaction:started'
  | 'transaction:committed'
  | 'transaction:rolledBack'
  // History
  | 'undo'
  | 'redo'
  // Document
  | 'document:saved'
  | 'document:loaded'
  | 'document:newProject'
  // Drawing
  | 'drawing:created'
  | 'drawing:removed'
  | 'drawing:switched'
  // Sheet
  | 'sheet:created'
  | 'sheet:removed'
  | 'sheet:switched'
  // Mode
  | 'mode:changed'
  // Tool
  | 'tool:changed';

type Listener = (data: any) => void;

export class CadEventBus {
  private listeners = new Map<string, Set<Listener>>();

  on(event: CadEventType, listener: Listener): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(listener);
    return () => this.off(event, listener);
  }

  off(event: CadEventType, listener: Listener): void {
    this.listeners.get(event)?.delete(listener);
  }

  once(event: CadEventType, listener: Listener): () => void {
    const wrapper = (data: any) => {
      this.off(event, wrapper);
      listener(data);
    };
    return this.on(event, wrapper);
  }

  emit(event: CadEventType, data?: any): void {
    this.listeners.get(event)?.forEach(fn => {
      try { fn(data); } catch (e) { console.error(`[CadEventBus] Error in ${event} listener:`, e); }
    });
  }
}

/**
 * Bridge Zustand store changes to the event bus.
 * Uses vanilla subscribe (no selector middleware) and diffs state manually.
 */
export function bridgeStoreToEvents(
  store: { subscribe: (listener: (state: AppState, prevState: AppState) => void) => () => void; getState: () => AppState },
  bus: CadEventBus
): () => void {
  const unsub = store.subscribe((state, prevState) => {
    // Shapes diff
    if (state.shapes !== prevState.shapes) {
      const prevMap = new Map(prevState.shapes.map(s => [s.id, s]));
      const currMap = new Map(state.shapes.map(s => [s.id, s]));
      for (const [id, shape] of currMap) {
        if (!prevMap.has(id)) bus.emit('entity:added', { entity: shape });
        else if (prevMap.get(id) !== shape) bus.emit('entity:modified', { entity: shape });
      }
      for (const [id, shape] of prevMap) {
        if (!currMap.has(id)) bus.emit('entity:removed', { entity: shape });
      }
    }

    // Selection
    if (state.selectedShapeIds !== prevState.selectedShapeIds) {
      if (state.selectedShapeIds.length === 0) bus.emit('selection:cleared', {});
      bus.emit('selection:changed', { ids: state.selectedShapeIds });
    }

    // Active tool
    if (state.activeTool !== prevState.activeTool) {
      bus.emit('tool:changed', { tool: state.activeTool });
    }

    // Viewport
    if (state.viewport !== prevState.viewport) {
      bus.emit('viewport:changed', state.viewport);
    }

    // Active drawing
    if (state.activeDrawingId !== prevState.activeDrawingId) {
      bus.emit('drawing:switched', { id: state.activeDrawingId });
    }

    // Editor mode
    if (state.editorMode !== prevState.editorMode) {
      bus.emit('mode:changed', { mode: state.editorMode });
    }

    // Active layer
    if (state.activeLayerId !== prevState.activeLayerId) {
      bus.emit('layer:activeChanged', { id: state.activeLayerId });
    }

    // Layers diff
    if (state.layers !== prevState.layers) {
      const prevMap = new Map(prevState.layers.map(l => [l.id, l]));
      const currMap = new Map(state.layers.map(l => [l.id, l]));
      for (const [id, layer] of currMap) {
        if (!prevMap.has(id)) bus.emit('layer:added', { layer });
        else if (prevMap.get(id) !== layer) bus.emit('layer:changed', { layer });
      }
      for (const [id, layer] of prevMap) {
        if (!currMap.has(id)) bus.emit('layer:removed', { layer });
      }
    }

    // Drawings diff
    if (state.drawings !== prevState.drawings) {
      const prevIds = new Set(prevState.drawings.map(d => d.id));
      const currIds = new Set(state.drawings.map(d => d.id));
      for (const d of state.drawings) {
        if (!prevIds.has(d.id)) bus.emit('drawing:created', { drawing: d });
      }
      for (const d of prevState.drawings) {
        if (!currIds.has(d.id)) bus.emit('drawing:removed', { drawing: d });
      }
    }

    // Sheets diff
    if (state.sheets !== prevState.sheets) {
      const prevIds = new Set(prevState.sheets.map(s => s.id));
      const currIds = new Set(state.sheets.map(s => s.id));
      for (const s of state.sheets) {
        if (!prevIds.has(s.id)) bus.emit('sheet:created', { sheet: s });
      }
      for (const s of prevState.sheets) {
        if (!currIds.has(s.id)) bus.emit('sheet:removed', { sheet: s });
      }
    }

    // Active sheet
    if (state.activeSheetId !== prevState.activeSheetId && state.activeSheetId) {
      bus.emit('sheet:switched', { id: state.activeSheetId });
    }
  });

  return unsub;
}
