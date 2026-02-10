/**
 * Central formatting utilities for lengths, angles, and coordinates
 */

import type { LengthUnit, UnitSettings } from './types';
import { fromMM, toMM } from './conversion';

/** Unit suffix strings */
const UNIT_SUFFIXES: Record<LengthUnit, string> = {
  'mm': 'mm',
  'cm': 'cm',
  'm': 'm',
  'in': '"',
  'ft': "'",
  'ft-in': '',
};

export function getUnitSuffix(unit: LengthUnit): string {
  return UNIT_SUFFIXES[unit];
}

/**
 * Apply number format (period vs comma) to a numeric string
 */
function applyNumberFormat(numStr: string, format: UnitSettings['numberFormat']): string {
  if (format === 'comma') {
    // Swap: period → placeholder → comma → period → placeholder → comma
    // "1234.56" → "1234,56" and group separator becomes period
    const parts = numStr.split('.');
    const intPart = parts[0];
    const decPart = parts[1];

    // Add thousand separators with period
    const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    return decPart !== undefined ? `${grouped},${decPart}` : grouped;
  }
  // Period format: add comma thousand separators
  const parts = numStr.split('.');
  const intPart = parts[0];
  const decPart = parts[1];
  const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return decPart !== undefined ? `${grouped}.${decPart}` : grouped;
}

/**
 * Format feet-inches from total millimeters.
 * Precision maps to fractional denominator:
 *   0 → whole inches, 1 → halves, 2 → quarters, 3 → eighths,
 *   4 → sixteenths, 5 → thirty-seconds, 6 → sixty-fourths
 */
function formatFeetInches(valueMM: number, precision: number): string {
  const negative = valueMM < 0;
  const totalInches = Math.abs(valueMM) / 25.4;
  const feet = Math.floor(totalInches / 12);
  let remainingInches = totalInches - feet * 12;

  if (precision <= 0) {
    // Whole inches
    const wholeIn = Math.round(remainingInches);
    const prefix = negative ? '-' : '';
    if (wholeIn >= 12) return `${prefix}${feet + 1}'-0"`;
    return `${prefix}${feet}'-${wholeIn}"`;
  }

  // Fractional inches
  const denominator = Math.pow(2, precision);
  const totalFractionParts = Math.round(remainingInches * denominator);
  const wholeInches = Math.floor(totalFractionParts / denominator);
  let numerator = totalFractionParts - wholeInches * denominator;

  // Handle carry
  let adjFeet = feet;
  let adjWholeInches = wholeInches;
  if (adjWholeInches >= 12) {
    adjFeet += Math.floor(adjWholeInches / 12);
    adjWholeInches = adjWholeInches % 12;
  }

  const prefix = negative ? '-' : '';

  if (numerator === 0) {
    return `${prefix}${adjFeet}'-${adjWholeInches}"`;
  }

  // Simplify fraction
  let num = numerator;
  let den = denominator;
  while (num % 2 === 0 && den % 2 === 0) {
    num /= 2;
    den /= 2;
  }

  return `${prefix}${adjFeet}'-${adjWholeInches} ${num}/${den}"`;
}

/**
 * Format a length value (in mm) for display using the current unit settings
 */
export function formatLength(valueMM: number, settings: UnitSettings): string {
  if (settings.lengthUnit === 'ft-in') {
    return formatFeetInches(valueMM, settings.lengthPrecision);
  }

  const converted = fromMM(valueMM, settings.lengthUnit);
  const fixed = converted.toFixed(settings.lengthPrecision);
  const formatted = applyNumberFormat(fixed, settings.numberFormat);

  if (settings.showUnitSuffix) {
    return `${formatted} ${getUnitSuffix(settings.lengthUnit)}`;
  }
  return formatted;
}

/**
 * Format an angle value (in degrees) for display
 */
export function formatAngle(valueDeg: number, settings: UnitSettings): string {
  const fixed = valueDeg.toFixed(settings.anglePrecision);
  const formatted = applyNumberFormat(fixed, settings.numberFormat);
  return `${formatted}\u00B0`;
}

/**
 * Format a coordinate pair (in mm) for display
 */
export function formatCoordinate(xMM: number, yMM: number, settings: UnitSettings): string {
  const x = formatLength(xMM, settings);
  const y = formatLength(yMM, settings);
  return `${x}, ${y}`;
}

/**
 * Parse a length string into millimeters.
 * Accepts values with or without unit suffix; falls back to document unit.
 * Examples: "1500", "1.5m", "5'-3 1/2\"", "25.4in"
 */
export function parseLength(input: string, settings: UnitSettings): number {
  const trimmed = input.trim();
  if (trimmed === '') return 0;

  // Try ft-in format: e.g. 5'-3 1/2" or 5'3"
  const ftInMatch = trimmed.match(/^(-?\d+)'[- ]?(\d+)(?:\s+(\d+)\/(\d+))?"?$/);
  if (ftInMatch) {
    const feet = parseInt(ftInMatch[1], 10);
    const inches = parseInt(ftInMatch[2], 10);
    const fracNum = ftInMatch[3] ? parseInt(ftInMatch[3], 10) : 0;
    const fracDen = ftInMatch[4] ? parseInt(ftInMatch[4], 10) : 1;
    const sign = feet < 0 ? -1 : 1;
    const totalInches = Math.abs(feet) * 12 + inches + fracNum / fracDen;
    return sign * totalInches * 25.4;
  }

  // Try value with unit suffix
  const unitMatch = trimmed.match(/^(-?[\d.,]+)\s*(mm|cm|m|in|ft|"|')$/i);
  if (unitMatch) {
    const numStr = unitMatch[1].replace(/,/g, '');
    const value = parseFloat(numStr);
    if (isNaN(value)) return 0;
    const unitStr = unitMatch[2].toLowerCase();
    const unitMap: Record<string, LengthUnit> = {
      'mm': 'mm', 'cm': 'cm', 'm': 'm',
      'in': 'in', '"': 'in', 'ft': 'ft', "'": 'ft',
    };
    const unit = unitMap[unitStr] || settings.lengthUnit;
    return toMM(value, unit);
  }

  // Plain number — interpret as document unit
  const numStr = trimmed.replace(/,/g, '');
  const value = parseFloat(numStr);
  if (isNaN(value)) return 0;
  return toMM(value, settings.lengthUnit);
}

/**
 * Parse an angle string into degrees.
 * Accepts: "45", "45°", "0.785rad", "50grad"
 */
export function parseAngle(input: string, _settings: UnitSettings): number {
  const trimmed = input.trim().replace(/°/g, '');
  if (trimmed === '') return 0;

  // Check for radians suffix
  const radMatch = trimmed.match(/^(-?[\d.]+)\s*rad$/i);
  if (radMatch) {
    return parseFloat(radMatch[1]) * (180 / Math.PI);
  }

  // Check for gradians suffix
  const gradMatch = trimmed.match(/^(-?[\d.]+)\s*grad$/i);
  if (gradMatch) {
    return parseFloat(gradMatch[1]) * 0.9; // 1 gradian = 0.9 degrees
  }

  // Plain number — degrees
  const value = parseFloat(trimmed.replace(/,/g, ''));
  return isNaN(value) ? 0 : value;
}
