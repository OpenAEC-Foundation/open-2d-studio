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
  ChevronDown,
  // Sheet annotation icons
  TextCursor,
  ArrowRightFromLine,
  Ruler,
  Cloud,
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
} from '../shared/CadIcons';
import type { ToolType } from '../../types/geometry';

interface ToolButtonProps {
  icon: React.ReactNode;
  label: string;
  shortcut?: string;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
}

function ToolButton({ icon, label, shortcut, active, disabled, onClick }: ToolButtonProps) {
  return (
    <button
      className={`w-10 h-10 flex items-center justify-center rounded transition-colors cursor-default ${
        disabled
          ? 'text-cad-text-dim opacity-40 !cursor-not-allowed'
          : active
            ? 'bg-cad-accent text-white'
            : 'text-cad-text hover:bg-cad-border'
      }`}
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      title={shortcut ? `${label} (${shortcut})` : label}
    >
      {icon}
    </button>
  );
}

interface DropdownOption {
  id: string;
  label: string;
  shortcut?: string;
}

interface ToolButtonWithDropdownProps {
  icon: React.ReactNode;
  label: string;
  shortcut?: string;
  active?: boolean;
  onClick: () => void;
  options: DropdownOption[];
  selectedOption: string;
  onOptionSelect: (optionId: string) => void;
}

function ToolButtonWithDropdown({
  icon,
  label,
  shortcut,
  active,
  onClick,
  options,
  selectedOption,
  onOptionSelect,
}: ToolButtonWithDropdownProps) {
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

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsOpen(!isOpen);
  };

  const selectedLabel = options.find(o => o.id === selectedOption)?.label || label;

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        className={`w-10 h-10 flex items-center justify-center rounded transition-colors relative cursor-default ${
          active
            ? 'bg-cad-accent text-white'
            : 'text-cad-text hover:bg-cad-border'
        }`}
        onClick={onClick}
        onContextMenu={handleContextMenu}
        title={shortcut ? `${selectedLabel} (${shortcut}) - Right-click for options` : `${selectedLabel} - Right-click for options`}
      >
        {icon}
        {/* Small triangle indicator */}
        <div className="absolute bottom-0.5 right-0.5">
          <ChevronDown size={8} className="opacity-60" />
        </div>
      </button>

      {isOpen && (
        <div className="absolute left-full top-0 ml-1 bg-cad-surface border border-cad-border rounded shadow-lg min-w-40 py-1 z-50">
          {options.map((option) => (
            <button
              key={option.id}
              className={`w-full px-3 py-1.5 text-xs text-left flex justify-between items-center hover:bg-cad-border transition-colors cursor-default ${
                selectedOption === option.id ? 'text-cad-accent' : 'text-cad-text'
              }`}
              onClick={() => {
                onOptionSelect(option.id);
                setIsOpen(false);
                onClick();
              }}
            >
              <span className="flex items-center gap-2">
                {selectedOption === option.id && <span>✓</span>}
                <span className={selectedOption !== option.id ? 'ml-4' : ''}>{option.label}</span>
              </span>
              {option.shortcut && (
                <span className="text-cad-text-dim ml-4">{option.shortcut}</span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function ToolDivider() {
  return <div className="h-px bg-cad-border mx-1 my-1" />;
}

function ToolSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center">
      <div className="text-[9px] text-cad-text-dim mb-1 uppercase tracking-wider">
        {title}
      </div>
      {children}
    </div>
  );
}

export const ToolPalette = memo(function ToolPalette() {
  const { activeTool, switchToDrawingTool, switchToolAndCancelCommand, setPendingCommand, circleMode, setCircleMode, rectangleMode, setRectangleMode, arcMode, setArcMode, dimensionMode, setDimensionMode, editorMode, activeCommandName } = useAppStore();

  const selectionTools: { type: ToolType; icon: React.ReactNode; label: string; shortcut: string }[] = [
    { type: 'select', icon: <MousePointer2 size={18} />, label: 'Select', shortcut: 'V' },
    { type: 'pan', icon: <Hand size={18} />, label: 'Pan', shortcut: 'H' },
  ];

  const circleOptions: DropdownOption[] = [
    { id: 'center-radius', label: 'Center, Radius', shortcut: 'C' },
    { id: 'center-diameter', label: 'Center, Diameter' },
    { id: '2point', label: '2-Point' },
    { id: '3point', label: '3-Point' },
  ];

  const rectangleOptions: DropdownOption[] = [
    { id: 'corner', label: 'Corner to Corner', shortcut: 'R' },
    { id: 'center', label: 'Center' },
    { id: '3point', label: '3-Point (Rotated)' },
  ];

  const arcOptions: DropdownOption[] = [
    { id: '3point', label: '3-Point (Start, Arc, End)', shortcut: 'A' },
    { id: 'center-start-end', label: 'Center, Start, End' },
  ];

  const dimensionOptions: DropdownOption[] = [
    { id: 'aligned', label: 'Aligned', shortcut: 'D' },
    { id: 'linear', label: 'Linear (H/V)' },
    { id: 'angular', label: 'Angular' },
    { id: 'radius', label: 'Radius' },
    { id: 'diameter', label: 'Diameter' },
  ];

  // Modify tools trigger commands, not persistent tool modes
  // Primary modify commands (most used - displayed with slightly larger emphasis)
  const primaryModifyCommands: { command: string; icon: React.ReactNode; label: string; shortcut: string; disabled?: boolean }[] = [
    { command: 'MOVE', icon: <ArrowRight size={18} />, label: 'Move', shortcut: 'M' },
    { command: 'COPY', icon: <Copy size={18} />, label: 'Copy', shortcut: 'CO', disabled: true },
    { command: 'ROTATE', icon: <RotateCw size={18} />, label: 'Rotate', shortcut: 'RO', disabled: true },
    { command: 'ARRAY', icon: <ArrayIcon size={18} />, label: 'Array', shortcut: 'AR', disabled: true },
    { command: 'MIRROR', icon: <FlipHorizontal size={18} />, label: 'Mirror', shortcut: 'MI', disabled: true },
    { command: 'SCALE', icon: <ScaleIcon size={18} />, label: 'Scale', shortcut: 'SC', disabled: true },
  ];

  // Secondary modify commands (editing operations)
  const secondaryModifyCommands: { command: string; icon: React.ReactNode; label: string; shortcut: string; disabled?: boolean }[] = [
    { command: 'OFFSET', icon: <OffsetIcon size={18} />, label: 'Offset', shortcut: 'O', disabled: true },
    { command: 'TRIM', icon: <Scissors size={18} />, label: 'Trim', shortcut: 'TR', disabled: true },
    { command: 'EXTEND', icon: <ExtendIcon size={18} />, label: 'Extend', shortcut: 'EX', disabled: true },
    { command: 'SPLIT', icon: <SplitIcon size={18} />, label: 'Split', shortcut: 'SP', disabled: true },
    { command: 'FILLET', icon: <FilletIcon size={18} />, label: 'Fillet', shortcut: 'F', disabled: true },
    { command: 'CHAMFER', icon: <ChamferIcon size={18} />, label: 'Chamfer', shortcut: 'CHA', disabled: true },
    { command: 'ALIGN', icon: <AlignIcon size={18} />, label: 'Align', shortcut: 'AL', disabled: true },
  ];

  // Sheet annotation tools - only visible in sheet mode
  const sheetAnnotationTools: { type: ToolType; icon: React.ReactNode; label: string }[] = [
    { type: 'sheet-text', icon: <TextCursor size={18} />, label: 'Sheet Text' },
    { type: 'sheet-leader', icon: <ArrowRightFromLine size={18} />, label: 'Leader' },
    { type: 'sheet-dimension', icon: <Ruler size={18} />, label: 'Dimension' },
    { type: 'sheet-revision-cloud', icon: <Cloud size={18} />, label: 'Revision Cloud' },
  ];

  return (
    <div className="w-12 bg-cad-surface border-r border-cad-border flex flex-col items-center py-2 gap-2 overflow-y-auto overflow-x-hidden">
      {/* Selection Tools */}
      <ToolSection title="Select">
        {selectionTools.map((tool) => (
          <ToolButton
            key={tool.type}
            icon={tool.icon}
            label={tool.label}
            shortcut={tool.shortcut}
            active={activeTool === tool.type && !activeCommandName}
            onClick={() => switchToolAndCancelCommand(tool.type)}
          />
        ))}
      </ToolSection>

      <ToolDivider />

      {/* Drawing Tools */}
      <ToolSection title="Draw">
        {/* Line - Primary tool */}
        <ToolButton
          icon={<LineIcon size={18} />}
          label="Line"
          shortcut="L"
          active={activeTool === 'line' && !activeCommandName}
          onClick={() => switchToDrawingTool('line')}
        />
        {/* Rectangle with dropdown */}
        <ToolButtonWithDropdown
          icon={<Square size={18} />}
          label="Rectangle"
          shortcut="R"
          active={activeTool === 'rectangle' && !activeCommandName}
          onClick={() => switchToDrawingTool('rectangle')}
          options={rectangleOptions}
          selectedOption={rectangleMode}
          onOptionSelect={(mode) => setRectangleMode(mode as 'corner' | 'center' | '3point')}
        />
        {/* Circle with dropdown */}
        <ToolButtonWithDropdown
          icon={<Circle size={18} />}
          label="Circle"
          shortcut="C"
          active={activeTool === 'circle' && !activeCommandName}
          onClick={() => switchToDrawingTool('circle')}
          options={circleOptions}
          selectedOption={circleMode}
          onOptionSelect={(mode) => setCircleMode(mode as 'center-radius' | 'center-diameter' | '2point' | '3point')}
        />
        {/* Arc with dropdown */}
        <ToolButtonWithDropdown
          icon={<ArcIcon size={18} />}
          label="Arc"
          shortcut="A"
          active={activeTool === 'arc' && !activeCommandName}
          onClick={() => switchToDrawingTool('arc')}
          options={arcOptions}
          selectedOption={arcMode}
          onOptionSelect={(mode) => setArcMode(mode as '3point' | 'center-start-end')}
        />
        {/* Polyline */}
        <ToolButton
          icon={<PolylineIcon size={18} />}
          label="Polyline"
          shortcut="P"
          active={activeTool === 'polyline' && !activeCommandName}
          onClick={() => switchToDrawingTool('polyline')}
        />
        {/* Spline - New tool (not yet implemented) */}
        <ToolButton
          icon={<SplineIcon size={18} />}
          label="Spline"
          shortcut="SPL"
          disabled={true}
          onClick={() => {}}
        />
        {/* Ellipse */}
        <ToolButton
          icon={<EllipseIcon size={18} />}
          label="Ellipse"
          shortcut="EL"
          active={activeTool === 'ellipse' && !activeCommandName}
          onClick={() => switchToDrawingTool('ellipse')}
        />
        {/* Text */}
        <ToolButton
          icon={<Type size={18} />}
          label="Text"
          shortcut="T"
          active={activeTool === 'text' && !activeCommandName}
          onClick={() => switchToDrawingTool('text')}
        />
        {/* Dimension with dropdown */}
        <ToolButtonWithDropdown
          icon={<AlignedDimensionIcon size={18} />}
          label="Dimension"
          shortcut="D"
          active={activeTool === 'dimension' && !activeCommandName}
          onClick={() => switchToDrawingTool('dimension')}
          options={dimensionOptions}
          selectedOption={dimensionMode}
          onOptionSelect={(mode) => setDimensionMode(mode as 'aligned' | 'linear' | 'angular' | 'radius' | 'diameter')}
        />
      </ToolSection>

      <ToolDivider />

      {/* Region Tools - only in draft mode */}
      {editorMode === 'drawing' && (
        <ToolSection title="Region">
          {/* Filled Region - New tool (not yet implemented) */}
          <ToolButton
            icon={<FilledRegionIcon size={18} />}
            label="Filled Region"
            shortcut="FR"
            disabled={true}
            onClick={() => {}}
          />
          {/* Insulation - New tool (not yet implemented) */}
          <ToolButton
            icon={<InsulationIcon size={18} />}
            label="Insulation"
            shortcut="INS"
            disabled={true}
            onClick={() => {}}
          />
          {/* Detail Component - New tool (not yet implemented) */}
          <ToolButton
            icon={<DetailComponentIcon size={18} />}
            label="Detail Component"
            shortcut="DC"
            disabled={true}
            onClick={() => {}}
          />
        </ToolSection>
      )}

      <ToolDivider />

      {/* Modify Commands - only in draft mode */}
      {editorMode === 'drawing' && (
        <>
          <ToolSection title="Modify">
            {primaryModifyCommands.map((cmd) => (
              <ToolButton
                key={cmd.command}
                icon={cmd.icon}
                label={cmd.label}
                shortcut={cmd.shortcut}
                active={activeCommandName === cmd.command}
                disabled={cmd.disabled}
                onClick={() => cmd.disabled ? {} : setPendingCommand(cmd.command)}
              />
            ))}
          </ToolSection>

          <ToolDivider />

          <ToolSection title="Edit">
            {secondaryModifyCommands.map((cmd) => (
              <ToolButton
                key={cmd.command}
                icon={cmd.icon}
                label={cmd.label}
                shortcut={cmd.shortcut}
                active={activeCommandName === cmd.command}
                disabled={cmd.disabled}
                onClick={() => cmd.disabled ? {} : setPendingCommand(cmd.command)}
              />
            ))}
          </ToolSection>
        </>
      )}

      {/* Sheet Annotation Tools - only in sheet mode */}
      {editorMode === 'sheet' && (
        <>
          <ToolDivider />
          <ToolSection title="Annotate">
            {sheetAnnotationTools.map((tool) => (
              <ToolButton
                key={tool.type}
                icon={tool.icon}
                label={tool.label}
                active={activeTool === tool.type && !activeCommandName}
                onClick={() => switchToolAndCancelCommand(tool.type)}
              />
            ))}
          </ToolSection>
        </>
      )}
    </div>
  );
});
