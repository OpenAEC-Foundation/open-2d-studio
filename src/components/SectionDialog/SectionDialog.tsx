/**
 * SectionDialog - Dialog for inserting structural profile sections
 *
 * Allows users to:
 * - Select profile type (I-beam, channel, angle, etc.)
 * - Choose from standard library (AISC, EN) or enter custom dimensions
 * - Preview the profile shape
 * - Insert into the drawing
 */

import { useState, useMemo, useRef, useCallback, useEffect } from 'react';
import { X, Search, RotateCw } from 'lucide-react';
import {
  PROFILE_TEMPLATES,
  getDefaultParameters,
  getAllProfileTemplates,
} from '../../services/parametric/profileTemplates';
import {
  getPresetsForType,
  getAvailableStandards,
  getCategoriesForStandard,
  searchPresets,
  getPresetById,
} from '../../services/parametric/profileLibrary';
import { generateProfileGeometry } from '../../services/parametric/geometryGenerators';
import type {
  ProfileType,
  ParameterValues,
  ParameterDefinition,
} from '../../types/parametric';

interface SectionDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onInsert: (profileType: ProfileType, parameters: ParameterValues, presetId?: string, rotation?: number) => void;
}

export function SectionDialog({ isOpen, onClose, onInsert }: SectionDialogProps) {
  // Profile selection state
  const [selectedProfileType, setSelectedProfileType] = useState<ProfileType>('i-beam');
  const [selectedStandard, setSelectedStandard] = useState<string>('AISC');
  const [selectedCategory, setSelectedCategory] = useState<string>('');
  const [selectedPresetId, setSelectedPresetId] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState('');
  const [useCustom, setUseCustom] = useState(false);

  // Parameter values (custom or from preset)
  const [parameters, setParameters] = useState<ParameterValues>({});

  // Rotation
  const [rotation, setRotation] = useState(0);

  // Drag state for movable modal
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const dragStartRef = useRef({ x: 0, y: 0 });

  // Canvas ref for preview
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Get current template
  const template = PROFILE_TEMPLATES[selectedProfileType];

  // Initialize parameters when profile type changes
  useEffect(() => {
    if (isOpen) {
      setParameters(getDefaultParameters(selectedProfileType));
      setSelectedPresetId('');
      setUseCustom(false);
    }
  }, [selectedProfileType, isOpen]);

  // Update parameters when preset is selected
  useEffect(() => {
    if (selectedPresetId) {
      const preset = getPresetById(selectedPresetId);
      if (preset) {
        setParameters(preset.parameters);
        setUseCustom(false);
      }
    }
  }, [selectedPresetId]);

  // Get available presets for current profile type
  const allPresets = useMemo(() => {
    return getPresetsForType(selectedProfileType);
  }, [selectedProfileType]);

  // Filter presets by standard and category
  const filteredPresets = useMemo(() => {
    let presets = allPresets;

    if (searchQuery) {
      presets = searchPresets(searchQuery).filter(p => p.profileType === selectedProfileType);
    } else {
      if (selectedStandard) {
        presets = presets.filter(p => p.standard === selectedStandard);
      }
      if (selectedCategory) {
        presets = presets.filter(p => p.category === selectedCategory);
      }
    }

    return presets;
  }, [allPresets, selectedStandard, selectedCategory, searchQuery, selectedProfileType]);

  // Get available categories for current standard
  const categories = useMemo(() => {
    return getCategoriesForStandard(selectedStandard).filter(cat =>
      allPresets.some(p => p.standard === selectedStandard && p.category === cat)
    );
  }, [selectedStandard, allPresets]);

  // Draw preview
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !isOpen) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Clear canvas
    ctx.fillStyle = '#1a1a2e';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Generate geometry for preview
    try {
      const geometry = generateProfileGeometry(
        selectedProfileType,
        parameters,
        { x: 0, y: 0 },
        rotation * (Math.PI / 180),
        1
      );

      if (geometry.outlines.length === 0) return;

      // Calculate scale to fit in canvas
      const bounds = geometry.bounds;
      const width = bounds.maxX - bounds.minX;
      const height = bounds.maxY - bounds.minY;
      const padding = 20;
      const scaleX = (canvas.width - padding * 2) / width;
      const scaleY = (canvas.height - padding * 2) / height;
      const scale = Math.min(scaleX, scaleY, 2); // Limit max scale

      // Center in canvas
      const offsetX = canvas.width / 2 - ((bounds.minX + bounds.maxX) / 2) * scale;
      const offsetY = canvas.height / 2 - ((bounds.minY + bounds.maxY) / 2) * scale;

      // Draw outlines
      ctx.strokeStyle = '#00d4ff';
      ctx.lineWidth = 1.5;
      ctx.fillStyle = 'rgba(0, 212, 255, 0.1)';

      for (let i = 0; i < geometry.outlines.length; i++) {
        const outline = geometry.outlines[i];
        const closed = geometry.closed[i];

        if (outline.length < 2) continue;

        ctx.beginPath();
        ctx.moveTo(
          outline[0].x * scale + offsetX,
          outline[0].y * scale + offsetY
        );

        for (let j = 1; j < outline.length; j++) {
          ctx.lineTo(
            outline[j].x * scale + offsetX,
            outline[j].y * scale + offsetY
          );
        }

        if (closed) {
          ctx.closePath();
          // Only fill outer outline
          if (i === 0) {
            ctx.fill();
          }
        }
        ctx.stroke();
      }

      // Draw center crosshair
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(canvas.width / 2, 0);
      ctx.lineTo(canvas.width / 2, canvas.height);
      ctx.moveTo(0, canvas.height / 2);
      ctx.lineTo(canvas.width, canvas.height / 2);
      ctx.stroke();
      ctx.setLineDash([]);

    } catch {
      // Draw error message
      ctx.fillStyle = '#ff6b6b';
      ctx.font = '12px Arial';
      ctx.textAlign = 'center';
      ctx.fillText('Preview error', canvas.width / 2, canvas.height / 2);
    }
  }, [isOpen, selectedProfileType, parameters, rotation]);

  // Drag handlers
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('button, input, select')) return;
    setIsDragging(true);
    dragStartRef.current = { x: e.clientX - position.x, y: e.clientY - position.y };
  }, [position]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isDragging) return;
    setPosition({
      x: e.clientX - dragStartRef.current.x,
      y: e.clientY - dragStartRef.current.y,
    });
  }, [isDragging]);

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
  }, []);

  // Parameter change handler
  const handleParameterChange = (paramId: string, value: number | string | boolean) => {
    setParameters(prev => ({ ...prev, [paramId]: value }));
    setSelectedPresetId(''); // Clear preset when manually changing
    setUseCustom(true);
  };

  // Insert handler
  const handleInsert = () => {
    onInsert(selectedProfileType, parameters, useCustom ? undefined : selectedPresetId, rotation);
    onClose();
  };

  // Reset dialog state when opening
  useEffect(() => {
    if (isOpen) {
      setPosition({ x: 0, y: 0 });
      setSearchQuery('');
      setRotation(0);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
    >
      <div
        className="bg-cad-surface border border-cad-border shadow-xl w-[800px] h-[550px] flex flex-col"
        style={{ transform: `translate(${position.x}px, ${position.y}px)` }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-3 py-1.5 border-b border-cad-border select-none"
          style={{ background: 'linear-gradient(to bottom, #ffffff, #f5f5f5)', borderColor: '#d4d4d4' }}
          onMouseDown={handleMouseDown}
        >
          <h2 className="text-xs font-semibold text-gray-800">Insert Section Profile</h2>
          <button
            onClick={onClose}
            className="p-0.5 hover:bg-cad-hover rounded transition-colors text-gray-600 hover:text-gray-800 cursor-default -mr-1"
          >
            <X size={14} />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 flex overflow-hidden">
          {/* Left: Profile Type & Presets */}
          <div className="w-[280px] border-r border-cad-border flex flex-col">
            {/* Profile Type Selection */}
            <div className="p-3 border-b border-cad-border">
              <label className="block text-xs text-cad-text-dim mb-1">Profile Type:</label>
              <select
                value={selectedProfileType}
                onChange={(e) => {
                  setSelectedProfileType(e.target.value as ProfileType);
                  setSelectedPresetId('');
                  setSelectedCategory('');
                }}
                className="w-full px-2 py-1.5 text-sm bg-cad-input border border-cad-border text-cad-text"
              >
                {getAllProfileTemplates().map(t => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
            </div>

            {/* Standard & Search */}
            <div className="p-3 border-b border-cad-border space-y-2">
              <div className="flex gap-2">
                <div className="flex-1">
                  <label className="block text-xs text-cad-text-dim mb-1">Standard:</label>
                  <select
                    value={selectedStandard}
                    onChange={(e) => {
                      setSelectedStandard(e.target.value);
                      setSelectedCategory('');
                      setSelectedPresetId('');
                    }}
                    className="w-full px-2 py-1 text-xs bg-cad-input border border-cad-border text-cad-text"
                  >
                    {getAvailableStandards().map(std => (
                      <option key={std} value={std}>{std}</option>
                    ))}
                  </select>
                </div>
                <div className="flex-1">
                  <label className="block text-xs text-cad-text-dim mb-1">Category:</label>
                  <select
                    value={selectedCategory}
                    onChange={(e) => {
                      setSelectedCategory(e.target.value);
                      setSelectedPresetId('');
                    }}
                    className="w-full px-2 py-1 text-xs bg-cad-input border border-cad-border text-cad-text"
                  >
                    <option value="">All</option>
                    {categories.map(cat => (
                      <option key={cat} value={cat}>{cat}</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Search */}
              <div className="relative">
                <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-cad-text-dim" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search profiles..."
                  className="w-full pl-7 pr-2 py-1 text-xs bg-cad-input border border-cad-border text-cad-text"
                />
              </div>
            </div>

            {/* Preset List */}
            <div className="flex-1 overflow-y-auto p-2">
              <div className="space-y-1">
                {/* Custom option */}
                <button
                  onClick={() => {
                    setUseCustom(true);
                    setSelectedPresetId('');
                    setParameters(getDefaultParameters(selectedProfileType));
                  }}
                  className={`w-full text-left px-2 py-1.5 text-xs transition-colors ${
                    useCustom && !selectedPresetId
                      ? 'bg-cad-accent text-white'
                      : 'hover:bg-cad-hover text-cad-text'
                  }`}
                >
                  [Custom Dimensions]
                </button>

                {filteredPresets.map(preset => (
                  <button
                    key={preset.id}
                    onClick={() => {
                      setSelectedPresetId(preset.id);
                      setUseCustom(false);
                    }}
                    className={`w-full text-left px-2 py-1.5 text-xs transition-colors ${
                      selectedPresetId === preset.id
                        ? 'bg-cad-accent text-white'
                        : 'hover:bg-cad-hover text-cad-text'
                    }`}
                  >
                    <span className="font-medium">{preset.name}</span>
                    {preset.properties?.weight && (
                      <span className="ml-2 text-cad-text-dim text-[10px]">
                        {preset.properties.weight.toFixed(1)} kg/m
                      </span>
                    )}
                  </button>
                ))}

                {filteredPresets.length === 0 && !searchQuery && (
                  <div className="text-center text-cad-text-dim py-4 text-xs">
                    No presets for this profile type
                  </div>
                )}

                {filteredPresets.length === 0 && searchQuery && (
                  <div className="text-center text-cad-text-dim py-4 text-xs">
                    No results for "{searchQuery}"
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Middle: Parameters */}
          <div className="w-[240px] border-r border-cad-border flex flex-col">
            <div className="p-3 border-b border-cad-border">
              <h3 className="text-xs font-medium text-cad-text">
                {useCustom ? 'Custom Dimensions' : (selectedPresetId ? `Preset: ${selectedPresetId}` : 'Dimensions')}
              </h3>
            </div>

            <div className="flex-1 overflow-y-auto p-3">
              <div className="space-y-3">
                {template?.parameters.map(param => (
                  <ParameterInput
                    key={param.id}
                    definition={param}
                    value={parameters[param.id]}
                    onChange={(value) => handleParameterChange(param.id, value)}
                    disabled={!useCustom && !!selectedPresetId}
                  />
                ))}
              </div>

              {/* Rotation */}
              <div className="mt-4 pt-4 border-t border-cad-border">
                <label className="block text-xs text-cad-text-dim mb-1">
                  <RotateCw size={10} className="inline mr-1" />
                  Rotation (degrees):
                </label>
                <div className="flex gap-2">
                  <input
                    type="number"
                    value={rotation}
                    onChange={(e) => setRotation(parseFloat(e.target.value) || 0)}
                    className="flex-1 px-2 py-1 text-xs bg-cad-input border border-cad-border text-cad-text"
                    step={15}
                  />
                  <button
                    onClick={() => setRotation(r => (r + 90) % 360)}
                    className="px-2 py-1 text-xs bg-cad-input border border-cad-border text-cad-text hover:bg-cad-hover"
                    title="Rotate 90°"
                  >
                    +90°
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Right: Preview */}
          <div className="flex-1 flex flex-col">
            <div className="p-3 border-b border-cad-border">
              <h3 className="text-xs font-medium text-cad-text">Preview</h3>
            </div>

            <div className="flex-1 p-3 flex items-center justify-center bg-[#1a1a2e]">
              <canvas
                ref={canvasRef}
                width={260}
                height={260}
                className="border border-cad-border"
              />
            </div>

            {/* Section Properties (if available) */}
            {selectedPresetId && (() => {
              const preset = getPresetById(selectedPresetId);
              if (preset?.properties) {
                return (
                  <div className="p-3 border-t border-cad-border">
                    <h4 className="text-[10px] font-medium text-cad-text-dim uppercase tracking-wider mb-2">
                      Section Properties
                    </h4>
                    <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[10px]">
                      {preset.properties.area && (
                        <div className="flex justify-between">
                          <span className="text-cad-text-dim">Area:</span>
                          <span className="text-cad-text">{preset.properties.area.toFixed(0)} mm²</span>
                        </div>
                      )}
                      {preset.properties.weight && (
                        <div className="flex justify-between">
                          <span className="text-cad-text-dim">Weight:</span>
                          <span className="text-cad-text">{preset.properties.weight.toFixed(1)} kg/m</span>
                        </div>
                      )}
                      {preset.properties.Ix && (
                        <div className="flex justify-between">
                          <span className="text-cad-text-dim">Ix:</span>
                          <span className="text-cad-text">{(preset.properties.Ix / 1e6).toFixed(2)}×10⁶ mm⁴</span>
                        </div>
                      )}
                      {preset.properties.Iy && (
                        <div className="flex justify-between">
                          <span className="text-cad-text-dim">Iy:</span>
                          <span className="text-cad-text">{(preset.properties.Iy / 1e6).toFixed(2)}×10⁶ mm⁴</span>
                        </div>
                      )}
                    </div>
                  </div>
                );
              }
              return null;
            })()}
          </div>
        </div>

        {/* Footer */}
        <div className="px-3 py-2 border-t border-cad-border flex justify-between items-center">
          <div className="text-xs text-cad-text-dim">
            Click Insert, then click on canvas to place the section
          </div>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="px-3 py-1 text-xs bg-cad-input border border-cad-border text-cad-text hover:bg-cad-hover"
            >
              Cancel
            </button>
            <button
              onClick={handleInsert}
              className="px-3 py-1 text-xs bg-cad-accent text-white hover:bg-cad-accent/80"
            >
              Insert
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Parameter Input Component
// ============================================================================

interface ParameterInputProps {
  definition: ParameterDefinition;
  value: number | string | boolean | undefined;
  onChange: (value: number | string | boolean) => void;
  disabled?: boolean;
}

function ParameterInput({ definition, value, onChange, disabled }: ParameterInputProps) {
  const displayValue = value ?? definition.defaultValue;

  return (
    <div>
      <label className="block text-xs text-cad-text-dim mb-1" title={definition.description}>
        {definition.label}
        {definition.unit && <span className="ml-1 text-[10px]">({definition.unit})</span>}
      </label>

      {definition.type === 'number' && (
        <input
          type="number"
          value={displayValue as number}
          onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
          min={definition.min}
          max={definition.max}
          step={definition.step || 1}
          disabled={disabled}
          className={`w-full px-2 py-1 text-xs border border-cad-border text-cad-text ${
            disabled ? 'bg-cad-surface text-cad-text-dim cursor-not-allowed' : 'bg-cad-input'
          }`}
        />
      )}

      {definition.type === 'select' && definition.options && (
        <select
          value={displayValue as string}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          className={`w-full px-2 py-1 text-xs border border-cad-border text-cad-text ${
            disabled ? 'bg-cad-surface text-cad-text-dim cursor-not-allowed' : 'bg-cad-input'
          }`}
        >
          {definition.options.map(opt => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
      )}

      {definition.type === 'boolean' && (
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={displayValue as boolean}
            onChange={(e) => onChange(e.target.checked)}
            disabled={disabled}
            className="form-checkbox"
          />
          <span className="text-xs text-cad-text">{definition.label}</span>
        </label>
      )}
    </div>
  );
}

export default SectionDialog;
