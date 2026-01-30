import { memo } from 'react';
import { useAppStore } from '../../state/appStore';
import type { LineStyle, Shape, TextAlignment, TextVerticalAlignment } from '../../types/geometry';
import { DrawingPropertiesPanel } from './DrawingPropertiesPanel';

const RAD2DEG = 180 / Math.PI;
const DEG2RAD = Math.PI / 180;

const inputClass = 'w-full bg-cad-bg border border-cad-border rounded px-2 py-1 text-xs text-cad-text';
const labelClass = 'block text-xs text-cad-text-dim mb-1';

function NumberField({ label, value, onChange, step = 1, min, max, readOnly }: {
  label: string; value: number; onChange: (v: number) => void;
  step?: number; min?: number; max?: number; readOnly?: boolean;
}) {
  return (
    <div className="mb-2">
      <label className={labelClass}>{label}</label>
      <input type="number" step={step} min={min} max={max} readOnly={readOnly}
        value={Math.round(value * 1000) / 1000}
        onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
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

function ShapeProperties({ shape, updateShape }: { shape: Shape; updateShape: (id: string, updates: Partial<Shape>) => void }) {
  const update = (updates: Record<string, unknown>) => updateShape(shape.id, updates as Partial<Shape>);

  switch (shape.type) {
    case 'text':
      return (
        <>
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
        </>
      );

    case 'line':
      return (
        <>
          <NumberField label="Start X" value={shape.start.x} onChange={(v) => update({ start: { ...shape.start, x: v } })} step={0.1} />
          <NumberField label="Start Y" value={shape.start.y} onChange={(v) => update({ start: { ...shape.start, y: v } })} step={0.1} />
          <NumberField label="End X" value={shape.end.x} onChange={(v) => update({ end: { ...shape.end, x: v } })} step={0.1} />
          <NumberField label="End Y" value={shape.end.y} onChange={(v) => update({ end: { ...shape.end, y: v } })} step={0.1} />
        </>
      );

    case 'rectangle':
      return (
        <>
          <NumberField label="Top-Left X" value={shape.topLeft.x} onChange={(v) => update({ topLeft: { ...shape.topLeft, x: v } })} step={0.1} />
          <NumberField label="Top-Left Y" value={shape.topLeft.y} onChange={(v) => update({ topLeft: { ...shape.topLeft, y: v } })} step={0.1} />
          <NumberField label="Width" value={shape.width} onChange={(v) => update({ width: v })} step={0.1} min={0.1} />
          <NumberField label="Height" value={shape.height} onChange={(v) => update({ height: v })} step={0.1} min={0.1} />
          <NumberField label="Rotation (deg)" value={shape.rotation * RAD2DEG} onChange={(v) => update({ rotation: v * DEG2RAD })} step={1} />
        </>
      );

    case 'circle':
      return (
        <>
          <NumberField label="Center X" value={shape.center.x} onChange={(v) => update({ center: { ...shape.center, x: v } })} step={0.1} />
          <NumberField label="Center Y" value={shape.center.y} onChange={(v) => update({ center: { ...shape.center, y: v } })} step={0.1} />
          <NumberField label="Radius" value={shape.radius} onChange={(v) => update({ radius: v })} step={0.1} min={0.1} />
        </>
      );

    case 'arc':
      return (
        <>
          <NumberField label="Center X" value={shape.center.x} onChange={(v) => update({ center: { ...shape.center, x: v } })} step={0.1} />
          <NumberField label="Center Y" value={shape.center.y} onChange={(v) => update({ center: { ...shape.center, y: v } })} step={0.1} />
          <NumberField label="Radius" value={shape.radius} onChange={(v) => update({ radius: v })} step={0.1} min={0.1} />
          <NumberField label="Start Angle (deg)" value={shape.startAngle * RAD2DEG} onChange={(v) => update({ startAngle: v * DEG2RAD })} step={1} />
          <NumberField label="End Angle (deg)" value={shape.endAngle * RAD2DEG} onChange={(v) => update({ endAngle: v * DEG2RAD })} step={1} />
        </>
      );

    case 'ellipse':
      return (
        <>
          <NumberField label="Center X" value={shape.center.x} onChange={(v) => update({ center: { ...shape.center, x: v } })} step={0.1} />
          <NumberField label="Center Y" value={shape.center.y} onChange={(v) => update({ center: { ...shape.center, y: v } })} step={0.1} />
          <NumberField label="Radius X" value={shape.radiusX} onChange={(v) => update({ radiusX: v })} step={0.1} min={0.1} />
          <NumberField label="Radius Y" value={shape.radiusY} onChange={(v) => update({ radiusY: v })} step={0.1} min={0.1} />
          <NumberField label="Rotation (deg)" value={shape.rotation * RAD2DEG} onChange={(v) => update({ rotation: v * DEG2RAD })} step={1} />
        </>
      );

    case 'polyline':
      return (
        <>
          <CheckboxField label="Closed" value={shape.closed} onChange={(v) => update({ closed: v })} />
          <NumberField label="Point Count" value={shape.points.length} onChange={() => {}} readOnly />
        </>
      );

    default:
      return (
        <div className="text-xs text-cad-text-dim">
          ID: {shape.id.slice(0, 8)}...
        </div>
      );
  }
}

export const PropertiesPanel = memo(function PropertiesPanel() {
  const selectedShapeIds = useAppStore(s => s.selectedShapeIds);
  const shapes = useAppStore(s => s.shapes);
  const currentStyle = useAppStore(s => s.currentStyle);
  const setCurrentStyle = useAppStore(s => s.setCurrentStyle);
  const updateShape = useAppStore(s => s.updateShape);

  const selectedShapes = shapes.filter((s) => selectedShapeIds.includes(s.id));
  const hasSelection = selectedShapes.length > 0;

  // Get common style from selection (or use current style)
  const displayStyle = hasSelection ? selectedShapes[0].style : currentStyle;

  const handleColorChange = (color: string) => {
    if (hasSelection) {
      selectedShapes.forEach((shape) => {
        updateShape(shape.id, { style: { ...shape.style, strokeColor: color } });
      });
    } else {
      setCurrentStyle({ strokeColor: color });
    }
  };

  const handleWidthChange = (width: number) => {
    if (hasSelection) {
      selectedShapes.forEach((shape) => {
        updateShape(shape.id, { style: { ...shape.style, strokeWidth: width } });
      });
    } else {
      setCurrentStyle({ strokeWidth: width });
    }
  };

  const handleLineStyleChange = (lineStyle: LineStyle) => {
    if (hasSelection) {
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
        <DrawingPropertiesPanel showHeader={false} />
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-auto">
      <div className="p-3">
        {/* Selection info */}
        <div className="text-xs text-cad-text-dim mb-4">
          {selectedShapes.length} object{selectedShapes.length > 1 ? 's' : ''} selected
        </div>

        {/* Stroke Color */}
        <div className="mb-3">
          <label className="block text-xs text-cad-text-dim mb-1">Stroke Color</label>
          <div className="flex items-center gap-2">
            <input
              type="color"
              value={displayStyle.strokeColor}
              onChange={(e) => handleColorChange(e.target.value)}
              className="w-8 h-8 rounded border border-cad-border cursor-pointer"
            />
            <input
              type="text"
              value={displayStyle.strokeColor}
              onChange={(e) => handleColorChange(e.target.value)}
              className="flex-1 bg-cad-bg border border-cad-border rounded px-2 py-1 text-xs text-cad-text font-mono"
            />
          </div>
        </div>

        {/* Stroke Width */}
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

        {/* Line Style */}
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

        {/* Shape-specific properties */}
        {selectedShapes.length === 1 && (
          <div className="mt-4 pt-4 border-t border-cad-border">
            <h4 className="text-xs font-semibold text-cad-text mb-2">
              {selectedShapes[0].type.charAt(0).toUpperCase() +
                selectedShapes[0].type.slice(1)}{' '}
              Properties
            </h4>
            <ShapeProperties shape={selectedShapes[0]} updateShape={updateShape} />
          </div>
        )}
      </div>
    </div>
  );
});
