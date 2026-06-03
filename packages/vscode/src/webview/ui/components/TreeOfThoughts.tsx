import { useState } from 'react';

interface ThoughtNodeState {
  id: string;
  content: string;
  score: number;
  parentId?: string;
  depth: number;
}

interface TreeOfThoughtsProps {
  thoughts: ThoughtNodeState[];
  scores: Record<string, number>;
  bestThoughtId?: string;
  isComplete: boolean;
  problem: string;
}

function scoreColor(score: number): string {
  if (score >= 0.8) return 'var(--vscode-charts-green)';
  if (score >= 0.5) return 'var(--vscode-charts-yellow)';
  return 'var(--vscode-charts-red)';
}

export function TreeOfThoughts({ thoughts, scores, bestThoughtId, isComplete, problem }: TreeOfThoughtsProps) {
  const [collapsed, setCollapsed] = useState(isComplete);

  if (isComplete && collapsed) {
    const best = thoughts.find(t => t.id === bestThoughtId);
    return (
      <div className="tot-collapsed">
        <div onClick={() => setCollapsed(false)} className="tot-collapsed-header">
          <span>Tree of Thoughts — Complete</span>
          <span>expand</span>
        </div>
        {best && <div className="tot-collapsed-best">{best.content}</div>}
      </div>
    );
  }

  const byDepth: Map<number, ThoughtNodeState[]> = new Map();
  for (const t of thoughts) {
    const list = byDepth.get(t.depth) ?? [];
    list.push(t);
    byDepth.set(t.depth, list);
  }

  return (
    <div className="tot-panel">
      <div onClick={() => { if (isComplete) setCollapsed(true); }} className="tot-header">
        <span>Tree of Thoughts {isComplete ? '(click to collapse)' : ''}</span>
        <span className="tot-count">{thoughts.length} thoughts explored</span>
      </div>
      <div className="tot-body">
        <div className="tot-problem">{problem.length > 100 ? problem.slice(0, 97) + '...' : problem}</div>
        {Array.from(byDepth.entries()).sort(([a], [b]) => a - b).map(([depth, nodes]) => (
          <div key={depth} className="tot-depth-group">
            <div className="tot-depth-label">Depth {depth}</div>
            {nodes.map(node => {
              const score = scores[node.id] ?? node.score;
              const isBest = node.id === bestThoughtId;
              return (
                <div key={node.id} className={`tot-thought ${isBest ? 'tot-thought-best' : ''}`} style={{ marginLeft: depth * 12 }}>
                  <div className="tot-thought-content">{node.content}</div>
                  <span className="tot-thought-score" style={{ color: scoreColor(score) }}>
                    {isBest && '\u2b50 '}{Math.round(score * 100)}%
                  </span>
                </div>
              );
            })}
          </div>
        ))}
        {!isComplete && <div className="tot-exploring">Exploring reasoning paths...</div>}
        {isComplete && bestThoughtId && (
          <div className="tot-best-path">
            <div className="tot-best-path-label">Best Path</div>
            <div className="tot-best-path-content">{thoughts.find(t => t.id === bestThoughtId)?.content}</div>
          </div>
        )}
      </div>
    </div>
  );
}
