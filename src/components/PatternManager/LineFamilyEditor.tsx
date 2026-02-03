/**
 * LineFamilyEditor - Component for editing individual line family properties
 */

import { useState } from 'react';
import { Trash2, ChevronDown, ChevronUp, GripVertical } from 'lucide-react';
import type { LineFamily } from '../../types/hatch';

interface LineFamilyEditorProps {
  family: LineFamily;
  index: number;
  onChange: (updated: LineFamily) => void;
  onDelete: () => void;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  canMoveUp?: boolean;
  canMoveDown?: boolean;
}

export function LineFamilyEditor({
  family,
  index,
  onChange,
  onDelete,
  onMoveUp,
  onMoveDown,
  canMoveUp = false,
  canMoveDown = false,
}: LineFamilyEditorProps) {
  const [expanded, setExpanded] = useState(true);

  const handleChange = <K extends keyof LineFamily>(key: K, value: LineFamily[K]) => {
    onChange({ ...family, [key]: value });
  };

  const handleDashPatternChange = (value: string) => {
    if (!value.trim()) {
      handleChange('dashPattern', undefined);
      return;
    }

    // Parse comma-separated values
    const parts = value.split(',').map(s => s.trim());
    const numbers = parts.map(s => parseFloat(s)).filter(n => !isNaN(n));

    if (numbers.length > 0) {
      handleChange('dashPattern', numbers);
    }
  };

  const dashPatternString = family.dashPattern?.join(', ') || '';

  return (
    <div className="border border-cad-border rounded bg-cad-bg/50 mb-2">
      {/* Header */}
      <div className="flex items-center gap-1 px-2 py-1.5 bg-cad-surface border-b border-cad-border">
        <button
          className="p-0.5 hover:bg-cad-hover rounded cursor-grab"
          title="Drag to reorder"
        >
          <GripVertical size={12} className="text-cad-text-dim" />
        </button>

        <button
          onClick={() => setExpanded(!expanded)}
          className="p-0.5 hover:bg-cad-hover rounded"
        >
          {expanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
        </button>

        <span className="text-xs font-medium flex-1">
          Line {index + 1}: {family.angle}° @ {family.deltaY}px
        </span>

        <div className="flex items-center gap-0.5">
          <button
            onClick={onMoveUp}
            disabled={!canMoveUp}
            className="p-0.5 hover:bg-cad-hover rounded disabled:opacity-30 disabled:cursor-not-allowed"
            title="Move up"
          >
            <ChevronUp size={12} />
          </button>
          <button
            onClick={onMoveDown}
            disabled={!canMoveDown}
            className="p-0.5 hover:bg-cad-hover rounded disabled:opacity-30 disabled:cursor-not-allowed"
            title="Move down"
          >
            <ChevronDown size={12} />
          </button>
          <button
            onClick={onDelete}
            className="p-0.5 hover:bg-red-500/20 hover:text-red-400 rounded"
            title="Delete line family"
          >
            <Trash2 size={12} />
          </button>
        </div>
      </div>

      {/* Content */}
      {expanded && (
        <div className="p-3 space-y-3">
          {/* Row 1: Angle and Spacing */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[10px] text-cad-text-dim uppercase tracking-wide block mb-1">
                Angle (degrees)
              </label>
              <input
                type="number"
                value={family.angle}
                onChange={(e) => handleChange('angle', parseFloat(e.target.value) || 0)}
                className="w-full px-2 py-1 text-xs bg-cad-input border border-cad-border rounded focus:outline-none focus:border-cad-accent"
                step={15}
              />
            </div>
            <div>
              <label className="text-[10px] text-cad-text-dim uppercase tracking-wide block mb-1">
                Spacing (deltaY)
              </label>
              <input
                type="number"
                value={family.deltaY}
                onChange={(e) => handleChange('deltaY', parseFloat(e.target.value) || 1)}
                className="w-full px-2 py-1 text-xs bg-cad-input border border-cad-border rounded focus:outline-none focus:border-cad-accent"
                min={1}
                step={1}
              />
            </div>
          </div>

          {/* Row 2: Origin */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[10px] text-cad-text-dim uppercase tracking-wide block mb-1">
                Origin X
              </label>
              <input
                type="number"
                value={family.originX}
                onChange={(e) => handleChange('originX', parseFloat(e.target.value) || 0)}
                className="w-full px-2 py-1 text-xs bg-cad-input border border-cad-border rounded focus:outline-none focus:border-cad-accent"
                step={1}
              />
            </div>
            <div>
              <label className="text-[10px] text-cad-text-dim uppercase tracking-wide block mb-1">
                Origin Y
              </label>
              <input
                type="number"
                value={family.originY}
                onChange={(e) => handleChange('originY', parseFloat(e.target.value) || 0)}
                className="w-full px-2 py-1 text-xs bg-cad-input border border-cad-border rounded focus:outline-none focus:border-cad-accent"
                step={1}
              />
            </div>
          </div>

          {/* Row 3: Offset (stagger) */}
          <div>
            <label className="text-[10px] text-cad-text-dim uppercase tracking-wide block mb-1">
              Offset / Stagger (deltaX)
            </label>
            <input
              type="number"
              value={family.deltaX}
              onChange={(e) => handleChange('deltaX', parseFloat(e.target.value) || 0)}
              className="w-full px-2 py-1 text-xs bg-cad-input border border-cad-border rounded focus:outline-none focus:border-cad-accent"
              step={1}
            />
            <p className="text-[10px] text-cad-text-dim mt-0.5">
              Horizontal shift between rows (for brick patterns)
            </p>
          </div>

          {/* Row 4: Dash Pattern */}
          <div>
            <label className="text-[10px] text-cad-text-dim uppercase tracking-wide block mb-1">
              Dash Pattern
            </label>
            <input
              type="text"
              value={dashPatternString}
              onChange={(e) => handleDashPatternChange(e.target.value)}
              placeholder="Empty = continuous line"
              className="w-full px-2 py-1 text-xs bg-cad-input border border-cad-border rounded focus:outline-none focus:border-cad-accent font-mono"
            />
            <p className="text-[10px] text-cad-text-dim mt-0.5">
              Comma-separated: positive = dash, negative = gap, 0 = dot
            </p>
          </div>

          {/* Row 5: Stroke Width */}
          <div>
            <label className="text-[10px] text-cad-text-dim uppercase tracking-wide block mb-1">
              Stroke Width (optional)
            </label>
            <input
              type="number"
              value={family.strokeWidth || ''}
              onChange={(e) => handleChange('strokeWidth', e.target.value ? parseFloat(e.target.value) : undefined)}
              placeholder="Default"
              className="w-full px-2 py-1 text-xs bg-cad-input border border-cad-border rounded focus:outline-none focus:border-cad-accent"
              min={0.1}
              step={0.5}
            />
          </div>

          {/* Preset angle buttons */}
          <div>
            <label className="text-[10px] text-cad-text-dim uppercase tracking-wide block mb-1">
              Quick Angles
            </label>
            <div className="flex flex-wrap gap-1">
              {[0, 30, 45, 60, 90, 120, 135, 150].map(angle => (
                <button
                  key={angle}
                  onClick={() => handleChange('angle', angle)}
                  className={`px-2 py-0.5 text-[10px] rounded border transition-colors ${
                    family.angle === angle
                      ? 'bg-cad-accent border-cad-accent text-white'
                      : 'bg-cad-input border-cad-border hover:border-cad-text-dim'
                  }`}
                >
                  {angle}°
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Default line family for new entries
 */
export function createDefaultLineFamily(): LineFamily {
  return {
    angle: 45,
    originX: 0,
    originY: 0,
    deltaX: 0,
    deltaY: 10,
  };
}
