import { SubAgentCard } from './SubAgentCard';
import type { SubAgentState } from '../App';

interface SubAgentPanelProps {
  agents: SubAgentState[];
  onCancel: (agentId: string) => void;
}

function formatElapsed(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rs = s % 60;
  return `${m}m ${rs}s`;
}

export function SubAgentPanel({ agents, onCancel }: SubAgentPanelProps) {
  if (agents.length === 0) return null;

  const running = agents.filter(a => a.status === 'running');
  const finished = agents.filter(a => a.status !== 'running');
  const elapsed = running.reduce((sum, a) => sum + (Date.now() - a.startTime), 0);

  return (
    <div className="sub-agent-panel">
      <div className="sub-agent-panel-header">
        Sub-Agents ({running.length} active, {finished.length} done)
        {running.length > 0 && <span className="sub-agent-elapsed-total">{formatElapsed(elapsed)}</span>}
      </div>
      {agents.map(agent => (
        <div key={agent.agentId} className="sub-agent-panel-item">
          <SubAgentCard agent={agent} />
          {agent.status === 'running' && (
            <button className="sub-agent-cancel-btn" onClick={() => onCancel(agent.agentId)}>
              Cancel
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
