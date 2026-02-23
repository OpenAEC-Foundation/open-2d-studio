export interface QueryTemplate {
  id: string;
  name: string;
  description: string;
  category: 'schedule' | 'quantity-takeoff' | 'analysis';
  sql: string;
  /** Column display configuration */
  columns: QueryColumnConfig[];
}

export interface QueryColumnConfig {
  field: string;
  header: string;
  width?: number;       // mm for sheet tables
  visible: boolean;
  format?: 'number' | 'decimal1' | 'decimal2' | 'integer' | 'text';
}

export const QUERY_TEMPLATES: QueryTemplate[] = [
  {
    id: 'paalstaat',
    name: 'Pile Schedule (Paalstaat)',
    description: 'Overview of all piles with type, diameter, tip level and cutoff level',
    category: 'schedule',
    sql: `SELECT
  Reference AS "Reference",
  PileTypeName AS "Type",
  Diameter AS "Diameter (mm)",
  TipLevelNAP AS "Tip Level NAP (m)",
  CutoffLevel AS "Cutoff Level",
  CutoffLevelNAP AS "Cutoff Level NAP",
  CrossSectionShape AS "Section"
FROM IfcPile
ORDER BY pileNumber`,
    columns: [
      { field: 'Reference', header: 'Ref', visible: true, format: 'text' },
      { field: 'Type', header: 'Type', visible: true, format: 'text' },
      { field: 'Diameter (mm)', header: 'Dia (mm)', visible: true, format: 'integer', width: 15 },
      { field: 'Tip Level NAP (m)', header: 'Tip NAP (m)', visible: true, format: 'decimal1', width: 25 },
      { field: 'Cutoff Level', header: 'Cutoff Level', visible: true, format: 'decimal1', width: 25 },
      { field: 'Cutoff Level NAP', header: 'Cutoff NAP', visible: true, format: 'decimal2', width: 20 },
      { field: 'Section', header: 'Section', visible: true, format: 'text', width: 15 },
    ],
  },
  {
    id: 'pile-summary',
    name: 'Pile Summary',
    description: 'Summary per pile type with counts',
    category: 'quantity-takeoff',
    sql: `SELECT
  PileTypeName AS "Pile Type",
  Diameter AS "Diameter (mm)",
  CrossSectionShape AS "Section Shape",
  PredefinedType AS "IFC Type",
  COUNT(*) AS "Count"
FROM IfcPile
GROUP BY PileTypeName, Diameter, CrossSectionShape, PredefinedType
ORDER BY PileTypeName`,
    columns: [
      { field: 'Pile Type', header: 'Pile Type', visible: true, format: 'text' },
      { field: 'Diameter (mm)', header: 'Dia (mm)', visible: true, format: 'integer' },
      { field: 'Section Shape', header: 'Section', visible: true, format: 'text' },
      { field: 'IFC Type', header: 'IFC Type', visible: true, format: 'text' },
      { field: 'Count', header: 'Count', visible: true, format: 'integer' },
    ],
  },
  {
    id: 'cpt-overview',
    name: 'CPT Overview',
    description: 'Overview of all CPT locations',
    category: 'schedule',
    sql: `SELECT
  name AS "Name",
  x AS "X",
  y AS "Y",
  depth / 1000 AS "Depth (m)",
  CASE WHEN kleefmeting THEN 'Yes' ELSE 'No' END AS "Friction Sleeve",
  CASE WHEN waterspanning THEN 'Yes' ELSE 'No' END AS "Pore Pressure",
  CASE WHEN uitgevoerd THEN 'Yes' ELSE 'No' END AS "Completed"
FROM cpts
ORDER BY name`,
    columns: [
      { field: 'Name', header: 'Name', visible: true, format: 'text' },
      { field: 'X', header: 'X', visible: true, format: 'integer' },
      { field: 'Y', header: 'Y', visible: true, format: 'integer' },
      { field: 'Depth (m)', header: 'Depth (m)', visible: true, format: 'decimal1' },
      { field: 'Friction Sleeve', header: 'Friction', visible: true, format: 'text' },
      { field: 'Pore Pressure', header: 'Pore Press.', visible: true, format: 'text' },
      { field: 'Completed', header: 'Completed', visible: true, format: 'text' },
    ],
  },
  {
    id: 'ifc-entity-count',
    name: 'IFC Entity Count',
    description: 'Count of all elements per IFC entity type',
    category: 'analysis',
    sql: `SELECT
  ifcType AS "IFC Entity Type",
  COUNT(*) AS "Count"
FROM shapes
GROUP BY ifcType
ORDER BY ifcType`,
    columns: [
      { field: 'IFC Entity Type', header: 'IFC Entity Type', visible: true, format: 'text' },
      { field: 'Count', header: 'Count', visible: true, format: 'integer' },
    ],
  },
  {
    id: 'wall-schedule',
    name: 'Wall Schedule',
    description: 'Overview of all walls with dimensions',
    category: 'schedule',
    sql: `SELECT
  Reference AS "Reference",
  Width AS "Width (mm)",
  Length AS "Length (mm)",
  Height AS "Height (mm)"
FROM IfcWall
ORDER BY Reference`,
    columns: [
      { field: 'Reference', header: 'Ref', visible: true, format: 'text' },
      { field: 'Width (mm)', header: 'Width', visible: true, format: 'integer' },
      { field: 'Length (mm)', header: 'Length', visible: true, format: 'integer' },
      { field: 'Height (mm)', header: 'Height', visible: true, format: 'integer' },
    ],
  },
  {
    id: 'slab-schedule',
    name: 'Slab Schedule',
    description: 'Overview of all slabs with thickness and material',
    category: 'schedule',
    sql: `SELECT
  Reference AS "Reference",
  Depth AS "Thickness (mm)",
  Material AS "Material",
  Elevation AS "Elevation (mm)"
FROM IfcSlab
ORDER BY Reference`,
    columns: [
      { field: 'Reference', header: 'Ref', visible: true, format: 'text' },
      { field: 'Thickness (mm)', header: 'Thickness', visible: true, format: 'integer' },
      { field: 'Material', header: 'Material', visible: true, format: 'text' },
      { field: 'Elevation (mm)', header: 'Elevation', visible: true, format: 'integer' },
    ],
  },
];
