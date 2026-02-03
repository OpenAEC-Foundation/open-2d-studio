/**
 * PDF Import Service
 *
 * Converts PDF files to SVG format for use as title block templates.
 * Uses pdf.js to render PDF content to canvas, then embeds as image in SVG.
 */

// PDF.js library types (loaded from CDN)
declare global {
  interface Window {
    pdfjsLib?: {
      getDocument: (src: { data: ArrayBuffer }) => {
        promise: Promise<{
          numPages: number;
          getPage: (num: number) => Promise<{
            getViewport: (options: { scale: number }) => { width: number; height: number };
            render: (context: {
              canvasContext: CanvasRenderingContext2D;
              viewport: { width: number; height: number };
            }) => { promise: Promise<void> };
          }>;
        }>;
      };
      GlobalWorkerOptions: { workerSrc: string };
    };
  }
}

let pdfJsLoaded = false;
let loadPromise: Promise<void> | null = null;

/**
 * Load pdf.js library from CDN
 */
async function loadPdfJs(): Promise<void> {
  if (pdfJsLoaded && window.pdfjsLib) return;

  if (loadPromise) return loadPromise;

  loadPromise = new Promise((resolve, reject) => {
    // Check if already loaded
    if (window.pdfjsLib) {
      pdfJsLoaded = true;
      resolve();
      return;
    }

    const script = document.createElement('script');
    script.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
    script.onload = () => {
      if (window.pdfjsLib) {
        window.pdfjsLib.GlobalWorkerOptions.workerSrc =
          'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
        pdfJsLoaded = true;
        resolve();
      } else {
        reject(new Error('pdf.js failed to initialize'));
      }
    };
    script.onerror = () => reject(new Error('Failed to load pdf.js'));
    document.head.appendChild(script);
  });

  return loadPromise;
}

/**
 * Result of PDF to SVG conversion
 */
export interface PDFConversionResult {
  /** The SVG content */
  svgContent: string;
  /** Width in mm (assuming 72 DPI for PDF) */
  width: number;
  /** Height in mm */
  height: number;
  /** Whether conversion was successful */
  success: boolean;
  /** Error message if failed */
  error?: string;
}

/**
 * Convert a PDF file to SVG format
 *
 * The PDF is rendered to a canvas at high resolution, then embedded
 * as a base64 image inside an SVG wrapper. Users can then add
 * placeholder text elements in the app.
 *
 * @param pdfData - The PDF file as ArrayBuffer
 * @param pageNumber - Which page to convert (default: 1)
 * @param dpi - Resolution for rendering (default: 150)
 */
export async function convertPDFtoSVG(
  pdfData: ArrayBuffer,
  pageNumber: number = 1,
  dpi: number = 150
): Promise<PDFConversionResult> {
  try {
    await loadPdfJs();

    if (!window.pdfjsLib) {
      return {
        svgContent: '',
        width: 0,
        height: 0,
        success: false,
        error: 'PDF.js library not available',
      };
    }

    // Load the PDF
    const loadingTask = window.pdfjsLib.getDocument({ data: pdfData });
    const pdf = await loadingTask.promise;

    if (pageNumber > pdf.numPages) {
      return {
        svgContent: '',
        width: 0,
        height: 0,
        success: false,
        error: `Page ${pageNumber} does not exist (PDF has ${pdf.numPages} pages)`,
      };
    }

    // Get the page
    const page = await pdf.getPage(pageNumber);

    // Calculate scale based on DPI (PDF default is 72 DPI)
    const scale = dpi / 72;
    const viewport = page.getViewport({ scale });

    // Create canvas
    const canvas = document.createElement('canvas');
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const context = canvas.getContext('2d');

    if (!context) {
      return {
        svgContent: '',
        width: 0,
        height: 0,
        success: false,
        error: 'Could not create canvas context',
      };
    }

    // Render PDF to canvas
    await page.render({
      canvasContext: context,
      viewport,
    }).promise;

    // Convert to base64 PNG
    const imageDataUrl = canvas.toDataURL('image/png');

    // Calculate dimensions in mm (72 points per inch, 25.4mm per inch)
    const widthMM = (viewport.width / scale) * 25.4 / 72;
    const heightMM = (viewport.height / scale) * 25.4 / 72;

    // Create SVG with embedded image
    const svgContent = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg"
     xmlns:xlink="http://www.w3.org/1999/xlink"
     width="${widthMM}mm"
     height="${heightMM}mm"
     viewBox="0 0 ${viewport.width} ${viewport.height}">
  <!-- PDF converted to image - Add {{placeholder}} text elements as needed -->
  <image
    xlink:href="${imageDataUrl}"
    x="0"
    y="0"
    width="${viewport.width}"
    height="${viewport.height}"
    preserveAspectRatio="none"
  />

  <!-- Example placeholder text - modify positions as needed -->
  <!--
  <text x="50" y="50" font-family="Arial" font-size="12" fill="#000000">{{project}}</text>
  <text x="50" y="70" font-family="Arial" font-size="10" fill="#000000">{{date}}</text>
  -->
</svg>`;

    return {
      svgContent,
      width: widthMM,
      height: heightMM,
      success: true,
    };
  } catch (error) {
    return {
      svgContent: '',
      width: 0,
      height: 0,
      success: false,
      error: `PDF conversion failed: ${(error as Error).message}`,
    };
  }
}

/**
 * Check if pdf.js is available
 */
export function isPdfJsAvailable(): boolean {
  return pdfJsLoaded && !!window.pdfjsLib;
}

/**
 * Preload pdf.js library
 */
export async function preloadPdfJs(): Promise<boolean> {
  try {
    await loadPdfJs();
    return true;
  } catch {
    return false;
  }
}
