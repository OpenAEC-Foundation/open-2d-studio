/**
 * ParameterPanel — displays a shape's parameters grouped by their group field.
 *
 * Each row shows:
 *  - Parameter name label
 *  - FormulaInput (value or formula mode)
 *
 * An optional "+ Parameter toevoegen" button is shown at the bottom when
 * onAddParameter is provided.
 */

import React from 'react';
import type { Parameter, ConstraintError } from '../../types/constraints';
import { FormulaInput } from './FormulaInput';

// ── Props ─────────────────────────────────────────────────────────────────────

export interface ParameterPanelProps {
  parameters: Parameter[];
  errors: Map<string, ConstraintError>;
  onValueChange: (paramId: string, value: number | boolean | string) => void;
  onFormulaChange: (paramId: string, formula: string) => void;
  onFormulaClear: (paramId: string, value: number | boolean | string) => void;
  onAddParameter?: () => void;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function groupParameters(params: Parameter[]): Map<string, Parameter[]> {
  const groups = new Map<string, Parameter[]>();
  for (const param of params) {
    const key = param.group ?? 'General';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(param);
  }
  return groups;
}

// ── Styles (dark theme) ───────────────────────────────────────────────────────

const panelStyle: React.CSSProperties = {
  background: '#111827',
  color: '#e5e7eb',
  fontSize: 12,
  padding: '8px 0',
  display: 'flex',
  flexDirection: 'column',
  gap: 0,
};

const groupHeaderStyle: React.CSSProperties = {
  color: '#9ca3af',
  fontSize: 11,
  fontWeight: 600,
  padding: '6px 12px 2px',
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
  borderBottom: '1px solid #1f2937',
  marginBottom: 2,
};

const rowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  padding: '3px 12px',
  gap: 8,
};

const labelStyle: React.CSSProperties = {
  color: '#d1d5db',
  fontSize: 12,
  minWidth: 110,
  maxWidth: 110,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  flexShrink: 0,
};

const addButtonStyle: React.CSSProperties = {
  background: 'transparent',
  border: '1px dashed #374151',
  borderRadius: 4,
  color: '#6b7280',
  fontSize: 12,
  cursor: 'pointer',
  padding: '5px 12px',
  margin: '8px 12px 4px',
  textAlign: 'left',
  width: 'calc(100% - 24px)',
  transition: 'border-color 0.15s, color 0.15s',
};

// ── Component ─────────────────────────────────────────────────────────────────

export const ParameterPanel: React.FC<ParameterPanelProps> = ({
  parameters,
  errors,
  onValueChange,
  onFormulaChange,
  onFormulaClear,
  onAddParameter,
}) => {
  const groups = groupParameters(parameters);

  return (
    <div style={panelStyle}>
      {Array.from(groups.entries()).map(([groupName, params]) => (
        <div key={groupName}>
          <div style={groupHeaderStyle}>{groupName}</div>
          {params.map((param) => {
            const error = errors.get(param.id);
            return (
              <div key={param.id} style={rowStyle}>
                <span style={labelStyle} title={param.name}>
                  {param.name}
                </span>
                <FormulaInput
                  value={param.value}
                  formula={param.formula}
                  isReadOnly={param.isReadOnly}
                  hasError={Boolean(error)}
                  errorMessage={error?.message}
                  unit={param.unit !== 'none' ? param.unit : undefined}
                  onChange={(v) => onValueChange(param.id, v)}
                  onFormulaChange={(f) => onFormulaChange(param.id, f)}
                  onFormulaClear={(v) => onFormulaClear(param.id, v)}
                />
              </div>
            );
          })}
        </div>
      ))}

      {onAddParameter && (
        <button
          style={addButtonStyle}
          onClick={onAddParameter}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLButtonElement).style.borderColor = '#6b7280';
            (e.currentTarget as HTMLButtonElement).style.color = '#e5e7eb';
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLButtonElement).style.borderColor = '#374151';
            (e.currentTarget as HTMLButtonElement).style.color = '#6b7280';
          }}
        >
          + Parameter toevoegen
        </button>
      )}
    </div>
  );
};

export default ParameterPanel;
