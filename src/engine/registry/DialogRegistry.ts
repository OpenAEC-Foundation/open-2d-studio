import type { ComponentType } from 'react';

export interface DialogRegistration {
  id: string;
  Component: ComponentType<any>;
}

class DialogRegistry {
  private dialogs: DialogRegistration[] = [];

  register(dialog: DialogRegistration): void {
    if (!this.dialogs.find(d => d.id === dialog.id)) {
      this.dialogs.push(dialog);
    }
  }

  unregister(id: string): void {
    this.dialogs = this.dialogs.filter(d => d.id !== id);
  }

  getAll(): DialogRegistration[] {
    return this.dialogs;
  }
}

export const dialogRegistry = new DialogRegistry();
