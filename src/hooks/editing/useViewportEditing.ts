/**
 * useViewportEditing - Handles sheet viewport editing (selection and dragging)
 */

import { useCallback } from 'react';
import { useAppStore, type ViewportHandleType } from '../../state/appStore';
import type { Point, SheetViewport } from '../../types/geometry';

export function useViewportEditing() {
  const {
    viewport,
    editorMode,
    sheets,
    activeSheetId,
    viewportEditState,
    selectViewport,
    startViewportDrag,
    updateViewportDrag,
    endViewportDrag,
  } = useAppStore();

  // mm to pixels conversion
  const mmToPixels = 3.78;

  /**
   * Convert screen coordinates to sheet coordinates (mm)
   */
  const screenToSheet = useCallback(
    (screenX: number, screenY: number): Point => {
      const worldX = (screenX - viewport.offsetX) / viewport.zoom;
      const worldY = (screenY - viewport.offsetY) / viewport.zoom;
      return {
        x: worldX / mmToPixels,
        y: worldY / mmToPixels,
      };
    },
    [viewport]
  );

  /**
   * Get the active sheet
   */
  const getActiveSheet = useCallback(() => {
    if (editorMode !== 'sheet' || !activeSheetId) return null;
    return sheets.find(s => s.id === activeSheetId) || null;
  }, [editorMode, activeSheetId, sheets]);

  /**
   * Get viewport handle positions
   * Note: Only center handle for moving - size is derived from boundary × scale (Revit-style)
   */
  const getViewportHandles = useCallback((vp: SheetViewport): { type: ViewportHandleType; x: number; y: number }[] => {
    // Only center handle for moving - no resize handles (Revit-style: size = boundary × scale)
    return [
      { type: 'center', x: vp.x + vp.width / 2, y: vp.y + vp.height / 2 },
    ];
  }, []);

  /**
   * Find viewport handle at sheet position
   */
  const findViewportHandle = useCallback((sheetPos: Point, vp: SheetViewport): ViewportHandleType | null => {
    const handles = getViewportHandles(vp);
    const tolerance = 5 / viewport.zoom;

    for (const handle of handles) {
      const dx = sheetPos.x - handle.x;
      const dy = sheetPos.y - handle.y;
      const distance = Math.sqrt(dx * dx + dy * dy);

      if (distance <= tolerance) {
        return handle.type;
      }
    }
    return null;
  }, [getViewportHandles, viewport.zoom]);

  /**
   * Check if point is inside a viewport
   */
  const isPointInViewport = useCallback((sheetPos: Point, vp: SheetViewport): boolean => {
    return (
      sheetPos.x >= vp.x &&
      sheetPos.x <= vp.x + vp.width &&
      sheetPos.y >= vp.y &&
      sheetPos.y <= vp.y + vp.height
    );
  }, []);

  /**
   * Find which viewport (if any) is at the given sheet position
   */
  const findViewportAtPoint = useCallback((sheetPos: Point): SheetViewport | null => {
    const sheet = getActiveSheet();
    if (!sheet) return null;

    // Check in reverse order (topmost viewport first)
    for (let i = sheet.viewports.length - 1; i >= 0; i--) {
      const vp = sheet.viewports[i];
      if (vp.visible && isPointInViewport(sheetPos, vp)) {
        return vp;
      }
    }
    return null;
  }, [getActiveSheet, isPointInViewport]);

  /**
   * Handle mouse down for viewport editing
   */
  const handleViewportMouseDown = useCallback(
    (screenPos: Point): boolean => {
      if (editorMode !== 'sheet') return false;

      const sheetPos = screenToSheet(screenPos.x, screenPos.y);
      const sheet = getActiveSheet();

      if (sheet && viewportEditState.selectedViewportId) {
        const selectedVp = sheet.viewports.find(vp => vp.id === viewportEditState.selectedViewportId);
        if (selectedVp && !selectedVp.locked) {
          const handle = findViewportHandle(sheetPos, selectedVp);
          if (handle) {
            startViewportDrag(handle, sheetPos);
            return true;
          }
        }
      }
      return false;
    },
    [editorMode, screenToSheet, getActiveSheet, viewportEditState.selectedViewportId, findViewportHandle, startViewportDrag]
  );

  /**
   * Handle click for viewport selection
   */
  const handleViewportClick = useCallback(
    (screenPos: Point): boolean => {
      if (editorMode !== 'sheet') return false;

      const sheetPos = screenToSheet(screenPos.x, screenPos.y);

      // Check if clicking on a selected viewport's handle
      if (viewportEditState.selectedViewportId) {
        const sheet = getActiveSheet();
        if (sheet) {
          const selectedVp = sheet.viewports.find(vp => vp.id === viewportEditState.selectedViewportId);
          if (selectedVp) {
            const handle = findViewportHandle(sheetPos, selectedVp);
            if (handle) {
              return true;
            }
          }
        }
      }

      // Check if clicking on any viewport
      const vp = findViewportAtPoint(sheetPos);
      if (vp) {
        selectViewport(vp.id);
      } else {
        selectViewport(null);
      }
      return true;
    },
    [editorMode, screenToSheet, viewportEditState.selectedViewportId, getActiveSheet, findViewportHandle, findViewportAtPoint, selectViewport]
  );

  /**
   * Handle mouse move for viewport dragging
   */
  const handleViewportMouseMove = useCallback(
    (screenPos: Point): boolean => {
      if (editorMode !== 'sheet' || !viewportEditState.isDragging) return false;
      const sheetPos = screenToSheet(screenPos.x, screenPos.y);
      updateViewportDrag(sheetPos);
      return true;
    },
    [editorMode, viewportEditState.isDragging, screenToSheet, updateViewportDrag]
  );

  /**
   * Handle mouse up for viewport dragging
   */
  const handleViewportMouseUp = useCallback((): boolean => {
    if (editorMode !== 'sheet' || !viewportEditState.isDragging) return false;
    endViewportDrag();
    return true;
  }, [editorMode, viewportEditState.isDragging, endViewportDrag]);

  /**
   * Check if viewport is being dragged
   */
  const isDragging = useCallback(() => viewportEditState.isDragging, [viewportEditState.isDragging]);

  return {
    screenToSheet,
    getActiveSheet,
    getViewportHandles,
    findViewportHandle,
    isPointInViewport,
    findViewportAtPoint,
    handleViewportMouseDown,
    handleViewportClick,
    handleViewportMouseMove,
    handleViewportMouseUp,
    isDragging,
    selectViewport,
    selectedViewportId: viewportEditState.selectedViewportId,
  };
}
