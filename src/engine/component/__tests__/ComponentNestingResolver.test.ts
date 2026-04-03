import { describe, it, expect } from 'vitest';
import { NestingResolver, NestingCycleError } from '../ComponentNestingResolver';
import type { ComponentDefinition, NestedComponentRef } from '../../../types/component';

// ── Builder helpers ────────────────────────────────────────────

function makeDef(
  id: string,
  nestedIds: string[] = [],
): ComponentDefinition {
  return {
    id,
    name: id,
    category: 'custom',
    version: '1.0.0',
    createdAt: 0,
    updatedAt: 0,
    parameters: [],
    constraintGraph: { parameters: [], vertices: [], edges: [], constraintGraph: { nodes: {}, solveOrder: [], globalParameters: {}, isDirty: false } },
    representations: [],
    nestedComponents: nestedIds.map<NestedComponentRef>((nid, i) => ({
      id: `ref-${id}-${nid}-${i}`,
      definitionId: nid,
      shared: false,
      positionX: 0,
      positionY: 0,
      parameterOverrides: {},
    })),
    componentArrays: [],
  };
}

function makeResolver(defs: ComponentDefinition[]): NestingResolver {
  const map = new Map(defs.map((d) => [d.id, d]));
  return new NestingResolver(map);
}

// ── validateNesting tests ─────────────────────────────────────

describe('NestingResolver.validateNesting', () => {
  it('throws NestingCycleError for direct self-nesting (A → A)', () => {
    const resolver = makeResolver([makeDef('A', ['A'])]);
    expect(() => resolver.validateNesting('A')).toThrow(NestingCycleError);
  });

  it('cycle error contains the cycle path for self-nesting', () => {
    const resolver = makeResolver([makeDef('A', ['A'])]);
    try {
      resolver.validateNesting('A');
      expect.fail('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(NestingCycleError);
      const err = e as NestingCycleError;
      expect(err.cyclePath).toContain('A');
    }
  });

  it('throws NestingCycleError for indirect cycle (A → B → A)', () => {
    const resolver = makeResolver([makeDef('A', ['B']), makeDef('B', ['A'])]);
    expect(() => resolver.validateNesting('A')).toThrow(NestingCycleError);
  });

  it('cycle path includes all nodes in the cycle for A → B → A', () => {
    const resolver = makeResolver([makeDef('A', ['B']), makeDef('B', ['A'])]);
    try {
      resolver.validateNesting('A');
      expect.fail('should have thrown');
    } catch (e) {
      const err = e as NestingCycleError;
      expect(err.cyclePath).toContain('A');
      expect(err.cyclePath).toContain('B');
    }
  });

  it('does not throw for valid nesting (A → B, A → C)', () => {
    const resolver = makeResolver([makeDef('A', ['B', 'C']), makeDef('B'), makeDef('C')]);
    expect(() => resolver.validateNesting('A')).not.toThrow();
  });

  it('does not throw for diamond pattern (A → B → D, A → C → D)', () => {
    const resolver = makeResolver([
      makeDef('A', ['B', 'C']),
      makeDef('B', ['D']),
      makeDef('C', ['D']),
      makeDef('D'),
    ]);
    expect(() => resolver.validateNesting('A')).not.toThrow();
  });

  it('does not throw for a leaf definition with no nesting', () => {
    const resolver = makeResolver([makeDef('A')]);
    expect(() => resolver.validateNesting('A')).not.toThrow();
  });

  it('does not throw for an unknown definition id', () => {
    const resolver = makeResolver([]);
    expect(() => resolver.validateNesting('unknown')).not.toThrow();
  });
});

// ── getNestingDepth tests ─────────────────────────────────────

describe('NestingResolver.getNestingDepth', () => {
  it('returns 0 for a component with no nesting', () => {
    const resolver = makeResolver([makeDef('A')]);
    expect(resolver.getNestingDepth('A')).toBe(0);
  });

  it('returns 0 for an unknown definition id', () => {
    const resolver = makeResolver([]);
    expect(resolver.getNestingDepth('unknown')).toBe(0);
  });

  it('returns 1 for A → B where B has no nesting', () => {
    const resolver = makeResolver([makeDef('A', ['B']), makeDef('B')]);
    expect(resolver.getNestingDepth('A')).toBe(1);
  });

  it('returns 2 for chain A → B → C', () => {
    const resolver = makeResolver([
      makeDef('A', ['B']),
      makeDef('B', ['C']),
      makeDef('C'),
    ]);
    expect(resolver.getNestingDepth('A')).toBe(2);
  });

  it('returns correct depth for diamond: A → B → D, A → C → D (depth 2)', () => {
    const resolver = makeResolver([
      makeDef('A', ['B', 'C']),
      makeDef('B', ['D']),
      makeDef('C', ['D']),
      makeDef('D'),
    ]);
    expect(resolver.getNestingDepth('A')).toBe(2);
  });

  it('returns the maximum depth among branches', () => {
    const resolver = makeResolver([
      makeDef('A', ['B', 'C']),
      makeDef('B', ['D', 'E']),
      makeDef('C'),
      makeDef('D'),
      makeDef('E', ['F']),
      makeDef('F'),
    ]);
    // A → B → E → F = depth 3
    expect(resolver.getNestingDepth('A')).toBe(3);
  });
});
