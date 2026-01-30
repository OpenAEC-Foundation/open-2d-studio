import {
  ZoomIn,
  ZoomOut,
  Maximize,
  Grid3X3,
  Save,
  FolderOpen,
  Undo,
  Redo,
  Trash2,
  Printer,
  Settings,
} from 'lucide-react';
import { useAppStore } from '../../state/appStore';

interface ToolButtonProps {
  icon: React.ReactNode;
  label: string;
  active?: boolean;
  onClick: () => void;
  disabled?: boolean;
}

function ToolButton({ icon, label, active, onClick, disabled }: ToolButtonProps) {
  return (
    <button
      className={`p-2 rounded hover:bg-cad-border transition-colors cursor-default ${
        active ? 'bg-cad-accent text-white' : 'text-cad-text'
      } ${disabled ? 'opacity-50 !cursor-not-allowed' : ''}`}
      onClick={onClick}
      disabled={disabled}
      title={label}
    >
      {icon}
    </button>
  );
}

function Separator() {
  return <div className="w-px h-6 bg-cad-border mx-1" />;
}

export function Toolbar() {
  const {
    gridVisible,
    toggleGrid,
    zoomIn,
    zoomOut,
    zoomToFit,
    deleteSelectedShapes,
    selectedShapeIds,
    undo,
    redo,
    setPrintDialogOpen,
    setSnapSettingsOpen,
  } = useAppStore();

  const canUndo = useAppStore(s => s.canUndo());
  const canRedo = useAppStore(s => s.canRedo());

  return (
    <div className="h-12 bg-cad-surface border-b border-cad-border flex items-center px-2 gap-1">
      {/* File operations */}
      <ToolButton
        icon={<FolderOpen size={18} />}
        label="Open (Ctrl+O)"
        onClick={() => console.log('Open')}
      />
      <ToolButton
        icon={<Save size={18} />}
        label="Save (Ctrl+S)"
        onClick={() => console.log('Save')}
      />
      <ToolButton
        icon={<Printer size={18} />}
        label="Print/Plot (Ctrl+P)"
        onClick={() => setPrintDialogOpen(true)}
      />

      <Separator />

      {/* Undo/Redo */}
      <ToolButton
        icon={<Undo size={18} />}
        label="Undo (Ctrl+Z)"
        onClick={undo}
        disabled={!canUndo}
      />
      <ToolButton
        icon={<Redo size={18} />}
        label="Redo (Ctrl+Y)"
        onClick={redo}
        disabled={!canRedo}
      />

      <Separator />

      {/* Delete */}
      <ToolButton
        icon={<Trash2 size={18} />}
        label="Delete (Del)"
        onClick={deleteSelectedShapes}
        disabled={selectedShapeIds.length === 0}
      />

      <Separator />

      {/* View controls */}
      <ToolButton
        icon={<ZoomIn size={18} />}
        label="Zoom In (+)"
        onClick={zoomIn}
      />
      <ToolButton
        icon={<ZoomOut size={18} />}
        label="Zoom Out (-)"
        onClick={zoomOut}
      />
      <ToolButton
        icon={<Maximize size={18} />}
        label="Zoom to Fit (F)"
        onClick={zoomToFit}
      />

      <Separator />

      {/* Grid & Snap Settings */}
      <ToolButton
        icon={<Grid3X3 size={18} />}
        label="Toggle Grid (G)"
        active={gridVisible}
        onClick={toggleGrid}
      />
      <ToolButton
        icon={<Settings size={18} />}
        label="Object Snap Settings"
        onClick={() => setSnapSettingsOpen(true)}
      />

    </div>
  );
}
