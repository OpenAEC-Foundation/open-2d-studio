/**
 * Transaction Manager - Group multiple mutations into single undo steps
 * and suppress rendering until commit.
 *
 * Since addShape/updateShape/deleteShape each push their own history,
 * a transaction records the history index at start and on commit,
 * collapses all intermediate history entries into one. On rollback,
 * it undoes back to the starting index.
 *
 * Render suppression: While a transaction is active, the rAF render loop
 * checks `renderSuppressed` and skips rendering. On commit, the flag is
 * cleared and one final render happens on the next frame.
 */

import type { AppState } from '../state/appStore';
import type { CadEventBus } from './events';

export class TransactionManager {
  private active: { name: string; startEntryIndex: number } | null = null;
  private _renderSuppressed = false;

  constructor(
    private getState: () => AppState,
    private bus: CadEventBus
  ) {}

  get isActive(): boolean {
    return this.active !== null;
  }

  /** True while a transaction is active — rAF loop should skip rendering */
  get renderSuppressed(): boolean {
    return this._renderSuppressed;
  }

  begin(name: string): void {
    if (this.active) {
      throw new Error(`Transaction "${this.active.name}" already active. Nested transactions not supported.`);
    }
    const state = this.getState();
    // Record where new entries will start (one past current index)
    this.active = { name, startEntryIndex: state.historyIndex + 1 };
    this._renderSuppressed = true;
    this.bus.emit('transaction:started', { name });
  }

  commit(): void {
    if (!this.active) {
      throw new Error('No active transaction to commit');
    }
    const name = this.active.name;
    const startEntryIndex = this.active.startEntryIndex;
    this.active = null;
    this._renderSuppressed = false;

    // Collapse all entries created during this transaction into one
    const state = this.getState();
    if (state.historyIndex >= startEntryIndex) {
      state.collapseEntries(startEntryIndex);
    }

    this.bus.emit('transaction:committed', { name });
  }

  rollback(): void {
    if (!this.active) {
      throw new Error('No active transaction to rollback');
    }
    const name = this.active.name;
    const startEntryIndex = this.active.startEntryIndex;
    this.active = null;
    this._renderSuppressed = false;

    // Undo back to before the transaction started
    const state = this.getState();
    while (state.historyIndex >= startEntryIndex) {
      if (!state.undo()) break;
    }

    this.bus.emit('transaction:rolledBack', { name });
  }

  run<T>(name: string, fn: () => T): T {
    this.begin(name);
    try {
      const result = fn();
      this.commit();
      return result;
    } catch (e) {
      this.rollback();
      throw e;
    }
  }
}
