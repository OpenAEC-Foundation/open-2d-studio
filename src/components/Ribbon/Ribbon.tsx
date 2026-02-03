import { useState, useRef, useEffect, memo, useCallback } from 'react';
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
  CheckSquare,
  XSquare,
  Sun,
} from 'lucide-react';
import { useAppStore } from '../../state/appStore';
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
  DivideIcon,
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
  SteelSectionIcon,
} from '../shared/CadIcons';
import './Ribbon.css';

/**
 * Custom tooltip component - renders below the hovered element
 */
function RibbonTooltip({ label, shortcut, parentRef }: { label: string; shortcut?: string; parentRef: React.RefObject<HTMLElement> }) {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);

  useEffect(() => {
    if (parentRef.current) {
      const rect = parentRef.current.getBoundingClientRect();
      setPos({ x: rect.left + rect.width / 2, y: rect.bottom + 4 });
    }
  }, [parentRef]);

  if (!pos) return null;

  return (
    <div
      style={{
        position: 'fixed',
        left: pos.x,
        top: pos.y,
        transform: 'translateX(-50%)',
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

type RibbonTab = 'home' | 'modify' | 'structural' | 'view' | 'tools';

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

interface DropdownOption {
  id: string;
  label: string;
}

interface RibbonDropdownButtonProps {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  active?: boolean;
  options: DropdownOption[];
  selectedOption: string;
  onOptionSelect: (optionId: string) => void;
  shortcut?: string;
}

function RibbonDropdownButton({
  icon,
  label,
  onClick,
  active,
  options,
  selectedOption,
  onOptionSelect,
  shortcut,
}: RibbonDropdownButtonProps) {
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

  const selectedOptionLabel = options.find(o => o.id === selectedOption)?.label || '';
  const tt = useTooltip();

  return (
    <div className="ribbon-dropdown-container" ref={dropdownRef}>
      <button
        ref={tt.ref}
        className={`ribbon-btn has-dropdown ${active ? 'active' : ''}`}
        onClick={onClick}
        onMouseEnter={tt.onEnter}
        onMouseLeave={tt.onLeave}
      >
        <span className="ribbon-btn-icon">{icon}</span>
        <span className="ribbon-btn-label">{label}</span>
      </button>
      <button
        className={`ribbon-dropdown-trigger ${active ? 'active' : ''}`}
        onClick={() => setIsOpen(!isOpen)}
        title="More options"
      >
        <ChevronDown size={12} />
      </button>

      {isOpen && (
        <div className="ribbon-dropdown-menu">
          {options.map((option) => (
            <button
              key={option.id}
              className={`ribbon-dropdown-item ${selectedOption === option.id ? 'selected' : ''}`}
              onClick={() => {
                onOptionSelect(option.id);
                setIsOpen(false);
                onClick();
              }}
            >
              {selectedOption === option.id && <span className="checkmark">✓</span>}
              <span className={selectedOption !== option.id ? 'no-check' : ''}>{option.label}</span>
            </button>
          ))}
        </div>
      )}
      {tt.show && !isOpen && <RibbonTooltip label={`${label} (${selectedOptionLabel})`} shortcut={shortcut} parentRef={tt.ref as React.RefObject<HTMLElement>} />}
    </div>
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

function RibbonGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="ribbon-group">
      <div className="ribbon-group-content">{children}</div>
      <div className="ribbon-group-label">{label}</div>
    </div>
  );
}

function RibbonButtonStack({ children }: { children: React.ReactNode }) {
  return <div className="ribbon-btn-stack">{children}</div>;
}

interface RibbonProps {
  onOpenBackstage: () => void;
}

export const Ribbon = memo(function Ribbon({ onOpenBackstage }: RibbonProps) {
  const [activeTab, setActiveTab] = useState<RibbonTab>('home');

  const {
    activeTool,
    switchToDrawingTool,
    switchToolAndCancelCommand,
    circleMode,
    setCircleMode,
    rectangleMode,
    setRectangleMode,
    dimensionMode,
    setDimensionMode,
    gridVisible,
    toggleGrid,
    whiteBackground,
    toggleWhiteBackground,
    zoomIn,
    zoomOut,
    zoomToFit,
    deleteSelectedShapes,
    selectedShapeIds,
    setPrintDialogOpen,
    setSnapSettingsOpen,

    selectAll,
    deselectAll,
    editorMode,
    openSectionDialog,
    setPatternManagerOpen,
  } = useAppStore();

  const circleOptions: DropdownOption[] = [
    { id: 'center-radius', label: 'Center, Radius' },
    { id: 'center-diameter', label: 'Center, Diameter' },
    { id: '2point', label: '2-Point' },
    { id: '3point', label: '3-Point' },
  ];

  const rectangleOptions: DropdownOption[] = [
    { id: 'corner', label: 'Corner' },
    { id: 'center', label: 'Center' },
    { id: '3point', label: '3-Point' },
  ];

  const tabs: { id: RibbonTab; label: string }[] = [
    { id: 'home', label: 'Home' },
    { id: 'modify', label: 'Modify' },
    { id: 'structural', label: 'Structural' },
    { id: 'view', label: 'View' },
    { id: 'tools', label: 'Tools' },
  ];

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
            onClick={() => setActiveTab(tab.id)}
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
            {/* Clipboard Group */}
            <RibbonGroup label="Clipboard">
              <RibbonButton
                icon={<ClipboardPaste size={24} />}
                label="Paste"
                onClick={() => console.log('Paste')}
              />
              <RibbonButtonStack>
                <RibbonSmallButton
                  icon={<Scissors size={14} />}
                  label="Cut"
                  onClick={() => console.log('Cut')}
                />
                <RibbonSmallButton
                  icon={<Copy size={14} />}
                  label="Copy"
                  onClick={() => console.log('Copy')}
                />
                <RibbonSmallButton
                  icon={<Trash2 size={14} />}
                  label="Delete"
                  onClick={deleteSelectedShapes}
                  disabled={selectedShapeIds.length === 0}
                />
              </RibbonButtonStack>
            </RibbonGroup>

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
                />
                <RibbonSmallButton
                  icon={<XSquare size={14} />}
                  label="Deselect"
                  onClick={deselectAll}
                />
              </RibbonButtonStack>
            </RibbonGroup>

            {/* Draw Group */}
            <RibbonGroup label="Draw">
              <RibbonButton
                icon={<LineIcon size={24} />}
                label="Line"
                onClick={() => switchToDrawingTool('line')}
                active={activeTool === 'line'}
                shortcut="LI"
              />
              <RibbonDropdownButton
                icon={<Square size={24} />}
                label="Rectangle"
                onClick={() => switchToDrawingTool('rectangle')}
                active={activeTool === 'rectangle'}
                options={rectangleOptions}
                selectedOption={rectangleMode}
                onOptionSelect={(mode) => setRectangleMode(mode as 'corner' | 'center' | '3point')}
                shortcut="RC"
              />
              <RibbonDropdownButton
                icon={<Circle size={24} />}
                label="Circle"
                onClick={() => switchToDrawingTool('circle')}
                active={activeTool === 'circle'}
                options={circleOptions}
                selectedOption={circleMode}
                onOptionSelect={(mode) => setCircleMode(mode as 'center-radius' | 'center-diameter' | '2point' | '3point')}
                shortcut="CI"
              />
              <RibbonButtonStack>
                <RibbonSmallButton
                  icon={<ArcIcon size={14} />}
                  label="Arc"
                  onClick={() => switchToDrawingTool('arc')}
                  active={activeTool === 'arc'}
                  shortcut="AR"
                />
                <RibbonSmallButton
                  icon={<PolylineIcon size={14} />}
                  label="Polyline"
                  onClick={() => switchToDrawingTool('polyline')}
                  active={activeTool === 'polyline'}
                  shortcut="PL"
                />
                <RibbonSmallButton
                  icon={<EllipseIcon size={14} />}
                  label="Ellipse"
                  onClick={() => switchToDrawingTool('ellipse')}
                  active={activeTool === 'ellipse'}
                  shortcut="EL"
                />
              </RibbonButtonStack>
              <RibbonButtonStack>
                <RibbonSmallButton
                  icon={<SplineIcon size={14} />}
                  label="Spline"
                  onClick={() => switchToDrawingTool('spline')}
                  active={activeTool === 'spline'}
                  shortcut="SP"
                />
                <RibbonSmallButton
                  icon={<HatchIcon size={14} />}
                  label="Hatch"
                  onClick={() => switchToDrawingTool('hatch')}
                  active={activeTool === 'hatch'}
                />
                <RibbonSmallButton
                  icon={<DivideIcon size={14} />}
                  label="Divide"
                  onClick={() => {}}
                  disabled={true}
                />
              </RibbonButtonStack>
              <RibbonButton
                icon={<Type size={24} />}
                label="Text"
                onClick={() => switchToDrawingTool('text')}
                active={activeTool === 'text'}
                shortcut="TX"
              />
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
                  shortcut="DD"
                />
              </RibbonButtonStack>
              <RibbonButtonStack>
                <RibbonSmallButton
                  icon={<LeaderIcon size={14} />}
                  label="Leader"
                  onClick={() => {}}
                  disabled={true}
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
            </RibbonGroup>

            {/* Modify Group */}
            <RibbonGroup label="Modify">
              <RibbonButtonStack>
                <RibbonSmallButton
                  icon={<ArrowRight size={14} />}
                  label="Move"
                  onClick={() => switchToolAndCancelCommand('move')}
                  active={activeTool === 'move'}
                  shortcut="MV"
                />
                <RibbonSmallButton
                  icon={<Copy size={14} />}
                  label="Copy"
                  onClick={() => switchToolAndCancelCommand('copy')}
                  active={activeTool === 'copy'}
                  shortcut="CO"
                />
                <RibbonSmallButton
                  icon={<RotateCw size={14} />}
                  label="Rotate"
                  onClick={() => switchToolAndCancelCommand('rotate')}
                  active={activeTool === 'rotate'}
                  shortcut="RO"
                />
              </RibbonButtonStack>
              <RibbonButtonStack>
                <RibbonSmallButton
                  icon={<FlipHorizontal size={14} />}
                  label="Mirror"
                  onClick={() => switchToolAndCancelCommand('mirror')}
                  active={activeTool === 'mirror'}
                  shortcut="MM"
                />
                <RibbonSmallButton
                  icon={<ArrayIcon size={14} />}
                  label="Array"
                  onClick={() => switchToolAndCancelCommand('array')}
                  active={activeTool === 'array'}
                />
                <RibbonSmallButton
                  icon={<ScaleIcon size={14} />}
                  label="Scale"
                  onClick={() => switchToolAndCancelCommand('scale')}
                  active={activeTool === 'scale'}
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
                  onClick={() => {}}
                  disabled={true}
                />
                <RibbonSmallButton
                  icon={<ExtendIcon size={14} />}
                  label="Extend"
                  onClick={() => {}}
                  disabled={true}
                />
                <RibbonSmallButton
                  icon={<OffsetIcon size={14} />}
                  label="Offset"
                  onClick={() => {}}
                  disabled={true}
                />
              </RibbonButtonStack>
              <RibbonButtonStack>
                <RibbonSmallButton
                  icon={<FilletIcon size={14} />}
                  label="Fillet"
                  onClick={() => {}}
                  disabled={true}
                />
                <RibbonSmallButton
                  icon={<ChamferIcon size={14} />}
                  label="Chamfer"
                  onClick={() => switchToolAndCancelCommand('chamfer')}
                  active={activeTool === 'chamfer'}
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
                  onClick={() => {}}
                  disabled={true}
                />
              </RibbonButtonStack>
              <RibbonSmallButton
                icon={<PinIcon size={14} />}
                label="Pin"
                onClick={() => {}}
                disabled={true}
              />
            </RibbonGroup>
          </div>
        </div>

        {/* Modify Tab */}
        <div className={`ribbon-content ${activeTab === 'modify' ? 'active' : ''}`}>
          <div className="ribbon-groups">
            <RibbonGroup label="Region">
              <RibbonButton
                icon={<FilledRegionIcon size={24} />}
                label="Filled Region"
                onClick={() => switchToolAndCancelCommand('hatch')}
                disabled={false}
                active={activeTool === 'hatch'}
              />
              <RibbonButton
                icon={<HatchIcon size={24} />}
                label="Pattern Manager"
                onClick={() => setPatternManagerOpen(true)}
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
                icon={<Trash2 size={24} />}
                label="Delete"
                onClick={deleteSelectedShapes}
                disabled={selectedShapeIds.length === 0}
              />
            </RibbonGroup>
          </div>
        </div>

        {/* Structural Tab */}
        <div className={`ribbon-content ${activeTab === 'structural' ? 'active' : ''}`}>
          <div className="ribbon-groups">
            <RibbonGroup label="Section">
              <RibbonButton
                icon={<SteelSectionIcon size={24} />}
                label="Section"
                onClick={openSectionDialog}
                disabled={editorMode !== 'drawing'}
                tooltip="Insert structural profile section"
              />
            </RibbonGroup>
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
            </RibbonGroup>
          </div>
        </div>

        {/* Tools Tab */}
        <div className={`ribbon-content ${activeTab === 'tools' ? 'active' : ''}`}>
          <div className="ribbon-groups">
            <RibbonGroup label="Settings">
              <RibbonButton
                icon={<Settings size={24} />}
                label="Snap Settings"
                onClick={() => setSnapSettingsOpen(true)}
              />
            </RibbonGroup>

            <RibbonGroup label="Output">
              <RibbonButton
                icon={<Printer size={24} />}
                label="Print"
                onClick={() => setPrintDialogOpen(true)}
              />
            </RibbonGroup>
          </div>
        </div>

      </div>
    </div>
  );
});
