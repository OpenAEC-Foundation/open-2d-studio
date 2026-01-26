import { useAppStore } from '../../state/appStore';

export function StatusBar() {
  const {
    mousePosition,
    viewport,
    activeTool,
    gridSize,
    snapEnabled,
    selectedShapeIds,
    shapes,
    // Tracking state
    trackingEnabled,
    polarTrackingEnabled,
    orthoMode,
    objectTrackingEnabled,
    polarAngleIncrement,
    // Tracking actions
    togglePolarTracking,
    toggleOrthoMode,
    toggleObjectTracking,
    toggleSnap,
  } = useAppStore();

  // Convert screen position to world position
  const worldX = (mousePosition.x - viewport.offsetX) / viewport.zoom;
  const worldY = (mousePosition.y - viewport.offsetY) / viewport.zoom;

  return (
    <div className="h-6 bg-cad-surface border-t border-cad-border flex items-center px-3 text-xs text-cad-text-dim gap-6">
      {/* Coordinates */}
      <div className="flex items-center gap-2">
        <span>X:</span>
        <span className="text-cad-text font-mono w-20">{worldX.toFixed(2)}</span>
        <span>Y:</span>
        <span className="text-cad-text font-mono w-20">{worldY.toFixed(2)}</span>
      </div>

      {/* Zoom level */}
      <div className="flex items-center gap-2">
        <span>Zoom:</span>
        <span className="text-cad-text font-mono">{(viewport.zoom * 100).toFixed(0)}%</span>
      </div>

      {/* Grid size */}
      <div className="flex items-center gap-2">
        <span>Grid:</span>
        <span className="text-cad-text font-mono">{gridSize}</span>
      </div>

      {/* Snap and Tracking toggles - AutoCAD style */}
      <div className="flex items-center gap-1">
        <button
          onClick={toggleSnap}
          className={`px-2 py-0.5 text-xs font-medium rounded transition-colors ${
            snapEnabled
              ? 'bg-cyan-600 text-white'
              : 'bg-cad-bg text-cad-text-dim hover:bg-cad-hover'
          }`}
          title="Object Snap [F3]"
        >
          OSNAP
        </button>
        <button
          onClick={togglePolarTracking}
          className={`px-2 py-0.5 text-xs font-medium rounded transition-colors ${
            polarTrackingEnabled && trackingEnabled
              ? 'bg-blue-600 text-white'
              : 'bg-cad-bg text-cad-text-dim hover:bg-cad-hover'
          }`}
          title={`Polar Tracking - ${polarAngleIncrement}° increments [F10]`}
        >
          POLAR
        </button>
        <button
          onClick={toggleOrthoMode}
          className={`px-2 py-0.5 text-xs font-medium rounded transition-colors ${
            orthoMode && trackingEnabled
              ? 'bg-green-600 text-white'
              : 'bg-cad-bg text-cad-text-dim hover:bg-cad-hover'
          }`}
          title="Ortho Mode - 90° only [F8]"
        >
          ORTHO
        </button>
        <button
          onClick={toggleObjectTracking}
          className={`px-2 py-0.5 text-xs font-medium rounded transition-colors ${
            objectTrackingEnabled && trackingEnabled
              ? 'bg-orange-600 text-white'
              : 'bg-cad-bg text-cad-text-dim hover:bg-cad-hover'
          }`}
          title="Object Snap Tracking - align to geometry [F11]"
        >
          OTRACK
        </button>
      </div>

      {/* Active tool */}
      <div className="flex items-center gap-2">
        <span>Tool:</span>
        <span className="text-cad-accent font-mono uppercase">{activeTool}</span>
      </div>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Selection count */}
      <div className="flex items-center gap-2">
        <span>Selected:</span>
        <span className="text-cad-text font-mono">{selectedShapeIds.length}</span>
      </div>

      {/* Total objects */}
      <div className="flex items-center gap-2">
        <span>Objects:</span>
        <span className="text-cad-text font-mono">{shapes.length}</span>
      </div>
    </div>
  );
}
