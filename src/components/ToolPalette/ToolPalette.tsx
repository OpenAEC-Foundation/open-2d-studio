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
  ChevronDown,
} from 'lucide-react';
import { useAppStore } from '../../state/appStore';
import type { ToolType } from '../../types/geometry';

interface ToolButtonProps {
  icon: React.ReactNode;
  label: string;
  shortcut?: string;
  active?: boolean;
  onClick: () => void;
}

function ToolButton({ icon, label, shortcut, active, onClick }: ToolButtonProps) {
  return (
    <button
      className={`w-10 h-10 flex items-center justify-center rounded transition-colors ${
        active
          ? 'bg-cad-accent text-white'
          : 'text-cad-text hover:bg-cad-border'
      }`}
      onClick={onClick}
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
        className={`w-10 h-10 flex items-center justify-center rounded transition-colors relative ${
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
              className={`w-full px-3 py-1.5 text-xs text-left flex justify-between items-center hover:bg-cad-border transition-colors ${
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

export function ToolPalette() {
  const { activeTool, setActiveTool, setPendingCommand, circleMode, setCircleMode, rectangleMode, setRectangleMode } = useAppStore();

  const selectionTools: { type: ToolType; icon: React.ReactNode; label: string; shortcut: string }[] = [
    { type: 'select', icon: <MousePointer2 size={18} />, label: 'Select', shortcut: 'V' },
    { type: 'pan', icon: <Move size={18} />, label: 'Pan', shortcut: 'H' },
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

  // Modify tools trigger commands, not persistent tool modes
  const modifyCommands: { command: string; icon: React.ReactNode; label: string; shortcut: string }[] = [
    { command: 'MOVE', icon: <ArrowRight size={18} />, label: 'Move', shortcut: 'M' },
    { command: 'COPY', icon: <Copy size={18} />, label: 'Copy', shortcut: 'CO' },
    { command: 'ROTATE', icon: <RotateCw size={18} />, label: 'Rotate', shortcut: 'RO' },
    { command: 'MIRROR', icon: <FlipHorizontal size={18} />, label: 'Mirror', shortcut: 'MI' },
    { command: 'TRIM', icon: <Scissors size={18} />, label: 'Trim', shortcut: 'TR' },
    { command: 'FILLET', icon: <CornerUpRight size={18} />, label: 'Fillet', shortcut: 'F' },
  ];

  return (
    <div className="w-12 bg-cad-surface border-r border-cad-border flex flex-col items-center py-2 gap-2">
      {/* Selection Tools */}
      <ToolSection title="Select">
        {selectionTools.map((tool) => (
          <ToolButton
            key={tool.type}
            icon={tool.icon}
            label={tool.label}
            shortcut={tool.shortcut}
            active={activeTool === tool.type}
            onClick={() => setActiveTool(tool.type)}
          />
        ))}
      </ToolSection>

      <ToolDivider />

      {/* Drawing Tools */}
      <ToolSection title="Draw">
        {/* Line */}
        <ToolButton
          icon={<Minus size={18} />}
          label="Line"
          shortcut="L"
          active={activeTool === 'line'}
          onClick={() => setActiveTool('line')}
        />
        {/* Rectangle with dropdown */}
        <ToolButtonWithDropdown
          icon={<Square size={18} />}
          label="Rectangle"
          shortcut="R"
          active={activeTool === 'rectangle'}
          onClick={() => setActiveTool('rectangle')}
          options={rectangleOptions}
          selectedOption={rectangleMode}
          onOptionSelect={(mode) => setRectangleMode(mode as 'corner' | 'center' | '3point')}
        />
        {/* Circle with dropdown */}
        <ToolButtonWithDropdown
          icon={<Circle size={18} />}
          label="Circle"
          shortcut="C"
          active={activeTool === 'circle'}
          onClick={() => setActiveTool('circle')}
          options={circleOptions}
          selectedOption={circleMode}
          onOptionSelect={(mode) => setCircleMode(mode as 'center-radius' | 'center-diameter' | '2point' | '3point')}
        />
        {/* Arc */}
        <ToolButton
          icon={<ArrowUpRight size={18} />}
          label="Arc"
          shortcut="A"
          active={activeTool === 'arc'}
          onClick={() => setActiveTool('arc')}
        />
        {/* Polyline */}
        <ToolButton
          icon={<Spline size={18} />}
          label="Polyline"
          shortcut="P"
          active={activeTool === 'polyline'}
          onClick={() => setActiveTool('polyline')}
        />
        {/* Text */}
        <ToolButton
          icon={<Type size={18} />}
          label="Text"
          shortcut="T"
          active={activeTool === 'text'}
          onClick={() => setActiveTool('text')}
        />
      </ToolSection>

      <ToolDivider />

      {/* Modify Commands */}
      <ToolSection title="Modify">
        {modifyCommands.map((cmd) => (
          <ToolButton
            key={cmd.command}
            icon={cmd.icon}
            label={cmd.label}
            shortcut={cmd.shortcut}
            active={false}
            onClick={() => setPendingCommand(cmd.command)}
          />
        ))}
      </ToolSection>
    </div>
  );
}
