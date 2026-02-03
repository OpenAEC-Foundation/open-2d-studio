import { useState, useEffect, useCallback } from 'react';
import { useFileOperations } from '../../hooks/file/useFileOperations';

export type BackstageView = 'none' | 'import' | 'export' | 'shortcuts' | 'feedback' | 'about';

interface BackstageProps {
  isOpen: boolean;
  onClose: () => void;
  initialView?: BackstageView;
  /** Callback to open the Sheet Template Import dialog (rendered in App.tsx) */
  onOpenSheetTemplateImport?: () => void;
}

interface BackstageItemProps {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  onMouseEnter?: () => void;
  active?: boolean;
  shortcut?: string;
}

function BackstageItem({ icon, label, onClick, onMouseEnter, active, shortcut }: BackstageItemProps) {
  return (
    <button
      className={`w-full flex items-center gap-3 px-6 py-3 text-left text-sm text-[#e2e8f0] hover:bg-[#334155] transition-colors cursor-default ${active ? 'bg-[#334155]' : ''}`}
      onClick={onClick}
      onMouseEnter={onMouseEnter}
    >
      <span className="w-5 h-5 flex items-center justify-center opacity-80">{icon}</span>
      <span className="flex-1">{label}</span>
      {shortcut && <span className="text-[10px] text-[#64748b] font-mono">{shortcut}</span>}
    </button>
  );
}

type FeedbackCategory = 'bug' | 'feature' | 'general';

function FeedbackPanel() {
  const [category, setCategory] = useState<FeedbackCategory>('general');
  const [message, setMessage] = useState('');
  const [rating, setRating] = useState<number | null>(null);
  const [submitted, setSubmitted] = useState(false);

  const handleSubmit = () => {
    setSubmitted(true);
  };

  if (submitted) {
    return (
      <div className="p-8">
        <h2 className="text-lg font-semibold text-[#e2e8f0] mb-6">Send Feedback</h2>
        <p className="text-sm text-[#94a3b8]">Thank you for your feedback!</p>
      </div>
    );
  }

  const categories: { value: FeedbackCategory; label: string }[] = [
    { value: 'bug', label: 'Bug' },
    { value: 'feature', label: 'Feature Request' },
    { value: 'general', label: 'General' },
  ];

  const emojis = [
    { value: 1, label: '\u{1F61E}' },
    { value: 2, label: '\u{1F610}' },
    { value: 3, label: '\u{1F60A}' },
  ];

  return (
    <div className="p-8">
      <h2 className="text-lg font-semibold text-[#e2e8f0] mb-6">Send Feedback</h2>
      <div className="max-w-md flex flex-col gap-4">
        {/* Category toggles */}
        <div className="flex gap-2">
          {categories.map(c => (
            <button
              key={c.value}
              className={`px-4 py-1.5 text-xs font-medium rounded transition-colors cursor-default ${
                category === c.value
                  ? 'bg-[#a82d6e] text-white'
                  : 'bg-[#1e293b] border border-[#334155] text-[#94a3b8] hover:bg-[#253349]'
              }`}
              onClick={() => setCategory(c.value)}
            >
              {c.label}
            </button>
          ))}
        </div>

        {/* Message */}
        <textarea
          className="w-full bg-[#1e293b] border border-[#334155] text-[#e2e8f0] text-sm rounded px-3 py-2 resize-none focus:outline-none focus:border-[#475569]"
          rows={4}
          placeholder="Describe your feedback..."
          value={message}
          onChange={e => setMessage(e.target.value)}
        />

        {/* Emoji rating */}
        <div className="flex items-center gap-1">
          <span className="text-xs text-[#64748b] mr-2">How do you feel?</span>
          {emojis.map(e => (
            <button
              key={e.value}
              className={`text-xl px-1 cursor-default rounded transition-colors ${
                rating === e.value ? 'bg-[#334155]' : 'hover:bg-[#253349]'
              }`}
              onClick={() => setRating(rating === e.value ? null : e.value)}
            >
              {e.label}
            </button>
          ))}
        </div>

        {/* Submit */}
        <button
          className="self-start px-5 py-1.5 text-sm font-medium text-white rounded transition-colors cursor-default bg-[#a82d6e] hover:bg-[#c2387f] disabled:opacity-50 disabled:cursor-default"
          disabled={!message.trim()}
          onClick={handleSubmit}
        >
          Submit
        </button>
      </div>
    </div>
  );
}

export function Backstage({ isOpen, onClose, initialView, onOpenSheetTemplateImport }: BackstageProps) {
  const { handleNew, handleOpen, handleSave, handleSaveAs, handleExportSVG, handleExportDXF, handleExportIFC, handleExportJSON, handleImportDXF, handlePrint, handleExit } = useFileOperations();
  const [activeView, setActiveView] = useState<BackstageView>('none');

  const handleEscape = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') onClose();
  }, [onClose]);

  useEffect(() => {
    if (isOpen) {
      setActiveView(initialView ?? 'none');
      document.addEventListener('keydown', handleEscape);
      return () => document.removeEventListener('keydown', handleEscape);
    }
  }, [isOpen, handleEscape, initialView]);

  if (!isOpen) return null;

  // Helper to close Backstage before executing an action.
  // IMPORTANT: Always use action() wrapper for Import/Export buttons
  // so the Backstage closes before the dialog appears.
  const action = (fn: () => void | Promise<void>) => async () => {
    onClose();
    await fn();
  };

  const clearView = () => setActiveView('none');

  return (
    <div className="fixed inset-0 z-50 flex" style={{ background: '#0f172a' }}>
      {/* Sidebar */}
      <div className="w-[250px] flex flex-col border-r border-[#334155]" style={{ background: '#1e293b' }}>
        {/* Back button + header */}
        <button
          className="flex items-center gap-3 px-5 py-4 text-white font-semibold text-base hover:bg-[#334155] transition-colors cursor-default"
          style={{ background: '#a82d6e' }}
          onClick={onClose}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="14" y1="8" x2="2" y2="8" />
            <polyline points="8,2 2,8 8,14" />
          </svg>
          File
        </button>

        <div className="flex flex-col py-2">
          <BackstageItem
            icon={<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="12" y1="18" x2="12" y2="12"/><line x1="9" y1="15" x2="15" y2="15"/></svg>}
            label="New"
            shortcut="Ctrl+N"
            onClick={action(handleNew)}
            onMouseEnter={clearView}
          />
          <BackstageItem
            icon={<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>}
            label="Open"
            shortcut="Ctrl+O"
            onClick={action(handleOpen)}
            onMouseEnter={clearView}
          />

          <div className="h-px bg-[#334155] my-1 mx-4" />

          <BackstageItem
            icon={<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>}
            label="Save"
            shortcut="Ctrl+S"
            onClick={action(handleSave)}
            onMouseEnter={clearView}
          />
          <BackstageItem
            icon={<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>}
            label="Save As"
            shortcut="Ctrl+Shift+S"
            onClick={action(handleSaveAs)}
            onMouseEnter={clearView}
          />

          <div className="h-px bg-[#334155] my-1 mx-4" />

          <BackstageItem
            icon={<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>}
            label="Import"
            onClick={() => setActiveView('import')}
            onMouseEnter={() => setActiveView('import')}
            active={activeView === 'import'}
          />
          <BackstageItem
            icon={<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>}
            label="Export"
            onClick={() => setActiveView('export')}
            onMouseEnter={() => setActiveView('export')}
            active={activeView === 'export'}
          />
          <BackstageItem
            icon={<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>}
            label="Print"
            shortcut="Ctrl+P"
            onClick={action(handlePrint)}
            onMouseEnter={clearView}
          />

          {/* Spacer */}
          <div className="flex-1" />

          <div className="h-px bg-[#334155] my-1 mx-4" />

          <BackstageItem
            icon={<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="M6 8h4"/><path d="M14 8h4"/><path d="M6 12h3"/><path d="M13 12h5"/><path d="M8 16h8"/></svg>}
            label="Keyboard Shortcuts"
            onClick={() => setActiveView('shortcuts')}
            onMouseEnter={() => setActiveView('shortcuts')}
            active={activeView === 'shortcuts'}
          />
          <BackstageItem
            icon={<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>}
            label="Send Feedback"
            onClick={() => setActiveView('feedback')}
            onMouseEnter={() => setActiveView('feedback')}
            active={activeView === 'feedback'}
          />
          <BackstageItem
            icon={<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>}
            label="About"
            onClick={() => setActiveView('about')}
            onMouseEnter={() => setActiveView('about')}
            active={activeView === 'about'}
          />
          <BackstageItem
            icon={<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>}
            label="Exit"
            shortcut="Alt+F4"
            onClick={handleExit}
            onMouseEnter={clearView}
          />
        </div>
      </div>

      {/* Right content area */}
      <div className="flex-1 flex flex-col">
        {activeView === 'import' && (
          <div className="p-8">
            <h2 className="text-lg font-semibold text-[#e2e8f0] mb-6">Import</h2>
            <div className="flex flex-col gap-2 max-w-md">
              <button
                className="flex items-center gap-4 px-5 py-4 rounded bg-[#1e293b] border border-[#334155] hover:border-[#475569] hover:bg-[#253349] transition-colors cursor-default text-left"
                onClick={action(handleImportDXF)}
              >
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="2">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                  <polyline points="14 2 14 8 20 8"/>
                </svg>
                <div>
                  <div className="text-sm font-medium text-[#e2e8f0]">DXF File</div>
                  <div className="text-xs text-[#64748b] mt-0.5">Import geometry from DXF format (.dxf)</div>
                </div>
              </button>
              <button
                className="flex items-center gap-4 px-5 py-4 rounded bg-[#1e293b] border border-[#334155] hover:border-[#475569] hover:bg-[#253349] transition-colors cursor-default text-left"
                onClick={action(() => onOpenSheetTemplateImport?.())}
              >
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="2">
                  <rect x="3" y="3" width="18" height="18" rx="2"/>
                  <line x1="3" y1="15" x2="21" y2="15"/>
                  <line x1="12" y1="15" x2="12" y2="21"/>
                </svg>
                <div>
                  <div className="text-sm font-medium text-[#e2e8f0]">Sheet Template</div>
                  <div className="text-xs text-[#64748b] mt-0.5">Import SVG-based sheet template (.svg)</div>
                </div>
              </button>
            </div>
          </div>
        )}
        {activeView === 'export' && (
          <div className="p-8">
            <h2 className="text-lg font-semibold text-[#e2e8f0] mb-6">Export</h2>
            <div className="flex flex-col gap-2 max-w-md">
              <button
                className="flex items-center gap-4 px-5 py-4 rounded bg-[#1e293b] border border-[#334155] hover:border-[#475569] hover:bg-[#253349] transition-colors cursor-default text-left"
                onClick={action(handleExportSVG)}
              >
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="2">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                  <polyline points="14 2 14 8 20 8"/>
                </svg>
                <div>
                  <div className="text-sm font-medium text-[#e2e8f0]">SVG</div>
                  <div className="text-xs text-[#64748b] mt-0.5">Scalable Vector Graphics (.svg)</div>
                </div>
              </button>
              <button
                className="flex items-center gap-4 px-5 py-4 rounded bg-[#1e293b] border border-[#334155] hover:border-[#475569] hover:bg-[#253349] transition-colors cursor-default text-left"
                onClick={action(handleExportDXF)}
              >
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="2">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                  <polyline points="14 2 14 8 20 8"/>
                </svg>
                <div>
                  <div className="text-sm font-medium text-[#e2e8f0]">DXF</div>
                  <div className="text-xs text-[#64748b] mt-0.5">Drawing Exchange Format (.dxf)</div>
                </div>
              </button>
              <button
                className="flex items-center gap-4 px-5 py-4 rounded bg-[#1e293b] border border-[#334155] hover:border-[#475569] hover:bg-[#253349] transition-colors cursor-default text-left"
                onClick={action(handleExportIFC)}
              >
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="2">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                  <polyline points="14 2 14 8 20 8"/>
                </svg>
                <div>
                  <div className="text-sm font-medium text-[#e2e8f0]">IFC4</div>
                  <div className="text-xs text-[#64748b] mt-0.5">Industry Foundation Classes v4 (.ifc)</div>
                </div>
              </button>
              <button
                className="flex items-center gap-4 px-5 py-4 rounded bg-[#1e293b] border border-[#334155] hover:border-[#475569] hover:bg-[#253349] transition-colors cursor-default text-left"
                onClick={action(handleExportJSON)}
              >
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="2">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                  <polyline points="14 2 14 8 20 8"/>
                </svg>
                <div>
                  <div className="text-sm font-medium text-[#e2e8f0]">JSON</div>
                  <div className="text-xs text-[#64748b] mt-0.5">JSON Data (.json)</div>
                </div>
              </button>
            </div>
          </div>
        )}
        {activeView === 'shortcuts' && (
          <div className="p-8 overflow-y-auto flex-1">
            <h2 className="text-lg font-semibold text-[#e2e8f0] mb-6">Keyboard Shortcuts</h2>
            <div className="max-w-2xl grid grid-cols-1 md:grid-cols-2 gap-8">

              {/* File Operations */}
              <div>
                <h3 className="text-sm font-semibold text-[#e2e8f0] mb-3 border-b border-[#334155] pb-1">File Operations</h3>
                <table className="w-full text-xs">
                  <tbody>
                    {([
                      ['Ctrl+N', 'New file'],
                      ['Ctrl+O', 'Open file'],
                      ['Ctrl+S', 'Save'],
                      ['Ctrl+Shift+S', 'Save As'],
                      ['Ctrl+P', 'Print'],
                      ['Ctrl+W', 'Close document'],
                      ['Ctrl+Tab', 'Next document'],
                      ['Ctrl+Shift+Tab', 'Previous document'],
                    ] as const).map(([key, desc]) => (
                      <tr key={key} className="border-b border-[#1e293b]">
                        <td className="py-1.5 pr-4"><kbd className="px-1.5 py-0.5 bg-[#1e293b] border border-[#334155] text-[#e2e8f0] rounded text-[10px] font-mono">{key}</kbd></td>
                        <td className="py-1.5 text-[#94a3b8]">{desc}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* General */}
              <div>
                <h3 className="text-sm font-semibold text-[#e2e8f0] mb-3 border-b border-[#334155] pb-1">General</h3>
                <table className="w-full text-xs">
                  <tbody>
                    {([
                      ['Ctrl+Z', 'Undo'],
                      ['Ctrl+Y', 'Redo'],
                      ['Ctrl+A', 'Select all'],
                      ['Ctrl+D', 'Deselect all'],
                      ['Delete', 'Delete selected'],
                      ['Escape', 'Cancel / Select tool'],
                      ['+  /  \u2013', 'Zoom in / out'],
                    ] as const).map(([key, desc]) => (
                      <tr key={key} className="border-b border-[#1e293b]">
                        <td className="py-1.5 pr-4"><kbd className="px-1.5 py-0.5 bg-[#1e293b] border border-[#334155] text-[#e2e8f0] rounded text-[10px] font-mono">{key}</kbd></td>
                        <td className="py-1.5 text-[#94a3b8]">{desc}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Drawing Tools (two-key) */}
              <div>
                <h3 className="text-sm font-semibold text-[#e2e8f0] mb-3 border-b border-[#334155] pb-1">Drawing Tools</h3>
                <table className="w-full text-xs">
                  <tbody>
                    {([
                      ['LI', 'Line'],
                      ['RC', 'Rectangle'],
                      ['CI', 'Circle'],
                      ['AR', 'Arc'],
                      ['PL', 'Polyline'],
                      ['EL', 'Ellipse'],
                      ['SP', 'Spline'],
                      ['TX', 'Text'],
                      ['DI', 'Dimension'],
                      ['DL', 'Dimension Linear'],
                      ['DA', 'Dimension Angular'],
                      ['DR', 'Dimension Radius'],
                      ['DD', 'Dimension Diameter'],
                    ] as const).map(([key, desc]) => (
                      <tr key={key} className="border-b border-[#1e293b]">
                        <td className="py-1.5 pr-4"><kbd className="px-1.5 py-0.5 bg-[#1e293b] border border-[#334155] text-[#e2e8f0] rounded text-[10px] font-mono">{key}</kbd></td>
                        <td className="py-1.5 text-[#94a3b8]">{desc}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Modify Tools (two-key) */}
              <div>
                <h3 className="text-sm font-semibold text-[#e2e8f0] mb-3 border-b border-[#334155] pb-1">Modify Tools</h3>
                <table className="w-full text-xs">
                  <tbody>
                    {([
                      ['MV', 'Move'],
                      ['CO', 'Copy'],
                      ['RO', 'Rotate'],
                      ['MM', 'Mirror'],
                      ['RE', 'Scale'],
                      ['TR', 'Trim'],
                      ['EX', 'Extend'],
                      ['OF', 'Offset'],
                      ['FL', 'Fillet'],
                    ] as const).map(([key, desc]) => (
                      <tr key={key} className="border-b border-[#1e293b]">
                        <td className="py-1.5 pr-4"><kbd className="px-1.5 py-0.5 bg-[#1e293b] border border-[#334155] text-[#e2e8f0] rounded text-[10px] font-mono">{key}</kbd></td>
                        <td className="py-1.5 text-[#94a3b8]">{desc}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Drawing Mode */}
              <div>
                <h3 className="text-sm font-semibold text-[#e2e8f0] mb-3 border-b border-[#334155] pb-1">While Drawing</h3>
                <table className="w-full text-xs">
                  <tbody>
                    {([
                      ['Enter', 'Finish drawing'],
                      ['Escape', 'Cancel drawing'],
                      ['U', 'Undo last point'],
                      ['C', 'Close shape'],
                      ['A', 'Polyline arc mode'],
                      ['L', 'Polyline line mode'],
                      ['Space', 'Toggle dimension direction'],
                    ] as const).map(([key, desc]) => (
                      <tr key={key} className="border-b border-[#1e293b]">
                        <td className="py-1.5 pr-4"><kbd className="px-1.5 py-0.5 bg-[#1e293b] border border-[#334155] text-[#e2e8f0] rounded text-[10px] font-mono">{key}</kbd></td>
                        <td className="py-1.5 text-[#94a3b8]">{desc}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Toggle Keys */}
              <div>
                <h3 className="text-sm font-semibold text-[#e2e8f0] mb-3 border-b border-[#334155] pb-1">Toggles</h3>
                <table className="w-full text-xs">
                  <tbody>
                    {([
                      ['F3', 'Toggle OSNAP'],
                      ['F8', 'Toggle Ortho mode'],
                      ['F10', 'Toggle Polar tracking'],
                      ['F11', 'Toggle Object tracking'],
                    ] as const).map(([key, desc]) => (
                      <tr key={key} className="border-b border-[#1e293b]">
                        <td className="py-1.5 pr-4"><kbd className="px-1.5 py-0.5 bg-[#1e293b] border border-[#334155] text-[#e2e8f0] rounded text-[10px] font-mono">{key}</kbd></td>
                        <td className="py-1.5 text-[#94a3b8]">{desc}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

            </div>
            <p className="text-[10px] text-[#475569] mt-6">Two-key shortcuts (e.g. LI, RC) must be typed within 750ms.</p>
          </div>
        )}
        {activeView === 'feedback' && <FeedbackPanel />}
        {activeView === 'about' && (
          <div className="p-8">
            <h2 className="text-lg font-semibold text-[#e2e8f0] mb-6">About</h2>
            <div className="max-w-md">
              <h1 className="text-xl font-bold text-[#e2e8f0] mb-1">Open 2D Studio</h1>
              <p className="text-sm text-[#94a3b8] mb-4">Version 0.5.0</p>
              <p className="text-sm text-[#94a3b8] mb-4">
                A cross-platform 2D CAD application
              </p>
              <a
                href="https://impertio.nl/"
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-cad-accent hover:underline"
              >
                impertio.nl
              </a>
              <p className="text-xs text-[#64748b] mt-6">
                &copy; 2025 Impertio. All rights reserved.
              </p>
            </div>
          </div>
        )}
        {activeView === 'none' && (
          <div className="flex-1 flex items-center justify-center">
            <span className="text-[#475569] text-sm">Select an action from the menu</span>
          </div>
        )}
      </div>

    </div>
  );
}
