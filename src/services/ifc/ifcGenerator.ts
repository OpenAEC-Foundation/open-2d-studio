/**
 * IFC4.0 Generator Service (ISO 16739-1:2018)
 *
 * Converts the application's shapes into IFC4 STEP physical file format
 * (ISO 10303-21). Generates a valid IFC4 file with proper spatial structure,
 * geometry representations, element types, materials, and property sets.
 *
 * Supported mappings:
 *   WallShape          -> IfcWall + IfcWallType + Pset_WallCommon + IfcMaterialLayerSetUsage
 *   BeamShape          -> IfcBeam + IfcBeamType + Pset_BeamCommon + IfcMaterial
 *   SlabShape          -> IfcSlab + IfcSlabType + Pset_SlabCommon + IfcMaterialLayerSetUsage
 *   GridlineShape      -> IfcGrid + IfcGridAxis
 *   LevelShape         -> IfcBuildingStorey + IfcAnnotation
 *   PileShape          -> IfcPile + Pset_PileCommon + IfcMaterial
 *   PuntniveauShape    -> IfcBuildingElementProxy (extruded slab at NAP elevation) + Open2DStudio_Puntniveau
 *   CPTShape           -> IfcBuildingElementProxy + 3D cylinder + Open2DStudio_CPT properties
 *   (Column beams)     -> IfcColumn
 *   LineShape          -> IfcAnnotation (Curve2D IfcPolyline)
 *   ArcShape           -> IfcAnnotation (Curve2D IfcTrimmedCurve)
 *   CircleShape        -> IfcAnnotation (Curve2D IfcCircle)
 *   PolylineShape      -> IfcAnnotation (Curve2D IfcPolyline)
 *   RectangleShape     -> IfcAnnotation (Curve2D IfcPolyline)
 *   DimensionShape     -> IfcAnnotation with dimension text
 *   TextShape          -> IfcAnnotation
 *   SectionCalloutShape -> IfcAnnotation
 *   SpaceShape          -> IfcSpace + Pset_SpaceCommon + boundary polygon
 */

import type {
  Shape,
  Drawing,
  GridlineShape,
  LevelShape,
  WallType,
  SlabType,
  PileTypeDefinition,
  Point,
  LineShape,
  ArcShape,
  CircleShape,
  PolylineShape,
  RectangleShape,
  TextShape,
} from '../../types/geometry';
import type { DimensionShape } from '../../types/dimension';
import type { ProjectStructure } from '../../state/slices/parametricSlice';
import { ifcExportRegistry } from '../../engine/registry/IfcExportRegistry';

import {
  generateIfcGuid,
  shapeToIfcGuid,
  getMaterialDisplayName,
} from './guidHelpers';

import {
  createProjectContext,
  createCurveAnnotation,
  MaterialCache,
  assembleStepFile,
  stepReal,
  ifcLabel,
  ifcBoolean,
  ifcIdentifier,
  ifcLengthMeasure,
  ifcPositiveLengthMeasure,
  ifcAreaMeasure,
  ifcVolumeMeasure,
} from './ifcFactoryAdapter';

// ============================================================================
// Geometry Helpers
// ============================================================================

function lineLength(start: Point, end: Point): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  return Math.sqrt(dx * dx + dy * dy);
}

function lineAngle(start: Point, end: Point): number {
  return Math.atan2(end.y - start.y, end.x - start.x);
}

// ============================================================================
// IFC Generation Result
// ============================================================================

export interface IfcGenerationResult {
  content: string;
  entityCount: number;
  fileSize: number;
}

// ============================================================================
// Main Generator Function
// ============================================================================

export function generateIFC(
  shapes: Shape[],
  wallTypes: WallType[],
  slabTypes: SlabType[],
  projectStructure?: ProjectStructure,
  drawings?: Drawing[],
  pileTypes?: PileTypeDefinition[]
): IfcGenerationResult {
  // -------------------------------------------------------------------------
  // 1. Project context (person, org, app, units, geometry, project entity)
  // -------------------------------------------------------------------------
  const ctx = createProjectContext();
  const b = ctx.builder;
  const {
    ownerHistoryId, lengthUnit, areaUnit, volumeUnit,
    bodySubContext, axisSubContext,
    projectId, originPt, zDir, xDir, worldCoord,
    profilePlacement2D, extrusionDir, identityPlacement,
  } = ctx;

  // -------------------------------------------------------------------------
  // 2. Spatial structure: Site -> Building(s) -> Storey(s)
  // -------------------------------------------------------------------------
  const siteName = projectStructure?.siteName || 'Default Site';
  const sitePlacement = b.addLocalPlacement(null, worldCoord);
  const siteId = b.addSite(generateIfcGuid(), ownerHistoryId, siteName, sitePlacement);
  b.addRelAggregates(generateIfcGuid(), ownerHistoryId, 'ProjectContainer', projectId, [siteId]);

  const psBuildings = projectStructure?.buildings ?? [
    { id: 'default-building', name: 'Default Building', storeys: [] },
  ];

  const buildingIds: number[] = [];
  const buildingInfoMap = new Map<string, {
    buildingPlacement: number;
    storeyIds: number[];
    defaultStoreyId: number;
  }>();

  for (const psBuilding of psBuildings) {
    const buildingAxisPlace = b.addAxis2Placement3D(originPt, zDir, xDir);
    const buildingPlacement = b.addLocalPlacement(sitePlacement, buildingAxisPlace);
    const buildingId = b.addBuilding(generateIfcGuid(), ownerHistoryId, psBuilding.name, buildingPlacement);
    buildingIds.push(buildingId);

    const psBuildingStoreyIds: number[] = [];
    let defaultStoreyIdForBuilding: number | undefined;
    let closestElevation = Infinity;

    if (psBuilding.storeys.length > 0) {
      for (const psStorey of psBuilding.storeys) {
        const storeyAxisPlace = b.addAxis2Placement3D(
          b.addCartesianPoint(0, 0, psStorey.elevation), zDir, xDir
        );
        const storeyPlacement = b.addLocalPlacement(buildingPlacement, storeyAxisPlace);
        const storeyEntityId = b.addBuildingStorey(
          shapeToIfcGuid(psStorey.id), ownerHistoryId, psStorey.name,
          storeyPlacement, psStorey.elevation
        );
        psBuildingStoreyIds.push(storeyEntityId);
        if (Math.abs(psStorey.elevation) < closestElevation) {
          closestElevation = Math.abs(psStorey.elevation);
          defaultStoreyIdForBuilding = storeyEntityId;
        }
      }
    }

    if (psBuildingStoreyIds.length === 0) {
      const defaultStoreyAxisPlace = b.addAxis2Placement3D(originPt, zDir, xDir);
      const defaultStoreyPlacement = b.addLocalPlacement(buildingPlacement, defaultStoreyAxisPlace);
      const defaultStoreyId = b.addBuildingStorey(
        generateIfcGuid(), ownerHistoryId, 'Ground Floor',
        defaultStoreyPlacement, 0
      );
      psBuildingStoreyIds.push(defaultStoreyId);
      defaultStoreyIdForBuilding = defaultStoreyId;
    }

    b.addRelAggregates(generateIfcGuid(), ownerHistoryId, 'BuildingContainer', buildingId, psBuildingStoreyIds);

    buildingInfoMap.set(psBuilding.id, {
      buildingPlacement,
      storeyIds: psBuildingStoreyIds,
      defaultStoreyId: defaultStoreyIdForBuilding!,
    });
  }

  b.addRelAggregates(generateIfcGuid(), ownerHistoryId, 'SiteContainer', siteId, buildingIds);

  const firstBuildingInfo = buildingInfoMap.values().next().value!;
  const defaultStoreyId = firstBuildingInfo.defaultStoreyId;
  const buildingPlacement = firstBuildingInfo.buildingPlacement;

  // -------------------------------------------------------------------------
  // 3. Additional storeys from LevelShapes
  // -------------------------------------------------------------------------
  const levels = shapes.filter((s): s is LevelShape => s.type === 'level' && !s.id.startsWith('section-ref-'));
  const storeyMap = new Map<string, number>();

  if (levels.length > 0) {
    const additionalStoreyIds: number[] = [];
    for (const level of levels) {
      const storeyAxisPlace = b.addAxis2Placement3D(
        b.addCartesianPoint(0, 0, level.elevation), zDir, xDir
      );
      const storeyPlacement = b.addLocalPlacement(buildingPlacement, storeyAxisPlace);
      const storeyEntityId = b.addBuildingStorey(
        shapeToIfcGuid(level.id), ownerHistoryId,
        level.label || `Level ${level.elevation}`,
        storeyPlacement, level.elevation
      );
      additionalStoreyIds.push(storeyEntityId);
      storeyMap.set(level.id, storeyEntityId);
    }
    if (additionalStoreyIds.length > 0 && buildingIds.length > 0) {
      b.addRelAggregates(
        generateIfcGuid(), ownerHistoryId, 'LevelStoreys',
        buildingIds[0], additionalStoreyIds
      );
    }
  }

  const defaultStoreyPlacement = (() => {
    const pt = b.addCartesianPoint(0, 0, 0);
    const ax = b.addAxis2Placement3D(pt, zDir, xDir);
    return b.addLocalPlacement(buildingPlacement, ax);
  })();

  // -------------------------------------------------------------------------
  // 4. Drawing type resolution
  // -------------------------------------------------------------------------
  const drawingMap = new Map<string, Drawing>();
  if (drawings) {
    for (const d of drawings) {
      drawingMap.set(d.id, d);
    }
  }

  // Build a fast lookup: projectStructure storey ID -> IFC entity ID
  const psStoreyEntityMap = new Map<string, number>();
  for (const psBuilding of psBuildings) {
    const buildingInfo = buildingInfoMap.get(psBuilding.id);
    if (buildingInfo) {
      for (let i = 0; i < psBuilding.storeys.length; i++) {
        if (i < buildingInfo.storeyIds.length) {
          psStoreyEntityMap.set(psBuilding.storeys[i].id, buildingInfo.storeyIds[i]);
        }
      }
    }
  }

  function resolveStoreyForShape(shape: Shape): number {
    // 1. Use shape's own baseLevel/level storey reference if available (walls, beams, slabs)
    const shapeStoreyId = (shape as any).baseLevel || (shape as any).level;
    if (shapeStoreyId && shapeStoreyId !== 'unconnected') {
      // Check projectStructure storeys
      const entityId = psStoreyEntityMap.get(shapeStoreyId);
      if (entityId !== undefined) {
        console.debug(`[IFC] resolveStorey shape=${shape.id} type=${shape.type} -> baseLevel/level="${shapeStoreyId}" -> entity #${entityId}`);
        return entityId;
      }
      // Check LevelShape-derived storeys
      const levelEntityId = storeyMap.get(shapeStoreyId);
      if (levelEntityId !== undefined) {
        console.debug(`[IFC] resolveStorey shape=${shape.id} type=${shape.type} -> baseLevel/level="${shapeStoreyId}" -> levelStorey #${levelEntityId}`);
        return levelEntityId;
      }
      console.debug(`[IFC] resolveStorey shape=${shape.id} type=${shape.type} -> baseLevel/level="${shapeStoreyId}" NOT FOUND in storeys, falling through`);
    }

    // 2. Fall back to drawing's storey
    const drawing = drawingMap.get(shape.drawingId);
    if (drawing?.drawingType === 'plan' && drawing.storeyId) {
      const entityId = psStoreyEntityMap.get(drawing.storeyId);
      if (entityId !== undefined) {
        console.debug(`[IFC] resolveStorey shape=${shape.id} type=${shape.type} -> drawing "${drawing.name}" storeyId="${drawing.storeyId}" -> entity #${entityId}`);
        return entityId;
      }
      // Check LevelShape-derived storeys for drawing fallback too
      const levelEntityId = storeyMap.get(drawing.storeyId);
      if (levelEntityId !== undefined) {
        console.debug(`[IFC] resolveStorey shape=${shape.id} type=${shape.type} -> drawing "${drawing.name}" storeyId="${drawing.storeyId}" -> levelStorey #${levelEntityId}`);
        return levelEntityId;
      }
      console.debug(`[IFC] resolveStorey shape=${shape.id} type=${shape.type} -> drawing "${drawing.name}" storeyId="${drawing.storeyId}" NOT FOUND`);
    } else {
      console.debug(`[IFC] resolveStorey shape=${shape.id} type=${shape.type} -> drawing="${drawing?.name || 'NONE'}" type=${drawing?.drawingType} storeyId=${drawing?.storeyId} -> using default`);
    }
    return defaultStoreyId;
  }

  function isShapeInPlanDrawing(shape: Shape): boolean {
    const drawing = drawingMap.get(shape.drawingId);
    return drawing?.drawingType === 'plan';
  }

  function isShapeInSectionDrawing(shape: Shape): boolean {
    const drawing = drawingMap.get(shape.drawingId);
    return drawing?.drawingType === 'section';
  }

  // Track elements by their target storey for containment
  const storeyElementsMap = new Map<number, number[]>();

  function addElementToStorey(elementId: number, storeyId: number) {
    const existing = storeyElementsMap.get(storeyId) || [];
    existing.push(elementId);
    storeyElementsMap.set(storeyId, existing);
  }

  // -------------------------------------------------------------------------
  // 5. Materials cache
  // -------------------------------------------------------------------------
  const materials = new MaterialCache(b);

  // -------------------------------------------------------------------------
  // 6. Element placement helper
  // -------------------------------------------------------------------------
  function createElementPlacement(
    startX: number, startY: number, startZ: number, angle: number
  ): number {
    const cosA = Math.cos(angle);
    const sinA = Math.sin(angle);
    const pt = b.addCartesianPoint(startX, startY, startZ);
    const dir = b.addDirection(cosA, sinA, 0);
    const axis = b.addAxis2Placement3D(pt, zDir, dir);
    return b.addLocalPlacement(defaultStoreyPlacement, axis);
  }

  // -------------------------------------------------------------------------
  // 7. Process shapes
  // -------------------------------------------------------------------------
  const elementIds: number[] = [];

  // Tracking arrays for deferred relationship creation
  const materialAssociations: { elementIds: number[]; materialId: number }[] = [];
  const layerSetUsageAssociations: { elementIds: number[]; usageId: number }[] = [];
  const propertySetAssignments: { elementIds: number[]; psetId: number }[] = [];

  // Type mappings
  const wallTypeIfcMap = new Map<string, number>();
  const wallTypeElements = new Map<string, number[]>();
  for (const wt of wallTypes) {
    const wtId = b.addWallType(shapeToIfcGuid(wt.id, 'wt'), ownerHistoryId, `${wt.name} ${wt.thickness}mm`);
    wallTypeIfcMap.set(wt.id, wtId);
    wallTypeElements.set(wt.id, []);
  }

  const slabTypeIfcMap = new Map<string, number>();
  const slabTypeElements = new Map<string, number[]>();
  for (const st of slabTypes) {
    const stId = b.addSlabType(shapeToIfcGuid(st.id, 'st'), ownerHistoryId, `${st.name} ${st.thickness}mm`);
    slabTypeIfcMap.set(st.id, stId);
    slabTypeElements.set(st.id, []);
  }

  const beamTypeIfcMap = new Map<string, number>();
  const beamTypeElements = new Map<string, number[]>();

  // Gridlines (collect for IfcGrid)
  const gridlineAxes: { axis: number; curve: number; shape: GridlineShape }[] = [];
  // Track exported projectGridIds to avoid duplicating linked gridlines across plan drawings
  const exportedProjectGridIds = new Set<string>();

  // Filter out section-reference shapes
  const exportShapes = shapes.filter(s => !s.id.startsWith('section-ref-'));

  // Helper to create a property set and track for assignment
  function assignPropertySet(
    elementId: number, shapeId: string, suffix: string,
    psetName: string, description: string | null, props: number[]
  ) {
    const psetId = b.addPropertySet(
      shapeToIfcGuid(shapeId, suffix), ownerHistoryId, psetName, description, props
    );
    propertySetAssignments.push({ elementIds: [elementId], psetId });
  }

  // Build export context for extension handlers
  const exportCtx = {
    builder: b,
    ownerHistoryId,
    axisSubContext,
    bodySubContext,
    identityPlacement,
    extrusionDir,
    profilePlacement2D,
    zDir,
    xDir,
    lengthUnit,
    areaUnit,
    volumeUnit,
    defaultStoreyId,
    defaultStoreyPlacement,
    assignPropertySet,
    materials,
    createElementPlacement,
    addElementToStorey,
    resolveStoreyForShape,
    lineLength,
    lineAngle,
    shapeToIfcGuid,
    getMaterialDisplayName: getMaterialDisplayName as (key: string) => string,
    ifcLabel,
    ifcIdentifier,
    ifcBoolean,
    ifcLengthMeasure,
    ifcPositiveLengthMeasure,
    ifcAreaMeasure,
    ifcVolumeMeasure,
    wallTypes,
    slabTypes,
    pileTypes: pileTypes || [],
    wallTypeIfcMap,
    wallTypeElements,
    slabTypeIfcMap,
    slabTypeElements,
    beamTypeIfcMap,
    beamTypeElements,
    materialAssociations,
    layerSetUsageAssociations,
    propertySetAssignments,
    gridlineAxes,
    exportedProjectGridIds,
    isShapeInPlanDrawing,
    isShapeInSectionDrawing,
  };

  for (const shape of exportShapes) {
    switch (shape.type) {
      case 'line': {
        const line = shape as LineShape;
        const lineStartPt = b.addCartesianPoint(line.start.x, line.start.y, 0);
        const lineEndPt = b.addCartesianPoint(line.end.x, line.end.y, 0);
        const linePolyline = b.addPolyline([lineStartPt, lineEndPt]);

        const { annotationId } = createCurveAnnotation(ctx, shapeToIfcGuid(line.id), 'Line', null, [linePolyline], defaultStoreyPlacement);
        addElementToStorey(annotationId, resolveStoreyForShape(line));

        assignPropertySet(annotationId, line.id, 'pset', 'Open2DStudio_Annotation', 'Line annotation properties', [
          b.addPropertySingleValue('ShapeType', null, ifcLabel('line'), null),
        ]);
        break;
      }

      case 'arc': {
        const arc = shape as ArcShape;
        const arcCenter2D = b.addCartesianPoint(arc.center.x, arc.center.y, 0);
        const arcAxisPlace = b.addAxis2Placement3D(arcCenter2D, zDir, xDir);
        const arcCircle = b.addCircleGeom(arcAxisPlace, arc.radius);
        const arcTrimmed = b.addTrimmedCurve(
          arcCircle,
          `IFCPARAMETERVALUE(${stepReal(arc.startAngle)})`,
          `IFCPARAMETERVALUE(${stepReal(arc.endAngle)})`,
          true, '.PARAMETER.'
        );

        const { annotationId } = createCurveAnnotation(ctx, shapeToIfcGuid(arc.id), 'Arc', null, [arcTrimmed], defaultStoreyPlacement);
        addElementToStorey(annotationId, resolveStoreyForShape(arc));

        assignPropertySet(annotationId, arc.id, 'pset', 'Open2DStudio_Annotation', 'Arc annotation properties', [
          b.addPropertySingleValue('ShapeType', null, ifcLabel('arc'), null),
          b.addPropertySingleValue('Radius', null, ifcPositiveLengthMeasure(arc.radius), lengthUnit),
        ]);
        break;
      }

      case 'circle': {
        const circle = shape as CircleShape;
        const circleCenterPt = b.addCartesianPoint(circle.center.x, circle.center.y, 0);
        const circleAxisPlace = b.addAxis2Placement3D(circleCenterPt, zDir, xDir);
        const circleGeom = b.addCircleGeom(circleAxisPlace, circle.radius);

        const { annotationId } = createCurveAnnotation(ctx, shapeToIfcGuid(circle.id), 'Circle', null, [circleGeom], defaultStoreyPlacement);
        addElementToStorey(annotationId, resolveStoreyForShape(circle));

        assignPropertySet(annotationId, circle.id, 'pset', 'Open2DStudio_Annotation', 'Circle annotation properties', [
          b.addPropertySingleValue('ShapeType', null, ifcLabel('circle'), null),
          b.addPropertySingleValue('Radius', null, ifcPositiveLengthMeasure(circle.radius), lengthUnit),
        ]);
        break;
      }

      case 'polyline': {
        const polyline = shape as PolylineShape;
        if (polyline.points.length < 2) break;

        const polyPts: number[] = [];
        for (const pt of polyline.points) {
          polyPts.push(b.addCartesianPoint(pt.x, pt.y, 0));
        }
        if (polyline.closed && polyline.points.length > 2) {
          polyPts.push(b.addCartesianPoint(polyline.points[0].x, polyline.points[0].y, 0));
        }
        const polyGeom = b.addPolyline(polyPts);

        const { annotationId } = createCurveAnnotation(
          ctx, shapeToIfcGuid(polyline.id),
          polyline.closed ? 'Closed Polyline' : 'Polyline',
          null, [polyGeom], defaultStoreyPlacement
        );
        addElementToStorey(annotationId, resolveStoreyForShape(polyline));

        assignPropertySet(annotationId, polyline.id, 'pset', 'Open2DStudio_Annotation', 'Polyline annotation properties', [
          b.addPropertySingleValue('ShapeType', null, ifcLabel('polyline'), null),
          b.addPropertySingleValue('Closed', null, ifcBoolean(polyline.closed), null),
          b.addPropertySingleValue('VertexCount', null, ifcLabel(String(polyline.points.length)), null),
        ]);
        break;
      }

      case 'rectangle': {
        const rect = shape as RectangleShape;
        const cosR = Math.cos(rect.rotation);
        const sinR = Math.sin(rect.rotation);
        const tl = rect.topLeft;

        const corners = [
          { x: tl.x, y: tl.y },
          { x: tl.x + rect.width * cosR, y: tl.y + rect.width * sinR },
          { x: tl.x + rect.width * cosR - rect.height * sinR, y: tl.y + rect.width * sinR + rect.height * cosR },
          { x: tl.x - rect.height * sinR, y: tl.y + rect.height * cosR },
        ];
        const rectPts: number[] = [];
        for (const c of corners) {
          rectPts.push(b.addCartesianPoint(c.x, c.y, 0));
        }
        rectPts.push(b.addCartesianPoint(corners[0].x, corners[0].y, 0));
        const rectPolyline = b.addPolyline(rectPts);

        const { annotationId } = createCurveAnnotation(ctx, shapeToIfcGuid(rect.id), 'Rectangle', null, [rectPolyline], defaultStoreyPlacement);
        addElementToStorey(annotationId, resolveStoreyForShape(rect));

        assignPropertySet(annotationId, rect.id, 'pset', 'Open2DStudio_Annotation', 'Rectangle annotation properties', [
          b.addPropertySingleValue('ShapeType', null, ifcLabel('rectangle'), null),
          b.addPropertySingleValue('Width', null, ifcPositiveLengthMeasure(rect.width), lengthUnit),
          b.addPropertySingleValue('Height', null, ifcPositiveLengthMeasure(rect.height), lengthUnit),
        ]);
        break;
      }

      case 'dimension': {
        const dim = shape as DimensionShape;
        if (dim.points.length < 2) break;

        const dimPts: number[] = [];
        for (const pt of dim.points) {
          dimPts.push(b.addCartesianPoint(pt.x, pt.y, 0));
        }
        const dimPolyline = b.addPolyline(dimPts);

        const { annotationId } = createCurveAnnotation(
          ctx, shapeToIfcGuid(dim.id),
          `Dimension: ${dim.value}`, `${dim.dimensionType} dimension`,
          [dimPolyline], defaultStoreyPlacement
        );
        addElementToStorey(annotationId, resolveStoreyForShape(dim));

        const dimProps: number[] = [
          b.addPropertySingleValue('ShapeType', null, ifcLabel('dimension'), null),
          b.addPropertySingleValue('DimensionType', null, ifcLabel(dim.dimensionType), null),
          b.addPropertySingleValue('Value', null, ifcLabel(dim.value), null),
        ];
        if (dim.prefix) {
          dimProps.push(b.addPropertySingleValue('Prefix', null, ifcLabel(dim.prefix), null));
        }
        if (dim.suffix) {
          dimProps.push(b.addPropertySingleValue('Suffix', null, ifcLabel(dim.suffix), null));
        }
        assignPropertySet(annotationId, dim.id, 'pset', 'Open2DStudio_Annotation', 'Dimension annotation properties', dimProps);
        break;
      }

      case 'text': {
        const text = shape as TextShape;
        const textPt = b.addCartesianPoint(text.position.x, text.position.y, 0);
        const textPolyline = b.addPolyline([textPt, textPt]);

        const { annotationId } = createCurveAnnotation(
          ctx, shapeToIfcGuid(text.id),
          text.text.substring(0, 50) || 'Text', 'Text annotation',
          [textPolyline], defaultStoreyPlacement
        );
        addElementToStorey(annotationId, resolveStoreyForShape(text));

        assignPropertySet(annotationId, text.id, 'pset', 'Open2DStudio_Annotation', 'Text annotation properties', [
          b.addPropertySingleValue('ShapeType', null, ifcLabel('text'), null),
          b.addPropertySingleValue('Content', null, ifcLabel(text.text), null),
          b.addPropertySingleValue('FontSize', null, ifcPositiveLengthMeasure(text.fontSize), lengthUnit),
          b.addPropertySingleValue('FontFamily', null, ifcLabel(text.fontFamily), null),
        ]);
        break;
      }

      default: {
        const extExporter = ifcExportRegistry.get(shape.type);
        if (extExporter) {
          extExporter(shape, exportCtx);
        }
        break;
      }
    }
  }

  // -------------------------------------------------------------------------
  // 8. Create IfcGrid for gridlines (if any)
  // -------------------------------------------------------------------------
  if (gridlineAxes.length > 0) {
    const uAxes: number[] = [];
    const vAxes: number[] = [];

    for (const { axis, shape } of gridlineAxes) {
      const dx = Math.abs(shape.end.x - shape.start.x);
      const dy = Math.abs(shape.end.y - shape.start.y);
      if (dx >= dy) {
        uAxes.push(axis);
      } else {
        vAxes.push(axis);
      }
    }

    if (uAxes.length === 0) uAxes.push(vAxes.shift()!);
    if (vAxes.length === 0) vAxes.push(uAxes[uAxes.length - 1]);

    const gridPlacePt = b.addCartesianPoint(0, 0, 0);
    const gridAxisPlace = b.addAxis2Placement3D(gridPlacePt, zDir, xDir);
    const gridPlacement = b.addLocalPlacement(defaultStoreyPlacement, gridAxisPlace);

    const gridCurveIds = gridlineAxes.map(({ curve }) => curve);
    const gridCurveSet = b.addGeometricCurveSet(gridCurveIds);
    const gridFootprintRep = b.addShapeRepresentation(axisSubContext, 'FootPrint', 'GeometricCurveSet', [gridCurveSet]);
    const gridProdShape = b.addProductDefinitionShape(null, null, [gridFootprintRep]);

    const hasPlanGridlines = gridlineAxes.some(({ shape }) => isShapeInPlanDrawing(shape));
    const gridName = hasPlanGridlines ? 'Structural Grid' : 'Grid';

    const gridId = b.addGrid(
      generateIfcGuid(), ownerHistoryId, gridName,
      gridPlacement, gridProdShape, uAxes, vAxes
    );

    const firstGridlineShape = gridlineAxes[0]?.shape;
    if (firstGridlineShape) {
      addElementToStorey(gridId, resolveStoreyForShape(firstGridlineShape));
    } else {
      addElementToStorey(gridId, defaultStoreyId);
    }

    if (hasPlanGridlines) {
      const gridPset = b.addPropertySet(
        generateIfcGuid(), ownerHistoryId, 'Open2DStudio_GridSystem', 'Grid system from Plan drawing', [
          b.addPropertySingleValue('GridType', null, ifcLabel('IfcGrid'), null),
          b.addPropertySingleValue('Source', null, ifcLabel('Plan Drawing'), null),
        ]
      );
      propertySetAssignments.push({ elementIds: [gridId], psetId: gridPset });
    }
  }

  // -------------------------------------------------------------------------
  // 9. Spatial containment
  // -------------------------------------------------------------------------
  for (const [storeyId, elems] of storeyElementsMap) {
    if (elems.length > 0) {
      b.addRelContainedInSpatialStructure(
        generateIfcGuid(), ownerHistoryId,
        storeyId === defaultStoreyId ? 'DefaultStoreyElements' : 'StoreyElements',
        elems, storeyId
      );
    }
  }
  if (elementIds.length > 0) {
    const allMappedElements = new Set<number>();
    for (const elems of storeyElementsMap.values()) {
      for (const e of elems) allMappedElements.add(e);
    }
    const unmappedElements = elementIds.filter(id => !allMappedElements.has(id));
    if (unmappedElements.length > 0) {
      b.addRelContainedInSpatialStructure(
        generateIfcGuid(), ownerHistoryId,
        'DefaultStoreyElements', unmappedElements, defaultStoreyId
      );
    }
  }

  // -------------------------------------------------------------------------
  // 10. Type assignments
  // -------------------------------------------------------------------------
  for (const [typeId, elems] of wallTypeElements) {
    if (elems.length > 0) {
      const ifcTypeId = wallTypeIfcMap.get(typeId);
      if (ifcTypeId !== undefined) {
        b.addRelDefinesByType(generateIfcGuid(), ownerHistoryId, null, elems, ifcTypeId);
      }
    }
  }
  for (const [typeId, elems] of slabTypeElements) {
    if (elems.length > 0) {
      const ifcTypeId = slabTypeIfcMap.get(typeId);
      if (ifcTypeId !== undefined) {
        b.addRelDefinesByType(generateIfcGuid(), ownerHistoryId, null, elems, ifcTypeId);
      }
    }
  }
  for (const [typeKey, elems] of beamTypeElements) {
    if (elems.length > 0) {
      const ifcTypeId = beamTypeIfcMap.get(typeKey);
      if (ifcTypeId !== undefined) {
        b.addRelDefinesByType(generateIfcGuid(), ownerHistoryId, null, elems, ifcTypeId);
      }
    }
  }

  // -------------------------------------------------------------------------
  // 11. Material associations
  // -------------------------------------------------------------------------
  const matGrouped = new Map<number, number[]>();
  for (const assoc of materialAssociations) {
    for (const elemId of assoc.elementIds) {
      const existing = matGrouped.get(assoc.materialId) || [];
      existing.push(elemId);
      matGrouped.set(assoc.materialId, existing);
    }
  }
  for (const [matId, elemIds] of matGrouped) {
    b.addRelAssociatesMaterial(generateIfcGuid(), ownerHistoryId, 'MaterialAssociation', elemIds, matId);
  }
  for (const assoc of layerSetUsageAssociations) {
    b.addRelAssociatesMaterial(generateIfcGuid(), ownerHistoryId, 'MaterialLayerSetUsage', assoc.elementIds, assoc.usageId);
  }

  // -------------------------------------------------------------------------
  // 12. Property set assignments
  // -------------------------------------------------------------------------
  for (const assoc of propertySetAssignments) {
    b.addRelDefinesByProperties(generateIfcGuid(), ownerHistoryId, null, assoc.elementIds, assoc.psetId);
  }

  // -------------------------------------------------------------------------
  // 13. Build STEP file
  // -------------------------------------------------------------------------
  const content = assembleStepFile(b);
  const entityCount = b.getEntityCount();

  return {
    content,
    entityCount,
    fileSize: new Blob([content]).size,
  };
}
