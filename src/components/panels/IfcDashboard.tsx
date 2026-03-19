/**
 * IFC Dashboard - Full-screen overlay showing IFC spatial structure graph and raw STEP text
 *
 * Displayed when the IFC tab is active in the ribbon. Shows:
 * - Left pane: Interactive IFC spatial structure tree/graph
 * - Right pane: Raw IFC4 STEP file content with syntax highlighting
 */

import { memo, useState, useCallback, useRef, useMemo, useEffect } from 'react';
import { ChevronDown, ChevronRight, Copy, Download, RefreshCw, X, FileCode, FileJson } from 'lucide-react';
import { useAppStore } from '../../state/appStore';
import type { Shape, BeamShape, Drawing } from '../../types/geometry';
import type { ProjectStructure, ProjectBuilding, ProjectStorey } from '../../state/slices/parametricSlice';

// ============================================================================
// IFC class mapping (mirrors Ribbon.tsx logic)
// ============================================================================

function shapeToIfcClass(shape: Shape): string {
  switch (shape.type) {
    case 'wall': return 'IfcWall';
    case 'beam': {
      const beam = shape as BeamShape;
      return beam.viewMode === 'section' ? 'IfcColumn' : 'IfcBeam';
    }
    case 'slab': return 'IfcSlab';
    case 'pile': return 'IfcPile';
    case 'cpt': return 'IfcBuildingElementProxy';
    case 'foundation-zone': return 'IfcBuildingElementProxy';
    case 'gridline': return 'IfcGrid';
    case 'level': return 'IfcBuildingStorey';
    case 'spot-elevation': return 'IfcAnnotation';
    case 'space': return 'IfcSpace';
    case 'line':
    case 'arc':
    case 'circle':
    case 'polyline':
    case 'rectangle':
    case 'dimension':
    case 'text':
    case 'section-callout':
      return 'IfcAnnotation';
    default:
      return 'Other';
  }
}

interface IfcClassGroup {
  ifcClass: string;
  shapeIds: string[];
}

function groupShapesByClass(shapes: Shape[]): IfcClassGroup[] {
  const map = new Map<string, string[]>();
  for (const s of shapes) {
    const cls = shapeToIfcClass(s);
    if (cls === 'Other') continue;
    const ids = map.get(cls) || [];
    ids.push(s.id);
    map.set(cls, ids);
  }
  const order = [
    'IfcWall', 'IfcColumn', 'IfcBeam', 'IfcSlab', 'IfcPile',
    'IfcSpace', 'IfcGrid', 'IfcBuildingStorey', 'IfcBuildingElementProxy', 'IfcAnnotation',
  ];
  return Array.from(map.entries())
    .sort((a, b) => {
      const ia = order.indexOf(a[0]);
      const ib = order.indexOf(b[0]);
      return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
    })
    .map(([ifcClass, shapeIds]) => ({ ifcClass, shapeIds }));
}

// ============================================================================
// IFC entity type colors for badges and graph nodes
// ============================================================================

const IFC_CLASS_COLORS: Record<string, string> = {
  IfcProject: '#a78bfa',
  IfcSite: '#34d399',
  IfcBuilding: '#60a5fa',
  IfcBuildingStorey: '#fbbf24',
  IfcWall: '#f87171',
  IfcColumn: '#fb923c',
  IfcBeam: '#fb923c',
  IfcSlab: '#a3e635',
  IfcPile: '#c084fc',
  IfcSpace: '#22d3ee',
  IfcGrid: '#94a3b8',
  IfcAnnotation: '#9ca3af',
  IfcBuildingElementProxy: '#d1d5db',
};

function getClassColor(cls: string): string {
  return IFC_CLASS_COLORS[cls] || '#6b7280';
}

// ============================================================================
// Tree Node Component
// ============================================================================

interface TreeNodeProps {
  label: string;
  entityType: string;
  badge?: string | number;
  children?: React.ReactNode;
  defaultOpen?: boolean;
  depth?: number;
  onSelect?: () => void;
  selected?: boolean;
}

function TreeNode({ label, entityType, badge, children, defaultOpen = true, depth = 0, onSelect, selected }: TreeNodeProps) {
  const [open, setOpen] = useState(defaultOpen);
  const hasChildren = !!children;
  const color = getClassColor(entityType);

  return (
    <div style={{ paddingLeft: depth > 0 ? 16 : 0 }}>
      {/* Connecting line for child nodes */}
      {depth > 0 && (
        <div
          style={{
            position: 'absolute',
            left: depth * 16 - 8,
            width: 1,
            height: '100%',
            backgroundColor: 'var(--cad-border)',
            opacity: 0.3,
          }}
        />
      )}
      <div
        className={`ifc-dashboard-tree-node ${selected ? 'selected' : ''}`}
        onClick={(e) => {
          e.stopPropagation();
          if (hasChildren) setOpen(!open);
          onSelect?.();
        }}
        style={{ cursor: hasChildren || onSelect ? 'pointer' : 'default' }}
      >
        {hasChildren ? (
          open ? <ChevronDown size={12} style={{ color, flexShrink: 0 }} /> : <ChevronRight size={12} style={{ color, flexShrink: 0 }} />
        ) : (
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: '50%',
              backgroundColor: color,
              flexShrink: 0,
              display: 'inline-block',
            }}
          />
        )}
        <span className="ifc-dashboard-tree-type" style={{ color }}>
          {entityType}
        </span>
        <span className="ifc-dashboard-tree-label">{label}</span>
        {badge !== undefined && (
          <span className="ifc-dashboard-tree-badge">{badge}</span>
        )}
      </div>
      {hasChildren && open && (
        <div className="ifc-dashboard-tree-children" style={{ position: 'relative' }}>
          {children}
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Storey resolution for dashboard display
// Mirrors the logic in ifcGenerator.resolveStoreyForShape so the tree
// accurately reflects which storey each shape will be assigned to in IFC.
// ============================================================================

/** Resolve which projectStructure storey ID a shape belongs to, or null for default. */
function resolveShapeStoreyId(shape: Shape, drawings: Drawing[], projectStructure: ProjectStructure): string | null {
  // Collect all storey IDs for quick lookup
  const allStoreyIds = new Set<string>();
  for (const building of projectStructure.buildings) {
    for (const storey of building.storeys) {
      allStoreyIds.add(storey.id);
    }
  }

  // 1. Shape's own baseLevel or level
  const shapeStoreyId = (shape as any).baseLevel || (shape as any).level;
  if (shapeStoreyId && shapeStoreyId !== 'unconnected' && allStoreyIds.has(shapeStoreyId)) {
    return shapeStoreyId;
  }

  // 2. Drawing's storeyId (for plan drawings)
  const drawing = drawings.find(d => d.id === shape.drawingId);
  if (drawing?.drawingType === 'plan' && drawing.storeyId && allStoreyIds.has(drawing.storeyId)) {
    return drawing.storeyId;
  }

  return null; // default storey
}

/** Group shapes by storey ID. Key null = default/unassigned storey. */
function groupShapesByStorey(
  shapes: Shape[],
  drawings: Drawing[],
  projectStructure: ProjectStructure
): Map<string | null, Shape[]> {
  const map = new Map<string | null, Shape[]>();
  for (const shape of shapes) {
    const cls = shapeToIfcClass(shape);
    if (cls === 'Other') continue;
    // Skip section-reference shapes (same filter as ifcGenerator)
    if (shape.id.startsWith('section-ref-')) continue;
    const storeyId = resolveShapeStoreyId(shape, drawings, projectStructure);
    const list = map.get(storeyId) || [];
    list.push(shape);
    map.set(storeyId, list);
  }
  return map;
}

// ============================================================================
// IFC Graph (Spatial Structure Tree)
// ============================================================================

interface IfcGraphProps {
  shapes: Shape[];
  drawings: Drawing[];
  projectStructure: ProjectStructure;
  onSelectShapes: (ids: string[]) => void;
  selectedClass: string | null;
}

function IfcGraph({ shapes, drawings, projectStructure, onSelectShapes, selectedClass }: IfcGraphProps) {
  const grouped = useMemo(() => groupShapesByClass(shapes), [shapes]);
  const totalElements = useMemo(() => grouped.reduce((sum, g) => sum + g.shapeIds.length, 0), [grouped]);

  // Group shapes by their resolved storey
  const shapesByStorey = useMemo(
    () => groupShapesByStorey(shapes, drawings, projectStructure),
    [shapes, drawings, projectStructure]
  );

  // Find the default storey (closest to elevation 0), matching ifcGenerator logic
  const defaultStoreyId = useMemo(() => {
    let closestId: string | null = null;
    let closestDist = Infinity;
    for (const building of projectStructure.buildings) {
      for (const storey of building.storeys) {
        const dist = Math.abs(storey.elevation);
        if (dist < closestDist) {
          closestDist = dist;
          closestId = storey.id;
        }
      }
    }
    return closestId;
  }, [projectStructure]);

  /** Get IFC class groups for shapes assigned to a specific storey (null = default). */
  const groupedForStorey = useCallback((storeyId: string | null): IfcClassGroup[] => {
    let storeyShapes = shapesByStorey.get(storeyId) || [];
    // When querying a real storey that is the default, also include unassigned (null) shapes
    if (storeyId !== null && storeyId === defaultStoreyId) {
      const defaultShapes = shapesByStorey.get(null) || [];
      if (defaultShapes.length > 0) {
        storeyShapes = [...storeyShapes, ...defaultShapes];
      }
    }
    return groupShapesByClass(storeyShapes);
  }, [shapesByStorey, defaultStoreyId]);

  return (
    <div className="ifc-dashboard-graph">
      <TreeNode
        entityType="IfcProject"
        label={projectStructure.siteName ? `Project (${projectStructure.siteName})` : 'Default Project'}
        badge={`${totalElements} elements`}
        defaultOpen
        depth={0}
      >
        <TreeNode
          entityType="IfcSite"
          label={projectStructure.siteName || 'Default Site'}
          depth={1}
          defaultOpen
        >
          {projectStructure.buildings.map((building: ProjectBuilding) => (
            <TreeNode
              key={building.id}
              entityType="IfcBuilding"
              label={building.name}
              depth={1}
              defaultOpen
            >
              {building.storeys.length > 0 ? (
                building.storeys
                  .slice()
                  .sort((a: ProjectStorey, b: ProjectStorey) => b.elevation - a.elevation)
                  .map((storey: ProjectStorey) => {
                    const storeyGroups = groupedForStorey(storey.id);
                    const storeyCount = storeyGroups.reduce((sum, g) => sum + g.shapeIds.length, 0);
                    return (
                      <TreeNode
                        key={storey.id}
                        entityType="IfcBuildingStorey"
                        label={storey.name}
                        badge={`${storey.elevation >= 0 ? '+' : ''}${storey.elevation} mm${storeyCount > 0 ? ` | ${storeyCount}` : ''}`}
                        depth={1}
                        defaultOpen
                      >
                        {storeyGroups.map((g) => (
                          <TreeNode
                            key={g.ifcClass}
                            entityType={g.ifcClass}
                            label={`(${g.shapeIds.length})`}
                            badge={g.shapeIds.length}
                            depth={1}
                            selected={selectedClass === g.ifcClass}
                            onSelect={() => onSelectShapes(g.shapeIds)}
                          />
                        ))}
                      </TreeNode>
                    );
                  })
              ) : (
                (() => {
                  const defaultGroups = groupedForStorey(null);
                  return (
                    <TreeNode
                      entityType="IfcBuildingStorey"
                      label="Ground Floor"
                      badge="+0 mm"
                      depth={1}
                      defaultOpen
                    >
                      {defaultGroups.map((g) => (
                        <TreeNode
                          key={g.ifcClass}
                          entityType={g.ifcClass}
                          label={`(${g.shapeIds.length})`}
                          badge={g.shapeIds.length}
                          depth={1}
                          selected={selectedClass === g.ifcClass}
                          onSelect={() => onSelectShapes(g.shapeIds)}
                        />
                      ))}
                    </TreeNode>
                  );
                })()
              )}
            </TreeNode>
          ))}
        </TreeNode>

        {/* Summary */}
        {grouped.length > 0 && (
          <div className="ifc-dashboard-summary">
            {grouped.map((g) => (
              <span
                key={g.ifcClass}
                className="ifc-dashboard-summary-chip"
                style={{ borderColor: getClassColor(g.ifcClass), color: getClassColor(g.ifcClass) }}
              >
                {g.ifcClass.replace('Ifc', '')}: {g.shapeIds.length}
              </span>
            ))}
          </div>
        )}
      </TreeNode>
    </div>
  );
}

// ============================================================================
// STEP Syntax Highlighted Viewer
// ============================================================================

interface StepLine {
  lineNumber: number;
  text: string;
}

function highlightStepLine(text: string): React.ReactNode {
  // Entity references: #123
  // String values: '...'
  // Section headers: HEADER; DATA; END-ISO-10303-21;
  // Entity types: IFCWALL, IFCBEAM, etc.
  // Comments: /* ... */

  const parts: React.ReactNode[] = [];
  let remaining = text;
  let key = 0;

  // Header/section keywords
  if (/^(ISO-10303-21|HEADER|ENDSEC|DATA|END-ISO-10303-21);?\s*$/.test(remaining.trim())) {
    return <span key={key} className="step-keyword">{text}</span>;
  }

  // FILE_DESCRIPTION, FILE_NAME, FILE_SCHEMA lines
  if (/^FILE_(DESCRIPTION|NAME|SCHEMA)\b/.test(remaining.trim())) {
    const match = remaining.match(/^(FILE_\w+)/);
    if (match) {
      parts.push(<span key={key++} className="step-keyword">{match[1]}</span>);
      remaining = remaining.slice(match[1].length);
    }
  }

  // Process character by character for the rest
  let i = 0;
  let buffer = '';
  while (i < remaining.length) {
    const ch = remaining[i];

    // Entity reference: #digits
    if (ch === '#' && i + 1 < remaining.length && /\d/.test(remaining[i + 1])) {
      if (buffer) { parts.push(<span key={key++}>{buffer}</span>); buffer = ''; }
      let ref = '#';
      i++;
      while (i < remaining.length && /\d/.test(remaining[i])) {
        ref += remaining[i];
        i++;
      }
      parts.push(<span key={key++} className="step-entity-ref">{ref}</span>);
      continue;
    }

    // String literal: '...'
    if (ch === "'") {
      if (buffer) { parts.push(<span key={key++}>{buffer}</span>); buffer = ''; }
      let str = "'";
      i++;
      while (i < remaining.length) {
        if (remaining[i] === "'" && remaining[i + 1] === "'") {
          str += "''";
          i += 2;
        } else if (remaining[i] === "'") {
          str += "'";
          i++;
          break;
        } else {
          str += remaining[i];
          i++;
        }
      }
      parts.push(<span key={key++} className="step-string">{str}</span>);
      continue;
    }

    // IFC entity type: IFCWORD (uppercase after = sign or at line start with #ID=)
    if (ch === '=' && i + 1 < remaining.length) {
      buffer += ch;
      i++;
      // Skip whitespace after =
      while (i < remaining.length && remaining[i] === ' ') {
        buffer += remaining[i];
        i++;
      }
      if (buffer) { parts.push(<span key={key++}>{buffer}</span>); buffer = ''; }
      // Capture the IFC entity type
      if (i < remaining.length && /[A-Z]/.test(remaining[i])) {
        let entityType = '';
        while (i < remaining.length && /[A-Z0-9_]/.test(remaining[i])) {
          entityType += remaining[i];
          i++;
        }
        parts.push(<span key={key++} className="step-entity-type">{entityType}</span>);
      }
      continue;
    }

    // Enum values: .VALUE.
    if (ch === '.' && i + 1 < remaining.length && /[A-Z$]/.test(remaining[i + 1])) {
      if (buffer) { parts.push(<span key={key++}>{buffer}</span>); buffer = ''; }
      let enumVal = '.';
      i++;
      while (i < remaining.length && remaining[i] !== '.') {
        enumVal += remaining[i];
        i++;
      }
      if (i < remaining.length) {
        enumVal += '.';
        i++;
      }
      parts.push(<span key={key++} className="step-enum">{enumVal}</span>);
      continue;
    }

    // Comment: /* ... */
    if (ch === '/' && i + 1 < remaining.length && remaining[i + 1] === '*') {
      if (buffer) { parts.push(<span key={key++}>{buffer}</span>); buffer = ''; }
      let comment = '/*';
      i += 2;
      while (i < remaining.length) {
        if (remaining[i] === '*' && i + 1 < remaining.length && remaining[i + 1] === '/') {
          comment += '*/';
          i += 2;
          break;
        }
        comment += remaining[i];
        i++;
      }
      parts.push(<span key={key++} className="step-comment">{comment}</span>);
      continue;
    }

    buffer += ch;
    i++;
  }

  if (buffer) { parts.push(<span key={key++}>{buffer}</span>); }

  return <>{parts}</>;
}

interface StepViewerProps {
  content: string;
}

function StepViewer({ content }: StepViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [copied, setCopied] = useState(false);

  const lines: StepLine[] = useMemo(() => {
    if (!content) return [];
    return content.split('\n').map((text, i) => ({ lineNumber: i + 1, text }));
  }, [content]);

  const handleCopy = useCallback(async () => {
    if (!content) return;
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback
      const ta = document.createElement('textarea');
      ta.value = content;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }, [content]);

  const handleExport = useCallback(() => {
    if (!content) return;
    const blob = new Blob([content], { type: 'application/x-step' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'model.ifc';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [content]);

  if (!content) {
    return (
      <div className="ifc-dashboard-step-empty">
        <p>No IFC content generated yet.</p>
        <p className="ifc-dashboard-step-empty-hint">
          Add structural elements to the canvas and the IFC model will be generated automatically.
        </p>
      </div>
    );
  }

  return (
    <div className="ifc-dashboard-step-container">
      {/* Toolbar */}
      <div className="ifc-dashboard-step-toolbar">
        <span className="ifc-dashboard-step-stats">
          {lines.length} lines | {content.length < 1024 ? `${content.length} B` : content.length < 1048576 ? `${(content.length / 1024).toFixed(1)} KB` : `${(content.length / 1048576).toFixed(2)} MB`}
          {' | IFC4 (ISO 16739-1:2018)'}
        </span>
        <div className="ifc-dashboard-step-actions">
          <button
            className="ifc-dashboard-btn"
            onClick={handleCopy}
            title="Copy to clipboard"
          >
            <Copy size={12} />
            {copied ? 'Copied!' : 'Copy'}
          </button>
          <button
            className="ifc-dashboard-btn"
            onClick={handleExport}
            title="Export as .ifc file"
          >
            <Download size={12} />
            Export .ifc
          </button>
        </div>
      </div>

      {/* Code viewer */}
      <div className="ifc-dashboard-step-code" ref={containerRef}>
        <table className="ifc-dashboard-step-table">
          <tbody>
            {lines.map((line) => (
              <tr key={line.lineNumber}>
                <td className="ifc-dashboard-step-linenum">{line.lineNumber}</td>
                <td className="ifc-dashboard-step-text">
                  {highlightStepLine(line.text)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ============================================================================
// IFCX JSON Viewer
// ============================================================================

interface IfcxViewerProps {
  content: string;
}

function IfcxViewer({ content }: IfcxViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    if (!content) return;
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = content;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }, [content]);

  const handleExport = useCallback(() => {
    if (!content) return;
    const blob = new Blob([content], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'model.ifcx';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [content]);

  if (!content) {
    return (
      <div className="ifc-dashboard-step-empty">
        <p>No IFCX content generated yet.</p>
        <p className="ifc-dashboard-step-empty-hint">
          Add structural elements to the canvas and the IFCX model will be generated automatically.
        </p>
      </div>
    );
  }

  return (
    <div className="ifc-dashboard-step-container">
      {/* Toolbar */}
      <div className="ifc-dashboard-step-toolbar">
        <span className="ifc-dashboard-step-stats">
          {content.length < 1024 ? `${content.length} B` : content.length < 1048576 ? `${(content.length / 1024).toFixed(1)} KB` : `${(content.length / 1048576).toFixed(2)} MB`}
          {' | IFCX JSON'}
        </span>
        <div className="ifc-dashboard-step-actions">
          <button
            className="ifc-dashboard-btn"
            onClick={handleCopy}
            title="Copy to clipboard"
          >
            <Copy size={12} />
            {copied ? 'Copied!' : 'Copy'}
          </button>
          <button
            className="ifc-dashboard-btn"
            onClick={handleExport}
            title="Export as .ifcx file"
          >
            <Download size={12} />
            Export .ifcx
          </button>
        </div>
      </div>

      {/* JSON viewer with syntax highlighting */}
      <div className="ifc-dashboard-step-code" ref={containerRef}>
        <pre className="ifc-dashboard-ifcx-json">{highlightJson(content)}</pre>
      </div>
    </div>
  );
}

/** Simple JSON syntax highlighter */
function highlightJson(json: string): React.ReactNode {
  const parts: React.ReactNode[] = [];
  let key = 0;
  // Regex-based token highlighting
  const tokenRegex = /("(?:\\.|[^"\\])*"\s*:)|("(?:\\.|[^"\\])*")|(true|false|null)|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|([{}[\],])/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = tokenRegex.exec(json)) !== null) {
    // Text before match
    if (match.index > lastIndex) {
      parts.push(<span key={key++}>{json.slice(lastIndex, match.index)}</span>);
    }

    if (match[1]) {
      // Object key (with colon)
      const colonIdx = match[1].lastIndexOf(':');
      const keyPart = match[1].slice(0, colonIdx);
      parts.push(<span key={key++} className="step-entity-type">{keyPart}</span>);
      parts.push(<span key={key++}>{match[1].slice(colonIdx)}</span>);
    } else if (match[2]) {
      // String value
      parts.push(<span key={key++} className="step-string">{match[2]}</span>);
    } else if (match[3]) {
      // Boolean / null
      parts.push(<span key={key++} className="step-enum">{match[3]}</span>);
    } else if (match[4]) {
      // Number
      parts.push(<span key={key++} className="step-entity-ref">{match[4]}</span>);
    } else if (match[5]) {
      // Punctuation
      parts.push(<span key={key++} className="step-keyword">{match[5]}</span>);
    }

    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < json.length) {
    parts.push(<span key={key++}>{json.slice(lastIndex)}</span>);
  }

  return <>{parts}</>;
}

// ============================================================================
// Main IFC Dashboard Component
// ============================================================================

type RawViewerTab = 'step' | 'ifcx';

export const IfcDashboard = memo(function IfcDashboard() {
  const shapes = useAppStore((s) => s.shapes);
  const drawings = useAppStore((s) => s.drawings);
  const projectStructure = useAppStore((s) => s.projectStructure);
  const ifcContent = useAppStore((s) => s.ifcContent);
  const ifcEntityCount = useAppStore((s) => s.ifcEntityCount);
  const ifcFileSize = useAppStore((s) => s.ifcFileSize);
  const regenerateIFC = useAppStore((s) => s.regenerateIFC);
  const setIfcDashboardVisible = useAppStore((s) => s.setIfcDashboardVisible);
  const selectShapes = useAppStore((s) => s.selectShapes);

  const [selectedClass, setSelectedClass] = useState<string | null>(null);
  const [activeViewerTab, setActiveViewerTab] = useState<RawViewerTab>('step');
  const [ifcxContent, setIfcxContent] = useState<string>('');

  // Generate IFCX content dynamically
  const generateIfcxContent = useCallback(() => {
    try {
      // Try to use the AEC extension's generateIFCX if available
      const aecExt = (window as any).__aecExtension;
      if (aecExt?.generateIFCX) {
        const result = aecExt.generateIFCX();
        setIfcxContent(result.content || '');
        return;
      }

      // Fallback: generate a basic IFCX structure in-app
      const state = useAppStore.getState();
      const timestamp = new Date().toISOString();
      const entities: any[] = [];

      for (const shape of state.shapes) {
        if (shape.id.startsWith('section-ref-')) continue;
        const ifcClass = shapeToIfcClass(shape);
        if (ifcClass === 'Other') continue;
        entities.push({
          type: ifcClass,
          globalId: shape.id,
          name: (shape as any).label || (shape as any).name || shape.type,
          attributes: { shapeType: shape.type },
        });
      }

      const doc = {
        schema: 'IFCX',
        version: '0.1',
        header: {
          description: 'IFCX export from Open 2D Studio',
          name: state.projectName || 'Untitled Project',
          timestamp,
          application: 'Open 2D Studio',
        },
        units: { length: 'MILLIMETRE', area: 'SQUARE_METRE', volume: 'CUBIC_METRE' },
        project: {
          globalId: crypto.randomUUID(),
          name: state.projectName || 'Default Project',
          spatialStructure: {
            type: 'IfcSite',
            name: state.projectStructure?.siteName || 'Default Site',
            children: state.projectStructure?.buildings?.map((b: any) => ({
              type: 'IfcBuilding',
              name: b.name,
              children: b.storeys?.map((s: any) => ({
                type: 'IfcBuildingStorey',
                name: s.name,
                elevation: s.elevation,
              })) || [],
            })) || [],
          },
        },
        data: entities,
      };

      setIfcxContent(JSON.stringify(doc, null, 2));
    } catch (err) {
      console.error('Failed to generate IFCX:', err);
      setIfcxContent('');
    }
  }, []);

  // Regenerate IFCX when switching to the IFCX tab or when shapes change
  useEffect(() => {
    if (activeViewerTab === 'ifcx') {
      generateIfcxContent();
    }
  }, [activeViewerTab, shapes, generateIfcxContent]);

  // Handle clicking on a class node in the graph - select those shapes
  const handleSelectShapes = useCallback((ids: string[]) => {
    selectShapes(ids);
    // Track which class was clicked for visual feedback
    if (ids.length > 0) {
      const shape = useAppStore.getState().shapes.find((s) => s.id === ids[0]);
      if (shape) {
        setSelectedClass(shapeToIfcClass(shape));
      }
    }
  }, [selectShapes]);

  const handleClose = useCallback(() => {
    setIfcDashboardVisible(false);
  }, [setIfcDashboardVisible]);

  const handleRegenerate = useCallback(() => {
    regenerateIFC();
  }, [regenerateIFC]);

  return (
    <div className="ifc-dashboard-overlay">
      {/* Header */}
      <div className="ifc-dashboard-header">
        <div className="ifc-dashboard-header-left">
          <span className="ifc-dashboard-title">IFC Dashboard</span>
          <span className="ifc-dashboard-subtitle">
            ISO 16739-1:2018 / IFC4 STEP Physical File
          </span>
          <span className="ifc-dashboard-stat">
            {ifcEntityCount} entities
          </span>
          <span className="ifc-dashboard-stat">
            {ifcFileSize < 1024 ? `${ifcFileSize} B` : ifcFileSize < 1048576 ? `${(ifcFileSize / 1024).toFixed(1)} KB` : `${(ifcFileSize / 1048576).toFixed(2)} MB`}
          </span>
        </div>
        <div className="ifc-dashboard-header-right">
          <button
            className="ifc-dashboard-btn"
            onClick={handleRegenerate}
            title="Regenerate IFC model"
          >
            <RefreshCw size={12} />
            Regenerate
          </button>
          <button
            className="ifc-dashboard-close-btn"
            onClick={handleClose}
            title="Close IFC Dashboard"
          >
            <X size={16} />
          </button>
        </div>
      </div>

      {/* Split view */}
      <div className="ifc-dashboard-body">
        {/* Left: Spatial structure graph */}
        <div className="ifc-dashboard-left">
          <div className="ifc-dashboard-pane-header">
            Spatial Structure
          </div>
          <div className="ifc-dashboard-pane-content">
            <IfcGraph
              shapes={shapes}
              drawings={drawings}
              projectStructure={projectStructure}
              onSelectShapes={handleSelectShapes}
              selectedClass={selectedClass}
            />
          </div>
        </div>

        {/* Divider */}
        <div className="ifc-dashboard-divider" />

        {/* Right: Raw IFC viewer with STEP / IFCX tabs */}
        <div className="ifc-dashboard-right">
          <div className="ifc-dashboard-pane-header" style={{ display: 'flex', alignItems: 'center', gap: 0 }}>
            <button
              className={`ifc-dashboard-viewer-tab ${activeViewerTab === 'step' ? 'active' : ''}`}
              onClick={() => setActiveViewerTab('step')}
              title="View IFC4 STEP format"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
                padding: '2px 10px',
                border: 'none',
                borderBottom: activeViewerTab === 'step' ? '2px solid var(--cad-accent, #3b82f6)' : '2px solid transparent',
                background: 'transparent',
                color: activeViewerTab === 'step' ? 'var(--cad-text)' : 'var(--cad-text-dim)',
                cursor: 'pointer',
                fontSize: 11,
                fontWeight: activeViewerTab === 'step' ? 600 : 400,
              }}
            >
              <FileCode size={12} />
              IFC4 STEP
            </button>
            <button
              className={`ifc-dashboard-viewer-tab ${activeViewerTab === 'ifcx' ? 'active' : ''}`}
              onClick={() => setActiveViewerTab('ifcx')}
              title="View IFCX JSON format"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
                padding: '2px 10px',
                border: 'none',
                borderBottom: activeViewerTab === 'ifcx' ? '2px solid var(--cad-accent, #3b82f6)' : '2px solid transparent',
                background: 'transparent',
                color: activeViewerTab === 'ifcx' ? 'var(--cad-text)' : 'var(--cad-text-dim)',
                cursor: 'pointer',
                fontSize: 11,
                fontWeight: activeViewerTab === 'ifcx' ? 600 : 400,
              }}
            >
              <FileJson size={12} />
              IFCX JSON
            </button>
          </div>
          <div className="ifc-dashboard-pane-content">
            {activeViewerTab === 'step' ? (
              <StepViewer content={ifcContent} />
            ) : (
              <IfcxViewer content={ifcxContent} />
            )}
          </div>
        </div>
      </div>
    </div>
  );
});
