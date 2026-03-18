/**
 * WeFC Import Service
 *
 * Imports .wefc files into Open-2D-Studio, converting WeFC nodes
 * back to O2D shapes, layers, drawings and sheets.
 */

import type { Shape, Layer, Point, ShapeStyle } from '../../types/geometry';
import type { Drawing } from '../../types/drawing';
import type { Sheet, SheetViewport } from '../../types/sheet';
import type { ProjectInfo } from '../../types/projectInfo';
import type { WefcFile, WefcNode } from '../../types/wefc';

// ============================================================================
// Parse helpers
// ============================================================================

function resolveRef(ref: string): string {
  // Strip wefc:// prefix to get GUID
  if (ref.startsWith('wefc://')) return ref.slice(7);
  if (ref.startsWith('wfc://')) return ref.slice(6);  // legacy
  return ref;
}

function defaultStyle(): ShapeStyle {
  return {
    strokeColor: '#000000',
    strokeWidth: 1,
    lineStyle: 'solid',
  };
}

function nodeStyle(node: WefcNode): ShapeStyle {
  return {
    strokeColor: (node.strokeColor as string) ?? '#000000',
    strokeWidth: (node.strokeWidth as number) ?? 1,
    lineStyle: ((node.lineStyle as string) ?? 'solid') as ShapeStyle['lineStyle'],
    fillColor: node.fillColor as string | undefined,
  };
}

function generateId(): string {
  return crypto.randomUUID();
}

// ============================================================================
// WeFC Node → O2D Shape Mappers
// ============================================================================

function importGraphicElement(node: WefcNode, drawingId: string): Shape | null {
  const base = {
    id: node.guid ?? generateId(),
    layerId: resolveRef((node.layerRef as string) ?? ''),
    drawingId,
    style: nodeStyle(node),
    visible: true,
    locked: false,
  };

  const elementType = node.elementType as string;

  switch (elementType) {
    case 'line':
      return {
        ...base,
        type: 'line',
        start: { x: node.startX as number ?? 0, y: node.startY as number ?? 0 },
        end: { x: node.endX as number ?? 0, y: node.endY as number ?? 0 },
      } as any;

    case 'rectangle':
      return {
        ...base,
        type: 'rectangle',
        x: node.x as number ?? 0,
        y: node.y as number ?? 0,
        width: node.width as number ?? 100,
        height: node.height as number ?? 100,
        cornerRadius: node.cornerRadius as number ?? 0,
        rotation: node.rotation as number ?? 0,
      } as any;

    case 'circle':
      return {
        ...base,
        type: 'circle',
        center: { x: node.centerX as number ?? 0, y: node.centerY as number ?? 0 },
        radius: node.radius as number ?? 50,
      } as any;

    case 'arc':
      return {
        ...base,
        type: 'arc',
        center: { x: node.centerX as number ?? 0, y: node.centerY as number ?? 0 },
        radius: node.radius as number ?? 50,
        startAngle: node.startAngle as number ?? 0,
        endAngle: node.endAngle as number ?? Math.PI,
      } as any;

    case 'ellipse':
      return {
        ...base,
        type: 'ellipse',
        center: { x: node.centerX as number ?? 0, y: node.centerY as number ?? 0 },
        radiusX: node.radiusX as number ?? 50,
        radiusY: node.radiusY as number ?? 30,
        rotation: node.rotation as number ?? 0,
        startAngle: node.startAngle as number ?? 0,
        endAngle: node.endAngle as number ?? Math.PI * 2,
      } as any;

    case 'polyline':
      return {
        ...base,
        type: 'polyline',
        points: (node.points as Point[]) ?? [],
        closed: node.closed as boolean ?? false,
        bulge: node.bulge as number[] | undefined,
      } as any;

    case 'spline':
      return {
        ...base,
        type: 'spline',
        points: (node.points as Point[]) ?? [],
        closed: node.closed as boolean ?? false,
      } as any;

    case 'point':
      return {
        ...base,
        type: 'point',
        position: { x: node.x as number ?? 0, y: node.y as number ?? 0 },
      } as any;

    default:
      return null;
  }
}

function importAnnotation(node: WefcNode, drawingId: string): Shape | null {
  const base = {
    id: node.guid ?? generateId(),
    layerId: resolveRef((node.layerRef as string) ?? ''),
    drawingId,
    style: nodeStyle(node),
    visible: true,
    locked: false,
  };

  return {
    ...base,
    type: 'text',
    content: node.content as string ?? '',
    position: { x: node.positionX as number ?? 0, y: node.positionY as number ?? 0 },
    fontSize: node.fontSize as number ?? 12,
    fontFamily: node.fontFamily as string ?? 'Osifont',
    textAlign: node.textAlign as string ?? 'left',
    rotation: node.rotation as number ?? 0,
    bold: node.bold as boolean ?? false,
    italic: node.italic as boolean ?? false,
  } as any;
}

function importDimension(node: WefcNode, drawingId: string): Shape | null {
  return {
    id: node.guid ?? generateId(),
    type: 'dimension',
    layerId: resolveRef((node.layerRef as string) ?? ''),
    drawingId,
    style: nodeStyle(node),
    visible: true,
    locked: false,
    dimensionType: node.dimensionType as string ?? 'linear',
    start: { x: node.startX as number ?? 0, y: node.startY as number ?? 0 },
    end: { x: node.endX as number ?? 0, y: node.endY as number ?? 0 },
    value: node.value as number,
    textOverride: node.textOverride as string,
    offset: node.offset as number,
  } as any;
}

function importHatch(node: WefcNode, drawingId: string): Shape | null {
  return {
    id: node.guid ?? generateId(),
    type: 'hatch',
    layerId: resolveRef((node.layerRef as string) ?? ''),
    drawingId,
    style: nodeStyle(node),
    visible: true,
    locked: false,
    patternType: node.patternType as string ?? 'solid',
    patternAngle: node.patternAngle as number ?? 0,
    patternScale: node.patternScale as number ?? 1,
    fillColor: node.fillColor as string ?? '#808080',
    backgroundColor: node.backgroundColor as string,
    points: (node.boundaryPoints as Point[]) ?? [],
    masking: node.masking as boolean ?? true,
  } as any;
}

function importWall(node: WefcNode, drawingId: string): Shape | null {
  return {
    id: node.guid ?? generateId(),
    type: 'wall',
    layerId: resolveRef((node.layerRef as string) ?? ''),
    drawingId,
    style: nodeStyle(node),
    visible: true,
    locked: false,
    start: { x: node.startX as number ?? 0, y: node.startY as number ?? 0 },
    end: { x: node.endX as number ?? 0, y: node.endY as number ?? 0 },
    thickness: node.width as number ?? 200,
    material: node.material as string ?? 'concrete',
    isLoadBearing: node.isLoadBearing as boolean ?? true,
    isExternal: node.isExternal as boolean ?? false,
  } as any;
}

function importBeam(node: WefcNode, drawingId: string): Shape | null {
  return {
    id: node.guid ?? generateId(),
    type: 'beam',
    layerId: resolveRef((node.layerRef as string) ?? ''),
    drawingId,
    style: nodeStyle(node),
    visible: true,
    locked: false,
    start: { x: node.startX as number ?? 0, y: node.startY as number ?? 0 },
    end: { x: node.endX as number ?? 0, y: node.endY as number ?? 0 },
    profileType: 'i-beam',
    profileParameters: {},
    presetName: node.sectionProfile as string,
    flangeWidth: node.flangeWidth as number ?? 150,
    justification: (node.justification as string ?? 'center') as any,
    material: (node.material as string ?? 'steel') as any,
    showCenterline: true,
    showLabel: true,
    labelText: node.name,
    rotation: 0,
  } as any;
}

function importSlab(node: WefcNode, drawingId: string): Shape | null {
  return {
    id: node.guid ?? generateId(),
    type: 'slab',
    layerId: resolveRef((node.layerRef as string) ?? ''),
    drawingId,
    style: nodeStyle(node),
    visible: true,
    locked: false,
    thickness: node.thickness as number ?? 200,
    material: node.material as string ?? 'concrete',
    points: (node.boundaryPoints as Point[]) ?? [],
  } as any;
}

// ============================================================================
// Layer & Drawing Importers
// ============================================================================

function importLayer(node: WefcNode): Layer {
  return {
    id: node.guid ?? generateId(),
    name: node.name ?? 'Unnamed Layer',
    drawingId: resolveRef((node.drawingRef as string) ?? ''),
    visible: node.visible as boolean ?? true,
    locked: node.locked as boolean ?? false,
    color: node.color as string ?? '#000000',
    lineStyle: (node.lineStyle as string ?? 'solid') as any,
    lineWidth: node.lineWidth as number ?? 1,
  };
}

function importDrawing(node: WefcNode): Drawing {
  return {
    id: node.guid ?? generateId(),
    name: node.name ?? 'Drawing',
    scale: node.scale as number ?? 0.01,
    createdAt: node.created ?? new Date().toISOString(),
    modifiedAt: node.modified ?? new Date().toISOString(),
  } as Drawing;
}

function importViewport(node: WefcNode): SheetViewport {
  return {
    id: node.guid ?? generateId(),
    drawingId: resolveRef((node.drawingRef as string) ?? ''),
    x: node.positionX as number ?? 0,
    y: node.positionY as number ?? 0,
    width: node.width as number ?? 200,
    height: node.height as number ?? 150,
    centerX: node.centerX as number ?? 0,
    centerY: node.centerY as number ?? 0,
    scale: node.scale as number ?? 0.01,
    visible: true,
    locked: false,
  } as SheetViewport;
}

function importSheet(node: WefcNode, viewportNodes: WefcNode[]): Sheet {
  const vpRefs = (node.viewports as string[]) ?? [];
  const vpGuids = vpRefs.map(resolveRef);
  const viewports = viewportNodes
    .filter(vn => vpGuids.includes(vn.guid))
    .map(importViewport);

  return {
    id: node.guid ?? generateId(),
    name: node.name ?? 'Sheet',
    paperSize: (node.sheetFormat as string ?? 'A3') as any,
    orientation: (node.orientation as string ?? 'landscape') as any,
    viewports,
    createdAt: node.created ?? new Date().toISOString(),
    modifiedAt: node.modified ?? new Date().toISOString(),
  } as Sheet;
}

// ============================================================================
// Main Import Function
// ============================================================================

/**
 * Import a .wefc file into Open-2D-Studio.
 *
 * @param wefcJson - WeFC JSON string
 * @returns O2D project data (shapes, layers, drawings, sheets)
 */
export function importWeFC(wefcJson: string): {
  shapes: Shape[];
  layers: Layer[];
  drawings: Drawing[];
  sheets: Sheet[];
  projectInfo?: Partial<ProjectInfo>;
} {
  const file: WefcFile = JSON.parse(wefcJson);

  if (file.header?.schema !== 'WeFC') {
    throw new Error('Not a valid WeFC file: header.schema must be "WeFC"');
  }

  const nodes = file.data ?? [];
  const shapes: Shape[] = [];
  const layers: Layer[] = [];
  const drawings: Drawing[] = [];
  const sheets: Sheet[] = [];
  let projectInfo: Partial<ProjectInfo> | undefined;

  // Index nodes by type
  const byType = new Map<string, WefcNode[]>();
  for (const node of nodes) {
    const t = node.type;
    if (!byType.has(t)) byType.set(t, []);
    byType.get(t)!.push(node);
  }

  // Import layers first (needed for shape references)
  for (const node of byType.get('WefcLayer') ?? []) {
    layers.push(importLayer(node));
  }

  // Import drawings
  const drawingNodes = (byType.get('WefcDrawingSheet') ?? []).filter(n => !n.sheetFormat);
  for (const node of drawingNodes) {
    drawings.push(importDrawing(node));
  }

  // If no drawings found, create a default one
  const defaultDrawingId = drawings.length > 0 ? drawings[0].id : generateId();
  if (drawings.length === 0) {
    drawings.push({
      id: defaultDrawingId,
      name: 'Imported Drawing',
      scale: 0.01,
      createdAt: new Date().toISOString(),
      modifiedAt: new Date().toISOString(),
    } as Drawing);
  }

  // If no layers, create a default one
  if (layers.length === 0) {
    layers.push({
      id: generateId(),
      name: 'Default',
      drawingId: defaultDrawingId,
      visible: true,
      locked: false,
      color: '#000000',
      lineStyle: 'solid',
      lineWidth: 1,
    });
  }

  // Assign layers to first drawing if they don't have a drawingId
  for (const layer of layers) {
    if (!layer.drawingId) layer.drawingId = defaultDrawingId;
  }

  // Import viewports
  const viewportNodes = byType.get('WefcViewport') ?? [];

  // Import sheets
  const sheetNodes = (byType.get('WefcDrawingSheet') ?? []).filter(n => n.sheetFormat);
  for (const node of sheetNodes) {
    sheets.push(importSheet(node, viewportNodes));
  }

  // Import shapes
  const drawingId = defaultDrawingId;
  const defaultLayerId = layers[0].id;

  for (const node of byType.get('WefcGraphicElement') ?? []) {
    const shape = importGraphicElement(node, drawingId);
    if (shape) {
      if (!shape.layerId) (shape as any).layerId = defaultLayerId;
      shapes.push(shape);
    }
  }

  for (const node of byType.get('WefcAnnotation') ?? []) {
    const shape = importAnnotation(node, drawingId);
    if (shape) {
      if (!shape.layerId) (shape as any).layerId = defaultLayerId;
      shapes.push(shape);
    }
  }

  for (const node of byType.get('WefcDimension') ?? []) {
    const shape = importDimension(node, drawingId);
    if (shape) {
      if (!shape.layerId) (shape as any).layerId = defaultLayerId;
      shapes.push(shape);
    }
  }

  for (const node of byType.get('WefcHatchPattern') ?? []) {
    const shape = importHatch(node, drawingId);
    if (shape) {
      if (!shape.layerId) (shape as any).layerId = defaultLayerId;
      shapes.push(shape);
    }
  }

  for (const node of byType.get('WefcWall') ?? []) {
    const shape = importWall(node, drawingId);
    if (shape) {
      if (!shape.layerId) (shape as any).layerId = defaultLayerId;
      shapes.push(shape);
    }
  }

  for (const node of byType.get('WefcBeam') ?? []) {
    const shape = importBeam(node, drawingId);
    if (shape) {
      if (!shape.layerId) (shape as any).layerId = defaultLayerId;
      shapes.push(shape);
    }
  }

  for (const node of byType.get('WefcSlab') ?? []) {
    const shape = importSlab(node, drawingId);
    if (shape) {
      if (!shape.layerId) (shape as any).layerId = defaultLayerId;
      shapes.push(shape);
    }
  }

  // Project info
  const projectNodes = byType.get('WefcProject') ?? [];
  if (projectNodes.length > 0) {
    const p = projectNodes[0];
    projectInfo = {
      projectName: p.name,
      projectNumber: p.projectNumber as string,
    } as Partial<ProjectInfo>;
  }

  return { shapes, layers, drawings, sheets, projectInfo };
}
