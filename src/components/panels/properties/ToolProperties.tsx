import { useState } from 'react';
import { useAppStore } from '../../../state/appStore';
import type {
  LineStyle,
  BeamMaterial,
  BeamJustification,
  BeamViewMode,
  ColumnMaterial,
  GridlineBubblePosition,
  WallJustification,
  WallEndCap,
  SlabMaterial,
  PileTypeDefinition,
} from '../../../types/geometry';
import type { ProfileType, ParameterValues } from '../../../types/parametric';
import { PROFILE_TEMPLATES } from '../../../services/parametric/profileTemplates';
import { getPresetById } from '../../../services/parametric/profileLibrary';
import { SectionDialog } from '../../dialogs/SectionDialog/SectionDialog';
import { PatternPickerPanel } from '../../editors/PatternManager/PatternPickerPanel';
import {
  PropertyGroup,
  NumberField,
  TextField,
  CheckboxField,
  SelectField,
  ColorPalette,
  LineweightInput,
  inputClass,
  labelClass,
  RAD2DEG,
  DEG2RAD,
} from './PropertyFields';
import { PileSymbolPicker } from './ShapeProperties';

/** Wall tool properties - edits pendingWall state */
export function WallToolProperties() {
  const pendingWall = useAppStore(s => s.pendingWall);
  const setPendingWall = useAppStore(s => s.setPendingWall);
  const wallTypes = useAppStore(s => s.wallTypes);
  const groupedWallTypes = useAppStore(s => s.groupedWallTypes);
  const setLastUsedWallTypeId = useAppStore(s => s.setLastUsedWallTypeId);

  if (!pendingWall) return null;

  const selectedType = pendingWall.wallTypeId
    ? wallTypes.find(w => w.id === pendingWall.wallTypeId)
    : undefined;

  const selectedGroupedType = pendingWall.wallTypeId
    ? groupedWallTypes.find(g => g.id === pendingWall.wallTypeId)
    : undefined;

  const isGroupedWall = !!selectedGroupedType;

  return (
    <div className="p-3 border-b border-cad-border">
      <div className="flex items-center gap-2 mb-3">
        <span className="text-xs font-semibold text-cad-accent uppercase tracking-wide">Wall Tool</span>
      </div>

      {/* Shape Mode toggle */}
      <div className="mb-3">
        <label className={labelClass}>Shape Mode</label>
        <div className="flex gap-1">
          <button
            className={`flex-1 px-2 py-1 text-xs rounded ${pendingWall.shapeMode === 'line' || !pendingWall.shapeMode ? 'bg-cad-accent/20 text-cad-accent border border-cad-accent/50' : 'bg-cad-bg border border-cad-border text-cad-text hover:bg-cad-hover'}`}
            onClick={() => setPendingWall({ ...pendingWall, shapeMode: 'line' })}
          >
            Line
          </button>
          <button
            className={`flex-1 px-2 py-1 text-xs rounded ${pendingWall.shapeMode === 'arc' ? 'bg-cad-accent/20 text-cad-accent border border-cad-accent/50' : 'bg-cad-bg border border-cad-border text-cad-text hover:bg-cad-hover'}`}
            onClick={() => setPendingWall({ ...pendingWall, shapeMode: 'arc' })}
          >
            Arc
          </button>
        </div>
      </div>

      {/* Wall Type selector at top */}
      <div className="mb-3">
        <label className={labelClass}>Wall Type</label>
        <select
          value={pendingWall.wallTypeId || ''}
          onChange={(e) => {
            const typeId = e.target.value || undefined;
            // Check regular wall types first, then grouped
            const wt = wallTypes.find(w => w.id === typeId);
            const gwt = groupedWallTypes.find(g => g.id === typeId);
            setPendingWall({
              ...pendingWall,
              wallTypeId: typeId,
              thickness: wt ? wt.thickness : gwt ? gwt.totalThickness : pendingWall.thickness,
            });
            if (typeId) {
              setLastUsedWallTypeId(typeId);
            }
          }}
          className={inputClass}
        >
          <option value="">(Custom)</option>
          {wallTypes.map(wt => (
            <option key={wt.id} value={wt.id}>{wt.name} ({wt.thickness}mm)</option>
          ))}
          {groupedWallTypes.length > 0 && (
            <option disabled>── Grouped Walls ──</option>
          )}
          {groupedWallTypes.map(gwt => (
            <option key={gwt.id} value={gwt.id}>{gwt.name} ({gwt.totalThickness}mm)</option>
          ))}
        </select>
      </div>

      {/* Grouped wall layer info */}
      {isGroupedWall && selectedGroupedType && (
        <div className="mb-3 p-2 bg-cad-bg rounded border border-cad-border">
          <div className="text-[10px] text-cad-text-dim font-medium mb-1">Layers:</div>
          {selectedGroupedType.layers.map((layer) => (
            <div key={layer.id} className="text-[10px] text-cad-text-secondary flex justify-between">
              <span>{layer.isDrawn ? '\u2588' : '\u2591'} {layer.name}</span>
              <span>{layer.thickness}mm{layer.gap > 0 ? ` +${layer.gap}mm gap` : ''}</span>
            </div>
          ))}
          <div className="text-[10px] text-cad-text-dim mt-1">
            Alignment: {selectedGroupedType.alignmentLine}
          </div>
        </div>
      )}

      <PropertyGroup label="Properties">
        <NumberField
          label="Thickness (mm)"
          value={pendingWall.thickness}
          onChange={(v) => setPendingWall({ ...pendingWall, thickness: v, wallTypeId: undefined })}
          step={10}
          min={10}
        />
        <SelectField<WallJustification>
          label="Justification"
          value={pendingWall.justification}
          options={[
            { value: 'center', label: 'Center' },
            { value: 'left', label: 'Left' },
            { value: 'right', label: 'Right' },
          ]}
          onChange={(v) => setPendingWall({ ...pendingWall, justification: v })}
        />
        <SelectField<WallEndCap>
          label="Start Cap"
          value={pendingWall.startCap}
          options={[
            { value: 'butt', label: 'Butt' },
            { value: 'miter', label: 'Miter' },
          ]}
          onChange={(v) => setPendingWall({ ...pendingWall, startCap: v })}
        />
        <SelectField<WallEndCap>
          label="End Cap"
          value={pendingWall.endCap}
          options={[
            { value: 'butt', label: 'Butt' },
            { value: 'miter', label: 'Miter' },
          ]}
          onChange={(v) => setPendingWall({ ...pendingWall, endCap: v })}
        />
      </PropertyGroup>

      <PropertyGroup label="Display">
        <CheckboxField
          label="Show Centerline"
          value={pendingWall.showCenterline}
          onChange={(v) => setPendingWall({ ...pendingWall, showCenterline: v })}
        />
        <CheckboxField
          label="Space Bounding"
          value={pendingWall.spaceBounding}
          onChange={(v) => setPendingWall({ ...pendingWall, spaceBounding: v })}
        />
        <CheckboxField
          label="Continue Drawing"
          value={pendingWall.continueDrawing}
          onChange={(v) => setPendingWall({ ...pendingWall, continueDrawing: v })}
        />
      </PropertyGroup>

      {selectedType && (
        <div className="mt-1 px-2 py-1 bg-cad-bg rounded border border-cad-border">
          <div className="text-[10px] text-cad-text-dim">
            Material: <span className="text-cad-text capitalize">{selectedType.material}</span>
          </div>
        </div>
      )}
    </div>
  );
}

/** Beam/Column tool properties - edits pendingBeam state */
export function BeamToolProperties() {
  const pendingBeam = useAppStore(s => s.pendingBeam);
  const setPendingBeam = useAppStore(s => s.setPendingBeam);
  const setActiveTool = useAppStore(s => s.setActiveTool);
  const [profileQuery, setProfileQuery] = useState('');
  const [profileResults, setProfileResults] = useState<any[]>([]);

  if (!pendingBeam) return null;

  const handleProfileSearch = (query: string) => {
    setProfileQuery(query);
    if (query.length >= 2) {
      const { searchPresets } = require('../../../services/parametric/profileLibrary');
      const results = searchPresets(query).slice(0, 8);
      setProfileResults(results);
      // Auto-apply top match on the fly (preview updates immediately)
      if (results.length > 0) {
        const top = results[0];
        setPendingBeam({
          ...pendingBeam,
          profileType: top.profileType,
          parameters: top.parameters,
          presetId: top.id,
          presetName: top.name,
          flangeWidth: top.parameters.flangeWidth || top.parameters.width || pendingBeam.flangeWidth,
        });
      }
    } else {
      setProfileResults([]);
    }
  };

  const applyPreset = (preset: any) => {
    setPendingBeam({
      ...pendingBeam,
      profileType: preset.profileType,
      parameters: preset.parameters,
      presetId: preset.id,
      presetName: preset.name,
      flangeWidth: preset.parameters.flangeWidth || preset.parameters.width || pendingBeam.flangeWidth,
    });
    setProfileQuery(preset.name);
    setProfileResults([]);
  };

  return (
    <div className="p-3 border-b border-cad-border">
      <div className="flex items-center gap-2 mb-3">
        <span className="text-xs font-semibold text-cad-accent uppercase tracking-wide">Beam Tool</span>
      </div>

      {/* Profile search */}
      <div className="mb-3 relative">
        <input
          type="text"
          className="w-full px-2 py-1 text-xs bg-cad-bg border border-cad-border rounded text-cad-text placeholder-cad-text-dim focus:border-cad-accent outline-none"
          placeholder="Search profile (e.g. HEA300)"
          value={profileQuery}
          onChange={(e) => handleProfileSearch(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && profileResults.length > 0) {
              applyPreset(profileResults[0]);
              setActiveTool('beam');
            }
          }}
        />
        {profileResults.length > 0 && profileQuery.length >= 2 && (
          <div className="absolute z-50 left-0 right-0 mt-1 bg-cad-surface border border-cad-border rounded shadow-lg max-h-40 overflow-y-auto">
            {profileResults.map((preset: any) => (
              <button
                key={preset.id}
                className="w-full px-2 py-1 text-xs text-left text-cad-text hover:bg-cad-hover"
                onClick={() => { applyPreset(preset); setActiveTool('beam'); }}
              >
                {preset.name}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Shape Mode toggle */}
      <div className="mb-3">
        <label className={labelClass}>Shape Mode</label>
        <div className="flex gap-1">
          <button
            className={`flex-1 px-2 py-1 text-xs rounded ${pendingBeam.shapeMode === 'line' || !pendingBeam.shapeMode ? 'bg-cad-accent/20 text-cad-accent border border-cad-accent/50' : 'bg-cad-bg border border-cad-border text-cad-text hover:bg-cad-hover'}`}
            onClick={() => setPendingBeam({ ...pendingBeam, shapeMode: 'line' })}
          >
            Line
          </button>
          <button
            className={`flex-1 px-2 py-1 text-xs rounded ${pendingBeam.shapeMode === 'arc' ? 'bg-cad-accent/20 text-cad-accent border border-cad-accent/50' : 'bg-cad-bg border border-cad-border text-cad-text hover:bg-cad-hover'}`}
            onClick={() => setPendingBeam({ ...pendingBeam, shapeMode: 'arc' })}
          >
            Arc
          </button>
        </div>
      </div>

      {/* Profile / Preset info at top */}
      <div className="mb-3 p-2 bg-cad-bg rounded border border-cad-border">
        <div className="text-xs font-semibold text-cad-accent mb-1">
          {pendingBeam.presetName || pendingBeam.presetId || PROFILE_TEMPLATES[pendingBeam.profileType]?.name || pendingBeam.profileType}
        </div>
        {pendingBeam.presetId && (
          <div className="text-[10px] text-cad-text-dim">
            Preset: {pendingBeam.presetId}
          </div>
        )}
      </div>

      <PropertyGroup label="Properties">
        <NumberField
          label="Flange Width (mm)"
          value={pendingBeam.flangeWidth}
          onChange={(v) => setPendingBeam({ ...pendingBeam, flangeWidth: v })}
          step={1}
          min={1}
        />
        <SelectField<BeamMaterial>
          label="Material"
          value={pendingBeam.material}
          options={[
            { value: 'steel', label: 'Steel' },
            { value: 'cold-formed-steel', label: 'Cold-Formed Steel' },
            { value: 'concrete', label: 'Concrete' },
            { value: 'timber', label: 'Timber' },
            { value: 'aluminum', label: 'Aluminum' },
            { value: 'other', label: 'Other' },
          ]}
          onChange={(v) => setPendingBeam({ ...pendingBeam, material: v })}
        />
        <SelectField<BeamJustification>
          label="Justification"
          value={pendingBeam.justification}
          options={[
            { value: 'center', label: 'Center' },
            { value: 'top', label: 'Top' },
            { value: 'bottom', label: 'Bottom' },
            { value: 'left', label: 'Left' },
            { value: 'right', label: 'Right' },
          ]}
          onChange={(v) => setPendingBeam({ ...pendingBeam, justification: v })}
        />
        <SelectField<BeamViewMode>
          label="View"
          value={pendingBeam.viewMode || 'plan'}
          options={[
            { value: 'plan', label: 'Plan' },
            { value: 'section', label: 'Section' },
            { value: 'elevation', label: 'Elevation' },
            { value: 'side', label: 'Side' },
          ]}
          onChange={(v) => setPendingBeam({ ...pendingBeam, viewMode: v })}
        />
      </PropertyGroup>

      <PropertyGroup label="Display">
        <CheckboxField
          label="Show Centerline"
          value={pendingBeam.showCenterline}
          onChange={(v) => setPendingBeam({ ...pendingBeam, showCenterline: v })}
        />
        <CheckboxField
          label="Show Label"
          value={pendingBeam.showLabel}
          onChange={(v) => setPendingBeam({ ...pendingBeam, showLabel: v })}
        />
        <CheckboxField
          label="Continue Drawing"
          value={pendingBeam.continueDrawing}
          onChange={(v) => setPendingBeam({ ...pendingBeam, continueDrawing: v })}
        />
      </PropertyGroup>
    </div>
  );
}

/** Slab tool properties - edits pendingSlab state */
export function SlabToolProperties() {
  const pendingSlab = useAppStore(s => s.pendingSlab);
  const setPendingSlab = useAppStore(s => s.setPendingSlab);
  const slabTypes = useAppStore(s => s.slabTypes);
  const slabToolProjectStructure = useAppStore(s => s.projectStructure);

  // Collect all storeys from all buildings for level selector
  const slabToolAllStoreys: { id: string; name: string; elevation: number }[] = [];
  for (const building of slabToolProjectStructure.buildings) {
    for (const storey of building.storeys) {
      slabToolAllStoreys.push(storey);
    }
  }
  slabToolAllStoreys.sort((a, b) => a.elevation - b.elevation);

  if (!pendingSlab) return null;

  const selectedType = pendingSlab.slabTypeId
    ? slabTypes.find(s => s.id === pendingSlab.slabTypeId)
    : undefined;

  return (
    <div className="p-3 border-b border-cad-border">
      <div className="flex items-center gap-2 mb-3">
        <span className="text-xs font-semibold text-cad-accent uppercase tracking-wide">Slab Tool</span>
      </div>

      {/* Slab Type selector at top */}
      <div className="mb-3">
        <label className={labelClass}>Slab Type</label>
        <select
          value={pendingSlab.slabTypeId || ''}
          onChange={(e) => {
            const typeId = e.target.value || undefined;
            const st = slabTypes.find(s => s.id === typeId);
            setPendingSlab({
              ...pendingSlab,
              slabTypeId: typeId,
              thickness: st ? st.thickness : pendingSlab.thickness,
              material: st ? st.material as SlabMaterial : pendingSlab.material,
            });
          }}
          className={inputClass}
        >
          <option value="">(Custom)</option>
          {slabTypes.map(st => (
            <option key={st.id} value={st.id}>{st.name} {st.thickness}mm</option>
          ))}
        </select>
      </div>

      <PropertyGroup label="Properties">
        <NumberField
          label="Thickness (mm)"
          value={pendingSlab.thickness}
          onChange={(v) => setPendingSlab({ ...pendingSlab, thickness: v, slabTypeId: undefined })}
          step={10}
          min={10}
        />
        <SelectField<SlabMaterial>
          label="Material"
          value={pendingSlab.material}
          options={[
            { value: 'concrete', label: 'Concrete' },
            { value: 'timber', label: 'Timber' },
            { value: 'steel', label: 'Steel' },
            { value: 'generic', label: 'Generic' },
          ]}
          onChange={(v) => setPendingSlab({ ...pendingSlab, material: v, slabTypeId: undefined })}
        />
        <NumberField
          label="Elevation (mm)"
          value={pendingSlab.elevation}
          onChange={(v) => setPendingSlab({ ...pendingSlab, elevation: v })}
          step={100}
        />
      </PropertyGroup>

      <PropertyGroup label="Constraints">
        <div className="mb-2">
          <label className={labelClass}>Storey</label>
          <select
            className={inputClass}
            value={pendingSlab.level || ''}
            onChange={(e) => setPendingSlab({ ...pendingSlab, level: e.target.value || undefined })}
          >
            <option value="">(Auto from drawing)</option>
            {slabToolAllStoreys.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} ({s.elevation >= 0 ? '+' : ''}{s.elevation} mm)
              </option>
            ))}
          </select>
        </div>
      </PropertyGroup>

      {selectedType && (
        <div className="mt-1 px-2 py-1 bg-cad-bg rounded border border-cad-border">
          <div className="text-[10px] text-cad-text-dim">
            Material: <span className="text-cad-text capitalize">{selectedType.material}</span>
          </div>
        </div>
      )}
    </div>
  );
}

/** Slab Label tool properties - edits pendingSlabLabel state */
export function SlabLabelToolProperties() {
  const pendingSlabLabel = useAppStore(s => s.pendingSlabLabel);
  const setPendingSlabLabel = useAppStore(s => s.setPendingSlabLabel);

  if (!pendingSlabLabel) return null;

  return (
    <div className="p-3 border-b border-cad-border">
      <div className="flex items-center gap-2 mb-3">
        <span className="text-xs font-semibold text-cad-accent uppercase tracking-wide">Slab Tag Tool</span>
      </div>
      <p className="text-[10px] text-cad-text-dim mb-3">
        Click to place a slab tag (two circles showing thickness and peil).
        Link to a slab after placement via properties panel.
      </p>

      <PropertyGroup label="Properties">
        <NumberField
          label="Thickness (mm)"
          value={pendingSlabLabel.thickness}
          onChange={(v) => setPendingSlabLabel({ ...pendingSlabLabel, thickness: v })}
          step={10}
          min={10}
        />
        <NumberField
          label="Font Size"
          value={pendingSlabLabel.fontSize}
          onChange={(v) => setPendingSlabLabel({ ...pendingSlabLabel, fontSize: v })}
          step={10}
          min={20}
        />
      </PropertyGroup>
    </div>
  );
}

/** Space tool properties - edits pendingSpace state */
export function SpaceToolProperties() {
  const pendingSpace = useAppStore(s => s.pendingSpace);
  const setPendingSpace = useAppStore(s => s.setPendingSpace);

  if (!pendingSpace) return null;

  return (
    <div className="p-3 border-b border-cad-border">
      <div className="flex items-center gap-2 mb-3">
        <span className="text-xs font-semibold text-cad-accent uppercase tracking-wide">Space Tool</span>
      </div>
      <p className="text-[10px] text-cad-text-dim mb-3">
        Click inside an area enclosed by walls to detect and create an IfcSpace.
      </p>

      <PropertyGroup label="Properties">
        <TextField
          label="Name"
          value={pendingSpace.name}
          onChange={(v) => setPendingSpace({ ...pendingSpace, name: v })}
          placeholder="e.g. Living Room"
        />
        <TextField
          label="Number"
          value={pendingSpace.number || ''}
          onChange={(v) => setPendingSpace({ ...pendingSpace, number: v || undefined })}
          placeholder="e.g. 101"
        />
        <TextField
          label="Storey"
          value={pendingSpace.level || ''}
          onChange={(v) => setPendingSpace({ ...pendingSpace, level: v || undefined })}
          placeholder="e.g. Ground Floor"
        />
      </PropertyGroup>

      <PropertyGroup label="Display">
        <TextField
          label="Fill Color"
          value={pendingSpace.fillColor || '#00ff00'}
          onChange={(v) => setPendingSpace({ ...pendingSpace, fillColor: v })}
        />
        <NumberField
          label="Fill Opacity"
          value={pendingSpace.fillOpacity ?? 0.1}
          onChange={(v) => setPendingSpace({ ...pendingSpace, fillOpacity: v })}
          step={0.05}
          min={0}
          max={1}
        />
      </PropertyGroup>
    </div>
  );
}

/** Gridline tool properties - edits pendingGridline state */
export function GridlineToolProperties() {
  const pendingGridline = useAppStore(s => s.pendingGridline);
  const setPendingGridline = useAppStore(s => s.setPendingGridline);

  if (!pendingGridline) return null;

  return (
    <div className="p-3 border-b border-cad-border">
      <div className="flex items-center gap-2 mb-3">
        <span className="text-xs font-semibold text-cad-accent uppercase tracking-wide">Gridline Tool</span>
      </div>

      <PropertyGroup label="Properties">
        <TextField
          label="Label"
          value={pendingGridline.label}
          onChange={(v) => setPendingGridline({ ...pendingGridline, label: v })}
          placeholder="A, B, 1, 2..."
        />
        <SelectField<GridlineBubblePosition>
          label="Bubble Position"
          value={pendingGridline.bubblePosition}
          options={[
            { value: 'start', label: 'Start' },
            { value: 'end', label: 'End' },
            { value: 'both', label: 'Both' },
          ]}
          onChange={(v) => setPendingGridline({ ...pendingGridline, bubblePosition: v })}
        />
        <NumberField
          label="Bubble Radius (mm)"
          value={pendingGridline.bubbleRadius}
          onChange={(v) => setPendingGridline({ ...pendingGridline, bubbleRadius: v })}
          step={25}
          min={50}
        />
        <NumberField
          label="Font Size (mm)"
          value={pendingGridline.fontSize}
          onChange={(v) => setPendingGridline({ ...pendingGridline, fontSize: v })}
          step={25}
          min={50}
        />
      </PropertyGroup>
    </div>
  );
}

/** Level tool properties - edits pendingLevel state */
export function LevelToolProperties() {
  const pendingLevel = useAppStore(s => s.pendingLevel);
  const setPendingLevel = useAppStore(s => s.setPendingLevel);

  if (!pendingLevel) return null;

  return (
    <div className="p-3 border-b border-cad-border">
      <div className="flex items-center gap-2 mb-3">
        <span className="text-xs font-semibold text-cad-accent uppercase tracking-wide">Level Tool</span>
      </div>

      <PropertyGroup label="Properties">
        <TextField
          label="Label"
          value={pendingLevel.label}
          onChange={(v) => setPendingLevel({ ...pendingLevel, label: v })}
          placeholder="e.g. +0, +3000"
        />
        <NumberField
          label="Elevation (mm)"
          value={pendingLevel.elevation}
          onChange={(v) => setPendingLevel({ ...pendingLevel, elevation: v })}
          step={100}
        />
        <NumberField
          label="Peil (mm)"
          value={pendingLevel.peil}
          onChange={(v) => setPendingLevel({ ...pendingLevel, peil: v })}
          step={100}
        />
        <TextField
          label="Description"
          value={pendingLevel.description || ''}
          onChange={(v) => setPendingLevel({ ...pendingLevel, description: v || undefined })}
          placeholder="e.g. Vloerpeil, Bovenkant vloer"
        />
      </PropertyGroup>

      <PropertyGroup label="Display">
        <NumberField
          label="Bubble Radius (mm)"
          value={pendingLevel.bubbleRadius}
          onChange={(v) => setPendingLevel({ ...pendingLevel, bubbleRadius: v })}
          step={25}
          min={50}
        />
        <NumberField
          label="Font Size (mm)"
          value={pendingLevel.fontSize}
          onChange={(v) => setPendingLevel({ ...pendingLevel, fontSize: v })}
          step={25}
          min={50}
        />
      </PropertyGroup>
    </div>
  );
}

/** Puntniveau tool properties - edits pendingPuntniveau state */
export function PuntniveauToolProperties() {
  const pendingPuntniveau = useAppStore(s => s.pendingPuntniveau);
  const setPendingPuntniveau = useAppStore(s => s.setPendingPuntniveau);

  if (!pendingPuntniveau) return null;

  return (
    <div className="p-3 border-b border-cad-border">
      <div className="flex items-center gap-2 mb-3">
        <span className="text-xs font-semibold text-cad-accent uppercase tracking-wide">Puntniveau Tool</span>
      </div>

      <PropertyGroup label="Properties">
        <NumberField
          label="Puntniveau t.o.v. NAP (m)"
          value={pendingPuntniveau.puntniveauNAP}
          onChange={(v) => setPendingPuntniveau({ ...pendingPuntniveau, puntniveauNAP: v })}
          step={0.5}
        />
      </PropertyGroup>

      <PropertyGroup label="Display">
        <NumberField
          label="Font Size (mm)"
          value={pendingPuntniveau.fontSize}
          onChange={(v) => setPendingPuntniveau({ ...pendingPuntniveau, fontSize: v })}
          step={25}
          min={50}
        />
      </PropertyGroup>
    </div>
  );
}

/** Pile tool properties - edits pendingPile state */
export function PileToolProperties() {
  const pendingPile = useAppStore(s => s.pendingPile);
  const setPendingPile = useAppStore(s => s.setPendingPile);
  const pileTypes = useAppStore(s => s.pileTypes);

  if (!pendingPile) return null;

  const selectedPileType = pendingPile.pileTypeId
    ? pileTypes.find(pt => pt.id === pendingPile.pileTypeId)
    : undefined;

  // Group pile types by method for the dropdown
  const methodGroups = new Map<string, PileTypeDefinition[]>();
  for (const pt of pileTypes) {
    const list = methodGroups.get(pt.method) || [];
    list.push(pt);
    methodGroups.set(pt.method, list);
  }

  return (
    <div className="p-3 border-b border-cad-border">
      <div className="flex items-center gap-2 mb-3">
        <span className="text-xs font-semibold text-cad-accent uppercase tracking-wide">Pile Tool</span>
      </div>

      <PropertyGroup label="Pile Type">
        <div className="mb-2">
          <label className={labelClass}>Type</label>
          <select
            value={pendingPile.pileTypeId || ''}
            onChange={(e) => {
              const typeId = e.target.value || undefined;
              const pt = typeId ? pileTypes.find(p => p.id === typeId) : undefined;
              setPendingPile({
                ...pendingPile,
                pileTypeId: typeId,
                diameter: pt ? pt.defaultDiameter : pendingPile.diameter,
                contourType: pt ? (pt.shape === 'round' ? 'circle' : 'square') : pendingPile.contourType,
              });
            }}
            className={inputClass}
          >
            <option value="">(Custom)</option>
            {[...methodGroups.entries()].map(([method, types]) => (
              <optgroup key={method} label={method}>
                {types.map(pt => (
                  <option key={pt.id} value={pt.id}>
                    {pt.name} ({pt.shape === 'round' ? '\u00D8' : '\u25A1'}{pt.defaultDiameter}mm)
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </div>
        {selectedPileType && (
          <div className="text-[10px] text-cad-text-dim mb-2 px-1">
            {selectedPileType.shape === 'round' ? 'Rond' : 'Vierkant'} | {selectedPileType.method} | IFC: {selectedPileType.ifcPredefinedType}
            {selectedPileType.description && <div className="mt-0.5">{selectedPileType.description}</div>}
          </div>
        )}
      </PropertyGroup>

      <PropertyGroup label="Symbol">
        <PileSymbolPicker
          contourType={pendingPile.contourType}
          fillPattern={pendingPile.fillPattern}
          onChange={(ct, fp) => setPendingPile({ ...pendingPile, contourType: ct, fillPattern: fp })}
        />
      </PropertyGroup>

      <PropertyGroup label="Properties">
        <TextField
          label="Label"
          value={pendingPile.label}
          onChange={(v) => setPendingPile({ ...pendingPile, label: v })}
          placeholder="P1, P2..."
        />
        <NumberField
          label="Diameter (mm)"
          value={pendingPile.diameter}
          onChange={(v) => setPendingPile({ ...pendingPile, diameter: v })}
          step={50}
          min={100}
          disabled={!!pendingPile.pileTypeId}
        />
        <NumberField
          label="Font Size (mm)"
          value={pendingPile.fontSize}
          onChange={(v) => setPendingPile({ ...pendingPile, fontSize: v })}
          step={25}
          min={50}
        />
        <CheckboxField
          label="Show Cross"
          value={pendingPile.showCross}
          onChange={(v) => setPendingPile({ ...pendingPile, showCross: v })}
        />
      </PropertyGroup>
    </div>
  );
}

/** Column tool properties - edits pendingColumn state */
export function ColumnToolProperties() {
  const pendingColumn = useAppStore(s => s.pendingColumn);
  const setPendingColumn = useAppStore(s => s.setPendingColumn);

  if (!pendingColumn) return null;

  return (
    <div className="p-3 border-b border-cad-border">
      <div className="flex items-center gap-2 mb-3">
        <span className="text-xs font-semibold text-cad-accent uppercase tracking-wide">Column Tool</span>
      </div>

      <PropertyGroup label="Properties">
        <SelectField<ColumnMaterial>
          label="Material"
          value={pendingColumn.material}
          options={[
            { value: 'concrete', label: 'Concrete' },
            { value: 'steel', label: 'Steel' },
            { value: 'timber', label: 'Timber' },
          ]}
          onChange={(v) => setPendingColumn({ ...pendingColumn, material: v })}
        />
        <NumberField
          label="Width (mm)"
          value={pendingColumn.width}
          onChange={(v) => setPendingColumn({ ...pendingColumn, width: v })}
          step={10}
          min={50}
        />
        <NumberField
          label="Depth (mm)"
          value={pendingColumn.depth}
          onChange={(v) => setPendingColumn({ ...pendingColumn, depth: v })}
          step={10}
          min={50}
        />
        <NumberField
          label="Rotation (&deg;)"
          value={pendingColumn.rotation * RAD2DEG}
          onChange={(v) => setPendingColumn({ ...pendingColumn, rotation: v * DEG2RAD })}
          step={5}
        />
      </PropertyGroup>

      <PropertyGroup label="Constraints">
        {(() => {
          const ps = useAppStore.getState().projectStructure;
          const allStoreys: { id: string; name: string; elevation: number }[] = [];
          for (const building of ps.buildings) {
            for (const storey of building.storeys) {
              allStoreys.push(storey);
            }
          }
          allStoreys.sort((a, b) => a.elevation - b.elevation);
          return (
            <>
              <div className="mb-2">
                <label className={labelClass}>Base Storey</label>
                <select
                  className={inputClass}
                  value={pendingColumn.baseLevel || ''}
                  onChange={(e) => setPendingColumn({ ...pendingColumn, baseLevel: e.target.value || undefined })}
                >
                  <option value="">(Unconnected)</option>
                  {allStoreys.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} ({s.elevation >= 0 ? '+' : ''}{s.elevation} mm)
                    </option>
                  ))}
                </select>
              </div>
              <NumberField
                label="Base Offset (mm)"
                value={pendingColumn.baseOffset ?? 0}
                onChange={(v) => setPendingColumn({ ...pendingColumn, baseOffset: v })}
                step={10}
              />
              <div className="mb-2">
                <label className={labelClass}>Top Storey</label>
                <select
                  className={inputClass}
                  value={pendingColumn.topLevel || ''}
                  onChange={(e) => setPendingColumn({ ...pendingColumn, topLevel: e.target.value || undefined })}
                >
                  <option value="">(Unconnected)</option>
                  {allStoreys.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} ({s.elevation >= 0 ? '+' : ''}{s.elevation} mm)
                    </option>
                  ))}
                </select>
              </div>
              <NumberField
                label="Top Offset (mm)"
                value={pendingColumn.topOffset ?? 0}
                onChange={(v) => setPendingColumn({ ...pendingColumn, topOffset: v })}
                step={10}
              />
            </>
          );
        })()}
      </PropertyGroup>
    </div>
  );
}

/** CPT tool properties - edits pendingCPT state */
export function CPTToolProperties() {
  const pendingCPT = useAppStore(s => s.pendingCPT);
  const setPendingCPT = useAppStore(s => s.setPendingCPT);

  if (!pendingCPT) return null;

  return (
    <div className="p-3 border-b border-cad-border">
      <div className="flex items-center gap-2 mb-3">
        <span className="text-xs font-semibold text-cad-accent uppercase tracking-wide">CPT Tool</span>
      </div>

      <PropertyGroup label="Properties">
        <TextField
          label="Name"
          value={pendingCPT.name}
          onChange={(v) => setPendingCPT({ ...pendingCPT, name: v })}
          placeholder="01, 02..."
        />
        <NumberField
          label="Marker Size (mm)"
          value={pendingCPT.markerSize}
          onChange={(v) => setPendingCPT({ ...pendingCPT, markerSize: v })}
          step={50}
          min={100}
        />
        <NumberField
          label="Font Size (mm)"
          value={pendingCPT.fontSize}
          onChange={(v) => setPendingCPT({ ...pendingCPT, fontSize: v })}
          step={25}
          min={50}
        />
        <CheckboxField label="Kleefmeting" value={pendingCPT.kleefmeting ?? false} onChange={(v) => setPendingCPT({ ...pendingCPT, kleefmeting: v })} />
        <CheckboxField label="Waterspanning" value={pendingCPT.waterspanning ?? false} onChange={(v) => setPendingCPT({ ...pendingCPT, waterspanning: v })} />
        <CheckboxField label="Uitgevoerd" value={pendingCPT.uitgevoerd ?? false} onChange={(v) => setPendingCPT({ ...pendingCPT, uitgevoerd: v })} />
      </PropertyGroup>
    </div>
  );
}

/** Section Callout tool properties - edits pendingSectionCallout state */
export function SectionCalloutToolProperties() {
  const pendingSectionCallout = useAppStore(s => s.pendingSectionCallout);
  const setPendingSectionCallout = useAppStore(s => s.setPendingSectionCallout);

  if (!pendingSectionCallout) return null;

  return (
    <div className="p-3 border-b border-cad-border">
      <div className="flex items-center gap-2 mb-3">
        <span className="text-xs font-semibold text-cad-accent uppercase tracking-wide">Section Callout Tool</span>
      </div>

      <PropertyGroup label="Properties">
        <TextField
          label="Label"
          value={pendingSectionCallout.label}
          onChange={(v) => setPendingSectionCallout({ ...pendingSectionCallout, label: v })}
          placeholder="A, B, 1..."
        />
        <NumberField
          label="Bubble Radius (mm)"
          value={pendingSectionCallout.bubbleRadius}
          onChange={(v) => setPendingSectionCallout({ ...pendingSectionCallout, bubbleRadius: v })}
          step={25}
          min={50}
        />
        <NumberField
          label="Font Size (mm)"
          value={pendingSectionCallout.fontSize}
          onChange={(v) => setPendingSectionCallout({ ...pendingSectionCallout, fontSize: v })}
          step={25}
          min={50}
        />
        <CheckboxField
          label="Flip Direction"
          value={pendingSectionCallout.flipDirection}
          onChange={(v) => setPendingSectionCallout({ ...pendingSectionCallout, flipDirection: v })}
        />
        <CheckboxField
          label="Show Start Head"
          value={!pendingSectionCallout.hideStartHead}
          onChange={(v) => setPendingSectionCallout({ ...pendingSectionCallout, hideStartHead: !v })}
        />
        <CheckboxField
          label="Show End Head"
          value={!pendingSectionCallout.hideEndHead}
          onChange={(v) => setPendingSectionCallout({ ...pendingSectionCallout, hideEndHead: !v })}
        />
        <NumberField
          label="View Depth (mm)"
          value={pendingSectionCallout.viewDepth}
          onChange={(v) => setPendingSectionCallout({ ...pendingSectionCallout, viewDepth: v })}
          step={500}
          min={0}
        />
      </PropertyGroup>
    </div>
  );
}

/** Line tool properties - edits currentStyle (stroke color, width, lineStyle) and active layer */
export function LineToolProperties() {
  const currentStyle = useAppStore(s => s.currentStyle);
  const setCurrentStyle = useAppStore(s => s.setCurrentStyle);
  const layers = useAppStore(s => s.layers);
  const activeLayerId = useAppStore(s => s.activeLayerId);
  const activeDrawingId = useAppStore(s => s.activeDrawingId);
  const setActiveLayer = useAppStore(s => s.setActiveLayer);

  // Filter layers to current drawing only
  const drawingLayers = layers.filter(l => l.drawingId === activeDrawingId);

  return (
    <div className="p-3 border-b border-cad-border">
      <div className="flex items-center gap-2 mb-3">
        <span className="text-xs font-semibold text-cad-accent uppercase tracking-wide">Line Tool</span>
      </div>

      <PropertyGroup label="Style">
        <ColorPalette
          label="Color"
          value={currentStyle.strokeColor}
          onChange={(v) => setCurrentStyle({ strokeColor: v })}
        />
        <LineweightInput
          value={currentStyle.strokeWidth}
          onChange={(v) => setCurrentStyle({ strokeWidth: v })}
        />
        <SelectField<LineStyle>
          label="Line Style"
          value={currentStyle.lineStyle}
          options={[
            { value: 'solid', label: 'Solid' },
            { value: 'dashed', label: 'Dashed' },
            { value: 'dotted', label: 'Dotted' },
            { value: 'dashdot', label: 'Dash-Dot' },
          ]}
          onChange={(v) => setCurrentStyle({ lineStyle: v })}
        />
      </PropertyGroup>

      <PropertyGroup label="Layer">
        <div className="mb-2">
          <label className={labelClass}>Active Layer</label>
          <select
            value={activeLayerId}
            onChange={(e) => setActiveLayer(e.target.value)}
            className={inputClass}
          >
            {drawingLayers.map(l => (
              <option key={l.id} value={l.id}>
                {l.name}{l.locked ? ' (locked)' : ''}
              </option>
            ))}
          </select>
        </div>
      </PropertyGroup>
    </div>
  );
}

/** Plate System tool properties - edits pendingPlateSystem state */
export function PlateSystemToolProperties() {
  const pendingPlateSystem = useAppStore(s => s.pendingPlateSystem);
  const setPendingPlateSystem = useAppStore(s => s.setPendingPlateSystem);

  // Profile picker dialog state
  const [profilePickerTarget, setProfilePickerTarget] = useState<'main' | 'edge' | null>(null);

  if (!pendingPlateSystem) return null;

  const SYSTEM_TYPE_LABELS: Record<string, string> = {
    'timber-floor': 'Timber Floor',
    'hsb-wall': 'HSB Wall',
    'ceiling': 'Ceiling',
    'custom': 'Custom',
  };

  return (
    <div className="p-3 border-b border-cad-border">
      <div className="flex items-center gap-2 mb-3">
        <span className="text-xs font-semibold text-cad-accent uppercase tracking-wide">Plate System</span>
      </div>

      <PropertyGroup label="System">
        <div className="mb-2 p-2 bg-cad-bg rounded border border-cad-border text-xs text-cad-text-dim">
          {SYSTEM_TYPE_LABELS[pendingPlateSystem.systemType] || pendingPlateSystem.systemType}
        </div>
        <TextField
          label="Name"
          value={pendingPlateSystem.name || ''}
          onChange={(v) => setPendingPlateSystem({ ...pendingPlateSystem, name: v || undefined })}
        />
      </PropertyGroup>

      <PropertyGroup label="Main Profile">
        <div className="mb-2 flex items-center gap-1">
          {pendingPlateSystem.mainProfileId ? (() => {
            const profilePreset = getPresetById(pendingPlateSystem.mainProfileId!);
            return profilePreset ? (
              <div className="flex-1 p-2 bg-cad-bg rounded border border-cad-border text-xs">
                <span className="text-cad-text-dim">Profile: </span>
                <span className="text-cad-text font-semibold">{profilePreset.name}</span>
                <span className="text-cad-text-dim ml-1">({profilePreset.standard})</span>
              </div>
            ) : null;
          })() : (
            <div className="flex-1 p-2 bg-cad-bg rounded border border-cad-border text-xs text-cad-text-dim">
              No profile selected
            </div>
          )}
          <button
            onClick={() => setProfilePickerTarget('main')}
            className="flex-shrink-0 w-7 h-7 flex items-center justify-center bg-cad-accent/10 hover:bg-cad-accent/20 border border-cad-accent/30 rounded text-cad-accent text-sm font-bold"
            title="Browse profiles"
          >
            +
          </button>
        </div>
        <NumberField
          label="Width (mm)"
          value={pendingPlateSystem.mainWidth}
          onChange={(v) => setPendingPlateSystem({ ...pendingPlateSystem, mainWidth: v })}
          step={5} min={10}
        />
        <NumberField
          label="Height (mm)"
          value={pendingPlateSystem.mainHeight}
          onChange={(v) => setPendingPlateSystem({ ...pendingPlateSystem, mainHeight: v })}
          step={5} min={10}
        />
        <NumberField
          label="Spacing h.o.h. (mm)"
          value={pendingPlateSystem.mainSpacing}
          onChange={(v) => setPendingPlateSystem({ ...pendingPlateSystem, mainSpacing: v })}
          step={50} min={50}
        />
        <NumberField
          label="Direction (deg)"
          value={pendingPlateSystem.mainDirection * (180 / Math.PI)}
          onChange={(v) => setPendingPlateSystem({ ...pendingPlateSystem, mainDirection: v * (Math.PI / 180) })}
          step={15}
        />
      </PropertyGroup>

      {pendingPlateSystem.edgeProfileId !== undefined && (
        <PropertyGroup label="Edge Profile">
          <div className="mb-2 flex items-center gap-1">
            {pendingPlateSystem.edgeProfileId ? (() => {
              const edgePreset = getPresetById(pendingPlateSystem.edgeProfileId!);
              return edgePreset ? (
                <div className="flex-1 p-2 bg-cad-bg rounded border border-cad-border text-xs">
                  <span className="text-cad-text-dim">Profile: </span>
                  <span className="text-cad-text font-semibold">{edgePreset.name}</span>
                  <span className="text-cad-text-dim ml-1">({edgePreset.standard})</span>
                </div>
              ) : null;
            })() : (
              <div className="flex-1 p-2 bg-cad-bg rounded border border-cad-border text-xs text-cad-text-dim">
                No edge profile selected
              </div>
            )}
            <button
              onClick={() => setProfilePickerTarget('edge')}
              className="flex-shrink-0 w-7 h-7 flex items-center justify-center bg-cad-accent/10 hover:bg-cad-accent/20 border border-cad-accent/30 rounded text-cad-accent text-sm font-bold"
              title="Browse edge profiles"
            >
              +
            </button>
          </div>
        </PropertyGroup>
      )}

      {/* Profile picker dialog (SectionDialog) for browsing profiles */}
      <SectionDialog
        isOpen={profilePickerTarget !== null}
        onClose={() => setProfilePickerTarget(null)}
        onInsert={(_profileType: ProfileType, _parameters: ParameterValues, presetId?: string) => {
          if (!presetId || !pendingPlateSystem) {
            setProfilePickerTarget(null);
            return;
          }
          const preset = getPresetById(presetId);
          if (!preset) {
            setProfilePickerTarget(null);
            return;
          }
          const params = preset.parameters;
          const height = typeof params.height === 'number' ? params.height : undefined;
          let width: number | undefined;
          if (typeof params.width === 'number') width = params.width;
          else if (typeof params.flangeWidth === 'number') width = params.flangeWidth as number;

          if (profilePickerTarget === 'main') {
            setPendingPlateSystem({
              ...pendingPlateSystem,
              mainProfileId: presetId,
              ...(width !== undefined ? { mainWidth: width } : {}),
              ...(height !== undefined ? { mainHeight: height } : {}),
            });
          } else if (profilePickerTarget === 'edge') {
            setPendingPlateSystem({
              ...pendingPlateSystem,
              edgeProfileId: presetId,
              ...(width !== undefined ? { edgeWidth: width } : {}),
              ...(height !== undefined ? { edgeHeight: height } : {}),
            });
          }
          setProfilePickerTarget(null);
        }}
      />
    </div>
  );
}

export function ArrayToolProperties() {
  const arrayMode = useAppStore(s => s.arrayMode);
  const setArrayMode = useAppStore(s => s.setArrayMode);
  const arrayCount = useAppStore(s => s.arrayCount);
  const setArrayCount = useAppStore(s => s.setArrayCount);
  const arrayAngle = useAppStore(s => s.arrayAngle);
  const setArrayAngle = useAppStore(s => s.setArrayAngle);
  const arrayMaintainRelation = useAppStore(s => s.arrayMaintainRelation);
  const setArrayMaintainRelation = useAppStore(s => s.setArrayMaintainRelation);

  return (
    <div className="p-3 border-b border-cad-border">
      <PropertyGroup label="Array">
        <div className="mb-3">
          <label className={labelClass}>Type</label>
          <select
            value={arrayMode}
            onChange={(e) => setArrayMode(e.target.value as 'linear' | 'radial')}
            className={inputClass}
          >
            <option value="linear">Linear</option>
            <option value="radial">Radial</option>
          </select>
        </div>
        <div className="mb-3">
          <label className={labelClass}>Count (incl. original)</label>
          <input
            type="number"
            min={2}
            max={100}
            value={arrayCount}
            onChange={(e) => {
              const v = parseInt(e.target.value, 10);
              if (!isNaN(v) && v >= 2) setArrayCount(v);
            }}
            className={inputClass}
          />
        </div>
        {arrayMode === 'radial' && (
          <div className="mb-3">
            <label className={labelClass}>Total Angle (deg)</label>
            <input
              type="number"
              min={1}
              max={360}
              value={arrayAngle}
              onChange={(e) => {
                const v = parseFloat(e.target.value);
                if (!isNaN(v) && v > 0) setArrayAngle(v);
              }}
              className={inputClass}
            />
          </div>
        )}
        <CheckboxField
          label="Maintain relation"
          value={arrayMaintainRelation}
          onChange={setArrayMaintainRelation}
        />
      </PropertyGroup>
      <div className="text-[10px] text-cad-text-dim px-1 py-1">
        {arrayMode === 'linear'
          ? 'Select elements, click base point, then click end point. Copies distribute evenly between base and end. Hold Shift to constrain to X/Y axis.'
          : 'Select elements, click center point, then click to confirm. Copies distribute around the center.'}
      </div>
    </div>
  );
}

export function HatchToolProperties() {
  const hatchPatternType = useAppStore(s => s.hatchPatternType);
  const setHatchPatternType = useAppStore(s => s.setHatchPatternType);
  const hatchCustomPatternId = useAppStore(s => s.hatchCustomPatternId);
  const setHatchCustomPatternId = useAppStore(s => s.setHatchCustomPatternId);
  const hatchPatternAngle = useAppStore(s => s.hatchPatternAngle);
  const setHatchPatternAngle = useAppStore(s => s.setHatchPatternAngle);
  const hatchPatternScale = useAppStore(s => s.hatchPatternScale);
  const setHatchPatternScale = useAppStore(s => s.setHatchPatternScale);
  const hatchFillColor = useAppStore(s => s.hatchFillColor);
  const setHatchFillColor = useAppStore(s => s.setHatchFillColor);
  const hatchBackgroundColor = useAppStore(s => s.hatchBackgroundColor);
  const setHatchBackgroundColor = useAppStore(s => s.setHatchBackgroundColor);

  return (
    <div className="p-3 border-b border-cad-border">
      <PropertyGroup label="Foreground Pattern">
        <PatternPickerPanel
          value={hatchPatternType}
          customPatternId={hatchCustomPatternId ?? undefined}
          onChange={(type, customId) => {
            setHatchPatternType(type);
            setHatchCustomPatternId(customId ?? null);
          }}
        />
        <NumberField label="Angle (deg)" value={hatchPatternAngle} onChange={setHatchPatternAngle} step={15} />
        <NumberField label="Scale" value={hatchPatternScale} onChange={setHatchPatternScale} step={0.1} min={0.1} />
        <ColorPalette label="Color" value={hatchFillColor} onChange={setHatchFillColor} />
      </PropertyGroup>
      <PropertyGroup label="Display" defaultOpen={false}>
        <ColorPalette label="Background Color" value={hatchBackgroundColor ?? '#000000'} onChange={setHatchBackgroundColor} />
        {hatchBackgroundColor && (
          <button
            onClick={() => setHatchBackgroundColor(null)}
            className="text-xs text-cad-accent hover:underline -mt-1 mb-2">
            Clear background color
          </button>
        )}
      </PropertyGroup>
    </div>
  );
}

/** Renders the appropriate tool-specific panel based on active tool */
export function ActiveToolProperties({ activeTool }: { activeTool: string }) {
  switch (activeTool) {
    case 'line':
      return <LineToolProperties />;
    case 'wall':
      return <WallToolProperties />;
    case 'beam':
      return <BeamToolProperties />;
    case 'slab':
      return <SlabToolProperties />;
    case 'slab-label':
      return <SlabLabelToolProperties />;
    case 'gridline':
      return <GridlineToolProperties />;
    case 'level':
      return <LevelToolProperties />;
    case 'puntniveau':
      return <PuntniveauToolProperties />;
    case 'pile':
      return <PileToolProperties />;
    case 'column':
      return <ColumnToolProperties />;
    case 'cpt':
      return <CPTToolProperties />;
    case 'section-callout':
      return <SectionCalloutToolProperties />;
    case 'space':
      return <SpaceToolProperties />;
    case 'plate-system':
      return <PlateSystemToolProperties />;
    case 'hatch':
      return <HatchToolProperties />;
    case 'array':
      return <ArrayToolProperties />;
    default:
      return null;
  }
}
