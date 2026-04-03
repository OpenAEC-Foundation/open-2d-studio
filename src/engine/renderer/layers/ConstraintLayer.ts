/**
 * ConstraintLayer — canvas overlay that visualises parametric constraint graphs.
 *
 * Draws:
 *  - Vertices as colored dots (color reflects constraint state)
 *  - Edge dimension labels showing parameter name + resolved value
 *
 * Color legend:
 *  - Blue   (#3b82f6) — free parameter (no formula, not locked)
 *  - Green  (#22c55e) — constrained (has formula)
 *  - Red    (#ef4444) — error (formula evaluation failed)
 *  - Gray   (#6b7280) — locked / read-only
 */

import type { Viewport } from '../types';
import type { Point } from '../../../types/geometry';
import type { ShapeConstraintGraph, Parameter } from '../../../types/constraints';
import { BaseRenderer } from '../core/BaseRenderer';

// ── Colour constants ──────────────────────────────────────────────────────────

const COLOR_FREE       = '#3b82f6';
const COLOR_CONSTRAINED = '#22c55e';
const COLOR_ERROR      = '#ef4444';
const COLOR_LOCKED     = '#6b7280';

const VERTEX_RADIUS = 4; // screen pixels

// ── Helpers ───────────────────────────────────────────────────────────────────

function paramColor(param: Parameter, hasError: boolean): string {
  if (hasError)         return COLOR_ERROR;
  if (param.isReadOnly) return COLOR_LOCKED;
  if (param.formula)    return COLOR_CONSTRAINED;
  return COLOR_FREE;
}

// ── ConstraintLayer ───────────────────────────────────────────────────────────

export class ConstraintLayer extends BaseRenderer {
  /**
   * Draw the constraint overlay for a single shape.
   *
   * @param constraintGraph  The ShapeConstraintGraph attached to the shape.
   * @param position         Shape insertion point in world coordinates.
   * @param rotation         Shape rotation in radians.
   * @param scale            Shape scale factor.
   * @param viewport         Current viewport (for world→screen transforms).
   * @param errorMap         Optional map of paramId → error indicator.
   */
  drawConstraintOverlay(
    constraintGraph: ShapeConstraintGraph,
    position: Point,
    rotation: number,
    scale: number,
    viewport: Viewport = { offsetX: 0, offsetY: 0, zoom: 1 },
    errorMap: Map<string, boolean> = new Map()
  ): void {
    const ctx = this.ctx;
    const { vertices, edges, parameters } = constraintGraph;

    // Build a quick lookup: id → Parameter
    const paramById = new Map<string, Parameter>();
    for (const p of parameters) paramById.set(p.id, p);

    // Build vertex world positions (apply shape transform)
    // Vertices store their positions via xParamId / yParamId which resolve to
    // numeric values in the parameter list.  Fall back to zero if missing.
    const vertexScreenPos = new Map<string, { x: number; y: number }>();
    const zoom = viewport.zoom;

    for (const vertex of vertices) {
      const xParam = paramById.get(vertex.xParamId);
      const yParam = paramById.get(vertex.yParamId);

      const lx = typeof xParam?.value === 'number' ? xParam.value : 0;
      const ly = typeof yParam?.value === 'number' ? yParam.value : 0;

      // Apply shape rotation + scale + translation
      const cosR = Math.cos(rotation);
      const sinR = Math.sin(rotation);
      const wx = (lx * cosR - ly * sinR) * scale + position.x;
      const wy = (lx * sinR + ly * cosR) * scale + position.y;

      const screen = this.worldToScreen({ x: wx, y: wy }, viewport);
      vertexScreenPos.set(vertex.id, screen);
    }

    ctx.save();

    // ── Draw edges (dimension labels) ────────────────────────────────────────
    for (const edge of edges) {
      const startPos = vertexScreenPos.get(edge.startVertexId);
      const endPos   = vertexScreenPos.get(edge.endVertexId);
      if (!startPos || !endPos) continue;

      // Midpoint of edge
      const mx = (startPos.x + endPos.x) / 2;
      const my = (startPos.y + endPos.y) / 2;

      // Determine associated parameter (length or angle)
      const linkedParamId = edge.lengthParamId ?? edge.angleParamId;
      const linkedParam = linkedParamId ? paramById.get(linkedParamId) : undefined;

      if (linkedParam) {
        const hasError = errorMap.get(linkedParam.id) ?? false;
        const color = paramColor(linkedParam, hasError);

        // Draw a faint edge line
        ctx.beginPath();
        ctx.moveTo(startPos.x, startPos.y);
        ctx.lineTo(endPos.x, endPos.y);
        ctx.strokeStyle = color + '66'; // semi-transparent
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 3]);
        ctx.stroke();
        ctx.setLineDash([]);

        // Label: "name = value unit"
        const unitStr = linkedParam.unit && linkedParam.unit !== 'none' ? ` ${linkedParam.unit}` : '';
        const label = `${linkedParam.name} = ${String(linkedParam.value)}${unitStr}`;
        const fontSize = Math.max(10, 11 / zoom);

        ctx.fillStyle = color;
        ctx.font = `${fontSize}px monospace`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        ctx.fillText(label, mx, my - 4);
      }
    }

    // ── Draw vertices ─────────────────────────────────────────────────────────
    for (const vertex of vertices) {
      const pos = vertexScreenPos.get(vertex.id);
      if (!pos) continue;

      // Pick a representative parameter to determine colour
      const xParam = paramById.get(vertex.xParamId);
      const hasErr = xParam ? (errorMap.get(xParam.id) ?? false) : false;
      const color = xParam ? paramColor(xParam, hasErr) : COLOR_FREE;

      // Outer dot
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, VERTEX_RADIUS + 1, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.fill();

      // Coloured inner dot
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, VERTEX_RADIUS, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
    }

    ctx.restore();
  }
}
