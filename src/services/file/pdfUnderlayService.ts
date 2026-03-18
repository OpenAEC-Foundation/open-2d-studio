/**
 * PDF Underlay Service
 *
 * Loads a PDF file, renders page thumbnails, and converts a selected page
 * to a high-resolution raster image for use as a canvas underlay.
 *
 * Re-uses the CDN-loaded pdf.js from pdfImportService.
 */

import { readFile } from '@tauri-apps/plugin-fs';

// Re-use the global pdfjsLib declared in pdfImportService.ts

// ---------------------------------------------------------------------------
// pdf.js loader (mirrors pdfImportService logic)
// ---------------------------------------------------------------------------

let pdfJsLoaded = false;
let loadPromise: Promise<void> | null = null;

async function ensurePdfJs(): Promise<void> {
  if (pdfJsLoaded && window.pdfjsLib) return;
  if (loadPromise) return loadPromise;

  loadPromise = new Promise((resolve, reject) => {
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

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface PdfPageThumbnail {
  pageNumber: number;
  dataUrl: string;
  width: number;   // thumbnail pixel width
  height: number;  // thumbnail pixel height
}

export interface PdfUnderlayResult {
  /** Base64 data URL of the rendered page */
  dataUrl: string;
  /** Pixel width of the rendered image */
  pixelWidth: number;
  /** Pixel height of the rendered image */
  pixelHeight: number;
  /** Width in drawing units (1 PDF point = 1 unit, ~mm at 1:1) */
  worldWidth: number;
  /** Height in drawing units */
  worldHeight: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const isTauri: boolean =
  typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

/**
 * Read a PDF file into an ArrayBuffer.
 * Supports both Tauri (disk read) and browser (user already provided data).
 */
export async function readPdfFile(filePath: string): Promise<ArrayBuffer> {
  if (isTauri) {
    const bytes = await readFile(filePath);
    return bytes.buffer as ArrayBuffer;
  }

  // Browser fallback: the filePath is a key in the cache set during file pick
  const cached = (window as any).__pdfFileCache?.get(filePath);
  if (cached) return cached;
  throw new Error('PDF file data not found in browser cache');
}

/**
 * Pick a PDF file via Tauri dialog or browser file input.
 * Returns the file path (Tauri) or a cache key (browser).
 */
export async function showPdfFileDialog(): Promise<{ filePath: string; data: ArrayBuffer } | null> {
  if (isTauri) {
    const { open } = await import('@tauri-apps/plugin-dialog');
    const result = await open({
      multiple: false,
      filters: [{ name: 'PDF Files', extensions: ['pdf'] }],
      title: 'Select PDF for Underlay',
    });
    if (!result) return null;
    const filePath = result as string;
    const data = await readPdfFile(filePath);
    return { filePath, data };
  }

  // Browser fallback
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.pdf,application/pdf';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) { resolve(null); return; }
      const data = await file.arrayBuffer();
      // Store in a cache so the service can retrieve it later if needed
      if (!(window as any).__pdfFileCache) {
        (window as any).__pdfFileCache = new Map();
      }
      (window as any).__pdfFileCache.set(file.name, data);
      resolve({ filePath: file.name, data });
    };
    const onFocus = () => {
      setTimeout(() => {
        window.removeEventListener('focus', onFocus);
        resolve(null);
      }, 500);
    };
    window.addEventListener('focus', onFocus);
    input.click();
  });
}

// ---------------------------------------------------------------------------
// Core API
// ---------------------------------------------------------------------------

/**
 * Load a PDF and generate thumbnail images for every page.
 *
 * @param pdfData   ArrayBuffer of the PDF file
 * @param thumbHeight  Target height in pixels for each thumbnail (default 200)
 */
export async function generatePdfThumbnails(
  pdfData: ArrayBuffer,
  thumbHeight: number = 200,
): Promise<PdfPageThumbnail[]> {
  await ensurePdfJs();
  if (!window.pdfjsLib) throw new Error('pdf.js not available');

  const pdf = await window.pdfjsLib.getDocument({ data: pdfData }).promise;
  const thumbnails: PdfPageThumbnail[] = [];

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    // Default viewport at scale=1 gives dimensions in PDF points (72 DPI)
    const defaultVp = page.getViewport({ scale: 1 });
    const scale = thumbHeight / defaultVp.height;
    const vp = page.getViewport({ scale });

    const canvas = document.createElement('canvas');
    canvas.width = Math.round(vp.width);
    canvas.height = Math.round(vp.height);
    const ctx = canvas.getContext('2d');
    if (!ctx) continue;

    await page.render({ canvasContext: ctx, viewport: vp }).promise;

    thumbnails.push({
      pageNumber: i,
      dataUrl: canvas.toDataURL('image/png'),
      width: canvas.width,
      height: canvas.height,
    });
  }

  return thumbnails;
}

/**
 * Render a single PDF page at high resolution for use as a canvas underlay.
 *
 * @param pdfData     ArrayBuffer of the PDF file
 * @param pageNumber  1-based page number
 * @param dpi         Render resolution (default 150)
 */
export async function renderPdfPageForUnderlay(
  pdfData: ArrayBuffer,
  pageNumber: number,
  dpi: number = 150,
): Promise<PdfUnderlayResult> {
  await ensurePdfJs();
  if (!window.pdfjsLib) throw new Error('pdf.js not available');

  const pdf = await window.pdfjsLib.getDocument({ data: pdfData }).promise;
  if (pageNumber < 1 || pageNumber > pdf.numPages) {
    throw new Error(`Invalid page number ${pageNumber} (PDF has ${pdf.numPages} pages)`);
  }

  const page = await pdf.getPage(pageNumber);
  const scale = dpi / 72;
  const vp = page.getViewport({ scale });

  const canvas = document.createElement('canvas');
  canvas.width = Math.round(vp.width);
  canvas.height = Math.round(vp.height);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not create canvas context');

  // White background
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  await page.render({ canvasContext: ctx, viewport: vp }).promise;

  // World dimensions: use PDF points as drawing units (similar to mm at 1:1)
  // 1 PDF point = 1/72 inch. At 25.4 mm/inch that is ~0.353 mm per point.
  // For practical use, we scale so that the page maps to its mm dimensions.
  const defaultVp = page.getViewport({ scale: 1 });
  const worldWidth = (defaultVp.width / 72) * 25.4;   // mm
  const worldHeight = (defaultVp.height / 72) * 25.4;  // mm

  return {
    dataUrl: canvas.toDataURL('image/png'),
    pixelWidth: canvas.width,
    pixelHeight: canvas.height,
    worldWidth,
    worldHeight,
  };
}
