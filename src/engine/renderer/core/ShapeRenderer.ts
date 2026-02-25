/**
 * ShapeRenderer - Renders individual shapes
 */

import type { Shape, DrawingPreview, CurrentStyle, Viewport } from '../types';
import type { HatchShape, HatchPatternType, BeamShape, ImageShape, GridlineShape, LevelShape, PuntniveauShape, PileShape, WallShape, SlabShape, WallType, WallSystemType, SectionCalloutShape, SpaceShape, PlateSystemShape, SpotElevationShape, CPTShape, FoundationZoneShape } from '../../../types/geometry';
import { generateWallSystemGrid, calculateLayerOffsets } from '../../../services/wallSystem/wallSystemService';
import type { CustomHatchPattern, LineFamily, SvgHatchPattern, MaterialHatchSettings } from '../../../types/hatch';
import { BUILTIN_PATTERNS, isSvgHatchPattern, DEFAULT_MATERIAL_HATCH_SETTINGS } from '../../../types/hatch';
import { BaseRenderer } from './BaseRenderer';
import { COLORS, LINE_DASH_PATTERNS, LINE_DASH_REFERENCE_SCALE } from '../types';
import { DimensionRenderer } from './DimensionRenderer';
import type { DimensionShape } from '../../../types/dimension';
import { drawSplinePath } from '../../geometry/SplineUtils';
import { bulgeToArc, bulgeArcMidpoint } from '../../geometry/GeometryUtils';
import { svgToImage } from '../../../services/export/svgPatternService';
import { generateProfileGeometry } from '../../../services/parametric/geometryGenerators';
import type { ProfileType, ParameterValues } from '../../../types/parametric';
import { getGripHover } from '../gripHoverState';
import { getRotationGizmoVisible, getActiveRotation, getRotationGizmoHovered } from '../rotationGizmoState';
import { useAppStore } from '../../../state/appStore';
import { CAD_DEFAULT_FONT } from '../../../constants/cadDefaults';
import { getElementLabelText, resolveTemplate } from '../../geometry/LabelUtils';
import type { UnitSettings } from '../../../units/types';
import { DEFAULT_UNIT_SETTINGS } from '../../../units/types';
import { formatNumber, formatElevation } from '../../../units/format';

export class ShapeRenderer extends BaseRenderer {
  private dimensionRenderer: DimensionRenderer;
  private customPatterns: CustomHatchPattern[] = [];
  // Cache for loaded SVG pattern images
  private svgImageCache: Map<string, HTMLImageElement> = new Map();
  private svgLoadingPromises: Map<string, Promise<HTMLImageElement | null>> = new Map();
  // Drawing scale for annotation text scaling (default 1:50 = 0.02)
  private drawingScale: number = 0.02;
  // Live preview: temporarily override pattern for selected hatch shapes
  private previewPatternId: string | null = null;
  private previewSelectedIds: Set<string> = new Set();
  // Display lineweight: when false, all lines render at 1px screen width
  private _showLineweight: boolean = true;
  // Current viewport zoom (needed to compute 1-screen-pixel width in world coords)
  private _currentZoom: number = 1;
  // Cache for loaded image elements (keyed by shape ID)
  private imageCache: Map<string, HTMLImageElement> = new Map();
  // Wall types for material-based hatch lookup
  private wallTypes: WallType[] = [];
  // Wall system types (multi-layered assemblies)
  private wallSystemTypes: WallSystemType[] = [];
  // Currently selected wall sub-element for highlighting
  private selectedWallSubElement: { wallId: string; type: 'stud' | 'panel'; key: string } | null = null;
  // Material hatch settings from Drawing Standards
  private materialHatchSettings: MaterialHatchSettings = { ...DEFAULT_MATERIAL_HATCH_SETTINGS };
  // Gridline extension distance in mm (distance beyond start/end before the bubble)
  private gridlineExtension: number = 1000;
  // Sea level datum: peil=0 elevation relative to NAP in meters (default 0)
  private seaLevelDatum: number = 0;
  // All shapes lookup for linked label text resolution
  private shapesLookup: Map<string, Shape> = new Map();
  // Unit settings for number formatting
  private unitSettings: UnitSettings = DEFAULT_UNIT_SETTINGS;

  constructor(ctx: CanvasRenderingContext2D, width: number = 0, height: number = 0, dpr?: number) {
    super(ctx, width, height, dpr);
    this.dimensionRenderer = new DimensionRenderer(ctx, width, height, dpr);
  }

  /**
   * Set the drawing scale for annotation text scaling
   * Annotation text (non-model text) will scale inversely with drawing scale
   * to maintain consistent paper size
   */
  setDrawingScale(scale: number): void {
    this.drawingScale = scale;
    this.dimensionRenderer.setDrawingScale(scale);
  }

  /**
   * Get line dash pattern scaled by drawing scale.
   * Patterns are defined at reference scale (1:100). At other scales they
   * are adjusted so dashes stay the same size on paper.
   */
  override getLineDash(lineStyle: string): number[] {
    const pattern = LINE_DASH_PATTERNS[lineStyle] || [];
    if (pattern.length === 0) return pattern;
    const scaleFactor = LINE_DASH_REFERENCE_SCALE / this.drawingScale;
    return pattern.map(v => v * scaleFactor);
  }

  /**
   * Set whether to display actual line weights (false = all lines 1px thin)
   */
  setShowLineweight(show: boolean): void {
    this._showLineweight = show;
  }

  /**
   * Set the current viewport zoom so line widths can be computed correctly.
   */
  setZoom(zoom: number): void {
    this._currentZoom = zoom;
  }

  /**
   * Get the effective stroke width (respects showLineweight toggle).
   * When lineweight display is off, returns 1 screen pixel in world coords.
   * When lineweight display is on, applies a multiplier and minimum width
   * so that line weights are clearly visible and distinguishable.
   */
  private getLineWidth(strokeWidth: number): number {
    if (!this._showLineweight) {
      return 1 / this._currentZoom;
    }
    // Amplify the line weight so differences are clearly visible,
    // and enforce a minimum of 2 screen pixels (in world coords)
    const amplified = strokeWidth * 3;
    const minWidth = 2 / this._currentZoom;
    return Math.max(amplified, minWidth);
  }

  /**
   * Set live preview state for pattern hovering
   */
  setPreviewPattern(patternId: string | null, selectedIds: string[]): void {
    this.previewPatternId = patternId;
    this.previewSelectedIds = new Set(selectedIds);
  }

  /**
   * Set available custom patterns for rendering
   */
  setCustomPatterns(userPatterns: CustomHatchPattern[], projectPatterns: CustomHatchPattern[]): void {
    this.customPatterns = [...userPatterns, ...projectPatterns];
    // Preload SVG patterns
    this.preloadSvgPatterns();
  }

  /**
   * Set wall types for material-based hatch lookup.
   * When rendering walls, the renderer will look up the wall type by wallTypeId
   * and use the material's hatch settings from Drawing Standards.
   */
  setWallTypes(wallTypes: WallType[]): void {
    this.wallTypes = wallTypes;
  }

  /**
   * Set wall system types for multi-layered wall rendering.
   */
  setWallSystemTypes(types: WallSystemType[]): void {
    this.wallSystemTypes = types;
  }

  /**
   * Set the currently selected wall sub-element for highlight rendering.
   */
  setSelectedWallSubElement(sel: { wallId: string; type: 'stud' | 'panel'; key: string } | null): void {
    this.selectedWallSubElement = sel;
  }

  /**
   * Set material hatch settings from Drawing Standards.
   * These define how each material category (concrete, masonry, etc.) is hatched.
   */
  setMaterialHatchSettings(settings: MaterialHatchSettings): void {
    this.materialHatchSettings = settings;
  }

  /**
   * Set the gridline extension distance (mm).
   * This is how far the gridline extends beyond its start/end points before the bubble circle.
   */
  setGridlineExtension(value: number): void {
    this.gridlineExtension = value;
  }

  /**
   * Set the sea level datum (peil=0 relative to NAP) in meters.
   * Used to display NAP elevations on level markers.
   */
  setSeaLevelDatum(value: number): void {
    this.seaLevelDatum = value;
  }

  /**
   * Set unit settings for number formatting in overlays and labels.
   */
  setUnitSettings(settings: UnitSettings): void {
    this.unitSettings = settings;
  }

  /**
   * Set the currently selected shape IDs for associative dimension highlighting.
   * When a dimension's linked element is selected, its text is rendered in green.
   */
  setSelectedShapeIds(ids: Set<string>): void {
    this.dimensionRenderer.setSelectedShapeIds(ids);
  }

  /**
   * Set the shapes lookup map for resolving linked label text.
   * Call this before rendering shapes so linked labels can look up their target element.
   */
  setShapesLookup(shapes: Shape[]): void {
    this.shapesLookup.clear();
    for (const s of shapes) {
      this.shapesLookup.set(s.id, s);
    }
  }

  /**
   * Preload SVG patterns into image cache for faster rendering
   */
  private preloadSvgPatterns(): void {
    for (const pattern of this.customPatterns) {
      if (isSvgHatchPattern(pattern) && !this.svgImageCache.has(pattern.id)) {
        this.loadSvgPattern(pattern);
      }
    }
  }

  /**
   * Load an SVG pattern into the cache
   */
  private loadSvgPattern(pattern: SvgHatchPattern): void {
    // Don't start another load if one is in progress
    if (this.svgLoadingPromises.has(pattern.id)) return;

    const loadPromise = svgToImage(pattern.svgTile)
      .then(img => {
        this.svgImageCache.set(pattern.id, img);
        this.svgLoadingPromises.delete(pattern.id);
        return img;
      })
      .catch(() => {
        this.svgLoadingPromises.delete(pattern.id);
        return null;
      });

    this.svgLoadingPromises.set(pattern.id, loadPromise);
  }

  /**
   * Get cached SVG image for a pattern
   */
  private getSvgPatternImage(patternId: string): HTMLImageElement | null {
    return this.svgImageCache.get(patternId) || null;
  }

  /**
   * Look up a pattern by ID (checks builtin, user, and project patterns)
   */
  private getPatternById(patternId: string): CustomHatchPattern | undefined {
    return (
      BUILTIN_PATTERNS.find(p => p.id === patternId) ||
      this.customPatterns.find(p => p.id === patternId)
    );
  }

  /**
   * Update dimensions and also update dimension renderer
   */
  setDimensions(width: number, height: number): void {
    super.setDimensions(width, height);
    this.dimensionRenderer.setDimensions(width, height);
  }

  /**
   * Draw a shape with selection state
   */
  drawShape(shape: Shape, isSelected: boolean, isHovered: boolean = false, invertColors: boolean = false, hideHandles: boolean = false): void {
    const ctx = this.ctx;
    const { style } = shape;

    // Set line style
    let strokeColor = style.strokeColor;
    if (invertColors && strokeColor === '#ffffff') {
      strokeColor = '#000000';
    }
    ctx.strokeStyle = isSelected ? COLORS.selection : isHovered ? COLORS.hover : strokeColor;
    ctx.lineWidth = this.getLineWidth(style.strokeWidth);
    ctx.setLineDash(this.getLineDash(style.lineStyle));

    if (style.fillColor) {
      ctx.fillStyle = style.fillColor;
    }

    switch (shape.type) {
      case 'line':
        this.drawLine(shape);
        break;
      case 'rectangle':
        this.drawRectangle(shape);
        break;
      case 'circle':
        this.drawCircle(shape, isSelected);
        break;
      case 'arc':
        this.drawArc(shape, isSelected);
        break;
      case 'polyline':
        this.drawPolyline(shape);
        break;
      case 'spline':
        this.drawSpline(shape);
        break;
      case 'ellipse':
        this.drawEllipse(shape);
        break;
      case 'text':
        this.drawText(shape, isSelected, invertColors);
        break;
      case 'dimension':
        this.dimensionRenderer.drawDimension(shape as DimensionShape, isSelected, isHovered);
        break;
      case 'hatch':
        this.drawHatch(shape as HatchShape, invertColors);
        break;
      case 'beam':
        this.drawBeam(shape as BeamShape, invertColors);
        break;
      case 'gridline':
        this.drawGridline(shape as GridlineShape, invertColors);
        break;
      case 'level':
        this.drawLevel(shape as LevelShape, invertColors);
        break;
      case 'puntniveau':
        this.drawPuntniveau(shape as PuntniveauShape, invertColors);
        break;
      case 'pile':
        this.drawPile(shape as PileShape, invertColors);
        break;
      case 'cpt':
        this.drawCPT(shape as CPTShape, invertColors);
        break;
      case 'foundation-zone':
        this.drawFoundationZone(shape as FoundationZoneShape, invertColors);
        break;
      case 'wall':
        this.drawWall(shape as WallShape, invertColors);
        break;
      case 'slab':
        this.drawSlab(shape as SlabShape, invertColors);
        break;
      case 'section-callout':
        this.drawSectionCallout(shape as SectionCalloutShape, invertColors);
        break;
      case 'space':
        this.drawSpace(shape as SpaceShape, invertColors);
        break;
      case 'plate-system':
        this.drawPlateSystem(shape as PlateSystemShape, invertColors);
        break;
      case 'spot-elevation':
        this.drawSpotElevation(shape as SpotElevationShape, invertColors);
        break;
      case 'image':
        this.drawImage(shape as ImageShape);
        break;
      default:
        break;
    }

    // Draw selection handles (hidden during modify tool operations)
    // Skip for text and dimension shapes - they have their own selection box rendering
    if (isSelected && !hideHandles && shape.type !== 'text' && shape.type !== 'dimension') {
      this.drawSelectionHandles(shape);
    }

    // Draw plate system edit mode indicator (dashed cyan border) or "Tab to edit" hint
    if (shape.type === 'plate-system') {
      const store = useAppStore.getState();
      if (store.plateSystemEditMode && store.editingPlateSystemId === shape.id) {
        this.drawPlateSystemEditModeIndicator(shape as PlateSystemShape);
      } else if (isSelected) {
        this.drawPlateSystemTabHint(shape as PlateSystemShape);
      }
    }

    // Reset line dash
    ctx.setLineDash([]);
  }

  /**
   * Draw a shape without selection highlighting (for sheet viewports)
   */
  drawShapeSimple(shape: Shape, invertColors: boolean = false): void {
    const ctx = this.ctx;
    const { style } = shape;

    // Use black stroke for sheet view (paper is white) if color is white
    let strokeColor = style.strokeColor;
    if (invertColors && style.strokeColor === '#ffffff') {
      strokeColor = '#000000';
    }

    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = this.getLineWidth(style.strokeWidth);
    ctx.setLineDash(this.getLineDash(style.lineStyle));

    if (style.fillColor) {
      ctx.fillStyle = style.fillColor;
    }

    switch (shape.type) {
      case 'line':
        this.drawLine(shape);
        break;
      case 'rectangle':
        this.drawRectangle(shape);
        break;
      case 'circle':
        this.drawCircle(shape);
        break;
      case 'arc':
        this.drawArc(shape);
        break;
      case 'polyline':
        this.drawPolyline(shape);
        break;
      case 'spline':
        this.drawSpline(shape);
        break;
      case 'ellipse':
        this.drawEllipse(shape);
        break;
      case 'text':
        this.drawText(shape, false, invertColors);
        break;
      case 'dimension':
        this.dimensionRenderer.drawDimension(shape as DimensionShape, false);
        break;
      case 'hatch':
        this.drawHatch(shape as HatchShape, invertColors);
        break;
      case 'beam':
        this.drawBeam(shape as BeamShape, invertColors);
        break;
      case 'gridline':
        this.drawGridline(shape as GridlineShape, invertColors);
        break;
      case 'level':
        this.drawLevel(shape as LevelShape, invertColors);
        break;
      case 'puntniveau':
        this.drawPuntniveau(shape as PuntniveauShape, invertColors);
        break;
      case 'pile':
        this.drawPile(shape as PileShape, invertColors);
        break;
      case 'cpt':
        this.drawCPT(shape as CPTShape, invertColors);
        break;
      case 'foundation-zone':
        this.drawFoundationZone(shape as FoundationZoneShape, invertColors);
        break;
      case 'wall':
        this.drawWall(shape as WallShape, invertColors);
        break;
      case 'slab':
        this.drawSlab(shape as SlabShape, invertColors);
        break;
      case 'section-callout':
        this.drawSectionCallout(shape as SectionCalloutShape, invertColors);
        break;
      case 'space':
        this.drawSpace(shape as SpaceShape, invertColors);
        break;
      case 'plate-system':
        this.drawPlateSystem(shape as PlateSystemShape, invertColors);
        break;
      case 'spot-elevation':
        this.drawSpotElevation(shape as SpotElevationShape, invertColors);
        break;
      case 'image':
        this.drawImage(shape as ImageShape);
        break;
    }

    ctx.setLineDash([]);
  }

  /**
   * Draw drawing preview
   */
  drawPreview(preview: DrawingPreview, style?: CurrentStyle, viewport?: Viewport, invertColors: boolean = false): void {
    if (!preview) return;

    const ctx = this.ctx;

    // Set preview style - solid lines matching final appearance
    let strokeColor = style?.strokeColor || '#ffffff';
    if (invertColors && strokeColor === '#ffffff') {
      strokeColor = '#000000';
    }
    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = this.getLineWidth(style?.strokeWidth || 1);
    ctx.setLineDash([]);

    switch (preview.type) {
      case 'line':
        ctx.beginPath();
        ctx.moveTo(preview.start.x, preview.start.y);
        ctx.lineTo(preview.end.x, preview.end.y);
        ctx.stroke();
        // Draw temporary dimension showing line length
        if (viewport) {
          this.drawPreviewDimension(preview.start, preview.end, viewport);
        }
        break;

      case 'rectangle': {
        const x = Math.min(preview.start.x, preview.end.x);
        const y = Math.min(preview.start.y, preview.end.y);
        const width = Math.abs(preview.end.x - preview.start.x);
        const height = Math.abs(preview.end.y - preview.start.y);
        const r = preview.cornerRadius ?? 0;
        ctx.beginPath();
        if (r > 0) {
          const maxR = Math.min(r, width / 2, height / 2);
          ctx.moveTo(x + maxR, y);
          ctx.lineTo(x + width - maxR, y);
          ctx.arcTo(x + width, y, x + width, y + maxR, maxR);
          ctx.lineTo(x + width, y + height - maxR);
          ctx.arcTo(x + width, y + height, x + width - maxR, y + height, maxR);
          ctx.lineTo(x + maxR, y + height);
          ctx.arcTo(x, y + height, x, y + height - maxR, maxR);
          ctx.lineTo(x, y + maxR);
          ctx.arcTo(x, y, x + maxR, y, maxR);
          ctx.closePath();
        } else {
          ctx.rect(x, y, width, height);
        }
        ctx.stroke();
        // Draw temporary dimensions for width and height (always outside the rectangle)
        if (viewport) {
          const topLeft = { x, y };
          const topRight = { x: x + width, y };
          const bottomRight = { x: x + width, y: y + height };
          // Width dimension along the top edge, pushed upward (outside)
          this.drawPreviewDimension(topLeft, topRight, viewport, { x: 0, y: -1 });
          // Height dimension along the right edge, pushed rightward (outside)
          this.drawPreviewDimension(bottomRight, topRight, viewport, { x: 1, y: 0 });
        }
        break;
      }

      case 'rotatedRectangle': {
        const corners = preview.corners;
        ctx.beginPath();
        ctx.moveTo(corners[0].x, corners[0].y);
        ctx.lineTo(corners[1].x, corners[1].y);
        ctx.lineTo(corners[2].x, corners[2].y);
        ctx.lineTo(corners[3].x, corners[3].y);
        ctx.closePath();
        ctx.stroke();
        break;
      }

      case 'circle':
        ctx.beginPath();
        ctx.arc(preview.center.x, preview.center.y, preview.radius, 0, Math.PI * 2);
        ctx.stroke();
        // Draw temporary radius dimension from center to right quadrant, above the line
        if (viewport && preview.radius > 0.5) {
          const radiusEnd = { x: preview.center.x + preview.radius, y: preview.center.y };
          this.drawPreviewDimension(preview.center, radiusEnd, viewport, { x: 0, y: -1 });
        }
        break;

      case 'arc':
        ctx.beginPath();
        ctx.arc(preview.center.x, preview.center.y, preview.radius, preview.startAngle, preview.endAngle);
        ctx.stroke();
        break;

      case 'polyline':
        if (preview.points.length > 0) {
          ctx.beginPath();
          ctx.moveTo(preview.points[0].x, preview.points[0].y);
          // Draw completed segments (with bulge arcs)
          for (let i = 0; i < preview.points.length - 1; i++) {
            const b = preview.bulges?.[i] ?? 0;
            if (b !== 0) {
              const arc = bulgeToArc(preview.points[i], preview.points[i + 1], b);
              ctx.arc(arc.center.x, arc.center.y, arc.radius, arc.startAngle, arc.endAngle, arc.clockwise);
            } else {
              ctx.lineTo(preview.points[i + 1].x, preview.points[i + 1].y);
            }
          }
          // Draw current (in-progress) segment
          const currentBulge = preview.currentBulge ?? 0;
          const throughPoint = preview.arcThroughPoint;
          if (currentBulge !== 0 && throughPoint) {
            // 3-point arc mode with through point set: draw the arc
            const lastPt = preview.points[preview.points.length - 1];
            const arc = bulgeToArc(lastPt, preview.currentPoint, currentBulge);
            ctx.arc(arc.center.x, arc.center.y, arc.radius, arc.startAngle, arc.endAngle, arc.clockwise);
          } else if (throughPoint) {
            // Through point is set but we're showing where the endpoint will be
            // Draw dashed lines: lastPt -> throughPoint -> currentPoint
            const lastPt = preview.points[preview.points.length - 1];
            ctx.stroke(); // Stroke completed segments first
            ctx.beginPath();
            ctx.setLineDash([5, 5]);
            ctx.moveTo(lastPt.x, lastPt.y);
            ctx.lineTo(throughPoint.x, throughPoint.y);
            ctx.lineTo(preview.currentPoint.x, preview.currentPoint.y);
            ctx.stroke();
            ctx.setLineDash([]);
            // Draw small circle at through point
            ctx.beginPath();
            ctx.arc(throughPoint.x, throughPoint.y, 4, 0, Math.PI * 2);
            ctx.fill();
            return; // Already stroked
          } else {
            ctx.lineTo(preview.currentPoint.x, preview.currentPoint.y);
          }
          ctx.stroke();
          // Draw temporary dimension for current segment
          if (viewport) {
            const lastPt = preview.points[preview.points.length - 1];
            this.drawPreviewDimension(lastPt, preview.currentPoint, viewport);
          }
        }
        break;

      case 'spline':
        if (preview.points.length > 0) {
          const allPoints = [...preview.points, preview.currentPoint];
          drawSplinePath(ctx, allPoints);
          ctx.stroke();
        }
        break;

      case 'ellipse':
        ctx.beginPath();
        ctx.ellipse(preview.center.x, preview.center.y, preview.radiusX, preview.radiusY, preview.rotation, 0, Math.PI * 2);
        ctx.stroke();
        break;

      case 'text': {
        // Draw text cursor indicator
        const cursorHeight = style?.strokeWidth ? style.strokeWidth * 10 : 14;
        ctx.beginPath();
        ctx.moveTo(preview.position.x, preview.position.y);
        ctx.lineTo(preview.position.x, preview.position.y + cursorHeight);
        ctx.stroke();
        // Draw small horizontal lines at top and bottom
        ctx.beginPath();
        ctx.moveTo(preview.position.x - 3, preview.position.y);
        ctx.lineTo(preview.position.x + 3, preview.position.y);
        ctx.moveTo(preview.position.x - 3, preview.position.y + cursorHeight);
        ctx.lineTo(preview.position.x + 3, preview.position.y + cursorHeight);
        ctx.stroke();
        break;
      }

      case 'dimension':
        if (viewport) {
          this.dimensionRenderer.drawDimensionPreview(preview, viewport);
        }
        break;

      case 'hatch':
        if (preview.points.length > 0) {
          ctx.beginPath();
          ctx.moveTo(preview.points[0].x, preview.points[0].y);
          for (let i = 1; i < preview.points.length; i++) {
            ctx.lineTo(preview.points[i].x, preview.points[i].y);
          }
          ctx.lineTo(preview.currentPoint.x, preview.currentPoint.y);
          ctx.stroke();
          // Draw dashed closing line hint
          if (preview.points.length >= 2) {
            ctx.save();
            ctx.setLineDash([4, 4]);
            ctx.globalAlpha = 0.4;
            ctx.beginPath();
            ctx.moveTo(preview.currentPoint.x, preview.currentPoint.y);
            ctx.lineTo(preview.points[0].x, preview.points[0].y);
            ctx.stroke();
            ctx.restore();
          }
        }
        break;

      case 'beam': {
        // Draw beam preview in plan view
        const { start, end, flangeWidth, showCenterline } = preview;

        // Arc beam preview
        if (preview.bulge && Math.abs(preview.bulge) > 0.0001) {
          const bArc = bulgeToArc(start, end, preview.bulge);
          const bHalfW = flangeWidth / 2;
          const bInnerR = Math.max(0, bArc.radius - bHalfW);
          const bOuterR = bArc.radius + bHalfW;

          // Draw arc beam outline
          ctx.beginPath();
          ctx.arc(bArc.center.x, bArc.center.y, bOuterR, bArc.startAngle, bArc.endAngle, bArc.clockwise);
          ctx.lineTo(bArc.center.x + bInnerR * Math.cos(bArc.endAngle), bArc.center.y + bInnerR * Math.sin(bArc.endAngle));
          ctx.arc(bArc.center.x, bArc.center.y, bInnerR, bArc.endAngle, bArc.startAngle, !bArc.clockwise);
          ctx.closePath();
          ctx.stroke();

          // Draw centerline arc (dashed)
          if (showCenterline) {
            ctx.save();
            ctx.setLineDash(this.getLineDash('dashdot'));
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
            ctx.beginPath();
            ctx.arc(bArc.center.x, bArc.center.y, bArc.radius, bArc.startAngle, bArc.endAngle, bArc.clockwise);
            ctx.stroke();
            ctx.restore();
          }
          break;
        }

        const beamAngle = Math.atan2(end.y - start.y, end.x - start.x);
        const halfWidth = flangeWidth / 2;
        const perpX = Math.sin(beamAngle) * halfWidth;
        const perpY = Math.cos(beamAngle) * halfWidth;

        // Draw beam outline (rectangle in plan view)
        ctx.beginPath();
        ctx.moveTo(start.x + perpX, start.y - perpY);
        ctx.lineTo(end.x + perpX, end.y - perpY);
        ctx.lineTo(end.x - perpX, end.y + perpY);
        ctx.lineTo(start.x - perpX, start.y + perpY);
        ctx.closePath();
        ctx.stroke();

        // Draw centerline (dashed)
        if (showCenterline) {
          ctx.save();
          ctx.setLineDash(this.getLineDash('dashdot'));
          ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
          ctx.beginPath();
          ctx.moveTo(start.x, start.y);
          ctx.lineTo(end.x, end.y);
          ctx.stroke();
          ctx.restore();
        }

        // Draw end lines (perpendicular at start and end)
        ctx.beginPath();
        ctx.moveTo(start.x + perpX, start.y - perpY);
        ctx.lineTo(start.x - perpX, start.y + perpY);
        ctx.moveTo(end.x + perpX, end.y - perpY);
        ctx.lineTo(end.x - perpX, end.y + perpY);
        ctx.stroke();
        break;
      }

      case 'gridline': {
        // Draw gridline preview: dash-dot line + bubble(s)
        // Matches the actual drawGridline() rendering with scale-aware extension and proper dash pattern
        const { start: glStart, end: glEnd, label: glLabel, bubblePosition: glBubblePos, bubbleRadius: glRadiusRaw } = preview;
        const glScaleFactor = LINE_DASH_REFERENCE_SCALE / this.drawingScale;
        const glRadius = glRadiusRaw * glScaleFactor;
        const glAngle = Math.atan2(glEnd.y - glStart.y, glEnd.x - glStart.x);
        const glDx = Math.cos(glAngle);
        const glDy = Math.sin(glAngle);

        // Line extends beyond start/end (at reference scale), scaled for current drawing scale
        const glExt = this.gridlineExtension * glScaleFactor;

        // Draw dash-dot line with scale-aware pattern (matching actual gridline)
        ctx.save();
        ctx.setLineDash(this.getLineDash('dashdot'));
        ctx.beginPath();
        ctx.moveTo(glStart.x - glDx * glExt, glStart.y - glDy * glExt);
        ctx.lineTo(glEnd.x + glDx * glExt, glEnd.y + glDy * glExt);
        ctx.stroke();
        ctx.restore();

        // Draw bubbles at correct offset (extension + bubbleRadius from endpoint)
        ctx.setLineDash([]);
        const drawBubble = (cx: number, cy: number) => {
          ctx.beginPath();
          ctx.arc(cx, cy, glRadius, 0, Math.PI * 2);
          ctx.stroke();
          // Label text
          const fSize = glRadius * 1.2;
          ctx.save();
          ctx.fillStyle = strokeColor;
          ctx.font = `${fSize}px ${CAD_DEFAULT_FONT}`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(glLabel, cx, cy);
          ctx.restore();
        };

        if (glBubblePos === 'start' || glBubblePos === 'both') {
          drawBubble(glStart.x - glDx * (glExt + glRadius), glStart.y - glDy * (glExt + glRadius));
        }
        if (glBubblePos === 'end' || glBubblePos === 'both') {
          drawBubble(glEnd.x + glDx * (glExt + glRadius), glEnd.y + glDy * (glExt + glRadius));
        }
        break;
      }

      case 'level': {
        // Draw level preview: dashed line + right-side triangle marker only
        const { start: lvStart, end: lvEnd, label: lvLabel, bubbleRadius: lvRadiusRaw } = preview;
        const lvScaleFactor = LINE_DASH_REFERENCE_SCALE / this.drawingScale;
        const lvRadius = lvRadiusRaw * lvScaleFactor;
        const lvAngle = Math.atan2(lvEnd.y - lvStart.y, lvEnd.x - lvStart.x);
        const lvDx = Math.cos(lvAngle);
        const lvDy = Math.sin(lvAngle);

        ctx.save();
        ctx.setLineDash(this.getLineDash('dashed'));
        ctx.beginPath();
        ctx.moveTo(lvStart.x, lvStart.y);
        ctx.lineTo(lvEnd.x, lvEnd.y);
        ctx.stroke();
        ctx.restore();

        ctx.setLineDash([]);
        // Right-side (end) triangle marker only
        const lvSz = lvRadius * 0.7;
        const lvTipX = lvEnd.x;
        const lvTipY = lvEnd.y;
        const lvPerpX = -lvDy;
        const lvPerpY = lvDx;
        ctx.beginPath();
        ctx.moveTo(lvTipX, lvTipY);
        ctx.lineTo(lvTipX + lvDx * lvSz + lvPerpX * lvSz * 0.4, lvTipY + lvDy * lvSz + lvPerpY * lvSz * 0.4);
        ctx.lineTo(lvTipX + lvDx * lvSz - lvPerpX * lvSz * 0.4, lvTipY + lvDy * lvSz - lvPerpY * lvSz * 0.4);
        ctx.closePath();
        ctx.fillStyle = strokeColor;
        ctx.fill();
        ctx.stroke();

        // Peil label text to the right
        const lvFSize = lvRadius * 1.0;
        const lvTextX = lvEnd.x + lvDx * (lvSz * 1.5 + lvRadius * 0.3);
        const lvTextY = lvEnd.y + lvDy * (lvSz * 1.5 + lvRadius * 0.3);
        ctx.save();
        ctx.fillStyle = strokeColor;
        ctx.font = `${lvFSize}px ${CAD_DEFAULT_FONT}`;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'bottom';
        ctx.fillText(lvLabel, lvTextX, lvTextY);
        ctx.restore();
        break;
      }

      case 'puntniveau': {
        // Draw puntniveau preview: dashed polygon outline only
        // (Label is now a separate linked TextShape created when polygon is closed)
        const pnPts = preview.points;
        const pnCurrent = preview.currentPoint;
        const allPnPts = [...pnPts, pnCurrent];

        if (allPnPts.length >= 2) {
          ctx.save();
          ctx.setLineDash(this.getLineDash('dashed'));
          ctx.beginPath();
          ctx.moveTo(allPnPts[0].x, allPnPts[0].y);
          for (let pi = 1; pi < allPnPts.length; pi++) {
            ctx.lineTo(allPnPts[pi].x, allPnPts[pi].y);
          }
          ctx.lineTo(allPnPts[0].x, allPnPts[0].y);
          ctx.closePath();
          ctx.stroke();
          ctx.restore();
        }
        break;
      }

      case 'pile': {
        // Draw pile preview using contourType + fillPattern symbol system
        const { position: pilePos, diameter: pileDiam, label: pileLabel, fontSize: pileFontSize, contourType: pileContour = 'circle', fillPattern: pileFill = 6 } = preview;
        const pileRadius = pileDiam / 2;

        this.drawPilePreviewSymbol(
          pilePos.x, pilePos.y, pileRadius,
          pileContour, pileFill,
          pileLabel, pileFontSize,
        );
        break;
      }

      case 'cpt': {
        // Draw CPT preview: triangle marker + name at cursor
        const { position: cptPos, name: cptName, fontSize: cptFontSize, markerSize: cptMarkerSize } = preview;
        const cptSf = LINE_DASH_REFERENCE_SCALE / this.drawingScale;
        const ms = cptMarkerSize * cptSf;

        // Draw inverted triangle marker
        ctx.beginPath();
        ctx.moveTo(cptPos.x, cptPos.y - ms * 0.6);
        ctx.lineTo(cptPos.x - ms * 0.5, cptPos.y + ms * 0.4);
        ctx.lineTo(cptPos.x + ms * 0.5, cptPos.y + ms * 0.4);
        ctx.closePath();
        ctx.stroke();

        // Draw name below
        if (cptName) {
          ctx.save();
          ctx.fillStyle = strokeColor;
          ctx.font = `${cptFontSize * cptSf}px ${CAD_DEFAULT_FONT}`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'top';
          ctx.fillText(cptName, cptPos.x, cptPos.y + ms * 0.4 + cptFontSize * cptSf * 0.3);
          ctx.restore();
        }
        break;
      }

      case 'wall': {
        // Draw wall preview (rectangle in plan view)
        const { start: wStart, end: wEnd, thickness: wThick, showCenterline: wShowCL } = preview;

        // Arc wall preview
        if (preview.bulge && Math.abs(preview.bulge) > 0.0001) {
          const wArc = bulgeToArc(wStart, wEnd, preview.bulge);
          const wArcJust = ('justification' in preview ? preview.justification : undefined) || 'center';
          let wArcInnerR: number;
          let wArcOuterR: number;
          if (wArcJust === 'left') {
            wArcInnerR = wArc.radius;
            wArcOuterR = wArc.radius + wThick;
          } else if (wArcJust === 'right') {
            wArcInnerR = wArc.radius - wThick;
            wArcOuterR = wArc.radius;
          } else {
            wArcInnerR = wArc.radius - wThick / 2;
            wArcOuterR = wArc.radius + wThick / 2;
          }
          if (wArcInnerR < 0) wArcInnerR = 0;

          // Draw arc wall outline
          ctx.beginPath();
          ctx.arc(wArc.center.x, wArc.center.y, wArcOuterR, wArc.startAngle, wArc.endAngle, wArc.clockwise);
          ctx.lineTo(wArc.center.x + wArcInnerR * Math.cos(wArc.endAngle), wArc.center.y + wArcInnerR * Math.sin(wArc.endAngle));
          ctx.arc(wArc.center.x, wArc.center.y, wArcInnerR, wArc.endAngle, wArc.startAngle, !wArc.clockwise);
          ctx.closePath();
          ctx.stroke();

          // Hatch fill preview
          {
            let previewMatSetting = this.materialHatchSettings['concrete'] || DEFAULT_MATERIAL_HATCH_SETTINGS['concrete'];
            if (preview.wallTypeId) {
              const previewWallType = this.wallTypes.find(wt => wt.id === preview.wallTypeId);
              if (previewWallType) {
                previewMatSetting = this.materialHatchSettings[previewWallType.name]
                  || this.materialHatchSettings[previewWallType.material]
                  || DEFAULT_MATERIAL_HATCH_SETTINGS[previewWallType.material]
                  || previewMatSetting;
              }
            }
            const previewHatch = previewMatSetting;
            if ((previewHatch.hatchType && previewHatch.hatchType !== 'none') || previewHatch.hatchPatternId) {
              const previewStrokeWidth = ctx.lineWidth;
              ctx.save();
              // Clip to arc wall path
              ctx.beginPath();
              ctx.arc(wArc.center.x, wArc.center.y, wArcOuterR, wArc.startAngle, wArc.endAngle, wArc.clockwise);
              ctx.lineTo(wArc.center.x + wArcInnerR * Math.cos(wArc.endAngle), wArc.center.y + wArcInnerR * Math.sin(wArc.endAngle));
              ctx.arc(wArc.center.x, wArc.center.y, wArcInnerR, wArc.endAngle, wArc.startAngle, !wArc.clockwise);
              ctx.closePath();
              ctx.clip();

              ctx.lineWidth = previewStrokeWidth * 0.4;
              ctx.setLineDash([]);

              if (previewHatch.backgroundColor) {
                ctx.fillStyle = previewHatch.backgroundColor;
                ctx.beginPath();
                ctx.arc(wArc.center.x, wArc.center.y, wArcOuterR, wArc.startAngle, wArc.endAngle, wArc.clockwise);
                ctx.lineTo(wArc.center.x + wArcInnerR * Math.cos(wArc.endAngle), wArc.center.y + wArcInnerR * Math.sin(wArc.endAngle));
                ctx.arc(wArc.center.x, wArc.center.y, wArcInnerR, wArc.endAngle, wArc.startAngle, !wArc.clockwise);
                ctx.closePath();
                ctx.fill();
              }

              const wArcSpacing = previewHatch.hatchSpacing || 50;
              const wArcHatchColor = previewHatch.hatchColor || (ctx.strokeStyle as string);
              ctx.strokeStyle = wArcHatchColor;

              // Check for insulation pattern (NEN standard zigzag)
              const wArcPreviewPattern = previewHatch.hatchPatternId ? this.getPatternById(previewHatch.hatchPatternId) : undefined;
              if (wArcPreviewPattern && (previewHatch.hatchPatternId === 'nen47-isolatie' || previewHatch.hatchPatternId === 'insulation')) {
                this.drawInsulationZigzagArc(
                  wArc.center, wArcInnerR, wArcOuterR,
                  wArc.startAngle, wArc.endAngle, wArc.clockwise,
                  wArcHatchColor,
                  previewStrokeWidth
                );
              } else if (previewHatch.hatchType === 'solid') {
                ctx.fillStyle = wArcHatchColor;
                ctx.beginPath();
                ctx.arc(wArc.center.x, wArc.center.y, wArcOuterR, wArc.startAngle, wArc.endAngle, wArc.clockwise);
                ctx.lineTo(wArc.center.x + wArcInnerR * Math.cos(wArc.endAngle), wArc.center.y + wArcInnerR * Math.sin(wArc.endAngle));
                ctx.arc(wArc.center.x, wArc.center.y, wArcInnerR, wArc.endAngle, wArc.startAngle, !wArc.clockwise);
                ctx.closePath();
                ctx.fill();
              } else {
                // Radial hatch lines for arc wall preview
                const wArcAngularStep = wArcSpacing / wArc.radius;
                const wArcStep = wArc.clockwise ? -wArcAngularStep : wArcAngularStep;
                ctx.beginPath();
                let wA = wArc.startAngle + wArcStep;
                for (let wi = 0; wi < 10000; wi++) {
                  // Check if angle is still in range
                  const wNorm = wArc.clockwise
                    ? ((wArc.startAngle - wA + Math.PI * 4) % (Math.PI * 2))
                    : ((wA - wArc.startAngle + Math.PI * 4) % (Math.PI * 2));
                  const wEndNorm = wArc.clockwise
                    ? ((wArc.startAngle - wArc.endAngle + Math.PI * 4) % (Math.PI * 2))
                    : ((wArc.endAngle - wArc.startAngle + Math.PI * 4) % (Math.PI * 2));
                  if (wNorm > wEndNorm + 0.0001) break;
                  ctx.moveTo(wArc.center.x + wArcInnerR * Math.cos(wA), wArc.center.y + wArcInnerR * Math.sin(wA));
                  ctx.lineTo(wArc.center.x + wArcOuterR * Math.cos(wA), wArc.center.y + wArcOuterR * Math.sin(wA));
                  wA += wArcStep;
                }
                ctx.stroke();
              }

              ctx.restore();
            }
          }

          // Draw centerline arc (dashed)
          if (wShowCL) {
            ctx.save();
            ctx.setLineDash(this.getLineDash('dashdot'));
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
            ctx.beginPath();
            ctx.arc(wArc.center.x, wArc.center.y, wArc.radius, wArc.startAngle, wArc.endAngle, wArc.clockwise);
            ctx.stroke();
            ctx.restore();
          }
          break;
        }

        const wallAngle = Math.atan2(wEnd.y - wStart.y, wEnd.x - wStart.x);

        // Determine asymmetric offsets based on justification
        const wJust = ('justification' in preview ? preview.justification : undefined) || 'center';
        let wLeftThick: number;
        let wRightThick: number;
        if (wJust === 'left') {
          wLeftThick = wThick;
          wRightThick = 0;
        } else if (wJust === 'right') {
          wLeftThick = 0;
          wRightThick = wThick;
        } else {
          wLeftThick = wThick / 2;
          wRightThick = wThick / 2;
        }

        const wPerpUnitX = Math.sin(wallAngle);
        const wPerpUnitY = Math.cos(wallAngle);

        const wCorners = [
          { x: wStart.x + wPerpUnitX * wLeftThick, y: wStart.y - wPerpUnitY * wLeftThick },
          { x: wEnd.x + wPerpUnitX * wLeftThick, y: wEnd.y - wPerpUnitY * wLeftThick },
          { x: wEnd.x - wPerpUnitX * wRightThick, y: wEnd.y + wPerpUnitY * wRightThick },
          { x: wStart.x - wPerpUnitX * wRightThick, y: wStart.y + wPerpUnitY * wRightThick },
        ];

        // Draw wall outline
        ctx.beginPath();
        ctx.moveTo(wCorners[0].x, wCorners[0].y);
        ctx.lineTo(wCorners[1].x, wCorners[1].y);
        ctx.lineTo(wCorners[2].x, wCorners[2].y);
        ctx.lineTo(wCorners[3].x, wCorners[3].y);
        ctx.closePath();
        ctx.stroke();

        // Hatch fill preview - use materialHatchSettings (resolve from wall type or default to concrete)
        {
          // Resolve the material from the pending wall type, falling back to concrete
          let previewMatSetting = this.materialHatchSettings['concrete'] || DEFAULT_MATERIAL_HATCH_SETTINGS['concrete'];
          if (preview.wallTypeId) {
            const previewWallType = this.wallTypes.find(wt => wt.id === preview.wallTypeId);
            if (previewWallType) {
              previewMatSetting = this.materialHatchSettings[previewWallType.name]
                || this.materialHatchSettings[previewWallType.material]
                || DEFAULT_MATERIAL_HATCH_SETTINGS[previewWallType.material]
                || previewMatSetting;
            }
          }
          const previewHatch = previewMatSetting;
          if ((previewHatch.hatchType && previewHatch.hatchType !== 'none') || previewHatch.hatchPatternId) {
            const previewStrokeWidth = ctx.lineWidth;
            ctx.save();
            ctx.beginPath();
            ctx.moveTo(wCorners[0].x, wCorners[0].y);
            ctx.lineTo(wCorners[1].x, wCorners[1].y);
            ctx.lineTo(wCorners[2].x, wCorners[2].y);
            ctx.lineTo(wCorners[3].x, wCorners[3].y);
            ctx.closePath();
            ctx.clip();

            ctx.lineWidth = previewStrokeWidth * 0.4;
            ctx.setLineDash([]);

            // Fill solid background color first (under hatch lines)
            if (previewHatch.backgroundColor) {
              ctx.fillStyle = previewHatch.backgroundColor;
              ctx.beginPath();
              ctx.moveTo(wCorners[0].x, wCorners[0].y);
              ctx.lineTo(wCorners[1].x, wCorners[1].y);
              ctx.lineTo(wCorners[2].x, wCorners[2].y);
              ctx.lineTo(wCorners[3].x, wCorners[3].y);
              ctx.closePath();
              ctx.fill();
            }

            const wMinX = Math.min(...wCorners.map(c => c.x));
            const wMinY = Math.min(...wCorners.map(c => c.y));
            const wMaxX = Math.max(...wCorners.map(c => c.x));
            const wMaxY = Math.max(...wCorners.map(c => c.y));

            const wSpacing = previewHatch.hatchSpacing || 50;
            const wHatchColor = previewHatch.hatchColor || (ctx.strokeStyle as string);
            ctx.strokeStyle = wHatchColor;
            // Make hatch perpendicular to wall direction
            const wAngleDeg = wallAngle * 180 / Math.PI;

            const previewPattern = previewHatch.hatchPatternId ? this.getPatternById(previewHatch.hatchPatternId) : undefined;
            if (previewPattern && previewPattern.lineFamilies.length > 0) {
              const pScale = wSpacing / 10;
              // Special case: insulation patterns get zigzag rendering (NEN standard)
              if (previewHatch.hatchPatternId === 'nen47-isolatie' || previewHatch.hatchPatternId === 'insulation') {
                this.drawInsulationZigzag(wMinX, wMinY, wMaxX, wMaxY, pScale, wAngleDeg, wHatchColor, previewStrokeWidth, wThick);
              } else {
                this.drawCustomPatternLines(previewPattern.lineFamilies, wMinX, wMinY, wMaxX, wMaxY, pScale, wAngleDeg, wHatchColor, previewStrokeWidth);
              }
            } else if (previewPattern && previewPattern.lineFamilies.length === 0) {
              ctx.fillStyle = wHatchColor;
              ctx.beginPath();
              ctx.moveTo(wCorners[0].x, wCorners[0].y);
              ctx.lineTo(wCorners[1].x, wCorners[1].y);
              ctx.lineTo(wCorners[2].x, wCorners[2].y);
              ctx.lineTo(wCorners[3].x, wCorners[3].y);
              ctx.closePath();
              ctx.fill();
            } else {
              const wBaseAngle = (previewHatch.hatchAngle || 45) + wAngleDeg;
              if (previewHatch.hatchType === 'solid') {
                ctx.fillStyle = wHatchColor;
                ctx.beginPath();
                ctx.moveTo(wCorners[0].x, wCorners[0].y);
                ctx.lineTo(wCorners[1].x, wCorners[1].y);
                ctx.lineTo(wCorners[2].x, wCorners[2].y);
                ctx.lineTo(wCorners[3].x, wCorners[3].y);
                ctx.closePath();
                ctx.fill();
              } else if (previewHatch.hatchType === 'diagonal') {
                this.drawLineFamilySimple(wBaseAngle, wSpacing, wMinX, wMinY, wMaxX, wMaxY);
              } else if (previewHatch.hatchType === 'crosshatch') {
                this.drawLineFamilySimple(wBaseAngle, wSpacing, wMinX, wMinY, wMaxX, wMaxY);
                this.drawLineFamilySimple(wBaseAngle + 90, wSpacing, wMinX, wMinY, wMaxX, wMaxY);
              } else if (previewHatch.hatchType === 'horizontal') {
                this.drawLineFamilySimple(wAngleDeg + 90, wSpacing, wMinX, wMinY, wMaxX, wMaxY);
              }
            }

            ctx.restore();
          }
        }

        // Draw centerline (dashed)
        if (wShowCL) {
          ctx.save();
          ctx.setLineDash(this.getLineDash('dashdot'));
          ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
          ctx.beginPath();
          ctx.moveTo(wStart.x, wStart.y);
          ctx.lineTo(wEnd.x, wEnd.y);
          ctx.stroke();
          ctx.restore();
        }
        break;
      }

      case 'wall-rectangle': {
        // Draw 4-wall rectangle preview from two opposite corners
        const { corner1: wrC1, corner2: wrC2, thickness: wrThick, showCenterline: wrShowCL } = preview;
        // Derive corners (axis-aligned rectangle)
        const wrCorners = [
          wrC1,
          { x: wrC2.x, y: wrC1.y },
          wrC2,
          { x: wrC1.x, y: wrC2.y },
        ];

        const wrJust = ('justification' in preview ? preview.justification : undefined) || 'center';

        // Draw 4 wall segments as rectangles (with thickness)
        for (let i = 0; i < 4; i++) {
          const wrs = wrCorners[i];
          const wre = wrCorners[(i + 1) % 4];
          const wrAngle = Math.atan2(wre.y - wrs.y, wre.x - wrs.x);

          let wrLeft: number, wrRight: number;
          if (wrJust === 'left') { wrLeft = wrThick; wrRight = 0; }
          else if (wrJust === 'right') { wrLeft = 0; wrRight = wrThick; }
          else { wrLeft = wrThick / 2; wrRight = wrThick / 2; }

          const wrPx = Math.sin(wrAngle);
          const wrPy = Math.cos(wrAngle);

          const wrSegCorners = [
            { x: wrs.x + wrPx * wrLeft, y: wrs.y - wrPy * wrLeft },
            { x: wre.x + wrPx * wrLeft, y: wre.y - wrPy * wrLeft },
            { x: wre.x - wrPx * wrRight, y: wre.y + wrPy * wrRight },
            { x: wrs.x - wrPx * wrRight, y: wrs.y + wrPy * wrRight },
          ];

          ctx.beginPath();
          ctx.moveTo(wrSegCorners[0].x, wrSegCorners[0].y);
          ctx.lineTo(wrSegCorners[1].x, wrSegCorners[1].y);
          ctx.lineTo(wrSegCorners[2].x, wrSegCorners[2].y);
          ctx.lineTo(wrSegCorners[3].x, wrSegCorners[3].y);
          ctx.closePath();
          ctx.stroke();

          // Centerline
          if (wrShowCL) {
            ctx.save();
            ctx.setLineDash(this.getLineDash('dashdot'));
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
            ctx.beginPath();
            ctx.moveTo(wrs.x, wrs.y);
            ctx.lineTo(wre.x, wre.y);
            ctx.stroke();
            ctx.restore();
          }
        }
        break;
      }

      case 'beam-rectangle': {
        // Draw 4-beam rectangle preview from two opposite corners
        const { corner1: brC1, corner2: brC2, flangeWidth: brFW, showCenterline: brShowCL } = preview;
        const brCorners = [
          brC1,
          { x: brC2.x, y: brC1.y },
          brC2,
          { x: brC1.x, y: brC2.y },
        ];

        const brHalfW = brFW / 2;
        for (let i = 0; i < 4; i++) {
          const brs = brCorners[i];
          const bre = brCorners[(i + 1) % 4];
          const brAngle = Math.atan2(bre.y - brs.y, bre.x - brs.x);
          const brPx = Math.sin(brAngle);
          const brPy = Math.cos(brAngle);

          const brSegCorners = [
            { x: brs.x + brPx * brHalfW, y: brs.y - brPy * brHalfW },
            { x: bre.x + brPx * brHalfW, y: bre.y - brPy * brHalfW },
            { x: bre.x - brPx * brHalfW, y: bre.y + brPy * brHalfW },
            { x: brs.x - brPx * brHalfW, y: brs.y + brPy * brHalfW },
          ];

          ctx.beginPath();
          ctx.moveTo(brSegCorners[0].x, brSegCorners[0].y);
          ctx.lineTo(brSegCorners[1].x, brSegCorners[1].y);
          ctx.lineTo(brSegCorners[2].x, brSegCorners[2].y);
          ctx.lineTo(brSegCorners[3].x, brSegCorners[3].y);
          ctx.closePath();
          ctx.stroke();

          // Centerline
          if (brShowCL) {
            ctx.save();
            ctx.setLineDash(this.getLineDash('dashdot'));
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
            ctx.beginPath();
            ctx.moveTo(brs.x, brs.y);
            ctx.lineTo(bre.x, bre.y);
            ctx.stroke();
            ctx.restore();
          }
        }
        break;
      }

      case 'wall-circle': {
        // Draw circular wall preview (two concentric circles for inner/outer wall edges)
        const { center: wcCenter, radius: wcRadius, thickness: wcThick, showCenterline: wcShowCL } = preview;
        const wcJust = ('justification' in preview ? preview.justification : undefined) || 'center';

        let wcInnerR: number, wcOuterR: number;
        if (wcJust === 'left') {
          wcInnerR = wcRadius;
          wcOuterR = wcRadius + wcThick;
        } else if (wcJust === 'right') {
          wcInnerR = wcRadius - wcThick;
          wcOuterR = wcRadius;
        } else {
          wcInnerR = wcRadius - wcThick / 2;
          wcOuterR = wcRadius + wcThick / 2;
        }
        if (wcInnerR < 0) wcInnerR = 0;

        // Outer circle
        ctx.beginPath();
        ctx.arc(wcCenter.x, wcCenter.y, wcOuterR, 0, Math.PI * 2);
        ctx.stroke();

        // Inner circle
        if (wcInnerR > 0) {
          ctx.beginPath();
          ctx.arc(wcCenter.x, wcCenter.y, wcInnerR, 0, Math.PI * 2);
          ctx.stroke();
        }

        // Centerline circle
        if (wcShowCL) {
          ctx.save();
          ctx.setLineDash(this.getLineDash('dashdot'));
          ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
          ctx.beginPath();
          ctx.arc(wcCenter.x, wcCenter.y, wcRadius, 0, Math.PI * 2);
          ctx.stroke();
          ctx.restore();
        }

        // Cross at center
        const wcCrossSize = Math.max(20, wcRadius * 0.05);
        ctx.beginPath();
        ctx.moveTo(wcCenter.x - wcCrossSize, wcCenter.y);
        ctx.lineTo(wcCenter.x + wcCrossSize, wcCenter.y);
        ctx.moveTo(wcCenter.x, wcCenter.y - wcCrossSize);
        ctx.lineTo(wcCenter.x, wcCenter.y + wcCrossSize);
        ctx.stroke();
        break;
      }

      case 'beam-circle': {
        // Draw circular beam preview (two concentric circles for inner/outer beam edges)
        const { center: bcCenter, radius: bcRadius, flangeWidth: bcFW, showCenterline: bcShowCL } = preview;
        const bcHalfW = bcFW / 2;
        const bcInnerR = Math.max(0, bcRadius - bcHalfW);
        const bcOuterR = bcRadius + bcHalfW;

        // Outer circle
        ctx.beginPath();
        ctx.arc(bcCenter.x, bcCenter.y, bcOuterR, 0, Math.PI * 2);
        ctx.stroke();

        // Inner circle
        if (bcInnerR > 0) {
          ctx.beginPath();
          ctx.arc(bcCenter.x, bcCenter.y, bcInnerR, 0, Math.PI * 2);
          ctx.stroke();
        }

        // Centerline circle
        if (bcShowCL) {
          ctx.save();
          ctx.setLineDash(this.getLineDash('dashdot'));
          ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
          ctx.beginPath();
          ctx.arc(bcCenter.x, bcCenter.y, bcRadius, 0, Math.PI * 2);
          ctx.stroke();
          ctx.restore();
        }

        // Cross at center
        const bcCrossSize = Math.max(20, bcRadius * 0.05);
        ctx.beginPath();
        ctx.moveTo(bcCenter.x - bcCrossSize, bcCenter.y);
        ctx.lineTo(bcCenter.x + bcCrossSize, bcCenter.y);
        ctx.moveTo(bcCenter.x, bcCenter.y - bcCrossSize);
        ctx.lineTo(bcCenter.x, bcCenter.y + bcCrossSize);
        ctx.stroke();
        break;
      }

      case 'slab': {
        const slabPts = preview.points;
        const slabCurrent = preview.currentPoint;
        const allSlabPts = [...slabPts, slabCurrent];

        if (allSlabPts.length >= 2) {
          ctx.beginPath();
          ctx.moveTo(allSlabPts[0].x, allSlabPts[0].y);
          for (let si = 1; si < allSlabPts.length; si++) {
            ctx.lineTo(allSlabPts[si].x, allSlabPts[si].y);
          }
          ctx.lineTo(allSlabPts[0].x, allSlabPts[0].y);
          ctx.closePath();
          ctx.stroke();

          // Hatch fill preview - use materialHatchSettings (resolve from slab material or default to concrete)
          if (allSlabPts.length >= 3) {
            const slabMaterial = (preview as { material?: string }).material || 'concrete';
            const slabPreviewHatch = this.materialHatchSettings[slabMaterial]
              || DEFAULT_MATERIAL_HATCH_SETTINGS[slabMaterial]
              || this.materialHatchSettings['concrete']
              || DEFAULT_MATERIAL_HATCH_SETTINGS['concrete'];
            if ((slabPreviewHatch.hatchType && slabPreviewHatch.hatchType !== 'none') || slabPreviewHatch.hatchPatternId) {
              const slabSW = ctx.lineWidth;
              ctx.save();
              ctx.beginPath();
              ctx.moveTo(allSlabPts[0].x, allSlabPts[0].y);
              for (let si = 1; si < allSlabPts.length; si++) {
                ctx.lineTo(allSlabPts[si].x, allSlabPts[si].y);
              }
              ctx.closePath();
              ctx.clip();
              ctx.lineWidth = slabSW * 0.4;
              ctx.setLineDash([]);

              // Fill solid background color first (under hatch lines)
              if (slabPreviewHatch.backgroundColor) {
                ctx.fillStyle = slabPreviewHatch.backgroundColor;
                ctx.fill();
              }

              const sMinX = Math.min(...allSlabPts.map(p => p.x));
              const sMinY = Math.min(...allSlabPts.map(p => p.y));
              const sMaxX = Math.max(...allSlabPts.map(p => p.x));
              const sMaxY = Math.max(...allSlabPts.map(p => p.y));
              const sSpacing = slabPreviewHatch.hatchSpacing || 100;
              const sHatchColor = slabPreviewHatch.hatchColor || (ctx.strokeStyle as string);
              ctx.strokeStyle = sHatchColor;

              const slabPreviewPattern = slabPreviewHatch.hatchPatternId ? this.getPatternById(slabPreviewHatch.hatchPatternId) : undefined;
              if (slabPreviewPattern && slabPreviewPattern.lineFamilies.length > 0) {
                const sPScale = sSpacing / 10;
                // Special case: insulation patterns get zigzag rendering (NEN standard)
                if (slabPreviewHatch.hatchPatternId === 'nen47-isolatie' || slabPreviewHatch.hatchPatternId === 'insulation') {
                  this.drawInsulationZigzag(sMinX, sMinY, sMaxX, sMaxY, sPScale, 0, sHatchColor, slabSW);
                } else {
                  this.drawCustomPatternLines(slabPreviewPattern.lineFamilies, sMinX, sMinY, sMaxX, sMaxY, sPScale, 0, sHatchColor, slabSW);
                }
              } else if (slabPreviewPattern && slabPreviewPattern.lineFamilies.length === 0) {
                // Solid fill
                ctx.fillStyle = sHatchColor;
                ctx.fill();
              } else if (slabPreviewHatch.hatchType === 'solid') {
                ctx.fillStyle = 'rgba(255, 255, 255, 0.15)';
                ctx.fill();
              } else {
                const sAngle = slabPreviewHatch.hatchAngle || 45;
                if (slabPreviewHatch.hatchType === 'diagonal') {
                  this.drawLineFamilySimple(sAngle, sSpacing, sMinX, sMinY, sMaxX, sMaxY);
                } else if (slabPreviewHatch.hatchType === 'crosshatch') {
                  this.drawLineFamilySimple(sAngle, sSpacing, sMinX, sMinY, sMaxX, sMaxY);
                  this.drawLineFamilySimple(sAngle + 90, sSpacing, sMinX, sMinY, sMaxX, sMaxY);
                } else if (slabPreviewHatch.hatchType === 'horizontal') {
                  this.drawLineFamilySimple(0, sSpacing, sMinX, sMinY, sMaxX, sMaxY);
                } else if (slabPreviewHatch.hatchType === 'vertical') {
                  this.drawLineFamilySimple(90, sSpacing, sMinX, sMinY, sMaxX, sMaxY);
                }
              }
              ctx.restore();
            }
          }

          for (const pt of slabPts) {
            ctx.beginPath();
            ctx.arc(pt.x, pt.y, 3 / this._currentZoom, 0, Math.PI * 2);
            ctx.fillStyle = COLORS.commandPreview;
            ctx.fill();
          }
        }
        break;
      }

      case 'plate-system': {
        // Draw plate system preview (polygon outline + joist lines)
        // Supports bulge/arc segments on confirmed edges and a live arc preview on the current edge
        const psPts = preview.points;
        const psCurrent = preview.currentPoint;
        const psBulges = preview.bulges;
        const psCurrentBulge = preview.currentBulge ?? 0;
        const psArcThrough = preview.arcThroughPoint;
        const allPsPts = [...psPts, psCurrent];

        // Helper to build the preview contour path with bulge arcs
        const buildPsPreviewPath = () => {
          ctx.moveTo(allPsPts[0].x, allPsPts[0].y);
          for (let si = 0; si < allPsPts.length; si++) {
            const sj = (si + 1) % allPsPts.length;
            // Determine bulge for this segment
            let b = 0;
            if (si < psPts.length - 1) {
              // Confirmed segment between two placed vertices
              b = psBulges?.[si] ?? 0;
            } else if (si === psPts.length - 1 && si < allPsPts.length - 1) {
              // Live edge: from last placed vertex to current mouse position
              b = psCurrentBulge;
            }
            // Closing segment back to first vertex (sj === 0 when si === allPsPts.length - 1)
            // stays straight (b = 0)

            if (b !== 0 && Math.abs(b) > 0.0001) {
              const arc = bulgeToArc(allPsPts[si], allPsPts[sj], b);
              ctx.arc(arc.center.x, arc.center.y, arc.radius, arc.startAngle, arc.endAngle, arc.clockwise);
            } else if (sj !== 0) {
              ctx.lineTo(allPsPts[sj].x, allPsPts[sj].y);
            } else {
              ctx.closePath();
            }
          }
        };

        if (allPsPts.length >= 2) {
          // Draw the contour polygon outline (with arc segments)
          ctx.beginPath();
          buildPsPreviewPath();
          ctx.stroke();

          // Light fill
          if (allPsPts.length >= 3) {
            ctx.save();
            ctx.fillStyle = 'rgba(253, 244, 227, 0.15)';
            ctx.beginPath();
            buildPsPreviewPath();
            ctx.fill();

            // Clip to contour and draw joist preview lines
            ctx.beginPath();
            buildPsPreviewPath();
            ctx.clip();

            const psDir = preview.mainProfile.direction;
            const psSpacing = preview.mainProfile.spacing;
            const psCosD = Math.cos(psDir);
            const psSinD = Math.sin(psDir);

            // Get bounding box
            let psMinX = Infinity, psMinY = Infinity, psMaxX = -Infinity, psMaxY = -Infinity;
            for (const p of allPsPts) {
              if (p.x < psMinX) psMinX = p.x;
              if (p.y < psMinY) psMinY = p.y;
              if (p.x > psMaxX) psMaxX = p.x;
              if (p.y > psMaxY) psMaxY = p.y;
            }

            const psDiag = Math.sqrt((psMaxX - psMinX) ** 2 + (psMaxY - psMinY) ** 2);
            const psCx = (psMinX + psMaxX) / 2;
            const psCy = (psMinY + psMaxY) / 2;
            const psNorm = { x: -psSinD, y: psCosD };
            const psNumLines = Math.ceil(psDiag / psSpacing) + 1;

            ctx.strokeStyle = 'rgba(200, 160, 80, 0.6)';
            ctx.lineWidth = preview.mainProfile.width * 0.15;
            ctx.setLineDash([]);

            for (let i = -psNumLines; i <= psNumLines; i++) {
              const offset = i * psSpacing;
              const ox = psCx + psNorm.x * offset;
              const oy = psCy + psNorm.y * offset;
              ctx.beginPath();
              ctx.moveTo(ox - psCosD * psDiag, oy - psSinD * psDiag);
              ctx.lineTo(ox + psCosD * psDiag, oy + psSinD * psDiag);
              ctx.stroke();
            }
            ctx.restore();
          }

          // Closing line to first point (dashed)
          if (psPts.length >= 2) {
            ctx.save();
            ctx.setLineDash([4, 4]);
            ctx.globalAlpha = 0.4;
            ctx.beginPath();
            ctx.moveTo(psCurrent.x, psCurrent.y);
            ctx.lineTo(psPts[0].x, psPts[0].y);
            ctx.stroke();
            ctx.restore();
          }

          // Draw arc through-point indicator (small diamond)
          if (psArcThrough) {
            const sz = 4 / this._currentZoom;
            ctx.save();
            ctx.fillStyle = '#ff8800';
            ctx.beginPath();
            ctx.moveTo(psArcThrough.x, psArcThrough.y - sz);
            ctx.lineTo(psArcThrough.x + sz, psArcThrough.y);
            ctx.lineTo(psArcThrough.x, psArcThrough.y + sz);
            ctx.lineTo(psArcThrough.x - sz, psArcThrough.y);
            ctx.closePath();
            ctx.fill();
            ctx.restore();
          }

          // Draw vertex dots
          for (const pt of psPts) {
            ctx.beginPath();
            ctx.arc(pt.x, pt.y, 3 / this._currentZoom, 0, Math.PI * 2);
            ctx.fillStyle = COLORS.commandPreview;
            ctx.fill();
          }
        }
        break;
      }

      case 'section-callout': {
        // Draw section callout preview: cut line with dash pattern + text labels at endpoints + direction arrows
        const { start: scStart, end: scEnd, label: scLabel, bubbleRadius: scRadiusRaw, flipDirection: scFlip } = preview;
        const scScaleFactor = LINE_DASH_REFERENCE_SCALE / this.drawingScale;
        const scRadius = scRadiusRaw * scScaleFactor;
        const scAngle = Math.atan2(scEnd.y - scStart.y, scEnd.x - scStart.x);
        const scDx = Math.cos(scAngle);
        const scDy = Math.sin(scAngle);

        // Perpendicular direction for arrows (viewing direction, negated so default points correct way)
        const perpSign = scFlip ? 1 : -1;
        const scPerpX = -scDy * perpSign;
        const scPerpY = scDx * perpSign;

        // Draw view depth area preview
        const scViewDepth = preview.viewDepth ?? 5000;
        if (scViewDepth > 0) {
          ctx.save();
          ctx.beginPath();
          ctx.moveTo(scStart.x, scStart.y);
          ctx.lineTo(scEnd.x, scEnd.y);
          ctx.lineTo(scEnd.x + scPerpX * scViewDepth, scEnd.y + scPerpY * scViewDepth);
          ctx.lineTo(scStart.x + scPerpX * scViewDepth, scStart.y + scPerpY * scViewDepth);
          ctx.closePath();
          ctx.fillStyle = 'rgba(100, 180, 255, 0.08)';
          ctx.fill();
          ctx.strokeStyle = 'rgba(100, 180, 255, 0.4)';
          ctx.lineWidth = ctx.lineWidth || 1;
          ctx.setLineDash([scRadius * 0.15, scRadius * 0.1]);
          ctx.beginPath();
          ctx.moveTo(scStart.x + scPerpX * scViewDepth, scStart.y + scPerpY * scViewDepth);
          ctx.lineTo(scEnd.x + scPerpX * scViewDepth, scEnd.y + scPerpY * scViewDepth);
          ctx.stroke();
          ctx.setLineDash([]);
          ctx.restore();
        }

        // Draw the cut line: thick dash pattern (long-dash, short-dash, long-dash)
        ctx.save();
        ctx.lineWidth = ctx.lineWidth * 2;
        ctx.setLineDash([scRadius * 0.3, scRadius * 0.15, scRadius * 0.05, scRadius * 0.15]);
        ctx.beginPath();
        ctx.moveTo(scStart.x, scStart.y);
        ctx.lineTo(scEnd.x, scEnd.y);
        ctx.stroke();
        ctx.restore();

        // Draw simple text labels at endpoints (NO circles/bubbles)
        ctx.setLineDash([]);
        const scLabelOffset = scRadius * 1.2;
        const drawSCLabel = (px: number, py: number, offsetDx: number, offsetDy: number) => {
          const lx = px + offsetDx * scLabelOffset;
          const ly = py + offsetDy * scLabelOffset;
          const fSize = scRadius * 1.7;
          ctx.save();
          ctx.fillStyle = strokeColor;
          ctx.font = `bold ${fSize}px ${CAD_DEFAULT_FONT}`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(scLabel, lx, ly);
          ctx.restore();
        };

        // Labels at both endpoints (offset outward along line direction)
        drawSCLabel(scStart.x, scStart.y, -scDx, -scDy);
        drawSCLabel(scEnd.x, scEnd.y, scDx, scDy);

        // Direction arrows at each endpoint - short perpendicular lines showing viewing direction
        const arrowLen = scRadius * 1.5;
        ctx.lineWidth = ctx.lineWidth || 1;
        ctx.beginPath();
        // Arrow at start endpoint
        ctx.moveTo(scStart.x, scStart.y);
        ctx.lineTo(scStart.x + scPerpX * arrowLen, scStart.y + scPerpY * arrowLen);
        // Arrow at end endpoint
        ctx.moveTo(scEnd.x, scEnd.y);
        ctx.lineTo(scEnd.x + scPerpX * arrowLen, scEnd.y + scPerpY * arrowLen);
        ctx.stroke();

        // Draw arrowheads on the perpendicular lines
        const arrowHeadSize = scRadius * 0.5;
        const drawArrowHead = (tipX: number, tipY: number, dirX: number, dirY: number) => {
          ctx.beginPath();
          ctx.moveTo(tipX, tipY);
          ctx.lineTo(tipX - dirX * arrowHeadSize + dirY * arrowHeadSize * 0.4, tipY - dirY * arrowHeadSize - dirX * arrowHeadSize * 0.4);
          ctx.lineTo(tipX - dirX * arrowHeadSize - dirY * arrowHeadSize * 0.4, tipY - dirY * arrowHeadSize + dirX * arrowHeadSize * 0.4);
          ctx.closePath();
          ctx.fillStyle = strokeColor;
          ctx.fill();
        };

        drawArrowHead(scStart.x + scPerpX * arrowLen, scStart.y + scPerpY * arrowLen, scPerpX, scPerpY);
        drawArrowHead(scEnd.x + scPerpX * arrowLen, scEnd.y + scPerpY * arrowLen, scPerpX, scPerpY);

        break;
      }

      case 'leader': {
        // Draw leader preview: arrow tip → diagonal line → landing line under text area
        if (preview.points.length > 0) {
          const arrowTip = preview.points[0];
          const textPos = preview.currentPoint;

          // Scale sizes proportionally to annotation text (paper mm → drawing units)
          const previewScaleFactor = 1 / this.drawingScale;
          const previewLineWeight = 0.18 * previewScaleFactor;
          const previewArrowSize = 2.5 * previewScaleFactor;
          const previewLandingWidth = 7.5 * previewScaleFactor; // 3x default font size
          const previewTextSize = 2.5 * previewScaleFactor;

          ctx.lineWidth = previewLineWeight;

          // Draw diagonal line from text area to arrow tip
          ctx.beginPath();
          ctx.moveTo(textPos.x, textPos.y);
          ctx.lineTo(arrowTip.x, arrowTip.y);
          ctx.stroke();

          // Draw filled arrow at the arrow tip
          const arrowAngle = Math.atan2(arrowTip.y - textPos.y, arrowTip.x - textPos.x);
          ctx.beginPath();
          ctx.moveTo(arrowTip.x, arrowTip.y);
          ctx.lineTo(
            arrowTip.x - previewArrowSize * Math.cos(arrowAngle - 0.35),
            arrowTip.y - previewArrowSize * Math.sin(arrowAngle - 0.35)
          );
          ctx.lineTo(
            arrowTip.x - previewArrowSize * Math.cos(arrowAngle + 0.35),
            arrowTip.y - previewArrowSize * Math.sin(arrowAngle + 0.35)
          );
          ctx.closePath();
          ctx.fill();

          // Draw horizontal landing line (text underline placeholder)
          ctx.beginPath();
          ctx.moveTo(textPos.x, textPos.y);
          ctx.lineTo(textPos.x + previewLandingWidth, textPos.y);
          ctx.stroke();

          // Draw "T" text indicator above the landing line
          ctx.save();
          ctx.font = `${previewTextSize}px sans-serif`;
          ctx.fillText('T', textPos.x + previewTextSize * 0.2, textPos.y - previewTextSize * 0.2);
          ctx.restore();
        }
        break;
      }

      case 'spot-elevation': {
        // Draw spot elevation preview: cross/circle marker + elevation text
        const { position: sePos, elevation: seElev, labelPosition: seLabelPos, showLeader: seShowLeader } = preview;
        const seScaleFactor = LINE_DASH_REFERENCE_SCALE / this.drawingScale;
        const seMarkerSize = 150 * seScaleFactor;
        const seFontSize = 250 * seScaleFactor;

        // Draw cross marker
        ctx.beginPath();
        ctx.moveTo(sePos.x - seMarkerSize, sePos.y);
        ctx.lineTo(sePos.x + seMarkerSize, sePos.y);
        ctx.moveTo(sePos.x, sePos.y - seMarkerSize);
        ctx.lineTo(sePos.x, sePos.y + seMarkerSize);
        ctx.stroke();
        // Draw circle around cross
        ctx.beginPath();
        ctx.arc(sePos.x, sePos.y, seMarkerSize * 0.8, 0, Math.PI * 2);
        ctx.stroke();
        // Draw leader line
        if (seShowLeader) {
          ctx.beginPath();
          ctx.moveTo(sePos.x, sePos.y);
          ctx.lineTo(seLabelPos.x, seLabelPos.y);
          ctx.stroke();
        }
        // Draw elevation text
        const seLabel = formatElevation(seElev, this.unitSettings.numberFormat, 3);
        ctx.save();
        ctx.fillStyle = strokeColor;
        ctx.font = `${seFontSize}px ${CAD_DEFAULT_FONT}`;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'bottom';
        ctx.fillText(seLabel, seLabelPos.x + seMarkerSize * 0.3, seLabelPos.y);
        ctx.restore();
        break;
      }

      case 'modifyPreview':
        // Draw ghost shapes with higher visibility
        ctx.save();
        ctx.globalAlpha = 0.75;
        ctx.setLineDash([8, 4]);
        for (const shape of preview.shapes) {
          this.drawShape(shape, false, false, invertColors);
        }
        ctx.restore();
        ctx.setLineDash([]);
        // Draw guide line from base point to current point
        if (preview.basePoint && preview.currentPoint) {
          const bp = preview.basePoint;
          const cp = preview.currentPoint;
          ctx.save();
          ctx.strokeStyle = '#00ccff';
          ctx.lineWidth = 1;
          ctx.setLineDash([6, 3]);
          ctx.beginPath();
          ctx.moveTo(bp.x, bp.y);
          ctx.lineTo(cp.x, cp.y);
          ctx.stroke();
          // Base point crosshair
          const ch = 6 / (viewport?.zoom ?? 1);
          ctx.setLineDash([]);
          ctx.beginPath();
          ctx.moveTo(bp.x - ch, bp.y); ctx.lineTo(bp.x + ch, bp.y);
          ctx.moveTo(bp.x, bp.y - ch); ctx.lineTo(bp.x, bp.y + ch);
          ctx.stroke();
          // Distance label
          const dist = Math.hypot(cp.x - bp.x, cp.y - bp.y);
          if (dist > 0.01) {
            const midX = (bp.x + cp.x) / 2;
            const midY = (bp.y + cp.y) / 2;
            const fontSize = 12 / (viewport?.zoom ?? 1);
            ctx.font = `${fontSize}px sans-serif`;
            ctx.fillStyle = '#00ccff';
            ctx.fillText(formatNumber(dist, 1, this.unitSettings.numberFormat), midX + fontSize * 0.3, midY - fontSize * 0.3);
          }
          ctx.restore();
        }
        break;

      case 'mirrorAxis':
        // Draw ghost shapes
        ctx.save();
        ctx.globalAlpha = 0.5;
        ctx.setLineDash([6, 4]);
        for (const shape of preview.shapes) {
          this.drawShape(shape, false, false, false);
        }
        ctx.restore();
        // Draw mirror axis line
        ctx.save();
        ctx.strokeStyle = '#00ff00';
        ctx.lineWidth = 1;
        ctx.setLineDash([8, 4]);
        ctx.beginPath();
        ctx.moveTo(preview.start.x, preview.start.y);
        ctx.lineTo(preview.end.x, preview.end.y);
        ctx.stroke();
        ctx.restore();
        ctx.setLineDash([]);
        break;

      case 'rotateGuide': {
        // Draw ghost shapes
        if (preview.shapes.length > 0) {
          ctx.save();
          ctx.globalAlpha = 0.5;
          ctx.setLineDash([6, 4]);
          for (const shape of preview.shapes) {
            this.drawShape(shape, false, false, false);
          }
          ctx.restore();
        }

        const { center, startRay, endRay, angle } = preview;

        // Draw center crosshair
        ctx.save();
        ctx.strokeStyle = '#00ff00';
        ctx.lineWidth = 1;
        const cross = 6 / (viewport?.zoom || 1);
        ctx.beginPath();
        ctx.moveTo(center.x - cross, center.y);
        ctx.lineTo(center.x + cross, center.y);
        ctx.moveTo(center.x, center.y - cross);
        ctx.lineTo(center.x, center.y + cross);
        ctx.stroke();
        ctx.restore();

        // Draw start ray (fixed, if set)
        if (startRay) {
          ctx.save();
          ctx.strokeStyle = '#00ff00';
          ctx.lineWidth = 1;
          ctx.setLineDash([8, 4]);
          ctx.beginPath();
          ctx.moveTo(center.x, center.y);
          ctx.lineTo(startRay.x, startRay.y);
          ctx.stroke();
          ctx.restore();
        }

        // Draw current ray
        ctx.save();
        ctx.strokeStyle = '#00ccff';
        ctx.lineWidth = 1;
        ctx.setLineDash([8, 4]);
        ctx.beginPath();
        ctx.moveTo(center.x, center.y);
        ctx.lineTo(endRay.x, endRay.y);
        ctx.stroke();
        ctx.restore();

        // Draw angle arc between start and end rays
        if (startRay && angle !== undefined) {
          const startAngle = Math.atan2(startRay.y - center.y, startRay.x - center.x);
          const endAngle = Math.atan2(endRay.y - center.y, endRay.x - center.x);
          const arcRadius = Math.min(
            30 / (viewport?.zoom || 1),
            Math.hypot(startRay.x - center.x, startRay.y - center.y) * 0.4,
            Math.hypot(endRay.x - center.x, endRay.y - center.y) * 0.4
          );

          ctx.save();
          ctx.strokeStyle = '#ffcc00';
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.arc(center.x, center.y, arcRadius, startAngle, endAngle, angle < 0);
          ctx.stroke();

          // Draw angle text
          const midAngle = (startAngle + endAngle) / 2;
          const textRadius = arcRadius + 10 / (viewport?.zoom || 1);
          const textX = center.x + textRadius * Math.cos(midAngle);
          const textY = center.y + textRadius * Math.sin(midAngle);
          const fontSize = 11 / (viewport?.zoom || 1);
          ctx.fillStyle = '#ffcc00';
          ctx.font = `${fontSize}px monospace`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          let displayAngle = angle % 360;
          if (displayAngle > 180) displayAngle -= 360;
          if (displayAngle < -180) displayAngle += 360;
          ctx.fillText(`${formatNumber(displayAngle, 1, this.unitSettings.numberFormat)}\u00B0`, textX, textY);
          ctx.restore();
        }

        ctx.setLineDash([]);
        break;
      }

      case 'scaleGuide': {
        const { origin, refPoint, currentPoint, factor, shapes } = preview;
        const zoom = viewport?.zoom || 1;

        // Draw ghost shapes
        if (shapes.length > 0) {
          ctx.save();
          ctx.globalAlpha = 0.5;
          ctx.setLineDash([6, 4]);
          for (const shape of shapes) {
            this.drawShape(shape, false, false, false);
          }
          ctx.restore();
        }

        // Draw origin crosshair
        ctx.save();
        ctx.strokeStyle = '#00ff00';
        ctx.lineWidth = 1;
        const cross = 6 / zoom;
        ctx.beginPath();
        ctx.moveTo(origin.x - cross, origin.y);
        ctx.lineTo(origin.x + cross, origin.y);
        ctx.moveTo(origin.x, origin.y - cross);
        ctx.lineTo(origin.x, origin.y + cross);
        ctx.stroke();
        ctx.restore();

        // Draw reference line (fixed, green dashed)
        if (refPoint) {
          ctx.save();
          ctx.strokeStyle = '#00ff00';
          ctx.lineWidth = 1;
          ctx.setLineDash([8, 4]);
          ctx.beginPath();
          ctx.moveTo(origin.x, origin.y);
          ctx.lineTo(refPoint.x, refPoint.y);
          ctx.stroke();
          ctx.restore();

          // Reference distance label
          const refDist = Math.hypot(refPoint.x - origin.x, refPoint.y - origin.y);
          const refMidX = (origin.x + refPoint.x) / 2;
          const refMidY = (origin.y + refPoint.y) / 2;
          const fontSize = 11 / zoom;
          ctx.save();
          ctx.fillStyle = '#00ff00';
          ctx.font = `${fontSize}px monospace`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'bottom';
          ctx.fillText(formatNumber(refDist, 1, this.unitSettings.numberFormat), refMidX, refMidY - 4 / zoom);
          ctx.restore();
        }

        // Draw current line (cyan dashed)
        ctx.save();
        ctx.strokeStyle = '#00ccff';
        ctx.lineWidth = 1;
        ctx.setLineDash([8, 4]);
        ctx.beginPath();
        ctx.moveTo(origin.x, origin.y);
        ctx.lineTo(currentPoint.x, currentPoint.y);
        ctx.stroke();
        ctx.restore();

        // Current distance label
        const curDist = Math.hypot(currentPoint.x - origin.x, currentPoint.y - origin.y);
        const curMidX = (origin.x + currentPoint.x) / 2;
        const curMidY = (origin.y + currentPoint.y) / 2;
        const fontSize2 = 11 / zoom;
        ctx.save();
        ctx.fillStyle = '#00ccff';
        ctx.font = `${fontSize2}px monospace`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.fillText(formatNumber(curDist, 1, this.unitSettings.numberFormat), curMidX, curMidY + 4 / zoom);
        ctx.restore();

        // Scale factor label near origin
        if (factor !== undefined) {
          const factorFontSize = 12 / zoom;
          ctx.save();
          ctx.fillStyle = '#ffcc00';
          ctx.font = `bold ${factorFontSize}px monospace`;
          ctx.textAlign = 'left';
          ctx.textBaseline = 'bottom';
          ctx.fillText(`\u00D7${formatNumber(factor, 3, this.unitSettings.numberFormat)}`, origin.x + 8 / zoom, origin.y - 8 / zoom);
          ctx.restore();
        }

        ctx.setLineDash([]);
        break;
      }

      case 'elasticBox': {
        // Draw green dashed selection box for elastic/stretch tool
        const { start, end } = preview;
        const x = Math.min(start.x, end.x);
        const y = Math.min(start.y, end.y);
        const w = Math.abs(end.x - start.x);
        const h = Math.abs(end.y - start.y);

        ctx.save();
        // Green fill (semi-transparent)
        ctx.fillStyle = 'rgba(0, 200, 0, 0.12)';
        ctx.fillRect(x, y, w, h);

        // Green dashed border
        ctx.strokeStyle = 'rgba(0, 200, 0, 0.85)';
        ctx.lineWidth = 1.5 / (viewport?.zoom || 1);
        ctx.setLineDash([8 / (viewport?.zoom || 1), 4 / (viewport?.zoom || 1)]);
        ctx.strokeRect(x, y, w, h);

        ctx.setLineDash([]);
        ctx.restore();
        break;
      }
    }
  }

  /**
   * Draw a temporary dimension on a preview line.
   * Includes extension lines, an offset parallel dimension line with tick marks,
   * and centered text with a gap in the dimension line.
   */
  private drawPreviewDimension(start: { x: number; y: number }, end: { x: number; y: number }, viewport: Viewport, outwardDir?: { x: number; y: number }): void {
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const length = Math.hypot(dx, dy);

    // Don't show dimension for very short lines
    if (length < 0.5) return;

    const ctx = this.ctx;
    const zoom = viewport.zoom;

    // Line angle and perpendicular direction
    const angle = Math.atan2(dy, dx);
    let perpX = -Math.sin(angle);
    let perpY = Math.cos(angle);
    if (outwardDir) {
      // Use caller-specified outward direction: flip perpendicular if it points away from desired side
      const dot = perpX * outwardDir.x + perpY * outwardDir.y;
      if (dot < 0) {
        perpX = -perpX;
        perpY = -perpY;
      }
    } else {
      // Default: ensure dimension appears above the line (negative Y in screen coords)
      if (perpY > 0 || (perpY === 0 && perpX < 0)) {
        perpX = -perpX;
        perpY = -perpY;
      }
    }

    // All sizes scale inversely with zoom so they stay consistent on screen
    const dimOffset = 20 / zoom;        // Distance from drawn line to dimension line
    const extGap = 3 / zoom;            // Gap between drawn line and start of extension line
    const extOvershoot = 4 / zoom;      // How far extension line extends past dimension line
    const tickSize = 5 / zoom;          // Length of tick mark
    const fontSize = 11 / zoom;
    const textPadding = 3 / zoom;

    // --- Extension line endpoints ---
    // Extension lines run perpendicular from near the drawn line to past the dimension line
    const extStartBottom = {
      x: start.x + perpX * extGap,
      y: start.y + perpY * extGap,
    };
    const extStartTop = {
      x: start.x + perpX * (dimOffset + extOvershoot),
      y: start.y + perpY * (dimOffset + extOvershoot),
    };
    const extEndBottom = {
      x: end.x + perpX * extGap,
      y: end.y + perpY * extGap,
    };
    const extEndTop = {
      x: end.x + perpX * (dimOffset + extOvershoot),
      y: end.y + perpY * (dimOffset + extOvershoot),
    };

    // --- Dimension line endpoints (parallel to drawn line, offset by dimOffset) ---
    const dimStart = {
      x: start.x + perpX * dimOffset,
      y: start.y + perpY * dimOffset,
    };
    const dimEnd = {
      x: end.x + perpX * dimOffset,
      y: end.y + perpY * dimOffset,
    };
    const dimMid = {
      x: (dimStart.x + dimEnd.x) / 2,
      y: (dimStart.y + dimEnd.y) / 2,
    };

    // --- Prepare text metrics for gap calculation ---
    const displayText = formatNumber(length, 2, this.unitSettings.numberFormat);
    ctx.font = `${fontSize}px ${CAD_DEFAULT_FONT}`;
    const textMetrics = ctx.measureText(displayText);
    const textGap = textMetrics.width + textPadding * 2;
    const halfGap = textGap / 2;

    // Gap start/end points along the dimension line
    const gapStart = {
      x: dimMid.x - Math.cos(angle) * halfGap,
      y: dimMid.y - Math.sin(angle) * halfGap,
    };
    const gapEnd = {
      x: dimMid.x + Math.cos(angle) * halfGap,
      y: dimMid.y + Math.sin(angle) * halfGap,
    };

    ctx.save();
    ctx.strokeStyle = '#00bfff';
    ctx.fillStyle = '#00bfff';
    ctx.lineWidth = 1 / zoom;
    ctx.setLineDash([]);

    // --- Draw extension lines ---
    ctx.beginPath();
    ctx.moveTo(extStartBottom.x, extStartBottom.y);
    ctx.lineTo(extStartTop.x, extStartTop.y);
    ctx.moveTo(extEndBottom.x, extEndBottom.y);
    ctx.lineTo(extEndTop.x, extEndTop.y);
    ctx.stroke();

    // --- Draw dimension line (two segments with text gap) ---
    ctx.beginPath();
    ctx.moveTo(dimStart.x, dimStart.y);
    ctx.lineTo(gapStart.x, gapStart.y);
    ctx.moveTo(gapEnd.x, gapEnd.y);
    ctx.lineTo(dimEnd.x, dimEnd.y);
    ctx.stroke();

    // --- Draw tick marks (45° diagonal) ---
    const tickAngle = angle + Math.PI / 4; // 45° from the dimension line
    const halfTick = tickSize * 0.7;

    // Tick at dimension start
    ctx.beginPath();
    ctx.moveTo(
      dimStart.x - Math.cos(tickAngle) * halfTick,
      dimStart.y - Math.sin(tickAngle) * halfTick
    );
    ctx.lineTo(
      dimStart.x + Math.cos(tickAngle) * halfTick,
      dimStart.y + Math.sin(tickAngle) * halfTick
    );
    ctx.stroke();

    // Tick at dimension end
    ctx.beginPath();
    ctx.moveTo(
      dimEnd.x - Math.cos(tickAngle) * halfTick,
      dimEnd.y - Math.sin(tickAngle) * halfTick
    );
    ctx.lineTo(
      dimEnd.x + Math.cos(tickAngle) * halfTick,
      dimEnd.y + Math.sin(tickAngle) * halfTick
    );
    ctx.stroke();

    // --- Draw dimension text centered in the gap ---
    ctx.save();
    ctx.translate(dimMid.x, dimMid.y);

    // Rotate text to align with the line, but keep readable (not upside down)
    let textAngle = angle;
    if (textAngle > Math.PI / 2) textAngle -= Math.PI;
    if (textAngle < -Math.PI / 2) textAngle += Math.PI;
    ctx.rotate(textAngle);

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // Background for readability
    ctx.fillStyle = 'rgba(26, 26, 46, 0.9)';
    ctx.fillRect(
      -textMetrics.width / 2 - textPadding,
      -fontSize / 2 - textPadding / 2,
      textMetrics.width + textPadding * 2,
      fontSize + textPadding
    );

    // Text
    ctx.fillStyle = '#00bfff';
    ctx.fillText(displayText, 0, 0);

    ctx.restore();
    ctx.restore();
  }

  // Private shape drawing methods
  private drawLine(shape: Shape): void {
    if (shape.type !== 'line') return;
    const ctx = this.ctx;
    ctx.beginPath();
    ctx.moveTo(shape.start.x, shape.start.y);
    ctx.lineTo(shape.end.x, shape.end.y);
    ctx.stroke();
  }

  private drawRectangle(shape: Shape): void {
    if (shape.type !== 'rectangle') return;
    const ctx = this.ctx;
    ctx.save();

    if (shape.rotation) {
      ctx.translate(shape.topLeft.x, shape.topLeft.y);
      ctx.rotate(shape.rotation);
      ctx.translate(-shape.topLeft.x, -shape.topLeft.y);
    }

    const r = shape.cornerRadius ?? 0;
    ctx.beginPath();
    if (r > 0) {
      // Clamp radius so it doesn't exceed half the smallest side
      const maxR = Math.min(r, shape.width / 2, shape.height / 2);
      const x = shape.topLeft.x;
      const y = shape.topLeft.y;
      const w = shape.width;
      const h = shape.height;
      ctx.moveTo(x + maxR, y);
      ctx.lineTo(x + w - maxR, y);
      ctx.arcTo(x + w, y, x + w, y + maxR, maxR);
      ctx.lineTo(x + w, y + h - maxR);
      ctx.arcTo(x + w, y + h, x + w - maxR, y + h, maxR);
      ctx.lineTo(x + maxR, y + h);
      ctx.arcTo(x, y + h, x, y + h - maxR, maxR);
      ctx.lineTo(x, y + maxR);
      ctx.arcTo(x, y, x + maxR, y, maxR);
      ctx.closePath();
    } else {
      ctx.rect(shape.topLeft.x, shape.topLeft.y, shape.width, shape.height);
    }

    if (shape.style.fillColor) {
      ctx.fill();
    }
    ctx.stroke();

    ctx.restore();
  }

  private drawCircle(shape: Shape, isSelected: boolean = false): void {
    if (shape.type !== 'circle') return;
    const ctx = this.ctx;
    ctx.beginPath();
    ctx.arc(shape.center.x, shape.center.y, shape.radius, 0, Math.PI * 2);

    if (shape.style.fillColor) {
      ctx.fill();
    }
    ctx.stroke();

    if (isSelected && shape.showCenterMark !== false) {
      this.drawCenterMark(ctx, shape.center, shape.radius);
    }
  }

  private drawArc(shape: Shape, isSelected: boolean = false): void {
    if (shape.type !== 'arc') return;
    const ctx = this.ctx;
    ctx.beginPath();
    ctx.arc(shape.center.x, shape.center.y, shape.radius, shape.startAngle, shape.endAngle);
    ctx.stroke();

    if (isSelected && shape.showCenterMark !== false) {
      this.drawCenterMark(ctx, shape.center, shape.radius);
    }
  }

  private drawCenterMark(ctx: CanvasRenderingContext2D, center: { x: number; y: number }, radius: number): void {
    ctx.save();
    ctx.setLineDash([]);
    ctx.lineWidth = 1 / this._currentZoom;
    ctx.beginPath();
    ctx.moveTo(center.x - radius, center.y);
    ctx.lineTo(center.x + radius, center.y);
    ctx.moveTo(center.x, center.y - radius);
    ctx.lineTo(center.x, center.y + radius);
    ctx.stroke();
    ctx.restore();
  }

  private drawPolyline(shape: Shape): void {
    if (shape.type !== 'polyline') return;
    const ctx = this.ctx;
    const { points, closed, bulge } = shape;

    if (points.length < 2) return;

    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);

    for (let i = 0; i < points.length - 1; i++) {
      const b = bulge?.[i] ?? 0;
      if (b !== 0) {
        const arc = bulgeToArc(points[i], points[i + 1], b);
        ctx.arc(arc.center.x, arc.center.y, arc.radius, arc.startAngle, arc.endAngle, arc.clockwise);
      } else {
        ctx.lineTo(points[i + 1].x, points[i + 1].y);
      }
    }

    if (closed) {
      const lastB = bulge?.[points.length - 1] ?? 0;
      if (lastB !== 0) {
        const arc = bulgeToArc(points[points.length - 1], points[0], lastB);
        ctx.arc(arc.center.x, arc.center.y, arc.radius, arc.startAngle, arc.endAngle, arc.clockwise);
      } else {
        ctx.closePath();
      }
      if (shape.style.fillColor) {
        ctx.fill();
      }
    }

    ctx.stroke();
  }

  private drawSpline(shape: Shape): void {
    if (shape.type !== 'spline') return;
    if (shape.points.length < 2) return;
    const ctx = this.ctx;
    drawSplinePath(ctx, shape.points);
    ctx.stroke();
  }

  private drawEllipse(shape: Shape): void {
    if (shape.type !== 'ellipse') return;
    const ctx = this.ctx;
    const startAngle = shape.startAngle ?? 0;
    const endAngle = shape.endAngle ?? Math.PI * 2;
    const isPartial = shape.startAngle !== undefined && shape.endAngle !== undefined;
    ctx.beginPath();
    ctx.ellipse(shape.center.x, shape.center.y, shape.radiusX, shape.radiusY, shape.rotation, startAngle, isPartial ? endAngle : Math.PI * 2);

    if (shape.style.fillColor && !isPartial) {
      ctx.fill();
    }
    ctx.stroke();
  }

  private drawText(shape: Shape, isSelected: boolean, invertColors: boolean = false): void {
    if (shape.type !== 'text') return;
    const ctx = this.ctx;

    const {
      position,
      text: storedText,
      fontSize,
      fontFamily,
      rotation,
      alignment,
      verticalAlignment,
      bold,
      italic,
      underline,
      strikethrough = false,
      color,
      lineHeight = 1.2,
      isModelText = false,
      backgroundMask = false,
      backgroundColor = '#1a1a2e',
      backgroundPadding = 0.5,
      // Advanced formatting
      letterSpacing = 1,
      widthFactor = 1,
      obliqueAngle = 0,
      textCase = 'none',
      paragraphSpacing = 0,
    } = shape;

    // For linked labels: resolve text from linked element at render time
    let text = storedText;
    if (shape.linkedShapeId) {
      const linkedShape = this.shapesLookup.get(shape.linkedShapeId);
      if (linkedShape) {
        if (shape.labelTemplate) {
          // Use template-based resolution: {Name}, {Area}, {Thickness}, etc.
          text = resolveTemplate(shape.labelTemplate, linkedShape, this.wallTypes, this.unitSettings);
        } else {
          text = getElementLabelText(linkedShape, this.wallTypes, this.unitSettings);
        }
      }
    }

    // =========================================================================
    // Span arrow rendering (overspanningspijl) for slab labels
    // Draws a double-headed arrow with text centered in the middle.
    // =========================================================================
    if (shape.spanArrow && shape.spanDirection !== undefined && shape.spanLength) {
      this.drawSpanArrow(shape, text, invertColors);
      return;
    }

    ctx.save();

    // Apply rotation around position
    if (rotation !== 0) {
      ctx.translate(position.x, position.y);
      ctx.rotate(rotation);
      ctx.translate(-position.x, -position.y);
    }

    // Calculate effective font size:
    // - Annotation text (default): fontSize is in paper mm, divide by drawingScale to get drawing units
    // - Model text: uses fontSize directly in model units
    const effectiveFontSize = isModelText
      ? fontSize
      : fontSize / this.drawingScale;

    // Build font string
    const fontStyle = `${italic ? 'italic ' : ''}${bold ? 'bold ' : ''}`;
    ctx.font = `${fontStyle}${effectiveFontSize}px ${fontFamily}`;

    // Set text color - invert white to black for sheet mode
    let textColor = color || shape.style.strokeColor;
    if (invertColors && textColor === '#ffffff') {
      textColor = '#000000';
    }
    ctx.fillStyle = textColor;

    // Set alignment
    ctx.textAlign = alignment;
    ctx.textBaseline = verticalAlignment === 'middle' ? 'middle' :
                       verticalAlignment === 'bottom' ? 'bottom' : 'top';

    // Handle multi-line text with optional word wrapping
    const actualLineHeight = effectiveFontSize * lineHeight;
    // Calculate extra spacing for paragraph breaks
    const paragraphExtra = paragraphSpacing * actualLineHeight;

    // If fixedWidth is set, wrap text to fit within that width
    const fixedWidth = shape.fixedWidth;
    let lines: string[];

    if (fixedWidth && fixedWidth > 0) {
      // Word wrap text to fit within fixedWidth
      lines = [];
      const paragraphs = text.split('\n');
      for (const paragraph of paragraphs) {
        if (paragraph === '') {
          lines.push('');
          continue;
        }

        const words = paragraph.split(' ');
        let currentLine = '';

        for (const word of words) {
          // Check if the word itself is too long and needs character-level breaking
          const wordMetrics = ctx.measureText(word);
          if (wordMetrics.width > fixedWidth) {
            // Push current line if it has content
            if (currentLine) {
              lines.push(currentLine);
              currentLine = '';
            }
            // Break the word character by character
            let charLine = '';
            for (const char of word) {
              const testCharLine = charLine + char;
              const charMetrics = ctx.measureText(testCharLine);
              if (charMetrics.width > fixedWidth && charLine) {
                lines.push(charLine);
                charLine = char;
              } else {
                charLine = testCharLine;
              }
            }
            currentLine = charLine;
          } else {
            const testLine = currentLine ? `${currentLine} ${word}` : word;
            const metrics = ctx.measureText(testLine);

            if (metrics.width > fixedWidth && currentLine) {
              lines.push(currentLine);
              currentLine = word;
            } else {
              currentLine = testLine;
            }
          }
        }

        if (currentLine) {
          lines.push(currentLine);
        }
      }
    } else {
      lines = text.split('\n');
    }

    // Draw background mask if enabled
    if (backgroundMask && lines.length > 0) {
      // Apply text case transformation for measuring
      const transformTextForMeasure = (t: string): string => {
        switch (textCase) {
          case 'uppercase': return t.toUpperCase();
          case 'lowercase': return t.toLowerCase();
          case 'capitalize': return t.replace(/\b\w/g, c => c.toUpperCase());
          default: return t;
        }
      };

      // Calculate text bounds (considering width factor and letter spacing)
      let maxWidth = 0;
      for (const line of lines) {
        const displayLine = transformTextForMeasure(line);
        let lineWidth: number;
        if (letterSpacing !== 1) {
          let totalWidth = 0;
          for (const char of displayLine.split('')) {
            totalWidth += ctx.measureText(char).width * letterSpacing;
          }
          if (displayLine.length > 0) {
            totalWidth -= ctx.measureText(displayLine[displayLine.length - 1]).width * (letterSpacing - 1);
          }
          lineWidth = totalWidth;
        } else {
          lineWidth = ctx.measureText(displayLine).width;
        }
        lineWidth *= widthFactor;
        if (lineWidth > maxWidth) maxWidth = lineWidth;
      }

      // Calculate total height including paragraph spacing
      let totalHeight = 0;
      for (let i = 0; i < lines.length; i++) {
        totalHeight += actualLineHeight;
        if (i > 0 && lines[i - 1] === '') {
          totalHeight += paragraphExtra;
        }
      }
      const padding = backgroundPadding * (isModelText ? 1 : (1 / this.drawingScale));

      // Calculate background rectangle position based on alignment
      let bgX = position.x - padding;
      if (alignment === 'center') bgX = position.x - maxWidth / 2 - padding;
      else if (alignment === 'right') bgX = position.x - maxWidth - padding;

      let bgY = position.y - padding;
      if (verticalAlignment === 'middle') bgY = position.y - actualLineHeight / 2 - padding;
      else if (verticalAlignment === 'bottom') bgY = position.y - actualLineHeight - padding;

      const bgWidth = maxWidth + padding * 2;
      const bgHeight = totalHeight + padding * 2;

      // Draw background
      let bgColor = backgroundColor;
      if (invertColors && bgColor === '#1a1a2e') {
        bgColor = '#ffffff';
      }
      ctx.fillStyle = bgColor;
      ctx.fillRect(bgX, bgY, bgWidth, bgHeight);

      // Draw border if showBorder is enabled
      if (shape.showBorder) {
        let borderStroke = shape.borderColor || textColor;
        if (invertColors && borderStroke === '#ffffff') {
          borderStroke = '#000000';
        }
        ctx.strokeStyle = borderStroke;
        ctx.lineWidth = this.getLineWidth(shape.style.strokeWidth) * 0.8;
        ctx.setLineDash([]);
        ctx.strokeRect(bgX, bgY, bgWidth, bgHeight);
      }

      // Reset fill style for text
      ctx.fillStyle = textColor;
    }

    // Apply text case transformation
    const transformText = (t: string): string => {
      switch (textCase) {
        case 'uppercase': return t.toUpperCase();
        case 'lowercase': return t.toLowerCase();
        case 'capitalize': return t.replace(/\b\w/g, c => c.toUpperCase());
        default: return t;
      }
    };

    // Calculate cumulative Y offset with paragraph spacing
    let cumulativeY = 0;

    // Draw text lines
    for (let i = 0; i < lines.length; i++) {
      const originalLine = lines[i];
      const displayLine = transformText(originalLine);
      const y = position.y + cumulativeY;

      // Check if this is a paragraph break (empty line or following empty line)
      const isParagraphBreak = i > 0 && lines[i - 1] === '';

      ctx.save();

      // Apply width factor and oblique angle transforms
      if (widthFactor !== 1 || obliqueAngle !== 0) {
        // Calculate transform origin based on alignment
        let transformOriginX = position.x;
        if (alignment === 'center') {
          const metrics = ctx.measureText(displayLine);
          transformOriginX = position.x - metrics.width / 2;
        } else if (alignment === 'right') {
          const metrics = ctx.measureText(displayLine);
          transformOriginX = position.x - metrics.width;
        }

        ctx.translate(transformOriginX, y);
        // Apply skew (oblique angle) - convert from degrees to radians
        const skewAngle = (obliqueAngle * Math.PI) / 180;
        // Apply width factor and oblique transforms
        // Matrix: [widthFactor, 0, tan(skew), 1, 0, 0]
        ctx.transform(widthFactor, 0, Math.tan(skewAngle), 1, 0, 0);
        ctx.translate(-transformOriginX, -y);
      }

      // Draw text with letter spacing
      if (letterSpacing !== 1 && displayLine.length > 0) {
        // Manual character-by-character rendering for letter spacing
        const chars = displayLine.split('');
        let currentX = position.x;

        // Adjust starting position for alignment
        if (alignment === 'center' || alignment === 'right') {
          let totalWidth = 0;
          for (const char of chars) {
            totalWidth += ctx.measureText(char).width * letterSpacing;
          }
          // Remove extra spacing at the end
          totalWidth -= ctx.measureText(chars[chars.length - 1]).width * (letterSpacing - 1);
          if (alignment === 'center') currentX -= totalWidth / 2;
          else if (alignment === 'right') currentX -= totalWidth;
        }

        for (let c = 0; c < chars.length; c++) {
          ctx.fillText(chars[c], currentX, y);
          const charWidth = ctx.measureText(chars[c]).width;
          currentX += charWidth * letterSpacing;
        }
      } else {
        ctx.fillText(displayLine, position.x, y);
      }

      ctx.restore();

      // Calculate line width for underline/strikethrough
      const metrics = ctx.measureText(displayLine);
      let lineWidth = metrics.width * widthFactor;
      if (letterSpacing !== 1) {
        // Recalculate width with letter spacing
        let totalWidth = 0;
        for (const char of displayLine.split('')) {
          totalWidth += ctx.measureText(char).width * letterSpacing;
        }
        if (displayLine.length > 0) {
          totalWidth -= ctx.measureText(displayLine[displayLine.length - 1]).width * (letterSpacing - 1);
        }
        lineWidth = totalWidth * widthFactor;
      }

      // Calculate starting X for decorations
      let startX = position.x;
      if (alignment === 'center') startX -= lineWidth / 2;
      else if (alignment === 'right') startX -= lineWidth;

      // Draw underline if enabled
      if (underline && displayLine.length > 0) {
        ctx.strokeStyle = textColor;
        ctx.lineWidth = Math.max(1, effectiveFontSize * 0.05);
        ctx.beginPath();
        ctx.moveTo(startX, y + effectiveFontSize + 2);
        ctx.lineTo(startX + lineWidth, y + effectiveFontSize + 2);
        ctx.stroke();
      }

      // Draw strikethrough if enabled
      if (strikethrough && displayLine.length > 0) {
        ctx.strokeStyle = textColor;
        ctx.lineWidth = Math.max(1, effectiveFontSize * 0.05);
        ctx.beginPath();
        // Position strikethrough at roughly middle of the text
        const strikethroughY = y + effectiveFontSize * 0.35;
        ctx.moveTo(startX, strikethroughY);
        ctx.lineTo(startX + lineWidth, strikethroughY);
        ctx.stroke();
      }

      // Update cumulative Y position
      cumulativeY += actualLineHeight;
      // Add extra spacing after paragraph breaks
      if (isParagraphBreak) {
        cumulativeY += paragraphExtra;
      }
    }

    ctx.restore();

    // Draw leader lines if present (skip for linked labels -- they have no leader line)
    if (!shape.linkedShapeId &&
        ((shape.leaderPoints && shape.leaderPoints.length > 0) ||
         (shape.leaders && shape.leaders.length > 0))) {
      ctx.save();
      const leaderConfig = shape.leaderConfig;
      let leaderColor = leaderConfig?.color || color || shape.style.strokeColor;
      if (invertColors && leaderColor === '#ffffff') {
        leaderColor = '#000000';
      }
      ctx.strokeStyle = leaderColor;
      ctx.fillStyle = leaderColor;
      // Leader line and arrow sizes are proportional to effective font size
      // so they remain visible and well-proportioned at any scale/zoom.
      // lineWeight as fraction of font size (default ~7%), arrowSize as fraction (~100%)
      const configLineWeight = leaderConfig?.lineWeight ?? 0.18;
      const configArrowSize = leaderConfig?.arrowSize ?? 2.5;
      // Scale the same way as fontSize: paper mm → drawing units
      const leaderScaleFactor = isModelText ? 1 : (1 / this.drawingScale);
      ctx.lineWidth = configLineWeight * leaderScaleFactor;
      ctx.setLineDash([]);

      const arrowType = leaderConfig?.arrowType ?? 'filled-arrow';
      const arrowSize = configArrowSize * leaderScaleFactor;
      const hasLanding = leaderConfig?.hasLanding ?? true;

      // Calculate text width for the landing (underline) line
      // Re-set the font to measure correctly (ctx.restore was called above)
      const ldrFontStyle = `${italic ? 'italic ' : ''}${bold ? 'bold ' : ''}`;
      ctx.font = `${ldrFontStyle}${effectiveFontSize}px ${fontFamily}`;

      let textWidth = 0;
      const displayLines = text.split('\n');
      for (const dl of displayLines) {
        const w = ctx.measureText(dl).width * widthFactor;
        if (w > textWidth) textWidth = w;
      }
      // Minimum landing width when text is empty
      const minLandingWidth = effectiveFontSize * 3;
      const landingWidth = Math.max(textWidth, minLandingWidth);

      // Landing line Y: at the bottom of the text block
      const totalTextHeight = Math.max(displayLines.length, 1) * effectiveFontSize * lineHeight;
      const landingY = position.y + totalTextHeight;

      // Landing line X range: from text left edge to text left + landingWidth
      let landingLeftX = position.x;
      if (alignment === 'center') {
        landingLeftX = position.x - landingWidth / 2;
      } else if (alignment === 'right') {
        landingLeftX = position.x - landingWidth;
      }
      const landingRightX = landingLeftX + landingWidth;

      // Draw the landing (underline) line under the text
      if (hasLanding) {
        ctx.beginPath();
        ctx.moveTo(landingLeftX, landingY);
        ctx.lineTo(landingRightX, landingY);
        ctx.stroke();
      }

      // Helper to draw an arrow terminator at a point
      const drawArrow = (tip: { x: number; y: number }, prev: { x: number; y: number }) => {
        const angle = Math.atan2(tip.y - prev.y, tip.x - prev.x);
        switch (arrowType) {
          case 'arrow':
            ctx.beginPath();
            ctx.moveTo(tip.x, tip.y);
            ctx.lineTo(tip.x - arrowSize * Math.cos(angle - 0.4), tip.y - arrowSize * Math.sin(angle - 0.4));
            ctx.moveTo(tip.x, tip.y);
            ctx.lineTo(tip.x - arrowSize * Math.cos(angle + 0.4), tip.y - arrowSize * Math.sin(angle + 0.4));
            ctx.stroke();
            break;
          case 'filled-arrow':
            ctx.beginPath();
            ctx.moveTo(tip.x, tip.y);
            ctx.lineTo(tip.x - arrowSize * Math.cos(angle - 0.35), tip.y - arrowSize * Math.sin(angle - 0.35));
            ctx.lineTo(tip.x - arrowSize * Math.cos(angle + 0.35), tip.y - arrowSize * Math.sin(angle + 0.35));
            ctx.closePath();
            ctx.fill();
            break;
          case 'dot':
            ctx.beginPath();
            ctx.arc(tip.x, tip.y, arrowSize / 2, 0, Math.PI * 2);
            ctx.fill();
            break;
          case 'slash': {
            const sLen = arrowSize / 1.5;
            const pAngle = angle + Math.PI / 2;
            ctx.beginPath();
            ctx.moveTo(tip.x + sLen * Math.cos(pAngle), tip.y + sLen * Math.sin(pAngle));
            ctx.lineTo(tip.x - sLen * Math.cos(pAngle), tip.y - sLen * Math.sin(pAngle));
            ctx.stroke();
            break;
          }
          case 'none':
            break;
        }
      };

      // Helper to draw a single leader line from a set of waypoints
      const drawLeaderLine = (leaderPts: { x: number; y: number }[]) => {
        if (leaderPts.length === 0) return;
        // Arrow tip is the last point in leaderPoints
        const arrowTip = leaderPts[leaderPts.length - 1];
        // Pick connection side: leader connects to the closer end of the landing line
        const connectX = (arrowTip.x < (landingLeftX + landingRightX) / 2) ? landingLeftX : landingRightX;
        const connectPt = { x: connectX, y: landingY };

        // Draw line from landing endpoint through waypoints to arrow tip
        ctx.beginPath();
        ctx.moveTo(connectPt.x, connectPt.y);
        for (const pt of leaderPts) {
          ctx.lineTo(pt.x, pt.y);
        }
        ctx.stroke();

        // Draw arrow terminator at the tip
        const prevPt = leaderPts.length > 1
          ? leaderPts[leaderPts.length - 2]
          : connectPt;
        drawArrow(arrowTip, prevPt);
      };

      // Draw primary leader (leaderPoints)
      if (shape.leaderPoints && shape.leaderPoints.length > 0) {
        drawLeaderLine(shape.leaderPoints);
      }

      // Draw additional leaders (leaders[] array)
      if (shape.leaders) {
        for (const leader of shape.leaders) {
          drawLeaderLine(leader.points);
        }
      }

      ctx.restore();
    }

    // Draw selection box if selected
    if (isSelected) {
      this.drawTextSelectionBox(shape);
    }
  }

  /**
   * Draw a span arrow (overspanningspijl) for slab labels.
   * Renders a double-headed arrow with the label text centered on it.
   * The arrow is oriented along the slab's span direction (shorter dimension).
   */
  private drawSpanArrow(shape: Shape & { type: 'text' }, text: string, invertColors: boolean): void {
    const ctx = this.ctx;
    const {
      position,
      fontSize,
      fontFamily,
      bold,
      italic,
      color,
      isModelText = false,
      backgroundMask = false,
      backgroundColor = '#1a1a2e',
      backgroundPadding = 0.5,
      textCase = 'none',
      widthFactor = 1,
      spanDirection = 0,
      spanLength = 500,
    } = shape;

    // Effective font size (same logic as drawText)
    const effectiveFontSize = isModelText
      ? fontSize
      : fontSize / this.drawingScale;

    // Resolve text color
    let textColor = color || shape.style.strokeColor;
    if (invertColors && textColor === '#ffffff') {
      textColor = '#000000';
    }

    // Apply text case
    let displayText = text;
    switch (textCase) {
      case 'uppercase': displayText = text.toUpperCase(); break;
      case 'lowercase': displayText = text.toLowerCase(); break;
      case 'capitalize': displayText = text.replace(/\b\w/g, c => c.toUpperCase()); break;
    }

    ctx.save();

    // Translate to position and rotate to span direction
    ctx.translate(position.x, position.y);
    ctx.rotate(spanDirection);

    // Set font for text measurement
    const fontStyle = `${italic ? 'italic ' : ''}${bold ? 'bold ' : ''}`;
    ctx.font = `${fontStyle}${effectiveFontSize}px ${fontFamily}`;

    // Measure text width
    const textMetrics = ctx.measureText(displayText);
    const textWidth = textMetrics.width * widthFactor;

    // Arrow extends from -halfLen to +halfLen along the local X axis
    const halfLen = spanLength / 2;

    // Arrowhead dimensions (proportional to font size)
    const arrowHeadLength = effectiveFontSize * 1.2;
    const arrowHeadWidth = effectiveFontSize * 0.6;

    // Line weight for the arrow
    const arrowLineWidth = this.getLineWidth(shape.style.strokeWidth) * 1.2;

    // Gap around text (padding on each side)
    const textGap = effectiveFontSize * 0.6;
    const halfTextZone = textWidth / 2 + textGap;

    // Draw the arrow line (two segments with a gap for text)
    ctx.strokeStyle = textColor;
    ctx.lineWidth = arrowLineWidth;
    ctx.setLineDash([]);

    // Left segment: from left arrowhead tip to the text gap
    const leftLineStart = -halfLen + arrowHeadLength;
    const leftLineEnd = -halfTextZone;
    if (leftLineStart < leftLineEnd) {
      ctx.beginPath();
      ctx.moveTo(leftLineStart, 0);
      ctx.lineTo(leftLineEnd, 0);
      ctx.stroke();
    }

    // Right segment: from text gap to right arrowhead tip
    const rightLineStart = halfTextZone;
    const rightLineEnd = halfLen - arrowHeadLength;
    if (rightLineStart < rightLineEnd) {
      ctx.beginPath();
      ctx.moveTo(rightLineStart, 0);
      ctx.lineTo(rightLineEnd, 0);
      ctx.stroke();
    }

    // Draw left arrowhead (pointing left, at -halfLen)
    ctx.fillStyle = textColor;
    ctx.beginPath();
    ctx.moveTo(-halfLen, 0);
    ctx.lineTo(-halfLen + arrowHeadLength, -arrowHeadWidth);
    ctx.lineTo(-halfLen + arrowHeadLength, arrowHeadWidth);
    ctx.closePath();
    ctx.fill();

    // Draw right arrowhead (pointing right, at +halfLen)
    ctx.beginPath();
    ctx.moveTo(halfLen, 0);
    ctx.lineTo(halfLen - arrowHeadLength, -arrowHeadWidth);
    ctx.lineTo(halfLen - arrowHeadLength, arrowHeadWidth);
    ctx.closePath();
    ctx.fill();

    // Draw background behind text if enabled
    if (backgroundMask) {
      const padding = backgroundPadding * (isModelText ? 1 : (1 / this.drawingScale));
      let bgColor = backgroundColor;
      if (invertColors && bgColor === '#1a1a2e') {
        bgColor = '#ffffff';
      }
      ctx.fillStyle = bgColor;
      ctx.fillRect(
        -textWidth / 2 - padding,
        -effectiveFontSize / 2 - padding,
        textWidth + padding * 2,
        effectiveFontSize + padding * 2
      );
    }

    // Draw centered text
    ctx.fillStyle = textColor;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(displayText, 0, 0);

    ctx.restore();
  }

  private drawTextSelectionBox(shape: Shape): void {
    if (shape.type !== 'text') return;
    const ctx = this.ctx;

    const { position, text, fontSize, fontFamily, rotation, alignment, verticalAlignment, bold, italic, lineHeight = 1.2, isModelText = false, fixedWidth } = shape;

    // Get zoom BEFORE applying rotation (rotation affects getTransform().a)
    const zoom = ctx.getTransform().a / this.dpr;

    ctx.save();

    // Apply rotation around position (same as drawText)
    if (rotation !== 0) {
      ctx.translate(position.x, position.y);
      ctx.rotate(rotation);
      ctx.translate(-position.x, -position.y);
    }

    // Calculate effective font size (same as drawText)
    const effectiveFontSize = isModelText
      ? fontSize
      : fontSize / this.drawingScale;

    // Set font and baseline to match drawText rendering
    const fontStyle = `${italic ? 'italic ' : ''}${bold ? 'bold ' : ''}`;
    ctx.font = `${fontStyle}${effectiveFontSize}px ${fontFamily}`;
    ctx.textBaseline = verticalAlignment === 'middle' ? 'middle' :
                       verticalAlignment === 'bottom' ? 'bottom' : 'top';

    const actualLineHeight = effectiveFontSize * lineHeight;

    // Calculate wrapped lines if fixedWidth is set (same logic as drawText)
    let lines: string[];
    if (fixedWidth && fixedWidth > 0) {
      lines = [];
      const paragraphs = text.split('\n');
      for (const paragraph of paragraphs) {
        if (paragraph === '') {
          lines.push('');
          continue;
        }

        const words = paragraph.split(' ');
        let currentLine = '';

        for (const word of words) {
          // Check if the word itself is too long and needs character-level breaking
          const wordMetrics = ctx.measureText(word);
          if (wordMetrics.width > fixedWidth) {
            // Push current line if it has content
            if (currentLine) {
              lines.push(currentLine);
              currentLine = '';
            }
            // Break the word character by character
            let charLine = '';
            for (const char of word) {
              const testCharLine = charLine + char;
              const charMetrics = ctx.measureText(testCharLine);
              if (charMetrics.width > fixedWidth && charLine) {
                lines.push(charLine);
                charLine = char;
              } else {
                charLine = testCharLine;
              }
            }
            currentLine = charLine;
          } else {
            const testLine = currentLine ? `${currentLine} ${word}` : word;
            const metrics = ctx.measureText(testLine);
            if (metrics.width > fixedWidth && currentLine) {
              lines.push(currentLine);
              currentLine = word;
            } else {
              currentLine = testLine;
            }
          }
        }

        if (currentLine) lines.push(currentLine);
      }
    } else {
      lines = text.split('\n');
    }

    // Use actual font metrics for accurate bounds
    let maxWidth = fixedWidth || 0;
    let maxAscent = 0;
    let maxDescent = 0;
    for (const line of lines) {
      const metrics = ctx.measureText(line);
      if (!fixedWidth && metrics.width > maxWidth) maxWidth = metrics.width;
      if (metrics.actualBoundingBoxAscent > maxAscent) maxAscent = metrics.actualBoundingBoxAscent;
      if (metrics.actualBoundingBoxDescent > maxDescent) maxDescent = metrics.actualBoundingBoxDescent;
    }

    // First line top/bottom from actual metrics, remaining lines offset by lineHeight
    const topY = position.y - maxAscent;
    const bottomY = position.y + maxDescent + (lines.length - 1) * actualLineHeight;
    const boxHeight = bottomY - topY;

    // Calculate bounding box based on alignment
    let minX = position.x;
    if (alignment === 'center') minX -= maxWidth / 2;
    else if (alignment === 'right') minX -= maxWidth;

    // Draw selection rectangle
    ctx.strokeStyle = COLORS.selection;
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.strokeRect(minX - 2, topY - 2, maxWidth + 4, boxHeight + 4);
    ctx.setLineDash([]);

    // Draw resize handles on left and right edges
    const handleSize = 6 / zoom;
    const midY = topY + boxHeight / 2;

    ctx.fillStyle = COLORS.selectionHandle;
    ctx.strokeStyle = COLORS.selectionHandleStroke;
    ctx.lineWidth = 1 / zoom;

    // Left resize handle (horizontal bar style for width resize)
    const leftHandleX = minX - 2;
    ctx.fillRect(leftHandleX - handleSize / 2, midY - handleSize, handleSize, handleSize * 2);
    ctx.strokeRect(leftHandleX - handleSize / 2, midY - handleSize, handleSize, handleSize * 2);
    // Draw X-axis only arrow on left handle (pointing left to indicate resize direction)
    this.drawXAxisArrow({ x: leftHandleX, y: midY }, zoom, 'left');

    // Right resize handle
    const rightHandleX = minX + maxWidth + 2;
    ctx.fillRect(rightHandleX - handleSize / 2, midY - handleSize, handleSize, handleSize * 2);
    ctx.strokeRect(rightHandleX - handleSize / 2, midY - handleSize, handleSize, handleSize * 2);
    // Draw X-axis only arrow on right handle (pointing right to indicate resize direction)
    this.drawXAxisArrow({ x: rightHandleX, y: midY }, zoom, 'right');

    // Draw move handle at center of text box
    const centerX = minX + maxWidth / 2;
    ctx.fillRect(centerX - handleSize / 2, midY - handleSize / 2, handleSize, handleSize);
    ctx.strokeRect(centerX - handleSize / 2, midY - handleSize / 2, handleSize, handleSize);

    // Draw axis arrows on move handle
    this.drawAxisArrows({ x: centerX, y: midY }, zoom);

    // Draw rotation handle above the text box
    const rotationHandleDistance = 25 / zoom; // Distance from top of box to rotation handle
    const rotationHandleY = topY - 2 - rotationHandleDistance;
    const rotationHandleRadius = handleSize * 0.6;

    // Draw connecting line from top center to rotation handle
    ctx.strokeStyle = COLORS.selection;
    ctx.lineWidth = 1 / zoom;
    ctx.beginPath();
    ctx.moveTo(centerX, topY - 2);
    ctx.lineTo(centerX, rotationHandleY);
    ctx.stroke();

    // Draw circular rotation handle
    ctx.fillStyle = '#90EE90'; // Light green for rotation
    ctx.strokeStyle = COLORS.selectionHandleStroke;
    ctx.beginPath();
    ctx.arc(centerX, rotationHandleY, rotationHandleRadius, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // Draw rotation arrow icon inside the handle
    ctx.strokeStyle = '#006400'; // Dark green
    ctx.lineWidth = 1.5 / zoom;
    const iconRadius = rotationHandleRadius * 0.6;
    ctx.beginPath();
    ctx.arc(centerX, rotationHandleY, iconRadius, -Math.PI * 0.7, Math.PI * 0.3);
    ctx.stroke();
    // Arrowhead
    const arrowTipAngle = Math.PI * 0.3;
    const arrowTipX = centerX + iconRadius * Math.cos(arrowTipAngle);
    const arrowTipY = rotationHandleY + iconRadius * Math.sin(arrowTipAngle);
    const arrowHeadSize = 3 / zoom;
    ctx.beginPath();
    ctx.moveTo(arrowTipX, arrowTipY);
    ctx.lineTo(arrowTipX - arrowHeadSize, arrowTipY - arrowHeadSize);
    ctx.moveTo(arrowTipX, arrowTipY);
    ctx.lineTo(arrowTipX + arrowHeadSize * 0.5, arrowTipY - arrowHeadSize);
    ctx.stroke();

    // Draw leader line selection highlights and grip handles (skip for linked labels)
    if (!shape.linkedShapeId &&
        ((shape.leaderPoints && shape.leaderPoints.length > 0) ||
         (shape.leaders && shape.leaders.length > 0))) {
      // Undo the rotation transform for leader drawing (leaders are in world space)
      ctx.restore();
      ctx.save();

      const leaderConfig = shape.leaderConfig;
      const hasLanding = leaderConfig?.hasLanding ?? true;

      // Recalculate landing geometry (same as drawText)
      const ldrFontStyle = `${italic ? 'italic ' : ''}${bold ? 'bold ' : ''}`;
      ctx.font = `${ldrFontStyle}${effectiveFontSize}px ${fontFamily}`;

      let textWidth = 0;
      const ldrLines = text.split('\n');
      for (const dl of ldrLines) {
        const w = ctx.measureText(dl).width;
        if (w > textWidth) textWidth = w;
      }
      const minLandingWidth = effectiveFontSize * 3;
      const landingWidth = Math.max(textWidth, minLandingWidth);
      const totalTextHeight = Math.max(ldrLines.length, 1) * effectiveFontSize * (lineHeight);
      const landingY = position.y + totalTextHeight;

      let landingLeftX = position.x;
      if (alignment === 'center') landingLeftX = position.x - landingWidth / 2;
      else if (alignment === 'right') landingLeftX = position.x - landingWidth;
      const landingRightX = landingLeftX + landingWidth;

      // Draw selection highlight over leader lines
      // Use a width slightly thicker than the actual leader line so the highlight is visible
      const selScaleFactor = shape.isModelText ? 1 : (1 / this.drawingScale);
      const selLineWidth = (shape.leaderConfig?.lineWeight ?? 0.18) * selScaleFactor;
      ctx.strokeStyle = COLORS.selection;
      ctx.lineWidth = Math.max(selLineWidth * 1.5, 2 / zoom);
      ctx.setLineDash([]);

      const highlightLeader = (leaderPts: { x: number; y: number }[]) => {
        if (leaderPts.length === 0) return;
        const arrowTip = leaderPts[leaderPts.length - 1];
        const connectX = (arrowTip.x < (landingLeftX + landingRightX) / 2) ? landingLeftX : landingRightX;
        const connectPt = { x: connectX, y: landingY };

        // Highlight leader line
        ctx.beginPath();
        ctx.moveTo(connectPt.x, connectPt.y);
        for (const pt of leaderPts) {
          ctx.lineTo(pt.x, pt.y);
        }
        ctx.stroke();
      };

      // Highlight landing line
      if (hasLanding) {
        ctx.beginPath();
        ctx.moveTo(landingLeftX, landingY);
        ctx.lineTo(landingRightX, landingY);
        ctx.stroke();
      }

      // Highlight primary leader
      if (shape.leaderPoints && shape.leaderPoints.length > 0) {
        highlightLeader(shape.leaderPoints);
      }
      // Highlight additional leaders
      if (shape.leaders) {
        for (const leader of shape.leaders) {
          highlightLeader(leader.points);
        }
      }

      // Draw grip squares at leader waypoints
      ctx.fillStyle = COLORS.selectionHandle;
      ctx.strokeStyle = COLORS.selectionHandleStroke;
      ctx.lineWidth = 1 / zoom;

      const drawGrip = (pt: { x: number; y: number }) => {
        ctx.fillRect(pt.x - handleSize / 2, pt.y - handleSize / 2, handleSize, handleSize);
        ctx.strokeRect(pt.x - handleSize / 2, pt.y - handleSize / 2, handleSize, handleSize);
      };

      if (shape.leaderPoints) {
        for (const pt of shape.leaderPoints) {
          drawGrip(pt);
        }
      }
      if (shape.leaders) {
        for (const leader of shape.leaders) {
          for (const pt of leader.points) {
            drawGrip(pt);
          }
        }
      }
    }

    ctx.restore();
  }

  private drawSelectionHandles(shape: Shape): void {
    const ctx = this.ctx;
    // Keep handles at a constant screen-pixel size, but never smaller than the shape's stroke
    const zoom = ctx.getTransform().a / this.dpr;
    const screenSize = 6 / zoom;
    const strokeWidth = shape.style?.strokeWidth ?? 1;
    const handleSize = Math.max(screenSize, strokeWidth + 4 / zoom);

    ctx.fillStyle = COLORS.selectionHandle;
    ctx.strokeStyle = COLORS.selectionHandleStroke;
    ctx.lineWidth = 1 / zoom;

    const points = this.getShapeHandlePoints(shape);

    const hover = getGripHover();
    // Check if a specific grip is selected via box selection (endpoint editing mode)
    const selectedGrip = useAppStore.getState().selectedGrip;
    const isGripSelected = selectedGrip && selectedGrip.shapeId === shape.id;

    for (let i = 0; i < points.length; i++) {
      const point = points[i];
      // Highlight the box-selected grip with a distinct color (bright cyan, larger)
      const isThisGripSelected = isGripSelected && selectedGrip.gripIndex === i;
      if (isThisGripSelected) {
        const highlightSize = handleSize * 1.4;
        ctx.fillStyle = '#00ffff';
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2 / zoom;
        ctx.fillRect(point.x - highlightSize / 2, point.y - highlightSize / 2, highlightSize, highlightSize);
        ctx.strokeRect(point.x - highlightSize / 2, point.y - highlightSize / 2, highlightSize, highlightSize);
      } else {
        ctx.fillStyle = COLORS.selectionHandle;
        ctx.strokeStyle = COLORS.selectionHandleStroke;
        ctx.lineWidth = 1 / zoom;
        ctx.fillRect(point.x - handleSize / 2, point.y - handleSize / 2, handleSize, handleSize);
        ctx.strokeRect(point.x - handleSize / 2, point.y - handleSize / 2, handleSize, handleSize);
      }
      // Skip axis arrows on arc midpoint grip and image corner/side grips (only center grip 8 gets arrows)
      if (!(shape.type === 'arc' && i === 3) && !(shape.type === 'image' && i !== 8)) {
        // For line/beam midpoint (index 2), align axes along/perpendicular to the shape
        let angle = 0;
        if (i === 2 && (shape.type === 'line' || shape.type === 'beam' || shape.type === 'gridline' || shape.type === 'wall')) {
          angle = Math.atan2(shape.end.y - shape.start.y, shape.end.x - shape.start.x);
        }
        // Determine which axis is hovered for highlighting
        const hoveredAxis = (hover && hover.shapeId === shape.id && hover.gripIndex === i) ? hover.axis : null;
        this.drawAxisArrows(point, zoom, angle, hoveredAxis);
      }
    }

    // Draw rotation gizmo handle if enabled (skip text, pile, cpt — these don't support rotation)
    if (getRotationGizmoVisible() && shape.type !== 'text' && shape.type !== 'pile' && shape.type !== 'cpt') {
      this.drawRotationGizmo(shape, points, zoom);
    }
  }

  /**
   * Draw rotation gizmo: an outer rotation ring around the shape with a
   * small handle, hover highlighting, and angle feedback during active rotation.
   */
  private drawRotationGizmo(shape: Shape, handlePoints: { x: number; y: number }[], zoom: number): void {
    const ctx = this.ctx;

    // Calculate shape center (centroid) from handle points
    let cx = 0, cy = 0;
    for (const pt of handlePoints) {
      cx += pt.x;
      cy += pt.y;
    }
    cx /= handlePoints.length;
    cy /= handlePoints.length;

    // Fixed world-space ring radius: 50mm (100mm diameter circle)
    const ringRadius = 50;

    const isHovered = getRotationGizmoHovered();
    const activeRot = getActiveRotation();
    const isActiveForThisShape = activeRot !== null && activeRot.shapeId === shape.id;

    ctx.save();

    // --- Draw the outer rotation ring (thin & subtle, fixed world-space size) ---
    const ringColor = isHovered || isActiveForThisShape
      ? 'rgba(0, 200, 255, 0.45)'
      : 'rgba(0, 180, 255, 0.15)';
    // 1px line width in screen space
    const ringLineWidth = 1 / zoom;

    ctx.strokeStyle = ringColor;
    ctx.lineWidth = ringLineWidth;
    ctx.setLineDash([4 / zoom, 3 / zoom]);
    ctx.beginPath();
    ctx.arc(cx, cy, ringRadius, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);

    // --- Draw the rotation handle at the top of the ring ---
    const handleAngle = -Math.PI / 2; // Top position
    const handleX = cx + ringRadius * Math.cos(handleAngle);
    const handleY = cy + ringRadius * Math.sin(handleAngle);
    const handleRadius = isHovered ? 4 / zoom : 3 / zoom;

    // Handle fill
    ctx.fillStyle = isHovered
      ? 'rgba(0, 220, 255, 1.0)'
      : 'rgba(0, 180, 255, 0.85)';
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.8)';
    ctx.lineWidth = 1 / zoom;
    ctx.beginPath();
    ctx.arc(handleX, handleY, handleRadius, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // Draw rotation arrow icon inside the handle
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
    ctx.lineWidth = 0.8 / zoom;
    const iconR = handleRadius * 0.55;
    ctx.beginPath();
    ctx.arc(handleX, handleY, iconR, -Math.PI * 0.8, Math.PI * 0.4);
    ctx.stroke();
    // Arrow tip
    const tipA = Math.PI * 0.4;
    const tipX = handleX + iconR * Math.cos(tipA);
    const tipY = handleY + iconR * Math.sin(tipA);
    const arrowSz = handleRadius * 0.35;
    ctx.beginPath();
    ctx.moveTo(tipX + arrowSz * Math.cos(tipA - 0.5), tipY + arrowSz * Math.sin(tipA - 0.5));
    ctx.lineTo(tipX, tipY);
    ctx.lineTo(tipX + arrowSz * Math.cos(tipA + 1.5), tipY + arrowSz * Math.sin(tipA + 1.5));
    ctx.stroke();

    // --- Draw angle feedback during active rotation ---
    if (isActiveForThisShape) {
      const rot = activeRot!;
      const deltaAngle = rot.deltaAngle;
      // Reference line (from center upward = 0 degrees)
      const refAngle = -Math.PI / 2;
      const guideLen = ringRadius + 6 / zoom;

      // Draw reference line (dashed, dimmer)
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
      ctx.lineWidth = 1 / zoom;
      ctx.setLineDash([4 / zoom, 3 / zoom]);
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + guideLen * Math.cos(refAngle), cy + guideLen * Math.sin(refAngle));
      ctx.stroke();
      ctx.setLineDash([]);

      // Draw current angle line (solid, bright)
      const currentAngle = refAngle + deltaAngle;
      ctx.strokeStyle = rot.isSnapped ? 'rgba(0, 255, 128, 0.8)' : 'rgba(0, 200, 255, 0.8)';
      ctx.lineWidth = 1.5 / zoom;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + guideLen * Math.cos(currentAngle), cy + guideLen * Math.sin(currentAngle));
      ctx.stroke();

      // Draw arc sweep between reference and current angle
      if (Math.abs(deltaAngle) > 0.001) {
        const sweepRadius = ringRadius * 0.4;
        ctx.fillStyle = rot.isSnapped ? 'rgba(0, 255, 128, 0.1)' : 'rgba(0, 200, 255, 0.1)';
        ctx.strokeStyle = rot.isSnapped ? 'rgba(0, 255, 128, 0.5)' : 'rgba(0, 200, 255, 0.5)';
        ctx.lineWidth = 1.5 / zoom;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        if (deltaAngle > 0) {
          ctx.arc(cx, cy, sweepRadius, refAngle, refAngle + deltaAngle);
        } else {
          ctx.arc(cx, cy, sweepRadius, refAngle + deltaAngle, refAngle);
        }
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      }

      // Draw angle label
      const angleDeg = (deltaAngle * 180) / Math.PI;
      const labelAngle = refAngle + deltaAngle / 2;
      const labelDist = ringRadius + 14 / zoom;
      const labelX = cx + labelDist * Math.cos(labelAngle);
      const labelY = cy + labelDist * Math.sin(labelAngle);

      const fontSize = 12 / zoom;
      ctx.font = `bold ${fontSize}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      // Background for label
      const labelText = `${formatNumber(angleDeg, 1, this.unitSettings.numberFormat)}\u00B0`;
      const metrics = ctx.measureText(labelText);
      const padX = 4 / zoom;
      const padY = 2 / zoom;
      ctx.fillStyle = rot.isSnapped ? 'rgba(0, 100, 50, 0.85)' : 'rgba(0, 50, 80, 0.85)';
      ctx.fillRect(
        labelX - metrics.width / 2 - padX,
        labelY - fontSize / 2 - padY,
        metrics.width + padX * 2,
        fontSize + padY * 2
      );

      // Label text
      ctx.fillStyle = rot.isSnapped ? '#00ff80' : '#00ccff';
      ctx.fillText(labelText, labelX, labelY);
    }

    ctx.restore();
  }

  /**
   * Draw X (red) and Y (green) axis-constraint arrows at a grip point.
   * Arrow length is constant in screen space (~20px).
   * When angle is provided, axes are rotated to align along/perpendicular to the shape.
   * When hoveredAxis is provided, that arrow is drawn highlighted (brighter, thicker).
   */
  private drawAxisArrows(point: { x: number; y: number }, zoom: number, angle: number = 0, hoveredAxis: 'x' | 'y' | null = null): void {
    const ctx = this.ctx;
    const arrowLen = 20 / zoom;
    const headLen = 5 / zoom;
    const headWidth = 3 / zoom;

    const cosA = Math.cos(angle);
    const sinA = Math.sin(angle);

    // Perpendicular direction (rotated 90 degrees CCW)
    const cosP = Math.cos(angle - Math.PI / 2);
    const sinP = Math.sin(angle - Math.PI / 2);

    ctx.save();

    // Along-shape axis arrow (red, along the shape direction)
    const xHovered = hoveredAxis === 'x';
    ctx.strokeStyle = xHovered ? '#ff8888' : COLORS.axisX;
    ctx.fillStyle = xHovered ? '#ff8888' : COLORS.axisX;
    ctx.lineWidth = (xHovered ? 2.5 : 1.5) / zoom;
    ctx.beginPath();
    ctx.moveTo(point.x, point.y);
    ctx.lineTo(point.x + cosA * arrowLen, point.y + sinA * arrowLen);
    ctx.stroke();
    // Arrowhead
    ctx.beginPath();
    ctx.moveTo(point.x + cosA * arrowLen, point.y + sinA * arrowLen);
    ctx.lineTo(
      point.x + cosA * (arrowLen - headLen) - sinA * headWidth,
      point.y + sinA * (arrowLen - headLen) + cosA * headWidth
    );
    ctx.lineTo(
      point.x + cosA * (arrowLen - headLen) + sinA * headWidth,
      point.y + sinA * (arrowLen - headLen) - cosA * headWidth
    );
    ctx.closePath();
    ctx.fill();

    // Perpendicular axis arrow (green, perpendicular to the shape direction)
    const yHovered = hoveredAxis === 'y';
    ctx.strokeStyle = yHovered ? '#88ff88' : COLORS.axisY;
    ctx.fillStyle = yHovered ? '#88ff88' : COLORS.axisY;
    ctx.lineWidth = (yHovered ? 2.5 : 1.5) / zoom;
    ctx.beginPath();
    ctx.moveTo(point.x, point.y);
    ctx.lineTo(point.x + cosP * arrowLen, point.y + sinP * arrowLen);
    ctx.stroke();
    // Arrowhead
    ctx.beginPath();
    ctx.moveTo(point.x + cosP * arrowLen, point.y + sinP * arrowLen);
    ctx.lineTo(
      point.x + cosP * (arrowLen - headLen) - sinP * headWidth,
      point.y + sinP * (arrowLen - headLen) + cosP * headWidth
    );
    ctx.lineTo(
      point.x + cosP * (arrowLen - headLen) + sinP * headWidth,
      point.y + sinP * (arrowLen - headLen) - cosP * headWidth
    );
    ctx.closePath();
    ctx.fill();

    ctx.restore();
  }

  /**
   * Draw a single X-axis arrow for text resize handles.
   * Direction can be 'left' or 'right' to indicate resize direction.
   */
  private drawXAxisArrow(point: { x: number; y: number }, zoom: number, direction: 'left' | 'right'): void {
    const ctx = this.ctx;
    const arrowLen = 15 / zoom;
    const headLen = 4 / zoom;
    const headWidth = 2.5 / zoom;

    ctx.save();

    ctx.strokeStyle = COLORS.axisX;
    ctx.fillStyle = COLORS.axisX;
    ctx.lineWidth = 1.5 / zoom;

    if (direction === 'right') {
      // Arrow pointing right
      ctx.beginPath();
      ctx.moveTo(point.x, point.y);
      ctx.lineTo(point.x + arrowLen, point.y);
      ctx.stroke();
      // Arrowhead
      ctx.beginPath();
      ctx.moveTo(point.x + arrowLen, point.y);
      ctx.lineTo(point.x + arrowLen - headLen, point.y - headWidth);
      ctx.lineTo(point.x + arrowLen - headLen, point.y + headWidth);
      ctx.closePath();
      ctx.fill();
    } else {
      // Arrow pointing left
      ctx.beginPath();
      ctx.moveTo(point.x, point.y);
      ctx.lineTo(point.x - arrowLen, point.y);
      ctx.stroke();
      // Arrowhead
      ctx.beginPath();
      ctx.moveTo(point.x - arrowLen, point.y);
      ctx.lineTo(point.x - arrowLen + headLen, point.y - headWidth);
      ctx.lineTo(point.x - arrowLen + headLen, point.y + headWidth);
      ctx.closePath();
      ctx.fill();
    }

    ctx.restore();
  }

  private getShapeHandlePoints(shape: Shape): { x: number; y: number }[] {
    switch (shape.type) {
      case 'line':
        return [
          shape.start,
          shape.end,
          { x: (shape.start.x + shape.end.x) / 2, y: (shape.start.y + shape.end.y) / 2 },
        ];
      case 'rectangle': {
        const tl = shape.topLeft;
        const w = shape.width;
        const h = shape.height;
        const rot = shape.rotation || 0;
        const cos = Math.cos(rot);
        const sin = Math.sin(rot);
        // topLeft is the rotation origin; offsets are in local space
        const toWorld = (lx: number, ly: number) => ({
          x: tl.x + lx * cos - ly * sin,
          y: tl.y + lx * sin + ly * cos,
        });
        return [
          toWorld(0, 0),
          toWorld(w, 0),
          toWorld(w, h),
          toWorld(0, h),
          toWorld(w / 2, 0),
          toWorld(w, h / 2),
          toWorld(w / 2, h),
          toWorld(0, h / 2),
          toWorld(w / 2, h / 2),
        ];
      }
      case 'circle':
        return [
          shape.center,
          { x: shape.center.x + shape.radius, y: shape.center.y },
          { x: shape.center.x - shape.radius, y: shape.center.y },
          { x: shape.center.x, y: shape.center.y + shape.radius },
          { x: shape.center.x, y: shape.center.y - shape.radius },
        ];
      case 'arc': {
        // Arc handles: center, start point, end point, midpoint (on curve)
        const midAngle = shape.startAngle + ((shape.endAngle - shape.startAngle + 2 * Math.PI) % (2 * Math.PI)) / 2;
        return [
          shape.center,
          { x: shape.center.x + shape.radius * Math.cos(shape.startAngle), y: shape.center.y + shape.radius * Math.sin(shape.startAngle) },
          { x: shape.center.x + shape.radius * Math.cos(shape.endAngle), y: shape.center.y + shape.radius * Math.sin(shape.endAngle) },
          { x: shape.center.x + shape.radius * Math.cos(midAngle), y: shape.center.y + shape.radius * Math.sin(midAngle) },
        ];
      }
      case 'ellipse': {
        const rot = shape.rotation || 0;
        const cos = Math.cos(rot);
        const sin = Math.sin(rot);
        const cx = shape.center.x;
        const cy = shape.center.y;
        // Transform local ellipse coordinates to world coordinates
        const toWorld = (lx: number, ly: number) => ({
          x: cx + lx * cos - ly * sin,
          y: cy + lx * sin + ly * cos,
        });
        return [
          shape.center,                                    // Center grip
          toWorld(shape.radiusX, 0),                       // Right grip
          toWorld(-shape.radiusX, 0),                      // Left grip
          toWorld(0, shape.radiusY),                       // Bottom grip
          toWorld(0, -shape.radiusY),                      // Top grip
        ];
      }
      case 'polyline': {
        const pts: { x: number; y: number }[] = [...shape.points];
        const segCount = shape.closed ? shape.points.length : shape.points.length - 1;
        for (let i = 0; i < segCount; i++) {
          const j = (i + 1) % shape.points.length;
          const b = shape.bulge?.[i] ?? 0;
          if (b !== 0) {
            pts.push(bulgeArcMidpoint(shape.points[i], shape.points[j], b));
          } else {
            pts.push({
              x: (shape.points[i].x + shape.points[j].x) / 2,
              y: (shape.points[i].y + shape.points[j].y) / 2,
            });
          }
        }
        return pts;
      }
      case 'spline': {
        const pts: { x: number; y: number }[] = [...shape.points];
        const segCount = shape.closed ? shape.points.length : shape.points.length - 1;
        for (let i = 0; i < segCount; i++) {
          const j = (i + 1) % shape.points.length;
          pts.push({
            x: (shape.points[i].x + shape.points[j].x) / 2,
            y: (shape.points[i].y + shape.points[j].y) / 2,
          });
        }
        return pts;
      }
      case 'text':
        // Text uses selection box instead of handles
        return [shape.position];
      case 'hatch': {
        const pts: { x: number; y: number }[] = [...shape.points];
        // Add edge midpoints
        for (let i = 0; i < shape.points.length; i++) {
          const j = (i + 1) % shape.points.length;
          pts.push({
            x: (shape.points[i].x + shape.points[j].x) / 2,
            y: (shape.points[i].y + shape.points[j].y) / 2,
          });
        }
        return pts;
      }
      case 'beam':
        // Beam handles: start, end, and midpoint
        return [
          shape.start,
          shape.end,
          { x: (shape.start.x + shape.end.x) / 2, y: (shape.start.y + shape.end.y) / 2 },
        ];
      case 'gridline':
        // Gridline handles: grips at actual start/end (line + bubble extend beyond visually)
        return [
          shape.start,
          shape.end,
          { x: (shape.start.x + shape.end.x) / 2, y: (shape.start.y + shape.end.y) / 2 },
        ];
      case 'level':
        // Level handles: start, end, and midpoint (like gridline)
        return [
          shape.start,
          shape.end,
          { x: (shape.start.x + shape.end.x) / 2, y: (shape.start.y + shape.end.y) / 2 },
        ];
      case 'puntniveau':
        // Puntniveau handles: all polygon vertices
        return [...(shape as PuntniveauShape).points];
      case 'pile':
        // Pile handle: center position
        return [shape.position];
      case 'cpt':
        // CPT handle: center position
        return [(shape as CPTShape).position];
      case 'foundation-zone':
        // Foundation zone handles: all contour vertices
        return [...(shape as FoundationZoneShape).contourPoints];
      case 'wall':
        // Wall handles: start, end, and midpoint
        return [
          shape.start,
          shape.end,
          { x: (shape.start.x + shape.end.x) / 2, y: (shape.start.y + shape.end.y) / 2 },
        ];
      case 'slab': {
        // Slab handles: all polygon vertices + edge midpoints
        const slabS = shape as SlabShape;
        const slabHandles: { x: number; y: number }[] = [...slabS.points];
        for (let i = 0; i < slabS.points.length; i++) {
          const j = (i + 1) % slabS.points.length;
          slabHandles.push({
            x: (slabS.points[i].x + slabS.points[j].x) / 2,
            y: (slabS.points[i].y + slabS.points[j].y) / 2,
          });
        }
        return slabHandles;
      }
      case 'plate-system': {
        // Plate system handles: contour vertices + edge/arc midpoints
        const psS = shape as PlateSystemShape;
        const psHandles: { x: number; y: number }[] = [...psS.contourPoints];
        for (let i = 0; i < psS.contourPoints.length; i++) {
          const j = (i + 1) % psS.contourPoints.length;
          const b = psS.contourBulges ? (psS.contourBulges[i] ?? 0) : 0;
          if (Math.abs(b) > 0.0001) {
            psHandles.push(bulgeArcMidpoint(psS.contourPoints[i], psS.contourPoints[j], b));
          } else {
            psHandles.push({
              x: (psS.contourPoints[i].x + psS.contourPoints[j].x) / 2,
              y: (psS.contourPoints[i].y + psS.contourPoints[j].y) / 2,
            });
          }
        }
        return psHandles;
      }
      case 'section-callout': {
        // Section callout handles: start, end, midpoint, and view depth grip
        const sc = shape as SectionCalloutShape;
        const scAngle = Math.atan2(sc.end.y - sc.start.y, sc.end.x - sc.start.x);
        const scDx = Math.cos(scAngle);
        const scDy = Math.sin(scAngle);
        const scPerpSign = sc.flipDirection ? 1 : -1;
        const scPerpX = -scDy * scPerpSign;
        const scPerpY = scDx * scPerpSign;
        const scVD = sc.viewDepth ?? 5000;
        const scMidX = (sc.start.x + sc.end.x) / 2;
        const scMidY = (sc.start.y + sc.end.y) / 2;
        return [
          sc.start,
          sc.end,
          { x: scMidX, y: scMidY },
          // View depth grip: midpoint of the far edge
          { x: scMidX + scPerpX * scVD, y: scMidY + scPerpY * scVD },
        ];
      }
      case 'space':
        // Space handles: label position (centroid) for dragging
        return [(shape as SpaceShape).labelPosition];
      case 'spot-elevation':
        // Spot elevation handles: marker position and label position
        return [
          (shape as SpotElevationShape).position,
          (shape as SpotElevationShape).labelPosition,
        ];
      case 'image': {
        const imgShape = shape as ImageShape;
        const tl = imgShape.position;
        const w = imgShape.width;
        const h = imgShape.height;
        const rot = imgShape.rotation || 0;
        const cos = Math.cos(rot);
        const sin = Math.sin(rot);
        const toWorld = (lx: number, ly: number) => ({
          x: tl.x + lx * cos - ly * sin,
          y: tl.y + lx * sin + ly * cos,
        });
        return [
          toWorld(0, 0),
          toWorld(w, 0),
          toWorld(w, h),
          toWorld(0, h),
          toWorld(w / 2, 0),
          toWorld(w, h / 2),
          toWorld(w / 2, h),
          toWorld(0, h / 2),
          toWorld(w / 2, h / 2),
        ];
      }
      default:
        return [];
    }
  }

  private drawImage(shape: ImageShape): void {
    const ctx = this.ctx;
    let img = this.imageCache.get(shape.id);

    if (!img) {
      // Create and cache the image element
      img = new Image();
      img.src = shape.imageData;
      this.imageCache.set(shape.id, img);
      // Request a re-render once the image loads
      img.onload = () => {
        // The canvas render loop will pick it up on next frame
      };
    }

    // Only draw if image has loaded
    if (!img.complete || img.naturalWidth === 0) return;

    ctx.save();

    // Apply opacity
    if (shape.opacity !== undefined && shape.opacity < 1) {
      ctx.globalAlpha = shape.opacity;
    }

    // Apply rotation around the top-left corner
    if (shape.rotation) {
      ctx.translate(shape.position.x, shape.position.y);
      ctx.rotate(shape.rotation);
      ctx.drawImage(img, 0, 0, shape.width, shape.height);
    } else {
      ctx.drawImage(img, shape.position.x, shape.position.y, shape.width, shape.height);
    }

    ctx.restore();
  }

  private drawHatch(shape: HatchShape, invertColors: boolean = false): void {
    const ctx = this.ctx;

    // Apply live preview override if this shape is selected and a preview pattern is active
    let effectiveShape = shape;
    if (this.previewPatternId && this.previewSelectedIds.has(shape.id)) {
      const previewPattern = BUILTIN_PATTERNS.find(p => p.id === this.previewPatternId)
        || this.customPatterns.find(p => p.id === this.previewPatternId);
      if (previewPattern) {
        const isBuiltin = BUILTIN_PATTERNS.some(p => p.id === previewPattern.id);
        effectiveShape = {
          ...shape,
          patternType: isBuiltin ? previewPattern.id as HatchPatternType : 'custom',
          customPatternId: isBuiltin ? undefined : previewPattern.id,
        };
      }
    }

    const { points, bulge, patternType, patternAngle, patternScale, fillColor, backgroundColor, customPatternId } = effectiveShape;
    const boundaryVisible = effectiveShape.boundaryVisible ?? true;
    const innerLoops = effectiveShape.innerLoops;

    if (points.length < 3) return;

    // Build outer boundary path (supports bulge/arc segments like polyline)
    const buildOuterPath = () => {
      ctx.moveTo(points[0].x, points[0].y);

      for (let i = 0; i < points.length - 1; i++) {
        const b = bulge?.[i] ?? 0;
        if (b !== 0) {
          const arc = bulgeToArc(points[i], points[i + 1], b);
          ctx.arc(arc.center.x, arc.center.y, arc.radius, arc.startAngle, arc.endAngle, arc.clockwise);
        } else {
          ctx.lineTo(points[i + 1].x, points[i + 1].y);
        }
      }

      // Close path (handle last segment bulge)
      const lastB = bulge?.[points.length - 1] ?? 0;
      if (lastB !== 0) {
        const arc = bulgeToArc(points[points.length - 1], points[0], lastB);
        ctx.arc(arc.center.x, arc.center.y, arc.radius, arc.startAngle, arc.endAngle, arc.clockwise);
      } else {
        ctx.closePath();
      }
    };

    // Build full path with inner loops (holes) using evenodd winding rule
    const buildPath = () => {
      ctx.beginPath();
      buildOuterPath();

      // Add inner loops (drawn in reverse winding for evenodd cutout)
      if (innerLoops && innerLoops.length > 0) {
        for (const loop of innerLoops) {
          if (loop.length < 3) continue;
          ctx.moveTo(loop[0].x, loop[0].y);
          for (let i = 1; i < loop.length; i++) {
            ctx.lineTo(loop[i].x, loop[i].y);
          }
          ctx.closePath();
        }
      }
    };

    // Step 1: Fill solid background if masking is on or backgroundColor is set
    if (backgroundColor) {
      buildPath();
      ctx.fillStyle = backgroundColor;
      ctx.fill('evenodd');
    }

    // Get bounding box
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of points) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }

    // Step 2: Render background pattern layer (if set)
    if (shape.bgPatternType) {
      const bgScale = shape.bgPatternScale ?? 1;
      const bgAngle = shape.bgPatternAngle ?? 0;
      let bgColor = shape.bgFillColor ?? '#808080';
      if (invertColors && bgColor === '#ffffff') bgColor = '#000000';

      ctx.save();
      buildPath();
      ctx.clip('evenodd');

      this.renderPatternLayer(
        shape.bgPatternType, bgAngle, bgScale, bgColor,
        shape.bgCustomPatternId, shape.style.strokeWidth,
        minX, minY, maxX, maxY
      );

      ctx.restore();
    }

    // Step 3: Render foreground pattern layer
    let patternColor = fillColor;
    if (invertColors && patternColor === '#ffffff') {
      patternColor = '#000000';
    }

    ctx.save();
    buildPath();
    ctx.clip('evenodd');

    this.renderPatternLayer(
      patternType, patternAngle, patternScale, patternColor,
      customPatternId, shape.style.strokeWidth,
      minX, minY, maxX, maxY
    );

    ctx.restore();

    // Step 4: Stroke boundary (only if visible)
    if (boundaryVisible) {
      ctx.beginPath();
      buildOuterPath();
      ctx.stroke();

      // Also stroke inner loops
      if (innerLoops && innerLoops.length > 0) {
        for (const loop of innerLoops) {
          if (loop.length < 3) continue;
          ctx.beginPath();
          ctx.moveTo(loop[0].x, loop[0].y);
          for (let i = 1; i < loop.length; i++) {
            ctx.lineTo(loop[i].x, loop[i].y);
          }
          ctx.closePath();
          ctx.stroke();
        }
      }
    }
  }

  /**
   * Render a single pattern layer within the current clip region
   */
  private renderPatternLayer(
    pType: HatchPatternType,
    pAngle: number,
    pScale: number,
    pColor: string,
    pCustomId: string | undefined,
    strokeWidth: number,
    minX: number, minY: number, maxX: number, maxY: number
  ): void {
    const ctx = this.ctx;

    if (pType === 'custom' && pCustomId) {
      const customPattern = this.getPatternById(pCustomId);
      if (customPattern) {
        if (isSvgHatchPattern(customPattern)) {
          this.drawSvgPattern(customPattern, minX, minY, maxX, maxY, pScale, pAngle);
        } else if (customPattern.lineFamilies.length > 0) {
          // Special case: insulation patterns get zigzag rendering (NEN standard)
          if (pCustomId === 'nen47-isolatie' || pCustomId === 'insulation') {
            this.drawInsulationZigzag(minX, minY, maxX, maxY, pScale, pAngle, pColor, strokeWidth);
          } else {
            this.drawCustomPatternLines(customPattern.lineFamilies, minX, minY, maxX, maxY, pScale, pAngle, pColor, strokeWidth);
          }
        } else {
          ctx.fillStyle = pColor;
          ctx.fill();
        }
      }
    } else if (pType === 'solid') {
      ctx.fillStyle = pColor;
      ctx.fill();
    } else if (pType === 'dots') {
      const spacing = 10 * pScale;
      const dotRadius = 1 * pScale;
      ctx.fillStyle = pColor;
      for (let x = minX; x <= maxX; x += spacing) {
        for (let y = minY; y <= maxY; y += spacing) {
          ctx.beginPath();
          ctx.arc(x, y, dotRadius, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    } else {
      const spacing = 10 * pScale;
      const angles: number[] = [];

      switch (pType) {
        case 'horizontal':
          angles.push(0);
          break;
        case 'vertical':
          angles.push(90);
          break;
        case 'diagonal':
          angles.push(pAngle);
          break;
        case 'crosshatch':
          angles.push(pAngle);
          angles.push(pAngle + 90);
          break;
      }

      ctx.strokeStyle = pColor;
      ctx.lineWidth = strokeWidth * 0.5;
      ctx.setLineDash([]);

      for (const angleDeg of angles) {
        this.drawLineFamilySimple(angleDeg, spacing, minX, minY, maxX, maxY);
      }
    }
  }

  /**
   * Draw a beam shape in plan view
   * Shows beam as a rectangle with optional centerline and label
   */
  private drawBeam(shape: BeamShape, invertColors: boolean = false): void {
    const viewMode = shape.viewMode || 'plan';

    if (viewMode === 'section') {
      this.drawBeamSection(shape, invertColors);
    } else if (viewMode === 'elevation') {
      this.drawBeamElevation(shape, invertColors);
    } else if (viewMode === 'side') {
      this.drawBeamSide(shape, invertColors);
    } else {
      this.drawBeamPlan(shape, invertColors);
    }
  }

  /** Draw beam in plan view (top-down rectangle, with miter polygon support) */
  private drawBeamPlan(shape: BeamShape, invertColors: boolean = false): void {
    // Delegate to arc renderer when the beam has a non-zero bulge
    if (shape.bulge && Math.abs(shape.bulge) > 0.0001) {
      this.drawArcBeam(shape, invertColors);
      return;
    }

    const ctx = this.ctx;
    const { start, end, showCenterline, showLabel, material } = shape;
    const startCap = shape.startCap || 'butt';
    const endCap = shape.endCap || 'butt';

    const originalLineWidth = ctx.lineWidth;
    if (material === 'concrete') {
      ctx.lineWidth = originalLineWidth * 1.5;
    } else if (material === 'timber') {
      ctx.lineWidth = originalLineWidth * 1.2;
    }

    // Compute beam polygon corners (handles miter caps)
    const corners = this.computeBeamCorners(shape);

    // Draw beam outline edges selectively: skip mitered edges to avoid visible
    // line at the intersection where two mitered beams meet.
    // Corner order: [startLeft(0), endLeft(1), endRight(2), startRight(3)]
    // Edges: 0->1 (left side), 1->2 (end cap), 2->3 (right side), 3->0 (start cap)
    const hasStartMiterBeam = startCap === 'miter';
    const hasEndMiterBeam = endCap === 'miter';

    // Left side edge: startLeft -> endLeft (always drawn)
    ctx.beginPath();
    ctx.moveTo(corners[0].x, corners[0].y);
    ctx.lineTo(corners[1].x, corners[1].y);
    ctx.stroke();

    // End cap edge: endLeft -> endRight (skip if end is mitered)
    if (!hasEndMiterBeam) {
      ctx.beginPath();
      ctx.moveTo(corners[1].x, corners[1].y);
      ctx.lineTo(corners[2].x, corners[2].y);
      ctx.stroke();
    }

    // Right side edge: endRight -> startRight (always drawn)
    ctx.beginPath();
    ctx.moveTo(corners[2].x, corners[2].y);
    ctx.lineTo(corners[3].x, corners[3].y);
    ctx.stroke();

    // Start cap edge: startRight -> startLeft (skip if start is mitered)
    if (!hasStartMiterBeam) {
      ctx.beginPath();
      ctx.moveTo(corners[3].x, corners[3].y);
      ctx.lineTo(corners[0].x, corners[0].y);
      ctx.stroke();
    }

    if (showCenterline) {
      ctx.save();
      ctx.setLineDash(this.getLineDash('dashdot'));
      ctx.strokeStyle = invertColors ? 'rgba(0, 0, 0, 0.4)' : 'rgba(255, 255, 255, 0.4)';
      ctx.lineWidth = originalLineWidth * 0.5;
      ctx.beginPath();
      ctx.moveTo(start.x, start.y);
      ctx.lineTo(end.x, end.y);
      ctx.stroke();
      ctx.restore();
    }

    if (showLabel) {
      this.drawBeamLabel(shape, invertColors);
    }

    ctx.lineWidth = originalLineWidth;
  }

  /**
   * Draw an arc beam shape (curved beam using bulge factor)
   */
  private drawArcBeam(shape: BeamShape, invertColors: boolean = false): void {
    const ctx = this.ctx;
    const { start, end, flangeWidth, showCenterline, showLabel, material, justification } = shape;
    const bulge = shape.bulge!;

    const originalLineWidth = ctx.lineWidth;
    if (material === 'concrete') {
      ctx.lineWidth = originalLineWidth * 1.5;
    } else if (material === 'timber') {
      ctx.lineWidth = originalLineWidth * 1.2;
    }

    const { center, radius, startAngle, endAngle, clockwise } = bulgeToArc(start, end, bulge);

    // Compute inner/outer radii based on justification
    let innerR: number;
    let outerR: number;
    if (justification === 'left') {
      innerR = radius;
      outerR = radius + flangeWidth;
    } else if (justification === 'right') {
      innerR = radius - flangeWidth;
      outerR = radius;
    } else {
      // center
      innerR = radius - flangeWidth / 2;
      outerR = radius + flangeWidth / 2;
    }

    // Ensure innerR is non-negative
    if (innerR < 0) innerR = 0;

    // Helper to build the beam arc path
    const buildArcPath = () => {
      ctx.beginPath();
      ctx.arc(center.x, center.y, outerR, startAngle, endAngle, clockwise);
      ctx.lineTo(center.x + innerR * Math.cos(endAngle), center.y + innerR * Math.sin(endAngle));
      ctx.arc(center.x, center.y, innerR, endAngle, startAngle, !clockwise);
      ctx.closePath();
    };

    // Draw outline
    buildArcPath();
    ctx.stroke();

    // Draw dashed centerline arc
    if (showCenterline) {
      ctx.save();
      ctx.setLineDash(this.getLineDash('dashdot'));
      ctx.strokeStyle = invertColors ? 'rgba(0, 0, 0, 0.4)' : 'rgba(255, 255, 255, 0.4)';
      ctx.lineWidth = originalLineWidth * 0.5;
      ctx.beginPath();
      ctx.arc(center.x, center.y, radius, startAngle, endAngle, clockwise);
      ctx.stroke();
      ctx.restore();
    }

    if (showLabel) {
      this.drawBeamLabel(shape, invertColors);
    }

    ctx.lineWidth = originalLineWidth;
  }

  /** Draw beam in section view (cross-section at midpoint) */
  private drawBeamSection(shape: BeamShape, invertColors: boolean = false): void {
    const ctx = this.ctx;
    const { start, end, profileType, profileParameters } = shape;

    const midX = (start.x + end.x) / 2;
    const midY = (start.y + end.y) / 2;

    try {
      const geometry = generateProfileGeometry(
        profileType as ProfileType,
        profileParameters as ParameterValues,
        { x: midX, y: midY },
        shape.rotation,
        1
      );

      for (let i = 0; i < geometry.outlines.length; i++) {
        const outline = geometry.outlines[i];
        const closed = geometry.closed[i];
        if (outline.length < 2) continue;

        ctx.beginPath();
        ctx.moveTo(outline[0].x, outline[0].y);
        for (let j = 1; j < outline.length; j++) {
          ctx.lineTo(outline[j].x, outline[j].y);
        }
        if (closed) ctx.closePath();
        ctx.stroke();
      }
    } catch {
      // Fallback: draw a simple rectangle
      this.drawBeamPlan(shape, invertColors);
      return;
    }

    if (shape.showLabel) {
      this.drawBeamLabel(shape, invertColors);
    }
  }

  /** Draw beam in elevation view (side view showing depth) */
  private drawBeamElevation(shape: BeamShape, invertColors: boolean = false): void {
    const ctx = this.ctx;
    const { start, end, profileParameters, material } = shape;

    // Use profile height (webHeight or height parameter) as the visible depth
    const depth = (profileParameters.webHeight as number)
      || (profileParameters.height as number)
      || (profileParameters.outerDiameter as number)
      || shape.flangeWidth;

    const beamAngle = Math.atan2(end.y - start.y, end.x - start.x);
    const halfDepth = depth / 2;
    const perpX = Math.sin(beamAngle) * halfDepth;
    const perpY = Math.cos(beamAngle) * halfDepth;

    const originalLineWidth = ctx.lineWidth;
    if (material === 'concrete') {
      ctx.lineWidth = originalLineWidth * 1.5;
    } else if (material === 'timber') {
      ctx.lineWidth = originalLineWidth * 1.2;
    }

    // Draw elevation outline (two parallel lines for top/bottom)
    ctx.beginPath();
    ctx.moveTo(start.x + perpX, start.y - perpY);
    ctx.lineTo(end.x + perpX, end.y - perpY);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(start.x - perpX, start.y + perpY);
    ctx.lineTo(end.x - perpX, end.y + perpY);
    ctx.stroke();

    // End caps
    ctx.beginPath();
    ctx.moveTo(start.x + perpX, start.y - perpY);
    ctx.lineTo(start.x - perpX, start.y + perpY);
    ctx.moveTo(end.x + perpX, end.y - perpY);
    ctx.lineTo(end.x - perpX, end.y + perpY);
    ctx.stroke();

    // Centerline
    if (shape.showCenterline) {
      ctx.save();
      ctx.setLineDash(this.getLineDash('dashdot'));
      ctx.strokeStyle = invertColors ? 'rgba(0, 0, 0, 0.4)' : 'rgba(255, 255, 255, 0.4)';
      ctx.lineWidth = originalLineWidth * 0.5;
      ctx.beginPath();
      ctx.moveTo(start.x, start.y);
      ctx.lineTo(end.x, end.y);
      ctx.stroke();
      ctx.restore();
    }

    if (shape.showLabel) {
      this.drawBeamLabel(shape, invertColors);
    }

    ctx.lineWidth = originalLineWidth;
  }

  /** Draw beam in side view (shows flange width as visible depth) */
  private drawBeamSide(shape: BeamShape, invertColors: boolean = false): void {
    const ctx = this.ctx;
    const { start, end, flangeWidth, material } = shape;

    // Side view shows flange width as the visible depth (perpendicular to elevation which shows web height)
    const depth = flangeWidth;

    const beamAngle = Math.atan2(end.y - start.y, end.x - start.x);
    const halfDepth = depth / 2;
    const perpX = Math.sin(beamAngle) * halfDepth;
    const perpY = Math.cos(beamAngle) * halfDepth;

    const originalLineWidth = ctx.lineWidth;
    if (material === 'concrete') {
      ctx.lineWidth = originalLineWidth * 1.5;
    } else if (material === 'timber') {
      ctx.lineWidth = originalLineWidth * 1.2;
    }

    // Draw side outline (two parallel lines for top/bottom of flange)
    ctx.beginPath();
    ctx.moveTo(start.x + perpX, start.y - perpY);
    ctx.lineTo(end.x + perpX, end.y - perpY);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(start.x - perpX, start.y + perpY);
    ctx.lineTo(end.x - perpX, end.y + perpY);
    ctx.stroke();

    // End caps
    ctx.beginPath();
    ctx.moveTo(start.x + perpX, start.y - perpY);
    ctx.lineTo(start.x - perpX, start.y + perpY);
    ctx.moveTo(end.x + perpX, end.y - perpY);
    ctx.lineTo(end.x - perpX, end.y + perpY);
    ctx.stroke();

    // Centerline
    if (shape.showCenterline) {
      ctx.save();
      ctx.setLineDash(this.getLineDash('dashdot'));
      ctx.strokeStyle = invertColors ? 'rgba(0, 0, 0, 0.4)' : 'rgba(255, 255, 255, 0.4)';
      ctx.lineWidth = originalLineWidth * 0.5;
      ctx.beginPath();
      ctx.moveTo(start.x, start.y);
      ctx.lineTo(end.x, end.y);
      ctx.stroke();
      ctx.restore();
    }

    if (shape.showLabel) {
      this.drawBeamLabel(shape, invertColors);
    }

    ctx.lineWidth = originalLineWidth;
  }

  /** Draw beam label at midpoint */
  private drawBeamLabel(shape: BeamShape, invertColors: boolean): void {
    const ctx = this.ctx;
    const { start, end, flangeWidth, labelText, presetName } = shape;
    const beamAngle = Math.atan2(end.y - start.y, end.x - start.x);
    const halfWidth = flangeWidth / 2;

    const beamLabel = labelText || presetName || `${Math.round(flangeWidth)}mm`;
    const midX = (start.x + end.x) / 2;
    const midY = (start.y + end.y) / 2;
    const zoom = ctx.getTransform().a / this.dpr;
    const fontSize = Math.max(10 / zoom, flangeWidth * 0.3);

    ctx.save();
    ctx.translate(midX, midY);
    let textAngle = beamAngle;
    if (textAngle > Math.PI / 2 || textAngle < -Math.PI / 2) {
      textAngle += Math.PI;
    }
    ctx.rotate(textAngle);

    let textColor = shape.style.strokeColor;
    if (invertColors && textColor === '#ffffff') {
      textColor = '#000000';
    }
    ctx.fillStyle = textColor;
    ctx.font = `${fontSize}px ${CAD_DEFAULT_FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(beamLabel, 0, -halfWidth - fontSize * 0.8);
    ctx.restore();
  }

  /**
   * Draw a gridline shape (structural grid / stramien)
   * Shows a dash-dot line with labeled circle(s) (bubbles) at the endpoints
   */
  private drawGridline(shape: GridlineShape, invertColors: boolean = false): void {
    const ctx = this.ctx;
    const { start, end, label, bubblePosition } = shape;

    // Scale bubble/text/extension so they appear at constant paper size across drawing scales
    const scaleFactor = LINE_DASH_REFERENCE_SCALE / this.drawingScale;
    const bubbleRadius = shape.bubbleRadius * scaleFactor;
    const fontSize = shape.fontSize * scaleFactor;

    const angle = Math.atan2(end.y - start.y, end.x - start.x);
    const dx = Math.cos(angle);
    const dy = Math.sin(angle);

    // Save original state
    const origLineWidth = ctx.lineWidth;

    // Line extends beyond start/end (at reference scale); bubble sits at the extended tip
    const ext = this.gridlineExtension * scaleFactor;
    ctx.save();
    ctx.setLineDash(this.getLineDash('dashdot'));
    ctx.beginPath();
    ctx.moveTo(start.x - dx * ext, start.y - dy * ext);
    ctx.lineTo(end.x + dx * ext, end.y + dy * ext);
    ctx.stroke();
    ctx.restore();

    // Draw bubble(s)
    ctx.setLineDash([]);
    ctx.lineWidth = origLineWidth;

    let textColor = shape.style.strokeColor;
    if (invertColors && textColor === '#ffffff') {
      textColor = '#000000';
    }

    const drawBubble = (cx: number, cy: number) => {
      // Draw circle
      ctx.beginPath();
      ctx.arc(cx, cy, bubbleRadius, 0, Math.PI * 2);
      ctx.stroke();

      // Draw label text centered in circle
      ctx.save();
      ctx.fillStyle = textColor;
      ctx.font = `${fontSize}px ${CAD_DEFAULT_FONT}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, cx, cy);
      ctx.restore();
    };

    if (bubblePosition === 'start' || bubblePosition === 'both') {
      // Bubble center at extended start (extension beyond start, plus bubble radius)
      drawBubble(start.x - dx * (ext + bubbleRadius), start.y - dy * (ext + bubbleRadius));
    }
    if (bubblePosition === 'end' || bubblePosition === 'both') {
      // Bubble center at extended end (extension beyond end, plus bubble radius)
      drawBubble(end.x + dx * (ext + bubbleRadius), end.y + dy * (ext + bubbleRadius));
    }
  }

  /**
   * Draw a level shape (horizontal reference plane: dashed line + right-side triangle marker)
   * Only shows the peil marker on the right (end) side with optional description text below.
   */
  private drawLevel(shape: LevelShape, invertColors: boolean = false): void {
    const ctx = this.ctx;
    const { start, end, label } = shape;

    // Scale marker/text so they appear at constant paper size across drawing scales
    const scaleFactor = LINE_DASH_REFERENCE_SCALE / this.drawingScale;
    const bubbleRadius = shape.bubbleRadius * scaleFactor;
    const fontSize = shape.fontSize * scaleFactor;

    const angle = Math.atan2(end.y - start.y, end.x - start.x);
    const dx = Math.cos(angle);
    const dy = Math.sin(angle);

    const origLineWidth = ctx.lineWidth;

    // Draw dashed line from start to end
    ctx.save();
    ctx.setLineDash(this.getLineDash('dashed'));
    ctx.beginPath();
    ctx.moveTo(start.x, start.y);
    ctx.lineTo(end.x, end.y);
    ctx.stroke();
    ctx.restore();

    // Draw right-side (end) triangle marker only
    ctx.setLineDash([]);
    ctx.lineWidth = origLineWidth;

    let textColor = shape.style.strokeColor;
    if (invertColors && textColor === '#ffffff') {
      textColor = '#000000';
    }

    // Triangle/arrow marker at the end of the line
    const sz = bubbleRadius * 0.7;
    const tipX = end.x;
    const tipY = end.y;
    // Perpendicular direction for triangle width
    const perpX = -dy;
    const perpY = dx;
    ctx.beginPath();
    ctx.moveTo(tipX, tipY); // Arrow tip touches the line end
    ctx.lineTo(tipX + dx * sz + perpX * sz * 0.4, tipY + dy * sz + perpY * sz * 0.4);
    ctx.lineTo(tipX + dx * sz - perpX * sz * 0.4, tipY + dy * sz - perpY * sz * 0.4);
    ctx.closePath();
    ctx.fillStyle = textColor;
    ctx.fill();
    ctx.stroke();

    // Peil value text to the right of the marker
    const textX = end.x + dx * (sz * 1.5 + bubbleRadius * 0.3);
    const textY = end.y + dy * (sz * 1.5 + bubbleRadius * 0.3);

    ctx.save();
    ctx.fillStyle = textColor;
    ctx.font = `${fontSize}px ${CAD_DEFAULT_FONT}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'bottom';

    // Build display text: peil label + NAP elevation when datum is set
    let displayText = label;
    if (this.seaLevelDatum !== 0) {
      // NAP elevation = seaLevelDatum (m) + peil (mm converted to m)
      const napElevationMM = (this.seaLevelDatum * 1000) + shape.elevation;
      const napPrecision = napElevationMM === Math.round(napElevationMM / 1000) * 1000 ? 1 : 2;
      const napStr = formatElevation(napElevationMM, this.unitSettings.numberFormat, napPrecision);
      displayText = `${label}  (NAP ${napStr} m)`;
    }
    ctx.fillText(displayText, textX, textY);

    // Optional description text below the peil value
    if (shape.description) {
      const descFontSize = fontSize * 0.8;
      ctx.font = `${descFontSize}px ${CAD_DEFAULT_FONT}`;
      ctx.textBaseline = 'top';
      ctx.fillText(shape.description, textX, textY + fontSize * 0.1);
    }
    ctx.restore();
  }

  /**
   * Draw a puntniveau shape (pile tip level zone: closed dashed polygon with elevation label)
   */
  private drawPuntniveau(shape: PuntniveauShape, invertColors: boolean = false): void {
    const ctx = this.ctx;
    const { points } = shape;

    if (points.length < 3) return;

    let strokeColor = shape.style.strokeColor;
    if (invertColors && strokeColor === '#ffffff') {
      strokeColor = '#000000';
    }

    // Draw closed polygon outline with dashed line, 0.50mm stroke width
    // (Label is now a separate linked TextShape — not rendered here)
    ctx.save();
    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = this.getLineWidth(shape.style.strokeWidth);
    ctx.setLineDash(this.getLineDash('dashed'));
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i++) {
      ctx.lineTo(points[i].x, points[i].y);
    }
    ctx.closePath();
    ctx.stroke();
    ctx.restore();
  }

  /**
   * Draw a pile shape using contourType + fillPattern from PileSymbolsDialog.
   * Replaces the legacy circle+cross and drawPileSymbol approaches.
   */
  private drawPile(shape: PileShape, invertColors: boolean = false): void {
    const ctx = this.ctx;
    const { position, diameter, label, fontSize } = shape;
    const radius = diameter / 2;
    const cx = position.x;
    const cy = position.y;
    const contourType = shape.contourType ?? 'circle';
    const fillPattern = shape.fillPattern ?? 6; // 6 = empty

    // Draw fill pattern — drawn first so contour is on top
    this.drawPileFillPattern(cx, cy, radius, fillPattern, contourType);

    if (contourType === 'square') {
      // Square pile: the square IS the main shape — no inner circle
      ctx.beginPath();
      ctx.rect(cx - radius, cy - radius, radius * 2, radius * 2);
      ctx.stroke();
    } else {
      // Draw inner circle (always present for circle-based contours)
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx.stroke();

      // Draw outer contour (if not just circle)
      this.drawPileContour(cx, cy, radius, contourType);
    }

    // Draw crosshair lines LAST — extending BEYOND the contour (like Revit reference)
    const outerExtent = contourType === 'circle' ? radius : contourType === 'square' ? radius : radius * 1.3;
    const crossExt = outerExtent * 1.25; // 25% beyond the outer contour edge
    ctx.beginPath();
    ctx.moveTo(cx - crossExt, cy);
    ctx.lineTo(cx + crossExt, cy);
    ctx.moveTo(cx, cy - crossExt);
    ctx.lineTo(cx, cy + crossExt);
    ctx.stroke();

    // Draw label at top-right of pile
    if (label) {
      let textColor = shape.style.strokeColor;
      if (invertColors && textColor === '#ffffff') {
        textColor = '#000000';
      }
      ctx.save();
      ctx.fillStyle = textColor;
      ctx.font = `${fontSize}px ${CAD_DEFAULT_FONT}`;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'bottom';
      ctx.fillText(label, cx + radius + fontSize * 0.2, cy - radius);
      ctx.restore();
    }
  }

  /**
   * Draw a pile preview symbol at given position (used during placement).
   * Mirrors drawPile logic but takes explicit parameters.
   */
  private drawPilePreviewSymbol(
    cx: number, cy: number, radius: number,
    contourType: string, fillPattern: number,
    label: string, fontSize: number,
  ): void {
    const ctx = this.ctx;

    // Fill pattern (drawn first so contour is on top)
    this.drawPileFillPattern(cx, cy, radius, fillPattern, contourType);

    if (contourType === 'square') {
      // Square pile: the square IS the main shape — no inner circle
      ctx.beginPath();
      ctx.rect(cx - radius, cy - radius, radius * 2, radius * 2);
      ctx.stroke();
    } else {
      // Inner circle
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx.stroke();

      // Outer contour
      this.drawPileContour(cx, cy, radius, contourType);
    }

    // Crosshair lines — extending BEYOND the contour
    const outerExtent = contourType === 'circle' ? radius : contourType === 'square' ? radius : radius * 1.3;
    const crossExt = outerExtent * 1.25;
    ctx.beginPath();
    ctx.moveTo(cx - crossExt, cy);
    ctx.lineTo(cx + crossExt, cy);
    ctx.moveTo(cx, cy - crossExt);
    ctx.lineTo(cx, cy + crossExt);
    ctx.stroke();

    // Label
    if (label) {
      ctx.save();
      ctx.fillStyle = ctx.strokeStyle as string;
      ctx.font = `${fontSize}px ${CAD_DEFAULT_FONT}`;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'bottom';
      ctx.fillText(label, cx + radius + fontSize * 0.2, cy - radius);
      ctx.restore();
    }
  }

  /**
   * Draw the outer contour shape for a pile symbol.
   * The inner circle is always drawn by the caller; this adds additional geometry.
   */
  private drawPileContour(cx: number, cy: number, radius: number, contourType: string): void {
    const ctx = this.ctx;
    switch (contourType) {
      case 'circle':
        // Outer contour IS the inner circle (already drawn by caller)
        break;

      case 'square':
        // Square pile is drawn directly by drawPile/drawPilePreviewSymbol as the main shape
        // (no outer contour needed — the square IS the pile)
        break;

      case 'diamond': {
        const d = radius * 1.3;
        ctx.beginPath();
        ctx.moveTo(cx, cy - d);
        ctx.lineTo(cx + d, cy);
        ctx.lineTo(cx, cy + d);
        ctx.lineTo(cx - d, cy);
        ctx.closePath();
        ctx.stroke();
        break;
      }

      case 'diamond-circle': {
        // Diamond around the circle
        const d = radius * 1.3;
        ctx.beginPath();
        ctx.moveTo(cx, cy - d);
        ctx.lineTo(cx + d, cy);
        ctx.lineTo(cx, cy + d);
        ctx.lineTo(cx - d, cy);
        ctx.closePath();
        ctx.stroke();
        break;
      }

      case 'double-circle': {
        // Outer circle larger than inner
        const outerR = radius * 1.3;
        ctx.beginPath();
        ctx.arc(cx, cy, outerR, 0, Math.PI * 2);
        ctx.stroke();
        break;
      }

      case 'triangle-circle': {
        // Equilateral triangle around the circle
        const tSize = radius * 1.3;
        const topY = cy - tSize * 0.7;
        const botY = cy + tSize * 0.9;
        const halfBase = tSize * 0.95;
        ctx.beginPath();
        ctx.moveTo(cx - halfBase, topY);
        ctx.lineTo(cx + halfBase, topY);
        ctx.lineTo(cx, botY);
        ctx.closePath();
        ctx.stroke();
        break;
      }

      case 'octagon': {
        const octR = radius * 1.2;
        ctx.beginPath();
        for (let i = 0; i < 8; i++) {
          const angle = (Math.PI * 2 * i) / 8 - Math.PI / 8;
          const px = cx + octR * Math.cos(angle);
          const py = cy + octR * Math.sin(angle);
          if (i === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.closePath();
        ctx.stroke();
        break;
      }

      default:
        break;
    }
  }

  /**
   * Draw a fill pattern inside the pile circle.
   * Uses pie-slice arcs and clip regions matching PileSymbolsDialog conventions.
   * Pattern numbers match the FILL_PATTERN_LABELS from PileSymbolsDialog.
   */
  private drawPileFillPattern(cx: number, cy: number, R: number, pattern: number, contourType: string = 'circle'): void {
    const ctx = this.ctx;
    const fillColor = ctx.strokeStyle as string;
    const isSquare = contourType === 'square';

    // Helper: apply the clip region (square or circle depending on contourType)
    const applyClip = () => {
      ctx.beginPath();
      if (isSquare) {
        ctx.rect(cx - R, cy - R, R * 2, R * 2);
      } else {
        ctx.arc(cx, cy, R, 0, Math.PI * 2);
      }
      ctx.clip();
    };

    // Helper: create a pie-slice path from startAngle to endAngle (degrees, 0=right, CW)
    const pieSlicePath = (startDeg: number, endDeg: number) => {
      const toRad = (d: number) => (d * Math.PI) / 180;
      const x1 = cx + R * Math.cos(toRad(startDeg));
      const y1 = cy + R * Math.sin(toRad(startDeg));
      ctx.moveTo(cx, cy);
      ctx.lineTo(x1, y1);
      ctx.arc(cx, cy, R, toRad(startDeg), toRad(endDeg), false);
      ctx.lineTo(cx, cy);
    };

    // Helper: fill a set of pie slices clipped to contour shape
    const fillSlices = (slices: [number, number][]) => {
      ctx.save();
      applyClip();
      // Fill slices
      ctx.fillStyle = fillColor;
      ctx.beginPath();
      for (const [start, end] of slices) {
        pieSlicePath(start, end);
      }
      ctx.fill();
      ctx.restore();
    };

    // Helper: fill a polygon clipped to contour shape
    const fillPolygonClipped = (points: [number, number][]) => {
      ctx.save();
      applyClip();
      ctx.fillStyle = fillColor;
      ctx.beginPath();
      for (let i = 0; i < points.length; i++) {
        if (i === 0) ctx.moveTo(points[i][0], points[i][1]);
        else ctx.lineTo(points[i][0], points[i][1]);
      }
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    };

    // Helper: fill a rect clipped to contour shape
    const fillRectClipped = (rx: number, ry: number, rw: number, rh: number) => {
      ctx.save();
      applyClip();
      ctx.fillStyle = fillColor;
      ctx.fillRect(rx, ry, rw, rh);
      ctx.restore();
    };

    switch (pattern) {
      case 1:
        // Top-left quadrant (180° to 270°)
        fillSlices([[180, 270]]);
        break;

      case 2:
        // Top half (180° to 360°)
        fillSlices([[180, 360]]);
        break;

      case 3:
        // Checkerboard: top-left + bottom-right quadrants
        fillSlices([[180, 270], [0, 90]]);
        break;

      case 4:
        // Fully filled
        ctx.save();
        ctx.fillStyle = fillColor;
        ctx.beginPath();
        if (isSquare) {
          ctx.rect(cx - R, cy - R, R * 2, R * 2);
        } else {
          ctx.arc(cx, cy, R, 0, Math.PI * 2);
        }
        ctx.fill();
        ctx.restore();
        break;

      case 5:
        // Three quadrants (not bottom-right = not 0-90)
        fillSlices([[90, 360]]);
        break;

      case 6:
        // Empty - no fill
        break;

      case 7:
        // Left half (90° to 270°)
        fillSlices([[90, 270]]);
        break;

      case 8: {
        // Vertical center strip
        const stripW = R * 0.6;
        fillRectClipped(cx - stripW / 2, cy - R, stripW, R * 2);
        break;
      }

      case 9:
        // Bottom-right quadrant (0° to 90°)
        fillSlices([[0, 90]]);
        break;

      case 10: {
        // Two vertical strips with gap
        const stripW = R * 0.3;
        const gap = R * 0.15;
        fillRectClipped(cx - gap - stripW, cy - R, stripW, R * 2);
        fillRectClipped(cx + gap, cy - R, stripW, R * 2);
        break;
      }

      case 11:
        // Top-left wedge/triangle
        fillPolygonClipped([[cx, cy], [cx - R, cy], [cx, cy - R]]);
        break;

      case 12:
        // Bowtie: left + right triangles pointing to center
        fillPolygonClipped([[cx - R, cy - R], [cx, cy], [cx - R, cy + R]]);
        fillPolygonClipped([[cx + R, cy - R], [cx, cy], [cx + R, cy + R]]);
        break;

      case 13:
        // Top small wedge
        fillPolygonClipped([[cx, cy], [cx - R * 0.5, cy - R], [cx + R * 0.5, cy - R]]);
        break;

      case 14:
        // Right half (270° to 450° = 270° to 90° going CW)
        fillSlices([[270, 450]]);
        break;

      case 15:
        // Bottom half (0° to 180°)
        fillSlices([[0, 180]]);
        break;

      case 16:
        // Bottom-left wedge
        fillPolygonClipped([[cx, cy], [cx - R, cy], [cx, cy + R]]);
        break;

      case 17:
        // Right half (same as 14)
        fillSlices([[270, 450]]);
        break;

      case 18:
        // Top-right quadrant (270° to 360°)
        fillSlices([[270, 360]]);
        break;

      case 19:
        // Bottom-left quadrant (90° to 180°)
        fillSlices([[90, 180]]);
        break;

      default:
        break;
    }
  }

  /**
   * Draw a CPT (Cone Penetration Test) marker shape
   */
  private drawCPT(shape: CPTShape, invertColors: boolean = false): void {
    const ctx = this.ctx;
    const { position, name, fontSize, markerSize } = shape;
    const sf = LINE_DASH_REFERENCE_SCALE / this.drawingScale;
    const ms = (markerSize || 300) * sf;

    // Draw inverted triangle marker (point down, like a cone tip)
    ctx.beginPath();
    ctx.moveTo(position.x, position.y + ms * 0.6);
    ctx.lineTo(position.x - ms * 0.5, position.y - ms * 0.4);
    ctx.lineTo(position.x + ms * 0.5, position.y - ms * 0.4);
    ctx.closePath();
    ctx.stroke();

    // Fill with black only when uitgevoerd (executed)
    if (shape.uitgevoerd) {
      ctx.save();
      ctx.fillStyle = '#000000';
      ctx.fill();
      ctx.restore();
    }

    let textColor = shape.style.strokeColor;
    if (invertColors && textColor === '#ffffff') {
      textColor = '#000000';
    }

    // Draw name below marker
    const labelFontSize = fontSize * sf;
    let labelY = position.y + ms * 0.6 + labelFontSize * 0.3;
    if (name) {
      ctx.save();
      ctx.fillStyle = textColor;
      ctx.font = `${labelFontSize}px ${CAD_DEFAULT_FONT}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillText(name, position.x, labelY);
      ctx.restore();
      labelY += labelFontSize * 1.2;
    }

    // Draw horizontal line under triangle tip if kleefmeting
    // Line is below the tip with a small gap, same width as the top base of the triangle
    if (shape.kleefmeting) {
      const lineGap = ms * 0.08;
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(position.x - ms * 0.5, position.y + ms * 0.6 + lineGap);
      ctx.lineTo(position.x + ms * 0.5, position.y + ms * 0.6 + lineGap);
      ctx.stroke();
      ctx.restore();
    }

    // Draw waterspanning "W" tag below name if present
    if (shape.waterspanning) {
      const tagFontSize = labelFontSize * 0.75;
      ctx.save();
      ctx.font = `${tagFontSize}px ${CAD_DEFAULT_FONT}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillStyle = invertColors ? '#555555' : '#aaaaaa';
      ctx.fillText('W', position.x, labelY);
      ctx.restore();
      labelY += tagFontSize * 1.2;
    }
  }

  /**
   * Draw a foundation zone (colored polygon region)
   */
  private drawFoundationZone(shape: FoundationZoneShape, _invertColors: boolean = false): void {
    const ctx = this.ctx;
    const { contourPoints, fillColor, fillOpacity } = shape;
    if (contourPoints.length < 3) return;

    ctx.save();
    ctx.beginPath();
    ctx.moveTo(contourPoints[0].x, contourPoints[0].y);
    for (let i = 1; i < contourPoints.length; i++) {
      ctx.lineTo(contourPoints[i].x, contourPoints[i].y);
    }
    ctx.closePath();

    // Fill with zone color
    const opacity = fillOpacity ?? 0.15;
    const color = fillColor || '#4488ff';
    ctx.fillStyle = color;
    ctx.globalAlpha = opacity;
    ctx.fill();
    ctx.globalAlpha = 1;

    // Stroke boundary dashed
    ctx.setLineDash([50, 30]);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  }

  /**
   * Draw a spot elevation shape (cross/circle marker with elevation label)
   */
  private drawSpotElevation(shape: SpotElevationShape, invertColors: boolean = false): void {
    const ctx = this.ctx;
    const { position, elevation, labelPosition, showLeader, fontSize: rawFontSize, markerSize: rawMarkerSize } = shape;

    // Scale marker/text for consistent paper size across drawing scales
    const scaleFactor = LINE_DASH_REFERENCE_SCALE / this.drawingScale;
    const markerSize = rawMarkerSize * scaleFactor;
    const fontSize = rawFontSize * scaleFactor;

    let textColor = shape.style.strokeColor;
    if (invertColors && textColor === '#ffffff') {
      textColor = '#000000';
    }

    // Draw cross marker at position
    ctx.beginPath();
    ctx.moveTo(position.x - markerSize, position.y);
    ctx.lineTo(position.x + markerSize, position.y);
    ctx.moveTo(position.x, position.y - markerSize);
    ctx.lineTo(position.x, position.y + markerSize);
    ctx.stroke();

    // Draw circle around cross
    ctx.beginPath();
    ctx.arc(position.x, position.y, markerSize * 0.8, 0, Math.PI * 2);
    ctx.stroke();

    // Draw leader line from marker to label
    if (showLeader) {
      ctx.beginPath();
      ctx.moveTo(position.x, position.y);
      ctx.lineTo(labelPosition.x, labelPosition.y);
      ctx.stroke();
    }

    // Draw elevation text at label position
    const label = formatElevation(elevation, this.unitSettings.numberFormat, 3);
    ctx.save();
    ctx.fillStyle = textColor;
    ctx.font = `${fontSize}px ${CAD_DEFAULT_FONT}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'bottom';
    ctx.fillText(label, labelPosition.x + markerSize * 0.3, labelPosition.y);
    ctx.restore();
  }

  /**
   * Compute the intersection of two infinite lines, each defined by a point and direction.
   * Returns null if lines are parallel.
   */
  private static lineIntersection(
    p1: { x: number; y: number }, d1: { x: number; y: number },
    p2: { x: number; y: number }, d2: { x: number; y: number }
  ): { x: number; y: number } | null {
    const cross = d1.x * d2.y - d1.y * d2.x;
    if (Math.abs(cross) < 1e-10) return null; // parallel
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const t = (dx * d2.y - dy * d2.x) / cross;
    return { x: p1.x + t * d1.x, y: p1.y + t * d1.y };
  }

  /**
   * Compute the four polygon corners of a wall, taking miter caps into account.
   *
   * Standard (butt) corners are perpendicular to the wall direction.
   * Miter corners are computed by intersecting this wall's outline edges with
   * the other wall's outline edges, producing an angled cut at the join.
   *
   * Corner order: [startLeft, endLeft, endRight, startRight]
   * ("left" = the +perpendicular side, "right" = the -perpendicular side)
   */
  private computeWallCorners(shape: WallShape): { x: number; y: number }[] {
    const { start, end, thickness, startCap, endCap, startMiterAngle, endMiterAngle, justification } = shape;
    const wallAngle = Math.atan2(end.y - start.y, end.x - start.x);
    const halfThick = thickness / 2;

    // Determine how much thickness goes to each side based on justification.
    // "left" means ALL thickness extends to the left side when looking from start toward end.
    // "right" means ALL thickness extends to the right side.
    // "center" (default) means half on each side.
    let leftThick: number;
    let rightThick: number;
    if (justification === 'left') {
      leftThick = thickness;
      rightThick = 0;
    } else if (justification === 'right') {
      leftThick = 0;
      rightThick = thickness;
    } else {
      // center (default)
      leftThick = halfThick;
      rightThick = halfThick;
    }

    // Perpendicular unit vector direction (left side = +perp, right side = -perp)
    const perpUnitX = Math.sin(wallAngle);
    const perpUnitY = Math.cos(wallAngle);

    // Wall direction unit vector
    const dirX = Math.cos(wallAngle);
    const dirY = Math.sin(wallAngle);

    // Default butt-cut corners using asymmetric offsets
    let startLeft  = { x: start.x + perpUnitX * leftThick, y: start.y - perpUnitY * leftThick };
    let startRight = { x: start.x - perpUnitX * rightThick, y: start.y + perpUnitY * rightThick };
    let endLeft    = { x: end.x + perpUnitX * leftThick,   y: end.y - perpUnitY * leftThick };
    let endRight   = { x: end.x - perpUnitX * rightThick,   y: end.y + perpUnitY * rightThick };

    // --- Miter at start ---
    if (startCap === 'miter' && startMiterAngle !== undefined) {
      // Compute miter corners by intersecting wall edges with the miter line.
      // The miter line passes through the junction along the bisector of the
      // two wall directions pointing AWAY from the junction.
      //
      // At the start endpoint, the wall direction (start->end) already points
      // away from the junction, so we use (dirX, dirY) as-is.
      const otherDirX = Math.cos(startMiterAngle);
      const otherDirY = Math.sin(startMiterAngle);

      // Bisector of wall direction and other wall direction (both pointing away from junction)
      const bisX = dirX + otherDirX;
      const bisY = dirY + otherDirY;
      const bisLen = Math.hypot(bisX, bisY);

      if (bisLen > 1e-10) {
        // Miter line direction = along the bisector (splits the angle equally)
        const miterDir = { x: bisX / bisLen, y: bisY / bisLen };
        const wallDir = { x: dirX, y: dirY };

        const leftInt = ShapeRenderer.lineIntersection(startLeft, wallDir, start, miterDir);
        const rightInt = ShapeRenderer.lineIntersection(startRight, wallDir, start, miterDir);

        // Miter limit: cap extension to 3x wall thickness to prevent extreme
        // spikes at very acute angles.
        const maxExt = thickness * 3;
        if (leftInt) {
          const dist = Math.hypot(leftInt.x - startLeft.x, leftInt.y - startLeft.y);
          if (dist < maxExt) startLeft = leftInt;
        }
        if (rightInt) {
          const dist = Math.hypot(rightInt.x - startRight.x, rightInt.y - startRight.y);
          if (dist < maxExt) startRight = rightInt;
        }
      }
    }

    // --- Miter at end ---
    if (endCap === 'miter' && endMiterAngle !== undefined) {
      const otherDirX = Math.cos(endMiterAngle);
      const otherDirY = Math.sin(endMiterAngle);

      // At the end endpoint, the wall direction (start->end) points TOWARD the
      // junction. We need the direction pointing AWAY from the junction, which
      // is the reverse: (-dirX, -dirY).
      const awayDirX = -dirX;
      const awayDirY = -dirY;

      // Bisector of this wall's away direction and other wall's away direction
      const bisX = awayDirX + otherDirX;
      const bisY = awayDirY + otherDirY;
      const bisLen = Math.hypot(bisX, bisY);

      if (bisLen > 1e-10) {
        // Miter line direction = along the bisector (splits the angle equally)
        const miterDir = { x: bisX / bisLen, y: bisY / bisLen };
        const wallDir = { x: dirX, y: dirY };

        const leftInt = ShapeRenderer.lineIntersection(endLeft, wallDir, end, miterDir);
        const rightInt = ShapeRenderer.lineIntersection(endRight, wallDir, end, miterDir);

        // Miter limit: cap extension to 3x wall thickness
        const maxExt = thickness * 3;
        if (leftInt) {
          const dist = Math.hypot(leftInt.x - endLeft.x, leftInt.y - endLeft.y);
          if (dist < maxExt) endLeft = leftInt;
        }
        if (rightInt) {
          const dist = Math.hypot(rightInt.x - endRight.x, rightInt.y - endRight.y);
          if (dist < maxExt) endRight = rightInt;
        }
      }
    }

    return [startLeft, endLeft, endRight, startRight];
  }

  /**
   * Compute the four polygon corners of a beam in plan view, taking miter caps into account.
   *
   * Uses the same miter algorithm as computeWallCorners but with flangeWidth as thickness.
   *
   * Corner order: [startLeft, endLeft, endRight, startRight]
   */
  private computeBeamCorners(shape: BeamShape): { x: number; y: number }[] {
    const { start, end, flangeWidth, startMiterAngle, endMiterAngle } = shape;
    const startCap = shape.startCap || 'butt';
    const endCap = shape.endCap || 'butt';
    const beamAngle = Math.atan2(end.y - start.y, end.x - start.x);
    const halfWidth = flangeWidth / 2;

    // Perpendicular offset (left side = +perp, right side = -perp)
    const perpX = Math.sin(beamAngle) * halfWidth;
    const perpY = Math.cos(beamAngle) * halfWidth;

    // Beam direction unit vector
    const dirX = Math.cos(beamAngle);
    const dirY = Math.sin(beamAngle);

    // Default butt-cut corners
    let startLeft  = { x: start.x + perpX, y: start.y - perpY };
    let startRight = { x: start.x - perpX, y: start.y + perpY };
    let endLeft    = { x: end.x + perpX,   y: end.y - perpY };
    let endRight   = { x: end.x - perpX,   y: end.y + perpY };

    // --- Miter at start ---
    // Bisector-based miter: same algorithm as computeWallCorners.
    // At the start, the beam direction (dirX, dirY) points away from the junction.
    if (startCap === 'miter' && startMiterAngle !== undefined) {
      const otherDirX = Math.cos(startMiterAngle);
      const otherDirY = Math.sin(startMiterAngle);

      const bisX = dirX + otherDirX;
      const bisY = dirY + otherDirY;
      const bisLen = Math.hypot(bisX, bisY);

      if (bisLen > 1e-10) {
        const miterDir = { x: bisX / bisLen, y: bisY / bisLen };
        const beamDir = { x: dirX, y: dirY };

        const newStartLeft = ShapeRenderer.lineIntersection(startLeft, beamDir, start, miterDir);
        const newStartRight = ShapeRenderer.lineIntersection(startRight, beamDir, start, miterDir);

        const maxExt = flangeWidth * 3;
        if (newStartLeft) {
          const dist = Math.hypot(newStartLeft.x - startLeft.x, newStartLeft.y - startLeft.y);
          if (dist < maxExt) startLeft = newStartLeft;
        }
        if (newStartRight) {
          const dist = Math.hypot(newStartRight.x - startRight.x, newStartRight.y - startRight.y);
          if (dist < maxExt) startRight = newStartRight;
        }
      }
    }

    // --- Miter at end ---
    // At the end, the beam direction points TOWARD the junction, so negate it.
    if (endCap === 'miter' && endMiterAngle !== undefined) {
      const otherDirX = Math.cos(endMiterAngle);
      const otherDirY = Math.sin(endMiterAngle);

      const awayDirX = -dirX;
      const awayDirY = -dirY;

      const bisX = awayDirX + otherDirX;
      const bisY = awayDirY + otherDirY;
      const bisLen = Math.hypot(bisX, bisY);

      if (bisLen > 1e-10) {
        const miterDir = { x: bisX / bisLen, y: bisY / bisLen };
        const beamDir = { x: dirX, y: dirY };

        const newEndLeft = ShapeRenderer.lineIntersection(endLeft, beamDir, end, miterDir);
        const newEndRight = ShapeRenderer.lineIntersection(endRight, beamDir, end, miterDir);

        const maxExt = flangeWidth * 3;
        if (newEndLeft) {
          const dist = Math.hypot(newEndLeft.x - endLeft.x, newEndLeft.y - endLeft.y);
          if (dist < maxExt) endLeft = newEndLeft;
        }
        if (newEndRight) {
          const dist = Math.hypot(newEndRight.x - endRight.x, newEndRight.y - endRight.y);
          if (dist < maxExt) endRight = newEndRight;
        }
      }
    }

    return [startLeft, endLeft, endRight, startRight];
  }

  /**
   * Draw a wall shape (rectangular plan view + optional centerline)
   */
  private drawWall(shape: WallShape, invertColors: boolean = false): void {
    // Delegate to arc renderer when the wall has a non-zero bulge
    if (shape.bulge && Math.abs(shape.bulge) > 0.0001) {
      this.drawArcWall(shape, invertColors);
      return;
    }

    // Wall System rendering: if the wall has a wallSystemId, render multi-layer view
    if (shape.wallSystemId) {
      const wallSystem = this.wallSystemTypes.find(ws => ws.id === shape.wallSystemId);
      if (wallSystem) {
        this.drawWallSystem(shape, wallSystem, invertColors);
        return;
      }
    }

    const ctx = this.ctx;
    const { start, end, showCenterline } = shape;

    const wallAngle = Math.atan2(end.y - start.y, end.x - start.x);

    // Compute wall polygon corners (handles miter caps)
    const corners = this.computeWallCorners(shape);

    // Draw wall outline edges selectively: skip mitered edges to avoid visible
    // line at the intersection where two mitered walls meet.
    // Corner order: [startLeft(0), endLeft(1), endRight(2), startRight(3)]
    // Edges: 0->1 (left side), 1->2 (end cap), 2->3 (right side), 3->0 (start cap)
    const hasStartMiter = shape.startCap === 'miter';
    const hasEndMiter = shape.endCap === 'miter';

    // Left side edge: startLeft -> endLeft (always drawn)
    ctx.beginPath();
    ctx.moveTo(corners[0].x, corners[0].y);
    ctx.lineTo(corners[1].x, corners[1].y);
    ctx.stroke();

    // End cap edge: endLeft -> endRight (skip if end is mitered)
    if (!hasEndMiter) {
      ctx.beginPath();
      ctx.moveTo(corners[1].x, corners[1].y);
      ctx.lineTo(corners[2].x, corners[2].y);
      ctx.stroke();
    }

    // Right side edge: endRight -> startRight (always drawn)
    ctx.beginPath();
    ctx.moveTo(corners[2].x, corners[2].y);
    ctx.lineTo(corners[3].x, corners[3].y);
    ctx.stroke();

    // Start cap edge: startRight -> startLeft (skip if start is mitered)
    if (!hasStartMiter) {
      ctx.beginPath();
      ctx.moveTo(corners[3].x, corners[3].y);
      ctx.lineTo(corners[0].x, corners[0].y);
      ctx.stroke();
    }

    // Resolve hatch settings from Drawing Standards materialHatchSettings via wall type's material.
    // Priority: material-name-specific setting > category default > built-in default
    let effectiveHatchType: string = shape.hatchType || 'none';
    let effectiveHatchAngle: number = shape.hatchAngle || 45;
    let effectiveHatchSpacing: number = shape.hatchSpacing || 50;
    let effectiveHatchColor: string | undefined = shape.hatchColor;
    let effectivePatternId: string | undefined;
    let effectiveBackgroundColor: string | undefined;

    if (shape.wallTypeId) {
      const wallType = this.wallTypes.find(wt => wt.id === shape.wallTypeId);
      if (wallType) {
        // Check for material-name-specific override first, then fall back to category
        const matSetting = this.materialHatchSettings[wallType.name]
          || this.materialHatchSettings[wallType.material]
          || DEFAULT_MATERIAL_HATCH_SETTINGS[wallType.material];
        if (matSetting) {
          effectiveHatchType = matSetting.hatchType;
          effectiveHatchAngle = matSetting.hatchAngle;
          effectiveHatchSpacing = matSetting.hatchSpacing;
          effectiveHatchColor = matSetting.hatchColor;
          effectivePatternId = matSetting.hatchPatternId;
          effectiveBackgroundColor = matSetting.backgroundColor;
        }
      }
    }

    // Hatch fill
    if ((effectiveHatchType && effectiveHatchType !== 'none') || effectivePatternId) {
      const strokeWidth = ctx.lineWidth;
      ctx.save();
      // Clip to wall polygon
      ctx.beginPath();
      ctx.moveTo(corners[0].x, corners[0].y);
      ctx.lineTo(corners[1].x, corners[1].y);
      ctx.lineTo(corners[2].x, corners[2].y);
      ctx.lineTo(corners[3].x, corners[3].y);
      ctx.closePath();
      ctx.clip();

      // Fill solid background color first (under hatch lines)
      if (effectiveBackgroundColor) {
        ctx.fillStyle = effectiveBackgroundColor;
        ctx.beginPath();
        ctx.moveTo(corners[0].x, corners[0].y);
        ctx.lineTo(corners[1].x, corners[1].y);
        ctx.lineTo(corners[2].x, corners[2].y);
        ctx.lineTo(corners[3].x, corners[3].y);
        ctx.closePath();
        ctx.fill();
      }

      const hatchColor = effectiveHatchColor || ctx.strokeStyle;
      const spacing = effectiveHatchSpacing || 50;
      ctx.strokeStyle = hatchColor as string;
      ctx.lineWidth = strokeWidth * 0.5;
      ctx.setLineDash([]);

      const minX = Math.min(...corners.map(c => c.x));
      const minY = Math.min(...corners.map(c => c.y));
      const maxX = Math.max(...corners.map(c => c.x));
      const maxY = Math.max(...corners.map(c => c.y));

      // Make hatch perpendicular to wall direction
      const wallAngleDeg = wallAngle * 180 / Math.PI;

      // If we have a custom pattern ID, render its line families directly
      const customPattern = effectivePatternId ? this.getPatternById(effectivePatternId) : undefined;
      if (customPattern && customPattern.lineFamilies.length > 0) {
        // Special case: insulation patterns get zigzag rendering (NEN standard)
        if (effectivePatternId === 'nen47-isolatie' || effectivePatternId === 'insulation') {
          const patternScale = spacing / 10;
          this.drawInsulationZigzag(
            minX, minY, maxX, maxY,
            patternScale,
            wallAngleDeg,
            hatchColor as string,
            strokeWidth,
            shape.thickness
          );
        } else {
          // Custom pattern with line families: render with drawCustomPatternLines
          const patternScale = spacing / 10; // Scale from pattern units to world units
          this.drawCustomPatternLines(
            customPattern.lineFamilies,
            minX, minY, maxX, maxY,
            patternScale,
            wallAngleDeg, // Rotate pattern to align with wall
            hatchColor as string,
            strokeWidth
          );
        }
      } else if (customPattern && customPattern.lineFamilies.length === 0) {
        // Solid fill pattern (e.g., NEN47-5 concrete, NEN47-18 steel)
        ctx.fillStyle = hatchColor as string;
        ctx.beginPath();
        ctx.moveTo(corners[0].x, corners[0].y);
        ctx.lineTo(corners[1].x, corners[1].y);
        ctx.lineTo(corners[2].x, corners[2].y);
        ctx.lineTo(corners[3].x, corners[3].y);
        ctx.closePath();
        ctx.fill();
      } else {
        // Fallback to basic hatch types
        const baseAngle = (effectiveHatchAngle || 45) + wallAngleDeg;

        if (effectiveHatchType === 'solid') {
          ctx.fillStyle = hatchColor as string;
          ctx.beginPath();
          ctx.moveTo(corners[0].x, corners[0].y);
          ctx.lineTo(corners[1].x, corners[1].y);
          ctx.lineTo(corners[2].x, corners[2].y);
          ctx.lineTo(corners[3].x, corners[3].y);
          ctx.closePath();
          ctx.fill();
        } else if (effectiveHatchType === 'diagonal') {
          this.drawLineFamilySimple(baseAngle, spacing, minX, minY, maxX, maxY);
        } else if (effectiveHatchType === 'crosshatch') {
          this.drawLineFamilySimple(baseAngle, spacing, minX, minY, maxX, maxY);
          this.drawLineFamilySimple(baseAngle + 90, spacing, minX, minY, maxX, maxY);
        } else if (effectiveHatchType === 'horizontal') {
          this.drawLineFamilySimple(wallAngleDeg + 90, spacing, minX, minY, maxX, maxY);
        }
      }

      ctx.restore();
    }

    // Draw centerline (dashed)
    if (showCenterline) {
      const origLineWidth = ctx.lineWidth;
      ctx.save();
      ctx.setLineDash(this.getLineDash('dashdot'));
      let centerColor = 'rgba(255, 255, 255, 0.4)';
      if (invertColors) {
        centerColor = 'rgba(0, 0, 0, 0.4)';
      }
      ctx.strokeStyle = centerColor;
      ctx.lineWidth = origLineWidth * 0.5;
      ctx.beginPath();
      ctx.moveTo(start.x, start.y);
      ctx.lineTo(end.x, end.y);
      ctx.stroke();
      ctx.restore();
    }
  }

  /**
   * Draw an arc wall shape (curved wall using bulge factor)
   */
  private drawArcWall(shape: WallShape, invertColors: boolean = false): void {
    const ctx = this.ctx;
    const { start, end, thickness, showCenterline, justification } = shape;
    const bulge = shape.bulge!;

    const { center, radius, startAngle, endAngle, clockwise } = bulgeToArc(start, end, bulge);

    // Compute inner/outer radii based on justification
    let innerR: number;
    let outerR: number;
    if (justification === 'left') {
      innerR = radius;
      outerR = radius + thickness;
    } else if (justification === 'right') {
      innerR = radius - thickness;
      outerR = radius;
    } else {
      // center
      innerR = radius - thickness / 2;
      outerR = radius + thickness / 2;
    }

    // Ensure innerR is non-negative
    if (innerR < 0) innerR = 0;

    const hasStartMiter = shape.startCap === 'miter';
    const hasEndMiter = shape.endCap === 'miter';

    // Helper to build the full closed wall arc path (used for hatch clipping)
    const buildArcPath = () => {
      ctx.beginPath();
      ctx.arc(center.x, center.y, outerR, startAngle, endAngle, clockwise);
      // End cap (radial line from outer to inner at endAngle)
      ctx.lineTo(center.x + innerR * Math.cos(endAngle), center.y + innerR * Math.sin(endAngle));
      ctx.arc(center.x, center.y, innerR, endAngle, startAngle, !clockwise);
      // Start cap (radial line from inner to outer at startAngle) - closePath handles this
      ctx.closePath();
    };

    // Draw outline edges selectively: skip mitered end caps to avoid visible
    // line at the intersection where a mitered arc wall meets another wall.
    // Outer arc
    ctx.beginPath();
    ctx.arc(center.x, center.y, outerR, startAngle, endAngle, clockwise);
    ctx.stroke();

    // End cap (radial line from outer to inner at endAngle) - skip if mitered
    if (!hasEndMiter) {
      ctx.beginPath();
      ctx.moveTo(center.x + outerR * Math.cos(endAngle), center.y + outerR * Math.sin(endAngle));
      ctx.lineTo(center.x + innerR * Math.cos(endAngle), center.y + innerR * Math.sin(endAngle));
      ctx.stroke();
    }

    // Inner arc (reverse direction)
    ctx.beginPath();
    ctx.arc(center.x, center.y, innerR, endAngle, startAngle, !clockwise);
    ctx.stroke();

    // Start cap (radial line from inner to outer at startAngle) - skip if mitered
    if (!hasStartMiter) {
      ctx.beginPath();
      ctx.moveTo(center.x + innerR * Math.cos(startAngle), center.y + innerR * Math.sin(startAngle));
      ctx.lineTo(center.x + outerR * Math.cos(startAngle), center.y + outerR * Math.sin(startAngle));
      ctx.stroke();
    }

    // Resolve hatch settings from Drawing Standards materialHatchSettings via wall type's material
    let effectiveHatchType: string = shape.hatchType || 'none';
    let effectiveHatchSpacing: number = shape.hatchSpacing || 50;
    let effectiveHatchColor: string | undefined = shape.hatchColor;
    let effectiveBackgroundColor: string | undefined;
    let effectivePatternId: string | undefined;

    if (shape.wallTypeId) {
      const wallType = this.wallTypes.find(wt => wt.id === shape.wallTypeId);
      if (wallType) {
        const matSetting = this.materialHatchSettings[wallType.name]
          || this.materialHatchSettings[wallType.material]
          || DEFAULT_MATERIAL_HATCH_SETTINGS[wallType.material];
        if (matSetting) {
          effectiveHatchType = matSetting.hatchType;
          effectiveHatchSpacing = matSetting.hatchSpacing;
          effectiveHatchColor = matSetting.hatchColor;
          effectivePatternId = matSetting.hatchPatternId;
          effectiveBackgroundColor = matSetting.backgroundColor;
        }
      }
    }

    // Hatch fill
    if ((effectiveHatchType && effectiveHatchType !== 'none') || effectivePatternId) {
      const strokeWidth = ctx.lineWidth;
      ctx.save();

      // Clip to wall arc path
      buildArcPath();
      ctx.clip();

      // Fill solid background color first (under hatch lines)
      if (effectiveBackgroundColor) {
        ctx.fillStyle = effectiveBackgroundColor;
        buildArcPath();
        ctx.fill();
      }

      const hatchColor = effectiveHatchColor || ctx.strokeStyle;
      const spacing = effectiveHatchSpacing || 50;
      ctx.strokeStyle = hatchColor as string;
      ctx.lineWidth = strokeWidth * 0.5;
      ctx.setLineDash([]);

      // Check for custom pattern
      const customPattern = effectivePatternId ? this.getPatternById(effectivePatternId) : undefined;
      if (customPattern && customPattern.lineFamilies.length > 0) {
        // For custom patterns on arc walls, use bounding box approach
        const bboxPad = outerR;
        const minX = center.x - bboxPad;
        const minY = center.y - bboxPad;
        const maxX = center.x + bboxPad;
        const maxY = center.y + bboxPad;
        const patternScale = spacing / 10;
        // Special case: insulation patterns get zigzag rendering (NEN standard)
        if (effectivePatternId === 'nen47-isolatie' || effectivePatternId === 'insulation') {
          this.drawInsulationZigzagArc(
            center, innerR, outerR,
            startAngle, endAngle, clockwise,
            hatchColor as string,
            strokeWidth
          );
        } else {
          this.drawCustomPatternLines(
            customPattern.lineFamilies,
            minX, minY, maxX, maxY,
            patternScale,
            0,
            hatchColor as string,
            strokeWidth
          );
        }
      } else if (customPattern && customPattern.lineFamilies.length === 0) {
        // Solid fill pattern
        ctx.fillStyle = hatchColor as string;
        buildArcPath();
        ctx.fill();
      } else if (effectiveHatchType === 'solid') {
        ctx.fillStyle = hatchColor as string;
        buildArcPath();
        ctx.fill();
      } else {
        // Draw radial hatch lines for arc walls
        const angularStep = spacing / radius;
        // Determine angular sweep direction
        const step = clockwise ? -angularStep : angularStep;
        const isInRange = (angle: number) => {
          if (!clockwise) {
            // CCW: sweep from startAngle to endAngle
            let normalizedAngle = angle - startAngle;
            let normalizedEnd = endAngle - startAngle;
            if (normalizedEnd < 0) normalizedEnd += Math.PI * 2;
            if (normalizedAngle < 0) normalizedAngle += Math.PI * 2;
            return normalizedAngle <= normalizedEnd + 0.0001;
          } else {
            // CW: sweep from startAngle to endAngle (decreasing)
            let normalizedAngle = startAngle - angle;
            let normalizedEnd = startAngle - endAngle;
            if (normalizedEnd < 0) normalizedEnd += Math.PI * 2;
            if (normalizedAngle < 0) normalizedAngle += Math.PI * 2;
            return normalizedAngle <= normalizedEnd + 0.0001;
          }
        };

        ctx.beginPath();
        let a = startAngle + step; // skip the first line (it's the start cap)
        for (let i = 0; i < 10000; i++) {
          if (!isInRange(a)) break;
          ctx.moveTo(center.x + innerR * Math.cos(a), center.y + innerR * Math.sin(a));
          ctx.lineTo(center.x + outerR * Math.cos(a), center.y + outerR * Math.sin(a));
          a += step;
        }
        ctx.stroke();
      }

      ctx.restore();
    }

    // Draw dashed centerline arc
    if (showCenterline) {
      const origLineWidth = ctx.lineWidth;
      ctx.save();
      ctx.setLineDash(this.getLineDash('dashdot'));
      let centerColor = 'rgba(255, 255, 255, 0.4)';
      if (invertColors) {
        centerColor = 'rgba(0, 0, 0, 0.4)';
      }
      ctx.strokeStyle = centerColor;
      ctx.lineWidth = origLineWidth * 0.5;
      ctx.beginPath();
      ctx.arc(center.x, center.y, radius, startAngle, endAngle, clockwise);
      ctx.stroke();
      ctx.restore();
    }
  }

  /**
   * Draw a wall with a multi-layered wall system (HSB, metal stud, curtain wall, etc.)
   * Shows layers as parallel lines with different colors and studs as rectangles.
   */
  private drawWallSystem(shape: WallShape, system: WallSystemType, invertColors: boolean = false): void {
    const ctx = this.ctx;
    const { start, end, showCenterline } = shape;

    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const wallAngle = Math.atan2(dy, dx);
    const wallLength = Math.sqrt(dx * dx + dy * dy);

    // Perpendicular direction (left side when looking from start to end)
    const perpX = Math.sin(wallAngle);
    const perpY = -Math.cos(wallAngle);

    // Direction along wall
    const dirX = Math.cos(wallAngle);
    const dirY = Math.sin(wallAngle);

    // Calculate layer offsets from centerline
    const layers = calculateLayerOffsets(system);
    const totalThickness = layers.reduce((sum, l) => sum + l.thickness, 0);
    const halfTotal = totalThickness / 2;

    const strokeWidth = ctx.lineWidth;

    // --- Draw layers as colored bands ---
    let accumulatedOffset = -halfTotal;
    for (const layer of layers) {
      const layerStart = accumulatedOffset;
      const layerEnd = accumulatedOffset + layer.thickness;
      accumulatedOffset = layerEnd;

      // Skip very thin layers (membranes) at low zoom
      if (layer.thickness < 1 && this._currentZoom < 0.5) continue;

      // Four corners of this layer band
      const sl = { x: start.x + perpX * layerStart, y: start.y + perpY * layerStart };
      const sr = { x: start.x + perpX * layerEnd, y: start.y + perpY * layerEnd };
      const el = { x: end.x + perpX * layerStart, y: end.y + perpY * layerStart };
      const er = { x: end.x + perpX * layerEnd, y: end.y + perpY * layerEnd };

      // Fill layer
      ctx.save();
      ctx.fillStyle = invertColors ? '#ffffff' : layer.color;
      ctx.globalAlpha = layer.function === 'air-gap' ? 0.15 : 0.5;
      ctx.beginPath();
      ctx.moveTo(sl.x, sl.y);
      ctx.lineTo(el.x, el.y);
      ctx.lineTo(er.x, er.y);
      ctx.lineTo(sr.x, sr.y);
      ctx.closePath();
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.restore();

      // Stroke layer boundary lines
      ctx.beginPath();
      ctx.moveTo(sl.x, sl.y);
      ctx.lineTo(el.x, el.y);
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(sr.x, sr.y);
      ctx.lineTo(er.x, er.y);
      ctx.stroke();
    }

    // --- Draw end caps ---
    const outerStart1 = { x: start.x + perpX * (-halfTotal), y: start.y + perpY * (-halfTotal) };
    const outerStart2 = { x: start.x + perpX * halfTotal, y: start.y + perpY * halfTotal };
    const outerEnd1 = { x: end.x + perpX * (-halfTotal), y: end.y + perpY * (-halfTotal) };
    const outerEnd2 = { x: end.x + perpX * halfTotal, y: end.y + perpY * halfTotal };

    if (shape.startCap !== 'miter') {
      ctx.beginPath();
      ctx.moveTo(outerStart1.x, outerStart1.y);
      ctx.lineTo(outerStart2.x, outerStart2.y);
      ctx.stroke();
    }
    if (shape.endCap !== 'miter') {
      ctx.beginPath();
      ctx.moveTo(outerEnd1.x, outerEnd1.y);
      ctx.lineTo(outerEnd2.x, outerEnd2.y);
      ctx.stroke();
    }

    // --- Draw studs at grid positions ---
    const gridData = generateWallSystemGrid(shape, system);

    // Find the structural layer for stud placement
    const structuralLayer = layers.find(l => l.function === 'structure');
    const structStart = structuralLayer ? structuralLayer.offset - structuralLayer.thickness / 2 : -halfTotal;
    const structEnd = structuralLayer ? structuralLayer.offset + structuralLayer.thickness / 2 : halfTotal;

    for (const studPos of gridData.studs) {
      // Skip studs at the very start and end (they're the wall end caps)
      if (studPos.positionAlongWall <= 0 || studPos.positionAlongWall >= wallLength) continue;

      const stud = studPos.stud;
      const halfW = stud.width / 2;

      // Stud rectangle: along wall = studWidth, perpendicular = stud depth within structural layer
      const cx = studPos.worldPosition.x;
      const cy = studPos.worldPosition.y;

      // Determine perpendicular extent (stud spans the structural layer)
      const studPerpStart = structStart;
      const studPerpEnd = structEnd;

      const c1 = { x: cx - dirX * halfW + perpX * studPerpStart, y: cy - dirY * halfW + perpY * studPerpStart };
      const c2 = { x: cx + dirX * halfW + perpX * studPerpStart, y: cy + dirY * halfW + perpY * studPerpStart };
      const c3 = { x: cx + dirX * halfW + perpX * studPerpEnd, y: cy + dirY * halfW + perpY * studPerpEnd };
      const c4 = { x: cx - dirX * halfW + perpX * studPerpEnd, y: cy - dirY * halfW + perpY * studPerpEnd };

      // Check if this stud is the selected sub-element
      const isSelected = this.selectedWallSubElement?.wallId === shape.id
        && this.selectedWallSubElement?.type === 'stud'
        && this.selectedWallSubElement?.key === studPos.key;

      ctx.save();
      ctx.fillStyle = isSelected ? '#00ff88' : (invertColors ? '#333333' : stud.color);
      ctx.globalAlpha = isSelected ? 0.7 : 0.6;
      ctx.beginPath();
      ctx.moveTo(c1.x, c1.y);
      ctx.lineTo(c2.x, c2.y);
      ctx.lineTo(c3.x, c3.y);
      ctx.lineTo(c4.x, c4.y);
      ctx.closePath();
      ctx.fill();
      ctx.globalAlpha = 1;

      // Stroke stud outline
      ctx.strokeStyle = isSelected ? '#00ff88' : ctx.strokeStyle;
      ctx.lineWidth = strokeWidth * 0.5;
      ctx.stroke();
      ctx.restore();
    }

    // --- Draw panel highlights for selected panels ---
    if (this.selectedWallSubElement?.wallId === shape.id && this.selectedWallSubElement?.type === 'panel') {
      for (const panelPos of gridData.panels) {
        if (panelPos.key !== this.selectedWallSubElement.key) continue;

        const halfLen = (panelPos.endAlongWall - panelPos.startAlongWall) / 2;
        const cx = panelPos.worldCenter.x;
        const cy = panelPos.worldCenter.y;

        const c1 = { x: cx - dirX * halfLen + perpX * structStart, y: cy - dirY * halfLen + perpY * structStart };
        const c2 = { x: cx + dirX * halfLen + perpX * structStart, y: cy + dirY * halfLen + perpY * structStart };
        const c3 = { x: cx + dirX * halfLen + perpX * structEnd, y: cy + dirY * halfLen + perpY * structEnd };
        const c4 = { x: cx - dirX * halfLen + perpX * structEnd, y: cy - dirY * halfLen + perpY * structEnd };

        ctx.save();
        ctx.fillStyle = '#00ff88';
        ctx.globalAlpha = 0.3;
        ctx.beginPath();
        ctx.moveTo(c1.x, c1.y);
        ctx.lineTo(c2.x, c2.y);
        ctx.lineTo(c3.x, c3.y);
        ctx.lineTo(c4.x, c4.y);
        ctx.closePath();
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.strokeStyle = '#00ff88';
        ctx.lineWidth = strokeWidth * 0.8;
        ctx.stroke();
        ctx.restore();
      }
    }

    // --- Draw openings ---
    if (shape.wallSystemOpenings) {
      for (const opening of shape.wallSystemOpenings) {
        const openingPos = opening.positionType === 'fraction'
          ? opening.position * wallLength
          : opening.position;
        const halfOpenW = opening.width / 2;

        // Opening clears through the full wall thickness
        const o1 = {
          x: start.x + dirX * (openingPos - halfOpenW) + perpX * (-halfTotal),
          y: start.y + dirY * (openingPos - halfOpenW) + perpY * (-halfTotal),
        };
        const o2 = {
          x: start.x + dirX * (openingPos + halfOpenW) + perpX * (-halfTotal),
          y: start.y + dirY * (openingPos + halfOpenW) + perpY * (-halfTotal),
        };
        const o3 = {
          x: start.x + dirX * (openingPos + halfOpenW) + perpX * halfTotal,
          y: start.y + dirY * (openingPos + halfOpenW) + perpY * halfTotal,
        };
        const o4 = {
          x: start.x + dirX * (openingPos - halfOpenW) + perpX * halfTotal,
          y: start.y + dirY * (openingPos - halfOpenW) + perpY * halfTotal,
        };

        // Clear the opening area (draw with background color)
        ctx.save();
        ctx.fillStyle = invertColors ? '#ffffff' : '#1a1a2e';
        ctx.beginPath();
        ctx.moveTo(o1.x, o1.y);
        ctx.lineTo(o2.x, o2.y);
        ctx.lineTo(o3.x, o3.y);
        ctx.lineTo(o4.x, o4.y);
        ctx.closePath();
        ctx.fill();

        // Draw frame lines
        ctx.strokeStyle = invertColors ? '#333333' : '#ffffff';
        ctx.lineWidth = strokeWidth * 0.5;
        ctx.beginPath();
        // Left jamb
        ctx.moveTo(o1.x, o1.y);
        ctx.lineTo(o4.x, o4.y);
        // Right jamb
        ctx.moveTo(o2.x, o2.y);
        ctx.lineTo(o3.x, o3.y);
        ctx.stroke();
        ctx.restore();
      }
    }

    // Draw centerline (dashed)
    if (showCenterline) {
      const origLineWidth = ctx.lineWidth;
      ctx.save();
      ctx.setLineDash(this.getLineDash('dashdot'));
      const centerColor = invertColors ? 'rgba(0, 0, 0, 0.4)' : 'rgba(255, 255, 255, 0.4)';
      ctx.strokeStyle = centerColor;
      ctx.lineWidth = origLineWidth * 0.5;
      ctx.beginPath();
      ctx.moveTo(start.x, start.y);
      ctx.lineTo(end.x, end.y);
      ctx.stroke();
      ctx.restore();
    }
  }

  /**
   * Draw a slab shape (closed polygon with hatch fill)
   */
  private drawSlab(shape: SlabShape, invertColors: boolean = false): void {
    const ctx = this.ctx;
    const { points } = shape;

    if (points.length < 3) return;

    // Resolve hatch from materialHatchSettings via the slab's material
    const matSetting = this.materialHatchSettings[shape.material] || DEFAULT_MATERIAL_HATCH_SETTINGS[shape.material] || DEFAULT_MATERIAL_HATCH_SETTINGS.generic;
    const effectiveHatchType = matSetting.hatchType || 'none';
    const effectiveHatchAngle = matSetting.hatchAngle ?? 45;
    const effectiveHatchSpacing = matSetting.hatchSpacing || 100;
    const effectiveHatchColor = matSetting.hatchColor;
    const effectivePatternId = matSetting.hatchPatternId;
    const effectiveBackgroundColor = matSetting.backgroundColor;

    // Draw slab outline (closed polygon)
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i++) {
      ctx.lineTo(points[i].x, points[i].y);
    }
    ctx.closePath();
    ctx.stroke();

    // Hatch fill
    if ((effectiveHatchType && effectiveHatchType !== 'none') || effectivePatternId) {
      const strokeWidth = ctx.lineWidth;
      ctx.save();

      // Clip to slab polygon
      ctx.beginPath();
      ctx.moveTo(points[0].x, points[0].y);
      for (let i = 1; i < points.length; i++) {
        ctx.lineTo(points[i].x, points[i].y);
      }
      ctx.closePath();
      ctx.clip();

      // Fill solid background color first (under hatch lines)
      if (effectiveBackgroundColor) {
        ctx.fillStyle = effectiveBackgroundColor;
        ctx.fill();
      }

      let hatchColor: string | CanvasGradient | CanvasPattern = effectiveHatchColor || ctx.strokeStyle;
      if (invertColors && hatchColor === '#ffffff') {
        hatchColor = '#000000';
      }

      const spacing = effectiveHatchSpacing;
      ctx.strokeStyle = hatchColor;
      ctx.lineWidth = strokeWidth * 0.5;
      ctx.setLineDash([]);

      // Get bounding box
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const p of points) {
        if (p.x < minX) minX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.x > maxX) maxX = p.x;
        if (p.y > maxY) maxY = p.y;
      }

      // If we have a custom pattern ID, render its line families directly
      const customPattern = effectivePatternId ? this.getPatternById(effectivePatternId) : undefined;
      if (customPattern && customPattern.lineFamilies.length > 0) {
        const patternScale = spacing / 10;
        // Special case: insulation patterns get zigzag rendering (NEN standard)
        if (effectivePatternId === 'nen47-isolatie' || effectivePatternId === 'insulation') {
          this.drawInsulationZigzag(
            minX, minY, maxX, maxY,
            patternScale,
            0, // No rotation offset for slabs
            hatchColor as string,
            strokeWidth
          );
        } else {
          // Custom pattern with line families
          this.drawCustomPatternLines(
            customPattern.lineFamilies,
            minX, minY, maxX, maxY,
            patternScale,
            0, // No rotation offset for slabs
            hatchColor as string,
            strokeWidth
          );
        }
      } else if (customPattern && customPattern.lineFamilies.length === 0) {
        // Solid fill pattern (e.g., NEN47-5 concrete, NEN47-18 steel)
        ctx.fillStyle = hatchColor;
        ctx.fill();
      } else {
        // Fallback to basic hatch types
        const hatchAngle = effectiveHatchAngle;

        if (effectiveHatchType === 'solid') {
          ctx.fillStyle = hatchColor;
          ctx.fill();
        } else if (effectiveHatchType === 'diagonal') {
          this.drawLineFamilySimple(hatchAngle, spacing, minX, minY, maxX, maxY);
        } else if (effectiveHatchType === 'crosshatch') {
          this.drawLineFamilySimple(hatchAngle, spacing, minX, minY, maxX, maxY);
          this.drawLineFamilySimple(hatchAngle + 90, spacing, minX, minY, maxX, maxY);
        } else if (effectiveHatchType === 'horizontal') {
          this.drawLineFamilySimple(0, spacing, minX, minY, maxX, maxY);
        } else if (effectiveHatchType === 'vertical') {
          this.drawLineFamilySimple(90, spacing, minX, minY, maxX, maxY);
        } else if (effectiveHatchType === 'dots') {
          this.drawLineFamilySimple(hatchAngle, spacing, minX, minY, maxX, maxY);
        }
      }

      ctx.restore();
    }

    // Draw label if present
    if (shape.label) {
      let textColor = shape.style.strokeColor;
      if (invertColors && textColor === '#ffffff') {
        textColor = '#000000';
      }

      // Calculate centroid for label placement
      let cx = 0, cy = 0;
      for (const p of points) {
        cx += p.x;
        cy += p.y;
      }
      cx /= points.length;
      cy /= points.length;

      const fontSize = Math.max(80, effectiveHatchSpacing * 0.8);
      ctx.save();
      ctx.fillStyle = textColor;
      ctx.font = `${fontSize}px ${CAD_DEFAULT_FONT}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(shape.label, cx, cy);
      ctx.restore();
    }
  }

  /**
   * Draw a space shape (IfcSpace - room/area with filled polygon and label)
   */
  private drawSpace(shape: SpaceShape, _invertColors: boolean = false): void {
    const ctx = this.ctx;
    const { contourPoints, name, number: spaceNumber, area, labelPosition, fillColor, fillOpacity } = shape;

    if (contourPoints.length < 3) return;

    // Draw filled polygon
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(contourPoints[0].x, contourPoints[0].y);
    for (let i = 1; i < contourPoints.length; i++) {
      ctx.lineTo(contourPoints[i].x, contourPoints[i].y);
    }
    ctx.closePath();

    // Fill with semi-transparent color
    ctx.globalAlpha = fillOpacity ?? 0.1;
    ctx.fillStyle = fillColor || '#00ff00';
    ctx.fill();
    ctx.globalAlpha = 1;

    // Draw boundary as thin dashed line
    ctx.setLineDash([100, 50]);
    ctx.lineWidth = this.getLineWidth(1);
    ctx.strokeStyle = fillColor || '#00ff00';
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();

    // Draw label at labelPosition
    ctx.save();
    const scaleFactor = LINE_DASH_REFERENCE_SCALE / this.drawingScale;
    const fontSize = 150 * scaleFactor;

    ctx.fillStyle = '#ffffff';
    ctx.font = `bold ${fontSize}px ${CAD_DEFAULT_FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // Build label text: name + number + area
    let labelText = name;
    if (spaceNumber) {
      labelText = `${spaceNumber} - ${labelText}`;
    }
    ctx.fillText(labelText, labelPosition.x, labelPosition.y);

    // Draw area below the name
    if (area !== undefined) {
      const areaFontSize = fontSize * 0.7;
      ctx.font = `${areaFontSize}px ${CAD_DEFAULT_FONT}`;
      ctx.fillText(`${formatNumber(area, 2, this.unitSettings.numberFormat)} m\u00B2`, labelPosition.x, labelPosition.y + fontSize * 1.2);
    }
    ctx.restore();
  }

  /**
   * Draw a plate system shape (contour boundary with parallel joist/stud members inside)
   */
  private drawPlateSystem(shape: PlateSystemShape, _invertColors: boolean = false): void {
    const ctx = this.ctx;
    const { contourPoints, contourBulges, mainProfile, edgeProfile, layers, fillColor, fillOpacity, name } = shape;

    if (contourPoints.length < 3) return;

    // When childShapeIds are present, child beams (joists + edge beams) are rendered
    // as individual BeamShape elements. The plate system only draws the contour,
    // fill, layers, and label.
    const hasChildBeams = shape.childShapeIds && shape.childShapeIds.length > 0;

    // Helper to build the contour path (supports bulge/arc segments)
    const buildContourPath = () => {
      ctx.moveTo(contourPoints[0].x, contourPoints[0].y);
      for (let i = 0; i < contourPoints.length; i++) {
        const j = (i + 1) % contourPoints.length;
        const b = contourBulges?.[i] ?? 0;
        if (b !== 0 && Math.abs(b) > 0.0001) {
          const arc = bulgeToArc(contourPoints[i], contourPoints[j], b);
          ctx.arc(arc.center.x, arc.center.y, arc.radius, arc.startAngle, arc.endAngle, arc.clockwise);
        } else if (j !== 0) {
          ctx.lineTo(contourPoints[j].x, contourPoints[j].y);
        } else {
          ctx.closePath();
        }
      }
    };

    // 1. Draw the contour boundary (thick line)
    ctx.save();
    const savedLW = ctx.lineWidth;
    ctx.lineWidth = savedLW * 1.5;
    ctx.beginPath();
    buildContourPath();
    ctx.stroke();
    ctx.lineWidth = savedLW;

    // 2. Fill contour with light color
    if (fillColor) {
      ctx.globalAlpha = fillOpacity ?? 0.15;
      ctx.fillStyle = fillColor;
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    // If child beams exist, skip internal joist/edge rendering (they are separate shapes)
    if (!hasChildBeams) {
      // 3. Clip to the contour for internal drawing
      ctx.beginPath();
      buildContourPath();
      ctx.clip();

      // 4. Draw edge profiles along the contour boundary (legacy)
      if (edgeProfile) {
        const edgeW = edgeProfile.width;
        ctx.strokeStyle = ctx.strokeStyle; // Keep current stroke
        ctx.lineWidth = savedLW * 0.5;
        ctx.setLineDash([]);

        for (let i = 0; i < contourPoints.length; i++) {
          const j = (i + 1) % contourPoints.length;
          const p1 = contourPoints[i];
          const p2 = contourPoints[j];
          const edgeAngle = Math.atan2(p2.y - p1.y, p2.x - p1.x);
          // Inward normal (assuming clockwise polygon, normal points inward)
          const nx = Math.sin(edgeAngle);
          const ny = -Math.cos(edgeAngle);

          // Draw the inner edge line offset by edgeWidth
          ctx.beginPath();
          ctx.moveTo(p1.x + nx * edgeW, p1.y + ny * edgeW);
          ctx.lineTo(p2.x + nx * edgeW, p2.y + ny * edgeW);
          ctx.stroke();
        }
      }

      // 5. Draw main profiles (joists) as parallel lines within the contour (legacy)
      const dir = mainProfile.direction;
      const spacing = mainProfile.spacing;
      const joistWidth = mainProfile.width;
      const cosD = Math.cos(dir);
      const sinD = Math.sin(dir);

      // Get bounding box
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const p of contourPoints) {
        if (p.x < minX) minX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.x > maxX) maxX = p.x;
        if (p.y > maxY) maxY = p.y;
      }

      const diag = Math.sqrt((maxX - minX) ** 2 + (maxY - minY) ** 2);
      const cx = (minX + maxX) / 2;
      const cy = (minY + maxY) / 2;

      // Normal perpendicular to direction
      const norm = { x: -sinD, y: cosD };
      const numLines = Math.ceil(diag / spacing) + 1;

      // Draw each joist as a pair of parallel lines (representing the width)
      const halfW = joistWidth / 2;
      ctx.setLineDash([]);

      // Joist fill color (light timber tone)
      const joistFillColor = mainProfile.material === 'timber' ? 'rgba(210, 180, 130, 0.3)'
        : mainProfile.material === 'steel' ? 'rgba(180, 190, 200, 0.3)'
        : 'rgba(200, 200, 200, 0.2)';

      for (let i = -numLines; i <= numLines; i++) {
        const offset = i * spacing;
        const ox = cx + norm.x * offset;
        const oy = cy + norm.y * offset;

        // Joist rectangle (width in plan = joistWidth, along direction = long)
        const p1x = ox - cosD * diag;
        const p1y = oy - sinD * diag;
        const p2x = ox + cosD * diag;
        const p2y = oy + sinD * diag;

        // Fill the joist rectangle
        ctx.fillStyle = joistFillColor;
        ctx.beginPath();
        ctx.moveTo(p1x + norm.x * halfW, p1y + norm.y * halfW);
        ctx.lineTo(p2x + norm.x * halfW, p2y + norm.y * halfW);
        ctx.lineTo(p2x - norm.x * halfW, p2y - norm.y * halfW);
        ctx.lineTo(p1x - norm.x * halfW, p1y - norm.y * halfW);
        ctx.closePath();
        ctx.fill();

        // Stroke the joist edges
        ctx.lineWidth = savedLW * 0.4;
        ctx.beginPath();
        ctx.moveTo(p1x + norm.x * halfW, p1y + norm.y * halfW);
        ctx.lineTo(p2x + norm.x * halfW, p2y + norm.y * halfW);
        ctx.stroke();

        ctx.beginPath();
        ctx.moveTo(p1x - norm.x * halfW, p1y - norm.y * halfW);
        ctx.lineTo(p2x - norm.x * halfW, p2y - norm.y * halfW);
        ctx.stroke();
      }
    }

    // 6. Draw layer indicators (thin colored lines near contour edge)
    if (layers && layers.length > 0) {
      // Need clip if not already clipped (when hasChildBeams, we didn't clip above)
      if (hasChildBeams) {
        ctx.beginPath();
        buildContourPath();
        ctx.clip();
      }

      const layerColors: Record<string, string> = {
        timber: 'rgba(180, 140, 80, 0.5)',
        gypsum: 'rgba(220, 220, 220, 0.5)',
        steel: 'rgba(160, 170, 180, 0.5)',
        insulation: 'rgba(255, 220, 100, 0.4)',
        generic: 'rgba(200, 200, 200, 0.4)',
      };
      // Just show a thin indicator line near the contour boundary for each layer
      let layerOffset = 0;
      for (const layer of layers) {
        layerOffset += layer.thickness;
        ctx.strokeStyle = layerColors[layer.material] || layerColors.generic;
        ctx.lineWidth = Math.max(layer.thickness * 0.5, savedLW * 0.3);
        ctx.setLineDash([]);
        // Draw offset contour for each layer (simplified: offset each segment)
        const sign = layer.position === 'top' ? 1 : -1;
        const off = sign * layerOffset;
        ctx.beginPath();
        for (let i = 0; i < contourPoints.length; i++) {
          const j = (i + 1) % contourPoints.length;
          const p1 = contourPoints[i];
          const p2 = contourPoints[j];
          const edgeAngle = Math.atan2(p2.y - p1.y, p2.x - p1.x);
          const nx = Math.sin(edgeAngle) * off;
          const ny = -Math.cos(edgeAngle) * off;
          if (i === 0) {
            ctx.moveTo(p1.x + nx, p1.y + ny);
          }
          ctx.lineTo(p2.x + nx, p2.y + ny);
        }
        ctx.closePath();
        ctx.stroke();
      }
    }

    ctx.restore();

    // 7. Draw label (system name) at centroid
    if (name) {
      let labelCx = 0, labelCy = 0;
      for (const p of contourPoints) {
        labelCx += p.x;
        labelCy += p.y;
      }
      labelCx /= contourPoints.length;
      labelCy /= contourPoints.length;

      const scaleFactor = LINE_DASH_REFERENCE_SCALE / this.drawingScale;
      const fontSize = 120 * scaleFactor;
      ctx.save();
      ctx.fillStyle = '#ffffff';
      ctx.font = `bold ${fontSize}px ${CAD_DEFAULT_FONT}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(name, labelCx, labelCy);

      // System type below
      const typeFontSize = fontSize * 0.7;
      ctx.font = `${typeFontSize}px ${CAD_DEFAULT_FONT}`;
      ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
      ctx.fillText(shape.systemType, labelCx, labelCy + fontSize * 1.2);
      ctx.restore();
    }

    // 8. Draw openings (sparingen) as dashed rectangles
    if (shape.openings && shape.openings.length > 0) {
      const store = useAppStore.getState();
      const isEditMode = store.plateSystemEditMode && store.editingPlateSystemId === shape.id;
      const selectedOpeningId = store.selectedOpeningId;
      const zoom = ctx.getTransform().a / this.dpr;

      for (const opening of shape.openings) {
        ctx.save();
        ctx.translate(opening.position.x, opening.position.y);
        if (opening.rotation) {
          ctx.rotate(opening.rotation);
        }

        const hw = opening.width / 2;
        const hh = opening.height / 2;

        // Fill with semi-transparent dark color to indicate void
        ctx.fillStyle = 'rgba(40, 20, 20, 0.35)';
        ctx.fillRect(-hw, -hh, opening.width, opening.height);

        // Dashed rectangle outline
        const isSelected = isEditMode && selectedOpeningId === opening.id;
        ctx.strokeStyle = isSelected ? 'rgba(0, 220, 255, 1.0)' : 'rgba(255, 100, 80, 0.8)';
        ctx.lineWidth = isSelected ? 2 / zoom : 1.5 / zoom;
        ctx.setLineDash([6 / zoom, 3 / zoom]);
        ctx.strokeRect(-hw, -hh, opening.width, opening.height);
        ctx.setLineDash([]);

        // Draw diagonal cross lines to indicate opening
        ctx.strokeStyle = isSelected ? 'rgba(0, 200, 255, 0.5)' : 'rgba(255, 100, 80, 0.3)';
        ctx.lineWidth = 0.8 / zoom;
        ctx.beginPath();
        ctx.moveTo(-hw, -hh);
        ctx.lineTo(hw, hh);
        ctx.moveTo(hw, -hh);
        ctx.lineTo(-hw, hh);
        ctx.stroke();

        // In edit mode, draw grip handles at corners and midpoints
        if (isEditMode && isSelected) {
          const gripSize = 4 / zoom;
          ctx.fillStyle = 'rgba(0, 220, 255, 1.0)';
          const gripPositions = [
            { x: -hw, y: -hh }, { x: hw, y: -hh },
            { x: hw, y: hh }, { x: -hw, y: hh },
            { x: 0, y: -hh }, { x: hw, y: 0 },
            { x: 0, y: hh }, { x: -hw, y: 0 },
          ];
          for (const gp of gripPositions) {
            ctx.fillRect(gp.x - gripSize / 2, gp.y - gripSize / 2, gripSize, gripSize);
          }
        }

        // Label: opening dimensions
        if (isEditMode) {
          const dimFontSize = 10 / zoom;
          ctx.font = `${dimFontSize}px sans-serif`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'top';
          ctx.fillStyle = 'rgba(255, 180, 160, 0.9)';
          ctx.fillText(`${opening.width} x ${opening.height}`, 0, hh + 4 / zoom);
        }

        ctx.restore();
      }
    }
  }

  /**
   * Draw a dashed cyan border and "Edit Mode" label around a plate system
   * when it is in edit mode (TAB to enter, TAB/ESC to exit).
   */
  private drawPlateSystemEditModeIndicator(shape: PlateSystemShape): void {
    const ctx = this.ctx;
    const { contourPoints, contourBulges } = shape;
    if (contourPoints.length < 3) return;

    const zoom = ctx.getTransform().a / this.dpr;
    const store = useAppStore.getState();
    const openingMode = store.plateSystemOpeningMode;

    ctx.save();

    // Draw dashed cyan border around the contour
    ctx.strokeStyle = 'rgba(0, 200, 255, 0.7)';
    ctx.lineWidth = 2 / zoom;
    ctx.setLineDash([8 / zoom, 4 / zoom]);

    ctx.beginPath();
    ctx.moveTo(contourPoints[0].x, contourPoints[0].y);
    for (let i = 0; i < contourPoints.length; i++) {
      const j = (i + 1) % contourPoints.length;
      const b = contourBulges?.[i] ?? 0;
      if (b !== 0 && Math.abs(b) > 0.0001) {
        const arc = bulgeToArc(contourPoints[i], contourPoints[j], b);
        ctx.arc(arc.center.x, arc.center.y, arc.radius, arc.startAngle, arc.endAngle, arc.clockwise);
      } else if (j !== 0) {
        ctx.lineTo(contourPoints[j].x, contourPoints[j].y);
      } else {
        ctx.closePath();
      }
    }
    ctx.stroke();
    ctx.setLineDash([]);

    // The interactive toolbar (Edit Mode, Add Opening, TAB to exit) is rendered
    // as a React overlay (PlateSystemEditToolbar in Canvas.tsx). Here we only
    // draw the opening-mode cursor hint if placing an opening.
    if (openingMode) {
      let labelCx = 0;
      let minYForHint = Infinity;
      for (const p of contourPoints) {
        labelCx += p.x;
        if (p.y < minYForHint) minYForHint = p.y;
      }
      labelCx /= contourPoints.length;

      const hintFontSize = 10 / zoom;
      ctx.font = `${hintFontSize}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      ctx.fillStyle = 'rgba(255, 180, 100, 0.9)';
      ctx.fillText('Click to place opening', labelCx, minYForHint - 50 / zoom);
    }

    ctx.restore();
  }

  /**
   * Draw a subtle "Tab to edit" hint below a plate system when it is selected
   * but NOT in edit mode.
   */
  private drawPlateSystemTabHint(shape: PlateSystemShape): void {
    const ctx = this.ctx;
    const { contourPoints } = shape;
    if (contourPoints.length < 3) return;

    const zoom = ctx.getTransform().a / this.dpr;

    ctx.save();

    // Find the bottom of the contour and center X
    let maxY = -Infinity;
    let labelCx = 0;
    for (const p of contourPoints) {
      if (p.y > maxY) maxY = p.y;
      labelCx += p.x;
    }
    labelCx /= contourPoints.length;

    const labelFontSize = 10 / zoom;
    ctx.font = `${labelFontSize}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';

    const hintText = 'TAB to edit';
    const labelY = maxY + 10 / zoom;

    // Background pill
    const metrics = ctx.measureText(hintText);
    const pad = 3 / zoom;
    ctx.fillStyle = 'rgba(40, 40, 60, 0.75)';
    const rx = labelCx - metrics.width / 2 - pad;
    const ry = labelY - pad;
    const rw = metrics.width + pad * 2;
    const rh = labelFontSize + pad * 2;
    ctx.beginPath();
    ctx.roundRect(rx, ry, rw, rh, 2 / zoom);
    ctx.fill();

    // Text
    ctx.fillStyle = 'rgba(200, 200, 220, 0.85)';
    ctx.fillText(hintText, labelCx, labelY);

    ctx.restore();
  }

  /**
   * Draw a section callout shape (section cut line with markers and direction arrows)
   */
  private drawSectionCallout(shape: SectionCalloutShape, invertColors: boolean = false): void {
    const ctx = this.ctx;
    const { start, end, label, flipDirection } = shape;

    // Scale text/sizing so they appear at constant paper size across drawing scales
    const scaleFactor = LINE_DASH_REFERENCE_SCALE / this.drawingScale;
    const bubbleRadius = shape.bubbleRadius * scaleFactor; // sizing parameter (name kept for compatibility)
    const fontSize = shape.fontSize * scaleFactor;

    const angle = Math.atan2(end.y - start.y, end.x - start.x);
    const dx = Math.cos(angle);
    const dy = Math.sin(angle);

    // Perpendicular direction for viewing arrows (negated so default points correct way)
    const perpSign = flipDirection ? 1 : -1;
    const perpX = -dy * perpSign;
    const perpY = dx * perpSign;

    const origLineWidth = ctx.lineWidth;

    let textColor = shape.style.strokeColor;
    if (invertColors && textColor === '#ffffff') {
      textColor = '#000000';
    }

    // Draw view depth area (semi-transparent rectangle on the viewing direction side)
    const viewDepth = shape.viewDepth ?? 5000;
    if (viewDepth > 0) {
      ctx.save();
      // Build rectangle: from start along section line to end, then extend perpendicular by viewDepth
      ctx.beginPath();
      ctx.moveTo(start.x, start.y);
      ctx.lineTo(end.x, end.y);
      ctx.lineTo(end.x + perpX * viewDepth, end.y + perpY * viewDepth);
      ctx.lineTo(start.x + perpX * viewDepth, start.y + perpY * viewDepth);
      ctx.closePath();
      // Semi-transparent light blue fill
      ctx.fillStyle = 'rgba(100, 180, 255, 0.08)';
      ctx.fill();
      // Dashed border on the far edge (view depth extent line)
      ctx.strokeStyle = 'rgba(100, 180, 255, 0.4)';
      ctx.lineWidth = origLineWidth;
      ctx.setLineDash([bubbleRadius * 0.15, bubbleRadius * 0.1]);
      ctx.beginPath();
      ctx.moveTo(start.x + perpX * viewDepth, start.y + perpY * viewDepth);
      ctx.lineTo(end.x + perpX * viewDepth, end.y + perpY * viewDepth);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();
    }

    // Draw the cut line with alternating long-dash / short-dash pattern
    ctx.save();
    ctx.lineWidth = origLineWidth * 2;
    ctx.setLineDash([bubbleRadius * 0.3, bubbleRadius * 0.15, bubbleRadius * 0.05, bubbleRadius * 0.15]);
    ctx.beginPath();
    ctx.moveTo(start.x, start.y);
    ctx.lineTo(end.x, end.y);
    ctx.stroke();
    ctx.restore();

    // Reset line style for arrows and labels
    ctx.setLineDash([]);
    ctx.lineWidth = origLineWidth;

    // Draw simple text labels at each endpoint (NO circles/bubbles)
    const labelOffset = bubbleRadius * 1.2; // offset text from the endpoint along the line
    const drawSectionLabel = (px: number, py: number, offsetDx: number, offsetDy: number) => {
      ctx.save();
      const lx = px + offsetDx * labelOffset;
      const ly = py + offsetDy * labelOffset;
      ctx.fillStyle = textColor;
      ctx.font = `bold ${fontSize * 1.4}px ${CAD_DEFAULT_FONT}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, lx, ly);
      ctx.restore();
    };

    // Labels at endpoints (offset outward along line direction)
    // Skip label + arrow on hidden sides
    const showStart = !shape.hideStartHead;
    const showEnd = !shape.hideEndHead;

    if (showStart) drawSectionLabel(start.x, start.y, -dx, -dy);
    if (showEnd) drawSectionLabel(end.x, end.y, dx, dy);

    // Draw direction arrows at each endpoint (perpendicular to cut line)
    const arrowLen = bubbleRadius * 1.5;
    ctx.lineWidth = origLineWidth * 1.5;

    ctx.beginPath();
    // Arrow stem at start
    if (showStart) {
      ctx.moveTo(start.x, start.y);
      ctx.lineTo(start.x + perpX * arrowLen, start.y + perpY * arrowLen);
    }
    // Arrow stem at end
    if (showEnd) {
      ctx.moveTo(end.x, end.y);
      ctx.lineTo(end.x + perpX * arrowLen, end.y + perpY * arrowLen);
    }
    ctx.stroke();

    // Filled arrowheads
    const arrowHeadSize = bubbleRadius * 0.5;
    const drawArrowHead = (tipX: number, tipY: number, dirX: number, dirY: number) => {
      ctx.beginPath();
      ctx.moveTo(tipX, tipY);
      ctx.lineTo(tipX - dirX * arrowHeadSize + dirY * arrowHeadSize * 0.4, tipY - dirY * arrowHeadSize - dirX * arrowHeadSize * 0.4);
      ctx.lineTo(tipX - dirX * arrowHeadSize - dirY * arrowHeadSize * 0.4, tipY - dirY * arrowHeadSize + dirX * arrowHeadSize * 0.4);
      ctx.closePath();
      ctx.fillStyle = textColor;
      ctx.fill();
    };

    if (showStart) drawArrowHead(start.x + perpX * arrowLen, start.y + perpY * arrowLen, perpX, perpY);
    if (showEnd) drawArrowHead(end.x + perpX * arrowLen, end.y + perpY * arrowLen, perpX, perpY);

    ctx.lineWidth = origLineWidth;
  }

  /**
   * Draw an SVG-based pattern using canvas pattern fill
   */
  private drawSvgPattern(
    pattern: SvgHatchPattern,
    minX: number,
    minY: number,
    maxX: number,
    maxY: number,
    scale: number,
    rotationOffset: number
  ): void {
    const ctx = this.ctx;
    const img = this.getSvgPatternImage(pattern.id);

    if (!img) {
      // Image not loaded yet - trigger load and draw placeholder
      this.loadSvgPattern(pattern);
      // Draw a light gray placeholder
      ctx.fillStyle = 'rgba(128, 128, 128, 0.1)';
      ctx.fill();
      return;
    }

    // Calculate scaled tile dimensions
    const tileWidth = pattern.tileWidth * scale;
    const tileHeight = pattern.tileHeight * scale;

    // Create off-screen canvas for the scaled tile
    const tileCanvas = document.createElement('canvas');
    tileCanvas.width = tileWidth;
    tileCanvas.height = tileHeight;
    const tileCtx = tileCanvas.getContext('2d');

    if (!tileCtx) {
      ctx.fillStyle = 'rgba(128, 128, 128, 0.1)';
      ctx.fill();
      return;
    }

    // Draw the SVG image scaled to tile size
    tileCtx.drawImage(img, 0, 0, tileWidth, tileHeight);

    // Create canvas pattern
    const canvasPattern = ctx.createPattern(tileCanvas, 'repeat');
    if (!canvasPattern) {
      ctx.fillStyle = 'rgba(128, 128, 128, 0.1)';
      ctx.fill();
      return;
    }

    // Apply rotation if needed
    if (rotationOffset !== 0) {
      const cx = (minX + maxX) / 2;
      const cy = (minY + maxY) / 2;

      // Transform the pattern (rotateSelf uses degrees)
      const matrix = new DOMMatrix()
        .translateSelf(cx, cy)
        .rotateSelf(rotationOffset)
        .translateSelf(-cx, -cy);
      canvasPattern.setTransform(matrix);
    }

    ctx.fillStyle = canvasPattern;
    ctx.fill();
  }

  /**
   * Draw simple line family (for built-in patterns)
   */
  private drawLineFamilySimple(angleDeg: number, spacing: number, minX: number, minY: number, maxX: number, maxY: number): void {
    const ctx = this.ctx;
    const angleRad = (angleDeg * Math.PI) / 180;
    const cosA = Math.cos(angleRad);
    const sinA = Math.sin(angleRad);

    // Expand bounding box to cover rotated lines
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    const diagonal = Math.sqrt((maxX - minX) ** 2 + (maxY - minY) ** 2);
    const halfDiag = diagonal / 2 + spacing;

    // Draw parallel lines perpendicular to the angle direction
    const numLines = Math.ceil((halfDiag * 2) / spacing);

    ctx.beginPath();
    for (let i = -numLines; i <= numLines; i++) {
      const offset = i * spacing;
      // Line perpendicular offset from center
      const ox = cx + offset * (-sinA);
      const oy = cy + offset * cosA;
      // Line extends along the angle direction
      const x1 = ox - halfDiag * cosA;
      const y1 = oy - halfDiag * sinA;
      const x2 = ox + halfDiag * cosA;
      const y2 = oy + halfDiag * sinA;
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
    }
    ctx.stroke();
  }

  /**
   * Draw NEN-standard insulation zigzag hatch pattern.
   * Renders connected zigzag (V-shape) lines at 60 degrees, filling the
   * bounding area. Each row is a continuous zigzag path running horizontally
   * (relative to the rotation offset), with segments alternating between
   * +60 and -60 degrees.
   */
  private drawInsulationZigzag(
    minX: number,
    minY: number,
    maxX: number,
    maxY: number,
    scale: number,
    rotationOffset: number,
    color: string,
    defaultStrokeWidth: number,
    wallThickness?: number
  ): void {
    const ctx = this.ctx;

    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = defaultStrokeWidth * 0.5;
    ctx.setLineDash([]);

    // Rotate the coordinate system around the center of the bounding box
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    const rotRad = (rotationOffset * Math.PI) / 180;

    ctx.translate(cx, cy);
    ctx.rotate(rotRad);
    ctx.translate(-cx, -cy);

    if (wallThickness && wallThickness > 0) {
      // ── Wall-specific insulation zigzag ──
      // A single continuous zigzag line that bounces between the inner and
      // outer wall edges at 60 degrees from the wall direction.
      //
      // In the rotated coordinate system the wall runs along the X-axis.
      // The wall strip is centred on cy with total height = wallThickness.
      //   innerEdgeY = cy - wallThickness / 2   (top in canvas coords)
      //   outerEdgeY = cy + wallThickness / 2   (bottom in canvas coords)
      //
      // Each leg of the zigzag travels from one edge to the other.
      // At 60 degrees from the wall direction the horizontal step per leg is:
      //   dx = wallThickness / tan(60°)

      const halfThick = wallThickness / 2;
      const innerEdgeY = cy - halfThick;
      const outerEdgeY = cy + halfThick;

      const tan60 = Math.tan((60 * Math.PI) / 180); // ~1.732
      const dx = wallThickness / tan60; // horizontal step per zigzag leg

      // We need to cover the full diagonal extent along X so the clipped
      // region is completely filled regardless of wall rotation.
      const diagonal = Math.sqrt((maxX - minX) ** 2 + (maxY - minY) ** 2);
      const halfDiag = diagonal / 2;
      const startX = cx - halfDiag - dx; // start well before the visible area
      const endX = cx + halfDiag + dx;   // end well after

      // Number of zigzag legs needed
      const numLegs = Math.ceil((endX - startX) / dx) + 2;

      ctx.beginPath();
      // Start at the inner edge (top)
      let curX = startX;
      let onInner = true;
      ctx.moveTo(curX, onInner ? innerEdgeY : outerEdgeY);

      for (let i = 0; i < numLegs; i++) {
        curX += dx;
        // Alternate between outer and inner edge
        onInner = !onInner;
        ctx.lineTo(curX, onInner ? innerEdgeY : outerEdgeY);
      }
      ctx.stroke();
    } else {
      // ── Fallback for non-wall shapes (slabs, generic) ──
      // Uses scale-based parameters with multiple rows of zigzag.
      const zigzagSpacing = 1.5 * scale;
      const zigzagAmplitude = zigzagSpacing * 0.5;
      const zigzagAngleRad = (60 * Math.PI) / 180;
      const legHorizontal = zigzagAmplitude / Math.tan(zigzagAngleRad);
      const wavelength = legHorizontal * 2;
      const halfWavelength = wavelength / 2;

      // After rotation, we need to cover a larger area to fill the original bbox
      const diagonal = Math.sqrt((maxX - minX) ** 2 + (maxY - minY) ** 2);
      const halfDiag = diagonal / 2;
      const aMinX = cx - halfDiag;
      const aMaxX = cx + halfDiag;
      const aMinY = cy - halfDiag;
      const aMaxY = cy + halfDiag;

      // Number of zigzag rows needed
      const numRows = Math.ceil((aMaxY - aMinY) / zigzagSpacing) + 2;
      // Number of V segments per row
      const numSegments = Math.ceil((aMaxX - aMinX) / wavelength) + 2;

      ctx.beginPath();
      for (let row = -1; row <= numRows; row++) {
        const rowY = aMinY + row * zigzagSpacing;

        // Start the zigzag row
        const startX = aMinX - wavelength;
        ctx.moveTo(startX, rowY);

        for (let seg = 0; seg <= numSegments + 1; seg++) {
          const segStartX = startX + seg * wavelength;
          // Go up to peak
          ctx.lineTo(segStartX + halfWavelength, rowY - zigzagAmplitude);
          // Go down to trough
          ctx.lineTo(segStartX + wavelength, rowY);
        }
      }
      ctx.stroke();
    }

    ctx.restore();
  }

  /**
   * Draw an insulation zigzag that follows an arc wall.
   * The zigzag is a single continuous line whose vertices alternate between
   * the inner and outer arc radii, producing peaks that always touch the
   * wall edges.  The angular step is chosen so that each leg of the zigzag
   * makes a 60-degree angle with the tangent direction at the midpoint.
   */
  private drawInsulationZigzagArc(
    center: { x: number; y: number },
    innerR: number,
    outerR: number,
    startAngle: number,
    endAngle: number,
    clockwise: boolean,
    color: string,
    strokeWidth: number
  ): void {
    const ctx = this.ctx;

    const wallThickness = outerR - innerR;
    if (wallThickness <= 0) return;

    // The midpoint radius is used to compute the angular step.
    // Each zigzag leg spans the wall thickness radially.
    // At 60 degrees from the tangent direction, the arc-length per leg
    // (measured at the mid-radius) equals: wallThickness / tan(60deg).
    const midR = (innerR + outerR) / 2;
    if (midR <= 0) return;

    const tan60 = Math.tan((60 * Math.PI) / 180); // ~1.732
    const arcLengthPerLeg = wallThickness / tan60;
    const angularStep = arcLengthPerLeg / midR; // radians per leg

    // Determine total angular sweep
    let totalSweep: number;
    if (clockwise) {
      totalSweep = startAngle - endAngle;
      if (totalSweep < 0) totalSweep += Math.PI * 2;
    } else {
      totalSweep = endAngle - startAngle;
      if (totalSweep < 0) totalSweep += Math.PI * 2;
    }

    const numLegs = Math.ceil(totalSweep / angularStep);
    const direction = clockwise ? -1 : 1;

    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = strokeWidth * 0.5;
    ctx.setLineDash([]);

    ctx.beginPath();

    // Start on the inner arc at startAngle
    let onInner = true;
    let angle = startAngle;
    ctx.moveTo(
      center.x + innerR * Math.cos(angle),
      center.y + innerR * Math.sin(angle)
    );

    for (let i = 0; i < numLegs; i++) {
      angle += direction * angularStep;
      onInner = !onInner;
      const r = onInner ? innerR : outerR;
      ctx.lineTo(
        center.x + r * Math.cos(angle),
        center.y + r * Math.sin(angle)
      );
    }

    ctx.stroke();
    ctx.restore();
  }

  /**
   * Draw custom pattern line families with full support for origins, offsets, and dash patterns
   */
  private drawCustomPatternLines(
    lineFamilies: LineFamily[],
    minX: number,
    minY: number,
    maxX: number,
    maxY: number,
    scale: number,
    rotationOffset: number,
    defaultColor: string,
    defaultStrokeWidth: number
  ): void {
    const ctx = this.ctx;

    for (const family of lineFamilies) {
      // Apply scale to all dimensions
      const spacing = (family.deltaY || 10) * scale;
      const deltaX = (family.deltaX || 0) * scale;
      const originX = (family.originX || 0) * scale;
      const originY = (family.originY || 0) * scale;
      const angleDeg = family.angle + rotationOffset;
      const strokeWidth = family.strokeWidth ?? defaultStrokeWidth * 0.5;
      const strokeColor = family.strokeColor ?? defaultColor;

      // Set line style
      ctx.strokeStyle = strokeColor;
      ctx.lineWidth = strokeWidth;

      // Handle dash pattern
      if (family.dashPattern && family.dashPattern.length > 0) {
        // Convert dash pattern with scale
        const scaledDashPattern = family.dashPattern.map(d => Math.abs(d) * scale);
        // Check for dot (0 value means dot)
        if (family.dashPattern.includes(0)) {
          // Render as dots
          this.drawLineFamilyDots(angleDeg, spacing, deltaX, originX, originY, minX, minY, maxX, maxY, scale, strokeColor);
          continue;
        }
        ctx.setLineDash(scaledDashPattern);
      } else {
        ctx.setLineDash([]);
      }

      // Draw the line family
      this.drawLineFamilyWithOffset(angleDeg, spacing, deltaX, originX, originY, minX, minY, maxX, maxY);
    }

    // Reset dash
    ctx.setLineDash([]);
  }

  /**
   * Draw a line family with origin offset and stagger (deltaX)
   */
  private drawLineFamilyWithOffset(
    angleDeg: number,
    spacing: number,
    deltaX: number,
    originX: number,
    originY: number,
    minX: number,
    minY: number,
    maxX: number,
    maxY: number
  ): void {
    const ctx = this.ctx;
    const angleRad = (angleDeg * Math.PI) / 180;
    const cosA = Math.cos(angleRad);
    const sinA = Math.sin(angleRad);

    // Calculate coverage area
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    const diagonal = Math.sqrt((maxX - minX) ** 2 + (maxY - minY) ** 2);
    const halfDiag = diagonal / 2 + spacing * 2;

    // Number of lines needed
    const numLines = Math.ceil((halfDiag * 2) / spacing) + 2;

    ctx.beginPath();
    for (let i = -numLines; i <= numLines; i++) {
      // Perpendicular offset from center
      const perpOffset = i * spacing;

      // Apply stagger (deltaX) - shifts line along its direction based on perpendicular position
      const staggerOffset = deltaX !== 0 ? (i * deltaX) : 0;

      // Calculate line origin point
      // Start from center, move perpendicular to line direction
      const baseX = cx + perpOffset * (-sinA);
      const baseY = cy + perpOffset * cosA;

      // Apply origin offset and stagger
      const ox = baseX + originX + staggerOffset * cosA;
      const oy = baseY + originY + staggerOffset * sinA;

      // Line endpoints extend along the angle direction
      const x1 = ox - halfDiag * cosA;
      const y1 = oy - halfDiag * sinA;
      const x2 = ox + halfDiag * cosA;
      const y2 = oy + halfDiag * sinA;

      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
    }
    ctx.stroke();
  }

  /**
   * Draw dots for line families with dash pattern containing 0 (dot indicator)
   */
  private drawLineFamilyDots(
    angleDeg: number,
    spacing: number,
    deltaX: number,
    originX: number,
    originY: number,
    minX: number,
    minY: number,
    maxX: number,
    maxY: number,
    scale: number,
    color: string
  ): void {
    const ctx = this.ctx;
    const angleRad = (angleDeg * Math.PI) / 180;
    const cosA = Math.cos(angleRad);
    const sinA = Math.sin(angleRad);

    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    const diagonal = Math.sqrt((maxX - minX) ** 2 + (maxY - minY) ** 2);
    const halfDiag = diagonal / 2 + spacing * 2;

    const dotRadius = 1 * scale;
    const numLines = Math.ceil((halfDiag * 2) / spacing) + 2;
    const dotsPerLine = Math.ceil((halfDiag * 2) / (deltaX || spacing)) + 2;
    const dotSpacing = deltaX || spacing;

    ctx.fillStyle = color;

    for (let i = -numLines; i <= numLines; i++) {
      const perpOffset = i * spacing;
      const baseX = cx + perpOffset * (-sinA);
      const baseY = cy + perpOffset * cosA;

      for (let j = -dotsPerLine; j <= dotsPerLine; j++) {
        const alongOffset = j * dotSpacing;
        const dx = baseX + originX + alongOffset * cosA;
        const dy = baseY + originY + alongOffset * sinA;

        ctx.beginPath();
        ctx.arc(dx, dy, dotRadius, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
}