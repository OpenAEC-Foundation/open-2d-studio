/**
 * Command System Types
 *
 * Defines interfaces for the command-based API system.
 */

import type { AppState } from '../../state/appStore';
import type { CadEventBus } from '../events';
import type { TransactionManager } from '../transactions';

/**
 * Command input format - JSON-based command structure
 */
export interface Command {
  /** Command category: draw, modify, query, layer, viewport, etc. */
  command: string;
  /** Action to perform: create, delete, move, list, etc. */
  action: string;
  /** Entity type for draw commands: line, rectangle, hatch, etc. */
  entity?: string;
  /** Command parameters */
  params: Record<string, unknown>;
  /** Optional transaction name for undo grouping */
  transaction?: string;
}

/**
 * Response from command execution
 */
export interface CommandResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  warnings?: string[];
  executionTime?: number;
}

/**
 * Parameter schema for validation
 */
export interface ParamSchema {
  /** Parameter name */
  name: string;
  /** Parameter type */
  type: 'string' | 'number' | 'boolean' | 'point' | 'points' | 'object' | 'array' | 'any';
  /** Whether parameter is required */
  required?: boolean;
  /** Default value if not provided */
  default?: unknown;
  /** Description for documentation */
  description?: string;
  /** Enum values for validation */
  enum?: unknown[];
  /** Minimum value (for numbers) */
  min?: number;
  /** Maximum value (for numbers) */
  max?: number;
  /** Nested schema (for objects) */
  properties?: ParamSchema[];
  /** Item schema (for arrays) */
  items?: ParamSchema;
}

/**
 * Command definition - describes a single command
 */
export interface CommandDefinition {
  /** Command category */
  command: string;
  /** Action name */
  action: string;
  /** Entity type (optional, for draw commands) */
  entity?: string;
  /** Human-readable description */
  description: string;
  /** Parameter schemas for validation */
  params: ParamSchema[];
  /** The handler function */
  handler: CommandHandler;
  /** Whether this command modifies state (affects undo) */
  modifiesState?: boolean;
  /** MCP tool name override (defaults to cad_{command}_{action}[_{entity}]) */
  mcpToolName?: string;
}

/**
 * Context passed to command handlers
 */
export interface CommandContext {
  getState: () => AppState;
  events: CadEventBus;
  transactions: TransactionManager;
}

/**
 * Command handler function signature
 */
export type CommandHandler = (
  params: Record<string, unknown>,
  context: CommandContext
) => Promise<CommandResponse> | CommandResponse;

/**
 * Point input type (flexible)
 */
export type PointInput = { x: number; y: number } | [number, number];

/**
 * Command categories
 */
export type CommandCategory =
  | 'draw'
  | 'modify'
  | 'query'
  | 'selection'
  | 'layer'
  | 'viewport'
  | 'document'
  | 'style'
  | 'snap'
  | 'history';

/**
 * Draw actions
 */
export type DrawAction = 'create' | 'createBulk';

/**
 * Modify actions
 */
export type ModifyAction = 'move' | 'copy' | 'rotate' | 'scale' | 'mirror' | 'delete' | 'update' | 'setStyle' | 'setLayer';

/**
 * Query actions
 */
export type QueryAction = 'get' | 'list' | 'find' | 'count' | 'bounds' | 'selected';

/**
 * Selection actions
 */
export type SelectionAction = 'set' | 'add' | 'remove' | 'clear' | 'all';

/**
 * Layer actions
 */
export type LayerAction = 'create' | 'delete' | 'update' | 'setActive' | 'list' | 'get';

/**
 * Viewport actions
 */
export type ViewportAction = 'pan' | 'zoom' | 'fit' | 'reset' | 'setZoom' | 'get';

/**
 * Document actions
 */
export type DocumentAction = 'newDrawing' | 'newSheet' | 'save' | 'load' | 'switchMode' | 'listDrawings' | 'listSheets';

/**
 * Style actions
 */
export type StyleAction = 'get' | 'set' | 'getDefaults';

/**
 * Snap actions
 */
export type SnapAction = 'enable' | 'disable' | 'setTypes' | 'getSettings';

/**
 * History actions
 */
export type HistoryAction = 'undo' | 'redo' | 'clear';

/**
 * Entity types for draw commands
 */
export type DrawEntityType =
  | 'line'
  | 'rectangle'
  | 'circle'
  | 'arc'
  | 'ellipse'
  | 'polyline'
  | 'spline'
  | 'text'
  | 'point'
  | 'dimension'
  | 'hatch';
