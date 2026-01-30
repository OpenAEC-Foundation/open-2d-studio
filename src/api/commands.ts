/**
 * Commands API - Programmatic command execution
 */

import type { AppState } from '../state/appStore';
import type { CadEventBus } from './events';
import type { TransactionManager } from './transactions';
import { toPoint, type CommandResult } from './types';
import {
  translateShape, rotateShape, scaleShape, mirrorShape, cloneShape,
} from '../services/shapeService';

type CommandHandler = (state: AppState, params: Record<string, any>) => void;

const COMMANDS: Record<string, CommandHandler> = {
  MOVE: (state, params) => {
    const { ids, from, to } = params;
    const fromPt = toPoint(from);
    const toPt = toPoint(to);
    const dx = toPt.x - fromPt.x;
    const dy = toPt.y - fromPt.y;
    for (const id of ids) {
      const shape = state.shapes.find(s => s.id === id);
      if (!shape) continue;
      const cloned = JSON.parse(JSON.stringify(shape));
      translateShape(cloned, { x: dx, y: dy });
      state.updateShape(id, cloned);
    }
  },

  COPY: (state, params) => {
    const { ids, from, to } = params;
    const fromPt = toPoint(from);
    const toPt = toPoint(to);
    const offset = { x: toPt.x - fromPt.x, y: toPt.y - fromPt.y };
    for (const id of ids) {
      const shape = state.shapes.find(s => s.id === id);
      if (!shape) continue;
      const copy = cloneShape(shape, offset);
      state.addShape(copy);
    }
  },

  ROTATE: (state, params) => {
    const { ids, center, angle } = params;
    const centerPt = toPoint(center);
    const rad = (angle * Math.PI) / 180;
    for (const id of ids) {
      const shape = state.shapes.find(s => s.id === id);
      if (!shape) continue;
      const cloned = JSON.parse(JSON.stringify(shape));
      rotateShape(cloned, centerPt, rad);
      state.updateShape(id, cloned);
    }
  },

  SCALE: (state, params) => {
    const { ids, base, factor } = params;
    const basePt = toPoint(base);
    for (const id of ids) {
      const shape = state.shapes.find(s => s.id === id);
      if (!shape) continue;
      const cloned = JSON.parse(JSON.stringify(shape));
      scaleShape(cloned, basePt, factor, factor);
      state.updateShape(id, cloned);
    }
  },

  MIRROR: (state, params) => {
    const { ids, p1, p2 } = params;
    const pt1 = toPoint(p1);
    const pt2 = toPoint(p2);
    for (const id of ids) {
      const shape = state.shapes.find(s => s.id === id);
      if (!shape) continue;
      const cloned = JSON.parse(JSON.stringify(shape));
      mirrorShape(cloned, pt1, pt2);
      state.updateShape(id, cloned);
    }
  },

  ERASE: (state, params) => {
    const { ids } = params;
    for (const id of ids) {
      state.deleteShape(id);
    }
  },

  OFFSET: (state, params) => {
    const { ids, distance } = params;
    for (const id of ids) {
      const shape = state.shapes.find(s => s.id === id);
      if (!shape) continue;
      // Simple offset: clone and scale from center
      const copy = cloneShape(shape, { x: 0, y: 0 });
      if (copy.type === 'circle') {
        (copy as any).radius += distance;
      }
      state.addShape(copy);
    }
  },

  FILLET: (_state, _params) => {
    // Fillet requires complex geometry computation, placeholder
    console.warn('FILLET command via API is not yet fully implemented');
  },

  CHAMFER: (_state, _params) => {
    // Chamfer requires complex geometry computation, placeholder
    console.warn('CHAMFER command via API is not yet fully implemented');
  },
};

export class CommandsApi {
  constructor(
    private getState: () => AppState,
    private bus: CadEventBus,
    private transactions: TransactionManager
  ) {}

  execute(name: string, params: Record<string, any> = {}): CommandResult {
    const handler = COMMANDS[name.toUpperCase()];
    if (!handler) {
      return { success: false, error: `Unknown command: ${name}` };
    }

    this.bus.emit('command:started', { name, params });

    try {
      this.transactions.run(name, () => {
        handler(this.getState(), params);
      });
      this.bus.emit('command:completed', { name, params });
      return { success: true };
    } catch (e: any) {
      this.bus.emit('command:cancelled', { name, error: e.message });
      return { success: false, error: e.message };
    }
  }

  list(): string[] {
    return Object.keys(COMMANDS);
  }

  isActive(): boolean {
    return this.getState().hasActiveModifyCommand;
  }

  cancel(): void {
    this.getState().requestCommandCancel();
  }
}
