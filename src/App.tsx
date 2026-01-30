import { useEffect, useRef } from 'react';
import { MenuBar } from './components/MenuBar/MenuBar';
import { Ribbon } from './components/Ribbon/Ribbon';
import { Canvas } from './components/Canvas/Canvas';
import { NavigationPanel } from './components/NavigationPanel';
import { ToolPalette } from './components/ToolPalette/ToolPalette';
import { SheetPropertiesPanel } from './components/Panels/SheetPropertiesPanel';
import { RightPanelLayout } from './components/Panels/RightPanelLayout';
import { StatusBar } from './components/StatusBar/StatusBar';
import { CommandLine } from './components/CommandLine/CommandLine';
import { PrintDialog } from './components/PrintDialog/PrintDialog';
import { AboutDialog } from './components/AboutDialog/AboutDialog';
import { SnapSettingsDialog } from './components/SnapSettingsDialog/SnapSettingsDialog';
import { TitleBlockEditor } from './components/TitleBlockEditor';
import { NewSheetDialog } from './components/NewSheetDialog';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import { useGlobalKeyboard } from './hooks/useGlobalKeyboard';
import { useAppStore } from './state/appStore';
import { CadApi } from './api';

function App() {
  // Initialize keyboard shortcuts
  useKeyboardShortcuts();
  useGlobalKeyboard();

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
    }
    return () => {
      if (cadApiRef.current) {
        cadApiRef.current.dispose();
        cadApiRef.current = null;
        delete (window as any).cad;
      }
    };
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
    aboutDialogOpen,
    setAboutDialogOpen,
    snapSettingsOpen,
    setSnapSettingsOpen,
    titleBlockEditorOpen,
    setTitleBlockEditorOpen,
    newSheetDialogOpen,
    setNewSheetDialogOpen,
    activeSheetId,
    editorMode,
  } = useAppStore();

  return (
    <div className="flex flex-col h-full w-full bg-cad-bg text-cad-text no-select">
      {/* Menu Bar */}
      <MenuBar />

      {/* Ribbon */}
      <Ribbon />

      {/* Main Content Area */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left Panel - Navigation (Drawings & Sheets) */}
        <NavigationPanel />

        {/* Tool Palette */}
        <ToolPalette />

        {/* Center - Canvas */}
        <div className="flex-1 flex flex-col overflow-hidden">
          <Canvas />
          <CommandLine />
        </div>

        {/* Right Panel - Properties & Layers (or Sheet Properties in sheet mode) */}
        <div className="w-64 bg-cad-surface border-l border-cad-border flex flex-col overflow-hidden">
          {editorMode === 'sheet' ? (
            <SheetPropertiesPanel />
          ) : (
            <RightPanelLayout />
          )}
        </div>
      </div>

      {/* Bottom Status Bar */}
      <StatusBar />

      {/* Print Dialog */}
      <PrintDialog
        isOpen={printDialogOpen}
        onClose={() => setPrintDialogOpen(false)}
      />

      {/* About Dialog */}
      <AboutDialog
        isOpen={aboutDialogOpen}
        onClose={() => setAboutDialogOpen(false)}
      />

      {/* Snap Settings Dialog */}
      <SnapSettingsDialog
        isOpen={snapSettingsOpen}
        onClose={() => setSnapSettingsOpen(false)}
      />

      {/* Title Block Editor Dialog */}
      {activeSheetId && (
        <TitleBlockEditor
          isOpen={titleBlockEditorOpen}
          onClose={() => setTitleBlockEditorOpen(false)}
          sheetId={activeSheetId}
        />
      )}

      {/* New Sheet Dialog */}
      <NewSheetDialog
        isOpen={newSheetDialogOpen}
        onClose={() => setNewSheetDialogOpen(false)}
      />
    </div>
  );
}

export default App;
