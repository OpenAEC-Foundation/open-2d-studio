import { useState, useRef, useEffect } from 'react';
import { Plus, Trash2, Pencil, Check, X, ArrowRightToLine } from 'lucide-react';
import { useAppStore } from '../../state/appStore';
import type { DrawingType } from '../../types/geometry';

// Drawing type badge colors and labels
const DRAWING_TYPE_CONFIG: Record<DrawingType, { label: string; abbr: string; color: string; title: string }> = {
  standalone: { label: 'Stand Alone', abbr: 'SA', color: 'bg-gray-500/30 text-gray-300', title: 'Stand Alone drawing' },
  plan: { label: 'Plan', abbr: 'PL', color: 'bg-blue-500/30 text-blue-300', title: 'Plan drawing (IfcBuildingStorey)' },
  section: { label: 'Section', abbr: 'SC', color: 'bg-amber-500/30 text-amber-300', title: 'Section drawing (cross-section view)' },
};

export function DrawingsTab() {
  const {
    drawings,
    activeDrawingId,
    editorMode,
    addDrawing,
    deleteDrawing,
    renameDrawing,
    switchToDrawing,
    startDrawingPlacement,
    isPlacing,
    placingDrawingId,
  } = useAppStore();

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [showNewDrawingMenu, setShowNewDrawingMenu] = useState(false);
  const newDrawingMenuRef = useRef<HTMLDivElement>(null);

  // Close new-drawing dropdown on outside click
  useEffect(() => {
    if (!showNewDrawingMenu) return;
    const handleClick = (e: MouseEvent) => {
      if (newDrawingMenuRef.current && !newDrawingMenuRef.current.contains(e.target as Node)) {
        setShowNewDrawingMenu(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [showNewDrawingMenu]);

  const handleStartEdit = (id: string, name: string) => {
    setEditingId(id);
    setEditName(name);
  };

  const handleConfirmEdit = () => {
    if (editingId && editName.trim()) {
      renameDrawing(editingId, editName.trim());
    }
    setEditingId(null);
    setEditName('');
  };

  const handleCancelEdit = () => {
    setEditingId(null);
    setEditName('');
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleConfirmEdit();
    } else if (e.key === 'Escape') {
      handleCancelEdit();
    }
  };

  // Handle placing drawing on sheet
  const handlePlaceOnSheet = (drawingId: string) => {
    startDrawingPlacement(drawingId);
  };

  // Handle creating a new drawing with a specific type
  const handleNewDrawing = (type: DrawingType) => {
    addDrawing(undefined, type);
    setShowNewDrawingMenu(false);
  };

  // Check if we can place drawings (only in sheet mode)
  const canPlace = editorMode === 'sheet';

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex items-center justify-end px-2 py-1 border-b border-cad-border relative">
        <div ref={newDrawingMenuRef} className="relative">
          <button
            onClick={() => setShowNewDrawingMenu(!showNewDrawingMenu)}
            className="p-1 rounded hover:bg-cad-border transition-colors"
            title="Add Drawing"
          >
            <Plus size={14} />
          </button>

          {/* New Drawing Type Dropdown */}
          {showNewDrawingMenu && (
            <div className="absolute right-0 top-full mt-1 z-50 bg-cad-surface border border-cad-border rounded shadow-lg min-w-[140px]">
              {(['standalone', 'plan', 'section'] as DrawingType[]).map((type) => {
                const cfg = DRAWING_TYPE_CONFIG[type];
                return (
                  <button
                    key={type}
                    onClick={() => handleNewDrawing(type)}
                    className="w-full text-left px-3 py-1.5 text-xs text-cad-text hover:bg-cad-border/50 transition-colors flex items-center gap-2 cursor-default"
                  >
                    <span className={`text-[9px] font-medium px-1 rounded ${cfg.color}`}>{cfg.abbr}</span>
                    {cfg.label}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Drawings List */}
      <div className="flex-1 overflow-auto p-2">
        <div className="space-y-1">
          {drawings.map((drawing) => {
            const isActive = drawing.id === activeDrawingId && editorMode === 'drawing';

            return (
              <div key={drawing.id}>
                <div
                  className={`group flex items-center gap-2 px-2 py-1.5 rounded cursor-default transition-colors ${
                    isActive
                      ? 'bg-cad-accent/20 border border-cad-accent'
                      : isPlacing && placingDrawingId === drawing.id
                      ? 'bg-green-500/20 border border-green-500'
                      : 'hover:bg-cad-border/50 border border-transparent'
                  }`}
                  onClick={() => switchToDrawing(drawing.id)}
                  onDoubleClick={() => switchToDrawing(drawing.id)}
                >
                  {editingId === drawing.id ? (
                    <>
                      <input
                        type="text"
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        onKeyDown={handleKeyDown}
                        onClick={(e) => e.stopPropagation()}
                        className="flex-1 bg-cad-bg border border-cad-accent rounded px-1 py-0.5 text-xs text-cad-text outline-none"
                        autoFocus
                      />
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleConfirmEdit();
                        }}
                        className="p-0.5 rounded hover:bg-cad-border text-green-400"
                        title="Confirm"
                      >
                        <Check size={12} />
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleCancelEdit();
                        }}
                        className="p-0.5 rounded hover:bg-cad-border text-red-400"
                        title="Cancel"
                      >
                        <X size={12} />
                      </button>
                    </>
                  ) : (
                    <>
                      {/* Drawing name */}
                      <span className="flex-1 text-xs text-cad-text truncate">
                        {drawing.name}
                      </span>

                      {/* Place on Sheet button (visible in sheet mode) */}
                      {canPlace && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handlePlaceOnSheet(drawing.id);
                          }}
                          className={`p-0.5 rounded hover:bg-cad-border transition-all ${
                            isPlacing && placingDrawingId === drawing.id
                              ? 'opacity-100 text-green-400'
                              : 'opacity-0 group-hover:opacity-100 text-cad-text-dim hover:text-green-400'
                          }`}
                          title="Place on Sheet"
                        >
                          <ArrowRightToLine size={12} />
                        </button>
                      )}

                      {/* Edit button (visible on hover) */}
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleStartEdit(drawing.id, drawing.name);
                        }}
                        className="p-0.5 rounded opacity-0 group-hover:opacity-100 hover:bg-cad-border text-cad-text-dim hover:text-cad-text transition-all"
                        title="Rename"
                      >
                        <Pencil size={12} />
                      </button>

                      {/* Delete button (visible on hover, only if more than one drawing) */}
                      {drawings.length > 1 && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            deleteDrawing(drawing.id);
                          }}
                          className="p-0.5 rounded opacity-0 group-hover:opacity-100 hover:bg-cad-border text-cad-text-dim hover:text-red-400 transition-all"
                          title="Delete Drawing"
                        >
                          <Trash2 size={12} />
                        </button>
                      )}
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// Legacy alias
export { DrawingsTab as DraftsTab };
