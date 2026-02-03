/**
 * Entity (Shape) API - CRUD and querying for shapes
 */

import type { AppState } from '../state/appStore';
import type { Shape, ShapeType, ShapeStyle, HatchPatternType } from '../types/geometry';
import type { CadEventBus } from './events';
import type { TransactionManager } from './transactions';
import { toPoint, type ApiPoint, type EntityFilter } from './types';
import {
  createLineShape, createRectangleShape, createCircleShape,
  createArcShape, createEllipseShape, createPolylineShape, createSplineShape, createPointShape,
  cloneShape, translateShape, rotateShape, scaleShape, mirrorShape,
  doesShapeIntersectBounds,
} from '../services/shapeService';
import { findShapeAtPoint } from '../services/selectionService';
import { generateId } from '../state/slices/types';

export class EntitiesApi {
  constructor(
    private getState: () => AppState,
    _bus: CadEventBus,
    _transactions: TransactionManager
  ) {}

  /**
   * Add multiple entities in a single state update (bulk operation).
   * Much faster than calling add() in a loop.
   */
  addBulk(shapes: { type: ShapeType; params: Record<string, any> }[]): Shape[] {
    const results: Shape[] = [];
    for (const { type, params } of shapes) {
      results.push(this._createShape(type, params));
    }
    this.getState().addShapes(results);
    return results;
  }

  /**
   * Remove multiple entities in a single state update.
   */
  removeBulk(ids: string[]): void {
    this.getState().deleteShapes(ids);
  }

  /**
   * Add a new entity (shape) to the active drawing.
   * Note: addShape already pushes history internally.
   */
  add(type: ShapeType, params: Record<string, any>): Shape {
    const shape = this._createShape(type, params);
    this.getState().addShape(shape);
    return shape;
  }

  private _createShape(type: ShapeType, params: Record<string, any>): Shape {
    const state = this.getState();
    const layerId = state.activeLayerId;
    const drawingId = state.activeDrawingId;
    const style: Partial<ShapeStyle> = params.style || {};

    switch (type) {
      case 'line':
        return createLineShape(
          toPoint(params.start), toPoint(params.end),
          layerId, drawingId, style
        );
      case 'rectangle':
        return createRectangleShape(
          toPoint(params.topLeft || params.position || { x: 0, y: 0 }),
          params.width, params.height,
          layerId, drawingId, style, params.rotation || 0
        );
      case 'circle':
        return createCircleShape(
          toPoint(params.center), params.radius,
          layerId, drawingId, style
        );
      case 'arc':
        return createArcShape(
          toPoint(params.center), params.radius,
          params.startAngle, params.endAngle,
          layerId, drawingId, style
        );
      case 'ellipse':
        return createEllipseShape(
          toPoint(params.center), params.radiusX, params.radiusY,
          layerId, drawingId, style, params.rotation || 0
        );
      case 'polyline':
        return createPolylineShape(
          (params.points as ApiPoint[]).map(toPoint),
          layerId, drawingId, style, params.closed || false
        );
      case 'spline':
        return createSplineShape(
          (params.points as ApiPoint[]).map(toPoint),
          layerId, drawingId, style, params.closed || false
        );
      case 'point':
        return createPointShape(
          toPoint(params.position), layerId, drawingId, style
        );
      case 'text':
        return {
          id: generateId(),
          type: 'text',
          layerId, drawingId,
          style: { strokeColor: '#ffffff', strokeWidth: 1, lineStyle: 'solid' as const, ...style },
          visible: true, locked: false,
          position: toPoint(params.position),
          text: params.text || '',
          fontSize: params.fontSize || 12,
          fontFamily: params.fontFamily || 'Arial',
          rotation: params.rotation || 0,
          alignment: params.alignment || 'left',
          verticalAlignment: params.verticalAlignment || 'top',
          bold: params.bold || false,
          italic: params.italic || false,
          underline: params.underline || false,
          color: params.color || '#ffffff',
          lineHeight: params.lineHeight || 1.2,
          fixedWidth: params.fixedWidth,
        } as any;
      case 'dimension': {
        const dimParams = params as any;
        return {
          id: generateId(),
          type: 'dimension',
          layerId, drawingId,
          style: { strokeColor: '#00ffff', strokeWidth: 1, lineStyle: 'solid' as const, ...style },
          visible: true, locked: false,
          dimensionType: dimParams.dimensionType || 'linear',
          points: (dimParams.points as ApiPoint[]).map(toPoint),
          dimensionLineOffset: dimParams.dimensionLineOffset || 20,
          linearDirection: dimParams.linearDirection,
          references: dimParams.references,
          value: dimParams.value || '',
          valueOverridden: dimParams.valueOverridden || false,
          prefix: dimParams.prefix,
          suffix: dimParams.suffix,
          dimensionStyle: dimParams.dimensionStyle || {
            arrowType: 'filled', arrowSize: 3, extensionLineGap: 2,
            extensionLineOvershoot: 2, textHeight: 3, textPlacement: 'above',
            lineColor: '#00ffff', textColor: '#00ffff', precision: 2,
          },
        } as any;
      }
      case 'hatch': {
        const hatchParams = params as any;
        return {
          id: generateId(),
          type: 'hatch',
          layerId, drawingId,
          style: { strokeColor: '#ffffff', strokeWidth: 1, lineStyle: 'solid' as const, ...style },
          visible: true, locked: false,
          points: (hatchParams.points as ApiPoint[]).map(toPoint),
          patternType: (hatchParams.patternType || 'solid') as HatchPatternType,
          patternAngle: hatchParams.patternAngle || 0,
          patternScale: hatchParams.patternScale || 1,
          fillColor: hatchParams.fillColor || '#ffffff',
          backgroundColor: hatchParams.backgroundColor,
          customPatternId: hatchParams.customPatternId,
        } as any;
      }
      default:
        throw new Error(`Unsupported shape type: ${type}`);
    }
  }

  get(id: string): Shape | undefined {
    return this.getState().shapes.find(s => s.id === id);
  }

  /**
   * Update entity properties. updateShape pushes history internally.
   */
  update(id: string, props: Partial<Shape>): void {
    this.getState().updateShape(id, props);
  }

  /**
   * Remove one or more entities. Uses bulk delete for arrays.
   */
  remove(idOrIds: string | string[]): void {
    const ids = Array.isArray(idOrIds) ? idOrIds : [idOrIds];
    if (ids.length === 1) {
      this.getState().deleteShape(ids[0]);
    } else {
      this.getState().deleteShapes(ids);
    }
  }

  list(filter?: EntityFilter): Shape[] {
    let shapes = this.getState().shapes;
    if (!filter) return [...shapes];
    if (filter.type) shapes = shapes.filter(s => s.type === filter.type);
    if (filter.layer) shapes = shapes.filter(s => s.layerId === filter.layer);
    if (filter.drawing) shapes = shapes.filter(s => s.drawingId === filter.drawing);
    if (filter.visible !== undefined) shapes = shapes.filter(s => s.visible === filter.visible);
    if (filter.locked !== undefined) shapes = shapes.filter(s => s.locked === filter.locked);
    if (filter.predicate) shapes = shapes.filter(filter.predicate);
    return [...shapes];
  }

  findAt(point: ApiPoint, tolerance?: number): Shape | null {
    const state = this.getState();
    const shapes = state.shapes.filter(s => s.drawingId === state.activeDrawingId);
    return findShapeAtPoint(toPoint(point), shapes, tolerance);
  }

  findInBounds(bounds: { minX: number; minY: number; maxX: number; maxY: number }): Shape[] {
    const state = this.getState();
    return state.shapes.filter(s =>
      s.drawingId === state.activeDrawingId && doesShapeIntersectBounds(s, bounds)
    );
  }

  count(filter?: EntityFilter): number {
    return this.list(filter).length;
  }

  clone(id: string, offset?: ApiPoint): Shape | null {
    const original = this.get(id);
    if (!original) return null;
    const cloned = cloneShape(original, offset ? toPoint(offset) : { x: 20, y: 20 });
    this.getState().addShape(cloned);
    return cloned;
  }

  /**
   * Transform entities. Each updateShape call pushes history internally.
   * For batch transforms, wrap in a transaction.
   */
  transform(ids: string[], transform: {
    translate?: ApiPoint;
    rotate?: { center: ApiPoint; angle: number };
    scale?: { center: ApiPoint; factor: number };
    mirror?: { p1: ApiPoint; p2: ApiPoint };
  }): void {
    const state = this.getState();
    for (const id of ids) {
      const shape = state.shapes.find(s => s.id === id);
      if (!shape) continue;
      const cloned = JSON.parse(JSON.stringify(shape));

      if (transform.translate) {
        translateShape(cloned, toPoint(transform.translate));
      }
      if (transform.rotate) {
        rotateShape(cloned, toPoint(transform.rotate.center), transform.rotate.angle);
      }
      if (transform.scale) {
        const c = toPoint(transform.scale.center);
        scaleShape(cloned, c, transform.scale.factor, transform.scale.factor);
      }
      if (transform.mirror) {
        mirrorShape(cloned, toPoint(transform.mirror.p1), toPoint(transform.mirror.p2));
      }

      state.updateShape(id, cloned);
    }
  }
}
