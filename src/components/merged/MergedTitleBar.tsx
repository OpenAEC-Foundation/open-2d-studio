import { Minus, Square, X } from 'lucide-react';

/**
 * Stripped visual-only titlebar for Slice 1 of the merge.
 * No Zustand, no Tauri APIs — pure presentation.
 * Buttons are static; clicks are no-op.
 */
export function MergedTitleBar() {
  return (
    <div className="merged-titlebar">
      <div className="merged-titlebar__left">
        <div className="merged-titlebar__icon" />
        <span className="merged-titlebar__title">Open 2D Studio — merged</span>
      </div>
      <div className="merged-titlebar__center" />
      <div className="merged-titlebar__controls">
        <button type="button" className="merged-titlebar__ctrl" disabled>
          <Minus size={14} />
        </button>
        <button type="button" className="merged-titlebar__ctrl" disabled>
          <Square size={12} />
        </button>
        <button type="button" className="merged-titlebar__ctrl merged-titlebar__ctrl--close" disabled>
          <X size={14} />
        </button>
      </div>
    </div>
  );
}
