import { useState } from 'react';

export interface ToolCardData {
  id: string;
  name: string;
  status: 'running' | 'complete' | 'error';
  startTime: number;
  elapsed?: number;
  output?: string;
  error?: string;
}

export interface ReasoningData {
  content: string;
  collapsed?: boolean;
}

export interface SubAgentData {
  id: string;
  action: 'spawned' | 'complete' | 'failed' | 'message';
  name?: string;
  instruction?: string;
  output?: string;
  elapsed?: number;
  from?: string;
  to?: string;
  topic?: string;
}

interface ChatEventCardProps {
  type: 'tool' | 'reasoning' | 'subagent' | 'clarification';
  data: ToolCardData | ReasoningData | SubAgentData;
  index: number;
}

export default function ChatEventCard({ type, data, index }: ChatEventCardProps) {
  const [expanded, setExpanded] = useState(false);

  if (type === 'tool') {
    const t = data as ToolCardData;
    const elapsedStr = t.elapsed !== undefined
      ? (t.elapsed >= 1000 ? `${(t.elapsed / 1000).toFixed(1)}s` : `${t.elapsed}ms`)
      : '';
    const isRunning = t.status === 'running';

    return (
      <div className={`event-card event-tool ${isRunning ? 'running' : ''}`}
        style={{ animationDelay: `${index * 30}ms` }}
        onClick={() => setExpanded(!expanded)}>
        <div className="event-card-glow" />
        <div className="event-card-body">
          <div className="event-card-indicator">
            <span className={`event-dot ${t.status}`} />
            <span className="event-icon">
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ width: 12, height: 12 }}>
                <path d="M4 2v12l-2-2M12 2v12l2-2M4 8h8M4 5h8M4 11h8"/>
              </svg>
            </span>
            <span className="event-name">{t.name}</span>
            {isRunning && <span className="event-status-text">executing...</span>}
          </div>
          <div className="event-card-meta">
            {elapsedStr && <span className="event-elapsed">⏱ {elapsedStr}</span>}
            {t.status === 'complete' && <span className="event-badge success">COMPLETE</span>}
            {t.status === 'error' && <span className="event-badge error">FAILED</span>}
          </div>
        </div>
        {expanded && t.output && (
          <div className="event-card-output">
            <pre>{t.output.slice(0, 2000)}{t.output.length > 2000 ? '\n... (truncated)' : ''}</pre>
          </div>
        )}
      </div>
    );
  }

  if (type === 'reasoning') {
    const r = data as ReasoningData;
    return (
      <div className="event-card event-reasoning" style={{ animationDelay: `${index * 30}ms` }}>
        <div className="event-card-glow" style={{ background: 'rgba(179, 136, 255, 0.08)' }} />
        <div className="event-card-body" onClick={() => setExpanded(!expanded)}>
          <div className="event-card-indicator">
            <span className="event-icon reasoning">
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ width: 12, height: 12 }}>
                <circle cx="8" cy="8" r="6"/><path d="M8 5v3.5l2 2"/>
              </svg>
            </span>
            <span className="event-name reasoning-label">REASONING</span>
            <span className="event-status-text">{expanded ? '(collapse)' : `(${r.content.length} chars)`}</span>
          </div>
        </div>
        {expanded && (
          <div className="event-card-reasoning">
            <div className="reasoning-content">{r.content || 'Thinking...'}</div>
          </div>
        )}
      </div>
    );
  }

  if (type === 'subagent') {
    const s = data as SubAgentData;
    const iconMap = {
      spawned: 'M8 3v10M3 8h10',
      complete: 'M4 12l4-8 4 8',
      failed: 'M6 6l4 4M10 6l-4 4',
      message: 'M3 8h10M7 4v8',
    };
    const labelMap = {
      spawned: 'SPAWNED',
      complete: 'COMPLETED',
      failed: 'FAILED',
      message: 'MESSAGE',
    };

    return (
      <div className="event-card event-subagent" style={{ animationDelay: `${index * 30}ms` }}
        onClick={() => setExpanded(!expanded)}>
        <div className="event-card-glow" style={{ background: 'rgba(64, 196, 255, 0.06)' }} />
        <div className="event-card-body">
          <div className="event-card-indicator">
            <span className={`event-dot ${s.action === 'message' ? 'info' : s.action === 'complete' ? 'success' : s.action === 'failed' ? 'error' : 'running'}`} />
            <span className="event-icon subagent">
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ width: 12, height: 12 }}>
                <path d={iconMap[s.action] || iconMap.spawned}/>
              </svg>
            </span>
            <span className="event-name">
              {s.name || s.id?.slice(0, 12) || 'agent'}
            </span>
            <span className="event-badge info">{labelMap[s.action]}</span>
          </div>
          <div className="event-card-meta">
            {s.instruction && <span className="event-desc">{s.instruction.slice(0, 80)}</span>}
            {s.elapsed && <span className="event-elapsed">⏱ {s.elapsed}ms</span>}
            {s.topic && <span className="event-desc">→ {s.topic}: {s.to}</span>}
          </div>
        </div>
      </div>
    );
  }

  return null;
}
