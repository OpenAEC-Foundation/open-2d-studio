# Parametric Component System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a universal parametric component system as an AEC Extension — components with parameters, constraint formulas, arrays, nesting, multiple representations, IFC profile mapping, inline editor, and library panel.

**Architecture:** ComponentDefinitions are parametric templates containing geometry elements linked to parameters via the constraint engine. ComponentInstances are placed on the canvas and maintain a flattened geometry cache for rendering performance. Nesting and arrays are resolved recursively with cycle detection. The system is built entirely within the AEC Extension, registering through the existing registry pattern (bounds, renderers, snaps, grips, etc.).

**Tech Stack:** TypeScript, React, Zustand, Canvas 2D, Vitest, ConstraintSolver (from constraint engine)

**Spec:** `docs/superpowers/specs/2026-04-03-parametric-component-system-design.md`
**AEC Extension:** `C:\Users\rickd\Documents\GitHub\open-2D-studio-AEC-extension\src\`
**Constraint Engine:** `src/engine/constraints/` (already implemented)

---

## File Map

### New Files — Main App (`src/`)

| File | Responsibility |
|---|---|
| `src/types/component.ts` | All component type definitions (ComponentDefinition, ComponentInstance, arrays, nesting, IFC mapping, representations, parametric geometry) |
| `src/engine/component/ComponentFlattener.ts` | Evaluate parameters → generate flattened Shape[] from parametric geometry defs |
| `src/engine/component/ComponentArrayResolver.ts` | Resolve linear/radial arrays into positioned element copies |
| `src/engine/component/ComponentNestingResolver.ts` | Recursive nesting resolution with cycle detection |
| `src/engine/component/IFCProfileMapper.ts` | Map IFC profile types to ComponentDefinition parameter schemas |
| `src/engine/component/__tests__/ComponentFlattener.test.ts` | Flattener tests |
| `src/engine/component/__tests__/ComponentArrayResolver.test.ts` | Array resolver tests |
| `src/engine/component/__tests__/ComponentNestingResolver.test.ts` | Nesting resolver tests |
| `src/state/slices/componentSlice.ts` | Zustand state: definitions, editor mode, library |
| `src/components/panels/ComponentLibraryPanel.tsx` | Library sub-tab in Properties panel |
| `src/components/panels/ComponentEditorOverlay.tsx` | Editor mode overlay (dimming, toolbar, close button) |

### New Files — AEC Extension

| File | Responsibility |
|---|---|
| `(AEC ext) src/componentRegistrations.ts` | Register component-instance shape type in all registries |
| `(AEC ext) src/builtInProfiles.ts` | 14 IFC profile ComponentDefinitions with presets |

### Modified Files

| File | Change |
|---|---|
| `src/types/geometry.ts` | Add `'component-instance'` to ShapeType union |
| `(AEC ext) src/index.tsx` | Import and call registerComponentSystem/unregisterComponentSystem |
| `(AEC ext) src/ribbonTabs.tsx` | Add "Components" ribbon group with New/Library buttons |

---

## Task 1: Component Type Definitions

**Files:**
- Create: `src/types/component.ts`
- Modify: `src/types/geometry.ts`

- [ ] **Step 1: Add 'component-instance' to ShapeType**

In `src/types/geometry.ts`, find the `ShapeType` union type and add `'component-instance'` at the end:

```typescript
// Find this line (currently ends with 'rebar'):
export type ShapeType = 'line' | 'rectangle' | ... | 'rebar';

// Change to:
export type ShapeType = 'line' | 'rectangle' | ... | 'rebar' | 'component-instance';
```

- [ ] **Step 2: Create component type definitions**

```typescript
// src/types/component.ts
import type { Point, ShapeStyle, BaseShape, BoundingBox, Shape } from './geometry';
import type { Parameter, ShapeConstraintGraph } from './constraints';

// ── Categories ─────────────────────────────────────────────

export type ComponentCategory =
  | 'structural-steel'
  | 'structural-concrete'
  | 'structural-timber'
  | 'reinforcement'
  | 'foundation'
  | 'architectural'
  | 'MEP'
  | 'detail'
  | 'annotation'
  | 'custom';

export type RepresentationContext =
  | 'plan'
  | 'section'
  | 'elevation'
  | 'detail'
  | '3d';

// ── Parametric Geometry Definitions ────────────────────────

export interface ParametricLineDef {
  kind: 'line';
  startX: string; startY: string;
  endX: string; endY: string;
}

export interface ParametricPolylineDef {
  kind: 'polyline';
  vertices: Array<{ xParamId: string; yParamId: string }>;
  closed: boolean;
}

export interface ParametricArcDef {
  kind: 'arc';
  centerX: string; centerY: string;
  radius: string;
  startAngle: string; endAngle: string;
}

export interface ParametricCircleDef {
  kind: 'circle';
  centerX: string; centerY: string;
  radius: string;
}

export interface ParametricRectangleDef {
  kind: 'rectangle';
  x: string; y: string;
  width: string; height: string;
  rotation?: string;
}

export interface ParametricHatchDef {
  kind: 'hatch';
  boundaryElementIds: string[];
  pattern: string;
  scale?: string;
  angle?: string;
}

export interface ParametricTextDef {
  kind: 'text';
  x: string; y: string;
  template: string;
  height?: string;
  rotation?: string;
}

export interface ParametricDimensionDef {
  kind: 'dimension';
  startElementId: string;
  endElementId: string;
  paramId: string;
  offset: number;
  style: 'linear' | 'angular' | 'radial';
}

export type ParametricGeometryDef =
  | ParametricLineDef
  | ParametricPolylineDef
  | ParametricArcDef
  | ParametricCircleDef
  | ParametricRectangleDef
  | ParametricHatchDef
  | ParametricTextDef
  | ParametricDimensionDef;

// ── Geometry Elements & Representations ────────────────────

export interface ComponentGeometryElement {
  id: string;
  type: 'line' | 'polyline' | 'arc' | 'circle' | 'rectangle'
      | 'ellipse' | 'hatch' | 'text' | 'dimension';
  geometry: ParametricGeometryDef;
  style: ShapeStyle;
  visibleParamId?: string;
}

export interface ComponentRepresentation {
  id: string;
  context: RepresentationContext;
  geometry: ComponentGeometryElement[];
  isDefault: boolean;
}

export interface ReferenceGeometry {
  id: string;
  type: 'line' | 'point' | 'circle';
  geometry: ParametricGeometryDef;
  label?: string;
}

// ── Nesting ────────────────────────────────────────────────

export interface NestedComponentRef {
  id: string;
  definitionId: string;
  shared: boolean;
  instanceName?: string;
  positionX: string;
  positionY: string;
  rotation?: string;
  scale?: string;
  parameterOverrides: Record<string, string>;
  visibleParamId?: string;
}

// ── Arrays ─────────────────────────────────────────────────

export interface ComponentArray {
  id: string;
  type: 'linear' | 'radial';
  sourceType: 'element' | 'nested-component';
  sourceId: string;
  countParamId: string;
  spacingX?: string;
  spacingY?: string;
  centerX?: string;
  centerY?: string;
  radius?: string;
  totalAngle?: string;
  visibleParamId?: string;
}

// ── IFC Mapping ────────────────────────────────────────────

export type IFCProfileType =
  | 'IfcRectangleProfileDef'
  | 'IfcCircleProfileDef'
  | 'IfcIShapeProfileDef'
  | 'IfcLShapeProfileDef'
  | 'IfcTShapeProfileDef'
  | 'IfcUShapeProfileDef'
  | 'IfcCShapeProfileDef'
  | 'IfcZShapeProfileDef'
  | 'IfcRectangleHollowProfileDef'
  | 'IfcCircleHollowProfileDef'
  | 'IfcEllipseProfileDef'
  | 'IfcTrapeziumProfileDef'
  | 'IfcArbitraryClosedProfileDef'
  | 'IfcArbitraryOpenProfileDef'
  | 'IfcAsymmetricIShapeProfileDef';

export interface IFCProfileDefMapping {
  profileType: IFCProfileType;
  parameterMapping: Record<string, string>;
}

export interface IFCPropertySetDef {
  name: string;
  properties: IFCPropertyMapping[];
}

export interface IFCPropertyMapping {
  ifcName: string;
  paramId: string;
  ifcType: 'IfcBoolean' | 'IfcReal' | 'IfcInteger' | 'IfcLabel' | 'IfcLengthMeasure';
}

// ── ComponentDefinition ────────────────────────────────────

export interface ComponentDefinition {
  id: string;
  name: string;
  description?: string;
  category: ComponentCategory;
  tags?: string[];
  parameters: Parameter[];
  constraintGraph: ShapeConstraintGraph;
  representations: ComponentRepresentation[];
  referenceLines: ReferenceGeometry[];
  nestedComponents: NestedComponentRef[];
  arrays: ComponentArray[];
  ifcClass?: string;
  ifcProfileDef?: IFCProfileDefMapping;
  ifcPropertySets?: IFCPropertySetDef[];
  insertionPoint: { xParamId: string; yParamId: string };
  version: string;
  createdAt: string;
  modifiedAt: string;
  author?: string;
  metadata?: Record<string, unknown>;
}

// ── ComponentInstance (placed on canvas) ────────────────────

export interface FlattenedComponentGeometry {
  shapes: Shape[];
  bounds: BoundingBox;
}

export interface ComponentInstanceShape extends BaseShape {
  type: 'component-instance';
  definitionId: string;
  parameterValues: Record<string, number | boolean | string>;
  representationContext: RepresentationContext;
  position: Point;
  rotation: number;
  scale: number;
  flattenedGeometry?: FlattenedComponentGeometry;
  flattenedAt?: number;
}
```

- [ ] **Step 3: Commit**

```bash
git add src/types/component.ts src/types/geometry.ts
git commit -m "feat(component): add type definitions for parametric component system"
```

---

## Task 2: Component Flattener

**Files:**
- Create: `src/engine/component/__tests__/ComponentFlattener.test.ts`
- Create: `src/engine/component/ComponentFlattener.ts`

- [ ] **Step 1: Write failing flattener tests**

```typescript
// src/engine/component/__tests__/ComponentFlattener.test.ts
import { describe, it, expect } from 'vitest';
import { flattenGeometry } from '../ComponentFlattener';
import type { ComponentGeometryElement, ComponentRepresentation } from '../../../types/component';
import type { Parameter } from '../../../types/constraints';

function makeParam(id: string, name: string, value: number): Parameter {
  return { id, name, value, unit: 'mm', type: 'number' };
}

describe('ComponentFlattener', () => {
  describe('flattenGeometry — lines', () => {
    it('flattens a parametric line to a LineShape', () => {
      const params: Parameter[] = [
        makeParam('p_x1', 'x1', 0),
        makeParam('p_y1', 'y1', 0),
        makeParam('p_x2', 'x2', 100),
        makeParam('p_y2', 'y2', 50),
      ];
      const elements: ComponentGeometryElement[] = [{
        id: 'e1',
        type: 'line',
        geometry: { kind: 'line', startX: 'p_x1', startY: 'p_y1', endX: 'p_x2', endY: 'p_y2' },
        style: { strokeColor: '#000', strokeWidth: 1, lineStyle: 'solid' },
      }];
      const representation: ComponentRepresentation = {
        id: 'r1', context: 'plan', geometry: elements, isDefault: true,
      };

      const paramValues = new Map(params.map(p => [p.id, p.value]));
      const result = flattenGeometry(representation, paramValues, { x: 0, y: 0 }, 0, 1);

      expect(result.shapes).toHaveLength(1);
      expect(result.shapes[0].type).toBe('line');
      expect((result.shapes[0] as any).start).toEqual({ x: 0, y: 0 });
      expect((result.shapes[0] as any).end).toEqual({ x: 100, y: 50 });
    });
  });

  describe('flattenGeometry — circles', () => {
    it('flattens a parametric circle', () => {
      const params: Parameter[] = [
        makeParam('p_cx', 'cx', 50),
        makeParam('p_cy', 'cy', 50),
        makeParam('p_r', 'r', 25),
      ];
      const elements: ComponentGeometryElement[] = [{
        id: 'e1',
        type: 'circle',
        geometry: { kind: 'circle', centerX: 'p_cx', centerY: 'p_cy', radius: 'p_r' },
        style: { strokeColor: '#000', strokeWidth: 1, lineStyle: 'solid' },
      }];
      const representation: ComponentRepresentation = {
        id: 'r1', context: 'plan', geometry: elements, isDefault: true,
      };
      const paramValues = new Map(params.map(p => [p.id, p.value]));
      const result = flattenGeometry(representation, paramValues, { x: 0, y: 0 }, 0, 1);

      expect(result.shapes).toHaveLength(1);
      expect(result.shapes[0].type).toBe('circle');
      expect((result.shapes[0] as any).center).toEqual({ x: 50, y: 50 });
      expect((result.shapes[0] as any).radius).toBe(25);
    });
  });

  describe('flattenGeometry — rectangles', () => {
    it('flattens a parametric rectangle', () => {
      const params: Parameter[] = [
        makeParam('p_x', 'x', 10),
        makeParam('p_y', 'y', 20),
        makeParam('p_w', 'w', 200),
        makeParam('p_h', 'h', 100),
      ];
      const elements: ComponentGeometryElement[] = [{
        id: 'e1',
        type: 'rectangle',
        geometry: { kind: 'rectangle', x: 'p_x', y: 'p_y', width: 'p_w', height: 'p_h' },
        style: { strokeColor: '#000', strokeWidth: 1, lineStyle: 'solid' },
      }];
      const representation: ComponentRepresentation = {
        id: 'r1', context: 'plan', geometry: elements, isDefault: true,
      };
      const paramValues = new Map(params.map(p => [p.id, p.value]));
      const result = flattenGeometry(representation, paramValues, { x: 0, y: 0 }, 0, 1);

      expect(result.shapes).toHaveLength(1);
      expect(result.shapes[0].type).toBe('rectangle');
    });
  });

  describe('flattenGeometry — visibility', () => {
    it('skips elements where visibleParamId is false', () => {
      const params: Parameter[] = [
        makeParam('p_x1', 'x1', 0),
        makeParam('p_y1', 'y1', 0),
        makeParam('p_x2', 'x2', 100),
        makeParam('p_y2', 'y2', 100),
      ];
      const visParam: Parameter = { id: 'p_vis', name: 'visible', value: false, unit: 'none', type: 'boolean' };
      params.push(visParam);

      const elements: ComponentGeometryElement[] = [{
        id: 'e1',
        type: 'line',
        geometry: { kind: 'line', startX: 'p_x1', startY: 'p_y1', endX: 'p_x2', endY: 'p_y2' },
        style: { strokeColor: '#000', strokeWidth: 1, lineStyle: 'solid' },
        visibleParamId: 'p_vis',
      }];
      const representation: ComponentRepresentation = {
        id: 'r1', context: 'plan', geometry: elements, isDefault: true,
      };
      const paramValues = new Map(params.map(p => [p.id, p.value]));
      const result = flattenGeometry(representation, paramValues, { x: 0, y: 0 }, 0, 1);

      expect(result.shapes).toHaveLength(0);
    });

    it('includes elements where visibleParamId is true', () => {
      const params: Parameter[] = [
        makeParam('p_x1', 'x1', 0),
        makeParam('p_y1', 'y1', 0),
        makeParam('p_x2', 'x2', 100),
        makeParam('p_y2', 'y2', 100),
      ];
      const visParam: Parameter = { id: 'p_vis', name: 'visible', value: true, unit: 'none', type: 'boolean' };
      params.push(visParam);

      const elements: ComponentGeometryElement[] = [{
        id: 'e1',
        type: 'line',
        geometry: { kind: 'line', startX: 'p_x1', startY: 'p_y1', endX: 'p_x2', endY: 'p_y2' },
        style: { strokeColor: '#000', strokeWidth: 1, lineStyle: 'solid' },
        visibleParamId: 'p_vis',
      }];
      const representation: ComponentRepresentation = {
        id: 'r1', context: 'plan', geometry: elements, isDefault: true,
      };
      const paramValues = new Map(params.map(p => [p.id, p.value]));
      const result = flattenGeometry(representation, paramValues, { x: 0, y: 0 }, 0, 1);

      expect(result.shapes).toHaveLength(1);
    });
  });

  describe('flattenGeometry — text interpolation', () => {
    it('interpolates parameter values in text template', () => {
      const params: Parameter[] = [
        makeParam('p_x', 'x', 0),
        makeParam('p_y', 'y', 0),
        makeParam('p_d', 'diameter', 12),
        makeParam('p_l', 'length', 8000),
      ];
      const elements: ComponentGeometryElement[] = [{
        id: 'e1',
        type: 'text',
        geometry: {
          kind: 'text',
          x: 'p_x', y: 'p_y',
          template: 'Ø{diameter} L={length}',
        },
        style: { strokeColor: '#000', strokeWidth: 1, lineStyle: 'solid' },
      }];
      const representation: ComponentRepresentation = {
        id: 'r1', context: 'plan', geometry: elements, isDefault: true,
      };

      // Build paramValues with names mapping for text interpolation
      const paramValues = new Map(params.map(p => [p.id, p.value]));
      const paramNames = new Map(params.map(p => [p.name, p.value]));
      const result = flattenGeometry(representation, paramValues, { x: 0, y: 0 }, 0, 1, paramNames);

      expect(result.shapes).toHaveLength(1);
      expect((result.shapes[0] as any).text).toBe('Ø12 L=8000');
    });
  });

  describe('flattenGeometry — transform', () => {
    it('applies position offset to all shapes', () => {
      const params: Parameter[] = [
        makeParam('p_x1', 'x1', 0),
        makeParam('p_y1', 'y1', 0),
        makeParam('p_x2', 'x2', 100),
        makeParam('p_y2', 'y2', 0),
      ];
      const elements: ComponentGeometryElement[] = [{
        id: 'e1',
        type: 'line',
        geometry: { kind: 'line', startX: 'p_x1', startY: 'p_y1', endX: 'p_x2', endY: 'p_y2' },
        style: { strokeColor: '#000', strokeWidth: 1, lineStyle: 'solid' },
      }];
      const representation: ComponentRepresentation = {
        id: 'r1', context: 'plan', geometry: elements, isDefault: true,
      };
      const paramValues = new Map(params.map(p => [p.id, p.value]));
      const result = flattenGeometry(representation, paramValues, { x: 500, y: 300 }, 0, 1);

      expect((result.shapes[0] as any).start).toEqual({ x: 500, y: 300 });
      expect((result.shapes[0] as any).end).toEqual({ x: 600, y: 300 });
    });

    it('computes correct bounding box', () => {
      const params: Parameter[] = [
        makeParam('p_x1', 'x1', 0),
        makeParam('p_y1', 'y1', 0),
        makeParam('p_x2', 'x2', 200),
        makeParam('p_y2', 'y2', 100),
      ];
      const elements: ComponentGeometryElement[] = [{
        id: 'e1',
        type: 'line',
        geometry: { kind: 'line', startX: 'p_x1', startY: 'p_y1', endX: 'p_x2', endY: 'p_y2' },
        style: { strokeColor: '#000', strokeWidth: 1, lineStyle: 'solid' },
      }];
      const representation: ComponentRepresentation = {
        id: 'r1', context: 'plan', geometry: elements, isDefault: true,
      };
      const paramValues = new Map(params.map(p => [p.id, p.value]));
      const result = flattenGeometry(representation, paramValues, { x: 0, y: 0 }, 0, 1);

      expect(result.bounds.minX).toBe(0);
      expect(result.bounds.minY).toBe(0);
      expect(result.bounds.maxX).toBe(200);
      expect(result.bounds.maxY).toBe(100);
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/engine/component/__tests__/ComponentFlattener.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement the flattener**

```typescript
// src/engine/component/ComponentFlattener.ts
import type { Point, Shape, BoundingBox, LineShape, CircleShape, ArcShape, RectangleShape, TextShape } from '../../types/geometry';
import type {
  ComponentRepresentation,
  ComponentGeometryElement,
  FlattenedComponentGeometry,
  ParametricGeometryDef,
} from '../../types/component';

type ParamValues = Map<string, number | boolean | string>;

function getNum(paramValues: ParamValues, paramId: string): number {
  const val = paramValues.get(paramId);
  return typeof val === 'number' ? val : 0;
}

function getBool(paramValues: ParamValues, paramId: string): boolean {
  const val = paramValues.get(paramId);
  return val === true || val === 'true';
}

function generateId(): string {
  return `cf_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function transformPoint(px: number, py: number, position: Point, rotation: number, scale: number): Point {
  const rad = (rotation * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const sx = px * scale;
  const sy = py * scale;
  return {
    x: position.x + sx * cos - sy * sin,
    y: position.y + sx * sin + sy * cos,
  };
}

function interpolateText(template: string, paramNames?: Map<string, number | boolean | string>): string {
  if (!paramNames) return template;
  return template.replace(/\{(\w+)\}/g, (_, name) => {
    const val = paramNames.get(name);
    return val !== undefined ? String(val) : `{${name}}`;
  });
}

function flattenElement(
  element: ComponentGeometryElement,
  paramValues: ParamValues,
  position: Point,
  rotation: number,
  scale: number,
  drawingId: string,
  layerId: string,
  paramNames?: ParamValues,
): Shape | null {
  const geom = element.geometry;

  switch (geom.kind) {
    case 'line': {
      const start = transformPoint(getNum(paramValues, geom.startX), getNum(paramValues, geom.startY), position, rotation, scale);
      const end = transformPoint(getNum(paramValues, geom.endX), getNum(paramValues, geom.endY), position, rotation, scale);
      return {
        id: generateId(),
        type: 'line',
        start,
        end,
        style: { ...element.style },
        layerId,
        drawingId,
        visible: true,
        locked: false,
      } as LineShape;
    }

    case 'circle': {
      const center = transformPoint(getNum(paramValues, geom.centerX), getNum(paramValues, geom.centerY), position, rotation, scale);
      const radius = getNum(paramValues, geom.radius) * scale;
      return {
        id: generateId(),
        type: 'circle',
        center,
        radius,
        style: { ...element.style },
        layerId,
        drawingId,
        visible: true,
        locked: false,
      } as CircleShape;
    }

    case 'arc': {
      const center = transformPoint(getNum(paramValues, geom.centerX), getNum(paramValues, geom.centerY), position, rotation, scale);
      const radius = getNum(paramValues, geom.radius) * scale;
      const startAngle = getNum(paramValues, geom.startAngle) + rotation;
      const endAngle = getNum(paramValues, geom.endAngle) + rotation;
      return {
        id: generateId(),
        type: 'arc',
        center,
        radius,
        startAngle,
        endAngle,
        style: { ...element.style },
        layerId,
        drawingId,
        visible: true,
        locked: false,
      } as ArcShape;
    }

    case 'rectangle': {
      const origin = transformPoint(getNum(paramValues, geom.x), getNum(paramValues, geom.y), position, rotation, scale);
      const width = getNum(paramValues, geom.width) * scale;
      const height = getNum(paramValues, geom.height) * scale;
      const rectRot = geom.rotation ? getNum(paramValues, geom.rotation) + rotation : rotation;
      return {
        id: generateId(),
        type: 'rectangle',
        start: origin,
        end: { x: origin.x + width, y: origin.y + height },
        style: { ...element.style },
        layerId,
        drawingId,
        visible: true,
        locked: false,
      } as RectangleShape;
    }

    case 'text': {
      const pos = transformPoint(getNum(paramValues, geom.x), getNum(paramValues, geom.y), position, rotation, scale);
      const text = interpolateText(geom.template, paramNames);
      const textHeight = geom.height ? getNum(paramValues, geom.height) * scale : 3;
      return {
        id: generateId(),
        type: 'text',
        position: pos,
        text,
        height: textHeight,
        rotation: geom.rotation ? getNum(paramValues, geom.rotation) + rotation : rotation,
        style: { ...element.style },
        layerId,
        drawingId,
        visible: true,
        locked: false,
      } as TextShape;
    }

    case 'polyline': {
      const points = geom.vertices.map(v =>
        transformPoint(getNum(paramValues, v.xParamId), getNum(paramValues, v.yParamId), position, rotation, scale)
      );
      return {
        id: generateId(),
        type: 'polyline',
        points,
        closed: geom.closed,
        bulges: [],
        style: { ...element.style },
        layerId,
        drawingId,
        visible: true,
        locked: false,
      } as any;
    }

    case 'hatch':
    case 'dimension':
      // These require boundary resolution — return null for now, implement in later task
      return null;

    default:
      return null;
  }
}

function computeBounds(shapes: Shape[]): BoundingBox {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

  for (const shape of shapes) {
    const s = shape as any;
    const points: Point[] = [];

    if (s.start) points.push(s.start);
    if (s.end) points.push(s.end);
    if (s.center && s.radius != null) {
      points.push({ x: s.center.x - s.radius, y: s.center.y - s.radius });
      points.push({ x: s.center.x + s.radius, y: s.center.y + s.radius });
    }
    if (s.position) points.push(s.position);
    if (s.points) points.push(...s.points);

    for (const p of points) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
  }

  if (minX === Infinity) return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  return { minX, minY, maxX, maxY };
}

export function flattenGeometry(
  representation: ComponentRepresentation,
  paramValues: ParamValues,
  position: Point,
  rotation: number,
  scale: number,
  paramNames?: ParamValues,
): FlattenedComponentGeometry {
  const shapes: Shape[] = [];
  const drawingId = '__component__';
  const layerId = '__component__';

  for (const element of representation.geometry) {
    // Check visibility
    if (element.visibleParamId) {
      if (!getBool(paramValues, element.visibleParamId)) continue;
    }

    const shape = flattenElement(element, paramValues, position, rotation, scale, drawingId, layerId, paramNames);
    if (shape) shapes.push(shape);
  }

  return {
    shapes,
    bounds: computeBounds(shapes),
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/engine/component/__tests__/ComponentFlattener.test.ts`
Expected: ALL PASS

- [ ] **Step 5: Commit**

```bash
git add src/engine/component/ComponentFlattener.ts src/engine/component/__tests__/ComponentFlattener.test.ts
git commit -m "feat(component): add component flattener — parametric geometry to shapes"
```

---

## Task 3: Array Resolver

**Files:**
- Create: `src/engine/component/__tests__/ComponentArrayResolver.test.ts`
- Create: `src/engine/component/ComponentArrayResolver.ts`

- [ ] **Step 1: Write failing array resolver tests**

```typescript
// src/engine/component/__tests__/ComponentArrayResolver.test.ts
import { describe, it, expect } from 'vitest';
import { resolveLinearArray, resolveRadialArray } from '../ComponentArrayResolver';
import type { ComponentArray } from '../../../types/component';
import type { Parameter } from '../../../types/constraints';

function makeParam(id: string, name: string, value: number): Parameter {
  return { id, name, value, unit: 'mm', type: 'number' };
}

describe('ComponentArrayResolver', () => {
  describe('resolveLinearArray', () => {
    it('generates correct number of positions', () => {
      const params = new Map<string, number | boolean | string>([
        ['p_count', 4],
        ['p_spacingX', 100],
        ['p_spacingY', 0],
      ]);
      const array: ComponentArray = {
        id: 'arr1', type: 'linear',
        sourceType: 'element', sourceId: 'e1',
        countParamId: 'p_count',
        spacingX: 'p_spacingX', spacingY: 'p_spacingY',
      };

      const positions = resolveLinearArray(array, params);
      expect(positions).toHaveLength(4);
      expect(positions[0]).toEqual({ x: 0, y: 0, rotation: 0 });
      expect(positions[1]).toEqual({ x: 100, y: 0, rotation: 0 });
      expect(positions[2]).toEqual({ x: 200, y: 0, rotation: 0 });
      expect(positions[3]).toEqual({ x: 300, y: 0, rotation: 0 });
    });

    it('returns empty array when count is 0', () => {
      const params = new Map<string, number | boolean | string>([
        ['p_count', 0],
        ['p_spacingX', 100],
        ['p_spacingY', 0],
      ]);
      const array: ComponentArray = {
        id: 'arr1', type: 'linear',
        sourceType: 'element', sourceId: 'e1',
        countParamId: 'p_count',
        spacingX: 'p_spacingX', spacingY: 'p_spacingY',
      };

      const positions = resolveLinearArray(array, params);
      expect(positions).toHaveLength(0);
    });

    it('handles diagonal spacing', () => {
      const params = new Map<string, number | boolean | string>([
        ['p_count', 3],
        ['p_spacingX', 100],
        ['p_spacingY', 50],
      ]);
      const array: ComponentArray = {
        id: 'arr1', type: 'linear',
        sourceType: 'element', sourceId: 'e1',
        countParamId: 'p_count',
        spacingX: 'p_spacingX', spacingY: 'p_spacingY',
      };

      const positions = resolveLinearArray(array, params);
      expect(positions[2]).toEqual({ x: 200, y: 100, rotation: 0 });
    });
  });

  describe('resolveRadialArray', () => {
    it('generates positions around a circle', () => {
      const params = new Map<string, number | boolean | string>([
        ['p_count', 4],
        ['p_cx', 0],
        ['p_cy', 0],
        ['p_r', 100],
        ['p_angle', 360],
      ]);
      const array: ComponentArray = {
        id: 'arr1', type: 'radial',
        sourceType: 'element', sourceId: 'e1',
        countParamId: 'p_count',
        centerX: 'p_cx', centerY: 'p_cy',
        radius: 'p_r', totalAngle: 'p_angle',
      };

      const positions = resolveRadialArray(array, params);
      expect(positions).toHaveLength(4);
      // First at 0°, then 90°, 180°, 270°
      expect(positions[0].x).toBeCloseTo(100);
      expect(positions[0].y).toBeCloseTo(0);
      expect(positions[1].x).toBeCloseTo(0);
      expect(positions[1].y).toBeCloseTo(100);
    });

    it('returns empty array when count is 0', () => {
      const params = new Map<string, number | boolean | string>([
        ['p_count', 0],
        ['p_cx', 0], ['p_cy', 0],
        ['p_r', 100], ['p_angle', 360],
      ]);
      const array: ComponentArray = {
        id: 'arr1', type: 'radial',
        sourceType: 'element', sourceId: 'e1',
        countParamId: 'p_count',
        centerX: 'p_cx', centerY: 'p_cy',
        radius: 'p_r', totalAngle: 'p_angle',
      };

      const positions = resolveRadialArray(array, params);
      expect(positions).toHaveLength(0);
    });

    it('handles partial arc (180 degrees)', () => {
      const params = new Map<string, number | boolean | string>([
        ['p_count', 3],
        ['p_cx', 0], ['p_cy', 0],
        ['p_r', 100], ['p_angle', 180],
      ]);
      const array: ComponentArray = {
        id: 'arr1', type: 'radial',
        sourceType: 'element', sourceId: 'e1',
        countParamId: 'p_count',
        centerX: 'p_cx', centerY: 'p_cy',
        radius: 'p_r', totalAngle: 'p_angle',
      };

      const positions = resolveRadialArray(array, params);
      expect(positions).toHaveLength(3);
      // 0°, 90°, 180°
      expect(positions[0].rotation).toBeCloseTo(0);
      expect(positions[1].rotation).toBeCloseTo(90);
      expect(positions[2].rotation).toBeCloseTo(180);
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/engine/component/__tests__/ComponentArrayResolver.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement the array resolver**

```typescript
// src/engine/component/ComponentArrayResolver.ts
import type { ComponentArray } from '../../types/component';

type ParamValues = Map<string, number | boolean | string>;

export interface ArrayPosition {
  x: number;
  y: number;
  rotation: number;
}

function getNum(paramValues: ParamValues, paramId: string | undefined): number {
  if (!paramId) return 0;
  const val = paramValues.get(paramId);
  return typeof val === 'number' ? val : 0;
}

export function resolveLinearArray(array: ComponentArray, paramValues: ParamValues): ArrayPosition[] {
  const count = Math.max(0, Math.round(getNum(paramValues, array.countParamId)));
  if (count === 0) return [];

  const spacingX = getNum(paramValues, array.spacingX);
  const spacingY = getNum(paramValues, array.spacingY);

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

export function resolveRadialArray(array: ComponentArray, paramValues: ParamValues): ArrayPosition[] {
  const count = Math.max(0, Math.round(getNum(paramValues, array.countParamId)));
  if (count === 0) return [];

  const centerX = getNum(paramValues, array.centerX);
  const centerY = getNum(paramValues, array.centerY);
  const radius = getNum(paramValues, array.radius);
  const totalAngle = getNum(paramValues, array.totalAngle);

  const positions: ArrayPosition[] = [];
  const isFullCircle = Math.abs(totalAngle) >= 360;
  const divisions = isFullCircle ? count : Math.max(1, count - 1);

  for (let i = 0; i < count; i++) {
    const angleDeg = (i * totalAngle) / divisions;
    const angleRad = (angleDeg * Math.PI) / 180;
    positions.push({
      x: centerX + radius * Math.cos(angleRad),
      y: centerY + radius * Math.sin(angleRad),
      rotation: angleDeg,
    });
  }
  return positions;
}

export function resolveArray(array: ComponentArray, paramValues: ParamValues): ArrayPosition[] {
  if (array.type === 'linear') return resolveLinearArray(array, paramValues);
  if (array.type === 'radial') return resolveRadialArray(array, paramValues);
  return [];
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/engine/component/__tests__/ComponentArrayResolver.test.ts`
Expected: ALL PASS

- [ ] **Step 5: Commit**

```bash
git add src/engine/component/ComponentArrayResolver.ts src/engine/component/__tests__/ComponentArrayResolver.test.ts
git commit -m "feat(component): add array resolver for linear and radial arrays"
```

---

## Task 4: Nesting Resolver

**Files:**
- Create: `src/engine/component/__tests__/ComponentNestingResolver.test.ts`
- Create: `src/engine/component/ComponentNestingResolver.ts`

- [ ] **Step 1: Write failing nesting tests**

```typescript
// src/engine/component/__tests__/ComponentNestingResolver.test.ts
import { describe, it, expect } from 'vitest';
import { NestingResolver, NestingCycleError } from '../ComponentNestingResolver';
import type { ComponentDefinition } from '../../../types/component';
import type { Parameter } from '../../../types/constraints';

function makeParam(id: string, name: string, value: number): Parameter {
  return { id, name, value, unit: 'mm', type: 'number' };
}

function makeMinimalDef(id: string, name: string, nested: Array<{ id: string; defId: string; shared: boolean }> = []): ComponentDefinition {
  return {
    id, name,
    category: 'custom',
    parameters: [makeParam(`${id}_x`, 'x', 0), makeParam(`${id}_y`, 'y', 0)],
    constraintGraph: { parameters: [], vertices: [], edges: [], constraintGraph: { nodes: {}, solveOrder: [], globalParameters: {}, isDirty: false } },
    representations: [{ id: 'r1', context: 'plan', geometry: [], isDefault: true }],
    referenceLines: [],
    nestedComponents: nested.map(n => ({
      id: n.id, definitionId: n.defId, shared: n.shared,
      positionX: `${id}_x`, positionY: `${id}_y`,
      parameterOverrides: {},
    })),
    arrays: [],
    insertionPoint: { xParamId: `${id}_x`, yParamId: `${id}_y` },
    version: '1.0', createdAt: '', modifiedAt: '',
  };
}

describe('NestingResolver', () => {
  describe('cycle detection', () => {
    it('detects direct self-nesting', () => {
      const defA = makeMinimalDef('a', 'CompA', [{ id: 'n1', defId: 'a', shared: true }]);
      const resolver = new NestingResolver(new Map([['a', defA]]));
      expect(() => resolver.validateNesting('a')).toThrow(NestingCycleError);
    });

    it('detects indirect cycle (A→B→A)', () => {
      const defA = makeMinimalDef('a', 'CompA', [{ id: 'n1', defId: 'b', shared: true }]);
      const defB = makeMinimalDef('b', 'CompB', [{ id: 'n2', defId: 'a', shared: true }]);
      const resolver = new NestingResolver(new Map([['a', defA], ['b', defB]]));
      expect(() => resolver.validateNesting('a')).toThrow(NestingCycleError);
    });

    it('allows valid nesting (A→B, A→C, no cycles)', () => {
      const defA = makeMinimalDef('a', 'CompA', [
        { id: 'n1', defId: 'b', shared: true },
        { id: 'n2', defId: 'c', shared: true },
      ]);
      const defB = makeMinimalDef('b', 'CompB');
      const defC = makeMinimalDef('c', 'CompC');
      const resolver = new NestingResolver(new Map([['a', defA], ['b', defB], ['c', defC]]));
      expect(() => resolver.validateNesting('a')).not.toThrow();
    });

    it('allows diamond nesting (A→B→D, A→C→D)', () => {
      const defA = makeMinimalDef('a', 'CompA', [
        { id: 'n1', defId: 'b', shared: true },
        { id: 'n2', defId: 'c', shared: true },
      ]);
      const defB = makeMinimalDef('b', 'CompB', [{ id: 'n3', defId: 'd', shared: true }]);
      const defC = makeMinimalDef('c', 'CompC', [{ id: 'n4', defId: 'd', shared: true }]);
      const defD = makeMinimalDef('d', 'CompD');
      const resolver = new NestingResolver(new Map([['a', defA], ['b', defB], ['c', defC], ['d', defD]]));
      expect(() => resolver.validateNesting('a')).not.toThrow();
    });
  });

  describe('getNestingDepth', () => {
    it('returns 0 for component with no nesting', () => {
      const defA = makeMinimalDef('a', 'CompA');
      const resolver = new NestingResolver(new Map([['a', defA]]));
      expect(resolver.getNestingDepth('a')).toBe(0);
    });

    it('returns correct depth for chain', () => {
      const defA = makeMinimalDef('a', 'CompA', [{ id: 'n1', defId: 'b', shared: true }]);
      const defB = makeMinimalDef('b', 'CompB', [{ id: 'n2', defId: 'c', shared: true }]);
      const defC = makeMinimalDef('c', 'CompC');
      const resolver = new NestingResolver(new Map([['a', defA], ['b', defB], ['c', defC]]));
      expect(resolver.getNestingDepth('a')).toBe(2);
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

- [ ] **Step 3: Implement the nesting resolver**

```typescript
// src/engine/component/ComponentNestingResolver.ts
import type { ComponentDefinition } from '../../types/component';

export class NestingCycleError extends Error {
  constructor(message: string, public cyclePath: string[]) {
    super(message);
    this.name = 'NestingCycleError';
    Object.setPrototypeOf(this, NestingCycleError.prototype);
  }
}

export class NestingResolver {
  private definitions: Map<string, ComponentDefinition>;

  constructor(definitions: Map<string, ComponentDefinition>) {
    this.definitions = definitions;
  }

  validateNesting(defId: string): void {
    const visiting = new Set<string>();
    const path: string[] = [];
    this.dfs(defId, visiting, path);
  }

  private dfs(defId: string, visiting: Set<string>, path: string[]): void {
    if (visiting.has(defId)) {
      const cycleStart = path.indexOf(defId);
      const cyclePath = [...path.slice(cycleStart), defId];
      throw new NestingCycleError(
        `Nesting cycle detected: ${cyclePath.join(' → ')}`,
        cyclePath,
      );
    }

    const def = this.definitions.get(defId);
    if (!def) return;

    visiting.add(defId);
    path.push(defId);

    for (const nested of def.nestedComponents) {
      this.dfs(nested.definitionId, visiting, path);
    }

    path.pop();
    visiting.delete(defId);
  }

  getNestingDepth(defId: string): number {
    const def = this.definitions.get(defId);
    if (!def || def.nestedComponents.length === 0) return 0;

    let maxDepth = 0;
    for (const nested of def.nestedComponents) {
      const depth = this.getNestingDepth(nested.definitionId);
      if (depth > maxDepth) maxDepth = depth;
    }
    return maxDepth + 1;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/engine/component/__tests__/ComponentNestingResolver.test.ts`
Expected: ALL PASS

- [ ] **Step 5: Commit**

```bash
git add src/engine/component/ComponentNestingResolver.ts src/engine/component/__tests__/ComponentNestingResolver.test.ts
git commit -m "feat(component): add nesting resolver with cycle detection"
```

---

## Task 5: IFC Profile Mapper

**Files:**
- Create: `src/engine/component/IFCProfileMapper.ts`

- [ ] **Step 1: Implement the IFC profile mapper**

This file defines the 14 built-in IFC profile types with their parameter schemas and geometry generators.

```typescript
// src/engine/component/IFCProfileMapper.ts
import type {
  ComponentDefinition,
  ComponentRepresentation,
  ComponentGeometryElement,
  IFCProfileDefMapping,
  IFCProfileType,
  ComponentCategory,
} from '../../types/component';
import type { Parameter } from '../../types/constraints';

interface ProfileSchema {
  ifcProfileType: IFCProfileType;
  name: string;
  category: ComponentCategory;
  parameters: Array<{
    name: string;
    ifcName: string;
    defaultValue: number;
    min?: number;
    max?: number;
    unit: 'mm' | 'deg';
    group: string;
  }>;
  // Function that returns geometry element IDs for a plan representation
  geometryFactory: (paramPrefix: string) => ComponentGeometryElement[];
}

function makeParam(prefix: string, name: string, schema: ProfileSchema['parameters'][0]): Parameter {
  return {
    id: `${prefix}_${name}`,
    name,
    value: schema.defaultValue,
    unit: schema.unit,
    type: 'number',
    min: schema.min,
    max: schema.max,
    group: schema.group,
  };
}

// Simple rectangle geometry for profiles (outline as polyline)
function rectangleOutline(prefix: string, wParam: string, hParam: string): ComponentGeometryElement[] {
  return [{
    id: `${prefix}_outline`,
    type: 'polyline',
    geometry: {
      kind: 'polyline',
      vertices: [
        { xParamId: `${prefix}_negHalfW`, yParamId: `${prefix}_negHalfH` },
        { xParamId: `${prefix}_halfW`, yParamId: `${prefix}_negHalfH` },
        { xParamId: `${prefix}_halfW`, yParamId: `${prefix}_halfH` },
        { xParamId: `${prefix}_negHalfW`, yParamId: `${prefix}_halfH` },
      ],
      closed: true,
    },
    style: { strokeColor: '#000000', strokeWidth: 1, lineStyle: 'solid' },
  }];
}

function circleOutline(prefix: string): ComponentGeometryElement[] {
  return [{
    id: `${prefix}_outline`,
    type: 'circle',
    geometry: {
      kind: 'circle',
      centerX: `${prefix}_cx`,
      centerY: `${prefix}_cy`,
      radius: `${prefix}_radius`,
    },
    style: { strokeColor: '#000000', strokeWidth: 1, lineStyle: 'solid' },
  }];
}

const PROFILE_SCHEMAS: ProfileSchema[] = [
  {
    ifcProfileType: 'IfcRectangleProfileDef',
    name: 'Rectangle',
    category: 'structural-steel',
    parameters: [
      { name: 'width', ifcName: 'XDim', defaultValue: 200, min: 1, max: 5000, unit: 'mm', group: 'Dimensions' },
      { name: 'height', ifcName: 'YDim', defaultValue: 400, min: 1, max: 5000, unit: 'mm', group: 'Dimensions' },
    ],
    geometryFactory: (p) => rectangleOutline(p, `${p}_width`, `${p}_height`),
  },
  {
    ifcProfileType: 'IfcCircleProfileDef',
    name: 'Circle',
    category: 'structural-steel',
    parameters: [
      { name: 'radius', ifcName: 'Radius', defaultValue: 100, min: 1, max: 2500, unit: 'mm', group: 'Dimensions' },
    ],
    geometryFactory: (p) => circleOutline(p),
  },
  {
    ifcProfileType: 'IfcIShapeProfileDef',
    name: 'I-Beam',
    category: 'structural-steel',
    parameters: [
      { name: 'height', ifcName: 'OverallDepth', defaultValue: 300, min: 50, max: 2000, unit: 'mm', group: 'Dimensions' },
      { name: 'flangeWidth', ifcName: 'OverallWidth', defaultValue: 300, min: 30, max: 1000, unit: 'mm', group: 'Dimensions' },
      { name: 'webThickness', ifcName: 'WebThickness', defaultValue: 8, min: 2, max: 100, unit: 'mm', group: 'Dimensions' },
      { name: 'flangeThickness', ifcName: 'FlangeThickness', defaultValue: 14, min: 2, max: 100, unit: 'mm', group: 'Dimensions' },
      { name: 'filletRadius', ifcName: 'FilletRadius', defaultValue: 12, min: 0, max: 50, unit: 'mm', group: 'Dimensions' },
    ],
    geometryFactory: (p) => rectangleOutline(p, `${p}_flangeWidth`, `${p}_height`),
  },
  {
    ifcProfileType: 'IfcLShapeProfileDef',
    name: 'Angle',
    category: 'structural-steel',
    parameters: [
      { name: 'depth', ifcName: 'Depth', defaultValue: 100, min: 20, max: 500, unit: 'mm', group: 'Dimensions' },
      { name: 'width', ifcName: 'Width', defaultValue: 100, min: 20, max: 500, unit: 'mm', group: 'Dimensions' },
      { name: 'thickness', ifcName: 'Thickness', defaultValue: 10, min: 2, max: 50, unit: 'mm', group: 'Dimensions' },
      { name: 'filletRadius', ifcName: 'FilletRadius', defaultValue: 8, min: 0, max: 30, unit: 'mm', group: 'Dimensions' },
    ],
    geometryFactory: (p) => rectangleOutline(p, `${p}_width`, `${p}_depth`),
  },
  {
    ifcProfileType: 'IfcTShapeProfileDef',
    name: 'Tee',
    category: 'structural-steel',
    parameters: [
      { name: 'depth', ifcName: 'Depth', defaultValue: 150, min: 30, max: 1000, unit: 'mm', group: 'Dimensions' },
      { name: 'flangeWidth', ifcName: 'FlangeWidth', defaultValue: 150, min: 30, max: 500, unit: 'mm', group: 'Dimensions' },
      { name: 'webThickness', ifcName: 'WebThickness', defaultValue: 7, min: 2, max: 50, unit: 'mm', group: 'Dimensions' },
      { name: 'flangeThickness', ifcName: 'FlangeThickness', defaultValue: 10, min: 2, max: 50, unit: 'mm', group: 'Dimensions' },
    ],
    geometryFactory: (p) => rectangleOutline(p, `${p}_flangeWidth`, `${p}_depth`),
  },
  {
    ifcProfileType: 'IfcUShapeProfileDef',
    name: 'Channel',
    category: 'structural-steel',
    parameters: [
      { name: 'depth', ifcName: 'Depth', defaultValue: 200, min: 30, max: 1000, unit: 'mm', group: 'Dimensions' },
      { name: 'flangeWidth', ifcName: 'FlangeWidth', defaultValue: 80, min: 20, max: 500, unit: 'mm', group: 'Dimensions' },
      { name: 'webThickness', ifcName: 'WebThickness', defaultValue: 7, min: 2, max: 50, unit: 'mm', group: 'Dimensions' },
      { name: 'flangeThickness', ifcName: 'FlangeThickness', defaultValue: 11, min: 2, max: 50, unit: 'mm', group: 'Dimensions' },
    ],
    geometryFactory: (p) => rectangleOutline(p, `${p}_flangeWidth`, `${p}_depth`),
  },
  {
    ifcProfileType: 'IfcRectangleHollowProfileDef',
    name: 'HSS Rectangular',
    category: 'structural-steel',
    parameters: [
      { name: 'width', ifcName: 'XDim', defaultValue: 200, min: 20, max: 1000, unit: 'mm', group: 'Dimensions' },
      { name: 'height', ifcName: 'YDim', defaultValue: 100, min: 20, max: 1000, unit: 'mm', group: 'Dimensions' },
      { name: 'wallThickness', ifcName: 'WallThickness', defaultValue: 8, min: 1, max: 50, unit: 'mm', group: 'Dimensions' },
    ],
    geometryFactory: (p) => rectangleOutline(p, `${p}_width`, `${p}_height`),
  },
  {
    ifcProfileType: 'IfcCircleHollowProfileDef',
    name: 'HSS Round',
    category: 'structural-steel',
    parameters: [
      { name: 'radius', ifcName: 'Radius', defaultValue: 100, min: 10, max: 1000, unit: 'mm', group: 'Dimensions' },
      { name: 'wallThickness', ifcName: 'WallThickness', defaultValue: 6, min: 1, max: 50, unit: 'mm', group: 'Dimensions' },
    ],
    geometryFactory: (p) => circleOutline(p),
  },
  {
    ifcProfileType: 'IfcEllipseProfileDef',
    name: 'Ellipse',
    category: 'structural-steel',
    parameters: [
      { name: 'semiAxis1', ifcName: 'SemiAxis1', defaultValue: 150, min: 10, max: 2000, unit: 'mm', group: 'Dimensions' },
      { name: 'semiAxis2', ifcName: 'SemiAxis2', defaultValue: 100, min: 10, max: 2000, unit: 'mm', group: 'Dimensions' },
    ],
    geometryFactory: (p) => rectangleOutline(p, `${p}_semiAxis1`, `${p}_semiAxis2`),
  },
  {
    ifcProfileType: 'IfcTrapeziumProfileDef',
    name: 'Trapezium',
    category: 'structural-steel',
    parameters: [
      { name: 'bottomWidth', ifcName: 'BottomXDim', defaultValue: 300, min: 10, max: 2000, unit: 'mm', group: 'Dimensions' },
      { name: 'topWidth', ifcName: 'TopXDim', defaultValue: 200, min: 10, max: 2000, unit: 'mm', group: 'Dimensions' },
      { name: 'height', ifcName: 'YDim', defaultValue: 200, min: 10, max: 2000, unit: 'mm', group: 'Dimensions' },
      { name: 'offset', ifcName: 'TopXOffset', defaultValue: 50, min: 0, max: 1000, unit: 'mm', group: 'Dimensions' },
    ],
    geometryFactory: (p) => rectangleOutline(p, `${p}_bottomWidth`, `${p}_height`),
  },
];

export function getProfileSchemas(): ProfileSchema[] {
  return PROFILE_SCHEMAS;
}

export function getProfileSchema(ifcProfileType: IFCProfileType): ProfileSchema | undefined {
  return PROFILE_SCHEMAS.find(s => s.ifcProfileType === ifcProfileType);
}

export function createProfileDefinition(
  ifcProfileType: IFCProfileType,
  ifcClass: string,
  name: string,
  parameterDefaults?: Record<string, number>,
): ComponentDefinition {
  const schema = getProfileSchema(ifcProfileType);
  if (!schema) throw new Error(`Unknown IFC profile type: ${ifcProfileType}`);

  const defId = `profile_${ifcProfileType}_${Date.now()}`;
  const prefix = defId;

  const parameters: Parameter[] = schema.parameters.map(ps => {
    const value = parameterDefaults?.[ps.name] ?? ps.defaultValue;
    return makeParam(prefix, ps.name, { ...ps, defaultValue: value });
  });

  const parameterMapping: Record<string, string> = {};
  for (const ps of schema.parameters) {
    parameterMapping[ps.ifcName] = `${prefix}_${ps.name}`;
  }

  const geometry = schema.geometryFactory(prefix);

  const representation: ComponentRepresentation = {
    id: `${prefix}_plan`,
    context: 'plan',
    geometry,
    isDefault: true,
  };

  return {
    id: defId,
    name,
    category: schema.category,
    parameters,
    constraintGraph: {
      parameters,
      vertices: [],
      edges: [],
      constraintGraph: {
        nodes: {},
        solveOrder: [],
        globalParameters: {},
        isDirty: false,
      },
    },
    representations: [representation],
    referenceLines: [],
    nestedComponents: [],
    arrays: [],
    ifcClass,
    ifcProfileDef: { profileType: ifcProfileType, parameterMapping },
    insertionPoint: { xParamId: `${prefix}_cx`, yParamId: `${prefix}_cy` },
    version: '1.0',
    createdAt: new Date().toISOString(),
    modifiedAt: new Date().toISOString(),
  };
}
```

- [ ] **Step 2: Commit**

```bash
git add src/engine/component/IFCProfileMapper.ts
git commit -m "feat(component): add IFC profile mapper with 10 profile type schemas"
```

---

## Task 6: Component State Slice

**Files:**
- Create: `src/state/slices/componentSlice.ts`

- [ ] **Step 1: Create the component state slice**

```typescript
// src/state/slices/componentSlice.ts
import type { ComponentDefinition, ComponentInstanceShape, RepresentationContext } from '../../types/component';

export interface ComponentEditorState {
  isActive: boolean;
  editingDefinitionId: string | null;
  editingInstanceId: string | null;
}

export interface ComponentState {
  componentDefinitions: ComponentDefinition[];
  componentEditor: ComponentEditorState;
  componentLibraryOpen: boolean;
  activeRepresentationContext: RepresentationContext;
}

export interface ComponentActions {
  // Definitions
  addComponentDefinition: (def: ComponentDefinition) => void;
  updateComponentDefinition: (id: string, updates: Partial<ComponentDefinition>) => void;
  removeComponentDefinition: (id: string) => void;
  getComponentDefinition: (id: string) => ComponentDefinition | undefined;

  // Editor
  enterComponentEditor: (definitionId: string, instanceId?: string) => void;
  exitComponentEditor: () => void;

  // Library
  setComponentLibraryOpen: (open: boolean) => void;
  toggleComponentLibrary: () => void;

  // Representation
  setActiveRepresentationContext: (context: RepresentationContext) => void;
}

export type ComponentSlice = ComponentState & ComponentActions;

export function createComponentSlice(set: any, get: any): ComponentSlice {
  return {
    componentDefinitions: [],
    componentEditor: {
      isActive: false,
      editingDefinitionId: null,
      editingInstanceId: null,
    },
    componentLibraryOpen: false,
    activeRepresentationContext: 'plan',

    addComponentDefinition: (def) => {
      set((state: any) => ({
        componentDefinitions: [...state.componentDefinitions, def],
      }));
    },

    updateComponentDefinition: (id, updates) => {
      set((state: any) => ({
        componentDefinitions: state.componentDefinitions.map((d: ComponentDefinition) =>
          d.id === id ? { ...d, ...updates, modifiedAt: new Date().toISOString() } : d
        ),
      }));
    },

    removeComponentDefinition: (id) => {
      set((state: any) => ({
        componentDefinitions: state.componentDefinitions.filter((d: ComponentDefinition) => d.id !== id),
      }));
    },

    getComponentDefinition: (id) => {
      return get().componentDefinitions.find((d: ComponentDefinition) => d.id === id);
    },

    enterComponentEditor: (definitionId, instanceId) => {
      set({
        componentEditor: {
          isActive: true,
          editingDefinitionId: definitionId,
          editingInstanceId: instanceId || null,
        },
      });
    },

    exitComponentEditor: () => {
      set({
        componentEditor: {
          isActive: false,
          editingDefinitionId: null,
          editingInstanceId: null,
        },
      });
    },

    setComponentLibraryOpen: (open) => set({ componentLibraryOpen: open }),
    toggleComponentLibrary: () => set((s: any) => ({ componentLibraryOpen: !s.componentLibraryOpen })),
    setActiveRepresentationContext: (context) => set({ activeRepresentationContext: context }),
  };
}
```

- [ ] **Step 2: Commit**

```bash
git add src/state/slices/componentSlice.ts
git commit -m "feat(component): add component state slice for definitions, editor, library"
```

---

## Task 7: Component Library Panel UI

**Files:**
- Create: `src/components/panels/ComponentLibraryPanel.tsx`

- [ ] **Step 1: Implement the library panel**

```typescript
// src/components/panels/ComponentLibraryPanel.tsx
import React, { useState, useMemo } from 'react';
import type { ComponentDefinition, ComponentCategory } from '../../types/component';

interface ComponentLibraryPanelProps {
  definitions: ComponentDefinition[];
  onSelect: (defId: string) => void;
  onNew: () => void;
  onImport: () => void;
  onExport: (defId: string) => void;
  onEdit: (defId: string) => void;
}

const CATEGORY_LABELS: Record<ComponentCategory, string> = {
  'structural-steel': 'Structural Steel',
  'structural-concrete': 'Concrete',
  'structural-timber': 'Timber',
  'reinforcement': 'Reinforcement',
  'foundation': 'Foundation',
  'architectural': 'Architectural',
  'MEP': 'MEP',
  'detail': 'Detail',
  'annotation': 'Annotation',
  'custom': 'Custom',
};

export const ComponentLibraryPanel: React.FC<ComponentLibraryPanelProps> = ({
  definitions,
  onSelect,
  onNew,
  onImport,
  onExport,
  onEdit,
}) => {
  const [search, setSearch] = useState('');
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set(['structural-steel', 'custom']));

  const filtered = useMemo(() => {
    if (!search) return definitions;
    const lower = search.toLowerCase();
    return definitions.filter(d =>
      d.name.toLowerCase().includes(lower) ||
      d.category.toLowerCase().includes(lower) ||
      d.tags?.some(t => t.toLowerCase().includes(lower))
    );
  }, [definitions, search]);

  const grouped = useMemo(() => {
    const groups = new Map<ComponentCategory, ComponentDefinition[]>();
    for (const def of filtered) {
      if (!groups.has(def.category)) groups.set(def.category, []);
      groups.get(def.category)!.push(def);
    }
    return groups;
  }, [filtered]);

  const toggleCategory = (cat: string) => {
    setExpandedCategories(prev => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat); else next.add(cat);
      return next;
    });
  };

  return (
    <div style={{ fontSize: 13, height: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* Header */}
      <div style={{ padding: '6px 8px', borderBottom: '1px solid #374151', display: 'flex', gap: 4 }}>
        <button
          onClick={onNew}
          style={{ flex: 1, background: '#2563eb', color: '#fff', border: 'none', borderRadius: 4, padding: '4px 8px', cursor: 'pointer', fontSize: 12 }}
        >
          + New Component
        </button>
        <button
          onClick={onImport}
          style={{ background: '#374151', color: '#d1d5db', border: 'none', borderRadius: 4, padding: '4px 8px', cursor: 'pointer', fontSize: 12 }}
        >
          Import
        </button>
      </div>

      {/* Search */}
      <div style={{ padding: '4px 8px' }}>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search components..."
          style={{
            width: '100%', background: '#111827', color: '#e5e7eb',
            border: '1px solid #374151', borderRadius: 4,
            padding: '3px 6px', fontSize: 12,
          }}
        />
      </div>

      {/* List */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {Array.from(grouped.entries()).map(([category, defs]) => (
          <div key={category}>
            <div
              onClick={() => toggleCategory(category)}
              style={{
                padding: '4px 8px', fontSize: 11, color: '#9ca3af',
                textTransform: 'uppercase', letterSpacing: '0.5px',
                background: '#0f172a', cursor: 'pointer',
                display: 'flex', justifyContent: 'space-between',
              }}
            >
              <span>{CATEGORY_LABELS[category] || category}</span>
              <span>{expandedCategories.has(category) ? '▾' : '▸'}</span>
            </div>

            {expandedCategories.has(category) && defs.map(def => (
              <div
                key={def.id}
                onClick={() => onSelect(def.id)}
                onDoubleClick={() => onEdit(def.id)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  onExport(def.id);
                }}
                style={{
                  padding: '4px 8px 4px 16px',
                  cursor: 'pointer',
                  display: 'flex', justifyContent: 'space-between',
                  alignItems: 'center',
                }}
                title={`Click to place, double-click to edit, right-click to export\n${def.description || ''}`}
              >
                <span style={{ color: '#d1d5db', fontSize: 12 }}>{def.name}</span>
                <span style={{ color: '#6b7280', fontSize: 10 }}>
                  {def.parameters.length}p
                </span>
              </div>
            ))}
          </div>
        ))}

        {grouped.size === 0 && (
          <div style={{ padding: 16, color: '#6b7280', textAlign: 'center', fontSize: 12 }}>
            {search ? 'No components found' : 'No components yet'}
          </div>
        )}
      </div>
    </div>
  );
};
```

- [ ] **Step 2: Commit**

```bash
git add src/components/panels/ComponentLibraryPanel.tsx
git commit -m "feat(component): add component library panel UI"
```

---

## Task 8: Component Editor Overlay UI

**Files:**
- Create: `src/components/panels/ComponentEditorOverlay.tsx`

- [ ] **Step 1: Implement the editor overlay**

```typescript
// src/components/panels/ComponentEditorOverlay.tsx
import React from 'react';

interface ComponentEditorOverlayProps {
  isActive: boolean;
  componentName: string;
  onClose: () => void;
}

export const ComponentEditorOverlay: React.FC<ComponentEditorOverlayProps> = ({
  isActive,
  componentName,
  onClose,
}) => {
  if (!isActive) return null;

  return (
    <>
      {/* Dimming overlay — covers entire canvas behind the component */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background: 'rgba(0, 0, 0, 0.5)',
          pointerEvents: 'none',
          zIndex: 50,
        }}
      />

      {/* Toolbar */}
      <div
        style={{
          position: 'absolute',
          top: 8,
          left: '50%',
          transform: 'translateX(-50%)',
          background: '#1e293b',
          border: '1px solid #475569',
          borderRadius: 8,
          padding: '6px 16px',
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          zIndex: 51,
          boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
        }}
      >
        <span style={{ color: '#60a5fa', fontSize: 13, fontWeight: 600 }}>
          Editing: {componentName}
        </span>

        <div style={{ width: 1, height: 20, background: '#475569' }} />

        <span style={{ color: '#9ca3af', fontSize: 11 }}>
          ESC to close
        </span>

        <button
          onClick={onClose}
          style={{
            background: '#dc2626',
            color: '#fff',
            border: 'none',
            borderRadius: 4,
            padding: '3px 12px',
            cursor: 'pointer',
            fontSize: 12,
            fontWeight: 500,
          }}
        >
          Close Editor
        </button>
      </div>
    </>
  );
};
```

- [ ] **Step 2: Commit**

```bash
git add src/components/panels/ComponentEditorOverlay.tsx
git commit -m "feat(component): add component editor overlay UI with dimming"
```

---

## Task 9: AEC Extension Registration

**Files:**
- Create: `(AEC ext) src/componentRegistrations.ts`
- Modify: `(AEC ext) src/index.tsx`
- Modify: `(AEC ext) src/ribbonTabs.tsx`

- [ ] **Step 1: Create component registrations for AEC extension**

Read the AEC extension at `C:\Users\rickd\Documents\GitHub\open-2D-studio-AEC-extension\src\index.tsx` to understand the registration pattern, then create `componentRegistrations.ts` that registers:

1. Bounds handler for `'component-instance'` shape type
2. Renderer for `'component-instance'`
3. Preview renderer for `'component-instance'`
4. Snap points provider for `'component-instance'`
5. Grip handler for `'component-instance'`

The renderer should use the `flattenedGeometry` cache from the ComponentInstanceShape and render each cached shape. The bounds handler should use the cached `flattenedGeometry.bounds`.

- [ ] **Step 2: Add component ribbon buttons to AEC extension**

In `ribbonTabs.tsx`, add a "Components" group with "New Component" and "Component Library" buttons.

- [ ] **Step 3: Wire into extension entry point**

In `index.tsx`, import and call `registerComponentSystem()` / `unregisterComponentSystem()`.

- [ ] **Step 4: Commit**

```bash
cd C:/Users/rickd/Documents/GitHub/open-2D-studio-AEC-extension
git add src/componentRegistrations.ts src/index.tsx src/ribbonTabs.tsx
git commit -m "feat(component): register component-instance shape type in AEC extension"
```

---

## Task 10: Full Integration Test

**Files:** None (verification only)

- [ ] **Step 1: Run full test suite**

Run: `cd C:/Users/rickd/Documents/GitHub/open-2d-studio && npx vitest run`
Expected: ALL PASS (existing + new component tests)

- [ ] **Step 2: Run TypeScript compiler check**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Verify build**

Run: `npm run build`
Expected: Build succeeds

- [ ] **Step 4: Commit any fixes**

If needed:
```bash
git add -A
git commit -m "fix(component): resolve integration issues"
```

---

## Summary

| Task | Component | Key Files |
|---|---|---|
| 1 | Type definitions | `src/types/component.ts` |
| 2 | Component Flattener | `src/engine/component/ComponentFlattener.ts` + tests |
| 3 | Array Resolver | `src/engine/component/ComponentArrayResolver.ts` + tests |
| 4 | Nesting Resolver | `src/engine/component/ComponentNestingResolver.ts` + tests |
| 5 | IFC Profile Mapper | `src/engine/component/IFCProfileMapper.ts` |
| 6 | Component State Slice | `src/state/slices/componentSlice.ts` |
| 7 | Component Library Panel | `src/components/panels/ComponentLibraryPanel.tsx` |
| 8 | Component Editor Overlay | `src/components/panels/ComponentEditorOverlay.tsx` |
| 9 | AEC Extension Registration | `(AEC ext) src/componentRegistrations.ts` |
| 10 | Full Integration Test | Verification only |
