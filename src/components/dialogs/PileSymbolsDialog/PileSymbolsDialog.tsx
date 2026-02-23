/**
 * PileSymbolsDialog - Configure pile symbol order for pile plans.
 * Implements Dutch pile symbol standards (NEN) with correct contour shapes
 * and fill patterns matching the Revit library conventions.
 *
 * Symbol naming: {Contour}{FillPattern}
 *   Contours: R (round), RH (square), RD (diamond), RR (rotated diamond),
 *             RRR (double circle), DR (triangle), Achthoek (octagon)
 *   Fill patterns: 1-17 (see FILL_PATTERN_LABELS)
 */

import { useState, useRef, useCallback, useEffect } from 'react';
import { X } from 'lucide-react';
import { useAppStore } from '../../../state/appStore';

// ---------------------------------------------------------------------------
// Symbol definitions
// ---------------------------------------------------------------------------

export type ContourType =
  | 'circle'
  | 'square'
  | 'diamond'
  | 'diamond-circle'
  | 'double-circle'
  | 'triangle-circle'
  | 'octagon';

export interface PileSymbolDef {
  id: string;
  contour: ContourType;
  fillPattern: number;
  label: string;
}

// ---------------------------------------------------------------------------
// Contour group metadata
// ---------------------------------------------------------------------------

interface ContourGroup {
  key: string;
  title: string;
  contour: ContourType;
  symbols: PileSymbolDef[];
}

// ---------------------------------------------------------------------------
// Fill pattern descriptions (for tooltips)
// ---------------------------------------------------------------------------

const FILL_PATTERN_LABELS: Record<number, string> = {
  1: 'Kwart linksboven',
  2: 'Halve boven',
  3: 'Schaakbord',
  4: 'Volledig gevuld',
  5: 'Driekwart',
  6: 'Leeg',
  7: 'Halve links',
  8: 'Verticale middenstrip',
  9: 'Rechtsonder sikkel',
  10: 'Dubbele strip',
  11: 'Wig linksboven',
  12: 'Vlinderdas',
  13: 'Wig boven',
  14: 'Halve rechts',
  15: 'Halve rechtsonder',
  16: 'Wig linksonder',
  17: 'Halve rechts (alt)',
  18: 'Patroon 18',
  19: 'Patroon 19',
};

// ---------------------------------------------------------------------------
// All 65 symbol definitions grouped by contour
// ---------------------------------------------------------------------------

function makeSymbols(prefix: string, contour: ContourType, patterns: number[]): PileSymbolDef[] {
  return patterns.map(p => ({
    id: `${prefix}${p}`,
    contour,
    fillPattern: p,
    label: `${prefix}${p}`,
  }));
}

function makeSymbolsWithVariants(prefix: string, contour: ContourType, patterns: number[]): PileSymbolDef[] {
  const result: PileSymbolDef[] = [];
  for (const p of patterns) {
    result.push({ id: `${prefix}${p}`, contour, fillPattern: p, label: `${prefix}${p}` });
    result.push({ id: `${prefix}${p}-2`, contour, fillPattern: p, label: `${prefix}${p}-2` });
  }
  return result;
}

const R_SYMBOLS = makeSymbols('R', 'circle', [1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17]);
const RH_SYMBOLS = makeSymbolsWithVariants('RH', 'square', [1,2,3,4,5,6,7,8,9,10]);
const RD_SYMBOLS = makeSymbols('RD', 'diamond', [1,3,5,6,8,10,17,18,19]);
const RR_SYMBOLS = makeSymbols('RR', 'diamond-circle', [1,3,5,6,8,10,17,18,19]);
const RRR_SYMBOLS = makeSymbols('RRR', 'double-circle', [1,2,3,4,5,6]);
const DR_SYMBOLS: PileSymbolDef[] = [{ id: 'DR6', contour: 'triangle-circle', fillPattern: 6, label: 'DR6' }];
const ACHTHOEK_SYMBOLS: PileSymbolDef[] = [
  { id: 'Achthoek_1', contour: 'octagon', fillPattern: 1, label: 'Achthoek 1' },
  { id: 'Achthoek_5', contour: 'octagon', fillPattern: 5, label: 'Achthoek 5' },
];

/** Internal contour groups (used for state storage key mapping) */
const CONTOUR_GROUPS: ContourGroup[] = [
  { key: 'R', title: 'Rond (R)', contour: 'circle', symbols: R_SYMBOLS },
  { key: 'RH', title: 'Vierkant (RH)', contour: 'square', symbols: RH_SYMBOLS },
  { key: 'RD', title: 'Ruit (RD)', contour: 'diamond', symbols: RD_SYMBOLS },
  { key: 'RR', title: 'Ruit-Rond (RR)', contour: 'diamond-circle', symbols: RR_SYMBOLS },
  { key: 'RRR', title: 'Dubbel Rond (RRR)', contour: 'double-circle', symbols: RRR_SYMBOLS },
  { key: 'DR', title: 'Driehoek (DR)', contour: 'triangle-circle', symbols: DR_SYMBOLS },
  { key: 'Achthoek', title: 'Achthoek', contour: 'octagon', symbols: ACHTHOEK_SYMBOLS },
];

/** Display groups: just two categories for the dialog UI */
interface DisplayGroup {
  key: string;
  title: string;
  /** Sub-groups with their state keys, to preserve per-group ordering */
  subGroups: ContourGroup[];
}

const ROND_KEYS = new Set(['R', 'RR', 'RRR', 'DR', 'Achthoek']);
const VIERKANT_KEYS = new Set(['RH', 'RD']);

const DISPLAY_GROUPS: DisplayGroup[] = [
  {
    key: 'rond',
    title: 'Rond',
    subGroups: CONTOUR_GROUPS.filter(g => ROND_KEYS.has(g.key)),
  },
  {
    key: 'vierkant',
    title: 'Vierkant',
    subGroups: CONTOUR_GROUPS.filter(g => VIERKANT_KEYS.has(g.key)),
  },
];

/** All symbols flat list */
export const ALL_PILE_SYMBOLS: PileSymbolDef[] = CONTOUR_GROUPS.flatMap(g => g.symbols);

/** Default order keyed by contour group key */
export const DEFAULT_PILE_SYMBOL_ORDER: Record<string, string[]> = Object.fromEntries(
  CONTOUR_GROUPS.map(g => [g.key, g.symbols.map(s => s.id)])
);

// ---------------------------------------------------------------------------
// SVG rendering
// ---------------------------------------------------------------------------

/**
 * Render a pile symbol as SVG elements.
 * All symbols have crosshair lines extending slightly beyond the outer contour,
 * and fill patterns are always clipped to the inner circle.
 */
export function renderPileSymbol(
  contour: ContourType,
  fillPattern: number,
  size: number,
  clipId: string,
): React.ReactNode {
  const C = size / 2; // center
  const crossExt = size * 0.475; // crosshair half-length (~95% of size)
  const circR = size * 0.38; // inner circle radius
  // Crosshair lines (always present)
  const crosshairs = (
    <>
      <line x1={C - crossExt} y1={C} x2={C + crossExt} y2={C} stroke="black" strokeWidth={1.5} />
      <line x1={C} y1={C - crossExt} x2={C} y2={C + crossExt} stroke="black" strokeWidth={1.5} />
    </>
  );

  // Clip path for inner circle (fill is always clipped here)
  const clipPath = (
    <defs>
      <clipPath id={clipId}>
        <circle cx={C} cy={C} r={circR} />
      </clipPath>
    </defs>
  );

  // Fill pattern geometry (clipped to inner circle)
  const fill = renderFillPattern(fillPattern, C, circR, clipId);

  // Inner circle outline (always drawn)
  const innerCircle = (
    <circle cx={C} cy={C} r={circR} fill="none" stroke="black" strokeWidth={1.5} />
  );

  // Outer contour shape
  const outerContour = renderContour(contour, C, circR, size);

  return (
    <>
      {clipPath}
      {fill}
      {outerContour}
      {innerCircle}
      {crosshairs}
    </>
  );
}

function renderContour(contour: ContourType, C: number, _circR: number, size: number): React.ReactNode {
  const sqSide = size * 0.72;
  const sqHalf = sqSide / 2;

  switch (contour) {
    case 'circle':
      // Outer shape IS the inner circle (already drawn)
      return null;

    case 'square':
      return (
        <rect
          x={C - sqHalf} y={C - sqHalf}
          width={sqSide} height={sqSide}
          fill="none" stroke="black" strokeWidth={1.5}
        />
      );

    case 'diamond': {
      // Diamond (45-degree rotated square) with circle inside
      const dSize = size * 0.40;
      return (
        <polygon
          points={`${C},${C - dSize} ${C + dSize},${C} ${C},${C + dSize} ${C - dSize},${C}`}
          fill="none" stroke="black" strokeWidth={1.5}
        />
      );
    }

    case 'diamond-circle': {
      // Diamond with circle inside (RR = Ruit-Rond)
      const dSize = size * 0.40;
      return (
        <polygon
          points={`${C},${C - dSize} ${C + dSize},${C} ${C},${C + dSize} ${C - dSize},${C}`}
          fill="none" stroke="black" strokeWidth={1.5}
        />
      );
    }

    case 'double-circle': {
      // Outer circle larger than inner
      const outerR = size * 0.45;
      return (
        <circle cx={C} cy={C} r={outerR} fill="none" stroke="black" strokeWidth={1.5} />
      );
    }

    case 'triangle-circle': {
      // Inverted triangle with circle inside
      const tSize = size * 0.44;
      const topY = C - tSize * 0.7;
      const botY = C + tSize * 0.9;
      const halfBase = tSize * 0.95;
      return (
        <polygon
          points={`${C - halfBase},${topY} ${C + halfBase},${topY} ${C},${botY}`}
          fill="none" stroke="black" strokeWidth={1.5}
        />
      );
    }

    case 'octagon': {
      // Regular octagon
      const octR = size * 0.425;
      const pts: string[] = [];
      for (let i = 0; i < 8; i++) {
        const angle = (Math.PI * 2 * i) / 8 - Math.PI / 8;
        pts.push(`${C + octR * Math.cos(angle)},${C + octR * Math.sin(angle)}`);
      }
      return (
        <polygon points={pts.join(' ')} fill="none" stroke="black" strokeWidth={1.5} />
      );
    }

    default:
      return null;
  }
}

function renderFillPattern(
  pattern: number,
  C: number,
  R: number,
  clipId: string,
): React.ReactNode {
  const group = (children: React.ReactNode) => (
    <g clipPath={`url(#${clipId})`}>{children}</g>
  );

  // Helper: arc path for a pie slice from startAngle to endAngle (degrees, 0=right, clockwise)
  function pieSlice(startDeg: number, endDeg: number): string {
    const toRad = (d: number) => (d * Math.PI) / 180;
    const x1 = C + R * Math.cos(toRad(startDeg));
    const y1 = C + R * Math.sin(toRad(startDeg));
    const x2 = C + R * Math.cos(toRad(endDeg));
    const y2 = C + R * Math.sin(toRad(endDeg));
    const sweep = endDeg - startDeg;
    const largeArc = Math.abs(sweep) > 180 ? 1 : 0;
    return `M ${C},${C} L ${x1},${y1} A ${R},${R} 0 ${largeArc},1 ${x2},${y2} Z`;
  }

  switch (pattern) {
    case 1:
      // Top-left quadrant (180 to 270 degrees)
      return group(<path d={pieSlice(180, 270)} fill="black" />);

    case 2:
      // Top half (180 to 360)
      return group(<path d={pieSlice(180, 360)} fill="black" />);

    case 3:
      // Checkerboard: top-left + bottom-right quadrants
      return group(
        <>
          <path d={pieSlice(180, 270)} fill="black" />
          <path d={pieSlice(0, 90)} fill="black" />
        </>
      );

    case 4:
      // Fully filled
      return group(<circle cx={C} cy={C} r={R} fill="black" />);

    case 5:
      // Three quadrants (not bottom-right)
      return group(
        <>
          <path d={pieSlice(180, 270)} fill="black" />
          <path d={pieSlice(270, 360)} fill="black" />
          <path d={pieSlice(90, 180)} fill="black" />
        </>
      );

    case 6:
      // Empty - no fill
      return null;

    case 7:
      // Left half (90 to 270)
      return group(<path d={pieSlice(90, 270)} fill="black" />);

    case 8: {
      // Vertical center strip (~30% width)
      const stripW = R * 0.6;
      return group(
        <rect x={C - stripW / 2} y={C - R} width={stripW} height={R * 2} fill="black" />
      );
    }

    case 9:
      // Bottom-right crescent: bottom-right quadrant
      return group(<path d={pieSlice(0, 90)} fill="black" />);

    case 10: {
      // Two vertical strips with gap
      const stripW = R * 0.3;
      const gap = R * 0.15;
      return group(
        <>
          <rect x={C - gap - stripW} y={C - R} width={stripW} height={R * 2} fill="black" />
          <rect x={C + gap} y={C - R} width={stripW} height={R * 2} fill="black" />
        </>
      );
    }

    case 11: {
      // Top-left wedge/triangle
      return group(
        <polygon points={`${C},${C} ${C - R},${C} ${C},${C - R}`} fill="black" />
      );
    }

    case 12: {
      // Bowtie: left + right triangles pointing to center
      return group(
        <>
          <polygon points={`${C - R},${C - R} ${C},${C} ${C - R},${C + R}`} fill="black" />
          <polygon points={`${C + R},${C - R} ${C},${C} ${C + R},${C + R}`} fill="black" />
        </>
      );
    }

    case 13: {
      // Top small wedge
      return group(
        <polygon points={`${C},${C} ${C - R * 0.5},${C - R} ${C + R * 0.5},${C - R}`} fill="black" />
      );
    }

    case 14:
      // Right half (270 to 90, i.e. 270 to 450)
      return group(<path d={pieSlice(270, 450)} fill="black" />);

    case 15:
      // Bottom half (0 to 180)
      return group(<path d={pieSlice(0, 180)} fill="black" />);

    case 16: {
      // Bottom-left wedge
      return group(
        <polygon points={`${C},${C} ${C - R},${C} ${C},${C + R}`} fill="black" />
      );
    }

    case 17:
      // Right half (same as 14)
      return group(<path d={pieSlice(270, 450)} fill="black" />);

    case 18:
      // Pattern 18: top-right quadrant
      return group(<path d={pieSlice(270, 360)} fill="black" />);

    case 19:
      // Pattern 19: bottom-left quadrant
      return group(<path d={pieSlice(90, 180)} fill="black" />);

    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface PileSymbolsDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

const PREVIEW_SIZE = 48;

function SymbolCard({
  symbol,
  index,
  dragIndex,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
  selected,
  onClick,
}: {
  symbol: PileSymbolDef;
  index: number;
  dragIndex: number | null;
  onDragStart: (i: number) => void;
  onDragOver: (i: number) => void;
  onDrop: () => void;
  onDragEnd: () => void;
  selected: boolean;
  onClick: () => void;
}) {
  const clipId = `pile-clip-${symbol.id}`;
  return (
    <div
      draggable
      onDragStart={() => onDragStart(index)}
      onDragOver={(e) => { e.preventDefault(); onDragOver(index); }}
      onDrop={onDrop}
      onDragEnd={onDragEnd}
      onClick={onClick}
      className={`flex flex-col items-center gap-0.5 p-1.5 rounded cursor-grab border select-none transition-colors
        ${selected ? 'border-cad-accent bg-cad-accent/20' : 'border-cad-border hover:bg-cad-bg-hover'}
        ${dragIndex === index ? 'opacity-40' : 'opacity-100'}
      `}
      title={`${symbol.label} - ${FILL_PATTERN_LABELS[symbol.fillPattern] ?? ''}`}
    >
      <span className="text-[9px] text-cad-text-dim tabular-nums">{index + 1}</span>
      <svg
        width={PREVIEW_SIZE}
        height={PREVIEW_SIZE}
        viewBox={`0 0 ${PREVIEW_SIZE} ${PREVIEW_SIZE}`}
        className="bg-white"
      >
        {renderPileSymbol(symbol.contour, symbol.fillPattern, PREVIEW_SIZE, clipId)}
      </svg>
      <span className="text-[8px] text-cad-text-dim truncate max-w-[56px] text-center">
        {symbol.id}
      </span>
    </div>
  );
}

function SymbolGrid({
  title,
  groupKey,
  allSymbols,
  order,
  onOrderChange,
}: {
  title: string;
  groupKey: string;
  allSymbols: PileSymbolDef[];
  order: string[];
  onOrderChange: (key: string, newOrder: string[]) => void;
}) {
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const overIndex = useRef<number | null>(null);

  // Build ordered list
  const symbolMap = new Map(allSymbols.map(s => [s.id, s]));
  const ordered: PileSymbolDef[] = [];
  for (const id of order) {
    const sym = symbolMap.get(id);
    if (sym) ordered.push(sym);
  }
  for (const sym of allSymbols) {
    if (!order.includes(sym.id)) ordered.push(sym);
  }

  const handleDragStart = useCallback((i: number) => { setDragIndex(i); }, []);
  const handleDragOver = useCallback((i: number) => { overIndex.current = i; }, []);
  const handleDrop = useCallback(() => {
    if (dragIndex == null || overIndex.current == null || dragIndex === overIndex.current) return;
    const newOrder = ordered.map(s => s.id);
    const [moved] = newOrder.splice(dragIndex, 1);
    newOrder.splice(overIndex.current, 0, moved);
    onOrderChange(groupKey, newOrder);
    setDragIndex(null);
    overIndex.current = null;
  }, [dragIndex, ordered, onOrderChange, groupKey]);
  const handleDragEnd = useCallback(() => { setDragIndex(null); overIndex.current = null; }, []);

  return (
    <div>
      {title && <h3 className="text-xs font-semibold text-cad-text mb-2">{title}</h3>}
      <div className="grid gap-1" style={{ gridTemplateColumns: 'repeat(6, 1fr)' }}>
        {ordered.map((sym, i) => (
          <SymbolCard
            key={sym.id}
            symbol={sym}
            index={i}
            dragIndex={dragIndex}
            onDragStart={handleDragStart}
            onDragOver={handleDragOver}
            onDrop={handleDrop}
            onDragEnd={handleDragEnd}
            selected={selectedId === sym.id}
            onClick={() => setSelectedId(prev => prev === sym.id ? null : sym.id)}
          />
        ))}
      </div>
    </div>
  );
}

export function PileSymbolsDialog({ isOpen, onClose }: PileSymbolsDialogProps) {
  const pileSymbolOrder = useAppStore(s => s.pileSymbolOrder);
  const setPileSymbolOrder = useAppStore(s => s.setPileSymbolOrder);

  const [localOrder, setLocalOrder] = useState<Record<string, string[]>>(pileSymbolOrder);

  // Drag state for the dialog itself
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const dragStartRef = useRef({ x: 0, y: 0 });

  useEffect(() => {
    if (isOpen) {
      setLocalOrder({ ...pileSymbolOrder });
      setPosition({ x: 0, y: 0 });
    }
  }, [isOpen, pileSymbolOrder]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('button, input, select, label')) return;
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

  const handleMouseUp = useCallback(() => { setIsDragging(false); }, []);

  const handleGroupOrderChange = useCallback((key: string, newOrder: string[]) => {
    setLocalOrder(prev => ({ ...prev, [key]: newOrder }));
  }, []);

  const handleSave = () => {
    for (const group of CONTOUR_GROUPS) {
      const order = localOrder[group.key];
      if (order) {
        setPileSymbolOrder(group.key, order);
      }
    }
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
    >
      <div
        className="bg-cad-surface border border-cad-border shadow-xl w-[720px] max-h-[85vh] flex flex-col"
        style={{ transform: `translate(${position.x}px, ${position.y}px)` }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-4 py-2 border-b border-cad-border cursor-move select-none flex-shrink-0"
          onMouseDown={handleMouseDown}
        >
          <h2 className="text-sm font-semibold text-cad-text">Paalsymbolen</h2>
          <button onClick={onClose} className="p-1 hover:bg-cad-hover rounded text-cad-text-secondary">
            <X size={14} />
          </button>
        </div>

        {/* Content (scrollable) */}
        <div className="flex-1 overflow-y-auto p-4 space-y-6">
          <p className="text-[11px] text-cad-text-dim">
            Versleep symbolen om de volgorde te bepalen. Het eerste symbool wordt als eerste gebruikt bij het plaatsen van palen.
          </p>

          {DISPLAY_GROUPS.map(dg => (
            <div key={dg.key}>
              <h3 className="text-xs font-bold text-cad-text uppercase tracking-wide mb-3 border-b border-cad-border pb-1">{dg.title}</h3>
              <div className="space-y-4">
                {dg.subGroups.map(group => (
                  <SymbolGrid
                    key={group.key}
                    title=""
                    groupKey={group.key}
                    allSymbols={group.symbols}
                    order={localOrder[group.key] ?? group.symbols.map(s => s.id)}
                    onOrderChange={handleGroupOrderChange}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 px-4 py-3 border-t border-cad-border flex-shrink-0">
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-xs bg-cad-bg border border-cad-border text-cad-text rounded hover:bg-cad-hover"
          >
            Annuleren
          </button>
          <button
            onClick={handleSave}
            className="px-4 py-1.5 text-xs bg-blue-600 text-white rounded hover:bg-blue-700"
          >
            Opslaan
          </button>
        </div>
      </div>
    </div>
  );
}

export default PileSymbolsDialog;
