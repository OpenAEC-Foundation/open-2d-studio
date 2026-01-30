import { useCallback } from 'react';
import { useAppStore } from '../../state/appStore';

export function DrawingPropertiesPanel({ showHeader = true }: { showHeader?: boolean }) {
  const {
    drawings,
    activeDrawingId,
    updateDrawingBoundary,
    renameDrawing,
    boundaryEditState,
    selectBoundary,
    deselectBoundary,
    fitBoundaryToContent,
  } = useAppStore();

  const activeDrawing = drawings.find(d => d.id === activeDrawingId);

  const handleBoundaryChange = useCallback((
    field: 'x' | 'y' | 'width' | 'height',
    value: string
  ) => {
    if (!activeDrawingId) return;
    const numValue = parseFloat(value);
    if (isNaN(numValue)) return;

    // Ensure width and height are positive
    if ((field === 'width' || field === 'height') && numValue <= 0) return;

    updateDrawingBoundary(activeDrawingId, { [field]: numValue });
  }, [activeDrawingId, updateDrawingBoundary]);

  const handleNameChange = useCallback((value: string) => {
    if (!activeDrawingId || !value.trim()) return;
    renameDrawing(activeDrawingId, value.trim());
  }, [activeDrawingId, renameDrawing]);

  if (!activeDrawing) {
    return (
      <div className="p-3 text-cad-text-dim text-sm">
        No drawing selected
      </div>
    );
  }

  return (
    <div className="flex flex-col text-sm">
      {showHeader && (
        <div className="p-3 border-b border-cad-border">
          <h3 className="font-medium text-cad-text">Drawing Properties</h3>
        </div>
      )}

      {/* Drawing Info */}
      <div className="p-3 border-b border-cad-border">
        <div className="space-y-2">
          <div>
            <label className="block text-xs text-cad-text-dim mb-1">Name:</label>
            <input
              type="text"
              value={activeDrawing.name}
              onChange={(e) => handleNameChange(e.target.value)}
              className="w-full px-2 py-1 text-xs bg-cad-input border border-cad-border text-cad-text"
            />
          </div>
        </div>
      </div>

      {/* Boundary Section */}
      <div className="p-3 border-b border-cad-border">
        <div className="flex items-center justify-between mb-2">
          <h4 className="font-medium text-cad-text">Boundary (Region)</h4>
          {boundaryEditState.isSelected && (
            <span className="text-xs px-1.5 py-0.5 bg-orange-500/20 text-orange-400 border border-orange-500/30">
              Selected
            </span>
          )}
        </div>
        <p className="text-xs text-cad-text-dim mb-3">
          Defines the visible area when placed on sheets. Click on the boundary edge to select it.
        </p>

        {/* Boundary Action Buttons */}
        <div className="flex gap-2 mb-3">
          <button
            onClick={() => boundaryEditState.isSelected ? deselectBoundary() : selectBoundary()}
            className={`flex-1 px-2 py-1.5 text-xs border ${
              boundaryEditState.isSelected
                ? 'bg-orange-500/20 border-orange-500/50 text-orange-400 hover:bg-orange-500/30'
                : 'bg-cad-input border-cad-border text-cad-text hover:bg-cad-hover'
            }`}
          >
            {boundaryEditState.isSelected ? 'Deselect' : 'Select Boundary'}
          </button>
          <button
            onClick={() => activeDrawingId && fitBoundaryToContent(activeDrawingId)}
            className="flex-1 px-2 py-1.5 text-xs bg-cad-input border border-cad-border text-cad-text hover:bg-cad-hover"
            title="Adjust boundary to fit all shapes with padding"
          >
            Fit to Content
          </button>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="block text-xs text-cad-text-dim mb-1">X:</label>
            <input
              type="number"
              value={activeDrawing.boundary.x}
              onChange={(e) => handleBoundaryChange('x', e.target.value)}
              className="w-full px-2 py-1 text-xs bg-cad-input border border-cad-border text-cad-text"
            />
          </div>
          <div>
            <label className="block text-xs text-cad-text-dim mb-1">Y:</label>
            <input
              type="number"
              value={activeDrawing.boundary.y}
              onChange={(e) => handleBoundaryChange('y', e.target.value)}
              className="w-full px-2 py-1 text-xs bg-cad-input border border-cad-border text-cad-text"
            />
          </div>
          <div>
            <label className="block text-xs text-cad-text-dim mb-1">Width:</label>
            <input
              type="number"
              min="1"
              value={activeDrawing.boundary.width}
              onChange={(e) => handleBoundaryChange('width', e.target.value)}
              className="w-full px-2 py-1 text-xs bg-cad-input border border-cad-border text-cad-text"
            />
          </div>
          <div>
            <label className="block text-xs text-cad-text-dim mb-1">Height:</label>
            <input
              type="number"
              min="1"
              value={activeDrawing.boundary.height}
              onChange={(e) => handleBoundaryChange('height', e.target.value)}
              className="w-full px-2 py-1 text-xs bg-cad-input border border-cad-border text-cad-text"
            />
          </div>
        </div>

        {/* Selection Tip */}
        {boundaryEditState.isSelected && (
          <div className="mt-3 p-2 bg-blue-500/10 border border-blue-500/20 text-xs text-blue-400">
            <strong>Tip:</strong> Drag the corner or edge handles to resize. Drag the center handle to move the boundary.
          </div>
        )}
      </div>

      {/* Info Section */}
      <div className="p-3">
        <h4 className="font-medium text-cad-text mb-2">Information</h4>
        <div className="space-y-1 text-xs text-cad-text-dim">
          <div>Created: {new Date(activeDrawing.createdAt).toLocaleDateString()}</div>
          <div>Modified: {new Date(activeDrawing.modifiedAt).toLocaleDateString()}</div>
        </div>
      </div>
    </div>
  );
}

// Legacy alias
export { DrawingPropertiesPanel as DraftPropertiesPanel };
