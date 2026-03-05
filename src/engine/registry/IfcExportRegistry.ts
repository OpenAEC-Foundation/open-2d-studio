import type { MaterialCategory, Shape, GridlineShape } from '../../types/geometry';

export interface IfcExportContext {
  builder: any;
  ownerHistoryId: number;
  // Sub-contexts
  axisSubContext: number;
  bodySubContext: number;
  identityPlacement: number;
  extrusionDir: number;
  profilePlacement2D: number;
  // Reference directions
  zDir: number;
  xDir: number;
  // Units
  lengthUnit: number | null;
  areaUnit: number | null;
  volumeUnit: number | null;
  // Spatial structure
  defaultStoreyId: number;
  defaultStoreyPlacement: number;
  // Helpers
  assignPropertySet: (elementId: number, shapeId: string, suffix: string,
    psetName: string, description: string | null, props: number[]) => void;
  materials: { getOrCreate: (category: MaterialCategory) => number };
  createElementPlacement: (x: number, y: number, z: number, angle: number) => number;
  addElementToStorey: (elementId: number, storeyId: number) => void;
  resolveStoreyForShape: (shape: Shape) => number;
  lineLength: (start: { x: number; y: number }, end: { x: number; y: number }) => number;
  lineAngle: (start: { x: number; y: number }, end: { x: number; y: number }) => number;
  shapeToIfcGuid: (id: string, suffix?: string) => string;
  getMaterialDisplayName: (key: string) => string;
  // IFC value helpers
  ifcLabel: (v: string) => any;
  ifcIdentifier: (v: string) => any;
  ifcBoolean: (v: boolean) => any;
  ifcLengthMeasure: (v: number) => any;
  ifcPositiveLengthMeasure: (v: number) => any;
  ifcAreaMeasure: (v: number) => any;
  ifcVolumeMeasure: (v: number) => any;
  // Type tracking (mutable — handlers push into these)
  wallTypes: any[];
  slabTypes: any[];
  pileTypes: any[];
  wallTypeIfcMap: Map<string, number>;
  wallTypeElements: Map<string, number[]>;
  slabTypeIfcMap: Map<string, number>;
  slabTypeElements: Map<string, number[]>;
  beamTypeIfcMap: Map<string, number>;
  beamTypeElements: Map<string, number[]>;
  materialAssociations: { elementIds: number[]; materialId: number }[];
  layerSetUsageAssociations: { elementIds: number[]; usageId: number }[];
  propertySetAssignments: { elementIds: number[]; psetId: number }[];
  // Gridline tracking
  gridlineAxes: { axis: number; curve: number; shape: GridlineShape }[];
  exportedProjectGridIds: Set<string>;
  // Drawing queries
  isShapeInPlanDrawing: (shape: Shape) => boolean;
  isShapeInSectionDrawing: (shape: Shape) => boolean;
}

export type IfcExportFn = (shape: any, context: IfcExportContext) => void;

class IfcExportRegistry {
  private handlers = new Map<string, IfcExportFn>();

  register(shapeType: string, fn: IfcExportFn): void { this.handlers.set(shapeType, fn); }
  unregister(shapeType: string): void { this.handlers.delete(shapeType); }
  get(shapeType: string): IfcExportFn | undefined { return this.handlers.get(shapeType); }
}

export const ifcExportRegistry = new IfcExportRegistry();
