/**
 * Bonsai Sync Service
 *
 * Watches for store changes (shapes, parametric shapes, wall types, etc.)
 * and auto-exports the IFC file to a configured path so that Blender/Bonsai
 * can detect the file change and reload/refresh the model.
 *
 * The service uses debouncing (default 2 seconds) to avoid excessive writes
 * during rapid editing. It writes the IFC file using Tauri's fs plugin when
 * running in the desktop app, or falls back to a no-op in browser mode.
 */

import { useAppStore } from '../../state/appStore';
import { generateIFC } from '../ifc/ifcGenerator';

// ============================================================================
// Constants
// ============================================================================

/** Debounce delay in ms before writing the IFC file after a change */
const SYNC_DEBOUNCE_MS = 2000;

/** localStorage key for persisting the sync path */
const SYNC_PATH_KEY = 'open2dstudio_bonsai_sync_path';

/** localStorage key for persisting the sync enabled state */
const SYNC_ENABLED_KEY = 'open2dstudio_bonsai_sync_enabled';

// ============================================================================
// Tauri FS detection
// ============================================================================

/**
 * Check if we are running inside Tauri (desktop app).
 * The fs plugin is only available in Tauri context.
 */
function isTauriEnvironment(): boolean {
  return !!(window as any).__TAURI_INTERNALS__;
}

/**
 * Dynamically import Tauri fs plugin and write a text file.
 * In Tauri, writes directly to the filesystem.
 * In the browser, falls back to a file download.
 */
async function writeIfcFile(path: string, content: string): Promise<void> {
  if (isTauriEnvironment()) {
    // Dynamic import to avoid errors when running in browser
    const { writeTextFile } = await import('@tauri-apps/plugin-fs');
    await writeTextFile(path, content);
  } else {
    // Browser fallback: trigger a download
    const filename = path.split(/[/\\]/).pop() || 'model.ifc';
    const blob = new Blob([content], { type: 'application/x-step' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }
}

// ============================================================================
// Persistence helpers
// ============================================================================

/** Load persisted sync settings from localStorage */
export function loadBonsaiSyncSettings(): { path: string; enabled: boolean } {
  try {
    const path = localStorage.getItem(SYNC_PATH_KEY) || '';
    const enabled = localStorage.getItem(SYNC_ENABLED_KEY) === 'true';
    return { path, enabled };
  } catch {
    return { path: '', enabled: false };
  }
}

/** Persist sync settings to localStorage */
export function saveBonsaiSyncSettings(path: string, enabled: boolean): void {
  try {
    localStorage.setItem(SYNC_PATH_KEY, path);
    localStorage.setItem(SYNC_ENABLED_KEY, String(enabled));
  } catch {
    // Silently ignore quota errors
  }
}

// ============================================================================
// Core sync function
// ============================================================================

/**
 * Generate the IFC content from current store state and write it to the
 * configured Bonsai sync path.
 */
async function performSync(): Promise<void> {
  const state = useAppStore.getState();

  if (!state.bonsaiSyncEnabled || !state.bonsaiSyncPath) {
    return;
  }

  // Update status to syncing
  state.setBonsaiSyncStatus('syncing');

  try {
    // Generate IFC from current shapes
    const result = generateIFC(
      state.shapes,
      state.wallTypes,
      state.slabTypes,
      state.projectStructure,
      state.drawings,
      state.pileTypes
    );

    // Write to the sync path
    await writeIfcFile(state.bonsaiSyncPath, result.content);

    // Update state on success
    const now = Date.now();
    state.setBonsaiLastSync(now);
    state.setBonsaiSyncStatus('idle');
    state.setBonsaiSyncError(null);

    // Also update the IFC content/stats in the store
    useAppStore.setState((s: any) => {
      s.ifcContent = result.content;
      s.ifcEntityCount = result.entityCount;
      s.ifcFileSize = result.fileSize;
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    state.setBonsaiSyncStatus('error');
    state.setBonsaiSyncError(message);
  }
}

// ============================================================================
// Manual sync trigger
// ============================================================================

/**
 * Trigger a single Bonsai sync immediately (used by the "Sync Now" button).
 * Does not require sync to be enabled -- just requires a valid path.
 * When called manually, temporarily forces sync even if bonsaiSyncEnabled is false.
 */
export async function triggerBonsaiSync(): Promise<void> {
  const state = useAppStore.getState();
  if (!state.bonsaiSyncPath) {
    state.setBonsaiSyncError('No sync path configured. Click "Set Path" first.');
    state.setBonsaiSyncStatus('error');
    return;
  }

  // Temporarily force sync even if not enabled (manual trigger)
  const wasEnabled = state.bonsaiSyncEnabled;
  if (!wasEnabled) {
    state.setBonsaiSyncEnabled(true);
  }

  try {
    await performSync();
  } finally {
    // Restore original enabled state
    if (!wasEnabled) {
      state.setBonsaiSyncEnabled(false);
    }
  }
}

// ============================================================================
// Store subscription (debounced auto-sync)
// ============================================================================

let syncTimer: ReturnType<typeof setTimeout> | null = null;
let unsubscribe: (() => void) | null = null;

/**
 * Start the Bonsai Sync subscription on the store.
 * Watches for changes in shapes, wall types, slab types, project structure,
 * and drawings. Debounces writes to avoid excessive disk I/O.
 *
 * Call once at app startup. Returns an unsubscribe function.
 */
export function startBonsaiSync(): () => void {
  // Load persisted settings
  const { path, enabled } = loadBonsaiSyncSettings();
  const state = useAppStore.getState();
  if (path) state.setBonsaiSyncPath(path);
  if (enabled && path) state.setBonsaiSyncEnabled(true);

  // Subscribe to store changes
  unsubscribe = useAppStore.subscribe((state, prevState) => {
    // Only sync when model data changes and sync is enabled
    if (!state.bonsaiSyncEnabled || !state.bonsaiSyncPath) return;

    const modelChanged =
      state.shapes !== prevState.shapes ||
      state.wallTypes !== prevState.wallTypes ||
      state.slabTypes !== prevState.slabTypes ||
      state.projectStructure !== prevState.projectStructure ||
      state.drawings !== prevState.drawings;

    if (!modelChanged) return;

    // Debounce the sync
    if (syncTimer) clearTimeout(syncTimer);
    syncTimer = setTimeout(() => {
      performSync();
    }, SYNC_DEBOUNCE_MS);
  });

  return () => {
    if (syncTimer) {
      clearTimeout(syncTimer);
      syncTimer = null;
    }
    if (unsubscribe) {
      unsubscribe();
      unsubscribe = null;
    }
  };
}

/**
 * Stop the Bonsai Sync subscription.
 */
export function stopBonsaiSync(): void {
  if (syncTimer) {
    clearTimeout(syncTimer);
    syncTimer = null;
  }
  if (unsubscribe) {
    unsubscribe();
    unsubscribe = null;
  }
}
