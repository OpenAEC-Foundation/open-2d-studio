/**
 * Tool Slice - Manages active tool, drawing modes, and style
 */

import type { ToolType, ShapeStyle, Point, DrawingPreview, DefaultTextStyle } from './types';
import type { DimensionType } from '../../types/dimension';
import type { LeaderConfig } from '../../types/geometry';
import { defaultStyle } from './types';
import { DIMENSION_STYLE_PRESETS } from '../../constants/cadDefaults';
import { setSetting } from '../../utils/settings';

// ============================================================================
// State Interface
// ============================================================================

export interface ToolState {
  activeTool: ToolType;
  lastTool: ToolType | null;  // Last used drawing/modify tool for "Repeat" feature
  circleMode: 'center-radius' | 'center-diameter' | '2point' | '3point';
  rectangleMode: 'corner' | 'center' | '3point';
  arcMode: '3point' | 'center-start-end' | 'start-end-radius' | 'fillet' | 'tangent';
  ellipseMode: 'center-axes' | 'corner' | 'partial';
  splineMode: 'fit-points' | 'control-points';
  dimensionMode: DimensionType;
  currentStyle: ShapeStyle;
  isDrawing: boolean;
  drawingPreview: DrawingPreview;
  drawingPoints: Point[];  // Points clicked so far in current drawing session
  drawingBulges: number[];  // Bulge values for polyline arc segments
  sourceSnapAngle: number | null;  // Angle from first snap point's source shape (for perpendicular tracking)

  // Phase 1: Options bar state
  chainMode: boolean;               // Line tool: chain mode (continue from last endpoint)
  lockedRadius: number | null;       // Circle/Arc: locked radius for single-click placement
  cornerRadius: number;              // Rectangle: corner radius

  // Phase 3: Polyline segment mode
  polylineArcMode: boolean;         // When true, next polyline segment is an arc
  polylineArcThroughPoint: Point | null;  // For 3-point arc: the point the arc passes through

  // Phase 2: Dynamic input locked values
  lockedDistance: number | null;
  lockedAngle: number | null;

  // Phase 5: Dimension enhancements
  dimensionPrecision: number;
  dimensionArrowStyle: 'filled' | 'open' | 'dot' | 'tick' | 'none';
  linearDimensionDirection: 'auto' | 'horizontal' | 'vertical';
  /** Active dimension style preset name (e.g., 'Default', 'DimAssociate') */
  dimensionStylePreset: string;

  // Phase 6: Pick lines
  pickLinesMode: boolean;
  pickLinesOffset: number;

  // Text tool state
  textEditingId: string | null;     // ID of text shape being edited
  defaultTextStyle: DefaultTextStyle;

  // Modify tool options
  modifyCopy: boolean;           // Move/Rotate/Mirror: copy instead of move
  modifyConstrain: boolean;      // Move/Copy: constrain to axis
  modifyConstrainAxis: 'x' | 'y' | null;  // Move/Copy: specific axis constraint
  modifyOrtho: boolean;          // Move/Copy: sticky 45° ortho mode (toggled by Shift)
  modifyMultiple: boolean;       // Copy: keep placing copies
  scaleMode: 'graphical' | 'numerical';
  scaleFactor: number;
  filletRadius: number;
  chamferDistance1: number;
  chamferDistance2: number;
  offsetDistance: number;
  offsetFlipped: boolean;         // Flip offset to opposite side (toggled by Tab)
  rotateAngle: number | null;    // Typed angle override

  // Array tool options
  arrayMode: 'linear' | 'radial';
  arrayCount: number;              // Number of copies (including original)
  arraySpacing: number;            // Linear: distance between copies
  arrayAngle: number;              // Radial: total angle span in degrees (default 360)
  arrayMaintainRelation: boolean;  // Maintain associative relationship between array copies

  // Modify tool internal state
  modifyRefShapeId: string | null;  // For trim/extend: cutting/boundary edge ID

  // Hatch tool options
  hatchPatternType: 'solid' | 'diagonal' | 'crosshatch' | 'horizontal' | 'vertical' | 'dots' | 'custom';
  hatchPatternAngle: number;
  hatchPatternScale: number;
  hatchFillColor: string;
  hatchBackgroundColor: string | null;
  hatchCustomPatternId: string | null;  // ID of custom pattern (when patternType is 'custom')

  // Filled Region mode (sketch-based boundary drawing)
  filledRegionMode: boolean;
  filledRegionDrawTool: 'line' | 'rectangle' | 'polygon' | 'circle' | 'arc' | 'spline' | 'pickLines';

  // Dynamic Input toggle
  dynamicInputEnabled: boolean;

  // Leader tool options
  defaultLeaderConfig: LeaderConfig;

  // Display Lineweight toggle
  showLineweight: boolean;

  // Gridline label editing
  editingGridlineLabel: {
    shapeId: string;
    bubbleEnd: 'start' | 'end';
  } | null;

  // Level label editing (inline elevation edit in section views)
  editingLevelId: string | null;

  // Plate system edit mode (TAB to enter, TAB/ESC to exit)
  plateSystemEditMode: boolean;
  editingPlateSystemId: string | null;

  // Plate system sub-tool state machine (active when in edit mode)
  plateSystemSubTool: 'select' | 'add-point' | 'arc-edge' | 'add-opening' | 'delete';

  // Plate system opening placement sub-mode
  plateSystemOpeningMode: boolean;
  selectedOpeningId: string | null;

  // Slab edit mode (TAB to enter inner contour drawing, TAB/ESC to exit)
  slabEditMode: boolean;
  editingSlabId: string | null;
  slabInnerContourPoints: import('../../types/geometry').Point[];  // Points for the contour currently being drawn
}

// ============================================================================
// Actions Interface
// ============================================================================

export interface ToolActions {
  setActiveTool: (tool: ToolType) => void;
  repeatLastTool: () => void;
  setCircleMode: (mode: 'center-radius' | 'center-diameter' | '2point' | '3point') => void;
  setRectangleMode: (mode: 'corner' | 'center' | '3point') => void;
  setArcMode: (mode: '3point' | 'center-start-end' | 'start-end-radius' | 'fillet' | 'tangent') => void;
  setEllipseMode: (mode: 'center-axes' | 'corner' | 'partial') => void;
  setSplineMode: (mode: 'fit-points' | 'control-points') => void;
  setDimensionMode: (mode: DimensionType) => void;
  setCurrentStyle: (style: Partial<ShapeStyle>) => void;
  setIsDrawing: (isDrawing: boolean) => void;
  setDrawingPreview: (preview: DrawingPreview) => void;
  addDrawingPoint: (point: Point, sourceAngle?: number) => void;
  undoDrawingPoint: () => void;
  clearDrawingPoints: () => void;
  setSourceSnapAngle: (angle: number | null) => void;
  closeDrawing: () => void;
  addDrawingBulge: (bulge: number) => void;

  // Options bar actions
  setChainMode: (enabled: boolean) => void;
  setLockedRadius: (radius: number | null) => void;
  setCornerRadius: (radius: number) => void;
  setLockedDistance: (distance: number | null) => void;
  setLockedAngle: (angle: number | null) => void;
  setDimensionPrecision: (precision: number) => void;
  setDimensionArrowStyle: (style: 'filled' | 'open' | 'dot' | 'tick' | 'none') => void;
  setLinearDimensionDirection: (dir: 'auto' | 'horizontal' | 'vertical') => void;
  setDimensionStylePreset: (presetName: string) => void;
  setPickLinesMode: (enabled: boolean) => void;
  setPickLinesOffset: (offset: number) => void;
  setPolylineArcMode: (enabled: boolean) => void;
  setPolylineArcThroughPoint: (point: Point | null) => void;

  // Text editing actions
  startTextEditing: (shapeId: string) => void;
  endTextEditing: () => void;
  updateDefaultTextStyle: (style: Partial<DefaultTextStyle>) => void;

  // Modify tool actions
  setModifyCopy: (enabled: boolean) => void;
  setModifyConstrain: (enabled: boolean) => void;
  setModifyConstrainAxis: (axis: 'x' | 'y' | null) => void;
  toggleModifyOrtho: () => void;
  setModifyMultiple: (enabled: boolean) => void;
  setScaleMode: (mode: 'graphical' | 'numerical') => void;
  setScaleFactor: (factor: number) => void;
  setFilletRadius: (radius: number) => void;
  setChamferDistance1: (distance: number) => void;
  setChamferDistance2: (distance: number) => void;
  setOffsetDistance: (distance: number) => void;
  toggleOffsetFlip: () => void;
  setRotateAngle: (angle: number | null) => void;
  setModifyRefShapeId: (id: string | null) => void;
  setArrayMode: (mode: 'linear' | 'radial') => void;
  setArrayCount: (count: number) => void;
  setArraySpacing: (spacing: number) => void;
  setArrayAngle: (angle: number) => void;
  setArrayMaintainRelation: (enabled: boolean) => void;

  // Hatch tool actions
  setHatchPatternType: (type: 'solid' | 'diagonal' | 'crosshatch' | 'horizontal' | 'vertical' | 'dots' | 'custom') => void;
  setHatchPatternAngle: (angle: number) => void;
  setHatchPatternScale: (scale: number) => void;
  setHatchFillColor: (color: string) => void;
  setHatchBackgroundColor: (color: string | null) => void;
  setHatchCustomPatternId: (id: string | null) => void;

  // Filled Region mode actions
  startFilledRegionMode: () => void;
  cancelFilledRegionMode: () => void;
  finishFilledRegion: () => void;
  setFilledRegionDrawTool: (tool: 'line' | 'rectangle' | 'polygon' | 'circle' | 'arc' | 'spline' | 'pickLines') => void;

  // Leader tool actions
  updateDefaultLeaderConfig: (config: Partial<LeaderConfig>) => void;

  // Dynamic Input toggle
  toggleDynamicInput: () => void;

  // Display Lineweight toggle
  toggleShowLineweight: () => void;

  // Gridline label editing actions
  startGridlineLabelEdit: (shapeId: string, bubbleEnd: 'start' | 'end') => void;
  endGridlineLabelEdit: () => void;

  // Level label editing actions (inline elevation edit in section views)
  startLevelLabelEdit: (shapeId: string) => void;
  endLevelLabelEdit: () => void;

  // Plate system edit mode actions
  setPlateSystemEditMode: (editing: boolean, systemId?: string) => void;
  setPlateSystemSubTool: (tool: 'select' | 'add-point' | 'arc-edge' | 'add-opening' | 'delete') => void;
  setPlateSystemOpeningMode: (enabled: boolean) => void;
  setSelectedOpeningId: (id: string | null) => void;

  // Slab edit mode actions (inner contour drawing)
  setSlabEditMode: (editing: boolean, slabId?: string) => void;
  addSlabInnerContourPoint: (point: import('../../types/geometry').Point) => void;
  finishSlabInnerContour: () => void;
  cancelSlabInnerContour: () => void;
  deleteSlabInnerContour: (contourIndex: number) => void;
}

export type ToolSlice = ToolState & ToolActions;

// ============================================================================
// Initial State
// ============================================================================

export const initialToolState: ToolState = {
  activeTool: 'select',
  lastTool: null,
  circleMode: 'center-radius',
  rectangleMode: 'corner',
  arcMode: '3point',
  ellipseMode: 'center-axes',
  splineMode: 'fit-points',
  dimensionMode: 'aligned',
  currentStyle: defaultStyle,
  isDrawing: false,
  drawingPreview: null,
  drawingPoints: [],
  drawingBulges: [],
  sourceSnapAngle: null,

  // Options bar state
  chainMode: true,
  lockedRadius: null,
  cornerRadius: 0,
  polylineArcMode: false,
  polylineArcThroughPoint: null,
  lockedDistance: null,
  lockedAngle: null,
  dimensionPrecision: 2,
  dimensionArrowStyle: 'tick',
  linearDimensionDirection: 'auto',
  dimensionStylePreset: 'Default',
  pickLinesMode: false,
  pickLinesOffset: 10,

  // Text tool state
  textEditingId: null,
  defaultTextStyle: {
    fontFamily: 'Osifont',
    fontSize: 1.8,
    bold: false,
    italic: false,
    underline: false,
    alignment: 'left',
    color: '#ffffff',
  },

  // Modify tool options
  modifyCopy: false,
  modifyConstrain: false,
  modifyConstrainAxis: null,
  modifyOrtho: false,
  modifyMultiple: true,
  scaleMode: 'graphical' as const,
  scaleFactor: 2,
  filletRadius: 5,
  chamferDistance1: 5,
  chamferDistance2: 5,
  offsetDistance: 10,
  offsetFlipped: false,
  rotateAngle: null,
  modifyRefShapeId: null,

  // Array tool options
  arrayMode: 'linear' as const,
  arrayCount: 5,
  arraySpacing: 20,
  arrayAngle: 360,
  arrayMaintainRelation: false,

  // Hatch tool options
  hatchPatternType: 'diagonal' as const,
  hatchPatternAngle: 45,
  hatchPatternScale: 1,
  hatchFillColor: '#ffffff',
  hatchBackgroundColor: null,
  hatchCustomPatternId: null,

  // Filled Region mode
  filledRegionMode: false,
  filledRegionDrawTool: 'line' as const,

  // Dynamic Input
  dynamicInputEnabled: true,

  // Leader tool options
  defaultLeaderConfig: {
    arrowType: 'filled-arrow',
    arrowSize: 2.5,
    attachment: 'middle-left',
    hasLanding: true,
    landingLength: 5,
    lineWeight: 0.18,
  },

  // Display Lineweight (default: off — lines render at 1 screen pixel)
  showLineweight: false,

  // Gridline label editing
  editingGridlineLabel: null,

  // Level label editing
  editingLevelId: null,

  // Plate system edit mode
  plateSystemEditMode: false,
  editingPlateSystemId: null,
  plateSystemSubTool: 'select' as const,

  // Plate system opening placement
  plateSystemOpeningMode: false,
  selectedOpeningId: null,

  // Slab edit mode
  slabEditMode: false,
  editingSlabId: null,
  slabInnerContourPoints: [],
};

// ============================================================================
// Slice Creator
// ============================================================================

export const createToolSlice = (
  set: (fn: (state: ToolState) => void) => void,
  _get: () => ToolState
): ToolActions => ({
  setActiveTool: (tool) =>
    set((state) => {
      // Track last tool for "Repeat" feature (only drawing/modify tools)
      const repeatableTools: ToolType[] = [
        'line', 'rectangle', 'circle', 'arc', 'polyline', 'ellipse', 'spline',
        'text', 'leader', 'label', 'dimension', 'beam', 'hatch', 'filled-region', 'slab',
        'move', 'copy', 'copy2', 'rotate', 'scale', 'mirror', 'trim', 'extend',
        'fillet', 'chamfer', 'offset', 'array', 'elastic', 'align', 'trim-walls'
      ];
      if (repeatableTools.includes(state.activeTool) && state.activeTool !== tool) {
        state.lastTool = state.activeTool;
      }

      state.activeTool = tool;
      state.isDrawing = false;
      state.drawingPreview = null;
      state.drawingPoints = [];
      state.drawingBulges = [];
      state.polylineArcMode = false;
      state.polylineArcThroughPoint = null;
      state.modifyRefShapeId = null;
      state.sourceSnapAngle = null;
      state.modifyConstrainAxis = null;
      state.offsetFlipped = false;
      state.modifyOrtho = false;
      // Exit plate system edit mode when switching tools
      if (tool !== 'select') {
        state.plateSystemEditMode = false;
        state.editingPlateSystemId = null;
        state.plateSystemSubTool = 'select';
        state.plateSystemOpeningMode = false;
        state.selectedOpeningId = null;
      }
      // Exit slab edit mode when switching tools
      if (tool !== 'select') {
        state.slabEditMode = false;
        state.editingSlabId = null;
        state.slabInnerContourPoints = [];
      }
      // Reset copy flag for mirror (default on)
      if (tool === 'mirror') {
        state.modifyCopy = true;
      } else if (tool === 'move' || tool === 'rotate' || tool === 'scale') {
        state.modifyCopy = false;
      }
    }),

  repeatLastTool: () =>
    set((state) => {
      if (state.lastTool) {
        state.activeTool = state.lastTool;
        state.isDrawing = false;
        state.drawingPreview = null;
        state.drawingPoints = [];
        state.drawingBulges = [];
        state.polylineArcMode = false;
        state.polylineArcThroughPoint = null;
        state.modifyRefShapeId = null;
        state.sourceSnapAngle = null;
        // Reset copy flag for mirror (default on)
        if (state.lastTool === 'mirror') {
          state.modifyCopy = true;
        } else if (state.lastTool === 'move' || state.lastTool === 'rotate' || state.lastTool === 'scale') {
          state.modifyCopy = false;
        }
      }
    }),

  setCircleMode: (mode) =>
    set((state) => {
      state.circleMode = mode;
      state.isDrawing = false;
      state.drawingPreview = null;
      state.drawingPoints = [];
    }),

  setRectangleMode: (mode) =>
    set((state) => {
      state.rectangleMode = mode;
      state.isDrawing = false;
      state.drawingPreview = null;
      state.drawingPoints = [];
    }),

  setArcMode: (mode) =>
    set((state) => {
      state.arcMode = mode;
      state.isDrawing = false;
      state.drawingPreview = null;
      state.drawingPoints = [];
    }),

  setEllipseMode: (mode) =>
    set((state) => {
      state.ellipseMode = mode;
      state.isDrawing = false;
      state.drawingPreview = null;
      state.drawingPoints = [];
    }),

  setSplineMode: (mode) =>
    set((state) => {
      state.splineMode = mode;
      state.isDrawing = false;
      state.drawingPreview = null;
      state.drawingPoints = [];
    }),

  setDimensionMode: (mode) =>
    set((state) => {
      state.dimensionMode = mode;
      state.isDrawing = false;
      state.drawingPreview = null;
      state.drawingPoints = [];
    }),

  setCurrentStyle: (style) =>
    set((state) => {
      state.currentStyle = { ...state.currentStyle, ...style };
    }),

  setIsDrawing: (isDrawing) =>
    set((state) => {
      state.isDrawing = isDrawing;
    }),

  setDrawingPreview: (preview) =>
    set((state) => {
      state.drawingPreview = preview;
    }),

  addDrawingPoint: (point, sourceAngle) =>
    set((state) => {
      state.drawingPoints.push(point);
      state.isDrawing = true;
      // Store source angle on first point only
      if (state.drawingPoints.length === 1 && sourceAngle !== undefined) {
        state.sourceSnapAngle = sourceAngle;
      }
    }),

  setSourceSnapAngle: (angle) =>
    set((state) => {
      state.sourceSnapAngle = angle;
    }),

  undoDrawingPoint: () =>
    set((state) => {
      if (state.drawingPoints.length > 0) {
        state.drawingPoints.pop();
        // Pop the corresponding bulge (bulge[i] is between point[i] and point[i+1])
        if (state.drawingBulges.length > 0 && state.drawingBulges.length >= state.drawingPoints.length) {
          state.drawingBulges.pop();
        }
        if (state.drawingPoints.length === 0) {
          state.isDrawing = false;
          state.drawingPreview = null;
          state.drawingBulges = [];
        }
      }
    }),

  clearDrawingPoints: () =>
    set((state) => {
      state.drawingPoints = [];
      state.drawingBulges = [];
      state.isDrawing = false;
      state.drawingPreview = null;
      state.polylineArcMode = false;
      state.polylineArcThroughPoint = null;
      state.sourceSnapAngle = null;
    }),

  closeDrawing: () =>
    set((state) => {
      state.drawingPoints = [];
      state.drawingBulges = [];
      state.isDrawing = false;
      state.drawingPreview = null;
      state.polylineArcMode = false;
      state.polylineArcThroughPoint = null;
      state.sourceSnapAngle = null;
    }),

  addDrawingBulge: (bulge) =>
    set((state) => {
      state.drawingBulges.push(bulge);
    }),

  // Options bar actions
  setChainMode: (enabled) =>
    set((state) => {
      state.chainMode = enabled;
    }),

  setLockedRadius: (radius) =>
    set((state) => {
      state.lockedRadius = radius;
    }),

  setCornerRadius: (radius) =>
    set((state) => {
      state.cornerRadius = radius;
    }),

  setLockedDistance: (dist) =>
    set((state) => {
      state.lockedDistance = dist;
    }),

  setLockedAngle: (angle) =>
    set((state) => {
      state.lockedAngle = angle;
    }),

  setDimensionPrecision: (precision) =>
    set((state) => {
      state.dimensionPrecision = precision;
    }),

  setDimensionArrowStyle: (style) =>
    set((state) => {
      state.dimensionArrowStyle = style;
    }),

  setLinearDimensionDirection: (dir) =>
    set((state) => {
      state.linearDimensionDirection = dir;
    }),

  setDimensionStylePreset: (presetName) =>
    set((state) => {
      state.dimensionStylePreset = presetName;
      // When switching to a preset, update the arrow style and precision to match
      const preset = DIMENSION_STYLE_PRESETS[presetName];
      if (preset) {
        state.dimensionArrowStyle = preset.arrowType;
        state.dimensionPrecision = preset.precision;
      }
    }),

  setPickLinesMode: (enabled) =>
    set((state) => {
      state.pickLinesMode = enabled;
    }),

  setPickLinesOffset: (offset) =>
    set((state) => {
      state.pickLinesOffset = offset;
    }),

  setPolylineArcMode: (enabled) =>
    set((state) => {
      state.polylineArcMode = enabled;
      if (!enabled) {
        state.polylineArcThroughPoint = null;
      }
    }),

  setPolylineArcThroughPoint: (point) =>
    set((state) => {
      state.polylineArcThroughPoint = point;
    }),

  // Text editing actions
  startTextEditing: (shapeId) =>
    set((state) => {
      state.textEditingId = shapeId;
    }),

  endTextEditing: () =>
    set((state) => {
      state.textEditingId = null;
    }),

  updateDefaultTextStyle: (style) =>
    set((state) => {
      state.defaultTextStyle = { ...state.defaultTextStyle, ...style };
    }),

  // Modify tool actions
  setModifyCopy: (enabled) =>
    set((state) => { state.modifyCopy = enabled; }),
  setModifyConstrain: (enabled) =>
    set((state) => { state.modifyConstrain = enabled; }),
  setModifyConstrainAxis: (axis) =>
    set((state) => { state.modifyConstrainAxis = axis; }),
  toggleModifyOrtho: () =>
    set((state) => { state.modifyOrtho = !state.modifyOrtho; }),
  setModifyMultiple: (enabled) =>
    set((state) => { state.modifyMultiple = enabled; }),
  setScaleMode: (mode) =>
    set((state) => { state.scaleMode = mode; }),
  setScaleFactor: (factor) =>
    set((state) => { state.scaleFactor = factor; }),
  setFilletRadius: (radius) =>
    set((state) => { state.filletRadius = radius; }),
  setChamferDistance1: (distance) =>
    set((state) => { state.chamferDistance1 = distance; }),
  setChamferDistance2: (distance) =>
    set((state) => { state.chamferDistance2 = distance; }),
  setOffsetDistance: (distance) =>
    set((state) => { state.offsetDistance = distance; }),
  toggleOffsetFlip: () =>
    set((state) => { state.offsetFlipped = !state.offsetFlipped; }),
  setRotateAngle: (angle) =>
    set((state) => { state.rotateAngle = angle; }),
  setModifyRefShapeId: (id) =>
    set((state) => { state.modifyRefShapeId = id; }),
  setArrayMode: (mode) =>
    set((state) => { state.arrayMode = mode; }),
  setArrayCount: (count) =>
    set((state) => { state.arrayCount = count; }),
  setArraySpacing: (spacing) =>
    set((state) => { state.arraySpacing = spacing; }),
  setArrayAngle: (angle) =>
    set((state) => { state.arrayAngle = angle; }),
  setArrayMaintainRelation: (enabled) =>
    set((state) => { state.arrayMaintainRelation = enabled; }),

  // Hatch tool actions
  setHatchPatternType: (type) =>
    set((state) => { state.hatchPatternType = type; }),
  setHatchPatternAngle: (angle) =>
    set((state) => { state.hatchPatternAngle = angle; }),
  setHatchPatternScale: (scale) =>
    set((state) => { state.hatchPatternScale = scale; }),
  setHatchFillColor: (color) =>
    set((state) => { state.hatchFillColor = color; }),
  setHatchBackgroundColor: (color) =>
    set((state) => { state.hatchBackgroundColor = color; }),
  setHatchCustomPatternId: (id) =>
    set((state) => { state.hatchCustomPatternId = id; }),

  // Filled Region mode actions
  startFilledRegionMode: () =>
    set((state) => {
      state.filledRegionMode = true;
      state.filledRegionDrawTool = 'line';
      // Set actual activeTool to the drawing tool so canvas handles it
      state.activeTool = 'polyline'; // Default to polyline for drawing boundary
      state.drawingPoints = [];
      state.drawingBulges = [];
      state.drawingPreview = null;
    }),

  cancelFilledRegionMode: () =>
    set((state) => {
      state.filledRegionMode = false;
      state.activeTool = 'select';
      state.drawingPoints = [];
      state.drawingBulges = [];
      state.drawingPreview = null;
    }),

  finishFilledRegion: () =>
    set((state) => {
      // The actual hatch creation is handled by the component
      // This just exits the mode
      state.filledRegionMode = false;
      state.activeTool = 'select';
      state.drawingPoints = [];
      state.drawingBulges = [];
      state.drawingPreview = null;
    }),

  setFilledRegionDrawTool: (tool) =>
    set((state) => {
      const prevTool = state.filledRegionDrawTool;
      state.filledRegionDrawTool = tool;

      // Line and Arc are both polyline modes - just toggle arc mode without resetting
      if ((prevTool === 'line' || prevTool === 'arc') && (tool === 'line' || tool === 'arc')) {
        state.polylineArcMode = tool === 'arc';
        state.polylineArcThroughPoint = null;
        // Don't reset drawing points - continue the chain
        return;
      }

      // Switching to a different tool type - reset drawing
      const toolMap: Record<string, string> = {
        'line': 'polyline',      // Polyline in line mode
        'arc': 'polyline',       // Polyline in arc mode
        'rectangle': 'rectangle',
        'polygon': 'polyline',   // Polygon is a closed polyline
        'circle': 'circle',
        'spline': 'spline',
        'pickLines': 'select',   // Pick lines uses selection
      };
      state.activeTool = (toolMap[tool] || 'polyline') as any;
      state.polylineArcMode = tool === 'arc';
      state.polylineArcThroughPoint = null;
      state.drawingPoints = [];
      state.drawingBulges = [];
      state.drawingPreview = null;
    }),

  // Leader tool actions
  updateDefaultLeaderConfig: (config) =>
    set((state) => {
      state.defaultLeaderConfig = { ...state.defaultLeaderConfig, ...config };
    }),

  // Dynamic Input toggle
  toggleDynamicInput: () =>
    set((state) => {
      state.dynamicInputEnabled = !state.dynamicInputEnabled;
      setSetting('dynamicInputEnabled', state.dynamicInputEnabled);
    }),

  // Display Lineweight toggle
  toggleShowLineweight: () =>
    set((state) => {
      state.showLineweight = !state.showLineweight;
      setSetting('showLineweight', state.showLineweight);
    }),

  // Gridline label editing actions
  startGridlineLabelEdit: (shapeId, bubbleEnd) =>
    set((state) => {
      state.editingGridlineLabel = { shapeId, bubbleEnd };
    }),

  endGridlineLabelEdit: () =>
    set((state) => {
      state.editingGridlineLabel = null;
    }),

  // Level label editing actions
  startLevelLabelEdit: (shapeId) =>
    set((state) => {
      state.editingLevelId = shapeId;
    }),

  endLevelLabelEdit: () =>
    set((state) => {
      state.editingLevelId = null;
    }),

  // Plate system edit mode actions
  setPlateSystemEditMode: (editing, systemId) =>
    set((state) => {
      state.plateSystemEditMode = editing;
      state.editingPlateSystemId = editing ? (systemId ?? null) : null;
      // Reset sub-tool and opening sub-mode when entering/exiting edit mode
      state.plateSystemSubTool = 'select';
      if (!editing) {
        state.plateSystemOpeningMode = false;
        state.selectedOpeningId = null;
      }
    }),

  setPlateSystemSubTool: (tool) =>
    set((state) => {
      state.plateSystemSubTool = tool;
      // Synchronise openingMode with sub-tool
      state.plateSystemOpeningMode = tool === 'add-opening';
      if (tool !== 'select') {
        state.selectedOpeningId = null;
      }
    }),

  setPlateSystemOpeningMode: (enabled) =>
    set((state) => {
      state.plateSystemOpeningMode = enabled;
      // Keep sub-tool in sync
      if (enabled) {
        state.plateSystemSubTool = 'add-opening';
      } else if (state.plateSystemSubTool === 'add-opening') {
        state.plateSystemSubTool = 'select';
      }
      if (!enabled) {
        state.selectedOpeningId = null;
      }
    }),

  setSelectedOpeningId: (id) =>
    set((state) => {
      state.selectedOpeningId = id;
    }),

  // Slab edit mode actions
  setSlabEditMode: (editing, slabId) =>
    set((state) => {
      state.slabEditMode = editing;
      state.editingSlabId = editing ? (slabId ?? null) : null;
      state.slabInnerContourPoints = [];
      // Exit plate system edit mode if entering slab edit mode
      if (editing) {
        state.plateSystemEditMode = false;
        state.editingPlateSystemId = null;
      }
    }),

  addSlabInnerContourPoint: (point) =>
    set((state) => {
      state.slabInnerContourPoints.push({ x: point.x, y: point.y });
    }),

  finishSlabInnerContour: () =>
    set((state: any) => {
      if (!state.editingSlabId || state.slabInnerContourPoints.length < 3) {
        state.slabInnerContourPoints = [];
        return;
      }
      const slab = state.shapes?.find((s: any) => s.id === state.editingSlabId);
      if (slab && slab.type === 'slab') {
        if (!slab.innerContours) {
          slab.innerContours = [];
        }
        slab.innerContours.push([...state.slabInnerContourPoints]);
      }
      state.slabInnerContourPoints = [];
    }),

  cancelSlabInnerContour: () =>
    set((state) => {
      state.slabInnerContourPoints = [];
    }),

  deleteSlabInnerContour: (contourIndex) =>
    set((state: any) => {
      if (!state.editingSlabId) return;
      const slab = state.shapes?.find((s: any) => s.id === state.editingSlabId);
      if (slab && slab.type === 'slab' && slab.innerContours) {
        slab.innerContours.splice(contourIndex, 1);
        if (slab.innerContours.length === 0) {
          delete slab.innerContours;
        }
      }
    }),
});
