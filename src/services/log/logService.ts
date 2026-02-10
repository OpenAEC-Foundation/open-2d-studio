/**
 * Log Service - Global logger singleton for use outside React components
 */

import { useAppStore } from '../../state/appStore';

export const logger = {
  info: (message: string, source?: string) => {
    useAppStore.getState().addLog('info', message, source);
  },
  warn: (message: string, source?: string) => {
    useAppStore.getState().addLog('warning', message, source);
  },
  error: (message: string, source?: string) => {
    useAppStore.getState().addLog('error', message, source);
  },
  debug: (message: string, source?: string) => {
    useAppStore.getState().addLog('debug', message, source);
  },
};
