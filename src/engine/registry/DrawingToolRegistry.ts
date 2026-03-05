import type { Point } from '../../types/geometry';

export interface ToolHandler {
  toolName: string;
  handleClick: (snappedPos: Point, shiftKey: boolean) => boolean;
  handleMouseMove: (snappedPos: Point, shiftKey: boolean) => void;
  handleCancel: () => void;
  hasPendingState: () => boolean;
  getBasePoint?: () => Point | undefined;
}

class DrawingToolRegistry {
  private tools = new Map<string, ToolHandler>();

  register(handler: ToolHandler): void { this.tools.set(handler.toolName, handler); }
  unregister(toolName: string): void { this.tools.delete(toolName); }
  get(toolName: string): ToolHandler | undefined { return this.tools.get(toolName); }
  has(toolName: string): boolean { return this.tools.has(toolName); }
  getToolNames(): string[] { return Array.from(this.tools.keys()); }
  hasAnyPendingState(): boolean {
    for (const handler of this.tools.values()) {
      if (handler.hasPendingState()) return true;
    }
    return false;
  }
}

export const drawingToolRegistry = new DrawingToolRegistry();
