/**
 * CAD Defaults - Single source of truth for text and dimension styling constants
 *
 * All sizes are in paper mm (e.g., 2.5 = 2.5mm on paper at any scale).
 * The rendering pipeline divides by drawingScale to convert to drawing units.
 */

import type { DimensionStyle } from '../types/dimension';

/** ISO 3098 compliant open-source font */
export const CAD_DEFAULT_FONT = 'Osifont';

/** ISO 3098 recommended line height ratio */
export const CAD_DEFAULT_LINE_HEIGHT = 1.4;

/** Standard annotation text height in paper mm */
export const CAD_DEFAULT_TEXT_HEIGHT_MM = 2.5;

/** Default dimension style - values in paper mm */
export const DEFAULT_DIMENSION_STYLE: DimensionStyle = {
  arrowType: 'tick',
  arrowSize: 2.5,
  extensionLineGap: 1.5,
  extensionLineOvershoot: 2.5,
  textHeight: 2.5,
  textPlacement: 'centered',
  lineColor: '#00ffff',
  textColor: '#00ffff',
  precision: 0,
};

/**
 * DimAssociate dimension style - associative dimensions linked to gridlines.
 * Black lines, filled round dot terminators, 2.5mm line weight, integer formatting.
 */
export const DIM_ASSOCIATE_STYLE: DimensionStyle = {
  arrowType: 'dot',
  arrowSize: 2.5,
  extensionLineGap: 1.5,
  extensionLineOvershoot: 2.5,
  textHeight: 2.5,
  textPlacement: 'centered',
  lineColor: '#000000',
  textColor: '#000000',
  precision: 0,
  strokeWidth: 2.5,
  dotFilled: false,
  noThousandsSeparator: true,
};

/**
 * NEN (Dutch standard) dimension style.
 * Uses filled dot terminators, black text, 2.5mm text height, 1.5mm dot size.
 */
export const DIM_NEN_STYLE: DimensionStyle = {
  arrowType: 'circle',
  tickMarkType: 'circle',
  arrowSize: 1.5,
  extensionLineGap: 1.0,
  extensionLineOvershoot: 2.0,
  extensionLineOffset: 1.0,
  extensionLineLength: 2.0,
  textHeight: 2.5,
  textPlacement: 'above',
  textPosition: 'above',
  lineColor: '#000000',
  textColor: '#000000',
  precision: 0,
  dotFilled: true,
};

/**
 * Named dimension style presets.
 * Maps preset name to its DimensionStyle.
 */
export const DIMENSION_STYLE_PRESETS: Record<string, DimensionStyle> = {
  Default: DEFAULT_DIMENSION_STYLE,
  DimAssociate: DIM_ASSOCIATE_STYLE,
  NEN: DIM_NEN_STYLE,
};
