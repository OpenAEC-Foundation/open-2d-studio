/**
 * useIfcAutoRegenerate - Hook that watches for shape changes
 * and triggers IFC regeneration with a 500ms debounce.
 *
 * Continuously regenerates whenever:
 * - ifcAutoGenerate is enabled (default: true)
 * - The shapes, wallTypes, slabTypes, pileTypes, drawings, or
 *   projectStructure change
 *
 * The IFC is always kept up-to-date regardless of whether the IFC
 * panel or 3D view is open, so that Bonsai sync and file export
 * always have a fresh IFC model.
 */

import { useEffect, useRef } from 'react';
import { useAppStore } from '../state/appStore';

export function useIfcAutoRegenerate(): void {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    // Subscribe to store changes
    const unsubscribe = useAppStore.subscribe((state, prevState) => {
      // Only regenerate if auto-generate is on
      if (!state.ifcAutoGenerate) return;

      // Check if any model data changed
      const shapesChanged = state.shapes !== prevState.shapes;
      const wallTypesChanged = state.wallTypes !== prevState.wallTypes;
      const slabTypesChanged = state.slabTypes !== prevState.slabTypes;
      const pileTypesChanged = state.pileTypes !== prevState.pileTypes;
      const drawingsChanged = state.drawings !== prevState.drawings;
      const projectStructureChanged = state.projectStructure !== prevState.projectStructure;

      if (!shapesChanged && !wallTypesChanged && !slabTypesChanged &&
          !pileTypesChanged && !drawingsChanged && !projectStructureChanged) return;

      // Debounce: clear any pending regeneration
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
      }

      // Schedule regeneration after 500ms
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        // Get latest state and regenerate
        const currentState = useAppStore.getState();
        if (currentState.ifcAutoGenerate) {
          currentState.regenerateIFC();
        }
      }, 500);
    });

    return () => {
      unsubscribe();
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
      }
    };
  }, []);

  // Trigger an initial regeneration on mount so the IFC model is
  // available immediately after app startup.
  useEffect(() => {
    const state = useAppStore.getState();
    if (state.ifcAutoGenerate && state.shapes.length > 0) {
      state.regenerateIFC();
    }
  }, []);
}
