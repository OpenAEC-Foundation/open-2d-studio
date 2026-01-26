import { useEffect } from 'react';
import { MenuBar } from './components/MenuBar/MenuBar';
import { Ribbon } from './components/Ribbon/Ribbon';
import { Canvas } from './components/Canvas/Canvas';
import { PropertiesPanel } from './components/Panels/PropertiesPanel';
import { LayersPanel } from './components/Panels/LayersPanel';
import { StatusBar } from './components/StatusBar/StatusBar';
import { CommandLine } from './components/CommandLine/CommandLine';
import { PrintDialog } from './components/PrintDialog/PrintDialog';
import { AboutDialog } from './components/AboutDialog/AboutDialog';
import { SnapSettingsDialog } from './components/SnapSettingsDialog/SnapSettingsDialog';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import { useGlobalKeyboard } from './hooks/useGlobalKeyboard';
import { useAppStore } from './state/appStore';

function App() {
  // Initialize keyboard shortcuts
  useKeyboardShortcuts();
  useGlobalKeyboard();

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

  const { printDialogOpen, setPrintDialogOpen, aboutDialogOpen, setAboutDialogOpen, snapSettingsOpen, setSnapSettingsOpen } = useAppStore();

  return (
    <div className="flex flex-col h-full w-full bg-cad-bg text-cad-text no-select">
      {/* Menu Bar */}
      <MenuBar />

      {/* Ribbon */}
      <Ribbon />

      {/* Main Content Area */}
      <div className="flex flex-1 overflow-hidden">
        {/* Center - Canvas */}
        <div className="flex-1 flex flex-col overflow-hidden">
          <Canvas />
          <CommandLine />
        </div>

        {/* Right Panel - Properties & Layers */}
        <div className="w-64 bg-cad-surface border-l border-cad-border flex flex-col">
          <PropertiesPanel />
          <LayersPanel />
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
    </div>
  );
}

export default App;
