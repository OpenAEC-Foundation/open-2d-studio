import { useState, useRef, useEffect, useCallback, memo } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { useAppStore } from '../../state/appStore';
import {
  showOpenDialog,
  showSaveDialog,
  showExportDialog,
  readProjectFile,
  writeProjectFile,
  exportToSVG,
  exportToDXF,
  confirmUnsavedChanges,
  showError,
  showInfo,
  type ProjectFile,
} from '../../services/fileService';
import { writeTextFile } from '@tauri-apps/plugin-fs';

type MenuItem = {
  label: string;
  shortcut?: string;
  onClick?: () => void;
  disabled?: boolean;
  separator?: false;
} | {
  separator: true;
};

interface MenuProps {
  label: string;
  items: MenuItem[];
  isOpen: boolean;
  onOpen: () => void;
  onClose: () => void;
  menuBarHovered: boolean;
}

function Menu({ label, items, isOpen, onOpen, onClose, menuBarHovered }: MenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen, onClose]);

  return (
    <div className="relative" ref={menuRef}>
      <button
        className={`px-3 py-1 text-sm hover:bg-cad-border rounded transition-colors cursor-default ${
          isOpen ? 'bg-cad-border' : ''
        }`}
        onClick={() => (isOpen ? onClose() : onOpen())}
        onMouseEnter={() => menuBarHovered && onOpen()}
      >
        {label}
      </button>

      {isOpen && (
        <div className="absolute top-full left-0 mt-1 bg-cad-surface border border-cad-border rounded shadow-lg min-w-48 py-1 z-50">
          {items.map((item, index) =>
            item.separator ? (
              <div key={index} className="h-px bg-cad-border my-1" />
            ) : (
              <button
                key={index}
                className={`w-full px-4 py-1.5 text-sm text-left flex justify-between items-center hover:bg-cad-border transition-colors ${
                  item.disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-default'
                }`}
                onClick={() => {
                  if (!item.disabled && item.onClick) {
                    item.onClick();
                    onClose();
                  }
                }}
                disabled={item.disabled}
              >
                <span>{item.label}</span>
                {item.shortcut && (
                  <span className="text-cad-text-dim text-xs ml-4">{item.shortcut}</span>
                )}
              </button>
            )
          )}
        </div>
      )}
    </div>
  );
}

// Detect platform
type Platform = 'windows' | 'linux' | 'macos';

function getPlatform(): Platform {
  const userAgent = navigator.userAgent.toLowerCase();
  if (userAgent.includes('win')) return 'windows';
  if (userAgent.includes('mac')) return 'macos';
  return 'linux';
}

// Windows-style window controls
function WindowsControls({
  onMinimize,
  onMaximize,
  onClose,
  isMaximized
}: {
  onMinimize: () => void;
  onMaximize: () => void;
  onClose: () => void;
  isMaximized: boolean;
}) {
  return (
    <div className="flex items-center h-full">
      <button
        onClick={onMinimize}
        className="w-[46px] h-full flex items-center justify-center hover:bg-[#3d3d3d] transition-colors cursor-default"
        title="Minimize"
      >
        <svg width="10" height="1" viewBox="0 0 10 1" fill="currentColor">
          <rect width="10" height="1" />
        </svg>
      </button>
      <button
        onClick={onMaximize}
        className="w-[46px] h-full flex items-center justify-center hover:bg-[#3d3d3d] transition-colors cursor-default"
        title={isMaximized ? 'Restore Down' : 'Maximize'}
      >
        {isMaximized ? (
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1">
            <rect x="2" y="0.5" width="7" height="7" />
            <polyline points="0.5,2.5 0.5,9.5 7.5,9.5 7.5,7.5" />
          </svg>
        ) : (
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1">
            <rect x="0.5" y="0.5" width="9" height="9" />
          </svg>
        )}
      </button>
      <button
        onClick={onClose}
        className="w-[46px] h-full flex items-center justify-center hover:bg-[#c42b1c] transition-colors group cursor-default"
        title="Close"
      >
        <svg width="10" height="10" viewBox="0 0 10 10" stroke="currentColor" strokeWidth="1.2" className="group-hover:stroke-white">
          <line x1="0" y1="0" x2="10" y2="10" />
          <line x1="10" y1="0" x2="0" y2="10" />
        </svg>
      </button>
    </div>
  );
}

// Linux/GNOME-style window controls (circular buttons)
function LinuxControls({
  onMinimize,
  onMaximize,
  onClose,
  isMaximized
}: {
  onMinimize: () => void;
  onMaximize: () => void;
  onClose: () => void;
  isMaximized: boolean;
}) {
  return (
    <div className="flex items-center h-full gap-2 px-3">
      {/* Minimize - yellow/amber */}
      <button
        onClick={onMinimize}
        className="w-3 h-3 rounded-full bg-[#f5c211] hover:bg-[#d9a900] transition-colors flex items-center justify-center group cursor-default"
        title="Minimize"
      >
        <svg width="6" height="1" viewBox="0 0 6 1" className="opacity-0 group-hover:opacity-100 transition-opacity">
          <rect width="6" height="1" fill="#000" fillOpacity="0.6" />
        </svg>
      </button>
      {/* Maximize - green */}
      <button
        onClick={onMaximize}
        className="w-3 h-3 rounded-full bg-[#2ecc71] hover:bg-[#27ae60] transition-colors flex items-center justify-center group cursor-default"
        title={isMaximized ? 'Restore' : 'Maximize'}
      >
        {isMaximized ? (
          <svg width="6" height="6" viewBox="0 0 6 6" className="opacity-0 group-hover:opacity-100 transition-opacity">
            <rect x="0.5" y="2" width="3" height="3" fill="none" stroke="#000" strokeOpacity="0.6" strokeWidth="1" />
            <polyline points="2,2 2,0.5 5.5,0.5 5.5,4 4,4" fill="none" stroke="#000" strokeOpacity="0.6" strokeWidth="1" />
          </svg>
        ) : (
          <svg width="6" height="6" viewBox="0 0 6 6" className="opacity-0 group-hover:opacity-100 transition-opacity">
            <rect x="0.5" y="0.5" width="5" height="5" fill="none" stroke="#000" strokeOpacity="0.6" strokeWidth="1" />
          </svg>
        )}
      </button>
      {/* Close - red/orange */}
      <button
        onClick={onClose}
        className="w-3 h-3 rounded-full bg-[#e95420] hover:bg-[#c44117] transition-colors flex items-center justify-center group cursor-default"
        title="Close"
      >
        <svg width="6" height="6" viewBox="0 0 6 6" className="opacity-0 group-hover:opacity-100 transition-opacity">
          <line x1="1" y1="1" x2="5" y2="5" stroke="#000" strokeOpacity="0.6" strokeWidth="1" />
          <line x1="5" y1="1" x2="1" y2="5" stroke="#000" strokeOpacity="0.6" strokeWidth="1" />
        </svg>
      </button>
    </div>
  );
}

function WindowControls() {
  const [isMaximized, setIsMaximized] = useState(false);
  const [platform] = useState<Platform>(getPlatform);
  const appWindow = getCurrentWindow();

  useEffect(() => {
    // Check initial maximized state
    appWindow.isMaximized().then(setIsMaximized);

    // Listen for resize events to update maximized state
    const unlisten = appWindow.onResized(() => {
      appWindow.isMaximized().then(setIsMaximized);
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, [appWindow]);

  const handleMinimize = () => appWindow.minimize();
  const handleMaximize = () => appWindow.toggleMaximize();
  const handleClose = () => appWindow.close();

  const controlProps = {
    onMinimize: handleMinimize,
    onMaximize: handleMaximize,
    onClose: handleClose,
    isMaximized,
  };

  // Use Linux-style for Linux, Windows-style for Windows and macOS
  if (platform === 'linux') {
    return <LinuxControls {...controlProps} />;
  }

  return <WindowsControls {...controlProps} />;
}

export const MenuBar = memo(function MenuBar() {
  const [openMenu, setOpenMenu] = useState<string | null>(null);

  // Only subscribe to render-affecting state
  const canUndo = useAppStore(s => s.canUndo());
  const canRedo = useAppStore(s => s.canRedo());
  const isModified = useAppStore(s => s.isModified);
  const projectName = useAppStore(s => s.projectName);

  // Actions (stable references)
  const undo = useAppStore(s => s.undo);
  const redo = useAppStore(s => s.redo);
  const setPrintDialogOpen = useAppStore(s => s.setPrintDialogOpen);
  const newProject = useAppStore(s => s.newProject);
  const loadProject = useAppStore(s => s.loadProject);
  const setFilePath = useAppStore(s => s.setFilePath);
  const setProjectName = useAppStore(s => s.setProjectName);
  const setModified = useAppStore(s => s.setModified);

  // File operations
  const handleNew = useCallback(async () => {
    if (useAppStore.getState().isModified) {
      const proceed = await confirmUnsavedChanges();
      if (!proceed) return;
    }
    newProject();
  }, [newProject]);

  const handleOpenFile = useCallback(async () => {
    if (useAppStore.getState().isModified) {
      const proceed = await confirmUnsavedChanges();
      if (!proceed) return;
    }

    const filePath = await showOpenDialog();
    if (!filePath) return;

    try {
      const project = await readProjectFile(filePath);
      loadProject(
        {
          shapes: project.shapes,
          layers: project.layers,
          activeLayerId: project.activeLayerId,
          settings: project.settings,
          // V2 fields
          drawings: project.drawings,
          sheets: project.sheets,
          activeDrawingId: project.activeDrawingId,
          activeSheetId: project.activeSheetId,
          drawingViewports: project.drawingViewports,
        },
        filePath,
        project.name
      );
    } catch (err) {
      await showError(`Failed to open file: ${err}`);
    }
  }, [isModified, loadProject]);

  const handleSave = useCallback(async () => {
    const s = useAppStore.getState();
    let filePath = s.currentFilePath;

    if (!filePath) {
      filePath = await showSaveDialog(s.projectName);
      if (!filePath) return;
    }

    try {
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
        shapes: s.shapes,
        layers: s.layers,
        activeLayerId: s.activeLayerId,
        settings: {
          gridSize: s.gridSize,
          gridVisible: s.gridVisible,
          snapEnabled: s.snapEnabled,
        },
      };

      await writeProjectFile(filePath, project);
      setFilePath(filePath);
      setModified(false);

      const fileName = filePath.split(/[/\\]/).pop()?.replace('.o2d', '') || 'Untitled';
      setProjectName(fileName);
    } catch (err) {
      await showError(`Failed to save file: ${err}`);
    }
  }, [setFilePath, setModified, setProjectName]);

  const handleSaveAs = useCallback(async () => {
    const s = useAppStore.getState();
    const filePath = await showSaveDialog(s.projectName);
    if (!filePath) return;

    try {
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
        shapes: s.shapes,
        layers: s.layers,
        activeLayerId: s.activeLayerId,
        settings: {
          gridSize: s.gridSize,
          gridVisible: s.gridVisible,
          snapEnabled: s.snapEnabled,
        },
      };

      await writeProjectFile(filePath, project);
      setFilePath(filePath);
      setModified(false);

      const fileName = filePath.split(/[/\\]/).pop()?.replace('.o2d', '') || 'Untitled';
      setProjectName(fileName);
    } catch (err) {
      await showError(`Failed to save file: ${err}`);
    }
  }, [setFilePath, setModified, setProjectName]);

  const handleExport = useCallback(async () => {
    const s = useAppStore.getState();
    if (s.shapes.length === 0) {
      await showInfo('Nothing to export. Draw some shapes first.');
      return;
    }

    const filePath = await showExportDialog('svg', s.projectName);
    if (!filePath) return;

    try {
      const extension = filePath.split('.').pop()?.toLowerCase();
      let content: string;

      if (extension === 'dxf') {
        content = exportToDXF(s.shapes);
      } else if (extension === 'json') {
        content = JSON.stringify({ shapes: s.shapes, layers: s.layers }, null, 2);
      } else {
        content = exportToSVG(s.shapes);
      }

      await writeTextFile(filePath, content);
      await showInfo(`Exported successfully to ${filePath}`);
    } catch (err) {
      await showError(`Failed to export: ${err}`);
    }
  }, []);

  const handleMenuOpen = (menu: string) => setOpenMenu(menu);
  const handleMenuClose = () => setOpenMenu(null);
  const menuBarHovered = openMenu !== null;

  const fileMenu: MenuItem[] = [
    { label: 'New', shortcut: 'Ctrl+N', onClick: handleNew },
    { label: 'Open...', shortcut: 'Ctrl+O', onClick: handleOpenFile },
    { separator: true },
    { label: 'Save', shortcut: 'Ctrl+S', onClick: handleSave },
    { label: 'Save As...', shortcut: 'Ctrl+Shift+S', onClick: handleSaveAs },
    { separator: true },
    { label: 'Export...', onClick: handleExport },
    { separator: true },
    { label: 'Print...', shortcut: 'Ctrl+P', onClick: () => setPrintDialogOpen(true) },
    { separator: true },
    { label: 'Exit', shortcut: 'Alt+F4', onClick: () => getCurrentWindow().close() },
  ];

  return (
    <div className="h-8 bg-cad-surface border-b border-cad-border flex items-center select-none">
      {/* Menu items */}
      <div className="flex items-center px-2 gap-1">
        <Menu
          label="File"
          items={fileMenu}
          isOpen={openMenu === 'file'}
          onOpen={() => handleMenuOpen('file')}
          onClose={handleMenuClose}
          menuBarHovered={menuBarHovered}
        />
      </div>

      {/* Quick Access Toolbar */}
      <div className="flex items-center gap-0.5 px-2 border-l border-cad-border ml-1">
        <button
          onClick={handleSave}
          className="p-1.5 rounded hover:bg-cad-border transition-colors text-cad-text-dim hover:text-cad-text cursor-default"
          title="Save (Ctrl+S)"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/>
            <polyline points="17 21 17 13 7 13 7 21"/>
            <polyline points="7 3 7 8 15 8"/>
          </svg>
        </button>
        <button
          onClick={undo}
          disabled={!canUndo}
          className={`p-1.5 rounded transition-colors cursor-default ${canUndo ? 'hover:bg-cad-border text-cad-text-dim hover:text-cad-text' : 'text-cad-text-dim opacity-40 !cursor-not-allowed'}`}
          title="Undo (Ctrl+Z)"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 7v6h6"/>
            <path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13"/>
          </svg>
        </button>
        <button
          onClick={redo}
          disabled={!canRedo}
          className={`p-1.5 rounded transition-colors cursor-default ${canRedo ? 'hover:bg-cad-border text-cad-text-dim hover:text-cad-text' : 'text-cad-text-dim opacity-40 !cursor-not-allowed'}`}
          title="Redo (Ctrl+Y)"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 7v6h-6"/>
            <path d="M3 17a9 9 0 0 1 9-9 9 9 0 0 1 6 2.3l3 2.7"/>
          </svg>
        </button>
      </div>

      {/* Draggable area with app title */}
      <div
        data-tauri-drag-region
        className="flex-1 h-full flex items-center justify-center cursor-default"
        onDoubleClick={() => getCurrentWindow().toggleMaximize()}
      >
        <span className="text-cad-text-dim text-sm font-medium pointer-events-none">
          {isModified ? '* ' : ''}{projectName} - Open 2D Studio
        </span>
      </div>

      {/* Window controls */}
      <WindowControls />
    </div>
  );
});
