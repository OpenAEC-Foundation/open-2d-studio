/**
 * Registry Service — Fetch extension catalog from GitHub
 */

import { fetch as tauriFetch } from '@tauri-apps/plugin-http';
import type { ExtensionCatalog } from './types';
import { useAppStore } from '../state/appStore';

const CATALOG_URL =
  'https://raw.githubusercontent.com/OpenAEC-Foundation/Open-2D-Studio-Extensions/main/catalog.json';

const CACHE_DURATION_MS = 30 * 60 * 1000; // 30 minutes

export async function fetchCatalog(forceRefresh = false): Promise<ExtensionCatalog | null> {
  const store = useAppStore.getState();

  if (
    !forceRefresh &&
    store.catalogLastFetched &&
    Date.now() - store.catalogLastFetched < CACHE_DURATION_MS &&
    store.catalogEntries.length > 0
  ) {
    return {
      version: 1,
      lastUpdated: new Date(store.catalogLastFetched).toISOString(),
      extensions: store.catalogEntries,
    };
  }

  store.setCatalogLoading(true);

  try {
    const response = await tauriFetch(CATALOG_URL);
    if (!response.ok) {
      throw new Error(`Failed to fetch catalog: ${response.status} ${response.statusText}`);
    }

    const catalog: ExtensionCatalog = await response.json();

    if (!catalog.extensions || !Array.isArray(catalog.extensions)) {
      throw new Error('Invalid catalog format');
    }

    store.setCatalog(catalog.extensions, Date.now());
    return catalog;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[Extensions] Failed to fetch catalog:', message);
    store.setCatalogError(message);
    return null;
  }
}
