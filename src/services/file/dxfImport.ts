/**
 * DXF Import Service - Handles DXF file parsing and import dialogs
 */

import { logger } from '../log/logService';
import type { Shape, ShapeStyle, LineStyle } from '../../types/geometry';
import { CAD_DEFAULT_FONT } from '../../constants/cadDefaults';
import type { LengthUnit } from '../../units/types';

// ============================================================================
// Environment detection
// ============================================================================

/** True when running inside the Tauri desktop shell. */
const isTauri: boolean =
  typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

// ============================================================================
// Browser fallback helpers
// ============================================================================

/**
 * Module-level cache for file content picked in the browser.
 * showImportDxfDialog / showImportImageDialog store the content here,
 * keyed by the pseudo-path (filename) they return.
 */
const _browserFileCache = new Map<string, string>();

/**
 * Retrieve and consume a file's content that was cached by a browser
 * file-picker dialog (showImportDxfDialog / showImportImageDialog).
 * Returns undefined when there is no cached entry (e.g. in Tauri mode).
 */
export function consumeDxfImportCache(key: string): string | undefined {
  const content = _browserFileCache.get(key);
  if (content !== undefined) _browserFileCache.delete(key);
  return content;
}

/**
 * Open a browser file-picker and return the selected file's name + content.
 * Returns null if the user cancels.
 */
function browserPickFile(accept: string): Promise<{ name: string; content: string } | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) { resolve(null); return; }
      const content = await file.text();
      resolve({ name: file.name, content });
    };
    // Handle cancel – the input won't fire 'change' if the user cancels,
    // but we can listen for focus returning to the window.
    const onFocus = () => {
      // Small delay so `change` fires first if a file was selected.
      setTimeout(() => {
        window.removeEventListener('focus', onFocus);
        resolve(null);
      }, 500);
    };
    window.addEventListener('focus', onFocus);
    input.click();
  });
}

// ============================================================================
// DXF Color Palette
// ============================================================================

/**
 * DXF color index to RGB hex mapping (standard 256-color palette)
 * Index 0 = ByBlock, 256 = ByLayer - we use white as default
 */
const DXF_COLORS: Record<number, string> = {
  1: '#ff0000',   // Red
  2: '#ffff00',   // Yellow
  3: '#00ff00',   // Green
  4: '#00ffff',   // Cyan
  5: '#0000ff',   // Blue
  6: '#ff00ff',   // Magenta
  7: '#ffffff',   // White
  8: '#808080',   // Gray
  9: '#c0c0c0',   // Light gray
  10: '#ff0000',  // Red
  11: '#ff7f7f',
  12: '#cc0000',
  13: '#cc6666',
  14: '#990000',
  15: '#994c4c',
  16: '#7f0000',
  17: '#7f3f3f',
  18: '#4c0000',
  19: '#4c2626',
  20: '#ff3f00',
  21: '#ff9f7f',
  30: '#ff7f00',
  31: '#ffbf7f',
  40: '#ffbf00',
  41: '#ffdf7f',
  50: '#ffff00',
  51: '#ffff7f',
  60: '#bfff00',
  61: '#dfff7f',
  70: '#7fff00',
  71: '#bfff7f',
  80: '#3fff00',
  81: '#9fff7f',
  90: '#00ff00',
  91: '#7fff7f',
  100: '#00ff3f',
  101: '#7fff9f',
  110: '#00ff7f',
  111: '#7fffbf',
  120: '#00ffbf',
  121: '#7fffdf',
  130: '#00ffff',
  131: '#7fffff',
  140: '#00bfff',
  141: '#7fdfff',
  150: '#007fff',
  151: '#7fbfff',
  160: '#003fff',
  161: '#7f9fff',
  170: '#0000ff',
  171: '#7f7fff',
  180: '#3f00ff',
  181: '#9f7fff',
  190: '#7f00ff',
  191: '#bf7fff',
  200: '#bf00ff',
  201: '#df7fff',
  210: '#ff00ff',
  211: '#ff7fff',
  220: '#ff00bf',
  221: '#ff7fdf',
  230: '#ff007f',
  231: '#ff7fbf',
  240: '#ff003f',
  241: '#ff7f9f',
  250: '#545454',
  251: '#767676',
  252: '#989898',
  253: '#bababa',
  254: '#dcdcdc',
  255: '#ffffff',
};

/**
 * Get RGB color from DXF color index
 */
function getDxfColor(colorIndex: number): string {
  if (colorIndex <= 0 || colorIndex === 256) return '#ffffff'; // ByBlock/ByLayer = white
  return DXF_COLORS[colorIndex] || '#ffffff';
}

// ============================================================================
// Import Dialogs
// ============================================================================

/**
 * Show import DXF file dialog.
 * In browser mode the content is cached and the filename is returned.
 */
export async function showImportDxfDialog(): Promise<string | null> {
  if (isTauri) {
    const { open } = await import('@tauri-apps/plugin-dialog');
    const result = await open({
      multiple: false,
      filters: [{ name: 'DXF Files', extensions: ['dxf'] }],
      title: 'Import DXF',
    });
    return result as string | null;
  }

  // Browser fallback
  const picked = await browserPickFile('.dxf');
  if (!picked) return null;
  _browserFileCache.set(picked.name, picked.content);
  return picked.name;
}

/**
 * Show import image file dialog.
 * In browser mode the content is cached and the filename is returned.
 */
export async function showImportImageDialog(): Promise<string | null> {
  if (isTauri) {
    const { open } = await import('@tauri-apps/plugin-dialog');
    const result = await open({
      multiple: false,
      filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'bmp', 'gif', 'webp', 'svg'] }],
      title: 'Import Image',
    });
    return result as string | null;
  }

  // Browser fallback
  const picked = await browserPickFile('image/png,image/jpeg,image/bmp,image/gif,image/webp,image/svg+xml');
  if (!picked) return null;
  _browserFileCache.set(picked.name, picked.content);
  return picked.name;
}

// ============================================================================
// DXF Parsing
// ============================================================================

/**
 * Extract $INSUNITS from a DXF HEADER section.
 * Returns the LengthUnit or null if not found.
 */
export function parseDXFInsUnits(content: string): LengthUnit | null {
  const insUnitsToUnit: Record<number, LengthUnit> = {
    1: 'in', 2: 'ft', 4: 'mm', 5: 'cm', 6: 'm',
  };
  const lines = content.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    if (lines[i]?.trim() === '$INSUNITS') {
      // Next pair: group code 70, then the value
      const code = parseInt(lines[i + 1]?.trim() ?? '', 10);
      const val = parseInt(lines[i + 2]?.trim() ?? '', 10);
      if (code === 70 && insUnitsToUnit[val]) {
        return insUnitsToUnit[val];
      }
    }
    // Stop scanning after HEADER section ends
    if (lines[i]?.trim() === 'ENTITIES') break;
  }
  return null;
}

/**
 * Parse a DXF string into shapes.
 * Supports LINE, CIRCLE, ARC, POLYLINE/LWPOLYLINE, ELLIPSE, SPLINE, TEXT, MTEXT, POINT entities.
 * Also extracts layer names and colors from entities.
 */
export function parseDXF(
  content: string,
  layerId: string,
  drawingId: string,
): Shape[] {
  const defaultStyle: ShapeStyle = {
    strokeColor: '#ffffff',
    strokeWidth: 1,
    lineStyle: 'solid' as LineStyle,
  };

  const shapes: Shape[] = [];
  const lines = content.split(/\r?\n/);
  let i = 0;

  const next = (): [number, string] => {
    const code = parseInt(lines[i]?.trim() ?? '0', 10);
    const value = lines[i + 1]?.trim() ?? '';
    i += 2;
    return [code, value];
  };

  // Advance to ENTITIES section
  while (i < lines.length) {
    const line = lines[i]?.trim();
    if (line === 'ENTITIES') { i++; break; }
    i++;
  }

  while (i < lines.length - 1) {
    const [code, value] = next();
    if (code === 0 && value === 'EOF') break;
    if (code === 0 && value === 'ENDSEC') break;

    // Parse LINE entity
    if (code === 0 && value === 'LINE') {
      let x1 = 0, y1 = 0, x2 = 0, y2 = 0;
      let colorIndex = 7;
      while (i < lines.length - 1) {
        const [c, v] = next();
        if (c === 0) { i -= 2; break; }
        if (c === 10) x1 = parseFloat(v);
        if (c === 20) y1 = parseFloat(v);
        if (c === 11) x2 = parseFloat(v);
        if (c === 21) y2 = parseFloat(v);
        if (c === 62) colorIndex = parseInt(v);
      }
      shapes.push({
        id: crypto.randomUUID(),
        type: 'line',
        layerId, drawingId,
        style: { ...defaultStyle, strokeColor: getDxfColor(colorIndex) },
        visible: true, locked: false,
        start: { x: x1, y: -y1 },
        end: { x: x2, y: -y2 },
      } as Shape);
    }

    // Parse CIRCLE entity
    if (code === 0 && value === 'CIRCLE') {
      let cx = 0, cy = 0, r = 0;
      let colorIndex = 7;
      while (i < lines.length - 1) {
        const [c, v] = next();
        if (c === 0) { i -= 2; break; }
        if (c === 10) cx = parseFloat(v);
        if (c === 20) cy = parseFloat(v);
        if (c === 40) r = parseFloat(v);
        if (c === 62) colorIndex = parseInt(v);
      }
      shapes.push({
        id: crypto.randomUUID(),
        type: 'circle',
        layerId, drawingId,
        style: { ...defaultStyle, strokeColor: getDxfColor(colorIndex) },
        visible: true, locked: false,
        center: { x: cx, y: -cy },
        radius: r,
      } as Shape);
    }

    // Parse ARC entity
    if (code === 0 && value === 'ARC') {
      let cx = 0, cy = 0, r = 0, sa = 0, ea = 0;
      let colorIndex = 7;
      while (i < lines.length - 1) {
        const [c, v] = next();
        if (c === 0) { i -= 2; break; }
        if (c === 10) cx = parseFloat(v);
        if (c === 20) cy = parseFloat(v);
        if (c === 40) r = parseFloat(v);
        if (c === 50) sa = parseFloat(v);
        if (c === 51) ea = parseFloat(v);
        if (c === 62) colorIndex = parseInt(v);
      }
      // Negate angles and swap because Y is flipped
      shapes.push({
        id: crypto.randomUUID(),
        type: 'arc',
        layerId, drawingId,
        style: { ...defaultStyle, strokeColor: getDxfColor(colorIndex) },
        visible: true, locked: false,
        center: { x: cx, y: -cy },
        radius: r,
        startAngle: (-ea * Math.PI) / 180,
        endAngle: (-sa * Math.PI) / 180,
      } as Shape);
    }

    // Parse ELLIPSE entity
    if (code === 0 && value === 'ELLIPSE') {
      let cx = 0, cy = 0;
      let majorX = 1, majorY = 0; // Major axis endpoint relative to center
      let ratio = 1; // Minor/major axis ratio
      let startParam = 0, endParam = 2 * Math.PI;
      let colorIndex = 7;
      while (i < lines.length - 1) {
        const [c, v] = next();
        if (c === 0) { i -= 2; break; }
        if (c === 10) cx = parseFloat(v);
        if (c === 20) cy = parseFloat(v);
        if (c === 11) majorX = parseFloat(v);
        if (c === 21) majorY = parseFloat(v);
        if (c === 40) ratio = parseFloat(v);
        if (c === 41) startParam = parseFloat(v);
        if (c === 42) endParam = parseFloat(v);
        if (c === 62) colorIndex = parseInt(v);
      }
      // Calculate major axis length and rotation
      const majorLength = Math.sqrt(majorX * majorX + majorY * majorY);
      const rotation = Math.atan2(majorY, majorX);
      const minorLength = majorLength * ratio;

      // Check if it's a full ellipse or elliptical arc
      const isFullEllipse = Math.abs(endParam - startParam - 2 * Math.PI) < 0.001;

      shapes.push({
        id: crypto.randomUUID(),
        type: 'ellipse',
        layerId, drawingId,
        style: { ...defaultStyle, strokeColor: getDxfColor(colorIndex) },
        visible: true, locked: false,
        center: { x: cx, y: -cy },
        radiusX: majorLength,
        radiusY: minorLength,
        rotation: -rotation, // Negate because Y is flipped
        ...(isFullEllipse ? {} : {
          startAngle: -endParam,   // Swap and negate because Y is flipped
          endAngle: -startParam,
        }),
      } as Shape);
    }

    // Parse SPLINE entity
    if (code === 0 && value === 'SPLINE') {
      const controlPoints: { x: number; y: number }[] = [];
      let closed = false;
      let colorIndex = 7;
      let currentX: number | null = null;

      while (i < lines.length - 1) {
        const [c, v] = next();
        if (c === 0) { i -= 2; break; }
        if (c === 70) closed = (parseInt(v) & 1) === 1;
        if (c === 62) colorIndex = parseInt(v);
        if (c === 10) {
          currentX = parseFloat(v);
        }
        if (c === 20 && currentX !== null) {
          controlPoints.push({ x: currentX, y: -parseFloat(v) });
          currentX = null;
        }
      }

      if (controlPoints.length >= 2) {
        shapes.push({
          id: crypto.randomUUID(),
          type: 'spline',
          layerId, drawingId,
          style: { ...defaultStyle, strokeColor: getDxfColor(colorIndex) },
          visible: true, locked: false,
          points: controlPoints,
          closed,
        } as Shape);
      }
    }

    // Parse TEXT entity
    if (code === 0 && value === 'TEXT') {
      let x = 0, y = 0;
      let textContent = '';
      let height = 10;
      let rotation = 0;
      let colorIndex = 7;

      while (i < lines.length - 1) {
        const [c, v] = next();
        if (c === 0) { i -= 2; break; }
        if (c === 10) x = parseFloat(v);
        if (c === 20) y = parseFloat(v);
        if (c === 1) textContent = v;
        if (c === 40) height = parseFloat(v);
        if (c === 50) rotation = parseFloat(v);
        if (c === 62) colorIndex = parseInt(v);
      }

      if (textContent) {
        shapes.push({
          id: crypto.randomUUID(),
          type: 'text',
          layerId, drawingId,
          style: { ...defaultStyle, strokeColor: getDxfColor(colorIndex) },
          visible: true, locked: false,
          position: { x, y: -y },
          text: textContent,
          fontSize: height,
          fontFamily: CAD_DEFAULT_FONT,
          rotation: (-rotation * Math.PI) / 180,
          alignment: 'left',
          verticalAlignment: 'bottom',
          bold: false,
          italic: false,
          underline: false,
          color: getDxfColor(colorIndex),
          lineHeight: 1.2,
        } as Shape);
      }
    }

    // Parse MTEXT entity (multiline text)
    if (code === 0 && value === 'MTEXT') {
      let x = 0, y = 0;
      let textContent = '';
      let height = 10;
      let rotation = 0;
      let colorIndex = 7;
      let width: number | undefined;

      while (i < lines.length - 1) {
        const [c, v] = next();
        if (c === 0) { i -= 2; break; }
        if (c === 10) x = parseFloat(v);
        if (c === 20) y = parseFloat(v);
        if (c === 1) textContent += v; // Primary text
        if (c === 3) textContent += v; // Additional text chunks
        if (c === 40) height = parseFloat(v);
        if (c === 41) width = parseFloat(v);
        if (c === 50) rotation = parseFloat(v);
        if (c === 62) colorIndex = parseInt(v);
      }

      // Clean MTEXT formatting codes (basic cleanup)
      textContent = textContent
        .replace(/\\P/g, '\n')           // Paragraph breaks
        .replace(/\\[Ff][^;]*;/g, '')    // Font changes
        .replace(/\\[Hh][^;]*;/g, '')    // Height changes
        .replace(/\\[Ww][^;]*;/g, '')    // Width factor
        .replace(/\\[Qq][^;]*;/g, '')    // Slant angle
        .replace(/\\[Tt][^;]*;/g, '')    // Tracking
        .replace(/\\[Aa][^;]*;/g, '')    // Alignment
        .replace(/\\[Cc][^;]*;/g, '')    // Color
        .replace(/\\[Ll]/g, '')          // Underline start
        .replace(/\\l/g, '')             // Underline end
        .replace(/\\[Oo]/g, '')          // Overline start
        .replace(/\\o/g, '')             // Overline end
        .replace(/\\[Kk]/g, '')          // Strikethrough start
        .replace(/\\k/g, '')             // Strikethrough end
        .replace(/\{|\}/g, '')           // Braces
        .replace(/\\\\/g, '\\');         // Escaped backslash

      if (textContent.trim()) {
        shapes.push({
          id: crypto.randomUUID(),
          type: 'text',
          layerId, drawingId,
          style: { ...defaultStyle, strokeColor: getDxfColor(colorIndex) },
          visible: true, locked: false,
          position: { x, y: -y },
          text: textContent.trim(),
          fontSize: height,
          fontFamily: CAD_DEFAULT_FONT,
          rotation: (-rotation * Math.PI) / 180,
          alignment: 'left',
          verticalAlignment: 'top',
          bold: false,
          italic: false,
          underline: false,
          color: getDxfColor(colorIndex),
          lineHeight: 1.2,
          fixedWidth: width,
        } as Shape);
      }
    }

    // Parse POINT entity
    if (code === 0 && value === 'POINT') {
      let x = 0, y = 0;
      let colorIndex = 7;

      while (i < lines.length - 1) {
        const [c, v] = next();
        if (c === 0) { i -= 2; break; }
        if (c === 10) x = parseFloat(v);
        if (c === 20) y = parseFloat(v);
        if (c === 62) colorIndex = parseInt(v);
      }

      shapes.push({
        id: crypto.randomUUID(),
        type: 'point',
        layerId, drawingId,
        style: { ...defaultStyle, strokeColor: getDxfColor(colorIndex) },
        visible: true, locked: false,
        position: { x, y: -y },
      } as Shape);
    }

    // Parse LWPOLYLINE/POLYLINE entity
    if (code === 0 && (value === 'LWPOLYLINE' || value === 'POLYLINE')) {
      const pts: { x: number; y: number }[] = [];
      const bulgeValues: number[] = [];
      let closed = false;
      let currentBulge = 0;
      let colorIndex = 7;

      while (i < lines.length - 1) {
        const [c, v] = next();
        if (c === 0) { i -= 2; break; }
        if (c === 70) closed = (parseInt(v) & 1) === 1;
        if (c === 62) colorIndex = parseInt(v);
        if (c === 10) {
          // Push previous vertex's bulge before starting a new vertex
          if (pts.length > 0) {
            bulgeValues.push(currentBulge);
            currentBulge = 0;
          }
          const x = parseFloat(v);
          // read group 20 next
          const [c2, v2] = next();
          const y = c2 === 20 ? parseFloat(v2) : 0;
          pts.push({ x, y: -y });
        }
        if (c === 42) currentBulge = -parseFloat(v); // negate because Y is flipped
      }
      // Push last vertex's bulge
      if (pts.length > 0) {
        bulgeValues.push(currentBulge);
      }
      if (pts.length >= 2) {
        const hasBulge = bulgeValues.some(b => b !== 0);
        shapes.push({
          id: crypto.randomUUID(),
          type: 'polyline',
          layerId, drawingId,
          style: { ...defaultStyle, strokeColor: getDxfColor(colorIndex) },
          visible: true, locked: false,
          points: pts,
          closed,
          ...(hasBulge ? { bulge: bulgeValues } : {}),
        } as Shape);
      }
    }

    // Parse SOLID entity (triangular/quadrilateral fill - convert to closed polyline)
    if (code === 0 && value === 'SOLID') {
      const pts: { x: number; y: number }[] = [
        { x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }
      ];
      let colorIndex = 7;

      while (i < lines.length - 1) {
        const [c, v] = next();
        if (c === 0) { i -= 2; break; }
        if (c === 10) pts[0].x = parseFloat(v);
        if (c === 20) pts[0].y = -parseFloat(v);
        if (c === 11) pts[1].x = parseFloat(v);
        if (c === 21) pts[1].y = -parseFloat(v);
        if (c === 12) pts[2].x = parseFloat(v);
        if (c === 22) pts[2].y = -parseFloat(v);
        if (c === 13) pts[3].x = parseFloat(v);
        if (c === 23) pts[3].y = -parseFloat(v);
        if (c === 62) colorIndex = parseInt(v);
      }

      // DXF SOLID has unusual vertex order: 0, 1, 3, 2 (for quad)
      // Check if it's a triangle (point 3 == point 2)
      const isTriangle = pts[2].x === pts[3].x && pts[2].y === pts[3].y;
      const orderedPts = isTriangle
        ? [pts[0], pts[1], pts[2]]
        : [pts[0], pts[1], pts[3], pts[2]]; // Reorder for proper quad

      shapes.push({
        id: crypto.randomUUID(),
        type: 'polyline',
        layerId, drawingId,
        style: {
          ...defaultStyle,
          strokeColor: getDxfColor(colorIndex),
          fillColor: getDxfColor(colorIndex),
        },
        visible: true, locked: false,
        points: orderedPts,
        closed: true,
      } as Shape);
    }

    // Parse 3DFACE entity (similar to SOLID but for 3D - treat as 2D polyline)
    if (code === 0 && value === '3DFACE') {
      const pts: { x: number; y: number }[] = [
        { x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }
      ];
      let colorIndex = 7;

      while (i < lines.length - 1) {
        const [c, v] = next();
        if (c === 0) { i -= 2; break; }
        if (c === 10) pts[0].x = parseFloat(v);
        if (c === 20) pts[0].y = -parseFloat(v);
        if (c === 11) pts[1].x = parseFloat(v);
        if (c === 21) pts[1].y = -parseFloat(v);
        if (c === 12) pts[2].x = parseFloat(v);
        if (c === 22) pts[2].y = -parseFloat(v);
        if (c === 13) pts[3].x = parseFloat(v);
        if (c === 23) pts[3].y = -parseFloat(v);
        if (c === 62) colorIndex = parseInt(v);
      }

      // Check if it's a triangle
      const isTriangle = pts[2].x === pts[3].x && pts[2].y === pts[3].y;
      const orderedPts = isTriangle
        ? [pts[0], pts[1], pts[2]]
        : [pts[0], pts[1], pts[2], pts[3]];

      shapes.push({
        id: crypto.randomUUID(),
        type: 'polyline',
        layerId, drawingId,
        style: { ...defaultStyle, strokeColor: getDxfColor(colorIndex) },
        visible: true, locked: false,
        points: orderedPts,
        closed: true,
      } as Shape);
    }

    // Parse TRACE entity (thick line — convert to polyline)
    if (code === 0 && value === 'TRACE') {
      const pts: { x: number; y: number }[] = [
        { x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }
      ];
      let colorIndex = 7;

      while (i < lines.length - 1) {
        const [c, v] = next();
        if (c === 0) { i -= 2; break; }
        if (c === 10) pts[0].x = parseFloat(v);
        if (c === 20) pts[0].y = -parseFloat(v);
        if (c === 11) pts[1].x = parseFloat(v);
        if (c === 21) pts[1].y = -parseFloat(v);
        if (c === 12) pts[2].x = parseFloat(v);
        if (c === 22) pts[2].y = -parseFloat(v);
        if (c === 13) pts[3].x = parseFloat(v);
        if (c === 23) pts[3].y = -parseFloat(v);
        if (c === 62) colorIndex = parseInt(v);
      }

      // TRACE vertices: 0, 1, 3, 2 order
      shapes.push({
        id: crypto.randomUUID(),
        type: 'polyline',
        layerId, drawingId,
        style: {
          ...defaultStyle,
          strokeColor: getDxfColor(colorIndex),
          fillColor: getDxfColor(colorIndex),
        },
        visible: true, locked: false,
        points: [pts[0], pts[1], pts[3], pts[2]],
        closed: true,
      } as Shape);
    }
  }

  if (shapes.length > 0) {
    logger.info(`DXF parsed: ${shapes.length} entities imported`, 'DXF');
  }

  return shapes;
}
