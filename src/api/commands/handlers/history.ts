/**
 * History Command Handlers
 *
 * Undo/redo operations: undo, redo, getState.
 */

import type { CommandDefinition, CommandResponse } from '../types';

export const historyCommands: CommandDefinition[] = [
  // Undo
  {
    command: 'history',
    action: 'undo',
    description: 'Undo the last action',
    modifiesState: true,
    params: [],
    handler: (_, context): CommandResponse => {
      const result = context.getState().undo();

      if (result) {
        context.events.emit('undo', {});
      }

      return {
        success: result,
        error: result ? undefined : 'Nothing to undo',
        data: { undone: result },
      };
    },
  },

  // Redo
  {
    command: 'history',
    action: 'redo',
    description: 'Redo the last undone action',
    modifiesState: true,
    params: [],
    handler: (_, context): CommandResponse => {
      const result = context.getState().redo();

      if (result) {
        context.events.emit('redo', {});
      }

      return {
        success: result,
        error: result ? undefined : 'Nothing to redo',
        data: { redone: result },
      };
    },
  },

  // Get history state
  {
    command: 'history',
    action: 'getState',
    description: 'Get current history state',
    modifiesState: false,
    params: [],
    handler: (_, context): CommandResponse => {
      const state = context.getState();

      return {
        success: true,
        data: {
          canUndo: state.canUndo(),
          canRedo: state.canRedo(),
          historyIndex: state.historyIndex,
          historySize: state.historyStack.length,
        },
      };
    },
  },
];
