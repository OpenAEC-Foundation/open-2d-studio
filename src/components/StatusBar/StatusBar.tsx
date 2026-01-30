import { memo } from 'react';
import { useAppStore } from '../../state/appStore';

export const StatusBar = memo(function StatusBar() {
  const mousePosition = useAppStore(s => s.mousePosition);
  const viewport = useAppStore(s => s.viewport);
  const activeTool = useAppStore(s => s.activeTool);
  const gridSize = useAppStore(s => s.gridSize);
  const snapEnabled = useAppStore(s => s.snapEnabled);
  const selectedCount = useAppStore(s => s.selectedShapeIds.length);
  const shapeCount = useAppStore(s => s.shapes.length);
  const trackingEnabled = useAppStore(s => s.trackingEnabled);
  const polarTrackingEnabled = useAppStore(s => s.polarTrackingEnabled);
  const orthoMode = useAppStore(s => s.orthoMode);
  const objectTrackingEnabled = useAppStore(s => s.objectTrackingEnabled);
  const polarAngleIncrement = useAppStore(s => s.polarAngleIncrement);
  const togglePolarTracking = useAppStore(s => s.togglePolarTracking);
  const toggleOrthoMode = useAppStore(s => s.toggleOrthoMode);
  const toggleObjectTracking = useAppStore(s => s.toggleObjectTracking);
  const toggleSnap = useAppStore(s => s.toggleSnap);
  const boundaryVisible = useAppStore(s => s.boundaryVisible);
  const toggleBoundaryVisible = useAppStore(s => s.toggleBoundaryVisible);

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
          className={`px-2 py-0.5 text-xs font-medium rounded transition-colors cursor-default ${
            snapEnabled
              ? 'bg-cyan-600 text-white hover:bg-cyan-500'
              : 'bg-cad-bg text-cad-text-dim hover:bg-cad-hover'
          }`}
          title="Object Snap [F3]"
        >
          OSNAP
        </button>
        <button
          onClick={togglePolarTracking}
          className={`px-2 py-0.5 text-xs font-medium rounded transition-colors cursor-default ${
            polarTrackingEnabled && trackingEnabled
              ? 'bg-blue-600 text-white hover:bg-blue-500'
              : 'bg-cad-bg text-cad-text-dim hover:bg-cad-hover'
          }`}
          title={`Polar Tracking - ${polarAngleIncrement}° increments [F10]`}
        >
          POLAR
        </button>
        <button
          onClick={toggleOrthoMode}
          className={`px-2 py-0.5 text-xs font-medium rounded transition-colors cursor-default ${
            orthoMode && trackingEnabled
              ? 'bg-green-600 text-white hover:bg-green-500'
              : 'bg-cad-bg text-cad-text-dim hover:bg-cad-hover'
          }`}
          title="Ortho Mode - 90° only [F8]"
        >
          ORTHO
        </button>
        <button
          onClick={toggleObjectTracking}
          className={`px-2 py-0.5 text-xs font-medium rounded transition-colors cursor-default ${
            objectTrackingEnabled && trackingEnabled
              ? 'bg-orange-600 text-white hover:bg-orange-500'
              : 'bg-cad-bg text-cad-text-dim hover:bg-cad-hover'
          }`}
          title="Object Snap Tracking - align to geometry [F11]"
        >
          OTRACK
        </button>
        <button
          onClick={toggleBoundaryVisible}
          className={`px-2 py-0.5 text-xs font-medium rounded transition-colors cursor-default ${
            boundaryVisible
              ? 'bg-purple-600 text-white hover:bg-purple-500'
              : 'bg-cad-bg text-cad-text-dim hover:bg-cad-hover'
          }`}
          title="Show/Hide Drawing Boundary (Region)"
        >
          REGION
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
        <span className="text-cad-text font-mono">{selectedCount}</span>
      </div>

      {/* Total objects */}
      <div className="flex items-center gap-2">
        <span>Objects:</span>
        <span className="text-cad-text font-mono">{shapeCount}</span>
      </div>
    </div>
  );
});
