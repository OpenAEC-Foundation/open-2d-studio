import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { useAppStore } from '../../state/appStore';

interface SearchPanelProps {
  open: boolean;
  onClose: () => void;
  isLight: boolean;
}

export function SearchPanel({ open, onClose, isLight }: SearchPanelProps) {
  const [query, setQuery] = useState('');
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const shapes = useAppStore(s => s.shapes);
  const activeDrawingId = useAppStore(s => s.activeDrawingId);
  const selectShape = useAppStore(s => s.selectShape);
  const viewport = useAppStore(s => s.viewport);
  const setViewport = useAppStore(s => s.setViewport);
  const canvasSize = useAppStore(s => s.canvasSize);

  // Focus input when opened
  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 100);
    } else {
      setQuery('');
      setCurrentIndex(0);
    }
  }, [open]);

  const results = useMemo(() => {
    if (!query.trim()) return [];
    try {
      const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(escaped, caseSensitive ? 'g' : 'gi');
      return shapes
        .filter(s => s.type === 'text' && s.drawingId === activeDrawingId)
        .filter(s => {
          const textContent = (s as unknown as { text?: string }).text || '';
          return regex.test(textContent);
        })
        .map(s => ({
          id: s.id,
          content: (s as unknown as { text?: string }).text || '',
          position: (s as unknown as { position?: { x: number; y: number } }).position,
        }));
    } catch {
      return [];
    }
  }, [query, caseSensitive, shapes, activeDrawingId]);

  const zoomToShape = useCallback((shapeId: string) => {
    const shape = shapes.find(s => s.id === shapeId);
    if (!shape) return;
    selectShape(shapeId);
    const pos = (shape as unknown as { position?: { x: number; y: number } }).position;
    if (pos) {
      setViewport({
        zoom: Math.max(viewport.zoom, 1),
        offsetX: canvasSize.width / 2 - pos.x * Math.max(viewport.zoom, 1),
        offsetY: canvasSize.height / 2 - pos.y * Math.max(viewport.zoom, 1),
      });
    }
  }, [shapes, selectShape, setViewport, viewport.zoom, canvasSize]);

  const goToResult = useCallback((index: number) => {
    if (results.length === 0) return;
    const clamped = ((index % results.length) + results.length) % results.length;
    setCurrentIndex(clamped);
    zoomToShape(results[clamped].id);
  }, [results, zoomToShape]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      goToResult(e.shiftKey ? currentIndex - 1 : currentIndex + 1);
    } else if (e.key === 'Escape') {
      onClose();
    }
  }, [goToResult, currentIndex, onClose]);

  const highlightMatch = (text: string) => {
    if (!query.trim()) return text;
    const truncated = text.length > 60 ? text.slice(0, 60) + '...' : text;
    try {
      const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(`(${escaped})`, caseSensitive ? 'g' : 'gi');
      const parts = truncated.split(regex);
      return parts.map((part, i) =>
        regex.test(part) ? <strong key={i} className="text-blue-400">{part}</strong> : part
      );
    } catch {
      return truncated;
    }
  };

  return (
    <div
      className={`fixed left-0 right-0 ${
        isLight ? 'bg-gray-100/95' : 'bg-gray-900/95'
      } backdrop-blur-md shadow-2xl flex flex-col`}
      style={{
        zIndex: 65,
        top: 'env(safe-area-inset-top, 0px)',
        maxHeight: '50vh',
        transform: open ? 'translateY(0)' : 'translateY(-100%)',
        transition: 'transform 300ms cubic-bezier(0.34, 1.56, 0.64, 1)',
        paddingLeft: '60px',
      }}
    >
      {/* Search input */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-white/10">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="text-gray-400 shrink-0">
          <circle cx="11" cy="11" r="8" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={e => { setQuery(e.target.value); setCurrentIndex(0); }}
          onKeyDown={handleKeyDown}
          placeholder="Search text in drawing..."
          className={`flex-1 bg-transparent border-none outline-none text-sm ${
            isLight ? 'text-gray-900 placeholder-gray-400' : 'text-white placeholder-gray-500'
          }`}
        />

        {/* Case toggle */}
        <button
          onClick={() => setCaseSensitive(!caseSensitive)}
          className={`px-2 py-1 text-[10px] rounded ${
            caseSensitive
              ? 'bg-blue-600/80 text-white'
              : isLight ? 'bg-gray-200 text-gray-600' : 'bg-white/10 text-gray-400'
          }`}
        >
          Aa
        </button>

        {/* Nav arrows */}
        {results.length > 0 && (
          <div className="flex items-center gap-1">
            <button onClick={() => goToResult(currentIndex - 1)} className="w-6 h-6 flex items-center justify-center rounded text-gray-400 active:bg-white/10">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="15 18 9 12 15 6" /></svg>
            </button>
            <span className={`text-[10px] ${isLight ? 'text-gray-600' : 'text-gray-400'}`}>
              {results.length > 0 ? `${currentIndex + 1} of ${results.length}` : '0'}
            </span>
            <button onClick={() => goToResult(currentIndex + 1)} className="w-6 h-6 flex items-center justify-center rounded text-gray-400 active:bg-white/10">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="9 18 15 12 9 6" /></svg>
            </button>
          </div>
        )}

        {/* Close */}
        <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg text-gray-400 active:bg-white/10">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
        </button>
      </div>

      {/* Results */}
      {query.trim() && (
        <div className="flex-1 overflow-y-auto px-2 py-1">
          {results.length === 0 ? (
            <p className="text-gray-500 text-xs text-center py-4">No matches</p>
          ) : (
            results.map((r, i) => (
              <button
                key={r.id}
                onClick={() => { setCurrentIndex(i); zoomToShape(r.id); }}
                className={`w-full text-left px-3 py-2 rounded-lg text-xs transition-colors ${
                  i === currentIndex
                    ? 'bg-blue-600/20'
                    : 'active:bg-white/5'
                } ${isLight ? 'text-gray-800' : 'text-gray-300'}`}
              >
                {highlightMatch(r.content)}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
