import { describe, it, expect } from 'vitest';
import { ConstraintGraphEngine, CycleError } from '../ConstraintGraph';

describe('ConstraintGraphEngine', () => {

  // ── addNode ──────────────────────────────────────────────────────────────

  describe('addNode', () => {
    it('adds a node that is retrievable via getNode', () => {
      const engine = new ConstraintGraphEngine();
      engine.addNode('shapeA.width', 'shapeA', [], undefined);
      const node = engine.getNode('shapeA.width');
      expect(node).toBeDefined();
      expect(node?.parameterId).toBe('shapeA.width');
      expect(node?.ownerId).toBe('shapeA');
      expect(node?.dependencies).toEqual([]);
      expect(node?.formula).toBeUndefined();
      expect(node?.isDirty).toBe(false);
    });

    it('adds a node with formula and dependencies', () => {
      const engine = new ConstraintGraphEngine();
      engine.addNode('shapeA.width', 'shapeA', [], undefined);
      engine.addNode('shapeB.width', 'shapeB', ['shapeA.width'], 'shapeA.width * 2');
      const node = engine.getNode('shapeB.width');
      expect(node?.formula).toBe('shapeA.width * 2');
      expect(node?.dependencies).toEqual(['shapeA.width']);
    });

    it('returns undefined for unknown node', () => {
      const engine = new ConstraintGraphEngine();
      expect(engine.getNode('nonexistent')).toBeUndefined();
    });
  });

  // ── removeNode ───────────────────────────────────────────────────────────

  describe('removeNode', () => {
    it('removes a node so getNode returns undefined', () => {
      const engine = new ConstraintGraphEngine();
      engine.addNode('a', 'owner1', [], undefined);
      engine.removeNode('a');
      expect(engine.getNode('a')).toBeUndefined();
    });

    it('marks dependent nodes with a reference error when a dependency is removed', () => {
      const engine = new ConstraintGraphEngine();
      engine.addNode('a', 'owner1', [], undefined);
      engine.addNode('b', 'owner2', ['a'], 'a + 1');
      engine.removeNode('a');
      const nodeB = engine.getNode('b');
      expect(nodeB?.error).toBeDefined();
      expect(nodeB?.error?.type).toBe('reference');
    });

    it('does nothing when removing a non-existent node', () => {
      const engine = new ConstraintGraphEngine();
      expect(() => engine.removeNode('nonexistent')).not.toThrow();
    });
  });

  // ── setFormula ───────────────────────────────────────────────────────────

  describe('setFormula', () => {
    it('sets formula and updates dependencies', () => {
      const engine = new ConstraintGraphEngine();
      engine.addNode('a', 'owner1', [], undefined);
      engine.addNode('b', 'owner2', [], undefined);
      engine.setFormula('b', 'a * 2', ['a']);
      const nodeB = engine.getNode('b');
      expect(nodeB?.formula).toBe('a * 2');
      expect(nodeB?.dependencies).toEqual(['a']);
    });

    it('clears formula when undefined is passed', () => {
      const engine = new ConstraintGraphEngine();
      engine.addNode('a', 'owner1', [], undefined);
      engine.addNode('b', 'owner2', ['a'], 'a + 1');
      engine.setFormula('b', undefined, []);
      const nodeB = engine.getNode('b');
      expect(nodeB?.formula).toBeUndefined();
      expect(nodeB?.dependencies).toEqual([]);
    });

    it('replaces existing dependencies', () => {
      const engine = new ConstraintGraphEngine();
      engine.addNode('a', 'owner1', [], undefined);
      engine.addNode('c', 'owner3', [], undefined);
      engine.addNode('b', 'owner2', ['a'], 'a + 1');
      engine.setFormula('b', 'c * 3', ['c']);
      const nodeB = engine.getNode('b');
      expect(nodeB?.dependencies).toEqual(['c']);
    });
  });

  // ── Cycle detection ──────────────────────────────────────────────────────

  describe('cycle detection', () => {
    it('throws CycleError on a direct cycle (A→B→A)', () => {
      const engine = new ConstraintGraphEngine();
      engine.addNode('a', 'owner1', [], undefined);
      engine.addNode('b', 'owner2', ['a'], 'a + 1');
      expect(() => engine.setFormula('a', 'b + 1', ['b'])).toThrow(CycleError);
    });

    it('throws CycleError on an indirect cycle (A→B→C→A)', () => {
      const engine = new ConstraintGraphEngine();
      engine.addNode('a', 'owner1', [], undefined);
      engine.addNode('b', 'owner2', ['a'], 'a + 1');
      engine.addNode('c', 'owner3', ['b'], 'b + 1');
      expect(() => engine.setFormula('a', 'c + 1', ['c'])).toThrow(CycleError);
    });

    it('CycleError.cyclePath contains the nodes involved', () => {
      const engine = new ConstraintGraphEngine();
      engine.addNode('a', 'owner1', [], undefined);
      engine.addNode('b', 'owner2', ['a'], 'a + 1');
      let caughtError: CycleError | undefined;
      try {
        engine.setFormula('a', 'b + 1', ['b']);
      } catch (e) {
        if (e instanceof CycleError) caughtError = e;
      }
      expect(caughtError).toBeDefined();
      expect(caughtError?.cyclePath).toContain('a');
      expect(caughtError?.cyclePath).toContain('b');
    });

    it('also detects cycle on addNode', () => {
      const engine = new ConstraintGraphEngine();
      engine.addNode('a', 'owner1', [], undefined);
      engine.addNode('b', 'owner2', ['a'], 'a + 1');
      // Adding c that depends on b is fine; then updating a to depend on c creates cycle
      engine.addNode('c', 'owner3', ['b'], 'b + 1');
      expect(() => engine.addNode('a2', 'owner1', ['c'], 'c + 1')).not.toThrow();
    });

    it('valid chain does NOT throw', () => {
      const engine = new ConstraintGraphEngine();
      engine.addNode('a', 'owner1', [], undefined);
      engine.addNode('b', 'owner2', ['a'], 'a + 1');
      expect(() => engine.addNode('c', 'owner3', ['b'], 'b + 1')).not.toThrow();
    });
  });

  // ── Topological sort ─────────────────────────────────────────────────────

  describe('getSolveOrder', () => {
    it('returns nodes in dependency order (a before b before c)', () => {
      const engine = new ConstraintGraphEngine();
      engine.addNode('a', 'owner1', [], undefined);
      engine.addNode('b', 'owner2', ['a'], 'a + 1');
      engine.addNode('c', 'owner3', ['b'], 'b + 1');
      const order = engine.getSolveOrder();
      expect(order.indexOf('a')).toBeLessThan(order.indexOf('b'));
      expect(order.indexOf('b')).toBeLessThan(order.indexOf('c'));
    });

    it('handles a diamond dependency (a→b, a→c, b→d, c→d)', () => {
      const engine = new ConstraintGraphEngine();
      engine.addNode('a', 'owner1', [], undefined);
      engine.addNode('b', 'owner2', ['a'], 'a');
      engine.addNode('c', 'owner3', ['a'], 'a');
      engine.addNode('d', 'owner4', ['b', 'c'], 'b + c');
      const order = engine.getSolveOrder();
      expect(order.indexOf('a')).toBeLessThan(order.indexOf('b'));
      expect(order.indexOf('a')).toBeLessThan(order.indexOf('c'));
      expect(order.indexOf('b')).toBeLessThan(order.indexOf('d'));
      expect(order.indexOf('c')).toBeLessThan(order.indexOf('d'));
    });

    it('caches the result (returns same array reference when unchanged)', () => {
      const engine = new ConstraintGraphEngine();
      engine.addNode('a', 'owner1', [], undefined);
      engine.addNode('b', 'owner2', ['a'], 'a + 1');
      const first = engine.getSolveOrder();
      const second = engine.getSolveOrder();
      expect(first).toBe(second);
    });

    it('invalidates cache on addNode', () => {
      const engine = new ConstraintGraphEngine();
      engine.addNode('a', 'owner1', [], undefined);
      const first = engine.getSolveOrder();
      engine.addNode('b', 'owner2', [], undefined);
      const second = engine.getSolveOrder();
      expect(first).not.toBe(second);
      expect(second).toContain('b');
    });

    it('invalidates cache on removeNode', () => {
      const engine = new ConstraintGraphEngine();
      engine.addNode('a', 'owner1', [], undefined);
      engine.addNode('b', 'owner2', [], undefined);
      const first = engine.getSolveOrder();
      engine.removeNode('b');
      const second = engine.getSolveOrder();
      expect(first).not.toBe(second);
      expect(second).not.toContain('b');
    });

    it('invalidates cache on setFormula', () => {
      const engine = new ConstraintGraphEngine();
      engine.addNode('a', 'owner1', [], undefined);
      engine.addNode('b', 'owner2', [], undefined);
      const first = engine.getSolveOrder();
      engine.setFormula('b', 'a + 1', ['a']);
      const second = engine.getSolveOrder();
      expect(first).not.toBe(second);
    });
  });

  // ── Dirty propagation ────────────────────────────────────────────────────

  describe('markDirty', () => {
    it('marks the node itself dirty', () => {
      const engine = new ConstraintGraphEngine();
      engine.addNode('a', 'owner1', [], undefined);
      engine.markDirty('a');
      expect(engine.getNode('a')?.isDirty).toBe(true);
    });

    it('propagates dirty flag to downstream nodes', () => {
      const engine = new ConstraintGraphEngine();
      engine.addNode('a', 'owner1', [], undefined);
      engine.addNode('b', 'owner2', ['a'], 'a + 1');
      engine.addNode('c', 'owner3', ['b'], 'b + 1');
      engine.markDirty('a');
      expect(engine.getNode('b')?.isDirty).toBe(true);
      expect(engine.getNode('c')?.isDirty).toBe(true);
    });

    it('unrelated nodes stay clean', () => {
      const engine = new ConstraintGraphEngine();
      engine.addNode('a', 'owner1', [], undefined);
      engine.addNode('b', 'owner2', ['a'], 'a + 1');
      engine.addNode('x', 'owner3', [], undefined);
      engine.markDirty('a');
      expect(engine.getNode('x')?.isDirty).toBe(false);
    });

    it('does not cause infinite loops on wide fan-out', () => {
      const engine = new ConstraintGraphEngine();
      engine.addNode('root', 'owner1', [], undefined);
      for (let i = 0; i < 100; i++) {
        engine.addNode(`node${i}`, `owner${i}`, ['root'], `root + ${i}`);
      }
      expect(() => engine.markDirty('root')).not.toThrow();
      for (let i = 0; i < 100; i++) {
        expect(engine.getNode(`node${i}`)?.isDirty).toBe(true);
      }
    });
  });

  describe('clearAllDirty', () => {
    it('resets all dirty flags', () => {
      const engine = new ConstraintGraphEngine();
      engine.addNode('a', 'owner1', [], undefined);
      engine.addNode('b', 'owner2', ['a'], 'a + 1');
      engine.markDirty('a');
      engine.clearAllDirty();
      expect(engine.getNode('a')?.isDirty).toBe(false);
      expect(engine.getNode('b')?.isDirty).toBe(false);
    });
  });

  describe('getDirtySolveOrder', () => {
    it('returns only dirty nodes in topological order', () => {
      const engine = new ConstraintGraphEngine();
      engine.addNode('a', 'owner1', [], undefined);
      engine.addNode('b', 'owner2', ['a'], 'a + 1');
      engine.addNode('c', 'owner3', ['b'], 'b + 1');
      engine.addNode('x', 'owner4', [], undefined); // unrelated, stays clean
      engine.markDirty('a');
      const dirty = engine.getDirtySolveOrder();
      expect(dirty).toContain('a');
      expect(dirty).toContain('b');
      expect(dirty).toContain('c');
      expect(dirty).not.toContain('x');
      expect(dirty.indexOf('a')).toBeLessThan(dirty.indexOf('b'));
      expect(dirty.indexOf('b')).toBeLessThan(dirty.indexOf('c'));
    });

    it('returns empty array when nothing is dirty', () => {
      const engine = new ConstraintGraphEngine();
      engine.addNode('a', 'owner1', [], undefined);
      expect(engine.getDirtySolveOrder()).toEqual([]);
    });
  });

  // ── getNodesByOwner ──────────────────────────────────────────────────────

  describe('getNodesByOwner', () => {
    it('returns all nodes for a given shape ID', () => {
      const engine = new ConstraintGraphEngine();
      engine.addNode('shapeA.width', 'shapeA', [], undefined);
      engine.addNode('shapeA.height', 'shapeA', [], undefined);
      engine.addNode('shapeB.width', 'shapeB', [], undefined);
      const nodes = engine.getNodesByOwner('shapeA');
      expect(nodes).toHaveLength(2);
      const ids = nodes.map(n => n.parameterId);
      expect(ids).toContain('shapeA.width');
      expect(ids).toContain('shapeA.height');
    });

    it('returns empty array for unknown owner', () => {
      const engine = new ConstraintGraphEngine();
      expect(engine.getNodesByOwner('unknown')).toEqual([]);
    });
  });

  // ── removeNodesByOwner ───────────────────────────────────────────────────

  describe('removeNodesByOwner', () => {
    it('removes all nodes for a shape', () => {
      const engine = new ConstraintGraphEngine();
      engine.addNode('shapeA.width', 'shapeA', [], undefined);
      engine.addNode('shapeA.height', 'shapeA', [], undefined);
      engine.addNode('shapeB.width', 'shapeB', [], undefined);
      engine.removeNodesByOwner('shapeA');
      expect(engine.getNode('shapeA.width')).toBeUndefined();
      expect(engine.getNode('shapeA.height')).toBeUndefined();
      expect(engine.getNode('shapeB.width')).toBeDefined();
    });

    it('marks dependent nodes with reference errors', () => {
      const engine = new ConstraintGraphEngine();
      engine.addNode('shapeA.width', 'shapeA', [], undefined);
      engine.addNode('shapeB.total', 'shapeB', ['shapeA.width'], 'shapeA.width * 2');
      engine.removeNodesByOwner('shapeA');
      expect(engine.getNode('shapeB.total')?.error?.type).toBe('reference');
    });

    it('does nothing for unknown owner', () => {
      const engine = new ConstraintGraphEngine();
      engine.addNode('a', 'owner1', [], undefined);
      expect(() => engine.removeNodesByOwner('unknown')).not.toThrow();
      expect(engine.getNode('a')).toBeDefined();
    });
  });

  // ── serialize / deserialize ──────────────────────────────────────────────

  describe('serialize / deserialize', () => {
    it('serializes to a plain record of nodes', () => {
      const engine = new ConstraintGraphEngine();
      engine.addNode('a', 'owner1', [], undefined);
      engine.addNode('b', 'owner2', ['a'], 'a + 1');
      const data = engine.serialize();
      expect(data['a']).toBeDefined();
      expect(data['b']).toBeDefined();
      expect(data['b'].formula).toBe('a + 1');
    });

    it('round-trips through serialize/deserialize', () => {
      const engine = new ConstraintGraphEngine();
      engine.addNode('a', 'owner1', [], undefined);
      engine.addNode('b', 'owner2', ['a'], 'a + 1');
      const data = engine.serialize();
      const engine2 = ConstraintGraphEngine.deserialize(data);
      expect(engine2.getNode('a')).toBeDefined();
      expect(engine2.getNode('b')?.formula).toBe('a + 1');
      const order = engine2.getSolveOrder();
      expect(order.indexOf('a')).toBeLessThan(order.indexOf('b'));
    });
  });
});
