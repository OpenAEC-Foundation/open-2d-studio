import { useAppStore } from '../../state/appStore';
import type { DrawingType } from '../../types/geometry';

const DRAWING_TYPE_CONFIG: Record<DrawingType, { abbr: string; color: string }> = {
  standalone: { abbr: 'SA', color: 'bg-gray-500/30 text-gray-300' },
  plan: { abbr: 'PL', color: 'bg-blue-500/30 text-blue-300' },
  section: { abbr: 'SC', color: 'bg-amber-500/30 text-amber-300' },
};

interface DrawingPickerProps {
  open: boolean;
  onClose: () => void;
}

export function DrawingPicker({ open, onClose }: DrawingPickerProps) {
  const drawings = useAppStore(s => s.drawings);
  const activeDrawingId = useAppStore(s => s.activeDrawingId);
  const switchToDrawing = useAppStore(s => s.switchToDrawing);
  const zoomToFit = useAppStore(s => s.zoomToFit);

  const handleSelect = (id: string) => {
    switchToDrawing(id);
    setTimeout(() => zoomToFit(), 50);
    onClose();
  };

  return (
    <>
      {/* Backdrop */}
      {open && (
        <div
          className="fixed inset-0 bg-black/40 transition-opacity"
          style={{ zIndex: 60 }}
          onClick={onClose}
        />
      )}

      {/* Bottom sheet */}
      <div
        className="fixed left-0 right-0 bottom-0 bg-gray-900/95 backdrop-blur-md rounded-t-2xl shadow-2xl transition-transform duration-300 flex flex-col"
        style={{
          zIndex: 61,
          maxHeight: '50vh',
          transform: open ? 'translateY(0)' : 'translateY(100%)',
          paddingBottom: 'env(safe-area-inset-bottom, 0px)',
        }}
      >
        {/* Handle bar */}
        <div className="flex justify-center py-2">
          <div className="w-10 h-1 rounded-full bg-white/20" />
        </div>

        {/* Header */}
        <div className="flex items-center justify-between px-4 pb-2">
          <span className="text-white text-sm font-medium">Drawings</span>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-lg text-gray-400 active:bg-white/10 transition-colors"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Drawing list */}
        <div className="flex-1 overflow-y-auto px-2 pb-2">
          {drawings.map(drawing => {
            const isActive = drawing.id === activeDrawingId;
            const cfg = DRAWING_TYPE_CONFIG[drawing.drawingType] || DRAWING_TYPE_CONFIG.standalone;

            return (
              <button
                key={drawing.id}
                onClick={() => handleSelect(drawing.id)}
                className={`w-full flex items-center gap-3 px-3 py-3 rounded-lg transition-colors text-left ${
                  isActive
                    ? 'bg-blue-600/20 border border-blue-500/40'
                    : 'border border-transparent active:bg-white/5'
                }`}
              >
                {/* Type badge */}
                <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${cfg.color}`}>
                  {cfg.abbr}
                </span>

                {/* Name */}
                <span className={`flex-1 text-sm truncate ${isActive ? 'text-white' : 'text-gray-300'}`}>
                  {drawing.name}
                </span>

                {/* Active indicator */}
                {isActive && (
                  <span className="w-2 h-2 rounded-full bg-blue-400" />
                )}
              </button>
            );
          })}
        </div>
      </div>
    </>
  );
}
