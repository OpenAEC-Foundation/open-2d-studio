/**
 * TextStyleManager - Dialog for creating, editing, duplicating, and deleting
 * text styles (named, reusable text formatting configurations).
 */

import { useState } from 'react';
import { Plus, Copy, Trash2, Edit, Type } from 'lucide-react';
import { useAppStore, generateId } from '../../../state/appStore';
import { DraggableModal } from '../../shared/DraggableModal';
import type { TextStyle, TextAlignment, TextVerticalAlignment, TextCase } from '../../../types/geometry';

interface TextStyleManagerProps {
  isOpen: boolean;
  onClose: () => void;
}

const inputClass = 'w-full bg-cad-bg border border-cad-border rounded px-2 py-1 text-xs text-cad-text';
const labelClass = 'block text-xs text-cad-text-dim mb-1';

export function TextStyleManager({ isOpen, onClose }: TextStyleManagerProps) {
  const {
    textStyles,
    addTextStyle,
    updateTextStyle,
    deleteTextStyle,
    duplicateTextStyle,
  } = useAppStore();

  const [selectedStyleId, setSelectedStyleId] = useState<string | null>(null);
  const [editingStyle, setEditingStyle] = useState<Partial<TextStyle> | null>(null);
  const [isCreating, setIsCreating] = useState(false);

  const selectedStyle = selectedStyleId ? textStyles.find(t => t.id === selectedStyleId) : null;
  const builtInStyles = textStyles.filter(t => t.isBuiltIn);
  const customStyles = textStyles.filter(t => !t.isBuiltIn);

  const handleCreate = () => {
    setIsCreating(true);
    setEditingStyle({
      name: 'New Style',
      fontFamily: 'Osifont',
      fontSize: 2.5,
      bold: false,
      italic: false,
      underline: false,
      color: '#ffffff',
      alignment: 'left',
      verticalAlignment: 'top',
      lineHeight: 1.4,
      isModelText: false,
      backgroundMask: false,
      backgroundColor: '#1a1a2e',
      backgroundPadding: 0.5,
    });
    setSelectedStyleId(null);
  };

  const handleEdit = (style: TextStyle) => {
    setIsCreating(false);
    setEditingStyle({ ...style });
    setSelectedStyleId(style.id);
  };

  const handleSave = () => {
    if (!editingStyle) return;

    if (isCreating) {
      const id = generateId();
      addTextStyle({
        id,
        name: editingStyle.name || 'Untitled',
        fontFamily: editingStyle.fontFamily || 'Osifont',
        fontSize: editingStyle.fontSize || 2.5,
        bold: editingStyle.bold ?? false,
        italic: editingStyle.italic ?? false,
        underline: editingStyle.underline ?? false,
        color: editingStyle.color || '#ffffff',
        alignment: editingStyle.alignment || 'left',
        verticalAlignment: editingStyle.verticalAlignment || 'top',
        lineHeight: editingStyle.lineHeight || 1.4,
        isModelText: editingStyle.isModelText ?? false,
        backgroundMask: editingStyle.backgroundMask ?? false,
        backgroundColor: editingStyle.backgroundColor || '#1a1a2e',
        backgroundPadding: editingStyle.backgroundPadding ?? 0.5,
        strikethrough: editingStyle.strikethrough,
        textCase: editingStyle.textCase,
        letterSpacing: editingStyle.letterSpacing,
        widthFactor: editingStyle.widthFactor,
        obliqueAngle: editingStyle.obliqueAngle,
        paragraphSpacing: editingStyle.paragraphSpacing,
      });
      setSelectedStyleId(id);
    } else if (selectedStyleId) {
      updateTextStyle(selectedStyleId, {
        name: editingStyle.name,
        fontFamily: editingStyle.fontFamily,
        fontSize: editingStyle.fontSize,
        bold: editingStyle.bold,
        italic: editingStyle.italic,
        underline: editingStyle.underline,
        color: editingStyle.color,
        alignment: editingStyle.alignment,
        verticalAlignment: editingStyle.verticalAlignment,
        lineHeight: editingStyle.lineHeight,
        isModelText: editingStyle.isModelText,
        backgroundMask: editingStyle.backgroundMask,
        backgroundColor: editingStyle.backgroundColor,
        backgroundPadding: editingStyle.backgroundPadding,
        strikethrough: editingStyle.strikethrough,
        textCase: editingStyle.textCase,
        letterSpacing: editingStyle.letterSpacing,
        widthFactor: editingStyle.widthFactor,
        obliqueAngle: editingStyle.obliqueAngle,
        paragraphSpacing: editingStyle.paragraphSpacing,
      });
    }

    setEditingStyle(null);
    setIsCreating(false);
  };

  const handleCancel = () => {
    setEditingStyle(null);
    setIsCreating(false);
  };

  const handleDelete = (id: string) => {
    deleteTextStyle(id);
    if (selectedStyleId === id) {
      setSelectedStyleId(null);
      setEditingStyle(null);
    }
  };

  const handleDuplicate = (id: string) => {
    const newId = duplicateTextStyle(id);
    if (newId) setSelectedStyleId(newId);
  };

  if (!isOpen) return null;

  return (
    <DraggableModal
      isOpen={isOpen}
      onClose={onClose}
      title="Text Styles"
      icon={<Type className="w-4 h-4" />}
      width={750}
      height={520}
    >
      <div className="flex h-full gap-3">
        {/* Left panel - Style list */}
        <div className="w-56 flex-shrink-0 flex flex-col border-r border-cad-border pr-3">
          <div className="flex items-center gap-1 mb-2">
            <button
              onClick={handleCreate}
              className="flex items-center gap-1 px-2 py-1 text-xs bg-cad-accent text-black rounded hover:brightness-110"
              title="Create new text style"
            >
              <Plus className="w-3 h-3" /> New
            </button>
          </div>

          <div className="flex-1 overflow-y-auto space-y-1">
            {builtInStyles.length > 0 && (
              <>
                <div className="text-[10px] uppercase tracking-wider text-cad-text-dim font-semibold px-1 mt-1">Built-in</div>
                {builtInStyles.map(style => (
                  <StyleListItem
                    key={style.id}
                    style={style}
                    isSelected={selectedStyleId === style.id}
                    onClick={() => { setSelectedStyleId(style.id); setEditingStyle(null); setIsCreating(false); }}
                    onEdit={() => handleEdit(style)}
                    onDuplicate={() => handleDuplicate(style.id)}
                    onDelete={() => {}}
                    canDelete={false}
                  />
                ))}
              </>
            )}
            {customStyles.length > 0 && (
              <>
                <div className="text-[10px] uppercase tracking-wider text-cad-text-dim font-semibold px-1 mt-2">Custom</div>
                {customStyles.map(style => (
                  <StyleListItem
                    key={style.id}
                    style={style}
                    isSelected={selectedStyleId === style.id}
                    onClick={() => { setSelectedStyleId(style.id); setEditingStyle(null); setIsCreating(false); }}
                    onEdit={() => handleEdit(style)}
                    onDuplicate={() => handleDuplicate(style.id)}
                    onDelete={() => handleDelete(style.id)}
                  />
                ))}
              </>
            )}
          </div>
        </div>

        {/* Right panel - Style details / editor */}
        <div className="flex-1 overflow-y-auto">
          {editingStyle ? (
            <StyleEditor
              style={editingStyle}
              onChange={setEditingStyle}
              onSave={handleSave}
              onCancel={handleCancel}
              isCreating={isCreating}
            />
          ) : selectedStyle ? (
            <StyleDetails style={selectedStyle} onEdit={() => handleEdit(selectedStyle)} />
          ) : (
            <div className="flex items-center justify-center h-full text-xs text-cad-text-dim">
              Select a style or create a new one
            </div>
          )}
        </div>
      </div>
    </DraggableModal>
  );
}

// --- Sub-components ---

function StyleListItem({
  style,
  isSelected,
  onClick,
  onEdit,
  onDuplicate,
  onDelete,
  canDelete = true,
}: {
  style: TextStyle;
  isSelected: boolean;
  onClick: () => void;
  onEdit: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  canDelete?: boolean;
}) {
  return (
    <div
      onClick={onClick}
      className={`flex items-center gap-2 px-2 py-1.5 rounded cursor-pointer text-xs group ${
        isSelected ? 'bg-cad-accent/20 text-cad-accent' : 'text-cad-text hover:bg-cad-hover'
      }`}
    >
      <StylePreviewBadge style={style} />
      <span className="flex-1 truncate">{style.name}</span>
      <div className="hidden group-hover:flex items-center gap-0.5">
        <button onClick={(e) => { e.stopPropagation(); onEdit(); }} className="p-0.5 hover:text-cad-accent" title="Edit">
          <Edit className="w-3 h-3" />
        </button>
        <button onClick={(e) => { e.stopPropagation(); onDuplicate(); }} className="p-0.5 hover:text-cad-accent" title="Duplicate">
          <Copy className="w-3 h-3" />
        </button>
        {canDelete && (
          <button onClick={(e) => { e.stopPropagation(); onDelete(); }} className="p-0.5 hover:text-red-400" title="Delete">
            <Trash2 className="w-3 h-3" />
          </button>
        )}
      </div>
    </div>
  );
}

function StylePreviewBadge({ style }: { style: Partial<TextStyle> }) {
  return (
    <div
      className="flex items-center justify-center rounded border border-cad-border"
      style={{
        width: 28,
        height: 20,
        backgroundColor: '#1a1a2e',
        overflow: 'hidden',
      }}
    >
      <span
        style={{
          fontSize: 10,
          fontFamily: style.fontFamily || 'Osifont',
          fontWeight: style.bold ? 'bold' : 'normal',
          fontStyle: style.italic ? 'italic' : 'normal',
          textDecoration: [
            style.underline ? 'underline' : '',
            style.strikethrough ? 'line-through' : '',
          ].filter(Boolean).join(' ') || 'none',
          color: style.color || '#ffffff',
          lineHeight: 1,
        }}
      >
        Ab
      </span>
    </div>
  );
}

function StylePreview({ style }: { style: Partial<TextStyle> }) {
  const textTransform = style.textCase === 'uppercase' ? 'uppercase'
    : style.textCase === 'lowercase' ? 'lowercase'
    : style.textCase === 'capitalize' ? 'capitalize'
    : 'none';

  return (
    <div
      className="rounded border border-cad-border p-3"
      style={{
        backgroundColor: style.backgroundMask ? (style.backgroundColor || '#1a1a2e') : '#1a1a2e',
        minHeight: 60,
        display: 'flex',
        alignItems: 'center',
        justifyContent: style.alignment === 'center' ? 'center' : style.alignment === 'right' ? 'flex-end' : 'flex-start',
      }}
    >
      <span
        style={{
          fontFamily: style.fontFamily || 'Osifont',
          fontSize: Math.min(Math.max((style.fontSize || 2.5) * 4, 12), 36),
          fontWeight: style.bold ? 'bold' : 'normal',
          fontStyle: style.italic ? 'italic' : 'normal',
          textDecoration: [
            style.underline ? 'underline' : '',
            style.strikethrough ? 'line-through' : '',
          ].filter(Boolean).join(' ') || 'none',
          color: style.color || '#ffffff',
          letterSpacing: style.letterSpacing ? `${(style.letterSpacing - 1) * 0.5}em` : undefined,
          transform: style.obliqueAngle ? `skewX(${-style.obliqueAngle}deg)` : undefined,
          textAlign: style.alignment || 'left',
          textTransform,
          lineHeight: style.lineHeight || 1.4,
        }}
      >
        Sample Text AaBbCc 123
      </span>
    </div>
  );
}

function StyleDetails({ style, onEdit }: { style: TextStyle; onEdit: () => void }) {
  return (
    <div className="space-y-3 p-2">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-cad-text">{style.name}</h3>
        <button
          onClick={onEdit}
          className="flex items-center gap-1 px-2 py-1 text-xs bg-cad-hover text-cad-text rounded hover:bg-cad-accent/20"
        >
          <Edit className="w-3 h-3" /> Edit
        </button>
      </div>

      <StylePreview style={style} />

      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-cad-text-dim">
        <div>Font: <span className="text-cad-text">{style.fontFamily}</span></div>
        <div>Size: <span className="text-cad-text">{style.fontSize}</span></div>
        <div>Color: <span className="text-cad-text">{style.color}</span></div>
        <div>Bold: <span className="text-cad-text">{style.bold ? 'Yes' : 'No'}</span></div>
        <div>Italic: <span className="text-cad-text">{style.italic ? 'Yes' : 'No'}</span></div>
        <div>Underline: <span className="text-cad-text">{style.underline ? 'Yes' : 'No'}</span></div>
        {style.strikethrough && <div>Strikethrough: <span className="text-cad-text">Yes</span></div>}
        <div>Alignment: <span className="text-cad-text">{style.alignment}</span></div>
        <div>Line Height: <span className="text-cad-text">{style.lineHeight}</span></div>
        <div>Model Text: <span className="text-cad-text">{style.isModelText ? 'Yes' : 'No'}</span></div>
        <div>Background Mask: <span className="text-cad-text">{style.backgroundMask ? 'Yes' : 'No'}</span></div>
        {style.letterSpacing && <div>Letter Spacing: <span className="text-cad-text">{style.letterSpacing}</span></div>}
        {style.widthFactor && <div>Width Factor: <span className="text-cad-text">{style.widthFactor}</span></div>}
        {style.obliqueAngle && <div>Oblique Angle: <span className="text-cad-text">{style.obliqueAngle}&deg;</span></div>}
        {style.textCase && style.textCase !== 'none' && <div>Text Case: <span className="text-cad-text">{style.textCase}</span></div>}
        {style.paragraphSpacing && <div>Paragraph Spacing: <span className="text-cad-text">{style.paragraphSpacing}</span></div>}
      </div>

      <div className="text-[10px] text-cad-text-dim">{style.isBuiltIn ? 'Default style (cannot be deleted)' : 'Custom'}</div>
    </div>
  );
}

function StyleEditor({
  style,
  onChange,
  onSave,
  onCancel,
  isCreating,
}: {
  style: Partial<TextStyle>;
  onChange: (t: Partial<TextStyle>) => void;
  onSave: () => void;
  onCancel: () => void;
  isCreating: boolean;
}) {
  return (
    <div className="space-y-3 p-2">
      <h3 className="text-sm font-semibold text-cad-text">
        {isCreating ? 'Create New Text Style' : 'Edit Text Style'}
      </h3>

      {/* Preview */}
      <StylePreview style={style} />

      {/* Name */}
      <div>
        <label className={labelClass}>Name</label>
        <input
          type="text"
          value={style.name || ''}
          onChange={(e) => onChange({ ...style, name: e.target.value })}
          className={inputClass}
        />
      </div>

      {/* Font Group */}
      <div>
        <div className="text-[10px] uppercase tracking-wider text-cad-text-dim font-semibold mb-1">Font</div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className={labelClass}>Family</label>
            <select
              value={style.fontFamily || 'Osifont'}
              onChange={(e) => onChange({ ...style, fontFamily: e.target.value })}
              className={inputClass}
            >
              <option value="Osifont">Osifont</option>
              <option value="Arial">Arial</option>
              <option value="Times New Roman">Times New Roman</option>
              <option value="Courier New">Courier New</option>
              <option value="Verdana">Verdana</option>
              <option value="Georgia">Georgia</option>
            </select>
          </div>
          <div>
            <label className={labelClass}>Size</label>
            <input
              type="number"
              step={0.5}
              min={0.5}
              value={style.fontSize ?? 2.5}
              onChange={(e) => onChange({ ...style, fontSize: parseFloat(e.target.value) || 2.5 })}
              className={inputClass}
            />
          </div>
        </div>
        <div className="mt-1">
          <label className={labelClass}>Color</label>
          <input
            type="color"
            value={style.color || '#ffffff'}
            onChange={(e) => onChange({ ...style, color: e.target.value })}
            className="w-8 h-6 border border-cad-border rounded cursor-pointer"
          />
        </div>
      </div>

      {/* Format Group */}
      <div>
        <div className="text-[10px] uppercase tracking-wider text-cad-text-dim font-semibold mb-1">Format</div>
        <div className="flex flex-wrap gap-3">
          <label className="flex items-center gap-1.5 text-xs text-cad-text cursor-pointer">
            <input type="checkbox" checked={style.bold ?? false}
              onChange={(e) => onChange({ ...style, bold: e.target.checked })} className="rounded" />
            Bold
          </label>
          <label className="flex items-center gap-1.5 text-xs text-cad-text cursor-pointer">
            <input type="checkbox" checked={style.italic ?? false}
              onChange={(e) => onChange({ ...style, italic: e.target.checked })} className="rounded" />
            Italic
          </label>
          <label className="flex items-center gap-1.5 text-xs text-cad-text cursor-pointer">
            <input type="checkbox" checked={style.underline ?? false}
              onChange={(e) => onChange({ ...style, underline: e.target.checked })} className="rounded" />
            Underline
          </label>
          <label className="flex items-center gap-1.5 text-xs text-cad-text cursor-pointer">
            <input type="checkbox" checked={style.strikethrough ?? false}
              onChange={(e) => onChange({ ...style, strikethrough: e.target.checked })} className="rounded" />
            Strikethrough
          </label>
        </div>
      </div>

      {/* Layout Group */}
      <div>
        <div className="text-[10px] uppercase tracking-wider text-cad-text-dim font-semibold mb-1">Layout</div>
        <div className="grid grid-cols-3 gap-2">
          <div>
            <label className={labelClass}>Alignment</label>
            <select
              value={style.alignment || 'left'}
              onChange={(e) => onChange({ ...style, alignment: e.target.value as TextAlignment })}
              className={inputClass}
            >
              <option value="left">Left</option>
              <option value="center">Center</option>
              <option value="right">Right</option>
            </select>
          </div>
          <div>
            <label className={labelClass}>Vertical</label>
            <select
              value={style.verticalAlignment || 'top'}
              onChange={(e) => onChange({ ...style, verticalAlignment: e.target.value as TextVerticalAlignment })}
              className={inputClass}
            >
              <option value="top">Top</option>
              <option value="middle">Middle</option>
              <option value="bottom">Bottom</option>
            </select>
          </div>
          <div>
            <label className={labelClass}>Line Height</label>
            <input
              type="number"
              step={0.1}
              min={0.5}
              max={5}
              value={style.lineHeight ?? 1.4}
              onChange={(e) => onChange({ ...style, lineHeight: parseFloat(e.target.value) || 1.4 })}
              className={inputClass}
            />
          </div>
        </div>
      </div>

      {/* Advanced Group */}
      <div>
        <div className="text-[10px] uppercase tracking-wider text-cad-text-dim font-semibold mb-1">Advanced</div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className={labelClass}>Text Case</label>
            <select
              value={style.textCase || 'none'}
              onChange={(e) => onChange({ ...style, textCase: e.target.value as TextCase })}
              className={inputClass}
            >
              <option value="none">None</option>
              <option value="uppercase">UPPERCASE</option>
              <option value="lowercase">lowercase</option>
              <option value="capitalize">Capitalize</option>
            </select>
          </div>
          <div>
            <label className={labelClass}>Letter Spacing</label>
            <input
              type="number"
              step={0.1}
              min={0.1}
              value={style.letterSpacing ?? 1}
              onChange={(e) => {
                const v = parseFloat(e.target.value);
                onChange({ ...style, letterSpacing: v && v !== 1 ? v : undefined });
              }}
              className={inputClass}
            />
          </div>
          <div>
            <label className={labelClass}>Width Factor</label>
            <input
              type="number"
              step={0.1}
              min={0.1}
              value={style.widthFactor ?? 1}
              onChange={(e) => {
                const v = parseFloat(e.target.value);
                onChange({ ...style, widthFactor: v && v !== 1 ? v : undefined });
              }}
              className={inputClass}
            />
          </div>
          <div>
            <label className={labelClass}>Oblique Angle (&deg;)</label>
            <input
              type="number"
              step={1}
              min={-45}
              max={45}
              value={style.obliqueAngle ?? 0}
              onChange={(e) => {
                const v = parseFloat(e.target.value);
                onChange({ ...style, obliqueAngle: v && v !== 0 ? v : undefined });
              }}
              className={inputClass}
            />
          </div>
          <div>
            <label className={labelClass}>Paragraph Spacing</label>
            <input
              type="number"
              step={0.1}
              min={0}
              value={style.paragraphSpacing ?? 1}
              onChange={(e) => {
                const v = parseFloat(e.target.value);
                onChange({ ...style, paragraphSpacing: v && v !== 1 ? v : undefined });
              }}
              className={inputClass}
            />
          </div>
        </div>
      </div>

      {/* Behavior Group */}
      <div>
        <div className="text-[10px] uppercase tracking-wider text-cad-text-dim font-semibold mb-1">Behavior</div>
        <label className="flex items-center gap-2 text-xs text-cad-text cursor-pointer">
          <input type="checkbox" checked={style.isModelText ?? false}
            onChange={(e) => onChange({ ...style, isModelText: e.target.checked })} className="rounded" />
          Model Text (scales with geometry)
        </label>
      </div>

      {/* Background Group */}
      <div>
        <div className="text-[10px] uppercase tracking-wider text-cad-text-dim font-semibold mb-1">Background</div>
        <label className="flex items-center gap-2 text-xs text-cad-text cursor-pointer mb-2">
          <input type="checkbox" checked={style.backgroundMask ?? false}
            onChange={(e) => onChange({ ...style, backgroundMask: e.target.checked })} className="rounded" />
          Background Mask
        </label>
        {style.backgroundMask && (
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className={labelClass}>Background Color</label>
              <input
                type="color"
                value={style.backgroundColor || '#1a1a2e'}
                onChange={(e) => onChange({ ...style, backgroundColor: e.target.value })}
                className="w-8 h-6 border border-cad-border rounded cursor-pointer"
              />
            </div>
            <div>
              <label className={labelClass}>Padding</label>
              <input
                type="number"
                step={0.5}
                min={0}
                value={style.backgroundPadding ?? 0.5}
                onChange={(e) => onChange({ ...style, backgroundPadding: parseFloat(e.target.value) || 0.5 })}
                className={inputClass}
              />
            </div>
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="flex gap-2 pt-2 border-t border-cad-border">
        <button onClick={onSave} className="px-3 py-1 text-xs bg-cad-accent text-black rounded hover:brightness-110">
          {isCreating ? 'Create' : 'Save'}
        </button>
        <button onClick={onCancel} className="px-3 py-1 text-xs bg-cad-hover text-cad-text rounded hover:bg-cad-border">
          Cancel
        </button>
      </div>
    </div>
  );
}
