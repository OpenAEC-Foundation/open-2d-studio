import type { Point } from '../../types/geometry';
import type { UnitSettings } from '../../units/types';
import { formatNumber as fmtNum } from '../../units/format';

export interface ParsedCoordinate {
  point: Point;
  isRelative: boolean;
  isPolar: boolean;
  /** True if input was just a distance number (requires direction from tracking/mouse) */
  isDirectDistance: boolean;
}

/**
 * Parse coordinate input in various formats:
 * - Absolute: "100,50" or "#100,50"
 * - Relative Cartesian: "@50,25"
 * - Relative Polar: "@100<45" (distance<angle)
 * - Direct distance: "100" (requires direction from mouse)
 */
export function parseCoordinateInput(
  input: string,
  lastPoint: Point | null
): ParsedCoordinate | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  // Check for relative prefix
  const isRelative = trimmed.startsWith('@');
  const isAbsoluteForced = trimmed.startsWith('#');

  // Remove prefix if present
  let coordStr = trimmed;
  if (isRelative || isAbsoluteForced) {
    coordStr = trimmed.slice(1);
  }

  // Try polar format: distance<angle (e.g., "100<45")
  const polarMatch = coordStr.match(/^([\d.]+)<([\d.-]+)$/);
  if (polarMatch) {
    const distance = parseFloat(polarMatch[1]);
    const angleDeg = parseFloat(polarMatch[2]);

    if (isNaN(distance) || isNaN(angleDeg)) return null;

    // Convert angle to radians (degrees, 0 = East, counter-clockwise)
    const angleRad = (angleDeg * Math.PI) / 180;

    const dx = distance * Math.cos(angleRad);
    const dy = distance * Math.sin(angleRad);

    if (isRelative && lastPoint) {
      return {
        point: { x: lastPoint.x + dx, y: lastPoint.y - dy }, // Y is inverted in screen coords
        isRelative: true,
        isPolar: true,
        isDirectDistance: false,
      };
    } else if (!isRelative && !lastPoint) {
      // Absolute polar from origin
      return {
        point: { x: dx, y: -dy },
        isRelative: false,
        isPolar: true,
        isDirectDistance: false,
      };
    } else if (isRelative && !lastPoint) {
      // Relative but no last point - treat as from origin
      return {
        point: { x: dx, y: -dy },
        isRelative: true,
        isPolar: true,
        isDirectDistance: false,
      };
    }

    return {
      point: { x: dx, y: -dy },
      isRelative: false,
      isPolar: true,
      isDirectDistance: false,
    };
  }

  // Try Cartesian format: x,y (e.g., "100,50")
  const cartesianMatch = coordStr.match(/^([\d.-]+)\s*,\s*([\d.-]+)$/);
  if (cartesianMatch) {
    const x = parseFloat(cartesianMatch[1]);
    const y = parseFloat(cartesianMatch[2]);

    if (isNaN(x) || isNaN(y)) return null;

    if (isRelative && lastPoint) {
      return {
        point: { x: lastPoint.x + x, y: lastPoint.y - y }, // negate Y: user Y-up → internal Y-down
        isRelative: true,
        isPolar: false,
        isDirectDistance: false,
      };
    }

    return {
      point: { x, y: -y }, // negate Y: user Y-up → internal Y-down
      isRelative: false,
      isPolar: false,
      isDirectDistance: false,
    };
  }

  // Try single number (direct distance - requires mouse/tracking direction)
  const singleNumber = parseFloat(coordStr);
  if (!isNaN(singleNumber) && coordStr.match(/^[\d.]+$/)) {
    // Return distance only - caller needs to apply direction from tracking angle
    return {
      point: { x: singleNumber, y: 0 }, // x holds the distance
      isRelative: true,
      isPolar: false,
      isDirectDistance: true,
    };
  }

  return null;
}

/**
 * Format a point as a coordinate string
 */
export function formatCoordinate(point: Point, precision: number = 2, unitSettings?: UnitSettings): string {
  const displayY = -point.y; // negate Y: internal Y-down → display Y-up
  if (unitSettings) {
    return `${fmtNum(point.x, precision, unitSettings.numberFormat)}, ${fmtNum(displayY, precision, unitSettings.numberFormat)}`;
  }
  return `${point.x.toFixed(precision)}, ${displayY.toFixed(precision)}`;
}

/**
 * Calculate distance between two points
 */
export function getDistance(p1: Point, p2: Point): number {
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Calculate angle between two points in degrees
 */
export function getAngle(from: Point, to: Point): number {
  const dx = to.x - from.x;
  const dy = -(to.y - from.y); // Invert Y for screen coords
  const angleRad = Math.atan2(dy, dx);
  let angleDeg = (angleRad * 180) / Math.PI;
  if (angleDeg < 0) angleDeg += 360;
  return angleDeg;
}

/**
 * Format distance and angle for display
 */
export function formatPolar(distance: number, angle: number, precision: number = 2, unitSettings?: UnitSettings): string {
  if (unitSettings) {
    return `${fmtNum(distance, precision, unitSettings.numberFormat)} < ${fmtNum(angle, 1, unitSettings.numberFormat)}°`;
  }
  return `${distance.toFixed(precision)} < ${angle.toFixed(1)}°`;
}
