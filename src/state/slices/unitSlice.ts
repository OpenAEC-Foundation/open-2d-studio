/**
 * Unit Slice - Manages document-level unit settings
 */

import type { LengthUnit, NumberFormat, UnitSettings } from '../../units/types';
import { DEFAULT_UNIT_SETTINGS } from '../../units/types';

// ============================================================================
// State Interface
// ============================================================================

export interface UnitState {
  unitSettings: UnitSettings;
}

// ============================================================================
// Actions Interface
// ============================================================================

export interface UnitActions {
  setUnitSettings: (settings: Partial<UnitSettings>) => void;
  setLengthUnit: (unit: LengthUnit) => void;
  setLengthPrecision: (precision: number) => void;
  setAnglePrecision: (precision: number) => void;
  setNumberFormat: (format: NumberFormat) => void;
  setShowUnitSuffix: (show: boolean) => void;
}

// ============================================================================
// Combined Slice Type
// ============================================================================

export type UnitSlice = UnitState & UnitActions;

// ============================================================================
// Initial State
// ============================================================================

export const initialUnitState: UnitState = {
  unitSettings: { ...DEFAULT_UNIT_SETTINGS },
};

// ============================================================================
// Slice Creator
// ============================================================================

export function createUnitSlice(
  set: (fn: (state: any) => void) => void,
  _get: () => any
): UnitActions {
  return {
    setUnitSettings: (settings: Partial<UnitSettings>) => {
      set((state) => {
        Object.assign(state.unitSettings, settings);
      });
    },

    setLengthUnit: (unit: LengthUnit) => {
      set((state) => { state.unitSettings.lengthUnit = unit; });
    },

    setLengthPrecision: (precision: number) => {
      set((state) => { state.unitSettings.lengthPrecision = Math.max(0, Math.min(8, precision)); });
    },

    setAnglePrecision: (precision: number) => {
      set((state) => { state.unitSettings.anglePrecision = Math.max(0, Math.min(8, precision)); });
    },

    setNumberFormat: (format: NumberFormat) => {
      set((state) => { state.unitSettings.numberFormat = format; });
    },

    setShowUnitSuffix: (show: boolean) => {
      set((state) => { state.unitSettings.showUnitSuffix = show; });
    },
  };
}
