import { jsPDF } from 'jspdf';
import { save } from '@tauri-apps/plugin-dialog';
import { writeFile } from '@tauri-apps/plugin-fs';
import type { Shape, Sheet } from '../../types/geometry';
import type { ParametricShape, ProfileParametricShape } from '../../types/parametric';
import type { CustomHatchPattern } from '../../types/hatch';
import type { PrintSettings } from '../../state/slices/uiSlice';
import { renderShapesToCanvas } from './printRenderer';
import { loadCustomSVGTemplates, renderSVGTitleBlock } from '../../services/svgTitleBlockService';

const PAPER_SIZES: Record<string, { width: number; height: number }> = {
  'A4': { width: 210, height: 297 },
  'A3': { width: 297, height: 420 },
  'A2': { width: 420, height: 594 },
  'A1': { width: 594, height: 841 },
  'A0': { width: 841, height: 1189 },
  'Letter': { width: 216, height: 279 },
  'Legal': { width: 216, height: 356 },
  'Tabloid': { width: 279, height: 432 },
};

const QUALITY_DPI: Record<string, number> = {
  draft: 72,
  normal: 150,
  high: 300,
  presentation: 600,
};

function calculateExtents(shapes: Shape[]): { minX: number; minY: number; maxX: number; maxY: number } | null {
  if (shapes.length === 0) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const shape of shapes) {
    if (!shape.visible) continue;
    switch (shape.type) {
      case 'line':
        minX = Math.min(minX, shape.start.x, shape.end.x);
        minY = Math.min(minY, shape.start.y, shape.end.y);
        maxX = Math.max(maxX, shape.start.x, shape.end.x);
        maxY = Math.max(maxY, shape.start.y, shape.end.y);
        break;
      case 'rectangle':
        minX = Math.min(minX, shape.topLeft.x, shape.topLeft.x + shape.width);
        minY = Math.min(minY, shape.topLeft.y, shape.topLeft.y + shape.height);
        maxX = Math.max(maxX, shape.topLeft.x, shape.topLeft.x + shape.width);
        maxY = Math.max(maxY, shape.topLeft.y, shape.topLeft.y + shape.height);
        break;
      case 'circle':
        minX = Math.min(minX, shape.center.x - shape.radius);
        minY = Math.min(minY, shape.center.y - shape.radius);
        maxX = Math.max(maxX, shape.center.x + shape.radius);
        maxY = Math.max(maxY, shape.center.y + shape.radius);
        break;
      case 'arc':
        minX = Math.min(minX, shape.center.x - shape.radius);
        minY = Math.min(minY, shape.center.y - shape.radius);
        maxX = Math.max(maxX, shape.center.x + shape.radius);
        maxY = Math.max(maxY, shape.center.y + shape.radius);
        break;
      case 'ellipse':
        minX = Math.min(minX, shape.center.x - shape.radiusX);
        minY = Math.min(minY, shape.center.y - shape.radiusY);
        maxX = Math.max(maxX, shape.center.x + shape.radiusX);
        maxY = Math.max(maxY, shape.center.y + shape.radiusY);
        break;
      case 'polyline':
      case 'spline':
        for (const p of shape.points) {
          minX = Math.min(minX, p.x);
          minY = Math.min(minY, p.y);
          maxX = Math.max(maxX, p.x);
          maxY = Math.max(maxY, p.y);
        }
        break;
      case 'text':
        minX = Math.min(minX, shape.position.x);
        minY = Math.min(minY, shape.position.y);
        maxX = Math.max(maxX, shape.position.x + 100);
        maxY = Math.max(maxY, shape.position.y + shape.fontSize);
        break;
      case 'hatch':
        for (const p of shape.points) {
          minX = Math.min(minX, p.x);
          minY = Math.min(minY, p.y);
          maxX = Math.max(maxX, p.x);
          maxY = Math.max(maxY, p.y);
        }
        break;
    }
  }
  if (minX === Infinity) return null;
  return { minX, minY, maxX, maxY };
}

const PLOT_SCALES: Record<string, number> = {
  'Fit': 0,
  '1:1': 1, '1:2': 0.5, '1:5': 0.2, '1:10': 0.1, '1:20': 0.05,
  '1:50': 0.02, '1:100': 0.01, '2:1': 2, '5:1': 5, '10:1': 10,
};

function renderPage(
  shapes: Shape[],
  settings: PrintSettings,
  paperWidthMM: number,
  paperHeightMM: number,
  customPatterns?: CustomHatchPattern[],
): HTMLCanvasElement | null {
  const bounds = calculateExtents(shapes);
  if (!bounds) return null;

  const dpi = QUALITY_DPI[settings.rasterQuality] || 150;
  const mmToPx = dpi / 25.4;

  const margins = settings.margins;
  const printableWidthMM = paperWidthMM - margins.left - margins.right;
  const printableHeightMM = paperHeightMM - margins.top - margins.bottom;
  const printableWidthPx = printableWidthMM * mmToPx;
  const printableHeightPx = printableHeightMM * mmToPx;

  const contentWidth = bounds.maxX - bounds.minX;
  const contentHeight = bounds.maxY - bounds.minY;

  let plotScale: number;
  if (settings.scale === 'Fit') {
    const scaleX = printableWidthPx / contentWidth;
    const scaleY = printableHeightPx / contentHeight;
    plotScale = Math.min(scaleX, scaleY);
  } else if (settings.customScale) {
    plotScale = settings.customScale * mmToPx;
  } else {
    plotScale = (PLOT_SCALES[settings.scale] || 1) * mmToPx;
  }

  const canvas = document.createElement('canvas');
  canvas.width = Math.round(paperWidthMM * mmToPx);
  canvas.height = Math.round(paperHeightMM * mmToPx);
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  let offsetX: number, offsetY: number;
  const marginLeftPx = margins.left * mmToPx;
  const marginTopPx = margins.top * mmToPx;

  if (settings.centerPlot) {
    offsetX = marginLeftPx + (printableWidthPx - contentWidth * plotScale) / 2 - bounds.minX * plotScale;
    offsetY = marginTopPx + (printableHeightPx - contentHeight * plotScale) / 2 - bounds.minY * plotScale;
  } else {
    offsetX = marginLeftPx + settings.offsetX * mmToPx - bounds.minX * plotScale;
    offsetY = marginTopPx + settings.offsetY * mmToPx - bounds.minY * plotScale;
  }

  renderShapesToCanvas(ctx, shapes, {
    scale: plotScale,
    offsetX,
    offsetY,
    appearance: settings.appearance,
    plotLineweights: settings.plotLineweights,
    dpi,
    customPatterns,
  });

  return canvas;
}

/**
 * Render parametric shapes to canvas for PDF export
 */
function renderParametricShapesToCanvas(
  ctx: CanvasRenderingContext2D,
  shapes: ParametricShape[],
  options: {
    scale: number;
    offsetX: number;
    offsetY: number;
    appearance: 'color' | 'grayscale' | 'blackLines';
    dpi?: number;
  }
): void {
  const { scale, offsetX, offsetY, appearance, dpi = 150 } = options;

  // Calculate minimum visible line width (0.25mm minimum for print visibility)
  const minLineWidthMM = 0.25;
  const minLineWidthPx = minLineWidthMM * (dpi / 25.4);

  ctx.save();

  for (const shape of shapes) {
    if (shape.parametricType !== 'profile') continue;

    const profileShape = shape as ProfileParametricShape;
    const geometry = profileShape.generatedGeometry;

    if (!geometry || geometry.outlines.length === 0) continue;

    // Determine stroke color based on appearance settings
    let strokeColor = shape.style.strokeColor;
    if (appearance === 'blackLines') {
      strokeColor = '#000000';
    } else if (appearance === 'grayscale') {
      // Convert to grayscale
      const hex = strokeColor.replace('#', '');
      const r = parseInt(hex.substr(0, 2), 16);
      const g = parseInt(hex.substr(2, 2), 16);
      const b = parseInt(hex.substr(4, 2), 16);
      const gray = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
      strokeColor = `rgb(${gray}, ${gray}, ${gray})`;
    } else if (strokeColor === '#ffffff') {
      // Convert white to black for visibility on white paper
      strokeColor = '#000000';
    }

    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = Math.max(shape.style.strokeWidth * scale, minLineWidthPx);

    // Draw each outline
    for (let i = 0; i < geometry.outlines.length; i++) {
      const outline = geometry.outlines[i];
      const closed = geometry.closed[i];

      if (outline.length < 2) continue;

      ctx.beginPath();
      ctx.moveTo(outline[0].x * scale + offsetX, outline[0].y * scale + offsetY);

      for (let j = 1; j < outline.length; j++) {
        ctx.lineTo(outline[j].x * scale + offsetX, outline[j].y * scale + offsetY);
      }

      if (closed) {
        ctx.closePath();
      }

      ctx.stroke();
    }
  }

  ctx.restore();
}

/**
 * Render a sheet to canvas (with title block and viewports)
 */
async function renderSheetPage(
  sheet: Sheet,
  allShapes: Shape[],
  allParametricShapes: ParametricShape[],
  settings: PrintSettings,
  customPatterns?: CustomHatchPattern[],
): Promise<HTMLCanvasElement> {
  const sheetPaper = PAPER_SIZES[sheet.paperSize];
  if (!sheetPaper) throw new Error(`Unknown paper size: ${sheet.paperSize}`);

  const sheetIsLandscape = sheet.orientation === 'landscape';
  const sheetWidthMM = sheetIsLandscape ? sheetPaper.height : sheetPaper.width;
  const sheetHeightMM = sheetIsLandscape ? sheetPaper.width : sheetPaper.height;

  const dpi = QUALITY_DPI[settings.rasterQuality] || 150;
  const mmToPx = dpi / 25.4;

  const canvas = document.createElement('canvas');
  canvas.width = Math.round(sheetWidthMM * mmToPx);
  canvas.height = Math.round(sheetHeightMM * mmToPx);
  const ctx = canvas.getContext('2d')!;

  // White background
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Check for SVG title block
  const svgTemplateId = (sheet.titleBlock as { svgTemplateId?: string }).svgTemplateId;
  let svgTemplate: ReturnType<typeof loadCustomSVGTemplates>[0] | undefined;

  if (svgTemplateId) {
    const svgTemplates = loadCustomSVGTemplates();
    svgTemplate = svgTemplates.find(t => t.id === svgTemplateId);

    if (svgTemplate) {
      // Render SVG title block
      await renderSvgToCanvasForPdf(
        ctx,
        svgTemplate,
        sheet.titleBlock.fields,
        svgTemplate.isFullPage ? 0 : canvas.width - svgTemplate.width * mmToPx - (sheet.titleBlock.x || 10) * mmToPx,
        svgTemplate.isFullPage ? 0 : canvas.height - svgTemplate.height * mmToPx - (sheet.titleBlock.y || 10) * mmToPx,
        svgTemplate.isFullPage ? canvas.width : svgTemplate.width * mmToPx,
        svgTemplate.isFullPage ? canvas.height : svgTemplate.height * mmToPx
      );
    }
  }

  // Render viewports
  for (const vp of sheet.viewports) {
    if (!vp.visible) continue;

    const vpX = vp.x * mmToPx;
    const vpY = vp.y * mmToPx;
    const vpW = vp.width * mmToPx;
    const vpH = vp.height * mmToPx;

    // Viewport background (white - same as paper)
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(vpX, vpY, vpW, vpH);

    // Get shapes for this viewport
    const vpShapes = allShapes.filter(s => s.drawingId === vp.drawingId && s.visible);
    const vpParametricShapes = allParametricShapes.filter(s => s.drawingId === vp.drawingId && s.visible);

    if (vpShapes.length > 0 || vpParametricShapes.length > 0) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(vpX, vpY, vpW, vpH);
      ctx.clip();

      const vpCenterX = vpX + vpW / 2;
      const vpCenterY = vpY + vpH / 2;
      const vpScale = vp.scale * mmToPx;

      renderShapesToCanvas(ctx, vpShapes, {
        scale: vpScale,
        offsetX: vpCenterX - vp.centerX * vpScale,
        offsetY: vpCenterY - vp.centerY * vpScale,
        appearance: settings.appearance,
        plotLineweights: settings.plotLineweights,
        dpi,
        customPatterns,
      });

      // Render parametric shapes
      renderParametricShapesToCanvas(ctx, vpParametricShapes, {
        scale: vpScale,
        offsetX: vpCenterX - vp.centerX * vpScale,
        offsetY: vpCenterY - vp.centerY * vpScale,
        appearance: settings.appearance,
        dpi,
      });

      ctx.restore();
    }
    // Note: No viewport border for print output - drawings should appear seamlessly on paper
  }

  return canvas;
}

/**
 * Helper to render SVG to canvas for PDF export
 */
function renderSvgToCanvasForPdf(
  ctx: CanvasRenderingContext2D,
  template: ReturnType<typeof loadCustomSVGTemplates>[0],
  fields: { id: string; value: string }[],
  x: number,
  y: number,
  width: number,
  height: number
): Promise<void> {
  return new Promise((resolve) => {
    const fieldValues: Record<string, string> = {};
    for (const field of fields) {
      fieldValues[field.id] = field.value || '';
    }

    const renderedSvg = renderSVGTitleBlock(template, fieldValues);
    const img = new Image();
    const blob = new Blob([renderedSvg], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);

    img.onload = () => {
      ctx.drawImage(img, x, y, width, height);
      URL.revokeObjectURL(url);
      resolve();
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve();
    };

    img.src = url;
  });
}

export async function exportToPDF(options: {
  shapes: Shape[];
  sheets?: Sheet[];
  allShapes?: Shape[];
  allParametricShapes?: ParametricShape[];
  settings: PrintSettings;
  projectName: string;
  activeSheet?: Sheet | null;
  customPatterns?: CustomHatchPattern[];
}): Promise<string | null> {
  const { shapes, sheets, allShapes, allParametricShapes = [], settings, projectName, activeSheet, customPatterns } = options;

  const paper = PAPER_SIZES[settings.paperSize];
  if (!paper) throw new Error(`Unknown paper size: ${settings.paperSize}`);

  const isLandscape = settings.orientation === 'landscape';
  const paperWidthMM = isLandscape ? paper.height : paper.width;
  const paperHeightMM = isLandscape ? paper.width : paper.height;

  const orientation = isLandscape ? 'landscape' : 'portrait';
  const doc = new jsPDF({
    orientation,
    unit: 'mm',
    format: [paperWidthMM, paperHeightMM],
  });

  if (settings.printRange === 'selectedSheets' && sheets && allShapes) {
    // Export selected sheets
    const selectedSheets = sheets.filter(s => settings.selectedSheetIds.includes(s.id));
    let firstPage = true;

    for (const sheet of selectedSheets) {
      const sheetPaper = PAPER_SIZES[sheet.paperSize];
      const sheetIsLandscape = sheet.orientation === 'landscape';
      const sheetWidthMM = sheetIsLandscape ? sheetPaper.height : sheetPaper.width;
      const sheetHeightMM = sheetIsLandscape ? sheetPaper.width : sheetPaper.height;
      const sheetOrientation = sheetIsLandscape ? 'landscape' : 'portrait';

      if (!firstPage) {
        doc.addPage([sheetWidthMM, sheetHeightMM], sheetOrientation);
      }
      firstPage = false;

      const canvas = await renderSheetPage(sheet, allShapes, allParametricShapes, settings, customPatterns);
      const imgData = canvas.toDataURL('image/png');
      doc.addImage(imgData, 'PNG', 0, 0, sheetWidthMM, sheetHeightMM);
    }
  } else if (activeSheet && allShapes) {
    // Export current active sheet
    const sheetPaper = PAPER_SIZES[activeSheet.paperSize];
    const sheetIsLandscape = activeSheet.orientation === 'landscape';
    const sheetWidthMM = sheetIsLandscape ? sheetPaper.height : sheetPaper.width;
    const sheetHeightMM = sheetIsLandscape ? sheetPaper.width : sheetPaper.height;

    const canvas = await renderSheetPage(activeSheet, allShapes, allParametricShapes, settings, customPatterns);
    const imgData = canvas.toDataURL('image/png');

    // Update doc page size to match sheet
    doc.internal.pageSize.width = sheetWidthMM;
    doc.internal.pageSize.height = sheetHeightMM;

    doc.addImage(imgData, 'PNG', 0, 0, sheetWidthMM, sheetHeightMM);
  } else {
    // Export drawing shapes only (no sheet)
    const canvas = renderPage(shapes, settings, paperWidthMM, paperHeightMM, customPatterns);
    if (canvas) {
      const imgData = canvas.toDataURL('image/png');
      doc.addImage(imgData, 'PNG', 0, 0, paperWidthMM, paperHeightMM);
    }
  }

  const pdfOutput = doc.output('arraybuffer');

  const filePath = await save({
    filters: [{ name: 'PDF Document', extensions: ['pdf'] }],
    title: 'Export PDF',
    defaultPath: `${projectName}.pdf`,
  });

  if (!filePath) return null;

  await writeFile(filePath, new Uint8Array(pdfOutput));
  return filePath;
}
