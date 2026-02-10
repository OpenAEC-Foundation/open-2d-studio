import { memo, useState, useRef, useEffect, useMemo } from 'react';
import { useAppStore } from '../../state/appStore';
import { formatLength, parseLength } from '../../units';
import type { UnitSettings } from '../../units/types';
import type { LineStyle, Shape, TextAlignment, TextVerticalAlignment, BeamShape, BeamMaterial, BeamJustification, LeaderArrowType, LeaderAttachment, LeaderConfig, TextCase } from '../../types/geometry';
import type { ParametricShape, ProfileParametricShape } from '../../types/parametric';
import type { DimensionShape, DimensionArrowType, DimensionTextPlacement } from '../../types/dimension';
import { PROFILE_TEMPLATES } from '../../services/parametric/profileTemplates';
import { DrawingPropertiesPanel } from './DrawingPropertiesPanel';
import { PatternPickerPanel } from '../editors/PatternManager/PatternPickerPanel';

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

  // Don't render if no styles available
  if (textStyles.length === 0) {
    return null;
  }

  const annotationStyles = textStyles.filter(s => !s.isModelText);
  const modelStyles = textStyles.filter(s => s.isModelText);

  return (
    <div className="mb-3 p-2 bg-cad-bg rounded border border-cad-border">
      <label className={labelClass}>Text Style</label>
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

function NumberField({ label, value, onChange, step = 1, min, max, readOnly, unitSettings }: {
  label: string; value: number; onChange: (v: number) => void;
  step?: number; min?: number; max?: number; readOnly?: boolean; unitSettings?: UnitSettings;
}) {
  const displayValue = unitSettings
    ? formatLength(value, { ...unitSettings, showUnitSuffix: false })
    : String(Math.round(value * 1000) / 1000);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (unitSettings) {
      onChange(parseLength(e.target.value, unitSettings));
    } else {
      onChange(parseFloat(e.target.value) || 0);
    }
  };

  return (
    <div className="mb-2">
      <label className={labelClass}>{label}</label>
      <input type="number" step={step} min={min} max={max} readOnly={readOnly}
        value={displayValue}
        onChange={handleChange}
        className={inputClass} />
    </div>
  );
}

function TextField({ label, value, onChange }: {
  label: string; value: string; onChange: (v: string) => void;
}) {
  return (
    <div className="mb-2">
      <label className={labelClass}>{label}</label>
      <input type="text" value={value}
        onChange={(e) => onChange(e.target.value)}
        className={inputClass} />
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

      return (
        <>
          <PropertyGroup label="Properties">
            <TextField
              label="Font Family"
              value={commonFontFamily ?? ''}
              onChange={(v) => updateAll({ fontFamily: v })}
            />
            <NumberField
              label="Font Size"
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
                { value: 'concrete', label: 'Concrete' },
                { value: 'timber', label: 'Timber' },
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

function ShapeProperties({ shape, updateShape }: { shape: Shape; updateShape: (id: string, updates: Partial<Shape>) => void }) {
  const update = (updates: Record<string, unknown>) => updateShape(shape.id, updates as Partial<Shape>);

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
            <NumberField label="Font Size" value={shape.fontSize} onChange={(v) => update({ fontSize: v })} step={1} min={1} />
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
            <NumberField label="Position Y" value={shape.position.y} onChange={(v) => update({ position: { ...shape.position, y: v } })} step={0.1} />

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
          <NumberField label="Start Y" value={shape.start.y} onChange={(v) => update({ start: { ...shape.start, y: v } })} step={0.1} />
          <NumberField label="End X" value={shape.end.x} onChange={(v) => update({ end: { ...shape.end, x: v } })} step={0.1} />
          <NumberField label="End Y" value={shape.end.y} onChange={(v) => update({ end: { ...shape.end, y: v } })} step={0.1} />
        </PropertyGroup>
      );

    case 'rectangle':
      return (
        <PropertyGroup label="Geometry">
          <NumberField label="Top-Left X" value={shape.topLeft.x} onChange={(v) => update({ topLeft: { ...shape.topLeft, x: v } })} step={0.1} />
          <NumberField label="Top-Left Y" value={shape.topLeft.y} onChange={(v) => update({ topLeft: { ...shape.topLeft, y: v } })} step={0.1} />
          <NumberField label="Width" value={shape.width} onChange={(v) => update({ width: v })} step={0.1} min={0.1} />
          <NumberField label="Height" value={shape.height} onChange={(v) => update({ height: v })} step={0.1} min={0.1} />
          <NumberField label="Rotation (deg)" value={shape.rotation * RAD2DEG} onChange={(v) => update({ rotation: v * DEG2RAD })} step={1} />
        </PropertyGroup>
      );

    case 'circle':
      return (
        <PropertyGroup label="Geometry">
          <NumberField label="Center X" value={shape.center.x} onChange={(v) => update({ center: { ...shape.center, x: v } })} step={0.1} />
          <NumberField label="Center Y" value={shape.center.y} onChange={(v) => update({ center: { ...shape.center, y: v } })} step={0.1} />
          <NumberField label="Radius" value={shape.radius} onChange={(v) => update({ radius: v })} step={0.1} min={0.1} />
        </PropertyGroup>
      );

    case 'arc':
      return (
        <PropertyGroup label="Geometry">
          <NumberField label="Center X" value={shape.center.x} onChange={(v) => update({ center: { ...shape.center, x: v } })} step={0.1} />
          <NumberField label="Center Y" value={shape.center.y} onChange={(v) => update({ center: { ...shape.center, y: v } })} step={0.1} />
          <NumberField label="Radius" value={shape.radius} onChange={(v) => update({ radius: v })} step={0.1} min={0.1} />
          <NumberField label="Start Angle (deg)" value={shape.startAngle * RAD2DEG} onChange={(v) => update({ startAngle: v * DEG2RAD })} step={1} />
          <NumberField label="End Angle (deg)" value={shape.endAngle * RAD2DEG} onChange={(v) => update({ endAngle: v * DEG2RAD })} step={1} />
        </PropertyGroup>
      );

    case 'ellipse':
      return (
        <PropertyGroup label="Geometry">
          <NumberField label="Center X" value={shape.center.x} onChange={(v) => update({ center: { ...shape.center, x: v } })} step={0.1} />
          <NumberField label="Center Y" value={shape.center.y} onChange={(v) => update({ center: { ...shape.center, y: v } })} step={0.1} />
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
                <div className="text-cad-text">{length.toFixed(2)} mm</div>
                <div className="text-cad-text-dim">Angle:</div>
                <div className="text-cad-text">{angle.toFixed(1)}&deg;</div>
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
                  value={beam.start.y}
                  onChange={(v) => update({ start: { ...beam.start, y: v } })}
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
                  value={beam.end.y}
                  onChange={(v) => update({ end: { ...beam.end, y: v } })}
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
                { value: 'concrete', label: 'Concrete' },
                { value: 'timber', label: 'Timber' },
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

    default:
      return (
        <div className="text-xs text-cad-text-dim">
          ID: {shape.id.slice(0, 8)}...
        </div>
      );
  }
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
  const shapes = useAppStore(s => s.shapes);
  const parametricShapes = useAppStore(s => s.parametricShapes);
  const currentStyle = useAppStore(s => s.currentStyle);
  const setCurrentStyle = useAppStore(s => s.setCurrentStyle);
  const updateShape = useAppStore(s => s.updateShape);
  const activeTool = useAppStore(s => s.activeTool);

  const selectedIdSet = useMemo(() => new Set(selectedShapeIds), [selectedShapeIds]);
  const selectedShapes = shapes.filter((s) => selectedIdSet.has(s.id));
  const selectedParametricShapes = parametricShapes.filter((s) => selectedIdSet.has(s.id));
  const hasSelection = selectedShapes.length > 0 || selectedParametricShapes.length > 0;
  const hasRegularShapeSelection = selectedShapes.length > 0;
  const isHatchToolActive = activeTool === 'hatch';

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

  if (!hasSelection) {
    return (
      <div className="flex-1 overflow-auto">
        {isHatchToolActive && <HatchToolProperties />}
        <DrawingPropertiesPanel showHeader={false} />
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
      {isHatchToolActive && <HatchToolProperties />}
      <div>
        <PropertyGroup label="Style">
          <ColorPalette label="Stroke Color" value={displayStyle.strokeColor} onChange={handleColorChange} />

          <div className="mb-3">
            <label className="block text-xs text-cad-text-dim mb-1">Stroke Width</label>
            <input
              type="number"
              min="0.5"
              max="20"
              step="0.5"
              value={displayStyle.strokeWidth}
              onChange={(e) => handleWidthChange(parseFloat(e.target.value) || 1)}
              className="w-full bg-cad-bg border border-cad-border rounded px-2 py-1 text-xs text-cad-text"
            />
          </div>

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
        </PropertyGroup>

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
