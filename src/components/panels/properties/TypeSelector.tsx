/**
 * TypeSelector - Universal Type Selector for the Properties Panel.
 *
 * Shows at the top of the Properties Panel (like Revit's Type Selector).
 * Displays the type of the selected shape(s), with a small preview, and
 * allows changing the type where applicable (e.g. FilledRegionType for hatches).
 */

import { useEffect, useRef } from 'react';
import {
  Minus,
  Pentagon,
  Circle,
  Square,
  CornerDownRight,
  Spline,
  Type,
  Ruler,
  Image,
  Box,
  LayoutTemplate,
  Layers,
  GitBranch,
} from 'lucide-react';
import { useAppStore } from '../../../state/appStore';
import type { Shape, HatchShape, ShapeType } from '../../../types/geometry';
import type { FilledRegionType } from '../../../types/filledRegion';
import type { CustomHatchPattern } from '../../../types/hatch';
import { BUILTIN_PATTERNS } from '../../../types/hatch';

// ─── helpers ────────────────────────────────────────────────────────────────

function getShapeTypeLabel(type: ShapeType): string {
  const labels: Partial<Record<ShapeType, string>> = {
    line: 'Line',
    polyline: 'Polyline',
    arc: 'Arc',
    circle: 'Circle',
    rectangle: 'Rectangle',
    ellipse: 'Ellipse',
    spline: 'Spline',
    text: 'Text',
    point: 'Point',
    dimension: 'Dimension',
    hatch: 'Filled Region',
    beam: 'Beam',
    column: 'Column',
    wall: 'Wall',
    slab: 'Slab',
    image: 'Image',
    gridline: 'Grid Line',
    level: 'Level',
    pile: 'Pile',
    puntniveau: 'Pile Tip Level',
    'wall-opening': 'Wall Opening',
    'slab-opening': 'Slab Opening',
    'slab-label': 'Slab Label',
    'section-callout': 'Section Callout',
    space: 'Space',
    'plate-system': 'Plate System',
    cpt: 'CPT',
    'foundation-zone': 'Foundation Zone',
    'spot-elevation': 'Spot Elevation',
    'block-instance': 'Block',
    rebar: 'Rebar',
    'component-instance': 'Component',
  };
  return labels[type] ?? type;
}

function ShapeTypeIcon({ type }: { type: ShapeType }) {
  const cls = 'w-3.5 h-3.5 text-cad-text-dim flex-shrink-0';
  switch (type) {
    case 'line':           return <Minus className={cls} />;
    case 'polyline':       return <Pentagon className={cls} />;
    case 'arc':            return <CornerDownRight className={cls} />;
    case 'circle':         return <Circle className={cls} />;
    case 'rectangle':      return <Square className={cls} />;
    case 'ellipse':        return <Circle className={cls} />;
    case 'spline':         return <Spline className={cls} />;
    case 'text':           return <Type className={cls} />;
    case 'dimension':      return <Ruler className={cls} />;
    case 'image':          return <Image className={cls} />;
    case 'beam':
    case 'column':
    case 'wall':
    case 'slab':           return <Box className={cls} />;
    case 'gridline':       return <GitBranch className={cls} />;
    case 'hatch':          return <Layers className={cls} />;
    default:               return <LayoutTemplate className={cls} />;
  }
}

// ─── tiny hatch preview canvas ───────────────────────────────────────────────

function resolvePatternForType(
  frt: FilledRegionType,
  getPatternById: (id: string) => CustomHatchPattern | undefined,
): CustomHatchPattern {
  if (frt.fgCustomPatternId) {
    const custom = getPatternById(frt.fgCustomPatternId);
    if (custom) return custom;
  }
  const builtin = BUILTIN_PATTERNS.find(p => p.id === frt.fgPatternType);
  return builtin ?? BUILTIN_PATTERNS[0];
}

function HatchTypePreview({ frt, getPatternById }: {
  frt: FilledRegionType;
  getPatternById: (id: string) => CustomHatchPattern | undefined;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const W = 24;
  const H = 24;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, W, H);

    // Background
    const bg = frt.backgroundColor ?? '#1e1e2e';
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    const pattern = resolvePatternForType(frt, getPatternById);
    const color = frt.fgColor;

    // Solid fill
    if (pattern.id === 'solid' || !('lineFamilies' in pattern) || pattern.lineFamilies.length === 0) {
      ctx.fillStyle = color;
      ctx.globalAlpha = 0.6;
      ctx.fillRect(0, 0, W, H);
      ctx.globalAlpha = 1;
      return;
    }

    // Line families
    for (const family of pattern.lineFamilies) {
      const spacing = Math.max(1, (family.deltaY ?? 8) * (frt.fgPatternScale ?? 1));
      const angleRad = ((family.angle ?? 0) + (frt.fgPatternAngle ?? 0)) * (Math.PI / 180);
      const dx = Math.cos(angleRad);
      const dy = Math.sin(angleRad);
      const px = -dy;
      const py = dx;
      const diag = Math.sqrt(W * W + H * H);
      const numLines = Math.ceil(diag / spacing) + 2;
      const cx = W / 2;
      const cy = H / 2;

      ctx.strokeStyle = color;
      ctx.lineWidth = Math.max(0.5, family.strokeWidth ?? 1);

      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, W, H);
      ctx.clip();

      if (family.dashPattern && family.dashPattern.length > 0 && family.dashPattern[0] !== 0) {
        ctx.setLineDash(family.dashPattern.map(d => Math.abs(d)));
      }

      for (let i = -numLines; i <= numLines; i++) {
        const ox = px * spacing * i;
        const oy = py * spacing * i;
        ctx.beginPath();
        ctx.moveTo(cx + ox - dx * diag, cy + oy - dy * diag);
        ctx.lineTo(cx + ox + dx * diag, cy + oy + dy * diag);
        ctx.stroke();
      }
      ctx.setLineDash([]);
      ctx.restore();
    }
  }, [frt, getPatternById]);

  return (
    <canvas
      ref={canvasRef}
      width={W}
      height={H}
      className="border border-cad-border rounded flex-shrink-0"
      style={{ imageRendering: 'crisp-edges' }}
    />
  );
}

// ─── main component ──────────────────────────────────────────────────────────

interface TypeSelectorProps {
  selectedShapes: Shape[];
}

export function TypeSelector({ selectedShapes }: TypeSelectorProps) {
  const filledRegionTypes = useAppStore(s => s.filledRegionTypes);
  const updateShape = useAppStore(s => s.updateShape);
  const getPatternById = useAppStore(s => s.getPatternById);

  // ── No selection ──
  if (selectedShapes.length === 0) {
    return (
      <div className="flex items-center gap-2 px-3 py-2 bg-cad-surface border-b border-cad-border">
        <span className="text-xs text-cad-text-dim italic">No Selection</span>
      </div>
    );
  }

  // ── Mixed types ──
  const firstType = selectedShapes[0].type;
  const allSameType = selectedShapes.every(s => s.type === firstType);

  if (!allSameType) {
    return (
      <div className="flex items-center gap-2 px-3 py-2 bg-cad-surface border-b border-cad-border">
        <LayoutTemplate className="w-3.5 h-3.5 text-cad-text-dim flex-shrink-0" />
        <span className="text-xs text-cad-text">
          Mixed selection ({selectedShapes.length} objects)
        </span>
      </div>
    );
  }

  // ── Hatch / FilledRegion: interactive type dropdown ──
  if (firstType === 'hatch') {
    const hatch = selectedShapes[0] as HatchShape;
    const currentTypeId = hatch.filledRegionTypeId ?? '';
    const currentFrt = filledRegionTypes.find(t => t.id === currentTypeId);

    const handleTypeChange = (newTypeId: string) => {
      const frt = filledRegionTypes.find(t => t.id === newTypeId);
      if (!frt) return;

      selectedShapes.forEach(shape => {
        updateShape(shape.id, {
          filledRegionTypeId: newTypeId,
          // Sync pattern properties from the type
          patternType: frt.fgPatternType,
          patternAngle: frt.fgPatternAngle,
          patternScale: frt.fgPatternScale,
          fillColor: frt.fgColor,
          customPatternId: frt.fgCustomPatternId,
          bgPatternType: frt.bgPatternType,
          bgPatternAngle: frt.bgPatternAngle,
          bgPatternScale: frt.bgPatternScale,
          bgFillColor: frt.bgColor,
          bgCustomPatternId: frt.bgCustomPatternId,
          backgroundColor: frt.backgroundColor,
          masking: frt.masking,
        } as Partial<HatchShape>);
      });
    };

    return (
      <div className="flex items-center gap-2 px-3 py-2 bg-cad-surface border-b border-cad-border">
        {currentFrt ? (
          <HatchTypePreview frt={currentFrt} getPatternById={getPatternById} />
        ) : (
          <div className="w-6 h-6 border border-cad-border rounded flex-shrink-0 bg-cad-bg" />
        )}
        <select
          value={currentTypeId}
          onChange={e => handleTypeChange(e.target.value)}
          className="flex-1 bg-cad-bg border border-cad-border rounded px-2 py-0.5 text-xs text-cad-text min-w-0"
          title="Filled Region Type"
        >
          {!currentTypeId && (
            <option value="">— No type —</option>
          )}
          {filledRegionTypes.map(frt => (
            <option key={frt.id} value={frt.id}>
              {frt.name}
            </option>
          ))}
        </select>
        {selectedShapes.length > 1 && (
          <span className="text-[10px] text-cad-text-dim flex-shrink-0">×{selectedShapes.length}</span>
        )}
      </div>
    );
  }

  // ── All other types: display only ──
  const label = selectedShapes.length > 1
    ? `${getShapeTypeLabel(firstType)} (${selectedShapes.length})`
    : getShapeTypeLabel(firstType);

  return (
    <div className="flex items-center gap-2 px-3 py-2 bg-cad-surface border-b border-cad-border">
      <ShapeTypeIcon type={firstType} />
      <span className="text-xs text-cad-text truncate">{label}</span>
    </div>
  );
}
