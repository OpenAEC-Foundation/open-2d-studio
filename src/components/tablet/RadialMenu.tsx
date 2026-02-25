import { useState, useEffect, useCallback, useRef } from 'react';
import { useAppStore } from '../../state/appStore';

interface RadialMenuProps {
  screenX: number;
  screenY: number;
  onClose: () => void;
  onSearch: () => void;
  onThemeCycle: () => void;
}

interface MenuItem {
  label: string;
  icon: React.ReactNode;
  action: () => void;
  disabled?: boolean;
}

const RADIUS = 80;
const ITEM_SIZE = 44;

export function RadialMenu({ screenX, screenY, onClose, onSearch, onThemeCycle }: RadialMenuProps) {
  const [active, setActive] = useState<number | null>(null);
  const [appeared, setAppeared] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const zoomToFit = useAppStore(s => s.zoomToFit);
  const toggleGrid = useAppStore(s => s.toggleGrid);
  const undo = useAppStore(s => s.undo);
  const redo = useAppStore(s => s.redo);
  const canUndo = useAppStore(s => s.canUndo());
  const canRedo = useAppStore(s => s.canRedo());

  const items: MenuItem[] = [
    {
      label: 'Fit',
      action: zoomToFit,
      icon: (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />
        </svg>
      ),
    },
    {
      label: 'Grid',
      action: toggleGrid,
      icon: (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <rect x="3" y="3" width="18" height="18" />
          <line x1="3" y1="9" x2="21" y2="9" />
          <line x1="3" y1="15" x2="21" y2="15" />
          <line x1="9" y1="3" x2="9" y2="21" />
          <line x1="15" y1="3" x2="15" y2="21" />
        </svg>
      ),
    },
    {
      label: 'Undo',
      action: undo,
      disabled: !canUndo,
      icon: (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <polyline points="1 4 1 10 7 10" />
          <path d="M3.51 15a9 9 0 102.13-9.36L1 10" />
        </svg>
      ),
    },
    {
      label: 'Redo',
      action: redo,
      disabled: !canRedo,
      icon: (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <polyline points="23 4 23 10 17 10" />
          <path d="M20.49 15a9 9 0 11-2.13-9.36L23 10" />
        </svg>
      ),
    },
    {
      label: 'Search',
      action: onSearch,
      icon: (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <circle cx="11" cy="11" r="8" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
      ),
    },
    {
      label: 'Theme',
      action: onThemeCycle,
      icon: (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <circle cx="12" cy="12" r="9" />
          <path d="M12 3a9 9 0 010 18" fill="currentColor" opacity="0.3" />
        </svg>
      ),
    },
  ];

  useEffect(() => {
    requestAnimationFrame(() => setAppeared(true));
  }, []);

  const getItemPosition = (index: number) => {
    const angle = (index / items.length) * Math.PI * 2 - Math.PI / 2;
    return {
      x: Math.cos(angle) * RADIUS,
      y: Math.sin(angle) * RADIUS,
    };
  };

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    const dx = e.clientX - screenX;
    const dy = e.clientY - screenY;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < 20) {
      setActive(null);
      return;
    }
    // Find nearest item
    let closest = -1;
    let closestDist = Infinity;
    for (let i = 0; i < items.length; i++) {
      const pos = getItemPosition(i);
      const d = Math.sqrt((dx - pos.x) ** 2 + (dy - pos.y) ** 2);
      if (d < closestDist) {
        closestDist = d;
        closest = i;
      }
    }
    setActive(closestDist < ITEM_SIZE ? closest : null);
  }, [screenX, screenY, items.length]);

  const handlePointerUp = useCallback(() => {
    if (active !== null && !items[active].disabled) {
      items[active].action();
    }
    onClose();
  }, [active, items, onClose]);

  // Clamp position to stay on screen
  const cx = Math.max(RADIUS + 16, Math.min(screenX, window.innerWidth - RADIUS - 16));
  const cy = Math.max(RADIUS + 16, Math.min(screenY, window.innerHeight - RADIUS - 16));

  return (
    <div
      ref={containerRef}
      className="fixed inset-0"
      style={{ zIndex: 80 }}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onClick={onClose}
    >
      {/* Center dot */}
      <div
        className="absolute w-3 h-3 rounded-full bg-white/20"
        style={{ left: cx - 6, top: cy - 6 }}
      />

      {/* Items */}
      {items.map((item, i) => {
        const pos = getItemPosition(i);
        const isActive = active === i;
        const delay = i * 50;

        return (
          <div
            key={item.label}
            className={`absolute flex flex-col items-center justify-center rounded-full transition-all duration-150 ${
              item.disabled
                ? 'opacity-30'
                : isActive
                  ? 'bg-blue-600/90 text-white scale-110'
                  : 'bg-gray-800/90 text-gray-200'
            } backdrop-blur-sm`}
            style={{
              width: ITEM_SIZE,
              height: ITEM_SIZE,
              left: cx + pos.x - ITEM_SIZE / 2,
              top: cy + pos.y - ITEM_SIZE / 2,
              transform: appeared ? 'scale(1)' : 'scale(0)',
              opacity: appeared ? 1 : 0,
              transition: `transform 200ms cubic-bezier(0.34, 1.56, 0.64, 1) ${delay}ms, opacity 150ms ease ${delay}ms`,
            }}
          >
            {item.icon}
            <span className="text-[7px] mt-0.5 leading-none">{item.label}</span>
          </div>
        );
      })}
    </div>
  );
}
