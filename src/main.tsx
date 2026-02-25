import React from 'react';
import ReactDOM from 'react-dom/client';
import { isMobileViewer } from './utils/platform';
import './styles/globals.css';

const AppComponent = React.lazy(() =>
  isMobileViewer()
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
