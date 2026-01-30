/**
 * QuadTree - Spatial index for efficient shape queries
 *
 * Provides O(log n) point and area queries instead of O(n) linear scans.
 */

import type { Point, Shape } from '../../types/geometry';
import type { ShapeBounds } from '../../utils/geometryUtils';
import { getShapeBounds } from '../../utils/geometryUtils';

export interface QuadTreeEntry {
  id: string;
  bounds: ShapeBounds;
}

interface Boundary {
  x: number;      // center x
  y: number;      // center y
  halfW: number;  // half width
  halfH: number;  // half height
}

const MAX_CAPACITY = 8;
const MAX_DEPTH = 10;

export class QuadTree {
  private boundary: Boundary;
  private entries: QuadTreeEntry[] = [];
  private divided = false;
  private nw: QuadTree | null = null;
  private ne: QuadTree | null = null;
  private sw: QuadTree | null = null;
  private se: QuadTree | null = null;
  private depth: number;

  constructor(boundary: Boundary, depth = 0) {
    this.boundary = boundary;
    this.depth = depth;
  }

  insert(entry: QuadTreeEntry): boolean {
    // Check if entry intersects this node's boundary
    if (!this.intersectsBounds(entry.bounds)) {
      return false;
    }

    if (this.entries.length < MAX_CAPACITY || this.depth >= MAX_DEPTH) {
      this.entries.push(entry);
      return true;
    }

    if (!this.divided) {
      this.subdivide();
    }

    this.nw!.insert(entry);
    this.ne!.insert(entry);
    this.sw!.insert(entry);
    this.se!.insert(entry);
    return true;
  }

  /**
   * Query all entries whose bounding box contains or is near the given point.
   * tolerance expands the search region.
   */
  queryPoint(point: Point, tolerance = 0): QuadTreeEntry[] {
    const results: QuadTreeEntry[] = [];
    this._queryPoint(point, tolerance, results);
    return results;
  }

  private _queryPoint(point: Point, tolerance: number, results: QuadTreeEntry[]): void {
    // Check if point (with tolerance) intersects this node
    const b = this.boundary;
    if (
      point.x + tolerance < b.x - b.halfW ||
      point.x - tolerance > b.x + b.halfW ||
      point.y + tolerance < b.y - b.halfH ||
      point.y - tolerance > b.y + b.halfH
    ) {
      return;
    }

    // Check entries in this node
    for (const entry of this.entries) {
      if (
        point.x + tolerance >= entry.bounds.minX &&
        point.x - tolerance <= entry.bounds.maxX &&
        point.y + tolerance >= entry.bounds.minY &&
        point.y - tolerance <= entry.bounds.maxY
      ) {
        results.push(entry);
      }
    }

    if (this.divided) {
      this.nw!._queryPoint(point, tolerance, results);
      this.ne!._queryPoint(point, tolerance, results);
      this.sw!._queryPoint(point, tolerance, results);
      this.se!._queryPoint(point, tolerance, results);
    }
  }

  /**
   * Query all entries intersecting a rectangular area.
   */
  query(area: ShapeBounds): QuadTreeEntry[] {
    const results: QuadTreeEntry[] = [];
    this._query(area, results);
    return results;
  }

  private _query(area: ShapeBounds, results: QuadTreeEntry[]): void {
    const b = this.boundary;
    if (
      area.maxX < b.x - b.halfW ||
      area.minX > b.x + b.halfW ||
      area.maxY < b.y - b.halfH ||
      area.minY > b.y + b.halfH
    ) {
      return;
    }

    for (const entry of this.entries) {
      if (
        area.maxX >= entry.bounds.minX &&
        area.minX <= entry.bounds.maxX &&
        area.maxY >= entry.bounds.minY &&
        area.minY <= entry.bounds.maxY
      ) {
        results.push(entry);
      }
    }

    if (this.divided) {
      this.nw!._query(area, results);
      this.ne!._query(area, results);
      this.sw!._query(area, results);
      this.se!._query(area, results);
    }
  }

  clear(): void {
    this.entries = [];
    this.divided = false;
    this.nw = null;
    this.ne = null;
    this.sw = null;
    this.se = null;
  }

  private subdivide(): void {
    const { x, y, halfW, halfH } = this.boundary;
    const qw = halfW / 2;
    const qh = halfH / 2;
    const d = this.depth + 1;

    this.nw = new QuadTree({ x: x - qw, y: y - qh, halfW: qw, halfH: qh }, d);
    this.ne = new QuadTree({ x: x + qw, y: y - qh, halfW: qw, halfH: qh }, d);
    this.sw = new QuadTree({ x: x - qw, y: y + qh, halfW: qw, halfH: qh }, d);
    this.se = new QuadTree({ x: x + qw, y: y + qh, halfW: qw, halfH: qh }, d);
    this.divided = true;
  }

  private intersectsBounds(bounds: ShapeBounds): boolean {
    const b = this.boundary;
    return !(
      bounds.maxX < b.x - b.halfW ||
      bounds.minX > b.x + b.halfW ||
      bounds.maxY < b.y - b.halfH ||
      bounds.minY > b.y + b.halfH
    );
  }

  /**
   * Build a QuadTree from an array of shapes, filtering by drawingId.
   */
  static buildFromShapes(shapes: Shape[], drawingId: string): QuadTree {
    // Filter visible shapes for this drawing and compute bounds
    const entries: QuadTreeEntry[] = [];
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

    for (const shape of shapes) {
      if (!shape.visible || shape.drawingId !== drawingId) continue;
      const bounds = getShapeBounds(shape);
      if (!bounds) continue;

      entries.push({ id: shape.id, bounds });
      if (bounds.minX < minX) minX = bounds.minX;
      if (bounds.minY < minY) minY = bounds.minY;
      if (bounds.maxX > maxX) maxX = bounds.maxX;
      if (bounds.maxY > maxY) maxY = bounds.maxY;
    }

    // Handle empty case
    if (entries.length === 0) {
      return new QuadTree({ x: 0, y: 0, halfW: 1000, halfH: 1000 });
    }

    // Add padding
    const padding = 100;
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    const hw = (maxX - minX) / 2 + padding;
    const hh = (maxY - minY) / 2 + padding;

    const tree = new QuadTree({ x: cx, y: cy, halfW: hw, halfH: hh });
    for (const entry of entries) {
      tree.insert(entry);
    }

    return tree;
  }
}
