/**
 * TextEditor - Inline text editing overlay component
 *
 * Provides an overlay textarea for editing text shapes directly on the canvas.
 * Matches the text shape's font styling and position.
 * Supports symbol insertion and DXF-style codes (%%d, %%c, %%p).
 */

import { useRef, useEffect, useState, useCallback } from 'react';
import { useAppStore } from '../../../state/appStore';
import { worldToScreen } from '../../../engine/geometry/GeometryUtils';
import type { TextShape } from '../../../types/geometry';
import { SymbolPalette, processTextCodes } from '../SymbolPalette/SymbolPalette';
import { CAD_DEFAULT_LINE_HEIGHT } from '../../../constants/cadDefaults';

interface TextEditorProps {
  shape: TextShape;
  onSave: (text: string) => void;
  onCancel: () => void;
}

export function TextEditor({ shape, onSave, onCancel }: TextEditorProps) {
  const { viewport, drawings, activeDrawingId, updateShape, whiteBackground } = useAppStore();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [text, setText] = useState(shape.text);
  const [showSymbolPalette, setShowSymbolPalette] = useState(false);

  // Local formatting state synced to shape
  const [bold, setBold] = useState(shape.bold);
  const [italic, setItalic] = useState(shape.italic);
  const [underline, setUnderline] = useState(shape.underline);
  const [strikethrough, setStrikethrough] = useState(shape.strikethrough ?? false);
  const [alignment, setAlignment] = useState(shape.alignment);

  const toggleBold = useCallback(() => {
    const next = !bold;
    setBold(next);
    updateShape(shape.id, { bold: next });
  }, [bold, shape.id, updateShape]);

  const toggleItalic = useCallback(() => {
    const next = !italic;
    setItalic(next);
    updateShape(shape.id, { italic: next });
  }, [italic, shape.id, updateShape]);

  const toggleUnderline = useCallback(() => {
    const next = !underline;
    setUnderline(next);
    updateShape(shape.id, { underline: next });
  }, [underline, shape.id, updateShape]);

  const toggleStrikethrough = useCallback(() => {
    const next = !strikethrough;
    setStrikethrough(next);
    updateShape(shape.id, { strikethrough: next });
  }, [strikethrough, shape.id, updateShape]);

  const setAlignmentValue = useCallback((value: 'left' | 'center' | 'right') => {
    setAlignment(value);
    updateShape(shape.id, { alignment: value });
  }, [shape.id, updateShape]);

  // Calculate screen position from world coordinates
  const screenPos = worldToScreen(shape.position.x, shape.position.y, viewport);

  // Focus on mount
  useEffect(() => {
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.focus();
      // Move cursor to end
      textarea.selectionStart = textarea.value.length;
      textarea.selectionEnd = textarea.value.length;
    }
  }, []);

  // Auto-resize textarea based on content
  useEffect(() => {
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = 'auto';
      textarea.style.height = `${textarea.scrollHeight}px`;
    }
  }, [text]);

  // Insert symbol at cursor position
  const insertSymbol = useCallback((symbol: string) => {
    const textarea = textareaRef.current;
    if (textarea) {
      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      const newText = text.substring(0, start) + symbol + text.substring(end);
      setText(newText);
      // Set cursor after inserted symbol
      setTimeout(() => {
        textarea.selectionStart = start + symbol.length;
        textarea.selectionEnd = start + symbol.length;
        textarea.focus();
      }, 0);
    }
  }, [text]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      if (showSymbolPalette) {
        setShowSymbolPalette(false);
      } else {
        onCancel();
      }
    } else if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      e.stopPropagation();
      if (text.trim()) {
        // Process DXF-style codes before saving
        onSave(processTextCodes(text));
      } else {
        onCancel();
      }
    } else if (e.key === 's' && e.ctrlKey && e.shiftKey) {
      // Ctrl+Shift+S opens symbol palette
      e.preventDefault();
      setShowSymbolPalette(true);
    }
    // Shift+Enter adds new line (default textarea behavior)
  }, [text, onSave, onCancel, showSymbolPalette]);

  const handleBlur = useCallback((e: React.FocusEvent) => {
    // Don't blur if clicking on symbol palette
    if (containerRef.current?.contains(e.relatedTarget as Node)) {
      return;
    }
    if (text.trim()) {
      onSave(processTextCodes(text));
    } else {
      onCancel();
    }
  }, [text, onSave, onCancel]);

  // Calculate font styles for textarea — match canvas rendering formula
  const drawingScale = drawings.find(d => d.id === activeDrawingId)?.scale || 0.02;
  const effectiveFontSize = shape.isModelText
    ? shape.fontSize
    : shape.fontSize / drawingScale;
  const fontSize = effectiveFontSize * viewport.zoom;
  const fontStyle = `${italic ? 'italic ' : ''}${bold ? 'bold ' : ''}`;

  return (
    <div
      ref={containerRef}
      style={{
        position: 'absolute',
        left: `${screenPos.x}px`,
        top: `${screenPos.y}px`,
        zIndex: 1000,
      }}
    >
      {/* Formatting toolbar */}
      <div
        style={{
          position: 'absolute',
          bottom: '100%',
          left: 0,
          marginBottom: '4px',
          display: 'flex',
          gap: '2px',
          backgroundColor: whiteBackground ? 'rgba(240, 240, 240, 0.97)' : 'rgba(30, 30, 30, 0.95)',
          padding: '3px 4px',
          borderRadius: '4px',
          border: whiteBackground ? '1px solid #ccc' : '1px solid #444',
          alignItems: 'center',
        }}
      >
        {/* Bold */}
        <button
          onClick={toggleBold}
          title="Bold"
          style={{
            padding: '2px 6px',
            fontSize: '12px',
            fontWeight: 'bold',
            backgroundColor: bold ? '#0066ff' : (whiteBackground ? '#e0e0e0' : '#333'),
            color: bold ? '#fff' : (whiteBackground ? '#222' : '#fff'),
            border: whiteBackground ? '1px solid #bbb' : '1px solid #555',
            borderRadius: '3px',
            cursor: 'pointer',
            minWidth: 24,
          }}
        >
          B
        </button>
        {/* Italic */}
        <button
          onClick={toggleItalic}
          title="Italic"
          style={{
            padding: '2px 6px',
            fontSize: '12px',
            fontStyle: 'italic',
            backgroundColor: italic ? '#0066ff' : (whiteBackground ? '#e0e0e0' : '#333'),
            color: italic ? '#fff' : (whiteBackground ? '#222' : '#fff'),
            border: whiteBackground ? '1px solid #bbb' : '1px solid #555',
            borderRadius: '3px',
            cursor: 'pointer',
            minWidth: 24,
          }}
        >
          I
        </button>
        {/* Underline */}
        <button
          onClick={toggleUnderline}
          title="Underline"
          style={{
            padding: '2px 6px',
            fontSize: '12px',
            textDecoration: 'underline',
            backgroundColor: underline ? '#0066ff' : (whiteBackground ? '#e0e0e0' : '#333'),
            color: underline ? '#fff' : (whiteBackground ? '#222' : '#fff'),
            border: whiteBackground ? '1px solid #bbb' : '1px solid #555',
            borderRadius: '3px',
            cursor: 'pointer',
            minWidth: 24,
          }}
        >
          U
        </button>
        {/* Strikethrough */}
        <button
          onClick={toggleStrikethrough}
          title="Strikethrough"
          style={{
            padding: '2px 6px',
            fontSize: '12px',
            textDecoration: 'line-through',
            backgroundColor: strikethrough ? '#0066ff' : (whiteBackground ? '#e0e0e0' : '#333'),
            color: strikethrough ? '#fff' : (whiteBackground ? '#222' : '#fff'),
            border: whiteBackground ? '1px solid #bbb' : '1px solid #555',
            borderRadius: '3px',
            cursor: 'pointer',
            minWidth: 24,
          }}
        >
          S
        </button>

        {/* Separator */}
        <div style={{ width: 1, height: 18, backgroundColor: whiteBackground ? '#bbb' : '#555', margin: '0 2px' }} />

        {/* Alignment buttons */}
        <button
          onClick={() => setAlignmentValue('left')}
          title="Align Left"
          style={{
            padding: '2px 5px',
            fontSize: '11px',
            backgroundColor: alignment === 'left' ? '#0066ff' : (whiteBackground ? '#e0e0e0' : '#333'),
            color: '#fff',
            border: whiteBackground ? '1px solid #bbb' : '1px solid #555',
            borderRadius: '3px',
            cursor: 'pointer',
            minWidth: 22,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'flex-start',
            gap: 1,
            lineHeight: 1,
          }}
        >
          <span style={{ display: 'block', width: 10, height: 1.5, backgroundColor: whiteBackground ? '#333' : '#fff' }} />
          <span style={{ display: 'block', width: 7, height: 1.5, backgroundColor: whiteBackground ? '#333' : '#fff' }} />
          <span style={{ display: 'block', width: 10, height: 1.5, backgroundColor: whiteBackground ? '#333' : '#fff' }} />
        </button>
        <button
          onClick={() => setAlignmentValue('center')}
          title="Align Center"
          style={{
            padding: '2px 5px',
            fontSize: '11px',
            backgroundColor: alignment === 'center' ? '#0066ff' : (whiteBackground ? '#e0e0e0' : '#333'),
            color: '#fff',
            border: whiteBackground ? '1px solid #bbb' : '1px solid #555',
            borderRadius: '3px',
            cursor: 'pointer',
            minWidth: 22,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 1,
            lineHeight: 1,
          }}
        >
          <span style={{ display: 'block', width: 10, height: 1.5, backgroundColor: whiteBackground ? '#333' : '#fff' }} />
          <span style={{ display: 'block', width: 7, height: 1.5, backgroundColor: whiteBackground ? '#333' : '#fff' }} />
          <span style={{ display: 'block', width: 10, height: 1.5, backgroundColor: whiteBackground ? '#333' : '#fff' }} />
        </button>
        <button
          onClick={() => setAlignmentValue('right')}
          title="Align Right"
          style={{
            padding: '2px 5px',
            fontSize: '11px',
            backgroundColor: alignment === 'right' ? '#0066ff' : (whiteBackground ? '#e0e0e0' : '#333'),
            color: '#fff',
            border: whiteBackground ? '1px solid #bbb' : '1px solid #555',
            borderRadius: '3px',
            cursor: 'pointer',
            minWidth: 22,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'flex-end',
            gap: 1,
            lineHeight: 1,
          }}
        >
          <span style={{ display: 'block', width: 10, height: 1.5, backgroundColor: whiteBackground ? '#333' : '#fff' }} />
          <span style={{ display: 'block', width: 7, height: 1.5, backgroundColor: whiteBackground ? '#333' : '#fff' }} />
          <span style={{ display: 'block', width: 10, height: 1.5, backgroundColor: whiteBackground ? '#333' : '#fff' }} />
        </button>

        {/* Separator */}
        <div style={{ width: 1, height: 18, backgroundColor: whiteBackground ? '#bbb' : '#555', margin: '0 2px' }} />

        {/* Symbol palette button */}
        <button
          onClick={() => setShowSymbolPalette(!showSymbolPalette)}
          title="Insert Symbol (Ctrl+Shift+S)"
          style={{
            padding: '2px 8px',
            fontSize: '14px',
            backgroundColor: showSymbolPalette ? '#0066ff' : (whiteBackground ? '#e0e0e0' : '#333'),
            color: showSymbolPalette ? '#fff' : (whiteBackground ? '#222' : '#fff'),
            border: whiteBackground ? '1px solid #bbb' : '1px solid #555',
            borderRadius: '3px',
            cursor: 'pointer',
          }}
        >
          &Omega;
        </button>
      </div>

      {/* Symbol palette popup */}
      {showSymbolPalette && (
        <div style={{ position: 'absolute', top: '-400px', left: 0 }}>
          <SymbolPalette
            onInsert={insertSymbol}
            onClose={() => setShowSymbolPalette(false)}
          />
        </div>
      )}

      {/* Text editor */}
      <textarea
        ref={textareaRef}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={handleBlur}
        style={{
          font: `${fontStyle}${fontSize}px ${shape.fontFamily}`,
          color: whiteBackground ? (shape.color === '#ffffff' ? '#000000' : shape.color || '#000000') : (shape.color || '#ffffff'),
          backgroundColor: whiteBackground ? 'rgba(255, 255, 255, 0.95)' : 'rgba(30, 30, 30, 0.9)',
          border: '1px solid #0066ff',
          outline: 'none',
          resize: 'none',
          overflow: 'hidden',
          minWidth: '50px',
          minHeight: `${fontSize + 4}px`,
          padding: '2px 4px',
          transform: shape.rotation ? `rotate(${shape.rotation}rad)` : undefined,
          transformOrigin: 'top left',
          lineHeight: shape.lineHeight || CAD_DEFAULT_LINE_HEIGHT,
          textAlign: alignment,
          textDecoration: [
            underline ? 'underline' : '',
            strikethrough ? 'line-through' : '',
          ].filter(Boolean).join(' ') || 'none',
          boxShadow: '0 2px 8px rgba(0, 0, 0, 0.5)',
        }}
        placeholder="Enter text..."
      />
    </div>
  );
}
