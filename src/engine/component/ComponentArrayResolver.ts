import type { ComponentArray } from '../../types/component';

// ── Array position ───────────────────────────────────────────

export interface ArrayPosition {
  x: number;
  y: number;
  rotation: number;
}

// ── Param resolution helper ──────────────────────────────────

function resolveCount(
  paramId: string,
  paramValues: Map<string, number | boolean | string>,
): number {
  const val = paramValues.get(paramId);
  let n = 0;
  if (typeof val === 'number') {
    n = val;
  } else if (typeof val === 'string') {
    const parsed = parseFloat(val);
    if (!isNaN(parsed)) n = parsed;
  }
  return Math.max(0, Math.round(n));
}

// ── Linear array ─────────────────────────────────────────────

export function resolveLinearArray(
  array: ComponentArray,
  paramValues: Map<string, number | boolean | string>,
): ArrayPosition[] {
  const count = resolveCount(array.countParamId, paramValues);
  if (count === 0) return [];

  const spacingX = array.spacingX ?? 0;
  const spacingY = array.spacingY ?? 0;

  const positions: ArrayPosition[] = [];
  for (let i = 0; i < count; i++) {
    positions.push({
      x: i * spacingX,
      y: i * spacingY,
      rotation: 0,
    });
  }
  return positions;
}

// ── Radial array ─────────────────────────────────────────────

export function resolveRadialArray(
  array: ComponentArray,
  paramValues: Map<string, number | boolean | string>,
): ArrayPosition[] {
  const count = resolveCount(array.countParamId, paramValues);
  if (count === 0) return [];

  const centerX = array.centerX ?? 0;
  const centerY = array.centerY ?? 0;
  const radius = array.radius ?? 0;
  const totalAngleDeg = array.totalAngle ?? 360;
  const totalAngleRad = (totalAngleDeg * Math.PI) / 180;

  // Full circle (360°): divide by count; partial arc: divide by (count - 1)
  const isFullCircle = Math.abs(totalAngleDeg - 360) < 1e-9;
  const divisor = isFullCircle ? count : Math.max(1, count - 1);

  const positions: ArrayPosition[] = [];
  for (let i = 0; i < count; i++) {
    const angle = (i * totalAngleRad) / divisor;
    positions.push({
      x: centerX + radius * Math.cos(angle),
      y: centerY + radius * Math.sin(angle),
      rotation: angle,
    });
  }
  return positions;
}

// ── Unified resolver ─────────────────────────────────────────

export function resolveArray(
  array: ComponentArray,
  paramValues: Map<string, number | boolean | string>,
): ArrayPosition[] {
  if (array.type === 'linear') {
    return resolveLinearArray(array, paramValues);
  }
  return resolveRadialArray(array, paramValues);
}
