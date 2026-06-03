import { useState, useEffect, useRef, memo } from 'react';
import type { ToolState } from '../App';

interface ToolCardProps {
  tool: ToolState;
}

export const ToolCard = memo(function ToolCard({ tool }: ToolCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const intervalRef = useRef<ReturnType<typeof setInterval>>();

  useEffect(() => {
    if (tool.status === 'running') {
      intervalRef.current = setInterval(() => {
        setElapsed(Date.now() - tool.startTime);
      }, 100);
    } else {
      if (intervalRef.current) clearInterval(intervalRef.current);
      setElapsed(tool.elapsed || 0);
    }
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [tool.status, tool.startTime, tool.elapsed]);

  const statusIcon = tool.status === 'running'
    ? 'codicon-loading codicon-modifier-spin'
    : tool.status === 'error' ? 'codicon-error' : 'codicon-check';

  const statusClass = `tool-card-status-${tool.status}`;

  const formatElapsed = (ms: number): string => {
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
  };

  return (
    <div className={`tool-card ${statusClass}`}>
      <div className="tool-card-header" onClick={() => setExpanded(!expanded)}>
        <span className={`tool-card-icon codicon ${statusIcon}`} />
        <span className="tool-card-name">{tool.tool}</span>
        <span className="tool-card-elapsed">{formatElapsed(elapsed)}</span>
        <span className="tool-card-toggle codicon codicon-chevron-down" />
      </div>
      <div className="tool-card-description">{tool.description}</div>
      {expanded && tool.result && (
        <div className="tool-card-output"><pre>{tool.result}</pre></div>
      )}
      {tool.status === 'error' && tool.result && (
        <div className="tool-card-error"><pre>{tool.result}</pre></div>
      )}
    </div>
  );
});
