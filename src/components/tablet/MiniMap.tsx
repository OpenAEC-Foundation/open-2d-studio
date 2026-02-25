import { useRef, useEffect, useCallback } from 'react';
import { useAppStore } from '../../state/appStore';
import { calculateDrawingBounds } from '../../services/drawing/drawingService';

const MAP_W = 140;
const MAP_H = 100;

interface MiniMapProps {
  visible: boolean;
  isLight: boolean;
}

export function MiniMap({ visible, isLight }: MiniMapProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dragging = useRef(false);
  const boundsRef = useRef<{ minX: number; minY: number; maxX: number; maxY: number } | null>(null);

  const shapes = useAppStore(s => s.shapes);
  const activeDrawingId = useAppStore(s => s.activeDrawingId);
  const viewport = useAppStore(s => s.viewport);
  const canvasSize = useAppStore(s => s.canvasSize);
  const setViewport = useAppStore(s => s.setViewport);

  // Render mini-map
  useEffect(() => {
    if (!visible) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = MAP_W * dpr;
    canvas.height = MAP_H * dpr;
    ctx.scale(dpr, dpr);

    ctx.clearRect(0, 0, MAP_W, MAP_H);

    const bounds = calculateDrawingBounds(shapes, activeDrawingId);
    if (!bounds) {
      boundsRef.current = null;
      return;
    }
    boundsRef.current = bounds;

    const padding = 10;
    const bw = bounds.maxX - bounds.minX;
    const bh = bounds.maxY - bounds.minY;
    if (bw <= 0 || bh <= 0) return;

    const scale = Math.min((MAP_W - padding * 2) / bw, (MAP_H - padding * 2) / bh);
    const ox = padding + ((MAP_W - padding * 2) - bw * scale) / 2;
    const oy = padding + ((MAP_H - padding * 2) - bh * scale) / 2;

    const toMap = (wx: number, wy: number) => ({
      x: ox + (wx - bounds.minX) * scale,
      y: oy + (wy - bounds.minY) * scale,
    });

    // Draw shapes as dots/lines
    ctx.strokeStyle = isLight ? '#666' : '#aaa';
    ctx.fillStyle = isLight ? '#888' : '#ccc';
    ctx.lineWidth = 0.5;

    const drawingShapes = shapes.filter(s => s.drawingId === activeDrawingId);
    for (const shape of drawingShapes) {
      if ('start' in shape && 'end' in shape) {
        const s = shape as { start: { x: number; y: number }; end: { x: number; y: number } };
        const a = toMap(s.start.x, s.start.y);
        const b = toMap(s.end.x, s.end.y);
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      } else if ('center' in shape && 'radius' in shape) {
        const s = shape as { center: { x: number; y: number }; radius: number };
        const c = toMap(s.center.x, s.center.y);
        const r = Math.max(1, s.radius * scale);
        ctx.beginPath();
        ctx.arc(c.x, c.y, Math.min(r, 8), 0, Math.PI * 2);
        ctx.stroke();
      } else if ('position' in shape) {
        const s = shape as { position: { x: number; y: number } };
        const p = toMap(s.position.x, s.position.y);
        ctx.fillRect(p.x - 0.5, p.y - 0.5, 1, 1);
      } else if ('points' in shape) {
        const s = shape as { points: { x: number; y: number }[] };
        if (s.points.length > 0) {
          ctx.beginPath();
          const first = toMap(s.points[0].x, s.points[0].y);
          ctx.moveTo(first.x, first.y);
          for (let i = 1; i < s.points.length; i++) {
            const p = toMap(s.points[i].x, s.points[i].y);
            ctx.lineTo(p.x, p.y);
          }
          ctx.stroke();
        }
      }
    }

    // Draw viewport rectangle
    const vLeft = (0 - viewport.offsetX) / viewport.zoom;
    const vTop = (0 - viewport.offsetY) / viewport.zoom;
    const vRight = (canvasSize.width - viewport.offsetX) / viewport.zoom;
    const vBottom = (canvasSize.height - viewport.offsetY) / viewport.zoom;

    const tl = toMap(vLeft, vTop);
    const br = toMap(vRight, vBottom);
    const rw = br.x - tl.x;
    const rh = br.y - tl.y;

    ctx.strokeStyle = '#3b82f6';
    ctx.lineWidth = 1.5;
    ctx.fillStyle = 'rgba(59, 130, 246, 0.15)';
    ctx.fillRect(tl.x, tl.y, rw, rh);
    ctx.strokeRect(tl.x, tl.y, rw, rh);
  }, [visible, shapes, activeDrawingId, viewport, canvasSize, isLight]);

  const mapToWorld = useCallback((mapX: number, mapY: number) => {
    const bounds = boundsRef.current;
    if (!bounds) return null;
    const bw = bounds.maxX - bounds.minX;
    const bh = bounds.maxY - bounds.minY;
    if (bw <= 0 || bh <= 0) return null;

    const padding = 10;
    const scale = Math.min((MAP_W - padding * 2) / bw, (MAP_H - padding * 2) / bh);
    const ox = padding + ((MAP_W - padding * 2) - bw * scale) / 2;
    const oy = padding + ((MAP_H - padding * 2) - bh * scale) / 2;

    const wx = (mapX - ox) / scale + bounds.minX;
    const wy = (mapY - oy) / scale + bounds.minY;
    return { x: wx, y: wy };
  }, []);

  const panToMapPoint = useCallback((mapX: number, mapY: number) => {
    const world = mapToWorld(mapX, mapY);
    if (!world) return;
    // Center viewport on this world point
    setViewport({
      offsetX: canvasSize.width / 2 - world.x * viewport.zoom,
      offsetY: canvasSize.height / 2 - world.y * viewport.zoom,
    });
  }, [mapToWorld, setViewport, canvasSize, viewport.zoom]);

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    e.stopPropagation();
    dragging.current = true;
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    panToMapPoint(e.clientX - rect.left, e.clientY - rect.top);
  }, [panToMapPoint]);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragging.current) return;
    e.stopPropagation();
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    panToMapPoint(e.clientX - rect.left, e.clientY - rect.top);
  }, [panToMapPoint]);

  const handlePointerUp = useCallback(() => {
    dragging.current = false;
  }, []);

  if (!visible) return null;

  return (
    <div
      className={`fixed rounded-lg border overflow-hidden ${
        isLight ? 'bg-white/60 border-black/10' : 'bg-black/60 border-white/10'
      } backdrop-blur-sm opacity-40 hover:opacity-100 transition-opacity`}
      style={{
        zIndex: 29,
        width: MAP_W,
        height: MAP_H,
        right: 'calc(12px + env(safe-area-inset-right, 0px))',
        bottom: 'calc(80px + env(safe-area-inset-bottom, 0px))',
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerLeave={handlePointerUp}
    >
      <canvas
        ref={canvasRef}
        style={{ width: MAP_W, height: MAP_H }}
      />
    </div>
  );
}
