import { memo, useCallback, useState, useRef, useEffect } from 'react';
import { useAppStore } from '../../../state/appStore';
import type { DimensionType } from '../../../types/dimension';
import type { HatchPatternType, LeaderArrowType } from '../../../types/geometry';
import { BUILTIN_PATTERNS } from '../../../types/hatch';
import { PatternPreview } from '../../editors/PatternManager/PatternPreview';
import { SelectionFilterBar } from '../../layout/Ribbon/SelectionFilterBar';

/**
 * Small reusable select dropdown for the options bar
 */
function OptionSelect<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <label className="flex items-center gap-1">
      <span className="text-cad-text-dim">{label}:</span>
      <select
        className="bg-cad-bg border border-cad-border text-cad-text px-1 py-0 text-xs h-5 outline-none focus:border-cad-accent"
        value={value}
        onChange={(e) => onChange(e.target.value as T)}
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function OptionCheckbox({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex items-center gap-1 cursor-pointer select-none">
      <input
        type="checkbox"
        className="accent-cad-accent w-3 h-3"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="text-cad-text">{label}</span>
    </label>
  );
}

function OptionNumberInput({
  label,
  value,
  onChange,
  placeholder,
  min,
  step,
  width = 'w-14',
}: {
  label: string;
  value: number | null;
  onChange: (value: number | null) => void;
  placeholder?: string;
  min?: number;
  step?: number;
  width?: string;
}) {
  return (
    <label className="flex items-center gap-1">
      <span className="text-cad-text-dim">{label}:</span>
      <input
        type="number"
        className={`bg-cad-bg border border-cad-border text-cad-text px-1 py-0 text-xs h-5 outline-none focus:border-cad-accent ${width}`}
        value={value ?? ''}
        onChange={(e) => {
          const v = e.target.value;
          onChange(v === '' ? null : Number(v));
        }}
        placeholder={placeholder}
        min={min}
        step={step}
      />
    </label>
  );
}

function Separator() {
  return <div className="w-px h-4 bg-cad-border" />;
}

/**
 * Line tool options
 */
/**
 * Pick Lines controls (shared across tools)
 */
function PickLinesControls() {
  const pickLinesMode = useAppStore((s) => s.pickLinesMode);
  const setPickLinesMode = useAppStore((s) => s.setPickLinesMode);
  const pickLinesOffset = useAppStore((s) => s.pickLinesOffset);
  const setPickLinesOffset = useAppStore((s) => s.setPickLinesOffset);

  return (
    <>
      <Separator />
      <OptionCheckbox label="Pick Lines" checked={pickLinesMode} onChange={setPickLinesMode} />
      {pickLinesMode && (
        <OptionNumberInput
          label="Offset"
          value={pickLinesOffset}
          onChange={(v) => setPickLinesOffset(v ?? 10)}
          min={0}
          step={1}
        />
      )}
    </>
  );
}

function LineOptions() {
  const chainMode = useAppStore((s) => s.chainMode);
  const setChainMode = useAppStore((s) => s.setChainMode);

  return (
    <>
      <OptionCheckbox label="Chain" checked={chainMode} onChange={setChainMode} />
      <PickLinesControls />
    </>
  );
}

/**
 * Rectangle tool options
 */
function RectangleOptions() {
  const rectangleMode = useAppStore((s) => s.rectangleMode);
  const setRectangleMode = useAppStore((s) => s.setRectangleMode);
  const cornerRadius = useAppStore((s) => s.cornerRadius);
  const setCornerRadius = useAppStore((s) => s.setCornerRadius);

  return (
    <>
      <OptionSelect
        label="Mode"
        value={rectangleMode}
        options={[
          { value: 'corner', label: 'Corner' },
          { value: 'center', label: 'Center' },
          { value: '3point', label: '3-Point' },
        ]}
        onChange={setRectangleMode}
      />
      <Separator />
      <OptionNumberInput
        label="Corner R"
        value={cornerRadius || null}
        onChange={(v) => setCornerRadius(v ?? 0)}
        placeholder="0"
        min={0}
        step={1}
      />
    </>
  );
}

/**
 * Circle tool options
 */
function CircleOptions() {
  const circleMode = useAppStore((s) => s.circleMode);
  const setCircleMode = useAppStore((s) => s.setCircleMode);
  const lockedRadius = useAppStore((s) => s.lockedRadius);
  const setLockedRadius = useAppStore((s) => s.setLockedRadius);

  return (
    <>
      <OptionSelect
        label="Mode"
        value={circleMode}
        options={[
          { value: 'center-radius', label: 'Center-Radius' },
          { value: 'center-diameter', label: 'Center-Diameter' },
          { value: '2point', label: '2-Point' },
          { value: '3point', label: '3-Point' },
        ]}
        onChange={setCircleMode}
      />
      <Separator />
      <OptionNumberInput
        label="Radius"
        value={lockedRadius}
        onChange={setLockedRadius}
        placeholder="dynamic"
        min={0}
        step={1}
      />
      <PickLinesControls />
    </>
  );
}

/**
 * Arc tool options
 */
function ArcOptions() {
  const arcMode = useAppStore((s) => s.arcMode);
  const setArcMode = useAppStore((s) => s.setArcMode);
  const lockedRadius = useAppStore((s) => s.lockedRadius);
  const setLockedRadius = useAppStore((s) => s.setLockedRadius);

  return (
    <>
      <OptionSelect
        label="Mode"
        value={arcMode}
        options={[
          { value: '3point', label: '3-Point' },
          { value: 'center-start-end', label: 'Center-Start-End' },
          { value: 'start-end-radius', label: 'Start-End-Radius' },
          { value: 'fillet', label: 'Fillet' },
          { value: 'tangent', label: 'Tangent' },
        ]}
        onChange={setArcMode}
      />
      <Separator />
      <OptionNumberInput
        label="Radius"
        value={lockedRadius}
        onChange={setLockedRadius}
        placeholder="dynamic"
        min={0}
        step={1}
      />
      <PickLinesControls />
    </>
  );
}

/**
 * Ellipse tool options
 */
function EllipseOptions() {
  const ellipseMode = useAppStore((s) => s.ellipseMode);
  const setEllipseMode = useAppStore((s) => s.setEllipseMode);

  return (
    <>
      <OptionSelect
        label="Mode"
        value={ellipseMode}
        options={[
          { value: 'center-axes', label: 'Center-Axes' },
          { value: 'corner', label: 'Corner' },
          { value: 'partial', label: 'Partial' },
        ]}
        onChange={setEllipseMode}
      />
    </>
  );
}

/**
 * Spline tool options
 */
function SplineOptions() {
  const splineMode = useAppStore((s) => s.splineMode);
  const setSplineMode = useAppStore((s) => s.setSplineMode);

  return (
    <>
      <OptionSelect
        label="Mode"
        value={splineMode}
        options={[
          { value: 'fit-points', label: 'Fit Points' },
          { value: 'control-points', label: 'Control Points' },
        ]}
        onChange={setSplineMode}
      />
    </>
  );
}

/**
 * Polyline tool options (no special options yet, placeholder)
 */
function PolylineOptions() {
  return (
    <span className="text-cad-text-dim italic">A=Arc, L=Line, C=Close, Backspace=Undo</span>
  );
}

/**
 * Dimension tool options
 */
function DimensionOptions() {
  const dimensionMode = useAppStore((s) => s.dimensionMode);
  const setDimensionMode = useAppStore((s) => s.setDimensionMode);
  const dimensionPrecision = useAppStore((s) => s.dimensionPrecision);
  const setDimensionPrecision = useAppStore((s) => s.setDimensionPrecision);
  const dimensionArrowStyle = useAppStore((s) => s.dimensionArrowStyle);
  const setDimensionArrowStyle = useAppStore((s) => s.setDimensionArrowStyle);

  const handleModeChange = useCallback(
    (mode: string) => {
      setDimensionMode(mode as DimensionType);
    },
    [setDimensionMode]
  );

  return (
    <>
      <OptionSelect
        label="Type"
        value={dimensionMode}
        options={[
          { value: 'aligned', label: 'Aligned' },
          { value: 'linear', label: 'Linear' },
          { value: 'angular', label: 'Angular' },
          { value: 'radius', label: 'Radius' },
          { value: 'diameter', label: 'Diameter' },
          { value: 'arc-length', label: 'Arc Length' },
        ]}
        onChange={handleModeChange}
      />
      <Separator />
      <OptionSelect
        label="Precision"
        value={String(dimensionPrecision)}
        options={[
          { value: '0', label: '0' },
          { value: '1', label: '0.0' },
          { value: '2', label: '0.00' },
          { value: '3', label: '0.000' },
          { value: '4', label: '0.0000' },
        ]}
        onChange={(v) => setDimensionPrecision(Number(v))}
      />
      <Separator />
      <OptionSelect
        label="Arrows"
        value={dimensionArrowStyle}
        options={[
          { value: 'filled', label: 'Filled' },
          { value: 'open', label: 'Open' },
          { value: 'dot', label: 'Dot' },
          { value: 'tick', label: 'Tick' },
          { value: 'none', label: 'None' },
        ]}
        onChange={setDimensionArrowStyle}
      />
    </>
  );
}

/**
 * Text tool options
 */
function TextOptions() {
  const defaultTextStyle = useAppStore((s) => s.defaultTextStyle);
  const updateDefaultTextStyle = useAppStore((s) => s.updateDefaultTextStyle);
  const textStyles = useAppStore((s) => s.textStyles);
  const activeTextStyleId = useAppStore((s) => s.activeTextStyleId);
  const setActiveTextStyle = useAppStore((s) => s.setActiveTextStyle);
  const setTextStyleManagerOpen = useAppStore((s) => s.setTextStyleManagerOpen);

  const annotationStyles = textStyles.filter(s => !s.isModelText);
  const modelStyles = textStyles.filter(s => s.isModelText);

  const handleStyleChange = (styleId: string) => {
    if (styleId === '__manage__') {
      setTextStyleManagerOpen(true);
      return;
    }
    if (styleId === '') {
      setActiveTextStyle(null);
      return;
    }
    setActiveTextStyle(styleId);
    // Sync the selected style's properties to defaultTextStyle
    const style = textStyles.find(s => s.id === styleId);
    if (style) {
      updateDefaultTextStyle({
        fontFamily: style.fontFamily,
        fontSize: style.fontSize,
        bold: style.bold,
        italic: style.italic,
        underline: style.underline,
        alignment: style.alignment,
        color: style.color,
      });
    }
  };

  return (
    <>
      {/* Text Style selector */}
      <label className="flex items-center gap-1">
        <span className="text-cad-text-dim">Style:</span>
        <select
          className="bg-cad-bg border border-cad-border text-cad-text px-1 py-0 text-xs h-5 outline-none focus:border-cad-accent max-w-[140px]"
          value={activeTextStyleId || ''}
          onChange={(e) => handleStyleChange(e.target.value)}
        >
          <option value="">-- Custom --</option>
          {annotationStyles.length > 0 && (
            <optgroup label="Annotation Text">
              {annotationStyles.map(s => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </optgroup>
          )}
          {modelStyles.length > 0 && (
            <optgroup label="Model Text">
              {modelStyles.map(s => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </optgroup>
          )}
          <option value="__manage__">Manage Styles...</option>
        </select>
      </label>
      <Separator />
      <OptionSelect
        label="Font"
        value={defaultTextStyle.fontFamily}
        options={[
          { value: 'Osifont', label: 'Osifont' },
          { value: 'Arial', label: 'Arial' },
          { value: 'Times New Roman', label: 'Times' },
          { value: 'Courier New', label: 'Courier' },
          { value: 'Verdana', label: 'Verdana' },
          { value: 'Georgia', label: 'Georgia' },
        ]}
        onChange={(v) => updateDefaultTextStyle({ fontFamily: v })}
      />
      <Separator />
      <OptionNumberInput
        label="Text Height"
        value={defaultTextStyle.fontSize}
        onChange={(v) => updateDefaultTextStyle({ fontSize: v ?? 2.5 })}
        min={1}
        step={1}
        width="w-10"
      />
      <Separator />
      <div className="flex items-center gap-0.5">
        <button
          className={`px-1.5 h-5 text-xs font-bold border ${
            defaultTextStyle.bold
              ? 'bg-cad-accent text-white border-cad-accent'
              : 'bg-cad-bg text-cad-text border-cad-border hover:border-cad-accent'
          }`}
          onClick={() => updateDefaultTextStyle({ bold: !defaultTextStyle.bold })}
          title="Bold"
        >
          B
        </button>
        <button
          className={`px-1.5 h-5 text-xs italic border ${
            defaultTextStyle.italic
              ? 'bg-cad-accent text-white border-cad-accent'
              : 'bg-cad-bg text-cad-text border-cad-border hover:border-cad-accent'
          }`}
          onClick={() => updateDefaultTextStyle({ italic: !defaultTextStyle.italic })}
          title="Italic"
        >
          I
        </button>
        <button
          className={`px-1.5 h-5 text-xs underline border ${
            defaultTextStyle.underline
              ? 'bg-cad-accent text-white border-cad-accent'
              : 'bg-cad-bg text-cad-text border-cad-border hover:border-cad-accent'
          }`}
          onClick={() => updateDefaultTextStyle({ underline: !defaultTextStyle.underline })}
          title="Underline"
        >
          U
        </button>
      </div>
      <Separator />
      <OptionSelect
        label="Align"
        value={defaultTextStyle.alignment}
        options={[
          { value: 'left', label: 'Left' },
          { value: 'center', label: 'Center' },
          { value: 'right', label: 'Right' },
        ]}
        onChange={(v) => updateDefaultTextStyle({ alignment: v as 'left' | 'center' | 'right' })}
      />
    </>
  );
}

/**
 * Move tool options
 */
function MoveOptions() {
  const modifyConstrain = useAppStore((s) => s.modifyConstrain);
  const setModifyConstrain = useAppStore((s) => s.setModifyConstrain);
  const modifyCopy = useAppStore((s) => s.modifyCopy);
  const setModifyCopy = useAppStore((s) => s.setModifyCopy);

  return (
    <>
      <OptionCheckbox label="Constrain" checked={modifyConstrain} onChange={setModifyConstrain} />
      <Separator />
      <OptionCheckbox label="Copy" checked={modifyCopy} onChange={setModifyCopy} />
    </>
  );
}

/**
 * Copy tool options
 */
function CopyOptions() {
  const modifyConstrain = useAppStore((s) => s.modifyConstrain);
  const setModifyConstrain = useAppStore((s) => s.setModifyConstrain);
  const modifyMultiple = useAppStore((s) => s.modifyMultiple);
  const setModifyMultiple = useAppStore((s) => s.setModifyMultiple);

  return (
    <>
      <OptionCheckbox label="Constrain" checked={modifyConstrain} onChange={setModifyConstrain} />
      <Separator />
      <OptionCheckbox label="Multiple" checked={modifyMultiple} onChange={setModifyMultiple} />
    </>
  );
}

/**
 * Rotate tool options
 */
function RotateOptions() {
  const modifyCopy = useAppStore((s) => s.modifyCopy);
  const setModifyCopy = useAppStore((s) => s.setModifyCopy);
  const rotateAngle = useAppStore((s) => s.rotateAngle);
  const setRotateAngle = useAppStore((s) => s.setRotateAngle);

  return (
    <>
      <OptionCheckbox label="Copy" checked={modifyCopy} onChange={setModifyCopy} />
      <Separator />
      <OptionNumberInput
        label="Angle"
        value={rotateAngle}
        onChange={setRotateAngle}
        placeholder="dynamic"
        step={15}
      />
    </>
  );
}

/**
 * Scale tool options
 */
function ScaleOptions() {
  const scaleMode = useAppStore((s) => s.scaleMode);
  const setScaleMode = useAppStore((s) => s.setScaleMode);
  const scaleFactor = useAppStore((s) => s.scaleFactor);
  const setScaleFactor = useAppStore((s) => s.setScaleFactor);
  const modifyCopy = useAppStore((s) => s.modifyCopy);
  const setModifyCopy = useAppStore((s) => s.setModifyCopy);

  return (
    <>
      <OptionSelect
        label="Mode"
        value={scaleMode}
        options={[
          { value: 'graphical', label: 'Graphical' },
          { value: 'numerical', label: 'Numerical' },
        ]}
        onChange={setScaleMode}
      />
      <Separator />
      {scaleMode === 'numerical' && (
        <OptionNumberInput
          label="Factor"
          value={scaleFactor}
          onChange={(v) => setScaleFactor(v ?? 2)}
          min={0.01}
          step={0.5}
        />
      )}
      <OptionCheckbox label="Copy" checked={modifyCopy} onChange={setModifyCopy} />
    </>
  );
}

/**
 * Mirror tool options
 */
function MirrorOptions() {
  const modifyCopy = useAppStore((s) => s.modifyCopy);
  const setModifyCopy = useAppStore((s) => s.setModifyCopy);

  return (
    <OptionCheckbox label="Copy" checked={modifyCopy} onChange={setModifyCopy} />
  );
}

/**
 * Fillet tool options
 */
function FilletOptions() {
  const filletRadius = useAppStore((s) => s.filletRadius);
  const setFilletRadius = useAppStore((s) => s.setFilletRadius);

  return (
    <OptionNumberInput
      label="Radius"
      value={filletRadius}
      onChange={(v) => setFilletRadius(v ?? 5)}
      min={0}
      step={1}
    />
  );
}

/**
 * Chamfer tool options
 */
function ChamferOptions() {
  const chamferDistance1 = useAppStore((s) => s.chamferDistance1);
  const setChamferDistance1 = useAppStore((s) => s.setChamferDistance1);
  const chamferDistance2 = useAppStore((s) => s.chamferDistance2);
  const setChamferDistance2 = useAppStore((s) => s.setChamferDistance2);

  return (
    <>
      <OptionNumberInput
        label="Distance 1"
        value={chamferDistance1}
        onChange={(v) => setChamferDistance1(v ?? 5)}
        min={0}
        step={1}
      />
      <Separator />
      <OptionNumberInput
        label="Distance 2"
        value={chamferDistance2}
        onChange={(v) => setChamferDistance2(v ?? 5)}
        min={0}
        step={1}
      />
    </>
  );
}

/**
 * Offset tool options
 */
function OffsetOptions() {
  const offsetDistance = useAppStore((s) => s.offsetDistance);
  const setOffsetDistance = useAppStore((s) => s.setOffsetDistance);

  return (
    <OptionNumberInput
      label="Distance"
      value={offsetDistance}
      onChange={(v) => setOffsetDistance(v ?? 10)}
      min={0.1}
      step={1}
    />
  );
}

/**
 * Array tool options
 */
function ArrayOptions() {
  const arrayMode = useAppStore((s) => s.arrayMode);
  const setArrayMode = useAppStore((s) => s.setArrayMode);
  const arrayCount = useAppStore((s) => s.arrayCount);
  const setArrayCount = useAppStore((s) => s.setArrayCount);
  const arraySpacing = useAppStore((s) => s.arraySpacing);
  const setArraySpacing = useAppStore((s) => s.setArraySpacing);
  const arrayAngle = useAppStore((s) => s.arrayAngle);
  const setArrayAngle = useAppStore((s) => s.setArrayAngle);

  return (
    <>
      <OptionSelect
        label="Mode"
        value={arrayMode}
        options={[
          { value: 'linear', label: 'Linear' },
          { value: 'radial', label: 'Radial' },
        ]}
        onChange={setArrayMode}
      />
      <Separator />
      <OptionNumberInput
        label="Count"
        value={arrayCount}
        onChange={(v) => setArrayCount(v ?? 5)}
        min={2}
        step={1}
      />
      {arrayMode === 'linear' && (
        <>
          <Separator />
          <OptionNumberInput
            label="Spacing"
            value={arraySpacing}
            onChange={(v) => setArraySpacing(v ?? 20)}
            min={0.1}
            step={5}
          />
        </>
      )}
      {arrayMode === 'radial' && (
        <>
          <Separator />
          <OptionNumberInput
            label="Angle"
            value={arrayAngle}
            onChange={(v) => setArrayAngle(v ?? 360)}
            min={1}
            step={15}
            width="w-16"
          />
        </>
      )}
    </>
  );
}

/**
 * Hatch tool options
 */
function HatchPatternDropdown({ value, onChange }: { value: HatchPatternType; onChange: (v: HatchPatternType) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const selected = BUILTIN_PATTERNS.find(p => p.id === value) ?? BUILTIN_PATTERNS[0];

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 bg-cad-bg border border-cad-border text-cad-text px-1.5 py-0 text-xs h-5 cursor-pointer hover:border-cad-accent"
      >
        <PatternPreview pattern={selected} width={24} height={14} scale={0.4} />
        <span>{selected.name}</span>
        <span className="text-cad-text-dim text-[9px]">&#9662;</span>
      </button>
      {open && (
        <div className="absolute z-50 top-full left-0 mt-1 bg-cad-surface border border-cad-border rounded shadow-lg min-w-[140px]">
          {BUILTIN_PATTERNS.map(p => (
            <button
              key={p.id}
              type="button"
              className={`w-full flex items-center gap-2 px-2 py-1.5 text-left text-xs hover:bg-cad-hover ${
                p.id === value ? 'bg-cad-accent/20' : ''
              }`}
              onClick={() => { onChange(p.id as HatchPatternType); setOpen(false); }}
            >
              <PatternPreview pattern={p} width={28} height={16} scale={0.4} />
              <span>{p.name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function HatchOptions() {
  const hatchPatternType = useAppStore((s) => s.hatchPatternType);
  const setHatchPatternType = useAppStore((s) => s.setHatchPatternType);
  const hatchPatternAngle = useAppStore((s) => s.hatchPatternAngle);
  const setHatchPatternAngle = useAppStore((s) => s.setHatchPatternAngle);
  const hatchPatternScale = useAppStore((s) => s.hatchPatternScale);
  const setHatchPatternScale = useAppStore((s) => s.setHatchPatternScale);
  const hatchFillColor = useAppStore((s) => s.hatchFillColor);
  const setHatchFillColor = useAppStore((s) => s.setHatchFillColor);
  const hatchBackgroundColor = useAppStore((s) => s.hatchBackgroundColor);
  const setHatchBackgroundColor = useAppStore((s) => s.setHatchBackgroundColor);

  return (
    <>
      <label className="flex items-center gap-1">
        <span className="text-cad-text-dim">Pattern:</span>
        <HatchPatternDropdown value={hatchPatternType} onChange={(v) => setHatchPatternType(v)} />
      </label>
      <Separator />
      <OptionNumberInput
        label="Angle"
        value={hatchPatternAngle}
        onChange={(v) => setHatchPatternAngle(v ?? 45)}
        step={15}
      />
      <Separator />
      <OptionNumberInput
        label="Scale"
        value={hatchPatternScale}
        onChange={(v) => setHatchPatternScale(v ?? 1)}
        min={0.1}
        step={0.5}
      />
      <Separator />
      <label className="flex items-center gap-1">
        <span className="text-cad-text-dim">Fill:</span>
        <input
          type="color"
          className="w-5 h-5 border border-cad-border cursor-pointer"
          value={hatchFillColor}
          onChange={(e) => setHatchFillColor(e.target.value)}
        />
      </label>
      <Separator />
      <label className="flex items-center gap-1">
        <span className="text-cad-text-dim">BG:</span>
        <input
          type="color"
          className="w-5 h-5 border border-cad-border cursor-pointer"
          value={hatchBackgroundColor ?? '#000000'}
          onChange={(e) => setHatchBackgroundColor(e.target.value)}
        />
        {hatchBackgroundColor && (
          <button
            className="text-xs text-cad-text-dim hover:text-cad-text px-1"
            onClick={() => setHatchBackgroundColor(null)}
            title="Clear background"
          >
            x
          </button>
        )}
      </label>
    </>
  );
}

/**
 * Leader tool options
 */
function LeaderOptions() {
  const defaultLeaderConfig = useAppStore((s) => s.defaultLeaderConfig);
  const updateDefaultLeaderConfig = useAppStore((s) => s.updateDefaultLeaderConfig);

  return (
    <>
      <OptionSelect<LeaderArrowType>
        label="Arrow"
        value={defaultLeaderConfig.arrowType}
        options={[
          { value: 'filled-arrow', label: 'Filled Arrow' },
          { value: 'arrow', label: 'Open Arrow' },
          { value: 'dot', label: 'Dot' },
          { value: 'slash', label: 'Slash' },
          { value: 'none', label: 'None' },
        ]}
        onChange={(v) => updateDefaultLeaderConfig({ arrowType: v })}
      />
      <OptionNumberInput
        label="Arrow Size"
        value={defaultLeaderConfig.arrowSize}
        min={0.5}
        step={0.5}
        onChange={(v) => updateDefaultLeaderConfig({ arrowSize: v ?? 2.5 })}
      />
      <OptionCheckbox
        label="Underline"
        checked={defaultLeaderConfig.hasLanding}
        onChange={(v) => updateDefaultLeaderConfig({ hasLanding: v })}
      />
      {Separator()}
      <OptionNumberInput
        label="Line Weight"
        value={defaultLeaderConfig.lineWeight}
        min={0.05}
        step={0.05}
        onChange={(v) => updateDefaultLeaderConfig({ lineWeight: v ?? 0.18 })}
      />
    </>
  );
}

/**
 * Tool Options Bar - Always visible below the Ribbon.
 * Shows per-tool settings based on the active tool.
 */
export const ToolOptionsBar = memo(function ToolOptionsBar() {
  const activeTool = useAppStore((s) => s.activeTool);

  const renderToolOptions = () => {
    switch (activeTool) {
      case 'line':
        return <LineOptions />;
      case 'rectangle':
        return <RectangleOptions />;
      case 'circle':
        return <CircleOptions />;
      case 'arc':
        return <ArcOptions />;
      case 'ellipse':
        return <EllipseOptions />;
      case 'spline':
        return <SplineOptions />;
      case 'polyline':
        return <PolylineOptions />;
      case 'hatch':
        return <HatchOptions />;
      case 'dimension':
        return <DimensionOptions />;
      case 'text':
        return <TextOptions />;
      case 'leader':
        return <LeaderOptions />;
      case 'move':
        return <MoveOptions />;
      case 'copy':
        return <CopyOptions />;
      case 'rotate':
        return <RotateOptions />;
      case 'scale':
        return <ScaleOptions />;
      case 'mirror':
        return <MirrorOptions />;
      case 'array':
        return <ArrayOptions />;
      case 'fillet':
        return <FilletOptions />;
      case 'chamfer':
        return <ChamferOptions />;
      case 'offset':
        return <OffsetOptions />;
      case 'trim':
      case 'extend':
        return null;
      default:
        return null;
    }
  };

  return (
    <div className="h-7 bg-cad-surface border-b border-cad-border flex items-center px-3 gap-4 text-xs font-mono">
      {renderToolOptions()}
      <SelectionFilterBar />
    </div>
  );
});
