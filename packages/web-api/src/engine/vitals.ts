import { EnhancedToolExecutor } from '@agentx/engine';
import { getEngine } from './state.js';

/**
 * Aggregate autonomy status for observability (circuit breakers, compaction, checkpoints).
 */
export function getAutonomyStatus(): Record<string, unknown> {
  try {
    const eng = getEngine();
    const agent = eng.agent;
    if (!agent) return { available: false };

    const health = agent.getHealth();

    const executor = agent.getToolExecutor();
    let circuitBreakers: Array<{ tool: string; failures: number; blacklisted: boolean; remainingMs: number }> = [];
    if (executor && executor instanceof EnhancedToolExecutor) {
      circuitBreakers = executor.getCircuitBreakerStatus();
    }

    let memoryDrivenContext = '';
    try {
      const rl = agent.reflectionLoopInstance;
      if (rl && typeof rl.getBestApproach === 'function') {
        memoryDrivenContext = rl.getBestApproach?.('current task') ?? '';
      }
    } catch { /* */ }

    let activeCheckpoints = 0;
    let checkpointDetails: Array<{ description: string; checkpointId: string }> = [];
    try {
      const pendingCkp = agent.pendingCheckpoint;
      if (pendingCkp) {
        activeCheckpoints = 1;
        checkpointDetails = [{ description: 'Active checkpoint awaiting user input', checkpointId: pendingCkp.checkpointId }];
      }
    } catch { /* */ }

    const compactionCount = health.compactionCount;
    const tokenUsagePct = health.contextWindow > 0 ? Math.round((health.contextTokens / health.contextWindow) * 100) : 0;

    return {
      available: true,
      health,
      circuitBreakers,
      memoryDriven: memoryDrivenContext,
      escalation: {
        activeCheckpoints,
        checkpointDetails,
      },
      offlineFallback: { available: false, provider: '', model: '' },
      dbMode: 'postgres',
      compaction: {
        count: compactionCount,
        contextTokens: health.contextTokens,
        contextWindow: health.contextWindow,
        tokenUsagePct,
      },
    };
  } catch {
    return { available: false };
  }
}
