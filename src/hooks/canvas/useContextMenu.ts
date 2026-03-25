/**
 * useContextMenu - Manages right-click context menu state and items
 *
 * Simplified menu: only essential items are shown.
 * Special handling for section-callout shapes: adds "Open Section" option.
 */

import { useState, useCallback, useMemo } from 'react';
import { useAppStore } from '../../state/appStore';
import type { ContextMenuEntry } from '../../components/shared/ContextMenu';
import type { Point, SectionCalloutShape } from '../../types/geometry';
import type { ToolType } from '../../state/slices/types';

// Tool display names for "Repeat [Tool]" menu item
const TOOL_DISPLAY_NAMES: Record<ToolType, string> = {
  'select': 'Select',
  'pan': 'Pan',
  'line': 'Line',
  'rectangle': 'Rectangle',
  'circle': 'Circle',
  'arc': 'Arc',
  'polyline': 'Polyline',
  'ellipse': 'Ellipse',
  'spline': 'Spline',
  'text': 'Text',
  'leader': 'Leader',
  'dimension': 'Dimension',
  'filled-region': 'Filled Region',
  'insulation': 'Insulation',
  'hatch': 'Hatch',
  'detail-component': 'Detail Component',
  'beam': 'Beam',
  'gridline': 'Grid Line',
  'level': 'Level',
  'pile': 'Pile',
  'column': 'Column',
  'puntniveau': 'Puntniveau',
  'cpt': 'CPT',
  'wall': 'Wall',
  'slab': 'Slab',
  'slab-opening': 'Slab Opening',
  'slab-label': 'Slab Label',
  'section-callout': 'Section Callout',
  'label': 'Label',
  'image': 'Image',
  'move': 'Move',
  'copy': 'Copy',
  'copy2': 'Copy2',
  'rotate': 'Rotate',
  'scale': 'Scale',
  'mirror': 'Mirror',
  'trim': 'Trim',
  'extend': 'Extend',
  'fillet': 'Fillet',
  'chamfer': 'Chamfer',
  'offset': 'Offset',
  'array': 'Array',
  'elastic': 'Elastic',
  'space': 'Space',
  'plate-system': 'Plate System',
  'spot-elevation': 'Spot Elevation',
  'rebar': 'Rebar',
  'align': 'Align',
  'trim-walls': 'Wall/Beam/Duct Join',
  'sheet-text': 'Sheet Text',
  'sheet-leader': 'Sheet Leader',
  'sheet-dimension': 'Sheet Dimension',
  'sheet-callout': 'Sheet Callout',
  'sheet-revision-cloud': 'Revision Cloud',
};

export interface ContextMenuState {
  isOpen: boolean;
  x: number;
  y: number;
}

export function useContextMenu() {
  const [menuState, setMenuState] = useState<ContextMenuState>({
    isOpen: false,
    x: 0,
    y: 0,
  });

  const {
    selectedShapeIds,
    shapes,
    drawings,
    lastTool,
    // Actions
    deleteSelectedShapes,
    selectAll,
    repeatLastTool,
    pasteShapes,
    hasClipboardContent,
    zoomToFit,
    switchToDrawing,
  } = useAppStore();

  const openMenu = useCallback((x: number, y: number) => {
    setMenuState({ isOpen: true, x, y });
  }, []);

  const closeMenu = useCallback(() => {
    setMenuState(prev => ({ ...prev, isOpen: false }));
  }, []);

  // Detect if exactly one section-callout is selected and find its target drawing
  const sectionCalloutInfo = useMemo(() => {
    if (selectedShapeIds.length !== 1) return null;
    const shape = shapes.find(s => s.id === selectedShapeIds[0]);
    if (!shape || shape.type !== 'section-callout') return null;
    const callout = shape as SectionCalloutShape;
    if (!callout.targetDrawingId) return null;
    // Verify the target drawing exists
    const targetDrawing = drawings.find(d => d.id === callout.targetDrawingId);
    if (!targetDrawing) return null;
    return {
      drawingId: callout.targetDrawingId,
      drawingName: targetDrawing.name,
      label: callout.label,
    };
  }, [selectedShapeIds, shapes, drawings]);

  // Build menu items based on context
  const getMenuItems = useCallback((clickedOnShape: boolean, pastePosition?: Point): ContextMenuEntry[] => {
    const hasSelection = selectedShapeIds.length > 0;
    const hasClipboard = hasClipboardContent();

    // "Repeat [Tool]" item at the top when lastTool exists
    const repeatItem: ContextMenuEntry[] = lastTool ? [
      {
        id: 'repeat',
        label: `Repeat ${TOOL_DISPLAY_NAMES[lastTool] || lastTool}`,
        shortcut: 'Enter',
        action: repeatLastTool,
      },
      { type: 'divider' },
    ] : [];

    // Menu when shapes are selected or clicked on a shape
    if (hasSelection || clickedOnShape) {
      const items: ContextMenuEntry[] = [
        ...repeatItem,
      ];

      // "Open Section" for section-callout shapes
      if (sectionCalloutInfo) {
        items.push({
          id: 'open-section',
          label: `Open Section ${sectionCalloutInfo.label}`,
          action: () => switchToDrawing(sectionCalloutInfo.drawingId),
        });
        items.push({ type: 'divider' });
      }

      items.push(
        {
          id: 'delete',
          label: 'Delete',
          shortcut: 'Del',
          action: deleteSelectedShapes,
          disabled: !hasSelection,
        },
        { type: 'divider' },
        {
          id: 'select-all',
          label: 'Select All',
          shortcut: 'Ctrl+A',
          action: selectAll,
        },
      );

      return items;
    }

    // Menu when clicking empty space
    return [
      ...repeatItem,
      {
        id: 'paste',
        label: 'Paste',
        shortcut: 'Ctrl+V',
        action: () => pasteShapes(pastePosition),
        disabled: !hasClipboard,
      },
      { type: 'divider' },
      {
        id: 'select-all',
        label: 'Select All',
        shortcut: 'Ctrl+A',
        action: selectAll,
      },
      { type: 'divider' },
      {
        id: 'zoom-to-fit',
        label: 'Zoom to Fit',
        action: zoomToFit,
      },
    ];
  }, [
    selectedShapeIds,
    hasClipboardContent,
    lastTool,
    deleteSelectedShapes,
    pasteShapes,
    selectAll,
    repeatLastTool,
    zoomToFit,
    sectionCalloutInfo,
    switchToDrawing,
  ]);

  return {
    menuState,
    openMenu,
    closeMenu,
    getMenuItems,
  };
}
