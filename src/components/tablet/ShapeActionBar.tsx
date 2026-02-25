import { useEffect, useRef } from 'react';

interface ShapeActionBarProps {
  screenX: number;
  screenY: number;
  onInfo: () => void;
  onZoomTo: () => void;
  onCopyXY: () => void;
  onDismiss: () => void;
}

export function ShapeActionBar({ screenX, screenY, onInfo, onZoomTo, onCopyXY, onDismiss }: ShapeActionBarProps) {
  const barRef = useRef<HTMLDivElement>(null);

  // Dismiss on click outside
  useEffect(() => {
    const handle = (e: PointerEvent) => {
      if (barRef.current && !barRef.current.contains(e.target as Node)) {
        onDismiss();
      }
    };
    window.addEventListener('pointerdown', handle, true);
    return () => window.removeEventListener('pointerdown', handle, true);
  }, [onDismiss]);

  // Clamp to screen
  const barWidth = 180;
  const barHeight = 44;
  const x = Math.max(8, Math.min(screenX - barWidth / 2, window.innerWidth - barWidth - 8));
  const y = Math.max(8, screenY - barHeight - 16);

  return (
    <div
      ref={barRef}
      className="fixed flex items-center gap-1 px-2 py-1.5 bg-gray-800/90 backdrop-blur-sm rounded-xl shadow-lg"
      style={{
        zIndex: 55,
        left: x,
        top: y,
        animation: 'shapeBarIn 200ms cubic-bezier(0.34, 1.56, 0.64, 1) both',
      }}
    >
      <style>{`
        @keyframes shapeBarIn {
          from { transform: scale(0); opacity: 0; }
          to { transform: scale(1); opacity: 1; }
        }
      `}</style>
      <ActionBtn label="Info" onClick={onInfo}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="16" x2="12" y2="12" />
          <line x1="12" y1="8" x2="12.01" y2="8" />
        </svg>
      </ActionBtn>
      <ActionBtn label="Zoom To" onClick={onZoomTo}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <circle cx="11" cy="11" r="8" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
          <line x1="11" y1="8" x2="11" y2="14" />
          <line x1="8" y1="11" x2="14" y2="11" />
        </svg>
      </ActionBtn>
      <ActionBtn label="Copy XY" onClick={onCopyXY}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <rect x="9" y="9" width="13" height="13" rx="2" />
          <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
        </svg>
      </ActionBtn>
    </div>
  );
}

function ActionBtn({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className="flex flex-col items-center justify-center w-[52px] h-[36px] rounded-lg text-gray-200 active:bg-white/10 active:scale-95 transition-transform"
    >
      {children}
      <span className="text-[8px] leading-none mt-0.5">{label}</span>
    </button>
  );
}
