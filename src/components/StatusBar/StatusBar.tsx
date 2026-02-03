import { memo, useState, useRef, useEffect } from 'react';
import { Terminal, ChevronDown, Layers, Plus, Eye, EyeOff, Lock, Unlock, Trash2 } from 'lucide-react';
import { useAppStore } from '../../state/appStore';

/**
 * Compact layer selector dropdown for status bar with full management controls
 */
function LayerSelector() {
  const [isOpen, setIsOpen] = useState(false);
  const [editingLayerId, setEditingLayerId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const dropdownRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const layers = useAppStore(s => s.layers);
  const activeLayerId = useAppStore(s => s.activeLayerId);
  const activeDrawingId = useAppStore(s => s.activeDrawingId);
  const setActiveLayer = useAppStore(s => s.setActiveLayer);
  const addLayer = useAppStore(s => s.addLayer);
  const updateLayer = useAppStore(s => s.updateLayer);
  const deleteLayer = useAppStore(s => s.deleteLayer);

  // Filter layers for current drawing
  const drawingLayers = layers.filter(l => l.drawingId === activeDrawingId);
  const activeLayer = drawingLayers.find(l => l.id === activeLayerId) || drawingLayers[0];

  // Close dropdown when clicking outside
  useEffect(() => {
    if (!isOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false);
        setEditingLayerId(null);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  // Focus input when editing
  useEffect(() => {
    if (editingLayerId && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editingLayerId]);

  const handleSelectLayer = (layerId: string) => {
    setActiveLayer(layerId);
  };

  const handleAddLayer = (e: React.MouseEvent) => {
    e.stopPropagation();
    addLayer();
  };

  const handleToggleVisibility = (e: React.MouseEvent, layerId: string, visible: boolean) => {
    e.stopPropagation();
    updateLayer(layerId, { visible: !visible });
  };

  const handleToggleLock = (e: React.MouseEvent, layerId: string, locked: boolean) => {
    e.stopPropagation();
    updateLayer(layerId, { locked: !locked });
  };

  const handleDelete = (e: React.MouseEvent, layerId: string) => {
    e.stopPropagation();
    deleteLayer(layerId);
  };

  const handleStartRename = (e: React.MouseEvent, layerId: string, name: string) => {
    e.stopPropagation();
    setEditingLayerId(layerId);
    setEditingName(name);
  };

  const handleFinishRename = () => {
    if (editingLayerId && editingName.trim()) {
      updateLayer(editingLayerId, { name: editingName.trim() });
    }
    setEditingLayerId(null);
  };

  const handleColorChange = (e: React.ChangeEvent<HTMLInputElement>, layerId: string) => {
    e.stopPropagation();
    updateLayer(layerId, { color: e.target.value });
  };

  if (!activeLayer) return null;

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-1.5 px-2 py-0.5 rounded hover:bg-cad-hover transition-colors"
        title="Layer Manager"
      >
        <Layers size={12} className="text-cad-text-dim" />
        <div
          className="w-3 h-3 rounded-sm border border-cad-border"
          style={{ backgroundColor: activeLayer.color }}
        />
        <span className="text-cad-text font-medium max-w-[80px] truncate">
          {activeLayer.name}
        </span>
        <ChevronDown size={10} className={`text-cad-text-dim transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {isOpen && (
        <div className="absolute bottom-full left-0 mb-1 bg-cad-surface border border-cad-border rounded shadow-lg min-w-[220px] z-50">
          {/* Header with Add button */}
          <div className="flex items-center justify-between px-3 py-1.5 border-b border-cad-border">
            <span className="text-xs font-medium text-cad-text">Layers</span>
            <button
              onClick={handleAddLayer}
              className="p-0.5 rounded hover:bg-cad-hover text-cad-text-dim hover:text-cad-text transition-colors"
              title="Add Layer"
            >
              <Plus size={14} />
            </button>
          </div>

          {/* Layer list */}
          <div className="max-h-[200px] overflow-y-auto">
            {drawingLayers.map(layer => (
              <div
                key={layer.id}
                onClick={() => handleSelectLayer(layer.id)}
                className={`flex items-center gap-1.5 px-2 py-1 cursor-pointer transition-colors ${
                  layer.id === activeLayerId ? 'bg-cad-accent/20' : 'hover:bg-cad-hover'
                }`}
              >
                {/* Color picker */}
                <input
                  type="color"
                  value={layer.color}
                  onChange={(e) => handleColorChange(e, layer.id)}
                  onClick={(e) => e.stopPropagation()}
                  className="w-4 h-4 rounded-sm border border-cad-border cursor-pointer p-0"
                  style={{ backgroundColor: layer.color }}
                  title="Layer Color"
                />

                {/* Layer name (editable on double-click) */}
                {editingLayerId === layer.id ? (
                  <input
                    ref={inputRef}
                    type="text"
                    value={editingName}
                    onChange={(e) => setEditingName(e.target.value)}
                    onBlur={handleFinishRename}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleFinishRename();
                      if (e.key === 'Escape') setEditingLayerId(null);
                    }}
                    onClick={(e) => e.stopPropagation()}
                    className="flex-1 text-xs bg-cad-bg border border-cad-accent rounded px-1 py-0.5 text-cad-text outline-none min-w-0"
                  />
                ) : (
                  <span
                    className="flex-1 text-xs text-cad-text truncate min-w-0"
                    onDoubleClick={(e) => handleStartRename(e, layer.id, layer.name)}
                    title="Double-click to rename"
                  >
                    {layer.name}
                  </span>
                )}

                {/* Visibility toggle */}
                <button
                  onClick={(e) => handleToggleVisibility(e, layer.id, layer.visible)}
                  className={`p-0.5 rounded transition-colors ${
                    layer.visible ? 'text-cad-text hover:text-cad-accent' : 'text-cad-text-dim hover:text-cad-text'
                  }`}
                  title={layer.visible ? 'Hide Layer' : 'Show Layer'}
                >
                  {layer.visible ? <Eye size={12} /> : <EyeOff size={12} />}
                </button>

                {/* Lock toggle */}
                <button
                  onClick={(e) => handleToggleLock(e, layer.id, layer.locked)}
                  className={`p-0.5 rounded transition-colors ${
                    layer.locked ? 'text-cad-accent' : 'text-cad-text-dim hover:text-cad-text'
                  }`}
                  title={layer.locked ? 'Unlock Layer' : 'Lock Layer'}
                >
                  {layer.locked ? <Lock size={12} /> : <Unlock size={12} />}
                </button>

                {/* Delete button */}
                {drawingLayers.length > 1 && (
                  <button
                    onClick={(e) => handleDelete(e, layer.id)}
                    className="p-0.5 rounded text-cad-text-dim hover:text-red-400 transition-colors"
                    title="Delete Layer"
                  >
                    <Trash2 size={12} />
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Status message based on active tool and drawing state
 */
function StatusMessage() {
  const activeTool = useAppStore(s => s.activeTool);
  const drawingPoints = useAppStore(s => s.drawingPoints);
  const circleMode = useAppStore(s => s.circleMode);
  const rectangleMode = useAppStore(s => s.rectangleMode);
  const arcMode = useAppStore(s => s.arcMode);
  const ellipseMode = useAppStore(s => s.ellipseMode);
  const dimensionMode = useAppStore(s => s.dimensionMode);
  const polylineArcMode = useAppStore(s => s.polylineArcMode);
  const pickLinesMode = useAppStore(s => s.pickLinesMode);
  const selectedCount = useAppStore(s => s.selectedShapeIds.length);
  const scaleMode = useAppStore(s => s.scaleMode);
  const arrayMode = useAppStore(s => s.arrayMode);

  const pts = drawingPoints.length;

  let msg = '';

  if (pickLinesMode && (activeTool === 'line' || activeTool === 'circle' || activeTool === 'arc')) {
    msg = 'Click on a shape to create offset copy';
  } else {
    switch (activeTool) {
      case 'line':
        msg = pts === 0 ? 'Select first point' : 'Select next point';
        break;
      case 'rectangle':
        if (rectangleMode === '3point') {
          msg = pts === 0 ? 'Select first corner' : pts === 1 ? 'Select width direction' : 'Select height';
        } else {
          msg = pts === 0 ? (rectangleMode === 'center' ? 'Select center' : 'Select first corner') : 'Select opposite corner';
        }
        break;
      case 'circle':
        if (circleMode === '3point') {
          msg = pts < 2 ? `Select point ${pts + 1} on circle` : 'Select third point';
        } else if (circleMode === '2point') {
          msg = pts === 0 ? 'Select first diameter point' : 'Select second diameter point';
        } else {
          msg = pts === 0 ? 'Select center' : 'Select radius point';
        }
        break;
      case 'arc':
        if (arcMode === '3point') msg = pts < 2 ? `Select point ${pts + 1}` : 'Select end point';
        else if (arcMode === 'center-start-end') msg = pts === 0 ? 'Select center' : pts === 1 ? 'Select start' : 'Select end';
        else if (arcMode === 'start-end-radius') msg = pts === 0 ? 'Select start' : pts === 1 ? 'Select end' : 'Drag to set curvature';
        else if (arcMode === 'fillet') msg = pts === 0 ? 'Click first line' : 'Click second line';
        else if (arcMode === 'tangent') msg = pts === 0 ? 'Click endpoint' : 'Click end point';
        break;
      case 'polyline':
        msg = pts === 0 ? 'Select first point' : `Next point (A=Arc, L=Line, C=Close)${polylineArcMode ? ' [Arc]' : ''}`;
        break;
      case 'spline':
        msg = pts === 0 ? 'Select first point' : 'Next point (C=Close)';
        break;
      case 'ellipse':
        if (ellipseMode === 'partial') {
          const labels = ['Select center', 'Major axis point', 'Minor axis point', 'Start angle', 'End angle'];
          msg = labels[Math.min(pts, 4)];
        } else {
          msg = pts === 0 ? 'Select center' : pts === 1 ? 'Major axis point' : 'Minor axis point';
        }
        break;
      case 'hatch':
        msg = pts === 0 ? 'Click first boundary point' : pts === 1 ? 'Click next point' : 'Next point (C=Close, right-click to finish)';
        break;
      case 'text':
        msg = 'Click to place text';
        break;
      case 'dimension':
        switch (dimensionMode) {
          case 'aligned': case 'linear':
            msg = pts === 0 ? 'Select first point' : pts === 1 ? 'Select second point' : 'Position dimension line';
            break;
          case 'angular':
            msg = pts === 0 ? 'Click first line' : pts === 1 ? 'Click second line' : 'Position dimension arc';
            break;
          case 'radius': msg = pts === 0 ? 'Click circle or arc' : 'Position radius line'; break;
          case 'diameter': msg = pts === 0 ? 'Click circle or arc' : 'Position diameter line'; break;
          case 'arc-length': msg = pts === 0 ? 'Click an arc' : 'Position dimension'; break;
        }
        break;
      case 'move':
        if (selectedCount === 0) msg = 'Select elements to move';
        else if (pts === 0) msg = 'Click base point';
        else msg = 'Click destination point';
        break;
      case 'copy':
        if (selectedCount === 0) msg = 'Select elements to copy';
        else if (pts === 0) msg = 'Click base point';
        else msg = 'Click destination (right-click to finish)';
        break;
      case 'rotate':
        if (selectedCount === 0) msg = 'Select elements to rotate';
        else if (pts === 0) msg = 'Click center of rotation';
        else if (pts === 1) msg = 'Click start ray';
        else msg = 'Click end ray or type angle';
        break;
      case 'scale':
        if (selectedCount === 0) msg = 'Select elements to scale';
        else if (pts === 0) msg = 'Click scale origin';
        else if (scaleMode === 'graphical' && pts === 1) msg = 'Click reference point';
        else if (scaleMode === 'graphical') msg = 'Click new scale point';
        break;
      case 'mirror':
        if (selectedCount === 0) msg = 'Select elements to mirror';
        else if (pts === 0) msg = 'Click first axis point';
        else msg = 'Click second axis point';
        break;
      case 'array':
        if (selectedCount === 0) msg = 'Select elements to array';
        else if (arrayMode === 'linear') msg = pts === 0 ? 'Click to set array direction' : 'Click to confirm direction';
        else msg = 'Click center of radial array';
        break;
      case 'trim':
        msg = pts === 0 ? 'Click cutting edge' : 'Click element to trim';
        break;
      case 'extend':
        msg = pts === 0 ? 'Click boundary edge' : 'Click element to extend';
        break;
      case 'fillet':
        msg = pts === 0 ? 'Click first element' : 'Click second element';
        break;
      case 'chamfer':
        msg = pts === 0 ? 'Click first element' : 'Click second element';
        break;
      case 'offset':
        msg = 'Hover element and click to offset';
        break;
    }
  }

  if (!msg) return null;

  return (
    <span className="text-yellow-400 ml-2">{msg}</span>
  );
}

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
  const terminalOpen = useAppStore(s => s.terminalOpen);
  const toggleTerminal = useAppStore(s => s.toggleTerminal);

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

      {/* Layer selector */}
      <LayerSelector />

      {/* Snap and Tracking toggles */}
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
      </div>

      {/* Active tool + status message */}
      <div className="flex items-center gap-2">
        <span>Tool:</span>
        <span className="text-cad-accent font-mono uppercase">{activeTool}</span>
        <StatusMessage />
      </div>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Terminal toggle */}
      <button
        onClick={toggleTerminal}
        className={`p-1 rounded transition-colors cursor-default ${
          terminalOpen
            ? 'bg-cad-accent text-white'
            : 'text-cad-text-dim hover:bg-cad-hover hover:text-cad-text'
        }`}
        title="Toggle Terminal [Ctrl+`]"
      >
        <Terminal size={14} />
      </button>

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
