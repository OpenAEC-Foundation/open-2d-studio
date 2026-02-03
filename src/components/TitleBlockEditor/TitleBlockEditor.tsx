/**
 * TitleBlockEditor - Dialog for editing title block fields, templates, and revisions
 */

import { useState, useCallback, useRef } from 'react';
import { X, Upload, Trash2, Plus, RotateCcw } from 'lucide-react';
import { useAppStore } from '../../state/appStore';
import { BUILT_IN_TEMPLATES } from '../../services/titleBlockService';

interface TitleBlockEditorProps {
  isOpen: boolean;
  onClose: () => void;
  sheetId: string;
}

type TabType = 'fields' | 'template' | 'revisions' | 'logo';

export function TitleBlockEditor({ isOpen, onClose, sheetId }: TitleBlockEditorProps) {
  const [activeTab, setActiveTab] = useState<TabType>('fields');
  const [newRevisionDesc, setNewRevisionDesc] = useState('');
  const [newRevisionBy, setNewRevisionBy] = useState('');
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const dragStartRef = useRef({ x: 0, y: 0 });

  const {
    sheets,
    updateTitleBlockField,
    applyTitleBlockTemplate,
    addRevisionToSheet,
    setTitleBlockLogo,
    removeTitleBlockLogo,
  } = useAppStore();

  const sheet = sheets.find(s => s.id === sheetId);

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

  if (!isOpen || !sheet) return null;

  const titleBlock = sheet.titleBlock;
  const enhancedTitleBlock = titleBlock as unknown as {
    templateId?: string;
    logo?: { data: string; width: number; height: number };
    revisionTable?: { revisions: { number: string; date: string; description: string; drawnBy: string }[] };
  };

  const tabs: { id: TabType; label: string }[] = [
    { id: 'fields', label: 'Fields' },
    { id: 'template', label: 'Template' },
    { id: 'revisions', label: 'Revisions' },
    { id: 'logo', label: 'Logo' },
  ];

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
    >
      <div
        className="bg-cad-surface border border-cad-border shadow-xl w-[500px] h-[480px] flex flex-col"
        style={{ transform: `translate(${position.x}px, ${position.y}px)` }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-3 py-1.5 border-b border-cad-border select-none"
          style={{ background: 'linear-gradient(to bottom, #ffffff, #f5f5f5)', borderColor: '#d4d4d4' }}
          onMouseDown={handleMouseDown}
        >
          <h2 className="text-xs font-semibold text-gray-800">Title Block Editor - {sheet.name}</h2>
          <button
            onClick={onClose}
            className="p-0.5 hover:bg-cad-hover rounded transition-colors text-gray-600 hover:text-gray-800 cursor-default -mr-1"
          >
            <X size={14} />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-cad-border">
          {tabs.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-4 py-2 text-sm transition-colors ${
                activeTab === tab.id
                  ? 'bg-cad-surface text-cad-accent border-b-2 border-cad-accent'
                  : 'text-cad-text-dim hover:text-cad-text hover:bg-cad-hover'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4">
          {activeTab === 'fields' && (
            <FieldsTab
              sheetId={sheetId}
              fields={titleBlock.fields}
              onUpdateField={updateTitleBlockField}
            />
          )}

          {activeTab === 'template' && (
            <TemplateTab
              sheetId={sheetId}
              currentTemplateId={enhancedTitleBlock.templateId}
              paperSize={sheet.paperSize}
              onApplyTemplate={applyTitleBlockTemplate}
            />
          )}

          {activeTab === 'revisions' && (
            <RevisionsTab
              sheetId={sheetId}
              revisions={enhancedTitleBlock.revisionTable?.revisions || []}
              newRevisionDesc={newRevisionDesc}
              newRevisionBy={newRevisionBy}
              onDescChange={setNewRevisionDesc}
              onByChange={setNewRevisionBy}
              onAddRevision={addRevisionToSheet}
            />
          )}

          {activeTab === 'logo' && (
            <LogoTab
              sheetId={sheetId}
              logo={enhancedTitleBlock.logo}
              onSetLogo={setTitleBlockLogo}
              onRemoveLogo={removeTitleBlockLogo}
            />
          )}
        </div>

        {/* Footer */}
        <div className="px-3 py-2 border-t border-cad-border flex justify-end gap-2">
          <button
            onClick={onClose}
            className="px-3 py-1 text-xs bg-cad-accent text-white hover:bg-cad-accent/80"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Fields Tab
// ============================================================================

interface FieldsTabProps {
  sheetId: string;
  fields: { id: string; label: string; value: string }[];
  onUpdateField: (sheetId: string, fieldId: string, value: string) => void;
}

function FieldsTab({ sheetId, fields, onUpdateField }: FieldsTabProps) {
  // Group fields by category
  const projectFields = fields.filter(f => ['project', 'client', 'address'].includes(f.id));
  const drawingFields = fields.filter(f => ['title', 'number', 'scale'].includes(f.id));
  const personnelFields = fields.filter(f => ['drawnBy', 'checkedBy', 'approvedBy'].includes(f.id));
  const statusFields = fields.filter(f => ['date', 'sheetNo', 'revision', 'status'].includes(f.id));
  const otherFields = fields.filter(f =>
    !['project', 'client', 'address', 'title', 'number', 'scale', 'drawnBy', 'checkedBy', 'approvedBy', 'date', 'sheetNo', 'revision', 'status', 'logo'].includes(f.id)
  );

  const renderFieldGroup = (title: string, groupFields: typeof fields) => {
    if (groupFields.length === 0) return null;

    return (
      <div className="mb-4">
        <h4 className="text-xs font-medium text-cad-text-dim uppercase tracking-wider mb-2">{title}</h4>
        <div className="space-y-2">
          {groupFields.map(field => (
            <div key={field.id} className="flex items-center gap-2">
              <label className="w-24 text-xs text-cad-text-dim text-right">{field.label}:</label>
              <input
                type="text"
                value={field.value}
                onChange={(e) => onUpdateField(sheetId, field.id, e.target.value)}
                className="flex-1 px-2 py-1.5 text-sm bg-cad-input border border-cad-border text-cad-text"
                placeholder={field.label}
              />
            </div>
          ))}
        </div>
      </div>
    );
  };

  return (
    <div>
      {renderFieldGroup('Project Information', projectFields)}
      {renderFieldGroup('Drawing Information', drawingFields)}
      {renderFieldGroup('Personnel', personnelFields)}
      {renderFieldGroup('Status', statusFields)}
      {renderFieldGroup('Other', otherFields)}

      <div className="mt-4 p-3 bg-blue-500/10 border border-blue-500/20 text-xs text-blue-400">
        <strong>Tip:</strong> Some fields like Sheet Number and Date are auto-calculated when you switch to this sheet.
      </div>
    </div>
  );
}

// ============================================================================
// Template Tab
// ============================================================================

interface TemplateTabProps {
  sheetId: string;
  currentTemplateId?: string;
  paperSize: string;
  onApplyTemplate: (sheetId: string, templateId: string) => void;
}

function TemplateTab({ sheetId, currentTemplateId, paperSize, onApplyTemplate }: TemplateTabProps) {
  // Filter templates compatible with this paper size
  const compatibleTemplates = BUILT_IN_TEMPLATES.filter(t =>
    t.paperSizes.includes(paperSize) || t.paperSizes.includes('Custom')
  );

  return (
    <div>
      <p className="text-xs text-cad-text-dim mb-4">
        Select a title block template. Your existing field values will be preserved where possible.
      </p>

      <div className="space-y-2">
        {compatibleTemplates.map(template => (
          <div
            key={template.id}
            className={`p-3 border cursor-pointer transition-colors ${
              currentTemplateId === template.id
                ? 'border-cad-accent bg-cad-accent/10'
                : 'border-cad-border hover:border-cad-accent/50 hover:bg-cad-hover'
            }`}
            onClick={() => onApplyTemplate(sheetId, template.id)}
          >
            <div className="flex items-center justify-between">
              <div>
                <h4 className="text-sm font-medium text-cad-text">{template.name}</h4>
                <p className="text-xs text-cad-text-dim">{template.description}</p>
              </div>
              {currentTemplateId === template.id && (
                <span className="text-xs px-2 py-0.5 bg-cad-accent text-white">Active</span>
              )}
            </div>
            <div className="mt-2 text-xs text-cad-text-dim">
              Compatible: {template.paperSizes.join(', ')}
            </div>
          </div>
        ))}
      </div>

      {compatibleTemplates.length === 0 && (
        <div className="text-center text-cad-text-dim py-8">
          No templates available for {paperSize} paper size.
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Revisions Tab
// ============================================================================

interface RevisionsTabProps {
  sheetId: string;
  revisions: { number: string; date: string; description: string; drawnBy: string }[];
  newRevisionDesc: string;
  newRevisionBy: string;
  onDescChange: (value: string) => void;
  onByChange: (value: string) => void;
  onAddRevision: (sheetId: string, description: string, drawnBy: string) => void;
}

function RevisionsTab({
  sheetId,
  revisions,
  newRevisionDesc,
  newRevisionBy,
  onDescChange,
  onByChange,
  onAddRevision,
}: RevisionsTabProps) {
  const handleAddRevision = useCallback(() => {
    if (!newRevisionDesc.trim()) return;
    onAddRevision(sheetId, newRevisionDesc.trim(), newRevisionBy.trim());
    onDescChange('');
    onByChange('');
  }, [sheetId, newRevisionDesc, newRevisionBy, onAddRevision, onDescChange, onByChange]);

  return (
    <div>
      {/* Add New Revision */}
      <div className="mb-4 p-3 bg-cad-input border border-cad-border">
        <h4 className="text-xs font-medium text-cad-text mb-2">Add New Revision</h4>
        <div className="space-y-2">
          <div>
            <label className="block text-xs text-cad-text-dim mb-1">Description:</label>
            <input
              type="text"
              value={newRevisionDesc}
              onChange={(e) => onDescChange(e.target.value)}
              className="w-full px-2 py-1.5 text-sm bg-cad-surface border border-cad-border text-cad-text"
              placeholder="What changed in this revision?"
            />
          </div>
          <div className="flex gap-2">
            <div className="flex-1">
              <label className="block text-xs text-cad-text-dim mb-1">By:</label>
              <input
                type="text"
                value={newRevisionBy}
                onChange={(e) => onByChange(e.target.value)}
                className="w-full px-2 py-1.5 text-sm bg-cad-surface border border-cad-border text-cad-text"
                placeholder="Your initials"
              />
            </div>
            <button
              onClick={handleAddRevision}
              disabled={!newRevisionDesc.trim()}
              className="self-end px-4 py-1.5 text-sm bg-cad-primary text-white hover:bg-cad-primary-hover disabled:bg-cad-input disabled:text-cad-text-dim"
            >
              <Plus size={14} className="inline mr-1" />
              Add
            </button>
          </div>
        </div>
      </div>

      {/* Revision History */}
      <div>
        <h4 className="text-xs font-medium text-cad-text-dim uppercase tracking-wider mb-2">
          Revision History ({revisions.length})
        </h4>

        {revisions.length === 0 ? (
          <div className="text-center text-cad-text-dim py-8 text-sm">
            No revisions yet. Add a revision to track changes.
          </div>
        ) : (
          <div className="border border-cad-border">
            {/* Header */}
            <div className="flex bg-cad-input text-xs font-medium text-cad-text-dim">
              <div className="w-12 px-2 py-1.5 border-r border-cad-border">Rev</div>
              <div className="w-24 px-2 py-1.5 border-r border-cad-border">Date</div>
              <div className="flex-1 px-2 py-1.5 border-r border-cad-border">Description</div>
              <div className="w-16 px-2 py-1.5">By</div>
            </div>

            {/* Rows (newest first) */}
            {[...revisions].reverse().map((rev, idx) => (
              <div
                key={idx}
                className="flex text-xs border-t border-cad-border hover:bg-cad-hover"
              >
                <div className="w-12 px-2 py-1.5 border-r border-cad-border font-medium text-cad-accent">
                  {rev.number}
                </div>
                <div className="w-24 px-2 py-1.5 border-r border-cad-border text-cad-text-dim">
                  {rev.date}
                </div>
                <div className="flex-1 px-2 py-1.5 border-r border-cad-border text-cad-text truncate">
                  {rev.description}
                </div>
                <div className="w-16 px-2 py-1.5 text-cad-text-dim">
                  {rev.drawnBy}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================================================
// Logo Tab
// ============================================================================

interface LogoTabProps {
  sheetId: string;
  logo?: { data: string; width: number; height: number };
  onSetLogo: (sheetId: string, logoData: string, width: number, height: number) => void;
  onRemoveLogo: (sheetId: string) => void;
}

function LogoTab({ sheetId, logo, onSetLogo, onRemoveLogo }: LogoTabProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [logoWidth, setLogoWidth] = useState(logo?.width || 30);
  const [logoHeight, setLogoHeight] = useState(logo?.height || 15);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Check file type
    if (!file.type.startsWith('image/')) {
      alert('Please select an image file.');
      return;
    }

    // Check file size (max 500KB)
    if (file.size > 500 * 1024) {
      alert('Image file is too large. Maximum size is 500KB.');
      return;
    }

    // Read file as data URL
    const reader = new FileReader();
    reader.onload = (event) => {
      const dataUrl = event.target?.result as string;
      if (dataUrl) {
        // Get image dimensions
        const img = new Image();
        img.onload = () => {
          // Calculate aspect ratio and set initial size
          const aspectRatio = img.width / img.height;
          const height = 15; // Default height in mm
          const width = height * aspectRatio;
          setLogoWidth(Math.round(width));
          setLogoHeight(height);
          onSetLogo(sheetId, dataUrl, width, height);
        };
        img.src = dataUrl;
      }
    };
    reader.readAsDataURL(file);
  }, [sheetId, onSetLogo]);

  const handleSizeChange = useCallback(() => {
    if (logo) {
      onSetLogo(sheetId, logo.data, logoWidth, logoHeight);
    }
  }, [sheetId, logo, logoWidth, logoHeight, onSetLogo]);

  return (
    <div>
      <p className="text-xs text-cad-text-dim mb-4">
        Upload a company logo to display in the title block. Supported formats: PNG, JPG, SVG.
      </p>

      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        onChange={handleFileSelect}
        className="hidden"
      />

      {logo ? (
        <div>
          {/* Logo Preview */}
          <div className="mb-4 p-4 bg-white border border-cad-border flex items-center justify-center">
            <img
              src={logo.data}
              alt="Company Logo"
              style={{ maxWidth: '200px', maxHeight: '100px' }}
            />
          </div>

          {/* Logo Size Controls */}
          <div className="mb-4 grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-cad-text-dim mb-1">Width (mm):</label>
              <input
                type="number"
                min="5"
                max="100"
                value={logoWidth}
                onChange={(e) => setLogoWidth(parseInt(e.target.value) || 30)}
                onBlur={handleSizeChange}
                className="w-full px-2 py-1.5 text-sm bg-cad-input border border-cad-border text-cad-text"
              />
            </div>
            <div>
              <label className="block text-xs text-cad-text-dim mb-1">Height (mm):</label>
              <input
                type="number"
                min="5"
                max="50"
                value={logoHeight}
                onChange={(e) => setLogoHeight(parseInt(e.target.value) || 15)}
                onBlur={handleSizeChange}
                className="w-full px-2 py-1.5 text-sm bg-cad-input border border-cad-border text-cad-text"
              />
            </div>
          </div>

          {/* Actions */}
          <div className="flex gap-2">
            <button
              onClick={() => fileInputRef.current?.click()}
              className="flex-1 px-4 py-2 text-sm bg-cad-input border border-cad-border text-cad-text hover:bg-cad-hover"
            >
              <RotateCcw size={14} className="inline mr-2" />
              Replace Logo
            </button>
            <button
              onClick={() => onRemoveLogo(sheetId)}
              className="px-4 py-2 text-sm bg-red-500/10 border border-red-500/30 text-red-400 hover:bg-red-500/20"
            >
              <Trash2 size={14} className="inline mr-2" />
              Remove
            </button>
          </div>
        </div>
      ) : (
        <div
          onClick={() => fileInputRef.current?.click()}
          className="border-2 border-dashed border-cad-border p-8 text-center cursor-pointer hover:border-cad-accent/50 hover:bg-cad-hover transition-colors"
        >
          <Upload size={32} className="mx-auto mb-2 text-cad-text-dim" />
          <p className="text-sm text-cad-text">Click to upload logo</p>
          <p className="text-xs text-cad-text-dim mt-1">PNG, JPG, or SVG (max 500KB)</p>
        </div>
      )}
    </div>
  );
}
