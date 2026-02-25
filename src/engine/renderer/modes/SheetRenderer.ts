/**
 * SheetRenderer - Orchestrates rendering for sheet layout mode
 *
 * Supports:
 * - Viewport crop regions
 * - Per-viewport layer overrides
 */

import type { Shape, Sheet, Drawing, Viewport, SheetViewport, Layer } from '../types';
import type { WallType, WallSystemType, SheetQueryTable } from '../../../types/geometry';
import type { ParametricShape } from '../../../types/parametric';
import type { CustomHatchPattern, MaterialHatchSettings } from '../../../types/hatch';
import type { SavedQuery } from '../../../state/slices/parametricSlice';
import type { UnitSettings } from '../../../units/types';
import { executeQuery } from '../../../services/query/queryEngine';
import { BaseRenderer } from '../core/BaseRenderer';
import { ViewportRenderer } from '../sheet/ViewportRenderer';
import { TitleBlockRenderer } from '../sheet/TitleBlockRenderer';
import { AnnotationRenderer } from '../sheet/AnnotationRenderer';
import { HandleRenderer, ViewportHandleType } from '../ui/HandleRenderer';
import { PAPER_SIZES, MM_TO_PIXELS, COLORS } from '../types';
import { loadCustomSVGTemplates } from '../../../services/export/svgTitleBlockService';
import { CAD_DEFAULT_FONT } from '../../../constants/cadDefaults';

/** Point type for placement preview */
interface Point {
  x: number;
  y: number;
}

/** Drawing/query placement preview info */
export interface PlacementPreviewInfo {
  /** Whether placement mode is active */
  isPlacing: boolean;
  /** ID of drawing being placed */
  placingDrawingId: string | null;
  /** ID of query being placed as table */
  placingQueryId: string | null;
  /** Preview position on sheet (in mm) */
  previewPosition: Point | null;
  /** Scale for the new viewport */
  placementScale: number;
}

export interface SheetRenderOptions {
  sheet: Sheet;
  drawings: Drawing[];
  shapes: Shape[]; // All shapes from all drawings
  parametricShapes?: ParametricShape[]; // All parametric shapes from all drawings
  layers: Layer[]; // All layers for filtering
  viewport: Viewport; // Pan/zoom for the sheet view
  selectedViewportId?: string | null;
  viewportDragging?: boolean;
  drawingViewports: Record<string, Viewport>;
  /** Whether crop region editing mode is active */
  cropRegionEditing?: boolean;
  /** ID of viewport being edited for crop region */
  cropRegionViewportId?: string | null;
  /** IDs of selected annotations */
  selectedAnnotationIds?: string[];
  /** Drawing placement preview info */
  placementPreview?: PlacementPreviewInfo;
  /** Custom hatch patterns for rendering */
  customPatterns?: {
    userPatterns: CustomHatchPattern[];
    projectPatterns: CustomHatchPattern[];
  };
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
  /** Gridline extension distance in mm */
  gridlineExtension?: number;
  /** Sea level datum: peil=0 elevation relative to NAP in meters */
  seaLevelDatum?: number;
  /** Hidden IFC categories — shapes in these categories are not rendered */
  hiddenIfcCategories?: string[];
  /** Saved queries for rendering query tables and placement preview */
  queries?: SavedQuery[];
  /** Unit settings for number formatting in overlays and labels */
  unitSettings?: UnitSettings;
  /** ID of the title block field currently being edited (to hide canvas text) */
  editingFieldId?: string | null;
}

export class SheetRenderer extends BaseRenderer {
  private viewportRenderer: ViewportRenderer;
  private titleBlockRenderer: TitleBlockRenderer;
  private annotationRenderer: AnnotationRenderer;
  private handleRenderer: HandleRenderer;

  constructor(ctx: CanvasRenderingContext2D, width: number, height: number, dpr: number) {
    super(ctx, width, height, dpr);
    this.viewportRenderer = new ViewportRenderer(ctx, width, height, dpr);
    this.titleBlockRenderer = new TitleBlockRenderer(ctx, width, height, dpr);
    this.annotationRenderer = new AnnotationRenderer(ctx, width, height, dpr);
    this.handleRenderer = new HandleRenderer(ctx, width, height, dpr);
  }

  /**
   * Update dimensions when canvas resizes
   */
  updateSize(width: number, height: number): void {
    this.width = width;
    this.height = height;
    const oldCallback = (this.titleBlockRenderer as any).onImageLoadCallback;
    this.viewportRenderer = new ViewportRenderer(this.ctx, width, height, this.dpr);
    this.titleBlockRenderer = new TitleBlockRenderer(this.ctx, width, height, this.dpr);
    this.annotationRenderer = new AnnotationRenderer(this.ctx, width, height, this.dpr);
    this.handleRenderer = new HandleRenderer(this.ctx, width, height, this.dpr);
    // Preserve callback after recreation
    if (oldCallback) {
      this.titleBlockRenderer.setOnImageLoadCallback(oldCallback);
    }
  }

  /**
   * Set callback to be invoked when title block images finish loading
   * This allows the canvas to trigger a re-render after async loads
   */
  setOnImageLoadCallback(callback: (() => void) | null): void {
    this.titleBlockRenderer.setOnImageLoadCallback(callback);
  }

  /**
   * Render a sheet layout with viewports showing drawings
   */
  render(options: SheetRenderOptions): void {
    const {
      sheet,
      drawings,
      shapes,
      parametricShapes,
      layers,
      viewport,
      selectedViewportId,
      drawingViewports,
      cropRegionEditing,
      cropRegionViewportId,
      selectedAnnotationIds = [],
      placementPreview,
      customPatterns,
      editingFieldId,
    } = options;
    const ctx = this.ctx;

    // Clear canvas with dark background
    ctx.save();
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = COLORS.sheetBackground;
    ctx.fillRect(0, 0, this.width, this.height);

    // Apply viewport transform for sheet pan/zoom
    ctx.translate(viewport.offsetX, viewport.offsetY);
    ctx.scale(viewport.zoom, viewport.zoom);

    // Get paper dimensions
    const paperDims = this.getPaperDimensions(sheet);
    const paperWidth = paperDims.width * MM_TO_PIXELS;
    const paperHeight = paperDims.height * MM_TO_PIXELS;

    // Check if title block uses a full-page SVG template
    const svgTemplateId = (sheet.titleBlock as { svgTemplateId?: string }).svgTemplateId;
    let isFullPageTemplate = false;
    if (svgTemplateId) {
      const svgTemplates = loadCustomSVGTemplates();
      const svgTemplate = svgTemplates.find(t => t.id === svgTemplateId);
      if (svgTemplate?.isFullPage) {
        isFullPageTemplate = true;
      }
    }

    // Draw paper shadow
    ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
    ctx.fillRect(8, 8, paperWidth, paperHeight);

    // Always draw white paper background first
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, paperWidth, paperHeight);

    if (isFullPageTemplate) {
      // For full-page templates, draw the SVG template on top of white background
      this.titleBlockRenderer.drawTitleBlock(sheet.titleBlock, paperWidth, paperHeight, undefined, editingFieldId);
    } else {
      // Draw thin paper edge
      ctx.strokeStyle = '#cccccc';
      ctx.lineWidth = 0.5 / viewport.zoom;
      ctx.strokeRect(0, 0, paperWidth, paperHeight);

      // Draw professional drawing frame (thick inner border with uniform margins)
      const marginLeft = 10 * MM_TO_PIXELS;
      const marginRight = 10 * MM_TO_PIXELS;
      const marginTop = 10 * MM_TO_PIXELS;
      const marginBottom = 10 * MM_TO_PIXELS;
      const frameX = marginLeft;
      const frameY = marginTop;
      const frameW = paperWidth - marginLeft - marginRight;
      const frameH = paperHeight - marginTop - marginBottom;

      ctx.strokeStyle = '#000000';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(frameX, frameY, frameW, frameH);
    }

    // Draw viewports
    const visibleViewports = sheet.viewports.filter(v => v.visible);
    for (const vp of visibleViewports) {
      const isSelected = selectedViewportId === vp.id;
      const isCropRegionEditing = cropRegionEditing && cropRegionViewportId === vp.id;

      this.viewportRenderer.drawSheetViewport(
        vp,
        drawings,
        shapes,
        drawingViewports,
        isSelected,
        {
          layers,
          parametricShapes,
          isCropRegionEditing,
          sheetZoom: viewport.zoom,
          customPatterns,
          totalViewportsOnSheet: visibleViewports.length,
          showLineweight: options.showLineweight,
          wallTypes: options.wallTypes,
          wallSystemTypes: options.wallSystemTypes,
          materialHatchSettings: options.materialHatchSettings,
          gridlineExtension: options.gridlineExtension,
          seaLevelDatum: options.seaLevelDatum,
          hiddenIfcCategories: options.hiddenIfcCategories,
          unitSettings: options.unitSettings,
        }
      );
    }

    // Draw alignment guides during viewport drag
    if (options.viewportDragging && selectedViewportId) {
      this.drawAlignmentGuides(sheet, selectedViewportId, viewport.zoom);
    }

    // Draw query tables
    const queryTables = sheet.queryTables || [];
    const visibleQueryTables = queryTables.filter(t => t.visible);
    if (visibleQueryTables.length > 0) {
      this.drawQueryTables(visibleQueryTables, options.queries || [], options.shapes, options.drawings, viewport.zoom);
    }

    // Draw placement preview if active
    if (placementPreview?.isPlacing && placementPreview.previewPosition) {
      if (placementPreview.placingDrawingId) {
        this.drawPlacementPreview(placementPreview, drawings, viewport.zoom);
      } else if (placementPreview.placingQueryId) {
        this.drawQueryPlacementPreview(placementPreview, options.queries || [], viewport.zoom);
      }
    }

    // Draw sheet annotations (text, dimensions, leaders, etc.)
    if (sheet.annotations && sheet.annotations.length > 0) {
      this.annotationRenderer.renderAnnotations(sheet.annotations, {
        selectedIds: selectedAnnotationIds,
        showHandles: true,
        sheetZoom: viewport.zoom,
      });
    }

    // Draw title block (skip if full-page template - already drawn as background)
    if (sheet.titleBlock.visible && !isFullPageTemplate) {
      this.titleBlockRenderer.drawTitleBlock(sheet.titleBlock, paperWidth, paperHeight, undefined, editingFieldId);
    }

    ctx.restore();
  }

  /**
   * Draw alignment guide lines when dragging a viewport near other viewports' edges/centers
   */
  private drawAlignmentGuides(sheet: Sheet, draggingId: string, sheetZoom: number): void {
    const ctx = this.ctx;
    const visibleViewports = sheet.viewports.filter(v => v.visible);
    const dragging = visibleViewports.find(v => v.id === draggingId);
    if (!dragging) return;

    const threshold = 2; // mm
    const guideColor = '#4a90d9';
    const frameMargin = 10; // mm

    // Paper dimensions in mm
    const paperDims = this.getPaperDimensions(sheet);
    const paperW = paperDims.width;
    const paperH = paperDims.height;

    // Dragging viewport edges in mm
    const dTop = dragging.y;
    const dBottom = dragging.y + dragging.height;
    const dLeft = dragging.x;
    const dRight = dragging.x + dragging.width;
    const dCenterX = dragging.x + dragging.width / 2;
    const dCenterY = dragging.y + dragging.height / 2;

    ctx.save();
    ctx.strokeStyle = guideColor;
    ctx.lineWidth = 1 / sheetZoom;
    ctx.setLineDash([6 / sheetZoom, 4 / sheetZoom]);

    // Helper to draw a horizontal guide line across the full paper width
    const drawHGuide = (y: number) => {
      ctx.beginPath();
      ctx.moveTo(0, y * MM_TO_PIXELS);
      ctx.lineTo(paperW * MM_TO_PIXELS, y * MM_TO_PIXELS);
      ctx.stroke();
    };

    // Helper to draw a vertical guide line across the full paper height
    const drawVGuide = (x: number) => {
      ctx.beginPath();
      ctx.moveTo(x * MM_TO_PIXELS, 0);
      ctx.lineTo(x * MM_TO_PIXELS, paperH * MM_TO_PIXELS);
      ctx.stroke();
    };

    // --- Border snap guides (paper edges + frame edges) ---
    const borderXPositions = [0, frameMargin, paperW - frameMargin, paperW];
    const borderYPositions = [0, frameMargin, paperH - frameMargin, paperH];

    const dXEdges = [dLeft, dRight, dCenterX];
    const dYEdges = [dTop, dBottom, dCenterY];

    for (const dX of dXEdges) {
      for (const bx of borderXPositions) {
        if (Math.abs(dX - bx) <= threshold) {
          drawVGuide(bx);
        }
      }
    }

    for (const dY of dYEdges) {
      for (const by of borderYPositions) {
        if (Math.abs(dY - by) <= threshold) {
          drawHGuide(by);
        }
      }
    }

    // --- Viewport-to-viewport guides ---
    const others = visibleViewports.filter(v => v.id !== draggingId);

    for (const other of others) {
      const oTop = other.y;
      const oBottom = other.y + other.height;
      const oLeft = other.x;
      const oRight = other.x + other.width;
      const oCenterX = other.x + other.width / 2;
      const oCenterY = other.y + other.height / 2;

      // Horizontal guides (Y-axis alignment)
      const yChecks: [number, number][] = [
        [dTop, oTop], [dTop, oBottom], [dTop, oCenterY],
        [dBottom, oTop], [dBottom, oBottom], [dBottom, oCenterY],
        [dCenterY, oCenterY],
      ];

      for (const [dY, oY] of yChecks) {
        if (Math.abs(dY - oY) <= threshold) {
          const minX = Math.min(dLeft, oLeft);
          const maxX = Math.max(dRight, oRight);
          const y = oY * MM_TO_PIXELS;
          ctx.beginPath();
          ctx.moveTo(minX * MM_TO_PIXELS, y);
          ctx.lineTo(maxX * MM_TO_PIXELS, y);
          ctx.stroke();
        }
      }

      // Vertical guides (X-axis alignment)
      const xChecks: [number, number][] = [
        [dLeft, oLeft], [dLeft, oRight], [dLeft, oCenterX],
        [dRight, oLeft], [dRight, oRight], [dRight, oCenterX],
        [dCenterX, oCenterX],
      ];

      for (const [dX, oX] of xChecks) {
        if (Math.abs(dX - oX) <= threshold) {
          const minY = Math.min(dTop, oTop);
          const maxY = Math.max(dBottom, oBottom);
          const x = oX * MM_TO_PIXELS;
          ctx.beginPath();
          ctx.moveTo(x, minY * MM_TO_PIXELS);
          ctx.lineTo(x, maxY * MM_TO_PIXELS);
          ctx.stroke();
        }
      }
    }

    ctx.restore();
  }

  /**
   * Draw placement preview for drawing being dragged onto sheet
   */
  private drawPlacementPreview(
    preview: PlacementPreviewInfo,
    drawings: Drawing[],
    sheetZoom: number
  ): void {
    const ctx = this.ctx;
    const { placingDrawingId, previewPosition, placementScale } = preview;

    if (!previewPosition || !placingDrawingId) return;

    // Find the drawing being placed
    const drawing = drawings.find(d => d.id === placingDrawingId);
    if (!drawing) return;

    // Calculate viewport size from drawing boundary
    const boundary = drawing.boundary;
    const width = boundary.width * placementScale * MM_TO_PIXELS;
    const height = boundary.height * placementScale * MM_TO_PIXELS;

    // Calculate top-left position (preview is centered on cursor)
    const x = (previewPosition.x * MM_TO_PIXELS) - width / 2;
    const y = (previewPosition.y * MM_TO_PIXELS) - height / 2;

    // Draw semi-transparent preview rectangle
    ctx.save();

    // Fill with light blue
    ctx.fillStyle = 'rgba(59, 130, 246, 0.15)';
    ctx.fillRect(x, y, width, height);

    // Dashed border
    ctx.strokeStyle = COLORS.selection;
    ctx.lineWidth = 2 / sheetZoom;
    ctx.setLineDash([6 / sheetZoom, 4 / sheetZoom]);
    ctx.strokeRect(x, y, width, height);

    // Draw drawing name label
    ctx.setLineDash([]);
    const fontSize = 12 / sheetZoom;
    ctx.font = `${fontSize}px ${CAD_DEFAULT_FONT}`;
    ctx.fillStyle = COLORS.selection;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.fillText(drawing.name, x + width / 2, y - 4 / sheetZoom);

    // Draw scale label
    const scaleLabel = this.formatScale(placementScale);
    ctx.textBaseline = 'top';
    ctx.fillText(scaleLabel, x + width / 2, y + height + 4 / sheetZoom);

    ctx.restore();
  }

  /**
   * Format scale as human-readable string (e.g., "1:100")
   */
  private formatScale(scale: number): string {
    if (scale >= 1) {
      return `${scale}:1`;
    }
    const denom = Math.round(1 / scale);
    return `1:${denom}`;
  }

  /**
   * Get paper dimensions in mm, accounting for orientation
   */
  private getPaperDimensions(sheet: Sheet): { width: number; height: number } {
    if (sheet.paperSize === 'Custom') {
      return {
        width: sheet.customWidth || 210,
        height: sheet.customHeight || 297,
      };
    }

    const baseDims = PAPER_SIZES[sheet.paperSize];
    if (sheet.orientation === 'landscape') {
      return { width: baseDims.height, height: baseDims.width };
    }
    return baseDims;
  }

  /**
   * Get viewport handle positions for hit testing
   */
  getViewportHandlePositions(vp: SheetViewport) {
    return this.handleRenderer.getViewportHandlePositions(vp);
  }

  /**
   * Check if a point is inside a viewport
   */
  isPointInViewport(point: { x: number; y: number }, vp: SheetViewport): boolean {
    return this.handleRenderer.isPointInViewport(point, vp);
  }

  /**
   * Find which handle (if any) is at the given point
   */
  findViewportHandleAtPoint(
    point: { x: number; y: number },
    vp: SheetViewport,
    tolerance: number = 5
  ): ViewportHandleType | null {
    return this.handleRenderer.findViewportHandleAtPoint(point, vp, tolerance);
  }

  /**
   * Check if a point is inside a query table
   */
  isPointInQueryTable(point: { x: number; y: number }, table: SheetQueryTable): boolean {
    const px = point.x * MM_TO_PIXELS;
    const py = point.y * MM_TO_PIXELS;
    const tx = table.x * MM_TO_PIXELS;
    const ty = table.y * MM_TO_PIXELS;
    const tw = table.width * MM_TO_PIXELS;
    const th = table.height * MM_TO_PIXELS;
    return px >= tx && px <= tx + tw && py >= ty && py <= ty + th;
  }

  /**
   * Draw query tables on the sheet
   */
  private drawQueryTables(
    tables: SheetQueryTable[],
    queries: SavedQuery[],
    shapes: Shape[],
    drawings: Drawing[],
    _sheetZoom: number
  ): void {
    const ctx = this.ctx;

    for (const table of tables) {
      const query = queries.find(q => q.id === table.queryId);
      if (!query) continue;

      // Execute the query to get fresh data
      const result = executeQuery(query.sql, { shapes, drawings, pileTypes: [] });
      if (result.error) continue;

      const columns = result.columns;
      const rows = result.rows;

      // Calculate column widths: use stored widths or distribute evenly
      let colWidths: number[];
      if (table.columnWidths.length === columns.length) {
        colWidths = table.columnWidths;
      } else {
        const defaultWidth = 25; // mm
        colWidths = columns.map(() => defaultWidth);
      }

      const totalWidth = colWidths.reduce((a, b) => a + b, 0);
      const totalHeight = table.headerHeight + rows.length * table.rowHeight;

      // Convert to pixels
      const x = table.x * MM_TO_PIXELS;
      const y = table.y * MM_TO_PIXELS;
      const w = totalWidth * MM_TO_PIXELS;
      const h = totalHeight * MM_TO_PIXELS;
      const headerH = table.headerHeight * MM_TO_PIXELS;
      const rowH = table.rowHeight * MM_TO_PIXELS;

      ctx.save();

      // White background
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(x, y, w, h);

      // Table border
      ctx.strokeStyle = '#000000';
      ctx.lineWidth = 0.8;
      ctx.strokeRect(x, y, w, h);

      // Header background
      ctx.fillStyle = '#f0f0f0';
      ctx.fillRect(x, y, w, headerH);

      // Header bottom line
      ctx.lineWidth = 0.8;
      ctx.beginPath();
      ctx.moveTo(x, y + headerH);
      ctx.lineTo(x + w, y + headerH);
      ctx.stroke();

      // Draw column headers and vertical lines
      let colX = x;
      for (let c = 0; c < columns.length; c++) {
        const colW = colWidths[c] * MM_TO_PIXELS;

        // Vertical column separator (not for last column)
        if (c > 0) {
          ctx.beginPath();
          ctx.lineWidth = 0.4;
          ctx.moveTo(colX, y);
          ctx.lineTo(colX, y + h);
          ctx.stroke();
        }

        // Header text
        const fontSize = table.headerFontSize * (MM_TO_PIXELS / 2.83); // pt to px approx
        ctx.font = `bold ${fontSize}px ${CAD_DEFAULT_FONT}`;
        ctx.fillStyle = '#000000';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';

        // Clip text to column width with small padding
        const padding = 1.5 * MM_TO_PIXELS;
        ctx.save();
        ctx.beginPath();
        ctx.rect(colX + padding / 2, y, colW - padding, headerH);
        ctx.clip();
        ctx.fillText(columns[c], colX + padding, y + headerH / 2);
        ctx.restore();

        colX += colW;
      }

      // Draw data rows
      const cellFontSize = table.fontSize * (MM_TO_PIXELS / 2.83);
      ctx.font = `${cellFontSize}px ${CAD_DEFAULT_FONT}`;
      ctx.fillStyle = '#000000';

      for (let r = 0; r < rows.length; r++) {
        const rowY = y + headerH + r * rowH;

        // Alternate row background
        if (r % 2 === 1) {
          ctx.save();
          ctx.fillStyle = '#f8f8f8';
          ctx.fillRect(x, rowY, w, rowH);
          ctx.restore();
          ctx.fillStyle = '#000000';
        }

        // Row separator line
        if (r > 0) {
          ctx.save();
          ctx.strokeStyle = '#e0e0e0';
          ctx.lineWidth = 0.3;
          ctx.beginPath();
          ctx.moveTo(x, rowY);
          ctx.lineTo(x + w, rowY);
          ctx.stroke();
          ctx.restore();
        }

        // Cell data
        let cellX = x;
        for (let c = 0; c < columns.length; c++) {
          const colW = colWidths[c] * MM_TO_PIXELS;
          const val = rows[r][columns[c]];
          const text = val === null || val === undefined ? '' : String(val);

          const padding = 1.5 * MM_TO_PIXELS;
          ctx.save();
          ctx.font = `${cellFontSize}px ${CAD_DEFAULT_FONT}`;
          ctx.fillStyle = '#000000';
          ctx.textAlign = 'left';
          ctx.textBaseline = 'middle';
          ctx.beginPath();
          ctx.rect(cellX + padding / 2, rowY, colW - padding, rowH);
          ctx.clip();
          ctx.fillText(text, cellX + padding, rowY + rowH / 2);
          ctx.restore();

          cellX += colW;
        }
      }

      // Draw query name as title above the table
      const titleFontSize = (table.headerFontSize + 1) * (MM_TO_PIXELS / 2.83);
      ctx.font = `bold ${titleFontSize}px ${CAD_DEFAULT_FONT}`;
      ctx.fillStyle = '#333333';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'bottom';
      ctx.fillText(query.name, x, y - 2 * MM_TO_PIXELS);

      ctx.restore();
    }
  }

  /**
   * Draw query table placement preview
   */
  private drawQueryPlacementPreview(
    preview: PlacementPreviewInfo,
    queries: SavedQuery[],
    sheetZoom: number
  ): void {
    const ctx = this.ctx;
    const { placingQueryId, previewPosition } = preview;

    if (!previewPosition || !placingQueryId) return;

    const query = queries.find(q => q.id === placingQueryId);
    if (!query) return;

    // Estimate table size for preview
    const numCols = 4;
    const defaultColWidth = 25; // mm
    const headerHeight = 8;     // mm
    const rowHeight = 6;        // mm
    const numRows = 5;

    const totalWidth = numCols * defaultColWidth;
    const totalHeight = headerHeight + numRows * rowHeight;

    const width = totalWidth * MM_TO_PIXELS;
    const height = totalHeight * MM_TO_PIXELS;

    // Calculate top-left position (preview is centered on cursor)
    const x = (previewPosition.x * MM_TO_PIXELS) - width / 2;
    const y = (previewPosition.y * MM_TO_PIXELS) - height / 2;

    ctx.save();

    // Fill with light green tint
    ctx.fillStyle = 'rgba(34, 197, 94, 0.15)';
    ctx.fillRect(x, y, width, height);

    // Dashed border
    ctx.strokeStyle = '#22c55e';
    ctx.lineWidth = 2 / sheetZoom;
    ctx.setLineDash([6 / sheetZoom, 4 / sheetZoom]);
    ctx.strokeRect(x, y, width, height);

    // Draw grid lines inside preview
    ctx.strokeStyle = 'rgba(34, 197, 94, 0.3)';
    ctx.lineWidth = 1 / sheetZoom;

    // Header line
    const headerPx = headerHeight * MM_TO_PIXELS;
    ctx.beginPath();
    ctx.moveTo(x, y + headerPx);
    ctx.lineTo(x + width, y + headerPx);
    ctx.stroke();

    // Column lines
    for (let c = 1; c < numCols; c++) {
      const colX = x + c * defaultColWidth * MM_TO_PIXELS;
      ctx.beginPath();
      ctx.moveTo(colX, y);
      ctx.lineTo(colX, y + height);
      ctx.stroke();
    }

    // Row lines
    for (let r = 1; r < numRows; r++) {
      const rowY = y + headerPx + r * rowHeight * MM_TO_PIXELS;
      ctx.beginPath();
      ctx.moveTo(x, rowY);
      ctx.lineTo(x + width, rowY);
      ctx.stroke();
    }

    // Draw query name label
    ctx.setLineDash([]);
    const fontSize = 12 / sheetZoom;
    ctx.font = `${fontSize}px ${CAD_DEFAULT_FONT}`;
    ctx.fillStyle = '#22c55e';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.fillText(`Query: ${query.name}`, x + width / 2, y - 4 / sheetZoom);

    // Draw table icon indicator
    ctx.textBaseline = 'top';
    ctx.fillText('(table)', x + width / 2, y + height + 4 / sheetZoom);

    ctx.restore();
  }
}
