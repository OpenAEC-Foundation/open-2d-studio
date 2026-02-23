import alasql from 'alasql';
import type { Shape, PileShape, WallShape, BeamShape, SlabShape, PileTypeDefinition, Drawing } from '../../types/geometry';

export interface QueryResult {
  columns: string[];
  rows: Record<string, any>[];
  error?: string;
  executionTimeMs: number;
}

export interface QueryContext {
  shapes: Shape[];
  drawings: Drawing[];
  pileTypes: PileTypeDefinition[];
}

/**
 * Shape type to IFC entity type mapping.
 * Used by the universal shapes table and for IFC-aware queries.
 */
const SHAPE_TO_IFC_TYPE: Record<string, string> = {
  pile: 'IfcPile',
  wall: 'IfcWall',
  beam: 'IfcBeam',
  slab: 'IfcSlab',
  gridline: 'IfcGrid',
  level: 'IfcBuildingStorey',
  cpt: 'IfcBuildingElementProxy',
  puntniveau: 'IfcBuildingElementProxy',
  space: 'IfcSpace',
  line: 'IfcAnnotation',
  arc: 'IfcAnnotation',
  circle: 'IfcAnnotation',
  polyline: 'IfcAnnotation',
  rectangle: 'IfcAnnotation',
  text: 'IfcAnnotation',
  dimension: 'IfcAnnotation',
  'section-callout': 'IfcAnnotation',
};

/**
 * Materialize virtual tables from shape data for SQL queries.
 *
 * IFC entity type tables (primary):
 *   IfcPile, IfcWall, IfcBeam, IfcSlab, IfcGrid, IfcBuildingElementProxy, IfcSpace
 *
 * Legacy tables (aliases, still supported for backward compatibility):
 *   piles, walls, beams, slabs, gridlines, cpts, puntniveaus
 *
 * Universal tables:
 *   shapes (all shapes with IFC type column)
 */
function materializeTables(ctx: QueryContext): Record<string, Record<string, any>[]> {
  const tables: Record<string, Record<string, any>[]> = {};

  // IfcPile / piles table - enriched with pile type info and IFC-standard property names
  const pileRows = ctx.shapes
    .filter((s): s is PileShape => s.type === 'pile')
    .map(pile => {
      const pileType = ctx.pileTypes.find(pt => pt.id === pile.pileTypeId);
      return {
        // IFC-standard property names (Pset_PileCommon)
        id: pile.id,
        ifcType: 'IfcPile',
        Reference: pile.label || pile.pileNumber || '',
        Status: 'New',
        Length: 10000,
        Diameter: pile.diameter,
        DesignParameters: pile.puntniveauNAP != null ? `TipLevel=${pile.puntniveauNAP}m NAP` : '',
        PredefinedType: pileType?.ifcPredefinedType ?? 'DRIVEN',
        // Additional useful columns
        PileTypeName: pileType?.name ?? '',
        CrossSectionShape: pileType?.shape ?? '',
        ConstructionMethod: pileType?.method ?? '',
        x: Math.round(pile.position.x),
        y: Math.round(pile.position.y),
        TipLevelNAP: pile.puntniveauNAP ?? null,
        CutoffLevel: pile.bkPaalPeil ?? null,
        CutoffLevelNAP: pile.cutoffLevel ?? null,
        ActualTipLevelNAP: pile.tipLevel ?? null,
        // Legacy column names (backward compat)
        nr: pile.label || pile.pileNumber || '',
        label: pile.label || '',
        pileNumber: pile.pileNumber ?? null,
        type: pileType?.name ?? '',
        shape: pileType?.shape ?? '',
        method: pileType?.method ?? '',
        diameter: pile.diameter,
        puntniveauNAP: pile.puntniveauNAP ?? null,
        cutoffLevel: pile.cutoffLevel ?? null,
        tipLevel: pile.tipLevel ?? null,
        bkPaalPeil: pile.bkPaalPeil ?? null,
        pileTypeId: pile.pileTypeId ?? '',
        contourType: pile.contourType ?? 'circle',
        fillPattern: pile.fillPattern ?? 6,
        cptId: pile.cptId ?? '',
        drawingId: pile.drawingId,
        layerId: pile.layerId,
      };
    });
  tables.IfcPile = pileRows;
  tables.piles = pileRows;

  // IfcWall / walls table
  const wallRows = ctx.shapes
    .filter((s): s is WallShape => s.type === 'wall')
    .map(w => {
      const length = Math.sqrt(
        (w.end.x - w.start.x) ** 2 + (w.end.y - w.start.y) ** 2
      );
      return {
        id: w.id,
        ifcType: 'IfcWall',
        Reference: w.label ?? '',
        IsExternal: true,
        LoadBearing: true,
        Width: w.thickness ?? 0,
        Length: Math.round(length),
        Height: 3000,
        // Legacy column names
        wallTypeId: w.wallTypeId ?? '',
        thickness: w.thickness ?? 0,
        length: Math.round(length),
        height: 3000,
        material: '',
        drawingId: w.drawingId,
      };
    });
  tables.IfcWall = wallRows;
  tables.walls = wallRows;

  // IfcBeam / beams table
  const beamRows = ctx.shapes
    .filter((s): s is BeamShape => s.type === 'beam')
    .map(bm => {
      const length = Math.sqrt(
        (bm.end.x - bm.start.x) ** 2 + (bm.end.y - bm.start.y) ** 2
      );
      return {
        id: bm.id,
        ifcType: bm.viewMode === 'section' ? 'IfcColumn' : 'IfcBeam',
        Reference: bm.labelText || bm.presetName || 'Beam',
        Span: Math.round(length),
        ProfileType: bm.profileType,
        Material: bm.material ?? '',
        // Legacy column names
        presetName: bm.presetName ?? '',
        presetId: bm.presetId ?? '',
        material: bm.material ?? '',
        width: bm.flangeWidth ?? 0,
        height: (bm.profileParameters?.depth as number) || (bm.profileParameters?.h as number) || bm.flangeWidth || 0,
        length: Math.round(length),
        drawingId: bm.drawingId,
      };
    });
  tables.IfcBeam = beamRows;
  tables.beams = beamRows;

  // IfcSlab / slabs table
  const slabRows = ctx.shapes
    .filter((s): s is SlabShape => s.type === 'slab')
    .map(sl => ({
      id: sl.id,
      ifcType: 'IfcSlab',
      Reference: sl.label ?? '',
      Depth: sl.thickness ?? 0,
      Material: sl.material ?? '',
      Elevation: sl.elevation ?? 0,
      // Legacy column names
      thickness: sl.thickness ?? 0,
      material: sl.material ?? '',
      drawingId: sl.drawingId,
    }));
  tables.IfcSlab = slabRows;
  tables.slabs = slabRows;

  // IfcBuildingElementProxy (CPTs + Puntniveaus)
  const cptRows = ctx.shapes
    .filter(s => s.type === 'cpt')
    .map(s => {
      const c = s as any;
      return {
        id: c.id,
        ifcType: 'IfcBuildingElementProxy',
        ObjectType: 'CPT',
        name: c.name ?? '',
        x: Math.round(c.position.x),
        y: Math.round(c.position.y),
        depth: c.depth ?? 30000,
        kleefmeting: c.kleefmeting ?? false,
        waterspanning: c.waterspanning ?? false,
        uitgevoerd: c.uitgevoerd ?? false,
        drawingId: c.drawingId,
      };
    });
  tables.cpts = cptRows;

  const puntniveauRows = ctx.shapes
    .filter(s => s.type === 'puntniveau')
    .map(s => {
      const p = s as any;
      return {
        id: p.id,
        ifcType: 'IfcBuildingElementProxy',
        ObjectType: 'Puntniveau',
        puntniveauNAP: p.puntniveauNAP ?? 0,
        drawingId: p.drawingId,
      };
    });
  tables.puntniveaus = puntniveauRows;

  // IfcBuildingElementProxy combines CPTs and Puntniveaus
  tables.IfcBuildingElementProxy = [...cptRows, ...puntniveauRows];

  // IfcGrid / gridlines table
  const gridRows = ctx.shapes
    .filter(s => s.type === 'gridline')
    .map(s => {
      const g = s as any;
      return {
        id: g.id,
        ifcType: 'IfcGrid',
        label: g.label ?? '',
        drawingId: g.drawingId,
      };
    });
  tables.IfcGrid = gridRows;
  tables.gridlines = gridRows;

  // IfcSpace table
  tables.IfcSpace = ctx.shapes
    .filter(s => s.type === 'space')
    .map(s => {
      const sp = s as any;
      return {
        id: sp.id,
        ifcType: 'IfcSpace',
        Name: sp.name ?? '',
        Number: sp.number ?? '',
        Level: sp.level ?? '',
        Area: sp.area ?? null,
        drawingId: sp.drawingId,
      };
    });

  // Universal shapes table - includes IFC type mapping
  tables.shapes = ctx.shapes.map(s => ({
    id: s.id,
    type: s.type,
    ifcType: SHAPE_TO_IFC_TYPE[s.type] || 'IfcBuildingElementProxy',
    drawingId: s.drawingId,
    layerId: s.layerId,
    visible: s.visible,
    locked: s.locked,
  }));

  return tables;
}

/**
 * Execute a SQL query against shape data.
 * Uses AlaSQL with materialized virtual tables.
 *
 * Table references in SQL are automatically detected and materialized.
 * Supported tables: piles, walls, beams, slabs, cpts, puntniveaus, gridlines, shapes
 */
export function executeQuery(sql: string, ctx: QueryContext): QueryResult {
  const start = performance.now();

  try {
    const tables = materializeTables(ctx);

    // Detect table references in SQL and build parameter array
    const tableNames = Object.keys(tables);
    const sqlLower = sql.toLowerCase();

    // Use AlaSQL's table registration approach
    // Register tables temporarily
    for (const name of tableNames) {
      if (sqlLower.includes(name.toLowerCase())) {
        alasql(`DROP TABLE IF EXISTS ${name}`);
        alasql(`CREATE TABLE ${name}`);
        alasql.tables[name].data = tables[name];
      }
    }

    const rows = alasql(sql) as Record<string, any>[];

    // Clean up tables
    for (const name of tableNames) {
      if (sqlLower.includes(name.toLowerCase())) {
        try { alasql(`DROP TABLE IF EXISTS ${name}`); } catch { /* ignore */ }
      }
    }

    const columns = rows.length > 0 ? Object.keys(rows[0]) : [];

    return {
      columns,
      rows,
      executionTimeMs: performance.now() - start,
    };
  } catch (err: any) {
    return {
      columns: [],
      rows: [],
      error: err.message || String(err),
      executionTimeMs: performance.now() - start,
    };
  }
}

/** Available table names for autocomplete (IFC entity types first, then legacy aliases) */
export const AVAILABLE_TABLES = [
  // IFC entity type tables (primary)
  'IfcPile', 'IfcWall', 'IfcBeam', 'IfcSlab', 'IfcGrid', 'IfcBuildingElementProxy', 'IfcSpace',
  // Legacy aliases (backward compatible)
  'piles', 'walls', 'beams', 'slabs', 'cpts', 'puntniveaus', 'gridlines',
  // Universal
  'shapes',
];

/** Column descriptions per table for autocomplete/help */
export const TABLE_COLUMNS: Record<string, string[]> = {
  // IFC entity type tables
  IfcPile: ['id', 'ifcType', 'Reference', 'Status', 'Length', 'Diameter', 'DesignParameters', 'PredefinedType', 'PileTypeName', 'CrossSectionShape', 'ConstructionMethod', 'x', 'y', 'TipLevelNAP', 'CutoffLevel', 'CutoffLevelNAP', 'ActualTipLevelNAP', 'drawingId', 'layerId'],
  IfcWall: ['id', 'ifcType', 'Reference', 'IsExternal', 'LoadBearing', 'Width', 'Length', 'Height', 'wallTypeId', 'drawingId'],
  IfcBeam: ['id', 'ifcType', 'Reference', 'Span', 'ProfileType', 'Material', 'drawingId'],
  IfcSlab: ['id', 'ifcType', 'Reference', 'Depth', 'Material', 'Elevation', 'drawingId'],
  IfcGrid: ['id', 'ifcType', 'label', 'drawingId'],
  IfcBuildingElementProxy: ['id', 'ifcType', 'ObjectType', 'name', 'x', 'y', 'depth', 'puntniveauNAP', 'drawingId'],
  IfcSpace: ['id', 'ifcType', 'Name', 'Number', 'Level', 'Area', 'drawingId'],
  // Legacy aliases (same data as IFC tables)
  piles: ['id', 'ifcType', 'Reference', 'Diameter', 'nr', 'label', 'pileNumber', 'type', 'shape', 'method', 'diameter', 'x', 'y', 'puntniveauNAP', 'cutoffLevel', 'tipLevel', 'bkPaalPeil', 'pileTypeId', 'contourType', 'fillPattern', 'cptId', 'drawingId', 'layerId'],
  walls: ['id', 'ifcType', 'Reference', 'Width', 'Length', 'Height', 'wallTypeId', 'thickness', 'length', 'height', 'material', 'drawingId'],
  beams: ['id', 'ifcType', 'Reference', 'Span', 'ProfileType', 'Material', 'presetName', 'presetId', 'material', 'width', 'height', 'length', 'drawingId'],
  slabs: ['id', 'ifcType', 'Reference', 'Depth', 'Material', 'thickness', 'material', 'drawingId'],
  cpts: ['id', 'ifcType', 'ObjectType', 'name', 'x', 'y', 'depth', 'kleefmeting', 'waterspanning', 'uitgevoerd', 'drawingId'],
  puntniveaus: ['id', 'ifcType', 'ObjectType', 'puntniveauNAP', 'drawingId'],
  gridlines: ['id', 'ifcType', 'label', 'drawingId'],
  shapes: ['id', 'type', 'ifcType', 'drawingId', 'layerId', 'visible', 'locked'],
};
