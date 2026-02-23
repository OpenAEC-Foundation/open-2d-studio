/**
 * Wall System Service
 *
 * Provides computation and manipulation functions for multi-layered wall assemblies.
 * Works with WallSystemType definitions and WallShape instances.
 */

import type {
  WallShape,
  WallSystemType,
  WallSystemLayer,
  WallSystemStud,
  WallSystemPanel,
  WallSystemOpening,
  Point,
} from '../../types/geometry';

// ============================================================================
// Layer offset calculation
// ============================================================================

/**
 * Calculate layer offsets from the wall centerline.
 * Distributes layers symmetrically around the center (offset = 0).
 * Returns a new array with updated offset values.
 */
export function calculateLayerOffsets(system: WallSystemType): WallSystemLayer[] {
  const total = calculateTotalThickness(system);
  let currentOffset = -total / 2;

  return system.layers.map(layer => {
    const layerCenter = currentOffset + layer.thickness / 2;
    currentOffset += layer.thickness;
    return { ...layer, offset: layerCenter };
  });
}

/**
 * Calculate total thickness by summing all layer thicknesses.
 */
export function calculateTotalThickness(system: WallSystemType): number {
  return system.layers.reduce((sum, layer) => sum + layer.thickness, 0);
}

// ============================================================================
// Grid computation
// ============================================================================

/** Computed grid cell info */
export interface WallGridCell {
  col: number;
  row: number;
  /** Start position along the wall in mm */
  startAlongWall: number;
  /** End position along the wall in mm */
  endAlongWall: number;
  /** Start position vertically (for future 3D/section views) */
  startVertical: number;
  /** End position vertically */
  endVertical: number;
  /** Cell key for override lookup (e.g. "2-0") */
  key: string;
}

/** Computed stud position info */
export interface WallStudPosition {
  col: number;
  row: number;
  /** Position along the wall in mm from start */
  positionAlongWall: number;
  /** Stud center position in world coords */
  worldPosition: Point;
  /** Stud definition to use (after overrides) */
  stud: WallSystemStud;
  /** Cell key */
  key: string;
}

/** Computed panel position info */
export interface WallPanelPosition {
  col: number;
  row: number;
  /** Start position along wall in mm from start */
  startAlongWall: number;
  /** End position along wall in mm from start */
  endAlongWall: number;
  /** Panel center in world coords */
  worldCenter: Point;
  /** Panel definition to use (after overrides) */
  panel: WallSystemPanel;
  /** Cell key */
  key: string;
}

/**
 * Generate grid positions along a wall based on the wall system's grid settings.
 * Returns arrays of stud positions and panel cells.
 */
export function generateWallSystemGrid(
  wall: WallShape,
  system: WallSystemType
): { studs: WallStudPosition[]; panels: WallPanelPosition[]; cells: WallGridCell[] } {
  const dx = wall.end.x - wall.start.x;
  const dy = wall.end.y - wall.start.y;
  const wallLength = Math.sqrt(dx * dx + dy * dy);
  const wallAngle = Math.atan2(dy, dx);

  // Unit vectors
  const dirX = Math.cos(wallAngle);
  const dirY = Math.sin(wallAngle);

  const grid = system.grid;
  const studs: WallStudPosition[] = [];
  const panels: WallPanelPosition[] = [];
  const cells: WallGridCell[] = [];

  // Vertical divisions (along wall length)
  const verticalPositions = computeGridPositions(wallLength, grid.verticalSpacing, grid.customVerticalLines);

  // Horizontal divisions (wall height - single row for plan view; for section: use horizontalSpacing)
  // In plan view we only have one row (row=0)
  const numRows = 1;

  for (let col = 0; col < verticalPositions.length; col++) {
    const pos = verticalPositions[col];

    for (let row = 0; row < numRows; row++) {
      const key = `${col}-${row}`;

      // Stud at this grid line
      const stud = getStudAtPosition(wall, system, col, row);
      const worldX = wall.start.x + dirX * pos;
      const worldY = wall.start.y + dirY * pos;

      studs.push({
        col,
        row,
        positionAlongWall: pos,
        worldPosition: { x: worldX, y: worldY },
        stud,
        key,
      });
    }
  }

  // Panels between studs
  for (let col = 0; col < verticalPositions.length - 1; col++) {
    const startPos = verticalPositions[col];
    const endPos = verticalPositions[col + 1];

    for (let row = 0; row < numRows; row++) {
      const key = `${col}-${row}`;
      const panel = getPanelAtPosition(wall, system, col, row);
      const centerPos = (startPos + endPos) / 2;
      const worldX = wall.start.x + dirX * centerPos;
      const worldY = wall.start.y + dirY * centerPos;

      panels.push({
        col,
        row,
        startAlongWall: startPos,
        endAlongWall: endPos,
        worldCenter: { x: worldX, y: worldY },
        panel,
        key,
      });

      cells.push({
        col,
        row,
        startAlongWall: startPos,
        endAlongWall: endPos,
        startVertical: 0,
        endVertical: 0,
        key,
      });
    }
  }

  return { studs, panels, cells };
}

/**
 * Compute evenly-spaced grid line positions along a given length.
 * Always includes start (0) and end (length) positions.
 * Custom lines (as 0-1 fractions) are merged in.
 */
function computeGridPositions(length: number, spacing: number, customLines: number[]): number[] {
  const positions: Set<number> = new Set();

  // Always include start and end
  positions.add(0);
  positions.add(length);

  // Regular spacing
  if (spacing > 0) {
    const count = Math.floor(length / spacing);
    for (let i = 1; i <= count; i++) {
      const pos = i * spacing;
      if (pos < length) {
        positions.add(pos);
      }
    }
  }

  // Custom lines (fractions 0-1)
  for (const frac of customLines) {
    const pos = frac * length;
    if (pos > 0 && pos < length) {
      positions.add(Math.round(pos * 100) / 100); // avoid floating point noise
    }
  }

  return Array.from(positions).sort((a, b) => a - b);
}

// ============================================================================
// Stud / Panel lookup with overrides
// ============================================================================

/**
 * Get the stud type at a specific grid position, checking instance and type overrides.
 */
export function getStudAtPosition(
  wall: WallShape,
  system: WallSystemType,
  col: number,
  row: number
): WallSystemStud {
  const key = `${col}-${row}`;

  // 1. Instance-level override
  const instanceOverrideId = wall.wallSystemStudOverrides?.[key];
  if (instanceOverrideId) {
    const found = findStudById(system, instanceOverrideId);
    if (found) return found;
  }

  // 2. Type-level override
  const typeOverrideId = system.studOverrides[key];
  if (typeOverrideId) {
    const found = findStudById(system, typeOverrideId);
    if (found) return found;
  }

  // 3. Default stud
  return system.defaultStud;
}

/**
 * Get the panel type at a specific grid position, checking instance and type overrides.
 */
export function getPanelAtPosition(
  wall: WallShape,
  system: WallSystemType,
  col: number,
  row: number
): WallSystemPanel {
  const key = `${col}-${row}`;

  // 1. Instance-level override
  const instanceOverrideId = wall.wallSystemPanelOverrides?.[key];
  if (instanceOverrideId) {
    const found = findPanelById(system, instanceOverrideId);
    if (found) return found;
  }

  // 2. Type-level override
  const typeOverrideId = system.panelOverrides[key];
  if (typeOverrideId) {
    const found = findPanelById(system, typeOverrideId);
    if (found) return found;
  }

  // 3. Default panel
  return system.defaultPanel;
}

// ============================================================================
// Stud / Panel replacement
// ============================================================================

/**
 * Replace a stud at a specific grid position (returns updated override map).
 */
export function replaceStud(
  wall: WallShape,
  col: number,
  row: number,
  newStudId: string
): Record<string, string> {
  const key = `${col}-${row}`;
  const overrides = { ...(wall.wallSystemStudOverrides || {}) };
  overrides[key] = newStudId;
  return overrides;
}

/**
 * Replace a panel at a specific grid position (returns updated override map).
 */
export function replacePanel(
  wall: WallShape,
  col: number,
  row: number,
  newPanelId: string
): Record<string, string> {
  const key = `${col}-${row}`;
  const overrides = { ...(wall.wallSystemPanelOverrides || {}) };
  overrides[key] = newPanelId;
  return overrides;
}

// ============================================================================
// Opening management
// ============================================================================

/**
 * Add an opening to a wall (returns new openings array).
 */
export function addOpening(
  wall: WallShape,
  opening: WallSystemOpening
): WallSystemOpening[] {
  return [...(wall.wallSystemOpenings || []), opening];
}

/**
 * Remove an opening by ID (returns new openings array).
 */
export function removeOpening(
  wall: WallShape,
  openingId: string
): WallSystemOpening[] {
  return (wall.wallSystemOpenings || []).filter(o => o.id !== openingId);
}

/**
 * Update an opening (returns new openings array).
 */
export function updateOpening(
  wall: WallShape,
  openingId: string,
  updates: Partial<WallSystemOpening>
): WallSystemOpening[] {
  return (wall.wallSystemOpenings || []).map(o =>
    o.id === openingId ? { ...o, ...updates } : o
  );
}

// ============================================================================
// Sub-element hit testing (for selection)
// ============================================================================

/** Type of wall system sub-element */
export type WallSubElementType = 'stud' | 'panel' | 'opening';

/** A reference to a specific sub-element within a wall system */
export interface WallSubElement {
  type: WallSubElementType;
  key: string;       // Grid cell key "col-row" or opening ID
  col?: number;
  row?: number;
  openingId?: string;
}

/**
 * Hit-test a point against wall system sub-elements.
 * Returns the sub-element under the point, or null if none.
 *
 * @param worldPoint - Point in world coordinates
 * @param wall - The wall shape
 * @param system - The wall system type
 * @param tolerance - Hit tolerance in world units
 */
export function hitTestWallSubElement(
  worldPoint: Point,
  wall: WallShape,
  system: WallSystemType,
  tolerance: number = 10
): WallSubElement | null {
  const { studs, panels } = generateWallSystemGrid(wall, system);
  const wallAngle = Math.atan2(wall.end.y - wall.start.y, wall.end.x - wall.start.x);
  const perpX = Math.sin(wallAngle);
  const perpY = -Math.cos(wallAngle);

  // Check studs first (smaller, higher priority)
  for (const studPos of studs) {
    const halfW = studPos.stud.width / 2;
    const halfD = studPos.stud.depth / 2;

    // Transform point to stud local coordinates
    const dx = worldPoint.x - studPos.worldPosition.x;
    const dy = worldPoint.y - studPos.worldPosition.y;
    const along = dx * Math.cos(wallAngle) + dy * Math.sin(wallAngle);
    const perp = dx * perpX + dy * perpY;

    if (Math.abs(along) <= halfW + tolerance && Math.abs(perp) <= halfD + tolerance) {
      return { type: 'stud', key: studPos.key, col: studPos.col, row: studPos.row };
    }
  }

  // Check panels
  for (const panelPos of panels) {
    const halfThick = wall.thickness / 2;

    // Check if point is within the panel rectangle
    const dx = worldPoint.x - panelPos.worldCenter.x;
    const dy = worldPoint.y - panelPos.worldCenter.y;
    const along = dx * Math.cos(wallAngle) + dy * Math.sin(wallAngle);
    const perp = dx * perpX + dy * perpY;
    const halfLen = (panelPos.endAlongWall - panelPos.startAlongWall) / 2;

    if (Math.abs(along) <= halfLen + tolerance && Math.abs(perp) <= halfThick + tolerance) {
      return { type: 'panel', key: panelPos.key, col: panelPos.col, row: panelPos.row };
    }
  }

  return null;
}

// ============================================================================
// Utility helpers
// ============================================================================

function findStudById(system: WallSystemType, id: string): WallSystemStud | undefined {
  if (system.defaultStud.id === id) return system.defaultStud;
  return system.alternateStuds.find(s => s.id === id);
}

function findPanelById(system: WallSystemType, id: string): WallSystemPanel | undefined {
  if (system.defaultPanel.id === id) return system.defaultPanel;
  return system.alternatePanels.find(p => p.id === id);
}

/**
 * Get all available studs for a wall system (default + alternates).
 */
export function getAllStuds(system: WallSystemType): WallSystemStud[] {
  return [system.defaultStud, ...system.alternateStuds];
}

/**
 * Get all available panels for a wall system (default + alternates).
 */
export function getAllPanels(system: WallSystemType): WallSystemPanel[] {
  return [system.defaultPanel, ...system.alternatePanels];
}

/**
 * Create a deep clone of a wall system type with new IDs.
 */
export function cloneWallSystemType(system: WallSystemType, newId: string, newName: string): WallSystemType {
  return {
    ...structuredClone(system),
    id: newId,
    name: newName,
  };
}
