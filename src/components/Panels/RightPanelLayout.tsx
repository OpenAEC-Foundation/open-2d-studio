import { PropertiesPanel } from './PropertiesPanel';

export function RightPanelLayout() {
  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Properties Section */}
      <div className="flex items-center justify-between px-3 h-7 min-h-[28px] select-none border-b border-cad-border bg-cad-surface">
        <span className="text-xs font-semibold text-cad-text">Properties</span>
      </div>
      <div className="flex-1 overflow-y-auto">
        <PropertiesPanel />
      </div>
    </div>
  );
}
