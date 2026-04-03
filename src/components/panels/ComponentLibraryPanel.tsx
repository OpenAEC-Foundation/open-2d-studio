/**
 * ComponentLibraryPanel — browse and manage the component definition library.
 *
 * Features:
 *  - Search bar to filter by name
 *  - Definitions grouped by category (collapsible sections)
 *  - Each row: name + parameter count
 *  - Click to select (placement), double-click to edit, right-click to export
 *  - "New Component" and "Import" buttons at the top
 */

import React, { useState, useCallback, useMemo } from 'react';
import { Search, Plus, Upload, Download, ChevronDown, ChevronRight } from 'lucide-react';
import type { ComponentDefinition, ComponentCategory } from '../../types/component';

// ── Category labels ────────────────────────────────────────────────────────────

const CATEGORY_LABELS: Record<ComponentCategory, string> = {
  'structural-steel': 'Structural Steel',
  'structural-concrete': 'Structural Concrete',
  'structural-timber': 'Structural Timber',
  reinforcement: 'Reinforcement',
  foundation: 'Foundation',
  architectural: 'Architectural',
  MEP: 'MEP',
  detail: 'Detail',
  annotation: 'Annotation',
  custom: 'Custom',
};

const CATEGORY_ORDER: ComponentCategory[] = [
  'structural-steel',
  'structural-concrete',
  'structural-timber',
  'reinforcement',
  'foundation',
  'architectural',
  'MEP',
  'detail',
  'annotation',
  'custom',
];

// ── Props ──────────────────────────────────────────────────────────────────────

export interface ComponentLibraryPanelProps {
  definitions: ComponentDefinition[];
  onSelect: (definition: ComponentDefinition) => void;
  onNew: () => void;
  onImport: () => void;
  onExport: (definition: ComponentDefinition) => void;
  onEdit: (definition: ComponentDefinition) => void;
}

// ── Context menu state ─────────────────────────────────────────────────────────

interface ContextMenu {
  x: number;
  y: number;
  definition: ComponentDefinition;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function ComponentLibraryPanel({
  definitions,
  onSelect,
  onNew,
  onImport,
  onExport,
  onEdit,
}: ComponentLibraryPanelProps): React.ReactElement {
  const [search, setSearch] = useState('');
  const [collapsedCategories, setCollapsedCategories] = useState<Set<ComponentCategory>>(
    new Set(),
  );
  const [contextMenu, setContextMenu] = useState<ContextMenu | null>(null);

  // ── Filtering ──────────────────────────────────────────────────────────────

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return definitions;
    return definitions.filter(
      (d) =>
        d.name.toLowerCase().includes(q) ||
        d.description?.toLowerCase().includes(q) ||
        d.tags?.some((t) => t.toLowerCase().includes(q)),
    );
  }, [definitions, search]);

  // ── Grouping ───────────────────────────────────────────────────────────────

  const grouped = useMemo(() => {
    const map = new Map<ComponentCategory, ComponentDefinition[]>();
    for (const def of filtered) {
      const list = map.get(def.category) ?? [];
      list.push(def);
      map.set(def.category, list);
    }
    return map;
  }, [filtered]);

  // ── Handlers ──────────────────────────────────────────────────────────────

  const toggleCategory = useCallback((cat: ComponentCategory) => {
    setCollapsedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) {
        next.delete(cat);
      } else {
        next.add(cat);
      }
      return next;
    });
  }, []);

  const handleContextMenu = useCallback(
    (e: React.MouseEvent, definition: ComponentDefinition) => {
      e.preventDefault();
      setContextMenu({ x: e.clientX, y: e.clientY, definition });
    },
    [],
  );

  const handleContextMenuExport = useCallback(() => {
    if (contextMenu) {
      onExport(contextMenu.definition);
      setContextMenu(null);
    }
  }, [contextMenu, onExport]);

  const handleContextMenuEdit = useCallback(() => {
    if (contextMenu) {
      onEdit(contextMenu.definition);
      setContextMenu(null);
    }
  }, [contextMenu, onEdit]);

  const dismissContextMenu = useCallback(() => setContextMenu(null), []);

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div
      className="flex flex-col h-full select-none"
      style={{ background: '#111827', color: '#e5e7eb' }}
      onClick={dismissContextMenu}
    >
      {/* Top toolbar */}
      <div
        className="flex items-center gap-1 px-2 py-2 border-b"
        style={{ borderColor: '#1f2937' }}
      >
        <button
          title="New Component"
          onClick={onNew}
          className="flex items-center gap-1 px-2 py-1 rounded text-xs font-medium transition-colors"
          style={{ background: '#1d4ed8', color: '#fff' }}
          onMouseEnter={(e) => ((e.currentTarget as HTMLButtonElement).style.background = '#2563eb')}
          onMouseLeave={(e) => ((e.currentTarget as HTMLButtonElement).style.background = '#1d4ed8')}
        >
          <Plus size={12} />
          New
        </button>
        <button
          title="Import Component"
          onClick={onImport}
          className="flex items-center gap-1 px-2 py-1 rounded text-xs font-medium transition-colors"
          style={{ background: '#374151', color: '#e5e7eb' }}
          onMouseEnter={(e) => ((e.currentTarget as HTMLButtonElement).style.background = '#4b5563')}
          onMouseLeave={(e) => ((e.currentTarget as HTMLButtonElement).style.background = '#374151')}
        >
          <Upload size={12} />
          Import
        </button>
      </div>

      {/* Search bar */}
      <div className="px-2 py-2 border-b" style={{ borderColor: '#1f2937' }}>
        <div className="flex items-center gap-1 px-2 py-1 rounded" style={{ background: '#1f2937' }}>
          <Search size={12} style={{ color: '#6b7280', flexShrink: 0 }} />
          <input
            type="text"
            placeholder="Search components..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="bg-transparent border-none outline-none text-xs w-full"
            style={{ color: '#e5e7eb' }}
          />
        </div>
      </div>

      {/* Definition list */}
      <div className="flex-1 overflow-y-auto">
        {filtered.length === 0 ? (
          <div
            className="flex flex-col items-center justify-center py-10 text-xs"
            style={{ color: '#6b7280' }}
          >
            <span>No components found</span>
            {search && (
              <button
                className="mt-2 underline"
                style={{ color: '#6b7280' }}
                onClick={() => setSearch('')}
              >
                Clear search
              </button>
            )}
          </div>
        ) : (
          CATEGORY_ORDER.filter((cat) => grouped.has(cat)).map((cat) => {
            const items = grouped.get(cat)!;
            const collapsed = collapsedCategories.has(cat);
            return (
              <CategorySection
                key={cat}
                category={cat}
                label={CATEGORY_LABELS[cat]}
                items={items}
                collapsed={collapsed}
                onToggle={() => toggleCategory(cat)}
                onSelect={onSelect}
                onEdit={onEdit}
                onContextMenu={handleContextMenu}
              />
            );
          })
        )}
      </div>

      {/* Footer: total count */}
      <div
        className="px-3 py-1 text-xs border-t"
        style={{ borderColor: '#1f2937', color: '#6b7280' }}
      >
        {definitions.length} component{definitions.length !== 1 ? 's' : ''}
        {search && ` (${filtered.length} matching)`}
      </div>

      {/* Context menu */}
      {contextMenu && (
        <ContextMenuPopup
          x={contextMenu.x}
          y={contextMenu.y}
          onEdit={handleContextMenuEdit}
          onExport={handleContextMenuExport}
          onDismiss={dismissContextMenu}
        />
      )}
    </div>
  );
}

// ── CategorySection ────────────────────────────────────────────────────────────

interface CategorySectionProps {
  category: ComponentCategory;
  label: string;
  items: ComponentDefinition[];
  collapsed: boolean;
  onToggle: () => void;
  onSelect: (d: ComponentDefinition) => void;
  onEdit: (d: ComponentDefinition) => void;
  onContextMenu: (e: React.MouseEvent, d: ComponentDefinition) => void;
}

function CategorySection({
  label,
  items,
  collapsed,
  onToggle,
  onSelect,
  onEdit,
  onContextMenu,
}: CategorySectionProps): React.ReactElement {
  return (
    <div>
      {/* Category header */}
      <button
        className="flex items-center gap-1 w-full px-2 py-1 text-left text-xs font-semibold transition-colors"
        style={{ background: '#1f2937', color: '#9ca3af' }}
        onMouseEnter={(e) => ((e.currentTarget as HTMLButtonElement).style.background = '#374151')}
        onMouseLeave={(e) => ((e.currentTarget as HTMLButtonElement).style.background = '#1f2937')}
        onClick={onToggle}
      >
        {collapsed ? (
          <ChevronRight size={10} style={{ flexShrink: 0 }} />
        ) : (
          <ChevronDown size={10} style={{ flexShrink: 0 }} />
        )}
        <span className="uppercase tracking-wide" style={{ fontSize: '10px' }}>
          {label}
        </span>
        <span className="ml-auto" style={{ color: '#6b7280', fontWeight: 400 }}>
          {items.length}
        </span>
      </button>

      {/* Items */}
      {!collapsed && (
        <div>
          {items.map((def) => (
            <DefinitionRow
              key={def.id}
              definition={def}
              onSelect={onSelect}
              onEdit={onEdit}
              onContextMenu={onContextMenu}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ── DefinitionRow ──────────────────────────────────────────────────────────────

interface DefinitionRowProps {
  definition: ComponentDefinition;
  onSelect: (d: ComponentDefinition) => void;
  onEdit: (d: ComponentDefinition) => void;
  onContextMenu: (e: React.MouseEvent, d: ComponentDefinition) => void;
}

function DefinitionRow({
  definition,
  onSelect,
  onEdit,
  onContextMenu,
}: DefinitionRowProps): React.ReactElement {
  const [hovered, setHovered] = useState(false);

  return (
    <div
      className="flex items-center px-3 py-1 cursor-pointer text-xs"
      style={{
        background: hovered ? '#1f2937' : 'transparent',
        color: '#e5e7eb',
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={() => onSelect(definition)}
      onDoubleClick={() => onEdit(definition)}
      onContextMenu={(e) => onContextMenu(e, definition)}
      title={definition.description ?? definition.name}
    >
      <span className="flex-1 truncate">{definition.name}</span>
      <span
        className="ml-2 flex-shrink-0 text-right tabular-nums"
        style={{ color: '#6b7280', fontSize: '10px' }}
      >
        {definition.parameters.length}p
      </span>
    </div>
  );
}

// ── ContextMenuPopup ───────────────────────────────────────────────────────────

interface ContextMenuPopupProps {
  x: number;
  y: number;
  onEdit: () => void;
  onExport: () => void;
  onDismiss: () => void;
}

function ContextMenuPopup({
  x,
  y,
  onEdit,
  onExport,
  onDismiss,
}: ContextMenuPopupProps): React.ReactElement {
  return (
    <>
      {/* Invisible backdrop */}
      <div
        className="fixed inset-0 z-40"
        onClick={onDismiss}
        onContextMenu={(e) => {
          e.preventDefault();
          onDismiss();
        }}
      />
      <div
        className="fixed z-50 rounded shadow-lg py-1 text-xs"
        style={{
          left: x,
          top: y,
          background: '#1f2937',
          border: '1px solid #374151',
          color: '#e5e7eb',
          minWidth: 120,
        }}
      >
        <ContextMenuItem label="Edit" onClick={onEdit} />
        <ContextMenuItem label="Export" icon={<Download size={10} />} onClick={onExport} />
      </div>
    </>
  );
}

interface ContextMenuItemProps {
  label: string;
  icon?: React.ReactNode;
  onClick: () => void;
}

function ContextMenuItem({ label, icon, onClick }: ContextMenuItemProps): React.ReactElement {
  const [hovered, setHovered] = useState(false);
  return (
    <button
      className="flex items-center gap-2 w-full px-3 py-1 text-left"
      style={{ background: hovered ? '#374151' : 'transparent', color: '#e5e7eb' }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={onClick}
    >
      {icon}
      {label}
    </button>
  );
}
