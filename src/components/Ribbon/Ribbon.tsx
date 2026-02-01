import { useState, useRef, useEffect, memo } from 'react';
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
  Keyboard,
  Info,
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

type RibbonTab = 'home' | 'modify' | 'structural' | 'view' | 'tools' | 'help';

interface RibbonButtonProps {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
}

function RibbonButton({ icon, label, onClick, active, disabled }: RibbonButtonProps) {
  return (
    <button
      className={`ribbon-btn ${active ? 'active' : ''} ${disabled ? 'disabled' : ''}`}
      onClick={onClick}
      disabled={disabled}
      title={label}
    >
      <span className="ribbon-btn-icon">{icon}</span>
      <span className="ribbon-btn-label">{label}</span>
    </button>
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
}

function RibbonDropdownButton({
  icon,
  label,
  onClick,
  active,
  options,
  selectedOption,
  onOptionSelect,
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

  return (
    <div className="ribbon-dropdown-container" ref={dropdownRef}>
      <button
        className={`ribbon-btn has-dropdown ${active ? 'active' : ''}`}
        onClick={onClick}
        title={`${label} (${selectedOptionLabel})`}
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
    </div>
  );
}

interface RibbonSmallButtonProps {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
}

function RibbonSmallButton({ icon, label, onClick, active, disabled }: RibbonSmallButtonProps) {
  return (
    <button
      className={`ribbon-btn small ${active ? 'active' : ''} ${disabled ? 'disabled' : ''}`}
      onClick={onClick}
      disabled={disabled}
      title={label}
    >
      <span className="ribbon-btn-icon">{icon}</span>
      <span className="ribbon-btn-label">{label}</span>
    </button>
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

export const Ribbon = memo(function Ribbon() {
  const [activeTab, setActiveTab] = useState<RibbonTab>('home');

  const {
    activeTool,
    switchToDrawingTool,
    switchToolAndCancelCommand,
    circleMode,
    setCircleMode,
    rectangleMode,
    setRectangleMode,
    arcMode,
    setArcMode,
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
    setAboutDialogOpen,
    selectAll,
    deselectAll,
    activeCommandName,
    setPendingCommand,
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

  const arcOptions: DropdownOption[] = [
    { id: '3point', label: '3-Point (Start, Arc, End)' },
    { id: 'center-start-end', label: 'Center, Start, End' },
  ];

  const tabs: { id: RibbonTab; label: string }[] = [
    { id: 'home', label: 'Home' },
    { id: 'modify', label: 'Modify' },
    { id: 'structural', label: 'Structural' },
    { id: 'view', label: 'View' },
    { id: 'tools', label: 'Tools' },
    { id: 'help', label: 'Help' },
  ];

  return (
    <div className="ribbon-container">
      {/* Ribbon Tabs */}
      <div className="ribbon-tabs">
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
                active={activeTool === 'select' && !activeCommandName}
              />
              <RibbonButton
                icon={<Hand size={24} />}
                label="Pan"
                onClick={() => switchToolAndCancelCommand('pan')}
                active={activeTool === 'pan' && !activeCommandName}
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
                active={activeTool === 'line' && !activeCommandName}
              />
              <RibbonDropdownButton
                icon={<Square size={24} />}
                label="Rectangle"
                onClick={() => switchToDrawingTool('rectangle')}
                active={activeTool === 'rectangle' && !activeCommandName}
                options={rectangleOptions}
                selectedOption={rectangleMode}
                onOptionSelect={(mode) => setRectangleMode(mode as 'corner' | 'center' | '3point')}
              />
              <RibbonDropdownButton
                icon={<Circle size={24} />}
                label="Circle"
                onClick={() => switchToDrawingTool('circle')}
                active={activeTool === 'circle' && !activeCommandName}
                options={circleOptions}
                selectedOption={circleMode}
                onOptionSelect={(mode) => setCircleMode(mode as 'center-radius' | 'center-diameter' | '2point' | '3point')}
              />
              <RibbonDropdownButton
                icon={<ArcIcon size={24} />}
                label="Arc"
                onClick={() => switchToDrawingTool('arc')}
                active={activeTool === 'arc' && !activeCommandName}
                options={arcOptions}
                selectedOption={arcMode}
                onOptionSelect={(mode) => setArcMode(mode as '3point' | 'center-start-end')}
              />
              <RibbonButtonStack>
                <RibbonSmallButton
                  icon={<PolylineIcon size={14} />}
                  label="Polyline"
                  onClick={() => switchToDrawingTool('polyline')}
                  active={activeTool === 'polyline' && !activeCommandName}
                />
                <RibbonSmallButton
                  icon={<EllipseIcon size={14} />}
                  label="Ellipse"
                  onClick={() => switchToDrawingTool('ellipse')}
                  active={activeTool === 'ellipse' && !activeCommandName}
                />
                <RibbonSmallButton
                  icon={<SplineIcon size={14} />}
                  label="Spline"
                  onClick={() => switchToDrawingTool('spline')}
                  active={activeTool === 'spline' && !activeCommandName}
                />
              </RibbonButtonStack>
              <RibbonButton
                icon={<Type size={24} />}
                label="Text"
                onClick={() => switchToDrawingTool('text')}
                active={activeTool === 'text' && !activeCommandName}
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
                active={activeTool === 'dimension' && dimensionMode === 'aligned' && !activeCommandName}
              />
              <RibbonButtonStack>
                <RibbonSmallButton
                  icon={<LinearDimensionIcon size={14} />}
                  label="Linear"
                  onClick={() => {
                    setDimensionMode('linear');
                    switchToDrawingTool('dimension');
                  }}
                  active={activeTool === 'dimension' && dimensionMode === 'linear' && !activeCommandName}
                />
                <RibbonSmallButton
                  icon={<AngularDimensionIcon size={14} />}
                  label="Angular"
                  onClick={() => {
                    setDimensionMode('angular');
                    switchToDrawingTool('dimension');
                  }}
                  active={activeTool === 'dimension' && dimensionMode === 'angular' && !activeCommandName}
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
                  active={activeTool === 'dimension' && dimensionMode === 'radius' && !activeCommandName}
                />
                <RibbonSmallButton
                  icon={<DiameterDimensionIcon size={14} />}
                  label="Diameter"
                  onClick={() => {
                    setDimensionMode('diameter');
                    switchToDrawingTool('dimension');
                  }}
                  active={activeTool === 'dimension' && dimensionMode === 'diameter' && !activeCommandName}
                />
              </RibbonButtonStack>
            </RibbonGroup>

            {/* Modify Group */}
            <RibbonGroup label="Modify">
              <RibbonButtonStack>
                <RibbonSmallButton
                  icon={<ArrowRight size={14} />}
                  label="Move"
                  onClick={() => setPendingCommand('MOVE')}
                  active={activeCommandName === 'MOVE'}
                />
                <RibbonSmallButton
                  icon={<Copy size={14} />}
                  label="Copy"
                  onClick={() => setPendingCommand('COPY')}
                  active={activeCommandName === 'COPY'}
                />
                <RibbonSmallButton
                  icon={<RotateCw size={14} />}
                  label="Rotate"
                  onClick={() => setPendingCommand('ROTATE')}
                  active={activeCommandName === 'ROTATE'}
                />
              </RibbonButtonStack>
              <RibbonButtonStack>
                <RibbonSmallButton
                  icon={<FlipHorizontal size={14} />}
                  label="Mirror"
                  onClick={() => setPendingCommand('MIRROR')}
                  active={activeCommandName === 'MIRROR'}
                />
                <RibbonSmallButton
                  icon={<ArrayIcon size={14} />}
                  label="Array"
                  onClick={() => setPendingCommand('ARRAY')}
                  active={activeCommandName === 'ARRAY'}
                  disabled={true}
                />
                <RibbonSmallButton
                  icon={<ScaleIcon size={14} />}
                  label="Scale"
                  onClick={() => setPendingCommand('SCALE')}
                  active={activeCommandName === 'SCALE'}
                  disabled={true}
                />
              </RibbonButtonStack>
            </RibbonGroup>

            {/* Edit Group */}
            <RibbonGroup label="Edit">
              <RibbonButtonStack>
                <RibbonSmallButton
                  icon={<OffsetIcon size={14} />}
                  label="Offset"
                  onClick={() => setPendingCommand('OFFSET')}
                  active={activeCommandName === 'OFFSET'}
                  disabled={true}
                />
                <RibbonSmallButton
                  icon={<Scissors size={14} />}
                  label="Trim"
                  onClick={() => setPendingCommand('TRIM')}
                  active={activeCommandName === 'TRIM'}
                  disabled={true}
                />
                <RibbonSmallButton
                  icon={<ExtendIcon size={14} />}
                  label="Extend"
                  onClick={() => setPendingCommand('EXTEND')}
                  active={activeCommandName === 'EXTEND'}
                  disabled={true}
                />
              </RibbonButtonStack>
              <RibbonButtonStack>
                <RibbonSmallButton
                  icon={<SplitIcon size={14} />}
                  label="Split"
                  onClick={() => setPendingCommand('SPLIT')}
                  active={activeCommandName === 'SPLIT'}
                  disabled={true}
                />
                <RibbonSmallButton
                  icon={<FilletIcon size={14} />}
                  label="Fillet"
                  onClick={() => setPendingCommand('FILLET')}
                  active={activeCommandName === 'FILLET'}
                  disabled={true}
                />
                <RibbonSmallButton
                  icon={<ChamferIcon size={14} />}
                  label="Chamfer"
                  onClick={() => setPendingCommand('CHAMFER')}
                  active={activeCommandName === 'CHAMFER'}
                  disabled={true}
                />
              </RibbonButtonStack>
              <RibbonSmallButton
                icon={<AlignIcon size={14} />}
                label="Align"
                onClick={() => setPendingCommand('ALIGN')}
                active={activeCommandName === 'ALIGN'}
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
                onClick={() => {}}
                disabled={true}
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
                onClick={() => console.log('Section')}
                disabled={true}
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
                active={activeTool === 'pan' && !activeCommandName}
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

        {/* Help Tab */}
        <div className={`ribbon-content ${activeTab === 'help' ? 'active' : ''}`}>
          <div className="ribbon-groups">
            <RibbonGroup label="Information">
              <RibbonButton
                icon={<Keyboard size={24} />}
                label="Keyboard Shortcuts"
                onClick={() => console.log('Shortcuts')}
              />
              <RibbonButton
                icon={<Info size={24} />}
                label="About"
                onClick={() => setAboutDialogOpen(true)}
              />
            </RibbonGroup>
          </div>
        </div>
      </div>
    </div>
  );
});
