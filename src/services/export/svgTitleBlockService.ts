/**
 * SVG Title Block Service
 *
 * Handles parsing, importing, and rendering of SVG-based title block templates.
 * Supports placeholder detection using {{fieldName}} syntax in text elements.
 */

import type { SVGTitleBlockTemplate, SVGFieldMapping } from '../../types/sheet';

/**
 * Generate a unique ID for SVG title block templates
 */
export function generateSVGTemplateId(): string {
  return `svgtb_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * Placeholder pattern: {{fieldName}} or {{field_name}}
 */
const PLACEHOLDER_REGEX = /\{\{([a-zA-Z_][a-zA-Z0-9_]*)\}\}/g;

/**
 * Common field name mappings (placeholder name -> display label)
 */
const COMMON_FIELD_LABELS: Record<string, string> = {
  project: 'Project Name',
  projectname: 'Project Name',
  project_name: 'Project Name',
  projectnaam: 'Projectnaam',
  client: 'Client',
  klant: 'Client',
  title: 'Drawing Title',
  drawing_title: 'Drawing Title',
  scale: 'Scale',
  schaal: 'Scale',
  date: 'Date',
  datum: 'Date',
  '1e_datum': 'First Date',
  author: 'Author',
  auteur: 'Author',
  drawn_by: 'Drawn By',
  drawnby: 'Drawn By',
  checked_by: 'Checked By',
  checkedby: 'Checked By',
  approved_by: 'Approved By',
  approvedby: 'Approved By',
  project_nr: 'Project Number',
  projectnr: 'Project Number',
  project_number: 'Project Number',
  drawing_nr: 'Drawing Number',
  drawing_number: 'Drawing Number',
  number: 'Number',
  kenmerk: 'Reference',
  reference: 'Reference',
  sheet: 'Sheet',
  blad: 'Sheet',
  sheet_no: 'Sheet Number',
  sheetno: 'Sheet Number',
  revision: 'Revision',
  rev: 'Revision',
  wijz: 'Change',
  change: 'Change',
  format: 'Format',
  formaat: 'Format',
  address: 'Address',
  adres: 'Address',
  company: 'Company',
  bedrijf: 'Company',
  status: 'Status',
};

/**
 * Auto-field detection based on field name
 */
const AUTO_FIELD_TYPES: Record<string, 'date' | 'sheetNumber' | 'scale' | 'projectName'> = {
  date: 'date',
  datum: 'date',
  '1e_datum': 'date',
  sheet_no: 'sheetNumber',
  sheetno: 'sheetNumber',
  blad: 'sheetNumber',
  scale: 'scale',
  schaal: 'scale',
  project: 'projectName',
  projectname: 'projectName',
  project_name: 'projectName',
  projectnaam: 'projectName',
};

/**
 * Detected placeholder info
 */
export interface DetectedPlaceholder {
  /** The placeholder text (e.g., "{{project}}") */
  placeholder: string;
  /** The field name extracted (e.g., "project") */
  fieldName: string;
  /** Suggested label */
  suggestedLabel: string;
  /** Whether this might be an auto-field */
  isAutoField: boolean;
  /** Auto-field type if detected */
  autoFieldType?: 'date' | 'sheetNumber' | 'scale' | 'projectName';
}

/**
 * Parse SVG content and detect all placeholder fields
 */
export function detectPlaceholders(svgContent: string): DetectedPlaceholder[] {
  const placeholders: DetectedPlaceholder[] = [];
  const seen = new Set<string>();

  let match;
  while ((match = PLACEHOLDER_REGEX.exec(svgContent)) !== null) {
    const placeholder = match[0];
    const fieldName = match[1].toLowerCase();

    if (seen.has(fieldName)) continue;
    seen.add(fieldName);

    const suggestedLabel = COMMON_FIELD_LABELS[fieldName] ||
      fieldName.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

    const autoFieldType = AUTO_FIELD_TYPES[fieldName];

    placeholders.push({
      placeholder,
      fieldName,
      suggestedLabel,
      isAutoField: !!autoFieldType,
      autoFieldType,
    });
  }

  return placeholders;
}

/**
 * Parse SVG to extract viewBox dimensions (in user units, convert to mm)
 */
export function parseSVGDimensions(svgContent: string): { width: number; height: number } | null {
  const parser = new DOMParser();
  const doc = parser.parseFromString(svgContent, 'image/svg+xml');
  const svg = doc.querySelector('svg');

  if (!svg) return null;

  // Try to get dimensions from width/height attributes
  let width = parseFloat(svg.getAttribute('width') || '0');
  let height = parseFloat(svg.getAttribute('height') || '0');

  // Check for units (mm, cm, in, pt, px)
  const widthAttr = svg.getAttribute('width') || '';
  const heightAttr = svg.getAttribute('height') || '';

  // Convert to mm based on unit
  width = convertToMM(width, widthAttr);
  height = convertToMM(height, heightAttr);

  // If no dimensions, try viewBox
  if (width === 0 || height === 0) {
    const viewBox = svg.getAttribute('viewBox');
    if (viewBox) {
      const parts = viewBox.split(/[\s,]+/).map(parseFloat);
      if (parts.length >= 4) {
        // viewBox units are typically user units (pixels at 96dpi)
        // Convert to mm (1 inch = 25.4mm, 96 pixels = 1 inch)
        width = parts[2] * 25.4 / 96;
        height = parts[3] * 25.4 / 96;
      }
    }
  }

  // Default to A3 title block size if still no dimensions
  if (width === 0) width = 280;
  if (height === 0) height = 45;

  return { width, height };
}

/**
 * Convert a value with unit to mm
 */
function convertToMM(value: number, attrWithUnit: string): number {
  if (attrWithUnit.includes('mm')) return value;
  if (attrWithUnit.includes('cm')) return value * 10;
  if (attrWithUnit.includes('in')) return value * 25.4;
  if (attrWithUnit.includes('pt')) return value * 25.4 / 72;
  if (attrWithUnit.includes('px')) return value * 25.4 / 96;
  // Default: assume pixels at 96 dpi
  return value * 25.4 / 96;
}

/**
 * Create field mappings from detected placeholders
 */
export function createFieldMappings(placeholders: DetectedPlaceholder[]): SVGFieldMapping[] {
  return placeholders.map(p => ({
    fieldId: p.fieldName,
    svgSelector: p.placeholder,
    label: p.suggestedLabel,
    defaultValue: '',
    isAutoField: p.isAutoField,
    autoFieldType: p.autoFieldType,
  }));
}

/**
 * Create an SVG title block template from imported SVG content
 */
export function createSVGTemplate(
  svgContent: string,
  name: string,
  description: string,
  paperSizes: string[],
  fieldMappings: SVGFieldMapping[],
  dimensions?: { width: number; height: number },
  isFullPage?: boolean
): SVGTitleBlockTemplate {
  const dims = dimensions || parseSVGDimensions(svgContent) || { width: 280, height: 45 };

  return {
    id: generateSVGTemplateId(),
    name,
    description,
    paperSizes,
    svgContent,
    width: dims.width,
    height: dims.height,
    fieldMappings,
    isBuiltIn: false,
    isFullPage: isFullPage || false,
    createdAt: new Date().toISOString(),
    modifiedAt: new Date().toISOString(),
  };
}

/**
 * Render an SVG title block with field values substituted
 */
export function renderSVGTitleBlock(
  template: SVGTitleBlockTemplate,
  fieldValues: Record<string, string>
): string {
  let svg = template.svgContent;

  for (const mapping of template.fieldMappings) {
    const value = fieldValues[mapping.fieldId] ?? mapping.defaultValue ?? '';
    // Replace all occurrences of the placeholder
    svg = svg.split(mapping.svgSelector).join(escapeXML(value));
  }

  return svg;
}

/**
 * Escape special XML characters
 */
function escapeXML(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Validate SVG content
 */
export function validateSVG(svgContent: string): { valid: boolean; error?: string } {
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(svgContent, 'image/svg+xml');

    // Check for parse errors
    const parseError = doc.querySelector('parsererror');
    if (parseError) {
      return { valid: false, error: 'Invalid SVG: ' + parseError.textContent };
    }

    // Check for SVG root element
    const svg = doc.querySelector('svg');
    if (!svg) {
      return { valid: false, error: 'No SVG element found' };
    }

    return { valid: true };
  } catch (e) {
    return { valid: false, error: 'Failed to parse SVG: ' + (e as Error).message };
  }
}

/**
 * Generate a thumbnail preview of the SVG (returns data URL)
 */
export async function generateThumbnail(
  svgContent: string,
  width: number = 200,
  height: number = 60
): Promise<string> {
  return new Promise((resolve, reject) => {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');

    if (!ctx) {
      reject(new Error('Could not get canvas context'));
      return;
    }

    const img = new Image();
    const blob = new Blob([svgContent], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);

    img.onload = () => {
      // White background
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, width, height);

      // Draw SVG scaled to fit
      const scale = Math.min(width / img.width, height / img.height);
      const x = (width - img.width * scale) / 2;
      const y = (height - img.height * scale) / 2;
      ctx.drawImage(img, x, y, img.width * scale, img.height * scale);

      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL('image/png'));
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Failed to load SVG for thumbnail'));
    };

    img.src = url;
  });
}

/**
 * Storage key for custom SVG templates
 */
const SVG_TEMPLATES_STORAGE_KEY = 'open2dstudio_svg_titleblock_templates';

// ============================================================================
// Built-in 3BM title block templates (A4, A3, A2, A1, A0)
// Lightweight inline SVG templates with {{placeholder}} field syntax
// ============================================================================

/** Generate a simple 3BM-style title block SVG for the given paper size */
function make3BMTemplateSVG(
  widthMm: number,
  heightMm: number,
  paperLabel: string,
  tbWidth: number,
  tbHeight: number
): string {
  const tbX = widthMm - tbWidth - 5;
  const tbY = heightMm - tbHeight - 5;
  const revX = tbX - tbWidth - 5;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${widthMm}mm" height="${heightMm}mm" viewBox="0 0 ${widthMm} ${heightMm}">
  <rect x="5" y="5" width="${widthMm - 10}" height="${heightMm - 10}" fill="none" stroke="#000" stroke-width="0.7"/>
  <rect x="20" y="20" width="${widthMm - 40}" height="${heightMm - 60}" fill="none" stroke="#000" stroke-width="0.35"/>
  <!-- Title block -->
  <rect x="${tbX}" y="${tbY}" width="${tbWidth}" height="${tbHeight}" fill="white" stroke="#000" stroke-width="0.5"/>
  <line x1="${tbX}" y1="${tbY + 10}" x2="${tbX + tbWidth}" y2="${tbY + 10}" stroke="#000" stroke-width="0.35"/>
  <line x1="${tbX}" y1="${tbY + 20}" x2="${tbX + tbWidth}" y2="${tbY + 20}" stroke="#000" stroke-width="0.35"/>
  <line x1="${tbX}" y1="${tbY + 30}" x2="${tbX + tbWidth}" y2="${tbY + 30}" stroke="#000" stroke-width="0.35"/>
  <line x1="${tbX + Math.round(tbWidth * 0.4)}" y1="${tbY}" x2="${tbX + Math.round(tbWidth * 0.4)}" y2="${tbY + tbHeight}" stroke="#000" stroke-width="0.35"/>
  <line x1="${tbX + Math.round(tbWidth * 0.75)}" y1="${tbY + 20}" x2="${tbX + Math.round(tbWidth * 0.75)}" y2="${tbY + tbHeight}" stroke="#000" stroke-width="0.35"/>
  <!-- 3BM label -->
  <text x="${tbX + Math.round(tbWidth * 0.2)}" y="${tbY + 8}" font-family="Arial,sans-serif" font-size="7" font-weight="bold" text-anchor="middle" fill="#000">3BM</text>
  <!-- Field labels -->
  <text x="${tbX + 2}" y="${tbY + 15}" font-family="Arial,sans-serif" font-size="2.5" fill="#666">Project</text>
  <text x="${tbX + 2}" y="${tbY + 19}" font-family="Arial,sans-serif" font-size="3.5" fill="#000">{{projectnaam}}</text>
  <text x="${tbX + Math.round(tbWidth * 0.4) + 2}" y="${tbY + 13}" font-family="Arial,sans-serif" font-size="2.5" fill="#666">Tekening</text>
  <text x="${tbX + Math.round(tbWidth * 0.4) + 2}" y="${tbY + 18}" font-family="Arial,sans-serif" font-size="3.5" fill="#000">{{title}}</text>
  <text x="${tbX + 2}" y="${tbY + 25}" font-family="Arial,sans-serif" font-size="2.5" fill="#666">Schaal</text>
  <text x="${tbX + 2}" y="${tbY + 29}" font-family="Arial,sans-serif" font-size="3" fill="#000">{{schaal}}</text>
  <text x="${tbX + Math.round(tbWidth * 0.4) + 2}" y="${tbY + 25}" font-family="Arial,sans-serif" font-size="2.5" fill="#666">Datum</text>
  <text x="${tbX + Math.round(tbWidth * 0.4) + 2}" y="${tbY + 29}" font-family="Arial,sans-serif" font-size="3" fill="#000">{{datum}}</text>
  <text x="${tbX + Math.round(tbWidth * 0.75) + 2}" y="${tbY + 25}" font-family="Arial,sans-serif" font-size="2.5" fill="#666">Tekeningnr.</text>
  <text x="${tbX + Math.round(tbWidth * 0.75) + 2}" y="${tbY + 29}" font-family="Arial,sans-serif" font-size="3" fill="#000">{{kenmerk}}</text>
  <text x="${tbX + 2}" y="${tbY + 35}" font-family="Arial,sans-serif" font-size="2.5" fill="#666">Gemaakt door</text>
  <text x="${tbX + 2}" y="${tbY + 39}" font-family="Arial,sans-serif" font-size="3" fill="#000">{{auteur}}</text>
  <text x="${tbX + Math.round(tbWidth * 0.4) + 2}" y="${tbY + 35}" font-family="Arial,sans-serif" font-size="2.5" fill="#666">Gecontroleerd</text>
  <text x="${tbX + Math.round(tbWidth * 0.4) + 2}" y="${tbY + 39}" font-family="Arial,sans-serif" font-size="3" fill="#000">{{checkedby}}</text>
  <text x="${tbX + Math.round(tbWidth * 0.75) + 2}" y="${tbY + 35}" font-family="Arial,sans-serif" font-size="2.5" fill="#666">Bladnr.</text>
  <text x="${tbX + Math.round(tbWidth * 0.75) + 2}" y="${tbY + 39}" font-family="Arial,sans-serif" font-size="3" fill="#000">{{blad}}</text>
  <!-- Revision table -->
  <rect x="${revX}" y="${tbY}" width="${tbWidth}" height="${tbHeight}" fill="white" stroke="#000" stroke-width="0.5"/>
  <text x="${revX + 2}" y="${tbY + 6}" font-family="Arial,sans-serif" font-size="2.5" font-weight="bold" fill="#000">Rev. | Datum | Omschrijving | Gemaakt</text>
  <line x1="${revX}" y1="${tbY + 8}" x2="${revX + tbWidth}" y2="${tbY + 8}" stroke="#000" stroke-width="0.35"/>
  <!-- Paper label -->
  <text x="${widthMm - 6}" y="12" font-family="Arial,sans-serif" font-size="3" text-anchor="end" fill="#000">${paperLabel}</text>
</svg>`;
}

/** Standard field mappings for a 3BM title block */
const STANDARD_3BM_FIELD_MAPPINGS: SVGFieldMapping[] = [
  { fieldId: 'projectnaam', svgSelector: '{{projectnaam}}', label: 'Projectnaam', defaultValue: '' },
  { fieldId: 'title', svgSelector: '{{title}}', label: 'Tekeningstitel', defaultValue: '' },
  { fieldId: 'schaal', svgSelector: '{{schaal}}', label: 'Schaal', defaultValue: '1:100', isAutoField: true, autoFieldType: 'scale' },
  { fieldId: 'datum', svgSelector: '{{datum}}', label: 'Datum', defaultValue: '', isAutoField: true, autoFieldType: 'date' },
  { fieldId: 'kenmerk', svgSelector: '{{kenmerk}}', label: 'Tekeningnummer', defaultValue: '' },
  { fieldId: 'auteur', svgSelector: '{{auteur}}', label: 'Gemaakt door', defaultValue: '' },
  { fieldId: 'checkedby', svgSelector: '{{checkedby}}', label: 'Gecontroleerd door', defaultValue: '' },
  { fieldId: 'blad', svgSelector: '{{blad}}', label: 'Bladnummer', defaultValue: '1', isAutoField: true, autoFieldType: 'sheetNumber' },
];

/**
 * Built-in 3BM SVG title block templates (A4, A3, A2, A1, A0)
 */
export const BUILT_IN_SVG_TEMPLATES: SVGTitleBlockTemplate[] = [
  {
    id: 'builtin_3bm_a4',
    name: '3BM Tekenkader A4',
    description: '3BM standaard tekenkader formaat A4 (210×297mm)',
    paperSizes: ['A4'],
    svgContent: make3BMTemplateSVG(210, 297, 'A4', 150, 45),
    width: 150,
    height: 45,
    fieldMappings: STANDARD_3BM_FIELD_MAPPINGS,
    isBuiltIn: true,
    isFullPage: false,
    createdAt: '2026-04-14T00:00:00.000Z',
    modifiedAt: '2026-04-14T00:00:00.000Z',
  },
  {
    id: 'builtin_3bm_a3',
    name: '3BM Tekenkader A3',
    description: '3BM standaard tekenkader formaat A3 (420×297mm)',
    paperSizes: ['A3'],
    svgContent: make3BMTemplateSVG(420, 297, 'A3', 175, 45),
    width: 175,
    height: 45,
    fieldMappings: STANDARD_3BM_FIELD_MAPPINGS,
    isBuiltIn: true,
    isFullPage: false,
    createdAt: '2026-04-14T00:00:00.000Z',
    modifiedAt: '2026-04-14T00:00:00.000Z',
  },
  {
    id: 'builtin_3bm_a2',
    name: '3BM Tekenkader A2',
    description: '3BM standaard tekenkader formaat A2 (594×420mm)',
    paperSizes: ['A2'],
    svgContent: make3BMTemplateSVG(594, 420, 'A2', 185, 50),
    width: 185,
    height: 50,
    fieldMappings: STANDARD_3BM_FIELD_MAPPINGS,
    isBuiltIn: true,
    isFullPage: false,
    createdAt: '2026-04-14T00:00:00.000Z',
    modifiedAt: '2026-04-14T00:00:00.000Z',
  },
  {
    id: 'builtin_3bm_a1',
    name: '3BM Tekenkader A1',
    description: '3BM standaard tekenkader formaat A1 (841×594mm)',
    paperSizes: ['A1'],
    svgContent: make3BMTemplateSVG(841, 594, 'A1', 190, 55),
    width: 190,
    height: 55,
    fieldMappings: STANDARD_3BM_FIELD_MAPPINGS,
    isBuiltIn: true,
    isFullPage: false,
    createdAt: '2026-04-14T00:00:00.000Z',
    modifiedAt: '2026-04-14T00:00:00.000Z',
  },
  {
    id: 'builtin_3bm_a0',
    name: '3BM Tekenkader A0',
    description: '3BM standaard tekenkader formaat A0 (1189×841mm)',
    paperSizes: ['A0'],
    svgContent: make3BMTemplateSVG(1189, 841, 'A0', 200, 55),
    width: 200,
    height: 55,
    fieldMappings: STANDARD_3BM_FIELD_MAPPINGS,
    isBuiltIn: true,
    isFullPage: false,
    createdAt: '2026-04-14T00:00:00.000Z',
    modifiedAt: '2026-04-14T00:00:00.000Z',
  },
];

/**
 * Load custom SVG templates from localStorage
 */
export function loadCustomSVGTemplates(): SVGTitleBlockTemplate[] {
  try {
    const stored = localStorage.getItem(SVG_TEMPLATES_STORAGE_KEY);
    const custom: SVGTitleBlockTemplate[] = stored ? JSON.parse(stored) : [];
    // Merge built-in templates (prepend) with custom templates, filtering out
    // any user-stored copies of built-in IDs so built-ins always reflect latest
    const customFiltered = custom.filter(t => !BUILT_IN_SVG_TEMPLATES.some(b => b.id === t.id));
    return [...BUILT_IN_SVG_TEMPLATES, ...customFiltered];
  } catch {
    return [...BUILT_IN_SVG_TEMPLATES];
  }
}

/**
 * Save custom SVG templates to localStorage (excludes built-in templates)
 */
export function saveCustomSVGTemplates(templates: SVGTitleBlockTemplate[]): void {
  const customOnly = templates.filter(t => !BUILT_IN_SVG_TEMPLATES.some(b => b.id === t.id));
  localStorage.setItem(SVG_TEMPLATES_STORAGE_KEY, JSON.stringify(customOnly));
}

/**
 * Add a new custom SVG template
 */
export function addCustomSVGTemplate(template: SVGTitleBlockTemplate): void {
  const allTemplates = loadCustomSVGTemplates();
  // Only persist non-built-in templates
  const customOnly = allTemplates.filter(t => !BUILT_IN_SVG_TEMPLATES.some(b => b.id === t.id));
  customOnly.push(template);
  localStorage.setItem(SVG_TEMPLATES_STORAGE_KEY, JSON.stringify(customOnly));
}

/**
 * Delete a custom SVG template (built-in templates cannot be deleted)
 */
export function deleteCustomSVGTemplate(templateId: string): void {
  if (BUILT_IN_SVG_TEMPLATES.some(t => t.id === templateId)) return;
  const allTemplates = loadCustomSVGTemplates();
  const customOnly = allTemplates.filter(t => !BUILT_IN_SVG_TEMPLATES.some(b => b.id === t.id));
  const filtered = customOnly.filter(t => t.id !== templateId);
  localStorage.setItem(SVG_TEMPLATES_STORAGE_KEY, JSON.stringify(filtered));
}

/**
 * Export a template as a JSON file
 */
export function exportTemplateAsJSON(template: SVGTitleBlockTemplate): string {
  return JSON.stringify(template, null, 2);
}

/**
 * Import a template from JSON
 */
export function importTemplateFromJSON(json: string): SVGTitleBlockTemplate | null {
  try {
    const template = JSON.parse(json) as SVGTitleBlockTemplate;

    // Validate required fields
    if (!template.svgContent || !template.name || !template.fieldMappings) {
      return null;
    }

    // Generate new ID to avoid conflicts
    template.id = generateSVGTemplateId();
    template.isBuiltIn = false;
    template.createdAt = new Date().toISOString();
    template.modifiedAt = new Date().toISOString();

    return template;
  } catch {
    return null;
  }
}
