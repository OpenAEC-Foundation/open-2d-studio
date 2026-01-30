/**
 * CadApi - Main facade for the programmatic CAD API
 *
 * Exposed as window.cad for scripting and plugin development.
 */

import type { AppState } from '../state/appStore';
import { CadEventBus, bridgeStoreToEvents } from './events';
import { TransactionManager } from './transactions';
import { EntitiesApi } from './entities';
import { LayersApi } from './layers';
import { SelectionApi } from './selection';
import { ViewportApi } from './viewport';
import { DocumentApi } from './document';
import { ApplicationApi } from './application';
import { CommandsApi } from './commands';
import { DimensionsApi } from './dimensions';
import { SnapApi, GridApi } from './snap';
import { StylesApi } from './styles';
import { ToolsApi } from './tools';
import { AnnotationsApi } from './annotations';
import { MacroRecorder } from './macros';

export class CadApi {
  readonly events: CadEventBus;
  readonly transactions: TransactionManager;
  readonly entities: EntitiesApi;
  readonly layers: LayersApi;
  readonly selection: SelectionApi;
  readonly viewport: ViewportApi;
  readonly document: DocumentApi;
  readonly app: ApplicationApi;
  readonly commands: CommandsApi;
  readonly dimensions: DimensionsApi;
  readonly snap: SnapApi;
  readonly grid: GridApi;
  readonly styles: StylesApi;
  readonly tools: ToolsApi;
  readonly annotations: AnnotationsApi;

  private macro: MacroRecorder;
  private cleanupBridge: (() => void) | null = null;

  constructor(
    private store: {
      getState: () => AppState;
      subscribe: (listener: (state: AppState, prevState: AppState) => void) => () => void;
    }
  ) {
    const getState = () => store.getState();

    this.events = new CadEventBus();
    this.transactions = new TransactionManager(getState, this.events);
    this.entities = new EntitiesApi(getState, this.events, this.transactions);
    this.layers = new LayersApi(getState, this.transactions);
    this.selection = new SelectionApi(getState);
    this.viewport = new ViewportApi(getState);
    this.document = new DocumentApi(getState, this.transactions, this.events);
    this.app = new ApplicationApi(getState, this.events);
    this.commands = new CommandsApi(getState, this.events, this.transactions);
    this.dimensions = new DimensionsApi(getState, this.transactions, this.entities);
    this.snap = new SnapApi(getState);
    this.grid = new GridApi(getState);
    this.styles = new StylesApi(getState);
    this.tools = new ToolsApi(getState);
    this.annotations = new AnnotationsApi(getState, this.transactions);
    this.macro = new MacroRecorder(this.events);

    // Bridge store changes to event bus
    this.cleanupBridge = bridgeStoreToEvents(store, this.events);
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
