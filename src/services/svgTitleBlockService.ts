/**
 * SVG Title Block Service
 *
 * Handles parsing, importing, and rendering of SVG-based title block templates.
 * Supports placeholder detection using {{fieldName}} syntax in text elements.
 */

import type { SVGTitleBlockTemplate, SVGFieldMapping } from '../types/sheet';

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

/**
 * Load custom SVG templates from localStorage
 */
export function loadCustomSVGTemplates(): SVGTitleBlockTemplate[] {
  try {
    const stored = localStorage.getItem(SVG_TEMPLATES_STORAGE_KEY);
    if (!stored) return [];
    return JSON.parse(stored);
  } catch {
    return [];
  }
}

/**
 * Save custom SVG templates to localStorage
 */
export function saveCustomSVGTemplates(templates: SVGTitleBlockTemplate[]): void {
  localStorage.setItem(SVG_TEMPLATES_STORAGE_KEY, JSON.stringify(templates));
}

/**
 * Add a new custom SVG template
 */
export function addCustomSVGTemplate(template: SVGTitleBlockTemplate): void {
  const templates = loadCustomSVGTemplates();
  templates.push(template);
  saveCustomSVGTemplates(templates);
}

/**
 * Delete a custom SVG template
 */
export function deleteCustomSVGTemplate(templateId: string): void {
  const templates = loadCustomSVGTemplates();
  const filtered = templates.filter(t => t.id !== templateId);
  saveCustomSVGTemplates(filtered);
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
