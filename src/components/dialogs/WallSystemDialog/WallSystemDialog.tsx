/**
 * WallSystemDialog - Full editor for multi-layered wall system types
 *
 * Supports editing:
 * - Layer stack (add/remove/reorder layers, thickness, material, function)
 * - Stud profiles (default + alternates)
 * - Panel types (default + alternates)
 * - Grid configuration (stud spacing)
 * - Live cross-section preview
 */

import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { X, Plus, Trash2, ChevronDown, ChevronUp, Copy, Download, Upload } from 'lucide-react';
import { useAppStore } from '../../../state/appStore';
import type {
  WallSystemType,
  WallSystemLayer,
  WallSystemStud,
  WallSystemPanel,
  WallLayerFunction,
  WallSystemCategory,
  WallStudProfile,
} from '../../../types/geometry';
// Wall system service used for cross-section preview
// import { calculateTotalThickness, calculateLayerOffsets } from '../../../services/wallSystem/wallSystemService';

// ============================================================================
// Props
// ============================================================================

interface WallSystemDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

// ============================================================================
// Constants
// ============================================================================

const LAYER_FUNCTIONS: { value: WallLayerFunction; label: string }[] = [
  { value: 'structure', label: 'Structure' },
  { value: 'insulation', label: 'Insulation' },
  { value: 'finish', label: 'Finish' },
  { value: 'membrane', label: 'Membrane' },
  { value: 'air-gap', label: 'Air Gap' },
  { value: 'substrate', label: 'Substrate' },
];

const CATEGORIES: { value: WallSystemCategory; label: string }[] = [
  { value: 'timber-frame', label: 'Timber Frame (HSB)' },
  { value: 'metal-stud', label: 'Metal Stud' },
  { value: 'curtain-wall', label: 'Curtain Wall' },
  { value: 'masonry', label: 'Masonry' },
  { value: 'custom', label: 'Custom' },
];

const STUD_PROFILES: { value: WallStudProfile; label: string }[] = [
  { value: 'rectangular', label: 'Rectangular' },
  { value: 'c-channel', label: 'C-Channel' },
  { value: 'i-beam', label: 'I-Beam' },
  { value: 'custom', label: 'Custom' },
];

let _nextId = Date.now();
function genId(prefix: string): string {
  return `${prefix}-${++_nextId}`;
}

// ============================================================================
// Component
// ============================================================================

export function WallSystemDialog({ isOpen, onClose }: WallSystemDialogProps) {
  const {
    wallSystemTypes,
    addWallSystemType,
    updateWallSystemType,
    deleteWallSystemType,
  } = useAppStore();

  const [selectedId, setSelectedId] = useState<string | null>(
    wallSystemTypes.length > 0 ? wallSystemTypes[0].id : null
  );
  const [activeTab, setActiveTab] = useState<'layers' | 'studs' | 'panels' | 'grid'>('layers');

  // Dragging
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const dragStartRef = useRef({ x: 0, y: 0 });

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('button, input, select, label, canvas')) return;
    setIsDragging(true);
    dragStartRef.current = { x: e.clientX - position.x, y: e.clientY - position.y };
  }, [position]);

  useEffect(() => {
    if (!isDragging) return;
    const handleMove = (e: MouseEvent) => {
      setPosition({ x: e.clientX - dragStartRef.current.x, y: e.clientY - dragStartRef.current.y });
    };
    const handleUp = () => setIsDragging(false);
    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
    return () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
    };
  }, [isDragging]);

  const selectedSystem = useMemo(
    () => wallSystemTypes.find(ws => ws.id === selectedId) || null,
    [wallSystemTypes, selectedId]
  );

  const updateSelected = useCallback(
    (updates: Partial<WallSystemType>) => {
      if (!selectedId) return;
      // Recalculate total thickness if layers changed
      if (updates.layers) {
        updates.totalThickness = updates.layers.reduce((sum, l) => sum + l.thickness, 0);
      }
      updateWallSystemType(selectedId, updates);
    },
    [selectedId, updateWallSystemType]
  );

  // ---- Handlers ----

  const handleAddType = () => {
    const id = genId('ws');
    const newType: WallSystemType = {
      id,
      name: 'New Wall System',
      category: 'custom',
      totalThickness: 0,
      layers: [],
      defaultStud: {
        id: genId('stud'),
        name: 'Default stud',
        width: 38,
        depth: 140,
        material: 'timber',
        profile: 'rectangular',
        color: '#c4a66a',
        layerIds: [],
      },
      alternateStuds: [],
      defaultPanel: {
        id: genId('panel'),
        name: 'Default panel',
        material: 'insulation',
        thickness: 0,
        color: '#ffe066',
        opacity: 1,
      },
      alternatePanels: [],
      grid: {
        verticalSpacing: 600,
        verticalJustification: 'center',
        horizontalSpacing: 0,
        horizontalJustification: 'center',
        customVerticalLines: [],
        customHorizontalLines: [],
      },
      studOverrides: {},
      panelOverrides: {},
    };
    addWallSystemType(newType);
    setSelectedId(id);
  };

  const handleDeleteType = () => {
    if (!selectedId) return;
    deleteWallSystemType(selectedId);
    setSelectedId(wallSystemTypes.length > 1 ? wallSystemTypes[0].id : null);
  };

  const handleDuplicateType = () => {
    if (!selectedSystem) return;
    const id = genId('ws');
    const cloned: WallSystemType = {
      ...structuredClone(selectedSystem),
      id,
      name: `${selectedSystem.name} (copy)`,
    };
    addWallSystemType(cloned);
    setSelectedId(id);
  };

  const handleAddLayer = () => {
    if (!selectedSystem) return;
    const newLayer: WallSystemLayer = {
      id: genId('layer'),
      name: 'New Layer',
      material: 'generic',
      thickness: 50,
      offset: 0,
      function: 'finish',
      color: '#cccccc',
    };
    updateSelected({ layers: [...selectedSystem.layers, newLayer] });
  };

  const handleRemoveLayer = (layerId: string) => {
    if (!selectedSystem) return;
    updateSelected({ layers: selectedSystem.layers.filter(l => l.id !== layerId) });
  };

  const handleUpdateLayer = (layerId: string, updates: Partial<WallSystemLayer>) => {
    if (!selectedSystem) return;
    updateSelected({
      layers: selectedSystem.layers.map(l => l.id === layerId ? { ...l, ...updates } : l),
    });
  };

  const handleMoveLayer = (index: number, direction: 'up' | 'down') => {
    if (!selectedSystem) return;
    const layers = [...selectedSystem.layers];
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= layers.length) return;
    [layers[index], layers[targetIndex]] = [layers[targetIndex], layers[index]];
    updateSelected({ layers });
  };

  const handleExport = () => {
    if (!selectedSystem) return;
    const blob = new Blob([JSON.stringify(selectedSystem, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `wall-system-${selectedSystem.name.replace(/\s+/g, '-').toLowerCase()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImport = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      try {
        const text = await file.text();
        const imported = JSON.parse(text) as WallSystemType;
        imported.id = genId('ws');
        addWallSystemType(imported);
        setSelectedId(imported.id);
      } catch (err) {
        console.error('Failed to import wall system:', err);
      }
    };
    input.click();
  };

  if (!isOpen) return null;

  const inputClass = 'w-full bg-cad-bg border border-cad-border rounded px-2 py-1 text-xs text-cad-text focus:outline-none focus:border-cad-accent';
  const labelClass = 'block text-[10px] font-medium text-cad-text-dim mb-0.5';
  const btnClass = 'px-2 py-1 text-xs rounded border border-cad-border hover:bg-cad-hover transition-colors';

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
    <div
      className="bg-cad-panel border border-cad-border rounded-lg shadow-xl flex flex-col"
      style={{
        left: position.x !== 0 || position.y !== 0 ? `calc(50% + ${position.x}px)` : undefined,
        top: position.x !== 0 || position.y !== 0 ? `calc(50% + ${position.y}px)` : undefined,
        transform: position.x !== 0 || position.y !== 0 ? 'translate(-50%, -50%)' : undefined,
        position: position.x !== 0 || position.y !== 0 ? 'fixed' : undefined,
        width: 800,
        maxHeight: '85vh',
      }}
      onMouseDown={handleMouseDown}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-cad-border cursor-move select-none">
        <h2 className="text-sm font-semibold text-cad-text">Wall System Editor</h2>
        <button onClick={onClose} className="p-1 hover:bg-cad-hover rounded">
          <X size={14} className="text-cad-text-dim" />
        </button>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Left panel: type list */}
        <div className="w-52 border-r border-cad-border flex flex-col">
          <div className="p-2 border-b border-cad-border flex gap-1">
            <button onClick={handleAddType} className={btnClass} title="Add new type">
              <Plus size={12} />
            </button>
            <button onClick={handleDuplicateType} className={btnClass} title="Duplicate" disabled={!selectedSystem}>
              <Copy size={12} />
            </button>
            <button onClick={handleDeleteType} className={btnClass} title="Delete" disabled={!selectedSystem}>
              <Trash2 size={12} />
            </button>
            <button onClick={handleImport} className={btnClass} title="Import">
              <Upload size={12} />
            </button>
            <button onClick={handleExport} className={btnClass} title="Export" disabled={!selectedSystem}>
              <Download size={12} />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto p-1">
            {wallSystemTypes.map(ws => (
              <button
                key={ws.id}
                onClick={() => setSelectedId(ws.id)}
                className={`w-full text-left px-2 py-1.5 rounded text-xs mb-0.5 transition-colors ${
                  selectedId === ws.id
                    ? 'bg-cad-accent/20 text-cad-accent border border-cad-accent/40'
                    : 'text-cad-text hover:bg-cad-hover border border-transparent'
                }`}
              >
                <div className="font-medium">{ws.name}</div>
                <div className="text-[10px] text-cad-text-dim">{ws.category} &middot; {ws.totalThickness.toFixed(1)}mm</div>
              </button>
            ))}
          </div>
        </div>

        {/* Right panel: editor */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {selectedSystem ? (
            <>
              {/* Type properties */}
              <div className="px-3 py-2 border-b border-cad-border grid grid-cols-3 gap-2">
                <div>
                  <label className={labelClass}>Name</label>
                  <input
                    className={inputClass}
                    value={selectedSystem.name}
                    onChange={(e) => updateSelected({ name: e.target.value })}
                  />
                </div>
                <div>
                  <label className={labelClass}>Category</label>
                  <select
                    className={inputClass}
                    value={selectedSystem.category}
                    onChange={(e) => updateSelected({ category: e.target.value as WallSystemCategory })}
                  >
                    {CATEGORIES.map(c => (
                      <option key={c.value} value={c.value}>{c.label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className={labelClass}>Total Thickness</label>
                  <div className="px-2 py-1 text-xs text-cad-text bg-cad-bg border border-cad-border rounded">
                    {selectedSystem.totalThickness.toFixed(1)} mm
                  </div>
                </div>
              </div>

              {/* Tabs */}
              <div className="flex border-b border-cad-border px-3">
                {(['layers', 'studs', 'panels', 'grid'] as const).map(tab => (
                  <button
                    key={tab}
                    onClick={() => setActiveTab(tab)}
                    className={`px-3 py-1.5 text-xs font-medium border-b-2 transition-colors ${
                      activeTab === tab
                        ? 'border-cad-accent text-cad-accent'
                        : 'border-transparent text-cad-text-dim hover:text-cad-text'
                    }`}
                  >
                    {tab.charAt(0).toUpperCase() + tab.slice(1)}
                  </button>
                ))}
              </div>

              {/* Tab content */}
              <div className="flex-1 overflow-y-auto p-3">
                {activeTab === 'layers' && (
                  <LayersTab
                    layers={selectedSystem.layers}
                    onAdd={handleAddLayer}
                    onRemove={handleRemoveLayer}
                    onUpdate={handleUpdateLayer}
                    onMove={handleMoveLayer}
                  />
                )}
                {activeTab === 'studs' && (
                  <StudsTab
                    system={selectedSystem}
                    onUpdate={updateSelected}
                  />
                )}
                {activeTab === 'panels' && (
                  <PanelsTab
                    system={selectedSystem}
                    onUpdate={updateSelected}
                  />
                )}
                {activeTab === 'grid' && (
                  <GridTab
                    system={selectedSystem}
                    onUpdate={updateSelected}
                  />
                )}
              </div>

              {/* Live preview */}
              <div className="border-t border-cad-border p-3">
                <div className="text-[10px] font-medium text-cad-text-dim mb-1">Cross-section Preview</div>
                <CrossSectionPreview system={selectedSystem} />
              </div>
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center text-cad-text-dim text-xs">
              Select or create a wall system type
            </div>
          )}
        </div>
      </div>
    </div>
    </div>
  );
}

// ============================================================================
// Layers Tab
// ============================================================================

function LayersTab({
  layers,
  onAdd,
  onRemove,
  onUpdate,
  onMove,
}: {
  layers: WallSystemLayer[];
  onAdd: () => void;
  onRemove: (id: string) => void;
  onUpdate: (id: string, updates: Partial<WallSystemLayer>) => void;
  onMove: (index: number, direction: 'up' | 'down') => void;
}) {
  const inputClass = 'w-full bg-cad-bg border border-cad-border rounded px-1.5 py-0.5 text-[10px] text-cad-text focus:outline-none focus:border-cad-accent';
  const labelClass = 'text-[9px] text-cad-text-dim';

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-medium text-cad-text">Layers (exterior to interior)</span>
        <button onClick={onAdd} className="flex items-center gap-1 px-2 py-0.5 text-[10px] rounded border border-cad-border hover:bg-cad-hover">
          <Plus size={10} /> Add Layer
        </button>
      </div>

      {layers.length === 0 && (
        <div className="text-xs text-cad-text-dim text-center py-4">No layers. Click "Add Layer" to start.</div>
      )}

      <div className="space-y-1">
        {layers.map((layer, index) => (
          <div key={layer.id} className="flex items-start gap-1 p-1.5 bg-cad-bg/50 rounded border border-cad-border/50">
            {/* Reorder buttons */}
            <div className="flex flex-col gap-0.5 pt-1">
              <button onClick={() => onMove(index, 'up')} disabled={index === 0}
                className="p-0.5 rounded hover:bg-cad-hover disabled:opacity-30">
                <ChevronUp size={10} />
              </button>
              <button onClick={() => onMove(index, 'down')} disabled={index === layers.length - 1}
                className="p-0.5 rounded hover:bg-cad-hover disabled:opacity-30">
                <ChevronDown size={10} />
              </button>
            </div>

            {/* Color swatch */}
            <input
              type="color"
              value={layer.color}
              onChange={(e) => onUpdate(layer.id, { color: e.target.value })}
              className="w-5 h-5 mt-1 rounded cursor-pointer border border-cad-border"
            />

            {/* Name */}
            <div className="flex-1 min-w-0">
              <input
                className={inputClass}
                value={layer.name}
                onChange={(e) => onUpdate(layer.id, { name: e.target.value })}
                placeholder="Layer name"
              />
            </div>

            {/* Thickness */}
            <div className="w-16">
              <span className={labelClass}>mm</span>
              <input
                type="number"
                className={inputClass}
                value={layer.thickness}
                onChange={(e) => onUpdate(layer.id, { thickness: parseFloat(e.target.value) || 0 })}
                min={0}
                step={0.5}
              />
            </div>

            {/* Function */}
            <div className="w-24">
              <span className={labelClass}>Function</span>
              <select
                className={inputClass}
                value={layer.function}
                onChange={(e) => onUpdate(layer.id, { function: e.target.value as WallLayerFunction })}
              >
                {LAYER_FUNCTIONS.map(f => (
                  <option key={f.value} value={f.value}>{f.label}</option>
                ))}
              </select>
            </div>

            {/* Material */}
            <div className="w-20">
              <span className={labelClass}>Material</span>
              <input
                className={inputClass}
                value={layer.material}
                onChange={(e) => onUpdate(layer.id, { material: e.target.value })}
                placeholder="Material"
              />
            </div>

            {/* Delete */}
            <button onClick={() => onRemove(layer.id)} className="p-1 hover:bg-red-500/20 rounded mt-1">
              <Trash2 size={10} className="text-red-400" />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

// ============================================================================
// Studs Tab
// ============================================================================

function StudsTab({
  system,
  onUpdate,
}: {
  system: WallSystemType;
  onUpdate: (updates: Partial<WallSystemType>) => void;
}) {
  const inputClass = 'w-full bg-cad-bg border border-cad-border rounded px-1.5 py-0.5 text-[10px] text-cad-text focus:outline-none focus:border-cad-accent';

  const updateDefaultStud = (updates: Partial<WallSystemStud>) => {
    onUpdate({ defaultStud: { ...system.defaultStud, ...updates } });
  };

  const addAlternateStud = () => {
    const newStud: WallSystemStud = {
      id: genId('stud'),
      name: 'New stud',
      width: 38,
      depth: 140,
      material: 'timber',
      profile: 'rectangular',
      color: '#c4a66a',
      layerIds: [],
    };
    onUpdate({ alternateStuds: [...system.alternateStuds, newStud] });
  };

  const updateAlternateStud = (id: string, updates: Partial<WallSystemStud>) => {
    onUpdate({
      alternateStuds: system.alternateStuds.map(s => s.id === id ? { ...s, ...updates } : s),
    });
  };

  const removeAlternateStud = (id: string) => {
    onUpdate({ alternateStuds: system.alternateStuds.filter(s => s.id !== id) });
  };

  const renderStudEditor = (stud: WallSystemStud, onChange: (u: Partial<WallSystemStud>) => void, onRemove?: () => void) => (
    <div className="flex items-start gap-2 p-2 bg-cad-bg/50 rounded border border-cad-border/50 mb-1">
      <input
        type="color"
        value={stud.color}
        onChange={(e) => onChange({ color: e.target.value })}
        className="w-5 h-5 mt-0.5 rounded cursor-pointer border border-cad-border"
      />
      <div className="flex-1 grid grid-cols-5 gap-1">
        <input className={inputClass} value={stud.name} onChange={(e) => onChange({ name: e.target.value })} placeholder="Name" />
        <input type="number" className={inputClass} value={stud.width} onChange={(e) => onChange({ width: parseFloat(e.target.value) || 0 })} placeholder="W" />
        <input type="number" className={inputClass} value={stud.depth} onChange={(e) => onChange({ depth: parseFloat(e.target.value) || 0 })} placeholder="D" />
        <input className={inputClass} value={stud.material} onChange={(e) => onChange({ material: e.target.value })} placeholder="Material" />
        <select className={inputClass} value={stud.profile} onChange={(e) => onChange({ profile: e.target.value as WallStudProfile })}>
          {STUD_PROFILES.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
        </select>
      </div>
      {onRemove && (
        <button onClick={onRemove} className="p-1 hover:bg-red-500/20 rounded">
          <Trash2 size={10} className="text-red-400" />
        </button>
      )}
    </div>
  );

  return (
    <div>
      <div className="text-xs font-medium text-cad-text mb-2">Default Stud</div>
      {renderStudEditor(system.defaultStud, updateDefaultStud)}

      <div className="flex items-center justify-between mt-4 mb-2">
        <span className="text-xs font-medium text-cad-text">Alternate Studs</span>
        <button onClick={addAlternateStud} className="flex items-center gap-1 px-2 py-0.5 text-[10px] rounded border border-cad-border hover:bg-cad-hover">
          <Plus size={10} /> Add
        </button>
      </div>
      {system.alternateStuds.map(stud => (
        renderStudEditor(
          stud,
          (u) => updateAlternateStud(stud.id, u),
          () => removeAlternateStud(stud.id)
        )
      ))}
      {system.alternateStuds.length === 0 && (
        <div className="text-[10px] text-cad-text-dim text-center py-2">No alternate studs defined.</div>
      )}
    </div>
  );
}

// ============================================================================
// Panels Tab
// ============================================================================

function PanelsTab({
  system,
  onUpdate,
}: {
  system: WallSystemType;
  onUpdate: (updates: Partial<WallSystemType>) => void;
}) {
  const inputClass = 'w-full bg-cad-bg border border-cad-border rounded px-1.5 py-0.5 text-[10px] text-cad-text focus:outline-none focus:border-cad-accent';

  const updateDefaultPanel = (updates: Partial<WallSystemPanel>) => {
    onUpdate({ defaultPanel: { ...system.defaultPanel, ...updates } });
  };

  const addAlternatePanel = () => {
    const newPanel: WallSystemPanel = {
      id: genId('panel'),
      name: 'New panel',
      material: 'generic',
      thickness: 0,
      color: '#cccccc',
      opacity: 1,
    };
    onUpdate({ alternatePanels: [...system.alternatePanels, newPanel] });
  };

  const updateAlternatePanel = (id: string, updates: Partial<WallSystemPanel>) => {
    onUpdate({
      alternatePanels: system.alternatePanels.map(p => p.id === id ? { ...p, ...updates } : p),
    });
  };

  const removeAlternatePanel = (id: string) => {
    onUpdate({ alternatePanels: system.alternatePanels.filter(p => p.id !== id) });
  };

  const renderPanelEditor = (panel: WallSystemPanel, onChange: (u: Partial<WallSystemPanel>) => void, onRemove?: () => void) => (
    <div className="flex items-start gap-2 p-2 bg-cad-bg/50 rounded border border-cad-border/50 mb-1">
      <input
        type="color"
        value={panel.color}
        onChange={(e) => onChange({ color: e.target.value })}
        className="w-5 h-5 mt-0.5 rounded cursor-pointer border border-cad-border"
      />
      <div className="flex-1 grid grid-cols-4 gap-1">
        <input className={inputClass} value={panel.name} onChange={(e) => onChange({ name: e.target.value })} placeholder="Name" />
        <input className={inputClass} value={panel.material} onChange={(e) => onChange({ material: e.target.value })} placeholder="Material" />
        <input type="number" className={inputClass} value={panel.thickness} onChange={(e) => onChange({ thickness: parseFloat(e.target.value) || 0 })} placeholder="Thick" />
        <input type="number" className={inputClass} value={panel.opacity} onChange={(e) => onChange({ opacity: parseFloat(e.target.value) || 1 })} min={0} max={1} step={0.1} placeholder="Opacity" />
      </div>
      {onRemove && (
        <button onClick={onRemove} className="p-1 hover:bg-red-500/20 rounded">
          <Trash2 size={10} className="text-red-400" />
        </button>
      )}
    </div>
  );

  return (
    <div>
      <div className="text-xs font-medium text-cad-text mb-2">Default Panel</div>
      {renderPanelEditor(system.defaultPanel, updateDefaultPanel)}

      <div className="flex items-center justify-between mt-4 mb-2">
        <span className="text-xs font-medium text-cad-text">Alternate Panels</span>
        <button onClick={addAlternatePanel} className="flex items-center gap-1 px-2 py-0.5 text-[10px] rounded border border-cad-border hover:bg-cad-hover">
          <Plus size={10} /> Add
        </button>
      </div>
      {system.alternatePanels.map(panel => (
        renderPanelEditor(
          panel,
          (u) => updateAlternatePanel(panel.id, u),
          () => removeAlternatePanel(panel.id)
        )
      ))}
      {system.alternatePanels.length === 0 && (
        <div className="text-[10px] text-cad-text-dim text-center py-2">No alternate panels defined.</div>
      )}
    </div>
  );
}

// ============================================================================
// Grid Tab
// ============================================================================

function GridTab({
  system,
  onUpdate,
}: {
  system: WallSystemType;
  onUpdate: (updates: Partial<WallSystemType>) => void;
}) {
  const inputClass = 'w-full bg-cad-bg border border-cad-border rounded px-1.5 py-0.5 text-xs text-cad-text focus:outline-none focus:border-cad-accent';
  const labelClass = 'block text-[10px] font-medium text-cad-text-dim mb-0.5';

  const updateGrid = (updates: Partial<WallSystemType['grid']>) => {
    onUpdate({ grid: { ...system.grid, ...updates } });
  };

  return (
    <div className="grid grid-cols-2 gap-4">
      <div>
        <label className={labelClass}>Vertical Spacing (mm)</label>
        <input
          type="number"
          className={inputClass}
          value={system.grid.verticalSpacing}
          onChange={(e) => updateGrid({ verticalSpacing: parseFloat(e.target.value) || 0 })}
          min={0}
          step={50}
        />
        <div className="text-[9px] text-cad-text-dim mt-0.5">Stud/mullion spacing along wall length</div>
      </div>
      <div>
        <label className={labelClass}>Vertical Justification</label>
        <select
          className={inputClass}
          value={system.grid.verticalJustification}
          onChange={(e) => updateGrid({ verticalJustification: e.target.value as 'center' | 'left' | 'right' })}
        >
          <option value="center">Center</option>
          <option value="left">Left</option>
          <option value="right">Right</option>
        </select>
      </div>
      <div>
        <label className={labelClass}>Horizontal Spacing (mm)</label>
        <input
          type="number"
          className={inputClass}
          value={system.grid.horizontalSpacing}
          onChange={(e) => updateGrid({ horizontalSpacing: parseFloat(e.target.value) || 0 })}
          min={0}
          step={100}
        />
        <div className="text-[9px] text-cad-text-dim mt-0.5">Rail/transom spacing (0 = none, plan view only)</div>
      </div>
      <div>
        <label className={labelClass}>Horizontal Justification</label>
        <select
          className={inputClass}
          value={system.grid.horizontalJustification}
          onChange={(e) => updateGrid({ horizontalJustification: e.target.value as 'center' | 'top' | 'bottom' })}
        >
          <option value="center">Center</option>
          <option value="top">Top</option>
          <option value="bottom">Bottom</option>
        </select>
      </div>
    </div>
  );
}

// ============================================================================
// Cross-section Preview
// ============================================================================

function CrossSectionPreview({ system }: { system: WallSystemType }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const W = canvas.width;
    const H = canvas.height;
    ctx.clearRect(0, 0, W, H);

    if (system.layers.length === 0) {
      ctx.fillStyle = '#555';
      ctx.font = '11px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('No layers defined', W / 2, H / 2);
      return;
    }

    const total = system.layers.reduce((s, l) => s + l.thickness, 0);
    if (total <= 0) return;

    // Scale to fit with padding
    const padding = 16;
    const availableW = W - padding * 2;
    const scale = availableW / total;
    const layerH = H - padding * 2;

    let x = padding;
    for (const layer of system.layers) {
      const w = layer.thickness * scale;
      if (w < 0.5) { x += w; continue; }

      // Fill
      ctx.fillStyle = layer.color;
      ctx.globalAlpha = layer.function === 'air-gap' ? 0.3 : 0.7;
      ctx.fillRect(x, padding, w, layerH);
      ctx.globalAlpha = 1;

      // Stroke
      ctx.strokeStyle = '#666';
      ctx.lineWidth = 0.5;
      ctx.strokeRect(x, padding, w, layerH);

      // Label (if wide enough)
      if (w > 30) {
        ctx.save();
        ctx.fillStyle = '#ccc';
        ctx.font = '9px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(`${layer.thickness}`, x + w / 2, padding + layerH / 2 - 6);
        ctx.font = '8px sans-serif';
        ctx.fillStyle = '#999';
        ctx.fillText(layer.name.length > 12 ? layer.name.slice(0, 12) + '...' : layer.name, x + w / 2, padding + layerH / 2 + 6);
        ctx.restore();
      }

      x += w;
    }

    // Total thickness label
    ctx.fillStyle = '#aaa';
    ctx.font = '10px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(`Total: ${total.toFixed(1)} mm`, W / 2, H - 3);
  }, [system]);

  return (
    <canvas
      ref={canvasRef}
      width={740}
      height={80}
      className="w-full rounded border border-cad-border bg-cad-bg"
    />
  );
}
