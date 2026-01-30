/**
 * Snap & Grid API - Snap and grid configuration
 */

import type { AppState } from '../state/appStore';
import type { SnapType } from '../types/geometry';

export class SnapApi {
  constructor(private getState: () => AppState) {}

  get enabled(): boolean {
    return this.getState().snapEnabled;
  }

  setEnabled(val: boolean): void {
    const state = this.getState();
    if (state.snapEnabled !== val) state.toggleSnap();
  }

  getTypes(): SnapType[] {
    return [...this.getState().activeSnaps];
  }

  setTypes(types: SnapType[]): void {
    this.getState().setActiveSnaps(types);
  }

  get tolerance(): number {
    return this.getState().snapTolerance;
  }

  setTolerance(val: number): void {
    this.getState().setSnapTolerance(val);
  }

  get orthoMode(): boolean {
    return this.getState().orthoMode;
  }

  setOrthoMode(val: boolean): void {
    const state = this.getState();
    if (state.orthoMode !== val) state.toggleOrthoMode();
  }

  get polarTracking(): boolean {
    return this.getState().polarTrackingEnabled;
  }

  setPolarTracking(val: boolean): void {
    const state = this.getState();
    if (state.polarTrackingEnabled !== val) state.togglePolarTracking();
  }

  get polarAngle(): number {
    return this.getState().polarAngleIncrement;
  }

  setPolarAngle(degrees: number): void {
    this.getState().setPolarAngleIncrement(degrees);
  }
}

export class GridApi {
  constructor(private getState: () => AppState) {}

  get visible(): boolean {
    return this.getState().gridVisible;
  }

  setVisible(val: boolean): void {
    const state = this.getState();
    if (state.gridVisible !== val) state.toggleGrid();
  }

  get size(): number {
    return this.getState().gridSize;
  }

  setSize(val: number): void {
    this.getState().setGridSize(val);
  }
}
