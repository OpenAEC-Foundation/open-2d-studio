import { describe, it, expect } from 'vitest';
import {
  resolveLinearArray,
  resolveRadialArray,
  resolveArray,
} from '../ComponentArrayResolver';
import type { ComponentArray } from '../../../types/component';

// ── Helpers ──────────────────────────────────────────────────

function makeLinear(overrides: Partial<ComponentArray> = {}): ComponentArray {
  return {
    id: 'arr1',
    type: 'linear',
    sourceType: 'geometry',
    sourceId: 'geom1',
    countParamId: 'count',
    spacingX: 100,
    spacingY: 0,
    ...overrides,
  };
}

function makeRadial(overrides: Partial<ComponentArray> = {}): ComponentArray {
  return {
    id: 'arr2',
    type: 'radial',
    sourceType: 'geometry',
    sourceId: 'geom1',
    countParamId: 'count',
    centerX: 0,
    centerY: 0,
    radius: 100,
    totalAngle: 360,
    ...overrides,
  };
}

function params(count: number): Map<string, number | boolean | string> {
  return new Map([['count', count]]);
}

// ── Linear array tests ────────────────────────────────────────

describe('resolveLinearArray', () => {
  it('produces 4 positions along X axis with spacing 100', () => {
    const positions = resolveLinearArray(makeLinear({ spacingX: 100, spacingY: 0 }), params(4));

    expect(positions).toHaveLength(4);
    expect(positions[0]).toEqual({ x: 0, y: 0, rotation: 0 });
    expect(positions[1]).toEqual({ x: 100, y: 0, rotation: 0 });
    expect(positions[2]).toEqual({ x: 200, y: 0, rotation: 0 });
    expect(positions[3]).toEqual({ x: 300, y: 0, rotation: 0 });
  });

  it('returns empty array when count is 0', () => {
    const positions = resolveLinearArray(makeLinear(), params(0));
    expect(positions).toHaveLength(0);
  });

  it('supports diagonal spacing (spacingX=100, spacingY=50)', () => {
    const positions = resolveLinearArray(
      makeLinear({ spacingX: 100, spacingY: 50 }),
      params(3),
    );

    expect(positions).toHaveLength(3);
    expect(positions[0]).toEqual({ x: 0, y: 0, rotation: 0 });
    expect(positions[1]).toEqual({ x: 100, y: 50, rotation: 0 });
    expect(positions[2]).toEqual({ x: 200, y: 100, rotation: 0 });
  });

  it('all positions have rotation 0', () => {
    const positions = resolveLinearArray(makeLinear(), params(5));
    for (const pos of positions) {
      expect(pos.rotation).toBe(0);
    }
  });

  it('delegates correctly from resolveArray for linear type', () => {
    const arr = makeLinear({ spacingX: 50, spacingY: 0 });
    const direct = resolveLinearArray(arr, params(2));
    const via = resolveArray(arr, params(2));
    expect(via).toEqual(direct);
  });
});

// ── Radial array tests ────────────────────────────────────────

describe('resolveRadialArray', () => {
  it('produces 4 positions around a full circle (360°), radius 100', () => {
    const positions = resolveRadialArray(makeRadial({ totalAngle: 360, radius: 100 }), params(4));

    expect(positions).toHaveLength(4);

    // 0°
    expect(positions[0].x).toBeCloseTo(100);
    expect(positions[0].y).toBeCloseTo(0);
    expect(positions[0].rotation).toBeCloseTo(0);

    // 90°
    expect(positions[1].x).toBeCloseTo(0, 5);
    expect(positions[1].y).toBeCloseTo(100);
    expect(positions[1].rotation).toBeCloseTo(Math.PI / 2);

    // 180°
    expect(positions[2].x).toBeCloseTo(-100);
    expect(positions[2].y).toBeCloseTo(0, 5);
    expect(positions[2].rotation).toBeCloseTo(Math.PI);

    // 270°
    expect(positions[3].x).toBeCloseTo(0, 5);
    expect(positions[3].y).toBeCloseTo(-100);
    expect(positions[3].rotation).toBeCloseTo((3 * Math.PI) / 2);
  });

  it('returns empty array when count is 0', () => {
    const positions = resolveRadialArray(makeRadial(), params(0));
    expect(positions).toHaveLength(0);
  });

  it('3 items over 180° arc: at 0°, 90°, 180°', () => {
    const positions = resolveRadialArray(
      makeRadial({ totalAngle: 180, radius: 100 }),
      params(3),
    );

    expect(positions).toHaveLength(3);

    // 0°
    expect(positions[0].x).toBeCloseTo(100);
    expect(positions[0].y).toBeCloseTo(0);
    expect(positions[0].rotation).toBeCloseTo(0);

    // 90°
    expect(positions[1].x).toBeCloseTo(0, 5);
    expect(positions[1].y).toBeCloseTo(100);
    expect(positions[1].rotation).toBeCloseTo(Math.PI / 2);

    // 180°
    expect(positions[2].x).toBeCloseTo(-100);
    expect(positions[2].y).toBeCloseTo(0, 5);
    expect(positions[2].rotation).toBeCloseTo(Math.PI);
  });

  it('uses center offset correctly', () => {
    const positions = resolveRadialArray(
      makeRadial({ centerX: 50, centerY: 50, radius: 10, totalAngle: 360 }),
      params(1),
    );

    expect(positions).toHaveLength(1);
    expect(positions[0].x).toBeCloseTo(60); // 50 + 10*cos(0)
    expect(positions[0].y).toBeCloseTo(50); // 50 + 10*sin(0)
  });

  it('delegates correctly from resolveArray for radial type', () => {
    const arr = makeRadial();
    const direct = resolveRadialArray(arr, params(4));
    const via = resolveArray(arr, params(4));
    expect(via).toEqual(direct);
  });
});
