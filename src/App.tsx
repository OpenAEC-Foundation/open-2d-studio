import './extensionSdkGlobal';
import { useCallback, useEffect, useRef, useState } from 'react';
import { PanelLeftOpen, PanelRightOpen, PanelRightClose } from 'lucide-react';
import { getSetting, setSetting } from './utils/settings';
// Layout components
import { TitleBar } from './components/layout/TitleBar/TitleBar';
import { Ribbon } from './components/layout/Ribbon/Ribbon';
import { StatusBar } from './components/layout/StatusBar/StatusBar';
import { FileTabBar } from './components/layout/FileTabBar/FileTabBar';

// Canvas components
import { Canvas } from './components/canvas/Canvas';
import { ToolOptionsBar } from './components/canvas/ToolOptionsBar/ToolOptionsBar';

// Panel components
import { NavigationPanel } from './components/panels/NavigationPanel';
import { SheetPropertiesPanel } from './components/panels/SheetPropertiesPanel';
import { RightPanelLayout } from './components/panels/RightPanelLayout';

// Dialog components
import { PrintDialog } from './components/dialogs/PrintDialog/PrintDialog';
import { SettingsDialog } from './components/dialogs/SettingsDialog/SettingsDialog';
import { AppMenu } from './components/dialogs/AppMenu/AppMenu';
import { FeedbackDialog } from './components/dialogs/FeedbackDialog/FeedbackDialog';
import { TitleBlockEditor } from './components/dialogs/TitleBlockEditor';
import { TitleBlockImportDialog } from './components/dialogs/TitleBlockImportDialog';
import { NewSheetDialog } from './components/dialogs/NewSheetDialog';
import { DrawingStandardsDialog } from './components/dialogs/DrawingStandardsDialog';
import { FindReplaceDialog } from './components/dialogs/FindReplaceDialog';
import { PdfUnderlayDialog } from './components/dialogs/PdfUnderlayDialog';
import { renderPdfPageForUnderlay } from './services/file/pdfUnderlayService';
import { getPdfUnderlayData } from './state/slices/uiSlice';
import type { ImageShape } from './types/geometry';

// Editor components
import { PatternManagerDialog } from './components/editors/PatternManager';
import { FilledRegionTypeManager } from './components/editors/FilledRegionTypeManager';
import { TextStyleManager } from './components/editors/TextStyleManager/TextStyleManager';
import { TerminalPanel } from './components/editors/TerminalPanel';
import { IfcPanel } from './components/panels/IfcPanel';
import { IfcDashboard } from './components/panels/IfcDashboard';
import { useKeyboardShortcuts } from './hooks/keyboard/useKeyboardShortcuts';
import { useGlobalKeyboard } from './hooks/keyboard/useGlobalKeyboard';
import { useFileOperations } from './hooks/file/useFileOperations';
import { useAppStore } from './state/appStore';
import { getDocumentStoreIfExists } from './state/documentStore';
import { CadApi } from './api';
import { loadAllExtensions } from './extensions';
import { logger } from './services/log/logService';
import { automationRegistry } from './engine/registry/AutomationRegistry';
import { dialogRegistry } from './engine/registry/DialogRegistry';
import { checkForUpdates } from './services/updater/updaterService';
import { startAutoSave, restoreAutoSave } from './services/autosave/autoSaveService';
import { startBonsaiSync } from './services/bonsaiSync';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { listen } from '@tauri-apps/api/event';
import {
  promptSaveBeforeClose,
  showSaveDialog,
  writeProjectFile,
  type ProjectFile,
} from './services/file/fileService';

function AutomationHookRunner({ useHook }: { useHook: () => void }) {
  useHook();
  return null;
}

function ExtensionAutomations() {
  const hooks = automationRegistry.getAll();
  return (
    <>
      {hooks.map(h => <AutomationHookRunner key={h.id} useHook={h.useHook} />)}
    </>
  );
}

function ExtensionDialogs() {
  const dialogs = dialogRegistry.getAll();
  return (
    <>
      {dialogs.map(d => <d.Component key={d.id} />)}
    </>
  );
}

function App() {
  // Initialize keyboard shortcuts
  useKeyboardShortcuts();
  useGlobalKeyboard();


  // Apply theme on mount
  const uiTheme = useAppStore(s => s.uiTheme);
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', uiTheme);
  }, [uiTheme]);

  // File operations (for file association handling)
  const { handleOpenPath } = useFileOperations();

  // Listen for file-open events from OS file association (double-click .o2d file)
  useEffect(() => {
    if (!('__TAURI_INTERNALS__' in window)) return;
    const unlisten = listen<string>('file-open', (event) => {
      handleOpenPath(event.payload);
    });
    return () => { unlisten.then(fn => fn()); };
  }, [handleOpenPath]);

  // App Menu
  const [appMenuOpen, setAppMenuOpen] = useState(false);
  const openAppMenu = useCallback(() => setAppMenuOpen(true), []);
  const closeAppMenu = useCallback(() => { setAppMenuOpen(false); }, []);

  // Sheet Template Import dialog (opened from AppMenu > Import)
  const [sheetTemplateImportOpen, setSheetTemplateImportOpen] = useState(false);
  const openSheetTemplateImport = useCallback(() => setSheetTemplateImportOpen(true), []);

  // Right panel resizing
  const [rightPanelWidth, setRightPanelWidth] = useState(256);

  // Restore saved width
  useEffect(() => {
    getSetting<number>('rightPanelWidth', 256).then(setRightPanelWidth);
  }, []);
  const isResizingRight = useRef(false);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizingRight.current) return;
      const newWidth = Math.max(180, Math.min(500, window.innerWidth - e.clientX));
      setRightPanelWidth(newWidth);
    };
    const handleMouseUp = () => {
      if (isResizingRight.current) {
        isResizingRight.current = false;
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        setRightPanelWidth(w => { setSetting('rightPanelWidth', w); return w; });
      }
    };
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, []);

  // Block browser shortcuts in production (F5, Ctrl+R, Ctrl+Shift+I, Ctrl+U, etc.)
  useEffect(() => {
    if (import.meta.env.DEV) return;

    const handler = (e: KeyboardEvent) => {
      // F5 / Ctrl+R / Ctrl+Shift+R - refresh
      if (e.key === 'F5' || (e.ctrlKey && e.key === 'r')) {
        e.preventDefault();
      }
      // Ctrl+Shift+I - dev tools
      if (e.ctrlKey && e.shiftKey && e.key === 'I') {
        e.preventDefault();
      }
      // Ctrl+U - view source
      if (e.ctrlKey && e.key === 'u') {
        e.preventDefault();
      }
      // Ctrl+Shift+J - console
      if (e.ctrlKey && e.shiftKey && e.key === 'J') {
        e.preventDefault();
      }
      // F7 - caret browsing
      if (e.key === 'F7') {
        e.preventDefault();
      }
    };

    const contextHandler = (e: MouseEvent) => {
      e.preventDefault();
    };

    window.addEventListener('keydown', handler, true);
    window.addEventListener('contextmenu', contextHandler, true);
    return () => {
      window.removeEventListener('keydown', handler, true);
      window.removeEventListener('contextmenu', contextHandler, true);
    };
  }, []);

  // Initialize CAD API
  const cadApiRef = useRef<CadApi | null>(null);
  useEffect(() => {
    if (!cadApiRef.current) {
      cadApiRef.current = new CadApi(useAppStore);
      (window as any).cad = cadApiRef.current;

      // Load extensions after CadApi is available
      loadAllExtensions().catch((err) =>
        logger.error(`Failed to load extensions: ${err}`, 'Extensions')
      );

      // DEV: Load AEC extension directly from source for live development
      import('@aec-ext/index').then((aecExt) => {
        const ext = aecExt.default || aecExt;
        if (ext.onLoad) {
          ext.onLoad();
          console.log('[DEV] AEC extension loaded from source');
        }
      }).catch((err) => {
        console.warn('[DEV] AEC extension not found (optional):', err);
      });
    }
    return () => {
      if (cadApiRef.current) {
        cadApiRef.current.dispose();
        cadApiRef.current = null;
        delete (window as any).cad;
      }
    };
  }, []);

  // Silent auto-check for updates on startup
  useEffect(() => {
    checkForUpdates(true).catch(() => {});
  }, []);

  // Restore persisted settings
  useEffect(() => {
    (async () => {
      const [
        dynamicInput, showLw,
        gridSz, gridVis, snapEn, activeSnps, snapTol,
        trackEn, polarEn, ortho, objTrack, polarAngle,
        whiteBg, boundVis, theme, rotGizmo, axesVis,
      ] = await Promise.all([
        getSetting<boolean>('dynamicInputEnabled', true),
        getSetting<boolean>('showLineweight', false),
        getSetting<number>('gridSize', 10),
        getSetting<boolean>('gridVisible', false),
        getSetting<boolean>('snapEnabled', true),
        getSetting<string[]>('activeSnaps', ['endpoint', 'midpoint', 'center', 'intersection', 'origin']),
        getSetting<number>('snapTolerance', 10),
        getSetting<boolean>('trackingEnabled', true),
        getSetting<boolean>('polarTrackingEnabled', true),
        getSetting<boolean>('orthoMode', false),
        getSetting<boolean>('objectTrackingEnabled', true),
        getSetting<number>('polarAngleIncrement', 45),
        getSetting<boolean>('whiteBackground', true),
        getSetting<boolean>('boundaryVisible', false),
        getSetting<string>('uiTheme', 'default'),
        getSetting<boolean>('showRotationGizmo', true),
        getSetting<boolean>('axesVisible', false),
      ]);
      useAppStore.setState((s: any) => {
        s.dynamicInputEnabled = dynamicInput;
        s.showLineweight = showLw;
        s.gridSize = gridSz;
        s.gridVisible = gridVis;
        s.snapEnabled = snapEn;
        s.activeSnaps = activeSnps;
        s.snapTolerance = snapTol;
        s.trackingEnabled = trackEn;
        s.polarTrackingEnabled = polarEn;
        s.orthoMode = ortho;
        s.objectTrackingEnabled = objTrack;
        s.polarAngleIncrement = polarAngle;
        s.whiteBackground = whiteBg;
        s.boundaryVisible = boundVis;
        s.uiTheme = theme;
        s.showRotationGizmo = rotGizmo;
        s.axesVisible = axesVis;
      });
      // Apply theme to DOM
      document.documentElement.setAttribute('data-theme', theme);
    })();
  }, []);

  // Auto-save: restore on startup, subscribe for ongoing saves
  useEffect(() => {
    restoreAutoSave(useAppStore.setState.bind(useAppStore));
    return startAutoSave(useAppStore.subscribe.bind(useAppStore));
  }, []);

  // Bonsai Sync: start watching for model changes and auto-export IFC
  useEffect(() => {
    return startBonsaiSync();
  }, []);

  // Intercept window close to prompt for unsaved changes across all open documents
  useEffect(() => {
    // Only register window close handler in Tauri (not in browser)
    if (!('__TAURI_INTERNALS__' in window)) return;

    const appWindow = getCurrentWindow();
    const unlisten = appWindow.onCloseRequested(async (event) => {
      const state = useAppStore.getState();
      const { documentOrder, activeDocumentId, switchDocument } = state;

      // Helper: check if a document has unsaved changes
      const isDocModified = (docId: string): boolean => {
        if (docId === activeDocumentId) {
          return useAppStore.getState().isModified;
        }
        const store = getDocumentStoreIfExists(docId);
        return store?.getState().isModified ?? false;
      };

      // Helper: save the currently active document (returns true if saved, false if cancelled)
      const saveActiveDocument = async (): Promise<boolean> => {
        const s = useAppStore.getState();
        let filePath = s.currentFilePath;
        if (!filePath) {
          filePath = await showSaveDialog(s.projectName);
          if (!filePath) return false;
        }
        try {
          const customRegionTypes = s.filledRegionTypes.filter((t: any) => !t.isBuiltIn);
          const project: ProjectFile = {
            version: 3,
            name: s.projectName,
            createdAt: new Date().toISOString(),
            modifiedAt: new Date().toISOString(),
            drawings: s.drawings,
            sheets: s.sheets,
            activeDrawingId: s.activeDrawingId,
            activeSheetId: s.activeSheetId,
            drawingViewports: s.drawingViewports,
            sheetViewports: s.sheetViewports,
            shapes: s.shapes.filter((sh: any) => !sh.id?.startsWith('section-ref-')),
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
          return true;
        } catch {
          return false;
        }
      };

      // Helper: get display name for a document
      const getDocName = (docId: string): string => {
        if (docId === useAppStore.getState().activeDocumentId) {
          return useAppStore.getState().projectName;
        }
        const store = getDocumentStoreIfExists(docId);
        return store?.getState().projectName ?? 'Untitled';
      };

      // Iterate through all open documents and prompt for unsaved changes
      for (const docId of [...documentOrder]) {
        if (!isDocModified(docId)) continue;

        // Switch to the modified document so save operates on its state
        const currentActive = useAppStore.getState().activeDocumentId;
        if (docId !== currentActive) {
          switchDocument(docId);
        }

        const docName = getDocName(docId);
        const result = await promptSaveBeforeClose(docName);

        if (result === 'cancel') {
          event.preventDefault();
          return;
        }
        if (result === 'save') {
          const saved = await saveActiveDocument();
          if (!saved) {
            // User cancelled the save dialog — treat as cancel
            event.preventDefault();
            return;
          }
        }
        // 'discard' — continue to next document
      }

      // All documents handled — allow window to close
    });

    return () => { unlisten.then(fn => fn()); };
  }, []);

  // Disable browser context menu in production
  useEffect(() => {
    if (import.meta.env.PROD) {
      const handleContextMenu = (e: MouseEvent) => {
        e.preventDefault();
      };
      document.addEventListener('contextmenu', handleContextMenu);
      return () => document.removeEventListener('contextmenu', handleContextMenu);
    }
  }, []);

  const {
    printDialogOpen,
    setPrintDialogOpen,
    settingsDialogOpen,
    setSettingsDialogOpen,
    titleBlockEditorOpen,
    setTitleBlockEditorOpen,
    newSheetDialogOpen,
    setNewSheetDialogOpen,
    terminalOpen,
    setTerminalOpen,
    terminalHeight,
    setTerminalHeight,
    activeSheetId,
    editorMode,
    drawingStandardsDialogOpen,
    closeDrawingStandardsDialog,
    patternManagerOpen,
    setPatternManagerOpen,
    regionTypeManagerOpen,
    setRegionTypeManagerOpen,
    findReplaceDialogOpen,
    setFindReplaceDialogOpen,
    feedbackDialogOpen,
    setFeedbackDialogOpen,
    textStyleManagerOpen,
    setTextStyleManagerOpen,
    leftSidebarCollapsed,
    rightSidebarCollapsed,
    toggleLeftSidebar,
    toggleRightSidebar,
    ifcPanelOpen,
    setIfcPanelOpen,
    ifcDashboardVisible,
    pdfUnderlayDialogOpen,
    pdfUnderlayFileName,
    closePdfUnderlayDialog,
    activeRibbonTab,
  } = useAppStore();

  return (
    <div className="flex flex-col h-full w-full bg-cad-bg text-cad-text no-select">
      {/* Menu Bar */}
      <TitleBar onSendFeedback={() => setFeedbackDialogOpen(true)} />

      {/* Ribbon */}
      <Ribbon onOpenAppMenu={openAppMenu} hidden={appMenuOpen} />

      {/* Options Bar (shows when Array or similar commands are active) */}
      <ToolOptionsBar />

      {/* Main Content Area */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left Panel - Navigation (Drawings & Sheets) — completely hidden when IFC tab is active */}
        {activeRibbonTab !== 'ifc' && (
          leftSidebarCollapsed ? (
            <div className="flex flex-col bg-cad-bg border-r border-cad-border" style={{ width: 28 }}>
              <button
                type="button"
                onClick={toggleLeftSidebar}
                className="flex items-center justify-center w-full h-7 hover:bg-cad-hover text-cad-text-dim hover:text-cad-text transition-colors"
                title="Expand left panel"
              >
                <PanelLeftOpen size={16} />
              </button>
            </div>
          ) : (
            <NavigationPanel onCollapse={toggleLeftSidebar} />
          )
        )}

        {/* Center - Canvas + Tabs */}
        <div className="flex-1 flex flex-col overflow-hidden relative">
          <FileTabBar />
          <div className="flex-1 relative overflow-hidden">
            <Canvas />
            {ifcDashboardVisible && <IfcDashboard />}
          </div>
        </div>

        {/* Right Panel - Properties & Layers (hidden when IFC tab is active) */}
        {rightSidebarCollapsed ? (
          <div className="flex flex-col bg-cad-surface border-l border-cad-border" style={{ width: 28 }}>
            <button
              type="button"
              onClick={toggleRightSidebar}
              className="flex items-center justify-center w-full h-7 hover:bg-cad-hover text-cad-text-dim hover:text-cad-text transition-colors"
              title="Expand right panel"
            >
              <PanelRightOpen size={16} />
            </button>
          </div>
        ) : (
          <div
            className="bg-cad-surface border-l border-cad-border flex flex-col overflow-hidden relative"
            style={{ width: rightPanelWidth, minWidth: 180, maxWidth: 500 }}
          >
            {/* Resize handle */}
            <div
              className="absolute top-0 left-0 w-px h-full cursor-col-resize hover:bg-cad-accent z-10"
              onMouseDown={(e) => {
                e.preventDefault();
                isResizingRight.current = true;
                document.body.style.cursor = 'col-resize';
                document.body.style.userSelect = 'none';
              }}
            />
            {/* Collapse button in the panel header area */}
            <div className="flex items-center justify-between px-3 h-7 min-h-[28px] select-none border-b border-cad-border bg-cad-surface">
              <span className="text-xs font-semibold text-cad-text">
                {editorMode === 'sheet' ? 'Sheet Properties' : 'Properties'}
              </span>
              <button
                type="button"
                onClick={toggleRightSidebar}
                className="flex items-center justify-center w-5 h-5 rounded hover:bg-cad-hover text-cad-text-dim hover:text-cad-text transition-colors"
                title="Collapse right panel"
              >
                <PanelRightClose size={14} />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto">
              {editorMode === 'sheet' ? (
                <SheetPropertiesPanel />
              ) : (
                <RightPanelLayout />
              )}
            </div>
          </div>
        )}
      </div>

      {/* Terminal Panel */}
      <TerminalPanel
        isOpen={terminalOpen}
        onClose={() => setTerminalOpen(false)}
        height={terminalHeight}
        onHeightChange={setTerminalHeight}
      />

      {/* IFC Panel */}
      {ifcPanelOpen && (
        <div
          className="flex flex-col border-t border-cad-border bg-cad-bg"
          style={{ height: 280 }}
        >
          {/* IFC Panel Header */}
          <div className="flex items-center px-2 h-7 min-h-[28px] bg-cad-surface border-b border-cad-border select-none flex-shrink-0">
            <span className="text-xs font-semibold text-cad-text">IFC Model</span>
            <span className="text-[10px] text-cad-text-dim ml-2">ISO 16739-1:2018 / IFC4</span>
            <div className="flex-1" />
            <button
              type="button"
              onClick={() => setIfcPanelOpen(false)}
              className="flex items-center justify-center w-5 h-5 rounded hover:bg-cad-hover text-cad-text-dim hover:text-cad-text transition-colors"
              title="Close IFC panel"
            >
              &times;
            </button>
          </div>
          <div className="flex-1 overflow-hidden">
            <IfcPanel />
          </div>
        </div>
      )}

      {/* Bottom Status Bar */}
      <StatusBar />

      {/* Print Dialog */}
      <PrintDialog
        isOpen={printDialogOpen}
        onClose={() => setPrintDialogOpen(false)}
      />

{/* Settings Dialog */}
      <SettingsDialog
        isOpen={settingsDialogOpen}
        onClose={() => setSettingsDialogOpen(false)}
      />

      {/* Title Block Editor Dialog */}
      {activeSheetId && (
        <TitleBlockEditor
          isOpen={titleBlockEditorOpen}
          onClose={() => setTitleBlockEditorOpen(false)}
          sheetId={activeSheetId}
        />
      )}

      {/* App Menu */}
      <AppMenu
        isOpen={appMenuOpen}
        onClose={closeAppMenu}
        onOpenSheetTemplateImport={openSheetTemplateImport}
      />

      {/* Sheet Template Import Dialog */}
      <TitleBlockImportDialog
        isOpen={sheetTemplateImportOpen}
        onClose={() => setSheetTemplateImportOpen(false)}
      />

      {/* New Sheet Dialog */}
      <NewSheetDialog
        isOpen={newSheetDialogOpen}
        onClose={() => setNewSheetDialogOpen(false)}
      />

      {/* Drawing Standards Dialog */}
      <DrawingStandardsDialog
        isOpen={drawingStandardsDialogOpen}
        onClose={closeDrawingStandardsDialog}
      />

      {/* Pattern Manager Dialog */}
      <PatternManagerDialog
        isOpen={patternManagerOpen}
        onClose={() => setPatternManagerOpen(false)}
      />

      {/* Filled Region Type Manager Dialog */}
      <FilledRegionTypeManager
        isOpen={regionTypeManagerOpen}
        onClose={() => setRegionTypeManagerOpen(false)}
      />

      {/* Text Style Manager Dialog */}
      <TextStyleManager
        isOpen={textStyleManagerOpen}
        onClose={() => setTextStyleManagerOpen(false)}
      />

      {/* Find & Replace Dialog */}
      <FindReplaceDialog
        isOpen={findReplaceDialogOpen}
        onClose={() => setFindReplaceDialogOpen(false)}
      />

      {/* Feedback Dialog */}
      <FeedbackDialog
        isOpen={feedbackDialogOpen}
        onClose={() => setFeedbackDialogOpen(false)}
      />

      {/* PDF Underlay Dialog */}
      <PdfUnderlayDialog
        isOpen={pdfUnderlayDialogOpen}
        onClose={closePdfUnderlayDialog}
        pdfData={getPdfUnderlayData()}
        fileName={pdfUnderlayFileName}
        onPlace={async (pageNumber) => {
          // Capture data before closing (close sets cache to null)
          const data = getPdfUnderlayData();
          const fileName = pdfUnderlayFileName;
          if (!data) return;
          closePdfUnderlayDialog();
          try {
            const state = useAppStore.getState();
            const { activeLayerId: layerId, activeDrawingId: drawingId, viewport: vp, canvasSize } = state;
            const result = await renderPdfPageForUnderlay(data, pageNumber, 150);
            // Scale PDF from mm to drawing units (drawings use mm internally)
            // A typical A3 plan printed at 1:100 represents 42000x29700mm in real world
            // The PDF physical size is in mm, but the drawing it represents is at scale
            // Use drawingScale to convert: if drawingScale=0.01 (1:100), multiply by 100
            const drawingScale = state.drawingScale || 0.01;
            const scaleFactor = 1 / drawingScale; // e.g. 100 for 1:100
            const worldW = result.worldWidth * scaleFactor;
            const worldH = result.worldHeight * scaleFactor;
            // Center on current viewport
            const viewCenterX = (-vp.offsetX + canvasSize.width / 2) / vp.zoom;
            const viewCenterY = (-vp.offsetY + canvasSize.height / 2) / vp.zoom;
            const underlayShape: ImageShape = {
              id: crypto.randomUUID(),
              type: 'image',
              layerId,
              drawingId,
              style: { strokeColor: '#ffffff', strokeWidth: 1, lineStyle: 'solid' },
              visible: true,
              locked: false,
              position: {
                x: viewCenterX - worldW / 2,
                y: viewCenterY - worldH / 2,
              },
              width: worldW,
              height: worldH,
              rotation: 0,
              imageData: result.dataUrl,
              originalWidth: result.pixelWidth,
              originalHeight: result.pixelHeight,
              opacity: 0.5,
              maintainAspectRatio: true,
              isUnderlay: true,
              sourceFileName: fileName,
            };
            useAppStore.getState().addShapes([underlayShape]);
          } catch (err) {
            console.error('Failed to render PDF page for underlay:', err);
          }
        }}
      />

      {/* Extension components */}
      <ExtensionAutomations />
      <ExtensionDialogs />
    </div>
  );
}

export default App;
