/**
 * PAT File Service - Import/Export for industry-standard hatch pattern files
 *
 * PAT file format:
 * - Lines starting with ; or // are comments
 * - Pattern header: *pattern-name, description
 * - Line family: angle, x-origin, y-origin, delta-x, delta-y, [dash, gap, ...]
 *
 * Example:
 * *ANSI31, ANSI Iron, Brick, Stone masonry
 * 45, 0, 0, 0, .125
 *
 * *CROSS, Crosshatch pattern
 * 0, 0, 0, 0, .25
 * 90, 0, 0, 0, .25
 */

import type { CustomHatchPattern, LineFamily, HatchPatternScaleType } from '../../types/hatch';

/** Result of parsing a PAT file */
export interface PatParseResult {
  patterns: CustomHatchPattern[];
  errors: string[];
  warnings: string[];
}

/** Result of parsing a single pattern */
interface ParsedPattern {
  name: string;
  description?: string;
  lineFamilies: LineFamily[];
}

/**
 * Parse a PAT file content into CustomHatchPattern objects
 */
export function parsePATFile(content: string, scaleType: HatchPatternScaleType = 'drafting'): PatParseResult {
  const patterns: CustomHatchPattern[] = [];
  const errors: string[] = [];
  const warnings: string[] = [];

  const lines = content.split(/\r?\n/);
  let currentPattern: ParsedPattern | null = null;
  let lineNumber = 0;

  for (const rawLine of lines) {
    lineNumber++;
    const line = rawLine.trim();

    // Skip empty lines
    if (!line) continue;

    // Skip comments (both ; and // style)
    if (line.startsWith(';') || line.startsWith('//')) continue;

    // Pattern header line starts with *
    if (line.startsWith('*')) {
      // Save previous pattern if exists
      if (currentPattern) {
        if (currentPattern.lineFamilies.length > 0) {
          patterns.push(createPatternFromParsed(currentPattern, scaleType));
        } else {
          warnings.push(`Line ${lineNumber}: Pattern "${currentPattern.name}" has no line families, skipped`);
        }
      }

      // Parse new pattern header
      const headerMatch = line.match(/^\*([^,]+)(?:,\s*(.*))?$/);
      if (headerMatch) {
        currentPattern = {
          name: headerMatch[1].trim(),
          description: headerMatch[2]?.trim(),
          lineFamilies: [],
        };
      } else {
        errors.push(`Line ${lineNumber}: Invalid pattern header format`);
        currentPattern = null;
      }
      continue;
    }

    // Line family definition (must have a current pattern)
    if (currentPattern) {
      const lineFamily = parseLineFamilyLine(line, lineNumber, errors);
      if (lineFamily) {
        currentPattern.lineFamilies.push(lineFamily);
      }
    } else {
      warnings.push(`Line ${lineNumber}: Line family outside of pattern definition, skipped`);
    }
  }

  // Save last pattern
  if (currentPattern) {
    if (currentPattern.lineFamilies.length > 0) {
      patterns.push(createPatternFromParsed(currentPattern, scaleType));
    } else {
      warnings.push(`Pattern "${currentPattern.name}" has no line families, skipped`);
    }
  }

  return { patterns, errors, warnings };
}

/**
 * Parse a line family definition line
 * Format: angle, x-origin, y-origin, delta-x, delta-y, [dash, gap, ...]
 */
function parseLineFamilyLine(line: string, lineNumber: number, errors: string[]): LineFamily | null {
  // Split by comma, handling potential whitespace
  const parts = line.split(',').map(s => s.trim());

  if (parts.length < 5) {
    errors.push(`Line ${lineNumber}: Line family needs at least 5 values (angle, x, y, dx, dy)`);
    return null;
  }

  const values = parts.map(s => parseFloat(s));

  // Check for NaN values in required fields
  for (let i = 0; i < 5; i++) {
    if (isNaN(values[i])) {
      errors.push(`Line ${lineNumber}: Invalid number at position ${i + 1}`);
      return null;
    }
  }

  const lineFamily: LineFamily = {
    angle: values[0],
    originX: values[1],
    originY: values[2],
    deltaX: values[3],
    deltaY: values[4],
  };

  // Parse dash pattern if present (values after the first 5)
  if (parts.length > 5) {
    const dashPattern: number[] = [];
    for (let i = 5; i < parts.length; i++) {
      const dashValue = parseFloat(parts[i]);
      if (!isNaN(dashValue)) {
        dashPattern.push(dashValue);
      }
    }
    if (dashPattern.length > 0) {
      lineFamily.dashPattern = dashPattern;
    }
  }

  return lineFamily;
}

/**
 * Create a CustomHatchPattern from parsed data
 */
function createPatternFromParsed(parsed: ParsedPattern, scaleType: HatchPatternScaleType): CustomHatchPattern {
  return {
    id: generatePatternId(parsed.name),
    name: parsed.name,
    description: parsed.description,
    scaleType,
    source: 'imported',
    sourceFormat: 'pat',
    lineFamilies: parsed.lineFamilies,
    createdAt: new Date().toISOString(),
    modifiedAt: new Date().toISOString(),
  };
}

/**
 * Generate a unique pattern ID from name
 */
function generatePatternId(name: string): string {
  const base = name.toLowerCase().replace(/[^a-z0-9]/g, '-');
  const timestamp = Date.now().toString(36);
  return `pat-${base}-${timestamp}`;
}

/**
 * Export patterns to PAT file format
 */
export function exportToPAT(patterns: CustomHatchPattern[]): string {
  const lines: string[] = [];

  // Add header comment
  lines.push(';; Custom Hatch Patterns');
  lines.push(`;; Exported from Open 2D Studio`);
  lines.push(`;; Date: ${new Date().toISOString()}`);
  lines.push('');

  for (const pattern of patterns) {
    // Pattern header
    const header = pattern.description
      ? `*${pattern.name}, ${pattern.description}`
      : `*${pattern.name}`;
    lines.push(header);

    // Line families
    for (const family of pattern.lineFamilies) {
      const parts: string[] = [
        formatNumber(family.angle),
        formatNumber(family.originX),
        formatNumber(family.originY),
        formatNumber(family.deltaX),
        formatNumber(family.deltaY),
      ];

      // Add dash pattern if present
      if (family.dashPattern && family.dashPattern.length > 0) {
        for (const dash of family.dashPattern) {
          parts.push(formatNumber(dash));
        }
      }

      lines.push(parts.join(', '));
    }

    // Empty line between patterns
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Format a number for PAT file (remove unnecessary decimals)
 */
function formatNumber(value: number): string {
  // Round to 6 decimal places to avoid floating point noise
  const rounded = Math.round(value * 1000000) / 1000000;
  // Convert to string and remove trailing zeros after decimal
  return rounded.toString();
}

/**
 * Validate a PAT file content (quick check without full parsing)
 */
export function validatePATContent(content: string): { valid: boolean; patternCount: number; error?: string } {
  if (!content || content.trim().length === 0) {
    return { valid: false, patternCount: 0, error: 'File is empty' };
  }

  const lines = content.split(/\r?\n/);
  let patternCount = 0;
  let hasValidContent = false;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith(';') || line.startsWith('//')) continue;

    hasValidContent = true;
    if (line.startsWith('*')) {
      patternCount++;
    }
  }

  if (!hasValidContent) {
    return { valid: false, patternCount: 0, error: 'File contains only comments or is empty' };
  }

  if (patternCount === 0) {
    return { valid: false, patternCount: 0, error: 'No pattern definitions found (patterns start with *)' };
  }

  return { valid: true, patternCount };
}

/**
 * Read a PAT file using the File API
 */
export async function readPATFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result);
      } else {
        reject(new Error('Failed to read file as text'));
      }
    };
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsText(file);
  });
}

/**
 * Download content as a PAT file
 */
export function downloadPATFile(content: string, filename: string): void {
  const blob = new Blob([content], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename.endsWith('.pat') ? filename : `${filename}.pat`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/**
 * Open file picker for PAT files
 */
export function openPATFilePicker(): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.pat,.PAT';
    input.onchange = () => {
      const file = input.files?.[0] || null;
      resolve(file);
    };
    input.oncancel = () => resolve(null);
    input.click();
  });
}
