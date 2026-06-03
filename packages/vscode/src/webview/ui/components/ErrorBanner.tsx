import type { ErrorState } from '../App';

interface ErrorBannerProps {
  error: ErrorState;
  onDismiss: () => void;
  onRetry: () => void;
}

export function ErrorBanner({ error, onDismiss, onRetry }: ErrorBannerProps) {
  const severityClass = error.recoverable ? 'error-recoverable' : 'error-fatal';

  return (
    <div className={`error-banner ${severityClass}`} role="alert" aria-live="assertive">
      <div className="error-header">
        <span className={`codicon ${error.recoverable ? 'codicon-warning' : 'codicon-error'}`} />
        <span className="error-code">{error.code}</span>
        <button className="error-dismiss" onClick={onDismiss} title="Dismiss" aria-label="Dismiss error">
          <span className="codicon codicon-close" />
        </button>
      </div>
      <div className="error-message">{error.message}</div>
      <div className="error-actions">
        {error.recoverable && (
          <button className="error-btn error-btn-retry" onClick={onRetry} aria-label="Retry operation">
            <span className="codicon codicon-refresh" /> Retry
          </button>
        )}
        {error.actions?.map((action) => (
          <button key={action.action} className="error-btn">{action.label}</button>
        ))}
      </div>
    </div>
  );
}
