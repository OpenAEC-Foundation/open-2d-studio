import { memo, useEffect, useRef, useMemo } from 'react';
import { AlertCircle, AlertTriangle, Info, Bug, Trash2, Search, ArrowDownToLine, Copy } from 'lucide-react';
import { useAppStore } from '../../../state/appStore';
import { ErrorLogEntry } from './ErrorLogEntry';

export const ErrorLogPanel = memo(function ErrorLogPanel() {
  const logEntries = useAppStore(s => s.logEntries);
  const logFilter = useAppStore(s => s.logFilter);
  const logAutoScroll = useAppStore(s => s.logAutoScroll);
  const setLogFilter = useAppStore(s => s.setLogFilter);
  const clearLogs = useAppStore(s => s.clearLogs);
  const toggleLogAutoScroll = useAppStore(s => s.toggleLogAutoScroll);

  const scrollRef = useRef<HTMLDivElement>(null);

  // Count by severity
  const counts = useMemo(() => {
    const c = { error: 0, warning: 0, info: 0, debug: 0 };
    for (const entry of logEntries) {
      c[entry.severity]++;
    }
    return c;
  }, [logEntries]);

  // Filter entries
  const filteredEntries = useMemo(() => {
    const search = logFilter.searchText.toLowerCase();
    return logEntries.filter(entry => {
      if (entry.severity === 'error' && !logFilter.showError) return false;
      if (entry.severity === 'warning' && !logFilter.showWarning) return false;
      if (entry.severity === 'info' && !logFilter.showInfo) return false;
      if (entry.severity === 'debug' && !logFilter.showDebug) return false;
      if (search && !entry.message.toLowerCase().includes(search) &&
          !(entry.source && entry.source.toLowerCase().includes(search))) {
        return false;
      }
      return true;
    });
  }, [logEntries, logFilter]);

  // Auto-scroll to bottom when new entries arrive
  useEffect(() => {
    if (logAutoScroll && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [filteredEntries, logAutoScroll]);

  const handleCopyAll = () => {
    const text = filteredEntries
      .map(e => {
        const time = new Date(e.timestamp).toLocaleTimeString();
        const src = e.source ? ` [${e.source}]` : '';
        return `[${time}] [${e.severity.toUpperCase()}]${src} ${e.message}`;
      })
      .join('\n');
    navigator.clipboard.writeText(text);
  };

  return (
    <div className="flex flex-col h-full bg-[#1e1e1e]">
      {/* Toolbar */}
      <div className="flex items-center gap-1 px-2 py-1 border-b border-cad-border bg-cad-surface/50">
        {/* Severity filter buttons */}
        <button
          onClick={() => setLogFilter({ showError: !logFilter.showError })}
          className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-xs transition-colors ${
            logFilter.showError ? 'bg-red-500/20 text-red-400' : 'text-cad-text-dim hover:text-cad-text'
          }`}
          title="Toggle errors"
        >
          <AlertCircle size={12} />
          <span>{counts.error}</span>
        </button>
        <button
          onClick={() => setLogFilter({ showWarning: !logFilter.showWarning })}
          className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-xs transition-colors ${
            logFilter.showWarning ? 'bg-orange-500/20 text-orange-400' : 'text-cad-text-dim hover:text-cad-text'
          }`}
          title="Toggle warnings"
        >
          <AlertTriangle size={12} />
          <span>{counts.warning}</span>
        </button>
        <button
          onClick={() => setLogFilter({ showInfo: !logFilter.showInfo })}
          className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-xs transition-colors ${
            logFilter.showInfo ? 'bg-blue-500/20 text-blue-400' : 'text-cad-text-dim hover:text-cad-text'
          }`}
          title="Toggle info"
        >
          <Info size={12} />
          <span>{counts.info}</span>
        </button>
        <button
          onClick={() => setLogFilter({ showDebug: !logFilter.showDebug })}
          className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-xs transition-colors ${
            logFilter.showDebug ? 'bg-gray-500/20 text-gray-400' : 'text-cad-text-dim hover:text-cad-text'
          }`}
          title="Toggle debug"
        >
          <Bug size={12} />
          <span>{counts.debug}</span>
        </button>

        {/* Separator */}
        <div className="w-px h-4 bg-cad-border mx-1" />

        {/* Search */}
        <div className="relative flex items-center">
          <Search size={12} className="absolute left-1.5 text-cad-text-dim" />
          <input
            type="text"
            value={logFilter.searchText}
            onChange={(e) => setLogFilter({ searchText: e.target.value })}
            placeholder="Filter..."
            className="bg-cad-bg border border-cad-border text-cad-text text-xs pl-6 pr-2 py-0.5 rounded w-32 outline-none focus:border-cad-accent"
          />
        </div>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Action buttons */}
        <button
          onClick={toggleLogAutoScroll}
          className={`p-1 rounded transition-colors ${
            logAutoScroll ? 'text-cad-accent' : 'text-cad-text-dim hover:text-cad-text'
          }`}
          title={logAutoScroll ? 'Auto-scroll: ON' : 'Auto-scroll: OFF'}
        >
          <ArrowDownToLine size={14} />
        </button>
        <button
          onClick={handleCopyAll}
          className="p-1 rounded text-cad-text-dim hover:text-cad-text transition-colors"
          title="Copy all visible entries"
        >
          <Copy size={14} />
        </button>
        <button
          onClick={clearLogs}
          className="p-1 rounded text-cad-text-dim hover:text-red-400 transition-colors"
          title="Clear all logs"
        >
          <Trash2 size={14} />
        </button>
      </div>

      {/* Log entries list */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto overflow-x-hidden">
        {filteredEntries.length === 0 ? (
          <div className="flex items-center justify-center h-full text-cad-text-dim text-xs">
            {logEntries.length === 0 ? 'No log entries' : 'No matching entries'}
          </div>
        ) : (
          filteredEntries.map(entry => (
            <ErrorLogEntry key={entry.id} entry={entry} />
          ))
        )}
      </div>
    </div>
  );
});
