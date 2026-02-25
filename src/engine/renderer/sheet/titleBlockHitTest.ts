/**
 * Title Block Hit Test - Computes field bounding rects for click detection
 *
 * Mirrors the geometry logic from TitleBlockRenderer to produce pixel-space
 * bounding boxes for each title block field.
 */

import type { TitleBlock } from '../types';
import type { EnhancedTitleBlock, TitleBlockTemplate, SVGTitleBlockTemplate } from '../../../types/sheet';
import { MM_TO_PIXELS } from '../types';
import { getTemplateById } from '../../../services/template/titleBlockService';
import { loadCustomSVGTemplates } from '../../../services/export/svgTitleBlockService';
import { CAD_DEFAULT_FONT } from '../../../constants/cadDefaults';

export interface TitleBlockFieldRect {
  fieldId: string;
  label: string;
  value: string;
  /** Pixel-space X (within sheet canvas coordinates, before viewport transform) */
  x: number;
  /** Pixel-space Y */
  y: number;
  /** Pixel-space width */
  width: number;
  /** Pixel-space height */
  height: number;
  fontSize: number;
  fontFamily: string;
  align: 'left' | 'center' | 'right';
  isBold: boolean;
}

/**
 * Cache for SVG field rects to avoid re-parsing on every mouse move.
 * Key: svgTemplateId + bounds hash
 */
const svgFieldRectsCache = new Map<string, TitleBlockFieldRect[]>();

/**
 * Compute the absolute pixel-space origin and size of the title block
 */
export function getTitleBlockBounds(
  titleBlock: TitleBlock | EnhancedTitleBlock,
  paperWidthPx: number,
  paperHeightPx: number
): { tbX: number; tbY: number; tbWidth: number; tbHeight: number } {
  const tbWidth = titleBlock.width * MM_TO_PIXELS;
  const tbHeight = titleBlock.height * MM_TO_PIXELS;
  const tbX = paperWidthPx - tbWidth - titleBlock.x * MM_TO_PIXELS;
  const tbY = paperHeightPx - tbHeight - titleBlock.y * MM_TO_PIXELS;
  return { tbX, tbY, tbWidth, tbHeight };
}

/**
 * Compute pixel-space bounding rects for all editable title block fields.
 *
 * Supports three layout modes:
 * - SVG templates: parses SVG DOM to extract field positions
 * - Template-based (enhanced): iterates rows/cells
 * - Legacy grid: uses explicit field coordinates
 */
export function getTitleBlockFieldRects(
  titleBlock: TitleBlock | EnhancedTitleBlock,
  paperWidthPx: number,
  paperHeightPx: number,
  customTemplates?: TitleBlockTemplate[]
): TitleBlockFieldRect[] {
  const svgTemplateId = (titleBlock as { svgTemplateId?: string }).svgTemplateId;
  if (svgTemplateId) {
    return getSVGTemplateFieldRects(svgTemplateId, titleBlock, paperWidthPx, paperHeightPx);
  }

  const { tbX, tbY, tbWidth, tbHeight } = getTitleBlockBounds(titleBlock, paperWidthPx, paperHeightPx);

  // Check if template-based (enhanced)
  const isEnhanced = 'templateId' in titleBlock || 'revisionTable' in titleBlock || 'logo' in titleBlock;
  let template: TitleBlockTemplate | undefined;
  if (isEnhanced && (titleBlock as EnhancedTitleBlock).templateId) {
    template = getTemplateById((titleBlock as EnhancedTitleBlock).templateId!, customTemplates);
  }

  if (template) {
    return getTemplateFieldRects(template, titleBlock as EnhancedTitleBlock, tbX, tbY, tbWidth, tbHeight);
  }

  return getLegacyFieldRects(titleBlock as TitleBlock, tbX, tbY, tbWidth, tbHeight);
}

/**
 * SVG template: parse the SVG DOM to extract field positions.
 *
 * Creates a temporary off-screen SVG element in the DOM, finds text/tspan
 * elements containing each field placeholder, and uses getBoundingClientRect()
 * to compute their positions relative to the SVG root. Results are cached
 * to avoid re-parsing on every mouse move.
 */
function getSVGTemplateFieldRects(
  svgTemplateId: string,
  titleBlock: TitleBlock | EnhancedTitleBlock,
  paperWidthPx: number,
  paperHeightPx: number
): TitleBlockFieldRect[] {
  // Load SVG template
  const svgTemplates = loadCustomSVGTemplates();
  const svgTemplate = svgTemplates.find(t => t.id === svgTemplateId);
  if (!svgTemplate) return [];

  // Compute title block bounds (mirrors drawSVGTitleBlock in TitleBlockRenderer)
  let tbX: number, tbY: number, tbWidth: number, tbHeight: number;
  if (svgTemplate.isFullPage) {
    tbX = 0;
    tbY = 0;
    tbWidth = paperWidthPx;
    tbHeight = paperHeightPx;
  } else {
    tbWidth = svgTemplate.width * MM_TO_PIXELS;
    tbHeight = svgTemplate.height * MM_TO_PIXELS;
    tbX = paperWidthPx - tbWidth - (titleBlock.x || 10) * MM_TO_PIXELS;
    tbY = paperHeightPx - tbHeight - (titleBlock.y || 10) * MM_TO_PIXELS;
  }

  // Check cache
  const cacheKey = `${svgTemplateId}_${tbX.toFixed(1)}_${tbY.toFixed(1)}_${tbWidth.toFixed(1)}_${tbHeight.toFixed(1)}`;
  const cached = svgFieldRectsCache.get(cacheKey);
  if (cached) {
    // Update values from current title block state (they might have changed)
    return cached.map(rect => {
      const field = titleBlock.fields.find(f => f.id === rect.fieldId);
      return field ? { ...rect, value: field.value || '' } : rect;
    });
  }

  // Parse field positions from SVG DOM
  const rects = parseSVGFieldPositions(svgTemplate, titleBlock, tbX, tbY, tbWidth, tbHeight);

  // Cache the results
  svgFieldRectsCache.set(cacheKey, rects);

  return rects;
}

/**
 * Parse the SVG template content to extract field bounding rects.
 *
 * Uses a temporary off-screen SVG element and getBoundingClientRect()
 * to reliably compute positions regardless of transforms.
 */
function parseSVGFieldPositions(
  svgTemplate: SVGTitleBlockTemplate,
  titleBlock: TitleBlock | EnhancedTitleBlock,
  tbX: number,
  tbY: number,
  tbWidth: number,
  tbHeight: number
): TitleBlockFieldRect[] {
  // Create temporary off-screen container
  const container = document.createElement('div');
  container.style.cssText = 'position:fixed;left:-9999px;top:-9999px;pointer-events:none;opacity:0;';
  container.innerHTML = svgTemplate.svgContent;
  document.body.appendChild(container);

  const liveSvg = container.querySelector('svg') as SVGSVGElement | null;
  if (!liveSvg) {
    document.body.removeChild(container);
    return [];
  }

  // Get the SVG element's bounding rect for computing relative positions
  const svgRect = liveSvg.getBoundingClientRect();
  if (svgRect.width === 0 || svgRect.height === 0) {
    document.body.removeChild(container);
    return [];
  }

  const rects: TitleBlockFieldRect[] = [];

  for (const mapping of svgTemplate.fieldMappings) {
    const field = titleBlock.fields.find(f => f.id === mapping.fieldId);
    if (!field) continue;

    // Find the element containing this placeholder
    const targetEl = findPlaceholderElement(liveSvg, mapping.svgSelector);
    if (!targetEl) continue;

    try {
      const elRect = targetEl.getBoundingClientRect();
      if (elRect.width === 0 && elRect.height === 0) continue;

      // Compute position relative to SVG element (normalized 0-1)
      const relX = (elRect.left - svgRect.left) / svgRect.width;
      const relY = (elRect.top - svgRect.top) / svgRect.height;
      const relW = elRect.width / svgRect.width;
      const relH = elRect.height / svgRect.height;

      // Map to canvas pixel coordinates with padding for easier clicking
      const padX = relW * 0.15;
      const padY = relH * 0.3;

      rects.push({
        fieldId: field.id,
        label: mapping.label || field.label,
        value: field.value || '',
        x: tbX + (relX - padX) * tbWidth,
        y: tbY + (relY - padY) * tbHeight,
        width: (relW + padX * 2) * tbWidth,
        height: (relH + padY * 2) * tbHeight,
        fontSize: 10,
        fontFamily: CAD_DEFAULT_FONT,
        align: 'left',
        isBold: false,
      });
    } catch {
      // getBoundingClientRect can fail for certain SVG elements
    }
  }

  document.body.removeChild(container);
  return rects;
}

/**
 * Find a text/tspan element in the SVG that contains the given placeholder.
 * Prefers tspan over text for more precise hit areas.
 */
function findPlaceholderElement(
  svgRoot: SVGSVGElement,
  placeholder: string
): Element | null {
  const allTextEls = svgRoot.querySelectorAll('text, tspan');
  let bestMatch: Element | null = null;

  for (const el of allTextEls) {
    // Check direct text content (including children)
    if (el.textContent?.includes(placeholder)) {
      bestMatch = el;
      // Prefer tspan (more specific) over text
      if (el.tagName.toLowerCase() === 'tspan') return el;
    }
  }

  return bestMatch;
}

/**
 * Template-based layout: iterate rows/cells (mirrors drawTemplateLayout)
 */
function getTemplateFieldRects(
  template: TitleBlockTemplate,
  titleBlock: EnhancedTitleBlock,
  tbX: number,
  tbY: number,
  tbWidth: number,
  _tbHeight: number
): TitleBlockFieldRect[] {
  const rects: TitleBlockFieldRect[] = [];
  const layout = template.layout;

  let currentY = tbY;
  for (const row of layout.rows) {
    const rowHeight = row.height * MM_TO_PIXELS;
    let cellX = tbX;

    for (const cell of row.cells) {
      const cellWidth = (tbWidth * cell.widthPercent) / 100;
      const field = titleBlock.fields.find(f => f.id === cell.fieldId);

      if (field) {
        // Position the rect exactly over the value text, matching the renderer layout
        const cellPadding = 2 * MM_TO_PIXELS;
        const labelFontSize = Math.max(6, cell.fontSize - 2);
        const valueY = currentY + cellPadding + labelFontSize + 2;

        // Match the text X position from the renderer
        let textX = cellX + cellPadding;
        let textWidth = cellWidth - cellPadding;
        if (cell.alignment === 'center') {
          textX = cellX;
          textWidth = cellWidth;
        } else if (cell.alignment === 'right') {
          textX = cellX;
          textWidth = cellWidth - cellPadding;
        }

        rects.push({
          fieldId: field.id,
          label: field.label,
          value: field.value || '',
          x: textX,
          y: valueY,
          width: textWidth,
          height: cell.fontSize + 2,
          fontSize: cell.fontSize,
          fontFamily: CAD_DEFAULT_FONT,
          align: cell.alignment,
          isBold: cell.isBold,
        });
      }

      cellX += cellWidth;
    }

    currentY += rowHeight;
  }

  return rects;
}

/**
 * Legacy grid layout: each field has explicit x, y, width, height in mm
 */
function getLegacyFieldRects(
  titleBlock: TitleBlock,
  tbX: number,
  tbY: number,
  _tbWidth: number,
  _tbHeight: number
): TitleBlockFieldRect[] {
  const rects: TitleBlockFieldRect[] = [];

  for (const field of titleBlock.fields) {
    // Use field dimensions if available, otherwise fall back to cell-based defaults
    const fieldW = field.width > 0 ? field.width * MM_TO_PIXELS : 30 * MM_TO_PIXELS;
    const valueFontSize = field.fontSize || 10;
    // Position exactly over the value text, matching the renderer layout
    // Legacy renderer draws value at (fieldX, fieldY + 10) with textBaseline: 'top'
    const valueYOffset = 10;

    rects.push({
      fieldId: field.id,
      label: field.label,
      value: field.value || '',
      x: tbX + field.x * MM_TO_PIXELS,
      y: tbY + field.y * MM_TO_PIXELS + valueYOffset,
      width: fieldW,
      height: valueFontSize + 2,
      fontSize: valueFontSize,
      fontFamily: field.fontFamily || CAD_DEFAULT_FONT,
      align: field.align || 'left',
      isBold: true,
    });
  }

  return rects;
}
