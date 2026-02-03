/**
 * Document Command Handlers
 *
 * Drawing and sheet management: newDrawing, newSheet, switchMode, listDrawings, listSheets.
 */

import type { CommandDefinition, CommandResponse } from '../types';
import type { PaperSize, PaperOrientation, EditorMode } from '../../../types/geometry';

export const documentCommands: CommandDefinition[] = [
  // Create new drawing
  {
    command: 'document',
    action: 'newDrawing',
    description: 'Create a new drawing',
    modifiesState: true,
    params: [
      { name: 'name', type: 'string', description: 'Drawing name' },
      { name: 'switchTo', type: 'boolean', default: true, description: 'Switch to the new drawing' },
    ],
    handler: (params, context): CommandResponse => {
      const state = context.getState();
      const prevIds = new Set(state.drawings.map(d => d.id));

      state.addDrawing(params.name as string | undefined);

      const newDrawing = context.getState().drawings.find(d => !prevIds.has(d.id));
      if (!newDrawing) {
        return { success: false, error: 'Failed to create drawing' };
      }

      if (params.switchTo !== false) {
        state.switchToDrawing(newDrawing.id);
      }

      return {
        success: true,
        data: { drawing: newDrawing },
      };
    },
  },

  // Delete drawing
  {
    command: 'document',
    action: 'deleteDrawing',
    description: 'Delete a drawing',
    modifiesState: true,
    params: [
      { name: 'id', type: 'string', required: true, description: 'Drawing ID to delete' },
    ],
    handler: (params, context): CommandResponse => {
      const id = params.id as string;
      const state = context.getState();

      const drawing = state.drawings.find(d => d.id === id);
      if (!drawing) {
        return { success: false, error: `Drawing not found: ${id}` };
      }

      if (state.drawings.length <= 1) {
        return { success: false, error: 'Cannot delete the last drawing' };
      }

      state.deleteDrawing(id);

      return {
        success: true,
        data: { deletedDrawing: drawing },
      };
    },
  },

  // Rename drawing
  {
    command: 'document',
    action: 'renameDrawing',
    description: 'Rename a drawing',
    modifiesState: true,
    params: [
      { name: 'id', type: 'string', required: true, description: 'Drawing ID' },
      { name: 'name', type: 'string', required: true, description: 'New name' },
    ],
    handler: (params, context): CommandResponse => {
      const id = params.id as string;
      const name = params.name as string;
      const state = context.getState();

      const drawing = state.drawings.find(d => d.id === id);
      if (!drawing) {
        return { success: false, error: `Drawing not found: ${id}` };
      }

      state.renameDrawing(id, name);

      return {
        success: true,
        data: { drawing: context.getState().drawings.find(d => d.id === id) },
      };
    },
  },

  // Switch to drawing
  {
    command: 'document',
    action: 'switchToDrawing',
    description: 'Switch to a specific drawing',
    modifiesState: false,
    params: [
      { name: 'id', type: 'string', required: true, description: 'Drawing ID to switch to' },
    ],
    handler: (params, context): CommandResponse => {
      const id = params.id as string;
      const state = context.getState();

      const drawing = state.drawings.find(d => d.id === id);
      if (!drawing) {
        return { success: false, error: `Drawing not found: ${id}` };
      }

      state.switchToDrawing(id);

      return {
        success: true,
        data: { activeDrawingId: id, drawing },
      };
    },
  },

  // Create new sheet
  {
    command: 'document',
    action: 'newSheet',
    description: 'Create a new sheet',
    modifiesState: true,
    params: [
      { name: 'name', type: 'string', description: 'Sheet name' },
      { name: 'paperSize', type: 'string', default: 'A4', enum: ['A4', 'A3', 'A2', 'A1', 'A0', 'Letter', 'Legal', 'Tabloid', 'Custom'], description: 'Paper size' },
      { name: 'orientation', type: 'string', default: 'landscape', enum: ['portrait', 'landscape'], description: 'Paper orientation' },
      { name: 'switchTo', type: 'boolean', default: true, description: 'Switch to the new sheet' },
    ],
    handler: (params, context): CommandResponse => {
      const state = context.getState();
      const prevIds = new Set(state.sheets.map(s => s.id));

      state.addSheet(
        params.name as string | undefined,
        params.paperSize as PaperSize | undefined,
        params.orientation as PaperOrientation | undefined
      );

      const newSheet = context.getState().sheets.find(s => !prevIds.has(s.id));
      if (!newSheet) {
        return { success: false, error: 'Failed to create sheet' };
      }

      if (params.switchTo !== false) {
        state.switchToSheet(newSheet.id);
      }

      return {
        success: true,
        data: { sheet: newSheet },
      };
    },
  },

  // Delete sheet
  {
    command: 'document',
    action: 'deleteSheet',
    description: 'Delete a sheet',
    modifiesState: true,
    params: [
      { name: 'id', type: 'string', required: true, description: 'Sheet ID to delete' },
    ],
    handler: (params, context): CommandResponse => {
      const id = params.id as string;
      const state = context.getState();

      const sheet = state.sheets.find(s => s.id === id);
      if (!sheet) {
        return { success: false, error: `Sheet not found: ${id}` };
      }

      state.deleteSheet(id);

      return {
        success: true,
        data: { deletedSheet: sheet },
      };
    },
  },

  // Switch mode
  {
    command: 'document',
    action: 'switchMode',
    description: 'Switch between drawing and sheet mode',
    modifiesState: false,
    params: [
      { name: 'mode', type: 'string', required: true, enum: ['drawing', 'sheet'], description: 'Editor mode' },
    ],
    handler: (params, context): CommandResponse => {
      const mode = params.mode as EditorMode;
      const state = context.getState();

      if (mode === 'drawing') {
        state.switchToDrawingMode();
      } else if (mode === 'sheet') {
        const activeSheet = state.sheets.find(s => s.id === state.activeSheetId);
        if (activeSheet) {
          state.switchToSheet(activeSheet.id);
        } else if (state.sheets.length > 0) {
          state.switchToSheet(state.sheets[0].id);
        } else {
          return { success: false, error: 'No sheets available' };
        }
      }

      return {
        success: true,
        data: {
          mode: context.getState().editorMode,
        },
      };
    },
  },

  // List drawings
  {
    command: 'document',
    action: 'listDrawings',
    description: 'List all drawings',
    modifiesState: false,
    params: [],
    handler: (_, context): CommandResponse => {
      const state = context.getState();

      const drawings = state.drawings.map(d => ({
        ...d,
        shapeCount: state.shapes.filter(s => s.drawingId === d.id).length,
        layerCount: state.layers.filter(l => l.drawingId === d.id).length,
      }));

      return {
        success: true,
        data: {
          drawings,
          activeDrawingId: state.activeDrawingId,
          count: drawings.length,
        },
      };
    },
  },

  // List sheets
  {
    command: 'document',
    action: 'listSheets',
    description: 'List all sheets',
    modifiesState: false,
    params: [],
    handler: (_, context): CommandResponse => {
      const state = context.getState();

      const sheets = state.sheets.map(s => ({
        id: s.id,
        name: s.name,
        paperSize: s.paperSize,
        orientation: s.orientation,
        viewportCount: s.viewports.length,
      }));

      return {
        success: true,
        data: {
          sheets,
          activeSheetId: state.activeSheetId,
          count: sheets.length,
        },
      };
    },
  },

  // Get current document state
  {
    command: 'document',
    action: 'getState',
    description: 'Get current document state',
    modifiesState: false,
    params: [],
    handler: (_, context): CommandResponse => {
      const state = context.getState();

      return {
        success: true,
        data: {
          editorMode: state.editorMode,
          activeDrawingId: state.activeDrawingId,
          activeSheetId: state.activeSheetId,
          activeLayerId: state.activeLayerId,
          drawingCount: state.drawings.length,
          sheetCount: state.sheets.length,
          shapeCount: state.shapes.length,
          layerCount: state.layers.length,
        },
      };
    },
  },

  // Create sheet from template
  {
    command: 'document',
    action: 'newSheetFromTemplate',
    description: 'Create a new sheet from a template',
    modifiesState: true,
    params: [
      { name: 'templateId', type: 'string', description: 'Template ID' },
      { name: 'templateName', type: 'string', description: 'Template name (alternative to templateId)' },
      { name: 'name', type: 'string', description: 'Sheet name' },
      { name: 'drawingAssignments', type: 'object', description: 'Map of placeholder IDs to drawing IDs' },
      { name: 'switchTo', type: 'boolean', default: true, description: 'Switch to the new sheet' },
    ],
    handler: (params, context): CommandResponse => {
      const state = context.getState();

      // Find template by ID or name
      let templateId = params.templateId as string | undefined;

      if (!templateId && params.templateName) {
        const templateName = (params.templateName as string).toLowerCase();
        // Search in custom templates
        const template = state.customSheetTemplates.find(
          t => t.name.toLowerCase() === templateName || t.id === templateName
        );
        if (template) {
          templateId = template.id;
        }
      }

      if (!templateId) {
        return {
          success: false,
          error: 'Template not found. Provide a valid templateId or templateName.',
        };
      }

      // Check if template exists
      const template = state.customSheetTemplates.find(t => t.id === templateId);
      if (!template) {
        return {
          success: false,
          error: `Template not found: ${templateId}`,
        };
      }

      const prevSheetIds = new Set(state.sheets.map(s => s.id));
      const sheetName = (params.name as string) || `${template.name} Sheet`;
      const drawingAssignments = (params.drawingAssignments as Record<string, string>) || {};

      state.addSheetFromTemplate(templateId, sheetName, drawingAssignments);

      const newSheet = context.getState().sheets.find(s => !prevSheetIds.has(s.id));
      if (!newSheet) {
        return { success: false, error: 'Failed to create sheet from template' };
      }

      if (params.switchTo !== false) {
        state.switchToSheet(newSheet.id);
      }

      return {
        success: true,
        data: {
          sheet: newSheet,
          templateUsed: template.name,
        },
      };
    },
  },

  // List sheet templates
  {
    command: 'document',
    action: 'listSheetTemplates',
    description: 'List all available sheet templates',
    modifiesState: false,
    params: [],
    handler: (_, context): CommandResponse => {
      const state = context.getState();

      const templates = state.customSheetTemplates.map(t => ({
        id: t.id,
        name: t.name,
        description: t.description,
        paperSize: t.paperSize,
        orientation: t.orientation,
        viewportCount: t.viewportPlaceholders?.length || 0,
        isBuiltIn: t.isBuiltIn,
      }));

      return {
        success: true,
        data: {
          templates,
          count: templates.length,
        },
      };
    },
  },

  // Get template by name
  {
    command: 'document',
    action: 'getSheetTemplate',
    description: 'Get a sheet template by ID or name',
    modifiesState: false,
    params: [
      { name: 'templateId', type: 'string', description: 'Template ID' },
      { name: 'templateName', type: 'string', description: 'Template name (alternative to templateId)' },
    ],
    handler: (params, context): CommandResponse => {
      const state = context.getState();

      let template;

      if (params.templateId) {
        template = state.customSheetTemplates.find(t => t.id === params.templateId);
      } else if (params.templateName) {
        const name = (params.templateName as string).toLowerCase();
        template = state.customSheetTemplates.find(
          t => t.name.toLowerCase() === name || t.id === name
        );
      }

      if (!template) {
        return {
          success: false,
          error: 'Template not found',
        };
      }

      return {
        success: true,
        data: { template },
      };
    },
  },

  // Save sheet as template
  {
    command: 'document',
    action: 'saveSheetAsTemplate',
    description: 'Save current sheet layout as a template',
    modifiesState: true,
    params: [
      { name: 'sheetId', type: 'string', description: 'Sheet ID (defaults to active sheet)' },
      { name: 'name', type: 'string', required: true, description: 'Template name' },
      { name: 'description', type: 'string', default: '', description: 'Template description' },
    ],
    handler: (params, context): CommandResponse => {
      const state = context.getState();

      const sheetId = (params.sheetId as string) || state.activeSheetId;
      if (!sheetId) {
        return { success: false, error: 'No sheet specified and no active sheet' };
      }

      const sheet = state.sheets.find(s => s.id === sheetId);
      if (!sheet) {
        return { success: false, error: `Sheet not found: ${sheetId}` };
      }

      const name = params.name as string;
      const description = (params.description as string) || '';

      state.saveSheetAsTemplate(sheetId, name, description);

      // Find the new template
      const newTemplate = context.getState().customSheetTemplates.find(
        t => t.name === name
      );

      return {
        success: true,
        data: {
          template: newTemplate,
          message: `Sheet saved as template "${name}"`,
        },
      };
    },
  },

  // Delete sheet template
  {
    command: 'document',
    action: 'deleteSheetTemplate',
    description: 'Delete a custom sheet template',
    modifiesState: true,
    params: [
      { name: 'templateId', type: 'string', description: 'Template ID' },
      { name: 'templateName', type: 'string', description: 'Template name (alternative to templateId)' },
    ],
    handler: (params, context): CommandResponse => {
      const state = context.getState();

      let templateId = params.templateId as string | undefined;

      if (!templateId && params.templateName) {
        const name = (params.templateName as string).toLowerCase();
        const template = state.customSheetTemplates.find(
          t => t.name.toLowerCase() === name
        );
        if (template) {
          templateId = template.id;
        }
      }

      if (!templateId) {
        return { success: false, error: 'Template not found' };
      }

      const template = state.customSheetTemplates.find(t => t.id === templateId);
      if (!template) {
        return { success: false, error: `Template not found: ${templateId}` };
      }

      if (template.isBuiltIn) {
        return { success: false, error: 'Cannot delete built-in templates' };
      }

      state.deleteCustomSheetTemplate(templateId);

      return {
        success: true,
        data: {
          deletedTemplateId: templateId,
          deletedTemplateName: template.name,
        },
      };
    },
  },
];
