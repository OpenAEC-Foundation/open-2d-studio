import { useState, useEffect, useCallback, useRef } from 'react';
import { useFileOperations } from '../../../hooks/file/useFileOperations';
import { getSetting, setSetting } from '../../../utils/settings';
import { open as shellOpen } from '@tauri-apps/plugin-shell';

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
      className={`w-full flex items-center gap-3 px-6 py-3 text-left text-sm text-cad-text hover:bg-cad-hover transition-colors cursor-default ${active ? 'bg-cad-hover' : ''}`}
      onClick={onClick}
      onMouseEnter={onMouseEnter}
    >
      <span className="w-5 h-5 flex items-center justify-center opacity-80">{icon}</span>
      <span className="flex-1">{label}</span>
      {shortcut && <span className="text-[10px] text-cad-text-muted font-mono">{shortcut}</span>}
    </button>
  );
}

type FeedbackCategory = 'bug' | 'feature' | 'general';
type FeedbackStatus = 'idle' | 'submitting' | 'success' | 'error' | 'no-token';

const GITHUB_REPO = 'OpenAEC-Foundation/Open-2D-Studio';
const CATEGORY_LABELS: Record<FeedbackCategory, string> = {
  bug: 'bug',
  feature: 'enhancement',
  general: 'feedback',
};
const RATING_LABELS: Record<number, string> = {
  1: 'Frustrated',
  2: 'Neutral',
  3: 'Happy',
};

function FeedbackPanel() {
  const [category, setCategory] = useState<FeedbackCategory>('general');
  const [message, setMessage] = useState('');
  const [rating, setRating] = useState<number | null>(null);
  const [status, setStatus] = useState<FeedbackStatus>('idle');
  const [error, setError] = useState('');
  const [token, setToken] = useState('');
  const [tokenLoaded, setTokenLoaded] = useState(false);
  const [showToken, setShowToken] = useState(false);
  const [issueUrl, setIssueUrl] = useState('');
  const [tokenStatus, setTokenStatus] = useState<'idle' | 'validating' | 'valid' | 'invalid' | 'no-scope'>('idle');
  const [tokenUser, setTokenUser] = useState('');
  const validateTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    getSetting<string>('github-token', '').then(saved => {
      setToken(saved);
      setTokenLoaded(true);
      if (saved.trim()) validateToken(saved);
    });
  }, []);

  const validateToken = async (value: string) => {
    if (!value.trim()) {
      setTokenStatus('idle');
      setTokenUser('');
      return;
    }
    setTokenStatus('validating');
    try {
      const res = await fetch('https://api.github.com/user', {
        headers: {
          'Authorization': `Bearer ${value.trim()}`,
          'Accept': 'application/vnd.github+json',
        },
      });
      if (!res.ok) {
        setTokenStatus('invalid');
        setTokenUser('');
        return;
      }
      const scopes = res.headers.get('x-oauth-scopes') || '';
      const hasScope = scopes.split(',').map(s => s.trim()).some(s => s === 'public_repo' || s === 'repo');
      if (!hasScope) {
        setTokenStatus('no-scope');
        setTokenUser('');
        return;
      }
      const data = await res.json();
      setTokenUser(data.login || '');
      setTokenStatus('valid');
    } catch {
      setTokenStatus('invalid');
      setTokenUser('');
    }
  };

  const handleSaveToken = async (value: string) => {
    setToken(value);
    await setSetting('github-token', value);
    if (validateTimerRef.current) clearTimeout(validateTimerRef.current);
    if (value.trim()) {
      validateTimerRef.current = setTimeout(() => validateToken(value), 600);
    } else {
      setTokenStatus('idle');
      setTokenUser('');
    }
  };

  const handleSubmit = async () => {
    if (!token.trim()) {
      setStatus('no-token');
      return;
    }

    setStatus('submitting');
    setError('');

    const ratingText = rating ? `\n\n**Sentiment:** ${RATING_LABELS[rating] || ''}` : '';
    const title = category === 'bug'
      ? `[Bug] ${message.slice(0, 80)}${message.length > 80 ? '...' : ''}`
      : category === 'feature'
        ? `[Feature Request] ${message.slice(0, 80)}${message.length > 80 ? '...' : ''}`
        : `[Feedback] ${message.slice(0, 80)}${message.length > 80 ? '...' : ''}`;

    const body = `${message}${ratingText}\n\n---\n*Submitted from Open 2D Studio*`;

    try {
      const res = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/issues`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token.trim()}`,
          'Accept': 'application/vnd.github+json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          title,
          body,
          labels: [CATEGORY_LABELS[category]],
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        if (res.status === 401) {
          setError('Invalid token. Please check your GitHub token and try again.');
        } else if (res.status === 403) {
          setError('Token lacks permission. Ensure it has the "repo" or "public_repo" scope.');
        } else {
          setError(data.message || `GitHub API error (${res.status})`);
        }
        setStatus('error');
        return;
      }

      const data = await res.json();
      setIssueUrl(data.html_url || '');
      setStatus('success');
      setMessage('');
      setRating(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error');
      setStatus('error');
    }
  };

  if (!tokenLoaded) return null;

  if (status === 'success') {
    return (
      <div className="p-8">
        <h2 className="text-lg font-semibold text-cad-text mb-6">Send Feedback</h2>
        <p className="text-sm text-cad-text mb-2">Thank you for your feedback!</p>
        {issueUrl && (
          <p className="text-xs text-cad-text-dim">
            Issue created:{' '}
            <button
              className="text-cad-accent hover:underline cursor-pointer"
              onClick={() => shellOpen(issueUrl)}
            >
              {issueUrl}
            </button>
          </p>
        )}
        <button
          className="mt-4 px-4 py-1.5 text-xs font-medium rounded bg-cad-surface border border-cad-border text-cad-text-dim hover:bg-cad-hover cursor-default"
          onClick={() => { setStatus('idle'); setIssueUrl(''); }}
        >
          Send another
        </button>
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
      <h2 className="text-lg font-semibold text-cad-text mb-6">Send Feedback</h2>
      <div className="max-w-md flex flex-col gap-4">
        {/* GitHub Token */}
        {(!token.trim() || status === 'no-token' || tokenStatus === 'invalid' || tokenStatus === 'no-scope') && (
          <div className="bg-cad-surface border border-cad-border rounded p-3 flex flex-col gap-2">
            <label className="text-xs text-cad-text-dim">
              GitHub Personal Access Token <span className="text-cad-text-muted">(required to submit)</span>
            </label>
            <div className="flex gap-2">
              <input
                type={showToken ? 'text' : 'password'}
                className={`flex-1 bg-cad-bg border text-cad-text text-xs rounded px-2 py-1.5 focus:outline-none font-mono ${
                  tokenStatus === 'invalid' || tokenStatus === 'no-scope' ? 'border-red-500' : tokenStatus === 'valid' ? 'border-green-500' : 'border-cad-border focus:border-cad-border-light'
                }`}
                placeholder="ghp_..."
                value={token}
                onChange={e => handleSaveToken(e.target.value)}
              />
              <button
                className="px-2 py-1 text-[10px] text-cad-text-dim border border-cad-border rounded hover:bg-cad-hover cursor-default"
                onClick={() => setShowToken(!showToken)}
              >
                {showToken ? 'Hide' : 'Show'}
              </button>
            </div>
            {tokenStatus === 'validating' && (
              <p className="text-[10px] text-cad-text-muted">Validating token...</p>
            )}
            {tokenStatus === 'invalid' && (
              <p className="text-[10px] text-red-400">Invalid token. Please check and try again.</p>
            )}
            {tokenStatus === 'no-scope' && (
              <p className="text-[10px] text-red-400">Token is missing the <strong>public_repo</strong> scope.</p>
            )}
            {tokenStatus === 'valid' && (
              <p className="text-[10px] text-green-400">Authenticated as <strong>{tokenUser}</strong></p>
            )}
            <p className="text-[10px] text-cad-text-muted">
              <button
                className="text-cad-accent hover:underline cursor-pointer"
                onClick={() => shellOpen('https://github.com/settings/tokens/new?scopes=public_repo&description=Open+2D+Studio+Feedback')}
              >
                Create a token
              </button>
              {' '}with <strong>public_repo</strong> scope.
            </p>
          </div>
        )}

        {token.trim() && status !== 'no-token' && tokenStatus !== 'invalid' && tokenStatus !== 'no-scope' && (
          <div className="flex items-center gap-2">
            {tokenStatus === 'valid' && <span className="w-2 h-2 rounded-full bg-green-500" />}
            <span className="text-[10px] text-cad-text-muted">
              {tokenStatus === 'valid' ? `Authenticated as ${tokenUser}` : 'GitHub token configured'}
            </span>
            <button
              className="text-[10px] text-cad-text-dim hover:text-cad-text cursor-default"
              onClick={() => { setShowToken(false); handleSaveToken(''); setTokenStatus('idle'); setTokenUser(''); }}
            >
              Clear
            </button>
          </div>
        )}

        {/* Category toggles */}
        <div className="flex gap-2">
          {categories.map(c => (
            <button
              key={c.value}
              className={`px-4 py-1.5 text-xs font-medium rounded transition-colors cursor-default ${
                category === c.value
                  ? 'bg-cad-accent text-white'
                  : 'bg-cad-surface border border-cad-border text-cad-text-dim hover:bg-cad-hover'
              }`}
              onClick={() => setCategory(c.value)}
            >
              {c.label}
            </button>
          ))}
        </div>

        {/* Message */}
        <textarea
          className="w-full bg-cad-surface border border-cad-border text-cad-text text-sm rounded px-3 py-2 resize-none focus:outline-none focus:border-cad-border-light"
          rows={4}
          placeholder="Describe your feedback..."
          value={message}
          onChange={e => setMessage(e.target.value)}
        />

        {/* Emoji rating */}
        <div className="flex items-center gap-1">
          <span className="text-xs text-cad-text-muted mr-2">How do you feel?</span>
          {emojis.map(e => (
            <button
              key={e.value}
              className={`text-xl px-1 cursor-default rounded transition-colors ${
                rating === e.value ? 'bg-cad-hover' : 'hover:bg-cad-surface-elevated'
              }`}
              onClick={() => setRating(rating === e.value ? null : e.value)}
            >
              {e.label}
            </button>
          ))}
        </div>

        {/* Error message */}
        {status === 'error' && (
          <p className="text-xs text-red-400">{error}</p>
        )}

        {/* Submit */}
        <button
          className="self-start px-5 py-1.5 text-sm font-medium text-white rounded transition-colors cursor-default bg-cad-accent hover:bg-cad-accent/80 disabled:opacity-50 disabled:cursor-default"
          disabled={!message.trim() || status === 'submitting'}
          onClick={handleSubmit}
        >
          {status === 'submitting' ? 'Submitting...' : 'Submit'}
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
    <div className="fixed inset-0 z-50 flex bg-cad-bg">
      {/* Sidebar */}
      <div className="w-[250px] flex flex-col border-r border-cad-border bg-cad-surface">
        {/* Back button + header */}
        <button
          className="flex items-center gap-3 px-5 py-4 text-white font-semibold text-base bg-cad-accent hover:bg-cad-accent/80 transition-colors cursor-default"
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

          <div className="h-px bg-cad-border my-1 mx-4" />

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

          <div className="h-px bg-cad-border my-1 mx-4" />

          <BackstageItem
            icon={<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>}
            label="Import"
            onClick={() => setActiveView('import')}
            onMouseEnter={() => setActiveView('import')}
            active={activeView === 'import'}
          />
          <BackstageItem
            icon={<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>}
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

          <div className="h-px bg-cad-border my-1 mx-4" />

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
            <h2 className="text-lg font-semibold text-cad-text mb-6">Import</h2>
            <div className="flex flex-col gap-2 max-w-md">
              <button
                className="flex items-center gap-4 px-5 py-4 rounded bg-cad-surface border border-cad-border hover:border-cad-border-light hover:bg-cad-hover transition-colors cursor-default text-left"
                onClick={action(handleImportDXF)}
              >
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" className="stroke-cad-text-dim" strokeWidth="2">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                  <polyline points="14 2 14 8 20 8"/>
                </svg>
                <div>
                  <div className="text-sm font-medium text-cad-text">DXF File</div>
                  <div className="text-xs text-cad-text-muted mt-0.5">Import geometry from DXF format (.dxf)</div>
                </div>
              </button>
              <button
                className="flex items-center gap-4 px-5 py-4 rounded bg-cad-surface border border-cad-border hover:border-cad-border-light hover:bg-cad-hover transition-colors cursor-default text-left"
                onClick={action(() => onOpenSheetTemplateImport?.())}
              >
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" className="stroke-cad-text-dim" strokeWidth="2">
                  <rect x="3" y="3" width="18" height="18" rx="2"/>
                  <line x1="3" y1="15" x2="21" y2="15"/>
                  <line x1="12" y1="15" x2="12" y2="21"/>
                </svg>
                <div>
                  <div className="text-sm font-medium text-cad-text">Sheet Template</div>
                  <div className="text-xs text-cad-text-muted mt-0.5">Import SVG-based sheet template (.svg)</div>
                </div>
              </button>
            </div>
          </div>
        )}
        {activeView === 'export' && (
          <div className="p-8">
            <h2 className="text-lg font-semibold text-cad-text mb-6">Export</h2>
            <div className="flex flex-col gap-2 max-w-md">
              <button
                className="flex items-center gap-4 px-5 py-4 rounded bg-cad-surface border border-cad-border hover:border-cad-border-light hover:bg-cad-hover transition-colors cursor-default text-left"
                onClick={action(handleExportSVG)}
              >
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" className="stroke-cad-text-dim" strokeWidth="2">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                  <polyline points="14 2 14 8 20 8"/>
                </svg>
                <div>
                  <div className="text-sm font-medium text-cad-text">SVG</div>
                  <div className="text-xs text-cad-text-muted mt-0.5">Scalable Vector Graphics (.svg)</div>
                </div>
              </button>
              <button
                className="flex items-center gap-4 px-5 py-4 rounded bg-cad-surface border border-cad-border hover:border-cad-border-light hover:bg-cad-hover transition-colors cursor-default text-left"
                onClick={action(handleExportDXF)}
              >
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" className="stroke-cad-text-dim" strokeWidth="2">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                  <polyline points="14 2 14 8 20 8"/>
                </svg>
                <div>
                  <div className="text-sm font-medium text-cad-text">DXF</div>
                  <div className="text-xs text-cad-text-muted mt-0.5">Drawing Exchange Format (.dxf)</div>
                </div>
              </button>
              <button
                className="flex items-center gap-4 px-5 py-4 rounded bg-cad-surface border border-cad-border hover:border-cad-border-light hover:bg-cad-hover transition-colors cursor-default text-left"
                onClick={action(handleExportIFC)}
              >
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" className="stroke-cad-text-dim" strokeWidth="2">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                  <polyline points="14 2 14 8 20 8"/>
                </svg>
                <div>
                  <div className="text-sm font-medium text-cad-text">IFC4</div>
                  <div className="text-xs text-cad-text-muted mt-0.5">Industry Foundation Classes v4 (.ifc)</div>
                </div>
              </button>
              <button
                className="flex items-center gap-4 px-5 py-4 rounded bg-cad-surface border border-cad-border hover:border-cad-border-light hover:bg-cad-hover transition-colors cursor-default text-left"
                onClick={action(handleExportJSON)}
              >
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" className="stroke-cad-text-dim" strokeWidth="2">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                  <polyline points="14 2 14 8 20 8"/>
                </svg>
                <div>
                  <div className="text-sm font-medium text-cad-text">JSON</div>
                  <div className="text-xs text-cad-text-muted mt-0.5">JSON Data (.json)</div>
                </div>
              </button>
            </div>
          </div>
        )}
        {activeView === 'shortcuts' && (
          <div className="p-8 overflow-y-auto flex-1">
            <h2 className="text-lg font-semibold text-cad-text mb-6">Keyboard Shortcuts</h2>
            <div className="max-w-2xl grid grid-cols-1 md:grid-cols-2 gap-8">

              {/* File Operations */}
              <div>
                <h3 className="text-sm font-semibold text-cad-text mb-3 border-b border-cad-border pb-1">File Operations</h3>
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
                      <tr key={key} className="border-b border-cad-bg">
                        <td className="py-1.5 pr-4"><kbd className="px-1.5 py-0.5 bg-cad-surface border border-cad-border text-cad-text rounded text-[10px] font-mono">{key}</kbd></td>
                        <td className="py-1.5 text-cad-text-dim">{desc}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* General */}
              <div>
                <h3 className="text-sm font-semibold text-cad-text mb-3 border-b border-cad-border pb-1">General</h3>
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
                      <tr key={key} className="border-b border-cad-bg">
                        <td className="py-1.5 pr-4"><kbd className="px-1.5 py-0.5 bg-cad-surface border border-cad-border text-cad-text rounded text-[10px] font-mono">{key}</kbd></td>
                        <td className="py-1.5 text-cad-text-dim">{desc}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Drawing Tools (two-key) */}
              <div>
                <h3 className="text-sm font-semibold text-cad-text mb-3 border-b border-cad-border pb-1">Drawing Tools</h3>
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
                      <tr key={key} className="border-b border-cad-bg">
                        <td className="py-1.5 pr-4"><kbd className="px-1.5 py-0.5 bg-cad-surface border border-cad-border text-cad-text rounded text-[10px] font-mono">{key}</kbd></td>
                        <td className="py-1.5 text-cad-text-dim">{desc}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Modify Tools (two-key) */}
              <div>
                <h3 className="text-sm font-semibold text-cad-text mb-3 border-b border-cad-border pb-1">Modify Tools</h3>
                <table className="w-full text-xs">
                  <tbody>
                    {([
                      ['G / MV', 'Move'],
                      ['CO', 'Copy'],
                      ['RO', 'Rotate'],
                      ['MM', 'Mirror'],
                      ['RE', 'Scale'],
                      ['TR', 'Trim'],
                      ['EX', 'Extend'],
                      ['OF', 'Offset'],
                      ['FL', 'Fillet'],
                    ] as const).map(([key, desc]) => (
                      <tr key={key} className="border-b border-cad-bg">
                        <td className="py-1.5 pr-4"><kbd className="px-1.5 py-0.5 bg-cad-surface border border-cad-border text-cad-text rounded text-[10px] font-mono">{key}</kbd></td>
                        <td className="py-1.5 text-cad-text-dim">{desc}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Drawing Mode */}
              <div>
                <h3 className="text-sm font-semibold text-cad-text mb-3 border-b border-cad-border pb-1">While Drawing</h3>
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
                      <tr key={key} className="border-b border-cad-bg">
                        <td className="py-1.5 pr-4"><kbd className="px-1.5 py-0.5 bg-cad-surface border border-cad-border text-cad-text rounded text-[10px] font-mono">{key}</kbd></td>
                        <td className="py-1.5 text-cad-text-dim">{desc}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Toggle Keys */}
              <div>
                <h3 className="text-sm font-semibold text-cad-text mb-3 border-b border-cad-border pb-1">Toggles</h3>
                <table className="w-full text-xs">
                  <tbody>
                    {([
                      ['F3', 'Toggle OSNAP'],
                      ['F8', 'Toggle Ortho mode'],
                      ['F10', 'Toggle Polar tracking'],
                      ['F11', 'Toggle Object tracking'],
                    ] as const).map(([key, desc]) => (
                      <tr key={key} className="border-b border-cad-bg">
                        <td className="py-1.5 pr-4"><kbd className="px-1.5 py-0.5 bg-cad-surface border border-cad-border text-cad-text rounded text-[10px] font-mono">{key}</kbd></td>
                        <td className="py-1.5 text-cad-text-dim">{desc}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

            </div>
            <p className="text-[10px] text-cad-text-muted mt-6">Two-key shortcuts (e.g. LI, RC) must be typed within 750ms.</p>
          </div>
        )}
        {activeView === 'feedback' && <FeedbackPanel />}
        {activeView === 'about' && (
          <div className="p-8">
            <h2 className="text-lg font-semibold text-cad-text mb-6">About</h2>
            <div className="max-w-md">
              <h1 className="text-xl font-bold text-cad-text mb-1">Open 2D Studio</h1>
              <p className="text-sm text-cad-text-dim mb-4">Version 0.5.0</p>
              <p className="text-sm text-cad-text-dim mb-4">
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
              <p className="text-xs text-cad-text-muted mt-6">
                &copy; 2025 Impertio. All rights reserved.
              </p>
            </div>
          </div>
        )}
        {activeView === 'none' && (
          <div className="flex-1 flex items-center justify-center">
            <span className="text-cad-text-muted text-sm">Select an action from the menu</span>
          </div>
        )}
      </div>

    </div>
  );
}
