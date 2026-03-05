/**
 * DrawingStandardsDialog - Dialog for managing drawing standards
 *
 * Provides tools to enforce consistent drawing standards:
 * - Grid Dimension: automatically place dimension lines between gridlines
 * - Material Hatching: assign hatch patterns to material categories
 */

import { Fragment, useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { X, Save, Upload, Trash2, Pencil, ChevronDown, ChevronRight, Plus, RotateCcw, Eye, EyeOff } from 'lucide-react';
import { useAppStore } from '../../../state/appStore';
import type { GridlineShape, Point, PlanSubtype } from '../../../types/geometry';
import { MATERIAL_CATEGORIES, PLAN_SUBTYPE_CONFIG } from '../../../types/geometry';
import type { DimensionShape } from '../../../types/dimension';
import type { MaterialHatchTemplate, MaterialHatchSetting } from '../../../types/hatch';
import { BUILTIN_PATTERNS } from '../../../types/hatch';
import type { UnitSettings } from '../../../units/types';
import { DIM_ASSOCIATE_STYLE } from '../../../constants/cadDefaults';
import { calculateDimensionValue, formatDimAssociateValue } from '../../../engine/geometry/DimensionUtils';
import { ALL_IFC_CATEGORIES, IFC_CATEGORY_LABELS, getIfcCategory } from '../../../utils/ifcCategoryUtils';
import { DraggableModal, ModalButton } from '../../shared/DraggableModal';

const TEMPLATE_STORAGE_KEY = 'open2dstudio_material_hatch_templates';

function loadTemplates(): MaterialHatchTemplate[] {
  try {
    const raw = localStorage.getItem(TEMPLATE_STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

function saveTemplates(templates: MaterialHatchTemplate[]): void {
  localStorage.setItem(TEMPLATE_STORAGE_KEY, JSON.stringify(templates));
}

/** Format material label for Drawing Standards display: "Beton (Concrete)" */
function formatMaterialLabel(cat: { label: string; labelEn: string }): string {
  return `${cat.label} (${cat.labelEn})`;
}

const HATCH_TYPE_OPTIONS: { value: MaterialHatchSetting['hatchType']; label: string }[] = [
  { value: 'diagonal', label: 'Diagonal' },
  { value: 'crosshatch', label: 'Crosshatch' },
  { value: 'horizontal', label: 'Horizontal' },
  { value: 'vertical', label: 'Vertical' },
  { value: 'dots', label: 'Dots' },
  { value: 'solid', label: 'Solid' },
  { value: 'none', label: 'None' },
];

/**
 * NumericInput - Local-state numeric input that only commits on blur or Enter.
 * Allows the user to clear and retype values without the input fighting back.
 */
function NumericInput({ value, onCommit, min, className }: {
  value: number | undefined;
  onCommit: (val: number) => void;
  min?: number;
  className?: string;
}) {
  const [localValue, setLocalValue] = useState(value !== undefined ? String(value) : '');

  useEffect(() => {
    setLocalValue(value !== undefined ? String(value) : '');
  }, [value]);

  const commit = () => {
    const parsed = Number(localValue);
    if (!isNaN(parsed) && localValue.trim() !== '') {
      const clamped = min !== undefined ? Math.max(min, parsed) : parsed;
      onCommit(clamped);
      setLocalValue(String(clamped));
    } else {
      // Revert to original value on invalid input
      setLocalValue(value !== undefined ? String(value) : '');
    }
  };

  return (
    <input
      type="text"
      value={localValue}
      onChange={(e) => setLocalValue(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
      className={className}
    />
  );
}

interface DrawingStandardsDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

export function DrawingStandardsDialog({ isOpen, onClose }: DrawingStandardsDialogProps) {
  const gridlineExtension = useAppStore(s => s.gridlineExtension);
  const setGridlineExtension = useAppStore(s => s.setGridlineExtension);
  const gridDimensionLineOffset = useAppStore(s => s.gridDimensionLineOffset);
  const setGridDimensionLineOffset = useAppStore(s => s.setGridDimensionLineOffset);
  const sectionGridlineDimensioning = useAppStore(s => s.sectionGridlineDimensioning);
  const setSectionGridlineDimensioning = useAppStore(s => s.setSectionGridlineDimensioning);
  const pilePlanAutoNumbering = useAppStore(s => s.pilePlanAutoNumbering);
  const setPilePlanAutoNumbering = useAppStore(s => s.setPilePlanAutoNumbering);
  const pilePlanAutoDimensioning = useAppStore(s => s.pilePlanAutoDimensioning);
  const setPilePlanAutoDimensioning = useAppStore(s => s.setPilePlanAutoDimensioning);
  const pilePlanAutoDepthLabel = useAppStore(s => s.pilePlanAutoDepthLabel);
  const setPilePlanAutoDepthLabel = useAppStore(s => s.setPilePlanAutoDepthLabel);
  const materialHatchSettings = useAppStore(s => s.materialHatchSettings);
  const updateMaterialHatchSetting = useAppStore(s => s.updateMaterialHatchSetting);
  const setMaterialHatchSettings = useAppStore(s => s.setMaterialHatchSettings);
  const wallTypes = useAppStore(s => s.wallTypes);
  const slabTypes = useAppStore(s => s.slabTypes);

  // Plan subtype settings
  const planSubtypeSettings = useAppStore(s => s.planSubtypeSettings);
  const updatePlanSubtypeSettings = useAppStore(s => s.updatePlanSubtypeSettings);

  // IFC category visibility
  const shapes = useAppStore(s => s.shapes);
  const activeDrawingId = useAppStore(s => s.activeDrawingId);
  const hiddenIfcCategories = useAppStore(s => s.hiddenIfcCategories);
  const toggleIfcCategoryVisibility = useAppStore(s => s.toggleIfcCategoryVisibility);
  const setHiddenIfcCategories = useAppStore(s => s.setHiddenIfcCategories);

  // Count shapes per IFC category for the active drawing
  const ifcCategoryCounts = useMemo(() => {
    const map = new Map<string, number>();
    for (const cat of ALL_IFC_CATEGORIES) {
      map.set(cat, 0);
    }
    const drawingShapes = shapes.filter(s => s.drawingId === activeDrawingId);
    for (const s of drawingShapes) {
      const cat = getIfcCategory(s);
      if (cat !== 'Other') {
        map.set(cat, (map.get(cat) || 0) + 1);
      }
    }
    return map;
  }, [shapes, activeDrawingId]);

  // Drawing Standards presets
  const drawingStandardsPresets = useAppStore(s => s.drawingStandardsPresets);
  const activeDrawingStandardsId = useAppStore(s => s.activeDrawingStandardsId);
  const saveDrawingStandards = useAppStore(s => s.saveDrawingStandards);
  const loadDrawingStandards = useAppStore(s => s.loadDrawingStandards);
  const deleteDrawingStandards = useAppStore(s => s.deleteDrawingStandards);
  const renameDrawingStandards = useAppStore(s => s.renameDrawingStandards);

  // Preset UI state
  const [showSaveAs, setShowSaveAs] = useState(false);
  const [saveAsName, setSaveAsName] = useState('');
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');

  const activePreset = drawingStandardsPresets.find(p => p.id === activeDrawingStandardsId);

  const [placeBottom, setPlaceBottom] = useState(true);
  const [placeTop, setPlaceTop] = useState(false);
  const [placeLeft, setPlaceLeft] = useState(true);
  const [placeRight, setPlaceRight] = useState(false);
  const [includeTotal, setIncludeTotal] = useState(true);
  const autoGridDimension = useAppStore(s => s.autoGridDimension);
  const setAutoGridDimension = useAppStore(s => s.setAutoGridDimension);
  const prevGridlineCountRef = useRef(0);
  const [templates, setTemplates] = useState<MaterialHatchTemplate[]>(() => loadTemplates());
  const [templateName, setTemplateName] = useState('');

  // Active plan subtype tab (null = no subtype selected)
  const [activeSubtype, setActiveSubtype] = useState<PlanSubtype | null>(null);

  // Collapsed state for material category groups (all expanded by default)
  const [collapsedCategories, setCollapsedCategories] = useState<Set<string>>(new Set());

  const toggleCategoryCollapse = useCallback((catId: string) => {
    setCollapsedCategories(prev => {
      const next = new Set(prev);
      if (next.has(catId)) next.delete(catId);
      else next.add(catId);
      return next;
    });
  }, []);

  // Gather all unique materials from wallTypes and slabTypes, grouped by category
  const materialsByCategory = useMemo(() => {
    const map = new Map<string, { name: string; source: 'wall' | 'slab' }[]>();
    // Initialize all categories
    for (const cat of MATERIAL_CATEGORIES) {
      map.set(cat.id, []);
    }
    // Collect from wallTypes
    const seenNames = new Set<string>();
    for (const wt of wallTypes) {
      if (!seenNames.has(wt.name)) {
        seenNames.add(wt.name);
        const list = map.get(wt.material) || [];
        list.push({ name: wt.name, source: 'wall' });
        map.set(wt.material, list);
      }
    }
    // Collect from slabTypes (only add names not already seen)
    for (const st of slabTypes) {
      if (!seenNames.has(st.name)) {
        seenNames.add(st.name);
        const list = map.get(st.material) || [];
        list.push({ name: st.name, source: 'slab' });
        map.set(st.material, list);
      }
    }
    return map;
  }, [wallTypes, slabTypes]);

  /** Check if a material has a custom (non-inherited) hatch setting */
  const hasMaterialOverride = useCallback((materialName: string) => {
    return materialName in materialHatchSettings;
  }, [materialHatchSettings]);

  /** Get effective hatch setting for a material (own override or category default) */
  const getEffectiveSetting = useCallback((materialName: string, categoryId: string): MaterialHatchSetting => {
    // If the material has its own override, use that
    if (materialName in materialHatchSettings) {
      return materialHatchSettings[materialName];
    }
    // Otherwise fall back to category default
    return materialHatchSettings[categoryId] || { hatchType: 'none' as const, hatchAngle: 45, hatchSpacing: 50 };
  }, [materialHatchSettings]);

  /** Reset a material's hatch to inherit from its category */
  const resetToCategory = useCallback((materialName: string) => {
    // Remove the material-specific entry from settings
    const newSettings = { ...materialHatchSettings };
    delete newSettings[materialName];
    setMaterialHatchSettings(newSettings);
  }, [materialHatchSettings, setMaterialHatchSettings]);

  /** Helper: create a DimensionShape for grid dimensioning using DimAssociate style */
  const makeDim = useCallback((
    p1: Point, p2: Point, offset: number, direction: 'horizontal' | 'vertical',
    drawingId: string, layerId: string, _style: DimensionShape['style'], _unitSettings: UnitSettings
  ): DimensionShape => {
    const value = calculateDimensionValue([p1, p2], 'linear', direction);
    const formattedValue = formatDimAssociateValue(value);
    return {
      id: crypto.randomUUID(),
      type: 'dimension',
      layerId, drawingId,
      style: { strokeColor: '#000000', strokeWidth: 2.5, lineStyle: 'solid' as const },
      visible: true, locked: false,
      dimensionType: 'linear',
      points: [p1, p2],
      dimensionLineOffset: offset,
      linearDirection: direction,
      value: formattedValue,
      valueOverridden: false,
      dimensionStyle: { ...DIM_ASSOCIATE_STYLE },
      isGridDimension: true,
      dimensionStyleName: 'DimAssociate',
    };
  }, []);

  const handleGridDimension = useCallback(() => {
    const state = useAppStore.getState();
    const { shapes, activeDrawingId, activeLayerId, currentStyle, addShapes, unitSettings } = state;
    const storeGridlineExtension = state.gridlineExtension;
    const storeDimLineOffset = state.gridDimensionLineOffset;

    if (!activeDrawingId) return;

    // First remove any existing auto-generated grid dimensions
    const existingGridDims = shapes.filter(
      s => s.type === 'dimension' && s.drawingId === activeDrawingId &&
        ((s as DimensionShape).isGridDimension === true)
    );
    if (existingGridDims.length > 0) {
      state.deleteShapes(existingGridDims.map(s => s.id));
    }

    const gridlines = shapes.filter(
      (s): s is GridlineShape => s.type === 'gridline' && s.drawingId === activeDrawingId
    );
    if (gridlines.length < 2) return;

    const isVert = (g: GridlineShape) => Math.abs(g.end.y - g.start.y) > Math.abs(g.end.x - g.start.x);
    const verticals = gridlines.filter(isVert);
    const horizontals = gridlines.filter(g => !isVert(g));

    // Calculate scale-adjusted offsets (matches renderer scaleFactor = LINE_DASH_REFERENCE_SCALE / drawingScale)
    const drawingScale = state.drawings.find(d => d.id === activeDrawingId)?.scale || 0.02;
    const scaleFactor = 0.01 / drawingScale;
    const scaledExt = storeGridlineExtension * scaleFactor;

    // Row offset between total and span dimension lines (300mm default)
    const rowOffset = storeDimLineOffset * scaleFactor;

    /**
     * Compute the bubble inner edge position for a gridline on a specific side.
     * This is where the bubble circle meets the gridline extension, at distance
     * `scaledExt` from the endpoint (NOT the bubble center).
     */
    const getBubbleInnerEdge = (g: GridlineShape, endpointSide: 'start' | 'end'): Point => {
      const angle = Math.atan2(g.end.y - g.start.y, g.end.x - g.start.x);
      const dx = Math.cos(angle);
      const dy = Math.sin(angle);
      if (endpointSide === 'start') {
        return {
          x: g.start.x - dx * scaledExt,
          y: g.start.y - dy * scaledExt,
        };
      } else {
        return {
          x: g.end.x + dx * scaledExt,
          y: g.end.y + dy * scaledExt,
        };
      }
    };

    const newDims: DimensionShape[] = [];

    // Vertical gridlines - horizontal dimensions (bottom / top)
    // Measurement points are placed at the bubble inner edge positions so the
    // total dimension line sits at the intersection of bubble and gridline.
    if (verticals.length >= 2) {
      const sorted = [...verticals].sort((a, b) => (a.start.x + a.end.x) / 2 - (b.start.x + b.end.x) / 2);

      const placeSides: { sideKey: 'minY' | 'maxY'; sign: number }[] = [];
      if (placeBottom) placeSides.push({ sideKey: 'minY', sign: -1 });
      if (placeTop) placeSides.push({ sideKey: 'maxY', sign: 1 });

      for (const side of placeSides) {
        // Compute bubble inner edge Y for each gridline on the relevant side
        const bubbleEdges = sorted.map(g => {
          const minYSide: 'start' | 'end' = g.start.y <= g.end.y ? 'start' : 'end';
          const maxYSide: 'start' | 'end' = g.start.y <= g.end.y ? 'end' : 'start';
          const endpointSide = side.sideKey === 'minY' ? minYSide : maxYSide;
          return getBubbleInnerEdge(g, endpointSide);
        });

        // Pick the most extreme bubble inner edge Y for the dimension reference line
        const refY = side.sideKey === 'minY'
          ? Math.min(...bubbleEdges.map(bc => bc.y))
          : Math.max(...bubbleEdges.map(bc => bc.y));

        // Total dimension: measurement points at bubble inner edge Y, offset = 0
        if (includeTotal && sorted.length >= 2) {
          const x1 = (sorted[0].start.x + sorted[0].end.x) / 2;
          const x2 = (sorted[sorted.length - 1].start.x + sorted[sorted.length - 1].end.x) / 2;
          newDims.push(makeDim(
            { x: x1, y: refY }, { x: x2, y: refY },
            0, 'horizontal',
            activeDrawingId, activeLayerId, currentStyle, unitSettings
          ));
        }

        // Span dimensions: offset one row INWARD (between gridlines and total dim)
        const spanOffset = includeTotal ? -side.sign * rowOffset : 0;
        for (let i = 0; i < sorted.length - 1; i++) {
          const x1 = (sorted[i].start.x + sorted[i].end.x) / 2;
          const x2 = (sorted[i + 1].start.x + sorted[i + 1].end.x) / 2;
          newDims.push(makeDim(
            { x: x1, y: refY }, { x: x2, y: refY },
            spanOffset, 'horizontal',
            activeDrawingId, activeLayerId, currentStyle, unitSettings
          ));
        }
      }
    }

    // Horizontal gridlines - vertical dimensions (left / right)
    if (horizontals.length >= 2) {
      const sorted = [...horizontals].sort((a, b) => (a.start.y + a.end.y) / 2 - (b.start.y + b.end.y) / 2);

      const placeSides: { sideKey: 'minX' | 'maxX'; sign: number }[] = [];
      if (placeLeft) placeSides.push({ sideKey: 'minX', sign: -1 });
      if (placeRight) placeSides.push({ sideKey: 'maxX', sign: 1 });

      for (const side of placeSides) {
        // Compute bubble inner edge X for each gridline on the relevant side
        const bubbleEdges = sorted.map(g => {
          const minXSide: 'start' | 'end' = g.start.x <= g.end.x ? 'start' : 'end';
          const maxXSide: 'start' | 'end' = g.start.x <= g.end.x ? 'end' : 'start';
          const endpointSide = side.sideKey === 'minX' ? minXSide : maxXSide;
          return getBubbleInnerEdge(g, endpointSide);
        });

        // Pick the most extreme bubble inner edge X for the dimension reference line
        const refX = side.sideKey === 'minX'
          ? Math.min(...bubbleEdges.map(bc => bc.x))
          : Math.max(...bubbleEdges.map(bc => bc.x));

        // Total dimension: measurement points at bubble inner edge X, offset = 0
        if (includeTotal && sorted.length >= 2) {
          const y1 = (sorted[0].start.y + sorted[0].end.y) / 2;
          const y2 = (sorted[sorted.length - 1].start.y + sorted[sorted.length - 1].end.y) / 2;
          newDims.push(makeDim(
            { x: refX, y: y1 }, { x: refX, y: y2 },
            0, 'vertical',
            activeDrawingId, activeLayerId, currentStyle, unitSettings
          ));
        }

        // Span dimensions: offset one row INWARD (between gridlines and total dim)
        const spanOffset = includeTotal ? -side.sign * rowOffset : 0;
        for (let i = 0; i < sorted.length - 1; i++) {
          const y1 = (sorted[i].start.y + sorted[i].end.y) / 2;
          const y2 = (sorted[i + 1].start.y + sorted[i + 1].end.y) / 2;
          newDims.push(makeDim(
            { x: refX, y: y1 }, { x: refX, y: y2 },
            spanOffset, 'vertical',
            activeDrawingId, activeLayerId, currentStyle, unitSettings
          ));
        }
      }
    }

    if (newDims.length > 0) {
      addShapes(newDims);
    }
  }, [placeBottom, placeTop, placeLeft, placeRight, includeTotal, makeDim]);

  // Auto-trigger: the auto-dimension is now handled at the store level
  // via useGridlineDrawing and the GridlinePlusButton, but we keep
  // a subscription here for the dialog-level auto-regenerate toggle
  useEffect(() => {
    if (!autoGridDimension || !isOpen) return;
    const s = useAppStore.getState();
    prevGridlineCountRef.current = s.shapes.filter(
      sh => sh.type === 'gridline' && sh.drawingId === s.activeDrawingId
    ).length;

    const unsubscribe = useAppStore.subscribe((state) => {
      const count = state.shapes.filter(
        sh => sh.type === 'gridline' && sh.drawingId === state.activeDrawingId
      ).length;
      if (count > prevGridlineCountRef.current && count >= 2) {
        setTimeout(() => handleGridDimension(), 50);
      }
      prevGridlineCountRef.current = count;
    });
    return () => unsubscribe();
  }, [autoGridDimension, isOpen, handleGridDimension]);

  return (
    <DraggableModal
      isOpen={isOpen}
      onClose={onClose}
      title="Drawing Standards"
      width={640}
      footer={
        <ModalButton onClick={onClose}>Close</ModalButton>
      }
    >
      {/* Content */}
      <div className="p-4 space-y-4 overflow-y-auto">

        {/* ============================================================ */}
        {/* Drawing Standards Type Selector */}
        {/* ============================================================ */}
        <div className="space-y-2">
          <h3 className="text-xs font-semibold text-cad-text uppercase tracking-wide">Type</h3>
          <div className="flex items-center gap-2">
            {/* Preset dropdown */}
            <div className="relative flex-1">
              <select
                value={activeDrawingStandardsId}
                onChange={(e) => loadDrawingStandards(e.target.value)}
                className="w-full h-7 px-2 pr-6 text-xs bg-cad-bg border border-cad-border text-cad-text rounded appearance-none cursor-pointer"
              >
                {drawingStandardsPresets.map(preset => (
                  <option key={preset.id} value={preset.id}>{preset.name}</option>
                ))}
              </select>
              <ChevronDown size={12} className="absolute right-2 top-1/2 -translate-y-1/2 text-cad-text-dim pointer-events-none" />
            </div>

            {/* Rename button */}
            <button
              onClick={() => {
                if (activePreset) {
                  setRenamingId(activePreset.id);
                  setRenameValue(activePreset.name);
                }
              }}
              disabled={!activePreset || activePreset.isDefault}
              className="h-7 w-7 flex items-center justify-center text-cad-text-secondary hover:bg-cad-hover border border-cad-border rounded disabled:opacity-30 disabled:cursor-not-allowed"
              title="Rename preset"
            >
              <Pencil size={12} />
            </button>

            {/* Save As button */}
            <button
              onClick={() => { setShowSaveAs(true); setSaveAsName(''); }}
              className="h-7 px-2 text-xs bg-cad-accent/20 border border-cad-accent/50 text-cad-accent hover:bg-cad-accent/30 rounded flex items-center gap-1"
              title="Save current settings as new preset"
            >
              <Plus size={12} /> Save As
            </button>

            {/* Delete button */}
            <button
              onClick={() => {
                if (activePreset && !activePreset.isDefault) {
                  deleteDrawingStandards(activePreset.id);
                }
              }}
              disabled={!activePreset || activePreset.isDefault}
              className="h-7 w-7 flex items-center justify-center text-red-400 hover:bg-red-500/20 border border-cad-border rounded disabled:opacity-30 disabled:cursor-not-allowed"
              title="Delete preset"
            >
              <Trash2 size={12} />
            </button>
          </div>

          {/* Save As inline form */}
          {showSaveAs && (
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={saveAsName}
                onChange={(e) => setSaveAsName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && saveAsName.trim()) {
                    saveDrawingStandards(saveAsName.trim());
                    setShowSaveAs(false);
                    setSaveAsName('');
                  } else if (e.key === 'Escape') {
                    setShowSaveAs(false);
                  }
                }}
                placeholder="New preset name..."
                className="flex-1 h-7 px-2 text-xs bg-cad-bg border border-cad-border text-cad-text rounded"
                autoFocus
              />
              <button
                onClick={() => {
                  if (saveAsName.trim()) {
                    saveDrawingStandards(saveAsName.trim());
                    setShowSaveAs(false);
                    setSaveAsName('');
                  }
                }}
                disabled={!saveAsName.trim()}
                className="h-7 px-3 text-xs bg-cad-accent/20 border border-cad-accent/50 text-cad-accent hover:bg-cad-accent/30 rounded disabled:opacity-30"
              >
                Save
              </button>
              <button
                onClick={() => setShowSaveAs(false)}
                className="h-7 px-2 text-xs bg-cad-bg border border-cad-border text-cad-text-secondary hover:bg-cad-hover rounded"
              >
                Cancel
              </button>
            </div>
          )}

          {/* Rename inline form */}
          {renamingId && (
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && renameValue.trim()) {
                    renameDrawingStandards(renamingId, renameValue.trim());
                    setRenamingId(null);
                  } else if (e.key === 'Escape') {
                    setRenamingId(null);
                  }
                }}
                placeholder="Preset name..."
                className="flex-1 h-7 px-2 text-xs bg-cad-bg border border-cad-border text-cad-text rounded"
                autoFocus
              />
              <button
                onClick={() => {
                  if (renameValue.trim()) {
                    renameDrawingStandards(renamingId, renameValue.trim());
                    setRenamingId(null);
                  }
                }}
                disabled={!renameValue.trim()}
                className="h-7 px-3 text-xs bg-cad-accent/20 border border-cad-accent/50 text-cad-accent hover:bg-cad-accent/30 rounded disabled:opacity-30"
              >
                Rename
              </button>
              <button
                onClick={() => setRenamingId(null)}
                className="h-7 px-2 text-xs bg-cad-bg border border-cad-border text-cad-text-secondary hover:bg-cad-hover rounded"
              >
                Cancel
              </button>
            </div>
          )}
        </div>

        <hr className="border-cad-border" />

        {/* ============================================================ */}
        {/* Grid Dimensioning */}
        {/* ============================================================ */}
        <div className="space-y-2">
          <h3 className="text-xs font-semibold text-cad-text uppercase tracking-wide">Grid Dimensioning</h3>

          {/* Dimension line offset (persisted in Drawing Standards) */}
          <div className="flex items-center gap-3">
            <label className="text-xs text-cad-text-secondary w-36">Dim line offset (mm)</label>
            <NumericInput
              value={gridDimensionLineOffset}
              onCommit={(v) => setGridDimensionLineOffset(v)}
              min={50}
              className="flex-1 h-7 px-2 text-xs bg-cad-bg border border-cad-border text-cad-text rounded"
            />
          </div>
          <p className="text-[10px] text-cad-text-dim">
            Distance between dimension line rows. Total dimension starts at the gridline bubble edge; individual spans are offset by this value.
          </p>

          {/* Side selection */}
          <div className="text-[10px] text-cad-text-dim mb-1">Placement sides:</div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1">
            <label className="flex items-center gap-2 text-xs text-cad-text-secondary">
              <input type="checkbox" checked={placeBottom} onChange={(e) => setPlaceBottom(e.target.checked)} /> Bottom
            </label>
            <label className="flex items-center gap-2 text-xs text-cad-text-secondary">
              <input type="checkbox" checked={placeTop} onChange={(e) => setPlaceTop(e.target.checked)} /> Top
            </label>
            <label className="flex items-center gap-2 text-xs text-cad-text-secondary">
              <input type="checkbox" checked={placeLeft} onChange={(e) => setPlaceLeft(e.target.checked)} /> Left
            </label>
            <label className="flex items-center gap-2 text-xs text-cad-text-secondary">
              <input type="checkbox" checked={placeRight} onChange={(e) => setPlaceRight(e.target.checked)} /> Right
            </label>
          </div>

          {/* Total dimension toggle */}
          <label className="flex items-center gap-2 text-xs text-cad-text-secondary">
            <input type="checkbox" checked={includeTotal} onChange={(e) => setIncludeTotal(e.target.checked)} /> Include total dimension
          </label>

          <button
            onClick={handleGridDimension}
            className="w-full h-8 text-xs bg-cad-accent/20 border border-cad-accent/50 text-cad-accent hover:bg-cad-accent/30 rounded"
          >
            Generate Grid Dimensions
          </button>

          {/* Auto-trigger */}
          <label className="flex items-center gap-2 text-xs text-cad-text-secondary">
            <input type="checkbox" checked={autoGridDimension} onChange={(e) => setAutoGridDimension(e.target.checked)} /> Auto-regenerate when gridlines change
          </label>
        </div>

        <hr className="border-cad-border" />

        {/* Gridline Settings */}
        <div className="space-y-2">
          <h3 className="text-xs font-semibold text-cad-text uppercase tracking-wide">Gridline Settings</h3>
          <div className="flex items-center gap-3">
            <label className="text-xs text-cad-text-secondary w-28">Extension (mm)</label>
            <NumericInput
              value={gridlineExtension}
              onCommit={(v) => setGridlineExtension(v)}
              min={0}
              className="flex-1 h-7 px-2 text-xs bg-cad-bg border border-cad-border text-cad-text rounded"
            />
          </div>
          <p className="text-[10px] text-cad-text-dim">
            Distance the gridline extends beyond its start/end points before the bubble circle appears.
          </p>

          {/* Section Gridline Dimensioning */}
          <label className="flex items-center gap-2 text-xs text-cad-text-secondary">
            <input type="checkbox" checked={sectionGridlineDimensioning} onChange={(e) => setSectionGridlineDimensioning(e.target.checked)} /> Section gridline dimensioning
          </label>
          <p className="text-[10px] text-cad-text-dim">
            When enabled, dimension lines are automatically placed between gridlines in section views to show spacing.
          </p>
        </div>

        <hr className="border-cad-border" />

        {/* ============================================================ */}
        {/* Material Hatching (compact table with collapsible categories) */}
        {/* ============================================================ */}
        <div className="space-y-2">
          <h3 className="text-xs font-semibold text-cad-text uppercase tracking-wide">Material Hatching</h3>
          <p className="text-[10px] text-cad-text-dim">
            Assign hatch patterns to material categories and individual materials. Individual materials inherit from their category unless overridden.
          </p>

          <div className="border border-cad-border rounded overflow-hidden">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-cad-bg text-cad-text-dim text-[10px] uppercase tracking-wide">
                  <th className="text-left px-2 py-1.5 font-semibold border-b border-cad-border">Material</th>
                  <th className="text-left px-1 py-1.5 font-semibold border-b border-cad-border">Pattern</th>
                  <th className="text-left px-1 py-1.5 font-semibold border-b border-cad-border">Type</th>
                  <th className="text-left px-1 py-1.5 font-semibold border-b border-cad-border w-14">Angle</th>
                  <th className="text-left px-1 py-1.5 font-semibold border-b border-cad-border w-14">Spacing</th>
                  <th className="text-center px-1 py-1.5 font-semibold border-b border-cad-border w-8">Color</th>
                  <th className="w-6 border-b border-cad-border"></th>
                </tr>
              </thead>
              <tbody>
                {MATERIAL_CATEGORIES.map((cat, catIdx) => {
                  const catSetting = materialHatchSettings[cat.id] || { hatchType: 'none' as const, hatchAngle: 45, hatchSpacing: 50 };
                  const materials = materialsByCategory.get(cat.id) || [];
                  const isCollapsed = collapsedCategories.has(cat.id);
                  const isLastCat = catIdx === MATERIAL_CATEGORIES.length - 1;
                  return (
                    <Fragment key={cat.id}>
                      {/* Category header row */}
                      <tr className={`bg-cad-bg/60 hover:bg-cad-hover/50 ${!isLastCat || (!isCollapsed && materials.length > 0) ? 'border-b border-cad-border' : ''}`}>
                        <td className="px-2 py-1 text-cad-text font-semibold whitespace-nowrap">
                          <button
                            className="flex items-center gap-1 text-cad-text hover:text-cad-accent"
                            onClick={() => toggleCategoryCollapse(cat.id)}
                            title={isCollapsed ? 'Expand category' : 'Collapse category'}
                          >
                            {isCollapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
                            {formatMaterialLabel(cat)}
                            <span className="text-[10px] text-cad-text-dim font-normal ml-1">({materials.length})</span>
                          </button>
                        </td>
                        <td className="px-1 py-1">
                          <select
                            value={catSetting.hatchPatternId || ''}
                            onChange={(e) => updateMaterialHatchSetting(cat.id, { hatchPatternId: e.target.value || undefined })}
                            className="w-full h-6 px-0.5 text-xs bg-cad-bg border border-cad-border text-cad-text rounded"
                          >
                            <option value="">--</option>
                            {BUILTIN_PATTERNS.map(pat => (
                              <option key={pat.id} value={pat.id}>{pat.name}</option>
                            ))}
                          </select>
                        </td>
                        <td className="px-1 py-1">
                          <select
                            value={catSetting.hatchType}
                            onChange={(e) => updateMaterialHatchSetting(cat.id, { hatchType: e.target.value as MaterialHatchSetting['hatchType'] })}
                            className="w-full h-6 px-0.5 text-xs bg-cad-bg border border-cad-border text-cad-text rounded"
                          >
                            {HATCH_TYPE_OPTIONS.map(opt => (
                              <option key={opt.value} value={opt.value}>{opt.label}</option>
                            ))}
                          </select>
                        </td>
                        <td className="px-1 py-1">
                          <NumericInput
                            value={catSetting.hatchAngle}
                            onCommit={(v) => updateMaterialHatchSetting(cat.id, { hatchAngle: v })}
                            className="w-full h-6 px-1 text-xs bg-cad-bg border border-cad-border text-cad-text rounded"
                          />
                        </td>
                        <td className="px-1 py-1">
                          <NumericInput
                            value={catSetting.hatchSpacing}
                            onCommit={(v) => updateMaterialHatchSetting(cat.id, { hatchSpacing: v })}
                            min={1}
                            className="w-full h-6 px-1 text-xs bg-cad-bg border border-cad-border text-cad-text rounded"
                          />
                        </td>
                        <td className="px-1 py-1 text-center">
                          <input
                            type="color"
                            value={catSetting.hatchColor || '#ffffff'}
                            onChange={(e) => updateMaterialHatchSetting(cat.id, { hatchColor: e.target.value })}
                            className="w-6 h-6 bg-cad-bg border border-cad-border rounded cursor-pointer p-0"
                          />
                        </td>
                        <td></td>
                      </tr>
                      {/* Individual material rows (shown when category is expanded) */}
                      {!isCollapsed && materials.map((mat, matIdx) => {
                        const isOverridden = hasMaterialOverride(mat.name);
                        const effectiveSetting = getEffectiveSetting(mat.name, cat.id);
                        const isLastMat = matIdx === materials.length - 1;
                        return (
                          <tr
                            key={mat.name}
                            className={`bg-cad-surface hover:bg-cad-hover/50 ${!isLastMat || !isLastCat ? 'border-b border-cad-border' : ''}`}
                          >
                            <td className="pl-7 pr-2 py-1 text-cad-text-secondary whitespace-nowrap">
                              <span className={isOverridden ? 'text-cad-text' : 'text-cad-text-secondary italic'}>
                                {mat.name}
                              </span>
                              {!isOverridden && (
                                <span className="text-[9px] text-cad-text-dim ml-1">(inherited)</span>
                              )}
                            </td>
                            <td className="px-1 py-1">
                              <select
                                value={effectiveSetting.hatchPatternId || ''}
                                onChange={(e) => updateMaterialHatchSetting(mat.name, {
                                  ...effectiveSetting,
                                  hatchPatternId: e.target.value || undefined,
                                })}
                                className={`w-full h-6 px-0.5 text-xs border border-cad-border rounded ${isOverridden ? 'bg-cad-bg text-cad-text' : 'bg-cad-bg/50 text-cad-text-secondary'}`}
                              >
                                <option value="">--</option>
                                {BUILTIN_PATTERNS.map(pat => (
                                  <option key={pat.id} value={pat.id}>{pat.name}</option>
                                ))}
                              </select>
                            </td>
                            <td className="px-1 py-1">
                              <select
                                value={effectiveSetting.hatchType}
                                onChange={(e) => updateMaterialHatchSetting(mat.name, {
                                  ...effectiveSetting,
                                  hatchType: e.target.value as MaterialHatchSetting['hatchType'],
                                })}
                                className={`w-full h-6 px-0.5 text-xs border border-cad-border rounded ${isOverridden ? 'bg-cad-bg text-cad-text' : 'bg-cad-bg/50 text-cad-text-secondary'}`}
                              >
                                {HATCH_TYPE_OPTIONS.map(opt => (
                                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                                ))}
                              </select>
                            </td>
                            <td className="px-1 py-1">
                              <NumericInput
                                value={effectiveSetting.hatchAngle}
                                onCommit={(v) => updateMaterialHatchSetting(mat.name, {
                                  ...effectiveSetting,
                                  hatchAngle: v,
                                })}
                                className={`w-full h-6 px-1 text-xs border border-cad-border rounded ${isOverridden ? 'bg-cad-bg text-cad-text' : 'bg-cad-bg/50 text-cad-text-secondary'}`}
                              />
                            </td>
                            <td className="px-1 py-1">
                              <NumericInput
                                value={effectiveSetting.hatchSpacing}
                                onCommit={(v) => updateMaterialHatchSetting(mat.name, {
                                  ...effectiveSetting,
                                  hatchSpacing: v,
                                })}
                                min={1}
                                className={`w-full h-6 px-1 text-xs border border-cad-border rounded ${isOverridden ? 'bg-cad-bg text-cad-text' : 'bg-cad-bg/50 text-cad-text-secondary'}`}
                              />
                            </td>
                            <td className="px-1 py-1 text-center">
                              <input
                                type="color"
                                value={effectiveSetting.hatchColor || '#ffffff'}
                                onChange={(e) => updateMaterialHatchSetting(mat.name, {
                                  ...effectiveSetting,
                                  hatchColor: e.target.value,
                                })}
                                className="w-6 h-6 bg-cad-bg border border-cad-border rounded cursor-pointer p-0"
                              />
                            </td>
                            <td className="px-0 py-1 text-center">
                              {isOverridden && (
                                <button
                                  onClick={() => resetToCategory(mat.name)}
                                  className="p-0.5 text-cad-text-dim hover:text-cad-accent rounded"
                                  title="Reset to category default"
                                >
                                  <RotateCcw size={10} />
                                </button>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        <hr className="border-cad-border" />

        {/* ============================================================ */}
        {/* Material Hatch Templates (save/load) */}
        {/* ============================================================ */}
        <div className="space-y-2">
          <h3 className="text-xs font-semibold text-cad-text uppercase tracking-wide">Material Hatch Templates</h3>
          <p className="text-[10px] text-cad-text-dim">
            Save the current material-hatch settings as a template, or load an existing one.
          </p>

          {/* Save current as template */}
          <div className="flex gap-2">
            <input
              type="text"
              value={templateName}
              onChange={(e) => setTemplateName(e.target.value)}
              placeholder="Template name..."
              className="flex-1 h-7 px-2 text-xs bg-cad-bg border border-cad-border text-cad-text rounded"
            />
            <button
              onClick={() => {
                if (!templateName.trim()) return;
                const newTemplates: MaterialHatchTemplate[] = MATERIAL_CATEGORIES.map(cat => {
                  const s = materialHatchSettings[cat.id] || { hatchType: 'none' as const, hatchAngle: 45, hatchSpacing: 50 };
                  return {
                    id: `tpl-${cat.id}-${Date.now()}`,
                    name: templateName.trim(),
                    material: cat.id,
                    hatchPatternId: s.hatchPatternId,
                    hatchType: (s.hatchType === 'vertical' || s.hatchType === 'dots' || s.hatchType === 'solid' ? 'diagonal' : s.hatchType) as MaterialHatchTemplate['hatchType'],
                    hatchAngle: s.hatchAngle,
                    hatchSpacing: s.hatchSpacing,
                    hatchColor: s.hatchColor,
                  };
                });
                const saved = [...templates, ...newTemplates];
                setTemplates(saved);
                saveTemplates(saved);
                setTemplateName('');
              }}
              disabled={!templateName.trim()}
              className="h-7 px-3 text-xs bg-cad-accent/20 border border-cad-accent/50 text-cad-accent hover:bg-cad-accent/30 rounded disabled:opacity-30 flex items-center gap-1"
            >
              <Save size={12} /> Save
            </button>
          </div>

          {/* Saved templates list */}
          {(() => {
            const templateNames = [...new Set(templates.map(t => t.name))];
            if (templateNames.length === 0) return null;
            return (
              <div className="space-y-1">
                <div className="text-[10px] text-cad-text-dim">Saved templates:</div>
                {templateNames.map(name => (
                  <div key={name} className="flex items-center gap-1">
                    <button
                      onClick={() => {
                        const tpls = templates.filter(t => t.name === name);
                        const newSettings = { ...materialHatchSettings };
                        for (const tpl of tpls) {
                          newSettings[tpl.material] = {
                            hatchType: tpl.hatchType,
                            hatchAngle: tpl.hatchAngle,
                            hatchSpacing: tpl.hatchSpacing,
                            hatchColor: tpl.hatchColor,
                            hatchPatternId: tpl.hatchPatternId,
                          };
                        }
                        setMaterialHatchSettings(newSettings);
                      }}
                      className="flex-1 h-6 px-2 text-xs text-left bg-cad-bg border border-cad-border text-cad-text hover:bg-cad-hover rounded flex items-center gap-1"
                    >
                      <Upload size={10} /> {name}
                    </button>
                    <button
                      onClick={() => {
                        const filtered = templates.filter(t => t.name !== name);
                        setTemplates(filtered);
                        saveTemplates(filtered);
                      }}
                      className="h-6 w-6 text-xs text-red-400 hover:bg-red-500/20 rounded flex items-center justify-center"
                      title="Delete template"
                    >
                      <X size={10} />
                    </button>
                  </div>
                ))}
              </div>
            );
          })()}
        </div>

        <hr className="border-cad-border" />

        {/* ============================================================ */}
        {/* IFC Category Visibility Filter */}
        {/* ============================================================ */}
        <div className="space-y-2">
          <h3 className="text-xs font-semibold text-cad-text uppercase tracking-wide">IFC Category Filter</h3>
          <p className="text-[10px] text-cad-text-dim">
            Show or hide entire IFC categories from the model view. Hidden categories will not be rendered or selectable.
          </p>

          {/* Show All / Hide All buttons */}
          <div className="flex gap-2">
            <button
              onClick={() => setHiddenIfcCategories([])}
              disabled={hiddenIfcCategories.length === 0}
              className="h-6 px-2 text-[10px] bg-cad-bg border border-cad-border text-cad-text hover:bg-cad-hover rounded disabled:opacity-30 flex items-center gap-1"
            >
              <Eye size={10} /> Show All
            </button>
            <button
              onClick={() => setHiddenIfcCategories([...ALL_IFC_CATEGORIES])}
              disabled={hiddenIfcCategories.length === ALL_IFC_CATEGORIES.length}
              className="h-6 px-2 text-[10px] bg-cad-bg border border-cad-border text-cad-text hover:bg-cad-hover rounded disabled:opacity-30 flex items-center gap-1"
            >
              <EyeOff size={10} /> Hide All
            </button>
          </div>

          {/* Category checklist */}
          <div className="border border-cad-border rounded overflow-hidden">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-cad-bg text-cad-text-dim text-[10px] uppercase tracking-wide">
                  <th className="text-left px-2 py-1.5 font-semibold border-b border-cad-border w-6">Vis</th>
                  <th className="text-left px-2 py-1.5 font-semibold border-b border-cad-border">Category</th>
                  <th className="text-left px-2 py-1.5 font-semibold border-b border-cad-border">IFC Class</th>
                  <th className="text-right px-2 py-1.5 font-semibold border-b border-cad-border w-14">Count</th>
                </tr>
              </thead>
              <tbody>
                {ALL_IFC_CATEGORIES.map(cat => {
                  const isVisible = !hiddenIfcCategories.includes(cat);
                  const count = ifcCategoryCounts.get(cat) || 0;
                  return (
                    <tr
                      key={cat}
                      className={`border-b border-cad-border/50 hover:bg-cad-hover cursor-pointer ${!isVisible ? 'opacity-50' : ''}`}
                      onClick={() => toggleIfcCategoryVisibility(cat)}
                    >
                      <td className="px-2 py-1">
                        {isVisible
                          ? <Eye size={12} className="text-cad-accent" />
                          : <EyeOff size={12} className="text-cad-text-dim" />
                        }
                      </td>
                      <td className="px-2 py-1 text-cad-text">
                        {IFC_CATEGORY_LABELS[cat] || cat}
                      </td>
                      <td className="px-2 py-1 text-cad-text-secondary font-mono text-[10px]">
                        {cat}
                      </td>
                      <td className="px-2 py-1 text-right text-cad-text-secondary">
                        {count}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        <hr className="border-cad-border" />

        {/* ============================================================ */}
        {/* Plan Subtype Settings */}
        {/* ============================================================ */}
        <div className="space-y-2">
          <h3 className="text-xs font-semibold text-cad-text uppercase tracking-wide">Plan Subtype Settings</h3>
          <p className="text-[10px] text-cad-text-dim">
            Display options per plan subtype. These settings apply when a drawing is assigned a specific plan subtype.
          </p>

          {/* Subtype selector tabs */}
          <div className="flex gap-1">
            {(['pile-plan', 'structural-plan', 'floor-plan'] as PlanSubtype[]).map((subtype) => {
              const config = PLAN_SUBTYPE_CONFIG[subtype];
              const isActive = activeSubtype === subtype;
              return (
                <button
                  key={subtype}
                  onClick={() => setActiveSubtype(isActive ? null : subtype)}
                  className={`flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded-t border transition-colors ${
                    isActive
                      ? `border-b-0 ${config.color} border-cad-accent/50 font-semibold`
                      : 'border-cad-border/50 text-cad-text-dim hover:text-cad-text hover:bg-cad-hover/50 opacity-60 hover:opacity-100'
                  }`}
                >
                  <span className={`text-[9px] font-medium px-1 rounded ${config.color}`}>
                    {config.abbr}
                  </span>
                  {config.label}
                </button>
              );
            })}
          </div>

          {/* Subtype settings panels */}
          {activeSubtype === null && (
            <div className="border border-cad-border rounded p-4 text-center">
              <p className="text-xs text-cad-text-dim">Select a plan subtype to configure its display settings.</p>
            </div>
          )}

          {/* Pile Plan */}
          {activeSubtype === 'pile-plan' && (
            <div className="border border-cad-border rounded p-2 space-y-1.5">
              <label className="flex items-center gap-2 text-xs text-cad-text-secondary">
                <input
                  type="checkbox"
                  checked={pilePlanAutoNumbering}
                  onChange={(e) => setPilePlanAutoNumbering(e.target.checked)}
                />
                Auto numbering
              </label>
              <p className="text-[10px] text-cad-text-dim ml-5">
                Automatically number and label piles sequentially when placed on a pile plan drawing.
              </p>
              <label className="flex items-center gap-2 text-xs text-cad-text-secondary">
                <input
                  type="checkbox"
                  checked={pilePlanAutoDimensioning}
                  onChange={(e) => setPilePlanAutoDimensioning(e.target.checked)}
                />
                Auto dimensioning
              </label>
              <p className="text-[10px] text-cad-text-dim ml-5">
                Automatically create dimension lines at pile positions relative to gridlines.
              </p>
              <label className="flex items-center gap-2 text-xs text-cad-text-secondary">
                <input
                  type="checkbox"
                  checked={pilePlanAutoDepthLabel}
                  onChange={(e) => setPilePlanAutoDepthLabel(e.target.checked)}
                />
                Auto pile depth label
              </label>
              <p className="text-[10px] text-cad-text-dim ml-5">
                Automatically show pile depth labels next to each pile symbol.
              </p>

              <hr className="border-cad-border/50 my-1" />

              <label className="flex items-center gap-2 text-xs text-cad-text-secondary">
                <input
                  type="checkbox"
                  checked={planSubtypeSettings.pilePlan.showPileTable}
                  onChange={(e) => updatePlanSubtypeSettings({
                    pilePlan: { ...planSubtypeSettings.pilePlan, showPileTable: e.target.checked },
                  })}
                />
                Show pile table
              </label>
              <label className="flex items-center gap-2 text-xs text-cad-text-secondary">
                <input
                  type="checkbox"
                  checked={planSubtypeSettings.pilePlan.showPileGridReferences}
                  onChange={(e) => updatePlanSubtypeSettings({
                    pilePlan: { ...planSubtypeSettings.pilePlan, showPileGridReferences: e.target.checked },
                  })}
                />
                Show pile grid references
              </label>
              <div className="flex items-center gap-3">
                <label className="text-xs text-cad-text-secondary w-32">Pile label font size</label>
                <NumericInput
                  value={planSubtypeSettings.pilePlan.pileLabelFontSize}
                  onCommit={(v) => updatePlanSubtypeSettings({
                    pilePlan: { ...planSubtypeSettings.pilePlan, pileLabelFontSize: v },
                  })}
                  min={4}
                  className="flex-1 h-6 px-1 text-xs bg-cad-bg border border-cad-border text-cad-text rounded"
                />
              </div>
            </div>
          )}

          {/* Structural Plan */}
          {activeSubtype === 'structural-plan' && (
            <div className="border border-cad-border rounded p-2 space-y-1.5">
              <label className="flex items-center gap-2 text-xs text-cad-text-secondary">
                <input
                  type="checkbox"
                  checked={planSubtypeSettings.structuralPlan.showBeamCenterlines}
                  onChange={(e) => updatePlanSubtypeSettings({
                    structuralPlan: { ...planSubtypeSettings.structuralPlan, showBeamCenterlines: e.target.checked },
                  })}
                />
                Show beam centerlines
              </label>
              <label className="flex items-center gap-2 text-xs text-cad-text-secondary">
                <input
                  type="checkbox"
                  checked={planSubtypeSettings.structuralPlan.showColumnGridMarks}
                  onChange={(e) => updatePlanSubtypeSettings({
                    structuralPlan: { ...planSubtypeSettings.structuralPlan, showColumnGridMarks: e.target.checked },
                  })}
                />
                Show column grid marks
              </label>
              <label className="flex items-center gap-2 text-xs text-cad-text-secondary">
                <input
                  type="checkbox"
                  checked={planSubtypeSettings.structuralPlan.showSlabEdges}
                  onChange={(e) => updatePlanSubtypeSettings({
                    structuralPlan: { ...planSubtypeSettings.structuralPlan, showSlabEdges: e.target.checked },
                  })}
                />
                Show slab edges
              </label>
              <label className="flex items-center gap-2 text-xs text-cad-text-secondary">
                <input
                  type="checkbox"
                  checked={planSubtypeSettings.structuralPlan.showLoadArrows}
                  onChange={(e) => updatePlanSubtypeSettings({
                    structuralPlan: { ...planSubtypeSettings.structuralPlan, showLoadArrows: e.target.checked },
                  })}
                />
                Show load arrows
              </label>
              <div className="flex items-center gap-3">
                <label className="text-xs text-cad-text-secondary w-32">Beam label style</label>
                <select
                  value={planSubtypeSettings.structuralPlan.beamLabelStyle}
                  onChange={(e) => updatePlanSubtypeSettings({
                    structuralPlan: { ...planSubtypeSettings.structuralPlan, beamLabelStyle: e.target.value as 'profile-only' | 'profile+material' | 'full' },
                  })}
                  className="flex-1 h-6 px-1 text-xs bg-cad-bg border border-cad-border text-cad-text rounded"
                >
                  <option value="profile-only">Profile only</option>
                  <option value="profile+material">Profile + Material</option>
                  <option value="full">Full</option>
                </select>
              </div>
            </div>
          )}

          {/* Floor Plan */}
          {activeSubtype === 'floor-plan' && (
            <div className="border border-cad-border rounded p-2 space-y-1.5">
              <label className="flex items-center gap-2 text-xs text-cad-text-secondary">
                <input
                  type="checkbox"
                  checked={planSubtypeSettings.floorPlan.showRoomLabels}
                  onChange={(e) => updatePlanSubtypeSettings({
                    floorPlan: { ...planSubtypeSettings.floorPlan, showRoomLabels: e.target.checked },
                  })}
                />
                Show room labels
              </label>
              <label className="flex items-center gap-2 text-xs text-cad-text-secondary">
                <input
                  type="checkbox"
                  checked={planSubtypeSettings.floorPlan.showDoorSwingArcs}
                  onChange={(e) => updatePlanSubtypeSettings({
                    floorPlan: { ...planSubtypeSettings.floorPlan, showDoorSwingArcs: e.target.checked },
                  })}
                />
                Show door swing arcs
              </label>
              <label className="flex items-center gap-2 text-xs text-cad-text-secondary">
                <input
                  type="checkbox"
                  checked={planSubtypeSettings.floorPlan.showWallDimensions}
                  onChange={(e) => updatePlanSubtypeSettings({
                    floorPlan: { ...planSubtypeSettings.floorPlan, showWallDimensions: e.target.checked },
                  })}
                />
                Show wall dimensions
              </label>
              <label className="flex items-center gap-2 text-xs text-cad-text-secondary">
                <input
                  type="checkbox"
                  checked={planSubtypeSettings.floorPlan.showFurniture}
                  onChange={(e) => updatePlanSubtypeSettings({
                    floorPlan: { ...planSubtypeSettings.floorPlan, showFurniture: e.target.checked },
                  })}
                />
                Show furniture
              </label>
              <label className="flex items-center gap-2 text-xs text-cad-text-secondary">
                <input
                  type="checkbox"
                  checked={planSubtypeSettings.floorPlan.showAreaLabels}
                  onChange={(e) => updatePlanSubtypeSettings({
                    floorPlan: { ...planSubtypeSettings.floorPlan, showAreaLabels: e.target.checked },
                  })}
                />
                Show area labels
              </label>
            </div>
          )}
        </div>
      </div>
    </DraggableModal>
  );
}
