import { useAppStore } from '../../state/appStore';

interface ZoomControlsProps {
  gridVisible?: boolean;
  onGridToggle?: () => void;
}

export function ZoomControls({ gridVisible, onGridToggle }: ZoomControlsProps) {
  const zoomIn = useAppStore(s => s.zoomIn);
  const zoomOut = useAppStore(s => s.zoomOut);

  return (
    <div
      className="fixed flex flex-col gap-2"
      style={{
        zIndex: 30,
        right: 'calc(12px + env(safe-area-inset-right, 0px))',
        top: '50%',
        transform: 'translateY(-50%)',
      }}
    >
      <button
        onClick={zoomIn}
        className="w-10 h-10 rounded-full bg-gray-800/80 backdrop-blur-sm text-white flex items-center justify-center text-xl font-light active:bg-gray-700 active:scale-95 transition-all"
        title="Zoom in"
      >
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <line x1="10" y1="4" x2="10" y2="16" />
          <line x1="4" y1="10" x2="16" y2="10" />
        </svg>
      </button>
      <button
        onClick={zoomOut}
        className="w-10 h-10 rounded-full bg-gray-800/80 backdrop-blur-sm text-white flex items-center justify-center text-xl font-light active:bg-gray-700 active:scale-95 transition-all"
        title="Zoom out"
      >
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <line x1="4" y1="10" x2="16" y2="10" />
        </svg>
      </button>
      {onGridToggle && (
        <button
          onClick={onGridToggle}
          className={`w-10 h-10 rounded-full backdrop-blur-sm flex items-center justify-center active:scale-95 transition-all ${
            gridVisible
              ? 'bg-blue-600/80 text-white'
              : 'bg-gray-800/80 text-white active:bg-gray-700'
          }`}
          title={gridVisible ? 'Hide grid' : 'Show grid'}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <rect x="3" y="3" width="18" height="18" />
            <line x1="3" y1="9" x2="21" y2="9" />
            <line x1="3" y1="15" x2="21" y2="15" />
            <line x1="9" y1="3" x2="9" y2="21" />
            <line x1="15" y1="3" x2="15" y2="21" />
          </svg>
        </button>
      )}
    </div>
  );
}
