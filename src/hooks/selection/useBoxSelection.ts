/**
 * useBoxSelection - Handles window/crossing box selection
 */

import { useCallback, useRef } from 'react';
import { useAppStore, type SelectionBox } from '../../state/appStore';
import type { Point, Shape } from '../../types/geometry';
import { getShapeBounds } from '../../engine/geometry/GeometryUtils';
import { screenToWorld } from '../../engine/geometry/GeometryUtils';

/**
 * Test if a line segment intersects an axis-aligned rectangle.
 * Uses Liang-Barsky algorithm.
 */
function lineSegmentIntersectsRect(
  x1: number, y1: number, x2: number, y2: number,
  minX: number, minY: number, maxX: number, maxY: number
): boolean {
  // Check if either endpoint is inside the rect
  if (x1 >= minX && x1 <= maxX && y1 >= minY && y1 <= maxY) return true;
  if (x2 >= minX && x2 <= maxX && y2 >= minY && y2 <= maxY) return true;

  const dx = x2 - x1;
  const dy = y2 - y1;

  // Check intersection with each edge of the rectangle
  const edges = [
    { ex1: minX, ey1: minY, ex2: maxX, ey2: minY }, // bottom
    { ex1: maxX, ey1: minY, ex2: maxX, ey2: maxY }, // right
    { ex1: minX, ey1: maxY, ex2: maxX, ey2: maxY }, // top
    { ex1: minX, ey1: minY, ex2: minX, ey2: maxY }, // left
  ];

  for (const edge of edges) {
    const edx = edge.ex2 - edge.ex1;
    const edy = edge.ey2 - edge.ey1;
    const denom = dx * edy - dy * edx;
    if (Math.abs(denom) < 1e-10) continue; // parallel

    const t = ((edge.ex1 - x1) * edy - (edge.ey1 - y1) * edx) / denom;
    const u = ((edge.ex1 - x1) * dy - (edge.ey1 - y1) * dx) / denom;

    if (t >= 0 && t <= 1 && u >= 0 && u <= 1) return true;
  }

  return false;
}

interface Edge { x1: number; y1: number; x2: number; y2: number; }

/**
 * Decompose a shape into line segment edges for precise intersection testing.
 */
function getShapeEdges(shape: Shape): Edge[] {
  switch (shape.type) {
    case 'line':
      return [{ x1: shape.start.x, y1: shape.start.y, x2: shape.end.x, y2: shape.end.y }];

    case 'rectangle': {
      const { topLeft: tl, width, height, rotation } = shape;
      const cos = Math.cos(rotation);
      const sin = Math.sin(rotation);
      // 4 corners rotated around topLeft
      const corners = [
        { x: tl.x, y: tl.y },
        { x: tl.x + width * cos, y: tl.y + width * sin },
        { x: tl.x + width * cos - height * sin, y: tl.y + width * sin + height * cos },
        { x: tl.x - height * sin, y: tl.y + height * cos },
      ];
      return [
        { x1: corners[0].x, y1: corners[0].y, x2: corners[1].x, y2: corners[1].y },
        { x1: corners[1].x, y1: corners[1].y, x2: corners[2].x, y2: corners[2].y },
        { x1: corners[2].x, y1: corners[2].y, x2: corners[3].x, y2: corners[3].y },
        { x1: corners[3].x, y1: corners[3].y, x2: corners[0].x, y2: corners[0].y },
      ];
    }

    case 'circle': {
      // Approximate circle with 32 segments
      const { center, radius } = shape;
      const segments = 32;
      const edges: Edge[] = [];
      for (let i = 0; i < segments; i++) {
        const a1 = (i / segments) * Math.PI * 2;
        const a2 = ((i + 1) / segments) * Math.PI * 2;
        edges.push({
          x1: center.x + radius * Math.cos(a1), y1: center.y + radius * Math.sin(a1),
          x2: center.x + radius * Math.cos(a2), y2: center.y + radius * Math.sin(a2),
        });
      }
      return edges;
    }

    case 'arc': {
      const { center, radius, startAngle, endAngle } = shape;
      const segments = 32;
      let start = startAngle;
      let end = endAngle;
      if (end < start) end += Math.PI * 2;
      const edges: Edge[] = [];
      for (let i = 0; i < segments; i++) {
        const a1 = start + (i / segments) * (end - start);
        const a2 = start + ((i + 1) / segments) * (end - start);
        edges.push({
          x1: center.x + radius * Math.cos(a1), y1: center.y + radius * Math.sin(a1),
          x2: center.x + radius * Math.cos(a2), y2: center.y + radius * Math.sin(a2),
        });
      }
      return edges;
    }

    case 'ellipse': {
      const { center, radiusX, radiusY, rotation } = shape;
      const segments = 32;
      const cos = Math.cos(rotation);
      const sin = Math.sin(rotation);
      const edges: Edge[] = [];
      for (let i = 0; i < segments; i++) {
        const a1 = (i / segments) * Math.PI * 2;
        const a2 = ((i + 1) / segments) * Math.PI * 2;
        const px1 = radiusX * Math.cos(a1), py1 = radiusY * Math.sin(a1);
        const px2 = radiusX * Math.cos(a2), py2 = radiusY * Math.sin(a2);
        edges.push({
          x1: center.x + px1 * cos - py1 * sin, y1: center.y + px1 * sin + py1 * cos,
          x2: center.x + px2 * cos - py2 * sin, y2: center.y + px2 * sin + py2 * cos,
        });
      }
      return edges;
    }

    case 'polyline': {
      const edges: Edge[] = [];
      for (let i = 0; i < shape.points.length - 1; i++) {
        edges.push({
          x1: shape.points[i].x, y1: shape.points[i].y,
          x2: shape.points[i + 1].x, y2: shape.points[i + 1].y,
        });
      }
      if (shape.closed && shape.points.length >= 3) {
        const last = shape.points[shape.points.length - 1];
        const first = shape.points[0];
        edges.push({ x1: last.x, y1: last.y, x2: first.x, y2: first.y });
      }
      return edges;
    }

    case 'spline': {
      const edges: Edge[] = [];
      for (let i = 0; i < shape.points.length - 1; i++) {
        edges.push({
          x1: shape.points[i].x, y1: shape.points[i].y,
          x2: shape.points[i + 1].x, y2: shape.points[i + 1].y,
        });
      }
      return edges;
    }

    default:
      return [];
  }
}

/**
 * Test if a shape's actual geometry intersects or is contained in a rectangle (for crossing selection).
 * Falls back to bounding box overlap for shapes where edge decomposition isn't available.
 */
function shapeCrossesRect(shape: Shape, minX: number, minY: number, maxX: number, maxY: number): boolean {
  const bounds = getShapeBounds(shape);
  if (!bounds) return false;

  // Quick reject: if bounding boxes don't overlap at all, no intersection possible
  if (bounds.maxX < minX || bounds.minX > maxX || bounds.maxY < minY || bounds.minY > maxY) {
    return false;
  }

  // Helper: get edges of a shape as line segments for precise crossing test
  const edges = getShapeEdges(shape);
  if (edges.length > 0) {
    // Check if any edge crosses the selection rectangle
    for (const edge of edges) {
      if (lineSegmentIntersectsRect(edge.x1, edge.y1, edge.x2, edge.y2, minX, minY, maxX, maxY)) {
        return true;
      }
    }
    return false;
  }

  // For shapes without edge decomposition, bounding box overlap is sufficient
  return true;
}

interface SelectionState {
  isSelecting: boolean;
  startPoint: Point;
  justFinishedBoxSelection: boolean;
}

export function useBoxSelection() {
  const selectionState = useRef<SelectionState>({
    isSelecting: false,
    startPoint: { x: 0, y: 0 },
    justFinishedBoxSelection: false,
  });

  const {
    viewport,
    shapes,
    parametricShapes,
    activeTool,
    selectShapes,
    setSelectionBox,
    editorMode,
    activeDrawingId,
  } = useAppStore();

  /**
   * Start box selection
   */
  const startBoxSelection = useCallback(
    (screenPos: Point) => {
      selectionState.current = {
        isSelecting: true,
        startPoint: screenPos,
        justFinishedBoxSelection: false,
      };
    },
    []
  );

  /**
   * Check if should start box selection (clicking on empty space in select mode)
   */
  const shouldStartBoxSelection = useCallback(
    (hasShapeAtPoint: boolean): boolean => {
      if (editorMode !== 'drawing') return false;
      if (hasShapeAtPoint) return false;
      return activeTool === 'select';
    },
    [editorMode, activeTool]
  );

  /**
   * Update box selection during drag
   */
  const updateBoxSelection = useCallback(
    (screenPos: Point) => {
      if (!selectionState.current.isSelecting) return;

      const startPoint = selectionState.current.startPoint;
      // Determine mode based on direction: left-to-right = window, right-to-left = crossing
      const mode = screenPos.x >= startPoint.x ? 'window' : 'crossing';

      setSelectionBox({
        start: startPoint,
        end: screenPos,
        mode,
      });
    },
    [setSelectionBox]
  );

  /**
   * Get shapes within selection box
   */
  const getShapesInSelectionBox = useCallback(
    (box: SelectionBox): string[] => {
      const startWorld = screenToWorld(box.start.x, box.start.y, viewport);
      const endWorld = screenToWorld(box.end.x, box.end.y, viewport);

      const minX = Math.min(startWorld.x, endWorld.x);
      const maxX = Math.max(startWorld.x, endWorld.x);
      const minY = Math.min(startWorld.y, endWorld.y);
      const maxY = Math.max(startWorld.y, endWorld.y);

      const selectedIds: string[] = [];

      // Check regular shapes
      for (const shape of shapes) {
        if (!shape.visible || shape.locked) continue;
        if (shape.drawingId !== activeDrawingId) continue;  // Only select shapes in active drawing

        const bounds = getShapeBounds(shape);
        if (!bounds) continue;

        if (box.mode === 'window') {
          // Window selection: all geometry must be inside the box
          // Use edge decomposition for precise check on rotated shapes
          const edges = getShapeEdges(shape);
          let allInside = true;
          if (edges.length > 0) {
            for (const edge of edges) {
              if (edge.x1 < minX || edge.x1 > maxX || edge.y1 < minY || edge.y1 > maxY ||
                  edge.x2 < minX || edge.x2 > maxX || edge.y2 < minY || edge.y2 > maxY) {
                allInside = false;
                break;
              }
            }
          } else {
            // Fallback to bounding box
            allInside = bounds.minX >= minX && bounds.maxX <= maxX &&
                        bounds.minY >= minY && bounds.maxY <= maxY;
          }
          if (allInside) {
            selectedIds.push(shape.id);
          }
        } else {
          // Crossing selection: shape can be inside or crossing
          // Use precise geometry test to avoid false positives from bounding box overlap
          if (shapeCrossesRect(shape, minX, minY, maxX, maxY)) {
            selectedIds.push(shape.id);
          }
        }
      }

      // Check parametric shapes
      for (const shape of parametricShapes) {
        if (!shape.visible || shape.locked) continue;
        if (shape.drawingId !== activeDrawingId) continue;

        const bounds = shape.generatedGeometry?.bounds;
        if (!bounds) continue;

        if (box.mode === 'window') {
          // Window selection: entire shape must be inside
          const allInside = bounds.minX >= minX && bounds.maxX <= maxX &&
                           bounds.minY >= minY && bounds.maxY <= maxY;
          if (allInside) {
            selectedIds.push(shape.id);
          }
        } else {
          // Crossing selection: bounds overlap is sufficient
          const overlaps = !(bounds.maxX < minX || bounds.minX > maxX ||
                            bounds.maxY < minY || bounds.minY > maxY);
          if (overlaps) {
            selectedIds.push(shape.id);
          }
        }
      }

      return selectedIds;
    },
    [viewport, shapes, parametricShapes, activeDrawingId]
  );

  /**
   * End box selection
   */
  const endBoxSelection = useCallback(
    (screenPos: Point, shiftKey: boolean): boolean => {
      if (!selectionState.current.isSelecting) return false;

      const startPoint = selectionState.current.startPoint;

      // Check if it was a drag (not just a click)
      const dx = Math.abs(screenPos.x - startPoint.x);
      const dy = Math.abs(screenPos.y - startPoint.y);

      const wasBoxSelection = dx > 5 || dy > 5;

      if (wasBoxSelection) {
        const mode = screenPos.x >= startPoint.x ? 'window' : 'crossing';
        const box: SelectionBox = {
          start: startPoint,
          end: screenPos,
          mode,
        };

        const selectedIds = getShapesInSelectionBox(box);

        if (shiftKey) {
          // Add to current selection
          const currentSelection = useAppStore.getState().selectedShapeIds;
          const newSelection = [...new Set([...currentSelection, ...selectedIds])];
          selectShapes(newSelection);
        } else {
          // Replace selection
          selectShapes(selectedIds);
        }

        selectionState.current.justFinishedBoxSelection = true;
      } else {
        selectionState.current.justFinishedBoxSelection = false;
      }

      selectionState.current.isSelecting = false;
      setSelectionBox(null);

      return wasBoxSelection;
    },
    [getShapesInSelectionBox, selectShapes, setSelectionBox]
  );

  /**
   * Check if box selection is in progress
   */
  const isSelecting = useCallback(() => selectionState.current.isSelecting, []);

  /**
   * Check if just finished box selection (to prevent click handler)
   */
  const justFinishedBoxSelection = useCallback(() => {
    const result = selectionState.current.justFinishedBoxSelection;
    selectionState.current.justFinishedBoxSelection = false;
    return result;
  }, []);

  return {
    startBoxSelection,
    shouldStartBoxSelection,
    updateBoxSelection,
    endBoxSelection,
    getShapesInSelectionBox,
    isSelecting,
    justFinishedBoxSelection,
  };
}
