/**
 * useAecCanvasTools - Bridge hook that composes all AEC drawing tool hooks
 * and provides a unified dispatch interface for useCanvasEvents.
 *
 * This hook calls all 12 AEC drawing hooks at the top level (satisfying React
 * rules of hooks) and exposes lookup methods so useCanvasEvents can delegate
 * AEC tool handling without directly importing each hook.
 */

import { useAppStore } from '../../state/appStore';
import type { Point, ToolType } from '../../types/geometry';
import type { SnapResult } from '../snap/useSnapDetection';

import { useBeamDrawing } from '../drawing/useBeamDrawing';
import { useGridlineDrawing } from '../drawing/useGridlineDrawing';
import { usePileDrawing } from '../drawing/usePileDrawing';
import { useCPTDrawing } from '../drawing/useCPTDrawing';
import { useWallDrawing } from '../drawing/useWallDrawing';
import { useSlabDrawing } from '../drawing/useSlabDrawing';
import { useLevelDrawing } from '../drawing/useLevelDrawing';
import { usePuntniveauDrawing } from '../drawing/usePuntniveauDrawing';
import { useSectionCalloutDrawing } from '../drawing/useSectionCalloutDrawing';
import { useSpaceDrawing } from '../drawing/useSpaceDrawing';
import { usePlateSystemDrawing } from '../drawing/usePlateSystemDrawing';

const AEC_TOOL_NAMES = [
  'beam', 'gridline', 'level', 'pile', 'cpt',
  'wall', 'slab', 'puntniveau', 'section-callout', 'space', 'plate-system',
] as const;

export function useAecCanvasTools() {
  // Call all AEC hooks at top level (React rules of hooks)
  const beamDrawing = useBeamDrawing();
  const gridlineDrawing = useGridlineDrawing();
  const pileDrawing = usePileDrawing();
  const cptDrawing = useCPTDrawing();
  const wallDrawing = useWallDrawing();
  const slabDrawing = useSlabDrawing();
  const levelDrawing = useLevelDrawing();
  const puntniveauDrawing = usePuntniveauDrawing();
  const sectionCalloutDrawing = useSectionCalloutDrawing();
  const spaceDrawing = useSpaceDrawing();
  const plateSystemDrawing = usePlateSystemDrawing();

  // Read pending states from store
  const {
    pendingBeam, pendingGridline, pendingPile, pendingCPT,
    pendingWall, pendingSlab, pendingLevel, pendingPuntniveau,
    pendingSectionCallout, pendingSpace, pendingPlateSystem,
    viewport,
  } = useAppStore();

  /**
   * Check if a tool name is an AEC drawing tool.
   */
  function isAecTool(toolName: string): boolean {
    return (AEC_TOOL_NAMES as readonly string[]).includes(toolName);
  }

  /**
   * Get AEC tool names for the drawingTools array.
   */
  function getToolNames(): string[] {
    return [...AEC_TOOL_NAMES];
  }

  /**
   * Check if any AEC tool has pending state.
   */
  function hasAnyPendingState(): boolean {
    return !!(
      pendingBeam || pendingGridline || pendingPile || pendingCPT ||
      pendingWall || pendingSlab || pendingLevel || pendingPuntniveau ||
      pendingSectionCallout || pendingSpace || pendingPlateSystem
    );
  }

  /**
   * Check if a specific AEC tool has pending state.
   */
  function hasPendingState(toolName: string): boolean {
    switch (toolName) {
      case 'beam': return !!pendingBeam;
      case 'gridline': return !!pendingGridline;
      case 'pile': return !!pendingPile;
      case 'cpt': return !!pendingCPT;
      case 'wall': return !!pendingWall;
      case 'slab': return !!pendingSlab;
      case 'level': return !!pendingLevel;
      case 'puntniveau': return !!pendingPuntniveau;
      case 'section-callout': return !!pendingSectionCallout;
      case 'space': return !!pendingSpace;
      case 'plate-system': return !!pendingPlateSystem;
      default: return false;
    }
  }

  /**
   * Compute source angle for beam perpendicular/parallel tracking.
   * This logic was previously inline in useCanvasEvents handleClick.
   */
  function computeBeamSourceAngle(snappedPos: Point, snapResult: SnapResult): number | undefined {
    let sourceAngle = snapResult.snapInfo?.sourceAngle;

    // Fallback 1: if snap has sourceShapeId but no sourceAngle, compute from shape
    if (sourceAngle === undefined && snapResult.snapInfo?.sourceShapeId) {
      const { shapes: currentShapes } = useAppStore.getState();
      const sourceShape = currentShapes.find(s => s.id === snapResult.snapInfo?.sourceShapeId);
      if (sourceShape) {
        if (sourceShape.type === 'beam') {
          const beam = sourceShape as any;
          sourceAngle = Math.atan2(beam.end.y - beam.start.y, beam.end.x - beam.start.x);
        } else if (sourceShape.type === 'line') {
          const line = sourceShape as any;
          sourceAngle = Math.atan2(line.end.y - line.start.y, line.end.x - line.start.x);
        }
      }
    }

    // Fallback 2: find nearest beam/line at click point and use its angle
    if (sourceAngle === undefined) {
      const tolerance = 20 / viewport.zoom;
      const { shapes: currentShapes, activeDrawingId: currentDrawingId } = useAppStore.getState();
      const drawingShapes = currentShapes.filter(s => s.drawingId === currentDrawingId && s.visible);

      for (const shape of drawingShapes) {
        if (shape.type === 'beam') {
          const beam = shape as any;
          const dx = beam.end.x - beam.start.x;
          const dy = beam.end.y - beam.start.y;
          const length = Math.sqrt(dx * dx + dy * dy);
          if (length > 0) {
            const t = Math.max(0, Math.min(1,
              ((snappedPos.x - beam.start.x) * dx + (snappedPos.y - beam.start.y) * dy) / (length * length)
            ));
            const closestX = beam.start.x + t * dx;
            const closestY = beam.start.y + t * dy;
            const dist = Math.sqrt((snappedPos.x - closestX) ** 2 + (snappedPos.y - closestY) ** 2);

            if (dist < tolerance + beam.flangeWidth / 2) {
              sourceAngle = Math.atan2(dy, dx);
              break;
            }
          }
        } else if (shape.type === 'line') {
          const line = shape as any;
          const dx = line.end.x - line.start.x;
          const dy = line.end.y - line.start.y;
          const length = Math.sqrt(dx * dx + dy * dy);
          if (length > 0) {
            const t = Math.max(0, Math.min(1,
              ((snappedPos.x - line.start.x) * dx + (snappedPos.y - line.start.y) * dy) / (length * length)
            ));
            const closestX = line.start.x + t * dx;
            const closestY = line.start.y + t * dy;
            const dist = Math.sqrt((snappedPos.x - closestX) ** 2 + (snappedPos.y - closestY) ** 2);

            if (dist < tolerance) {
              sourceAngle = Math.atan2(dy, dx);
              break;
            }
          }
        }
      }
    }

    return (sourceAngle !== undefined && !isNaN(sourceAngle)) ? sourceAngle : undefined;
  }

  /**
   * Handle click for an AEC drawing tool.
   * Returns true if the click was handled.
   */
  function handleToolClick(toolName: string, snappedPos: Point, shiftKey: boolean, snapResult: SnapResult): boolean {
    switch (toolName) {
      case 'beam':
        if (!pendingBeam) return false;
        return beamDrawing.handleBeamClick(snappedPos, shiftKey, computeBeamSourceAngle(snappedPos, snapResult));
      case 'gridline':
        if (!pendingGridline) return false;
        return gridlineDrawing.handleGridlineClick(snappedPos, shiftKey);
      case 'level':
        if (!pendingLevel) return false;
        return levelDrawing.handleLevelClick(snappedPos, shiftKey);
      case 'pile':
        if (!pendingPile) return false;
        return pileDrawing.handlePileClick(snappedPos);
      case 'cpt':
        if (!pendingCPT) return false;
        return cptDrawing.handleCPTClick(snappedPos);
      case 'wall':
        if (!pendingWall) return false;
        return wallDrawing.handleWallClick(snappedPos, shiftKey);
      case 'slab':
        if (!pendingSlab) return false;
        return slabDrawing.handleSlabClick(snappedPos, shiftKey);
      case 'puntniveau':
        if (!pendingPuntniveau) return false;
        return puntniveauDrawing.handlePuntniveauClick(snappedPos, shiftKey);
      case 'plate-system':
        if (!pendingPlateSystem) return false;
        return plateSystemDrawing.handlePlateSystemClick(snappedPos, shiftKey);
      case 'section-callout':
        if (!pendingSectionCallout) return false;
        return sectionCalloutDrawing.handleSectionCalloutClick(snappedPos, shiftKey);
      case 'space':
        if (!pendingSpace) return false;
        return spaceDrawing.handleSpaceClick(snappedPos);
      default:
        return false;
    }
  }

  /**
   * Handle mouse move for an AEC drawing tool.
   * Returns the base point for snap detection, or undefined if tool not active.
   */
  function getToolBasePoint(toolName: string): Point | undefined {
    switch (toolName) {
      case 'beam': return beamDrawing.getBeamBasePoint() ?? undefined;
      case 'gridline': return gridlineDrawing.getGridlineBasePoint() ?? undefined;
      case 'level': return levelDrawing.getLevelBasePoint() ?? undefined;
      case 'wall': return wallDrawing.getWallBasePoint() ?? undefined;
      case 'slab': return slabDrawing.getSlabBasePoint() ?? undefined;
      case 'puntniveau': return puntniveauDrawing.getPuntniveauBasePoint() ?? undefined;
      case 'plate-system': return plateSystemDrawing.getPlateSystemBasePoint() ?? undefined;
      case 'section-callout': return sectionCalloutDrawing.getSectionCalloutBasePoint() ?? undefined;
      default: return undefined;
    }
  }

  /**
   * Get the source snap angle for beam (needed for perpendicular tracking).
   */
  function getBeamSourceSnapAngle(): number | undefined {
    return useAppStore.getState().sourceSnapAngle ?? undefined;
  }

  /**
   * Update preview for an AEC drawing tool during mouse move.
   */
  function handleToolMouseMove(toolName: string, snappedPos: Point, shiftKey: boolean): boolean {
    switch (toolName) {
      case 'beam':
        if (!pendingBeam) return false;
        beamDrawing.updateBeamPreview(snappedPos, shiftKey);
        return true;
      case 'gridline':
        if (!pendingGridline) return false;
        gridlineDrawing.updateGridlinePreview(snappedPos, shiftKey);
        return true;
      case 'level':
        if (!pendingLevel) return false;
        levelDrawing.updateLevelPreview(snappedPos, shiftKey);
        return true;
      case 'pile':
        if (!pendingPile) return false;
        pileDrawing.updatePilePreview(snappedPos);
        return true;
      case 'cpt':
        if (!pendingCPT) return false;
        cptDrawing.updateCPTPreview(snappedPos);
        return true;
      case 'wall':
        if (!pendingWall) return false;
        wallDrawing.updateWallPreview(snappedPos, shiftKey);
        return true;
      case 'slab':
        if (!pendingSlab) return false;
        slabDrawing.updateSlabPreview(snappedPos, shiftKey);
        return true;
      case 'puntniveau':
        if (!pendingPuntniveau) return false;
        puntniveauDrawing.updatePuntniveauPreview(snappedPos, shiftKey);
        return true;
      case 'plate-system':
        if (!pendingPlateSystem) return false;
        plateSystemDrawing.updatePlateSystemPreview(snappedPos, shiftKey);
        return true;
      case 'section-callout':
        if (!pendingSectionCallout) return false;
        sectionCalloutDrawing.updateSectionCalloutPreview(snappedPos, shiftKey);
        return true;
      default:
        return false;
    }
  }

  /**
   * Handle cancel (right-click) for an AEC drawing tool.
   * Returns true if the cancel was handled.
   */
  function handleToolCancel(toolName: string, setActiveTool: (tool: ToolType) => void, clearTracking: () => void): boolean {
    switch (toolName) {
      case 'beam':
        if (!pendingBeam) return false;
        beamDrawing.cancelBeamDrawing();
        setActiveTool('select');
        return true;
      case 'gridline':
        if (!pendingGridline) return false;
        gridlineDrawing.cancelGridlineDrawing();
        setActiveTool('select');
        return true;
      case 'level':
        if (!pendingLevel) return false;
        levelDrawing.cancelLevelDrawing();
        setActiveTool('select');
        return true;
      case 'pile':
        if (!pendingPile) return false;
        pileDrawing.cancelPileDrawing();
        setActiveTool('select');
        return true;
      case 'cpt':
        if (!pendingCPT) return false;
        cptDrawing.cancelCPTDrawing();
        setActiveTool('select');
        return true;
      case 'wall':
        if (!pendingWall) return false;
        wallDrawing.cancelWallDrawing();
        setActiveTool('select');
        return true;
      case 'slab':
        if (!pendingSlab) return handleSlabFinishOrCancel(setActiveTool, clearTracking);
        return handleSlabFinishOrCancel(setActiveTool, clearTracking);
      case 'puntniveau':
        if (!pendingPuntniveau) return handlePuntniveauFinishOrCancel(setActiveTool, clearTracking);
        return handlePuntniveauFinishOrCancel(setActiveTool, clearTracking);
      case 'plate-system':
        if (!pendingPlateSystem) return handlePlateSystemFinishOrCancel(setActiveTool, clearTracking);
        return handlePlateSystemFinishOrCancel(setActiveTool, clearTracking);
      case 'section-callout':
        if (!pendingSectionCallout) return false;
        sectionCalloutDrawing.cancelSectionCalloutDrawing();
        setActiveTool('select');
        return true;
      case 'space':
        if (!pendingSpace) return false;
        spaceDrawing.cancelSpaceDrawing();
        setActiveTool('select');
        return true;
      default:
        return false;
    }
  }

  // Polygon tools: finish if enough points, cancel otherwise
  function handleSlabFinishOrCancel(setActiveTool: (tool: ToolType) => void, clearTracking: () => void): boolean {
    if (!pendingSlab) return false;
    if (slabDrawing.pointCount >= 3) {
      slabDrawing.finishSlabDrawing();
      clearTracking();
    } else {
      slabDrawing.cancelSlabDrawing();
      setActiveTool('select');
    }
    return true;
  }

  function handlePuntniveauFinishOrCancel(setActiveTool: (tool: ToolType) => void, clearTracking: () => void): boolean {
    if (!pendingPuntniveau) return false;
    if (puntniveauDrawing.pointCount >= 3) {
      puntniveauDrawing.finishPuntniveauDrawing();
      clearTracking();
    } else {
      puntniveauDrawing.cancelPuntniveauDrawing();
      setActiveTool('select');
    }
    return true;
  }

  function handlePlateSystemFinishOrCancel(setActiveTool: (tool: ToolType) => void, clearTracking: () => void): boolean {
    if (!pendingPlateSystem) return false;
    if (plateSystemDrawing.pointCount >= 3) {
      plateSystemDrawing.finishPlateSystemDrawing();
      clearTracking();
    } else {
      plateSystemDrawing.cancelPlateSystemDrawing();
      setActiveTool('select');
    }
    return true;
  }

  return {
    isAecTool,
    getToolNames,
    hasAnyPendingState,
    hasPendingState,
    handleToolClick,
    handleToolMouseMove,
    handleToolCancel,
    getToolBasePoint,
    getBeamSourceSnapAngle,
  };
}
