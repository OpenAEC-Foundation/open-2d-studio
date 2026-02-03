import { useState, useRef, useCallback } from 'react';
import { X } from 'lucide-react';
import type { Sheet } from '../../types/geometry';

interface SheetSelectionDialogProps {
  sheets: Sheet[];
  selectedIds: string[];
  onConfirm: (ids: string[]) => void;
  onCancel: () => void;
}

export function SheetSelectionDialog({ sheets, selectedIds, onConfirm, onCancel }: SheetSelectionDialogProps) {
  const [selected, setSelected] = useState<Set<string>>(new Set(selectedIds));
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const dragStartRef = useRef({ x: 0, y: 0 });

  const toggle = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  };

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

  return (
    <div
      className="fixed inset-0 bg-black/40 flex items-center justify-center z-[60]"
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
    >
      <div
        className="bg-cad-surface border border-cad-border shadow-xl w-[360px] h-[400px] flex flex-col"
        style={{ transform: `translate(${position.x}px, ${position.y}px)` }}
      >
        <div
          className="flex items-center justify-between px-3 py-1.5 border-b border-cad-border select-none"
          style={{ background: 'linear-gradient(to bottom, #ffffff, #f5f5f5)', borderColor: '#d4d4d4' }}
          onMouseDown={handleMouseDown}
        >
          <h3 className="text-xs font-semibold text-gray-800">Select Sheets</h3>
          <button onClick={onCancel} className="p-0.5 hover:bg-cad-hover rounded transition-colors text-gray-600 hover:text-gray-800 cursor-default -mr-1">
            <X size={14} />
          </button>
        </div>

        <div className="flex gap-2 px-3 pt-2">
          <button
            onClick={() => setSelected(new Set(sheets.map(s => s.id)))}
            className="text-xs text-cad-accent hover:underline"
          >
            Select All
          </button>
          <button
            onClick={() => setSelected(new Set())}
            className="text-xs text-cad-accent hover:underline"
          >
            Deselect All
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-3 space-y-1">
          {sheets.length === 0 ? (
            <p className="text-xs text-cad-text-dim">No sheets available.</p>
          ) : (
            sheets.map(sheet => (
              <label key={sheet.id} className="flex items-center gap-2 cursor-pointer py-1">
                <input
                  type="checkbox"
                  checked={selected.has(sheet.id)}
                  onChange={() => toggle(sheet.id)}
                  className="accent-cad-accent"
                />
                <span className="text-xs text-cad-text">{sheet.name}</span>
                <span className="text-xs text-cad-text-dim ml-auto">
                  {sheet.paperSize} {sheet.orientation}
                </span>
              </label>
            ))
          )}
        </div>

        <div className="flex justify-end gap-2 px-3 py-2 border-t border-cad-border">
          <button onClick={onCancel} className="px-3 py-1 text-xs bg-cad-input border border-cad-border text-cad-text hover:bg-cad-hover">
            Cancel
          </button>
          <button
            onClick={() => onConfirm(Array.from(selected))}
            className="px-3 py-1 text-xs bg-cad-accent text-white hover:bg-cad-accent/80"
          >
            OK
          </button>
        </div>
      </div>
    </div>
  );
}
