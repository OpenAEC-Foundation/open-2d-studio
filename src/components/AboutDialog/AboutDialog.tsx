import { useState, useRef, useCallback } from 'react';
import { X } from 'lucide-react';

interface AboutDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

export function AboutDialog({ isOpen, onClose }: AboutDialogProps) {
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

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
    >
      <div
        className="bg-cad-surface border border-cad-border shadow-xl w-80 h-[280px] flex flex-col"
        style={{ transform: `translate(${position.x}px, ${position.y}px)` }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-3 py-1.5 border-b border-cad-border select-none"
          style={{ background: 'linear-gradient(to bottom, #ffffff, #f5f5f5)', borderColor: '#d4d4d4' }}
          onMouseDown={handleMouseDown}
        >
          <h2 className="text-xs font-semibold text-gray-800">About</h2>
          <button
            onClick={onClose}
            className="p-0.5 hover:bg-cad-hover rounded transition-colors text-gray-600 hover:text-gray-800 cursor-default -mr-1"
          >
            <X size={14} />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 p-4 flex flex-col items-center text-center justify-center">
          <h1 className="text-lg font-bold text-cad-text mb-1">Open 2D Studio</h1>
          <p className="text-xs text-cad-text-dim mb-3">Version 0.8.0</p>

          <p className="text-xs text-cad-text-dim mb-3">
            A cross-platform 2D CAD application
          </p>

          <a
            href="https://impertio.nl/"
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-cad-accent hover:underline mb-3"
          >
            impertio.nl
          </a>

          <p className="text-xs text-cad-text-dim">
            © 2025 Impertio. All rights reserved.
          </p>
        </div>

        {/* Footer */}
        <div className="px-3 py-2 border-t border-cad-border flex justify-end">
          <button
            onClick={onClose}
            className="px-3 py-1 text-xs bg-cad-accent text-white hover:bg-cad-accent/80"
          >
            OK
          </button>
        </div>
      </div>
    </div>
  );
}
