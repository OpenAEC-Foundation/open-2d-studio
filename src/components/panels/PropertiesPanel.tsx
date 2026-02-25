import { memo, useState, useRef, useEffect, useMemo } from 'react';
import { useAppStore, useUnitSettings } from '../../state/appStore';
import { formatLength, parseLength, formatNumber, formatElevation, formatAngle } from '../../units';
import type { UnitSettings } from '../../units/types';
import type { LineStyle, Shape, TextAlignment, TextVerticalAlignment, BeamShape, BeamMaterial, BeamJustification, BeamViewMode, LeaderArrowType, LeaderAttachment, LeaderConfig, TextCase, GridlineShape, GridlineBubblePosition, LevelShape, PuntniveauShape, WallShape, WallJustification, WallEndCap, SlabShape, SlabMaterial, SectionCalloutShape, SpaceShape, PlateSystemShape, CPTShape, PileShape, PileTypeDefinition } from '../../types/geometry';
import type { ParametricShape, ProfileParametricShape, ProfileType, ParameterValues } from '../../types/parametric';
import type { DimensionShape, DimensionArrowType, DimensionTextPlacement } from '../../types/dimension';
import { PROFILE_TEMPLATES } from '../../services/parametric/profileTemplates';
import { getPresetById } from '../../services/parametric/profileLibrary';
import { SectionDialog } from '../dialogs/SectionDialog/SectionDialog';
import { formatPeilLabel, calculatePeilFromY } from '../../hooks/drawing/useLevelDrawing';
import { regeneratePlateSystemBeams } from '../../hooks/drawing/usePlateSystemDrawing';
import { getElementLabelText, resolveTemplate, getDefaultLabelTemplate } from '../../engine/geometry/LabelUtils';
import { DrawingPropertiesPanel } from './DrawingPropertiesPanel';
import { PatternPickerPanel } from '../editors/PatternManager/PatternPickerPanel';
import { parseSpacingPattern, createGridlinesFromPattern } from '../../utils/gridlineUtils';
import { regenerateGridDimensions } from '../../utils/gridDimensionUtils';
import { ALL_PILE_SYMBOLS, renderPileSymbol } from '../dialogs/PileSymbolsDialog/PileSymbolsDialog';
import type { PileContourType } from '../../types/geometry';

const RAD2DEG = 180 / Math.PI;
const DEG2RAD = Math.PI / 180;

const inputClass = 'w-full bg-cad-bg border border-cad-border rounded px-2 py-1 text-xs text-cad-text';
const labelClass = 'block text-xs text-cad-text-dim mb-1';

function PropertyGroup({ label, defaultOpen = true, children }: {
  label: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="mb-1">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between py-1.5 px-2 text-xs font-semibold text-cad-accent bg-cad-bg border-y border-cad-border hover:bg-cad-hover transition-colors"
      >
        <span className="uppercase tracking-wide text-[11px]">{label}</span>
        <span className={`text-cad-text-dim text-[10px] transition-transform ${open ? '' : '-rotate-90'}`}>
          &#9662;
        </span>
      </button>
      {open && (
        <div className="px-2 pt-2 pb-1">
          {children}
        </div>
      )}
    </div>
  );
}

// Text Style Selector Component
function TextStyleSelector({ currentStyleId, onApplyStyle }: {
  currentStyleId?: string;
  onApplyStyle: (styleId: string) => void;
}) {
  const textStyles = useAppStore(s => s.textStyles) || [];
  const setTextStyleManagerOpen = useAppStore(s => s.setTextStyleManagerOpen);

  // Don't render if no styles available
  if (textStyles.length === 0) {
    return null;
  }

  const annotationStyles = textStyles.filter(s => !s.isModelText);
  const modelStyles = textStyles.filter(s => s.isModelText);

  return (
    <div className="mb-3 p-2 bg-cad-bg rounded border border-cad-border">
      <div className="flex items-center justify-between mb-1">
        <label className={labelClass + ' mb-0'}>Text Style</label>
        <button
          onClick={() => setTextStyleManagerOpen(true)}
          className="p-0.5 text-cad-text-dim hover:text-cad-accent transition-colors"
          title="Manage Text Styles"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/>
            <circle cx="12" cy="12" r="3"/>
          </svg>
        </button>
      </div>
      <select
        value={currentStyleId || ''}
        onChange={(e) => {
          if (e.target.value) {
            onApplyStyle(e.target.value);
          }
        }}
        className={inputClass}
      >
        <option value="">-- Custom --</option>
        {annotationStyles.length > 0 && (
          <optgroup label="Annotation Text">
            {annotationStyles.map(style => (
              <option key={style.id} value={style.id}>
                {style.name} {style.isBuiltIn ? '' : '(Custom)'}
              </option>
            ))}
          </optgroup>
        )}
        {modelStyles.length > 0 && (
          <optgroup label="Model Text">
            {modelStyles.map(style => (
              <option key={style.id} value={style.id}>
                {style.name} {style.isBuiltIn ? '' : '(Custom)'}
              </option>
            ))}
          </optgroup>
        )}
      </select>
      <div className="text-xs text-cad-text-dim mt-1">
        Select a style to apply its formatting
      </div>
    </div>
  );
}

// Region Type Selector for hatch shapes
function RegionTypeSelector({ currentTypeId, onApplyType, onManageTypes }: {
  currentTypeId?: string;
  onApplyType: (typeId: string | undefined, props: Record<string, any>) => void;
  onManageTypes?: () => void;
}) {
  const filledRegionTypes = useAppStore(s => s.filledRegionTypes);
  const setRegionTypeManagerOpen = useAppStore(s => s.setRegionTypeManagerOpen);

  const builtInTypes = filledRegionTypes.filter(t => t.isBuiltIn);
  const customTypes = filledRegionTypes.filter(t => !t.isBuiltIn);

  return (
    <div className="mb-3">
      <label className={labelClass}>Region Type</label>
      <select
        value={currentTypeId || ''}
        onChange={(e) => {
          const typeId = e.target.value || undefined;
          if (!typeId) {
            onApplyType(undefined, {});
            return;
          }
          const regionType = filledRegionTypes.find(t => t.id === typeId);
          if (regionType) {
            onApplyType(typeId, {
              patternType: regionType.fgPatternType,
              patternAngle: regionType.fgPatternAngle,
              patternScale: regionType.fgPatternScale,
              fillColor: regionType.fgColor,
              customPatternId: regionType.fgCustomPatternId,
              bgPatternType: regionType.bgPatternType,
              bgPatternAngle: regionType.bgPatternAngle,
              bgPatternScale: regionType.bgPatternScale,
              bgFillColor: regionType.bgColor,
              bgCustomPatternId: regionType.bgCustomPatternId,
              backgroundColor: regionType.backgroundColor,
              masking: regionType.masking,
            });
          }
        }}
        className={inputClass}
      >
        <option value="">(Custom)</option>
        {builtInTypes.length > 0 && (
          <optgroup label="Built-in">
            {builtInTypes.map(t => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </optgroup>
        )}
        {customTypes.length > 0 && (
          <optgroup label="Custom">
            {customTypes.map(t => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </optgroup>
        )}
      </select>
      <button onClick={onManageTypes || (() => setRegionTypeManagerOpen(true))} className="text-xs text-cad-accent hover:underline mt-1">
        Manage Types...
      </button>
    </div>
  );
}

function NumberField({ label, value, onChange, min, max, readOnly, disabled, unitSettings, inputClassName }: {
  label: string; value: number; onChange: (v: number) => void;
  step?: number; min?: number; max?: number; readOnly?: boolean; disabled?: boolean; unitSettings?: UnitSettings;
  inputClassName?: string;
}) {
  const formatValue = (v: number) => unitSettings
    ? formatLength(v, { ...unitSettings, showUnitSuffix: false })
    : String(Math.round(v * 1000) / 1000);

  const [localValue, setLocalValue] = useState(formatValue(value));

  // Sync local state when the external value changes (e.g. selecting a different shape)
  useEffect(() => {
    setLocalValue(formatValue(value));
  }, [value]);

  const commitValue = () => {
    if (disabled) return;
    let parsed: number;
    if (unitSettings) {
      parsed = parseLength(localValue, unitSettings);
    } else {
      parsed = parseFloat(localValue);
    }
    if (!isNaN(parsed) && parsed !== value) {
      if (min !== undefined) parsed = Math.max(min, parsed);
      if (max !== undefined) parsed = Math.min(max, parsed);
      onChange(parsed);
    }
    // Always reset display to formatted value (reverts invalid input)
    setLocalValue(formatValue(min !== undefined && !isNaN(parsed) ? Math.max(min, parsed) : (!isNaN(parsed) ? parsed : value)));
  };

  const disabledClasses = disabled ? ' text-cad-text-dim opacity-50 cursor-not-allowed' : '';

  return (
    <div className="mb-2">
      <label className={labelClass}>{label}</label>
      <input type="text" readOnly={readOnly || disabled} disabled={disabled}
        value={localValue}
        onChange={(e) => setLocalValue(e.target.value)}
        onBlur={commitValue}
        onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
        className={`${inputClass}${inputClassName ? ` ${inputClassName}` : ''}${disabledClasses}`} />
    </div>
  );
}

function TextField({ label, value, onChange, placeholder }: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string;
}) {
  return (
    <div className="mb-2">
      <label className={labelClass}>{label}</label>
      <input type="text" value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={inputClass} />
    </div>
  );
}

function LineweightInput({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const [localValue, setLocalValue] = useState(String(value));

  useEffect(() => {
    setLocalValue(String(value));
  }, [value]);

  const commitValue = () => {
    const parsed = parseFloat(localValue);
    if (!isNaN(parsed) && parsed >= 0.5 && parsed <= 20) {
      onChange(parsed);
      setLocalValue(String(parsed));
    } else {
      setLocalValue(String(value));
    }
  };

  return (
    <div className="mb-3">
      <label className="block text-xs text-cad-text-dim mb-1">Lineweight</label>
      <input
        type="text"
        value={localValue}
        onChange={(e) => setLocalValue(e.target.value)}
        onBlur={commitValue}
        onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
        className="w-full bg-cad-bg border border-cad-border rounded px-2 py-1 text-xs text-cad-text"
      />
    </div>
  );
}

function CheckboxField({ label, value, onChange }: {
  label: string; value: boolean; onChange: (v: boolean) => void;
}) {
  return (
    <div className="mb-2 flex items-center gap-2">
      <input type="checkbox" checked={value}
        onChange={(e) => onChange(e.target.checked)}
        className="accent-cad-accent" />
      <label className="text-xs text-cad-text">{label}</label>
    </div>
  );
}

function SelectField<T extends string>({ label, value, options, onChange }: {
  label: string; value: T; options: { value: T; label: string }[]; onChange: (v: T) => void;
}) {
  return (
    <div className="mb-2">
      <label className={labelClass}>{label}</label>
      <select value={value} onChange={(e) => onChange(e.target.value as T)} className={inputClass}>
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  );
}

const NAMED_COLORS: { hex: string; name?: string }[] = [
  // Row 1: Primary + Secondary
  { hex: '#ff0000', name: 'Red' }, { hex: '#ff8000', name: 'Orange' }, { hex: '#ffff00', name: 'Yellow' }, { hex: '#00ff00', name: 'Green' },
  { hex: '#00ffff', name: 'Cyan' }, { hex: '#0000ff', name: 'Blue' }, { hex: '#8000ff', name: 'Violet' }, { hex: '#ff00ff', name: 'Magenta' },
  // Row 2: Dark variants
  { hex: '#800000', name: 'Maroon' }, { hex: '#804000', name: 'Brown' }, { hex: '#808000', name: 'Olive' }, { hex: '#008000', name: 'Dark Green' },
  { hex: '#008080', name: 'Teal' }, { hex: '#000080', name: 'Navy' }, { hex: '#400080', name: 'Indigo' }, { hex: '#800080', name: 'Purple' },
  // Row 3: Light variants
  { hex: '#ff9999', name: 'Light Red' }, { hex: '#ffcc99', name: 'Peach' }, { hex: '#ffff99', name: 'Light Yellow' }, { hex: '#99ff99', name: 'Light Green' },
  { hex: '#99ffff', name: 'Light Cyan' }, { hex: '#9999ff', name: 'Light Blue' }, { hex: '#cc99ff', name: 'Lavender' }, { hex: '#ff99ff', name: 'Light Pink' },
  // Row 4: Grays
  { hex: '#000000', name: 'Black' }, { hex: '#404040', name: 'Dark Gray' }, { hex: '#808080', name: 'Gray' }, { hex: '#a0a0a0', name: 'Medium Gray' },
  { hex: '#c0c0c0', name: 'Silver' }, { hex: '#d9d9d9', name: 'Light Gray' }, { hex: '#f0f0f0', name: 'Near White' }, { hex: '#ffffff', name: 'White' },
];

function ColorPalette({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open]);

  return (
    <div className="mb-2" ref={ref}>
      <label className={labelClass}>{label}</label>
      <div className="flex items-center gap-2 relative">
        <button
          onClick={() => setOpen(!open)}
          className="w-6 h-6 rounded-sm border border-cad-border cursor-pointer shrink-0 hover:border-cad-accent"
          style={{ backgroundColor: value }}
        />
        <input type="text" value={value}
          onChange={(e) => onChange(e.target.value)}
          className="flex-1 bg-cad-bg border border-cad-border rounded px-2 py-1 text-xs text-cad-text font-mono" />
        {open && (
          <div className="absolute left-0 top-full mt-1 z-50 bg-cad-surface border border-cad-border rounded shadow-lg p-2">
            <div className="grid grid-cols-8 gap-1">
              {NAMED_COLORS.map((c, i) => (
                <button
                  key={i}
                  title={c.name ? `${c.name}\n${c.hex}` : c.hex}
                  onClick={() => { onChange(c.hex); setOpen(false); }}
                  className={`w-5 h-5 rounded-sm border ${
                    value.toLowerCase() === c.hex.toLowerCase()
                      ? 'border-cad-accent border-2'
                      : 'border-cad-border hover:border-cad-text'
                  }`}
                  style={{ backgroundColor: c.hex }}
                />
              ))}
            </div>
            <div className="mt-2 pt-2 border-t border-cad-border">
              <label className="block text-xs text-cad-text-dim mb-1">Custom Color</label>
              <div className="flex items-center gap-2">
                <input type="color" value={value}
                  onChange={(e) => { onChange(e.target.value); }}
                  className="w-8 h-8 rounded border border-cad-border cursor-pointer" />
                <input type="text" value={value}
                  onChange={(e) => onChange(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') setOpen(false); }}
                  className="flex-1 bg-cad-bg border border-cad-border rounded px-2 py-1 text-xs text-cad-text font-mono"
                  placeholder="#rrggbb" />
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function ParametricShapeProperties({ shape }: { shape: ParametricShape }) {
  const updateProfileParameters = useAppStore(s => s.updateProfileParameters);
  const updateProfilePosition = useAppStore(s => s.updateProfilePosition);
  const updateProfileRotation = useAppStore(s => s.updateProfileRotation);
  const updateParametricShape = useAppStore(s => s.updateParametricShape);

  if (shape.parametricType !== 'profile') {
    return <div className="text-xs text-cad-text-dim">Unknown parametric type</div>;
  }

  const profileShape = shape as ProfileParametricShape;
  const template = PROFILE_TEMPLATES[profileShape.profileType];

  const handleParameterChange = (paramId: string, value: number) => {
    updateProfileParameters(shape.id, { [paramId]: value });
  };

  return (
    <>
      <div className="mb-3 p-2 bg-cad-bg rounded border border-cad-border">
        <div className="text-xs font-semibold text-cad-accent mb-1">
          {template?.name || profileShape.profileType}
        </div>
        {profileShape.presetId && (
          <div className="text-xs text-cad-text-dim">
            Preset: {profileShape.presetId}
          </div>
        )}
        {profileShape.standard && (
          <div className="text-xs text-cad-text-dim">
            Standard: {profileShape.standard}
          </div>
        )}
      </div>

      {/* Position */}
      <div className="mb-3">
        <label className="block text-xs font-semibold text-cad-text mb-2">Position</label>
        <div className="grid grid-cols-2 gap-2">
          <NumberField
            label="X"
            value={profileShape.position.x}
            onChange={(v) => updateProfilePosition(shape.id, { ...profileShape.position, x: v })}
            step={1}
          />
          <NumberField
            label="Y"
            value={profileShape.position.y}
            onChange={(v) => updateProfilePosition(shape.id, { ...profileShape.position, y: v })}
            step={1}
          />
        </div>
      </div>

      {/* Rotation */}
      <NumberField
        label="Rotation (deg)"
        value={profileShape.rotation * RAD2DEG}
        onChange={(v) => updateProfileRotation(shape.id, v * DEG2RAD)}
        step={1}
      />

      {/* Label */}
      <PropertyGroup label="Label">
        <CheckboxField
          label="Show Label"
          value={profileShape.showLabel ?? true}
          onChange={(v) => updateParametricShape(shape.id, { showLabel: v })}
        />
        {(profileShape.showLabel ?? true) && (
          <TextField
            label="Label Text"
            value={profileShape.labelText || ''}
            placeholder={profileShape.presetId || template?.name || profileShape.profileType}
            onChange={(v) => updateParametricShape(shape.id, { labelText: v || undefined })}
          />
        )}
      </PropertyGroup>

      {/* Parameters */}
      {template && (
        <div className="mt-3 pt-3 border-t border-cad-border">
          <label className="block text-xs font-semibold text-cad-text mb-2">Parameters</label>
          {template.parameters.map((param) => (
            <NumberField
              key={param.id}
              label={`${param.label}${param.unit ? ` (${param.unit})` : ''}`}
              value={(profileShape.parameters[param.id] as number) || (param.defaultValue as number)}
              onChange={(v) => handleParameterChange(param.id, v)}
              step={param.step || 1}
              min={param.min}
              max={param.max}
            />
          ))}
        </div>
      )}
    </>
  );
}

// Component for editing common properties when multiple shapes of the same type are selected
function MultiSelectShapeProperties({
  shapes,
  updateShape
}: {
  shapes: Shape[];
  updateShape: (id: string, updates: Partial<Shape>) => void;
}) {
  const updateAll = (updates: Record<string, unknown>) => {
    shapes.forEach(shape => updateShape(shape.id, updates as Partial<Shape>));
  };

  const shapeType = shapes[0]?.type;
  if (!shapeType) return null;

  // Get common value or return undefined if values differ
  const getCommonValue = <T,>(getter: (shape: Shape) => T): T | undefined => {
    const firstValue = getter(shapes[0]);
    const allSame = shapes.every(s => getter(s) === firstValue);
    return allSame ? firstValue : undefined;
  };

  switch (shapeType) {
    case 'text': {
      const textShapes = shapes as Extract<Shape, { type: 'text' }>[];
      const commonFontFamily = getCommonValue(s => (s as typeof textShapes[0]).fontFamily);
      const commonFontSize = getCommonValue(s => (s as typeof textShapes[0]).fontSize);
      const commonLineHeight = getCommonValue(s => (s as typeof textShapes[0]).lineHeight);
      const commonBold = getCommonValue(s => (s as typeof textShapes[0]).bold);
      const commonItalic = getCommonValue(s => (s as typeof textShapes[0]).italic);
      const commonUnderline = getCommonValue(s => (s as typeof textShapes[0]).underline);
      const commonColor = getCommonValue(s => (s as typeof textShapes[0]).color);
      const commonAlignment = getCommonValue(s => (s as typeof textShapes[0]).alignment);
      const commonVerticalAlignment = getCommonValue(s => (s as typeof textShapes[0]).verticalAlignment);
      const commonIsModelText = getCommonValue(s => (s as typeof textShapes[0]).isModelText ?? false);
      const commonBackgroundMask = getCommonValue(s => (s as typeof textShapes[0]).backgroundMask ?? false);
      const commonBackgroundColor = getCommonValue(s => (s as typeof textShapes[0]).backgroundColor);
      const commonBackgroundPadding = getCommonValue(s => (s as typeof textShapes[0]).backgroundPadding);

      // Check if this is a linked label (element tag)
      const linkedShapeId = textShapes.length === 1 ? textShapes[0].linkedShapeId : undefined;
      const allStoreShapes = useAppStore.getState().shapes;
      const linkedShape = linkedShapeId ? allStoreShapes.find(s => s.id === linkedShapeId) : undefined;

      return (
        <>
          {linkedShape && (
            <PropertyGroup label="Linked Element">
              <div className="text-xs text-cad-text mb-1">
                <span className="text-cad-text-dim">Type: </span>
                <span className="capitalize">{linkedShape.type}</span>
              </div>
              <div className="text-xs text-cad-text mb-1">
                <span className="text-cad-text-dim">Label Text: </span>
                <span>{
                  textShapes[0].labelTemplate
                    ? resolveTemplate(textShapes[0].labelTemplate, linkedShape, useAppStore.getState().wallTypes)
                    : getElementLabelText(linkedShape, useAppStore.getState().wallTypes)
                }</span>
              </div>
              <TextField
                label="Label Template"
                value={textShapes[0].labelTemplate || getDefaultLabelTemplate(linkedShape.type)}
                onChange={(v) => updateAll({ labelTemplate: v || undefined })}
                placeholder="{Name}\n{Area} m\u00B2"
              />
              <div className="text-xs text-cad-text-dim mb-1">
                Use placeholders: {'{Name}'}, {'{Number}'}, {'{Area}'}, {'{Level}'}, {'{Type}'}, {'{Thickness}'}, {'{Section}'}
              </div>
            </PropertyGroup>
          )}
          <PropertyGroup label="Properties">
            <TextField
              label="Font Family"
              value={commonFontFamily ?? ''}
              onChange={(v) => updateAll({ fontFamily: v })}
            />
            <NumberField
              label="Text Height"
              value={commonFontSize ?? textShapes[0].fontSize}
              onChange={(v) => updateAll({ fontSize: v })}
              step={1}
              min={1}
            />
            <NumberField
              label="Line Height"
              value={commonLineHeight ?? textShapes[0].lineHeight}
              onChange={(v) => updateAll({ lineHeight: v })}
              step={0.1}
              min={0.5}
            />
            <div className="mb-2 flex items-center gap-3">
              <CheckboxField
                label="Bold"
                value={commonBold ?? false}
                onChange={(v) => updateAll({ bold: v })}
              />
              <CheckboxField
                label="Italic"
                value={commonItalic ?? false}
                onChange={(v) => updateAll({ italic: v })}
              />
              <CheckboxField
                label="Underline"
                value={commonUnderline ?? false}
                onChange={(v) => updateAll({ underline: v })}
              />
            </div>
            <ColorPalette
              label="Text Color"
              value={commonColor ?? textShapes[0].color}
              onChange={(v) => updateAll({ color: v })}
            />
            <SelectField
              label="Alignment"
              value={commonAlignment ?? 'left'}
              options={[
                { value: 'left', label: 'Left' },
                { value: 'center', label: 'Center' },
                { value: 'right', label: 'Right' }
              ] as { value: TextAlignment; label: string }[]}
              onChange={(v) => updateAll({ alignment: v })}
            />
            <SelectField
              label="Vertical Alignment"
              value={commonVerticalAlignment ?? 'top'}
              options={[
                { value: 'top', label: 'Top' },
                { value: 'middle', label: 'Middle' },
                { value: 'bottom', label: 'Bottom' }
              ] as { value: TextVerticalAlignment; label: string }[]}
              onChange={(v) => updateAll({ verticalAlignment: v })}
            />
          </PropertyGroup>

          <PropertyGroup label="Display">
            <CheckboxField
              label="Model Text"
              value={commonIsModelText ?? false}
              onChange={(v) => updateAll({ isModelText: v })}
            />

            <CheckboxField
              label="Background Mask"
              value={commonBackgroundMask ?? false}
              onChange={(v) => updateAll({ backgroundMask: v })}
            />
            {commonBackgroundMask && (
              <>
                <ColorPalette
                  label="Background Color"
                  value={commonBackgroundColor ?? '#1a1a2e'}
                  onChange={(v) => updateAll({ backgroundColor: v })}
                />
                <NumberField
                  label="Padding"
                  value={commonBackgroundPadding ?? 0.5}
                  onChange={(v) => updateAll({ backgroundPadding: v })}
                  step={0.1}
                  min={0}
                />
              </>
            )}
          </PropertyGroup>
        </>
      );
    }

    case 'circle': {
      const circleShapes = shapes as Extract<Shape, { type: 'circle' }>[];
      const commonRadius = getCommonValue(s => (s as typeof circleShapes[0]).radius);
      return (
        <PropertyGroup label="Geometry">
          <NumberField
            label="Radius"
            value={commonRadius ?? circleShapes[0].radius}
            onChange={(v) => updateAll({ radius: v })}
            step={0.1}
            min={0.1}
          />
        </PropertyGroup>
      );
    }

    case 'rectangle': {
      const rectShapes = shapes as Extract<Shape, { type: 'rectangle' }>[];
      const commonWidth = getCommonValue(s => (s as typeof rectShapes[0]).width);
      const commonHeight = getCommonValue(s => (s as typeof rectShapes[0]).height);
      const commonRotation = getCommonValue(s => (s as typeof rectShapes[0]).rotation);
      return (
        <PropertyGroup label="Geometry">
          <NumberField
            label="Width"
            value={commonWidth ?? rectShapes[0].width}
            onChange={(v) => updateAll({ width: v })}
            step={0.1}
            min={0.1}
          />
          <NumberField
            label="Height"
            value={commonHeight ?? rectShapes[0].height}
            onChange={(v) => updateAll({ height: v })}
            step={0.1}
            min={0.1}
          />
          <NumberField
            label="Rotation (deg)"
            value={(commonRotation ?? rectShapes[0].rotation) * RAD2DEG}
            onChange={(v) => updateAll({ rotation: v * DEG2RAD })}
            step={1}
          />
        </PropertyGroup>
      );
    }

    case 'hatch': {
      const hatchShapes = shapes as Extract<Shape, { type: 'hatch' }>[];
      const commonPatternType = getCommonValue(s => (s as typeof hatchShapes[0]).patternType);
      const commonCustomPatternId = getCommonValue(s => (s as typeof hatchShapes[0]).customPatternId);
      const commonPatternAngle = getCommonValue(s => (s as typeof hatchShapes[0]).patternAngle);
      const commonPatternScale = getCommonValue(s => (s as typeof hatchShapes[0]).patternScale);
      const commonFillColor = getCommonValue(s => (s as typeof hatchShapes[0]).fillColor);
      const commonBgPatternType = getCommonValue(s => (s as typeof hatchShapes[0]).bgPatternType);
      const commonBgCustomPatternId = getCommonValue(s => (s as typeof hatchShapes[0]).bgCustomPatternId);
      const commonBgPatternAngle = getCommonValue(s => (s as typeof hatchShapes[0]).bgPatternAngle);
      const commonBgPatternScale = getCommonValue(s => (s as typeof hatchShapes[0]).bgPatternScale);
      const commonBgFillColor = getCommonValue(s => (s as typeof hatchShapes[0]).bgFillColor);
      const commonBackgroundColor = getCommonValue(s => (s as typeof hatchShapes[0]).backgroundColor);
      const commonMasking = getCommonValue(s => (s as typeof hatchShapes[0]).masking ?? true);
      const commonBoundaryVisible = getCommonValue(s => (s as typeof hatchShapes[0]).boundaryVisible ?? true);
      const commonTypeId = getCommonValue(s => (s as typeof hatchShapes[0]).filledRegionTypeId);
      return (
        <>
          <PropertyGroup label="Region Type">
            <RegionTypeSelector
              currentTypeId={commonTypeId}
              onApplyType={(typeId, props) => updateAll({ filledRegionTypeId: typeId, ...props })}
            />
          </PropertyGroup>

          <PropertyGroup label="Foreground Pattern">
            <PatternPickerPanel
              value={commonPatternType ?? 'solid'}
              customPatternId={commonCustomPatternId}
              onChange={(type, customId) => updateAll({ patternType: type, customPatternId: customId, filledRegionTypeId: undefined })}
            />
            <NumberField label="Angle (deg)" value={commonPatternAngle ?? 0} onChange={(v) => updateAll({ patternAngle: v, filledRegionTypeId: undefined })} step={15} />
            <NumberField label="Scale" value={commonPatternScale ?? 1} onChange={(v) => updateAll({ patternScale: v, filledRegionTypeId: undefined })} step={0.1} min={0.1} />
            <ColorPalette label="Color" value={commonFillColor ?? hatchShapes[0].fillColor} onChange={(v) => updateAll({ fillColor: v, filledRegionTypeId: undefined })} />
          </PropertyGroup>

          <PropertyGroup label="Background Pattern" defaultOpen={!!commonBgPatternType}>
            <PatternPickerPanel
              value={commonBgPatternType ?? 'solid'}
              customPatternId={commonBgCustomPatternId}
              onChange={(type, customId) => updateAll({ bgPatternType: type, bgCustomPatternId: customId, filledRegionTypeId: undefined })}
            />
            {commonBgPatternType && (
              <>
                <NumberField label="Angle (deg)" value={commonBgPatternAngle ?? 0} onChange={(v) => updateAll({ bgPatternAngle: v, filledRegionTypeId: undefined })} step={15} />
                <NumberField label="Scale" value={commonBgPatternScale ?? 1} onChange={(v) => updateAll({ bgPatternScale: v, filledRegionTypeId: undefined })} step={0.1} min={0.1} />
                <ColorPalette label="Color" value={commonBgFillColor ?? '#808080'} onChange={(v) => updateAll({ bgFillColor: v, filledRegionTypeId: undefined })} />
                <button
                  onClick={() => updateAll({ bgPatternType: undefined, bgPatternAngle: undefined, bgPatternScale: undefined, bgFillColor: undefined, bgCustomPatternId: undefined, filledRegionTypeId: undefined })}
                  className="text-xs text-cad-accent hover:underline mb-2">
                  Remove background pattern
                </button>
              </>
            )}
          </PropertyGroup>

          <PropertyGroup label="Display">
            <ColorPalette label="Background Color" value={commonBackgroundColor ?? 'transparent'} onChange={(v) => updateAll({ backgroundColor: v, filledRegionTypeId: undefined })} />
            <CheckboxField
              label="Opaque (hides elements behind)"
              value={commonMasking ?? true}
              onChange={(v) => updateAll({ masking: v, filledRegionTypeId: undefined })}
            />
            <CheckboxField
              label="Show boundary outline"
              value={commonBoundaryVisible ?? true}
              onChange={(v) => updateAll({ boundaryVisible: v })}
            />
          </PropertyGroup>
        </>
      );
    }

    case 'beam': {
      const beamShapes = shapes as BeamShape[];
      const commonMaterial = getCommonValue(s => (s as BeamShape).material);
      const commonJustification = getCommonValue(s => (s as BeamShape).justification);
      const commonFlangeWidth = getCommonValue(s => (s as BeamShape).flangeWidth);
      const commonShowCenterline = getCommonValue(s => (s as BeamShape).showCenterline);
      const commonShowLabel = getCommonValue(s => (s as BeamShape).showLabel);
      const commonViewMode = getCommonValue(s => (s as BeamShape).viewMode || 'plan');

      return (
        <>
          <PropertyGroup label="Properties">
            <NumberField
              label="Flange Width (mm)"
              value={commonFlangeWidth ?? beamShapes[0].flangeWidth}
              onChange={(v) => updateAll({ flangeWidth: v })}
              step={1}
              min={1}
            />
            <SelectField<BeamMaterial>
              label="Material"
              value={commonMaterial ?? 'steel'}
              options={[
                { value: 'steel', label: 'Steel' },
                { value: 'cold-formed-steel', label: 'Cold-Formed Steel' },
                { value: 'concrete', label: 'Concrete' },
                { value: 'timber', label: 'Timber' },
                { value: 'aluminum', label: 'Aluminum' },
                { value: 'other', label: 'Other' },
              ]}
              onChange={(v) => updateAll({ material: v })}
            />
            <SelectField<BeamJustification>
              label="Justification"
              value={commonJustification ?? 'center'}
              options={[
                { value: 'center', label: 'Center' },
                { value: 'top', label: 'Top' },
                { value: 'bottom', label: 'Bottom' },
                { value: 'left', label: 'Left' },
                { value: 'right', label: 'Right' },
              ]}
              onChange={(v) => updateAll({ justification: v })}
            />
            <SelectField<BeamViewMode>
              label="View"
              value={(commonViewMode as BeamViewMode) ?? 'plan'}
              options={[
                { value: 'plan', label: 'Plan' },
                { value: 'section', label: 'Section' },
                { value: 'elevation', label: 'Elevation' },
                { value: 'side', label: 'Side' },
              ]}
              onChange={(v) => updateAll({ viewMode: v })}
            />
          </PropertyGroup>

          <PropertyGroup label="Display">
            <CheckboxField
              label="Show Centerline"
              value={commonShowCenterline ?? true}
              onChange={(v) => updateAll({ showCenterline: v })}
            />
            <CheckboxField
              label="Show Label"
              value={commonShowLabel ?? true}
              onChange={(v) => updateAll({ showLabel: v })}
            />
          </PropertyGroup>
        </>
      );
    }

    // For other shape types, no additional common properties to edit
    default:
      return null;
  }
}

/** Gridline spacing pattern input — creates parallel copies at typed offsets */
function GridlineSpacingInput({ gridline }: { gridline: GridlineShape }) {
  const [pattern, setPattern] = useState('');
  const addShapes = useAppStore(s => s.addShapes);

  const handleCreate = () => {
    const newGridlines = createGridlinesFromPattern(gridline, pattern);
    if (newGridlines.length > 0) {
      addShapes(newGridlines);
      setPattern('');

      // Auto-dimension: regenerate grid dimensions if enabled
      if (useAppStore.getState().autoGridDimension) {
        setTimeout(() => regenerateGridDimensions(), 50);
      }
    }
  };

  return (
    <PropertyGroup label="Spacing Pattern">
      <div className="flex gap-1 mb-1">
        <input
          type="text"
          value={pattern}
          onChange={(e) => setPattern(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleCreate(); } }}
          placeholder="4000 3000 5x5400"
          className="flex-1 bg-cad-bg border border-cad-border rounded px-2 py-1 text-xs text-cad-text"
        />
        <button
          onClick={handleCreate}
          disabled={!pattern.trim() || !parseSpacingPattern(pattern)}
          className="px-2 py-1 text-xs bg-cad-accent/20 border border-cad-accent/50 text-cad-accent hover:bg-cad-accent/30 rounded disabled:opacity-30"
        >
          Create
        </button>
      </div>
      <div className="text-[10px] text-cad-text-dim">
        Space-separated distances. Use NxD for repeats (e.g. 5x5400 = 5 copies at 5400mm).
      </div>
    </PropertyGroup>
  );
}

function ShapeProperties({ shape, updateShape }: { shape: Shape; updateShape: (id: string, updates: Partial<Shape>) => void }) {
  const update = (updates: Record<string, unknown>) => updateShape(shape.id, updates as Partial<Shape>);
  const unitSettings = useUnitSettings();

  switch (shape.type) {
    case 'text': {
      const applyTextStyleToShape = useAppStore.getState().applyTextStyleToShape;
      return (
        <>
          <TextStyleSelector
            currentStyleId={shape.textStyleId}
            onApplyStyle={(styleId) => applyTextStyleToShape(shape.id, styleId)}
          />

          <PropertyGroup label="Properties">
            <div className="mb-2">
              <label className={labelClass}>Text</label>
              <textarea value={shape.text} rows={3}
                onChange={(e) => update({ text: e.target.value })}
                className={inputClass + ' resize-y'} />
            </div>
            <TextField label="Font Family" value={shape.fontFamily} onChange={(v) => update({ fontFamily: v })} />
            <NumberField label="Text Height" value={shape.fontSize} onChange={(v) => update({ fontSize: v })} step={1} min={1} />
            <NumberField label="Line Height" value={shape.lineHeight} onChange={(v) => update({ lineHeight: v })} step={0.1} min={0.5} />
            <div className="mb-2 flex items-center gap-3">
              <CheckboxField label="Bold" value={shape.bold} onChange={(v) => update({ bold: v })} />
              <CheckboxField label="Italic" value={shape.italic} onChange={(v) => update({ italic: v })} />
              <CheckboxField label="Underline" value={shape.underline} onChange={(v) => update({ underline: v })} />
            </div>
            <div className="mb-2 flex items-center gap-3">
              <CheckboxField label="Strikethrough" value={shape.strikethrough ?? false} onChange={(v) => update({ strikethrough: v })} />
            </div>

            <SelectField<TextCase>
              label="Text Case"
              value={shape.textCase ?? 'none'}
              options={[
                { value: 'none', label: 'Normal' },
                { value: 'uppercase', label: 'UPPERCASE' },
                { value: 'lowercase', label: 'lowercase' },
                { value: 'capitalize', label: 'Capitalize Each Word' },
              ]}
              onChange={(v) => update({ textCase: v })}
            />
            <NumberField
              label="Letter Spacing"
              value={shape.letterSpacing ?? 1}
              onChange={(v) => update({ letterSpacing: v })}
              step={0.05}
              min={0.5}
              max={3}
            />
            <NumberField
              label="Width Factor"
              value={shape.widthFactor ?? 1}
              onChange={(v) => update({ widthFactor: v })}
              step={0.1}
              min={0.25}
              max={4}
            />
            <NumberField
              label="Oblique Angle (deg)"
              value={shape.obliqueAngle ?? 0}
              onChange={(v) => update({ obliqueAngle: v })}
              step={1}
              min={-45}
              max={45}
            />
            <NumberField
              label="Paragraph Spacing"
              value={shape.paragraphSpacing ?? 1}
              onChange={(v) => update({ paragraphSpacing: v })}
              step={0.1}
              min={0}
              max={5}
            />

            <div className="mb-2">
              <label className={labelClass}>Text Color</label>
              <div className="flex items-center gap-2">
                <input type="color" value={shape.color}
                  onChange={(e) => update({ color: e.target.value })}
                  className="w-8 h-8 rounded border border-cad-border cursor-pointer" />
                <input type="text" value={shape.color}
                  onChange={(e) => update({ color: e.target.value })}
                  className="flex-1 bg-cad-bg border border-cad-border rounded px-2 py-1 text-xs text-cad-text font-mono" />
              </div>
            </div>
            <SelectField label="Alignment" value={shape.alignment}
              options={[{ value: 'left', label: 'Left' }, { value: 'center', label: 'Center' }, { value: 'right', label: 'Right' }] as { value: TextAlignment; label: string }[]}
              onChange={(v) => update({ alignment: v })} />
            <SelectField label="Vertical Alignment" value={shape.verticalAlignment}
              options={[{ value: 'top', label: 'Top' }, { value: 'middle', label: 'Middle' }, { value: 'bottom', label: 'Bottom' }] as { value: TextVerticalAlignment; label: string }[]}
              onChange={(v) => update({ verticalAlignment: v })} />
            <NumberField label="Rotation (deg)" value={shape.rotation * RAD2DEG} onChange={(v) => update({ rotation: v * DEG2RAD })} step={1} />
            <NumberField label="Position X" value={shape.position.x} onChange={(v) => update({ position: { ...shape.position, x: v } })} step={0.1} />
            <NumberField label="Position Y" value={-shape.position.y} onChange={(v) => update({ position: { ...shape.position, y: -v } })} step={0.1} />

            {shape.leaderPoints && shape.leaderPoints.length > 0 && (
              <>
                <div className="border-t border-cad-border mt-3 pt-3 mb-2">
                  <span className="text-xs text-cad-text font-medium">Leader Settings</span>
                </div>
                <SelectField<LeaderArrowType>
                  label="Arrow Type"
                  value={shape.leaderConfig?.arrowType ?? 'arrow'}
                  options={[
                    { value: 'arrow', label: 'Open Arrow' },
                    { value: 'filled-arrow', label: 'Filled Arrow' },
                    { value: 'dot', label: 'Dot' },
                    { value: 'slash', label: 'Slash' },
                    { value: 'none', label: 'None' },
                  ]}
                  onChange={(v) => update({
                    leaderConfig: { ...shape.leaderConfig, arrowType: v } as LeaderConfig
                  })}
                />
                <NumberField
                  label="Arrow Size"
                  value={shape.leaderConfig?.arrowSize ?? 3}
                  onChange={(v) => update({
                    leaderConfig: { ...shape.leaderConfig, arrowSize: v } as LeaderConfig
                  })}
                  step={0.5}
                  min={1}
                />
                <SelectField<LeaderAttachment>
                  label="Attachment"
                  value={shape.leaderConfig?.attachment ?? 'middle-left'}
                  options={[
                    { value: 'top-left', label: 'Top Left' },
                    { value: 'top-center', label: 'Top Center' },
                    { value: 'top-right', label: 'Top Right' },
                    { value: 'middle-left', label: 'Middle Left' },
                    { value: 'middle-right', label: 'Middle Right' },
                    { value: 'bottom-left', label: 'Bottom Left' },
                    { value: 'bottom-center', label: 'Bottom Center' },
                    { value: 'bottom-right', label: 'Bottom Right' },
                  ]}
                  onChange={(v) => update({
                    leaderConfig: { ...shape.leaderConfig, attachment: v } as LeaderConfig
                  })}
                />
                <CheckboxField
                  label="Show Landing (Shoulder)"
                  value={shape.leaderConfig?.hasLanding ?? true}
                  onChange={(v) => update({
                    leaderConfig: { ...shape.leaderConfig, hasLanding: v } as LeaderConfig
                  })}
                />
                {(shape.leaderConfig?.hasLanding ?? true) && (
                  <NumberField
                    label="Landing Length"
                    value={shape.leaderConfig?.landingLength ?? 5}
                    onChange={(v) => update({
                      leaderConfig: { ...shape.leaderConfig, landingLength: v } as LeaderConfig
                    })}
                    step={0.5}
                    min={0}
                  />
                )}
                <NumberField
                  label="Leader Point Count"
                  value={shape.leaderPoints.length}
                  onChange={() => {}}
                  readOnly
                />
              </>
            )}
          </PropertyGroup>

          <PropertyGroup label="Display">
            <CheckboxField
              label="Model Text"
              value={shape.isModelText ?? false}
              onChange={(v) => update({ isModelText: v })}
            />
            <div className="text-xs text-cad-text-dim mb-2 -mt-1">
              {shape.isModelText
                ? 'Scales with geometry (like real-world objects)'
                : 'Maintains paper size (annotation)'}
            </div>

            <CheckboxField
              label="Background Mask"
              value={shape.backgroundMask ?? false}
              onChange={(v) => update({ backgroundMask: v })}
            />
            {shape.backgroundMask && (
              <>
                <ColorPalette
                  label="Background Color"
                  value={shape.backgroundColor ?? '#1a1a2e'}
                  onChange={(v) => update({ backgroundColor: v })}
                />
                <NumberField
                  label="Padding"
                  value={shape.backgroundPadding ?? 0.5}
                  onChange={(v) => update({ backgroundPadding: v })}
                  step={0.1}
                  min={0}
                />
              </>
            )}
          </PropertyGroup>
        </>
      );
    }

    case 'line':
      return (
        <PropertyGroup label="Geometry">
          <NumberField label="Start X" value={shape.start.x} onChange={(v) => update({ start: { ...shape.start, x: v } })} step={0.1} />
          <NumberField label="Start Y" value={-shape.start.y} onChange={(v) => update({ start: { ...shape.start, y: -v } })} step={0.1} />
          <NumberField label="End X" value={shape.end.x} onChange={(v) => update({ end: { ...shape.end, x: v } })} step={0.1} />
          <NumberField label="End Y" value={-shape.end.y} onChange={(v) => update({ end: { ...shape.end, y: -v } })} step={0.1} />
        </PropertyGroup>
      );

    case 'rectangle':
      return (
        <PropertyGroup label="Geometry">
          <NumberField label="Top-Left X" value={shape.topLeft.x} onChange={(v) => update({ topLeft: { ...shape.topLeft, x: v } })} step={0.1} />
          <NumberField label="Top-Left Y" value={-shape.topLeft.y} onChange={(v) => update({ topLeft: { ...shape.topLeft, y: -v } })} step={0.1} />
          <NumberField label="Width" value={shape.width} onChange={(v) => update({ width: v })} step={0.1} min={0.1} />
          <NumberField label="Height" value={shape.height} onChange={(v) => update({ height: v })} step={0.1} min={0.1} />
          <NumberField label="Rotation (deg)" value={shape.rotation * RAD2DEG} onChange={(v) => update({ rotation: v * DEG2RAD })} step={1} />
        </PropertyGroup>
      );

    case 'circle':
      return (
        <PropertyGroup label="Geometry">
          <NumberField label="Center X" value={shape.center.x} onChange={(v) => update({ center: { ...shape.center, x: v } })} step={0.1} />
          <NumberField label="Center Y" value={-shape.center.y} onChange={(v) => update({ center: { ...shape.center, y: -v } })} step={0.1} />
          <NumberField label="Radius" value={shape.radius} onChange={(v) => update({ radius: v })} step={0.1} min={0.1} />
          <CheckboxField label="Center Mark" value={shape.showCenterMark ?? true} onChange={(v) => update({ showCenterMark: v })} />
        </PropertyGroup>
      );

    case 'arc':
      return (
        <PropertyGroup label="Geometry">
          <NumberField label="Center X" value={shape.center.x} onChange={(v) => update({ center: { ...shape.center, x: v } })} step={0.1} />
          <NumberField label="Center Y" value={-shape.center.y} onChange={(v) => update({ center: { ...shape.center, y: -v } })} step={0.1} />
          <NumberField label="Radius" value={shape.radius} onChange={(v) => update({ radius: v })} step={0.1} min={0.1} />
          <NumberField label="Start Angle (deg)" value={shape.startAngle * RAD2DEG} onChange={(v) => update({ startAngle: v * DEG2RAD })} step={1} />
          <NumberField label="End Angle (deg)" value={shape.endAngle * RAD2DEG} onChange={(v) => update({ endAngle: v * DEG2RAD })} step={1} />
          <CheckboxField label="Center Mark" value={shape.showCenterMark ?? true} onChange={(v) => update({ showCenterMark: v })} />
        </PropertyGroup>
      );

    case 'ellipse':
      return (
        <PropertyGroup label="Geometry">
          <NumberField label="Center X" value={shape.center.x} onChange={(v) => update({ center: { ...shape.center, x: v } })} step={0.1} />
          <NumberField label="Center Y" value={-shape.center.y} onChange={(v) => update({ center: { ...shape.center, y: -v } })} step={0.1} />
          <NumberField label="Radius X" value={shape.radiusX} onChange={(v) => update({ radiusX: v })} step={0.1} min={0.1} />
          <NumberField label="Radius Y" value={shape.radiusY} onChange={(v) => update({ radiusY: v })} step={0.1} min={0.1} />
          <NumberField label="Rotation (deg)" value={shape.rotation * RAD2DEG} onChange={(v) => update({ rotation: v * DEG2RAD })} step={1} />
        </PropertyGroup>
      );

    case 'polyline':
      return (
        <PropertyGroup label="Geometry">
          <CheckboxField label="Closed" value={shape.closed} onChange={(v) => update({ closed: v })} />
          <NumberField label="Point Count" value={shape.points.length} onChange={() => {}} readOnly />
        </PropertyGroup>
      );

    case 'spline':
      return (
        <PropertyGroup label="Geometry">
          <CheckboxField label="Closed" value={shape.closed} onChange={(v) => update({ closed: v })} />
          <NumberField label="Control Points" value={shape.points.length} onChange={() => {}} readOnly />
        </PropertyGroup>
      );

    case 'hatch': {
      return (
        <>
          <PropertyGroup label="Region Type">
            <RegionTypeSelector
              currentTypeId={shape.filledRegionTypeId}
              onApplyType={(typeId, props) => update({ filledRegionTypeId: typeId, ...props })}
            />
          </PropertyGroup>

          <PropertyGroup label="Foreground Pattern">
            <PatternPickerPanel
              value={shape.patternType}
              customPatternId={shape.customPatternId}
              onChange={(type, customId) => update({ patternType: type, customPatternId: customId, filledRegionTypeId: undefined })}
            />
            <NumberField label="Angle (deg)" value={shape.patternAngle} onChange={(v) => update({ patternAngle: v, filledRegionTypeId: undefined })} step={1} />
            <NumberField label="Scale" value={shape.patternScale} onChange={(v) => update({ patternScale: v, filledRegionTypeId: undefined })} step={0.1} min={0.1} />
            <ColorPalette label="Color" value={shape.fillColor} onChange={(v) => update({ fillColor: v, filledRegionTypeId: undefined })} />
          </PropertyGroup>

          <PropertyGroup label="Background Pattern" defaultOpen={!!shape.bgPatternType}>
            <PatternPickerPanel
              value={shape.bgPatternType ?? 'solid'}
              customPatternId={shape.bgCustomPatternId}
              onChange={(type, customId) => {
                if (type === 'solid' && !shape.bgPatternType) {
                  update({ bgPatternType: type, bgCustomPatternId: customId, filledRegionTypeId: undefined });
                } else {
                  update({ bgPatternType: type, bgCustomPatternId: customId, filledRegionTypeId: undefined });
                }
              }}
            />
            {shape.bgPatternType && (
              <>
                <NumberField label="Angle (deg)" value={shape.bgPatternAngle ?? 0} onChange={(v) => update({ bgPatternAngle: v, filledRegionTypeId: undefined })} step={1} />
                <NumberField label="Scale" value={shape.bgPatternScale ?? 1} onChange={(v) => update({ bgPatternScale: v, filledRegionTypeId: undefined })} step={0.1} min={0.1} />
                <ColorPalette label="Color" value={shape.bgFillColor ?? '#808080'} onChange={(v) => update({ bgFillColor: v, filledRegionTypeId: undefined })} />
                <button
                  onClick={() => update({ bgPatternType: undefined, bgPatternAngle: undefined, bgPatternScale: undefined, bgFillColor: undefined, bgCustomPatternId: undefined, filledRegionTypeId: undefined })}
                  className="text-xs text-cad-accent hover:underline mb-2">
                  Remove background pattern
                </button>
              </>
            )}
          </PropertyGroup>

          <PropertyGroup label="Display">
            <ColorPalette label="Background Color" value={shape.backgroundColor || '#000000'} onChange={(v) => update({ backgroundColor: v, filledRegionTypeId: undefined })} />
            {shape.backgroundColor && (
              <button
                onClick={() => update({ backgroundColor: undefined, filledRegionTypeId: undefined })}
                className="text-xs text-cad-accent hover:underline -mt-1 mb-2">
                Clear background color
              </button>
            )}
            <CheckboxField
              label="Opaque (hides elements behind)"
              value={shape.masking ?? true}
              onChange={(v) => update({ masking: v, filledRegionTypeId: undefined })}
            />
            <CheckboxField
              label="Show boundary outline"
              value={shape.boundaryVisible ?? true}
              onChange={(v) => update({ boundaryVisible: v })}
            />
          </PropertyGroup>

          <PropertyGroup label="Geometry">
            <NumberField label="Boundary Points" value={shape.points.length} onChange={() => {}} readOnly />
            {shape.innerLoops && shape.innerLoops.length > 0 && (
              <NumberField label="Inner Loops" value={shape.innerLoops.length} onChange={() => {}} readOnly />
            )}
          </PropertyGroup>
        </>
      );
    }

    case 'dimension': {
      const dim = shape as DimensionShape;
      const updateDimStyle = (styleUpdates: Partial<typeof dim.dimensionStyle>) => {
        update({ dimensionStyle: { ...dim.dimensionStyle, ...styleUpdates } });
      };

      return (
        <>
          <PropertyGroup label="Properties">
            <div className="text-xs text-cad-text-dim mb-2">
              Type: {dim.dimensionType.charAt(0).toUpperCase() + dim.dimensionType.slice(1)}
            </div>
            <TextField label="Value" value={dim.value} onChange={(v) => update({ value: v, valueOverridden: true })} />
            <div className="mb-2 flex items-center gap-2">
              <CheckboxField label="Override Value" value={dim.valueOverridden} onChange={(v) => update({ valueOverridden: v })} />
            </div>
            <TextField label="Prefix" value={dim.prefix || ''} onChange={(v) => update({ prefix: v || undefined })} />
            <TextField label="Suffix" value={dim.suffix || ''} onChange={(v) => update({ suffix: v || undefined })} />
            <NumberField label="Offset Distance" value={dim.dimensionLineOffset} onChange={(v) => update({ dimensionLineOffset: v })} step={1} />

            <SelectField<DimensionArrowType>
              label="Arrow Type"
              value={dim.dimensionStyle.arrowType}
              options={[
                { value: 'tick', label: 'Tick Mark' },
                { value: 'filled', label: 'Filled Arrow' },
                { value: 'open', label: 'Open Arrow' },
                { value: 'dot', label: 'Dot' },
                { value: 'none', label: 'None' },
              ]}
              onChange={(v) => updateDimStyle({ arrowType: v })}
            />
            <NumberField label="Arrow Size" value={dim.dimensionStyle.arrowSize} onChange={(v) => updateDimStyle({ arrowSize: v })} step={0.5} min={0.5} />
            <NumberField label="Text Height" value={dim.dimensionStyle.textHeight} onChange={(v) => updateDimStyle({ textHeight: v })} step={0.5} min={1} />

            <SelectField<DimensionTextPlacement>
              label="Text Placement"
              value={dim.dimensionStyle.textPlacement}
              options={[
                { value: 'centered', label: 'Centered (break line)' },
                { value: 'above', label: 'Above Line' },
                { value: 'below', label: 'Below Line' },
              ]}
              onChange={(v) => updateDimStyle({ textPlacement: v })}
            />

            <NumberField label="Precision" value={dim.dimensionStyle.precision} onChange={(v) => updateDimStyle({ precision: Math.round(v) })} step={1} min={0} max={6} />
            <NumberField label="Extension Gap" value={dim.dimensionStyle.extensionLineGap} onChange={(v) => updateDimStyle({ extensionLineGap: v })} step={0.5} min={0} />
            <NumberField label="Extension Overshoot" value={dim.dimensionStyle.extensionLineOvershoot} onChange={(v) => updateDimStyle({ extensionLineOvershoot: v })} step={0.5} min={0} />

            <div className="mb-2">
              <label className={labelClass}>Line Color</label>
              <div className="flex items-center gap-2">
                <input type="color" value={dim.dimensionStyle.lineColor}
                  onChange={(e) => updateDimStyle({ lineColor: e.target.value })}
                  className="w-8 h-8 rounded border border-cad-border cursor-pointer" />
                <input type="text" value={dim.dimensionStyle.lineColor}
                  onChange={(e) => updateDimStyle({ lineColor: e.target.value })}
                  className="flex-1 bg-cad-bg border border-cad-border rounded px-2 py-1 text-xs text-cad-text font-mono" />
              </div>
            </div>

            <div className="mb-2">
              <label className={labelClass}>Text Color</label>
              <div className="flex items-center gap-2">
                <input type="color" value={dim.dimensionStyle.textColor}
                  onChange={(e) => updateDimStyle({ textColor: e.target.value })}
                  className="w-8 h-8 rounded border border-cad-border cursor-pointer" />
                <input type="text" value={dim.dimensionStyle.textColor}
                  onChange={(e) => updateDimStyle({ textColor: e.target.value })}
                  className="flex-1 bg-cad-bg border border-cad-border rounded px-2 py-1 text-xs text-cad-text font-mono" />
              </div>
            </div>

            {dim.textOffset && (
              <button
                onClick={() => update({ textOffset: undefined })}
                className="text-xs text-cad-accent hover:underline mb-2">
                Reset Text Position
              </button>
            )}
          </PropertyGroup>
        </>
      );
    }

    case 'beam': {
      const beam = shape as BeamShape;
      const dx = beam.end.x - beam.start.x;
      const dy = beam.end.y - beam.start.y;
      const length = Math.sqrt(dx * dx + dy * dy);
      const angle = Math.atan2(dy, dx) * RAD2DEG;

      return (
        <>
          <PropertyGroup label="Geometry">
            <div className="mb-3 p-2 bg-cad-bg rounded border border-cad-border">
              <div className="text-xs font-semibold text-cad-accent mb-1">
                {beam.presetName || beam.profileType}
              </div>
              {beam.presetId && (
                <div className="text-xs text-cad-text-dim">
                  Profile: {beam.presetId}
                </div>
              )}
              <div className="text-xs text-cad-text-dim">
                Type: {beam.profileType}
              </div>
            </div>

            <div className="mb-3 p-2 bg-cad-bg rounded border border-cad-border">
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                <div className="text-cad-text-dim">Length:</div>
                <div className="text-cad-text">{formatLength(length, unitSettings)}</div>
                <div className="text-cad-text-dim">Angle:</div>
                <div className="text-cad-text">{formatAngle(angle, unitSettings)}</div>
                <div className="text-cad-text-dim">Flange Width:</div>
                <div className="text-cad-text">{beam.flangeWidth} mm</div>
              </div>
            </div>

            <div className="mb-3">
              <label className="block text-xs font-semibold text-cad-text mb-2">Start Point</label>
              <div className="grid grid-cols-2 gap-2">
                <NumberField
                  label="X"
                  value={beam.start.x}
                  onChange={(v) => update({ start: { ...beam.start, x: v } })}
                  step={1}
                />
                <NumberField
                  label="Y"
                  value={-beam.start.y}
                  onChange={(v) => update({ start: { ...beam.start, y: -v } })}
                  step={1}
                />
              </div>
            </div>

            <div className="mb-3">
              <label className="block text-xs font-semibold text-cad-text mb-2">End Point</label>
              <div className="grid grid-cols-2 gap-2">
                <NumberField
                  label="X"
                  value={beam.end.x}
                  onChange={(v) => update({ end: { ...beam.end, x: v } })}
                  step={1}
                />
                <NumberField
                  label="Y"
                  value={-beam.end.y}
                  onChange={(v) => update({ end: { ...beam.end, y: -v } })}
                  step={1}
                />
              </div>
            </div>
          </PropertyGroup>

          <PropertyGroup label="Properties">
            <NumberField
              label="Flange Width (mm)"
              value={beam.flangeWidth}
              onChange={(v) => update({ flangeWidth: v })}
              step={1}
              min={1}
            />

            <SelectField<BeamMaterial>
              label="Material"
              value={beam.material}
              options={[
                { value: 'steel', label: 'Steel' },
                { value: 'cold-formed-steel', label: 'Cold-Formed Steel' },
                { value: 'concrete', label: 'Concrete' },
                { value: 'timber', label: 'Timber' },
                { value: 'aluminum', label: 'Aluminum' },
                { value: 'other', label: 'Other' },
              ]}
              onChange={(v) => update({ material: v })}
            />

            <SelectField<BeamJustification>
              label="Justification"
              value={beam.justification}
              options={[
                { value: 'center', label: 'Center' },
                { value: 'top', label: 'Top' },
                { value: 'bottom', label: 'Bottom' },
                { value: 'left', label: 'Left' },
                { value: 'right', label: 'Right' },
              ]}
              onChange={(v) => update({ justification: v })}
            />

            <SelectField<BeamViewMode>
              label="View"
              value={beam.viewMode || 'plan'}
              options={[
                { value: 'plan', label: 'Plan' },
                { value: 'section', label: 'Section' },
                { value: 'elevation', label: 'Elevation' },
                { value: 'side', label: 'Side' },
              ]}
              onChange={(v) => update({ viewMode: v })}
            />

            <NumberField
              label="Rotation (deg)"
              value={beam.rotation * RAD2DEG}
              onChange={(v) => update({ rotation: v * DEG2RAD })}
              step={1}
            />

            {Object.keys(beam.profileParameters).length > 0 && (
              <>
                <div className="border-t border-cad-border mt-3 pt-3 mb-2">
                  <span className="text-xs text-cad-text font-medium">Profile Parameters</span>
                </div>
                {Object.entries(beam.profileParameters).map(([key, value]) => {
                  if (typeof value === 'number') {
                    return (
                      <NumberField
                        key={key}
                        label={key.charAt(0).toUpperCase() + key.slice(1).replace(/([A-Z])/g, ' $1')}
                        value={value}
                        onChange={(v) => update({
                          profileParameters: { ...beam.profileParameters, [key]: v }
                        })}
                        step={1}
                      />
                    );
                  } else if (typeof value === 'boolean') {
                    return (
                      <CheckboxField
                        key={key}
                        label={key.charAt(0).toUpperCase() + key.slice(1).replace(/([A-Z])/g, ' $1')}
                        value={value}
                        onChange={(v) => update({
                          profileParameters: { ...beam.profileParameters, [key]: v }
                        })}
                      />
                    );
                  } else {
                    return (
                      <TextField
                        key={key}
                        label={key.charAt(0).toUpperCase() + key.slice(1).replace(/([A-Z])/g, ' $1')}
                        value={String(value)}
                        onChange={(v) => update({
                          profileParameters: { ...beam.profileParameters, [key]: v }
                        })}
                      />
                    );
                  }
                })}
              </>
            )}
          </PropertyGroup>

          <PropertyGroup label="Display">
            <CheckboxField
              label="Show Centerline"
              value={beam.showCenterline}
              onChange={(v) => update({ showCenterline: v })}
            />

            <CheckboxField
              label="Show Label"
              value={beam.showLabel}
              onChange={(v) => update({ showLabel: v })}
            />

            {beam.showLabel && (
              <TextField
                label="Label Text"
                value={beam.labelText || ''}
                onChange={(v) => update({ labelText: v || undefined })}
              />
            )}
          </PropertyGroup>
        </>
      );
    }

    case 'gridline': {
      const gl = shape as GridlineShape;
      const dx = gl.end.x - gl.start.x;
      const dy = gl.end.y - gl.start.y;
      const length = Math.sqrt(dx * dx + dy * dy);
      const angle = Math.atan2(dy, dx) * RAD2DEG;

      return (
        <>
          <PropertyGroup label="Identity">
            <div className="mb-3 p-2 bg-cad-bg rounded border border-cad-border">
              <div className="text-xs font-semibold text-cad-accent mb-1">IfcGridAxis</div>
              <div className="text-xs text-cad-text-dim">IFC Type: IfcGridAxis</div>
            </div>
            <TextField label="Label" value={gl.label} onChange={(v) => update({ label: v })} />
          </PropertyGroup>

          <GridlineSpacingInput gridline={gl} />

          <PropertyGroup label="Geometry">
            <div className="mb-3 p-2 bg-cad-bg rounded border border-cad-border">
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                <div className="text-cad-text-dim">Length:</div>
                <div className="text-cad-text">{formatLength(length, unitSettings)}</div>
                <div className="text-cad-text-dim">Angle:</div>
                <div className="text-cad-text">{formatAngle(angle, unitSettings)}</div>
              </div>
            </div>

            <div className="mb-3">
              <label className="block text-xs font-semibold text-cad-text mb-2">Start Point</label>
              <div className="grid grid-cols-2 gap-2">
                <NumberField label="X" value={gl.start.x} onChange={(v) => update({ start: { ...gl.start, x: v } })} step={1} />
                <NumberField label="Y" value={-gl.start.y} onChange={(v) => update({ start: { ...gl.start, y: -v } })} step={1} />
              </div>
            </div>

            <div className="mb-3">
              <label className="block text-xs font-semibold text-cad-text mb-2">End Point</label>
              <div className="grid grid-cols-2 gap-2">
                <NumberField label="X" value={gl.end.x} onChange={(v) => update({ end: { ...gl.end, x: v } })} step={1} />
                <NumberField label="Y" value={-gl.end.y} onChange={(v) => update({ end: { ...gl.end, y: -v } })} step={1} />
              </div>
            </div>
          </PropertyGroup>

          <PropertyGroup label="Display">
            <SelectField<GridlineBubblePosition>
              label="Bubble Position"
              value={gl.bubblePosition}
              options={[
                { value: 'start', label: 'Start' },
                { value: 'end', label: 'End' },
                { value: 'both', label: 'Both' },
              ]}
              onChange={(v) => update({ bubblePosition: v })}
            />
            <NumberField label="Bubble Radius" value={gl.bubbleRadius} onChange={(v) => update({ bubbleRadius: v })} step={0.5} min={0.5} />
            <NumberField label="Font Size" value={gl.fontSize} onChange={(v) => update({ fontSize: v })} step={0.5} min={0.5} />
          </PropertyGroup>
        </>
      );
    }

    case 'level': {
      const lv = shape as LevelShape;
      const ldx = lv.end.x - lv.start.x;
      const ldy = lv.end.y - lv.start.y;
      const lLength = Math.sqrt(ldx * ldx + ldy * ldy);
      const lAngle = Math.atan2(ldy, ldx) * RAD2DEG;

      return (
        <>
          <PropertyGroup label="Identity">
            <div className="mb-3 p-2 bg-cad-bg rounded border border-cad-border">
              <div className="text-xs font-semibold text-cad-accent mb-1">IfcBuildingStorey</div>
              <div className="text-xs text-cad-text-dim">IFC Type: IfcBuildingStorey</div>
            </div>
            <TextField label="Description" value={lv.description ?? ''} onChange={(v) => update({ description: v || undefined })} placeholder="e.g. Vloerpeil, Bovenkant vloer" />
          </PropertyGroup>

          <PropertyGroup label="Level Properties">
            <NumberField label="Peil (mm)" value={lv.peil ?? 0} onChange={(v) => {
              // When peil is manually changed, update Y positions to match
              // Canvas Y is inverted: positive peil = negative Y
              const newY = -v;
              const dy = newY - lv.start.y;
              update({
                peil: v,
                elevation: v,
                label: formatPeilLabel(v),
                start: { x: lv.start.x, y: lv.start.y + dy },
                end: { x: lv.end.x, y: lv.end.y + dy },
              });
            }} step={100} />
            {(() => {
              const seaDatum = useAppStore.getState().projectStructure.seaLevelDatum ?? 0;
              const napElevMM = (seaDatum * 1000) + (lv.elevation ?? 0);
              const napElev = napElevMM / 1000;
              const napPrecision = napElev === Math.round(napElev) ? 1 : 2;
              const napStr = formatElevation(napElevMM, unitSettings.numberFormat, napPrecision);
              return (
                <div className="mb-3 p-2 bg-cad-bg rounded border border-cad-border">
                  <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                    <div className="text-cad-text-dim">Display:</div>
                    <div className="text-cad-text">{lv.label}</div>
                    <div className="text-cad-text-dim">NAP Elevation:</div>
                    <div className="text-cad-text">NAP {napStr} m{seaDatum === 0 ? ' (no datum set)' : ''}</div>
                  </div>
                </div>
              );
            })()}
          </PropertyGroup>

          <PropertyGroup label="Geometry">
            <div className="mb-3 p-2 bg-cad-bg rounded border border-cad-border">
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                <div className="text-cad-text-dim">Length:</div>
                <div className="text-cad-text">{formatLength(lLength, unitSettings)}</div>
                <div className="text-cad-text-dim">Angle:</div>
                <div className="text-cad-text">{formatAngle(lAngle, unitSettings)}</div>
              </div>
            </div>

            <div className="mb-3">
              <label className="block text-xs font-semibold text-cad-text mb-2">Start Point</label>
              <div className="grid grid-cols-2 gap-2">
                <NumberField label="X" value={lv.start.x} onChange={(v) => update({ start: { ...lv.start, x: v } })} step={1} />
                <NumberField label="Y" value={-lv.start.y} onChange={(v) => {
                  const internalY = -v;
                  const newPeil = calculatePeilFromY(internalY);
                  update({
                    start: { ...lv.start, y: internalY },
                    end: { ...lv.end, y: internalY },
                    peil: newPeil,
                    elevation: newPeil,
                    label: formatPeilLabel(newPeil),
                  });
                }} step={1} />
              </div>
            </div>

            <div className="mb-3">
              <label className="block text-xs font-semibold text-cad-text mb-2">End Point</label>
              <div className="grid grid-cols-2 gap-2">
                <NumberField label="X" value={lv.end.x} onChange={(v) => update({ end: { ...lv.end, x: v } })} step={1} />
                <NumberField label="Y" value={-lv.end.y} onChange={(v) => {
                  const internalY = -v;
                  const newPeil = calculatePeilFromY(internalY);
                  update({
                    start: { ...lv.start, y: internalY },
                    end: { ...lv.end, y: internalY },
                    peil: newPeil,
                    elevation: newPeil,
                    label: formatPeilLabel(newPeil),
                  });
                }} step={1} />
              </div>
            </div>
          </PropertyGroup>

          <PropertyGroup label="Display">
            <NumberField label="Marker Size" value={lv.bubbleRadius} onChange={(v) => update({ bubbleRadius: v })} step={0.5} min={0.5} />
            <NumberField label="Font Size" value={lv.fontSize} onChange={(v) => update({ fontSize: v })} step={0.5} min={0.5} />
          </PropertyGroup>
        </>
      );
    }

    case 'puntniveau': {
      const pnv = shape as PuntniveauShape;
      // Calculate area using shoelace formula
      let pnvArea = 0;
      for (let i = 0; i < pnv.points.length; i++) {
        const j = (i + 1) % pnv.points.length;
        pnvArea += pnv.points[i].x * pnv.points[j].y;
        pnvArea -= pnv.points[j].x * pnv.points[i].y;
      }
      pnvArea = Math.abs(pnvArea) / 2;

      return (
        <>
          <PropertyGroup label="Identity">
            <div className="mb-3 p-2 bg-cad-bg rounded border border-cad-border">
              <div className="text-xs font-semibold text-cad-accent mb-1">Puntniveau Zone</div>
              <div className="text-xs text-cad-text-dim">IFC Type: IfcAnnotation</div>
            </div>
          </PropertyGroup>

          <PropertyGroup label="Puntniveau">
            <NumberField label="Puntniveau t.o.v. NAP (m)" value={pnv.puntniveauNAP} onChange={(v) => update({ puntniveauNAP: v })} step={0.5} />
          </PropertyGroup>

          <PropertyGroup label="Geometry">
            <div className="mb-3 p-2 bg-cad-bg rounded border border-cad-border">
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                <div className="text-cad-text-dim">Points:</div>
                <div className="text-cad-text">{pnv.points.length}</div>
                <div className="text-cad-text-dim">Area:</div>
                <div className="text-cad-text">{formatNumber(pnvArea / 1e6, 2, unitSettings.numberFormat)} m&sup2;</div>
              </div>
            </div>
          </PropertyGroup>

          <PropertyGroup label="Display">
            <NumberField label="Font Size (mm)" value={pnv.fontSize} onChange={(v) => update({ fontSize: v })} step={25} min={50} />
          </PropertyGroup>
        </>
      );
    }

    case 'wall': {
      const w = shape as WallShape;
      const dx = w.end.x - w.start.x;
      const dy = w.end.y - w.start.y;
      const length = Math.sqrt(dx * dx + dy * dy);
      const angle = Math.atan2(dy, dx) * RAD2DEG;
      const wallTypes = useAppStore.getState().wallTypes;
      const wallProjectStructure = useAppStore.getState().projectStructure;

      // Collect all storeys from all buildings for level selectors
      const allStoreys: { id: string; name: string; elevation: number }[] = [];
      for (const building of wallProjectStructure.buildings) {
        for (const storey of building.storeys) {
          allStoreys.push(storey);
        }
      }
      // Sort by elevation ascending
      allStoreys.sort((a, b) => a.elevation - b.elevation);

      return (
        <>
          <PropertyGroup label="Identity">
            <div className="mb-3 p-2 bg-cad-bg rounded border border-cad-border">
              <div className="text-xs font-semibold text-cad-accent mb-1">IfcWall</div>
              <div className="text-xs text-cad-text-dim">IFC Type: IfcWall</div>
            </div>
            <div className="mb-3">
              <label className={labelClass}>Wall Type</label>
              <select
                className={inputClass}
                value={w.wallTypeId || ''}
                onChange={(e) => {
                  const newTypeId = e.target.value || undefined;
                  if (newTypeId) {
                    const selectedWt = wallTypes.find(wt => wt.id === newTypeId);
                    if (selectedWt) {
                      update({
                        wallTypeId: newTypeId,
                        thickness: selectedWt.thickness,
                      });
                    } else {
                      update({ wallTypeId: newTypeId });
                    }
                  } else {
                    update({ wallTypeId: undefined });
                  }
                }}
              >
                <option value="">(Custom)</option>
                {wallTypes.map((wt) => (
                  <option key={wt.id} value={wt.id}>{wt.name} ({wt.thickness}mm)</option>
                ))}
              </select>
            </div>
            {/* Grouped wall info */}
            {w.groupedWallTypeId && (() => {
              const gwTypes = useAppStore.getState().groupedWallTypes;
              const gwt = gwTypes.find(g => g.id === w.groupedWallTypeId);
              const layerInfo = gwt && w.groupedWallLayerIndex !== undefined
                ? gwt.layers[w.groupedWallLayerIndex]
                : undefined;
              return (
                <div className="mb-3 p-2 bg-cad-bg rounded border border-cad-border">
                  <div className="text-[10px] text-cad-text-dim font-medium">
                    Grouped Wall: {gwt?.name || w.groupedWallTypeId}
                  </div>
                  {layerInfo && (
                    <div className="text-[10px] text-cad-text-secondary">
                      Layer: {layerInfo.name} ({layerInfo.thickness}mm)
                    </div>
                  )}
                  {w.groupId && (
                    <button
                      onClick={() => useAppStore.getState().explodeWallGroup(w.groupId!)}
                      className="mt-1 px-2 py-1 text-[10px] bg-orange-600/20 text-orange-300 border border-orange-500/30 rounded hover:bg-orange-600/30"
                    >
                      Explode Group
                    </button>
                  )}
                </div>
              );
            })()}
            {/* Wall System (multi-layered assembly) */}
            {(() => {
              const wallSystemTypes = useAppStore.getState().wallSystemTypes;
              return (
                <div className="mb-3">
                  <label className={labelClass}>Wall System</label>
                  <select
                    className={inputClass}
                    value={w.wallSystemId || ''}
                    onChange={(e) => {
                      const wsId = e.target.value || undefined;
                      if (wsId) {
                        const ws = wallSystemTypes.find(t => t.id === wsId);
                        if (ws) {
                          update({
                            wallSystemId: wsId,
                            thickness: ws.totalThickness,
                          });
                        }
                      } else {
                        update({ wallSystemId: undefined });
                      }
                    }}
                  >
                    <option value="">(None)</option>
                    {wallSystemTypes.map((ws) => (
                      <option key={ws.id} value={ws.id}>{ws.name} ({formatNumber(ws.totalThickness, 0, unitSettings.numberFormat)}mm)</option>
                    ))}
                  </select>
                  {w.wallSystemId && (() => {
                    const ws = wallSystemTypes.find(t => t.id === w.wallSystemId);
                    if (!ws) return null;
                    return (
                      <div className="mt-1 p-2 bg-cad-bg rounded border border-cad-border">
                        <div className="text-[10px] text-cad-text-dim font-medium mb-1">
                          {ws.category} &middot; {ws.layers.length} layers &middot; {formatNumber(ws.totalThickness, 1, unitSettings.numberFormat)}mm
                        </div>
                        <div className="space-y-0.5">
                          {ws.layers.map((layer) => (
                            <div key={layer.id} className="flex items-center gap-1 text-[10px]">
                              <span className="w-2 h-2 rounded-sm inline-block" style={{ backgroundColor: layer.color }} />
                              <span className="text-cad-text">{layer.name}</span>
                              <span className="text-cad-text-dim ml-auto">{layer.thickness}mm</span>
                            </div>
                          ))}
                        </div>
                        <button
                          onClick={() => useAppStore.getState().openWallSystemDialog()}
                          className="mt-1.5 px-2 py-0.5 text-[10px] bg-cad-accent/20 text-cad-accent border border-cad-accent/30 rounded hover:bg-cad-accent/30"
                        >
                          Edit Wall System...
                        </button>
                      </div>
                    );
                  })()}
                </div>
              );
            })()}
            {/* Sub-element info */}
            {(() => {
              const subEl = useAppStore.getState().selectedWallSubElement;
              if (!subEl || subEl.wallId !== shape.id) return null;
              const wallSystemTypes = useAppStore.getState().wallSystemTypes;
              const ws = w.wallSystemId ? wallSystemTypes.find(t => t.id === w.wallSystemId) : null;
              if (!ws) return null;

              return (
                <div className="mb-3 p-2 bg-green-900/20 rounded border border-green-500/30">
                  <div className="text-[10px] font-medium text-green-400 mb-1">
                    Selected: {subEl.type === 'stud' ? 'Stud' : 'Panel'} [{subEl.key}]
                  </div>
                  {subEl.type === 'stud' && (
                    <div>
                      <label className={labelClass}>Replace Stud</label>
                      <select
                        className={inputClass}
                        value=""
                        onChange={(e) => {
                          if (!e.target.value) return;
                          const overrides = { ...(w.wallSystemStudOverrides || {}) };
                          overrides[subEl.key] = e.target.value;
                          update({ wallSystemStudOverrides: overrides });
                        }}
                      >
                        <option value="">Select replacement...</option>
                        <option value={ws.defaultStud.id}>{ws.defaultStud.name} (default)</option>
                        {ws.alternateStuds.map(s => (
                          <option key={s.id} value={s.id}>{s.name}</option>
                        ))}
                      </select>
                    </div>
                  )}
                  {subEl.type === 'panel' && (
                    <div>
                      <label className={labelClass}>Replace Panel</label>
                      <select
                        className={inputClass}
                        value=""
                        onChange={(e) => {
                          if (!e.target.value) return;
                          const overrides = { ...(w.wallSystemPanelOverrides || {}) };
                          overrides[subEl.key] = e.target.value;
                          update({ wallSystemPanelOverrides: overrides });
                        }}
                      >
                        <option value="">Select replacement...</option>
                        <option value={ws.defaultPanel.id}>{ws.defaultPanel.name} (default)</option>
                        {ws.alternatePanels.map(p => (
                          <option key={p.id} value={p.id}>{p.name}</option>
                        ))}
                      </select>
                    </div>
                  )}
                  <button
                    onClick={() => useAppStore.getState().clearWallSubElement()}
                    className="mt-1 px-2 py-0.5 text-[10px] text-cad-text-dim border border-cad-border rounded hover:bg-cad-hover"
                  >
                    Clear Selection
                  </button>
                </div>
              );
            })()}
            <TextField label="Label" value={w.label || ''} onChange={(v) => update({ label: v || undefined })} />
          </PropertyGroup>

          <PropertyGroup label="Constraints">
            <div className="mb-2">
              <label className={labelClass}>Base Level</label>
              <select
                className={inputClass}
                value={w.baseLevel || ''}
                onChange={(e) => update({ baseLevel: e.target.value || undefined })}
              >
                <option value="">(Unconnected)</option>
                {allStoreys.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} ({s.elevation >= 0 ? '+' : ''}{s.elevation} mm)
                  </option>
                ))}
              </select>
            </div>
            <div className="mb-2">
              <label className={labelClass}>Top Level</label>
              <select
                className={inputClass}
                value={w.topLevel || ''}
                onChange={(e) => update({ topLevel: e.target.value || undefined })}
              >
                <option value="">(Unconnected)</option>
                {allStoreys.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} ({s.elevation >= 0 ? '+' : ''}{s.elevation} mm)
                  </option>
                ))}
              </select>
            </div>
          </PropertyGroup>

          <PropertyGroup label="Geometry">
            <NumberField label="Thickness (mm)" value={w.thickness} onChange={(v) => update({ thickness: v })} step={1} min={1} />
            <div className="mb-3 p-2 bg-cad-bg rounded border border-cad-border">
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                <div className="text-cad-text-dim">Length:</div>
                <div className="text-cad-text">{formatLength(length, unitSettings)}</div>
                <div className="text-cad-text-dim">Angle:</div>
                <div className="text-cad-text">{formatAngle(angle, unitSettings)}</div>
              </div>
            </div>
            <div className="mb-3">
              <label className="block text-xs font-semibold text-cad-text mb-2">Start Point</label>
              <div className="grid grid-cols-2 gap-2">
                <NumberField label="X" value={w.start.x} onChange={(v) => update({ start: { ...w.start, x: v } })} step={1} />
                <NumberField label="Y" value={-w.start.y} onChange={(v) => update({ start: { ...w.start, y: -v } })} step={1} />
              </div>
            </div>
            <div className="mb-3">
              <label className="block text-xs font-semibold text-cad-text mb-2">End Point</label>
              <div className="grid grid-cols-2 gap-2">
                <NumberField label="X" value={w.end.x} onChange={(v) => update({ end: { ...w.end, x: v } })} step={1} />
                <NumberField label="Y" value={-w.end.y} onChange={(v) => update({ end: { ...w.end, y: -v } })} step={1} />
              </div>
            </div>
          </PropertyGroup>

          <PropertyGroup label="Display">
            <SelectField<WallJustification>
              label="Justification"
              value={w.justification}
              options={[
                { value: 'center', label: 'Center' },
                { value: 'left', label: 'Left' },
                { value: 'right', label: 'Right' },
              ]}
              onChange={(v) => update({ justification: v })}
            />
            <CheckboxField label="Show Centerline" value={w.showCenterline} onChange={(v) => update({ showCenterline: v })} />
            <CheckboxField label="Space Bounding" value={w.spaceBounding ?? true} onChange={(v) => update({ spaceBounding: v })} />
            <SelectField<WallEndCap>
              label="Start Cap"
              value={w.startCap}
              options={[
                { value: 'butt', label: 'Butt' },
                { value: 'miter', label: 'Miter' },
              ]}
              onChange={(v) => update({ startCap: v })}
            />
            <SelectField<WallEndCap>
              label="End Cap"
              value={w.endCap}
              options={[
                { value: 'butt', label: 'Butt' },
                { value: 'miter', label: 'Miter' },
              ]}
              onChange={(v) => update({ endCap: v })}
            />
          </PropertyGroup>
        </>
      );
    }

    case 'slab': {
      const sl = shape as SlabShape;
      // Calculate area using shoelace formula
      let area = 0;
      for (let i = 0; i < sl.points.length; i++) {
        const j = (i + 1) % sl.points.length;
        area += sl.points[i].x * sl.points[j].y;
        area -= sl.points[j].x * sl.points[i].y;
      }
      area = Math.abs(area) / 2;
      // Calculate perimeter
      let perimeter = 0;
      for (let i = 0; i < sl.points.length; i++) {
        const j = (i + 1) % sl.points.length;
        const pdx = sl.points[j].x - sl.points[i].x;
        const pdy = sl.points[j].y - sl.points[i].y;
        perimeter += Math.sqrt(pdx * pdx + pdy * pdy);
      }

      return (
        <>
          <PropertyGroup label="Identity">
            <div className="mb-3 p-2 bg-cad-bg rounded border border-cad-border">
              <div className="text-xs font-semibold text-cad-accent mb-1">IfcSlab</div>
              <div className="text-xs text-cad-text-dim">IFC Type: IfcSlab</div>
            </div>
            <TextField label="Label" value={sl.label || ''} onChange={(v) => update({ label: v || undefined })} />
            <SelectField<SlabMaterial>
              label="Material"
              value={sl.material}
              options={[
                { value: 'concrete', label: 'Concrete' },
                { value: 'timber', label: 'Timber' },
                { value: 'steel', label: 'Steel' },
                { value: 'generic', label: 'Generic' },
              ]}
              onChange={(v) => update({ material: v })}
            />
          </PropertyGroup>

          <PropertyGroup label="Geometry">
            <NumberField label="Thickness (mm)" value={sl.thickness} onChange={(v) => update({ thickness: v })} step={1} min={1} />
            <TextField label="Level" value={sl.level} onChange={(v) => update({ level: v })} />
            <NumberField label="Elevation (mm)" value={sl.elevation} onChange={(v) => update({ elevation: v })} step={1} />
            <div className="mb-3 p-2 bg-cad-bg rounded border border-cad-border">
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                <div className="text-cad-text-dim">Points:</div>
                <div className="text-cad-text">{sl.points.length}</div>
                <div className="text-cad-text-dim">Area:</div>
                <div className="text-cad-text">{formatNumber(area, 2, unitSettings.numberFormat)} mm2</div>
                <div className="text-cad-text-dim">Perimeter:</div>
                <div className="text-cad-text">{formatLength(perimeter, unitSettings)}</div>
              </div>
            </div>
          </PropertyGroup>

          <PropertyGroup label="Display">
            <p className="text-[10px] text-cad-text-dim px-1 py-2">
              Hatch pattern is defined per material in Drawing Standards.
            </p>
          </PropertyGroup>
        </>
      );
    }

    case 'space': {
      const sp = shape as SpaceShape;

      return (
        <>
          <PropertyGroup label="Identity">
            <div className="mb-3 p-2 bg-cad-bg rounded border border-cad-border">
              <div className="text-xs font-semibold text-cad-accent mb-1">IfcSpace</div>
              <div className="text-xs text-cad-text-dim">IFC Type: IfcSpace</div>
            </div>
            <TextField label="Name" value={sp.name} onChange={(v) => update({ name: v })} />
            <TextField label="Number" value={sp.number || ''} onChange={(v) => update({ number: v || undefined })} />
            <TextField label="Level" value={sp.level || ''} onChange={(v) => update({ level: v || undefined })} />
          </PropertyGroup>

          <PropertyGroup label="Geometry">
            <div className="mb-3 p-2 bg-cad-bg rounded border border-cad-border">
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                <div className="text-cad-text-dim">Points:</div>
                <div className="text-cad-text">{sp.contourPoints.length}</div>
                <div className="text-cad-text-dim">Area:</div>
                <div className="text-cad-text">{formatNumber(sp.area ?? 0, 2, unitSettings.numberFormat)} m{'\u00B2'}</div>
              </div>
            </div>
          </PropertyGroup>

          <PropertyGroup label="Display">
            <TextField label="Fill Color" value={sp.fillColor || '#00ff00'} onChange={(v) => update({ fillColor: v })} />
            <NumberField label="Fill Opacity" value={sp.fillOpacity ?? 0.1} onChange={(v) => update({ fillOpacity: v })} step={0.05} min={0} max={1} />
          </PropertyGroup>
        </>
      );
    }

    case 'section-callout': {
      const sc = shape as SectionCalloutShape;
      const scdx = sc.end.x - sc.start.x;
      const scdy = sc.end.y - sc.start.y;
      const scLength = Math.sqrt(scdx * scdx + scdy * scdy);
      const scAngle = Math.atan2(scdy, scdx) * RAD2DEG;

      return (
        <>
          <PropertyGroup label="Identity">
            <div className="mb-3 p-2 bg-cad-bg rounded border border-cad-border">
              <div className="text-xs font-semibold text-cad-accent mb-1">Section Callout</div>
              <div className="text-xs text-cad-text-dim">Type: {sc.calloutType === 'section' ? 'Section' : 'Detail'}</div>
            </div>
            <TextField label="Label" value={sc.label} onChange={(v) => update({ label: v })} />
          </PropertyGroup>

          <PropertyGroup label="Geometry">
            <div className="mb-3 p-2 bg-cad-bg rounded border border-cad-border">
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                <div className="text-cad-text-dim">Length:</div>
                <div className="text-cad-text">{formatLength(scLength, unitSettings)}</div>
                <div className="text-cad-text-dim">Angle:</div>
                <div className="text-cad-text">{formatAngle(scAngle, unitSettings)}</div>
              </div>
            </div>

            <div className="mb-3">
              <label className="block text-xs font-semibold text-cad-text mb-2">Start Point</label>
              <div className="grid grid-cols-2 gap-2">
                <NumberField label="X" value={sc.start.x} onChange={(v) => update({ start: { ...sc.start, x: v } })} step={1} />
                <NumberField label="Y" value={-sc.start.y} onChange={(v) => update({ start: { ...sc.start, y: -v } })} step={1} />
              </div>
            </div>

            <div className="mb-3">
              <label className="block text-xs font-semibold text-cad-text mb-2">End Point</label>
              <div className="grid grid-cols-2 gap-2">
                <NumberField label="X" value={sc.end.x} onChange={(v) => update({ end: { ...sc.end, x: v } })} step={1} />
                <NumberField label="Y" value={-sc.end.y} onChange={(v) => update({ end: { ...sc.end, y: -v } })} step={1} />
              </div>
            </div>
          </PropertyGroup>

          <PropertyGroup label="View">
            <NumberField label="View Depth (mm)" value={sc.viewDepth ?? 5000} onChange={(v) => update({ viewDepth: v })} step={500} min={0} />
          </PropertyGroup>

          <PropertyGroup label="Display">
            <NumberField label="Bubble Radius (mm)" value={sc.bubbleRadius} onChange={(v) => update({ bubbleRadius: v })} step={50} min={100} />
            <NumberField label="Font Size (mm)" value={sc.fontSize} onChange={(v) => update({ fontSize: v })} step={25} min={50} />
            <CheckboxField label="Flip Direction" value={sc.flipDirection} onChange={(v) => update({ flipDirection: v })} />
            <CheckboxField label="Show Start Head" value={!sc.hideStartHead} onChange={(v) => update({ hideStartHead: !v })} />
            <CheckboxField label="Show End Head" value={!sc.hideEndHead} onChange={(v) => update({ hideEndHead: !v })} />
          </PropertyGroup>
        </>
      );
    }

    case 'plate-system':
      return <PlateSystemShapeProperties shape={shape as PlateSystemShape} updateShape={updateShape} />;

    case 'pile': {
      const pile = shape as PileShape;
      return (
        <PileShapeProperties pile={pile} update={update} />
      );
    }

    case 'cpt': {
      const cpt = shape as CPTShape;
      return (
        <>
          <PropertyGroup label="Identity">
            <TextField label="Name" value={cpt.name || ''} onChange={(v) => update({ name: v })} placeholder="01, 02..." />
          </PropertyGroup>
          <PropertyGroup label="Options">
            <CheckboxField label="Kleefmeting" value={cpt.kleefmeting ?? false} onChange={(v) => update({ kleefmeting: v })} />
            <CheckboxField label="Waterspanning" value={cpt.waterspanning ?? false} onChange={(v) => update({ waterspanning: v })} />
            <CheckboxField label="Uitgevoerd" value={cpt.uitgevoerd ?? false} onChange={(v) => update({ uitgevoerd: v })} />
          </PropertyGroup>
          <PropertyGroup label="Display">
            <NumberField label="Marker Size (mm)" value={cpt.markerSize} onChange={(v) => update({ markerSize: v })} step={50} min={100} />
            <NumberField label="Font Size (mm)" value={cpt.fontSize} onChange={(v) => update({ fontSize: v })} step={25} min={50} />
            <NumberField label="Position X" value={cpt.position.x} onChange={(v) => update({ position: { ...cpt.position, x: v } })} step={1} />
            <NumberField label="Position Y" value={-cpt.position.y} onChange={(v) => update({ position: { ...cpt.position, y: -v } })} step={1} />
          </PropertyGroup>
        </>
      );
    }

    default:
      return (
        <div className="text-xs text-cad-text-dim">
          ID: {shape.id.slice(0, 8)}...
        </div>
      );
  }
}

// ============================================================================
// Tool-Specific Property Panels (shown when a drawing tool is active, no selection)
// ============================================================================

/** Wall tool properties - edits pendingWall state */
function WallToolProperties() {
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
function BeamToolProperties() {
  const pendingBeam = useAppStore(s => s.pendingBeam);
  const setPendingBeam = useAppStore(s => s.setPendingBeam);

  if (!pendingBeam) return null;

  return (
    <div className="p-3 border-b border-cad-border">
      <div className="flex items-center gap-2 mb-3">
        <span className="text-xs font-semibold text-cad-accent uppercase tracking-wide">Beam Tool</span>
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
function SlabToolProperties() {
  const pendingSlab = useAppStore(s => s.pendingSlab);
  const setPendingSlab = useAppStore(s => s.setPendingSlab);
  const slabTypes = useAppStore(s => s.slabTypes);

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
        <TextField
          label="Level"
          value={pendingSlab.level}
          onChange={(v) => setPendingSlab({ ...pendingSlab, level: v })}
          placeholder="e.g. 0, 1, 2"
        />
        <NumberField
          label="Elevation (mm)"
          value={pendingSlab.elevation}
          onChange={(v) => setPendingSlab({ ...pendingSlab, elevation: v })}
          step={100}
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

/** Space tool properties - edits pendingSpace state */
function SpaceToolProperties() {
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
          label="Level"
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
function GridlineToolProperties() {
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
function LevelToolProperties() {
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
function PuntniveauToolProperties() {
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

// ---------------------------------------------------------------------------
// Pile Symbol Picker – compact grid of SVG pile symbol thumbnails
// ---------------------------------------------------------------------------

const PILE_SYMBOL_THUMB = 32; // thumbnail size in px

/** A set of representative symbols shown in the picker (first from each contour group). */
const PICKER_SYMBOLS = (() => {
  // Pick a curated set: first few from each contour group to keep it compact
  const ids = ['R6', 'R1', 'R2', 'R3', 'R4', 'R5', 'R7', 'R8',
    'RH6', 'RH1', 'RH4',
    'RD6', 'RD1',
    'RR6', 'RR1',
    'RRR6', 'RRR1',
    'DR6',
    'Achthoek_1',
  ];
  const map = new Map(ALL_PILE_SYMBOLS.map(s => [s.id, s]));
  return ids.map(id => map.get(id)).filter(Boolean) as typeof ALL_PILE_SYMBOLS;
})();

function PileSymbolPicker({
  contourType,
  fillPattern,
  onChange,
}: {
  contourType: PileContourType | undefined;
  fillPattern: number | undefined;
  onChange: (contourType: PileContourType, fillPattern: number) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const ct = contourType ?? 'circle';
  const fp = fillPattern ?? 6;

  // Find the currently active symbol
  const activeSymbol = ALL_PILE_SYMBOLS.find(s => s.contour === ct && s.fillPattern === fp);

  // Symbols to display: either the curated set or the full list
  const displaySymbols = expanded ? ALL_PILE_SYMBOLS : PICKER_SYMBOLS;

  return (
    <div className="mb-2">
      <div className="flex items-center justify-between mb-1">
        <label className={labelClass}>Symbol</label>
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          className="text-[9px] text-cad-accent hover:underline"
        >
          {expanded ? 'Minder' : `Alle (${ALL_PILE_SYMBOLS.length})`}
        </button>
      </div>
      <div
        className={`grid gap-0.5 ${expanded ? 'max-h-48 overflow-y-auto' : ''}`}
        style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${PILE_SYMBOL_THUMB + 8}px, 1fr))` }}
      >
        {displaySymbols.map(sym => {
          const isActive = sym.contour === ct && sym.fillPattern === fp;
          const clipId = `pp-clip-${sym.id}`;
          return (
            <button
              key={sym.id}
              type="button"
              onClick={() => onChange(sym.contour as PileContourType, sym.fillPattern)}
              className={`flex items-center justify-center p-0.5 rounded border transition-colors
                ${isActive
                  ? 'border-cad-accent bg-cad-accent/20 ring-1 ring-cad-accent'
                  : 'border-cad-border hover:bg-cad-bg-hover hover:border-cad-text-dim'}
              `}
              title={sym.label}
            >
              <svg
                width={PILE_SYMBOL_THUMB}
                height={PILE_SYMBOL_THUMB}
                viewBox={`0 0 ${PILE_SYMBOL_THUMB} ${PILE_SYMBOL_THUMB}`}
                className="bg-white rounded-sm"
              >
                {renderPileSymbol(sym.contour, sym.fillPattern, PILE_SYMBOL_THUMB, clipId)}
              </svg>
            </button>
          );
        })}
      </div>
      {activeSymbol && (
        <div className="text-[9px] text-cad-text-dim mt-1 px-0.5">
          {activeSymbol.label}
        </div>
      )}
    </div>
  );
}

/** Pile tool properties - edits pendingPile state */
function PileToolProperties() {
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

/** CPT tool properties - edits pendingCPT state */
function CPTToolProperties() {
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
function SectionCalloutToolProperties() {
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
function LineToolProperties() {
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

/** Renders the appropriate tool-specific panel based on active tool */
function ActiveToolProperties({ activeTool }: { activeTool: string }) {
  switch (activeTool) {
    case 'line':
      return <LineToolProperties />;
    case 'wall':
      return <WallToolProperties />;
    case 'beam':
      return <BeamToolProperties />;
    case 'slab':
      return <SlabToolProperties />;
    case 'gridline':
      return <GridlineToolProperties />;
    case 'level':
      return <LevelToolProperties />;
    case 'puntniveau':
      return <PuntniveauToolProperties />;
    case 'pile':
      return <PileToolProperties />;
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

/** Pile shape properties - shown when a pile shape is selected */
function PileShapeProperties({ pile, update }: { pile: PileShape; update: (updates: Record<string, unknown>) => void }) {
  const pileTypes = useAppStore(s => s.pileTypes);

  const selectedPileType = pile.pileTypeId
    ? pileTypes.find(pt => pt.id === pile.pileTypeId)
    : undefined;

  // Group pile types by method for the dropdown
  const methodGroups = new Map<string, PileTypeDefinition[]>();
  for (const pt of pileTypes) {
    const list = methodGroups.get(pt.method) || [];
    list.push(pt);
    methodGroups.set(pt.method, list);
  }

  return (
    <>
      <PropertyGroup label="Pile Type">
        <div className="mb-2">
          <label className={labelClass}>Type</label>
          <select
            value={pile.pileTypeId || ''}
            onChange={(e) => {
              const typeId = e.target.value || undefined;
              const pt = typeId ? pileTypes.find(p => p.id === typeId) : undefined;
              const updates: Record<string, unknown> = { pileTypeId: typeId };
              if (pt) {
                updates.diameter = pt.defaultDiameter;
                updates.contourType = pt.shape === 'round' ? 'circle' : 'square';
              }
              update(updates);
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
          contourType={pile.contourType}
          fillPattern={pile.fillPattern}
          onChange={(ct, fp) => update({ contourType: ct, fillPattern: fp })}
        />
      </PropertyGroup>
      <PropertyGroup label="Identity">
        <TextField label="Label" value={pile.label || ''} onChange={(v) => update({ label: v })} />
      </PropertyGroup>
      <PropertyGroup label="Dimensions">
        <NumberField label="Diameter (mm)" value={pile.diameter} onChange={(v) => update({ diameter: v })} step={50} min={100} disabled={!!pile.pileTypeId} />
        <NumberField label="Puntniveau t.o.v. NAP (m)" value={pile.puntniveauNAP ?? 0} onChange={(v) => update({ puntniveauNAP: v, puntniveauFromArea: false })} step={0.5} disabled={!!pile.puntniveauFromArea} />
        <NumberField label="Bk. Paal t.o.v. peil (mm)" value={pile.bkPaalPeil ?? 0} onChange={(v) => update({ bkPaalPeil: v })} step={50} />
      </PropertyGroup>
      <PropertyGroup label="Display">
        <NumberField label="Font Size (mm)" value={pile.fontSize} onChange={(v) => update({ fontSize: v })} step={25} min={50} />
        <CheckboxField label="Show Cross" value={pile.showCross} onChange={(v) => update({ showCross: v })} />
      </PropertyGroup>
    </>
  );
}

/** Plate System shape properties - shown when a PlateSystem shape is selected */
function PlateSystemShapeProperties({ shape, updateShape }: { shape: PlateSystemShape; updateShape: (id: string, updates: Partial<Shape>) => void }) {
  const update = (updates: Record<string, unknown>) => updateShape(shape.id, updates as Partial<Shape>);
  const unitSettings = useUnitSettings();
  const ps = shape;

  // Profile picker dialog state: which target is being browsed ('main' or 'edge')
  const [profilePickerTarget, setProfilePickerTarget] = useState<'main' | 'edge' | null>(null);

  // Calculate area using shoelace formula
  let psArea = 0;
  for (let i = 0; i < ps.contourPoints.length; i++) {
    const j = (i + 1) % ps.contourPoints.length;
    psArea += ps.contourPoints[i].x * ps.contourPoints[j].y;
    psArea -= ps.contourPoints[j].x * ps.contourPoints[i].y;
  }
  psArea = Math.abs(psArea) / 2;
  // Calculate perimeter
  let psPerimeter = 0;
  for (let i = 0; i < ps.contourPoints.length; i++) {
    const j = (i + 1) % ps.contourPoints.length;
    const pdx = ps.contourPoints[j].x - ps.contourPoints[i].x;
    const pdy = ps.contourPoints[j].y - ps.contourPoints[i].y;
    psPerimeter += Math.sqrt(pdx * pdx + pdy * pdy);
  }
  const joistCount = ps.mainProfile.spacing > 0
    ? Math.floor(Math.sqrt(psArea) / ps.mainProfile.spacing) + 1
    : 0;

  const SYSTEM_TYPE_LABELS: Record<string, string> = {
    'timber-floor': 'Timber Floor (Houten Balklaag)',
    'hsb-wall': 'HSB Wall (Houtskeletbouw)',
    'ceiling': 'Suspended Ceiling',
    'custom': 'Custom',
  };

  return (
    <>
      <PropertyGroup label="Identity">
        <div className="mb-3 p-2 bg-cad-bg rounded border border-cad-border">
          <div className="text-xs font-semibold text-cad-accent mb-1">Plate System</div>
          <div className="text-xs text-cad-text-dim">Type: {SYSTEM_TYPE_LABELS[ps.systemType] || ps.systemType}</div>
        </div>
        <TextField label="Name" value={ps.name || ''} onChange={(v) => update({ name: v || undefined })} />
        <SelectField<string>
          label="System Type"
          value={ps.systemType}
          options={[
            { value: 'timber-floor', label: 'Timber Floor' },
            { value: 'hsb-wall', label: 'HSB Wall' },
            { value: 'ceiling', label: 'Ceiling' },
            { value: 'custom', label: 'Custom' },
          ]}
          onChange={(v) => update({ systemType: v })}
        />
      </PropertyGroup>

      <PropertyGroup label="Main Profile">
        <div className="mb-2 flex items-center gap-1">
          {ps.mainProfile.profileId ? (() => {
            const profilePreset = getPresetById(ps.mainProfile.profileId!);
            return profilePreset ? (
              <div className="flex-1 p-2 bg-cad-bg rounded border border-cad-border text-xs">
                <span className="text-cad-text-dim">Profile: </span>
                <span className="text-cad-text font-semibold">{profilePreset.name}</span>
                <span className="text-cad-text-dim ml-1">({profilePreset.standard} {profilePreset.category})</span>
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
          value={ps.mainProfile.width}
          onChange={(v) => update({ mainProfile: { ...ps.mainProfile, width: v } })}
          step={5} min={10}
        />
        <NumberField
          label="Height (mm)"
          value={ps.mainProfile.height}
          onChange={(v) => update({ mainProfile: { ...ps.mainProfile, height: v } })}
          step={5} min={10}
        />
        <NumberField
          label="Spacing h.o.h. (mm)"
          value={ps.mainProfile.spacing}
          onChange={(v) => update({ mainProfile: { ...ps.mainProfile, spacing: v } })}
          step={50} min={50}
        />
        <NumberField
          label="Direction (deg)"
          value={ps.mainProfile.direction * RAD2DEG}
          onChange={(v) => update({ mainProfile: { ...ps.mainProfile, direction: v * DEG2RAD } })}
          step={15}
        />
        <SelectField<string>
          label="Material"
          value={ps.mainProfile.material}
          options={[
            { value: 'timber', label: 'Timber' },
            { value: 'steel', label: 'Steel' },
            { value: 'concrete', label: 'Concrete' },
            { value: 'aluminum', label: 'Aluminum' },
            { value: 'generic', label: 'Generic' },
          ]}
          onChange={(v) => update({ mainProfile: { ...ps.mainProfile, material: v } })}
        />
      </PropertyGroup>

      <PropertyGroup label="Geometry">
        <div className="mb-3 p-2 bg-cad-bg rounded border border-cad-border">
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
            <div className="text-cad-text-dim">Contour Points:</div>
            <div className="text-cad-text">{ps.contourPoints.length}</div>
            <div className="text-cad-text-dim">Area:</div>
            <div className="text-cad-text">{formatNumber(psArea, 2, unitSettings.numberFormat)} mm2</div>
            <div className="text-cad-text-dim">Perimeter:</div>
            <div className="text-cad-text">{formatLength(psPerimeter, unitSettings)}</div>
            <div className="text-cad-text-dim">Est. Joists:</div>
            <div className="text-cad-text">~{joistCount}</div>
          </div>
        </div>
      </PropertyGroup>

      {ps.edgeProfile && (
        <PropertyGroup label="Edge Beams">
          <div className="mb-2 flex items-center gap-1">
            {ps.edgeProfile.profileId ? (() => {
              const edgePreset = getPresetById(ps.edgeProfile!.profileId!);
              return edgePreset ? (
                <div className="flex-1 p-2 bg-cad-bg rounded border border-cad-border text-xs">
                  <span className="text-cad-text-dim">Profile: </span>
                  <span className="text-cad-text font-semibold">{edgePreset.name}</span>
                  <span className="text-cad-text-dim ml-1">({edgePreset.standard} {edgePreset.category})</span>
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
          {ps.contourPoints.map((pt, idx) => {
            const nextIdx = (idx + 1) % ps.contourPoints.length;
            const nextPt = ps.contourPoints[nextIdx];
            const edgeDx = nextPt.x - pt.x;
            const edgeDy = nextPt.y - pt.y;
            const edgeLen = Math.sqrt(edgeDx * edgeDx + edgeDy * edgeDy);
            // Default: all edges enabled when edgeBeamEnabled is undefined
            const enabled = ps.edgeBeamEnabled ? ps.edgeBeamEnabled[idx] !== false : true;

            return (
              <div key={idx} className="mb-1 flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={enabled}
                  onChange={(e) => {
                    const n = ps.contourPoints.length;
                    const newEnabled = ps.edgeBeamEnabled
                      ? [...ps.edgeBeamEnabled]
                      : new Array(n).fill(true);
                    // Ensure array is at least long enough
                    while (newEnabled.length < n) newEnabled.push(true);
                    newEnabled[idx] = e.target.checked;
                    // Update edgeBeamEnabled on shape
                    updateShape(shape.id, { edgeBeamEnabled: newEnabled } as any);
                    // Regenerate child beams using centralized utility
                    // (edgeBeamEnabled was just updated on the shape above,
                    //  but the store hasn't flushed yet so we trigger a micro-delay)
                    setTimeout(() => regeneratePlateSystemBeams(shape.id), 0);
                  }}
                  className="accent-cad-accent"
                />
                <label className="text-xs text-cad-text">
                  Edge {idx + 1}
                  <span className="text-cad-text-dim ml-1">({formatLength(edgeLen, unitSettings)})</span>
                </label>
              </div>
            );
          })}
        </PropertyGroup>
      )}

      {ps.layers && ps.layers.length > 0 && (
        <PropertyGroup label="Layers">
          {ps.layers.map((layer, idx) => (
            <div key={idx} className="mb-2 p-2 bg-cad-bg rounded border border-cad-border text-xs">
              <div className="font-semibold text-cad-text">{layer.name}</div>
              <div className="text-cad-text-dim">{layer.thickness}mm {layer.material} ({layer.position})</div>
            </div>
          ))}
        </PropertyGroup>
      )}

      <PropertyGroup label="Openings">
        <div className="mb-2">
          <button
            className="w-full py-1.5 text-xs bg-orange-900/40 hover:bg-orange-800/50 border border-orange-600/40 text-orange-200 rounded transition-colors"
            onClick={() => {
              const s = useAppStore.getState();
              if (s.plateSystemEditMode && s.editingPlateSystemId === shape.id) {
                s.setPlateSystemOpeningMode(true);
              } else {
                // Enter edit mode first, then activate opening mode
                s.setPlateSystemEditMode(true, shape.id);
                s.setPlateSystemOpeningMode(true);
              }
            }}
          >
            + Add Opening
          </button>
        </div>
        {(ps.openings ?? []).length === 0 && (
          <div className="text-xs text-cad-text-dim italic">No openings</div>
        )}
        {(ps.openings ?? []).map((opening, idx) => (
          <div key={opening.id} className="mb-2 p-2 bg-cad-bg rounded border border-cad-border">
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs font-semibold text-orange-300">Opening {idx + 1}</span>
              <button
                className="text-[10px] text-red-400 hover:text-red-300"
                onClick={() => {
                  const newOpenings = (ps.openings ?? []).filter(o => o.id !== opening.id);
                  update({ openings: newOpenings });
                  const s = useAppStore.getState();
                  if (s.selectedOpeningId === opening.id) {
                    s.setSelectedOpeningId(null);
                  }
                }}
              >
                Delete
              </button>
            </div>
            <NumberField
              label="Width (mm)"
              value={opening.width}
              onChange={(v) => {
                const newOpenings = (ps.openings ?? []).map(o =>
                  o.id === opening.id ? { ...o, width: v } : o
                );
                update({ openings: newOpenings });
              }}
              min={10}
            />
            <NumberField
              label="Height (mm)"
              value={opening.height}
              onChange={(v) => {
                const newOpenings = (ps.openings ?? []).map(o =>
                  o.id === opening.id ? { ...o, height: v } : o
                );
                update({ openings: newOpenings });
              }}
              min={10}
            />
            <NumberField
              label="Rotation (deg)"
              value={(opening.rotation ?? 0) * RAD2DEG}
              onChange={(v) => {
                const newOpenings = (ps.openings ?? []).map(o =>
                  o.id === opening.id ? { ...o, rotation: v * DEG2RAD } : o
                );
                update({ openings: newOpenings });
              }}
            />
            <div className="text-[10px] text-cad-text-dim mt-1">
              Position: ({formatNumber(opening.position.x, 0, unitSettings.numberFormat)}, {formatNumber(-opening.position.y, 0, unitSettings.numberFormat)})
            </div>
          </div>
        ))}
      </PropertyGroup>

      {/* Profile picker dialog (SectionDialog) for browsing profiles */}
      <SectionDialog
        isOpen={profilePickerTarget !== null}
        onClose={() => setProfilePickerTarget(null)}
        onInsert={(_profileType: ProfileType, _parameters: ParameterValues, presetId?: string) => {
          if (!presetId) {
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
            update({
              mainProfile: {
                ...ps.mainProfile,
                profileId: presetId,
                ...(width !== undefined ? { width } : {}),
                ...(height !== undefined ? { height } : {}),
              },
            });
          } else if (profilePickerTarget === 'edge' && ps.edgeProfile) {
            update({
              edgeProfile: {
                ...ps.edgeProfile,
                profileId: presetId,
                ...(width !== undefined ? { width } : {}),
                ...(height !== undefined ? { height } : {}),
              },
            });
          }
          setProfilePickerTarget(null);
        }}
      />
    </>
  );
}

/** Plate System tool properties - edits pendingPlateSystem state */
function PlateSystemToolProperties() {
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

function ArrayToolProperties() {
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

function HatchToolProperties() {
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

export const PropertiesPanel = memo(function PropertiesPanel() {
  const selectedShapeIds = useAppStore(s => s.selectedShapeIds);
  const selectionFilter = useAppStore(s => s.selectionFilter);
  const shapes = useAppStore(s => s.shapes);
  const parametricShapes = useAppStore(s => s.parametricShapes);
  const currentStyle = useAppStore(s => s.currentStyle);
  const setCurrentStyle = useAppStore(s => s.setCurrentStyle);
  const updateShape = useAppStore(s => s.updateShape);
  const activeTool = useAppStore(s => s.activeTool);
  const show3DView = useAppStore(s => s.show3DView);

  const selectedIdSet = useMemo(() => new Set(selectedShapeIds), [selectedShapeIds]);
  const selectedShapes = shapes.filter((s) => {
    if (!selectedIdSet.has(s.id)) return false;
    if (selectionFilter && s.type !== selectionFilter) return false;
    return true;
  });
  const selectedParametricShapes = parametricShapes.filter((s) => {
    if (!selectedIdSet.has(s.id)) return false;
    return true;
  });
  const hasSelection = selectedShapes.length > 0 || selectedParametricShapes.length > 0;
  const hasRegularShapeSelection = selectedShapes.length > 0;

  // Get common style from selection (or use current style)
  // For parametric shapes, use their style or fall back to current style
  const displayStyle = hasRegularShapeSelection
    ? selectedShapes[0].style
    : selectedParametricShapes.length > 0
      ? selectedParametricShapes[0].style
      : currentStyle;

  const handleColorChange = (color: string) => {
    if (hasRegularShapeSelection) {
      selectedShapes.forEach((shape) => {
        updateShape(shape.id, { style: { ...shape.style, strokeColor: color } });
      });
    } else {
      setCurrentStyle({ strokeColor: color });
    }
  };

  const handleWidthChange = (width: number) => {
    if (hasRegularShapeSelection) {
      selectedShapes.forEach((shape) => {
        updateShape(shape.id, { style: { ...shape.style, strokeWidth: width } });
      });
    } else {
      setCurrentStyle({ strokeWidth: width });
    }
  };

  const handleLineStyleChange = (lineStyle: LineStyle) => {
    if (hasRegularShapeSelection) {
      selectedShapes.forEach((shape) => {
        updateShape(shape.id, { style: { ...shape.style, lineStyle } });
      });
    } else {
      setCurrentStyle({ lineStyle });
    }
  };

  // Determine if a structural/drawing tool with pending state is active
  const isToolWithProperties = [
    'line', 'wall', 'beam', 'slab', 'plate-system', 'gridline', 'level', 'pile', 'cpt', 'section-callout', 'hatch', 'array',
  ].includes(activeTool);

  if (!hasSelection) {
    return (
      <div className="flex-1 overflow-auto">
        {isToolWithProperties && <ActiveToolProperties activeTool={activeTool} />}
        {show3DView ? (
          <div className="p-3 text-xs text-cad-text-dim">
            Select an element in the 3D view to see its properties.
          </div>
        ) : (
          <DrawingPropertiesPanel showHeader={false} />
        )}
      </div>
    );
  }

  // If only parametric shapes selected, show parametric properties
  if (selectedParametricShapes.length > 0 && selectedShapes.length === 0) {
    return (
      <div className="flex-1 overflow-auto">
        <div className="p-3">
          {/* Selection info */}
          <div className="text-xs text-cad-text-dim mb-4">
            {selectedParametricShapes.length} parametric shape{selectedParametricShapes.length > 1 ? 's' : ''} selected
          </div>

          {/* Parametric shape properties */}
          {selectedParametricShapes.length === 1 && (
            <ParametricShapeProperties shape={selectedParametricShapes[0]} />
          )}

          {selectedParametricShapes.length > 1 && (
            <div className="text-xs text-cad-text-dim">
              Select a single parametric shape to edit its properties.
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-auto">
      {isToolWithProperties && <ActiveToolProperties activeTool={activeTool} />}
      <div>
        {/* Hide Style section for walls, gridlines, piles, and slabs */}
        {!(selectedShapes.length > 0 && selectedShapes.every(s => s.type === 'wall' || s.type === 'gridline' || s.type === 'pile' || s.type === 'slab')) && <PropertyGroup label="Style">
          <ColorPalette label="Color" value={displayStyle.strokeColor} onChange={handleColorChange} />

          <LineweightInput value={displayStyle.strokeWidth} onChange={handleWidthChange} />

          <div className="mb-3">
            <label className="block text-xs text-cad-text-dim mb-1">Line Style</label>
            <select
              value={displayStyle.lineStyle}
              onChange={(e) => handleLineStyleChange(e.target.value as LineStyle)}
              className="w-full bg-cad-bg border border-cad-border rounded px-2 py-1 text-xs text-cad-text"
            >
              <option value="solid">Solid</option>
              <option value="dashed">Dashed</option>
              <option value="dotted">Dotted</option>
              <option value="dashdot">Dash-Dot</option>
            </select>
          </div>
        </PropertyGroup>}

        {/* Shape-specific properties - single selection */}
        {selectedShapes.length === 1 && selectedParametricShapes.length === 0 && (
          <ShapeProperties shape={selectedShapes[0]} updateShape={updateShape} />
        )}

        {/* Shape-specific properties - multi-selection of same type */}
        {selectedShapes.length > 1 && selectedParametricShapes.length === 0 && (() => {
          const firstType = selectedShapes[0].type;
          const allSameType = selectedShapes.every(s => s.type === firstType);
          if (!allSameType) return null;

          return (
            <MultiSelectShapeProperties shapes={selectedShapes} updateShape={updateShape} />
          );
        })()}
      </div>
    </div>
  );
});
