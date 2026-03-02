/**
 * ExtensionManagerPanel — Main UI for browsing, installing, and managing extensions
 */

import { useState, useEffect, useCallback } from 'react';
import { useAppStore } from '../../../state/appStore';
import { fetchCatalog } from '../../../extensions/registryService';
import {
  installExtension,
  updateExtension,
  removeExtension,
  checkForUpdates,
} from '../../../extensions/extensionService';
import { enableExtension, disableExtension } from '../../../extensions/extensionLoader';
import { setSetting } from '../../../utils/settings';
import type { CatalogEntry, ExtensionCategory } from '../../../extensions/types';
import { ExtensionCard } from './ExtensionCard';

type ManagerTab = 'browse' | 'installed' | 'updates';

const CATEGORIES: Array<{ label: string; value: ExtensionCategory | 'all' }> = [
  { label: 'All', value: 'all' },
  { label: 'GIS', value: 'GIS' },
  { label: 'Structure', value: 'Structure' },
  { label: 'Architecture', value: 'Architecture' },
  { label: 'MEP', value: 'MEP' },
  { label: 'Steel Detailing', value: 'Steel Detailing' },
  { label: 'Utility', value: 'Utility' },
  { label: 'Import/Export', value: 'Import/Export' },
];

export function ExtensionManagerPanel() {
  const [activeTab, setActiveTab] = useState<ManagerTab>('browse');
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<ExtensionCategory | 'all'>('all');

  const {
    installedExtensions,
    catalogEntries,
    catalogLoading,
    catalogError,
  } = useAppStore();

  useEffect(() => {
    fetchCatalog();
  }, []);

  const handleInstall = useCallback(async (entry: CatalogEntry) => {
    await installExtension(entry);
  }, []);

  const handleUpdate = useCallback(async (entry: CatalogEntry) => {
    await updateExtension(entry.id, entry);
  }, []);

  const handleRemove = useCallback(async (id: string) => {
    await removeExtension(id);
  }, []);

  const handleToggleEnable = useCallback(async (id: string, enabled: boolean) => {
    if (enabled) {
      await setSetting(`ext:${id}:enabled`, true);
      await enableExtension(id);
    } else {
      await setSetting(`ext:${id}:enabled`, false);
      await disableExtension(id);
    }
  }, []);

  const updatesAvailable = checkForUpdates(installedExtensions, catalogEntries);
  const updateIds = new Set(updatesAvailable.map((u) => u.id));

  const filterEntries = (entries: CatalogEntry[]) => {
    let filtered = entries;

    if (search.trim()) {
      const q = search.toLowerCase();
      filtered = filtered.filter(
        (e) =>
          e.name.toLowerCase().includes(q) ||
          e.description.toLowerCase().includes(q) ||
          e.author.toLowerCase().includes(q) ||
          e.tags?.some((t) => t.toLowerCase().includes(q))
      );
    }

    if (categoryFilter !== 'all') {
      filtered = filtered.filter((e) => e.category === categoryFilter);
    }

    return filtered;
  };

  const installedList = Object.values(installedExtensions);
  const installedAsEntries: CatalogEntry[] = installedList.map((inst) => ({
    id: inst.manifest.id,
    name: inst.manifest.name,
    version: inst.manifest.version,
    author: inst.manifest.author,
    description: inst.manifest.description,
    category: inst.manifest.category,
    tags: inst.manifest.tags || [],
    minAppVersion: inst.manifest.minAppVersion,
    repository: inst.manifest.repository || '',
    downloadUrl: '',
    icon: inst.manifest.icon,
  }));

  const tabs: { id: ManagerTab; label: string; count?: number }[] = [
    { id: 'browse', label: 'Browse' },
    { id: 'installed', label: 'Installed', count: installedList.length },
    { id: 'updates', label: 'Updates', count: updatesAvailable.length },
  ];

  return (
    <div className="p-8 flex flex-col h-full overflow-hidden">
      <h2 className="text-lg font-semibold text-cad-text mb-4">Extension Manager</h2>

      {/* Tabs */}
      <div className="flex gap-1 mb-4">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            className={`px-4 py-1.5 text-xs font-medium rounded transition-colors cursor-default ${
              activeTab === tab.id
                ? 'bg-cad-accent text-white'
                : 'bg-cad-surface border border-cad-border text-cad-text-dim hover:bg-cad-hover'
            }`}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
            {tab.count !== undefined && tab.count > 0 && (
              <span className="ml-1.5 px-1 py-0.5 text-[9px] rounded-full bg-white/10">
                {tab.count}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Search + Category Filter */}
      <div className="flex gap-3 mb-4 items-center">
        <input
          type="text"
          className="flex-1 max-w-xs bg-cad-bg border border-cad-border text-cad-text text-xs rounded px-3 py-1.5 focus:outline-none focus:border-cad-border-light"
          placeholder="Search extensions..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <div className="flex gap-1 flex-wrap">
          {CATEGORIES.map((cat) => (
            <button
              key={cat.value}
              className={`px-2 py-1 text-[10px] rounded transition-colors cursor-default ${
                categoryFilter === cat.value
                  ? 'bg-cad-accent/30 text-cad-accent border border-cad-accent/50'
                  : 'bg-cad-surface border border-cad-border text-cad-text-muted hover:bg-cad-hover'
              }`}
              onClick={() => setCategoryFilter(cat.value)}
            >
              {cat.label}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {/* Browse Tab */}
        {activeTab === 'browse' && (
          <div className="flex flex-col gap-2">
            {catalogLoading && (
              <p className="text-xs text-cad-text-muted py-8 text-center">Loading catalog...</p>
            )}
            {catalogError && (
              <div className="p-4 rounded bg-red-900/10 border border-red-600/30">
                <p className="text-xs text-red-400 mb-2">Failed to load extension catalog</p>
                <p className="text-[10px] text-red-400/70">{catalogError}</p>
                <button
                  className="mt-2 px-3 py-1 text-[10px] rounded border border-cad-border text-cad-text-dim hover:bg-cad-hover cursor-default"
                  onClick={() => fetchCatalog(true)}
                >
                  Retry
                </button>
              </div>
            )}
            {!catalogLoading && !catalogError && catalogEntries.length === 0 && (
              <p className="text-xs text-cad-text-muted py-8 text-center">
                No extensions available yet. Check back later.
              </p>
            )}
            {filterEntries(catalogEntries).map((entry) => (
              <ExtensionCard
                key={entry.id}
                entry={entry}
                installed={installedExtensions[entry.id]}
                onInstall={!installedExtensions[entry.id] ? handleInstall : undefined}
                onUpdate={updateIds.has(entry.id) ? handleUpdate : undefined}
                onRemove={installedExtensions[entry.id] ? handleRemove : undefined}
                onToggleEnable={installedExtensions[entry.id] ? handleToggleEnable : undefined}
                hasUpdate={updateIds.has(entry.id)}
              />
            ))}
          </div>
        )}

        {/* Installed Tab */}
        {activeTab === 'installed' && (
          <div className="flex flex-col gap-2">
            {installedList.length === 0 && (
              <p className="text-xs text-cad-text-muted py-8 text-center">
                No extensions installed. Browse the catalog to find extensions.
              </p>
            )}
            {filterEntries(installedAsEntries).map((entry) => (
              <ExtensionCard
                key={entry.id}
                entry={entry}
                installed={installedExtensions[entry.id]}
                onRemove={handleRemove}
                onToggleEnable={handleToggleEnable}
                hasUpdate={updateIds.has(entry.id)}
                onUpdate={updateIds.has(entry.id) ? handleUpdate : undefined}
              />
            ))}
          </div>
        )}

        {/* Updates Tab */}
        {activeTab === 'updates' && (
          <div className="flex flex-col gap-2">
            {updatesAvailable.length === 0 && (
              <p className="text-xs text-cad-text-muted py-8 text-center">
                All extensions are up to date.
              </p>
            )}
            {filterEntries(updatesAvailable).map((entry) => (
              <ExtensionCard
                key={entry.id}
                entry={entry}
                installed={installedExtensions[entry.id]}
                onUpdate={handleUpdate}
                hasUpdate={true}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
