import { useAppStore } from '../../state/appStore';
import type { ThemeMode } from './ThemeToggle';
import { ThemeToggle } from './ThemeToggle';

interface NavigationRailProps {
  onOpen: () => void;
  onSearch: () => void;
  onMeasure: () => void;
  onMarkup: () => void;
  onGridToggle: () => void;
  onLayers: () => void;
  onDrawings: () => void;
  onMiniMap: () => void;
  measureActive: boolean;
  markupActive: boolean;
  gridVisible: boolean;
  layerPanelOpen: boolean;
  drawingPickerOpen: boolean;
  miniMapVisible: boolean;
  loading: boolean;
  theme: ThemeMode;
  onThemeCycle: () => void;
  isLight: boolean;
}

function RailButton({
  icon,
  label,
  active,
  disabled,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`flex flex-col items-center justify-center w-[44px] h-[44px] rounded-xl transition-all active:scale-95 ${
        active
          ? 'bg-blue-600/80 text-white'
          : 'text-gray-300 active:bg-white/10'
      } disabled:opacity-40 disabled:active:scale-100`}
    >
      {icon}
      <span className="text-[8px] mt-0.5 leading-none">{label}</span>
    </button>
  );
}

export function TabletToolbar({
  onOpen,
  onSearch,
  onMeasure,
  onMarkup,
  onGridToggle,
  onLayers,
  onDrawings,
  onMiniMap,
  measureActive,
  markupActive,
  gridVisible,
  layerPanelOpen,
  drawingPickerOpen,
  miniMapVisible,
  loading,
  theme,
  onThemeCycle,
  isLight,
}: NavigationRailProps) {
  const canUndo = useAppStore(s => s.canUndo());
  const canRedo = useAppStore(s => s.canRedo());
  const undo = useAppStore(s => s.undo);
  const redo = useAppStore(s => s.redo);

  return (
    <div
      className={`fixed top-0 left-0 h-full w-[56px] flex flex-col items-center justify-between py-2 ${
        isLight ? 'bg-gray-200/90' : 'bg-gray-900/90'
      } backdrop-blur-md shadow-lg`}
      style={{
        zIndex: 50,
        left: 'env(safe-area-inset-left, 0px)',
        paddingTop: 'calc(env(safe-area-inset-top, 0px) + 8px)',
        paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 8px)',
      }}
    >
      {/* Top section: Open, Search, Undo, Redo */}
      <div className="flex flex-col items-center gap-1">
        <RailButton
          icon={
            loading ? (
              <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
            ) : (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" />
              </svg>
            )
          }
          label="Open"
          disabled={loading}
          onClick={onOpen}
        />
        <RailButton
          icon={
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
          }
          label="Search"
          onClick={onSearch}
        />
        <RailButton
          icon={
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <polyline points="1 4 1 10 7 10" />
              <path d="M3.51 15a9 9 0 102.13-9.36L1 10" />
            </svg>
          }
          label="Undo"
          disabled={!canUndo}
          onClick={undo}
        />
        <RailButton
          icon={
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <polyline points="23 4 23 10 17 10" />
              <path d="M20.49 15a9 9 0 11-2.13-9.36L23 10" />
            </svg>
          }
          label="Redo"
          disabled={!canRedo}
          onClick={redo}
        />
      </div>

      {/* Middle section: Measure, Markup, Grid */}
      <div className="flex flex-col items-center gap-1">
        <RailButton
          icon={
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M2 2l20 20" />
              <circle cx="6" cy="6" r="3" />
              <circle cx="18" cy="18" r="3" />
            </svg>
          }
          label="Measure"
          active={measureActive}
          onClick={onMeasure}
        />
        <RailButton
          icon={
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M12 19l7-7 3 3-7 7-3-3z" />
              <path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z" />
            </svg>
          }
          label="Markup"
          active={markupActive}
          onClick={onMarkup}
        />
        <RailButton
          icon={
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <rect x="3" y="3" width="18" height="18" />
              <line x1="3" y1="9" x2="21" y2="9" />
              <line x1="3" y1="15" x2="21" y2="15" />
              <line x1="9" y1="3" x2="9" y2="21" />
              <line x1="15" y1="3" x2="15" y2="21" />
            </svg>
          }
          label="Grid"
          active={gridVisible}
          onClick={onGridToggle}
        />
      </div>

      {/* Bottom section: Layers, Drawings, Theme, MiniMap */}
      <div className="flex flex-col items-center gap-1">
        <RailButton
          icon={
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="12 2 2 7 12 12 22 7 12 2" />
              <polyline points="2 17 12 22 22 17" />
              <polyline points="2 12 12 17 22 12" />
            </svg>
          }
          label="Layers"
          active={layerPanelOpen}
          onClick={onLayers}
        />
        <RailButton
          icon={
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="2" y="3" width="20" height="18" rx="2" />
              <line x1="2" y1="9" x2="22" y2="9" />
              <line x1="2" y1="15" x2="22" y2="15" />
            </svg>
          }
          label="Drawings"
          active={drawingPickerOpen}
          onClick={onDrawings}
        />
        <ThemeToggle theme={theme} onCycle={onThemeCycle} />
        <RailButton
          icon={
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <rect x="13" y="13" width="5" height="5" rx="1" fill="currentColor" opacity="0.3" />
            </svg>
          }
          label="Map"
          active={miniMapVisible}
          onClick={onMiniMap}
        />
      </div>
    </div>
  );
}
