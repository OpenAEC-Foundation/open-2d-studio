import { useAppStore } from '../../state/appStore';

interface InfoBarProps {
  visible: boolean;
  isLight: boolean;
}

export function InfoBar({ visible, isLight }: InfoBarProps) {
  const projectName = useAppStore(s => s.projectName);
  const drawings = useAppStore(s => s.drawings);
  const activeDrawingId = useAppStore(s => s.activeDrawingId);
  const viewport = useAppStore(s => s.viewport);

  const activeDrawing = drawings.find(d => d.id === activeDrawingId);
  const drawingName = activeDrawing?.name || '';
  const scale = activeDrawing?.scale;

  const label = drawingName
    ? `${projectName} — ${drawingName}`
    : projectName || 'Open 2D Studio';

  const zoomPct = `${Math.round(viewport.zoom * 100)}%`;
  const scaleLabel = scale ? `1:${Math.round(1 / scale)}` : '';

  return (
    <div
      className={`fixed left-1/2 -translate-x-1/2 px-5 py-2 ${
        isLight ? 'bg-white/50 text-gray-900' : 'bg-black/50 text-white'
      } backdrop-blur-sm text-sm rounded-b-xl truncate max-w-[80vw] text-center transition-all duration-300 pointer-events-none select-none`}
      style={{
        zIndex: 40,
        top: 'env(safe-area-inset-top, 0px)',
        opacity: visible ? 1 : 0,
        transform: `translateX(-50%) translateY(${visible ? '0' : '-100%'})`,
        paddingLeft: '60px',
      }}
    >
      <span>{label}</span>
      {(scaleLabel || zoomPct) && (
        <span className={`ml-3 text-xs ${isLight ? 'text-gray-500' : 'text-gray-400'}`}>
          {scaleLabel && <span>{scaleLabel}</span>}
          {scaleLabel && zoomPct && <span className="mx-1.5">·</span>}
          {zoomPct && <span>{zoomPct}</span>}
        </span>
      )}
    </div>
  );
}
