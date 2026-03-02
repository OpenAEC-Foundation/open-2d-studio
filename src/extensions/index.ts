/**
 * Extensions — Barrel export
 */

export type {
  ExtensionCategory,
  ExtensionPermission,
  ExtensionManifest,
  ExtensionStatus,
  InstalledExtension,
  ExtensionPlugin,
  ExtensionApi,
  ExtensionCommandDefinition,
  RibbonButtonRegistration,
  RibbonTabRegistration,
  AppMenuPanelRegistration,
  ExtensionRibbonButton,
  ExtensionRibbonTab,
  ExtensionAppMenuPanel,
  CatalogEntry,
  ExtensionCatalog,
} from './types';

export { createExtensionApi } from './extensionApi';
export {
  loadAllExtensions,
  enableExtension,
  disableExtension,
  getExtensionsDir,
  getExtensionEnabled,
} from './extensionLoader';
export { fetchCatalog } from './registryService';
export {
  installExtension,
  updateExtension,
  removeExtension,
  checkForUpdates,
} from './extensionService';
