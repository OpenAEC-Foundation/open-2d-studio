/**
 * IFC4 Export Service
 *
 * Exports 2D shapes to IFC4 STEP file format (ISO 16739-1).
 * Shapes are represented as IfcAnnotation entities with 2D geometric
 * representations inside the standard spatial hierarchy:
 * IfcProject → IfcSite → IfcBuilding → IfcBuildingStorey
 */

import type { Shape, Layer } from '../types/geometry';
import type { CustomHatchPattern } from '../types/hatch';
import { isSvgHatchPattern } from '../types/hatch';

// ============================================================================
// IFC GUID Generation
// ============================================================================

/** Encode 128-bit UUID into 22-char IFC base64 GUID string */
function generateIfcGuid(): string {
  const base64 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_$';
  const uuid = crypto.randomUUID();
  const hex = uuid.replace(/-/g, '');
  const bytes: number[] = [];
  for (let i = 0; i < hex.length; i += 2) {
    bytes.push(parseInt(hex.substring(i, i + 2), 16));
  }

  let result = '';
  function encode(offset: number, len: number, nChars: number) {
    let val = 0;
    for (let i = 0; i < len; i++) val = val * 256 + bytes[offset + i];
    const r: string[] = [];
    for (let i = 0; i < nChars; i++) {
      r.unshift(base64[val % 64]);
      val = Math.floor(val / 64);
    }
    result += r.join('');
  }

  encode(0, 1, 2);
  encode(1, 3, 4);
  encode(4, 3, 4);
  encode(7, 3, 4);
  encode(10, 3, 4);
  encode(13, 3, 4);
  return result;
}

// ============================================================================
// IFC STEP Builder
// ============================================================================

/** Helper class to build IFC STEP entities with auto-incrementing IDs */
class IfcBuilder {
  private nextId = 1;
  private lines: string[] = [];

  add(entity: string): string {
    const id = `#${this.nextId++}`;
    this.lines.push(`${id}=${entity};`);
    return id;
  }

  point2d(x: number, y: number): string {
    return this.add(`IFCCARTESIANPOINT((${this.f(x)},${this.f(y)}))`);
  }

  direction2d(x: number, y: number): string {
    return this.add(`IFCDIRECTION((${this.f(x)},${this.f(y)}))`);
  }

  point3d(x: number, y: number, z: number): string {
    return this.add(`IFCCARTESIANPOINT((${this.f(x)},${this.f(y)},${this.f(z)}))`);
  }

  direction3d(x: number, y: number, z: number): string {
    return this.add(`IFCDIRECTION((${this.f(x)},${this.f(y)},${this.f(z)}))`);
  }

  axis2placement2d(origin: string, refDir: string): string {
    return this.add(`IFCAXIS2PLACEMENT2D(${origin},${refDir})`);
  }

  /** Format a float for IFC output (at least one decimal place) */
  f(n: number): string {
    const s = n.toFixed(6).replace(/0+$/, '');
    return s.endsWith('.') ? s + '0' : s;
  }

  toString(): string {
    return this.lines.join('\n');
  }
}

// ============================================================================
// Utilities
// ============================================================================

/** Parse hex color string to [r,g,b] in 0-1 range */
function hexToRgb01(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const r = parseInt(h.substring(0, 2), 16) / 255;
  const g = parseInt(h.substring(2, 4), 16) / 255;
  const bl = parseInt(h.substring(4, 6), 16) / 255;
  return [r, g, bl];
}

// ============================================================================
// Main Export Function
// ============================================================================

/**
 * Export shapes to IFC4 STEP format.
 *
 * Produces a valid IFC4 file with:
 * - Standard spatial hierarchy (Project/Site/Building/Storey)
 * - All 2D shapes as IfcAnnotation with appropriate geometry types
 * - Curve/text styling via IfcStyledItem
 * - Layer assignments via IfcPresentationLayerAssignment
 * - Custom hatch patterns with line families
 */
export function exportToIFC(shapes: Shape[], layers: Layer[], customPatterns?: CustomHatchPattern[]): string {
  const b = new IfcBuilder();
  const timestamp = new Date().toISOString().replace(/\.\d+Z$/, '');

  // --- Owner history ---
  const person = b.add(`IFCPERSON($,$,'',$,$,$,$,$)`);
  const org = b.add(`IFCORGANIZATION($,'Open 2D Studio',$,$,$)`);
  const personOrg = b.add(`IFCPERSONANDORGANIZATION(${person},${org},$)`);
  const app = b.add(`IFCAPPLICATION(${org},'1.0','Open 2D Studio','O2DS')`);
  const unixTime = Math.floor(Date.now() / 1000);
  const ownerHistory = b.add(`IFCOWNERHISTORY(${personOrg},${app},$,.NOCHANGE.,$,${personOrg},${app},${unixTime})`);

  // --- Units (millimetres for length, radians for angles) ---
  const lengthUnit = b.add(`IFCSIUNIT(*,.LENGTHUNIT.,.MILLI.,.METRE.)`);
  const areaUnit = b.add(`IFCSIUNIT(*,.AREAUNIT.,$,.SQUARE_METRE.)`);
  const angleUnit = b.add(`IFCSIUNIT(*,.PLANEANGLEUNIT.,$,.RADIAN.)`);
  const units = b.add(`IFCUNITASSIGNMENT((${lengthUnit},${areaUnit},${angleUnit}))`);

  // --- Coordinate systems ---
  const origin3d = b.point3d(0, 0, 0);
  const axisZ = b.direction3d(0, 0, 1);
  const axisX = b.direction3d(1, 0, 0);
  const placement3d = b.add(`IFCAXIS2PLACEMENT3D(${origin3d},${axisZ},${axisX})`);

  const origin2d = b.point2d(0, 0);
  const dirX2d = b.direction2d(1, 0);
  const placement2d = b.axis2placement2d(origin2d, dirX2d);

  // --- Geometric representation contexts ---
  const ctx3d = b.add(`IFCGEOMETRICREPRESENTATIONCONTEXT($,'Model',3,1.E-5,${placement3d},$)`);
  const ctx2d = b.add(`IFCGEOMETRICREPRESENTATIONCONTEXT($,'Plan',2,1.E-5,${placement2d},$)`);

  // --- Project ---
  const projectGuid = generateIfcGuid();
  const project = b.add(`IFCPROJECT('${projectGuid}',${ownerHistory},'2D Drawing',$,$,$,$,(${ctx3d},${ctx2d}),${units})`);

  // --- Spatial hierarchy ---
  const site = b.add(`IFCSITE('${generateIfcGuid()}',${ownerHistory},'Site',$,$,$,$,$,.ELEMENT.,$,$,$,$,$)`);
  const building = b.add(`IFCBUILDING('${generateIfcGuid()}',${ownerHistory},'Building',$,$,$,$,$,.ELEMENT.,$,$,$)`);
  const storey = b.add(`IFCBUILDINGSTOREY('${generateIfcGuid()}',${ownerHistory},'Level 0',$,$,$,$,$,.ELEMENT.,0.)`);

  b.add(`IFCRELAGGREGATES('${generateIfcGuid()}',${ownerHistory},$,$,${project},(${site}))`);
  b.add(`IFCRELAGGREGATES('${generateIfcGuid()}',${ownerHistory},$,$,${site},(${building}))`);
  b.add(`IFCRELAGGREGATES('${generateIfcGuid()}',${ownerHistory},$,$,${building},(${storey}))`);

  // --- Build layer lookup ---
  const layerMap = new Map<string, Layer>();
  for (const layer of layers) layerMap.set(layer.id, layer);

  // --- Color/style cache ---
  const colorCache = new Map<string, string>();
  function getOrCreateColor(hex: string): string {
    let id = colorCache.get(hex);
    if (!id) {
      const [r, g, bl] = hexToRgb01(hex);
      id = b.add(`IFCCOLOURRGB($,${b.f(r)},${b.f(g)},${b.f(bl)})`);
      colorCache.set(hex, id);
    }
    return id;
  }

  function createCurveStyle(shape: Shape): string {
    const color = getOrCreateColor(shape.style.strokeColor);
    const width = shape.style.strokeWidth;
    return b.add(`IFCCURVESTYLE($,$,IFCPOSITIVELENGTHMEASURE(${b.f(width)}),${color},$)`);
  }

  // --- Convert each shape to IFC entities ---
  const annotationIds: string[] = [];

  for (const shape of shapes) {
    if (!shape.visible) continue;

    const geomItems: string[] = [];

    switch (shape.type) {
      case 'line': {
        const p1 = b.point2d(shape.start.x, shape.start.y);
        const p2 = b.point2d(shape.end.x, shape.end.y);
        const polyline = b.add(`IFCPOLYLINE((${p1},${p2}))`);
        const style = createCurveStyle(shape);
        b.add(`IFCSTYLEDITEM(${polyline},(${style}),$)`);
        geomItems.push(polyline);
        break;
      }

      case 'rectangle': {
        const cx = shape.topLeft.x + shape.width / 2;
        const cy = shape.topLeft.y + shape.height / 2;
        const hw = shape.width / 2;
        const hh = shape.height / 2;
        const cos = Math.cos(shape.rotation || 0);
        const sin = Math.sin(shape.rotation || 0);
        const corners = [
          [-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]
        ].map(([lx, ly]) => [
          cx + lx * cos - ly * sin,
          cy + lx * sin + ly * cos,
        ]);
        const pts = corners.map(([x, y]) => b.point2d(x, y));
        const closePoint = b.point2d(corners[0][0], corners[0][1]);
        pts.push(closePoint);
        const polyline = b.add(`IFCPOLYLINE((${pts.join(',')}))`);
        const style = createCurveStyle(shape);
        b.add(`IFCSTYLEDITEM(${polyline},(${style}),$)`);
        geomItems.push(polyline);
        break;
      }

      case 'circle': {
        const center = b.point2d(shape.center.x, shape.center.y);
        const dir = b.direction2d(1, 0);
        const placement = b.axis2placement2d(center, dir);
        const circle = b.add(`IFCCIRCLE(${placement},${b.f(shape.radius)})`);
        const style = createCurveStyle(shape);
        b.add(`IFCSTYLEDITEM(${circle},(${style}),$)`);
        geomItems.push(circle);
        break;
      }

      case 'arc': {
        const center = b.point2d(shape.center.x, shape.center.y);
        const dir = b.direction2d(1, 0);
        const placement = b.axis2placement2d(center, dir);
        const basisCircle = b.add(`IFCCIRCLE(${placement},${b.f(shape.radius)})`);
        const trimmed = b.add(
          `IFCTRIMMEDCURVE(${basisCircle},(IFCPARAMETERVALUE(${b.f(shape.startAngle)})),(IFCPARAMETERVALUE(${b.f(shape.endAngle)})),.T.,.PARAMETER.)`
        );
        const style = createCurveStyle(shape);
        b.add(`IFCSTYLEDITEM(${trimmed},(${style}),$)`);
        geomItems.push(trimmed);
        break;
      }

      case 'ellipse': {
        const center = b.point2d(shape.center.x, shape.center.y);
        const cos = Math.cos(shape.rotation || 0);
        const sin = Math.sin(shape.rotation || 0);
        const dir = b.direction2d(cos, sin);
        const placement = b.axis2placement2d(center, dir);
        const semi1 = Math.max(shape.radiusX, shape.radiusY);
        const semi2 = Math.min(shape.radiusX, shape.radiusY);
        const ellipse = b.add(`IFCELLIPSE(${placement},${b.f(semi1)},${b.f(semi2)})`);

        if (shape.startAngle !== undefined && shape.endAngle !== undefined) {
          const trimmed = b.add(
            `IFCTRIMMEDCURVE(${ellipse},(IFCPARAMETERVALUE(${b.f(shape.startAngle)})),(IFCPARAMETERVALUE(${b.f(shape.endAngle)})),.T.,.PARAMETER.)`
          );
          const style = createCurveStyle(shape);
          b.add(`IFCSTYLEDITEM(${trimmed},(${style}),$)`);
          geomItems.push(trimmed);
        } else {
          const style = createCurveStyle(shape);
          b.add(`IFCSTYLEDITEM(${ellipse},(${style}),$)`);
          geomItems.push(ellipse);
        }
        break;
      }

      case 'polyline': {
        if (shape.points.length < 2) break;
        const pts = shape.points.map(p => b.point2d(p.x, p.y));
        if (shape.closed) {
          const closePoint = b.point2d(shape.points[0].x, shape.points[0].y);
          pts.push(closePoint);
        }
        const polyline = b.add(`IFCPOLYLINE((${pts.join(',')}))`);
        const style = createCurveStyle(shape);
        b.add(`IFCSTYLEDITEM(${polyline},(${style}),$)`);
        geomItems.push(polyline);
        break;
      }

      case 'spline': {
        if (shape.points.length < 2) break;
        const controlPts = shape.points.map(p => b.point2d(p.x, p.y));
        const n = shape.points.length;
        const degree = Math.min(3, n - 1);
        const knotMults: number[] = [];
        const knots: number[] = [];
        knotMults.push(degree + 1);
        const internalKnots = n - degree - 1;
        for (let i = 1; i <= internalKnots; i++) {
          knotMults.push(1);
        }
        knotMults.push(degree + 1);
        const totalSpans = knotMults.length - 1;
        for (let i = 0; i < knotMults.length; i++) {
          knots.push(i / totalSpans);
        }
        const closed = shape.closed ? '.T.' : '.F.';
        const spline = b.add(
          `IFCBSPLINECURVEWITHKNOTS(${degree},(${controlPts.join(',')}),.UNSPECIFIED.,${closed},.F.,(${knotMults.join(',')}),(${knots.map(k => b.f(k)).join(',')}),.UNSPECIFIED.)`
        );
        const style = createCurveStyle(shape);
        b.add(`IFCSTYLEDITEM(${spline},(${style}),$)`);
        geomItems.push(spline);
        break;
      }

      case 'text': {
        const pos = b.point2d(shape.position.x, shape.position.y);
        const cos = Math.cos(shape.rotation || 0);
        const sin = Math.sin(shape.rotation || 0);
        const dir = b.direction2d(cos, sin);
        const tPlacement = b.axis2placement2d(pos, dir);
        const width = shape.fixedWidth || (shape.text.length * shape.fontSize * 0.6);
        const height = shape.fontSize * shape.lineHeight;
        const textEntity = b.add(
          `IFCTEXTLITERALWITHEXTENT('${shape.text.replace(/'/g, "''")}',${tPlacement},.LEFT.,IFCPLANAREXTENT(${b.f(width)},${b.f(height)}),'bottom-left')`
        );
        const textColor = getOrCreateColor(shape.color);
        const fontDef = b.add(`IFCTEXTSTYLEFORDEFINEDFONT(${textColor},$,$,$,$)`);
        const fontModel = b.add(
          `IFCTEXTSTYLEFONTMODEL('${shape.fontFamily}',$,$,$,(IFCLABEL('${shape.fontFamily}')),IFCLENGTHMEASURE(${b.f(shape.fontSize)}))`
        );
        const textStyle = b.add(`IFCTEXTSTYLE($,${fontDef},$,${fontModel},.T.)`);
        b.add(`IFCSTYLEDITEM(${textEntity},(${textStyle}),$)`);
        geomItems.push(textEntity);
        break;
      }

      case 'hatch': {
        if (shape.points.length < 3) break;
        const pts = shape.points.map(p => b.point2d(p.x, p.y));
        const closePoint = b.point2d(shape.points[0].x, shape.points[0].y);
        pts.push(closePoint);
        const boundary = b.add(`IFCPOLYLINE((${pts.join(',')}))`);
        const fillArea = b.add(`IFCANNOTATIONFILLAREA(${boundary},$)`);

        // Build fill area style based on pattern type
        const fillColor = getOrCreateColor(shape.fillColor);
        const fillStyles: string[] = [];

        if (shape.patternType === 'solid') {
          // Solid fill: IfcFillAreaStyleColour
          const fillColourStyle = b.add(`IFCFILLAREASTYLECOLOUR('Fill',${fillColor})`);
          fillStyles.push(fillColourStyle);
        } else if (shape.patternType === 'custom' && shape.customPatternId && customPatterns) {
          // Custom pattern: look up and convert line families to IFC hatching
          const customPattern = customPatterns.find(p => p.id === shape.customPatternId);

          if (customPattern && !isSvgHatchPattern(customPattern)) {
            // Line-based custom pattern
            const curveStyle = b.add(`IFCCURVESTYLE($,$,IFCPOSITIVELENGTHMEASURE(${b.f(shape.style.strokeWidth)}),${fillColor},$)`);
            const hatchOrigin = b.point2d(0, 0);
            const hatchStartPt = b.point2d(0, 0);

            for (const family of customPattern.lineFamilies) {
              const spacing = (family.deltaY || 10) * shape.patternScale;
              const hatchEndPt = b.point2d(0, spacing);
              const totalAngle = family.angle + shape.patternAngle;
              const rad = totalAngle * Math.PI / 180;
              const hatchDir = b.direction2d(Math.cos(rad), Math.sin(rad));
              const hatchPlacement = b.axis2placement2d(hatchOrigin, hatchDir);

              const hatching = b.add(
                `IFCFILLAREASTYLEHATCHING(${curveStyle},${hatchPlacement},${hatchStartPt},${hatchEndPt},$)`
              );
              fillStyles.push(hatching);
            }
          } else if (customPattern && isSvgHatchPattern(customPattern)) {
            // SVG patterns cannot be directly represented in IFC
            // Fall back to a diagonal hatch pattern as a placeholder
            const spacing = 10 * shape.patternScale;
            const curveStyle = b.add(`IFCCURVESTYLE($,$,IFCPOSITIVELENGTHMEASURE(${b.f(shape.style.strokeWidth)}),${fillColor},$)`);
            const hatchOrigin = b.point2d(0, 0);
            const hatchStartPt = b.point2d(0, 0);
            const hatchEndPt = b.point2d(0, spacing);
            const rad = (45 + shape.patternAngle) * Math.PI / 180;
            const hatchDir = b.direction2d(Math.cos(rad), Math.sin(rad));
            const hatchPlacement = b.axis2placement2d(hatchOrigin, hatchDir);
            const hatching = b.add(
              `IFCFILLAREASTYLEHATCHING(${curveStyle},${hatchPlacement},${hatchStartPt},${hatchEndPt},$)`
            );
            fillStyles.push(hatching);
          }

          // Add background color if specified
          if (shape.backgroundColor) {
            const bgColor = getOrCreateColor(shape.backgroundColor);
            const bgFill = b.add(`IFCFILLAREASTYLECOLOUR('Background',${bgColor})`);
            fillStyles.push(bgFill);
          }
        } else {
          // Built-in hatching patterns: IfcFillAreaStyleHatching
          const spacing = 10 * shape.patternScale;
          const curveStyle = b.add(`IFCCURVESTYLE($,$,IFCPOSITIVELENGTHMEASURE(${b.f(shape.style.strokeWidth)}),${fillColor},$)`);

          const hatchOrigin = b.point2d(0, 0);
          const hatchStartPt = b.point2d(0, 0);
          const hatchEndPt = b.point2d(0, spacing);

          const makeHatching = (angleDeg: number): string => {
            const totalAngle = angleDeg + shape.patternAngle;
            const rad = totalAngle * Math.PI / 180;
            const hatchDir = b.direction2d(Math.cos(rad), Math.sin(rad));
            const hatchPlacement = b.axis2placement2d(hatchOrigin, hatchDir);
            return b.add(
              `IFCFILLAREASTYLEHATCHING(${curveStyle},${hatchPlacement},${hatchStartPt},${hatchEndPt},$)`
            );
          };

          switch (shape.patternType) {
            case 'diagonal':
              fillStyles.push(makeHatching(45));
              break;
            case 'crosshatch':
              fillStyles.push(makeHatching(45));
              fillStyles.push(makeHatching(-45));
              break;
            case 'horizontal':
              fillStyles.push(makeHatching(0));
              break;
            case 'vertical':
              fillStyles.push(makeHatching(90));
              break;
            case 'dots':
              // Approximate dots as tight crosshatch
              fillStyles.push(makeHatching(0));
              fillStyles.push(makeHatching(90));
              break;
          }

          // Add background color if specified
          if (shape.backgroundColor) {
            const bgColor = getOrCreateColor(shape.backgroundColor);
            const bgFill = b.add(`IFCFILLAREASTYLECOLOUR('Background',${bgColor})`);
            fillStyles.push(bgFill);
          }
        }

        const fillAreaStyle = b.add(`IFCFILLAREASTYLE('Hatch',(${fillStyles.join(',')}),$)`);

        // Also add boundary curve style
        const boundaryStyle = createCurveStyle(shape);

        const styledRep = b.add(
          `IFCPRESENTATIONSTYLEASSIGNMENT((${fillAreaStyle},${boundaryStyle}))`
        );
        b.add(`IFCSTYLEDITEM(${fillArea},(${styledRep}),$)`);
        geomItems.push(fillArea);
        break;
      }

      case 'dimension': {
        if (shape.points.length >= 2) {
          const pts = shape.points.map(p => b.point2d(p.x, p.y));
          const line = b.add(`IFCPOLYLINE((${pts.join(',')}))`);
          const style = createCurveStyle(shape);
          b.add(`IFCSTYLEDITEM(${line},(${style}),$)`);
          geomItems.push(line);
        }
        if (shape.value !== undefined && shape.points.length >= 2) {
          const midX = (shape.points[0].x + shape.points[1].x) / 2;
          const midY = (shape.points[0].y + shape.points[1].y) / 2;
          const pos = b.point2d(midX, midY);
          const dir = b.direction2d(1, 0);
          const tPlacement = b.axis2placement2d(pos, dir);
          const valStr = shape.value.replace(/'/g, "''");
          const textEntity = b.add(
            `IFCTEXTLITERALWITHEXTENT('${valStr}',${tPlacement},.LEFT.,IFCPLANAREXTENT(${b.f(20.0)},${b.f(5.0)}),'bottom-left')`
          );
          geomItems.push(textEntity);
        }
        break;
      }

      case 'point': {
        const pt = b.point2d(shape.position.x, shape.position.y);
        geomItems.push(pt);
        break;
      }
    }

    if (geomItems.length === 0) continue;

    const shapeRep = b.add(
      `IFCSHAPEREPRESENTATION(${ctx2d},'Annotation','Annotation2D',(${geomItems.join(',')}))`
    );
    const prodDefShape = b.add(`IFCPRODUCTDEFINITIONSHAPE($,$,(${shapeRep}))`);

    const layerName = layerMap.get(shape.layerId)?.name || 'Default';
    const annotation = b.add(
      `IFCANNOTATION('${generateIfcGuid()}',${ownerHistory},'${shape.type} - ${layerName}',$,$,$,${prodDefShape})`
    );
    annotationIds.push(annotation);
  }

  // --- Containment: all annotations in storey ---
  if (annotationIds.length > 0) {
    b.add(
      `IFCRELCONTAINEDINSPATIALSTRUCTURE('${generateIfcGuid()}',${ownerHistory},$,$,(${annotationIds.join(',')}),${storey})`
    );
  }

  // --- Layer assignments ---
  const layerShapeMap = new Map<string, string[]>();
  for (let i = 0; i < shapes.length; i++) {
    const shape = shapes[i];
    if (!shape.visible) continue;
    const layerId = shape.layerId;
    if (!layerShapeMap.has(layerId)) layerShapeMap.set(layerId, []);
    if (annotationIds[i]) {
      layerShapeMap.get(layerId)!.push(annotationIds[i]);
    }
  }
  for (const [layerId, ids] of layerShapeMap) {
    const layer = layerMap.get(layerId);
    if (layer && ids.length > 0) {
      b.add(`IFCPRESENTATIONLAYERASSIGNMENT('${layer.name}',$,(${ids.join(',')}),$)`);
    }
  }

  // --- Assemble STEP file ---
  return `ISO-10303-21;
HEADER;
FILE_DESCRIPTION(('ViewDefinition [CoordinationView]'),'2;1');
FILE_NAME('drawing.ifc','${timestamp}',(''),('Open 2D Studio'),'Open 2D Studio','Open 2D Studio','');
FILE_SCHEMA(('IFC4'));
ENDSEC;

DATA;
${b.toString()}
ENDSEC;
END-ISO-10303-21;
`;
}
