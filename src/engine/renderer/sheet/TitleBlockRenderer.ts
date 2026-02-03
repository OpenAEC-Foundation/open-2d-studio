/**
 * TitleBlockRenderer - Renders sheet title blocks
 *
 * Supports both basic TitleBlock format and enhanced EnhancedTitleBlock
 * with template-based layouts, revision tables, and logos.
 */

import type { TitleBlock } from '../types';
import type { EnhancedTitleBlock, TitleBlockTemplate, TitleBlockLayout } from '../../../types/sheet';
import { BaseRenderer } from '../core/BaseRenderer';
import { MM_TO_PIXELS, COLORS } from '../types';
import { getTemplateById } from '../../../services/titleBlockService';
import { loadCustomSVGTemplates, renderSVGTitleBlock } from '../../../services/svgTitleBlockService';

export class TitleBlockRenderer extends BaseRenderer {
  private logoImageCache: Map<string, HTMLImageElement> = new Map();
  private svgImageCache: Map<string, HTMLImageElement> = new Map();

  /**
   * Draw title block at bottom-right of paper
   */
  drawTitleBlock(
    titleBlock: TitleBlock | EnhancedTitleBlock,
    paperWidth: number,
    paperHeight: number
  ): void {
    const ctx = this.ctx;

    // Check for SVG template ID
    const svgTemplateId = (titleBlock as { svgTemplateId?: string }).svgTemplateId;
    if (svgTemplateId) {
      this.drawSVGTitleBlock(svgTemplateId, titleBlock, paperWidth, paperHeight);
      return;
    }

    // Check if this is an enhanced title block
    const isEnhanced = 'templateId' in titleBlock || 'revisionTable' in titleBlock || 'logo' in titleBlock;

    // Position title block at bottom-right of paper (common placement)
    const tbWidth = titleBlock.width * MM_TO_PIXELS;
    const tbHeight = titleBlock.height * MM_TO_PIXELS;
    const tbX = paperWidth - tbWidth - titleBlock.x * MM_TO_PIXELS;
    const tbY = paperHeight - tbHeight - titleBlock.y * MM_TO_PIXELS;

    // Get template if available
    let template: TitleBlockTemplate | undefined;
    if (isEnhanced && (titleBlock as EnhancedTitleBlock).templateId) {
      template = getTemplateById((titleBlock as EnhancedTitleBlock).templateId!);
    }

    // Draw title block background
    ctx.fillStyle = template?.layout?.backgroundColor || COLORS.titleBlockBackground;
    ctx.fillRect(tbX, tbY, tbWidth, tbHeight);

    // Draw title block outer border
    const borderWidth = template?.layout?.borderWidth || 2;
    ctx.strokeStyle = template?.layout?.gridColor || COLORS.titleBlockBorder;
    ctx.lineWidth = borderWidth;
    ctx.strokeRect(tbX, tbY, tbWidth, tbHeight);

    if (template) {
      // Render using template layout
      this.drawTemplateLayout(template.layout, titleBlock as EnhancedTitleBlock, tbX, tbY, tbWidth, tbHeight);
    } else {
      // Fall back to legacy grid rendering
      this.drawTitleBlockGrid(tbX, tbY, tbWidth, tbHeight);
      this.drawTitleBlockFields(titleBlock as TitleBlock, tbX, tbY);
    }

    // Draw logo if present (enhanced only)
    if (isEnhanced) {
      const enhanced = titleBlock as EnhancedTitleBlock;
      if (enhanced.logo) {
        this.drawLogo(enhanced.logo, tbX, tbY);
      }

      // Draw revision table if present
      if (enhanced.revisionTable?.visible && enhanced.revisionTable.revisions.length > 0) {
        this.drawRevisionTable(enhanced.revisionTable, tbX, tbY, tbWidth, tbHeight);
      }
    }
  }

  /**
   * Draw SVG-based title block
   */
  private drawSVGTitleBlock(
    svgTemplateId: string,
    titleBlock: TitleBlock | EnhancedTitleBlock,
    paperWidth: number,
    paperHeight: number
  ): void {
    const ctx = this.ctx;

    // Load SVG template from localStorage
    const svgTemplates = loadCustomSVGTemplates();
    const svgTemplate = svgTemplates.find(t => t.id === svgTemplateId);

    if (!svgTemplate) {
      // Template not found, fall back to default rendering
      console.warn(`SVG template ${svgTemplateId} not found`);
      return;
    }

    // Determine dimensions and position based on full-page mode
    let tbWidth: number;
    let tbHeight: number;
    let tbX: number;
    let tbY: number;

    if (svgTemplate.isFullPage) {
      // Full-page template: cover entire paper
      tbWidth = paperWidth;
      tbHeight = paperHeight;
      tbX = 0;
      tbY = 0;
    } else {
      // Traditional title block: position at bottom-right corner
      tbWidth = svgTemplate.width * MM_TO_PIXELS;
      tbHeight = svgTemplate.height * MM_TO_PIXELS;
      tbX = paperWidth - tbWidth - (titleBlock.x || 10) * MM_TO_PIXELS;
      tbY = paperHeight - tbHeight - (titleBlock.y || 10) * MM_TO_PIXELS;
    }

    // Build field values from title block fields
    const fieldValues: Record<string, string> = {};
    for (const field of titleBlock.fields) {
      fieldValues[field.id] = field.value || '';
    }

    // Render SVG with substituted values
    const renderedSvg = renderSVGTitleBlock(svgTemplate, fieldValues);

    // Check if we have a cached image for this SVG
    const cacheKey = `${svgTemplateId}_${JSON.stringify(fieldValues)}`;
    let img = this.svgImageCache.get(cacheKey);

    if (!img) {
      // Create new image from SVG
      img = new Image();
      const blob = new Blob([renderedSvg], { type: 'image/svg+xml' });
      const url = URL.createObjectURL(blob);

      img.onload = () => {
        // Draw the image once loaded
        ctx.drawImage(img!, tbX, tbY, tbWidth, tbHeight);
        URL.revokeObjectURL(url);
      };

      img.onerror = () => {
        console.error('Failed to load SVG title block');
        URL.revokeObjectURL(url);
      };

      img.src = url;
      this.svgImageCache.set(cacheKey, img);
    } else if (img.complete) {
      // Draw cached image
      ctx.drawImage(img, tbX, tbY, tbWidth, tbHeight);
    }
  }

  /**
   * Draw title block using template layout
   */
  private drawTemplateLayout(
    layout: TitleBlockLayout,
    titleBlock: EnhancedTitleBlock,
    tbX: number,
    tbY: number,
    tbWidth: number,
    _tbHeight: number
  ): void {
    const ctx = this.ctx;

    // Draw grid lines based on template rows
    ctx.lineWidth = 0.5;
    ctx.strokeStyle = layout.gridColor || '#000000';

    let currentY = tbY;
    for (let i = 0; i < layout.rows.length; i++) {
      const row = layout.rows[i];
      const rowHeight = row.height * MM_TO_PIXELS;

      // Draw horizontal line (except for first row, use outer border)
      if (i > 0) {
        ctx.beginPath();
        ctx.moveTo(tbX, currentY);
        ctx.lineTo(tbX + tbWidth, currentY);
        ctx.stroke();
      }

      // Draw vertical lines for cells
      let currentX = tbX;
      for (let j = 0; j < row.cells.length - 1; j++) {
        const cell = row.cells[j];
        const cellWidth = (tbWidth * cell.widthPercent) / 100;
        currentX += cellWidth;

        ctx.beginPath();
        ctx.moveTo(currentX, currentY);
        ctx.lineTo(currentX, currentY + rowHeight);
        ctx.stroke();
      }

      // Draw cell contents
      let cellX = tbX;
      for (const cell of row.cells) {
        const cellWidth = (tbWidth * cell.widthPercent) / 100;

        // Find the field for this cell
        const field = titleBlock.fields.find(f => f.id === cell.fieldId);
        if (field) {
          this.drawCellContent(
            field,
            cellX,
            currentY,
            cellWidth,
            rowHeight,
            cell.alignment,
            cell.fontSize,
            cell.isBold
          );
        }

        cellX += cellWidth;
      }

      currentY += rowHeight;
    }
  }

  /**
   * Draw cell content (label and value)
   */
  private drawCellContent(
    field: EnhancedTitleBlock['fields'][0],
    x: number,
    y: number,
    width: number,
    _height: number,
    alignment: 'left' | 'center' | 'right',
    fontSize: number,
    isBold: boolean
  ): void {
    const ctx = this.ctx;
    const padding = 2 * MM_TO_PIXELS;

    // Calculate text position based on alignment
    let textX = x + padding;
    if (alignment === 'center') {
      textX = x + width / 2;
    } else if (alignment === 'right') {
      textX = x + width - padding;
    }

    ctx.textBaseline = 'top';
    ctx.textAlign = alignment;

    // Draw label (smaller, gray)
    const labelFontSize = Math.max(6, fontSize - 2);
    ctx.fillStyle = COLORS.titleBlockLabel;
    ctx.font = `${labelFontSize}px Arial`;
    ctx.fillText(field.label, textX, y + padding);

    // Draw value (larger, below label)
    const valueFontSize = fontSize;
    ctx.fillStyle = COLORS.titleBlockValue;
    ctx.font = `${isBold ? 'bold ' : ''}${valueFontSize}px Arial`;
    const value = field.value || '';
    ctx.fillText(value, textX, y + padding + labelFontSize + 2);

    // Reset text align
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
  }

  /**
   * Draw logo in title block
   */
  private drawLogo(
    logo: NonNullable<EnhancedTitleBlock['logo']>,
    tbX: number,
    tbY: number
  ): void {
    const ctx = this.ctx;

    // Check if image is cached
    let img = this.logoImageCache.get(logo.data);

    if (!img) {
      // Create new image element
      img = new Image();
      img.src = logo.data;
      this.logoImageCache.set(logo.data, img);

      // Draw once loaded
      img.onload = () => {
        ctx.drawImage(
          img!,
          tbX + logo.x * MM_TO_PIXELS,
          tbY + logo.y * MM_TO_PIXELS,
          logo.width * MM_TO_PIXELS,
          logo.height * MM_TO_PIXELS
        );
      };
    } else if (img.complete) {
      // Draw cached image
      ctx.drawImage(
        img,
        tbX + logo.x * MM_TO_PIXELS,
        tbY + logo.y * MM_TO_PIXELS,
        logo.width * MM_TO_PIXELS,
        logo.height * MM_TO_PIXELS
      );
    }
  }

  /**
   * Draw revision table above title block
   */
  private drawRevisionTable(
    revisionTable: NonNullable<EnhancedTitleBlock['revisionTable']>,
    tbX: number,
    tbY: number,
    tbWidth: number,
    _tbHeight: number
  ): void {
    const ctx = this.ctx;

    // Calculate revision table dimensions
    const rowHeight = 8 * MM_TO_PIXELS;
    const headerHeight = 10 * MM_TO_PIXELS;
    const numRevisions = Math.min(revisionTable.revisions.length, revisionTable.maxRows);
    const tableHeight = headerHeight + (numRevisions * rowHeight);

    // Position above title block
    const tableY = tbY - tableHeight - 5 * MM_TO_PIXELS;

    // Calculate column widths
    const totalWidthPercent = revisionTable.columns.reduce((sum, col) => sum + col.width, 0);
    const columnWidths = revisionTable.columns.map(col => (tbWidth * col.width) / totalWidthPercent);

    // Draw table background
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(tbX, tableY, tbWidth, tableHeight);

    // Draw table border
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 1;
    ctx.strokeRect(tbX, tableY, tbWidth, tableHeight);

    // Draw header
    ctx.fillStyle = '#f0f0f0';
    ctx.fillRect(tbX, tableY, tbWidth, headerHeight);
    ctx.strokeRect(tbX, tableY, tbWidth, headerHeight);

    // Draw header text
    ctx.fillStyle = '#000000';
    ctx.font = 'bold 8px Arial';
    ctx.textBaseline = 'middle';

    let colX = tbX;
    for (let i = 0; i < revisionTable.columns.length; i++) {
      const col = revisionTable.columns[i];
      ctx.fillText(col.label, colX + 3, tableY + headerHeight / 2);

      // Draw column divider
      if (i > 0) {
        ctx.beginPath();
        ctx.moveTo(colX, tableY);
        ctx.lineTo(colX, tableY + tableHeight);
        ctx.stroke();
      }

      colX += columnWidths[i];
    }

    // Draw revision rows (newest at top)
    ctx.font = '8px Arial';
    const revisionsToShow = revisionTable.revisions.slice(-numRevisions).reverse();

    for (let i = 0; i < revisionsToShow.length; i++) {
      const rev = revisionsToShow[i];
      const rowY = tableY + headerHeight + (i * rowHeight);

      // Draw row divider
      ctx.beginPath();
      ctx.moveTo(tbX, rowY);
      ctx.lineTo(tbX + tbWidth, rowY);
      ctx.stroke();

      // Draw cell values
      colX = tbX;
      for (let j = 0; j < revisionTable.columns.length; j++) {
        const col = revisionTable.columns[j];
        let value = '';

        switch (col.id) {
          case 'number': value = rev.number; break;
          case 'date': value = rev.date; break;
          case 'description': value = rev.description; break;
          case 'drawnBy': value = rev.drawnBy; break;
        }

        // Truncate if too long
        const maxWidth = columnWidths[j] - 6;
        const metrics = ctx.measureText(value);
        if (metrics.width > maxWidth) {
          while (ctx.measureText(value + '...').width > maxWidth && value.length > 0) {
            value = value.slice(0, -1);
          }
          value += '...';
        }

        ctx.fillText(value, colX + 3, rowY + rowHeight / 2);
        colX += columnWidths[j];
      }
    }

    ctx.textBaseline = 'alphabetic';
  }

  /**
   * Draw title block internal grid lines (legacy)
   */
  private drawTitleBlockGrid(
    tbX: number,
    tbY: number,
    tbWidth: number,
    tbHeight: number
  ): void {
    const ctx = this.ctx;

    ctx.lineWidth = 0.5;
    ctx.strokeStyle = COLORS.titleBlockBorder;
    ctx.beginPath();

    // Horizontal dividers - 4 rows
    const rowHeights = [15, 15, 15, 15]; // mm
    let currentY = tbY;
    for (let i = 0; i < rowHeights.length - 1; i++) {
      currentY += rowHeights[i] * MM_TO_PIXELS;
      ctx.moveTo(tbX, currentY);
      ctx.lineTo(tbX + tbWidth, currentY);
    }

    // Vertical dividers - adaptive based on fields
    // First row split
    const col1Width = 90 * MM_TO_PIXELS; // Project column
    ctx.moveTo(tbX + col1Width, tbY);
    ctx.lineTo(tbX + col1Width, tbY + 15 * MM_TO_PIXELS);

    // Second row split
    const col2Width = 125 * MM_TO_PIXELS; // Title column
    ctx.moveTo(tbX + col2Width, tbY + 15 * MM_TO_PIXELS);
    ctx.lineTo(tbX + col2Width, tbY + 30 * MM_TO_PIXELS);

    // Third row splits (5 columns for Scale/Date/Drawn/Checked/Approved)
    const smallColWidth = tbWidth / 5;
    for (let i = 1; i < 5; i++) {
      const x = tbX + smallColWidth * i;
      ctx.moveTo(x, tbY + 30 * MM_TO_PIXELS);
      ctx.lineTo(x, tbY + 45 * MM_TO_PIXELS);
    }

    // Fourth row splits (Sheet/Revision | Status)
    ctx.moveTo(tbX + 80 * MM_TO_PIXELS, tbY + 45 * MM_TO_PIXELS);
    ctx.lineTo(tbX + 80 * MM_TO_PIXELS, tbY + tbHeight);
    ctx.moveTo(tbX + 125 * MM_TO_PIXELS, tbY + 45 * MM_TO_PIXELS);
    ctx.lineTo(tbX + 125 * MM_TO_PIXELS, tbY + tbHeight);

    ctx.stroke();
  }

  /**
   * Draw title block fields with labels and values (legacy)
   */
  private drawTitleBlockFields(
    titleBlock: TitleBlock,
    tbX: number,
    tbY: number
  ): void {
    const ctx = this.ctx;

    ctx.textBaseline = 'top';

    for (const field of titleBlock.fields) {
      const fieldX = tbX + field.x * MM_TO_PIXELS;
      const fieldY = tbY + field.y * MM_TO_PIXELS;

      // Draw label (smaller, gray)
      ctx.fillStyle = COLORS.titleBlockLabel;
      ctx.font = `${Math.max(7, (field.fontSize || 8) - 2)}px ${field.fontFamily || 'Arial'}`;
      ctx.fillText(field.label, fieldX, fieldY);

      // Draw value (larger, black, below label)
      ctx.fillStyle = COLORS.titleBlockValue;
      ctx.font = `bold ${field.fontSize || 10}px ${field.fontFamily || 'Arial'}`;
      const value = field.value || '';
      ctx.fillText(value, fieldX, fieldY + 10);
    }

    ctx.textBaseline = 'alphabetic';
  }

  /**
   * Clear the logo cache
   */
  clearLogoCache(): void {
    this.logoImageCache.clear();
  }
}
