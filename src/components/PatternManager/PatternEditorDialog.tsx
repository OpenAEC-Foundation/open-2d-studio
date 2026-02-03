/**
 * PatternEditorDialog - Dialog for creating/editing custom hatch patterns
 */

import { useState, useEffect, useMemo } from 'react';
import { Plus } from 'lucide-react';
import { DraggableModal, ModalButton } from '../shared/DraggableModal';
import { PatternPreview } from './PatternPreview';
import { LineFamilyEditor, createDefaultLineFamily } from './LineFamilyEditor';
import type { CustomHatchPattern, LineFamily, HatchPatternScaleType } from '../../types/hatch';

interface PatternEditorDialogProps {
  isOpen: boolean;
  onClose: () => void;
  /** Pattern to edit (null for creating new) */
  pattern: CustomHatchPattern | null;
  /** Called when user saves the pattern */
  onSave: (pattern: Omit<CustomHatchPattern, 'id' | 'createdAt' | 'modifiedAt' | 'source'>) => void;
  /** Title override */
  title?: string;
}

export function PatternEditorDialog({
  isOpen,
  onClose,
  pattern,
  onSave,
  title,
}: PatternEditorDialogProps) {
  // Form state
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [scaleType, setScaleType] = useState<HatchPatternScaleType>('drafting');
  const [lineFamilies, setLineFamilies] = useState<LineFamily[]>([]);

  // Preview scale
  const [previewScale, setPreviewScale] = useState(1);

  // Initialize form when pattern changes or dialog opens
  useEffect(() => {
    if (isOpen) {
      if (pattern) {
        setName(pattern.name);
        setDescription(pattern.description || '');
        setScaleType(pattern.scaleType);
        setLineFamilies([...pattern.lineFamilies]);
      } else {
        // New pattern defaults
        setName('New Pattern');
        setDescription('');
        setScaleType('drafting');
        setLineFamilies([createDefaultLineFamily()]);
      }
      setPreviewScale(1);
    }
  }, [isOpen, pattern]);

  // Create a preview pattern object
  const previewPattern = useMemo((): CustomHatchPattern => ({
    id: 'preview',
    name,
    description,
    scaleType,
    source: 'user',
    lineFamilies,
  }), [name, description, scaleType, lineFamilies]);

  // Validation
  const isValid = useMemo(() => {
    return name.trim().length > 0;
  }, [name]);

  // Handlers
  const handleLineFamilyChange = (index: number, updated: LineFamily) => {
    setLineFamilies(prev => {
      const next = [...prev];
      next[index] = updated;
      return next;
    });
  };

  const handleLineFamilyDelete = (index: number) => {
    setLineFamilies(prev => prev.filter((_, i) => i !== index));
  };

  const handleLineFamilyMoveUp = (index: number) => {
    if (index <= 0) return;
    setLineFamilies(prev => {
      const next = [...prev];
      [next[index - 1], next[index]] = [next[index], next[index - 1]];
      return next;
    });
  };

  const handleLineFamilyMoveDown = (index: number) => {
    if (index >= lineFamilies.length - 1) return;
    setLineFamilies(prev => {
      const next = [...prev];
      [next[index], next[index + 1]] = [next[index + 1], next[index]];
      return next;
    });
  };

  const handleAddLineFamily = () => {
    setLineFamilies(prev => [...prev, createDefaultLineFamily()]);
  };

  const handleSave = () => {
    if (!isValid) return;

    onSave({
      name: name.trim(),
      description: description.trim() || undefined,
      scaleType,
      lineFamilies,
    });
    onClose();
  };

  // Preset patterns
  const applyPreset = (preset: 'diagonal' | 'crosshatch' | 'horizontal' | 'vertical' | 'brick') => {
    switch (preset) {
      case 'diagonal':
        setLineFamilies([{ angle: 45, originX: 0, originY: 0, deltaX: 0, deltaY: 10 }]);
        break;
      case 'crosshatch':
        setLineFamilies([
          { angle: 45, originX: 0, originY: 0, deltaX: 0, deltaY: 10 },
          { angle: -45, originX: 0, originY: 0, deltaX: 0, deltaY: 10 },
        ]);
        break;
      case 'horizontal':
        setLineFamilies([{ angle: 0, originX: 0, originY: 0, deltaX: 0, deltaY: 10 }]);
        break;
      case 'vertical':
        setLineFamilies([{ angle: 90, originX: 0, originY: 0, deltaX: 0, deltaY: 10 }]);
        break;
      case 'brick':
        setLineFamilies([
          { angle: 0, originX: 0, originY: 0, deltaX: 0, deltaY: 20 },
          { angle: 90, originX: 0, originY: 0, deltaX: 20, deltaY: 40 },
        ]);
        break;
    }
  };

  return (
    <DraggableModal
      isOpen={isOpen}
      onClose={onClose}
      title={title || (pattern ? 'Edit Pattern' : 'New Pattern')}
      width={700}
      height={550}
      footer={
        <>
          <ModalButton onClick={onClose} variant="secondary">
            Cancel
          </ModalButton>
          <ModalButton onClick={handleSave} variant="primary" disabled={!isValid}>
            Save
          </ModalButton>
        </>
      }
    >
      <div className="flex h-full">
        {/* Left side - Form */}
        <div className="flex-1 p-4 overflow-y-auto border-r border-cad-border">
          {/* Basic info */}
          <div className="space-y-3 mb-4 pb-4 border-b border-cad-border">
            <div>
              <label className="text-[10px] text-cad-text-dim uppercase tracking-wide block mb-1">
                Pattern Name *
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full px-2 py-1.5 text-sm bg-cad-input border border-cad-border rounded focus:outline-none focus:border-cad-accent"
                placeholder="Enter pattern name"
              />
            </div>

            <div>
              <label className="text-[10px] text-cad-text-dim uppercase tracking-wide block mb-1">
                Description
              </label>
              <input
                type="text"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="w-full px-2 py-1.5 text-sm bg-cad-input border border-cad-border rounded focus:outline-none focus:border-cad-accent"
                placeholder="Optional description"
              />
            </div>

            <div>
              <label className="text-[10px] text-cad-text-dim uppercase tracking-wide block mb-1">
                Scale Type
              </label>
              <div className="flex gap-2">
                <button
                  onClick={() => setScaleType('drafting')}
                  className={`flex-1 px-3 py-1.5 text-xs rounded border transition-colors ${
                    scaleType === 'drafting'
                      ? 'bg-cad-accent border-cad-accent text-white'
                      : 'bg-cad-input border-cad-border hover:border-cad-text-dim'
                  }`}
                >
                  Drafting
                </button>
                <button
                  onClick={() => setScaleType('model')}
                  className={`flex-1 px-3 py-1.5 text-xs rounded border transition-colors ${
                    scaleType === 'model'
                      ? 'bg-cad-accent border-cad-accent text-white'
                      : 'bg-cad-input border-cad-border hover:border-cad-text-dim'
                  }`}
                >
                  Model
                </button>
              </div>
              <p className="text-[10px] text-cad-text-dim mt-1">
                {scaleType === 'drafting'
                  ? 'Pattern maintains constant appearance at all zoom levels'
                  : 'Pattern scales with geometry (real-world dimensions)'}
              </p>
            </div>
          </div>

          {/* Presets */}
          <div className="mb-4 pb-4 border-b border-cad-border">
            <label className="text-[10px] text-cad-text-dim uppercase tracking-wide block mb-2">
              Start from Preset
            </label>
            <div className="flex flex-wrap gap-1">
              {(['diagonal', 'crosshatch', 'horizontal', 'vertical', 'brick'] as const).map(preset => (
                <button
                  key={preset}
                  onClick={() => applyPreset(preset)}
                  className="px-2 py-1 text-[10px] bg-cad-input border border-cad-border rounded hover:border-cad-text-dim capitalize"
                >
                  {preset}
                </button>
              ))}
            </div>
          </div>

          {/* Line Families */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-[10px] text-cad-text-dim uppercase tracking-wide">
                Line Families ({lineFamilies.length})
              </label>
              <button
                onClick={handleAddLineFamily}
                className="flex items-center gap-1 px-2 py-0.5 text-[10px] bg-cad-accent text-white rounded hover:bg-cad-accent/80"
              >
                <Plus size={10} />
                Add Line
              </button>
            </div>

            {lineFamilies.length === 0 ? (
              <div className="text-center py-8 text-cad-text-dim text-xs">
                No line families. Add one to create a pattern.
                <br />
                (Empty = solid fill)
              </div>
            ) : (
              <div className="space-y-1">
                {lineFamilies.map((family, index) => (
                  <LineFamilyEditor
                    key={index}
                    family={family}
                    index={index}
                    onChange={(updated) => handleLineFamilyChange(index, updated)}
                    onDelete={() => handleLineFamilyDelete(index)}
                    onMoveUp={() => handleLineFamilyMoveUp(index)}
                    onMoveDown={() => handleLineFamilyMoveDown(index)}
                    canMoveUp={index > 0}
                    canMoveDown={index < lineFamilies.length - 1}
                  />
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Right side - Preview */}
        <div className="w-56 p-4 flex flex-col">
          <label className="text-[10px] text-cad-text-dim uppercase tracking-wide block mb-2">
            Live Preview
          </label>

          <div className="flex-1 flex items-center justify-center bg-cad-bg rounded border border-cad-border mb-3">
            <PatternPreview
              pattern={previewPattern}
              width={180}
              height={180}
              scale={previewScale}
            />
          </div>

          <div>
            <label className="text-[10px] text-cad-text-dim uppercase tracking-wide block mb-1">
              Preview Scale: {previewScale.toFixed(1)}x
            </label>
            <input
              type="range"
              min={0.5}
              max={3}
              step={0.1}
              value={previewScale}
              onChange={(e) => setPreviewScale(parseFloat(e.target.value))}
              className="w-full h-2 bg-cad-border rounded-lg appearance-none cursor-pointer accent-cad-accent"
            />
          </div>

          {/* Pattern info */}
          <div className="mt-4 pt-4 border-t border-cad-border text-[10px] text-cad-text-dim space-y-1">
            <div>Lines: {lineFamilies.length}</div>
            {lineFamilies.map((f, i) => (
              <div key={i} className="font-mono">
                #{i + 1}: {f.angle}°, sp={f.deltaY}
                {f.dashPattern?.length ? `, dash=[${f.dashPattern.join(',')}]` : ''}
              </div>
            ))}
          </div>
        </div>
      </div>
    </DraggableModal>
  );
}
