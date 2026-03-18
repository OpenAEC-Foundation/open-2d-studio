/**
 * TitleBlockEditor - Dialog for editing title block fields, templates, and revisions
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import { Upload, Trash2, Plus, RotateCcw } from 'lucide-react';
import { useAppStore } from '../../../state/appStore';
import { BUILT_IN_TEMPLATES } from '../../../services/template/titleBlockService';
import { DraggableModal, ModalButton } from '../../shared/DraggableModal';

interface TitleBlockEditorProps {
  isOpen: boolean;
  onClose: () => void;
  sheetId: string;
}

type TabType = 'fields' | 'template' | 'revisions' | 'logo';

interface PendingRevision {
  description: string;
  drawnBy: string;
}

interface PendingChanges {
  fields: Record<string, string>;
  templateId?: string;
  revisions: PendingRevision[];
  logo?: { data: string; width: number; height: number } | null;
  logoRemoved: boolean;
}

export function TitleBlockEditor({ isOpen, onClose, sheetId }: TitleBlockEditorProps) {
  const [activeTab, setActiveTab] = useState<TabType>('fields');
  const [newRevisionDesc, setNewRevisionDesc] = useState('');
  const [newRevisionBy, setNewRevisionBy] = useState('');

  // Pending changes state - only applied when OK is clicked
  const [pendingChanges, setPendingChanges] = useState<PendingChanges>({
    fields: {},
    templateId: undefined,
    revisions: [],
    logo: undefined,
    logoRemoved: false,
  });

  const {
    sheets,
    updateTitleBlockField,
    applyTitleBlockTemplate,
    addRevisionToSheet,
    setTitleBlockLogo,
    removeTitleBlockLogo,
  } = useAppStore();

  const sheet = sheets.find(s => s.id === sheetId);

  // Reset pending changes when dialog opens
  useEffect(() => {
    if (isOpen) {
      setPendingChanges({
        fields: {},
        templateId: undefined,
        revisions: [],
        logo: undefined,
        logoRemoved: false,
      });
      setNewRevisionDesc('');
      setNewRevisionBy('');
    }
  }, [isOpen, sheetId]);

  // Handler for updating a field in pending changes
  const handleFieldChange = useCallback((fieldId: string, value: string) => {
    setPendingChanges(prev => ({
      ...prev,
      fields: { ...prev.fields, [fieldId]: value },
    }));
  }, []);

  // Handler for template change
  const handleTemplateChange = useCallback((templateId: string) => {
    setPendingChanges(prev => ({
      ...prev,
      templateId,
    }));
  }, []);

  // Handler for adding a revision
  const handleAddRevision = useCallback((description: string, drawnBy: string) => {
    setPendingChanges(prev => ({
      ...prev,
      revisions: [...prev.revisions, { description, drawnBy }],
    }));
  }, []);

  // Handler for setting logo
  const handleSetLogo = useCallback((logoData: string, width: number, height: number) => {
    setPendingChanges(prev => ({
      ...prev,
      logo: { data: logoData, width, height },
      logoRemoved: false,
    }));
  }, []);

  // Handler for removing logo
  const handleRemoveLogo = useCallback(() => {
    setPendingChanges(prev => ({
      ...prev,
      logo: null,
      logoRemoved: true,
    }));
  }, []);

  // Apply all pending changes
  const handleOk = useCallback(() => {
    // Apply field changes
    for (const [fieldId, value] of Object.entries(pendingChanges.fields)) {
      updateTitleBlockField(sheetId, fieldId, value);
    }

    // Apply template change
    if (pendingChanges.templateId) {
      applyTitleBlockTemplate(sheetId, pendingChanges.templateId);
    }

    // Apply revisions
    for (const rev of pendingChanges.revisions) {
      addRevisionToSheet(sheetId, rev.description, rev.drawnBy);
    }

    // Apply logo changes
    if (pendingChanges.logoRemoved) {
      removeTitleBlockLogo(sheetId);
    } else if (pendingChanges.logo) {
      setTitleBlockLogo(sheetId, pendingChanges.logo.data, pendingChanges.logo.width, pendingChanges.logo.height);
    }

    onClose();
  }, [
    sheetId,
    pendingChanges,
    updateTitleBlockField,
    applyTitleBlockTemplate,
    addRevisionToSheet,
    setTitleBlockLogo,
    removeTitleBlockLogo,
    onClose,
  ]);

  // Cancel and discard changes
  const handleCancel = useCallback(() => {
    onClose();
  }, [onClose]);

  if (!sheet) return null;

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

  const footerContent = (
    <>
      <ModalButton onClick={handleCancel}>Cancel</ModalButton>
      <ModalButton onClick={handleOk} variant="primary">OK</ModalButton>
    </>
  );

  return (
    <DraggableModal
      isOpen={isOpen}
      onClose={onClose}
      title={`Title Block Editor - ${sheet.name}`}
      width={500}
      height={480}
      footer={footerContent}
    >
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
            fields={titleBlock.fields}
            pendingFields={pendingChanges.fields}
            onUpdateField={handleFieldChange}
          />
        )}

        {activeTab === 'template' && (
          <TemplateTab
            currentTemplateId={pendingChanges.templateId || enhancedTitleBlock.templateId}
            paperSize={sheet.paperSize}
            onApplyTemplate={handleTemplateChange}
          />
        )}

        {activeTab === 'revisions' && (
          <RevisionsTab
            existingRevisions={enhancedTitleBlock.revisionTable?.revisions || []}
            pendingRevisions={pendingChanges.revisions}
            newRevisionDesc={newRevisionDesc}
            newRevisionBy={newRevisionBy}
            onDescChange={setNewRevisionDesc}
            onByChange={setNewRevisionBy}
            onAddRevision={handleAddRevision}
          />
        )}

        {activeTab === 'logo' && (
          <LogoTab
            logo={pendingChanges.logoRemoved ? undefined : (pendingChanges.logo || enhancedTitleBlock.logo)}
            pendingLogo={pendingChanges.logo}
            logoRemoved={pendingChanges.logoRemoved}
            onSetLogo={handleSetLogo}
            onRemoveLogo={handleRemoveLogo}
          />
        )}
      </div>
    </DraggableModal>
  );
}

// ============================================================================
// Fields Tab
// ============================================================================

interface FieldsTabProps {
  fields: { id: string; label: string; value: string }[];
  pendingFields: Record<string, string>;
  onUpdateField: (fieldId: string, value: string) => void;
}

function FieldsTab({ fields, pendingFields, onUpdateField }: FieldsTabProps) {
  // Get the effective value for a field (pending change or original)
  const getFieldValue = (field: { id: string; value: string }) => {
    return pendingFields[field.id] !== undefined ? pendingFields[field.id] : field.value;
  };

  // Group fields by category
  const projectFields = fields.filter(f => ['project', 'client', 'address'].includes(f.id));
  const drawingFields = fields.filter(f => ['title', 'number', 'scale'].includes(f.id));
  const personnelFields = fields.filter(f => ['drawnBy', 'checkedBy', 'approvedBy'].includes(f.id));
  const statusFields = fields.filter(f => ['date', 'sheet', 'sheetNo', 'revision', 'status'].includes(f.id));
  const otherFields = fields.filter(f =>
    !['project', 'client', 'address', 'title', 'number', 'scale', 'drawnBy', 'checkedBy', 'approvedBy', 'date', 'sheet', 'sheetNo', 'revision', 'status', 'logo'].includes(f.id)
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
                value={getFieldValue(field)}
                onChange={(e) => onUpdateField(field.id, e.target.value)}
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
  currentTemplateId?: string;
  paperSize: string;
  onApplyTemplate: (templateId: string) => void;
}

function TemplateTab({ currentTemplateId, paperSize, onApplyTemplate }: TemplateTabProps) {
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
            onClick={() => onApplyTemplate(template.id)}
          >
            <div className="flex items-center justify-between">
              <div>
                <h4 className="text-sm font-medium text-cad-text">{template.name}</h4>
                <p className="text-xs text-cad-text-dim">{template.description}</p>
              </div>
              {currentTemplateId === template.id && (
                <span className="text-xs px-2 py-0.5 bg-cad-accent text-white">Selected</span>
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
  existingRevisions: { number: string; date: string; description: string; drawnBy: string }[];
  pendingRevisions: PendingRevision[];
  newRevisionDesc: string;
  newRevisionBy: string;
  onDescChange: (value: string) => void;
  onByChange: (value: string) => void;
  onAddRevision: (description: string, drawnBy: string) => void;
}

function RevisionsTab({
  existingRevisions,
  pendingRevisions,
  newRevisionDesc,
  newRevisionBy,
  onDescChange,
  onByChange,
  onAddRevision,
}: RevisionsTabProps) {
  const handleAddRevision = useCallback(() => {
    if (!newRevisionDesc.trim()) return;
    onAddRevision(newRevisionDesc.trim(), newRevisionBy.trim());
    onDescChange('');
    onByChange('');
  }, [newRevisionDesc, newRevisionBy, onAddRevision, onDescChange, onByChange]);

  // Calculate next revision number for pending revisions
  const getNextRevNumber = (index: number) => {
    const baseNumber = existingRevisions.length;
    return String(baseNumber + index + 1);
  };

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
              className="self-end px-4 py-1.5 text-sm bg-cad-accent text-white hover:bg-cad-accent/80 disabled:bg-cad-input disabled:text-cad-text-dim"
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
          Revision History ({existingRevisions.length + pendingRevisions.length})
        </h4>

        {existingRevisions.length === 0 && pendingRevisions.length === 0 ? (
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

            {/* Pending revisions (newest first, shown with "pending" indicator) */}
            {[...pendingRevisions].reverse().map((rev, idx) => (
              <div
                key={`pending-${idx}`}
                className="flex text-xs border-t border-cad-border bg-yellow-500/10"
              >
                <div className="w-12 px-2 py-1.5 border-r border-cad-border font-medium text-yellow-500">
                  {getNextRevNumber(pendingRevisions.length - 1 - idx)}*
                </div>
                <div className="w-24 px-2 py-1.5 border-r border-cad-border text-cad-text-dim italic">
                  (pending)
                </div>
                <div className="flex-1 px-2 py-1.5 border-r border-cad-border text-cad-text truncate">
                  {rev.description}
                </div>
                <div className="w-16 px-2 py-1.5 text-cad-text-dim">
                  {rev.drawnBy}
                </div>
              </div>
            ))}

            {/* Existing revisions (newest first) */}
            {[...existingRevisions].reverse().map((rev, idx) => (
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
  logo?: { data: string; width: number; height: number };
  pendingLogo?: { data: string; width: number; height: number } | null;
  logoRemoved: boolean;
  onSetLogo: (logoData: string, width: number, height: number) => void;
  onRemoveLogo: () => void;
}

function LogoTab({ logo, pendingLogo, logoRemoved, onSetLogo, onRemoveLogo }: LogoTabProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const effectiveLogo = logoRemoved ? undefined : (pendingLogo || logo);
  const [logoWidth, setLogoWidth] = useState(effectiveLogo?.width || 30);
  const [logoHeight, setLogoHeight] = useState(effectiveLogo?.height || 15);

  // Update local state when logo changes
  useEffect(() => {
    if (effectiveLogo) {
      setLogoWidth(effectiveLogo.width);
      setLogoHeight(effectiveLogo.height);
    }
  }, [effectiveLogo]);

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
          onSetLogo(dataUrl, width, height);
        };
        img.src = dataUrl;
      }
    };
    reader.readAsDataURL(file);
  }, [onSetLogo]);

  const handleSizeChange = useCallback(() => {
    if (effectiveLogo) {
      onSetLogo(effectiveLogo.data, logoWidth, logoHeight);
    }
  }, [effectiveLogo, logoWidth, logoHeight, onSetLogo]);

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

      {effectiveLogo ? (
        <div>
          {/* Logo Preview */}
          <div className="mb-4 p-4 bg-white border border-cad-border flex items-center justify-center">
            <img
              src={effectiveLogo.data}
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
              onClick={() => onRemoveLogo()}
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
