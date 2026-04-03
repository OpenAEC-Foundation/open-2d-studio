import { describe, it, expect } from 'vitest';
import { flattenGeometry } from '../ComponentFlattener';
import type {
  ComponentRepresentation,
  ComponentGeometryElement,
} from '../../../types/component';
import type { ShapeStyle } from '../../../types/geometry';

// ── Helpers ──────────────────────────────────────────────────

const defaultStyle: ShapeStyle = {
  color: '#000000',
  lineWeight: 1,
  lineStyle: 'solid',
  opacity: 1,
};

const noTransform = { position: { x: 0, y: 0 }, rotation: 0, scale: 1 };

function makeRep(elements: ComponentGeometryElement[]): ComponentRepresentation {
  return {
    id: 'rep-1',
    context: 'plan',
    geometry: elements,
    isDefault: true,
  };
}

function makeParams(entries: Record<string, number | boolean | string>) {
  return new Map<string, number | boolean | string>(Object.entries(entries));
}

// ── Line tests ───────────────────────────────────────────────

describe('flattenGeometry – line', () => {
  it('produces a LineShape with correct start/end from paramValues', () => {
    const element: ComponentGeometryElement = {
      id: 'e1',
      type: 'parametric-line',
      geometry: {
        type: 'parametric-line',
        startXParamId: 'sx',
        startYParamId: 'sy',
        endXParamId: 'ex',
        endYParamId: 'ey',
      },
      style: defaultStyle,
    };

    const params = makeParams({ sx: 0, sy: 0, ex: 10, ey: 5 });
    const result = flattenGeometry(makeRep([element]), params, { x: 0, y: 0 }, 0, 1);

    expect(result.shapes).toHaveLength(1);
    const shape = result.shapes[0] as { type: string; start: { x: number; y: number }; end: { x: number; y: number } };
    expect(shape.type).toBe('line');
    expect(shape.start.x).toBeCloseTo(0);
    expect(shape.start.y).toBeCloseTo(0);
    expect(shape.end.x).toBeCloseTo(10);
    expect(shape.end.y).toBeCloseTo(5);
  });
});

// ── Circle tests ─────────────────────────────────────────────

describe('flattenGeometry – circle', () => {
  it('produces a CircleShape with correct center/radius from paramValues', () => {
    const element: ComponentGeometryElement = {
      id: 'e2',
      type: 'parametric-circle',
      geometry: {
        type: 'parametric-circle',
        centerXParamId: 'cx',
        centerYParamId: 'cy',
        radiusParamId: 'r',
      },
      style: defaultStyle,
    };

    const params = makeParams({ cx: 5, cy: 3, r: 7 });
    const result = flattenGeometry(makeRep([element]), params, { x: 0, y: 0 }, 0, 1);

    expect(result.shapes).toHaveLength(1);
    const shape = result.shapes[0] as { type: string; center: { x: number; y: number }; radius: number };
    expect(shape.type).toBe('circle');
    expect(shape.center.x).toBeCloseTo(5);
    expect(shape.center.y).toBeCloseTo(3);
    expect(shape.radius).toBeCloseTo(7);
  });
});

// ── Rectangle tests ──────────────────────────────────────────

describe('flattenGeometry – rectangle', () => {
  it('produces a RectangleShape with correct topLeft/width/height', () => {
    const element: ComponentGeometryElement = {
      id: 'e3',
      type: 'parametric-rectangle',
      geometry: {
        type: 'parametric-rectangle',
        x1ParamId: 'x1',
        y1ParamId: 'y1',
        widthParamId: 'w',
        heightParamId: 'h',
      },
      style: defaultStyle,
    };

    const params = makeParams({ x1: 2, y1: 4, w: 20, h: 10 });
    const result = flattenGeometry(makeRep([element]), params, { x: 0, y: 0 }, 0, 1);

    expect(result.shapes).toHaveLength(1);
    const shape = result.shapes[0] as { type: string; topLeft: { x: number; y: number }; width: number; height: number };
    expect(shape.type).toBe('rectangle');
    expect(shape.topLeft.x).toBeCloseTo(2);
    expect(shape.topLeft.y).toBeCloseTo(4);
    expect(shape.width).toBeCloseTo(20);
    expect(shape.height).toBeCloseTo(10);
  });
});

// ── Visibility tests ─────────────────────────────────────────

describe('flattenGeometry – visibility', () => {
  it('skips an element when visibleParamId resolves to false', () => {
    const element: ComponentGeometryElement = {
      id: 'e4',
      type: 'parametric-line',
      geometry: {
        type: 'parametric-line',
        startXParamId: 'sx',
        startYParamId: 'sy',
        endXParamId: 'ex',
        endYParamId: 'ey',
      },
      style: defaultStyle,
      visibleParamId: 'showLine',
    };

    const params = makeParams({ sx: 0, sy: 0, ex: 10, ey: 0, showLine: false });
    const result = flattenGeometry(makeRep([element]), params, { x: 0, y: 0 }, 0, 1);

    expect(result.shapes).toHaveLength(0);
  });

  it('includes an element when visibleParamId resolves to true', () => {
    const element: ComponentGeometryElement = {
      id: 'e5',
      type: 'parametric-line',
      geometry: {
        type: 'parametric-line',
        startXParamId: 'sx',
        startYParamId: 'sy',
        endXParamId: 'ex',
        endYParamId: 'ey',
      },
      style: defaultStyle,
      visibleParamId: 'showLine',
    };

    const params = makeParams({ sx: 0, sy: 0, ex: 10, ey: 0, showLine: true });
    const result = flattenGeometry(makeRep([element]), params, { x: 0, y: 0 }, 0, 1);

    expect(result.shapes).toHaveLength(1);
  });
});

// ── Text interpolation tests ─────────────────────────────────

describe('flattenGeometry – text interpolation', () => {
  it('interpolates template text using paramNames map', () => {
    const element: ComponentGeometryElement = {
      id: 'e6',
      type: 'parametric-text',
      geometry: {
        type: 'parametric-text',
        contentParamId: 'label',
        xParamId: 'tx',
        yParamId: 'ty',
        heightParamId: 'fs',
      },
      style: defaultStyle,
    };

    const params = makeParams({ label: 'Ø{diameter}', tx: 0, ty: 0, fs: 10 });
    const paramNames = makeParams({ diameter: 12 });
    const result = flattenGeometry(makeRep([element]), params, { x: 0, y: 0 }, 0, 1, paramNames);

    expect(result.shapes).toHaveLength(1);
    const shape = result.shapes[0] as { type: string; text: string };
    expect(shape.type).toBe('text');
    expect(shape.text).toBe('Ø12');
  });

  it('leaves unresolved placeholders unchanged when key is not in paramNames', () => {
    const element: ComponentGeometryElement = {
      id: 'e7',
      type: 'parametric-text',
      geometry: {
        type: 'parametric-text',
        contentParamId: 'label',
        xParamId: 'tx',
        yParamId: 'ty',
        heightParamId: 'fs',
      },
      style: defaultStyle,
    };

    const params = makeParams({ label: 'W{width}', tx: 0, ty: 0, fs: 10 });
    const paramNames = makeParams({});
    const result = flattenGeometry(makeRep([element]), params, { x: 0, y: 0 }, 0, 1, paramNames);

    const shape = result.shapes[0] as { text: string };
    expect(shape.text).toBe('W{width}');
  });
});

// ── Transform tests ──────────────────────────────────────────

describe('flattenGeometry – transform', () => {
  it('applies position offset to generated shapes', () => {
    const element: ComponentGeometryElement = {
      id: 'e8',
      type: 'parametric-line',
      geometry: {
        type: 'parametric-line',
        startXParamId: 'sx',
        startYParamId: 'sy',
        endXParamId: 'ex',
        endYParamId: 'ey',
      },
      style: defaultStyle,
    };

    const params = makeParams({ sx: 0, sy: 0, ex: 5, ey: 5 });
    const result = flattenGeometry(makeRep([element]), params, { x: 10, y: 20 }, 0, 1);

    const shape = result.shapes[0] as { start: { x: number; y: number }; end: { x: number; y: number } };
    expect(shape.start.x).toBeCloseTo(10);
    expect(shape.start.y).toBeCloseTo(20);
    expect(shape.end.x).toBeCloseTo(15);
    expect(shape.end.y).toBeCloseTo(25);
  });

  it('applies scale to shape dimensions', () => {
    const element: ComponentGeometryElement = {
      id: 'e9',
      type: 'parametric-circle',
      geometry: {
        type: 'parametric-circle',
        centerXParamId: 'cx',
        centerYParamId: 'cy',
        radiusParamId: 'r',
      },
      style: defaultStyle,
    };

    const params = makeParams({ cx: 0, cy: 0, r: 5 });
    const result = flattenGeometry(makeRep([element]), params, { x: 0, y: 0 }, 0, 2);

    const shape = result.shapes[0] as { radius: number };
    expect(shape.radius).toBeCloseTo(10); // 5 * scale(2)
  });

  it('applies rotation to point positions', () => {
    const element: ComponentGeometryElement = {
      id: 'e10',
      type: 'parametric-line',
      geometry: {
        type: 'parametric-line',
        startXParamId: 'sx',
        startYParamId: 'sy',
        endXParamId: 'ex',
        endYParamId: 'ey',
      },
      style: defaultStyle,
    };

    // A line from (1,0) to (1,0) — after 90° rotation it should go to (0,1)
    const params = makeParams({ sx: 1, sy: 0, ex: 0, ey: 1 });
    const result = flattenGeometry(makeRep([element]), params, { x: 0, y: 0 }, Math.PI / 2, 1);

    const shape = result.shapes[0] as { start: { x: number; y: number }; end: { x: number; y: number } };
    // (1,0) rotated 90° CCW → (0,1)
    expect(shape.start.x).toBeCloseTo(0, 5);
    expect(shape.start.y).toBeCloseTo(1, 5);
    // (0,1) rotated 90° CCW → (-1,0)
    expect(shape.end.x).toBeCloseTo(-1, 5);
    expect(shape.end.y).toBeCloseTo(0, 5);
  });
});

// ── Bounding box tests ───────────────────────────────────────

describe('flattenGeometry – bounding box', () => {
  it('computes a correct bounding box from a single line', () => {
    const element: ComponentGeometryElement = {
      id: 'e11',
      type: 'parametric-line',
      geometry: {
        type: 'parametric-line',
        startXParamId: 'sx',
        startYParamId: 'sy',
        endXParamId: 'ex',
        endYParamId: 'ey',
      },
      style: defaultStyle,
    };

    const params = makeParams({ sx: -5, sy: -3, ex: 7, ey: 9 });
    const result = flattenGeometry(makeRep([element]), params, { x: 0, y: 0 }, 0, 1);

    expect(result.bounds.minX).toBeCloseTo(-5);
    expect(result.bounds.minY).toBeCloseTo(-3);
    expect(result.bounds.maxX).toBeCloseTo(7);
    expect(result.bounds.maxY).toBeCloseTo(9);
  });

  it('merges bounds across multiple shapes', () => {
    const line: ComponentGeometryElement = {
      id: 'e12',
      type: 'parametric-line',
      geometry: {
        type: 'parametric-line',
        startXParamId: 'sx',
        startYParamId: 'sy',
        endXParamId: 'ex',
        endYParamId: 'ey',
      },
      style: defaultStyle,
    };

    const circle: ComponentGeometryElement = {
      id: 'e13',
      type: 'parametric-circle',
      geometry: {
        type: 'parametric-circle',
        centerXParamId: 'cx',
        centerYParamId: 'cy',
        radiusParamId: 'r',
      },
      style: defaultStyle,
    };

    const params = makeParams({ sx: 0, sy: 0, ex: 10, ey: 0, cx: 5, cy: 5, r: 3 });
    const result = flattenGeometry(makeRep([line, circle]), params, { x: 0, y: 0 }, 0, 1);

    expect(result.shapes).toHaveLength(2);
    expect(result.bounds.minX).toBeCloseTo(0);   // min from line start x=0
    expect(result.bounds.minY).toBeCloseTo(0);   // line y=0 is lower than circle bottom 5-3=2
    expect(result.bounds.maxX).toBeCloseTo(10);  // max from line end x=10; circle right 5+3=8 < 10
    expect(result.bounds.maxY).toBeCloseTo(8);   // circle top: 5 + 3
  });

  it('returns zero-sized bounds when there are no shapes', () => {
    const result = flattenGeometry(makeRep([]), makeParams({}), { x: 0, y: 0 }, 0, 1);

    expect(result.shapes).toHaveLength(0);
    expect(result.bounds.minX).toBe(0);
    expect(result.bounds.minY).toBe(0);
    expect(result.bounds.maxX).toBe(0);
    expect(result.bounds.maxY).toBe(0);
  });

  it('returns zero-sized bounds when all elements are skipped by visibility', () => {
    const element: ComponentGeometryElement = {
      id: 'e14',
      type: 'parametric-line',
      geometry: {
        type: 'parametric-line',
        startXParamId: 'sx',
        startYParamId: 'sy',
        endXParamId: 'ex',
        endYParamId: 'ey',
      },
      style: defaultStyle,
      visibleParamId: 'show',
    };

    const params = makeParams({ sx: 0, sy: 0, ex: 10, ey: 0, show: false });
    const result = flattenGeometry(makeRep([element]), params, { x: 0, y: 0 }, 0, 1);

    expect(result.shapes).toHaveLength(0);
    expect(result.bounds.minX).toBe(0);
    expect(result.bounds.maxX).toBe(0);
  });
});
