/**
 * Shape Export - SVG and DXF export functions
 */

import type { Shape, PolylineShape, ImageShape } from '../../types/geometry';
import type { UnitSettings } from '../../units/types';
import { splineToSvgPath } from '../../engine/geometry/SplineUtils';
import { bulgeToArc, bulgeArcBounds } from '../../engine/geometry/GeometryUtils';

/**
 * Export shapes to SVG format
 */
export function exportToSVG(shapes: Shape[], width: number = 800, height: number = 600): string {
  // Calculate bounds
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

  for (const shape of shapes) {
    const bounds = getShapeBounds(shape);
    if (bounds) {
      minX = Math.min(minX, bounds.minX);
      minY = Math.min(minY, bounds.minY);
      maxX = Math.max(maxX, bounds.maxX);
      maxY = Math.max(maxY, bounds.maxY);
    }
  }

  // Add padding
  const padding = 20;
  minX -= padding;
  minY -= padding;
  maxX += padding;
  maxY += padding;

  const viewBox = `${minX} ${minY} ${maxX - minX} ${maxY - minY}`;

  let svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" width="${width}" height="${height}">
  <style>
    .shape { fill: none; stroke-linecap: round; stroke-linejoin: round; }
  </style>
`;

  for (const shape of shapes) {
    svg += shapeToSVG(shape);
  }

  svg += '</svg>';
  return svg;
}

/**
 * Convert a shape to SVG element
 */
function shapeToSVG(shape: Shape): string {
  const { style } = shape;
  const stroke = style.strokeColor;
  const strokeWidth = style.strokeWidth;
  const fill = style.fillColor || 'none';
  const dashArray = style.lineStyle === 'dashed' ? '10,5' :
                    style.lineStyle === 'dotted' ? '2,3' :
                    style.lineStyle === 'dashdot' ? '10,3,2,3' : '';

  const baseAttrs = `class="shape" stroke="${stroke}" stroke-width="${strokeWidth}" fill="${fill}"${dashArray ? ` stroke-dasharray="${dashArray}"` : ''}`;

  switch (shape.type) {
    case 'line':
      return `  <line ${baseAttrs} x1="${shape.start.x}" y1="${shape.start.y}" x2="${shape.end.x}" y2="${shape.end.y}" />\n`;

    case 'rectangle':
      return `  <rect ${baseAttrs} x="${shape.topLeft.x}" y="${shape.topLeft.y}" width="${shape.width}" height="${shape.height}"${shape.rotation ? ` transform="rotate(${shape.rotation * 180 / Math.PI} ${shape.topLeft.x + shape.width/2} ${shape.topLeft.y + shape.height/2})"` : ''} />\n`;

    case 'circle':
      return `  <circle ${baseAttrs} cx="${shape.center.x}" cy="${shape.center.y}" r="${shape.radius}" />\n`;

    case 'ellipse':
      return `  <ellipse ${baseAttrs} cx="${shape.center.x}" cy="${shape.center.y}" rx="${shape.radiusX}" ry="${shape.radiusY}"${shape.rotation ? ` transform="rotate(${shape.rotation * 180 / Math.PI} ${shape.center.x} ${shape.center.y})"` : ''} />\n`;

    case 'arc':
      const startX = shape.center.x + shape.radius * Math.cos(shape.startAngle);
      const startY = shape.center.y + shape.radius * Math.sin(shape.startAngle);
      const endX = shape.center.x + shape.radius * Math.cos(shape.endAngle);
      const endY = shape.center.y + shape.radius * Math.sin(shape.endAngle);
      const largeArc = Math.abs(shape.endAngle - shape.startAngle) > Math.PI ? 1 : 0;
      return `  <path ${baseAttrs} d="M ${startX} ${startY} A ${shape.radius} ${shape.radius} 0 ${largeArc} 1 ${endX} ${endY}" />\n`;

    case 'polyline': {
      const polyShape = shape as PolylineShape;
      const hasBulge = polyShape.bulge?.some(b => b !== 0);
      if (hasBulge) {
        let d = `M ${polyShape.points[0].x} ${polyShape.points[0].y}`;
        for (let idx = 0; idx < polyShape.points.length - 1; idx++) {
          const b = polyShape.bulge?.[idx] ?? 0;
          if (b !== 0) {
            const arc = bulgeToArc(polyShape.points[idx], polyShape.points[idx + 1], b);
            let sweep = arc.clockwise
              ? arc.startAngle - arc.endAngle
              : arc.endAngle - arc.startAngle;
            if (sweep < 0) sweep += 2 * Math.PI;
            const largeArc = sweep > Math.PI ? 1 : 0;
            const sweepFlag = arc.clockwise ? 0 : 1;
            const p2 = polyShape.points[idx + 1];
            d += ` A ${arc.radius} ${arc.radius} 0 ${largeArc} ${sweepFlag} ${p2.x} ${p2.y}`;
          } else {
            d += ` L ${polyShape.points[idx + 1].x} ${polyShape.points[idx + 1].y}`;
          }
        }
        if (polyShape.closed) {
          const closingB = polyShape.bulge?.[polyShape.points.length - 1] ?? 0;
          if (closingB !== 0) {
            const arc = bulgeToArc(polyShape.points[polyShape.points.length - 1], polyShape.points[0], closingB);
            let sweep = arc.clockwise
              ? arc.startAngle - arc.endAngle
              : arc.endAngle - arc.startAngle;
            if (sweep < 0) sweep += 2 * Math.PI;
            const largeArc = sweep > Math.PI ? 1 : 0;
            const sweepFlag = arc.clockwise ? 0 : 1;
            d += ` A ${arc.radius} ${arc.radius} 0 ${largeArc} ${sweepFlag} ${polyShape.points[0].x} ${polyShape.points[0].y}`;
          }
          d += ' Z';
        }
        return `  <path ${baseAttrs} d="${d}" />\n`;
      }
      const points = polyShape.points.map(p => `${p.x},${p.y}`).join(' ');
      if (polyShape.closed) {
        return `  <polygon ${baseAttrs} points="${points}" />\n`;
      }
      return `  <polyline ${baseAttrs} points="${points}" />\n`;
    }

    case 'spline':
      if (shape.points.length < 2) return '';
      return `  <path ${baseAttrs} d="${splineToSvgPath(shape.points)}${shape.closed ? ' Z' : ''}" />\n`;

    case 'image': {
      const imgShape = shape as ImageShape;
      const cx = imgShape.position.x + imgShape.width / 2;
      const cy = imgShape.position.y + imgShape.height / 2;
      const rotDeg = (imgShape.rotation || 0) * 180 / Math.PI;
      const transform = rotDeg ? ` transform="rotate(${rotDeg} ${cx} ${cy})"` : '';
      const opacity = imgShape.opacity !== undefined && imgShape.opacity < 1 ? ` opacity="${imgShape.opacity}"` : '';
      return `  <image href="${imgShape.imageData}" x="${imgShape.position.x}" y="${imgShape.position.y}" width="${imgShape.width}" height="${imgShape.height}"${transform}${opacity} />\n`;
    }

    default:
      return '';
  }
}

/**
 * Export shapes to DXF format (basic implementation)
 */
export function exportToDXF(shapes: Shape[], unitSettings?: UnitSettings): string {
  // Map length unit to DXF $INSUNITS value
  const insUnitsMap: Record<string, number> = {
    'mm': 4, 'cm': 5, 'm': 6, 'in': 1, 'ft': 2, 'ft-in': 2,
  };
  const insUnits = unitSettings ? (insUnitsMap[unitSettings.lengthUnit] ?? 4) : 4;

  let dxf = `0
SECTION
2
HEADER
9
$INSUNITS
70
${insUnits}
0
ENDSEC
0
SECTION
2
ENTITIES
`;

  for (const shape of shapes) {
    dxf += shapeToDXF(shape);
  }

  dxf += `0
ENDSEC
0
EOF
`;
  return dxf;
}

/**
 * Convert a shape to DXF entity
 */
function shapeToDXF(shape: Shape): string {
  switch (shape.type) {
    case 'line':
      return `0
LINE
8
0
10
${shape.start.x}
20
${-shape.start.y}
11
${shape.end.x}
21
${-shape.end.y}
`;

    case 'circle':
      return `0
CIRCLE
8
0
10
${shape.center.x}
20
${-shape.center.y}
40
${shape.radius}
`;

    case 'arc':
      // Swap and negate angles because Y is flipped
      return `0
ARC
8
0
10
${shape.center.x}
20
${-shape.center.y}
40
${shape.radius}
50
${-shape.endAngle * 180 / Math.PI}
51
${-shape.startAngle * 180 / Math.PI}
`;

    case 'ellipse': {
      // DXF ELLIPSE uses major axis endpoint relative to center
      const majorLength = shape.radiusX;
      const rotation = shape.rotation || 0;
      const majorX = majorLength * Math.cos(-rotation);
      const majorY = majorLength * Math.sin(-rotation);
      const ratio = shape.radiusY / shape.radiusX;
      // Start/end params (0 to 2*PI for full ellipse)
      const startParam = shape.startAngle !== undefined ? -shape.endAngle! : 0;
      const endParam = shape.endAngle !== undefined ? -shape.startAngle! : 2 * Math.PI;
      return `0
ELLIPSE
8
0
10
${shape.center.x}
20
${-shape.center.y}
30
0
11
${majorX}
21
${majorY}
31
0
40
${ratio}
41
${startParam}
42
${endParam}
`;
    }

    case 'polyline': {
      const polyShape = shape as PolylineShape;
      let result = `0
LWPOLYLINE
8
0
90
${polyShape.points.length}
70
${polyShape.closed ? 1 : 0}
`;
      for (let idx = 0; idx < polyShape.points.length; idx++) {
        const pt = polyShape.points[idx];
        result += `10
${pt.x}
20
${-pt.y}
`;
        const b = polyShape.bulge?.[idx] ?? 0;
        if (b !== 0) {
          result += `42
${-b}
`;
        }
      }
      return result;
    }

    case 'spline': {
      // Export spline as SPLINE entity with control points
      const flags = shape.closed ? 11 : 8; // 8 = planar, 1 = closed, 2 = periodic
      let result = `0
SPLINE
8
0
70
${flags}
71
3
`;
      // Add control points
      for (const point of shape.points) {
        result += `10
${point.x}
20
${-point.y}
30
0
`;
      }
      return result;
    }

    case 'text': {
      const rotationDeg = -(shape.rotation || 0) * 180 / Math.PI;
      return `0
TEXT
8
0
10
${shape.position.x}
20
${-shape.position.y}
30
0
40
${shape.fontSize}
1
${shape.text}
50
${rotationDeg}
`;
    }

    case 'point':
      return `0
POINT
8
0
10
${shape.position.x}
20
${-shape.position.y}
30
0
`;

    case 'rectangle': {
      // Export rectangle as LWPOLYLINE (4 corner points, closed)
      const { topLeft, width, height, rotation } = shape;
      const corners = [
        { x: topLeft.x, y: topLeft.y },
        { x: topLeft.x + width, y: topLeft.y },
        { x: topLeft.x + width, y: topLeft.y + height },
        { x: topLeft.x, y: topLeft.y + height },
      ];
      // Apply rotation if present
      if (rotation) {
        const cx = topLeft.x + width / 2;
        const cy = topLeft.y + height / 2;
        const cos = Math.cos(rotation);
        const sin = Math.sin(rotation);
        for (const corner of corners) {
          const dx = corner.x - cx;
          const dy = corner.y - cy;
          corner.x = cx + dx * cos - dy * sin;
          corner.y = cy + dx * sin + dy * cos;
        }
      }
      let result = `0
LWPOLYLINE
8
0
90
4
70
1
`;
      for (const pt of corners) {
        result += `10
${pt.x}
20
${-pt.y}
`;
      }
      return result;
    }

    default:
      return '';
  }
}

/**
 * Get shape bounds
 */
function getShapeBounds(shape: Shape): { minX: number; minY: number; maxX: number; maxY: number } | null {
  switch (shape.type) {
    case 'line':
      return {
        minX: Math.min(shape.start.x, shape.end.x),
        minY: Math.min(shape.start.y, shape.end.y),
        maxX: Math.max(shape.start.x, shape.end.x),
        maxY: Math.max(shape.start.y, shape.end.y),
      };
    case 'rectangle':
      return {
        minX: shape.topLeft.x,
        minY: shape.topLeft.y,
        maxX: shape.topLeft.x + shape.width,
        maxY: shape.topLeft.y + shape.height,
      };
    case 'circle':
      return {
        minX: shape.center.x - shape.radius,
        minY: shape.center.y - shape.radius,
        maxX: shape.center.x + shape.radius,
        maxY: shape.center.y + shape.radius,
      };
    case 'ellipse':
      return {
        minX: shape.center.x - shape.radiusX,
        minY: shape.center.y - shape.radiusY,
        maxX: shape.center.x + shape.radiusX,
        maxY: shape.center.y + shape.radiusY,
      };
    case 'polyline': {
      if (shape.points.length === 0) return null;
      let pMinX = Infinity, pMinY = Infinity, pMaxX = -Infinity, pMaxY = -Infinity;
      for (const p of shape.points) {
        if (p.x < pMinX) pMinX = p.x;
        if (p.y < pMinY) pMinY = p.y;
        if (p.x > pMaxX) pMaxX = p.x;
        if (p.y > pMaxY) pMaxY = p.y;
      }
      if (shape.bulge) {
        for (let idx = 0; idx < shape.points.length - 1; idx++) {
          const b = shape.bulge[idx] ?? 0;
          if (b !== 0) {
            const ab = bulgeArcBounds(shape.points[idx], shape.points[idx + 1], b);
            if (ab.minX < pMinX) pMinX = ab.minX;
            if (ab.minY < pMinY) pMinY = ab.minY;
            if (ab.maxX > pMaxX) pMaxX = ab.maxX;
            if (ab.maxY > pMaxY) pMaxY = ab.maxY;
          }
        }
      }
      return { minX: pMinX, minY: pMinY, maxX: pMaxX, maxY: pMaxY };
    }
    case 'spline':
      if (shape.points.length === 0) return null;
      const xs = shape.points.map(p => p.x);
      const ys = shape.points.map(p => p.y);
      return {
        minX: Math.min(...xs),
        minY: Math.min(...ys),
        maxX: Math.max(...xs),
        maxY: Math.max(...ys),
      };
    case 'image':
      return {
        minX: shape.position.x,
        minY: shape.position.y,
        maxX: shape.position.x + shape.width,
        maxY: shape.position.y + shape.height,
      };
    default:
      return null;
  }
}
