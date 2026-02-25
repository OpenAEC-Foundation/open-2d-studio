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
  WallShape,
  BeamShape,
  SlabShape,
  GridlineShape,
  LevelShape,
  PileShape,
  CPTShape,
  WallType,
  SlabType,
  PileTypeDefinition,
  Point,
  MaterialCategory,
  LineShape,
  ArcShape,
  CircleShape,
  PolylineShape,
  RectangleShape,
  TextShape,
  SectionCalloutShape,
  SpaceShape,
  PuntniveauShape,
} from '../../types/geometry';
import type { DimensionShape } from '../../types/dimension';
import type { ProjectStructure } from '../../state/slices/parametricSlice';

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

  function resolveStoreyForShape(shape: Shape): number {
    const drawing = drawingMap.get(shape.drawingId);
    if (drawing?.drawingType === 'plan' && drawing.storeyId) {
      for (const psBuilding of psBuildings) {
        const psStorey = psBuilding.storeys.find(s => s.id === drawing.storeyId);
        if (psStorey) {
          const buildingInfo = buildingInfoMap.get(psBuilding.id);
          if (buildingInfo) {
            const storeyIndex = psBuilding.storeys.indexOf(psStorey);
            if (storeyIndex >= 0 && storeyIndex < buildingInfo.storeyIds.length) {
              return buildingInfo.storeyIds[storeyIndex];
            }
          }
        }
      }
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

  for (const shape of exportShapes) {
    switch (shape.type) {
      case 'wall': {
        const wall = shape as WallShape;
        const length = lineLength(wall.start, wall.end);
        if (length < 0.001) continue;
        const angle = lineAngle(wall.start, wall.end);
        const wallHeight = 3000;

        // Axis representation (centerline)
        const axisStartPt = b.addCartesianPoint(0, 0, 0);
        const axisEndPt = b.addCartesianPoint(length, 0, 0);
        const axisPolyline = b.addPolyline([axisStartPt, axisEndPt]);
        const axisShapeRep = b.addShapeRepresentation(axisSubContext, 'Axis', 'Curve2D', [axisPolyline]);

        // Body representation
        const wallProfileCenter = b.addCartesianPoint2D(length / 2, 0);
        const wallProfilePlacement = b.addAxis2Placement2D(wallProfileCenter);
        const wallProfile = b.addRectangleProfileDef('.AREA.', null, wallProfilePlacement, length, wall.thickness);
        const wallSolid = b.addExtrudedAreaSolid(wallProfile, identityPlacement, extrusionDir, wallHeight);
        const bodyShapeRep = b.addShapeRepresentation(bodySubContext, 'Body', 'SweptSolid', [wallSolid]);
        const wallProdShape = b.addProductDefinitionShape(null, null, [axisShapeRep, bodyShapeRep]);

        const placement = createElementPlacement(wall.start.x, wall.start.y, 0, angle);
        const wallEntityId = b.addWall(shapeToIfcGuid(wall.id), ownerHistoryId, wall.label || 'Wall', placement, wallProdShape);
        addElementToStorey(wallEntityId, resolveStoreyForShape(wall));

        if (wall.wallTypeId && wallTypeElements.has(wall.wallTypeId)) {
          wallTypeElements.get(wall.wallTypeId)!.push(wallEntityId);
        }

        // Material Layer Set Usage
        const wallType = wall.wallTypeId ? wallTypes.find(wt => wt.id === wall.wallTypeId) : undefined;
        const wallMaterialKey: MaterialCategory = wallType?.material || 'concrete';
        const wallMatId = materials.getOrCreate(wallMaterialKey);
        const wallLayer = b.addMaterialLayer(wallMatId, wall.thickness, null, 'Wall Layer');
        const wallLayerSet = b.addMaterialLayerSet([wallLayer], `${wall.label || 'Wall'} LayerSet`);
        const wallOffset = wall.justification === 'center' ? -wall.thickness / 2
          : wall.justification === 'left' ? -wall.thickness : 0;
        const wallLayerSetUsage = b.addMaterialLayerSetUsage(wallLayerSet, 'AXIS2', 'POSITIVE', wallOffset);
        layerSetUsageAssociations.push({ elementIds: [wallEntityId], usageId: wallLayerSetUsage });

        // Pset_WallCommon
        assignPropertySet(wallEntityId, wall.id, 'pset', 'Pset_WallCommon', 'Common wall properties', [
          b.addPropertySingleValue('Reference', null, ifcIdentifier(wall.label || 'Wall'), null),
          b.addPropertySingleValue('IsExternal', null, ifcBoolean(true), null),
          b.addPropertySingleValue('LoadBearing', null, ifcBoolean(true), null),
          b.addPropertySingleValue('ExtendToStructure', null, ifcBoolean(false), null),
        ]);

        // Qto_WallBaseQuantities
        assignPropertySet(wallEntityId, wall.id, 'qto', 'Qto_WallBaseQuantities', 'Wall base quantities', [
          b.addPropertySingleValue('Length', null, ifcLengthMeasure(length), lengthUnit),
          b.addPropertySingleValue('Width', null, ifcPositiveLengthMeasure(wall.thickness), lengthUnit),
          b.addPropertySingleValue('Height', null, ifcPositiveLengthMeasure(wallHeight), lengthUnit),
          b.addPropertySingleValue('GrossVolume', null, ifcVolumeMeasure(length * wall.thickness * wallHeight / 1e9), volumeUnit),
          b.addPropertySingleValue('GrossSideArea', null, ifcAreaMeasure(length * wallHeight / 1e6), areaUnit),
        ]);
        break;
      }

      case 'beam': {
        const beam = shape as BeamShape;
        const length = lineLength(beam.start, beam.end);
        if (length < 0.001) continue;
        const angle = lineAngle(beam.start, beam.end);

        const flangeWidth = beam.flangeWidth || 200;
        const depth = (beam.profileParameters?.depth as number) || (beam.profileParameters?.h as number) || flangeWidth;

        // Axis representation
        const beamAxisStart = b.addCartesianPoint(0, 0, 0);
        const beamAxisEnd = b.addCartesianPoint(0, 0, length);
        const beamAxisPolyline = b.addPolyline([beamAxisStart, beamAxisEnd]);
        const beamAxisRep = b.addShapeRepresentation(axisSubContext, 'Axis', 'Curve2D', [beamAxisPolyline]);

        // Body representation
        const beamProfile = b.addRectangleProfileDef('.AREA.', null, profilePlacement2D, flangeWidth, depth);
        const beamSolid = b.addExtrudedAreaSolid(beamProfile, identityPlacement, extrusionDir, length);
        const beamBodyRep = b.addShapeRepresentation(bodySubContext, 'Body', 'SweptSolid', [beamSolid]);
        const beamProdShape = b.addProductDefinitionShape(null, null, [beamAxisRep, beamBodyRep]);

        const placement = createElementPlacement(beam.start.x, beam.start.y, 0, angle);
        const beamName = beam.labelText || beam.presetName || 'Beam';
        const isColumn = beam.viewMode === 'section';

        const beamEntityId = isColumn
          ? b.addColumn(shapeToIfcGuid(beam.id), ownerHistoryId, beamName, placement, beamProdShape)
          : b.addBeam(shapeToIfcGuid(beam.id), ownerHistoryId, beamName, placement, beamProdShape);
        addElementToStorey(beamEntityId, resolveStoreyForShape(beam));

        // Track beam type
        const typeKey = beam.presetId || beam.profileType || 'default-beam';
        if (!beamTypeIfcMap.has(typeKey)) {
          const btId = b.addBeamType(
            shapeToIfcGuid(typeKey, 'bt'), ownerHistoryId,
            beam.presetName || beam.profileType || 'Beam'
          );
          beamTypeIfcMap.set(typeKey, btId);
          beamTypeElements.set(typeKey, []);
        }
        beamTypeElements.get(typeKey)!.push(beamEntityId);

        // Material
        const beamMatId = materials.getOrCreate(beam.material);
        materialAssociations.push({ elementIds: [beamEntityId], materialId: beamMatId });

        // Pset_BeamCommon / Pset_ColumnCommon
        assignPropertySet(beamEntityId, beam.id, 'pset',
          isColumn ? 'Pset_ColumnCommon' : 'Pset_BeamCommon',
          isColumn ? 'Common column properties' : 'Common beam properties', [
            b.addPropertySingleValue('Reference', null, ifcIdentifier(beamName), null),
            b.addPropertySingleValue('IsExternal', null, ifcBoolean(false), null),
            b.addPropertySingleValue('LoadBearing', null, ifcBoolean(true), null),
            b.addPropertySingleValue('Span', null, ifcPositiveLengthMeasure(length), lengthUnit),
          ]);

        // Open2DStudio_BeamDimensions
        const beamDimProps: number[] = [
          b.addPropertySingleValue('ProfileType', null, ifcLabel(beam.profileType), null),
          b.addPropertySingleValue('FlangeWidth', null, ifcPositiveLengthMeasure(flangeWidth), lengthUnit),
          b.addPropertySingleValue('Depth', null, ifcPositiveLengthMeasure(depth), lengthUnit),
          b.addPropertySingleValue('Material', null, ifcLabel(getMaterialDisplayName(beam.material)), null),
        ];
        if (beam.presetName) {
          beamDimProps.push(b.addPropertySingleValue('PresetName', null, ifcLabel(beam.presetName), null));
        }
        assignPropertySet(beamEntityId, beam.id, 'dims', 'Open2DStudio_BeamDimensions', 'Beam profile dimensions from Open 2D Studio', beamDimProps);
        break;
      }

      case 'slab': {
        const slab = shape as SlabShape;
        if (slab.points.length < 3) continue;

        const polylinePts: number[] = [];
        for (const pt of slab.points) {
          polylinePts.push(b.addCartesianPoint2D(pt.x, pt.y));
        }
        polylinePts.push(b.addCartesianPoint2D(slab.points[0].x, slab.points[0].y));

        const polyline = b.addPolyline(polylinePts);
        const slabProfile = b.addArbitraryClosedProfileDef('.AREA.', null, polyline);

        const thickness = slab.thickness || 200;
        const slabSolid = b.addExtrudedAreaSolid(slabProfile, identityPlacement, extrusionDir, thickness);
        const slabShapeRep = b.addShapeRepresentation(bodySubContext, 'Body', 'SweptSolid', [slabSolid]);
        const slabProdShape = b.addProductDefinitionShape(null, null, [slabShapeRep]);

        const elevation = slab.elevation || 0;
        const slabPlacePt = b.addCartesianPoint(0, 0, elevation);
        const slabAxisPlace = b.addAxis2Placement3D(slabPlacePt, zDir, xDir);
        const slabPlacement = b.addLocalPlacement(defaultStoreyPlacement, slabAxisPlace);

        const slabEntityId = b.addSlab(
          shapeToIfcGuid(slab.id), ownerHistoryId, slab.label || 'Slab',
          slabPlacement, slabProdShape
        );
        addElementToStorey(slabEntityId, resolveStoreyForShape(slab));

        const matchingSlabType = slabTypes.find(
          st => st.thickness === slab.thickness && st.material === slab.material
        );
        if (matchingSlabType && slabTypeElements.has(matchingSlabType.id)) {
          slabTypeElements.get(matchingSlabType.id)!.push(slabEntityId);
        }

        // Material Layer Set Usage
        const slabMatId = materials.getOrCreate(slab.material);
        const slabLayer = b.addMaterialLayer(slabMatId, thickness, null, 'Slab Layer');
        const slabLayerSet = b.addMaterialLayerSet([slabLayer], `${slab.label || 'Slab'} LayerSet`);
        const slabLayerSetUsage = b.addMaterialLayerSetUsage(slabLayerSet, 'AXIS3', 'POSITIVE', 0);
        layerSetUsageAssociations.push({ elementIds: [slabEntityId], usageId: slabLayerSetUsage });

        // Pset_SlabCommon
        assignPropertySet(slabEntityId, slab.id, 'pset', 'Pset_SlabCommon', 'Common slab properties', [
          b.addPropertySingleValue('Reference', null, ifcIdentifier(slab.label || 'Slab'), null),
          b.addPropertySingleValue('IsExternal', null, ifcBoolean(false), null),
          b.addPropertySingleValue('LoadBearing', null, ifcBoolean(true), null),
        ]);

        // Qto_SlabBaseQuantities (Shoelace formula for area)
        let slabArea = 0;
        const pts = slab.points;
        for (let i = 0; i < pts.length; i++) {
          const j = (i + 1) % pts.length;
          slabArea += pts[i].x * pts[j].y;
          slabArea -= pts[j].x * pts[i].y;
        }
        slabArea = Math.abs(slabArea) / 2;

        assignPropertySet(slabEntityId, slab.id, 'qto', 'Qto_SlabBaseQuantities', 'Slab base quantities', [
          b.addPropertySingleValue('Depth', null, ifcPositiveLengthMeasure(thickness), lengthUnit),
          b.addPropertySingleValue('GrossArea', null, ifcAreaMeasure(slabArea / 1e6), areaUnit),
          b.addPropertySingleValue('GrossVolume', null, ifcVolumeMeasure(slabArea * thickness / 1e9), volumeUnit),
        ]);
        break;
      }

      case 'pile': {
        const pile = shape as PileShape;

        // Only export piles from plan drawings (skip section-drawing representations
        // to prevent the same physical pile from appearing at every level/storey)
        if (!isShapeInPlanDrawing(pile)) break;

        // Resolve pile type definition (if referenced)
        const pileTypeDef = pile.pileTypeId && pileTypes
          ? pileTypes.find(pt => pt.id === pile.pileTypeId)
          : undefined;

        // Determine cross-section shape from type definition
        const isSquare = pileTypeDef?.shape === 'square';

        // Build profile based on shape
        const pileProfileId = isSquare
          ? b.addRectangleProfileDef('.AREA.', null, profilePlacement2D, pile.diameter, pile.diameter)
          : b.addCircleProfileDef('.AREA.', null, profilePlacement2D, pile.diameter / 2);
        const pileLength = 10000;
        const pileSolid = b.addExtrudedAreaSolid(pileProfileId, identityPlacement, extrusionDir, pileLength);
        const pileShapeRep = b.addShapeRepresentation(bodySubContext, 'Body', 'SweptSolid', [pileSolid]);
        const pileProdShape = b.addProductDefinitionShape(null, null, [pileShapeRep]);

        const pilePlacePt = b.addCartesianPoint(pile.position.x, pile.position.y, 0);
        const pileAxisPlace = b.addAxis2Placement3D(pilePlacePt, zDir, xDir);
        const pilePlacement = b.addLocalPlacement(defaultStoreyPlacement, pileAxisPlace);

        const pileEntityId = b.addPile(
          shapeToIfcGuid(pile.id), ownerHistoryId, pile.label || 'Pile',
          pilePlacement, pileProdShape
        );
        // Piles are foundation elements — always assign to the default (ground/foundation)
        // storey rather than the drawing's linked storey, so they appear only once in the
        // spatial tree instead of being duplicated at every building level.
        addElementToStorey(pileEntityId, defaultStoreyId);

        // Material: determine from pile type method
        const pileMaterial = pileTypeDef?.method === 'Stalen buispaal' ? 'steel'
          : pileTypeDef?.method === 'Hout' ? 'timber'
          : 'concrete';
        const pileMatId = materials.getOrCreate(pileMaterial as MaterialCategory);
        materialAssociations.push({ elementIds: [pileEntityId], materialId: pileMatId });

        // Pset_PileCommon (IFC4 standard property set with English property names)
        const psetPileCommonProps = [
          b.addPropertySingleValue('Reference', null, ifcIdentifier(pile.label || 'Pile'), null),
          b.addPropertySingleValue('Status', null, ifcLabel('New'), null),
          b.addPropertySingleValue('Diameter', null, ifcPositiveLengthMeasure(pile.diameter), lengthUnit),
          b.addPropertySingleValue('Length', null, ifcPositiveLengthMeasure(pileLength), lengthUnit),
        ];
        if (pile.puntniveauNAP != null) {
          // DesignParameters captures the designed tip level (puntniveau) relative to NAP
          psetPileCommonProps.push(b.addPropertySingleValue('DesignParameters', null, ifcLabel(`TipLevel=${pile.puntniveauNAP}m NAP`), null));
        }
        if (pile.bkPaalPeil != null) {
          // LoadCapacity slot used for cutoff level (top of pile) relative to reference datum
          psetPileCommonProps.push(b.addPropertySingleValue('CutoffLevel', null, ifcLengthMeasure(pile.bkPaalPeil), lengthUnit));
        }
        assignPropertySet(pileEntityId, pile.id, 'pset', 'Pset_PileCommon', 'Common pile properties', psetPileCommonProps);

        // Open2DStudio_PileType - pile type information from PileTypeDefinition
        if (pileTypeDef) {
          assignPropertySet(pileEntityId, pile.id, 'ptpset', 'Open2DStudio_PileType', 'Pile type properties from Open 2D Studio', [
            b.addPropertySingleValue('PileTypeName', null, ifcLabel(pileTypeDef.name), null),
            b.addPropertySingleValue('CrossSectionShape', null, ifcLabel(pileTypeDef.shape), null),
            b.addPropertySingleValue('ConstructionMethod', null, ifcLabel(pileTypeDef.method), null),
            b.addPropertySingleValue('PredefinedType', null, ifcLabel(pileTypeDef.ifcPredefinedType), null),
          ]);
        }

        // Open2DStudio_PileElevations - Dutch geotechnical elevation data preserved for domain users
        const pileElevProps: number[] = [];
        if (pile.puntniveauNAP != null) {
          pileElevProps.push(b.addPropertySingleValue('TipLevelNAP', null, ifcLengthMeasure(pile.puntniveauNAP * 1000), lengthUnit));
        }
        if (pile.bkPaalPeil != null) {
          pileElevProps.push(b.addPropertySingleValue('CutoffLevel', null, ifcLengthMeasure(pile.bkPaalPeil), lengthUnit));
        }
        if (pile.cutoffLevel != null) {
          pileElevProps.push(b.addPropertySingleValue('CutoffLevelNAP', null, ifcLengthMeasure(pile.cutoffLevel * 1000), lengthUnit));
        }
        if (pile.tipLevel != null) {
          pileElevProps.push(b.addPropertySingleValue('ActualTipLevelNAP', null, ifcLengthMeasure(pile.tipLevel * 1000), lengthUnit));
        }
        if (pileElevProps.length > 0) {
          assignPropertySet(pileEntityId, pile.id, 'elevpset', 'Open2DStudio_PileElevations', 'Pile elevation data from Open 2D Studio', pileElevProps);
        }

        // Open2DStudio_PileDimensions
        const pileArea = isSquare
          ? pile.diameter * pile.diameter
          : Math.PI * (pile.diameter / 2) * (pile.diameter / 2);
        assignPropertySet(pileEntityId, pile.id, 'dims', 'Open2DStudio_PileDimensions', 'Pile dimensions from Open 2D Studio', [
          b.addPropertySingleValue('Diameter', null, ifcPositiveLengthMeasure(pile.diameter), lengthUnit),
          b.addPropertySingleValue('Length', null, ifcPositiveLengthMeasure(pileLength), lengthUnit),
          b.addPropertySingleValue('CrossSectionalArea', null, ifcAreaMeasure(pileArea / 1e6), areaUnit),
        ]);
        break;
      }

      case 'cpt': {
        const cpt = shape as CPTShape;

        // CPT probe dimensions
        // Standard CPT cone diameter is 35.7mm (10 cm² cross-section), we use 36mm
        const cptDiameter = 36;  // mm
        const cptRadius = cptDiameter / 2;
        const cptDepth = cpt.depth ?? 30000;  // Default 30m probe depth (in mm)

        // Cone tip: 60° apex angle, height = radius / tan(30°) ≈ radius * 1.732
        const coneHeight = Math.min(cptRadius * 1.732, 100);  // ~31mm cone tip

        // 3D Body: extruded cylinder (rod) from ground level downward
        // The extrusion goes along negative Z (into the ground)
        const cptProfile = b.addCircleProfileDef('.AREA.', null, profilePlacement2D, cptRadius);
        const downDir = b.addDirection(0, 0, -1);
        const cptRodSolid = b.addExtrudedAreaSolid(cptProfile, identityPlacement, downDir, cptDepth);

        // Body shape representation
        const cptBodyRep = b.addShapeRepresentation(bodySubContext, 'Body', 'SweptSolid', [cptRodSolid]);
        const cptProdShape = b.addProductDefinitionShape(null, null, [cptBodyRep]);

        // Placement at CPT position (at ground level, probe goes down)
        const cptPlacePt = b.addCartesianPoint(cpt.position.x, cpt.position.y, 0);
        const cptAxisPlace = b.addAxis2Placement3D(cptPlacePt, zDir, xDir);
        const cptPlacement = b.addLocalPlacement(defaultStoreyPlacement, cptAxisPlace);

        // Create as IfcBuildingElementProxy (IfcBorehole is IFC4x3 only, not yet widely supported)
        const cptEntityId = b.addBuildingElementProxy(
          shapeToIfcGuid(cpt.id), ownerHistoryId,
          cpt.name || 'CPT', 'Cone Penetration Test (Sondering)',
          cptPlacement, cptProdShape
        );
        addElementToStorey(cptEntityId, resolveStoreyForShape(cpt));

        // Material: steel for the CPT rod
        const cptMatId = materials.getOrCreate('steel');
        materialAssociations.push({ elementIds: [cptEntityId], materialId: cptMatId });

        // Pset_BuildingElementProxyCommon - standard IFC property set
        assignPropertySet(cptEntityId, cpt.id, 'proxy-pset', 'Pset_BuildingElementProxyCommon', 'Common proxy properties', [
          b.addPropertySingleValue('Reference', null, ifcIdentifier(cpt.name || 'CPT'), null),
        ]);

        // Open2DStudio_CPT property set with geotechnical data
        const cptProps: number[] = [
          b.addPropertySingleValue('ShapeType', null, ifcLabel('cpt'), null),
          b.addPropertySingleValue('Name', null, ifcLabel(cpt.name || ''), null),
          b.addPropertySingleValue('ObjectType', null, ifcLabel('IfcBorehole'), null),
          b.addPropertySingleValue('Depth', null, ifcPositiveLengthMeasure(cptDepth), lengthUnit),
          b.addPropertySingleValue('ConeDiameter', null, ifcPositiveLengthMeasure(cptDiameter), lengthUnit),
          b.addPropertySingleValue('ConeHeight', null, ifcPositiveLengthMeasure(coneHeight), lengthUnit),
          b.addPropertySingleValue('Kleefmeting', null, ifcBoolean(cpt.kleefmeting ?? false), null),
          b.addPropertySingleValue('Waterspanning', null, ifcBoolean(cpt.waterspanning ?? false), null),
          b.addPropertySingleValue('Uitgevoerd', null, ifcBoolean(cpt.uitgevoerd ?? false), null),
        ];
        assignPropertySet(cptEntityId, cpt.id, 'pset', 'Open2DStudio_CPT', 'CPT geotechnical properties from Open 2D Studio', cptProps);
        break;
      }

      case 'gridline': {
        const gridline = shape as GridlineShape;
        if (!isShapeInPlanDrawing(gridline)) break;

        // Deduplicate project gridlines — only export the first occurrence per projectGridId
        if (gridline.projectGridId) {
          if (exportedProjectGridIds.has(gridline.projectGridId)) break;
          exportedProjectGridIds.add(gridline.projectGridId);
        }

        const startPt = b.addCartesianPoint(gridline.start.x, gridline.start.y, 0);
        const endPt = b.addCartesianPoint(gridline.end.x, gridline.end.y, 0);
        const axisCurve = b.addPolyline([startPt, endPt]);
        const axisId = b.addGridAxis(gridline.label, axisCurve, true);
        gridlineAxes.push({ axis: axisId, curve: axisCurve, shape: gridline });
        break;
      }

      case 'level': {
        const level = shape as LevelShape;
        if (!isShapeInPlanDrawing(level)) break;

        const levelAnnotPt = b.addCartesianPoint(level.start.x, level.start.y, 0);
        const levelAnnotAxis = b.addAxis2Placement3D(levelAnnotPt, zDir, xDir);
        const levelAnnotPlacement = b.addLocalPlacement(defaultStoreyPlacement, levelAnnotAxis);

        const lvlStartPt = b.addCartesianPoint(level.start.x, level.start.y, 0);
        const lvlEndPt = b.addCartesianPoint(level.end.x, level.end.y, 0);
        const lvlPolyline = b.addPolyline([lvlStartPt, lvlEndPt]);
        const lvlShapeRep = b.addShapeRepresentation(axisSubContext, 'Annotation', 'Curve2D', [lvlPolyline]);
        const lvlProdShape = b.addProductDefinitionShape(null, null, [lvlShapeRep]);

        const lvlAnnotId = b.addAnnotation(
          shapeToIfcGuid(level.id, 'annot'), ownerHistoryId,
          level.label || `Level ${level.elevation}`,
          `Elevation: ${level.elevation}mm`,
          levelAnnotPlacement, lvlProdShape
        );
        addElementToStorey(lvlAnnotId, resolveStoreyForShape(level));

        const lvlAnnotProps: number[] = [
          b.addPropertySingleValue('ShapeType', null, ifcLabel('level'), null),
          b.addPropertySingleValue('Elevation', null, ifcLengthMeasure(level.elevation), lengthUnit),
          b.addPropertySingleValue('Label', null, ifcLabel(level.label || ''), null),
        ];
        if (level.description) {
          lvlAnnotProps.push(b.addPropertySingleValue('Description', null, ifcLabel(level.description), null));
        }
        assignPropertySet(lvlAnnotId, level.id, 'annot-pset', 'Open2DStudio_Annotation', 'Level annotation properties', lvlAnnotProps);
        break;
      }

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

      case 'puntniveau': {
        const pnv = shape as PuntniveauShape;
        if (pnv.points.length < 3) break;

        // Build 2D profile from polygon boundary points
        const pnvProfilePts: number[] = [];
        for (const pt of pnv.points) {
          pnvProfilePts.push(b.addCartesianPoint2D(pt.x, pt.y));
        }
        // Close the polygon
        pnvProfilePts.push(b.addCartesianPoint2D(pnv.points[0].x, pnv.points[0].y));
        const pnvPolyline = b.addPolyline(pnvProfilePts);
        const pnvProfile = b.addArbitraryClosedProfileDef('.AREA.', null, pnvPolyline);

        // Extrude with 10mm thickness to create a thin horizontal surface
        const pnvThickness = 10; // mm
        const pnvSolid = b.addExtrudedAreaSolid(pnvProfile, identityPlacement, extrusionDir, pnvThickness);
        const pnvBodyRep = b.addShapeRepresentation(bodySubContext, 'Body', 'SweptSolid', [pnvSolid]);
        const pnvProdShape = b.addProductDefinitionShape(null, null, [pnvBodyRep]);

        // Place at Z = puntniveauNAP elevation (convert meters to mm)
        const pnvElevationMm = pnv.puntniveauNAP * 1000;
        const pnvPlacePt = b.addCartesianPoint(0, 0, pnvElevationMm);
        const pnvAxisPlace = b.addAxis2Placement3D(pnvPlacePt, zDir, xDir);
        const pnvPlacement = b.addLocalPlacement(defaultStoreyPlacement, pnvAxisPlace);

        const pnvName = `Puntniveau ${pnv.puntniveauNAP} m NAP`;
        const pnvEntityId = b.addBuildingElementProxy(
          shapeToIfcGuid(pnv.id), ownerHistoryId, pnvName,
          'Designed pile tip level zone', pnvPlacement, pnvProdShape,
          'USERDEFINED'
        );
        addElementToStorey(pnvEntityId, resolveStoreyForShape(pnv));

        // Calculate area using Shoelace formula (points are in mm, result in mm²)
        let pnvArea = 0;
        const pnvPts = pnv.points;
        for (let i = 0; i < pnvPts.length; i++) {
          const j = (i + 1) % pnvPts.length;
          pnvArea += pnvPts[i].x * pnvPts[j].y;
          pnvArea -= pnvPts[j].x * pnvPts[i].y;
        }
        pnvArea = Math.abs(pnvArea) / 2; // mm²

        // Open2DStudio_Puntniveau property set
        assignPropertySet(pnvEntityId, pnv.id, 'pset', 'Open2DStudio_Puntniveau', 'Puntniveau properties from Open 2D Studio', [
          b.addPropertySingleValue('ShapeType', null, ifcLabel('puntniveau'), null),
          b.addPropertySingleValue('PuntniveauNAP', null, ifcLengthMeasure(pnv.puntniveauNAP * 1000), lengthUnit),
          b.addPropertySingleValue('PuntniveauNAP_m', null, ifcLabel(`${pnv.puntniveauNAP} m NAP`), null),
          b.addPropertySingleValue('Area', null, ifcAreaMeasure(pnvArea / 1e6), areaUnit),
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

      case 'section-callout': {
        const sc = shape as SectionCalloutShape;
        const scStartPt = b.addCartesianPoint(sc.start.x, sc.start.y, 0);
        const scEndPt = b.addCartesianPoint(sc.end.x, sc.end.y, 0);
        const scPolyline = b.addPolyline([scStartPt, scEndPt]);

        const { annotationId } = createCurveAnnotation(
          ctx, shapeToIfcGuid(sc.id),
          `Section ${sc.label}`, `${sc.calloutType} callout`,
          [scPolyline], defaultStoreyPlacement
        );
        addElementToStorey(annotationId, resolveStoreyForShape(sc));

        const scProps: number[] = [];
        if (isShapeInSectionDrawing(sc)) {
          scProps.push(b.addPropertySingleValue('DrawingType', null, ifcLabel('section'), null));
        }
        scProps.push(b.addPropertySingleValue('ShapeType', null, ifcLabel('section-callout'), null));
        scProps.push(b.addPropertySingleValue('CalloutType', null, ifcLabel(sc.calloutType), null));
        scProps.push(b.addPropertySingleValue('Label', null, ifcLabel(sc.label), null));
        if (sc.targetDrawingId) {
          scProps.push(b.addPropertySingleValue('TargetDrawingId', null, ifcLabel(sc.targetDrawingId), null));
        }
        assignPropertySet(annotationId, sc.id, 'pset', 'Open2DStudio_Annotation', 'Section callout annotation properties', scProps);
        break;
      }

      case 'space': {
        const space = shape as SpaceShape;
        if (!space.contourPoints || space.contourPoints.length < 3) break;

        // Build 2D polyline boundary from contour points
        const contourPtIds = space.contourPoints.map(p =>
          b.addCartesianPoint2D(p.x, p.y)
        );
        // Close the polyline by repeating first point
        contourPtIds.push(contourPtIds[0]);
        const contourPolyline = b.addPolyline(contourPtIds);

        // Footprint representation
        const spaceFootprintRep = b.addShapeRepresentation(axisSubContext, 'FootPrint', 'Curve2D', [contourPolyline]);
        const spaceProdShape = b.addProductDefinitionShape(null, null, [spaceFootprintRep]);

        const spacePlacePt = b.addCartesianPoint(0, 0, 0);
        const spaceAxisPlace = b.addAxis2Placement3D(spacePlacePt, zDir, xDir);
        const spacePlacement = b.addLocalPlacement(defaultStoreyPlacement, spaceAxisPlace);

        const spaceName = space.number
          ? `${space.number} - ${space.name}`
          : space.name;

        const spaceEntityId = b.addSpace(
          shapeToIfcGuid(space.id), ownerHistoryId, spaceName,
          null, spacePlacement, spaceProdShape,
          space.name, '.ELEMENT.', '.INTERNAL.'
        );
        addElementToStorey(spaceEntityId, resolveStoreyForShape(space));

        // Pset_SpaceCommon property set
        const spaceProps: number[] = [];
        if (space.area !== undefined) {
          spaceProps.push(b.addPropertySingleValue('GrossFloorArea', null, ifcAreaMeasure(space.area), null));
          spaceProps.push(b.addPropertySingleValue('NetFloorArea', null, ifcAreaMeasure(space.area), null));
        }
        if (space.number) {
          spaceProps.push(b.addPropertySingleValue('Reference', null, ifcIdentifier(space.number), null));
        }
        if (space.level) {
          spaceProps.push(b.addPropertySingleValue('Level', null, ifcLabel(space.level), null));
        }
        spaceProps.push(b.addPropertySingleValue('IsExternal', null, ifcBoolean(false), null));
        if (spaceProps.length > 0) {
          assignPropertySet(spaceEntityId, space.id, 'pset', 'Pset_SpaceCommon', 'Common space properties', spaceProps);
        }

        // Open2DStudio custom property set
        const ndProps: number[] = [
          b.addPropertySingleValue('ShapeType', null, ifcLabel('space'), null),
          b.addPropertySingleValue('SpaceName', null, ifcLabel(space.name), null),
        ];
        if (space.number) {
          ndProps.push(b.addPropertySingleValue('SpaceNumber', null, ifcLabel(space.number), null));
        }
        assignPropertySet(spaceEntityId, space.id, 'ndpset', 'Open2DStudio_Space', 'Space annotation properties', ndProps);
        break;
      }

      default:
        break;
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
