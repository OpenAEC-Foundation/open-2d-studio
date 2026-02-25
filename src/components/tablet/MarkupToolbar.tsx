export type MarkupToolType = 'pen' | 'highlighter' | 'arrow' | 'text' | 'cloud';

const PRESET_COLORS = ['#ef4444', '#3b82f6', '#22c55e', '#eab308', '#000000', '#ffffff'];
const PRESET_WIDTHS = [
  { label: 'Thin', value: 2 },
  { label: 'Med', value: 4 },
  { label: 'Thick', value: 8 },
];

interface MarkupToolbarProps {
  activeTool: MarkupToolType;
  color: string;
  width: number;
  onToolChange: (tool: MarkupToolType) => void;
  onColorChange: (color: string) => void;
  onWidthChange: (width: number) => void;
  onUndo: () => void;
  onClear: () => void;
  onClose: () => void;
  isLight: boolean;
}

function ToolBtn({ active, onClick, children, label }: { active?: boolean; onClick: () => void; children: React.ReactNode; label: string }) {
  return (
    <button
      onClick={onClick}
      className={`flex flex-col items-center justify-center w-[40px] h-[40px] rounded-lg transition-colors active:scale-95 ${
        active ? 'bg-blue-600/80 text-white' : 'text-gray-300 active:bg-white/10'
      }`}
      title={label}
    >
      {children}
      <span className="text-[7px] mt-0.5">{label}</span>
    </button>
  );
}

export function MarkupToolbar({
  activeTool,
  color,
  width,
  onToolChange,
  onColorChange,
  onWidthChange,
  onUndo,
  onClear,
  onClose,
  isLight,
}: MarkupToolbarProps) {
  return (
    <div
      className={`fixed flex items-center gap-1 px-2 py-1.5 ${
        isLight ? 'bg-gray-100/95' : 'bg-gray-800/95'
      } backdrop-blur-md rounded-xl shadow-lg`}
      style={{
        zIndex: 52,
        top: 'calc(env(safe-area-inset-top, 0px) + 8px)',
        left: '68px',
      }}
    >
      {/* Tools */}
      <ToolBtn active={activeTool === 'pen'} onClick={() => onToolChange('pen')} label="Pen">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <path d="M12 19l7-7 3 3-7 7-3-3z" /><path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z" />
        </svg>
      </ToolBtn>
      <ToolBtn active={activeTool === 'highlighter'} onClick={() => onToolChange('highlighter')} label="Hilite">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <rect x="6" y="2" width="12" height="20" rx="2" /><line x1="6" y1="18" x2="18" y2="18" />
        </svg>
      </ToolBtn>
      <ToolBtn active={activeTool === 'arrow'} onClick={() => onToolChange('arrow')} label="Arrow">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <line x1="5" y1="12" x2="19" y2="12" /><polyline points="12 5 19 12 12 19" />
        </svg>
      </ToolBtn>
      <ToolBtn active={activeTool === 'text'} onClick={() => onToolChange('text')} label="Text">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <polyline points="4 7 4 4 20 4 20 7" /><line x1="9" y1="20" x2="15" y2="20" /><line x1="12" y1="4" x2="12" y2="20" />
        </svg>
      </ToolBtn>
      <ToolBtn active={activeTool === 'cloud'} onClick={() => onToolChange('cloud')} label="Cloud">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <path d="M18 10h-1.26A8 8 0 109 20h9a5 5 0 000-10z" />
        </svg>
      </ToolBtn>

      {/* Divider */}
      <div className="w-px h-8 bg-white/10 mx-1" />

      {/* Colors */}
      <div className="flex items-center gap-1">
        {PRESET_COLORS.map(c => (
          <button
            key={c}
            onClick={() => onColorChange(c)}
            className={`w-5 h-5 rounded-full border-2 transition-transform ${
              c === color ? 'border-blue-400 scale-110' : 'border-transparent'
            }`}
            style={{ backgroundColor: c }}
          />
        ))}
      </div>

      {/* Divider */}
      <div className="w-px h-8 bg-white/10 mx-1" />

      {/* Widths */}
      <div className="flex items-center gap-0.5">
        {PRESET_WIDTHS.map(w => (
          <button
            key={w.value}
            onClick={() => onWidthChange(w.value)}
            className={`px-1.5 py-1 text-[9px] rounded ${
              w.value === width ? 'bg-blue-600/80 text-white' : 'text-gray-400 active:bg-white/10'
            }`}
          >
            {w.label}
          </button>
        ))}
      </div>

      {/* Divider */}
      <div className="w-px h-8 bg-white/10 mx-1" />

      {/* Undo / Clear / Close */}
      <button onClick={onUndo} className="w-8 h-8 flex items-center justify-center rounded-lg text-gray-400 active:bg-white/10" title="Undo stroke">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <polyline points="1 4 1 10 7 10" /><path d="M3.51 15a9 9 0 102.13-9.36L1 10" />
        </svg>
      </button>
      <button onClick={onClear} className="w-8 h-8 flex items-center justify-center rounded-lg text-gray-400 active:bg-white/10" title="Clear all">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
        </svg>
      </button>
      <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg text-gray-400 active:bg-white/10" title="Close markup">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>
    </div>
  );
}
