/**
 * DrawingRenderer - Orchestrates rendering for drawing mode
 */

import type { Shape, Viewport, SnapPoint, DrawingBoundary } from '../types';
import type { DrawingPreview, SelectionBox, TrackingLine, Point } from '../types';
import type { ParametricShape } from '../../../types/parametric';
import type { CustomHatchPattern, MaterialHatchSettings } from '../../../types/hatch';
import type { WallType, WallSystemType } from '../../../types/geometry';
import { BaseRenderer } from '../core/BaseRenderer';
import { ShapeRenderer } from '../core/ShapeRenderer';
import { ParametricRenderer } from '../core/ParametricRenderer';
import { GridLayer } from '../layers/GridLayer';
import { SnapLayer } from '../layers/SnapLayer';
import { TrackingLayer } from '../layers/TrackingLayer';
import { SelectionLayer } from '../layers/SelectionLayer';
import { CursorLayer } from '../layers/CursorLayer';
import { HandleRenderer } from '../ui/HandleRenderer';
import { COLORS } from '../types';
import { generateProfileGeometry } from '../../../services/parametric/geometryGenerators';
import { isShapeInHiddenCategory } from '../../../utils/ifcCategoryUtils';
import type { UnitSettings } from '../../../units/types';
import { QuadTree } from '../../spatial/QuadTree';
import { getShapeBounds } from '../../geometry/GeometryUtils';
import { getRenderPriority } from '../RenderSorter';

export interface DrawingRenderOptions {
  shapes: Shape[];
  parametricShapes?: ParametricShape[];
  selectedShapeIds: string[];
  hoveredShapeId?: string | null;
  preSelectedShapeIds?: string[];
  viewport: Viewport;
  drawingScale?: number;
  gridVisible: boolean;
  axesVisible?: boolean;
  gridSize: number;
  drawingPreview?: DrawingPreview;
  currentStyle?: { strokeColor: string; strokeWidth: number };
  selectionBox?: SelectionBox | null;
  currentSnapPoint?: SnapPoint | null;
  currentTrackingLines?: TrackingLine[];
  trackingPoint?: Point | null;
  drawingBoundary?: DrawingBoundary | null;
  boundarySelected?: boolean;
  boundaryDragging?: boolean;
  whiteBackground?: boolean;
  transparentBackground?: boolean;
  hideSelectionHandles?: boolean;
  sectionPlacementPreview?: Point | null;
  pendingSection?: {
    profileType: import('../../../types/parametric').ProfileType;
    parameters: import('../../../types/parametric').ParameterValues;
    presetId?: string;
    rotation: number;
  } | null;
  /** Custom hatch patterns (user + project) for rendering */
  customPatterns?: {
    userPatterns: CustomHatchPattern[];
    projectPatterns: CustomHatchPattern[];
  };
  /** Live preview: temporarily apply this pattern to selected hatches on hover */
  previewPatternId?: string | null;
  /** 2D cursor position in world coordinates */
  cursor2D?: Point | null;
  /** Whether 2D cursor is visible */
  cursor2DVisible?: boolean;
  /** Whether to display actual line weights (false = all lines 1px thin) */
  showLineweight?: boolean;
  /** Wall types for material-based hatch lookup */
  wallTypes?: WallType[];
  /** Wall system types (multi-layered assemblies) */
  wallSystemTypes?: WallSystemType[];
  /** Currently selected wall sub-element */
  selectedWallSubElement?: { wallId: string; type: 'stud' | 'panel'; key: string } | null;
  /** Material hatch settings from Drawing Standards */
  materialHatchSettings?: MaterialHatchSettings;
  /** Whether slab surface (hatch) patterns are enabled */
  slabSurfacePatternEnabled?: boolean;
  /** How slab openings are rendered */
  openingDisplayStyle?: 'cross' | 'diagonal' | 'outline';
  /** Gridline extension distance in mm on paper (scale-relative) */
  gridlineExtension?: number;
  /** Sea level datum: peil=0 elevation relative to NAP in meters */
  seaLevelDatum?: number;
  /** Hidden IFC categories — shapes in these categories are not rendered */
  hiddenIfcCategories?: string[];
  /** Unit settings for number formatting in overlays and labels */
  unitSettings?: UnitSettings;
  /** Slab edit mode: inner contour points being drawn */
  slabInnerContourPoints?: Point[];
  /** Slab edit mode: the slab being edited (for rendering existing inner contours) */
  editingSlabId?: string | null;
  /** Whether slab edit mode is active */
  slabEditMode?: boolean;
}

// Legacy alias
export type DraftRenderOptions = DrawingRenderOptions;

/** Time budget per frame for background shape rendering (ms). Leaves headroom for UI work. */
const SHAPE_RENDER_BUDGET_MS = 12;

export class DrawingRenderer extends BaseRenderer {
  private shapeRenderer: ShapeRenderer;
  private parametricRenderer: ParametricRenderer;
  private gridLayer: GridLayer;
  private snapLayer: SnapLayer;
  private trackingLayer: TrackingLayer;
  private selectionLayer: SelectionLayer;
  private cursorLayer: CursorLayer;
  private handleRenderer: HandleRenderer;

  // Progressive rendering state
  private progressiveIndex = 0;
  private lastShapeHash = '';
  private _hasMoreToRender = false;
  private _renderedCount = 0;
  private _totalVisible = 0;

  // ── QuadTree / bounds cache ───────────────────────────────────────────────
  // Building a QuadTree from 2000 shapes takes ~2-3 ms per frame.  Cache it
  // and only rebuild when the shapes array reference changes (i.e. a shape was
  // added / removed / modified by the store).  Progressive frames that only
  // advance the render index reuse the cached tree without any rebuild cost.
  private _cachedTree: QuadTree | null = null;
  private _cachedBoundsMap: Map<string, { minX: number; minY: number; maxX: number; maxY: number }> = new Map();
  private _cachedShapeById: Map<string, Shape> = new Map();
  private _cachedShapesRef: Shape[] | null = null;
  private _cachedDrawingScale: number | undefined = undefined;
  // ─────────────────────────────────────────────────────────────────────────

  constructor(ctx: CanvasRenderingContext2D, width: number, height: number, dpr: number) {
    super(ctx, width, height, dpr);
    this.shapeRenderer = new ShapeRenderer(ctx, width, height, dpr);
    this.parametricRenderer = new ParametricRenderer(ctx, width, height, dpr);
    this.gridLayer = new GridLayer(ctx, width, height, dpr);
    this.snapLayer = new SnapLayer(ctx, width, height, dpr);
    this.trackingLayer = new TrackingLayer(ctx, width, height, dpr);
    this.selectionLayer = new SelectionLayer(ctx, width, height, dpr);
    this.cursorLayer = new CursorLayer(ctx, width, height, dpr);
    this.handleRenderer = new HandleRenderer(ctx, width, height, dpr);
  }

  /**
   * Update dimensions when canvas resizes
   */
  updateSize(width: number, height: number): void {
    this.width = width;
    this.height = height;
    this.shapeRenderer = new ShapeRenderer(this.ctx, width, height, this.dpr);
    this.parametricRenderer = new ParametricRenderer(this.ctx, width, height, this.dpr);
    this.gridLayer = new GridLayer(this.ctx, width, height, this.dpr);
    this.snapLayer = new SnapLayer(this.ctx, width, height, this.dpr);
    this.trackingLayer = new TrackingLayer(this.ctx, width, height, this.dpr);
    this.selectionLayer = new SelectionLayer(this.ctx, width, height, this.dpr);
    this.cursorLayer = new CursorLayer(this.ctx, width, height, this.dpr);
    this.handleRenderer = new HandleRenderer(this.ctx, width, height, this.dpr);
  }

  /**
   * Returns true when progressive rendering has more shapes to draw next frame.
   * Canvas RAF loop uses this to decide whether to keep requesting frames.
   */
  hasMoreToRender(): boolean {
    return this._hasMoreToRender;
  }

  /**
   * Returns current progressive rendering progress { rendered, total }.
   * Used by the status-bar indicator in Canvas.tsx.
   */
  getProgressiveStats(): { rendered: number; total: number } {
    return { rendered: this._renderedCount, total: this._totalVisible };
  }

  /**
   * Force reset of the progressive index (e.g. on viewport change or shape mutation).
   * Does NOT clear the QuadTree cache — that is keyed on the shapes array reference
   * and is still valid even when the viewport changes.
   */
  resetProgressive(): void {
    this.progressiveIndex = 0;
    this.lastShapeHash = '';
  }

  /**
   * Render the drawing view
   */
  render(options: DrawingRenderOptions): void {
    const {
      shapes,
      selectedShapeIds,
      viewport,
      drawingScale,
      gridVisible,
      axesVisible = true,
      gridSize,
      drawingPreview,
      currentStyle,
      selectionBox,
      currentSnapPoint,
      currentTrackingLines,
      trackingPoint,
      drawingBoundary,
      boundarySelected,
      boundaryDragging,
      hoveredShapeId,
      preSelectedShapeIds,
      whiteBackground,
      hideSelectionHandles,
      customPatterns,
    } = options;

    const preSelectedSet = preSelectedShapeIds ? new Set(preSelectedShapeIds) : null;

    // Set drawing scale for annotation text scaling
    if (drawingScale !== undefined) {
      this.shapeRenderer.setDrawingScale(drawingScale);
    }

    const ctx = this.ctx;

    // Set custom patterns for hatch rendering
    if (customPatterns) {
      this.shapeRenderer.setCustomPatterns(customPatterns.userPatterns, customPatterns.projectPatterns);
    }

    // Set wall types for material-based hatch lookup
    if (options.wallTypes) {
      this.shapeRenderer.setWallTypes(options.wallTypes);
    }

    // Set wall system types for multi-layered wall rendering
    if (options.wallSystemTypes) {
      this.shapeRenderer.setWallSystemTypes(options.wallSystemTypes);
    }

    // Set selected wall sub-element for highlight rendering
    this.shapeRenderer.setSelectedWallSubElement(options.selectedWallSubElement || null);

    // Set material hatch settings from Drawing Standards
    if (options.materialHatchSettings) {
      this.shapeRenderer.setMaterialHatchSettings(options.materialHatchSettings);
    }

    // Set slab surface pattern enabled flag
    this.shapeRenderer.setSlabSurfacePatternEnabled(options.slabSurfacePatternEnabled !== false);

    // Set slab opening display style
    this.shapeRenderer.setOpeningDisplayStyle(options.openingDisplayStyle || 'cross');

    // Set gridline extension distance
    if (options.gridlineExtension !== undefined) {
      this.shapeRenderer.setGridlineExtension(options.gridlineExtension);
    }

    // Set sea level datum for NAP elevation display on levels
    if (options.seaLevelDatum !== undefined) {
      this.shapeRenderer.setSeaLevelDatum(options.seaLevelDatum);
    }

    // Set unit settings for number formatting
    if (options.unitSettings) {
      this.shapeRenderer.setUnitSettings(options.unitSettings);
    }

    // Set shapes lookup for linked label text resolution
    this.shapeRenderer.setShapesLookup(shapes);

    // Set live preview pattern
    this.shapeRenderer.setPreviewPattern(options.previewPatternId || null, selectedShapeIds);

    // Set lineweight display mode, current zoom, and transparent-background flag
    this.shapeRenderer.setShowLineweight(options.showLineweight !== false);
    this.shapeRenderer.setZoom(viewport.zoom);
    this.shapeRenderer.setTransparentBackground(!!options.transparentBackground);
    this.parametricRenderer.setShowLineweight(options.showLineweight !== false);

    // Clear canvas
    ctx.save();
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    if (options.transparentBackground) {
      ctx.clearRect(0, 0, this.width, this.height);
    } else {
      ctx.fillStyle = whiteBackground ? '#ffffff' : COLORS.canvasBackground;
      ctx.fillRect(0, 0, this.width, this.height);
    }

    // Apply viewport transform
    this.applyViewportTransform(viewport);

    // Draw grid and axes
    if (gridVisible) {
      this.gridLayer.drawGrid(viewport, gridSize, whiteBackground);
    } else if (axesVisible) {
      this.gridLayer.drawAxes(viewport);
    }

    // Always draw origin marker (small cross at 0,0)
    this.gridLayer.drawOriginMarker(viewport);

    // Draw drawing boundary (region)
    if (drawingBoundary) {
      this.handleRenderer.drawDrawingBoundary(
        drawingBoundary,
        viewport,
        boundarySelected || false,
        boundaryDragging || false
      );
    }

    // Build Set for O(1) selection lookups (avoids O(n²) with .includes() in loop)
    const selectedSet = new Set(selectedShapeIds);

    // Pass selected IDs to shape renderer for associative dimension highlighting
    this.shapeRenderer.setSelectedShapeIds(selectedSet);

    // IFC category filter
    const hiddenCats = options.hiddenIfcCategories || [];

    // ─── Step 1: Viewport culling via QuadTree ────────────────────────────────
    // Calculate visible world bounds with 15% margin on each side so shapes at
    // the edge don't pop in/out during small pans or rotations.
    const visibleArea = this.getVisibleArea(viewport);
    const marginX = (visibleArea.right - visibleArea.left) * 0.15;
    const marginY = (visibleArea.bottom - visibleArea.top) * 0.15;
    const cullBounds = {
      minX: visibleArea.left - marginX,
      minY: visibleArea.top - marginY,
      maxX: visibleArea.right + marginX,
      maxY: visibleArea.bottom + marginY,
    };

    // ── Cached QuadTree ───────────────────────────────────────────────────────
    // Only rebuild when the shapes array reference has changed (new/deleted/modified
    // shapes) or when the drawing scale changes (affects bounds calculations).
    // Progressive frames that merely advance the render index reuse the cached
    // tree at zero cost — the biggest win for 2000+ shape datasets.
    const scaleChanged = options.drawingScale !== this._cachedDrawingScale;
    const shapesChanged = shapes !== this._cachedShapesRef;

    if (shapesChanged || scaleChanged) {
      const boundsMap = new Map<string, { minX: number; minY: number; maxX: number; maxY: number }>();
      const shapeById = new Map<string, Shape>();
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      const entries: { id: string; bounds: { minX: number; minY: number; maxX: number; maxY: number } }[] = [];

      for (const shape of shapes) {
        if (!shape.visible) continue;
        shapeById.set(shape.id, shape);
        const b = getShapeBounds(shape, options.drawingScale);
        if (!b) {
          boundsMap.set(shape.id, { minX: -Infinity, minY: -Infinity, maxX: Infinity, maxY: Infinity });
          continue;
        }
        boundsMap.set(shape.id, b);
        entries.push({ id: shape.id, bounds: b });
        if (b.minX < minX) minX = b.minX;
        if (b.minY < minY) minY = b.minY;
        if (b.maxX > maxX) maxX = b.maxX;
        if (b.maxY > maxY) maxY = b.maxY;
      }

      const cx = isFinite(minX) ? (minX + maxX) / 2 : 0;
      const cy = isFinite(minY) ? (minY + maxY) / 2 : 0;
      const hw = isFinite(minX) ? (maxX - minX) / 2 + 100 : 1e6;
      const hh = isFinite(minY) ? (maxY - minY) / 2 + 100 : 1e6;
      const tree = new QuadTree({ x: cx, y: cy, halfW: hw, halfH: hh });
      for (const entry of entries) {
        tree.insert(entry);
      }

      this._cachedTree = tree;
      this._cachedBoundsMap = boundsMap;
      this._cachedShapeById = shapeById;
      this._cachedShapesRef = shapes;
      this._cachedDrawingScale = options.drawingScale;
    }

    const boundsMap = this._cachedBoundsMap;
    const shapeById = this._cachedShapeById;
    const tree = this._cachedTree!;

    {

      // ─── Step 1: Viewport culling — query QuadTree ────────────────────────────
      const inView = tree.queryBounds(cullBounds);

      // Build visible ID set; shapes with unbounded extents are always visible
      const visibleIds = new Set<string>();
      for (const entry of inView) visibleIds.add(entry.id);
      for (const [id, b] of boundsMap) {
        if (!isFinite(b.maxX)) visibleIds.add(id);
      }

      // ─── Step 2: LOD culling — skip sub-pixel shapes ─────────────────────────
      // After viewport culling, skip any shape whose screen footprint is < 2px.
      // Text gets a slightly more lenient threshold (3px on the text height axis).
      const zoom = viewport.zoom;
      const LOD_MIN_PX = 2;
      const LOD_TEXT_MIN_PX = 3;

      const lodPassIds = new Set<string>();
      for (const id of visibleIds) {
        const b = boundsMap.get(id);
        if (!b) { lodPassIds.add(id); continue; }
        if (!isFinite(b.maxX)) { lodPassIds.add(id); continue; }
        const screenW = (b.maxX - b.minX) * zoom;
        const screenH = (b.maxY - b.minY) * zoom;
        const shape = shapeById.get(id);
        if (!shape) continue;
        if (shape.type === 'text') {
          // For text, cull on the height axis only
          if (screenH < LOD_TEXT_MIN_PX) continue;
        } else {
          if (Math.max(screenW, screenH) < LOD_MIN_PX) continue;
        }
        lodPassIds.add(id);
      }

      // ─── Step 3: Collect and sort visible shapes ──────────────────────────────
      const visibleShapes: Shape[] = [];
      for (const shape of shapes) {
        if (shape.visible && lodPassIds.has(shape.id)) visibleShapes.push(shape);
      }

      // Stable sort: V8's Array.sort is stable since Node 11 / Chrome 70
      visibleShapes.sort((a, b) => getRenderPriority(a) - getRenderPriority(b));

      // ─── Step 4: Priority shapes — always rendered this frame ─────────────────
      // Selected, hovered, and pre-selected shapes are "priority" and drawn every
      // frame regardless of time budget so interaction always feels instant.
      const backgroundShapes: Shape[] = [];
      for (const shape of visibleShapes) {
        if (isShapeInHiddenCategory(shape, hiddenCats)) continue;
        const isSelected = selectedSet.has(shape.id);
        const isHovered = hoveredShapeId === shape.id || (preSelectedSet !== null && preSelectedSet.has(shape.id));
        if (isSelected || isHovered) {
          this.shapeRenderer.drawShape(shape, isSelected, isHovered, whiteBackground, hideSelectionHandles);
        } else {
          backgroundShapes.push(shape);
        }
      }

      // ─── Step 5: Background shapes — progressive, time-budgeted ───────────────
      // Detect shape-set change: reset progressive index so we start from the
      // beginning whenever shapes are added / removed / the drawing changes.
      const shapeHash = backgroundShapes.length + '_' + (backgroundShapes[0]?.id ?? '');
      if (shapeHash !== this.lastShapeHash) {
        this.progressiveIndex = 0;
        this.lastShapeHash = shapeHash;
      }

      this._totalVisible = backgroundShapes.length;

      let bgIdx = this.progressiveIndex;
      const frameStart = performance.now();
      while (bgIdx < backgroundShapes.length) {
        // Check time budget every 8 shapes to amortise performance.now() cost
        if ((bgIdx & 7) === 0) {
          const elapsed = performance.now() - frameStart;
          if (elapsed > SHAPE_RENDER_BUDGET_MS) break;
        }
        const shape = backgroundShapes[bgIdx];
        this.shapeRenderer.drawShape(shape, false, false, whiteBackground, hideSelectionHandles);
        bgIdx++;
      }
      this.progressiveIndex = bgIdx;
      this._renderedCount = bgIdx;
      this._hasMoreToRender = bgIdx < backgroundShapes.length;
    }

    // Draw parametric shapes
    const parametricShapes = options.parametricShapes;
    if (parametricShapes) {
      for (const shape of parametricShapes) {
        if (!shape.visible) continue;
        const isSelected = selectedSet.has(shape.id);
        const isHovered = hoveredShapeId === shape.id || (preSelectedSet !== null && preSelectedSet.has(shape.id));
        this.parametricRenderer.drawParametricShape(shape, isSelected, isHovered, whiteBackground);
      }
    }

    // Draw preview shape while drawing
    if (drawingPreview) {
      this.shapeRenderer.drawPreview(drawingPreview, currentStyle, viewport, whiteBackground);
    }

    // Draw tracking lines
    if (currentTrackingLines && currentTrackingLines.length > 0) {
      this.trackingLayer.drawTrackingLines(currentTrackingLines, trackingPoint, viewport);
    }

    // Draw snap point indicator (skip grid snaps - they're not useful to show)
    if (currentSnapPoint && currentSnapPoint.type !== 'grid') {
      // Draw alignment guide line before the snap marker (so marker appears on top)
      this.snapLayer.drawAlignmentGuide(currentSnapPoint, viewport);
      this.snapLayer.drawSnapIndicator(currentSnapPoint, viewport);
    }

    // Draw 2D cursor
    if (options.cursor2DVisible && options.cursor2D) {
      this.cursorLayer.drawCursor(options.cursor2D, viewport, whiteBackground, options.unitSettings);
    }

    // Draw section placement preview (pending section following mouse)
    const { sectionPlacementPreview, pendingSection } = options;
    if (sectionPlacementPreview && pendingSection) {
      this.drawSectionPlacementPreview(
        sectionPlacementPreview,
        pendingSection,
        whiteBackground
      );
    }

    // Draw slab edit mode overlay: existing inner contours + in-progress contour
    if (options.slabEditMode && options.editingSlabId) {
      const editingSlab = shapes.find(s => s.id === options.editingSlabId) as any;

      // Draw existing inner contours with orange dashed outlines
      if (editingSlab?.innerContours) {
        ctx.save();
        for (const contour of editingSlab.innerContours) {
          if (contour.length < 3) continue;
          ctx.beginPath();
          ctx.moveTo(contour[0].x, contour[0].y);
          for (let ci = 1; ci < contour.length; ci++) {
            ctx.lineTo(contour[ci].x, contour[ci].y);
          }
          ctx.closePath();
          ctx.strokeStyle = '#ff6600';
          ctx.lineWidth = 2 / viewport.zoom;
          ctx.setLineDash([8 / viewport.zoom, 4 / viewport.zoom]);
          ctx.stroke();
          ctx.setLineDash([]);
          // Vertex dots
          for (const cp of contour) {
            ctx.beginPath();
            ctx.arc(cp.x, cp.y, 4 / viewport.zoom, 0, Math.PI * 2);
            ctx.fillStyle = '#ff6600';
            ctx.fill();
          }
        }
        ctx.restore();
      }

      // Draw the in-progress contour points
      const contourPts = options.slabInnerContourPoints;
      if (contourPts && contourPts.length > 0) {
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(contourPts[0].x, contourPts[0].y);
        for (let ci = 1; ci < contourPts.length; ci++) {
          ctx.lineTo(contourPts[ci].x, contourPts[ci].y);
        }
        ctx.strokeStyle = '#00ccff';
        ctx.lineWidth = 2 / viewport.zoom;
        ctx.setLineDash([6 / viewport.zoom, 4 / viewport.zoom]);
        ctx.stroke();
        ctx.setLineDash([]);
        // Vertex dots
        for (const cp of contourPts) {
          ctx.beginPath();
          ctx.arc(cp.x, cp.y, 4 / viewport.zoom, 0, Math.PI * 2);
          ctx.fillStyle = '#00ccff';
          ctx.fill();
        }
        ctx.restore();
      }
    }

    ctx.restore();

    // Draw selection box (in screen coordinates, after viewport transform is restored)
    if (selectionBox) {
      this.selectionLayer.drawSelectionBox(selectionBox);
    }

    // Draw snap point label (in screen coordinates, skip grid snaps)
    if (currentSnapPoint && currentSnapPoint.type !== 'grid') {
      this.snapLayer.drawSnapLabel(currentSnapPoint, viewport);
    }

    // Draw tracking label (in screen coordinates)
    // Skip if snap label already shows the same type (avoid duplicate perpendicular/parallel labels)
    if (currentTrackingLines && currentTrackingLines.length > 0 && trackingPoint) {
      const trackingType = currentTrackingLines[0].type;
      const snapType = currentSnapPoint?.type;
      const isDuplicateLabel = (trackingType === 'perpendicular' && snapType === 'perpendicular') ||
                               (trackingType === 'parallel' && snapType === 'parallel');
      if (!isDuplicateLabel) {
        this.trackingLayer.drawTrackingLabel(currentTrackingLines, trackingPoint, viewport, options.unitSettings);
      }
    }
  }

  /**
   * Get boundary handle positions (delegates to HandleRenderer)
   */
  getBoundaryHandlePositions(boundary: DrawingBoundary) {
    return this.handleRenderer.getBoundaryHandlePositions(boundary);
  }

  /**
   * Draw section placement preview (ghost shape following mouse)
   */
  private drawSectionPlacementPreview(
    position: Point,
    pendingSection: NonNullable<DrawingRenderOptions['pendingSection']>,
    whiteBackground?: boolean
  ): void {
    const ctx = this.ctx;

    try {
      const geometry = generateProfileGeometry(
        pendingSection.profileType,
        pendingSection.parameters,
        position,
        pendingSection.rotation,
        1
      );

      if (geometry.outlines.length === 0) return;

      ctx.save();

      // Semi-transparent preview style
      ctx.globalAlpha = 0.6;
      ctx.strokeStyle = whiteBackground ? '#0066cc' : '#00d4ff';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([6, 3]);

      // Draw outlines
      for (let i = 0; i < geometry.outlines.length; i++) {
        const outline = geometry.outlines[i];
        const closed = geometry.closed[i];

        if (outline.length < 2) continue;

        ctx.beginPath();
        ctx.moveTo(outline[0].x, outline[0].y);

        for (let j = 1; j < outline.length; j++) {
          ctx.lineTo(outline[j].x, outline[j].y);
        }

        if (closed) {
          ctx.closePath();
          // Light fill for outer outline
          if (i === 0) {
            ctx.fillStyle = whiteBackground ? 'rgba(0, 102, 204, 0.1)' : 'rgba(0, 212, 255, 0.1)';
            ctx.fill();
          }
        }

        ctx.stroke();
      }

      // Draw insertion point crosshair
      ctx.setLineDash([]);
      ctx.strokeStyle = '#00ff00';
      ctx.lineWidth = 1;
      ctx.globalAlpha = 0.8;
      const crossSize = 10;
      ctx.beginPath();
      ctx.moveTo(position.x - crossSize, position.y);
      ctx.lineTo(position.x + crossSize, position.y);
      ctx.moveTo(position.x, position.y - crossSize);
      ctx.lineTo(position.x, position.y + crossSize);
      ctx.stroke();

      ctx.restore();
    } catch {
      // Silently ignore preview errors
    }
  }
}

// Legacy alias
export { DrawingRenderer as DraftRenderer };
