/**
 * modifyToolPreview - Preview rendering logic for modify tools
 *
 * Extracted from useModifyTools.ts to keep the hook file manageable.
 * Contains parametricShapesToGhosts() and updateModifyPreview() as
 * standalone functions that receive their dependencies via a context object.
 */

import type { Point, Shape, ToolType, PlateSystemShape } from '../../types/geometry';
import type { ParametricShape } from '../../types/parametric';
import type { DrawingPreview } from '../../state/slices/types';
import type { SelectedGrip } from '../../state/slices/selectionSlice';
import {
  transformShape,
  translateTransform,
  rotateTransform,
  scaleTransform,
  mirrorTransform,
  offsetShape,
} from '../../engine/geometry/Modify';
import { getShapeBounds } from '../../state/slices/types';

// ---------------------------------------------------------------------------
// Context interface – every piece of state that the preview functions need
// ---------------------------------------------------------------------------

export interface ModifyPreviewContext {
  activeTool: ToolType;
  shapes: Shape[];
  selectedShapeIds: string[];
  drawingPoints: Point[];
  parametricShapes: ParametricShape[];
  setDrawingPreview: (preview: DrawingPreview | null) => void;

  // Modify options
  modifyConstrainAxis: 'x' | 'y' | null;
  scaleMode: string;
  arrayMode: string;
  arrayCount: number;
  arraySpacing: number;
  arrayAngle: number;
  lockedDistance: number | null;
  offsetDistance: number;
  offsetFlipped: boolean;

  // Selection / grip
  selectedGrip: SelectedGrip | null;
  hoveredShapeId: string | null;

  // Drawing context
  activeDrawingId: string | null;
}

// ---------------------------------------------------------------------------
// Helper: constrain a delta vector to the specified axis
// ---------------------------------------------------------------------------

function constrainDelta(
  dx: number,
  dy: number,
  axis: 'x' | 'y' | null,
): { dx: number; dy: number } {
  if (axis === 'x') return { dx, dy: 0 };
  if (axis === 'y') return { dx: 0, dy };
  return { dx, dy };
}

// ---------------------------------------------------------------------------
// Helper: get selected shapes from context
// ---------------------------------------------------------------------------

function getSelectedShapes(ctx: ModifyPreviewContext): Shape[] {
  const idSet = new Set(ctx.selectedShapeIds);
  return ctx.shapes.filter((s) => idSet.has(s.id));
}

// ---------------------------------------------------------------------------
// Helper: get child beam shapes of plate-systems in the selection
// ---------------------------------------------------------------------------

function getPlateSystemChildShapes(
  ctx: ModifyPreviewContext,
  selected: Shape[],
): Shape[] {
  const selectedIdSet = new Set(ctx.selectedShapeIds);
  const childIds: string[] = [];
  for (const s of selected) {
    if (s.type === 'plate-system') {
      const ps = s as PlateSystemShape;
      if (ps.childShapeIds) {
        for (const cid of ps.childShapeIds) {
          if (!selectedIdSet.has(cid)) {
            childIds.push(cid);
          }
        }
      }
    }
  }
  if (childIds.length === 0) return [];
  const childIdSet = new Set(childIds);
  return ctx.shapes.filter((s) => childIdSet.has(s.id));
}

// ---------------------------------------------------------------------------
// Helper: get selected parametric shapes from context
// ---------------------------------------------------------------------------

function getSelectedParametricShapes(ctx: ModifyPreviewContext): ParametricShape[] {
  const idSet = new Set(ctx.selectedShapeIds);
  return ctx.parametricShapes.filter((s) => idSet.has(s.id));
}

// ---------------------------------------------------------------------------
// parametricShapesToGhosts – converts ParametricShape[] to Shape[] polylines
// ---------------------------------------------------------------------------

export function parametricShapesToGhosts(parametrics: ParametricShape[]): Shape[] {
  const ghosts: Shape[] = [];
  for (const ps of parametrics) {
    if (!ps.generatedGeometry?.outlines || ps.generatedGeometry.outlines.length === 0) continue;
    // Create a closed polyline for each outline
    for (let i = 0; i < ps.generatedGeometry.outlines.length; i++) {
      const outline = ps.generatedGeometry.outlines[i];
      if (outline.length < 2) continue;
      const isClosed = ps.generatedGeometry.closed[i] ?? true;
      ghosts.push({
        id: `preview-${ps.id}-${i}`,
        type: 'polyline',
        layerId: ps.layerId,
        drawingId: ps.drawingId,
        style: ps.style,
        visible: true,
        locked: false,
        points: outline,
        closed: isClosed,
      } as Shape);
    }
  }
  return ghosts;
}

// ---------------------------------------------------------------------------
// updateModifyPreview – generates preview ghost shapes as the cursor moves
// ---------------------------------------------------------------------------

const MODIFY_TOOLS: ToolType[] = [
  'move', 'copy', 'copy2', 'rotate', 'scale', 'mirror', 'array',
  'trim', 'extend', 'fillet', 'chamfer', 'offset', 'elastic', 'align', 'trim-walls',
];

export function updateModifyPreview(ctx: ModifyPreviewContext, worldPos: Point): void {
  if (!MODIFY_TOOLS.includes(ctx.activeTool)) return;
  const pts = ctx.drawingPoints;

  // For tools that need selection but have none, no preview
  const needsSelection = ['move', 'copy', 'copy2', 'rotate', 'scale', 'mirror', 'array', 'align'].includes(ctx.activeTool);
  if (needsSelection && ctx.selectedShapeIds.length === 0) {
    ctx.setDrawingPreview(null);
    return;
  }

  const selected = getSelectedShapes(ctx);
  const selectedParametric = getSelectedParametricShapes(ctx);
  // Convert parametric shapes to ghost polylines for preview
  const parametricGhosts = parametricShapesToGhosts(selectedParametric);

  switch (ctx.activeTool) {
    case 'move':
    case 'copy':
    case 'copy2': {
      if (pts.length === 1) {
        let { dx, dy } = constrainDelta(worldPos.x - pts[0].x, worldPos.y - pts[0].y, ctx.modifyConstrainAxis);
        // If lockedDistance is set (user typing), constrain to that distance in mouse direction
        if (ctx.lockedDistance !== null) {
          const dist = Math.hypot(dx, dy);
          if (dist > 0.001) {
            const ux = dx / dist;
            const uy = dy / dist;
            dx = ux * ctx.lockedDistance;
            dy = uy * ctx.lockedDistance;
          }
        }

        // Endpoint grip move: show stretched ghost instead of translated ghost
        if (ctx.selectedGrip && ctx.activeTool === 'move' && (ctx.selectedGrip.gripIndex === 0 || ctx.selectedGrip.gripIndex === 1)) {
          const shape = ctx.shapes.find(s => s.id === ctx.selectedGrip!.shapeId);
          if (shape) {
            const endpointKey = ctx.selectedGrip.gripIndex === 0 ? 'start' : 'end';
            const currentEndpoint = (shape as any)[endpointKey] as Point;
            const ghost = {
              ...shape,
              id: `preview-${shape.id}`,
              [endpointKey]: { x: currentEndpoint.x + dx, y: currentEndpoint.y + dy },
            } as Shape;
            ctx.setDrawingPreview({
              type: 'modifyPreview',
              shapes: [ghost],
              basePoint: pts[0],
              currentPoint: { x: pts[0].x + dx, y: pts[0].y + dy },
            });
            break;
          }
        }

        const transform = translateTransform(dx, dy);
        const childBeamsPreview = getPlateSystemChildShapes(ctx, selected);
        const allForPreview = [...selected, ...childBeamsPreview];
        const regularGhosts = allForPreview.map((s) => transformShape(s, transform));
        const paramGhosts = parametricGhosts.map((s) => transformShape(s, transform));
        ctx.setDrawingPreview({
          type: 'modifyPreview',
          shapes: [...regularGhosts, ...paramGhosts],
          basePoint: pts[0],
          currentPoint: { x: pts[0].x + dx, y: pts[0].y + dy },
        });
      }
      break;
    }
    case 'rotate': {
      if (pts.length === 1) {
        // After center is set: show ray from center to cursor (start angle reference)
        ctx.setDrawingPreview({
          type: 'rotateGuide',
          center: pts[0],
          endRay: worldPos,
          shapes: [],
        });
      } else if (pts.length === 2) {
        const center = pts[0];
        const startAngle = Math.atan2(pts[1].y - center.y, pts[1].x - center.x);
        const endAngle = Math.atan2(worldPos.y - center.y, worldPos.x - center.x);
        const angle = endAngle - startAngle;
        const transform = rotateTransform(center, angle);
        const childBeamsRotPreview = getPlateSystemChildShapes(ctx, selected);
        const allForRotPreview = [...selected, ...childBeamsRotPreview];
        const regularGhosts = allForRotPreview.map((s) => transformShape(s, transform));
        const paramGhosts = parametricGhosts.map((s) => transformShape(s, transform));
        ctx.setDrawingPreview({
          type: 'rotateGuide',
          center: pts[0],
          startRay: pts[1],
          endRay: worldPos,
          angle: angle * (180 / Math.PI),
          shapes: [...regularGhosts, ...paramGhosts],
        });
      }
      break;
    }
    case 'scale': {
      if (ctx.scaleMode === 'graphical') {
        if (pts.length === 1) {
          // After origin set: show line from origin to cursor (reference distance)
          ctx.setDrawingPreview({
            type: 'scaleGuide',
            origin: pts[0],
            currentPoint: worldPos,
            shapes: [],
          });
        } else if (pts.length === 2) {
          const origin = pts[0];
          const refDist = Math.hypot(pts[1].x - origin.x, pts[1].y - origin.y);
          const newDist = Math.hypot(worldPos.x - origin.x, worldPos.y - origin.y);
          const factor = refDist > 0.001 ? newDist / refDist : 1;
          const transform = scaleTransform(origin, factor);
          const childBeamsScalePreview = getPlateSystemChildShapes(ctx, selected);
          const allForScalePreview = [...selected, ...childBeamsScalePreview];
          const regularGhosts = allForScalePreview.map((s) => transformShape(s, transform));
          const paramGhosts = parametricGhosts.map((s) => transformShape(s, transform));
          ctx.setDrawingPreview({
            type: 'scaleGuide',
            origin: pts[0],
            refPoint: pts[1],
            currentPoint: worldPos,
            factor,
            shapes: [...regularGhosts, ...paramGhosts],
          });
        }
      }
      break;
    }
    case 'mirror': {
      if (pts.length === 1) {
        const transform = mirrorTransform(pts[0], worldPos);
        const childBeamsMirrorPreview = getPlateSystemChildShapes(ctx, selected);
        const allForMirrorPreview = [...selected, ...childBeamsMirrorPreview];
        const regularGhosts = allForMirrorPreview.map((s) => transformShape(s, transform));
        const paramGhosts = parametricGhosts.map((s) => transformShape(s, transform));
        ctx.setDrawingPreview({ type: 'mirrorAxis', start: pts[0], end: worldPos, shapes: [...regularGhosts, ...paramGhosts] });
      }
      break;
    }
    case 'array': {
      const childBeamsArrayPreview = getPlateSystemChildShapes(ctx, selected);
      const allForArrayPreview = [...selected, ...childBeamsArrayPreview];
      if (pts.length === 1 && (allForArrayPreview.length > 0 || parametricGhosts.length > 0)) {
        const basePoint = pts[0];
        const { dx, dy } = constrainDelta(worldPos.x - basePoint.x, worldPos.y - basePoint.y, ctx.modifyConstrainAxis);
        const dist = Math.hypot(dx, dy);
        if (dist > 0.001) {
          const ghosts: Shape[] = [];
          if (ctx.arrayMode === 'linear') {
            // Linear: distribute arrayCount copies from base to cursor
            for (let i = 1; i < ctx.arrayCount; i++) {
              const frac = i / (ctx.arrayCount - 1);
              const transform = translateTransform(dx * frac, dy * frac);
              for (const s of allForArrayPreview) {
                ghosts.push(transformShape(s, transform));
              }
              for (const s of parametricGhosts) {
                ghosts.push(transformShape(s, transform));
              }
            }
          } else {
            // Radial: base = center, distribute around arrayAngle
            const center = basePoint;
            const totalAngleRad = (ctx.arrayAngle * Math.PI) / 180;
            const angleStep = totalAngleRad / ctx.arrayCount;
            for (let i = 1; i < ctx.arrayCount; i++) {
              const angle = angleStep * i;
              const transform = rotateTransform(center, angle);
              for (const s of allForArrayPreview) {
                ghosts.push(transformShape(s, transform));
              }
              for (const s of parametricGhosts) {
                ghosts.push(transformShape(s, transform));
              }
            }
          }
          ctx.setDrawingPreview({
            type: 'modifyPreview',
            shapes: ghosts,
            basePoint: pts[0],
            currentPoint: worldPos,
          });
        }
      }
      break;
    }
    case 'elastic': {
      if (pts.length === 0) {
        // No points yet: nothing to preview
        ctx.setDrawingPreview(null);
      } else if (pts.length === 1) {
        // Phase 1->2: Draw green selection box from first click to cursor
        ctx.setDrawingPreview({
          type: 'elasticBox',
          start: pts[0],
          end: worldPos,
        });
      } else if (pts.length === 2) {
        // Phase 2->3: Box is set, waiting for base point.
        // Keep showing the selection box as frozen.
        ctx.setDrawingPreview({
          type: 'elasticBox',
          start: pts[0],
          end: pts[1],
        });
      } else if (pts.length === 3) {
        // Phase 3->4: base point set, show stretch preview
        const boxP1 = pts[0];
        const boxP2 = pts[1];
        const basePoint = pts[2];

        const boxMinX = Math.min(boxP1.x, boxP2.x);
        const boxMinY = Math.min(boxP1.y, boxP2.y);
        const boxMaxX = Math.max(boxP1.x, boxP2.x);
        const boxMaxY = Math.max(boxP1.y, boxP2.y);

        const dx = worldPos.x - basePoint.x;
        const dy = worldPos.y - basePoint.y;

        const isInsideBox = (p: Point) =>
          p.x >= boxMinX && p.x <= boxMaxX && p.y >= boxMinY && p.y <= boxMaxY;

        const drawingShapes = ctx.shapes.filter(s => s.drawingId === ctx.activeDrawingId && s.visible && !s.locked);
        const lineLikeTypes = ['line', 'beam', 'gridline', 'wall', 'level'];

        const ghosts: Shape[] = [];

        for (const shape of drawingShapes) {
          const bounds = getShapeBounds(shape);
          if (!bounds) continue;

          const fullyInside =
            bounds.minX >= boxMinX && bounds.maxX <= boxMaxX &&
            bounds.minY >= boxMinY && bounds.maxY <= boxMaxY;

          if (fullyInside) {
            const transform = translateTransform(dx, dy);
            ghosts.push(transformShape(shape, transform));
            continue;
          }

          if (lineLikeTypes.includes(shape.type)) {
            const s = shape as any;
            const startInside = isInsideBox(s.start);
            const endInside = isInsideBox(s.end);

            if (startInside || endInside) {
              // Create a ghost with stretched endpoints
              const ghostStart = startInside
                ? { x: s.start.x + dx, y: s.start.y + dy }
                : { ...s.start };
              const ghostEnd = endInside
                ? { x: s.end.x + dx, y: s.end.y + dy }
                : { ...s.end };
              ghosts.push({ ...shape, id: `preview-${shape.id}`, start: ghostStart, end: ghostEnd } as any);
            }
            continue;
          }

          if (shape.type === 'polyline' || shape.type === 'spline') {
            const s = shape as any;
            const anyInside = s.points.some((p: Point) => isInsideBox(p));
            if (anyInside) {
              const newPoints = s.points.map((p: Point) =>
                isInsideBox(p) ? { x: p.x + dx, y: p.y + dy } : { ...p }
              );
              ghosts.push({ ...shape, id: `preview-${shape.id}`, points: newPoints } as any);
            }
            continue;
          }

          // Hatch / slab: stretch individual boundary points
          if (shape.type === 'hatch' || shape.type === 'slab') {
            const s = shape as any;
            const anyInside = s.points.some((p: Point) => isInsideBox(p));
            if (anyInside) {
              const newPoints = s.points.map((p: Point) =>
                isInsideBox(p) ? { x: p.x + dx, y: p.y + dy } : { ...p }
              );
              ghosts.push({ ...shape, id: `preview-${shape.id}`, points: newPoints } as any);
            }
            continue;
          }

          // Plate-system / space / foundation-zone: stretch contour points
          if (shape.type === 'plate-system' || shape.type === 'space' || shape.type === 'foundation-zone') {
            const s = shape as any;
            const pts2 = s.contourPoints as Point[] | undefined;
            if (pts2 && pts2.some((p: Point) => isInsideBox(p))) {
              const newPoints = pts2.map((p: Point) =>
                isInsideBox(p) ? { x: p.x + dx, y: p.y + dy } : { ...p }
              );
              ghosts.push({ ...shape, id: `preview-${shape.id}`, contourPoints: newPoints } as any);
            }
            continue;
          }

          // Section-callout: stretch start/end like line-like
          if (shape.type === 'section-callout') {
            const s = shape as any;
            const startInside = isInsideBox(s.start);
            const endInside = isInsideBox(s.end);
            if (startInside || endInside) {
              const ghostStart = startInside ? { x: s.start.x + dx, y: s.start.y + dy } : { ...s.start };
              const ghostEnd = endInside ? { x: s.end.x + dx, y: s.end.y + dy } : { ...s.end };
              ghosts.push({ ...shape, id: `preview-${shape.id}`, start: ghostStart, end: ghostEnd } as any);
            }
            continue;
          }

          // Dimension: stretch individual dimension points
          if (shape.type === 'dimension') {
            const s = shape as any;
            if (s.points && s.points.length > 0) {
              const anyInside = s.points.some((p: Point) => isInsideBox(p));
              if (anyInside) {
                const newPoints = s.points.map((p: Point) =>
                  isInsideBox(p) ? { x: p.x + dx, y: p.y + dy } : { ...p }
                );
                ghosts.push({ ...shape, id: `preview-${shape.id}`, points: newPoints } as any);
              }
            }
            continue;
          }
        }

        ctx.setDrawingPreview({
          type: 'modifyPreview',
          shapes: ghosts,
          basePoint,
          currentPoint: worldPos,
        });
      }
      break;
    }
    case 'align': {
      if (pts.length === 1) {
        // After source point is set: show ghost shapes translated from source to cursor
        const adx = worldPos.x - pts[0].x;
        const ady = worldPos.y - pts[0].y;
        const alignTransform = translateTransform(adx, ady);
        const regularGhosts = selected.map((s) => transformShape(s, alignTransform));
        const paramGhosts = parametricGhosts.map((s) => transformShape(s, alignTransform));
        ctx.setDrawingPreview({
          type: 'modifyPreview',
          shapes: [...regularGhosts, ...paramGhosts],
          basePoint: pts[0],
          currentPoint: worldPos,
        });
      }
      break;
    }
    case 'offset': {
      const hoveredShape = ctx.hoveredShapeId ? ctx.shapes.find(s => s.id === ctx.hoveredShapeId) : null;
      if (hoveredShape) {
        const result = offsetShape(hoveredShape, ctx.offsetDistance, worldPos, ctx.offsetFlipped);
        if (result) {
          ctx.setDrawingPreview({ type: 'modifyPreview', shapes: [result] });
        } else {
          ctx.setDrawingPreview(null);
        }
      } else {
        ctx.setDrawingPreview(null);
      }
      break;
    }
    default:
      ctx.setDrawingPreview(null);
      break;
  }
}
