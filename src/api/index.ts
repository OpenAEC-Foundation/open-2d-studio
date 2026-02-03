/**
 * CadApi - Main facade for the programmatic CAD API
 *
 * Exposed as window.cad for scripting and plugin development.
 */

import type { AppState } from '../state/appStore';
import type { ShapeType } from '../types/geometry';
import { CadEventBus, bridgeStoreToEvents } from './events';
import { TransactionManager } from './transactions';
import { EntitiesApi } from './entities';
import { LayersApi } from './layers';
import { SelectionApi } from './selection';
import { ViewportApi } from './viewport';
import { DocumentApi } from './document';
import { ApplicationApi } from './application';
import { DimensionsApi } from './dimensions';
import { SnapApi, GridApi } from './snap';
import { StylesApi } from './styles';
import { ToolsApi } from './tools';
import { AnnotationsApi } from './annotations';
import { MacroRecorder } from './macros';
import {
  commandRegistry,
  allCommands,
  type Command,
  type CommandResponse,
} from './commands';

export class CadApi {
  // Public APIs
  readonly events: CadEventBus;
  readonly transactions: TransactionManager;

  // Internal APIs - used by command handlers, not for external use
  /** @internal */ readonly _entities: EntitiesApi;
  /** @internal */ readonly _layers: LayersApi;
  /** @internal */ readonly _selection: SelectionApi;
  /** @internal */ readonly _viewport: ViewportApi;
  /** @internal */ readonly _document: DocumentApi;
  /** @internal */ readonly _app: ApplicationApi;
  /** @internal */ readonly _dimensions: DimensionsApi;
  /** @internal */ readonly _snap: SnapApi;
  /** @internal */ readonly _grid: GridApi;
  /** @internal */ readonly _styles: StylesApi;
  /** @internal */ readonly _tools: ToolsApi;
  /** @internal */ readonly _annotations: AnnotationsApi;

  private macro: MacroRecorder;
  private cleanupBridge: (() => void) | null = null;
  private commandsInitialized = false;

  constructor(
    private store: {
      getState: () => AppState;
      subscribe: (listener: (state: AppState, prevState: AppState) => void) => () => void;
    }
  ) {
    const getState = () => store.getState();

    this.events = new CadEventBus();
    this.transactions = new TransactionManager(getState, this.events);
    this._entities = new EntitiesApi(getState, this.events, this.transactions);
    this._layers = new LayersApi(getState, this.transactions);
    this._selection = new SelectionApi(getState);
    this._viewport = new ViewportApi(getState);
    this._document = new DocumentApi(getState, this.transactions, this.events);
    this._app = new ApplicationApi(getState, this.events);
    this._dimensions = new DimensionsApi(getState, this.transactions, this._entities);
    this._snap = new SnapApi(getState);
    this._grid = new GridApi(getState);
    this._styles = new StylesApi(getState);
    this._tools = new ToolsApi(getState);
    this._annotations = new AnnotationsApi(getState, this.transactions);
    this.macro = new MacroRecorder(this.events);

    // Bridge store changes to event bus
    this.cleanupBridge = bridgeStoreToEvents(store, this.events);

    // Initialize command registry
    this.initCommands(getState);
  }

  /**
   * Initialize the command registry with all handlers
   */
  private initCommands(getState: () => AppState): void {
    if (this.commandsInitialized) return;

    commandRegistry.init({
      getState,
      events: this.events,
      transactions: this.transactions,
    });

    commandRegistry.registerAll(allCommands);
    this.commandsInitialized = true;
  }

  // Convenience methods

  undo(): boolean {
    const result = this.store.getState().undo();
    if (result) this.events.emit('undo', {});
    return result;
  }

  redo(): boolean {
    const result = this.store.getState().redo();
    if (result) this.events.emit('redo', {});
    return result;
  }

  transaction<T>(name: string, fn: () => T): T {
    return this.transactions.run(name, fn);
  }

  startRecording(): void {
    this.macro.startRecording();
  }

  stopRecording(): string {
    return this.macro.stopRecording();
  }

  runMacro(script: string): void {
    this.macro.runMacro(script);
  }

  // ============================================================================
  // Command-Based API
  // ============================================================================

  /**
   * Execute a command using the JSON-based command system.
   *
   * @example
   * // Draw a rectangle
   * await cad.run({
   *   command: 'draw',
   *   action: 'create',
   *   entity: 'rectangle',
   *   params: { topLeft: {x: 0, y: 0}, width: 100, height: 50 }
   * });
   *
   * // Query shapes
   * await cad.run({ command: 'query', action: 'list', params: { type: 'line' } });
   *
   * // Modify selected shapes
   * await cad.run({ command: 'modify', action: 'move', params: { offset: {x: 10, y: 10} } });
   */
  async run(cmd: Command): Promise<CommandResponse> {
    return commandRegistry.execute(cmd);
  }

  /**
   * Shorthand for drawing shapes.
   *
   * @example
   * await cad.draw('line', { start: {x: 0, y: 0}, end: {x: 100, y: 100} });
   * await cad.draw('rectangle', { topLeft: {x: 0, y: 0}, width: 100, height: 50 });
   * await cad.draw('hatch', { points: [...], patternType: 'diagonal', fillColor: '#ff0000' });
   */
  async draw(entity: ShapeType, params: Record<string, unknown>): Promise<CommandResponse> {
    return this.run({
      command: 'draw',
      action: 'create',
      entity,
      params,
    });
  }

  /**
   * List all available commands with their schemas.
   *
   * @example
   * const commands = cad.listCommands();
   * console.log(commands);
   */
  listCommands(): Array<{
    command: string;
    action: string;
    entity?: string;
    description: string;
    mcpToolName: string;
    params: Array<{
      name: string;
      type: string;
      required?: boolean;
      default?: unknown;
      description?: string;
    }>;
  }> {
    return commandRegistry.getCommandInfo();
  }

  /**
   * Get MCP tool definitions for all commands.
   * Useful for exposing the API as MCP tools.
   */
  getMcpTools(): Array<{
    name: string;
    description: string;
    inputSchema: {
      type: 'object';
      properties: Record<string, unknown>;
      required: string[];
    };
  }> {
    return commandRegistry.getMcpTools();
  }

  /**
   * Cleanup event bridge (call on unmount)
   */
  dispose(): void {
    if (this.cleanupBridge) {
      this.cleanupBridge();
      this.cleanupBridge = null;
    }
  }
}

// Re-export types for consumers
export type { ApiPoint, EntityFilter, CommandResult, EventSubscription, MacroScript } from './types';
export { toPoint } from './types';
export { CadEventBus } from './events';

// Re-export command types
export type { Command, CommandResponse, CommandDefinition, ParamSchema } from './commands';
export { commandRegistry } from './commands';
