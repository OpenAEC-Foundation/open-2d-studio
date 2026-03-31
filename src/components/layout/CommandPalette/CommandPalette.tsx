import { useState, useRef, useEffect, useCallback, useMemo, memo } from 'react';
import {
  MousePointer2, Hand, Square, Circle, Type, RotateCw, FlipHorizontal,
  Scissors, Copy, ZoomIn, ZoomOut, Maximize, Grid3X3,
  Trash2, Settings, Search,
} from 'lucide-react';
import {
  LineIcon, ArcIcon, PolylineIcon, SplineIcon, EllipseIcon,
  ScaleIcon, OffsetIcon, HatchIcon, FilletIcon, ChamferIcon,
  ExtendIcon, ArrayIcon, AlignIcon, FilledRegionIcon,
  LeaderIcon, AlignedDimensionIcon,
} from '../../shared/CadIcons';
import { useAppStore } from '../../../state/appStore';
import { useFileOperations } from '../../../hooks/file/useFileOperations';

// ============================================================================
// Command definitions
// ============================================================================

interface PaletteCommand {
  id: string;
  label: string;
  category: string;
  shortcut?: string;
  keywords?: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  icon?: React.ComponentType<any>;
}

const COMMANDS: PaletteCommand[] = [
  // Navigation
  { id: 'tool:select',      label: 'Select',          category: 'Tools',    shortcut: 'V',     icon: MousePointer2, keywords: 'pointer cursor' },
  { id: 'tool:pan',         label: 'Pan',             category: 'Tools',    shortcut: 'H',     icon: Hand, keywords: 'hand drag' },

  // Drawing tools
  { id: 'tool:line',        label: 'Line',            category: 'Draw',     shortcut: 'L',     icon: LineIcon, keywords: 'draw segment' },
  { id: 'tool:polyline',    label: 'Polyline',        category: 'Draw',     shortcut: 'PL',    icon: PolylineIcon, keywords: 'multi segment poly' },
  { id: 'tool:rectangle',   label: 'Rectangle',       category: 'Draw',     shortcut: 'RE',    icon: Square, keywords: 'rect box square' },
  { id: 'tool:circle',      label: 'Circle',          category: 'Draw',     shortcut: 'CI',    icon: Circle, keywords: 'round' },
  { id: 'tool:arc',         label: 'Arc',             category: 'Draw',     shortcut: 'AR',    icon: ArcIcon, keywords: 'curve' },
  { id: 'tool:ellipse',     label: 'Ellipse',         category: 'Draw',     shortcut: 'EL',    icon: EllipseIcon, keywords: 'oval' },
  { id: 'tool:spline',      label: 'Spline',          category: 'Draw',     shortcut: 'SP',    icon: SplineIcon, keywords: 'curve smooth' },
  { id: 'tool:text',        label: 'Text',            category: 'Draw',     shortcut: 'TX',    icon: Type, keywords: 'label annotation' },
  { id: 'tool:leader',      label: 'Leader',          category: 'Draw',                        icon: LeaderIcon, keywords: 'annotation callout' },
  { id: 'tool:dimension',   label: 'Dimension',       category: 'Draw',     shortcut: 'DI',    icon: AlignedDimensionIcon, keywords: 'measure annotate' },
  { id: 'tool:hatch',       label: 'Hatch',           category: 'Draw',                        icon: HatchIcon, keywords: 'fill pattern' },
  { id: 'tool:filled-region', label: 'Filled Region', category: 'Draw',                        icon: FilledRegionIcon, keywords: 'boundary fill' },

  // Structural tools
  { id: 'tool:beam',        label: 'Beam',            category: 'Structural', keywords: 'structural member' },
  { id: 'tool:column',      label: 'Column',          category: 'Structural', keywords: 'structural vertical' },
  { id: 'tool:wall',        label: 'Wall',            category: 'Structural', keywords: 'partition' },
  { id: 'tool:slab',        label: 'Slab',            category: 'Structural', keywords: 'floor plate' },
  { id: 'tool:gridline',    label: 'Grid Line',       category: 'Structural', keywords: 'axis grid' },
  { id: 'tool:level',       label: 'Level',           category: 'Structural', keywords: 'storey elevation' },
  { id: 'tool:pile',        label: 'Pile',            category: 'Structural', keywords: 'foundation' },

  // Modify tools
  { id: 'tool:move',        label: 'Move',            category: 'Modify',  shortcut: 'M',     keywords: 'translate' },
  { id: 'tool:copy',        label: 'Copy',            category: 'Modify',  shortcut: 'CO',    icon: Copy, keywords: 'duplicate' },
  { id: 'tool:rotate',      label: 'Rotate',          category: 'Modify',  shortcut: 'RO',    icon: RotateCw, keywords: 'turn spin' },
  { id: 'tool:scale',       label: 'Scale',           category: 'Modify',  shortcut: 'SC',    icon: ScaleIcon, keywords: 'resize' },
  { id: 'tool:mirror',      label: 'Mirror',          category: 'Modify',  shortcut: 'MI',    icon: FlipHorizontal, keywords: 'flip reflect' },
  { id: 'tool:trim',        label: 'Trim',            category: 'Modify',  shortcut: 'TR',    icon: Scissors, keywords: 'cut clip' },
  { id: 'tool:extend',      label: 'Extend',          category: 'Modify',  shortcut: 'EX',    icon: ExtendIcon, keywords: 'lengthen stretch' },
  { id: 'tool:fillet',      label: 'Fillet',          category: 'Modify',  shortcut: 'FI',    icon: FilletIcon, keywords: 'round corner radius' },
  { id: 'tool:chamfer',     label: 'Chamfer',         category: 'Modify',  shortcut: 'CH',    icon: ChamferIcon, keywords: 'bevel corner' },
  { id: 'tool:offset',      label: 'Offset',          category: 'Modify',  shortcut: 'OF',    icon: OffsetIcon, keywords: 'parallel' },
  { id: 'tool:array',       label: 'Array',           category: 'Modify',                     icon: ArrayIcon, keywords: 'repeat pattern copies' },
  { id: 'tool:align',       label: 'Align',           category: 'Modify',                     icon: AlignIcon, keywords: 'align distribute' },

  // View commands
  { id: 'view:zoom-in',     label: 'Zoom In',         category: 'View',                       icon: ZoomIn },
  { id: 'view:zoom-out',    label: 'Zoom Out',        category: 'View',                       icon: ZoomOut },
  { id: 'view:zoom-fit',    label: 'Zoom to Fit',     category: 'View',                       icon: Maximize, keywords: 'fit extents' },
  { id: 'view:grid',        label: 'Toggle Grid',     category: 'View',                       icon: Grid3X3, keywords: 'grid show hide' },

  // File commands
  { id: 'file:new',         label: 'New File',         category: 'File',   shortcut: 'Ctrl+N', keywords: 'create' },
  { id: 'file:open',        label: 'Open File',        category: 'File',   shortcut: 'Ctrl+O', keywords: 'load' },
  { id: 'file:save',        label: 'Save',             category: 'File',   shortcut: 'Ctrl+S' },
  { id: 'file:save-as',     label: 'Save As',          category: 'File',   shortcut: 'Ctrl+Shift+S' },
  { id: 'file:print',       label: 'Print',            category: 'File',   shortcut: 'Ctrl+P', keywords: 'export pdf' },

  // Edit commands
  { id: 'edit:undo',        label: 'Undo',             category: 'Edit',   shortcut: 'Ctrl+Z' },
  { id: 'edit:redo',        label: 'Redo',             category: 'Edit',   shortcut: 'Ctrl+Y' },
  { id: 'edit:delete',      label: 'Delete Selection', category: 'Edit',   shortcut: 'Del',   icon: Trash2, keywords: 'remove erase' },
  { id: 'edit:select-all',  label: 'Select All',       category: 'Edit',   shortcut: 'Ctrl+A', keywords: 'all' },
  { id: 'edit:find',        label: 'Find & Replace',   category: 'Edit',   shortcut: 'Ctrl+H', icon: Search, keywords: 'search replace' },

  // Settings
  { id: 'app:settings',     label: 'Settings',         category: 'App',                        icon: Settings, keywords: 'preferences options config' },
];

// ============================================================================
// Component
// ============================================================================

interface CommandPaletteProps {
  isOpen: boolean;
  onClose: () => void;
}

export const CommandPalette = memo(function CommandPalette({ isOpen, onClose }: CommandPaletteProps) {
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Store actions
  const switchToDrawingTool = useAppStore(s => s.switchToDrawingTool);
  const switchToolAndCancelCommand = useAppStore(s => s.switchToolAndCancelCommand);
  const undo = useAppStore(s => s.undo);
  const redo = useAppStore(s => s.redo);
  const zoomIn = useAppStore(s => s.zoomIn);
  const zoomOut = useAppStore(s => s.zoomOut);
  const zoomToFit = useAppStore(s => s.zoomToFit);
  const toggleGrid = useAppStore(s => s.toggleGrid);
  const deleteSelectedShapes = useAppStore(s => s.deleteSelectedShapes);
  const selectAll = useAppStore(s => s.selectAll);
  const openSettings = useAppStore(s => s.openSettings);
  const setFindReplaceDialogOpen = useAppStore(s => s.setFindReplaceDialogOpen);

  const { handleNew, handleOpen, handleSave, handleSaveAs, handlePrint } = useFileOperations();

  // Drawing tools that use switchToDrawingTool (deselects first)
  const drawingTools = useMemo(() => new Set([
    'line', 'polyline', 'rectangle', 'circle', 'arc', 'ellipse', 'spline',
    'text', 'leader', 'dimension', 'hatch', 'filled-region',
    'beam', 'column', 'wall', 'slab', 'gridline', 'level', 'pile',
    'move', 'copy', 'rotate', 'scale', 'mirror', 'trim', 'extend',
    'fillet', 'chamfer', 'offset', 'array', 'align',
  ]), []);

  // Execute a command by id
  const executeCommand = useCallback((id: string) => {
    onClose();

    if (id.startsWith('tool:')) {
      const tool = id.replace('tool:', '') as any;
      if (tool === 'select' || tool === 'pan') {
        switchToolAndCancelCommand(tool);
      } else if (drawingTools.has(tool)) {
        switchToDrawingTool(tool);
      }
      return;
    }

    switch (id) {
      case 'view:zoom-in':    zoomIn(); break;
      case 'view:zoom-out':   zoomOut(); break;
      case 'view:zoom-fit':   zoomToFit(); break;
      case 'view:grid':       toggleGrid(); break;
      case 'file:new':        handleNew(); break;
      case 'file:open':       handleOpen(); break;
      case 'file:save':       handleSave(); break;
      case 'file:save-as':    handleSaveAs(); break;
      case 'file:print':      handlePrint(); break;
      case 'edit:undo':       undo(); break;
      case 'edit:redo':       redo(); break;
      case 'edit:delete':     deleteSelectedShapes(); break;
      case 'edit:select-all': selectAll(); break;
      case 'edit:find':       setFindReplaceDialogOpen(true); break;
      case 'app:settings':    openSettings(); break;
    }
  }, [
    onClose, switchToDrawingTool, switchToolAndCancelCommand, drawingTools,
    zoomIn, zoomOut, zoomToFit, toggleGrid,
    handleNew, handleOpen, handleSave, handleSaveAs, handlePrint,
    undo, redo, deleteSelectedShapes, selectAll, openSettings, setFindReplaceDialogOpen,
  ]);

  // Filter commands
  const filtered = useMemo(() => {
    if (!query.trim()) return COMMANDS;
    const q = query.toLowerCase().trim();
    return COMMANDS.filter((cmd) => {
      const haystack = `${cmd.label} ${cmd.category} ${cmd.keywords || ''} ${cmd.shortcut || ''}`.toLowerCase();
      // Support multi-word search: all tokens must match
      const tokens = q.split(/\s+/);
      return tokens.every(token => haystack.includes(token));
    });
  }, [query]);

  // Reset selection on filter change
  useEffect(() => {
    setSelectedIndex(0);
  }, [filtered]);

  // Focus input when opened
  useEffect(() => {
    if (isOpen) {
      setQuery('');
      setSelectedIndex(0);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [isOpen]);

  // Scroll selected item into view
  useEffect(() => {
    if (!listRef.current) return;
    const item = listRef.current.children[selectedIndex] as HTMLElement | undefined;
    item?.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex]);

  // Keyboard navigation
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setSelectedIndex(i => Math.min(i + 1, filtered.length - 1));
        break;
      case 'ArrowUp':
        e.preventDefault();
        setSelectedIndex(i => Math.max(i - 1, 0));
        break;
      case 'Enter':
        e.preventDefault();
        if (filtered[selectedIndex]) {
          executeCommand(filtered[selectedIndex].id);
        }
        break;
      case 'Escape':
        e.preventDefault();
        onClose();
        break;
    }
  }, [filtered, selectedIndex, executeCommand, onClose]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-start justify-center pt-[10vh]"
      onClick={onClose}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/40" />

      {/* Palette */}
      <div
        className="relative w-[560px] max-h-[60vh] bg-[#1e1e1e] border border-[#3c3c3c] rounded-lg shadow-2xl flex flex-col overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* Search input */}
        <div className="flex items-center gap-2 px-4 py-3 border-b border-[#3c3c3c]">
          <Search size={16} className="text-[#858585] shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type a command..."
            className="flex-1 bg-transparent text-sm text-[#cccccc] placeholder-[#858585] outline-none"
            autoComplete="off"
            spellCheck={false}
          />
          <kbd className="text-[10px] text-[#858585] bg-[#2d2d2d] border border-[#3c3c3c] rounded px-1.5 py-0.5 font-mono shrink-0">
            Esc
          </kbd>
        </div>

        {/* Command list */}
        <div ref={listRef} className="overflow-y-auto py-1 max-h-[calc(60vh-52px)]">
          {filtered.length === 0 ? (
            <div className="px-4 py-6 text-center text-sm text-[#858585]">
              No commands found
            </div>
          ) : (
            filtered.map((cmd, i) => {
              const isSelected = i === selectedIndex;
              const Icon = cmd.icon;
              return (
                <button
                  key={cmd.id}
                  className={`w-full flex items-center gap-3 px-4 py-2 text-left transition-colors cursor-default ${
                    isSelected
                      ? 'bg-[#04395e] text-white'
                      : 'text-[#cccccc] hover:bg-[#2a2d2e]'
                  }`}
                  onClick={() => executeCommand(cmd.id)}
                  onMouseEnter={() => setSelectedIndex(i)}
                >
                  {/* Icon */}
                  <span className="w-5 h-5 flex items-center justify-center shrink-0 text-[#858585]">
                    {Icon ? <Icon size={16} /> : null}
                  </span>

                  {/* Label */}
                  <span className="flex-1 text-sm truncate">{cmd.label}</span>

                  {/* Category badge */}
                  <span className="text-[10px] text-[#858585] bg-[#2d2d2d] rounded px-1.5 py-0.5 shrink-0">
                    {cmd.category}
                  </span>

                  {/* Shortcut */}
                  {cmd.shortcut && (
                    <kbd className="text-[10px] text-[#858585] bg-[#2d2d2d] border border-[#3c3c3c] rounded px-1.5 py-0.5 font-mono shrink-0">
                      {cmd.shortcut}
                    </kbd>
                  )}
                </button>
              );
            })
          )}
        </div>

        {/* Footer hint */}
        <div className="flex items-center gap-3 px-4 py-2 border-t border-[#3c3c3c] text-[10px] text-[#858585]">
          <span>
            <kbd className="bg-[#2d2d2d] border border-[#3c3c3c] rounded px-1 py-0.5 font-mono">↑↓</kbd> navigate
          </span>
          <span>
            <kbd className="bg-[#2d2d2d] border border-[#3c3c3c] rounded px-1 py-0.5 font-mono">Enter</kbd> execute
          </span>
          <span>
            <kbd className="bg-[#2d2d2d] border border-[#3c3c3c] rounded px-1 py-0.5 font-mono">Esc</kbd> close
          </span>
        </div>
      </div>
    </div>
  );
});
