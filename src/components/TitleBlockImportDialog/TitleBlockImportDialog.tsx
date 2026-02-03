/**
 * TitleBlockImportDialog - Wizard for importing SVG-based sheet templates
 */

import { useState, useRef, useCallback } from 'react';
import { X, Upload, FileText, Check, AlertCircle, ChevronRight, ChevronLeft, Plus, Trash2 } from 'lucide-react';
import {
  detectPlaceholders,
  parseSVGDimensions,
  validateSVG,
  createSVGTemplate,
  createFieldMappings,
  addCustomSVGTemplate,
  type DetectedPlaceholder,
} from '../../services/svgTitleBlockService';
import type { SVGFieldMapping } from '../../types/sheet';

interface TitleBlockImportDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onImportComplete?: () => void;
}

type WizardStep = 'upload' | 'fields' | 'details' | 'preview';

const PAPER_SIZE_OPTIONS = ['A4', 'A3', 'A2', 'A1', 'A0', 'Letter', 'Legal', 'Tabloid', 'Custom'];

export function TitleBlockImportDialog({ isOpen, onClose, onImportComplete }: TitleBlockImportDialogProps) {
  const [step, setStep] = useState<WizardStep>('upload');
  const [svgContent, setSvgContent] = useState<string>('');
  const [error, setError] = useState<string>('');
  const [isLoading, setIsLoading] = useState(false);
  const [placeholders, setPlaceholders] = useState<DetectedPlaceholder[]>([]);
  const [fieldMappings, setFieldMappings] = useState<SVGFieldMapping[]>([]);
  const [templateName, setTemplateName] = useState<string>('');
  const [templateDescription, setTemplateDescription] = useState<string>('');
  const [selectedPaperSizes, setSelectedPaperSizes] = useState<string[]>(['A3']);
  const [dimensions, setDimensions] = useState<{ width: number; height: number }>({ width: 280, height: 45 });
  const [isFullPage, setIsFullPage] = useState<boolean>(true);

  // Drag state for modal
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const dragStartRef = useRef({ x: 0, y: 0 });

  const fileInputRef = useRef<HTMLInputElement>(null);

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

  const resetWizard = useCallback(() => {
    setStep('upload');
    setSvgContent('');
    setError('');
    setIsLoading(false);
    setPlaceholders([]);
    setFieldMappings([]);
    setTemplateName('');
    setTemplateDescription('');
    setSelectedPaperSizes(['A3']);
    setDimensions({ width: 280, height: 45 });
    setIsFullPage(true);
    setPosition({ x: 0, y: 0 });
  }, []);

  const handleClose = useCallback(() => {
    resetWizard();
    onClose();
  }, [resetWizard, onClose]);

  const handleFileSelect = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setError('');
    setIsLoading(true);

    try {
      const content = await file.text();

      // Validate SVG
      const validation = validateSVG(content);
      if (!validation.valid) {
        setError(validation.error || 'Invalid SVG file');
        setIsLoading(false);
        return;
      }

      setSvgContent(content);

      // Detect placeholders
      const detected = detectPlaceholders(content);
      setPlaceholders(detected);
      setFieldMappings(createFieldMappings(detected));

      // Parse dimensions
      const dims = parseSVGDimensions(content);
      if (dims) {
        setDimensions(dims);
      }

      // Set default template name from filename
      const nameWithoutExt = file.name.replace(/\.[^/.]+$/, '');
      setTemplateName(nameWithoutExt);

      // Move to next step
      setStep('fields');
    } catch (err) {
      setError('Failed to process file: ' + (err as Error).message);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    const isSvg = file && (file.type === 'image/svg+xml' || file.name.toLowerCase().endsWith('.svg'));

    if (isSvg) {
      // Simulate file input change
      const dt = new DataTransfer();
      dt.items.add(file);
      if (fileInputRef.current) {
        fileInputRef.current.files = dt.files;
        fileInputRef.current.dispatchEvent(new Event('change', { bubbles: true }));
      }
    } else {
      setError('Please drop an SVG file');
    }
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
  }, []);

  const updateFieldMapping = useCallback((index: number, updates: Partial<SVGFieldMapping>) => {
    setFieldMappings(prev => prev.map((m, i) => i === index ? { ...m, ...updates } : m));
  }, []);

  const addManualField = useCallback(() => {
    const fieldId = `field_${Date.now()}`;
    const newField: SVGFieldMapping = {
      fieldId,
      svgSelector: `{{${fieldId}}}`,
      label: 'New Field',
      defaultValue: '',
      isAutoField: false,
    };
    setFieldMappings(prev => [...prev, newField]);
  }, []);

  const removeFieldMapping = useCallback((index: number) => {
    setFieldMappings(prev => prev.filter((_, i) => i !== index));
  }, []);

  const togglePaperSize = useCallback((size: string) => {
    setSelectedPaperSizes(prev =>
      prev.includes(size)
        ? prev.filter(s => s !== size)
        : [...prev, size]
    );
  }, []);

  const handleImport = useCallback(() => {
    if (!svgContent || !templateName.trim()) {
      setError('Please provide a template name');
      return;
    }

    if (selectedPaperSizes.length === 0) {
      setError('Please select at least one paper size');
      return;
    }

    try {
      const template = createSVGTemplate(
        svgContent,
        templateName.trim(),
        templateDescription.trim(),
        selectedPaperSizes,
        fieldMappings,
        dimensions,
        isFullPage
      );

      addCustomSVGTemplate(template);
      onImportComplete?.();
      handleClose();
    } catch (e) {
      setError('Failed to create template: ' + (e as Error).message);
    }
  }, [svgContent, templateName, templateDescription, selectedPaperSizes, fieldMappings, dimensions, isFullPage, onImportComplete, handleClose]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
    >
      <div
        className="bg-cad-surface border border-cad-border shadow-xl w-[600px] h-[550px] flex flex-col"
        style={{ transform: `translate(${position.x}px, ${position.y}px)` }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-3 py-1.5 border-b border-cad-border select-none"
          style={{ background: 'linear-gradient(to bottom, #ffffff, #f5f5f5)', borderColor: '#d4d4d4' }}
          onMouseDown={handleMouseDown}
        >
          <h2 className="text-xs font-semibold text-gray-800 flex items-center gap-2">
            <Upload size={14} />
            Import Sheet Template
          </h2>
          <button
            onClick={handleClose}
            className="p-0.5 hover:bg-cad-hover rounded transition-colors text-gray-600 hover:text-gray-800 cursor-default -mr-1"
          >
            <X size={14} />
          </button>
        </div>

        {/* Progress Steps */}
        <div className="flex items-center justify-center gap-2 px-4 py-2 border-b border-cad-border bg-cad-bg/50">
          {(['upload', 'fields', 'details', 'preview'] as WizardStep[]).map((s, i) => (
            <div key={s} className="flex items-center">
              <div
                className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-medium ${
                  step === s
                    ? 'bg-cad-accent text-white'
                    : i < ['upload', 'fields', 'details', 'preview'].indexOf(step)
                    ? 'bg-green-500 text-white'
                    : 'bg-cad-border text-cad-text-dim'
                }`}
              >
                {i < ['upload', 'fields', 'details', 'preview'].indexOf(step) ? <Check size={12} /> : i + 1}
              </div>
              {i < 3 && <div className="w-8 h-0.5 bg-cad-border mx-1" />}
            </div>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4">
          {/* Step 1: Upload */}
          {step === 'upload' && (
            <div className="h-full flex flex-col">
              <h3 className="text-sm font-medium text-cad-text mb-2">Template Type</h3>
              <div className="flex gap-4 mb-4">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="templateType"
                    checked={isFullPage}
                    onChange={() => setIsFullPage(true)}
                    className="w-4 h-4 text-cad-accent focus:ring-cad-accent"
                  />
                  <div>
                    <span className="text-xs text-cad-text font-medium">Full-page template</span>
                    <p className="text-xs text-cad-text-dim">Covers entire sheet (borders, margins, title block)</p>
                  </div>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="templateType"
                    checked={!isFullPage}
                    onChange={() => setIsFullPage(false)}
                    className="w-4 h-4 text-cad-accent focus:ring-cad-accent"
                  />
                  <div>
                    <span className="text-xs text-cad-text font-medium">Title block only</span>
                    <p className="text-xs text-cad-text-dim">Corner placement on sheet</p>
                  </div>
                </label>
              </div>

              <h3 className="text-sm font-medium text-cad-text mb-2">Select SVG File</h3>
              <p className="text-xs text-cad-text-dim mb-4">
                Upload an SVG file containing your sheet template design. Use <code className="bg-cad-input px-1 rounded">{'{{fieldName}}'}</code> placeholders for editable fields.
              </p>

              <input
                ref={fileInputRef}
                type="file"
                accept=".svg,image/svg+xml"
                onChange={handleFileSelect}
                className="hidden"
              />

              <div
                onClick={() => !isLoading && fileInputRef.current?.click()}
                onDrop={handleDrop}
                onDragOver={handleDragOver}
                className={`flex-1 border-2 border-dashed border-cad-border rounded-lg flex flex-col items-center justify-center transition-colors ${
                  isLoading ? 'cursor-wait bg-cad-hover' : 'cursor-pointer hover:border-cad-accent/50 hover:bg-cad-hover'
                }`}
              >
                {isLoading ? (
                  <>
                    <div className="w-8 h-8 border-2 border-cad-accent border-t-transparent rounded-full animate-spin mb-3" />
                    <p className="text-sm text-cad-text mb-1">Processing file...</p>
                    <p className="text-xs text-cad-text-dim">Please wait</p>
                  </>
                ) : (
                  <>
                    <FileText size={48} className="text-cad-text-dim mb-3" />
                    <p className="text-sm text-cad-text mb-1">Click to select or drag & drop</p>
                    <p className="text-xs text-cad-text-dim">SVG files only</p>
                  </>
                )}
              </div>

              {error && (
                <div className="mt-3 p-2 bg-red-500/10 border border-red-500/30 rounded flex items-center gap-2 text-red-400 text-xs">
                  <AlertCircle size={14} />
                  {error}
                </div>
              )}

              <div className="mt-4 p-3 bg-cad-input rounded text-xs text-cad-text-dim">
                <strong className="text-cad-text">Tip:</strong> Use placeholders like{' '}
                <code className="bg-cad-bg px-1 rounded">{'{{project}}'}</code>,{' '}
                <code className="bg-cad-bg px-1 rounded">{'{{scale}}'}</code>,{' '}
                <code className="bg-cad-bg px-1 rounded">{'{{date}}'}</code> in your SVG text elements.
              </div>
            </div>
          )}

          {/* Step 2: Field Mappings */}
          {step === 'fields' && (
            <div>
              <h3 className="text-sm font-medium text-cad-text mb-2">Detected Fields</h3>
              <p className="text-xs text-cad-text-dim mb-4">
                {placeholders.length > 0
                  ? `Found ${placeholders.length} placeholder(s). Configure the field labels and default values.`
                  : 'No placeholders detected. Add fields manually or use as a static template.'}
              </p>

              <div className="space-y-2 max-h-[240px] overflow-y-auto">
                {fieldMappings.map((mapping, index) => (
                  <div
                    key={mapping.fieldId}
                    className="p-3 bg-cad-input border border-cad-border rounded"
                  >
                    <div className="flex items-center justify-between gap-2 mb-2">
                      <div className="flex items-center gap-2">
                        <code className="text-xs bg-cad-bg px-1 rounded text-cad-accent">
                          {mapping.svgSelector}
                        </code>
                        {mapping.isAutoField && (
                          <span className="text-xs px-1.5 py-0.5 bg-blue-500/20 text-blue-400 rounded">
                            Auto
                          </span>
                        )}
                      </div>
                      <button
                        onClick={() => removeFieldMapping(index)}
                        className="p-1 text-cad-text-dim hover:text-red-400 hover:bg-red-500/10 rounded transition-colors"
                        title="Remove field"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="block text-xs text-cad-text-dim mb-1">Label</label>
                        <input
                          type="text"
                          value={mapping.label}
                          onChange={(e) => updateFieldMapping(index, { label: e.target.value })}
                          className="w-full px-2 py-1 text-xs bg-cad-surface border border-cad-border text-cad-text rounded"
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-cad-text-dim mb-1">Default Value</label>
                        <input
                          type="text"
                          value={mapping.defaultValue}
                          onChange={(e) => updateFieldMapping(index, { defaultValue: e.target.value })}
                          className="w-full px-2 py-1 text-xs bg-cad-surface border border-cad-border text-cad-text rounded"
                          placeholder={mapping.isAutoField ? '(auto-calculated)' : ''}
                        />
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              <button
                onClick={addManualField}
                className="mt-3 w-full px-3 py-2 text-xs bg-cad-input border border-cad-border border-dashed text-cad-text hover:bg-cad-hover hover:border-cad-accent/50 rounded flex items-center justify-center gap-2 transition-colors"
              >
                <Plus size={14} />
                Add Field
              </button>

              {error && (
                <div className="mt-3 p-2 bg-red-500/10 border border-red-500/30 rounded flex items-center gap-2 text-red-400 text-xs">
                  <AlertCircle size={14} />
                  {error}
                </div>
              )}
            </div>
          )}

          {/* Step 3: Template Details */}
          {step === 'details' && (
            <div>
              <h3 className="text-sm font-medium text-cad-text mb-2">Template Details</h3>
              <p className="text-xs text-cad-text-dim mb-4">
                Provide a name and description for your template, and select compatible paper sizes.
              </p>

              <div className="space-y-4">
                <div>
                  <label className="block text-xs text-cad-text-dim mb-1">Template Name *</label>
                  <input
                    type="text"
                    value={templateName}
                    onChange={(e) => setTemplateName(e.target.value)}
                    className="w-full px-2 py-1.5 text-sm bg-cad-input border border-cad-border text-cad-text rounded"
                    placeholder="My Custom Sheet Template"
                  />
                </div>

                <div>
                  <label className="block text-xs text-cad-text-dim mb-1">Description</label>
                  <textarea
                    value={templateDescription}
                    onChange={(e) => setTemplateDescription(e.target.value)}
                    className="w-full px-2 py-1.5 text-sm bg-cad-input border border-cad-border text-cad-text rounded resize-none"
                    rows={2}
                    placeholder="Optional description..."
                  />
                </div>

                <div>
                  <label className="block text-xs text-cad-text-dim mb-2">Compatible Paper Sizes *</label>
                  <div className="flex flex-wrap gap-1">
                    {PAPER_SIZE_OPTIONS.map(size => (
                      <button
                        key={size}
                        onClick={() => togglePaperSize(size)}
                        className={`px-2 py-1 text-xs rounded transition-colors ${
                          selectedPaperSizes.includes(size)
                            ? 'bg-cad-accent text-white'
                            : 'bg-cad-input text-cad-text hover:bg-cad-hover'
                        }`}
                      >
                        {size}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs text-cad-text-dim mb-1">Width (mm)</label>
                    <input
                      type="number"
                      value={dimensions.width}
                      onChange={(e) => setDimensions(d => ({ ...d, width: parseFloat(e.target.value) || 0 }))}
                      className="w-full px-2 py-1.5 text-sm bg-cad-input border border-cad-border text-cad-text rounded"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-cad-text-dim mb-1">Height (mm)</label>
                    <input
                      type="number"
                      value={dimensions.height}
                      onChange={(e) => setDimensions(d => ({ ...d, height: parseFloat(e.target.value) || 0 }))}
                      className="w-full px-2 py-1.5 text-sm bg-cad-input border border-cad-border text-cad-text rounded"
                    />
                  </div>
                </div>
              </div>

              {error && (
                <div className="mt-3 p-2 bg-red-500/10 border border-red-500/30 rounded flex items-center gap-2 text-red-400 text-xs">
                  <AlertCircle size={14} />
                  {error}
                </div>
              )}
            </div>
          )}

          {/* Step 4: Preview */}
          {step === 'preview' && (
            <div>
              <h3 className="text-sm font-medium text-cad-text mb-2">Preview</h3>
              <p className="text-xs text-cad-text-dim mb-4">
                Review your sheet template before importing.
              </p>

              <div className="bg-[#606060] border border-cad-border rounded p-4 mb-4 overflow-hidden">
                <div
                  className="mx-auto flex items-center justify-center"
                  style={{
                    width: '100%',
                    height: '200px',
                  }}
                >
                  <div
                    style={{
                      width: '100%',
                      height: '100%',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                    dangerouslySetInnerHTML={{
                      __html: svgContent.replace(
                        /<svg([^>]*)>/,
                        '<svg$1 style="max-width: 100%; max-height: 100%; width: auto; height: auto; background: white;">'
                      )
                    }}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4 text-xs">
                <div className="p-3 bg-cad-input rounded">
                  <div className="text-cad-text-dim mb-1">Template Name</div>
                  <div className="text-cad-text font-medium">{templateName}</div>
                </div>
                <div className="p-3 bg-cad-input rounded">
                  <div className="text-cad-text-dim mb-1">Dimensions</div>
                  <div className="text-cad-text font-medium">{dimensions.width.toFixed(1)} x {dimensions.height.toFixed(1)} mm</div>
                </div>
                <div className="p-3 bg-cad-input rounded">
                  <div className="text-cad-text-dim mb-1">Paper Sizes</div>
                  <div className="text-cad-text font-medium">{selectedPaperSizes.join(', ')}</div>
                </div>
                <div className="p-3 bg-cad-input rounded">
                  <div className="text-cad-text-dim mb-1">Fields</div>
                  <div className="text-cad-text font-medium">{fieldMappings.length} editable field(s)</div>
                </div>
                <div className="p-3 bg-cad-input rounded col-span-2">
                  <div className="text-cad-text-dim mb-1">Template Type</div>
                  <div className="text-cad-text font-medium">
                    {isFullPage ? 'Full-page template (covers entire sheet)' : 'Title block only (corner placement)'}
                  </div>
                </div>
              </div>

              {error && (
                <div className="mt-3 p-2 bg-red-500/10 border border-red-500/30 rounded flex items-center gap-2 text-red-400 text-xs">
                  <AlertCircle size={14} />
                  {error}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-3 py-2 border-t border-cad-border flex justify-between">
          <div>
            {step !== 'upload' && (
              <button
                onClick={() => {
                  const steps: WizardStep[] = ['upload', 'fields', 'details', 'preview'];
                  const currentIndex = steps.indexOf(step);
                  if (currentIndex > 0) setStep(steps[currentIndex - 1]);
                }}
                className="px-3 py-1 text-xs bg-cad-input border border-cad-border text-cad-text hover:bg-cad-hover flex items-center gap-1"
              >
                <ChevronLeft size={12} />
                Back
              </button>
            )}
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleClose}
              className="px-3 py-1 text-xs bg-cad-input border border-cad-border text-cad-text hover:bg-cad-hover"
            >
              Cancel
            </button>
            {step !== 'preview' ? (
              <button
                onClick={() => {
                  setError('');
                  const steps: WizardStep[] = ['upload', 'fields', 'details', 'preview'];
                  const currentIndex = steps.indexOf(step);
                  if (currentIndex < steps.length - 1) setStep(steps[currentIndex + 1]);
                }}
                disabled={step === 'upload' && !svgContent}
                className="px-3 py-1 text-xs bg-cad-accent text-white hover:bg-cad-accent/80 disabled:bg-cad-input disabled:text-cad-text-dim flex items-center gap-1"
              >
                Next
                <ChevronRight size={12} />
              </button>
            ) : (
              <button
                onClick={handleImport}
                className="px-3 py-1 text-xs bg-cad-accent text-white hover:bg-cad-accent/80 flex items-center gap-1"
              >
                <Check size={12} />
                Import Template
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
