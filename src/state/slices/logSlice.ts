/**
 * Log Slice - Manages global error/info log entries
 */

// ============================================================================
// Types
// ============================================================================

export type LogSeverity = 'info' | 'warning' | 'error' | 'debug';

export interface LogEntry {
  id: string;
  timestamp: number;
  severity: LogSeverity;
  message: string;
  source?: string;
}

export interface LogFilter {
  showInfo: boolean;
  showWarning: boolean;
  showError: boolean;
  showDebug: boolean;
  searchText: string;
}

// ============================================================================
// State Interface
// ============================================================================

export interface LogState {
  logEntries: LogEntry[];
  logFilter: LogFilter;
  logAutoScroll: boolean;
}

// ============================================================================
// Actions Interface
// ============================================================================

export interface LogActions {
  addLog: (severity: LogSeverity, message: string, source?: string) => void;
  clearLogs: () => void;
  setLogFilter: (filter: Partial<LogFilter>) => void;
  toggleLogAutoScroll: () => void;
}

// ============================================================================
// Combined Slice Type
// ============================================================================

export type LogSlice = LogState & LogActions;

// ============================================================================
// Constants
// ============================================================================

const MAX_LOG_ENTRIES = 1000;

// ============================================================================
// Initial State
// ============================================================================

export const initialLogState: LogState = {
  logEntries: [],
  logFilter: {
    showInfo: true,
    showWarning: true,
    showError: true,
    showDebug: false,
    searchText: '',
  },
  logAutoScroll: true,
};

// ============================================================================
// Slice Creator
// ============================================================================

export function createLogSlice(
  set: (fn: (state: any) => void) => void,
  _get: () => any
): LogActions {
  return {
    addLog: (severity: LogSeverity, message: string, source?: string) => {
      set((state) => {
        const entry: LogEntry = {
          id: `${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
          timestamp: Date.now(),
          severity,
          message,
          source,
        };
        state.logEntries.push(entry);
        // Prune oldest entries when exceeding limit
        if (state.logEntries.length > MAX_LOG_ENTRIES) {
          state.logEntries.splice(0, state.logEntries.length - MAX_LOG_ENTRIES);
        }
      });
    },

    clearLogs: () => {
      set((state) => {
        state.logEntries = [];
      });
    },

    setLogFilter: (filter: Partial<LogFilter>) => {
      set((state) => {
        Object.assign(state.logFilter, filter);
      });
    },

    toggleLogAutoScroll: () => {
      set((state) => {
        state.logAutoScroll = !state.logAutoScroll;
      });
    },
  };
}
