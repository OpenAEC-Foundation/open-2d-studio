import { useState, useCallback, useRef, memo } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { DrawingsTab } from './DrawingsTab';
import { SheetsTab } from './SheetsTab';

export const NavigationPanel = memo(function NavigationPanel() {
  const [drawingsCollapsed, setDrawingsCollapsed] = useState(false);
  const [sheetsCollapsed, setSheetsCollapsed] = useState(false);
  const [drawingsHeight, setDrawingsHeight] = useState(50); // percentage
  const containerRef = useRef<HTMLDivElement>(null);
  const isDragging = useRef(false);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isDragging.current = true;

    const handleMouseMove = (e: MouseEvent) => {
      if (!isDragging.current || !containerRef.current) return;

      const containerRect = containerRef.current.getBoundingClientRect();
      const headerHeight = 28; // Height of each collapsed header
      const availableHeight = containerRect.height - (headerHeight * 2); // Subtract both headers
      const relativeY = e.clientY - containerRect.top - headerHeight;

      let newHeight = (relativeY / availableHeight) * 100;
      newHeight = Math.max(10, Math.min(90, newHeight)); // Clamp between 10% and 90%

      setDrawingsHeight(newHeight);
    };

    const handleMouseUp = () => {
      isDragging.current = false;
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  }, []);

  // Calculate actual heights based on collapse state
  const getDrawingsStyle = () => {
    if (drawingsCollapsed) return { flex: '0 0 auto' };
    if (sheetsCollapsed) return { flex: '1 1 auto' };
    return { flex: `0 0 ${drawingsHeight}%` };
  };

  const getSheetsStyle = () => {
    if (sheetsCollapsed) return { flex: '0 0 auto' };
    if (drawingsCollapsed) return { flex: '1 1 auto' };
    return { flex: `0 0 ${100 - drawingsHeight}%` };
  };

  return (
    <div
      ref={containerRef}
      className="w-48 flex flex-col bg-cad-bg border-r border-cad-border"
    >
      {/* Drawings Section */}
      <div className="flex flex-col min-h-0 overflow-hidden" style={getDrawingsStyle()}>
        {/* Drawings Header */}
        <div
          className="flex items-center gap-1 px-2 py-1.5 bg-cad-surface border-b border-cad-border cursor-pointer hover:bg-cad-hover select-none"
          onClick={() => setDrawingsCollapsed(!drawingsCollapsed)}
        >
          {drawingsCollapsed ? (
            <ChevronRight size={14} className="text-cad-text-dim" />
          ) : (
            <ChevronDown size={14} className="text-cad-text-dim" />
          )}
          <span className="text-xs font-medium text-cad-text">Drawings</span>
          <span className="text-[10px] text-cad-text-dim ml-auto">Model Space</span>
        </div>

        {/* Drawings Content */}
        {!drawingsCollapsed && (
          <div className="flex-1 min-h-0 overflow-hidden">
            <DrawingsTab />
          </div>
        )}
      </div>

      {/* Resizable Divider - only show when both sections are expanded */}
      {!drawingsCollapsed && !sheetsCollapsed && (
        <div
          className="h-1 bg-cad-border hover:bg-cad-accent cursor-ns-resize flex-shrink-0"
          onMouseDown={handleMouseDown}
        />
      )}

      {/* Sheets Section */}
      <div className="flex flex-col min-h-0 overflow-hidden" style={getSheetsStyle()}>
        {/* Sheets Header */}
        <div
          className="flex items-center gap-1 px-2 py-1.5 bg-cad-surface border-b border-cad-border cursor-pointer hover:bg-cad-hover select-none"
          onClick={() => setSheetsCollapsed(!sheetsCollapsed)}
        >
          {sheetsCollapsed ? (
            <ChevronRight size={14} className="text-cad-text-dim" />
          ) : (
            <ChevronDown size={14} className="text-cad-text-dim" />
          )}
          <span className="text-xs font-medium text-cad-text">Sheets</span>
          <span className="text-[10px] text-cad-text-dim ml-auto">Paper Space</span>
        </div>

        {/* Sheets Content */}
        {!sheetsCollapsed && (
          <div className="flex-1 min-h-0 overflow-hidden">
            <SheetsTab />
          </div>
        )}
      </div>
    </div>
  );
});
