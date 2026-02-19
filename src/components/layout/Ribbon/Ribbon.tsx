import { useState, useRef, useEffect, memo, useCallback, useMemo } from 'react';
import {
  MousePointer2,
  Hand,
  Square,
  Circle,
  Type,
  RotateCw,
  FlipHorizontal,
  Scissors,
  ArrowRight,
  Copy,
  ZoomIn,
  ZoomOut,
  Maximize,
  Grid3X3,
  Trash2,
  Printer,
  Settings,
  ClipboardPaste,
  ChevronDown,
  ChevronRight,
  CheckSquare,
  XSquare,
  Sun,
  Check,
  Palette,
  Search,
  ArrowUpToLine,
  ArrowUp,
  ArrowDown,
  ArrowDownToLine,
  ImageIcon,
  Box,
  Orbit,
  Footprints,
  Layers,
  Eye,
  EyeOff,
  Download,
  FileText,
  FolderTree,
  Link2,
  Unlink,
  RefreshCw,
  FolderOpen,
  ClipboardCopy,
  Info,
} from 'lucide-react';
import type { UITheme } from '../../../state/slices/snapSlice';
import { UI_THEMES } from '../../../state/slices/snapSlice';
import { useAppStore } from '../../../state/appStore';
import {
  LineIcon,
  ArcIcon,
  PolylineIcon,
  SplineIcon,
  EllipseIcon,
  SplitIcon,
  ArrayIcon,
  AlignIcon,
  FilletIcon,
  ChamferIcon,
  ExtendIcon,
  ScaleIcon,
  OffsetIcon,
  HatchIcon,
  CloudIcon,
  LeaderIcon,
  TableIcon,
  StretchIcon,
  BreakIcon,
  JoinIcon,
  PinIcon,
  LengthenIcon,
  ExplodeIcon,
  FilledRegionIcon,
  DetailComponentIcon,
  InsulationIcon,
  AlignedDimensionIcon,
  LinearDimensionIcon,
  AngularDimensionIcon,
  RadiusDimensionIcon,
  DiameterDimensionIcon,
  BeamIcon,
  GridLineIcon,
  LevelIcon,
  SectionDetailIcon,
  PileIcon,
  CPTIcon,
  WallIcon,
  SlabIcon,
  SpaceIcon,
  LabelIcon,
  MiterJoinIcon,
  PlateSystemIcon,
  SpotElevationIcon,
} from '../../shared/CadIcons';
import { useFileOperations } from '../../../hooks/file/useFileOperations';
import { SelectionFilterBar } from './SelectionFilterBar';
import { QuickAccessBar } from './QuickAccessBar';
import type { Shape, BeamShape } from '../../../types/geometry';
import type { ProjectStructure } from '../../../state/slices/parametricSlice';
import { triggerBonsaiSync, saveBonsaiSyncSettings, generateBlenderWatcherScript } from '../../../services/bonsaiSync';
import { ALL_IFC_CATEGORIES, IFC_CATEGORY_LABELS, getIfcCategory } from '../../../utils/ifcCategoryUtils';
import { getNextSectionLabel } from '../../../hooks/drawing/useSectionCalloutDrawing';
import './Ribbon.css';

/**
 * Custom tooltip component - renders below the hovered element
 */
function RibbonTooltip({ label, shortcut, parentRef }: { label: string; shortcut?: string; parentRef: React.RefObject<HTMLElement> }) {
  const [pos, setPos] = useState<{ x: number; y: number; align: 'center' | 'left' | 'right' } | null>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (parentRef.current) {
      const rect = parentRef.current.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      const viewportWidth = window.innerWidth;

      // Estimate tooltip width (will be adjusted after render if needed)
      const estimatedTooltipWidth = 150;
      const margin = 8;

      let align: 'center' | 'left' | 'right' = 'center';
      let x = centerX;

      // Check if tooltip would go outside left edge
      if (centerX - estimatedTooltipWidth / 2 < margin) {
        align = 'left';
        x = margin;
      }
      // Check if tooltip would go outside right edge
      else if (centerX + estimatedTooltipWidth / 2 > viewportWidth - margin) {
        align = 'right';
        x = viewportWidth - margin;
      }

      setPos({ x, y: rect.bottom + 4, align });
    }
  }, [parentRef]);

  // Adjust position after tooltip renders to ensure it stays in viewport
  useEffect(() => {
    if (tooltipRef.current && pos) {
      const tooltipRect = tooltipRef.current.getBoundingClientRect();
      const viewportWidth = window.innerWidth;
      const margin = 8;

      // Re-check with actual tooltip width
      if (pos.align === 'center') {
        if (tooltipRect.left < margin) {
          setPos({ ...pos, x: margin, align: 'left' });
        } else if (tooltipRect.right > viewportWidth - margin) {
          setPos({ ...pos, x: viewportWidth - margin, align: 'right' });
        }
      }
    }
  }, [pos]);

  if (!pos) return null;

  const transformStyle = pos.align === 'center'
    ? 'translateX(-50%)'
    : pos.align === 'right'
      ? 'translateX(-100%)'
      : 'none';

  return (
    <div
      ref={tooltipRef}
      style={{
        position: 'fixed',
        left: pos.x,
        top: pos.y,
        transform: transformStyle,
        zIndex: 9999,
        pointerEvents: 'none',
      }}
    >
      <div className="ribbon-tooltip">
        <span className="ribbon-tooltip-label">{label}</span>
        {shortcut && <span className="ribbon-tooltip-shortcut">{shortcut}</span>}
      </div>
    </div>
  );
}

/**
 * Hook for tooltip show/hide with delay
 */
function useTooltip(delay = 400) {
  const [show, setShow] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout>>();

  const onEnter = useCallback(() => {
    timerRef.current = setTimeout(() => setShow(true), delay);
  }, [delay]);

  const onLeave = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setShow(false);
  }, []);

  useEffect(() => {
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, []);

  return { show, ref, onEnter, onLeave };
}

type RibbonTab = 'home' | 'modify' | 'structural' | 'view' | 'tools' | 'selection' | string;

interface RibbonButtonProps {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
  shortcut?: string;
  tooltip?: string;
}

function RibbonButton({ icon, label, onClick, active, disabled, shortcut, tooltip }: RibbonButtonProps) {
  const tt = useTooltip();
  return (
    <>
      <button
        ref={tt.ref}
        className={`ribbon-btn ${active ? 'active' : ''} ${disabled ? 'disabled' : ''}`}
        onClick={onClick}
        disabled={disabled}
        onMouseEnter={tt.onEnter}
        onMouseLeave={tt.onLeave}
      >
        <span className="ribbon-btn-icon">{icon}</span>
        <span className="ribbon-btn-label">{label}</span>
      </button>
      {tt.show && <RibbonTooltip label={tooltip || label} shortcut={shortcut} parentRef={tt.ref as React.RefObject<HTMLElement>} />}
    </>
  );
}


interface RibbonSmallButtonProps {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
  shortcut?: string;
}

function RibbonSmallButton({ icon, label, onClick, active, disabled, shortcut }: RibbonSmallButtonProps) {
  const tt = useTooltip();
  return (
    <>
      <button
        ref={tt.ref}
        className={`ribbon-btn small ${active ? 'active' : ''} ${disabled ? 'disabled' : ''}`}
        onClick={onClick}
        disabled={disabled}
        onMouseEnter={tt.onEnter}
        onMouseLeave={tt.onLeave}
      >
        <span className="ribbon-btn-icon">{icon}</span>
        <span className="ribbon-btn-label">{label}</span>
      </button>
      {tt.show && <RibbonTooltip label={label} shortcut={shortcut} parentRef={tt.ref as React.RefObject<HTMLElement>} />}
    </>
  );
}

function RibbonMediumButton({ icon, label, onClick, active, disabled, shortcut }: RibbonSmallButtonProps) {
  const tt = useTooltip();
  return (
    <>
      <button
        ref={tt.ref}
        className={`ribbon-btn medium ${active ? 'active' : ''} ${disabled ? 'disabled' : ''}`}
        onClick={onClick}
        disabled={disabled}
        onMouseEnter={tt.onEnter}
        onMouseLeave={tt.onLeave}
      >
        <span className="ribbon-btn-icon">{icon}</span>
        <span className="ribbon-btn-label">{label}</span>
      </button>
      {tt.show && <RibbonTooltip label={label} shortcut={shortcut} parentRef={tt.ref as React.RefObject<HTMLElement>} />}
    </>
  );
}

function RibbonMediumButtonStack({ children }: { children: React.ReactNode }) {
  return <div className="ribbon-btn-medium-stack">{children}</div>;
}

function RibbonGroup({ label, children, noLabels }: { label: string; children: React.ReactNode; noLabels?: boolean }) {
  return (
    <div className={`ribbon-group ${noLabels ? 'no-labels' : ''}`}>
      <div className="ribbon-group-content">{children}</div>
      <div className="ribbon-group-label">{label}</div>
    </div>
  );
}

function RibbonButtonStack({ children }: { children: React.ReactNode }) {
  return <div className="ribbon-btn-stack">{children}</div>;
}

/**
 * Theme Selector - DevExpress-style dropdown for selecting UI theme
 */
interface ThemeSelectorProps {
  currentTheme: UITheme;
  onThemeChange: (theme: UITheme) => void;
}

function ThemeSelector({ currentTheme, onThemeChange }: ThemeSelectorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  const currentThemeLabel = UI_THEMES.find(t => t.id === currentTheme)?.label || 'Dark';

  return (
    <div className="ribbon-theme-selector" ref={dropdownRef}>
      <span className="ribbon-theme-label">Theme</span>
      <div className="ribbon-theme-dropdown">
        <button
          className="ribbon-theme-button"
          onClick={() => setIsOpen(!isOpen)}
        >
          <span className="ribbon-theme-button-content">
            <span className={`ribbon-theme-swatch ${currentTheme}`} />
            <span>{currentThemeLabel}</span>
          </span>
          <ChevronDown size={12} />
        </button>
        {isOpen && (
          <div className="ribbon-theme-menu">
            {UI_THEMES.map((theme) => (
              <button
                key={theme.id}
                className={`ribbon-theme-option ${currentTheme === theme.id ? 'selected' : ''}`}
                onClick={() => {
                  onThemeChange(theme.id);
                  setIsOpen(false);
                }}
              >
                {currentTheme === theme.id ? (
                  <Check size={12} className="checkmark" />
                ) : (
                  <span className="no-check" />
                )}
                <span className={`ribbon-theme-swatch ${theme.id}`} />
                <span>{theme.label}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================================================
// IFC Spatial Tree — helper to categorize shapes by IFC type
// ============================================================================

/** Map a shape to its IFC entity class name */
function shapeToIfcClass(shape: Shape): string {
  switch (shape.type) {
    case 'wall': return 'IfcWall';
    case 'beam': {
      const beam = shape as BeamShape;
      return beam.viewMode === 'section' ? 'IfcColumn' : 'IfcBeam';
    }
    case 'slab': return 'IfcSlab';
    case 'pile': return 'IfcPile';
    case 'cpt': return 'IfcBuildingElementProxy';
    case 'foundation-zone': return 'IfcBuildingElementProxy';
    case 'gridline': return 'IfcGrid';
    case 'level': return 'IfcBuildingStorey';
    case 'spot-elevation': return 'IfcAnnotation';
    case 'space': return 'IfcSpace';
    case 'line':
    case 'arc':
    case 'circle':
    case 'polyline':
    case 'rectangle':
    case 'dimension':
    case 'text':
    case 'section-callout':
      return 'IfcAnnotation';
    default:
      return 'Other';
  }
}

/** Group shapes by IFC class and return sorted entries with counts */
function groupShapesByIfcClass(shapes: Shape[]): { ifcClass: string; count: number }[] {
  const map = new Map<string, number>();
  for (const s of shapes) {
    const cls = shapeToIfcClass(s);
    if (cls === 'Other') continue;
    map.set(cls, (map.get(cls) || 0) + 1);
  }
  // Sort: structural first, then annotation
  const order = ['IfcWall', 'IfcColumn', 'IfcBeam', 'IfcSlab', 'IfcPile', 'IfcSpace', 'IfcGrid', 'IfcBuildingStorey', 'IfcAnnotation'];
  return Array.from(map.entries())
    .sort((a, b) => {
      const ia = order.indexOf(a[0]);
      const ib = order.indexOf(b[0]);
      return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
    })
    .map(([ifcClass, count]) => ({ ifcClass, count }));
}

/** Collapsible tree node used in the IFC tab */
function IfcTreeNode({ label, badge, children, defaultOpen = true, depth = 0 }: {
  label: string;
  badge?: string | number;
  children?: React.ReactNode;
  defaultOpen?: boolean;
  depth?: number;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const hasChildren = !!children;
  return (
    <div style={{ paddingLeft: depth > 0 ? 12 : 0 }}>
      <div
        className="ifc-tree-node"
        onClick={() => hasChildren && setOpen(!open)}
        style={{ cursor: hasChildren ? 'pointer' : 'default' }}
      >
        {hasChildren ? (
          open ? <ChevronDown size={10} className="ifc-tree-chevron" /> : <ChevronRight size={10} className="ifc-tree-chevron" />
        ) : (
          <span className="ifc-tree-dot" />
        )}
        <span className="ifc-tree-label">{label}</span>
        {badge !== undefined && <span className="ifc-tree-badge">{badge}</span>}
      </div>
      {hasChildren && open && <div className="ifc-tree-children">{children}</div>}
    </div>
  );
}

/** The IFC spatial structure tree rendered inside the ribbon IFC tab */
function IfcSpatialTree({ shapes, projectStructure }: { shapes: Shape[]; projectStructure: ProjectStructure }) {
  const grouped = useMemo(() => groupShapesByIfcClass(shapes), [shapes]);
  const totalElements = useMemo(() => grouped.reduce((sum, g) => sum + g.count, 0), [grouped]);

  return (
    <div className="ifc-tree-container">
      <IfcTreeNode label="IfcProject" badge={`${totalElements} elements`} defaultOpen>
        <IfcTreeNode label={`IfcSite: ${projectStructure.siteName}`} depth={1} defaultOpen>
          {projectStructure.buildings.map((building) => (
            <IfcTreeNode key={building.id} label={`IfcBuilding: ${building.name}`} depth={1} defaultOpen>
              {building.storeys.length > 0 ? (
                building.storeys
                  .slice()
                  .sort((a, b) => b.elevation - a.elevation)
                  .map((storey) => (
                    <IfcTreeNode
                      key={storey.id}
                      label={`IfcBuildingStorey: ${storey.name}`}
                      badge={`${storey.elevation >= 0 ? '+' : ''}${storey.elevation} mm`}
                      depth={1}
                      defaultOpen={false}
                    >
                      {grouped.map((g) => (
                        <IfcTreeNode
                          key={g.ifcClass}
                          label={g.ifcClass}
                          badge={g.count}
                          depth={1}
                        />
                      ))}
                    </IfcTreeNode>
                  ))
              ) : (
                <IfcTreeNode label="IfcBuildingStorey: Ground Floor" badge="+0 mm" depth={1} defaultOpen={false}>
                  {grouped.map((g) => (
                    <IfcTreeNode
                      key={g.ifcClass}
                      label={g.ifcClass}
                      badge={g.count}
                      depth={1}
                    />
                  ))}
                </IfcTreeNode>
              )}
            </IfcTreeNode>
          ))}
        </IfcTreeNode>

        {/* Summary row: element type counts */}
        {grouped.length > 0 && (
          <div className="ifc-tree-summary">
            {grouped.map((g) => (
              <span key={g.ifcClass} className="ifc-tree-summary-item">
                {g.ifcClass.replace('Ifc', '')}: {g.count}
              </span>
            ))}
          </div>
        )}
      </IfcTreeNode>
    </div>
  );
}

// ============================================================================
// ShapeModeSelector — reusable Line / Arc / Rectangle toggle for structural tools
// ============================================================================

type ShapeMode = 'line' | 'arc' | 'rectangle' | 'circle';

interface ShapeModeSelectorProps {
  mode: ShapeMode;
  onChange: (mode: ShapeMode) => void;
}

function ShapeModeSelector({ mode, onChange }: ShapeModeSelectorProps) {
  return (
    <RibbonGroup label="Shape">
      <div className="flex gap-0.5">
        <button
          className={`px-2 py-1 text-xs rounded ${mode === 'line' ? 'bg-cad-accent/20 text-cad-accent border border-cad-accent/50' : 'bg-cad-bg border border-cad-border text-cad-text hover:bg-cad-hover'}`}
          onClick={() => onChange('line')}
        >
          <LineIcon size={14} />
        </button>
        <button
          className={`px-2 py-1 text-xs rounded ${mode === 'arc' ? 'bg-cad-accent/20 text-cad-accent border border-cad-accent/50' : 'bg-cad-bg border border-cad-border text-cad-text hover:bg-cad-hover'}`}
          onClick={() => onChange('arc')}
        >
          <ArcIcon size={14} />
        </button>
        <button
          className={`px-2 py-1 text-xs rounded ${mode === 'rectangle' ? 'bg-cad-accent/20 text-cad-accent border border-cad-accent/50' : 'bg-cad-bg border border-cad-border text-cad-text hover:bg-cad-hover'}`}
          onClick={() => onChange('rectangle')}
        >
          <Square size={14} />
        </button>
        <button
          className={`px-2 py-1 text-xs rounded ${mode === 'circle' ? 'bg-cad-accent/20 text-cad-accent border border-cad-accent/50' : 'bg-cad-bg border border-cad-border text-cad-text hover:bg-cad-hover'}`}
          onClick={() => onChange('circle')}
        >
          <Circle size={14} />
        </button>
      </div>
    </RibbonGroup>
  );
}

interface RibbonProps {
  onOpenBackstage: () => void;
}

export const Ribbon = memo(function Ribbon({ onOpenBackstage }: RibbonProps) {
  const [activeTab, setActiveTab] = useState<RibbonTab>('home');
  const [ifcFilterOpen, setIfcFilterOpen] = useState(false);
  const ifcFilterRef = useRef<HTMLDivElement>(null);

  const {
    activeTool,
    switchToDrawingTool,
    switchToolAndCancelCommand,
    dimensionMode,
    setDimensionMode,
    gridVisible,
    toggleGrid,
    whiteBackground,
    toggleWhiteBackground,
    showRotationGizmo,
    toggleRotationGizmo,
    zoomIn,
    zoomOut,
    zoomToFit,
    deleteSelectedShapes,
    selectedShapeIds,
    setPrintDialogOpen,
    openSettings,
    // Clipboard
    copySelectedShapes,
    cutSelectedShapes,
    pasteShapes,
    hasClipboardContent,

    selectAll,
    deselectAll,
    setFindReplaceDialogOpen,
    editorMode,
    openBeamDialog,
    setPendingGridline,
    setPendingLevel,
    openPileDialog,
    setPendingCPT,
    pendingWall,
    setPendingWall,
    lastUsedWallTypeId,
    wallTypes,
    pendingBeam,
    setPendingBeam,
    clearDrawingPoints,
    setDrawingPreview,
    setPendingSectionCallout,
    setPatternManagerOpen,
    setTextStyleManagerOpen,

    // Draw order
    bringToFront,
    bringForward,
    sendBackward,
    sendToBack,

    // Theme
    uiTheme,
    setUITheme,

    // Extensions
    extensionRibbonTabs,
    extensionRibbonButtons,

    // Wall dialog
    openMaterialsDialog,
    openWallTypesDialog,

    // Slab
    pendingSlab,
    setPendingSlab,

    // Space
    setPendingSpace,

    // Plate System
    pendingPlateSystem,
    setPendingPlateSystem,
    openPlateSystemDialog,

    // Project Structure
    openProjectStructureDialog,

    // IFC
    ifcPanelOpen,
    setIfcPanelOpen,
    setIfcDashboardVisible,

    // IFC category filter
    hiddenIfcCategories,
    toggleIfcCategoryVisibility,
    setHiddenIfcCategories,

    // Shapes & project structure (for IFC tab tree)
    shapes,
    projectStructure,
    ifcEntityCount,
    ifcFileSize,
    regenerateIFC,

    // Bonsai Sync
    bonsaiSyncEnabled,
    setBonsaiSyncEnabled,
    bonsaiSyncPath,
    setBonsaiSyncPath,
    bonsaiLastSync,
    bonsaiSyncStatus,
    bonsaiSyncError,

    // 3D view
    show3DView,
    setShow3DView,
    viewMode3D,
    setViewMode3D,
  } = useAppStore();

  const isSheetMode = editorMode !== 'drawing';

  const { handleExportIFC } = useFileOperations();

  // Bonsai Sync handlers
  const handleBonsaiSyncToggle = useCallback(() => {
    const newEnabled = !bonsaiSyncEnabled;
    setBonsaiSyncEnabled(newEnabled);
    saveBonsaiSyncSettings(bonsaiSyncPath, newEnabled);
  }, [bonsaiSyncEnabled, bonsaiSyncPath, setBonsaiSyncEnabled]);

  const handleBonsaiSetPath = useCallback(async () => {
    const isTauri = !!(window as any).__TAURI_INTERNALS__;
    if (isTauri) {
      try {
        const { save } = await import('@tauri-apps/plugin-dialog');
        const result = await save({
          filters: [{ name: 'IFC Files', extensions: ['ifc'] }],
          title: 'Set Bonsai Sync Path',
          defaultPath: bonsaiSyncPath || 'model.ifc',
        });
        if (result) {
          setBonsaiSyncPath(result);
          saveBonsaiSyncSettings(result, bonsaiSyncEnabled);
        }
      } catch {
        // User cancelled
      }
    } else {
      // Browser fallback: use a prompt dialog
      const result = window.prompt(
        'Enter the file path for Bonsai Sync IFC output:',
        bonsaiSyncPath || 'model.ifc'
      );
      if (result) {
        setBonsaiSyncPath(result);
        saveBonsaiSyncSettings(result, bonsaiSyncEnabled);
      }
    }
  }, [bonsaiSyncPath, bonsaiSyncEnabled, setBonsaiSyncPath]);

  const handleBonsaiSyncNow = useCallback(() => {
    triggerBonsaiSync();
  }, []);

  // Bonsai watcher script — copy to clipboard
  const [scriptCopied, setScriptCopied] = useState(false);
  const [showBonsaiInfo, setShowBonsaiInfo] = useState(false);
  const bonsaiInfoRef = useRef<HTMLDivElement>(null);

  const handleCopyBlenderScript = useCallback(() => {
    const path = bonsaiSyncPath || 'C:\\model.ifc';
    const script = generateBlenderWatcherScript(path);
    navigator.clipboard.writeText(script).then(() => {
      setScriptCopied(true);
      setTimeout(() => setScriptCopied(false), 2000);
    }).catch(() => {
      // Fallback: open in a new window so user can copy manually
      const win = window.open('', '_blank', 'width=700,height=500');
      if (win) {
        win.document.write(`<pre style="white-space:pre-wrap;font-size:12px;">${script.replace(/</g, '&lt;')}</pre>`);
      }
    });
  }, [bonsaiSyncPath]);

  // Close info popover on outside click
  useEffect(() => {
    if (!showBonsaiInfo) return;
    const handler = (e: MouseEvent) => {
      if (bonsaiInfoRef.current && !bonsaiInfoRef.current.contains(e.target as Node)) {
        setShowBonsaiInfo(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showBonsaiInfo]);

  // Close IFC filter dropdown on outside click
  useEffect(() => {
    if (!ifcFilterOpen) return;
    const handler = (e: MouseEvent) => {
      if (ifcFilterRef.current && !ifcFilterRef.current.contains(e.target as Node)) {
        setIfcFilterOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [ifcFilterOpen]);

  // Auto-switch to/from the contextual "Selection" tab
  useEffect(() => {
    if (selectedShapeIds.length > 0 && activeTab !== 'selection') {
      setActiveTab('selection');
    } else if (selectedShapeIds.length === 0 && activeTab === 'selection') {
      setActiveTab('home');
    }
  }, [selectedShapeIds.length]);

  // Count shapes per IFC category (for filter dropdown badge)
  const ifcCategoryCounts = useMemo(() => {
    const map = new Map<string, number>();
    for (const s of shapes) {
      const cat = getIfcCategory(s);
      if (cat !== 'Other') {
        map.set(cat, (map.get(cat) || 0) + 1);
      }
    }
    return map;
  }, [shapes]);

  // Format the last sync time for display
  const bonsaiLastSyncLabel = useMemo(() => {
    if (!bonsaiLastSync) return 'Never';
    const d = new Date(bonsaiLastSync);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }, [bonsaiLastSync]);

  // Short display of sync path (filename only)
  const bonsaiSyncPathShort = useMemo(() => {
    if (!bonsaiSyncPath) return 'Not set';
    const parts = bonsaiSyncPath.replace(/\\/g, '/').split('/');
    return parts[parts.length - 1] || bonsaiSyncPath;
  }, [bonsaiSyncPath]);

  const builtInTabs: { id: RibbonTab; label: string }[] = [
    { id: 'home', label: 'Home' },
    { id: 'modify', label: 'Modify' },
    { id: 'structural', label: 'AEC' },
    { id: 'view', label: 'View' },
    { id: 'tools', label: 'Tools' },
    { id: '3d', label: '3D' },
    { id: 'ifc', label: 'IFC' },
  ];

  const extTabs = extensionRibbonTabs
    .slice()
    .sort((a, b) => a.order - b.order)
    .map((t) => ({ id: t.id as RibbonTab, label: t.label }));

  const tabs = [...builtInTabs, ...extTabs];

  // Helper: render extension buttons injected into a built-in tab
  const builtInTabIds = new Set(builtInTabs.map((t) => t.id));
  const renderExtensionButtonsForTab = (tabId: string) => {
    const btns = extensionRibbonButtons.filter((b) => b.tab === tabId && builtInTabIds.has(b.tab));
    if (btns.length === 0) return null;

    const groups = new Map<string, typeof btns>();
    for (const btn of btns) {
      const group = groups.get(btn.group) || [];
      group.push(btn);
      groups.set(btn.group, group);
    }

    return Array.from(groups.entries()).map(([groupLabel, groupBtns]) => (
      <RibbonGroup key={`ext-${groupLabel}`} label={groupLabel}>
        {groupBtns.map((btn) => {
          const iconContent = btn.icon
            ? <span dangerouslySetInnerHTML={{ __html: btn.icon }} />
            : <Settings size={btn.size === 'small' ? 14 : btn.size === 'medium' ? 18 : 24} />;

          if (btn.size === 'small') {
            return <RibbonSmallButton key={btn.label} icon={iconContent} label={btn.label} onClick={btn.onClick} shortcut={btn.shortcut} />;
          }
          if (btn.size === 'medium') {
            return <RibbonMediumButton key={btn.label} icon={iconContent} label={btn.label} onClick={btn.onClick} shortcut={btn.shortcut} />;
          }
          return <RibbonButton key={btn.label} icon={iconContent} label={btn.label} onClick={btn.onClick} tooltip={btn.tooltip} shortcut={btn.shortcut} />;
        })}
      </RibbonGroup>
    ));
  };

  return (
    <div className="ribbon-container">
      {/* Ribbon Tabs */}
      <div className="ribbon-tabs">
        <button
          className="ribbon-tab file"
          onClick={onOpenBackstage}
        >
          File
        </button>
        {tabs.map((tab) => (
          <button
            key={tab.id}
            className={`ribbon-tab ${activeTab === tab.id ? 'active' : ''}`}
            onClick={() => {
              setActiveTab(tab.id);
              setIfcDashboardVisible(tab.id === 'ifc');
              setShow3DView(tab.id === '3d');
            }}
          >
            {tab.label}
          </button>
        ))}
        {selectedShapeIds.length > 0 && (
          <button
            className={`ribbon-tab contextual ${activeTab === 'selection' ? 'active' : ''}`}
            onClick={() => setActiveTab('selection')}
          >
            Selection
          </button>
        )}
      </div>

      {/* Ribbon Content */}
      <div className="ribbon-content-container">
        {/* Home Tab */}
        <div className={`ribbon-content ${activeTab === 'home' ? 'active' : ''}`}>
          <div className="ribbon-groups">
            {/* Selection Group */}
            <RibbonGroup label="Selection">
              <RibbonButton
                icon={<MousePointer2 size={24} />}
                label="Select"
                onClick={() => switchToolAndCancelCommand('select')}
                active={activeTool === 'select'}
                shortcut="MD"
              />
              <RibbonButton
                icon={<Hand size={24} />}
                label="Pan"
                onClick={() => switchToolAndCancelCommand('pan')}
                active={activeTool === 'pan'}
              />
              <RibbonButtonStack>
                <RibbonSmallButton
                  icon={<CheckSquare size={14} />}
                  label="Select All"
                  onClick={selectAll}
                  disabled={isSheetMode}
                />
                <RibbonSmallButton
                  icon={<XSquare size={14} />}
                  label="Deselect"
                  onClick={deselectAll}
                  disabled={isSheetMode}
                />
                <RibbonSmallButton
                  icon={<Search size={14} />}
                  label="Find/Replace"
                  onClick={() => setFindReplaceDialogOpen(true)}
                  disabled={isSheetMode}
                  shortcut="Ctrl+H"
                />
              </RibbonButtonStack>
            </RibbonGroup>

            {/* Draw Group */}
            <RibbonGroup label="Draw" noLabels>
              <RibbonMediumButtonStack>
                <RibbonMediumButton
                  icon={<LineIcon size={18} />}
                  label="Line"
                  onClick={() => switchToDrawingTool('line')}
                  active={activeTool === 'line'}
                  disabled={isSheetMode}
                  shortcut="LI"
                />
                <RibbonMediumButton
                  icon={<PolylineIcon size={18} />}
                  label="Polyline"
                  onClick={() => switchToDrawingTool('polyline')}
                  active={activeTool === 'polyline'}
                  disabled={isSheetMode}
                  shortcut="PL"
                />
              </RibbonMediumButtonStack>
              <RibbonMediumButtonStack>
                <RibbonMediumButton
                  icon={<Square size={18} />}
                  label="Rectangle"
                  onClick={() => switchToDrawingTool('rectangle')}
                  active={activeTool === 'rectangle'}
                  disabled={isSheetMode}
                  shortcut="RC"
                />
                <RibbonMediumButton
                  icon={<Circle size={18} />}
                  label="Circle"
                  onClick={() => switchToDrawingTool('circle')}
                  active={activeTool === 'circle'}
                  disabled={isSheetMode}
                  shortcut="CI"
                />
              </RibbonMediumButtonStack>
              <RibbonMediumButtonStack>
                <RibbonMediumButton
                  icon={<ArcIcon size={18} />}
                  label="Arc"
                  onClick={() => switchToDrawingTool('arc')}
                  active={activeTool === 'arc'}
                  disabled={isSheetMode}
                  shortcut="AR"
                />
                <RibbonMediumButton
                  icon={<EllipseIcon size={18} />}
                  label="Ellipse"
                  onClick={() => switchToDrawingTool('ellipse')}
                  active={activeTool === 'ellipse'}
                  disabled={isSheetMode}
                  shortcut="EL"
                />
              </RibbonMediumButtonStack>
              <RibbonMediumButtonStack>
                <RibbonMediumButton
                  icon={<SplineIcon size={18} />}
                  label="Spline"
                  onClick={() => switchToDrawingTool('spline')}
                  active={activeTool === 'spline'}
                  disabled={isSheetMode}
                  shortcut="SP"
                />
                <RibbonMediumButton
                  icon={<FilledRegionIcon size={18} />}
                  label="Filled Region"
                  onClick={() => switchToDrawingTool('hatch')}
                  active={activeTool === 'hatch'}
                  disabled={isSheetMode}
                />
              </RibbonMediumButtonStack>
              <RibbonMediumButtonStack>
                <RibbonMediumButton
                  icon={<Type size={18} />}
                  label="Text"
                  onClick={() => switchToDrawingTool('text')}
                  active={activeTool === 'text'}
                  disabled={isSheetMode}
                  shortcut="TX"
                />
                <RibbonMediumButton
                  icon={<ImageIcon size={18} />}
                  label="Image"
                  onClick={() => switchToDrawingTool('image')}
                  active={activeTool === 'image'}
                  disabled={isSheetMode}
                  shortcut="IM"
                />
              </RibbonMediumButtonStack>
            </RibbonGroup>

            {/* Annotate Group */}
            <RibbonGroup label="Annotate">
              <RibbonButton
                icon={<AlignedDimensionIcon size={24} />}
                label="Aligned"
                onClick={() => {
                  setDimensionMode('aligned');
                  switchToDrawingTool('dimension');
                }}
                active={activeTool === 'dimension' && dimensionMode === 'aligned'}
                disabled={isSheetMode}
                shortcut="DI"
              />
              <RibbonButtonStack>
                <RibbonSmallButton
                  icon={<LinearDimensionIcon size={14} />}
                  label="Linear"
                  onClick={() => {
                    setDimensionMode('linear');
                    switchToDrawingTool('dimension');
                  }}
                  active={activeTool === 'dimension' && dimensionMode === 'linear'}
                  disabled={isSheetMode}
                  shortcut="DL"
                />
                <RibbonSmallButton
                  icon={<AngularDimensionIcon size={14} />}
                  label="Angular"
                  onClick={() => {
                    setDimensionMode('angular');
                    switchToDrawingTool('dimension');
                  }}
                  active={activeTool === 'dimension' && dimensionMode === 'angular'}
                  disabled={isSheetMode}
                  shortcut="DA"
                />
              </RibbonButtonStack>
              <RibbonButtonStack>
                <RibbonSmallButton
                  icon={<RadiusDimensionIcon size={14} />}
                  label="Radius"
                  onClick={() => {
                    setDimensionMode('radius');
                    switchToDrawingTool('dimension');
                  }}
                  active={activeTool === 'dimension' && dimensionMode === 'radius'}
                  disabled={isSheetMode}
                  shortcut="DR"
                />
                <RibbonSmallButton
                  icon={<DiameterDimensionIcon size={14} />}
                  label="Diameter"
                  onClick={() => {
                    setDimensionMode('diameter');
                    switchToDrawingTool('dimension');
                  }}
                  active={activeTool === 'dimension' && dimensionMode === 'diameter'}
                  disabled={isSheetMode}
                  shortcut="DD"
                />
              </RibbonButtonStack>
              <RibbonButtonStack>
                <RibbonSmallButton
                  icon={<LeaderIcon size={14} />}
                  label="Leader"
                  onClick={() => switchToDrawingTool('leader')}
                  active={activeTool === 'leader'}
                  disabled={isSheetMode}
                  shortcut="LE"
                />
                <RibbonSmallButton
                  icon={<TableIcon size={14} />}
                  label="Table"
                  onClick={() => {}}
                  disabled={true}
                />
                <RibbonSmallButton
                  icon={<CloudIcon size={14} />}
                  label="Cloud"
                  onClick={() => {}}
                  disabled={true}
                />
              </RibbonButtonStack>
              <RibbonButton
                icon={<Type size={24} />}
                label="Text Styles"
                onClick={() => setTextStyleManagerOpen(true)}
                disabled={isSheetMode}
                tooltip="Manage text styles"
              />
            </RibbonGroup>

            {/* Modify Group */}
            <RibbonGroup label="Modify">
              <RibbonButtonStack>
                <RibbonSmallButton
                  icon={<ArrowRight size={14} />}
                  label="Move"
                  onClick={() => switchToolAndCancelCommand('move')}
                  active={activeTool === 'move'}
                  disabled={isSheetMode}
                  shortcut="MV"
                />
                <RibbonSmallButton
                  icon={<Copy size={14} />}
                  label="Copy"
                  onClick={() => switchToolAndCancelCommand('copy')}
                  active={activeTool === 'copy'}
                  disabled={isSheetMode}
                  shortcut="CO"
                />
                <RibbonSmallButton
                  icon={<RotateCw size={14} />}
                  label="Rotate"
                  onClick={() => switchToolAndCancelCommand('rotate')}
                  active={activeTool === 'rotate'}
                  disabled={isSheetMode}
                  shortcut="RO"
                />
              </RibbonButtonStack>
              <RibbonButtonStack>
                <RibbonSmallButton
                  icon={<FlipHorizontal size={14} />}
                  label="Mirror"
                  onClick={() => switchToolAndCancelCommand('mirror')}
                  active={activeTool === 'mirror'}
                  disabled={isSheetMode}
                  shortcut="MM"
                />
                <RibbonSmallButton
                  icon={<ArrayIcon size={14} />}
                  label="Array"
                  onClick={() => switchToolAndCancelCommand('array')}
                  active={activeTool === 'array'}
                  disabled={isSheetMode}
                />
                <RibbonSmallButton
                  icon={<ScaleIcon size={14} />}
                  label="Scale"
                  onClick={() => switchToolAndCancelCommand('scale')}
                  active={activeTool === 'scale'}
                  disabled={isSheetMode}
                  shortcut="RE"
                />
              </RibbonButtonStack>
            </RibbonGroup>

            {/* Edit Group */}
            <RibbonGroup label="Edit">
              <RibbonButtonStack>
                <RibbonSmallButton
                  icon={<Scissors size={14} />}
                  label="Trim"
                  onClick={() => switchToolAndCancelCommand('trim')}
                  active={activeTool === 'trim'}
                  disabled={isSheetMode}
                  shortcut="TR"
                />
                <RibbonSmallButton
                  icon={<ExtendIcon size={14} />}
                  label="Extend"
                  onClick={() => switchToolAndCancelCommand('extend')}
                  active={activeTool === 'extend'}
                  disabled={isSheetMode}
                  shortcut="EX"
                />
                <RibbonSmallButton
                  icon={<OffsetIcon size={14} />}
                  label="Offset"
                  onClick={() => switchToolAndCancelCommand('offset')}
                  active={activeTool === 'offset'}
                  disabled={isSheetMode}
                  shortcut="OF"
                />
              </RibbonButtonStack>
              <RibbonButtonStack>
                <RibbonSmallButton
                  icon={<FilletIcon size={14} />}
                  label="Fillet"
                  onClick={() => switchToolAndCancelCommand('fillet')}
                  active={activeTool === 'fillet'}
                  disabled={isSheetMode}
                  shortcut="FL"
                />
                <RibbonSmallButton
                  icon={<ChamferIcon size={14} />}
                  label="Chamfer"
                  onClick={() => switchToolAndCancelCommand('chamfer')}
                  active={activeTool === 'chamfer'}
                  disabled={isSheetMode}
                />
                <RibbonSmallButton
                  icon={<SplitIcon size={14} />}
                  label="Split"
                  onClick={() => {}}
                  disabled={true}
                />
              </RibbonButtonStack>
              <RibbonButtonStack>
                <RibbonSmallButton
                  icon={<BreakIcon size={14} />}
                  label="Break"
                  onClick={() => {}}
                  disabled={true}
                />
                <RibbonSmallButton
                  icon={<JoinIcon size={14} />}
                  label="Join"
                  onClick={() => {}}
                  disabled={true}
                />
                <RibbonSmallButton
                  icon={<ExplodeIcon size={14} />}
                  label="Explode"
                  onClick={() => {}}
                  disabled={true}
                />
              </RibbonButtonStack>
              <RibbonButtonStack>
                <RibbonSmallButton
                  icon={<StretchIcon size={14} />}
                  label="Stretch"
                  onClick={() => switchToolAndCancelCommand('elastic')}
                  active={activeTool === 'elastic'}
                  disabled={isSheetMode}
                  shortcut="E"
                />
                <RibbonSmallButton
                  icon={<LengthenIcon size={14} />}
                  label="Lengthen"
                  onClick={() => {}}
                  disabled={true}
                />
                <RibbonSmallButton
                  icon={<AlignIcon size={14} />}
                  label="Align"
                  onClick={() => switchToolAndCancelCommand('align')}
                  active={activeTool === 'align'}
                  disabled={isSheetMode}
                  shortcut="AL"
                />
              </RibbonButtonStack>
              <RibbonSmallButton
                icon={<PinIcon size={14} />}
                label="Pin"
                onClick={() => {}}
                disabled={true}
              />
            </RibbonGroup>

            {renderExtensionButtonsForTab('home')}
          </div>
        </div>

        {/* Modify Tab */}
        <div className={`ribbon-content ${activeTab === 'modify' ? 'active' : ''}`}>
          <div className="ribbon-groups">
            <RibbonGroup label="Region">
              <RibbonButton
                icon={<HatchIcon size={24} />}
                label="Pattern Manager"
                onClick={() => setPatternManagerOpen(true)}
                disabled={isSheetMode}
                tooltip="Manage hatch patterns"
              />
              <RibbonButton
                icon={<InsulationIcon size={24} />}
                label="Insulation"
                onClick={() => {}}
                disabled={true}
              />
              <RibbonButton
                icon={<DetailComponentIcon size={24} />}
                label="Detail Component"
                onClick={() => {}}
                disabled={true}
              />
            </RibbonGroup>

            <RibbonGroup label="Clipboard">
              <RibbonButton
                icon={<ClipboardPaste size={24} />}
                label="Paste"
                onClick={() => pasteShapes()}
                disabled={isSheetMode || !hasClipboardContent()}
                shortcut="Ctrl+V"
              />
              <RibbonButtonStack>
                <RibbonSmallButton
                  icon={<Scissors size={14} />}
                  label="Cut"
                  onClick={cutSelectedShapes}
                  disabled={isSheetMode || selectedShapeIds.length === 0}
                  shortcut="Ctrl+X"
                />
                <RibbonSmallButton
                  icon={<Copy size={14} />}
                  label="Copy"
                  onClick={copySelectedShapes}
                  disabled={isSheetMode || selectedShapeIds.length === 0}
                  shortcut="Ctrl+C"
                />
                <RibbonSmallButton
                  icon={<Trash2 size={14} />}
                  label="Delete"
                  onClick={deleteSelectedShapes}
                  disabled={isSheetMode || selectedShapeIds.length === 0}
                  shortcut="Del"
                />
              </RibbonButtonStack>
            </RibbonGroup>
            {renderExtensionButtonsForTab('modify')}
          </div>
        </div>

        {/* Structural Tab */}
        <div className={`ribbon-content ${activeTab === 'structural' ? 'active' : ''}`}>
          <div className="ribbon-groups">
            <RibbonGroup label="Elements">
              <RibbonButton
                icon={<BeamIcon size={24} />}
                label="IfcBeam"
                onClick={() => openBeamDialog()}
                disabled={isSheetMode}
                tooltip="Insert IfcColumn section or draw IfcBeam"
                shortcut="BE"
              />
              <RibbonButton
                icon={<WallIcon size={24} />}
                label="IfcWall"
                onClick={() => {
                  const defaultTypeId = lastUsedWallTypeId ?? 'beton-200';
                  const wt = wallTypes.find(w => w.id === defaultTypeId);
                  setPendingWall({
                    thickness: wt?.thickness ?? 200,
                    wallTypeId: defaultTypeId,
                    justification: 'center',
                    showCenterline: true,
                    startCap: 'butt',
                    endCap: 'butt',
                    continueDrawing: true,
                    shapeMode: 'line',
                    spaceBounding: true,
                  });
                  switchToDrawingTool('wall');
                }}
                disabled={isSheetMode}
                tooltip="Draw IfcWall"
                shortcut="WA"
              />
              <RibbonButton
                icon={<SlabIcon size={24} />}
                label="IfcSlab"
                onClick={() => {
                  setPendingSlab({
                    thickness: 200,
                    level: '0',
                    elevation: 0,
                    material: 'concrete',
                    shapeMode: 'line',
                  });
                  switchToDrawingTool('slab');
                }}
                active={activeTool === 'slab'}
                disabled={isSheetMode}
                tooltip="Draw IfcSlab (closed polygon with hatch)"
                shortcut="SL"
              />
              <RibbonButton
                icon={<PlateSystemIcon size={24} />}
                label="IfcPlateSystem"
                onClick={openPlateSystemDialog}
                disabled={isSheetMode}
                tooltip="Draw IfcElementAssembly plate system (timber floor, HSB wall, ceiling)"
                shortcut="PS"
              />
              <RibbonButton
                icon={<PileIcon size={24} />}
                label="IfcPile"
                onClick={openPileDialog}
                disabled={isSheetMode}
                tooltip="Place IfcPile (IfcDeepFoundation)"
                shortcut="PI"
              />
              <RibbonButton
                icon={<CPTIcon size={24} />}
                label="CPT"
                onClick={() => {
                  setPendingCPT({
                    name: 'CPT-01',
                    fontSize: 150,
                    markerSize: 300,
                  });
                  switchToDrawingTool('cpt');
                }}
                active={activeTool === 'cpt'}
                disabled={isSheetMode}
                tooltip="Place CPT (Cone Penetration Test) marker for pile plan"
                shortcut="CT"
              />
              <RibbonButton
                icon={<SpaceIcon size={24} />}
                label="IfcSpace"
                onClick={() => {
                  setPendingSpace({
                    name: 'Room',
                    fillColor: '#00ff00',
                    fillOpacity: 0.1,
                  });
                  switchToDrawingTool('space');
                }}
                active={activeTool === 'space'}
                disabled={isSheetMode}
                tooltip="Detect and place IfcSpace (room) from surrounding walls"
                shortcut="RM"
              />
            </RibbonGroup>

            {(activeTool === 'wall' || activeTool === 'beam' || activeTool === 'slab' || activeTool === 'plate-system') && (() => {
              const mode: ShapeMode =
                activeTool === 'wall' ? (pendingWall?.shapeMode ?? 'line') :
                activeTool === 'beam' ? (pendingBeam?.shapeMode ?? 'line') :
                activeTool === 'slab' ? (pendingSlab?.shapeMode ?? 'line') :
                (pendingPlateSystem?.shapeMode ?? 'line');
              const handleShapeModeChange = (m: ShapeMode) => {
                // Clear any in-progress drawing points and preview when switching shape mode
                clearDrawingPoints();
                setDrawingPreview(null);
                if (activeTool === 'wall' && pendingWall) {
                  setPendingWall({ ...pendingWall, shapeMode: m });
                } else if (activeTool === 'beam' && pendingBeam) {
                  setPendingBeam({ ...pendingBeam, shapeMode: m });
                } else if (activeTool === 'slab' && pendingSlab) {
                  setPendingSlab({ ...pendingSlab, shapeMode: m });
                } else if (activeTool === 'plate-system' && pendingPlateSystem) {
                  setPendingPlateSystem({ ...pendingPlateSystem, shapeMode: m });
                }
              };
              return (
                <ShapeModeSelector mode={mode} onChange={handleShapeModeChange} />
              );
            })()}

            <RibbonGroup label="Annotations">
              <RibbonButton
                icon={<GridLineIcon size={24} />}
                label="IfcGrid"
                onClick={() => {
                  setPendingGridline({ label: '1', bubblePosition: 'both', bubbleRadius: 300, fontSize: 250 });
                  switchToDrawingTool('gridline');
                }}
                disabled={isSheetMode}
                tooltip="Draw IfcGrid axis line (stramien)"
                shortcut="GL"
              />
              <RibbonButton
                icon={<LabelIcon size={24} />}
                label="Label"
                onClick={() => switchToDrawingTool('label')}
                active={activeTool === 'label'}
                disabled={isSheetMode}
                tooltip="Place structural label with leader line"
                shortcut="LB"
              />
              <RibbonButton
                icon={<LevelIcon size={24} />}
                label="2DLevel"
                onClick={() => {
                  setPendingLevel({ label: '0', labelPosition: 'end', bubbleRadius: 400, fontSize: 250, elevation: 0, peil: 0 });
                  switchToDrawingTool('level');
                }}
                disabled={isSheetMode}
                tooltip="Draw 2D level marker (annotation level)"
                shortcut="LV"
              />
              <RibbonButton
                icon={<SpotElevationIcon size={24} />}
                label="IfcSpotElevation"
                onClick={() => switchToDrawingTool('spot-elevation')}
                active={activeTool === 'spot-elevation'}
                disabled={isSheetMode}
                tooltip="Place spot elevation marker with elevation label"
                shortcut="SE"
              />
              <RibbonButton
                icon={<SectionDetailIcon size={24} />}
                label="Section/Detail"
                onClick={() => {
                  setPendingSectionCallout({ label: getNextSectionLabel(), bubbleRadius: 400, fontSize: 250, flipDirection: false, viewDepth: 5000 });
                  switchToDrawingTool('section-callout');
                }}
                active={activeTool === 'section-callout'}
                disabled={isSheetMode}
                tooltip="Create section or detail callout"
                shortcut="SD"
              />
            </RibbonGroup>

            <RibbonGroup label="Connections">
              <RibbonButton
                icon={<MiterJoinIcon size={24} />}
                label="Join"
                onClick={() => switchToolAndCancelCommand('trim-walls')}
                active={activeTool === 'trim-walls'}
                disabled={isSheetMode}
                tooltip="Miter join walls, beams or ducts at intersection (verstek)"
                shortcut="TW"
              />
            </RibbonGroup>

            <RibbonGroup label="Properties">
              <RibbonButton
                icon={<Palette size={24} />}
                label="Materials"
                onClick={openMaterialsDialog}
                disabled={isSheetMode}
                tooltip="Manage materials and wall types"
              />
              <RibbonButton
                icon={<Settings size={24} />}
                label="IfcTypes"
                onClick={openWallTypesDialog}
                disabled={isSheetMode}
                tooltip="Manage IFC type definitions (walls, slabs)"
              />
              <RibbonButton
                icon={<FolderTree size={24} />}
                label="Project"
                onClick={openProjectStructureDialog}
                tooltip="Manage IFC project spatial hierarchy (Site / Building / Storey)"
              />
            </RibbonGroup>
            {renderExtensionButtonsForTab('structural')}
          </div>
        </div>

        {/* View Tab */}
        <div className={`ribbon-content ${activeTab === 'view' ? 'active' : ''}`}>
          <div className="ribbon-groups">
            <RibbonGroup label="Navigate">
              <RibbonButton
                icon={<Hand size={24} />}
                label="Pan"
                onClick={() => switchToolAndCancelCommand('pan')}
                active={activeTool === 'pan'}
              />
            </RibbonGroup>

            <RibbonGroup label="Zoom">
              <RibbonButton
                icon={<ZoomIn size={24} />}
                label="Zoom In"
                onClick={zoomIn}
              />
              <RibbonButton
                icon={<ZoomOut size={24} />}
                label="Zoom Out"
                onClick={zoomOut}
              />
              <RibbonButton
                icon={<Maximize size={24} />}
                label="Fit All"
                onClick={zoomToFit}
              />
            </RibbonGroup>

            <RibbonGroup label="Display">
              <RibbonButton
                icon={<Grid3X3 size={24} />}
                label="Grid"
                onClick={toggleGrid}
                active={gridVisible}
              />
              <RibbonButton
                icon={<Sun size={24} />}
                label="White Background"
                onClick={toggleWhiteBackground}
                active={whiteBackground}
              />
              <RibbonButton
                icon={<RotateCw size={24} />}
                label="Rotation Gizmo"
                onClick={toggleRotationGizmo}
                active={showRotationGizmo}
                tooltip="Show rotation handle on selected objects"
              />
            </RibbonGroup>

            <RibbonGroup label="Filter">
              <div ref={ifcFilterRef} style={{ position: 'relative', display: 'inline-block' }}>
                <RibbonButton
                  icon={hiddenIfcCategories.length > 0 ? <EyeOff size={24} /> : <Layers size={24} />}
                  label="IFC Filter"
                  onClick={() => setIfcFilterOpen(!ifcFilterOpen)}
                  active={ifcFilterOpen || hiddenIfcCategories.length > 0}
                  tooltip={hiddenIfcCategories.length > 0
                    ? `IFC category filter — ${hiddenIfcCategories.length} categor${hiddenIfcCategories.length === 1 ? 'y' : 'ies'} hidden`
                    : 'Show/hide IFC categories from the model view'}
                />
                {ifcFilterOpen && (
                  <div
                    className="absolute top-full left-0 mt-1 z-50 bg-cad-panel border border-cad-border rounded shadow-lg"
                    style={{ minWidth: 260 }}
                  >
                    <div className="px-3 py-2 border-b border-cad-border flex items-center justify-between">
                      <span className="text-xs font-semibold text-cad-text">IFC Categories</span>
                      <div className="flex gap-1">
                        <button
                          onClick={() => setHiddenIfcCategories([])}
                          className="px-2 py-0.5 text-[10px] bg-cad-bg border border-cad-border text-cad-text hover:bg-cad-hover rounded"
                        >
                          Show All
                        </button>
                        <button
                          onClick={() => setHiddenIfcCategories([...ALL_IFC_CATEGORIES])}
                          className="px-2 py-0.5 text-[10px] bg-cad-bg border border-cad-border text-cad-text hover:bg-cad-hover rounded"
                        >
                          Hide All
                        </button>
                      </div>
                    </div>
                    <div className="py-1">
                      {ALL_IFC_CATEGORIES.map(cat => {
                        const isVisible = !hiddenIfcCategories.includes(cat);
                        const count = ifcCategoryCounts.get(cat) || 0;
                        return (
                          <button
                            key={cat}
                            className={`w-full flex items-center gap-2 px-3 py-1 text-xs hover:bg-cad-hover ${!isVisible ? 'opacity-50' : ''}`}
                            onClick={() => toggleIfcCategoryVisibility(cat)}
                          >
                            {isVisible
                              ? <Eye size={12} className="text-cad-accent flex-shrink-0" />
                              : <EyeOff size={12} className="text-cad-text-dim flex-shrink-0" />
                            }
                            <span className="text-cad-text flex-1 text-left">{IFC_CATEGORY_LABELS[cat] || cat}</span>
                            <span className="text-cad-text-dim text-[10px] font-mono">{count}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            </RibbonGroup>

            <RibbonGroup label="Appearance">
              <RibbonButton
                icon={<Palette size={24} />}
                label="Theme"
                onClick={() => {}}
                tooltip="Change UI theme"
              />
              <ThemeSelector
                currentTheme={uiTheme}
                onThemeChange={setUITheme}
              />
            </RibbonGroup>
            <RibbonGroup label="Panels">
              <RibbonButton
                icon={<span className="text-[11px] font-mono font-bold leading-none">IFC</span>}
                label="IFC Model"
                onClick={() => setIfcPanelOpen(!ifcPanelOpen)}
                active={ifcPanelOpen}
                tooltip="Toggle IFC model panel — view generated IFC4 STEP file"
              />
            </RibbonGroup>
            {renderExtensionButtonsForTab('view')}
          </div>
        </div>

        {/* Tools Tab */}
        <div className={`ribbon-content ${activeTab === 'tools' ? 'active' : ''}`}>
          <div className="ribbon-groups">
            <RibbonGroup label="Settings">
              <RibbonButton
                icon={<Settings size={24} />}
                label="Settings"
                onClick={() => openSettings()}
              />
            </RibbonGroup>

            <RibbonGroup label="Output">
              <RibbonButton
                icon={<Printer size={24} />}
                label="Print"
                onClick={() => setPrintDialogOpen(true)}
              />
            </RibbonGroup>
            {renderExtensionButtonsForTab('tools')}
          </div>
        </div>

        {/* 3D Tab */}
        <div className={`ribbon-content ${activeTab === '3d' ? 'active' : ''}`}>
          <div className="ribbon-groups">
            {/* View Group */}
            <RibbonGroup label="View">
              <RibbonButton
                icon={<Box size={24} />}
                label="3D View"
                onClick={() => setShow3DView(!show3DView)}
                active={show3DView}
                tooltip="Switch to 3D perspective view"
              />
              <RibbonButton
                icon={<Orbit size={24} />}
                label="Orbit"
                onClick={() => {}}
                disabled={true}
                tooltip="Orbit (coming soon)"
              />
              <RibbonButton
                icon={<Footprints size={24} />}
                label="Walk"
                onClick={() => {}}
                disabled={true}
                tooltip="Walk (coming soon)"
              />
            </RibbonGroup>

            {/* Display Group */}
            <RibbonGroup label="Display">
              <RibbonButton
                icon={<Layers size={24} />}
                label="Wireframe"
                onClick={() => setViewMode3D('wireframe')}
                active={viewMode3D === 'wireframe'}
                disabled={!show3DView}
                tooltip={show3DView ? 'Wireframe display mode' : 'Wireframe (enable 3D View first)'}
              />
              <RibbonButton
                icon={<Eye size={24} />}
                label="Shaded"
                onClick={() => setViewMode3D('shaded')}
                active={viewMode3D === 'shaded'}
                disabled={!show3DView}
                tooltip={show3DView ? 'Shaded/solid display mode' : 'Shaded (enable 3D View first)'}
              />
              <RibbonButton
                icon={<EyeOff size={24} />}
                label="Hidden Line"
                onClick={() => setViewMode3D('hidden-line')}
                active={viewMode3D === 'hidden-line'}
                disabled={!show3DView}
                tooltip={show3DView ? 'Hidden line removal mode' : 'Hidden Line (enable 3D View first)'}
              />
            </RibbonGroup>

            {/* Export Group */}
            <RibbonGroup label="Export">
              <RibbonButton
                icon={<Download size={24} />}
                label="Export IFC"
                onClick={handleExportIFC}
                tooltip="Export current model as IFC file"
              />
              <RibbonButton
                icon={<FileText size={24} />}
                label="Export 3D PDF"
                onClick={() => {}}
                disabled={true}
                tooltip="Export 3D PDF (coming soon)"
              />
            </RibbonGroup>
            {renderExtensionButtonsForTab('3d')}
          </div>
        </div>

        {/* IFC Tab */}
        <div className={`ribbon-content ${activeTab === 'ifc' ? 'active' : ''}`}>
          <div className="ribbon-groups" style={{ alignItems: 'stretch' }}>
            {/* Spatial Structure Tree */}
            <RibbonGroup label="Spatial Structure">
              <div className="ifc-tree-ribbon-wrapper">
                <IfcSpatialTree shapes={shapes} projectStructure={projectStructure} />
              </div>
            </RibbonGroup>

            {/* Actions */}
            <RibbonGroup label="Actions">
              <RibbonButton
                icon={<Download size={24} />}
                label="Export IFC"
                onClick={handleExportIFC}
                tooltip="Export current model as IFC4 STEP file"
              />
              <RibbonButton
                icon={<span className="text-[11px] font-mono font-bold leading-none">IFC</span>}
                label="IFC Model"
                onClick={() => setIfcPanelOpen(!ifcPanelOpen)}
                active={ifcPanelOpen}
                tooltip="Toggle IFC STEP file viewer panel"
              />
              <RibbonButtonStack>
                <RibbonSmallButton
                  icon={<RotateCw size={14} />}
                  label="Regenerate"
                  onClick={() => regenerateIFC()}
                />
                <RibbonSmallButton
                  icon={<FolderTree size={14} />}
                  label="Project"
                  onClick={openProjectStructureDialog}
                />
              </RibbonButtonStack>
            </RibbonGroup>

            {/* Stats */}
            <RibbonGroup label="Statistics">
              <div className="ifc-stats-group">
                <div className="ifc-stat-row">
                  <span className="ifc-stat-label">Entities:</span>
                  <span className="ifc-stat-value">{ifcEntityCount}</span>
                </div>
                <div className="ifc-stat-row">
                  <span className="ifc-stat-label">Size:</span>
                  <span className="ifc-stat-value">{ifcFileSize < 1024 ? `${ifcFileSize} B` : ifcFileSize < 1048576 ? `${(ifcFileSize / 1024).toFixed(1)} KB` : `${(ifcFileSize / 1048576).toFixed(2)} MB`}</span>
                </div>
                <div className="ifc-stat-row">
                  <span className="ifc-stat-label">Schema:</span>
                  <span className="ifc-stat-value">IFC4</span>
                </div>
              </div>
            </RibbonGroup>
            {/* Bonsai Sync */}
            <RibbonGroup label="Bonsai Sync">
              <RibbonButton
                icon={bonsaiSyncEnabled ? <Link2 size={24} /> : <Unlink size={24} />}
                label={bonsaiSyncEnabled ? 'Syncing' : 'Sync Off'}
                onClick={handleBonsaiSyncToggle}
                active={bonsaiSyncEnabled}
                tooltip={bonsaiSyncEnabled
                  ? 'Bonsai Sync is active -- click to disable'
                  : 'Enable Bonsai Sync to auto-export IFC for Blender/Bonsai'}
              />
              <RibbonButtonStack>
                <RibbonSmallButton
                  icon={<FolderOpen size={14} />}
                  label="Set Path"
                  onClick={handleBonsaiSetPath}
                />
                <RibbonSmallButton
                  icon={<RefreshCw size={14} />}
                  label="Sync Now"
                  onClick={handleBonsaiSyncNow}
                  disabled={!bonsaiSyncPath}
                />
                <RibbonSmallButton
                  icon={<ClipboardCopy size={14} />}
                  label={scriptCopied ? 'Copied!' : 'Copy Script'}
                  onClick={handleCopyBlenderScript}
                />
              </RibbonButtonStack>
              <div className="bonsai-sync-status">
                <div className="bonsai-sync-indicator-row">
                  <span className={`bonsai-sync-dot ${bonsaiSyncEnabled ? (bonsaiSyncStatus === 'error' ? 'error' : bonsaiSyncStatus === 'syncing' ? 'syncing' : 'active') : 'inactive'}`} />
                  <span className="bonsai-sync-status-text">
                    {!bonsaiSyncEnabled ? 'Disabled' : bonsaiSyncStatus === 'syncing' ? 'Writing...' : bonsaiSyncStatus === 'error' ? 'Error' : 'Ready'}
                  </span>
                </div>
                <div className="bonsai-sync-info-row" title={bonsaiSyncPath || 'No path set'}>
                  <span className="bonsai-sync-info-label">File:</span>
                  <span className="bonsai-sync-info-value">{bonsaiSyncPathShort}</span>
                </div>
                <div className="bonsai-sync-info-row">
                  <span className="bonsai-sync-info-label">Last:</span>
                  <span className="bonsai-sync-info-value">{bonsaiLastSyncLabel}</span>
                </div>
                {bonsaiSyncError && (
                  <div className="bonsai-sync-info-row bonsai-sync-error-row" title={bonsaiSyncError}>
                    <span className="bonsai-sync-info-value bonsai-sync-error-text">{bonsaiSyncError}</span>
                  </div>
                )}
              </div>
              {/* Info popover toggle */}
              <div className="bonsai-sync-info-toggle" ref={bonsaiInfoRef}>
                <button
                  className="bonsai-sync-info-btn"
                  onClick={() => setShowBonsaiInfo(!showBonsaiInfo)}
                  title="How to set up Bonsai Live Sync"
                >
                  <Info size={14} />
                </button>
                {showBonsaiInfo && (
                  <div className="bonsai-sync-info-popover">
                    <div className="bonsai-sync-info-popover-title">Bonsai Live Sync Setup</div>
                    <ol className="bonsai-sync-info-steps">
                      <li>Click <strong>Set Path</strong> to choose where the IFC file will be written.</li>
                      <li>Click <strong>Copy Script</strong> to copy the Blender watcher script.</li>
                      <li>In Blender, open the <strong>Scripting</strong> workspace.</li>
                      <li>Click <strong>New</strong>, paste the script, and press <strong>Alt+P</strong> to run it.</li>
                      <li>Toggle <strong>Syncing</strong> on. Every model change will auto-export the IFC file.</li>
                      <li>The Blender script detects the file change and reloads the model in Bonsai.</li>
                    </ol>
                    <div className="bonsai-sync-info-note">
                      The watcher script polls the file every second. It uses Bonsai's <code>bpy.ops.bim.load_project()</code> to reload.
                    </div>
                  </div>
                )}
              </div>
            </RibbonGroup>

            {renderExtensionButtonsForTab('ifc')}
          </div>
        </div>

        {/* Selection Tab (contextual — visible only when shapes are selected) */}
        <div className={`ribbon-content ${activeTab === 'selection' ? 'active' : ''}`}>
          <div className="ribbon-groups">
            <RibbonGroup label="Draw Order">
              <RibbonButtonStack>
                <RibbonSmallButton
                  icon={<ArrowUpToLine size={14} />}
                  label="Bring Front"
                  onClick={bringToFront}
                  disabled={isSheetMode || selectedShapeIds.length === 0}
                />
                <RibbonSmallButton
                  icon={<ArrowUp size={14} />}
                  label="Bring Fwd"
                  onClick={bringForward}
                  disabled={isSheetMode || selectedShapeIds.length === 0}
                />
              </RibbonButtonStack>
              <RibbonButtonStack>
                <RibbonSmallButton
                  icon={<ArrowDown size={14} />}
                  label="Send Bwd"
                  onClick={sendBackward}
                  disabled={isSheetMode || selectedShapeIds.length === 0}
                />
                <RibbonSmallButton
                  icon={<ArrowDownToLine size={14} />}
                  label="Send Back"
                  onClick={sendToBack}
                  disabled={isSheetMode || selectedShapeIds.length === 0}
                />
              </RibbonButtonStack>
            </RibbonGroup>
          </div>
        </div>

        {/* Extension Tabs — render buttons grouped by group for each extension tab */}
        {extTabs.map((extTab) => {
          const buttonsForTab = extensionRibbonButtons.filter((b) => b.tab === extTab.id);
          const groups = new Map<string, typeof buttonsForTab>();
          for (const btn of buttonsForTab) {
            const group = groups.get(btn.group) || [];
            group.push(btn);
            groups.set(btn.group, group);
          }

          return (
            <div key={extTab.id} className={`ribbon-content ${activeTab === extTab.id ? 'active' : ''}`}>
              <div className="ribbon-groups">
                {Array.from(groups.entries()).map(([groupLabel, btns]) => (
                  <RibbonGroup key={groupLabel} label={groupLabel}>
                    {btns.map((btn) => {
                      const iconContent = btn.icon
                        ? <span dangerouslySetInnerHTML={{ __html: btn.icon }} />
                        : <Settings size={btn.size === 'small' ? 14 : btn.size === 'medium' ? 18 : 24} />;

                      if (btn.size === 'small') {
                        return (
                          <RibbonSmallButton
                            key={btn.label}
                            icon={iconContent}
                            label={btn.label}
                            onClick={btn.onClick}
                            shortcut={btn.shortcut}
                          />
                        );
                      }
                      if (btn.size === 'medium') {
                        return (
                          <RibbonMediumButton
                            key={btn.label}
                            icon={iconContent}
                            label={btn.label}
                            onClick={btn.onClick}
                            shortcut={btn.shortcut}
                          />
                        );
                      }
                      return (
                        <RibbonButton
                          key={btn.label}
                          icon={iconContent}
                          label={btn.label}
                          onClick={btn.onClick}
                          tooltip={btn.tooltip}
                          shortcut={btn.shortcut}
                        />
                      );
                    })}
                  </RibbonGroup>
                ))}
              </div>
            </div>
          );
        })}

      </div>

      {/* Combined Quick Access + Selection Filter Bar - always visible, fixed height */}
      <div className="quick-access-bar">
        <QuickAccessBar />
        <SelectionFilterBar />
      </div>
    </div>
  );
});
