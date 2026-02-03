import { useState, useCallback, useMemo } from 'react';
import { Settings } from 'lucide-react';
import { useAppStore } from '../../state/appStore';
import { ScaleSelector } from '../shared/ScaleSelector';

export function SheetPropertiesPanel() {
  const {
    sheets,
    activeSheetId,
    drawings,
    layers,
    addSheetViewport,
    updateSheetViewport,
    updateDrawingScale,
    deleteSheetViewport,
    updateTitleBlockField,
    setTitleBlockVisible,
    // Viewport editing state (synced with canvas)
    viewportEditState,
    selectViewport,
    centerViewportOnDrawing,
    fitViewportToDrawing,
    // Crop region actions
    cropRegionEditState,
    toggleCropRegion,
    startCropRegionEdit,
    endCropRegionEdit,
    resetCropRegion,
    // Layer override actions
    setLayerOverride,
    clearLayerOverrides,
    // Title block editor
    setTitleBlockEditorOpen,
  } = useAppStore();

  const [isAddingViewport, setIsAddingViewport] = useState(false);
  const [newViewportDrawingId, setNewViewportDraftId] = useState<string>('');

  // Use the global viewport selection state instead of local state
  const selectedViewportId = viewportEditState.selectedViewportId;

  const activeSheet = sheets.find(s => s.id === activeSheetId);

  const handleAddViewport = useCallback(() => {
    if (!activeSheetId || !newViewportDrawingId) return;

    // Add viewport with default size
    addSheetViewport(activeSheetId, newViewportDrawingId, {
      x: 20,  // mm from left
      y: 20,  // mm from top
      width: 150,  // mm
      height: 100,  // mm
    });

    setIsAddingViewport(false);
    setNewViewportDraftId('');
  }, [activeSheetId, newViewportDrawingId, addSheetViewport]);

  const handleDeleteViewport = useCallback((viewportId: string) => {
    if (!activeSheetId) return;
    deleteSheetViewport(activeSheetId, viewportId);
    // Selection is automatically cleared in the store if deleted viewport was selected
  }, [activeSheetId, deleteSheetViewport]);

  if (!activeSheet) {
    return (
      <div className="p-3 text-cad-text-dim text-sm">
        No sheet selected
      </div>
    );
  }

  const selectedViewport = selectedViewportId
    ? activeSheet.viewports.find(vp => vp.id === selectedViewportId)
    : null;

  return (
    <div className="flex flex-col h-full text-sm">
      {/* Sheet Info */}
      <div className="p-3 border-b border-cad-border">
        <h3 className="font-medium text-cad-text mb-2">Sheet: {activeSheet.name}</h3>
        <div className="text-cad-text-dim text-xs">
          {activeSheet.paperSize} {activeSheet.orientation}
        </div>
      </div>

      {/* Viewports Section */}
      <div className="p-3 border-b border-cad-border">
        <div className="flex items-center justify-between mb-2">
          <h4 className="font-medium text-cad-text">Viewports</h4>
          <button
            onClick={() => setIsAddingViewport(true)}
            className="px-2 py-1 text-xs bg-cad-primary hover:bg-cad-primary-hover text-white"
            title="Add Viewport"
          >
            + Add
          </button>
        </div>

        {isAddingViewport && (
          <div className="mb-2 p-2 bg-cad-surface border border-cad-border">
            <label className="block text-xs text-cad-text-dim mb-1">Drawing:</label>
            <select
              value={newViewportDrawingId}
              onChange={(e) => setNewViewportDraftId(e.target.value)}
              className="w-full px-2 py-1 text-xs bg-cad-input border border-cad-border text-cad-text mb-2"
            >
              <option value="">Select draft...</option>
              {drawings.map(d => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
            </select>
            <div className="flex gap-1">
              <button
                onClick={handleAddViewport}
                disabled={!newViewportDrawingId}
                className="flex-1 px-2 py-1 text-xs bg-cad-primary hover:bg-cad-primary-hover disabled:bg-cad-input disabled:text-cad-text-dim text-white"
              >
                Create
              </button>
              <button
                onClick={() => { setIsAddingViewport(false); setNewViewportDraftId(''); }}
                className="px-2 py-1 text-xs bg-cad-input hover:bg-cad-hover text-cad-text"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Viewport List */}
        <div className="space-y-1 max-h-32 overflow-y-auto">
          {activeSheet.viewports.length === 0 ? (
            <div className="text-xs text-cad-text-dim italic">No viewports</div>
          ) : (
            activeSheet.viewports.map(vp => {
              const draft = drawings.find(d => d.id === vp.drawingId);
              const isSelected = selectedViewportId === vp.id;
              return (
                <div
                  key={vp.id}
                  onClick={() => selectViewport(isSelected ? null : vp.id)}
                  className={`flex items-center justify-between px-2 py-1 cursor-pointer ${
                    isSelected
                      ? 'bg-cad-primary text-white'
                      : 'bg-cad-input hover:bg-cad-hover text-cad-text'
                  }`}
                >
                  <span className="text-xs truncate flex-1">
                    {draft?.name || 'Unknown'}
                    {vp.locked && <span className="ml-1 opacity-60">(locked)</span>}
                  </span>
                  <button
                    onClick={(e) => { e.stopPropagation(); handleDeleteViewport(vp.id); }}
                    className="ml-1 text-xs opacity-60 hover:opacity-100"
                    title="Delete viewport"
                  >
                    x
                  </button>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Selected Viewport Properties */}
      {selectedViewport && (
        <div className="p-3 border-b border-cad-border">
          <div className="flex items-center justify-between mb-2">
            <h4 className="font-medium text-cad-text">Viewport Properties</h4>
            <span className="text-xs px-1.5 py-0.5 bg-cad-primary/20 text-cad-primary border border-cad-primary/30">
              Selected
            </span>
          </div>

          {/* Action Buttons */}
          <div className="flex gap-1 mb-3">
            <button
              onClick={() => centerViewportOnDrawing(selectedViewport.id)}
              disabled={selectedViewport.locked}
              className="flex-1 px-2 py-1.5 text-xs bg-cad-input border border-cad-border text-cad-text hover:bg-cad-hover disabled:opacity-50"
              title="Center view on draft boundary"
            >
              Center
            </button>
            <button
              onClick={() => fitViewportToDrawing(selectedViewport.id)}
              disabled={selectedViewport.locked}
              className="flex-1 px-2 py-1.5 text-xs bg-cad-input border border-cad-border text-cad-text hover:bg-cad-hover disabled:opacity-50"
              title="Fit view to show entire draft"
            >
              Fit to Draft
            </button>
          </div>

          <div className="space-y-2">
            {/* Scale - changes the drawing's scale (affects all viewports of this drawing) */}
            <div>
              <label className="block text-xs text-cad-text-dim mb-1">
                Drawing Scale:
              </label>
              <ScaleSelector
                value={selectedViewport.scale}
                onChange={(scale) => updateDrawingScale(selectedViewport.drawingId, scale)}
                disabled={selectedViewport.locked}
                showCategories={true}
                allowCustom={true}
                className="w-full"
              />
              <div className="text-[10px] text-cad-text-dim mt-1">
                Size: {Math.round(selectedViewport.width)}mm × {Math.round(selectedViewport.height)}mm
                <span className="ml-2 text-yellow-500/80">(all viewports of this drawing)</span>
              </div>
            </div>

            {/* Position */}
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-xs text-cad-text-dim mb-1">X (mm):</label>
                <input
                  type="number"
                  value={Math.round(selectedViewport.x)}
                  onChange={(e) => updateSheetViewport(activeSheetId!, selectedViewport.id, { x: parseFloat(e.target.value) || 0 })}
                  className="w-full px-2 py-1 text-xs bg-cad-input border border-cad-border text-cad-text"
                  disabled={selectedViewport.locked}
                />
              </div>
              <div>
                <label className="block text-xs text-cad-text-dim mb-1">Y (mm):</label>
                <input
                  type="number"
                  value={Math.round(selectedViewport.y)}
                  onChange={(e) => updateSheetViewport(activeSheetId!, selectedViewport.id, { y: parseFloat(e.target.value) || 0 })}
                  className="w-full px-2 py-1 text-xs bg-cad-input border border-cad-border text-cad-text"
                  disabled={selectedViewport.locked}
                />
              </div>
            </div>

            {/* Checkboxes */}
            <div className="flex items-center gap-4 pt-1">
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="vp-locked"
                  checked={selectedViewport.locked}
                  onChange={(e) => updateSheetViewport(activeSheetId!, selectedViewport.id, { locked: e.target.checked })}
                  className="w-3 h-3"
                />
                <label htmlFor="vp-locked" className="text-xs text-cad-text">Locked</label>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="vp-visible"
                  checked={selectedViewport.visible}
                  onChange={(e) => updateSheetViewport(activeSheetId!, selectedViewport.id, { visible: e.target.checked })}
                  className="w-3 h-3"
                />
                <label htmlFor="vp-visible" className="text-xs text-cad-text">Visible</label>
              </div>
            </div>

            {/* Crop Region Section */}
            <CropRegionSection
              viewportId={selectedViewport.id}
              cropRegion={selectedViewport.cropRegion}
              isEditing={cropRegionEditState?.isEditing && cropRegionEditState?.viewportId === selectedViewport.id}
              isLocked={selectedViewport.locked}
              onToggle={() => toggleCropRegion(selectedViewport.id)}
              onStartEdit={() => startCropRegionEdit(selectedViewport.id)}
              onEndEdit={endCropRegionEdit}
              onReset={() => resetCropRegion(selectedViewport.id)}
            />

            {/* Layer Overrides Section */}
            <LayerOverridesSection
              viewportId={selectedViewport.id}
              drawingId={selectedViewport.drawingId}
              layerOverrides={selectedViewport.layerOverrides}
              layers={layers}
              isLocked={selectedViewport.locked}
              onSetOverride={(layerId, visible) => setLayerOverride(selectedViewport.id, layerId, { visible })}
              onClearOverrides={() => clearLayerOverrides(selectedViewport.id)}
            />

            {/* Tip for interaction */}
            {!selectedViewport.locked && (
              <div className="mt-2 p-2 bg-blue-500/10 border border-blue-500/20 text-xs text-blue-400">
                <strong>Tip:</strong> Drag center handle to move viewport. Change scale to resize.
              </div>
            )}
          </div>
        </div>
      )}

      {/* Title Block Section */}
      <div className="p-3 flex-1 overflow-y-auto">
        <div className="flex items-center justify-between mb-2">
          <h4 className="font-medium text-cad-text">Title Block</h4>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setTitleBlockEditorOpen(true)}
              className="p-1 hover:bg-cad-hover rounded transition-colors"
              title="Edit Title Block (Templates, Revisions, Logo)"
            >
              <Settings size={14} className="text-cad-text-dim hover:text-cad-text" />
            </button>
            <input
              type="checkbox"
              checked={activeSheet.titleBlock.visible}
              onChange={(e) => setTitleBlockVisible(activeSheetId!, e.target.checked)}
              className="w-3 h-3"
              title="Show/Hide Title Block"
            />
          </div>
        </div>

        {activeSheet.titleBlock.visible && (
          <div className="space-y-2">
            {/* Quick edit for common fields */}
            {activeSheet.titleBlock.fields
              .filter(f => ['project', 'title', 'number', 'scale', 'date'].includes(f.id))
              .map(field => (
              <div key={field.id}>
                <label className="block text-xs text-cad-text-dim mb-1">{field.label}:</label>
                <input
                  type="text"
                  value={field.value}
                  onChange={(e) => updateTitleBlockField(activeSheetId!, field.id, e.target.value)}
                  className="w-full px-2 py-1 text-xs bg-cad-input border border-cad-border text-cad-text"
                  placeholder={field.label}
                />
              </div>
            ))}

            {/* Button to open full editor */}
            <button
              onClick={() => setTitleBlockEditorOpen(true)}
              className="w-full mt-2 px-2 py-1.5 text-xs bg-cad-input border border-cad-border text-cad-text hover:bg-cad-hover"
            >
              Edit All Fields...
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================================================
// Crop Region Section Component
// ============================================================================

interface CropRegionSectionProps {
  viewportId: string;
  cropRegion?: { enabled: boolean; type: string; points: { x: number; y: number }[] };
  isEditing: boolean;
  isLocked: boolean;
  onToggle: () => void;
  onStartEdit: () => void;
  onEndEdit: () => void;
  onReset: () => void;
}

function CropRegionSection({
  cropRegion,
  isEditing,
  isLocked,
  onToggle,
  onStartEdit,
  onEndEdit,
  onReset,
}: CropRegionSectionProps) {
  const hasCropRegion = !!cropRegion;
  const isEnabled = cropRegion?.enabled ?? false;

  return (
    <div className="pt-3 mt-3 border-t border-cad-border">
      <div className="flex items-center justify-between mb-2">
        <h5 className="text-xs font-medium text-cad-text">Crop Region</h5>
        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            id="crop-enabled"
            checked={isEnabled}
            onChange={onToggle}
            disabled={isLocked}
            className="w-3 h-3"
          />
          <label htmlFor="crop-enabled" className="text-xs text-cad-text-dim">Enabled</label>
        </div>
      </div>

      {hasCropRegion && (
        <div className="flex gap-1">
          {isEditing ? (
            <button
              onClick={onEndEdit}
              className="flex-1 px-2 py-1.5 text-xs bg-cad-primary text-white"
            >
              Done Editing
            </button>
          ) : (
            <button
              onClick={onStartEdit}
              disabled={isLocked}
              className="flex-1 px-2 py-1.5 text-xs bg-cad-input border border-cad-border text-cad-text hover:bg-cad-hover disabled:opacity-50"
            >
              Edit Crop
            </button>
          )}
          <button
            onClick={onReset}
            disabled={isLocked}
            className="px-2 py-1.5 text-xs bg-cad-input border border-cad-border text-cad-text hover:bg-cad-hover disabled:opacity-50"
            title="Reset crop region to draft boundary"
          >
            Reset
          </button>
        </div>
      )}

      {isEditing && (
        <div className="mt-2 p-2 bg-cyan-500/10 border border-cyan-500/20 text-xs text-cyan-400">
          Drag crop region handles on canvas to adjust the visible area.
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Layer Overrides Section Component
// ============================================================================

interface LayerOverridesSectionProps {
  viewportId: string;
  drawingId: string;
  layerOverrides?: { layerId: string; visible?: boolean }[];
  layers: { id: string; name: string; drawingId: string; visible: boolean; color: string }[];
  isLocked: boolean;
  onSetOverride: (layerId: string, visible: boolean) => void;
  onClearOverrides: () => void;
}

function LayerOverridesSection({
  drawingId,
  layerOverrides = [],
  layers,
  isLocked,
  onSetOverride,
  onClearOverrides,
}: LayerOverridesSectionProps) {
  const [expanded, setExpanded] = useState(false);

  // Get layers for this drawing
  const drawingLayers = useMemo(() => {
    return layers.filter(l => l.drawingId === drawingId);
  }, [layers, drawingId]);

  // Get visibility state for a layer (respecting overrides)
  const getLayerVisibility = (layerId: string) => {
    const override = layerOverrides.find(o => o.layerId === layerId);
    if (override && override.visible !== undefined) {
      return override.visible;
    }
    const layer = layers.find(l => l.id === layerId);
    return layer?.visible ?? true;
  };

  // Check if layer has an override
  const hasOverride = (layerId: string) => {
    return layerOverrides.some(o => o.layerId === layerId && o.visible !== undefined);
  };

  const overrideCount = layerOverrides.filter(o => o.visible !== undefined).length;

  return (
    <div className="pt-3 mt-3 border-t border-cad-border">
      <div
        className="flex items-center justify-between mb-2 cursor-pointer"
        onClick={() => setExpanded(!expanded)}
      >
        <h5 className="text-xs font-medium text-cad-text flex items-center gap-1">
          <span className={`transform transition-transform ${expanded ? 'rotate-90' : ''}`}>
            ▶
          </span>
          Layer Overrides
          {overrideCount > 0 && (
            <span className="ml-1 px-1 py-0.5 text-[10px] bg-orange-500/20 text-orange-400 rounded">
              {overrideCount}
            </span>
          )}
        </h5>
        {overrideCount > 0 && (
          <button
            onClick={(e) => { e.stopPropagation(); onClearOverrides(); }}
            disabled={isLocked}
            className="text-xs text-cad-text-dim hover:text-cad-text disabled:opacity-50"
            title="Clear all overrides"
          >
            Reset
          </button>
        )}
      </div>

      {expanded && (
        <div className="space-y-1 max-h-32 overflow-y-auto">
          {drawingLayers.length === 0 ? (
            <div className="text-xs text-cad-text-dim italic">No layers in draft</div>
          ) : (
            drawingLayers.map(layer => {
              const isVisible = getLayerVisibility(layer.id);
              const isOverridden = hasOverride(layer.id);

              return (
                <div
                  key={layer.id}
                  className={`flex items-center gap-2 px-2 py-1 ${
                    isOverridden ? 'bg-orange-500/10' : 'bg-cad-input'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={isVisible}
                    onChange={(e) => onSetOverride(layer.id, e.target.checked)}
                    disabled={isLocked}
                    className="w-3 h-3"
                  />
                  <span
                    className="w-3 h-3 rounded-sm"
                    style={{ backgroundColor: layer.color }}
                  />
                  <span className={`text-xs flex-1 truncate ${
                    isOverridden ? 'text-orange-400' : 'text-cad-text'
                  }`}>
                    {layer.name}
                    {isOverridden && ' *'}
                  </span>
                </div>
              );
            })
          )}
        </div>
      )}

      {!expanded && overrideCount > 0 && (
        <div className="text-xs text-orange-400">
          {overrideCount} layer{overrideCount > 1 ? 's' : ''} overridden
        </div>
      )}
    </div>
  );
}
