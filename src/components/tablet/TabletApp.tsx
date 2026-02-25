import { useCallback, useState, useEffect, useRef, useMemo } from 'react';
import { TabletCanvas } from './TabletCanvas';
import { InfoBar } from './InfoBar';
import { TabletToolbar } from './TabletToolbar';
import { LayerPanel } from './LayerPanel';
import { DrawingPicker } from './DrawingPicker';
import { MeasureTool } from './MeasureTool';
import { ZoomControls } from './ZoomControls';
import { GestureHints } from './GestureHints';
import { DrawingTabs } from './DrawingTabs';
import { ShapeActionBar } from './ShapeActionBar';
import { PropertyInspector } from './PropertyInspector';
import { SearchPanel } from './SearchPanel';
import { RadialMenu } from './RadialMenu';
import { MiniMap } from './MiniMap';
import { MarkupToolbar } from './MarkupToolbar';
import { MarkupCanvas } from './MarkupCanvas';
import type { MarkupToolType } from './MarkupToolbar';
import type { ThemeMode } from './ThemeToggle';
import { showOpenDialog, readProjectFile } from '../../services/file/fileService';
import { useAppStore, generateId } from '../../state/appStore';
import { DEFAULT_PROJECT_INFO } from '../../types/projectInfo';
import { isAndroid } from '../../utils/platform';
import { isPointNearShape } from '../../engine/geometry/GeometryUtils';
import { findNearestSnapPoint } from '../../engine/geometry/SnapUtils';

/** Open file dialog that works on both desktop and Android. */
async function openO2dDialog(): Promise<string | null> {
  const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

  if (isTauri && isAndroid()) {
    const { open } = await import('@tauri-apps/plugin-dialog');
    const result = await open({
      multiple: false,
      filters: [
        { name: 'All Files', extensions: ['*/*'] },
      ],
      title: 'Open .o2d file',
    });
    return result as string | null;
  }

  return showOpenDialog();
}

/**
 * Extract a display name from a file path or content:// URI.
 */
function extractFileName(filePath: string): string {
  if (!filePath.startsWith('content://')) {
    return filePath.split(/[/\\]/).pop()?.replace(/\.o2d$/i, '') || 'Untitled';
  }
  try {
    const decoded = decodeURIComponent(filePath);
    const segments = decoded.split(/[/:%]/);
    const last = segments.filter(s => s.length > 0).pop() || '';
    if (last && last !== 'document' && last.length > 2) {
      return last.replace(/\.o2d$/i, '');
    }
  } catch { /* ignore */ }
  return 'Drawing';
}

interface MeasurePoint {
  worldX: number;
  worldY: number;
}

function resolveTheme(mode: ThemeMode): 'dark' | 'light' {
  if (mode === 'auto') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  return mode;
}

export default function TabletApp() {
  // Lock to landscape on Android / mobile
  useEffect(() => {
    try {
      const so = screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void>; unlock?: () => void };
      if (so?.lock) {
        so.lock('landscape').catch(() => {
          // Not supported or permission denied — ignore silently
        });
      }
    } catch {
      // screen.orientation not available
    }
    return () => {
      try {
        const so = screen.orientation as ScreenOrientation & { unlock?: () => void };
        so?.unlock?.();
      } catch { /* ignore */ }
    };
  }, []);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Panel states
  const [layerPanelOpen, setLayerPanelOpen] = useState(false);
  const [drawingPickerOpen, setDrawingPickerOpen] = useState(false);
  const [measureActive, setMeasureActive] = useState(false);
  const [showInfoBar, setShowInfoBar] = useState(false);

  // Phase 2 states
  const [theme, setTheme] = useState<ThemeMode>(() => {
    return (localStorage.getItem('tablet-theme') as ThemeMode) || 'dark';
  });
  const [selectedShapeId, setSelectedShapeId] = useState<string | null>(null);
  const [shapeActionScreen, setShapeActionScreen] = useState<{ x: number; y: number } | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [markupActive, setMarkupActive] = useState(false);
  const [gestureHintsSeen, setGestureHintsSeen] = useState(() => {
    return localStorage.getItem('tablet-gesture-hints-seen') === 'true';
  });
  const [radialMenu, setRadialMenu] = useState<{ x: number; y: number } | null>(null);
  const [miniMapVisible, setMiniMapVisible] = useState(false);
  const [propertyInspectorOpen, setPropertyInspectorOpen] = useState(false);
  const [tabletGridVisible, setTabletGridVisible] = useState(false);

  // Measure tool state
  const [measureA, setMeasureA] = useState<MeasurePoint | null>(null);
  const [measureB, setMeasureB] = useState<MeasurePoint | null>(null);
  const [measureAreaMode, setMeasureAreaMode] = useState(false);
  const [measureAreaPoints, setMeasureAreaPoints] = useState<MeasurePoint[]>([]);

  // Markup state
  const [markupTool, setMarkupTool] = useState<MarkupToolType>('pen');
  const [markupColor, setMarkupColor] = useState('#ef4444');
  const [markupWidth, setMarkupWidth] = useState(2);
  const [markupStrokes, setMarkupStrokes] = useState<Array<{
    id: string; type: MarkupToolType; points: { x: number; y: number }[];
    color: string; width: number; opacity: number; text?: string;
  }>>([]);

  // Theme resolution
  const resolvedTheme = useMemo(() => resolveTheme(theme), [theme]);
  const isLight = resolvedTheme === 'light';

  // Listen for system theme changes when in auto mode
  useEffect(() => {
    if (theme !== 'auto') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = () => {
      // Force re-render
      setTheme(t => t); // identity update won't actually trigger, use a trick
    };
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, [theme]);

  // Persist theme
  useEffect(() => {
    localStorage.setItem('tablet-theme', theme);
  }, [theme]);

  // Auto-hide info bar timer
  const infoBarTimerRef = useRef<ReturnType<typeof setTimeout>>();

  const hasProject = useAppStore(s => s.shapes.length > 0 || s.drawings.length > 0);

  // Show info bar when a project is loaded, auto-hide after 3s
  const showInfoBarBriefly = useCallback(() => {
    setShowInfoBar(true);
    clearTimeout(infoBarTimerRef.current);
    infoBarTimerRef.current = setTimeout(() => setShowInfoBar(false), 3000);
  }, []);

  // Toggle info bar on canvas area tap (when not measuring)
  const toggleInfoBar = useCallback(() => {
    setShowInfoBar(prev => {
      if (prev) {
        clearTimeout(infoBarTimerRef.current);
        return false;
      }
      infoBarTimerRef.current = setTimeout(() => setShowInfoBar(false), 3000);
      return true;
    });
  }, []);

  const handleOpen = useCallback(async () => {
    setError(null);

    const filePath = await openO2dDialog();
    if (!filePath) return;

    try {
      setLoading(true);

      const project = await readProjectFile(filePath);
      const fileName = extractFileName(filePath);

      const s = useAppStore.getState();
      const docId = generateId();
      s.openDocument(docId, {
        shapes: project.shapes,
        layers: project.layers,
        activeLayerId: project.activeLayerId,
        drawings: project.drawings || [],
        sheets: project.sheets || [],
        activeDrawingId: project.activeDrawingId || (project.drawings?.[0]?.id ?? ''),
        activeSheetId: project.activeSheetId ?? null,
        drawingViewports: project.drawingViewports || {},
        sheetViewports: project.sheetViewports || {},
        filePath,
        projectName: fileName,
        isModified: false,
        projectInfo: project.projectInfo || { ...DEFAULT_PROJECT_INFO },
        ...(project.parametricShapes ? { parametricShapes: project.parametricShapes } : {}),
        ...(project.textStyles ? { textStyles: project.textStyles } : {}),
        ...(project.customTitleBlockTemplates ? { customTitleBlockTemplates: project.customTitleBlockTemplates } : {}),
        ...(project.customSheetTemplates ? { customSheetTemplates: project.customSheetTemplates } : {}),
        ...(project.projectPatterns ? { projectPatterns: project.projectPatterns } : {}),
      });

      // Auto zoom-to-fit after opening
      setTimeout(() => {
        useAppStore.getState().zoomToFit();
      }, 100);

      // Show info bar
      showInfoBarBriefly();
    } catch (err) {
      console.error('[TabletApp] Failed to open file:', err);
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('JSON') || msg.includes('parse')) {
        setError('Not a valid .o2d file');
      } else if (msg.includes('permission') || msg.includes('denied')) {
        setError('Permission denied. Try a different location.');
      } else {
        setError(`Failed to open file: ${msg}`);
      }
    } finally {
      setLoading(false);
    }
  }, [showInfoBarBriefly]);

  // Clear timer on unmount
  useEffect(() => {
    return () => clearTimeout(infoBarTimerRef.current);
  }, []);

  // Close all panels helper
  const closeAllPanels = useCallback(() => {
    setLayerPanelOpen(false);
    setDrawingPickerOpen(false);
    setSearchOpen(false);
    setPropertyInspectorOpen(false);
    setShapeActionScreen(null);
    setSelectedShapeId(null);
    setRadialMenu(null);
  }, []);

  // Handle measure toggle
  const handleMeasureToggle = useCallback(() => {
    setMeasureActive(prev => {
      if (prev) {
        setMeasureA(null);
        setMeasureB(null);
        setMeasureAreaPoints([]);
        useAppStore.getState().setCurrentSnapPoint(null);
        return false;
      }
      closeAllPanels();
      setMarkupActive(false);
      return true;
    });
  }, [closeAllPanels]);

  // Handle markup toggle
  const handleMarkupToggle = useCallback(() => {
    setMarkupActive(prev => {
      if (!prev) {
        closeAllPanels();
        setMeasureActive(false);
        setMeasureA(null);
        setMeasureB(null);
      }
      return !prev;
    });
  }, [closeAllPanels]);

  // Track measure state in refs for stable callback
  const measureARef = useRef(measureA);
  const measureBRef = useRef(measureB);
  const measureAreaModeRef = useRef(measureAreaMode);
  measureARef.current = measureA;
  measureBRef.current = measureB;
  measureAreaModeRef.current = measureAreaMode;

  // Handle canvas tap
  const handleCanvasTap = useCallback((worldX: number, worldY: number, screenX: number, screenY: number) => {
    // Dismiss radial menu on any tap
    setRadialMenu(null);

    // Dismiss shape action bar on any tap
    setShapeActionScreen(null);

    if (measureActive) {
      // Snap to geometry
      const s = useAppStore.getState();
      const visibleShapes = s.shapes.filter(sh => sh.drawingId === s.activeDrawingId);
      const snap = findNearestSnapPoint(
        { x: worldX, y: worldY },
        visibleShapes,
        s.activeSnaps,
        15 / s.viewport.zoom,
        s.gridSize
      );
      const finalX = snap ? snap.point.x : worldX;
      const finalY = snap ? snap.point.y : worldY;

      if (snap) {
        s.setCurrentSnapPoint(snap);
      } else {
        s.setCurrentSnapPoint(null);
      }

      const point = { worldX: finalX, worldY: finalY };

      if (measureAreaModeRef.current) {
        // Area mode: add vertex, close on tap near first point
        setMeasureAreaPoints(prev => {
          if (prev.length >= 3) {
            const firstDx = finalX - prev[0].worldX;
            const firstDy = finalY - prev[0].worldY;
            const distToFirst = Math.sqrt(firstDx * firstDx + firstDy * firstDy);
            if (distToFirst < 20 / s.viewport.zoom) {
              // Close polygon
              return prev;
            }
          }
          return [...prev, point];
        });
      } else {
        // Distance mode
        if (!measureARef.current || measureBRef.current) {
          setMeasureA(point);
          setMeasureB(null);
        } else {
          setMeasureB(point);
        }
      }
      return;
    }

    if (markupActive) {
      return; // MarkupCanvas handles its own events
    }

    // Shape selection tap
    const s = useAppStore.getState();
    const visibleShapes = s.shapes.filter(sh => sh.drawingId === s.activeDrawingId);
    const tolerance = 10 / s.viewport.zoom;

    // Find the tapped shape
    for (let i = visibleShapes.length - 1; i >= 0; i--) {
      const shape = visibleShapes[i];
      if (isPointNearShape({ x: worldX, y: worldY }, shape, tolerance)) {
        setSelectedShapeId(shape.id);
        s.selectShape(shape.id);
        setShapeActionScreen({ x: screenX, y: screenY });
        return;
      }
    }

    // Tapped empty space
    s.deselectAll();
    setSelectedShapeId(null);
    if (hasProject) toggleInfoBar();
  }, [measureActive, markupActive, hasProject, toggleInfoBar]);

  // Handle long-press
  const handleLongPress = useCallback((screenX: number, screenY: number) => {
    if (measureActive || markupActive) return;
    setRadialMenu({ x: screenX, y: screenY });
  }, [measureActive, markupActive]);

  // Handle layers toggle
  const handleLayersToggle = useCallback(() => {
    setLayerPanelOpen(prev => !prev);
    setDrawingPickerOpen(false);
    setPropertyInspectorOpen(false);
    setSearchOpen(false);
  }, []);

  // Handle drawings toggle
  const handleDrawingsToggle = useCallback(() => {
    setDrawingPickerOpen(prev => !prev);
    setLayerPanelOpen(false);
    setPropertyInspectorOpen(false);
    setSearchOpen(false);
  }, []);

  // Handle search toggle
  const handleSearchToggle = useCallback(() => {
    setSearchOpen(prev => !prev);
    setLayerPanelOpen(false);
    setDrawingPickerOpen(false);
    setPropertyInspectorOpen(false);
  }, []);

  // Handle grid toggle
  const handleGridToggle = useCallback(() => {
    setTabletGridVisible(prev => !prev);
  }, []);

  // Theme cycling
  const handleThemeCycle = useCallback(() => {
    setTheme(prev => {
      const next = prev === 'dark' ? 'light' : prev === 'light' ? 'auto' : 'dark';
      return next;
    });
  }, []);

  // Shape action bar handlers
  const handleShapeInfo = useCallback(() => {
    setPropertyInspectorOpen(true);
    setShapeActionScreen(null);
    setLayerPanelOpen(false);
    setDrawingPickerOpen(false);
  }, []);

  const handleShapeZoomTo = useCallback(() => {
    const s = useAppStore.getState();
    if (selectedShapeId) {
      s.selectShape(selectedShapeId);
      // Simple zoom: just zoom in a bit toward the shape center
      // The selectShape will handle highlighting
    }
    setShapeActionScreen(null);
  }, [selectedShapeId]);

  const handleCopyXY = useCallback(() => {
    if (!selectedShapeId) return;
    const s = useAppStore.getState();
    const shape = s.shapes.find(sh => sh.id === selectedShapeId);
    if (!shape) return;
    let x = 0, y = 0;
    const anyShape = shape as unknown as Record<string, unknown>;
    if ('position' in anyShape && typeof anyShape.position === 'object' && anyShape.position) {
      const pos = anyShape.position as { x: number; y: number };
      x = pos.x; y = pos.y;
    } else if ('center' in anyShape && typeof anyShape.center === 'object' && anyShape.center) {
      const c = anyShape.center as { x: number; y: number };
      x = c.x; y = c.y;
    } else if ('start' in anyShape && typeof anyShape.start === 'object' && anyShape.start) {
      const s = anyShape.start as { x: number; y: number };
      x = s.x; y = s.y;
    }
    navigator.clipboard?.writeText(`${x.toFixed(2)}, ${y.toFixed(2)}`).catch(() => {});
    setShapeActionScreen(null);
  }, [selectedShapeId]);

  // Markup handlers
  const handleMarkupUndo = useCallback(() => {
    setMarkupStrokes(prev => prev.slice(0, -1));
  }, []);

  const handleMarkupClear = useCallback(() => {
    setMarkupStrokes([]);
  }, []);

  // Measure mode toggle
  const handleMeasureModeToggle = useCallback(() => {
    setMeasureAreaMode(prev => !prev);
    setMeasureA(null);
    setMeasureB(null);
    setMeasureAreaPoints([]);
    useAppStore.getState().setCurrentSnapPoint(null);
  }, []);

  // Determine canvas tap handler
  const canvasTapHandler = measureActive || (!markupActive && hasProject) ? handleCanvasTap : undefined;

  return (
    <div
      className={`fixed inset-0 ${isLight ? 'bg-gray-50' : 'bg-cad-bg'}`}
      data-theme={resolvedTheme}
    >
      <TabletCanvas
        onCanvasTap={canvasTapHandler}
        onLongPress={handleLongPress}
        gridVisible={tabletGridVisible}
        whiteBackground={isLight}
      />

      {/* Gesture hints overlay */}
      {!gestureHintsSeen && (
        <GestureHints onDismiss={() => setGestureHintsSeen(true)} />
      )}

      {/* Info bar */}
      {hasProject && <InfoBar visible={showInfoBar} isLight={isLight} />}

      {/* Drawing tabs */}
      {hasProject && (
        <DrawingTabs
          onOverflow={() => setDrawingPickerOpen(true)}
          isLight={isLight}
        />
      )}

      {/* Navigation rail (left) */}
      <TabletToolbar
        onOpen={handleOpen}
        onSearch={handleSearchToggle}
        onMeasure={handleMeasureToggle}
        onMarkup={handleMarkupToggle}
        onGridToggle={handleGridToggle}
        onLayers={handleLayersToggle}
        onDrawings={handleDrawingsToggle}
        onMiniMap={() => setMiniMapVisible(prev => !prev)}
        measureActive={measureActive}
        markupActive={markupActive}
        gridVisible={tabletGridVisible}
        layerPanelOpen={layerPanelOpen}
        drawingPickerOpen={drawingPickerOpen}
        miniMapVisible={miniMapVisible}
        loading={loading}
        theme={theme}
        onThemeCycle={handleThemeCycle}
        isLight={isLight}
      />

      {/* Zoom controls + grid toggle */}
      <ZoomControls gridVisible={tabletGridVisible} onGridToggle={handleGridToggle} />

      {/* Mini-map */}
      <MiniMap visible={miniMapVisible} isLight={isLight} />

      {/* Shape action bar (floating) */}
      {shapeActionScreen && selectedShapeId && !measureActive && !markupActive && (
        <ShapeActionBar
          screenX={shapeActionScreen.x}
          screenY={shapeActionScreen.y}
          onInfo={handleShapeInfo}
          onZoomTo={handleShapeZoomTo}
          onCopyXY={handleCopyXY}
          onDismiss={() => { setShapeActionScreen(null); }}
        />
      )}

      {/* Property inspector */}
      <PropertyInspector
        shapeId={selectedShapeId}
        open={propertyInspectorOpen}
        onClose={() => setPropertyInspectorOpen(false)}
        isLight={isLight}
      />

      {/* Layer panel */}
      <LayerPanel
        open={layerPanelOpen}
        onClose={() => setLayerPanelOpen(false)}
        isLight={isLight}
      />

      {/* Search panel */}
      <SearchPanel
        open={searchOpen}
        onClose={() => setSearchOpen(false)}
        isLight={isLight}
      />

      {/* Drawing picker */}
      <DrawingPicker open={drawingPickerOpen} onClose={() => setDrawingPickerOpen(false)} />

      {/* Markup overlay */}
      <MarkupCanvas
        active={markupActive}
        tool={markupTool}
        color={markupColor}
        width={markupWidth}
        strokes={markupStrokes}
        onStrokesChange={setMarkupStrokes}
      />

      {/* Markup toolbar */}
      {markupActive && (
        <MarkupToolbar
          activeTool={markupTool}
          color={markupColor}
          width={markupWidth}
          onToolChange={setMarkupTool}
          onColorChange={setMarkupColor}
          onWidthChange={setMarkupWidth}
          onUndo={handleMarkupUndo}
          onClear={handleMarkupClear}
          onClose={handleMarkupToggle}
          isLight={isLight}
        />
      )}

      {/* Measure overlay */}
      {measureActive && (
        <MeasureTool
          pointA={measureA}
          pointB={measureB}
          areaMode={measureAreaMode}
          areaPoints={measureAreaPoints}
          onToggleMode={handleMeasureModeToggle}
          isLight={isLight}
        />
      )}

      {/* Radial menu */}
      {radialMenu && (
        <RadialMenu
          screenX={radialMenu.x}
          screenY={radialMenu.y}
          onClose={() => setRadialMenu(null)}
          onSearch={handleSearchToggle}
          onThemeCycle={handleThemeCycle}
        />
      )}

      {/* Error toast */}
      {error && (
        <div
          className={`fixed left-1/2 -translate-x-1/2 px-4 py-3 bg-red-900/90 text-red-100 text-sm rounded-lg shadow-lg backdrop-blur-sm max-w-[80vw] text-center`}
          style={{
            zIndex: 70,
            top: 'calc(16px + env(safe-area-inset-top, 0px))',
          }}
          onClick={(e) => {
            e.stopPropagation();
            setError(null);
          }}
        >
          {error}
        </div>
      )}
    </div>
  );
}
