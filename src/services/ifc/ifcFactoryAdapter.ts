/**
 * IFC Factory Adapter
 *
 * Higher-level helpers wrapping IfcBuilder to reduce boilerplate in ifcGenerator.ts.
 * Provides project context setup, annotation creation, material caching,
 * and element placement helpers.
 */

import type { MaterialCategory, BeamMaterial, SlabMaterial } from '../../types/geometry';
import { generateIfcGuid, getMaterialDisplayName, getMaterialCategory } from './guidHelpers';

// ============================================================================
// STEP Encoding Helpers (re-exported for use by ifcGenerator)
// ============================================================================

export function stepString(s: string): string {
  return "'" + s.replace(/'/g, "''") + "'";
}

export function stepReal(n: number): string {
  if (Number.isInteger(n)) return n.toFixed(1);
  return n.toString();
}

export function stepBool(b: boolean): string {
  return b ? '.T.' : '.F.';
}

export function stepEnum(s: string): string {
  if (s.startsWith('.') && s.endsWith('.')) return s;
  return `.${s}.`;
}

export function stepRef(id: number): string {
  return `#${id}`;
}

export function stepList(refs: number[]): string {
  return '(' + refs.map(stepRef).join(',') + ')';
}

export function stepRealTuple(nums: number[]): string {
  return '(' + nums.map(stepReal).join(',') + ')';
}

// ============================================================================
// IFC Value Helpers
// ============================================================================

export function ifcLabel(s: string): string {
  return `IFCLABEL(${stepString(s)})`;
}

export function ifcBoolean(b: boolean): string {
  return `IFCBOOLEAN(${stepBool(b)})`;
}

export function ifcIdentifier(s: string): string {
  return `IFCIDENTIFIER(${stepString(s)})`;
}

export function ifcLengthMeasure(n: number): string {
  return `IFCLENGTHMEASURE(${stepReal(n)})`;
}

export function ifcPositiveLengthMeasure(n: number): string {
  return `IFCPOSITIVELENGTHMEASURE(${stepReal(n)})`;
}

export function ifcAreaMeasure(n: number): string {
  return `IFCAREAMEASURE(${stepReal(n)})`;
}

export function ifcVolumeMeasure(n: number): string {
  return `IFCVOLUMEMEASURE(${stepReal(n)})`;
}

// ============================================================================
// Entity ID Counter
// ============================================================================

class IdCounter {
  private _next = 1;
  next(): number {
    return this._next++;
  }
  current(): number {
    return this._next - 1;
  }
}

// ============================================================================
// IFC Entity Builder
// ============================================================================

interface IfcEntity {
  id: number;
  type: string;
  attrs: string;
}

export class IfcBuilder {
  private entities: IfcEntity[] = [];
  private counter = new IdCounter();

  add(type: string, attrs: string): number {
    const id = this.counter.next();
    this.entities.push({ id, type, attrs });
    return id;
  }

  // -------------------------------------------------------------------------
  // Core geometry primitives
  // -------------------------------------------------------------------------

  addCartesianPoint(x: number, y: number, z: number): number {
    return this.add('IFCCARTESIANPOINT', `(${stepRealTuple([x, y, z])})`);
  }

  addCartesianPoint2D(x: number, y: number): number {
    return this.add('IFCCARTESIANPOINT', `(${stepRealTuple([x, y])})`);
  }

  addDirection(x: number, y: number, z: number): number {
    return this.add('IFCDIRECTION', `(${stepRealTuple([x, y, z])})`);
  }

  addDirection2D(x: number, y: number): number {
    return this.add('IFCDIRECTION', `(${stepRealTuple([x, y])})`);
  }

  addAxis2Placement3D(location: number, axis?: number, refDir?: number): number {
    const axisRef = axis !== undefined ? stepRef(axis) : '$';
    const refDirRef = refDir !== undefined ? stepRef(refDir) : '$';
    return this.add('IFCAXIS2PLACEMENT3D', `(${stepRef(location)},${axisRef},${refDirRef})`);
  }

  addAxis2Placement2D(location: number, refDir?: number): number {
    const refDirRef = refDir !== undefined ? stepRef(refDir) : '$';
    return this.add('IFCAXIS2PLACEMENT2D', `(${stepRef(location)},${refDirRef})`);
  }

  addLocalPlacement(relativeTo: number | null, axis2: number): number {
    const rel = relativeTo !== null ? stepRef(relativeTo) : '$';
    return this.add('IFCLOCALPLACEMENT', `(${rel},${stepRef(axis2)})`);
  }

  addOwnerHistory(
    personOrgId: number,
    appId: number,
    changeAction: string = '.NOCHANGE.',
    creationDate: number = Math.floor(Date.now() / 1000)
  ): number {
    return this.add(
      'IFCOWNERHISTORY',
      `(${stepRef(personOrgId)},${stepRef(appId)},$,${changeAction},$,${stepRef(personOrgId)},${stepRef(appId)},${creationDate})`
    );
  }

  // -------------------------------------------------------------------------
  // Geometry representations
  // -------------------------------------------------------------------------

  addRectangleProfileDef(
    profileType: string, name: string | null, position: number,
    xDim: number, yDim: number
  ): number {
    const nameStr = name ? stepString(name) : '$';
    return this.add('IFCRECTANGLEPROFILEDEF', `(${profileType},${nameStr},${stepRef(position)},${stepReal(xDim)},${stepReal(yDim)})`);
  }

  addCircleProfileDef(
    profileType: string, name: string | null, position: number, radius: number
  ): number {
    const nameStr = name ? stepString(name) : '$';
    return this.add('IFCCIRCLEPROFILEDEF', `(${profileType},${nameStr},${stepRef(position)},${stepReal(radius)})`);
  }

  addArbitraryClosedProfileDef(
    profileType: string, name: string | null, outerCurve: number
  ): number {
    const nameStr = name ? stepString(name) : '$';
    return this.add('IFCARBITRARYCLOSEDPROFILEDEF', `(${profileType},${nameStr},${stepRef(outerCurve)})`);
  }

  addPolyline(points: number[]): number {
    return this.add('IFCPOLYLINE', `(${stepList(points)})`);
  }

  addExtrudedAreaSolid(
    profile: number, position: number, direction: number, depth: number
  ): number {
    return this.add('IFCEXTRUDEDAREASOLID', `(${stepRef(profile)},${stepRef(position)},${stepRef(direction)},${stepReal(depth)})`);
  }

  addShapeRepresentation(
    contextId: number, repIdentifier: string, repType: string, items: number[]
  ): number {
    return this.add('IFCSHAPEREPRESENTATION', `(${stepRef(contextId)},${stepString(repIdentifier)},${stepString(repType)},${stepList(items)})`);
  }

  addProductDefinitionShape(
    name: string | null, description: string | null, representations: number[]
  ): number {
    const nameStr = name ? stepString(name) : '$';
    const descStr = description ? stepString(description) : '$';
    return this.add('IFCPRODUCTDEFINITIONSHAPE', `(${nameStr},${descStr},${stepList(representations)})`);
  }

  // -------------------------------------------------------------------------
  // Units
  // -------------------------------------------------------------------------

  addSIUnit(unitType: string, prefix: string | null, name: string): number {
    const prefixStr = prefix ? `.${prefix}.` : '$';
    return this.add('IFCSIUNIT', `(*,${unitType},${prefixStr},${name})`);
  }

  addMeasureWithUnit(valueComponent: string, unitComponent: number): number {
    return this.add('IFCMEASUREWITHUNIT', `(${valueComponent},${stepRef(unitComponent)})`);
  }

  addConversionBasedUnit(
    dimensions: number, unitType: string, name: string, conversionFactor: number
  ): number {
    return this.add('IFCCONVERSIONBASEDUNIT', `(${stepRef(dimensions)},${unitType},${stepString(name)},${stepRef(conversionFactor)})`);
  }

  addDimensionalExponents(
    length: number, mass: number, time: number,
    electricCurrent: number, thermodynamicTemperature: number,
    amountOfSubstance: number, luminousIntensity: number
  ): number {
    return this.add('IFCDIMENSIONALEXPONENTS', `(${length},${mass},${time},${electricCurrent},${thermodynamicTemperature},${amountOfSubstance},${luminousIntensity})`);
  }

  addUnitAssignment(units: number[]): number {
    return this.add('IFCUNITASSIGNMENT', `(${stepList(units)})`);
  }

  // -------------------------------------------------------------------------
  // Spatial elements
  // -------------------------------------------------------------------------

  addProject(
    globalId: string, ownerHistory: number, name: string,
    units: number, repContexts: number[]
  ): number {
    return this.add('IFCPROJECT', `(${stepString(globalId)},${stepRef(ownerHistory)},${stepString(name)},$,$,$,$,${stepList(repContexts)},${stepRef(units)})`);
  }

  addSite(globalId: string, ownerHistory: number, name: string, placement: number): number {
    return this.add('IFCSITE', `(${stepString(globalId)},${stepRef(ownerHistory)},${stepString(name)},$,$,${stepRef(placement)},$,$,.ELEMENT.,$,$,$,$,$)`);
  }

  addBuilding(globalId: string, ownerHistory: number, name: string, placement: number): number {
    return this.add('IFCBUILDING', `(${stepString(globalId)},${stepRef(ownerHistory)},${stepString(name)},$,$,${stepRef(placement)},$,$,.ELEMENT.,$,$,$)`);
  }

  addBuildingStorey(
    globalId: string, ownerHistory: number, name: string,
    placement: number, elevation: number
  ): number {
    return this.add('IFCBUILDINGSTOREY', `(${stepString(globalId)},${stepRef(ownerHistory)},${stepString(name)},$,$,${stepRef(placement)},$,$,.ELEMENT.,${stepReal(elevation)})`);
  }

  addRelAggregates(
    globalId: string, ownerHistory: number, name: string | null,
    relating: number, related: number[]
  ): number {
    const nameStr = name ? stepString(name) : '$';
    return this.add('IFCRELAGGREGATES', `(${stepString(globalId)},${stepRef(ownerHistory)},${nameStr},$,${stepRef(relating)},${stepList(related)})`);
  }

  addRelContainedInSpatialStructure(
    globalId: string, ownerHistory: number, name: string | null,
    elements: number[], structure: number
  ): number {
    const nameStr = name ? stepString(name) : '$';
    return this.add('IFCRELCONTAINEDINSPATIALSTRUCTURE', `(${stepString(globalId)},${stepRef(ownerHistory)},${nameStr},$,${stepList(elements)},${stepRef(structure)})`);
  }

  // -------------------------------------------------------------------------
  // Building elements
  // -------------------------------------------------------------------------

  addWall(globalId: string, ownerHistory: number, name: string, placement: number, representation: number): number {
    return this.add('IFCWALL', `(${stepString(globalId)},${stepRef(ownerHistory)},${stepString(name)},$,$,${stepRef(placement)},${stepRef(representation)},$,$)`);
  }

  addBeam(globalId: string, ownerHistory: number, name: string, placement: number, representation: number): number {
    return this.add('IFCBEAM', `(${stepString(globalId)},${stepRef(ownerHistory)},${stepString(name)},$,$,${stepRef(placement)},${stepRef(representation)},$,$)`);
  }

  addColumn(globalId: string, ownerHistory: number, name: string, placement: number, representation: number): number {
    return this.add('IFCCOLUMN', `(${stepString(globalId)},${stepRef(ownerHistory)},${stepString(name)},$,$,${stepRef(placement)},${stepRef(representation)},$,$)`);
  }

  addSlab(globalId: string, ownerHistory: number, name: string, placement: number, representation: number): number {
    return this.add('IFCSLAB', `(${stepString(globalId)},${stepRef(ownerHistory)},${stepString(name)},$,$,${stepRef(placement)},${stepRef(representation)},$,$)`);
  }

  addPile(globalId: string, ownerHistory: number, name: string, placement: number, representation: number): number {
    return this.add('IFCPILE', `(${stepString(globalId)},${stepRef(ownerHistory)},${stepString(name)},$,$,${stepRef(placement)},${stepRef(representation)},$,$,$)`);
  }

  addBuildingElementProxy(
    globalId: string, ownerHistory: number, name: string,
    description: string | null, placement: number, representation: number,
    predefinedType?: string
  ): number {
    const descStr = description ? stepString(description) : '$';
    const typeStr = predefinedType ? stepEnum(predefinedType) : '.NOTDEFINED.';
    return this.add('IFCBUILDINGELEMENTPROXY', `(${stepString(globalId)},${stepRef(ownerHistory)},${stepString(name)},${descStr},$,${stepRef(placement)},${stepRef(representation)},$,${typeStr})`);
  }

  addSpace(
    globalId: string, ownerHistory: number, name: string,
    description: string | null, placement: number, representation: number | null,
    longName: string | null, compositionType: string, predefinedType: string
  ): number {
    const descStr = description ? stepString(description) : '$';
    const repStr = representation !== null ? stepRef(representation) : '$';
    const longStr = longName ? stepString(longName) : '$';
    return this.add('IFCSPACE', `(${stepString(globalId)},${stepRef(ownerHistory)},${stepString(name)},${descStr},$,${stepRef(placement)},${repStr},${longStr},${compositionType},${predefinedType})`);
  }

  addRelSpaceBoundary(
    globalId: string, ownerHistory: number, description: string | null,
    relatingSpace: number, relatedBuildingElement: number,
    connectionGeometry: number | null, physicalOrVirtual: string, internalOrExternal: string
  ): number {
    const descStr = description ? stepString(description) : '$';
    const geomStr = connectionGeometry !== null ? stepRef(connectionGeometry) : '$';
    return this.add('IFCRELSPACEBOUNDARY', `(${stepString(globalId)},${stepRef(ownerHistory)},$,${descStr},${stepRef(relatingSpace)},${stepRef(relatedBuildingElement)},${geomStr},${physicalOrVirtual},${internalOrExternal})`);
  }

  addGrid(
    globalId: string, ownerHistory: number, name: string,
    placement: number, representation: number | null,
    uAxes: number[], vAxes: number[]
  ): number {
    const repStr = representation !== null ? stepRef(representation) : '$';
    return this.add('IFCGRID', `(${stepString(globalId)},${stepRef(ownerHistory)},${stepString(name)},$,$,${stepRef(placement)},${repStr},$,${stepList(uAxes)},${stepList(vAxes)},$)`);
  }

  addGridAxis(tag: string, curve: number, sameSense: boolean): number {
    return this.add('IFCGRIDAXIS', `(${stepString(tag)},${stepRef(curve)},${stepBool(sameSense)})`);
  }

  addGeometricCurveSet(elements: number[]): number {
    return this.add('IFCGEOMETRICCURVESET', `(${stepList(elements)})`);
  }

  addAnnotation(
    globalId: string, ownerHistory: number, name: string,
    description: string | null, placement: number, representation: number | null
  ): number {
    const descStr = description ? stepString(description) : '$';
    const repStr = representation !== null ? stepRef(representation) : '$';
    return this.add('IFCANNOTATION', `(${stepString(globalId)},${stepRef(ownerHistory)},${stepString(name)},${descStr},$,${stepRef(placement)},${repStr})`);
  }

  addCircleGeom(position: number, radius: number): number {
    return this.add('IFCCIRCLE', `(${stepRef(position)},${stepReal(radius)})`);
  }

  addTrimmedCurve(
    basisCurve: number, trim1: string, trim2: string,
    senseAgreement: boolean, masterRepresentation: string
  ): number {
    return this.add('IFCTRIMMEDCURVE', `(${stepRef(basisCurve)},(${trim1}),(${trim2}),${stepBool(senseAgreement)},${masterRepresentation})`);
  }

  // -------------------------------------------------------------------------
  // Type objects
  // -------------------------------------------------------------------------

  addWallType(globalId: string, ownerHistory: number, name: string): number {
    return this.add('IFCWALLTYPE', `(${stepString(globalId)},${stepRef(ownerHistory)},${stepString(name)},$,$,$,$,$,$,.STANDARD.)`);
  }

  addBeamType(globalId: string, ownerHistory: number, name: string): number {
    return this.add('IFCBEAMTYPE', `(${stepString(globalId)},${stepRef(ownerHistory)},${stepString(name)},$,$,$,$,$,$,.BEAM.)`);
  }

  addSlabType(globalId: string, ownerHistory: number, name: string): number {
    return this.add('IFCSLABTYPE', `(${stepString(globalId)},${stepRef(ownerHistory)},${stepString(name)},$,$,$,$,$,$,.FLOOR.)`);
  }

  addRelDefinesByType(
    globalId: string, ownerHistory: number, name: string | null,
    relatedObjects: number[], relatingType: number
  ): number {
    const nameStr = name ? stepString(name) : '$';
    return this.add('IFCRELDEFINESBYTYPE', `(${stepString(globalId)},${stepRef(ownerHistory)},${nameStr},$,${stepList(relatedObjects)},${stepRef(relatingType)})`);
  }

  // -------------------------------------------------------------------------
  // Materials
  // -------------------------------------------------------------------------

  addMaterial(name: string, description?: string, category?: string): number {
    const descStr = description ? stepString(description) : '$';
    const catStr = category ? stepString(category) : '$';
    return this.add('IFCMATERIAL', `(${stepString(name)},${descStr},${catStr})`);
  }

  addMaterialLayer(
    material: number | null, layerThickness: number, isVentilated: string | null,
    name?: string, description?: string, category?: string
  ): number {
    const matStr = material !== null ? stepRef(material) : '$';
    const ventStr = isVentilated !== null ? stepEnum(isVentilated) : '.FALSE.';
    const nameStr = name ? stepString(name) : '$';
    const descStr = description ? stepString(description) : '$';
    const catStr = category ? stepString(category) : '$';
    return this.add('IFCMATERIALLAYER', `(${matStr},${stepReal(layerThickness)},${ventStr},${nameStr},${descStr},${catStr},0)`);
  }

  addMaterialLayerSet(layers: number[], layerSetName: string | null): number {
    const nameStr = layerSetName ? stepString(layerSetName) : '$';
    return this.add('IFCMATERIALLAYERSET', `(${stepList(layers)},${nameStr},$)`);
  }

  addMaterialLayerSetUsage(
    layerSet: number, layerSetDirection: string,
    directionSense: string, offsetFromReferenceLine: number
  ): number {
    return this.add('IFCMATERIALLAYERSETUSAGE', `(${stepRef(layerSet)},${stepEnum(layerSetDirection)},${stepEnum(directionSense)},${stepReal(offsetFromReferenceLine)},$)`);
  }

  addRelAssociatesMaterial(
    globalId: string, ownerHistory: number, name: string | null,
    relatedObjects: number[], relatingMaterial: number
  ): number {
    const nameStr = name ? stepString(name) : '$';
    return this.add('IFCRELASSOCIATESMATERIAL', `(${stepString(globalId)},${stepRef(ownerHistory)},${nameStr},$,${stepList(relatedObjects)},${stepRef(relatingMaterial)})`);
  }

  // -------------------------------------------------------------------------
  // Property Sets
  // -------------------------------------------------------------------------

  addPropertySingleValue(
    name: string, description: string | null,
    nominalValue: string, unit: number | null
  ): number {
    const descStr = description ? stepString(description) : '$';
    const unitStr = unit !== null ? stepRef(unit) : '$';
    return this.add('IFCPROPERTYSINGLEVALUE', `(${stepString(name)},${descStr},${nominalValue},${unitStr})`);
  }

  addPropertySet(
    globalId: string, ownerHistory: number, name: string,
    description: string | null, properties: number[]
  ): number {
    const descStr = description ? stepString(description) : '$';
    return this.add('IFCPROPERTYSET', `(${stepString(globalId)},${stepRef(ownerHistory)},${stepString(name)},${descStr},${stepList(properties)})`);
  }

  addRelDefinesByProperties(
    globalId: string, ownerHistory: number, name: string | null,
    relatedObjects: number[], relatingPropertyDefinition: number
  ): number {
    const nameStr = name ? stepString(name) : '$';
    return this.add('IFCRELDEFINESBYPROPERTIES', `(${stepString(globalId)},${stepRef(ownerHistory)},${nameStr},$,${stepList(relatedObjects)},${stepRef(relatingPropertyDefinition)})`);
  }

  // -------------------------------------------------------------------------
  // Context
  // -------------------------------------------------------------------------

  addGeometricRepresentationContext(
    identifier: string | null, contextType: string,
    dim: number, precision: number,
    worldCoordSystem: number, trueNorth: number | null
  ): number {
    const idStr = identifier ? stepString(identifier) : '$';
    const tnStr = trueNorth !== null ? stepRef(trueNorth) : '$';
    return this.add('IFCGEOMETRICREPRESENTATIONCONTEXT', `(${idStr},${stepString(contextType)},${dim},${stepReal(precision)},${stepRef(worldCoordSystem)},${tnStr})`);
  }

  addGeometricRepresentationSubContext(
    identifier: string, contextType: string,
    parentContext: number, targetView: string
  ): number {
    return this.add('IFCGEOMETRICREPRESENTATIONSUBCONTEXT', `(${stepString(identifier)},${stepString(contextType)},*,*,*,*,${stepRef(parentContext)},$,$,$,${targetView})`);
  }

  // -------------------------------------------------------------------------
  // Person / Organization / Application
  // -------------------------------------------------------------------------

  addPerson(familyName: string): number {
    return this.add('IFCPERSON', `($,${stepString(familyName)},$,$,$,$,$,$)`);
  }

  addOrganization(name: string): number {
    return this.add('IFCORGANIZATION', `($,${stepString(name)},$,$,$)`);
  }

  addPersonAndOrganization(person: number, org: number): number {
    return this.add('IFCPERSONANDORGANIZATION', `(${stepRef(person)},${stepRef(org)},$)`);
  }

  addApplication(org: number, version: string, fullName: string, identifier: string): number {
    return this.add('IFCAPPLICATION', `(${stepRef(org)},${stepString(version)},${stepString(fullName)},${stepString(identifier)})`);
  }

  // -------------------------------------------------------------------------
  // Serialization
  // -------------------------------------------------------------------------

  getEntities(): IfcEntity[] {
    return this.entities;
  }

  getEntityCount(): number {
    return this.entities.length;
  }

  serialize(): string {
    const lines: string[] = [];
    for (const e of this.entities) {
      lines.push(`${stepRef(e.id)}=${e.type}${e.attrs};`);
    }
    return lines.join('\n');
  }
}

// ============================================================================
// Project Context — sets up the entire IFC project boilerplate in one call
// ============================================================================

export interface ProjectContext {
  builder: IfcBuilder;
  ownerHistoryId: number;
  /** SI units */
  lengthUnit: number;
  areaUnit: number;
  volumeUnit: number;
  /** Geometric context and sub-contexts */
  geomContext: number;
  bodySubContext: number;
  axisSubContext: number;
  /** Project entity */
  projectId: number;
  /** Shared direction/point IDs reused across shapes */
  originPt: number;
  zDir: number;
  xDir: number;
  worldCoord: number;
  /** Shared 2D profile placement at origin */
  origin2D: number;
  profilePlacement2D: number;
  /** Extrusion direction (along Z) */
  extrusionDir: number;
  /** Identity placement for extrusion position */
  identityPlacement: number;
}

/**
 * Create the full IFC project boilerplate: person, org, app, owner history,
 * units, geometric context, project entity, and shared geometry primitives.
 */
export function createProjectContext(): ProjectContext {
  const b = new IfcBuilder();

  // Person, Organization, Application, OwnerHistory
  const personId = b.addPerson('User');
  const orgId = b.addOrganization('Open 2D Studio');
  const personOrgId = b.addPersonAndOrganization(personId, orgId);
  const appOrgId = b.addOrganization('Open 2D Studio');
  const appId = b.addApplication(appOrgId, '1.0', 'Open 2D Studio', 'Open2DStudio');
  const ownerHistoryId = b.addOwnerHistory(personOrgId, appId, '.NOCHANGE.');

  // Units (millimeters for length, with degree angle support)
  const lengthUnit = b.addSIUnit('.LENGTHUNIT.', 'MILLI', '.METRE.');
  const areaUnit = b.addSIUnit('.AREAUNIT.', null, '.SQUARE_METRE.');
  const volumeUnit = b.addSIUnit('.VOLUMEUNIT.', null, '.CUBIC_METRE.');
  const solidAngleUnit = b.addSIUnit('.SOLIDANGLEUNIT.', null, '.STERADIAN.');
  const planeAngleUnit = b.addSIUnit('.PLANEANGLEUNIT.', null, '.RADIAN.');

  const angleDimExponents = b.addDimensionalExponents(0, 0, 0, 0, 0, 0, 0);
  const degreeConversion = b.addMeasureWithUnit(
    `IFCPLANEANGLEMEASURE(${stepReal(Math.PI / 180)})`,
    planeAngleUnit
  );
  const degreeUnit = b.addConversionBasedUnit(
    angleDimExponents, '.PLANEANGLEUNIT.', 'DEGREE', degreeConversion
  );

  const unitAssignment = b.addUnitAssignment([
    lengthUnit, areaUnit, volumeUnit, solidAngleUnit, planeAngleUnit, degreeUnit
  ]);

  // Geometric context
  const originPt = b.addCartesianPoint(0, 0, 0);
  const zDir = b.addDirection(0, 0, 1);
  const xDir = b.addDirection(1, 0, 0);
  const worldCoord = b.addAxis2Placement3D(originPt, zDir, xDir);

  const trueNorthDir = b.addDirection(0, 1, 0);
  const geomContext = b.addGeometricRepresentationContext(
    null, 'Model', 3, 1e-5, worldCoord, trueNorthDir
  );
  const bodySubContext = b.addGeometricRepresentationSubContext(
    'Body', 'Model', geomContext, '.MODEL_VIEW.'
  );
  const axisSubContext = b.addGeometricRepresentationSubContext(
    'Axis', 'Model', geomContext, '.GRAPH_VIEW.'
  );

  // Project
  const projectId = b.addProject(
    generateIfcGuid(), ownerHistoryId, 'Open 2D Studio Project',
    unitAssignment, [geomContext]
  );

  // Shared geometry primitives
  const origin2D = b.addCartesianPoint2D(0, 0);
  const profilePlacement2D = b.addAxis2Placement2D(origin2D);
  const extrusionDir = b.addDirection(0, 0, 1);
  const identityPlacement = b.addAxis2Placement3D(originPt, zDir, xDir);

  return {
    builder: b,
    ownerHistoryId,
    lengthUnit,
    areaUnit,
    volumeUnit,
    geomContext,
    bodySubContext,
    axisSubContext,
    projectId,
    originPt,
    zDir,
    xDir,
    worldCoord,
    origin2D,
    profilePlacement2D,
    extrusionDir,
    identityPlacement,
  };
}

// ============================================================================
// Material Cache
// ============================================================================

export class MaterialCache {
  private cache = new Map<string, number>();

  constructor(private builder: IfcBuilder) {}

  getOrCreate(matKey: MaterialCategory | BeamMaterial | SlabMaterial): number {
    const displayName = getMaterialDisplayName(matKey);
    if (this.cache.has(displayName)) {
      return this.cache.get(displayName)!;
    }
    const category = getMaterialCategory(matKey);
    const matId = this.builder.addMaterial(displayName, undefined, category);
    this.cache.set(displayName, matId);
    return matId;
  }
}

// ============================================================================
// Annotation Helper — reduces the repetitive 8-line pattern per annotation
// ============================================================================

export interface AnnotationResult {
  annotationId: number;
}

/**
 * Create a simple annotation with a curve-based geometry representation.
 * Handles: placement, shape rep, product definition shape, and annotation entity.
 */
export function createCurveAnnotation(
  ctx: ProjectContext,
  globalId: string,
  name: string,
  description: string | null,
  curveItems: number[],
  defaultStoreyPlacement: number,
): AnnotationResult {
  const b = ctx.builder;
  const shapeRep = b.addShapeRepresentation(
    ctx.axisSubContext, 'Annotation', 'Curve2D', curveItems
  );
  const prodShape = b.addProductDefinitionShape(null, null, [shapeRep]);

  const placePt = b.addCartesianPoint(0, 0, 0);
  const placeAxis = b.addAxis2Placement3D(placePt, ctx.zDir, ctx.xDir);
  const placement = b.addLocalPlacement(defaultStoreyPlacement, placeAxis);

  const annotationId = b.addAnnotation(
    globalId, ctx.ownerHistoryId, name, description, placement, prodShape
  );

  return { annotationId };
}

// ============================================================================
// STEP File Assembly
// ============================================================================

export function isoTimestamp(): string {
  return new Date().toISOString().slice(0, 19);
}

export function assembleStepFile(builder: IfcBuilder): string {
  const ts = isoTimestamp();
  const header = [
    'ISO-10303-21;',
    'HEADER;',
    `FILE_DESCRIPTION((${stepString('ViewDefinition [CoordinationView_V2.0]')},${stepString('ExchangeRequirement [Architecture]')}),'2;1');`,
    `FILE_NAME(${stepString('model.ifc')},${stepString(ts)},(${stepString('User')}),(${stepString('Open 2D Studio')}),${stepString('Open 2D Studio IFC Generator 1.0')},${stepString('Open 2D Studio 1.0')},$);`,
    "FILE_SCHEMA(('IFC4'));",
    'ENDSEC;',
    '',
    'DATA;',
  ].join('\n');

  const footer = [
    'ENDSEC;',
    'END-ISO-10303-21;',
  ].join('\n');

  return header + '\n' + builder.serialize() + '\n' + footer + '\n';
}
