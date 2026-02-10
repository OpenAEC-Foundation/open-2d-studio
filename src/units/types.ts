/**
 * Unit system type definitions
 */

export type LengthUnit = 'mm' | 'cm' | 'm' | 'in' | 'ft' | 'ft-in';

export type AngleUnit = 'degrees' | 'radians' | 'gradians';

/** 'period' = 1,234.56 (US/UK)  |  'comma' = 1.234,56 (EU) */
export type NumberFormat = 'period' | 'comma';

export interface UnitSettings {
  lengthUnit: LengthUnit;
  lengthPrecision: number;   // decimal places (0-8)
  anglePrecision: number;    // decimal places (0-8)
  numberFormat: NumberFormat;
  showUnitSuffix: boolean;
}

export const DEFAULT_UNIT_SETTINGS: UnitSettings = {
  lengthUnit: 'mm',
  lengthPrecision: 0,
  anglePrecision: 1,
  numberFormat: 'period',
  showUnitSuffix: false,
};
