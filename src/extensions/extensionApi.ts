/**
 * Extension API Factory — Creates a scoped API object for each extension
 */

import type {
  ExtensionApi,
  ExtensionPermission,
  RibbonButtonRegistration,
  RibbonTabRegistration,
  AppMenuPanelRegistration,
  ExtensionCommandDefinition,
} from './types';
import { useAppStore } from '../state/appStore';
import { getSetting, setSetting } from '../utils/settings';
import { readTextFile, writeTextFile, exists } from '@tauri-apps/plugin-fs';
import { commandRegistry } from '../api/commands';

export function createExtensionApi(
  extensionId: string,
  permissions: ExtensionPermission[],
  extensionDir: string
): ExtensionApi {
  const has = (p: ExtensionPermission) => permissions.includes(p);

  const registeredCommands: Array<{ command: string; action: string; entity?: string }> = [];
  const registeredButtons: Array<{ tab: string; label: string }> = [];
  const registeredTabs: string[] = [];
  const registeredPanels: string[] = [];
  const eventCleanups: Array<() => void> = [];

  const settingsPrefix = `ext:${extensionId}:`;

  const api: ExtensionApi = {
    extensionId,

    // -- Commands --
    commands: {
      execute: async (cmd) => {
        if (!has('commands')) throw new Error(`Extension "${extensionId}" lacks "commands" permission`);
        const cad = (window as any).cad;
        if (!cad) throw new Error('CadApi not available');
        return cad.run(cmd);
      },
      register: (def: ExtensionCommandDefinition) => {
        if (!has('commands')) throw new Error(`Extension "${extensionId}" lacks "commands" permission`);
        commandRegistry.register({
          command: def.command,
          action: def.action,
          entity: def.entity,
          description: def.description,
          params: [],
          handler: async (params, _context) => {
            try {
              const result = await def.handler(params);
              return result && typeof result === 'object' && 'success' in result
                ? result
                : { success: true, data: result };
            } catch (err) {
              return { success: false, error: err instanceof Error ? err.message : String(err) };
            }
          },
        });
        registeredCommands.push({ command: def.command, action: def.action, entity: def.entity });
      },
      unregister: (command, action, entity) => {
        if (!has('commands')) return;
        commandRegistry.unregister(command, action, entity);
      },
    },

    // -- Entities --
    entities: {
      list: () => {
        const state = useAppStore.getState();
        return state.shapes.map((s: any) => ({
          id: s.id,
          type: s.type,
          layer: s.layer,
          color: s.color,
          lineWeight: s.lineWeight,
        }));
      },
      draw: async (entity, params) => {
        if (!has('commands')) throw new Error(`Extension "${extensionId}" lacks "commands" permission`);
        const cad = (window as any).cad;
        if (!cad) throw new Error('CadApi not available');
        return cad.draw(entity, params);
      },
      query: async (params) => {
        const cad = (window as any).cad;
        if (!cad) throw new Error('CadApi not available');
        return cad.run({ command: 'query', action: 'list', params });
      },
      modify: async (action, params) => {
        if (!has('commands')) throw new Error(`Extension "${extensionId}" lacks "commands" permission`);
        const cad = (window as any).cad;
        if (!cad) throw new Error('CadApi not available');
        return cad.run({ command: 'modify', action, params });
      },
    },

    // -- Events --
    events: {
      on: (event, listener) => {
        if (!has('events')) throw new Error(`Extension "${extensionId}" lacks "events" permission`);
        const cad = (window as any).cad;
        if (!cad) throw new Error('CadApi not available');
        const unsub = cad.events.on(event, listener);
        eventCleanups.push(unsub);
        return unsub;
      },
      off: (event, listener) => {
        if (!has('events')) return;
        const cad = (window as any).cad;
        if (cad) cad.events.off(event, listener);
      },
      emit: (event, data) => {
        if (!has('events')) return;
        const cad = (window as any).cad;
        if (cad) cad.events.emit(event as any, data);
      },
    },

    // -- Selection --
    selection: {
      getSelected: () => useAppStore.getState().selectedShapeIds,
      setSelected: (ids) => useAppStore.getState().selectShapes(ids),
      clear: () => useAppStore.getState().deselectAll(),
    },

    // -- Layers --
    layers: {
      list: () => useAppStore.getState().layers,
      getActive: () => {
        const s = useAppStore.getState();
        return s.layers.find((l) => l.id === s.activeLayerId);
      },
      create: (name, opts) => {
        const cad = (window as any).cad;
        if (!cad) throw new Error('CadApi not available');
        return cad.run({ command: 'layer', action: 'create', params: { name, ...opts } });
      },
    },

    // -- Viewport --
    viewport: {
      get: () => {
        const v = useAppStore.getState().viewport;
        return { panX: v.offsetX, panY: v.offsetY, zoom: v.zoom };
      },
      pan: (dx, dy) => {
        const s = useAppStore.getState();
        s.setViewport({ offsetX: s.viewport.offsetX + dx, offsetY: s.viewport.offsetY + dy });
      },
      zoom: (factor) => {
        const s = useAppStore.getState();
        s.setViewport({ zoom: s.viewport.zoom * factor });
      },
      fit: () => useAppStore.getState().zoomToFit(),
    },

    // -- Document --
    document: {
      getInfo: () => {
        const s = useAppStore.getState();
        return {
          projectName: s.projectName,
          filePath: s.currentFilePath,
          isModified: s.isModified,
        };
      },
    },

    // -- UI Registration --
    ui: {
      addRibbonButton: (reg: RibbonButtonRegistration) => {
        if (!has('ribbon')) throw new Error(`Extension "${extensionId}" lacks "ribbon" permission`);
        useAppStore.getState().addExtensionRibbonButton({
          extensionId,
          tab: reg.tab,
          group: reg.group,
          label: reg.label,
          icon: reg.icon,
          size: reg.size || 'large',
          onClick: reg.onClick,
          tooltip: reg.tooltip,
          shortcut: reg.shortcut,
        });
        registeredButtons.push({ tab: reg.tab, label: reg.label });
      },
      addRibbonTab: (reg: RibbonTabRegistration) => {
        if (!has('ribbon')) throw new Error(`Extension "${extensionId}" lacks "ribbon" permission`);
        useAppStore.getState().addExtensionRibbonTab({
          extensionId,
          id: reg.id,
          label: reg.label,
          order: reg.order ?? 100,
        });
        registeredTabs.push(reg.id);
      },
      addAppMenuPanel: (reg: AppMenuPanelRegistration) => {
        if (!has('app-menu')) throw new Error(`Extension "${extensionId}" lacks "app-menu" permission`);
        useAppStore.getState().addExtensionAppMenuPanel({
          extensionId,
          id: reg.id,
          label: reg.label,
          icon: reg.icon,
          render: reg.render,
          order: reg.order ?? 100,
        });
        registeredPanels.push(reg.id);
      },
      showNotification: (message, type = 'info') => {
        console.log(`[Extension:${extensionId}] [${type}] ${message}`);
      },
    },

    // -- Scoped Settings --
    settings: {
      get: <T>(key: string, defaultValue: T) => getSetting(`${settingsPrefix}${key}`, defaultValue),
      set: <T>(key: string, value: T) => setSetting(`${settingsPrefix}${key}`, value),
    },

    // -- Scoped Filesystem --
    fs: {
      readFile: async (relativePath: string) => {
        if (!has('filesystem')) throw new Error(`Extension "${extensionId}" lacks "filesystem" permission`);
        if (relativePath.includes('..')) throw new Error('Path traversal not allowed');
        const fullPath = `${extensionDir}/${relativePath}`;
        return readTextFile(fullPath);
      },
      writeFile: async (relativePath: string, content: string) => {
        if (!has('filesystem')) throw new Error(`Extension "${extensionId}" lacks "filesystem" permission`);
        if (relativePath.includes('..')) throw new Error('Path traversal not allowed');
        const fullPath = `${extensionDir}/${relativePath}`;
        return writeTextFile(fullPath, content);
      },
      exists: async (relativePath: string) => {
        if (!has('filesystem')) throw new Error(`Extension "${extensionId}" lacks "filesystem" permission`);
        if (relativePath.includes('..')) throw new Error('Path traversal not allowed');
        const fullPath = `${extensionDir}/${relativePath}`;
        return exists(fullPath);
      },
    },

    // -- Cleanup (called when extension is unloaded) --
    _cleanup: () => {
      // Remove all event listeners
      for (const unsub of eventCleanups) {
        try { unsub(); } catch { /* ignore */ }
      }
      eventCleanups.length = 0;

      // Unregister all commands
      for (const cmd of registeredCommands) {
        try {
          commandRegistry.unregister(cmd.command, cmd.action, cmd.entity);
        } catch { /* ignore */ }
      }
      registeredCommands.length = 0;

      // Remove all UI registrations
      useAppStore.getState().removeAllExtensionUI(extensionId);
      registeredButtons.length = 0;
      registeredTabs.length = 0;
      registeredPanels.length = 0;
    },
  };

  return api;
}
