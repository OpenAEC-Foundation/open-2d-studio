import { describe, it, expect, beforeEach } from 'vitest';
import { ReferenceResolver, ReferenceResolveError } from '../ReferenceResolver';
import type { Parameter } from '../../../types/constraints';

// ── Helper ─────────────────────────────────────────────────────────────────────

function makeParam(id: string, name: string, value: number | boolean | string): Parameter {
  return { id, name, value, unit: 'mm', type: 'number' };
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('ReferenceResolver', () => {
  let resolver: ReferenceResolver;

  beforeEach(() => {
    resolver = new ReferenceResolver();
    resolver.registerShape('shape1', 'Kolom1', [
      makeParam('p1', 'width', 200),
      makeParam('p2', 'height', 3000),
    ]);
    resolver.registerShape('shape2', 'Balk1', [
      makeParam('p3', 'width', 300),
      makeParam('p4', 'depth', 500),
    ]);
    resolver.registerGlobal(makeParam('g1', 'verdiepingshoogte', 3200));
    resolver.registerGlobal(makeParam('g2', 'vloerdikte', 200));
  });

  // ── resolveLocal ─────────────────────────────────────────────────────────────

  describe('resolveLocal', () => {
    it('resolves a param by name within a shape', () => {
      expect(resolver.resolveLocal('shape1', 'width')).toBe('p1');
      expect(resolver.resolveLocal('shape1', 'height')).toBe('p2');
    });

    it('resolves params from a different shape', () => {
      expect(resolver.resolveLocal('shape2', 'width')).toBe('p3');
      expect(resolver.resolveLocal('shape2', 'depth')).toBe('p4');
    });

    it('throws ReferenceResolveError for unknown shapeId', () => {
      expect(() => resolver.resolveLocal('nonexistent', 'width'))
        .toThrow(ReferenceResolveError);
    });

    it('throws ReferenceResolveError for unknown param name', () => {
      expect(() => resolver.resolveLocal('shape1', 'depth'))
        .toThrow(ReferenceResolveError);
    });

    it('error message mentions shape id on unknown shape', () => {
      expect(() => resolver.resolveLocal('ghost', 'x'))
        .toThrow(/ghost/);
    });

    it('error message mentions param name on unknown param', () => {
      expect(() => resolver.resolveLocal('shape1', 'area'))
        .toThrow(/area/);
    });
  });

  // ── resolveCrossRef ───────────────────────────────────────────────────────────

  describe('resolveCrossRef', () => {
    it('resolves @ObjectName.paramName to paramId', () => {
      expect(resolver.resolveCrossRef('Kolom1', 'width')).toBe('p1');
      expect(resolver.resolveCrossRef('Balk1', 'depth')).toBe('p4');
    });

    it('throws ReferenceResolveError for unknown object name', () => {
      expect(() => resolver.resolveCrossRef('Onbekend', 'width'))
        .toThrow(ReferenceResolveError);
    });

    it('error message mentions object name on unknown object', () => {
      expect(() => resolver.resolveCrossRef('Onbekend', 'width'))
        .toThrow(/Onbekend/);
    });

    it('throws ReferenceResolveError for unknown param in known object', () => {
      expect(() => resolver.resolveCrossRef('Kolom1', 'area'))
        .toThrow(ReferenceResolveError);
    });

    it('error message mentions param name on unknown param of known object', () => {
      expect(() => resolver.resolveCrossRef('Kolom1', 'area'))
        .toThrow(/area/);
    });

    it('delegates to resolveGlobal when objectName is "global"', () => {
      expect(resolver.resolveCrossRef('global', 'verdiepingshoogte')).toBe('g1');
    });
  });

  // ── resolveGlobal ─────────────────────────────────────────────────────────────

  describe('resolveGlobal', () => {
    it('resolves a known global parameter by name', () => {
      expect(resolver.resolveGlobal('verdiepingshoogte')).toBe('g1');
      expect(resolver.resolveGlobal('vloerdikte')).toBe('g2');
    });

    it('throws ReferenceResolveError for unknown global param', () => {
      expect(() => resolver.resolveGlobal('onbekend'))
        .toThrow(ReferenceResolveError);
    });

    it('error message mentions param name on unknown global', () => {
      expect(() => resolver.resolveGlobal('onbekend'))
        .toThrow(/onbekend/);
    });
  });

  // ── extractDependencies ───────────────────────────────────────────────────────

  describe('extractDependencies', () => {
    it('extracts local identifiers from formula', () => {
      const deps = resolver.extractDependencies('width * 2', 'shape1');
      expect(deps).toContain('p1');
      expect(deps).not.toContain('p2');
    });

    it('extracts multiple local identifiers', () => {
      const deps = resolver.extractDependencies('width + height', 'shape1');
      expect(deps).toContain('p1');
      expect(deps).toContain('p2');
    });

    it('extracts cross-object refs (@ObjectName.param)', () => {
      const deps = resolver.extractDependencies('@Kolom1.height', 'shape2');
      expect(deps).toContain('p2');
    });

    it('extracts global refs (@global.param)', () => {
      const deps = resolver.extractDependencies('@global.verdiepingshoogte', 'shape1');
      expect(deps).toContain('g1');
    });

    it('extracts mixed dependencies (local + cross-ref + global)', () => {
      const deps = resolver.extractDependencies(
        'width + @Balk1.depth + @global.vloerdikte',
        'shape1'
      );
      expect(deps).toContain('p1');   // local: Kolom1.width
      expect(deps).toContain('p4');   // cross-ref: Balk1.depth
      expect(deps).toContain('g2');   // global: vloerdikte
    });

    it('skips built-in constants PI, TAU, E, SQRT2', () => {
      const deps = resolver.extractDependencies('PI * 2 + TAU + E + SQRT2', 'shape1');
      expect(deps).toHaveLength(0);
    });

    it('skips built-in function names (abs, sqrt, min, max, etc.)', () => {
      const deps = resolver.extractDependencies('abs(width) + sqrt(height)', 'shape1');
      // abs and sqrt should not appear as dependencies
      expect(deps).toContain('p1');
      expect(deps).toContain('p2');
      expect(deps).toHaveLength(2);
    });

    it('returns empty array for formula with only a constant', () => {
      const deps = resolver.extractDependencies('42', 'shape1');
      expect(deps).toHaveLength(0);
    });

    it('ignores unresolvable identifiers silently', () => {
      const deps = resolver.extractDependencies('nonexistentParam', 'shape1');
      expect(deps).toHaveLength(0);
    });

    it('returns empty array for invalid formula without throwing', () => {
      const deps = resolver.extractDependencies('width +++', 'shape1');
      expect(Array.isArray(deps)).toBe(true);
    });

    it('handles nested expressions with function calls', () => {
      const deps = resolver.extractDependencies('max(width, @Balk1.width)', 'shape1');
      expect(deps).toContain('p1');   // Kolom1.width
      expect(deps).toContain('p3');   // Balk1.width
    });
  });

  // ── unregisterShape ───────────────────────────────────────────────────────────

  describe('unregisterShape', () => {
    it('removes shape from registry by shapeId', () => {
      resolver.unregisterShape('shape1');
      expect(() => resolver.resolveLocal('shape1', 'width'))
        .toThrow(ReferenceResolveError);
    });

    it('also removes shape from name-based lookup', () => {
      resolver.unregisterShape('shape1');
      expect(() => resolver.resolveCrossRef('Kolom1', 'width'))
        .toThrow(ReferenceResolveError);
    });

    it('does not affect other shapes when unregistering one', () => {
      resolver.unregisterShape('shape1');
      expect(resolver.resolveLocal('shape2', 'width')).toBe('p3');
    });

    it('is safe to call for a non-existent shapeId', () => {
      expect(() => resolver.unregisterShape('ghost')).not.toThrow();
    });
  });

  // ── buildEvalContext ──────────────────────────────────────────────────────────

  describe('buildEvalContext', () => {
    it('includes local params by name', () => {
      const values = new Map<string, number | boolean | string>([
        ['p1', 200],
        ['p2', 3000],
      ]);
      const ctx = resolver.buildEvalContext('shape1', values);
      expect(ctx['width']).toBe(200);
      expect(ctx['height']).toBe(3000);
    });

    it('includes global params as @global.name keys', () => {
      const values = new Map<string, number | boolean | string>([
        ['g1', 3200],
      ]);
      const ctx = resolver.buildEvalContext('shape1', values);
      expect(ctx['@global.verdiepingshoogte']).toBe(3200);
    });

    it('includes cross-object params as @ObjectName.name keys', () => {
      const values = new Map<string, number | boolean | string>([
        ['p3', 300],
        ['p4', 500],
      ]);
      const ctx = resolver.buildEvalContext('shape1', values);
      expect(ctx['@Balk1.width']).toBe(300);
      expect(ctx['@Balk1.depth']).toBe(500);
    });

    it('does not include own shape params as cross-object keys', () => {
      const values = new Map<string, number | boolean | string>([['p1', 200]]);
      const ctx = resolver.buildEvalContext('shape1', values);
      expect(ctx['@Kolom1.width']).toBeUndefined();
    });
  });
});
