/**
 * TypeSelector - Universal Type Selector for the Properties Panel.
 *
 * Shows at the top of the Properties Panel (like Revit's Type Selector).
 * Displays the type of the selected shape(s), with a small preview, and
 * allows changing the type where applicable (e.g. FilledRegionType for hatches,
 * WallType for walls, PileTypeDefinition for piles, TextStyle for text, etc.).
 */

import { useEffect, useRef, useState, useCallback } from 'react';
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
  ChevronDown,
  Check,
  Pencil,
} from 'lucide-react';
import { useAppStore } from '../../../state/appStore';
import { getActiveDocumentStore } from '../../../state/documentStore';
import type { Shape, HatchShape, ShapeType, WallShape, PileShape, LineStyle, SpotCoordinateShape } from '../../../types/geometry';
import { SPOT_COORDINATE_TYPE_PRESETS } from '../../../types/geometry';
import type { FilledRegionType } from '../../../types/filledRegion';
import type { CustomHatchPattern } from '../../../types/hatch';
import { BUILTIN_PATTERNS } from '../../../types/hatch';
import type { DimensionShape } from '../../../types/dimension';
import type { TextShape, TextStyle, WallType, PileTypeDefinition } from '../../../types/geometry';
import { DIMENSION_STYLE_PRESETS } from '../../../constants/cadDefaults';

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
    'spot-coordinate': 'Spot Coordinate',
    'block-instance': 'Block',
    rebar: 'Rebar',
    'component-instance': 'Component',
    'detail-line': 'Detail Line',
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

// ─── preview render functions ─────────────────────────────────────────────────

// Material → color mapping for wall type previews
const MATERIAL_PREVIEW_COLORS: Record<string, { fill: string; stroke: string }> = {
  concrete:           { fill: '#C0C0C0', stroke: '#808080' },
  masonry:            { fill: '#D4908F', stroke: '#A06060' },
  'calcium-silicate': { fill: '#C8C0B0', stroke: '#A8A090' },
  timber:             { fill: '#F0DCB9', stroke: '#C0A060' },
  steel:              { fill: '#A0B0C0', stroke: '#607080' },
  insulation:         { fill: '#FFFDE0', stroke: '#C0C080' },
  generic:            { fill: '#C0C0C0', stroke: '#808080' },
};

function renderWallPreview(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  thickness: number,
  material?: string,
  colorOverride?: string,
) {
  ctx.clearRect(0, 0, w, h);

  const wallH = Math.min(h * 0.55, Math.max(6, thickness / 15));
  const cy = h / 2;
  const colors = MATERIAL_PREVIEW_COLORS[material || 'generic'] || MATERIAL_PREVIEW_COLORS.generic;
  ctx.fillStyle = colorOverride || colors.fill;
  ctx.fillRect(2, cy - wallH / 2, w - 4, wallH);
  ctx.strokeStyle = colors.stroke;
  ctx.lineWidth = 0.8;
  ctx.strokeRect(2, cy - wallH / 2, w - 4, wallH);
}

function renderPilePreview(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  shape: string,
) {
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = '#1e1e2e';
  ctx.fillRect(0, 0, w, h);

  ctx.strokeStyle = '#cccccc';
  ctx.lineWidth = 1;
  const isRound = shape === 'round' || shape === 'circle' || shape === 'bored';
  if (isRound) {
    ctx.beginPath();
    ctx.arc(w / 2, h / 2, 8, 0, Math.PI * 2);
    ctx.stroke();
    // cross inside
    ctx.beginPath();
    ctx.moveTo(w / 2 - 5, h / 2);
    ctx.lineTo(w / 2 + 5, h / 2);
    ctx.moveTo(w / 2, h / 2 - 5);
    ctx.lineTo(w / 2, h / 2 + 5);
    ctx.stroke();
  } else {
    ctx.strokeRect(w / 2 - 7, h / 2 - 7, 14, 14);
    ctx.beginPath();
    ctx.moveTo(w / 2 - 5, h / 2);
    ctx.lineTo(w / 2 + 5, h / 2);
    ctx.moveTo(w / 2, h / 2 - 5);
    ctx.lineTo(w / 2, h / 2 + 5);
    ctx.stroke();
  }
}

function renderLinePreview(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  lineStyle: LineStyle,
) {
  ctx.clearRect(0, 0, w, h);
  // Transparent background — no fillRect so the canvas CSS background shows through

  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 1.5;
  if (lineStyle === 'dashed') ctx.setLineDash([4, 3]);
  else if (lineStyle === 'dotted') ctx.setLineDash([1, 3]);
  else if (lineStyle === 'dashdot') ctx.setLineDash([6, 2, 1, 2]);
  else ctx.setLineDash([]);

  ctx.beginPath();
  ctx.moveTo(3, h / 2);
  ctx.lineTo(w - 3, h / 2);
  ctx.stroke();
  ctx.setLineDash([]);
}

function renderTextPreview(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  style: TextStyle,
) {
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = '#1e1e2e';
  ctx.fillRect(0, 0, w, h);

  const fontParts: string[] = [];
  if (style.italic) fontParts.push('italic');
  if (style.bold) fontParts.push('bold');
  fontParts.push('10px');
  fontParts.push(style.fontFamily || 'sans-serif');

  ctx.font = fontParts.join(' ');
  ctx.fillStyle = style.color || '#cccccc';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  if (style.underline) {
    const metrics = ctx.measureText('Aa');
    const tw = metrics.width;
    ctx.strokeStyle = style.color || '#cccccc';
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.moveTo(w / 2 - tw / 2, h / 2 + 5);
    ctx.lineTo(w / 2 + tw / 2, h / 2 + 5);
    ctx.stroke();
  }

  ctx.fillText('Aa', w / 2, h / 2);
}

function renderDimensionPreview(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
) {
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = '#1e1e2e';
  ctx.fillRect(0, 0, w, h);

  const y = Math.round(h / 2) + 2;
  const x1 = 3;
  const x2 = w - 3;

  ctx.strokeStyle = '#cccccc';
  ctx.lineWidth = 0.8;

  // Dimension line
  ctx.beginPath();
  ctx.moveTo(x1 + 3, y);
  ctx.lineTo(x2 - 3, y);
  ctx.stroke();

  // Arrows
  ctx.beginPath();
  ctx.moveTo(x1 + 3, y);
  ctx.lineTo(x1 + 7, y - 2);
  ctx.lineTo(x1 + 7, y + 2);
  ctx.closePath();
  ctx.fillStyle = '#cccccc';
  ctx.fill();

  ctx.beginPath();
  ctx.moveTo(x2 - 3, y);
  ctx.lineTo(x2 - 7, y - 2);
  ctx.lineTo(x2 - 7, y + 2);
  ctx.closePath();
  ctx.fill();

  // Extension lines
  ctx.strokeStyle = '#999999';
  ctx.lineWidth = 0.5;
  ctx.beginPath();
  ctx.moveTo(x1 + 3, y - 5);
  ctx.lineTo(x1 + 3, y + 2);
  ctx.moveTo(x2 - 3, y - 5);
  ctx.lineTo(x2 - 3, y + 2);
  ctx.stroke();

  // Text
  ctx.fillStyle = '#cccccc';
  ctx.font = '6px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  ctx.fillText('dim', w / 2, y - 1);
}

// ─── generic mini canvas preview ─────────────────────────────────────────────

interface MiniPreviewProps {
  render: (ctx: CanvasRenderingContext2D, w: number, h: number) => void;
  deps?: unknown[];
}

function MiniPreview({ render, deps = [] }: MiniPreviewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const W = 48;
  const H = 48;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    render(ctx, W, H);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [render, ...deps]);

  return (
    <canvas
      ref={canvasRef}
      width={W}
      height={H}
      className="border border-cad-border rounded flex-shrink-0"
      style={{ imageRendering: 'crisp-edges', width: '48px', height: '48px' }}
    />
  );
}

// ─── generic TypeDropdown ─────────────────────────────────────────────────────

interface TypeOption {
  id: string;
  label: string;
  renderPreview: (ctx: CanvasRenderingContext2D, w: number, h: number) => void;
}

interface TypeDropdownProps {
  options: TypeOption[];
  value: string;
  onChange: (id: string) => void;
  placeholder?: string;
  /** Called when the edit (pencil) button is clicked for a type. Passes the type id. */
  onEditOption?: (id: string) => void;
}

function TypeDropdownItem({
  option,
  selected,
  onClick,
  onEdit,
}: {
  option: TypeOption;
  selected: boolean;
  onClick: () => void;
  onEdit?: () => void;
}) {
  return (
    <div
      className={`flex items-center gap-2 px-2 py-1.5 cursor-pointer hover:bg-cad-hover ${
        selected ? 'bg-cad-accent/20' : ''
      }`}
      onMouseDown={e => {
        e.preventDefault();
        e.stopPropagation();
        onClick();
      }}
    >
      <MiniPreview render={option.renderPreview} deps={[option.id]} />
      <span className="flex-1 text-xs text-cad-text truncate">{option.label}</span>
      {selected && <Check className="w-3 h-3 text-cad-accent flex-shrink-0" />}
      {onEdit && (
        <button
          className="p-0.5 rounded hover:bg-cad-accent/20 text-cad-text-dim hover:text-cad-text flex-shrink-0"
          title="Edit type"
          onMouseDown={e => {
            e.preventDefault();
            e.stopPropagation();
            onEdit();
          }}
        >
          <Pencil className="w-3 h-3" />
        </button>
      )}
    </div>
  );
}

function TypeDropdown({ options, value, onChange, placeholder, onEditOption }: TypeDropdownProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const currentOption = options.find(o => o.id === value);

  const filteredOptions = search
    ? options.filter(o => o.label.toLowerCase().includes(search.toLowerCase()))
    : options;

  const handleClickOutside = useCallback((e: MouseEvent) => {
    if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
      setOpen(false);
      setSearch('');
    }
  }, []);

  useEffect(() => {
    if (open) {
      document.addEventListener('mousedown', handleClickOutside);
    } else {
      document.removeEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open, handleClickOutside]);

  return (
    <div ref={containerRef} className="relative flex-1 min-w-0">
      {/* Trigger button */}
      <button
        type="button"
        className="w-full flex items-center gap-2 bg-cad-bg border border-cad-border rounded px-2 py-1.5 text-xs text-cad-text hover:bg-cad-hover"
        onClick={() => setOpen(prev => !prev)}
      >
        {currentOption ? (
          <MiniPreview render={currentOption.renderPreview} deps={[currentOption.id]} />
        ) : (
          <div className="w-12 h-12 border border-cad-border rounded flex-shrink-0 bg-cad-bg" />
        )}
        <span className="flex-1 text-left truncate">
          {currentOption?.label ?? placeholder ?? '— No type —'}
        </span>
        <ChevronDown className="w-3 h-3 text-cad-text-dim flex-shrink-0" />
      </button>

      {/* Dropdown list with search */}
      {open && (
        <div className="absolute z-50 left-0 right-0 top-full mt-0.5 bg-cad-surface border border-cad-border rounded shadow-lg max-h-64 flex flex-col">
          {/* Search input */}
          {options.length > 5 && (
            <div className="p-1.5 border-b border-cad-border">
              <input
                ref={searchRef}
                type="text"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Zoeken..."
                className="w-full bg-cad-bg border border-cad-border rounded px-2 py-1 text-xs text-cad-text outline-none focus:border-cad-accent"
                autoFocus
                onKeyDown={e => {
                  if (e.key === 'Escape') { setOpen(false); setSearch(''); }
                }}
              />
            </div>
          )}
          {/* Options list */}
          <div className="overflow-y-auto flex-1">
            {filteredOptions.map(option => (
              <TypeDropdownItem
                key={option.id}
                option={option}
                selected={option.id === value}
                onClick={() => {
                  onChange(option.id);
                  setOpen(false);
                  setSearch('');
                }}
                onEdit={onEditOption && option.id ? () => { onEditOption(option.id); setOpen(false); setSearch(''); } : undefined}
              />
            ))}
            {filteredOptions.length === 0 && (
              <div className="px-2 py-2 text-xs text-cad-text-dim italic text-center">
                {search ? `Geen resultaten voor "${search}"` : 'Geen types beschikbaar'}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── line style names ────────────────────────────────────────────────────────

const LINE_STYLE_LABELS: Record<LineStyle, string> = {
  solid: 'Solid',
  dashed: 'Dashed',
  dotted: 'Dotted',
  dashdot: 'Dash-Dot',
};

const LINE_STYLE_OPTIONS: LineStyle[] = ['solid', 'dashed', 'dotted', 'dashdot'];

// ─── option builders ──────────────────────────────────────────────────────────

function buildHatchOptions(
  filledRegionTypes: FilledRegionType[],
  getPatternById: (id: string) => CustomHatchPattern | undefined,
  hasNoType: boolean,
): TypeOption[] {
  const opts: TypeOption[] = [];
  if (hasNoType) {
    opts.push({
      id: '',
      label: '— No type —',
      renderPreview: (ctx, w, h) => {
        ctx.clearRect(0, 0, w, h);
        ctx.fillStyle = '#1e1e2e';
        ctx.fillRect(0, 0, w, h);
      },
    });
  }
  for (const frt of filledRegionTypes) {
    const capturedFrt = frt;
    opts.push({
      id: frt.id,
      label: frt.name,
      renderPreview: (ctx, w, h) => {
        // Reuse the HatchTypePreview drawing logic inline
        ctx.clearRect(0, 0, w, h);
        const bg = capturedFrt.backgroundColor ?? '#1e1e2e';
        ctx.fillStyle = bg;
        ctx.fillRect(0, 0, w, h);
        const pattern = resolvePatternForType(capturedFrt, getPatternById);
        const color = capturedFrt.fgColor;
        if (pattern.id === 'solid' || !('lineFamilies' in pattern) || pattern.lineFamilies.length === 0) {
          ctx.fillStyle = color;
          ctx.globalAlpha = 0.6;
          ctx.fillRect(0, 0, w, h);
          ctx.globalAlpha = 1;
          return;
        }
        for (const family of pattern.lineFamilies) {
          const spacing = Math.max(1, (family.deltaY ?? 8) * (capturedFrt.fgPatternScale ?? 1));
          const angleRad = ((family.angle ?? 0) + (capturedFrt.fgPatternAngle ?? 0)) * (Math.PI / 180);
          const dx = Math.cos(angleRad);
          const dy = Math.sin(angleRad);
          const px = -dy;
          const py = dx;
          const diag = Math.sqrt(w * w + h * h);
          const numLines = Math.ceil(diag / spacing) + 2;
          const cx = w / 2;
          const cy = h / 2;
          ctx.strokeStyle = color;
          ctx.lineWidth = Math.max(0.5, family.strokeWidth ?? 1);
          ctx.save();
          ctx.beginPath();
          ctx.rect(0, 0, w, h);
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
      },
    });
  }
  return opts;
}

function buildWallOptions(wallTypes: WallType[]): TypeOption[] {
  const opts: TypeOption[] = [
    {
      id: '',
      label: '(Custom)',
      renderPreview: (ctx, w, h) => renderWallPreview(ctx, w, h, 200, 'generic'),
    },
  ];
  for (const wt of wallTypes) {
    const capturedWt = wt;
    opts.push({
      id: wt.id,
      label: `${wt.name} (${wt.thickness}mm)`,
      renderPreview: (ctx, w, h) => renderWallPreview(ctx, w, h, capturedWt.thickness, capturedWt.material, capturedWt.color),
    });
  }
  return opts;
}

function buildPileOptions(pileTypes: PileTypeDefinition[]): TypeOption[] {
  const opts: TypeOption[] = [
    {
      id: '',
      label: '(Custom)',
      renderPreview: (ctx, w, h) => renderPilePreview(ctx, w, h, 'round'),
    },
  ];
  for (const pt of pileTypes) {
    const capturedPt = pt;
    opts.push({
      id: pt.id,
      label: pt.name,
      renderPreview: (ctx, w, h) => renderPilePreview(ctx, w, h, capturedPt.shape),
    });
  }
  return opts;
}

function buildTextStyleOptions(textStyles: TextStyle[]): TypeOption[] {
  const opts: TypeOption[] = [
    {
      id: '',
      label: '(Custom)',
      renderPreview: (ctx, w, h) => {
        ctx.clearRect(0, 0, w, h);
        ctx.fillStyle = '#1e1e2e';
        ctx.fillRect(0, 0, w, h);
        ctx.fillStyle = '#cccccc';
        ctx.font = '10px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('Aa', w / 2, h / 2);
      },
    },
  ];
  for (const ts of textStyles) {
    const capturedTs = ts;
    opts.push({
      id: ts.id,
      label: ts.name,
      renderPreview: (ctx, w, h) => renderTextPreview(ctx, w, h, capturedTs),
    });
  }
  return opts;
}

function buildDimensionStyleOptions(presetNames: string[], currentStyleName: string): TypeOption[] {
  const opts: TypeOption[] = presetNames.map(name => ({
    id: name,
    label: name,
    renderPreview: (ctx, w, h) => renderDimensionPreview(ctx, w, h),
  }));
  if (!presetNames.includes(currentStyleName)) {
    opts.push({
      id: currentStyleName,
      label: `${currentStyleName} (custom)`,
      renderPreview: (ctx, w, h) => renderDimensionPreview(ctx, w, h),
    });
  }
  return opts;
}

function buildLineStyleOptions(): TypeOption[] {
  return LINE_STYLE_OPTIONS.map(ls => ({
    id: ls,
    label: LINE_STYLE_LABELS[ls],
    renderPreview: (ctx, w, h) => renderLinePreview(ctx, w, h, ls),
  }));
}

function buildSpotCoordinateOptions(): TypeOption[] {
  return SPOT_COORDINATE_TYPE_PRESETS.map(preset => ({
    id: preset.id,
    label: preset.name,
    renderPreview: (ctx: CanvasRenderingContext2D, w: number, h: number) => {
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = '#1e1e2e';
      ctx.fillRect(0, 0, w, h);
      const lc = preset.style.lineColor || '#ffffff';
      ctx.strokeStyle = lc;
      ctx.fillStyle = lc;
      ctx.lineWidth = 0.8;
      // cross marker
      const cx = w / 2, cy = h / 2 + 4;
      const ms = 4;
      ctx.beginPath();
      ctx.moveTo(cx - ms, cy); ctx.lineTo(cx + ms, cy);
      ctx.moveTo(cx, cy - ms); ctx.lineTo(cx, cy + ms);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(cx, cy, ms * 0.4, 0, Math.PI * 2);
      ctx.stroke();
      // leader arrow
      const lx = cx + 12, ly = cy - 12;
      ctx.beginPath();
      ctx.moveTo(cx, cy); ctx.lineTo(lx, ly);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(lx, ly);
      ctx.lineTo(lx - 4, ly + 2);
      ctx.lineTo(lx - 2, ly + 4);
      ctx.closePath();
      ctx.fill();
      // text label
      ctx.fillStyle = preset.style.textColor || '#ffffff';
      ctx.font = '5px sans-serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'bottom';
      ctx.fillText(`X: 0 ${preset.style.unit}`, lx + 2, ly - 1);
    },
  }));
}

// ─── main component ──────────────────────────────────────────────────────────

interface TypeSelectorProps {
  selectedShapes: Shape[];
}

export function TypeSelector({ selectedShapes }: TypeSelectorProps) {
  const filledRegionTypes = useAppStore(s => s.filledRegionTypes);
  const updateShape = useAppStore(s => s.updateShape);
  const getPatternById = useAppStore(s => s.getPatternById);
  const wallTypes = useAppStore(s => s.wallTypes);
  const pileTypes = useAppStore(s => s.pileTypes);
  const textStyles = useAppStore(s => s.textStyles);
  const filledRegionMode = useAppStore(s => s.filledRegionMode);
  const selectedFilledRegionTypeId = useAppStore(s => s.selectedFilledRegionTypeId);
  const setSelectedFilledRegionTypeId = useAppStore(s => s.setSelectedFilledRegionTypeId);
  const activeTool = useAppStore(s => s.activeTool);
  const currentStyle = useAppStore(s => s.currentStyle);
  const setCurrentStyle = useAppStore(s => s.setCurrentStyle);
  const setRegionTypeManagerOpen = useAppStore(s => s.setRegionTypeManagerOpen);
  const openWallTypesDialog = useAppStore(s => s.openWallTypesDialog);

  // ── Filled Region sketch mode: show Filled Region type selector ──
  if (filledRegionMode) {
    const currentTypeId = selectedFilledRegionTypeId ?? '';
    const hatchOptions = buildHatchOptions(filledRegionTypes, getPatternById, !currentTypeId);

    const handleTypeChange = (newTypeId: string) => {
      setSelectedFilledRegionTypeId(newTypeId || null);
    };

    return (
      <div className="flex items-center gap-2 px-3 py-2 bg-cad-surface border-b border-cad-border">
        <Layers className="w-3.5 h-3.5 text-cad-accent flex-shrink-0" />
        <TypeDropdown
          options={hatchOptions}
          value={currentTypeId}
          onChange={handleTypeChange}
          placeholder="Filled Region"
        />
      </div>
    );
  }

  // ── No selection — show contextual type for active drawing tool ──
  if (selectedShapes.length === 0) {
    // Line tool: show line style selector (affects currentStyle)
    const LINE_TOOLS = ['line', 'polyline', 'arc', 'circle', 'rectangle', 'ellipse', 'spline'];
    if (LINE_TOOLS.includes(activeTool)) {
      const currentLineStyle: LineStyle = currentStyle?.lineStyle ?? 'solid';
      const handleLineStyleChange = (newStyle: string) => {
        setCurrentStyle({ lineStyle: newStyle as LineStyle });
      };
      const lineOptions = buildLineStyleOptions();
      return (
        <div className="flex items-center gap-2 px-3 py-2 bg-cad-surface border-b border-cad-border">
          <ShapeTypeIcon type={activeTool as any} />
          <TypeDropdown
            options={lineOptions}
            value={currentLineStyle}
            onChange={handleLineStyleChange}
          />
        </div>
      );
    }

    // Hatch tool: show filled region type selector
    if (activeTool === 'hatch') {
      const currentTypeId = selectedFilledRegionTypeId ?? '';
      const hatchOptions = buildHatchOptions(filledRegionTypes, getPatternById, !currentTypeId);
      const handleTypeChange = (newTypeId: string) => {
        setSelectedFilledRegionTypeId(newTypeId || null);
      };
      return (
        <div className="flex items-center gap-2 px-3 py-2 bg-cad-surface border-b border-cad-border">
          <Layers className="w-3.5 h-3.5 text-cad-accent flex-shrink-0" />
          <TypeDropdown
            options={hatchOptions}
            value={currentTypeId}
            onChange={handleTypeChange}
            placeholder="Filled Region"
            onEditOption={() => setRegionTypeManagerOpen(true)}
          />
        </div>
      );
    }

    // Wall tool: show wall type selector
    if (activeTool === 'wall') {
      const wallOptions = buildWallOptions(wallTypes);
      const currentWallTypeId = '';
      return (
        <div className="flex items-center gap-2 px-3 py-2 bg-cad-surface border-b border-cad-border">
          <Box className="w-3.5 h-3.5 text-cad-text-dim flex-shrink-0" />
          <TypeDropdown
            options={wallOptions}
            value={currentWallTypeId}
            onChange={() => {}}
            placeholder="Wall Type"
            onEditOption={() => openWallTypesDialog()}
          />
        </div>
      );
    }

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

    const handleTypeChange = (newTypeId: string) => {
      const frt = filledRegionTypes.find(t => t.id === newTypeId);
      if (!frt) return;

      selectedShapes.forEach(shape => {
        updateShape(shape.id, {
          filledRegionTypeId: newTypeId,
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

    const hatchOptions = buildHatchOptions(filledRegionTypes, getPatternById, !currentTypeId);

    return (
      <div className="flex items-center gap-2 px-3 py-2 bg-cad-surface border-b border-cad-border">
        <TypeDropdown
          options={hatchOptions}
          value={currentTypeId}
          onChange={handleTypeChange}
          onEditOption={() => setRegionTypeManagerOpen(true)}
        />
        {selectedShapes.length > 1 && (
          <span className="text-[10px] text-cad-text-dim flex-shrink-0">×{selectedShapes.length}</span>
        )}
      </div>
    );
  }

  // ── Wall: wall type dropdown ──
  if (firstType === 'wall') {
    const wall = selectedShapes[0] as WallShape;
    const currentTypeId = wall.wallTypeId ?? '';

    const handleWallTypeChange = (newTypeId: string) => {
      selectedShapes.forEach(shape => {
        if (newTypeId) {
          const wt = wallTypes.find(t => t.id === newTypeId);
          if (wt) {
            updateShape(shape.id, { wallTypeId: newTypeId, thickness: wt.thickness } as Partial<WallShape>);
          } else {
            updateShape(shape.id, { wallTypeId: newTypeId } as Partial<WallShape>);
          }
        } else {
          updateShape(shape.id, { wallTypeId: undefined } as Partial<WallShape>);
        }
      });
    };

    const wallOptions = buildWallOptions(wallTypes);

    return (
      <div className="flex items-center gap-2 px-3 py-2 bg-cad-surface border-b border-cad-border">
        <TypeDropdown
          options={wallOptions}
          value={currentTypeId}
          onChange={handleWallTypeChange}
          onEditOption={() => openWallTypesDialog()}
        />
        {selectedShapes.length > 1 && (
          <span className="text-[10px] text-cad-text-dim flex-shrink-0">×{selectedShapes.length}</span>
        )}
      </div>
    );
  }

  // ── Pile: pile type dropdown ──
  if (firstType === 'pile') {
    const pile = selectedShapes[0] as PileShape;
    const currentTypeId = pile.pileTypeId ?? '';

    const handlePileTypeChange = (newTypeId: string) => {
      selectedShapes.forEach(shape => {
        updateShape(shape.id, { pileTypeId: newTypeId || undefined } as Partial<PileShape>);
      });
    };

    const pileOptions = buildPileOptions(pileTypes);

    return (
      <div className="flex items-center gap-2 px-3 py-2 bg-cad-surface border-b border-cad-border">
        <TypeDropdown
          options={pileOptions}
          value={currentTypeId}
          onChange={handlePileTypeChange}
        />
        {selectedShapes.length > 1 && (
          <span className="text-[10px] text-cad-text-dim flex-shrink-0">×{selectedShapes.length}</span>
        )}
      </div>
    );
  }

  // ── Beam: show preset name as read-only info ──
  if (firstType === 'beam') {
    const beam = selectedShapes[0] as Shape & { presetName?: string; presetId?: string };
    const presetLabel = beam.presetName ?? beam.presetId ?? 'Custom';

    return (
      <div className="flex items-center gap-2 px-3 py-2 bg-cad-surface border-b border-cad-border">
        <Box className="w-3.5 h-3.5 text-cad-text-dim flex-shrink-0" />
        <span className="flex-1 text-xs text-cad-text truncate" title={presetLabel}>
          {presetLabel}
        </span>
        {selectedShapes.length > 1 && (
          <span className="text-[10px] text-cad-text-dim flex-shrink-0">×{selectedShapes.length}</span>
        )}
      </div>
    );
  }

  // ── Text: text style dropdown ──
  if (firstType === 'text') {
    const textShape = selectedShapes[0] as TextShape;
    const currentStyleId = textShape.textStyleId ?? '';

    const handleTextStyleChange = (newStyleId: string) => {
      if (!newStyleId) {
        selectedShapes.forEach(shape => {
          updateShape(shape.id, { textStyleId: undefined } as Partial<TextShape>);
        });
        return;
      }
      const docStore = getActiveDocumentStore();
      selectedShapes.forEach(shape => {
        docStore.getState().applyTextStyleToShape(shape.id, newStyleId);
      });
    };

    const textOptions = buildTextStyleOptions(textStyles);

    return (
      <div className="flex items-center gap-2 px-3 py-2 bg-cad-surface border-b border-cad-border">
        <TypeDropdown
          options={textOptions}
          value={currentStyleId}
          onChange={handleTextStyleChange}
        />
        {selectedShapes.length > 1 && (
          <span className="text-[10px] text-cad-text-dim flex-shrink-0">×{selectedShapes.length}</span>
        )}
      </div>
    );
  }

  // ── Dimension: dimension style preset dropdown ──
  if (firstType === 'dimension') {
    const dim = selectedShapes[0] as DimensionShape;
    const currentStyleName = dim.dimensionStyleName ?? 'Default';
    const presetNames = Object.keys(DIMENSION_STYLE_PRESETS);

    const handleDimStyleChange = (newStyleName: string) => {
      const preset = DIMENSION_STYLE_PRESETS[newStyleName];
      if (!preset) return;
      selectedShapes.forEach(shape => {
        updateShape(shape.id, {
          dimensionStyleName: newStyleName,
          dimensionStyle: { ...preset },
        } as Partial<DimensionShape>);
      });
    };

    const dimOptions = buildDimensionStyleOptions(presetNames, currentStyleName);

    return (
      <div className="flex items-center gap-2 px-3 py-2 bg-cad-surface border-b border-cad-border">
        <TypeDropdown
          options={dimOptions}
          value={currentStyleName}
          onChange={handleDimStyleChange}
        />
        {selectedShapes.length > 1 && (
          <span className="text-[10px] text-cad-text-dim flex-shrink-0">×{selectedShapes.length}</span>
        )}
      </div>
    );
  }

  // ── Basic 2D shapes: line style dropdown ──
  const LINE_SHAPE_TYPES: ShapeType[] = ['line', 'polyline', 'arc', 'circle', 'rectangle', 'ellipse', 'spline'];
  if (LINE_SHAPE_TYPES.includes(firstType)) {
    const shape = selectedShapes[0];
    const currentLineStyle: LineStyle = shape.style?.lineStyle ?? 'solid';

    const handleLineStyleChange = (newStyle: string) => {
      selectedShapes.forEach(s => {
        updateShape(s.id, {
          style: { ...s.style, lineStyle: newStyle as LineStyle },
        });
      });
    };

    const lineOptions = buildLineStyleOptions();

    return (
      <div className="flex items-center gap-2 px-3 py-2 bg-cad-surface border-b border-cad-border">
        <ShapeTypeIcon type={firstType} />
        <TypeDropdown
          options={lineOptions}
          value={currentLineStyle}
          onChange={handleLineStyleChange}
        />
        {selectedShapes.length > 1 && (
          <span className="text-[10px] text-cad-text-dim flex-shrink-0">×{selectedShapes.length}</span>
        )}
      </div>
    );
  }

  // ── Spot Coordinate: preset type dropdown ──
  if (firstType === 'spot-coordinate') {
    const sc = selectedShapes[0] as SpotCoordinateShape;
    const currentTypeId = sc.spotCoordinateTypeId ?? SPOT_COORDINATE_TYPE_PRESETS[0].id;
    const scOptions = buildSpotCoordinateOptions();

    const handleScTypeChange = (newTypeId: string) => {
      const preset = SPOT_COORDINATE_TYPE_PRESETS.find(p => p.id === newTypeId);
      if (!preset) return;
      const s = preset.style;
      selectedShapes.forEach(shape => {
        const orig = shape as SpotCoordinateShape;
        updateShape(shape.id, {
          spotCoordinateTypeId: newTypeId,
          unit: s.unit,
          decimalPlaces: s.decimalPlaces,
          prefix: s.prefix,
          textHeight: s.textHeight,
          showLeader: s.showLeader,
          leaderLength: s.leaderLength,
          leaderAngle: s.leaderAngle,
          arrowType: s.arrowType,
          arrowSize: s.arrowSize,
          lineColor: s.lineColor,
          textColor: s.textColor,
          // Recompute displayX / displayY for new unit
          displayX: s.unit === 'm' ? orig.position.x / 1000 : orig.position.x,
          displayY: s.unit === 'm' ? (-orig.position.y) / 1000 : -orig.position.y,
        } as Partial<SpotCoordinateShape>);
      });
    };

    return (
      <div className="flex items-center gap-2 px-3 py-2 bg-cad-surface border-b border-cad-border">
        <TypeDropdown
          options={scOptions}
          value={currentTypeId}
          onChange={handleScTypeChange}
        />
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
