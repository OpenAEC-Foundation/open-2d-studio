export interface ShortcutHandler {
  keys: string;
  activate: () => void;
}

class KeyboardShortcutRegistry {
  private shortcuts = new Map<string, ShortcutHandler>();

  register(handler: ShortcutHandler): void { this.shortcuts.set(handler.keys, handler); }
  unregister(keys: string): void { this.shortcuts.delete(keys); }
  get(keys: string): ShortcutHandler | undefined { return this.shortcuts.get(keys); }
  getAllKeys(): string[] { return Array.from(this.shortcuts.keys()); }
}

export const keyboardShortcutRegistry = new KeyboardShortcutRegistry();
