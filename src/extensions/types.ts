/**
 * Extension System — Type Definitions
 */

import type React from 'react';

// ============================================================================
// Extension Categories & Permissions
// ============================================================================

export type ExtensionCategory =
  | 'GIS'
  | 'Structure'
  | 'Architecture'
  | 'MEP'
  | 'Steel Detailing'
  | 'Utility'
  | 'Import/Export'
  | 'Other';

export type ExtensionPermission =
  | 'commands'
  | 'ribbon'
  | 'app-menu'
  | 'events'
  | 'filesystem'
  | 'network';

// ============================================================================
// Extension Manifest (manifest.json inside extension folder)
// ============================================================================

export interface ExtensionManifest {
  id: string;
  name: string;
  version: string;
  minAppVersion: string;
  author: string;
  description: string;
  category: ExtensionCategory;
  main: string;
  permissions: ExtensionPermission[];
  repository?: string;
  tags?: string[];
  icon?: string;
}

// ============================================================================
// Installed Extension State
// ============================================================================

export type ExtensionStatus = 'enabled' | 'disabled' | 'error' | 'loading';

export interface InstalledExtension {
  manifest: ExtensionManifest;
  status: ExtensionStatus;
  installedAt: string;
  updatedAt: string;
  path: string;
  error?: string;
}

// ============================================================================
// Extension Plugin Interface (what main.js exports)
// ============================================================================

export interface ExtensionPlugin {
  onLoad(api: ExtensionApi): void | Promise<void>;
  onUnload?(): void | Promise<void>;
}

// ============================================================================
// Extension API (passed to onLoad)
// ============================================================================

export interface ExtensionApi {
  readonly extensionId: string;

  commands: {
    execute(cmd: { command: string; action: string; entity?: string; params: Record<string, unknown> }): Promise<any>;
    register(def: ExtensionCommandDefinition): void;
    unregister(command: string, action: string, entity?: string): void;
  };

  entities: {
    list(): any[];
    draw(entity: string, params: Record<string, unknown>): Promise<any>;
    query(params: Record<string, unknown>): Promise<any>;
    modify(action: string, params: Record<string, unknown>): Promise<any>;
  };

  events: {
    on(event: string, listener: (data: any) => void): () => void;
    off(event: string, listener: (data: any) => void): void;
    emit(event: string, data?: any): void;
  };

  selection: {
    getSelected(): string[];
    setSelected(ids: string[]): void;
    clear(): void;
  };

  layers: {
    list(): any[];
    getActive(): any;
    create(name: string, opts?: Record<string, unknown>): any;
  };

  viewport: {
    get(): { panX: number; panY: number; zoom: number };
    pan(dx: number, dy: number): void;
    zoom(factor: number): void;
    fit(): void;
  };

  document: {
    getInfo(): { projectName: string; filePath: string | null; isModified: boolean };
  };

  ui: {
    addRibbonButton(reg: RibbonButtonRegistration): void;
    addRibbonTab(reg: RibbonTabRegistration): void;
    addAppMenuPanel(reg: AppMenuPanelRegistration): void;
    showNotification(message: string, type?: 'info' | 'warning' | 'error'): void;
  };

  settings: {
    get<T>(key: string, defaultValue: T): Promise<T>;
    set<T>(key: string, value: T): Promise<void>;
  };

  fs: {
    readFile(relativePath: string): Promise<string>;
    writeFile(relativePath: string, content: string): Promise<void>;
    exists(relativePath: string): Promise<boolean>;
  };

  _cleanup(): void;
}

// ============================================================================
// Extension Command Definition
// ============================================================================

export interface ExtensionCommandDefinition {
  command: string;
  action: string;
  entity?: string;
  description: string;
  handler: (params: Record<string, unknown>) => Promise<any> | any;
}

// ============================================================================
// UI Registration Types
// ============================================================================

export interface RibbonButtonRegistration {
  tab: string;
  group: string;
  label: string;
  icon?: string;
  size?: 'small' | 'medium' | 'large';
  onClick: () => void;
  tooltip?: string;
  shortcut?: string;
}

export interface RibbonTabRegistration {
  id: string;
  label: string;
  order?: number;
}

export interface AppMenuPanelRegistration {
  id: string;
  label: string;
  icon?: string;
  render: (container: HTMLElement) => void | (() => void);
  order?: number;
}

// ============================================================================
// Store-side UI registrations (serializable state)
// ============================================================================

export interface ExtensionRibbonButton {
  extensionId: string;
  tab: string;
  group: string;
  label: string;
  icon?: string;
  size: 'small' | 'medium' | 'large';
  onClick: () => void;
  tooltip?: string;
  shortcut?: string;
}

export interface ExtensionRibbonTab {
  extensionId: string;
  id: string;
  label: string;
  order: number;
  render?: () => React.ReactNode;
}

export interface ExtensionAppMenuPanel {
  extensionId: string;
  id: string;
  label: string;
  icon?: string;
  render: (container: HTMLElement) => void | (() => void);
  order: number;
}

// ============================================================================
// GitHub Catalog Types
// ============================================================================

export interface CatalogEntry {
  id: string;
  name: string;
  version: string;
  author: string;
  description: string;
  category: ExtensionCategory;
  tags: string[];
  minAppVersion: string;
  repository: string;
  downloadUrl: string;
  icon?: string;
}

export interface ExtensionCatalog {
  version: number;
  lastUpdated: string;
  extensions: CatalogEntry[];
}
