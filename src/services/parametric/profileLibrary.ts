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
