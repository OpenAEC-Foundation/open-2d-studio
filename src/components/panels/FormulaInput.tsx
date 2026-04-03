/**
 * FormulaInput — inline formula editor for parametric parameters.
 *
 * Supports two modes:
 *  - Value mode:   plain numeric/text input
 *  - Formula mode: formula string that starts with '='
 *
 * Type '=' as the first character to switch to formula mode.
 * Click the link icon to toggle formula mode manually.
 */

import React, { useState, useRef, useEffect } from 'react';

// ── Props ─────────────────────────────────────────────────────────────────────

export interface FormulaInputProps {
  /** Current resolved/display value */
  value: number | boolean | string;
  /** Current formula string (if any) */
  formula?: string;
  /** Whether the field is read-only */
  isReadOnly?: boolean;
  /** Whether the formula/value has an error */
  hasError?: boolean;
  /** Error message to display as tooltip */
  errorMessage?: string;
  /** Unit label shown to the right of the input */
  unit?: string;
  /** Called when the user commits a plain value */
  onChange: (value: number | boolean | string) => void;
  /** Called when the user commits a formula string */
  onFormulaChange: (formula: string) => void;
  /** Called when the user clears the formula (reverts to plain value) */
  onFormulaClear: (lastValue: number | boolean | string) => void;
}

// ── Component ─────────────────────────────────────────────────────────────────

export const FormulaInput: React.FC<FormulaInputProps> = ({
  value,
  formula,
  isReadOnly = false,
  hasError = false,
  errorMessage,
  unit,
  onChange,
  onFormulaChange,
  onFormulaClear,
}) => {
  const isFormulaMode = Boolean(formula);
  const [editing, setEditing] = useState(false);
  const [draftText, setDraftText] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  // When editing starts, populate with formula or current value
  const handleFocus = () => {
    if (isReadOnly) return;
    setEditing(true);
    setDraftText(isFormulaMode ? `=${formula}` : String(value));
  };

  const commit = () => {
    setEditing(false);
    const text = draftText.trim();

    if (text.startsWith('=')) {
      const expr = text.slice(1).trim();
      if (expr.length > 0) {
        onFormulaChange(expr);
      }
    } else {
      // Try to parse as number; fall back to string
      const num = parseFloat(text);
      const resolved: number | string = isNaN(num) ? text : num;
      if (isFormulaMode) {
        onFormulaClear(resolved);
      } else {
        onChange(resolved);
      }
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      commit();
      inputRef.current?.blur();
    }
    if (e.key === 'Escape') {
      setEditing(false);
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setDraftText(e.target.value);
  };

  // Toggle formula mode via the link icon
  const toggleFormulaMode = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isReadOnly) return;
    if (isFormulaMode) {
      onFormulaClear(value);
    } else {
      setEditing(true);
      setDraftText('=');
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  };

  // Focus input when editing flag is set programmatically
  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);

  // ── Border colour logic ──────────────────────────────────────────────────
  let borderColor = '#374151'; // default gray
  if (isReadOnly) borderColor = '#1f2937';
  else if (hasError) borderColor = '#ef4444';
  else if (isFormulaMode) borderColor = '#22c55e';

  const containerStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    background: isReadOnly ? '#0f172a' : '#1f2937',
    border: `1px solid ${borderColor}`,
    borderRadius: 4,
    overflow: 'hidden',
    minWidth: 0,
    flex: 1,
  };

  const inputStyle: React.CSSProperties = {
    flex: 1,
    background: 'transparent',
    border: 'none',
    outline: 'none',
    color: isReadOnly ? '#6b7280' : isFormulaMode ? '#86efac' : '#e5e7eb',
    fontSize: 12,
    padding: '3px 6px',
    fontFamily: isFormulaMode ? 'monospace' : 'inherit',
    cursor: isReadOnly ? 'not-allowed' : 'text',
  };

  const unitStyle: React.CSSProperties = {
    padding: '0 6px',
    color: '#6b7280',
    fontSize: 11,
    borderLeft: '1px solid #374151',
    whiteSpace: 'nowrap',
    userSelect: 'none',
  };

  const iconStyle: React.CSSProperties = {
    padding: '0 5px',
    cursor: isReadOnly ? 'not-allowed' : 'pointer',
    color: isFormulaMode ? '#22c55e' : '#4b5563',
    fontSize: 11,
    userSelect: 'none',
    flexShrink: 0,
  };

  const displayValue = editing
    ? draftText
    : isFormulaMode
      ? `=${formula}`
      : String(value);

  return (
    <div
      style={{ display: 'flex', alignItems: 'center', gap: 4, flex: 1, minWidth: 0 }}
      title={hasError ? errorMessage : undefined}
    >
      <div style={containerStyle}>
        <input
          ref={inputRef}
          style={inputStyle}
          value={displayValue}
          readOnly={isReadOnly}
          onFocus={handleFocus}
          onChange={handleChange}
          onBlur={commit}
          onKeyDown={handleKeyDown}
        />
        {unit && <span style={unitStyle}>{unit}</span>}
      </div>
      {/* Formula toggle icon (fx link) */}
      <span
        style={iconStyle}
        onClick={toggleFormulaMode}
        title={isFormulaMode ? 'Clear formula' : 'Enter formula mode'}
      >
        {isFormulaMode ? 'fx' : 'f'}
      </span>
      {/* Error indicator */}
      {hasError && (
        <span style={{ color: '#ef4444', fontSize: 11, flexShrink: 0 }} title={errorMessage}>
          ⚠
        </span>
      )}
    </div>
  );
};

export default FormulaInput;
