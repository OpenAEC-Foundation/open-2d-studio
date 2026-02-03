/**
 * Macro Recording - Record and replay API calls using command-based API
 */

import type { CadEventBus } from './events';

interface RecordedCommand {
  tool: string;
  arguments: Record<string, unknown>;
}

export class MacroRecorder {
  private recording = false;
  private commands: RecordedCommand[] = [];
  private unsub: (() => void) | null = null;

  constructor(private bus: CadEventBus) {}

  get isRecording(): boolean {
    return this.recording;
  }

  startRecording(): void {
    if (this.recording) return;
    this.recording = true;
    this.commands = [];

    const unsubs: (() => void)[] = [];

    // Record entity additions
    unsubs.push(this.bus.on('entity:added', ({ entity }) => {
      if (!this.recording) return;
      const { id, layerId, drawingId, style, visible, locked, ...params } = entity;
      this.commands.push({
        tool: `cad_draw_create_${entity.type}`,
        arguments: params,
      });
    }));

    // Record entity removals (via selection)
    unsubs.push(this.bus.on('entity:removed', () => {
      if (!this.recording) return;
      this.commands.push({
        tool: 'cad_modify_delete',
        arguments: {},
      });
    }));

    // Record selection changes
    unsubs.push(this.bus.on('selection:changed', ({ ids }) => {
      if (!this.recording) return;
      this.commands.push({
        tool: 'cad_selection_set',
        arguments: { ids },
      });
    }));

    // Record viewport changes
    unsubs.push(this.bus.on('viewport:changed', (vp) => {
      if (!this.recording) return;
      if (vp.zoom !== undefined) {
        this.commands.push({
          tool: 'cad_viewport_setZoom',
          arguments: { level: vp.zoom },
        });
      }
    }));

    // Record undo/redo
    unsubs.push(this.bus.on('undo', () => {
      if (!this.recording) return;
      this.commands.push({
        tool: 'cad_history_undo',
        arguments: {},
      });
    }));

    unsubs.push(this.bus.on('redo', () => {
      if (!this.recording) return;
      this.commands.push({
        tool: 'cad_history_redo',
        arguments: {},
      });
    }));

    this.unsub = () => unsubs.forEach(fn => fn());
  }

  stopRecording(): string {
    this.recording = false;
    if (this.unsub) {
      this.unsub();
      this.unsub = null;
    }
    // Return as JSON array of MCP tool calls
    const script = JSON.stringify(this.commands, null, 2);
    this.commands = [];
    return script;
  }

  async runMacro(script: string): Promise<void> {
    const cad = (window as any).cad;
    if (!cad) return;

    try {
      const commands: RecordedCommand[] = JSON.parse(script);
      const { executeMcpTool } = await import('./mcp/server');

      for (const cmd of commands) {
        await executeMcpTool({
          name: cmd.tool,
          arguments: cmd.arguments,
        });
      }
    } catch (error) {
      console.error('Failed to run macro:', error);
    }
  }
}
