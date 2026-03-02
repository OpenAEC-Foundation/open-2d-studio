/**
 * Extension Slice — Manages installed extensions, UI registrations, and catalog state
 */

import type {
  InstalledExtension,
  ExtensionStatus,
  ExtensionRibbonButton,
  ExtensionRibbonTab,
  ExtensionAppMenuPanel,
  CatalogEntry,
} from '../../extensions/types';

// ============================================================================
// State Interface
// ============================================================================

export interface ExtensionState {
  installedExtensions: Record<string, InstalledExtension>;
  extensionRibbonButtons: ExtensionRibbonButton[];
  extensionRibbonTabs: ExtensionRibbonTab[];
  extensionAppMenuPanels: ExtensionAppMenuPanel[];
  catalogEntries: CatalogEntry[];
  catalogLoading: boolean;
  catalogError: string | null;
  catalogLastFetched: number | null;
}

// ============================================================================
// Actions Interface
// ============================================================================

export interface ExtensionActions {
  registerExtension: (ext: InstalledExtension) => void;
  unregisterExtension: (id: string) => void;
  setExtensionStatus: (id: string, status: ExtensionStatus, error?: string) => void;

  addExtensionRibbonButton: (btn: ExtensionRibbonButton) => void;
  removeExtensionRibbonButton: (extensionId: string, label: string) => void;
  addExtensionRibbonTab: (tab: ExtensionRibbonTab) => void;
  removeExtensionRibbonTab: (extensionId: string, tabId: string) => void;
  addExtensionAppMenuPanel: (panel: ExtensionAppMenuPanel) => void;
  removeExtensionAppMenuPanel: (extensionId: string, panelId: string) => void;
  removeAllExtensionUI: (extensionId: string) => void;

  setCatalog: (entries: CatalogEntry[], fetchedAt: number) => void;
  setCatalogLoading: (loading: boolean) => void;
  setCatalogError: (error: string | null) => void;
}

export type ExtensionSlice = ExtensionState & ExtensionActions;

// ============================================================================
// Initial State
// ============================================================================

export const initialExtensionState: ExtensionState = {
  installedExtensions: {},
  extensionRibbonButtons: [],
  extensionRibbonTabs: [],
  extensionAppMenuPanels: [],
  catalogEntries: [],
  catalogLoading: false,
  catalogError: null,
  catalogLastFetched: null,
};

// ============================================================================
// Slice Creator
// ============================================================================

export const createExtensionSlice = (
  set: (fn: (state: ExtensionState) => void) => void,
  _get: () => ExtensionState
): ExtensionActions => ({

  registerExtension: (ext) =>
    set((state) => {
      state.installedExtensions[ext.manifest.id] = ext;
    }),

  unregisterExtension: (id) =>
    set((state) => {
      delete state.installedExtensions[id];
    }),

  setExtensionStatus: (id, status, error) =>
    set((state) => {
      const ext = state.installedExtensions[id];
      if (ext) {
        ext.status = status;
        ext.error = error;
      }
    }),

  addExtensionRibbonButton: (btn) =>
    set((state) => {
      // Prevent duplicate buttons from same extension with same label
      const exists = state.extensionRibbonButtons.some(
        (b) => b.extensionId === btn.extensionId && b.label === btn.label
      );
      if (!exists) {
        state.extensionRibbonButtons.push(btn);
      }
    }),

  removeExtensionRibbonButton: (extensionId, label) =>
    set((state) => {
      state.extensionRibbonButtons = state.extensionRibbonButtons.filter(
        (b) => !(b.extensionId === extensionId && b.label === label)
      );
    }),

  addExtensionRibbonTab: (tab) =>
    set((state) => {
      // Deduplicate by tab ID — multiple extensions can share the same tab (e.g., "Add-Ins")
      const existing = state.extensionRibbonTabs.find((t) => t.id === tab.id);
      if (!existing) {
        state.extensionRibbonTabs.push(tab);
      }
    }),

  removeExtensionRibbonTab: (extensionId, tabId) =>
    set((state) => {
      state.extensionRibbonTabs = state.extensionRibbonTabs.filter(
        (t) => !(t.extensionId === extensionId && t.id === tabId)
      );
    }),

  addExtensionAppMenuPanel: (panel) =>
    set((state) => {
      const exists = state.extensionAppMenuPanels.some(
        (p) => p.extensionId === panel.extensionId && p.id === panel.id
      );
      if (!exists) {
        state.extensionAppMenuPanels.push(panel);
      }
    }),

  removeExtensionAppMenuPanel: (extensionId, panelId) =>
    set((state) => {
      state.extensionAppMenuPanels = state.extensionAppMenuPanels.filter(
        (p) => !(p.extensionId === extensionId && p.id === panelId)
      );
    }),

  removeAllExtensionUI: (extensionId) =>
    set((state) => {
      state.extensionRibbonButtons = state.extensionRibbonButtons.filter(
        (b) => b.extensionId !== extensionId
      );
      state.extensionRibbonTabs = state.extensionRibbonTabs.filter(
        (t) => t.extensionId !== extensionId
      );
      state.extensionAppMenuPanels = state.extensionAppMenuPanels.filter(
        (p) => p.extensionId !== extensionId
      );
    }),

  setCatalog: (entries, fetchedAt) =>
    set((state) => {
      state.catalogEntries = entries;
      state.catalogLastFetched = fetchedAt;
      state.catalogLoading = false;
      state.catalogError = null;
    }),

  setCatalogLoading: (loading) =>
    set((state) => {
      state.catalogLoading = loading;
    }),

  setCatalogError: (error) =>
    set((state) => {
      state.catalogError = error;
      state.catalogLoading = false;
    }),
});
