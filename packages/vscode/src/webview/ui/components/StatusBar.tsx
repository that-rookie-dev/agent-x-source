import type { StatusState } from '../App';

interface StatusBarProps {
  status: StatusState;
}

export function StatusBar({ status }: StatusBarProps) {
  const pct = status.tokens.percentage;
  const barColor = pct < 50 ? 'var(--vscode-testing-iconPassed)'
    : pct < 80 ? 'var(--vscode-charts-yellow)' : 'var(--vscode-errorForeground)';

  const formatTokens = (n: number): string => {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
    return String(n);
  };

  return (
    <div className="webview-status-bar">
      <div className="status-item status-provider" title="Provider">
        <span className="codicon codicon-cloud" /><span>{status.provider || '—'}</span>
      </div>
      <div className="status-item status-model" title="Model">
        <span className="codicon codicon-symbol-misc" />
        <span className="status-model-text">{status.model || '—'}</span>
      </div>
      <div className="status-item status-tokens" title="Token usage">
        <div className="token-bar">
          <div className="token-bar-fill" style={{ width: `${Math.min(pct, 100)}%`, backgroundColor: barColor }} />
        </div>
        <span className="token-text">{formatTokens(status.tokens.used)}/{formatTokens(status.tokens.total)}</span>
      </div>
      <div className="status-item status-cost" title="Session cost">
        <span className="codicon codicon-credit-card" /><span>${status.tokens.cost.toFixed(4)}</span>
      </div>
      {status.activeTools > 0 && (
        <div className="status-item status-tools" title="Active tools">
          <span className="codicon codicon-tools" /><span>{status.activeTools}</span>
        </div>
      )}
      {status.subAgents > 0 && (
        <div className="status-item status-agents" title="Sub-agents">
          <span className="codicon codicon-organization" /><span>{status.subAgents}</span>
        </div>
      )}
    </div>
  );
}
