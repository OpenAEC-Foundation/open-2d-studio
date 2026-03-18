/**
 * Extension SDK — barrel re-export of everything runtime extensions need.
 *
 * Host app exposes this module on window.__open2dStudioSdk so that
 * external extension bundles can `require('open-2d-studio')` at runtime.
 */

// Registries (12)
export { boundsRegistry } from './engine/registry/BoundsRegistry';
export { shapeRendererRegistry } from './engine/registry/ShapeRendererRegistry';
export { snapProviderRegistry } from './engine/registry/SnapProviderRegistry';
export { gripProviderRegistry } from './engine/registry/GripProviderRegistry';
export { shapeHandleRegistry } from './engine/registry/ShapeHandleRegistry';
export { ifcExportRegistry } from './engine/registry/IfcExportRegistry';
export { modelBehaviorRegistry } from './engine/registry/ModelBehaviorRegistry';
export { keyboardShortcutRegistry } from './engine/registry/KeyboardShortcutRegistry';
export { automationRegistry } from './engine/registry/AutomationRegistry';
export { dialogRegistry } from './engine/registry/DialogRegistry';
export { shapePreviewRegistry } from './engine/registry/ShapePreviewRegistry';
export { ifcCategoryRegistry } from './engine/registry/IfcCategoryRegistry';
export { drawingToolRegistry } from './engine/registry/DrawingToolRegistry';
export type { ToolHandler } from './engine/registry/DrawingToolRegistry';

// State
export { useAppStore } from './state/appStore';
export { generateId } from './state/slices/types';

// Geometry utilities
export {
  annotationScaleFactor,
  bulgeArcBounds,
  bulgeToArc,
  bulgeArcMidpoint,
  calculateBulgeFrom3Points,
  isAngleInArc,
} from './engine/geometry/GeometryUtils';
export {
  getBeamFlangeSegments,
  getWallOutlineSegments,
  distance,
  getBeamAngle,
  getBeamEndpoints,
  getBeamCornerEndpoints,
  getBeamMidpoint,
  getBeamFlangeMidpoints,
  getNearestPointOnBeam,
  getBeamCorners,
  getWallAngle,
  getWallCorners,
  getWallCornerEndpoints,
  getWallEdgeMidpoints,
  getNearestPointOnWall,
} from './engine/geometry/SnapUtils';

// Services
export { generateProfileGeometry } from './services/parametric/geometryGenerators';
export { calculateLayerOffsets, generateWallSystemGrid } from './services/wallSystem/wallSystemService';
export { createCurveAnnotation } from './services/ifc/ifcFactoryAdapter';
export { formatSectionPeilLabel } from './services/section/sectionReferenceService';

// Hooks
export { formatPeilLabel, calculatePeilFromY } from './hooks/drawing/useLevelDrawing';
export { getNextSectionLabel } from './hooks/drawing/useSectionCalloutDrawing';
export { useIfcAutoRegenerate } from './hooks/useIfcAutoRegenerate';
export { useSpaceAutoUpdate } from './hooks/useSpaceAutoUpdate';
export { usePileAutoNumbering } from './hooks/usePileAutoNumbering';
export { usePileAutoDimensioning } from './hooks/usePileAutoDimensioning';
export { usePileAutoPuntniveau } from './hooks/usePileAutoPuntniveau';

// UI Components
export {
  RibbonButton,
  RibbonSmallButton,
  RibbonGroup,
  RibbonMediumButton,
  RibbonMediumButtonStack,
  RibbonButtonStack,
} from './components/layout/Ribbon/RibbonComponents';
export {
  LineIcon,
  ArcIcon,
  BeamIcon,
  GridLineIcon,
  LevelIcon,
  SectionDetailIcon,
  PileIcon,
  ColumnIcon,
  PuntniveauIcon,
  CPTIcon,
  WallIcon,
  SlabIcon,
  SlabOpeningIcon,
  SlabLabelIcon,
  SpaceIcon,
  LabelIcon,
  MiterJoinIcon,
  PlateSystemIcon,
  SpotElevationIcon,
} from './components/shared/CadIcons';

// Dialog Components
export { SectionDialog } from './components/dialogs/SectionDialog';
export { BeamDialog } from './components/dialogs/BeamDialog';
export { GridlineDialog } from './components/dialogs/GridlineDialog';
export { PileSymbolsDialog } from './components/dialogs/PileSymbolsDialog';
export { WallDialog } from './components/dialogs/WallDialog';
export { PlateSystemDialog } from './components/dialogs/PlateSystemDialog/PlateSystemDialog';
export { MaterialsDialog } from './components/dialogs/MaterialsDialog';
export { WallTypesDialog } from './components/dialogs/WallTypesDialog';
export { WallSystemDialog } from './components/dialogs/WallSystemDialog/WallSystemDialog';
export { ProjectStructureDialog } from './components/dialogs/ProjectStructureDialog';
export { PdfUnderlayDialog } from './components/dialogs/PdfUnderlayDialog';

// PDF Underlay Service
export {
  showPdfFileDialog,
  renderPdfPageForUnderlay,
} from './services/file/pdfUnderlayService';
export { getPdfUnderlayData } from './state/slices/uiSlice';

// CPT File Service
export { parseGEF, parseBROXML, parseCPTFile, showCPTFileDialog } from './services/file/cptFileService';
export type { CPTFileData } from './services/file/cptFileService';

// Constants
export { CAD_DEFAULT_FONT } from './constants/cadDefaults';
export { DEFAULT_MATERIAL_HATCH_SETTINGS } from './types/hatch';
export { LINE_DASH_REFERENCE_SCALE, COLORS } from './engine/renderer/types';

// Formatting
export { formatNumber, formatElevation } from './units/format';

// Types (for type declarations)
export type { ShapeRenderContext } from './engine/renderer/core/ShapeRenderContext';
export type { ShapeBounds } from './engine/geometry/GeometryUtils';
export type { GripHandler } from './engine/registry/GripProviderRegistry';
export type { ProfileType, ParameterValues } from './types/parametric';
export type {
  Point,
  Shape,
  ImageShape,
  BeamShape,
  WallShape,
  WallOpeningShape,
  GridlineShape,
  LevelShape,
  PileShape,
  ColumnShape,
  ColumnMaterial,
  SlabShape,
  SlabOpeningShape,
  SlabOpeningDisplayStyle,
  SlabLabelShape,
  StructuralFloorType,
  PuntniveauShape,
  SpaceShape,
  PlateSystemShape,
  SectionCalloutShape,
  SpotElevationShape,
  CPTShape,
  FoundationZoneShape,
  WallSystemType,
  MaterialCategory,
  RebarShape,
  RebarDiameter,
  RebarViewMode,
  ExposureClass,
  SurfaceExposureClasses,
} from './types/geometry';
export {
  STRUCTURAL_FLOOR_TYPES,
  REBAR_DIAMETERS,
  EXPOSURE_CLASSES,
  EXPOSURE_CLASS_MIN_COVER,
  getMinCoverFromExposureClasses,
} from './types/geometry';
