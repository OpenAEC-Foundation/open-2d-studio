/**
 * Default Grouped Wall Type definitions
 *
 * Grouped walls are wall assemblies that consist of multiple individual wall shapes
 * drawn as one action. For example, a cavity wall (spouwmuur) with:
 *   - Metselwerk (masonry) 100mm
 *   - Spouw (cavity/air gap) 40mm
 *   - Isolatie PIR 100mm (insulation - not drawn as wall)
 *   - Kalkzandsteen (calcium silicate) 120mm
 *
 * When the user draws ONE grouped wall, it creates multiple separate wall shapes
 * (the drawn layers), grouped together via groupId.
 */

import type { GroupedWallType, GroupedWallLayer, WallType } from '../../types/geometry';

// ============================================================================
// Helper to create layers
// ============================================================================

function layer(
  id: string,
  name: string,
  wallTypeId: string,
  thickness: number,
  gap: number,
  isDrawn: boolean
): GroupedWallLayer {
  return { id, name, wallTypeId, thickness, gap, isDrawn };
}

function calcTotal(layers: GroupedWallLayer[]): number {
  return layers.reduce((sum, l) => sum + l.thickness + l.gap, 0);
}

// ============================================================================
// Additional wall types needed for grouped wall layers
// ============================================================================

/**
 * Extra WallType definitions that grouped walls reference but may not exist
 * in the default wallTypes list. These should be merged into the wallTypes
 * array if they don't already exist.
 */
export const GROUPED_WALL_EXTRA_TYPES: WallType[] = [
  { id: 'gevelbekleding-20', name: 'Gevelbekleding', thickness: 20, material: 'timber' },
  { id: 'osb-12', name: 'OSB', thickness: 12, material: 'timber' },
  { id: 'hsb-stijl-140', name: 'HSB stijl+isolatie', thickness: 140, material: 'timber' },
  { id: 'gipsplaat-12', name: 'Gipsplaat', thickness: 12.5, material: 'generic' },
  { id: 'metalstud-75', name: 'Metal stud CW75+isolatie', thickness: 75, material: 'steel' },
];

// ============================================================================
// Default Grouped Wall Types
// ============================================================================

const spouwmuur360Layers: GroupedWallLayer[] = [
  layer('gwl-s360-1', 'Metselwerk',    'metselwerk-100', 100, 40,  true),   // 100mm masonry + 40mm cavity
  layer('gwl-s360-2', 'Isolatie PIR',  'isolatie-184',   100, 0,   false),  // 100mm insulation (not drawn, fills gap)
  layer('gwl-s360-3', 'Kalkzandsteen', 'kzst-100',       120, 0,   true),   // 120mm calcium silicate
];

const spouwmuur300Layers: GroupedWallLayer[] = [
  layer('gwl-s300-1', 'Metselwerk',    'metselwerk-100', 100, 30,  true),   // 100mm masonry + 30mm cavity
  layer('gwl-s300-2', 'Isolatie',      'isolatie-184',   50,  0,   false),  // 50mm insulation (not drawn)
  layer('gwl-s300-3', 'Kalkzandsteen', 'kzst-100',       120, 0,   true),   // 120mm calcium silicate
];

const hsbBuitenwandLayers: GroupedWallLayer[] = [
  layer('gwl-hsb-1', 'Gevelbekleding',    'gevelbekleding-20',  20,  20,  true),   // 20mm cladding + 20mm ventilated cavity
  layer('gwl-hsb-2', 'OSB',               'osb-12',             12,  0,   true),   // 12mm OSB sheathing
  layer('gwl-hsb-3', 'HSB stijl+isolatie','hsb-stijl-140',      140, 0,   true),   // 140mm timber frame + insulation
  layer('gwl-hsb-4', 'Dampremmer',        'isolatie-184',       0,   0,   false),  // Vapour barrier (not drawn, zero thickness)
  layer('gwl-hsb-5', 'Gipsplaat',         'gipsplaat-12',       12.5,0,   true),   // 12.5mm plasterboard
];

const metalStudBinnenwandLayers: GroupedWallLayer[] = [
  layer('gwl-ms-1', 'Gipsplaat',              'gipsplaat-12',  12.5, 0, true),   // 12.5mm plasterboard
  layer('gwl-ms-2', 'Metal stud CW75+isolatie','metalstud-75', 75,   0, true),   // 75mm metal stud + insulation
  layer('gwl-ms-3', 'Gipsplaat',              'gipsplaat-12',  12.5, 0, true),   // 12.5mm plasterboard
];

const massieveBinnenwandLayers: GroupedWallLayer[] = [
  layer('gwl-mb-1', 'Kalkzandsteen', 'kzst-100', 100, 0, true),  // 100mm calcium silicate (single layer)
];

// ============================================================================
// Assembled grouped wall type definitions
// ============================================================================

export const DEFAULT_GROUPED_WALL_TYPES: GroupedWallType[] = [
  {
    id: 'gwt-spouwmuur-360',
    name: 'Spouwmuur 360mm',
    layers: spouwmuur360Layers,
    totalThickness: calcTotal(spouwmuur360Layers),
    alignmentLine: 'exterior',
  },
  {
    id: 'gwt-spouwmuur-300',
    name: 'Spouwmuur 300mm',
    layers: spouwmuur300Layers,
    totalThickness: calcTotal(spouwmuur300Layers),
    alignmentLine: 'exterior',
  },
  {
    id: 'gwt-hsb-buitenwand',
    name: 'HSB Buitenwand',
    layers: hsbBuitenwandLayers,
    totalThickness: calcTotal(hsbBuitenwandLayers),
    alignmentLine: 'exterior',
  },
  {
    id: 'gwt-metalstud-binnenwand',
    name: 'Metal Stud Binnenwand',
    layers: metalStudBinnenwandLayers,
    totalThickness: calcTotal(metalStudBinnenwandLayers),
    alignmentLine: 'center',
  },
  {
    id: 'gwt-massieve-binnenwand',
    name: 'Massieve Binnenwand',
    layers: massieveBinnenwandLayers,
    totalThickness: calcTotal(massieveBinnenwandLayers),
    alignmentLine: 'center',
  },
];
