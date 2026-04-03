// Component system type definitions
import type {
  ShapeStyle,
  BaseShape,
  BoundingBox,
  Shape,
} from './geometry';
import type { Parameter, ShapeConstraintGraph } from './constraints';

// ── Component Category ──────────────────────────────────────

export type ComponentCategory =
  | 'structural-steel'
  | 'structural-concrete'
  | 'structural-timber'
  | 'reinforcement'
  | 'foundation'
  | 'architectural'
  | 'MEP'
  | 'detail'
  | 'annotation'
  | 'custom';

// ── Representation Context ──────────────────────────────────

export type RepresentationContext = 'plan' | 'section' | 'elevation' | 'detail' | '3d';

// ── Parametric Geometry Definitions ─────────────────────────

export interface ParametricLineDef {
  type: 'parametric-line';
  startXParamId: string;
  startYParamId: string;
  endXParamId: string;
  endYParamId: string;
}

export interface ParametricPolylineDef {
  type: 'parametric-polyline';
  vertexParamIds: Array<{ xParamId: string; yParamId: string }>;
  closed?: boolean;
}

export interface ParametricArcDef {
  type: 'parametric-arc';
  centerXParamId: string;
  centerYParamId: string;
  radiusParamId: string;
  startAngleParamId: string;
  endAngleParamId: string;
}

export interface ParametricCircleDef {
  type: 'parametric-circle';
  centerXParamId: string;
  centerYParamId: string;
  radiusParamId: string;
}

export interface ParametricRectangleDef {
  type: 'parametric-rectangle';
  x1ParamId: string;
  y1ParamId: string;
  widthParamId: string;
  heightParamId: string;
}

export interface ParametricHatchDef {
  type: 'parametric-hatch';
  boundaryVertexParamIds: Array<{ xParamId: string; yParamId: string }>;
  patternType: string;
  patternAngleParamId?: string;
  patternScaleParamId?: string;
}

export interface ParametricTextDef {
  type: 'parametric-text';
  contentParamId: string;
  xParamId: string;
  yParamId: string;
  heightParamId: string;
  rotationParamId?: string;
}

export interface ParametricDimensionDef {
  type: 'parametric-dimension';
  startXParamId: string;
  startYParamId: string;
  endXParamId: string;
  endYParamId: string;
  valueParamId: string;
}

export type ParametricGeometryDef =
  | ParametricLineDef
  | ParametricPolylineDef
  | ParametricArcDef
  | ParametricCircleDef
  | ParametricRectangleDef
  | ParametricHatchDef
  | ParametricTextDef
  | ParametricDimensionDef;

// ── Component Geometry ──────────────────────────────────────

export interface ComponentGeometryElement {
  id: string;
  type: ParametricGeometryDef['type'];
  geometry: ParametricGeometryDef;
  style: ShapeStyle;
  visibleParamId?: string;
}

export interface ComponentRepresentation {
  id: string;
  context: RepresentationContext;
  geometry: ComponentGeometryElement[];
  isDefault: boolean;
}

export interface ReferenceGeometry {
  id: string;
  type: ParametricGeometryDef['type'];
  geometry: ParametricGeometryDef;
  label?: string;
}

// ── Nested Components ──────────────────────────────────────

export interface NestedComponentRef {
  id: string;
  definitionId: string;
  shared: boolean;
  instanceName?: string;
  positionX: number;
  positionY: number;
  rotation?: number;
  scale?: number;
  parameterOverrides: Record<string, string>;
  visibleParamId?: string;
}

// ── Component Arrays ────────────────────────────────────────

export interface ComponentArray {
  id: string;
  type: 'linear' | 'radial';
  sourceType: 'geometry' | 'component';
  sourceId: string;
  countParamId: string;
  spacingX?: number;
  spacingY?: number;
  centerX?: number;
  centerY?: number;
  radius?: number;
  totalAngle?: number;
  visibleParamId?: string;
}

// ── IFC Profile Types ──────────────────────────────────────

export type IFCProfileType =
  | 'I-Shape'
  | 'C-Shape'
  | 'T-Shape'
  | 'L-Shape'
  | 'U-Shape'
  | 'Z-Shape'
  | 'Angle'
  | 'Channel'
  | 'Plate'
  | 'Pipe'
  | 'Tube'
  | 'Circular'
  | 'Rectangle'
  | 'Asymmetric-I'
  | 'Custom';

export interface IFCProfileDefMapping {
  profileType: IFCProfileType;
  parameterMapping: Record<string, string>;
}

// ── IFC Properties ─────────────────────────────────────────

export interface IFCPropertySetDef {
  name: string;
  properties: Record<string, IFCPropertyMapping>;
}

export interface IFCPropertyMapping {
  propertyName: string;
  parameterIds: string[];
  ifcDataType: string;
}

// ── Component Definition ────────────────────────────────────

export interface ComponentDefinition {
  // Identity & Metadata
  id: string;
  name: string;
  category: ComponentCategory;
  description?: string;
  version: string;
  createdAt: number;
  updatedAt: number;

  // Parameters
  parameters: Parameter[];
  constraintGraph: ShapeConstraintGraph;

  // Geometry
  representations: ComponentRepresentation[];
  referenceGeometry?: ReferenceGeometry[];

  // Nesting
  nestedComponents: NestedComponentRef[];
  componentArrays: ComponentArray[];

  // IFC Integration
  ifcEntityType?: string;
  ifcProfileDef?: IFCProfileDefMapping;
  ifcPropertySets?: IFCPropertySetDef[];

  // Metadata
  tags?: string[];
  library?: string;
  isTemplate?: boolean;
}

// ── Flattened Geometry for Rendering ───────────────────────

export interface FlattenedComponentGeometry {
  shapes: Shape[];
  bounds: BoundingBox;
}

// ── Component Instance Shape ───────────────────────────────

export interface ComponentInstanceShape extends BaseShape {
  type: 'component-instance';
  definitionId: string;
  positionX: number;
  positionY: number;
  rotation: number;
  scaleX: number;
  scaleY: number;
  parameterOverrides: Record<string, number | boolean | string>;
  nestedInstances?: ComponentInstanceShape[];
}
