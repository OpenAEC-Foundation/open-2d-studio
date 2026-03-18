/**
 * Bonsai Sync Service
 *
 * Watches for store changes (shapes, parametric shapes, wall types, etc.)
 * and pushes IFC data to connected Blender/Bonsai clients via a localhost
 * WebSocket server running in the Tauri backend.
 *
 * The service uses debouncing (default 2 seconds) to avoid excessive pushes
 * during rapid editing. When running in Tauri, it calls the `push_ifc_to_blender`
 * command which broadcasts to all connected WebSocket clients. Falls back to
 * file-based sync in browser mode.
 */

import { useAppStore } from '../../state/appStore';
import { generateIFC } from '../ifc/ifcGenerator';

// ============================================================================
// Constants
// ============================================================================

/** Debounce delay in ms before pushing the IFC data after a change */
const SYNC_DEBOUNCE_MS = 2000;

/** Interval in ms for polling WebSocket client count */
const CLIENT_COUNT_POLL_MS = 3000;

/** localStorage key for persisting the sync enabled state */
const SYNC_ENABLED_KEY = 'open2dstudio_bonsai_sync_enabled';

// ============================================================================
// Tauri detection & commands
// ============================================================================

/**
 * Check if we are running inside Tauri (desktop app).
 */
function isTauriEnvironment(): boolean {
  return !!(window as any).__TAURI_INTERNALS__;
}

/**
 * Push IFC content to all connected Blender clients via the Tauri WebSocket server.
 * Returns the number of clients that received the data.
 */
/** Sync file path in appdata */
const SYNC_FILE_NAME = 'bonsai_sync.ifc';

async function getSyncFilePath(): Promise<string> {
  if (isTauriEnvironment()) {
    const { appDataDir } = await import('@tauri-apps/api/path');
    const appData = await appDataDir();
    return `${appData}${SYNC_FILE_NAME}`;
  }
  return SYNC_FILE_NAME;
}

/**
 * Write IFC content to the sync file for Blender file-watch pickup.
 */
async function pushIfcToBlender(content: string): Promise<number> {
  if (isTauriEnvironment()) {
    const { writeTextFile } = await import('@tauri-apps/plugin-fs');
    const syncPath = await getSyncFilePath();
    await writeTextFile(syncPath, content);
    return 1;
  }
  return 0;
}

// ============================================================================
// Persistence helpers
// ============================================================================

/** Load persisted sync settings from localStorage */
export function loadBonsaiSyncSettings(): { enabled: boolean } {
  try {
    const enabled = localStorage.getItem(SYNC_ENABLED_KEY) === 'true';
    return { enabled };
  } catch {
    return { enabled: false };
  }
}

/** Persist sync settings to localStorage */
export function saveBonsaiSyncSettings(enabled: boolean): void {
  try {
    localStorage.setItem(SYNC_ENABLED_KEY, String(enabled));
  } catch {
    // Silently ignore quota errors
  }
}

// ============================================================================
// Core sync function
// ============================================================================

/**
 * Generate the IFC content from current store state and push it to
 * all connected Blender clients via WebSocket.
 */
async function performSync(): Promise<void> {
  const state = useAppStore.getState();

  if (!state.bonsaiSyncEnabled) {
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

    // Push to connected Blender clients via WebSocket
    let clientCount = 0;
    try {
      clientCount = await pushIfcToBlender(result.content);
    } catch {
      // WebSocket server not available yet
    }

    // Always also write to file as fallback for file-watch mode
    const syncFilePath = 'C:\\Users\\rickd\\Documents\\GitHub\\open-2d-studio\\sync_model.ifc';
    try {
      if (isTauriEnvironment()) {
        const { writeTextFile } = await import('@tauri-apps/plugin-fs');
        await writeTextFile(syncFilePath, result.content);
      }
    } catch {
      // File write failed, WebSocket is primary anyway
    }

    // Update state on success
    const now = Date.now();
    state.setBonsaiLastSync(now);
    state.setBonsaiSyncStatus('idle');
    state.setBonsaiSyncError(null);

    if (clientCount === 0) {
      state.setBonsaiSyncError('File sync active (no WebSocket clients)');
    }

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
 * Does not require sync to be enabled.
 * When called manually, temporarily forces sync even if bonsaiSyncEnabled is false.
 */
export async function triggerBonsaiSync(): Promise<void> {
  const state = useAppStore.getState();

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
// Sync file path initialization
// ============================================================================

async function initSyncPath(): Promise<void> {
  try {
    const syncPath = await getSyncFilePath();
    const state = useAppStore.getState();
    state.setBonsaiSyncPath(syncPath);
  } catch {
    // Silently ignore
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
 * and drawings. Debounces pushes to avoid excessive WebSocket traffic.
 *
 * Call once at app startup. Returns an unsubscribe function.
 */
export function startBonsaiSync(): () => void {
  // Always enable sync by default for seamless Blender integration
  const state = useAppStore.getState();
  state.setBonsaiSyncEnabled(true);

  // Initialize sync file path
  initSyncPath();

  // Subscribe to store changes
  unsubscribe = useAppStore.subscribe((state, prevState) => {
    // Only sync when model data changes and sync is enabled
    if (!state.bonsaiSyncEnabled) return;

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
    // cleanup done
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
  stopClientCountPolling();
}
