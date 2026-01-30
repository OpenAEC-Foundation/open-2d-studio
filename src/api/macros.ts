/**
 * Macro Recording - Record and replay API calls
 */

import type { CadEventBus } from './events';

export class MacroRecorder {
  private recording = false;
  private lines: string[] = [];
  private unsub: (() => void) | null = null;

  constructor(private bus: CadEventBus) {}

  get isRecording(): boolean {
    return this.recording;
  }

  startRecording(): void {
    if (this.recording) return;
    this.recording = true;
    this.lines = [];

    const unsubs: (() => void)[] = [];

    // Record entity additions
    unsubs.push(this.bus.on('entity:added', ({ entity }) => {
      if (!this.recording) return;
      const { id, layerId, drawingId, style, visible, locked, ...params } = entity;
      this.lines.push(`cad.entities.add('${entity.type}', ${JSON.stringify(params)});`);
    }));

    // Record entity removals
    unsubs.push(this.bus.on('entity:removed', ({ entity }) => {
      if (!this.recording) return;
      this.lines.push(`cad.entities.remove('${entity.id}');`);
    }));

    // Record commands
    unsubs.push(this.bus.on('command:completed', ({ name, params }) => {
      if (!this.recording) return;
      this.lines.push(`cad.commands.execute('${name}', ${JSON.stringify(params)});`);
    }));

    // Record selection changes
    unsubs.push(this.bus.on('selection:changed', ({ ids }) => {
      if (!this.recording) return;
      this.lines.push(`cad.selection.set(${JSON.stringify(ids)});`);
    }));

    // Record viewport changes
    unsubs.push(this.bus.on('viewport:changed', (vp) => {
      if (!this.recording) return;
      this.lines.push(`cad.viewport.set(${JSON.stringify(vp)});`);
    }));

    // Record tool changes
    unsubs.push(this.bus.on('tool:changed', ({ tool }) => {
      if (!this.recording) return;
      this.lines.push(`cad.tools.setActive('${tool}');`);
    }));

    this.unsub = () => unsubs.forEach(fn => fn());
  }

  stopRecording(): string {
    this.recording = false;
    if (this.unsub) {
      this.unsub();
      this.unsub = null;
    }
    const script = this.lines.join('\n');
    this.lines = [];
    return script;
  }

  runMacro(script: string): void {
    // Execute recorded script in the context of window.cad
    const fn = new Function('cad', script);
    fn((window as any).cad);
  }
}
