import { describe, it, expect } from 'vitest';
import { ConstraintSolver } from '../ConstraintSolver';
import { CycleError } from '../ConstraintGraph';
import type { Parameter } from '../../../types/constraints';

// ── Helper ────────────────────────────────────────────────────────────────────

function makeParam(id: string, name: string, value: number, formula?: string): Parameter {
  return { id, name, value, unit: 'mm', type: 'number', formula };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('ConstraintSolver', () => {

  // ── Simple chain ────────────────────────────────────────────────────────────

  describe('simple chain', () => {
    it('evaluates height, flangeWidth=height*0.5, webThick=max(8,height/40)', () => {
      const solver = new ConstraintSolver();
      solver.addShape('s1', 'HEA300', [
        makeParam('p_height',     'height',     300),
        makeParam('p_flange',     'flangeWidth', 0, 'height * 0.5'),
        makeParam('p_web',        'webThick',    0, 'max(8, height / 40)'),
      ]);

      const changed = solver.solve();

      expect(solver.getValue('p_flange')).toBe(150);
      expect(solver.getValue('p_web')).toBe(8);       // max(8, 300/40=7.5) → 8
      expect(changed.has('s1')).toBe(true);
    });

    it('webThick is 10 when height=400 (400/40=10 > 8)', () => {
      const solver = new ConstraintSolver();
      solver.addShape('s1', 'HEA400', [
        makeParam('p_height', 'height',     400),
        makeParam('p_web',    'webThick',   0, 'max(8, height / 40)'),
      ]);
      solver.solve();
      expect(solver.getValue('p_web')).toBe(10);
    });
  });

  // ── Cross-object references ─────────────────────────────────────────────────

  describe('cross-object references', () => {
    it('resolves @Kolom1.width/2 from another shape', () => {
      const solver = new ConstraintSolver();
      solver.addShape('s1', 'Kolom1', [makeParam('p_w', 'width', 400)]);
      solver.addShape('s2', 'Beam1',  [makeParam('p_o', 'offset', 0, '@Kolom1.width / 2')]);

      solver.solve();

      expect(solver.getValue('p_o')).toBe(200);
    });

    it('returns both shapes as changed on first solve', () => {
      const solver = new ConstraintSolver();
      solver.addShape('s1', 'Kolom1', [makeParam('p_w', 'width', 400)]);
      solver.addShape('s2', 'Beam1',  [makeParam('p_o', 'offset', 0, '@Kolom1.width / 2')]);

      const changed = solver.solve();
      expect(changed.has('s1')).toBe(true);
      expect(changed.has('s2')).toBe(true);
    });
  });

  // ── Global parameters ───────────────────────────────────────────────────────

  describe('global parameters', () => {
    it('resolves @global.verdiepingshoogte in a shape formula', () => {
      const solver = new ConstraintSolver();
      solver.addGlobalParameter({ id: 'g1', name: 'verdiepingshoogte', value: 3200, unit: 'mm', type: 'number' });
      solver.addShape('s1', 'Wand', [
        makeParam('p_h', 'hoogte', 0, '@global.verdiepingshoogte - 50'),
      ]);

      solver.solve();

      expect(solver.getValue('p_h')).toBe(3150);
    });
  });

  // ── Incremental solve ───────────────────────────────────────────────────────

  describe('incremental solve', () => {
    it('updates derived values after setParameterValue', () => {
      const solver = new ConstraintSolver();
      solver.addShape('s1', 'HEA300', [
        makeParam('p_h', 'height',     300),
        makeParam('p_f', 'flangeWidth', 0, 'height * 0.5'),
      ]);

      solver.solve();
      expect(solver.getValue('p_f')).toBe(150);

      // Change the base value
      solver.setParameterValue('p_h', 400);
      const changed = solver.solve();

      expect(solver.getValue('p_f')).toBe(200);
      expect(changed.has('s1')).toBe(true);
    });

    it('returns empty set when nothing changed', () => {
      const solver = new ConstraintSolver();
      solver.addShape('s1', 'Box', [makeParam('p_w', 'width', 100)]);
      solver.solve();

      // Solve again without changing anything — nothing is dirty
      const changed = solver.solve();
      expect(changed.size).toBe(0);
    });
  });

  // ── setFormula ──────────────────────────────────────────────────────────────

  describe('setFormula', () => {
    it('adds a formula to a previously free parameter', () => {
      const solver = new ConstraintSolver();
      solver.addShape('s1', 'Profile', [
        makeParam('p_h', 'height',     300),
        makeParam('p_f', 'flangeWidth', 150),
      ]);
      solver.solve();

      // Link flangeWidth to height
      solver.setFormula('p_f', 'height * 0.5');
      solver.solve();

      expect(solver.getValue('p_f')).toBe(150);

      solver.setParameterValue('p_h', 400);
      solver.solve();
      expect(solver.getValue('p_f')).toBe(200);
    });

    it('throws CycleError for a circular formula', () => {
      const solver = new ConstraintSolver();
      solver.addShape('s1', 'Cycle', [
        makeParam('p_a', 'a', 1, 'b + 1'),
        makeParam('p_b', 'b', 2, 'a + 1'),
      ]);

      // At addShape time both formulas reference each other — we test that
      // setFormula also detects a cycle.
      const solver2 = new ConstraintSolver();
      solver2.addShape('s2', 'Test', [
        makeParam('q_a', 'a', 10),
        makeParam('q_b', 'b', 20),
      ]);
      solver2.setFormula('q_a', 'b + 1');

      // Now making b depend on a would create a cycle
      expect(() => solver2.setFormula('q_b', 'a + 1')).toThrow(CycleError);
    });
  });

  // ── removeShape ─────────────────────────────────────────────────────────────

  describe('removeShape', () => {
    it('removes the shape params from the solver', () => {
      const solver = new ConstraintSolver();
      solver.addShape('s1', 'Kolom', [makeParam('p_w', 'width', 300)]);
      solver.solve();

      solver.removeShape('s1');

      expect(solver.getParameter('p_w')).toBeUndefined();
    });

    it('dependent parameters get reference errors after removeShape', () => {
      const solver = new ConstraintSolver();
      solver.addShape('s1', 'Kolom1', [makeParam('p_w', 'width', 400)]);
      solver.addShape('s2', 'Beam1',  [makeParam('p_o', 'offset', 0, '@Kolom1.width / 2')]);
      solver.solve();

      // Remove the dependency source
      solver.removeShape('s1');

      // The graph node for p_o should now have a reference error
      const node = solver.getGraph().getNode('p_o');
      expect(node?.error).toBeDefined();
      expect(node?.error?.type).toBe('reference');
    });

    it('getAllParametersForShape returns empty after removal', () => {
      const solver = new ConstraintSolver();
      solver.addShape('s1', 'Box', [makeParam('p_w', 'width', 100)]);
      solver.removeShape('s1');
      expect(solver.getAllParametersForShape('s1')).toEqual([]);
    });
  });

  // ── Validation (min / max clamping) ─────────────────────────────────────────

  describe('validation', () => {
    it('clamps formula result to max when exceeded', () => {
      const solver = new ConstraintSolver();
      const param: Parameter = {
        id: 'p_w', name: 'width', value: 0,
        formula: '5000',
        unit: 'mm', type: 'number',
        min: 10, max: 1000,
      };
      solver.addShape('s1', 'Box', [param]);
      solver.solve();
      expect(solver.getValue('p_w')).toBe(1000);
    });

    it('clamps formula result to min when below minimum', () => {
      const solver = new ConstraintSolver();
      const param: Parameter = {
        id: 'p_w', name: 'width', value: 0,
        formula: '3',
        unit: 'mm', type: 'number',
        min: 10, max: 1000,
      };
      solver.addShape('s1', 'Box', [param]);
      solver.solve();
      expect(solver.getValue('p_w')).toBe(10);
    });

    it('does not clamp when value is within bounds', () => {
      const solver = new ConstraintSolver();
      const param: Parameter = {
        id: 'p_w', name: 'width', value: 0,
        formula: '500',
        unit: 'mm', type: 'number',
        min: 10, max: 1000,
      };
      solver.addShape('s1', 'Box', [param]);
      solver.solve();
      expect(solver.getValue('p_w')).toBe(500);
    });
  });

  // ── Changed shape tracking ──────────────────────────────────────────────────

  describe('getChangedShapeIds', () => {
    it('returns only shapes whose values actually changed', () => {
      const solver = new ConstraintSolver();
      solver.addShape('s1', 'Column', [makeParam('p_h', 'height', 300)]);
      solver.addShape('s2', 'Beam',   [makeParam('p_w', 'width',  200)]);

      // First solve — both dirty with their initial values (never seen before)
      const first = solver.solve();
      expect(first.has('s1')).toBe(true);
      expect(first.has('s2')).toBe(true);

      // Change only s1
      solver.setParameterValue('p_h', 400);
      const second = solver.solve();
      expect(second.has('s1')).toBe(true);
      expect(second.has('s2')).toBe(false);
    });

    it('does not include a shape when the formula evaluates to the same value', () => {
      const solver = new ConstraintSolver();
      solver.addShape('s1', 'Ref', [makeParam('p_h', 'height', 300)]);
      solver.addShape('s2', 'Derived', [makeParam('p_d', 'derived', 0, 'height * 0')]);

      solver.solve(); // both change on first solve

      // height changes but derived stays 0
      solver.setParameterValue('p_h', 400);
      const changed = solver.solve();
      expect(changed.has('s1')).toBe(true);
      // derived = 400 * 0 = 0, same as before → s2 not in changed
      expect(changed.has('s2')).toBe(false);
    });
  });

  // ── getParameter / getAllParametersForShape ──────────────────────────────────

  describe('accessors', () => {
    it('getParameter returns a copy of the parameter', () => {
      const solver = new ConstraintSolver();
      solver.addShape('s1', 'Box', [makeParam('p_w', 'width', 100)]);
      const p = solver.getParameter('p_w');
      expect(p).toBeDefined();
      expect(p?.value).toBe(100);
    });

    it('getParameter returns undefined for unknown id', () => {
      const solver = new ConstraintSolver();
      expect(solver.getParameter('nonexistent')).toBeUndefined();
    });

    it('getAllParametersForShape returns all params', () => {
      const solver = new ConstraintSolver();
      solver.addShape('s1', 'Box', [
        makeParam('p_w', 'width',  100),
        makeParam('p_h', 'height', 200),
      ]);
      const params = solver.getAllParametersForShape('s1');
      expect(params).toHaveLength(2);
      expect(params.map(p => p.name).sort()).toEqual(['height', 'width']);
    });

    it('getError returns undefined when no error', () => {
      const solver = new ConstraintSolver();
      solver.addShape('s1', 'Box', [makeParam('p_w', 'width', 100)]);
      solver.solve();
      expect(solver.getError('p_w')).toBeUndefined();
    });

    it('getGraph returns the ConstraintGraphEngine', () => {
      const solver = new ConstraintSolver();
      expect(solver.getGraph()).toBeDefined();
    });
  });

  // ── Error reporting ─────────────────────────────────────────────────────────

  describe('error reporting', () => {
    it('reports a syntax error for an invalid formula', () => {
      const solver = new ConstraintSolver();
      solver.addShape('s1', 'Box', [
        makeParam('p_w', 'width', 100, '+++invalid'),
      ]);
      solver.solve();
      const err = solver.getError('p_w');
      expect(err).toBeDefined();
    });
  });
});
