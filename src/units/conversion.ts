/**
 * Unit conversion functions — internal storage is always millimeters
 */

import type { LengthUnit } from './types';

/** Conversion factors: multiply by this to go FROM the unit TO mm */
const TO_MM: Record<LengthUnit, number> = {
  'mm': 1,
  'cm': 10,
  'm': 1000,
  'in': 25.4,
  'ft': 304.8,
  'ft-in': 304.8,
};

/** Convert a value from the given unit to millimeters */
export function toMM(value: number, fromUnit: LengthUnit): number {
  return value * TO_MM[fromUnit];
}

/** Convert a value from millimeters to the given unit */
export function fromMM(valueMM: number, toUnit: LengthUnit): number {
  return valueMM / TO_MM[toUnit];
}
