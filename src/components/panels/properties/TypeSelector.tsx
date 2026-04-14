/**
 * TypeSelector - Universal Type Selector for the Properties Panel.
 *
 * Shows at the top of the Properties Panel (like Revit's Type Selector).
 * Displays the type of the selected shape(s), with a small preview, and
 * allows changing the type where applicable (e.g. FilledRegionType for hatches,
 * WallType for walls, PileTypeDefinition for piles, TextStyle for text, etc.).
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
import { getActiveDocumentStore } from '../../../state/documentStore';
import type { Shape, HatchShape, ShapeType, WallShape, PileShape, LineStyle } from '../../../types/geometry';
import type { FilledRegionType } from '../../../types/filledRegion';
import type { CustomHatchPattern } from '../../../types/hatch';
import { BUILTIN_PATTERNS } from '../../../types/hatch';
import type { DimensionShape } from '../../../types/dimension';
import type { TextShape } from '../../../types/geometry';
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

// ─── line style names ────────────────────────────────────────────────────────

const LINE_STYLE_LABELS: Record<LineStyle, string> = {
  solid: 'Solid',
  dashed: 'Dashed',
  dotted: 'Dotted',
  dashdot: 'Dash-Dot',
};

const LINE_STYLE_OPTIONS: LineStyle[] = ['solid', 'dashed', 'dotted', 'dashdot'];

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

  // ── Wall: wall type dropdown ──
  if (firstType === 'wall') {
    const wall = selectedShapes[0] as WallShape;
    const currentTypeId = wall.wallTypeId ?? '';
    wallTypes.find(t => t.id === currentTypeId);

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

    return (
      <div className="flex items-center gap-2 px-3 py-2 bg-cad-surface border-b border-cad-border">
        <Box className="w-3.5 h-3.5 text-cad-text-dim flex-shrink-0" />
        <select
          value={currentTypeId}
          onChange={e => handleWallTypeChange(e.target.value)}
          className="flex-1 bg-cad-bg border border-cad-border rounded px-2 py-0.5 text-xs text-cad-text min-w-0"
          title="Wall Type"
        >
          <option value="">(Custom)</option>
          {wallTypes.map(wt => (
            <option key={wt.id} value={wt.id}>
              {wt.name} ({wt.thickness}mm)
            </option>
          ))}
        </select>
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

    return (
      <div className="flex items-center gap-2 px-3 py-2 bg-cad-surface border-b border-cad-border">
        <LayoutTemplate className="w-3.5 h-3.5 text-cad-text-dim flex-shrink-0" />
        <select
          value={currentTypeId}
          onChange={e => handlePileTypeChange(e.target.value)}
          className="flex-1 bg-cad-bg border border-cad-border rounded px-2 py-0.5 text-xs text-cad-text min-w-0"
          title="Pile Type"
        >
          <option value="">(Custom)</option>
          {pileTypes.map(pt => (
            <option key={pt.id} value={pt.id}>
              {pt.name}
            </option>
          ))}
        </select>
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

    return (
      <div className="flex items-center gap-2 px-3 py-2 bg-cad-surface border-b border-cad-border">
        <Type className="w-3.5 h-3.5 text-cad-text-dim flex-shrink-0" />
        <select
          value={currentStyleId}
          onChange={e => handleTextStyleChange(e.target.value)}
          className="flex-1 bg-cad-bg border border-cad-border rounded px-2 py-0.5 text-xs text-cad-text min-w-0"
          title="Text Style"
        >
          <option value="">(Custom)</option>
          {textStyles.map(ts => (
            <option key={ts.id} value={ts.id}>
              {ts.name}
            </option>
          ))}
        </select>
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

    return (
      <div className="flex items-center gap-2 px-3 py-2 bg-cad-surface border-b border-cad-border">
        <Ruler className="w-3.5 h-3.5 text-cad-text-dim flex-shrink-0" />
        <select
          value={currentStyleName}
          onChange={e => handleDimStyleChange(e.target.value)}
          className="flex-1 bg-cad-bg border border-cad-border rounded px-2 py-0.5 text-xs text-cad-text min-w-0"
          title="Dimension Style"
        >
          {presetNames.map(name => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
          {/* If current style is not in presets, show it as custom */}
          {!presetNames.includes(currentStyleName) && (
            <option value={currentStyleName}>{currentStyleName} (custom)</option>
          )}
        </select>
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

    const handleLineStyleChange = (newStyle: LineStyle) => {
      selectedShapes.forEach(s => {
        updateShape(s.id, {
          style: { ...s.style, lineStyle: newStyle },
        });
      });
    };

    return (
      <div className="flex items-center gap-2 px-3 py-2 bg-cad-surface border-b border-cad-border">
        <ShapeTypeIcon type={firstType} />
        <select
          value={currentLineStyle}
          onChange={e => handleLineStyleChange(e.target.value as LineStyle)}
          className="flex-1 bg-cad-bg border border-cad-border rounded px-2 py-0.5 text-xs text-cad-text min-w-0"
          title="Line Style"
        >
          {LINE_STYLE_OPTIONS.map(ls => (
            <option key={ls} value={ls}>
              {LINE_STYLE_LABELS[ls]}
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
