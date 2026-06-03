import { useState } from 'react';

interface ResearchQueryState {
  id: string;
  question: string;
  sources: string;
  status: 'pending' | 'running' | 'complete';
  answer?: string;
  elapsed?: number;
}

interface ResearchPanelProps {
  question: string;
  queries: ResearchQueryState[];
  synthesizedReport?: string;
  isComplete: boolean;
}

const sourceIcons: Record<string, string> = {
  web: '\ud83c\udf10',
  code: '\ud83d\udcbb',
  docs: '\ud83d\udcc4',
  all: '\ud83d\udd0d',
};

const queryStatusIcon: Record<ResearchQueryState['status'], string> = {
  pending: '\u23f3',
  running: '\ud83d\udd04',
  complete: '\u2705',
};

function formatMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export function ResearchPanel({ question, queries, synthesizedReport, isComplete }: ResearchPanelProps) {
  const [expandedQueries, setExpandedQueries] = useState<Set<string>>(new Set());
  const [showReport, setShowReport] = useState(true);

  const toggleQuery = (id: string) => {
    setExpandedQueries(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const completeCount = queries.filter(q => q.status === 'complete').length;
  const progress = queries.length > 0 ? (completeCount / queries.length) * 100 : 0;

  return (
    <div className="research-panel">
      <div className="research-header">
        <div className="research-title">Research: {question.length > 60 ? question.slice(0, 57) + '...' : question}</div>
        <div className="research-progress-text">
          {completeCount}/{queries.length} queries complete
          {!isComplete && ' — researching...'}
        </div>
      </div>
      <div className="research-progress-bar">
        <div className="research-progress-fill" style={{ width: `${progress}%`, background: isComplete ? 'var(--vscode-charts-green)' : 'var(--vscode-progressBar-background)' }} />
      </div>
      <div className="research-queries">
        {queries.map(query => (
          <div key={query.id} className="research-query">
            <div onClick={() => query.answer ? toggleQuery(query.id) : undefined} className="research-query-header">
              <span>{queryStatusIcon[query.status]}</span>
              <span style={{ fontSize: 12 }}>{sourceIcons[query.sources] ?? '\ud83d\udd0d'}</span>
              <span className="research-query-question">{query.question}</span>
              {query.elapsed != null && <span className="research-query-elapsed">{formatMs(query.elapsed)}</span>}
              {query.answer && <span>{expandedQueries.has(query.id) ? '\u25b2' : '\u25bc'}</span>}
            </div>
            {expandedQueries.has(query.id) && query.answer && (
              <div className="research-query-answer">{query.answer}</div>
            )}
          </div>
        ))}
      </div>
      {synthesizedReport && isComplete && (
        <div className="research-report">
          <div onClick={() => setShowReport(!showReport)} className="research-report-header">
            <span>Synthesized Report</span>
            <span>{showReport ? '\u25b2' : '\u25bc'}</span>
          </div>
          {showReport && <div className="research-report-content">{synthesizedReport}</div>}
        </div>
      )}
    </div>
  );
}
