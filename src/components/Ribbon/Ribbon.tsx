import { useState, useRef, useEffect } from 'react';
import {
  MousePointer2,
  Move,
  Minus,
  Square,
  Circle,
  Spline,
  Type,
  ArrowUpRight,
  RotateCw,
  FlipHorizontal,
  Scissors,
  ArrowRight,
  CornerUpRight,
  Copy,
  ZoomIn,
  ZoomOut,
  Maximize,
  Grid3X3,
  Undo,
  Redo,
  Trash2,
  Printer,
  Settings,
  ClipboardPaste,
  ChevronDown,
  Keyboard,
  Info,
  CheckSquare,
  XSquare,
} from 'lucide-react';
import { useAppStore } from '../../state/appStore';
import './Ribbon.css';

type RibbonTab = 'home' | 'modify' | 'view' | 'tools' | 'help';

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

  const selectedLabel = options.find(o => o.id === selectedOption)?.label || label;

  return (
    <div className="ribbon-dropdown-container" ref={dropdownRef}>
      <button
        className={`ribbon-btn has-dropdown ${active ? 'active' : ''}`}
        onClick={onClick}
        title={selectedLabel}
      >
        <span className="ribbon-btn-icon">{icon}</span>
        <span className="ribbon-btn-label">{selectedLabel}</span>
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

export function Ribbon() {
  const [activeTab, setActiveTab] = useState<RibbonTab>('home');

  const {
    activeTool,
    setActiveTool,
    setPendingCommand,
    circleMode,
    setCircleMode,
    rectangleMode,
    setRectangleMode,
    gridVisible,
    toggleGrid,
    zoomIn,
    zoomOut,
    zoomToFit,
    deleteSelectedShapes,
    selectedShapeIds,
    undo,
    redo,
    historyStack,
    historyIndex,
    setPrintDialogOpen,
    setSnapSettingsOpen,
    setAboutDialogOpen,
    selectAll,
    deselectAll,
  } = useAppStore();

  const canUndo = historyStack.length > 0 && historyIndex > 0;
  const canRedo = historyStack.length > 0 && historyIndex < historyStack.length - 1;

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
                onClick={() => setActiveTool('select')}
                active={activeTool === 'select'}
              />
              <RibbonButton
                icon={<Move size={24} />}
                label="Pan"
                onClick={() => setActiveTool('pan')}
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
                icon={<Minus size={24} />}
                label="Line"
                onClick={() => setActiveTool('line')}
                active={activeTool === 'line'}
              />
              <RibbonDropdownButton
                icon={<Square size={24} />}
                label="Rectangle"
                onClick={() => setActiveTool('rectangle')}
                active={activeTool === 'rectangle'}
                options={rectangleOptions}
                selectedOption={rectangleMode}
                onOptionSelect={(mode) => setRectangleMode(mode as 'corner' | 'center' | '3point')}
              />
              <RibbonDropdownButton
                icon={<Circle size={24} />}
                label="Circle"
                onClick={() => setActiveTool('circle')}
                active={activeTool === 'circle'}
                options={circleOptions}
                selectedOption={circleMode}
                onOptionSelect={(mode) => setCircleMode(mode as 'center-radius' | 'center-diameter' | '2point' | '3point')}
              />
              <RibbonButtonStack>
                <RibbonSmallButton
                  icon={<ArrowUpRight size={14} />}
                  label="Arc"
                  onClick={() => setActiveTool('arc')}
                  active={activeTool === 'arc'}
                />
                <RibbonSmallButton
                  icon={<Spline size={14} />}
                  label="Polyline"
                  onClick={() => setActiveTool('polyline')}
                  active={activeTool === 'polyline'}
                />
                <RibbonSmallButton
                  icon={<Type size={14} />}
                  label="Text"
                  onClick={() => setActiveTool('text')}
                  active={activeTool === 'text'}
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
                />
                <RibbonSmallButton
                  icon={<Copy size={14} />}
                  label="Copy"
                  onClick={() => setPendingCommand('COPY')}
                />
                <RibbonSmallButton
                  icon={<RotateCw size={14} />}
                  label="Rotate"
                  onClick={() => setPendingCommand('ROTATE')}
                />
              </RibbonButtonStack>
              <RibbonButtonStack>
                <RibbonSmallButton
                  icon={<FlipHorizontal size={14} />}
                  label="Mirror"
                  onClick={() => setPendingCommand('MIRROR')}
                />
                <RibbonSmallButton
                  icon={<Scissors size={14} />}
                  label="Trim"
                  onClick={() => setPendingCommand('TRIM')}
                />
                <RibbonSmallButton
                  icon={<CornerUpRight size={14} />}
                  label="Fillet"
                  onClick={() => setPendingCommand('FILLET')}
                />
              </RibbonButtonStack>
            </RibbonGroup>

            {/* Undo/Redo Group */}
            <RibbonGroup label="History">
              <RibbonButton
                icon={<Undo size={24} />}
                label="Undo"
                onClick={undo}
                disabled={!canUndo}
              />
              <RibbonButton
                icon={<Redo size={24} />}
                label="Redo"
                onClick={redo}
                disabled={!canRedo}
              />
            </RibbonGroup>

            {/* Zoom Group */}
            <RibbonGroup label="Zoom">
              <RibbonButtonStack>
                <RibbonSmallButton
                  icon={<ZoomIn size={14} />}
                  label="Zoom In"
                  onClick={zoomIn}
                />
                <RibbonSmallButton
                  icon={<ZoomOut size={14} />}
                  label="Zoom Out"
                  onClick={zoomOut}
                />
                <RibbonSmallButton
                  icon={<Maximize size={14} />}
                  label="Fit All"
                  onClick={zoomToFit}
                />
              </RibbonButtonStack>
            </RibbonGroup>
          </div>
        </div>

        {/* Modify Tab */}
        <div className={`ribbon-content ${activeTab === 'modify' ? 'active' : ''}`}>
          <div className="ribbon-groups">
            <RibbonGroup label="Transform">
              <RibbonButton
                icon={<ArrowRight size={24} />}
                label="Move"
                onClick={() => setPendingCommand('MOVE')}
              />
              <RibbonButton
                icon={<Copy size={24} />}
                label="Copy"
                onClick={() => setPendingCommand('COPY')}
              />
              <RibbonButton
                icon={<RotateCw size={24} />}
                label="Rotate"
                onClick={() => setPendingCommand('ROTATE')}
              />
              <RibbonButton
                icon={<FlipHorizontal size={24} />}
                label="Mirror"
                onClick={() => setPendingCommand('MIRROR')}
              />
            </RibbonGroup>

            <RibbonGroup label="Edit">
              <RibbonButton
                icon={<Scissors size={24} />}
                label="Trim"
                onClick={() => setPendingCommand('TRIM')}
              />
              <RibbonButton
                icon={<CornerUpRight size={24} />}
                label="Fillet"
                onClick={() => setPendingCommand('FILLET')}
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

        {/* View Tab */}
        <div className={`ribbon-content ${activeTab === 'view' ? 'active' : ''}`}>
          <div className="ribbon-groups">
            <RibbonGroup label="Navigate">
              <RibbonButton
                icon={<Move size={24} />}
                label="Pan"
                onClick={() => setActiveTool('pan')}
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
              <RibbonButton
                icon={<Grid3X3 size={24} />}
                label="Grid"
                onClick={toggleGrid}
                active={gridVisible}
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
}
