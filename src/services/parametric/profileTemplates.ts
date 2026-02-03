/**
 * Profile Templates
 *
 * Defines the parameter schemas for each structural profile type.
 * Each template describes what parameters are needed to fully define the profile.
 */

import type { ProfileTemplate, ProfileType, ParameterDefinition } from '../../types/parametric';

// ============================================================================
// I-Beam / Wide Flange Template
// ============================================================================

const iBeamParameters: ParameterDefinition[] = [
  {
    id: 'height',
    label: 'Height (d)',
    type: 'number',
    defaultValue: 200,
    unit: 'mm',
    min: 10,
    max: 2000,
    step: 1,
    group: 'Dimensions',
    order: 1,
    description: 'Total height of the section',
  },
  {
    id: 'flangeWidth',
    label: 'Flange Width (bf)',
    type: 'number',
    defaultValue: 100,
    unit: 'mm',
    min: 10,
    max: 1000,
    step: 1,
    group: 'Dimensions',
    order: 2,
    description: 'Width of the flanges',
  },
  {
    id: 'webThickness',
    label: 'Web Thickness (tw)',
    type: 'number',
    defaultValue: 8,
    unit: 'mm',
    min: 1,
    max: 100,
    step: 0.5,
    group: 'Dimensions',
    order: 3,
    description: 'Thickness of the web',
  },
  {
    id: 'flangeThickness',
    label: 'Flange Thickness (tf)',
    type: 'number',
    defaultValue: 12,
    unit: 'mm',
    min: 1,
    max: 100,
    step: 0.5,
    group: 'Dimensions',
    order: 4,
    description: 'Thickness of the flanges',
  },
  {
    id: 'filletRadius',
    label: 'Fillet Radius (r)',
    type: 'number',
    defaultValue: 10,
    unit: 'mm',
    min: 0,
    max: 50,
    step: 1,
    group: 'Details',
    order: 5,
    description: 'Radius of fillet between web and flange',
  },
];

const iBeamTemplate: ProfileTemplate = {
  id: 'i-beam',
  name: 'I-Beam / Wide Flange',
  description: 'Standard I-beam or wide flange section (W-shapes, IPE, HEA, HEB)',
  category: 'structural',
  parameters: iBeamParameters,
  icon: 'i-beam',
  insertionMode: 'center',
};

// ============================================================================
// Channel Template
// ============================================================================

const channelParameters: ParameterDefinition[] = [
  {
    id: 'height',
    label: 'Height (d)',
    type: 'number',
    defaultValue: 150,
    unit: 'mm',
    min: 10,
    max: 1000,
    step: 1,
    group: 'Dimensions',
    order: 1,
    description: 'Total height of the section',
  },
  {
    id: 'flangeWidth',
    label: 'Flange Width (bf)',
    type: 'number',
    defaultValue: 75,
    unit: 'mm',
    min: 10,
    max: 500,
    step: 1,
    group: 'Dimensions',
    order: 2,
    description: 'Width of the flanges',
  },
  {
    id: 'webThickness',
    label: 'Web Thickness (tw)',
    type: 'number',
    defaultValue: 6,
    unit: 'mm',
    min: 1,
    max: 50,
    step: 0.5,
    group: 'Dimensions',
    order: 3,
    description: 'Thickness of the web',
  },
  {
    id: 'flangeThickness',
    label: 'Flange Thickness (tf)',
    type: 'number',
    defaultValue: 9,
    unit: 'mm',
    min: 1,
    max: 50,
    step: 0.5,
    group: 'Dimensions',
    order: 4,
    description: 'Thickness of the flanges',
  },
  {
    id: 'filletRadius',
    label: 'Fillet Radius (r)',
    type: 'number',
    defaultValue: 8,
    unit: 'mm',
    min: 0,
    max: 30,
    step: 1,
    group: 'Details',
    order: 5,
    description: 'Radius of internal fillet',
  },
];

const channelTemplate: ProfileTemplate = {
  id: 'channel',
  name: 'Channel (C-Section)',
  description: 'C-shaped channel section (C-shapes, UPN)',
  category: 'structural',
  parameters: channelParameters,
  icon: 'channel',
  insertionMode: 'center',
};

// ============================================================================
// Angle Template
// ============================================================================

const angleParameters: ParameterDefinition[] = [
  {
    id: 'leg1',
    label: 'Leg 1 Length (L1)',
    type: 'number',
    defaultValue: 100,
    unit: 'mm',
    min: 10,
    max: 500,
    step: 1,
    group: 'Dimensions',
    order: 1,
    description: 'Length of first leg (vertical)',
  },
  {
    id: 'leg2',
    label: 'Leg 2 Length (L2)',
    type: 'number',
    defaultValue: 100,
    unit: 'mm',
    min: 10,
    max: 500,
    step: 1,
    group: 'Dimensions',
    order: 2,
    description: 'Length of second leg (horizontal)',
  },
  {
    id: 'thickness',
    label: 'Thickness (t)',
    type: 'number',
    defaultValue: 10,
    unit: 'mm',
    min: 1,
    max: 50,
    step: 0.5,
    group: 'Dimensions',
    order: 3,
    description: 'Thickness of both legs',
  },
  {
    id: 'filletRadius',
    label: 'Fillet Radius (r)',
    type: 'number',
    defaultValue: 8,
    unit: 'mm',
    min: 0,
    max: 30,
    step: 1,
    group: 'Details',
    order: 4,
    description: 'Radius of internal fillet at corner',
  },
  {
    id: 'toeRadius',
    label: 'Toe Radius (r1)',
    type: 'number',
    defaultValue: 4,
    unit: 'mm',
    min: 0,
    max: 15,
    step: 0.5,
    group: 'Details',
    order: 5,
    description: 'Radius at leg toes',
  },
];

const angleTemplate: ProfileTemplate = {
  id: 'angle',
  name: 'Angle (L-Section)',
  description: 'L-shaped angle section (equal or unequal leg)',
  category: 'structural',
  parameters: angleParameters,
  icon: 'angle',
  insertionMode: 'center',
};

// ============================================================================
// Tee Template
// ============================================================================

const teeParameters: ParameterDefinition[] = [
  {
    id: 'height',
    label: 'Height (d)',
    type: 'number',
    defaultValue: 100,
    unit: 'mm',
    min: 10,
    max: 500,
    step: 1,
    group: 'Dimensions',
    order: 1,
    description: 'Total height of the section (stem length)',
  },
  {
    id: 'flangeWidth',
    label: 'Flange Width (bf)',
    type: 'number',
    defaultValue: 100,
    unit: 'mm',
    min: 10,
    max: 500,
    step: 1,
    group: 'Dimensions',
    order: 2,
    description: 'Width of the flange',
  },
  {
    id: 'stemThickness',
    label: 'Stem Thickness (tw)',
    type: 'number',
    defaultValue: 8,
    unit: 'mm',
    min: 1,
    max: 50,
    step: 0.5,
    group: 'Dimensions',
    order: 3,
    description: 'Thickness of the stem (web)',
  },
  {
    id: 'flangeThickness',
    label: 'Flange Thickness (tf)',
    type: 'number',
    defaultValue: 10,
    unit: 'mm',
    min: 1,
    max: 50,
    step: 0.5,
    group: 'Dimensions',
    order: 4,
    description: 'Thickness of the flange',
  },
  {
    id: 'filletRadius',
    label: 'Fillet Radius (r)',
    type: 'number',
    defaultValue: 8,
    unit: 'mm',
    min: 0,
    max: 30,
    step: 1,
    group: 'Details',
    order: 5,
    description: 'Radius of fillet between stem and flange',
  },
];

const teeTemplate: ProfileTemplate = {
  id: 'tee',
  name: 'Tee (T-Section)',
  description: 'T-shaped section (WT, MT, ST shapes)',
  category: 'structural',
  parameters: teeParameters,
  icon: 'tee',
  insertionMode: 'center',
};

// ============================================================================
// HSS Rectangular Template
// ============================================================================

const hssRectParameters: ParameterDefinition[] = [
  {
    id: 'height',
    label: 'Height (H)',
    type: 'number',
    defaultValue: 150,
    unit: 'mm',
    min: 10,
    max: 500,
    step: 1,
    group: 'Dimensions',
    order: 1,
    description: 'Outside height of the section',
  },
  {
    id: 'width',
    label: 'Width (B)',
    type: 'number',
    defaultValue: 100,
    unit: 'mm',
    min: 10,
    max: 500,
    step: 1,
    group: 'Dimensions',
    order: 2,
    description: 'Outside width of the section',
  },
  {
    id: 'wallThickness',
    label: 'Wall Thickness (t)',
    type: 'number',
    defaultValue: 6,
    unit: 'mm',
    min: 1,
    max: 30,
    step: 0.5,
    group: 'Dimensions',
    order: 3,
    description: 'Wall thickness',
  },
  {
    id: 'cornerRadius',
    label: 'Corner Radius (r)',
    type: 'number',
    defaultValue: 12,
    unit: 'mm',
    min: 0,
    max: 50,
    step: 1,
    group: 'Details',
    order: 4,
    description: 'Outside corner radius',
  },
];

const hssRectTemplate: ProfileTemplate = {
  id: 'hss-rect',
  name: 'HSS Rectangular',
  description: 'Hollow Structural Section - rectangular or square tube',
  category: 'structural',
  parameters: hssRectParameters,
  icon: 'hss-rect',
  insertionMode: 'center',
};

// ============================================================================
// HSS Round Template
// ============================================================================

const hssRoundParameters: ParameterDefinition[] = [
  {
    id: 'diameter',
    label: 'Outside Diameter (D)',
    type: 'number',
    defaultValue: 150,
    unit: 'mm',
    min: 10,
    max: 1000,
    step: 1,
    group: 'Dimensions',
    order: 1,
    description: 'Outside diameter of the pipe',
  },
  {
    id: 'wallThickness',
    label: 'Wall Thickness (t)',
    type: 'number',
    defaultValue: 6,
    unit: 'mm',
    min: 1,
    max: 50,
    step: 0.5,
    group: 'Dimensions',
    order: 2,
    description: 'Wall thickness',
  },
];

const hssRoundTemplate: ProfileTemplate = {
  id: 'hss-round',
  name: 'HSS Round (Pipe)',
  description: 'Hollow Structural Section - round pipe',
  category: 'structural',
  parameters: hssRoundParameters,
  icon: 'hss-round',
  insertionMode: 'center',
};

// ============================================================================
// Plate Template
// ============================================================================

const plateParameters: ParameterDefinition[] = [
  {
    id: 'width',
    label: 'Width (b)',
    type: 'number',
    defaultValue: 200,
    unit: 'mm',
    min: 1,
    max: 2000,
    step: 1,
    group: 'Dimensions',
    order: 1,
    description: 'Width of the plate',
  },
  {
    id: 'thickness',
    label: 'Thickness (t)',
    type: 'number',
    defaultValue: 10,
    unit: 'mm',
    min: 1,
    max: 200,
    step: 0.5,
    group: 'Dimensions',
    order: 2,
    description: 'Thickness of the plate',
  },
];

const plateTemplate: ProfileTemplate = {
  id: 'plate',
  name: 'Flat Plate',
  description: 'Rectangular flat plate section',
  category: 'structural',
  parameters: plateParameters,
  icon: 'plate',
  insertionMode: 'center',
};

// ============================================================================
// Round Bar Template
// ============================================================================

const roundBarParameters: ParameterDefinition[] = [
  {
    id: 'diameter',
    label: 'Diameter (d)',
    type: 'number',
    defaultValue: 25,
    unit: 'mm',
    min: 1,
    max: 500,
    step: 1,
    group: 'Dimensions',
    order: 1,
    description: 'Diameter of the bar',
  },
];

const roundBarTemplate: ProfileTemplate = {
  id: 'round-bar',
  name: 'Round Bar',
  description: 'Solid round bar section',
  category: 'structural',
  parameters: roundBarParameters,
  icon: 'round-bar',
  insertionMode: 'center',
};

// ============================================================================
// Template Registry
// ============================================================================

/**
 * All available profile templates
 */
export const PROFILE_TEMPLATES: Record<ProfileType, ProfileTemplate> = {
  'i-beam': iBeamTemplate,
  'channel': channelTemplate,
  'angle': angleTemplate,
  'tee': teeTemplate,
  'hss-rect': hssRectTemplate,
  'hss-round': hssRoundTemplate,
  'plate': plateTemplate,
  'round-bar': roundBarTemplate,
  'custom': {
    id: 'custom',
    name: 'Custom Profile',
    description: 'User-defined custom profile',
    category: 'custom',
    parameters: [],
    icon: 'custom',
    insertionMode: 'center',
  },
};

/**
 * Get a profile template by type
 */
export function getProfileTemplate(type: ProfileType): ProfileTemplate | undefined {
  return PROFILE_TEMPLATES[type];
}

/**
 * Get all profile templates as array
 */
export function getAllProfileTemplates(): ProfileTemplate[] {
  return Object.values(PROFILE_TEMPLATES).filter(t => t.id !== 'custom');
}

/**
 * Get default parameter values for a profile type
 */
export function getDefaultParameters(type: ProfileType): Record<string, number | string | boolean> {
  const template = PROFILE_TEMPLATES[type];
  if (!template) return {};

  const defaults: Record<string, number | string | boolean> = {};
  for (const param of template.parameters) {
    defaults[param.id] = param.defaultValue;
  }
  return defaults;
}
