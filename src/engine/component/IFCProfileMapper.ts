/**
 * IFC Profile Mapper
 *
 * Factory functions to create ComponentDefinitions for standard IFC profile types.
 * Each profile schema includes parameter definitions and a basic geometry factory.
 */

import type {
  ComponentDefinition,
  ComponentCategory,
  ComponentGeometryElement,
  ComponentRepresentation,
  IFCProfileDefMapping,
  IFCProfileType,
} from '../../types/component';
import type { Parameter, ShapeConstraintGraph } from '../../types/constraints';
import type { ShapeStyle } from '../../types/geometry';

// ── Profile Schema ─────────────────────────────────────────

export interface IFCProfileParameterDef {
  id: string;
  name: string;
  defaultValue: number;
  unit: Parameter['unit'];
  min?: number;
  description?: string;
}

export interface IFCProfileSchema {
  /** The IFC entity name, e.g. "IfcRectangleProfileDef" */
  ifcProfileDefName: string;
  /** Human-readable profile type label */
  label: string;
  /** Matching IFCProfileType discriminant */
  profileType: IFCProfileType;
  /** Ordered list of parameter definitions */
  parameters: IFCProfileParameterDef[];
  /** Maps IFC property names to parameter ids */
  parameterMapping: Record<string, string>;
  /**
   * Geometry factory: given a map of paramId -> value, returns the list
   * of ComponentGeometryElement objects for the default plan representation.
   */
  geometryFactory: (params: Record<string, number>) => ComponentGeometryElement[];
}

// ── Default style ──────────────────────────────────────────

const DEFAULT_STYLE: ShapeStyle = {
  strokeColor: '#e5e7eb',
  strokeWidth: 1,
  fillColor: 'none',
  fillOpacity: 0,
  strokeOpacity: 1,
  lineType: 'solid',
};

// ── Helpers ────────────────────────────────────────────────

function makeParam(
  id: string,
  name: string,
  defaultValue: number,
  unit: Parameter['unit'],
  min = 0,
): IFCProfileParameterDef {
  return { id, name, defaultValue, unit, min };
}

let _elemCounter = 0;
function nextId(prefix: string): string {
  return `${prefix}_${++_elemCounter}`;
}

// ── Profile Schemas ────────────────────────────────────────

const PROFILE_SCHEMAS: IFCProfileSchema[] = [
  // ── IfcRectangleProfileDef ────────────────────────────────
  {
    ifcProfileDefName: 'IfcRectangleProfileDef',
    label: 'Rectangle',
    profileType: 'Rectangle',
    parameters: [
      makeParam('width', 'Width', 200, 'mm', 1),
      makeParam('height', 'Height', 300, 'mm', 1),
    ],
    parameterMapping: {
      XDim: 'width',
      YDim: 'height',
    },
    geometryFactory: (p) => [
      {
        id: nextId('rect'),
        type: 'parametric-rectangle',
        geometry: {
          type: 'parametric-rectangle',
          x1ParamId: 'x1',
          y1ParamId: 'y1',
          widthParamId: 'width',
          heightParamId: 'height',
        },
        style: DEFAULT_STYLE,
      },
    ],
  },

  // ── IfcCircleProfileDef ───────────────────────────────────
  {
    ifcProfileDefName: 'IfcCircleProfileDef',
    label: 'Circle',
    profileType: 'Circular',
    parameters: [
      makeParam('radius', 'Radius', 100, 'mm', 1),
    ],
    parameterMapping: {
      Radius: 'radius',
    },
    geometryFactory: (p) => [
      {
        id: nextId('circ'),
        type: 'parametric-circle',
        geometry: {
          type: 'parametric-circle',
          centerXParamId: 'cx',
          centerYParamId: 'cy',
          radiusParamId: 'radius',
        },
        style: DEFAULT_STYLE,
      },
    ],
  },

  // ── IfcIShapeProfileDef ───────────────────────────────────
  {
    ifcProfileDefName: 'IfcIShapeProfileDef',
    label: 'I-Shape',
    profileType: 'I-Shape',
    parameters: [
      makeParam('height', 'Overall Height', 300, 'mm', 1),
      makeParam('flangeWidth', 'Flange Width', 150, 'mm', 1),
      makeParam('webThickness', 'Web Thickness', 8, 'mm', 1),
      makeParam('flangeThickness', 'Flange Thickness', 13, 'mm', 1),
      makeParam('filletRadius', 'Fillet Radius', 12, 'mm', 0),
    ],
    parameterMapping: {
      OverallDepth: 'height',
      FlangeWidth: 'flangeWidth',
      WebThickness: 'webThickness',
      FlangeThickness: 'flangeThickness',
      FilletRadius: 'filletRadius',
    },
    geometryFactory: (p) => {
      const { height = 300, flangeWidth = 150, webThickness = 8, flangeThickness = 13 } = p;
      const hw = flangeWidth / 2;
      const hh = height / 2;
      const hwt = webThickness / 2;
      // Outline as polyline: I-shape silhouette (clockwise)
      const vertices = [
        { x: -hw, y: -hh },
        { x: hw, y: -hh },
        { x: hw, y: -hh + flangeThickness },
        { x: hwt, y: -hh + flangeThickness },
        { x: hwt, y: hh - flangeThickness },
        { x: hw, y: hh - flangeThickness },
        { x: hw, y: hh },
        { x: -hw, y: hh },
        { x: -hw, y: hh - flangeThickness },
        { x: -hwt, y: hh - flangeThickness },
        { x: -hwt, y: -hh + flangeThickness },
        { x: -hw, y: -hh + flangeThickness },
      ];
      // Encode vertices as param ids (we generate fixed x/y param ids for geometry preview)
      const vertexParamIds = vertices.map((_, i) => ({
        xParamId: `ishape_vx${i}`,
        yParamId: `ishape_vy${i}`,
      }));
      return [
        {
          id: nextId('ishape'),
          type: 'parametric-polyline',
          geometry: {
            type: 'parametric-polyline',
            vertexParamIds,
            closed: true,
          },
          style: DEFAULT_STYLE,
        },
      ];
    },
  },

  // ── IfcLShapeProfileDef ───────────────────────────────────
  {
    ifcProfileDefName: 'IfcLShapeProfileDef',
    label: 'L-Shape',
    profileType: 'L-Shape',
    parameters: [
      makeParam('depth', 'Depth', 100, 'mm', 1),
      makeParam('width', 'Width', 100, 'mm', 1),
      makeParam('thickness', 'Thickness', 10, 'mm', 1),
      makeParam('filletRadius', 'Fillet Radius', 8, 'mm', 0),
    ],
    parameterMapping: {
      Depth: 'depth',
      Width: 'width',
      Thickness: 'thickness',
      FilletRadius: 'filletRadius',
    },
    geometryFactory: (p) => {
      const { depth = 100, width = 100, thickness = 10 } = p;
      const vertexParamIds = [
        { xParamId: 'lshape_vx0', yParamId: 'lshape_vy0' },
        { xParamId: 'lshape_vx1', yParamId: 'lshape_vy1' },
        { xParamId: 'lshape_vx2', yParamId: 'lshape_vy2' },
        { xParamId: 'lshape_vx3', yParamId: 'lshape_vy3' },
        { xParamId: 'lshape_vx4', yParamId: 'lshape_vy4' },
        { xParamId: 'lshape_vx5', yParamId: 'lshape_vy5' },
      ];
      return [
        {
          id: nextId('lshape'),
          type: 'parametric-polyline',
          geometry: {
            type: 'parametric-polyline',
            vertexParamIds,
            closed: true,
          },
          style: DEFAULT_STYLE,
        },
      ];
    },
  },

  // ── IfcTShapeProfileDef ───────────────────────────────────
  {
    ifcProfileDefName: 'IfcTShapeProfileDef',
    label: 'T-Shape',
    profileType: 'T-Shape',
    parameters: [
      makeParam('depth', 'Depth', 200, 'mm', 1),
      makeParam('flangeWidth', 'Flange Width', 150, 'mm', 1),
      makeParam('webThickness', 'Web Thickness', 8, 'mm', 1),
      makeParam('flangeThickness', 'Flange Thickness', 13, 'mm', 1),
    ],
    parameterMapping: {
      Depth: 'depth',
      FlangeWidth: 'flangeWidth',
      WebThickness: 'webThickness',
      FlangeThickness: 'flangeThickness',
    },
    geometryFactory: (p) => {
      const vertexParamIds = Array.from({ length: 8 }, (_, i) => ({
        xParamId: `tshape_vx${i}`,
        yParamId: `tshape_vy${i}`,
      }));
      return [
        {
          id: nextId('tshape'),
          type: 'parametric-polyline',
          geometry: {
            type: 'parametric-polyline',
            vertexParamIds,
            closed: true,
          },
          style: DEFAULT_STYLE,
        },
      ];
    },
  },

  // ── IfcUShapeProfileDef ───────────────────────────────────
  {
    ifcProfileDefName: 'IfcUShapeProfileDef',
    label: 'U-Shape',
    profileType: 'U-Shape',
    parameters: [
      makeParam('depth', 'Depth', 200, 'mm', 1),
      makeParam('flangeWidth', 'Flange Width', 80, 'mm', 1),
      makeParam('webThickness', 'Web Thickness', 8, 'mm', 1),
      makeParam('flangeThickness', 'Flange Thickness', 12, 'mm', 1),
    ],
    parameterMapping: {
      Depth: 'depth',
      FlangeWidth: 'flangeWidth',
      WebThickness: 'webThickness',
      FlangeThickness: 'flangeThickness',
    },
    geometryFactory: (p) => {
      const vertexParamIds = Array.from({ length: 8 }, (_, i) => ({
        xParamId: `ushape_vx${i}`,
        yParamId: `ushape_vy${i}`,
      }));
      return [
        {
          id: nextId('ushape'),
          type: 'parametric-polyline',
          geometry: {
            type: 'parametric-polyline',
            vertexParamIds,
            closed: true,
          },
          style: DEFAULT_STYLE,
        },
      ];
    },
  },

  // ── IfcRectangleHollowProfileDef ──────────────────────────
  {
    ifcProfileDefName: 'IfcRectangleHollowProfileDef',
    label: 'Rectangular Hollow Section',
    profileType: 'Tube',
    parameters: [
      makeParam('width', 'Width', 100, 'mm', 1),
      makeParam('height', 'Height', 150, 'mm', 1),
      makeParam('wallThickness', 'Wall Thickness', 6, 'mm', 1),
    ],
    parameterMapping: {
      XDim: 'width',
      YDim: 'height',
      WallThickness: 'wallThickness',
    },
    geometryFactory: (p) => {
      // Two rectangles: outer and inner
      const outerGeom: ComponentGeometryElement = {
        id: nextId('rhs_outer'),
        type: 'parametric-rectangle',
        geometry: {
          type: 'parametric-rectangle',
          x1ParamId: 'x1',
          y1ParamId: 'y1',
          widthParamId: 'width',
          heightParamId: 'height',
        },
        style: DEFAULT_STYLE,
      };
      const innerGeom: ComponentGeometryElement = {
        id: nextId('rhs_inner'),
        type: 'parametric-rectangle',
        geometry: {
          type: 'parametric-rectangle',
          x1ParamId: 'rhs_ix1',
          y1ParamId: 'rhs_iy1',
          widthParamId: 'rhs_iwidth',
          heightParamId: 'rhs_iheight',
        },
        style: DEFAULT_STYLE,
      };
      return [outerGeom, innerGeom];
    },
  },

  // ── IfcCircleHollowProfileDef ─────────────────────────────
  {
    ifcProfileDefName: 'IfcCircleHollowProfileDef',
    label: 'Circular Hollow Section (Pipe)',
    profileType: 'Pipe',
    parameters: [
      makeParam('radius', 'Outer Radius', 60, 'mm', 1),
      makeParam('wallThickness', 'Wall Thickness', 5, 'mm', 1),
    ],
    parameterMapping: {
      Radius: 'radius',
      WallThickness: 'wallThickness',
    },
    geometryFactory: (p) => {
      const outer: ComponentGeometryElement = {
        id: nextId('chs_outer'),
        type: 'parametric-circle',
        geometry: {
          type: 'parametric-circle',
          centerXParamId: 'cx',
          centerYParamId: 'cy',
          radiusParamId: 'radius',
        },
        style: DEFAULT_STYLE,
      };
      const inner: ComponentGeometryElement = {
        id: nextId('chs_inner'),
        type: 'parametric-circle',
        geometry: {
          type: 'parametric-circle',
          centerXParamId: 'cx',
          centerYParamId: 'cy',
          radiusParamId: 'chs_inner_radius',
        },
        style: DEFAULT_STYLE,
      };
      return [outer, inner];
    },
  },
];

// ── Public API ─────────────────────────────────────────────

/** Returns all available profile schemas. */
export function getProfileSchemas(): IFCProfileSchema[] {
  return PROFILE_SCHEMAS;
}

/** Returns the schema for a specific IFC profile def name, e.g. "IfcRectangleProfileDef". */
export function getProfileSchema(ifcProfileDefName: string): IFCProfileSchema | undefined {
  return PROFILE_SCHEMAS.find((s) => s.ifcProfileDefName === ifcProfileDefName);
}

/** Returns the schema by IFCProfileType discriminant. */
export function getProfileSchemaByType(profileType: IFCProfileType): IFCProfileSchema | undefined {
  return PROFILE_SCHEMAS.find((s) => s.profileType === profileType);
}

/**
 * Creates a full ComponentDefinition for the given IFC profile type.
 *
 * @param ifcProfileDefName  The IFC entity name, e.g. "IfcRectangleProfileDef"
 * @param ifcClass           The IFC structural member class, e.g. "IfcBeam"
 * @param name               Human-readable component name, e.g. "IPE 300"
 * @param parameterDefaults  Optional overrides for default parameter values
 */
export function createProfileDefinition(
  ifcProfileDefName: string,
  ifcClass: string,
  name: string,
  parameterDefaults: Record<string, number> = {},
): ComponentDefinition {
  const schema = getProfileSchema(ifcProfileDefName);
  if (!schema) {
    throw new Error(`Unknown IFC profile type: ${ifcProfileDefName}`);
  }

  const now = Date.now();
  const id = `comp_${ifcProfileDefName}_${now}`;

  // Build parameters from schema, applying any defaults overrides
  const parameters: Parameter[] = schema.parameters.map((pd) => ({
    id: pd.id,
    name: pd.name,
    value: parameterDefaults[pd.id] ?? pd.defaultValue,
    unit: pd.unit,
    min: pd.min,
    type: 'number' as const,
  }));

  // Build resolved param values map for geometry factory
  const paramValues: Record<string, number> = {};
  parameters.forEach((p) => {
    paramValues[p.id] = p.value as number;
  });

  // Build default constraint graph (empty — no cross-parameter constraints by default)
  const constraintGraph: ShapeConstraintGraph = {
    parameters,
    vertices: [],
    edges: [],
    constraintGraph: {
      nodes: {},
      solveOrder: [],
      globalParameters: {},
      isDirty: false,
    },
  };

  // Build geometry elements via factory
  const geometryElements = schema.geometryFactory(paramValues);

  // Default plan representation
  const planRepresentation: ComponentRepresentation = {
    id: `${id}_plan`,
    context: 'plan',
    geometry: geometryElements,
    isDefault: true,
  };

  // IFC profile mapping
  const ifcProfileDef: IFCProfileDefMapping = {
    profileType: schema.profileType,
    parameterMapping: schema.parameterMapping,
  };

  // Determine category from IFC class
  const category = resolveCategory(ifcClass);

  return {
    id,
    name,
    category,
    description: `${schema.label} profile — ${ifcClass}`,
    version: '1.0.0',
    createdAt: now,
    updatedAt: now,

    parameters,
    constraintGraph,

    representations: [planRepresentation],
    referenceGeometry: [],

    nestedComponents: [],
    componentArrays: [],

    ifcEntityType: ifcClass,
    ifcProfileDef,
    ifcPropertySets: [],

    tags: [schema.label, ifcClass, 'ifc-profile'],
    library: 'IFC Standard Profiles',
    isTemplate: false,
  };
}

// ── Helpers ────────────────────────────────────────────────

function resolveCategory(ifcClass: string): ComponentCategory {
  const lower = ifcClass.toLowerCase();
  if (lower.includes('beam') || lower.includes('column') || lower.includes('member')) {
    return 'structural-steel';
  }
  if (lower.includes('slab') || lower.includes('footing')) {
    return 'structural-concrete';
  }
  if (lower.includes('pile')) {
    return 'foundation';
  }
  return 'custom';
}
