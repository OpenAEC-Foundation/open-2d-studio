/**
 * ComponentEditorOverlay — shown when the component editor mode is active.
 *
 * Renders a semi-transparent overlay over the canvas with a toolbar
 * indicating the component being edited and a close button.
 * Returns null when isActive is false.
 */

import React, { useEffect, useCallback } from 'react';
import { X } from 'lucide-react';

// ── Props ──────────────────────────────────────────────────────────────────────

export interface ComponentEditorOverlayProps {
  /** Whether the component editor is currently active */
  isActive: boolean;
  /** Name of the component being edited */
  componentName: string;
  /** Callback to close/exit the editor */
  onClose: () => void;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function ComponentEditorOverlay({
  isActive,
  componentName,
  onClose,
}: ComponentEditorOverlayProps): React.ReactElement | null {
  // ── ESC key to close ───────────────────────────────────────────────────────

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    },
    [onClose],
  );

  useEffect(() => {
    if (!isActive) return;
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isActive, handleKeyDown]);

  // ── Early return ──────────────────────────────────────────────────────────

  if (!isActive) return null;

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <>
      {/* Semi-transparent overlay covering the canvas */}
      <div
        className="fixed inset-0 pointer-events-none z-30"
        style={{ background: 'rgba(0, 0, 0, 0.5)' }}
        aria-hidden="true"
      />

      {/* Top-center toolbar */}
      <div
        className="fixed top-4 left-1/2 z-40 flex items-center gap-3 px-4 py-2 rounded-lg shadow-xl"
        style={{
          transform: 'translateX(-50%)',
          background: '#1f2937',
          border: '1px solid #374151',
          color: '#e5e7eb',
          pointerEvents: 'auto',
        }}
        role="toolbar"
        aria-label="Component editor toolbar"
      >
        {/* Editing indicator */}
        <div className="flex items-center gap-2">
          <span
            className="w-2 h-2 rounded-full flex-shrink-0"
            style={{ background: '#10b981' }}
            aria-hidden="true"
          />
          <span className="text-sm font-medium" style={{ color: '#e5e7eb' }}>
            Editing:&nbsp;
            <span style={{ color: '#60a5fa' }}>{componentName}</span>
          </span>
        </div>

        {/* Divider */}
        <div
          className="w-px self-stretch"
          style={{ background: '#374151' }}
          aria-hidden="true"
        />

        {/* ESC hint */}
        <span className="text-xs" style={{ color: '#9ca3af' }}>
          ESC to close
        </span>

        {/* Divider */}
        <div
          className="w-px self-stretch"
          style={{ background: '#374151' }}
          aria-hidden="true"
        />

        {/* Close button */}
        <button
          onClick={onClose}
          className="flex items-center gap-1 px-2 py-1 rounded text-xs font-medium transition-colors"
          style={{ background: '#dc2626', color: '#fff' }}
          onMouseEnter={(e) =>
            ((e.currentTarget as HTMLButtonElement).style.background = '#ef4444')
          }
          onMouseLeave={(e) =>
            ((e.currentTarget as HTMLButtonElement).style.background = '#dc2626')
          }
          aria-label="Close component editor"
          title="Close editor (ESC)"
        >
          <X size={12} aria-hidden="true" />
          Close Editor
        </button>
      </div>
    </>
  );
}
