/**
 * ExtensionCard — Displays a single extension in the Extension Manager
 */

import { useState } from 'react';
import type { CatalogEntry, InstalledExtension, ExtensionCategory } from '../../../extensions/types';

const CATEGORY_COLORS: Record<ExtensionCategory, string> = {
  'GIS': 'bg-emerald-600/20 text-emerald-400 border-emerald-600/30',
  'Structure': 'bg-blue-600/20 text-blue-400 border-blue-600/30',
  'Architecture': 'bg-purple-600/20 text-purple-400 border-purple-600/30',
  'MEP': 'bg-orange-600/20 text-orange-400 border-orange-600/30',
  'Steel Detailing': 'bg-red-600/20 text-red-400 border-red-600/30',
  'Utility': 'bg-gray-600/20 text-gray-400 border-gray-600/30',
  'Import/Export': 'bg-cyan-600/20 text-cyan-400 border-cyan-600/30',
  'Other': 'bg-gray-600/20 text-gray-400 border-gray-600/30',
};

interface ExtensionCardProps {
  entry: CatalogEntry;
  installed?: InstalledExtension;
  onInstall?: (entry: CatalogEntry) => Promise<void>;
  onUpdate?: (entry: CatalogEntry) => Promise<void>;
  onRemove?: (id: string) => Promise<void>;
  onToggleEnable?: (id: string, enabled: boolean) => Promise<void>;
  hasUpdate?: boolean;
}

export function ExtensionCard({
  entry,
  installed,
  onInstall,
  onUpdate,
  onRemove,
  onToggleEnable,
  hasUpdate,
}: ExtensionCardProps) {
  const [loading, setLoading] = useState(false);

  const handleAction = async (action: () => Promise<void>) => {
    setLoading(true);
    try {
      await action();
    } finally {
      setLoading(false);
    }
  };

  const isInstalled = !!installed;
  const isEnabled = installed?.status === 'enabled';
  const hasError = installed?.status === 'error';
  const categoryClass = CATEGORY_COLORS[entry.category] || CATEGORY_COLORS['Other'];

  return (
    <div className="flex gap-4 p-4 rounded-lg bg-cad-surface border border-cad-border hover:border-cad-border-light transition-colors">
      {/* Icon */}
      <div className="w-10 h-10 flex-shrink-0 flex items-center justify-center rounded bg-cad-bg border border-cad-border">
        {entry.icon ? (
          <span dangerouslySetInnerHTML={{ __html: entry.icon }} />
        ) : (
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-cad-text-dim">
            <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
          </svg>
        )}
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-sm font-medium text-cad-text truncate">{entry.name}</span>
          <span className="text-[10px] text-cad-text-muted font-mono">v{installed?.manifest.version ?? entry.version}</span>
          <span className={`text-[9px] px-1.5 py-0.5 rounded border ${categoryClass}`}>
            {entry.category}
          </span>
        </div>

        <p className="text-xs text-cad-text-dim mb-1.5 line-clamp-2">{entry.description}</p>

        <div className="flex items-center gap-2 text-[10px] text-cad-text-muted">
          <span>by {entry.author}</span>
          {entry.tags && entry.tags.length > 0 && (
            <>
              <span className="opacity-30">|</span>
              <span className="truncate">{entry.tags.slice(0, 3).join(', ')}</span>
            </>
          )}
        </div>

        {hasError && installed?.error && (
          <p className="text-[10px] text-red-400 mt-1">{installed.error}</p>
        )}
      </div>

      {/* Actions */}
      <div className="flex flex-col gap-1.5 items-end justify-center flex-shrink-0">
        {!isInstalled && onInstall && (
          <button
            className="px-3 py-1 text-xs font-medium rounded bg-cad-accent text-white hover:bg-cad-accent/80 transition-colors cursor-default disabled:opacity-50"
            onClick={() => handleAction(() => onInstall(entry))}
            disabled={loading}
          >
            {loading ? 'Installing...' : 'Install'}
          </button>
        )}

        {isInstalled && hasUpdate && onUpdate && (
          <button
            className="px-3 py-1 text-xs font-medium rounded bg-cad-accent text-white hover:bg-cad-accent/80 transition-colors cursor-default disabled:opacity-50"
            onClick={() => handleAction(() => onUpdate(entry))}
            disabled={loading}
          >
            {loading ? 'Updating...' : 'Update'}
          </button>
        )}

        {isInstalled && onToggleEnable && (
          <button
            className={`px-3 py-1 text-xs font-medium rounded border transition-colors cursor-default disabled:opacity-50 ${
              isEnabled
                ? 'border-cad-border text-cad-text-dim hover:bg-cad-hover'
                : 'border-green-600/30 text-green-400 hover:bg-green-600/10'
            }`}
            onClick={() => handleAction(() => onToggleEnable(entry.id, !isEnabled))}
            disabled={loading}
          >
            {isEnabled ? 'Disable' : 'Enable'}
          </button>
        )}

        {isInstalled && onRemove && (
          <button
            className="px-3 py-1 text-xs font-medium rounded border border-red-600/30 text-red-400 hover:bg-red-600/10 transition-colors cursor-default disabled:opacity-50"
            onClick={() => handleAction(() => onRemove(entry.id))}
            disabled={loading}
          >
            {loading ? 'Removing...' : 'Remove'}
          </button>
        )}
      </div>
    </div>
  );
}
