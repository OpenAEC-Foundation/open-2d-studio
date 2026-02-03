/**
 * NewSheetDialog - Dialog for creating new sheets from templates
 */

import { useState, useMemo, useRef, useCallback, useEffect } from 'react';
import { X, FileText, Layout, Grid2X2, Columns, Square, Image, Trash2 } from 'lucide-react';
import { useAppStore } from '../../state/appStore';
import { BUILT_IN_SHEET_TEMPLATES } from '../../services/sheetTemplateService';
import { loadCustomSVGTemplates, deleteCustomSVGTemplate } from '../../services/svgTitleBlockService';
import type { SheetTemplate, ViewportPlaceholder, SVGTitleBlockTemplate } from '../../types/sheet';

interface NewSheetDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

type TabType = 'templates' | 'titleblocks';

export function NewSheetDialog({ isOpen, onClose }: NewSheetDialogProps) {
  const [activeTab, setActiveTab] = useState<TabType>('titleblocks');
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>('');
  const [selectedTitleBlockId, setSelectedTitleBlockId] = useState<string>('');
  const [sheetName, setSheetName] = useState('');
  const [drawingAssignments, setDraftAssignments] = useState<Record<string, string>>({});
  const [selectedPaperSize, setSelectedPaperSize] = useState<string>('A3');
  const [svgTitleBlocks, setSvgTitleBlocks] = useState<SVGTitleBlockTemplate[]>([]);

  // Delete confirmation state
  const [deleteConfirm, setDeleteConfirm] = useState<{ id: string; name: string } | null>(null);

  // Drag state for movable modal
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const dragStartRef = useRef({ x: 0, y: 0 });
  const modalRef = useRef<HTMLDivElement>(null);

  const { drawings, customSheetTemplates, addSheetFromTemplate, addSheet, sheets } = useAppStore();

  // Load SVG title block templates from localStorage
  useEffect(() => {
    if (isOpen) {
      const templates = loadCustomSVGTemplates();
      setSvgTitleBlocks(templates);
      // If no sheet templates but have title blocks, default to title blocks tab
      if (BUILT_IN_SHEET_TEMPLATES.length === 0 && customSheetTemplates.length === 0 && templates.length > 0) {
        setActiveTab('titleblocks');
      }
    }
  }, [isOpen, customSheetTemplates.length]);

  // Drag handlers
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('button')) return;
    setIsDragging(true);
    dragStartRef.current = { x: e.clientX - position.x, y: e.clientY - position.y };
  }, [position]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isDragging) return;
    setPosition({
      x: e.clientX - dragStartRef.current.x,
      y: e.clientY - dragStartRef.current.y,
    });
  }, [isDragging]);

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
  }, []);

  // Combine built-in and custom templates
  const allTemplates = useMemo(() => {
    return [...BUILT_IN_SHEET_TEMPLATES, ...customSheetTemplates];
  }, [customSheetTemplates]);

  // Filter templates by selected paper size
  const filteredTemplates = useMemo(() => {
    return allTemplates.filter(t => t.paperSize === selectedPaperSize);
  }, [allTemplates, selectedPaperSize]);

  // Get unique paper sizes
  const paperSizes = useMemo(() => {
    const sizes = new Set(allTemplates.map(t => t.paperSize));
    return Array.from(sizes).sort();
  }, [allTemplates]);

  const selectedTemplate = allTemplates.find(t => t.id === selectedTemplateId);

  const handleCreate = () => {
    const name = sheetName.trim() || `Sheet ${sheets.length + 1}`;

    if (activeTab === 'templates' && selectedTemplateId) {
      addSheetFromTemplate(selectedTemplateId, name, drawingAssignments);
    } else if (activeTab === 'titleblocks' && selectedTitleBlockId) {
      // Create a blank sheet with the selected title block
      const titleBlock = svgTitleBlocks.find(t => t.id === selectedTitleBlockId);
      if (titleBlock) {
        addSheet(name, selectedPaperSize as 'A4' | 'A3' | 'A2' | 'A1' | 'A0' | 'Letter' | 'Legal' | 'Tabloid' | 'Custom', 'landscape', selectedTitleBlockId);
      }
    } else {
      return;
    }

    // Reset and close
    setSelectedTemplateId('');
    setSelectedTitleBlockId('');
    setSheetName('');
    setDraftAssignments({});
    onClose();
  };

  const canCreate = activeTab === 'templates' ? !!selectedTemplateId : !!selectedTitleBlockId;

  const handleAssignDraft = (placeholderId: string, draftId: string) => {
    setDraftAssignments(prev => ({
      ...prev,
      [placeholderId]: draftId,
    }));
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
    >
      <div
        ref={modalRef}
        className="bg-cad-surface border border-cad-border shadow-xl w-[700px] h-[500px] flex flex-col"
        style={{ transform: `translate(${position.x}px, ${position.y}px)` }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header - Draggable */}
        <div
          className="flex items-center justify-between px-3 py-1.5 border-b border-cad-border select-none"
          style={{ background: 'linear-gradient(to bottom, #ffffff, #f5f5f5)', borderColor: '#d4d4d4' }}
          onMouseDown={handleMouseDown}
        >
          <h2 className="text-xs font-semibold text-gray-800">New Sheet from Template</h2>
          <button
            onClick={onClose}
            className="p-0.5 hover:bg-cad-hover rounded transition-colors text-gray-600 hover:text-gray-800 cursor-default -mr-1"
          >
            <X size={14} />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-cad-border">
          <button
            onClick={() => setActiveTab('titleblocks')}
            className={`px-4 py-2 text-xs font-medium transition-colors ${
              activeTab === 'titleblocks'
                ? 'border-b-2 border-cad-accent text-cad-accent bg-cad-surface'
                : 'text-cad-text-dim hover:text-cad-text hover:bg-cad-hover'
            }`}
          >
            Title Blocks ({svgTitleBlocks.length})
          </button>
          <button
            onClick={() => setActiveTab('templates')}
            className={`px-4 py-2 text-xs font-medium transition-colors ${
              activeTab === 'templates'
                ? 'border-b-2 border-cad-accent text-cad-accent bg-cad-surface'
                : 'text-cad-text-dim hover:text-cad-text hover:bg-cad-hover'
            }`}
          >
            Sheet Templates ({allTemplates.length})
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-hidden flex">
          {/* Left: Selection */}
          <div className="w-1/2 border-r border-cad-border flex flex-col">
            {/* Paper Size Filter */}
            <div className="p-3 border-b border-cad-border">
              <label className="block text-xs text-cad-text-dim mb-2">Paper Size:</label>
              <div className="flex flex-wrap gap-1">
                {(activeTab === 'titleblocks' ? ['A4', 'A3', 'A2', 'A1', 'A0'] : paperSizes).map(size => (
                  <button
                    key={size}
                    onClick={() => {
                      setSelectedPaperSize(size);
                      setSelectedTemplateId('');
                      setSelectedTitleBlockId('');
                    }}
                    className={`px-3 py-1 text-xs transition-colors ${
                      selectedPaperSize === size
                        ? 'bg-cad-accent text-white'
                        : 'bg-cad-input text-cad-text hover:bg-cad-hover'
                    }`}
                  >
                    {size}
                  </button>
                ))}
              </div>
            </div>

            {/* Title Block List (when title blocks tab is active) */}
            {activeTab === 'titleblocks' && (
              <div className="flex-1 overflow-y-auto p-3">
                <div className="space-y-2">
                  {svgTitleBlocks
                    .filter(tb => tb.paperSizes.includes(selectedPaperSize))
                    .map(titleBlock => (
                      <TitleBlockCard
                        key={titleBlock.id}
                        titleBlock={titleBlock}
                        isSelected={selectedTitleBlockId === titleBlock.id}
                        onClick={() => setSelectedTitleBlockId(titleBlock.id)}
                        onDelete={() => setDeleteConfirm({ id: titleBlock.id, name: titleBlock.name })}
                      />
                    ))}

                  {svgTitleBlocks.filter(tb => tb.paperSizes.includes(selectedPaperSize)).length === 0 && (
                    <div className="text-center text-cad-text-dim py-8 text-sm">
                      {svgTitleBlocks.length === 0 ? (
                        <>
                          No title blocks imported yet.
                          <br />
                          <span className="text-xs">Go to File → Import → Title Block Template</span>
                        </>
                      ) : (
                        `No title blocks for ${selectedPaperSize}`
                      )}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Template List (when templates tab is active) */}
            {activeTab === 'templates' && (
              <div className="flex-1 overflow-y-auto p-3">
                <div className="space-y-2">
                  {filteredTemplates.map(template => (
                    <TemplateCard
                      key={template.id}
                      template={template}
                      isSelected={selectedTemplateId === template.id}
                      onClick={() => {
                        setSelectedTemplateId(template.id);
                        setDraftAssignments({});
                      }}
                    />
                  ))}

                  {filteredTemplates.length === 0 && (
                    <div className="text-center text-cad-text-dim py-8 text-sm">
                      No sheet templates for {selectedPaperSize}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Right: Configuration */}
          <div className="w-1/2 flex flex-col">
            {activeTab === 'titleblocks' && selectedTitleBlockId ? (
              <>
                {/* Title Block Preview */}
                {(() => {
                  const selectedTitleBlock = svgTitleBlocks.find(t => t.id === selectedTitleBlockId);
                  if (!selectedTitleBlock) return null;
                  return (
                    <>
                      <div className="p-3 border-b border-cad-border">
                        <h3 className="text-sm font-medium text-cad-text mb-2">{selectedTitleBlock.name}</h3>
                        <p className="text-xs text-cad-text-dim mb-3">{selectedTitleBlock.description || 'Custom title block template'}</p>
                        <div className="bg-white border border-gray-300 p-2 flex items-center justify-center" style={{ minHeight: 100 }}>
                          <div
                            style={{ maxWidth: '100%', maxHeight: 80 }}
                            dangerouslySetInnerHTML={{ __html: selectedTitleBlock.svgContent }}
                          />
                        </div>
                      </div>

                      {/* Sheet Name */}
                      <div className="p-3 border-b border-cad-border">
                        <label className="block text-xs text-cad-text-dim mb-1">Sheet Name:</label>
                        <input
                          type="text"
                          value={sheetName}
                          onChange={(e) => setSheetName(e.target.value)}
                          className="w-full px-2 py-1.5 text-sm bg-cad-input border border-cad-border text-cad-text"
                          placeholder={`Sheet ${sheets.length + 1}`}
                        />
                      </div>

                      {/* Info */}
                      <div className="flex-1 p-3">
                        <div className="p-3 bg-cad-input rounded text-xs text-cad-text-dim">
                          <p className="mb-2">
                            <strong className="text-cad-text">Fields:</strong> {selectedTitleBlock.fieldMappings.length} editable field(s)
                          </p>
                          <p className="mb-2">
                            <strong className="text-cad-text">Size:</strong> {Math.round(selectedTitleBlock.width)} x {Math.round(selectedTitleBlock.height)} mm
                          </p>
                          <p>
                            A blank {selectedPaperSize} sheet will be created with this title block. You can add viewports after creation.
                          </p>
                        </div>
                      </div>
                    </>
                  );
                })()}
              </>
            ) : activeTab === 'templates' && selectedTemplate ? (
              <>
                {/* Template Preview */}
                <div className="p-3 border-b border-cad-border">
                  <h3 className="text-sm font-medium text-cad-text mb-2">{selectedTemplate.name}</h3>
                  <p className="text-xs text-cad-text-dim mb-3">{selectedTemplate.description}</p>
                  <TemplatePreview template={selectedTemplate} />
                </div>

                {/* Sheet Name */}
                <div className="p-3 border-b border-cad-border">
                  <label className="block text-xs text-cad-text-dim mb-1">Sheet Name:</label>
                  <input
                    type="text"
                    value={sheetName}
                    onChange={(e) => setSheetName(e.target.value)}
                    className="w-full px-2 py-1.5 text-sm bg-cad-input border border-cad-border text-cad-text"
                    placeholder={`Sheet ${sheets.length + 1}`}
                  />
                </div>

                {/* Viewport Assignments */}
                {selectedTemplate.viewportPlaceholders.length > 0 && (
                  <div className="flex-1 overflow-y-auto p-3">
                    <h4 className="text-xs font-medium text-cad-text-dim uppercase tracking-wider mb-2">
                      Assign Drafts to Viewports
                    </h4>
                    <p className="text-xs text-cad-text-dim mb-3">
                      Select which draft to show in each viewport. Leave empty to add later.
                    </p>

                    <div className="space-y-3">
                      {selectedTemplate.viewportPlaceholders.map(placeholder => (
                        <ViewportAssignment
                          key={placeholder.id}
                          placeholder={placeholder}
                          drawings={drawings}
                          selectedDraftId={drawingAssignments[placeholder.id] || ''}
                          onAssign={(draftId) => handleAssignDraft(placeholder.id, draftId)}
                        />
                      ))}
                    </div>
                  </div>
                )}

                {selectedTemplate.viewportPlaceholders.length === 0 && (
                  <div className="flex-1 p-3">
                    <div className="text-center text-cad-text-dim py-8 text-sm">
                      This is a blank template. Add viewports after creating the sheet.
                    </div>
                  </div>
                )}
              </>
            ) : (
              <div className="flex-1 flex items-center justify-center text-cad-text-dim text-sm">
                {activeTab === 'titleblocks' ? 'Select a title block to continue' : 'Select a template to continue'}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="px-3 py-2 border-t border-cad-border flex justify-end gap-2">
          <button
            onClick={onClose}
            className="px-3 py-1 text-xs bg-cad-input border border-cad-border text-cad-text hover:bg-cad-hover"
          >
            Cancel
          </button>
          <button
            onClick={handleCreate}
            disabled={!canCreate}
            className="px-3 py-1 text-xs bg-cad-accent text-white hover:bg-cad-accent/80 disabled:bg-cad-input disabled:text-cad-text-dim"
          >
            Create Sheet
          </button>
        </div>
      </div>

      {/* Delete Confirmation Dialog */}
      {deleteConfirm && (
        <div className="absolute inset-0 bg-black/50 flex items-center justify-center z-10">
          <div className="bg-cad-surface border border-cad-border shadow-xl p-4 w-[300px]">
            <h3 className="text-sm font-medium text-cad-text mb-2">Delete Sheet Template</h3>
            <p className="text-xs text-cad-text-dim mb-4">
              Are you sure you want to delete "{deleteConfirm.name}"?
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setDeleteConfirm(null)}
                className="px-3 py-1.5 text-xs bg-cad-input border border-cad-border text-cad-text hover:bg-cad-hover"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  deleteCustomSVGTemplate(deleteConfirm.id);
                  setSvgTitleBlocks(prev => prev.filter(t => t.id !== deleteConfirm.id));
                  if (selectedTitleBlockId === deleteConfirm.id) {
                    setSelectedTitleBlockId('');
                  }
                  setDeleteConfirm(null);
                }}
                className="px-3 py-1.5 text-xs bg-red-500 text-white hover:bg-red-600"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Template Card Component
// ============================================================================

interface TemplateCardProps {
  template: SheetTemplate;
  isSelected: boolean;
  onClick: () => void;
}

function TemplateCard({ template, isSelected, onClick }: TemplateCardProps) {
  const getTemplateIcon = () => {
    const count = template.viewportPlaceholders.length;
    if (count === 0) return <Square size={20} />;
    if (count === 1) return <FileText size={20} />;
    if (count === 2) return <Columns size={20} />;
    if (count === 4) return <Grid2X2 size={20} />;
    return <Layout size={20} />;
  };

  return (
    <div
      onClick={onClick}
      className={`p-3 border cursor-pointer transition-colors ${
        isSelected
          ? 'border-cad-accent bg-cad-accent/10'
          : 'border-cad-border hover:border-cad-accent/50 hover:bg-cad-hover'
      }`}
    >
      <div className="flex items-start gap-3">
        <div className={`p-2 rounded ${isSelected ? 'bg-cad-accent text-white' : 'bg-cad-input text-cad-text-dim'}`}>
          {getTemplateIcon()}
        </div>
        <div className="flex-1 min-w-0">
          <h4 className="text-sm font-medium text-cad-text truncate">{template.name}</h4>
          <p className="text-xs text-cad-text-dim truncate">{template.description}</p>
          <div className="flex items-center gap-2 mt-1 text-xs text-cad-text-dim">
            <span>{template.orientation}</span>
            <span>-</span>
            <span>{template.viewportPlaceholders.length} viewport{template.viewportPlaceholders.length !== 1 ? 's' : ''}</span>
            {!template.isBuiltIn && (
              <>
                <span>-</span>
                <span className="text-cad-accent">Custom</span>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Template Preview Component
// ============================================================================

interface TemplatePreviewProps {
  template: SheetTemplate;
}

function TemplatePreview({ template }: TemplatePreviewProps) {
  // Calculate preview dimensions (scaled to fit in a box)
  const previewWidth = 200;
  const aspectRatio = template.orientation === 'landscape' ? 1.414 : 0.707; // A-series aspect ratio
  const previewHeight = template.orientation === 'landscape' ? previewWidth / aspectRatio : previewWidth * aspectRatio;

  // Get paper dimensions in mm for scaling
  const paperDims = getPaperDimensions(template.paperSize, template.orientation);
  const scaleX = previewWidth / paperDims.width;
  const scaleY = previewHeight / paperDims.height;

  return (
    <div
      className="bg-white border border-gray-300 relative mx-auto"
      style={{ width: previewWidth, height: previewHeight }}
    >
      {/* Viewport placeholders */}
      {template.viewportPlaceholders.map((placeholder, index) => (
        <div
          key={placeholder.id}
          className="absolute border border-blue-400 bg-blue-100/30 flex items-center justify-center"
          style={{
            left: placeholder.x * scaleX,
            top: placeholder.y * scaleY,
            width: placeholder.width * scaleX,
            height: placeholder.height * scaleY,
          }}
        >
          <span className="text-[8px] text-blue-600 font-medium">
            {index + 1}
          </span>
        </div>
      ))}

      {/* Title block area (bottom right) */}
      <div
        className="absolute bg-gray-200 border border-gray-400"
        style={{
          right: 5,
          bottom: 5,
          width: previewWidth * 0.4,
          height: previewHeight * 0.15,
        }}
      />
    </div>
  );
}

// Helper to get paper dimensions
function getPaperDimensions(paperSize: string, orientation: string): { width: number; height: number } {
  const sizes: Record<string, { width: number; height: number }> = {
    A4: { width: 210, height: 297 },
    A3: { width: 297, height: 420 },
    A2: { width: 420, height: 594 },
    A1: { width: 594, height: 841 },
    A0: { width: 841, height: 1189 },
  };

  const dims = sizes[paperSize] || sizes.A4;
  return orientation === 'landscape'
    ? { width: dims.height, height: dims.width }
    : dims;
}

// ============================================================================
// Viewport Assignment Component
// ============================================================================

interface ViewportAssignmentProps {
  placeholder: ViewportPlaceholder;
  drawings: { id: string; name: string }[];
  selectedDraftId: string;
  onAssign: (draftId: string) => void;
}

function ViewportAssignment({
  placeholder,
  drawings,
  selectedDraftId,
  onAssign,
}: ViewportAssignmentProps) {
  const scaleLabel = formatScale(placeholder.defaultScale);

  return (
    <div className="p-2 bg-cad-input border border-cad-border">
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs font-medium text-cad-text">{placeholder.name}</span>
        <span className="text-xs text-cad-text-dim">{scaleLabel}</span>
      </div>
      {placeholder.suggestedDrawingType && (
        <p className="text-xs text-cad-text-dim mb-2">
          Suggested: {placeholder.suggestedDrawingType}
        </p>
      )}
      <select
        value={selectedDraftId}
        onChange={(e) => onAssign(e.target.value)}
        className="w-full px-2 py-1 text-xs bg-cad-surface border border-cad-border text-cad-text"
      >
        <option value="">-- Leave empty --</option>
        {drawings.map(draft => (
          <option key={draft.id} value={draft.id}>
            {draft.name}
          </option>
        ))}
      </select>
    </div>
  );
}

// Helper to format scale
function formatScale(scale: number): string {
  if (scale >= 1) {
    return `${Number.isInteger(scale) ? scale : scale.toFixed(1)}:1`;
  }
  const inverse = 1 / scale;
  return `1:${Number.isInteger(inverse) ? inverse : Math.round(inverse)}`;
}

// ============================================================================
// Title Block Card Component
// ============================================================================

interface TitleBlockCardProps {
  titleBlock: SVGTitleBlockTemplate;
  isSelected: boolean;
  onClick: () => void;
  onDelete: () => void;
}

function TitleBlockCard({ titleBlock, isSelected, onClick, onDelete }: TitleBlockCardProps) {
  const handleDeleteClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    onDelete();
  };

  return (
    <div
      onClick={onClick}
      className={`p-3 border cursor-pointer transition-colors ${
        isSelected
          ? 'border-cad-accent bg-cad-accent/10'
          : 'border-cad-border hover:border-cad-accent/50 hover:bg-cad-hover'
      }`}
    >
      <div className="flex items-start gap-3">
        <div className={`p-2 rounded ${isSelected ? 'bg-cad-accent text-white' : 'bg-cad-input text-cad-text-dim'}`}>
          <Image size={20} />
        </div>
        <div className="flex-1 min-w-0">
          <h4 className="text-sm font-medium text-cad-text truncate">{titleBlock.name}</h4>
          <p className="text-xs text-cad-text-dim truncate">{titleBlock.description || 'Custom title block'}</p>
          <div className="flex items-center gap-2 mt-1 text-xs text-cad-text-dim">
            <span>{Math.round(titleBlock.width)} x {Math.round(titleBlock.height)} mm</span>
            <span>-</span>
            <span>{titleBlock.fieldMappings.length} field{titleBlock.fieldMappings.length !== 1 ? 's' : ''}</span>
            <span>-</span>
            <span className="text-cad-accent">Custom</span>
          </div>
        </div>
        <button
          type="button"
          onClick={handleDeleteClick}
          className="p-1.5 text-cad-text-dim hover:text-red-500 hover:bg-red-500/10 rounded transition-colors"
          title="Delete sheet template"
        >
          <Trash2 size={14} />
        </button>
      </div>
    </div>
  );
}
