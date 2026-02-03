/**
 * Sheet Command Handlers
 *
 * Handles sheet viewport operations: add, update, delete, list viewports.
 */

import type { CommandDefinition, CommandResponse } from '../types';

export const sheetCommands: CommandDefinition[] = [
  // Add viewport to sheet
  {
    command: 'sheet',
    action: 'addViewport',
    description: 'Add a drawing as a viewport on a sheet',
    modifiesState: true,
    params: [
      { name: 'sheetId', type: 'string', description: 'Sheet ID (defaults to active sheet)' },
      { name: 'drawingId', type: 'string', description: 'Drawing ID to display (defaults to active drawing, or "current")' },
      { name: 'x', type: 'number', default: 20, description: 'X position in mm from sheet origin' },
      { name: 'y', type: 'number', default: 20, description: 'Y position in mm from sheet origin' },
      { name: 'width', type: 'number', default: 200, description: 'Viewport width in mm' },
      { name: 'height', type: 'number', default: 150, description: 'Viewport height in mm' },
      { name: 'scale', type: 'number', default: 0.01, description: 'Scale factor (0.01 = 1:100)' },
      { name: 'centerX', type: 'number', default: 0, description: 'Center X in drawing coordinates' },
      { name: 'centerY', type: 'number', default: 0, description: 'Center Y in drawing coordinates' },
    ],
    handler: (params, context): CommandResponse => {
      const state = context.getState();

      // Resolve sheet ID
      const sheetId = (params.sheetId as string) || state.activeSheetId;
      if (!sheetId) {
        return { success: false, error: 'No sheet specified and no active sheet' };
      }

      const sheet = state.sheets.find(s => s.id === sheetId);
      if (!sheet) {
        return { success: false, error: `Sheet not found: ${sheetId}` };
      }

      // Resolve drawing ID
      let drawingId = params.drawingId as string;
      if (!drawingId || drawingId === 'current') {
        drawingId = state.activeDrawingId;
      }

      const drawing = state.drawings.find(d => d.id === drawingId);
      if (!drawing) {
        return { success: false, error: `Drawing not found: ${drawingId}` };
      }

      // Add viewport
      const bounds = {
        x: (params.x as number) ?? 20,
        y: (params.y as number) ?? 20,
        width: (params.width as number) ?? 200,
        height: (params.height as number) ?? 150,
      };

      state.addSheetViewport(sheetId, drawingId, bounds);

      // Get the newly created viewport
      const updatedSheet = context.getState().sheets.find(s => s.id === sheetId);
      const newViewport = updatedSheet?.viewports[updatedSheet.viewports.length - 1];

      // Update scale and center if provided
      if (newViewport && (params.scale || params.centerX || params.centerY)) {
        state.updateSheetViewport(sheetId, newViewport.id, {
          scale: (params.scale as number) ?? 0.01,
          centerX: (params.centerX as number) ?? 0,
          centerY: (params.centerY as number) ?? 0,
        });
      }

      return {
        success: true,
        data: {
          viewportId: newViewport?.id,
          sheetId,
          drawingId,
          viewport: newViewport,
        },
      };
    },
  },

  // Update viewport
  {
    command: 'sheet',
    action: 'updateViewport',
    description: 'Update a viewport on a sheet',
    modifiesState: true,
    params: [
      { name: 'sheetId', type: 'string', description: 'Sheet ID (defaults to active sheet)' },
      { name: 'viewportId', type: 'string', required: true, description: 'Viewport ID to update' },
      { name: 'x', type: 'number', description: 'New X position in mm' },
      { name: 'y', type: 'number', description: 'New Y position in mm' },
      { name: 'width', type: 'number', description: 'New width in mm' },
      { name: 'height', type: 'number', description: 'New height in mm' },
      { name: 'scale', type: 'number', description: 'New scale factor' },
      { name: 'centerX', type: 'number', description: 'New center X in drawing coordinates' },
      { name: 'centerY', type: 'number', description: 'New center Y in drawing coordinates' },
      { name: 'locked', type: 'boolean', description: 'Lock/unlock viewport' },
      { name: 'visible', type: 'boolean', description: 'Show/hide viewport' },
    ],
    handler: (params, context): CommandResponse => {
      const state = context.getState();

      // Resolve sheet ID
      const sheetId = (params.sheetId as string) || state.activeSheetId;
      if (!sheetId) {
        return { success: false, error: 'No sheet specified and no active sheet' };
      }

      const sheet = state.sheets.find(s => s.id === sheetId);
      if (!sheet) {
        return { success: false, error: `Sheet not found: ${sheetId}` };
      }

      const viewportId = params.viewportId as string;
      const viewport = sheet.viewports.find(v => v.id === viewportId);
      if (!viewport) {
        return { success: false, error: `Viewport not found: ${viewportId}` };
      }

      // Build updates object
      const updates: Record<string, unknown> = {};
      if (params.x !== undefined) updates.x = params.x;
      if (params.y !== undefined) updates.y = params.y;
      if (params.width !== undefined) updates.width = params.width;
      if (params.height !== undefined) updates.height = params.height;
      if (params.scale !== undefined) updates.scale = params.scale;
      if (params.centerX !== undefined) updates.centerX = params.centerX;
      if (params.centerY !== undefined) updates.centerY = params.centerY;
      if (params.locked !== undefined) updates.locked = params.locked;
      if (params.visible !== undefined) updates.visible = params.visible;

      state.updateSheetViewport(sheetId, viewportId, updates);

      const updatedSheet = context.getState().sheets.find(s => s.id === sheetId);
      const updatedViewport = updatedSheet?.viewports.find(v => v.id === viewportId);

      return {
        success: true,
        data: {
          viewport: updatedViewport,
        },
      };
    },
  },

  // Delete viewport
  {
    command: 'sheet',
    action: 'deleteViewport',
    description: 'Remove a viewport from a sheet',
    modifiesState: true,
    params: [
      { name: 'sheetId', type: 'string', description: 'Sheet ID (defaults to active sheet)' },
      { name: 'viewportId', type: 'string', required: true, description: 'Viewport ID to delete' },
    ],
    handler: (params, context): CommandResponse => {
      const state = context.getState();

      // Resolve sheet ID
      const sheetId = (params.sheetId as string) || state.activeSheetId;
      if (!sheetId) {
        return { success: false, error: 'No sheet specified and no active sheet' };
      }

      const sheet = state.sheets.find(s => s.id === sheetId);
      if (!sheet) {
        return { success: false, error: `Sheet not found: ${sheetId}` };
      }

      const viewportId = params.viewportId as string;
      const viewport = sheet.viewports.find(v => v.id === viewportId);
      if (!viewport) {
        return { success: false, error: `Viewport not found: ${viewportId}` };
      }

      state.deleteSheetViewport(sheetId, viewportId);

      return {
        success: true,
        data: {
          deletedViewportId: viewportId,
        },
      };
    },
  },

  // List viewports
  {
    command: 'sheet',
    action: 'listViewports',
    description: 'List all viewports on a sheet',
    modifiesState: false,
    params: [
      { name: 'sheetId', type: 'string', description: 'Sheet ID (defaults to active sheet)' },
    ],
    handler: (params, context): CommandResponse => {
      const state = context.getState();

      // Resolve sheet ID
      const sheetId = (params.sheetId as string) || state.activeSheetId;
      if (!sheetId) {
        return { success: false, error: 'No sheet specified and no active sheet' };
      }

      const sheet = state.sheets.find(s => s.id === sheetId);
      if (!sheet) {
        return { success: false, error: `Sheet not found: ${sheetId}` };
      }

      // Enrich viewports with drawing info
      const viewports = sheet.viewports.map(vp => {
        const drawing = state.drawings.find(d => d.id === vp.drawingId);
        return {
          ...vp,
          drawingName: drawing?.name || 'Unknown',
        };
      });

      return {
        success: true,
        data: {
          sheetId,
          sheetName: sheet.name,
          viewports,
          count: viewports.length,
        },
      };
    },
  },

  // Get viewport by ID
  {
    command: 'sheet',
    action: 'getViewport',
    description: 'Get details of a specific viewport',
    modifiesState: false,
    params: [
      { name: 'sheetId', type: 'string', description: 'Sheet ID (defaults to active sheet)' },
      { name: 'viewportId', type: 'string', required: true, description: 'Viewport ID' },
    ],
    handler: (params, context): CommandResponse => {
      const state = context.getState();

      // Resolve sheet ID
      const sheetId = (params.sheetId as string) || state.activeSheetId;
      if (!sheetId) {
        return { success: false, error: 'No sheet specified and no active sheet' };
      }

      const sheet = state.sheets.find(s => s.id === sheetId);
      if (!sheet) {
        return { success: false, error: `Sheet not found: ${sheetId}` };
      }

      const viewportId = params.viewportId as string;
      const viewport = sheet.viewports.find(v => v.id === viewportId);
      if (!viewport) {
        return { success: false, error: `Viewport not found: ${viewportId}` };
      }

      const drawing = state.drawings.find(d => d.id === viewport.drawingId);

      return {
        success: true,
        data: {
          viewport: {
            ...viewport,
            drawingName: drawing?.name || 'Unknown',
          },
        },
      };
    },
  },
];
