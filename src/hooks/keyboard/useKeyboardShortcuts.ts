import { useEffect } from 'react';
import { useAppStore } from '../../state/appStore';
import { getShapeBounds } from '../../engine/geometry/GeometryUtils';
import { findConnectedShapes } from '../../engine/geometry/ConnectedShapeDetection';
import { getNextSectionLabel } from '../drawing/useSectionCalloutDrawing';
import type { Point, Shape } from '../../types/geometry';
import { keyboardShortcutRegistry } from '../../engine/registry/KeyboardShortcutRegistry';

/**
 * Compute the default rotation center for a shape.
 * - Line-like shapes (line, beam, wall, gridline, level, section-callout): start point
 * - Center-based shapes (circle, arc, ellipse): center
 * - Position-based shapes (text, point, pile, cpt, image, spot-elevation): position
 * - Polygon shapes (polyline, spline, hatch, slab, space, plate-system, foundation-zone): centroid of points
 * - Rectangle: center of the rectangle
 * - Dimension: first reference point
 */
function getShapeRotationCenter(shape: Shape): Point | null {
  switch (shape.type) {
    // Line-like shapes: use start point
    case 'line':
    case 'beam':
    case 'wall':
    case 'gridline':
    case 'level':
    case 'section-callout':
      return { x: shape.start.x, y: shape.start.y };

    // Center-based shapes: use center
    case 'circle':
    case 'arc':
    case 'ellipse':
      return { x: shape.center.x, y: shape.center.y };

    // Position-based shapes: use position
    case 'text':
    case 'point':
    case 'pile':
    case 'cpt':
    case 'image':
    case 'spot-elevation':
      return { x: shape.position.x, y: shape.position.y };

    // Rectangle: use center
    case 'rectangle':
      return {
        x: shape.topLeft.x + shape.width / 2,
        y: shape.topLeft.y + shape.height / 2,
      };

    // Polygon shapes: compute centroid
    case 'polyline':
    case 'spline': {
      if (shape.points.length === 0) return null;
      const sumX = shape.points.reduce((s, p) => s + p.x, 0);
      const sumY = shape.points.reduce((s, p) => s + p.y, 0);
      return { x: sumX / shape.points.length, y: sumY / shape.points.length };
    }
    case 'hatch': {
      if (shape.points.length === 0) return null;
      const sumX = shape.points.reduce((s, p) => s + p.x, 0);
      const sumY = shape.points.reduce((s, p) => s + p.y, 0);
      return { x: sumX / shape.points.length, y: sumY / shape.points.length };
    }
    case 'slab': {
      if (shape.points.length === 0) return null;
      const sumX = shape.points.reduce((s, p) => s + p.x, 0);
      const sumY = shape.points.reduce((s, p) => s + p.y, 0);
      return { x: sumX / shape.points.length, y: sumY / shape.points.length };
    }
    case 'space': {
      if (shape.contourPoints.length === 0) return null;
      const sumX = shape.contourPoints.reduce((s, p) => s + p.x, 0);
      const sumY = shape.contourPoints.reduce((s, p) => s + p.y, 0);
      return { x: sumX / shape.contourPoints.length, y: sumY / shape.contourPoints.length };
    }
    case 'plate-system': {
      if (shape.contourPoints.length === 0) return null;
      const sumX = shape.contourPoints.reduce((s, p) => s + p.x, 0);
      const sumY = shape.contourPoints.reduce((s, p) => s + p.y, 0);
      return { x: sumX / shape.contourPoints.length, y: sumY / shape.contourPoints.length };
    }
    case 'foundation-zone': {
      if (shape.contourPoints.length === 0) return null;
      const sumX = shape.contourPoints.reduce((s, p) => s + p.x, 0);
      const sumY = shape.contourPoints.reduce((s, p) => s + p.y, 0);
      return { x: sumX / shape.contourPoints.length, y: sumY / shape.contourPoints.length };
    }

    // Dimension: first point
    case 'dimension': {
      if (shape.points.length === 0) return null;
      return { x: shape.points[0].x, y: shape.points[0].y };
    }

    default:
      return null;
  }
}

// Common viewport scales (as ratios, e.g., 0.01 = 1:100)
const VIEWPORT_SCALES = [
  1,      // 1:1
  0.5,    // 1:2
  0.2,    // 1:5
  0.1,    // 1:10
  0.05,   // 1:20
  0.02,   // 1:50
  0.01,   // 1:100
  0.005,  // 1:200
  0.002,  // 1:500
  0.001,  // 1:1000
];

// Two-key shortcut sequences (two-key style)
const TWO_KEY_SHORTCUTS: Record<string, string> = {
  'md': 'select',
  'mv': 'move',
  'co': 'copy',
  'cc': 'copy2',
  'ro': 'rotate',
  'mm': 'mirror',
  're': 'scale',
  'tr': 'trim',
  'ex': 'extend',
  'of': 'offset',
  'fl': 'fillet',
  'li': 'line',
  'rc': 'rectangle',
  'ci': 'circle',
  'ar': 'arc',
  'pl': 'polyline',
  'el': 'ellipse',
  'sp': 'spline',
  'tx': 'text',
  'le': 'leader',
  'di': 'dimension',
  'dl': 'dimension-linear',
  'da': 'dimension-angular',
  'dr': 'dimension-radius',
  'dd': 'dimension-diameter',
  'al': 'align',    // Align tool
  'ay': 'array',    // Array tool
  'lb': 'label',    // Structural label
  'im': 'image',    // Image import
  'cs': 'create-similar',  // Create Similar
  'tl': 'toggle-thin-lines',  // Toggle thin/thick line display
  'za': 'zoom-all',           // Zoom to fit all shapes
};

const TWO_KEY_TIMEOUT = 750; // ms to wait for second key

export function useKeyboardShortcuts() {
  const {
    setActiveTool,
    setDimensionMode,
    deleteSelectedShapes,
    selectAll,
    deselectAll,
    zoomIn,
    zoomOut,
    zoomToFit,
    toggleGrid,
    toggleSnap,
    selectedShapeIds,
    undo,
    redo,
    setPrintDialogOpen,
    printDialogOpen,
    // Tool state
    activeTool,
    lastTool,
    repeatLastTool,
    isDrawing,
    // Placement state
    isPlacing,
    placementScale,
    cancelPlacement,
    setPlacementScale,
    // Sheet mode state
    editorMode,
    activeSheetId,
    viewportEditState,
    deleteSheetViewport,
    // Document management
    createNewDocument,
    closeDocument,
    switchDocument,
    activeDocumentId,
    documentOrder,
    setFindReplaceDialogOpen,
    findReplaceDialogOpen,
    // Clipboard
    copySelectedShapes,
    cutSelectedShapes,
    pasteShapes,
    // Visibility
    hideSelectedShapes,
    showAllShapes,
    isolateSelectedShapes,
    // Locking
    lockSelectedShapes,
    unlockSelectedShapes,
    // Grouping
    groupSelectedShapes,
    ungroupSelectedShapes,
    // 2D Cursor
    resetCursor2D,
    setCursor2DToSelected,
    snapSelectionToCursor2D,
    // Modify constraint
    modifyConstrainAxis,
    setModifyConstrainAxis,
    toggleModifyOrtho,
    drawingPoints,
    // Display toggle
    toggleShowLineweight,
    // Plate system edit mode
    plateSystemEditMode,
    editingPlateSystemId,
    setPlateSystemEditMode,
    shapes,
  } = useAppStore();

  useEffect(() => {
    let pendingKey = '';
    let pendingTimer: ReturnType<typeof setTimeout> | null = null;

    const clearPending = () => {
      pendingKey = '';
      if (pendingTimer) {
        clearTimeout(pendingTimer);
        pendingTimer = null;
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't handle shortcuts when typing in input fields or textareas
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        document.activeElement?.tagName === 'INPUT' ||
        document.activeElement?.tagName === 'TEXTAREA'
      ) {
        return;
      }

      const key = e.key.toLowerCase();
      const ctrl = e.ctrlKey || e.metaKey;
      const shift = e.shiftKey;

      // Handle placement mode shortcuts first
      if (isPlacing) {
        switch (key) {
          case 'escape':
            e.preventDefault();
            cancelPlacement();
            clearPending();
            return;
          case '=':
          case '+': {
            e.preventDefault();
            const currentIndex = VIEWPORT_SCALES.indexOf(placementScale);
            if (currentIndex > 0) {
              setPlacementScale(VIEWPORT_SCALES[currentIndex - 1]);
            } else if (currentIndex === -1) {
              const closerIndex = VIEWPORT_SCALES.findIndex(s => s <= placementScale);
              if (closerIndex > 0) {
                setPlacementScale(VIEWPORT_SCALES[closerIndex - 1]);
              }
            }
            return;
          }
          case '-': {
            e.preventDefault();
            const currentIndex = VIEWPORT_SCALES.indexOf(placementScale);
            if (currentIndex >= 0 && currentIndex < VIEWPORT_SCALES.length - 1) {
              setPlacementScale(VIEWPORT_SCALES[currentIndex + 1]);
            } else if (currentIndex === -1) {
              const closerIndex = VIEWPORT_SCALES.findIndex(s => s < placementScale);
              if (closerIndex >= 0) {
                setPlacementScale(VIEWPORT_SCALES[closerIndex]);
              }
            }
            return;
          }
        }
      }

      // Shift toggles sticky ortho for move/copy/copy2/array (when base point is set)
      if (key === 'shift' &&
          (activeTool === 'move' || activeTool === 'copy' || activeTool === 'copy2' || activeTool === 'array') && drawingPoints.length >= 1) {
        e.preventDefault();
        toggleModifyOrtho();
        return;
      }

      // X/Y axis constraint for move/copy/array (when base point is set)
      if (!ctrl && !shift && (key === 'x' || key === 'y') &&
          (activeTool === 'move' || activeTool === 'copy' || activeTool === 'copy2' || activeTool === 'array') && drawingPoints.length >= 1) {
        e.preventDefault();
        clearPending();
        const axis = key as 'x' | 'y';
        // Toggle: pressing same axis again removes constraint
        setModifyConstrainAxis(modifyConstrainAxis === axis ? null : axis);
        return;
      }

      // Two-key sequence handling (two-key style)
      if (!ctrl && !shift && key.length === 1 && key >= 'a' && key <= 'z') {
        if (pendingKey) {
          // Second key of a two-key sequence
          const combo = pendingKey + key;
          clearPending();
          const tool = TWO_KEY_SHORTCUTS[combo];
          if (tool) {
            e.preventDefault();
            if (tool.startsWith('dimension-')) {
              const mode = tool.replace('dimension-', '') as any;
              setDimensionMode(mode);
              setActiveTool('dimension');
            } else if (tool === 'create-similar') {
              // Create Similar: activate the tool matching the selected shape type
              if (editorMode === 'drawing') {
                const s = useAppStore.getState();
                if (s.selectedShapeIds.length > 0) {
                  const selShape = s.shapes.find(sh => sh.id === s.selectedShapeIds[0]);
                  if (selShape) {
                    // For text shapes with leader, activate leader tool instead
                    const txt = selShape as any;
                    const isLeader = selShape.type === 'text' && (txt.leaderPoints?.length > 0 || txt.leaders?.length > 0);

                    const typeToTool: Record<string, string> = {
                      line: 'line', rectangle: 'rectangle', circle: 'circle',
                      arc: 'arc', polyline: 'polyline', ellipse: 'ellipse',
                      spline: 'spline', text: 'text', dimension: 'dimension',
                      hatch: 'hatch', gridline: 'gridline', level: 'level', wall: 'wall',
                      slab: 'slab', beam: 'beam', pile: 'pile', puntniveau: 'puntniveau', cpt: 'cpt', space: 'space',
                      'plate-system': 'plate-system', 'section-callout': 'section-callout',
                      'spot-elevation': 'spot-elevation',
                    };
                    const mappedTool = isLeader ? 'leader' : typeToTool[selShape.type];
                    if (mappedTool === 'gridline') {
                      const gl = selShape as any;
                      useAppStore.getState().setPendingGridline({ label: gl.label || '1', bubblePosition: gl.bubblePosition || 'both', bubbleRadius: gl.bubbleRadius || 450, fontSize: gl.fontSize || 315 });
                    } else if (mappedTool === 'level') {
                      const lv = selShape as any;
                      useAppStore.getState().setPendingLevel({ label: lv.label || '0', labelPosition: 'end', bubbleRadius: lv.bubbleRadius || 400, fontSize: lv.fontSize || 250, elevation: lv.elevation ?? 0, peil: lv.peil ?? 0, description: lv.description });
                    } else if (mappedTool === 'wall') {
                      const wl = selShape as any;
                      const st = useAppStore.getState();
                      st.setPendingWall({
                        thickness: wl.thickness || 200, wallTypeId: wl.wallTypeId,
                        justification: wl.justification || 'center',
                        showCenterline: wl.showCenterline ?? true, startCap: wl.startCap || 'butt',
                        endCap: wl.endCap || 'butt',
                        continueDrawing: true,
                        shapeMode: 'line',
                        spaceBounding: wl.spaceBounding ?? true,
                      });
                      if (wl.wallTypeId) {
                        st.setLastUsedWallTypeId(wl.wallTypeId);
                      }
                    } else if (mappedTool === 'slab') {
                      const sb = selShape as any;
                      useAppStore.getState().setPendingSlab({
                        thickness: sb.thickness || 200,
                        level: sb.level || '0',
                        elevation: sb.elevation ?? 0,
                        material: sb.material || 'concrete',
                        shapeMode: 'line',
                      });
                    } else if (mappedTool === 'beam') {
                      const bm = selShape as any;
                      useAppStore.getState().setPendingBeam({
                        profileType: bm.profileType || 'i-beam',
                        parameters: bm.profileParameters || {},
                        presetId: bm.presetId,
                        presetName: bm.presetName,
                        flangeWidth: bm.flangeWidth || 200,
                        material: bm.material || 'steel',
                        justification: bm.justification || 'center',
                        showCenterline: bm.showCenterline ?? true,
                        showLabel: bm.showLabel ?? false,
                        continueDrawing: true,
                        viewMode: bm.viewMode || 'plan',
                        shapeMode: 'line',
                      });
                    } else if (mappedTool === 'pile') {
                      const pl = selShape as any;
                      useAppStore.getState().setPendingPile({
                        label: pl.label || 'P1',
                        diameter: pl.diameter || 300,
                        fontSize: pl.fontSize || 150,
                        showCross: pl.showCross ?? true,
                        pileTypeId: pl.pileTypeId,
                        contourType: pl.contourType,
                        fillPattern: pl.fillPattern,
                      });
                    } else if (mappedTool === 'puntniveau') {
                      const pnv = selShape as any;
                      useAppStore.getState().setPendingPuntniveau({
                        puntniveauNAP: pnv.puntniveauNAP ?? -12.5,
                        fontSize: pnv.fontSize || 300,
                      });
                    } else if (mappedTool === 'cpt') {
                      const cp = selShape as any;
                      useAppStore.getState().setPendingCPT({
                        name: cp.name || '01',
                        fontSize: cp.fontSize || 150,
                        markerSize: cp.markerSize || 300,
                      });
                    } else if (mappedTool === 'plate-system') {
                      useAppStore.getState().openPlateSystemDialog();
                    } else if (mappedTool === 'section-callout') {
                      const sc = selShape as any;
                      useAppStore.getState().setPendingSectionCallout({
                        label: sc.label || getNextSectionLabel(),
                        bubbleRadius: sc.bubbleRadius || 400,
                        fontSize: sc.fontSize || 250,
                        flipDirection: sc.flipDirection ?? false,
                        viewDepth: sc.viewDepth ?? 5000,
                      });
                    } else if (mappedTool === 'dimension') {
                      const dm = selShape as any;
                      // Set dimension mode to match the selected dimension's type
                      if (dm.dimensionType) {
                        setDimensionMode(dm.dimensionType);
                      }
                    } else if (mappedTool === 'leader') {
                      // Copy leader config from the selected text shape
                      if (txt.leaderConfig) {
                        useAppStore.getState().updateDefaultLeaderConfig(txt.leaderConfig);
                      }
                    }
                    // Copy style for basic geometry shapes
                    if (mappedTool && ['line', 'rectangle', 'circle', 'arc', 'polyline', 'ellipse', 'spline'].includes(mappedTool)) {
                      useAppStore.getState().setCurrentStyle(selShape.style);
                    }
                    if (mappedTool) {
                      setActiveTool(mappedTool as any);
                    }
                  }
                }
              }
            } else if (tool === 'toggle-thin-lines') {
              // Toggle thin/thick line display
              toggleShowLineweight();
            } else if (tool === 'zoom-all') {
              // Zoom to fit all shapes in viewport
              zoomToFit();
            } else {
              setActiveTool(tool as any);
              // If activating 'move' with a grip-selected endpoint, auto-set base point
              if (tool === 'move') {
                const st = useAppStore.getState();
                if (st.selectedGrip && st.selectedShapeIds.length > 0) {
                  const gripShape = st.shapes.find(sh => sh.id === st.selectedGrip!.shapeId);
                  if (gripShape) {
                    const endpointKey = st.selectedGrip.gripIndex === 0 ? 'start' : 'end';
                    const endpoint = (gripShape as any)[endpointKey];
                    if (endpoint) {
                      st.addDrawingPoint(endpoint);
                    }
                  }
                }
              }
              // If activating 'rotate' with shapes selected, auto-set rotation
              // center to the first selected shape's start point (for line-like
              // shapes) or center/position, and add a horizontal reference ray
              // so rotation begins immediately on mouse move.
              if (tool === 'rotate') {
                const st = useAppStore.getState();
                if (st.selectedShapeIds.length > 0) {
                  const firstShape = st.shapes.find(sh => sh.id === st.selectedShapeIds[0]);
                  if (firstShape) {
                    const center = getShapeRotationCenter(firstShape);
                    if (center) {
                      // Point 1: rotation center
                      st.addDrawingPoint(center);
                      // Point 2: horizontal reference ray (start angle = 0)
                      st.addDrawingPoint({ x: center.x + 1000, y: center.y });
                    }
                  }
                }
              }
            }
            return;
          }
          // Check extension keyboard shortcuts
          const extShortcut = keyboardShortcutRegistry.get(combo);
          if (extShortcut) {
            e.preventDefault();
            extShortcut.activate();
            return;
          }
          // Invalid combo — fall through to single-key handling for the second key
        }

        // Check if this key could be the start of a two-key combo
        const allShortcutKeys = [...Object.keys(TWO_KEY_SHORTCUTS), ...keyboardShortcutRegistry.getAllKeys()];
        const possibleCombos = allShortcutKeys.filter(k => k[0] === key);
        if (possibleCombos.length > 0) {
          // Special case: 'g' with shapes selected → execute move immediately
          // (skip 750ms two-key timeout since 'gl' is rarely wanted with a selection)
          if (key === 'g' && useAppStore.getState().selectedShapeIds.length > 0) {
            executeSingleKey('g');
            return;
          }
          pendingKey = key;
          pendingTimer = setTimeout(() => {
            // Timer expired — no second key, so execute single-key action
            const saved = pendingKey;
            clearPending();
            executeSingleKey(saved);
          }, TWO_KEY_TIMEOUT);
          return;
        }

        // Single-letter shortcuts that don't start any two-key combo
        executeSingleKey(key);
        return;
      }

      // Non-letter keys or modifiers: clear pending and handle immediately
      if (pendingKey && (ctrl || shift || key.length !== 1 || key < 'a' || key > 'z')) {
        clearPending();
      }

      // Escape always works immediately (but not when print dialog is open)
      if (key === 'escape') {
        if (printDialogOpen) return;
        clearPending();
        // Plate system edit mode: cascaded ESC
        if (plateSystemEditMode) {
          const s = useAppStore.getState();
          // 1) If sub-tool is not 'select', go back to select
          if (s.plateSystemSubTool !== 'select') {
            s.setPlateSystemSubTool('select');
            return;
          }
          // 2) If an opening is selected, deselect it
          if (s.selectedOpeningId) {
            s.setSelectedOpeningId(null);
            return;
          }
          // 3) Exit edit mode
          setPlateSystemEditMode(false);
          deselectAll();
          return;
        }
        // Clear pre-selection if active
        {
          const s = useAppStore.getState();
          if (s.preSelectedShapeIds.length > 0) {
            s.setPreSelectedShapes([]);
            return;
          }
        }
        setActiveTool('select');
        return;
      }

      // TAB (no modifiers) + offset tool: flip offset side
      if (key === 'tab' && !ctrl && !shift && activeTool === 'offset') {
        e.preventDefault();
        useAppStore.getState().toggleOffsetFlip();
        return;
      }

      // TAB (no modifiers): pre-select connected shapes OR toggle plate system edit mode
      if (key === 'tab' && !ctrl && !shift) {
        // If already in plate system edit mode, exit it
        if (plateSystemEditMode) {
          e.preventDefault();
          setPlateSystemEditMode(false);
          // Select the parent plate system when exiting edit mode
          if (editingPlateSystemId) {
            const s = useAppStore.getState();
            const parentExists = s.shapes.find(sh => sh.id === editingPlateSystemId);
            if (parentExists) {
              s.selectShapes([editingPlateSystemId]);
            }
          }
          return;
        }
        // If hovering over a wall/line/beam in select mode, pre-select connected chain
        if (activeTool === 'select') {
          const s = useAppStore.getState();
          if (s.hoveredShapeId) {
            const hoveredShape = s.shapes.find(sh => sh.id === s.hoveredShapeId);
            if (hoveredShape && ['wall', 'line', 'beam'].includes(hoveredShape.type)) {
              const drawingShapes = s.shapes.filter(sh => sh.drawingId === s.activeDrawingId);
              const connected = findConnectedShapes(s.hoveredShapeId, drawingShapes);
              if (connected.length > 0) {
                s.setPreSelectedShapes(connected);
                e.preventDefault();
                return;
              }
            }
          }
        }
        // If a plate system is selected (or a child beam of one), enter edit mode
        if (activeTool === 'select' && selectedShapeIds.length > 0) {
          const s = useAppStore.getState();
          const selectedShape = s.shapes.find(sh => sh.id === selectedShapeIds[0]);
          if (selectedShape) {
            if (selectedShape.type === 'plate-system') {
              e.preventDefault();
              setPlateSystemEditMode(true, selectedShape.id);
              return;
            }
            // If a child beam is selected, enter edit mode for its parent system
            if (selectedShape.type === 'beam') {
              const beam = selectedShape as import('../../types/geometry').BeamShape;
              if (beam.plateSystemId) {
                e.preventDefault();
                setPlateSystemEditMode(true, beam.plateSystemId);
                return;
              }
            }
          }
        }
      }

      // Non-tool single keys
      if (!ctrl && !shift) {
        switch (key) {
          case 'delete':
          case 'backspace':
            // Delete selected opening in plate system edit mode
            if (plateSystemEditMode && editingPlateSystemId) {
              const s = useAppStore.getState();
              if (s.selectedOpeningId) {
                const ps = s.shapes.find(sh => sh.id === editingPlateSystemId) as import('../../types/geometry').PlateSystemShape | undefined;
                if (ps?.openings) {
                  s.updateShape(editingPlateSystemId, {
                    openings: ps.openings.filter(o => o.id !== s.selectedOpeningId),
                  } as any);
                  s.setSelectedOpeningId(null);
                }
                break;
              }
            }
            if (editorMode === 'sheet' && viewportEditState.selectedViewportId && activeSheetId) {
              deleteSheetViewport(activeSheetId, viewportEditState.selectedViewportId);
            } else if (selectedShapeIds.length > 0) {
              deleteSelectedShapes();
            }
            break;
          // Number keys 1-5: plate system sub-tool shortcuts
          case '1':
          case '2':
          case '3':
          case '4':
          case '5': {
            if (plateSystemEditMode) {
              const subTools = ['select', 'add-point', 'arc-edge', 'add-opening', 'delete'] as const;
              const idx = parseInt(key) - 1;
              useAppStore.getState().setPlateSystemSubTool(subTools[idx]);
              break;
            }
            break;
          }
          case '=':
          case '+':
            zoomIn();
            break;
          case '-':
            zoomOut();
            break;
          case 'enter':
          case ' ':
            // Repeat last tool when in select mode and not drawing
            if (activeTool === 'select' && !isDrawing && lastTool) {
              e.preventDefault();
              repeatLastTool();
            }
            break;
        }
      }

      // Ctrl shortcuts
      if (ctrl && !shift) {
        switch (key) {
          case 'a':
            e.preventDefault();
            selectAll();
            break;
          case 'c':
            e.preventDefault();
            copySelectedShapes();
            break;
          case 'x':
            e.preventDefault();
            cutSelectedShapes();
            break;
          case 'v':
            e.preventDefault();
            pasteShapes();
            break;
          case 'g':
            e.preventDefault();
            groupSelectedShapes();
            break;
          case 'd':
            e.preventDefault();
            deselectAll();
            break;
          case 'n':
            e.preventDefault();
            createNewDocument();
            break;
          case 'w':
            e.preventDefault();
            closeDocument(activeDocumentId);
            break;
          case 's':
            e.preventDefault();
            console.log('Save');
            break;
          case 'o':
            e.preventDefault();
            console.log('Open');
            break;
          case 'z':
            e.preventDefault();
            undo();
            break;
          case 'y':
            e.preventDefault();
            redo();
            break;
          case 'p':
            e.preventDefault();
            setPrintDialogOpen(true);
            break;
          case 'h':
            e.preventDefault();
            setFindReplaceDialogOpen(true);
            break;
          case 'tab': {
            e.preventDefault();
            const currentIdx = documentOrder.indexOf(activeDocumentId);
            const nextIdx = (currentIdx + 1) % documentOrder.length;
            switchDocument(documentOrder[nextIdx]);
            break;
          }
        }
      }

      // Ctrl+Shift shortcuts
      if (ctrl && shift) {
        switch (key) {
          case 'z':
            e.preventDefault();
            redo();
            break;
          case 'g':
            e.preventDefault();
            ungroupSelectedShapes();
            break;
          case 'tab': {
            e.preventDefault();
            const currentIdx = documentOrder.indexOf(activeDocumentId);
            const prevIdx = (currentIdx - 1 + documentOrder.length) % documentOrder.length;
            switchDocument(documentOrder[prevIdx]);
            break;
          }
        }
      }

      // Shift shortcuts (without Ctrl)
      if (!ctrl && shift) {
        switch (key) {
          case 'h':
            e.preventDefault();
            showAllShapes();
            break;
          case 'l':
            e.preventDefault();
            unlockSelectedShapes();
            break;
          case 'c':
            e.preventDefault();
            resetCursor2D();
            break;
          case 's':
            e.preventDefault();
            // Snap cursor to selected (if shapes selected) or selected to cursor
            if (selectedShapeIds.length > 0) {
              setCursor2DToSelected();
            }
            break;
        }
      }
    };

    /**
     * Execute a single-key shortcut when the two-key timer expires.
     * These are legacy single-letter shortcuts that also serve as
     * first letters of two-key combos.
     */
    function executeSingleKey(k: string) {
      // Single-letter shortcuts for tools, visibility and locking
      switch (k) {
        case 'g': {
          setActiveTool('move');
          // Auto-set base point for immediate move
          const s = useAppStore.getState();
          if (s.selectedShapeIds.length > 0) {
            // If a grip (endpoint) is selected via box selection, use that endpoint as base point
            if (s.selectedGrip) {
              const gripShape = s.shapes.find(sh => sh.id === s.selectedGrip!.shapeId);
              if (gripShape) {
                const endpointKey = s.selectedGrip.gripIndex === 0 ? 'start' : 'end';
                const endpoint = (gripShape as any)[endpointKey];
                if (endpoint) {
                  s.addDrawingPoint(endpoint);
                  break;
                }
              }
            }
            // Default: use center of selected shapes
            const idSet = new Set(s.selectedShapeIds);
            const selected = s.shapes.filter(sh => idSet.has(sh.id));
            if (selected.length > 0) {
              let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
              for (const sh of selected) {
                const b = getShapeBounds(sh);
                if (b) {
                  minX = Math.min(minX, b.minX);
                  minY = Math.min(minY, b.minY);
                  maxX = Math.max(maxX, b.maxX);
                  maxY = Math.max(maxY, b.maxY);
                }
              }
              if (minX !== Infinity) {
                s.addDrawingPoint({ x: (minX + maxX) / 2, y: (minY + maxY) / 2 });
              }
            }
          }
          break;
        }
        case 'h':
          hideSelectedShapes();
          break;
        case 'i':
          isolateSelectedShapes();
          break;
        case 'e':
          setActiveTool('elastic');
          break;
      case 'l':
          lockSelectedShapes();
          break;
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      clearPending();
    };
  }, [
    setActiveTool,
    setDimensionMode,
    deleteSelectedShapes,
    selectAll,
    deselectAll,
    zoomIn,
    zoomOut,
    zoomToFit,
    toggleGrid,
    toggleSnap,
    selectedShapeIds,
    undo,
    redo,
    setPrintDialogOpen,
    printDialogOpen,
    activeTool,
    lastTool,
    repeatLastTool,
    isDrawing,
    isPlacing,
    placementScale,
    cancelPlacement,
    setPlacementScale,
    editorMode,
    activeSheetId,
    viewportEditState,
    deleteSheetViewport,
    createNewDocument,
    closeDocument,
    switchDocument,
    activeDocumentId,
    documentOrder,
    setFindReplaceDialogOpen,
    findReplaceDialogOpen,
    copySelectedShapes,
    cutSelectedShapes,
    pasteShapes,
    hideSelectedShapes,
    showAllShapes,
    isolateSelectedShapes,
    lockSelectedShapes,
    unlockSelectedShapes,
    groupSelectedShapes,
    ungroupSelectedShapes,
    resetCursor2D,
    setCursor2DToSelected,
    snapSelectionToCursor2D,
    modifyConstrainAxis,
    setModifyConstrainAxis,
    toggleModifyOrtho,
    drawingPoints,
    toggleShowLineweight,
    plateSystemEditMode,
    editingPlateSystemId,
    setPlateSystemEditMode,
    shapes,
  ]);
}
