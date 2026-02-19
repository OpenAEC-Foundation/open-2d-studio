import { useAppStore } from '../../../state/appStore';
import type { SnapType } from '../../../types/geometry';

interface SnapTypeOption {
  type: SnapType;
  label: string;
  description: string;
  symbol: string;
  color: string;
}

const snapTypes: SnapTypeOption[] = [
  { type: 'endpoint', label: 'Endpoint', description: 'Snap to endpoints of lines, arcs, and polyline vertices', symbol: '\u25A1', color: '#00ff00' },
  { type: 'midpoint', label: 'Midpoint', description: 'Snap to midpoints of lines and arc segments', symbol: '\u25B3', color: '#00ffff' },
  { type: 'center', label: 'Center', description: 'Snap to centers of circles, arcs, and ellipses', symbol: '\u25CB', color: '#ff00ff' },
  { type: 'intersection', label: 'Intersection', description: 'Snap to intersections of lines and curves', symbol: '\u00D7', color: '#ffff00' },
  { type: 'perpendicular', label: 'Perpendicular', description: 'Snap perpendicular to lines', symbol: '\u22A5', color: '#ff8800' },
  { type: 'parallel', label: 'Parallel', description: 'Snap parallel to lines', symbol: '\u2225', color: '#ff8800' },
  { type: 'tangent', label: 'Tangent', description: 'Snap tangent to circles and arcs', symbol: '\u25CE', color: '#88ff00' },
  { type: 'nearest', label: 'Nearest', description: 'Snap to nearest point on an object', symbol: '\u25C7', color: '#ff88ff' },
  { type: 'origin', label: 'Origin', description: 'Snap to the coordinate origin (0,0)', symbol: '\u2295', color: '#ff4444' },
  { type: 'grid', label: 'Grid', description: 'Snap to grid intersections', symbol: '+', color: '#8888ff' },
];

const POLAR_ANGLES = [5, 10, 15, 30, 45, 90];

export function DrawingAidsTab() {
  const activeSnaps = useAppStore(s => s.activeSnaps);
  const toggleSnapType = useAppStore(s => s.toggleSnapType);
  const snapEnabled = useAppStore(s => s.snapEnabled);
  const toggleSnap = useAppStore(s => s.toggleSnap);
  const snapTolerance = useAppStore(s => s.snapTolerance);
  const setSnapTolerance = useAppStore(s => s.setSnapTolerance);
  const polarTrackingEnabled = useAppStore(s => s.polarTrackingEnabled);
  const togglePolarTracking = useAppStore(s => s.togglePolarTracking);
  const polarAngleIncrement = useAppStore(s => s.polarAngleIncrement);
  const setPolarAngleIncrement = useAppStore(s => s.setPolarAngleIncrement);
  const orthoMode = useAppStore(s => s.orthoMode);
  const toggleOrthoMode = useAppStore(s => s.toggleOrthoMode);
  const objectTrackingEnabled = useAppStore(s => s.objectTrackingEnabled);
  const toggleObjectTracking = useAppStore(s => s.toggleObjectTracking);
  const dynamicInputEnabled = useAppStore(s => s.dynamicInputEnabled);
  const toggleDynamicInput = useAppStore(s => s.toggleDynamicInput);
  const showRotationGizmo = useAppStore(s => s.showRotationGizmo);
  const toggleShowRotationGizmo = useAppStore(s => s.toggleRotationGizmo);

  const handleSelectAll = () => {
    for (const snap of snapTypes) {
      if (!activeSnaps.includes(snap.type)) toggleSnapType(snap.type);
    }
  };

  const handleClearAll = () => {
    for (const type of activeSnaps) toggleSnapType(type);
  };

  return (
    <div className="p-4 overflow-y-auto h-full space-y-4">
      {/* Object Snap Section */}
      <fieldset className="border border-cad-border rounded px-3 pb-3 pt-1">
        <legend className="text-xs font-semibold px-1">Object Snap (OSNAP)</legend>

        {/* Master toggle */}
        <div className="flex items-center justify-between mt-2 mb-3">
          <div>
            <span className="text-xs font-medium">Enable Object Snap</span>
            <p className="text-[10px] text-cad-text-dim">Toggle all object snaps [F3]</p>
          </div>
          <ToggleSwitch checked={snapEnabled} onChange={toggleSnap} />
        </div>

        {/* Tolerance slider */}
        <div className="mb-3">
          <label className="text-xs font-medium block mb-1">
            Snap Tolerance: {snapTolerance}px
          </label>
          <input
            type="range"
            min="5"
            max="30"
            value={snapTolerance}
            onChange={(e) => setSnapTolerance(Number(e.target.value))}
            className="w-full h-1.5 bg-cad-border rounded-lg appearance-none cursor-pointer accent-cad-accent"
          />
          <div className="flex justify-between text-[10px] text-cad-text-dim mt-0.5">
            <span>5px</span>
            <span>30px</span>
          </div>
        </div>

        {/* Select All / Clear All */}
        <div className="flex gap-2 mb-3">
          <button onClick={handleSelectAll} className="px-2 py-0.5 text-[10px] bg-cad-border hover:bg-cad-accent/50 rounded transition-colors">
            Select All
          </button>
          <button onClick={handleClearAll} className="px-2 py-0.5 text-[10px] bg-cad-border hover:bg-cad-accent/50 rounded transition-colors">
            Clear All
          </button>
        </div>

        {/* Snap type checkboxes */}
        <div className="grid grid-cols-2 gap-1">
          {snapTypes.map((snap) => {
            const isActive = activeSnaps.includes(snap.type);
            return (
              <button
                key={snap.type}
                onClick={() => toggleSnapType(snap.type)}
                title={snap.description}
                className={`flex items-center gap-1.5 px-2 py-1 rounded border transition-colors text-left ${
                  isActive ? 'border-cad-accent bg-cad-accent/10' : 'border-cad-border hover:border-cad-text-dim'
                }`}
              >
                <span className="text-sm w-4 flex-shrink-0 text-center" style={{ color: snap.color }}>{snap.symbol}</span>
                <span className="text-[11px] font-medium flex-1">{snap.label}</span>
                <Checkbox checked={isActive} />
              </button>
            );
          })}
        </div>
      </fieldset>

      {/* Polar Tracking */}
      <fieldset className="border border-cad-border rounded px-3 pb-3 pt-1">
        <legend className="text-xs font-semibold px-1">Polar Tracking</legend>
        <div className="flex items-center justify-between mt-2">
          <div>
            <span className="text-xs font-medium">Enable Polar Tracking</span>
            <p className="text-[10px] text-cad-text-dim">Track angles while drawing [F10]</p>
          </div>
          <ToggleSwitch checked={polarTrackingEnabled} onChange={togglePolarTracking} />
        </div>
        <div className="mt-3">
          <label className="text-xs font-medium block mb-1">Angle Increment</label>
          <select
            value={polarAngleIncrement}
            onChange={(e) => setPolarAngleIncrement(Number(e.target.value))}
            className="bg-cad-bg border border-cad-border text-cad-text text-xs px-2 py-1 rounded outline-none focus:border-cad-accent w-full"
          >
            {POLAR_ANGLES.map((a) => (
              <option key={a} value={a}>{a}&deg;</option>
            ))}
          </select>
        </div>
      </fieldset>

      {/* Ortho Mode */}
      <fieldset className="border border-cad-border rounded px-3 pb-3 pt-1">
        <legend className="text-xs font-semibold px-1">Ortho Mode</legend>
        <div className="flex items-center justify-between mt-2">
          <div>
            <span className="text-xs font-medium">Enable Ortho Mode</span>
            <p className="text-[10px] text-cad-text-dim">Constrain to 90&deg; angles [F8]</p>
          </div>
          <ToggleSwitch checked={orthoMode} onChange={toggleOrthoMode} />
        </div>
      </fieldset>

      {/* Object Snap Tracking */}
      <fieldset className="border border-cad-border rounded px-3 pb-3 pt-1">
        <legend className="text-xs font-semibold px-1">Object Snap Tracking</legend>
        <div className="flex items-center justify-between mt-2">
          <div>
            <span className="text-xs font-medium">Enable Object Tracking</span>
            <p className="text-[10px] text-cad-text-dim">Track alignment to geometry [F11]</p>
          </div>
          <ToggleSwitch checked={objectTrackingEnabled} onChange={toggleObjectTracking} />
        </div>
      </fieldset>

      {/* Dynamic Input */}
      <fieldset className="border border-cad-border rounded px-3 pb-3 pt-1">
        <legend className="text-xs font-semibold px-1">Position Info (POS)</legend>
        <div className="flex items-center justify-between mt-2">
          <div>
            <span className="text-xs font-medium">Enable Position Info</span>
            <p className="text-[10px] text-cad-text-dim">Show position info while drawing [F12]</p>
          </div>
          <ToggleSwitch checked={dynamicInputEnabled} onChange={toggleDynamicInput} />
        </div>
      </fieldset>

      {/* Rotation Gizmo */}
      <fieldset className="border border-cad-border rounded px-3 pb-3 pt-1">
        <legend className="text-xs font-semibold px-1">Rotation Gizmo</legend>
        <div className="flex items-center justify-between mt-2">
          <div>
            <span className="text-xs font-medium">Show Rotation Gizmo</span>
            <p className="text-[10px] text-cad-text-dim">Show rotation handles on shapes [F7]</p>
          </div>
          <ToggleSwitch checked={showRotationGizmo} onChange={toggleShowRotationGizmo} />
        </div>
      </fieldset>
    </div>
  );
}

function ToggleSwitch({ checked, onChange }: { checked: boolean; onChange: () => void }) {
  return (
    <button
      onClick={onChange}
      className={`w-9 h-5 rounded-full transition-colors relative flex-shrink-0 ${
        checked ? 'bg-cad-accent' : 'bg-cad-border'
      }`}
    >
      <div
        className={`w-4 h-4 bg-white rounded-full absolute top-0.5 transition-transform ${
          checked ? 'translate-x-4' : 'translate-x-0.5'
        }`}
      />
    </button>
  );
}

function Checkbox({ checked }: { checked: boolean }) {
  return (
    <div
      className={`w-3 h-3 rounded border flex-shrink-0 flex items-center justify-center ${
        checked ? 'bg-cad-accent border-cad-accent' : 'border-cad-text-dim'
      }`}
    >
      {checked && (
        <svg width="7" height="5" viewBox="0 0 10 8" fill="none" stroke="white" strokeWidth="2">
          <path d="M1 4L4 7L9 1" />
        </svg>
      )}
    </div>
  );
}
