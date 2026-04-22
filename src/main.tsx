import React from 'react';
import ReactDOM from 'react-dom/client';
import { isMobileViewer } from './utils/platform';
import './styles/globals.css';

// Slice 1 of the 1.0 + 2.0 merge: when VITE_MERGED=1 is set (via
// vite.merged.config.ts or npm run dev:merged), render the stripped
// MergedApp shell instead of the full 1.0 App. See
// docs/superpowers/specs/2026-04-22-open2d-merge-slice1-design.md.
const isMerged = import.meta.env.VITE_MERGED === '1';

const AppComponent = React.lazy(() =>
  isMerged
    ? import('./MergedApp')
    : isMobileViewer()
      ? import('./components/tablet/TabletApp')
      : import('./App')
);

const LoadingFallback = () => (
  <div style={{ width: '100vw', height: '100vh', background: '#1a1a2e' }} />
);

class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error: Error | null }
> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[ErrorBoundary]', error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 40, color: '#ff6b6b', background: '#1a1a2e', minHeight: '100vh', fontFamily: 'monospace' }}>
          <h1 style={{ color: '#ff6b6b' }}>Runtime Error</h1>
          <pre style={{ whiteSpace: 'pre-wrap', fontSize: 14, color: '#ffa07a' }}>
            {this.state.error.message}
          </pre>
          <pre style={{ whiteSpace: 'pre-wrap', fontSize: 12, color: '#888', marginTop: 16 }}>
            {this.state.error.stack}
          </pre>
          <button
            onClick={() => this.setState({ error: null })}
            style={{ marginTop: 20, padding: '8px 16px', background: '#4a90d9', color: 'white', border: 'none', borderRadius: 4, cursor: 'pointer' }}
          >
            Try Again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <ErrorBoundary>
      <React.Suspense fallback={<LoadingFallback />}>
        <AppComponent />
      </React.Suspense>
    </ErrorBoundary>
  </React.StrictMode>
);
