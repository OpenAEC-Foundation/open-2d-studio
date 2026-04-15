/**
 * Shared utilities for filled-region sketch operations.
 * Used by Ribbon, ToolOptionsBar, useKeyboardShortcuts, and useCanvasEvents.
 */

import type { Point } from '../../types/geometry';
import { useAppStore } from '../../state/appStore';
import { computePolygonArea } from './SpaceDetector';
import { isPointInPolygon } from './GeometryUtils';

export type SkPt = { x: number; y: number };
export interface SkEdge { p1: SkPt; p2: SkPt; bulge?: number; }

/** Extract edges (with bulge) from sketch shape IDs. */
export function extractSkEdges(shapeIds: string[], allShapes: any[]): SkEdge[] {
  const sketchShapes = allShapes.filter((sh: any) => shapeIds.includes(sh.id));
  const edges: SkEdge[] = [];
  for (const shape of sketchShapes) {
    if (shape.type === 'line') {
      edges.push({ p1: shape.start, p2: shape.end });
    } else if (shape.type === 'arc') {
      const { center, radius, startAngle, endAngle } = shape;
      // ArcShape angles are in DEGREES — convert to radians for Math.cos/sin
      const sa = startAngle * Math.PI / 180;
      const ea = endAngle * Math.PI / 180;
      const p1 = { x: center.x + radius * Math.cos(sa), y: center.y + radius * Math.sin(sa) };
      const p2 = { x: center.x + radius * Math.cos(ea), y: center.y + radius * Math.sin(ea) };
      let theta = ea - sa;
      while (theta > Math.PI * 2) theta -= Math.PI * 2;
      while (theta < -Math.PI * 2) theta += Math.PI * 2;
      edges.push({ p1, p2, bulge: Math.tan(theta / 4) });
    } else if (shape.type === 'polyline' && shape.points?.length >= 2) {
      // Support polyline sketch shapes
      const pts = shape.points;
      const shapeBulges = shape.bulge || [];
      for (let i = 0; i < pts.length - 1; i++) {
        edges.push({ p1: pts[i], p2: pts[i + 1], bulge: shapeBulges[i] ?? 0 });
      }
      if (shape.closed && pts.length >= 3) {
        edges.push({ p1: pts[pts.length - 1], p2: pts[0], bulge: shapeBulges[pts.length - 1] ?? 0 });
      }
    }
  }
  return edges;
}

/** Chain edges into a closed loop. Returns null if not closed within tolerance. */
export function chainSkEdges(edges: SkEdge[], tol: number): { points: SkPt[]; bulges: number[] } | null {
  if (edges.length === 0) return null;
  const dist2 = (a: SkPt, b: SkPt) => {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    return dx * dx + dy * dy;
  };
  const ptClose = (a: SkPt, b: SkPt) => dist2(a, b) <= tol * tol;
  const used = new Array(edges.length).fill(false);
  const pts: SkPt[] = [];
  const bulges: number[] = [];
  used[0] = true;
  pts.push({ ...edges[0].p1 }, { ...edges[0].p2 });
  bulges.push(edges[0].bulge ?? 0);
  let attached = 0;
  while (attached < edges.length - 1) {
    const last = pts[pts.length - 1];
    let found = false;
    for (let i = 0; i < edges.length; i++) {
      if (used[i]) continue;
      if (ptClose(last, edges[i].p1)) {
        pts.push({ ...edges[i].p2 }); bulges.push(edges[i].bulge ?? 0); used[i] = true; found = true; attached++; break;
      } else if (ptClose(last, edges[i].p2)) {
        pts.push({ ...edges[i].p1 }); bulges.push(-(edges[i].bulge ?? 0)); used[i] = true; found = true; attached++; break;
      }
    }
    if (!found) break;
  }

  // Check if the loop closes within tolerance
  if (ptClose(pts[0], pts[pts.length - 1])) {
    pts.pop();
    if (pts.length < 3) return null;
    return { points: pts, bulges };
  }

  // Fallback: if the gap is small enough (< 100mm), force-close by snapping last point to first
  const gap = Math.sqrt(dist2(pts[0], pts[pts.length - 1]));
  const FORCE_CLOSE_THRESHOLD = 100; // mm
  if (gap < FORCE_CLOSE_THRESHOLD && pts.length >= 3) {
    console.info(`[Sketch] Force-closing boundary: gap=${gap.toFixed(1)}mm (< ${FORCE_CLOSE_THRESHOLD}mm threshold)`);
    // Replace last point with first point to close cleanly
    pts[pts.length - 1] = { ...pts[0] };
    pts.pop(); // remove the duplicate closing point
    return { points: pts, bulges };
  }

  return null;
}

const SKETCH_TOL = 20; // tolerance in mm for endpoint matching

/**
 * Extract ALL separate closed loops from a set of edges.
 * Each loop uses the same chaining logic as chainSkEdges, but the process
 * repeats until no more unused edges remain, producing multiple loops.
 */
function extractAllLoops(edges: SkEdge[], tol: number): Array<{ points: SkPt[]; bulges: number[] }> {
  const used = new Array(edges.length).fill(false);
  const loops: Array<{ points: SkPt[]; bulges: number[] }> = [];

  const ptClose = (a: SkPt, b: SkPt) => {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    return dx * dx + dy * dy <= tol * tol;
  };

  for (let startIdx = 0; startIdx < edges.length; startIdx++) {
    if (used[startIdx]) continue;

    // Begin a new loop from this edge
    used[startIdx] = true;
    const pts: SkPt[] = [{ ...edges[startIdx].p1 }, { ...edges[startIdx].p2 }];
    const bulges: number[] = [edges[startIdx].bulge ?? 0];

    // Chain until we can't extend
    let extended = true;
    while (extended) {
      extended = false;
      const last = pts[pts.length - 1];
      for (let i = 0; i < edges.length; i++) {
        if (used[i]) continue;
        if (ptClose(last, edges[i].p1)) {
          pts.push({ ...edges[i].p2 });
          bulges.push(edges[i].bulge ?? 0);
          used[i] = true;
          extended = true;
          break;
        } else if (ptClose(last, edges[i].p2)) {
          pts.push({ ...edges[i].p1 });
          bulges.push(-(edges[i].bulge ?? 0));
          used[i] = true;
          extended = true;
          break;
        }
      }
    }

    // Check if loop is closed and has enough points
    if (pts.length >= 4 && ptClose(pts[0], pts[pts.length - 1])) {
      pts.pop(); // Remove duplicate closing point
      loops.push({ points: pts, bulges });
    } else if (pts.length >= 4) {
      // Force-close fallback: if gap < 100mm, snap last to first
      const dx = pts[0].x - pts[pts.length - 1].x;
      const dy = pts[0].y - pts[pts.length - 1].y;
      const gap = Math.sqrt(dx * dx + dy * dy);
      if (gap < 100) {
        pts[pts.length - 1] = { ...pts[0] };
        pts.pop();
        loops.push({ points: pts, bulges });
      }
    }
  }

  return loops;
}

/**
 * Finish the filled region sketch — creates or updates a hatch from the sketch shapes.
 * Returns true if successful, false if the boundary is not closed.
 */
export function finishSketch(): boolean {
  const s = useAppStore.getState();
  const outerIds = s.sketchShapeIds;
  console.log(`[Sketch] finishSketch called: ${outerIds.length} sketch shapes, filledRegionMode=${s.filledRegionMode}`);
  if (outerIds.length === 0) {
    console.warn('[Sketch] No sketch shapes — nothing to finish');
    return false;
  }

  // Extract all edges from outer sketch shape IDs
  const outerEdges = extractSkEdges(outerIds, s.shapes);
  console.log(`[Sketch] Extracted ${outerEdges.length} edges from ${outerIds.length} sketch shapes`);
  if (outerEdges.length === 0) {
    console.warn('[Sketch] No edges extracted — sketch shapes may have been deleted');
    alert('Cannot finish: no boundary segments found. Draw at least 3 connected lines.');
    return false;
  }

  // Try to detect multiple separate closed loops within the outer sketch IDs
  const allLoops = extractAllLoops(outerEdges, SKETCH_TOL);

  let outerLoop: { points: SkPt[]; bulges: number[] } | null = null;
  const autoDetectedInnerLoops: SkPt[][] = [];

  if (allLoops.length > 1) {
    // Multiple loops detected — largest area is the outer boundary
    const loopsWithArea = allLoops.map(loop => ({
      loop,
      area: computePolygonArea(loop.points as Point[]),
    }));
    loopsWithArea.sort((a, b) => b.area - a.area);

    outerLoop = loopsWithArea[0].loop;

    // Smaller loops that are fully inside the outer loop become inner loops (holes)
    for (let i = 1; i < loopsWithArea.length; i++) {
      const candidate = loopsWithArea[i].loop;
      // Test one point of candidate against the outer loop
      const testPoint = candidate.points[0] as Point;
      if (isPointInPolygon(testPoint, outerLoop.points as Point[])) {
        autoDetectedInnerLoops.push(candidate.points);
      }
      // If it's NOT inside, it's another outer region — skip for now
    }
  } else {
    // Single loop or fallback to chainSkEdges
    outerLoop = chainSkEdges(outerEdges, SKETCH_TOL);
  }

  if (!outerLoop) {
    // Debug: show what we have
    const firstPt = outerEdges[0]?.p1;
    const lastEdge = outerEdges[outerEdges.length - 1];
    const lastPt = lastEdge?.p2;
    const gap = firstPt && lastPt ? Math.sqrt((firstPt.x - lastPt.x) ** 2 + (firstPt.y - lastPt.y) ** 2).toFixed(1) : '?';
    console.warn(`[Sketch] Cannot close boundary: ${outerEdges.length} edges, gap=${gap}mm, tol=${SKETCH_TOL}mm`);
    outerEdges.forEach((e, i) => console.warn(`  edge ${i}: (${e.p1.x.toFixed(1)},${e.p1.y.toFixed(1)}) → (${e.p2.x.toFixed(1)},${e.p2.y.toFixed(1)}) bulge=${e.bulge?.toFixed(3) ?? 0}`));
    alert(`Cannot finish: boundary not closed (${outerEdges.length} edges, gap=${gap}mm). Tip: zoom in and connect the last segment to the first point.`);
    return false;
  }

  // Chain explicitly-defined inner loops (from sketchInnerLoopShapeIds)
  const innerLoops: SkPt[][] = [...autoDetectedInnerLoops];
  for (const innerIds of s.sketchInnerLoopShapeIds) {
    if (innerIds.length >= 3) {
      const innerEdges = extractSkEdges(innerIds, s.shapes);
      const innerLoop = chainSkEdges(innerEdges, SKETCH_TOL);
      if (innerLoop) {
        innerLoops.push(innerLoop.points);
      }
    }
  }

  const hasBulge = outerLoop.bulges.some((b) => b !== 0);
  const frtId = s.selectedFilledRegionTypeId;
  const frt = frtId ? (s as any).filledRegionTypes?.find((t: any) => t.id === frtId) : undefined;
  const editingHatchId = s.editingHatchId;

  if (editingHatchId) {
    // Update existing hatch
    s.updateShape(editingHatchId, {
      visible: true,
      points: outerLoop.points,
      bulge: hasBulge ? outerLoop.bulges : undefined,
      innerLoops: innerLoops.length > 0 ? innerLoops : undefined,
    } as any);
  } else {
    // Create new hatch
    s.addShape({
      id: `hatch_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      type: 'hatch',
      layerId: s.activeLayerId,
      drawingId: s.activeDrawingId,
      style: { ...s.currentStyle },
      visible: true,
      locked: false,
      points: outerLoop.points,
      bulge: hasBulge ? outerLoop.bulges : undefined,
      innerLoops: innerLoops.length > 0 ? innerLoops : undefined,
      patternType: frt ? frt.fgPatternType : s.hatchPatternType,
      patternAngle: frt ? frt.fgPatternAngle : s.hatchPatternAngle,
      patternScale: frt ? frt.fgPatternScale : s.hatchPatternScale,
      fillColor: frt ? frt.fgColor : s.hatchFillColor,
      backgroundColor: frt?.backgroundColor ?? s.hatchBackgroundColor ?? undefined,
      customPatternId: frt?.fgCustomPatternId ?? s.hatchCustomPatternId ?? undefined,
      bgPatternType: frt ? frt.bgPatternType : undefined,
      bgPatternAngle: frt ? frt.bgPatternAngle : undefined,
      bgPatternScale: frt ? frt.bgPatternScale : undefined,
      bgFillColor: frt ? frt.bgColor : undefined,
      bgCustomPatternId: frt ? frt.bgCustomPatternId : undefined,
      masking: frt ? frt.masking : undefined,
      filledRegionTypeId: frt?.id,
    } as any);
  }

  // Delete all sketch shapes
  const allSketchIds = [
    ...outerIds,
    ...s.sketchInnerLoopShapeIds.flat(),
  ];
  s.deleteShapes(allSketchIds);
  s.clearSketchShapeIds();
  s.clearSketchInnerLoops();
  s.finishFilledRegion();
  return true;
}

/**
 * Cancel the filled region sketch — removes all sketch shapes and restores hatch visibility.
 */
export function cancelSketch(): void {
  const s = useAppStore.getState();
  const outerIds = s.sketchShapeIds;
  const innerIds = s.sketchInnerLoopShapeIds.flat();
  const allIds = [...outerIds, ...innerIds];
  if (allIds.length > 0) s.deleteShapes(allIds);

  // If editing an existing hatch, restore its visibility
  if (s.editingHatchId) {
    s.updateShape(s.editingHatchId, { visible: true } as any);
  }

  s.clearSketchShapeIds();
  s.clearSketchInnerLoops();
  s.cancelFilledRegionMode();
}

/**
 * Enter hatch edit mode: start filledRegionMode, convert hatch boundary back to sketch shapes.
 * Preserves arc segments (bulge values).
 */
export function enterHatchEditMode(hatchId: string): void {
  const st = useAppStore.getState();
  const hatch = st.shapes.find(sh => sh.id === hatchId) as any;
  if (!hatch || hatch.type !== 'hatch') return;

  // Start filled region mode
  st.startFilledRegionMode();
  st.setEditingHatchId(hatch.id);

  const pts = hatch.points as Point[];
  const bulges: number[] = hatch.bulge ?? [];

  if (pts.length >= 2) {
    const generatedIds: string[] = [];
    for (let i = 0; i < pts.length; i++) {
      const p1 = pts[i];
      const p2 = pts[(i + 1) % pts.length];
      const bulge = bulges[i] ?? 0;

      const shapeId = `sketch_seg_${Date.now()}_${i}_${Math.random().toString(36).slice(2, 6)}`;

      if (Math.abs(bulge) > 0.0001) {
        // Convert bulge to arc parameters
        const dx = p2.x - p1.x;
        const dy = p2.y - p1.y;
        const d = Math.sqrt(dx * dx + dy * dy);
        const s2 = d / 2;
        const absBulge = Math.abs(bulge);
        const radius = s2 * (1 / absBulge + absBulge) / 2;
        const sagitta = absBulge * s2;

        // Chord midpoint
        const mx = (p1.x + p2.x) / 2;
        const my = (p1.y + p2.y) / 2;

        // Unit perpendicular to chord
        const px = -dy / d;
        const py = dx / d;

        const dist = radius - sagitta;
        const sign = bulge > 0 ? 1 : -1;
        const center = {
          x: mx + sign * dist * px,
          y: my + sign * dist * py,
        };

        const startAngle = Math.atan2(p1.y - center.y, p1.x - center.x);
        const endAngle = Math.atan2(p2.y - center.y, p2.x - center.x);
        const clockwise = bulge < 0;

        st.addShape({
          id: shapeId,
          type: 'arc',
          layerId: hatch.layerId,
          drawingId: hatch.drawingId,
          style: { ...st.currentStyle },
          visible: true,
          locked: false,
          center,
          radius,
          startAngle,
          endAngle,
          clockwise,
        } as any);
      } else {
        st.addShape({
          id: shapeId,
          type: 'line',
          layerId: hatch.layerId,
          drawingId: hatch.drawingId,
          style: { ...st.currentStyle },
          visible: true,
          locked: false,
          start: { ...p1 },
          end: { ...p2 },
        } as any);
      }

      generatedIds.push(shapeId);
    }

    // Register all generated sketch shape IDs
    for (const id of generatedIds) {
      st.addSketchShapeId(id);
    }
  }

  // Hide the original hatch while editing
  st.updateShape(hatch.id, { visible: false } as any);
}
