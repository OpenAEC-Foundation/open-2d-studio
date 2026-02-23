import { useEffect, useCallback } from 'react';
import { useAppStore } from '../../state/appStore';
import {
  showOpenDialog,
  showSaveDialog,
  readProjectFile,
  writeProjectFile,
  promptSaveBeforeClose,
  showError,
  type ProjectFile,
} from '../../services/file/fileService';
import { logger } from '../../services/log/logService';

/**
 * Hook to handle global keyboard shortcuts
 * - Ctrl+N: New file
 * - Ctrl+O: Open file
 * - Ctrl+S: Save file
 * - Ctrl+Shift+S: Save As
 * - Ctrl+Z: Undo
 * - Ctrl+Y: Redo
 * - Ctrl+`: Toggle terminal
 * - Delete: Delete selected shapes
 * - Escape: Cancel drag / deselect (works for both draft boundary and sheet viewport)
 */
export function useGlobalKeyboard() {
  const {
    // File state
    shapes,
    layers,
    activeLayerId,
    gridSize,
    gridVisible,
    snapEnabled,
    currentFilePath,
    projectName,
    isModified,
    // Drawings & Sheets state
    drawings,
    sheets,
    activeDrawingId,
    activeSheetId,
    drawingViewports,
    sheetViewports,
    // File actions
    newProject,
    loadProject,
    setFilePath,
    setProjectName,
    setModified,
    // Edit actions
    undo,
    redo,
    deleteSelectedShapes,
    selectedShapeIds,
    // Boundary editing
    boundaryEditState,
    cancelBoundaryDrag,
    deselectBoundary,
    // Viewport editing (sheet mode)
    editorMode,
    viewportEditState,
    cancelViewportDrag,
    selectViewport,
    deselectAll,
    // Wall sub-element selection
    selectedWallSubElement,
    clearWallSubElement,
    // Terminal
    toggleTerminal,
  } = useAppStore();

  /** Quick-save current document. Returns true if saved, false if cancelled/failed. */
  const quickSave = useCallback(async (): Promise<boolean> => {
    let fp = currentFilePath;
    if (!fp) {
      fp = await showSaveDialog(projectName);
      if (!fp) return false;
    }
    try {
      const project: ProjectFile = {
        version: 3,
        name: projectName,
        createdAt: new Date().toISOString(),
        modifiedAt: new Date().toISOString(),
        drawings, sheets,
        activeDrawingId: activeDrawingId || '',
        activeSheetId, drawingViewports, sheetViewports,
        shapes, layers, activeLayerId,
        settings: { gridSize, gridVisible, snapEnabled },
      };
      await writeProjectFile(fp, project);
      setFilePath(fp);
      setModified(false);
      const fileName = fp.split(/[/\\]/).pop()?.replace('.o2d', '') || 'Untitled';
      setProjectName(fileName);
      logger.info(`Project saved: ${fileName}`, 'File');
      return true;
    } catch (err) {
      await showError(`Failed to save file: ${err}`);
      return false;
    }
  }, [currentFilePath, projectName, shapes, layers, activeLayerId, drawings, sheets, activeDrawingId, activeSheetId, drawingViewports, sheetViewports, gridSize, gridVisible, snapEnabled, setFilePath, setModified, setProjectName]);

  const handleNew = useCallback(async () => {
    if (isModified) {
      const result = await promptSaveBeforeClose(projectName);
      if (result === 'cancel') return;
      if (result === 'save') {
        const saved = await quickSave();
        if (!saved) return;
      }
    }
    newProject();
  }, [isModified, projectName, newProject, quickSave]);

  const handleOpen = useCallback(async () => {
    if (isModified) {
      const result = await promptSaveBeforeClose(projectName);
      if (result === 'cancel') return;
      if (result === 'save') {
        const saved = await quickSave();
        if (!saved) return;
      }
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
  }, [isModified, projectName, loadProject, quickSave]);

  const handleSave = useCallback(async () => {
    let filePath = currentFilePath;

    if (!filePath) {
      filePath = await showSaveDialog(projectName);
      if (!filePath) return;
    }

    try {
      const project: ProjectFile = {
        version: 3,
        name: projectName,
        createdAt: new Date().toISOString(),
        modifiedAt: new Date().toISOString(),
        drawings,
        sheets,
        activeDrawingId: activeDrawingId || '',
        activeSheetId,
        drawingViewports,
        sheetViewports,
        shapes,
        layers,
        activeLayerId,
        settings: {
          gridSize,
          gridVisible,
          snapEnabled,
        },
      };

      await writeProjectFile(filePath, project);
      setFilePath(filePath);
      setModified(false);

      const fileName = filePath.split(/[/\\]/).pop()?.replace('.o2d', '') || 'Untitled';
      setProjectName(fileName);
    } catch (err) {
      await showError(`Failed to save file: ${err}`);
    }
  }, [currentFilePath, projectName, shapes, layers, activeLayerId, drawings, sheets, activeDrawingId, activeSheetId, drawingViewports, sheetViewports, gridSize, gridVisible, snapEnabled, setFilePath, setModified, setProjectName]);

  const handleSaveAs = useCallback(async () => {
    const filePath = await showSaveDialog(projectName);
    if (!filePath) return;

    try {
      const project: ProjectFile = {
        version: 3,
        name: projectName,
        createdAt: new Date().toISOString(),
        modifiedAt: new Date().toISOString(),
        drawings,
        sheets,
        activeDrawingId: activeDrawingId || '',
        activeSheetId,
        drawingViewports,
        sheetViewports,
        shapes,
        layers,
        activeLayerId,
        settings: {
          gridSize,
          gridVisible,
          snapEnabled,
        },
      };

      await writeProjectFile(filePath, project);
      setFilePath(filePath);
      setModified(false);

      const fileName = filePath.split(/[/\\]/).pop()?.replace('.o2d', '') || 'Untitled';
      setProjectName(fileName);
    } catch (err) {
      await showError(`Failed to save file: ${err}`);
    }
  }, [projectName, shapes, layers, activeLayerId, drawings, sheets, activeDrawingId, activeSheetId, drawingViewports, sheetViewports, gridSize, gridVisible, snapEnabled, setFilePath, setModified, setProjectName]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't handle if user is typing in an input
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      ) {
        return;
      }

      // Ctrl/Cmd key combinations
      if (e.ctrlKey || e.metaKey) {
        switch (e.key.toLowerCase()) {
          case 'n':
            e.preventDefault();
            handleNew();
            break;

          case 'o':
            e.preventDefault();
            handleOpen();
            break;

          case 's':
            e.preventDefault();
            if (e.shiftKey) {
              handleSaveAs();
            } else {
              handleSave();
            }
            break;

          case 'z':
            e.preventDefault();
            undo();
            break;

          case 'y':
            e.preventDefault();
            redo();
            break;

          case '`':
            e.preventDefault();
            toggleTerminal();
            break;
        }
      }

      // Escape key - cancel drag or deselect
      if (e.key === 'Escape') {
        // Sheet mode: viewport editing
        if (editorMode === 'sheet') {
          if (viewportEditState.isDragging) {
            e.preventDefault();
            cancelViewportDrag();
          } else if (viewportEditState.selectedViewportId) {
            e.preventDefault();
            selectViewport(null);
          }
        }
        // Draft mode: boundary editing
        else if (editorMode === 'drawing') {
          if (boundaryEditState.activeHandle !== null) {
            e.preventDefault();
            cancelBoundaryDrag();
          } else if (boundaryEditState.isSelected) {
            e.preventDefault();
            deselectBoundary();
          } else if (selectedWallSubElement) {
            // Clear wall sub-element selection before deselecting the wall itself
            e.preventDefault();
            clearWallSubElement();
          } else if (selectedShapeIds.length > 0) {
            e.preventDefault();
            deselectAll();
          }
        }
      }

      // Delete key
      if (e.key === 'Delete' && selectedShapeIds.length > 0) {
        e.preventDefault();
        deleteSelectedShapes();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleNew, handleOpen, handleSave, handleSaveAs, undo, redo, deleteSelectedShapes, selectedShapeIds, boundaryEditState, cancelBoundaryDrag, deselectBoundary, editorMode, viewportEditState, cancelViewportDrag, selectViewport, deselectAll, toggleTerminal, selectedWallSubElement, clearWallSubElement]);
}
