/**
 * Extension Loader — Load extensions from disk, manage lifecycle
 */

import { readTextFile, readDir, exists } from '@tauri-apps/plugin-fs';
import { appDataDir } from '@tauri-apps/api/path';
import type { ExtensionManifest, ExtensionPlugin } from './types';
import { createExtensionApi } from './extensionApi';
import { useAppStore } from '../state/appStore';
import { getSetting } from '../utils/settings';

const activePlugins = new Map<string, { plugin: ExtensionPlugin; cleanup: () => void }>();

export async function getExtensionsDir(): Promise<string> {
  const appData = await appDataDir();
  const sep = appData.endsWith('/') || appData.endsWith('\\') ? '' : '/';
  return `${appData}${sep}extensions`;
}

export async function loadExtension(
  extPath: string
): Promise<{ manifest: ExtensionManifest; plugin: ExtensionPlugin } | null> {
  try {
    const manifestPath = `${extPath}/manifest.json`;
    const manifestExists = await exists(manifestPath);
    if (!manifestExists) {
      console.warn(`[Extensions] No manifest.json found at ${extPath}`);
      return null;
    }

    const manifestJson = await readTextFile(manifestPath);
    const manifest: ExtensionManifest = JSON.parse(manifestJson);

    if (!manifest.id || !manifest.name || !manifest.version || !manifest.main) {
      console.warn(`[Extensions] Invalid manifest in ${extPath}`);
      return null;
    }

    const mainPath = `${extPath}/${manifest.main}`;
    const mainExists = await exists(mainPath);
    if (!mainExists) {
      console.warn(`[Extensions] main file not found: ${mainPath}`);
      return null;
    }

    const mainCode = await readTextFile(mainPath);

    const moduleExports: Record<string, unknown> = {};
    const moduleObj = { exports: moduleExports };
    const extensionRequire = (moduleName: string) => {
      switch (moduleName) {
        case 'open-2d-studio': return (window as any).__open2dStudioSdk;
        case 'react': return (window as any).__open2dStudioReact;
        case 'react/jsx-runtime': return (window as any).__open2dStudioReactJsxRuntime;
        case 'lucide-react': return (window as any).__open2dStudioLucideReact;
        default: throw new Error(`[Extensions] Unknown module: '${moduleName}'`);
      }
    };
    const factory = new Function('module', 'exports', 'require', mainCode);
    factory(moduleObj, moduleExports, extensionRequire);

    const plugin = moduleObj.exports as unknown as ExtensionPlugin;
    if (typeof plugin.onLoad !== 'function') {
      console.warn(`[Extensions] ${manifest.id} does not export onLoad()`);
      return null;
    }

    return { manifest, plugin };
  } catch (err) {
    console.error(`[Extensions] Failed to load extension from ${extPath}:`, err);
    return null;
  }
}

export async function getExtensionEnabled(id: string): Promise<boolean> {
  return getSetting(`ext:${id}:enabled`, true);
}

export async function enableExtension(id: string): Promise<void> {
  const store = useAppStore.getState();
  const installed = store.installedExtensions[id];
  if (!installed) return;

  if (activePlugins.has(id)) return;

  try {
    store.setExtensionStatus(id, 'loading');

    const result = await loadExtension(installed.path);
    if (!result) {
      store.setExtensionStatus(id, 'error', 'Failed to load extension files');
      return;
    }

    const api = createExtensionApi(id, result.manifest.permissions, installed.path);

    await result.plugin.onLoad(api);

    activePlugins.set(id, { plugin: result.plugin, cleanup: api._cleanup });
    store.setExtensionStatus(id, 'enabled');
  } catch (err) {
    console.error(`[Extensions] Failed to enable ${id}:`, err);
    store.setExtensionStatus(id, 'error', err instanceof Error ? err.message : String(err));
  }
}

export async function disableExtension(id: string): Promise<void> {
  const store = useAppStore.getState();
  const active = activePlugins.get(id);
  if (!active) {
    store.setExtensionStatus(id, 'disabled');
    return;
  }

  try {
    if (active.plugin.onUnload) {
      await active.plugin.onUnload();
    }
  } catch (err) {
    console.error(`[Extensions] Error during onUnload for ${id}:`, err);
  }

  try {
    active.cleanup();
  } catch (err) {
    console.error(`[Extensions] Error during cleanup for ${id}:`, err);
  }

  activePlugins.delete(id);
  store.setExtensionStatus(id, 'disabled');
}

export async function loadAllExtensions(): Promise<void> {
  try {
    const extensionsDir = await getExtensionsDir();
    const dirExists = await exists(extensionsDir);
    if (!dirExists) return;

    const entries = await readDir(extensionsDir);

    console.log(`[Extensions] Found ${entries.length} entries in ${extensionsDir}`);
    for (const entry of entries) {
      console.log(`[Extensions] Entry: ${entry.name}, isDirectory: ${entry.isDirectory}, isSymlink: ${(entry as any).isSymlink}`);
      if (!entry.isDirectory) continue;

      const extPath = `${extensionsDir}/${entry.name}`;

      try {
        const result = await loadExtension(extPath);
        if (!result) continue;

        const { manifest } = result;
        const store = useAppStore.getState();

        store.registerExtension({
          manifest,
          status: 'disabled',
          installedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          path: extPath,
        });

        const enabled = await getExtensionEnabled(manifest.id);
        if (enabled) {
          await enableExtension(manifest.id);
        }
      } catch (err) {
        console.error(`[Extensions] Error loading extension from ${extPath}:`, err);
      }
    }
  } catch (err) {
    console.error('[Extensions] Failed to load extensions:', err);
  }
}

export async function reloadExtension(id: string): Promise<void> {
  console.log(`[Extensions] Reloading ${id}...`);
  await disableExtension(id);
  const store = useAppStore.getState();
  const installed = store.installedExtensions[id];
  if (!installed) {
    console.warn(`[Extensions] ${id} not found in installed extensions`);
    return;
  }
  // Re-load manifest in case it changed
  const result = await loadExtension(installed.path);
  if (result) {
    store.registerExtension({
      manifest: result.manifest,
      status: 'disabled',
      installedAt: installed.installedAt,
      updatedAt: new Date().toISOString(),
      path: installed.path,
    });
  }
  await enableExtension(id);
  console.log(`[Extensions] ${id} reloaded successfully`);
}

export async function reloadAllExtensions(): Promise<void> {
  console.log('[Extensions] Reloading all extensions...');
  const store = useAppStore.getState();
  const ids = Object.keys(store.installedExtensions);
  for (const id of ids) {
    if (activePlugins.has(id)) {
      await reloadExtension(id);
    }
  }
  // Also discover any new extensions
  await loadAllExtensions();
  console.log('[Extensions] All extensions reloaded');
}

export function getActivePlugins(): Map<string, { plugin: ExtensionPlugin; cleanup: () => void }> {
  return activePlugins;
}
