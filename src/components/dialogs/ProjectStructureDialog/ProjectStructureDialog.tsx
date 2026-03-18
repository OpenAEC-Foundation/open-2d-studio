/**
 * ProjectStructureDialog - Manage IFC Project Spatial Hierarchy
 *
 * Tree-view dialog for setting up the IFC spatial structure:
 *   IfcProject -> IfcSite -> IfcBuilding -> IfcBuildingStorey
 *
 * Uses the shared DraggableModal component.
 */

import { useState, useEffect, useCallback } from 'react';
import { Plus, Trash2, ChevronDown, ChevronRight, Building2, Layers, MapPin } from 'lucide-react';
import { useAppStore, useUnitSettings } from '../../../state/appStore';
import { formatElevation } from '../../../units';
import { DraggableModal, ModalButton } from '../../shared/DraggableModal';
import type {
  ProjectBuilding,
  ProjectStorey,
} from '../../../state/slices/parametricSlice';

/**
 * NumericInput - Local-state numeric input that only commits on blur or Enter.
 * Allows the user to type intermediate values (e.g. "-" for negative numbers)
 * without the input resetting. Selects all text on focus for quick editing.
 */
function NumericInput({ value, onCommit, className }: {
  value: number;
  onCommit: (val: number) => void;
  className?: string;
}) {
  const [localValue, setLocalValue] = useState(String(value));

  useEffect(() => {
    setLocalValue(String(value));
  }, [value]);

  const commit = useCallback(() => {
    const parsed = Number(localValue);
    if (!isNaN(parsed) && localValue.trim() !== '' && localValue.trim() !== '-') {
      onCommit(parsed);
      setLocalValue(String(parsed));
    } else {
      // Revert to original value on invalid input
      setLocalValue(String(value));
    }
  }, [localValue, value, onCommit]);

  return (
    <input
      type="text"
      inputMode="decimal"
      value={localValue}
      onChange={(e) => setLocalValue(e.target.value)}
      onFocus={(e) => e.target.select()}
      onBlur={commit}
      onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
      className={className}
    />
  );
}

interface ProjectStructureDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

type SelectedNode =
  | { type: 'site' }
  | { type: 'building'; buildingId: string }
  | { type: 'storey'; buildingId: string; storeyId: string };

export function ProjectStructureDialog({ isOpen, onClose }: ProjectStructureDialogProps) {
  const unitSettings = useUnitSettings();
  const {
    projectStructure,
    updateSiteName,
    setSeaLevelDatum,
    addBuilding,
    removeBuilding,
    updateBuilding,
    addStorey,
    removeStorey,
    updateStorey,
  } = useAppStore();

  const [expandedBuildings, setExpandedBuildings] = useState<Set<string>>(
    new Set(projectStructure.buildings.map(b => b.id))
  );
  const [selected, setSelected] = useState<SelectedNode | null>(null);

  // Expand all buildings by default when dialog opens
  useEffect(() => {
    if (isOpen) {
      setExpandedBuildings(new Set(projectStructure.buildings.map(b => b.id)));
    }
  }, [isOpen, projectStructure.buildings]);

  const toggleBuilding = (buildingId: string) => {
    setExpandedBuildings(prev => {
      const next = new Set(prev);
      if (next.has(buildingId)) next.delete(buildingId);
      else next.add(buildingId);
      return next;
    });
  };

  const handleAddBuilding = () => {
    const id = `building-${Date.now()}`;
    const newBuilding: ProjectBuilding = {
      id,
      name: 'New Building',
      storeys: [
        { id: `storey-gf-${Date.now()}`, name: 'Ground Floor', elevation: 0 },
      ],
    };
    addBuilding(newBuilding);
    setExpandedBuildings(prev => new Set(prev).add(id));
    setSelected({ type: 'building', buildingId: id });
  };

  const handleAddStorey = (buildingId: string) => {
    const building = projectStructure.buildings.find(b => b.id === buildingId);
    if (!building) return;
    // Default elevation: highest storey elevation + 3100
    const maxElev = building.storeys.length > 0
      ? Math.max(...building.storeys.map(s => s.elevation))
      : 0;
    const newStorey: ProjectStorey = {
      id: `storey-${Date.now()}`,
      name: 'New Storey',
      elevation: maxElev + 3100,
    };
    addStorey(buildingId, newStorey);
    setSelected({ type: 'storey', buildingId, storeyId: newStorey.id });
  };

  const handleDeleteSelected = () => {
    if (!selected) return;
    if (selected.type === 'building') {
      removeBuilding(selected.buildingId);
      setSelected(null);
    } else if (selected.type === 'storey') {
      removeStorey(selected.buildingId, selected.storeyId);
      setSelected(null);
    }
    // Cannot delete site
  };

  // Get selected building/storey for the detail pane
  const getSelectedBuilding = (): ProjectBuilding | undefined => {
    if (!selected) return undefined;
    if (selected.type === 'building' || selected.type === 'storey') {
      return projectStructure.buildings.find(b => b.id === selected.buildingId);
    }
    return undefined;
  };

  const getSelectedStorey = (): ProjectStorey | undefined => {
    if (!selected || selected.type !== 'storey') return undefined;
    const building = projectStructure.buildings.find(b => b.id === selected.buildingId);
    return building?.storeys.find(s => s.id === selected.storeyId);
  };

  /** Format a NAP elevation string from a local elevation (mm) and the sea level datum (m) */
  const formatNapElevation = (elevationMm: number): string => {
    const napElevMm = ((projectStructure.seaLevelDatum ?? 0) * 1000) + elevationMm;
    const napElev = napElevMm / 1000;
    const precision = napElev === Math.round(napElev) ? 1 : 2;
    return `NAP ${formatElevation(napElevMm, unitSettings.numberFormat, precision)} m`;
  };

  const selectedBuilding = getSelectedBuilding();
  const selectedStorey = getSelectedStorey();
  const hasDatum = (projectStructure.seaLevelDatum ?? 0) !== 0;

  return (
    <DraggableModal
      isOpen={isOpen}
      onClose={onClose}
      title="Project Structure"
      width={540}
      footer={<ModalButton onClick={onClose}>Close</ModalButton>}
    >
      {/* Content */}
      <div className="flex flex-1 overflow-hidden" style={{ minHeight: 320 }}>
        {/* Left: Tree view */}
        <div className="w-[220px] border-r border-cad-border overflow-y-auto flex flex-col">
          {/* Toolbar */}
          <div className="p-2 border-b border-cad-border flex gap-1">
            <button
              onClick={handleAddBuilding}
              className="flex items-center gap-1 px-2 py-1 text-xs bg-cad-accent/20 border border-cad-accent/50 text-cad-accent hover:bg-cad-accent/30 rounded"
              title="Add building"
            >
              <Plus size={12} /> Building
            </button>
            <button
              onClick={() => {
                if (selected?.type === 'building') handleAddStorey(selected.buildingId);
                else if (selected?.type === 'storey') handleAddStorey(selected.buildingId);
              }}
              disabled={!selected || selected.type === 'site'}
              className="flex items-center gap-1 px-2 py-1 text-xs bg-cad-accent/20 border border-cad-accent/50 text-cad-accent hover:bg-cad-accent/30 rounded disabled:opacity-30"
              title="Add storey to selected building"
            >
              <Plus size={12} /> Storey
            </button>
            <button
              onClick={handleDeleteSelected}
              disabled={!selected || selected.type === 'site'}
              className="flex items-center gap-1 px-2 py-1 text-xs bg-cad-bg border border-cad-border text-cad-text hover:bg-cad-hover rounded disabled:opacity-30"
              title="Delete selected item"
            >
              <Trash2 size={12} />
            </button>
          </div>

          {/* Tree */}
          <div className="flex-1 overflow-y-auto py-1">
            {/* Site node */}
            <button
              className={`w-full flex items-center gap-1.5 px-3 py-1.5 text-xs ${
                selected?.type === 'site'
                  ? 'bg-cad-accent/20 text-cad-accent'
                  : 'text-cad-text hover:bg-cad-hover'
              }`}
              onClick={() => setSelected({ type: 'site' })}
            >
              <MapPin size={13} className="flex-shrink-0 text-cad-text-dim" />
              <span className="truncate font-medium">{projectStructure.siteName}</span>
            </button>

            {/* Buildings */}
            {projectStructure.buildings.map(building => {
              const isExpanded = expandedBuildings.has(building.id);
              const isBuildingSelected = selected?.type === 'building' && selected.buildingId === building.id;
              return (
                <div key={building.id}>
                  <div className="flex items-center">
                    <button
                      className="pl-2 pr-0 py-1.5 text-cad-text-dim hover:text-cad-text"
                      onClick={() => toggleBuilding(building.id)}
                    >
                      {isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                    </button>
                    <button
                      className={`flex-1 flex items-center gap-1.5 px-1 py-1.5 text-xs text-left truncate ${
                        isBuildingSelected
                          ? 'bg-cad-accent/20 text-cad-accent'
                          : 'text-cad-text hover:bg-cad-hover'
                      }`}
                      onClick={() => setSelected({ type: 'building', buildingId: building.id })}
                    >
                      <Building2 size={13} className="flex-shrink-0 text-cad-text-dim" />
                      <span className="truncate">{building.name}</span>
                    </button>
                  </div>

                  {/* Storeys */}
                  {isExpanded && building.storeys
                    .slice()
                    .sort((a, b) => b.elevation - a.elevation)
                    .map(storey => {
                      const isStoreySelected =
                        selected?.type === 'storey' &&
                        selected.buildingId === building.id &&
                        selected.storeyId === storey.id;
                      return (
                        <button
                          key={storey.id}
                          className={`w-full flex items-center gap-1.5 pl-10 pr-3 py-1 text-xs text-left ${
                            isStoreySelected
                              ? 'bg-cad-accent/20 text-cad-accent'
                              : 'text-cad-text-secondary hover:bg-cad-hover'
                          }`}
                          onClick={() => setSelected({
                            type: 'storey',
                            buildingId: building.id,
                            storeyId: storey.id,
                          })}
                        >
                          <Layers size={12} className="flex-shrink-0 text-cad-text-dim" />
                          <span className="truncate">{storey.name}</span>
                          <span className="ml-auto text-[10px] text-cad-text-dim flex-shrink-0">
                            {storey.elevation >= 0 ? '+' : ''}{storey.elevation}
                            {hasDatum && <span className="ml-1 text-cad-accent/70">({formatNapElevation(storey.elevation)})</span>}
                          </span>
                        </button>
                      );
                    })}
                </div>
              );
            })}
          </div>
        </div>

        {/* Right: Detail pane */}
        <div className="flex-1 overflow-y-auto p-4">
          {selected?.type === 'site' && (
            <div className="space-y-3">
              <div>
                <h3 className="text-sm font-semibold text-cad-text">IfcSite</h3>
                <div className="text-[10px] text-cad-text-dim mt-0.5">
                  IFC Class: IfcSite &middot; ISO 16739
                </div>
              </div>
              <div>
                <label className="block text-[10px] text-cad-text-dim mb-0.5">Site Name</label>
                <input
                  type="text"
                  value={projectStructure.siteName}
                  onChange={(e) => updateSiteName(e.target.value)}
                  className="w-full h-7 px-2 text-xs bg-cad-bg border border-cad-border text-cad-text rounded"
                />
              </div>
              <div>
                <label className="block text-[10px] text-cad-text-dim mb-0.5">
                  Peil = 0 (NAP) &mdash; Sea Level Datum (m)
                </label>
                <NumericInput
                  value={projectStructure.seaLevelDatum ?? 0}
                  onCommit={(val) => setSeaLevelDatum(val)}
                  className="w-full h-7 px-2 text-xs bg-cad-bg border border-cad-border text-cad-text rounded"
                />
                <p className="text-[10px] text-cad-text-dim mt-1">
                  Elevation of peil=0 relative to NAP (Normaal Amsterdams Peil) in meters.
                  E.g., &minus;0.5 means peil=0 is 0.5 m below NAP.
                </p>
              </div>
              <p className="text-[10px] text-cad-text-dim">
                The site represents the physical location. All buildings are contained within this site.
              </p>
            </div>
          )}

          {selected?.type === 'building' && selectedBuilding && (
            <div className="space-y-3">
              <div>
                <h3 className="text-sm font-semibold text-cad-text">IfcBuilding</h3>
                <div className="text-[10px] text-cad-text-dim mt-0.5">
                  IFC Class: IfcBuilding &middot; {selectedBuilding.storeys.length} storey(s)
                </div>
              </div>
              <div>
                <label className="block text-[10px] text-cad-text-dim mb-0.5">Building Name</label>
                <input
                  type="text"
                  value={selectedBuilding.name}
                  onChange={(e) => updateBuilding(selectedBuilding.id, { name: e.target.value })}
                  className="w-full h-7 px-2 text-xs bg-cad-bg border border-cad-border text-cad-text rounded"
                />
              </div>
              <div>
                <label className="block text-[10px] text-cad-text-dim mb-0.5">Storeys</label>
                <div className="text-xs text-cad-text-secondary space-y-0.5">
                  {selectedBuilding.storeys
                    .slice()
                    .sort((a, b) => b.elevation - a.elevation)
                    .map(s => (
                      <div key={s.id} className="flex justify-between px-2 py-0.5 bg-cad-bg/50 rounded">
                        <span>{s.name}</span>
                        <span className="text-cad-text-dim">
                          {s.elevation >= 0 ? '+' : ''}{s.elevation} mm
                          {hasDatum && <span className="ml-1 text-cad-accent/70">({formatNapElevation(s.elevation)})</span>}
                        </span>
                      </div>
                    ))}
                </div>
              </div>
              <button
                onClick={() => handleAddStorey(selectedBuilding.id)}
                className="flex items-center gap-1 px-3 py-1 text-xs bg-cad-accent/20 border border-cad-accent/50 text-cad-accent hover:bg-cad-accent/30 rounded"
              >
                <Plus size={12} /> Add Storey
              </button>
            </div>
          )}

          {selected?.type === 'storey' && selectedStorey && selectedBuilding && (
            <div className="space-y-3">
              <div>
                <h3 className="text-sm font-semibold text-cad-text">IfcBuildingStorey</h3>
                <div className="text-[10px] text-cad-text-dim mt-0.5">
                  IFC Class: IfcBuildingStorey &middot; Building: {selectedBuilding.name}
                </div>
              </div>
              <div>
                <label className="block text-[10px] text-cad-text-dim mb-0.5">Storey Name</label>
                <input
                  type="text"
                  value={selectedStorey.name}
                  onChange={(e) =>
                    updateStorey(selected.buildingId, selected.storeyId, { name: e.target.value })
                  }
                  className="w-full h-7 px-2 text-xs bg-cad-bg border border-cad-border text-cad-text rounded"
                />
              </div>
              <div>
                <label className="block text-[10px] text-cad-text-dim mb-0.5">Elevation (mm)</label>
                <NumericInput
                  value={selectedStorey.elevation}
                  onCommit={(val) =>
                    updateStorey(selected.buildingId, selected.storeyId, {
                      elevation: val,
                    })
                  }
                  className="w-full h-7 px-2 text-xs bg-cad-bg border border-cad-border text-cad-text rounded"
                />
              </div>
              {hasDatum && (
                <div className="px-2 py-1.5 bg-cad-accent/10 border border-cad-accent/30 rounded">
                  <div className="text-[10px] text-cad-text-dim">NAP Elevation</div>
                  <div className="text-xs text-cad-accent font-medium">
                    {formatNapElevation(selectedStorey.elevation)}
                  </div>
                </div>
              )}
              <p className="text-[10px] text-cad-text-dim">
                Elevation is measured from project zero (peil) in millimeters.
                Negative values are below ground level.
                {hasDatum && ' NAP elevation is calculated from the sea level datum set on the site.'}
              </p>
            </div>
          )}

          {!selected && (
            <div className="flex items-center justify-center h-full text-xs text-cad-text-dim">
              Select an item in the tree to edit its properties
            </div>
          )}
        </div>
      </div>
    </DraggableModal>
  );
}
