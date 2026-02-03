/**
 * Style Command Handlers
 *
 * Style operations: get, set, getDefaults.
 */

import type { CommandDefinition, CommandResponse } from '../types';
import type { ShapeStyle, LineStyle } from '../../../types/geometry';

export const styleCommands: CommandDefinition[] = [
  // Get current style
  {
    command: 'style',
    action: 'get',
    description: 'Get current drawing style',
    modifiesState: false,
    params: [],
    handler: (_, context): CommandResponse => {
      const state = context.getState();

      return {
        success: true,
        data: {
          style: { ...state.currentStyle },
        },
      };
    },
  },

  // Set current style
  {
    command: 'style',
    action: 'set',
    description: 'Set current drawing style',
    modifiesState: false,
    params: [
      { name: 'strokeColor', type: 'string', description: 'Stroke color (hex)' },
      { name: 'strokeWidth', type: 'number', min: 0.1, description: 'Stroke width' },
      { name: 'lineStyle', type: 'string', enum: ['solid', 'dashed', 'dotted', 'dashdot'], description: 'Line style' },
      { name: 'fillColor', type: 'string', description: 'Fill color (hex or undefined for no fill)' },
    ],
    handler: (params, context): CommandResponse => {
      const state = context.getState();

      const updates: Partial<ShapeStyle> = {};
      if (params.strokeColor !== undefined) updates.strokeColor = params.strokeColor as string;
      if (params.strokeWidth !== undefined) updates.strokeWidth = params.strokeWidth as number;
      if (params.lineStyle !== undefined) updates.lineStyle = params.lineStyle as LineStyle;
      if (params.fillColor !== undefined) updates.fillColor = params.fillColor as string;

      state.setCurrentStyle({ ...state.currentStyle, ...updates });

      return {
        success: true,
        data: {
          style: { ...context.getState().currentStyle },
        },
      };
    },
  },

  // Get text defaults
  {
    command: 'style',
    action: 'getDefaults',
    description: 'Get default text style',
    modifiesState: false,
    params: [],
    handler: (_, context): CommandResponse => {
      const state = context.getState();

      return {
        success: true,
        data: {
          textStyle: { ...state.defaultTextStyle },
          shapeStyle: { ...state.currentStyle },
        },
      };
    },
  },

  // Set text defaults
  {
    command: 'style',
    action: 'setTextDefaults',
    description: 'Set default text style',
    modifiesState: false,
    params: [
      { name: 'fontSize', type: 'number', min: 1, description: 'Default font size' },
      { name: 'fontFamily', type: 'string', description: 'Default font family' },
      { name: 'color', type: 'string', description: 'Default text color' },
      { name: 'bold', type: 'boolean', description: 'Default bold state' },
      { name: 'italic', type: 'boolean', description: 'Default italic state' },
    ],
    handler: (params, context): CommandResponse => {
      const state = context.getState();

      const updates: Record<string, unknown> = {};
      if (params.fontSize !== undefined) updates.fontSize = params.fontSize;
      if (params.fontFamily !== undefined) updates.fontFamily = params.fontFamily;
      if (params.color !== undefined) updates.color = params.color;
      if (params.bold !== undefined) updates.bold = params.bold;
      if (params.italic !== undefined) updates.italic = params.italic;

      state.updateDefaultTextStyle(updates);

      return {
        success: true,
        data: {
          textStyle: { ...context.getState().defaultTextStyle },
        },
      };
    },
  },
];
