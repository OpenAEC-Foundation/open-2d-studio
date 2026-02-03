/**
 * Title Block Service - Business logic for title block operations
 *
 * Provides:
 * - Built-in title block templates for various paper sizes
 * - Template creation and management
 * - Auto-field value calculation
 * - Revision management
 */

import type {
  TitleBlockTemplate,
  TitleBlockLayout,
  EnhancedTitleBlock,
  RevisionTable,
  Revision,
} from '../types/sheet';

/**
 * Generate a unique ID for title block templates
 */
export function generateTemplateId(): string {
  return `tb_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * Built-in title block templates (empty - users import their own SVG templates)
 */
export const BUILT_IN_TEMPLATES: TitleBlockTemplate[] = [];

// ============================================================================
// Template Helper Functions
// ============================================================================

/**
 * Get a template by ID
 */
export function getTemplateById(id: string): TitleBlockTemplate | undefined {
  return BUILT_IN_TEMPLATES.find(t => t.id === id);
}

/**
 * Get templates compatible with a paper size
 */
export function getTemplatesForPaperSize(paperSize: string): TitleBlockTemplate[] {
  return BUILT_IN_TEMPLATES.filter(t =>
    t.paperSizes.includes(paperSize) || t.paperSizes.includes('Custom')
  );
}

/**
 * Calculate title block dimensions from layout
 */
export function calculateTitleBlockDimensions(layout: TitleBlockLayout): { width: number; height: number } {
  const height = layout.rows.reduce((sum, row) => sum + row.height, 0);

  // Width is typically fixed per template, but we can calculate a default
  // based on common title block proportions
  const width = height * 3; // 3:1 aspect ratio is common

  return { width, height };
}

/**
 * Create an enhanced title block from a template
 */
export function createTitleBlockFromTemplate(
  template: TitleBlockTemplate,
  x: number = 10,
  y: number = 10
): EnhancedTitleBlock {
  const dims = calculateTitleBlockDimensions(template.layout);

  // Convert template fields to title block fields with positions
  const fields = createFieldsFromTemplate(template, dims.width, dims.height);

  return {
    visible: true,
    templateId: template.id,
    x,
    y,
    width: dims.width,
    height: dims.height,
    fields,
    revisionTable: createDefaultRevisionTable(),
  };
}

/**
 * Create fields with positions from a template
 */
function createFieldsFromTemplate(
  template: TitleBlockTemplate,
  width: number,
  _height: number
): EnhancedTitleBlock['fields'] {
  const fields: EnhancedTitleBlock['fields'] = [];
  let currentY = 0;

  for (const row of template.layout.rows) {
    let currentX = 0;

    for (const cell of row.cells) {
      const cellWidth = (width * cell.widthPercent) / 100;
      const defaultField = template.defaultFields.find(f => f.id === cell.fieldId);

      if (defaultField) {
        fields.push({
          id: cell.fieldId,
          label: defaultField.label,
          value: defaultField.value,
          x: currentX + 2, // Small padding
          y: currentY + 2,
          width: cellWidth - 4,
          height: row.height - 4,
          fontSize: cell.fontSize,
          fontFamily: 'Arial',
          align: cell.alignment,
        });
      }

      currentX += cellWidth;
    }

    currentY += row.height;
  }

  return fields;
}

/**
 * Create a default revision table
 */
export function createDefaultRevisionTable(): RevisionTable {
  return {
    visible: false,
    maxRows: 5,
    columns: [
      { id: 'number', label: 'Rev', width: 15 },
      { id: 'date', label: 'Date', width: 25 },
      { id: 'description', label: 'Description', width: 50 },
      { id: 'drawnBy', label: 'By', width: 15 },
    ],
    revisions: [],
  };
}

/**
 * Add a revision to the table
 */
export function addRevision(
  table: RevisionTable,
  description: string,
  drawnBy: string
): RevisionTable {
  const nextNumber = getNextRevisionNumber(table.revisions);

  const newRevision: Revision = {
    number: nextNumber,
    date: new Date().toISOString().split('T')[0],
    description,
    drawnBy,
  };

  return {
    ...table,
    revisions: [...table.revisions, newRevision],
  };
}

/**
 * Get the next revision number
 */
function getNextRevisionNumber(revisions: Revision[]): string {
  if (revisions.length === 0) return 'A';

  const lastRev = revisions[revisions.length - 1].number;

  // Handle letter revisions (A, B, C, ...)
  if (/^[A-Z]$/.test(lastRev)) {
    const charCode = lastRev.charCodeAt(0);
    if (charCode < 90) { // Less than 'Z'
      return String.fromCharCode(charCode + 1);
    }
    return 'AA'; // After Z comes AA
  }

  // Handle numeric revisions (1, 2, 3, ...)
  if (/^\d+$/.test(lastRev)) {
    return (parseInt(lastRev, 10) + 1).toString();
  }

  // Handle compound revisions (AA, AB, etc.)
  return lastRev + 'A';
}

// ============================================================================
// Auto-Field Calculations
// ============================================================================

export interface AutoFieldContext {
  totalSheets: number;
  currentSheetIndex: number;
  projectName: string;
  viewportScales: number[];
}

/**
 * Calculate auto-field values
 */
export function calculateAutoFields(
  fields: EnhancedTitleBlock['fields'],
  context: AutoFieldContext
): EnhancedTitleBlock['fields'] {
  return fields.map(field => {
    switch (field.id) {
      case 'date':
        // Auto-fill current date if empty
        if (!field.value) {
          return { ...field, value: new Date().toISOString().split('T')[0] };
        }
        return field;

      case 'sheetNo':
        // Auto-fill sheet number
        return {
          ...field,
          value: `${context.currentSheetIndex + 1} of ${context.totalSheets}`,
        };

      case 'scale':
        // Auto-calculate scale from viewports
        if (context.viewportScales.length === 0) {
          return { ...field, value: '-' };
        }
        if (context.viewportScales.length === 1) {
          return { ...field, value: formatScaleForDisplay(context.viewportScales[0]) };
        }
        // Multiple scales
        const uniqueScales = [...new Set(context.viewportScales)];
        if (uniqueScales.length === 1) {
          return { ...field, value: formatScaleForDisplay(uniqueScales[0]) };
        }
        return { ...field, value: 'As Noted' };

      case 'project':
        // Auto-fill project name if provided and field is empty
        if (!field.value && context.projectName) {
          return { ...field, value: context.projectName };
        }
        return field;

      default:
        return field;
    }
  });
}

/**
 * Format a scale value for display
 */
function formatScaleForDisplay(scale: number): string {
  if (scale >= 1) {
    if (Number.isInteger(scale)) {
      return `${scale}:1`;
    }
    return `${scale.toFixed(1)}:1`;
  }
  const inverse = 1 / scale;
  if (Number.isInteger(inverse)) {
    return `1:${inverse}`;
  }
  return `1:${Math.round(inverse)}`;
}

/**
 * Update a field value in the title block
 */
export function updateFieldValue(
  titleBlock: EnhancedTitleBlock,
  fieldId: string,
  value: string
): EnhancedTitleBlock {
  return {
    ...titleBlock,
    fields: titleBlock.fields.map(field =>
      field.id === fieldId ? { ...field, value } : field
    ),
  };
}

/**
 * Update multiple field values
 */
export function updateFieldValues(
  titleBlock: EnhancedTitleBlock,
  updates: Record<string, string>
): EnhancedTitleBlock {
  return {
    ...titleBlock,
    fields: titleBlock.fields.map(field =>
      updates[field.id] !== undefined ? { ...field, value: updates[field.id] } : field
    ),
  };
}

// ============================================================================
// Logo Operations
// ============================================================================

/**
 * Set logo on title block
 */
export function setLogo(
  titleBlock: EnhancedTitleBlock,
  logoData: string,
  width: number,
  height: number
): EnhancedTitleBlock {
  // Find logo field position or use default position
  const logoField = titleBlock.fields.find(f => f.id === 'logo');

  return {
    ...titleBlock,
    logo: {
      data: logoData,
      x: logoField?.x ?? 5,
      y: logoField?.y ?? 5,
      width,
      height,
    },
  };
}

/**
 * Remove logo from title block
 */
export function removeLogo(titleBlock: EnhancedTitleBlock): EnhancedTitleBlock {
  const { logo: _, ...rest } = titleBlock;
  return rest as EnhancedTitleBlock;
}
