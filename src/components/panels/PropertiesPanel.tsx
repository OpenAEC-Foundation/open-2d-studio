import { memo, useMemo } from 'react';
import { useAppStore } from '../../state/appStore';
import type { LineStyle } from '../../types/geometry';
import { DrawingPropertiesPanel } from './DrawingPropertiesPanel';
import { PropertyGroup, ColorPalette, LineweightInput } from './properties/PropertyFields';
import { ShapeProperties, MultiSelectShapeProperties, ParametricShapeProperties } from './properties/ShapeProperties';
import { ActiveToolProperties } from './properties/ToolProperties';

export const PropertiesPanel = memo(function PropertiesPanel() {
  const selectedShapeIds = useAppStore(s => s.selectedShapeIds);
  const selectionFilter = useAppStore(s => s.selectionFilter);
  const shapes = useAppStore(s => s.shapes);
  const parametricShapes = useAppStore(s => s.parametricShapes);
  const currentStyle = useAppStore(s => s.currentStyle);
  const setCurrentStyle = useAppStore(s => s.setCurrentStyle);
  const updateShape = useAppStore(s => s.updateShape);
  const activeTool = useAppStore(s => s.activeTool);
  const selectedIdSet = useMemo(() => new Set(selectedShapeIds), [selectedShapeIds]);
  const selectedShapes = shapes.filter((s) => {
    if (!selectedIdSet.has(s.id)) return false;
    if (selectionFilter && s.type !== selectionFilter) return false;
    return true;
  });
  const selectedParametricShapes = parametricShapes.filter((s) => {
    if (!selectedIdSet.has(s.id)) return false;
    return true;
  });
  const hasSelection = selectedShapes.length > 0 || selectedParametricShapes.length > 0;
  const hasRegularShapeSelection = selectedShapes.length > 0;

  // Get common style from selection (or use current style)
  // For parametric shapes, use their style or fall back to current style
  const displayStyle = hasRegularShapeSelection
    ? selectedShapes[0].style
    : selectedParametricShapes.length > 0
      ? selectedParametricShapes[0].style
      : currentStyle;

  const handleColorChange = (color: string) => {
    if (hasRegularShapeSelection) {
      selectedShapes.forEach((shape) => {
        updateShape(shape.id, { style: { ...shape.style, strokeColor: color } });
      });
    } else {
      setCurrentStyle({ strokeColor: color });
    }
  };

  const handleWidthChange = (width: number) => {
    if (hasRegularShapeSelection) {
      selectedShapes.forEach((shape) => {
        updateShape(shape.id, { style: { ...shape.style, strokeWidth: width } });
      });
    } else {
      setCurrentStyle({ strokeWidth: width });
    }
  };

  const handleLineStyleChange = (lineStyle: LineStyle) => {
    if (hasRegularShapeSelection) {
      selectedShapes.forEach((shape) => {
        updateShape(shape.id, { style: { ...shape.style, lineStyle } });
      });
    } else {
      setCurrentStyle({ lineStyle });
    }
  };

  // Determine if a structural/drawing tool with pending state is active
  const isToolWithProperties = [
    'line', 'wall', 'beam', 'slab', 'slab-label', 'plate-system', 'gridline', 'level', 'pile', 'cpt', 'section-callout', 'hatch', 'array',
  ].includes(activeTool);

  if (!hasSelection) {
    return (
      <div className="flex-1 overflow-auto">
        {isToolWithProperties && <ActiveToolProperties activeTool={activeTool} />}
        <DrawingPropertiesPanel showHeader={false} />
      </div>
    );
  }

  // If only parametric shapes selected, show parametric properties
  if (selectedParametricShapes.length > 0 && selectedShapes.length === 0) {
    return (
      <div className="flex-1 overflow-auto">
        <div className="p-3">
          {/* Selection info */}
          <div className="text-xs text-cad-text-dim mb-4">
            {selectedParametricShapes.length} parametric shape{selectedParametricShapes.length > 1 ? 's' : ''} selected
          </div>

          {/* Parametric shape properties */}
          {selectedParametricShapes.length === 1 && (
            <ParametricShapeProperties shape={selectedParametricShapes[0]} />
          )}

          {selectedParametricShapes.length > 1 && (
            <div className="text-xs text-cad-text-dim">
              Select a single parametric shape to edit its properties.
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-auto">
      {isToolWithProperties && <ActiveToolProperties activeTool={activeTool} />}
      <div>
        {/* Hide Style section for IFC/AEC object types (only show for basic 2D shapes) */}
        {!(selectedShapes.length > 0 && selectedShapes.every(s => ['wall', 'beam', 'column', 'slab', 'pile', 'gridline', 'level', 'section-callout', 'space', 'puntniveau', 'cpt', 'wall-opening', 'slab-opening', 'rebar', 'slab-label', 'spot-elevation', 'plate-system'].includes(s.type))) && <PropertyGroup label="Style">
          <ColorPalette label="Color" value={displayStyle.strokeColor} onChange={handleColorChange} />

          <LineweightInput value={displayStyle.strokeWidth} onChange={handleWidthChange} />

          <div className="mb-3">
            <label className="block text-xs text-cad-text-dim mb-1">Line Style</label>
            <select
              value={displayStyle.lineStyle}
              onChange={(e) => handleLineStyleChange(e.target.value as LineStyle)}
              className="w-full bg-cad-bg border border-cad-border rounded px-2 py-1 text-xs text-cad-text"
            >
              <option value="solid">Solid</option>
              <option value="dashed">Dashed</option>
              <option value="dotted">Dotted</option>
              <option value="dashdot">Dash-Dot</option>
            </select>
          </div>
        </PropertyGroup>}

        {/* Shape-specific properties - single selection */}
        {selectedShapes.length === 1 && selectedParametricShapes.length === 0 && (
          <ShapeProperties shape={selectedShapes[0]} updateShape={updateShape} />
        )}

        {/* Shape-specific properties - multi-selection of same type */}
        {selectedShapes.length > 1 && selectedParametricShapes.length === 0 && (() => {
          const firstType = selectedShapes[0].type;
          const allSameType = selectedShapes.every(s => s.type === firstType);
          if (!allSameType) return null;

          return (
            <MultiSelectShapeProperties shapes={selectedShapes} updateShape={updateShape} />
          );
        })()}
      </div>
    </div>
  );
});
