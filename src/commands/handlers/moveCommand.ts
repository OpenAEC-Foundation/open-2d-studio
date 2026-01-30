import type { CommandHandler, CommandState, CommandInput, CommandResult } from '../types';
import type { Shape, Point } from '../../types/geometry';

export const moveCommand: CommandHandler = {
  name: 'MOVE',

  start: (state: CommandState, selectedIds: string[]): CommandState => {
    if (selectedIds.length > 0) {
      return {
        ...state,
        activeCommand: 'MOVE',
        phase: 'awaiting_point',
        prompt: 'MOVE Specify base point or [Displacement]:',
        options: ['Displacement'],
        selectedIds: [...selectedIds],
        selectionComplete: true,
        basePoint: null,
        secondPoint: null,
      };
    }

    return {
      ...state,
      activeCommand: 'MOVE',
      phase: 'selecting',
      prompt: 'MOVE Select objects:',
      options: [],
      selectedIds: [],
      selectionComplete: false,
      basePoint: null,
      secondPoint: null,
    };
  },

  handleInput: (
    state: CommandState,
    input: CommandInput,
    shapes: Shape[]
  ): CommandResult => {
    switch (state.phase) {
      case 'selecting':
        if (input.type === 'selection') {
          const newSelection = [...new Set([...state.selectedIds, ...input.ids])];
          return {
            success: true,
            newState: {
              selectedIds: newSelection,
              prompt: `${newSelection.length} object(s) selected. Press Enter when done:`,
            },
          };
        }
        if (input.type === 'enter' && state.selectedIds.length > 0) {
          return {
            success: true,
            newState: {
              phase: 'awaiting_point',
              prompt: 'Specify base point or [Displacement]:',
              options: ['Displacement'],
              selectionComplete: true,
            },
          };
        }
        if (input.type === 'escape') {
          return {
            success: false,
            message: '*Cancel*',
            newState: {
              activeCommand: null,
              phase: 'idle',
              prompt: 'Command:',
              selectedIds: [],
            },
          };
        }
        return { success: false };

      case 'awaiting_point':
        if (input.type === 'point') {
          return {
            success: true,
            newState: {
              basePoint: input.point,
              phase: 'awaiting_second_point',
              prompt: 'Specify second point or <use first point as displacement>:',
              options: [],
            },
          };
        }
        if (input.type === 'option' && input.option.toLowerCase() === 'displacement') {
          return {
            success: true,
            newState: {
              data: { ...state.data, useDisplacement: true },
              prompt: 'Specify displacement <0,0>:',
            },
          };
        }
        if (input.type === 'escape') {
          return {
            success: false,
            message: '*Cancel*',
            newState: {
              activeCommand: null,
              phase: 'idle',
              prompt: 'Command:',
              selectedIds: [],
            },
          };
        }
        return { success: false };

      case 'awaiting_second_point':
        if (input.type === 'point' && state.basePoint) {
          const dx = input.point.x - state.basePoint.x;
          const dy = input.point.y - state.basePoint.y;

          // Calculate moved shapes
          const shapesToUpdate = state.selectedIds.map((id) => {
            const shape = shapes.find((s) => s.id === id);
            if (!shape) return null;

            return {
              id,
              updates: moveShape(shape, dx, dy),
            };
          }).filter(Boolean) as { id: string; updates: Partial<Shape> }[];

          return {
            success: true,
            message: `${state.selectedIds.length} object(s) moved.`,
            shapesToUpdate,
            newState: {
              activeCommand: null,
              phase: 'idle',
              prompt: 'Command:',
              selectedIds: [],
              basePoint: null,
              secondPoint: null,
            },
          };
        }
        if (input.type === 'enter' && state.basePoint) {
          // Use base point as displacement (relative from 0,0)
          const dx = state.basePoint.x;
          const dy = state.basePoint.y;

          const shapesToUpdate = state.selectedIds.map((id) => {
            const shape = shapes.find((s) => s.id === id);
            if (!shape) return null;

            return {
              id,
              updates: moveShape(shape, dx, dy),
            };
          }).filter(Boolean) as { id: string; updates: Partial<Shape> }[];

          return {
            success: true,
            message: `${state.selectedIds.length} object(s) moved.`,
            shapesToUpdate,
            newState: {
              activeCommand: null,
              phase: 'idle',
              prompt: 'Command:',
              selectedIds: [],
              basePoint: null,
            },
          };
        }
        if (input.type === 'escape') {
          return {
            success: false,
            message: '*Cancel*',
            newState: {
              activeCommand: null,
              phase: 'idle',
              prompt: 'Command:',
              selectedIds: [],
            },
          };
        }
        return { success: false };

      default:
        return { success: false };
    }
  },

  getPreview: (
    state: CommandState,
    currentPoint: Point,
    shapes: Shape[]
  ): Shape[] => {
    if (state.phase !== 'awaiting_second_point' || !state.basePoint) {
      return [];
    }

    const dx = currentPoint.x - state.basePoint.x;
    const dy = currentPoint.y - state.basePoint.y;

    return state.selectedIds
      .map((id) => {
        const shape = shapes.find((s) => s.id === id);
        if (!shape) return null;

        const moved = { ...shape, ...moveShape(shape, dx, dy) };
        return {
          ...moved,
          id: `preview-${id}`,
          style: { ...moved.style, strokeColor: '#00ff00' }, // Green preview
        };
      })
      .filter(Boolean) as Shape[];
  },

  cancel: (state: CommandState): CommandState => {
    return {
      ...state,
      activeCommand: null,
      phase: 'idle',
      prompt: 'Command:',
      selectedIds: [],
      basePoint: null,
      secondPoint: null,
    };
  },
};

// Helper function to move a shape
function moveShape(shape: Shape, dx: number, dy: number): Partial<Shape> {
  switch (shape.type) {
    case 'line':
      return {
        start: { x: shape.start.x + dx, y: shape.start.y + dy },
        end: { x: shape.end.x + dx, y: shape.end.y + dy },
      };
    case 'rectangle':
      return {
        topLeft: { x: shape.topLeft.x + dx, y: shape.topLeft.y + dy },
      };
    case 'circle':
      return {
        center: { x: shape.center.x + dx, y: shape.center.y + dy },
      };
    case 'arc':
      return {
        center: { x: shape.center.x + dx, y: shape.center.y + dy },
      };
    case 'ellipse':
      return {
        center: { x: shape.center.x + dx, y: shape.center.y + dy },
      };
    case 'polyline':
      return {
        points: shape.points.map((p) => ({ x: p.x + dx, y: p.y + dy })),
      };
    case 'text':
      return {
        position: { x: shape.position.x + dx, y: shape.position.y + dy },
      };
    case 'point':
      return {
        position: { x: shape.position.x + dx, y: shape.position.y + dy },
      };
    case 'dimension':
      return {
        points: shape.points.map((p: { x: number; y: number }) => ({ x: p.x + dx, y: p.y + dy })),
      };
    default:
      return {};
  }
}
