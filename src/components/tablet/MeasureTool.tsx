import { useAppStore } from '../../state/appStore';
import { formatLength } from '../../units';
import { fromMM } from '../../units/conversion';

interface MeasurePoint {
  worldX: number;
  worldY: number;
}

interface MeasureToolProps {
  pointA: MeasurePoint | null;
  pointB: MeasurePoint | null;
  areaMode: boolean;
  areaPoints: MeasurePoint[];
  onToggleMode: () => void;
  isLight: boolean;
}

function worldToScreen(
  wx: number,
  wy: number,
  viewport: { offsetX: number; offsetY: number; zoom: number },
) {
  return {
    x: wx * viewport.zoom + viewport.offsetX,
    y: wy * viewport.zoom + viewport.offsetY,
  };
}

function computeArea(points: MeasurePoint[]): number {
  // Shoelace formula
  let sum = 0;
  const n = points.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    sum += points[i].worldX * points[j].worldY;
    sum -= points[j].worldX * points[i].worldY;
  }
  return Math.abs(sum) / 2;
}

export function MeasureTool({ pointA, pointB, areaMode, areaPoints, onToggleMode, isLight: _isLight }: MeasureToolProps) {
  const viewport = useAppStore(s => s.viewport);
  const unitSettings = useAppStore(s => s.unitSettings);

  const renderPoint = (sx: number, sy: number) => (
    <>
      <circle cx={sx} cy={sy} r={6} fill="none" stroke="#3b82f6" strokeWidth={2} />
      <circle cx={sx} cy={sy} r={2} fill="#3b82f6" />
    </>
  );

  // Mode toggle pill
  const modePill = (
    <foreignObject x={8} y={8} width="160" height="32">
      <div className="flex items-center bg-gray-800/90 backdrop-blur-sm rounded-full p-0.5" style={{ width: 'fit-content' }}>
        <button
          onClick={onToggleMode}
          className={`px-3 py-1 text-xs rounded-full transition-colors ${
            !areaMode ? 'bg-blue-600 text-white' : 'text-gray-400'
          }`}
        >
          Distance
        </button>
        <button
          onClick={onToggleMode}
          className={`px-3 py-1 text-xs rounded-full transition-colors ${
            areaMode ? 'bg-blue-600 text-white' : 'text-gray-400'
          }`}
        >
          Area
        </button>
      </div>
    </foreignObject>
  );

  // Area mode rendering
  if (areaMode) {
    const screenPts = areaPoints.map(p => worldToScreen(p.worldX, p.worldY, viewport));

    // Check if polygon is closed (3+ points and area can be computed)
    const isClosed = areaPoints.length >= 3;
    const areaMM2 = isClosed ? computeArea(areaPoints) : 0;

    // Format area: convert mm² to unit²
    let areaLabel = '';
    if (isClosed && areaMM2 > 0) {
      // Convert from mm² to display unit²
      const oneMM = fromMM(1, unitSettings.lengthUnit);
      const areaConverted = areaMM2 * oneMM * oneMM;
      const suffix = unitSettings.lengthUnit === 'ft-in' ? 'ft' : unitSettings.lengthUnit;
      areaLabel = `${areaConverted.toFixed(unitSettings.lengthPrecision)} ${suffix}\u00B2`;
    }

    return (
      <svg
        className="fixed inset-0 pointer-events-none"
        style={{ zIndex: 35 }}
        width="100%"
        height="100%"
      >
        {/* Mode pill needs pointer events */}
        <g style={{ pointerEvents: 'auto' }}>{modePill}</g>

        {/* Polygon fill */}
        {screenPts.length >= 3 && (
          <polygon
            points={screenPts.map(p => `${p.x},${p.y}`).join(' ')}
            fill="rgba(59, 130, 246, 0.15)"
            stroke="#3b82f6"
            strokeWidth={2}
            strokeDasharray="6 4"
          />
        )}

        {/* Lines between points */}
        {screenPts.length >= 2 && screenPts.map((p, i) => {
          if (i === 0) return null;
          const prev = screenPts[i - 1];
          return (
            <line key={i} x1={prev.x} y1={prev.y} x2={p.x} y2={p.y} stroke="#3b82f6" strokeWidth={2} strokeDasharray="6 4" />
          );
        })}

        {/* Points */}
        {screenPts.map((p, i) => (
          <g key={i}>{renderPoint(p.x, p.y)}</g>
        ))}

        {/* Area label */}
        {isClosed && areaLabel && (() => {
          const cx = screenPts.reduce((s, p) => s + p.x, 0) / screenPts.length;
          const cy = screenPts.reduce((s, p) => s + p.y, 0) / screenPts.length;
          return (
            <>
              <rect
                x={cx - areaLabel.length * 4 - 6}
                y={cy - 12}
                width={areaLabel.length * 8 + 12}
                height={20}
                rx={4}
                fill="rgba(0,0,0,0.75)"
              />
              <text
                x={cx}
                y={cy + 2}
                textAnchor="middle"
                fill="white"
                fontSize={12}
                fontFamily="system-ui, sans-serif"
              >
                {areaLabel}
              </text>
            </>
          );
        })()}
      </svg>
    );
  }

  // Distance mode
  if (!pointA) {
    return (
      <svg
        className="fixed inset-0 pointer-events-none"
        style={{ zIndex: 35 }}
        width="100%"
        height="100%"
      >
        <g style={{ pointerEvents: 'auto' }}>{modePill}</g>
      </svg>
    );
  }

  const a = worldToScreen(pointA.worldX, pointA.worldY, viewport);

  if (!pointB) {
    return (
      <svg
        className="fixed inset-0 pointer-events-none"
        style={{ zIndex: 35 }}
        width="100%"
        height="100%"
      >
        <g style={{ pointerEvents: 'auto' }}>{modePill}</g>
        {renderPoint(a.x, a.y)}
      </svg>
    );
  }

  const b = worldToScreen(pointB.worldX, pointB.worldY, viewport);

  // Distance in world units (mm)
  const dx = pointB.worldX - pointA.worldX;
  const dy = pointB.worldY - pointA.worldY;
  const distMM = Math.sqrt(dx * dx + dy * dy);
  const distLabel = formatLength(distMM, unitSettings);

  // Label position at midpoint, offset slightly above the line
  const midX = (a.x + b.x) / 2;
  const midY = (a.y + b.y) / 2;

  const lineLen = Math.sqrt((b.x - a.x) ** 2 + (b.y - a.y) ** 2);
  const offsetDist = 20;
  let offX = 0;
  let offY = -offsetDist;
  if (lineLen > 1) {
    const nx = -(b.y - a.y) / lineLen;
    const ny = (b.x - a.x) / lineLen;
    offX = nx * offsetDist;
    offY = ny * offsetDist;
    if (offY > 0) {
      offX = -offX;
      offY = -offY;
    }
  }

  return (
    <svg
      className="fixed inset-0 pointer-events-none"
      style={{ zIndex: 35 }}
      width="100%"
      height="100%"
    >
      <g style={{ pointerEvents: 'auto' }}>{modePill}</g>

      {/* Line between points */}
      <line
        x1={a.x} y1={a.y} x2={b.x} y2={b.y}
        stroke="#3b82f6" strokeWidth={2} strokeDasharray="6 4"
      />

      {/* Points */}
      {renderPoint(a.x, a.y)}
      {renderPoint(b.x, b.y)}

      {/* Distance label */}
      <rect
        x={midX + offX - 4}
        y={midY + offY - 12}
        width={distLabel.length * 8 + 12}
        height={20}
        rx={4}
        fill="rgba(0,0,0,0.75)"
      />
      <text
        x={midX + offX + distLabel.length * 4 + 2}
        y={midY + offY + 2}
        textAnchor="middle"
        fill="white"
        fontSize={12}
        fontFamily="system-ui, sans-serif"
      >
        {distLabel}
      </text>
    </svg>
  );
}
