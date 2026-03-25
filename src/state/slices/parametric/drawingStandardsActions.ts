/**
 * Drawing Standards Actions - Extracted from parametricSlice.ts
 *
 * Manages drawing standards settings including:
 * - Drawing Standards Dialog open/close
 * - Gridline extension settings (global and per-scale)
 * - Auto-dimensioning and auto-labeling toggles
 * - Material hatch settings
 * - Plan subtype settings
 * - Drawing Standards presets (save/load/delete/rename)
 */

import type { ParametricState } from '../parametricSlice';
import type { Drawing } from '../../../types/geometry';
import type { MaterialHatchSetting, MaterialHatchSettings, PlanSubtypeSettings } from '../../../types/hatch';
import { DEFAULT_MATERIAL_HATCH_SETTINGS, DEFAULT_PLAN_SUBTYPE_SETTINGS, DEFAULT_GRIDLINE_EXTENSION_PER_SCALE, resolveGridlineExtension } from '../../../types/hatch';

interface FullStore extends ParametricState {
  isModified: boolean;
  drawings: Drawing[];
  activeDrawingId: string;
}

export function createDrawingStandardsActions(
  set: (fn: (state: FullStore) => void) => void,
  _get: () => FullStore
) {
  return {
    // ========================================================================
    // Drawing Standards Dialog
    // ========================================================================

    openDrawingStandardsDialog: () =>
      set((state) => {
        state.drawingStandardsDialogOpen = true;
      }),

    closeDrawingStandardsDialog: () =>
      set((state) => {
        state.drawingStandardsDialogOpen = false;
      }),

    // ========================================================================
    // Gridline Settings
    // ========================================================================

    setGridlineExtension: (value: number) =>
      set((state) => {
        state.gridlineExtension = value;
        // Auto-save to active preset
        const preset = state.drawingStandardsPresets.find(p => p.id === state.activeDrawingStandardsId);
        if (preset) {
          preset.gridlineExtension = value;
        }
      }),

    setGridlineExtensionPerScale: (perScale: Record<string, number>) =>
      set((state) => {
        state.gridlineExtensionPerScale = { ...perScale };
        // Resolve the current extension based on the active drawing's scale
        const activeDrawing = state.drawings?.find((d: any) => d.id === state.activeDrawingId);
        const drawingScale = activeDrawing?.scale;
        state.gridlineExtension = resolveGridlineExtension(perScale, drawingScale);
        // Auto-save to active preset
        const preset = state.drawingStandardsPresets.find(p => p.id === state.activeDrawingStandardsId);
        if (preset) {
          preset.gridlineExtensionPerScale = { ...perScale };
          preset.gridlineExtension = state.gridlineExtension;
        }
      }),

    setGridlineExtensionForScale: (scaleKey: string, value: number) =>
      set((state) => {
        state.gridlineExtensionPerScale[scaleKey] = value;
        // Resolve the current extension based on the active drawing's scale
        const activeDrawing = state.drawings?.find((d: any) => d.id === state.activeDrawingId);
        const drawingScale = activeDrawing?.scale;
        state.gridlineExtension = resolveGridlineExtension(state.gridlineExtensionPerScale, drawingScale);
        // Auto-save to active preset
        const preset = state.drawingStandardsPresets.find(p => p.id === state.activeDrawingStandardsId);
        if (preset) {
          preset.gridlineExtensionPerScale = { ...state.gridlineExtensionPerScale };
          preset.gridlineExtension = state.gridlineExtension;
        }
      }),

    setGridDimensionLineOffset: (value: number) =>
      set((state) => {
        state.gridDimensionLineOffset = value;
        // Auto-save to active preset
        const preset = state.drawingStandardsPresets.find(p => p.id === state.activeDrawingStandardsId);
        if (preset) {
          preset.gridDimensionLineOffset = value;
        }
      }),

    // ========================================================================
    // Auto Settings
    // ========================================================================

    setAutoGridDimension: (value: boolean) =>
      set((state) => {
        state.autoGridDimension = value;
      }),

    setSectionGridlineDimensioning: (value: boolean) =>
      set((state) => {
        state.sectionGridlineDimensioning = value;
        // Auto-save to active preset
        const preset = state.drawingStandardsPresets.find(p => p.id === state.activeDrawingStandardsId);
        if (preset) {
          preset.sectionGridlineDimensioning = value;
        }
      }),

    setPilePlanAutoNumbering: (value: boolean) =>
      set((state) => {
        state.pilePlanAutoNumbering = value;
        const preset = state.drawingStandardsPresets.find(p => p.id === state.activeDrawingStandardsId);
        if (preset) {
          preset.pilePlanAutoNumbering = value;
        }
      }),

    setPilePlanAutoDimensioning: (value: boolean) =>
      set((state) => {
        state.pilePlanAutoDimensioning = value;
        const preset = state.drawingStandardsPresets.find(p => p.id === state.activeDrawingStandardsId);
        if (preset) {
          preset.pilePlanAutoDimensioning = value;
        }
      }),

    setPilePlanAutoDepthLabel: (value: boolean) =>
      set((state) => {
        state.pilePlanAutoDepthLabel = value;
        const preset = state.drawingStandardsPresets.find(p => p.id === state.activeDrawingStandardsId);
        if (preset) {
          preset.pilePlanAutoDepthLabel = value;
        }
      }),

    // ========================================================================
    // Material Hatch Settings (Drawing Standards)
    // ========================================================================

    updateMaterialHatchSetting: (material: string, setting: Partial<MaterialHatchSetting>) =>
      set((state) => {
        const existing = state.materialHatchSettings[material] || DEFAULT_MATERIAL_HATCH_SETTINGS[material] || DEFAULT_MATERIAL_HATCH_SETTINGS.generic;
        state.materialHatchSettings = {
          ...state.materialHatchSettings,
          [material]: { ...existing, ...setting },
        };
        // Auto-save to active preset
        const preset = state.drawingStandardsPresets.find(p => p.id === state.activeDrawingStandardsId);
        if (preset) {
          preset.materialHatchSettings = { ...state.materialHatchSettings };
        }
      }),

    setMaterialHatchSettings: (settings: MaterialHatchSettings) =>
      set((state) => {
        state.materialHatchSettings = settings;
        // Auto-save to active preset
        const preset = state.drawingStandardsPresets.find(p => p.id === state.activeDrawingStandardsId);
        if (preset) {
          preset.materialHatchSettings = { ...settings };
        }
      }),

    updatePlanSubtypeSettings: (settings: Partial<PlanSubtypeSettings>) =>
      set((state) => {
        if (settings.pilePlan) {
          state.planSubtypeSettings.pilePlan = { ...state.planSubtypeSettings.pilePlan, ...settings.pilePlan };
        }
        if (settings.structuralPlan) {
          state.planSubtypeSettings.structuralPlan = { ...state.planSubtypeSettings.structuralPlan, ...settings.structuralPlan };
        }
        if (settings.floorPlan) {
          state.planSubtypeSettings.floorPlan = { ...state.planSubtypeSettings.floorPlan, ...settings.floorPlan };
        }
        if (settings.areaPlan) {
          state.planSubtypeSettings.areaPlan = { ...state.planSubtypeSettings.areaPlan, ...settings.areaPlan };
        }
        const preset = state.drawingStandardsPresets.find(p => p.id === state.activeDrawingStandardsId);
        if (preset) {
          preset.planSubtypeSettings = { ...state.planSubtypeSettings };
        }
      }),

    // ========================================================================
    // Drawing Standards Presets
    // ========================================================================

    saveDrawingStandards: (name: string) => {
      const id = crypto.randomUUID();
      set((state) => {
        state.drawingStandardsPresets.push({
          id,
          name,
          isDefault: false,
          gridlineExtension: state.gridlineExtension,
          gridlineExtensionPerScale: { ...state.gridlineExtensionPerScale },
          gridDimensionLineOffset: state.gridDimensionLineOffset,
          materialHatchSettings: { ...state.materialHatchSettings },
          sectionGridlineDimensioning: state.sectionGridlineDimensioning,
          pilePlanAutoNumbering: state.pilePlanAutoNumbering,
          pilePlanAutoDimensioning: state.pilePlanAutoDimensioning,
          pilePlanAutoDepthLabel: state.pilePlanAutoDepthLabel,
          planSubtypeSettings: { ...state.planSubtypeSettings },
          pileTypes: [...state.pileTypes],
        });
        state.activeDrawingStandardsId = id;
      });
      return id;
    },

    loadDrawingStandards: (id: string) =>
      set((state) => {
        const preset = state.drawingStandardsPresets.find(p => p.id === id);
        if (!preset) return;
        state.activeDrawingStandardsId = id;
        state.gridlineExtensionPerScale = preset.gridlineExtensionPerScale
          ? { ...preset.gridlineExtensionPerScale }
          : { ...DEFAULT_GRIDLINE_EXTENSION_PER_SCALE };
        // Resolve the extension for the current drawing scale
        const activeDrawing = state.drawings?.find((d: any) => d.id === state.activeDrawingId);
        state.gridlineExtension = resolveGridlineExtension(state.gridlineExtensionPerScale, activeDrawing?.scale);
        state.gridDimensionLineOffset = preset.gridDimensionLineOffset ?? 300;
        state.materialHatchSettings = { ...preset.materialHatchSettings };
        state.sectionGridlineDimensioning = preset.sectionGridlineDimensioning ?? true;
        state.pilePlanAutoNumbering = preset.pilePlanAutoNumbering ?? true;
        state.pilePlanAutoDimensioning = preset.pilePlanAutoDimensioning ?? true;
        state.pilePlanAutoDepthLabel = preset.pilePlanAutoDepthLabel ?? true;
        state.planSubtypeSettings = preset.planSubtypeSettings ?? { ...DEFAULT_PLAN_SUBTYPE_SETTINGS };
        if (preset.pileTypes) {
          state.pileTypes = [...preset.pileTypes];
        }
      }),

    deleteDrawingStandards: (id: string) =>
      set((state) => {
        const preset = state.drawingStandardsPresets.find(p => p.id === id);
        if (!preset || preset.isDefault) return;
        state.drawingStandardsPresets = state.drawingStandardsPresets.filter(p => p.id !== id);
        // If deleting the active preset, switch to the default
        if (state.activeDrawingStandardsId === id) {
          const defaultPreset = state.drawingStandardsPresets.find(p => p.isDefault);
          if (defaultPreset) {
            state.activeDrawingStandardsId = defaultPreset.id;
            state.gridlineExtensionPerScale = defaultPreset.gridlineExtensionPerScale
              ? { ...defaultPreset.gridlineExtensionPerScale }
              : { ...DEFAULT_GRIDLINE_EXTENSION_PER_SCALE };
            const activeDrawing2 = state.drawings?.find((d: any) => d.id === state.activeDrawingId);
            state.gridlineExtension = resolveGridlineExtension(state.gridlineExtensionPerScale, activeDrawing2?.scale);
            state.gridDimensionLineOffset = defaultPreset.gridDimensionLineOffset ?? 300;
            state.materialHatchSettings = { ...defaultPreset.materialHatchSettings };
            state.sectionGridlineDimensioning = defaultPreset.sectionGridlineDimensioning ?? true;
            state.pilePlanAutoNumbering = defaultPreset.pilePlanAutoNumbering ?? true;
            state.pilePlanAutoDimensioning = defaultPreset.pilePlanAutoDimensioning ?? true;
            state.pilePlanAutoDepthLabel = defaultPreset.pilePlanAutoDepthLabel ?? true;
            state.planSubtypeSettings = defaultPreset.planSubtypeSettings ?? { ...DEFAULT_PLAN_SUBTYPE_SETTINGS };
            if (defaultPreset.pileTypes) {
              state.pileTypes = [...defaultPreset.pileTypes];
            }
          }
        }
      }),

    renameDrawingStandards: (id: string, name: string) =>
      set((state) => {
        const preset = state.drawingStandardsPresets.find(p => p.id === id);
        if (preset) {
          preset.name = name;
        }
      }),
  };
}
