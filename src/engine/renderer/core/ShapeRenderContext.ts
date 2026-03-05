/**
 * ShapeRenderContext — Provides AEC (and other extension) renderers
 * with access to ShapeRenderer instance state and shared helpers.
 *
 * Passed to extension-registered render functions so they don't need
 * a direct reference to the ShapeRenderer class.
 */

import type { Shape } from '../types';
import type { CustomHatchPattern, LineFamily, SvgHatchPattern, MaterialHatchSettings } from '../../../types/hatch';
import type { WallType, WallSystemType, HatchPatternType } from '../../../types/geometry';
import type { UnitSettings } from '../../../units/types';

export interface ShapeRenderContext {
  ctx: CanvasRenderingContext2D;
  drawingScale: number;
  currentZoom: number;
  showLineweight: boolean;
  gridlineExtension: number;
  seaLevelDatum: number;
  materialHatchSettings: MaterialHatchSettings;
  wallTypes: WallType[];
  wallSystemTypes: WallSystemType[];
  selectedWallSubElement: { wallId: string; type: 'stud' | 'panel'; key: string } | null;
  unitSettings: UnitSettings;
  shapesLookup: Map<string, Shape>;
  customPatterns: CustomHatchPattern[];

  // Core rendering helpers (bound to ShapeRenderer instance)
  getLineDash: (lineStyle: string) => number[];
  getLineWidth: (strokeWidth: number) => number;
  getPatternById: (patternId: string) => CustomHatchPattern | undefined;
  drawLineFamilySimple: (angleDeg: number, spacing: number, minX: number, minY: number, maxX: number, maxY: number) => void;
  drawCustomPatternLines: (lineFamilies: LineFamily[], minX: number, minY: number, maxX: number, maxY: number, scale: number, rotationOffset: number, defaultColor: string, defaultStrokeWidth: number) => void;
  drawInsulationZigzag: (minX: number, minY: number, maxX: number, maxY: number, scale: number, rotationOffset: number, color: string, defaultStrokeWidth: number, wallThickness?: number) => void;
  drawInsulationZigzagArc: (center: { x: number; y: number }, innerR: number, outerR: number, startAngle: number, endAngle: number, clockwise: boolean, color: string, strokeWidth: number) => void;
  drawSvgPattern: (pattern: SvgHatchPattern, minX: number, minY: number, maxX: number, maxY: number, scale: number, rotationOffset: number) => void;
  renderPatternLayer: (pType: HatchPatternType, pAngle: number, pScale: number, pColor: string, pCustomId: string | undefined, strokeWidth: number, minX: number, minY: number, maxX: number, maxY: number) => void;
}
