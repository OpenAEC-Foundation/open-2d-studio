import { describe, it, expect } from 'vitest';
import { QuadTree } from './QuadTree';
import type { Shape } from '../../types/geometry';

function makeLineShape(id: string, x1: number, y1: number, x2: number, y2: number): Shape {
  return {
    id,
    type: 'line',
    layerId: 'layer1',
    drawingId: 'drawing1',
    style: { strokeColor: '#fff', strokeWidth: 1, lineStyle: 'solid' },
    visible: true,
    locked: false,
    start: { x: x1, y: y1 },
    end: { x: x2, y: y2 },
  } as Shape;
}

describe('QuadTree', () => {
  it('insert and query returns correct shapes', () => {
    const tree = new QuadTree({ x: 500, y: 500, halfW: 500, halfH: 500 });
    tree.insert({ id: 'a', bounds: { minX: 10, minY: 10, maxX: 50, maxY: 50 } });
    tree.insert({ id: 'b', bounds: { minX: 200, minY: 200, maxX: 300, maxY: 300 } });

    const results = tree.queryPoint({ x: 30, y: 30 }, 0);
    expect(results.map(r => r.id)).toContain('a');
    expect(results.map(r => r.id)).not.toContain('b');
  });

  it('point far from shapes returns empty', () => {
    const tree = new QuadTree({ x: 500, y: 500, halfW: 500, halfH: 500 });
    tree.insert({ id: 'a', bounds: { minX: 10, minY: 10, maxX: 50, maxY: 50 } });

    const results = tree.queryPoint({ x: 900, y: 900 }, 0);
    expect(results).toHaveLength(0);
  });

  it('handles overlapping shapes', () => {
    const tree = new QuadTree({ x: 500, y: 500, halfW: 500, halfH: 500 });
    tree.insert({ id: 'a', bounds: { minX: 0, minY: 0, maxX: 100, maxY: 100 } });
    tree.insert({ id: 'b', bounds: { minX: 50, minY: 50, maxX: 150, maxY: 150 } });

    const results = tree.queryPoint({ x: 75, y: 75 }, 0);
    const ids = results.map(r => r.id);
    expect(ids).toContain('a');
    expect(ids).toContain('b');
  });

  it('buildFromShapes indexes all visible shapes', () => {
    const shapes: Shape[] = [
      makeLineShape('s1', 0, 0, 100, 100),
      makeLineShape('s2', 200, 200, 300, 300),
      { ...makeLineShape('s3', 400, 400, 500, 500), visible: false } as Shape,
      { ...makeLineShape('s4', 50, 50, 150, 150), drawingId: 'other' } as Shape,
    ];

    const tree = QuadTree.buildFromShapes(shapes, 'drawing1');
    const allResults = tree.query({ minX: -1000, minY: -1000, maxX: 1000, maxY: 1000 });
    const ids = allResults.map(r => r.id);
    expect(ids).toContain('s1');
    expect(ids).toContain('s2');
    expect(ids).not.toContain('s3'); // invisible
    expect(ids).not.toContain('s4'); // wrong drawing
  });

  it('1000-shape query completes in < 1ms', () => {
    const shapes: Shape[] = [];
    for (let i = 0; i < 1000; i++) {
      const x = Math.random() * 10000;
      const y = Math.random() * 10000;
      shapes.push(makeLineShape(`s${i}`, x, y, x + 50, y + 50));
    }

    const tree = QuadTree.buildFromShapes(shapes, 'drawing1');

    const start = performance.now();
    for (let i = 0; i < 100; i++) {
      tree.queryPoint({ x: Math.random() * 10000, y: Math.random() * 10000 }, 5);
    }
    const elapsed = (performance.now() - start) / 100;
    expect(elapsed).toBeLessThan(1);
  });
});
