import { useState, useRef, useCallback } from 'react';
import { X } from 'lucide-react';
import { useAppStore } from '../../state/appStore';
import type { SnapType } from '../../types/geometry';

interface SnapSettingsDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

interface SnapTypeOption {
  type: SnapType;
  label: string;
  description: string;
  symbol: string;
  color: string;
}

const snapTypes: SnapTypeOption[] = [
  {
    type: 'endpoint',
    label: 'Endpoint',
    description: 'Snap to endpoints of lines, arcs, and polyline vertices',
    symbol: '□',
    color: '#00ff00',
  },
  {
    type: 'midpoint',
    label: 'Midpoint',
    description: 'Snap to midpoints of lines and arc segments',
    symbol: '△',
    color: '#00ffff',
  },
  {
    type: 'center',
    label: 'Center',
    description: 'Snap to centers of circles, arcs, and ellipses',
    symbol: '○',
    color: '#ff00ff',
  },
  {
    type: 'intersection',
    label: 'Intersection',
    description: 'Snap to intersections of lines and curves',
    symbol: '×',
    color: '#ffff00',
  },
  {
    type: 'perpendicular',
    label: 'Perpendicular',
    description: 'Snap perpendicular to lines',
    symbol: '⊥',
    color: '#ff8800',
  },
  {
    type: 'tangent',
    label: 'Tangent',
    description: 'Snap tangent to circles and arcs',
    symbol: '◎',
    color: '#88ff00',
  },
  {
    type: 'nearest',
    label: 'Nearest',
    description: 'Snap to nearest point on an object',
    symbol: '◇',
    color: '#ff88ff',
  },
  {
    type: 'grid',
    label: 'Grid',
    description: 'Snap to grid intersections',
    symbol: '+',
    color: '#8888ff',
  },
];

export function SnapSettingsDialog({ isOpen, onClose }: SnapSettingsDialogProps) {
  const {
    activeSnaps,
    toggleSnapType,
    snapEnabled,
    toggleSnap,
    snapTolerance,
    setSnapTolerance,
  } = useAppStore();

  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const dragStartRef = useRef({ x: 0, y: 0 });

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('button')) return;
    setIsDragging(true);
    dragStartRef.current = { x: e.clientX - position.x, y: e.clientY - position.y };
  }, [position]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isDragging) return;
    setPosition({
      x: e.clientX - dragStartRef.current.x,
      y: e.clientY - dragStartRef.current.y,
    });
  }, [isDragging]);

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
  }, []);

  if (!isOpen) return null;

  const handleSelectAll = () => {
    const allTypes = snapTypes.map((s) => s.type);
    for (const type of allTypes) {
      if (!activeSnaps.includes(type)) {
        toggleSnapType(type);
      }
    }
  };

  const handleClearAll = () => {
    for (const type of activeSnaps) {
      toggleSnapType(type);
    }
  };

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
    >
      <div
        className="bg-cad-surface border border-cad-border shadow-xl w-[420px] h-[520px] flex flex-col"
        style={{ transform: `translate(${position.x}px, ${position.y}px)` }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-3 py-1.5 border-b border-cad-border select-none"
          style={{ background: 'linear-gradient(to bottom, #ffffff, #f5f5f5)', borderColor: '#d4d4d4' }}
          onMouseDown={handleMouseDown}
        >
          <h2 className="text-xs font-semibold text-gray-800">Object Snap Settings</h2>
          <button
            onClick={onClose}
            className="p-0.5 hover:bg-cad-hover rounded transition-colors text-gray-600 hover:text-gray-800 cursor-default -mr-1"
          >
            <X size={14} />
          </button>
        </div>

        {/* Content */}
        <div className="p-4">
          {/* Master toggle */}
          <div className="flex items-center justify-between mb-4 pb-4 border-b border-cad-border">
            <div>
              <span className="text-sm font-medium">Object Snap</span>
              <p className="text-xs text-cad-text-dim">Enable/disable all object snaps (S)</p>
            </div>
            <button
              onClick={toggleSnap}
              className={`w-12 h-6 rounded-full transition-colors relative ${
                snapEnabled ? 'bg-cad-accent' : 'bg-cad-border'
              }`}
            >
              <div
                className={`w-5 h-5 bg-white rounded-full absolute top-0.5 transition-transform ${
                  snapEnabled ? 'translate-x-6' : 'translate-x-0.5'
                }`}
              />
            </button>
          </div>

          {/* Snap tolerance */}
          <div className="mb-4 pb-4 border-b border-cad-border">
            <label className="text-sm font-medium block mb-2">
              Snap Tolerance: {snapTolerance}px
            </label>
            <input
              type="range"
              min="5"
              max="30"
              value={snapTolerance}
              onChange={(e) => setSnapTolerance(Number(e.target.value))}
              className="w-full h-2 bg-cad-border rounded-lg appearance-none cursor-pointer accent-cad-accent"
            />
            <div className="flex justify-between text-xs text-cad-text-dim mt-1">
              <span>5px</span>
              <span>30px</span>
            </div>
          </div>

          {/* Quick actions */}
          <div className="flex gap-2 mb-4">
            <button
              onClick={handleSelectAll}
              className="px-3 py-1 text-xs bg-cad-border hover:bg-cad-accent/50 rounded transition-colors"
            >
              Select All
            </button>
            <button
              onClick={handleClearAll}
              className="px-3 py-1 text-xs bg-cad-border hover:bg-cad-accent/50 rounded transition-colors"
            >
              Clear All
            </button>
          </div>

          {/* Snap types grid */}
          <div className="grid grid-cols-2 gap-2 max-h-[300px] overflow-y-auto">
            {snapTypes.map((snap) => {
              const isActive = activeSnaps.includes(snap.type);
              return (
                <button
                  key={snap.type}
                  onClick={() => toggleSnapType(snap.type)}
                  className={`flex items-start gap-3 p-3 rounded border transition-colors text-left ${
                    isActive
                      ? 'border-cad-accent bg-cad-accent/10'
                      : 'border-cad-border hover:border-cad-text-dim'
                  }`}
                >
                  <span
                    className="text-xl w-6 flex-shrink-0 text-center"
                    style={{ color: snap.color }}
                  >
                    {snap.symbol}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium">{snap.label}</div>
                    <div className="text-xs text-cad-text-dim line-clamp-2">
                      {snap.description}
                    </div>
                  </div>
                  <div
                    className={`w-4 h-4 rounded border flex-shrink-0 flex items-center justify-center ${
                      isActive
                        ? 'bg-cad-accent border-cad-accent'
                        : 'border-cad-text-dim'
                    }`}
                  >
                    {isActive && (
                      <svg
                        width="10"
                        height="8"
                        viewBox="0 0 10 8"
                        fill="none"
                        stroke="white"
                        strokeWidth="2"
                      >
                        <path d="M1 4L4 7L9 1" />
                      </svg>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Footer */}
        <div className="px-3 py-2 border-t border-cad-border flex justify-end gap-2">
          <button
            onClick={onClose}
            className="px-3 py-1 text-xs bg-cad-accent text-white hover:bg-cad-accent/80"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
