/**
 * Tracking System - AutoCAD-like polar tracking and object tracking
 * Enables drawing lines aligned with existing geometry
 */

import { IPoint, PointUtils } from './Point';
import { ILine, LineUtils } from './Line';

export type TrackingMode = 'polar' | 'ortho' | 'object';

export interface TrackingLine {
  origin: IPoint;
  direction: IPoint;
  angle: number;
  type: 'polar' | 'parallel' | 'perpendicular' | 'extension';
  sourceShapeId?: string;
}

export interface TrackingResult {
  point: IPoint;
  trackingLines: TrackingLine[];
  snapDescription?: string;
}

export interface TrackingSettings {
  enabled: boolean;
  polarEnabled: boolean;
  orthoEnabled: boolean;
  objectTrackingEnabled: boolean;
  polarAngleIncrement: number; // degrees (15, 30, 45, 90)
  trackingTolerance: number; // pixels
}

export const defaultTrackingSettings: TrackingSettings = {
  enabled: true,
  polarEnabled: true,
  orthoEnabled: false,
  objectTrackingEnabled: true,
  polarAngleIncrement: 45,
  trackingTolerance: 10,
};

/**
 * Find tracking alignments from a base point
 */
export function findPolarTrackingLines(
  basePoint: IPoint,
  angleIncrement: number = 45
): TrackingLine[] {
  const lines: TrackingLine[] = [];
  const incrementRad = (angleIncrement * Math.PI) / 180;
  const numAngles = Math.floor(360 / angleIncrement);

  for (let i = 0; i < numAngles; i++) {
    const angle = i * incrementRad;
    lines.push({
      origin: basePoint,
      direction: { x: Math.cos(angle), y: Math.sin(angle) },
      angle: angle,
      type: 'polar',
    });
  }

  return lines;
}

/**
 * Find tracking lines from existing shapes (parallel and perpendicular)
 */
export function findObjectTrackingLines(
  basePoint: IPoint,
  shapes: Array<{ id: string; type: string; start?: IPoint; end?: IPoint }>,
  tolerance: number = 50
): TrackingLine[] {
  const lines: TrackingLine[] = [];

  for (const shape of shapes) {
    if (shape.type === 'line' && shape.start && shape.end) {
      const line: ILine = { start: shape.start, end: shape.end };
      const dir = LineUtils.direction(line);
      const perpDir = LineUtils.perpendicularDirection(line);

      // Add parallel tracking line
      lines.push({
        origin: basePoint,
        direction: dir,
        angle: Math.atan2(dir.y, dir.x),
        type: 'parallel',
        sourceShapeId: shape.id,
      });

      // Add opposite parallel direction
      lines.push({
        origin: basePoint,
        direction: { x: -dir.x, y: -dir.y },
        angle: Math.atan2(-dir.y, -dir.x),
        type: 'parallel',
        sourceShapeId: shape.id,
      });

      // Add perpendicular tracking line
      lines.push({
        origin: basePoint,
        direction: perpDir,
        angle: Math.atan2(perpDir.y, perpDir.x),
        type: 'perpendicular',
        sourceShapeId: shape.id,
      });

      // Add opposite perpendicular direction
      lines.push({
        origin: basePoint,
        direction: { x: -perpDir.x, y: -perpDir.y },
        angle: Math.atan2(-perpDir.y, -perpDir.x),
        type: 'perpendicular',
        sourceShapeId: shape.id,
      });

      // Extension tracking from endpoints
      const distToStart = PointUtils.distance(basePoint, shape.start);
      const distToEnd = PointUtils.distance(basePoint, shape.end);

      if (distToStart < tolerance) {
        lines.push({
          origin: shape.start,
          direction: { x: -dir.x, y: -dir.y },
          angle: Math.atan2(-dir.y, -dir.x),
          type: 'extension',
          sourceShapeId: shape.id,
        });
      }

      if (distToEnd < tolerance) {
        lines.push({
          origin: shape.end,
          direction: dir,
          angle: Math.atan2(dir.y, dir.x),
          type: 'extension',
          sourceShapeId: shape.id,
        });
      }
    }
  }

  return lines;
}

/**
 * Find the closest point on any tracking line to the cursor
 */
export function findTrackingPoint(
  cursor: IPoint,
  trackingLines: TrackingLine[],
  tolerance: number
): TrackingResult | null {
  let closestResult: TrackingResult | null = null;
  let closestDistance = tolerance;

  for (const trackingLine of trackingLines) {
    // Create an infinite line from origin in the tracking direction
    const lineEnd = PointUtils.add(
      trackingLine.origin,
      PointUtils.multiply(trackingLine.direction, 10000)
    );
    const line: ILine = { start: trackingLine.origin, end: lineEnd };

    // Get the closest point on this tracking line
    const closestPoint = LineUtils.closestPointOnLine(line, cursor);

    // Only consider points in the positive direction from origin
    const toCursor = PointUtils.subtract(closestPoint, trackingLine.origin);
    const dotProduct = PointUtils.dot(toCursor, trackingLine.direction);

    if (dotProduct < 0) continue; // Point is in opposite direction

    const distance = PointUtils.distance(cursor, closestPoint);

    if (distance < closestDistance) {
      closestDistance = distance;
      closestResult = {
        point: closestPoint,
        trackingLines: [trackingLine],
        snapDescription: getTrackingDescription(trackingLine),
      };
    }
  }

  return closestResult;
}

/**
 * Find intersection of tracking lines (when multiple align)
 */
export function findTrackingIntersections(
  cursor: IPoint,
  trackingLines: TrackingLine[],
  tolerance: number
): TrackingResult | null {
  const activeLines: TrackingLine[] = [];

  // Find all tracking lines that the cursor is close to
  for (const trackingLine of trackingLines) {
    const lineEnd = PointUtils.add(
      trackingLine.origin,
      PointUtils.multiply(trackingLine.direction, 10000)
    );
    const line: ILine = { start: trackingLine.origin, end: lineEnd };
    const distance = LineUtils.distanceToLine(line, cursor);

    if (distance < tolerance) {
      // Check if in positive direction
      const closestPoint = LineUtils.closestPointOnLine(line, cursor);
      const toCursor = PointUtils.subtract(closestPoint, trackingLine.origin);
      const dotProduct = PointUtils.dot(toCursor, trackingLine.direction);

      if (dotProduct >= 0) {
        activeLines.push(trackingLine);
      }
    }
  }

  if (activeLines.length < 2) return null;

  // Find intersection of the first two active lines
  const line1End = PointUtils.add(
    activeLines[0].origin,
    PointUtils.multiply(activeLines[0].direction, 10000)
  );
  const line2End = PointUtils.add(
    activeLines[1].origin,
    PointUtils.multiply(activeLines[1].direction, 10000)
  );

  const intersection = LineUtils.lineIntersection(
    { start: activeLines[0].origin, end: line1End },
    { start: activeLines[1].origin, end: line2End }
  );

  if (intersection && PointUtils.distance(cursor, intersection) < tolerance * 2) {
    return {
      point: intersection,
      trackingLines: activeLines.slice(0, 2),
      snapDescription: 'Intersection',
    };
  }

  return null;
}

/**
 * Main tracking function - combines all tracking methods
 */
export function applyTracking(
  cursor: IPoint,
  basePoint: IPoint | null,
  shapes: Array<{ id: string; type: string; start?: IPoint; end?: IPoint }>,
  settings: TrackingSettings
): TrackingResult | null {
  if (!settings.enabled || !basePoint) return null;

  const allTrackingLines: TrackingLine[] = [];

  // Add polar tracking lines
  if (settings.polarEnabled || settings.orthoEnabled) {
    const increment = settings.orthoEnabled ? 90 : settings.polarAngleIncrement;
    allTrackingLines.push(...findPolarTrackingLines(basePoint, increment));
  }

  // Add object tracking lines (parallel/perpendicular to existing shapes)
  if (settings.objectTrackingEnabled) {
    allTrackingLines.push(
      ...findObjectTrackingLines(basePoint, shapes, settings.trackingTolerance * 5)
    );
  }

  // First check for intersections of tracking lines
  const intersection = findTrackingIntersections(
    cursor,
    allTrackingLines,
    settings.trackingTolerance
  );
  if (intersection) return intersection;

  // Then find closest single tracking line
  return findTrackingPoint(cursor, allTrackingLines, settings.trackingTolerance);
}

/**
 * Get human-readable description of tracking type
 */
function getTrackingDescription(line: TrackingLine): string {
  const angleDeg = ((line.angle * 180) / Math.PI + 360) % 360;

  switch (line.type) {
    case 'polar':
      return `Polar: ${angleDeg.toFixed(0)}°`;
    case 'parallel':
      return 'Parallel';
    case 'perpendicular':
      return 'Perpendicular';
    case 'extension':
      return 'Extension';
    default:
      return '';
  }
}

/**
 * Get tracking line color for rendering
 */
export function getTrackingLineColor(type: TrackingLine['type']): string {
  switch (type) {
    case 'polar':
      return '#00ff88';
    case 'parallel':
      return '#ff8800';
    case 'perpendicular':
      return '#00aaff';
    case 'extension':
      return '#ffff00';
    default:
      return '#ffffff';
  }
}
