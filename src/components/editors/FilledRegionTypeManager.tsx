/**
 * FilledRegionTypeManager - Dialog for creating, editing, duplicating, and deleting
 * filled region types (named, reusable hatch pattern configurations).
 */

import { useState } from 'react';
import { Plus, Copy, Trash2, Edit, Layers } from 'lucide-react';
import { useAppStore } from '../../state/appStore';
import { DraggableModal } from '../shared/DraggableModal';
import { PatternPreview } from './PatternManager/PatternPreview';
import { PatternPickerPanel } from './PatternManager/PatternPickerPanel';
import type { FilledRegionType } from '../../types/filledRegion';
import type { HatchPatternType } from '../../types/geometry';
import type { CustomHatchPattern } from '../../types/hatch';
import { BUILTIN_PATTERNS } from '../../types/hatch';

/**
 * Resolve a HatchPatternType + optional customPatternId to a CustomHatchPattern for preview.
 */
function resolvePattern(
  patternType: HatchPatternType,
  customPatternId: string | undefined,
  getPatternById: (id: string) => CustomHatchPattern | undefined,
): CustomHatchPattern {
  // Try custom pattern first
  if (customPatternId) {
    const custom = getPatternById(customPatternId);
    if (custom) return custom;
  }
  // Fall back to built-in pattern by patternType name
  const builtin = BUILTIN_PATTERNS.find(p => p.id === patternType);
  if (builtin) return builtin;
  // Last resort: solid
  return BUILTIN_PATTERNS[0];
}

interface FilledRegionTypeManagerProps {
  isOpen: boolean;
  onClose: () => void;
}

const inputClass = 'w-full bg-cad-bg border border-cad-border rounded px-2 py-1 text-xs text-cad-text';
const labelClass = 'block text-xs text-cad-text-dim mb-1';

export function FilledRegionTypeManager({ isOpen, onClose }: FilledRegionTypeManagerProps) {
  const {
    filledRegionTypes,
    addFilledRegionType,
    updateFilledRegionType,
    deleteFilledRegionType,
    duplicateFilledRegionType,
  } = useAppStore();

  const [selectedTypeId, setSelectedTypeId] = useState<string | null>(null);
  const [editingType, setEditingType] = useState<Partial<FilledRegionType> | null>(null);
  const [isCreating, setIsCreating] = useState(false);

  const selectedType = selectedTypeId ? filledRegionTypes.find(t => t.id === selectedTypeId) : null;

  const handleCreate = () => {
    setIsCreating(true);
    setEditingType({
      name: 'New Type',
      fgPatternType: 'solid',
      fgPatternAngle: 0,
      fgPatternScale: 1,
      fgColor: '#ffffff',
      masking: true,
      lineWeight: 1,
    });
    setSelectedTypeId(null);
  };

  const handleEdit = (type: FilledRegionType) => {
    setIsCreating(false);
    setEditingType({ ...type });
    setSelectedTypeId(type.id);
  };

  const handleSave = () => {
    if (!editingType) return;

    if (isCreating) {
      const id = addFilledRegionType({
        name: editingType.name || 'Untitled',
        fgPatternType: editingType.fgPatternType || 'solid',
        fgPatternAngle: editingType.fgPatternAngle || 0,
        fgPatternScale: editingType.fgPatternScale || 1,
        fgColor: editingType.fgColor || '#ffffff',
        fgCustomPatternId: editingType.fgCustomPatternId,
        bgPatternType: editingType.bgPatternType,
        bgPatternAngle: editingType.bgPatternAngle,
        bgPatternScale: editingType.bgPatternScale,
        bgColor: editingType.bgColor,
        bgCustomPatternId: editingType.bgCustomPatternId,
        backgroundColor: editingType.backgroundColor,
        masking: editingType.masking ?? true,
        lineWeight: editingType.lineWeight || 1,
      });
      setSelectedTypeId(id);
    } else if (selectedTypeId) {
      updateFilledRegionType(selectedTypeId, {
        name: editingType.name,
        fgPatternType: editingType.fgPatternType,
        fgPatternAngle: editingType.fgPatternAngle,
        fgPatternScale: editingType.fgPatternScale,
        fgColor: editingType.fgColor,
        fgCustomPatternId: editingType.fgCustomPatternId,
        bgPatternType: editingType.bgPatternType,
        bgPatternAngle: editingType.bgPatternAngle,
        bgPatternScale: editingType.bgPatternScale,
        bgColor: editingType.bgColor,
        bgCustomPatternId: editingType.bgCustomPatternId,
        backgroundColor: editingType.backgroundColor,
        masking: editingType.masking,
        lineWeight: editingType.lineWeight,
      });
    }

    setEditingType(null);
    setIsCreating(false);
  };

  const handleCancel = () => {
    setEditingType(null);
    setIsCreating(false);
  };

  const handleDelete = (id: string) => {
    deleteFilledRegionType(id);
    if (selectedTypeId === id) {
      setSelectedTypeId(null);
      setEditingType(null);
    }
  };

  const handleDuplicate = (id: string) => {
    const newId = duplicateFilledRegionType(id);
    if (newId) setSelectedTypeId(newId);
  };

  if (!isOpen) return null;

  return (
    <DraggableModal
      isOpen={isOpen}
      onClose={onClose}
      title="Filled Region Types"
      icon={<Layers className="w-4 h-4" />}
      width={700}
      height={500}
    >
      <div className="flex h-full gap-3">
        {/* Left panel - Type list */}
        <div className="w-56 flex-shrink-0 flex flex-col border-r border-cad-border pr-3">
          <div className="flex items-center gap-1 mb-2">
            <button
              onClick={handleCreate}
              className="flex items-center gap-1 px-2 py-1 text-xs bg-cad-accent text-black rounded hover:brightness-110"
              title="Create new type"
            >
              <Plus className="w-3 h-3" /> New
            </button>
          </div>

          <div className="flex-1 overflow-y-auto space-y-1">
            {filledRegionTypes.map(type => (
              <TypeListItem
                key={type.id}
                type={type}
                isSelected={selectedTypeId === type.id}
                onClick={() => { setSelectedTypeId(type.id); setEditingType(null); setIsCreating(false); }}
                onEdit={() => handleEdit(type)}
                onDuplicate={() => handleDuplicate(type.id)}
                onDelete={() => handleDelete(type.id)}
              />
            ))}
          </div>
        </div>

        {/* Right panel - Type details / editor */}
        <div className="flex-1 overflow-y-auto">
          {editingType ? (
            <TypeEditor
              type={editingType}
              onChange={setEditingType}
              onSave={handleSave}
              onCancel={handleCancel}
              isCreating={isCreating}
            />
          ) : selectedType ? (
            <TypeDetails type={selectedType} onEdit={() => handleEdit(selectedType)} />
          ) : (
            <div className="flex items-center justify-center h-full text-xs text-cad-text-dim">
              Select a type or create a new one
            </div>
          )}
        </div>
      </div>
    </DraggableModal>
  );
}

// --- Sub-components ---

function TypeListItem({
  type,
  isSelected,
  onClick,
  onEdit,
  onDuplicate,
  onDelete,
}: {
  type: FilledRegionType;
  isSelected: boolean;
  onClick: () => void;
  onEdit: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  return (
    <div
      onClick={onClick}
      className={`flex items-center gap-2 px-2 py-1.5 rounded cursor-pointer text-xs group ${
        isSelected ? 'bg-cad-accent/20 text-cad-accent' : 'text-cad-text hover:bg-cad-hover'
      }`}
    >
      <PatternPreview
        pattern={resolvePattern(type.fgPatternType, type.fgCustomPatternId, useAppStore.getState().getPatternById)}
        lineColor={type.fgColor || '#888888'}
        backgroundColor={type.backgroundColor}
        width={32}
        height={24}
      />
      <span className="flex-1 truncate">{type.name}</span>
      <div className="hidden group-hover:flex items-center gap-0.5">
        <button onClick={(e) => { e.stopPropagation(); onEdit(); }} className="p-0.5 hover:text-cad-accent" title="Edit">
          <Edit className="w-3 h-3" />
        </button>
        <button onClick={(e) => { e.stopPropagation(); onDuplicate(); }} className="p-0.5 hover:text-cad-accent" title="Duplicate">
          <Copy className="w-3 h-3" />
        </button>
        <button onClick={(e) => { e.stopPropagation(); onDelete(); }} className="p-0.5 hover:text-red-400" title="Delete">
          <Trash2 className="w-3 h-3" />
        </button>
      </div>
    </div>
  );
}

function TypeDetails({ type, onEdit }: { type: FilledRegionType; onEdit: () => void }) {
  return (
    <div className="space-y-3 p-2">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-cad-text">{type.name}</h3>
        <button
          onClick={onEdit}
          className="flex items-center gap-1 px-2 py-1 text-xs bg-cad-hover text-cad-text rounded hover:bg-cad-accent/20"
        >
          <Edit className="w-3 h-3" /> Edit
        </button>
      </div>

      <div className="flex gap-4">
        <div>
          <div className="text-[10px] text-cad-text-dim mb-1">Foreground Pattern</div>
          <PatternPreview pattern={resolvePattern(type.fgPatternType, type.fgCustomPatternId, useAppStore.getState().getPatternById)} lineColor={type.fgColor || '#888888'} backgroundColor={type.backgroundColor} width={80} height={80} />
          <div className="text-[10px] text-cad-text-dim mt-1">
            {type.fgPatternType} | {type.fgPatternAngle}&deg; | &times;{type.fgPatternScale}
          </div>
        </div>
        {type.bgPatternType && (
          <div>
            <div className="text-[10px] text-cad-text-dim mb-1">Background Pattern</div>
            <PatternPreview pattern={resolvePattern(type.bgPatternType, type.bgCustomPatternId, useAppStore.getState().getPatternById)} lineColor={type.bgColor || '#888888'} backgroundColor={type.backgroundColor} width={80} height={80} />
            <div className="text-[10px] text-cad-text-dim mt-1">
              {type.bgPatternType} | {type.bgPatternAngle ?? 0}&deg; | &times;{type.bgPatternScale ?? 1}
            </div>
          </div>
        )}
      </div>

      <div className="text-xs text-cad-text-dim space-y-1">
        {type.backgroundColor && <div>Background Color: {type.backgroundColor}</div>}
        <div>Masking: {type.masking ? 'Opaque' : 'Transparent'}</div>
        <div>Line Weight: {type.lineWeight}</div>
      </div>
    </div>
  );
}

function TypeEditor({
  type,
  onChange,
  onSave,
  onCancel,
  isCreating,
}: {
  type: Partial<FilledRegionType>;
  onChange: (t: Partial<FilledRegionType>) => void;
  onSave: () => void;
  onCancel: () => void;
  isCreating: boolean;
}) {
  return (
    <div className="space-y-3 p-2">
      <h3 className="text-sm font-semibold text-cad-text">
        {isCreating ? 'Create New Type' : 'Edit Type'}
      </h3>

      <div>
        <label className={labelClass}>Name</label>
        <input
          type="text"
          value={type.name || ''}
          onChange={(e) => onChange({ ...type, name: e.target.value })}
          className={inputClass}
        />
      </div>

      <div>
        <div className="text-[10px] uppercase tracking-wider text-cad-text-dim font-semibold mb-1">Foreground Pattern</div>
        <PatternPickerPanel
          value={(type.fgPatternType || 'solid') as HatchPatternType}
          customPatternId={type.fgCustomPatternId}
          onChange={(pType, customId) => onChange({ ...type, fgPatternType: pType, fgCustomPatternId: customId })}
        />
        <div className="flex gap-2 mt-1">
          <div className="flex-1">
            <label className={labelClass}>Angle</label>
            <input type="number" step={15} value={type.fgPatternAngle ?? 0}
              onChange={(e) => onChange({ ...type, fgPatternAngle: parseFloat(e.target.value) || 0 })}
              className={inputClass} />
          </div>
          <div className="flex-1">
            <label className={labelClass}>Scale</label>
            <input type="number" step={0.1} min={0.1} value={type.fgPatternScale ?? 1}
              onChange={(e) => { const v = parseFloat(e.target.value); onChange({ ...type, fgPatternScale: isNaN(v) || v <= 0 ? 0.1 : v }); }}
              className={inputClass} />
          </div>
        </div>
        <div className="mt-1">
          <label className={labelClass}>Color</label>
          <input type="color" value={type.fgColor || '#ffffff'}
            onChange={(e) => onChange({ ...type, fgColor: e.target.value })}
            className="w-8 h-6 border border-cad-border rounded cursor-pointer" />
        </div>
      </div>

      <div>
        <div className="text-[10px] uppercase tracking-wider text-cad-text-dim font-semibold mb-1">Background Pattern</div>
        {type.bgPatternType ? (
          <>
            <PatternPickerPanel
              value={type.bgPatternType as HatchPatternType}
              customPatternId={type.bgCustomPatternId}
              onChange={(pType, customId) => onChange({ ...type, bgPatternType: pType, bgCustomPatternId: customId })}
            />
            <div className="flex gap-2 mt-1">
              <div className="flex-1">
                <label className={labelClass}>Angle</label>
                <input type="number" step={15} value={type.bgPatternAngle ?? 0}
                  onChange={(e) => onChange({ ...type, bgPatternAngle: parseFloat(e.target.value) || 0 })}
                  className={inputClass} />
              </div>
              <div className="flex-1">
                <label className={labelClass}>Scale</label>
                <input type="number" step={0.1} min={0.1} value={type.bgPatternScale ?? 1}
                  onChange={(e) => { const v = parseFloat(e.target.value); onChange({ ...type, bgPatternScale: isNaN(v) || v <= 0 ? 0.1 : v }); }}
                  className={inputClass} />
              </div>
            </div>
            <div className="mt-1">
              <label className={labelClass}>Color</label>
              <input type="color" value={type.bgColor || '#808080'}
                onChange={(e) => onChange({ ...type, bgColor: e.target.value })}
                className="w-8 h-6 border border-cad-border rounded cursor-pointer" />
            </div>
            <button
              onClick={() => onChange({ ...type, bgPatternType: undefined, bgPatternAngle: undefined, bgPatternScale: undefined, bgColor: undefined, bgCustomPatternId: undefined })}
              className="text-xs text-cad-accent hover:underline mt-1">
              Remove background pattern
            </button>
          </>
        ) : (
          <button
            onClick={() => onChange({ ...type, bgPatternType: 'solid', bgPatternAngle: 0, bgPatternScale: 1, bgColor: '#808080' })}
            className="text-xs text-cad-accent hover:underline">
            + Add background pattern
          </button>
        )}
      </div>

      <div>
        <div className="text-[10px] uppercase tracking-wider text-cad-text-dim font-semibold mb-1">Display</div>
        <div className="mb-2">
          <label className={labelClass}>Background Color</label>
          <div className="flex items-center gap-2">
            <input type="color" value={type.backgroundColor || '#000000'}
              onChange={(e) => onChange({ ...type, backgroundColor: e.target.value })}
              className="w-8 h-6 border border-cad-border rounded cursor-pointer" />
            {type.backgroundColor && (
              <button onClick={() => onChange({ ...type, backgroundColor: undefined })} className="text-xs text-cad-accent hover:underline">
                Clear
              </button>
            )}
          </div>
        </div>
        <div className="mb-2">
          <label className={labelClass}>Line Weight</label>
          <input type="number" step={0.5} min={0.5} max={10} value={type.lineWeight ?? 1}
            onChange={(e) => onChange({ ...type, lineWeight: parseFloat(e.target.value) || 1 })}
            className={inputClass} />
        </div>
        <label className="flex items-center gap-2 text-xs text-cad-text cursor-pointer">
          <input type="checkbox" checked={type.masking ?? true}
            onChange={(e) => onChange({ ...type, masking: e.target.checked })}
            className="rounded" />
          Opaque (hides elements behind)
        </label>
      </div>

      <div className="flex gap-2 pt-2 border-t border-cad-border">
        <button onClick={onSave} className="px-3 py-1 text-xs bg-cad-accent text-black rounded hover:brightness-110">
          {isCreating ? 'Create' : 'Save'}
        </button>
        <button onClick={onCancel} className="px-3 py-1 text-xs bg-cad-hover text-cad-text rounded hover:bg-cad-border">
          Cancel
        </button>
      </div>
    </div>
  );
}
