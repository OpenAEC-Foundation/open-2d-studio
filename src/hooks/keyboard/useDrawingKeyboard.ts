import { useEffect } from 'react';
import { useAppStore, generateId } from '../../state/appStore';
import type { LineShape, PolylineShape, SplineShape, HatchShape, SlabShape } from '../../types/geometry';

/**
 * Hook to handle keyboard shortcuts for drawing operations
 * - Enter/Escape: End current drawing operation
 * - U: Undo last point
 * - C: Close shape (connect last point to first point)
 * - F3: Toggle OSNAP
 * - F8: Toggle Ortho mode
 * - F10: Toggle Polar tracking
 * - F11: Toggle Object tracking
 * - F12: Toggle Dynamic Input
 */
export function useDrawingKeyboard() {
  const {
    activeTool,
    drawingPoints,
    clearDrawingPoints,
    undoDrawingPoint,
    setDrawingPreview,
    addShape,
    activeLayerId,
    activeDrawingId,
    currentStyle,
    isDrawing,
    polylineArcMode,
    setPolylineArcMode,
    dimensionMode,
    linearDimensionDirection,
    setLinearDimensionDirection,
    filledRegionMode,
    // Snap and tracking toggles
    toggleSnap,
    toggleOrthoMode,
    togglePolarTracking,
    toggleObjectTracking,
    toggleDynamicInput,
    toggleRotationGizmo,
  } = useAppStore();

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't handle if user is typing in an input
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      ) {
        return;
      }

      // Global function key shortcuts (work regardless of drawing state)
      switch (e.key) {
        case 'F3':
          // Toggle OSNAP
          e.preventDefault();
          toggleSnap();
          return;

        case 'F8':
          // Toggle Ortho mode
          e.preventDefault();
          toggleOrthoMode();
          return;

        case 'F10':
          // Toggle Polar tracking
          e.preventDefault();
          togglePolarTracking();
          return;

        case 'F11':
          // Toggle Object tracking
          e.preventDefault();
          toggleObjectTracking();
          return;

        case 'F7':
          // Toggle Rotation Gizmo
          e.preventDefault();
          toggleRotationGizmo();
          return;

        case 'F12':
          // Toggle Dynamic Input
          e.preventDefault();
          toggleDynamicInput();
          return;
      }

      // Prevent Tab from focusing interface fields when the dimension tool is active
      if (e.key === 'Tab' && activeTool === 'dimension') {
        e.preventDefault();
        return;
      }

      // Drawing-specific shortcuts - only when in drawing mode
      if (!isDrawing || drawingPoints.length === 0) return;

      switch (e.key) {
        case ' ':
          // Spacebar: toggle linear dimension direction
          if (activeTool === 'dimension' && dimensionMode === 'linear') {
            e.preventDefault();
            if (linearDimensionDirection === 'auto' || linearDimensionDirection === 'vertical') {
              setLinearDimensionDirection('horizontal');
            } else {
              setLinearDimensionDirection('vertical');
            }
          }
          break;

        case 'Escape':
          // Finalize drawing if enough points exist, otherwise cancel
          e.preventDefault();
          // If in filled region sketch mode, Escape stops current segment drawing
          // (goes to select mode within sketch) — does NOT cancel the whole sketch
          if (filledRegionMode) {
            clearDrawingPoints();
            setDrawingPreview(null);
            // Switch to select within the sketch (user can still click Finish/Cancel in toolbar)
            useAppStore.getState().setActiveTool('select');
            break;
          }
          if (activeTool === 'polyline' && drawingPoints.length >= 2) {
            const bulges = useAppStore.getState().drawingBulges;
            const polylineShape: PolylineShape = {
              id: generateId(),
              type: 'polyline',
              layerId: activeLayerId,
              drawingId: activeDrawingId,
              style: { ...currentStyle },
              visible: true,
              locked: false,
              points: [...drawingPoints],
              closed: false,
              bulge: bulges && bulges.some(b => b !== 0) ? [...bulges] : undefined,
            };
            addShape(polylineShape);
          } else if (activeTool === 'spline' && drawingPoints.length >= 2) {
            const splineShape: SplineShape = {
              id: generateId(),
              type: 'spline',
              layerId: activeLayerId,
              drawingId: activeDrawingId,
              style: { ...currentStyle },
              visible: true,
              locked: false,
              points: [...drawingPoints],
              closed: false,
            };
            addShape(splineShape);
          } else if (activeTool === 'slab' && drawingPoints.length >= 3) {
            const ps = useAppStore.getState().pendingSlab;
            // Resolve level from pendingSlab or current drawing's storey
            let slabLevel = ps?.level || '';
            if (!slabLevel) {
              const state = useAppStore.getState();
              const drawing = state.drawings.find((d) => d.id === activeDrawingId);
              if (drawing && drawing.drawingType === 'plan' && drawing.storeyId) {
                slabLevel = drawing.storeyId;
              }
            }
            const slabShape: SlabShape = {
              id: generateId(),
              type: 'slab',
              layerId: activeLayerId,
              drawingId: activeDrawingId,
              style: { ...currentStyle },
              visible: true,
              locked: false,
              points: [...drawingPoints],
              thickness: ps?.thickness ?? 200,
              level: slabLevel,
              elevation: ps?.elevation ?? 0,
              material: ps?.material ?? 'concrete',
              hatchType: 'diagonal',
              hatchAngle: 45,
              hatchSpacing: 100,
            };
            addShape(slabShape);
          }
          clearDrawingPoints();
          setDrawingPreview(null);
          break;

        case 'Enter':
          // Finish drawing operation - create shape if applicable
          e.preventDefault();
          // In filled region sketch mode: Enter ends the current segment drawing
          // (same as Escape — user clicks Finish in toolbar to create the hatch)
          if (filledRegionMode) {
            clearDrawingPoints();
            setDrawingPreview(null);
            useAppStore.getState().setActiveTool('select');
            break;
          }
          if (activeTool === 'polyline' && drawingPoints.length >= 2) {
            const bulges = useAppStore.getState().drawingBulges;
            const polylineShape: PolylineShape = {
              id: generateId(),
              type: 'polyline',
              layerId: activeLayerId,
              drawingId: activeDrawingId,
              style: { ...currentStyle },
              visible: true,
              locked: false,
              points: [...drawingPoints],
              closed: false,
              bulge: bulges && bulges.some(b => b !== 0) ? [...bulges] : undefined,
            };
            addShape(polylineShape);
          } else if (activeTool === 'spline' && drawingPoints.length >= 2) {
            const splineShape: SplineShape = {
              id: generateId(),
              type: 'spline',
              layerId: activeLayerId,
              drawingId: activeDrawingId,
              style: { ...currentStyle },
              visible: true,
              locked: false,
              points: [...drawingPoints],
              closed: false,
            };
            addShape(splineShape);
          } else if (activeTool === 'slab' && drawingPoints.length >= 3) {
            const ps = useAppStore.getState().pendingSlab;
            // Resolve level from pendingSlab or current drawing's storey
            let slabLevel2 = ps?.level || '';
            if (!slabLevel2) {
              const state = useAppStore.getState();
              const drawing = state.drawings.find((d) => d.id === activeDrawingId);
              if (drawing && drawing.drawingType === 'plan' && drawing.storeyId) {
                slabLevel2 = drawing.storeyId;
              }
            }
            const slabShape: SlabShape = {
              id: generateId(),
              type: 'slab',
              layerId: activeLayerId,
              drawingId: activeDrawingId,
              style: { ...currentStyle },
              visible: true,
              locked: false,
              points: [...drawingPoints],
              thickness: ps?.thickness ?? 200,
              level: slabLevel2,
              elevation: ps?.elevation ?? 0,
              material: ps?.material ?? 'concrete',
              hatchType: 'diagonal',
              hatchAngle: 45,
              hatchSpacing: 100,
            };
            addShape(slabShape);
          }
          clearDrawingPoints();
          setDrawingPreview(null);
          break;

        case 'u':
        case 'U':
          // Undo last point
          e.preventDefault();
          undoDrawingPoint();
          break;

        case 'a':
        case 'A':
          // Switch to arc segment mode (polyline only)
          if (activeTool === 'polyline') {
            e.preventDefault();
            setPolylineArcMode(true);
          }
          break;

        case 'l':
        case 'L':
          // Switch to line segment mode (polyline only)
          if (activeTool === 'polyline') {
            e.preventDefault();
            setPolylineArcMode(false);
          }
          break;

        case 'c':
        case 'C':
          // Close shape - works for line and polyline tools
          if (drawingPoints.length >= 2) {
            e.preventDefault();

            // In filled region sketch mode: C ends the current segment drawing
            if (filledRegionMode) {
              clearDrawingPoints();
              setDrawingPreview(null);
              useAppStore.getState().setActiveTool('select');
              break;
            }

            if (activeTool === 'line') {
              // Create closing line from last point to first point
              const firstPoint = drawingPoints[0];
              const lastPoint = drawingPoints[drawingPoints.length - 1];

              const dx = Math.abs(lastPoint.x - firstPoint.x);
              const dy = Math.abs(lastPoint.y - firstPoint.y);

              if (dx > 1 || dy > 1) {
                const lineShape: LineShape = {
                  id: generateId(),
                  type: 'line',
                  layerId: activeLayerId,
                  drawingId: activeDrawingId,
                  style: { ...currentStyle },
                  visible: true,
                  locked: false,
                  start: lastPoint,
                  end: firstPoint,
                };
                addShape(lineShape);
              }
            } else if (activeTool === 'polyline') {
              // Create closed polyline with bulge data
              const bulges = useAppStore.getState().drawingBulges;
              const polylineShape: PolylineShape = {
                id: generateId(),
                type: 'polyline',
                layerId: activeLayerId,
                drawingId: activeDrawingId,
                style: { ...currentStyle },
                visible: true,
                locked: false,
                points: [...drawingPoints],
                closed: true,
                bulge: bulges && bulges.some(b => b !== 0) ? [...bulges] : undefined,
              };
              addShape(polylineShape);
            } else if (activeTool === 'hatch' && drawingPoints.length >= 3) {
              // Create hatch shape (always closed)
              const {
                hatchPatternType,
                hatchPatternAngle,
                hatchPatternScale,
                hatchFillColor,
                hatchBackgroundColor,
              } = useAppStore.getState();
              const hatchShape: HatchShape = {
                id: generateId(),
                type: 'hatch',
                layerId: activeLayerId,
                drawingId: activeDrawingId,
                style: { ...currentStyle },
                visible: true,
                locked: false,
                points: [...drawingPoints],
                patternType: hatchPatternType,
                patternAngle: hatchPatternAngle,
                patternScale: hatchPatternScale,
                fillColor: hatchFillColor,
                backgroundColor: hatchBackgroundColor ?? undefined,
              };
              addShape(hatchShape);
            } else if (activeTool === 'spline') {
              // Create closed spline
              const splineShape: SplineShape = {
                id: generateId(),
                type: 'spline',
                layerId: activeLayerId,
                drawingId: activeDrawingId,
                style: { ...currentStyle },
                visible: true,
                locked: false,
                points: [...drawingPoints],
                closed: true,
              };
              addShape(splineShape);
            } else if (activeTool === 'slab' && drawingPoints.length >= 3) {
              // Close and create slab polygon
              const ps = useAppStore.getState().pendingSlab;
              // Resolve level from pendingSlab or current drawing's storey
              let slabLevel3 = ps?.level || '';
              if (!slabLevel3) {
                const state = useAppStore.getState();
                const drawing = state.drawings.find((d) => d.id === activeDrawingId);
                if (drawing && drawing.drawingType === 'plan' && drawing.storeyId) {
                  slabLevel3 = drawing.storeyId;
                }
              }
              const slabShape: SlabShape = {
                id: generateId(),
                type: 'slab',
                layerId: activeLayerId,
                drawingId: activeDrawingId,
                style: { ...currentStyle },
                visible: true,
                locked: false,
                points: [...drawingPoints],
                thickness: ps?.thickness ?? 200,
                level: slabLevel3,
                elevation: ps?.elevation ?? 0,
                material: ps?.material ?? 'concrete',
                hatchType: 'diagonal',
                hatchAngle: 45,
                hatchSpacing: 100,
              };
              addShape(slabShape);
            }

            clearDrawingPoints();
            setDrawingPreview(null);
          }
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    activeTool,
    drawingPoints,
    clearDrawingPoints,
    undoDrawingPoint,
    setDrawingPreview,
    addShape,
    activeLayerId,
    activeDrawingId,
    currentStyle,
    isDrawing,
    polylineArcMode,
    setPolylineArcMode,
    dimensionMode,
    linearDimensionDirection,
    setLinearDimensionDirection,
    filledRegionMode,
    toggleSnap,
    toggleOrthoMode,
    togglePolarTracking,
    toggleObjectTracking,
    toggleRotationGizmo,
  ]);
}
