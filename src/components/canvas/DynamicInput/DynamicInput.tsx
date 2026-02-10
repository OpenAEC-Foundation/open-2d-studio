import { useState, useEffect, useRef, useCallback } from 'react';
import { useAppStore } from '../../../state/appStore';
import { formatLength, formatAngle } from '../../../units';
import { getDistance, getAngle } from '../../../engine/geometry/CoordinateParser';
import {
  transformShape,
  translateTransform,
  rotateTransform,
  getShapeTransformUpdates,
} from '../../../engine/geometry/Modify';

/**
 * Field configuration per tool
 */
interface FieldConfig {
  field1Label: string;
  field2Label: string;
}

const TOOL_FIELDS: Record<string, FieldConfig> = {
  line: { field1Label: 'Distance', field2Label: 'Angle' },
  rectangle: { field1Label: 'Width', field2Label: 'Height' },
  circle: { field1Label: 'Radius', field2Label: '' },
  arc: { field1Label: 'Radius', field2Label: 'Sweep' },
  ellipse: { field1Label: 'Radius X', field2Label: 'Radius Y' },
  polyline: { field1Label: 'Distance', field2Label: 'Angle' },
};

/**
 * DynamicInput - Editable tooltip near the cursor.
 * Tab cycles focus between fields, Enter applies values.
 * Typing a number auto-focuses the first field.
 */
export function DynamicInput() {
  const {
    activeTool,
    drawingPoints,
    isDrawing,
    mousePosition,
    viewport,
    canvasSize,
    lockedDistance,
    lockedAngle,
    setLockedDistance,
    setLockedAngle,
    // Tracking state - use constrained values when tracking is active
    trackingPoint,
    directDistanceAngle,
    dynamicInputEnabled,
    unitSettings,
  } = useAppStore();

  const [focusedField, setFocusedField] = useState<0 | 1 | -1>(-1); // -1 = none, 0 = field1, 1 = field2
  const [field1Text, setField1Text] = useState('');
  const [field2Text, setField2Text] = useState('');
  const field1Ref = useRef<HTMLInputElement>(null);
  const field2Ref = useRef<HTMLInputElement>(null);

  const supportedDrawingTools = ['line', 'rectangle', 'circle', 'arc', 'ellipse', 'polyline'];
  const supportedModifyTools = ['move', 'copy'];

  const isModifyMode = supportedModifyTools.includes(activeTool) && drawingPoints.length >= 1;
  const isRotateMode = activeTool === 'rotate' && drawingPoints.length >= 2;
  const isDrawingMode = isDrawing && drawingPoints.length > 0 && supportedDrawingTools.includes(activeTool);

  // Only show when enabled and drawing with supported tools OR during move/copy/rotate with points set
  const showDynamicInput = dynamicInputEnabled && (isDrawingMode || isModifyMode || isRotateMode);

  // Reset when drawing ends or tool changes
  useEffect(() => {
    if (!showDynamicInput) {
      setFocusedField(-1);
      setField1Text('');
      setField2Text('');
      setLockedDistance(null);
      setLockedAngle(null);
    }
  }, [showDynamicInput, setLockedDistance, setLockedAngle]);

  // Focus management
  useEffect(() => {
    if (focusedField === 0) {
      field1Ref.current?.focus();
      field1Ref.current?.select();
    } else if (focusedField === 1) {
      field2Ref.current?.focus();
      field2Ref.current?.select();
    }
  }, [focusedField]);

  // Execute move/copy with typed distance
  const executeModifyWithDistance = useCallback((dist: number) => {
    if (!isModifyMode || drawingPoints.length < 1) return;

    const basePoint = drawingPoints[0];
    const worldMX = (mousePosition.x - viewport.offsetX) / viewport.zoom;
    const worldMY = (mousePosition.y - viewport.offsetY) / viewport.zoom;
    const dirX = worldMX - basePoint.x;
    const dirY = worldMY - basePoint.y;
    const dirLen = Math.hypot(dirX, dirY);
    if (dirLen < 0.001) return;

    const ux = dirX / dirLen;
    const uy = dirY / dirLen;
    const dx = ux * dist;
    const dy = uy * dist;
    const transform = translateTransform(dx, dy);

    const state = useAppStore.getState();
    const idSet = new Set(state.selectedShapeIds);
    const selected = state.shapes.filter((s) => idSet.has(s.id));
    if (selected.length === 0) return;

    if (activeTool === 'copy' || state.modifyCopy) {
      const copies = selected.map((s) => transformShape(s, transform));
      state.addShapes(copies);
      // Keep base point active for repeated copies
      state.setDrawingPreview(null);
    } else {
      const updates = selected.map((s) => ({
        id: s.id,
        updates: getShapeTransformUpdates(s, transform),
      }));
      state.updateShapes(updates);
      state.clearDrawingPoints();
      state.setDrawingPreview(null);
    }
  }, [isModifyMode, drawingPoints, mousePosition, viewport, activeTool]);

  // Execute rotate with typed angle, direction from mouse position
  const executeRotateWithAngle = useCallback((angleDeg: number) => {
    if (!isRotateMode || drawingPoints.length < 2) return;

    const center = drawingPoints[0];
    const startRay = drawingPoints[1];
    const worldMX = (mousePosition.x - viewport.offsetX) / viewport.zoom;
    const worldMY = (mousePosition.y - viewport.offsetY) / viewport.zoom;

    // Determine direction sign from mouse position relative to start ray
    const startAngle = Math.atan2(startRay.y - center.y, startRay.x - center.x);
    const mouseAngle = Math.atan2(worldMY - center.y, worldMX - center.x);
    let deltaAngle = mouseAngle - startAngle;
    // Normalize to [-PI, PI]
    while (deltaAngle > Math.PI) deltaAngle -= 2 * Math.PI;
    while (deltaAngle < -Math.PI) deltaAngle += 2 * Math.PI;
    const dirSign = deltaAngle >= 0 ? 1 : -1;

    const angleRad = dirSign * angleDeg * (Math.PI / 180);
    const transform = rotateTransform(center, angleRad);

    const state = useAppStore.getState();
    const idSet2 = new Set(state.selectedShapeIds);
    const selected = state.shapes.filter((s) => idSet2.has(s.id));
    if (selected.length === 0) return;

    if (state.modifyCopy) {
      const copies = selected.map((s) => transformShape(s, transform));
      state.addShapes(copies);
    } else {
      const updates = selected.map((s) => ({
        id: s.id,
        updates: getShapeTransformUpdates(s, transform),
      }));
      state.updateShapes(updates);
    }
    state.clearDrawingPoints();
    state.setDrawingPreview(null);
  }, [isRotateMode, drawingPoints, mousePosition, viewport]);

  // Execute direct distance entry for line/polyline drawing
  // Places a point at the typed distance in the current tracking direction (or mouse direction)
  const executeDirectDistanceEntry = useCallback((dist: number) => {
    if (drawingPoints.length < 1) return;
    if (!['line', 'polyline'].includes(activeTool)) return;

    const basePoint = drawingPoints[drawingPoints.length - 1];
    const state = useAppStore.getState();

    // Get direction: use tracking angle if available, otherwise calculate from mouse position
    let directionAngle: number;
    if (state.directDistanceAngle !== null) {
      // Use tracking angle (already in radians, math coords)
      directionAngle = state.directDistanceAngle;
    } else {
      // Calculate from mouse position
      const worldMX = (mousePosition.x - viewport.offsetX) / viewport.zoom;
      const worldMY = (mousePosition.y - viewport.offsetY) / viewport.zoom;
      directionAngle = Math.atan2(worldMY - basePoint.y, worldMX - basePoint.x);
    }

    // Calculate endpoint
    const endPoint = {
      x: basePoint.x + dist * Math.cos(directionAngle),
      y: basePoint.y + dist * Math.sin(directionAngle),
    };

    // Dispatch a synthetic click event to the drawing system
    // We do this by setting the point directly and triggering the click handler
    if (activeTool === 'line') {
      // For line tool: create line and continue chain if enabled
      const lineShape = {
        id: crypto.randomUUID(),
        type: 'line' as const,
        layerId: state.activeLayerId,
        drawingId: state.activeDrawingId,
        style: { ...state.currentStyle },
        visible: true,
        locked: false,
        start: basePoint,
        end: endPoint,
      };
      state.addShape(lineShape);

      // Continue chain or reset
      if (state.chainMode) {
        state.clearDrawingPoints();
        state.addDrawingPoint(endPoint);
      } else {
        state.clearDrawingPoints();
        state.setDrawingPreview(null);
      }
    } else if (activeTool === 'polyline') {
      // For polyline: add the point to drawing points
      state.addDrawingBulge(0); // Straight segment
      state.addDrawingPoint(endPoint);
    }

    // Clear tracking state
    state.setCurrentTrackingLines([]);
    state.setTrackingPoint(null);
    state.setDirectDistanceAngle(null);
  }, [drawingPoints, activeTool, mousePosition, viewport]);

  // Execute rectangle entry with typed width and height
  // Direction is determined by mouse position relative to first point
  const executeRectangleEntry = useCallback((width: number, height: number) => {
    if (drawingPoints.length < 1) return;
    if (activeTool !== 'rectangle') return;

    const basePoint = drawingPoints[0];
    const state = useAppStore.getState();

    // Determine direction based on mouse position
    const worldMX = (mousePosition.x - viewport.offsetX) / viewport.zoom;
    const worldMY = (mousePosition.y - viewport.offsetY) / viewport.zoom;

    // Sign based on mouse position relative to base point
    const signX = worldMX >= basePoint.x ? 1 : -1;
    const signY = worldMY >= basePoint.y ? 1 : -1;

    // Calculate top-left corner based on direction
    const actualWidth = width * signX;
    const actualHeight = height * signY;

    const topLeft = {
      x: actualWidth > 0 ? basePoint.x : basePoint.x + actualWidth,
      y: actualHeight > 0 ? basePoint.y : basePoint.y + actualHeight,
    };

    // Get corner radius if set
    const cornerRadius = state.cornerRadius > 0 ? state.cornerRadius : undefined;

    // Create rectangle shape
    const rectShape = {
      id: crypto.randomUUID(),
      type: 'rectangle' as const,
      layerId: state.activeLayerId,
      drawingId: state.activeDrawingId,
      style: { ...state.currentStyle },
      visible: true,
      locked: false,
      topLeft,
      width: Math.abs(actualWidth),
      height: Math.abs(actualHeight),
      rotation: 0,
      ...(cornerRadius && { cornerRadius }),
    };
    state.addShape(rectShape);

    // Clear drawing state
    state.clearDrawingPoints();
    state.setDrawingPreview(null);
  }, [drawingPoints, activeTool, mousePosition, viewport]);

  // Execute circle entry with typed radius
  const executeCircleEntry = useCallback((radius: number) => {
    if (drawingPoints.length < 1) return;
    if (activeTool !== 'circle') return;

    const center = drawingPoints[0];
    const state = useAppStore.getState();

    // Create circle shape
    const circleShape = {
      id: crypto.randomUUID(),
      type: 'circle' as const,
      layerId: state.activeLayerId,
      drawingId: state.activeDrawingId,
      style: { ...state.currentStyle },
      visible: true,
      locked: false,
      center,
      radius,
    };
    state.addShape(circleShape);

    // Clear drawing state
    state.clearDrawingPoints();
    state.setDrawingPreview(null);
  }, [drawingPoints, activeTool]);

  // Execute ellipse entry with typed radiusX and radiusY
  const executeEllipseEntry = useCallback((radiusX: number, radiusY: number) => {
    if (drawingPoints.length < 1) return;
    if (activeTool !== 'ellipse') return;

    const center = drawingPoints[0];
    const state = useAppStore.getState();

    // Create ellipse shape
    const ellipseShape = {
      id: crypto.randomUUID(),
      type: 'ellipse' as const,
      layerId: state.activeLayerId,
      drawingId: state.activeDrawingId,
      style: { ...state.currentStyle },
      visible: true,
      locked: false,
      center,
      radiusX,
      radiusY,
      rotation: 0,
    };
    state.addShape(ellipseShape);

    // Clear drawing state
    state.clearDrawingPoints();
    state.setDrawingPreview(null);
  }, [drawingPoints, activeTool]);

  // Apply values and notify store
  const applyValues = useCallback(() => {
    if (isRotateMode) {
      const v1 = field1Text !== '' ? Number(field1Text) : null;
      if (v1 !== null && !isNaN(v1)) {
        executeRotateWithAngle(v1);
      }
      setFocusedField(-1);
      setField1Text('');
      return;
    }

    if (isModifyMode) {
      const v1 = field1Text !== '' ? Number(field1Text) : null;
      if (v1 !== null && !isNaN(v1)) {
        executeModifyWithDistance(v1);
      }
      setFocusedField(-1);
      setField1Text('');
      return;
    }

    // Direct distance entry for line/polyline tools
    // When user types a distance and presses Enter, place the point immediately
    if ((activeTool === 'line' || activeTool === 'polyline') && drawingPoints.length > 0) {
      const v1 = field1Text !== '' ? Number(field1Text) : null;
      if (v1 !== null && !isNaN(v1) && v1 > 0) {
        executeDirectDistanceEntry(v1);
        setFocusedField(-1);
        setField1Text('');
        setField2Text('');
        return;
      }
    }

    // Rectangle direct dimension entry
    // Supports "width,height" format or separate width/height fields
    if (activeTool === 'rectangle' && drawingPoints.length > 0) {
      let width: number | null = null;
      let height: number | null = null;

      // Check for comma-separated input in field1 (e.g., "400,500")
      if (field1Text.includes(',')) {
        const parts = field1Text.split(',').map(s => s.trim());
        if (parts.length >= 2) {
          const w = Number(parts[0]);
          const h = Number(parts[1]);
          if (!isNaN(w) && !isNaN(h) && w > 0 && h > 0) {
            width = w;
            height = h;
          }
        }
      } else {
        // Use separate fields
        const w = field1Text !== '' ? Number(field1Text) : null;
        const h = field2Text !== '' ? Number(field2Text) : null;
        if (w !== null && !isNaN(w) && w > 0) width = w;
        if (h !== null && !isNaN(h) && h > 0) height = h;
      }

      // If we have both dimensions, create the rectangle
      if (width !== null && height !== null) {
        executeRectangleEntry(width, height);
        setFocusedField(-1);
        setField1Text('');
        setField2Text('');
        return;
      }
    }

    // Circle direct radius entry
    // Type radius and press Enter to create circle
    if (activeTool === 'circle' && drawingPoints.length > 0) {
      const radius = field1Text !== '' ? Number(field1Text) : null;
      if (radius !== null && !isNaN(radius) && radius > 0) {
        executeCircleEntry(radius);
        setFocusedField(-1);
        setField1Text('');
        setField2Text('');
        return;
      }
    }

    // Ellipse direct dimension entry
    // Supports "radiusX,radiusY" format or separate fields
    if (activeTool === 'ellipse' && drawingPoints.length > 0) {
      let radiusX: number | null = null;
      let radiusY: number | null = null;

      // Check for comma-separated input in field1 (e.g., "100,50")
      if (field1Text.includes(',')) {
        const parts = field1Text.split(',').map(s => s.trim());
        if (parts.length >= 2) {
          const rx = Number(parts[0]);
          const ry = Number(parts[1]);
          if (!isNaN(rx) && !isNaN(ry) && rx > 0 && ry > 0) {
            radiusX = rx;
            radiusY = ry;
          }
        }
      } else {
        // Use separate fields
        const rx = field1Text !== '' ? Number(field1Text) : null;
        const ry = field2Text !== '' ? Number(field2Text) : null;
        if (rx !== null && !isNaN(rx) && rx > 0) radiusX = rx;
        if (ry !== null && !isNaN(ry) && ry > 0) radiusY = ry;
      }

      // If we have both radii, create the ellipse
      if (radiusX !== null && radiusY !== null) {
        executeEllipseEntry(radiusX, radiusY);
        setFocusedField(-1);
        setField1Text('');
        setField2Text('');
        return;
      }
    }

    // For other tools or if no distance entered, just lock the values
    const v1 = field1Text !== '' ? Number(field1Text) : null;
    const v2 = field2Text !== '' ? Number(field2Text) : null;

    if (v1 !== null && !isNaN(v1)) {
      setLockedDistance(v1);
    }
    if (v2 !== null && !isNaN(v2)) {
      setLockedAngle(v2);
    }

    setFocusedField(-1);
  }, [isRotateMode, isModifyMode, field1Text, field2Text, activeTool, drawingPoints, setLockedDistance, setLockedAngle, executeModifyWithDistance, executeRotateWithAngle, executeDirectDistanceEntry, executeRectangleEntry, executeCircleEntry, executeEllipseEntry]);

  // Global keyboard handler for Tab, Enter, and numeric input
  useEffect(() => {
    if (!showDynamicInput) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Tab cycles between fields
      if (e.key === 'Tab') {
        e.preventDefault();
        if (focusedField === -1) {
          setFocusedField(0);
        } else if (focusedField === 0) {
          if (isModifyMode || isRotateMode) {
            // For modify/rotate tools, Tab applies the value
            applyValues();
            return;
          }
          // Apply field 1 value
          const v1 = field1Text !== '' ? Number(field1Text) : null;
          if (v1 !== null && !isNaN(v1)) {
            setLockedDistance(v1);
          }
          const config = TOOL_FIELDS[activeTool];
          if (config?.field2Label) {
            setFocusedField(1);
          } else {
            setFocusedField(-1);
          }
        } else {
          // Apply field 2 value
          const v2 = field2Text !== '' ? Number(field2Text) : null;
          if (v2 !== null && !isNaN(v2)) {
            setLockedAngle(v2);
          }
          setFocusedField(-1);
        }
        return;
      }

      // Enter applies values
      if (e.key === 'Enter' && focusedField !== -1) {
        e.preventDefault();
        applyValues();
        return;
      }

      // Typing a number auto-focuses field 1
      // Allow comma for "width,height" format (e.g., "400,500")
      if (focusedField === -1 && /^[0-9.\-,]$/.test(e.key)) {
        e.preventDefault();
        setField1Text(e.key === '-' ? '-' : e.key);
        setFocusedField(0);
        // Need to set cursor position after the character
        setTimeout(() => {
          if (field1Ref.current) {
            field1Ref.current.selectionStart = field1Ref.current.value.length;
            field1Ref.current.selectionEnd = field1Ref.current.value.length;
          }
        }, 0);
        return;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [showDynamicInput, focusedField, field1Text, field2Text, activeTool, applyValues, setLockedDistance, setLockedAngle]);

  if (!showDynamicInput) return null;

  const config = TOOL_FIELDS[activeTool] ?? (isRotateMode ? { field1Label: 'Angle', field2Label: '' } : isModifyMode ? { field1Label: 'Distance', field2Label: '' } : null);
  if (!config) return null;

  // Convert screen position to world coordinates
  const worldX = (mousePosition.x - viewport.offsetX) / viewport.zoom;
  const worldY = (mousePosition.y - viewport.offsetY) / viewport.zoom;

  // Get last point for relative calculations
  const lastPoint = drawingPoints[drawingPoints.length - 1];

  // Use tracking point if available (constrained/snapped position)
  // This ensures the display shows the actual values the user will get
  const effectivePoint = trackingPoint ?? { x: worldX, y: worldY };

  // Calculate live values using the effective (possibly tracked) point
  const distance = getDistance(lastPoint, effectivePoint);
  // Use tracking angle if available (in radians), convert to degrees
  // The tracking system uses math coords (Y up), but getAngle uses screen coords (Y down/inverted)
  // So we negate the tracking angle to match the display convention, then normalize to 0-360
  let angle: number;
  if (directDistanceAngle !== null) {
    // Negate to match getAngle's Y-inversion, then normalize to 0-360°
    let trackingDeg = -directDistanceAngle * (180 / Math.PI);
    if (trackingDeg < 0) trackingDeg += 360;
    angle = trackingDeg;
  } else {
    angle = getAngle(lastPoint, effectivePoint);
  }
  const deltaX = effectivePoint.x - lastPoint.x;
  const deltaY = effectivePoint.y - lastPoint.y;

  // Position the tooltip near the cursor
  const tooltipX = Math.min(mousePosition.x + 20, canvasSize.width - 250);
  const tooltipY = Math.min(mousePosition.y + 20, canvasSize.height - 100);

  // Display values: use locked if set, otherwise live
  const displayVal1 = formatLength(lockedDistance !== null ? lockedDistance : distance, unitSettings);
  const displayVal2 = formatAngle(lockedAngle !== null ? lockedAngle : angle, unitSettings);

  return (
    <div
      className="absolute pointer-events-auto z-50"
      style={{
        left: tooltipX,
        top: tooltipY,
      }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div className="bg-cad-surface/95 border border-cad-accent shadow-lg p-2 font-mono text-xs">
        {/* Field 1: Distance / Width / Radius */}
        <div className="flex items-center gap-2 text-cad-text mb-1">
          <span className="text-cad-text-dim w-14 text-right">{config.field1Label}:</span>
          {focusedField === 0 ? (
            <input
              ref={field1Ref}
              type="text"
              className="bg-cad-bg border border-cad-accent text-green-400 font-semibold px-1 w-20 h-5 text-xs outline-none"
              value={field1Text}
              onChange={(e) => setField1Text(e.target.value)}
              onBlur={() => {
                const v = field1Text !== '' ? Number(field1Text) : null;
                if (v !== null && !isNaN(v)) {
                  setLockedDistance(v);
                }
              }}
            />
          ) : (
            <span
              className={`font-semibold cursor-text px-1 ${lockedDistance !== null ? 'text-green-400 bg-cad-bg border border-green-400/30' : 'text-green-400'}`}
              onClick={() => {
                setField1Text(displayVal1);
                setFocusedField(0);
              }}
            >
              {displayVal1}
            </span>
          )}
          {lockedDistance !== null && (
            <span className="text-green-400 text-[10px]">locked</span>
          )}
        </div>

        {/* Field 2: Angle / Height */}
        {config.field2Label && (
          <div className="flex items-center gap-2 text-cad-text mb-1">
            <span className="text-cad-text-dim w-14 text-right">{config.field2Label}:</span>
            {focusedField === 1 ? (
              <input
                ref={field2Ref}
                type="text"
                className="bg-cad-bg border border-cad-accent text-yellow-400 font-semibold px-1 w-20 h-5 text-xs outline-none"
                value={field2Text}
                onChange={(e) => setField2Text(e.target.value)}
                onBlur={() => {
                  const v = field2Text !== '' ? Number(field2Text) : null;
                  if (v !== null && !isNaN(v)) {
                    setLockedAngle(v);
                  }
                }}
              />
            ) : (
              <span
                className={`font-semibold cursor-text px-1 ${lockedAngle !== null ? 'text-yellow-400 bg-cad-bg border border-yellow-400/30' : 'text-yellow-400'}`}
                onClick={() => {
                  setField2Text(displayVal2);
                  setFocusedField(1);
                }}
              >
                {displayVal2}
              </span>
            )}
            {lockedAngle !== null && (
              <span className="text-yellow-400 text-[10px]">locked</span>
            )}
          </div>
        )}

        {/* Separator */}
        <div className="border-t border-cad-border my-1.5" />

        {/* Read-only coordinates - show effective (tracked) position */}
        <div className="flex items-center gap-2 text-cad-text text-[10px]">
          <span className="text-cad-text-dim">X:</span>
          <span className="text-cad-accent">{formatLength(effectivePoint.x, unitSettings)}</span>
          <span className="text-cad-text-dim ml-2">Y:</span>
          <span className="text-cad-accent">{formatLength(effectivePoint.y, unitSettings)}</span>
        </div>
        <div className="flex items-center gap-2 text-cad-text text-[10px]">
          <span className="text-cad-text-dim">{'\u0394'}X:</span>
          <span>{formatLength(deltaX, unitSettings)}</span>
          <span className="text-cad-text-dim ml-2">{'\u0394'}Y:</span>
          <span>{formatLength(deltaY, unitSettings)}</span>
        </div>

        {/* Hint */}
        {focusedField === -1 && (
          <div className="border-t border-cad-border mt-1.5 pt-1 text-cad-text-dim text-[9px]">
            {activeTool === 'rectangle'
              ? 'Type W,H or W Tab H + Enter'
              : activeTool === 'circle'
              ? 'Type radius + Enter'
              : activeTool === 'ellipse'
              ? 'Type RX,RY or RX Tab RY + Enter'
              : 'Type distance + Enter to place point'}
          </div>
        )}
      </div>
    </div>
  );
}
