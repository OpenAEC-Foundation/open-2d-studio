import { useState, useRef, useEffect } from 'react';
import { useAppStore } from '../../../state/appStore';
import type { UnitSettings } from '../../../units/types';
import { formatLength, parseLength } from '../../../units';
import type { SurfaceExposureClasses } from '../../../types/geometry';
import { EXPOSURE_CLASSES, EXPOSURE_CLASS_MIN_COVER, getMinCoverFromExposureClasses } from '../../../types/geometry';

export const RAD2DEG = 180 / Math.PI;
export const DEG2RAD = Math.PI / 180;

export const inputClass = 'w-full bg-cad-bg border border-cad-border rounded px-2 py-1 text-xs text-cad-text';
export const labelClass = 'block text-xs text-cad-text-dim mb-1';

export function PropertyGroup({ label, defaultOpen = true, children }: {
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

// Exposure Class (Milieuklasse) Section for concrete elements
export function ExposureClassSection({ exposureClasses, onChange }: {
  exposureClasses?: SurfaceExposureClasses;
  onChange: (ec: SurfaceExposureClasses) => void;
}) {
  const ec = exposureClasses || {};
  const minCover = getMinCoverFromExposureClasses(ec);
  const surfaces = ['top', 'bottom', 'left', 'right'] as const;
  const surfaceLabels: Record<string, string> = {
    top: 'Bovenzijde (Top)',
    bottom: 'Onderzijde (Bottom)',
    left: 'Links (Left)',
    right: 'Rechts (Right)',
  };

  return (
    <PropertyGroup label="Exposure Class (Milieuklasse)" defaultOpen={false}>
      {surfaces.map(surface => (
        <div key={surface} className="mb-2">
          <label className={labelClass}>{surfaceLabels[surface]}</label>
          <select
            className={inputClass}
            value={ec[surface] || ''}
            onChange={(e) => {
              const newEc = { ...ec, [surface]: e.target.value || undefined };
              onChange(newEc);
            }}
          >
            <option value="">(Geen / None)</option>
            {EXPOSURE_CLASSES.map(cls => (
              <option key={cls.value} value={cls.value}>
                {cls.label} - {cls.description} (min. dekking: {EXPOSURE_CLASS_MIN_COVER[cls.value]}mm)
              </option>
            ))}
          </select>
          {ec[surface] && (
            <div className="text-[10px] text-cad-text-dim mt-0.5">
              Min. dekking: {EXPOSURE_CLASS_MIN_COVER[ec[surface]!]}mm
            </div>
          )}
        </div>
      ))}
      {minCover > 0 && (
        <div className="mt-2 p-2 bg-cad-accent/10 rounded border border-cad-accent/30">
          <div className="text-xs font-semibold text-cad-accent">Maatgevende minimale dekking</div>
          <div className="text-sm text-cad-text font-bold">{minCover} mm</div>
          <div className="text-[10px] text-cad-text-dim mt-0.5">
            Conform NEN-EN 1992-1-1 (Eurocode 2)
          </div>
        </div>
      )}
    </PropertyGroup>
  );
}

// Text Style Selector Component
export function TextStyleSelector({ currentStyleId, onApplyStyle }: {
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
export function RegionTypeSelector({ currentTypeId, onApplyType, onManageTypes }: {
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

export function NumberField({ label, value, onChange, min, max, readOnly, disabled, unitSettings, inputClassName }: {
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

export function TextField({ label, value, onChange, placeholder }: {
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

export function LineweightInput({ value, onChange }: { value: number; onChange: (v: number) => void }) {
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

export function CheckboxField({ label, value, onChange }: {
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

export function SelectField<T extends string>({ label, value, options, onChange }: {
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

export const NAMED_COLORS: { hex: string; name?: string }[] = [
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

export function ColorPalette({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
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
