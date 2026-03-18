/**
 * CPT File Service — file dialog + parsing for GEF and BRO-XML cone
 * penetration test files.
 *
 * Parsing logic lives in ../cpt/cptParser.ts; this module re-exports the
 * parsers and adds the Tauri / browser file-picker integration.
 */

// Re-export parsers and types so existing consumers keep working
export { parseGEF, parseBROXML, parseCPTFile } from '../cpt/cptParser';
export type { CPTParsedData as CPTFileData } from '../cpt/cptParser';

// ---------------------------------------------------------------------------
// File picker — opens a file dialog for .gef and .xml files
// ---------------------------------------------------------------------------

const isTauri: boolean =
  typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

/**
 * Show a file dialog to pick a CPT file (.gef or .xml).
 * Returns the file text content and file name, or null if cancelled.
 */
export async function showCPTFileDialog(): Promise<{ text: string; fileName: string } | null> {
  if (isTauri) {
    const { open } = await import('@tauri-apps/plugin-dialog');
    const { readFile } = await import('@tauri-apps/plugin-fs');
    const result = await open({
      multiple: false,
      filters: [
        { name: 'CPT Files', extensions: ['gef', 'xml'] },
        { name: 'GEF Files', extensions: ['gef'] },
        { name: 'XML Files', extensions: ['xml'] },
      ],
      title: 'Select CPT File (GEF or BRO-XML)',
    });
    if (!result) return null;
    const filePath = result as string;
    const bytes = await readFile(filePath);
    const text = new TextDecoder().decode(bytes);
    const fileName = filePath.replace(/\\/g, '/').split('/').pop() || filePath;
    return { text, fileName };
  }

  // Browser fallback
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.gef,.xml';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) { resolve(null); return; }
      const text = await file.text();
      resolve({ text, fileName: file.name });
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
