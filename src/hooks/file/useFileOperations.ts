import { useCallback } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { useAppStore } from '../../state/appStore';
import {
  showOpenDialog,
  showSaveDialog,
  showExportDialog,
  showExportAllFormatsDialog,
  readProjectFile,
  writeProjectFile,
  exportToSVG,
  exportToDXF,
  exportToIFC,
  confirmUnsavedChanges,
  showError,
  showInfo,
  showImportDxfDialog,
  parseDXF,
  type ProjectFile,
} from '../../services/fileService';
import { readTextFile, writeTextFile } from '@tauri-apps/plugin-fs';

export function useFileOperations() {
  const newProject = useAppStore(s => s.newProject);
  const loadProject = useAppStore(s => s.loadProject);
  const setFilePath = useAppStore(s => s.setFilePath);
  const setProjectName = useAppStore(s => s.setProjectName);
  const setModified = useAppStore(s => s.setModified);
  const setPrintDialogOpen = useAppStore(s => s.setPrintDialogOpen);
  const addShapes = useAppStore(s => s.addShapes);

  const handleNew = useCallback(async () => {
    if (useAppStore.getState().isModified) {
      const proceed = await confirmUnsavedChanges();
      if (!proceed) return;
    }
    newProject();
  }, [newProject]);

  const handleOpen = useCallback(async () => {
    if (useAppStore.getState().isModified) {
      const proceed = await confirmUnsavedChanges();
      if (!proceed) return;
    }

    const filePath = await showOpenDialog();
    if (!filePath) return;

    try {
      const project = await readProjectFile(filePath);
      loadProject(
        {
          shapes: project.shapes,
          layers: project.layers,
          activeLayerId: project.activeLayerId,
          settings: project.settings,
          drawings: project.drawings,
          sheets: project.sheets,
          activeDrawingId: project.activeDrawingId,
          activeSheetId: project.activeSheetId,
          drawingViewports: project.drawingViewports,
          sheetViewports: project.sheetViewports,
        },
        filePath,
        project.name
      );
    } catch (err) {
      await showError(`Failed to open file: ${err}`);
    }
  }, [loadProject]);

  const handleSave = useCallback(async () => {
    const s = useAppStore.getState();
    let filePath = s.currentFilePath;

    if (!filePath) {
      filePath = await showSaveDialog(s.projectName);
      if (!filePath) return;
    }

    try {
      const project: ProjectFile = {
        version: 2,
        name: s.projectName,
        createdAt: new Date().toISOString(),
        modifiedAt: new Date().toISOString(),
        drawings: s.drawings,
        sheets: s.sheets,
        activeDrawingId: s.activeDrawingId,
        activeSheetId: s.activeSheetId,
        drawingViewports: s.drawingViewports,
        sheetViewports: s.sheetViewports,
        shapes: s.shapes,
        layers: s.layers,
        activeLayerId: s.activeLayerId,
        settings: {
          gridSize: s.gridSize,
          gridVisible: s.gridVisible,
          snapEnabled: s.snapEnabled,
        },
        savedPrintPresets: Object.keys(s.savedPrintPresets).length > 0 ? s.savedPrintPresets : undefined,
      };

      await writeProjectFile(filePath, project);
      setFilePath(filePath);
      setModified(false);

      const fileName = filePath.split(/[/\\]/).pop()?.replace('.o2d', '') || 'Untitled';
      setProjectName(fileName);
    } catch (err) {
      await showError(`Failed to save file: ${err}`);
    }
  }, [setFilePath, setModified, setProjectName]);

  const handleSaveAs = useCallback(async () => {
    const s = useAppStore.getState();
    const filePath = await showSaveDialog(s.projectName);
    if (!filePath) return;

    try {
      const project: ProjectFile = {
        version: 2,
        name: s.projectName,
        createdAt: new Date().toISOString(),
        modifiedAt: new Date().toISOString(),
        drawings: s.drawings,
        sheets: s.sheets,
        activeDrawingId: s.activeDrawingId,
        activeSheetId: s.activeSheetId,
        drawingViewports: s.drawingViewports,
        sheetViewports: s.sheetViewports,
        shapes: s.shapes,
        layers: s.layers,
        activeLayerId: s.activeLayerId,
        settings: {
          gridSize: s.gridSize,
          gridVisible: s.gridVisible,
          snapEnabled: s.snapEnabled,
        },
        savedPrintPresets: Object.keys(s.savedPrintPresets).length > 0 ? s.savedPrintPresets : undefined,
      };

      await writeProjectFile(filePath, project);
      setFilePath(filePath);
      setModified(false);

      const fileName = filePath.split(/[/\\]/).pop()?.replace('.o2d', '') || 'Untitled';
      setProjectName(fileName);
    } catch (err) {
      await showError(`Failed to save file: ${err}`);
    }
  }, [setFilePath, setModified, setProjectName]);

  const handleExport = useCallback(async () => {
    const s = useAppStore.getState();
    if (s.shapes.length === 0) {
      await showInfo('Nothing to export. Draw some shapes first.');
      return;
    }

    const filePath = await showExportAllFormatsDialog(s.projectName);
    if (!filePath) return;

    try {
      const extension = filePath.split('.').pop()?.toLowerCase();
      let content: string;

      if (extension === 'ifc') {
        const customPatterns = [...s.userPatterns, ...s.projectPatterns];
        content = exportToIFC(s.shapes, s.layers, customPatterns);
      } else if (extension === 'dxf') {
        content = exportToDXF(s.shapes);
      } else if (extension === 'json') {
        content = JSON.stringify({ shapes: s.shapes, layers: s.layers }, null, 2);
      } else {
        content = exportToSVG(s.shapes);
      }

      await writeTextFile(filePath, content);
      await showInfo(`Exported successfully to ${filePath}`);
    } catch (err) {
      await showError(`Failed to export: ${err}`);
    }
  }, []);

  const handleExportSVG = useCallback(async () => {
    const s = useAppStore.getState();
    if (s.shapes.length === 0) { await showInfo('Nothing to export. Draw some shapes first.'); return; }
    const filePath = await showExportDialog('svg', s.projectName);
    if (!filePath) return;
    try {
      await writeTextFile(filePath, exportToSVG(s.shapes));
      await showInfo(`Exported successfully to ${filePath}`);
    } catch (err) { await showError(`Failed to export: ${err}`); }
  }, []);

  const handleExportDXF = useCallback(async () => {
    const s = useAppStore.getState();
    if (s.shapes.length === 0) { await showInfo('Nothing to export. Draw some shapes first.'); return; }
    const filePath = await showExportDialog('dxf', s.projectName);
    if (!filePath) return;
    try {
      await writeTextFile(filePath, exportToDXF(s.shapes));
      await showInfo(`Exported successfully to ${filePath}`);
    } catch (err) { await showError(`Failed to export: ${err}`); }
  }, []);

  const handleExportIFC = useCallback(async () => {
    const s = useAppStore.getState();
    if (s.shapes.length === 0) { await showInfo('Nothing to export. Draw some shapes first.'); return; }
    const filePath = await showExportDialog('ifc', s.projectName);
    if (!filePath) return;
    try {
      const customPatterns = [...s.userPatterns, ...s.projectPatterns];
      await writeTextFile(filePath, exportToIFC(s.shapes, s.layers, customPatterns));
      await showInfo(`Exported successfully to ${filePath}`);
    } catch (err) { await showError(`Failed to export: ${err}`); }
  }, []);

  const handleExportJSON = useCallback(async () => {
    const s = useAppStore.getState();
    if (s.shapes.length === 0) { await showInfo('Nothing to export. Draw some shapes first.'); return; }
    const filePath = await showExportDialog('json', s.projectName);
    if (!filePath) return;
    try {
      await writeTextFile(filePath, JSON.stringify({ shapes: s.shapes, layers: s.layers }, null, 2));
      await showInfo(`Exported successfully to ${filePath}`);
    } catch (err) { await showError(`Failed to export: ${err}`); }
  }, []);

  const handleImportDXF = useCallback(async () => {
    const filePath = await showImportDxfDialog();
    if (!filePath) return;

    try {
      const content = await readTextFile(filePath);
      const s = useAppStore.getState();
      const shapes = parseDXF(content, s.activeLayerId, s.activeDrawingId);
      if (shapes.length === 0) {
        await showInfo('No supported entities found in the DXF file.');
        return;
      }
      addShapes(shapes);
      await showInfo(`Imported ${shapes.length} shape(s) from DXF.`);
    } catch (err) {
      await showError(`Failed to import DXF: ${err}`);
    }
  }, [addShapes]);

  const handlePrint = useCallback(() => {
    setPrintDialogOpen(true);
  }, [setPrintDialogOpen]);

  const handleExit = useCallback(() => {
    getCurrentWindow().close();
  }, []);

  return { handleNew, handleOpen, handleSave, handleSaveAs, handleExport, handleExportSVG, handleExportDXF, handleExportIFC, handleExportJSON, handleImportDXF, handlePrint, handleExit };
}
