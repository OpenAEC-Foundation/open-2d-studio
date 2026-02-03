/**
 * Snap Command Handlers
 *
 * Snap settings: enable, disable, setTypes, getSettings.
 */

import type { CommandDefinition, CommandResponse } from '../types';
import type { SnapType } from '../../../types/geometry';

export const snapCommands: CommandDefinition[] = [
  // Enable snap
  {
    command: 'snap',
    action: 'enable',
    description: 'Enable snap',
    modifiesState: false,
    params: [],
    handler: (_, context): CommandResponse => {
      const state = context.getState();

      if (!state.snapEnabled) {
        state.toggleSnap();
      }

      return {
        success: true,
        data: { snapEnabled: true },
      };
    },
  },

  // Disable snap
  {
    command: 'snap',
    action: 'disable',
    description: 'Disable snap',
    modifiesState: false,
    params: [],
    handler: (_, context): CommandResponse => {
      const state = context.getState();

      if (state.snapEnabled) {
        state.toggleSnap();
      }

      return {
        success: true,
        data: { snapEnabled: false },
      };
    },
  },

  // Set snap types
  {
    command: 'snap',
    action: 'setTypes',
    description: 'Set active snap types',
    modifiesState: false,
    params: [
      {
        name: 'types',
        type: 'array',
        required: true,
        description: 'Array of snap types to enable',
      },
    ],
    handler: (params, context): CommandResponse => {
      const types = params.types as SnapType[];
      context.getState().setActiveSnaps(types);

      return {
        success: true,
        data: {
          activeSnaps: [...context.getState().activeSnaps],
        },
      };
    },
  },

  // Get snap settings
  {
    command: 'snap',
    action: 'getSettings',
    description: 'Get current snap settings',
    modifiesState: false,
    params: [],
    handler: (_, context): CommandResponse => {
      const state = context.getState();

      return {
        success: true,
        data: {
          snapEnabled: state.snapEnabled,
          activeSnaps: [...state.activeSnaps],
          snapTolerance: state.snapTolerance,
          gridVisible: state.gridVisible,
          gridSize: state.gridSize,
          orthoMode: state.orthoMode,
          polarTrackingEnabled: state.polarTrackingEnabled,
          polarAngleIncrement: state.polarAngleIncrement,
        },
      };
    },
  },

  // Set snap tolerance
  {
    command: 'snap',
    action: 'setTolerance',
    description: 'Set snap tolerance',
    modifiesState: false,
    params: [
      { name: 'tolerance', type: 'number', required: true, min: 1, description: 'Snap tolerance in pixels' },
    ],
    handler: (params, context): CommandResponse => {
      const tolerance = params.tolerance as number;
      context.getState().setSnapTolerance(tolerance);

      return {
        success: true,
        data: { snapTolerance: tolerance },
      };
    },
  },

  // Toggle grid
  {
    command: 'snap',
    action: 'toggleGrid',
    description: 'Toggle grid visibility',
    modifiesState: false,
    params: [
      { name: 'visible', type: 'boolean', description: 'Grid visibility (toggles if not specified)' },
    ],
    handler: (params, context): CommandResponse => {
      const state = context.getState();

      if (params.visible !== undefined) {
        if (state.gridVisible !== params.visible) {
          state.toggleGrid();
        }
      } else {
        state.toggleGrid();
      }

      return {
        success: true,
        data: { gridVisible: context.getState().gridVisible },
      };
    },
  },

  // Set grid size
  {
    command: 'snap',
    action: 'setGridSize',
    description: 'Set grid size',
    modifiesState: false,
    params: [
      { name: 'size', type: 'number', required: true, min: 1, description: 'Grid size in drawing units' },
    ],
    handler: (params, context): CommandResponse => {
      const size = params.size as number;
      context.getState().setGridSize(size);

      return {
        success: true,
        data: { gridSize: size },
      };
    },
  },

  // Toggle ortho mode
  {
    command: 'snap',
    action: 'toggleOrtho',
    description: 'Toggle orthogonal mode',
    modifiesState: false,
    params: [
      { name: 'enabled', type: 'boolean', description: 'Ortho mode state (toggles if not specified)' },
    ],
    handler: (params, context): CommandResponse => {
      const state = context.getState();

      if (params.enabled !== undefined) {
        if (state.orthoMode !== params.enabled) {
          state.toggleOrthoMode();
        }
      } else {
        state.toggleOrthoMode();
      }

      return {
        success: true,
        data: { orthoMode: context.getState().orthoMode },
      };
    },
  },

  // Toggle polar tracking
  {
    command: 'snap',
    action: 'togglePolar',
    description: 'Toggle polar tracking',
    modifiesState: false,
    params: [
      { name: 'enabled', type: 'boolean', description: 'Polar tracking state (toggles if not specified)' },
    ],
    handler: (params, context): CommandResponse => {
      const state = context.getState();

      if (params.enabled !== undefined) {
        if (state.polarTrackingEnabled !== params.enabled) {
          state.togglePolarTracking();
        }
      } else {
        state.togglePolarTracking();
      }

      return {
        success: true,
        data: { polarTrackingEnabled: context.getState().polarTrackingEnabled },
      };
    },
  },

  // Set polar angle
  {
    command: 'snap',
    action: 'setPolarAngle',
    description: 'Set polar tracking angle increment',
    modifiesState: false,
    params: [
      { name: 'angle', type: 'number', required: true, min: 1, max: 90, description: 'Angle increment in degrees' },
    ],
    handler: (params, context): CommandResponse => {
      const angle = params.angle as number;
      context.getState().setPolarAngleIncrement(angle);

      return {
        success: true,
        data: { polarAngleIncrement: angle },
      };
    },
  },
];
