import { useEffect, useState } from 'react';

interface SubAgentStatus {
  id: string;
  name: string;
  instruction: string;
  status: 'running' | 'completed' | 'failed';
  elapsed?: number;
  output?: string;
}

interface AgentTimelineProps {
  visible: boolean;
}

export default function AgentTimeline({ visible }: AgentTimelineProps) {
  const [subAgents, setSubAgents] = useState<SubAgentStatus[]>([]);
  const [decompositionInfo, setDecompositionInfo] = useState<{
    task?: string;
    subtaskCount?: number;
    totalElapsed?: number;
  }>({});

  if (!visible) return null;

  // Import event handlers from chat parent via window for now
  // In production, this would use React context
  useEffect(() => {
    const handler = (e: CustomEvent) => {
      const { detail } = e;
      if (!detail) return;

      switch (detail.type) {
        case 'decomposition_start':
          setDecompositionInfo({ task: detail.task });
          setSubAgents([]);
          break;
        case 'decomposition_ready':
          setDecompositionInfo((prev) => ({ ...prev, subtaskCount: detail.subtaskCount }));
          break;
        case 'decomposition_complete':
          setDecompositionInfo((prev) => ({
            ...prev,
            subtaskCount: detail.subResultCount,
            totalElapsed: detail.totalElapsed,
          }));
          break;
        case 'subagent_event': {
          const sub = detail.data as { subagentId: string; parentEvent: { type: string } };
          if (sub?.parentEvent?.type === 'agent_spawned') {
            const d = detail.data as { subagentId: string; parentEvent: { task?: string } };
            setSubAgents((prev) => [...prev, {
              id: sub.subagentId,
              name: sub.subagentId.slice(0, 12),
              instruction: d.parentEvent?.task?.slice(0, 60) ?? 'Unknown task',
              status: 'running',
            }]);
          } else if (sub?.parentEvent?.type === 'agent_complete') {
            const d = detail.data as { subagentId: string; parentEvent: { summary?: string; elapsed?: number } };
            setSubAgents((prev) => prev.map((a) =>
              a.id === sub.subagentId
                ? { ...a, status: 'completed', elapsed: d.parentEvent?.elapsed, output: d.parentEvent?.summary }
                : a
            ));
          }
          break;
        }
      }
    };

    window.addEventListener('agentx-timeline', handler as EventListener);
    return () => window.removeEventListener('agentx-timeline', handler as EventListener);
  }, []);

  const runningCount = subAgents.filter((a) => a.status === 'running').length;

  return (
    <div style={{
      position: 'fixed',
      right: 0,
      top: 48,
      bottom: 0,
      width: 300,
      background: '#080808',
      borderLeft: '1px solid #1a1a1a',
      padding: 16,
      overflowY: 'auto',
      zIndex: 100,
      fontSize: '0.75rem',
    }}>
      <div style={{ fontWeight: 600, color: '#888', marginBottom: 12, fontSize: '0.8rem' }}>
        Agent Timeline
      </div>

      {decompositionInfo.task && (
        <div style={{
          background: '#0f0f0f',
          border: '1px solid #1a1a1a',
          borderRadius: 6,
          padding: 10,
          marginBottom: 12,
        }}>
          <div style={{ color: '#666', marginBottom: 4 }}>Task Decomposition</div>
          <div style={{ color: '#999' }}>{decompositionInfo.task.slice(0, 100)}</div>
          {decompositionInfo.subtaskCount !== undefined && (
            <div style={{ color: '#555', marginTop: 6 }}>
              {decompositionInfo.subtaskCount} subtasks
              {decompositionInfo.totalElapsed !== undefined && (
                <span> · {decompositionInfo.totalElapsed >= 1000
                  ? `${(decompositionInfo.totalElapsed / 1000).toFixed(1)}s`
                  : `${decompositionInfo.totalElapsed}ms`}
                </span>
              )}
            </div>
          )}
        </div>
      )}

      {runningCount > 0 && (
        <div style={{ color: '#666', marginBottom: 8 }}>
          {runningCount} agent{runningCount > 1 ? 's' : ''} running
        </div>
      )}

      {subAgents.length === 0 && !decompositionInfo.task && (
        <div style={{ color: '#444', textAlign: 'center', padding: 24 }}>
          No active sub-agents
        </div>
      )}

      {subAgents.map((agent) => (
        <div key={agent.id} style={{
          background: '#0f0f0f',
          border: '1px solid #1a1a1a',
          borderLeft: `3px solid ${
            agent.status === 'running' ? '#f59e0b' :
            agent.status === 'completed' ? '#22c55e' :
            '#ef4444'
          }`,
          borderRadius: 4,
          padding: '8px 10px',
          marginBottom: 6,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
            <span style={{
              width: 6, height: 6, borderRadius: '50%',
              background: agent.status === 'running' ? '#f59e0b' :
                agent.status === 'completed' ? '#22c55e' : '#ef4444',
              animation: agent.status === 'running' ? 'pulse 1.5s infinite' : undefined,
            }} />
            <span style={{ color: '#888', fontWeight: 500 }}>{agent.name}</span>
          </div>
          <div style={{ color: '#555', marginBottom: 4 }}>{agent.instruction}</div>
          {agent.status === 'running' && (
            <div style={{ color: '#666', fontSize: '0.7rem' }}>Executing...</div>
          )}
          {agent.status === 'completed' && (
            <div style={{ color: '#666', fontSize: '0.7rem' }}>
              Done{agent.elapsed ? ` · ${agent.elapsed >= 1000 ? `${(agent.elapsed / 1000).toFixed(1)}s` : `${agent.elapsed}ms`}` : ''}
              {agent.output && (
                <div style={{ color: '#555', marginTop: 4, lineHeight: 1.4 }}>
                  {agent.output.slice(0, 100)}
                </div>
              )}
            </div>
          )}
          {agent.status === 'failed' && (
            <div style={{ color: '#c66', fontSize: '0.7rem' }}>Failed</div>
          )}
        </div>
      ))}
    </div>
  );
}
