/**
 * useTitleBlockEditing - Handles inline editing of title block fields
 *
 * Provides click detection, hover highlighting, and coordinate transforms
 * for positioning the inline editor overlay.
 */

import { useCallback } from 'react';
import { useAppStore } from '../../state/appStore';
import { getActiveDocumentStore } from '../../state/documentStore';
import { getTitleBlockFieldRects, type TitleBlockFieldRect } from '../../engine/renderer/sheet/titleBlockHitTest';
import { MM_TO_PIXELS } from '../../engine/renderer/types';
import { PAPER_SIZES } from '../../state/slices/types';

/**
 * Force a React re-render by bumping a counter on appStore.
 * This avoids syncing actual data between stores (which can cause
 * overwrite issues since documentStore and appStore initialize separately).
 */
function triggerRerender() {
  const cur = (useAppStore.getState() as any)._titleBlockRenderTick ?? 0;
  useAppStore.setState({ _titleBlockRenderTick: cur + 1 } as any);
}

export function useTitleBlockEditing() {
  const viewport = useAppStore(s => s.viewport);
  const editorMode = useAppStore(s => s.editorMode);
  const sheets = useAppStore(s => s.sheets);
  const activeSheetId = useAppStore(s => s.activeSheetId);
  const customTitleBlockTemplates = useAppStore(s => s.customTitleBlockTemplates);

  // Read title block editing state from documentStore directly (not proxied to appStore)
  // We subscribe to a tick counter to force re-renders when these change.
  useAppStore(s => (s as any)._titleBlockRenderTick);
  const docStore = getActiveDocumentStore();
  const titleBlockEditingFieldId = docStore.getState().titleBlockEditingFieldId;
  const hoveredTitleBlockFieldId = docStore.getState().hoveredTitleBlockFieldId;

  /**
   * Get the active sheet
   */
  const getActiveSheet = useCallback(() => {
    if (editorMode !== 'sheet' || !activeSheetId) return null;
    return sheets.find(s => s.id === activeSheetId) || null;
  }, [editorMode, activeSheetId, sheets]);

  /**
   * Get paper dimensions in pixels for the active sheet
   */
  const getPaperDimensionsPx = useCallback(() => {
    const sheet = getActiveSheet();
    if (!sheet) return null;

    let widthMM: number, heightMM: number;
    if (sheet.paperSize === 'Custom') {
      widthMM = sheet.customWidth || 210;
      heightMM = sheet.customHeight || 297;
    } else {
      const baseDims = PAPER_SIZES[sheet.paperSize];
      if (sheet.orientation === 'landscape') {
        widthMM = baseDims.height;
        heightMM = baseDims.width;
      } else {
        widthMM = baseDims.width;
        heightMM = baseDims.height;
      }
    }

    return {
      widthPx: widthMM * MM_TO_PIXELS,
      heightPx: heightMM * MM_TO_PIXELS,
    };
  }, [getActiveSheet]);

  /**
   * Get all field rects for the active sheet's title block
   */
  const getFieldRects = useCallback((): TitleBlockFieldRect[] => {
    const sheet = getActiveSheet();
    if (!sheet || !sheet.titleBlock.visible) return [];

    const dims = getPaperDimensionsPx();
    if (!dims) return [];

    return getTitleBlockFieldRects(sheet.titleBlock, dims.widthPx, dims.heightPx, customTitleBlockTemplates);
  }, [getActiveSheet, getPaperDimensionsPx, customTitleBlockTemplates]);

  /**
   * Find the field at a given screen position
   */
  const findFieldAtScreenPos = useCallback(
    (screenX: number, screenY: number): TitleBlockFieldRect | null => {
      const rects = getFieldRects();
      if (rects.length === 0) return null;

      // Convert screen to sheet pixel space (before viewport transform)
      const worldX = (screenX - viewport.offsetX) / viewport.zoom;
      const worldY = (screenY - viewport.offsetY) / viewport.zoom;

      for (const rect of rects) {
        if (
          worldX >= rect.x &&
          worldX <= rect.x + rect.width &&
          worldY >= rect.y &&
          worldY <= rect.y + rect.height
        ) {
          return rect;
        }
      }

      return null;
    },
    [getFieldRects, viewport]
  );

  /**
   * Handle mouse move over the title block area — updates hover state
   */
  const handleTitleBlockMouseMove = useCallback(
    (screenPos: { x: number; y: number }): void => {
      if (editorMode !== 'sheet') return;
      // Don't change hover while editing
      if (titleBlockEditingFieldId) return;

      const field = findFieldAtScreenPos(screenPos.x, screenPos.y);
      const newId = field?.fieldId ?? null;
      // Only update if changed to avoid unnecessary re-renders
      if (newId !== hoveredTitleBlockFieldId) {
        const docStore = getActiveDocumentStore();
        docStore.getState().setHoveredTitleBlockFieldId(newId);
        triggerRerender();
      }
    },
    [editorMode, titleBlockEditingFieldId, hoveredTitleBlockFieldId, findFieldAtScreenPos]
  );

  /**
   * Handle click on a title block field — starts editing if field clicked
   * Returns true if a field was clicked (to prevent event propagation)
   */
  const handleTitleBlockClick = useCallback(
    (screenPos: { x: number; y: number }): boolean => {
      if (editorMode !== 'sheet') return false;

      const field = findFieldAtScreenPos(screenPos.x, screenPos.y);
      if (field) {
        const docStore = getActiveDocumentStore();
        docStore.getState().startTitleBlockFieldEditing(field.fieldId);
        triggerRerender();
        return true;
      }

      return false;
    },
    [editorMode, findFieldAtScreenPos]
  );

  /**
   * Get the screen-space rect for the currently editing field
   * Used to position the HTML input overlay
   */
  const getEditingFieldScreenRect = useCallback((): {
    x: number;
    y: number;
    width: number;
    height: number;
    fieldRect: TitleBlockFieldRect;
  } | null => {
    if (!titleBlockEditingFieldId) return null;

    const rects = getFieldRects();
    const fieldRect = rects.find(r => r.fieldId === titleBlockEditingFieldId);
    if (!fieldRect) return null;

    // Convert from sheet pixel space to screen space
    return {
      x: fieldRect.x * viewport.zoom + viewport.offsetX,
      y: fieldRect.y * viewport.zoom + viewport.offsetY,
      width: fieldRect.width * viewport.zoom,
      height: fieldRect.height * viewport.zoom,
      fieldRect,
    };
  }, [titleBlockEditingFieldId, getFieldRects, viewport]);

  /**
   * Save the current field value.
   * Updates appStore sheets directly (the renderer reads from appStore).
   * documentStore.sheets starts empty and is only populated on doc switch,
   * so we cannot rely on docStore.updateTitleBlockField here.
   */
  const saveFieldValue = useCallback(
    (value: string): void => {
      const sheet = getActiveSheet();
      if (!sheet || !titleBlockEditingFieldId) return;

      // Update the field directly on appStore's sheets
      const currentSheets = useAppStore.getState().sheets;
      const updatedSheets = currentSheets.map((s: any) => {
        if (s.id !== sheet.id) return s;
        return {
          ...s,
          titleBlock: {
            ...s.titleBlock,
            fields: s.titleBlock.fields.map((f: any) =>
              f.id === titleBlockEditingFieldId ? { ...f, value } : f
            ),
          },
          modifiedAt: new Date().toISOString(),
        };
      });
      useAppStore.setState({ sheets: updatedSheets, isModified: true } as any);

      // End editing (state lives in docStore)
      const docStore = getActiveDocumentStore();
      docStore.getState().endTitleBlockFieldEditing();
      triggerRerender();
    },
    [getActiveSheet, titleBlockEditingFieldId]
  );

  /**
   * Cancel editing
   */
  const cancelFieldEditing = useCallback((): void => {
    const docStore = getActiveDocumentStore();
    docStore.getState().endTitleBlockFieldEditing();
    triggerRerender();
  }, []);

  return {
    handleTitleBlockMouseMove,
    handleTitleBlockClick,
    getEditingFieldScreenRect,
    saveFieldValue,
    cancelFieldEditing,
    findFieldAtScreenPos,
    getFieldRects,
  };
}
