import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PanelLeftOpen, PanelRightOpen, PanelRightClose } from 'lucide-react';
import { getSetting, setSetting } from './utils/settings';
// Layout components
import { MenuBar } from './components/layout/MenuBar/MenuBar';
import { Ribbon } from './components/layout/Ribbon/Ribbon';
import { StatusBar } from './components/layout/StatusBar/StatusBar';
import { FileTabBar } from './components/layout/FileTabBar/FileTabBar';

// Canvas components
import { Canvas } from './components/canvas/Canvas';
import { OptionsBar } from './components/canvas/OptionsBar/OptionsBar';
import { BimViewer } from './components/canvas/BimViewer';

// Panel components
import { NavigationPanel } from './components/panels/NavigationPanel';
import { SheetPropertiesPanel } from './components/panels/SheetPropertiesPanel';
import { RightPanelLayout } from './components/panels/RightPanelLayout';

// Dialog components
import { PrintDialog } from './components/dialogs/PrintDialog/PrintDialog';
import { SettingsDialog } from './components/dialogs/SettingsDialog/SettingsDialog';
import { Backstage, type BackstageView } from './components/dialogs/Backstage/Backstage';
import { TitleBlockEditor } from './components/dialogs/TitleBlockEditor';
import { TitleBlockImportDialog } from './components/dialogs/TitleBlockImportDialog';
import { NewSheetDialog } from './components/dialogs/NewSheetDialog';
import { SectionDialog } from './components/dialogs/SectionDialog';
import { BeamDialog } from './components/dialogs/BeamDialog';
import { GridlineDialog } from './components/dialogs/GridlineDialog';
import { WallDialog } from './components/dialogs/WallDialog';
import { PlateSystemDialog } from './components/dialogs/PlateSystemDialog/PlateSystemDialog';
import { DrawingStandardsDialog } from './components/dialogs/DrawingStandardsDialog';
import { MaterialsDialog } from './components/dialogs/MaterialsDialog';
import { WallTypesDialog } from './components/dialogs/WallTypesDialog';
import { WallSystemDialog } from './components/dialogs/WallSystemDialog/WallSystemDialog';
import { FindReplaceDialog } from './components/dialogs/FindReplaceDialog';
import { ProjectStructureDialog } from './components/dialogs/ProjectStructureDialog';
import { PileSymbolsDialog } from './components/dialogs/PileSymbolsDialog';

// Editor components
import { PatternManagerDialog } from './components/editors/PatternManager';
import { FilledRegionTypeManager } from './components/editors/FilledRegionTypeManager';
import { TextStyleManager } from './components/editors/TextStyleManager/TextStyleManager';
import { TerminalPanel } from './components/editors/TerminalPanel';
import { IfcPanel } from './components/panels/IfcPanel';
import { IfcDashboard } from './components/panels/IfcDashboard';
import { useIfcAutoRegenerate } from './hooks/useIfcAutoRegenerate';
import { useSpaceAutoUpdate } from './hooks/useSpaceAutoUpdate';
import { usePileAutoNumbering } from './hooks/usePileAutoNumbering';
import { usePileAutoDimensioning } from './hooks/usePileAutoDimensioning';
import { usePileAutoPuntniveau } from './hooks/usePileAutoPuntniveau';
import { useKeyboardShortcuts } from './hooks/keyboard/useKeyboardShortcuts';
import { useGlobalKeyboard } from './hooks/keyboard/useGlobalKeyboard';
import { useAppStore } from './state/appStore';
import { getDocumentStoreIfExists } from './state/documentStore';
import { CadApi } from './api';
import { loadAllExtensions } from './extensions';
import { logger } from './services/log/logService';
import { checkForUpdates } from './services/updater/updaterService';
import { startAutoSave, restoreAutoSave } from './services/autosave/autoSaveService';
import { startBonsaiSync } from './services/bonsaiSync';
import { getCurrentWindow } from '@tauri-apps/api/window';
import {
  promptSaveBeforeClose,
  showSaveDialog,
  writeProjectFile,
  type ProjectFile,
} from './services/file/fileService';

function App() {
  // Initialize keyboard shortcuts
  useKeyboardShortcuts();
  useGlobalKeyboard();

  // IFC auto-regeneration (watches shapes and regenerates with 500ms debounce)
  useIfcAutoRegenerate();

  // Space auto-update (recalculates space contours when walls change)
  useSpaceAutoUpdate();

  // Pile auto-numbering (renumbers piles top-left to bottom-right when piles change)
  usePileAutoNumbering();

  // Pile auto-dimensioning (creates dimension lines between piles when enabled)
  usePileAutoDimensioning();

  // Pile auto-puntniveau (assigns puntniveauNAP to piles inside puntniveau polygons)
  usePileAutoPuntniveau();

  // Apply theme on mount
  const uiTheme = useAppStore(s => s.uiTheme);
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', uiTheme);
  }, [uiTheme]);

  // Backstage view
  const [backstageOpen, setBackstageOpen] = useState(false);
  const [backstageInitialView, setBackstageInitialView] = useState<BackstageView | undefined>();
  const openBackstage = useCallback(() => setBackstageOpen(true), []);
  const closeBackstage = useCallback(() => { setBackstageOpen(false); setBackstageInitialView(undefined); }, []);
  const onSendFeedback = useCallback(() => { setBackstageInitialView('feedback'); setBackstageOpen(true); }, []);

  // Sheet Template Import dialog (opened from Backstage > Import)
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
    sectionDialogOpen,
    closeSectionDialog,
    setPendingSection,
    beamDialogOpen,
    beamDialogInitialViewMode,
    closeBeamDialog,
    setPendingBeam,
    gridlineDialogOpen,
    closeGridlineDialog,
    setPendingGridline,
    pileSymbolsDialogOpen,
    closePileSymbolsDialog,
    wallDialogOpen,
    closeWallDialog,
    setPendingWall,
    setLastUsedWallTypeId,
    plateSystemDialogOpen,
    closePlateSystemDialog,
    setPendingPlateSystem,
    drawingStandardsDialogOpen,
    closeDrawingStandardsDialog,
    materialsDialogOpen,
    closeMaterialsDialog,
    wallTypesDialogOpen,
    closeWallTypesDialog,
    wallSystemDialogOpen,
    closeWallSystemDialog,
    setActiveTool,
    patternManagerOpen,
    setPatternManagerOpen,
    regionTypeManagerOpen,
    setRegionTypeManagerOpen,
    findReplaceDialogOpen,
    setFindReplaceDialogOpen,
    textStyleManagerOpen,
    setTextStyleManagerOpen,
    leftSidebarCollapsed,
    rightSidebarCollapsed,
    toggleLeftSidebar,
    toggleRightSidebar,
    ifcPanelOpen,
    setIfcPanelOpen,
    ifcDashboardVisible,
    show3DView,
    projectStructureDialogOpen,
    closeProjectStructureDialog,
  } = useAppStore();

  // Compute default name for new plate systems: "Plate System 1", "Plate System 2", etc.
  const shapes = useAppStore(s => s.shapes);
  const nextPlateSystemName = useMemo(() => {
    const existingPlateSystems = shapes.filter(s => s.type === 'plate-system');
    let maxNum = 0;
    for (const ps of existingPlateSystems) {
      const psShape = ps as import('./types/geometry').PlateSystemShape;
      const match = psShape.name?.match(/^Plate System (\d+)$/);
      if (match) {
        const num = parseInt(match[1], 10);
        if (num > maxNum) maxNum = num;
      }
    }
    return `Plate System ${maxNum + 1}`;
  }, [shapes]);

  return (
    <div className="flex flex-col h-full w-full bg-cad-bg text-cad-text no-select">
      {/* Menu Bar */}
      <MenuBar onSendFeedback={onSendFeedback} />

      {/* Ribbon */}
      <Ribbon onOpenBackstage={openBackstage} />

      {/* Options Bar (shows when Array or similar commands are active) */}
      <OptionsBar />

      {/* Main Content Area */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left Panel - Navigation (Drawings & Sheets) */}
        {leftSidebarCollapsed ? (
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
        )}

        {/* Center - Canvas + Tabs */}
        <div className="flex-1 flex flex-col overflow-hidden relative">
          <FileTabBar />
          <div className="flex-1 relative overflow-hidden">
            <Canvas />
            {ifcDashboardVisible && <IfcDashboard />}
            {show3DView && <BimViewer />}
          </div>
        </div>

        {/* Right Panel - Properties & Layers (or Sheet Properties in sheet mode) */}
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

      {/* Backstage View */}
      <Backstage
        isOpen={backstageOpen}
        onClose={closeBackstage}
        initialView={backstageInitialView}
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

      {/* Section Dialog - for inserting structural profiles */}
      <SectionDialog
        isOpen={sectionDialogOpen}
        onClose={closeSectionDialog}
        onInsert={(profileType, parameters, presetId, rotation) => {
          // Set pending section - user will click on canvas to place it
          setPendingSection({
            profileType,
            parameters,
            presetId,
            rotation: rotation ? rotation * (Math.PI / 180) : 0,
          });
          closeSectionDialog();
        }}
      />

      {/* Column/Beam Dialog - for inserting columns or drawing structural beams */}
      <BeamDialog
        isOpen={beamDialogOpen}
        onClose={closeBeamDialog}
        initialViewMode={beamDialogInitialViewMode}
        onDraw={(profileType, parameters, flangeWidth, options) => {
          setPendingBeam({
            profileType,
            parameters,
            flangeWidth,
            presetId: options.presetId,
            presetName: options.presetName,
            material: options.material,
            justification: options.justification,
            showCenterline: options.showCenterline,
            showLabel: options.showLabel,
            continueDrawing: true,
            viewMode: options.viewMode,
            shapeMode: 'line',
          });
          setActiveTool('beam');
          closeBeamDialog();
        }}
        onInsertSection={(profileType, parameters, presetId, rotation) => {
          setPendingSection({
            profileType,
            parameters,
            presetId,
            rotation: rotation ? rotation * (Math.PI / 180) : 0,
          });
          closeBeamDialog();
        }}
      />

      {/* Gridline Dialog - for drawing structural grid lines */}
      <GridlineDialog
        isOpen={gridlineDialogOpen}
        onClose={closeGridlineDialog}
        onDraw={(label, bubblePosition, bubbleRadius, fontSize) => {
          setPendingGridline({ label, bubblePosition, bubbleRadius, fontSize });
          setActiveTool('gridline');
          closeGridlineDialog();
        }}
      />

{/* Pile Symbols Dialog - configure pile symbol order */}
      <PileSymbolsDialog
        isOpen={pileSymbolsDialogOpen}
        onClose={closePileSymbolsDialog}
      />

      {/* Wall Dialog - for drawing structural walls */}
      <WallDialog
        isOpen={wallDialogOpen}
        onClose={closeWallDialog}
        onDraw={(thickness, options) => {
          setPendingWall({
            thickness,
            wallTypeId: options.wallTypeId,
            wallSystemId: options.wallSystemId,
            justification: options.justification,
            showCenterline: options.showCenterline,
            startCap: options.startCap,
            endCap: options.endCap,
            continueDrawing: true,
            shapeMode: 'line',
            spaceBounding: true,
          });
          if (options.wallTypeId) {
            setLastUsedWallTypeId(options.wallTypeId);
          }
          setActiveTool('wall');
          closeWallDialog();
        }}
      />

      {/* Plate System Dialog - for drawing plate system assemblies */}
      <PlateSystemDialog
        isOpen={plateSystemDialogOpen}
        onClose={closePlateSystemDialog}
        defaultName={nextPlateSystemName}
        onDraw={(settings) => {
          setPendingPlateSystem({
            systemType: settings.systemType,
            mainWidth: settings.mainWidth,
            mainHeight: settings.mainHeight,
            mainSpacing: settings.mainSpacing,
            mainDirection: settings.mainDirection,
            mainMaterial: settings.mainMaterial,
            mainProfileId: settings.mainProfileId,
            edgeWidth: settings.edgeWidth,
            edgeHeight: settings.edgeHeight,
            edgeMaterial: settings.edgeMaterial,
            edgeProfileId: settings.edgeProfileId,
            layers: settings.layers,
            name: settings.name,
            shapeMode: 'line',
          });
          setActiveTool('plate-system');
          closePlateSystemDialog();
        }}
      />

      {/* Drawing Standards Dialog */}
      <DrawingStandardsDialog
        isOpen={drawingStandardsDialogOpen}
        onClose={closeDrawingStandardsDialog}
      />

      {/* Materials Dialog */}
      <MaterialsDialog
        isOpen={materialsDialogOpen}
        onClose={closeMaterialsDialog}
      />

      {/* IfcTypes Dialog (Wall Types + Slab Types) */}
      <WallTypesDialog
        isOpen={wallTypesDialogOpen}
        onClose={closeWallTypesDialog}
      />

      {/* Wall System Dialog (multi-layered wall assemblies) */}
      <WallSystemDialog
        isOpen={wallSystemDialogOpen}
        onClose={closeWallSystemDialog}
      />

      {/* Project Structure Dialog */}
      <ProjectStructureDialog
        isOpen={projectStructureDialogOpen}
        onClose={closeProjectStructureDialog}
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
    </div>
  );
}

export default App;
