import { useRef, useState, useCallback } from 'react';
import type { MarkupToolType } from './MarkupToolbar';

interface Stroke {
  id: string;
  type: MarkupToolType;
  points: { x: number; y: number }[];
  color: string;
  width: number;
  opacity: number;
  text?: string;
}

interface MarkupCanvasProps {
  active: boolean;
  tool: MarkupToolType;
  color: string;
  width: number;
  strokes: Stroke[];
  onStrokesChange: (strokes: Stroke[]) => void;
}

let nextId = 1;

export function MarkupCanvas({ active, tool, color, width, strokes, onStrokesChange }: MarkupCanvasProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [currentPoints, setCurrentPoints] = useState<{ x: number; y: number }[]>([]);
  const [drawing, setDrawing] = useState(false);
  const [textInput, setTextInput] = useState<{ x: number; y: number; value: string } | null>(null);

  const getSvgPoint = useCallback((e: React.PointerEvent) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }, []);

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    if (!active) return;

    if (tool === 'text') {
      const pt = getSvgPoint(e);
      setTextInput({ x: pt.x, y: pt.y, value: '' });
      return;
    }

    setDrawing(true);
    const pt = getSvgPoint(e);
    setCurrentPoints([pt]);
    (e.target as Element).setPointerCapture?.(e.pointerId);
  }, [active, tool, getSvgPoint]);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!drawing) return;
    const pt = getSvgPoint(e);
    setCurrentPoints(prev => [...prev, pt]);
  }, [drawing, getSvgPoint]);

  const handlePointerUp = useCallback(() => {
    if (!drawing) return;
    setDrawing(false);

    if (currentPoints.length < 2) {
      setCurrentPoints([]);
      return;
    }

    const opacity = tool === 'highlighter' ? 0.3 : 1;
    const strokeWidth = tool === 'highlighter' ? width * 3 : width;

    const newStroke: Stroke = {
      id: `markup-${nextId++}`,
      type: tool,
      points: currentPoints,
      color,
      width: strokeWidth,
      opacity,
    };

    onStrokesChange([...strokes, newStroke]);
    setCurrentPoints([]);
  }, [drawing, currentPoints, tool, color, width, strokes, onStrokesChange]);

  const handleTextSubmit = useCallback(() => {
    if (!textInput || !textInput.value.trim()) {
      setTextInput(null);
      return;
    }
    const newStroke: Stroke = {
      id: `markup-${nextId++}`,
      type: 'text',
      points: [{ x: textInput.x, y: textInput.y }],
      color,
      width,
      opacity: 1,
      text: textInput.value,
    };
    onStrokesChange([...strokes, newStroke]);
    setTextInput(null);
  }, [textInput, color, width, strokes, onStrokesChange]);

  const buildPath = (points: { x: number; y: number }[]) => {
    if (points.length < 2) return '';
    let d = `M ${points[0].x} ${points[0].y}`;
    for (let i = 1; i < points.length; i++) {
      d += ` L ${points[i].x} ${points[i].y}`;
    }
    return d;
  };

  const renderStroke = (stroke: Stroke) => {
    switch (stroke.type) {
      case 'pen':
      case 'highlighter':
        return (
          <path
            key={stroke.id}
            d={buildPath(stroke.points)}
            fill="none"
            stroke={stroke.color}
            strokeWidth={stroke.width}
            strokeLinecap="round"
            strokeLinejoin="round"
            opacity={stroke.opacity}
          />
        );
      case 'arrow': {
        if (stroke.points.length < 2) return null;
        const start = stroke.points[0];
        const end = stroke.points[stroke.points.length - 1];
        const dx = end.x - start.x;
        const dy = end.y - start.y;
        const angle = Math.atan2(dy, dx);
        const headLen = 12;
        return (
          <g key={stroke.id} opacity={stroke.opacity}>
            <line x1={start.x} y1={start.y} x2={end.x} y2={end.y} stroke={stroke.color} strokeWidth={stroke.width} strokeLinecap="round" />
            <polygon
              points={`${end.x},${end.y} ${end.x - headLen * Math.cos(angle - 0.4)},${end.y - headLen * Math.sin(angle - 0.4)} ${end.x - headLen * Math.cos(angle + 0.4)},${end.y - headLen * Math.sin(angle + 0.4)}`}
              fill={stroke.color}
            />
          </g>
        );
      }
      case 'cloud': {
        if (stroke.points.length < 2) return null;
        const start = stroke.points[0];
        const end = stroke.points[stroke.points.length - 1];
        const x = Math.min(start.x, end.x);
        const y = Math.min(start.y, end.y);
        const w = Math.abs(end.x - start.x);
        const h = Math.abs(end.y - start.y);
        // Scalloped rectangle
        const scallops: string[] = [];
        const scallop = 12;
        // Top edge
        for (let sx = x; sx < x + w; sx += scallop) {
          scallops.push(`A ${scallop / 2} ${scallop / 2} 0 0 1 ${Math.min(sx + scallop, x + w)} ${y}`);
        }
        // Right edge
        for (let sy = y; sy < y + h; sy += scallop) {
          scallops.push(`A ${scallop / 2} ${scallop / 2} 0 0 1 ${x + w} ${Math.min(sy + scallop, y + h)}`);
        }
        // Bottom edge
        for (let sx = x + w; sx > x; sx -= scallop) {
          scallops.push(`A ${scallop / 2} ${scallop / 2} 0 0 1 ${Math.max(sx - scallop, x)} ${y + h}`);
        }
        // Left edge
        for (let sy = y + h; sy > y; sy -= scallop) {
          scallops.push(`A ${scallop / 2} ${scallop / 2} 0 0 1 ${x} ${Math.max(sy - scallop, y)}`);
        }
        return (
          <path
            key={stroke.id}
            d={`M ${x} ${y} ${scallops.join(' ')} Z`}
            fill="none"
            stroke={stroke.color}
            strokeWidth={stroke.width}
            opacity={stroke.opacity}
          />
        );
      }
      case 'text':
        if (!stroke.text || stroke.points.length === 0) return null;
        return (
          <text
            key={stroke.id}
            x={stroke.points[0].x}
            y={stroke.points[0].y}
            fill={stroke.color}
            fontSize={16}
            fontFamily="system-ui, sans-serif"
            opacity={stroke.opacity}
          >
            {stroke.text}
          </text>
        );
      default:
        return null;
    }
  };

  // Current drawing preview
  const renderPreview = () => {
    if (!drawing || currentPoints.length < 2) return null;

    if (tool === 'arrow') {
      const start = currentPoints[0];
      const end = currentPoints[currentPoints.length - 1];
      const dx = end.x - start.x;
      const dy = end.y - start.y;
      const angle = Math.atan2(dy, dx);
      const headLen = 12;
      return (
        <g opacity={0.7}>
          <line x1={start.x} y1={start.y} x2={end.x} y2={end.y} stroke={color} strokeWidth={width} strokeLinecap="round" />
          <polygon
            points={`${end.x},${end.y} ${end.x - headLen * Math.cos(angle - 0.4)},${end.y - headLen * Math.sin(angle - 0.4)} ${end.x - headLen * Math.cos(angle + 0.4)},${end.y - headLen * Math.sin(angle + 0.4)}`}
            fill={color}
          />
        </g>
      );
    }

    if (tool === 'cloud') {
      const start = currentPoints[0];
      const end = currentPoints[currentPoints.length - 1];
      const x = Math.min(start.x, end.x);
      const y = Math.min(start.y, end.y);
      const w = Math.abs(end.x - start.x);
      const h = Math.abs(end.y - start.y);
      return (
        <rect x={x} y={y} width={w} height={h} fill="none" stroke={color} strokeWidth={width} strokeDasharray="6 4" opacity={0.5} />
      );
    }

    const opacity = tool === 'highlighter' ? 0.3 : 0.7;
    const strokeWidth = tool === 'highlighter' ? width * 3 : width;
    return (
      <path
        d={buildPath(currentPoints)}
        fill="none"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity={opacity}
      />
    );
  };

  return (
    <svg
      ref={svgRef}
      className="fixed inset-0"
      style={{
        zIndex: 36,
        pointerEvents: active ? 'auto' : 'none',
        touchAction: 'none',
      }}
      width="100%"
      height="100%"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
    >
      {/* Rendered strokes */}
      {strokes.map(renderStroke)}

      {/* Preview */}
      {renderPreview()}

      {/* Text input overlay */}
      {textInput && (
        <foreignObject x={textInput.x} y={textInput.y - 20} width="200" height="30">
          <input
            type="text"
            autoFocus
            value={textInput.value}
            onChange={e => setTextInput({ ...textInput, value: e.target.value })}
            onKeyDown={e => {
              if (e.key === 'Enter') handleTextSubmit();
              if (e.key === 'Escape') setTextInput(null);
            }}
            onBlur={handleTextSubmit}
            className="w-full px-1 py-0.5 bg-white/90 text-black text-sm rounded border border-blue-400 outline-none"
            style={{ fontSize: 14 }}
          />
        </foreignObject>
      )}
    </svg>
  );
}
