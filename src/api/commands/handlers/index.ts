/**
 * Command Handlers Index
 *
 * Exports all command handlers for registration.
 */

import type { CommandDefinition } from '../types';

import { drawCommands } from './draw';
import { modifyCommands } from './modify';
import { queryCommands } from './query';
import { selectionCommands } from './selection';
import { layerCommands } from './layer';
import { viewportCommands } from './viewport';
import { documentCommands } from './document';
import { sheetCommands } from './sheet';
import { styleCommands } from './style';
import { snapCommands } from './snap';
import { historyCommands } from './history';

/**
 * All registered command definitions
 */
export const allCommands: CommandDefinition[] = [
  ...drawCommands,
  ...modifyCommands,
  ...queryCommands,
  ...selectionCommands,
  ...layerCommands,
  ...viewportCommands,
  ...documentCommands,
  ...sheetCommands,
  ...styleCommands,
  ...snapCommands,
  ...historyCommands,
];

// Re-export individual command groups
export {
  drawCommands,
  modifyCommands,
  queryCommands,
  selectionCommands,
  layerCommands,
  viewportCommands,
  documentCommands,
  sheetCommands,
  styleCommands,
  snapCommands,
  historyCommands,
};
