import { useRef, useEffect } from 'react';
import { useAppStore } from '../../state/appStore';
import type { DrawingType } from '../../types/geometry';

const TYPE_BADGE: Record<DrawingType, { abbr: string; cls: string }> = {
  standalone: { abbr: 'SA', cls: 'bg-gray-500/30 text-gray-300' },
  plan: { abbr: 'PL', cls: 'bg-blue-500/30 text-blue-300' },
  section: { abbr: 'SC', cls: 'bg-amber-500/30 text-amber-300' },
};

interface DrawingTabsProps {
  onOverflow: () => void;
  isLight: boolean;
}

export function DrawingTabs({ onOverflow, isLight }: DrawingTabsProps) {
  const drawings = useAppStore(s => s.drawings);
  const activeDrawingId = useAppStore(s => s.activeDrawingId);
  const switchToDrawing = useAppStore(s => s.switchToDrawing);
  const zoomToFit = useAppStore(s => s.zoomToFit);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Scroll active tab into view
  useEffect(() => {
    const el = scrollRef.current?.querySelector('[data-active="true"]') as HTMLElement | null;
    el?.scrollIntoView({ inline: 'center', behavior: 'smooth' });
  }, [activeDrawingId]);

  if (drawings.length <= 1) return null;

  const handleSelect = (id: string) => {
    switchToDrawing(id);
    setTimeout(() => zoomToFit(), 50);
  };

  const showOverflow = drawings.length > 5;

  return (
    <div
      className={`fixed left-0 right-0 flex items-center ${
        isLight ? 'bg-white/30' : 'bg-black/30'
      } backdrop-blur-sm`}
      style={{
        zIndex: 39,
        top: 'calc(env(safe-area-inset-top, 0px) + 36px)',
        paddingLeft: '60px',
      }}
    >
      <div
        ref={scrollRef}
        className="flex-1 flex items-center overflow-x-auto scrollbar-none gap-0.5 px-2"
      >
        {drawings.map(d => {
          const active = d.id === activeDrawingId;
          const cfg = TYPE_BADGE[d.drawingType] || TYPE_BADGE.standalone;
          return (
            <button
              key={d.id}
              data-active={active}
              onClick={() => handleSelect(d.id)}
              className={`flex items-center gap-1.5 px-3 py-1.5 whitespace-nowrap text-xs transition-colors shrink-0 border-b-2 ${
                active
                  ? `${isLight ? 'text-gray-900' : 'text-white'} border-blue-500`
                  : `${isLight ? 'text-gray-500' : 'text-gray-400'} border-transparent hover:border-white/20`
              }`}
            >
              <span className={`text-[9px] font-semibold px-1 py-0.5 rounded ${cfg.cls}`}>
                {cfg.abbr}
              </span>
              <span className="max-w-[120px] truncate">{d.name}</span>
            </button>
          );
        })}
      </div>

      {showOverflow && (
        <button
          onClick={onOverflow}
          className={`px-2 py-1.5 text-xs ${isLight ? 'text-gray-600' : 'text-gray-400'} active:bg-white/10 shrink-0`}
        >
          ...
        </button>
      )}
    </div>
  );
}
