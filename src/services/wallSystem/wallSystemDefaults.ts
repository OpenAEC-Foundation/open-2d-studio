/**
 * Default Wall System Type definitions
 *
 * Provides predefined multi-layered wall assemblies:
 * - HSB (Hout Skelet Bouw / timber frame)
 * - Metal stud (drywall) systems
 * - Curtain wall / vliesgevel
 * - Masonry cavity wall / spouwmuur
 */

import type {
  WallSystemType,
  WallSystemLayer,
  WallSystemStud,
  WallSystemPanel,
  WallSystemGrid,
} from '../../types/geometry';

// ============================================================================
// Helper: generate unique IDs for sub-elements
// ============================================================================

let _idCounter = 0;
function wsId(prefix: string): string {
  return `${prefix}-${++_idCounter}`;
}

// Reset counter (for deterministic IDs in defaults)
function resetIds(): void { _idCounter = 0; }

// ============================================================================
// Shared stud profiles
// ============================================================================

function timberStud(width: number, depth: number, layerIds: string[]): WallSystemStud {
  return {
    id: wsId('stud'),
    name: `Timber stud ${width}x${depth}`,
    width,
    depth,
    material: 'timber',
    profile: 'rectangular',
    color: '#c4a66a',
    layerIds,
  };
}

function metalStud(name: string, width: number, depth: number, layerIds: string[]): WallSystemStud {
  return {
    id: wsId('stud'),
    name,
    width,
    depth,
    material: 'steel',
    profile: 'c-channel',
    color: '#a0a0a0',
    layerIds,
  };
}

function aluminumMullion(width: number, depth: number, layerIds: string[]): WallSystemStud {
  return {
    id: wsId('stud'),
    name: `Aluminum mullion ${width}x${depth}`,
    width,
    depth,
    material: 'aluminum',
    profile: 'rectangular',
    color: '#b0b0b0',
    layerIds,
  };
}

// ============================================================================
// Shared panel types
// ============================================================================

const insulationPanel: WallSystemPanel = {
  id: 'panel-insulation',
  name: 'Insulation',
  material: 'insulation',
  thickness: 0, // filled between studs
  color: '#ffe066',
  opacity: 1,
  hatchPattern: 'insulation',
};

const glassPanel: WallSystemPanel = {
  id: 'panel-glass',
  name: 'Glass panel',
  material: 'glass',
  thickness: 24,
  color: '#a8d8ea',
  opacity: 0.3,
};

const spandrelPanel: WallSystemPanel = {
  id: 'panel-spandrel',
  name: 'Spandrel panel',
  material: 'aluminum',
  thickness: 6,
  color: '#606060',
  opacity: 1,
};

const plasterboardPanel: WallSystemPanel = {
  id: 'panel-plasterboard',
  name: 'Plasterboard',
  material: 'gypsum',
  thickness: 12.5,
  color: '#e8e0d0',
  opacity: 1,
};

// ============================================================================
// Default grid
// ============================================================================

function defaultGrid(verticalSpacing: number, horizontalSpacing: number = 0): WallSystemGrid {
  return {
    verticalSpacing,
    verticalJustification: 'center',
    horizontalSpacing,
    horizontalJustification: 'center',
    customVerticalLines: [],
    customHorizontalLines: [],
  };
}

// ============================================================================
// HSB 140mm - Houtskeletbouw (Timber frame)
// ============================================================================

function createHSB140(): WallSystemType {
  resetIds();

  const structureLayerId = wsId('layer');
  const layers: WallSystemLayer[] = [
    { id: wsId('layer'), name: 'Outer board (multiplex)', material: 'timber', thickness: 12, offset: 0, function: 'substrate', color: '#a08050' },
    { id: wsId('layer'), name: 'Air cavity', material: 'air', thickness: 20, offset: 0, function: 'air-gap', color: '#e0e8f0' },
    { id: structureLayerId, name: 'Insulation + studs 38x140', material: 'insulation', thickness: 140, offset: 0, function: 'structure', color: '#ffe066' },
    { id: wsId('layer'), name: 'Vapor barrier (PE foil)', material: 'membrane', thickness: 0.2, offset: 0, function: 'membrane', color: '#4080ff' },
    { id: wsId('layer'), name: 'Inner board (gypsum)', material: 'gypsum', thickness: 12.5, offset: 0, function: 'finish', color: '#e8e0d0' },
  ];

  const stud = timberStud(38, 140, [structureLayerId]);

  return {
    id: 'ws-hsb-140',
    name: 'HSB 140mm',
    category: 'timber-frame',
    totalThickness: 184.7,
    layers,
    defaultStud: stud,
    alternateStuds: [
      { ...timberStud(45, 140, [structureLayerId]), id: wsId('stud'), name: 'Timber stud 45x140' },
      { ...timberStud(38, 120, [structureLayerId]), id: wsId('stud'), name: 'Timber stud 38x120' },
    ],
    defaultPanel: insulationPanel,
    alternatePanels: [plasterboardPanel],
    grid: defaultGrid(600),
    studOverrides: {},
    panelOverrides: {},
  };
}

// ============================================================================
// HSB 184mm - Deeper timber frame
// ============================================================================

function createHSB184(): WallSystemType {
  resetIds();

  const structureLayerId = wsId('layer');
  const layers: WallSystemLayer[] = [
    { id: wsId('layer'), name: 'Outer board (multiplex)', material: 'timber', thickness: 15, offset: 0, function: 'substrate', color: '#a08050' },
    { id: wsId('layer'), name: 'Air cavity', material: 'air', thickness: 25, offset: 0, function: 'air-gap', color: '#e0e8f0' },
    { id: structureLayerId, name: 'Insulation + studs 38x184', material: 'insulation', thickness: 184, offset: 0, function: 'structure', color: '#ffe066' },
    { id: wsId('layer'), name: 'Vapor barrier (PE foil)', material: 'membrane', thickness: 0.2, offset: 0, function: 'membrane', color: '#4080ff' },
    { id: wsId('layer'), name: 'Inner board (gypsum)', material: 'gypsum', thickness: 12.5, offset: 0, function: 'finish', color: '#e8e0d0' },
  ];

  const stud = timberStud(38, 184, [structureLayerId]);

  return {
    id: 'ws-hsb-184',
    name: 'HSB 184mm',
    category: 'timber-frame',
    totalThickness: 236.7,
    layers,
    defaultStud: stud,
    alternateStuds: [
      { ...timberStud(45, 184, [structureLayerId]), id: wsId('stud'), name: 'Timber stud 45x184' },
    ],
    defaultPanel: insulationPanel,
    alternatePanels: [plasterboardPanel],
    grid: defaultGrid(600),
    studOverrides: {},
    panelOverrides: {},
  };
}

// ============================================================================
// Metal Stud CW75
// ============================================================================

function createMetalStudCW75(): WallSystemType {
  resetIds();

  const structureLayerId = wsId('layer');
  const layers: WallSystemLayer[] = [
    { id: wsId('layer'), name: 'Plasterboard (outer)', material: 'gypsum', thickness: 12.5, offset: 0, function: 'finish', color: '#e8e0d0' },
    { id: wsId('layer'), name: 'Plasterboard (outer 2)', material: 'gypsum', thickness: 12.5, offset: 0, function: 'finish', color: '#e0d8c8' },
    { id: structureLayerId, name: 'CW75 studs + insulation', material: 'insulation', thickness: 75, offset: 0, function: 'structure', color: '#ffe066' },
    { id: wsId('layer'), name: 'Plasterboard (inner)', material: 'gypsum', thickness: 12.5, offset: 0, function: 'finish', color: '#e8e0d0' },
  ];

  const stud = metalStud('CW75 metal stud', 50, 75, [structureLayerId]);

  return {
    id: 'ws-metal-cw75',
    name: 'Metal Stud CW75',
    category: 'metal-stud',
    totalThickness: 112.5,
    layers,
    defaultStud: stud,
    alternateStuds: [
      { ...metalStud('CW75 UA stud (reinforced)', 50, 75, [structureLayerId]), id: wsId('stud') },
    ],
    defaultPanel: insulationPanel,
    alternatePanels: [plasterboardPanel],
    grid: defaultGrid(600),
    studOverrides: {},
    panelOverrides: {},
  };
}

// ============================================================================
// Metal Stud CW100
// ============================================================================

function createMetalStudCW100(): WallSystemType {
  resetIds();

  const structureLayerId = wsId('layer');
  const layers: WallSystemLayer[] = [
    { id: wsId('layer'), name: 'Plasterboard (outer)', material: 'gypsum', thickness: 12.5, offset: 0, function: 'finish', color: '#e8e0d0' },
    { id: wsId('layer'), name: 'Plasterboard (outer 2)', material: 'gypsum', thickness: 12.5, offset: 0, function: 'finish', color: '#e0d8c8' },
    { id: structureLayerId, name: 'CW100 studs + insulation', material: 'insulation', thickness: 100, offset: 0, function: 'structure', color: '#ffe066' },
    { id: wsId('layer'), name: 'Plasterboard (inner)', material: 'gypsum', thickness: 12.5, offset: 0, function: 'finish', color: '#e8e0d0' },
  ];

  const stud = metalStud('CW100 metal stud', 50, 100, [structureLayerId]);

  return {
    id: 'ws-metal-cw100',
    name: 'Metal Stud CW100',
    category: 'metal-stud',
    totalThickness: 137.5,
    layers,
    defaultStud: stud,
    alternateStuds: [
      { ...metalStud('CW100 UA stud (reinforced)', 50, 100, [structureLayerId]), id: wsId('stud') },
    ],
    defaultPanel: insulationPanel,
    alternatePanels: [plasterboardPanel],
    grid: defaultGrid(600),
    studOverrides: {},
    panelOverrides: {},
  };
}

// ============================================================================
// Curtain Wall / Vliesgevel
// ============================================================================

function createCurtainWall(): WallSystemType {
  resetIds();

  const structureLayerId = wsId('layer');
  const layers: WallSystemLayer[] = [
    { id: structureLayerId, name: 'Mullion frame + glass', material: 'aluminum', thickness: 60, offset: 0, function: 'structure', color: '#b0b0b0' },
  ];

  const mullion = aluminumMullion(50, 60, [structureLayerId]);

  return {
    id: 'ws-curtain-wall',
    name: 'Curtain Wall',
    category: 'curtain-wall',
    totalThickness: 60,
    layers,
    defaultStud: mullion,
    alternateStuds: [
      { ...aluminumMullion(60, 80, [structureLayerId]), id: wsId('stud'), name: 'Aluminum mullion 60x80 (heavy)' },
    ],
    defaultPanel: glassPanel,
    alternatePanels: [spandrelPanel, insulationPanel],
    grid: defaultGrid(1200, 3000),
    studOverrides: {},
    panelOverrides: {},
  };
}

// ============================================================================
// Masonry Cavity Wall / Spouwmuur
// ============================================================================

function createMasonryCavityWall(): WallSystemType {
  resetIds();

  const outerLeafLayerId = wsId('layer');
  const innerLeafLayerId = wsId('layer');
  const layers: WallSystemLayer[] = [
    { id: outerLeafLayerId, name: 'Brick outer leaf', material: 'masonry', thickness: 100, offset: 0, function: 'finish', color: '#c87040' },
    { id: wsId('layer'), name: 'Cavity (air)', material: 'air', thickness: 50, offset: 0, function: 'air-gap', color: '#e0e8f0' },
    { id: wsId('layer'), name: 'Insulation', material: 'insulation', thickness: 100, offset: 0, function: 'insulation', color: '#ffe066' },
    { id: innerLeafLayerId, name: 'Inner leaf (calc. silicate)', material: 'calcium-silicate', thickness: 100, offset: 0, function: 'structure', color: '#d0d0d0' },
  ];

  // Masonry walls don't have studs in the traditional sense, but we model wall ties
  const wallTie: WallSystemStud = {
    id: wsId('stud'),
    name: 'Wall tie (spouwanker)',
    width: 4,
    depth: 250,
    material: 'steel',
    profile: 'rectangular',
    color: '#808080',
    layerIds: [outerLeafLayerId, innerLeafLayerId],
  };

  // The "panel" in masonry is the brick infill itself
  const brickPanel: WallSystemPanel = {
    id: wsId('panel'),
    name: 'Brick infill',
    material: 'masonry',
    thickness: 100,
    color: '#c87040',
    opacity: 1,
    hatchPattern: 'diagonal',
  };

  return {
    id: 'ws-masonry-cavity',
    name: 'Masonry Cavity Wall',
    category: 'masonry',
    totalThickness: 350,
    layers,
    defaultStud: wallTie,
    alternateStuds: [],
    defaultPanel: brickPanel,
    alternatePanels: [insulationPanel],
    grid: defaultGrid(600, 0),
    studOverrides: {},
    panelOverrides: {},
  };
}

// ============================================================================
// Export all defaults
// ============================================================================

/** All built-in wall system types */
export function getDefaultWallSystemTypes(): WallSystemType[] {
  return [
    createHSB140(),
    createHSB184(),
    createMetalStudCW75(),
    createMetalStudCW100(),
    createCurtainWall(),
    createMasonryCavityWall(),
  ];
}

/** Get a single default wall system type by ID */
export function getDefaultWallSystemType(id: string): WallSystemType | undefined {
  return getDefaultWallSystemTypes().find(ws => ws.id === id);
}
