/**
 * Application API - Project-level operations (file I/O, settings)
 */

import type { AppState } from '../state/appStore';
import type { CadEventBus } from './events';
import {
  showOpenDialog, showSaveDialog, showExportDialog,
  readProjectFile, writeProjectFile,
  exportToSVG, exportToDXF,
} from '../services/fileService';
import { writeTextFile } from '@tauri-apps/plugin-fs';

export class ApplicationApi {
  constructor(
    private getState: () => AppState,
    private bus: CadEventBus
  ) {}

  get projectName(): string {
    return this.getState().projectName;
  }

  setProjectName(name: string): void {
    this.getState().setProjectName(name);
  }

  get filePath(): string | null {
    return this.getState().currentFilePath;
  }

  get isModified(): boolean {
    return this.getState().isModified;
  }

  newProject(): void {
    this.getState().newProject();
    this.bus.emit('document:newProject', {});
  }

  async open(path?: string): Promise<void> {
    const filePath = path || await showOpenDialog();
    if (!filePath) return;

    const project = await readProjectFile(filePath);
    this.getState().loadProject(project, filePath, project.name);
    this.bus.emit('document:loaded', { path: filePath });
  }

  async save(path?: string): Promise<void> {
    const state = this.getState();

    const filePath = path || state.currentFilePath || await showSaveDialog(state.projectName);
    if (!filePath) return;

    const project = {
      version: 2 as const,
      name: state.projectName,
      createdAt: new Date().toISOString(),
      modifiedAt: new Date().toISOString(),
      drawings: state.drawings,
      sheets: state.sheets,
      activeDrawingId: state.activeDrawingId,
      activeSheetId: state.activeSheetId,
      drawingViewports: state.drawingViewports,
      shapes: state.shapes,
      layers: state.layers,
      activeLayerId: state.activeLayerId,
      settings: {
        gridSize: state.gridSize,
        gridVisible: state.gridVisible,
        snapEnabled: state.snapEnabled,
      },
    };

    await writeProjectFile(filePath, project);
    state.setFilePath(filePath);
    state.setModified(false);
    this.bus.emit('document:saved', { path: filePath });
  }

  async exportSVG(path?: string): Promise<void> {
    const filePath = path || await showExportDialog('svg', this.getState().projectName);
    if (!filePath) return;
    const svg = exportToSVG(this.getState().shapes);
    await writeTextFile(filePath, svg);
  }

  async exportDXF(path?: string): Promise<void> {
    const filePath = path || await showExportDialog('dxf', this.getState().projectName);
    if (!filePath) return;
    const dxf = exportToDXF(this.getState().shapes);
    await writeTextFile(filePath, dxf);
  }

  async exportJSON(path?: string): Promise<void> {
    const filePath = path || await showExportDialog('json', this.getState().projectName);
    if (!filePath) return;
    const state = this.getState();
    const data = { shapes: state.shapes, layers: state.layers, drawings: state.drawings, sheets: state.sheets };
    await writeTextFile(filePath, JSON.stringify(data, null, 2));
  }

  print(): void {
    this.getState().setPrintDialogOpen(true);
  }
}
