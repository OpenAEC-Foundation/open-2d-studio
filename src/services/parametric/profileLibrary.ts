/**
 * Profile Library
 *
 * Standard profile presets from various specifications (AISC, EN, etc.)
 * This provides commonly used structural section sizes that users can select
 * instead of entering dimensions manually.
 */

import type { ProfilePreset, ProfileType } from '../../types/parametric';

// ============================================================================
// AISC W-Shapes (Wide Flange)
// ============================================================================

const AISC_W_SHAPES: ProfilePreset[] = [
  // W4 Series
  { id: 'W4x13', name: 'W4x13', profileType: 'i-beam', standard: 'AISC', category: 'W-Shapes',
    parameters: { height: 106.2, flangeWidth: 103.4, webThickness: 7.1, flangeThickness: 8.8, filletRadius: 7 },
    properties: { area: 2477, weight: 19.3 } },

  // W6 Series
  { id: 'W6x9', name: 'W6x9', profileType: 'i-beam', standard: 'AISC', category: 'W-Shapes',
    parameters: { height: 150.1, flangeWidth: 99.1, webThickness: 4.3, flangeThickness: 5.7, filletRadius: 6 },
    properties: { area: 1142, weight: 13.4 } },
  { id: 'W6x15', name: 'W6x15', profileType: 'i-beam', standard: 'AISC', category: 'W-Shapes',
    parameters: { height: 152.4, flangeWidth: 152.4, webThickness: 5.8, flangeThickness: 6.6, filletRadius: 8 },
    properties: { area: 2858, weight: 22.3 } },
  { id: 'W6x25', name: 'W6x25', profileType: 'i-beam', standard: 'AISC', category: 'W-Shapes',
    parameters: { height: 162.1, flangeWidth: 154.2, webThickness: 8.1, flangeThickness: 11.6, filletRadius: 10 },
    properties: { area: 4774, weight: 37.2 } },

  // W8 Series
  { id: 'W8x18', name: 'W8x18', profileType: 'i-beam', standard: 'AISC', category: 'W-Shapes',
    parameters: { height: 206.8, flangeWidth: 133.4, webThickness: 5.8, flangeThickness: 8.4, filletRadius: 10 },
    properties: { area: 3432, weight: 26.8 } },
  { id: 'W8x24', name: 'W8x24', profileType: 'i-beam', standard: 'AISC', category: 'W-Shapes',
    parameters: { height: 200.7, flangeWidth: 165.1, webThickness: 6.2, flangeThickness: 10.2, filletRadius: 10 },
    properties: { area: 4581, weight: 35.7 } },
  { id: 'W8x31', name: 'W8x31', profileType: 'i-beam', standard: 'AISC', category: 'W-Shapes',
    parameters: { height: 203.2, flangeWidth: 133.4, webThickness: 7.2, flangeThickness: 11.2, filletRadius: 10 },
    properties: { area: 5910, weight: 46.1 } },
  { id: 'W8x40', name: 'W8x40', profileType: 'i-beam', standard: 'AISC', category: 'W-Shapes',
    parameters: { height: 209.6, flangeWidth: 203.2, webThickness: 9.1, flangeThickness: 14.2, filletRadius: 12 },
    properties: { area: 7613, weight: 59.5 } },

  // W10 Series
  { id: 'W10x22', name: 'W10x22', profileType: 'i-beam', standard: 'AISC', category: 'W-Shapes',
    parameters: { height: 254.8, flangeWidth: 146.1, webThickness: 6.1, flangeThickness: 9.1, filletRadius: 10 },
    properties: { area: 4194, weight: 32.7 } },
  { id: 'W10x33', name: 'W10x33', profileType: 'i-beam', standard: 'AISC', category: 'W-Shapes',
    parameters: { height: 247.1, flangeWidth: 201.9, webThickness: 7.4, flangeThickness: 11.4, filletRadius: 12 },
    properties: { area: 6290, weight: 49.1 } },
  { id: 'W10x49', name: 'W10x49', profileType: 'i-beam', standard: 'AISC', category: 'W-Shapes',
    parameters: { height: 253.0, flangeWidth: 254.0, webThickness: 8.6, flangeThickness: 14.2, filletRadius: 14 },
    properties: { area: 9355, weight: 72.9 } },

  // W12 Series
  { id: 'W12x26', name: 'W12x26', profileType: 'i-beam', standard: 'AISC', category: 'W-Shapes',
    parameters: { height: 310.1, flangeWidth: 165.1, webThickness: 5.8, flangeThickness: 9.7, filletRadius: 12 },
    properties: { area: 4948, weight: 38.7 } },
  { id: 'W12x40', name: 'W12x40', profileType: 'i-beam', standard: 'AISC', category: 'W-Shapes',
    parameters: { height: 303.3, flangeWidth: 203.2, webThickness: 7.5, flangeThickness: 13.1, filletRadius: 14 },
    properties: { area: 7613, weight: 59.5 } },
  { id: 'W12x58', name: 'W12x58', profileType: 'i-beam', standard: 'AISC', category: 'W-Shapes',
    parameters: { height: 309.6, flangeWidth: 254.0, webThickness: 9.1, flangeThickness: 16.3, filletRadius: 16 },
    properties: { area: 11032, weight: 86.3 } },

  // W14 Series
  { id: 'W14x30', name: 'W14x30', profileType: 'i-beam', standard: 'AISC', category: 'W-Shapes',
    parameters: { height: 351.0, flangeWidth: 171.5, webThickness: 6.9, flangeThickness: 9.8, filletRadius: 12 },
    properties: { area: 5710, weight: 44.6 } },
  { id: 'W14x48', name: 'W14x48', profileType: 'i-beam', standard: 'AISC', category: 'W-Shapes',
    parameters: { height: 350.5, flangeWidth: 203.2, webThickness: 8.6, flangeThickness: 13.5, filletRadius: 14 },
    properties: { area: 9161, weight: 71.4 } },
  { id: 'W14x68', name: 'W14x68', profileType: 'i-beam', standard: 'AISC', category: 'W-Shapes',
    parameters: { height: 357.1, flangeWidth: 254.0, webThickness: 10.5, flangeThickness: 18.3, filletRadius: 18 },
    properties: { area: 12968, weight: 101.2 } },
];

// ============================================================================
// AISC C-Shapes (Channels)
// ============================================================================

const AISC_C_SHAPES: ProfilePreset[] = [
  { id: 'C3x4.1', name: 'C3x4.1', profileType: 'channel', standard: 'AISC', category: 'C-Shapes',
    parameters: { height: 76.2, flangeWidth: 35.8, webThickness: 4.3, flangeThickness: 6.1, filletRadius: 5 },
    properties: { area: 781, weight: 6.1 } },
  { id: 'C4x5.4', name: 'C4x5.4', profileType: 'channel', standard: 'AISC', category: 'C-Shapes',
    parameters: { height: 101.6, flangeWidth: 40.2, webThickness: 4.7, flangeThickness: 7.5, filletRadius: 6 },
    properties: { area: 1032, weight: 8.0 } },
  { id: 'C5x6.7', name: 'C5x6.7', profileType: 'channel', standard: 'AISC', category: 'C-Shapes',
    parameters: { height: 127.0, flangeWidth: 44.5, webThickness: 4.8, flangeThickness: 8.1, filletRadius: 7 },
    properties: { area: 1277, weight: 10.0 } },
  { id: 'C6x8.2', name: 'C6x8.2', profileType: 'channel', standard: 'AISC', category: 'C-Shapes',
    parameters: { height: 152.4, flangeWidth: 48.8, webThickness: 5.1, flangeThickness: 8.7, filletRadius: 7 },
    properties: { area: 1561, weight: 12.2 } },
  { id: 'C6x13', name: 'C6x13', profileType: 'channel', standard: 'AISC', category: 'C-Shapes',
    parameters: { height: 152.4, flangeWidth: 56.1, webThickness: 8.0, flangeThickness: 10.9, filletRadius: 8 },
    properties: { area: 2477, weight: 19.3 } },
  { id: 'C8x11.5', name: 'C8x11.5', profileType: 'channel', standard: 'AISC', category: 'C-Shapes',
    parameters: { height: 203.2, flangeWidth: 57.4, webThickness: 5.6, flangeThickness: 9.9, filletRadius: 8 },
    properties: { area: 2194, weight: 17.1 } },
  { id: 'C8x18.75', name: 'C8x18.75', profileType: 'channel', standard: 'AISC', category: 'C-Shapes',
    parameters: { height: 203.2, flangeWidth: 68.0, webThickness: 9.1, flangeThickness: 13.1, filletRadius: 10 },
    properties: { area: 3574, weight: 27.9 } },
  { id: 'C10x15.3', name: 'C10x15.3', profileType: 'channel', standard: 'AISC', category: 'C-Shapes',
    parameters: { height: 254.0, flangeWidth: 66.0, webThickness: 6.1, flangeThickness: 11.1, filletRadius: 9 },
    properties: { area: 2916, weight: 22.8 } },
  { id: 'C12x20.7', name: 'C12x20.7', profileType: 'channel', standard: 'AISC', category: 'C-Shapes',
    parameters: { height: 304.8, flangeWidth: 74.7, webThickness: 7.2, flangeThickness: 12.6, filletRadius: 10 },
    properties: { area: 3942, weight: 30.8 } },
];

// ============================================================================
// AISC L-Shapes (Angles)
// ============================================================================

const AISC_L_SHAPES: ProfilePreset[] = [
  // Equal leg angles
  { id: 'L2x2x1/4', name: 'L2x2x1/4', profileType: 'angle', standard: 'AISC', category: 'L-Shapes (Equal)',
    parameters: { leg1: 50.8, leg2: 50.8, thickness: 6.4, filletRadius: 5, toeRadius: 2 },
    properties: { area: 613, weight: 4.8 } },
  { id: 'L3x3x1/4', name: 'L3x3x1/4', profileType: 'angle', standard: 'AISC', category: 'L-Shapes (Equal)',
    parameters: { leg1: 76.2, leg2: 76.2, thickness: 6.4, filletRadius: 6, toeRadius: 3 },
    properties: { area: 929, weight: 7.3 } },
  { id: 'L3x3x3/8', name: 'L3x3x3/8', profileType: 'angle', standard: 'AISC', category: 'L-Shapes (Equal)',
    parameters: { leg1: 76.2, leg2: 76.2, thickness: 9.5, filletRadius: 7, toeRadius: 3 },
    properties: { area: 1361, weight: 10.7 } },
  { id: 'L4x4x1/4', name: 'L4x4x1/4', profileType: 'angle', standard: 'AISC', category: 'L-Shapes (Equal)',
    parameters: { leg1: 101.6, leg2: 101.6, thickness: 6.4, filletRadius: 7, toeRadius: 3 },
    properties: { area: 1245, weight: 9.8 } },
  { id: 'L4x4x3/8', name: 'L4x4x3/8', profileType: 'angle', standard: 'AISC', category: 'L-Shapes (Equal)',
    parameters: { leg1: 101.6, leg2: 101.6, thickness: 9.5, filletRadius: 8, toeRadius: 4 },
    properties: { area: 1839, weight: 14.4 } },
  { id: 'L4x4x1/2', name: 'L4x4x1/2', profileType: 'angle', standard: 'AISC', category: 'L-Shapes (Equal)',
    parameters: { leg1: 101.6, leg2: 101.6, thickness: 12.7, filletRadius: 9, toeRadius: 4 },
    properties: { area: 2419, weight: 19.0 } },
  { id: 'L5x5x3/8', name: 'L5x5x3/8', profileType: 'angle', standard: 'AISC', category: 'L-Shapes (Equal)',
    parameters: { leg1: 127.0, leg2: 127.0, thickness: 9.5, filletRadius: 9, toeRadius: 4 },
    properties: { area: 2316, weight: 18.2 } },
  { id: 'L6x6x1/2', name: 'L6x6x1/2', profileType: 'angle', standard: 'AISC', category: 'L-Shapes (Equal)',
    parameters: { leg1: 152.4, leg2: 152.4, thickness: 12.7, filletRadius: 10, toeRadius: 5 },
    properties: { area: 3690, weight: 28.9 } },

  // Unequal leg angles
  { id: 'L3x2x1/4', name: 'L3x2x1/4', profileType: 'angle', standard: 'AISC', category: 'L-Shapes (Unequal)',
    parameters: { leg1: 76.2, leg2: 50.8, thickness: 6.4, filletRadius: 6, toeRadius: 3 },
    properties: { area: 768, weight: 6.0 } },
  { id: 'L4x3x1/4', name: 'L4x3x1/4', profileType: 'angle', standard: 'AISC', category: 'L-Shapes (Unequal)',
    parameters: { leg1: 101.6, leg2: 76.2, thickness: 6.4, filletRadius: 7, toeRadius: 3 },
    properties: { area: 1084, weight: 8.5 } },
  { id: 'L4x3x3/8', name: 'L4x3x3/8', profileType: 'angle', standard: 'AISC', category: 'L-Shapes (Unequal)',
    parameters: { leg1: 101.6, leg2: 76.2, thickness: 9.5, filletRadius: 8, toeRadius: 4 },
    properties: { area: 1597, weight: 12.5 } },
  { id: 'L5x3x1/2', name: 'L5x3x1/2', profileType: 'angle', standard: 'AISC', category: 'L-Shapes (Unequal)',
    parameters: { leg1: 127.0, leg2: 76.2, thickness: 12.7, filletRadius: 9, toeRadius: 4 },
    properties: { area: 2419, weight: 19.0 } },
  { id: 'L6x4x1/2', name: 'L6x4x1/2', profileType: 'angle', standard: 'AISC', category: 'L-Shapes (Unequal)',
    parameters: { leg1: 152.4, leg2: 101.6, thickness: 12.7, filletRadius: 10, toeRadius: 5 },
    properties: { area: 3058, weight: 24.0 } },
];

// ============================================================================
// AISC HSS Rectangular
// ============================================================================

const AISC_HSS_RECT: ProfilePreset[] = [
  { id: 'HSS4x2x1/4', name: 'HSS4x2x1/4', profileType: 'hss-rect', standard: 'AISC', category: 'HSS-Rect',
    parameters: { height: 101.6, width: 50.8, wallThickness: 5.8, cornerRadius: 12 },
    properties: { area: 1619, weight: 12.7 } },
  { id: 'HSS4x4x1/4', name: 'HSS4x4x1/4', profileType: 'hss-rect', standard: 'AISC', category: 'HSS-Rect',
    parameters: { height: 101.6, width: 101.6, wallThickness: 5.8, cornerRadius: 12 },
    properties: { area: 2181, weight: 17.1 } },
  { id: 'HSS4x4x3/8', name: 'HSS4x4x3/8', profileType: 'hss-rect', standard: 'AISC', category: 'HSS-Rect',
    parameters: { height: 101.6, width: 101.6, wallThickness: 8.7, cornerRadius: 15 },
    properties: { area: 3097, weight: 24.3 } },
  { id: 'HSS6x4x1/4', name: 'HSS6x4x1/4', profileType: 'hss-rect', standard: 'AISC', category: 'HSS-Rect',
    parameters: { height: 152.4, width: 101.6, wallThickness: 5.8, cornerRadius: 12 },
    properties: { area: 2761, weight: 21.7 } },
  { id: 'HSS6x4x3/8', name: 'HSS6x4x3/8', profileType: 'hss-rect', standard: 'AISC', category: 'HSS-Rect',
    parameters: { height: 152.4, width: 101.6, wallThickness: 8.7, cornerRadius: 15 },
    properties: { area: 3936, weight: 30.9 } },
  { id: 'HSS6x6x1/4', name: 'HSS6x6x1/4', profileType: 'hss-rect', standard: 'AISC', category: 'HSS-Rect',
    parameters: { height: 152.4, width: 152.4, wallThickness: 5.8, cornerRadius: 12 },
    properties: { area: 3342, weight: 26.2 } },
  { id: 'HSS6x6x3/8', name: 'HSS6x6x3/8', profileType: 'hss-rect', standard: 'AISC', category: 'HSS-Rect',
    parameters: { height: 152.4, width: 152.4, wallThickness: 8.7, cornerRadius: 15 },
    properties: { area: 4774, weight: 37.5 } },
  { id: 'HSS8x4x1/4', name: 'HSS8x4x1/4', profileType: 'hss-rect', standard: 'AISC', category: 'HSS-Rect',
    parameters: { height: 203.2, width: 101.6, wallThickness: 5.8, cornerRadius: 12 },
    properties: { area: 3342, weight: 26.2 } },
  { id: 'HSS8x6x3/8', name: 'HSS8x6x3/8', profileType: 'hss-rect', standard: 'AISC', category: 'HSS-Rect',
    parameters: { height: 203.2, width: 152.4, wallThickness: 8.7, cornerRadius: 15 },
    properties: { area: 5613, weight: 44.1 } },
  { id: 'HSS8x8x1/2', name: 'HSS8x8x1/2', profileType: 'hss-rect', standard: 'AISC', category: 'HSS-Rect',
    parameters: { height: 203.2, width: 203.2, wallThickness: 11.6, cornerRadius: 18 },
    properties: { area: 8516, weight: 66.8 } },
];

// ============================================================================
// AISC HSS Round (Pipes)
// ============================================================================

const AISC_HSS_ROUND: ProfilePreset[] = [
  { id: 'HSS2.375x0.154', name: 'HSS2.375x0.154', profileType: 'hss-round', standard: 'AISC', category: 'HSS-Round',
    parameters: { diameter: 60.3, wallThickness: 3.9 },
    properties: { area: 690, weight: 5.4 } },
  { id: 'HSS3.500x0.216', name: 'HSS3.500x0.216', profileType: 'hss-round', standard: 'AISC', category: 'HSS-Round',
    parameters: { diameter: 88.9, wallThickness: 5.5 },
    properties: { area: 1442, weight: 11.3 } },
  { id: 'HSS4.000x0.226', name: 'HSS4.000x0.226', profileType: 'hss-round', standard: 'AISC', category: 'HSS-Round',
    parameters: { diameter: 101.6, wallThickness: 5.7 },
    properties: { area: 1719, weight: 13.5 } },
  { id: 'HSS4.500x0.237', name: 'HSS4.500x0.237', profileType: 'hss-round', standard: 'AISC', category: 'HSS-Round',
    parameters: { diameter: 114.3, wallThickness: 6.0 },
    properties: { area: 2039, weight: 16.0 } },
  { id: 'HSS5.563x0.258', name: 'HSS5.563x0.258', profileType: 'hss-round', standard: 'AISC', category: 'HSS-Round',
    parameters: { diameter: 141.3, wallThickness: 6.6 },
    properties: { area: 2787, weight: 21.9 } },
  { id: 'HSS6.625x0.280', name: 'HSS6.625x0.280', profileType: 'hss-round', standard: 'AISC', category: 'HSS-Round',
    parameters: { diameter: 168.3, wallThickness: 7.1 },
    properties: { area: 3594, weight: 28.2 } },
  { id: 'HSS8.625x0.322', name: 'HSS8.625x0.322', profileType: 'hss-round', standard: 'AISC', category: 'HSS-Round',
    parameters: { diameter: 219.1, wallThickness: 8.2 },
    properties: { area: 5426, weight: 42.6 } },
  { id: 'HSS10.750x0.365', name: 'HSS10.750x0.365', profileType: 'hss-round', standard: 'AISC', category: 'HSS-Round',
    parameters: { diameter: 273.1, wallThickness: 9.3 },
    properties: { area: 7697, weight: 60.4 } },
];

// ============================================================================
// European IPE Profiles
// ============================================================================

const EN_IPE_SHAPES: ProfilePreset[] = [
  { id: 'IPE80', name: 'IPE 80', profileType: 'i-beam', standard: 'EN', category: 'IPE',
    parameters: { height: 80, flangeWidth: 46, webThickness: 3.8, flangeThickness: 5.2, filletRadius: 5 },
    properties: { area: 764, weight: 6.0 } },
  { id: 'IPE100', name: 'IPE 100', profileType: 'i-beam', standard: 'EN', category: 'IPE',
    parameters: { height: 100, flangeWidth: 55, webThickness: 4.1, flangeThickness: 5.7, filletRadius: 7 },
    properties: { area: 1032, weight: 8.1 } },
  { id: 'IPE120', name: 'IPE 120', profileType: 'i-beam', standard: 'EN', category: 'IPE',
    parameters: { height: 120, flangeWidth: 64, webThickness: 4.4, flangeThickness: 6.3, filletRadius: 7 },
    properties: { area: 1321, weight: 10.4 } },
  { id: 'IPE140', name: 'IPE 140', profileType: 'i-beam', standard: 'EN', category: 'IPE',
    parameters: { height: 140, flangeWidth: 73, webThickness: 4.7, flangeThickness: 6.9, filletRadius: 7 },
    properties: { area: 1643, weight: 12.9 } },
  { id: 'IPE160', name: 'IPE 160', profileType: 'i-beam', standard: 'EN', category: 'IPE',
    parameters: { height: 160, flangeWidth: 82, webThickness: 5.0, flangeThickness: 7.4, filletRadius: 9 },
    properties: { area: 2009, weight: 15.8 } },
  { id: 'IPE180', name: 'IPE 180', profileType: 'i-beam', standard: 'EN', category: 'IPE',
    parameters: { height: 180, flangeWidth: 91, webThickness: 5.3, flangeThickness: 8.0, filletRadius: 9 },
    properties: { area: 2395, weight: 18.8 } },
  { id: 'IPE200', name: 'IPE 200', profileType: 'i-beam', standard: 'EN', category: 'IPE',
    parameters: { height: 200, flangeWidth: 100, webThickness: 5.6, flangeThickness: 8.5, filletRadius: 12 },
    properties: { area: 2848, weight: 22.4 } },
  { id: 'IPE220', name: 'IPE 220', profileType: 'i-beam', standard: 'EN', category: 'IPE',
    parameters: { height: 220, flangeWidth: 110, webThickness: 5.9, flangeThickness: 9.2, filletRadius: 12 },
    properties: { area: 3337, weight: 26.2 } },
  { id: 'IPE240', name: 'IPE 240', profileType: 'i-beam', standard: 'EN', category: 'IPE',
    parameters: { height: 240, flangeWidth: 120, webThickness: 6.2, flangeThickness: 9.8, filletRadius: 15 },
    properties: { area: 3912, weight: 30.7 } },
  { id: 'IPE270', name: 'IPE 270', profileType: 'i-beam', standard: 'EN', category: 'IPE',
    parameters: { height: 270, flangeWidth: 135, webThickness: 6.6, flangeThickness: 10.2, filletRadius: 15 },
    properties: { area: 4594, weight: 36.1 } },
  { id: 'IPE300', name: 'IPE 300', profileType: 'i-beam', standard: 'EN', category: 'IPE',
    parameters: { height: 300, flangeWidth: 150, webThickness: 7.1, flangeThickness: 10.7, filletRadius: 15 },
    properties: { area: 5381, weight: 42.2 } },
  { id: 'IPE330', name: 'IPE 330', profileType: 'i-beam', standard: 'EN', category: 'IPE',
    parameters: { height: 330, flangeWidth: 160, webThickness: 7.5, flangeThickness: 11.5, filletRadius: 18 },
    properties: { area: 6261, weight: 49.1 } },
  { id: 'IPE360', name: 'IPE 360', profileType: 'i-beam', standard: 'EN', category: 'IPE',
    parameters: { height: 360, flangeWidth: 170, webThickness: 8.0, flangeThickness: 12.7, filletRadius: 18 },
    properties: { area: 7273, weight: 57.1 } },
  { id: 'IPE400', name: 'IPE 400', profileType: 'i-beam', standard: 'EN', category: 'IPE',
    parameters: { height: 400, flangeWidth: 180, webThickness: 8.6, flangeThickness: 13.5, filletRadius: 21 },
    properties: { area: 8446, weight: 66.3 } },
];

// ============================================================================
// European HEA Profiles (Wide Flange - Light Series)
// ============================================================================

const EN_HEA_SHAPES: ProfilePreset[] = [
  { id: 'HEA100', name: 'HEA 100', profileType: 'i-beam', standard: 'EN', category: 'HEA',
    parameters: { height: 96, flangeWidth: 100, webThickness: 5.0, flangeThickness: 8.0, filletRadius: 12 },
    properties: { area: 2124, weight: 16.7 } },
  { id: 'HEA120', name: 'HEA 120', profileType: 'i-beam', standard: 'EN', category: 'HEA',
    parameters: { height: 114, flangeWidth: 120, webThickness: 5.0, flangeThickness: 8.0, filletRadius: 12 },
    properties: { area: 2534, weight: 19.9 } },
  { id: 'HEA140', name: 'HEA 140', profileType: 'i-beam', standard: 'EN', category: 'HEA',
    parameters: { height: 133, flangeWidth: 140, webThickness: 5.5, flangeThickness: 8.5, filletRadius: 12 },
    properties: { area: 3142, weight: 24.7 } },
  { id: 'HEA160', name: 'HEA 160', profileType: 'i-beam', standard: 'EN', category: 'HEA',
    parameters: { height: 152, flangeWidth: 160, webThickness: 6.0, flangeThickness: 9.0, filletRadius: 15 },
    properties: { area: 3877, weight: 30.4 } },
  { id: 'HEA180', name: 'HEA 180', profileType: 'i-beam', standard: 'EN', category: 'HEA',
    parameters: { height: 171, flangeWidth: 180, webThickness: 6.0, flangeThickness: 9.5, filletRadius: 15 },
    properties: { area: 4525, weight: 35.5 } },
  { id: 'HEA200', name: 'HEA 200', profileType: 'i-beam', standard: 'EN', category: 'HEA',
    parameters: { height: 190, flangeWidth: 200, webThickness: 6.5, flangeThickness: 10.0, filletRadius: 18 },
    properties: { area: 5383, weight: 42.3 } },
  { id: 'HEA220', name: 'HEA 220', profileType: 'i-beam', standard: 'EN', category: 'HEA',
    parameters: { height: 210, flangeWidth: 220, webThickness: 7.0, flangeThickness: 11.0, filletRadius: 18 },
    properties: { area: 6434, weight: 50.5 } },
  { id: 'HEA240', name: 'HEA 240', profileType: 'i-beam', standard: 'EN', category: 'HEA',
    parameters: { height: 230, flangeWidth: 240, webThickness: 7.5, flangeThickness: 12.0, filletRadius: 21 },
    properties: { area: 7684, weight: 60.3 } },
  { id: 'HEA260', name: 'HEA 260', profileType: 'i-beam', standard: 'EN', category: 'HEA',
    parameters: { height: 250, flangeWidth: 260, webThickness: 7.5, flangeThickness: 12.5, filletRadius: 24 },
    properties: { area: 8682, weight: 68.2 } },
  { id: 'HEA280', name: 'HEA 280', profileType: 'i-beam', standard: 'EN', category: 'HEA',
    parameters: { height: 270, flangeWidth: 280, webThickness: 8.0, flangeThickness: 13.0, filletRadius: 24 },
    properties: { area: 9726, weight: 76.4 } },
  { id: 'HEA300', name: 'HEA 300', profileType: 'i-beam', standard: 'EN', category: 'HEA',
    parameters: { height: 290, flangeWidth: 300, webThickness: 8.5, flangeThickness: 14.0, filletRadius: 27 },
    properties: { area: 11253, weight: 88.3 } },
  { id: 'HEA320', name: 'HEA 320', profileType: 'i-beam', standard: 'EN', category: 'HEA',
    parameters: { height: 310, flangeWidth: 300, webThickness: 9.0, flangeThickness: 15.5, filletRadius: 27 },
    properties: { area: 12440, weight: 97.6 } },
  { id: 'HEA340', name: 'HEA 340', profileType: 'i-beam', standard: 'EN', category: 'HEA',
    parameters: { height: 330, flangeWidth: 300, webThickness: 9.5, flangeThickness: 16.5, filletRadius: 27 },
    properties: { area: 13330, weight: 105.0 } },
  { id: 'HEA360', name: 'HEA 360', profileType: 'i-beam', standard: 'EN', category: 'HEA',
    parameters: { height: 350, flangeWidth: 300, webThickness: 10.0, flangeThickness: 17.5, filletRadius: 27 },
    properties: { area: 14286, weight: 112.0 } },
  { id: 'HEA400', name: 'HEA 400', profileType: 'i-beam', standard: 'EN', category: 'HEA',
    parameters: { height: 390, flangeWidth: 300, webThickness: 11.0, flangeThickness: 19.0, filletRadius: 27 },
    properties: { area: 15898, weight: 125.0 } },
];

// ============================================================================
// European HEB Profiles (Wide Flange - Standard Series)
// ============================================================================

const EN_HEB_SHAPES: ProfilePreset[] = [
  { id: 'HEB100', name: 'HEB 100', profileType: 'i-beam', standard: 'EN', category: 'HEB',
    parameters: { height: 100, flangeWidth: 100, webThickness: 6.0, flangeThickness: 10.0, filletRadius: 12 },
    properties: { area: 2604, weight: 20.4 } },
  { id: 'HEB120', name: 'HEB 120', profileType: 'i-beam', standard: 'EN', category: 'HEB',
    parameters: { height: 120, flangeWidth: 120, webThickness: 6.5, flangeThickness: 11.0, filletRadius: 12 },
    properties: { area: 3401, weight: 26.7 } },
  { id: 'HEB140', name: 'HEB 140', profileType: 'i-beam', standard: 'EN', category: 'HEB',
    parameters: { height: 140, flangeWidth: 140, webThickness: 7.0, flangeThickness: 12.0, filletRadius: 12 },
    properties: { area: 4296, weight: 33.7 } },
  { id: 'HEB160', name: 'HEB 160', profileType: 'i-beam', standard: 'EN', category: 'HEB',
    parameters: { height: 160, flangeWidth: 160, webThickness: 8.0, flangeThickness: 13.0, filletRadius: 15 },
    properties: { area: 5425, weight: 42.6 } },
  { id: 'HEB180', name: 'HEB 180', profileType: 'i-beam', standard: 'EN', category: 'HEB',
    parameters: { height: 180, flangeWidth: 180, webThickness: 8.5, flangeThickness: 14.0, filletRadius: 15 },
    properties: { area: 6525, weight: 51.2 } },
  { id: 'HEB200', name: 'HEB 200', profileType: 'i-beam', standard: 'EN', category: 'HEB',
    parameters: { height: 200, flangeWidth: 200, webThickness: 9.0, flangeThickness: 15.0, filletRadius: 18 },
    properties: { area: 7808, weight: 61.3 } },
  { id: 'HEB220', name: 'HEB 220', profileType: 'i-beam', standard: 'EN', category: 'HEB',
    parameters: { height: 220, flangeWidth: 220, webThickness: 9.5, flangeThickness: 16.0, filletRadius: 18 },
    properties: { area: 9104, weight: 71.5 } },
  { id: 'HEB240', name: 'HEB 240', profileType: 'i-beam', standard: 'EN', category: 'HEB',
    parameters: { height: 240, flangeWidth: 240, webThickness: 10.0, flangeThickness: 17.0, filletRadius: 21 },
    properties: { area: 10600, weight: 83.2 } },
  { id: 'HEB260', name: 'HEB 260', profileType: 'i-beam', standard: 'EN', category: 'HEB',
    parameters: { height: 260, flangeWidth: 260, webThickness: 10.0, flangeThickness: 17.5, filletRadius: 24 },
    properties: { area: 11845, weight: 93.0 } },
  { id: 'HEB280', name: 'HEB 280', profileType: 'i-beam', standard: 'EN', category: 'HEB',
    parameters: { height: 280, flangeWidth: 280, webThickness: 10.5, flangeThickness: 18.0, filletRadius: 24 },
    properties: { area: 13135, weight: 103.0 } },
  { id: 'HEB300', name: 'HEB 300', profileType: 'i-beam', standard: 'EN', category: 'HEB',
    parameters: { height: 300, flangeWidth: 300, webThickness: 11.0, flangeThickness: 19.0, filletRadius: 27 },
    properties: { area: 14908, weight: 117.0 } },
  { id: 'HEB320', name: 'HEB 320', profileType: 'i-beam', standard: 'EN', category: 'HEB',
    parameters: { height: 320, flangeWidth: 300, webThickness: 11.5, flangeThickness: 20.5, filletRadius: 27 },
    properties: { area: 16129, weight: 127.0 } },
  { id: 'HEB340', name: 'HEB 340', profileType: 'i-beam', standard: 'EN', category: 'HEB',
    parameters: { height: 340, flangeWidth: 300, webThickness: 12.0, flangeThickness: 21.5, filletRadius: 27 },
    properties: { area: 17090, weight: 134.0 } },
  { id: 'HEB360', name: 'HEB 360', profileType: 'i-beam', standard: 'EN', category: 'HEB',
    parameters: { height: 360, flangeWidth: 300, webThickness: 12.5, flangeThickness: 22.5, filletRadius: 27 },
    properties: { area: 18064, weight: 142.0 } },
  { id: 'HEB400', name: 'HEB 400', profileType: 'i-beam', standard: 'EN', category: 'HEB',
    parameters: { height: 400, flangeWidth: 300, webThickness: 13.5, flangeThickness: 24.0, filletRadius: 27 },
    properties: { area: 19782, weight: 155.0 } },
];

// ============================================================================
// European HEM Profiles (Wide Flange - Heavy Series)
// ============================================================================

const EN_HEM_SHAPES: ProfilePreset[] = [
  { id: 'HEM100', name: 'HEM 100', profileType: 'i-beam', standard: 'EN', category: 'HEM',
    parameters: { height: 120, flangeWidth: 106, webThickness: 12.0, flangeThickness: 20.0, filletRadius: 12 },
    properties: { area: 5316, weight: 41.8 } },
  { id: 'HEM120', name: 'HEM 120', profileType: 'i-beam', standard: 'EN', category: 'HEM',
    parameters: { height: 140, flangeWidth: 126, webThickness: 12.5, flangeThickness: 21.0, filletRadius: 12 },
    properties: { area: 6644, weight: 52.1 } },
  { id: 'HEM140', name: 'HEM 140', profileType: 'i-beam', standard: 'EN', category: 'HEM',
    parameters: { height: 160, flangeWidth: 146, webThickness: 13.0, flangeThickness: 22.0, filletRadius: 12 },
    properties: { area: 8013, weight: 63.2 } },
  { id: 'HEM160', name: 'HEM 160', profileType: 'i-beam', standard: 'EN', category: 'HEM',
    parameters: { height: 180, flangeWidth: 166, webThickness: 14.0, flangeThickness: 23.0, filletRadius: 15 },
    properties: { area: 9726, weight: 76.2 } },
  { id: 'HEM180', name: 'HEM 180', profileType: 'i-beam', standard: 'EN', category: 'HEM',
    parameters: { height: 200, flangeWidth: 186, webThickness: 14.5, flangeThickness: 24.0, filletRadius: 15 },
    properties: { area: 11335, weight: 88.9 } },
  { id: 'HEM200', name: 'HEM 200', profileType: 'i-beam', standard: 'EN', category: 'HEM',
    parameters: { height: 220, flangeWidth: 206, webThickness: 15.0, flangeThickness: 25.0, filletRadius: 18 },
    properties: { area: 13130, weight: 103.0 } },
  { id: 'HEM220', name: 'HEM 220', profileType: 'i-beam', standard: 'EN', category: 'HEM',
    parameters: { height: 240, flangeWidth: 226, webThickness: 15.5, flangeThickness: 26.0, filletRadius: 18 },
    properties: { area: 14944, weight: 117.0 } },
  { id: 'HEM240', name: 'HEM 240', profileType: 'i-beam', standard: 'EN', category: 'HEM',
    parameters: { height: 270, flangeWidth: 248, webThickness: 18.0, flangeThickness: 32.0, filletRadius: 21 },
    properties: { area: 19980, weight: 157.0 } },
  { id: 'HEM260', name: 'HEM 260', profileType: 'i-beam', standard: 'EN', category: 'HEM',
    parameters: { height: 290, flangeWidth: 268, webThickness: 18.0, flangeThickness: 32.5, filletRadius: 24 },
    properties: { area: 22042, weight: 172.0 } },
  { id: 'HEM280', name: 'HEM 280', profileType: 'i-beam', standard: 'EN', category: 'HEM',
    parameters: { height: 310, flangeWidth: 288, webThickness: 18.5, flangeThickness: 33.0, filletRadius: 24 },
    properties: { area: 24016, weight: 189.0 } },
  { id: 'HEM300', name: 'HEM 300', profileType: 'i-beam', standard: 'EN', category: 'HEM',
    parameters: { height: 340, flangeWidth: 310, webThickness: 21.0, flangeThickness: 39.0, filletRadius: 27 },
    properties: { area: 30310, weight: 238.0 } },
  { id: 'HEM320', name: 'HEM 320', profileType: 'i-beam', standard: 'EN', category: 'HEM',
    parameters: { height: 359, flangeWidth: 309, webThickness: 21.0, flangeThickness: 40.0, filletRadius: 27 },
    properties: { area: 31230, weight: 245.0 } },
  { id: 'HEM340', name: 'HEM 340', profileType: 'i-beam', standard: 'EN', category: 'HEM',
    parameters: { height: 377, flangeWidth: 309, webThickness: 21.0, flangeThickness: 40.0, filletRadius: 27 },
    properties: { area: 31580, weight: 248.0 } },
  { id: 'HEM360', name: 'HEM 360', profileType: 'i-beam', standard: 'EN', category: 'HEM',
    parameters: { height: 395, flangeWidth: 308, webThickness: 21.0, flangeThickness: 40.0, filletRadius: 27 },
    properties: { area: 31880, weight: 250.0 } },
  { id: 'HEM400', name: 'HEM 400', profileType: 'i-beam', standard: 'EN', category: 'HEM',
    parameters: { height: 432, flangeWidth: 307, webThickness: 21.0, flangeThickness: 40.0, filletRadius: 27 },
    properties: { area: 32580, weight: 256.0 } },
];

// ============================================================================
// European IPN Profiles (Standard I-beams with tapered flanges)
// ============================================================================

const EN_IPN_SHAPES: ProfilePreset[] = [
  { id: 'IPN-80', name: 'IPN 80', profileType: 'i-beam', standard: 'EN', category: 'IPN',
    parameters: { height: 80, flangeWidth: 42, webThickness: 3.9, flangeThickness: 5.9, filletRadius: 3.9 },
    properties: { area: 757, weight: 5.94 } },
  { id: 'IPN-100', name: 'IPN 100', profileType: 'i-beam', standard: 'EN', category: 'IPN',
    parameters: { height: 100, flangeWidth: 50, webThickness: 4.5, flangeThickness: 6.8, filletRadius: 4.5 },
    properties: { area: 1060, weight: 8.34 } },
  { id: 'IPN-120', name: 'IPN 120', profileType: 'i-beam', standard: 'EN', category: 'IPN',
    parameters: { height: 120, flangeWidth: 58, webThickness: 5.1, flangeThickness: 7.7, filletRadius: 5.1 },
    properties: { area: 1420, weight: 11.1 } },
  { id: 'IPN-140', name: 'IPN 140', profileType: 'i-beam', standard: 'EN', category: 'IPN',
    parameters: { height: 140, flangeWidth: 66, webThickness: 5.7, flangeThickness: 8.6, filletRadius: 5.7 },
    properties: { area: 1830, weight: 14.3 } },
  { id: 'IPN-160', name: 'IPN 160', profileType: 'i-beam', standard: 'EN', category: 'IPN',
    parameters: { height: 160, flangeWidth: 74, webThickness: 6.3, flangeThickness: 9.5, filletRadius: 6.3 },
    properties: { area: 2280, weight: 17.9 } },
  { id: 'IPN-180', name: 'IPN 180', profileType: 'i-beam', standard: 'EN', category: 'IPN',
    parameters: { height: 180, flangeWidth: 82, webThickness: 6.9, flangeThickness: 10.4, filletRadius: 6.9 },
    properties: { area: 2790, weight: 21.9 } },
  { id: 'IPN-200', name: 'IPN 200', profileType: 'i-beam', standard: 'EN', category: 'IPN',
    parameters: { height: 200, flangeWidth: 90, webThickness: 7.5, flangeThickness: 11.3, filletRadius: 7.5 },
    properties: { area: 3340, weight: 26.2 } },
  { id: 'IPN-220', name: 'IPN 220', profileType: 'i-beam', standard: 'EN', category: 'IPN',
    parameters: { height: 220, flangeWidth: 98, webThickness: 8.1, flangeThickness: 12.2, filletRadius: 8.1 },
    properties: { area: 3950, weight: 31.1 } },
  { id: 'IPN-240', name: 'IPN 240', profileType: 'i-beam', standard: 'EN', category: 'IPN',
    parameters: { height: 240, flangeWidth: 106, webThickness: 8.7, flangeThickness: 13.1, filletRadius: 8.7 },
    properties: { area: 4610, weight: 36.2 } },
  { id: 'IPN-260', name: 'IPN 260', profileType: 'i-beam', standard: 'EN', category: 'IPN',
    parameters: { height: 260, flangeWidth: 113, webThickness: 9.4, flangeThickness: 14.1, filletRadius: 9.4 },
    properties: { area: 5340, weight: 41.9 } },
  { id: 'IPN-280', name: 'IPN 280', profileType: 'i-beam', standard: 'EN', category: 'IPN',
    parameters: { height: 280, flangeWidth: 119, webThickness: 10.1, flangeThickness: 15.2, filletRadius: 10.1 },
    properties: { area: 6100, weight: 47.9 } },
  { id: 'IPN-300', name: 'IPN 300', profileType: 'i-beam', standard: 'EN', category: 'IPN',
    parameters: { height: 300, flangeWidth: 125, webThickness: 10.8, flangeThickness: 16.2, filletRadius: 10.8 },
    properties: { area: 6900, weight: 54.2 } },
  { id: 'IPN-340', name: 'IPN 340', profileType: 'i-beam', standard: 'EN', category: 'IPN',
    parameters: { height: 340, flangeWidth: 137, webThickness: 12.2, flangeThickness: 18.3, filletRadius: 12.2 },
    properties: { area: 8680, weight: 68.0 } },
  { id: 'IPN-360', name: 'IPN 360', profileType: 'i-beam', standard: 'EN', category: 'IPN',
    parameters: { height: 360, flangeWidth: 143, webThickness: 13.0, flangeThickness: 19.5, filletRadius: 13.0 },
    properties: { area: 9720, weight: 76.1 } },
  { id: 'IPN-400', name: 'IPN 400', profileType: 'i-beam', standard: 'EN', category: 'IPN',
    parameters: { height: 400, flangeWidth: 155, webThickness: 14.4, flangeThickness: 21.6, filletRadius: 14.4 },
    properties: { area: 11800, weight: 92.4 } },
];

// ============================================================================
// European UPN Profiles (Standard Channels)
// ============================================================================

const EN_UPN_SHAPES: ProfilePreset[] = [
  { id: 'UPN-80', name: 'UPN 80', profileType: 'channel', standard: 'EN', category: 'UPN',
    parameters: { height: 80, flangeWidth: 45, webThickness: 6.0, flangeThickness: 8.0, filletRadius: 8.0 },
    properties: { area: 1100, weight: 8.64 } },
  { id: 'UPN-100', name: 'UPN 100', profileType: 'channel', standard: 'EN', category: 'UPN',
    parameters: { height: 100, flangeWidth: 50, webThickness: 6.0, flangeThickness: 8.5, filletRadius: 8.5 },
    properties: { area: 1350, weight: 10.6 } },
  { id: 'UPN-120', name: 'UPN 120', profileType: 'channel', standard: 'EN', category: 'UPN',
    parameters: { height: 120, flangeWidth: 55, webThickness: 7.0, flangeThickness: 9.0, filletRadius: 9.0 },
    properties: { area: 1700, weight: 13.4 } },
  { id: 'UPN-140', name: 'UPN 140', profileType: 'channel', standard: 'EN', category: 'UPN',
    parameters: { height: 140, flangeWidth: 60, webThickness: 7.0, flangeThickness: 10.0, filletRadius: 10.0 },
    properties: { area: 2040, weight: 16.0 } },
  { id: 'UPN-160', name: 'UPN 160', profileType: 'channel', standard: 'EN', category: 'UPN',
    parameters: { height: 160, flangeWidth: 65, webThickness: 7.5, flangeThickness: 10.5, filletRadius: 10.5 },
    properties: { area: 2400, weight: 18.8 } },
  { id: 'UPN-180', name: 'UPN 180', profileType: 'channel', standard: 'EN', category: 'UPN',
    parameters: { height: 180, flangeWidth: 70, webThickness: 8.0, flangeThickness: 11.0, filletRadius: 11.0 },
    properties: { area: 2800, weight: 22.0 } },
  { id: 'UPN-200', name: 'UPN 200', profileType: 'channel', standard: 'EN', category: 'UPN',
    parameters: { height: 200, flangeWidth: 75, webThickness: 8.5, flangeThickness: 11.5, filletRadius: 11.5 },
    properties: { area: 3220, weight: 25.3 } },
  { id: 'UPN-220', name: 'UPN 220', profileType: 'channel', standard: 'EN', category: 'UPN',
    parameters: { height: 220, flangeWidth: 80, webThickness: 9.0, flangeThickness: 12.5, filletRadius: 12.5 },
    properties: { area: 3740, weight: 29.4 } },
  { id: 'UPN-240', name: 'UPN 240', profileType: 'channel', standard: 'EN', category: 'UPN',
    parameters: { height: 240, flangeWidth: 85, webThickness: 9.5, flangeThickness: 13.0, filletRadius: 13.0 },
    properties: { area: 4230, weight: 33.2 } },
  { id: 'UPN-260', name: 'UPN 260', profileType: 'channel', standard: 'EN', category: 'UPN',
    parameters: { height: 260, flangeWidth: 90, webThickness: 10.0, flangeThickness: 14.0, filletRadius: 14.0 },
    properties: { area: 4830, weight: 37.9 } },
  { id: 'UPN-280', name: 'UPN 280', profileType: 'channel', standard: 'EN', category: 'UPN',
    parameters: { height: 280, flangeWidth: 95, webThickness: 10.0, flangeThickness: 15.0, filletRadius: 15.0 },
    properties: { area: 5330, weight: 41.8 } },
  { id: 'UPN-300', name: 'UPN 300', profileType: 'channel', standard: 'EN', category: 'UPN',
    parameters: { height: 300, flangeWidth: 100, webThickness: 10.0, flangeThickness: 16.0, filletRadius: 16.0 },
    properties: { area: 5880, weight: 46.2 } },
];

// ============================================================================
// European Equal Leg Angles (EN 10056)
// ============================================================================

const EN_EQUAL_ANGLES: ProfilePreset[] = [
  { id: 'L-20x20x3', name: 'L 20x20x3', profileType: 'angle', standard: 'EN', category: 'L-Equal',
    parameters: { leg1: 20, leg2: 20, thickness: 3, filletRadius: 3.5, toeRadius: 1.2 },
    properties: { area: 113, weight: 0.882 } },
  { id: 'L-25x25x3', name: 'L 25x25x3', profileType: 'angle', standard: 'EN', category: 'L-Equal',
    parameters: { leg1: 25, leg2: 25, thickness: 3, filletRadius: 3.5, toeRadius: 1.2 },
    properties: { area: 143, weight: 1.12 } },
  { id: 'L-30x30x3', name: 'L 30x30x3', profileType: 'angle', standard: 'EN', category: 'L-Equal',
    parameters: { leg1: 30, leg2: 30, thickness: 3, filletRadius: 5.0, toeRadius: 1.5 },
    properties: { area: 174, weight: 1.36 } },
  { id: 'L-40x40x4', name: 'L 40x40x4', profileType: 'angle', standard: 'EN', category: 'L-Equal',
    parameters: { leg1: 40, leg2: 40, thickness: 4, filletRadius: 6.0, toeRadius: 2.0 },
    properties: { area: 308, weight: 2.42 } },
  { id: 'L-50x50x5', name: 'L 50x50x5', profileType: 'angle', standard: 'EN', category: 'L-Equal',
    parameters: { leg1: 50, leg2: 50, thickness: 5, filletRadius: 7.0, toeRadius: 2.3 },
    properties: { area: 480, weight: 3.77 } },
  { id: 'L-60x60x6', name: 'L 60x60x6', profileType: 'angle', standard: 'EN', category: 'L-Equal',
    parameters: { leg1: 60, leg2: 60, thickness: 6, filletRadius: 8.0, toeRadius: 2.7 },
    properties: { area: 691, weight: 5.42 } },
  { id: 'L-70x70x7', name: 'L 70x70x7', profileType: 'angle', standard: 'EN', category: 'L-Equal',
    parameters: { leg1: 70, leg2: 70, thickness: 7, filletRadius: 9.0, toeRadius: 3.0 },
    properties: { area: 940, weight: 7.38 } },
  { id: 'L-80x80x8', name: 'L 80x80x8', profileType: 'angle', standard: 'EN', category: 'L-Equal',
    parameters: { leg1: 80, leg2: 80, thickness: 8, filletRadius: 10.0, toeRadius: 3.3 },
    properties: { area: 1230, weight: 9.63 } },
  { id: 'L-90x90x9', name: 'L 90x90x9', profileType: 'angle', standard: 'EN', category: 'L-Equal',
    parameters: { leg1: 90, leg2: 90, thickness: 9, filletRadius: 11.0, toeRadius: 3.7 },
    properties: { area: 1550, weight: 12.2 } },
  { id: 'L-100x100x10', name: 'L 100x100x10', profileType: 'angle', standard: 'EN', category: 'L-Equal',
    parameters: { leg1: 100, leg2: 100, thickness: 10, filletRadius: 12.0, toeRadius: 4.0 },
    properties: { area: 1920, weight: 15.0 } },
  { id: 'L-120x120x12', name: 'L 120x120x12', profileType: 'angle', standard: 'EN', category: 'L-Equal',
    parameters: { leg1: 120, leg2: 120, thickness: 12, filletRadius: 13.0, toeRadius: 4.3 },
    properties: { area: 2760, weight: 21.6 } },
  { id: 'L-150x150x15', name: 'L 150x150x15', profileType: 'angle', standard: 'EN', category: 'L-Equal',
    parameters: { leg1: 150, leg2: 150, thickness: 15, filletRadius: 16.0, toeRadius: 5.3 },
    properties: { area: 4300, weight: 33.8 } },
];

// ============================================================================
// European Unequal Leg Angles (EN 10056)
// ============================================================================

const EN_UNEQUAL_ANGLES: ProfilePreset[] = [
  { id: 'L-40x20x4', name: 'L 40x20x4', profileType: 'angle', standard: 'EN', category: 'L-Unequal',
    parameters: { leg1: 40, leg2: 20, thickness: 4, filletRadius: 5.0, toeRadius: 1.5 },
    properties: { area: 225, weight: 1.77 } },
  { id: 'L-50x30x5', name: 'L 50x30x5', profileType: 'angle', standard: 'EN', category: 'L-Unequal',
    parameters: { leg1: 50, leg2: 30, thickness: 5, filletRadius: 7.0, toeRadius: 2.3 },
    properties: { area: 381, weight: 2.99 } },
  { id: 'L-60x40x5', name: 'L 60x40x5', profileType: 'angle', standard: 'EN', category: 'L-Unequal',
    parameters: { leg1: 60, leg2: 40, thickness: 5, filletRadius: 7.0, toeRadius: 2.3 },
    properties: { area: 480, weight: 3.76 } },
  { id: 'L-65x50x5', name: 'L 65x50x5', profileType: 'angle', standard: 'EN', category: 'L-Unequal',
    parameters: { leg1: 65, leg2: 50, thickness: 5, filletRadius: 7.0, toeRadius: 2.3 },
    properties: { area: 554, weight: 4.35 } },
  { id: 'L-75x50x6', name: 'L 75x50x6', profileType: 'angle', standard: 'EN', category: 'L-Unequal',
    parameters: { leg1: 75, leg2: 50, thickness: 6, filletRadius: 8.0, toeRadius: 2.7 },
    properties: { area: 720, weight: 5.65 } },
  { id: 'L-80x60x7', name: 'L 80x60x7', profileType: 'angle', standard: 'EN', category: 'L-Unequal',
    parameters: { leg1: 80, leg2: 60, thickness: 7, filletRadius: 9.0, toeRadius: 3.0 },
    properties: { area: 940, weight: 7.36 } },
  { id: 'L-100x65x8', name: 'L 100x65x8', profileType: 'angle', standard: 'EN', category: 'L-Unequal',
    parameters: { leg1: 100, leg2: 65, thickness: 8, filletRadius: 10.0, toeRadius: 3.3 },
    properties: { area: 1260, weight: 9.94 } },
  { id: 'L-100x75x8', name: 'L 100x75x8', profileType: 'angle', standard: 'EN', category: 'L-Unequal',
    parameters: { leg1: 100, leg2: 75, thickness: 8, filletRadius: 10.0, toeRadius: 3.3 },
    properties: { area: 1340, weight: 10.5 } },
  { id: 'L-120x80x10', name: 'L 120x80x10', profileType: 'angle', standard: 'EN', category: 'L-Unequal',
    parameters: { leg1: 120, leg2: 80, thickness: 10, filletRadius: 11.0, toeRadius: 3.7 },
    properties: { area: 1920, weight: 15.0 } },
  { id: 'L-150x90x12', name: 'L 150x90x12', profileType: 'angle', standard: 'EN', category: 'L-Unequal',
    parameters: { leg1: 150, leg2: 90, thickness: 12, filletRadius: 13.0, toeRadius: 4.3 },
    properties: { area: 2760, weight: 21.7 } },
];

// ============================================================================
// BS Universal Beams (BS 4 Part 1)
// ============================================================================

const BS_UB_SHAPES: ProfilePreset[] = [
  { id: 'UB127x76x13', name: 'UB 127x76x13', profileType: 'i-beam', standard: 'BS', category: 'UB',
    parameters: { height: 127.0, flangeWidth: 76.0, webThickness: 4.0, flangeThickness: 7.6, filletRadius: 7.6 },
    properties: { area: 1650, weight: 13.0 } },
  { id: 'UB152x89x16', name: 'UB 152x89x16', profileType: 'i-beam', standard: 'BS', category: 'UB',
    parameters: { height: 152.4, flangeWidth: 88.7, webThickness: 4.5, flangeThickness: 7.7, filletRadius: 7.6 },
    properties: { area: 2030, weight: 16.0 } },
  { id: 'UB178x102x19', name: 'UB 178x102x19', profileType: 'i-beam', standard: 'BS', category: 'UB',
    parameters: { height: 177.8, flangeWidth: 101.2, webThickness: 4.8, flangeThickness: 7.9, filletRadius: 7.6 },
    properties: { area: 2430, weight: 19.0 } },
  { id: 'UB203x102x23', name: 'UB 203x102x23', profileType: 'i-beam', standard: 'BS', category: 'UB',
    parameters: { height: 203.2, flangeWidth: 101.8, webThickness: 5.4, flangeThickness: 9.3, filletRadius: 7.6 },
    properties: { area: 2940, weight: 23.1 } },
  { id: 'UB203x133x25', name: 'UB 203x133x25', profileType: 'i-beam', standard: 'BS', category: 'UB',
    parameters: { height: 203.2, flangeWidth: 133.2, webThickness: 5.7, flangeThickness: 7.8, filletRadius: 7.6 },
    properties: { area: 3200, weight: 25.1 } },
  { id: 'UB203x133x30', name: 'UB 203x133x30', profileType: 'i-beam', standard: 'BS', category: 'UB',
    parameters: { height: 206.8, flangeWidth: 133.9, webThickness: 6.4, flangeThickness: 9.6, filletRadius: 7.6 },
    properties: { area: 3820, weight: 30.0 } },
  { id: 'UB254x102x28', name: 'UB 254x102x28', profileType: 'i-beam', standard: 'BS', category: 'UB',
    parameters: { height: 260.4, flangeWidth: 102.2, webThickness: 6.3, flangeThickness: 10.0, filletRadius: 7.6 },
    properties: { area: 3620, weight: 28.3 } },
  { id: 'UB254x146x31', name: 'UB 254x146x31', profileType: 'i-beam', standard: 'BS', category: 'UB',
    parameters: { height: 251.4, flangeWidth: 146.1, webThickness: 6.0, flangeThickness: 8.6, filletRadius: 7.6 },
    properties: { area: 3970, weight: 31.1 } },
  { id: 'UB254x146x37', name: 'UB 254x146x37', profileType: 'i-beam', standard: 'BS', category: 'UB',
    parameters: { height: 256.0, flangeWidth: 146.4, webThickness: 6.3, flangeThickness: 10.9, filletRadius: 7.6 },
    properties: { area: 4720, weight: 37.0 } },
  { id: 'UB305x102x25', name: 'UB 305x102x25', profileType: 'i-beam', standard: 'BS', category: 'UB',
    parameters: { height: 305.1, flangeWidth: 101.6, webThickness: 5.8, flangeThickness: 7.0, filletRadius: 7.6 },
    properties: { area: 3160, weight: 24.8 } },
  { id: 'UB305x165x40', name: 'UB 305x165x40', profileType: 'i-beam', standard: 'BS', category: 'UB',
    parameters: { height: 303.4, flangeWidth: 165.0, webThickness: 6.0, flangeThickness: 10.2, filletRadius: 8.9 },
    properties: { area: 5130, weight: 40.3 } },
  { id: 'UB356x171x45', name: 'UB 356x171x45', profileType: 'i-beam', standard: 'BS', category: 'UB',
    parameters: { height: 351.4, flangeWidth: 171.1, webThickness: 7.0, flangeThickness: 9.7, filletRadius: 10.2 },
    properties: { area: 5730, weight: 45.0 } },
  { id: 'UB356x171x57', name: 'UB 356x171x57', profileType: 'i-beam', standard: 'BS', category: 'UB',
    parameters: { height: 358.0, flangeWidth: 172.2, webThickness: 8.1, flangeThickness: 13.0, filletRadius: 10.2 },
    properties: { area: 7260, weight: 57.0 } },
  { id: 'UB406x178x54', name: 'UB 406x178x54', profileType: 'i-beam', standard: 'BS', category: 'UB',
    parameters: { height: 402.6, flangeWidth: 177.7, webThickness: 7.7, flangeThickness: 10.9, filletRadius: 10.2 },
    properties: { area: 6900, weight: 54.1 } },
  { id: 'UB406x178x67', name: 'UB 406x178x67', profileType: 'i-beam', standard: 'BS', category: 'UB',
    parameters: { height: 409.4, flangeWidth: 178.8, webThickness: 8.8, flangeThickness: 14.3, filletRadius: 10.2 },
    properties: { area: 8550, weight: 67.1 } },
];

// ============================================================================
// BS Universal Columns (BS 4 Part 1)
// ============================================================================

const BS_UC_SHAPES: ProfilePreset[] = [
  { id: 'UC152x152x23', name: 'UC 152x152x23', profileType: 'i-beam', standard: 'BS', category: 'UC',
    parameters: { height: 152.4, flangeWidth: 152.2, webThickness: 5.8, flangeThickness: 6.8, filletRadius: 7.6 },
    properties: { area: 2920, weight: 23.0 } },
  { id: 'UC152x152x30', name: 'UC 152x152x30', profileType: 'i-beam', standard: 'BS', category: 'UC',
    parameters: { height: 157.6, flangeWidth: 152.9, webThickness: 6.5, flangeThickness: 9.4, filletRadius: 7.6 },
    properties: { area: 3830, weight: 30.0 } },
  { id: 'UC152x152x37', name: 'UC 152x152x37', profileType: 'i-beam', standard: 'BS', category: 'UC',
    parameters: { height: 161.8, flangeWidth: 154.4, webThickness: 8.0, flangeThickness: 11.5, filletRadius: 7.6 },
    properties: { area: 4710, weight: 37.0 } },
  { id: 'UC203x203x46', name: 'UC 203x203x46', profileType: 'i-beam', standard: 'BS', category: 'UC',
    parameters: { height: 203.2, flangeWidth: 203.6, webThickness: 7.2, flangeThickness: 11.0, filletRadius: 10.2 },
    properties: { area: 5870, weight: 46.1 } },
  { id: 'UC203x203x60', name: 'UC 203x203x60', profileType: 'i-beam', standard: 'BS', category: 'UC',
    parameters: { height: 209.6, flangeWidth: 205.8, webThickness: 9.4, flangeThickness: 14.2, filletRadius: 10.2 },
    properties: { area: 7640, weight: 60.0 } },
  { id: 'UC203x203x71', name: 'UC 203x203x71', profileType: 'i-beam', standard: 'BS', category: 'UC',
    parameters: { height: 215.8, flangeWidth: 206.4, webThickness: 10.0, flangeThickness: 17.3, filletRadius: 10.2 },
    properties: { area: 9040, weight: 71.0 } },
  { id: 'UC254x254x73', name: 'UC 254x254x73', profileType: 'i-beam', standard: 'BS', category: 'UC',
    parameters: { height: 254.1, flangeWidth: 254.6, webThickness: 8.6, flangeThickness: 14.2, filletRadius: 12.7 },
    properties: { area: 9310, weight: 73.1 } },
  { id: 'UC254x254x89', name: 'UC 254x254x89', profileType: 'i-beam', standard: 'BS', category: 'UC',
    parameters: { height: 260.3, flangeWidth: 256.3, webThickness: 10.3, flangeThickness: 17.3, filletRadius: 12.7 },
    properties: { area: 11400, weight: 88.9 } },
  { id: 'UC254x254x107', name: 'UC 254x254x107', profileType: 'i-beam', standard: 'BS', category: 'UC',
    parameters: { height: 266.7, flangeWidth: 258.8, webThickness: 12.8, flangeThickness: 20.5, filletRadius: 12.7 },
    properties: { area: 13600, weight: 107.1 } },
  { id: 'UC305x305x97', name: 'UC 305x305x97', profileType: 'i-beam', standard: 'BS', category: 'UC',
    parameters: { height: 307.9, flangeWidth: 305.3, webThickness: 9.9, flangeThickness: 15.4, filletRadius: 15.2 },
    properties: { area: 12300, weight: 96.9 } },
  { id: 'UC305x305x118', name: 'UC 305x305x118', profileType: 'i-beam', standard: 'BS', category: 'UC',
    parameters: { height: 314.5, flangeWidth: 307.4, webThickness: 12.0, flangeThickness: 18.7, filletRadius: 15.2 },
    properties: { area: 15000, weight: 117.9 } },
  { id: 'UC305x305x137', name: 'UC 305x305x137', profileType: 'i-beam', standard: 'BS', category: 'UC',
    parameters: { height: 320.5, flangeWidth: 309.2, webThickness: 13.8, flangeThickness: 21.7, filletRadius: 15.2 },
    properties: { area: 17400, weight: 136.9 } },
  { id: 'UC356x368x129', name: 'UC 356x368x129', profileType: 'i-beam', standard: 'BS', category: 'UC',
    parameters: { height: 355.6, flangeWidth: 368.6, webThickness: 10.4, flangeThickness: 17.5, filletRadius: 15.2 },
    properties: { area: 16400, weight: 129.0 } },
  { id: 'UC356x368x153', name: 'UC 356x368x153', profileType: 'i-beam', standard: 'BS', category: 'UC',
    parameters: { height: 362.0, flangeWidth: 370.5, webThickness: 12.3, flangeThickness: 20.7, filletRadius: 15.2 },
    properties: { area: 19500, weight: 153.0 } },
];

// ============================================================================
// BS Parallel Flange Channels (BS 4 Part 1)
// ============================================================================

const BS_PFC_SHAPES: ProfilePreset[] = [
  { id: 'PFC100x50x10', name: 'PFC 100x50x10', profileType: 'channel', standard: 'BS', category: 'PFC',
    parameters: { height: 100, flangeWidth: 50, webThickness: 5.0, flangeThickness: 8.5, filletRadius: 12 },
    properties: { area: 1290, weight: 10.2 } },
  { id: 'PFC125x65x15', name: 'PFC 125x65x15', profileType: 'channel', standard: 'BS', category: 'PFC',
    parameters: { height: 125, flangeWidth: 65, webThickness: 5.5, flangeThickness: 9.5, filletRadius: 12 },
    properties: { area: 1880, weight: 14.8 } },
  { id: 'PFC150x75x18', name: 'PFC 150x75x18', profileType: 'channel', standard: 'BS', category: 'PFC',
    parameters: { height: 150, flangeWidth: 75, webThickness: 5.5, flangeThickness: 10.0, filletRadius: 12 },
    properties: { area: 2280, weight: 17.9 } },
  { id: 'PFC150x90x24', name: 'PFC 150x90x24', profileType: 'channel', standard: 'BS', category: 'PFC',
    parameters: { height: 150, flangeWidth: 90, webThickness: 6.5, flangeThickness: 12.0, filletRadius: 12 },
    properties: { area: 3010, weight: 23.9 } },
  { id: 'PFC200x75x23', name: 'PFC 200x75x23', profileType: 'channel', standard: 'BS', category: 'PFC',
    parameters: { height: 200, flangeWidth: 75, webThickness: 6.0, flangeThickness: 12.5, filletRadius: 12 },
    properties: { area: 2950, weight: 23.4 } },
  { id: 'PFC200x90x30', name: 'PFC 200x90x30', profileType: 'channel', standard: 'BS', category: 'PFC',
    parameters: { height: 200, flangeWidth: 90, webThickness: 7.0, flangeThickness: 14.0, filletRadius: 12 },
    properties: { area: 3810, weight: 29.7 } },
  { id: 'PFC230x90x32', name: 'PFC 230x90x32', profileType: 'channel', standard: 'BS', category: 'PFC',
    parameters: { height: 230, flangeWidth: 90, webThickness: 7.5, flangeThickness: 14.0, filletRadius: 12 },
    properties: { area: 4080, weight: 32.2 } },
  { id: 'PFC260x75x28', name: 'PFC 260x75x28', profileType: 'channel', standard: 'BS', category: 'PFC',
    parameters: { height: 260, flangeWidth: 75, webThickness: 7.0, flangeThickness: 13.5, filletRadius: 12 },
    properties: { area: 3600, weight: 27.6 } },
  { id: 'PFC260x90x35', name: 'PFC 260x90x35', profileType: 'channel', standard: 'BS', category: 'PFC',
    parameters: { height: 260, flangeWidth: 90, webThickness: 8.0, flangeThickness: 14.0, filletRadius: 12 },
    properties: { area: 4450, weight: 34.8 } },
  { id: 'PFC300x90x41', name: 'PFC 300x90x41', profileType: 'channel', standard: 'BS', category: 'PFC',
    parameters: { height: 300, flangeWidth: 90, webThickness: 9.0, flangeThickness: 15.5, filletRadius: 12 },
    properties: { area: 5270, weight: 41.4 } },
  { id: 'PFC380x100x54', name: 'PFC 380x100x54', profileType: 'channel', standard: 'BS', category: 'PFC',
    parameters: { height: 380, flangeWidth: 100, webThickness: 9.5, flangeThickness: 17.5, filletRadius: 14 },
    properties: { area: 6870, weight: 54.0 } },
];

// ============================================================================
// JIS H-Shapes (JIS G 3192)
// ============================================================================

const JIS_H_SHAPES: ProfilePreset[] = [
  { id: 'H100x100x6x8', name: 'H 100x100x6x8', profileType: 'i-beam', standard: 'JIS', category: 'H-Shapes',
    parameters: { height: 100, flangeWidth: 100, webThickness: 6, flangeThickness: 8, filletRadius: 8 },
    properties: { area: 2159, weight: 16.9 } },
  { id: 'H125x125x6.5x9', name: 'H 125x125x6.5x9', profileType: 'i-beam', standard: 'JIS', category: 'H-Shapes',
    parameters: { height: 125, flangeWidth: 125, webThickness: 6.5, flangeThickness: 9, filletRadius: 8 },
    properties: { area: 3000, weight: 23.6 } },
  { id: 'H150x150x7x10', name: 'H 150x150x7x10', profileType: 'i-beam', standard: 'JIS', category: 'H-Shapes',
    parameters: { height: 150, flangeWidth: 150, webThickness: 7, flangeThickness: 10, filletRadius: 8 },
    properties: { area: 3965, weight: 31.1 } },
  { id: 'H175x175x7.5x11', name: 'H 175x175x7.5x11', profileType: 'i-beam', standard: 'JIS', category: 'H-Shapes',
    parameters: { height: 175, flangeWidth: 175, webThickness: 7.5, flangeThickness: 11, filletRadius: 8 },
    properties: { area: 5121, weight: 40.4 } },
  { id: 'H200x200x8x12', name: 'H 200x200x8x12', profileType: 'i-beam', standard: 'JIS', category: 'H-Shapes',
    parameters: { height: 200, flangeWidth: 200, webThickness: 8, flangeThickness: 12, filletRadius: 13 },
    properties: { area: 6353, weight: 49.9 } },
  { id: 'H250x250x9x14', name: 'H 250x250x9x14', profileType: 'i-beam', standard: 'JIS', category: 'H-Shapes',
    parameters: { height: 250, flangeWidth: 250, webThickness: 9, flangeThickness: 14, filletRadius: 13 },
    properties: { area: 9218, weight: 72.4 } },
  { id: 'H300x300x10x15', name: 'H 300x300x10x15', profileType: 'i-beam', standard: 'JIS', category: 'H-Shapes',
    parameters: { height: 300, flangeWidth: 300, webThickness: 10, flangeThickness: 15, filletRadius: 13 },
    properties: { area: 11980, weight: 94.0 } },
  { id: 'H350x350x12x19', name: 'H 350x350x12x19', profileType: 'i-beam', standard: 'JIS', category: 'H-Shapes',
    parameters: { height: 350, flangeWidth: 350, webThickness: 12, flangeThickness: 19, filletRadius: 13 },
    properties: { area: 17390, weight: 137.0 } },
  { id: 'H400x400x13x21', name: 'H 400x400x13x21', profileType: 'i-beam', standard: 'JIS', category: 'H-Shapes',
    parameters: { height: 400, flangeWidth: 400, webThickness: 13, flangeThickness: 21, filletRadius: 22 },
    properties: { area: 21870, weight: 172.0 } },
  { id: 'H148x100x6x9', name: 'H 148x100x6x9', profileType: 'i-beam', standard: 'JIS', category: 'H-Shapes',
    parameters: { height: 148, flangeWidth: 100, webThickness: 6, flangeThickness: 9, filletRadius: 11 },
    properties: { area: 2684, weight: 21.1 } },
  { id: 'H194x150x6x9', name: 'H 194x150x6x9', profileType: 'i-beam', standard: 'JIS', category: 'H-Shapes',
    parameters: { height: 194, flangeWidth: 150, webThickness: 6, flangeThickness: 9, filletRadius: 13 },
    properties: { area: 3811, weight: 29.9 } },
  { id: 'H244x175x7x11', name: 'H 244x175x7x11', profileType: 'i-beam', standard: 'JIS', category: 'H-Shapes',
    parameters: { height: 244, flangeWidth: 175, webThickness: 7, flangeThickness: 11, filletRadius: 13 },
    properties: { area: 5560, weight: 43.6 } },
  { id: 'H294x200x8x12', name: 'H 294x200x8x12', profileType: 'i-beam', standard: 'JIS', category: 'H-Shapes',
    parameters: { height: 294, flangeWidth: 200, webThickness: 8, flangeThickness: 12, filletRadius: 13 },
    properties: { area: 7120, weight: 55.8 } },
  { id: 'H340x250x9x14', name: 'H 340x250x9x14', profileType: 'i-beam', standard: 'JIS', category: 'H-Shapes',
    parameters: { height: 340, flangeWidth: 250, webThickness: 9, flangeThickness: 14, filletRadius: 13 },
    properties: { area: 10150, weight: 79.7 } },
  { id: 'H390x300x10x16', name: 'H 390x300x10x16', profileType: 'i-beam', standard: 'JIS', category: 'H-Shapes',
    parameters: { height: 390, flangeWidth: 300, webThickness: 10, flangeThickness: 16, filletRadius: 13 },
    properties: { area: 13620, weight: 107.0 } },
];

// ============================================================================
// JIS Channels (JIS G 3192)
// ============================================================================

const JIS_CHANNEL_SHAPES: ProfilePreset[] = [
  { id: 'C75x40x5x7', name: 'C 75x40x5x7', profileType: 'channel', standard: 'JIS', category: 'Channels',
    parameters: { height: 75, flangeWidth: 40, webThickness: 5, flangeThickness: 7, filletRadius: 8 },
    properties: { area: 898, weight: 6.92 } },
  { id: 'C100x50x5x7.5', name: 'C 100x50x5x7.5', profileType: 'channel', standard: 'JIS', category: 'Channels',
    parameters: { height: 100, flangeWidth: 50, webThickness: 5, flangeThickness: 7.5, filletRadius: 8 },
    properties: { area: 1192, weight: 9.36 } },
  { id: 'C125x65x6x8', name: 'C 125x65x6x8', profileType: 'channel', standard: 'JIS', category: 'Channels',
    parameters: { height: 125, flangeWidth: 65, webThickness: 6, flangeThickness: 8, filletRadius: 8 },
    properties: { area: 1738, weight: 13.4 } },
  { id: 'C150x75x6.5x10', name: 'C 150x75x6.5x10', profileType: 'channel', standard: 'JIS', category: 'Channels',
    parameters: { height: 150, flangeWidth: 75, webThickness: 6.5, flangeThickness: 10, filletRadius: 11 },
    properties: { area: 2397, weight: 18.6 } },
  { id: 'C200x80x7.5x11', name: 'C 200x80x7.5x11', profileType: 'channel', standard: 'JIS', category: 'Channels',
    parameters: { height: 200, flangeWidth: 80, webThickness: 7.5, flangeThickness: 11, filletRadius: 11 },
    properties: { area: 3168, weight: 24.6 } },
  { id: 'C250x90x9x13', name: 'C 250x90x9x13', profileType: 'channel', standard: 'JIS', category: 'Channels',
    parameters: { height: 250, flangeWidth: 90, webThickness: 9, flangeThickness: 13, filletRadius: 12 },
    properties: { area: 4430, weight: 34.6 } },
  { id: 'C300x90x10x15.5', name: 'C 300x90x10x15.5', profileType: 'channel', standard: 'JIS', category: 'Channels',
    parameters: { height: 300, flangeWidth: 90, webThickness: 10, flangeThickness: 15.5, filletRadius: 12 },
    properties: { area: 5374, weight: 42.2 } },
  { id: 'C380x100x10.5x16', name: 'C 380x100x10.5x16', profileType: 'channel', standard: 'JIS', category: 'Channels',
    parameters: { height: 380, flangeWidth: 100, webThickness: 10.5, flangeThickness: 16, filletRadius: 13 },
    properties: { area: 6554, weight: 50.4 } },
];

// ============================================================================
// Indian Standard Medium Weight Beams (IS 808)
// ============================================================================

const IS_ISMB_SHAPES: ProfilePreset[] = [
  { id: 'ISMB100', name: 'ISMB 100', profileType: 'i-beam', standard: 'IS', category: 'ISMB',
    parameters: { height: 100, flangeWidth: 75, webThickness: 4.0, flangeThickness: 7.2, filletRadius: 9 },
    properties: { area: 1460, weight: 11.5 } },
  { id: 'ISMB125', name: 'ISMB 125', profileType: 'i-beam', standard: 'IS', category: 'ISMB',
    parameters: { height: 125, flangeWidth: 75, webThickness: 5.0, flangeThickness: 7.6, filletRadius: 9 },
    properties: { area: 1660, weight: 13.0 } },
  { id: 'ISMB150', name: 'ISMB 150', profileType: 'i-beam', standard: 'IS', category: 'ISMB',
    parameters: { height: 150, flangeWidth: 80, webThickness: 4.8, flangeThickness: 7.6, filletRadius: 9 },
    properties: { area: 1900, weight: 14.9 } },
  { id: 'ISMB175', name: 'ISMB 175', profileType: 'i-beam', standard: 'IS', category: 'ISMB',
    parameters: { height: 175, flangeWidth: 90, webThickness: 5.5, flangeThickness: 8.6, filletRadius: 9 },
    properties: { area: 2462, weight: 19.3 } },
  { id: 'ISMB200', name: 'ISMB 200', profileType: 'i-beam', standard: 'IS', category: 'ISMB',
    parameters: { height: 200, flangeWidth: 100, webThickness: 5.7, flangeThickness: 10.8, filletRadius: 9 },
    properties: { area: 3233, weight: 25.4 } },
  { id: 'ISMB225', name: 'ISMB 225', profileType: 'i-beam', standard: 'IS', category: 'ISMB',
    parameters: { height: 225, flangeWidth: 110, webThickness: 6.5, flangeThickness: 11.8, filletRadius: 12 },
    properties: { area: 3972, weight: 31.2 } },
  { id: 'ISMB250', name: 'ISMB 250', profileType: 'i-beam', standard: 'IS', category: 'ISMB',
    parameters: { height: 250, flangeWidth: 125, webThickness: 6.9, flangeThickness: 12.5, filletRadius: 12 },
    properties: { area: 4755, weight: 37.3 } },
  { id: 'ISMB300', name: 'ISMB 300', profileType: 'i-beam', standard: 'IS', category: 'ISMB',
    parameters: { height: 300, flangeWidth: 140, webThickness: 7.5, flangeThickness: 12.4, filletRadius: 14 },
    properties: { area: 5626, weight: 44.2 } },
  { id: 'ISMB350', name: 'ISMB 350', profileType: 'i-beam', standard: 'IS', category: 'ISMB',
    parameters: { height: 350, flangeWidth: 140, webThickness: 8.1, flangeThickness: 14.2, filletRadius: 14 },
    properties: { area: 6671, weight: 52.4 } },
  { id: 'ISMB400', name: 'ISMB 400', profileType: 'i-beam', standard: 'IS', category: 'ISMB',
    parameters: { height: 400, flangeWidth: 140, webThickness: 8.9, flangeThickness: 16.0, filletRadius: 14 },
    properties: { area: 7846, weight: 61.6 } },
  { id: 'ISMB450', name: 'ISMB 450', profileType: 'i-beam', standard: 'IS', category: 'ISMB',
    parameters: { height: 450, flangeWidth: 150, webThickness: 9.4, flangeThickness: 17.4, filletRadius: 15 },
    properties: { area: 9227, weight: 72.4 } },
  { id: 'ISMB500', name: 'ISMB 500', profileType: 'i-beam', standard: 'IS', category: 'ISMB',
    parameters: { height: 500, flangeWidth: 180, webThickness: 10.2, flangeThickness: 17.2, filletRadius: 17 },
    properties: { area: 11074, weight: 86.9 } },
  { id: 'ISMB600', name: 'ISMB 600', profileType: 'i-beam', standard: 'IS', category: 'ISMB',
    parameters: { height: 600, flangeWidth: 210, webThickness: 12.0, flangeThickness: 20.3, filletRadius: 20 },
    properties: { area: 15621, weight: 122.6 } },
];

// ============================================================================
// Indian Standard Heavy Weight Beams (IS 808)
// ============================================================================

const IS_ISHB_SHAPES: ProfilePreset[] = [
  { id: 'ISHB150', name: 'ISHB 150', profileType: 'i-beam', standard: 'IS', category: 'ISHB',
    parameters: { height: 150, flangeWidth: 150, webThickness: 5.4, flangeThickness: 9.0, filletRadius: 8 },
    properties: { area: 3450, weight: 27.1 } },
  { id: 'ISHB200', name: 'ISHB 200', profileType: 'i-beam', standard: 'IS', category: 'ISHB',
    parameters: { height: 200, flangeWidth: 200, webThickness: 6.1, flangeThickness: 9.0, filletRadius: 9 },
    properties: { area: 4750, weight: 37.3 } },
  { id: 'ISHB225', name: 'ISHB 225', profileType: 'i-beam', standard: 'IS', category: 'ISHB',
    parameters: { height: 225, flangeWidth: 225, webThickness: 6.5, flangeThickness: 9.1, filletRadius: 10 },
    properties: { area: 5490, weight: 43.1 } },
  { id: 'ISHB250', name: 'ISHB 250', profileType: 'i-beam', standard: 'IS', category: 'ISHB',
    parameters: { height: 250, flangeWidth: 250, webThickness: 6.9, flangeThickness: 9.7, filletRadius: 10 },
    properties: { area: 6500, weight: 51.0 } },
  { id: 'ISHB300', name: 'ISHB 300', profileType: 'i-beam', standard: 'IS', category: 'ISHB',
    parameters: { height: 300, flangeWidth: 250, webThickness: 7.6, flangeThickness: 10.6, filletRadius: 11 },
    properties: { area: 7480, weight: 58.8 } },
  { id: 'ISHB350', name: 'ISHB 350', profileType: 'i-beam', standard: 'IS', category: 'ISHB',
    parameters: { height: 350, flangeWidth: 250, webThickness: 8.3, flangeThickness: 11.6, filletRadius: 11 },
    properties: { area: 8586, weight: 67.4 } },
  { id: 'ISHB400', name: 'ISHB 400', profileType: 'i-beam', standard: 'IS', category: 'ISHB',
    parameters: { height: 400, flangeWidth: 250, webThickness: 9.1, flangeThickness: 12.7, filletRadius: 14 },
    properties: { area: 9864, weight: 77.4 } },
  { id: 'ISHB450', name: 'ISHB 450', profileType: 'i-beam', standard: 'IS', category: 'ISHB',
    parameters: { height: 450, flangeWidth: 250, webThickness: 9.8, flangeThickness: 13.7, filletRadius: 14 },
    properties: { area: 11106, weight: 87.2 } },
];

// ============================================================================
// Indian Standard Light Weight Beams (IS 808)
// ============================================================================

const IS_ISLB_SHAPES: ProfilePreset[] = [
  { id: 'ISLB100', name: 'ISLB 100', profileType: 'i-beam', standard: 'IS', category: 'ISLB',
    parameters: { height: 100, flangeWidth: 50, webThickness: 4.0, flangeThickness: 6.4, filletRadius: 9 },
    properties: { area: 1021, weight: 8.0 } },
  { id: 'ISLB125', name: 'ISLB 125', profileType: 'i-beam', standard: 'IS', category: 'ISLB',
    parameters: { height: 125, flangeWidth: 75, webThickness: 4.4, flangeThickness: 6.5, filletRadius: 9 },
    properties: { area: 1512, weight: 11.9 } },
  { id: 'ISLB150', name: 'ISLB 150', profileType: 'i-beam', standard: 'IS', category: 'ISLB',
    parameters: { height: 150, flangeWidth: 80, webThickness: 4.8, flangeThickness: 6.8, filletRadius: 9 },
    properties: { area: 1808, weight: 14.2 } },
  { id: 'ISLB175', name: 'ISLB 175', profileType: 'i-beam', standard: 'IS', category: 'ISLB',
    parameters: { height: 175, flangeWidth: 90, webThickness: 5.1, flangeThickness: 6.9, filletRadius: 9 },
    properties: { area: 2130, weight: 16.7 } },
  { id: 'ISLB200', name: 'ISLB 200', profileType: 'i-beam', standard: 'IS', category: 'ISLB',
    parameters: { height: 200, flangeWidth: 100, webThickness: 5.4, flangeThickness: 7.3, filletRadius: 9 },
    properties: { area: 2527, weight: 19.8 } },
  { id: 'ISLB225', name: 'ISLB 225', profileType: 'i-beam', standard: 'IS', category: 'ISLB',
    parameters: { height: 225, flangeWidth: 100, webThickness: 5.8, flangeThickness: 8.6, filletRadius: 10 },
    properties: { area: 2992, weight: 23.5 } },
  { id: 'ISLB250', name: 'ISLB 250', profileType: 'i-beam', standard: 'IS', category: 'ISLB',
    parameters: { height: 250, flangeWidth: 125, webThickness: 6.1, flangeThickness: 8.2, filletRadius: 10 },
    properties: { area: 3553, weight: 27.9 } },
  { id: 'ISLB300', name: 'ISLB 300', profileType: 'i-beam', standard: 'IS', category: 'ISLB',
    parameters: { height: 300, flangeWidth: 150, webThickness: 6.7, flangeThickness: 9.4, filletRadius: 12 },
    properties: { area: 4808, weight: 37.7 } },
  { id: 'ISLB350', name: 'ISLB 350', profileType: 'i-beam', standard: 'IS', category: 'ISLB',
    parameters: { height: 350, flangeWidth: 165, webThickness: 7.4, flangeThickness: 11.4, filletRadius: 14 },
    properties: { area: 6301, weight: 49.5 } },
  { id: 'ISLB400', name: 'ISLB 400', profileType: 'i-beam', standard: 'IS', category: 'ISLB',
    parameters: { height: 400, flangeWidth: 165, webThickness: 8.0, flangeThickness: 12.5, filletRadius: 14 },
    properties: { area: 7243, weight: 56.9 } },
];

// ============================================================================
// Indian Standard Medium Weight Channels (IS 808)
// ============================================================================

const IS_ISMC_SHAPES: ProfilePreset[] = [
  { id: 'ISMC75', name: 'ISMC 75', profileType: 'channel', standard: 'IS', category: 'ISMC',
    parameters: { height: 75, flangeWidth: 40, webThickness: 4.4, flangeThickness: 7.3, filletRadius: 8 },
    properties: { area: 867, weight: 6.8 } },
  { id: 'ISMC100', name: 'ISMC 100', profileType: 'channel', standard: 'IS', category: 'ISMC',
    parameters: { height: 100, flangeWidth: 50, webThickness: 5.0, flangeThickness: 7.5, filletRadius: 9 },
    properties: { area: 1218, weight: 9.56 } },
  { id: 'ISMC125', name: 'ISMC 125', profileType: 'channel', standard: 'IS', category: 'ISMC',
    parameters: { height: 125, flangeWidth: 65, webThickness: 5.3, flangeThickness: 8.2, filletRadius: 9 },
    properties: { area: 1647, weight: 12.7 } },
  { id: 'ISMC150', name: 'ISMC 150', profileType: 'channel', standard: 'IS', category: 'ISMC',
    parameters: { height: 150, flangeWidth: 75, webThickness: 5.7, flangeThickness: 9.0, filletRadius: 10 },
    properties: { area: 2130, weight: 16.8 } },
  { id: 'ISMC175', name: 'ISMC 175', profileType: 'channel', standard: 'IS', category: 'ISMC',
    parameters: { height: 175, flangeWidth: 75, webThickness: 5.7, flangeThickness: 10.2, filletRadius: 10 },
    properties: { area: 2477, weight: 19.1 } },
  { id: 'ISMC200', name: 'ISMC 200', profileType: 'channel', standard: 'IS', category: 'ISMC',
    parameters: { height: 200, flangeWidth: 75, webThickness: 6.2, flangeThickness: 11.4, filletRadius: 11 },
    properties: { area: 2851, weight: 22.3 } },
  { id: 'ISMC225', name: 'ISMC 225', profileType: 'channel', standard: 'IS', category: 'ISMC',
    parameters: { height: 225, flangeWidth: 80, webThickness: 6.4, flangeThickness: 12.4, filletRadius: 11 },
    properties: { area: 3251, weight: 25.9 } },
  { id: 'ISMC250', name: 'ISMC 250', profileType: 'channel', standard: 'IS', category: 'ISMC',
    parameters: { height: 250, flangeWidth: 80, webThickness: 7.1, flangeThickness: 14.1, filletRadius: 12 },
    properties: { area: 3867, weight: 30.4 } },
  { id: 'ISMC300', name: 'ISMC 300', profileType: 'channel', standard: 'IS', category: 'ISMC',
    parameters: { height: 300, flangeWidth: 90, webThickness: 7.6, flangeThickness: 13.6, filletRadius: 13 },
    properties: { area: 4564, weight: 35.8 } },
  { id: 'ISMC400', name: 'ISMC 400', profileType: 'channel', standard: 'IS', category: 'ISMC',
    parameters: { height: 400, flangeWidth: 100, webThickness: 8.8, flangeThickness: 15.3, filletRadius: 15 },
    properties: { area: 6381, weight: 50.1 } },
];

// ============================================================================
// Chinese GB HW-Shapes - Wide Flange (GB/T 11263)
// ============================================================================

const GB_HW_SHAPES: ProfilePreset[] = [
  { id: 'HW100x100', name: 'HW 100x100', profileType: 'i-beam', standard: 'GB', category: 'HW',
    parameters: { height: 100, flangeWidth: 100, webThickness: 6.0, flangeThickness: 8.0, filletRadius: 10 },
    properties: { area: 2158, weight: 16.9 } },
  { id: 'HW125x125', name: 'HW 125x125', profileType: 'i-beam', standard: 'GB', category: 'HW',
    parameters: { height: 125, flangeWidth: 125, webThickness: 6.5, flangeThickness: 9.0, filletRadius: 10 },
    properties: { area: 3031, weight: 23.8 } },
  { id: 'HW150x150', name: 'HW 150x150', profileType: 'i-beam', standard: 'GB', category: 'HW',
    parameters: { height: 150, flangeWidth: 150, webThickness: 7.0, flangeThickness: 10.0, filletRadius: 11 },
    properties: { area: 3964, weight: 31.1 } },
  { id: 'HW175x175', name: 'HW 175x175', profileType: 'i-beam', standard: 'GB', category: 'HW',
    parameters: { height: 175, flangeWidth: 175, webThickness: 7.5, flangeThickness: 11.0, filletRadius: 12 },
    properties: { area: 5142, weight: 40.4 } },
  { id: 'HW200x200', name: 'HW 200x200', profileType: 'i-beam', standard: 'GB', category: 'HW',
    parameters: { height: 200, flangeWidth: 200, webThickness: 8.0, flangeThickness: 12.0, filletRadius: 13 },
    properties: { area: 6353, weight: 49.9 } },
  { id: 'HW250x250', name: 'HW 250x250', profileType: 'i-beam', standard: 'GB', category: 'HW',
    parameters: { height: 250, flangeWidth: 250, webThickness: 9.0, flangeThickness: 14.0, filletRadius: 16 },
    properties: { area: 9143, weight: 71.8 } },
  { id: 'HW300x300', name: 'HW 300x300', profileType: 'i-beam', standard: 'GB', category: 'HW',
    parameters: { height: 300, flangeWidth: 300, webThickness: 10.0, flangeThickness: 15.0, filletRadius: 18 },
    properties: { area: 11710, weight: 91.9 } },
  { id: 'HW350x350', name: 'HW 350x350', profileType: 'i-beam', standard: 'GB', category: 'HW',
    parameters: { height: 350, flangeWidth: 350, webThickness: 12.0, flangeThickness: 19.0, filletRadius: 20 },
    properties: { area: 17190, weight: 134.9 } },
  { id: 'HW400x400', name: 'HW 400x400', profileType: 'i-beam', standard: 'GB', category: 'HW',
    parameters: { height: 400, flangeWidth: 400, webThickness: 13.0, flangeThickness: 21.0, filletRadius: 22 },
    properties: { area: 21870, weight: 171.7 } },
];

// ============================================================================
// Chinese GB HM-Shapes - Medium Flange (GB/T 11263)
// ============================================================================

const GB_HM_SHAPES: ProfilePreset[] = [
  { id: 'HM150x100', name: 'HM 150x100', profileType: 'i-beam', standard: 'GB', category: 'HM',
    parameters: { height: 148, flangeWidth: 100, webThickness: 6.0, flangeThickness: 9.0, filletRadius: 11 },
    properties: { area: 2651, weight: 20.8 } },
  { id: 'HM200x150', name: 'HM 200x150', profileType: 'i-beam', standard: 'GB', category: 'HM',
    parameters: { height: 194, flangeWidth: 150, webThickness: 6.0, flangeThickness: 9.0, filletRadius: 13 },
    properties: { area: 3808, weight: 29.9 } },
  { id: 'HM250x175', name: 'HM 250x175', profileType: 'i-beam', standard: 'GB', category: 'HM',
    parameters: { height: 244, flangeWidth: 175, webThickness: 7.0, flangeThickness: 11.0, filletRadius: 16 },
    properties: { area: 5542, weight: 43.5 } },
  { id: 'HM300x200', name: 'HM 300x200', profileType: 'i-beam', standard: 'GB', category: 'HM',
    parameters: { height: 294, flangeWidth: 200, webThickness: 8.0, flangeThickness: 12.0, filletRadius: 18 },
    properties: { area: 7210, weight: 56.6 } },
  { id: 'HM350x250', name: 'HM 350x250', profileType: 'i-beam', standard: 'GB', category: 'HM',
    parameters: { height: 340, flangeWidth: 250, webThickness: 9.0, flangeThickness: 14.0, filletRadius: 20 },
    properties: { area: 10060, weight: 78.9 } },
  { id: 'HM400x300', name: 'HM 400x300', profileType: 'i-beam', standard: 'GB', category: 'HM',
    parameters: { height: 390, flangeWidth: 300, webThickness: 10.0, flangeThickness: 16.0, filletRadius: 22 },
    properties: { area: 13360, weight: 104.9 } },
  { id: 'HM450x300', name: 'HM 450x300', profileType: 'i-beam', standard: 'GB', category: 'HM',
    parameters: { height: 440, flangeWidth: 300, webThickness: 11.0, flangeThickness: 18.0, filletRadius: 24 },
    properties: { area: 15700, weight: 123.2 } },
  { id: 'HM500x300', name: 'HM 500x300', profileType: 'i-beam', standard: 'GB', category: 'HM',
    parameters: { height: 488, flangeWidth: 300, webThickness: 11.0, flangeThickness: 18.0, filletRadius: 26 },
    properties: { area: 16220, weight: 127.3 } },
  { id: 'HM600x300', name: 'HM 600x300', profileType: 'i-beam', standard: 'GB', category: 'HM',
    parameters: { height: 582, flangeWidth: 300, webThickness: 12.0, flangeThickness: 17.0, filletRadius: 28 },
    properties: { area: 17060, weight: 133.9 } },
];

// ============================================================================
// Chinese GB HN-Shapes - Narrow Flange (GB/T 11263)
// ============================================================================

const GB_HN_SHAPES: ProfilePreset[] = [
  { id: 'HN150x75', name: 'HN 150x75', profileType: 'i-beam', standard: 'GB', category: 'HN',
    parameters: { height: 150, flangeWidth: 75, webThickness: 5.0, flangeThickness: 7.0, filletRadius: 8 },
    properties: { area: 1758, weight: 13.8 } },
  { id: 'HN200x100', name: 'HN 200x100', profileType: 'i-beam', standard: 'GB', category: 'HN',
    parameters: { height: 200, flangeWidth: 100, webThickness: 5.5, flangeThickness: 8.0, filletRadius: 11 },
    properties: { area: 2671, weight: 21.0 } },
  { id: 'HN250x125', name: 'HN 250x125', profileType: 'i-beam', standard: 'GB', category: 'HN',
    parameters: { height: 250, flangeWidth: 125, webThickness: 6.0, flangeThickness: 9.0, filletRadius: 12 },
    properties: { area: 3653, weight: 28.7 } },
  { id: 'HN300x150', name: 'HN 300x150', profileType: 'i-beam', standard: 'GB', category: 'HN',
    parameters: { height: 300, flangeWidth: 150, webThickness: 6.5, flangeThickness: 9.0, filletRadius: 13 },
    properties: { area: 4678, weight: 36.7 } },
  { id: 'HN350x175', name: 'HN 350x175', profileType: 'i-beam', standard: 'GB', category: 'HN',
    parameters: { height: 350, flangeWidth: 175, webThickness: 7.0, flangeThickness: 11.0, filletRadius: 14 },
    properties: { area: 6314, weight: 49.6 } },
  { id: 'HN400x200', name: 'HN 400x200', profileType: 'i-beam', standard: 'GB', category: 'HN',
    parameters: { height: 400, flangeWidth: 200, webThickness: 8.0, flangeThickness: 13.0, filletRadius: 16 },
    properties: { area: 8412, weight: 66.0 } },
  { id: 'HN450x200', name: 'HN 450x200', profileType: 'i-beam', standard: 'GB', category: 'HN',
    parameters: { height: 450, flangeWidth: 200, webThickness: 9.0, flangeThickness: 14.0, filletRadius: 18 },
    properties: { area: 9512, weight: 74.7 } },
  { id: 'HN500x200', name: 'HN 500x200', profileType: 'i-beam', standard: 'GB', category: 'HN',
    parameters: { height: 500, flangeWidth: 200, webThickness: 10.0, flangeThickness: 16.0, filletRadius: 20 },
    properties: { area: 11060, weight: 86.8 } },
  { id: 'HN600x200', name: 'HN 600x200', profileType: 'i-beam', standard: 'GB', category: 'HN',
    parameters: { height: 600, flangeWidth: 200, webThickness: 11.0, flangeThickness: 17.0, filletRadius: 22 },
    properties: { area: 12640, weight: 99.2 } },
  { id: 'HN700x300', name: 'HN 700x300', profileType: 'i-beam', standard: 'GB', category: 'HN',
    parameters: { height: 700, flangeWidth: 300, webThickness: 13.0, flangeThickness: 24.0, filletRadius: 28 },
    properties: { area: 23510, weight: 184.5 } },
];

// ============================================================================
// Australian Universal Beams (AS/NZS 3679.1)
// ============================================================================

const AS_UB_SHAPES: ProfilePreset[] = [
  { id: '150UB14', name: '150UB14', profileType: 'i-beam', standard: 'AS', category: 'UB',
    parameters: { height: 150, flangeWidth: 75, webThickness: 5.0, flangeThickness: 7.0, filletRadius: 8 },
    properties: { area: 1780, weight: 14.0 } },
  { id: '150UB18', name: '150UB18', profileType: 'i-beam', standard: 'AS', category: 'UB',
    parameters: { height: 155, flangeWidth: 75, webThickness: 6.0, flangeThickness: 9.5, filletRadius: 8 },
    properties: { area: 2300, weight: 18.0 } },
  { id: '180UB16', name: '180UB16', profileType: 'i-beam', standard: 'AS', category: 'UB',
    parameters: { height: 173, flangeWidth: 90, webThickness: 4.8, flangeThickness: 7.3, filletRadius: 8.9 },
    properties: { area: 2060, weight: 16.1 } },
  { id: '180UB22', name: '180UB22', profileType: 'i-beam', standard: 'AS', category: 'UB',
    parameters: { height: 179, flangeWidth: 90, webThickness: 6.0, flangeThickness: 10.9, filletRadius: 8.9 },
    properties: { area: 2830, weight: 22.2 } },
  { id: '200UB18', name: '200UB18', profileType: 'i-beam', standard: 'AS', category: 'UB',
    parameters: { height: 198, flangeWidth: 99, webThickness: 4.5, flangeThickness: 7.0, filletRadius: 8.9 },
    properties: { area: 2320, weight: 18.2 } },
  { id: '200UB25', name: '200UB25', profileType: 'i-beam', standard: 'AS', category: 'UB',
    parameters: { height: 203, flangeWidth: 133, webThickness: 5.8, flangeThickness: 7.8, filletRadius: 8.9 },
    properties: { area: 3230, weight: 25.4 } },
  { id: '200UB30', name: '200UB30', profileType: 'i-beam', standard: 'AS', category: 'UB',
    parameters: { height: 207, flangeWidth: 134, webThickness: 6.3, flangeThickness: 9.6, filletRadius: 8.9 },
    properties: { area: 3860, weight: 29.8 } },
  { id: '250UB26', name: '250UB26', profileType: 'i-beam', standard: 'AS', category: 'UB',
    parameters: { height: 248, flangeWidth: 124, webThickness: 5.0, flangeThickness: 8.0, filletRadius: 12.7 },
    properties: { area: 3270, weight: 25.7 } },
  { id: '250UB31', name: '250UB31', profileType: 'i-beam', standard: 'AS', category: 'UB',
    parameters: { height: 252, flangeWidth: 146, webThickness: 6.1, flangeThickness: 8.6, filletRadius: 12.7 },
    properties: { area: 4010, weight: 31.4 } },
  { id: '250UB37', name: '250UB37', profileType: 'i-beam', standard: 'AS', category: 'UB',
    parameters: { height: 256, flangeWidth: 146, webThickness: 6.4, flangeThickness: 10.9, filletRadius: 12.7 },
    properties: { area: 4740, weight: 37.3 } },
  { id: '310UB32', name: '310UB32', profileType: 'i-beam', standard: 'AS', category: 'UB',
    parameters: { height: 298, flangeWidth: 149, webThickness: 5.5, flangeThickness: 8.0, filletRadius: 13.5 },
    properties: { area: 4080, weight: 32.0 } },
  { id: '310UB40', name: '310UB40', profileType: 'i-beam', standard: 'AS', category: 'UB',
    parameters: { height: 304, flangeWidth: 165, webThickness: 6.1, flangeThickness: 10.2, filletRadius: 11.4 },
    properties: { area: 5130, weight: 40.4 } },
  { id: '310UB46', name: '310UB46', profileType: 'i-beam', standard: 'AS', category: 'UB',
    parameters: { height: 307, flangeWidth: 166, webThickness: 6.7, flangeThickness: 11.8, filletRadius: 11.4 },
    properties: { area: 5900, weight: 46.2 } },
  { id: '360UB45', name: '360UB45', profileType: 'i-beam', standard: 'AS', category: 'UB',
    parameters: { height: 352, flangeWidth: 171, webThickness: 6.9, flangeThickness: 9.7, filletRadius: 11.4 },
    properties: { area: 5720, weight: 44.7 } },
  { id: '360UB57', name: '360UB57', profileType: 'i-beam', standard: 'AS', category: 'UB',
    parameters: { height: 359, flangeWidth: 172, webThickness: 8.0, flangeThickness: 13.0, filletRadius: 11.4 },
    properties: { area: 7240, weight: 56.7 } },
  { id: '410UB54', name: '410UB54', profileType: 'i-beam', standard: 'AS', category: 'UB',
    parameters: { height: 403, flangeWidth: 178, webThickness: 7.6, flangeThickness: 10.9, filletRadius: 11.4 },
    properties: { area: 6890, weight: 53.7 } },
];

// ============================================================================
// Australian Universal Columns (AS/NZS 3679.1)
// ============================================================================

const AS_UC_SHAPES: ProfilePreset[] = [
  { id: '100UC15', name: '100UC15', profileType: 'i-beam', standard: 'AS', category: 'UC',
    parameters: { height: 97, flangeWidth: 99, webThickness: 5.0, flangeThickness: 7.0, filletRadius: 8.9 },
    properties: { area: 1890, weight: 14.8 } },
  { id: '150UC23', name: '150UC23', profileType: 'i-beam', standard: 'AS', category: 'UC',
    parameters: { height: 152, flangeWidth: 152, webThickness: 6.1, flangeThickness: 6.8, filletRadius: 8.9 },
    properties: { area: 2980, weight: 23.4 } },
  { id: '150UC30', name: '150UC30', profileType: 'i-beam', standard: 'AS', category: 'UC',
    parameters: { height: 158, flangeWidth: 153, webThickness: 6.6, flangeThickness: 9.4, filletRadius: 8.9 },
    properties: { area: 3830, weight: 30.0 } },
  { id: '150UC37', name: '150UC37', profileType: 'i-beam', standard: 'AS', category: 'UC',
    parameters: { height: 162, flangeWidth: 154, webThickness: 8.1, flangeThickness: 11.5, filletRadius: 8.9 },
    properties: { area: 4730, weight: 37.2 } },
  { id: '200UC46', name: '200UC46', profileType: 'i-beam', standard: 'AS', category: 'UC',
    parameters: { height: 203, flangeWidth: 203, webThickness: 7.3, flangeThickness: 11.0, filletRadius: 8.9 },
    properties: { area: 5880, weight: 46.2 } },
  { id: '200UC60', name: '200UC60', profileType: 'i-beam', standard: 'AS', category: 'UC',
    parameters: { height: 210, flangeWidth: 205, webThickness: 9.3, flangeThickness: 14.2, filletRadius: 8.9 },
    properties: { area: 7620, weight: 59.5 } },
  { id: '250UC73', name: '250UC73', profileType: 'i-beam', standard: 'AS', category: 'UC',
    parameters: { height: 254, flangeWidth: 254, webThickness: 8.6, flangeThickness: 14.2, filletRadius: 12.7 },
    properties: { area: 9320, weight: 73.3 } },
  { id: '250UC89', name: '250UC89', profileType: 'i-beam', standard: 'AS', category: 'UC',
    parameters: { height: 260, flangeWidth: 256, webThickness: 10.5, flangeThickness: 17.3, filletRadius: 12.7 },
    properties: { area: 11400, weight: 89.5 } },
  { id: '310UC97', name: '310UC97', profileType: 'i-beam', standard: 'AS', category: 'UC',
    parameters: { height: 308, flangeWidth: 305, webThickness: 9.9, flangeThickness: 15.4, filletRadius: 16.5 },
    properties: { area: 12400, weight: 96.8 } },
  { id: '310UC118', name: '310UC118', profileType: 'i-beam', standard: 'AS', category: 'UC',
    parameters: { height: 315, flangeWidth: 307, webThickness: 11.9, flangeThickness: 18.7, filletRadius: 16.5 },
    properties: { area: 15000, weight: 118.0 } },
  { id: '310UC137', name: '310UC137', profileType: 'i-beam', standard: 'AS', category: 'UC',
    parameters: { height: 321, flangeWidth: 309, webThickness: 13.8, flangeThickness: 21.7, filletRadius: 16.5 },
    properties: { area: 17500, weight: 137.0 } },
];

// ============================================================================
// GOST I-Beams (GOST 8239-89)
// ============================================================================

const GOST_I_SHAPES: ProfilePreset[] = [
  { id: 'I10', name: 'I10', profileType: 'i-beam', standard: 'GOST', category: 'I-Beams',
    parameters: { height: 100, flangeWidth: 55, webThickness: 4.5, flangeThickness: 7.2, filletRadius: 7 },
    properties: { area: 1200, weight: 9.46 } },
  { id: 'I12', name: 'I12', profileType: 'i-beam', standard: 'GOST', category: 'I-Beams',
    parameters: { height: 120, flangeWidth: 64, webThickness: 4.8, flangeThickness: 7.3, filletRadius: 7.5 },
    properties: { area: 1438, weight: 11.50 } },
  { id: 'I14', name: 'I14', profileType: 'i-beam', standard: 'GOST', category: 'I-Beams',
    parameters: { height: 140, flangeWidth: 73, webThickness: 4.9, flangeThickness: 7.5, filletRadius: 8 },
    properties: { area: 1715, weight: 13.70 } },
  { id: 'I16', name: 'I16', profileType: 'i-beam', standard: 'GOST', category: 'I-Beams',
    parameters: { height: 160, flangeWidth: 81, webThickness: 5.0, flangeThickness: 7.8, filletRadius: 8.5 },
    properties: { area: 2009, weight: 15.90 } },
  { id: 'I18', name: 'I18', profileType: 'i-beam', standard: 'GOST', category: 'I-Beams',
    parameters: { height: 180, flangeWidth: 90, webThickness: 5.1, flangeThickness: 8.1, filletRadius: 9 },
    properties: { area: 2340, weight: 18.40 } },
  { id: 'I20', name: 'I20', profileType: 'i-beam', standard: 'GOST', category: 'I-Beams',
    parameters: { height: 200, flangeWidth: 100, webThickness: 5.2, flangeThickness: 8.4, filletRadius: 9.5 },
    properties: { area: 2680, weight: 21.00 } },
  { id: 'I22', name: 'I22', profileType: 'i-beam', standard: 'GOST', category: 'I-Beams',
    parameters: { height: 220, flangeWidth: 110, webThickness: 5.4, flangeThickness: 8.7, filletRadius: 10 },
    properties: { area: 3060, weight: 24.00 } },
  { id: 'I24', name: 'I24', profileType: 'i-beam', standard: 'GOST', category: 'I-Beams',
    parameters: { height: 240, flangeWidth: 115, webThickness: 5.6, flangeThickness: 9.5, filletRadius: 10.5 },
    properties: { area: 3460, weight: 27.30 } },
  { id: 'I27', name: 'I27', profileType: 'i-beam', standard: 'GOST', category: 'I-Beams',
    parameters: { height: 270, flangeWidth: 125, webThickness: 6.0, flangeThickness: 9.8, filletRadius: 11 },
    properties: { area: 4010, weight: 31.50 } },
  { id: 'I30', name: 'I30', profileType: 'i-beam', standard: 'GOST', category: 'I-Beams',
    parameters: { height: 300, flangeWidth: 135, webThickness: 6.5, flangeThickness: 10.2, filletRadius: 12 },
    properties: { area: 4680, weight: 36.50 } },
  { id: 'I33', name: 'I33', profileType: 'i-beam', standard: 'GOST', category: 'I-Beams',
    parameters: { height: 330, flangeWidth: 140, webThickness: 7.0, flangeThickness: 11.2, filletRadius: 13 },
    properties: { area: 5380, weight: 42.20 } },
  { id: 'I36', name: 'I36', profileType: 'i-beam', standard: 'GOST', category: 'I-Beams',
    parameters: { height: 360, flangeWidth: 145, webThickness: 7.5, flangeThickness: 12.3, filletRadius: 14 },
    properties: { area: 6130, weight: 48.60 } },
  { id: 'I40', name: 'I40', profileType: 'i-beam', standard: 'GOST', category: 'I-Beams',
    parameters: { height: 400, flangeWidth: 155, webThickness: 8.3, flangeThickness: 13.0, filletRadius: 15 },
    properties: { area: 7260, weight: 57.00 } },
];

// ============================================================================
// GOST Channels (GOST 8240-97)
// ============================================================================

const GOST_CHANNEL_SHAPES: ProfilePreset[] = [
  { id: 'C5', name: 'C5', profileType: 'channel', standard: 'GOST', category: 'Channels',
    parameters: { height: 50, flangeWidth: 32, webThickness: 4.4, flangeThickness: 7.0, filletRadius: 6 },
    properties: { area: 658, weight: 4.84 } },
  { id: 'C6.5', name: 'C6.5', profileType: 'channel', standard: 'GOST', category: 'Channels',
    parameters: { height: 65, flangeWidth: 36, webThickness: 4.4, flangeThickness: 7.2, filletRadius: 6 },
    properties: { area: 787, weight: 5.90 } },
  { id: 'C8', name: 'C8', profileType: 'channel', standard: 'GOST', category: 'Channels',
    parameters: { height: 80, flangeWidth: 40, webThickness: 4.5, flangeThickness: 7.4, filletRadius: 6.5 },
    properties: { area: 899, weight: 7.05 } },
  { id: 'C10', name: 'C10', profileType: 'channel', standard: 'GOST', category: 'Channels',
    parameters: { height: 100, flangeWidth: 46, webThickness: 4.5, flangeThickness: 7.6, filletRadius: 7 },
    properties: { area: 1073, weight: 8.59 } },
  { id: 'C12', name: 'C12', profileType: 'channel', standard: 'GOST', category: 'Channels',
    parameters: { height: 120, flangeWidth: 52, webThickness: 4.8, flangeThickness: 7.8, filletRadius: 7.5 },
    properties: { area: 1307, weight: 10.40 } },
  { id: 'C14', name: 'C14', profileType: 'channel', standard: 'GOST', category: 'Channels',
    parameters: { height: 140, flangeWidth: 58, webThickness: 4.9, flangeThickness: 8.1, filletRadius: 8 },
    properties: { area: 1548, weight: 12.30 } },
  { id: 'C16', name: 'C16', profileType: 'channel', standard: 'GOST', category: 'Channels',
    parameters: { height: 160, flangeWidth: 64, webThickness: 5.0, flangeThickness: 8.4, filletRadius: 8.5 },
    properties: { area: 1813, weight: 14.20 } },
  { id: 'C18', name: 'C18', profileType: 'channel', standard: 'GOST', category: 'Channels',
    parameters: { height: 180, flangeWidth: 70, webThickness: 5.1, flangeThickness: 8.7, filletRadius: 9 },
    properties: { area: 2090, weight: 16.30 } },
  { id: 'C20', name: 'C20', profileType: 'channel', standard: 'GOST', category: 'Channels',
    parameters: { height: 200, flangeWidth: 76, webThickness: 5.2, flangeThickness: 9.0, filletRadius: 9.5 },
    properties: { area: 2340, weight: 18.40 } },
  { id: 'C22', name: 'C22', profileType: 'channel', standard: 'GOST', category: 'Channels',
    parameters: { height: 220, flangeWidth: 82, webThickness: 5.4, flangeThickness: 9.5, filletRadius: 10 },
    properties: { area: 2680, weight: 21.00 } },
  { id: 'C24', name: 'C24', profileType: 'channel', standard: 'GOST', category: 'Channels',
    parameters: { height: 240, flangeWidth: 90, webThickness: 5.6, flangeThickness: 10.0, filletRadius: 10.5 },
    properties: { area: 3060, weight: 24.00 } },
  { id: 'C27', name: 'C27', profileType: 'channel', standard: 'GOST', category: 'Channels',
    parameters: { height: 270, flangeWidth: 95, webThickness: 6.0, flangeThickness: 10.5, filletRadius: 11 },
    properties: { area: 3520, weight: 27.70 } },
  { id: 'C30', name: 'C30', profileType: 'channel', standard: 'GOST', category: 'Channels',
    parameters: { height: 300, flangeWidth: 100, webThickness: 6.5, flangeThickness: 11.0, filletRadius: 12 },
    properties: { area: 4050, weight: 31.80 } },
];

// ============================================================================
// Combined Library
// ============================================================================

/**
 * All profile presets
 */
export const PROFILE_PRESETS: ProfilePreset[] = [
  ...AISC_W_SHAPES,
  ...AISC_C_SHAPES,
  ...AISC_L_SHAPES,
  ...AISC_HSS_RECT,
  ...AISC_HSS_ROUND,
  ...EN_IPE_SHAPES,
  ...EN_HEA_SHAPES,
  ...EN_HEB_SHAPES,
  ...EN_HEM_SHAPES,
  ...EN_IPN_SHAPES,
  ...EN_UPN_SHAPES,
  ...EN_EQUAL_ANGLES,
  ...EN_UNEQUAL_ANGLES,
  ...BS_UB_SHAPES,
  ...BS_UC_SHAPES,
  ...BS_PFC_SHAPES,
  ...JIS_H_SHAPES,
  ...JIS_CHANNEL_SHAPES,
  ...IS_ISMB_SHAPES,
  ...IS_ISHB_SHAPES,
  ...IS_ISLB_SHAPES,
  ...IS_ISMC_SHAPES,
  ...GB_HW_SHAPES,
  ...GB_HM_SHAPES,
  ...GB_HN_SHAPES,
  ...AS_UB_SHAPES,
  ...AS_UC_SHAPES,
  ...GOST_I_SHAPES,
  ...GOST_CHANNEL_SHAPES,
];

/**
 * Get presets for a specific profile type
 */
export function getPresetsForType(profileType: ProfileType): ProfilePreset[] {
  return PROFILE_PRESETS.filter(p => p.profileType === profileType);
}

/**
 * Get presets for a specific standard
 */
export function getPresetsForStandard(standard: string): ProfilePreset[] {
  return PROFILE_PRESETS.filter(p => p.standard === standard);
}

/**
 * Get preset by ID
 */
export function getPresetById(id: string): ProfilePreset | undefined {
  return PROFILE_PRESETS.find(p => p.id === id);
}

/**
 * Get all available standards
 */
export function getAvailableStandards(): string[] {
  const standards = new Set(PROFILE_PRESETS.map(p => p.standard));
  return Array.from(standards);
}

/**
 * Get categories for a standard
 */
export function getCategoriesForStandard(standard: string): string[] {
  const categories = new Set(
    PROFILE_PRESETS
      .filter(p => p.standard === standard)
      .map(p => p.category)
  );
  return Array.from(categories);
}

/**
 * Search presets by name
 */
export function searchPresets(query: string): ProfilePreset[] {
  const lowerQuery = query.toLowerCase();
  return PROFILE_PRESETS.filter(p =>
    p.name.toLowerCase().includes(lowerQuery) ||
    p.id.toLowerCase().includes(lowerQuery)
  );
}
