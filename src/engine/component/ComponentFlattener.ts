import type { Point, Shape, BoundingBox } from '../../types/geometry';
import type {
  ComponentRepresentation,
  ComponentGeometryElement,
  FlattenedComponentGeometry,
  ParametricLineDef,
  ParametricCircleDef,
  ParametricArcDef,
  ParametricRectangleDef,
  ParametricPolylineDef,
  ParametricTextDef,
} from '../../types/component';

// ── Transform helpers ────────────────────────────────────────

function transformPoint(
  x: number,
  y: number,
  position: Point,
  rotation: number,
  scale: number,
): Point {
  // Apply scale first, then rotation, then translation
  const scaledX = x * scale;
  const scaledY = y * scale;

  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);

  return {
    x: position.x + scaledX * cos - scaledY * sin,
    y: position.y + scaledX * sin + scaledY * cos,
  };
}

// ── Param resolution helpers ─────────────────────────────────

function resolveNumber(
  paramId: string,
  paramValues: Map<string, number | boolean | string>,
): number {
  const val = paramValues.get(paramId);
  if (typeof val === 'number') return val;
  if (typeof val === 'string') {
    const parsed = parseFloat(val);
    if (!isNaN(parsed)) return parsed;
  }
  return 0;
}

function resolveBoolean(
  paramId: string,
  paramValues: Map<string, number | boolean | string>,
): boolean {
  const val = paramValues.get(paramId);
  if (typeof val === 'boolean') return val;
  if (typeof val === 'number') return val !== 0;
  if (typeof val === 'string') return val === 'true' || val === '1';
  return true; // default visible
}

// ── Text interpolation ───────────────────────────────────────

function interpolateText(
  template: string,
  paramNames: Map<string, number | boolean | string>,
): string {
  return template.replace(/\{([^}]+)\}/g, (_match, key: string) => {
    const val = paramNames.get(key);
    if (val === undefined) return `{${key}}`;
    return String(val);
  });
}

// ── Bounding box helpers ─────────────────────────────────────

function emptyBounds(): BoundingBox {
  return { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
}

function expandBounds(bounds: BoundingBox, x: number, y: number): void {
  if (x < bounds.minX) bounds.minX = x;
  if (x > bounds.maxX) bounds.maxX = x;
  if (y < bounds.minY) bounds.minY = y;
  if (y > bounds.maxY) bounds.maxY = y;
}

function expandBoundsWithPoint(bounds: BoundingBox, p: Point): void {
  expandBounds(bounds, p.x, p.y);
}

function expandBoundsWithCircle(bounds: BoundingBox, center: Point, radius: number): void {
  expandBounds(bounds, center.x - radius, center.y - radius);
  expandBounds(bounds, center.x + radius, center.y + radius);
}

function mergeBounds(target: BoundingBox, source: BoundingBox): void {
  if (source.minX < target.minX) target.minX = source.minX;
  if (source.minY < target.minY) target.minY = source.minY;
  if (source.maxX > target.maxX) target.maxX = source.maxX;
  if (source.maxY > target.maxY) target.maxY = source.maxY;
}

function normalizeBounds(bounds: BoundingBox): BoundingBox {
  if (!isFinite(bounds.minX)) return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  return bounds;
}

// ── Default shape base ───────────────────────────────────────

function makeBase(element: ComponentGeometryElement) {
  return {
    id: crypto.randomUUID(),
    layerId: '',
    drawingId: '',
    style: element.style,
    visible: true,
    locked: false,
  };
}

// ── Per-geometry-kind flatteners ─────────────────────────────

function flattenLine(
  element: ComponentGeometryElement,
  paramValues: Map<string, number | boolean | string>,
  position: Point,
  rotation: number,
  scale: number,
): { shape: Shape; bounds: BoundingBox } | null {
  const def = element.geometry as ParametricLineDef;
  const startX = resolveNumber(def.startXParamId, paramValues);
  const startY = resolveNumber(def.startYParamId, paramValues);
  const endX = resolveNumber(def.endXParamId, paramValues);
  const endY = resolveNumber(def.endYParamId, paramValues);

  const start = transformPoint(startX, startY, position, rotation, scale);
  const end = transformPoint(endX, endY, position, rotation, scale);

  const bounds = emptyBounds();
  expandBoundsWithPoint(bounds, start);
  expandBoundsWithPoint(bounds, end);

  const shape: Shape = {
    ...makeBase(element),
    type: 'line',
    start,
    end,
  } as Shape;

  return { shape, bounds };
}

function flattenCircle(
  element: ComponentGeometryElement,
  paramValues: Map<string, number | boolean | string>,
  position: Point,
  rotation: number,
  scale: number,
): { shape: Shape; bounds: BoundingBox } | null {
  const def = element.geometry as ParametricCircleDef;
  const cx = resolveNumber(def.centerXParamId, paramValues);
  const cy = resolveNumber(def.centerYParamId, paramValues);
  const radius = resolveNumber(def.radiusParamId, paramValues) * scale;

  const center = transformPoint(cx, cy, position, rotation, scale);

  const bounds = emptyBounds();
  expandBoundsWithCircle(bounds, center, radius);

  const shape: Shape = {
    ...makeBase(element),
    type: 'circle',
    center,
    radius,
  } as Shape;

  return { shape, bounds };
}

function flattenArc(
  element: ComponentGeometryElement,
  paramValues: Map<string, number | boolean | string>,
  position: Point,
  rotation: number,
  scale: number,
): { shape: Shape; bounds: BoundingBox } | null {
  const def = element.geometry as ParametricArcDef;
  const cx = resolveNumber(def.centerXParamId, paramValues);
  const cy = resolveNumber(def.centerYParamId, paramValues);
  const radius = resolveNumber(def.radiusParamId, paramValues) * scale;
  const startAngle = resolveNumber(def.startAngleParamId, paramValues) + rotation;
  const endAngle = resolveNumber(def.endAngleParamId, paramValues) + rotation;

  const center = transformPoint(cx, cy, position, rotation, scale);

  // Approximate bounds using arc endpoints and potential axis crossings
  const bounds = emptyBounds();
  expandBoundsWithPoint(bounds, {
    x: center.x + radius * Math.cos(startAngle),
    y: center.y + radius * Math.sin(startAngle),
  });
  expandBoundsWithPoint(bounds, {
    x: center.x + radius * Math.cos(endAngle),
    y: center.y + radius * Math.sin(endAngle),
  });
  // Check axis crossings
  for (const angle of [0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2]) {
    let a = angle;
    // Normalize start/end angles and check if this axis angle lies in the arc span
    let sa = startAngle % (2 * Math.PI);
    let ea = endAngle % (2 * Math.PI);
    if (sa < 0) sa += 2 * Math.PI;
    if (ea < 0) ea += 2 * Math.PI;
    const inArc = sa <= ea ? a >= sa && a <= ea : a >= sa || a <= ea;
    if (inArc) {
      expandBoundsWithPoint(bounds, {
        x: center.x + radius * Math.cos(a),
        y: center.y + radius * Math.sin(a),
      });
    }
  }

  const shape: Shape = {
    ...makeBase(element),
    type: 'arc',
    center,
    radius,
    startAngle,
    endAngle,
  } as Shape;

  return { shape, bounds };
}

function flattenRectangle(
  element: ComponentGeometryElement,
  paramValues: Map<string, number | boolean | string>,
  position: Point,
  rotation: number,
  scale: number,
): { shape: Shape; bounds: BoundingBox } | null {
  const def = element.geometry as ParametricRectangleDef;
  const x1 = resolveNumber(def.x1ParamId, paramValues);
  const y1 = resolveNumber(def.y1ParamId, paramValues);
  const width = resolveNumber(def.widthParamId, paramValues);
  const height = resolveNumber(def.heightParamId, paramValues);

  // RectangleShape uses topLeft + width + height + rotation
  const topLeft = transformPoint(x1, y1, position, rotation, scale);
  const scaledWidth = width * scale;
  const scaledHeight = height * scale;

  // Compute bounds from all four corners (rotation may change the bounding box)
  const corners = [
    transformPoint(x1, y1, position, rotation, scale),
    transformPoint(x1 + width, y1, position, rotation, scale),
    transformPoint(x1 + width, y1 + height, position, rotation, scale),
    transformPoint(x1, y1 + height, position, rotation, scale),
  ];

  const bounds = emptyBounds();
  for (const c of corners) expandBoundsWithPoint(bounds, c);

  const shape: Shape = {
    ...makeBase(element),
    type: 'rectangle',
    topLeft,
    width: scaledWidth,
    height: scaledHeight,
    rotation,
  } as Shape;

  return { shape, bounds };
}

function flattenPolyline(
  element: ComponentGeometryElement,
  paramValues: Map<string, number | boolean | string>,
  position: Point,
  rotation: number,
  scale: number,
): { shape: Shape; bounds: BoundingBox } | null {
  const def = element.geometry as ParametricPolylineDef;

  const points: Point[] = def.vertexParamIds.map(({ xParamId, yParamId }) => {
    const x = resolveNumber(xParamId, paramValues);
    const y = resolveNumber(yParamId, paramValues);
    return transformPoint(x, y, position, rotation, scale);
  });

  const bounds = emptyBounds();
  for (const p of points) expandBoundsWithPoint(bounds, p);

  const shape: Shape = {
    ...makeBase(element),
    type: 'polyline',
    points,
    closed: def.closed ?? false,
  } as Shape;

  return { shape, bounds };
}

function flattenText(
  element: ComponentGeometryElement,
  paramValues: Map<string, number | boolean | string>,
  position: Point,
  rotation: number,
  scale: number,
  paramNames?: Map<string, number | boolean | string>,
): { shape: Shape; bounds: BoundingBox } | null {
  const def = element.geometry as ParametricTextDef;
  const x = resolveNumber(def.xParamId, paramValues);
  const y = resolveNumber(def.yParamId, paramValues);
  const fontSize = resolveNumber(def.heightParamId, paramValues) * scale;
  const textRotation = def.rotationParamId
    ? resolveNumber(def.rotationParamId, paramValues) + rotation
    : rotation;

  // Resolve text content from contentParamId, then interpolate template
  const rawText = String(paramValues.get(def.contentParamId) ?? '');
  const text = paramNames ? interpolateText(rawText, paramNames) : rawText;

  const textPosition = transformPoint(x, y, position, rotation, scale);

  const bounds = emptyBounds();
  // Approximate text bounds: use position as a single point
  expandBoundsWithPoint(bounds, textPosition);

  const shape: Shape = {
    ...makeBase(element),
    type: 'text',
    position: textPosition,
    text,
    fontSize,
    fontFamily: 'sans-serif',
    rotation: textRotation,
    alignment: 'left',
    verticalAlignment: 'bottom',
    bold: false,
    italic: false,
    underline: false,
    color: element.style.strokeColor ?? '#000000',
    lineHeight: 1.2,
  } as Shape;

  return { shape, bounds };
}

// ── Main export ──────────────────────────────────────────────

export function flattenGeometry(
  representation: ComponentRepresentation,
  paramValues: Map<string, number | boolean | string>,
  position: Point,
  rotation: number,
  scale: number,
  paramNames?: Map<string, number | boolean | string>,
): FlattenedComponentGeometry {
  const shapes: Shape[] = [];
  const totalBounds = emptyBounds();

  for (const element of representation.geometry) {
    // Visibility check
    if (element.visibleParamId !== undefined) {
      const visible = resolveBoolean(element.visibleParamId, paramValues);
      if (!visible) continue;
    }

    let result: { shape: Shape; bounds: BoundingBox } | null = null;

    switch (element.geometry.type) {
      case 'parametric-line':
        result = flattenLine(element, paramValues, position, rotation, scale);
        break;

      case 'parametric-circle':
        result = flattenCircle(element, paramValues, position, rotation, scale);
        break;

      case 'parametric-arc':
        result = flattenArc(element, paramValues, position, rotation, scale);
        break;

      case 'parametric-rectangle':
        result = flattenRectangle(element, paramValues, position, rotation, scale);
        break;

      case 'parametric-polyline':
        result = flattenPolyline(element, paramValues, position, rotation, scale);
        break;

      case 'parametric-text':
        result = flattenText(element, paramValues, position, rotation, scale, paramNames);
        break;

      case 'parametric-hatch':
      case 'parametric-dimension':
        // Future implementation — skip for now
        result = null;
        break;
    }

    if (result !== null) {
      shapes.push(result.shape);
      mergeBounds(totalBounds, result.bounds);
    }
  }

  return {
    shapes,
    bounds: normalizeBounds(totalBounds),
  };
}
