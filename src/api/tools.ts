/**
 * Tools API - Tool state control
 */

import type { AppState } from '../state/appStore';
import type { ToolType } from '../types/geometry';

export class ToolsApi {
  constructor(private getState: () => AppState) {}

  getActive(): ToolType {
    return this.getState().activeTool;
  }

  setActive(tool: ToolType): void {
    this.getState().switchToolAndCancelCommand(tool);
  }

  getMode(tool: string): string | undefined {
    const state = this.getState();
    switch (tool) {
      case 'circle': return state.circleMode;
      case 'rectangle': return state.rectangleMode;
      case 'arc': return state.arcMode;
      case 'ellipse': return state.ellipseMode;
      case 'dimension': return state.dimensionMode;
      default: return undefined;
    }
  }

  setMode(tool: string, mode: string): void {
    const state = this.getState();
    switch (tool) {
      case 'circle': state.setCircleMode(mode as any); break;
      case 'rectangle': state.setRectangleMode(mode as any); break;
      case 'arc': state.setArcMode(mode as any); break;
      case 'ellipse': state.setEllipseMode(mode as any); break;
      case 'dimension': state.setDimensionMode(mode as any); break;
    }
  }
}
