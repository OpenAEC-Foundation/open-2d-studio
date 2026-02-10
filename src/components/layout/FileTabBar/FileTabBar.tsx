/**
 * FileTabBar - Horizontal tab bar for open documents
 * Sloped right-side divider between tabs
 */

import { useCallback } from 'react';
import { useAppStore } from '../../../state/appStore';
import { getDocumentStoreIfExists } from '../../../state/documentStore';
import {
  promptSaveBeforeClose,
  showSaveDialog,
  writeProjectFile,
  type ProjectFile,
} from '../../../services/file/fileService';
import { logger } from '../../../services/log/logService';

/** Get tab display info — for active doc reads from appStore, for inactive reads from doc store */
function useTabInfo(docId: string, isActive: boolean) {
  // For the active document, read live from appStore (doc store may be stale)
  const activeProjectName = useAppStore((s) => s.projectName);
  const activeIsModified = useAppStore((s) => s.isModified);

  if (isActive) {
    return { name: activeProjectName, isModified: activeIsModified };
  }

  // For inactive documents, read from their doc store (saved on last switch)
  const store = getDocumentStoreIfExists(docId);
  if (!store) return { name: 'Unknown', isModified: false };
  const state = store.getState();
  return { name: state.projectName, isModified: state.isModified };
}

/** Check if a document is modified — reads from appStore for active doc */
function isDocModified(docId: string, activeDocumentId: string, appState: any): boolean {
  if (docId === activeDocumentId) {
    return appState.isModified;
  }
  const store = getDocumentStoreIfExists(docId);
  return store?.getState().isModified ?? false;
}

/** Save the currently active document. Returns true if saved, false if user cancelled. */
async function saveActiveDocument(): Promise<boolean> {
  const s = useAppStore.getState();
  let filePath = s.currentFilePath;

  if (!filePath) {
    filePath = await showSaveDialog(s.projectName);
    if (!filePath) return false; // User cancelled save dialog
  }

  try {
    const customRegionTypes = s.filledRegionTypes.filter((t: any) => !t.isBuiltIn);
    const project: ProjectFile = {
      version: 2,
      name: s.projectName,
      createdAt: new Date().toISOString(),
      modifiedAt: new Date().toISOString(),
      drawings: s.drawings,
      sheets: s.sheets,
      activeDrawingId: s.activeDrawingId,
      activeSheetId: s.activeSheetId,
      drawingViewports: s.drawingViewports,
      sheetViewports: s.sheetViewports,
      shapes: s.shapes,
      layers: s.layers,
      activeLayerId: s.activeLayerId,
      settings: {
        gridSize: s.gridSize,
        gridVisible: s.gridVisible,
        snapEnabled: s.snapEnabled,
      },
      savedPrintPresets: Object.keys(s.savedPrintPresets).length > 0 ? s.savedPrintPresets : undefined,
      filledRegionTypes: customRegionTypes.length > 0 ? customRegionTypes : undefined,
      projectInfo: {
        ...s.projectInfo,
        erpnext: { ...s.projectInfo.erpnext, apiSecret: '' },
      },
      unitSettings: s.unitSettings,
    };

    await writeProjectFile(filePath, project);
    s.setFilePath(filePath);
    s.setModified(false);
    const fileName = filePath.split(/[/\\]/).pop()?.replace('.o2d', '') || 'Untitled';
    s.setProjectName(fileName);
    logger.info(`Project saved: ${fileName}`, 'File');
    return true;
  } catch (err) {
    logger.error(`Failed to save: ${err}`, 'File');
    return false;
  }
}

/** Get the display name of a document */
function getDocName(docId: string, activeDocumentId: string): string {
  if (docId === activeDocumentId) {
    return useAppStore.getState().projectName;
  }
  const store = getDocumentStoreIfExists(docId);
  return store?.getState().projectName ?? 'Untitled';
}

/**
 * Handle closing a document with unsaved changes prompt.
 * Returns true if the document was closed, false if cancelled.
 */
async function handleCloseWithSavePrompt(
  docId: string,
  activeDocumentId: string,
  closeDocument: (id: string) => void,
  switchDocument: (id: string) => void,
): Promise<boolean> {
  const appState = useAppStore.getState();
  if (!isDocModified(docId, activeDocumentId, appState)) {
    closeDocument(docId);
    return true;
  }

  const docName = getDocName(docId, activeDocumentId);

  // If closing a non-active doc, switch to it first so save operates on its state
  const needSwitch = docId !== activeDocumentId;
  if (needSwitch) {
    switchDocument(docId);
  }

  const result = await promptSaveBeforeClose(docName);
  if (result === 'cancel') return false;
  if (result === 'save') {
    const saved = await saveActiveDocument();
    if (!saved) return false; // User cancelled the save dialog
  }
  closeDocument(docId);
  return true;
}

function TabItem({ docId, index, total }: { docId: string; index: number; total: number }) {
  const activeDocumentId = useAppStore((s) => s.activeDocumentId);
  const documentOrder = useAppStore((s) => s.documentOrder);
  const switchDocument = useAppStore((s) => s.switchDocument);
  const closeDocument = useAppStore((s) => s.closeDocument);

  const isActive = docId === activeDocumentId;
  const { name, isModified } = useTabInfo(docId, isActive);
  const isLast = index === total - 1;

  // Use CSS variables for theme-aware colors
  const bg = isActive ? 'var(--theme-bg)' : 'var(--theme-surface)';
  const barBg = 'var(--theme-surface)';
  const nextDocId = !isLast ? documentOrder[index + 1] : null;
  const nextBg = nextDocId === activeDocumentId ? 'var(--theme-bg)' : barBg;

  const handleMiddleClick = useCallback(async (e: React.MouseEvent) => {
    if (e.button === 1) {
      e.preventDefault();
      await handleCloseWithSavePrompt(docId, activeDocumentId, closeDocument, switchDocument);
    }
  }, [closeDocument, switchDocument, docId, activeDocumentId]);

  const handleClose = useCallback(async (e: React.MouseEvent) => {
    e.stopPropagation();
    await handleCloseWithSavePrompt(docId, activeDocumentId, closeDocument, switchDocument);
  }, [closeDocument, switchDocument, docId, activeDocumentId]);

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const menu = document.createElement('div');
    menu.className = 'fixed z-[9999] bg-cad-surface border border-cad-border shadow-lg text-xs';
    menu.style.left = `${e.clientX}px`;
    menu.style.top = `${e.clientY}px`;

    const closeWithCheck = async (id: string): Promise<boolean> => {
      return handleCloseWithSavePrompt(id, useAppStore.getState().activeDocumentId, closeDocument, switchDocument);
    };

    const items = [
      { label: 'Close', action: () => closeWithCheck(docId) },
      { label: 'Close Others', action: async () => {
        for (const id of [...documentOrder]) {
          if (id !== docId) {
            const closed = await closeWithCheck(id);
            if (!closed) break;
          }
        }
      }},
      { label: 'Close All', action: async () => {
        for (const id of [...documentOrder]) {
          const closed = await closeWithCheck(id);
          if (!closed) break;
        }
      }},
    ];

    items.forEach(item => {
      const el = document.createElement('div');
      el.className = 'px-4 py-1.5 hover:bg-cad-hover cursor-pointer text-cad-text';
      el.textContent = item.label;
      el.onclick = () => { item.action(); menu.remove(); };
      menu.appendChild(el);
    });

    document.body.appendChild(menu);
    const cleanup = () => { menu.remove(); document.removeEventListener('mousedown', cleanup); };
    setTimeout(() => document.addEventListener('mousedown', cleanup), 0);
  }, [closeDocument, switchDocument, documentOrder, docId, activeDocumentId]);

  return (
    <div
      className="flex items-stretch flex-shrink-0 group cursor-pointer"
      onClick={() => switchDocument(docId)}
      onMouseDown={handleMiddleClick}
      onContextMenu={handleContextMenu}
    >
      <div
        className="flex items-center h-[30px]"
        style={{ backgroundColor: bg }}
      >
        <span
          className="px-3 text-xs select-none"
          style={{
            color: isActive ? 'var(--theme-text)' : 'var(--theme-text-dim)',
            fontWeight: isActive ? 600 : 400,
          }}
        >
          {name}{isModified ? ' *' : ''}
        </span>
        <button
          className="w-4 h-4 flex items-center justify-center text-[12px] leading-none opacity-0 group-hover:opacity-100 -mr-1"
          style={{ borderRadius: 0, color: 'var(--theme-text-dim)' }}
          onClick={handleClose}
          onMouseEnter={(e) => e.currentTarget.style.color = 'var(--theme-text)'}
          onMouseLeave={(e) => e.currentTarget.style.color = 'var(--theme-text-dim)'}
          title="Close"
        >
          ×
        </button>
      </div>
      {/* Sloped right edge — triangle fills create the angled transition */}
      <svg width="14" height="30" viewBox="0 0 14 30" className="flex-shrink-0" style={{ display: 'block' }}>
        <polygon points="0,0 0,30 14,30" fill={bg} />
        <polygon points="0,0 14,0 14,30" fill={nextBg} />
      </svg>
    </div>
  );
}

export function FileTabBar() {
  const documentOrder = useAppStore((s) => s.documentOrder);
  const createNewDocument = useAppStore((s) => s.createNewDocument);

  return (
    <div
      className="flex items-stretch h-[30px] min-h-[30px] overflow-x-auto"
      style={{ scrollbarWidth: 'none', backgroundColor: 'var(--theme-surface)', borderBottom: '1px solid var(--theme-border)' }}
    >
      {documentOrder.map((docId, index) => (
        <TabItem key={docId} docId={docId} index={index} total={documentOrder.length} />
      ))}

      {/* New tab button */}
      <button
        className="flex items-center justify-center w-7 h-full text-sm flex-shrink-0"
        style={{ borderRadius: 0, color: 'var(--theme-text-dim)' }}
        onClick={() => createNewDocument()}
        onMouseEnter={(e) => e.currentTarget.style.color = 'var(--theme-text)'}
        onMouseLeave={(e) => e.currentTarget.style.color = 'var(--theme-text-dim)'}
        title="New Document (Ctrl+N)"
      >
        +
      </button>
    </div>
  );
}
