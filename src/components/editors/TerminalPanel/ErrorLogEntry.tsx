import { memo } from 'react';
import { AlertCircle, AlertTriangle, Info, Bug } from 'lucide-react';
import type { LogEntry } from '../../../state/slices/logSlice';

interface ErrorLogEntryProps {
  entry: LogEntry;
}

const severityConfig = {
  error: { icon: AlertCircle, color: 'text-red-400', bg: 'bg-red-500/10' },
  warning: { icon: AlertTriangle, color: 'text-orange-400', bg: 'bg-orange-500/10' },
  info: { icon: Info, color: 'text-blue-400', bg: '' },
  debug: { icon: Bug, color: 'text-gray-500', bg: '' },
} as const;

function formatTime(timestamp: number): string {
  const d = new Date(timestamp);
  return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}:${d.getSeconds().toString().padStart(2, '0')}`;
}

export const ErrorLogEntry = memo(function ErrorLogEntry({ entry }: ErrorLogEntryProps) {
  const config = severityConfig[entry.severity];
  const Icon = config.icon;

  return (
    <div className={`flex items-start gap-2 px-3 py-1 text-xs font-mono border-b border-cad-border/30 hover:bg-cad-hover/50 ${config.bg}`}>
      <span className="text-cad-text-dim shrink-0">{formatTime(entry.timestamp)}</span>
      <Icon size={12} className={`${config.color} shrink-0 mt-0.5`} />
      {entry.source && (
        <span className={`${config.color} shrink-0 font-semibold`}>[{entry.source}]</span>
      )}
      <span className="text-cad-text break-all">{entry.message}</span>
    </div>
  );
});
