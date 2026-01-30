import { useEffect } from 'react';
import { useAppStore } from '../state/appStore';

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

export function useKeyboardShortcuts() {
  const {
    setActiveTool,
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
    setPendingCommand,
  } = useAppStore();

  useEffect(() => {
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
            return;
          case '=':
          case '+': {
            e.preventDefault();
            // Go to larger scale (smaller denominator)
            const currentIndex = VIEWPORT_SCALES.indexOf(placementScale);
            if (currentIndex > 0) {
              setPlacementScale(VIEWPORT_SCALES[currentIndex - 1]);
            } else if (currentIndex === -1) {
              // Find closest smaller scale
              const closerIndex = VIEWPORT_SCALES.findIndex(s => s <= placementScale);
              if (closerIndex > 0) {
                setPlacementScale(VIEWPORT_SCALES[closerIndex - 1]);
              }
            }
            return;
          }
          case '-': {
            e.preventDefault();
            // Go to smaller scale (larger denominator)
            const currentIndex = VIEWPORT_SCALES.indexOf(placementScale);
            if (currentIndex >= 0 && currentIndex < VIEWPORT_SCALES.length - 1) {
              setPlacementScale(VIEWPORT_SCALES[currentIndex + 1]);
            } else if (currentIndex === -1) {
              // Find closest larger scale
              const closerIndex = VIEWPORT_SCALES.findIndex(s => s < placementScale);
              if (closerIndex >= 0) {
                setPlacementScale(VIEWPORT_SCALES[closerIndex]);
              }
            }
            return;
          }
        }
      }

      // Tool shortcuts (single keys)
      if (!ctrl && !shift) {
        switch (key) {
          case 'v':
          case 'escape':
            setActiveTool('select');
            break;
          case 'h':
            setActiveTool('pan');
            break;
          case 'l':
            setActiveTool('line');
            break;
          case 'r':
            setActiveTool('rectangle');
            break;
          case 'c':
            setActiveTool('circle');
            break;
          case 'a':
            setActiveTool('arc');
            break;
          case 'p':
            setActiveTool('polyline');
            break;
          case 't':
            setActiveTool('text');
            break;
          case 'm':
            setPendingCommand('MOVE');
            break;
          case 'delete':
          case 'backspace':
            // Delete selected viewport in sheet mode
            if (editorMode === 'sheet' && viewportEditState.selectedViewportId && activeSheetId) {
              deleteSheetViewport(activeSheetId, viewportEditState.selectedViewportId);
            }
            // Delete selected shapes in drawing mode
            else if (selectedShapeIds.length > 0) {
              deleteSelectedShapes();
            }
            break;
          case 'g':
            toggleGrid();
            break;
          case 's':
            if (!ctrl) {
              toggleSnap();
            }
            break;
          case 'f':
            zoomToFit();
            break;
          case '=':
          case '+':
            zoomIn();
            break;
          case '-':
            zoomOut();
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
          case 'd':
            e.preventDefault();
            deselectAll();
            break;
          case 's':
            e.preventDefault();
            // TODO: Save file
            console.log('Save');
            break;
          case 'o':
            e.preventDefault();
            // TODO: Open file
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
        }
      }

      // Ctrl+Shift shortcuts
      if (ctrl && shift) {
        switch (key) {
          case 'z':
            e.preventDefault();
            redo();
            break;
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    setActiveTool,
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
    isPlacing,
    placementScale,
    cancelPlacement,
    setPlacementScale,
    editorMode,
    activeSheetId,
    viewportEditState,
    deleteSheetViewport,
  ]);
}
