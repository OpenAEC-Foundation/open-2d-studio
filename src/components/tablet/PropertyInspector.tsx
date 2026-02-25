import { useState } from 'react';
import { useAppStore } from '../../state/appStore';
import { formatLength } from '../../units';
import type { Shape } from '../../types/geometry';

interface PropertyInspectorProps {
  shapeId: string | null;
  open: boolean;
  onClose: () => void;
  isLight: boolean;
}

function Section({ title, children, defaultOpen = true }: { title: string; children: React.ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border-b border-white/5 last:border-0">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-4 py-2 text-xs font-medium text-gray-400 active:bg-white/5"
      >
        {title}
        <svg
          width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
          className={`transition-transform ${open ? 'rotate-180' : ''}`}
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
      {open && <div className="px-4 pb-3 space-y-1.5">{children}</div>}
    </div>
  );
}

function PropRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start gap-2 text-xs">
      <span className="text-gray-500 w-24 shrink-0">{label}</span>
      <span className="text-gray-200 break-all">{value}</span>
    </div>
  );
}

function formatCoord(x: number, y: number, fmt: (v: number) => string) {
  return `(${fmt(x)}, ${fmt(y)})`;
}

function getShapeTypeName(shape: Shape): string {
  const names: Record<string, string> = {
    line: 'Line',
    rectangle: 'Rectangle',
    circle: 'Circle',
    arc: 'Arc',
    polyline: 'Polyline',
    spline: 'Spline',
    ellipse: 'Ellipse',
    text: 'Text',
    dimension: 'Dimension',
    hatch: 'Hatch',
    beam: 'Beam',
    wall: 'Wall',
    slab: 'Slab',
    gridline: 'Gridline',
    level: 'Level',
    pile: 'Pile',
    cpt: 'CPT',
    'foundation-zone': 'Foundation Zone',
    space: 'Space',
    'plate-system': 'Plate System',
    'section-callout': 'Section Callout',
    'spot-elevation': 'Spot Elevation',
    image: 'Image',
    puntniveau: 'Puntniveau',
  };
  return names[shape.type] || shape.type;
}

export function PropertyInspector({ shapeId, open, onClose, isLight }: PropertyInspectorProps) {
  const shape = useAppStore(s => shapeId ? s.shapes.find(sh => sh.id === shapeId) || null : null);
  const layers = useAppStore(s => s.layers);
  const unitSettings = useAppStore(s => s.unitSettings);

  const fmt = (v: number) => formatLength(v, unitSettings);

  if (!shape) {
    return (
      <>
        {open && <div className="fixed inset-0 bg-black/40 transition-opacity" style={{ zIndex: 60 }} onClick={onClose} />}
        <div
          className={`fixed top-0 right-0 h-full w-[300px] shadow-2xl flex flex-col ${
            isLight ? 'bg-gray-100/95' : 'bg-gray-900/95'
          } backdrop-blur-md`}
          style={{
            zIndex: 61,
            transform: open ? 'translateX(0)' : 'translateX(100%)',
            transition: 'transform 300ms cubic-bezier(0.34, 1.56, 0.64, 1)',
            paddingTop: 'env(safe-area-inset-top, 0px)',
          }}
        >
          <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
            <span className={`text-sm font-medium ${isLight ? 'text-gray-900' : 'text-white'}`}>Properties</span>
            <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg text-gray-400 active:bg-white/10">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
            </button>
          </div>
          <p className="text-gray-500 text-xs text-center py-8">No shape selected</p>
        </div>
      </>
    );
  }

  const layer = layers.find(l => l.id === shape.layerId);

  const renderGeometry = () => {
    switch (shape.type) {
      case 'line': {
        const s = shape;
        const dx = s.end.x - s.start.x;
        const dy = s.end.y - s.start.y;
        const len = Math.sqrt(dx * dx + dy * dy);
        const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
        return (
          <Section title="Geometry">
            <PropRow label="Start" value={formatCoord(s.start.x, s.start.y, fmt)} />
            <PropRow label="End" value={formatCoord(s.end.x, s.end.y, fmt)} />
            <PropRow label="Length" value={fmt(len)} />
            <PropRow label="Angle" value={`${angle.toFixed(2)}\u00B0`} />
          </Section>
        );
      }
      case 'circle': {
        const s = shape;
        const circ = 2 * Math.PI * s.radius;
        const area = Math.PI * s.radius * s.radius;
        return (
          <Section title="Geometry">
            <PropRow label="Center" value={formatCoord(s.center.x, s.center.y, fmt)} />
            <PropRow label="Radius" value={fmt(s.radius)} />
            <PropRow label="Circumference" value={fmt(circ)} />
            <PropRow label="Area" value={`${fmt(Math.sqrt(area))}\u00B2`} />
          </Section>
        );
      }
      case 'rectangle': {
        const s = shape;
        const w = Math.abs(s.width);
        const h = Math.abs(s.height);
        return (
          <Section title="Geometry">
            <PropRow label="Top Left" value={formatCoord(s.topLeft.x, s.topLeft.y, fmt)} />
            <PropRow label="Width" value={fmt(w)} />
            <PropRow label="Height" value={fmt(h)} />
            <PropRow label="Area" value={`${fmt(Math.sqrt(w * h))}\u00B2`} />
          </Section>
        );
      }
      case 'arc': {
        const s = shape;
        return (
          <Section title="Geometry">
            <PropRow label="Center" value={formatCoord(s.center.x, s.center.y, fmt)} />
            <PropRow label="Radius" value={fmt(s.radius)} />
            <PropRow label="Start angle" value={`${((s.startAngle * 180) / Math.PI).toFixed(2)}\u00B0`} />
            <PropRow label="End angle" value={`${((s.endAngle * 180) / Math.PI).toFixed(2)}\u00B0`} />
          </Section>
        );
      }
      case 'text': {
        const s = shape;
        const textContent = s.text;
        const preview = textContent.length > 100 ? textContent.slice(0, 100) + '...' : textContent;
        return (
          <Section title="Geometry">
            <PropRow label="Position" value={formatCoord(s.position.x, s.position.y, fmt)} />
            <PropRow label="Content" value={preview} />
            <PropRow label="Font size" value={String(s.fontSize)} />
            {s.fontFamily && <PropRow label="Font" value={s.fontFamily} />}
          </Section>
        );
      }
      case 'polyline': {
        const s = shape;
        let totalLen = 0;
        for (let i = 1; i < s.points.length; i++) {
          const dx = s.points[i].x - s.points[i - 1].x;
          const dy = s.points[i].y - s.points[i - 1].y;
          totalLen += Math.sqrt(dx * dx + dy * dy);
        }
        return (
          <Section title="Geometry">
            <PropRow label="Vertices" value={String(s.points.length)} />
            <PropRow label="Total length" value={fmt(totalLen)} />
            <PropRow label="Closed" value={s.closed ? 'Yes' : 'No'} />
          </Section>
        );
      }
      default: {
        // Generic fallback — use type assertion through unknown
        const anyS = shape as unknown as Record<string, unknown>;
        const rows: { label: string; value: string }[] = [];
        if ('position' in anyS && typeof anyS.position === 'object' && anyS.position) {
          const pos = anyS.position as { x: number; y: number };
          rows.push({ label: 'Position', value: formatCoord(pos.x, pos.y, fmt) });
        }
        if ('center' in anyS && typeof anyS.center === 'object' && anyS.center) {
          const c = anyS.center as { x: number; y: number };
          rows.push({ label: 'Center', value: formatCoord(c.x, c.y, fmt) });
        }
        if ('radius' in anyS && typeof anyS.radius === 'number') {
          rows.push({ label: 'Radius', value: fmt(anyS.radius) });
        }
        if ('width' in anyS && typeof anyS.width === 'number') {
          rows.push({ label: 'Width', value: fmt(anyS.width) });
        }
        if ('height' in anyS && typeof anyS.height === 'number') {
          rows.push({ label: 'Height', value: fmt(anyS.height) });
        }
        if (rows.length === 0) return null;
        return (
          <Section title="Geometry">
            {rows.map(r => <PropRow key={r.label} label={r.label} value={r.value} />)}
          </Section>
        );
      }
    }
  };

  // Style properties are on shape.style
  const strokeColor = shape.style?.strokeColor;
  const strokeWidth = shape.style?.strokeWidth;
  const lineStyle = shape.style?.lineStyle;

  return (
    <>
      {open && <div className="fixed inset-0 bg-black/40 transition-opacity" style={{ zIndex: 60 }} onClick={onClose} />}
      <div
        className={`fixed top-0 right-0 h-full w-[300px] shadow-2xl flex flex-col ${
          isLight ? 'bg-gray-100/95 text-gray-900' : 'bg-gray-900/95 text-white'
        } backdrop-blur-md`}
        style={{
          zIndex: 61,
          transform: open ? 'translateX(0)' : 'translateX(100%)',
          transition: 'transform 300ms cubic-bezier(0.34, 1.56, 0.64, 1)',
          paddingTop: 'env(safe-area-inset-top, 0px)',
        }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
          <span className="text-sm font-medium">{getShapeTypeName(shape)}</span>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg text-gray-400 active:bg-white/10">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {/* General section */}
          <Section title="General">
            <PropRow label="Type" value={getShapeTypeName(shape)} />
            {layer && <PropRow label="Layer" value={layer.name} />}
            {strokeColor && (
              <div className="flex items-center gap-2 text-xs">
                <span className="text-gray-500 w-24 shrink-0">Color</span>
                <span className="w-4 h-4 rounded border border-white/20" style={{ backgroundColor: strokeColor }} />
                <span className="text-gray-200">{strokeColor}</span>
              </div>
            )}
            {strokeWidth !== undefined && <PropRow label="Line width" value={String(strokeWidth)} />}
            {lineStyle && lineStyle !== 'solid' && <PropRow label="Line style" value={lineStyle} />}
          </Section>

          {/* Geometry section */}
          {renderGeometry()}
        </div>
      </div>
    </>
  );
}
