import { useMemo, memo } from 'react';
import { Eye, EyeOff, Lock, Unlock, Plus, Trash2 } from 'lucide-react';
import { useAppStore } from '../../state/appStore';

export const LayersPanel = memo(function LayersPanel() {
  const layers = useAppStore(s => s.layers);
  const activeLayerId = useAppStore(s => s.activeLayerId);
  const activeDrawingId = useAppStore(s => s.activeDrawingId);
  const setActiveLayer = useAppStore(s => s.setActiveLayer);
  const addLayer = useAppStore(s => s.addLayer);
  const updateLayer = useAppStore(s => s.updateLayer);
  const deleteLayer = useAppStore(s => s.deleteLayer);

  // Filter layers by active drawing
  const filteredLayers = useMemo(() => {
    return layers.filter(layer => layer.drawingId === activeDrawingId);
  }, [layers, activeDrawingId]);

  return (
    <div className="flex-1 overflow-auto">
      <div className="p-3">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-cad-text">Layers</h3>
          <button
            onClick={() => addLayer()}
            className="p-1 rounded hover:bg-cad-border transition-colors"
            title="Add Layer"
          >
            <Plus size={16} />
          </button>
        </div>

        <div className="space-y-1">
          {filteredLayers.map((layer) => (
            <div
              key={layer.id}
              className={`flex items-center gap-2 p-2 rounded cursor-pointer transition-colors ${
                layer.id === activeLayerId
                  ? 'bg-cad-accent/20 border border-cad-accent'
                  : 'hover:bg-cad-border/50 border border-transparent'
              }`}
              onClick={() => setActiveLayer(layer.id)}
            >
              {/* Color indicator */}
              <div
                className="w-4 h-4 rounded border border-cad-border"
                style={{ backgroundColor: layer.color }}
              />

              {/* Layer name */}
              <span className="flex-1 text-xs text-cad-text truncate">
                {layer.name}
              </span>

              {/* Visibility toggle */}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  updateLayer(layer.id, { visible: !layer.visible });
                }}
                className={`p-1 rounded transition-colors ${
                  layer.visible
                    ? 'text-cad-text hover:text-cad-accent'
                    : 'text-cad-text-dim hover:text-cad-text'
                }`}
                title={layer.visible ? 'Hide Layer' : 'Show Layer'}
              >
                {layer.visible ? <Eye size={14} /> : <EyeOff size={14} />}
              </button>

              {/* Lock toggle */}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  updateLayer(layer.id, { locked: !layer.locked });
                }}
                className={`p-1 rounded transition-colors ${
                  layer.locked
                    ? 'text-cad-accent'
                    : 'text-cad-text-dim hover:text-cad-text'
                }`}
                title={layer.locked ? 'Unlock Layer' : 'Lock Layer'}
              >
                {layer.locked ? <Lock size={14} /> : <Unlock size={14} />}
              </button>

              {/* Delete button */}
              {filteredLayers.length > 1 && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    deleteLayer(layer.id);
                  }}
                  className="p-1 rounded text-cad-text-dim hover:text-red-400 transition-colors"
                  title="Delete Layer"
                >
                  <Trash2 size={14} />
                </button>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
});
