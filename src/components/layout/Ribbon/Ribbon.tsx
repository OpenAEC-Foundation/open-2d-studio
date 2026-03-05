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
  Settings,
  ClipboardPaste,
  ChevronDown,
  CheckSquare,
  XSquare,
  Sun,
  Check,
  Palette,
  Search,
  ImageIcon,
  Layers,
  Eye,
  EyeOff,
  Download,
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
} from '../../shared/CadIcons';
import { useFileOperations } from '../../../hooks/file/useFileOperations';
import { triggerBonsaiSync, saveBonsaiSyncSettings, generateBlenderWatcherScript } from '../../../services/bonsaiSync';
import { ALL_IFC_CATEGORIES, IFC_CATEGORY_LABELS, getIfcCategory } from '../../../utils/ifcCategoryUtils';
import { RibbonButton, RibbonSmallButton, RibbonMediumButton, RibbonMediumButtonStack, RibbonGroup, RibbonButtonStack } from './RibbonComponents';
import './Ribbon.css';
type RibbonTab = 'home' | 'modify' | 'structural' | 'view' | string;

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
interface RibbonProps {
  onOpenAppMenu: () => void;
  hidden?: boolean;
}

export const Ribbon = memo(function Ribbon({ onOpenAppMenu, hidden }: RibbonProps) {
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
    // Clipboard
    copySelectedShapes,
    cutSelectedShapes,
    pasteShapes,
    hasClipboardContent,

    selectAll,
    deselectAll,
    setFindReplaceDialogOpen,
    editorMode,
    setPatternManagerOpen,
    setTextStyleManagerOpen,

    // Theme
    uiTheme,
    setUITheme,

    // Extensions
    extensionRibbonTabs,
    extensionRibbonButtons,

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

    shapes,
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

  } = useAppStore();

  const isSheetMode = editorMode !== 'drawing';

  const { handleExportIFC, handleExportToFolder } = useFileOperations();

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
    { id: 'view', label: 'View' },
    { id: 'ifc', label: 'IFC' },
  ];

  const extTabs = extensionRibbonTabs
    .slice()
    .sort((a, b) => a.order - b.order)
    .map((t) => ({ id: t.id as RibbonTab, label: t.label, render: t.render }));

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

  if (hidden) return null;

  return (
    <div className="ribbon-container">
      {/* Ribbon Tabs */}
      <div className="ribbon-tabs">
        <button
          className="ribbon-tab file"
          onClick={onOpenAppMenu}
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
            }}
          >
            {tab.label}
          </button>
        ))}
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
            <RibbonGroup label="Annotate" expandContent={
              <>
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
              </>
            }>
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
            <RibbonGroup label="Edit" expandContent={
              <>
                <RibbonButtonStack>
                  <RibbonSmallButton
                    icon={<SplitIcon size={14} />}
                    label="Split"
                    onClick={() => {}}
                    disabled={true}
                  />
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
                </RibbonButtonStack>
                <RibbonButtonStack>
                  <RibbonSmallButton
                    icon={<ExplodeIcon size={14} />}
                    label="Explode"
                    onClick={() => {}}
                    disabled={true}
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
              </>
            }>
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
                  icon={<StretchIcon size={14} />}
                  label="Stretch"
                  onClick={() => switchToolAndCancelCommand('elastic')}
                  active={activeTool === 'elastic'}
                  disabled={isSheetMode}
                  shortcut="E"
                />
              </RibbonButtonStack>
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
                    className="absolute top-full left-0 mt-1 z-50 bg-cad-surface-elevated border border-cad-border rounded shadow-lg"
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

        {/* IFC Tab */}
        <div className={`ribbon-content ${activeTab === 'ifc' ? 'active' : ''}`}>
          <div className="ribbon-groups" style={{ alignItems: 'stretch' }}>
            {/* Actions */}
            <RibbonGroup label="Actions">
              <RibbonButton
                icon={<Download size={24} />}
                label="Export IFC"
                onClick={handleExportIFC}
                tooltip="Export current model as IFC4 STEP file"
              />
              <RibbonButton
                icon={<FolderOpen size={24} />}
                label="Export Map"
                onClick={handleExportToFolder}
                tooltip="Export alle formaten (SVG, DXF, IFC, JSON) naar een lokale map"
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

        {/* Extension Tabs — render custom content or auto-generate from buttons */}
        {extTabs.map((extTab) => {
          // Custom render function takes precedence
          if (extTab.render) {
            return (
              <div key={extTab.id} className={`ribbon-content ${activeTab === extTab.id ? 'active' : ''}`}>
                {extTab.render()}
              </div>
            );
          }

          // Auto-generate from registered buttons
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

    </div>
  );
});
