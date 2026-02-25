import { useMemo } from 'react';
import { useAppStore, useDrawingShapes, useUnitSettings } from '../../state/appStore';
import { formatNumber } from '../../units';
import type { PileShape, PileType } from '../../types/geometry';

// Friendly labels for pile types
const PILE_TYPE_LABELS: Record<PileType, string> = {
  'prefab-concrete': 'Prefab Concrete',
  'steel-tube': 'Steel Tube',
  'vibro': 'Vibro',
  'screw': 'Screw',
};

export function PilePlanTab() {
  const shapes = useDrawingShapes();
  const { selectShapes, selectedShapeIds } = useAppStore();
  const unitSettings = useUnitSettings();

  // Filter to pile shapes only
  const piles = useMemo(() => {
    return shapes.filter((s): s is PileShape => s.type === 'pile');
  }, [shapes]);

  // Group by pile type for summary
  const summary = useMemo(() => {
    const counts = new Map<string, number>();
    for (const pile of piles) {
      const key = pile.pileType
        ? PILE_TYPE_LABELS[pile.pileType] || pile.pileType
        : 'Unknown';
      counts.set(key, (counts.get(key) || 0) + 1);
    }
    return counts;
  }, [piles]);

  // Build summary string like "12 piles (8x Prefab Concrete, 4x Steel Tube)"
  const summaryText = useMemo(() => {
    if (piles.length === 0) return '';
    const total = `${piles.length} pile${piles.length !== 1 ? 's' : ''}`;
    if (summary.size <= 1) return total;
    const parts = Array.from(summary.entries())
      .map(([type, count]) => `${count}\u00d7 ${type}`)
      .join(', ');
    return `${total} (${parts})`;
  }, [piles, summary]);

  const selectedSet = useMemo(() => new Set(selectedShapeIds), [selectedShapeIds]);

  const handleRowClick = (pileId: string) => {
    selectShapes([pileId]);
  };

  // Empty state
  if (piles.length === 0) {
    return (
      <div className="flex flex-col h-full">
        <div className="flex-1 flex items-center justify-center p-4">
          <span className="text-xs text-cad-text-dim">No piles in this drawing.</span>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Summary */}
      <div className="px-2 py-1.5 border-b border-cad-border">
        <span className="text-xs text-cad-text-dim">{summaryText}</span>
      </div>

      {/* Pile table */}
      <div className="flex-1 overflow-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-cad-text-dim border-b border-cad-border sticky top-0 bg-cad-surface">
              <th className="text-left px-2 py-1 font-medium">Label</th>
              <th className="text-right px-2 py-1 font-medium">X</th>
              <th className="text-right px-2 py-1 font-medium">Y</th>
              <th className="text-right px-2 py-1 font-medium">&Oslash;</th>
              <th className="text-left px-2 py-1 font-medium">Type</th>
            </tr>
          </thead>
          <tbody>
            {piles.map((pile) => {
              const isSelected = selectedSet.has(pile.id);
              return (
                <tr
                  key={pile.id}
                  onClick={() => handleRowClick(pile.id)}
                  className={`cursor-default transition-colors ${
                    isSelected
                      ? 'bg-cad-accent/20'
                      : 'hover:bg-cad-border/50'
                  }`}
                >
                  <td className="px-2 py-1 text-cad-text">{pile.label || '—'}</td>
                  <td className="px-2 py-1 text-cad-text text-right tabular-nums">
                    {formatNumber(pile.position.x, 0, unitSettings.numberFormat)}
                  </td>
                  <td className="px-2 py-1 text-cad-text text-right tabular-nums">
                    {formatNumber(-pile.position.y, 0, unitSettings.numberFormat)}
                  </td>
                  <td className="px-2 py-1 text-cad-text text-right tabular-nums">
                    {formatNumber(pile.diameter, 0, unitSettings.numberFormat)}
                  </td>
                  <td className="px-2 py-1 text-cad-text-dim">
                    {pile.pileType ? PILE_TYPE_LABELS[pile.pileType] || pile.pileType : '—'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
