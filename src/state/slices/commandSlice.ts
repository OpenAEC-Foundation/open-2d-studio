/**
 * Command Slice - Manages command line state and active commands
 */

import type { Point, Shape } from './types';

// ============================================================================
// State Interface
// ============================================================================

export interface CommandState {
  commandHistory: string[];
  currentCommand: string;
  pendingCommand: string | null;  // Command to be executed (set by ToolPalette, consumed by CommandLine)
  pendingCommandPoint: Point | null;  // Point to send to active command (set by Canvas, consumed by CommandLine)
  pendingCommandSelection: string[] | null;  // Shape IDs to add to command selection (set by Canvas, consumed by CommandLine)
  hasActiveModifyCommand: boolean;  // True when a modify command is active and waiting for input
  activeCommandName: string | null;  // Name of the currently active command (e.g., 'FILLET', 'MOVE')
  commandIsSelecting: boolean;  // True when a command is in 'selecting' phase (waiting for object selection)
  commandPreviewShapes: Shape[];  // Preview shapes for active modify commands (move/copy preview)
  pendingCommandCancel: boolean;  // Signal to cancel active command (set by coordinating actions, consumed by CommandLine)
  commandBasePoint: Point | null;  // Base point of active command (for snap tracking)
}

// ============================================================================
// Actions Interface
// ============================================================================

export interface CommandActions {
  executeCommand: (command: string) => void;
  setCurrentCommand: (command: string) => void;
  setPendingCommand: (command: string | null) => void;
  setPendingCommandPoint: (point: Point | null) => void;
  setPendingCommandSelection: (ids: string[] | null) => void;
  setHasActiveModifyCommand: (active: boolean) => void;
  setActiveCommandName: (name: string | null) => void;
  setCommandIsSelecting: (isSelecting: boolean) => void;
  setCommandPreviewShapes: (shapes: Shape[]) => void;
  requestCommandCancel: () => void;  // Request cancellation of active command
  clearCommandCancelRequest: () => void;  // Clear the cancel request (called by CommandLine after processing)
  setCommandBasePoint: (point: Point | null) => void;
}

export type CommandSlice = CommandState & CommandActions;

// ============================================================================
// Initial State
// ============================================================================

export const initialCommandState: CommandState = {
  commandHistory: [],
  currentCommand: '',
  pendingCommand: null,
  pendingCommandPoint: null,
  pendingCommandSelection: null,
  hasActiveModifyCommand: false,
  activeCommandName: null,
  commandIsSelecting: false,
  commandPreviewShapes: [],
  pendingCommandCancel: false,
  commandBasePoint: null,
};

// ============================================================================
// Slice Creator
// ============================================================================

export const createCommandSlice = (
  set: (fn: (state: CommandState) => void) => void,
  _get: () => CommandState
): CommandActions => ({
  executeCommand: (command) =>
    set((state) => {
      state.commandHistory.push(command);
      state.currentCommand = '';
      // TODO: Parse and execute command
    }),

  setCurrentCommand: (command) =>
    set((state) => {
      state.currentCommand = command;
    }),

  setPendingCommand: (command) =>
    set((state) => {
      state.pendingCommand = command;
    }),

  setPendingCommandPoint: (point) =>
    set((state) => {
      state.pendingCommandPoint = point;
    }),

  setPendingCommandSelection: (ids) =>
    set((state) => {
      state.pendingCommandSelection = ids;
    }),

  setHasActiveModifyCommand: (active) =>
    set((state) => {
      state.hasActiveModifyCommand = active;
    }),

  setActiveCommandName: (name) =>
    set((state) => {
      state.activeCommandName = name;
    }),

  setCommandIsSelecting: (isSelecting) =>
    set((state) => {
      state.commandIsSelecting = isSelecting;
    }),

  setCommandPreviewShapes: (previewShapes) =>
    set((state) => {
      state.commandPreviewShapes = previewShapes;
    }),

  requestCommandCancel: () =>
    set((state) => {
      state.pendingCommandCancel = true;
    }),

  clearCommandCancelRequest: () =>
    set((state) => {
      state.pendingCommandCancel = false;
    }),

  setCommandBasePoint: (point) =>
    set((state) => {
      state.commandBasePoint = point;
    }),
});