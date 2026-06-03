import { useState, useEffect, useRef } from 'react';
import type { SubAgentState } from '../App';

interface SubAgentCardProps {
  agent: SubAgentState;
}

export function SubAgentCard({ agent }: SubAgentCardProps) {
  const [elapsed, setElapsed] = useState(0);
  const intervalRef = useRef<ReturnType<typeof setInterval>>();

  useEffect(() => {
    if (agent.status === 'running') {
      intervalRef.current = setInterval(() => setElapsed(Date.now() - agent.startTime), 100);
    } else {
      if (intervalRef.current) clearInterval(intervalRef.current);
      setElapsed(agent.elapsed || 0);
    }
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [agent.status, agent.startTime, agent.elapsed]);

  const formatElapsed = (ms: number): string => {
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
    return `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`;
  };

  return (
    <div className={`sub-agent-card sub-agent-${agent.status}`}>
      <div className="sub-agent-header">
        <span className={`sub-agent-icon codicon ${agent.status === 'running' ? 'codicon-loading codicon-modifier-spin' : 'codicon-pass-filled'}`} />
        <span className="sub-agent-task">{agent.task}</span>
        <span className="sub-agent-elapsed">{formatElapsed(elapsed)}</span>
      </div>
      <div className="sub-agent-id">Agent: {agent.agentId.slice(0, 8)}</div>
      {agent.status === 'complete' && agent.summary && (
        <div className="sub-agent-summary">{agent.summary}</div>
      )}
    </div>
  );
}
