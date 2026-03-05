/**
 * Extension Service — Install, update, and remove extensions
 */

import { writeFile, readFile, mkdir, remove, exists, rename } from '@tauri-apps/plugin-fs';
import { fetch as tauriFetch } from '@tauri-apps/plugin-http';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { inflateSync } from 'fflate';
import type { CatalogEntry, InstalledExtension } from './types';
import { useAppStore } from '../state/appStore';
import { setSetting } from '../utils/settings';
import { getExtensionsDir, loadExtension, enableExtension, disableExtension } from './extensionLoader';

/**
 * Download and extract a zip file from a URL, returning the raw bytes.
 * Uses Tauri's HTTP plugin to bypass CORS restrictions.
 */
async function downloadZip(url: string): Promise<ArrayBuffer> {
  const response = await tauriFetch(url, { method: 'GET' });
  if (!response.ok) {
    throw new Error(`Download failed: ${response.status} ${response.statusText}`);
  }
  return response.arrayBuffer();
}

/**
 * Extract a zip file to a target directory.
 * Uses fflate for decompression. Handles basic ZIP format parsing.
 */
async function extractZip(zipBuffer: ArrayBuffer, targetDir: string): Promise<void> {
  const data = new Uint8Array(zipBuffer);

  // Parse ZIP entries (local file headers)
  let offset = 0;
  while (offset < data.length) {
    // Check for local file header signature (PK\x03\x04)
    if (
      data[offset] !== 0x50 ||
      data[offset + 1] !== 0x4b ||
      data[offset + 2] !== 0x03 ||
      data[offset + 3] !== 0x04
    ) {
      break; // End of local file headers
    }

    const compressionMethod = data[offset + 8] | (data[offset + 9] << 8);
    const compressedSize = data[offset + 18] | (data[offset + 19] << 8) | (data[offset + 20] << 16) | (data[offset + 21] << 24);
    const uncompressedSize = data[offset + 22] | (data[offset + 23] << 8) | (data[offset + 24] << 16) | (data[offset + 25] << 24);
    const fileNameLength = data[offset + 26] | (data[offset + 27] << 8);
    const extraFieldLength = data[offset + 28] | (data[offset + 29] << 8);

    const fileNameBytes = data.slice(offset + 30, offset + 30 + fileNameLength);
    const fileName = new TextDecoder().decode(fileNameBytes);

    const dataOffset = offset + 30 + fileNameLength + extraFieldLength;
    const compressedData = data.slice(dataOffset, dataOffset + compressedSize);

    offset = dataOffset + compressedSize;

    // Skip directories and potentially dangerous paths
    if (fileName.endsWith('/') || fileName.includes('..')) {
      continue;
    }

    // Strip leading directory if all files share a common prefix (e.g., "ext-name-1.0.0/")
    let outFileName = fileName;
    const firstSlash = fileName.indexOf('/');
    if (firstSlash > 0) {
      outFileName = fileName.substring(firstSlash + 1);
      if (!outFileName) continue; // Was just the directory itself
    }

    // Decompress
    let fileData: Uint8Array;
    if (compressionMethod === 0) {
      // Stored (no compression)
      fileData = compressedData;
    } else if (compressionMethod === 8) {
      // Deflate
      fileData = inflateSync(compressedData, { out: new Uint8Array(uncompressedSize) });
    } else {
      console.warn(`[Extensions] Unsupported compression method ${compressionMethod} for ${fileName}`);
      continue;
    }

    // Create parent directories
    const parts = outFileName.split('/');
    if (parts.length > 1) {
      const parentDir = `${targetDir}/${parts.slice(0, -1).join('/')}`;
      try {
        await mkdir(parentDir, { recursive: true });
      } catch { /* might already exist */ }
    }

    // Write file
    await writeFile(`${targetDir}/${outFileName}`, fileData);
  }
}

export async function installExtension(entry: CatalogEntry): Promise<boolean> {
  const store = useAppStore.getState();

  try {
    const extensionsDir = await getExtensionsDir();

    // Ensure extensions directory exists
    const dirExists = await exists(extensionsDir);
    if (!dirExists) {
      await mkdir(extensionsDir, { recursive: true });
    }

    const extDir = `${extensionsDir}/${entry.id}`;

    // Download and extract
    const zipData = await downloadZip(entry.downloadUrl);
    await mkdir(extDir, { recursive: true });
    await extractZip(zipData, extDir);

    // Load the extension to validate it
    const result = await loadExtension(extDir);
    if (!result) {
      // Cleanup on failure
      await remove(extDir, { recursive: true });
      return false;
    }

    const now = new Date().toISOString();
    store.registerExtension({
      manifest: result.manifest,
      status: 'disabled',
      installedAt: now,
      updatedAt: now,
      path: extDir,
    });

    // Enable by default
    await setSetting(`ext:${entry.id}:enabled`, true);
    await enableExtension(entry.id);

    return true;
  } catch (err) {
    console.error(`[Extensions] Failed to install ${entry.id}:`, err);
    return false;
  }
}

export async function installExtensionFromFile(): Promise<boolean> {
  const store = useAppStore.getState();

  try {
    const selected = await openDialog({
      title: 'Install Extension',
      filters: [{ name: 'Extension Package', extensions: ['zip'] }],
      multiple: false,
      directory: false,
    });

    if (!selected) return false;

    const filePath = Array.isArray(selected) ? selected[0] : selected;
    if (!filePath) return false;

    const extensionsDir = await getExtensionsDir();
    const dirExists = await exists(extensionsDir);
    if (!dirExists) {
      await mkdir(extensionsDir, { recursive: true });
    }

    const tempDir = `${extensionsDir}/_temp_install`;
    try {
      await remove(tempDir, { recursive: true });
    } catch { /* may not exist */ }
    await mkdir(tempDir, { recursive: true });

    try {
      const zipBytes = await readFile(filePath);
      await extractZip(zipBytes.buffer, tempDir);

      const result = await loadExtension(tempDir);
      if (!result) {
        await remove(tempDir, { recursive: true });
        return false;
      }

      const finalDir = `${extensionsDir}/${result.manifest.id}`;

      // Remove existing installation if present
      if (await exists(finalDir)) {
        const existing = store.installedExtensions[result.manifest.id];
        if (existing) {
          await disableExtension(result.manifest.id);
          store.unregisterExtension(result.manifest.id);
        }
        await remove(finalDir, { recursive: true });
      }

      await rename(tempDir, finalDir);

      const now = new Date().toISOString();
      store.registerExtension({
        manifest: result.manifest,
        status: 'disabled',
        installedAt: now,
        updatedAt: now,
        path: finalDir,
      });

      await setSetting(`ext:${result.manifest.id}:enabled`, true);
      await enableExtension(result.manifest.id);

      return true;
    } catch (err) {
      try {
        await remove(tempDir, { recursive: true });
      } catch { /* cleanup best-effort */ }
      throw err;
    }
  } catch (err) {
    console.error('[Extensions] Failed to install from file:', err);
    return false;
  }
}

export async function updateExtension(id: string, entry: CatalogEntry): Promise<boolean> {
  const store = useAppStore.getState();
  const installed = store.installedExtensions[id];
  if (!installed) return false;

  try {
    // Disable first
    await disableExtension(id);

    // Remove old files
    await remove(installed.path, { recursive: true });

    // Install new version
    return await installExtension(entry);
  } catch (err) {
    console.error(`[Extensions] Failed to update ${id}:`, err);
    return false;
  }
}

export async function removeExtension(id: string): Promise<boolean> {
  const store = useAppStore.getState();
  const installed = store.installedExtensions[id];
  if (!installed) return false;

  try {
    // Disable and cleanup
    await disableExtension(id);

    // Delete files
    await remove(installed.path, { recursive: true });

    // Remove from store
    store.unregisterExtension(id);

    // Clear settings
    await setSetting(`ext:${id}:enabled`, undefined);

    return true;
  } catch (err) {
    console.error(`[Extensions] Failed to remove ${id}:`, err);
    return false;
  }
}

export function checkForUpdates(
  installed: Record<string, InstalledExtension>,
  catalog: CatalogEntry[]
): CatalogEntry[] {
  const updates: CatalogEntry[] = [];

  for (const entry of catalog) {
    const inst = installed[entry.id];
    if (!inst) continue;

    if (compareVersions(entry.version, inst.manifest.version) > 0) {
      updates.push(entry);
    }
  }

  return updates;
}

/**
 * Simple semver comparison. Returns >0 if a > b, <0 if a < b, 0 if equal.
 */
function compareVersions(a: string, b: string): number {
  const partsA = a.split('.').map(Number);
  const partsB = b.split('.').map(Number);
  const len = Math.max(partsA.length, partsB.length);

  for (let i = 0; i < len; i++) {
    const numA = partsA[i] || 0;
    const numB = partsB[i] || 0;
    if (numA !== numB) return numA - numB;
  }

  return 0;
}
