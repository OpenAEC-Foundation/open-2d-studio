/**
 * useSnapDetection - Handles snap point detection and tracking
 */

import { useCallback } from 'react';
import { useAppStore } from '../../state/appStore';
import type { Point, SnapPoint } from '../../types/geometry';
import { findNearestSnapPoint } from '../../utils/snapUtils';
import { applyTracking, type TrackingSettings } from '../../core/geometry/Tracking';

export interface SnapResult {
  point: Point;
  snapInfo?: SnapPoint;
}

export function useSnapDetection() {
  const {
    viewport,
    shapes,
    snapEnabled,
    gridSize,
    activeSnaps,
    snapTolerance,
    setCurrentSnapPoint,
    // Tracking state
    trackingEnabled,
    polarTrackingEnabled,
    orthoMode,
    objectTrackingEnabled,
    polarAngleIncrement,
    setCurrentTrackingLines,
    setTrackingPoint,
    setDirectDistanceAngle,
  } = useAppStore();

  /**
   * Find and snap to the nearest snap point (geometry or grid), with tracking support
   * Returns both the snapped point and the snap info (for dimension associativity)
   */
  const snapPoint = useCallback(
    (point: Point, basePoint?: Point): SnapResult => {
      let resultPoint = point;
      let usedTracking = false;

      // Apply tracking if enabled and we have a base point (drawing mode)
      if (trackingEnabled && basePoint) {
        const trackingSettings: TrackingSettings = {
          enabled: true,
          polarEnabled: polarTrackingEnabled || orthoMode,
          orthoEnabled: orthoMode,
          objectTrackingEnabled: objectTrackingEnabled,
          polarAngleIncrement: orthoMode ? 90 : polarAngleIncrement,
          trackingTolerance: snapTolerance,
        };

        // Convert shapes to format expected by tracking
        const trackableShapes = shapes
          .filter((s) => s.type === 'line')
          .map((s) => ({
            id: s.id,
            type: s.type,
            start: (s as any).start,
            end: (s as any).end,
          }));

        const trackingResult = applyTracking(
          point,
          basePoint,
          trackableShapes,
          trackingSettings
        );

        if (trackingResult) {
          resultPoint = trackingResult.point;
          setCurrentTrackingLines(trackingResult.trackingLines);
          setTrackingPoint(trackingResult.point);
          usedTracking = true;

          // Store the tracking angle for direct distance entry
          if (trackingResult.trackingLines.length > 0) {
            setDirectDistanceAngle(trackingResult.trackingLines[0].angle);
          } else {
            // Calculate angle from base point to tracking point
            const dx = trackingResult.point.x - basePoint.x;
            const dy = trackingResult.point.y - basePoint.y;
            setDirectDistanceAngle(Math.atan2(dy, dx));
          }
        } else {
          setCurrentTrackingLines([]);
          setTrackingPoint(null);
          setDirectDistanceAngle(null);
        }
      } else {
        setCurrentTrackingLines([]);
        setTrackingPoint(null);
        setDirectDistanceAngle(null);
      }

      // Apply object snap (can override tracking if closer)
      if (snapEnabled) {
        const worldTolerance = snapTolerance / viewport.zoom;

        const nearestSnap = findNearestSnapPoint(
          usedTracking ? resultPoint : point,
          shapes,
          activeSnaps,
          worldTolerance,
          gridSize
        );

        if (nearestSnap) {
          // Object snap takes priority over tracking
          setCurrentSnapPoint(nearestSnap);
          return { point: nearestSnap.point, snapInfo: nearestSnap };
        }
      }

      setCurrentSnapPoint(null);
      return { point: resultPoint };
    },
    [
      snapEnabled,
      shapes,
      activeSnaps,
      snapTolerance,
      gridSize,
      viewport.zoom,
      setCurrentSnapPoint,
      trackingEnabled,
      polarTrackingEnabled,
      orthoMode,
      objectTrackingEnabled,
      polarAngleIncrement,
      setCurrentTrackingLines,
      setTrackingPoint,
      setDirectDistanceAngle,
    ]
  );

  /**
   * Clear tracking state
   */
  const clearTracking = useCallback(() => {
    setCurrentTrackingLines([]);
    setTrackingPoint(null);
    setCurrentSnapPoint(null);
    setDirectDistanceAngle(null);
  }, [setCurrentTrackingLines, setTrackingPoint, setCurrentSnapPoint, setDirectDistanceAngle]);

  return {
    snapPoint,
    clearTracking,
  };
}
