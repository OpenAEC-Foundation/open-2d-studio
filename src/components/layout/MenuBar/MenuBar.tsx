import { useState, useRef, useEffect, useCallback, useMemo, memo } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { getVersion } from '@tauri-apps/api/app';
import {
  MousePointer2,
  Hand,
  ZoomIn,
  ZoomOut,
  Maximize,
  Grid3X3,
  Trash2,
  ChevronDown,
  Check,
} from 'lucide-react';
import { useAppStore } from '../../../state/appStore';
import { useFileOperations } from '../../../hooks/file/useFileOperations';

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

  // Tauri window API is only available inside a Tauri app, not in the browser
  const isTauri = !!(window as any).__TAURI_INTERNALS__;
  const appWindow = isTauri ? getCurrentWindow() : null;

  useEffect(() => {
    if (!appWindow) return;
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

  // In browser mode, don't render window controls
  if (!appWindow) return null;

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

/* ── Inline SVG icon components (14×14, viewBox 0 0 24 24) ────────────── */

function UndoSvg() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 7v6h6"/>
      <path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13"/>
    </svg>
  );
}

function RedoSvg() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 7v6h-6"/>
      <path d="M3 17a9 9 0 0 1 9-9 9 9 0 0 1 6 2.3l3 2.7"/>
    </svg>
  );
}

function NewFileSvg() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
      <polyline points="14 2 14 8 20 8"/>
      <line x1="12" y1="18" x2="12" y2="12"/>
      <line x1="9" y1="15" x2="15" y2="15"/>
    </svg>
  );
}

function OpenSvg() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
    </svg>
  );
}

function SaveSvg() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/>
      <polyline points="17 21 17 13 7 13 7 21"/>
      <polyline points="7 3 7 8 15 8"/>
    </svg>
  );
}

function SaveAsSvg() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/>
      <polyline points="17 21 17 13 7 13 7 21"/>
      <polyline points="7 3 7 8 15 8"/>
      <line x1="12" y1="11" x2="12" y2="7"/>
      <polyline points="9 9 12 6 15 9"/>
    </svg>
  );
}

function PrintSvg() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="6 9 6 2 18 2 18 9"/>
      <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/>
      <rect x="6" y="14" width="12" height="8"/>
    </svg>
  );
}

function SettingsSvg() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3"/>
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>
    </svg>
  );
}

/* Lucide wrapper icons at size 14 */
function SelectSvg() { return <MousePointer2 size={14} />; }
function PanSvg() { return <Hand size={14} />; }
function ZoomInSvg() { return <ZoomIn size={14} />; }
function ZoomOutSvg() { return <ZoomOut size={14} />; }
function ZoomToFitSvg() { return <Maximize size={14} />; }
function GridSvg() { return <Grid3X3 size={14} />; }
function DeleteSvg() { return <Trash2 size={14} />; }

/* ── Button registry ──────────────────────────────────────────────────── */

interface QATButtonDef {
  id: string;
  label: string;
  shortcut?: string;
  group: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  icon: React.ComponentType<any>;
  isToggle?: boolean;
}

const QAT_BUTTONS: QATButtonDef[] = [
  { id: 'undo',        label: 'Undo',        shortcut: 'Ctrl+Z',       group: 0, icon: UndoSvg },
  { id: 'redo',        label: 'Redo',        shortcut: 'Ctrl+Y',       group: 0, icon: RedoSvg },
  { id: 'new',         label: 'New',         shortcut: 'Ctrl+N',       group: 1, icon: NewFileSvg },
  { id: 'open',        label: 'Open',        shortcut: 'Ctrl+O',       group: 1, icon: OpenSvg },
  { id: 'save',        label: 'Save',        shortcut: 'Ctrl+S',       group: 1, icon: SaveSvg },
  { id: 'save-as',     label: 'Save As',     shortcut: 'Ctrl+Shift+S', group: 1, icon: SaveAsSvg },
  { id: 'print',       label: 'Print',       shortcut: 'Ctrl+P',       group: 2, icon: PrintSvg },
  { id: 'select',      label: 'Select',                                group: 3, icon: SelectSvg },
  { id: 'pan',         label: 'Pan',                                   group: 3, icon: PanSvg },
  { id: 'zoom-in',     label: 'Zoom In',                               group: 4, icon: ZoomInSvg },
  { id: 'zoom-out',    label: 'Zoom Out',                              group: 4, icon: ZoomOutSvg },
  { id: 'zoom-to-fit', label: 'Zoom to Fit',                           group: 4, icon: ZoomToFitSvg },
  { id: 'grid-toggle', label: 'Grid',                                  group: 5, icon: GridSvg, isToggle: true },
  { id: 'delete',      label: 'Delete',      shortcut: 'Delete',       group: 6, icon: DeleteSvg },
  { id: 'settings',    label: 'Settings',                              group: 7, icon: SettingsSvg },
];

const DEFAULT_VISIBLE = [
  'undo', 'redo', 'new', 'open', 'save', 'save-as', 'print', 'settings',
];

/* ── localStorage persistence ─────────────────────────────────────────── */

const LS_KEY = 'openndstudio_qat_visible';

function loadVisibleIds(): string[] {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return DEFAULT_VISIBLE;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((v): v is string => typeof v === 'string')
      : DEFAULT_VISIBLE;
  } catch {
    return DEFAULT_VISIBLE;
  }
}

function saveVisibleIds(ids: string[]): void {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(ids));
  } catch { /* ignore quota errors */ }
}

/* ── Component ────────────────────────────────────────────────────────── */

interface MenuBarProps {
  onSendFeedback?: () => void;
}

export const MenuBar = memo(function MenuBar({ onSendFeedback }: MenuBarProps) {
  /* existing store selectors */
  const canUndo = useAppStore(s => s.canUndo());
  const canRedo = useAppStore(s => s.canRedo());
  const isModified = useAppStore(s => s.isModified);
  const projectName = useAppStore(s => s.projectName);

  const undo = useAppStore(s => s.undo);
  const redo = useAppStore(s => s.redo);
  const openSettings = useAppStore(s => s.openSettings);

  /* new store selectors for additional buttons */
  const switchToolAndCancelCommand = useAppStore(s => s.switchToolAndCancelCommand);
  const zoomIn = useAppStore(s => s.zoomIn);
  const zoomOut = useAppStore(s => s.zoomOut);
  const zoomToFit = useAppStore(s => s.zoomToFit);
  const gridVisible = useAppStore(s => s.gridVisible);
  const toggleGrid = useAppStore(s => s.toggleGrid);
  const deleteSelectedShapes = useAppStore(s => s.deleteSelectedShapes);

  const { handleNew, handleOpen, handleSave, handleSaveAs, handlePrint } = useFileOperations();

  const [appVersion, setAppVersion] = useState('');
  useEffect(() => {
    getVersion().then(setAppVersion).catch(() => setAppVersion(''));
  }, []);

  /* visibility state with localStorage persistence */
  const [visibleIds, setVisibleIds] = useState<string[]>(loadVisibleIds);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  /* click-outside handler */
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    if (menuOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [menuOpen]);

  /* toggle a button's visibility */
  const toggleVisibility = useCallback((id: string) => {
    setVisibleIds((prev) => {
      const next = prev.includes(id)
        ? prev.filter((v) => v !== id)
        : [...prev, id];
      saveVisibleIds(next);
      return next;
    });
  }, []);

  /* action map: id → { onClick, disabled?, active? } */
  const actions: Record<string, { onClick: () => void; disabled?: boolean; active?: boolean }> = {
    'undo':        { onClick: undo, disabled: !canUndo },
    'redo':        { onClick: redo, disabled: !canRedo },
    'new':         { onClick: handleNew },
    'open':        { onClick: handleOpen },
    'save':        { onClick: handleSave },
    'save-as':     { onClick: handleSaveAs },
    'print':       { onClick: handlePrint },
    'select':      { onClick: () => switchToolAndCancelCommand('select') },
    'pan':         { onClick: () => switchToolAndCancelCommand('pan') },
    'zoom-in':     { onClick: zoomIn },
    'zoom-out':    { onClick: zoomOut },
    'zoom-to-fit': { onClick: zoomToFit },
    'grid-toggle': { onClick: toggleGrid, active: gridVisible },
    'delete':      { onClick: deleteSelectedShapes },
    'settings':    { onClick: () => openSettings() },
  };

  /* filter visible buttons in registry order */
  const visibleButtons = useMemo(
    () => QAT_BUTTONS.filter((btn) => visibleIds.includes(btn.id)),
    [visibleIds],
  );

  const qatBtn = "p-1.5 rounded hover:bg-cad-border transition-colors text-cad-text-dim hover:text-cad-text cursor-default";
  const qatBtnDisabled = "p-1.5 rounded transition-colors text-cad-text-dim opacity-40 !cursor-not-allowed";
  const qatBtnActive = "p-1.5 rounded transition-colors cursor-default bg-cad-border text-blue-400";

  return (
    <div className="h-8 bg-cad-surface border-b border-cad-border flex items-center select-none">
      {/* Quick Access Toolbar */}
      <div className="flex items-center gap-0.5 px-2">
        <img src="/logo.svg" alt="Open 2D Studio" className="w-5 h-5" draggable={false} />
        <div className="w-px h-4 bg-cad-border mx-0.5" />

        {visibleButtons.map((btn, i, arr) => {
          const showSep = i > 0 && arr[i - 1].group !== btn.group;
          const act = actions[btn.id];
          const Icon = btn.icon;
          const isActive = btn.isToggle && act?.active;
          const isDisabled = act?.disabled;

          const btnClass = isDisabled
            ? qatBtnDisabled
            : isActive
              ? qatBtnActive
              : qatBtn;

          const title = btn.shortcut
            ? `${btn.label} (${btn.shortcut})`
            : btn.label;

          return (
            <span key={btn.id} className="contents">
              {showSep && <div className="w-px h-4 bg-cad-border mx-0.5" />}
              <button
                onClick={isDisabled ? undefined : act?.onClick}
                disabled={isDisabled}
                className={btnClass}
                title={title}
              >
                <Icon />
              </button>
            </span>
          );
        })}

        {/* Separator + Chevron dropdown */}
        <div className="w-px h-4 bg-cad-border mx-0.5" />
        <div className="relative" ref={menuRef}>
          <button
            onClick={() => setMenuOpen((prev) => !prev)}
            className="p-1 rounded hover:bg-cad-border transition-colors text-cad-text-dim hover:text-cad-text cursor-default"
            title="Customize Quick Access Toolbar"
          >
            <ChevronDown size={10} />
          </button>

          {menuOpen && (
            <div className="absolute top-full left-0 mt-1 bg-cad-surface border border-cad-border rounded shadow-lg z-[1000] py-1 min-w-[160px]">
              {QAT_BUTTONS.map((btn) => {
                const isVisible = visibleIds.includes(btn.id);
                return (
                  <button
                    key={btn.id}
                    className="flex items-center gap-2 w-full px-3 py-1 text-left text-xs text-cad-text-dim hover:bg-cad-border hover:text-cad-text transition-colors cursor-default"
                    onClick={() => toggleVisibility(btn.id)}
                  >
                    {isVisible
                      ? <Check size={12} className="text-blue-400 w-3 shrink-0" />
                      : <span className="w-3 shrink-0" />
                    }
                    <span>{btn.label}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Draggable area with app title */}
      <div
        data-tauri-drag-region
        className="flex-1 h-full flex items-center justify-center cursor-default"
        onDoubleClick={() => getCurrentWindow().toggleMaximize()}
      >
        <span className="text-cad-text-dim text-sm font-medium pointer-events-none">
          {isModified ? '* ' : ''}{projectName} - Open 2D Studio{appVersion ? ` v${appVersion}` : ''}
        </span>
      </div>

      {/* Send Feedback */}
      {onSendFeedback && (
        <button
          onClick={onSendFeedback}
          className="text-xs text-cad-text-dim hover:text-cad-accent transition-colors cursor-default mr-4"
        >
          Send Feedback
        </button>
      )}

      {/* Window controls */}
      <WindowControls />
    </div>
  );
});
