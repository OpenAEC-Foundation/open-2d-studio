import type { Shape, Viewport, LineShape, RectangleShape, CircleShape, SnapPoint, SnapType } from '../../types/geometry';
import type { DrawingPreview, SelectionBox } from '../../state/appStore';
import type { TrackingLine } from '../../core/geometry/Tracking';
import { getTrackingLineColor } from '../../core/geometry/Tracking';
import type { IPoint } from '../../core/geometry/Point';

interface RenderOptions {
  shapes: Shape[];
  selectedShapeIds: string[];
  viewport: Viewport;
  gridVisible: boolean;
  gridSize: number;
  drawingPreview?: DrawingPreview;
  currentStyle?: { strokeColor: string; strokeWidth: number };
  selectionBox?: SelectionBox | null;
  commandPreviewShapes?: Shape[];
  currentSnapPoint?: SnapPoint | null;
  currentTrackingLines?: TrackingLine[];
  trackingPoint?: IPoint | null;
}

export class CADRenderer {
  private ctx: CanvasRenderingContext2D;
  private width: number = 0;
  private height: number = 0;
  private dpr: number = 1;

  constructor(canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Could not get 2D context');
    }
    this.ctx = ctx;
    this.dpr = window.devicePixelRatio || 1;
  }

  resize(width: number, height: number): void {
    this.width = width;
    this.height = height;
    this.ctx.scale(this.dpr, this.dpr);
  }

  render(options: RenderOptions): void {
    const { shapes, selectedShapeIds, viewport, gridVisible, gridSize, drawingPreview, currentStyle, selectionBox, commandPreviewShapes, currentSnapPoint, currentTrackingLines, trackingPoint } = options;
    const ctx = this.ctx;

    // Clear canvas
    ctx.save();
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = '#1a1a2e';
    ctx.fillRect(0, 0, this.width, this.height);

    // Apply viewport transform
    ctx.translate(viewport.offsetX, viewport.offsetY);
    ctx.scale(viewport.zoom, viewport.zoom);

    // Draw grid
    if (gridVisible) {
      this.drawGrid(viewport, gridSize);
    }

    // Draw shapes
    for (const shape of shapes) {
      if (!shape.visible) continue;
      const isSelected = selectedShapeIds.includes(shape.id);
      this.drawShape(shape, isSelected);
    }

    // Draw command preview shapes (move/copy preview)
    if (commandPreviewShapes && commandPreviewShapes.length > 0) {
      this.drawCommandPreviewShapes(commandPreviewShapes);
    }

    // Draw preview shape while drawing
    if (drawingPreview) {
      this.drawPreview(drawingPreview, currentStyle);
    }

    // Draw tracking lines
    if (currentTrackingLines && currentTrackingLines.length > 0) {
      this.drawTrackingLines(currentTrackingLines, trackingPoint, viewport);
    }

    // Draw snap point indicator (skip grid snaps - they're not useful to show)
    if (currentSnapPoint && currentSnapPoint.type !== 'grid') {
      this.drawSnapIndicator(currentSnapPoint, viewport);
    }

    ctx.restore();

    // Draw selection box (in screen coordinates, after viewport transform is restored)
    if (selectionBox) {
      this.drawSelectionBox(selectionBox);
    }

    // Draw snap point label (in screen coordinates, skip grid snaps)
    if (currentSnapPoint && currentSnapPoint.type !== 'grid') {
      this.drawSnapLabel(currentSnapPoint, viewport);
    }

    // Draw tracking label (in screen coordinates)
    if (currentTrackingLines && currentTrackingLines.length > 0 && trackingPoint) {
      this.drawTrackingLabel(currentTrackingLines, trackingPoint, viewport);
    }
  }

  private drawGrid(viewport: Viewport, gridSize: number): void {
    const ctx = this.ctx;

    // Calculate visible area in world coordinates
    const left = -viewport.offsetX / viewport.zoom;
    const top = -viewport.offsetY / viewport.zoom;
    const right = left + this.width / viewport.zoom;
    const bottom = top + this.height / viewport.zoom;

    // Adjust grid size based on zoom
    let adjustedGridSize = gridSize;
    while (adjustedGridSize * viewport.zoom < 10) {
      adjustedGridSize *= 5;
    }
    while (adjustedGridSize * viewport.zoom > 100) {
      adjustedGridSize /= 5;
    }

    const majorGridSize = adjustedGridSize * 5;

    // Draw minor grid lines
    ctx.strokeStyle = '#2a2a4a';
    ctx.lineWidth = 0.5 / viewport.zoom;
    ctx.beginPath();

    const startX = Math.floor(left / adjustedGridSize) * adjustedGridSize;
    const startY = Math.floor(top / adjustedGridSize) * adjustedGridSize;

    for (let x = startX; x <= right; x += adjustedGridSize) {
      if (Math.abs(x % majorGridSize) < 0.001) continue; // Skip major lines
      ctx.moveTo(x, top);
      ctx.lineTo(x, bottom);
    }

    for (let y = startY; y <= bottom; y += adjustedGridSize) {
      if (Math.abs(y % majorGridSize) < 0.001) continue; // Skip major lines
      ctx.moveTo(left, y);
      ctx.lineTo(right, y);
    }

    ctx.stroke();

    // Draw major grid lines
    ctx.strokeStyle = '#3a3a5a';
    ctx.lineWidth = 1 / viewport.zoom;
    ctx.beginPath();

    const majorStartX = Math.floor(left / majorGridSize) * majorGridSize;
    const majorStartY = Math.floor(top / majorGridSize) * majorGridSize;

    for (let x = majorStartX; x <= right; x += majorGridSize) {
      ctx.moveTo(x, top);
      ctx.lineTo(x, bottom);
    }

    for (let y = majorStartY; y <= bottom; y += majorGridSize) {
      ctx.moveTo(left, y);
      ctx.lineTo(right, y);
    }

    ctx.stroke();

    // Draw origin axes
    ctx.lineWidth = 2 / viewport.zoom;

    // X axis (red)
    ctx.strokeStyle = '#ff4444';
    ctx.beginPath();
    ctx.moveTo(left, 0);
    ctx.lineTo(right, 0);
    ctx.stroke();

    // Y axis (green)
    ctx.strokeStyle = '#44ff44';
    ctx.beginPath();
    ctx.moveTo(0, top);
    ctx.lineTo(0, bottom);
    ctx.stroke();
  }

  private drawShape(shape: Shape, isSelected: boolean): void {
    const ctx = this.ctx;
    const { style } = shape;

    // Set line style
    ctx.strokeStyle = isSelected ? '#e94560' : style.strokeColor;
    ctx.lineWidth = style.strokeWidth;
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
      case 'ellipse':
        this.drawEllipse(shape);
        break;
      default:
        break;
    }

    // Draw selection handles
    if (isSelected) {
      this.drawSelectionHandles(shape);
    }

    // Reset line dash
    ctx.setLineDash([]);
  }

  private getLineDash(lineStyle: string): number[] {
    switch (lineStyle) {
      case 'dashed':
        return [10, 5];
      case 'dotted':
        return [2, 3];
      case 'dashdot':
        return [10, 3, 2, 3];
      default:
        return [];
    }
  }

  private drawLine(shape: LineShape): void {
    const ctx = this.ctx;
    ctx.beginPath();
    ctx.moveTo(shape.start.x, shape.start.y);
    ctx.lineTo(shape.end.x, shape.end.y);
    ctx.stroke();
  }

  private drawPreview(preview: DrawingPreview, style?: { strokeColor: string; strokeWidth: number }): void {
    if (!preview) return;

    const ctx = this.ctx;

    // Set preview style - solid lines matching final appearance
    ctx.strokeStyle = style?.strokeColor || '#ffffff';
    ctx.lineWidth = style?.strokeWidth || 1;
    ctx.setLineDash([]); // Solid line, same as final shape

    switch (preview.type) {
      case 'line':
        ctx.beginPath();
        ctx.moveTo(preview.start.x, preview.start.y);
        ctx.lineTo(preview.end.x, preview.end.y);
        ctx.stroke();
        break;

      case 'rectangle': {
        const x = Math.min(preview.start.x, preview.end.x);
        const y = Math.min(preview.start.y, preview.end.y);
        const width = Math.abs(preview.end.x - preview.start.x);
        const height = Math.abs(preview.end.y - preview.start.y);
        ctx.beginPath();
        ctx.rect(x, y, width, height);
        ctx.stroke();
        break;
      }

      case 'rotatedRectangle': {
        // Draw rotated rectangle using 4 corner points
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
        break;

      case 'polyline':
        if (preview.points.length > 0) {
          ctx.beginPath();
          ctx.moveTo(preview.points[0].x, preview.points[0].y);
          for (let i = 1; i < preview.points.length; i++) {
            ctx.lineTo(preview.points[i].x, preview.points[i].y);
          }
          // Draw to current mouse position
          ctx.lineTo(preview.currentPoint.x, preview.currentPoint.y);
          ctx.stroke();
        }
        break;
    }
  }

  private drawRectangle(shape: RectangleShape): void {
    const ctx = this.ctx;
    ctx.save();

    if (shape.rotation) {
      const centerX = shape.topLeft.x + shape.width / 2;
      const centerY = shape.topLeft.y + shape.height / 2;
      ctx.translate(centerX, centerY);
      ctx.rotate(shape.rotation);
      ctx.translate(-centerX, -centerY);
    }

    ctx.beginPath();
    ctx.rect(shape.topLeft.x, shape.topLeft.y, shape.width, shape.height);

    if (shape.style.fillColor) {
      ctx.fill();
    }
    ctx.stroke();

    ctx.restore();
  }

  private drawCircle(shape: CircleShape): void {
    const ctx = this.ctx;
    ctx.beginPath();
    ctx.arc(shape.center.x, shape.center.y, shape.radius, 0, Math.PI * 2);

    if (shape.style.fillColor) {
      ctx.fill();
    }
    ctx.stroke();
  }

  private drawArc(shape: Shape): void {
    if (shape.type !== 'arc') return;
    const ctx = this.ctx;
    ctx.beginPath();
    ctx.arc(
      shape.center.x,
      shape.center.y,
      shape.radius,
      shape.startAngle,
      shape.endAngle
    );
    ctx.stroke();
  }

  private drawPolyline(shape: Shape): void {
    if (shape.type !== 'polyline') return;
    const ctx = this.ctx;
    const { points, closed } = shape;

    if (points.length < 2) return;

    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);

    for (let i = 1; i < points.length; i++) {
      ctx.lineTo(points[i].x, points[i].y);
    }

    if (closed) {
      ctx.closePath();
      if (shape.style.fillColor) {
        ctx.fill();
      }
    }

    ctx.stroke();
  }

  private drawEllipse(shape: Shape): void {
    if (shape.type !== 'ellipse') return;
    const ctx = this.ctx;
    ctx.beginPath();
    ctx.ellipse(
      shape.center.x,
      shape.center.y,
      shape.radiusX,
      shape.radiusY,
      shape.rotation,
      0,
      Math.PI * 2
    );

    if (shape.style.fillColor) {
      ctx.fill();
    }
    ctx.stroke();
  }

  private drawSelectionHandles(shape: Shape): void {
    const ctx = this.ctx;
    const handleSize = 6;

    ctx.fillStyle = '#e94560';
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1;

    const points = this.getShapeHandlePoints(shape);

    for (const point of points) {
      ctx.fillRect(
        point.x - handleSize / 2,
        point.y - handleSize / 2,
        handleSize,
        handleSize
      );
      ctx.strokeRect(
        point.x - handleSize / 2,
        point.y - handleSize / 2,
        handleSize,
        handleSize
      );
    }
  }

  private getShapeHandlePoints(shape: Shape): { x: number; y: number }[] {
    switch (shape.type) {
      case 'line':
        return [shape.start, shape.end];
      case 'rectangle':
        return [
          shape.topLeft,
          { x: shape.topLeft.x + shape.width, y: shape.topLeft.y },
          { x: shape.topLeft.x + shape.width, y: shape.topLeft.y + shape.height },
          { x: shape.topLeft.x, y: shape.topLeft.y + shape.height },
        ];
      case 'circle':
        return [
          shape.center,
          { x: shape.center.x + shape.radius, y: shape.center.y },
          { x: shape.center.x - shape.radius, y: shape.center.y },
          { x: shape.center.x, y: shape.center.y + shape.radius },
          { x: shape.center.x, y: shape.center.y - shape.radius },
        ];
      case 'polyline':
        return shape.points;
      default:
        return [];
    }
  }

  private drawSelectionBox(box: SelectionBox): void {
    const ctx = this.ctx;

    ctx.save();
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

    const x = Math.min(box.start.x, box.end.x);
    const y = Math.min(box.start.y, box.end.y);
    const width = Math.abs(box.end.x - box.start.x);
    const height = Math.abs(box.end.y - box.start.y);

    // Set colors based on selection mode
    if (box.mode === 'window') {
      // Window selection: blue, solid border
      ctx.fillStyle = 'rgba(0, 120, 215, 0.15)';
      ctx.strokeStyle = 'rgba(0, 120, 215, 0.8)';
      ctx.setLineDash([]);
    } else {
      // Crossing selection: green, dashed border
      ctx.fillStyle = 'rgba(0, 180, 0, 0.15)';
      ctx.strokeStyle = 'rgba(0, 180, 0, 0.8)';
      ctx.setLineDash([6, 3]);
    }

    ctx.lineWidth = 1;

    // Draw filled rectangle
    ctx.fillRect(x, y, width, height);

    // Draw border
    ctx.strokeRect(x, y, width, height);

    ctx.setLineDash([]);
    ctx.restore();
  }

  private drawCommandPreviewShapes(shapes: Shape[]): void {
    const ctx = this.ctx;

    // AutoCAD-like preview style: green dashed lines
    ctx.strokeStyle = '#00ff00';
    ctx.setLineDash([8, 4]);
    ctx.lineWidth = 1;

    for (const shape of shapes) {
      switch (shape.type) {
        case 'line':
          ctx.beginPath();
          ctx.moveTo(shape.start.x, shape.start.y);
          ctx.lineTo(shape.end.x, shape.end.y);
          ctx.stroke();
          break;

        case 'rectangle':
          ctx.beginPath();
          ctx.rect(shape.topLeft.x, shape.topLeft.y, shape.width, shape.height);
          ctx.stroke();
          break;

        case 'circle':
          ctx.beginPath();
          ctx.arc(shape.center.x, shape.center.y, shape.radius, 0, Math.PI * 2);
          ctx.stroke();
          break;

        case 'arc':
          ctx.beginPath();
          ctx.arc(
            shape.center.x,
            shape.center.y,
            shape.radius,
            shape.startAngle,
            shape.endAngle
          );
          ctx.stroke();
          break;

        case 'polyline':
          if (shape.points.length >= 2) {
            ctx.beginPath();
            ctx.moveTo(shape.points[0].x, shape.points[0].y);
            for (let i = 1; i < shape.points.length; i++) {
              ctx.lineTo(shape.points[i].x, shape.points[i].y);
            }
            if (shape.closed) {
              ctx.closePath();
            }
            ctx.stroke();
          }
          break;

        case 'ellipse':
          ctx.beginPath();
          ctx.ellipse(
            shape.center.x,
            shape.center.y,
            shape.radiusX,
            shape.radiusY,
            shape.rotation,
            0,
            Math.PI * 2
          );
          ctx.stroke();
          break;
      }
    }

    ctx.setLineDash([]);
  }

  private drawSnapIndicator(snapPoint: SnapPoint, viewport: Viewport): void {
    const ctx = this.ctx;
    const { point, type } = snapPoint;
    const size = 8 / viewport.zoom; // Size in world coordinates

    ctx.save();
    ctx.strokeStyle = this.getSnapColor(type);
    ctx.fillStyle = this.getSnapColor(type);
    ctx.lineWidth = 1.5 / viewport.zoom;

    switch (type) {
      case 'endpoint':
        // Square marker
        ctx.strokeRect(point.x - size / 2, point.y - size / 2, size, size);
        break;

      case 'midpoint':
        // Triangle marker
        ctx.beginPath();
        ctx.moveTo(point.x, point.y - size / 2);
        ctx.lineTo(point.x - size / 2, point.y + size / 2);
        ctx.lineTo(point.x + size / 2, point.y + size / 2);
        ctx.closePath();
        ctx.stroke();
        break;

      case 'center':
        // Circle marker
        ctx.beginPath();
        ctx.arc(point.x, point.y, size / 2, 0, Math.PI * 2);
        ctx.stroke();
        break;

      case 'intersection':
        // X marker
        ctx.beginPath();
        ctx.moveTo(point.x - size / 2, point.y - size / 2);
        ctx.lineTo(point.x + size / 2, point.y + size / 2);
        ctx.moveTo(point.x + size / 2, point.y - size / 2);
        ctx.lineTo(point.x - size / 2, point.y + size / 2);
        ctx.stroke();
        break;

      case 'perpendicular':
        // Perpendicular symbol (L rotated)
        ctx.beginPath();
        ctx.moveTo(point.x - size / 2, point.y);
        ctx.lineTo(point.x, point.y);
        ctx.lineTo(point.x, point.y - size / 2);
        ctx.stroke();
        // Small square in corner
        const cornerSize = size / 4;
        ctx.strokeRect(point.x - cornerSize, point.y - cornerSize, cornerSize, cornerSize);
        break;

      case 'tangent':
        // Circle with line
        ctx.beginPath();
        ctx.arc(point.x, point.y, size / 3, 0, Math.PI * 2);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(point.x - size / 2, point.y + size / 3);
        ctx.lineTo(point.x + size / 2, point.y + size / 3);
        ctx.stroke();
        break;

      case 'nearest':
        // Diamond marker
        ctx.beginPath();
        ctx.moveTo(point.x, point.y - size / 2);
        ctx.lineTo(point.x + size / 2, point.y);
        ctx.lineTo(point.x, point.y + size / 2);
        ctx.lineTo(point.x - size / 2, point.y);
        ctx.closePath();
        ctx.stroke();
        break;

      case 'grid':
        // Plus marker
        ctx.beginPath();
        ctx.moveTo(point.x - size / 2, point.y);
        ctx.lineTo(point.x + size / 2, point.y);
        ctx.moveTo(point.x, point.y - size / 2);
        ctx.lineTo(point.x, point.y + size / 2);
        ctx.stroke();
        break;

      default:
        // Small filled circle as fallback
        ctx.beginPath();
        ctx.arc(point.x, point.y, size / 4, 0, Math.PI * 2);
        ctx.fill();
        break;
    }

    ctx.restore();
  }

  private drawSnapLabel(snapPoint: SnapPoint, viewport: Viewport): void {
    const ctx = this.ctx;
    const { point, type } = snapPoint;

    // Convert world point to screen coordinates
    const screenX = point.x * viewport.zoom + viewport.offsetX;
    const screenY = point.y * viewport.zoom + viewport.offsetY;

    ctx.save();
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

    // Draw label background
    const label = this.getSnapLabel(type);
    ctx.font = '11px Arial, sans-serif';
    const metrics = ctx.measureText(label);
    const padding = 4;
    const labelX = screenX + 12;
    const labelY = screenY - 12;

    ctx.fillStyle = 'rgba(0, 0, 0, 0.8)';
    ctx.fillRect(
      labelX - padding,
      labelY - 11,
      metrics.width + padding * 2,
      14
    );

    // Draw label text
    ctx.fillStyle = this.getSnapColor(type);
    ctx.fillText(label, labelX, labelY);

    ctx.restore();
  }

  private getSnapColor(type: SnapType): string {
    switch (type) {
      case 'endpoint':
        return '#00ff00'; // Green
      case 'midpoint':
        return '#00ffff'; // Cyan
      case 'center':
        return '#ff00ff'; // Magenta
      case 'intersection':
        return '#ffff00'; // Yellow
      case 'perpendicular':
        return '#ff8800'; // Orange
      case 'tangent':
        return '#88ff00'; // Lime
      case 'nearest':
        return '#ff88ff'; // Pink
      case 'grid':
        return '#8888ff'; // Light blue
      default:
        return '#ffffff'; // White
    }
  }

  private getSnapLabel(type: SnapType): string {
    switch (type) {
      case 'endpoint':
        return 'Endpoint';
      case 'midpoint':
        return 'Midpoint';
      case 'center':
        return 'Center';
      case 'intersection':
        return 'Intersection';
      case 'perpendicular':
        return 'Perpendicular';
      case 'tangent':
        return 'Tangent';
      case 'nearest':
        return 'Nearest';
      case 'grid':
        return 'Grid';
      default:
        return type;
    }
  }

  private drawTrackingLines(
    trackingLines: TrackingLine[],
    trackingPoint: IPoint | null | undefined,
    viewport: Viewport
  ): void {
    const ctx = this.ctx;

    // Calculate max distance for tracking line extension
    const maxDistance = Math.max(this.width, this.height) / viewport.zoom * 2;

    ctx.save();

    for (const line of trackingLines) {
      const color = getTrackingLineColor(line.type);
      ctx.strokeStyle = color;
      ctx.lineWidth = 1 / viewport.zoom;
      ctx.setLineDash([6 / viewport.zoom, 4 / viewport.zoom]);

      // Draw the tracking line extending from origin
      ctx.beginPath();
      ctx.moveTo(line.origin.x, line.origin.y);

      // Extend line in the direction
      const endX = line.origin.x + line.direction.x * maxDistance;
      const endY = line.origin.y + line.direction.y * maxDistance;
      ctx.lineTo(endX, endY);
      ctx.stroke();

      // Draw small circle at origin point
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.arc(line.origin.x, line.origin.y, 3 / viewport.zoom, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Draw tracking point marker if we have one
    if (trackingPoint) {
      ctx.setLineDash([]);
      ctx.strokeStyle = '#00ffff';
      ctx.fillStyle = '#00ffff';
      ctx.lineWidth = 2 / viewport.zoom;

      // Draw crosshair at tracking point
      const size = 8 / viewport.zoom;
      ctx.beginPath();
      ctx.moveTo(trackingPoint.x - size, trackingPoint.y);
      ctx.lineTo(trackingPoint.x + size, trackingPoint.y);
      ctx.moveTo(trackingPoint.x, trackingPoint.y - size);
      ctx.lineTo(trackingPoint.x, trackingPoint.y + size);
      ctx.stroke();

      // Draw small circle
      ctx.beginPath();
      ctx.arc(trackingPoint.x, trackingPoint.y, 4 / viewport.zoom, 0, Math.PI * 2);
      ctx.stroke();
    }

    ctx.setLineDash([]);
    ctx.restore();
  }

  private drawTrackingLabel(
    trackingLines: TrackingLine[],
    trackingPoint: IPoint,
    viewport: Viewport
  ): void {
    if (trackingLines.length === 0) return;

    const ctx = this.ctx;
    const line = trackingLines[0];

    // Convert world point to screen coordinates
    const screenX = trackingPoint.x * viewport.zoom + viewport.offsetX;
    const screenY = trackingPoint.y * viewport.zoom + viewport.offsetY;

    ctx.save();
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

    // Build label text
    let label = '';
    const angleDeg = ((line.angle * 180) / Math.PI + 360) % 360;

    switch (line.type) {
      case 'polar':
        label = `Polar: ${angleDeg.toFixed(0)}°`;
        break;
      case 'parallel':
        label = 'Parallel';
        break;
      case 'perpendicular':
        label = 'Perpendicular';
        break;
      case 'extension':
        label = 'Extension';
        break;
    }

    // Draw label background
    ctx.font = '11px Arial, sans-serif';
    const metrics = ctx.measureText(label);
    const padding = 4;
    const labelX = screenX + 15;
    const labelY = screenY + 15;

    ctx.fillStyle = 'rgba(0, 0, 0, 0.8)';
    ctx.fillRect(
      labelX - padding,
      labelY - 11,
      metrics.width + padding * 2,
      14
    );

    // Draw label text
    ctx.fillStyle = getTrackingLineColor(line.type);
    ctx.fillText(label, labelX, labelY);

    ctx.restore();
  }

  dispose(): void {
    // Cleanup if needed
  }
}
