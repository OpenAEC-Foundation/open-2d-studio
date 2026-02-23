/**
 * gridlineUtils - Shared utilities for gridline operations
 *
 * Extracted from PropertiesPanel for reuse in the canvas "+" button overlay.
 *
 * Structural engineering convention:
 *   - Horizontal gridlines (|dx| > |dy|) use LETTER labels: A, B, C, ...
 *   - Vertical gridlines   (|dy| > |dx|) use NUMBER labels: 1, 2, 3, ...
 *   - Angled gridlines (neither H nor V)  use LETTER+NUMBER labels: A1, B1, C1, ...
 *     Each distinct angle group gets its own number suffix (1, 2, 3...).
 */

import type { GridlineShape } from '../types/geometry';
import { useAppStore } from '../state/appStore';

/**
 * Parse a gridline spacing pattern like "4000 3000 5x5400"
 * Returns cumulative offsets in mm.
 */
export function parseSpacingPattern(pattern: string): number[] | null {
  const tokens = pattern.trim().split(/\s+/);
  if (tokens.length === 0 || (tokens.length === 1 && tokens[0] === '')) return null;
  const offsets: number[] = [];
  let cumulative = 0;
  for (const token of tokens) {
    const repeatMatch = token.match(/^(\d+)[xX](\d+(?:\.\d+)?)$/);
    if (repeatMatch) {
      const count = parseInt(repeatMatch[1], 10);
      const dist = parseFloat(repeatMatch[2]);
      if (count <= 0 || dist <= 0 || isNaN(dist)) return null;
      for (let i = 0; i < count; i++) {
        cumulative += dist;
        offsets.push(cumulative);
      }
    } else {
      const dist = parseFloat(token);
      if (isNaN(dist) || dist <= 0) return null;
      cumulative += dist;
      offsets.push(cumulative);
    }
  }
  return offsets.length > 0 ? offsets : null;
}

/** Increment a gridline label: "1"->"2", "A"->"B", "Z"->"AA" */
export function incrementGridLabel(label: string): string {
  if (/^\d+$/.test(label)) return String(Number(label) + 1);
  if (/^[A-Z]+$/.test(label)) {
    const chars = label.split('');
    let carry = true;
    for (let i = chars.length - 1; i >= 0 && carry; i--) {
      if (chars[i].charCodeAt(0) < 90) { chars[i] = String.fromCharCode(chars[i].charCodeAt(0) + 1); carry = false; }
      else chars[i] = 'A';
    }
    if (carry) chars.unshift('A');
    return chars.join('');
  }
  if (/^[a-z]+$/.test(label)) {
    const chars = label.split('');
    let carry = true;
    for (let i = chars.length - 1; i >= 0 && carry; i--) {
      if (chars[i].charCodeAt(0) < 122) { chars[i] = String.fromCharCode(chars[i].charCodeAt(0) + 1); carry = false; }
      else chars[i] = 'a';
    }
    if (carry) chars.unshift('a');
    return chars.join('');
  }
  const trailingNum = label.match(/^(.*?)(\d+)$/);
  if (trailingNum) return trailingNum[1] + String(Number(trailingNum[2]) + 1);
  return label + '2';
}

/**
 * Determine if a gridline is horizontal based on its start/end points.
 * A gridline is "horizontal" when |dx| > |dy| (the line runs left-right).
 * Horizontal gridlines use letter labels (A, B, C...).
 * Vertical gridlines use number labels (1, 2, 3...).
 */
export function isGridlineHorizontal(start: { x: number; y: number }, end: { x: number; y: number }): boolean {
  const dx = Math.abs(end.x - start.x);
  const dy = Math.abs(end.y - start.y);
  return dx > dy;
}

/** Angle tolerance in degrees — gridlines within this of 0°/90° are axis-aligned */
const ANGLE_TOLERANCE_DEG = 5;

/**
 * Classify a gridline orientation: 'horizontal', 'vertical', or 'angled'.
 * A gridline is "angled" when its angle is more than ANGLE_TOLERANCE_DEG away
 * from both the horizontal and vertical axes.
 */
export type GridlineOrientation = 'horizontal' | 'vertical' | 'angled';

export function classifyGridlineOrientation(
  start: { x: number; y: number },
  end: { x: number; y: number },
): GridlineOrientation {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const angleDeg = Math.abs(Math.atan2(dy, dx) * 180 / Math.PI);
  // Normalize to 0-90 range
  const fromHorizontal = angleDeg > 90 ? 180 - angleDeg : angleDeg;
  if (fromHorizontal <= ANGLE_TOLERANCE_DEG) return 'horizontal';
  if (fromHorizontal >= 90 - ANGLE_TOLERANCE_DEG) return 'vertical';
  return 'angled';
}

/**
 * Get the normalized angle of a gridline in degrees (0-180 range).
 * Two parallel gridlines (even if drawn in opposite directions) get the same angle.
 */
export function getGridlineAngleDeg(g: GridlineShape): number {
  const dx = g.end.x - g.start.x;
  const dy = g.end.y - g.start.y;
  let angleDeg = Math.atan2(dy, dx) * 180 / Math.PI;
  // Normalize to 0-180 range so opposite directions match
  if (angleDeg < 0) angleDeg += 180;
  if (angleDeg >= 180) angleDeg -= 180;
  return angleDeg;
}

/**
 * Group gridlines by their angle direction (within tolerance).
 * Returns groups where each group contains parallel gridlines.
 */
export function groupGridlinesByAngle(
  gridlines: GridlineShape[],
  toleranceDeg: number = ANGLE_TOLERANCE_DEG,
): GridlineShape[][] {
  const groups: { angle: number; gridlines: GridlineShape[] }[] = [];
  for (const g of gridlines) {
    const angle = getGridlineAngleDeg(g);
    const existingGroup = groups.find(grp =>
      Math.abs(grp.angle - angle) < toleranceDeg ||
      Math.abs(grp.angle - angle - 180) < toleranceDeg ||
      Math.abs(grp.angle - angle + 180) < toleranceDeg
    );
    if (existingGroup) {
      existingGroup.gridlines.push(g);
    } else {
      groups.push({ angle, gridlines: [g] });
    }
  }
  return groups.map(g => g.gridlines);
}

/**
 * Determine the angle group number for angled gridlines in a drawing.
 * The first angled group gets suffix "1", second "2", etc.
 * Returns 0 for non-angled gridlines.
 */
export function getAngledGroupNumber(
  angle: number,
  drawingId: string,
): number {
  const allGridlines = useAppStore.getState().shapes
    .filter((s): s is GridlineShape => s.type === 'gridline' && s.drawingId === drawingId);

  const angledGridlines = allGridlines.filter(g =>
    classifyGridlineOrientation(g.start, g.end) === 'angled'
  );

  if (angledGridlines.length === 0) return 1; // First angled group

  const groups = groupGridlinesByAngle(angledGridlines);

  // Find which group this angle belongs to
  for (let i = 0; i < groups.length; i++) {
    const groupAngle = getGridlineAngleDeg(groups[i][0]);
    if (Math.abs(groupAngle - angle) < ANGLE_TOLERANCE_DEG ||
        Math.abs(groupAngle - angle - 180) < ANGLE_TOLERANCE_DEG ||
        Math.abs(groupAngle - angle + 180) < ANGLE_TOLERANCE_DEG) {
      return i + 1;
    }
  }

  // New angle group
  return groups.length + 1;
}

/** Check if a label is a pure numeric string like "1", "23" */
function isNumericLabel(label: string): boolean {
  return /^\d+$/.test(label);
}

/** Check if a label is a pure uppercase letter string like "A", "AB" */
function isLetterLabel(label: string): boolean {
  return /^[A-Z]+$/.test(label);
}

/** Check if a label is an angled gridline label like "A1", "B2" */
function isAngledLabel(label: string): boolean {
  return /^[A-Z]+\d+$/.test(label);
}

/**
 * Get the next available gridline label based on orientation.
 *
 * Structural engineering convention:
 *   - Horizontal gridlines (line runs left-right)  -> letter labels: A, B, C...
 *   - Vertical gridlines (line runs top-bottom)    -> number labels: 1, 2, 3...
 *   - Angled gridlines (neither H nor V)           -> letter+number: A1, B1, C1...
 *     The number suffix identifies the angle group (e.g. all 30° lines → "1").
 *
 * Considers existing gridlines in the active drawing to find the next unused label.
 *
 * @param currentLabel - The label currently set in the pending gridline state
 * @param orientation - Classification of the gridline
 * @param drawingId - The active drawing ID (to scope label uniqueness)
 * @param angleDeg - Normalized angle in degrees (only needed for 'angled')
 * @returns The correct label to use for this gridline
 */
export function getNextGridlineLabel(
  currentLabel: string,
  orientation: GridlineOrientation | boolean,
  drawingId: string,
  angleDeg?: number,
): string {
  // Backward compat: boolean → orientation string
  const orient: GridlineOrientation = typeof orientation === 'boolean'
    ? (orientation ? 'horizontal' : 'vertical')
    : orientation;

  const existingLabels = new Set(
    useAppStore.getState().shapes
      .filter((s): s is GridlineShape => s.type === 'gridline' && s.drawingId === drawingId)
      .map(g => g.label)
  );

  let label = currentLabel;

  if (orient === 'angled') {
    // Angled gridlines use letter+number labels: A1, B1, C1, ...
    const groupNum = angleDeg !== undefined
      ? getAngledGroupNumber(angleDeg, drawingId)
      : 1;
    // If current label is not already an angled label for this group, start fresh
    if (!isAngledLabel(label) || !label.endsWith(String(groupNum))) {
      label = `A${groupNum}`;
      while (existingLabels.has(label)) label = incrementGridLabel(label);
    }
  } else if (orient === 'horizontal') {
    // User has a number label or angled label but this is horizontal -> switch to letters
    if (isNumericLabel(label) || isAngledLabel(label)) {
      label = 'A';
      while (existingLabels.has(label)) label = incrementGridLabel(label);
    }
  } else {
    // User has a letter label or angled label but this is vertical -> switch to numbers
    if (isLetterLabel(label) || isAngledLabel(label)) {
      label = '1';
      while (existingLabels.has(label)) label = incrementGridLabel(label);
    }
  }

  // Skip any already-used labels in the current series
  while (existingLabels.has(label)) {
    label = incrementGridLabel(label);
  }

  return label;
}

/**
 * Get the next label to queue up after placing a gridline,
 * for the auto-increment behavior. Increments the just-used label
 * and skips any already-taken labels.
 */
export function getNextIncrementedLabel(usedLabel: string, drawingId: string): string {
  const existingLabels = new Set(
    useAppStore.getState().shapes
      .filter((s): s is GridlineShape => s.type === 'gridline' && s.drawingId === drawingId)
      .map(g => g.label)
  );

  let next = incrementGridLabel(usedLabel);
  while (existingLabels.has(next)) {
    next = incrementGridLabel(next);
  }
  return next;
}

/**
 * Create gridlines from a spacing pattern relative to a reference gridline.
 * Returns the new gridline shapes.
 */
export function createGridlinesFromPattern(
  gridline: GridlineShape,
  pattern: string
): GridlineShape[] {
  const offsets = parseSpacingPattern(pattern);
  if (!offsets) return [];

  // Perpendicular direction to the gridline
  const gdx = gridline.end.x - gridline.start.x;
  const gdy = gridline.end.y - gridline.start.y;
  const len = Math.sqrt(gdx * gdx + gdy * gdy);
  if (len === 0) return [];

  // Perpendicular unit vector
  let px = gdy / len;
  let py = -gdx / len;
  const isHorizontal = Math.abs(px) < 1e-9;
  if (isHorizontal) {
    if (py > 0) { px = -px; py = -py; }
  } else {
    if (px < 0) { px = -px; py = -py; }
  }

  let currentLabel = gridline.label;
  const existingLabels = new Set(
    useAppStore.getState().shapes
      .filter((s): s is GridlineShape => s.type === 'gridline')
      .map(g => g.label)
  );

  return offsets.map(offset => {
    currentLabel = incrementGridLabel(currentLabel);
    while (existingLabels.has(currentLabel)) {
      currentLabel = incrementGridLabel(currentLabel);
    }
    existingLabels.add(currentLabel);
    const newId = crypto.randomUUID();
    return {
      ...gridline,
      id: newId,
      label: currentLabel,
      start: { x: gridline.start.x + px * offset, y: gridline.start.y + py * offset },
      end: { x: gridline.end.x + px * offset, y: gridline.end.y + py * offset },
      // Each pattern gridline gets its own projectGridId (will be cloned to other plan drawings by addShapes)
      projectGridId: newId,
    };
  });
}
