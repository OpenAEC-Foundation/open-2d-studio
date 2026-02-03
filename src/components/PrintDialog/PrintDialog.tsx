import { useState, useCallback, useEffect, useRef } from 'react';
import { X, Printer, FileDown, Save, Trash2, ChevronRight } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { useAppStore } from '../../state/appStore';
import type { PrintAppearance, RasterQuality, PrintRange } from '../../state/slices/uiSlice';
import { renderShapesToCanvas } from './printRenderer';
import { exportToPDF } from './pdfExport';
import { printViaWindow } from './browserPrint';
import { SheetSelectionDialog } from './SheetSelectionDialog';
import { getTemplateById } from '../../services/titleBlockService';
import { loadCustomSVGTemplates, renderSVGTitleBlock } from '../../services/svgTitleBlockService';

const PAPER_SIZES: Record<string, { width: number; height: number; label: string }> = {
  'A4': { width: 210, height: 297, label: 'A4 (210 x 297 mm)' },
  'A3': { width: 297, height: 420, label: 'A3 (297 x 420 mm)' },
  'A2': { width: 420, height: 594, label: 'A2 (420 x 594 mm)' },
  'A1': { width: 594, height: 841, label: 'A1 (594 x 841 mm)' },
  'A0': { width: 841, height: 1189, label: 'A0 (841 x 1189 mm)' },
  'Letter': { width: 216, height: 279, label: 'Letter (8.5 x 11 in)' },
  'Legal': { width: 216, height: 356, label: 'Legal (8.5 x 14 in)' },
  'Tabloid': { width: 279, height: 432, label: 'Tabloid (11 x 17 in)' },
};

const PLOT_SCALES: Record<string, number> = {
  'Fit': 0,
  '1:1': 1, '1:2': 0.5, '1:5': 0.2, '1:10': 0.1, '1:20': 0.05,
  '1:50': 0.02, '1:100': 0.01, '2:1': 2, '5:1': 5, '10:1': 10,
};

type PlotArea = 'display' | 'extents' | 'window';

interface PrintDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

export function PrintDialog({ isOpen, onClose }: PrintDialogProps) {
  const shapes = useAppStore(s => s.shapes);
  const parametricShapes = useAppStore(s => s.parametricShapes);
  const viewport = useAppStore(s => s.viewport);
  const canvasSize = useAppStore(s => s.canvasSize);
  const sheets = useAppStore(s => s.sheets);
  const activeDrawingId = useAppStore(s => s.activeDrawingId);
  const activeSheetId = useAppStore(s => s.activeSheetId);
  const editorMode = useAppStore(s => s.editorMode);
  const layers = useAppStore(s => s.layers);
  const projectName = useAppStore(s => s.projectName);
  const userPatterns = useAppStore(s => s.userPatterns);
  const projectPatterns = useAppStore(s => s.projectPatterns);

  const settings = useAppStore(s => s.printSettings);
  const savedPresets = useAppStore(s => s.savedPrintPresets);
  const setPrintSettings = useAppStore(s => s.setPrintSettings);
  const savePrintPreset = useAppStore(s => s.savePrintPreset);
  const deletePrintPreset = useAppStore(s => s.deletePrintPreset);
  const loadPrintPreset = useAppStore(s => s.loadPrintPreset);

  const [isExporting, setIsExporting] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [showSheetSelector, setShowSheetSelector] = useState(false);
  const [presetName, setPresetName] = useState('');
  const [selectedPreset, setSelectedPreset] = useState('');

  // Drag state
  const [dragPos, setDragPos] = useState<{ x: number; y: number } | null>(null);
  const dragRef = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  const handleDragStart = useCallback((e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('button')) return;
    const rect = dialogRef.current?.getBoundingClientRect();
    if (!rect) return;
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      origX: dragPos?.x ?? rect.left,
      origY: dragPos?.y ?? rect.top,
    };
    const onMove = (ev: MouseEvent) => {
      if (!dragRef.current) return;
      setDragPos({
        x: dragRef.current.origX + (ev.clientX - dragRef.current.startX),
        y: dragRef.current.origY + (ev.clientY - dragRef.current.startY),
      });
    };
    const onUp = () => {
      dragRef.current = null;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [dragPos]);

  // Reset position when dialog opens
  useEffect(() => {
    if (isOpen) setDragPos(null);
  }, [isOpen]);

  // Close on Escape key
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  const drawingShapes = shapes.filter(s => s.drawingId === activeDrawingId && s.visible);
  const visibleShapes = drawingShapes.length > 0 ? drawingShapes : shapes.filter(s => s.visible);
  const activeSheet = sheets.find(s => s.id === activeSheetId);
  const isSheetMode = editorMode === 'sheet' && !!activeSheet;

  const calculateExtents = useCallback((): { minX: number; minY: number; maxX: number; maxY: number } | null => {
    const targetShapes = visibleShapes;
    if (targetShapes.length === 0) return null;

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

    for (const shape of targetShapes) {
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
          for (const point of shape.points) {
            minX = Math.min(minX, point.x);
            minY = Math.min(minY, point.y);
            maxX = Math.max(maxX, point.x);
            maxY = Math.max(maxY, point.y);
          }
          break;
        case 'text':
          minX = Math.min(minX, shape.position.x);
          minY = Math.min(minY, shape.position.y);
          maxX = Math.max(maxX, shape.position.x + 100);
          maxY = Math.max(maxY, shape.position.y + shape.fontSize);
          break;
        case 'hatch':
          for (const point of shape.points) {
            minX = Math.min(minX, point.x);
            minY = Math.min(minY, point.y);
            maxX = Math.max(maxX, point.x);
            maxY = Math.max(maxY, point.y);
          }
          break;
      }
    }

    if (minX === Infinity) return null;
    return { minX, minY, maxX, maxY };
  }, [visibleShapes]);

  const getPlotBounds = useCallback(() => {
    switch (settings.plotArea) {
      case 'extents':
        return calculateExtents();
      case 'display':
        return {
          minX: -viewport.offsetX / viewport.zoom,
          minY: -viewport.offsetY / viewport.zoom,
          maxX: (canvasSize.width - viewport.offsetX) / viewport.zoom,
          maxY: (canvasSize.height - viewport.offsetY) / viewport.zoom,
        };
      default:
        return calculateExtents();
    }
  }, [settings.plotArea, calculateExtents, viewport, canvasSize]);

  const generatePreview = useCallback(async () => {
    const paper = PAPER_SIZES[settings.paperSize];
    if (!paper) return;
    const isLandscape = settings.orientation === 'landscape';
    const paperWidth = isLandscape ? paper.height : paper.width;
    const paperHeight = isLandscape ? paper.width : paper.height;

    const previewScale = 0.5;
    const canvas = document.createElement('canvas');
    canvas.width = paperWidth * previewScale;
    canvas.height = paperHeight * previewScale;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // White paper background
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const margins = settings.margins;
    const printableW = (paperWidth - margins.left - margins.right) * previewScale;
    const printableH = (paperHeight - margins.top - margins.bottom) * previewScale;

    // Draw margin lines
    ctx.strokeStyle = '#e0e0e0';
    ctx.lineWidth = 0.5;
    ctx.setLineDash([2, 2]);
    ctx.strokeRect(
      margins.left * previewScale,
      margins.top * previewScale,
      printableW,
      printableH
    );
    ctx.setLineDash([]);

    if (isSheetMode && activeSheet) {
      // Sheet mode: use the sheet's own paper size/orientation (title block is positioned on the sheet)
      const sheetPaper = PAPER_SIZES[activeSheet.paperSize];
      if (!sheetPaper) { setPreviewUrl(null); return; }
      const sheetIsLandscape = activeSheet.orientation === 'landscape';
      const sheetW = sheetIsLandscape ? sheetPaper.height : sheetPaper.width;
      const sheetH = sheetIsLandscape ? sheetPaper.width : sheetPaper.height;

      // Scale the sheet to fit inside the print paper's printable area
      const fitScaleX = printableW / sheetW;
      const fitScaleY = printableH / sheetH;
      const fitScale = Math.min(fitScaleX, fitScaleY);

      // Center the sheet on the output paper
      const sheetRenderedW = sheetW * fitScale;
      const sheetRenderedH = sheetH * fitScale;
      const sheetOffX = margins.left * previewScale + (printableW - sheetRenderedW) / 2;
      const sheetOffY = margins.top * previewScale + (printableH - sheetRenderedH) / 2;

      ctx.save();
      ctx.translate(sheetOffX, sheetOffY);
      ctx.scale(fitScale, fitScale);

      // Draw sheet paper background
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, sheetW, sheetH);
      ctx.strokeStyle = '#aaaaaa';
      ctx.lineWidth = 0.5 / fitScale;
      ctx.strokeRect(0, 0, sheetW, sheetH);

      await renderSheetPreview(ctx, activeSheet, sheetW, sheetH, 1);
      ctx.restore();
    } else {
      // Drawing mode: render shapes fitted to paper
      const bounds = getPlotBounds();
      if (!bounds) {
        // Even with no shapes, show the paper
        ctx.strokeStyle = '#cccccc';
        ctx.lineWidth = 1;
        ctx.strokeRect(0, 0, canvas.width, canvas.height);
        setPreviewUrl(canvas.toDataURL());
        return;
      }

      const contentWidth = bounds.maxX - bounds.minX;
      const contentHeight = bounds.maxY - bounds.minY;

      let plotScale: number;
      if (settings.scale === 'Fit') {
        const scaleX = printableW / contentWidth;
        const scaleY = printableH / contentHeight;
        plotScale = Math.min(scaleX, scaleY);
      } else if (settings.customScale) {
        plotScale = settings.customScale * previewScale;
      } else {
        plotScale = (PLOT_SCALES[settings.scale] || 1) * previewScale;
      }

      let offsetX: number, offsetY: number;
      const mLeft = margins.left * previewScale;
      const mTop = margins.top * previewScale;

      if (settings.centerPlot) {
        offsetX = mLeft + (printableW - contentWidth * plotScale) / 2 - bounds.minX * plotScale;
        offsetY = mTop + (printableH - contentHeight * plotScale) / 2 - bounds.minY * plotScale;
      } else {
        offsetX = mLeft + settings.offsetX * previewScale - bounds.minX * plotScale;
        offsetY = mTop + settings.offsetY * previewScale - bounds.minY * plotScale;
      }

      renderShapesToCanvas(ctx, visibleShapes, {
        scale: plotScale,
        offsetX,
        offsetY,
        appearance: settings.appearance,
        plotLineweights: settings.plotLineweights,
        customPatterns: [...userPatterns, ...projectPatterns],
      });
    }

    // Draw border
    ctx.strokeStyle = '#cccccc';
    ctx.lineWidth = 1;
    ctx.strokeRect(0, 0, canvas.width, canvas.height);

    setPreviewUrl(canvas.toDataURL());
  }, [visibleShapes, settings, getPlotBounds, isSheetMode, activeSheet, shapes, layers]);

  // Render a sheet onto the preview canvas (title block, viewports with shapes)
  const renderSheetPreview = useCallback(async (
    ctx: CanvasRenderingContext2D,
    sheet: typeof activeSheet & {},
    canvasW: number,
    canvasH: number,
    previewScale: number,
  ): Promise<void> => {
    const MM = previewScale; // 1mm = previewScale pixels in the preview
    const PX_PER_MM = 3.78; // screen pixels per mm (MM_TO_PIXELS)

    // Check for full-page SVG template
    const svgTemplateId = (sheet.titleBlock as { svgTemplateId?: string }).svgTemplateId;
    let isFullPageSvg = false;
    let svgTemplate: ReturnType<typeof loadCustomSVGTemplates>[0] | undefined;

    if (svgTemplateId) {
      const svgTemplates = loadCustomSVGTemplates();
      svgTemplate = svgTemplates.find(t => t.id === svgTemplateId);
      if (svgTemplate?.isFullPage) {
        isFullPageSvg = true;
        // For full-page templates, render SVG as background
        await renderSvgToCanvas(ctx, svgTemplate, sheet.titleBlock.fields, 0, 0, canvasW, canvasH);
      }
    }

    // Draw viewports
    for (const vp of sheet.viewports) {
      if (!vp.visible) continue;
      const vpX = vp.x * MM;
      const vpY = vp.y * MM;
      const vpW = vp.width * MM;
      const vpH = vp.height * MM;

      // Viewport background
      ctx.fillStyle = '#fafafa';
      ctx.fillRect(vpX, vpY, vpW, vpH);

      // Render shapes inside this viewport
      const vpShapes = shapes.filter(s => s.drawingId === vp.drawingId && s.visible);
      const vpParametricShapes = parametricShapes.filter(s => s.drawingId === vp.drawingId && s.visible);

      if (vpShapes.length > 0 || vpParametricShapes.length > 0) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(vpX, vpY, vpW, vpH);
        ctx.clip();

        const vpCenterX = vpX + vpW / 2;
        const vpCenterY = vpY + vpH / 2;
        const vpScale = vp.scale * MM;

        renderShapesToCanvas(ctx, vpShapes, {
          scale: vpScale,
          offsetX: vpCenterX - vp.centerX * vpScale,
          offsetY: vpCenterY - vp.centerY * vpScale,
          appearance: settings.appearance,
          plotLineweights: settings.plotLineweights,
          customPatterns: [...userPatterns, ...projectPatterns],
        });

        // Render parametric shapes
        for (const pShape of vpParametricShapes) {
          if (pShape.parametricType !== 'profile') continue;
          const geometry = (pShape as { generatedGeometry?: { outlines: { x: number; y: number }[][]; closed: boolean[] } }).generatedGeometry;
          if (!geometry || geometry.outlines.length === 0) continue;

          let strokeColor = pShape.style.strokeColor;
          if (settings.appearance === 'blackLines') {
            strokeColor = '#000000';
          } else if (strokeColor === '#ffffff') {
            strokeColor = '#000000';
          }

          ctx.strokeStyle = strokeColor;
          ctx.lineWidth = pShape.style.strokeWidth * vpScale;

          for (let i = 0; i < geometry.outlines.length; i++) {
            const outline = geometry.outlines[i];
            const closed = geometry.closed[i];
            if (outline.length < 2) continue;

            ctx.beginPath();
            ctx.moveTo(outline[0].x * vpScale + vpCenterX - vp.centerX * vpScale, outline[0].y * vpScale + vpCenterY - vp.centerY * vpScale);
            for (let j = 1; j < outline.length; j++) {
              ctx.lineTo(outline[j].x * vpScale + vpCenterX - vp.centerX * vpScale, outline[j].y * vpScale + vpCenterY - vp.centerY * vpScale);
            }
            if (closed) ctx.closePath();
            ctx.stroke();
          }
        }

        ctx.restore();
      }

      // Viewport border
      ctx.strokeStyle = '#aaaaaa';
      ctx.lineWidth = 0.5;
      ctx.strokeRect(vpX, vpY, vpW, vpH);
    }

    // Draw title block (skip if full-page SVG already rendered)
    if (sheet.titleBlock.visible && !isFullPageSvg) {
      const tb = sheet.titleBlock;

      // Check for SVG template (corner-style, not full-page)
      if (svgTemplate && !svgTemplate.isFullPage) {
        const tbW = svgTemplate.width * MM;
        const tbH = svgTemplate.height * MM;
        const tbX = canvasW - tbW - (tb.x || 10) * MM;
        const tbY = canvasH - tbH - (tb.y || 10) * MM;
        await renderSvgToCanvas(ctx, svgTemplate, tb.fields, tbX, tbY, tbW, tbH);
      } else if (!svgTemplateId) {
        // Legacy grid-based or template-based title block
        const tbW = tb.width * MM;
        const tbH = tb.height * MM;
        const tbX = canvasW - tbW - tb.x * MM;
        const tbY = canvasH - tbH - tb.y * MM;

        // Get template if available (EnhancedTitleBlock has templateId)
        const templateId = (tb as { templateId?: string }).templateId;
        const template = templateId ? getTemplateById(templateId) : undefined;

        // Title block background
        ctx.fillStyle = template?.layout?.backgroundColor || '#f8f8f8';
        ctx.fillRect(tbX, tbY, tbW, tbH);

        // Title block border (borderWidth is in screen px, convert to mm)
        const borderWidth = (template?.layout?.borderWidth || 2) / PX_PER_MM * MM;
        ctx.strokeStyle = template?.layout?.gridColor || '#000000';
        ctx.lineWidth = borderWidth;
        ctx.strokeRect(tbX, tbY, tbW, tbH);

        if (template) {
        // Template-based layout (matches TitleBlockRenderer.drawTemplateLayout)
        // Font sizes in templates are in screen pixels; convert to mm (our coordinate system)
        const PX = 1 / PX_PER_MM; // convert 1 screen pixel to mm
        const layout = template.layout;
        ctx.lineWidth = 0.5 / PX_PER_MM;
        ctx.strokeStyle = layout.gridColor || '#000000';

        let currentY = tbY;
        for (let i = 0; i < layout.rows.length; i++) {
          const row = layout.rows[i];
          const rowHeight = row.height * MM;

          // Horizontal line (skip first row - outer border covers it)
          if (i > 0) {
            ctx.beginPath();
            ctx.moveTo(tbX, currentY);
            ctx.lineTo(tbX + tbW, currentY);
            ctx.stroke();
          }

          // Vertical lines between cells
          let currentX = tbX;
          for (let j = 0; j < row.cells.length - 1; j++) {
            const cell = row.cells[j];
            const cellWidth = (tbW * cell.widthPercent) / 100;
            currentX += cellWidth;
            ctx.beginPath();
            ctx.moveTo(currentX, currentY);
            ctx.lineTo(currentX, currentY + rowHeight);
            ctx.stroke();
          }

          // Draw cell contents
          let cellX = tbX;
          for (const cell of row.cells) {
            const cellWidth = (tbW * cell.widthPercent) / 100;
            const field = tb.fields.find(f => f.id === cell.fieldId);
            if (field) {
              const padding = 2 * MM; // 2mm padding
              let textX = cellX + padding;
              if (cell.alignment === 'center') textX = cellX + cellWidth / 2;
              else if (cell.alignment === 'right') textX = cellX + cellWidth - padding;

              ctx.textBaseline = 'top';
              ctx.textAlign = cell.alignment;

              // Label (font sizes are in screen px, convert to mm)
              const labelFontSize = Math.max(6, cell.fontSize - 2) * PX;
              ctx.fillStyle = '#666666';
              ctx.font = `${labelFontSize}px Arial`;
              ctx.fillText(field.label, textX, currentY + padding);

              // Value
              const valueFontSize = cell.fontSize * PX;
              ctx.fillStyle = '#000000';
              ctx.font = `${cell.isBold ? 'bold ' : ''}${valueFontSize}px Arial`;
              ctx.fillText(field.value || '', textX, currentY + padding + labelFontSize + 2 * PX);

              ctx.textAlign = 'left';
              ctx.textBaseline = 'alphabetic';
            }
            cellX += cellWidth;
          }

          currentY += rowHeight;
        }
      } else {
        // Legacy grid layout (4 rows of 15mm)
        ctx.lineWidth = 0.3;
        const rowHeights = [15, 15, 15, 15];
        let currentY = tbY;
        for (let i = 0; i < rowHeights.length - 1; i++) {
          currentY += rowHeights[i] * MM;
          ctx.beginPath();
          ctx.moveTo(tbX, currentY);
          ctx.lineTo(tbX + tbW, currentY);
          ctx.stroke();
        }

        // Draw fields using their x/y positions (font sizes are screen px, convert to mm)
        const PX = 1 / PX_PER_MM;
        ctx.textBaseline = 'top';
        for (const field of tb.fields) {
          const fieldX = tbX + field.x * MM;
          const fieldY = tbY + field.y * MM;

          const labelSize = Math.max(7, (field.fontSize || 8) - 2) * PX;
          ctx.fillStyle = '#666666';
          ctx.font = `${labelSize}px Arial`;
          ctx.fillText(field.label, fieldX, fieldY);

          const valueSize = (field.fontSize || 10) * PX;
          ctx.fillStyle = '#000000';
          ctx.font = `bold ${valueSize}px Arial`;
          ctx.fillText(field.value || '', fieldX, fieldY + labelSize + 2 * PX);
        }
        ctx.textBaseline = 'alphabetic';
      }
      }
    }
  }, [shapes, parametricShapes, settings.appearance, settings.plotLineweights, userPatterns, projectPatterns]);

  // Helper to render SVG template to canvas (returns Promise for async loading)
  const renderSvgToCanvas = useCallback((
    ctx: CanvasRenderingContext2D,
    template: ReturnType<typeof loadCustomSVGTemplates>[0],
    fields: { id: string; value: string }[],
    x: number,
    y: number,
    width: number,
    height: number
  ): Promise<void> => {
    return new Promise((resolve) => {
      // Build field values
      const fieldValues: Record<string, string> = {};
      for (const field of fields) {
        fieldValues[field.id] = field.value || '';
      }

      // Render SVG with substituted values
      const renderedSvg = renderSVGTitleBlock(template, fieldValues);

      // Create an image from the SVG and draw it
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
        resolve(); // Resolve anyway to not block
      };

      img.src = url;
    });
  }, []);

  useEffect(() => {
    if (isOpen) generatePreview();
  }, [isOpen, settings, generatePreview]);

  const handleExportPDF = async () => {
    setIsExporting(true);
    try {
      const filePath = await exportToPDF({
        shapes: visibleShapes,
        sheets: settings.printRange === 'selectedSheets' ? sheets : undefined,
        allShapes: shapes,
        allParametricShapes: parametricShapes,
        settings,
        projectName,
        activeSheet: isSheetMode ? activeSheet : null,
        customPatterns: [...userPatterns, ...projectPatterns],
      });
      if (filePath) {
        // Open the exported PDF with default application
        try {
          await invoke('open_file_with_default_app', { path: filePath });
        } catch (openError) {
          console.warn('Could not open PDF:', openError);
        }
        // Close the dialog
        onClose();
      }
    } catch (error) {
      console.error('PDF export failed:', error);
      alert('Export failed: ' + (error as Error).message);
    } finally {
      setIsExporting(false);
    }
  };

  const handlePrint = async () => {
    const paper = PAPER_SIZES[settings.paperSize];
    if (!paper) return;
    const isLandscape = settings.orientation === 'landscape';
    const paperWidthMM = isLandscape ? paper.height : paper.width;
    const paperHeightMM = isLandscape ? paper.width : paper.height;

    const dpi = 150;
    const mmToPx = dpi / 25.4;
    const canvasW = Math.round(paperWidthMM * mmToPx);
    const canvasH = Math.round(paperHeightMM * mmToPx);

    const canvas = document.createElement('canvas');
    canvas.width = canvasW;
    canvas.height = canvasH;
    const ctx = canvas.getContext('2d')!;

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvasW, canvasH);

    const margins = settings.margins;
    const printableW = (paperWidthMM - margins.left - margins.right) * mmToPx;
    const printableH = (paperHeightMM - margins.top - margins.bottom) * mmToPx;

    if (isSheetMode && activeSheet) {
      // Sheet mode: render sheet at its native size, scaled to fit output paper
      const sheetPaper = PAPER_SIZES[activeSheet.paperSize];
      if (sheetPaper) {
        const sheetIsLandscape = activeSheet.orientation === 'landscape';
        const sheetW = sheetIsLandscape ? sheetPaper.height : sheetPaper.width;
        const sheetH = sheetIsLandscape ? sheetPaper.width : sheetPaper.height;

        const fitScale = Math.min(printableW / sheetW, printableH / sheetH);
        const renderedW = sheetW * fitScale;
        const renderedH = sheetH * fitScale;
        const offX = margins.left * mmToPx + (printableW - renderedW) / 2;
        const offY = margins.top * mmToPx + (printableH - renderedH) / 2;

        ctx.save();
        ctx.translate(offX, offY);
        ctx.scale(fitScale, fitScale);
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, sheetW, sheetH);
        await renderSheetPreview(ctx, activeSheet, sheetW, sheetH, 1);
        ctx.restore();
      }
    } else {
      // Drawing mode
      const bounds = getPlotBounds();
      if (!bounds) {
        alert('No content to print');
        return;
      }

      const contentWidth = bounds.maxX - bounds.minX;
      const contentHeight = bounds.maxY - bounds.minY;

      let plotScale: number;
      if (settings.scale === 'Fit') {
        plotScale = Math.min(printableW / contentWidth, printableH / contentHeight);
      } else if (settings.customScale) {
        plotScale = settings.customScale * mmToPx;
      } else {
        plotScale = (PLOT_SCALES[settings.scale] || 1) * mmToPx;
      }

      const mLeft = margins.left * mmToPx;
      const mTop = margins.top * mmToPx;
      let offsetX: number, offsetY: number;
      if (settings.centerPlot) {
        offsetX = mLeft + (printableW - contentWidth * plotScale) / 2 - bounds.minX * plotScale;
        offsetY = mTop + (printableH - contentHeight * plotScale) / 2 - bounds.minY * plotScale;
      } else {
        offsetX = mLeft + settings.offsetX * mmToPx - bounds.minX * plotScale;
        offsetY = mTop + settings.offsetY * mmToPx - bounds.minY * plotScale;
      }

      renderShapesToCanvas(ctx, visibleShapes, {
        scale: plotScale,
        offsetX,
        offsetY,
        appearance: settings.appearance,
        plotLineweights: settings.plotLineweights,
        customPatterns: [...userPatterns, ...projectPatterns],
      });
    }

    const dataUrl = canvas.toDataURL('image/png');
    printViaWindow(dataUrl, settings.copies, settings.paperSize, settings.orientation);
  };

  const handleSavePreset = () => {
    if (!presetName.trim()) return;
    savePrintPreset(presetName.trim());
    setSelectedPreset(presetName.trim());
    setPresetName('');
  };

  const handleDeletePreset = () => {
    if (!selectedPreset) return;
    deletePrintPreset(selectedPreset);
    setSelectedPreset('');
  };

  const handleLoadPreset = (name: string) => {
    setSelectedPreset(name);
    loadPrintPreset(name);
  };

  if (!isOpen) return null;

  const paper = PAPER_SIZES[settings.paperSize];
  const isLandscape = settings.orientation === 'landscape';
  const paperW = paper ? (isLandscape ? paper.height : paper.width) : 0;
  const paperH = paper ? (isLandscape ? paper.width : paper.height) : 0;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div
        ref={dialogRef}
        className="bg-cad-surface border border-cad-border shadow-xl w-[900px] h-[600px] flex flex-col"
        style={dragPos ? { position: 'fixed', left: dragPos.x, top: dragPos.y, margin: 0 } : undefined}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-3 py-1.5 border-b border-cad-border select-none"
          style={{ background: 'linear-gradient(to bottom, #ffffff, #f5f5f5)', borderColor: '#d4d4d4' }}
          onMouseDown={handleDragStart}
        >
          <h2 className="text-xs font-semibold text-gray-800 flex items-center gap-1.5">
            <Printer size={14} />
            Print / Plot
          </h2>
          <button onClick={onClose} className="p-0.5 hover:bg-cad-hover rounded transition-colors text-gray-600 hover:text-gray-800 cursor-default -mr-1">
            <X size={14} />
          </button>
        </div>

        {/* Content */}
        <div className="flex flex-1 overflow-hidden">
          {/* Settings Panel */}
          <div className="flex-1 p-4 space-y-4 overflow-y-auto max-h-[70vh]">

            {/* Preset */}
            <div className="space-y-2">
              <label className="text-sm font-medium text-cad-text">Preset</label>
              <div className="flex gap-2">
                <select
                  value={selectedPreset}
                  onChange={(e) => handleLoadPreset(e.target.value)}
                  className="flex-1 bg-cad-bg border border-cad-border rounded px-2 py-1 text-sm text-cad-text focus:outline-none focus:border-cad-accent"
                >
                  <option value="">-- None --</option>
                  {Object.keys(savedPresets).map(name => (
                    <option key={name} value={name}>{name}</option>
                  ))}
                </select>
                <input
                  type="text"
                  value={presetName}
                  onChange={e => setPresetName(e.target.value)}
                  placeholder="New name..."
                  className="w-24 bg-cad-bg border border-cad-border rounded px-2 py-1 text-sm text-cad-text focus:outline-none focus:border-cad-accent"
                />
                <button onClick={handleSavePreset} className="p-1 text-cad-text-dim hover:text-cad-text" title="Save preset">
                  <Save size={16} />
                </button>
                <button onClick={handleDeletePreset} className="p-1 text-cad-text-dim hover:text-red-400" title="Delete preset">
                  <Trash2 size={16} />
                </button>
              </div>
            </div>

            {/* Print Range */}
            <fieldset className="space-y-2 border border-cad-border/50 rounded p-3">
              <legend className="text-sm font-medium text-cad-text px-1">Print Range</legend>
              {(['currentView', 'visiblePortion', 'selectedSheets'] as PrintRange[]).map(range => (
                <label key={range} className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="printRange"
                    checked={settings.printRange === range}
                    onChange={() => setPrintSettings({ printRange: range })}
                    className="accent-cad-accent"
                  />
                  <span className="text-sm text-cad-text">
                    {range === 'currentView' ? 'Current View' :
                     range === 'visiblePortion' ? 'Visible Portion' :
                     'Selected Sheets'}
                  </span>
                  {range === 'selectedSheets' && settings.printRange === 'selectedSheets' && (
                    <button
                      onClick={() => setShowSheetSelector(true)}
                      className="ml-2 px-2 py-0.5 text-xs bg-cad-bg border border-cad-border rounded hover:border-cad-accent flex items-center gap-1 text-cad-text"
                    >
                      {settings.selectedSheetIds.length} sheet(s) <ChevronRight size={12} />
                    </button>
                  )}
                </label>
              ))}
            </fieldset>

            {/* Paper */}
            <fieldset className="space-y-2 border border-cad-border/50 rounded p-3">
              <legend className="text-sm font-medium text-cad-text px-1">Paper</legend>
              <div className="space-y-2">
                <select
                  value={settings.paperSize}
                  onChange={(e) => setPrintSettings({ paperSize: e.target.value })}
                  className="w-full bg-cad-bg border border-cad-border rounded px-3 py-1.5 text-sm text-cad-text focus:outline-none focus:border-cad-accent"
                >
                  {Object.entries(PAPER_SIZES).map(([key, { label }]) => (
                    <option key={key} value={key}>{label}</option>
                  ))}
                </select>

                <div className="flex gap-4">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio" name="orientation"
                      checked={settings.orientation === 'portrait'}
                      onChange={() => setPrintSettings({ orientation: 'portrait' })}
                      className="accent-cad-accent"
                    />
                    <span className="text-sm text-cad-text">Portrait</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio" name="orientation"
                      checked={settings.orientation === 'landscape'}
                      onChange={() => setPrintSettings({ orientation: 'landscape' })}
                      className="accent-cad-accent"
                    />
                    <span className="text-sm text-cad-text">Landscape</span>
                  </label>
                </div>

                <div className="grid grid-cols-4 gap-2">
                  {(['top', 'right', 'bottom', 'left'] as const).map(side => (
                    <label key={side} className="flex flex-col items-center gap-1">
                      <span className="text-xs text-cad-text-dim capitalize">{side}</span>
                      <input
                        type="number"
                        value={settings.margins[side]}
                        onChange={e => setPrintSettings({
                          margins: { ...settings.margins, [side]: parseFloat(e.target.value) || 0 }
                        })}
                        className="w-full bg-cad-bg border border-cad-border rounded px-2 py-1 text-sm text-cad-text text-center focus:outline-none focus:border-cad-accent"
                        min="0" step="1"
                      />
                    </label>
                  ))}
                </div>
                <p className="text-xs text-cad-text-dim text-center">Margins (mm)</p>
              </div>
            </fieldset>

            {/* Scale */}
            <fieldset className="space-y-2 border border-cad-border/50 rounded p-3">
              <legend className="text-sm font-medium text-cad-text px-1">Scale</legend>
              <select
                value={settings.scale}
                onChange={(e) => setPrintSettings({ scale: e.target.value })}
                className="w-full bg-cad-bg border border-cad-border rounded px-3 py-1.5 text-sm text-cad-text focus:outline-none focus:border-cad-accent"
              >
                {Object.keys(PLOT_SCALES).map((scale) => (
                  <option key={scale} value={scale}>{scale === 'Fit' ? 'Fit to Paper' : scale}</option>
                ))}
                <option value="custom">Custom</option>
              </select>
              {settings.scale === 'custom' && (
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    value={settings.customScale || 1}
                    onChange={(e) => setPrintSettings({ customScale: parseFloat(e.target.value) || 1 })}
                    className="w-20 bg-cad-bg border border-cad-border rounded px-2 py-1 text-sm text-cad-text focus:outline-none focus:border-cad-accent"
                    step="0.1" min="0.01"
                  />
                  <span className="text-xs text-cad-text-dim">mm = 1 unit</span>
                </div>
              )}
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={settings.centerPlot}
                  onChange={(e) => setPrintSettings({ centerPlot: e.target.checked })}
                  className="accent-cad-accent"
                />
                <span className="text-sm text-cad-text">Center the plot</span>
              </label>
              <div className="flex items-center gap-4">
                <label className="flex items-center gap-1">
                  <span className="text-xs text-cad-text-dim">X:</span>
                  <input
                    type="number"
                    value={settings.offsetX}
                    onChange={(e) => setPrintSettings({ offsetX: parseFloat(e.target.value) || 0, centerPlot: false })}
                    disabled={settings.centerPlot}
                    className="w-16 bg-cad-bg border border-cad-border rounded px-2 py-1 text-sm text-cad-text focus:outline-none focus:border-cad-accent disabled:opacity-50"
                  />
                </label>
                <label className="flex items-center gap-1">
                  <span className="text-xs text-cad-text-dim">Y:</span>
                  <input
                    type="number"
                    value={settings.offsetY}
                    onChange={(e) => setPrintSettings({ offsetY: parseFloat(e.target.value) || 0, centerPlot: false })}
                    disabled={settings.centerPlot}
                    className="w-16 bg-cad-bg border border-cad-border rounded px-2 py-1 text-sm text-cad-text focus:outline-none focus:border-cad-accent disabled:opacity-50"
                  />
                </label>
              </div>
            </fieldset>

            {/* Appearance */}
            <fieldset className="space-y-2 border border-cad-border/50 rounded p-3">
              <legend className="text-sm font-medium text-cad-text px-1">Appearance</legend>
              <div className="flex gap-3">
                {([['color', 'Color'], ['grayscale', 'Grayscale'], ['blackLines', 'Black Lines']] as [PrintAppearance, string][]).map(([value, label]) => (
                  <label key={value} className="flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="radio" name="appearance"
                      checked={settings.appearance === value}
                      onChange={() => setPrintSettings({ appearance: value })}
                      className="accent-cad-accent"
                    />
                    <span className="text-sm text-cad-text">{label}</span>
                  </label>
                ))}
              </div>
              <div className="flex items-center gap-2">
                <span className="text-sm text-cad-text-dim">Quality:</span>
                <select
                  value={settings.rasterQuality}
                  onChange={(e) => setPrintSettings({ rasterQuality: e.target.value as RasterQuality })}
                  className="bg-cad-bg border border-cad-border rounded px-2 py-1 text-sm text-cad-text focus:outline-none focus:border-cad-accent"
                >
                  <option value="draft">Draft (72 DPI)</option>
                  <option value="normal">Normal (150 DPI)</option>
                  <option value="high">High (300 DPI)</option>
                  <option value="presentation">Presentation (600 DPI)</option>
                </select>
              </div>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={settings.plotLineweights}
                  onChange={(e) => setPrintSettings({ plotLineweights: e.target.checked })}
                  className="accent-cad-accent"
                />
                <span className="text-sm text-cad-text">Plot lineweights</span>
              </label>
            </fieldset>

            {/* Copies */}
            <fieldset className="space-y-2 border border-cad-border/50 rounded p-3">
              <legend className="text-sm font-medium text-cad-text px-1">Copies</legend>
              <div className="flex items-center gap-2">
                <span className="text-sm text-cad-text-dim">Copies:</span>
                <input
                  type="number"
                  value={settings.copies}
                  onChange={(e) => setPrintSettings({ copies: Math.max(1, parseInt(e.target.value) || 1) })}
                  className="w-16 bg-cad-bg border border-cad-border rounded px-2 py-1 text-sm text-cad-text text-center focus:outline-none focus:border-cad-accent"
                  min="1"
                />
              </div>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={settings.combineSheets}
                  onChange={(e) => setPrintSettings({ combineSheets: e.target.checked })}
                  className="accent-cad-accent"
                />
                <span className="text-sm text-cad-text">Combine into one file</span>
              </label>
            </fieldset>

            {/* Plot Area */}
            <fieldset className="space-y-2 border border-cad-border/50 rounded p-3">
              <legend className="text-sm font-medium text-cad-text px-1">Plot Area</legend>
              <select
                value={settings.plotArea}
                onChange={(e) => setPrintSettings({ plotArea: e.target.value as PlotArea })}
                className="w-full bg-cad-bg border border-cad-border rounded px-3 py-1.5 text-sm text-cad-text focus:outline-none focus:border-cad-accent"
              >
                <option value="extents">Extents</option>
                <option value="display">Display</option>
                <option value="window">Window</option>
              </select>
            </fieldset>
          </div>

          {/* Preview Panel */}
          <div className="w-[260px] p-3 border-l border-cad-border bg-cad-bg/50 flex flex-col">
            <label className="text-sm font-medium text-cad-text mb-2 block">Preview</label>
            <div className="bg-[#808080] rounded border border-cad-border overflow-hidden flex items-center justify-center p-3" style={{ minHeight: 220, maxHeight: 300 }}>
              {previewUrl ? (
                <img
                  src={previewUrl}
                  alt="Print preview"
                  className="max-w-full max-h-full object-contain shadow-lg"
                />
              ) : (
                <span className="text-cad-text-dim text-sm">No preview</span>
              )}
            </div>
            <p className="text-xs text-cad-text-dim mt-2 text-center">
              {PAPER_SIZES[settings.paperSize]?.label} - {settings.orientation}
            </p>
            <p className="text-xs text-cad-text-dim text-center">
              {paperW} x {paperH} mm
            </p>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-3 py-2 border-t border-cad-border">
          <button
            onClick={onClose}
            className="px-3 py-1 text-xs bg-cad-input border border-cad-border text-cad-text hover:bg-cad-hover"
          >
            Cancel
          </button>
          <button
            onClick={handleExportPDF}
            disabled={isExporting}
            className="px-3 py-1 text-xs bg-cad-input border border-cad-border text-cad-text hover:bg-cad-hover disabled:opacity-50 flex items-center gap-1"
          >
            <FileDown size={14} />
            {isExporting ? 'Exporting...' : 'Export PDF'}
          </button>
          <button
            onClick={handlePrint}
            className="px-3 py-1 text-xs bg-cad-accent text-white hover:bg-cad-accent/80 flex items-center gap-1"
          >
            <Printer size={14} />
            Print
          </button>
        </div>
      </div>

      {/* Sheet Selection Sub-Dialog */}
      {showSheetSelector && (
        <SheetSelectionDialog
          sheets={sheets}
          selectedIds={settings.selectedSheetIds}
          onConfirm={(ids) => {
            setPrintSettings({ selectedSheetIds: ids });
            setShowSheetSelector(false);
          }}
          onCancel={() => setShowSheetSelector(false)}
        />
      )}
    </div>
  );
}
