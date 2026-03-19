import { useState, useRef, useEffect, memo, useMemo } from 'react';
import { ChevronDown, ChevronRight, PanelLeftClose } from 'lucide-react';
import { DrawingsTab } from './DrawingsTab';
import { SheetsTab } from './SheetsTab';
import { QueriesTab } from './QueriesTab';
import { CalculationsTab } from './CalculationsTab';
import { getSetting, setSetting } from '../../utils/settings';
import { useAppStore } from '../../state/appStore';

interface NavigationPanelProps {
  onCollapse?: () => void;
}

interface SectionConfig {
  id: string;
  label: string;
  sublabel: string;
  component: React.ComponentType;
}

const SECTIONS: SectionConfig[] = [
  { id: 'drawings', label: 'Drawings', sublabel: 'Drawing', component: DrawingsTab },
  { id: 'sheets', label: 'Sheets', sublabel: 'Sheet Layout', component: SheetsTab },
  { id: 'queries', label: 'Queries', sublabel: 'Schedules & QTO', component: QueriesTab },
  { id: 'calculations', label: 'Calculations', sublabel: 'Structural', component: CalculationsTab },
];

export const NavigationPanel = memo(function NavigationPanel({ onCollapse }: NavigationPanelProps) {
  const activeRibbonTab = useAppStore((s) => s.activeRibbonTab);

  // When the IFC tab is active, hide Drawings/Sheets/Queries/Calculations
  const visibleSections = useMemo(() => {
    if (activeRibbonTab === 'ifc') {
      return [] as SectionConfig[];
    }
    return SECTIONS;
  }, [activeRibbonTab]);

  const [collapsedSections, setCollapsedSections] = useState<Record<string, boolean>>({
    drawings: false,
    sheets: false,
    queries: true,
    calculations: true,
  });
  const [panelWidth, setPanelWidth] = useState(192);

  // Restore saved width
  useEffect(() => {
    getSetting<number>('navPanelWidth', 192).then(setPanelWidth);
  }, []);
  const isResizingWidth = useRef(false);

  // Horizontal resize handler
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizingWidth.current) return;
      const newWidth = Math.max(140, Math.min(500, e.clientX));
      setPanelWidth(newWidth);
    };
    const handleMouseUp = () => {
      if (isResizingWidth.current) {
        isResizingWidth.current = false;
        document.documentElement.classList.remove('cursor-col-resizing');
        document.body.style.userSelect = '';
        setPanelWidth(w => { setSetting('navPanelWidth', w); return w; });
      }
    };
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, []);

  const toggleSection = (id: string) => {
    setCollapsedSections(prev => ({ ...prev, [id]: !prev[id] }));
  };

  // Calculate how many sections are expanded
  const expandedCount = visibleSections.filter(s => !collapsedSections[s.id]).length;

  const getSectionStyle = (id: string): React.CSSProperties => {
    if (collapsedSections[id]) return { flex: '0 0 auto' };
    if (expandedCount === 1) return { flex: '1 1 auto' };
    // Share space equally among expanded sections
    return { flex: '1 1 0%', minHeight: 0 };
  };

  return (
    <div
      className="flex flex-col bg-cad-bg border-r border-cad-border relative cursor-default [&_*]:cursor-default"
      style={{ width: panelWidth, minWidth: 140, maxWidth: 500 }}
    >
      {visibleSections.length === 0 && (
        <div className="flex items-center justify-center flex-1 px-3 py-4">
          <span className="text-xs text-cad-text-dim text-center">
            IFC mode active.{'\n'}Navigation sections hidden.
          </span>
        </div>
      )}
      {visibleSections.map((section, index) => {
        const isCollapsed = collapsedSections[section.id];
        const SectionComponent = section.component;
        const isFirst = index === 0;

        return (
          <div key={section.id} className="flex flex-col min-h-0 overflow-hidden" style={getSectionStyle(section.id)}>
            {/* Section Header */}
            <div
              className="flex items-center gap-1 px-2 py-1.5 bg-cad-surface border-b border-cad-border cursor-default hover:bg-cad-hover select-none flex-shrink-0"
              onClick={() => toggleSection(section.id)}
            >
              {isCollapsed ? (
                <ChevronRight size={14} className="text-cad-text-dim" />
              ) : (
                <ChevronDown size={14} className="text-cad-text-dim" />
              )}
              <span className="text-xs font-medium text-cad-text">{section.label}</span>
              <span className="text-[10px] text-cad-text-dim ml-auto mr-1">{section.sublabel}</span>
              {isFirst && onCollapse && (
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); onCollapse(); }}
                  className="flex items-center justify-center w-5 h-5 rounded hover:bg-cad-hover text-cad-text-dim hover:text-cad-text transition-colors flex-shrink-0"
                  title="Collapse left panel"
                >
                  <PanelLeftClose size={14} />
                </button>
              )}
            </div>

            {/* Section Content */}
            {!isCollapsed && (
              <div className="flex-1 min-h-0 overflow-hidden">
                <SectionComponent />
              </div>
            )}
          </div>
        );
      })}

      {/* Horizontal resize handle — straddles the panel edge for a solid hit zone */}
      <div
        style={{ cursor: 'col-resize', right: -4, width: 8 }}
        className="absolute top-0 h-full z-50"
        onMouseDown={(e) => {
          e.preventDefault();
          isResizingWidth.current = true;
          document.documentElement.classList.add('cursor-col-resizing');
          document.body.style.userSelect = 'none';
        }}
      />
    </div>
  );
});
