/**
 * PatternEditorDialog - Dialog for creating/editing custom hatch patterns
 */

import { useState, useEffect, useMemo } from 'react';
import { Plus } from 'lucide-react';
import { DraggableModal, ModalButton } from '../../shared/DraggableModal';
import { PatternPreview } from './PatternPreview';
import { LineFamilyEditor, createDefaultLineFamily } from './LineFamilyEditor';
import type { CustomHatchPattern, LineFamily, HatchPatternScaleType, PatternCategory } from '../../../types/hatch';
import { BUILTIN_PATTERNS } from '../../../types/hatch';

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
  const [category, setCategory] = useState<PatternCategory>('custom');

  // Preview state
  const [previewScale, setPreviewScale] = useState(1);
  const [previewBg, setPreviewBg] = useState<'dark' | 'light' | 'transparent'>('dark');

  // Initialize form when pattern changes or dialog opens
  useEffect(() => {
    if (isOpen) {
      if (pattern) {
        setName(pattern.name);
        setDescription(pattern.description || '');
        setScaleType(pattern.scaleType);
        setLineFamilies([...pattern.lineFamilies]);
        setCategory(pattern.category || 'custom');
      } else {
        // New pattern defaults
        setName('New Pattern');
        setDescription('');
        setScaleType('drafting');
        setLineFamilies([createDefaultLineFamily()]);
        setCategory('custom');
      }
      setPreviewScale(1);
      setPreviewBg('light');
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
      category,
    });
    onClose();
  };

  // Template gallery: use built-in patterns as starting points
  const templatePatterns = useMemo(() => {
    // Pick representative patterns from each category as templates
    const templateIds = [
      'diagonal', 'crosshatch', 'horizontal', 'vertical',
      'brick-running', 'concrete', 'insulation', 'steel-section',
      'herringbone', 'diamonds', 'basket-weave', 'earth',
    ];
    return templateIds
      .map(id => BUILTIN_PATTERNS.find(p => p.id === id))
      .filter((p): p is CustomHatchPattern => !!p);
  }, []);

  const applyTemplate = (template: CustomHatchPattern) => {
    setLineFamilies([...template.lineFamilies]);
    if (!pattern) {
      // Only update name/category when creating new pattern
      setName(template.name + ' (Custom)');
      if (template.category) setCategory(template.category);
    }
  };

  const previewBgColor = previewBg === 'dark' ? '#1a1a2e' : previewBg === 'light' ? '#f8f8f8' : undefined;
  const previewLineColor = previewBg === 'dark' ? '#ffffff' : '#333333';

  return (
    <DraggableModal
      isOpen={isOpen}
      onClose={onClose}
      title={title || (pattern ? 'Edit Pattern' : 'New Pattern')}
      width={800}
      height={620}
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
            <div className="grid grid-cols-2 gap-3">
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
                  Category
                </label>
                <select
                  value={category}
                  onChange={(e) => setCategory(e.target.value as PatternCategory)}
                  className="w-full px-2 py-1.5 text-sm bg-cad-input border border-cad-border rounded focus:outline-none focus:border-cad-accent"
                >
                  <option value="basic">Basic</option>
                  <option value="hatching">Hatching</option>
                  <option value="material">Material</option>
                  <option value="geometric">Geometric</option>
                  <option value="custom">Custom</option>
                </select>
              </div>
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

          {/* Template Gallery */}
          <div className="mb-4 pb-4 border-b border-cad-border">
            <label className="text-[10px] text-cad-text-dim uppercase tracking-wide block mb-2">
              Start from Template
            </label>
            <div className="grid grid-cols-6 gap-1">
              {templatePatterns.map(tmpl => (
                <button
                  key={tmpl.id}
                  onClick={() => applyTemplate(tmpl)}
                  className="flex flex-col items-center p-1 rounded border border-cad-border hover:border-cad-accent hover:bg-cad-hover transition-colors group"
                  title={tmpl.name}
                >
                  <PatternPreview pattern={tmpl} width={36} height={28} />
                  <span className="text-[8px] text-cad-text-dim group-hover:text-cad-accent mt-0.5 truncate w-full text-center">
                    {tmpl.name}
                  </span>
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
        <div className="w-72 p-4 flex flex-col">
          <label className="text-[10px] text-cad-text-dim uppercase tracking-wide block mb-2">
            Live Preview
          </label>

          <div
            className="flex items-center justify-center rounded border border-cad-border mb-3"
            style={{
              backgroundColor: previewBgColor,
              backgroundImage: previewBg === 'transparent'
                ? 'repeating-conic-gradient(#808080 0% 25%, transparent 0% 50%)'
                : undefined,
              backgroundSize: previewBg === 'transparent' ? '8px 8px' : undefined,
            }}
          >
            <PatternPreview
              pattern={previewPattern}
              width={240}
              height={240}
              scale={previewScale}
              lineColor={previewLineColor}
              backgroundColor="transparent"
            />
          </div>

          {/* Preview background toggle */}
          <div className="mb-3">
            <label className="text-[10px] text-cad-text-dim uppercase tracking-wide block mb-1">
              Preview Background
            </label>
            <div className="flex gap-1">
              {([
                { key: 'dark', label: 'Dark', color: '#1a1a2e' },
                { key: 'light', label: 'Light', color: '#ffffff' },
                { key: 'transparent', label: 'None', color: undefined },
              ] as const).map(opt => (
                <button
                  key={opt.key}
                  onClick={() => setPreviewBg(opt.key)}
                  className={`flex-1 px-2 py-0.5 text-[10px] rounded border transition-colors ${
                    previewBg === opt.key
                      ? 'bg-cad-accent border-cad-accent text-white'
                      : 'bg-cad-input border-cad-border hover:border-cad-text-dim'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
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
            <div>Lines: {lineFamilies.length} | Category: {category}</div>
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
