/**
 * Shared utilities for filled-region sketch operations.
 * Used by Ribbon, ToolOptionsBar, useKeyboardShortcuts, and useCanvasEvents.
 */

import type { Point } from '../../types/geometry';
import { useAppStore } from '../../state/appStore';

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
      const p1 = { x: center.x + radius * Math.cos(startAngle), y: center.y + radius * Math.sin(startAngle) };
      const p2 = { x: center.x + radius * Math.cos(endAngle), y: center.y + radius * Math.sin(endAngle) };
      let theta = endAngle - startAngle;
      while (theta > Math.PI * 2) theta -= Math.PI * 2;
      while (theta < -Math.PI * 2) theta += Math.PI * 2;
      edges.push({ p1, p2, bulge: Math.tan(theta / 4) });
    }
  }
  return edges;
}

/** Chain edges into a closed loop. Returns null if not closed. */
export function chainSkEdges(edges: SkEdge[], tol: number): { points: SkPt[]; bulges: number[] } | null {
  if (edges.length === 0) return null;
  const ptClose = (a: SkPt, b: SkPt) => {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    return dx * dx + dy * dy <= tol * tol;
  };
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
  if (!ptClose(pts[0], pts[pts.length - 1])) return null;
  pts.pop();
  if (pts.length < 3) return null;
  return { points: pts, bulges };
}

const SKETCH_TOL = 5;

/**
 * Finish the filled region sketch — creates or updates a hatch from the sketch shapes.
 * Returns true if successful, false if the boundary is not closed.
 */
export function finishSketch(): boolean {
  const s = useAppStore.getState();
  const outerIds = s.sketchShapeIds;
  if (outerIds.length < 3) return false;

  // Chain outer boundary
  const outerEdges = extractSkEdges(outerIds, s.shapes);
  const outerLoop = chainSkEdges(outerEdges, SKETCH_TOL);
  if (!outerLoop) {
    alert('Cannot finish: the outer boundary is not a closed loop. Make sure all segments connect end-to-end.');
    return false;
  }

  // Chain inner loops
  const innerLoops: SkPt[][] = [];
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
          style: { ...st.currentStyle, strokeColor: '#00aaff', lineStyle: 'dashed' },
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
          style: { ...st.currentStyle, strokeColor: '#00aaff', lineStyle: 'dashed' },
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
