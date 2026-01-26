/**
 * Spatial Index using a Grid-based approach
 * Provides O(1) average lookup for shapes in a region
 */

import type { IPoint } from '../geometry/Point';

export interface BoundingBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface SpatialEntry<T> {
  id: string;
  bounds: BoundingBox;
  data: T;
}

/**
 * Grid-based spatial index for 2D shapes
 * Uses a hash map of grid cells for efficient spatial queries
 */
export class SpatialIndex<T> {
  private cellSize: number;
  private cells: Map<string, Set<string>> = new Map();
  private entries: Map<string, SpatialEntry<T>> = new Map();

  constructor(cellSize: number = 100) {
    this.cellSize = cellSize;
  }

  private getCellsForBounds(bounds: BoundingBox): string[] {
    const cells: string[] = [];
    const startX = Math.floor(bounds.minX / this.cellSize);
    const startY = Math.floor(bounds.minY / this.cellSize);
    const endX = Math.floor(bounds.maxX / this.cellSize);
    const endY = Math.floor(bounds.maxY / this.cellSize);

    for (let x = startX; x <= endX; x++) {
      for (let y = startY; y <= endY; y++) {
        cells.push(`${x},${y}`);
      }
    }

    return cells;
  }

  /**
   * Insert an entry into the spatial index
   */
  insert(id: string, bounds: BoundingBox, data: T): void {
    // Remove existing entry if present
    this.remove(id);

    const entry: SpatialEntry<T> = { id, bounds, data };
    this.entries.set(id, entry);

    // Add to all overlapping cells
    const cells = this.getCellsForBounds(bounds);
    for (const cellKey of cells) {
      let cell = this.cells.get(cellKey);
      if (!cell) {
        cell = new Set();
        this.cells.set(cellKey, cell);
      }
      cell.add(id);
    }
  }

  /**
   * Remove an entry from the spatial index
   */
  remove(id: string): boolean {
    const entry = this.entries.get(id);
    if (!entry) return false;

    // Remove from all cells
    const cells = this.getCellsForBounds(entry.bounds);
    for (const cellKey of cells) {
      const cell = this.cells.get(cellKey);
      if (cell) {
        cell.delete(id);
        if (cell.size === 0) {
          this.cells.delete(cellKey);
        }
      }
    }

    this.entries.delete(id);
    return true;
  }

  /**
   * Update an entry's bounds
   */
  update(id: string, newBounds: BoundingBox, newData?: T): void {
    const entry = this.entries.get(id);
    if (!entry) return;

    this.remove(id);
    this.insert(id, newBounds, newData ?? entry.data);
  }

  /**
   * Query all entries that intersect with the given bounds
   */
  query(bounds: BoundingBox): SpatialEntry<T>[] {
    const candidateIds = new Set<string>();
    const cells = this.getCellsForBounds(bounds);

    for (const cellKey of cells) {
      const cell = this.cells.get(cellKey);
      if (cell) {
        for (const id of cell) {
          candidateIds.add(id);
        }
      }
    }

    const results: SpatialEntry<T>[] = [];
    for (const id of candidateIds) {
      const entry = this.entries.get(id);
      if (entry && this.boundsIntersect(entry.bounds, bounds)) {
        results.push(entry);
      }
    }

    return results;
  }

  /**
   * Query all entries within a radius of a point
   */
  queryRadius(center: IPoint, radius: number): SpatialEntry<T>[] {
    const bounds: BoundingBox = {
      minX: center.x - radius,
      minY: center.y - radius,
      maxX: center.x + radius,
      maxY: center.y + radius,
    };

    return this.query(bounds);
  }

  /**
   * Query entries at a specific point
   */
  queryPoint(point: IPoint): SpatialEntry<T>[] {
    const bounds: BoundingBox = {
      minX: point.x,
      minY: point.y,
      maxX: point.x,
      maxY: point.y,
    };

    return this.query(bounds);
  }

  /**
   * Get all entries
   */
  getAll(): SpatialEntry<T>[] {
    return Array.from(this.entries.values());
  }

  /**
   * Get entry by ID
   */
  get(id: string): SpatialEntry<T> | undefined {
    return this.entries.get(id);
  }

  /**
   * Check if entry exists
   */
  has(id: string): boolean {
    return this.entries.has(id);
  }

  /**
   * Clear all entries
   */
  clear(): void {
    this.cells.clear();
    this.entries.clear();
  }

  /**
   * Get count of entries
   */
  get size(): number {
    return this.entries.size;
  }

  private boundsIntersect(a: BoundingBox, b: BoundingBox): boolean {
    return !(a.maxX < b.minX || a.minX > b.maxX || a.maxY < b.minY || a.minY > b.maxY);
  }
}

/**
 * Calculate bounding box for common shape types
 */
export function calculateBounds(shape: {
  type: string;
  start?: IPoint;
  end?: IPoint;
  center?: IPoint;
  radius?: number;
  topLeft?: IPoint;
  width?: number;
  height?: number;
  points?: IPoint[];
  radiusX?: number;
  radiusY?: number;
}): BoundingBox {
  switch (shape.type) {
    case 'line':
      if (shape.start && shape.end) {
        return {
          minX: Math.min(shape.start.x, shape.end.x),
          minY: Math.min(shape.start.y, shape.end.y),
          maxX: Math.max(shape.start.x, shape.end.x),
          maxY: Math.max(shape.start.y, shape.end.y),
        };
      }
      break;

    case 'circle':
      if (shape.center && shape.radius !== undefined) {
        return {
          minX: shape.center.x - shape.radius,
          minY: shape.center.y - shape.radius,
          maxX: shape.center.x + shape.radius,
          maxY: shape.center.y + shape.radius,
        };
      }
      break;

    case 'rectangle':
      if (shape.topLeft && shape.width !== undefined && shape.height !== undefined) {
        return {
          minX: shape.topLeft.x,
          minY: shape.topLeft.y,
          maxX: shape.topLeft.x + shape.width,
          maxY: shape.topLeft.y + shape.height,
        };
      }
      break;

    case 'polyline':
      if (shape.points && shape.points.length > 0) {
        const xs = shape.points.map((p) => p.x);
        const ys = shape.points.map((p) => p.y);
        return {
          minX: Math.min(...xs),
          minY: Math.min(...ys),
          maxX: Math.max(...xs),
          maxY: Math.max(...ys),
        };
      }
      break;

    case 'ellipse':
      if (shape.center && shape.radiusX !== undefined && shape.radiusY !== undefined) {
        return {
          minX: shape.center.x - shape.radiusX,
          minY: shape.center.y - shape.radiusY,
          maxX: shape.center.x + shape.radiusX,
          maxY: shape.center.y + shape.radiusY,
        };
      }
      break;

    case 'arc':
      // Approximate with circle bounds for now
      if (shape.center && shape.radius !== undefined) {
        return {
          minX: shape.center.x - shape.radius,
          minY: shape.center.y - shape.radius,
          maxX: shape.center.x + shape.radius,
          maxY: shape.center.y + shape.radius,
        };
      }
      break;
  }

  // Default fallback
  return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
}
