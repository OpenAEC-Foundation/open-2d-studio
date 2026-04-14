/**
 * Snap Slice - Manages snap settings, tracking, polar, and ortho modes
 */

import type { SnapType, SnapPoint, Point, TrackingLine } from './types';
import { setSetting } from '../../utils/settings';

// ============================================================================
// Theme Types
// ============================================================================

export type UITheme = 'default' | 'dark' | 'light' | 'blue' | 'amber-navy' | 'deep-forge' | 'highContrast';

export const UI_THEMES: { id: UITheme; label: string }[] = [
  { id: 'default', label: 'Default' },
  { id: 'dark', label: 'Dark' },
  { id: 'light', label: 'Light' },
  { id: 'blue', label: 'Blue' },
  { id: 'amber-navy', label: 'Amber Navy' },
  { id: 'deep-forge', label: 'Deep Forge' },
  { id: 'highContrast', label: 'High Contrast' },
];

// ============================================================================
// State Interface
// ============================================================================

export interface SnapState {
  // Grid settings
  gridSize: number;
  gridVisible: boolean;

  // Snap settings
  snapEnabled: boolean;
  activeSnaps: SnapType[];
  snapTolerance: number;
  currentSnapPoint: SnapPoint | null;

  // Tracking settings
  trackingEnabled: boolean;
  polarTrackingEnabled: boolean;
  orthoMode: boolean;
  objectTrackingEnabled: boolean;
  polarAngleIncrement: number;  // degrees
  currentTrackingLines: TrackingLine[];
  trackingPoint: Point | null;

  // Direct distance entry - stores the current tracking angle for typed distance input
  directDistanceAngle: number | null;  // radians

  // Display settings
  whiteBackground: boolean;
  transparentBackground: boolean;
  boundaryVisible: boolean;
  uiTheme: UITheme;

  // Rotation gizmo
  showRotationGizmo: boolean;

  // Axes visibility
  axesVisible: boolean;

  // IFC category visibility filter
  hiddenIfcCategories: string[];
}

// ============================================================================
// Actions Interface
// ============================================================================

export interface SnapActions {
  setGridSize: (size: number) => void;
  toggleGrid: () => void;
  toggleSnap: () => void;
  setActiveSnaps: (snaps: SnapType[]) => void;
  toggleSnapType: (snapType: SnapType) => void;
  setSnapTolerance: (tolerance: number) => void;
  setCurrentSnapPoint: (snapPoint: SnapPoint | null) => void;
  toggleTracking: () => void;
  togglePolarTracking: () => void;
  toggleOrthoMode: () => void;
  toggleObjectTracking: () => void;
  setPolarAngleIncrement: (angle: number) => void;
  setCurrentTrackingLines: (lines: TrackingLine[]) => void;
  setTrackingPoint: (point: Point | null) => void;
  setDirectDistanceAngle: (angle: number | null) => void;
  toggleWhiteBackground: () => void;
  setTransparentBackground: (enabled: boolean) => void;
  toggleBoundaryVisible: () => void;
  setUITheme: (theme: UITheme) => void;
  toggleRotationGizmo: () => void;
  toggleAxesVisible: () => void;
  toggleIfcCategoryVisibility: (category: string) => void;
  setHiddenIfcCategories: (categories: string[]) => void;
}

export type SnapSlice = SnapState & SnapActions;

// ============================================================================
// Initial State
// ============================================================================

export const initialSnapState: SnapState = {
  gridSize: 10,
  gridVisible: false,
  snapEnabled: true,
  activeSnaps: ['endpoint', 'midpoint', 'center', 'intersection', 'origin'],
  snapTolerance: 10,
  currentSnapPoint: null,
  trackingEnabled: true,
  polarTrackingEnabled: true,
  orthoMode: false,
  objectTrackingEnabled: true,
  polarAngleIncrement: 45,
  currentTrackingLines: [],
  trackingPoint: null,
  directDistanceAngle: null,
  whiteBackground: true,
  transparentBackground: false,
  boundaryVisible: false,
  uiTheme: 'default',
  showRotationGizmo: true,
  axesVisible: false,
  hiddenIfcCategories: [],
};

// ============================================================================
// Slice Creator
// ============================================================================

export const createSnapSlice = (
  set: (fn: (state: SnapState) => void) => void,
  _get: () => SnapState
): SnapActions => ({
  setGridSize: (size) =>
    set((state) => {
      state.gridSize = Math.max(1, size);
      setSetting('gridSize', state.gridSize);
    }),

  toggleGrid: () =>
    set((state) => {
      state.gridVisible = !state.gridVisible;
      setSetting('gridVisible', state.gridVisible);
    }),

  toggleSnap: () =>
    set((state) => {
      state.snapEnabled = !state.snapEnabled;
      setSetting('snapEnabled', state.snapEnabled);
    }),

  setActiveSnaps: (snaps) =>
    set((state) => {
      state.activeSnaps = snaps;
      setSetting('activeSnaps', [...state.activeSnaps]);
    }),

  toggleSnapType: (snapType) =>
    set((state) => {
      const index = state.activeSnaps.indexOf(snapType);
      if (index >= 0) {
        state.activeSnaps.splice(index, 1);
      } else {
        state.activeSnaps.push(snapType);
      }
      setSetting('activeSnaps', [...state.activeSnaps]);
    }),

  setSnapTolerance: (tolerance) =>
    set((state) => {
      state.snapTolerance = Math.max(1, tolerance);
      setSetting('snapTolerance', state.snapTolerance);
    }),

  setCurrentSnapPoint: (snapPoint) =>
    set((state) => {
      state.currentSnapPoint = snapPoint;
    }),

  toggleTracking: () =>
    set((state) => {
      state.trackingEnabled = !state.trackingEnabled;
      setSetting('trackingEnabled', state.trackingEnabled);
    }),

  togglePolarTracking: () =>
    set((state) => {
      state.polarTrackingEnabled = !state.polarTrackingEnabled;
      setSetting('polarTrackingEnabled', state.polarTrackingEnabled);
    }),

  toggleOrthoMode: () =>
    set((state) => {
      state.orthoMode = !state.orthoMode;
      // Ortho mode overrides polar tracking
      if (state.orthoMode) {
        state.polarTrackingEnabled = false;
        setSetting('polarTrackingEnabled', false);
      }
      setSetting('orthoMode', state.orthoMode);
    }),

  toggleObjectTracking: () =>
    set((state) => {
      state.objectTrackingEnabled = !state.objectTrackingEnabled;
      setSetting('objectTrackingEnabled', state.objectTrackingEnabled);
    }),

  setPolarAngleIncrement: (angle) =>
    set((state) => {
      state.polarAngleIncrement = angle;
      setSetting('polarAngleIncrement', state.polarAngleIncrement);
    }),

  setCurrentTrackingLines: (lines) =>
    set((state) => {
      state.currentTrackingLines = lines;
    }),

  setTrackingPoint: (point) =>
    set((state) => {
      state.trackingPoint = point;
    }),

  setDirectDistanceAngle: (angle) =>
    set((state) => {
      state.directDistanceAngle = angle;
    }),

  toggleWhiteBackground: () =>
    set((state) => {
      state.whiteBackground = !state.whiteBackground;
      setSetting('whiteBackground', state.whiteBackground);
    }),

  setTransparentBackground: (enabled: boolean) =>
    set((state) => {
      state.transparentBackground = enabled;
      setSetting('transparentBackground', enabled);
    }),

  toggleBoundaryVisible: () =>
    set((state) => {
      state.boundaryVisible = !state.boundaryVisible;
      setSetting('boundaryVisible', state.boundaryVisible);
    }),

  setUITheme: (theme) =>
    set((state) => {
      state.uiTheme = theme;
      // Apply theme to document root for CSS variables
      document.documentElement.setAttribute('data-theme', theme);
      setSetting('uiTheme', theme);
    }),

  toggleRotationGizmo: () =>
    set((state) => {
      state.showRotationGizmo = !state.showRotationGizmo;
      setSetting('showRotationGizmo', state.showRotationGizmo);
    }),
  toggleAxesVisible: () =>
    set((state) => {
      state.axesVisible = !state.axesVisible;
      setSetting('axesVisible', state.axesVisible);
    }),
  toggleIfcCategoryVisibility: (category) =>
    set((state) => {
      const index = state.hiddenIfcCategories.indexOf(category);
      if (index >= 0) {
        state.hiddenIfcCategories.splice(index, 1);
      } else {
        state.hiddenIfcCategories.push(category);
      }
    }),
  setHiddenIfcCategories: (categories) =>
    set((state) => {
      state.hiddenIfcCategories = categories;
    }),
});
