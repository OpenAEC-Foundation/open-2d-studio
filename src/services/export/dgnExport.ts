/**
 * DGN Export Service
 *
 * Exports Open-2D-Studio shapes to DGN-compatible format.
 *
 * MicroStation DGN V8 is a complex proprietary binary format. Rather than
 * implementing a full binary DGN writer, this service generates a DXF file
 * (which MicroStation reads natively) and saves it with a .dgn extension.
 * This provides immediate interoperability with MicroStation / Bentley products.
 *
 * Native DGN V8 binary export is planned for a future release.
 */

import type { Shape } from '../../types/geometry';
import type { UnitSettings } from '../../units/types';
import { exportToDXF } from '../file/fileService';

/**
 * Export shapes to DGN-compatible format.
 *
 * Currently generates DXF content (which MicroStation reads natively).
 * The caller is responsible for saving with a .dgn extension.
 *
 * Supported shape types (via DXF):
 * - Lines
 * - Circles
 * - Arcs
 * - Ellipses
 * - Polylines (including closed / with bulges)
 * - Splines
 * - Text
 * - Points
 * - Rectangles (as closed polylines)
 *
 * @param shapes - Array of shapes to export
 * @param unitSettings - Optional unit settings for coordinate scaling
 * @returns DXF-formatted string content
 */
export function exportToDGN(
  shapes: Shape[],
  unitSettings?: UnitSettings,
): string {
  // Generate DXF content — MicroStation reads DXF natively
  return exportToDXF(shapes, unitSettings);
}
