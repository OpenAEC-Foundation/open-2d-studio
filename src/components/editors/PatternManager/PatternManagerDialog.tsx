/**
 * PatternManagerDialog - Dialog for managing custom hatch patterns
 */

import { useState, useMemo, useRef } from 'react';
import {
  Plus,
  Copy,
  Trash2,
  Download,
  Upload,
  Edit,
  FolderOpen,
  ChevronDown,
  ChevronRight,
  AlertCircle,
  CheckCircle,
  Star,
} from 'lucide-react';
import { useAppStore } from '../../../state/appStore';
import { DraggableModal, ModalButton } from '../../shared/DraggableModal';
import { PatternPreview } from './PatternPreview';
import { PatternEditorDialog } from './PatternEditorDialog';
import type { CustomHatchPattern } from '../../../types/hatch';
import { BUILTIN_PATTERNS } from '../../../types/hatch';
import {
  openPATFilePicker,
  readPATFile,
  parsePATFile,
  exportToPAT,
  downloadPATFile,
} from '../../../services/export/patService';
import {
  openSVGFilePicker,
  readSVGFile,
  parseSVGFile,
  parseSVGPatterns,
  createSvgPattern,
  downloadSVGPattern,
  generateSVGFromLinePattern,
} from '../../../services/export/svgPatternService';
import type { ParsedSvgPattern } from '../../../services/export/svgPatternService';
import { isSvgHatchPattern } from '../../../types/hatch';
import { SvgPatternImportDialog } from './SvgPatternImportDialog';

interface PatternManagerDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectPattern?: (patternId: string) => void;
}

type PatternCategory = 'favorites' | 'builtin' | 'user' | 'project';

export function PatternManagerDialog({
  isOpen,
  onClose,
  onSelectPattern,
}: PatternManagerDialogProps) {
  const {
    userPatterns,
    projectPatterns,
    deleteUserPattern,
    deleteProjectPattern,
    duplicateUserPattern,
    duplicateProjectPattern,
    favoritePatternIds,
    toggleFavoritePattern,
  } = useAppStore();

  const [selectedPatternId, setSelectedPatternId] = useState<string | null>(null);
  const [expandedCategories, setExpandedCategories] = useState<Record<PatternCategory, boolean>>({
    favorites: true,
    builtin: true,
    user: true,
    project: true,
  });
  const [showImportMenu, setShowImportMenu] = useState(false);
  const [showExportMenu, setShowExportMenu] = useState(false);

  // Pattern editor state
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingPattern, setEditingPattern] = useState<CustomHatchPattern | null>(null);

  // Import/export status
  const [statusMessage, setStatusMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // SVG multi-pattern import dialog
  const [svgImportPatterns, setSvgImportPatterns] = useState<ParsedSvgPattern[] | null>(null);

  // Preview expand/collapse on double-click
  const [previewExpanded, setPreviewExpanded] = useState(false);

  const rightPanelRef = useRef<HTMLDivElement>(null);
  const detailsRef = useRef<HTMLDivElement>(null);

  // Resolve favorite patterns (only those that still exist)
  const allPatternsFlat = useMemo(() => [
    ...BUILTIN_PATTERNS,
    ...userPatterns,
    ...projectPatterns,
  ], [userPatterns, projectPatterns]);

  const favoritePatterns = useMemo(() => {
    return favoritePatternIds
      .map(id => allPatternsFlat.find(p => p.id === id))
      .filter((p): p is CustomHatchPattern => p !== undefined);
  }, [favoritePatternIds, allPatternsFlat]);

  // Get all patterns organized by category
  const allPatterns = useMemo(() => ({
    favorites: favoritePatterns,
    builtin: BUILTIN_PATTERNS,
    user: userPatterns,
    project: projectPatterns,
  }), [userPatterns, projectPatterns, favoritePatterns]);

  // Find the selected pattern
  const selectedPattern = useMemo(() => {
    if (!selectedPatternId) return null;
    return (
      BUILTIN_PATTERNS.find(p => p.id === selectedPatternId) ||
      userPatterns.find(p => p.id === selectedPatternId) ||
      projectPatterns.find(p => p.id === selectedPatternId) ||
      null
    );
  }, [selectedPatternId, userPatterns, projectPatterns]);

  // Determine which category the selected pattern belongs to (actual source, not favorites virtual category)
  const selectedCategory = useMemo((): PatternCategory | null => {
    if (!selectedPatternId) return null;
    if (BUILTIN_PATTERNS.some(p => p.id === selectedPatternId)) return 'builtin';
    if (userPatterns.some(p => p.id === selectedPatternId)) return 'user';
    if (projectPatterns.some(p => p.id === selectedPatternId)) return 'project';
    return null;
  }, [selectedPatternId, userPatterns, projectPatterns]);

  const isFavorite = (id: string) => favoritePatternIds.includes(id);

  const toggleCategory = (category: PatternCategory) => {
    setExpandedCategories(prev => ({
      ...prev,
      [category]: !prev[category],
    }));
  };

  const handleSelect = (patternId: string) => {
    setSelectedPatternId(patternId);
  };

  const handleDoubleClick = (patternId: string) => {
    if (onSelectPattern) {
      onSelectPattern(patternId);
      onClose();
    }
  };

  const handleDelete = () => {
    if (!selectedPatternId || selectedCategory === 'builtin') return;

    if (selectedCategory === 'user') {
      deleteUserPattern(selectedPatternId);
    } else if (selectedCategory === 'project') {
      deleteProjectPattern(selectedPatternId);
    }
    setSelectedPatternId(null);
  };

  const handleDuplicate = () => {
    if (!selectedPatternId || !selectedPattern) return;

    let newId: string | null = null;
    if (selectedCategory === 'user') {
      newId = duplicateUserPattern(selectedPatternId);
    } else if (selectedCategory === 'project') {
      newId = duplicateProjectPattern(selectedPatternId);
    } else if (selectedCategory === 'builtin') {
      // Duplicate builtin to user patterns
      const { addUserPattern } = useAppStore.getState();
      newId = addUserPattern({
        name: `${selectedPattern.name} (Custom)`,
        description: selectedPattern.description,
        scaleType: selectedPattern.scaleType,
        lineFamilies: [...selectedPattern.lineFamilies],
      });
    }

    if (newId) {
      setSelectedPatternId(newId);
    }
  };

  const handleEdit = () => {
    if (!selectedPatternId || selectedCategory === 'builtin' || !selectedPattern) return;
    setEditingPattern(selectedPattern);
    setEditorOpen(true);
  };

  const handleCreateNew = () => {
    setEditingPattern(null);
    setEditorOpen(true);
  };

  const handleEditorSave = (patternData: Omit<CustomHatchPattern, 'id' | 'createdAt' | 'modifiedAt' | 'source'>) => {
    const { addUserPattern, updateUserPattern, updateProjectPattern } = useAppStore.getState();

    if (editingPattern) {
      // Editing existing pattern
      if (selectedCategory === 'user') {
        updateUserPattern(editingPattern.id, patternData);
      } else if (selectedCategory === 'project') {
        updateProjectPattern(editingPattern.id, patternData);
      }
    } else {
      // Creating new pattern - add to user patterns
      const newId = addUserPattern(patternData);
      setSelectedPatternId(newId);
      // Ensure user category is expanded
      setExpandedCategories(prev => ({ ...prev, user: true }));
    }
  };

  const handleImportPAT = async () => {
    setShowImportMenu(false);
    setStatusMessage(null);

    try {
      const file = await openPATFilePicker();
      if (!file) return; // User cancelled

      const content = await readPATFile(file);
      const result = parsePATFile(content);

      if (result.errors.length > 0) {
        setStatusMessage({
          type: 'error',
          text: `Parse errors: ${result.errors.slice(0, 2).join('; ')}${result.errors.length > 2 ? '...' : ''}`,
        });
        return;
      }

      if (result.patterns.length === 0) {
        setStatusMessage({ type: 'error', text: 'No valid patterns found in file' });
        return;
      }

      // Add imported patterns to user patterns
      const { addUserPattern } = useAppStore.getState();
      let addedCount = 0;
      let lastAddedId: string | null = null;

      for (const pattern of result.patterns) {
        const newId = addUserPattern({
          name: pattern.name,
          description: pattern.description,
          scaleType: pattern.scaleType,
          lineFamilies: pattern.lineFamilies,
        });
        lastAddedId = newId;
        addedCount++;
      }

      // Select the last imported pattern and expand user category
      if (lastAddedId) {
        setSelectedPatternId(lastAddedId);
        setExpandedCategories(prev => ({ ...prev, user: true }));
      }

      const warningText = result.warnings.length > 0 ? ` (${result.warnings.length} warnings)` : '';
      setStatusMessage({
        type: 'success',
        text: `Imported ${addedCount} pattern${addedCount !== 1 ? 's' : ''}${warningText}`,
      });

      // Clear status after a delay
      setTimeout(() => setStatusMessage(null), 5000);
    } catch (err) {
      setStatusMessage({
        type: 'error',
        text: `Failed to import: ${err instanceof Error ? err.message : 'Unknown error'}`,
      });
    }
  };

  const handleImportSVG = async () => {
    setShowImportMenu(false);
    setStatusMessage(null);

    try {
      const file = await openSVGFilePicker();
      if (!file) return; // User cancelled

      const content = await readSVGFile(file);
      const result = parseSVGPatterns(content);

      if (result.errors.length > 0) {
        setStatusMessage({
          type: 'error',
          text: `Parse errors: ${result.errors.slice(0, 2).join('; ')}${result.errors.length > 2 ? '...' : ''}`,
        });
        return;
      }

      if (result.parsed.length === 0) {
        // No patterns found - try fallback: treat entire SVG as tile
        const fallback = parseSVGFile(content, file.name);
        if (fallback.patterns.length > 0) {
          const { addUserPattern } = useAppStore.getState();
          const pattern = fallback.patterns[0];
          const newId = addUserPattern({
            name: pattern.name,
            description: pattern.description,
            scaleType: pattern.scaleType,
            lineFamilies: pattern.lineFamilies,
            ...(isSvgHatchPattern(pattern) ? {
              svgTile: pattern.svgTile,
              tileWidth: pattern.tileWidth,
              tileHeight: pattern.tileHeight,
            } : {}),
          });
          setSelectedPatternId(newId);
          setExpandedCategories(prev => ({ ...prev, user: true }));
          setStatusMessage({ type: 'success', text: `Imported SVG as tile pattern` });
          setTimeout(() => setStatusMessage(null), 5000);
        } else {
          setStatusMessage({ type: 'error', text: 'No valid patterns found in SVG file' });
        }
        return;
      }

      if (result.parsed.length === 1) {
        // Single pattern - import directly
        const svgPattern = createSvgPattern(result.parsed[0]);
        const { importPattern } = useAppStore.getState();
        const newId = importPattern(svgPattern, 'user');
        setSelectedPatternId(newId);
        setExpandedCategories(prev => ({ ...prev, user: true }));
        setStatusMessage({ type: 'success', text: `Imported 1 SVG pattern` });
        setTimeout(() => setStatusMessage(null), 5000);
        return;
      }

      // Multiple patterns - open selection dialog
      setSvgImportPatterns(result.parsed);
    } catch (err) {
      setStatusMessage({
        type: 'error',
        text: `Failed to import: ${err instanceof Error ? err.message : 'Unknown error'}`,
      });
    }
  };

  const handleSvgImportSelected = (selectedParsed: ParsedSvgPattern[]) => {
    const { importPattern } = useAppStore.getState();
    let lastAddedId: string | null = null;

    for (const parsed of selectedParsed) {
      const svgPattern = createSvgPattern(parsed);
      const newId = importPattern(svgPattern, 'user');
      lastAddedId = newId;
    }

    setSvgImportPatterns(null);

    if (lastAddedId) {
      setSelectedPatternId(lastAddedId);
      setExpandedCategories(prev => ({ ...prev, user: true }));
    }

    setStatusMessage({
      type: 'success',
      text: `Imported ${selectedParsed.length} SVG pattern${selectedParsed.length !== 1 ? 's' : ''}`,
    });
    setTimeout(() => setStatusMessage(null), 5000);
  };

  const handleExportPAT = () => {
    setShowExportMenu(false);
    setStatusMessage(null);

    if (!selectedPattern) return;

    try {
      const content = exportToPAT([selectedPattern]);
      const filename = selectedPattern.name.replace(/[^a-zA-Z0-9]/g, '_');
      downloadPATFile(content, filename);

      setStatusMessage({ type: 'success', text: `Exported "${selectedPattern.name}" to PAT file` });
      setTimeout(() => setStatusMessage(null), 3000);
    } catch (err) {
      setStatusMessage({
        type: 'error',
        text: `Failed to export: ${err instanceof Error ? err.message : 'Unknown error'}`,
      });
    }
  };

  const handleExportSVG = () => {
    setShowExportMenu(false);
    setStatusMessage(null);

    if (!selectedPattern) return;

    try {
      // Check if it's already an SVG pattern
      if (isSvgHatchPattern(selectedPattern)) {
        downloadSVGPattern(selectedPattern);
      } else {
        // Generate SVG from line-based pattern
        const svgContent = generateSVGFromLinePattern(selectedPattern, 100);
        const blob = new Blob([svgContent], { type: 'image/svg+xml' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `${selectedPattern.name.replace(/[^a-zA-Z0-9]/g, '_')}.svg`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
      }

      setStatusMessage({ type: 'success', text: `Exported "${selectedPattern.name}" to SVG file` });
      setTimeout(() => setStatusMessage(null), 3000);
    } catch (err) {
      setStatusMessage({
        type: 'error',
        text: `Failed to export: ${err instanceof Error ? err.message : 'Unknown error'}`,
      });
    }
  };

  const handleApply = () => {
    if (selectedPatternId && onSelectPattern) {
      onSelectPattern(selectedPatternId);
      onClose();
    }
  };

  const renderPatternList = (patterns: CustomHatchPattern[], category: PatternCategory) => {
    if (patterns.length === 0) {
      return (
        <div className="pl-6 py-2 text-xs text-cad-text-dim italic">
          {category === 'favorites' ? 'No favorite patterns yet' : 'No patterns'}
        </div>
      );
    }

    return (
      <div className="pl-2">
        {patterns.map(pattern => (
          <div
            key={`${category}-${pattern.id}`}
            className={`flex items-center gap-1.5 px-2 py-1.5 cursor-pointer rounded transition-colors group ${
              selectedPatternId === pattern.id
                ? 'bg-cad-accent text-white'
                : 'hover:bg-cad-hover'
            }`}
            onClick={() => handleSelect(pattern.id)}
            onDoubleClick={() => handleDoubleClick(pattern.id)}
          >
            <PatternPreview
              pattern={pattern}
              width={28}
              height={20}
              scale={0.5}
            />
            <span className="text-xs truncate flex-1">{pattern.name}</span>
            {/* Star icon for toggling favorite */}
            <button
              className={`p-0.5 transition-opacity ${
                isFavorite(pattern.id)
                  ? 'opacity-100'
                  : 'opacity-0 group-hover:opacity-60'
              }`}
              onClick={(e) => { e.stopPropagation(); toggleFavoritePattern(pattern.id); }}
              title={isFavorite(pattern.id) ? 'Remove from favorites' : 'Add to favorites'}
            >
              <Star
                size={11}
                className={isFavorite(pattern.id) ? 'fill-yellow-400 text-yellow-400' : 'text-cad-text-dim'}
              />
            </button>
            {category !== 'builtin' && category !== 'favorites' && (
              <span className="text-[10px] text-cad-text-dim opacity-60">
                {category === 'user' ? 'User' : 'Project'}
              </span>
            )}
          </div>
        ))}
      </div>
    );
  };

  const categoryLabels: Record<PatternCategory, string> = {
    favorites: 'Favorites',
    builtin: 'Built-in Patterns',
    user: 'User Patterns',
    project: 'Project Patterns',
  };

  const categoryIcons: Record<PatternCategory, JSX.Element> = {
    favorites: <Star size={12} className="fill-yellow-400 text-yellow-400" />,
    builtin: <FolderOpen size={12} />,
    user: <FolderOpen size={12} />,
    project: <FolderOpen size={12} />,
  };

  return (
    <DraggableModal
      isOpen={isOpen}
      onClose={onClose}
      title="Hatch Pattern Manager"
      width={600}
      height={450}
      resizable
      minWidth={450}
      minHeight={300}
      footer={
        <>
          <ModalButton onClick={onClose} variant="secondary">
            Close
          </ModalButton>
          {onSelectPattern && (
            <ModalButton
              onClick={handleApply}
              variant="primary"
              disabled={!selectedPatternId}
            >
              Apply
            </ModalButton>
          )}
        </>
      }
    >
      <div className="flex flex-1 min-h-0">
        {/* Left panel - Pattern list */}
        <div className={`w-64 border-r border-cad-border flex flex-col ${previewExpanded ? 'hidden' : ''}`}>
          {/* Toolbar */}
          <div className="flex items-center gap-1 p-2 border-b border-cad-border">
            <button
              onClick={handleCreateNew}
              className="p-1.5 hover:bg-cad-hover rounded transition-colors"
              title="New Pattern"
            >
              <Plus size={14} />
            </button>
            <button
              onClick={handleEdit}
              disabled={!selectedPatternId || selectedCategory === 'builtin'}
              className="p-1.5 hover:bg-cad-hover rounded transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
              title="Edit Pattern"
            >
              <Edit size={14} />
            </button>
            <button
              onClick={handleDuplicate}
              disabled={!selectedPatternId}
              className="p-1.5 hover:bg-cad-hover rounded transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
              title="Duplicate Pattern"
            >
              <Copy size={14} />
            </button>
            <button
              onClick={handleDelete}
              disabled={!selectedPatternId || selectedCategory === 'builtin'}
              className="p-1.5 hover:bg-cad-hover rounded transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
              title="Delete Pattern"
            >
              <Trash2 size={14} />
            </button>
            <div className="flex-1" />
            <div className="relative">
              <button
                onClick={() => setShowImportMenu(!showImportMenu)}
                className="p-1.5 hover:bg-cad-hover rounded transition-colors flex items-center gap-0.5"
                title="Import"
              >
                <Download size={14} />
                <ChevronDown size={10} />
              </button>
              {showImportMenu && (
                <div className="absolute right-0 top-full mt-1 bg-cad-surface border border-cad-border shadow-lg z-10 min-w-[100px]">
                  <button
                    onClick={handleImportPAT}
                    className="w-full px-3 py-1.5 text-xs text-left hover:bg-cad-hover"
                  >
                    Import PAT...
                  </button>
                  <button
                    onClick={handleImportSVG}
                    className="w-full px-3 py-1.5 text-xs text-left hover:bg-cad-hover"
                  >
                    Import SVG...
                  </button>
                </div>
              )}
            </div>
            <div className="relative">
              <button
                onClick={() => setShowExportMenu(!showExportMenu)}
                disabled={!selectedPatternId}
                className="p-1.5 hover:bg-cad-hover rounded transition-colors disabled:opacity-30 disabled:cursor-not-allowed flex items-center gap-0.5"
                title="Export"
              >
                <Upload size={14} />
                <ChevronDown size={10} />
              </button>
              {showExportMenu && selectedPatternId && (
                <div className="absolute right-0 top-full mt-1 bg-cad-surface border border-cad-border shadow-lg z-10 min-w-[100px]">
                  <button
                    onClick={handleExportPAT}
                    className="w-full px-3 py-1.5 text-xs text-left hover:bg-cad-hover"
                  >
                    Export as PAT...
                  </button>
                  <button
                    onClick={handleExportSVG}
                    className="w-full px-3 py-1.5 text-xs text-left hover:bg-cad-hover"
                  >
                    Export as SVG...
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Pattern tree */}
          <div className="flex-1 overflow-y-auto p-1">
            {(['favorites', 'builtin', 'user', 'project'] as PatternCategory[]).map(category => (
              <div key={category} className="mb-1">
                <button
                  onClick={() => toggleCategory(category)}
                  className="flex items-center gap-1 w-full px-1 py-1 hover:bg-cad-hover rounded text-left"
                >
                  {expandedCategories[category] ? (
                    <ChevronDown size={12} />
                  ) : (
                    <ChevronRight size={12} />
                  )}
                  {categoryIcons[category]}
                  <span className="text-xs font-medium">{categoryLabels[category]}</span>
                  <span className="text-[10px] text-cad-text-dim ml-auto">
                    ({allPatterns[category].length})
                  </span>
                </button>
                {expandedCategories[category] && renderPatternList(allPatterns[category], category)}
              </div>
            ))}
          </div>

          {/* Status message */}
          {statusMessage && (
            <div className={`flex items-center gap-2 px-3 py-2 text-xs border-t ${
              statusMessage.type === 'success'
                ? 'bg-green-500/10 border-green-500/30 text-green-400'
                : 'bg-red-500/10 border-red-500/30 text-red-400'
            }`}>
              {statusMessage.type === 'success' ? (
                <CheckCircle size={14} />
              ) : (
                <AlertCircle size={14} />
              )}
              <span className="flex-1 truncate">{statusMessage.text}</span>
              <button
                onClick={() => setStatusMessage(null)}
                className="text-current opacity-60 hover:opacity-100"
              >
                ×
              </button>
            </div>
          )}
        </div>

        {/* Right panel - Preview and details */}
        <div ref={rightPanelRef} className="flex-1 flex flex-col p-4 min-h-0">
          {selectedPattern ? (
            <>
              {/* Preview - fills remaining space above details */}
              <div
                className="flex-1 flex items-center justify-center min-h-[60px] overflow-hidden cursor-pointer"
                onDoubleClick={() => setPreviewExpanded(prev => !prev)}
                title={previewExpanded ? 'Double-click to restore' : 'Double-click to expand'}
              >
                <PatternPreview
                  pattern={selectedPattern}
                  width={400}
                  height={300}
                  scale={1.5}
                />
              </div>

              {/* Pattern details - fixed height at bottom, hidden when expanded */}
              <div ref={detailsRef} className={`flex-shrink-0 h-[200px] space-y-3 pt-4 overflow-y-auto ${previewExpanded ? 'hidden' : ''}`}>
                <div>
                  <label className="text-[10px] text-cad-text-dim uppercase tracking-wide">Name</label>
                  <div className="text-sm font-medium">{selectedPattern.name}</div>
                </div>

                {selectedPattern.description && (
                  <div>
                    <label className="text-[10px] text-cad-text-dim uppercase tracking-wide">Description</label>
                    <div className="text-xs text-cad-text-dim">{selectedPattern.description}</div>
                  </div>
                )}

                <div className="flex gap-4">
                  <div>
                    <label className="text-[10px] text-cad-text-dim uppercase tracking-wide">Type</label>
                    <div className="text-xs capitalize">{selectedPattern.scaleType}</div>
                  </div>
                  <div>
                    <label className="text-[10px] text-cad-text-dim uppercase tracking-wide">Source</label>
                    <div className="text-xs capitalize">{selectedPattern.source}</div>
                  </div>
                  <div>
                    <label className="text-[10px] text-cad-text-dim uppercase tracking-wide">Line Families</label>
                    <div className="text-xs">{selectedPattern.lineFamilies.length}</div>
                  </div>
                </div>

                {/* Line family details */}
                {selectedPattern.lineFamilies.length > 0 && (
                  <div>
                    <label className="text-[10px] text-cad-text-dim uppercase tracking-wide mb-1 block">
                      Line Definitions
                    </label>
                    <div className="bg-cad-bg rounded p-2 max-h-[100px] overflow-y-auto">
                      {selectedPattern.lineFamilies.map((family, i) => (
                        <div key={i} className="text-[10px] font-mono text-cad-text-dim">
                          {`${family.angle}°, spacing: ${family.deltaY}${family.dashPattern?.length ? `, dash: [${family.dashPattern.join(',')}]` : ''}`}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center text-cad-text-dim text-sm">
              Select a pattern to view details
            </div>
          )}
        </div>
      </div>

      {/* Pattern Editor Dialog */}
      <PatternEditorDialog
        isOpen={editorOpen}
        onClose={() => setEditorOpen(false)}
        pattern={editingPattern}
        onSave={handleEditorSave}
        title={editingPattern ? `Edit: ${editingPattern.name}` : 'Create New Pattern'}
      />

      {/* SVG Multi-Pattern Import Dialog */}
      {svgImportPatterns && (
        <SvgPatternImportDialog
          isOpen
          patterns={svgImportPatterns}
          onClose={() => setSvgImportPatterns(null)}
          onImport={handleSvgImportSelected}
        />
      )}
    </DraggableModal>
  );
}
