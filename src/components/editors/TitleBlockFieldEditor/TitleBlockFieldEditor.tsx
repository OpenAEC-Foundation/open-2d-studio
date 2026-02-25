/**
 * TitleBlockFieldEditor - Inline input overlay for editing title block fields
 *
 * Uses a contentEditable span (not <input>) to avoid browser-imposed white
 * background on form elements. Absolutely positioned over the canvas,
 * pre-filled with the current field value.
 *
 * Enter → save, Escape → cancel, blur → save
 */

import { useRef, useEffect, useState, useCallback } from 'react';
import type { TitleBlockFieldRect } from '../../../engine/renderer/sheet/titleBlockHitTest';

interface TitleBlockFieldEditorProps {
  /** Screen-space X position */
  x: number;
  /** Screen-space Y position */
  y: number;
  /** Screen-space width */
  width: number;
  /** Screen-space height */
  height: number;
  /** The field rect with metadata */
  fieldRect: TitleBlockFieldRect;
  /** Current viewport zoom for font scaling */
  zoom: number;
  /** Save the new value */
  onSave: (value: string) => void;
  /** Cancel editing */
  onCancel: () => void;
}

export function TitleBlockFieldEditor({
  x,
  y,
  width,
  height,
  fieldRect,
  zoom,
  onSave,
  onCancel,
}: TitleBlockFieldEditorProps) {
  const spanRef = useRef<HTMLSpanElement>(null);
  const [committed, setCommitted] = useState(false);

  // Focus and select all text on mount
  useEffect(() => {
    const el = spanRef.current;
    if (el) {
      el.focus();
      // Select all text
      const range = document.createRange();
      range.selectNodeContents(el);
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);
    }
  }, []);

  // Dismiss on wheel zoom
  useEffect(() => {
    const handleWheel = () => {
      if (!committed) {
        setCommitted(true);
        onSave(spanRef.current?.textContent || '');
      }
    };
    window.addEventListener('wheel', handleWheel, { once: true, passive: true });
    return () => window.removeEventListener('wheel', handleWheel);
  }, [onSave, committed]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      e.stopPropagation();

      if (e.key === 'Escape') {
        e.preventDefault();
        setCommitted(true);
        onCancel();
      } else if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        setCommitted(true);
        onSave(spanRef.current?.textContent || '');
      }
    },
    [onSave, onCancel]
  );

  const handleBlur = useCallback(() => {
    if (!committed) {
      setCommitted(true);
      onSave(spanRef.current?.textContent || '');
    }
  }, [onSave, committed]);

  // Scale font size with zoom
  const fontSize = Math.max(8, fieldRect.fontSize * zoom);

  // Canvas draws text with textBaseline:'top' (flush at Y), but the span
  // may have slight vertical centering. Compensate to prevent text shift.
  const verticalOffset = (height - fontSize) / 2;

  return (
    <span
      ref={spanRef}
      contentEditable
      suppressContentEditableWarning
      onKeyDown={handleKeyDown}
      onBlur={handleBlur}
      style={{
        position: 'absolute',
        left: `${x}px`,
        top: `${y - verticalOffset}px`,
        width: `${width}px`,
        height: `${height}px`,
        zIndex: 1000,
        font: `${fieldRect.isBold ? 'bold ' : ''}${fontSize}px/${height}px ${fieldRect.fontFamily}`,
        color: '#000000',
        background: 'transparent',
        border: 'none',
        outline: 'none',
        padding: 0,
        margin: 0,
        textAlign: fieldRect.align,
        boxSizing: 'border-box',
        display: 'inline-block',
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        caretColor: '#000000',
      }}
    >
      {fieldRect.value}
    </span>
  );
}
