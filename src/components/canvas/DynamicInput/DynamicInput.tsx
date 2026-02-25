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
import { evaluateExpression } from '../../../utils/expressionParser';
import {
  classifyGridlineOrientation,
  getNextGridlineLabel,
  getNextIncrementedLabel,
} from '../../../utils/gridlineUtils';

/**
 * Snap an angle (in radians) to the nearest 45-degree increment.
 * Returns the snapped angle in radians.
 */
function snapAngleTo45(angle: number): number {
  const degrees = angle * (180 / Math.PI);
  const snappedDegrees = Math.round(degrees / 45) * 45;
  return snappedDegrees * (Math.PI / 180);
}

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
  wall: { field1Label: 'Distance', field2Label: 'Angle' },
  gridline: { field1Label: 'Distance', field2Label: 'Angle' },
  beam: { field1Label: 'Distance', field2Label: 'Angle' },
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
    // Structural tool pending states
    pendingWall,
    pendingGridline,
    pendingBeam,
    // Array tool state
    arrayCount,
    setArrayCount,
  } = useAppStore();

  const [focusedField, setFocusedField] = useState<0 | 1 | -1>(-1); // -1 = none, 0 = field1, 1 = field2
  const [field1Text, setField1Text] = useState('');
  const [field2Text, setField2Text] = useState('');
  const field1Ref = useRef<HTMLInputElement>(null);
  const field2Ref = useRef<HTMLInputElement>(null);

  const supportedDrawingTools = ['line', 'rectangle', 'circle', 'arc', 'ellipse', 'polyline'];
  const supportedModifyTools = ['move', 'copy', 'copy2'];

  const isModifyMode = supportedModifyTools.includes(activeTool) && drawingPoints.length >= 1;
  const isRotateMode = activeTool === 'rotate' && drawingPoints.length >= 2;
  const isDrawingMode = isDrawing && drawingPoints.length > 0 && supportedDrawingTools.includes(activeTool);
  const isArrayMode = activeTool === 'array' && drawingPoints.length >= 1;

  // Structural tools: wall, gridline, beam - active when pending state is set and first point is placed
  const isStructuralMode =
    (activeTool === 'wall' && !!pendingWall && drawingPoints.length >= 1) ||
    (activeTool === 'gridline' && !!pendingGridline && drawingPoints.length >= 1) ||
    (activeTool === 'beam' && !!pendingBeam && drawingPoints.length >= 1);

  // Only show when enabled and drawing with supported tools OR during move/copy/rotate with points set
  const showDynamicInput = dynamicInputEnabled && (isDrawingMode || isModifyMode || isRotateMode || isStructuralMode || isArrayMode);

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

  // Real-time preview: update lockedDistance and ghost preview as user types during modify mode
  useEffect(() => {
    if (!isModifyMode || focusedField !== 0) return;
    const dist = field1Text !== '' ? evaluateExpression(field1Text) : null;
    if (dist === null) {
      setLockedDistance(null);
      return;
    }
    setLockedDistance(dist);

    // Directly compute and set the preview ghost shapes
    const state = useAppStore.getState();
    const basePoint = drawingPoints[0];
    if (!basePoint) return;
    const constrainAxis = state.modifyConstrainAxis;
    const worldMX = (mousePosition.x - viewport.offsetX) / viewport.zoom;
    const worldMY = (mousePosition.y - viewport.offsetY) / viewport.zoom;

    let dx: number, dy: number;
    if (constrainAxis === 'x') {
      dx = Math.sign(worldMX - basePoint.x) * Math.abs(dist);
      dy = 0;
    } else if (constrainAxis === 'y') {
      dx = 0;
      dy = Math.sign(worldMY - basePoint.y) * Math.abs(dist);
    } else {
      let dirAngle = Math.atan2(worldMY - basePoint.y, worldMX - basePoint.x);

      // Snap direction to 45-degree increments when ortho is active
      if (state.modifyOrtho) {
        dirAngle = snapAngleTo45(dirAngle);
      }

      dx = dist * Math.cos(dirAngle);
      dy = dist * Math.sin(dirAngle);
    }

    const transform = translateTransform(dx, dy);
    const idSet = new Set(state.selectedShapeIds);
    const selected = state.shapes.filter(s => idSet.has(s.id));
    if (selected.length > 0) {
      const ghosts = selected.map(s => transformShape(s, transform));
      state.setDrawingPreview({ type: 'modifyPreview', shapes: ghosts });
    }
  }, [isModifyMode, focusedField, field1Text, setLockedDistance, drawingPoints, mousePosition, viewport]);

  // Execute move/copy with typed distance
  const executeModifyWithDistance = useCallback((dist: number, shiftKey: boolean = false) => {
    if (!isModifyMode || drawingPoints.length < 1) return;

    const state = useAppStore.getState();
    const constrainAxis = state.modifyConstrainAxis;
    const basePoint = drawingPoints[0];

    let dx: number, dy: number;

    if (constrainAxis === 'x') {
      // Distance along X axis only
      const worldMX = (mousePosition.x - viewport.offsetX) / viewport.zoom;
      dx = Math.sign(worldMX - basePoint.x) * Math.abs(dist);
      dy = 0;
    } else if (constrainAxis === 'y') {
      // Distance along Y axis only
      const worldMY = (mousePosition.y - viewport.offsetY) / viewport.zoom;
      dy = Math.sign(worldMY - basePoint.y) * Math.abs(dist);
      dx = 0;
    } else {
      // No constraint: use mouse direction
      const worldMX = (mousePosition.x - viewport.offsetX) / viewport.zoom;
      const worldMY = (mousePosition.y - viewport.offsetY) / viewport.zoom;
      let dirAngle = Math.atan2(worldMY - basePoint.y, worldMX - basePoint.x);

      // Snap direction to 45-degree increments when ortho is active
      if (shiftKey || state.modifyOrtho) {
        dirAngle = snapAngleTo45(dirAngle);
      }

      dx = dist * Math.cos(dirAngle);
      dy = dist * Math.sin(dirAngle);
    }

    const transform = translateTransform(dx, dy);

    const idSet = new Set(state.selectedShapeIds);
    const selected = state.shapes.filter((s) => idSet.has(s.id));
    if (selected.length === 0) return;

    if (activeTool === 'copy' || activeTool === 'copy2' || state.modifyCopy) {
      const copies = selected.map((s) => transformShape(s, transform));
      state.addShapes(copies);
    }
    if (!state.modifyCopy && activeTool === 'move') {
      const updates = selected.map((s) => ({
        id: s.id,
        updates: getShapeTransformUpdates(s, transform),
      }));
      state.updateShapes(updates);
    }
    state.clearDrawingPoints();
    state.setDrawingPreview(null);
    state.setLockedDistance(null);
    state.setActiveTool('select');
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
  // angleDeg: explicit angle in degrees typed by user (0 is valid); null means no angle was typed
  const executeDirectDistanceEntry = useCallback((dist: number, shiftKey: boolean = false, angleDeg: number | null = null) => {
    if (drawingPoints.length < 1) return;
    if (!['line', 'polyline'].includes(activeTool)) return;

    const basePoint = drawingPoints[drawingPoints.length - 1];
    const state = useAppStore.getState();

    let directionAngle: number;

    if (angleDeg !== null) {
      // Explicit angle typed by user (in degrees, CAD convention: 0=right, CCW positive)
      // Convert to radians for math
      directionAngle = angleDeg * (Math.PI / 180);
    } else if (shiftKey) {
      // Shift held without explicit angle: force 0 degrees (horizontal right)
      directionAngle = 0;
    } else if (state.directDistanceAngle !== null) {
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

  // Execute structural tool (wall/gridline/beam) distance entry
  // Computes the endpoint from typed distance + mouse direction, then creates the shape
  // angleDeg: explicit angle in degrees typed by user (0 is valid); null means no angle was typed
  const executeStructuralDistanceEntry = useCallback((dist: number, shiftKey: boolean = false, angleDeg: number | null = null) => {
    if (drawingPoints.length < 1) return;
    if (!['wall', 'gridline', 'beam'].includes(activeTool)) return;

    const basePoint = drawingPoints[0];
    const state = useAppStore.getState();

    let directionAngle: number;

    if (angleDeg !== null) {
      // Explicit angle typed by user (in degrees, CAD convention: 0=right, CCW positive)
      directionAngle = angleDeg * (Math.PI / 180);
    } else if (shiftKey) {
      // Shift held without explicit angle: force 0 degrees (horizontal right)
      directionAngle = 0;
    } else if (state.directDistanceAngle !== null) {
      directionAngle = state.directDistanceAngle;
    } else {
      const worldMX = (mousePosition.x - viewport.offsetX) / viewport.zoom;
      const worldMY = (mousePosition.y - viewport.offsetY) / viewport.zoom;
      directionAngle = Math.atan2(worldMY - basePoint.y, worldMX - basePoint.x);
    }

    // Calculate endpoint
    const endPoint = {
      x: basePoint.x + dist * Math.cos(directionAngle),
      y: basePoint.y + dist * Math.sin(directionAngle),
    };

    // Only create if there's a meaningful distance
    const dx = Math.abs(endPoint.x - basePoint.x);
    const dy = Math.abs(endPoint.y - basePoint.y);
    if (dx <= 1 && dy <= 1) return;

    if (activeTool === 'wall' && state.pendingWall) {
      const pw = state.pendingWall;
      const wallShape = {
        id: crypto.randomUUID(),
        type: 'wall' as const,
        layerId: state.activeLayerId,
        drawingId: state.activeDrawingId,
        style: { ...state.currentStyle },
        visible: true,
        locked: false,
        start: basePoint,
        end: endPoint,
        thickness: pw.thickness,
        wallTypeId: pw.wallTypeId,
        justification: pw.justification,
        showCenterline: pw.showCenterline,
        startCap: pw.startCap,
        endCap: pw.endCap,
        // Legacy hatch fields - renderer resolves hatch from materialHatchSettings
        hatchType: 'none' as const,
        hatchAngle: 45,
        hatchSpacing: 50,
      };
      state.addShape(wallShape);

      // Chain drawing: clear and start next segment from endpoint
      state.clearDrawingPoints();
      state.setDrawingPreview(null);
      if (pw.continueDrawing !== false) {
        state.addDrawingPoint(endPoint);
      }
    } else if (activeTool === 'gridline' && state.pendingGridline) {
      const pg = state.pendingGridline;

      // Auto-detect orientation and resolve label:
      //   Horizontal (|dx| > |dy|) → letters (A, B, C...)
      //   Vertical   (|dy| > |dx|) → numbers (1, 2, 3...)
      //   Angled (neither)         → letter+number (A1, B1, C1...)
      const orientation = classifyGridlineOrientation(basePoint, endPoint);
      const angleDeg = orientation === 'angled'
        ? (() => {
            let a = Math.atan2(endPoint.y - basePoint.y, endPoint.x - basePoint.x) * 180 / Math.PI;
            if (a < 0) a += 180;
            if (a >= 180) a -= 180;
            return a;
          })()
        : undefined;
      const label = getNextGridlineLabel(pg.label, orientation, state.activeDrawingId, angleDeg);

      const gridlineShape = {
        id: crypto.randomUUID(),
        type: 'gridline' as const,
        layerId: state.activeLayerId,
        drawingId: state.activeDrawingId,
        style: {
          ...state.currentStyle,
          lineStyle: 'dashdot' as const,
        },
        visible: true,
        locked: false,
        start: basePoint,
        end: endPoint,
        label,
        bubblePosition: pg.bubblePosition,
        bubbleRadius: pg.bubbleRadius,
        fontSize: pg.fontSize,
      };
      state.addShape(gridlineShape);

      // Auto-increment label for next gridline
      const nextLabel = getNextIncrementedLabel(label, state.activeDrawingId);

      state.clearDrawingPoints();
      state.setDrawingPreview(null);
      state.setPendingGridline({
        ...pg,
        label: nextLabel,
      });
    } else if (activeTool === 'beam' && state.pendingBeam) {
      const pb = state.pendingBeam;
      const beamShape = {
        id: crypto.randomUUID(),
        type: 'beam' as const,
        layerId: state.activeLayerId,
        drawingId: state.activeDrawingId,
        style: { ...state.currentStyle },
        visible: true,
        locked: false,
        start: basePoint,
        end: endPoint,
        profileType: pb.profileType,
        profileParameters: pb.parameters,
        presetId: pb.presetId,
        presetName: pb.presetName,
        flangeWidth: pb.flangeWidth,
        justification: pb.justification,
        material: pb.material,
        showCenterline: pb.showCenterline,
        showLabel: pb.showLabel,
        rotation: 0,
        viewMode: pb.viewMode || 'plan',
      };
      state.addShape(beamShape);

      // Chain drawing: clear and start next segment from endpoint
      state.clearDrawingPoints();
      state.setDrawingPreview(null);
      if (pb.continueDrawing !== false) {
        state.addDrawingPoint(endPoint);
      }
    }

    // Clear tracking state
    state.setCurrentTrackingLines([]);
    state.setTrackingPoint(null);
    state.setDirectDistanceAngle(null);
  }, [drawingPoints, activeTool, mousePosition, viewport]);

  // Apply values and notify store
  // shiftKey indicates whether Shift was held when Enter was pressed (for ortho snapping)
  const applyValues = useCallback((shiftKey: boolean = false) => {
    if (isRotateMode) {
      const v1 = field1Text !== '' ? evaluateExpression(field1Text) : null;
      if (v1 !== null) {
        executeRotateWithAngle(v1);
      }
      setFocusedField(-1);
      setField1Text('');
      return;
    }

    if (isModifyMode) {
      const v1 = field1Text !== '' ? evaluateExpression(field1Text) : null;
      if (v1 !== null) {
        executeModifyWithDistance(v1, shiftKey);
      }
      setFocusedField(-1);
      setField1Text('');
      return;
    }

    // Array tool: typing a count updates arrayCount in the store
    if (isArrayMode) {
      const typedCount = field1Text !== '' ? evaluateExpression(field1Text) : null;
      if (typedCount !== null && typedCount >= 2) {
        setArrayCount(Math.round(typedCount));
      }
      setFocusedField(-1);
      setField1Text('');
      setField2Text('');
      return;
    }

    // Direct distance entry for line/polyline tools
    // When user types a distance and presses Enter, place the point immediately
    if ((activeTool === 'line' || activeTool === 'polyline') && drawingPoints.length > 0) {
      const v1 = field1Text !== '' ? evaluateExpression(field1Text) : null;
      if (v1 !== null && v1 > 0) {
        // Parse angle from field2 if entered (0 is a valid angle, so check for non-empty string)
        const typedAngle = field2Text !== '' ? evaluateExpression(field2Text) : null;
        // Also use lockedAngle from state if it was set via Tab (and no new angle typed)
        const effectiveAngle = typedAngle !== null ? typedAngle : useAppStore.getState().lockedAngle;
        executeDirectDistanceEntry(v1, shiftKey, effectiveAngle);
        setFocusedField(-1);
        setField1Text('');
        setField2Text('');
        return;
      }
    }

    // Structural tools (wall, gridline, beam) direct distance entry
    if (['wall', 'gridline', 'beam'].includes(activeTool) && drawingPoints.length > 0) {
      const v1 = field1Text !== '' ? evaluateExpression(field1Text) : null;
      if (v1 !== null && v1 > 0) {
        // Parse angle from field2 if entered (0 is a valid angle, so check for non-empty string)
        const typedAngle = field2Text !== '' ? evaluateExpression(field2Text) : null;
        const effectiveAngle = typedAngle !== null ? typedAngle : useAppStore.getState().lockedAngle;
        executeStructuralDistanceEntry(v1, shiftKey, effectiveAngle);
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

      // Check for comma-separated input in field1 (e.g., "400,500" or "3*100,250+250")
      if (field1Text.includes(',')) {
        const parts = field1Text.split(',').map(s => s.trim());
        if (parts.length >= 2) {
          const w = evaluateExpression(parts[0]);
          const h = evaluateExpression(parts[1]);
          if (w !== null && h !== null && w > 0 && h > 0) {
            width = w;
            height = h;
          }
        }
      } else {
        // Use separate fields
        const w = field1Text !== '' ? evaluateExpression(field1Text) : null;
        const h = field2Text !== '' ? evaluateExpression(field2Text) : null;
        if (w !== null && w > 0) width = w;
        if (h !== null && h > 0) height = h;
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
      const radius = field1Text !== '' ? evaluateExpression(field1Text) : null;
      if (radius !== null && radius > 0) {
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

      // Check for comma-separated input in field1 (e.g., "100,50" or "50*2,25+25")
      if (field1Text.includes(',')) {
        const parts = field1Text.split(',').map(s => s.trim());
        if (parts.length >= 2) {
          const rx = evaluateExpression(parts[0]);
          const ry = evaluateExpression(parts[1]);
          if (rx !== null && ry !== null && rx > 0 && ry > 0) {
            radiusX = rx;
            radiusY = ry;
          }
        }
      } else {
        // Use separate fields
        const rx = field1Text !== '' ? evaluateExpression(field1Text) : null;
        const ry = field2Text !== '' ? evaluateExpression(field2Text) : null;
        if (rx !== null && rx > 0) radiusX = rx;
        if (ry !== null && ry > 0) radiusY = ry;
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
    const v1 = field1Text !== '' ? evaluateExpression(field1Text) : null;
    const v2 = field2Text !== '' ? evaluateExpression(field2Text) : null;

    if (v1 !== null) {
      setLockedDistance(v1);
    }
    if (v2 !== null) {
      setLockedAngle(v2);
    }

    setFocusedField(-1);
  }, [isRotateMode, isModifyMode, isArrayMode, field1Text, field2Text, activeTool, drawingPoints, setLockedDistance, setLockedAngle, setArrayCount, executeModifyWithDistance, executeRotateWithAngle, executeDirectDistanceEntry, executeStructuralDistanceEntry, executeRectangleEntry, executeCircleEntry, executeEllipseEntry]);

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
            applyValues(e.shiftKey);
            return;
          }
          // Apply field 1 value
          const v1 = field1Text !== '' ? evaluateExpression(field1Text) : null;
          if (v1 !== null) {
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
          const v2 = field2Text !== '' ? evaluateExpression(field2Text) : null;
          if (v2 !== null) {
            setLockedAngle(v2);
          }
          setFocusedField(-1);
        }
        return;
      }

      // Enter applies values
      if (e.key === 'Enter' && focusedField !== -1) {
        e.preventDefault();
        applyValues(e.shiftKey);
        return;
      }

      // Typing a number auto-focuses field 1
      // Allow comma for "width,height" format (e.g., "400,500")
      if (focusedField === -1 && /^[0-9.\-,+*/()]$/.test(e.key)) {
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

  const config = TOOL_FIELDS[activeTool] ?? (isRotateMode ? { field1Label: 'Angle', field2Label: '' } : isModifyMode ? { field1Label: 'Distance', field2Label: '' } : isArrayMode ? { field1Label: 'Count', field2Label: 'Distance' } : isStructuralMode ? { field1Label: 'Distance', field2Label: 'Angle' } : null);
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
  const displayVal1 = isArrayMode
    ? String(arrayCount)
    : formatLength(lockedDistance !== null ? lockedDistance : distance, unitSettings);
  const displayVal2 = isArrayMode
    ? formatLength(distance, unitSettings)
    : formatAngle(lockedAngle !== null ? lockedAngle : angle, unitSettings);

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
                const v = field1Text !== '' ? evaluateExpression(field1Text) : null;
                if (v !== null) {
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
                  const v = field2Text !== '' ? evaluateExpression(field2Text) : null;
                  if (v !== null) {
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
          <span className="text-cad-accent">{formatLength(-effectivePoint.y, unitSettings)}</span>
        </div>
        <div className="flex items-center gap-2 text-cad-text text-[10px]">
          <span className="text-cad-text-dim">{'\u0394'}X:</span>
          <span>{formatLength(deltaX, unitSettings)}</span>
          <span className="text-cad-text-dim ml-2">{'\u0394'}Y:</span>
          <span>{formatLength(-deltaY, unitSettings)}</span>
        </div>

        {/* Hint */}
        {focusedField === -1 && (
          <div className="border-t border-cad-border mt-1.5 pt-1 text-cad-text-dim text-[9px]">
            {activeTool === 'array'
              ? 'Type count + Enter, click end point'
              : activeTool === 'rectangle'
              ? 'Type W,H or W Tab H + Enter'
              : activeTool === 'circle'
              ? 'Type radius + Enter'
              : activeTool === 'ellipse'
              ? 'Type RX,RY or RX Tab RY + Enter'
              : activeTool === 'wall' || activeTool === 'gridline' || activeTool === 'beam'
              ? 'Type distance + Enter to place endpoint'
              : 'Type distance + Enter to place point'}
          </div>
        )}
      </div>
    </div>
  );
}
