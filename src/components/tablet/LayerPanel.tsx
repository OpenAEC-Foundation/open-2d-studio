import { useState } from 'react';
import { useAppStore } from '../../state/appStore';

interface LayerPanelProps {
  open: boolean;
  onClose: () => void;
  isLight: boolean;
}

export function LayerPanel({ open, onClose, isLight }: LayerPanelProps) {
  const layers = useAppStore(s => s.layers);
  const activeDrawingId = useAppStore(s => s.activeDrawingId);
  const updateLayer = useAppStore(s => s.updateLayer);
  const [search, setSearch] = useState('');

  const drawingLayers = layers.filter(l => l.drawingId === activeDrawingId);
  const filtered = search.trim()
    ? drawingLayers.filter(l => l.name.toLowerCase().includes(search.toLowerCase()))
    : drawingLayers;

  const showAll = () => drawingLayers.forEach(l => updateLayer(l.id, { visible: true }));
  const hideAll = () => drawingLayers.forEach(l => updateLayer(l.id, { visible: false }));
  const invertAll = () => drawingLayers.forEach(l => updateLayer(l.id, { visible: !l.visible }));

  return (
    <>
      {/* Backdrop */}
      {open && (
        <div
          className="fixed inset-0 bg-black/40 transition-opacity duration-200"
          style={{ zIndex: 60 }}
          onClick={onClose}
        />
      )}

      {/* Panel */}
      <div
        className={`fixed top-0 right-0 h-full w-[280px] ${
          isLight ? 'bg-gray-100/95' : 'bg-gray-900/95'
        } backdrop-blur-md shadow-2xl flex flex-col`}
        style={{
          zIndex: 61,
          transform: open ? 'translateX(0)' : 'translateX(100%)',
          transition: 'transform 300ms cubic-bezier(0.34, 1.56, 0.64, 1)',
          paddingTop: 'env(safe-area-inset-top, 0px)',
          paddingBottom: 'env(safe-area-inset-bottom, 0px)',
        }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
          <span className={`text-sm font-medium ${isLight ? 'text-gray-900' : 'text-white'}`}>Layers</span>
          <div className="flex items-center gap-1">
            {/* Bulk actions */}
            <button
              onClick={showAll}
              className="w-7 h-7 flex items-center justify-center rounded text-gray-400 active:bg-white/10"
              title="Show all"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                <circle cx="12" cy="12" r="3" />
              </svg>
            </button>
            <button
              onClick={hideAll}
              className="w-7 h-7 flex items-center justify-center rounded text-gray-400 active:bg-white/10"
              title="Hide all"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94" />
                <line x1="1" y1="1" x2="23" y2="23" />
              </svg>
            </button>
            <button
              onClick={invertAll}
              className="w-7 h-7 flex items-center justify-center rounded text-gray-400 active:bg-white/10"
              title="Invert visibility"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <polyline points="17 1 21 5 17 9" />
                <path d="M3 11V9a4 4 0 014-4h14" />
                <polyline points="7 23 3 19 7 15" />
                <path d="M21 13v2a4 4 0 01-4 4H3" />
              </svg>
            </button>
            <button
              onClick={onClose}
              className="w-7 h-7 flex items-center justify-center rounded text-gray-400 active:bg-white/10 ml-1"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        </div>

        {/* Search */}
        <div className="px-3 py-2 border-b border-white/5">
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Filter layers..."
            className={`w-full px-3 py-1.5 rounded-lg text-xs outline-none ${
              isLight
                ? 'bg-gray-200 text-gray-900 placeholder-gray-400'
                : 'bg-white/5 text-white placeholder-gray-500'
            }`}
          />
        </div>

        {/* Layer list */}
        <div className="flex-1 overflow-y-auto px-2 py-2">
          {filtered.length === 0 ? (
            <p className="text-gray-500 text-xs text-center py-8">
              {search.trim() ? 'No matching layers' : 'No layers'}
            </p>
          ) : (
            <div className="space-y-0.5">
              {filtered.map(layer => (
                <div
                  key={layer.id}
                  className="flex items-center gap-3 px-3 py-2.5 rounded-lg active:bg-white/5 transition-colors"
                >
                  {/* Color dot */}
                  <span
                    className="w-3 h-3 rounded-full flex-shrink-0"
                    style={{ backgroundColor: layer.color }}
                  />

                  {/* Name */}
                  <span className={`flex-1 text-sm truncate ${
                    layer.visible
                      ? isLight ? 'text-gray-900' : 'text-white'
                      : 'text-gray-500'
                  }`}>
                    {layer.name}
                  </span>

                  {/* Visibility toggle */}
                  <button
                    onClick={() => updateLayer(layer.id, { visible: !layer.visible })}
                    className={`w-8 h-8 flex items-center justify-center rounded-lg transition-colors ${
                      layer.visible
                        ? `${isLight ? 'text-gray-900' : 'text-white'} active:bg-white/10`
                        : 'text-gray-600 active:bg-white/10'
                    }`}
                    title={layer.visible ? 'Hide layer' : 'Show layer'}
                  >
                    {layer.visible ? (
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                        <circle cx="12" cy="12" r="3" />
                      </svg>
                    ) : (
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24" />
                        <line x1="1" y1="1" x2="23" y2="23" />
                      </svg>
                    )}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
