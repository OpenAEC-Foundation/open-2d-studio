/**
 * WeFC Export Service
 *
 * Exports Open-2D-Studio shapes to WeFC (.wefc) JSON format.
 * Maps O2D drawing primitives to the WeFC drawing domain schema.
 *
 * WeFC file structure:
 * - header: file metadata
 * - imports: schema references
 * - data: flat array of typed objects with wefc:// cross-references
 */

import type { Shape, Layer, Point } from '../../types/geometry';
import type { Drawing } from '../../types/drawing';
import type { Sheet, SheetViewport } from '../../types/sheet';
import type { ProjectInfo } from '../../types/projectInfo';
import type {
  WefcFile,
  WefcNode,
  WefcExportOptions,
} from '../../types/wefc';

// ============================================================================
// UUID Generation
// ============================================================================

function generateGuid(): string {
  return crypto.randomUUID();
}

function makeRef(guid: string): string {
  return `wefc://${guid}`;
}

function nowISO(): string {
  return new Date().toISOString();
}

// ============================================================================
// Shape → WeFC Node Mappers
// ============================================================================

function mapBaseFields(name: string, type: string, layerRef?: string): Partial<WefcNode> {
  const now = nowISO();
  return {
    type,
    guid: generateGuid(),
    name,
    version: '1.0.0',
    created: now,
    modified: now,
    status: 'active' as const,
    ...(layerRef ? { layerRef: makeRef(layerRef) } : {}),
  };
}

function mapStyle(shape: Shape): Record<string, unknown> {
  return {
    strokeColor: shape.style.strokeColor,
    strokeWidth: shape.style.strokeWidth,
    lineStyle: shape.style.lineStyle,
    ...(shape.style.fillColor ? { fillColor: shape.style.fillColor } : {}),
  };
}

function mapLineShape(shape: Shape & { type: 'line' }): WefcNode {
  const s = shape as any;
  return {
    ...mapBaseFields(`Line ${shape.id.slice(0, 8)}`, 'WefcGraphicElement', shape.layerId),
    elementType: 'line',
    startX: s.start.x,
    startY: s.start.y,
    endX: s.end.x,
    endY: s.end.y,
    ...mapStyle(shape),
  } as WefcNode;
}

function mapRectShape(shape: Shape & { type: 'rectangle' }): WefcNode {
  const s = shape as any;
  return {
    ...mapBaseFields(`Rectangle ${shape.id.slice(0, 8)}`, 'WefcGraphicElement', shape.layerId),
    elementType: 'rectangle',
    x: s.x,
    y: s.y,
    width: s.width,
    height: s.height,
    cornerRadius: s.cornerRadius ?? 0,
    rotation: s.rotation ?? 0,
    ...mapStyle(shape),
  } as WefcNode;
}

function mapCircleShape(shape: Shape & { type: 'circle' }): WefcNode {
  const s = shape as any;
  return {
    ...mapBaseFields(`Circle ${shape.id.slice(0, 8)}`, 'WefcGraphicElement', shape.layerId),
    elementType: 'circle',
    centerX: s.center.x,
    centerY: s.center.y,
    radius: s.radius,
    ...mapStyle(shape),
  } as WefcNode;
}

function mapArcShape(shape: Shape & { type: 'arc' }): WefcNode {
  const s = shape as any;
  return {
    ...mapBaseFields(`Arc ${shape.id.slice(0, 8)}`, 'WefcGraphicElement', shape.layerId),
    elementType: 'arc',
    centerX: s.center.x,
    centerY: s.center.y,
    radius: s.radius,
    startAngle: s.startAngle,
    endAngle: s.endAngle,
    ...mapStyle(shape),
  } as WefcNode;
}

function mapEllipseShape(shape: Shape & { type: 'ellipse' }): WefcNode {
  const s = shape as any;
  return {
    ...mapBaseFields(`Ellipse ${shape.id.slice(0, 8)}`, 'WefcGraphicElement', shape.layerId),
    elementType: 'ellipse',
    centerX: s.center.x,
    centerY: s.center.y,
    radiusX: s.radiusX,
    radiusY: s.radiusY,
    rotation: s.rotation ?? 0,
    startAngle: s.startAngle,
    endAngle: s.endAngle,
    ...mapStyle(shape),
  } as WefcNode;
}

function mapPolylineShape(shape: Shape & { type: 'polyline' }): WefcNode {
  const s = shape as any;
  return {
    ...mapBaseFields(`Polyline ${shape.id.slice(0, 8)}`, 'WefcGraphicElement', shape.layerId),
    elementType: 'polyline',
    points: (s.points as Point[]).map((p: Point) => ({ x: p.x, y: p.y })),
    closed: s.closed ?? false,
    bulge: s.bulge,
    ...mapStyle(shape),
  } as WefcNode;
}

function mapSplineShape(shape: Shape & { type: 'spline' }): WefcNode {
  const s = shape as any;
  return {
    ...mapBaseFields(`Spline ${shape.id.slice(0, 8)}`, 'WefcGraphicElement', shape.layerId),
    elementType: 'spline',
    points: (s.points as Point[]).map((p: Point) => ({ x: p.x, y: p.y })),
    closed: s.closed ?? false,
    ...mapStyle(shape),
  } as WefcNode;
}

function mapPointShape(shape: Shape & { type: 'point' }): WefcNode {
  const s = shape as any;
  return {
    ...mapBaseFields(`Point ${shape.id.slice(0, 8)}`, 'WefcGraphicElement', shape.layerId),
    elementType: 'point',
    x: s.position?.x ?? s.x ?? 0,
    y: s.position?.y ?? s.y ?? 0,
    ...mapStyle(shape),
  } as WefcNode;
}

function mapTextShape(shape: Shape & { type: 'text' }): WefcNode {
  const s = shape as any;
  return {
    ...mapBaseFields(s.content?.slice(0, 40) ?? `Text ${shape.id.slice(0, 8)}`, 'WefcAnnotation', shape.layerId),
    annotationType: 'text',
    content: s.content ?? '',
    positionX: s.position?.x ?? s.x ?? 0,
    positionY: s.position?.y ?? s.y ?? 0,
    fontSize: s.fontSize ?? 12,
    fontFamily: s.fontFamily ?? 'Osifont',
    textAlign: s.textAlign ?? 'left',
    rotation: s.rotation ?? 0,
    bold: s.bold ?? false,
    italic: s.italic ?? false,
    ...mapStyle(shape),
  } as WefcNode;
}

function mapDimensionShape(shape: Shape & { type: 'dimension' }): WefcNode {
  const s = shape as any;
  return {
    ...mapBaseFields(`Dimension ${shape.id.slice(0, 8)}`, 'WefcDimension', shape.layerId),
    dimensionType: s.dimensionType ?? 'linear',
    startX: s.start?.x ?? 0,
    startY: s.start?.y ?? 0,
    endX: s.end?.x ?? 0,
    endY: s.end?.y ?? 0,
    value: s.value,
    unit: 'mm',
    textOverride: s.textOverride,
    offset: s.offset,
    ...mapStyle(shape),
  } as WefcNode;
}

function mapHatchShape(shape: Shape & { type: 'hatch' }): WefcNode {
  const s = shape as any;
  return {
    ...mapBaseFields(`Hatch ${shape.id.slice(0, 8)}`, 'WefcHatchPattern', shape.layerId),
    patternType: s.patternType,
    patternAngle: s.patternAngle ?? 0,
    patternScale: s.patternScale ?? 1,
    fillColor: s.fillColor,
    backgroundColor: s.backgroundColor,
    boundaryPoints: (s.points as Point[])?.map((p: Point) => ({ x: p.x, y: p.y })),
    masking: s.masking ?? true,
    ...mapStyle(shape),
  } as WefcNode;
}

function mapImageShape(shape: Shape & { type: 'image' }): WefcNode {
  const s = shape as any;
  return {
    ...mapBaseFields(`Image ${shape.id.slice(0, 8)}`, 'WefcGraphicElement', shape.layerId),
    elementType: 'image',
    x: s.x ?? 0,
    y: s.y ?? 0,
    width: s.width ?? 0,
    height: s.height ?? 0,
    opacity: s.opacity ?? 1,
    imageData: s.data,  // base64 data URL
  } as WefcNode;
}

// Structural elements → WeFC building domain

function mapWallShape(shape: Shape & { type: 'wall' }): WefcNode {
  const s = shape as any;
  return {
    ...mapBaseFields(s.label ?? `Wall ${shape.id.slice(0, 8)}`, 'WefcWall', shape.layerId),
    wallType: 'standard',
    startX: s.start?.x ?? 0,
    startY: s.start?.y ?? 0,
    endX: s.end?.x ?? 0,
    endY: s.end?.y ?? 0,
    width: s.thickness ?? s.width ?? 200,
    material: s.material ?? 'concrete',
    isLoadBearing: s.isLoadBearing ?? true,
    isExternal: s.isExternal ?? false,
    ...mapStyle(shape),
  } as WefcNode;
}

function mapBeamShape(shape: Shape & { type: 'beam' }): WefcNode {
  const s = shape as any;
  return {
    ...mapBaseFields(s.labelText ?? s.presetName ?? `Beam ${shape.id.slice(0, 8)}`, 'WefcBeam', shape.layerId),
    beamType: 'beam',
    startX: s.start?.x ?? 0,
    startY: s.start?.y ?? 0,
    endX: s.end?.x ?? 0,
    endY: s.end?.y ?? 0,
    sectionProfile: s.presetName ?? s.profileType ?? 'unknown',
    flangeWidth: s.flangeWidth ?? 0,
    material: s.material ?? 'steel',
    justification: s.justification ?? 'center',
    ...mapStyle(shape),
  } as WefcNode;
}

function mapSlabShape(shape: Shape & { type: 'slab' }): WefcNode {
  const s = shape as any;
  return {
    ...mapBaseFields(`Slab ${shape.id.slice(0, 8)}`, 'WefcSlab', shape.layerId),
    slabType: 'floor',
    thickness: s.thickness ?? 200,
    material: s.material ?? 'concrete',
    boundaryPoints: (s.points as Point[])?.map((p: Point) => ({ x: p.x, y: p.y })),
    ...mapStyle(shape),
  } as WefcNode;
}

function mapGenericShape(shape: Shape): WefcNode {
  const s = shape as any;
  return {
    ...mapBaseFields(`${shape.type} ${shape.id.slice(0, 8)}`, 'WefcGraphicElement', shape.layerId),
    elementType: shape.type,
    sourceData: JSON.parse(JSON.stringify(s)),
    ...mapStyle(shape),
  } as WefcNode;
}

// ============================================================================
// Shape Router
// ============================================================================

function mapShape(shape: Shape): WefcNode {
  switch (shape.type) {
    case 'line':       return mapLineShape(shape as any);
    case 'rectangle':  return mapRectShape(shape as any);
    case 'circle':     return mapCircleShape(shape as any);
    case 'arc':        return mapArcShape(shape as any);
    case 'ellipse':    return mapEllipseShape(shape as any);
    case 'polyline':   return mapPolylineShape(shape as any);
    case 'spline':     return mapSplineShape(shape as any);
    case 'point':      return mapPointShape(shape as any);
    case 'text':       return mapTextShape(shape as any);
    case 'dimension':  return mapDimensionShape(shape as any);
    case 'hatch':      return mapHatchShape(shape as any);
    case 'image':      return mapImageShape(shape as any);
    case 'wall':       return mapWallShape(shape as any);
    case 'beam':       return mapBeamShape(shape as any);
    case 'slab':       return mapSlabShape(shape as any);
    default:           return mapGenericShape(shape);
  }
}

// ============================================================================
// Layer, Drawing, Sheet Mappers
// ============================================================================

function mapLayer(layer: Layer): WefcNode {
  const now = nowISO();
  return {
    type: 'WefcLayer',
    guid: layer.id,
    name: layer.name,
    version: '1.0.0',
    created: now,
    modified: now,
    status: 'active',
    visible: layer.visible,
    locked: layer.locked,
    color: layer.color,
    lineStyle: layer.lineStyle,
    lineWidth: layer.lineWidth,
  } as WefcNode;
}

function mapDrawing(drawing: Drawing): WefcNode {
  const now = nowISO();
  return {
    type: 'WefcDrawingSheet',
    guid: drawing.id,
    name: drawing.name,
    version: '1.0.0',
    created: drawing.createdAt ?? now,
    modified: drawing.modifiedAt ?? now,
    status: 'active',
    scale: drawing.scale,
    drawingType: (drawing as any).drawingType ?? 'standalone',
  } as WefcNode;
}

function mapSheet(sheet: Sheet): WefcNode {
  const now = nowISO();
  const viewportGuids = (sheet.viewports ?? []).map((vp: SheetViewport) => makeRef(vp.id));
  return {
    type: 'WefcDrawingSheet',
    guid: sheet.id,
    name: sheet.name,
    version: '1.0.0',
    created: sheet.createdAt ?? now,
    modified: sheet.modifiedAt ?? now,
    status: 'active',
    sheetFormat: (sheet as any).paperSize ?? 'A3',
    orientation: sheet.orientation ?? 'landscape',
    viewports: viewportGuids,
  } as WefcNode;
}

function mapSheetViewport(vp: SheetViewport): WefcNode {
  const now = nowISO();
  return {
    type: 'WefcViewport',
    guid: vp.id,
    name: `Viewport ${vp.id.slice(0, 8)}`,
    version: '1.0.0',
    created: now,
    modified: now,
    status: 'active',
    drawingRef: makeRef(vp.drawingId),
    positionX: vp.x,
    positionY: vp.y,
    width: vp.width,
    height: vp.height,
    scale: vp.scale,
    centerX: vp.centerX,
    centerY: vp.centerY,
  } as WefcNode;
}

// ============================================================================
// Main Export Function
// ============================================================================

/**
 * Export Open-2D-Studio project data to WeFC JSON format.
 *
 * @param shapes - All shapes to export
 * @param layers - All layers
 * @param drawings - All drawings
 * @param sheets - All sheets
 * @param projectInfo - Optional project metadata
 * @param options - Export options
 * @returns WeFC JSON string
 */
export function exportToWeFC(
  shapes: Shape[],
  layers: Layer[],
  drawings: Drawing[],
  sheets: Sheet[],
  projectInfo?: ProjectInfo,
  options?: WefcExportOptions,
): string {
  const now = nowISO();
  const data: WefcNode[] = [];
  const imports: Array<{ uri: string; version: string }> = [
    { uri: 'https://openaec.org/wefc/schemas/wefc-core@1.0', version: '^1.0.0' },
    { uri: 'https://openaec.org/wefc/schemas/wefc-drawing@1.0', version: '^1.0.0' },
  ];

  // Check if we have structural elements
  const hasStructural = shapes.some(s =>
    s.type === 'wall' || s.type === 'beam' || s.type === 'slab',
  );
  if (hasStructural) {
    imports.push({ uri: 'https://openaec.org/wefc/schemas/wefc-building@1.0', version: '^1.0.0' });
  }

  // Project node
  const projectGuid = generateGuid();
  data.push({
    type: 'WefcProject',
    guid: projectGuid,
    name: (projectInfo as any)?.projectName ?? 'Open-2D-Studio Project',
    version: '1.0.0',
    created: now,
    modified: now,
    status: 'active',
    description: options?.description ?? '',
    projectNumber: (projectInfo as any)?.projectNumber ?? '',
  } as WefcNode);

  // Filter layers based on options
  const filteredLayers = layers.filter(l => {
    if (!options?.includeHiddenLayers && !l.visible) return false;
    if (!options?.includeLockedLayers && l.locked) return false;
    return true;
  });

  const layerIds = new Set(filteredLayers.map(l => l.id));

  // Map layers
  for (const layer of filteredLayers) {
    data.push(mapLayer(layer));
  }

  // Map drawings
  for (const drawing of drawings) {
    data.push(mapDrawing(drawing));
  }

  // Map sheets and their viewports
  for (const sheet of sheets) {
    data.push(mapSheet(sheet));
    for (const vp of sheet.viewports ?? []) {
      data.push(mapSheetViewport(vp));
    }
  }

  // Map shapes (filter by visible layers)
  const filteredShapes = shapes.filter(s => layerIds.has(s.layerId) && s.visible);
  for (const shape of filteredShapes) {
    data.push(mapShape(shape));
  }

  // Build the WeFC file
  const wefcFile: WefcFile = {
    header: {
      schema: 'WeFC',
      schemaVersion: '1.0.0',
      fileId: generateGuid(),
      description: options?.description ?? `Exported from Open-2D-Studio`,
      author: options?.author ?? (projectInfo as any)?.author ?? '',
      organization: options?.organization ?? (projectInfo as any)?.organization ?? '',
      timestamp: now,
      application: 'Open-2D-Studio',
      applicationVersion: '1.0.0',
      license: 'LGPL-3.0-or-later',
    },
    imports,
    data,
  };

  return JSON.stringify(wefcFile, null, 2);
}
