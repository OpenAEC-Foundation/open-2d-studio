import { useState, useCallback, useRef, useEffect } from 'react';
import { PropertiesPanel } from './PropertiesPanel';
import { LayersPanel } from './LayersPanel';

interface SectionState {
  collapsed: boolean;
  /** Height in pixels when expanded. null = flex (take remaining space) */
  height: number | null;
}

export function RightPanelLayout() {
  const containerRef = useRef<HTMLDivElement>(null);

  const [properties, setProperties] = useState<SectionState>({ collapsed: false, height: null });
  const [layers, setLayers] = useState<SectionState>({ collapsed: false, height: null });

  const dragRef = useRef<{
    startY: number;
    aboveHeight: number;
    belowHeight: number;
  } | null>(null);

  const sections = [
    { state: properties, setter: setProperties, label: 'Properties', collapsed: properties.collapsed },
    { state: layers, setter: setLayers, label: 'Layers', collapsed: layers.collapsed },
  ];

  const HEADER_HEIGHT = 28;
  const MIN_SECTION_HEIGHT = 60;

  const getExpandedSections = () => sections.filter(s => !s.collapsed);

  const resolveHeights = useCallback(() => {
    if (!containerRef.current) return [];
    const totalHeight = containerRef.current.clientHeight;
    const collapsedCount = sections.filter(s => s.collapsed).length;
    const expandedSections = getExpandedSections();
    const availableHeight = totalHeight - collapsedCount * HEADER_HEIGHT - expandedSections.length * HEADER_HEIGHT;

    const explicitSections = expandedSections.filter(s => s.state.height !== null);
    const flexSections = expandedSections.filter(s => s.state.height === null);
    const explicitTotal = explicitSections.reduce((sum, s) => sum + (s.state.height ?? 0), 0);
    const flexHeight = flexSections.length > 0 ? (availableHeight - explicitTotal) / flexSections.length : 0;

    return expandedSections.map(s => ({
      ...s,
      resolvedHeight: s.state.height ?? Math.max(MIN_SECTION_HEIGHT, flexHeight),
    }));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [properties, layers]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    // Only one divider between the two sections
    const resolved = resolveHeights();
    if (resolved.length < 2) return;

    dragRef.current = {
      startY: e.clientY,
      aboveHeight: resolved[0].resolvedHeight,
      belowHeight: resolved[1].resolvedHeight,
    };

    document.body.style.cursor = 'row-resize';
    document.body.style.userSelect = 'none';
  }, [resolveHeights]);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!dragRef.current) return;
      const delta = e.clientY - dragRef.current.startY;
      const newAbove = Math.max(MIN_SECTION_HEIGHT, dragRef.current.aboveHeight + delta);
      const newBelow = Math.max(MIN_SECTION_HEIGHT, dragRef.current.belowHeight - delta);

      if (newAbove >= MIN_SECTION_HEIGHT && newBelow >= MIN_SECTION_HEIGHT) {
        setProperties(prev => ({ ...prev, height: newAbove }));
        setLayers(prev => ({ ...prev, height: newBelow }));
      }
    };

    const handleMouseUp = () => {
      if (dragRef.current) {
        dragRef.current = null;
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      }
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, []);

  const toggleCollapse = (setter: React.Dispatch<React.SetStateAction<SectionState>>) => {
    setter(prev => ({ ...prev, collapsed: !prev.collapsed, height: null }));
  };

  const resolved = resolveHeights();

  const renderSection = (
    label: string,
    collapsed: boolean,
    setter: React.Dispatch<React.SetStateAction<SectionState>>,
    content: React.ReactNode,
    showDivider: boolean
  ) => {
    const resolvedEntry = resolved.find(r => r.label === label);

    return (
      <div key={label} className="flex flex-col" style={collapsed ? undefined : { height: resolvedEntry ? resolvedEntry.resolvedHeight + HEADER_HEIGHT : undefined, flexShrink: 0 }}>
        {/* Collapsible header */}
        <div
          className="flex items-center justify-between px-3 h-7 min-h-[28px] cursor-pointer hover:bg-cad-hover select-none border-b border-cad-border bg-cad-surface"
          onClick={() => toggleCollapse(setter)}
        >
          <span className="text-xs font-semibold text-cad-text">{label}</span>
          <span className="text-xs text-cad-text-dim">{collapsed ? '▼' : '▲'}</span>
        </div>

        {/* Content */}
        {!collapsed && (
          <div className="flex-1 overflow-y-auto">
            {content}
          </div>
        )}

        {/* Resize handle */}
        {showDivider && (
          <div
            className="h-1 min-h-[4px] cursor-row-resize bg-cad-border hover:bg-cad-accent flex-shrink-0"
            onMouseDown={handleMouseDown}
          />
        )}
      </div>
    );
  };

  const expandedSections = getExpandedSections();
  const bothExpanded = expandedSections.length === 2;

  return (
    <div ref={containerRef} className="flex flex-col h-full overflow-hidden">
      {renderSection('Properties', properties.collapsed, setProperties, <PropertiesPanel />, bothExpanded && !properties.collapsed)}
      {renderSection('Layers', layers.collapsed, setLayers, <LayersPanel />, false)}
    </div>
  );
}
