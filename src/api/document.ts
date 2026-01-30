/**
 * Document API - Drawings, sheets, and viewports management
 */

import type { AppState } from '../state/appStore';
import type { Drawing, Sheet, SheetViewport, EditorMode, DrawingBoundary, PaperSize, PaperOrientation } from '../types/geometry';
import type { TransactionManager } from './transactions';
import type { CadEventBus } from './events';

class DrawingsApi {
  constructor(private getState: () => AppState) {}

  list(): Drawing[] {
    return [...this.getState().drawings];
  }

  create(name?: string): Drawing {
    const state = this.getState();
    const prevIds = new Set(state.drawings.map(d => d.id));
    state.addDrawing(name);
    return this.getState().drawings.find(d => !prevIds.has(d.id))!;
  }

  remove(id: string): void {
    this.getState().deleteDrawing(id);
  }

  rename(id: string, name: string): void {
    this.getState().renameDrawing(id, name);
  }

  switchTo(id: string): void {
    this.getState().switchToDrawing(id);
  }

  getActive(): Drawing | undefined {
    const state = this.getState();
    return state.drawings.find(d => d.id === state.activeDrawingId);
  }

  getBoundary(id: string): DrawingBoundary | undefined {
    return this.getState().drawings.find(d => d.id === id)?.boundary;
  }

  setBoundary(id: string, boundary: Partial<DrawingBoundary>): void {
    this.getState().updateDrawingBoundary(id, boundary);
  }

  fitBoundary(id: string): void {
    this.getState().fitBoundaryToContent(id);
  }
}

class SheetsApi {
  constructor(private getState: () => AppState) {}

  list(): Sheet[] {
    return [...this.getState().sheets];
  }

  create(name?: string, options?: { paperSize?: PaperSize; orientation?: PaperOrientation }): Sheet {
    const state = this.getState();
    const prevIds = new Set(state.sheets.map(s => s.id));
    state.addSheet(name, options?.paperSize, options?.orientation);
    return this.getState().sheets.find(s => !prevIds.has(s.id))!;
  }

  remove(id: string): void {
    this.getState().deleteSheet(id);
  }

  rename(id: string, name: string): void {
    this.getState().renameSheet(id, name);
  }

  switchTo(id: string): void {
    this.getState().switchToSheet(id);
  }

  getActive(): Sheet | undefined {
    const state = this.getState();
    return state.sheets.find(s => s.id === state.activeSheetId);
  }
}

class ViewportsApi {
  constructor(private getState: () => AppState) {}

  list(sheetId: string): SheetViewport[] {
    const sheet = this.getState().sheets.find(s => s.id === sheetId);
    return sheet ? [...sheet.viewports] : [];
  }

  add(sheetId: string, drawingId: string, bounds?: { x: number; y: number; width: number; height: number }): SheetViewport {
    const state = this.getState();
    const sheet = state.sheets.find(s => s.id === sheetId);
    const prevIds = new Set(sheet?.viewports.map(v => v.id) || []);
    state.addSheetViewport(sheetId, drawingId, bounds || { x: 50, y: 50, width: 200, height: 150 });
    const updatedSheet = this.getState().sheets.find(s => s.id === sheetId);
    return updatedSheet!.viewports.find(v => !prevIds.has(v.id))!;
  }

  update(viewportId: string, props: Partial<SheetViewport>): void {
    const state = this.getState();
    for (const sheet of state.sheets) {
      if (sheet.viewports.some(v => v.id === viewportId)) {
        state.updateSheetViewport(sheet.id, viewportId, props);
        return;
      }
    }
  }

  remove(viewportId: string): void {
    const state = this.getState();
    for (const sheet of state.sheets) {
      if (sheet.viewports.some(v => v.id === viewportId)) {
        state.deleteSheetViewport(sheet.id, viewportId);
        return;
      }
    }
  }

  center(viewportId: string): void {
    this.getState().centerViewportOnDrawing(viewportId);
  }

  fitToDrawing(viewportId: string): void {
    this.getState().fitViewportToDrawing(viewportId);
  }
}

export class DocumentApi {
  readonly drawings: DrawingsApi;
  readonly sheets: SheetsApi;
  readonly viewports: ViewportsApi;

  constructor(
    private getState: () => AppState,
    _transactions: TransactionManager,
    _bus: CadEventBus
  ) {
    this.drawings = new DrawingsApi(getState);
    this.sheets = new SheetsApi(getState);
    this.viewports = new ViewportsApi(getState);
  }

  get mode(): EditorMode {
    return this.getState().editorMode;
  }

  switchMode(mode: EditorMode): void {
    const state = this.getState();
    if (mode === 'drawing') {
      state.switchToDrawingMode();
    } else if (mode === 'sheet') {
      const activeSheet = state.sheets.find(s => s.id === state.activeSheetId);
      if (activeSheet) {
        state.switchToSheet(activeSheet.id);
      } else if (state.sheets.length > 0) {
        state.switchToSheet(state.sheets[0].id);
      }
    }
  }
}
