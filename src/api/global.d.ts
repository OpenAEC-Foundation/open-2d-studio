import type { CadApi } from './index';

declare global {
  interface Window {
    cad: CadApi;
  }
}
