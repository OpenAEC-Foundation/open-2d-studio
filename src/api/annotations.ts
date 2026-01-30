/**
 * Annotations API - Sheet annotation management
 */

import type { AppState } from '../state/appStore';
import type { TransactionManager } from './transactions';
import type { SheetAnnotation, SheetTextAnnotation, SheetLeaderAnnotation, SheetRevisionCloud } from '../types/sheet';
import { toPoint, type ApiPoint } from './types';

export class AnnotationsApi {
  constructor(
    private getState: () => AppState,
    _transactions: TransactionManager
  ) {}

  addText(sheetId: string, position: ApiPoint, text: string, opts?: Partial<SheetTextAnnotation>): string {
    return this.getState().addTextAnnotation(sheetId, toPoint(position), text, opts);
  }

  addLeader(sheetId: string, points: ApiPoint[], text: string, opts?: Partial<SheetLeaderAnnotation>): string {
    return this.getState().addLeaderAnnotation(sheetId, points.map(toPoint), text, opts);
  }

  addRevisionCloud(sheetId: string, points: ApiPoint[], opts?: { revisionNumber?: string } & Partial<SheetRevisionCloud>): string {
    return this.getState().addRevisionCloud(sheetId, points.map(toPoint), opts?.revisionNumber || '1', opts);
  }

  get(id: string): SheetAnnotation | undefined {
    const state = this.getState();
    for (const sheet of state.sheets) {
      const ann = sheet.annotations.find(a => a.id === id);
      if (ann) return ann;
    }
    return undefined;
  }

  update(id: string, props: Partial<SheetAnnotation>): void {
    const state = this.getState();
    for (const sheet of state.sheets) {
      if (sheet.annotations.some(a => a.id === id)) {
        state.updateAnnotation(sheet.id, id, props);
        return;
      }
    }
  }

  remove(id: string): void {
    const state = this.getState();
    for (const sheet of state.sheets) {
      if (sheet.annotations.some(a => a.id === id)) {
        state.deleteAnnotation(sheet.id, id);
        return;
      }
    }
  }

  list(sheetId?: string): SheetAnnotation[] {
    const state = this.getState();
    if (sheetId) {
      const sheet = state.sheets.find(s => s.id === sheetId);
      return sheet ? [...sheet.annotations] : [];
    }
    // Return annotations from active sheet
    const activeSheet = state.sheets.find(s => s.id === state.activeSheetId);
    return activeSheet ? [...activeSheet.annotations] : [];
  }

  select(ids: string[]): void {
    this.getState().selectAnnotations(ids);
  }

  deselectAll(): void {
    this.getState().deselectAllAnnotations();
  }
}
