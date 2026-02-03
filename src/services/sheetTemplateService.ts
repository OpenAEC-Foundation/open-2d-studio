/**
 * Sheet Template Service - Business logic for sheet template operations
 *
 * Provides:
 * - Built-in sheet templates for common layouts
 * - Template creation and management
 * - Sheet creation from templates
 * - Automatic sheet numbering
 */

import type {
  SheetTemplate,
  ViewportPlaceholder,
} from '../types/sheet';
import type { Sheet, SheetViewport } from '../types/geometry';
import { generateViewportId } from './sheetService';

/**
 * Generate a unique ID for sheet templates
 */
export function generateSheetTemplateId(): string {
  return `st_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * Built-in sheet templates (empty - users create their own templates)
 */
export const BUILT_IN_SHEET_TEMPLATES: SheetTemplate[] = [];

// ============================================================================
// Template Helper Functions
// ============================================================================

/**
 * Get a sheet template by ID
 */
export function getSheetTemplateById(id: string): SheetTemplate | undefined {
  return BUILT_IN_SHEET_TEMPLATES.find(t => t.id === id);
}

/**
 * Get templates compatible with a paper size
 */
export function getSheetTemplatesForPaperSize(paperSize: string): SheetTemplate[] {
  return BUILT_IN_SHEET_TEMPLATES.filter(t => t.paperSize === paperSize);
}

/**
 * Get all templates grouped by paper size
 */
export function getTemplatesGroupedByPaperSize(): Record<string, SheetTemplate[]> {
  const groups: Record<string, SheetTemplate[]> = {};

  for (const template of BUILT_IN_SHEET_TEMPLATES) {
    if (!groups[template.paperSize]) {
      groups[template.paperSize] = [];
    }
    groups[template.paperSize].push(template);
  }

  return groups;
}

/**
 * Create viewports from template placeholders
 */
export function createViewportsFromTemplate(
  template: SheetTemplate,
  drawingAssignments: Record<string, string> // placeholderId -> drawingId
): SheetViewport[] {
  const viewports: SheetViewport[] = [];

  for (const placeholder of template.viewportPlaceholders) {
    const drawingId = drawingAssignments[placeholder.id];
    if (!drawingId) continue; // Skip placeholders without assigned drafts

    viewports.push({
      id: generateViewportId(),
      drawingId,
      x: placeholder.x,
      y: placeholder.y,
      width: placeholder.width,
      height: placeholder.height,
      scale: placeholder.defaultScale,
      centerX: 0,
      centerY: 0,
      locked: false,
      visible: true,
    });
  }

  return viewports;
}

// ============================================================================
// Sheet Numbering
// ============================================================================

/**
 * Sheet numbering scheme configuration
 */
export interface SheetNumberingScheme {
  prefix: string;      // e.g., "A" for architectural
  separator: string;   // e.g., "-" or "."
  startNumber: number;
  digits: number;      // Pad with zeros (3 = "001")
}

/**
 * Discipline prefixes for sheet numbering
 */
export const DISCIPLINE_PREFIXES: Record<string, { prefix: string; name: string }> = {
  general: { prefix: 'G', name: 'General' },
  architectural: { prefix: 'A', name: 'Architectural' },
  structural: { prefix: 'S', name: 'Structural' },
  mechanical: { prefix: 'M', name: 'Mechanical' },
  electrical: { prefix: 'E', name: 'Electrical' },
  plumbing: { prefix: 'P', name: 'Plumbing' },
  fire: { prefix: 'FP', name: 'Fire Protection' },
  civil: { prefix: 'C', name: 'Civil' },
  landscape: { prefix: 'L', name: 'Landscape' },
};

/**
 * Default numbering scheme
 */
export const DEFAULT_NUMBERING_SCHEME: SheetNumberingScheme = {
  prefix: 'A',
  separator: '-',
  startNumber: 101,
  digits: 3,
};

/**
 * Generate a sheet number based on scheme
 */
export function generateSheetNumber(
  scheme: SheetNumberingScheme,
  sequence: number
): string {
  const number = scheme.startNumber + sequence;
  const paddedNumber = number.toString().padStart(scheme.digits, '0');
  return `${scheme.prefix}${scheme.separator}${paddedNumber}`;
}

/**
 * Parse a sheet number to extract components
 */
export function parseSheetNumber(sheetNumber: string): {
  prefix: string;
  separator: string;
  number: number;
} | null {
  // Try common patterns: A-101, A.101, A101
  const match = sheetNumber.match(/^([A-Z]+)([-.]?)(\d+)$/i);
  if (!match) return null;

  return {
    prefix: match[1].toUpperCase(),
    separator: match[2] || '-',
    number: parseInt(match[3], 10),
  };
}

/**
 * Renumber sheets based on a scheme
 */
export function renumberSheets(
  sheets: Sheet[],
  scheme: SheetNumberingScheme
): { sheetId: string; newNumber: string }[] {
  return sheets.map((sheet, index) => ({
    sheetId: sheet.id,
    newNumber: generateSheetNumber(scheme, index),
  }));
}

/**
 * Get next available sheet number
 */
export function getNextSheetNumber(
  existingSheets: Sheet[],
  scheme: SheetNumberingScheme
): string {
  // Find the highest number with matching prefix
  let maxNumber = scheme.startNumber - 1;

  for (const sheet of existingSheets) {
    // Check if sheet has a number field in title block
    const numberField = sheet.titleBlock.fields.find(f => f.id === 'number' || f.id === 'sheetNo');
    if (!numberField?.value) continue;

    const parsed = parseSheetNumber(numberField.value);
    if (parsed && parsed.prefix === scheme.prefix) {
      maxNumber = Math.max(maxNumber, parsed.number);
    }
  }

  return generateSheetNumber(scheme, maxNumber - scheme.startNumber + 1);
}

/**
 * Save sheet as template
 */
export function createTemplateFromSheet(
  sheet: Sheet,
  name: string,
  description: string
): SheetTemplate {
  // Convert viewports to placeholders
  const placeholders: ViewportPlaceholder[] = sheet.viewports.map((vp, index) => ({
    id: `placeholder-${index + 1}`,
    name: `View ${index + 1}`,
    x: vp.x,
    y: vp.y,
    width: vp.width,
    height: vp.height,
    defaultScale: vp.scale,
  }));

  return {
    id: generateSheetTemplateId(),
    name,
    description,
    paperSize: sheet.paperSize,
    orientation: sheet.orientation,
    titleBlockTemplateId: '', // Would need to extract from sheet
    viewportPlaceholders: placeholders,
    isBuiltIn: false,
    createdAt: new Date().toISOString(),
    modifiedAt: new Date().toISOString(),
  };
}
