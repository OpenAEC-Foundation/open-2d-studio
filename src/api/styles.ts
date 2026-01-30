/**
 * Styles API - Current style and text defaults
 */

import type { AppState } from '../state/appStore';
import type { ShapeStyle } from '../types/geometry';

export class StylesApi {
  constructor(private getState: () => AppState) {}

  getCurrent(): ShapeStyle {
    return { ...this.getState().currentStyle };
  }

  setCurrent(style: Partial<ShapeStyle>): void {
    const state = this.getState();
    state.setCurrentStyle({ ...state.currentStyle, ...style });
  }

  getTextDefaults(): Record<string, any> {
    return { ...this.getState().defaultTextStyle };
  }

  setTextDefaults(style: Record<string, any>): void {
    this.getState().updateDefaultTextStyle(style);
  }
}
