/**
 * DWG Import Service
 * Invokes the Rust-side DWG parser via Tauri command and converts
 * parsed DWG objects into the app's Shape format.
 */

import { invoke } from '@tauri-apps/api/core';
import type { Shape, ShapeStyle } from '../../types/geometry';
import { CAD_DEFAULT_FONT } from '../../constants/cadDefaults';

interface DwgLoadResult {
  success: boolean;
  data: string | null;
  message: string;
}

interface DwgObject {
  type_name: string;
  data: Record<string, any>;
  is_entity: boolean;
  handle: number;
  layer_handle: number | null;
  layer: string | null;
}

interface DwgParseResult {
  version: string;
  version_code: string;
  objects: DwgObject[];
}

const defaultStyle: ShapeStyle = {
  strokeColor: '#ffffff',
  strokeWidth: 1,
  lineStyle: 'solid',
};

function generateId(): string {
  return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
}

/**
 * Import a DWG file via the Rust backend and return shapes.
 */
export async function importDwgFile(
  filePath: string,
  layerId: string,
  drawingId: string,
): Promise<Shape[]> {
  const result = await invoke<DwgLoadResult>('import_dwg', { path: filePath });

  if (!result.success || !result.data) {
    throw new Error(result.message || 'Failed to parse DWG file');
  }

  const parsed: DwgParseResult = JSON.parse(result.data);
  return convertDwgObjectsToShapes(parsed.objects, layerId, drawingId);
}

function convertDwgObjectsToShapes(
  objects: DwgObject[],
  layerId: string,
  drawingId: string,
): Shape[] {
  const shapes: Shape[] = [];

  for (const obj of objects) {
    if (!obj.is_entity) continue;

    const shape = convertObject(obj, layerId, drawingId);
    if (shape) {
      shapes.push(shape);
    }
  }

  return shapes;
}

function convertObject(
  obj: DwgObject,
  layerId: string,
  drawingId: string,
): Shape | null {
  const d = obj.data;

  switch (obj.type_name) {
    case 'LINE': {
      const x1 = d.start_x ?? d.x1 ?? 0;
      const y1 = -(d.start_y ?? d.y1 ?? 0);
      const x2 = d.end_x ?? d.x2 ?? 0;
      const y2 = -(d.end_y ?? d.y2 ?? 0);
      return {
        id: generateId(),
        type: 'line',
        start: { x: x1, y: y1 },
        end: { x: x2, y: y2 },
        style: { ...defaultStyle, strokeColor: getColor(d) },
        layerId,
        drawingId,
      } as Shape;
    }

    case 'CIRCLE': {
      const cx = d.center_x ?? d.x ?? 0;
      const cy = -(d.center_y ?? d.y ?? 0);
      const radius = d.radius ?? 1;
      return {
        id: generateId(),
        type: 'circle',
        center: { x: cx, y: cy },
        radius,
        style: { ...defaultStyle, strokeColor: getColor(d) },
        layerId,
        drawingId,
      } as Shape;
    }

    case 'ARC': {
      const cx = d.center_x ?? d.x ?? 0;
      const cy = -(d.center_y ?? d.y ?? 0);
      const radius = d.radius ?? 1;
      const startAngle = d.start_angle ?? 0;
      const endAngle = d.end_angle ?? Math.PI * 2;
      return {
        id: generateId(),
        type: 'arc',
        center: { x: cx, y: cy },
        radius,
        startAngle: -endAngle,
        endAngle: -startAngle,
        style: { ...defaultStyle, strokeColor: getColor(d) },
        layerId,
        drawingId,
      } as Shape;
    }

    case 'ELLIPSE': {
      const cx = d.center_x ?? d.x ?? 0;
      const cy = -(d.center_y ?? d.y ?? 0);
      const majorX = d.major_x ?? d.major_axis_x ?? 1;
      const majorY = d.major_y ?? d.major_axis_y ?? 0;
      const ratio = d.minor_ratio ?? d.axis_ratio ?? 1;
      const majorRadius = Math.sqrt(majorX * majorX + majorY * majorY);
      const rotation = Math.atan2(-majorY, majorX);
      return {
        id: generateId(),
        type: 'ellipse',
        center: { x: cx, y: cy },
        radiusX: majorRadius,
        radiusY: majorRadius * ratio,
        rotation,
        style: { ...defaultStyle, strokeColor: getColor(d) },
        layerId,
        drawingId,
      } as Shape;
    }

    case 'LWPOLYLINE':
    case 'POLYLINE': {
      const points: { x: number; y: number; bulge?: number }[] = [];
      const rawPoints = d.points || d.vertices;
      if (Array.isArray(rawPoints)) {
        for (const pt of rawPoints) {
          if (typeof pt === 'object' && pt !== null) {
            points.push({
              x: pt.x ?? 0,
              y: -(pt.y ?? 0),
              bulge: pt.bulge ?? 0,
            });
          }
        }
      }
      if (points.length < 2) return null;
      const closed = d.closed ?? d.is_closed ?? false;
      return {
        id: generateId(),
        type: 'polyline',
        points,
        closed,
        style: { ...defaultStyle, strokeColor: getColor(d) },
        layerId,
        drawingId,
      } as Shape;
    }

    case 'SPLINE': {
      const points: { x: number; y: number }[] = [];
      const controlPoints = d.control_points || d.points;
      if (Array.isArray(controlPoints)) {
        for (const pt of controlPoints) {
          if (typeof pt === 'object' && pt !== null) {
            points.push({ x: pt.x ?? 0, y: -(pt.y ?? 0) });
          }
        }
      }
      if (points.length < 2) return null;
      const closed = d.closed ?? false;
      return {
        id: generateId(),
        type: 'spline',
        points,
        closed,
        style: { ...defaultStyle, strokeColor: getColor(d) },
        layerId,
        drawingId,
      } as Shape;
    }

    case 'TEXT':
    case 'MTEXT': {
      const x = d.insertion_x ?? d.x ?? 0;
      const y = -(d.insertion_y ?? d.y ?? 0);
      const text = d.text ?? d.value ?? d.content ?? '';
      const height = d.height ?? d.text_height ?? 2.5;
      const rotation = d.rotation ?? 0;
      if (!text) return null;
      return {
        id: generateId(),
        type: 'text',
        text,
        position: { x, y },
        fontSize: height,
        fontFamily: CAD_DEFAULT_FONT,
        color: getColor(d),
        bold: false,
        italic: false,
        underline: false,
        alignment: 'left' as const,
        verticalAlignment: 'top' as const,
        lineHeight: 1.4,
        rotation: -rotation * (Math.PI / 180),
        isModelText: true,
        style: { ...defaultStyle, strokeColor: getColor(d) },
        layerId,
        drawingId,
      } as Shape;
    }

    case 'POINT': {
      const x = d.x ?? 0;
      const y = -(d.y ?? 0);
      return {
        id: generateId(),
        type: 'point',
        position: { x, y },
        style: { ...defaultStyle, strokeColor: getColor(d) },
        layerId,
        drawingId,
      } as Shape;
    }

    default:
      return null;
  }
}

function getColor(data: Record<string, any>): string {
  const colorIndex = data.color ?? data.color_index;
  if (typeof colorIndex === 'number' && colorIndex >= 0) {
    return DWG_INDEX_COLORS[colorIndex] ?? '#ffffff';
  }
  return '#ffffff';
}

// Standard DWG/DXF color index table (first 10 + white)
const DWG_INDEX_COLORS: Record<number, string> = {
  0: '#000000', // BYBLOCK
  1: '#ff0000',
  2: '#ffff00',
  3: '#00ff00',
  4: '#00ffff',
  5: '#0000ff',
  6: '#ff00ff',
  7: '#ffffff',
  8: '#808080',
  9: '#c0c0c0',
};
