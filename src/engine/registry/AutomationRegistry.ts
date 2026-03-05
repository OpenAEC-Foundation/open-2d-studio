export interface AutomationHook {
  id: string;
  useHook: () => void;
}

class AutomationRegistry {
  private hooks: AutomationHook[] = [];

  register(hook: AutomationHook): void {
    if (!this.hooks.find(h => h.id === hook.id)) {
      this.hooks.push(hook);
    }
  }

  unregister(id: string): void {
    this.hooks = this.hooks.filter(h => h.id !== id);
  }

  getAll(): AutomationHook[] {
    return this.hooks;
  }
}

export const automationRegistry = new AutomationRegistry();
