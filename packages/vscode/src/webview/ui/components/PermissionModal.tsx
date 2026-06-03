import { useEffect, useCallback } from 'react';
import type { PermissionRequest } from '../App';

interface PermissionModalProps {
  request: PermissionRequest;
  onRespond: (decision: 'allow-once' | 'allow-always' | 'deny') => void;
}

export function PermissionModal({ request, onRespond }: PermissionModalProps) {
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Enter') { e.preventDefault(); onRespond('allow-once'); }
    else if (e.key === 'Escape') { e.preventDefault(); onRespond('deny'); }
  }, [onRespond]);

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  const riskColors: Record<string, string> = {
    low: 'var(--vscode-testing-iconPassed)',
    medium: 'var(--vscode-charts-yellow)',
    high: 'var(--vscode-charts-orange)',
    critical: 'var(--vscode-errorForeground)',
  };

  return (
    <div className="permission-overlay" role="dialog" aria-modal="true" aria-label="Permission request">
      <div className="permission-modal">
        <div className="permission-header">
          <span className="codicon codicon-shield" />
          <span className="permission-title">Permission Required</span>
        </div>
        <div className="permission-body">
          <div className="permission-field">
            <label>Tool</label>
            <span className="permission-value">{request.tool}</span>
          </div>
          {request.path && (
            <div className="permission-field">
              <label>Path</label>
              <span className="permission-value permission-path">{request.path}</span>
            </div>
          )}
          {request.description && (
            <div className="permission-field">
              <label>Description</label>
              <span className="permission-value">{request.description}</span>
            </div>
          )}
          <div className="permission-field">
            <label>Risk Level</label>
            <span className="permission-risk" style={{ color: riskColors[request.riskLevel] || riskColors.medium }}>
              {request.riskLevel.toUpperCase()}
            </span>
          </div>
        </div>
        <div className="permission-actions">
          <button className="permission-btn permission-btn-deny" onClick={() => onRespond('deny')} aria-label="Deny permission">
            <span className="codicon codicon-close" /> Deny <kbd>Esc</kbd>
          </button>
          <button className="permission-btn permission-btn-allow-once" onClick={() => onRespond('allow-once')} aria-label="Allow once">
            <span className="codicon codicon-check" /> Allow Once <kbd>Enter</kbd>
          </button>
          <button className="permission-btn permission-btn-allow-always" onClick={() => onRespond('allow-always')} aria-label="Always allow">
            <span className="codicon codicon-check-all" /> Allow Always
          </button>
        </div>
      </div>
    </div>
  );
}
